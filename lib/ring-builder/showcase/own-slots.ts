// lib/ring-builder/showcase/own-slots.ts — เลือกพลอยรายเม็ด (D1.2a · UX "D1.2a เลือกรายเม็ด" A5/A7) · pure
// 🔴 ทุกเม็ดเท่ากัน — ไม่มีคำว่า "หลัก/เสริม" ในข้อความรายเม็ด · ไม่มีราคาต่อเม็ด · ไม่มี "เพชร"
// helper เดียวกันใช้ทั้ง LINE · การ์ดสรุป · aria ของ stage (ไม่ให้ 3 ที่เล่าไม่ตรงกัน)
import { GEM_QUIZ_STONE_BY_CODE, type GemQuizStoneCode } from "@/lib/gem-quiz/config";
import { mainIndexes, seedFromPair } from "./designs";
import { isStoneCode } from "./quiz-link";

export type OwnSlots = readonly GemQuizStoneCode[];

/** รหัสทุกตัวผ่าน whitelist และยาวเท่า count (ค่าจากภายนอก type system) */
export function isOwnSlots(v: unknown, count: number): v is OwnSlots {
  if (!Array.isArray(v) || v.length !== count) return false;
  for (let i = 0; i < count; i++) if (!isStoneCode(v[i])) return false;
  return true;
}

export function fillAll(count: number, code: GemQuizStoneCode): GemQuizStoneCode[] {
  return Array.from({ length: count }, () => code);
}

/**
 * ปรับชุดสีให้พอดีจำนวนเม็ดใหม่ (A5) — จัดกึ่งกลางให้ตรงกัน: oldIdx = clamp(i + floor((old−new)/2), 0, old−1)
 *  7→3 เก็บเม็ด 3–5 · 7→4 เก็บเม็ด 2–5 · 3→7 = [1,1,1,2,3,3,3]
 * จาก/ไป ไขว้ (2 เม็ด = [บน, ล่าง]): ไขว้→แถว = กลาง=บน ที่เหลือ=ล่าง · แถว→ไขว้ = บน=เม็ดกลางตัวแรก ล่าง=เม็ดที่ 1
 */
export function fitOwnToCount(codes: OwnSlots, newN: number): GemQuizStoneCode[] {
  const old = codes.length;
  if (old === newN) return [...codes];
  if (old === 2) return seedFromPair(newN, codes[0], codes[1]);
  if (newN === 2) return [codes[mainIndexes(old)[0]], codes[0]];
  const shift = Math.floor((old - newN) / 2);
  return Array.from({ length: newN }, (_, i) => codes[Math.min(Math.max(i + shift, 0), old - 1)]);
}

export interface OwnSlotRow {
  /** "เม็ด 1–2" · "เม็ด 3" · "เม็ด 1–7 (ซ้ายไปขวา)" */
  label: string;
  /** ชื่อพลอย · หรือ "ก · ข · ค" ตามลำดับเม็ดเมื่อสลับสีถี่ */
  value: string;
}

export const OWN_SLOTS_ORDER_NOTE = "รายเม็ด · ซ้ายไปขวา มองตรงหน้าแหวน";
/** จำนวนช่วงสีติดกันสูงสุดที่ยังแตกเป็น 1 บรรทัดต่อช่วง (เกินนี้ = เรียงทีละเม็ดบรรทัดเดียว) */
const MAX_RUN_LINES = 4;

function rangeLabel(from: number, to: number): string {
  return from === to ? `เม็ด ${from}` : `เม็ด ${from}–${to}`;
}

/**
 * A7: จับกลุ่มช่วงสีติดกัน (ซ้าย→ขวา) · ช่วง ≤ 4 → 1 แถวต่อช่วง (สีเดียวทั้งวง = "(ทุกเม็ด)") · ช่วง > 4 → แถวเดียวเรียงทีละเม็ด
 * ค่าไม่ถูกต้อง (ว่าง / รหัสนอก whitelist) = null — ผู้เรียกต้องไม่ส่งข้อความ (ไม่เดา)
 */
export function formatOwnSlots(codes: unknown): OwnSlotRow[] | null {
  if (!Array.isArray(codes) || codes.length === 0 || !isOwnSlots(codes, codes.length)) return null;
  const label = (c: GemQuizStoneCode) => GEM_QUIZ_STONE_BY_CODE[c].labelTh;
  const runs: { from: number; to: number; code: GemQuizStoneCode }[] = [];
  codes.forEach((code, i) => {
    const last = runs[runs.length - 1];
    if (last && last.code === code) last.to = i + 1;
    else runs.push({ from: i + 1, to: i + 1, code });
  });
  if (runs.length > MAX_RUN_LINES) {
    return [{ label: `${rangeLabel(1, codes.length)} (ซ้ายไปขวา)`, value: codes.map(label).join(" · ") }];
  }
  if (runs.length === 1) return [{ label: rangeLabel(1, codes.length), value: `${label(runs[0].code)} (ทุกเม็ด)` }];
  return runs.map((r) => ({ label: rangeLabel(r.from, r.to), value: label(r.code) }));
}

/** บรรทัดข้อความ (LINE) = "เม็ด 1–2: โกเมน" */
export function ownSlotLines(rows: readonly OwnSlotRow[]): string[] {
  return rows.map((r) => `${r.label}: ${r.value}`);
}

/** ข้อความอ่านออกเสียงของ stage (ไม่มีทวิภาค) = "เม็ด 1–2 โกเมน เม็ด 3 …" */
export function ownSlotsAria(rows: readonly OwnSlotRow[]): string {
  return rows.map((r) => `${r.label} ${r.value}`).join(" ");
}
