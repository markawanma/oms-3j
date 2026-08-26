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

import type { OemBarSize, OemMetal, OemPriceCalcInput, OemPriceCalcResult } from "./types";

export const OEM_DEFAULT_PURITY: Record<OemMetal, string> = { silver: "0.925", gold: "", brass: "1", silver999: "" };

// ============================================================================
// เงินแท่ง 99.99% SKU auto-switch (0078, โจทย์ข้อ 3 ของ Luke) — เลือก SKU กลุ่ม
// เงินแท่ง → สลับ metal/barSize ให้อัตโนมัติ (ยังแก้เองได้เสมอ ไม่ใช่ล็อก) เก็บ
// เป็น table เดียว ไม่ใช่ if-chain เพื่อให้ "S-1A ไม่ auto" อ่านง่าย: มันแค่ไม่มี
// ในตารางนี้ — ไม่ใช่ special-case ที่ต้อง maintain แยก.
// ============================================================================
export const OEM_BAR_SKU_SIZE_MAP: Record<string, OemBarSize> = {
  "S-0.5bath": "0_5_baht",
  "S-1bath": "1_baht",
  "S-3bath": "3_baht",
  "S-5bath": "5_baht",
  "S-10bath": "10_baht",
  "S-1kg.": "1_kg",
  // วัดอรุณ 1 บาท — เจ้าของยืนยันราคาเดียวกับแท่งปกติ (มติข้อ 3 ใน design)
  "WA-1B": "1_baht",
  "Silver999-1-Baht": "1_baht",
  "Silver999-1Baht": "1_baht",
  // "S-1A" ("ค่าเริ่มต้น") ตั้งใจไม่อยู่ในตารางนี้ — ขนาดไม่ชัด เดาแล้วผิดคือ
  // เสนอราคาผิด ให้ผู้ใช้เลือกเอง ไม่ auto-switch
};

/** null = ไม่รู้จัก SKU นี้ (ไม่ auto-switch) — รวมถึง "S-1A" โดยตั้งใจ. */
export function barSizeForSku(sku: string | null | undefined): OemBarSize | null {
  if (!sku) return null;
  return OEM_BAR_SKU_SIZE_MAP[sku] ?? null;
}

export interface JobForm {
  metal: OemMetal;
  purity: string;
  itemKind: string;
  weightG: string;
  /** shared by both modes — "จำนวน (ชิ้น)" for production, "จำนวน (แท่ง)" for silver999. */
  qty: string;
  polishTier: string;
  hasGems: boolean;
  gemTier: string;
  gemCount: string;
  hasPlating: boolean;
  platingType: string;
  isNewDesign: boolean;
  marginPct: string;
  /** 0078, metal='silver999' only — dropdown, never free-typed (see OEM_BAR_SIZE_LABEL_TH). */
  barSize: OemBarSize | "";
  /** 0078, metal='silver999' only — บาท/ชิ้น, optional (empty = ไม่คิด). */
  engraveImageThb: string;
  /** 0078, metal='silver999' only — บาท/ชิ้น, optional (empty = ไม่คิด). */
  engraveTextThb: string;
  /** SKU picker (analytics.v_dim_product) — label/traceability only, never
   * fed into buildJobInput()/OemPriceCalcInput below: silver_weight_g is
   * null on every SKU today, so there is nothing safe to prefill from a
   * selection. Null = "ไม่ผูก SKU" (default), a free-text/new-design job.
   * EXCEPTION (0078): selecting a เงินแท่ง SKU (see barSizeForSku) DOES set
   * metal+barSize — the one deliberate, visible auto-switch in this form. */
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
    barSize: "",
    engraveImageThb: "",
    engraveTextThb: "",
    productId: null,
    skuSnapshot: null,
    productNameSnapshot: null,
  };
}

/** Same validation/shape rules the pre-v2 single-job form used, plus the
 * 0078 silver999 branch (validates ONLY barSize+qty+engrave — none of the
 * production fields apply, see D3 in design-oem-bar-quote.md). */
export function buildJobInput(job: JobForm): OemPriceCalcInput | null {
  if (job.metal === "silver999") {
    if (!job.barSize) return null;
    const qty = Number(job.qty);
    if (!Number.isFinite(qty) || qty <= 0) return null;

    let engraveImageThb: number | null = null;
    if (job.engraveImageThb.trim()) {
      engraveImageThb = Number(job.engraveImageThb);
      if (!Number.isFinite(engraveImageThb) || engraveImageThb < 0) return null;
    }
    let engraveTextThb: number | null = null;
    if (job.engraveTextThb.trim()) {
      engraveTextThb = Number(job.engraveTextThb);
      if (!Number.isFinite(engraveTextThb) || engraveTextThb < 0) return null;
    }

    return {
      metal: "silver999",
      barSize: job.barSize,
      qty,
      engraveImageThb,
      engraveTextThb,
    };
  }

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
