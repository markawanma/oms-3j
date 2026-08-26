// lib/oem/printableReceipt.ts — the ONE allowed shape of data that may cross
// from the server into PrintReceiptClient (a "use client" component under
// app/(dashboard)/oem/receipts/[id]/print).
//
// SAME SECURITY BOUNDARY AS lib/oem/printableQuote.ts, SEPARATE TYPE ON
// PURPOSE (see design-oem-payment-invoice.md §8): a "use client" component's
// ENTIRE props tree serializes into the RSC flight payload the browser
// downloads, rendered or not — so PrintableReceipt exists so a field that
// isn't listed here PHYSICALLY CANNOT reach the client component, no matter
// what PrintReceiptClient's JSX does or doesn't render.
//
// toPrintableReceipt() below is the ONLY allowed constructor — field-by-field,
// NEVER `...row` spread — so a future column added to OemReceiptRow does not
// silently ride along into this type for free. Adding a field HERE is the
// actual decision "this is now allowed to reach the customer".
//
// WHY THIS IS A SEPARATE FILE FROM printableQuote.ts, NOT A SHARED ONE: a
// receipt reads from a FROZEN SNAPSHOT (columns on the oem_receipt row
// itself, written once at issue time and never touched again) while a quote
// print reads LIVE computed values (v_oem_quote, recomputed every request).
// Sharing one type/component would let a future quote-print change silently
// drag the tax-document print along with it — see 0084's header comment:
// "ตรงข้ามกับหลักการ 0081/0082 โดยตั้งใจ — คนละชนิดเอกสาร คนละกติกา".
//
// EXPLICITLY EXCLUDED, forever, unless a human deliberately decides otherwise
// in a change that touches this file: cost/margin of ANY kind (the DB table
// itself has none — analytics.oem_receipt was designed with zero cost/margin
// columns — but the "field-by-field, never spread" rule below is kept
// identical to printableQuote.ts anyway, so a future column addition to
// OemReceiptRow can never ride along silently), the shop's internal
// void/reissue bookkeeping beyond what's needed to render the void watermark,
// createdBy/voidedBy (internal user ids, not a customer-facing fact).

import type { OemCustomerAddress, OemReceiptKind, OemReceiptPaymentMethod, OemReceiptRow, OemReceiptStatus } from "./types";

export interface PrintableReceiptSeller {
  legalName: string | null;
  branchLabel: string | null;
  addressLines: string[];
  taxId: string | null;
  phone: string | null;
}

export interface PrintableReceipt {
  id: string;
  receiptNo: string;
  status: OemReceiptStatus;
  kind: OemReceiptKind;
  /** วันที่ออกเอกสาร (เวลาไทย ณ ตอนออก) — เลขบนหัวกระดาษ. */
  issueDate: string;
  /** วันที่รับเงินจริง (tax point) — อาจต่างจาก issueDate ถ้าย้อนหลังบันทึก. */
  receivedDate: string;
  paymentMethod: OemReceiptPaymentMethod | null;
  paymentRef: string | null;
  /** บรรทัดรายการเดียวบนเอกสาร — ข้อความที่ระบบ generate หรือผู้ใช้ override
   * ตอนออกใบ (แช่แข็งแล้ว ไม่ใช่ค่าที่คำนวณสด). */
  description: string;
  seller: PrintableReceiptSeller;
  buyerLegalName: string;
  buyerTaxId: string | null;
  buyerBranchLabel: string | null;
  buyerAddress: OemCustomerAddress | null;
  /** ยอดรับจริง (รวมภาษีมูลค่าเพิ่มแล้ว) — ตัวเลขเดียวที่ "ถูกต้อง" ของใบนี้ตลอดไป. */
  amountThb: number;
  /** ยอดเป็นตัวอักษรไทย เช่น "ห้าพันบาทห้าสิบสตางค์" — format จาก amountThb
   * เท่านั้น (ไม่ใช่การคำนวณเงินใหม่ แค่แปลงตัวเลขเดิมเป็นข้อความ). */
  amountInWordsTh: string;
  /** VAT rate ที่ snapshot ไว้ตอนออกใบ (เช่น 0.07) — ห้าม hardcode "7%" ที่ไหน
   * เลย, derive จากค่านี้เสมอ. */
  vatRate: number;
  vatBaseThb: number;
  /** amountThb - vatBaseThb (remainder ไม่ใช่ปัดอิสระ) — vatBaseThb +
   * vatAmountThb === amountThb เป๊ะเสมอ. */
  vatAmountThb: number;
  /** เลขที่ใบเสนอราคาต้นทาง ณ วันที่ออกใบนี้ (snapshot — อาจไม่ตรงกับเลขที่
   * ปัจจุบันของดีลถ้าถูกต่อราคาไปแล้ว, informational เท่านั้น). */
  quoteNoSnapshot: string;
  /** ยอดรวมทั้งใบเสนอราคา ณ วันที่ออกใบนี้ (informational — ประวัติศาสตร์). */
  grandTotalSnapshot: number;
  /** ยอดที่รับไปแล้วก่อนหน้าใบนี้ (ระดับดีล, informational). */
  paidBeforeThb: number;
  /** ยอดคงเหลือหลังใบนี้ ณ วันที่ออก (informational — ประวัติศาสตร์ ไม่ใช่
   * ยอดคงเหลือปัจจุบัน). */
  balanceAfterThb: number;
  /** null เว้นแต่ status='void' — เหตุผลที่ยกเลิก เป็นข้อความอิสระที่พนักงาน
   * พิมพ์เอง (เช่น "คิดต้นทุนผิด ลืมบวกค่าแฟลสก์") เพื่อการตรวจสอบภายในเท่านั้น
   * — PrintReceiptClient ต้องแสดงด้วย `print:hidden` เสมอ (เห็นบนจอ ไม่ติด
   * กระดาษที่ส่งลูกค้า) มีเพียง "ใบนี้ถูกยกเลิกแล้ว" + voidedAt เท่านั้นที่เป็น
   * ข้อความบังคับทางเอกสารและต้องอยู่บนกระดาษจริง. */
  voidReason: string | null;
  voidedAt: string | null;
}

/** OemReceiptRow.sellerSnapshot -> PrintableReceiptSeller, field-by-field.
 * displayName is deliberately dropped here — legalName is the legally
 * required name on a tax document; displayName is a marketing name, not
 * printed on this specific document type (unlike the quote print, which has
 * no such distinction requirement). */
function toPrintableSeller(row: OemReceiptRow): PrintableReceiptSeller {
  return {
    legalName: row.sellerSnapshot.legalName,
    branchLabel: row.sellerSnapshot.branchLabel,
    addressLines: row.sellerSnapshot.addressLines ?? [],
    taxId: row.sellerSnapshot.taxId,
    phone: row.sellerSnapshot.phone,
  };
}

/** The only constructor for PrintableReceipt — called once, server-side, in
 * app/(dashboard)/oem/receipts/[id]/print/page.tsx, before anything crosses
 * into the "use client" boundary. Field-by-field on purpose (see header). */
export function toPrintableReceipt(row: OemReceiptRow): PrintableReceipt {
  return {
    id: row.id,
    receiptNo: row.receiptNo,
    status: row.status,
    kind: row.kind,
    issueDate: row.issueDate,
    receivedDate: row.receivedDate,
    paymentMethod: row.paymentMethod,
    paymentRef: row.paymentRef,
    description: row.description,
    seller: toPrintableSeller(row),
    buyerLegalName: row.buyerLegalName,
    buyerTaxId: row.buyerTaxId,
    buyerBranchLabel: row.buyerBranchLabel,
    buyerAddress: row.buyerAddress,
    amountThb: row.amountThb,
    amountInWordsTh: thaiBahtText(row.amountThb),
    vatRate: row.vatRate,
    vatBaseThb: row.vatBaseThb,
    vatAmountThb: row.vatAmountThb,
    quoteNoSnapshot: row.quoteNoSnapshot,
    grandTotalSnapshot: row.grandTotalSnapshot,
    paidBeforeThb: row.paidBeforeThb,
    balanceAfterThb: row.balanceAfterThb,
    voidReason: row.status === "void" ? row.voidReason : null,
    voidedAt: row.status === "void" ? row.voidedAt : null,
  };
}

// ============================================================================
// Thai baht-text ("ยอดเป็นตัวอักษรไทย") — a pure FORMATTING function, not
// money arithmetic: it takes a number the DB already computed
// (oem_receipt.amount_thb) and spells it out. This is the same category as
// formatTHB()/fmtPct() elsewhere in the app (lib/format.ts, lib/oem/
// display.ts) — never derives a new amount, only renders the one it's given.
//
// Verified against the two worked examples in oem-quote-invariants' §3 and
// design-oem-payment-invoice.md's §5 ("บวกลงเป๊ะ"): 5000.50 ->
// "ห้าพันบาทห้าสิบสตางค์" (exact match). "เอ็ด" (units digit 1) and "ยี่สิบ"
// (tens digit 2) are resolved against the WHOLE trimmed integer's length, not
// each 6-digit "ล้าน" group's own length in isolation — a number like
// 1,000,001 must read "...ล้านเอ็ด", not "...ล้านหนึ่ง", even though "1" is a
// single-digit string once its own group's leading zeros are stripped.
// ============================================================================

const THAI_DIGIT = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
// index = place-within-a-6-digit-group (0=หน่วย,1=สิบ,2=ร้อย,3=พัน,4=หมื่น,5=แสน)
const THAI_PLACE = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];

function sixDigitGroupToThaiText(group: string, unitDigitOneIsEd: boolean): string {
  let text = "";
  const len = group.length;
  for (let idx = 0; idx < len; idx++) {
    const digit = Number(group[idx]);
    if (digit === 0) continue;
    const place = len - idx - 1;
    if (place === 0) {
      text += digit === 1 && unitDigitOneIsEd ? "เอ็ด" : THAI_DIGIT[digit];
    } else if (place === 1) {
      if (digit === 1) text += "สิบ";
      else if (digit === 2) text += "ยี่สิบ";
      else text += THAI_DIGIT[digit] + "สิบ";
    } else {
      text += THAI_DIGIT[digit] + THAI_PLACE[place];
    }
  }
  return text;
}

function integerToThaiText(intStr: string): string {
  const trimmed = intStr.replace(/^0+/, "");
  if (trimmed === "") return "ศูนย์";
  // "เอ็ด" applies to the final units digit whenever the WHOLE number has
  // more than one significant digit — decided once, globally, not per
  // 6-digit group (see file header for why per-group length is wrong here).
  const unitDigitOneIsEd = trimmed.length > 1;
  const groups: string[] = [];
  let rest = trimmed;
  while (rest.length > 0) {
    groups.unshift(rest.slice(-6));
    rest = rest.slice(0, -6);
  }
  let result = "";
  for (let i = 0; i < groups.length; i++) {
    const groupText = sixDigitGroupToThaiText(groups[i], unitDigitOneIsEd);
    if (!groupText) continue;
    result += groupText;
    const millionPower = groups.length - i - 1;
    if (millionPower > 0) result += "ล้าน".repeat(millionPower);
  }
  return result || "ศูนย์";
}

/** amount (THB, up to 2dp) -> Thai words, e.g. 5000.50 -> "ห้าพันบาทห้าสิบสตางค์",
 * 100 -> "หนึ่งร้อยบาทถ้วน". Returns "" for a non-finite/negative input (should
 * never happen — amountThb is a DB CHECK amount_thb > 0 column — but this
 * function must never throw on a print page). */
export function thaiBahtText(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return "";
  // amount is already the DB's final, rounded-to-2dp figure — this rounding
  // is purely to defend against float noise (e.g. 5000.1 stored as
  // 5000.099999999) when splitting into baht/satang below, not a recompute.
  const rounded = Math.round(amount * 100) / 100;
  const baht = Math.floor(rounded);
  const satang = Math.round((rounded - baht) * 100);
  let text = `${integerToThaiText(String(baht))}บาท`;
  text += satang === 0 ? "ถ้วน" : `${integerToThaiText(String(satang))}สตางค์`;
  return text;
}
