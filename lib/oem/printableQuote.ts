// lib/oem/printableQuote.ts — the ONE allowed shape of data that may cross
// from the server into PrintQuoteClient (a "use client" component under
// app/(dashboard)/oem/quotes/[id]/print).
//
// THIS IS A SECURITY BOUNDARY, NOT JUST A DTO. React Server Components
// serialize a client component's ENTIRE props tree into the RSC flight
// payload that ships to the browser — even fields the component never
// renders into the DOM still land in that payload, readable via
// view-source/devtools/curl. Passing OemQuoteRow/OemQuoteItemRow straight
// through (as the first version of this page did) leaked cost_piece,
// margin_*, approval_note, the raw `calc` breakdown, etc. into every print
// page response, even though PrintQuoteClient never rendered a single one of
// them — the leak was structural, not a rendering bug, so "just don't render
// it" was never actually a safe rule for this route.
//
// PrintableQuote/PrintableQuoteItem exist so that CANNOT happen again: if a
// field isn't listed on these two interfaces, it physically cannot reach the
// client component, no matter what PrintQuoteClient's JSX does or doesn't
// render. toPrintableQuote() below is the ONLY place allowed to construct
// one — field-by-field, never `...quote` spread — specifically so a future
// column added to OemQuoteRow (e.g. tomorrow's new cost field) does not
// silently ride along into this type for free. Adding a field HERE is the
// actual decision "this is now allowed to reach the customer" — treat it
// with the same weight as pricing-disclosure-policy.md §2.5, not as a
// routine refactor.
//
// Explicitly EXCLUDED, forever, unless a human deliberately decides
// otherwise in a change that touches this file: input/calc (either one, in
// full), costPiece/nreCost/any *cost* field, margin_actual_pct/
// margin_charged_pct/margin_after_discount_pct/floors.margin, approvalNote,
// lostReason/lostTo, qRun/flaskCount/platingBatchCount.
//
// 0078 NARROW EXCEPTION: toPrintableQuoteItem/toPrintableQuote below DO read
// 3 specific leaves off OemQuoteItemRow.calc.breakdown.bar —
// barPricePerPiece, asOfDate, capturedAt. This is deliberate, not a crack in
// the rule: those 3 numbers are (a) the bar's OWN sell price, independently
// checkable by the customer on the shop's public website right now, and (b)
// a timestamp — neither is cost, margin, or any other internal figure. They
// exist so engrave charges can print as their OWN line (barPricePerPiece +
// engraveImageThb + engraveTextThb = the pricePerPiece already charged) —
// see the print requirement in the 0078 brief: "ห้ามบวกกลืนเข้าราคาแท่ง
// เพราะลูกค้าเปิดเว็บเทียบราคาแท่งได้ ถ้าไม่ตรงจะดูเหมือนบวกแอบ". Still
// field-by-field, still never `...row.calc` / `...bar` spread.

import type { OemBarSize, OemCustomerAddress, OemMetal, OemQuoteItemRow, OemQuoteRow, OemQuoteStatus } from "./types";
import { OEM_BAR_SIZE_LABEL_TH } from "./types";

export interface PrintableQuoteItem {
  id: string;
  seq: number;
  skuSnapshot: string | null;
  productNameSnapshot: string | null;
  /** Copied out of OemQuoteItemRow.input.itemKind at map time — the label to
   * show when there's no sku/product name snapshot. Never pass `input`
   * itself through; it also carries polishTier/gemTier/platingType/purity,
   * none of which are wrong to show but none of which are needed either —
   * every field here should earn its place on the page, not ride along.
   * For metal='silver999' items this is a generic fallback ("เงินแท่ง
   * 99.99%") — barSizeLabel below is the real label to prefer. */
  itemKindFallback: string;
  material: OemMetal;
  /** null for metal='silver999' items — a bar's weight isn't linear across
   * sizes (10 บาท ≠ 1 บาท×10 by ~6%), so there is no single per-piece gram
   * figure worth printing; barSizeLabel is the size instead (0078 D6). */
  weightG: number | null;
  qty: number;
  /** the FULL per-piece price actually charged (bar + engrave, for bar
   * items) — same number the qty × pricePerPiece arithmetic on this row's
   * total already reflects. Do not confuse with barPricePerPiece below. */
  pricePerPiece: number | null;
  itemTotal: number | null;
  /** 0078: "เงินแท่ง 99.99% ขนาด 1 บาท" — set only for metal='silver999'; null otherwise. */
  barSizeLabel: string | null;
  /** 0078: the bar's own price/piece, EXCLUDING engrave — matches the shop's
   * public website price 1:1 for this size (checkable by the customer). null
   * for non-bar items, or when the price wasn't on file. Print this as its
   * OWN line, never folded into pricePerPiece's display. */
  barPricePerPiece: number | null;
  /** 0078: ค่ายิงเลเซอร์รูปภาพ บาท/ชิ้น — customer PAYS this, printable on its
   * own line. null when not applicable (non-bar item) or not charged. */
  engraveImageThb: number | null;
  /** 0078: ค่ายิงเลเซอร์ตัวอักษร บาท/ชิ้น — same rule as engraveImageThb. */
  engraveTextThb: number | null;
}

export interface PrintableQuote {
  id: string;
  quoteNo: string;
  status: OemQuoteStatus;
  createdAt: string;
  quoteValidUntil: string | null;
  parentQuoteNo: string | null;
  customerName: string | null;
  customerContact: string | null;
  billLegalName: string | null;
  billTaxId: string | null;
  billPhone: string | null;
  billContactChannel: string | null;
  billAddress: OemCustomerAddress | null;
  /** Sum of item totals, excluding NRE — same number QuoteDetailClient's
   * "ยอดรวมก่อนส่วนลด" section is built from alongside nrePrice. Price-only,
   * not a cost figure, but not on the coordinator's original field list —
   * added because the totals block needs it (piecesSubtotal + nrePrice =
   * quoteTotal, all three already computed server-side, never re-summed
   * here). */
  piecesSubtotal: number | null;
  nrePrice: number | null;
  quoteTotal: number | null;
  discountThb: number;
  discountReason: string | null;
  grandTotal: number | null;
  items: PrintableQuoteItem[];
  /** 0078: set only when at least one item is metal='silver999' — the
   * silver_price_daily snapshot those item(s) were priced against, read
   * ONLY from calc.breakdown.bar.asOfDate/capturedAt (see the file header's
   * "0078 NARROW EXCEPTION" note — never any other field off calc). */
  silverPriceAsOf: string | null;
  silverPriceCapturedAt: string | null;
}

function toPrintableQuoteItem(row: OemQuoteItemRow): PrintableQuoteItem {
  const isBar = row.input.metal === "silver999";
  const barSize = row.input.barSize as OemBarSize | null | undefined;
  const bar = row.calc?.breakdown?.bar ?? null; // narrow read — see file header
  return {
    id: row.id,
    seq: row.seq,
    skuSnapshot: row.skuSnapshot,
    productNameSnapshot: row.productNameSnapshot,
    itemKindFallback: isBar ? "เงินแท่ง 99.99%" : row.input.itemKind ?? "",
    material: row.input.metal,
    weightG: isBar ? null : row.input.weightG ?? null,
    qty: row.qty,
    pricePerPiece: row.pricePerPiece,
    itemTotal: row.itemTotal,
    barSizeLabel: isBar && barSize ? `เงินแท่ง 99.99% ขนาด ${OEM_BAR_SIZE_LABEL_TH[barSize]}` : null,
    barPricePerPiece: isBar ? bar?.barPricePerPiece ?? null : null,
    engraveImageThb: isBar ? row.input.engraveImageThb ?? null : null,
    engraveTextThb: isBar ? row.input.engraveTextThb ?? null : null,
  };
}

/** The only constructor for PrintableQuote — called once, server-side, in
 * app/(dashboard)/oem/quotes/[id]/print/page.tsx, before anything crosses
 * into the "use client" boundary. Field-by-field on purpose (see header). */
export function toPrintableQuote(quote: OemQuoteRow, items: OemQuoteItemRow[]): PrintableQuote {
  // First item with a bar snapshot wins — every bar item in one quote was
  // priced off the same day's lookup (server looks up "today" once per
  // calc call, and every item in a quote is saved together), so any one is
  // representative. null/null when the quote has no bar items at all.
  const barSnapshotItem = items.find((it) => it.calc?.breakdown?.bar);
  const barSnapshot = barSnapshotItem?.calc?.breakdown?.bar ?? null;

  return {
    id: quote.id,
    quoteNo: quote.quoteNo,
    status: quote.status,
    createdAt: quote.createdAt,
    quoteValidUntil: quote.quoteValidUntil,
    parentQuoteNo: quote.parentQuoteNo,
    customerName: quote.customerName,
    customerContact: quote.customerContact,
    billLegalName: quote.billLegalName,
    billTaxId: quote.billTaxId,
    billPhone: quote.billPhone,
    billContactChannel: quote.billContactChannel,
    billAddress: quote.billAddress,
    piecesSubtotal: quote.piecesSubtotal,
    nrePrice: quote.nrePrice,
    quoteTotal: quote.quoteTotal,
    discountThb: quote.discountThb,
    discountReason: quote.discountReason,
    grandTotal: quote.grandTotal,
    items: items.map(toPrintableQuoteItem),
    silverPriceAsOf: barSnapshot?.asOfDate ?? null,
    silverPriceCapturedAt: barSnapshot?.capturedAt ?? null,
  };
}
