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

import type { OemBarSize, OemMetal, OemPriceCalcInput, OemPriceCalcResult, OemProductOption } from "./types";
import { stripInvisibleText } from "./display";
import { cleanPriceReason, productInputIssue } from "./productItem";

export const OEM_DEFAULT_PURITY: Record<OemMetal, string> = { silver: "0.925", gold: "", brass: "1", silver999: "", product: "" };

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
  /** 0163, metal='silver999' only — ราคาพิเศษต่อแท่ง (บาท, ไม่รวม engrave) optional · ว่าง = ใช้ราคาเว็บวันนี้.
   * ห้ามต่ำกว่าทุน — ตัดสินที่ DB เท่านั้น (ฟอร์มนี้ไม่รู้ทุน และต้องไม่รู้). */
  barPriceOverrideThb: string;
  /** 0163 — เหตุผลราคาพิเศษ · บังคับเมื่อมีราคา · ไม่ถูกส่งไป calc ถ้าราคายังว่าง. */
  barPriceOverrideReason: string;
  /** 0166, metal='product' only — ชื่อรายการ (เฉพาะรายการไม่มี SKU · ถ้าผูก SKU ชื่อมาจากแคตตาล็อกที่ DB). */
  productName: string;
  /** 0166, metal='product' — ราคาต่อชิ้น (บาท) · ผูก SKU = ตั้งต้นจากราคาแคตตาล็อก แก้ได้อิสระ (ไม่เขียนกลับ catalog). */
  unitPriceThb: string;
  /** 0166, metal='product' ไม่มี SKU เท่านั้น — ทุนต่อชิ้น (บังคับ). ผูก SKU แล้วไม่มีช่องนี้ (ทุนอ่านจากแคตตาล็อกที่ DB). */
  unitCostThb: string;
  /** 0166, metal='product' — เหตุผลราคา · บังคับเมื่อผูก SKU และราคาต่ำกว่าราคาแคตตาล็อก (DB ตัดสินซ้ำ). */
  priceReason: string;
  /** 0166 — ราคาแคตตาล็อก (public list price) ของ SKU ที่ผูกอยู่ · ใช้ pre-check "ต่ำกว่าแคตตาล็อกต้องมีเหตุผล" เท่านั้น
   * (ไม่ใช่ที่ตัดสิน — DB อ่านราคาเองและตัดสินเอง) · null = ไม่รู้/SKU ไม่มีราคา. ไม่เคยถูกส่งไป DB. */
  listPriceThb: number | null;
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
    barPriceOverrideThb: "",
    barPriceOverrideReason: "",
    productName: "",
    unitPriceThb: "",
    unitCostThb: "",
    priceReason: "",
    listPriceThb: null,
    productId: null,
    skuSnapshot: null,
    productNameSnapshot: null,
  };
}

/** 0163: ใบที่มีราคาพิเศษยืนราคาได้ไม่เกินกี่วัน (มติเจ้าของ) — DB บังคับซ้ำที่ oem_quote_save */
export const OEM_BAR_OVERRIDE_MAX_DAYS = 30;

/** 0163: วันนี้ตามเวลาไทย (YYYY-MM-DD) — DB เป็น UTC, ห้ามใช้ toISOString() ตรงๆ (00:00-07:00 ไทยจะเลื่อนเป็นเมื่อวาน) */
export function bangkokToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** 0163: บวกวันบนวันที่ ISO (ไม่ใช่เงิน) */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 0163: ข้อความบอกว่าวันยืนราคาที่เลือกใช้ไม่ได้ (null = ใช้ได้) — ช่วงเดียวกับที่ DB บังคับ: วันนี้ ถึง วันนี้+30 (เวลาไทย) */
export function barValidUntilIssue(value: string, now: Date = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "เลือกวันยืนราคา — ใบที่มีราคาพิเศษต้องระบุวัน";
  const today = bangkokToday(now);
  if (value < today) return "วันยืนราคาย้อนหลังไม่ได้";
  if (value > addDaysIso(today, OEM_BAR_OVERRIDE_MAX_DAYS)) return "ยืนราคาได้ไม่เกิน " + OEM_BAR_OVERRIDE_MAX_DAYS + " วันนับจากวันนี้";
  return null;
}

/** 0163: มีรายการนี้ใช้ราคาพิเศษไหม (ช่องราคาไม่ว่าง) — ใช้ตัดสินว่าต้องโชว์ช่อง "ยืนราคาถึง" ระดับใบ */
export function jobHasBarOverride(job: JobForm): boolean {
  return job.metal === "silver999" && job.barPriceOverrideThb.trim() !== "";
}

/** 0163: ข้อความบอกผู้ใช้ว่าทำไมราคาพิเศษยังใช้ไม่ได้ (null = ใช้ได้/ไม่มีราคาพิเศษ) —
 * ตรวจแค่รูปร่าง: ตัวเลขจำกัด > 0 ไม่เกิน 1,000,000 ทศนิยมไม่เกิน 2 ตำแหน่ง + ต้องมีเหตุผล.
 * ไม่ตัดสิน "ต่ำกว่าทุนไหม" (นั่นคือ floors.barPrice จาก DB). */
export function barOverrideIssue(job: JobForm): string | null {
  if (!jobHasBarOverride(job)) return null;
  const price = Number(job.barPriceOverrideThb);
  if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) {
    return "ราคาพิเศษต้องเป็นตัวเลขมากกว่า 0 และไม่เกิน 1,000,000 บาท";
  }
  if (Math.round(price * 100) / 100 !== price) return "ราคาพิเศษใส่ทศนิยมได้ไม่เกิน 2 ตำแหน่ง";
  // 0165 L2: เหตุผลที่มีแต่อักขระล่องหน (U+2060/U+FEFF/U+202E ...) = ไม่มีเหตุผล (DB ลบแล้ว trim แล้วปฏิเสธเหมือนกัน)
  if (!stripInvisibleText(job.barPriceOverrideReason).trim()) return "กรอกเหตุผลราคาพิเศษ — ไม่มีเหตุผลออกใบไม่ได้";
  return null;
}

// ============================================================================
// 0166: รายการสินค้า/บริการ (metal='product') — ราคาตั้งต้นจากแคตตาล็อก · แก้ราคาได้อิสระ · ต่ำกว่าแคตตาล็อกต้องมีเหตุผล
// ไม่มีการคิดเงินที่นี่: แค่คัดลอก list price ของ SKU เป็นค่าตั้งต้นของช่องราคา + pre-check รูปร่าง/เหตุผล
// (DB เป็นด่านจริง — อ่านราคาแคตตาล็อก/ทุนเอง ตัดสินเอง) · ห้ามเขียนกลับ catalog
// ============================================================================

function numOrNaN(s: string): number {
  return s.trim() === "" ? NaN : Number(s);
}

/** รูปร่างของ input ที่จะส่ง (ไม่ผ่านด่าน = null จาก buildJobInput) — แยกจาก buildJobInput เพื่อใช้แสดงข้อความ */
function productInputFromForm(job: JobForm): OemPriceCalcInput {
  return {
    metal: "product",
    qty: numOrNaN(job.qty),
    productId: job.productId,
    productName: job.productId ? null : job.productName.trim(),
    unitPriceThb: numOrNaN(job.unitPriceThb),
    unitCostThb: job.productId ? null : numOrNaN(job.unitCostThb),
    priceReason: cleanPriceReason(job.priceReason),
  };
}

/** ข้อความบอกว่าทำไมรายการสินค้ายังคำนวณ/บันทึกไม่ได้ (null = ผ่านด่านฝั่งฟอร์ม · ไม่ใช่ว่า DB จะผ่านแน่)
 * ใช้ทั้งหมดนี้: รูปร่างตัวเลข/ชื่อ/ทุน (lib/oem/productItem.ts เดียวกับ server action) + pre-check
 * "ต่ำกว่าราคาแคตตาล็อกต้องมีเหตุผล" จาก listPriceThb (ถ้ารู้ราคาแคตตาล็อก) */
export function productFormIssue(job: JobForm): string | null {
  if (job.metal !== "product") return null;
  const input = productInputFromForm(job);
  const shape = productInputIssue(input);
  if (shape) return shape;
  if (
    job.productId &&
    job.listPriceThb != null &&
    (input.unitPriceThb as number) < job.listPriceThb &&
    !input.priceReason
  ) {
    return "ราคาต่ำกว่าราคาแคตตาล็อก — ใส่เหตุผลที่ลดราคา";
  }
  return null;
}

/** เลือก/ล้าง SKU บนรายการ — ตั้ง 3 field label พร้อมกัน + ถ้าเป็นรายการสินค้า: ราคาตั้งต้น = ราคาแคตตาล็อก
 * (ว่างถ้า SKU ไม่มีราคา) · ล้างทุน/ชื่อ/เหตุผลของ SKU เก่า · ล้าง SKU (null) = กลับไปโหมดไม่มี SKU: คงราคาที่กรอกไว้,
 * ต้องกรอกชื่อ+ทุนเอง. ไม่แตะรายการงานผลิต/เงินแท่งนอกจาก label (พฤติกรรมเดิม) */
export function applyProductSelection(job: JobForm, product: OemProductOption | null): JobForm {
  const next: JobForm = {
    ...job,
    productId: product?.productId ?? null,
    skuSnapshot: product?.sku ?? null,
    productNameSnapshot: product?.name ?? null,
    listPriceThb: product?.listPrice ?? null,
  };
  if (next.metal === "product") {
    next.unitCostThb = "";
    next.priceReason = "";
    if (product) {
      next.unitPriceThb = product.listPrice != null ? String(product.listPrice) : "";
      next.productName = "";
    }
  }
  return next;
}

/** รายการที่ยังไม่ได้กรอกอะไรของงานผลิต (ประเภท/น้ำหนัก/ระดับขัด ว่างหมด) — เลือก SKU ที่ไม่ใช่แท่งแล้วสลับเป็นโหมดสินค้าให้เองได้
 * โดยไม่ทำลายงานที่กรอกค้างไว้ (ถ้ากรอกงานผลิตไปแล้ว SKU ยังเป็น label เหมือนเดิม) */
export function shouldAutoSwitchToProduct(job: JobForm): boolean {
  return job.metal !== "silver999" && job.metal !== "product" && !job.itemKind && !job.weightG.trim() && !job.polishTier;
}

/** เปลี่ยนวัสดุเป็นสินค้า/บริการ — ถ้ามี SKU ผูกอยู่แล้ว (label จากโหมดเดิม) ใช้เป็น catalog ทันที: ราคาตั้งต้น = ราคาแคตตาล็อก
 * ถ้าช่องราคายังว่าง · products = รายการที่โหลดไว้ (หา listPrice ของ SKU ที่ผูก) */
export function enterProductMode(job: JobForm, products: OemProductOption[]): JobForm {
  const linked = job.productId ? products.find((p) => p.productId === job.productId) : undefined;
  const listPrice = linked?.listPrice ?? null;
  return {
    ...job,
    metal: "product",
    purity: OEM_DEFAULT_PURITY.product,
    listPriceThb: job.productId ? listPrice : null,
    unitPriceThb: job.unitPriceThb.trim() ? job.unitPriceThb : listPrice != null ? String(listPrice) : "",
    unitCostThb: job.productId ? "" : job.unitCostThb,
  };
}

/** Same validation/shape rules the pre-v2 single-job form used, plus the
 * 0078 silver999 branch (validates ONLY barSize+qty+engrave — none of the
 * production fields apply, see D3 in design-oem-bar-quote.md). */
export function buildJobInput(job: JobForm): OemPriceCalcInput | null {
  if (job.metal === "product") {
    // 0166: ไม่ผ่านด่านรูปร่าง/pre-check = null (ไม่ยิง calc ระหว่างพิมพ์) · UI บอกสาเหตุผ่าน productFormIssue()
    if (productFormIssue(job)) return null;
    return productInputFromForm(job);
  }

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

    // 0163: ราคาพิเศษ — validate รูปร่างเท่านั้น (ไม่คิดเงิน ไม่รู้ทุน) · ราคาไม่ถูกต้อง/ไม่มีเหตุผล = null
    // (ไม่ยิง calc ระหว่างพิมพ์ — เหตุผลไม่ถูกส่งไปถ้าราคายังว่าง) · UI บอกสาเหตุผ่าน barOverrideIssue()
    let barPriceOverrideThb: number | null = null;
    let barPriceOverrideReason: string | null = null;
    if (job.barPriceOverrideThb.trim()) {
      if (barOverrideIssue(job)) return null;
      barPriceOverrideThb = Number(job.barPriceOverrideThb);
      barPriceOverrideReason = stripInvisibleText(job.barPriceOverrideReason).trim();
    }

    return {
      metal: "silver999",
      barSize: job.barSize,
      qty,
      engraveImageThb,
      engraveTextThb,
      barPriceOverrideThb,
      barPriceOverrideReason,
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

// ============================================================================
// 0168 (มติเจ้าของ 8 ต.ค. 69): MOQ (จำนวนชิ้น) และล็อตโลหะขั้นต่ำ (น้ำหนักทองรวม) ของงานผลิตทุกวัสดุ = "ออกใบได้เมื่อมีเหตุผลอนุมัติ"
// ไม่ใช่ "ห้ามออกใบ" แล้ว — floors.qty / floors.metalWeight จาก oem_price_calc ยังรายงาน pass=false ตามเดิม (ใช้เตือน) ·
// ฟังก์ชันนี้เป็น pre-check ฝั่งฟอร์มเท่านั้น (ให้ช่องเหตุผลโผล่ + ปุ่มออกใบไม่ถูกปิดเพราะเรื่องนี้) — DB ตัดสินซ้ำที่ oem_quote_save
// ============================================================================
export const OEM_QTY_FLOOR_NOTE_TH = "ต่ำกว่าขั้นต่ำ (MOQ / ล็อตโลหะ) — ใส่เหตุผลเพื่อออกใบ";

/** true = รายการนี้ต่ำกว่า MOQ หรือล็อตโลหะขั้นต่ำ (pass === false เท่านั้น — null/ยังคำนวณไม่ได้ ไม่นับ: isComplete ดักอยู่แล้ว) */
export function calcBelowQtyFloors(calc: OemPriceCalcResult | null | undefined): boolean {
  if (!calc) return false;
  return calc.floors.qty.pass === false || (calc.floors.metalWeight.applies && calc.floors.metalWeight.pass === false);
}
