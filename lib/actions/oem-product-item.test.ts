// lib/actions/oem-product-item.test.ts — 0166 รายการสินค้า/ราคากำหนดเอง (metal='product'): ด่านฝั่ง server action
//   1. payload: catalog (มี productId) ไม่ส่งทุน/ชื่อ · manual ส่งชื่อ+ทุน · เหตุผลส่งเฉพาะที่ไม่ว่าง (ลบอักขระล่องหน)
//   2. ด่านรูปร่างที่ขอบ action ก่อนถึง RPC (ทุนในโหมด catalog · ชื่อ/ทุนโหมด manual · ตัวเลข)
//   3. calcPrice ส่งข้อความ 22023 ของ DB กลับ (error อื่นยังเป็นข้อความกลาง ไม่รั่ว)
//   4. saveQuote: product_id ระดับ item = input.productId · ไม่ส่ง sku/ชื่อ snapshot (DB ทับเอง) · งานผลิตเดิมยังส่ง label ตามเดิม
//   5. อ่านกลับ: fromCalcResult อ่าน breakdown.product · getOemProducts คืน listPrice (ไม่คืนทุน)
// pattern mock เดียวกับ lib/actions/oem-bar-override.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const getEffectiveRoleMock = vi.fn();
const rpcMock = vi.fn();
const fromRowsMock = vi.fn();
const selectMock = vi.fn();

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => getEffectiveRoleMock() }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => null }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => "shop-1" }));
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    schema: () => {
      const chain: Record<string, unknown> = {};
      chain.select = (cols: string) => {
        selectMock(cols);
        return chain;
      };
      chain.eq = () => chain;
      chain.order = () => Promise.resolve(fromRowsMock());
      return { rpc: rpcMock, from: () => chain };
    },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveRoleMock.mockResolvedValue("owner");
  rpcMock.mockResolvedValue({ data: null, error: null });
});

// calc jsonb ที่ DB (0166) คืนสำหรับรายการสินค้า — ตัวเลข fixture สมมติ ไม่ใช่ราคา/ทุนจริง
function productCalcJson(over: Record<string, unknown> = {}) {
  return {
    is_complete: true,
    missing: [],
    breakdown: {
      q_run: null,
      reject_pct_total: null,
      margin_pct_used: null,
      metal: { per_piece: null, price_used: null, price_source: null },
      labor: { per_piece: 0, steps: [] },
      batch: { per_piece: 0, lines: [] },
      nre: { cad: null, print3d: null, mold: null, cost: 0, price: 0 },
      product: {
        product_id: "p-1",
        sku: "T-SKU-1",
        name: "สินค้าทดสอบ",
        category: "ทดสอบ",
        cost_source: "catalog",
        cost_basis: "fixed",
        catalog_list_price: 1000,
        unit_price_thb: 900,
        below_catalog: true,
        price_reason: "ลูกค้าประจำ",
      },
      cost_piece: 600,
      price_per_piece: 900,
      quote_total: 1800,
      margin_actual_pct: 0.3333,
    },
    floors: {
      qty: { pass: true, moq: null, actual: 2 },
      job_value: { pass: true, min: 0 },
      metal_weight: { pass: true, applies: false },
      margin: { state: null, value: null, blended: 0.3333, target: 0.3 },
      price_fresh: { pass: true, as_of_date: null, today_bkk: "2026-10-08" },
    },
    warnings: ["ต้นทุนจากแคตตาล็อกเป็นค่าประมาณ"],
    formula_version: 5,
    ...over,
  };
}

const catalogInput = (over: Record<string, unknown> = {}) => ({
  metal: "product" as const,
  qty: 2,
  productId: "p-1",
  unitPriceThb: 900,
  priceReason: "ลูกค้าประจำ",
  ...over,
});
const manualInput = (over: Record<string, unknown> = {}) => ({
  metal: "product" as const,
  qty: 3,
  productName: "  กล่องสั่งทำ  ",
  unitPriceThb: 100.5,
  unitCostThb: 60.25,
  ...over,
});

describe("calcPrice — รายการสินค้า payload", () => {
  it("catalog: ส่ง product_id + unit_price_thb + price_reason · ไม่มี unit_cost_thb / product_name เลย (DB ปฏิเสธทุนที่ส่งมา)", async () => {
    rpcMock.mockResolvedValue({ data: productCalcJson(), error: null });
    const { calcPrice } = await import("./oem");
    const r = await calcPrice(catalogInput());
    expect(r.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("oem_price_calc", {
      p_shop_id: "shop-1",
      p_input: { metal: "product", qty: 2, unit_price_thb: 900, product_id: "p-1", price_reason: "ลูกค้าประจำ" },
    });
    const payload = rpcMock.mock.calls[0][1].p_input as Record<string, unknown>;
    expect(payload).not.toHaveProperty("unit_cost_thb");
    expect(payload).not.toHaveProperty("product_name");
  });

  it("catalog ไม่มีเหตุผล → ไม่มี key price_reason (ไม่ส่งสตริงว่าง) · เหตุผลล่องหนล้วน = ไม่มีเหตุผล", async () => {
    rpcMock.mockResolvedValue({ data: productCalcJson(), error: null });
    const { calcPrice } = await import("./oem");
    await calcPrice(catalogInput({ priceReason: null }));
    expect(rpcMock.mock.calls[0][1].p_input).not.toHaveProperty("price_reason");
    rpcMock.mockClear();
    await calcPrice(catalogInput({ priceReason: String.fromCharCode(0x2060, 0xfeff) + "  " }));
    expect(rpcMock.mock.calls[0][1].p_input).not.toHaveProperty("price_reason");
  });

  it("manual: ส่ง product_name (trim) + unit_cost_thb + unit_price_thb · ไม่มี product_id", async () => {
    rpcMock.mockResolvedValue({ data: productCalcJson(), error: null });
    const { calcPrice } = await import("./oem");
    const r = await calcPrice(manualInput());
    expect(r.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("oem_price_calc", {
      p_shop_id: "shop-1",
      p_input: { metal: "product", qty: 3, unit_price_thb: 100.5, product_name: "กล่องสั่งทำ", unit_cost_thb: 60.25 },
    });
    expect(rpcMock.mock.calls[0][1].p_input).not.toHaveProperty("product_id");
  });

  it("ไม่ใช่รายการสินค้า → payload งานผลิต/เงินแท่งเดิมเป๊ะ ไม่มี key ของสินค้าปน (ต้องไม่พัง)", async () => {
    rpcMock.mockResolvedValue({ data: productCalcJson(), error: null });
    const { calcPrice } = await import("./oem");
    await calcPrice({
      metal: "silver", itemKind: "แหวน", polishTier: "เรียบ", qty: 5, weightG: 3.5,
      // ค่าของสินค้าที่หลงมากับ input งานผลิต (caller ข้าม type) ต้องไม่ถูกส่งต่อ
      ...({ productId: "p-1", unitPriceThb: 5, unitCostThb: 1, priceReason: "x", productName: "x" } as object),
    });
    const payload = rpcMock.mock.calls[0][1].p_input as Record<string, unknown>;
    for (const k of ["product_id", "unit_price_thb", "unit_cost_thb", "price_reason", "product_name"]) {
      expect(payload).not.toHaveProperty(k);
    }
    expect(payload.metal).toBe("silver");
  });
});

describe("calcPrice — ด่านรูปร่างที่ขอบ action (ไม่ถึง RPC)", () => {
  it.each([
    ["catalog + ส่งทุนมาเอง", catalogInput({ unitCostThb: 1 }), "ทุน"],
    ["manual ไม่มีชื่อ", manualInput({ productName: "   " }), "ชื่อ"],
    ["manual ชื่อมีขึ้นบรรทัดใหม่", manualInput({ productName: "a\nb" }), "ชื่อรายการ"],
    ["manual ไม่มีทุน", manualInput({ unitCostThb: null }), "ทุน"],
    ["manual ทุน 0", manualInput({ unitCostThb: 0 }), "ทุน"],
    ["ราคา 0", catalogInput({ unitPriceThb: 0 }), "ราคา"],
    ["ราคาติดลบ", catalogInput({ unitPriceThb: -5 }), "ราคา"],
    ["ราคา NaN", catalogInput({ unitPriceThb: Number.NaN }), "ราคา"],
    ["ราคา Infinity", catalogInput({ unitPriceThb: Number.POSITIVE_INFINITY }), "ราคา"],
    ["ราคาเกิน 1,000,000", catalogInput({ unitPriceThb: 1_000_000.01 }), "ราคา"],
    ["ราคาทศนิยม 3 ตำแหน่ง", catalogInput({ unitPriceThb: 1.005 }), "ทศนิยม"],
    ["ราคาเป็นสตริง", catalogInput({ unitPriceThb: "900" as unknown as number }), "ราคา"],
    ["qty 0", catalogInput({ qty: 0 }), "จำนวน"],
    ["qty ทศนิยม", catalogInput({ qty: 2.5 }), "จำนวน"],
    ["qty เกิน 100,000", catalogInput({ qty: 100_001 }), "จำนวน"],
    ["เหตุผลไม่ใช่ข้อความ", catalogInput({ priceReason: 5 as unknown as string }), "เหตุผล"],
  ])("%s → ปฏิเสธ ไม่ยิง RPC", async (_name, input, fragment) => {
    const { calcPrice } = await import("./oem");
    const r = await calcPrice(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(fragment);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ขอบที่ต้องผ่าน: ราคา 1,000,000 · 0.01 · qty 100,000 · ชื่อ 200 ตัวอักษร (ต้องไม่พัง)", async () => {
    rpcMock.mockResolvedValue({ data: productCalcJson(), error: null });
    const { calcPrice } = await import("./oem");
    const a = await calcPrice(manualInput({ unitPriceThb: 1_000_000, unitCostThb: 999_999.99, qty: 100_000, productName: "ก".repeat(200) }));
    const b = await calcPrice(manualInput({ unitPriceThb: 0.01, unitCostThb: 0.01 }));
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
});

describe("calcPrice — ข้อความ 22023 จาก DB", () => {
  it("22023 → ส่งข้อความไทยของ DB กลับ (ตัดคำนำหน้า oem_price_calc:)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "oem_price_calc: ราคาต่ำกว่าราคาแคตตาล็อก ต้องระบุเหตุผล (p_input.price_reason)" },
    });
    const { calcPrice } = await import("./oem");
    const r = await calcPrice(catalogInput({ priceReason: null }));
    expect(r).toEqual({ ok: false, error: "ราคาต่ำกว่าราคาแคตตาล็อก ต้องระบุเหตุผล (p_input.price_reason)" });
  });

  it("error อื่น (เช่น 42501/500) → ข้อความกลาง ไม่รั่วรายละเอียดของ DB", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied for function oem_price_calc" } });
    const { calcPrice } = await import("./oem");
    const r = await calcPrice(catalogInput());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("คำนวณราคาไม่สำเร็จ — ตรวจข้อมูลที่กรอก แล้วลองใหม่อีกครั้ง");
      expect(r.error).not.toContain("permission");
    }
  });

  it("22023 ของเงินแท่ง (เดิมถูกกลืนเป็นข้อความกลาง) ตอนนี้ก็แสดงข้อความ DB — ผู้ใช้รู้ว่าต้องแก้อะไร", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", message: "oem_price_calc: ราคาพิเศษสูงกว่า 2 เท่าของราคาเว็บวันนี้ — ตรวจว่าพิมพ์เลขเกินหรือไม่" } });
    const { calcPrice } = await import("./oem");
    const r = await calcPrice({ metal: "silver999", barSize: "1_baht", qty: 1, barPriceOverrideThb: 5000, barPriceOverrideReason: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("ราคาพิเศษสูงกว่า 2 เท่า");
  });
});

describe("saveQuote — รายการสินค้า", () => {
  it("catalog: product_id ระดับ item = input.productId · ไม่ส่ง sku_snapshot/product_name_snapshot (แม้ caller ส่งมา)", async () => {
    rpcMock.mockResolvedValue({ data: "q-1", error: null });
    const { saveQuote } = await import("./oem");
    const r = await saveQuote({
      items: [{ input: catalogInput(), productId: "OTHER", skuSnapshot: "FAKE", productNameSnapshot: "ชื่อปลอม" }],
      status: "draft",
    });
    expect(r.ok).toBe(true);
    const items = rpcMock.mock.calls[0][1].p_items as Record<string, unknown>[];
    expect(items).toHaveLength(1);
    expect(items[0].product_id).toBe("p-1");
    expect(items[0]).not.toHaveProperty("sku_snapshot");
    expect(items[0]).not.toHaveProperty("product_name_snapshot");
  });

  it("manual: ไม่มี product_id ระดับ item แม้ caller ส่งมา (DB จะปฏิเสธถ้าไม่ตรง input)", async () => {
    rpcMock.mockResolvedValue({ data: "q-1", error: null });
    const { saveQuote } = await import("./oem");
    await saveQuote({ items: [{ input: manualInput(), productId: "STALE", skuSnapshot: "FAKE" }], status: "draft" });
    const items = rpcMock.mock.calls[0][1].p_items as Record<string, unknown>[];
    expect(items[0]).not.toHaveProperty("product_id");
    expect(items[0]).not.toHaveProperty("sku_snapshot");
  });

  it("ด่านรูปร่างทำงานที่ saveQuote ด้วย (ทุนในโหมด catalog → ไม่ถึง RPC)", async () => {
    const { saveQuote } = await import("./oem");
    const r = await saveQuote({ items: [{ input: catalogInput({ unitCostThb: 1 }) }], status: "draft" });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("22023 ของ DB ถูกส่งกลับผู้ใช้ตรงๆ (เช่น input.product_id ไม่ตรง item)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", message: "oem_quote_save: p_items[1] product_id ใน input ไม่ตรงกับ product_id ของรายการ" } });
    const { saveQuote } = await import("./oem");
    const r = await saveQuote({ items: [{ input: catalogInput() }], status: "quoted" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("ไม่ตรงกับ product_id");
  });

  it("งานผลิตเดิม: ยังส่ง product_id/sku_snapshot/ชื่อ ตามเดิม (SKU เป็น label — ต้องไม่พัง)", async () => {
    rpcMock.mockResolvedValue({ data: "q-1", error: null });
    const { saveQuote } = await import("./oem");
    await saveQuote({
      items: [
        {
          input: { metal: "silver", itemKind: "แหวน", polishTier: "เรียบ", qty: 5, weightG: 3.5 },
          productId: "p-9",
          skuSnapshot: "R-1",
          productNameSnapshot: "แหวนทดสอบ",
        },
      ],
      status: "draft",
    });
    const items = rpcMock.mock.calls[0][1].p_items as Record<string, unknown>[];
    expect(items[0].product_id).toBe("p-9");
    expect(items[0].sku_snapshot).toBe("R-1");
    expect(items[0].product_name_snapshot).toBe("แหวนทดสอบ");
  });
});

describe("อ่านกลับ", () => {
  it("fromCalcResult อ่าน breakdown.product ครบ (ราคาแคตตาล็อก · เหตุผล · below_catalog · cost_source)", async () => {
    rpcMock.mockResolvedValue({ data: productCalcJson(), error: null });
    const { calcPrice } = await import("./oem");
    const r = await calcPrice(catalogInput());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.breakdown.product).toEqual({
        productId: "p-1",
        sku: "T-SKU-1",
        name: "สินค้าทดสอบ",
        category: "ทดสอบ",
        costSource: "catalog",
        costBasis: "fixed",
        catalogListPrice: 1000,
        unitPriceThb: 900,
        belowCatalog: true,
        priceReason: "ลูกค้าประจำ",
      });
      expect(r.data.floors.margin.value).toBeNull(); // ไม่มีด่านทุนรายชิ้น
      expect(r.data.formulaVersion).toBe(5);
    }
  });

  it("calc ของงานผลิต/เงินแท่งเดิม → breakdown.product = null (ไม่ปน)", async () => {
    const json = productCalcJson();
    delete (json.breakdown as Record<string, unknown>).product;
    rpcMock.mockResolvedValue({ data: json, error: null });
    const { calcPrice } = await import("./oem");
    const r = await calcPrice({ metal: "silver999", barSize: "1_baht", qty: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.breakdown.product).toBeNull();
  });

  it("getOemProducts: select list_price (ไม่เลือก unit_cost/margin) · listPrice 0/null → null", async () => {
    fromRowsMock.mockReturnValue({
      data: [
        { product_id: "a", sku: "A", name: "เอ", category: null, list_price: "1000.00" },
        { product_id: "b", sku: "B", name: "บี", category: null, list_price: null },
        { product_id: "c", sku: "C", name: "ซี", category: null, list_price: 0 },
      ],
      error: null,
    });
    const { getOemProducts } = await import("./oem");
    const r = await getOemProducts();
    expect(r.ok).toBe(true);
    const cols = selectMock.mock.calls[0][0] as string;
    expect(cols).toContain("list_price");
    expect(cols).not.toMatch(/unit_cost|margin|effective/);
    if (r.ok) {
      expect(r.data.map((p) => p.listPrice)).toEqual([1000, null, null]);
      for (const p of r.data) expect(Object.keys(p).sort()).toEqual(["category", "listPrice", "name", "productId", "sku"]);
    }
  });
});
