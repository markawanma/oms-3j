// lib/oem/printableInvoice.test.ts — ขอบเขตความปลอดภัยของใบแจ้งหนี้ OEM (0179)
//   - leak test ด้วยค่าวางยา: field ลับ/ภายในที่ถูกยัดมาใน row (ต้นทุน/approval/เหตุผล void/user id/…) ต้องไม่โผล่ใน PrintableInvoice
//   - key set ของ PrintableInvoice / seller / line ตรงตัว (เพิ่ม field = ต้องแก้เทสต์นี้ = ตัดสินใจเองว่าลูกค้าเห็นได้)
//   - บรรทัดคงที่ "เอกสารนี้ไม่ใช่ใบกำกับภาษี" ติดทุกใบ ไม่ขึ้นกับ kind/vat_display/status (มติเจ้าของ §15.1)
//   - ร้านไม่จด VAT = ทุกช่อง VAT เป็น null แม้ row หลุดมา · สถานะพนักงานอยู่ใน InvoicePrintNotices แยก
import { describe, expect, it } from "vitest";
import type { OemInvoiceRow } from "./types";
import { OEM_INVOICE_NOT_TAX_INVOICE_TH, OEM_INVOICE_PAY_BEFORE_WORK_TH } from "./types";
import { toInvoicePrintNotices, toPrintableInvoice } from "./printableInvoice";

const POISON = {
  voidReason: "POISON-VOID-REASON",
  displayName: "POISON-DISPLAY-NAME",
  approvalNote: "POISON-APPROVAL-NOTE",
  discountReason: "POISON-DISCOUNT-REASON",
  lostReason: "POISON-LOST-REASON",
  cost: 777.77,
  margin: 0.4242,
  createdBy: "POISON-USER-CREATED",
  voidedBy: "POISON-USER-VOIDED",
  calc: "POISON-CALC-BLOB",
  shopId: "POISON-SHOP-ID",
  dealRootId: "POISON-DEAL-ROOT",
};

function row(over: Partial<OemInvoiceRow> = {}): OemInvoiceRow {
  const base: OemInvoiceRow = {
    id: "inv-1",
    shopId: POISON.shopId,
    quoteId: "quote-1",
    invoiceNo: "IV-2610-001",
    kind: "deposit",
    status: "issued",
    amountThb: 5000.51,
    vatDisplay: "breakdown",
    vatRate: 0.07,
    vatBaseThb: 4673.37,
    vatAmountThb: 327.14,
    issueDate: "2026-10-16",
    dueDate: "2026-10-16",
    payBeforeWork: true,
    description: "เงินมัดจำ 50% ตามใบเสนอราคา OEM-2610-004",
    note: "ขอบคุณลูกค้า",
    sellerSnapshot: {
      legalName: "ร้านทดสอบ จำกัด",
      displayName: POISON.displayName,
      branchLabel: "สำนักงานใหญ่",
      addressLines: ["1 ถนนทดสอบ", "กรุงเทพ 10110"],
      taxId: "0000000000000",
      phone: "000-000-0000",
      vatRegistered: true,
    },
    paymentLines: ["TEST-ONLY บัญชีทดสอบ (ห้ามใช้จริง)"],
    buyerLegalName: "ผู้ซื้อทดสอบ",
    buyerTaxId: null,
    buyerBranchLabel: null,
    buyerAddress: null,
    quoteNoSnapshot: "OEM-2610-004",
    lines: [{ seq: 1, name: "สินค้าทดสอบ", sku: "TEST-SKU", qty: 2, unitPriceThb: 5000.505, lineTotalThb: 10001.01 }],
    piecesSubtotalThb: 10001.01,
    nrePriceThb: 0,
    discountThb: 0,
    grandTotalThb: 10001.01,
    depositAmountSnapshotThb: 5000.51,
    depositPctSnapshot: 0.5,
    paidBeforeThb: 0,
    balanceAfterThb: 5000.5,
    voidReason: null,
    voidedAt: null,
    replacesInvoiceId: null,
    createdAt: "2026-10-16T01:00:00Z",
    quoteNo: "OEM-2610-004",
    quoteStatus: "quoted",
    dealRootId: POISON.dealRootId,
    isDealActive: true,
    activeQuoteId: "quote-1",
    dealQuoteNo: "OEM-2610-004",
    dealQuoteStatus: "quoted",
    dealGrandTotalThb: 10001.01,
    dealPaidThb: 0,
    quoteValidUntil: "2026-11-15",
    dealQuoteExpired: false,
    paymentState: "unpaid",
    isStale: false,
    isOverdue: false,
    receiptId: null,
    receiptNo: null,
    receivedDate: null,
  };
  // ค่าวางยา: field ที่ไม่มีใน type — จำลอง row จาก view/ตารางที่เพิ่มคอลัมน์ในอนาคตแล้วหลุดเข้ามาทาง cast
  const poisoned = {
    ...base,
    costPiece: POISON.cost,
    marginChargedPct: POISON.margin,
    approvalNote: POISON.approvalNote,
    discountReason: POISON.discountReason,
    lostReason: POISON.lostReason,
    createdBy: POISON.createdBy,
    voidedBy: POISON.voidedBy,
    calc: { breakdown: POISON.calc },
    rateSnapshot: { x: POISON.calc },
    ...over,
  };
  // ฝังค่าวางยาในบรรทัดรายการด้วย (คีย์นอก whitelist ต้องถูกทิ้ง)
  poisoned.lines = (poisoned.lines as OemInvoiceRow["lines"]).map((l) => ({ ...l, cost: POISON.cost, costPiece: POISON.cost, calc: POISON.calc }) as unknown as OemInvoiceRow["lines"][number]);
  return poisoned as unknown as OemInvoiceRow;
}

const PRINTABLE_KEYS = [
  "amountInWordsTh", "amountThb", "balanceAfterThb", "buyerAddress", "buyerBranchLabel", "buyerLegalName", "buyerTaxId",
  "description", "discountThb", "dueDate", "grandTotalThb", "id", "invoiceNo", "issueDate", "kind", "lines", "note",
  "notTaxInvoiceText", "nrePriceThb", "paidBeforeThb", "payBeforeWorkText", "paymentLines", "piecesSubtotalThb",
  "quoteNoSnapshot", "seller", "status", "vatAmountThb", "vatBaseThb", "vatDisplay", "vatRate", "voidedAt",
].sort();

describe("toPrintableInvoice — leak test (ค่าวางยา)", () => {
  it("ไม่มีค่าวางยาตัวใดโผล่ใน PrintableInvoice (ต้นทุน/margin/approval/เหตุผล/user id/calc/shop id/ชื่อการตลาด)", () => {
    const json = JSON.stringify(toPrintableInvoice(row({ status: "void", voidReason: POISON.voidReason, voidedAt: "2026-10-17T02:00:00Z" })));
    for (const v of [POISON.voidReason, POISON.displayName, POISON.approvalNote, POISON.discountReason, POISON.lostReason, POISON.createdBy, POISON.voidedBy, POISON.calc, POISON.shopId, POISON.dealRootId]) {
      expect(json).not.toContain(v);
    }
    expect(json).not.toContain("777.77");
    expect(json).not.toContain("0.4242");
    expect(json).not.toMatch(/cost|margin|calc|approval|rateSnapshot|voidReason|createdBy|voidedBy|shopId/i);
  });

  it("key set ของ PrintableInvoice ตรงตัว (เพิ่ม field ต้องแก้เทสต์นี้ = ตัดสินใจเองว่าลูกค้าเห็นได้)", () => {
    expect(Object.keys(toPrintableInvoice(row())).sort()).toEqual(PRINTABLE_KEYS);
  });

  it("key set ของ seller และ line ตรงตัว — คีย์วางยาในบรรทัดรายการถูกทิ้ง, displayName/vatRegistered ของผู้ขายไม่ถูกส่ง", () => {
    const p = toPrintableInvoice(row());
    expect(Object.keys(p.seller).sort()).toEqual(["addressLines", "branchLabel", "legalName", "phone", "taxId"]);
    expect(p.lines).toHaveLength(1);
    expect(Object.keys(p.lines[0]).sort()).toEqual(["lineTotalThb", "name", "qty", "seq", "sku", "unitPriceThb"]);
    expect(p.lines[0]).toEqual({ seq: 1, name: "สินค้าทดสอบ", sku: "TEST-SKU", qty: 2, unitPriceThb: 5000.505, lineTotalThb: 10001.01 });
  });

  it("ไม่มี field ของสถานะพนักงาน (stale/overdue/expired/paymentState/receipt/active quote) ใน PrintableInvoice — กันหลุดติดกระดาษ", () => {
    const keys = Object.keys(toPrintableInvoice(row({ isStale: true, isOverdue: true, dealQuoteExpired: true })));
    for (const k of ["isStale", "isOverdue", "dealQuoteExpired", "paymentState", "receiptNo", "activeQuoteId", "voidReason"]) {
      expect(keys).not.toContain(k);
    }
  });
});

describe("toPrintableInvoice — บรรทัด 'ไม่ใช่ใบกำกับภาษี' (มติเจ้าของ §15.1)", () => {
  it("ติดทุกใบ: ทุก kind × vat_display × status ได้ข้อความเดียวกันจากค่าคงที่", () => {
    for (const kind of ["deposit", "balance"] as const)
      for (const vatDisplay of ["none", "included", "breakdown"] as const)
        for (const status of ["issued", "void"] as const) {
          const p = toPrintableInvoice(
            row({ kind, vatDisplay, status, payBeforeWork: kind === "deposit", voidedAt: status === "void" ? "2026-10-17T00:00:00Z" : null,
              ...(vatDisplay === "none" ? { vatRate: null, vatBaseThb: null, vatAmountThb: null } : {}) })
          );
          expect(p.notTaxInvoiceText).toBe("เอกสารนี้ไม่ใช่ใบกำกับภาษี");
          expect(p.notTaxInvoiceText).toBe(OEM_INVOICE_NOT_TAX_INVOICE_TH);
        }
  });
});

describe("toPrintableInvoice — VAT / มัดจำ / ยกเลิก", () => {
  it("vat_display = none: vatRate/base/amount เป็น null แม้ row หลุดค่ามา (กระดาษห้ามมีอัตราภาษี)", () => {
    const p = toPrintableInvoice(row({ vatDisplay: "none", vatRate: 0.07, vatBaseThb: 1, vatAmountThb: 2 }));
    expect(p.vatDisplay).toBe("none");
    expect(p.vatRate).toBeNull();
    expect(p.vatBaseThb).toBeNull();
    expect(p.vatAmountThb).toBeNull();
  });

  it("breakdown: ส่งค่า VAT ที่ DB แช่แข็งตรงๆ · base + vat = amount เป๊ะ (ไม่คำนวณซ้ำ)", () => {
    const p = toPrintableInvoice(row());
    expect(p.vatBaseThb).toBe(4673.37);
    expect(p.vatAmountThb).toBe(327.14);
    expect(Math.round(((p.vatBaseThb ?? 0) + (p.vatAmountThb ?? 0)) * 100)).toBe(Math.round(p.amountThb * 100));
  });

  it("ใบมัดจำพิมพ์ 'ชำระก่อนเริ่มงาน' · ใบคงเหลือไม่พิมพ์", () => {
    expect(toPrintableInvoice(row({ kind: "deposit", payBeforeWork: true })).payBeforeWorkText).toBe(OEM_INVOICE_PAY_BEFORE_WORK_TH);
    expect(toPrintableInvoice(row({ kind: "balance", payBeforeWork: false })).payBeforeWorkText).toBeNull();
  });

  it("ยอดเป็นตัวอักษรไทยจากยอดใบนี้ (5000.51 -> ห้าพันบาทห้าสิบเอ็ดสตางค์)", () => {
    expect(toPrintableInvoice(row()).amountInWordsTh).toBe("ห้าพันบาทห้าสิบเอ็ดสตางค์");
    expect(toPrintableInvoice(row({ amountThb: 1000 })).amountInWordsTh).toBe("หนึ่งพันบาทถ้วน");
  });

  it("ใบ void: voidedAt ติดมาให้ลายน้ำ แต่เหตุผลที่ยกเลิกไม่ติด · ใบ issued: voidedAt = null แม้ row มีค่า", () => {
    const v = toPrintableInvoice(row({ status: "void", voidReason: POISON.voidReason, voidedAt: "2026-10-17T02:00:00Z" }));
    expect(v.status).toBe("void");
    expect(v.voidedAt).toBe("2026-10-17T02:00:00Z");
    expect(JSON.stringify(v)).not.toContain(POISON.voidReason);
    expect(toPrintableInvoice(row({ status: "issued", voidedAt: "2026-10-17T02:00:00Z" })).voidedAt).toBeNull();
  });

  it("ช่องทางชำระ/หมายเหตุ/ผู้ซื้อ มาจาก snapshot ตรงๆ · addressLines null -> []", () => {
    const p = toPrintableInvoice(row({ sellerSnapshot: { ...row().sellerSnapshot, addressLines: null } }));
    expect(p.paymentLines).toEqual(["TEST-ONLY บัญชีทดสอบ (ห้ามใช้จริง)"]);
    expect(p.note).toBe("ขอบคุณลูกค้า");
    expect(p.buyerLegalName).toBe("ผู้ซื้อทดสอบ");
    expect(p.seller.addressLines).toEqual([]);
  });
});

describe("toInvoicePrintNotices — สถานะพนักงาน (print:hidden เสมอ)", () => {
  it("ใบ issued ที่ stale -> blockPrint = true", () => {
    const n = toInvoicePrintNotices(row({ isStale: true }));
    expect(n.isStale).toBe(true);
    expect(n.blockPrint).toBe(true);
  });

  it("ใบ issued ที่ไม่ stale -> พิมพ์ได้ · ใบ void ที่ stale -> ไม่บล็อก (พิมพ์ลายน้ำยกเลิกได้)", () => {
    expect(toInvoicePrintNotices(row({ isStale: false })).blockPrint).toBe(false);
    expect(toInvoicePrintNotices(row({ status: "void", isStale: true })).blockPrint).toBe(false);
  });

  it("เหตุผล void อยู่ใน notices เฉพาะใบ void (จอพนักงานเท่านั้น)", () => {
    expect(toInvoicePrintNotices(row({ status: "void", voidReason: "เหตุผลทดสอบ" })).voidReason).toBe("เหตุผลทดสอบ");
    expect(toInvoicePrintNotices(row({ status: "issued", voidReason: "เหตุผลทดสอบ" })).voidReason).toBeNull();
  });

  it("ส่งต่อ overdue / quote หมดอายุ / ใบเสนอราคา active / เลขใบเสร็จ ครบ · ไม่มีต้นทุน", () => {
    const n = toInvoicePrintNotices(row({ isOverdue: true, dealQuoteExpired: true, quoteValidUntil: "2026-10-01", isDealActive: false, activeQuoteId: "quote-2", dealQuoteNo: "OEM-2610-005" }));
    expect(n).toMatchObject({ isOverdue: true, dealQuoteExpired: true, quoteValidUntil: "2026-10-01", isDealActive: false, activeQuoteId: "quote-2", activeQuoteNo: "OEM-2610-005", paymentState: "unpaid", receiptNo: null });
    expect(JSON.stringify(n)).not.toMatch(/cost|margin|calc|approval|POISON/i);
  });
});
