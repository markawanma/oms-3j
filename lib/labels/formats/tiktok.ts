// lib/labels/formats/tiktok.ts — TikTok shipping-label parser (design §6,
// P1 scope: "P1 ทำ TikTok ตัวเดียว" — 2,721/2,841 = 96% of the TH-XX backlog).
// Plain module (no "use server").
//
// design §6: detect from the tracking-number pattern (JTTH\d{10,}) + a
// format-specific marker; design §4 rule 7: a page with >1 distinct tracking
// number extracted is ambiguous -> needs_review (not this module's job to
// decide the final match_status, just to report the raw signal).

const TRACKING_PATTERN = "JTTH\\d{10,}";

export interface LabelExtractResult {
  trackingNo: string | null;
  /** true when >1 DISTINCT tracking numbers were found on the page (design §4
   * rule 7) — trackingNo is null in that case; caller must route to
   * needs_review regardless of any province match outcome. */
  ambiguous: boolean;
}

export interface LabelFormat {
  id: string;
  detect(pageText: string): boolean;
  extract(pageText: string): LabelExtractResult;
}

// Fresh RegExp instance per call — cheap at this volume (hundreds of pages
// per file) and avoids any shared-mutable-lastIndex footgun from reusing one
// global-flag regex object across detect()/extract() calls.
function uniqueTrackingNumbers(pageText: string): string[] {
  const matches = pageText.match(new RegExp(TRACKING_PATTERN, "g")) ?? [];
  return [...new Set(matches)];
}

export const tiktokFormat: LabelFormat = {
  id: "tiktok",
  detect(pageText: string): boolean {
    return new RegExp(TRACKING_PATTERN).test(pageText);
  },
  extract(pageText: string): LabelExtractResult {
    const unique = uniqueTrackingNumbers(pageText);
    if (unique.length === 1) {
      return { trackingNo: unique[0], ambiguous: false };
    }
    // 0 matches (shouldn't happen if detect() returned true, but defensive)
    // or >1 distinct matches (design §4 rule 7) both come back as "no single
    // answer" — ambiguous only flags the >1 case specifically so the caller
    // can tell "genuinely nothing found" apart from "found too many."
    return { trackingNo: null, ambiguous: unique.length > 1 };
  },
};

// UAT 29 ส.ค. 69: TikTok's "Shipping label+Packing slip" PDF prints a
// SEPARATE trailing page per order that is the packing slip only (product
// name/SKU/qty table) — no tracking number, no address, nothing this module
// or match.ts could ever resolve. detect() correctly returns false for these
// (no JTTH\d{10,}), which lands them at match_status='undetected' — but that
// status reads to the owner as "we couldn't figure out what this page is,"
// which is misleading: we know exactly what it is, it's just not a label.
// Confirmed against all 14 real 'undetected' pages in the 954-page UAT
// corpus (29 ส.ค. 69): every single one carries all three markers below
// (including Qty Total) and none carry a tracking number.
//
// 🔴 4 ต.ค. 69: เจ้าของชี้เคสที่สองของหน้าตระกูลนี้ — ออเดอร์หลาย SKU บางใบมี
// หน้าตัดตอน (เช่น page 52 ของ shipping-labels/.../9040e565....pdf) ที่มี
// "Order ID:" + table header เหมือนเดิม แต่ **ไม่มี "Qty Total:" เลย** (ไม่มี
// แถวสินค้าด้วยซ้ำ — แค่ header เปล่าๆ) ดึง text จริงด้วย unpdf (lib ตัวเดียว
// กับที่ parseLabelFile ใช้จริง) ยืนยันแล้ว: หน้านั้นไม่มี tracking, ไม่มี
// Qty Total, Order ID ตรงกับหน้าก่อนหน้าเป๊ะ (586305850175489884 ทั้งคู่) ซึ่ง
// เป็นหน้าที่มีข้อมูลลูกค้า/tracking/Qty Total ครบ — ยืนยันตามที่เจ้าของสอน:
// "Order ID ซ้ำกับใบข้างๆ ไม่ต้องเสียเวลาหาข้อมูลลูกค้าในหน้านั้น"
// ⇒ ตัด Qty Total ออกจากเงื่อนไขบังคับ — ไม่ใช่สัญญาณที่เชื่อถือได้ว่าหน้านี้
// "ไม่ใช่ใบปะหน้า" (ไม่ใช่สัญญาณบอกว่า "ใช่ใบปะหน้า" ด้วยซ้ำ — มีไม่ได้ก็ยัง
// เป็นหน้าว่างแบบนี้ได้) ปลอดภัยที่จะตัดออก เพราะฟังก์ชันนี้แค่ตั้ง `reason`
// ใน match_detail ให้คนอ่านเฉยๆ ไม่ได้กำหนด match_status/การเขียนจังหวัดเลย
// (ด่านนั้นแยกอยู่ที่ tiktokFormat.detect()/.extract() ซึ่งยังเช็ค JTTH เหมือน
// เดิมทุกตัวอักษร ไม่ได้แก้ตรงนี้) — Qty Total marker ยังเก็บไว้เผื่อใช้ที่อื่น
// ในอนาคต แต่เลิกเป็นเงื่อนไขบังคับของฟังก์ชันนี้
// looksLikePackingSlipOnly() lets the caller (lib/actions/labels.ts) store a
// `reason` in match_detail distinguishing "this is a real page, just not a
// label" from "we genuinely don't recognize this" — read-only classification
// hint, does NOT change match_status itself (no DB/schema change needed:
// match_detail is jsonb, already used for {candidates}).
const PACKING_SLIP_ORDER_ID_MARKER = "Order ID:";
const PACKING_SLIP_TABLE_HEADER_MARKER = "Product Name SKU Seller SKU Qty";

export function looksLikePackingSlipOnly(pageText: string): boolean {
  return (
    !new RegExp(TRACKING_PATTERN).test(pageText) &&
    pageText.includes(PACKING_SLIP_ORDER_ID_MARKER) &&
    pageText.includes(PACKING_SLIP_TABLE_HEADER_MARKER)
  );
}
