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

import type { OemCustomerAddress, OemMetal, OemQuoteItemRow, OemQuoteRow, OemQuoteStatus } from "./types";

export interface PrintableQuoteItem {
  id: string;
  seq: number;
  skuSnapshot: string | null;
  productNameSnapshot: string | null;
  /** Copied out of OemQuoteItemRow.input.itemKind at map time — the label to
   * show when there's no sku/product name snapshot. Never pass `input`
   * itself through; it also carries polishTier/gemTier/platingType/purity,
   * none of which are wrong to show but none of which are needed either —
   * every field here should earn its place on the page, not ride along. */
  itemKindFallback: string;
  material: OemMetal;
  weightG: number;
  qty: number;
  pricePerPiece: number | null;
  itemTotal: number | null;
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
}

function toPrintableQuoteItem(row: OemQuoteItemRow): PrintableQuoteItem {
  return {
    id: row.id,
    seq: row.seq,
    skuSnapshot: row.skuSnapshot,
    productNameSnapshot: row.productNameSnapshot,
    itemKindFallback: row.input.itemKind,
    material: row.input.metal,
    weightG: row.input.weightG,
    qty: row.qty,
    pricePerPiece: row.pricePerPiece,
    itemTotal: row.itemTotal,
  };
}

/** The only constructor for PrintableQuote — called once, server-side, in
 * app/(dashboard)/oem/quotes/[id]/print/page.tsx, before anything crosses
 * into the "use client" boundary. Field-by-field on purpose (see header). */
export function toPrintableQuote(quote: OemQuoteRow, items: OemQuoteItemRow[]): PrintableQuote {
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
  };
}
