// @vitest-environment jsdom
// /production (W1 · UX B.10.2): ป้าย จากหน้างาน · รอรับทราบ · ค้าง n วัน (วันปฏิทินไทย) + กลุ่มตัวกรอง "ต้องจัดการ" (AND กับแถบสถานะ · นับเฉพาะใบ open)
//  ต้องไม่พัง: ใบที่ออฟฟิศเปิดเอง = ไม่มีป้ายเพิ่ม · จอเดิมเมื่อไม่มีใบจากหน้างาน
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import type { ProductionOrderRow } from "@/lib/production/types";
import { ProductionListClient } from "./ProductionListClient";

beforeEach(() => {
  // วันนี้ (ไทย) = พุธ 21 ต.ค. 2569-ค.ศ.2026 · ใบเปิดจันทร์ 19 ต.ค. = วันที่ 3 = ค้าง
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-21T05:00:00Z") });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function order(over: Partial<ProductionOrderRow> = {}): ProductionOrderRow {
  return {
    id: "po-1", poNo: "PO-0034", status: "open", note: null, spotOverrideThbPerGram: null, doneAt: null, cancelledAt: null, cancelReason: null,
    createdAt: "2026-10-21T02:12:00Z", updatedAt: "2026-10-21T02:12:00Z", itemCount: 1, qtyPlannedTotal: 30, qtyDoneTotal: 0, unboundItemCount: 0, openedVia: "office", openedByWorkerName: null, acknowledgedAt: null, ...over,
  };
}
const shop = (o: Partial<ProductionOrderRow> = {}) => order({ openedVia: "shopfloor", openedByWorkerName: "หัวหน้าช่าง", ...o });
const rowOf = (poNo: string) => screen.getByRole("link", { name: poNo }).closest("tr") as HTMLElement;
const needBtn = (re: RegExp) => within(screen.getByRole("group", { name: "ต้องจัดการ" })).getByRole("button", { name: re });

describe("ป้ายในแถว", () => {
  it("ใบหน้างานรอรับทราบ (เพิ่งเปิดวันนี้): 'จากหน้างาน' + 'รอรับทราบ' (amber)", () => {
    render(<ProductionListClient orders={[shop()]} />);
    const r = rowOf("PO-0034");
    expect(within(r).getByText("จากหน้างาน")).toBeInTheDocument();
    expect(within(r).getByText("รอรับทราบ")).toBeInTheDocument();
    expect(within(r).queryByText(/ค้าง/)).toBeNull();
  });
  it("ค้างครบ 3 วันปฏิทินไทย → 'ค้าง 3 วัน' (แดง) แทน 'รอรับทราบ'", () => {
    render(<ProductionListClient orders={[shop({ createdAt: "2026-10-19T02:12:00Z" })]} />);
    const r = rowOf("PO-0034");
    expect(within(r).getByText("ค้าง 3 วัน")).toBeInTheDocument();
    expect(within(r).queryByText("รอรับทราบ")).toBeNull();
  });
  it("เปิดจันทร์ 18:00 UTC (= อังคาร 01:00 ไทย) → พุธ = 2 วัน ยังไม่ค้าง", () => {
    render(<ProductionListClient orders={[shop({ createdAt: "2026-10-19T18:00:00Z" })]} />);
    expect(within(rowOf("PO-0034")).getByText("รอรับทราบ")).toBeInTheDocument();
  });
  it("รับทราบแล้ว: เหลือ 'จากหน้างาน' ป้ายเดียว · ใบ done จากหน้างานก็ไม่ขึ้นรอรับทราบ", () => {
    render(
      <ProductionListClient
        orders={[shop({ id: "a", poNo: "PO-A", acknowledgedAt: "2026-10-21T03:00:00Z" }), shop({ id: "b", poNo: "PO-B", status: "done", qtyDoneTotal: 3, createdAt: "2026-10-01T00:00:00Z" })]}
      />
    );
    for (const po of ["PO-A", "PO-B"]) {
      expect(within(rowOf(po)).getByText("จากหน้างาน")).toBeInTheDocument();
      expect(within(rowOf(po)).queryByText(/รอรับทราบ|ค้าง/)).toBeNull();
    }
  });
  it("ใบที่ออฟฟิศเปิดเอง: ไม่มีป้ายใหม่เลย (จอเดิมเป๊ะ)", () => {
    render(<ProductionListClient orders={[order()]} />);
    const r = rowOf("PO-0034");
    expect(within(r).queryByText(/จากหน้างาน|รอรับทราบ|ค้าง/)).toBeNull();
    expect(r.querySelectorAll("td")[0].querySelector("div")).toBeNull();
  });
  it("ใบหน้างานไม่ผูก SKU: ป้ายสามอันรวมในบรรทัดเดียวใต้เลขที่ · ลิงก์ยังชื่อ = เลขที่เท่านั้น", () => {
    render(<ProductionListClient orders={[shop({ unboundItemCount: 1 })]} />);
    const r = rowOf("PO-0034");
    expect(within(r).getByText(/ยังไม่ผูก SKU 1/)).toBeInTheDocument();
    expect(within(r).getByText("จากหน้างาน")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PO-0034" })).toBeInTheDocument();
  });
});

describe("ตัวกรอง 'ต้องจัดการ'", () => {
  const orders = () => [
    shop({ id: "a", poNo: "PO-A" }),
    shop({ id: "b", poNo: "PO-B", unboundItemCount: 2 }),
    shop({ id: "c", poNo: "PO-C", acknowledgedAt: "2026-10-21T03:00:00Z", unboundItemCount: 1 }),
    order({ id: "d", poNo: "PO-D", unboundItemCount: 1 }),
    shop({ id: "e", poNo: "PO-E", status: "done", qtyDoneTotal: 2, unboundItemCount: 1 }),
    order({ id: "f", poNo: "PO-F" }),
  ];
  const shown = () => screen.getAllByRole("link").map((l) => l.textContent).filter((t) => /^PO-/.test(t ?? ""));

  it("ตัวนับนับเฉพาะใบ open: รอรับทราบ 2 (A,B) · ยังไม่ผูก SKU 3 (B,C,D) — ใบ done ไม่นับ", () => {
    render(<ProductionListClient orders={orders()} />);
    expect(needBtn(/รอรับทราบ/)).toHaveTextContent("รอรับทราบ (2)");
    expect(needBtn(/ยังไม่ผูก SKU/)).toHaveTextContent("ยังไม่ผูก SKU (3)");
    expect(needBtn(/รอรับทราบ/)).toHaveAttribute("aria-pressed", "false");
  });
  it("กดรอรับทราบ → เหลือ A,B · กดซ้ำ = ล้าง", async () => {
    render(<ProductionListClient orders={orders()} />);
    await userEvent.click(needBtn(/รอรับทราบ/));
    expect(needBtn(/รอรับทราบ/)).toHaveAttribute("aria-pressed", "true");
    expect(shown()).toEqual(["PO-A", "PO-B"]);
    await userEvent.click(needBtn(/รอรับทราบ/));
    expect(shown()).toHaveLength(6);
  });
  it("สองตัวกรอง = AND (รอรับทราบ ∧ ยังไม่ผูก SKU → B)", async () => {
    render(<ProductionListClient orders={orders()} />);
    await userEvent.click(needBtn(/รอรับทราบ/));
    await userEvent.click(needBtn(/ยังไม่ผูก SKU/));
    expect(shown()).toEqual(["PO-B"]);
  });
  it("AND กับแถบสถานะ: ยังไม่ผูก SKU + 'เข้าสต็อกแล้ว' → ไม่เหลือ (ใบ done ไม่ใช่ใบต้องจัดการ) + ล้างตัวกรอง", async () => {
    render(<ProductionListClient orders={orders()} />);
    await userEvent.click(needBtn(/ยังไม่ผูก SKU/));
    await userEvent.click(screen.getByRole("button", { name: "เข้าสต็อกแล้ว" }));
    expect(screen.getByText("ไม่มีรายการที่ยังไม่ผูก SKU")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ล้างตัวกรอง" }));
    expect(shown()).toHaveLength(6);
    expect(needBtn(/ยังไม่ผูก SKU/)).toHaveAttribute("aria-pressed", "false");
  });
  it("empty: ไม่มีใบรอรับทราบ → 'ไม่มีใบที่รอรับทราบ' · ปุ่มยังอยู่ (n = 0)", async () => {
    render(<ProductionListClient orders={[order({ id: "x", poNo: "PO-X" })]} />);
    expect(needBtn(/รอรับทราบ/)).toHaveTextContent("(0)");
    await userEvent.click(needBtn(/รอรับทราบ/));
    expect(screen.getByText("ไม่มีใบที่รอรับทราบ")).toBeInTheDocument();
  });
  it("ไม่มีใบเลย: ไม่แสดงกลุ่มตัวกรอง (empty เดิม)", () => {
    render(<ProductionListClient orders={[]} />);
    expect(screen.queryByRole("group", { name: "ต้องจัดการ" })).toBeNull();
    expect(screen.getByText("ยังไม่มีใบผลิต")).toBeInTheDocument();
  });
  it("ปุ่มตัวกรองไม่ทำให้ชื่อลิงก์เลขที่ผิด และไม่กระทบแถบสถานะเดิม", async () => {
    render(<ProductionListClient orders={orders()} />);
    await act(async () => {});
    await userEvent.click(screen.getByRole("button", { name: "กำลังผลิต" }));
    expect(shown()).toEqual(["PO-A", "PO-B", "PO-C", "PO-D", "PO-F"]);
  });
});
