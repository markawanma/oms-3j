// @vitest-environment jsdom
// ProductionAddItemForm — โหมด "ไม่มี SKU — ใส่ชื่อแบบ" (UX A.4) เมื่อเปิด flag ALLOW_UNBOUND_ITEM_OFFICE
// ตอนนี้ flag ปิด (ทางตัน — ไม่มี RPC ผูก SKU จนถึง W1) เทสชุดนี้ mock ค่าคงที่เป็น true เพื่อไม่ให้โค้ดที่ซ่อนไว้เน่า — ถ้า W1 เปิด flag เทสเหล่านี้ต้องผ่านทันที
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";

const setItem = vi.fn();
const prefillMock = vi.fn();
vi.mock("@/lib/actions/production", () => ({
  setProductionOrderItem: (...a: unknown[]) => setItem(...a),
  getProductionItemPrefill: (...a: unknown[]) => prefillMock(...a),
}));
vi.mock("@/lib/actions/catalog-sku", () => ({ listSkuPrefixes: () => Promise.resolve({ ok: true, data: [] }), createCatalogSku: vi.fn() }));
vi.mock("@/lib/actions/oem", () => ({}));
vi.mock("@/lib/production/metal-ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/production/metal-ui")>()), ALLOW_UNBOUND_ITEM_OFFICE: true }));

import { ToastProvider } from "@/components/ui/Toast";
import { ProductionAddItemForm } from "./ProductionAddItemForm";

afterEach(cleanup);
beforeEach(() => {
  setItem.mockReset();
  prefillMock.mockReset();
});

function renderForm(extra: Partial<React.ComponentProps<typeof ProductionAddItemForm>> = {}) {
  const onAdded = vi.fn();
  render(
    <ToastProvider>
      <ProductionAddItemForm productionOrderId="po-1" skuOptions={[]} skuOptionsError={null} onAdded={onAdded} {...extra} />
    </ToastProvider>
  );
  return { onAdded };
}

const purityBox = () => screen.getByRole("textbox", { name: /ความบริสุทธิ์/ }) as HTMLInputElement;
const addBtn = () => screen.getByRole("button", { name: "เพิ่มรายการ" });
async function toNoSku() {
  await userEvent.click(screen.getByRole("radio", { name: "ไม่มี SKU — ใส่ชื่อแบบ" }));
}

describe("flag เปิด: โหมด 'ไม่มี SKU — ใส่ชื่อแบบ'", () => {
  it("segmented เป็น radiogroup มีชื่อ · เริ่มที่ 'มี SKU'", () => {
    renderForm();
    expect(screen.getByRole("radiogroup", { name: "รูปแบบรายการ" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "มี SKU" })).toBeChecked();
    expect(screen.getByText(/หรือเลือก "ไม่มี SKU — ใส่ชื่อแบบ"/)).toBeInTheDocument();
  });

  it("สลับโหมด: ซ่อนช่องค้น SKU/ปุ่มสินค้าใหม่ · การ์ดร่างขึ้นทันที ค่าเริ่มเงิน 92.50 · ไม่มีช่อง 'แบบใหม่' · บอกว่าจะมีป้ายยังไม่ผูก SKU", async () => {
    renderForm();
    await toNoSku();
    expect(screen.queryByRole("combobox", { name: "ค้นหา SKU" })).toBeNull();
    expect(screen.queryByRole("button", { name: /สินค้าใหม่/ })).toBeNull();
    expect(screen.getByRole("radio", { name: "เงิน" })).toBeChecked();
    expect(purityBox().value).toBe("92.50");
    expect(screen.queryByRole("checkbox", { name: /แบบใหม่/ })).toBeNull();
    expect(screen.getByText(/ยังไม่ผูก SKU/)).toBeInTheDocument();
    expect(prefillMock).not.toHaveBeenCalled();
  });

  it("ไม่กรอกชื่อแบบ → error + focus · ไม่ยิง server", async () => {
    renderForm();
    await toNoSku();
    await userEvent.click(addBtn());
    expect(setItem).not.toHaveBeenCalled();
    expect(await screen.findByText("กรอกชื่อแบบ")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("textbox", { name: /ชื่อแบบ/ })).toHaveFocus());
  });

  it("เพิ่ม: ส่ง pendingProductLabel + metal + purity (ไม่ส่ง productId · น้ำหนักว่างไม่ส่ง)", async () => {
    setItem.mockResolvedValue({ ok: true, data: { id: "i-9", productId: null, sku: null, name: "แหวนทดลองลายใบไม้", pendingProductLabel: "แหวนทดลองลายใบไม้", qtyPlanned: 1, isNewDesign: false, metal: "silver", purity: 0.925, weightG: null, weightSource: null } });
    const { onAdded } = renderForm();
    await toNoSku();
    await userEvent.type(screen.getByRole("textbox", { name: /ชื่อแบบ/ }), "แหวนทดลองลายใบไม้");
    await userEvent.click(addBtn());
    await waitFor(() => expect(setItem).toHaveBeenCalled());
    expect(setItem.mock.calls[0][0]).toEqual({ productionOrderId: "po-1", pendingProductLabel: "แหวนทดลองลายใบไม้", qtyPlanned: 1, metal: "silver", purity: 0.925 });
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(await screen.findByText("เพิ่ม แหวนทดลองลายใบไม้ จำนวน 1 ชิ้นแล้ว")).toBeInTheDocument();
  });

  it("ชื่อแบบซ้ำกับรายการที่มีอยู่ (ยุบช่องว่าง/ไม่สนตัวพิมพ์) → บล็อก", async () => {
    renderForm({ existingLabels: ["แหวน  Test"] });
    await toNoSku();
    await userEvent.type(screen.getByRole("textbox", { name: /ชื่อแบบ/ }), "แหวน test");
    expect(await screen.findByText("ชื่อแบบนี้มีอยู่ในใบผลิตนี้แล้ว — แก้ที่การ์ดเดิมแทน")).toBeInTheDocument();
    expect(addBtn()).toBeDisabled();
  });

  it("สลับกลับ 'มี SKU' = ล้างฟอร์ม (ไม่พกชื่อแบบ/ค่าค้างข้ามโหมด)", async () => {
    renderForm();
    await toNoSku();
    await userEvent.type(screen.getByRole("textbox", { name: /ชื่อแบบ/ }), "abc");
    await userEvent.click(screen.getByRole("radio", { name: "มี SKU" }));
    expect(screen.queryByRole("textbox", { name: /ชื่อแบบ/ })).toBeNull();
    await toNoSku();
    expect((screen.getByRole("textbox", { name: /ชื่อแบบ/ }) as HTMLInputElement).value).toBe("");
  });
});
