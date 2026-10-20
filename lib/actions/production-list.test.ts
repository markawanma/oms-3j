// getProductionOrders / getProductionOrder — unboundItemCount (PM-B ป้าย "ยังไม่ผูก SKU n")
// ต้องถูก: นับรายการ product_id null ต่อใบ · ต้องไม่พัง: อ่านนับไม่ได้ = รายการใบผลิตยังโหลดได้ (ป้ายหาย ไม่ล้มทั้งหน้า) · staff ถูกกัน
import { beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const roleMock = vi.fn();
let unboundResult: { data: unknown; error: unknown } = { data: [], error: null };
const unboundCalls: Array<[string, ...unknown[]]> = [];

function unboundBuilder() {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "limit"]) b[m] = (...a: unknown[]) => (unboundCalls.push([m, ...a]), b);
  b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(unboundResult).then(ok, bad);
  return b;
}

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => roleMock() }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => null }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({ schema: () => ({ from: (t: string) => (t === "production_order_item" ? unboundBuilder() : (() => { throw new Error(`unexpected table ${t}`); })()) }) }),
}));
const ORDERS = [
  { id: "o1", po_no: "PO-1", status: "open", note: null, spot_override_thb_per_gram: null, done_at: null, cancelled_at: null, cancel_reason: null, created_at: "2026-10-20T00:00:00Z", updated_at: "2026-10-20T00:00:00Z", item_count: 3, qty_planned_total: 30, qty_done_total: 0 },
  { id: "o2", po_no: "PO-2", status: "open", note: null, spot_override_thb_per_gram: null, done_at: null, cancelled_at: null, cancel_reason: null, created_at: "2026-10-19T00:00:00Z", updated_at: "2026-10-19T00:00:00Z", item_count: 1, qty_planned_total: 5, qty_done_total: 0 },
];
vi.mock("@/lib/supabase/query-limits", () => ({ fetchAllRows: async () => ({ rows: ORDERS, totalCount: 2, truncated: false }) }));

import { getProductionOrders } from "./production";

beforeEach(() => {
  roleMock.mockReset().mockResolvedValue("owner");
  unboundResult = { data: [], error: null };
  unboundCalls.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getProductionOrders.unboundItemCount", () => {
  it("นับรายการ product_id null ต่อใบ · ใบที่ไม่มี = 0 · query ผูก shop + is(product_id, null)", async () => {
    unboundResult = { data: [{ production_order_id: "o1" }, { production_order_id: "o1" }], error: null };
    const r = await getProductionOrders();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.rows.map((x) => [x.id, x.unboundItemCount])).toEqual([["o1", 2], ["o2", 0]]);
    expect(unboundCalls).toContainEqual(["eq", "shop_id", SHOP]);
    expect(unboundCalls).toContainEqual(["is", "product_id", null]);
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
    expect(unboundCalls).toHaveLength(0);
  });
});
