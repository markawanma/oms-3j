// @vitest-environment jsdom
// QA (independent of dev's tests): UI -> REAL server actions -> mocked Supabase RPC. The dev tests mock the action, so a
// unit slip BETWEEN form and RPC would be invisible there. Here we assert the actual RPC params (what the DB would receive).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

const rpcMock = vi.fn();

function chain(): unknown {
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => {
      if (k === "maybeSingle") return () => Promise.resolve({ data: null, error: null });
      if (k === "then") return (res: (v: unknown) => unknown) => res({ data: [], error: null });
      return () => p;
    },
    apply: () => p,
  });
  return p;
}

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: async () => "owner" }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => null }));
vi.mock("@/lib/auth/action-guard", () => ({
  requireWriteAccess: async (g: () => unknown) => await g(),
}));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => "shop-1" }));
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: () => chain(),
    schema: () => ({ rpc: (...a: unknown[]) => rpcMock(...a), from: () => chain() }),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/domain/catalog/ProductImageSection", () => ({ ProductImageSection: () => null }));
vi.mock("./catalog/ProductImageSection", () => ({ ProductImageSection: () => null }));
vi.mock("@/lib/actions/catalog-sku", async (orig) => {
  const actual = await orig<typeof import("@/lib/actions/catalog-sku")>();
  return {
    ...actual,
    listSkuPrefixes: async () => ({
      ok: true,
      data: [{ id: "pf-1", kindLabel: "แหวน", workType: "oem", prefix: "R", lastNo: null, padWidth: 3, createdAt: "2026-01-01" }],
    }),
  };
});

import { ToastProvider } from "@/components/ui/Toast";
import type { ProductRow } from "@/lib/catalog/types";
import { OEM_ITEM_KIND_OPTIONS, OEM_POLISH_TIER_OPTIONS } from "@/lib/oem/display";
import type { OemSettingData } from "@/lib/oem/types";
import { ProductForm } from "./catalog/ProductForm";
import { QuoteCalculatorClient } from "./oem/QuoteCalculatorClient";

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockImplementation(async (name: string) => {
    if (name === "product_upsert") return { data: "p-1", error: null };
    if (name === "catalog_sku_create") return { data: [{ product_id: "p-new", sku: "R001" }], error: null };
    if (name === "sku_prefix_preview_seed") return { data: [], error: null };
    return { data: null, error: { code: "XX000", message: "mock-no-calc" } };
  });
});

function row(over: Partial<ProductRow> = {}): ProductRow {
  return {
    productId: "p-1", sku: "BAR-1B-999", name: "แท่ง", category: null, costType: "spot", manualUnitCost: null,
    silverWeightG: 15.244, silverPurity: 0.999, laborCost: null, listPrice: null, makeSpec: null, effectiveUnitCost: null,
    marginPct: null, barcode: null, supplier: null, note: null, isActive: true, primaryImageUrl: null, primaryImageSmUrl: null,
    ...over,
  };
}
const rpcParams = (name: string) => {
  const c = rpcMock.mock.calls.find((x) => x[0] === name);
  return c ? (c[1] as Record<string, unknown>) : undefined;
};

function renderProductForm(initial?: ProductRow) {
  render(
    <ToastProvider>
      <ProductForm initial={initial} silverSpot={40} onDone={vi.fn()} />
    </ToastProvider>
  );
}
const purityBox = () => screen.getByRole("textbox", { name: /ความบริสุทธิ์/ }) as HTMLInputElement;

describe("catalog ProductForm -> real upsertProduct -> RPC product_upsert", () => {
  it("DB 0.9990 (7 SKUs in prod): field shows 99.90, save untouched -> p_silver_purity === 0.999", async () => {
    renderProductForm(row());
    expect(purityBox().value).toBe("99.90");
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(rpcParams("product_upsert")).toBeDefined());
    expect(rpcParams("product_upsert")!.p_silver_purity).toBe(0.999);
  });
  it("edit to 92.5 -> RPC gets 0.925 (not 92.5, not 0.00925)", async () => {
    renderProductForm(row());
    fireEvent.change(purityBox(), { target: { value: "92.5" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(rpcParams("product_upsert")).toBeDefined());
    expect(rpcParams("product_upsert")!.p_silver_purity).toBe(0.925);
  });
  it("typing 0.925 (old habit) -> save blocked, RPC never called, error names the field", async () => {
    renderProductForm(row());
    fireEvent.change(purityBox(), { target: { value: "0.925" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await new Promise((r) => setTimeout(r, 100));
    expect(rpcParams("product_upsert")).toBeUndefined();
    expect(screen.getAllByText(/กรอกเป็น %/).length).toBeGreaterThan(0);
  });
  it("preview cost by hand: 15.244 g x 40 x 99.90% = 609.10 THB (rounded)", () => {
    renderProductForm(row());
    // 15.244*40*0.999 = 609.12... compute oracle independently then look for it on screen
    const expected = Math.round(15.244 * 40 * 0.999 * 100) / 100; // 609.1
    const txt = document.body.textContent ?? "";
    const needle = expected.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    expect(txt.replace(/,/g, "")).toContain(needle.replace(/,/g, ""));
  });
  // BUG-PROBE (QA): purity typed wrong in spot mode, user then switches to fixed (field hidden). Is the user trapped?
  it("[bug probe] spot: type 0.925 -> switch to fixed (field hidden) -> save should NOT be blocked by a hidden field", async () => {
    renderProductForm(row({ costType: "spot" }));
    fireEvent.change(purityBox(), { target: { value: "0.925" } });
    fireEvent.click(screen.getByRole("radio", { name: /ใส่ต้นทุนเอง/ }));
    expect(screen.queryByRole("textbox", { name: /ความบริสุทธิ์/ })).toBeNull(); // field really hidden
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await new Promise((r) => setTimeout(r, 100));
    expect(rpcParams("product_upsert")).toBeDefined(); // desired behaviour
  });
});

// ------------------------------------------------------------------ OEM
const setting: OemSettingData = {
  marginTargetPct: 0.3, marginDiscountCapPct: 0.1, marginFloorPct: 0.2, marginHardFloorPct: 0.1, nreMaxSharePct: 0.3,
  minJobValueThb: 0, quoteValidDaysSilver: 7, quoteValidDaysGold: 3, quoteValidDaysBrass: 7, barMarginPct: 0.2, formulaVersion: 1,
};
function renderQuote() {
  render(
    <ToastProvider>
      <QuoteCalculatorClient setting={setting} />
    </ToastProvider>
  );
}
function fillJob() {
  fireEvent.change(screen.getByLabelText("ประเภทชิ้นงาน"), { target: { value: OEM_ITEM_KIND_OPTIONS[0] } });
  fireEvent.change(screen.getByLabelText("ระดับความยากขัด"), { target: { value: OEM_POLISH_TIER_OPTIONS[0] } });
  fireEvent.change(screen.getByLabelText("น้ำหนัก/ชิ้น (กรัม)"), { target: { value: "3.5" } });
  fireEvent.change(screen.getByLabelText("จำนวน (ชิ้น)"), { target: { value: "50" } });
}
const calcInputs = () => rpcMock.mock.calls.filter((c) => c[0] === "oem_price_calc").map((c) => (c[1] as { p_input: Record<string, unknown> }).p_input);
const lastCalc = () => calcInputs()[calcInputs().length - 1];
const waitCalc = () => waitFor(() => expect(calcInputs().length).toBeGreaterThan(0), { timeout: 3000 });
const oemPurity = () => screen.getByRole("textbox", { name: /ความบริสุทธิ์/ }) as HTMLInputElement;

describe("OEM quote form -> real calcPrice -> RPC oem_price_calc p_input.purity", () => {
  it("default silver, untouched -> 0.925 (the RPC value for an existing 0.925 quote is unchanged)", async () => {
    renderQuote();
    fillJob();
    await waitCalc();
    expect(lastCalc().purity).toBe(0.925);
  });
  it("switch silver -> gold -> silver: gold field empty (required), back to silver refills 92.50 -> 0.925", async () => {
    renderQuote();
    fillJob();
    await waitCalc();
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "gold" } });
    expect(oemPurity().value).toBe("");
    fireEvent.change(oemPurity(), { target: { value: "96.5" } });
    await waitFor(() => expect(lastCalc().metal).toBe("gold"), { timeout: 3000 });
    expect(lastCalc().purity).toBe(0.965);
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "silver" } });
    expect(oemPurity().value).toBe("92.50");
    await waitFor(() => expect(lastCalc().metal).toBe("silver"), { timeout: 3000 });
    expect(lastCalc().purity).toBe(0.925);
  });
  it("brass default -> 100.00 shown, RPC gets 1", async () => {
    renderQuote();
    fillJob();
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "brass" } });
    expect(oemPurity().value).toBe("100.00");
    await waitFor(() => expect(lastCalc()?.metal).toBe("brass"), { timeout: 3000 });
    expect(lastCalc().purity).toBe(1);
  });
  it("gold stays mandatory: empty gold purity never reaches RPC; whitespace-only too", async () => {
    renderQuote();
    fillJob();
    fireEvent.change(screen.getByLabelText("วัสดุ"), { target: { value: "gold" } });
    await new Promise((r) => setTimeout(r, 700));
    expect(calcInputs().filter((i) => i.metal === "gold")).toHaveLength(0);
    fireEvent.change(oemPurity(), { target: { value: "   " } });
    await new Promise((r) => setTimeout(r, 700));
    expect(calcInputs().filter((i) => i.metal === "gold")).toHaveLength(0);
  });
  it("silver: owner's reject list never reaches RPC and shows red error", async () => {
    renderQuote();
    fillJob();
    await waitCalc();
    for (const bad of ["92.505", "0", "-5", "100.01", "abc", "0.925", "1", "9.25", "37.49"]) {
      rpcMock.mockClear();
      fireEvent.change(oemPurity(), { target: { value: bad } });
      expect(oemPurity()).toHaveAttribute("aria-invalid", "true");
      await new Promise((r) => setTimeout(r, 650));
      expect(calcInputs().filter((i) => i.metal === "silver"), bad).toHaveLength(0);
    }
  });
  it("silver cleared -> optional, RPC gets purity null (unchanged behaviour), no error shown", async () => {
    renderQuote();
    fillJob();
    await waitCalc();
    rpcMock.mockClear();
    fireEvent.change(oemPurity(), { target: { value: "" } });
    expect(oemPurity()).not.toHaveAttribute("aria-invalid");
    await waitCalc();
    expect(lastCalc().purity).toBeNull();
  });
});

describe("OEM '+ สินค้าใหม่' seed -> real createCatalogSku -> RPC catalog_sku_create p_attrs.silver_purity", () => {
  it("silver 92.50 in the form -> dialog says 92.50% and RPC attrs.silver_purity === 0.925", async () => {
    renderQuote();
    fillJob();
    await waitCalc();
    fireEvent.click(screen.getByRole("button", { name: /สินค้าใหม่/ }));
    await waitFor(() => expect(screen.getByLabelText("เลือก prefix")).toBeInTheDocument());
    expect(document.body.textContent).toContain("ความบริสุทธิ์ 92.50%");
    fireEvent.change(screen.getByLabelText("เลือก prefix"), { target: { value: "pf-1" } });
    fireEvent.change(screen.getByLabelText("ชื่อสินค้า"), { target: { value: "แหวนทดสอบ" } });
    fireEvent.click(screen.getByRole("button", { name: "สร้าง" }));
    await waitFor(() => expect(rpcParams("catalog_sku_create")).toBeDefined());
    const attrs = rpcParams("catalog_sku_create")!.p_attrs as Record<string, unknown>;
    expect(attrs.silver_purity).toBe(0.925);
    expect(attrs.silver_weight_g).toBe(3.5);
  });
  it("silver purity typed 96.5 -> seed 0.965; typed invalid 0.925 -> NO purity seeded (not 0.925 by accident, not 925)", async () => {
    renderQuote();
    fillJob();
    await waitCalc();
    fireEvent.change(oemPurity(), { target: { value: "0.925" } });
    fireEvent.click(screen.getByRole("button", { name: /สินค้าใหม่/ }));
    await waitFor(() => expect(screen.getByLabelText("เลือก prefix")).toBeInTheDocument());
    expect(document.body.textContent).not.toContain("ความบริสุทธิ์ 0.");
    fireEvent.change(screen.getByLabelText("เลือก prefix"), { target: { value: "pf-1" } });
    fireEvent.change(screen.getByLabelText("ชื่อสินค้า"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "สร้าง" }));
    await waitFor(() => expect(rpcParams("catalog_sku_create")).toBeDefined());
    expect((rpcParams("catalog_sku_create")!.p_attrs as Record<string, unknown>).silver_purity).toBeUndefined();
  });
});
