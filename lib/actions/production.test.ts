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
      data: { id: "item-1", productId: "11111111-1111-4111-8111-111111111111", sku: "R-0099", name: "แหวนเงินแท้", qtyPlanned: 5, isNewDesign: true },
    });
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
          },
        ],
      },
    });
  });

  // 0132 M1 — expectedSpotThbPerGram must reach the RPC verbatim (null when
  // omitted, so old callers behave exactly like 0131), and be validated
  // client-side just enough to reject non-finite garbage (NaN/Infinity)
  // before it ever reaches the DB comparison.
  it("passes expectedSpotThbPerGram through to p_expected_spot_thb_per_gram", async () => {
    rpcMock.mockResolvedValue(DONE_RPC_OK);
    const { doneProductionOrder } = await import("./production");
    await doneProductionOrder({
      productionOrderId: "po-1",
      items: [{ productId: "11111111-1111-4111-8111-111111111111", qtyDone: 5 }],
      expectedSpotThbPerGram: 70.25,
    });
    expect(rpcMock).toHaveBeenCalledWith(
      "production_order_done",
      expect.objectContaining({ p_expected_spot_thb_per_gram: 70.25 })
    );
  });

  it("defaults p_expected_spot_thb_per_gram to null when expectedSpotThbPerGram is omitted", async () => {
    rpcMock.mockResolvedValue(DONE_RPC_OK);
    const { doneProductionOrder } = await import("./production");
    await doneProductionOrder({
      productionOrderId: "po-1",
      items: [{ productId: "11111111-1111-4111-8111-111111111111", qtyDone: 5 }],
    });
    expect(rpcMock).toHaveBeenCalledWith(
      "production_order_done",
      expect.objectContaining({ p_expected_spot_thb_per_gram: null })
    );
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
