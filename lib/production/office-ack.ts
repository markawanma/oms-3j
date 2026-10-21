// lib/production/office-ack.ts — ตรรกะ pure ของการ์ดรับทราบใบที่เปิดจากหน้างาน + ป้าย "จากหน้างาน/รอรับทราบ/ค้าง 3 วัน" (W1 · UX B.10.1–B.10.3)
// 🔴 ไม่มีการคิดเงิน · ไม่แตะต้นทุน — แค่ตัดสินว่าใบไหนต้องรับทราบ/ค้างนานแค่ไหน + สรุปโลหะเป็นข้อความ (read-back ในปุ่มรับทราบ)
// ค้าง = นับวันปฏิทินไทย (มติ Q10): เปิดวันจันทร์ → พุธ = ค้าง 3 วัน (นับวันที่เปิดเป็นวันที่ 1) — ตรงตัวอย่างในมติ "เปิดวันจันทร์ → พุธเตือน"
//   ยืนยันแล้ว (Tech Lead 21 ต.ค.) — ค่า/วิธีนับอยู่ที่เดียว: lib/jobs/intake-ack.ts

import { STALE_CALENDAR_DAYS, calendarDaysOpen } from "@/lib/jobs/intake-ack";
import { PRODUCTION_METAL_LABEL_TH } from "@/lib/production/types";
import type { ProductionMetal, ProductionOrderItemRow, ProductionOrderRow } from "@/lib/production/types";
import { purityFractionToPct } from "@/lib/units/purity";

export const ACK_CARD_ID = "po-ack-card";

// ค่า/วิธีนับ "ค้างรับทราบ" อยู่ที่เดียว: lib/jobs/intake-ack.ts (ใช้ร่วมกับบอร์ดใบงาน)
export { STALE_CALENDAR_DAYS, calendarDaysOpen };

export type AckOrderLike = Pick<ProductionOrderRow, "status" | "openedVia" | "acknowledgedAt" | "createdAt">;

export const isShopfloor = (o: Pick<ProductionOrderRow, "openedVia">): boolean => o.openedVia === "shopfloor";

/** ใบหน้างานที่ยังเปิดอยู่และยังไม่รับทราบ — ใบ office ไม่มีวันเป็น true (ไม่ติดด่านเดิม) */
export function ackPending(o: AckOrderLike): boolean {
  return o.openedVia === "shopfloor" && o.status === "open" && o.acknowledgedAt === null;
}

export function isStale(o: AckOrderLike, today: string): boolean {
  if (!ackPending(o)) return false;
  const n = calendarDaysOpen(o.createdAt, today);
  return n !== null && n >= STALE_CALENDAR_DAYS;
}

/** "2 ชม. ที่แล้ว" / "35 นาทีที่แล้ว" / "เมื่อวาน" / "3 วันที่แล้ว" — แสดงควบคู่เวลาจริง (ไม่แทน) */
export function relativeThai(iso: string | null, nowMs: number): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const min = Math.max(0, Math.round((nowMs - t) / 60_000));
  if (min < 1) return "เมื่อครู่";
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ชม. ที่แล้ว`;
  const d = Math.floor(h / 24);
  return `${d} วันที่แล้ว`;
}

export function effectiveMetalOf(i: Pick<ProductionOrderItemRow, "effectiveMetal" | "metal">): ProductionMetal {
  return i.effectiveMetal ?? i.metal ?? "silver";
}

/** เนื้อที่มีผลของรายการเป็น % ("96.50") — ทองเหลือง "100.00" · ไม่มีค่า = null (ทองที่เนื้อว่างต้องไม่เกิดแล้ว — DB บังคับ แต่แถวเก่าอาจว่าง) */
export function effectivePurityPct(i: Pick<ProductionOrderItemRow, "effectiveMetal" | "metal" | "effectivePurity" | "purity">): string | null {
  const m = effectiveMetalOf(i);
  if (m === "brass") return "100.00";
  const f = i.effectivePurity ?? i.purity;
  const s = purityFractionToPct(f);
  return s === "" ? null : s;
}

/** "ทอง 96.50%" · "เงิน 92.50%" · "ทองเหลือง" — read-back ที่ให้ผู้รับทราบเห็นเนื้อก่อนกด (P8) */
export function metalPurityText(i: Pick<ProductionOrderItemRow, "effectiveMetal" | "metal" | "effectivePurity" | "purity">): string {
  const m = effectiveMetalOf(i);
  if (m === "brass") return PRODUCTION_METAL_LABEL_TH.brass;
  const p = effectivePurityPct(i);
  return p === null ? `${PRODUCTION_METAL_LABEL_TH[m]} (ไม่ได้ระบุเนื้อ)` : `${PRODUCTION_METAL_LABEL_TH[m]} ${p}%`;
}

/** ข้อความท้ายปุ่มรับทราบ: ไม่ซ้ำกัน คั่นด้วย ", " · เกิน 3 แบบ = ตัดเป็น "n แบบ" (ปุ่มไม่ยาวเกินจอ) */
export function ackSummary(items: readonly ProductionOrderItemRow[]): string {
  const uniq = [...new Set(items.map(metalPurityText))];
  if (uniq.length === 0) return "";
  return uniq.length > 3 ? `${uniq.length} แบบ` : uniq.join(", ");
}

export const ackButtonLabel = (items: readonly ProductionOrderItemRow[]): string => {
  const s = ackSummary(items);
  return s === "" ? "รับทราบ" : `รับทราบ · ${s}`;
};

// ---------------------------------------------------------------------------
// /production (รายการ) — ตัวกรองกลุ่ม "ต้องจัดการ" (UX B.10.2): ทำงานแบบ AND กับแถบสถานะ · ตัวนับนับเฉพาะใบ open
// ---------------------------------------------------------------------------

export type NeedFilter = "unacked" | "unbound";

export const NEED_FILTER_LABEL: Record<NeedFilter, string> = { unacked: "รอรับทราบ", unbound: "ยังไม่ผูก SKU" };

type NeedOrderLike = AckOrderLike & Pick<ProductionOrderRow, "unboundItemCount">;

export function matchesNeed(o: NeedOrderLike, f: NeedFilter): boolean {
  if (o.status !== "open") return false;
  return f === "unacked" ? ackPending(o) : o.unboundItemCount > 0;
}

/** ตัวนับของปุ่มกรอง — นับจากทุกใบ (ไม่ขึ้นกับแถบสถานะ) เฉพาะใบ open */
export function needCounts(orders: readonly NeedOrderLike[]): Record<NeedFilter, number> {
  return { unacked: orders.filter((o) => matchesNeed(o, "unacked")).length, unbound: orders.filter((o) => matchesNeed(o, "unbound")).length };
}

/** ข้อความ empty เมื่อเปิดตัวกรองแล้วไม่เหลือ (เลือกหลายตัว = ต้องตรงทุกตัว) */
export function needEmptyText(active: readonly NeedFilter[]): string {
  if (active.length === 1) return active[0] === "unacked" ? "ไม่มีใบที่รอรับทราบ" : "ไม่มีรายการที่ยังไม่ผูก SKU";
  return "ไม่มีใบที่ตรงทุกเงื่อนไขที่เลือก";
}

// ---------------------------------------------------------------------------
// ข้อผิดพลาดของปุ่ม "รับทราบ" — map จาก hint ของ RPC เป็นไทยล้วน (ข้อความ DB มีคำอังกฤษของ status เช่น "สถานะ cancelled แล้ว")
// ---------------------------------------------------------------------------

export const MSG_ACK_FAIL = "รับทราบไม่สำเร็จ — ลองอีกครั้ง";
export const MSG_ACK_NOT_OPEN = "ใบนี้ไม่ได้เปิดอยู่แล้ว — โหลดหน้าใหม่";

const ACK_HINT_TH: Record<string, string> = {
  order_not_open: MSG_ACK_NOT_OPEN,
  already_acknowledged: "ใบนี้รับทราบไปแล้ว — โหลดหน้าใหม่",
  not_shopfloor: "ใบนี้ออฟฟิศเปิดเอง ไม่ต้องรับทราบ",
  order_not_found: "ไม่พบใบผลิตนี้ — โหลดหน้าใหม่",
  actor_required: "ต้องเข้าสู่ระบบก่อนทำรายการ",
};

/** hint ของ production_order_acknowledge → ข้อความไทย · ไม่รู้จัก = null (ผู้เรียกใช้ข้อความกลาง — ไม่ส่งข้อความดิบของ DB) */
export function ackErrorFromHint(hint: unknown): string | null {
  return typeof hint === "string" && Object.prototype.hasOwnProperty.call(ACK_HINT_TH, hint) ? ACK_HINT_TH[hint] : null;
}

/** ด่านซ้ำฝั่งหน้าจอ: ข้อความที่ยังมีคำอังกฤษ (≥ 4 ตัวอักษรติดกัน เช่น cancelled/done) = ไม่โชว์ ใช้ข้อความกลางแทน · เลข PO (PO-0034) ผ่าน */
export function cleanAckError(error: string | null | undefined): string {
  const t = (error ?? "").trim();
  return t === "" || /[A-Za-z]{4,}/.test(t) ? MSG_ACK_FAIL : t;
}
