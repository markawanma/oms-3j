// lib/ring-builder/util.ts — ตัวช่วงเล็กๆ ที่ใช้ร่วมทั้ง server/client (pure · ไม่มี import) — ที่เดียว ไม่ให้แต่ละไฟล์เขียนซ้ำคนละแบบ

export type Raw = Record<string, unknown>;

export const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

/** จำนวนเต็มปลอดภัยในช่วง [lo, hi] — NaN/Infinity/ทศนิยม/สตริง = false */
export const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

/** ความยาวนับเป็น code point (ตรงกับ char_length ของ Postgres — ไม่ใช่ UTF-16 unit ของ .length) */
export function cpLength(s: string): number {
  let n = 0;
  for (const _ of s) n++; // eslint-disable-line @typescript-eslint/no-unused-vars
  return n;
}

/** "฿1,250" — จัดรูปแสดงผลอย่างเดียว ไม่คำนวณ (en-US ให้ผลเหมือนกันทุกเครื่อง) */
export function formatBaht(n: number): string {
  return `฿${n.toLocaleString("en-US")}`;
}
