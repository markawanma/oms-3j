// @vitest-environment jsdom
// InvoiceIssueDialog + VoidInvoiceDialog: payload ไม่มี amount · validation กำหนดชำระ/หมายเหตุ · loading ปิดไม่ได้ ·
// error ค้าง + รีเฟรชข้อมูล · success มีเลข+ปุ่มพิมพ์ (โฟกัส) · void โหมดปกติ/stale
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";

afterEach(cleanup);

const issueInvoice = vi.fn();
const voidInvoice = vi.fn();
vi.mock("@/lib/actions/oem", () => ({
  issueInvoice: (...a: unknown[]) => issueInvoice(...a),
  voidInvoice: (...a: unknown[]) => voidInvoice(...a),
}));

import { ToastProvider } from "@/components/ui/Toast";
import { InvoiceIssueDialog, dueDateIssue } from "./InvoiceIssueDialog";
import { VoidInvoiceDialog, STALE_VOID_DEFAULT_REASON } from "./VoidInvoiceDialog";
import { addDaysIso, todayBangkok } from "@/lib/oem/dates";
import { INV_ID, QUOTE_ID, SELLER_OK, invoiceFx, quoteFx } from "./invoiceTestFixtures";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const onClose = vi.fn();
const onChanged = vi.fn();
const onVoided = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  issueInvoice.mockResolvedValue({ ok: true, data: { id: INV_ID, invoiceNo: "IV-2610-001" } });
  voidInvoice.mockResolvedValue({ ok: true, data: undefined });
});

const depositQuote = () => quoteFx({ depositMode: "pct", depositInput: 0.5, depositAmountThb: 5000 });

function renderDeposit(over: Partial<React.ComponentProps<typeof InvoiceIssueDialog>> = {}) {
  return wrap(
    <InvoiceIssueDialog quote={depositQuote()} sellerProfile={SELLER_OK} kind="deposit" isFull={false} onClose={onClose} onChanged={onChanged} {...over} />
  );
}
function renderBalance(over: Partial<React.ComponentProps<typeof InvoiceIssueDialog>> = {}) {
  return wrap(
    <InvoiceIssueDialog
      quote={quoteFx({ paidThb: 5000, outstandingThb: 5000, depositMode: "pct", depositInput: 0.5, depositAmountThb: 5000 })}
      sellerProfile={SELLER_OK}
      kind="balance"
      isFull={false}
      onClose={onClose}
      onChanged={onChanged}
      {...over}
    />
  );
}

describe("dueDateIssue", () => {
  const today = "2026-10-16";
  it("วันนี้ผ่าน · เมื่อวานตก · +365 ผ่าน · +366 ตก · ว่าง/รูปแบบผิดตก", () => {
    expect(dueDateIssue("2026-10-16", today)).toBeNull();
    expect(dueDateIssue("2026-10-15", today)).toMatch(/ไม่ย้อนหลัง/);
    expect(dueDateIssue("2027-10-16", today)).toBeNull();
    expect(dueDateIssue("2027-10-17", today)).toMatch(/ไม่เกิน 365/);
    expect(dueDateIssue("", today)).toBe("เลือกวันกำหนดชำระ");
    expect(dueDateIssue("16/10/2026", today)).toBe("เลือกวันกำหนดชำระ");
  });
});

describe("InvoiceIssueDialog — ใบมัดจำ", () => {
  it("หัวเรื่อง/กล่องสรุป: ชนิด + ยอดจาก quote + ยอดรวม + รับแล้ว · ค่าเริ่ม 'ชำระก่อนเริ่มงาน'", () => {
    renderDeposit();
    expect(screen.getByRole("dialog")).toHaveAccessibleName("ออกใบแจ้งหนี้มัดจำ — OEM-2610-004");
    expect(screen.getByText("แจ้งยอดมัดจำ · มัดจำ 50%")).toBeInTheDocument();
    expect(screen.getByText("ยอดที่จะแจ้ง").nextSibling).toHaveTextContent("5,000");
    expect(screen.getByText("ยอดรวมใบเสนอราคา").nextSibling).toHaveTextContent("10,000");
    expect(screen.getByRole("radio", { name: "ชำระก่อนเริ่มงาน" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "ระบุวันที่เอง" })).not.toBeChecked();
    expect(screen.queryByLabelText("วันกำหนดชำระ")).toBeNull();
    expect(screen.getByText(/กดออกแล้วจะได้เลขที่ IV-ปีเดือน-ลำดับ ทันที แก้ไขไม่ได้/)).toBeInTheDocument();
  });

  it("มัดจำเป็นยอดเงิน (thb) → 'มัดจำตามที่ตกลง' ไม่เดา %", () => {
    renderDeposit({ quote: quoteFx({ depositMode: "thb", depositInput: 5000, depositAmountThb: 5000 }) });
    expect(screen.getByText("แจ้งยอดมัดจำ · มัดจำตามที่ตกลง")).toBeInTheDocument();
  });

  it("🔴 payload ไม่มี amount: มีเฉพาะ quoteId/kind/dueDate/note · due = null (DB ใช้วันที่ไทยเอง) · note null", async () => {
    renderDeposit();
    await userEvent.click(screen.getByRole("button", { name: /^ออกใบแจ้งหนี้/ }));
    await waitFor(() => expect(issueInvoice).toHaveBeenCalledTimes(1));
    const payload = issueInvoice.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toEqual({ quoteId: QUOTE_ID, kind: "deposit", dueDate: null, note: null });
    expect(Object.keys(payload).sort()).toEqual(["dueDate", "kind", "note", "quoteId"]);
    expect(payload).not.toHaveProperty("amount");
    expect(payload).not.toHaveProperty("amountThb");
    expect(payload).not.toHaveProperty("replacesInvoiceId");
  });

  it("ปุ่มส่งมีชื่อยอด (จาก quote) — แต่ยอดไม่ถูกส่ง", () => {
    renderDeposit();
    expect(screen.getByRole("button", { name: /^ออกใบแจ้งหนี้ .*5,000/ })).toBeInTheDocument();
  });

  it("ระบุวันที่เอง → prefill +7 วัน · min = วันนี้ · max = +365 · ส่งวันที่นั้น", async () => {
    renderDeposit();
    await userEvent.click(screen.getByRole("radio", { name: "ระบุวันที่เอง" }));
    const input = screen.getByLabelText("วันกำหนดชำระ") as HTMLInputElement;
    const today = todayBangkok();
    expect(input.value).toBe(addDaysIso(today, 7));
    expect(input.min).toBe(today);
    expect(input.max).toBe(addDaysIso(today, 365));
    fireEvent.change(input, { target: { value: addDaysIso(today, 3) } });
    await userEvent.click(screen.getByRole("button", { name: /^ออกใบแจ้งหนี้/ }));
    await waitFor(() => expect(issueInvoice).toHaveBeenCalled());
    expect(issueInvoice.mock.calls[0][0]).toMatchObject({ dueDate: addDaysIso(today, 3) });
  });

  it("วันย้อนหลัง / เกิน 365 / ว่าง → error ใต้ช่อง + ปุ่มปิด + ไม่ส่ง", async () => {
    renderDeposit();
    await userEvent.click(screen.getByRole("radio", { name: "ระบุวันที่เอง" }));
    const input = screen.getByLabelText("วันกำหนดชำระ");
    const submit = () => screen.getByRole("button", { name: /^ออกใบแจ้งหนี้/ });
    fireEvent.change(input, { target: { value: addDaysIso(todayBangkok(), -1) } });
    expect(screen.getByText("วันกำหนดชำระต้องไม่ย้อนหลัง")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(submit()).toBeDisabled();
    fireEvent.change(input, { target: { value: addDaysIso(todayBangkok(), 366) } });
    expect(screen.getByText(/ไม่เกิน 365 วัน/)).toBeInTheDocument();
    expect(submit()).toBeDisabled();
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByText("เลือกวันกำหนดชำระ")).toBeInTheDocument();
    expect(submit()).toBeDisabled();
    expect(issueInvoice).not.toHaveBeenCalled();
  });

  it("หมายเหตุ: ส่ง trim แล้ว · วรรคตอนล้วน/ยาวเกิน 500 → error + ปุ่มปิด · ตัวนับ N/500", async () => {
    renderDeposit();
    const note = screen.getByLabelText(/หมายเหตุถึงลูกค้า/);
    expect(screen.getByText("0/500")).toBeInTheDocument();
    fireEvent.change(note, { target: { value: "..." } });
    expect(screen.getByText("หมายเหตุต้องมีตัวอักษรหรือตัวเลขจริง")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^ออกใบแจ้งหนี้/ })).toBeDisabled();
    fireEvent.change(note, { target: { value: "ก".repeat(501) } });
    expect(screen.getByText(/ยาวเกินไป/)).toBeInTheDocument();
    expect(screen.getByText("501/500")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^ออกใบแจ้งหนี้/ })).toBeDisabled();
    fireEvent.change(note, { target: { value: "  ขอบคุณค่ะ  " } });
    await userEvent.click(screen.getByRole("button", { name: /^ออกใบแจ้งหนี้/ }));
    await waitFor(() => expect(issueInvoice).toHaveBeenCalled());
    expect(issueInvoice.mock.calls[0][0]).toMatchObject({ note: "ขอบคุณค่ะ" });
  });

  it("replacesInvoiceId (ออกแทนใบที่ void) ถูกส่งเมื่อมี", async () => {
    renderDeposit({ replacesInvoiceId: "33333333-3333-4333-8333-333333333333" });
    await userEvent.click(screen.getByRole("button", { name: /^ออกใบแจ้งหนี้/ }));
    await waitFor(() => expect(issueInvoice).toHaveBeenCalled());
    expect(issueInvoice.mock.calls[0][0]).toMatchObject({ replacesInvoiceId: "33333333-3333-4333-8333-333333333333" });
    expect(issueInvoice.mock.calls[0][0]).not.toHaveProperty("amount");
  });

  it("ใบเสนอราคาหมดอายุ → แถบ amber แต่ไม่บล็อก · ไม่หมดอายุ → ไม่มีแถบ", async () => {
    const { unmount } = renderDeposit({ quote: quoteFx({ ...depositQuote(), isExpiredTh: true }) });
    expect(screen.getByText(/ใบเสนอราคานี้หมดอายุแล้ว \(ยืนราคาถึง .+\) ยังออกใบแจ้งหนี้ได้ แต่ควรยืนยันราคากับลูกค้าก่อนส่ง/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^ออกใบแจ้งหนี้/ })).toBeEnabled();
    unmount();
    renderDeposit();
    expect(screen.queryByText(/หมดอายุแล้ว/)).toBeNull();
  });

  it("บรรทัดภาษี: ไม่จด VAT = ไม่มีคำภาษี/VAT เลย · จด+included · จด+breakdown (ไม่มีตัวเลขภาษี)", () => {
    const { container, unmount } = renderDeposit();
    expect(container.ownerDocument.body.textContent).not.toMatch(/ภาษีมูลค่าเพิ่ม|VAT/i);
    unmount();
    const a = renderDeposit({ sellerProfile: { ...SELLER_OK, vatRegistered: true } });
    expect(screen.getByText("ราคารวมภาษีมูลค่าเพิ่มแล้ว")).toBeInTheDocument();
    a.unmount();
    renderDeposit({ quote: quoteFx({ ...depositQuote(), vatMode: "breakdown" }), sellerProfile: { ...SELLER_OK, vatRegistered: true } });
    expect(screen.getByText("แสดงแยกภาษีมูลค่าเพิ่มบนใบ (คำนวณตอนออกใบ)")).toBeInTheDocument();
  });

  it("loading: ฟิลด์ disabled · ปุ่มปิด/X/Esc ปิดไม่ได้ ระหว่างส่ง", async () => {
    let resolve!: (v: unknown) => void;
    issueInvoice.mockReturnValue(new Promise((r) => (resolve = r)));
    renderDeposit();
    await userEvent.click(screen.getByRole("button", { name: /^ออกใบแจ้งหนี้/ }));
    await waitFor(() => expect(screen.getByLabelText(/หมายเหตุถึงลูกค้า/)).toBeDisabled());
    expect(screen.getByRole("radio", { name: "ระบุวันที่เอง" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^ออกใบแจ้งหนี้/ })).toBeDisabled();
    for (const b of screen.getAllByRole("button", { name: "ปิด" })) {
      if (!b.hasAttribute("disabled")) await userEvent.click(b);
    }
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    resolve({ ok: true, data: { id: INV_ID, invoiceNo: "IV-2610-001" } });
    await screen.findByText("ออกใบแจ้งหนี้ IV-2610-001 แล้ว");
  });

  it("error ค้าง (role=alert) ไม่ปิด dialog ไม่ refresh · 'รีเฟรชข้อมูล' → onChanged + onClose", async () => {
    issueInvoice.mockResolvedValue({ ok: false, error: "ดีลนี้มีใบแจ้งหนี้ที่ยังเปิดค้างอยู่ — ยกเลิกใบเดิมก่อนออกใบใหม่" });
    renderDeposit();
    await userEvent.click(screen.getByRole("button", { name: /^ออกใบแจ้งหนี้/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("ดีลนี้มีใบแจ้งหนี้ที่ยังเปิดค้างอยู่");
    expect(onClose).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^ออกใบแจ้งหนี้/ })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "รีเฟรชข้อมูล" }));
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("success: 'ออกใบแจ้งหนี้ IV-… แล้ว' + [พิมพ์ใบแจ้งหนี้] โฟกัสอยู่ที่ปุ่มพิมพ์ + onChanged · พิมพ์ = window.open จากคลิกตรง", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderDeposit();
    await userEvent.click(screen.getByRole("button", { name: /^ออกใบแจ้งหนี้/ }));
    expect(await screen.findByText("ออกใบแจ้งหนี้ IV-2610-001 แล้ว")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
    const printBtn = screen.getByRole("button", { name: "พิมพ์ใบแจ้งหนี้" });
    await waitFor(() => expect(printBtn).toHaveFocus());
    await userEvent.click(printBtn);
    expect(open).toHaveBeenCalledWith(`/oem/invoices/${INV_ID}/print`, "_blank", "noopener,noreferrer");
    await userEvent.click(screen.getAllByRole("button", { name: "ปิด" }).at(-1)!);
    expect(onClose).toHaveBeenCalled();
    open.mockRestore();
  });
});

describe("InvoiceIssueDialog — ใบคงเหลือ", () => {
  it("ไม่มี radio · มีช่องวันที่ prefill +7 + helper 'ออกใบตอนส่งมอบงาน' · payload kind=balance ไม่มี amount", async () => {
    renderBalance();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    const input = screen.getByLabelText("กำหนดชำระ") as HTMLInputElement;
    expect(input.value).toBe(addDaysIso(todayBangkok(), 7));
    expect(screen.getByText("ออกใบตอนส่งมอบงาน — ค่าเริ่มต้น 7 วันหลังออกใบ")).toBeInTheDocument();
    expect(screen.getByText("แจ้งยอดคงเหลือ · ยอดคงเหลือ")).toBeInTheDocument();
    expect(screen.getByText("ยอดที่จะแจ้ง").nextSibling).toHaveTextContent("5,000");
    expect(screen.getByText("รับแล้ว").nextSibling).toHaveTextContent("5,000");
    await userEvent.click(screen.getByRole("button", { name: /^ออกใบแจ้งหนี้/ }));
    await waitFor(() => expect(issueInvoice).toHaveBeenCalled());
    const p = issueInvoice.mock.calls[0][0] as Record<string, unknown>;
    expect(p).toEqual({ quoteId: QUOTE_ID, kind: "balance", dueDate: addDaysIso(todayBangkok(), 7), note: null });
    expect(p).not.toHaveProperty("amount");
  });

  it("ยอดเต็ม (ไม่ตั้งมัดจำ + ยังไม่รับเงิน): ชื่อ 'ยอดเต็ม' · ยอด = outstanding", () => {
    renderBalance({ quote: quoteFx(), isFull: true });
    expect(screen.getByRole("dialog")).toHaveAccessibleName("ออกใบแจ้งหนี้ยอดเต็ม — OEM-2610-004");
    expect(screen.getByText("แจ้งยอดคงเหลือ · ยอดเต็ม")).toBeInTheDocument();
    expect(screen.getByText("ยอดที่จะแจ้ง").nextSibling).toHaveTextContent("10,000");
  });
});

describe("VoidInvoiceDialog", () => {
  const inv = invoiceFx();

  it("โหมดปกติ: กล่องแดงครบ 4 ข้อ · ปุ่มยืนยันปิดจนกว่าจะมีเหตุผล · ส่ง {invoiceId, reason(trim)} · onVoided(null)", async () => {
    wrap(<VoidInvoiceDialog invoice={inv} mode="normal" onClose={onClose} onVoided={onVoided} />);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("ยกเลิกใบแจ้งหนี้ — IV-2610-001");
    expect(screen.getByText("ยกเลิกแล้วย้อนกลับไม่ได้")).toBeInTheDocument();
    expect(screen.getByText(/ใช้ซ้ำไม่ได้ตลอดไป/)).toBeInTheDocument();
    expect(screen.getByText(/ถ้าลูกค้าได้รับใบนี้ไปแล้ว ต้องแจ้งลูกค้าว่าใช้ไม่ได้/)).toBeInTheDocument();
    expect(screen.getByText(/ต้องแจ้งยอดใหม่ → ออกใบใหม่ได้หลังยกเลิก/)).toBeInTheDocument();
    expect(screen.queryByText(/ยอดใบเสนอราคาหรือเงินที่รับเปลี่ยนไปหลังออกใบนี้/)).toBeNull();
    const confirm = screen.getByRole("button", { name: "ยืนยันยกเลิกใบแจ้งหนี้" });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/เหตุผลที่ยกเลิก/), "  กรอกกำหนดชำระผิด  ");
    await userEvent.click(confirm);
    await waitFor(() => expect(voidInvoice).toHaveBeenCalledWith({ invoiceId: INV_ID, reason: "กรอกกำหนดชำระผิด" }));
    await waitFor(() => expect(onVoided).toHaveBeenCalledWith({ reissueReplacing: null }));
  });

  it("เหตุผลวรรคตอนล้วน/ช่องว่างล้วน → ปุ่มปิด", async () => {
    wrap(<VoidInvoiceDialog invoice={inv} mode="normal" onClose={onClose} onVoided={onVoided} />);
    const reason = screen.getByLabelText(/เหตุผลที่ยกเลิก/);
    fireEvent.change(reason, { target: { value: "..." } });
    expect(screen.getByRole("button", { name: "ยืนยันยกเลิกใบแจ้งหนี้" })).toBeDisabled();
    fireEvent.change(reason, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "ยืนยันยกเลิกใบแจ้งหนี้" })).toBeDisabled();
    expect(voidInvoice).not.toHaveBeenCalled();
  });

  it("โหมด stale: บรรทัดบน + prefill เหตุผล + ปุ่ม 'ยกเลิกและออกใบใหม่' · สำเร็จ → onVoided({reissueReplacing: id})", async () => {
    wrap(<VoidInvoiceDialog invoice={inv} mode="stale" onClose={onClose} onVoided={onVoided} />);
    expect(screen.getByText("ยอดใบเสนอราคาหรือเงินที่รับเปลี่ยนไปหลังออกใบนี้")).toBeInTheDocument();
    expect(screen.getByLabelText(/เหตุผลที่ยกเลิก/)).toHaveValue(STALE_VOID_DEFAULT_REASON);
    expect(STALE_VOID_DEFAULT_REASON).toBe("ยอดเปลี่ยนหลังออกใบ");
    await userEvent.click(screen.getByRole("button", { name: "ยกเลิกและออกใบใหม่" }));
    await waitFor(() => expect(voidInvoice).toHaveBeenCalledWith({ invoiceId: INV_ID, reason: STALE_VOID_DEFAULT_REASON }));
    await waitFor(() => expect(onVoided).toHaveBeenCalledWith({ reissueReplacing: INV_ID }));
  });

  it("error ค้าง (role=alert) · ไม่เรียก onVoided · ปิดไม่ได้ระหว่างส่ง", async () => {
    voidInvoice.mockResolvedValue({ ok: false, error: "ใบนี้ถูกชำระแล้ว — ยกเลิกใบเสร็จที่อ้างใบนี้ก่อน" });
    wrap(<VoidInvoiceDialog invoice={inv} mode="stale" onClose={onClose} onVoided={onVoided} />);
    await userEvent.click(screen.getByRole("button", { name: "ยกเลิกและออกใบใหม่" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ใบนี้ถูกชำระแล้ว");
    expect(onVoided).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
