// @vitest-environment jsdom
// ReceiptIssueDialog x ใบแจ้งหนี้ (0180 / I2):
//  ต้องไม่พัง: ไม่มี/[] invoices = dialog เดิม (ไม่มีกลุ่ม "รับเงินตาม") · payload ไม่มี key invoiceId · ใบ paid/void/stale ไม่ถูกเสนอ
//  ต้องถูก: ตามใบ = ยอด readOnly+aria-readonly เท่ายอดใบ · kind map deposit->deposit balance->final · ส่ง invoiceId ·
//          ไม่อ้างใบ = ยอดแก้ได้ + คำเตือน + ไม่มี key invoiceId · ใบ stale = บรรทัดเตือน ไม่มี radio
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";

afterEach(cleanup);

const issueReceipt = vi.fn();
vi.mock("@/lib/actions/oem", () => ({
  issueReceipt: (...a: unknown[]) => issueReceipt(...a),
}));

import { ToastProvider } from "@/components/ui/Toast";
import { INVOICE_TO_RECEIPT_KIND, ReceiptIssueDialog, pickLinkableInvoice, pickStaleInvoice } from "./ReceiptIssueDialog";
import { INV_ID, invoiceFx, quoteFx } from "./invoiceTestFixtures";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const onClose = vi.fn();
const onSaved = vi.fn();
const onGoToBilling = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  issueReceipt.mockResolvedValue({ ok: true, data: { receiptId: "rcpt-1" } });
});

const depositQuote = () => quoteFx({ depositMode: "pct", depositInput: 0.5, depositAmountThb: 5000 });
const balanceQuote = () => quoteFx({ paidThb: 5000, outstandingThb: 5000, depositMode: "pct", depositInput: 0.5, depositAmountThb: 5000 });

function renderDialog(quote = depositQuote(), invoices?: Parameters<typeof ReceiptIssueDialog>[0]["invoices"]) {
  return wrap(<ReceiptIssueDialog quote={quote} invoices={invoices} onClose={onClose} onSaved={onSaved} onGoToBilling={onGoToBilling} />);
}

const amountInput = () => screen.getByLabelText("จำนวนเงินที่รับ (บาท)") as HTMLInputElement;
const submitBtn = () => screen.getByRole("button", { name: "บันทึกรับเงิน" });
const payload = () => issueReceipt.mock.calls[0][0] as Record<string, unknown>;

describe("แมปชนิดใบ -> ชนิดการรับเงิน", () => {
  it("deposit->deposit · balance->final (ตารางตายตัว)", () => {
    expect(INVOICE_TO_RECEIPT_KIND).toEqual({ deposit: "deposit", balance: "final" });
  });
});

describe("pickLinkableInvoice / pickStaleInvoice", () => {
  it("เสนอเฉพาะ issued + unpaid + ไม่ stale", () => {
    expect(pickLinkableInvoice([invoiceFx()])?.id).toBe(INV_ID);
    expect(pickLinkableInvoice([invoiceFx({ isStale: true })])).toBeNull();
    expect(pickLinkableInvoice([invoiceFx({ paymentState: "paid", receiptNo: "RT-1" })])).toBeNull();
    expect(pickLinkableInvoice([invoiceFx({ status: "void", paymentState: "void" })])).toBeNull();
    expect(pickLinkableInvoice([])).toBeNull();
  });
  it("stale: เฉพาะ issued + unpaid + stale", () => {
    expect(pickStaleInvoice([invoiceFx({ isStale: true })])?.id).toBe(INV_ID);
    expect(pickStaleInvoice([invoiceFx()])).toBeNull();
    expect(pickStaleInvoice([invoiceFx({ isStale: true, status: "void", paymentState: "void" })])).toBeNull();
  });
});

describe("ReceiptIssueDialog — ไม่มีใบแจ้งหนี้ (ต้องเหมือนเดิมทุกประการ)", () => {
  it.each([[undefined], [[]]])("invoices=%j -> ไม่มีกลุ่ม 'รับเงินตาม' · ยอดแก้ได้ · payload ไม่มี key invoiceId", async (inv) => {
    renderDialog(depositQuote(), inv as never);
    expect(screen.queryByRole("group", { name: "รับเงินตาม" })).toBeNull();
    expect(amountInput()).not.toHaveAttribute("readonly");
    expect(amountInput()).not.toHaveAttribute("aria-readonly");
    expect(amountInput().value).toBe("5000");
    expect(screen.queryByText(/ล้าสมัย/)).toBeNull();

    fireEvent.click(submitBtn());
    await waitFor(() => expect(issueReceipt).toHaveBeenCalledTimes(1));
    expect(payload()).not.toHaveProperty("invoiceId");
    expect(payload()).toMatchObject({ amountThb: 5000, kind: "deposit", paymentMethod: "transfer" });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(await screen.findByText("บันทึกรับเงินและออกใบเสร็จ/ใบกำกับภาษีแล้ว")).toBeInTheDocument();
  });

  it("ใบ paid / void ไม่ถูกเสนอ -> ไม่มี radio กลุ่มนี้", () => {
    renderDialog(depositQuote(), [
      invoiceFx({ paymentState: "paid", receiptNo: "RT-2610-001" }),
      invoiceFx({ id: "33333333-3333-4333-8333-333333333333", status: "void", paymentState: "void" }),
    ]);
    expect(screen.queryByRole("group", { name: "รับเงินตาม" })).toBeNull();
    expect(amountInput()).not.toHaveAttribute("readonly");
  });
});

describe("ReceiptIssueDialog — รับเงินตามใบแจ้งหนี้", () => {
  it("ค่าเริ่ม = ตามใบ: radio ถูกเลือก · ชื่อมีเลขใบ+ยอด+ชนิด · ยอด readOnly + aria-readonly เท่ายอดใบ · บอกชนิดที่จะบันทึก", () => {
    renderDialog(depositQuote(), [invoiceFx({ amountThb: 5000 })]);
    const group = screen.getByRole("group", { name: "รับเงินตาม" });
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
    const byInvoice = within(group).getByRole("radio", { name: /ตามใบแจ้งหนี้ IV-2610-001/ });
    expect(byInvoice).toBeChecked();
    expect(byInvoice).toHaveAccessibleName(/5,000.*\(มัดจำ\)/);
    expect(within(group).getByRole("radio", { name: "รับเงินโดยไม่อ้างใบแจ้งหนี้" })).not.toBeChecked();

    expect(amountInput()).toHaveAttribute("readonly");
    expect(amountInput()).toHaveAttribute("aria-readonly", "true");
    expect(amountInput().value).toBe("5000");
    expect(screen.getByText(/ระบบจะบันทึกเป็น:/)).toHaveTextContent("เงินมัดจำ");
    expect(screen.queryByText(/จะกลายเป็น/)).toBeNull();
  });

  it("ใบมัดจำ -> ส่ง invoiceId + ยอดเท่าใบ + kind=deposit · toast ปิดใบแจ้งหนี้", async () => {
    renderDialog(depositQuote(), [invoiceFx({ amountThb: 5000 })]);
    fireEvent.click(submitBtn());
    await waitFor(() => expect(issueReceipt).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({ invoiceId: INV_ID, amountThb: 5000, kind: "deposit", quoteId: quoteFx().id });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(await screen.findByText(/ปิดใบแจ้งหนี้ IV-2610-001 แล้ว/)).toBeInTheDocument();
  });

  it("ใบคงเหลือ -> kind=final จากตารางแมป ไม่ derive จากยอด (ยอดใบ 3,000 < คงค้าง 5,000: deriveKind เดิมจะตอบ partial)", async () => {
    renderDialog(balanceQuote(), [invoiceFx({ kind: "balance", amountThb: 3000, payBeforeWork: false, dueDate: "2026-10-23" })]);
    expect(amountInput().value).toBe("3000");
    expect(screen.getByText(/ระบบจะบันทึกเป็น:/)).toHaveTextContent("ชำระงวดสุดท้าย");
    fireEvent.click(submitBtn());
    await waitFor(() => expect(issueReceipt).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({ invoiceId: INV_ID, amountThb: 3000, kind: "final" });
  });

  it("พิมพ์ทับยอดในช่อง readOnly ไม่ได้ผล (ยอดที่ส่งยังเท่าใบ)", async () => {
    renderDialog(depositQuote(), [invoiceFx({ amountThb: 5000 })]);
    fireEvent.change(amountInput(), { target: { value: "1" } });
    expect(amountInput().value).toBe("5000");
    fireEvent.click(submitBtn());
    await waitFor(() => expect(issueReceipt).toHaveBeenCalledTimes(1));
    expect(payload().amountThb).toBe(5000);
  });

  it("server ปฏิเสธ -> dialog ไม่ปิด (onSaved ไม่ถูกเรียก) และแสดงข้อความ error", async () => {
    issueReceipt.mockResolvedValue({ ok: false, error: "ใบแจ้งหนี้นี้ยอดเปลี่ยนแล้ว TEST-ERR" });
    renderDialog(depositQuote(), [invoiceFx({ amountThb: 5000 })]);
    fireEvent.click(submitBtn());
    expect(await screen.findByText(/TEST-ERR/)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("ReceiptIssueDialog — รับเงินโดยไม่อ้างใบแจ้งหนี้", () => {
  it("เลือกแล้ว: ยอดแก้ได้ · กล่องเตือนใบจะล้าสมัย (aria-describedby) · payload ไม่มี key invoiceId", async () => {
    renderDialog(depositQuote(), [invoiceFx({ amountThb: 5000 })]);
    fireEvent.click(screen.getByRole("radio", { name: "รับเงินโดยไม่อ้างใบแจ้งหนี้" }));

    expect(amountInput()).not.toHaveAttribute("readonly");
    expect(amountInput()).not.toHaveAttribute("aria-readonly");
    const warn = screen.getByText(/IV-2610-001 จะกลายเป็น/);
    expect(warn).toHaveTextContent("“ล้าสมัย” (พิมพ์ไม่ได้) และต้องยกเลิกเอง");
    expect(screen.getByRole("radio", { name: "รับเงินโดยไม่อ้างใบแจ้งหนี้" })).toHaveAccessibleDescription(/จะกลายเป็น/);

    fireEvent.change(amountInput(), { target: { value: "4800" } });
    fireEvent.click(submitBtn());
    await waitFor(() => expect(issueReceipt).toHaveBeenCalledTimes(1));
    expect(payload()).not.toHaveProperty("invoiceId");
    expect(payload()).toMatchObject({ amountThb: 4800, kind: "deposit" });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(screen.queryByText(/ปิดใบแจ้งหนี้/)).toBeNull();
  });

  it("สลับกลับมาตามใบ -> ยอดล็อกกลับเป็นยอดใบ · คำเตือนหาย", () => {
    renderDialog(depositQuote(), [invoiceFx({ amountThb: 5000 })]);
    fireEvent.click(screen.getByRole("radio", { name: "รับเงินโดยไม่อ้างใบแจ้งหนี้" }));
    fireEvent.change(amountInput(), { target: { value: "4800" } });
    fireEvent.click(screen.getByRole("radio", { name: /ตามใบแจ้งหนี้ IV-2610-001/ }));
    expect(amountInput().value).toBe("5000");
    expect(amountInput()).toHaveAttribute("readonly");
    expect(screen.queryByText(/จะกลายเป็น/)).toBeNull();
  });
});

describe("ReceiptIssueDialog — ใบแจ้งหนี้ล้าสมัย (stale)", () => {
  it("ไม่เสนอให้ผูก (ไม่มี radio) + บรรทัด amber บอกให้ยกเลิกก่อน · ยอดแก้ได้ · payload ไม่มี invoiceId", async () => {
    renderDialog(depositQuote(), [invoiceFx({ isStale: true })]);
    expect(screen.queryByRole("group", { name: "รับเงินตาม" })).toBeNull();
    expect(screen.getByText(/มีใบแจ้งหนี้ IV-2610-001 ที่ล้าสมัย — ยกเลิกก่อนถ้าต้องการอ้างใบใหม่/)).toBeInTheDocument();
    expect(amountInput()).not.toHaveAttribute("readonly");
    fireEvent.click(submitBtn());
    await waitFor(() => expect(issueReceipt).toHaveBeenCalledTimes(1));
    expect(payload()).not.toHaveProperty("invoiceId");
  });
});
