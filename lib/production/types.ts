// lib/production/types.ts — shared types/labels/pure helpers for the
// production-order (ใบผลิตเข้าสต็อก) module. Kept OUT of lib/actions/
// production.ts (which may only export async functions per "use server").
//
// Column/jsonb shapes copied 1:1 from supabase/migrations/0131_production_order.sql
// (analytics.production_order / production_order_item / v_production_order /
// v_production_order_item, and the RPC jsonb contracts documented there) —
// not guessed.
//
// 🔴 P1 boundary (docs/3j-jewelry/oms/design-production-order.md, มติ Tech
// Lead #3): stock here is WRITE-ONLY — production adds to central_stock,
// nothing subtracts yet (P1.5 wires up sales deduction). Every screen in
// this module must show only facts about the production order itself
// ("ผลิตเข้าแล้ว N ชิ้น เมื่อ ...") — NEVER the word "คงเหลือ"/"สต็อกคงเหลือ",
// which would be actively wrong right now (the number only ever goes up).

import { readErrorCode, readErrorMessage } from "@/lib/supabase/postgrest-error";
import type { MakeSpec } from "@/lib/catalog/types";
import type { OemBatchLine, OemLaborStep, OemMissingRateEntry, OemPriority } from "@/lib/oem/types";

export type ProductionOrderStatus = "open" | "done" | "cancelled";

export const PRODUCTION_ORDER_STATUS_LABEL_TH: Record<ProductionOrderStatus, string> = {
  open: "กำลังผลิต",
  done: "เข้าสต็อกแล้ว",
  cancelled: "ยกเลิก",
};

/** Mirrors the check constraint on analytics.production_order.spot_override_thb_per_gram
 * (0131) — per GRAM, not per baht-weight (1 บาท = 15.244 กรัม). Kept as its
 * own constant here (NOT imported from lib/catalog/types.ts) so this module
 * never depends on catalog's bounds drifting independently — the two happen
 * to share the same 5–500 range today because they're both "a per-gram
 * silver price", not because one is derived from the other. */
export const PRODUCTION_SPOT_OVERRIDE_MIN = 5;
export const PRODUCTION_SPOT_OVERRIDE_MAX = 500;

export type ProductionCostType = "fixed" | "spot" | "spec";

/** ป้ายบอกโหมดต่อบรรทัดในหน้าใบผลิต (task brief 2d — คำที่ต่างจาก
 * lib/catalog/types.ts's COST_TYPE_LABEL_TH โดยตั้งใจ: ตรงนี้พูดกับคนกดใบ
 * ผลิต "ตัวเลขนี้มาจากไหน" ไม่ใช่พูดกับคนตั้งค่า SKU ใน /catalog). */
export const PRODUCTION_COST_TYPE_LABEL_TH: Record<ProductionCostType, string> = {
  fixed: "กรอกเอง",
  spot: "น้ำหนัก×ราคาเงิน",
  spec: "คำนวณจากสเปค",
};

// ============================================================================
// 0141/0142 spec-mode cost breakdown — the `cost_calc` jsonb
// analytics.production_cost_calc returns (branch 'spec' only; null for
// fixed/spot). Field-by-field mirror of the RPC's jsonb_build_object, same
// discipline as OemPriceCalcResult (lib/oem/types.ts) — reuses its
// OemMissingRateEntry/OemLaborStep/OemBatchLine shapes since oem_cost_calc
// (0140) is the SAME function underneath, just called from a different RPC.
//
// 🔴 Deliberately has NO price/margin/floor fields at all — not "present but
// unused", the shape itself cannot carry them (oem-quote-invariants §1's "a
// print/no-margin surface must be a type boundary, not a rendering choice").
// ============================================================================

export interface ProductionSpecCostCalc {
  isComplete: boolean;
  missing: OemMissingRateEntry[];
  priceSource: string | null;
  /** Asia/Bangkok date the rates were looked up under (0142 MEDIUM-1). */
  asOfDate: string | null;
  laborSteps: OemLaborStep[];
  batchLines: OemBatchLine[];
  metalPerPiece: number;
  laborPerPiece: number;
  batchPerPiece: number;
  costPiece: number;
  /** lump NRE sum (cad+print3d+mold) — 0 when isNewDesign=false. */
  nreCost: number;
  /** nreCost / qty — already rounded (0142 MEDIUM-2: the 4 *_perPiece values
   * here sum EXACTLY to unitCost, batchPerPiece absorbs the rounding remainder). */
  nrePerPiece: number;
  qty: number;
  isNewDesign: boolean;
  metalPriceThbPerGram: number | null;
  unitCost: number;
}

/** Parses the `cost_calc` jsonb analytics.production_cost_calc (and therefore
 * production_order_preview/production_order_done, which both embed its
 * result) returns for a cost_type='spec' line — null for fixed/spot (the RPC
 * itself returns cost_calc=null there, see 0141/0142's header). Snake_case
 * DB keys -> camelCase, defensive (never throws on a malformed/unexpected
 * shape — a read path must degrade to "no breakdown shown", not a 500). */
export function parseProductionSpecCostCalc(raw: unknown): ProductionSpecCostCalc | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);
  const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  return {
    isComplete: Boolean(r.is_complete),
    missing: arr(r.missing).map((m) => ({
      rateKey: String(m.rate_key ?? ""),
      scope: String(m.scope ?? ""),
      questionTh: String(m.question_th ?? ""),
      priority: (m.priority as OemPriority) ?? "P2",
    })),
    priceSource: typeof r.price_source === "string" ? r.price_source : null,
    asOfDate: typeof r.as_of_date === "string" ? r.as_of_date : null,
    laborSteps: arr(r.labor_steps).map((s) => ({
      key: String(s.key ?? ""),
      minutes: s.minutes == null ? null : Number(s.minutes),
      thb: num(s.thb),
    })),
    batchLines: arr(r.batch_lines).map((l) => ({
      key: (l.key as OemBatchLine["key"]) ?? "flask",
      capacity: l.capacity == null ? null : Number(l.capacity),
      count: l.count == null ? null : Number(l.count),
      cost: l.cost == null ? null : Number(l.cost),
    })),
    metalPerPiece: num(r.metal_per_piece),
    laborPerPiece: num(r.labor_per_piece),
    batchPerPiece: num(r.batch_per_piece),
    costPiece: num(r.cost_piece),
    nreCost: num(r.nre_cost),
    nrePerPiece: num(r.nre_per_piece),
    qty: num(r.qty),
    isNewDesign: Boolean(r.is_new_design),
    metalPriceThbPerGram: r.metal_price_thb_per_gram == null ? null : Number(r.metal_price_thb_per_gram),
    unitCost: num(r.unit_cost),
  };
}

// ============================================================================
// Read shapes — analytics.v_production_order / v_production_order_item (0131 §14)
// ============================================================================

export interface ProductionOrderRow {
  id: string;
  poNo: string;
  status: ProductionOrderStatus;
  note: string | null;
  spotOverrideThbPerGram: number | null;
  doneAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  qtyPlannedTotal: number;
  qtyDoneTotal: number;
}

export interface ProductionOrderItemRow {
  id: string;
  productionOrderId: string;
  poNo: string;
  orderStatus: ProductionOrderStatus;
  productId: string;
  sku: string;
  productName: string;
  currentCostType: ProductionCostType;
  currentUnitCost: number | null;
  qtyPlanned: number;
  qtyDone: number | null;
  /** unit_cost stamped by production_order_done — null until this item's
   * order is done. NEVER recompute this client-side; it's the number that
   * was actually written to public.product at the moment of done. */
  stampedUnitCost: number | null;
  prevCostType: ProductionCostType | null;
  prevUnitCost: number | null;
  createdAt: string;
  updatedAt: string;
  /** 0141: non-null only when currentCostType='spec' — side-channel read off
   * public.product.make_spec (v_production_order_item doesn't expose it,
   * same reason ProductRow.makeSpec needs one in lib/actions/catalog.ts).
   * Used to render the "การ์ดสเปค" (weight/tier/gem/plating) next to the cost
   * breakdown in ProductionDoneDialog/ProductionSpecCostCard. */
  makeSpec: MakeSpec | null;
  /** current public.product.silver_weight_g/silver_purity — same "today's
   * catalog state" caveat as currentUnitCost/currentCostType (NOT a
   * historical snapshot of what a DONE order actually used; only the live
   * preview/done RPC responses carry that). Shown alongside makeSpec on the
   * done-order detail table so the "การ์ดสเปค" reads the same shape there as
   * it does in ProductionDoneDialog's live preview. */
  currentSilverWeightG: number | null;
  currentSilverPurity: number | null;
  /** 0141: analytics.production_order_item.is_new_design — DB column default
   * false, and read-only from every TS path today: analytics.
   * production_order_item_set(uuid,uuid,uuid,int) has no arg for it, and no
   * other RPC sets it (0141's own header, "จุดที่ตัดสินใจเอง" §3, marks this
   * as intentionally deferred to the UI phase that adds a real form for it —
   * see lib/actions/production.ts's header for the KNOWN GAP note). Always
   * false in this UI until that RPC exists — never write it via a raw
   * UPDATE from TS (skill oem-quote-invariants + task brief's hard rule). */
  isNewDesign: boolean;
  /** 0141: analytics.production_order_item.cost_calc snapshot — non-null only
   * for a DONE order's cost_type='spec' line (written once by
   * production_order_done, immutable after). null for open orders (not
   * stamped yet — use the live preview's costCalc instead) and for
   * fixed/spot lines always. Side-channel read off the base table
   * (v_production_order_item doesn't expose this column — see 0141's own
   * header for why it was left out of the view). */
  costCalc: ProductionSpecCostCalc | null;
}

/** SKU picker option for adding a line item to an open order — filtered
 * SERVER-SIDE to is_active=true and sku NOT ILIKE 'live%' (analytics.
 * v_dim_product), mirroring the exact two gates analytics.
 * production_order_item_set / production_order_item_derive_shop (0131)
 * enforce. A SKU that would be rejected by the DB must never even appear as
 * a choice here. */
export interface ProductionSkuOption {
  productId: string;
  sku: string;
  name: string;
  costType: ProductionCostType;
}

// ============================================================================
// RPC result shapes
// ============================================================================

/** analytics.production_order_save */
export interface ProductionOrderSaveResult {
  id: string;
  poNo: string;
  status: ProductionOrderStatus;
  note: string | null;
  spotOverrideThbPerGram: number | null;
  seq: number;
  createdAt: string;
}

export interface SaveProductionOrderInput {
  id?: string;
  note?: string | null;
  spotOverrideThbPerGram?: number | null;
  /** 0132 M2 — true = ล้างหมายเหตุ/override ทิ้งจริง (เซ็ต null) แทนพฤติกรรม
   * เดิมที่ "ส่ง null = ไม่แตะค่าเดิม" (analytics.production_order_save,
   * coalesce(p_x, x)) ซึ่งทำให้ลบ override ที่ตั้งผิดไม่ได้แม้จอขึ้นว่าบันทึก
   * สำเร็จ (security review 18 ก.ย., M2). มีผลเฉพาะตอนแก้ใบเดิม (มี `id`) —
   * ตอนสร้างใบใหม่ RPC ไม่อ่าน flag นี้เลย ไม่ต้องส่ง. */
  clearNote?: boolean;
  clearSpotOverride?: boolean;
}

/** analytics.production_order_item_set */
export interface ProductionOrderItemSetResult {
  id: string;
  productId: string;
  sku: string;
  name: string;
  qtyPlanned: number;
}

/** analytics.production_order_preview — ONLY callable while status='open'
 * (raises otherwise, 0131 §11). For a done/cancelled order, read the stamped
 * values off ProductionOrderItemRow (stampedUnitCost/prevUnitCost) instead —
 * never call preview on a closed order.
 *
 * 0141/0142: preview now takes an optional p_items (qty overrides — see
 * previewProductionOrder) so the SAME qty that production_order_done will
 * stamp is what got costed here (task brief 2b, cost หมด 'spec' ขึ้นกับจำนวน
 * — 5 ชิ้น=305.07 · 3 ชิ้น=325.07, ตัวเลขทดสอบจริงจากบรีฟ). */
export interface ProductionOrderPreviewItem {
  itemId: string;
  productId: string;
  sku: string;
  costType: ProductionCostType;
  silverWeightG: number | null;
  silverPurity: number;
  laborCost: number | null;
  spotPriceThbPerGram: number | null;
  prevCostType: ProductionCostType;
  prevUnitCost: number | null;
  /** null only when skipped=true (qty_used=0 — user typed 0 in the confirm
   * dialog, "ไม่ได้ผลิตชิ้นนี้เลย"). */
  unitCost: number | null;
  qtyPlanned: number;
  /** the qty actually costed for this line — qty_planned unless overridden
   * via p_items (production_order_preview's `q.qty_used`). */
  qtyUsed: number;
  isNewDesign: boolean;
  /** non-null only for cost_type='spec'. */
  costCalc: ProductionSpecCostCalc | null;
  /** true when qtyUsed=0 — production_cost_calc was never called for this
   * line (it would raise for spec mode on qty<=0), unitCost/costCalc are
   * both null. */
  skipped: boolean;
}

export interface ProductionOrderPreview {
  productionOrderId: string;
  poNo: string;
  spotPriceThbPerGram: number | null;
  items: ProductionOrderPreviewItem[];
}

export interface DoneItemInput {
  productId: string;
  qtyDone: number;
}

/** analytics.production_order_done — the RPC re-derives everything itself;
 * `items` here is what actually got stamped, not an echo of the request. */
export interface ProductionOrderDoneItemResult {
  productId: string;
  sku: string;
  qtyDone: number | null;
  unitCost: number | null;
  prevCostType: ProductionCostType | null;
  prevUnitCost: number | null;
  /** non-null only for cost_type='spec' — same snapshot that gets written to
   * production_order_item.cost_calc (permanent once done). */
  costCalc: ProductionSpecCostCalc | null;
}

export interface ProductionOrderDoneResult {
  productionOrderId: string;
  poNo: string;
  status: ProductionOrderStatus;
  alreadyDone: boolean;
  items: ProductionOrderDoneItemResult[];
}

/** analytics.production_order_cancel */
export interface ProductionOrderCancelResult {
  productionOrderId: string;
  poNo: string;
  status: ProductionOrderStatus;
  alreadyCancelled: boolean;
}

// ============================================================================
// Error message translation — 0131's RPCs already `raise exception` in Thai
// (SQLSTATE 22023 throughout), so most messages pass straight through
// readErrorMessage() unmodified. Two specific cases get rewritten into more
// actionable Thai per the brief's "ข้อความ error ที่ต้องแปลให้เจ้าของอ่านรู้เรื่อง":
// the "no spot price today" case, which needs to spell out BOTH ways out
// WITHOUT linking to /oem/rates (a manual entry there would silently lock
// the OEM quote calculator's price for the rest of the day — see 0131's own
// header, point 4, and design-production-order.md's table row on
// oem_metal_price). The RPC error for that case never mentions the two
// workarounds by name, so this rewrite adds them; every other 22023 message
// from 0131 is already specific and actionable as-is (SKU name, po_no,
// current status), so it passes through unchanged.
// ============================================================================

const NO_SPOT_PRICE_MARKER = "ยังไม่มีราคาเงินของวันนี้";

/** แปล error ของ 0131 เป็นข้อความที่เจ้าของอ่านรู้เรื่อง
 *
 * 🔴 กรอง SQLSTATE ก่อนเสมอ (security review 18 ก.ย. M3): 0131 ติด
 * `errcode = '22023'` ไว้กับ raise ทุกจุดที่ "ตั้งใจพูดกับผู้ใช้" (ไม่มีราคาเงิน
 * วันนี้ · SKU ยังไม่กรอกน้ำหนัก/ต้นทุน · ใบปิดแล้ว · ใบว่าง · ผลิตได้ 0 ชิ้น)
 * ⇒ code อื่นทั้งหมดคือของภายใน **ห้ามส่งออกหน้าจอ** เพราะจะเผยชื่อฟังก์ชัน/
 * ชื่อตาราง/uuid/ตัวเลข ledger เช่น
 *   22P02 invalid input syntax for type uuid: "…"
 *   21000 more than one row returned by a subquery…
 *   P0001 adjust_stock: idem_key po:… already used for product <uuid> …
 * เป็นมาตรฐานเดียวกับ lib/actions/oem.ts ที่ปล่อยผ่านเฉพาะ 22023
 *
 * ปล่อยผ่าน = ข้อความไทยของ 0131 เอง (เฉพาะตัวไม่มีราคาเงินที่เขียนใหม่ให้บอก
 * ทางออก 2 ทาง) · อย่างอื่นตกที่ `fallback` */
export function humanizeProductionError(err: unknown, fallback: string): string {
  if (readErrorCode(err) !== "22023") return fallback;
  const msg = readErrorMessage(err);
  if (!msg) return fallback;
  if (msg.includes(NO_SPOT_PRICE_MARKER)) {
    return (
      "ยังไม่มีราคาเงินของวันนี้ — เลือกทางใดทางหนึ่ง: " +
      "(1) กรอก \"ราคาเงินเฉพาะใบนี้\" เป็นราคาที่ซื้อมาจริง แล้วบันทึกใบผลิตอีกครั้ง หรือ " +
      "(2) รอราคาที่จะเข้าระบบอัตโนมัติตอนเช้าพรุ่งนี้แล้วค่อยกลับมาทำต่อ"
    );
  }
  return msg;
}
