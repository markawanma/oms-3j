// @vitest-environment jsdom
// หน้าพิมพ์ใบเสร็จ (I2): บรรทัด "อ้างอิงใบแจ้งหนี้เลขที่ IV-…" พิมพ์บนกระดาษ (ไม่ใต้ print:hidden) เมื่อมี invoiceNoSnapshot ·
// ใบเก่า/ไม่อ้างใบ = ไม่มีบรรทัด · invoiceId (uuid ภายใน) ไม่อยู่ใน HTML
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}));

import { toPrintableReceipt } from "@/lib/oem/printableReceipt";
import { PrintReceiptClient } from "./PrintReceiptClient";
import { receiptFx } from "./invoiceTestFixtures";

const POISON_INVOICE_UUID = "99999999-9999-4999-8999-999999999999";

function renderPrint(over: Parameters<typeof receiptFx>[0] = {}) {
  const r = render(<PrintReceiptClient receipt={toPrintableReceipt(receiptFx(over))} />);
  return { ...r, doc: r.container.querySelector(".oem-print-doc") as HTMLElement };
}

describe("PrintReceiptClient — อ้างอิงใบแจ้งหนี้ (0180)", () => {
  it("มี invoiceNoSnapshot -> บรรทัด 'อ้างอิงใบแจ้งหนี้เลขที่ IV-…' อยู่บนกระดาษ (ใน .oem-print-doc · ไม่ใต้ print:hidden)", () => {
    const { doc } = renderPrint({ invoiceId: POISON_INVOICE_UUID, invoiceNoSnapshot: "IV-2610-001" });
    expect(doc).not.toBeNull();
    expect(doc.textContent).toContain("อ้างอิงใบแจ้งหนี้เลขที่ IV-2610-001");
    const line = Array.from(doc.querySelectorAll("p")).find((p) => p.textContent?.includes("อ้างอิงใบแจ้งหนี้เลขที่"))!;
    expect(line.closest(".print\\:hidden")).toBeNull();
    // บรรทัดอ้างอิงใบเสนอราคาเดิมยังอยู่
    expect(doc.textContent).toContain("อ้างอิงใบเสนอราคาเลขที่ OEM-2610-004");
  });

  it("ใบเก่า / รับเงินแบบไม่อ้างใบ (null) -> ไม่มีบรรทัดอ้างอิงใบแจ้งหนี้", () => {
    const { doc, container } = renderPrint({ invoiceId: null, invoiceNoSnapshot: null });
    expect(doc.textContent).not.toContain("ใบแจ้งหนี้");
    expect(container.textContent).not.toContain("IV-");
  });

  it("🔴 invoiceId (uuid ภายใน) ไม่หลุดลง HTML", () => {
    const { container } = renderPrint({ invoiceId: POISON_INVOICE_UUID, invoiceNoSnapshot: "IV-2610-001" });
    expect(container.innerHTML).not.toContain(POISON_INVOICE_UUID);
  });
});
