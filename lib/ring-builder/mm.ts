// lib/ring-builder/mm.ts — มม. ⇄ จำนวนเต็ม 1/100 มม. (mm100) · pure
// ห้ามใช้ parseFloat/Number("2.5") กับค่าที่กรอก: เทียบ/เก็บเป็นจำนวนเต็มเท่านั้น (float ในตัวเลขที่เป็น key = กับดัก — design §16)
// รูปแบบที่รับ: ^\d{1,2}(\.\d{1,2})?$ (จุดเท่านั้น — "2,5" ปฏิเสธเพราะกำกวม) · ช่วง 0.50–20.00 มม. (50–2000)
// ขนาดพลอย: "กว้าง×ยาว" รับ × x X * หรือเลขเดียว (2 = 2×2) · canonical: major ≥ minor เสมอ (4×3 = 3×4)

import { MM100_MAX, MM100_MIN } from "./config";
export { MM100_MAX, MM100_MIN };

const MM_RE = /^(\d{1,2})(?:\.(\d{1,2}))?$/;

/** สตริงมม. → mm100 หรือ null (รูปแบบผิด/นอกช่วง) */
export function parseMm100(input: unknown): number | null {
  if (typeof input !== "string") return null;
  const m = MM_RE.exec(input.trim());
  if (!m) return null;
  const whole = Number.parseInt(m[1], 10);
  const frac = m[2] === undefined ? 0 : Number.parseInt(m[2].padEnd(2, "0"), 10);
  const v = whole * 100 + frac;
  return v >= MM100_MIN && v <= MM100_MAX ? v : null;
}

export type StoneSizeParse = { ok: true; major: number; minor: number } | { ok: false; reason: "empty" | "format" | "range" };

export function parseStoneSize(input: unknown): StoneSizeParse {
  if (typeof input !== "string" || input.trim() === "") return { ok: false, reason: "empty" };
  const parts = input.trim().split(/[x×*]/i);
  if (parts.length > 2) return { ok: false, reason: "format" };
  const vals: number[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (!MM_RE.test(t)) return { ok: false, reason: "format" };
    const v = parseMm100(t);
    if (v === null) return { ok: false, reason: "range" };
    vals.push(v);
  }
  const a = vals[0];
  const b = vals.length === 2 ? vals[1] : vals[0];
  return { ok: true, major: Math.max(a, b), minor: Math.min(a, b) };
}

/** mm100 → "2" · "2.5" · "2.05" (ไม่มีศูนย์ท้าย) */
export function formatMm100(n: number): string {
  const whole = Math.trunc(n / 100);
  const frac = n % 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

/** ป้ายขนาดพลอย "4×3" — ประกอบที่ server ที่เดียวให้ป้าย/การ์ด/รูป/ข้อความ LINE ตรงกัน */
export function stoneLabel(major: number, minor: number): string {
  return `${formatMm100(major)}×${formatMm100(minor)}`;
}
