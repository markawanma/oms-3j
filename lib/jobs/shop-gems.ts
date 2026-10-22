// lib/jobs/shop-gems.ts — กติกาพลอย (pure · ใช้ได้ทั้งหน้างาน ออฟฟิศ และ server action) — G1a
// 🔴 ตัวตัดสินจริงคือ DB (gem_name_norm · gem_name_similar · gem_size_label · gem_label_compose ใน migration 0190) — ไฟล์นี้คือ "ตัวอย่าง/ตัวดักเบื้องต้น" ฝั่งจอ + ด่านซ้ำก่อนถึง DB
//    ต้องขยับพร้อม DB เสมอ: ชุดเคส UX §3.4 อยู่ทั้งใน verify-0190.sql (N1-N17) และ shop-gems.test.ts (parity) · ผลต่างขอบๆ ของ Unicode (NBSP/สัญลักษณ์แปลก) ให้ถือ DB เป็นหลัก
// ไม่มีราคา/ต้นทุน/เผื่อแตกในไฟล์นี้ — จำนวนเต็ม × จำนวนเต็มเท่านั้น (ไม่มีปัดเศษ — UX P10)

import { stripInvisibleText } from "@/lib/oem/display";

/** เพดานกติกา (ตรงกับ DB 0190: gem_name_ok · CHECK ขนาด · qty 1-1000 · ≤ 30 แถว · ตำแหน่ง ≤ 40 · เหตุผล ≤ 300) */
export const GEM_LIMITS = {
  nameMin: 2,
  nameMax: 40,
  sizeMax: 100,
  /** > ค่านี้ขึ้นกล่องเตือน "ตรวจว่าเป็นมิลลิเมตร" (ไม่บล็อก — ผู้ใช้ติ๊กยืนยัน) */
  sizeWarn: 30,
  sizeDecimals: 2,
  qtyMax: 1000,
  linesMax: 30,
  positionMax: 40,
  reasonMax: 300,
} as const;

/** กุญแจเทียบชื่อซ้ำ — ตรงกับ analytics.gem_name_norm: ลบอักขระล่องหน → NFKC → ตัวเล็ก → ลบช่องว่าง/วรรคตอน/สัญลักษณ์ (สระ/วรรณยุกต์ไทยอยู่) */
export function normalizeGemName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return stripInvisibleText(raw).normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

/** ระยะแก้ไขต่ออักขระ (code point) — ตรงกับ analytics.gem_name_lev */
export function gemNameDistance(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  if (x.length === 0) return y.length;
  if (y.length === 0) return x.length;
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1)));
    }
    prev = cur;
  }
  return prev[y.length];
}

/**
 * "คล้าย" ตรงกับ analytics.gem_name_similar: norm เท่ากัน หรือ (ชื่อสั้นสุด > 3 ตัวอักษร และห่างกันไม่เกิน 3 ตัว และระยะแก้ไข ≤ 1 เมื่อยาว ≤ 5 · ≤ 2 เมื่อยาว ≤ 7 · ≤ 3 เมื่อยาวกว่านั้น)
 * ชื่อสั้น ≤ 3 ตัวอักษร: เทียบเฉพาะ "เท่ากันหลัง normalize" (กัน CZ↔AZ เตือนมั่ว) · จับไม่ได้ (รู้และยอมรับ): ไทย↔อังกฤษ · คำพ้อง
 */
export function gemNameSimilar(a: unknown, b: unknown): boolean {
  const na = normalizeGemName(a);
  const nb = normalizeGemName(b);
  if (na === "" || nb === "") return false;
  if (na === nb) return true;
  const la = Array.from(na).length;
  const lb = Array.from(nb).length;
  const min = Math.min(la, lb);
  const max = Math.max(la, lb);
  if (min <= 3) return false;
  if (max - min > 3) return false;
  return gemNameDistance(na, nb) <= (max <= 5 ? 1 : max <= 7 ? 2 : 3);
}

export interface NamedRow {
  id: string;
  name: string;
}

/**
 * หาชื่อที่ "ซ้ำเป๊ะหลัง normalize" (exact — ใช้ตัวเดิมให้เลย ไม่ต้องถาม) กับ "คล้าย" (ถามผู้ใช้) จากรายการที่มี
 * server ตัดสินจริงซ้ำเสมอ — ฟังก์ชันนี้แค่ให้จอเตือนก่อนส่ง
 */
export function findSimilarGemNames(name: string, existing: readonly NamedRow[], limit = 3): { exact: NamedRow | null; similar: NamedRow[] } {
  const n = normalizeGemName(name);
  if (n === "") return { exact: null, similar: [] };
  let exact: NamedRow | null = null;
  const similar: NamedRow[] = [];
  for (const row of existing) {
    const rn = normalizeGemName(row.name);
    if (rn === n) {
      exact = exact ?? row;
    } else if (gemNameSimilar(name, row.name)) {
      similar.push(row);
    }
  }
  return { exact, similar: similar.slice(0, limit) };
}

export type GemNameCheck = { ok: true; value: string } | { ok: false; code: "name_invalid"; message: string };
const NAME_MSG = "ชื่อต้องมี 2-40 ตัวอักษร ไม่ใช่ตัวเลขล้วน และห้ามมีเครื่องหมาย < >";

/** ตัดหัวท้าย · ยุบช่องว่างซ้ำ · ผ่านกติกาเดียวกับ DB (gem_name_ok) — ล้ม = name_invalid (ข้อความไทย) */
export function cleanGemName(raw: unknown): GemNameCheck {
  if (typeof raw !== "string") return { ok: false, code: "name_invalid", message: NAME_MSG };
  const hasControl = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\t\r\n]/.test(raw);
  const stripped = stripInvisibleText(raw);
  if (hasControl || stripped !== raw) return { ok: false, code: "name_invalid", message: NAME_MSG };
  const v = raw.replace(/[\s 　]+/g, " ").trim();
  const norm = normalizeGemName(v);
  const len = Array.from(v).length;
  if (len < GEM_LIMITS.nameMin || len > GEM_LIMITS.nameMax || /[<>]/.test(v) || !/[\p{L}\p{N}]/u.test(v) || Array.from(norm).length < 2 || /^[0-9]+$/.test(norm)) {
    return { ok: false, code: "name_invalid", message: NAME_MSG };
  }
  return { ok: true, value: v };
}

export type GemSizeParse = { ok: true; value: number } | { ok: false; message: string };
const SIZE_MSG = "ขนาดต้องเป็นตัวเลขมากกว่า 0 ไม่เกิน 100 มม. (ทศนิยมไม่เกิน 2 ตำแหน่ง)";

/** ขนาด (มม.): รับ "," เป็น "." · > 0 และ ≤ 100 · ทศนิยม ≤ 2 (ไม่ปัดเงียบ) · ไม่รับ NaN/Infinity/เลขยกกำลัง */
export function parseGemSize(raw: unknown): GemSizeParse {
  const text = typeof raw === "number" ? (Number.isFinite(raw) ? String(raw) : "") : typeof raw === "string" ? raw.trim().replace(",", ".") : "";
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(text)) return { ok: false, message: SIZE_MSG };
  const n = Number(text);
  if (!(n > 0 && n <= GEM_LIMITS.sizeMax)) return { ok: false, message: SIZE_MSG };
  return { ok: true, value: n };
}

/** รูปทรง 2 ค่า: เรียงกว้าง ≤ ยาว (unique ต้อง normalize) · รูปทรง 1 ค่า: b = null — คืน swapped ให้จอบอก "เรียงเป็น 4×6 ให้" */
export function normalizeGemSizes(a: number, b: number | null, hasLength: boolean): { a: number; b: number | null; swapped: boolean } {
  if (!hasLength || b === null) return { a, b: null, swapped: false };
  return a <= b ? { a, b, swapped: false } : { a: b, b: a, swapped: true };
}

export const gemSizeNeedsConfirm = (a: number, b: number | null): boolean => a > GEM_LIMITS.sizeWarn || (b !== null && b > GEM_LIMITS.sizeWarn);

/** "4×6" · "1.5" (ตัดศูนย์ท้าย) — ตรงกับ analytics.gem_size_label */
export function gemSizeLabel(a: number, b: number | null): string {
  const t = (n: number) => String(Number(n.toFixed(2)));
  return b === null ? t(a) : `${t(a)}×${t(b)}`;
}

/** "โกเมน · ไข่ · 4×6 มม." — ตัวอย่างระหว่างกรอกเท่านั้น (ค่า DB ชนะหลังบันทึก — gem_label_compose) */
export const gemLabelPreview = (typeName: string, shapeName: string, a: number, b: number | null): string => `${typeName} · ${shapeName} · ${gemSizeLabel(a, b)} มม.`;

/** รวมทั้งใบ = จำนวน/ชิ้น × จำนวนที่จะเริ่มผลิต (จำนวนเต็ม × จำนวนเต็ม ไม่มีปัดเศษ — UX P10) · DB คำนวณซ้ำตอนบันทึกและค่า DB ชนะ */
export function gemTotals(rows: readonly { qtyPerPiece: number }[], qtyPlanned: number): { lineTotals: number[]; total: number } {
  const lineTotals = rows.map((r) => r.qtyPerPiece * qtyPlanned);
  return { lineTotals, total: lineTotals.reduce((s, n) => s + n, 0) };
}

/**
 * รวมแถวซ้ำ (key เดียวกัน): บวกจำนวน/ชิ้น · ตำแหน่งต่อกันด้วย ", " ตัดซ้ำ — จอต้องให้ผู้ใช้กด "รวมเข้าแถว n" เอง ไม่รวมเงียบๆ (ฟังก์ชันนี้คือตัวรวมที่กดแล้วเรียก)
 * server รวมแถวซ้ำซ้ำอีกชั้นเสมอ (เกิน 1,000 = ปฏิเสธ qty_invalid)
 */
export function mergeDuplicateGemRows<T extends { qtyPerPiece: number; position?: string | null }>(rows: readonly T[], key: (r: T) => string): T[] {
  const out: T[] = [];
  const at = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    const i = at.get(k);
    if (i === undefined) {
      at.set(k, out.length);
      out.push({ ...r });
      continue;
    }
    const prev = out[i];
    const pos = [...(prev.position ?? "").split(", "), r.position ?? ""].filter((p) => p !== "");
    out[i] = { ...prev, qtyPerPiece: prev.qtyPerPiece + r.qtyPerPiece, position: [...new Set(pos)].join(", ") || null };
  }
  return out;
}
