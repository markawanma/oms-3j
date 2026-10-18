// @vitest-environment jsdom
// ช่อง "ความบริสุทธิ์" ในฟอร์ม OEM กรอกเป็น % (18 ต.ค. 69) — จุดที่ตรวจ: ค่าที่ส่งเข้า server action (calcPrice) ยังเป็นสัดส่วน 0..1
//  ต้องไม่พัง: ค่าเริ่มต้นเงิน (ไม่แตะช่อง) แสดง "92.50" และ action ได้ 0.925 เป๊ะ · ทองกรอก 96.5 → 0.965 · เคลียร์ช่อง → null
//  ต้องถูกปฏิเสธ: "0.925" (พิมพ์เป็นสัดส่วนเดิม) · "92.505" · "100.01" — ไม่ยิง calc + แสดง error + ไม่แก้ค่าที่พิมพ์เงียบๆ
// (saveQuote ใช้ payload จาก buildJobInput ตัวเดียวกับ calcPrice — ดู buildPayloadItems — ไม่มีทางแปลงหน่วยแยกอีกจุด)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

const calcPrice = vi.fn();
const saveQuote = vi.fn();
vi.mock("@/lib/actions/oem", () => ({
  calcPrice: (...a: unknown[]) => calcPrice(...a),
  saveQuote: (...a: unknown[]) => saveQuote(...a),
  getOemProducts: () => Promise.resolve({ ok: true, data: [] }),
}));
vi.mock("@/lib/actions/catalog-sku", () => ({
  listSkuPrefixes: () => Promise.resolve({ ok: true, data: [] }),
  createCatalogSku: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { ToastProvider } from "@/components/ui/Toast";
import { OEM_ITEM_KIND_OPTIONS, OEM_POLISH_TIER_OPTIONS } from "@/lib/oem/display";
import type { OemSettingData } from "@/lib/oem/types";
import { QuoteCalculatorClient } from "./QuoteCalculatorClient";

const setting: OemSettingData = {
  marginTargetPct: 0.3,
  marginDiscountCapPct: 0.1,
  marginFloorPct: 0.2,
  marginHardFloorPct: 0.1,
  nreMaxSharePct: 0.3,
  minJobValueThb: 0,
  quoteValidDaysSilver: 7,
  quoteValidDaysGold: 3,
  quoteValidDaysBrass: 7,
  barMarginPct: 0.2,
  formulaVersion: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  // ไม่สร้างผลคำนวณปลอม — แค่ให้ action ตอบ error สั้นๆ เพราะเทสนี้ดูเฉพาะ "ค่าที่ส่งเข้า"
  calcPrice.mockResolvedValue({ ok: false, error: "mock-calc" });
});

const purityInput = () => screen.getByRole("textbox", { name: /ความบริสุทธิ์/ }) as HTMLInputElement;
const lastCalcInput = () => calcPrice.mock.calls[calcPrice.mock.calls.length - 1][0] as Record<string, unknown>;

function renderForm() {
  render(
    <ToastProvider>
      <QuoteCalculatorClient setting={setting} />
    </ToastProvider>
  );
}

/** กรอกช่องอื่นให้ buildJobInput ผ่าน เหลือเฉพาะ purity เป็นตัวแปรของเทส */
function fillRestOfJob() {
  fireEvent.change(screen.getByLabelText("ประเภทชิ้นงาน"), { target: { value: OEM_ITEM_KIND_OPTIONS[0] } });
  fireEvent.change(screen.getByLabelText("ระดับความยากขัด"), { target: { value: OEM_POLISH_TIER_OPTIONS[0] } });
  fireEvent.change(screen.getByLabelText("น้ำหนัก/ชิ้น (กรัม)"), { target: { value: "3.5" } });
  fireEvent.change(screen.getByLabelText("จำนวน (ชิ้น)"), { target: { value: "50" } });
}

async function settle() {
  await waitFor(() => expect(calcPrice).toHaveBeenCalled(), { timeout: 3000 });
}

/** รอให้เกิน debounce 300ms แล้วยืนยันว่าไม่มีการยิง calc */
async function expectNoCalc() {
  await new Promise((r) => setTimeout(r, 700));
  expect(calcPrice).not.toHaveBeenCalled();
}

describe("OEM quote form — ช่องความบริสุทธิ์เป็น %", () => {
  it("ค่าเริ่มต้นเงินเติมเป็น 92.50 + หน่วย % + inputMode decimal", () => {
    renderForm();
    expect(purityInput().value).toBe("92.50");
    expect(purityInput()).toHaveAttribute("inputmode", "decimal");
    expect(screen.getAllByText("%").length).toBeGreaterThan(0);
  });

  it("ไม่แตะช่อง → action ได้ purity = 0.925 เป๊ะ (ไม่ใช่ 92.5 ไม่ใช่ 0.00925)", async () => {
    renderForm();
    fillRestOfJob();
    await settle();
    const input = lastCalcInput();
    expect(input.purity).toBe(0.925);
    expect(input.metal).toBe("silver");
  });

  it("แก้เป็น 99.99 → 0.9999 · ทศนิยม 1 ตำแหน่ง 96.5 → 0.965", async () => {
    renderForm();
    fillRestOfJob();
    await settle();
    calcPrice.mockClear();
    fireEvent.change(purityInput(), { target: { value: "99.99" } });
    await waitFor(() => expect(calcPrice).toHaveBeenCalled(), { timeout: 3000 });
    expect(lastCalcInput().purity).toBe(0.9999);
    calcPrice.mockClear();
    fireEvent.change(purityInput(), { target: { value: "96.5" } });
    await waitFor(() => expect(calcPrice).toHaveBeenCalled(), { timeout: 3000 });
    expect(lastCalcInput().purity).toBe(0.965);
  });

  it("ทอง: ช่องว่าง + placeholder 96.50 · กรอก 96.5 → 0.965", async () => {
    renderForm();
    fillRestOfJob();
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "gold" } });
    expect(purityInput().value).toBe("");
    expect(purityInput()).toHaveAttribute("placeholder", "เช่น 96.50");
    await expectNoCalc(); // ทองต้องกรอก — ว่างอยู่ = ไม่ยิง calc (เหมือนเดิม)
    fireEvent.change(purityInput(), { target: { value: "96.5" } });
    await settle();
    expect(lastCalcInput().purity).toBe(0.965);
    expect(lastCalcInput().metal).toBe("gold");
  });

  it("เงินเคลียร์ช่อง → purity null เหมือนเดิม", async () => {
    renderForm();
    fillRestOfJob();
    await settle();
    calcPrice.mockClear();
    fireEvent.change(purityInput(), { target: { value: "" } });
    await waitFor(() => expect(calcPrice).toHaveBeenCalled(), { timeout: 3000 });
    expect(lastCalcInput().purity).toBeNull();
  });

  it.each([
    ["0.925", "กรอกเป็น % เช่น 92.50"],
    ["92.505", "ทศนิยมไม่เกิน 2 ตำแหน่ง"],
    ["100.01", "ต้องไม่เกิน 100%"],
    ["0", "กรอกเป็น % เช่น 92.50"],
    ["abc", "กรอกเป็นตัวเลข %"],
  ])("พิมพ์ %s → ไม่ยิง calc · แสดง error · ค่าในช่องไม่ถูกแก้เงียบๆ", async (typed, message) => {
    renderForm();
    fillRestOfJob();
    await settle();
    calcPrice.mockClear();
    fireEvent.change(purityInput(), { target: { value: typed } });
    expect(purityInput().value).toBe(typed);
    expect(purityInput()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(new RegExp(message.replace(/[.*+?^${}()|[\]\\%]/g, "\\$&")))).toBeInTheDocument();
    await expectNoCalc();
  });

  it("แก้ค่าผิดกลับเป็นค่าถูก → error หาย และยิง calc ด้วยสัดส่วนที่ถูก", async () => {
    renderForm();
    fillRestOfJob();
    await settle();
    fireEvent.change(purityInput(), { target: { value: "0.925" } });
    expect(purityInput()).toHaveAttribute("aria-invalid", "true");
    calcPrice.mockClear();
    fireEvent.change(purityInput(), { target: { value: "92.50" } });
    expect(purityInput()).not.toHaveAttribute("aria-invalid");
    await waitFor(() => expect(calcPrice).toHaveBeenCalled(), { timeout: 3000 });
    expect(lastCalcInput().purity).toBe(0.925);
  });
});
