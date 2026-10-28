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

  it("server ปฏิเสธ → error role=alert แสดงข้อความที่ action ส่งมา · ค่าที่กรอกคงอยู่ · ฟอร์มไม่ล้าง", async () => {
    prefillMock.mockResolvedValue(prefill());
    setItem.mockResolvedValue({ ok: false, error: "SKU SV-0001 ปิดใช้งานแล้ว ใส่ในใบผลิตไม่ได้" });
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

  it("empty: ไม่มี SKU ให้เลือก → ข้อความเดิม · ช่องค้นปิด", () => {
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

// W1 UI (21 ต.ค.): เปิด flag ALLOW_UNBOUND_ITEM_OFFICE = true แล้ว — การ์ดรายการไม่มี SKU มีปุ่มผูก SKU/แก้ชื่อแบบ จึงไม่ใช่ทางตัน
// (พฤติกรรมโหมด "ไม่มี SKU — ใส่ชื่อแบบ" แบบละเอียดอยู่ใน ProductionAddItemForm.unbound.test.tsx)
describe("flag ALLOW_UNBOUND_ITEM_OFFICE = true (ค่าปัจจุบัน)", () => {
  it("มี segmented 'รูปแบบรายการ' + ตัวเลือก 'ไม่มี SKU — ใส่ชื่อแบบ' · โหมดเริ่มต้นยังเป็นมี SKU (ช่องค้น SKU อยู่)", () => {
    renderForm();
    expect(screen.getByRole("radiogroup", { name: "รูปแบบรายการ" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /ไม่มี SKU/ })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(skuBox()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /สินค้าใหม่/ })).toBeInTheDocument();
  });
  it("ไม่มี SKU ให้เลือก → ข้อความ empty ชี้ไปทางเลือก 'ไม่มี SKU — ใส่ชื่อแบบ'", () => {
    renderForm({ skuOptions: [] });
    expect(screen.getByText(/ยังไม่มี SKU ที่เลือกได้/)).toBeInTheDocument();
    expect(screen.getByText(/ยังไม่มี SKU ที่เลือกได้/).textContent).toMatch(/ไม่มี SKU — ใส่ชื่อแบบ/);
  });
});

describe("ป้าย 'จาก SKU / แก้ในใบนี้' ในการ์ดร่าง (ฟังก์ชันเดียวกับการ์ดรายการ)", () => {
  it("prefill = ค่า SKU → 'จาก SKU' · แก้เนื้อแล้วป้ายเนื้อหาย (เป็น 'แก้ในใบนี้') · แก้น้ำหนักแล้วป้ายน้ำหนักเปลี่ยนตาม", async () => {
    prefillMock.mockResolvedValue(prefill());
    renderForm();
    await pickSku();
    await waitFor(() => expect(purityBox().value).toBe("92.50"));
    expect(screen.getAllByText("จาก SKU", { selector: "span" })).toHaveLength(2);
    await userEvent.clear(purityBox());
    await userEvent.type(purityBox(), "90");
    expect(screen.getAllByText("จาก SKU", { selector: "span" })).toHaveLength(1);
    await userEvent.clear(weightBox());
    await userEvent.type(weightBox(), "4.5");
    expect(screen.queryByText("จาก SKU", { selector: "span" })).toBeNull();
    expect(screen.getAllByText("แก้ในใบนี้", { selector: "span" })).toHaveLength(2);
  });
});

describe("เนื้อเงินว่าง = ใช้ 92.50 + ข้อความใต้ช่อง + loading", () => {
  it("เงินล้างช่องเนื้อแล้วเพิ่ม → ไม่ error · ส่ง purity 0.925 ชัดเจน · ข้อความ 'ว่าง = 92.50' และน้ำหนัก 'ว่าง = ใช้น้ำหนักจาก SKU' แสดงอยู่", async () => {
    prefillMock.mockResolvedValue(prefill({ weightG: null, weightSource: null }));
    setItem.mockResolvedValue({ ok: true, data: { id: "i-1", productId: P1, sku: "SV-0001", name: "x", pendingProductLabel: null, qtyPlanned: 1, isNewDesign: false, metal: "silver", purity: 0.925, weightG: null, weightSource: null } });
    renderForm();
    await pickSku();
    await waitFor(() => expect(purityBox()).toBeInTheDocument());
    expect(screen.getByText(/ว่าง = 92.50/)).toBeInTheDocument();
    expect(screen.getByText(/ว่าง = ใช้น้ำหนักจาก SKU/)).toBeInTheDocument();
    await userEvent.clear(purityBox());
    await userEvent.click(addBtn());
    await waitFor(() => expect(setItem).toHaveBeenCalled());
    expect(setItem.mock.calls[0][0]).toEqual({ productionOrderId: "po-1", productId: P1, qtyPlanned: 1, metal: "silver", purity: 0.925 });
  });

  it("loading: ระหว่างเพิ่ม ช่องเนื้อ/น้ำหนัก/จำนวน disabled ทั้งสามช่อง · ปุ่มเพิ่ม disabled", async () => {
    prefillMock.mockResolvedValue(prefill());
    let resolve!: (v: unknown) => void;
    setItem.mockReturnValue(new Promise((r) => (resolve = r)));
    renderForm();
    await pickSku();
    await waitFor(() => expect(purityBox()).toBeInTheDocument());
    await userEvent.click(addBtn());
    await waitFor(() => expect(qtyBox()).toBeDisabled());
    expect(purityBox()).toBeDisabled();
    expect(weightBox()).toBeDisabled();
    expect(addBtn()).toBeDisabled();
    resolve({ ok: false, error: "x" });
    await waitFor(() => expect(purityBox()).toBeEnabled());
    expect(weightBox()).toBeEnabled();
  });
});

