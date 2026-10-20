// @vitest-environment jsdom
// ProductionAddItemForm (PM-B · UX A.4): มี SKU (prefill จาก server) / ไม่มี SKU (ชื่อแบบ) · ส่งค่าทั้งสามชัดเจน · ซ้ำในใบ = บล็อก · 4 state ของ prefill
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import type { ProductionItemPrefill, ProductionSkuOption } from "@/lib/production/types";

const setItem = vi.fn();
const prefillMock = vi.fn();
vi.mock("@/lib/actions/production", () => ({
  setProductionOrderItem: (...a: unknown[]) => setItem(...a),
  getProductionItemPrefill: (...a: unknown[]) => prefillMock(...a),
}));
vi.mock("@/lib/actions/catalog-sku", () => ({ listSkuPrefixes: () => Promise.resolve({ ok: true, data: [] }), createCatalogSku: vi.fn() }));
vi.mock("@/lib/actions/oem", () => ({}));

import { ToastProvider } from "@/components/ui/Toast";
import { ProductionAddItemForm } from "./ProductionAddItemForm";

afterEach(cleanup);
beforeEach(() => {
  setItem.mockReset();
  prefillMock.mockReset();
});

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const options: ProductionSkuOption[] = [
  { productId: P1, sku: "SV-0001", name: "แหวนเงิน", costType: "fixed" },
  { productId: P2, sku: "SP-0002", name: "ต่างหูสเปค", costType: "spec" },
];

function prefill(over: Partial<ProductionItemPrefill> = {}): { ok: true; data: ProductionItemPrefill } {
  return { ok: true, data: { productId: P1, sku: "SV-0001", name: "แหวนเงิน", costType: "fixed", metal: "silver", purity: 0.925, weightG: 3.2, weightSource: "product", metalKnown: false, ...over } };
}

function renderForm(extra: Partial<React.ComponentProps<typeof ProductionAddItemForm>> = {}) {
  const onAdded = vi.fn();
  render(
    <ToastProvider>
      <ProductionAddItemForm productionOrderId="po-1" skuOptions={options} skuOptionsError={null} onAdded={onAdded} {...extra} />
    </ToastProvider>
  );
  return { onAdded };
}

const skuBox = () => screen.getByRole("combobox", { name: "ค้นหา SKU" }) as HTMLInputElement;
const purityBox = () => screen.getByRole("textbox", { name: /ความบริสุทธิ์/ }) as HTMLInputElement;
const weightBox = () => screen.getByRole("textbox", { name: /น้ำหนัก\/ชิ้น/ }) as HTMLInputElement;
const qtyBox = () => screen.getByRole("spinbutton", { name: /จำนวน \(ชิ้น\)/ }) as HTMLInputElement;
const addBtn = () => screen.getByRole("button", { name: "เพิ่มรายการ" });

async function pickSku(label = "SV-0001 · แหวนเงิน") {
  await userEvent.click(skuBox());
  await userEvent.paste(label);
}

describe("โหมด 'มี SKU'", () => {
  it("เริ่มต้น: ยังไม่มีการ์ดร่าง · เลือก SKU → ขอ prefill จาก server → การ์ดร่างขึ้นด้วยเงิน/92.50/3.2 + ป้าย 'จาก SKU' + ข้อความกลาง (metal_known=false)", async () => {
    prefillMock.mockResolvedValue(prefill());
    renderForm();
    expect(screen.queryByRole("textbox", { name: /ความบริสุทธิ์/ })).toBeNull();
    await pickSku();
    expect(prefillMock).toHaveBeenCalledWith(P1);
    await waitFor(() => expect(purityBox().value).toBe("92.50"));
    expect(weightBox().value).toBe("3.2");
    expect(qtyBox().value).toBe("1");
    expect(screen.getAllByText("จาก SKU").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/สินค้านี้ยังไม่ระบุโลหะในระบบ/)).toBeInTheDocument();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("loading: ระหว่างรอ prefill แสดง status และยังไม่มีปุ่มเพิ่ม", async () => {
    let resolve!: (v: unknown) => void;
    prefillMock.mockReturnValue(new Promise((r) => (resolve = r)));
    renderForm();
    await pickSku();
    expect(await screen.findByText("กำลังโหลดค่าเริ่มของ SKU…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "เพิ่มรายการ" })).toBeNull();
    resolve(prefill());
    await waitFor(() => expect(purityBox()).toBeInTheDocument());
  });

  it("error: prefill ล้มเหลว → role=alert + ปุ่ม 'ลองอีกครั้ง' ยิงใหม่ได้ · ไม่มีการ์ดร่างให้เพิ่มทั้งที่ไม่รู้ค่าเริ่ม", async () => {
    prefillMock.mockResolvedValueOnce({ ok: false, error: "โหลดค่าเริ่มของ SKU ไม่สำเร็จ ลองใหม่อีกครั้ง" });
    renderForm();
    await pickSku();
    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดค่าเริ่มของ SKU ไม่สำเร็จ");
    expect(screen.queryByRole("textbox", { name: /ความบริสุทธิ์/ })).toBeNull();
    prefillMock.mockResolvedValueOnce(prefill());
    await userEvent.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
    await waitFor(() => expect(purityBox().value).toBe("92.50"));
  });

  it("เพิ่มรายการ: ส่ง 'ค่าทั้งสามชัดเจน' — metal/purity(0.925)/weight(3.2 source product) · สำเร็จ → toast + onAdded + ฟอร์มล้าง", async () => {
    prefillMock.mockResolvedValue(prefill());
    setItem.mockResolvedValue({ ok: true, data: { id: "i-1", productId: P1, sku: "SV-0001", name: "แหวนเงิน", pendingProductLabel: null, qtyPlanned: 10, isNewDesign: false, metal: "silver", purity: 0.925, weightG: 3.2, weightSource: "product" } });
    const { onAdded } = renderForm();
    await pickSku();
    await waitFor(() => expect(purityBox()).toBeInTheDocument());
    await userEvent.clear(qtyBox());
    await userEvent.type(qtyBox(), "10");
    await userEvent.click(addBtn());
    await waitFor(() => expect(setItem).toHaveBeenCalled());
    expect(setItem.mock.calls[0][0]).toEqual({ productionOrderId: "po-1", productId: P1, qtyPlanned: 10, metal: "silver", purity: 0.925, weightG: 3.2, weightSource: "product" });
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(await screen.findByText("เพิ่ม SV-0001 จำนวน 10 ชิ้นแล้ว")).toBeInTheDocument();
    expect(skuBox().value).toBe("");
    expect(screen.queryByRole("textbox", { name: /ความบริสุทธิ์/ })).toBeNull();
  });

  it("เลือกทอง: เนื้อว่าง *บังคับกรอก · ไม่กรอก → ไม่ยิง server + focus ช่องเนื้อ · กรอก 90 → ส่ง gold/0.9 (น้ำหนักจาก SKU ถูกล้าง ไม่ส่ง)", async () => {
    prefillMock.mockResolvedValue(prefill());
    setItem.mockResolvedValue({ ok: true, data: { id: "i-1", productId: P1, sku: "SV-0001", name: "x", pendingProductLabel: null, qtyPlanned: 1, isNewDesign: false, metal: "gold", purity: 0.9, weightG: null, weightSource: null } });
    renderForm();
    await pickSku();
    await waitFor(() => expect(purityBox()).toBeInTheDocument());
    await userEvent.click(screen.getByRole("radio", { name: "ทอง" }));
    expect(purityBox().value).toBe("");
    expect(weightBox().value).toBe("");
    expect(screen.getByText("*บังคับกรอก")).toBeInTheDocument();
    await userEvent.click(addBtn());
    expect(setItem).not.toHaveBeenCalled();
    await waitFor(() => expect(purityBox()).toHaveFocus());
    expect(screen.getByText("ทองต้องกรอกเนื้อทอง (%) — ขั้นต่ำ 37.50%")).toBeInTheDocument();
    await userEvent.type(purityBox(), "90");
    await userEvent.click(addBtn());
    await waitFor(() => expect(setItem).toHaveBeenCalled());
    expect(setItem.mock.calls[0][0]).toEqual({ productionOrderId: "po-1", productId: P1, qtyPlanned: 1, metal: "gold", purity: 0.9 });
  });

  it("SKU ระบุโลหะชัด (metalKnown) แล้วเลือกต่าง → เตือน (role=note) · ไม่บล็อกการเพิ่ม", async () => {
    prefillMock.mockResolvedValue(prefill({ metalKnown: true }));
    renderForm();
    await pickSku();
    await waitFor(() => expect(purityBox()).toBeInTheDocument());
    expect(screen.queryByRole("note")).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "ทองเหลือง" }));
    expect(screen.getByRole("note")).toHaveTextContent("สินค้านี้ระบุเป็น เงิน แต่รายการนี้เป็น ทองเหลือง");
    expect(addBtn()).toBeEnabled();
  });

  it("SKU ที่อยู่ในใบแล้ว → ข้อความบล็อกตาม spec + ปุ่มเพิ่มปิด (กัน upsert ทับค่าโลหะของการ์ดเดิมเงียบๆ)", async () => {
    prefillMock.mockResolvedValue(prefill());
    renderForm({ existingProductIds: [P1] });
    await pickSku();
    expect(await screen.findByText("SKU นี้มีอยู่ในใบผลิตนี้แล้ว — แก้จำนวนที่การ์ดเดิมแทน")).toBeInTheDocument();
    await waitFor(() => expect(addBtn()).toBeDisabled());
  });

  it("server ปฏิเสธ → error role=alert ตัดชื่อฟังก์ชัน · ค่าที่กรอกคงอยู่ · ฟอร์มไม่ล้าง", async () => {
    prefillMock.mockResolvedValue(prefill());
    setItem.mockResolvedValue({ ok: false, error: "production_order_item_set: SKU SV-0001 ปิดใช้งานแล้ว ใส่ในใบผลิตไม่ได้" });
    const { onAdded } = renderForm();
    await pickSku();
    await waitFor(() => expect(purityBox()).toBeInTheDocument());
    await userEvent.clear(qtyBox());
    await userEvent.type(qtyBox(), "7");
    await userEvent.click(addBtn());
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((a) => a.textContent === "SKU SV-0001 ปิดใช้งานแล้ว ใส่ในใบผลิตไม่ได้")).toBe(true);
    expect(qtyBox().value).toBe("7");
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("โหมด spec: มีช่อง 'แบบใหม่' · ติ๊กแล้วส่ง isNewDesign=true · ไม่ติ๊กไม่ส่ง false", async () => {
    prefillMock.mockResolvedValue(prefill({ productId: P2, sku: "SP-0002", costType: "spec" }));
    setItem.mockResolvedValue({ ok: true, data: { id: "i-2", productId: P2, sku: "SP-0002", name: "x", pendingProductLabel: null, qtyPlanned: 1, isNewDesign: true, metal: "silver", purity: 0.925, weightG: 3.2, weightSource: "product" } });
    renderForm();
    await pickSku("SP-0002 · ต่างหูสเปค");
    await waitFor(() => expect(purityBox()).toBeInTheDocument());
    await userEvent.click(screen.getByRole("checkbox", { name: /แบบใหม่/ }));
    await userEvent.click(addBtn());
    await waitFor(() => expect(setItem).toHaveBeenCalled());
    expect(setItem.mock.calls[0][0]).toMatchObject({ productId: P2, isNewDesign: true });
  });

  it("empty: ไม่มี SKU ให้เลือก → ข้อความเดิม + ชี้ทางเลือก 'ไม่มี SKU' · ช่องค้นปิด", () => {
    renderForm({ skuOptions: [] });
    expect(screen.getByText(/ยังไม่มี SKU ที่เลือกได้/)).toBeInTheDocument();
    expect(skuBox()).toBeDisabled();
  });
  it("error โหลดรายการ SKU: แสดง alert และปิดช่องค้น", () => {
    renderForm({ skuOptions: [], skuOptionsError: "โหลดรายการ SKU ไม่สำเร็จ ลองใหม่อีกครั้ง" });
    expect(screen.getByRole("alert")).toHaveTextContent("โหลดรายการ SKU ไม่สำเร็จ");
    expect(skuBox()).toBeDisabled();
  });
});

describe("โหมด 'ไม่มี SKU — ใส่ชื่อแบบ'", () => {
  async function toNoSku() {
    await userEvent.click(screen.getByRole("radio", { name: "ไม่มี SKU — ใส่ชื่อแบบ" }));
  }

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

describe("a11y", () => {
  it("segmented เป็น radiogroup มีชื่อ · ช่องทุกช่องมี label (เข้าถึงด้วยชื่อได้)", () => {
    renderForm();
    expect(screen.getByRole("radiogroup", { name: "รูปแบบรายการ" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "มี SKU" })).toBeChecked();
  });
});
