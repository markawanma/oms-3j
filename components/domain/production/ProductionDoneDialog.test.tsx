// @vitest-environment jsdom
// ProductionDoneDialog — บรรทัดราคาทอง/ทองเหลืองที่จะใช้ (PM-A รอบ 3 ข้อ 6) · โชว์ค่าที่ server คืน (preview.metalPrices) เท่านั้น
// ทองเหลือง: server เก็บบาท/กรัม → แสดงเป็นบาท/กก. ด้วยการเลื่อนจุดทศนิยม (ไม่คำนวณราคาใหม่ฝั่ง client)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ProductionOrderItemRow, ProductionOrderPreview, ProductionOrderRow } from "@/lib/production/types";

const previewMock = vi.fn();
vi.mock("@/lib/actions/production", () => ({
  previewProductionOrder: (...args: unknown[]) => previewMock(...args),
  doneProductionOrder: vi.fn(),
}));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));

import { ProductionDoneDialog } from "./ProductionDoneDialog";

afterEach(cleanup);
beforeEach(() => previewMock.mockReset());

const order = { id: "po-1", poNo: "PO-TEST-1" } as unknown as ProductionOrderRow;
const items = [
  { id: "i-1", productId: "p-1", sku: "SKU-1", productName: "ทดสอบ", qtyPlanned: 2, makeSpec: null },
] as unknown as ProductionOrderItemRow[];

function previewWith(over: Partial<ProductionOrderPreview>): { ok: true; data: ProductionOrderPreview } {
  return {
    ok: true,
    data: { productionOrderId: "po-1", poNo: "PO-TEST-1", spotPriceThbPerGram: null, metalPrices: {}, missingPrices: [], items: [], ...over },
  };
}

async function renderWith(over: Partial<ProductionOrderPreview>) {
  previewMock.mockResolvedValue(previewWith(over));
  render(<ProductionDoneDialog order={order} items={items} onClose={() => {}} onDone={() => {}} />);
  await waitFor(() => expect(previewMock).toHaveBeenCalled());
}

describe("ProductionDoneDialog — ราคาโลหะที่จะใช้", () => {
  it("ทอง: แสดง 'ราคาทองที่จะใช้: X บาท/กรัม (ทอง 100%)' จากค่า server", async () => {
    await renderWith({ metalPrices: { gold: 2804.1271 } });
    const el = await screen.findByTestId("done-gold-price");
    expect(el).toHaveTextContent("ราคาทองที่จะใช้: 2,804.1271 บาท/กรัม (ทอง 100%)");
    expect(screen.queryByTestId("done-brass-price")).toBeNull();
  });

  it("ทองเหลือง: แสดงเป็น บาท/กก. (0.3506 → 350.6) พร้อมค่าต่อกรัมที่ server คืน", async () => {
    await renderWith({ metalPrices: { brass: 0.3506 } });
    const el = await screen.findByTestId("done-brass-price");
    expect(el).toHaveTextContent("ราคาทองเหลืองที่จะใช้: 350.6 บาท/กก.");
    expect(el).toHaveTextContent("0.3506 บาท/กรัม");
    expect(screen.queryByTestId("done-gold-price")).toBeNull();
  });

  it("ใบเงินล้วน (ไม่มีทอง/ทองเหลืองใน metalPrices): ไม่แสดงบรรทัดทอง/ทองเหลือง · บรรทัดราคาเงินเดิมยังอยู่", async () => {
    await renderWith({ spotPriceThbPerGram: 36.5, metalPrices: { silver: 36.5 } });
    await screen.findByText(/ราคาเงินที่จะใช้ในใบนี้/);
    expect(screen.queryByTestId("done-gold-price")).toBeNull();
    expect(screen.queryByTestId("done-brass-price")).toBeNull();
  });

  it("ยังไม่มีราคาทองของวันนี้ (missingPrices) → ไม่แสดงบรรทัดราคาทอง (ไม่แต่งค่า) และปุ่มยืนยันถูกปิด", async () => {
    await renderWith({ metalPrices: {}, missingPrices: ["gold"] });
    await screen.findByText(/ยังไม่มีราคาทองของวันนี้/);
    expect(screen.queryByTestId("done-gold-price")).toBeNull();
    expect(screen.getByRole("button", { name: /ยืนยันผลิตเสร็จ/ })).toBeDisabled();
  });
});
