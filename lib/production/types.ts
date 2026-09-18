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

export type ProductionCostType = "fixed" | "spot";

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
 * never call preview on a closed order. */
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
  unitCost: number;
  qtyPlanned: number;
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
