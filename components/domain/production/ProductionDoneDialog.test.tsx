// @vitest-environment jsdom
// ProductionDoneDialog — ราคาโลหะต่อโลหะ + read-back + เช็คลิสต์ + ปุ่ม aria-disabled (PM-B · UX A.7)
//  ราคาทอง/ทองเหลือง: โชว์ค่าที่ server คืน (preview.metalPrices) เท่านั้น · ทองเหลือง server เก็บบาท/กรัม → แสดงเป็นบาท/กก. ด้วยการเลื่อนจุดทศนิยม (ไม่คำนวณราคาใหม่ฝั่ง client)
//  ต้องถูก: ไม่มีราคาทอง = กล่องแดง + เปิดหน้าราคาโลหะแท็บใหม่ + ตรวจอีกครั้ง + ปุ่มยืนยัน aria-disabled พร้อมเหตุผล · done ส่ง expectedMetalPrices = อ็อบเจกต์เดียวกับ preview
//  ต้องไม่พัง: ใบเงินล้วนยังโชว์ "ราคาเงินที่จะใช้ในใบนี้" เดิม
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import type { ProductionOrderItemRow, ProductionOrderPreview, ProductionOrderPreviewItem, ProductionOrderRow } from "@/lib/production/types";

const previewMock = vi.fn();
const doneMock = vi.fn();
vi.mock("@/lib/actions/production", () => ({
  previewProductionOrder: (...args: unknown[]) => previewMock(...args),
  doneProductionOrder: (...args: unknown[]) => doneMock(...args),
}));
const toastPush = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ push: toastPush }) }));

import { ProductionDoneDialog } from "./ProductionDoneDialog";

afterEach(cleanup);
beforeEach(() => {
  previewMock.mockReset();
  doneMock.mockReset();
  toastPush.mockReset();
});

const order = { id: "po-1", poNo: "PO-TEST-1" } as unknown as ProductionOrderRow;
const items = [
  { id: "i-1", productId: "p-1", sku: "SKU-1", productName: "ทดสอบ", qtyPlanned: 2, makeSpec: null, effectiveMetal: "silver", effectivePurity: 0.925, effectiveWeightG: 3.2 },
] as unknown as ProductionOrderItemRow[];

function previewItem(over: Partial<ProductionOrderPreviewItem> = {}): ProductionOrderPreviewItem {
  return {
    itemId: "i-1", productId: "p-1", sku: "SKU-1", costType: "spot", silverWeightG: 3.2, silverPurity: 0.925, laborCost: 0, spotPriceThbPerGram: 36.5,
    prevCostType: "fixed", prevUnitCost: 100, unitCost: 110, qtyPlanned: 2, qtyUsed: 2, isNewDesign: false, costCalc: null, skipped: false, priceMissing: false,
    metal: "silver", purity: 0.925, weightG: 3.2, weightSource: "product", ...over,
  };
}

function previewWith(over: Partial<ProductionOrderPreview>): { ok: true; data: ProductionOrderPreview } {
  return {
    ok: true,
    data: { productionOrderId: "po-1", poNo: "PO-TEST-1", spotPriceThbPerGram: null, metalPrices: {}, missingPrices: [], items: [], ...over },
  };
}

async function renderWith(over: Partial<ProductionOrderPreview>, its = items) {
  previewMock.mockResolvedValue(previewWith(over));
  render(<ProductionDoneDialog order={order} items={its} onClose={() => {}} onDone={() => {}} />);
  await waitFor(() => expect(previewMock).toHaveBeenCalled());
}

const confirmBtn = () => screen.getByRole("button", { name: /ยืนยันผลิตเสร็จ/ });

describe("ProductionDoneDialog — ราคาโลหะที่จะใช้", () => {
  it("ทอง: แสดง 'ราคาทองที่จะใช้: X บาท/กรัม (ทอง 100%)' จากค่า server", async () => {
    await renderWith({ metalPrices: { gold: 2804.1271 } });
    const el = await screen.findByTestId("done-gold-price");
    expect(el).toHaveTextContent("ราคาทองที่จะใช้: 2,804.1271 บาท/กรัม (ทอง 100%)");
    expect(screen.queryByTestId("done-brass-price")).toBeNull();
    expect(screen.getByRole("heading", { name: /ราคาโลหะที่จะใช้ \(ของวันนี้/ })).toBeInTheDocument();
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

  it("ใบ fixed ล้วน: บอกว่าไม่ใช้ราคาโลหะ (ไม่โชว์ราคาที่ไม่มี)", async () => {
    await renderWith({ metalPrices: {}, items: [previewItem({ costType: "fixed", unitCost: 100, spotPriceThbPerGram: null })] });
    expect(await screen.findByText(/ทุกรายการในใบนี้เป็นต้นทุนคงที่ — ไม่ใช้ราคาโลหะ/)).toBeInTheDocument();
  });
});

describe("ไม่มีราคาทองของวันนี้ (R3 missing_prices)", () => {
  it("กล่องแดง role=alert + ลิงก์ /oem/rates แท็บใหม่ (noopener) + ตรวจอีกครั้ง · ไม่แสดงบรรทัดราคาทอง (ไม่แต่งค่า)", async () => {
    await renderWith({ metalPrices: {}, missingPrices: ["gold"] });
    const box = await screen.findByTestId("done-missing-price");
    expect(box).toHaveAttribute("role", "alert");
    expect(box).toHaveTextContent(/ยังไม่มีราคาทองของวันนี้ .* ต้องกรอกราคาทองของวันนี้ก่อน ไม่มีราคาเฉพาะใบ/);
    const link = screen.getByRole("link", { name: "เปิดหน้าราคาโลหะ (แท็บใหม่)" });
    expect(link).toHaveAttribute("href", "/oem/rates");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.queryByTestId("done-gold-price")).toBeNull();
  });

  it("ปุ่มยืนยัน aria-disabled (ไม่ใช่ disabled) + เหตุผลผ่าน aria-describedby · กดแล้วไม่เรียก done", async () => {
    await renderWith({ metalPrices: {}, missingPrices: ["gold"] });
    await screen.findByTestId("done-missing-price");
    const btn = confirmBtn();
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn).not.toBeDisabled();
    const reason = document.getElementById(btn.getAttribute("aria-describedby") ?? "");
    expect(reason).toHaveTextContent("ผลิตเสร็จ — ยังไม่มีราคาทอง");
    await userEvent.click(btn);
    expect(doneMock).not.toHaveBeenCalled();
  });

  it("'ตรวจอีกครั้ง' ยิง preview ใหม่ → ถ้าราคาเข้าแล้วกล่องแดงหายและกดยืนยันได้", async () => {
    await renderWith({ metalPrices: {}, missingPrices: ["gold"] });
    await screen.findByTestId("done-missing-price");
    previewMock.mockResolvedValue(previewWith({ metalPrices: { gold: 2000 }, missingPrices: [] }));
    await userEvent.click(screen.getByRole("button", { name: "ตรวจอีกครั้ง" }));
    await screen.findByTestId("done-gold-price");
    expect(screen.queryByTestId("done-missing-price")).toBeNull();
    await waitFor(() => expect(confirmBtn()).not.toHaveAttribute("aria-disabled"));
    expect(previewMock).toHaveBeenCalledTimes(2);
  });
});

describe("read-back + ส่งราคาอ้างอิงเดียวกับที่เห็น", () => {
  it("รายการแสดง 'โลหะ · เนื้อ · น้ำหนัก × จำนวน' จากค่า preview (ที่จะถูกล็อก) + ป้ายโลหะ", async () => {
    await renderWith({
      spotPriceThbPerGram: null,
      metalPrices: { gold: 2804.1271 },
      items: [previewItem({ metal: "gold", purity: 0.965, weightG: 3.2, costType: "spot", spotPriceThbPerGram: null })],
    });
    const rb = await screen.findByTestId("done-readback-p-1");
    expect(rb).toHaveTextContent("ทอง · เนื้อ 96.50% · น้ำหนัก 3.200 g/ชิ้น × 2");
  });

  it("น้ำหนักว่าง → 'ไม่ได้ระบุน้ำหนัก' (ไม่ใช่ 0)", async () => {
    await renderWith({ items: [previewItem({ weightG: null, costType: "fixed", unitCost: 100 })] });
    const rb = await screen.findByTestId("done-readback-p-1");
    expect(rb).toHaveTextContent("ไม่ได้ระบุน้ำหนัก");
  });

  it("กดยืนยัน: done ได้ expectedMetalPrices = อ็อบเจกต์เดียวกับ preview.metalPrices · สำเร็จ → toast + onDone", async () => {
    previewMock.mockResolvedValue(previewWith({ metalPrices: { silver: 36.5, gold: 2804.1271 }, spotPriceThbPerGram: 36.5, items: [previewItem()] }));
    doneMock.mockResolvedValue({ ok: true, data: { productionOrderId: "po-1", poNo: "PO-TEST-1", status: "done", alreadyDone: false, metalPrices: {}, items: [] } });
    const onDone = vi.fn();
    render(<ProductionDoneDialog order={order} items={items} onClose={() => {}} onDone={onDone} />);
    await screen.findByTestId("done-gold-price");
    await waitFor(() => expect(confirmBtn()).not.toHaveAttribute("aria-disabled"));
    await userEvent.click(confirmBtn());
    await waitFor(() => expect(doneMock).toHaveBeenCalled());
    expect(doneMock.mock.calls[0][0]).toEqual({ productionOrderId: "po-1", items: [{ productId: "p-1", qtyDone: 2 }], expectedMetalPrices: { silver: 36.5, gold: 2804.1271 } });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(toastPush).toHaveBeenCalledWith(expect.stringContaining("บันทึกผลิตเสร็จ PO-TEST-1 แล้ว"));
  });

  it("ราคาเปลี่ยนระหว่างเปิด dialog (DB fail-closed) → ข้อความ spec + ตรวจอีกครั้ง · ปุ่มยืนยัน aria-disabled จนกว่าจะตรวจ", async () => {
    previewMock.mockResolvedValue(previewWith({ metalPrices: { gold: 2804.1271 }, items: [previewItem({ metal: "gold" })] }));
    doneMock.mockResolvedValue({ ok: false, error: "production_order_done: ราคาทองเปลี่ยนไประหว่างที่เปิดหน้าต่างนี้ค้างไว้ (ตอนเปิดหน้าต่างเห็นราคา 2804.1271 บาท/กรัม แต่ตอนนี้ระบบคำนวณได้ 2900 บาท/กรัม)" });
    render(<ProductionDoneDialog order={order} items={items} onClose={() => {}} onDone={() => {}} />);
    await screen.findByTestId("done-gold-price");
    await waitFor(() => expect(confirmBtn()).not.toHaveAttribute("aria-disabled"));
    await userEvent.click(confirmBtn());
    expect(await screen.findByText("ราคาโลหะเปลี่ยนระหว่างที่เปิดหน้านี้ — ตรวจราคาใหม่แล้วยืนยันอีกครั้ง")).toBeInTheDocument();
    expect(confirmBtn()).toHaveAttribute("aria-disabled", "true");
    previewMock.mockResolvedValue(previewWith({ metalPrices: { gold: 2900 }, items: [previewItem({ metal: "gold" })] }));
    await userEvent.click(screen.getByRole("button", { name: "ตรวจอีกครั้ง" }));
    await waitFor(() => expect(screen.getByTestId("done-gold-price")).toHaveTextContent("2,900.00"));
    await waitFor(() => expect(confirmBtn()).not.toHaveAttribute("aria-disabled"));
  });

  it("done ล้มเหลวอย่างอื่น → แสดงข้อความ server ใน role=alert ค่าคงอยู่", async () => {
    previewMock.mockResolvedValue(previewWith({ metalPrices: {}, items: [previewItem({ costType: "fixed", spotPriceThbPerGram: null })] }));
    doneMock.mockResolvedValue({ ok: false, error: "บันทึกผลิตเสร็จไม่สำเร็จ ลองใหม่อีกครั้ง" });
    render(<ProductionDoneDialog order={order} items={items} onClose={() => {}} onDone={() => {}} />);
    await waitFor(() => expect(confirmBtn()).not.toHaveAttribute("aria-disabled"));
    await userEvent.click(confirmBtn());
    expect(await screen.findByText("บันทึกผลิตเสร็จไม่สำเร็จ ลองใหม่อีกครั้ง")).toBeInTheDocument();
    expect(toastPush).toHaveBeenCalledWith("บันทึกผลิตเสร็จไม่สำเร็จ ลองใหม่อีกครั้ง", "error");
  });
});

describe("4 state ของ dialog", () => {
  it("loading: ระหว่างรอ preview แสดง status 'กำลังคำนวณต้นทุนตัวอย่าง' และปุ่มยืนยัน aria-disabled 'กำลังคิดต้นทุน…'", async () => {
    previewMock.mockReturnValue(new Promise(() => {}));
    render(<ProductionDoneDialog order={order} items={items} onClose={() => {}} onDone={() => {}} />);
    expect(await screen.findByRole("status")).toHaveTextContent("กำลังคำนวณต้นทุนตัวอย่าง");
    expect(confirmBtn()).toHaveAttribute("aria-disabled", "true");
  });

  it("error: preview ล้มเหลว → alert + ตรวจอีกครั้ง/ปิดและไปแก้ที่การ์ด · ปุ่มยืนยัน aria-disabled", async () => {
    previewMock.mockResolvedValueOnce({ ok: false, error: "production_cost_calc: SKU SKU-1 ยังไม่ระบุน้ำหนัก/ชิ้นของรายการนี้" });
    render(<ProductionDoneDialog order={order} items={items} onClose={() => {}} onDone={() => {}} />);
    expect(await screen.findByText(/ยังไม่ระบุน้ำหนัก\/ชิ้นของรายการนี้/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ปิดและไปแก้ที่การ์ด" })).toBeInTheDocument();
    expect(confirmBtn()).toHaveAttribute("aria-disabled", "true");
    previewMock.mockResolvedValueOnce(previewWith({ items: [previewItem({ costType: "fixed", spotPriceThbPerGram: null })] }));
    await userEvent.click(screen.getByRole("button", { name: "ตรวจอีกครั้ง" }));
    await waitFor(() => expect(confirmBtn()).not.toHaveAttribute("aria-disabled"));
  });

  it("ทุกรายการ 0 ชิ้น: เตือน + ปุ่ม aria-disabled", async () => {
    await renderWith({ items: [previewItem({ qtyUsed: 0, skipped: true, unitCost: null })] });
    const input = await screen.findByRole("spinbutton", { name: /จำนวนที่ผลิตได้จริง SKU-1/ });
    await userEvent.clear(input);
    await userEvent.type(input, "0");
    await waitFor(() => expect(screen.getByText(/ทุกรายการเป็น 0 ชิ้น — ถ้าไม่ได้ผลิตจริงเลย/)).toBeInTheDocument());
    expect(confirmBtn()).toHaveAttribute("aria-disabled", "true");
  });

  it("มีรายการไม่มี SKU (กันซ้ำจากหน้าใบผลิต): เตือนแดง + ปุ่ม aria-disabled + รายการนั้นไม่เข้า payload preview", async () => {
    const mixed = [
      ...items,
      { id: "i-2", productId: null, sku: null, productName: null, pendingProductLabel: "แบบ X", qtyPlanned: 1, makeSpec: null },
    ] as unknown as ProductionOrderItemRow[];
    await renderWith({ items: [previewItem()] }, mixed);
    expect(await screen.findByText(/ใบนี้มี 1 รายการที่ยังไม่ผูก SKU/)).toBeInTheDocument();
    expect(confirmBtn()).toHaveAttribute("aria-disabled", "true");
    expect(previewMock.mock.calls[0][1]).toEqual([{ productId: "p-1", qtyDone: 2 }]);
  });
});
