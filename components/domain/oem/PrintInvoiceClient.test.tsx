// @vitest-environment jsdom
// หน้าพิมพ์ใบแจ้งหนี้: "ไม่ใช่ใบกำกับภาษี" อยู่บนกระดาษทุกใบ (ไม่ใต้ print:hidden) · vat none ไม่มีคำภาษี · breakdown บวกลง (ยอดคี่) ·
// ข้อความพนักงานอยู่ใต้ print:hidden · void: เอกสาร print:hidden + ไม่มีปุ่มพิมพ์ · stale: ไม่มี .oem-print-doc ไม่เรียก toPrintableInvoice ·
// leak test (ค่าวางยาไม่อยู่ใน HTML/props)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}));
const getInvoice = vi.fn();
vi.mock("@/lib/actions/oem", () => ({ getInvoice: (...a: unknown[]) => getInvoice(...a) }));
const getEffectiveRole = vi.fn();
vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: (...a: unknown[]) => getEffectiveRole(...a) }));
const toPrintableInvoiceSpy = vi.fn();
vi.mock("@/lib/oem/printableInvoice", async (orig) => {
  const actual = await orig<typeof import("@/lib/oem/printableInvoice")>();
  return {
    ...actual,
    toPrintableInvoice: (...a: Parameters<typeof actual.toPrintableInvoice>) => {
      toPrintableInvoiceSpy(...a);
      return actual.toPrintableInvoice(...a);
    },
  };
});

import type { OemInvoiceRow } from "@/lib/oem/types";
import { OEM_INVOICE_NOT_TAX_INVOICE_TH } from "@/lib/oem/types";
import { toInvoicePrintNotices, toPrintableInvoice } from "@/lib/oem/printableInvoice";
import { PrintInvoiceClient } from "./PrintInvoiceClient";
import OemInvoicePrintPage from "@/app/(dashboard)/oem/invoices/[id]/print/page";
import { INV_ID, QUOTE_ID, invoiceFx } from "./invoiceTestFixtures";

const POISON = {
  voidReason: "POISON-VOID-REASON",
  displayName: "POISON-DISPLAY-NAME",
  approvalNote: "POISON-APPROVAL-NOTE",
  discountReason: "POISON-DISCOUNT-REASON",
  cost: "777.77",
  createdBy: "POISON-USER-CREATED",
  voidedBy: "POISON-USER-VOIDED",
  calc: "POISON-CALC-BLOB",
  shopId: "POISON-SHOP-ID",
  dealRootId: "POISON-DEAL-ROOT",
};

function row(over: Partial<OemInvoiceRow> = {}): OemInvoiceRow {
  return invoiceFx({
    shopId: POISON.shopId,
    sellerSnapshot: {
      legalName: "ร้านทดสอบ TEST-ONLY",
      displayName: POISON.displayName,
      branchLabel: "สำนักงานใหญ่",
      addressLines: ["TEST-ONLY ที่อยู่ร้าน"],
      taxId: "0000000000000",
      phone: "000-000-0000",
      vatRegistered: false,
    },
    buyerTaxId: null,
    buyerBranchLabel: null,
    buyerAddress: null,
    lines: [{ seq: 1, name: "สินค้าทดสอบ", sku: "TEST-SKU", qty: 2, unitPriceThb: 5000, lineTotalThb: 10000 }],
    piecesSubtotalThb: 10000,
    nrePriceThb: 0,
    discountThb: 0,
    grandTotalThb: 10000,
    amountThb: 5000,
    paidBeforeThb: 0,
    balanceAfterThb: 5000,
    quoteValidUntil: "2026-11-15",
    dealQuoteExpired: false,
    dealQuoteNo: "OEM-2610-004",
    // ค่าวางยา — field ที่ไม่ควรโผล่ที่ไหนเลยในกระดาษ/props
    ...({
      approvalNote: POISON.approvalNote,
      discountReason: POISON.discountReason,
      costPiece: POISON.cost,
      createdBy: POISON.createdBy,
      voidedBy: POISON.voidedBy,
      calc: POISON.calc,
      dealRootId: POISON.dealRootId,
    } as object),
    voidReason: null,
    voidedAt: null,
    ...over,
  });
}

function renderPrint(r: OemInvoiceRow) {
  const invoice = toPrintableInvoice(r);
  const notices = toInvoicePrintNotices(r);
  const utils = render(<PrintInvoiceClient invoice={invoice} notices={notices} />);
  const doc = utils.container.querySelector(".oem-print-doc") as HTMLElement | null;
  return { ...utils, invoice, notices, doc };
}

const underPrintHidden = (el: Element) => el.closest(".print\\:hidden") !== null;
const cents = (n: number) => Math.round(n * 100);

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveRole.mockResolvedValue("owner");
});

describe("PrintInvoiceClient — บรรทัด 'เอกสารนี้ไม่ใช่ใบกำกับภาษี' บนกระดาษ", () => {
  it("อยู่ในเอกสาร (.oem-print-doc) ไม่ใต้ print:hidden — ทุก kind × vatDisplay × (กระดาษ)", () => {
    const variants: Partial<OemInvoiceRow>[] = [
      { kind: "deposit", vatDisplay: "none" },
      { kind: "deposit", vatDisplay: "included", vatRate: 0.07, vatBaseThb: 4673.37, vatAmountThb: 327.14 },
      { kind: "deposit", vatDisplay: "breakdown", vatRate: 0.07, vatBaseThb: 4673.37, vatAmountThb: 327.14 },
      { kind: "balance", payBeforeWork: false, dueDate: "2026-10-23", vatDisplay: "none" },
      { kind: "balance", payBeforeWork: false, dueDate: "2026-10-23", vatDisplay: "breakdown", vatRate: 0.07, vatBaseThb: 4673.37, vatAmountThb: 327.14 },
    ];
    for (const v of variants) {
      const { doc, unmount } = renderPrint(row(v));
      expect(doc).not.toBeNull();
      const line = within(doc!).getByText(OEM_INVOICE_NOT_TAX_INVOICE_TH);
      expect(line).toBeInTheDocument();
      expect(underPrintHidden(line)).toBe(false);
      expect(underPrintHidden(doc!)).toBe(false);
      unmount();
    }
  });
  it("ใช้ข้อความจาก invoice.notTaxInvoiceText (ค่าคงที่ของ backend) และมีครั้งเดียว", () => {
    const { container, invoice } = renderPrint(row());
    expect(invoice.notTaxInvoiceText).toBe("เอกสารนี้ไม่ใช่ใบกำกับภาษี");
    expect(container.textContent!.split(invoice.notTaxInvoiceText).length - 1).toBe(1);
  });
});


describe("PrintInvoiceClient — VAT", () => {
  it("none: เอกสารไม่ match /ภาษีมูลค่าเพิ่ม|VAT/i เลย (ทั้งมัดจำและคงเหลือ)", () => {
    for (const v of [{ kind: "deposit" as const }, { kind: "balance" as const, payBeforeWork: false, dueDate: "2026-10-23", paidBeforeThb: 5000 }]) {
      const { doc, unmount } = renderPrint(row({ ...v, vatDisplay: "none" }));
      expect(doc!.textContent).not.toMatch(/ภาษีมูลค่าเพิ่ม|VAT/i);
      expect(doc!.textContent).not.toMatch(/7%|อัตรา/);
      unmount();
    }
  });
  it("none แม้ row หลุดค่า vat มา (ด่านของ toPrintableInvoice) ก็ไม่ออกกระดาษ", () => {
    const { doc } = renderPrint(row({ vatDisplay: "none", vatRate: 0.07, vatBaseThb: 4673.37, vatAmountThb: 327.14 }));
    expect(doc!.textContent).not.toMatch(/ภาษีมูลค่าเพิ่ม|VAT/i);
    expect(doc!.textContent).not.toContain("4,673.37");
  });
  it("included: บรรทัดเดียว 'ราคารวมภาษีมูลค่าเพิ่มแล้ว' · ไม่มีท่อนแยกภาษี", () => {
    const { doc } = renderPrint(row({ vatDisplay: "included", vatRate: 0.07, vatBaseThb: 4673.37, vatAmountThb: 327.14 }));
    expect(doc!.textContent!.split("ราคารวมภาษีมูลค่าเพิ่มแล้ว").length - 1).toBe(1);
    expect(doc!.textContent).not.toContain("มูลค่าก่อนภาษี");
    expect(doc!.textContent).not.toContain("4,673.37");
  });
  it("breakdown: ในกล่อง 'ยอดของใบนี้' เท่านั้น · ก่อนภาษี + ภาษี = ยอดที่ต้องชำระ เป๊ะ (ยอดคี่ 5,000.51)", () => {
    const { doc, invoice } = renderPrint(
      row({ vatDisplay: "breakdown", vatRate: 0.07, vatBaseThb: 4673.37, vatAmountThb: 327.14, amountThb: 5000.51, balanceAfterThb: 4999.49 })
    );
    expect(cents(invoice.vatBaseThb!) + cents(invoice.vatAmountThb!)).toBe(cents(invoice.amountThb));
    const box = within(doc!).getByText("ยอดของใบนี้").closest("div")!;
    expect(box.textContent).toContain("มูลค่าก่อนภาษีมูลค่าเพิ่ม");
    expect(box.textContent).toContain("4,673.37");
    expect(box.textContent).toContain("ภาษีมูลค่าเพิ่ม 7%");
    expect(box.textContent).toContain("327.14");
    expect(box.textContent).toContain("ยอดที่ต้องชำระ");
    // ไม่แยกภาษีที่อื่นในเอกสาร (ระดับใบเสนอราคา)
    expect(doc!.textContent!.split("ภาษีมูลค่าเพิ่ม").length - 1).toBe(2); // "ก่อนภาษีมูลค่าเพิ่ม" + "ภาษีมูลค่าเพิ่ม 7%"
    expect(doc!.textContent).not.toContain("ราคารวมภาษีมูลค่าเพิ่มแล้ว");
  });
});

describe("PrintInvoiceClient — เนื้อหากระดาษ", () => {
  it("โครงสร้าง: class mx-auto max-w-[210mm] / oem-print-doc / oem-print-table · h1 ใบแจ้งหนี้ + Invoice · เลขที่/วันที่/อ้างอิงใบเสนอราคา", () => {
    const { container, doc } = renderPrint(row());
    expect(container.firstElementChild).toHaveClass("mx-auto", "max-w-[210mm]");
    expect(doc!.querySelector("table.oem-print-table")).not.toBeNull();
    expect(within(doc!).getByRole("heading", { level: 1 })).toHaveTextContent("ใบแจ้งหนี้");
    expect(within(doc!).getByText("Invoice")).toBeInTheDocument();
    expect(within(doc!).getByText("เลขที่ IV-2610-001")).toBeInTheDocument();
    expect(within(doc!).getByText("อ้างอิงใบเสนอราคาเลขที่ OEM-2610-004")).toBeInTheDocument();
    expect(within(doc!).getByAltText("3J Jewelry")).toBeInTheDocument();
    // ไม่มี "ต้นฉบับ/สำเนา"
    expect(doc!.textContent).not.toMatch(/ต้นฉบับ|สำเนา/);
  });
  it("ผู้ขาย/ผู้ซื้อ: ชื่อ · สาขา · ที่อยู่ · เลขผู้เสียภาษี (ถ้ามี) · โทร", () => {
    const { doc } = renderPrint(
      row({
        buyerTaxId: "1111111111111",
        buyerBranchLabel: "TEST-ONLY สาขา",
        buyerAddress: { line1: "TEST-ONLY ที่อยู่ผู้ซื้อ", subdistrict: "ก", district: "ข", province: "ค", postalCode: "10000" } as never,
      })
    );
    const t = doc!.textContent!;
    expect(t).toContain("ร้านทดสอบ TEST-ONLY");
    expect(t).toContain("เลขประจำตัวผู้เสียภาษี 0000000000000");
    expect(t).toContain("000-000-0000");
    expect(t).toContain("ผู้ซื้อทดสอบ");
    expect(t).toContain("เลขประจำตัวผู้เสียภาษี 1111111111111");
    expect(t).toContain("TEST-ONLY สาขา");
    expect(t).toContain("TEST-ONLY ที่อยู่ผู้ซื้อ");
  });
  it("ผู้ซื้อไม่มีเลขภาษี/สาขา → ไม่พิมพ์บรรทัดว่าง · ผู้ขายไม่มีเลขภาษี → ไม่พิมพ์", () => {
    const { doc } = renderPrint(
      row({
        sellerSnapshot: { legalName: "ร้านทดสอบ", displayName: null, branchLabel: null, addressLines: [], taxId: null, phone: null, vatRegistered: false },
      })
    );
    expect(doc!.textContent).not.toContain("เลขประจำตัวผู้เสียภาษี");
  });
  it("แถบยอดที่ต้องชำระครั้งนี้ + คำอ่าน + กำหนดชำระ 'ชำระก่อนเริ่มงาน' (มัดจำ due=issue)", () => {
    const { doc, invoice } = renderPrint(row());
    expect(within(doc!).getByText("ยอดที่ต้องชำระครั้งนี้")).toBeInTheDocument();
    expect(within(doc!).getByText(`(${invoice.amountInWordsTh})`)).toBeInTheDocument();
    expect(invoice.amountInWordsTh).toMatch(/บาท/);
    expect(within(doc!).getByText("กำหนดชำระ").nextElementSibling).toHaveTextContent("ชำระก่อนเริ่มงาน");
  });
  it("มัดจำตั้งวันเอง → 'ชำระภายใน <วันที่> (ก่อนเริ่มงาน)' · ใบคงเหลือ → 'ชำระภายใน <วันที่>'", () => {
    const a = renderPrint(row({ payBeforeWork: false, dueDate: "2026-10-23" }));
    expect(within(a.doc!).getByText("กำหนดชำระ").nextElementSibling?.textContent).toMatch(/^ชำระภายใน .+ \(ก่อนเริ่มงาน\)$/);
    a.unmount();
    const b = renderPrint(row({ kind: "balance", payBeforeWork: false, dueDate: "2026-10-23" }));
    expect(within(b.doc!).getByText("กำหนดชำระ").nextElementSibling?.textContent).toMatch(/^ชำระภายใน [^(]+$/);
  });
  it("รายการ: # รายการ จำนวน ราคา/ชิ้น รวม (th scope=col) · sku นำหน้าชื่อ · ค่าแบบ/ส่วนลดแสดงเมื่อ > 0 เท่านั้น", () => {
    const a = renderPrint(row());
    expect(within(a.doc!).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["#", "รายการ", "จำนวน", "ราคา/ชิ้น", "รวม"]);
    expect(a.doc!.querySelectorAll('th[scope="col"]').length).toBe(5);
    expect(within(a.doc!).getByText(/TEST-SKU ·/)).toBeInTheDocument();
    expect(a.doc!.textContent).not.toContain("ค่าแบบ");
    expect(a.doc!.textContent).not.toContain("ส่วนลด");
    a.unmount();
    const b = renderPrint(row({ nrePriceThb: 1000, discountThb: 500, piecesSubtotalThb: 10000, grandTotalThb: 10500 }));
    expect(within(b.doc!).getByText("ค่าแบบ")).toBeInTheDocument();
    expect(within(b.doc!).getByText("ส่วนลด").nextElementSibling).toHaveTextContent(/^−/);
    // ส่วนลดเป็นตัวเลขเท่านั้น ไม่มีเหตุผล
    expect(b.doc!.textContent).not.toContain(POISON.discountReason);
    expect(within(b.doc!).getByText("ยอดสุทธิตามใบเสนอราคา")).toBeInTheDocument();
  });
  it("กล่อง 'ยอดของใบนี้': มัดจำ = เงินมัดจำตามที่ตกลง + คงเหลือหลังชำระมัดจำ · คงเหลือ = ยอดสุทธิ / ชำระแล้ว− (ซ่อนถ้า 0) / ยอดคงเหลือที่ต้องชำระ", () => {
    const dep = renderPrint(row());
    expect(dep.doc!.textContent).toContain("เงินมัดจำตามที่ตกลง");
    expect(dep.doc!.textContent).toContain("คงเหลือหลังชำระมัดจำ");
    dep.unmount();
    const full = renderPrint(row({ kind: "balance", payBeforeWork: false, dueDate: "2026-10-23", amountThb: 10000, paidBeforeThb: 0, balanceAfterThb: 0 }));
    const fullBox = within(full.doc!).getByText("ยอดของใบนี้").closest("div")!;
    expect(fullBox.textContent).toContain("ยอดคงเหลือที่ต้องชำระ");
    expect(fullBox.textContent).not.toContain("ชำระแล้ว");
    expect(fullBox.textContent).not.toContain("คงเหลือหลังชำระมัดจำ");
    full.unmount();
    const bal = renderPrint(row({ kind: "balance", payBeforeWork: false, dueDate: "2026-10-23", amountThb: 5000, paidBeforeThb: 5000, balanceAfterThb: 0 }));
    const balBox = within(bal.doc!).getByText("ยอดของใบนี้").closest("div")!;
    expect(balBox.textContent).toContain("ชำระแล้ว");
    expect(balBox.textContent).toMatch(/−฿?5,000/);
  });
  it("ช่องทางชำระเงิน: ทีละบรรทัด whitespace-pre-wrap break-words · หมายเหตุ · ช่องเซ็น 'ผู้ออกเอกสาร'", () => {
    const { doc } = renderPrint(row({ paymentLines: ["TEST-ONLY ก", "TEST-ONLY ข"], note: "TEST-ONLY หมายเหตุ" }));
    const item = within(doc!).getByText("TEST-ONLY ก");
    expect(item).toHaveClass("whitespace-pre-wrap", "break-words");
    expect(within(doc!).getByText("TEST-ONLY ข")).toBeInTheDocument();
    expect(within(doc!).getByText("ช่องทางชำระเงิน")).toBeInTheDocument();
    expect(within(doc!).getByText("TEST-ONLY หมายเหตุ")).toBeInTheDocument();
    expect(within(doc!).getByText("ผู้ออกเอกสาร")).toBeInTheDocument();
  });
  it("break-inside-avoid ที่แถบยอด กล่องยอดของใบนี้ ช่องทางชำระ", () => {
    const { doc } = renderPrint(row());
    expect(within(doc!).getByText("ยอดที่ต้องชำระครั้งนี้").closest(".break-inside-avoid")).not.toBeNull();
    expect(within(doc!).getByText("ยอดของใบนี้").closest(".break-inside-avoid")).not.toBeNull();
    expect(within(doc!).getByText("ช่องทางชำระเงิน").closest(".break-inside-avoid")).not.toBeNull();
  });
});

describe("PrintInvoiceClient — ข้อความพนักงาน print:hidden", () => {
  it("ใบปกติ: ปุ่มพิมพ์ + toolbar ใต้ print:hidden · กดแล้วเรียก window.print", async () => {
    const print = vi.fn();
    window.print = print;
    renderPrint(row());
    const btn = screen.getByRole("button", { name: /พิมพ์ \/ บันทึกเป็น PDF/ });
    expect(underPrintHidden(btn)).toBe(true);
    await userEvent.click(btn);
    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: /กลับไปใบเสนอราคา/ })).toHaveAttribute("href", `/oem/quotes/${QUOTE_ID}`);
  });
  it("หมดอายุ / ชำระแล้ว / เลยกำหนด: แถบอยู่ใต้ print:hidden ทุกอัน และไม่ติดเอกสาร", () => {
    const { doc } = renderPrint(
      row({
        kind: "balance",
        payBeforeWork: false,
        dueDate: "2026-10-10",
        isOverdue: true,
        dealQuoteExpired: true,
        paymentState: "paid",
        receiptNo: "RT-2610-777",
      })
    );
    // paid ซ่อน overdue/expired ตามลำดับความสำคัญ — ตรวจแถบที่เหลือ
    const paid = screen.getByText(/ใบนี้ชำระแล้ว \(RT-2610-777\) ส่งซ้ำลูกค้าหรือไม่\?/);
    expect(underPrintHidden(paid)).toBe(true);
    expect(doc!.textContent).not.toContain("RT-2610-777");
    expect(doc!.textContent).not.toMatch(/ส่งซ้ำลูกค้า|เลยกำหนด|หมดอายุ|ควรยืนยันราคา/);
  });
  it("หมดอายุ (ยังไม่ชำระ): แถบ amber มีวันยืนราคา · print:hidden", () => {
    const { doc } = renderPrint(row({ dealQuoteExpired: true }));
    const bar = screen.getByText(/ใบเสนอราคาต้นทางหมดอายุแล้ว \(ยืนราคาถึง .+\) ควรยืนยันราคากับลูกค้าก่อนส่ง/);
    expect(underPrintHidden(bar)).toBe(true);
    expect(doc!.textContent).not.toMatch(/หมดอายุ|ควรยืนยันราคา/);
  });
  it("เลยกำหนด (ใบคงเหลือ): แถบ print:hidden · ใบมัดจำ due=issue ไม่ขึ้นเลยกำหนดแม้ isOverdue หลุดมา", () => {
    const a = renderPrint(row({ kind: "balance", payBeforeWork: false, dueDate: "2026-10-10", isOverdue: true }));
    const bar = screen.getByText(/เลยกำหนดชำระแล้ว/);
    expect(underPrintHidden(bar)).toBe(true);
    expect(a.doc!.textContent).not.toContain("เลยกำหนด");
    a.unmount();
    renderPrint(row({ isOverdue: true }));
    expect(screen.queryByText(/เลยกำหนดชำระแล้ว/)).toBeNull();
  });
  it("กระดาษไม่มีสถานะ paid/overdue/stale/void ใดๆ (snapshot)", () => {
    const { doc } = renderPrint(row({ isOverdue: true, isStale: false, paymentState: "unpaid" }));
    expect(doc!.textContent).not.toMatch(/เลยกำหนด|ล้าสมัย|ยกเลิกแล้ว|VOID|ส่งซ้ำ/);
  });
});

describe("PrintInvoiceClient — ใบ void: ดูบนจอ พิมพ์ไม่ได้", () => {
  const voidRow = () => row({ status: "void", paymentState: "void", voidReason: POISON.voidReason, voidedAt: "2026-10-17T03:00:00Z" });

  it("เอกสาร .oem-print-doc ถูก print:hidden · ไม่มีปุ่มพิมพ์ · แถบแดง + ลายน้ำ · ข้อความ print-only 'พิมพ์ไม่ได้'", () => {
    const { doc, container } = renderPrint(voidRow());
    expect(doc).not.toBeNull();
    expect(doc).toHaveClass("print:hidden");
    expect(screen.queryByRole("button", { name: /พิมพ์/ })).toBeNull();
    expect(screen.getByText(/ใบนี้ถูกยกเลิกแล้ว.+ดูได้บนจอเท่านั้น พิมพ์ไม่ได้/)).toBeInTheDocument();
    expect(within(doc!).getByText("ยกเลิกแล้ว · VOID")).toBeInTheDocument();
    const printOnly = screen.getByText("ใบแจ้งหนี้นี้ถูกยกเลิกแล้ว — พิมพ์ไม่ได้");
    expect(printOnly.parentElement).toHaveClass("hidden", "print:block");
    expect(container.querySelectorAll(".oem-print-doc").length).toBe(1);
  });
  it("เหตุผลที่ยกเลิก: แสดงบนจอ (ใต้ print:hidden) · ไม่อยู่ในเอกสาร", () => {
    const { doc } = renderPrint(voidRow());
    const reason = screen.getByText(new RegExp(POISON.voidReason));
    expect(underPrintHidden(reason)).toBe(true);
    expect(doc!.textContent).not.toContain(POISON.voidReason);
  });
  it("ใบ void ยังขึ้นบรรทัด 'ไม่ใช่ใบกำกับภาษี' ในเอกสาร (ไม่มีข้อยกเว้นตามสถานะ)", () => {
    const { doc } = renderPrint(voidRow());
    expect(within(doc!).getByText(OEM_INVOICE_NOT_TAX_INVOICE_TH)).toBeInTheDocument();
  });
});

describe("leak test — ค่าวางยา", () => {
  it("props (PrintableInvoice + notices) และ HTML ที่ render ไม่มีค่าวางยา (ใบปกติ)", () => {
    const r = row({ voidReason: POISON.voidReason }); // status issued แต่ row มี voidReason หลุด
    const { container, invoice, notices } = renderPrint(r);
    const serialized = JSON.stringify({ invoice, notices });
    const html = container.innerHTML;
    for (const v of Object.values(POISON)) {
      expect(serialized).not.toContain(v);
      expect(html).not.toContain(v);
    }
  });
  it("ใบ void: voidReason อยู่เฉพาะใน notices (staff) — ไม่อยู่ใน PrintableInvoice และไม่อยู่ในเอกสาร", () => {
    const r = row({ status: "void", paymentState: "void", voidReason: POISON.voidReason, voidedAt: "2026-10-17T03:00:00Z" });
    const { invoice, notices, doc } = renderPrint(r);
    expect(JSON.stringify(invoice)).not.toContain(POISON.voidReason);
    expect(notices.voidReason).toBe(POISON.voidReason);
    expect(doc!.textContent).not.toContain(POISON.voidReason);
  });
});

describe("หน้า server /oem/invoices/[id]/print", () => {
  const params = Promise.resolve({ id: INV_ID });

  it("staff → EmptyState จำกัดสิทธิ์ ไม่โหลดใบ", async () => {
    getEffectiveRole.mockResolvedValue("staff");
    render(await OemInvoicePrintPage({ params }));
    expect(screen.getByText("หน้านี้จำกัดสิทธิ์")).toBeInTheDocument();
    expect(getInvoice).not.toHaveBeenCalled();
  });
  it("ไม่พบ/โหลดไม่ได้ → ErrorState", async () => {
    getInvoice.mockResolvedValue({ ok: false, error: "ไม่พบใบแจ้งหนี้นี้" });
    render(await OemInvoicePrintPage({ params }));
    expect(screen.getByRole("alert")).toHaveTextContent("ไม่พบใบแจ้งหนี้นี้");
    expect(toPrintableInvoiceSpy).not.toHaveBeenCalled();
  });
  it("action throw → ErrorState (ไม่ล่ม)", async () => {
    getInvoice.mockRejectedValue(new Error("network down"));
    render(await OemInvoicePrintPage({ params }));
    expect(screen.getByRole("alert")).toHaveTextContent("network down");
  });
  it("ใบปกติ → เอกสารพิมพ์ได้ + เรียก toPrintableInvoice ครั้งเดียว", async () => {
    getInvoice.mockResolvedValue({ ok: true, data: row() });
    const { container } = render(await OemInvoicePrintPage({ params }));
    expect(container.querySelector(".oem-print-doc")).not.toBeNull();
    expect(screen.getByRole("button", { name: /พิมพ์ \/ บันทึกเป็น PDF/ })).toBeInTheDocument();
    expect(toPrintableInvoiceSpy).toHaveBeenCalledTimes(1);
    for (const v of Object.values(POISON)) expect(container.innerHTML).not.toContain(v);
  });
  it("🔴 ใบ stale → ไม่มี .oem-print-doc · ไม่เรียก toPrintableInvoice · การ์ดแดง print:hidden + ลิงก์ใบเสนอราคา · ไม่มีปุ่มพิมพ์", async () => {
    getInvoice.mockResolvedValue({ ok: true, data: row({ isStale: true, amountThb: 5000, issueDate: "2026-10-16" }) });
    const { container } = render(await OemInvoicePrintPage({ params }));
    expect(container.querySelector(".oem-print-doc")).toBeNull();
    expect(toPrintableInvoiceSpy).not.toHaveBeenCalled();
    const card = screen.getByText(/พิมพ์ใบนี้ไม่ได้ — ยอดใบเสนอราคา\/เงินที่รับเปลี่ยนไปหลังออกใบ IV-2610-001 \(ยอดบนใบ .*5,000.* ออก .+\)/);
    expect(underPrintHidden(card)).toBe(true);
    expect(screen.getByRole("link", { name: "ไปที่ใบเสนอราคา" })).toHaveAttribute("href", `/oem/quotes/${QUOTE_ID}`);
    expect(screen.queryByRole("button", { name: /พิมพ์/ })).toBeNull();
    // กระดาษ (Ctrl+P): เหลือแค่ข้อความ "พิมพ์ไม่ได้" ไม่มีเนื้อหาใบ
    const printOnly = screen.getByText("เอกสารนี้ยังพิมพ์ไม่ได้");
    expect(printOnly.parentElement).toHaveClass("hidden", "print:block");
    expect(container.textContent).not.toContain(OEM_INVOICE_NOT_TAX_INVOICE_TH);
    expect(container.textContent).not.toContain("TEST-ONLY");
  });
  it("stale ที่ดีลต่อราคาไปแล้ว → ลิงก์ไปใบ active ของดีล", async () => {
    getInvoice.mockResolvedValue({ ok: true, data: row({ isStale: true, activeQuoteId: "99999999-9999-4999-8999-999999999999" }) });
    render(await OemInvoicePrintPage({ params }));
    expect(screen.getByRole("link", { name: "ไปที่ใบเสนอราคา" })).toHaveAttribute("href", "/oem/quotes/99999999-9999-4999-8999-999999999999");
  });
  it("ใบ void → แสดงบนจอ: เอกสาร print:hidden ไม่มีปุ่มพิมพ์ (แม้ isStale หลุดมาเป็น true ก็ไม่ใช่การ์ด stale)", async () => {
    getInvoice.mockResolvedValue({ ok: true, data: row({ status: "void", paymentState: "void", voidReason: "x ยกเลิกเพราะผิด", isStale: true }) });
    const { container } = render(await OemInvoicePrintPage({ params }));
    const doc = container.querySelector(".oem-print-doc");
    expect(doc).not.toBeNull();
    expect(doc).toHaveClass("print:hidden");
    expect(screen.queryByRole("button", { name: /พิมพ์/ })).toBeNull();
  });
});
