// lib/oem/quoteForm.ts — client-only shape for one OEM quote LINE item,
// shared between QuoteCalculatorClient (form state), QuoteJobItemCard
// (per-item fields) and QuoteResultPanel (whole-quote preview). JobForm
// mirrors OemPriceCalcInput 1:1 (lib/oem/types.ts), just with string-typed
// fields the way a controlled <input> needs before buildJobInput() parses
// them.
//
// aggregateQuotePreview() is a deliberate, narrow exception to "no pricing
// arithmetic in the frontend" (see lib/actions/oem.ts header): it mirrors,
// read-only, the exact aggregation oem_quote_save (0075) performs over each
// item's ALREADY-COMPUTED oem_price_calc result (item_total, cost_piece,
// metal.per_piece) — it does not invent a new price or margin formula, only
// sums numbers the RPC already returned. It exists purely so the discount
// field can show a live "margin after discount" preview while typing. The
// RPC call in oem_quote_save is still the ONLY real gate — see the discount
// warning copy in QuoteResultPanel, which never disables the submit button
// off this number, only off each item's own (already-gated) floors.

import type { OemMetal, OemPriceCalcInput, OemPriceCalcResult } from "./types";

export const OEM_DEFAULT_PURITY: Record<OemMetal, string> = { silver: "0.925", gold: "", brass: "1" };

export interface JobForm {
  metal: OemMetal;
  purity: string;
  itemKind: string;
  weightG: string;
  qty: string;
  polishTier: string;
  hasGems: boolean;
  gemTier: string;
  gemCount: string;
  hasPlating: boolean;
  platingType: string;
  isNewDesign: boolean;
  marginPct: string;
  /** SKU picker (analytics.v_dim_product) — label/traceability only, never
   * fed into buildJobInput()/OemPriceCalcInput below: silver_weight_g is
   * null on every SKU today, so there is nothing safe to prefill from a
   * selection. Null = "ไม่ผูก SKU" (default), a free-text/new-design job. */
  productId: string | null;
  skuSnapshot: string | null;
  productNameSnapshot: string | null;
}

export function createJobForm(defaultMarginPct: number): JobForm {
  return {
    metal: "silver",
    purity: OEM_DEFAULT_PURITY.silver,
    itemKind: "",
    weightG: "",
    qty: "",
    polishTier: "",
    hasGems: false,
    gemTier: "",
    gemCount: "",
    hasPlating: false,
    platingType: "",
    isNewDesign: true,
    marginPct: String(defaultMarginPct),
    productId: null,
    skuSnapshot: null,
    productNameSnapshot: null,
  };
}

/** Same validation/shape rules the pre-v2 single-job form used — unchanged. */
export function buildJobInput(job: JobForm): OemPriceCalcInput | null {
  if (!job.itemKind || !job.polishTier) return null;
  const qty = Number(job.qty);
  const weightG = Number(job.weightG);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if (!Number.isFinite(weightG) || weightG <= 0) return null;
  if (job.metal === "gold" && !job.purity.trim()) return null;

  let purity: number | null = null;
  if (job.purity.trim()) {
    purity = Number(job.purity);
    if (!Number.isFinite(purity) || purity <= 0 || purity > 1) return null;
  }

  let marginPct: number | null = null;
  if (job.marginPct.trim()) {
    marginPct = Number(job.marginPct) / 100;
    if (!Number.isFinite(marginPct) || marginPct < 0 || marginPct >= 1) return null;
  }

  if (job.hasGems && (!job.gemTier || !job.gemCount || Number(job.gemCount) <= 0)) return null;
  if (job.hasPlating && !job.platingType) return null;

  return {
    metal: job.metal,
    itemKind: job.itemKind,
    polishTier: job.polishTier,
    qty,
    weightG,
    isNewDesign: job.isNewDesign,
    purity,
    platingType: job.hasPlating ? job.platingType : null,
    gemTier: job.hasGems ? job.gemTier : null,
    gemCount: job.hasGems ? Number(job.gemCount) : 0,
    marginPct,
  };
}

export interface QuoteAggregatePreview {
  /** false while any item's calc is missing/loading/incomplete — every
   * total below is a best-effort partial sum in that case, not trustworthy
   * for display as a final number (same "don't show a partial total" rule
   * OemPriceBreakdown.quoteTotal already follows server-side). */
  isComplete: boolean;
  piecesSubtotal: number;
  nreTotal: number;
  quoteTotal: number;
  grandTotal: number;
  /** min per-item charged margin — same signal oem_quote_save's single-item
   * hard-floor gate uses. */
  minMarginChargedPct: number | null;
  /** aggregate margin AFTER discount, gold pass-through excluded — mirrors
   * margin_after_discount_pct (0075). Null until isComplete. */
  marginAfterDiscountPct: number | null;
}

export function aggregateQuotePreview(
  items: { calc: OemPriceCalcResult | null; metal: OemMetal; qty: number }[],
  discountRaw: number
): QuoteAggregatePreview {
  // ช่องส่วนลดพิมพ์ค่าติดลบได้ (type=number กัน min ไม่อยู่) — ปล่อยผ่านแล้ว
  // "ยอดสุทธิ" จะโตกว่ายอดก่อนหักส่วนลดเงียบๆ ตัดทิ้งตั้งแต่ตรงนี้
  const discountThb = Number.isFinite(discountRaw) && discountRaw > 0 ? discountRaw : 0;
  let isComplete = items.length > 0;
  let piecesSubtotal = 0;
  let nreTotal = 0;
  let priceExGoldSum = 0;
  let costExGoldSum = 0;
  let minMarginChargedPct: number | null = null;

  for (const { calc, metal, qty } of items) {
    if (!calc || !calc.isComplete) {
      isComplete = false;
      continue;
    }
    const itemTotal = (calc.breakdown.quoteTotal ?? 0) - calc.breakdown.nre.price;
    piecesSubtotal += itemTotal;
    nreTotal += calc.breakdown.nre.price;

    const marginCharged = calc.floors.margin.value;
    if (marginCharged != null && (minMarginChargedPct == null || marginCharged < minMarginChargedPct)) {
      minMarginChargedPct = marginCharged;
    }

    if (metal === "gold") {
      const metalTotal = calc.breakdown.metal.perPiece * qty;
      priceExGoldSum += itemTotal - metalTotal;
      costExGoldSum += calc.breakdown.costPiece * qty - metalTotal;
    } else {
      priceExGoldSum += itemTotal;
      costExGoldSum += calc.breakdown.costPiece * qty;
    }
  }

  const quoteTotal = piecesSubtotal + nreTotal;
  const grandTotal = quoteTotal - discountThb;
  const priceExGoldAfterDiscount = priceExGoldSum - discountThb;
  // ต้อง > 0 ไม่ใช่ !== 0 — ตัวหารติดลบทำให้อัตราส่วนพลิกเป็นบวกใหญ่ แล้ว
  // พรีวิวจะโชว์ margin สวยทั้งที่ขาดทุน (อาการเดียวกับ C1 ใน 0076 ฝั่ง DB)
  const marginAfterDiscountPct =
    isComplete && priceExGoldAfterDiscount > 0 ? (priceExGoldAfterDiscount - costExGoldSum) / priceExGoldAfterDiscount : null;

  return { isComplete, piecesSubtotal, nreTotal, quoteTotal, grandTotal, minMarginChargedPct, marginAfterDiscountPct };
}
