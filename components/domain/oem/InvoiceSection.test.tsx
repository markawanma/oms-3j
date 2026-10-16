// @vitest-environment jsdom
// InvoiceSection: ด่านปุ่ม (ready/disabled/hidden + aria-describedby) · แถวใบ (สถานะ/void ไม่มีปุ่มพิมพ์/stale/paid) ·
// flow "ยกเลิกและออกใหม่" → เปิด issue dialog ต่อพร้อม replacesInvoiceId · ไม่มี amount ใน payload
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}));

import { ToastProvider } from "@/components/ui/Toast";
import { InvoiceSection } from "./InvoiceSection";
import { INV_ID, SELLER_OK, invoiceFx, quoteFx } from "./invoiceTestFixtures";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const onChanged = vi.fn();
const onGoToBilling = vi.fn();
const onGoToDeposit = vi.fn();

function renderSection(over: Partial<React.ComponentProps<typeof InvoiceSection>> = {}) {
  return wrap(
    <InvoiceSection
      quote={quoteFx()}
      invoices={[]}
      invoicesError={null}
      sellerProfile={SELLER_OK}
      canEditFinancials
      onChanged={onChanged}
      onGoToBilling={onGoToBilling}
      onGoToDeposit={onGoToDeposit}
      {...over}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  issueInvoice.mockResolvedValue({ ok: true, data: { id: "44444444-4444-4444-8444-444444444444", invoiceNo: "IV-2610-002" } });
  voidInvoice.mockResolvedValue({ ok: true, data: undefined });
});

describe("InvoiceSection — ปุ่มออกใบ", () => {
  it("ready: หัว 'ใบแจ้งหนี้' + ปุ่มชื่อตามชนิด (4 แถวของตาราง) + empty text", () => {
    const { unmount } = renderSection();
    expect(screen.getByRole("heading", { name: "ใบแจ้งหนี้" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ออกใบแจ้งหนี้ยอดเต็ม" })).toBeEnabled();
    expect(screen.getByText("ยังไม่มีใบแจ้งหนี้สำหรับดีลนี้")).toBeInTheDocument();
    unmount();

    const dep = renderSection({ quote: quoteFx({ depositMode: "pct", depositInput: 0.5, depositAmountThb: 5000 }) });
    expect(screen.getByRole("button", { name: "ออกใบแจ้งหนี้มัดจำ" })).toBeEnabled();
    dep.unmount();

    const bal1 = renderSection({ quote: quoteFx({ depositMode: "pct", depositInput: 0.5, depositAmountThb: 5000, paidThb: 5000, outstandingThb: 5000 }) });
    expect(screen.getByRole("button", { name: "ออกใบแจ้งหนี้ยอดคงเหลือ" })).toBeEnabled();
    bal1.unmount();

    renderSection({ quote: quoteFx({ paidThb: 3000, outstandingThb: 7000 }) });
    expect(screen.getByRole("button", { name: "ออกใบแจ้งหนี้ยอดคงเหลือ" })).toBeEnabled();
  });

  it("hidden (ไม่มีปุ่ม + แถบเหตุผล): draft / closed / superseded / ครบแล้ว / ติดลบ / มัดจำไม่ถูกต้อง / โหลดไม่ได้", () => {
    const cases: Array<[Partial<React.ComponentProps<typeof InvoiceSection>>, RegExp]> = [
      [{ quote: quoteFx({ status: "draft" }) }, /ออกใบแจ้งหนี้ได้เมื่อใบเสนอราคาอยู่สถานะเสนอราคาแล้ว/],
      [{ quote: quoteFx({ status: "lost" }) }, /ใบนี้ปิดแล้ว \(แพ้งาน\/ถูกปฏิเสธ\)/],
      [{ quote: quoteFx({ status: "superseded" }) }, /ถูกแทนที่ด้วยใบต่อราคาใหม่ — ไปออกใบแจ้งหนี้ที่ใบใหม่/],
      [{ quote: quoteFx({ outstandingThb: 0, paidThb: 10000 }) }, /รับเงินครบแล้ว — ไม่ต้องออกใบแจ้งหนี้/],
      [{ quote: quoteFx({ outstandingThb: -10, paidThb: 10010 }) }, /ยอดบวกไม่ลง \(ร้านค้างคืนเงิน\)/],
      [{ quote: quoteFx({ depositMode: "thb", depositInput: 20000, depositAmountThb: 20000 }) }, /ยอดมัดจำที่ตั้งไว้ไม่ถูกต้อง — แก้มัดจำก่อน/],
      [{ invoicesError: "x" }, /โหลดรายการใบแจ้งหนี้ไม่สำเร็จ/],
    ];
    for (const [over, re] of cases) {
      const { unmount } = renderSection(over);
      expect(screen.queryByRole("button", { name: /^ออกใบแจ้งหนี้/ })).toBeNull();
      expect(screen.getByText(re)).toBeInTheDocument();
      unmount();
    }
  });

  it("invoicesError: แถบแดง role=alert", () => {
    renderSection({ invoicesError: "โหลดไม่ได้" });
    expect(screen.getByRole("alert")).toHaveTextContent("โหลดรายการใบแจ้งหนี้ไม่สำเร็จ");
  });

  it("มัดจำไม่ถูกต้อง: ปุ่ม 'แก้มัดจำ' เฉพาะเมื่อ canEditFinancials", async () => {
    const q = quoteFx({ depositMode: "thb", depositInput: 20000, depositAmountThb: 20000 });
    const a = renderSection({ quote: q, canEditFinancials: true });
    await userEvent.click(screen.getByRole("button", { name: "แก้มัดจำ" }));
    expect(onGoToDeposit).toHaveBeenCalledTimes(1);
    a.unmount();
    renderSection({ quote: q, canEditFinancials: false });
    expect(screen.queryByRole("button", { name: "แก้มัดจำ" })).toBeNull();
  });

  it("disabled ต้อง aria-describedby ชี้แถบเหตุผลบนจอ: ข้อมูลร้านไม่ครบ / paymentLines [] / ไม่มีผู้ซื้อ", () => {
    const cases: Array<[Partial<React.ComponentProps<typeof InvoiceSection>>, RegExp]> = [
      [{ sellerProfile: { ...SELLER_OK, taxId: null } }, /ข้อมูลร้านเรา \(หัวกระดาษ\) ยังไม่ครบ/],
      [{ sellerProfile: { ...SELLER_OK, paymentLines: [] } }, /ยังไม่ได้ตั้งช่องทางชำระเงิน — ออกใบแจ้งหนี้ไม่ได้จนกว่าจะตั้ง/],
      [{ quote: quoteFx({ billLegalName: null }) }, /ยังไม่มีข้อมูลลูกค้าสำหรับออกเอกสาร/],
    ];
    for (const [over, re] of cases) {
      const { unmount } = renderSection(over);
      const btn = screen.getByRole("button", { name: /^ออกใบแจ้งหนี้/ });
      expect(btn).toBeDisabled();
      const id = btn.getAttribute("aria-describedby");
      expect(id).toBeTruthy();
      expect(document.getElementById(id!)).toHaveTextContent(re);
      unmount();
    }
  });

  it("paymentLines [] → ลิงก์ไปตั้งช่องทางชำระ #oem-payment-lines · ข้อมูลร้านไม่ครบ → /oem/rates", () => {
    const a = renderSection({ sellerProfile: { ...SELLER_OK, paymentLines: [] } });
    expect(screen.getByRole("link", { name: "ไปตั้งช่องทางชำระ" })).toHaveAttribute("href", "/oem/rates#oem-payment-lines");
    a.unmount();
    renderSection({ sellerProfile: { ...SELLER_OK, legalName: null } });
    expect(screen.getByRole("link", { name: "ไปกรอกข้อมูลร้านเรา" })).toHaveAttribute("href", "/oem/rates");
  });

  it("paymentLines null → disabled แดง 'โหลดช่องทางชำระไม่สำเร็จ' · ห้ามพูด 'ยังไม่ได้ตั้ง' · ไม่มีลิงก์ไปตั้งค่า", () => {
    const { container } = renderSection({ sellerProfile: { ...SELLER_OK, paymentLines: null } });
    expect(screen.getByRole("button", { name: /^ออกใบแจ้งหนี้/ })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("โหลดช่องทางชำระไม่สำเร็จ — ลองรีเฟรชหน้า");
    expect(container.textContent).not.toContain("ยังไม่ได้ตั้ง");
    expect(screen.queryByRole("link", { name: "ไปตั้งช่องทางชำระ" })).toBeNull();
  });

  it("ไม่มีผู้ซื้อ → ปุ่ม 'กรอกข้อมูลลูกค้า' เรียก onGoToBilling", async () => {
    renderSection({ quote: quoteFx({ billLegalName: "  " }) });
    await userEvent.click(screen.getByRole("button", { name: "กรอกข้อมูลลูกค้า" }));
    expect(onGoToBilling).toHaveBeenCalledTimes(1);
  });

  it("กดปุ่ม → เปิด dialog ชนิดที่ตัดสินแล้ว · ส่งแล้วไม่มี amount", async () => {
    renderSection({ quote: quoteFx({ depositMode: "pct", depositInput: 0.5, depositAmountThb: 5000 }) });
    await userEvent.click(screen.getByRole("button", { name: "ออกใบแจ้งหนี้มัดจำ" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /^ออกใบแจ้งหนี้ .*5,000/ }));
    await waitFor(() => expect(issueInvoice).toHaveBeenCalled());
    expect(issueInvoice.mock.calls[0][0]).toMatchObject({ kind: "deposit" });
    expect(issueInvoice.mock.calls[0][0]).not.toHaveProperty("amount");
    // success ไม่ถอด dialog แม้ section จะ refresh (onChanged) — dialog ถือชนิดที่แช่แข็งไว้
    expect(await screen.findByText("ออกใบแจ้งหนี้ IV-2610-002 แล้ว")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});

describe("InvoiceSection — แถวใบ", () => {
  it("มัดจำ due=issue: 'กำหนดชำระ: ชำระก่อนเริ่มงาน' · รอชำระ (ไม่ใช่เลยกำหนด แม้ isOverdue หลุด) · ปุ่มพิมพ์+ยกเลิก", () => {
    renderSection({ invoices: [invoiceFx({ isOverdue: true })] });
    expect(screen.getByText("IV-2610-001")).toBeInTheDocument();
    expect(screen.getByText("มัดจำ")).toBeInTheDocument();
    expect(screen.getByText("รอชำระ")).toBeInTheDocument();
    expect(screen.queryByText("เลยกำหนด")).toBeNull();
    expect(screen.getByText("กำหนดชำระ: ชำระก่อนเริ่มงาน")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "พิมพ์ใบแจ้งหนี้ IV-2610-001" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "ยกเลิก" })).toBeEnabled();
    // มีใบเปิดค้าง → ซ่อนปุ่มออกใบ + บอกเลขที่
    expect(screen.queryByRole("button", { name: /^ออกใบแจ้งหนี้/ })).toBeNull();
    expect(screen.getByText(/มีใบแจ้งหนี้ค้างอยู่ \(IV-2610-001\)/)).toBeInTheDocument();
  });

  it("เลยกำหนด (ใบคงเหลือ): badge เลยกำหนด + ข้อความกำหนดชำระสีแดง", () => {
    renderSection({ invoices: [invoiceFx({ kind: "balance", payBeforeWork: false, dueDate: "2026-10-10", isOverdue: true })] });
    expect(screen.getByText("เลยกำหนด")).toBeInTheDocument();
    expect(screen.getByText(/^กำหนดชำระ: ชำระภายใน/)).toHaveClass("text-red-700");
  });

  it("void: เลขขีดฆ่า + text-zinc-500 (ไม่ใช้ opacity) · ไม่มีปุ่มพิมพ์/ยกเลิก มีแค่ 'ดูใบ' · ออกใบใหม่ได้", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderSection({ invoices: [invoiceFx({ status: "void", paymentState: "void", voidReason: "POISON-VOID-REASON" })] });
    const no = screen.getByText("IV-2610-001");
    expect(no).toHaveClass("line-through");
    const li = no.closest("li")!;
    expect(li).toHaveClass("text-zinc-500");
    expect(li.className).not.toMatch(/opacity/);
    expect(screen.getByText("ยกเลิกแล้ว")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /พิมพ์/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "ยกเลิก" })).toBeNull();
    // เหตุผล void ไม่โชว์ในการ์ด (ภายใน — ดูได้ที่ DB)
    expect(document.body.textContent).not.toContain("POISON-VOID-REASON");
    expect(screen.getByRole("button", { name: "ออกใบแจ้งหนี้ยอดเต็ม" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "ดูใบ" }));
    expect(open).toHaveBeenCalledWith(`/oem/invoices/${INV_ID}/print`, "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("paid: 'ชำระแล้ว · RT-…' เป็นลิงก์ + ข้อความยกเลิกใบเสร็จก่อน · ไม่มีปุ่มยกเลิก", () => {
    renderSection({
      quote: quoteFx({ paidThb: 5000, outstandingThb: 5000 }),
      invoices: [invoiceFx({ paymentState: "paid", receiptNo: "RT-2610-001", receiptId: "55555555-5555-4555-8555-555555555555" })],
    });
    expect(screen.getByText("ชำระแล้ว", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "RT-2610-001" })).toHaveAttribute("href", "/oem/receipts/55555555-5555-4555-8555-555555555555/print");
    expect(screen.getByText("ใบนี้ชำระแล้ว — ยกเลิกใบเสร็จก่อนจึงยกเลิกได้")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ยกเลิก" })).toBeNull();
  });

  it("stale: badge ล้าสมัย · แถบส้มในแถว · พิมพ์ disabled · ซ่อนปุ่มออกใบ + แถบบนบอกเลขที่ · ไม่มีปุ่ม 'ยกเลิก' ธรรมดา", () => {
    renderSection({ invoices: [invoiceFx({ isStale: true })] });
    expect(screen.getByText("ล้าสมัย")).toBeInTheDocument();
    expect(screen.getByText(/ยอดใบเสนอราคา\/เงินที่รับเปลี่ยนหลังออกใบนี้ — พิมพ์ไม่ได้ ต้องยกเลิกแล้วออกใหม่/)).toBeInTheDocument();
    expect(screen.getByText("ใบ IV-2610-001 ยอดเปลี่ยนแล้ว ใช้ไม่ได้ — ยกเลิกแล้วออกใหม่")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "พิมพ์ใบแจ้งหนี้ IV-2610-001" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^ออกใบแจ้งหนี้/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "ยกเลิก" })).toBeNull();
    expect(screen.getByRole("button", { name: "ยกเลิกและออกใหม่" })).toBeEnabled();
  });

  it("ยกเลิกธรรมดา: เปิด void dialog โหมดปกติ → ยืนยัน → ไม่เปิด issue dialog ต่อ + onChanged", async () => {
    renderSection({ invoices: [invoiceFx()] });
    await userEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/เหตุผลที่ยกเลิก/), "กรอกผิด");
    await userEvent.click(within(dialog).getByRole("button", { name: "ยืนยันยกเลิกใบแจ้งหนี้" }));
    await waitFor(() => expect(voidInvoice).toHaveBeenCalledWith({ invoiceId: INV_ID, reason: "กรอกผิด" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(issueInvoice).not.toHaveBeenCalled();
  });

  it("'ยกเลิกและออกใหม่' (stale): void สำเร็จ → เปิด issue dialog ต่อ → ส่ง replacesInvoiceId = ใบที่ void · ไม่มี amount", async () => {
    renderSection({ quote: quoteFx({ depositMode: "pct", depositInput: 0.5, depositAmountThb: 5000 }), invoices: [invoiceFx({ isStale: true })] });
    await userEvent.click(screen.getByRole("button", { name: "ยกเลิกและออกใหม่" }));
    const voidDlg = screen.getByRole("dialog");
    expect(within(voidDlg).getByText("ยอดใบเสนอราคาหรือเงินที่รับเปลี่ยนไปหลังออกใบนี้")).toBeInTheDocument();
    await userEvent.click(within(voidDlg).getByRole("button", { name: "ยกเลิกและออกใบใหม่" }));
    await waitFor(() => expect(voidInvoice).toHaveBeenCalledWith({ invoiceId: INV_ID, reason: "ยอดเปลี่ยนหลังออกใบ" }));
    const issueDlg = await screen.findByRole("dialog", { name: /ออกใบแจ้งหนี้มัดจำ/ });
    await userEvent.click(within(issueDlg).getByRole("button", { name: /^ออกใบแจ้งหนี้ .*5,000/ }));
    await waitFor(() => expect(issueInvoice).toHaveBeenCalled());
    const payload = issueInvoice.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toMatchObject({ kind: "deposit", replacesInvoiceId: INV_ID });
    expect(payload).not.toHaveProperty("amount");
  });

  it("void ล้มเหลว → ไม่เปิด issue dialog · error ค้างใน void dialog", async () => {
    voidInvoice.mockResolvedValue({ ok: false, error: "ใบนี้ถูกชำระแล้ว — ยกเลิกใบเสร็จที่อ้างใบนี้ก่อน" });
    renderSection({ invoices: [invoiceFx({ isStale: true })] });
    await userEvent.click(screen.getByRole("button", { name: "ยกเลิกและออกใหม่" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "ยกเลิกและออกใบใหม่" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ใบนี้ถูกชำระแล้ว");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(issueInvoice).not.toHaveBeenCalled();
  });

  it("เปิดพิมพ์: window.open ไป /oem/invoices/<id>/print แบบ noopener", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderSection({ invoices: [invoiceFx()] });
    await userEvent.click(screen.getByRole("button", { name: "พิมพ์ใบแจ้งหนี้ IV-2610-001" }));
    expect(open).toHaveBeenCalledWith(`/oem/invoices/${INV_ID}/print`, "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("ใบหลายใบ: ใบ void เก่า + ใบที่ใช้อยู่ — แสดงทั้งสอง · ใบ void ไม่บล็อกการออกใบใหม่", () => {
    renderSection({
      invoices: [
        invoiceFx({ id: "a", invoiceNo: "IV-2610-002", paymentState: "paid", receiptNo: null }),
        invoiceFx({ id: "b", invoiceNo: "IV-2610-001", status: "void", paymentState: "void" }),
      ],
    });
    expect(screen.getByText("IV-2610-002")).toBeInTheDocument();
    expect(screen.getByText("IV-2610-001")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
