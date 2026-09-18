// lib/actions/production.test.ts — role gating (every action in this
// module must call requireOwnerAdmin() first, per the P1b brief) + input
// validation that must reject BEFORE any RPC call + snake_case->camelCase
// response mapping for the two RPCs most likely to drift from 0131's actual
// jsonb shape (production_order_save, production_order_done). Mocking
// pattern copied from lib/actions/hero-stock.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getEffectiveRoleMock = vi.fn();
const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/auth/role", () => ({
  getEffectiveRole: () => getEffectiveRoleMock(),
}));

vi.mock("@/lib/dev/context", () => ({
  getDevShopId: () => "shop-1",
}));

// Chainable .select()/.eq()/.not()/.order()/.range()/.maybeSingle() stub —
// every method returns the same builder (order/args don't matter for these
// unit tests) and the builder itself is thenable, resolving to whatever
// `result` the test configured for that table.
function queryBuilder(result: { data: unknown; error: unknown; count?: number | null }) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    not: () => builder,
    order: () => builder,
    range: () => builder,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: typeof result) => void) => resolve(result),
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    schema: () => ({ rpc: rpcMock, from: (table: string) => fromMock(table) }),
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveRoleMock.mockResolvedValue("owner");
  rpcMock.mockResolvedValue({ data: null, error: null });
  fromMock.mockImplementation(() => queryBuilder({ data: [], error: null, count: 0 }));
});

describe("requireOwnerAdmin gate — every action, staff rejected before any RPC/query", () => {
  it("saveProductionOrder", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { saveProductionOrder } = await import("./production");
    const result = await saveProductionOrder({});
    expect(result).toEqual({ ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ใช้งานใบผลิตเข้าสต็อกได้" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("setProductionOrderItem", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { setProductionOrderItem } = await import("./production");
    const result = await setProductionOrderItem({ productionOrderId: "po-1", productId: "11111111-1111-4111-8111-111111111111", qtyPlanned: 5 });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("removeProductionOrderItem", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { removeProductionOrderItem } = await import("./production");
    const result = await removeProductionOrderItem({ productionOrderId: "po-1", productId: "11111111-1111-4111-8111-111111111111" });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("previewProductionOrder", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { previewProductionOrder } = await import("./production");
    const result = await previewProductionOrder("po-1");
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("doneProductionOrder", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { doneProductionOrder } = await import("./production");
    const result = await doneProductionOrder({ productionOrderId: "po-1", items: [{ productId: "11111111-1111-4111-8111-111111111111", qtyDone: 5 }] });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("cancelProductionOrder", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { cancelProductionOrder } = await import("./production");
    const result = await cancelProductionOrder({ productionOrderId: "po-1" });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("getProductionOrders (read) — staff still rejected, unlike catalog-sku's open reads", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { getProductionOrders } = await import("./production");
    const result = await getProductionOrders();
    expect(result.ok).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("getProductionOrder (read)", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { getProductionOrder } = await import("./production");
    const result = await getProductionOrder("po-1");
    expect(result.ok).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("getProductionSkuOptions (read)", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { getProductionSkuOptions } = await import("./production");
    const result = await getProductionSkuOptions();
    expect(result.ok).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("saveProductionOrder", () => {
  it("rejects an out-of-range spot override before calling the RPC", async () => {
    const { saveProductionOrder } = await import("./production");
    const result = await saveProductionOrder({ spotOverrideThbPerGram: 1000 });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("maps the RPC's snake_case jsonb response to camelCase", async () => {
    rpcMock.mockResolvedValue({
      data: {
        id: "po-1",
        po_no: "PO-0001",
        status: "open",
        note: "test",
        spot_override_thb_per_gram: null,
        seq: 1,
        created_at: "2026-09-18T00:00:00Z",
      },
      error: null,
    });
    const { saveProductionOrder } = await import("./production");
    const result = await saveProductionOrder({ note: "test" });
    expect(result).toEqual({
      ok: true,
      data: {
        id: "po-1",
        poNo: "PO-0001",
        status: "open",
        note: "test",
        spotOverrideThbPerGram: null,
        seq: 1,
        createdAt: "2026-09-18T00:00:00Z",
      },
    });
    expect(rpcMock).toHaveBeenCalledWith(
      "production_order_save",
      expect.objectContaining({ p_shop_id: "shop-1", p_id: null, p_note: "test" })
    );
  });

  it("humanizes the 'no spot price today' RPC error", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "production_spot_resolve: ยังไม่มีราคาเงินของวันนี้ (2026-09-18) และไม่มี override — ออกใบผลิตไม่ได้ (ห้าม fallback ราคาเมื่อวาน)" },
    });
    const { saveProductionOrder } = await import("./production");
    const result = await saveProductionOrder({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("ยังไม่มีราคาเงินของวันนี้");
      expect(result.error).toContain("รอราคาที่จะเข้าระบบอัตโนมัติ");
      expect(result.error).not.toContain("/oem/rates");
    }
  });
});

describe("doneProductionOrder", () => {
  it("rejects a negative qtyDone before calling the RPC", async () => {
    const { doneProductionOrder } = await import("./production");
    const result = await doneProductionOrder({ productionOrderId: "po-1", items: [{ productId: "11111111-1111-4111-8111-111111111111", qtyDone: -1 }] });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a non-integer qtyDone before calling the RPC", async () => {
    const { doneProductionOrder } = await import("./production");
    const result = await doneProductionOrder({ productionOrderId: "po-1", items: [{ productId: "11111111-1111-4111-8111-111111111111", qtyDone: 1.5 }] });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  // security review 18 ก.ย. (M6) — payload นี้กำหนดว่าของเข้าสต็อกกี่ชิ้นและต้นทุน
  // ถูกล็อกเท่าไร (แก้ย้อนไม่ได้) ⇒ ต้องตกก่อนถึง DB ทั้ง 3 เคส
  it("ปฏิเสธ items ว่าง — 0131 จะตีความว่าผลิตครบตามแผนทุกบรรทัด", async () => {
    const { doneProductionOrder } = await import("./production");
    const result = await doneProductionOrder({ productionOrderId: "po-1", items: [] });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ปฏิเสธ productId ที่ไม่ใช่ uuid ก่อนถึง DB (กัน 22P02 ที่เผย uuid ดิบบนจอ)", async () => {
    const { doneProductionOrder } = await import("./production");
    const result = await doneProductionOrder({ productionOrderId: "po-1", items: [{ productId: "prod-1", qtyDone: 1 }] });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ปฏิเสธ SKU ซ้ำในรายการเดียวกัน (subquery ใน 0131 จะคืนหลายแถว = 21000)", async () => {
    const { doneProductionOrder } = await import("./production");
    const result = await doneProductionOrder({
      productionOrderId: "po-1",
      items: [
        { productId: "11111111-1111-4111-8111-111111111111", qtyDone: 1 },
        { productId: "11111111-1111-4111-8111-111111111111", qtyDone: 2 },
      ],
    });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("maps the RPC's snake_case jsonb response (including items[]) to camelCase", async () => {
    rpcMock.mockResolvedValue({
      data: {
        production_order_id: "po-1",
        po_no: "PO-0001",
        status: "done",
        already_done: false,
        items: [
          { product_id: "11111111-1111-4111-8111-111111111111", sku: "SKU-1", qty_done: 5, unit_cost: 123.45, prev_cost_type: "spot", prev_unit_cost: 100 },
        ],
      },
      error: null,
    });
    const { doneProductionOrder } = await import("./production");
    const result = await doneProductionOrder({ productionOrderId: "po-1", items: [{ productId: "11111111-1111-4111-8111-111111111111", qtyDone: 5 }] });
    expect(result).toEqual({
      ok: true,
      data: {
        productionOrderId: "po-1",
        poNo: "PO-0001",
        status: "done",
        alreadyDone: false,
        items: [{ productId: "11111111-1111-4111-8111-111111111111", sku: "SKU-1", qtyDone: 5, unitCost: 123.45, prevCostType: "spot", prevUnitCost: 100 }],
      },
    });
  });
});

describe("getProductionSkuOptions", () => {
  it("filters to is_active=true and excludes live* SKUs server-side", async () => {
    const eqMock = vi.fn();
    const notMock = vi.fn();
    fromMock.mockImplementation((table: string) => {
      expect(table).toBe("v_dim_product");
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (...args: unknown[]) => {
          eqMock(...args);
          return builder;
        },
        not: (...args: unknown[]) => {
          notMock(...args);
          return builder;
        },
        order: () => builder,
        range: () => builder,
        then: (resolve: (v: unknown) => void) =>
          resolve({
            data: [{ product_id: "11111111-1111-4111-8111-111111111111", sku: "R-0001", name: "แหวน", cost_type: "fixed" }],
            error: null,
            count: 1,
          }),
      };
      return builder;
    });

    const { getProductionSkuOptions } = await import("./production");
    const result = await getProductionSkuOptions();

    expect(result).toEqual({
      ok: true,
      data: [{ productId: "11111111-1111-4111-8111-111111111111", sku: "R-0001", name: "แหวน", costType: "fixed" }],
    });
    expect(eqMock).toHaveBeenCalledWith("is_active", true);
    expect(notMock).toHaveBeenCalledWith("sku", "ilike", "live%");
  });
});
