// getProductionOrders — unboundItemCount (PM-B ป้าย "ยังไม่ผูก SKU n")
// ต้องถูก: นับรายการ product_id null ต่อใบ · อ่านเฉพาะใบ open ที่อยู่ในรายการ (.in) แบ่งก้อนละ 100 · เรียงด้วย id (unique) แล้วอ่านผ่าน fetchAllRows (กันตัด 1,000 แถวเงียบ)
// ต้องไม่พัง: อ่านนับไม่ได้ = รายการใบผลิตยังโหลดได้ (ป้ายหาย ไม่ล้มทั้งหน้า) · staff ถูกกัน · ไม่มีใบ open = ไม่ยิง query นับ
import { beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const roleMock = vi.fn();
let orders: Record<string, unknown>[] = [];
let unboundResult: { data: unknown; error: unknown } = { data: [], error: null };
let itemsFn: ((ids: string[]) => unknown[]) | null = null;
const itemCalls: Array<Array<[string, ...unknown[]]>> = [];

function builder(table: string) {
  const ops: Array<[string, ...unknown[]]> = [];
  if (table === "production_order_item") itemCalls.push(ops);
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "order", "range", "limit"]) b[m] = (...a: unknown[]) => (ops.push([m, ...a]), b);
  b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
    let res: { data: unknown; error: unknown };
    if (table === "v_production_order") res = { data: orders, error: null };
    else {
      const inOp = ops.find((o) => o[0] === "in");
      res = itemsFn && inOp ? { data: itemsFn(inOp[2] as string[]), error: null } : unboundResult;
    }
    return Promise.resolve(res).then(ok, bad);
  };
  return b;
}

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => roleMock() }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => null }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ from: (t: string) => builder(t) }) }) }));
// fetchAllRows จริงเพจ .range() หลายหน้า — ที่นี่จำลองหน้าเดียวพอ (โลจิกเพจมีเทสของมันเองใน query-limits) · error ต้อง throw เหมือนของจริง
vi.mock("@/lib/supabase/query-limits", () => ({
  fetchAllRows: async (fn: (a: number, b: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>) => {
    const r = await fn(0, 999);
    if (r.error) throw r.error;
    return { rows: r.data ?? [], totalCount: (r.data ?? []).length, truncated: false };
  },
}));

import { getProductionOrders } from "./production";

const mkOrder = (id: string, status = "open") => ({
  id, po_no: id.toUpperCase(), status, note: null, spot_override_thb_per_gram: null, done_at: null, cancelled_at: null, cancel_reason: null,
  created_at: "2026-10-20T00:00:00Z", updated_at: "2026-10-20T00:00:00Z", item_count: 1, qty_planned_total: 5, qty_done_total: 0,
});

beforeEach(() => {
  roleMock.mockReset().mockResolvedValue("owner");
  orders = [mkOrder("o1"), mkOrder("o2")];
  unboundResult = { data: [], error: null };
  itemsFn = null;
  itemCalls.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getProductionOrders.unboundItemCount", () => {
  it("นับรายการ product_id null ต่อใบ · ใบที่ไม่มี = 0 · query ผูก shop + is(product_id, null) + order id", async () => {
    unboundResult = { data: [{ id: "a", production_order_id: "o1" }, { id: "b", production_order_id: "o1" }], error: null };
    const r = await getProductionOrders();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.rows.map((x) => [x.id, x.unboundItemCount])).toEqual([["o1", 2], ["o2", 0]]);
    const ops = itemCalls[0];
    expect(ops).toContainEqual(["eq", "shop_id", SHOP]);
    expect(ops).toContainEqual(["is", "product_id", null]);
    expect(ops).toContainEqual(["order", "id", { ascending: true }]);
    expect(ops.find((o) => o[0] === "select")?.[2]).toEqual({ count: "exact" });
  });

  it("อ่านเฉพาะใบ open ที่อยู่ในรายการ: done/cancelled ไม่เข้า .in() และได้ 0 แม้มีรายการค้าง", async () => {
    orders = [mkOrder("o1"), mkOrder("o2", "done"), mkOrder("o3", "cancelled")];
    itemsFn = (ids) => ids.map((id) => ({ id: `x-${id}`, production_order_id: id }));
    const r = await getProductionOrders();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(itemCalls).toHaveLength(1);
    expect(itemCalls[0].find((o) => o[0] === "in")).toEqual(["in", "production_order_id", ["o1"]]);
    expect(r.data.rows.map((x) => [x.id, x.unboundItemCount])).toEqual([["o1", 1], ["o2", 0], ["o3", 0]]);
  });

  it("ใบ open เยอะ → แบ่ง .in() ก้อนละ 100 (250 ใบ = 3 query) และรวมผลครบทุกก้อน", async () => {
    orders = Array.from({ length: 250 }, (_, i) => mkOrder(`o${i}`));
    itemsFn = (ids) => ids.map((id) => ({ id: `x-${id}`, production_order_id: id }));
    const r = await getProductionOrders();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(itemCalls).toHaveLength(3);
    expect(itemCalls.map((c) => (c.find((o) => o[0] === "in")?.[2] as string[]).length)).toEqual([100, 100, 50]);
    expect(r.data.rows.every((x) => x.unboundItemCount === 1)).toBe(true);
  });

  it("ไม่มีใบ open เลย → ไม่ยิง query นับ", async () => {
    orders = [mkOrder("o1", "done")];
    const r = await getProductionOrders();
    expect(r.ok).toBe(true);
    expect(itemCalls).toHaveLength(0);
  });

  it("อ่านนับล้มเหลว → รายการใบผลิตยังโหลดได้ (ป้ายหาย ทุกใบ 0) ไม่ล้มทั้งหน้า", async () => {
    unboundResult = { data: null, error: { message: "boom", code: "XX000" } };
    const r = await getProductionOrders();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.rows.every((x) => x.unboundItemCount === 0)).toBe(true);
  });

  it("staff ถูกกัน (ไม่อ่านอะไร)", async () => {
    roleMock.mockResolvedValue("staff");
    const r = await getProductionOrders();
    expect(r.ok).toBe(false);
    expect(itemCalls).toHaveLength(0);
  });
});
