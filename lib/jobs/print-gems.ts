// lib/jobs/print-gems.ts — ตรรกะ pure ของตารางพลอยบนใบงาน A5 (UX §8.3 "ตัดอะไรก่อน")
// บันได 4 ขั้น (ไล่จากเสียน้อยสุด ทำทีละขั้นจนพอดี): ตัดรูปหลัก → บีบตารางพลอยเป็นโหมดกระชับ → ย้ายตารางพลอย "ทั้งก้อน" ไปแผ่นที่ 2
// 🔴 ห้ามเด็ดขาด: ตัดแถวพลอยทิ้งให้พอดี · ใช้ "…และอีก n รายการ" แทนรายการ · ย่อตัวอักษร < 8pt · ย่อ/ตัดตารางขั้น · ตัดสินเงียบๆ โดยไม่มีแถบบอกบนจอพิมพ์
//   (ตัดแถวแล้วช่างฝังผิดชนิด = เสียพลอยจริง — ฟังก์ชันในไฟล์นี้ไม่มีทางรับ/คืนรายการที่น้อยลง)
// ⚠️ ตัวเลขความสูงเป็นค่าประมาณจากโค้ด ยังไม่ได้วัดกระดาษจริง [ต้องยืนยันด้วยการพิมพ์ 6 เคสบน A5 จริง — UX §13 ข้อ 7]

import type { PrintableJobGem } from "@/lib/jobs/print";

/** พื้นที่พิมพ์สูงของ A5 แนวตั้ง (มม.) = 210 − margin 8 × 2 (ตรงกับ @page ใน JobPrintClient) */
export const PRINT_CONTENT_HEIGHT_MM = 194;

export type GemPrintStep = "normal" | "noPhoto" | "compact" | "page2";

/** ขั้นถัดไปของบันได เมื่อวัดแล้วล้น · ไม่มีรูปหลัก = ข้ามขั้น "ตัดรูป" · page2 คือขั้นสุดท้าย (คืนตัวเอง) */
export function nextGemPrintStep(cur: GemPrintStep, hasPhoto: boolean, hasRows = true): GemPrintStep {
  // ยังไม่ระบุพลอย (มีแต่บรรทัดเตือนบรรทัดเดียว — ไม่มีแถวให้บีบ/ย้าย): ทำได้แค่ตัดรูป · พ้นนั้นล้นก็ล้น (ผู้เรียกขึ้นแถบเตือน)
  if (!hasRows) return cur === "normal" && hasPhoto ? "noPhoto" : cur;
  switch (cur) {
    case "normal":
      return hasPhoto ? "noPhoto" : "compact";
    case "noPhoto":
      return "compact";
    case "compact":
      return "page2";
    default:
      return "page2";
  }
}

/** ยอดพลอยรวมทั้งใบ (เม็ด) = บวก qtyTotal ที่ DB คำนวณมาแล้ว (จำนวนเต็ม) */
export function printGemTotal(gems: readonly Pick<PrintableJobGem, "qtyTotal">[]): number {
  return gems.reduce((s, g) => s + g.qtyTotal, 0);
}

/** ข้อความแถบ print:hidden บนจอพิมพ์ ตามขั้นที่เลือก (ห้ามตัดสินเงียบ) — normal = ไม่มี */
export const GEM_PRINT_NOTICE: Record<GemPrintStep, string | null> = {
  normal: null,
  noPhoto: "ตัดรูปออกเพื่อให้ตารางพลอยพอดี — ช่างดูรูปผ่าน QR",
  compact: "ตารางพลอยยาว — บีบเป็นโหมดกระชับ (1 แถวต่อพลอย) เพื่อให้ครบทุกแถวในแผ่นเดียว",
  page2: "ใบนี้พิมพ์ 2 แผ่น — ติดแผ่น 2 ไว้กับถุงงาน (แผ่น 2 ไม่มี QR)",
};

/** ใบที่ต้องวัดความสูง = มีตารางพลอย หรือมีบรรทัด "พลอย: ยังไม่ระบุ" (ก็กินที่) — ใบไม่มีพลอยและไม่ใช่ unspecified ไม่ถูกวัด/ไม่เปลี่ยนอะไรเลย */
export const needsGemFit = (gems: readonly unknown[], state: "not_needed" | "specified" | "unspecified" = "not_needed"): boolean => gems.length > 0 || state === "unspecified";
