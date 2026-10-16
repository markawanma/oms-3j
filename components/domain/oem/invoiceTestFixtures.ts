// fixtures สำหรับเทสต์ใบแจ้งหนี้ (ใช้ร่วม InvoiceDialogs / InvoiceSection / PrintInvoiceClient)
// ค่าทุกตัวเป็นของทดสอบที่เห็นชัดว่าไม่จริง — ห้ามใส่เลขบัญชี/ชื่อธนาคารที่ดูจริง
import type { OemInvoiceRow, OemQuoteRow, OemReceiptRow } from "@/lib/oem/types";
import { EMPTY_SELLER_PROFILE } from "@/lib/oem/sellerProfile";
import type { SellerProfile } from "@/lib/oem/sellerProfile";

export const QUOTE_ID = "11111111-1111-4111-8111-111111111111";
export const INV_ID = "22222222-2222-4222-8222-222222222222";

export const SELLER_OK: SellerProfile = {
  ...EMPTY_SELLER_PROFILE,
  legalName: "ร้านทดสอบ TEST-ONLY",
  addressLines: ["TEST-ONLY ที่อยู่ร้าน"],
  taxId: "0000000000000",
  phone: "000-000-0000",
  vatRegistered: false,
  paymentLines: ["TEST-ONLY ช่องทางชำระ"],
};

type QuoteOver = Partial<OemQuoteRow>;

/** quote ขั้นต่ำที่ InvoiceSection/InvoiceIssueDialog อ่าน — cast เพราะ OemQuoteRow มีฟิลด์อื่นอีกมากที่ใบแจ้งหนี้ไม่แตะ */
export function quoteFx(over: QuoteOver = {}): OemQuoteRow {
  return {
    id: QUOTE_ID,
    quoteNo: "OEM-2610-004",
    status: "quoted",
    isExpiredTh: false,
    quoteValidUntil: "2026-11-15",
    depositMode: null,
    depositInput: null,
    depositAmountThb: null,
    grandTotal: 10000,
    paidThb: 0,
    outstandingThb: 10000,
    vatMode: "included",
    billLegalName: "ผู้ซื้อทดสอบ",
    ...over,
  } as unknown as OemQuoteRow;
}

export function invoiceFx(over: Partial<OemInvoiceRow> = {}): OemInvoiceRow {
  return {
    id: INV_ID,
    shopId: "shop",
    quoteId: QUOTE_ID,
    invoiceNo: "IV-2610-001",
    kind: "deposit",
    status: "issued",
    amountThb: 5000,
    vatDisplay: "none",
    vatRate: null,
    vatBaseThb: null,
    vatAmountThb: null,
    issueDate: "2026-10-16",
    dueDate: "2026-10-16",
    payBeforeWork: true,
    description: "เงินมัดจำตามใบเสนอราคา OEM-2610-004",
    note: null,
    paymentLines: ["TEST-ONLY ช่องทางชำระ"],
    buyerLegalName: "ผู้ซื้อทดสอบ",
    quoteNoSnapshot: "OEM-2610-004",
    grandTotalThb: 10000,
    paidBeforeThb: 0,
    balanceAfterThb: 5000,
    voidReason: null,
    voidedAt: null,
    replacesInvoiceId: null,
    quoteNo: "OEM-2610-004",
    isDealActive: true,
    activeQuoteId: QUOTE_ID,
    paymentState: "unpaid",
    isStale: false,
    isOverdue: false,
    receiptId: null,
    receiptNo: null,
    ...over,
  } as unknown as OemInvoiceRow;
}

/** ใบเสร็จขั้นต่ำ (I2) — cast เพราะ OemReceiptRow มีฟิลด์อื่นอีกมากที่ ReceiptSection/PrintReceiptClient ไม่แตะ */
export function receiptFx(over: Partial<OemReceiptRow> = {}): OemReceiptRow {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    shopId: "shop",
    quoteId: QUOTE_ID,
    receiptNo: "RT-2610-001",
    kind: "deposit",
    status: "issued",
    amountThb: 5000,
    vatRate: 0.07,
    vatBaseThb: 4672.9,
    vatAmountThb: 327.1,
    receivedDate: "2026-10-16",
    issueDate: "2026-10-16",
    paymentMethod: "transfer",
    paymentRef: null,
    description: "เงินมัดจำงาน OEM ตามใบเสนอราคา OEM-2610-004",
    sellerSnapshot: { legalName: "ร้านทดสอบ TEST-ONLY", displayName: null, branchLabel: "สำนักงานใหญ่", addressLines: ["TEST-ONLY ที่อยู่ร้าน"], taxId: "0000000000000", phone: "000-000-0000" },
    buyerLegalName: "ผู้ซื้อทดสอบ",
    buyerTaxId: null,
    buyerBranchLabel: null,
    buyerAddress: null,
    quoteNoSnapshot: "OEM-2610-004",
    grandTotalSnapshot: 10000,
    paidBeforeThb: 0,
    balanceAfterThb: 5000,
    voidReason: null,
    voidedAt: null,
    voidedBy: null,
    reissuedFromReceiptId: null,
    invoiceId: null,
    invoiceNoSnapshot: null,
    createdBy: null,
    createdAt: "2026-10-16T01:00:00Z",
    quoteNo: "OEM-2610-004",
    isDealActive: true,
    ...over,
  } as unknown as OemReceiptRow;
}
