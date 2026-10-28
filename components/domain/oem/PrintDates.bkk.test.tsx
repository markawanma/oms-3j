// @vitest-environment jsdom
// วันที่บนเอกสารพิมพ์ OEM = วันไทย (ไม่ใช่ UTC) — เดิมใช้ ts.slice(0, 10) ได้วัน UTC → ออกใบ 00:00-07:00 เวลาไทยพิมพ์วันก่อนหน้า 1 วัน
// ชื่อไฟล์ PDF ใช้ bkkYYMMDD ตัวเดียวกัน → ต้องตรงกับวันบนกระดาษ
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { vi } from "vitest";

afterEach(cleanup);
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: ReactNode }) => <a href={href} {...r}>{children}</a> }));

import { toInvoicePrintNotices, toPrintableInvoice } from "@/lib/oem/printableInvoice";
import { toPrintableQuote } from "@/lib/oem/printableQuote";
import { toPrintableReceipt } from "@/lib/oem/printableReceipt";
import { quotePrintTitle } from "@/lib/oem/print-title";
import { PrintInvoiceClient } from "./PrintInvoiceClient";
import { PrintQuoteClient } from "./PrintQuoteClient";
import { PrintReceiptClient } from "./PrintReceiptClient";
import { SELLER_OK, invoiceFx, quoteFx, receiptFx } from "./invoiceTestFixtures";

function renderQuote(createdAt: string) {
  const q = toPrintableQuote(quoteFx({ createdAt, billLegalName: "ผู้ซื้อทดสอบ", customerName: "x" } as never), []);
  const r = render(<PrintQuoteClient quote={q} sellerProfile={SELLER_OK} />);
  return { q, text: r.container.querySelector(".oem-print-doc")?.textContent ?? r.container.textContent ?? "" };
}

describe("ใบเสนอราคา — 'วันที่ออก' บนกระดาษ", () => {
  it("createdAt 2026-10-20T18:00Z (01:00 วันที่ 21 ไทย) → กระดาษ 21 ต.ค. 2569 และชื่อไฟล์ 261021 (ตรงกัน)", () => {
    const { q, text } = renderQuote("2026-10-20T18:00:00+00:00");
    expect(text).toContain("วันที่ออก 21 ต.ค. 2569");
    expect(text).not.toContain("วันที่ออก 20 ต.ค.");
    expect(quotePrintTitle(q).startsWith("261021_")).toBe(true);
  });
  it("ขอบ: 16:59Z = 23:59 ไทย (วันเดิม 20) · 17:00Z = 00:00 ไทย (วัน 21)", () => {
    expect(renderQuote("2026-10-20T16:59:59+00:00").text).toContain("วันที่ออก 20 ต.ค. 2569");
    cleanup();
    expect(renderQuote("2026-10-20T17:00:00+00:00").text).toContain("วันที่ออก 21 ต.ค. 2569");
  });
  it("ข้ามปี: 2026-12-31T20:00Z → 1 ม.ค. 2570 · offset แบบสั้นของ Postgres (+00) ก็อ่านได้", () => {
    expect(renderQuote("2026-12-31T20:00:00+00:00").text).toContain("วันที่ออก 01 ม.ค. 2570");
    cleanup();
    expect(renderQuote("2026-10-20T18:00:00+00").text).toContain("วันที่ออก 21 ต.ค. 2569");
  });
  it("กลางวัน (03:00Z = 10:00 ไทย) วันเดียวกันทั้ง UTC/ไทย — ไม่เปลี่ยน", () => {
    expect(renderQuote("2026-10-21T03:00:00+00:00").text).toContain("วันที่ออก 21 ต.ค. 2569");
  });
});

describe("ใบเสร็จ — วันที่ยกเลิก (timestamp) เป็นวันไทย · วันที่ออก/รับเงิน (date ล้วน) ไม่เลื่อน", () => {
  it("void เมื่อ 2026-10-20T18:00Z → 'ยกเลิกแล้ว เมื่อ 21 ต.ค. 2569'", () => {
    const r = render(<PrintReceiptClient receipt={toPrintableReceipt(receiptFx({ status: "void", voidedAt: "2026-10-20T18:00:00+00:00" } as never))} />);
    expect(r.container.textContent).toContain("ใบนี้ถูกยกเลิกแล้ว เมื่อ 21 ต.ค. 2569");
  });
  it("issueDate/receivedDate = date ล้วน 2026-10-16 → 16 ต.ค. 2569 เสมอ", () => {
    const r = render(<PrintReceiptClient receipt={toPrintableReceipt(receiptFx({ issueDate: "2026-10-16", receivedDate: "2026-10-15" }))} />);
    const t = r.container.textContent ?? "";
    expect(t).toContain("วันที่ออก 16 ต.ค. 2569");
    expect(t).toContain("วันที่รับเงิน 15 ต.ค. 2569");
  });
});

/** ใบแจ้งหนี้ขั้นต่ำที่หน้าพิมพ์อ่านได้ (seller snapshot + บรรทัดสินค้า) */
function invoice(over: Record<string, unknown>) {
  return invoiceFx({
    sellerSnapshot: { legalName: "ร้านทดสอบ TEST-ONLY", displayName: null, branchLabel: "สำนักงานใหญ่", addressLines: ["TEST-ONLY ที่อยู่ร้าน"], taxId: "0000000000000", phone: "000-000-0000", vatRegistered: false },
    lines: [{ seq: 1, name: "สินค้าทดสอบ", sku: "TEST-SKU", qty: 2, unitPriceThb: 5000, lineTotalThb: 10000 }],
    ...over,
  } as never);
}

describe("ใบแจ้งหนี้ — วันที่ยกเลิก (timestamp) เป็นวันไทย · issueDate (date ล้วน) ไม่เลื่อน", () => {
  it("void เมื่อ 2026-10-20T18:00Z → 'เมื่อ 21 ต.ค. 2569'", () => {
    const row = invoice({ status: "void", paymentState: "void", voidedAt: "2026-10-20T18:00:00+00:00" });
    const r = render(<PrintInvoiceClient invoice={toPrintableInvoice(row)} notices={toInvoicePrintNotices(row)} />);
    expect(r.container.textContent).toContain("ใบนี้ถูกยกเลิกแล้ว เมื่อ 21 ต.ค. 2569");
  });
  it("issueDate 2026-10-16 → 'วันที่ออก 16 ต.ค. 2569'", () => {
    const row = invoice({ issueDate: "2026-10-16" });
    const r = render(<PrintInvoiceClient invoice={toPrintableInvoice(row)} notices={toInvoicePrintNotices(row)} />);
    expect(r.container.textContent).toContain("วันที่ออก 16 ต.ค. 2569");
  });
});

describe("ไม่มี ts.slice(0, 10) กับ timestamp เหลือในหน้าพิมพ์", () => {
  it("ซอร์สหน้าพิมพ์ OEM/ใบงาน ไม่มี .slice(0, 10) ของ createdAt/voidedAt", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["PrintQuoteClient", "PrintInvoiceClient", "PrintReceiptClient"]) {
      const src = readFileSync(`${process.cwd()}/components/domain/oem/${f}.tsx`, "utf8");
      expect(src, f).not.toMatch(/(createdAt|voidedAt|At)\.slice\(0, ?10\)/);
    }
  });
});
