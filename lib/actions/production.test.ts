// lib/actions/production.test.ts — role gating (every action in this
// module must call requireOwnerAdmin() first, per the P1b brief) + input
// validation that must reject BEFORE any RPC call + snake_case->camelCase
// response mapping for the two RPCs most likely to drift from 0131's actual
// jsonb shape (production_order_save, production_order_done). Mocking
// pattern copied from lib/actions/hero-stock.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getEffectiveRoleMock = vi.fn();
const getSessionUserMock = vi.fn();
const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/auth/role", () => ({
  getEffectiveRole: () => getEffectiveRoleMock(),
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: () => getSessionUserMock(),
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
    in: () => builder,
    not: () => builder,
    order: () => builder,
    range: () => builder,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: typeof result) => void) => resolve(result),
  };
  return builder;
}

// 0141: getProductionOrder's make_spec/cost_calc side-channel reads call
// supabase.from("product") DIRECTLY (public schema — no .schema() wrapper),
// same as lib/actions/catalog.ts already does — so the mocked client needs a
// top-level `from` too, not just the `.schema().from` every other read here
// used pre-0141.
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    schema: () => ({ rpc: rpcMock, from: (table: string) => fromMock(table) }),
    from: (table: string) => fromMock(table),
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Minimal well-shaped RPC responses for tests that only care about *what
// was sent to* rpcMock, not the mapped return value — avoids the
// null-data-but-ok TypeError (and its noisy console.error) that a bare
// `{ data: null, error: null }` default would otherwise trigger once the
// action tries to destructure fields off it.
const SAVE_RPC_OK = {
  data: { id: "po-1", po_no: "PO-0001", status: "open", note: "test", spot_override_thb_per_gram: null, seq: 1, created_at: "2026-09-18T00:00:00Z" },
  error: null,
};
const DONE_RPC_OK = {
  data: { production_order_id: "po-1", po_no: "PO-0001", status: "done", already_done: false, items: [] },
  error: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveRoleMock.mockResolvedValue("owner");
  getSessionUserMock.mockResolvedValue(null);
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

  // 0132 M2 — p_clear_note/p_clear_spot_override must default to false (the
  // pre-0132 coalesce(p_x, x) behavior) when the caller doesn't pass them, so
  // every existing call site that doesn't know about "clear" keeps working.
  it("defaults p_clear_note/p_clear_spot_override to false when not specified", async () => {
    rpcMock.mockResolvedValue(SAVE_RPC_OK);
    const { saveProductionOrder } = await import("./production");
    await saveProductionOrder({ id: "po-1", note: "test" });
    expect(rpcMock).toHaveBeenCalledWith(
      "production_order_save",
      expect.objectContaining({ p_clear_note: false, p_clear_spot_override: false })
    );
  });

  // 0132 M2 — the actual fix: clearNote/clearSpotOverride true must reach the
  // RPC as true (this is what lets the DB set the column to null instead of
  // silently keeping the old value the way coalesce(p_x, x) did).
  it("passes clearNote/clearSpotOverride through to p_clear_note/p_clear_spot_override", async () => {
    rpcMock.mockResolvedValue(SAVE_RPC_OK);
    const { saveProductionOrder } = await import("./production");
    await saveProductionOrder({ id: "po-1", clearNote: true, clearSpotOverride: true });
    expect(rpcMock).toHaveBeenCalledWith(
      "production_order_save",
      expect.objectContaining({ p_clear_note: true, p_clear_spot_override: true })
    );
  });

  // 0132 M4 — p_actor must come from the REAL server session (getSessionUser),
  // never from the input object — there is no "actor" field on
  // SaveProductionOrderInput at all, so there is nothing for a caller to spoof.
  it("passes the session user's id as p_actor when a session exists", async () => {
    rpcMock.mockResolvedValue(SAVE_RPC_OK);
    getSessionUserMock.mockResolvedValue({ id: "user-42", email: "owner@example.com" });
    const { saveProductionOrder } = await import("./production");
    await saveProductionOrder({ note: "test" });
    expect(rpcMock).toHaveBeenCalledWith("production_order_save", expect.objectContaining({ p_actor: "user-42" }));
  });

  it("passes p_actor: null when there is no session (matches pre-0132 behavior via auth.uid())", async () => {
    rpcMock.mockResolvedValue(SAVE_RPC_OK);
    getSessionUserMock.mockResolvedValue(null);
    const { saveProductionOrder } = await import("./production");
    await saveProductionOrder({ note: "test" });
    expect(rpcMock).toHaveBeenCalledWith("production_order_save", expect.objectContaining({ p_actor: null }));
  });

  it("passes p_actor: null (instead of throwing) if getSessionUser() itself throws", async () => {
    getSessionUserMock.mockRejectedValue(new Error("Supabase Auth env not configured"));
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
    expect(result.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("production_order_save", expect.objectContaining({ p_actor: null }));
  });
});

// 0144 — production_order_item_set gained p_is_new_design (default null =
// "ไม่แตะค่าเดิม"). The critical invariant under test: setProductionOrderItem
// must NEVER coerce an omitted isNewDesign to false — that would silently
// reset an existing item's flag on every plain qty edit (task brief's เคส
// ห้ามผ่าน #2).
describe("setProductionOrderItem", () => {
  const ITEM_SET_RPC_OK = {
    data: { id: "item-1", product_id: "11111111-1111-4111-8111-111111111111", sku: "R-0099", name: "แหวนเงินแท้", qty_planned: 5, is_new_design: false },
    error: null,
  };

  it("sends p_is_new_design as null when isNewDesign is omitted (does not touch the existing flag)", async () => {
    rpcMock.mockResolvedValue(ITEM_SET_RPC_OK);
    const { setProductionOrderItem } = await import("./production");
    await setProductionOrderItem({ productionOrderId: "po-1", productId: "11111111-1111-4111-8111-111111111111", qtyPlanned: 5 });
    expect(rpcMock).toHaveBeenCalledWith(
      "production_order_item_set",
      expect.objectContaining({ p_is_new_design: null })
    );
  });

  it("sends p_is_new_design: true when isNewDesign is true", async () => {
    rpcMock.mockResolvedValue({ ...ITEM_SET_RPC_OK, data: { ...ITEM_SET_RPC_OK.data, is_new_design: true } });
    const { setProductionOrderItem } = await import("./production");
    await setProductionOrderItem({ productionOrderId: "po-1", productId: "11111111-1111-4111-8111-111111111111", qtyPlanned: 5, isNewDesign: true });
    expect(rpcMock).toHaveBeenCalledWith(
      "production_order_item_set",
      expect.objectContaining({ p_is_new_design: true })
    );
  });

  it("sends p_is_new_design: false when isNewDesign is explicitly false (table checkbox un-tick — deliberate, not an omission)", async () => {
    rpcMock.mockResolvedValue(ITEM_SET_RPC_OK);
    const { setProductionOrderItem } = await import("./production");
    await setProductionOrderItem({ productionOrderId: "po-1", productId: "11111111-1111-4111-8111-111111111111", qtyPlanned: 5, isNewDesign: false });
    expect(rpcMock).toHaveBeenCalledWith(
      "production_order_item_set",
      expect.objectContaining({ p_is_new_design: false })
    );
  });

  it("maps the RPC's is_new_design response field to camelCase isNewDesign", async () => {
    rpcMock.mockResolvedValue({ ...ITEM_SET_RPC_OK, data: { ...ITEM_SET_RPC_OK.data, is_new_design: true } });
    const { setProductionOrderItem } = await import("./production");
    const result = await setProductionOrderItem({ productionOrderId: "po-1", productId: "11111111-1111-4111-8111-111111111111", qtyPlanned: 5, isNewDesign: true });
    expect(result).toEqual({
      ok: true,
      data: {
        id: "item-1",
        productId: "11111111-1111-4111-8111-111111111111",
        sku: "R-0099",
        name: "แหวนเงินแท้",
        pendingProductLabel: null,
        qtyPlanned: 5,
        isNewDesign: true,
        // 0186: response ไม่มี key โลหะ/เนื้อ/น้ำหนัก (RPC เก่า) → null ไม่ throw
        metal: null,
        purity: null,
        weightG: null,
        weightSource: null,
      },
    });
  });

  it("0186: old-style call (SKU + qty only) sends exactly the 5 pre-0186 args — works against the DB before and after apply", async () => {
    rpcMock.mockResolvedValue(ITEM_SET_RPC_OK);
    const { setProductionOrderItem } = await import("./production");
    await setProductionOrderItem({ productionOrderId: "po-1", productId: "11111111-1111-4111-8111-111111111111", qtyPlanned: 5 });
    expect(rpcMock).toHaveBeenCalledWith("production_order_item_set", {
      p_shop_id: "shop-1",
      p_production_order_id: "po-1",
      p_product_id: "11111111-1111-4111-8111-111111111111",
      p_qty_planned: 5,
      p_is_new_design: null,
    });
  });

  it("0186: sends metal/purity/weight/source only when provided, and maps the values the DB actually stored", async () => {
    rpcMock.mockResolvedValue({
      data: { ...ITEM_SET_RPC_OK.data, pending_product_label: null, metal: "gold", purity: "0.9000", weight_g: "3.200", weight_source: "input" },
      error: null,
    });
    const { setProductionOrderItem } = await import("./production");
    const result = await setProductionOrderItem({
      productionOrderId: "po-1",
      productId: "11111111-1111-4111-8111-111111111111",
      qtyPlanned: 5,
      metal: "gold",
      purity: 0.9,
      weightG: 3.2,
      weightSource: "input",
    });
    expect(rpcMock).toHaveBeenCalledWith(
      "production_order_item_set",
      expect.objectContaining({ p_metal: "gold", p_purity: 0.9, p_weight_g: 3.2, p_weight_source: "input" })
    );
    expect(rpcMock.mock.calls[0][1]).not.toHaveProperty("p_pending_product_label");
    expect(rpcMock.mock.calls[0][1]).not.toHaveProperty("p_clear_weight");
    expect(result.ok && result.data).toMatchObject({ metal: "gold", purity: 0.9, weightG: 3.2, weightSource: "input" });
  });

  it("0186: item without SKU — sends p_product_id null + label, maps product_id null / name = label", async () => {
    rpcMock.mockResolvedValue({
      data: { id: "item-2", product_id: null, sku: null, name: "แหวนทดลอง", pending_product_label: "แหวนทดลอง", qty_planned: 4, is_new_design: false, metal: "silver", purity: "0.9250", weight_g: null, weight_source: null },
      error: null,
    });
    const { setProductionOrderItem } = await import("./production");
    const result = await setProductionOrderItem({ productionOrderId: "po-1", pendingProductLabel: "แหวนทดลอง", qtyPlanned: 4, metal: "silver" });
    expect(rpcMock).toHaveBeenCalledWith(
      "production_order_item_set",
      expect.objectContaining({ p_product_id: null, p_pending_product_label: "แหวนทดลอง", p_metal: "silver" })
    );
    expect(result.ok && result.data).toMatchObject({ productId: null, sku: null, name: "แหวนทดลอง", pendingProductLabel: "แหวนทดลอง", purity: 0.925 });
  });

  it("0186: clearWeight is sent as p_clear_weight: true only when set", async () => {
    rpcMock.mockResolvedValue(ITEM_SET_RPC_OK);
    const { setProductionOrderItem } = await import("./production");
    await setProductionOrderItem({ productionOrderId: "po-1", productId: "11111111-1111-4111-8111-111111111111", qtyPlanned: 5, clearWeight: true });
    expect(rpcMock).toHaveBeenCalledWith("production_order_item_set", expect.objectContaining({ p_clear_weight: true }));
  });

  // เคสห้ามผ่านฝั่ง action (ด่านจริงอยู่ที่ DB — ซ้ำกัน ไม่ใช่แทน) — ตกก่อนถึง RPC ทุกเคส
  it("0186: rejects bad input before any RPC call", async () => {
    const { setProductionOrderItem } = await import("./production");
    const sku = "11111111-1111-4111-8111-111111111111";
    const cases: Array<Record<string, unknown>> = [
      { productId: sku, pendingProductLabel: "ทั้งคู่" }, // มีทั้ง SKU และชื่อแบบ
      { pendingProductLabel: "   ", metal: "silver" }, // ชื่อแบบว่าง
      { pendingProductLabel: "แหวน<b>", metal: "silver" }, // < >
      { pendingProductLabel: "ก".repeat(201), metal: "silver" }, // ยาวเกิน 200
      { pendingProductLabel: "ไม่มีโลหะ" }, // รายการไม่มี SKU ไม่ระบุโลหะ
      { productId: sku, metal: "platinum" },
      { productId: sku, metal: "gold", purity: 0.374 },
      { productId: sku, metal: "gold", purity: 1.0001 },
      { productId: sku, metal: "gold", purity: Number.NaN },
      { productId: sku, metal: "gold", purity: Number.POSITIVE_INFINITY },
      { productId: sku, metal: "gold", purity: 0.37501 }, // ทศนิยมเกิน 4
      { productId: sku, metal: "brass", purity: 0.925 }, // ทองเหลืองล็อก 1
      { productId: sku, weightG: 0, weightSource: "input" },
      { productId: sku, weightG: -1, weightSource: "input" },
      { productId: sku, weightG: 10000.001, weightSource: "input" },
      { productId: sku, weightG: 3.2001, weightSource: "input" },
      { productId: sku, weightG: Number.NaN, weightSource: "input" },
      { productId: sku, weightG: 3 }, // มี weight ไม่มี source
      { productId: sku, weightSource: "input" }, // มี source ไม่มี weight
      { productId: sku, weightG: 3, weightSource: "typed" },
      { productId: sku, weightG: 3, weightSource: "input", clearWeight: true },
      { productId: sku, qtyPlanned: 0 },
      { productId: sku, qtyPlanned: 100001 },
      { productId: sku, qtyPlanned: 1.5 },
    ];
    for (const c of cases) {
      const result = await setProductionOrderItem({ productionOrderId: "po-1", qtyPlanned: 5, ...c } as never);
      expect(result.ok, JSON.stringify(c)).toBe(false);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("0186: accepts the boundary values (purity 0.375 / 1 · weight 10000 / 0.001 · label 200 chars) — must not break", async () => {
    rpcMock.mockResolvedValue(ITEM_SET_RPC_OK);
    const { setProductionOrderItem } = await import("./production");
    const sku = "11111111-1111-4111-8111-111111111111";
    for (const c of [
      { productId: sku, metal: "gold", purity: 0.375 },
      { productId: sku, metal: "gold", purity: 1 },
      { productId: sku, metal: "brass", purity: 1 },
      { productId: sku, weightG: 10000, weightSource: "input" },
      { productId: sku, weightG: 0.001, weightSource: "product" },
      { pendingProductLabel: "ก".repeat(200), metal: "silver" },
    ]) {
      const result = await setProductionOrderItem({ productionOrderId: "po-1", qtyPlanned: 5, ...c } as never);
      expect(result.ok, JSON.stringify(c)).toBe(true);
    }
  });
});

describe("removeProductionOrderItemById (0186)", () => {
  it("rejects staff / bad uuid before any RPC; sends p_item_id on success", async () => {
    const { removeProductionOrderItemById } = await import("./production");
    expect((await removeProductionOrderItemById({ productionOrderId: "po-1", itemId: "not-a-uuid" })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    rpcMock.mockResolvedValue({ data: null, error: null });
    const ok = await removeProductionOrderItemById({ productionOrderId: "po-1", itemId: "22222222-2222-4222-8222-222222222222" });
    expect(ok.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("production_order_item_remove_by_id", {
      p_shop_id: "shop-1",
      p_production_order_id: "po-1",
      p_item_id: "22222222-2222-4222-8222-222222222222",
    });
    getEffectiveRoleMock.mockResolvedValue("staff");
    rpcMock.mockClear();
    expect((await removeProductionOrderItemById({ productionOrderId: "po-1", itemId: "22222222-2222-4222-8222-222222222222" })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("surfaces the DB's job_exists message (with the job number) instead of the generic fallback", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", message: "production_order_item_remove_by_id: ลบรายการไม่ได้ — มีใบงาน JB-0031 ผูกอยู่ (ใบงานเก็บไว้เป็นหลักฐาน)" } });
    const { removeProductionOrderItemById } = await import("./production");
    const result = await removeProductionOrderItemById({ productionOrderId: "po-1", itemId: "22222222-2222-4222-8222-222222222222" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("JB-0031");
  });
});

describe("getProductionItemPrefill (0186)", () => {
  it("rejects staff / bad uuid; maps the server-decided defaults incl. metalKnown (never computed client-side)", async () => {
    const { getProductionItemPrefill } = await import("./production");
    expect((await getProductionItemPrefill("nope")).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    rpcMock.mockResolvedValue({
      data: { product_id: "11111111-1111-4111-8111-111111111111", sku: "S-1bath", name: "แท่ง", cost_type: "spot", metal: "silver", purity: "0.9990", weight_g: "15.244", weight_source: "product", metal_known: true },
      error: null,
    });
    const result = await getProductionItemPrefill("11111111-1111-4111-8111-111111111111");
    expect(rpcMock).toHaveBeenCalledWith("production_item_prefill", { p_shop_id: "shop-1", p_product_id: "11111111-1111-4111-8111-111111111111" });
    expect(result).toEqual({
      ok: true,
      data: { productId: "11111111-1111-4111-8111-111111111111", sku: "S-1bath", name: "แท่ง", costType: "spot", metal: "silver", purity: 0.999, weightG: 15.244, weightSource: "product", metalKnown: true },
    });
  });

  it("metalKnown is false unless the RPC says exactly true (null/missing = neutral message, not a warning)", async () => {
    rpcMock.mockResolvedValue({
      data: { product_id: "11111111-1111-4111-8111-111111111111", sku: "R-1", name: "แหวน", cost_type: "fixed", metal: "silver", purity: 0.925, weight_g: null, weight_source: null, metal_known: null },
      error: null,
    });
    const { getProductionItemPrefill } = await import("./production");
    const result = await getProductionItemPrefill("11111111-1111-4111-8111-111111111111");
    expect(result.ok && result.data).toMatchObject({ metalKnown: false, weightG: null, weightSource: null });
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
        // 0186: RPC เก่า/ใบ fixed ล้วนไม่มี metal_prices → {}
        metalPrices: {},
        items: [
          {
            productId: "11111111-1111-4111-8111-111111111111",
            sku: "SKU-1",
            qtyDone: 5,
            unitCost: 123.45,
            prevCostType: "spot",
            prevUnitCost: 100,
            // 0141/0142: costCalc is null here because the mocked RPC response
            // above doesn't include a `cost_calc` field on this item (it's a
            // spot-mode line — the RPC itself always returns null for
            // fixed/spot, see parseProductionSpecCostCalc's own null-input test).
            costCalc: null,
            // 0186: ไม่มี key โลหะ/เนื้อ/น้ำหนักใน response (แถวเดิม/RPC เก่า) → null ทั้งหมด ไม่ throw
            metal: null,
            purity: null,
            weightG: null,
          },
        ],
      },
    });
  });

  it("0186: maps metal/purity/weight_g per item + metal_prices of the order (the snapshot the RPC locked)", async () => {
    rpcMock.mockResolvedValue({
      data: {
        production_order_id: "po-1",
        po_no: "PO-0001",
        status: "done",
        already_done: false,
        metal_prices: { silver: 72, gold: "2804.1271", platinum: 5 },
        items: [
          { product_id: "11111111-1111-4111-8111-111111111111", sku: "SKU-1", qty_done: 5, unit_cost: 1, prev_cost_type: "spot", prev_unit_cost: 1, cost_calc: null, metal: "gold", purity: "0.9000", weight_g: "3.200" },
        ],
      },
      error: null,
    });
    const { doneProductionOrder } = await import("./production");
    const result = await doneProductionOrder({ productionOrderId: "po-1", items: [{ productId: "11111111-1111-4111-8111-111111111111", qtyDone: 5 }] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.metalPrices).toEqual({ silver: 72, gold: 2804.1271 }); // key นอก 3 โลหะถูกทิ้ง
      expect(result.data.items[0]).toMatchObject({ metal: "gold", purity: 0.9, weightG: 3.2 });
    }
  });

  // 0132 M1 → 0186 ต่อโลหะ — expectedMetalPrices ต้องถึง RPC ตรงตัว (ไม่เติมโลหะที่หน้าจอไม่ได้เห็น) · ช่องทางเดิม
  // expectedSpotThbPerGram แปลงเป็น {silver} · validate แค่ให้ตัดค่าขยะ (NaN/Infinity/key แปลก/ศูนย์/ติดลบ) ก่อนถึง DB
  it("passes expectedSpotThbPerGram (legacy channel) as p_expected_metal_prices = {silver}", async () => {
    rpcMock.mockResolvedValue(DONE_RPC_OK);
    const { doneProductionOrder } = await import("./production");
    await doneProductionOrder({
      productionOrderId: "po-1",
      items: [{ productId: "11111111-1111-4111-8111-111111111111", qtyDone: 5 }],
      expectedSpotThbPerGram: 70.25,
    });
    expect(rpcMock).toHaveBeenCalledWith("production_order_done", expect.objectContaining({ p_expected_metal_prices: { silver: 70.25 } }));
    // ไม่เหลือ arg เดิมที่ DB ไม่มีแล้ว (signature เดิมถูก drop — ส่งไปเท่ากับ PGRST202)
    expect(rpcMock.mock.calls[0][1]).not.toHaveProperty("p_expected_spot_thb_per_gram");
  });

  it("passes expectedMetalPrices verbatim (per metal) and wins over expectedSpotThbPerGram", async () => {
    rpcMock.mockResolvedValue(DONE_RPC_OK);
    const { doneProductionOrder } = await import("./production");
    await doneProductionOrder({
      productionOrderId: "po-1",
      items: [{ productId: "11111111-1111-4111-8111-111111111111", qtyDone: 5 }],
      expectedMetalPrices: { silver: 72, gold: 2804.1271 },
      expectedSpotThbPerGram: 1,
    });
    expect(rpcMock).toHaveBeenCalledWith("production_order_done", expect.objectContaining({ p_expected_metal_prices: { silver: 72, gold: 2804.1271 } }));
  });

  it("defaults p_expected_metal_prices to null when nothing is provided (DB fail-closes if the order needs a price)", async () => {
    rpcMock.mockResolvedValue(DONE_RPC_OK);
    const { doneProductionOrder } = await import("./production");
    await doneProductionOrder({
      productionOrderId: "po-1",
      items: [{ productId: "11111111-1111-4111-8111-111111111111", qtyDone: 5 }],
    });
    expect(rpcMock).toHaveBeenCalledWith("production_order_done", expect.objectContaining({ p_expected_metal_prices: null }));
  });

  it("sends {} for a fixed-only order (preview.metalPrices = {}) — not null, not an invented silver price", async () => {
    rpcMock.mockResolvedValue(DONE_RPC_OK);
    const { doneProductionOrder } = await import("./production");
    await doneProductionOrder({
      productionOrderId: "po-1",
      items: [{ productId: "11111111-1111-4111-8111-111111111111", qtyDone: 5 }],
      expectedMetalPrices: {},
    });
    expect(rpcMock).toHaveBeenCalledWith("production_order_done", expect.objectContaining({ p_expected_metal_prices: {} }));
  });

  it("rejects malformed expectedMetalPrices (unknown metal / NaN / Infinity / 0 / negative / array) before calling the RPC", async () => {
    const { doneProductionOrder } = await import("./production");
    const items = [{ productId: "11111111-1111-4111-8111-111111111111", qtyDone: 5 }];
    const bad: unknown[] = [{ platinum: 5 }, { gold: Number.NaN }, { gold: Number.POSITIVE_INFINITY }, { gold: 0 }, { silver: -1 }, { gold: "2804" }, [72]];
    for (const expectedMetalPrices of bad) {
      const result = await doneProductionOrder({ productionOrderId: "po-1", items, expectedMetalPrices: expectedMetalPrices as never });
      expect(result.ok).toBe(false);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a non-finite expectedSpotThbPerGram (NaN/Infinity) before calling the RPC", async () => {
    const { doneProductionOrder } = await import("./production");
    const result = await doneProductionOrder({
      productionOrderId: "po-1",
      items: [{ productId: "11111111-1111-4111-8111-111111111111", qtyDone: 5 }],
      expectedSpotThbPerGram: Infinity,
    });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  // 0132 M4 — same actor plumbing as saveProductionOrder above.
  it("passes the session user's id as p_actor when a session exists", async () => {
    rpcMock.mockResolvedValue(DONE_RPC_OK);
    getSessionUserMock.mockResolvedValue({ id: "user-42", email: "owner@example.com" });
    const { doneProductionOrder } = await import("./production");
    await doneProductionOrder({
      productionOrderId: "po-1",
      items: [{ productId: "11111111-1111-4111-8111-111111111111", qtyDone: 5 }],
    });
    expect(rpcMock).toHaveBeenCalledWith("production_order_done", expect.objectContaining({ p_actor: "user-42" }));
  });

  it("passes p_actor: null when there is no session", async () => {
    rpcMock.mockResolvedValue(DONE_RPC_OK);
    const { doneProductionOrder } = await import("./production");
    await doneProductionOrder({
      productionOrderId: "po-1",
      items: [{ productId: "11111111-1111-4111-8111-111111111111", qtyDone: 5 }],
    });
    expect(rpcMock).toHaveBeenCalledWith("production_order_done", expect.objectContaining({ p_actor: null }));
  });
});

// 0141/0142 (task brief 2b) — production_order_preview now takes an optional
// p_items override so a cost_type='spec' line's re-preview (after the user
// edits a qty in ProductionDoneDialog) is costed with the SAME qty that
// doneProductionOrder will stamp — "เคสห้ามผ่าน #3" hinges on both call
// sites building p_items the exact same way.
describe("previewProductionOrder", () => {
  const PREVIEW_RPC_OK = {
    data: { production_order_id: "po-1", po_no: "PO-0001", spot_price_thb_per_gram: 67.7, items: [] },
    error: null,
  };

  it("sends p_items as null when items is omitted (unchanged pre-0141 behavior — every line costed at qty_planned)", async () => {
    rpcMock.mockResolvedValue(PREVIEW_RPC_OK);
    const { previewProductionOrder } = await import("./production");
    await previewProductionOrder("po-1");
    expect(rpcMock).toHaveBeenCalledWith("production_order_preview", expect.objectContaining({ p_items: null }));
  });

  it("sends p_items as null when items is an empty array", async () => {
    rpcMock.mockResolvedValue(PREVIEW_RPC_OK);
    const { previewProductionOrder } = await import("./production");
    await previewProductionOrder("po-1", []);
    expect(rpcMock).toHaveBeenCalledWith("production_order_preview", expect.objectContaining({ p_items: null }));
  });

  it("maps items to snake_case p_items when provided", async () => {
    rpcMock.mockResolvedValue(PREVIEW_RPC_OK);
    const { previewProductionOrder } = await import("./production");
    await previewProductionOrder("po-1", [
      { productId: "11111111-1111-4111-8111-111111111111", qtyDone: 3 },
      { productId: "22222222-2222-4222-8222-222222222222", qtyDone: 0 },
    ]);
    expect(rpcMock).toHaveBeenCalledWith(
      "production_order_preview",
      expect.objectContaining({
        p_items: [
          { product_id: "11111111-1111-4111-8111-111111111111", qty_done: 3 },
          { product_id: "22222222-2222-4222-8222-222222222222", qty_done: 0 },
        ],
      })
    );
  });

  it("rejects a malformed items array (dup product_id) before calling the RPC", async () => {
    const { previewProductionOrder } = await import("./production");
    const result = await previewProductionOrder("po-1", [
      { productId: "11111111-1111-4111-8111-111111111111", qtyDone: 3 },
      { productId: "11111111-1111-4111-8111-111111111111", qtyDone: 5 },
    ]);
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("maps the RPC's snake_case item fields (qty_used/is_new_design/cost_calc/skipped/nullable unit_cost) to camelCase", async () => {
    rpcMock.mockResolvedValue({
      data: {
        production_order_id: "po-1",
        po_no: "PO-0001",
        spot_price_thb_per_gram: 67.7,
        items: [
          {
            item_id: "item-1",
            product_id: "11111111-1111-4111-8111-111111111111",
            sku: "R-0099",
            cost_type: "spec",
            silver_weight_g: 3.5,
            silver_purity: 0.925,
            labor_cost: null,
            spot_price_thb_per_gram: 67.7,
            prev_cost_type: "spec",
            prev_unit_cost: null,
            unit_cost: 305.07,
            qty_planned: 5,
            qty_used: 5,
            is_new_design: false,
            cost_calc: { is_complete: true, metal_per_piece: 100, labor_per_piece: 150, batch_per_piece: 55.07, cost_piece: 305.07, unit_cost: 305.07, qty: 5 },
          },
          {
            item_id: "item-2",
            product_id: "22222222-2222-4222-8222-222222222222",
            sku: "R-0100",
            cost_type: "fixed",
            silver_weight_g: null,
            silver_purity: 0.925,
            labor_cost: null,
            spot_price_thb_per_gram: null,
            prev_cost_type: "fixed",
            prev_unit_cost: null,
            unit_cost: null,
            qty_planned: 2,
            qty_used: 0,
            is_new_design: false,
            cost_calc: null,
            skipped: true,
          },
        ],
      },
      error: null,
    });
    const { previewProductionOrder } = await import("./production");
    const result = await previewProductionOrder("po-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items[0]).toMatchObject({ qtyUsed: 5, isNewDesign: false, skipped: false, unitCost: 305.07 });
    expect(result.data.items[0].costCalc).toMatchObject({ isComplete: true, unitCost: 305.07, qty: 5 });
    expect(result.data.items[1]).toMatchObject({ qtyUsed: 0, unitCost: null, costCalc: null, skipped: true });
    // 0186: RPC เก่า (ไม่มี metal_prices/missing_prices/metal ต่อรายการ) ต้องไม่ throw — ค่าใหม่ว่างทั้งหมด
    expect(result.data.metalPrices).toEqual({});
    expect(result.data.missingPrices).toEqual([]);
    expect(result.data.items[0]).toMatchObject({ priceMissing: false, metal: null, purity: null, weightG: null, weightSource: null });
  });

  it("0186 (R3): maps metal_prices / missing_prices / per-item price_missing + metal/purity/weight — the gold line has NO invented cost", async () => {
    rpcMock.mockResolvedValue({
      data: {
        production_order_id: "po-1",
        po_no: "PO-0001",
        spot_price_thb_per_gram: 72,
        metal_prices: { silver: 72, platinum: 9 },
        missing_prices: ["gold", "unobtanium"],
        items: [
          { item_id: "i-1", product_id: "11111111-1111-4111-8111-111111111111", sku: "S-1", cost_type: "spot", silver_weight_g: 10, silver_purity: 0.925, labor_cost: 20, spot_price_thb_per_gram: 72, prev_cost_type: "spot", prev_unit_cost: null, unit_cost: 686, qty_planned: 5, qty_used: 5, is_new_design: false, cost_calc: null, metal: "silver", purity: "0.9250", weight_g: "10.000", weight_source: "product" },
          { item_id: "i-2", product_id: "22222222-2222-4222-8222-222222222222", sku: "G-1", cost_type: "spot", unit_cost: null, price_missing: true, qty_planned: 2, qty_used: 2, is_new_design: false, cost_calc: null, metal: "gold", purity: "0.9000", weight_g: "3.200", weight_source: "input" },
        ],
      },
      error: null,
    });
    const { previewProductionOrder } = await import("./production");
    const result = await previewProductionOrder("po-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.metalPrices).toEqual({ silver: 72 }); // key นอก 3 โลหะถูกทิ้ง
    expect(result.data.missingPrices).toEqual(["gold"]); // ค่านอก 3 โลหะถูกทิ้ง
    expect(result.data.spotPriceThbPerGram).toBe(72);
    expect(result.data.items[0]).toMatchObject({ unitCost: 686, priceMissing: false, metal: "silver", purity: 0.925, weightG: 10, weightSource: "product" });
    expect(result.data.items[1]).toMatchObject({ unitCost: null, priceMissing: true, metal: "gold", purity: 0.9, weightG: 3.2, weightSource: "input" });
  });

  it("0186: surfaces the DB's sku_required message (Thai, 22023) instead of the generic fallback", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", message: "production_order_preview: ใบ PO-0034 มีรายการที่ยังไม่ผูก SKU — ผูก SKU ให้ครบก่อน ระบบถึงคิดต้นทุนและเข้าสต็อกได้" } });
    const { previewProductionOrder } = await import("./production");
    const result = await previewProductionOrder("po-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("ยังไม่ผูก SKU");
  });
});

// 0141: make_spec/is_new_design/cost_calc side-channel reads (neither view
// exposes them — see the migration's own header for why they were left out
// of v_production_order_item).
describe("getProductionOrder — 0141 make_spec/cost_calc side-channel", () => {
  it("attaches make_spec only to the cost_type='spec' item, and cost_calc/is_new_design per item", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "v_production_order") {
        return queryBuilder({
          data: {
            id: "po-1",
            po_no: "PO-0001",
            status: "done",
            note: null,
            spot_override_thb_per_gram: null,
            done_at: "2026-09-19T00:00:00Z",
            cancelled_at: null,
            cancel_reason: null,
            created_at: "2026-09-18T00:00:00Z",
            updated_at: "2026-09-19T00:00:00Z",
            item_count: 2,
            qty_planned_total: 7,
            qty_done_total: 7,
          },
          error: null,
        });
      }
      if (table === "v_production_order_item") {
        return queryBuilder({
          data: [
            {
              id: "item-1",
              production_order_id: "po-1",
              po_no: "PO-0001",
              order_status: "done",
              product_id: "11111111-1111-4111-8111-111111111111",
              sku: "R-0099",
              product_name: "แหวนเงินแท้",
              current_cost_type: "spec",
              current_unit_cost: null,
              qty_planned: 5,
              qty_done: 5,
              stamped_unit_cost: 305.07,
              prev_cost_type: "spec",
              prev_unit_cost: null,
              created_at: "2026-09-18T00:00:00Z",
              updated_at: "2026-09-19T00:00:00Z",
            },
            {
              id: "item-2",
              production_order_id: "po-1",
              po_no: "PO-0001",
              order_status: "done",
              product_id: "22222222-2222-4222-8222-222222222222",
              sku: "R-0100",
              product_name: "จี้เงินแท้",
              current_cost_type: "fixed",
              current_unit_cost: 200,
              qty_planned: 2,
              qty_done: 2,
              stamped_unit_cost: 200,
              prev_cost_type: "fixed",
              prev_unit_cost: 200,
              created_at: "2026-09-18T00:00:00Z",
              updated_at: "2026-09-19T00:00:00Z",
            },
          ],
          error: null,
        });
      }
      if (table === "product") {
        return queryBuilder({
          data: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              make_spec: { metal: "silver", item_kind: "แหวน", polish_tier: "ละเอียด", plating_type: null, gem_tier: null, gem_count: 0 },
              silver_weight_g: 3.5,
              silver_purity: 0.925,
            },
            { id: "22222222-2222-4222-8222-222222222222", make_spec: null, silver_weight_g: null, silver_purity: 0.925 },
          ],
          error: null,
        });
      }
      if (table === "production_order_item") {
        return queryBuilder({
          data: [
            {
              id: "item-1",
              is_new_design: false,
              cost_calc: { is_complete: true, metal_per_piece: 100, labor_per_piece: 150, batch_per_piece: 55.07, cost_piece: 305.07, unit_cost: 305.07, qty: 5 },
            },
            { id: "item-2", is_new_design: false, cost_calc: null },
          ],
          error: null,
        });
      }
      return queryBuilder({ data: [], error: null });
    });

    const { getProductionOrder } = await import("./production");
    const result = await getProductionOrder("po-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const spec = result.data.items.find((i) => i.sku === "R-0099");
    expect(spec?.makeSpec).toEqual({ metal: "silver", itemKind: "แหวน", polishTier: "ละเอียด", platingType: null, gemTier: null, gemCount: 0 });
    expect(spec?.costCalc).toMatchObject({ isComplete: true, unitCost: 305.07 });

    const fixed = result.data.items.find((i) => i.sku === "R-0100");
    // fixed-mode item must NOT get a make_spec even though it happens to
    // share a product-table row shape — makeSpec is gated on currentCostType
    expect(fixed?.makeSpec).toBeNull();
    expect(fixed?.costCalc).toBeNull();
  });

  // 0186: แถวเดิมก่อน 0186 (คอลัมน์ใหม่ null) + รายการไม่มี SKU (product_id null) ผ่านวิวใหม่ (left join) มาถึงหน้าจอครบ
  it("0186: maps pending-label items (product_id null) and legacy rows (new columns null) without throwing", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "v_production_order") {
        return queryBuilder({
          data: { id: "po-1", po_no: "PO-0001", status: "open", note: null, spot_override_thb_per_gram: null, done_at: null, cancelled_at: null, cancel_reason: null, created_at: "2026-10-20T00:00:00Z", updated_at: "2026-10-20T00:00:00Z", item_count: 2, qty_planned_total: 7, qty_done_total: 0 },
          error: null,
        });
      }
      if (table === "v_production_order_item") {
        return queryBuilder({
          data: [
            // แถวเดิม (ก่อน 0186): คอลัมน์ใหม่ null · effective มาจาก helper ฝั่ง DB
            {
              id: "item-1", production_order_id: "po-1", po_no: "PO-0001", order_status: "open", product_id: "11111111-1111-4111-8111-111111111111", sku: "S-10bath", product_name: "แท่ง 10 บาท",
              current_cost_type: "spot", current_unit_cost: null, qty_planned: 5, qty_done: null, stamped_unit_cost: null, prev_cost_type: null, prev_unit_cost: null, created_at: "2026-10-20T00:00:00Z", updated_at: "2026-10-20T00:00:00Z",
              pending_product_label: null, metal: null, purity: null, weight_g: null, weight_source: null,
              effective_metal: "silver", effective_purity: "0.9990", effective_weight_g: "152.440", effective_weight_source: "product",
              sku_metal: "silver", sku_purity: "0.9990", sku_weight_g: "152.440", sku_metal_known: true,
            },
            // รายการไม่มี SKU: product_id/sku/ชื่อ/ชนิดต้นทุน = null · มีชื่อแบบ + โลหะทอง
            {
              id: "item-2", production_order_id: "po-1", po_no: "PO-0001", order_status: "open", product_id: null, sku: null, product_name: null,
              current_cost_type: null, current_unit_cost: null, qty_planned: 2, qty_done: null, stamped_unit_cost: null, prev_cost_type: null, prev_unit_cost: null, created_at: "2026-10-20T00:00:01Z", updated_at: "2026-10-20T00:00:01Z",
              pending_product_label: "แหวนทองลายใบไม้", metal: "gold", purity: "0.9000", weight_g: "3.200", weight_source: "input",
              effective_metal: "gold", effective_purity: "0.9000", effective_weight_g: "3.200", effective_weight_source: "input",
              sku_metal: null, sku_purity: null, sku_weight_g: null, sku_metal_known: null,
            },
          ],
          error: null,
        });
      }
      if (table === "product") {
        return queryBuilder({ data: [{ id: "11111111-1111-4111-8111-111111111111", make_spec: null, silver_weight_g: 152.44, silver_purity: 0.999 }], error: null });
      }
      return queryBuilder({ data: [], error: null });
    });
    const { getProductionOrder } = await import("./production");
    const result = await getProductionOrder("po-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [legacy, pending] = result.data.items;
    expect(legacy).toMatchObject({
      productId: "11111111-1111-4111-8111-111111111111",
      sku: "S-10bath",
      pendingProductLabel: null,
      metal: null, purity: null, weightG: null, weightSource: null,
      effectiveMetal: "silver", effectivePurity: 0.999, effectiveWeightG: 152.44, effectiveWeightSource: "product",
      skuMetal: "silver", skuPurity: 0.999, skuWeightG: 152.44, skuMetalKnown: true,
      currentSilverWeightG: 152.44,
    });
    expect(pending).toMatchObject({
      productId: null, sku: null, productName: null, currentCostType: null,
      pendingProductLabel: "แหวนทองลายใบไม้",
      metal: "gold", purity: 0.9, weightG: 3.2, weightSource: "input",
      effectiveMetal: "gold", effectivePurity: 0.9, effectiveWeightG: 3.2,
      skuMetal: null, skuPurity: null, skuWeightG: null,
      skuMetalKnown: false, // null จาก DB ต้องเป็น false จริง (ไม่ใช่ undefined/null) — UI เทียบ === false ได้
      makeSpec: null, currentSilverWeightG: null, currentSilverPurity: null,
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
