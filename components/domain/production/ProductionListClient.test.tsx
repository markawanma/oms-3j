// @vitest-environment jsdom
// ProductionListClient (PM-B · A.9): ป้าย "ยังไม่ผูก SKU n" เฉพาะใบ open ที่มีรายการไม่มี SKU · 4 state ของรายการ
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import type { ProductionOrderRow } from "@/lib/production/types";
import { ProductionListClient } from "./ProductionListClient";

afterEach(cleanup);

function order(over: Partial<ProductionOrderRow> = {}): ProductionOrderRow {
  return {
    id: "po-1", poNo: "PO-0034", status: "open", note: null, spotOverrideThbPerGram: null, doneAt: null, cancelledAt: null, cancelReason: null,
    createdAt: "2026-10-20T02:12:00Z", updatedAt: "2026-10-20T02:12:00Z", itemCount: 2, qtyPlannedTotal: 30, qtyDoneTotal: 0, unboundItemCount: 0, openedVia: "office", openedByWorkerName: null, acknowledgedAt: null, ...over,
  };
}

const rowOf = (poNo: string) => screen.getByRole("link", { name: poNo }).closest("tr") as HTMLElement;

describe("ป้าย 'ยังไม่ผูก SKU n'", () => {
  it("ใบ open ที่มีรายการไม่มี SKU → ป้ายพร้อมจำนวน (ข้อความเสมอ ไม่พึ่งสี) · ใบที่ไม่มี → ไม่มีป้าย", () => {
    render(<ProductionListClient orders={[order({ id: "a", poNo: "PO-0034", unboundItemCount: 2 }), order({ id: "b", poNo: "PO-0035" })]} />);
    expect(within(rowOf("PO-0034")).getByText(/ยังไม่ผูก SKU 2/)).toBeInTheDocument();
    expect(within(rowOf("PO-0035")).queryByText(/ยังไม่ผูก SKU/)).toBeNull();
  });
  it("ใบ cancelled/done ที่ยังมีรายการไม่มี SKU ค้าง → ไม่ขึ้นป้าย (ไม่มีอะไรให้จัดการแล้ว)", () => {
    render(
      <ProductionListClient
        orders={[order({ id: "c", poNo: "PO-0040", status: "cancelled", unboundItemCount: 1 }), order({ id: "d", poNo: "PO-0041", status: "done", unboundItemCount: 1, qtyDoneTotal: 5 })]}
      />
    );
    // ตารางไม่มีป้าย (ปุ่มกรอง "ยังไม่ผูก SKU (n)" อยู่นอกตาราง — นับเฉพาะใบ open จึงเป็น 0)
    expect(within(screen.getByRole("table")).queryByText(/ยังไม่ผูก SKU/)).toBeNull();
  });
  it("ป้ายไม่ซ่อนข้ามตัวกรองสถานะ: เลือก 'กำลังผลิต' ยังเห็นป้าย", async () => {
    render(<ProductionListClient orders={[order({ id: "a", poNo: "PO-0034", unboundItemCount: 1 })]} />);
    await userEvent.click(screen.getByRole("button", { name: "กำลังผลิต" }));
    expect(screen.getByText(/ยังไม่ผูก SKU 1/)).toBeInTheDocument();
  });
});

describe("state เดิมไม่พัง", () => {
  it("empty: ไม่มีใบ → ข้อความเดิม + ปุ่มสร้าง", () => {
    render(<ProductionListClient orders={[]} />);
    expect(screen.getByText("ยังไม่มีใบผลิต")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /สร้างใบผลิตใบแรก/ })).toHaveAttribute("href", "/production/new");
  });
  it("success: แสดงเลขที่/สถานะ/จำนวน เหมือนเดิม · ตัวกรองไม่เจอ → ข้อความ", async () => {
    render(<ProductionListClient orders={[order()]} />);
    const r = rowOf("PO-0034");
    expect(within(r).getByText("กำลังผลิต")).toBeInTheDocument();
    expect(within(r).getByText("30")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(screen.getByText("ไม่พบใบผลิตในสถานะนี้")).toBeInTheDocument();
  });
});
