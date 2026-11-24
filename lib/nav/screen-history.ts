// lib/nav/screen-history.ts — helper ล้วน (pure) ของ "1 จอ = 1 history entry" สำหรับเครื่องมือลูกค้า (ux-tools-navigation §4.1)
//
// 🔴 ห้ามเขียนทับ history.state ทั้งก้อน: Next App Router ใส่ { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE } ใน state ทุก entry
// และ onPopState จะ reload หน้าทันทีถ้า event.state มีค่าแต่ไม่มี __NA → ปุ่ม Back ทุกจอ = reload (คำตอบหาย)
// (บทเรียน QA-3 ของ RingSizeClient — รายละเอียดเต็มอยู่หัว nextHistoryState ของไฟล์นั้น)
// ฟังก์ชันที่นี่รับ state ปัจจุบันเป็นพารามิเตอร์ (ไม่แตะ window) → เทสต์ได้ตรงๆ · ผู้เรียกส่ง window.history.state
// P1: gem-quiz ใช้ key "gq" · ring-size ยังใช้ของตัวเองใน RingSizeClient (ย้ายมาทีหลังเมื่อเทสต์เขียว — ไม่รื้อพร้อมกัน)

export interface HistEntry<T extends string> {
  id: T;
  i: number;
}

/** state ของ entry ใหม่ = state เดิมทุก key (รวม __NA) + { [key]: id, i } */
export function nextHistoryState(key: string, id: string, i: number, current: unknown): Record<string, unknown> {
  const base = current && typeof current === "object" && !Array.isArray(current) ? (current as Record<string, unknown>) : {};
  return { ...base, [key]: id, i };
}

/** อ่าน { id, i } จาก state ของ entry · ไม่ใช่รูปที่รู้จัก (ไม่มี key / id ไม่ผ่าน guard / i ไม่ใช่จำนวนเต็ม ≥ 0) = null */
export function readHistState<T extends string>(key: string, isId: (v: unknown) => v is T, current: unknown): HistEntry<T> | null {
  if (!current || typeof current !== "object" || Array.isArray(current)) return null;
  const s = current as Record<string, unknown>;
  const id = s[key];
  const i = s.i;
  if (isId(id) && typeof i === "number" && Number.isInteger(i) && i >= 0) return { id, i };
  return null;
}
