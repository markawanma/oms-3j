// @vitest-environment jsdom
// QuoteDetailClient × ใบแจ้งหนี้: ไม่ส่ง invoices = หน้าเดิมเป๊ะ (ไม่มีการ์ดใบแจ้งหนี้) · ส่ง invoices = การ์ดอยู่เหนือการ์ดรับเงิน
// · ReceiptSection เดิมไม่เปลี่ยน (ไม่มี radio "รับเงินตาม")
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";

afterEach(cleanup);

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/oem/quotes/x" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/actions/oem", () => ({
  setQuoteStatus: vi.fn(),
  issueInvoice: vi.fn(),
  voidInvoice: vi.fn(),
  issueReceipt: vi.fn(),
  voidReceipt: vi.fn(),
}));

import { ToastProvider } from "@/components/ui/Toast";
import { QuoteDetailClient } from "./QuoteDetailClient";
import { SELLER_OK, invoiceFx, quoteFx } from "./invoiceTestFixtures";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);

function base(over: Record<string, unknown> = {}) {
  return {
    quote: quoteFx({
      createdAt: "2026-10-16T01:00:00Z",
      customerName: "ลูกค้าทดสอบ",
      customerContact: null,
      itemCount: 0,
      parentQuoteId: null,
      parentQuoteNo: null,
      billAddress: null,
      isFullyPaid: false,
      balanceThb: null,
    } as never),
    items: [],
    provinces: [],
    sellerProfile: SELLER_OK,
    parentDeposit: null,
    receipts: [],
    ...over,
  };
}

describe("QuoteDetailClient — ใบแจ้งหนี้", () => {
  it("ไม่ส่ง invoices → ไม่มีการ์ดใบแจ้งหนี้ (หน้าเดิม) · ReceiptSection ยังอยู่ · ไม่มี radio รับเงินตามใบ", () => {
    wrap(<QuoteDetailClient {...base()} />);
    expect(screen.queryByRole("heading", { name: "ใบแจ้งหนี้" })).toBeNull();
    expect(screen.getByRole("heading", { name: "การรับเงิน / ใบเสร็จ" })).toBeInTheDocument();
    expect(screen.queryByText("ยังไม่มีใบแจ้งหนี้สำหรับดีลนี้")).toBeNull();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("ส่ง invoices=[] → การ์ดอยู่ก่อน (เหนือ) การ์ดรับเงิน · ปุ่มออกใบยอดเต็มมี", () => {
    wrap(<QuoteDetailClient {...base({ invoices: [] })} />);
    const inv = screen.getByRole("heading", { name: "ใบแจ้งหนี้" });
    const rec = screen.getByRole("heading", { name: "การรับเงิน / ใบเสร็จ" });
    expect(inv.compareDocumentPosition(rec) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "ออกใบแจ้งหนี้ยอดเต็ม" })).toBeInTheDocument();
    // ใบเสนอราคาที่ไม่มีใบแจ้งหนี้ยังบันทึกรับเงินได้ตามเดิม
    expect(screen.getByRole("button", { name: "บันทึกรับเงิน" })).toBeEnabled();
  });

  it("ส่ง invoicesError → แถบแดง ซ่อนปุ่มออกใบ แต่การรับเงินยังใช้ได้", () => {
    wrap(<QuoteDetailClient {...base({ invoicesError: "โหลดไม่ได้" })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("โหลดรายการใบแจ้งหนี้ไม่สำเร็จ");
    expect(screen.queryByRole("button", { name: /^ออกใบแจ้งหนี้/ })).toBeNull();
    expect(screen.getByRole("button", { name: "บันทึกรับเงิน" })).toBeEnabled();
  });

  it("I2: invoices ส่งต่อถึง ReceiptSection -> dialog บันทึกรับเงินเสนอ 'รับเงินตาม' · ไม่มี invoices = ไม่มีกลุ่มนี้", () => {
    const withInv = wrap(<QuoteDetailClient {...base({ invoices: [invoiceFx()] })} />);
    fireEvent.click(screen.getByRole("button", { name: "บันทึกรับเงิน" }));
    expect(screen.getByRole("group", { name: "รับเงินตาม" })).toBeInTheDocument();
    withInv.unmount();
    wrap(<QuoteDetailClient {...base()} />);
    fireEvent.click(screen.getByRole("button", { name: "บันทึกรับเงิน" }));
    expect(screen.queryByRole("group", { name: "รับเงินตาม" })).toBeNull();
  });

  it("แสดงใบที่มีอยู่", () => {
    wrap(<QuoteDetailClient {...base({ invoices: [invoiceFx()] })} />);
    expect(screen.getByText("IV-2610-001")).toBeInTheDocument();
  });
});
