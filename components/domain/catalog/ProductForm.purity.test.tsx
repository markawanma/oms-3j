// @vitest-environment jsdom
// ProductForm — ช่อง "ความบริสุทธิ์" เป็น % (18 ต.ค. 69): ค่าที่ส่งเข้า upsertProduct ยังเป็นสัดส่วน 0..1
//  ต้องไม่พัง: เปิด SKU เดิมที่มี 0.925 → ช่องแสดง 92.50 → กดบันทึกโดยไม่แก้ → silverPurity = 0.925 เป๊ะ · ค่าว่างยัง null ·
//             preview ต้นทุนเท่าเดิมก่อน/หลังแก้ (0.925 เดิม = 92.50 ใหม่) · ค่าเดิมที่ละเอียดเกิน 4 ตำแหน่งไม่ถูกปัดทับ
//  ต้องถูกปฏิเสธ: 0.925 (สัดส่วนเดิม) · 92.505 · 100.01 · abc — ไม่เรียก action + แสดง error
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

const upsertProduct = vi.fn();
vi.mock("@/lib/actions/catalog", () => ({
  upsertProduct: (...a: unknown[]) => upsertProduct(...a),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
// รูปสินค้าเป็นเรื่องอื่น (ต้องใช้ storage actions) — ไม่เกี่ยวกับ purity
vi.mock("./ProductImageSection", () => ({ ProductImageSection: () => null }));

import { ToastProvider } from "@/components/ui/Toast";
import type { ProductRow } from "@/lib/catalog/types";
import { OEM_ITEM_KIND_OPTIONS, OEM_POLISH_TIER_OPTIONS } from "@/lib/oem/display";
import { ProductForm } from "./ProductForm";

beforeEach(() => {
  vi.clearAllMocks();
  upsertProduct.mockResolvedValue({ ok: true, data: { productId: "p-1" } });
});

function row(over: Partial<ProductRow> = {}): ProductRow {
  return {
    productId: "p-1",
    sku: "TEST-SKU-1",
    name: "สินค้าทดสอบ",
    category: null,
    costType: "spot",
    manualUnitCost: null,
    silverWeightG: 10,
    silverPurity: 0.925,
    laborCost: null,
    listPrice: null,
    makeSpec: null,
    effectiveUnitCost: null,
    marginPct: null,
    barcode: null,
    supplier: null,
    note: null,
    isActive: true,
    primaryImageUrl: null,
    primaryImageSmUrl: null,
    ...over,
  };
}

function renderForm(initial?: ProductRow, silverSpot: number | null = 40) {
  render(
    <ToastProvider>
      <ProductForm initial={initial} silverSpot={silverSpot} onDone={vi.fn()} />
    </ToastProvider>
  );
}

const purityInput = () => screen.getByRole("textbox", { name: /ความบริสุทธิ์/ }) as HTMLInputElement;
const saveBtn = () => screen.getByRole("button", { name: "บันทึก" });
const sent = () => upsertProduct.mock.calls[0][0] as Record<string, unknown>;

describe("ProductForm — โหมดอิงราคาเงิน (spot)", () => {
  it("เปิดของเดิม 0.925 → ช่องแสดง 92.50 → บันทึกโดยไม่แก้ → silverPurity = 0.925 เป๊ะ", async () => {
    renderForm(row());
    expect(purityInput().value).toBe("92.50");
    fireEvent.click(saveBtn());
    await waitFor(() => expect(upsertProduct).toHaveBeenCalledTimes(1));
    expect(sent().silverPurity).toBe(0.925);
    expect(sent().silverWeightG).toBe(10);
  });

  it("preview ต้นทุนเท่าเดิม: 0.925 เดิม = 92.50 ใหม่ (10 ก. × 40 × 0.925 = ฿370.00)", () => {
    renderForm(row());
    expect(screen.getByText("฿370.00")).toBeInTheDocument();
    fireEvent.change(purityInput(), { target: { value: "92.50" } });
    expect(screen.getByText("฿370.00")).toBeInTheDocument();
    fireEvent.change(purityInput(), { target: { value: "99.9" } });
    expect(screen.getByText("฿399.60")).toBeInTheDocument();
  });

  it("ค่าเดิมใน DB ละเอียดเกิน 4 ตำแหน่ง (0.92575) → แสดง 92.58 → ไม่แตะ → ส่ง 0.92575 เดิม ไม่ถูกปัดทับ", async () => {
    renderForm(row({ silverPurity: 0.92575 }));
    expect(purityInput().value).toBe("92.58");
    fireEvent.click(saveBtn());
    await waitFor(() => expect(upsertProduct).toHaveBeenCalledTimes(1));
    expect(sent().silverPurity).toBe(0.92575);
  });

  it("แก้เป็น 96.50 → ส่ง 0.965 · แก้เป็น 99.99 → 0.9999", async () => {
    renderForm(row());
    fireEvent.change(purityInput(), { target: { value: "96.50" } });
    fireEvent.click(saveBtn());
    await waitFor(() => expect(upsertProduct).toHaveBeenCalledTimes(1));
    expect(sent().silverPurity).toBe(0.965);

    upsertProduct.mockClear();
    fireEvent.change(purityInput(), { target: { value: "99.99" } });
    fireEvent.click(saveBtn());
    await waitFor(() => expect(upsertProduct).toHaveBeenCalledTimes(1));
    expect(sent().silverPurity).toBe(0.9999);
  });

  it("เคลียร์ช่อง → silverPurity null เหมือนเดิม", async () => {
    renderForm(row());
    fireEvent.change(purityInput(), { target: { value: "" } });
    fireEvent.click(saveBtn());
    await waitFor(() => expect(upsertProduct).toHaveBeenCalledTimes(1));
    expect(sent().silverPurity).toBeNull();
  });

  it("SKU เดิมไม่มีความบริสุทธิ์ (null) → ช่องว่าง → บันทึกได้ → null", async () => {
    renderForm(row({ silverPurity: null }));
    expect(purityInput().value).toBe("");
    fireEvent.click(saveBtn());
    await waitFor(() => expect(upsertProduct).toHaveBeenCalledTimes(1));
    expect(sent().silverPurity).toBeNull();
  });

  it.each([
    ["0.925", "กรอกเป็น % เช่น 92.50"],
    ["92.505", "ทศนิยมไม่เกิน 2 ตำแหน่ง"],
    ["100.01", "ต้องไม่เกิน 100%"],
    ["abc", "กรอกเป็นตัวเลข %"],
  ])("พิมพ์ %s → ไม่เรียก upsertProduct · มี error · ค่าที่พิมพ์ไม่ถูกแก้", async (typed, message) => {
    renderForm(row());
    fireEvent.change(purityInput(), { target: { value: typed } });
    expect(purityInput().value).toBe(typed);
    expect(purityInput()).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(saveBtn());
    await waitFor(() => expect(screen.getAllByText(new RegExp(message.replace(/[.*+?^${}()|[\]\\%]/g, "\\$&"))).length).toBeGreaterThan(1));
    expect(upsertProduct).not.toHaveBeenCalled();
    // preview ไม่แอบตกไปใช้ default 0.925 ตอนค่าผิด
    expect(screen.queryByText("฿370.00")).toBeNull();
  });
});

describe("ProductForm — โหมดคำนวณจากสเปค (spec) และ SKU ใหม่", () => {
  it("spec: เปิดของเดิม 0.925 → 92.50 → บันทึกโดยไม่แก้ → 0.925 เป๊ะ", async () => {
    renderForm(
      row({
        costType: "spec",
        makeSpec: { metal: "silver", itemKind: OEM_ITEM_KIND_OPTIONS[0], polishTier: OEM_POLISH_TIER_OPTIONS[0], platingType: null, gemTier: null, gemCount: 0 },
      })
    );
    expect(purityInput().value).toBe("92.50");
    fireEvent.click(saveBtn());
    await waitFor(() => expect(upsertProduct).toHaveBeenCalledTimes(1));
    expect(sent().costType).toBe("spec");
    expect(sent().silverPurity).toBe(0.925);
  });

  it("โหมด fixed (ช่องซ่อน): SKU เดิมมี 0.925 ติดอยู่ → บันทึกแล้วยังเป็น 0.925 ไม่หาย ไม่เพี้ยน", async () => {
    renderForm(row({ costType: "fixed", manualUnitCost: 100, silverWeightG: null }));
    expect(screen.queryByRole("textbox", { name: /ความบริสุทธิ์/ })).toBeNull();
    fireEvent.click(saveBtn());
    await waitFor(() => expect(upsertProduct).toHaveBeenCalledTimes(1));
    expect(sent().silverPurity).toBe(0.925);
  });

  it("SKU ใหม่ (spot): พิมพ์ 92.5 → ส่ง 0.925", async () => {
    renderForm(undefined);
    fireEvent.change(screen.getByRole("textbox", { name: "SKU" }), { target: { value: "NEW-1" } });
    fireEvent.change(screen.getByRole("textbox", { name: "ชื่อสินค้า" }), { target: { value: "ของใหม่" } });
    fireEvent.click(screen.getByRole("radio", { name: /คำนวณจากน้ำหนักเงิน/ }));
    expect(purityInput().value).toBe("");
    fireEvent.change(screen.getByLabelText("น้ำหนักเงิน (ก.)"), { target: { value: "5" } });
    fireEvent.change(purityInput(), { target: { value: "92.5" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่ม SKU" }));
    await waitFor(() => expect(upsertProduct).toHaveBeenCalledTimes(1));
    expect(sent().silverPurity).toBe(0.925);
    expect(sent().costType).toBe("spot");
  });
});
