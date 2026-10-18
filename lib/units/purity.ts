// lib/units/purity.ts — ตัวแปลงหน่วย "ความบริสุทธิ์/เนื้อโลหะ" ที่ขอบ UI เท่านั้น
// (มติเจ้าของ 18 ต.ค. 69: "กรอกเนื้อเงินเป็น % ทศนิยมไม่เกิน 2 ตำแหน่ง" เช่น 92.50)
//
// 🔴 หลักการ: DB / server action / RPC ยังเป็น "สัดส่วน 0..1" ทุกตัว (0.925) — ไม่มี migration
//    ฟอร์มทุกหน้าต้องแปลงผ่านไฟล์นี้ไฟล์เดียว ห้ามเขียน `/100` `*100` กระจายตามฟอร์ม
//    (ค่าที่ลืมแปลงจุดเดียว = เนื้อเงิน 92.5 เท่า หรือ 0.00925 → ราคา/ต้นทุนเพี้ยนโดยไม่มีใครรู้)
//
// ไม่ใช่การคิดเงิน — แค่แปลงหน่วยของค่าที่ผู้ใช้กรอก (oem-quote-invariants ข้อ 2 ไม่ถูกแตะ)

/** ข้อความแนะนำรูปแบบ — ใช้เป็น placeholder/ข้อความ error เมื่อกรอกผิดหน่วย */
export const PURITY_PCT_EXAMPLE = "92.50";

// รูปร่างที่ยอมรับ: ตัวเลขล้วน + จุดได้ 1 ตัว (ต้องมีอย่างน้อย 1 หลัก) — "92." ผ่านเพื่อไม่ให้ error วูบระหว่างพิมพ์
// ไม่รับ เครื่องหมาย/เลขยกกำลัง/ช่องว่างกลาง/ลูกน้ำ/% — ทุกอย่างที่ Number() ตีความได้แต่ไม่ใช่ % ที่ตั้งใจพิมพ์
const PCT_SHAPE = /^(\d*)(?:\.(\d*))?$/;

/**
 * เนื้อโลหะต่ำสุดที่ร้านรับ = ทอง 9K = 37.50% (มติเจ้าของ 18 ต.ค. 69; security M1 — เดิม 1% กว้างเกิน:
 * พิมพ์ตกหลัก 9.25 หรือ "1" แทน "100" ผ่านด่านแล้วต้นทุน/ราคาเพี้ยนเงียบๆ) · ต่ำกว่านี้บล็อกทุกกรณี
 * ด่านนี้เป็นของฝั่ง UI เท่านั้น — ด่านขั้นต่ำฝั่ง DB ยังไม่มี (หนี้ที่บันทึกแล้ว)
 */
const MIN_PCT = 37.5;
const MAX_PCT = 100;

const MSG_LOOKS_LIKE_FRACTION = `กรอกเป็น % เช่น ${PURITY_PCT_EXAMPLE} (ไม่ใช่สัดส่วน 0.925)`;
const MSG_ONE_PCT = "ถ้าหมายถึงเนื้อเต็มให้กรอก 100";
const MSG_BELOW_MIN = "เนื้อโลหะต่ำกว่า 37.50% — ตรวจว่าพิมพ์ตกหลักไหม";

type Parsed = { ok: true; basisPoints: number } | { ok: false; error: string };

/** basisPoints = % × 100 เป็นจำนวนเต็ม (92.50% → 9250) — แยกจากสตริงตรงๆ ไม่ผ่าน float */
function parsePct(input: string): Parsed {
  const s = input.trim();
  const m = PCT_SHAPE.exec(s);
  if (!m || !/\d/.test(s)) return { ok: false, error: `กรอกเป็นตัวเลข % เช่น ${PURITY_PCT_EXAMPLE}` };
  // ลำดับสำคัญ: เช็คช่วงก่อนเช็คจำนวนทศนิยม — "0.925" ต้องได้ข้อความ "กรอกเป็น % เช่น 92.50"
  // ไม่ใช่ "ทศนิยมเกิน 2 ตำแหน่ง" · Number() ใช้เทียบช่วงเท่านั้น (ไม่ได้ใช้คำนวณค่าที่ส่งออก)
  const approx = Number(s);
  if (approx < 1) return { ok: false, error: MSG_LOOKS_LIKE_FRACTION }; // พิมพ์เป็นสัดส่วนเดิม (0.925 / 0.5 / 0)
  if (approx === 1) return { ok: false, error: MSG_ONE_PCT }; // "1" "1.0" "1.00" — มักตั้งใจพิมพ์ 100 (หรือสัดส่วน 1)
  if (approx < MIN_PCT) return { ok: false, error: MSG_BELOW_MIN };
  if (approx > MAX_PCT) return { ok: false, error: "ต้องไม่เกิน 100%" };
  const fracDigits = m[2] ?? "";
  if (fracDigits.length > 2) return { ok: false, error: `ทศนิยมไม่เกิน 2 ตำแหน่ง เช่น ${PURITY_PCT_EXAMPLE}` };
  const basisPoints = Number(m[1] || "0") * 100 + Number(fracDigits.padEnd(2, "0"));
  return { ok: true, basisPoints };
}

/**
 * ข้อความ error ภาษาไทยของช่อง % — null = ใช้ได้ **หรือว่างเปล่า** (ช่องว่างไม่ใช่ error ในตัวมันเอง;
 * ฟอร์มที่บังคับกรอก เช่น ทอง ต้องเช็คว่างเองก่อน)
 */
export function purityPctIssue(input: string): string | null {
  if (input.trim() === "") return null;
  const p = parsePct(input);
  return p.ok ? null : p.error;
}

/**
 * "92.50" → 0.925 (ทศนิยม 4 ตำแหน่ง) · ว่าง → null · ไม่ผ่านกติกา → null (ไม่ปัดเงียบ)
 * ผู้เรียกที่ต้องแยก "ว่าง" ออกจาก "ผิด" ให้เช็ค `input.trim() === ""` / purityPctIssue ก่อน
 */
export function purityPctToFraction(input: string): number | null {
  if (input.trim() === "") return null;
  const p = parsePct(input);
  return p.ok ? p.basisPoints / 10_000 : null;
}

/** 0.925 → "92.50" (2 ตำแหน่งเสมอ) · null/NaN → "" — ใช้เติมค่าเดิมลงช่อง/แสดงผลโดยไม่มีหน่วย */
export function purityFractionToPct(f: number | null | undefined): string {
  if (f == null || !Number.isFinite(f)) return "";
  // ผ่านจำนวนเต็ม basis point ก่อน toFixed กัน 92.575 ตกเป็น 92.57 เพราะ float
  return (Math.round(f * 10_000) / 100).toFixed(2);
}

/** สำหรับแสดงผล read-only: 0.925 → "92.50%" · null → "—" */
export function formatPurityPct(f: number | null | undefined): string {
  const s = purityFractionToPct(f);
  return s === "" ? "—" : `${s}%`;
}

/**
 * ค่าที่จะส่งเข้า server action จากช่องที่เติมจากค่าเดิมใน DB:
 * ถ้าผู้ใช้ "ไม่แตะ" ช่อง (สตริงยังเท่ากับที่ purityFractionToPct(original) เติมไว้) → ส่ง original กลับ **เป๊ะ**
 * ไม่ผ่านการปัด — กันค่าเดิมที่ละเอียดเกิน 4 ตำแหน่ง (เช่น 0.92575) ถูกเขียนทับเป็น 0.9258 เงียบๆ
 * แตะแล้ว → แปลงปกติด้วย purityPctToFraction
 */
export function purityFractionFromForm(input: string, original: number | null | undefined): number | null {
  if (isPurityUntouched(input, original)) return original as number;
  return purityPctToFraction(input);
}

/** ช่องยังเป็นค่าที่เติมจาก original อยู่ (ผู้ใช้ไม่ได้แก้) */
function isPurityUntouched(input: string, original: number | null | undefined): boolean {
  return original != null && Number.isFinite(original) && input.trim() === purityFractionToPct(original);
}

/** คู่กับ purityFractionFromForm — ช่องที่ไม่ได้แตะไม่ถูกตรวจซ้ำ (ค่าเดิมใน DB ไม่ใช่ความผิดของผู้ใช้) */
export function purityFormIssue(input: string, original: number | null | undefined): string | null {
  return isPurityUntouched(input, original) ? null : purityPctIssue(input);
}
