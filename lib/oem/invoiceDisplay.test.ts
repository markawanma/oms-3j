// lib/oem/invoiceDisplay.test.ts — ตรรกะแสดงผลใบแจ้งหนี้ (pure · ไม่มีเงินถูกคำนวณ)
//   resolveInvoiceKind ทุกแถวของตาราง + ไม่เกิน 1 ชนิด · resolveInvoiceDisplayStatus ลำดับ + มัดจำ due=issue ข้ามวัน = รอชำระ
//   formatDueText 3 เคส · resolveInvoiceGate ครบ 14 ข้อ + ลำดับ "ข้อแรกที่ตรงชนะ" + [] ต่างจาก null
import { describe, expect, it } from "vitest";
import type { OemInvoiceRow } from "./types";
import { OEM_INVOICE_PAY_BEFORE_WORK_TH } from "./types";
import { EMPTY_SELLER_PROFILE } from "./sellerProfile";
import type { SellerProfile } from "./sellerProfile";
import {
  formatDueText,
  invoiceBlockReasonTh,
  issueButtonLabelTh,
  resolveInvoiceDisplayStatus,
  resolveInvoiceGate,
  resolveInvoiceKind,
} from "./invoiceDisplay";
import type { InvoiceGateInput } from "./invoiceDisplay";

type KindIn = Parameters<typeof resolveInvoiceKind>[0];

function kindIn(over: Partial<KindIn> = {}): KindIn {
  return { depositMode: null, depositAmountThb: null, grandTotal: 10000, paidThb: 0, outstandingThb: 10000, ...over };
}

describe("resolveInvoiceKind — ตารางตัดสินชนิด", () => {
  it("ตั้งมัดจำ + paid=0 → deposit", () => {
    const r = resolveInvoiceKind(kindIn({ depositMode: "pct", depositAmountThb: 5000 }));
    expect(r).toEqual({ kind: "deposit", isFull: false, block: null });
    expect(issueButtonLabelTh(r as Extract<typeof r, { block: null }>)).toBe("ออกใบแจ้งหนี้มัดจำ");
  });
  it("ตั้งมัดจำ + paid>0 → balance (ยอดคงเหลือ)", () => {
    const r = resolveInvoiceKind(kindIn({ depositMode: "pct", depositAmountThb: 5000, paidThb: 5000, outstandingThb: 5000 }));
    expect(r).toEqual({ kind: "balance", isFull: false, block: null });
    expect(issueButtonLabelTh(r as Extract<typeof r, { block: null }>)).toBe("ออกใบแจ้งหนี้ยอดคงเหลือ");
  });
  it("ไม่ตั้งมัดจำ + paid=0 → balance ยอดเต็ม (kind balance)", () => {
    const r = resolveInvoiceKind(kindIn());
    expect(r).toEqual({ kind: "balance", isFull: true, block: null });
    expect(issueButtonLabelTh(r as Extract<typeof r, { block: null }>)).toBe("ออกใบแจ้งหนี้ยอดเต็ม");
  });
  it("ไม่ตั้งมัดจำ + paid>0 → balance ยอดคงเหลือ", () => {
    const r = resolveInvoiceKind(kindIn({ paidThb: 3000, outstandingThb: 7000 }));
    expect(r).toEqual({ kind: "balance", isFull: false, block: null });
  });
  it("paidThb เป็น null ถือว่ายังไม่เคยรับเงิน", () => {
    expect(resolveInvoiceKind(kindIn({ paidThb: null }))).toMatchObject({ kind: "balance", isFull: true });
    expect(resolveInvoiceKind(kindIn({ paidThb: null, depositMode: "thb", depositAmountThb: 1 }))).toMatchObject({ kind: "deposit" });
  });
  it("มัดจำ = ยอดรวมพอดี (100%) ผ่าน (ขอบบน)", () => {
    expect(resolveInvoiceKind(kindIn({ depositMode: "pct", depositAmountThb: 10000 }))).toMatchObject({ kind: "deposit" });
  });

  it("ยอดคงเหลือติดลบ → block negative (ชนะทุกอย่าง)", () => {
    expect(resolveInvoiceKind(kindIn({ outstandingThb: -0.01, paidThb: 10000.01 }))).toMatchObject({ kind: null, block: "negative" });
  });
  it("คงเหลือ 0 → block fully_paid", () => {
    expect(resolveInvoiceKind(kindIn({ outstandingThb: 0, paidThb: 10000 }))).toMatchObject({ kind: null, block: "fully_paid" });
  });
  it("ไม่มียอดรวม/คงเหลือ (null/NaN) → block no_total", () => {
    expect(resolveInvoiceKind(kindIn({ grandTotal: null }))).toMatchObject({ block: "no_total" });
    expect(resolveInvoiceKind(kindIn({ outstandingThb: null }))).toMatchObject({ block: "no_total" });
    expect(resolveInvoiceKind(kindIn({ outstandingThb: Number.NaN }))).toMatchObject({ block: "no_total" });
  });
  it("มัดจำไม่อยู่ใน (0, grand] → block deposit_invalid (null / 0 / ติดลบ / เกินยอดรวม)", () => {
    for (const d of [null, 0, -1, 10000.01]) {
      expect(resolveInvoiceKind(kindIn({ depositMode: "thb", depositAmountThb: d }))).toMatchObject({ kind: null, block: "deposit_invalid" });
    }
  });
  it("มัดจำไม่ถูกต้องแต่ paid>0 → ไม่ใช่เรื่องของใบนี้ (ใช้ balance ได้)", () => {
    expect(resolveInvoiceKind(kindIn({ depositMode: "thb", depositAmountThb: 99999, paidThb: 1000, outstandingThb: 9000 }))).toMatchObject({
      kind: "balance",
    });
  });

  it("ทุกชุดค่า: ออกได้ไม่เกิน 1 ชนิด (kind เป็น deposit | balance | null เท่านั้น) + ไม่มี field ยอดเงินใน result", () => {
    const modes: KindIn["depositMode"][] = [null, "pct", "thb"];
    const deposits = [null, 0, 2500, 10000, 20000];
    const paids = [null, 0, 2500, 10000, 12000];
    const grands = [null, 10000];
    let count = 0;
    for (const depositMode of modes)
      for (const depositAmountThb of deposits)
        for (const paidThb of paids)
          for (const grandTotal of grands) {
            const outstandingThb = grandTotal == null ? null : grandTotal - (paidThb ?? 0);
            const r = resolveInvoiceKind({ depositMode, depositAmountThb, grandTotal, paidThb, outstandingThb });
            expect([null, "deposit", "balance"]).toContain(r.kind);
            expect(Object.keys(r).sort()).toEqual(["block", "isFull", "kind"]);
            if (r.kind !== null) expect(r.block).toBeNull();
            else expect(r.block).not.toBeNull();
            count++;
          }
    expect(count).toBe(3 * 5 * 5 * 2);
  });
});

type StatusIn = Parameters<typeof resolveInvoiceDisplayStatus>[0];
function statusIn(over: Partial<StatusIn> = {}): StatusIn {
  return {
    status: "issued",
    paymentState: "unpaid",
    isStale: false,
    isOverdue: false,
    kind: "balance",
    issueDate: "2026-10-16",
    dueDate: "2026-10-23",
    payBeforeWork: false,
    ...over,
  };
}

describe("resolveInvoiceDisplayStatus — ลำดับ void → paid → stale → overdue → pending", () => {
  it("รอชำระเป็นค่าเริ่ม", () => {
    expect(resolveInvoiceDisplayStatus(statusIn())).toBe("pending");
  });
  it("void ชนะทุกอย่าง", () => {
    expect(resolveInvoiceDisplayStatus(statusIn({ status: "void", paymentState: "void", isStale: true, isOverdue: true }))).toBe("void");
    expect(resolveInvoiceDisplayStatus(statusIn({ paymentState: "void" }))).toBe("void");
  });
  it("paid ชนะ stale/overdue", () => {
    expect(resolveInvoiceDisplayStatus(statusIn({ paymentState: "paid", isStale: true, isOverdue: true }))).toBe("paid");
  });
  it("stale ชนะ overdue", () => {
    expect(resolveInvoiceDisplayStatus(statusIn({ isStale: true, isOverdue: true }))).toBe("stale");
  });
  it("overdue", () => {
    expect(resolveInvoiceDisplayStatus(statusIn({ isOverdue: true }))).toBe("overdue");
  });
  it("มัดจำ due=issue ข้ามวัน = รอชำระ ไม่ใช่เลยกำหนด (แม้ flag isOverdue จะหลุดมาเป็น true)", () => {
    const dep = statusIn({ kind: "deposit", issueDate: "2026-10-16", dueDate: "2026-10-16", payBeforeWork: true, isOverdue: true });
    expect(resolveInvoiceDisplayStatus(dep)).toBe("pending");
    // กันกรณี flag payBeforeWork หลุด — due = issue ของใบมัดจำก็ยังนับเป็นก่อนเริ่มงาน
    expect(resolveInvoiceDisplayStatus({ ...dep, payBeforeWork: false })).toBe("pending");
  });
  it("มัดจำที่ตั้งวันเอง (due > issue) เลยกำหนดได้ปกติ · ใบคงเหลือ due=issue เลยกำหนดได้", () => {
    expect(resolveInvoiceDisplayStatus(statusIn({ kind: "deposit", dueDate: "2026-10-20", isOverdue: true }))).toBe("overdue");
    expect(resolveInvoiceDisplayStatus(statusIn({ kind: "balance", dueDate: "2026-10-16", isOverdue: true }))).toBe("overdue");
  });
});

describe("formatDueText — 3 เคส", () => {
  it("มัดจำ due=issue → ชำระก่อนเริ่มงาน (ไม่มีวันที่)", () => {
    const t = formatDueText({ kind: "deposit", issueDate: "2026-10-16", dueDate: "2026-10-16", payBeforeWork: true });
    expect(t).toBe(OEM_INVOICE_PAY_BEFORE_WORK_TH);
    expect(t).not.toMatch(/\d/);
  });
  it("มัดจำตั้งวันเอง → ชำระภายใน <วันที่> (ก่อนเริ่มงาน)", () => {
    const t = formatDueText({ kind: "deposit", issueDate: "2026-10-16", dueDate: "2026-10-23", payBeforeWork: false });
    expect(t).toMatch(/^ชำระภายใน .+ \(ก่อนเริ่มงาน\)$/);
    expect(t).toContain("2569");
  });
  it("คงเหลือ → ชำระภายใน <วันที่> (ไม่มี 'ก่อนเริ่มงาน')", () => {
    const t = formatDueText({ kind: "balance", issueDate: "2026-10-16", dueDate: "2026-10-23", payBeforeWork: false });
    expect(t).toMatch(/^ชำระภายใน /);
    expect(t).not.toContain("ก่อนเริ่มงาน");
  });
});

// ---------------------------------------------------------------------------
// ด่านปุ่มออกใบ 14 ข้อ
// ---------------------------------------------------------------------------

const SELLER_OK: SellerProfile = {
  ...EMPTY_SELLER_PROFILE,
  legalName: "ร้านทดสอบ TEST-ONLY",
  addressLines: ["TEST-ONLY ที่อยู่ร้าน"],
  taxId: "0000000000000",
  phone: "000-000-0000",
  paymentLines: ["TEST-ONLY ช่องทางชำระ"],
};

function inv(over: Partial<OemInvoiceRow> = {}): OemInvoiceRow {
  return {
    id: "inv-1",
    invoiceNo: "IV-2610-001",
    status: "issued",
    paymentState: "unpaid",
    isStale: false,
    ...over,
  } as OemInvoiceRow;
}

type GateOver = Partial<Omit<InvoiceGateInput, "quote">> & { quote?: Partial<InvoiceGateInput["quote"]> };

function gateIn(over: GateOver = {}): InvoiceGateInput {
  const { quote, ...rest } = over;
  return {
    quote: {
      status: "quoted",
      billLegalName: "ผู้ซื้อทดสอบ",
      depositMode: null,
      depositAmountThb: null,
      grandTotal: 10000,
      paidThb: 0,
      outstandingThb: 10000,
      ...quote,
    },
    invoices: [],
    invoicesError: null,
    sellerProfile: SELLER_OK,
    ...rest,
  };
}

describe("resolveInvoiceGate — 14 ข้อ (ข้อแรกที่ตรงชนะ)", () => {
  it("14 ผ่าน → ready พร้อมชื่อปุ่ม (quoted / expired / won ออกได้)", () => {
    for (const status of ["quoted", "expired", "won"] as const) {
      expect(resolveInvoiceGate(gateIn({ quote: { status } }))).toEqual({
        state: "ready",
        kind: "balance",
        isFull: true,
        labelTh: "ออกใบแจ้งหนี้ยอดเต็ม",
      });
    }
    expect(resolveInvoiceGate(gateIn({ quote: { depositMode: "pct", depositAmountThb: 5000 } }))).toMatchObject({ state: "ready", kind: "deposit" });
  });

  it("1 invoicesError → ซ่อน แดง (ชนะทุกข้อ แม้ draft)", () => {
    const g = resolveInvoiceGate(gateIn({ invoicesError: "boom", quote: { status: "draft" } }));
    expect(g).toMatchObject({ state: "hidden", reason: "load_error", tone: "red" });
  });
  it("2 draft → ซ่อน", () => {
    expect(resolveInvoiceGate(gateIn({ quote: { status: "draft" } }))).toMatchObject({
      state: "hidden",
      reason: "draft",
      message: "ออกใบแจ้งหนี้ได้เมื่อใบเสนอราคาอยู่สถานะเสนอราคาแล้ว",
    });
  });
  it("3 lost / rejected → ซ่อน", () => {
    for (const status of ["lost", "rejected"] as const) {
      expect(resolveInvoiceGate(gateIn({ quote: { status } }))).toMatchObject({ state: "hidden", reason: "closed" });
    }
  });
  it("4 superseded → ซ่อน", () => {
    expect(resolveInvoiceGate(gateIn({ quote: { status: "superseded" } }))).toMatchObject({ state: "hidden", reason: "superseded" });
  });
  it("5 มีใบ stale ค้าง → ซ่อน ส้ม + รู้ว่าใบไหนต้อง void (ชนะ 6)", () => {
    const g = resolveInvoiceGate(gateIn({ invoices: [inv({ id: "stale-1", invoiceNo: "IV-2610-009", isStale: true })] }));
    expect(g).toMatchObject({ state: "hidden", reason: "stale_open", tone: "orange", invoiceId: "stale-1" });
    expect((g as { message: string }).message).toContain("IV-2610-009");
  });
  it("6 มีใบเปิดค้าง (ไม่ stale) → ซ่อน + บอกเลขที่", () => {
    const g = resolveInvoiceGate(gateIn({ invoices: [inv()] }));
    expect(g).toMatchObject({ state: "hidden", reason: "open_invoice" });
    expect((g as { message: string }).message).toContain("IV-2610-001");
  });
  it("6 ไม่นับ: ใบ void / ใบชำระแล้ว ไม่ใช่ใบเปิดค้าง", () => {
    expect(resolveInvoiceGate(gateIn({ invoices: [inv({ status: "void", paymentState: "void" })] })).state).toBe("ready");
    expect(resolveInvoiceGate(gateIn({ invoices: [inv({ paymentState: "paid" })] })).state).toBe("ready");
  });
  it("7 ข้อมูลร้านไม่ครบ → disabled เหลือง + ไปที่ /oem/rates", () => {
    const g = resolveInvoiceGate(gateIn({ sellerProfile: { ...SELLER_OK, taxId: null } }));
    expect(g).toMatchObject({ state: "disabled", reason: "seller_incomplete", tone: "amber", action: "rates" });
    expect((g as { message: string }).message).toContain("เลขประจำตัวผู้เสียภาษี");
  });
  it("8 paymentLines [] → disabled 'ยังไม่ได้ตั้ง' + ปุ่มไปตั้งค่า", () => {
    const g = resolveInvoiceGate(gateIn({ sellerProfile: { ...SELLER_OK, paymentLines: [] } }));
    expect(g).toMatchObject({ state: "disabled", reason: "payment_lines_empty", action: "payment_lines" });
    expect((g as { message: string }).message).toContain("ยังไม่ได้ตั้งช่องทางชำระเงิน");
  });
  it("9 paymentLines null → disabled แดง 'โหลดไม่สำเร็จ' — ห้ามพูดว่ายังไม่ได้ตั้ง", () => {
    const g = resolveInvoiceGate(gateIn({ sellerProfile: { ...SELLER_OK, paymentLines: null } }));
    expect(g).toMatchObject({ state: "disabled", reason: "payment_lines_unreadable", tone: "red", action: null });
    const msg = (g as { message: string }).message;
    expect(msg).toContain("โหลดช่องทางชำระไม่สำเร็จ");
    expect(msg).not.toContain("ยังไม่ได้ตั้ง");
  });
  it("10 ไม่มีผู้ซื้อ (billLegalName ว่าง/ช่องว่าง) → disabled + กรอกข้อมูลลูกค้า", () => {
    for (const billLegalName of [null, "", "   "]) {
      expect(resolveInvoiceGate(gateIn({ quote: { billLegalName } }))).toMatchObject({ state: "disabled", reason: "no_buyer", action: "billing" });
    }
  });
  it("11 outstanding<0 → ซ่อน แดง", () => {
    expect(resolveInvoiceGate(gateIn({ quote: { outstandingThb: -50, paidThb: 10050 } }))).toMatchObject({
      state: "hidden",
      reason: "negative",
      tone: "red",
    });
  });
  it("12 outstanding<=0 → ซ่อน 'รับเงินครบแล้ว'", () => {
    expect(resolveInvoiceGate(gateIn({ quote: { outstandingThb: 0, paidThb: 10000 } }))).toMatchObject({ state: "hidden", reason: "fully_paid" });
  });
  it("13 มัดจำไม่อยู่ใน (0, grand] → ซ่อน + action deposit", () => {
    expect(resolveInvoiceGate(gateIn({ quote: { depositMode: "thb", depositAmountThb: 20000 } }))).toMatchObject({
      state: "hidden",
      reason: "deposit_invalid",
      action: "deposit",
    });
  });

  it("ลำดับ: 7 ชนะ 8 · 8 ชนะ 10 · 10 (disabled) ชนะ 11-13 (hidden)", () => {
    const noSellerNoLines = gateIn({ sellerProfile: { ...SELLER_OK, legalName: null, paymentLines: [] } });
    expect(resolveInvoiceGate(noSellerNoLines)).toMatchObject({ reason: "seller_incomplete" });
    expect(resolveInvoiceGate(gateIn({ sellerProfile: { ...SELLER_OK, paymentLines: [] }, quote: { billLegalName: null } }))).toMatchObject({
      reason: "payment_lines_empty",
    });
    expect(resolveInvoiceGate(gateIn({ quote: { billLegalName: null, outstandingThb: 0, paidThb: 10000 } }))).toMatchObject({ reason: "no_buyer" });
  });
  it("disabled ถือชื่อปุ่มของชนิดที่จะออกไว้ (ปุ่มไม่หาย)", () => {
    expect(resolveInvoiceGate(gateIn({ sellerProfile: { ...SELLER_OK, paymentLines: [] } }))).toMatchObject({ labelTh: "ออกใบแจ้งหนี้ยอดเต็ม" });
    expect(
      resolveInvoiceGate(gateIn({ sellerProfile: { ...SELLER_OK, paymentLines: [] }, quote: { depositMode: "pct", depositAmountThb: 5000 } }))
    ).toMatchObject({ labelTh: "ออกใบแจ้งหนี้มัดจำ" });
  });
  it("ข้อความทุกเหตุผลมีเนื้อหา ไม่มีตัวเลขเงิน/เลขบัญชี", () => {
    for (const r of [
      "no_total", "negative", "fully_paid", "deposit_invalid", "load_error", "draft", "closed", "superseded",
      "stale_open", "open_invoice", "seller_incomplete", "payment_lines_empty", "payment_lines_unreadable", "no_buyer",
    ] as const) {
      const t = invoiceBlockReasonTh(r, { invoiceNo: "IV-X", missing: ["ชื่อที่ใช้ออกบิล"] });
      expect(t.length).toBeGreaterThan(10);
      expect(t).not.toMatch(/฿|\d{6,}/);
    }
  });
});
