// lib/jobs/intake-ack.ts — กติกา "ค้างรับทราบ" ของใบที่เปิดจากหน้างาน (pure) — ใช้ร่วมกันของ /production (ใบผลิต) และ /jobs (บอร์ดใบงาน)
// ที่เดียวของค่า "กี่วันถึงเตือน" และวิธีนับ: วันปฏิทินไทย (Asia/Bangkok) นับวันที่เปิดเป็นวันที่ 1 (มติ Q10: เปิดวันจันทร์ → พุธเตือน)
// [ต้องยืนยัน] ถ้าเจ้าของหมายถึง "ผ่านไป 3 วันเต็ม" (จันทร์ → พฤหัส) ให้เปลี่ยนค่าเดียวที่ STALE_CALENDAR_DAYS
// 🔴 ไม่มีเงิน/ต้นทุน

import { bkkDateOf, daysBetween } from "@/lib/jobs/dates";

/** ค้างรับทราบ "ครบ n วันปฏิทิน" (นับวันที่เปิดเป็นวันที่ 1) = เกินกำหนดเตือน */
export const STALE_CALENDAR_DAYS = 3;

/** จำนวนวันปฏิทินไทยนับจากวันที่เปิด (วันเปิด = 1) · อ่านเวลาไม่ได้ = null */
export function calendarDaysOpen(createdAt: string | null | undefined, today: string): number | null {
  const d = bkkDateOf(createdAt);
  if (d === null) return null;
  return Math.max(1, daysBetween(d, today) + 1);
}

export function isAckStale(createdAt: string | null | undefined, today: string): boolean {
  const n = calendarDaysOpen(createdAt, today);
  return n !== null && n >= STALE_CALENDAR_DAYS;
}
