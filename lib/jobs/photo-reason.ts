// lib/jobs/photo-reason.ts — "เหตุผลที่ลบรูปจากหน้างาน" (ฝั่งออฟฟิศ · UX §6 · มติเจ้าของ 21 ต.ค.: ลบรูปที่ผู้จัดการส่งจากหน้างาน = บังคับเหตุผล)
//
// "มีเหตุผล" = whitelist (บทเรียน oem_note_present · security 0168 M1/L1): ต้องมีตัวอักษร/ตัวเลขจริงอย่างน้อย 1 ตัว — ห้ามเขียน btrim(x) = '' หรือ blacklist ช่องว่างเอง
// (NEL · U+2800 · VS16 · tag · "." · "👍" ล้วน หลุด blacklist ได้เสมอ) · อักขระล่องหน/bidi/ควบคุม = ปฏิเสธ (ชุดเดียวกับที่ action ฝั่งออฟฟิศ + DB ปฏิเสธ — INVISIBLE_RE)
// 🔴 นี่คือ pre-check ของฟอร์มเท่านั้น: ด่านจริงอยู่ที่ action removeJobPhoto (parseText) + analytics.job_text_clean · ตอนนี้ server ยัง "ไม่บังคับ" เหตุผลของรูป shopfloor (ขอ R5 จาก architect) — UI คือด่านเดียวของข้อนี้
// ไม่มีการคิดเงิน · pure (ไม่ import server action)

import { JOB_PHOTO_REASON_MAX } from "@/lib/images/constants";
import { INVISIBLE_MSG, INVISIBLE_RE } from "@/lib/jobs/input";

/** ชิปเหตุผลที่ใช้บ่อย (มติ Q6) — กดแล้วเติมลงช่อง แก้ต่อได้ [ต้องยืนยัน: คำที่ร้านใช้จริง] */
export const SHOP_PHOTO_DELETE_REASON_CHIPS = ["ไม่ใช่ชิ้นงาน", "ภาพไม่ชัด", "ไม่เหมาะสม"] as const;

export const MSG_REASON_REQUIRED = "ใส่เหตุผลก่อนลบ";
export const MSG_REASON_LONG = `เหตุผลยาวเกิน ${JOB_PHOTO_REASON_MAX} ตัวอักษร`;
const CONTROL_RE = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]");
const HAS_REAL_CHAR_RE = new RegExp("[\\p{L}\\p{N}]", "u");

/** null = ใช้ได้ · ไม่ใช่ null = ข้อความไทยที่บอกว่าทำไมยังลบไม่ได้ */
export function photoReasonIssue(raw: unknown): string | null {
  if (typeof raw !== "string") return MSG_REASON_REQUIRED;
  if (INVISIBLE_RE.test(raw) || CONTROL_RE.test(raw.replace(/[\r\n\t]/g, ""))) return INVISIBLE_MSG("เหตุผล");
  if ([...raw].length > JOB_PHOTO_REASON_MAX) return MSG_REASON_LONG;
  if (!HAS_REAL_CHAR_RE.test(raw)) return MSG_REASON_REQUIRED;
  return null;
}
