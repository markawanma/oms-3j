// lib/import/source-types.ts — ค่าคงที่ที่ทั้ง server action และ client
// component ใช้ร่วมกันในระบบนำเข้ายอดขาย
//
// อยู่แยกไฟล์เพราะ lib/actions/import-*.ts เป็น "use server" ซึ่ง Next.js
// อนุญาตให้ export ได้เฉพาะ async function เท่านั้น — "export const" จาก
// ไฟล์พวกนั้นทำให้ **build ล้ม** ("Only async functions are allowed to be
// exported in a 'use server' file") ทั้งที่ tsc --noEmit ผ่านสะอาด
// บทเรียน 27 ส.ค. 69: typecheck ไม่ใช่ build — เจ้าของเจอตอนเปิดหน้าเว็บ
// ไฟล์นี้ไม่มี "use server" จึง import ได้จากทั้งสองฝั่งโดยไม่ลาก server
// code เข้า client bundle

export const ORDER_SOURCE_TYPE = "excel_order_report" as const;
export const LINE_ITEM_SOURCE_TYPE = "excel_line_item_report" as const;

export type ImportSourceType =
  | typeof ORDER_SOURCE_TYPE
  | typeof LINE_ITEM_SOURCE_TYPE;

// error_detail prefixes written by analytics.transform_pending_order_lines
// (migration 0094) for 'transformed' rows — exported so the UI can classify
// warnings by prefix match without re-deriving/duplicating the proc's exact
// wording. If the proc's Thai wording ever changes, this is the one place to
// update; a row whose error_detail doesn't start with any of these falls into
// an "other" bucket in the UI instead of crashing or being silently dropped.
export const WARNING_KIND_PREFIX = {
  // v_unit_cost stayed null through every tier — cost counted as 0. The one
  // that matters most: profit on this order is overstated right now.
  unknown_sku: "ไม่พบสินค้าในระบบ",
  // 0094 tier 3: matched an ACTIVE product after stripping a 1-2 char leading
  // junk prefix (e.g. a stray Thai IME mark) off sku_raw. Cost is real, but
  // the source file's SKU column is probably typo'd — worth fixing upstream.
  stripped_prefix_match: "จับคู่ด้วยรหัสที่ตัดอักขระนำหน้า",
  // 0094 tier 2': matched an INACTIVE (discontinued) product by exact sku.
  // Cost is that product's last known cost, not necessarily current.
  inactive_match: "จับคู่กับสินค้าที่ปิดการขาย",
} as const;
