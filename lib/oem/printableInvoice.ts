// lib/oem/printableInvoice.ts — the ONE allowed shape of data that may cross from the
// server into PrintInvoiceClient (a "use client" component under app/(dashboard)/oem/invoices/[id]/print).
//
// SAME SECURITY BOUNDARY AS lib/oem/printableQuote.ts + printableReceipt.ts, SEPARATE TYPE ON PURPOSE:
// a "use client" component's ENTIRE props tree serializes into the RSC flight payload the browser downloads,
// rendered or not — so a field that isn't listed in PrintableInvoice PHYSICALLY CANNOT reach the client
// component, no matter what the JSX does or doesn't render.
//
// toPrintableInvoice() is the ONLY allowed constructor — field-by-field, NEVER `...row` spread — so a future
// column added to OemInvoiceRow does not silently ride along into the customer-facing type for free.
// Adding a field HERE is the actual decision "this is now allowed to reach the customer".
//
// EXPLICITLY EXCLUDED, forever, unless a human deliberately decides otherwise in a change that touches this file:
//   · cost/margin of ANY kind, approval_note, discount_reason, price_reason, lost_reason, calc/rate_snapshot,
//     buy-back prices (the table itself has none — kept out here too so a future column can't ride along)
//   · voidReason (staff-only — lives in InvoicePrintNotices below, rendered print:hidden), voidedBy/createdBy (user ids)
//   · staff-state flags (isStale/isOverdue/dealQuoteExpired/paymentState) — InvoicePrintNotices, a SEPARATE type,
//     so the document type can never grow a "staff warning" field that would print on paper
//   · sellerSnapshot.displayName / vatRegistered (marketing name / internal flag — vatDisplay is the only VAT decision)
//
// THE FIXED LINE (design-oem-invoice.md §15.1, owner decision 16 Oct 2026): every invoice carries
// "เอกสารนี้ไม่ใช่ใบกำกับภาษี" ON THE PAPER regardless of vat_display. It is a REQUIRED field (notTaxInvoiceText) set by the
// constructor from a constant — PrintInvoiceClient must render it unconditionally (not print:hidden, no branch on
// vatDisplay/kind/status). There is no isFullTaxInvoice-style branch anywhere in this document type (design §14 ข้อ 9).

import type { OemCustomerAddress, OemInvoiceKind, OemInvoicePaymentState, OemInvoiceRow, OemInvoiceStatus, OemInvoiceVatDisplay } from "./types";
import { OEM_INVOICE_NOT_TAX_INVOICE_TH, OEM_INVOICE_PAY_BEFORE_WORK_TH } from "./types";
import { thaiBahtText } from "./printableReceipt";

export interface PrintableInvoiceSeller {
  legalName: string | null;
  branchLabel: string | null;
  addressLines: string[];
  taxId: string | null;
  phone: string | null;
}

export interface PrintableInvoiceLine {
  seq: number;
  name: string;
  sku: string | null;
  qty: number;
  unitPriceThb: number;
  lineTotalThb: number;
}

export interface PrintableInvoice {
  id: string;
  invoiceNo: string;
  /** 'void' -> พิมพ์ลายน้ำ "ยกเลิก" (ติดกระดาษได้) — เหตุผลที่ยกเลิกไม่อยู่ที่นี่ */
  status: OemInvoiceStatus;
  kind: OemInvoiceKind;
  issueDate: string;
  /** กำหนดชำระ (เวลาไทย) — ใบมัดจำที่ due = issue ให้พิมพ์ payBeforeWorkText แทนวันที่ (ตามมติ "ชำระก่อนเริ่มงาน") */
  dueDate: string;
  /** "ชำระก่อนเริ่มงาน" เฉพาะใบมัดจำ (flag แช่แข็งตอนออกใบ) · null = ไม่พิมพ์ */
  payBeforeWorkText: string | null;
  /** 🔴 บรรทัดคงที่ "เอกสารนี้ไม่ใช่ใบกำกับภาษี" — บังคับพิมพ์บนกระดาษทุกใบ ห้าม print:hidden ห้ามผูกเงื่อนไข */
  notTaxInvoiceText: string;
  /** ข้อความที่ระบบ generate ตอนออกใบ (แช่แข็ง) — DB รับรองว่าไม่มีคำว่าภาษี/VAT เมื่อร้านไม่จด VAT */
  description: string;
  /** หมายเหตุถึงลูกค้า (พนักงานพิมพ์ตอนออกใบ) */
  note: string | null;
  seller: PrintableInvoiceSeller;
  /** ช่องทางชำระเงิน ณ วันออกใบ (snapshot — เปลี่ยนบัญชีทีหลังใบเก่าไม่ขยับ) ทีละบรรทัด */
  paymentLines: string[];
  buyerLegalName: string;
  buyerTaxId: string | null;
  buyerBranchLabel: string | null;
  buyerAddress: OemCustomerAddress | null;
  /** เลขที่ใบเสนอราคาต้นทาง ณ วันออกใบนี้ (snapshot) */
  quoteNoSnapshot: string;
  lines: PrintableInvoiceLine[];
  /** ค่าสินค้ารวม / ค่าแบบ (NRE ราคาขาย) / ส่วนลด (ตัวเลขเท่านั้น ไม่มีเหตุผล) / ยอดรวมใบเสนอราคา — ค่าสินค้า + ค่าแบบ − ส่วนลด = ยอดรวม เป๊ะ */
  piecesSubtotalThb: number;
  nrePriceThb: number;
  discountThb: number;
  grandTotalThb: number;
  /** รับแล้วก่อนใบนี้ · ยอดใบนี้ (กล่อง "ยอดที่ต้องชำระครั้งนี้") · คงเหลือหลังใบนี้ — paidBefore + amount + balanceAfter = grandTotal เป๊ะ */
  paidBeforeThb: number;
  amountThb: number;
  amountInWordsTh: string;
  balanceAfterThb: number;
  /** ตัดสินครั้งเดียวตอนออกใบ: 'none' = ห้ามมีคำว่า VAT/ภาษีมูลค่าเพิ่ม/อัตราภาษีที่ไหนบนกระดาษ (vatRate/Base/Amount เป็น null ด้วย) */
  vatDisplay: OemInvoiceVatDisplay;
  vatRate: number | null;
  vatBaseThb: number | null;
  /** amountThb − vatBaseThb (remainder) — vatBaseThb + vatAmountThb = amountThb เป๊ะ */
  vatAmountThb: number | null;
  /** วันเวลาที่ยกเลิก (ใช้คู่กับลายน้ำ) · null เว้นแต่ status = 'void' */
  voidedAt: string | null;
}

function toPrintableSeller(row: OemInvoiceRow): PrintableInvoiceSeller {
  return {
    legalName: row.sellerSnapshot.legalName,
    branchLabel: row.sellerSnapshot.branchLabel,
    addressLines: row.sellerSnapshot.addressLines ?? [],
    taxId: row.sellerSnapshot.taxId,
    phone: row.sellerSnapshot.phone,
  };
}

/** The only constructor for PrintableInvoice — call once, server-side, in the print page.tsx, before anything
 * crosses into the "use client" boundary. Field-by-field on purpose (see header). */
export function toPrintableInvoice(row: OemInvoiceRow): PrintableInvoice {
  // 'none' = ร้านไม่จด VAT: บังคับ null ซ้ำที่ชั้นนี้ (ไม่เชื่อ row ที่อาจถูกประกอบมาผิด) — กระดาษห้ามมีอัตราภาษี
  const noVat = row.vatDisplay === "none";
  return {
    id: row.id,
    invoiceNo: row.invoiceNo,
    status: row.status,
    kind: row.kind,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    payBeforeWorkText: row.payBeforeWork ? OEM_INVOICE_PAY_BEFORE_WORK_TH : null,
    notTaxInvoiceText: OEM_INVOICE_NOT_TAX_INVOICE_TH,
    description: row.description,
    note: row.note,
    seller: toPrintableSeller(row),
    paymentLines: row.paymentLines.map((l) => l),
    buyerLegalName: row.buyerLegalName,
    buyerTaxId: row.buyerTaxId,
    buyerBranchLabel: row.buyerBranchLabel,
    buyerAddress: row.buyerAddress,
    quoteNoSnapshot: row.quoteNoSnapshot,
    lines: row.lines.map((l) => ({
      seq: l.seq,
      name: l.name,
      sku: l.sku,
      qty: l.qty,
      unitPriceThb: l.unitPriceThb,
      lineTotalThb: l.lineTotalThb,
    })),
    piecesSubtotalThb: row.piecesSubtotalThb,
    nrePriceThb: row.nrePriceThb,
    discountThb: row.discountThb,
    grandTotalThb: row.grandTotalThb,
    paidBeforeThb: row.paidBeforeThb,
    amountThb: row.amountThb,
    amountInWordsTh: thaiBahtText(row.amountThb),
    balanceAfterThb: row.balanceAfterThb,
    vatDisplay: row.vatDisplay,
    vatRate: noVat ? null : row.vatRate,
    vatBaseThb: noVat ? null : row.vatBaseThb,
    vatAmountThb: noVat ? null : row.vatAmountThb,
    voidedAt: row.status === "void" ? row.voidedAt : null,
  };
}

/** สถานะสำหรับ "พนักงาน" บนหน้าจอพิมพ์ — แยกจาก PrintableInvoice ตั้งใจ: ทุกอย่างในนี้ต้องแสดงด้วย print:hidden
 * (ห้ามติดกระดาษที่ส่งลูกค้า — เคยหลุดมาแล้วในใบเสนอราคา · invariants ข้อ 8) · ไม่มีข้อมูลต้นทุน/margin */
export interface InvoicePrintNotices {
  isVoid: boolean;
  /** เหตุผลที่ยกเลิก — จอเท่านั้น (null เว้นแต่ void) */
  voidReason: string | null;
  /** ยอดดีลเปลี่ยนหลังออกใบ (ต่อราคา/รับเงินไม่อ้างใบ) */
  isStale: boolean;
  /** 🔴 true = ปุ่มพิมพ์ต้องถูกบล็อก (ใบที่ยังออกอยู่แต่ยอดเปลี่ยนแล้ว — ต้องยกเลิกแล้วออกใหม่) · ใบ void พิมพ์ได้ (ลายน้ำ) */
  blockPrint: boolean;
  /** เลยกำหนดชำระ (ไม่นับใบมัดจำ "ชำระก่อนเริ่มงาน" ที่ due = วันออก) */
  isOverdue: boolean;
  dueDate: string;
  /** ใบเสนอราคา active ของดีลหมดอายุแล้ว — ออกได้แต่เตือน */
  dealQuoteExpired: boolean;
  quoteValidUntil: string | null;
  /** ใบเสนอราคาที่ออกใบนี้ถูกต่อราคาไปแล้ว -> ลิงก์ไปใบที่ใช้งานอยู่ */
  isDealActive: boolean;
  activeQuoteId: string | null;
  activeQuoteNo: string | null;
  paymentState: OemInvoicePaymentState;
  /** เลขใบเสร็จที่อ้างใบนี้ (null จนกว่า 0180) */
  receiptNo: string | null;
}

export function toInvoicePrintNotices(row: OemInvoiceRow): InvoicePrintNotices {
  const isVoid = row.status === "void";
  return {
    isVoid,
    voidReason: isVoid ? row.voidReason : null,
    isStale: row.isStale,
    blockPrint: row.status === "issued" && row.isStale,
    isOverdue: row.isOverdue,
    dueDate: row.dueDate,
    dealQuoteExpired: row.dealQuoteExpired,
    quoteValidUntil: row.quoteValidUntil,
    isDealActive: row.isDealActive,
    activeQuoteId: row.activeQuoteId,
    activeQuoteNo: row.dealQuoteNo,
    paymentState: row.paymentState,
    receiptNo: row.receiptNo,
  };
}
