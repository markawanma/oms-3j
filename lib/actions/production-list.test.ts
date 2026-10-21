// getProductionOrders — unboundItemCount (ป้าย "ยังไม่ผูก SKU n") · 0187: อ่านจาก v_production_order.unbound_item_count ที่เดียว (นับที่ DB)
// ต้องถูก: map คอลัมน์จาก view ตรงๆ · select ขอคอลัมน์ unbound_item_count · ไม่ยิง query นับรายการเองอีก (ไม่ไปแตะตาราง production_order_item)
// ต้องไม่พัง: ค่าว่าง/แปลก = 0 · staff ถูกกัน
import { beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const roleMock = vi.fn();
let orders: Record<string, unknown>[] = [];
const tables: string[] = [];
const selects: string[] = [];

function builder(table: string) {
  tables.push(table);
  const b: Record<string, unknown> = {};
  for (const m of ["eq", "is", "in", "order", "range", "limit"]) b[m] = () => b;
  b.select = (cols: string) => (selects.push(cols), b);
  b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve({ data: table === "v_production_order" ? orders : [], error: null }).then(ok, bad);
  return b;
}

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => roleMock() }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => null }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ from: (t: string) => builder(t) }) }) }));
// fetchAllRows จริงเพจ .range() หลายหน้า — ที่นี่จำลองหน้าเดียวพอ (โลจิกเพจมีเทสของมันเองใน query-limits)
vi.mock("@/lib/supabase/query-limits", () => ({
  fetchAllRows: async (fn: (a: number, b: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>) => {
    const r = await fn(0, 999);
    if (r.error) throw r.error;
    return { rows: r.data ?? [], totalCount: (r.data ?? []).length, truncated: false };
  },
}));

import { getProductionOrders } from "./production";

const mkOrder = (id: string, over: Record<string, unknown> = {}) => ({
  id, po_no: id.toUpperCase(), status: "open", note: null, spot_override_thb_per_gram: null, done_at: null, cancelled_at: null, cancel_reason: null,
  created_at: "2026-10-20T00:00:00Z", updated_at: "2026-10-20T00:00:00Z", item_count: 1, qty_planned_total: 5, qty_done_total: 0,
  opened_via: "office", opened_by_worker_name: null, acknowledged_at: null, unbound_item_count: 0, ...over,
});

beforeEach(() => {
  roleMock.mockReset().mockResolvedValue("owner");
  orders = [mkOrder("o1", { unbound_item_count: 2 }), mkOrder("o2")];
  tables.length = 0;
  selects.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getProductionOrders.unboundItemCount (0187: คอลัมน์จาก v_production_order ที่เดียว)", () => {
  it("map unbound_item_count ตรงๆ · ขอคอลัมน์นี้ใน select · ไม่ยิงตารางรายการ (ไม่นับเองฝั่ง TS)", async () => {
    const r = await getProductionOrders();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.rows.map((x) => [x.id, x.unboundItemCount])).toEqual([["o1", 2], ["o2", 0]]);
    expect(selects).toHaveLength(1);
    expect(selects[0]).toContain("unbound_item_count");
    expect(tables).toEqual(["v_production_order"]);
  });

  it("ใบเยอะ: ค่าต่อใบมาจาก view ทุกใบ (ไม่แบ่งก้อน ไม่ยิงเพิ่ม)", async () => {
    orders = Array.from({ length: 250 }, (_, i) => mkOrder(`o${i}`, { unbound_item_count: 1 }));
    const r = await getProductionOrders();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.rows.every((x) => x.unboundItemCount === 1)).toBe(true);
    expect(tables).toEqual(["v_production_order"]);
  });

  it("ค่าว่าง/แปลก (null · ข้อความ · NaN) = 0 · ไม่ล้มทั้งหน้า", async () => {
    orders = [mkOrder("a", { unbound_item_count: null }), mkOrder("b", { unbound_item_count: "x" }), mkOrder("c", { unbound_item_count: Number.NaN }), mkOrder("d", { unbound_item_count: "3" })];
    const r = await getProductionOrders();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.rows.map((x) => x.unboundItemCount)).toEqual([0, 0, 0, 3]);
  });

  it("staff ถูกกัน (ไม่อ่านอะไร)", async () => {
    roleMock.mockResolvedValue("staff");
    const r = await getProductionOrders();
    expect(r.ok).toBe(false);
    expect(tables).toHaveLength(0);
  });
});
