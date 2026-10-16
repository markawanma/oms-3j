// lib/oem/printableReceipt.test.ts — ขอบเขตความปลอดภัยของใบเสร็จ/ใบกำกับภาษี OEM ที่ข้ามไป client (invoiceNoSnapshot เพิ่มใน 0180)
//   - key set ของ PrintableReceipt ตรงตัว (เพิ่ม field = ต้องแก้เทสต์นี้ = ตัดสินใจว่าลูกค้าเห็นได้)
//   - 🔴 invoiceId (uuid ภายใน) ไม่ผ่านมา — มีแต่เลขที่ใบแจ้งหนี้ที่ลูกค้าถืออยู่แล้ว
//   - leak test ด้วยค่าวางยา: ผู้ออก/ผู้ยกเลิก/shopId/ข้อมูลภายในไม่โผล่ใน JSON
import { describe, expect, it } from "vitest";
import type { OemReceiptRow } from "./types";
import { toPrintableReceipt } from "./printableReceipt";

const POISON = {
  createdBy: "POISON-USER-CREATED",
  voidedBy: "POISON-USER-VOIDED",
  shopId: "POISON-SHOP-ID",
  quoteId: "POISON-QUOTE-ID",
  invoiceId: "POISON-INVOICE-UUID",
  displayName: "POISON-DISPLAY-NAME",
  voidReason: "POISON-VOID-REASON",
  reissuedFrom: "POISON-REISSUED-FROM",
};

function row(over: Partial<OemReceiptRow> = {}): OemReceiptRow {
  return {
    id: "rcpt-1",
    shopId: POISON.shopId,
    quoteId: POISON.quoteId,
    receiptNo: "RT-2610-001",
    kind: "deposit",
    status: "issued",
    amountThb: 5000.51,
    vatRate: 0.07,
    vatBaseThb: 4673.37,
    vatAmountThb: 327.14,
    receivedDate: "2026-10-16",
    issueDate: "2026-10-16",
    paymentMethod: "transfer",
    paymentRef: "ref-1",
    description: "เงินมัดจำงาน OEM ตามใบเสนอราคา OEM-2610-004",
    sellerSnapshot: {
      legalName: "ร้านทดสอบ จำกัด",
      displayName: POISON.displayName,
      branchLabel: "สำนักงานใหญ่",
      addressLines: ["1 ถนนทดสอบ"],
      taxId: "0000000000000",
      phone: "000-000-0000",
    },
    buyerLegalName: "ผู้ซื้อทดสอบ",
    buyerTaxId: null,
    buyerBranchLabel: null,
    buyerAddress: null,
    quoteNoSnapshot: "OEM-2610-004",
    grandTotalSnapshot: 10001.01,
    paidBeforeThb: 0,
    balanceAfterThb: 5000.5,
    voidReason: POISON.voidReason,
    voidedAt: null,
    voidedBy: POISON.voidedBy,
    reissuedFromReceiptId: POISON.reissuedFrom,
    invoiceId: POISON.invoiceId,
    invoiceNoSnapshot: "IV-2610-001",
    createdBy: POISON.createdBy,
    createdAt: "2026-10-16T01:00:00Z",
    quoteNo: "OEM-2610-004",
    isDealActive: true,
    ...over,
  };
}

describe("toPrintableReceipt — invoiceNoSnapshot (0180)", () => {
  it("key set ตรงตัว: เพิ่ม invoiceNoSnapshot ตัวเดียว · ไม่มี invoiceId/createdBy/voidedBy/shopId/quoteId/reissuedFrom", () => {
    const p = toPrintableReceipt(row());
    expect(Object.keys(p).sort()).toEqual(
      [
        "amountInWordsTh", "amountThb", "balanceAfterThb", "buyerAddress", "buyerBranchLabel", "buyerLegalName", "buyerTaxId", "description", "grandTotalSnapshot",
        "id", "invoiceNoSnapshot", "issueDate", "kind", "paidBeforeThb", "paymentMethod", "paymentRef", "quoteNoSnapshot", "receiptNo", "receivedDate", "seller",
        "status", "vatAmountThb", "vatBaseThb", "vatRate", "voidReason", "voidedAt",
      ].sort()
    );
  });

  it("ใบที่ผูกใบแจ้งหนี้ -> invoiceNoSnapshot = เลขใบ (snapshot) · ใบที่ไม่ผูก -> null", () => {
    expect(toPrintableReceipt(row()).invoiceNoSnapshot).toBe("IV-2610-001");
    expect(toPrintableReceipt(row({ invoiceId: null, invoiceNoSnapshot: null })).invoiceNoSnapshot).toBeNull();
  });

  it("🔴 leak test: ค่าวางยาภายใน (uuid ใบแจ้งหนี้/ผู้ออก/ผู้ยกเลิก/ร้าน/ใบเสนอราคา/ชื่อเรียก/ใบเดิม) ไม่โผล่ใน JSON · voidReason ไม่ออกเมื่อ issued", () => {
    const json = JSON.stringify(toPrintableReceipt(row()));
    for (const v of Object.values(POISON)) expect(json, v).not.toContain(v);
  });

  it("ใบ void: voidReason/voidedAt ออก (จอพนักงาน print:hidden) · invoiceNoSnapshot ยังออกเหมือนเดิม · ยังไม่มี uuid ภายใน", () => {
    const p = toPrintableReceipt(row({ status: "void", voidedAt: "2026-10-17T01:00:00Z" }));
    expect(p.voidReason).toBe(POISON.voidReason);
    expect(p.voidedAt).toBe("2026-10-17T01:00:00Z");
    expect(p.invoiceNoSnapshot).toBe("IV-2610-001");
    expect(JSON.stringify(p)).not.toContain(POISON.invoiceId);
  });
});
