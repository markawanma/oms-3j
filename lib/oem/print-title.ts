// lib/oem/print-title.ts — ชื่อไฟล์ PDF ของใบเสนอราคา / ใบแจ้งหนี้ / ใบเสร็จ OEM (pure) · รูปแบบ + กติกาอยู่ที่ lib/print/filename.ts
// อ่านจาก Printable* (ด่าน type boundary เดิม) เท่านั้น — เลขเอกสาร · วันที่ · ชื่อผู้ซื้อ ที่ใบพิมพ์แสดงอยู่แล้ว
// 🔴 รับแค่ Pick ของ 3-4 field ตรงตัว: ไม่มีทางหยิบราคา/ยอด/ต้นทุน/margin/ที่อยู่/เลขผู้เสียภาษี เข้าชื่อไฟล์ได้

import { bkkYYMMDD, printFileTitle, sanitizeFileTitlePart } from "@/lib/print/filename";
import type { PrintableQuote } from "@/lib/oem/printableQuote";
import type { PrintableInvoice } from "@/lib/oem/printableInvoice";
import type { PrintableReceipt } from "@/lib/oem/printableReceipt";

/**
 * ใบเสนอราคา · ชื่อ = ชื่อผู้ซื้อที่ใบพิมพ์ (billLegalName ถ้ามี ไม่งั้น customerName — ลำดับเดียวกับหน้าพิมพ์)
 * วันที่ = createdAt (วันออกใบ) ตามเวลาไทย
 */
export function quotePrintTitle(q: Pick<PrintableQuote, "quoteNo" | "createdAt" | "billLegalName" | "customerName">): string {
  return printFileTitle({ date: bkkYYMMDD(q.createdAt), docNo: q.quoteNo, name: sanitizeFileTitlePart(q.billLegalName) || sanitizeFileTitlePart(q.customerName) });
}

/** ใบแจ้งหนี้ · วันที่ = issueDate (วันที่ออก ตามที่ใบพิมพ์) · ชื่อ = buyerLegalName */
export function invoicePrintTitle(i: Pick<PrintableInvoice, "invoiceNo" | "issueDate" | "buyerLegalName">): string {
  return printFileTitle({ date: bkkYYMMDD(i.issueDate), docNo: i.invoiceNo, name: i.buyerLegalName });
}

/** ใบเสร็จ/ใบกำกับภาษี · วันที่ = issueDate (วันที่ออก ตามที่ใบพิมพ์ — ไม่ใช่วันรับเงิน) · ชื่อ = buyerLegalName */
export function receiptPrintTitle(r: Pick<PrintableReceipt, "receiptNo" | "issueDate" | "buyerLegalName">): string {
  return printFileTitle({ date: bkkYYMMDD(r.issueDate), docNo: r.receiptNo, name: r.buyerLegalName });
}
