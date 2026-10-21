// lib/jobs/photo-reason.ts — "เหตุผลที่ลบรูปจากหน้างาน" (ฝั่งออฟฟิศ · UX §6 · มติเจ้าของ 21 ต.ค.: ลบรูปที่ผู้จัดการส่งจากหน้างาน = บังคับเหตุผล)
//
// "มีเหตุผล" = whitelist (บทเรียน oem_note_present · security 0168 M1/L1): ต้องมีตัวอักษร/ตัวเลขจริงอย่างน้อย 1 ตัว — ห้ามเขียน btrim(x) = '' หรือ blacklist ช่องว่างเอง
// (NEL · U+2800 · VS16 · tag · "." · "👍" ล้วน หลุด blacklist ได้เสมอ) · อักขระล่องหน/bidi/ควบคุม = ปฏิเสธ (ชุดเดียวกับที่ action ฝั่งออฟฟิศ + DB ปฏิเสธ — INVISIBLE_RE)
// 🔴 นี่คือ pre-check ของฟอร์ม: ด่านจริงอยู่ที่ DB (job_photo_remove 0189: รูป shopfloor ต้องมีเหตุผล ≥ 2 ตัว + มีตัวอักษร/ตัวเลขจริง · hint reason_required) + job_text_clean — เช็คให้ตรงกันเพื่อไม่ให้ server ตีกลับ
// ไม่มีการคิดเงิน · pure (ไม่ import server action)

import { JOB_PHOTO_REASON_MAX } from "@/lib/images/constants";
import { INVISIBLE_MSG, INVISIBLE_RE } from "@/lib/jobs/input";

/** ชิปเหตุผลที่ใช้บ่อย (มติ Q6) — กดแล้วเติมลงช่อง แก้ต่อได้ [ต้องยืนยัน: คำที่ร้านใช้จริง] */
export const SHOP_PHOTO_DELETE_REASON_CHIPS = ["ไม่ใช่ชิ้นงาน", "ภาพไม่ชัด", "ไม่เหมาะสม"] as const;

export const MSG_REASON_REQUIRED = "ใส่เหตุผลก่อนลบ";
/** ขั้นต่ำที่ DB บังคับ (analytics.job_photo_remove · reason_required) */
export const REASON_MIN = 2;
export const MSG_REASON_SHORT = `เหตุผลสั้นเกินไป (อย่างน้อย ${REASON_MIN} ตัวอักษร)`;
export const MSG_REASON_LONG = `เหตุผลยาวเกิน ${JOB_PHOTO_REASON_MAX} ตัวอักษร`;
const CONTROL_RE = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]");
const HAS_REAL_CHAR_RE = new RegExp("[\\p{L}\\p{N}]", "u");

/** null = ใช้ได้ · ไม่ใช่ null = ข้อความไทยที่บอกว่าทำไมยังลบไม่ได้ */
export function photoReasonIssue(raw: unknown): string | null {
  if (typeof raw !== "string") return MSG_REASON_REQUIRED;
  if (INVISIBLE_RE.test(raw) || CONTROL_RE.test(raw.replace(/[\r\n\t]/g, ""))) return INVISIBLE_MSG("เหตุผล");
  if ([...raw].length > JOB_PHOTO_REASON_MAX) return MSG_REASON_LONG;
  if (!HAS_REAL_CHAR_RE.test(raw)) return MSG_REASON_REQUIRED;
  // DB (job_photo_remove · 0189): หลัง trim ต้องยาว ≥ 2 ตัว (reason_required) — เช็คตรงกัน ไม่ให้กดลบแล้วโดน server ตีกลับ
  if ([...raw.trim()].length < REASON_MIN) return MSG_REASON_SHORT;
  return null;
}
