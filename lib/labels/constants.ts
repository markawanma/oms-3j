// lib/labels/constants.ts — shared constants for the label upload/parse
// pipeline (design: docs/3j-jewelry/analytics/design-label-upload.md).
// Plain module (no "use server") — imported by lib/actions/labels.ts and,
// later, client-side pre-upload validation (file size/extension checks).

export const SHIPPING_LABELS_BUCKET = "shipping-labels";

// design §0/§3: "ไฟล์ 100 หน้า/20MB ผ่านได้"
export const MAX_LABEL_FILE_BYTES = 20 * 1024 * 1024; // 20MB
export const MAX_LABEL_PAGES = 300;

export const ACCEPTED_LABEL_EXTENSIONS = ["pdf"] as const; // design §0 — P1 รับ PDF เท่านั้น (ไม่ทำ OCR)

// sha256 hex digest — 64 lowercase/uppercase hex chars (client computes via
// crypto.subtle before requesting a signed upload URL, design §1/§3).
export const SHA256_HEX_PATTERN = /^[0-9a-fA-F]{64}$/;

/**
 * 3J's own shipping/return address — used by lib/labels/match.ts to strip the
 * ONE occurrence of "shop's own province + zipcode" co-located on a label, so
 * the sender's own address is never mistaken for the customer's destination
 * province (design §4 rule 4). Address on real labels: บางขุนเทียน, แขวง/เขต
 * จอมทอง, กรุงเทพมหานคร 10150.
 *
 * ⚠️ debt (design §"ความเสี่ยงใหญ่สุด 3" #3): hardcoded as a single-shop
 * constant here. Move to a DB config table (per-shop) when a second sender
 * address is ever needed — a code constant can't express "shop B ships from
 * a different address."
 */
export const SENDER_FINGERPRINT = {
  provinceCode: "TH-10",
  zipcode: "10150",
  // UAT 28 ส.ค. 69: ใบจริงจำนวนมาก "ไม่พิมพ์รหัสไปรษณีย์ผู้ส่งเลย" — ยึด 10150
  // อย่างเดียวจึงตัดที่อยู่ร้านไม่ออก ใช้จุดสังเกตจากที่อยู่ร้านเป็นตัวช่วย:
  // occurrence ของกรุงเทพฯ ที่อยู่ใกล้คำพวกนี้ = ที่อยู่ผู้ส่ง ไม่ใช่ลูกค้า
  // (ลูกค้าที่อยู่เขตจอมทองจริงจะโดนตัดไปด้วย -> ตกคิว review ซึ่งปลอดภัย
  // กว่าปล่อยให้ระบบเดา)
  addressMarkers: ["จอมทอง", "บางขุนเทียน", "เอกชัย"],
} as const;

// Owner decision (28 ส.ค. 2569, design header #2 — overrides the 90-day
// figure still written in the body of design §7/"ให้เจ้าของเคาะ"): keep
// uploaded label PDFs for 180 days after parse, then purge (P1/P2: manual
// "ล้างไฟล์เก่า" button, not a cron job — see design §7).
export const RETENTION_DAYS = 180;
