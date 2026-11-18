// lib/ring-builder/code.ts — รหัสสั่งทำ "3JR-…" แบบ stateless (pure · ไม่มี secret · ไม่แตะ DB) — design §2 + §16
// bit layout (บิต → Crockford base32 ตัวพิมพ์ใหญ่ + check char 1 ตัวท้าย · ขีดทุก 5 ตัวเป็นการแสดงผล):
//   ver 4 · design_no 12 · size_idx 5 (0..23 = เบอร์ 45..68 · 31 = ให้แอดมินเช็ก) · n 3 (3..7) · positions 10×n (stone_no · 0 = CZ ขาว)
//   · total_thb 18 · priced_at 31 (วินาทีนับจาก 2026-01-01Z) · tag 60 (HMAC — ทำใน code-sign.ts) · บิตเติมท้ายต้องเป็น 0
// check char = Luhn mod 32 บนตัวอักษร payload+tag — ไม่ใช่ด่านความปลอดภัย (ใครก็คำนวณได้) · มีไว้แยก "พิมพ์ผิด" ออกจาก "ปลอม" · ความปลอดภัย = HMAC
// ⚠️ จุดบอดที่รู้: Luhn mod 32 จับสลับตัวติดกันได้ทุกคู่ ยกเว้นคู่ "0" กับ "Z" (index 0 และ 31) — คู่นั้นไปตกที่ HMAC (ไม่ใช่ช่องโหว่)
import { CODE_PREFIX, MAX_DESIGN_NO, MAX_STONE_NO, MAX_STONES, MAX_TOTAL_THB, MIN_STONES, PRICE_EPOCH_MS, RING_BUILDER_SIZES, SIZE_ADMIN_CHECK_IDX } from "./config";
import { isInt } from "./util";

export const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_VERSION = 1;
export const TAG_BITS = 60;
const MAX_PRICED_AT = 2 ** 31 - 1;

export interface CodeFields {
  designNo: number;
  /** null = "ให้แอดมินช่วยเช็กไซซ์" */
  size: number | null;
  positions: number[];
  totalThb: number;
  /** วินาทีนับจาก PRICE_EPOCH_MS */
  pricedAtSec: number;
}

/** บิตของ payload (ไม่รวม tag) ยาว 73 + 10n */
export function payloadBitLength(n: number): number {
  return 73 + 10 * n;
}

function toBits(value: number, width: number): string {
  return value.toString(2).padStart(width, "0");
}


export type PackResult = { ok: true; bits: string } | { ok: false; reason: "design_no" | "size" | "count" | "stone_no" | "total" | "priced_at" };

export function packPayload(f: CodeFields): PackResult {
  if (!isInt(f.designNo, 1, MAX_DESIGN_NO)) return { ok: false, reason: "design_no" };
  if (f.size !== null && !isInt(f.size, RING_BUILDER_SIZES.min, RING_BUILDER_SIZES.max)) return { ok: false, reason: "size" };
  if (!Array.isArray(f.positions) || !isInt(f.positions.length, MIN_STONES, MAX_STONES)) return { ok: false, reason: "count" };
  if (!f.positions.every((p) => isInt(p, 0, MAX_STONE_NO))) return { ok: false, reason: "stone_no" };
  if (!isInt(f.totalThb, 0, MAX_TOTAL_THB)) return { ok: false, reason: "total" };
  if (!isInt(f.pricedAtSec, 0, MAX_PRICED_AT)) return { ok: false, reason: "priced_at" };
  const sizeIdx = f.size === null ? SIZE_ADMIN_CHECK_IDX : f.size - RING_BUILDER_SIZES.min;
  const bits =
    toBits(CODE_VERSION, 4) + toBits(f.designNo, 12) + toBits(sizeIdx, 5) + toBits(f.positions.length, 3) +
    f.positions.map((p) => toBits(p, 10)).join("") + toBits(f.totalThb, 18) + toBits(f.pricedAtSec, 31);
  return { ok: true, bits };
}

// ---------------------------------------------------------------------------
// Luhn mod 32 (Wikipedia "Luhn mod N") บนดัชนีตัวอักษรใน ALPHABET
// ---------------------------------------------------------------------------
export function checkChar(chars: string): string {
  let factor = 2;
  let sum = 0;
  for (let i = chars.length - 1; i >= 0; i--) {
    const cp = ALPHABET.indexOf(chars[i]);
    let addend = factor * cp;
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / 32) + (addend % 32);
    sum += addend;
  }
  return ALPHABET[(32 - (sum % 32)) % 32];
}

export function checkCharValid(charsWithCheck: string): boolean {
  let factor = 1;
  let sum = 0;
  for (let i = charsWithCheck.length - 1; i >= 0; i--) {
    const cp = ALPHABET.indexOf(charsWithCheck[i]);
    if (cp < 0) return false;
    let addend = factor * cp;
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / 32) + (addend % 32);
    sum += addend;
  }
  return sum % 32 === 0;
}

export function bitsToChars(bits: string): string {
  const padded = bits.padEnd(Math.ceil(bits.length / 5) * 5, "0");
  let out = "";
  for (let i = 0; i < padded.length; i += 5) out += ALPHABET[Number.parseInt(padded.slice(i, i + 5), 2)];
  return out;
}

/** bit string → ไบต์ (เติม 0 ท้ายให้ครบไบต์) — ใช้ประกอบข้อความที่ HMAC เซ็น */
export function bitsToBytes(bits: string): Uint8Array {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i] === "1") out[i >> 3] |= 0x80 >> (i & 7);
  return out;
}

/** แสดงผล: prefix + ขีดทุก 5 ตัว (ตัวอักษร = payload+tag+check) */
export function formatCode(chars: string): string {
  return CODE_PREFIX + (chars.match(/.{1,5}/g) ?? []).join("-");
}

/** payload bits + tag bits → รหัสที่แสดง (canonical เสมอ) */
export function encodeCode(payloadBits: string, tagBits: string): string {
  const body = bitsToChars(payloadBits + tagBits);
  return formatCode(body + checkChar(body));
}

export type DecodeFail = "empty" | "prefix" | "alphabet" | "too_short" | "check_char" | "version" | "design_no" | "size_idx" | "count" | "length" | "padding";
export type DecodeResult =
  | { ok: true; fields: CodeFields; payloadBits: string; tagBits: string; canonical: string }
  | { ok: false; reason: DecodeFail };

function normalize(text: string): string {
  return text.toUpperCase().replace(/[\s-]+/g, "");
}

/** ถอดรหัส: ตัดช่องว่าง/ขีด · ตัวเล็ก→ใหญ่ · I/L→1 · O→0 · ตัวอักษรนอกชุด (รวม U) = ปฏิเสธ · ตรวจ check char ก่อนอ่านบิต */
export function decodeCode(text: string): DecodeResult {
  if (typeof text !== "string" || text.trim() === "") return { ok: false, reason: "empty" };
  const norm = normalize(text);
  if (!norm.startsWith("3JR")) return { ok: false, reason: "prefix" };
  const rest = norm.slice(3).replace(/[IL]/g, "1").replace(/O/g, "0");
  if (rest.length < 3) return { ok: false, reason: "too_short" };
  for (const ch of rest) if (ALPHABET.indexOf(ch) < 0) return { ok: false, reason: "alphabet" };
  if (!checkCharValid(rest)) return { ok: false, reason: "check_char" };
  const body = rest.slice(0, -1);
  let bits = "";
  for (const ch of body) bits += toBits(ALPHABET.indexOf(ch), 5);
  if (bits.length < 4 + 12 + 5 + 3) return { ok: false, reason: "too_short" };

  let at = 0;
  const take = (w: number): number => {
    const v = Number.parseInt(bits.slice(at, at + w), 2);
    at += w;
    return v;
  };
  if (take(4) !== CODE_VERSION) return { ok: false, reason: "version" };
  const designNo = take(12);
  if (designNo < 1 || designNo > MAX_DESIGN_NO) return { ok: false, reason: "design_no" };
  const sizeIdx = take(5);
  let size: number | null;
  if (sizeIdx === SIZE_ADMIN_CHECK_IDX) size = null;
  else if (sizeIdx <= RING_BUILDER_SIZES.max - RING_BUILDER_SIZES.min) size = RING_BUILDER_SIZES.min + sizeIdx;
  else return { ok: false, reason: "size_idx" };
  const n = take(3);
  if (n < MIN_STONES || n > MAX_STONES) return { ok: false, reason: "count" };
  const totalBits = payloadBitLength(n) + TAG_BITS;
  if (Math.ceil(totalBits / 5) !== body.length) return { ok: false, reason: "length" };
  if (/1/.test(bits.slice(totalBits))) return { ok: false, reason: "padding" };
  const positions: number[] = [];
  for (let i = 0; i < n; i++) positions.push(take(10));
  const totalThb = take(18);
  const pricedAtSec = take(31);
  const tagBits = bits.slice(at, at + TAG_BITS);
  const payloadBits = bits.slice(0, payloadBitLength(n));
  return { ok: true, fields: { designNo, size, positions, totalThb, pricedAtSec }, payloadBits, tagBits, canonical: formatCode(body + rest.slice(-1)) };
}

const MAX_TOKENS = 14;
const TOKEN_RE = /^[-\s]+([0-9A-Za-z]+)/;

/**
 * S11: หา "3JR" ในข้อความแล้วเก็บกลุ่มตัวอักษรที่ตามมา — คั่นด้วยขีด ช่องว่าง หรือขึ้นบรรทัดใหม่ก็ได้ (LINE ตัดบรรทัดกลางรหัสได้)
 * หยุดเมื่อเจอตัวอักษรอื่น (เช่นข้อความไทย) · ต้องมีตัวคั่นหลัง 3JR (ไม่จับ "3JRX" ที่เป็นคำอื่น) · คืนรายการ token ต่อหนึ่งตำแหน่งที่เจอ
 */
function codeTokenRuns(text: string): string[][] {
  const out: string[][] = [];
  const re = /3JR(?=[-\s])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let rest = text.slice(m.index + 3, m.index + 3 + 160);
    const tokens: string[] = [];
    for (;;) {
      if (tokens.length >= MAX_TOKENS) break;
      const t = TOKEN_RE.exec(rest);
      if (!t) break;
      tokens.push(t[1]);
      rest = rest.slice(t[0].length);
    }
    if (tokens.length > 0) out.push(tokens);
  }
  return out;
}

/** ผลถอดรหัสจากข้อความทั้งก้อน — ลองสะสมกลุ่มทีละกลุ่ม (กันคำภาษาอังกฤษท้ายรหัสถูกกลืนเข้าไป) · ไม่เจอ 3JR = not_found · ว่าง = empty */
export function decodeFromText(text: string): DecodeResult | { ok: false; reason: "empty" | "not_found" } {
  if (typeof text !== "string" || text.trim() === "") return { ok: false, reason: "empty" };
  const runs = codeTokenRuns(text);
  if (runs.length === 0) return { ok: false, reason: "not_found" };
  let firstFail: DecodeResult | null = null;
  for (const tokens of runs) {
    for (let k = tokens.length; k >= 1; k--) {
      const d = decodeCode("3JR-" + tokens.slice(0, k).join(""));
      if (d.ok) return d;
      if (firstFail === null && k === tokens.length) firstFail = d;
    }
  }
  return firstFail ?? { ok: false, reason: "not_found" };
}

/** รหัสที่ดึงได้จากข้อความ (ตามลำดับที่เจอ · ไม่ซ้ำ) — ถอดได้ = canonical · ถอดไม่ได้ = "3JR-" + กลุ่มทั้งหมดที่ตามมา */
export function extractCodes(text: string): string[] {
  if (typeof text !== "string") return [];
  const out: string[] = [];
  for (const tokens of codeTokenRuns(text)) {
    let best = "3JR-" + tokens.join("");
    for (let k = tokens.length; k >= 1; k--) {
      const d = decodeCode("3JR-" + tokens.slice(0, k).join(""));
      if (d.ok) {
        best = d.canonical;
        break;
      }
    }
    out.push(best);
  }
  return [...new Set(out)];
}

export function pricedAtToSec(iso: string): number | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const sec = Math.floor((ms - PRICE_EPOCH_MS) / 1000);
  return sec >= 0 && sec <= MAX_PRICED_AT ? sec : null;
}

export function secToIso(sec: number): string {
  return new Date(PRICE_EPOCH_MS + sec * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}
