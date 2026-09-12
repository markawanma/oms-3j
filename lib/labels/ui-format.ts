// lib/labels/ui-format.ts — small display-only helpers shared by the label
// review UI (LabelReviewQueueRow / ProvinceFixPanel — brief 11 ก.ย. 69,
// "คิวใบปะหน้ากดได้ + แก้/ย้อนจังหวัด"). Pure formatting only, no DB access —
// plain module (no "use server", same reasoning as lib/labels/types.ts
// header: a "use server" file may only export async functions).

import type { CrmProvinceOption } from "@/lib/crm/order-override";
import type { OrderSourceRef } from "@/lib/labels/types";

// Mirrors supabase/migrations/0116_label_review_resolve.sql's PDPA shape
// check for p_taught_snippet EXACTLY: `length(pattern) <= 25 and pattern !~
// '\d{3,}'`. Client-side pre-check only — the DB call is still the real
// gate (contract §4: a snippet that fails this rejects the WHOLE resolve
// call, province included, not just the snippet).
export const TAUGHT_SNIPPET_MAX_LENGTH = 25;
export const TAUGHT_SNIPPET_DIGIT_RUN_RE = /\d{3,}/;

export const UNKNOWN_PROVINCE_CODE = "TH-XX";

export function isRealProvinceCode(code: string | null | undefined): boolean {
  return !!code && code !== UNKNOWN_PROVINCE_CODE;
}

export function provinceNameByCode(provinces: CrmProvinceOption[], code: string | null | undefined): string {
  if (!code) return "—";
  if (code === UNKNOWN_PROVINCE_CODE) return "ไม่ทราบจังหวัด";
  return provinces.find((p) => p.code === code)?.nameTh ?? code;
}

/** null = ผ่าน, string = ข้อความ error ที่ควรกันไม่ให้กดส่ง (ตรงกับด่านฝั่ง DB) */
export function validateTaughtSnippet(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null; // ว่างได้เสมอ — ไม่บังคับ
  if (trimmed.length > TAUGHT_SNIPPET_MAX_LENGTH) {
    return `ข้อความสอนยาวเกิน ${TAUGHT_SNIPPET_MAX_LENGTH} ตัวอักษร`;
  }
  if (TAUGHT_SNIPPET_DIGIT_RUN_RE.test(trimmed)) {
    return "ข้อความสอนมีตัวเลขติดกันตั้งแต่ 3 หลัก — ระบบจะปฏิเสธ (กันเลขพัสดุ/เบอร์โทรหลุด)";
  }
  return null;
}

export const PROVINCE_SOURCE_LABEL: Record<OrderSourceRef["provinceSource"], string> = {
  import: "จากไฟล์นำเข้า",
  label: "จากใบปะหน้า",
  manual: "แก้มือ",
};

/** หนึ่งบรรทัด "ที่มา" ของออเดอร์ — decision #3 (11 ก.ย.): "ทุกแถวต้องบอกที่มา
 * ให้เจ้าของเปิดอ่านเองได้" — เลขออเดอร์ + จังหวัดปัจจุบัน + ที่มาของจังหวัดนั้น +
 * ไฟล์/แถวที่นำเข้ามา (ถ้ามี). */
export function orderSourceLine(o: OrderSourceRef, provinces: CrmProvinceOption[]): string {
  const province = provinceNameByCode(provinces, o.provinceCode);
  const importedFrom = o.importFileName
    ? `นำเข้าจาก ${o.importFileName}${o.sourceRowNo != null ? ` แถว ${o.sourceRowNo}` : ""}`
    : "ไม่มีข้อมูลไฟล์นำเข้า";
  return `ออเดอร์ ${o.sourceOrderNo} — จังหวัดปัจจุบัน: ${province} (${PROVINCE_SOURCE_LABEL[o.provinceSource]}) · ${importedFrom}`;
}
