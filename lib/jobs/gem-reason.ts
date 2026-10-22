// lib/jobs/gem-reason.ts — เหตุผลที่แก้พลอยหลังขั้นฝังรับ (office เท่านั้น — ใช้ lib/oem/display ซึ่งห้ามอยู่ในกราฟหน้าช่าง จึงแยกจาก gem-draft.ts)

import { approvalNoteIssue, oemNotePresent } from "@/lib/oem/display";
import { GEM_LIMITS } from "@/lib/jobs/shop-gems";

/**
 * เหตุผลที่แก้พลอยหลังขั้นฝังรับ (pre-check ฝั่งจอ · DB ตัดสินซ้ำ) — whitelist เดียวกับ DB: ต้องมีตัวอักษร/ตัวเลขจริง (oemNotePresent) และห้ามมีอักขระควบคุม/ล่องหน/bidi ปนอยู่เลย
 * (oem_note_valid — เหตุผล "x" ที่มี ZWSP ปนถูก DB ปฏิเสธ จอต้องบอกก่อนส่ง ไม่ใช่รอข้อความงงจาก DB) · ยาว ≤ 300 · null = ใช้ได้
 */
export function gemReasonIssue(text: string): string | null {
  if (!oemNotePresent(text)) return "ใส่เหตุผลที่แก้ (ต้องมีตัวอักษรหรือตัวเลขจริง)";
  if (approvalNoteIssue(text, "เหตุผล") !== null) return "เหตุผลห้ามมีอักขระควบคุมหรืออักขระล่องหน — ลบแล้วพิมพ์ใหม่";
  if (Array.from(text).length > GEM_LIMITS.reasonMax) return "เหตุผลยาวเกิน 300 ตัวอักษร";
  return null;
}
