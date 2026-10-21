// lib/production/metal-ui.ts — ฟังก์ชัน pure ของจอใบผลิต "โลหะ · เนื้อ % · น้ำหนัก ต่อรายการ" (PM-B · UX spec ส่วน A · 20 ต.ค. 69)
//
// 🔴 ไม่มีการคิดเงินที่นี่ — ไฟล์นี้จัดการแค่ "ค่าที่ผู้ใช้พิมพ์ในฟอร์ม" (ข้อความ → ตรวจรูปร่าง → payload) · ต้นทุน/ราคาทุกตัวมาจาก RPC เท่านั้น
//    ราคาโลหะ + การแปลงหน่วยอยู่ lib/oem/metal-price.ts (ไฟล์เดียว) — ไม่มีสำเนาที่นี่
// 🔴 ค่าเริ่มต้นที่ server ตัดสิน (production_item_spec ฝั่ง DB) = ความจริง · ฟอร์มแค่ prefill ให้เห็น ไม่ใช่ที่ตัดสิน
//    ที่ที่ฟอร์มรู้ "ค่าเริ่มต่อโลหะ" (เงิน 92.50 · ทองเหลือง 100.00 · ทองว่าง) คือกติการ้านเดียวกับหน้า OEM (OEM_DEFAULT_PURITY) ไม่ใช่สูตรใหม่

import type { ProductionCostType, ProductionMetal, ProductionOrderItemRow, ProductionWeightSource, SetProductionOrderItemInput } from "./types";
import { PRODUCTION_METAL_LABEL_TH, PRODUCTION_WEIGHT_MAX_G, productionItemInputIssue } from "./types";
import { OEM_DEFAULT_PURITY } from "@/lib/oem/quoteForm";
import { purityFractionToPct, purityPctIssue, purityPctToFraction } from "@/lib/units/purity";

// ============================================================================
// §1 ป้ายสีโลหะ (MetalTag) — token ใหม่ 1 ชุด · พื้นทึบ + glyph + ขอบ เสมอ (ไม่ชนสี semantic: amber=เตือน · เขียว=ผ่าน · แดง=เสีย)
// ใช้ชื่อสั้น (เงิน/ทอง/ทองเหลือง) ไม่ใช่ "เงิน 925" — เงินแท่งเนื้อ 99.90% จะผิดทันที · เนื้อ % อยู่ช่องแยกเสมอ
// ============================================================================

export const METAL_TAG: Record<ProductionMetal, { label: string; glyph: string; className: string }> = {
  silver: { label: PRODUCTION_METAL_LABEL_TH.silver, glyph: "◇", className: "bg-slate-200 text-slate-900 border border-slate-500" },
  gold: { label: PRODUCTION_METAL_LABEL_TH.gold, glyph: "◆", className: "bg-yellow-300 text-yellow-950 border border-yellow-600" },
  brass: { label: PRODUCTION_METAL_LABEL_TH.brass, glyph: "▲", className: "bg-orange-300 text-orange-950 border border-orange-600" },
};

// ============================================================================
// ค่าเริ่ม + ข้อความ
// ============================================================================

/** ค่าเริ่มของช่อง "ความบริสุทธิ์ (%)" ต่อโลหะ — เงิน 92.50 · ทองเหลือง 100.00 · ทอง "" (บังคับกรอก) · ตรงกับ OEM_DEFAULT_PURITY ทุกตัว */
export function defaultPurityText(metal: ProductionMetal): string {
  return OEM_DEFAULT_PURITY[metal];
}

export const MSG_GOLD_PURITY_REQUIRED = "ทองต้องกรอกเนื้อทอง (%) — ขั้นต่ำ 37.50%";
export const MSG_WEIGHT_INVALID = "น้ำหนักต้องมากกว่า 0 และไม่เกิน 10,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)";
export const MSG_QTY_INVALID = "จำนวนที่วางแผนผลิตต้องเป็นจำนวนเต็ม 1-100000";
export const MSG_LABEL_REQUIRED = "กรอกชื่อแบบ";
export const MSG_METAL_RESET_PURITY = "เนื้อรีเซ็ตตามโลหะใหม่";
export const MSG_WEIGHT_CLEARED_FROM_SKU = "ล้างน้ำหนักจากสินค้าแล้ว (ใช้กับเงินเท่านั้น)";

/**
 * ตัวเลือก "ไม่มี SKU — ใส่ชื่อแบบ" ในฟอร์มเพิ่มรายการฝั่งออฟฟิศ — เปิดแล้ว (W1 UI): การ์ดรายการไม่มี SKU มีปุ่ม "ผูก SKU" (bindProductionItemProduct · production_order_item_bind_product)
 * และแก้ชื่อแบบก่อนผูกได้ (setProductionItemLabel) จึงไม่ใช่ทางตันอีก · ใบที่มีรายการไม่มี SKU ยังผลิตเสร็จไม่ได้จนผูกครบ (ด่านที่ DB + เช็คลิสต์ข้อ unbound)
 */
export const ALLOW_UNBOUND_ITEM_OFFICE = true;

// ============================================================================
// ตรวจรูปร่างช่อง (ข้อความไทยต่อช่อง) — ด่านจริงอยู่ที่ DB ซ้ำกัน ไม่ใช่แทน
// ============================================================================

const WEIGHT_SHAPE = /^\d{1,5}(?:\.\d{1,3})?$/;

/** น้ำหนัก/ชิ้น (กรัม): ว่าง = ไม่ผิด (ไม่บังคับตอนสร้าง) · > 0 และ ≤ 10,000 · ทศนิยม ≤ 3 ตำแหน่ง · ไม่รับ e-notation/ลูกน้ำ/ลบ */
export function weightFieldIssue(text: string): string | null {
  const t = text.trim();
  if (t === "") return null;
  if (!WEIGHT_SHAPE.test(t)) return MSG_WEIGHT_INVALID;
  const n = Number(t);
  if (!Number.isFinite(n) || !(n > 0 && n <= PRODUCTION_WEIGHT_MAX_G)) return MSG_WEIGHT_INVALID;
  return null;
}

/** เนื้อ %: ทองเหลืองล็อก 100 (ไม่ตรวจ) · ทอง/เงินว่าง = บังคับกรอก · อื่นๆ ใช้กติกาเดิมของ lib/units/purity.ts (ไม่เขียนสูตรซ้ำ) */
export function purityFieldIssue(metal: ProductionMetal, text: string): string | null {
  if (metal === "brass") return null;
  // เงินเว้นว่างไม่ใช่ error (มติเจ้าของ: ค่าเริ่ม 92.50 แก้ได้ ไม่บังคับกรอก) · ทองว่าง = บังคับกรอก
  if (text.trim() === "") return metal === "gold" ? MSG_GOLD_PURITY_REQUIRED : null;
  return purityPctIssue(text);
}

export function qtyFieldIssue(text: string): string | null {
  const t = text.trim();
  if (!/^\d{1,6}$/.test(t)) return MSG_QTY_INVALID;
  const n = Number(t);
  return n >= 1 && n <= 100000 ? null : MSG_QTY_INVALID;
}

export interface MetalSpecFieldErrors {
  purity?: string;
  weight?: string;
  qty?: string;
}

/** ตรวจ 3 ช่องของการ์ด (วัสดุ → เนื้อ → น้ำหนัก → จำนวน) — คืนเฉพาะช่องที่ผิด */
export function metalSpecIssues(input: { metal: ProductionMetal; purityText: string; weightText: string; qtyText?: string }): MetalSpecFieldErrors {
  const out: MetalSpecFieldErrors = {};
  const purity = purityFieldIssue(input.metal, input.purityText);
  if (purity) out.purity = purity;
  const weight = weightFieldIssue(input.weightText);
  if (weight) out.weight = weight;
  if (input.qtyText !== undefined) {
    const qty = qtyFieldIssue(input.qtyText);
    if (qty) out.qty = qty;
  }
  return out;
}

// ============================================================================
// Draft ของการ์ด
// ============================================================================

export interface ItemDraft {
  metal: ProductionMetal;
  /** เนื้อเป็น % ตามที่พิมพ์ (สตริง "92.50") — แปลงเป็นสัดส่วน 0..1 จุดเดียวใน buildItemSaveInput ผ่าน lib/units/purity.ts */
  purityText: string;
  weightText: string;
  qtyText: string;
  isNewDesign: boolean;
}

export function weightTextFromNumber(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? "" : String(n);
}

/** "3.20" ≡ "3.2" · ค่าที่ยังไม่เป็นตัวเลขที่ถูกต้องคงเดิม (trim) — ใช้เทียบ dirty/เทียบกับค่าที่ server เก็บ ไม่ใช่การคิดเงิน */
export function normalizeWeightText(text: string): string {
  const t = text.trim();
  return WEIGHT_SHAPE.test(t) ? String(Number(t)) : t;
}

function normalizePurityText(metal: ProductionMetal, text: string): string {
  if (metal === "brass") return "100.00";
  const t = text.trim();
  const f = purityPctToFraction(t);
  return f === null ? t : purityFractionToPct(f);
}

/** ค่าที่ DB เก็บ/ใช้จริงของรายการ (effective จาก helper ฝั่ง DB — แถวเดิมก่อน 0186 ที่คอลัมน์ว่างได้ค่าเงิน/เนื้อ/น้ำหนักเดิมเป๊ะ) → draft ตั้งต้นของการ์ด */
export function draftFromRow(row: ProductionOrderItemRow): ItemDraft {
  const metal = row.effectiveMetal ?? row.metal ?? "silver";
  return {
    metal,
    purityText: metal === "brass" ? "100.00" : purityFractionToPct(row.effectivePurity ?? row.purity),
    weightText: weightTextFromNumber(row.effectiveWeightG ?? row.weightG),
    qtyText: String(row.qtyPlanned),
    isNewDesign: row.isNewDesign,
  };
}

export function isDraftDirty(draft: ItemDraft, base: ItemDraft): boolean {
  return (
    draft.metal !== base.metal ||
    normalizePurityText(draft.metal, draft.purityText) !== normalizePurityText(base.metal, base.purityText) ||
    normalizeWeightText(draft.weightText) !== normalizeWeightText(base.weightText) ||
    draft.qtyText.trim() !== base.qtyText.trim() ||
    draft.isNewDesign !== base.isNewDesign
  );
}

export interface MetalChangeResult {
  draft: ItemDraft;
  /** ข้อความเล็กใต้ช่องที่ต้องบอกผู้ใช้ว่าอะไรถูกรีเซ็ต/ล้าง (ไม่เงียบ) */
  notes: string[];
}

/**
 * เปลี่ยนโลหะในการ์ด (UX A.3.1): เนื้อรีเซ็ตเป็นค่าเริ่มของโลหะใหม่ (เงิน 92.50 · ทองเหลือง 100.00 · ทอง "") ·
 * น้ำหนักที่ "มาจาก SKU" (ใช้กับเงินเท่านั้น) เปลี่ยนไปโลหะอื่นแล้วล้างทิ้ง · น้ำหนักที่พิมพ์เอง = คงไว้ ·
 * กลับมาโลหะเดิมของรายการ (ที่บันทึกไว้) = คืนเนื้อ/น้ำหนักเดิมทั้งคู่ (ไม่ทำให้ผู้ใช้เสียค่าเพราะกดผิดแล้วกดกลับ)
 */
export function applyMetalChange(
  draft: ItemDraft,
  nextMetal: ProductionMetal,
  base: ItemDraft,
  baseWeightSource: ProductionWeightSource | null
): MetalChangeResult {
  if (nextMetal === draft.metal) return { draft, notes: [] };
  if (nextMetal === base.metal) {
    return { draft: { ...draft, metal: nextMetal, purityText: base.purityText, weightText: base.weightText }, notes: [] };
  }
  const notes: string[] = [MSG_METAL_RESET_PURITY];
  let weightText = draft.weightText;
  // น้ำหนักจาก SKU = น้ำหนักเนื้อเงินของ SKU (silver_weight_g) — ห้ามไปเป็นน้ำหนักทอง/ทองเหลือง (oem-quote-invariants ข้อ 9)
  const weightIsFromSku = baseWeightSource === "product" && normalizeWeightText(draft.weightText) === normalizeWeightText(base.weightText);
  if (weightIsFromSku && nextMetal !== "silver") {
    weightText = "";
    notes.push(MSG_WEIGHT_CLEARED_FROM_SKU);
  }
  return { draft: { ...draft, metal: nextMetal, purityText: defaultPurityText(nextMetal), weightText }, notes };
}

// ============================================================================
// Payload ของ setProductionOrderItem
// ============================================================================

/**
 * ค่าเนื้อ (สัดส่วน 0..1) ที่จะส่ง server — ทองเหลือง = 1 · เงินที่ช่องว่าง = "ใช้ 92.50" ส่ง 0.925 ชัดเจน (มติเจ้าของ: ค่าเริ่มเงิน 92.50 ไม่บังคับกรอก — ไม่ปล่อยให้ "คงค่าเดิมเงียบๆ") ·
 * ทองว่าง/ค่าผิดรูป = null (ผู้เรียกต้องปฏิเสธ — ทองไม่มี default)
 */
export function purityFractionToSend(metal: ProductionMetal, purityText: string): number | null {
  if (metal === "brass") return 1;
  const text = metal === "silver" && purityText.trim() === "" ? defaultPurityText("silver") : purityText;
  return purityPctToFraction(text);
}

export type BuildSaveResult = { ok: true; input: SetProductionOrderItemInput } | { ok: false; errors: MetalSpecFieldErrors; formError?: string };

/** ที่มาของน้ำหนัก: "product" เฉพาะเมื่อ รายการมี SKU + โลหะเงิน + ตัวเลขตรงกับน้ำหนักใน SKU เป๊ะ (DB ตรวจซ้ำ — ไม่ให้ป้ายเท็จ) · นอกนั้น "input" */
export function weightSourceFor(args: { hasSku: boolean; metal: ProductionMetal; weightText: string; skuWeightG: number | null }): ProductionWeightSource {
  const n = Number(args.weightText.trim());
  return args.hasSku && args.metal === "silver" && args.skuWeightG != null && Number.isFinite(n) && n === args.skuWeightG ? "product" : "input";
}

export const BADGE_FROM_SKU = "จาก SKU";
export const BADGE_EDITED = "แก้ในใบนี้";

/**
 * ป้ายใต้ช่องเนื้อ/น้ำหนัก: "จาก SKU" เมื่อค่าในช่อง "เท่ากับ" ค่าของ SKU จริง · ต่างกัน = "แก้ในใบนี้" · ช่องว่าง/ไม่มีค่าของ SKU/ไม่มี SKU = ไม่มีป้าย
 * (แสดงผลอย่างเดียว ไม่ตัดสิน) — ใช้ฟังก์ชันเดียวทั้งการ์ดรายการและฟอร์มเพิ่มรายการ ไม่มีเงื่อนไขซ้ำสองที่ (เดิมฟอร์มเพิ่มขึ้น "จาก SKU" ค้างแม้แก้เนื้อแล้ว)
 *  • เนื้อเทียบเมื่อโลหะในช่อง = โลหะที่ค่าเนื้อของ SKU เป็นของ (skuMetal · null = เงิน เหมือน helper ฝั่ง DB)
 *  • น้ำหนักของ SKU ใช้กับเงินเท่านั้น (silver_weight_g) — โลหะอื่นไม่มีป้าย
 */
export function skuSourceBadges(args: {
  hasSku: boolean;
  metal: ProductionMetal;
  skuMetal: ProductionMetal | null;
  skuPurity: number | null;
  skuWeightG: number | null;
  purityText: string;
  weightText: string;
}): { purity: string | null; weight: string | null } {
  const out: { purity: string | null; weight: string | null } = { purity: null, weight: null };
  if (!args.hasSku) return out;
  if (args.skuPurity != null && args.metal === (args.skuMetal ?? "silver") && args.metal !== "brass" && args.purityText.trim() !== "") {
    const typed = purityPctToFraction(args.purityText);
    out.purity = typed !== null && purityFractionToPct(typed) === purityFractionToPct(args.skuPurity) ? BADGE_FROM_SKU : BADGE_EDITED;
  }
  if (args.skuWeightG != null && args.metal === "silver" && args.weightText.trim() !== "") {
    out.weight = normalizeWeightText(args.weightText) === normalizeWeightText(String(args.skuWeightG)) ? BADGE_FROM_SKU : BADGE_EDITED;
  }
  return out;
}

/**
 * draft → input ของ setProductionOrderItem สำหรับ "บันทึกรายการ" บนการ์ดที่บันทึกแล้ว — ส่งเฉพาะช่องที่ผู้ใช้เปลี่ยนจริง (undefined = ไม่แตะค่าเดิม แพทเทิร์น 0144):
 *  • โลหะ: ส่งเมื่อเปลี่ยน (หรือรายการไม่มี SKU — DB ต้องการโลหะเสมอ) · มีใบงานเดิน DB ปฏิเสธ (metal_locked) ไม่ได้กันที่นี่
 *  • เนื้อ: ส่งเมื่อเนื้อเปลี่ยนหรือเปลี่ยนโลหะ · ทองเหลืองส่ง 1 · ไม่แตะ = ไม่ส่ง (ค่าเดิมที่ละเอียดเกิน 4 ตำแหน่งจึงไม่ถูกปัดทับเงียบ)
 *  • น้ำหนัก: เปลี่ยนเป็นค่า → ส่งค่า + ที่มา · ล้างช่อง → clearWeight · ไม่เปลี่ยน = ไม่ส่ง
 *  • แบบใหม่: ส่งเฉพาะเมื่อผู้ใช้ติ๊ก/ถอดติ๊กจริง (ไม่ส่ง false เป็นค่าเริ่ม — กันรีเซ็ตเงียบ)
 */
export function buildItemSaveInput(args: {
  orderId: string;
  row: ProductionOrderItemRow;
  draft: ItemDraft;
  base: ItemDraft;
}): BuildSaveResult {
  const { orderId, row, draft, base } = args;
  const errors = metalSpecIssues({ metal: draft.metal, purityText: draft.purityText, weightText: draft.weightText, qtyText: draft.qtyText });
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const hasSku = row.productId !== null;
  const metalChanged = draft.metal !== base.metal;
  const purityChanged = normalizePurityText(draft.metal, draft.purityText) !== normalizePurityText(base.metal, base.purityText);
  const weightChanged = normalizeWeightText(draft.weightText) !== normalizeWeightText(base.weightText);

  const input: SetProductionOrderItemInput = {
    productionOrderId: orderId,
    qtyPlanned: Number(draft.qtyText.trim()),
  };
  if (hasSku) input.productId = row.productId;
  else input.pendingProductLabel = row.pendingProductLabel;

  if (!hasSku || metalChanged) input.metal = draft.metal;
  if (metalChanged || purityChanged) {
    const f = purityFractionToSend(draft.metal, draft.purityText);
    if (f === null) return { ok: false, errors: { purity: MSG_GOLD_PURITY_REQUIRED } };
    input.purity = f;
  }
  if (weightChanged) {
    if (draft.weightText.trim() === "") input.clearWeight = true;
    else {
      input.weightG = Number(draft.weightText.trim());
      input.weightSource = weightSourceFor({ hasSku, metal: draft.metal, weightText: draft.weightText, skuWeightG: row.skuWeightG });
    }
  }
  if (row.currentCostType === "spec" && draft.isNewDesign !== base.isNewDesign) input.isNewDesign = draft.isNewDesign;

  const issue = productionItemInputIssue(input);
  if (issue) return { ok: false, errors: {}, formError: issue };
  return { ok: true, input };
}

/** การ์ดร่างตอนเพิ่มรายการ → input ของ setProductionOrderItem (ส่ง "ค่าทั้งสามชัดเจน": โลหะ + เนื้อ + น้ำหนักถ้ามี) — server ยังตัดสินค่าเริ่มด้วย helper ตัวเดียวและตรวจซ้ำ */
export function buildNewItemInput(args: {
  orderId: string;
  productId: string | null;
  label: string | null;
  draft: ItemDraft;
  skuWeightG: number | null;
  isSpecSku: boolean;
}): BuildSaveResult {
  const { orderId, productId, label, draft } = args;
  const errors = metalSpecIssues({ metal: draft.metal, purityText: draft.purityText, weightText: draft.weightText, qtyText: draft.qtyText });
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const input: SetProductionOrderItemInput = {
    productionOrderId: orderId,
    qtyPlanned: Number(draft.qtyText.trim()),
    metal: draft.metal,
  };
  if (productId) input.productId = productId;
  else input.pendingProductLabel = label;

  {
    const f = purityFractionToSend(draft.metal, draft.purityText);
    if (f === null) return { ok: false, errors: { purity: MSG_GOLD_PURITY_REQUIRED } };
    input.purity = f;
  }
  if (draft.weightText.trim() !== "") {
    input.weightG = Number(draft.weightText.trim());
    input.weightSource = weightSourceFor({ hasSku: productId !== null, metal: draft.metal, weightText: draft.weightText, skuWeightG: args.skuWeightG });
  }
  // ติ๊กเฉพาะเมื่อผู้ใช้ติ๊ก (ไม่ส่ง false) — SKU เดิมที่ถูกเพิ่มซ้ำจะไม่ถูกรีเซ็ต (เคสห้ามผ่าน #2 ของ 0144)
  if (args.isSpecSku && draft.isNewDesign) input.isNewDesign = true;

  const issue = productionItemInputIssue(input);
  if (issue) return { ok: false, errors: {}, formError: issue };
  return { ok: true, input };
}

/** ชื่อแบบเทียบซ้ำ: ยุบช่องว่าง + ตัวพิมพ์เล็ก (DB เทียบ lower(label) หลังยุบช่องว่าง — ฝั่งนี้เป็นด่านกันกดผิด ไม่ใช่ด่านจริง) */
export function labelKey(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

// ============================================================================
// ชื่อรายการ
// ============================================================================

/** ข้อความระบุตัวรายการ — SKU หรือ (ไม่มี SKU) ชื่อแบบ · ไม่พิมพ์ "null" */
export function itemDisplayName(row: Pick<ProductionOrderItemRow, "sku" | "productName" | "pendingProductLabel">): string {
  if (row.sku) return row.productName ? `${row.sku} · ${row.productName}` : row.sku;
  return row.pendingProductLabel ? `ไม่มี SKU · ${row.pendingProductLabel}` : "ไม่มี SKU";
}

/** ชื่อสั้นสำหรับ toast/aria-label */
export function itemShortName(row: Pick<ProductionOrderItemRow, "sku" | "pendingProductLabel">): string {
  return row.sku ?? row.pendingProductLabel ?? "ยังไม่ผูก SKU";
}

// ============================================================================
// เช็คลิสต์ก่อนกด "ผลิตเสร็จ" (UX A.2) — ข้อติดที่ "รู้จากแถวเลย" ไม่ต้องยิง preview
// ลำดับบรรทัดเหตุผลใต้ปุ่ม: ① แก้ไว้ยังไม่บันทึก ② ยังไม่รับทราบ (ใบจากหน้างาน · W1) ③ ยังไม่ผูก SKU ④ น้ำหนักขาด ⑤ ไม่มีรายการ
// ============================================================================

export type CloseBlockerCode = "dirty" | "ack" | "unbound" | "weight" | "empty";

export interface CloseBlocker {
  code: CloseBlockerCode;
  /** ข้อความเต็มในเช็คลิสต์ */
  message: string;
  /** รายการที่เกี่ยวข้อง — ปุ่มลัด scroll+focus ไปที่การ์ดนี้ */
  itemId?: string;
  /** element id ที่ปุ่มลัดพาไป (เช่น การ์ดรับทราบ) — ใช้เมื่อไม่ผูกกับรายการเดียว */
  anchorId?: string;
}

const COST_TYPES_NEEDING_WEIGHT: readonly ProductionCostType[] = ["spot", "spec"];

export const ACK_BLOCKER_MESSAGE = 'ใบนี้เปิดจากหน้างาน — ยังไม่ได้ "รับทราบ" (ตรวจโลหะ/เนื้อ/น้ำหนักที่หน้างานกรอกแล้วกดรับทราบที่การ์ดด้านบน)';

/** opts.ackPending = ใบหน้างานที่ยังไม่รับทราบ (ackPending() ของ office-ack.ts) — ออฟฟิศไม่ส่ง = พฤติกรรมเดิมเป๊ะ */
export function closeBlockers(items: readonly ProductionOrderItemRow[], dirtyIds: ReadonlySet<string>, opts: { ackPending?: boolean; ackAnchorId?: string } = {}): CloseBlocker[] {
  const out: CloseBlocker[] = [];
  if (items.length === 0) return [{ code: "empty", message: "ยังไม่มีรายการในใบนี้ — เพิ่มรายการก่อน" }];

  const dirtyItems = items.filter((i) => dirtyIds.has(i.id));
  if (dirtyItems.length > 0) {
    out.push({ code: "dirty", message: 'มีรายการที่แก้ไว้แต่ยังไม่บันทึก — กด "บันทึกรายการ" ก่อน', itemId: dirtyItems[0].id });
  }
  if (opts.ackPending) out.push({ code: "ack", message: ACK_BLOCKER_MESSAGE, anchorId: opts.ackAnchorId ?? "po-ack-card" });
  for (const i of items) {
    if (i.productId === null) {
      out.push({
        code: "unbound",
        message: `ยังไม่ผูก SKU ให้ "${i.pendingProductLabel ?? "รายการนี้"}" — ผูก SKU ก่อน ระบบถึงคิดต้นทุนและเข้าสต็อกได้`,
        itemId: i.id,
      });
    }
  }
  for (const i of items) {
    if (i.productId !== null && i.currentCostType !== null && COST_TYPES_NEEDING_WEIGHT.includes(i.currentCostType) && i.effectiveWeightG == null) {
      out.push({
        code: "weight",
        message: `ยังไม่ระบุน้ำหนัก/ชิ้นของ ${i.sku ?? "รายการนี้"} — ต้นทุนโหมดนี้ต้องใช้น้ำหนัก`,
        itemId: i.id,
      });
    }
  }
  return out;
}

/** บรรทัดเหตุผลใต้ปุ่ม: ข้อแรก + "ติดอีก n ข้อ" · ไม่มีข้อติด = null */
export function closeReasonLine(blockers: readonly CloseBlocker[]): string | null {
  if (blockers.length === 0) return null;
  const first = blockers[0].message;
  return blockers.length > 1 ? `${first} · ติดอีก ${blockers.length - 1} ข้อ` : first;
}
