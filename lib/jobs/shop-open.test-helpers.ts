// helper ของเทสต์ shop-open — รายการ code ที่ intakeOpen/intakeFail ส่งกลับได้ (ใช้ไล่ตรวจข้อความ error ทุกเคส)
// ไม่ใช่ไฟล์ production (ชื่อ .test-helpers.ts ไม่ถูก import จากโค้ดแอป · ไม่อยู่ในกราฟหน้าช่าง)
import type { ShopFail } from "@/lib/jobs/shop-open";

export const INTAKE_CODE_PROBE: ShopFail[] = [
  { code: "rate_limited", error: "ส่งถี่เกินไป — รอสักครู่แล้วลองอีกครั้ง", retryAfterSeconds: 30 },
  { code: "rate_limited", error: "ส่งถี่เกินไป — รอสักครู่แล้วลองอีกครั้ง" },
  { code: "token_budget_exhausted", error: "วันนี้ใส่ PIN ผิดครบกำหนดแล้ว — ขอ QR ร้านใหม่จากออฟฟิศ" },
  { code: "no_default_profile", error: "x" },
  { code: "no_gold_profile", error: "x" },
  { code: "not_ready", error: "x" },
  { code: "job_exists", error: "SKU นี้มีใบงาน JB-0031 เปิดอยู่แล้ว — ถ้าต้องการเพิ่มจำนวน แจ้งออฟฟิศ หรือเลือกสินค้าอื่น" },
  { code: "job_exists", error: "not_clean_value" },
  { code: "idem_conflict", error: "x" },
  { code: "idem_invalid", error: "x" },
  { code: "session_required", error: "x" },
  { code: "invalid_token", error: "x" },
  { code: "not_allowed", error: "x" },
  { code: "name_invalid", error: "x_y" },
  { code: "sku_or_label", error: "x_y" },
  { code: "sku_invalid", error: "x_y" },
  { code: "metal_required", error: "x_y" },
  { code: "metal_invalid", error: "x_y" },
  { code: "gold_purity_required", error: "x_y" },
  { code: "purity_invalid", error: "x_y" },
  { code: "qty_invalid", error: "x_y" },
  { code: "due_invalid", error: "x_y" },
  { code: "note_invalid", error: "x_y" },
  { code: "invalid_input", error: "x_y" },
  { code: "error", error: "analytics.fn_x failed" },
  { error: "x_y", field: "purity" },
  { error: "x_y", field: "key" },
];
