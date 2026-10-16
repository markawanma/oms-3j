// @vitest-environment jsdom
// /oem/invoices: แท็บสถานะ + จำนวน (สถานะที่แสดง) · กรองเดือน · void = "ดูใบ" ไม่ซ่อน · stale = พิมพ์ไม่ได้ (ไม่มีลิงก์) ·
// มัดจำ due=issue ข้ามวัน ไม่นับเลยกำหนด · empty 2 แบบ · OemSubNav มีแท็บ "ใบแจ้งหนี้" ระหว่างใบเสนอราคากับใบเสร็จ
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/oem/invoices" }));

import { InvoicesPageClient } from "./InvoicesPageClient";
import { OemSubNav } from "./OemSubNav";
import { invoiceFx } from "./invoiceTestFixtures";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const SET = [
  invoiceFx({ id: id(1), invoiceNo: "IV-2610-001", issueDate: "2026-10-10", dueDate: "2026-10-10", payBeforeWork: true, isOverdue: true }), // มัดจำ due=issue + is_overdue -> รอชำระ (ไม่นับเลยกำหนด)
  invoiceFx({ id: id(2), invoiceNo: "IV-2610-002", kind: "balance", payBeforeWork: false, issueDate: "2026-10-11", dueDate: "2026-10-12", isOverdue: true }), // เลยกำหนด
  invoiceFx({ id: id(3), invoiceNo: "IV-2610-003", isStale: true, issueDate: "2026-10-12" }), // ล้าสมัย
  invoiceFx({ id: id(4), invoiceNo: "IV-2610-004", paymentState: "paid", receiptNo: "RT-2610-001", issueDate: "2026-10-13" }), // ชำระแล้ว
  invoiceFx({ id: id(5), invoiceNo: "IV-2609-009", status: "void", paymentState: "void", voidReason: "TEST-REASON", issueDate: "2026-09-30" }), // ยกเลิก
];

const tab = (name: RegExp) => screen.getByRole("button", { name });
// เลขที่อยู่ในเซลล์แรกเสมอ (sr-only ของปุ่มพิมพ์ซ้ำเลขเดียวกัน จึงใช้ตัวแรก)
const numCell = (no: string) => screen.getAllByText(no)[0];
const rowOf = (no: string) => numCell(no).closest("tr")!;

describe("InvoicesPageClient", () => {
  it("แท็บแสดงจำนวนตามสถานะที่แสดง · มัดจำ due=issue ที่ is_overdue ถูกนับเป็น 'รอชำระ' ไม่ใช่ 'เลยกำหนด'", () => {
    render(<InvoicesPageClient invoices={SET} />);
    expect(tab(/^ทั้งหมด/)).toHaveTextContent("(5)");
    expect(tab(/^รอชำระ/)).toHaveTextContent("(1)");
    expect(tab(/^เลยกำหนด/)).toHaveTextContent("(1)");
    expect(tab(/^ล้าสมัย/)).toHaveTextContent("(1)");
    expect(tab(/^ชำระแล้ว/)).toHaveTextContent("(1)");
    expect(tab(/^ยกเลิกแล้ว/)).toHaveTextContent("(1)");
    expect(tab(/^ทั้งหมด/)).toHaveAttribute("aria-pressed", "true");
    expect(within(rowOf("IV-2610-001")).getByText("รอชำระ")).toBeInTheDocument();
    expect(within(rowOf("IV-2610-001")).getByText("ชำระก่อนเริ่มงาน")).toBeInTheDocument();
  });

  it("กรองสถานะ: เหลือเฉพาะแถวของสถานะนั้น", () => {
    render(<InvoicesPageClient invoices={SET} />);
    fireEvent.click(tab(/^เลยกำหนด/));
    expect(screen.getByText("IV-2610-002")).toBeInTheDocument();
    expect(screen.queryByText("IV-2610-001")).toBeNull();
    expect(tab(/^เลยกำหนด/)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("แสดง 1/5 ใบ")).toBeInTheDocument();
  });

  it("กรองเดือนที่ออก", () => {
    render(<InvoicesPageClient invoices={SET} />);
    fireEvent.change(screen.getByLabelText("กรองตามเดือนที่ออกใบ"), { target: { value: "2026-09" } });
    expect(numCell("IV-2609-009")).toBeInTheDocument();
    expect(screen.queryByText("IV-2610-001")).toBeNull();
  });

  it("ใบ void ไม่ซ่อน: เลขขีดฆ่า + ปุ่ม 'ดูใบ' (ไม่มี 'พิมพ์') · เหตุผลภายในไม่โผล่ในรายการ", () => {
    const { container } = render(<InvoicesPageClient invoices={SET} />);
    const row = rowOf("IV-2609-009");
    expect(numCell("IV-2609-009")).toHaveClass("line-through");
    expect(within(row).getByRole("link", { name: /ดูใบ/ })).toHaveAttribute("href", `/oem/invoices/${id(5)}/print`);
    expect(within(row).queryByRole("link", { name: /^พิมพ์/ })).toBeNull();
    expect(container.textContent).not.toContain("TEST-REASON");
  });

  it("ใบ stale: ไม่มีลิงก์พิมพ์ (aria-disabled) · ใบปกติมีลิงก์เปิดแท็บใหม่", () => {
    render(<InvoicesPageClient invoices={SET} />);
    const stale = rowOf("IV-2610-003");
    expect(within(stale).queryByRole("link", { name: /พิมพ์/ })).toBeNull();
    expect(stale.querySelector('[aria-disabled="true"]')).not.toBeNull();
    const ok = within(rowOf("IV-2610-002")).getByRole("link", { name: /พิมพ์ใบแจ้งหนี้ IV-2610-002/ });
    expect(ok).toHaveAttribute("href", `/oem/invoices/${id(2)}/print`);
    expect(ok).toHaveAttribute("target", "_blank");
  });

  it("คอลัมน์ใบเสนอราคาลิงก์ไปใบที่ active ของดีล", () => {
    render(<InvoicesPageClient invoices={[invoiceFx({ id: id(7), activeQuoteId: "aaaa" })]} />);
    expect(screen.getByRole("link", { name: "OEM-2610-004" })).toHaveAttribute("href", "/oem/quotes/aaaa");
  });

  it("empty: ไม่มีใบเลย / กรองแล้วไม่เจอ", () => {
    const a = render(<InvoicesPageClient invoices={[]} />);
    expect(screen.getByText("ยังไม่มีใบแจ้งหนี้")).toBeInTheDocument();
    expect(screen.getByText("ออกใบแรกได้จากหน้าใบเสนอราคา")).toBeInTheDocument();
    a.unmount();
    render(<InvoicesPageClient invoices={[SET[0]]} />);
    fireEvent.click(tab(/^ชำระแล้ว/));
    expect(screen.getByText("ไม่พบใบแจ้งหนี้ตามตัวกรองนี้")).toBeInTheDocument();
  });
});

describe("OemSubNav", () => {
  it("มีแท็บ 'ใบแจ้งหนี้' ระหว่างใบเสนอราคากับใบเสร็จ · active เมื่ออยู่ /oem/invoices", () => {
    render(<OemSubNav />);
    const links = screen.getAllByRole("link").map((l) => l.textContent);
    expect(links).toEqual(["ต้นทุน", "คิดราคา", "ใบเสนอราคา", "ใบแจ้งหนี้", "ใบเสร็จ"]);
    expect(screen.getByRole("link", { name: "ใบแจ้งหนี้" })).toHaveAttribute("href", "/oem/invoices");
    expect(screen.getByRole("link", { name: "ใบแจ้งหนี้" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "ใบเสร็จ" })).not.toHaveAttribute("aria-current");
  });
});
