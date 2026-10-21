// lib/production/office-ack.ts — ตรรกะ pure ของการ์ดรับทราบใบที่เปิดจากหน้างาน + ป้าย "จากหน้างาน/รอรับทราบ/ค้าง 3 วัน" (W1 · UX B.10.1–B.10.3)
// 🔴 ไม่มีการคิดเงิน · ไม่แตะต้นทุน — แค่ตัดสินว่าใบไหนต้องรับทราบ/ค้างนานแค่ไหน + สรุปโลหะเป็นข้อความ (read-back ในปุ่มรับทราบ)
// ค้าง = นับวันปฏิทินไทย (มติ Q10): เปิดวันจันทร์ → พุธ = ค้าง 3 วัน (นับวันที่เปิดเป็นวันที่ 1) — ตรงตัวอย่างในมติ "เปิดวันจันทร์ → พุธเตือน"
//   [ต้องยืนยัน] ถ้าเจ้าของหมายถึง "ผ่านไป 3 วันเต็ม" (จันทร์ → พฤหัส) ให้เปลี่ยนค่าเดียวที่ STALE_CALENDAR_DAYS

import { bkkDateOf, daysBetween } from "@/lib/jobs/dates";
import { PRODUCTION_METAL_LABEL_TH } from "@/lib/production/types";
import type { ProductionMetal, ProductionOrderItemRow, ProductionOrderRow } from "@/lib/production/types";
import { purityFractionToPct } from "@/lib/units/purity";

export const ACK_CARD_ID = "po-ack-card";

/** ค้างรับทราบ "ครบ n วันปฏิทิน" (นับวันที่เปิดเป็นวันที่ 1) = เกินกำหนดเตือน */
export const STALE_CALENDAR_DAYS = 3;

export type AckOrderLike = Pick<ProductionOrderRow, "status" | "openedVia" | "acknowledgedAt" | "createdAt">;

export const isShopfloor = (o: Pick<ProductionOrderRow, "openedVia">): boolean => o.openedVia === "shopfloor";

/** ใบหน้างานที่ยังเปิดอยู่และยังไม่รับทราบ — ใบ office ไม่มีวันเป็น true (ไม่ติดด่านเดิม) */
export function ackPending(o: AckOrderLike): boolean {
  return o.openedVia === "shopfloor" && o.status === "open" && o.acknowledgedAt === null;
}

/** จำนวนวันปฏิทินไทยนับจากวันที่เปิด (วันเปิด = 1) · อ่านเวลาไม่ได้ = null */
export function calendarDaysOpen(createdAt: string | null, today: string): number | null {
  const d = bkkDateOf(createdAt);
  if (d === null) return null;
  return Math.max(1, daysBetween(d, today) + 1);
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
