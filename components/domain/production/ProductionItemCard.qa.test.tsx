// @vitest-environment jsdom
// QA (R2-D2) — characterization ของ 2 พฤติกรรมที่ผู้ใช้จะเจอเงียบๆ (DB ตัดสินแล้ว UI ต้องไม่โกหก):
//  Q-A) การ์ดเงินที่บันทึกแล้ว ผู้ใช้ "ล้างช่องเนื้อ" แล้วกดบันทึก → ส่ง 0.925 ชัดเจน (มติ: เงินว่าง = ใช้ 92.50 — เดิม QA ล็อกว่า "ไม่ส่ง/server คงค่าเดิม" ซึ่งเงียบเกินไป) → ช่องโชว์ค่าที่ server เก็บ
//  Q-B) SKU เงินที่มีน้ำหนัก: ล้างช่องน้ำหนัก → ส่ง clearWeight แต่ DB ยัง fallback ไป silver_weight_g ของ SKU → หลัง refresh ช่องต้องกลับมาเป็นค่า SKU (ไม่ค้างว่างหลอกว่า "ไม่ระบุ")
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import type { ProductionOrderItemRow } from "@/lib/production/types";

const setItem = vi.fn();
vi.mock("@/lib/actions/production", () => ({
  setProductionOrderItem: (...a: unknown[]) => setItem(...a),
}));
vi.mock("@/lib/actions/job-office", () => ({}));

import { ToastProvider } from "@/components/ui/Toast";
import { ProductionItemCard } from "./ProductionItemCard";

afterEach(cleanup);
beforeEach(() => {
  setItem.mockReset();
});

function row(over: Partial<ProductionOrderItemRow> = {}): ProductionOrderItemRow {
  return {
    id: "i-1", productionOrderId: "po-1", poNo: "PO-0034", orderStatus: "open", productId: "p-1", sku: "GR-0007", productName: "แหวนลายใบไม้",
    pendingProductLabel: null, currentCostType: "fixed", currentUnitCost: 120, metal: "silver", purity: 0.8, weightG: null, weightSource: null,
    effectiveMetal: "silver", effectivePurity: 0.8, effectiveWeightG: 3.2, effectiveWeightSource: "product",
    skuMetal: "silver", skuPurity: 0.925, skuWeightG: 3.2, skuMetalKnown: false, metalMismatch: false, qtyPlanned: 30, qtyDone: null, stampedUnitCost: null,
    prevCostType: null, prevUnitCost: null, createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z", makeSpec: null,
    currentSilverWeightG: 3.2, currentSilverPurity: 0.925, isNewDesign: false, costCalc: null, ...over,
  };
}
const openOrder = { id: "po-1", poNo: "PO-0034", status: "open" as const };
const wrap = (r: ProductionOrderItemRow) => (
  <ToastProvider>
    <ProductionItemCard order={openOrder} row={r} />
  </ToastProvider>
);
const purityBox = () => screen.getByRole("textbox", { name: /ความบริสุทธิ์/ }) as HTMLInputElement;
const weightBox = () => screen.getByRole("textbox", { name: /น้ำหนัก\/ชิ้น/ }) as HTMLInputElement;
const saveBtn = () => screen.getByRole("button", { name: "บันทึกรายการ" });

describe("QA Q-A (แก้ตามมติ — Tech Lead 21 ต.ค.): เงินล้างช่องเนื้อ แล้วบันทึก = 'ใช้ 92.50'", () => {
  it("ไม่ error · ส่ง purity 0.925 ชัดเจน (ไม่ใช่ไม่ส่ง/คงค่าเดิมเงียบ) · ช่องกลับเป็นค่าที่ server เก็บ (92.50) และไม่ dirty", async () => {
    setItem.mockResolvedValue({ ok: true, data: { id: "i-1", productId: "p-1", sku: "GR-0007", name: "x", pendingProductLabel: null, qtyPlanned: 30, isNewDesign: false, metal: "silver", purity: 0.925, weightG: null, weightSource: null } });
    render(wrap(row()));
    expect(purityBox().value).toBe("80.00");
    await userEvent.clear(purityBox());
    expect(saveBtn()).toBeEnabled();
    await userEvent.click(saveBtn());
    await waitFor(() => expect(setItem).toHaveBeenCalledTimes(1));
    expect(setItem.mock.calls[0][0]).toMatchObject({ purity: 0.925 });
    expect(setItem.mock.calls[0][0]).not.toHaveProperty("metal");
    await waitFor(() => expect(purityBox().value).toBe("92.50"));
    expect(saveBtn()).toBeDisabled();
  });
});

describe("QA Q-B: SKU เงินมีน้ำหนัก — ล้างช่องน้ำหนัก", () => {
  it("ส่ง clearWeight (ไม่ส่ง weightG) · พอ refresh กลับมา effective=3.2 ช่องต้องแสดง 3.2 พร้อมป้าย 'จาก SKU'", async () => {
    // server: ล้าง weight_g แล้ว แต่ helper ยัง fallback เป็นน้ำหนัก SKU
    setItem.mockResolvedValue({ ok: true, data: { id: "i-1", productId: "p-1", sku: "GR-0007", name: "x", pendingProductLabel: null, qtyPlanned: 30, isNewDesign: false, metal: "silver", purity: 0.8, weightG: null, weightSource: null } });
    const first = row({ weightG: null, weightSource: null });
    const { rerender } = render(wrap(first));
    await userEvent.clear(weightBox());
    await userEvent.click(saveBtn());
    await waitFor(() => expect(setItem).toHaveBeenCalledTimes(1));
    expect(setItem.mock.calls[0][0]).toMatchObject({ clearWeight: true });
    expect(setItem.mock.calls[0][0]).not.toHaveProperty("weightG");
    // router.refresh() → แถวใหม่ updatedAt เปลี่ยน แต่ effective weight ยัง 3.2
    rerender(wrap(row({ updatedAt: "2026-10-21T01:00:00Z" })));
    await waitFor(() => expect(weightBox().value).toBe("3.2"));
    expect(screen.getByText("จาก SKU", { selector: "span" })).toBeInTheDocument();
    expect(saveBtn()).toBeDisabled();
  });
});

describe("QA: ข้อมูลไทย/emoji ในชื่อ SKU/ชื่อแบบยาวมาก ไม่ทำให้การ์ดพัง", () => {
  it("ชื่อแบบยาว 600 ตัวอักษรไม่เว้นวรรค + emoji เรนเดอร์ได้ มี aria-label และปุ่มลบยังอยู่", () => {
    const label = "แหวน😀ลายใบไม้".repeat(40);
    render(
      <ToastProvider>
        <ProductionItemCard order={openOrder} row={row({ productId: null, sku: null, productName: null, pendingProductLabel: label, currentCostType: null, currentUnitCost: null })} onRemove={() => {}} />
      </ToastProvider>
    );
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(label);
    expect(screen.getByText(/ยังไม่ผูก SKU/, { selector: "span" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^ลบ / })).toBeInTheDocument();
  });
});
