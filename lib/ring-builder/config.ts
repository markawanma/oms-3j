// lib/ring-builder/config.ts — ค่าคงที่ของ Ring Builder (pure · ไม่มี runtime import · ใช้ได้ทั้ง server/client)
// 🔴 ค่าที่อยู่ 2 ที่ (แก้คู่เสมอ — parity test ล็อกไว้ใน config.test.ts):
//   · ช่วงไซซ์ร้าน 45–68 : RING_BUILDER_SIZES ⇔ analytics.rb_size_range() (0196) ⇔ SHOP_RING_SIZES (lib/ring-size/config.ts)
//   · เพดาน: total 18 บิต (262,143) · design_no 12 บิต · stone_no 10 บิต ⇔ rb_quote/rb_design_upsert/rb_stone_upsert ใน 0196
// ตัวเลขเงินทั้งหมดมาจาก DB — ไฟล์นี้ไม่มีราคาใดๆ (CZ ขาว = รวมในราคาตัวเรือน)

export const RING_BUILDER_SIZES = { min: 45, max: 68 } as const;

export const MIN_STONES = 3;
export const MAX_STONES = 7;
export const MAX_DESIGN_NO = 4095;
export const MAX_STONE_NO = 1023;
export const MAX_TOTAL_THB = 262143;

/** รหัสสั่งทำ: prefix + ขีดทุก 5 ตัว (แสดงผลเท่านั้น — decoder ตัดขีดทิ้ง) */
export const CODE_PREFIX = "3JR-";
/** size_idx 31 = "ให้แอดมินช่วยเช็กไซซ์" (B3) · 24..30 = ปฏิเสธ */
export const SIZE_ADMIN_CHECK_IDX = 31;
/** priced_at ในรหัส = วินาทีนับจากนี้ */
export const PRICE_EPOCH_MS = Date.UTC(2026, 0, 1);

export const QUOTE_MAX_BODY_BYTES = 512;
export const RING_BUILDER_BUCKET = "ring-builder";
export const CODE_SECRET_ENV = "RING_BUILDER_CODE_SECRET";
export const CODE_SECRET_MIN_LENGTH = 32;

/** CZ ขาว = stone_no 0 · ค่าคงที่ ไม่มีแถวใน DB · ราคา 0 (รวมในตัวเรือน) · ห้ามเรียกว่าเพชร (กฎแบรนด์ข้อ 4) */
export const CZ_WHITE = { stoneNo: 0, name: "CZ ขาว", shortName: "CZ ขาว", colorHex: "#FFFFFF" } as const;

export const QUOTE_REASONS = ["design_unavailable", "stone_unavailable", "size_out_of_range", "count_mismatch", "total_too_large", "invalid"] as const;
export type QuoteReason = (typeof QUOTE_REASONS)[number];

export const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."] as const;

/** ข้อความในข้อความ LINE (ประกอบที่ server — ร่างให้เจ้าของเคาะคำ) */
export const LINE_COPY = {
  greeting: "สวัสดี ขอสั่งทำแหวนตามแบบนี้",
  sizeAdminCheck: "รอแอดมินช่วยเช็ก",
  stonesHeading: "พลอย (นับซ้ายไปขวา)",
  closing: "รบกวนยืนยันราคาและขั้นตอนต่อไป",
} as const;
