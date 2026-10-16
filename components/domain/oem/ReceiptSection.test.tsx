// @vitest-environment jsdom
// ReceiptSection (I2): ไม่ส่ง/[] invoices = เดิมเป๊ะ · ส่งใบ unpaid -> dialog เสนอ "รับเงินตาม" ·
// "อ้างอิง IV-…" ใต้เลขใบเสร็จเมื่อมี invoiceNoSnapshot เท่านั้น (ใบเก่า null = ไม่มีบรรทัด)
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";

afterEach(cleanup);

vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/actions/oem", () => ({ issueReceipt: vi.fn(), voidReceipt: vi.fn() }));

import { ToastProvider } from "@/components/ui/Toast";
import { ReceiptSection } from "./ReceiptSection";
import { invoiceFx, quoteFx, receiptFx } from "./invoiceTestFixtures";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const depositQuote = () => quoteFx({ depositMode: "pct", depositInput: 0.5, depositAmountThb: 5000, isFullyPaid: false } as never);

function renderSection(over: Partial<React.ComponentProps<typeof ReceiptSection>> = {}) {
  return wrap(<ReceiptSection quote={depositQuote()} receipts={[]} onChanged={vi.fn()} onGoToBilling={vi.fn()} {...over} />);
}

describe("ReceiptSection — invoices", () => {
  it.each([[undefined], [[]]])("invoices=%j -> เปิด dialog แล้วไม่มีกลุ่ม 'รับเงินตาม' (เดิม)", (inv) => {
    renderSection({ invoices: inv as never });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกรับเงิน" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "รับเงินตาม" })).toBeNull();
    expect(screen.getByLabelText("จำนวนเงินที่รับ (บาท)")).not.toHaveAttribute("readonly");
  });

  it("ส่งใบ unpaid -> ส่งต่อให้ dialog: มีกลุ่ม 'รับเงินตาม' และยอดล็อก", () => {
    renderSection({ invoices: [invoiceFx({ amountThb: 5000 })] });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกรับเงิน" }));
    expect(screen.getByRole("group", { name: "รับเงินตาม" })).toBeInTheDocument();
    expect(screen.getByLabelText("จำนวนเงินที่รับ (บาท)")).toHaveAttribute("readonly");
  });

  it("ใบเสร็จที่ผูกใบแจ้งหนี้ -> 'อ้างอิง IV-…' ใต้เลขใบเสร็จ", () => {
    renderSection({ receipts: [receiptFx({ invoiceId: "22222222-2222-4222-8222-222222222222", invoiceNoSnapshot: "IV-2610-001" })] });
    const cell = screen.getByText("RT-2610-001").closest("td")!;
    expect(cell).toHaveTextContent("อ้างอิง IV-2610-001");
  });

  it("ใบเสร็จเก่า (invoiceNoSnapshot null) -> ไม่มีบรรทัดอ้างอิง", () => {
    renderSection({ receipts: [receiptFx()] });
    expect(screen.getByText("RT-2610-001")).toBeInTheDocument();
    expect(screen.queryByText(/อ้างอิง/)).toBeNull();
  });
});
