// lib/actions/tiktok-sales.test.ts — H1 Phase 2: READ-member gate on getSalesSummary (design §1.4).
// /tiktok/sales is NOT role-gated at the page, so the gate is membership (any role), not owner:
//   ห้ามผ่าน  : anonymous / auth-env broken / pending (session without shop_member) -> {ok:false}, DB never touched
//   ต้องไม่พัง: gate off (DEV_ROLE=staff or owner) · owner · admin · STAFF MEMBER all keep the page's data
//             — and a staff member sees exactly what an owner sees (no new masking in this change)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH, chain, gateMatrix, setAuth, setTables, touchedDb } from "./test-support/h1-harness";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getMembership: vi.fn(),
  devRole: vi.fn(),
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", async () => (await import("./test-support/h1-harness")).sessionModuleMock(h));
vi.mock("@/lib/dev/context", async () => (await import("./test-support/h1-harness")).devContextMock(h));
vi.mock("@/lib/supabase/server", async () => (await import("./test-support/h1-harness")).supabaseServerMock(h));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getSalesSummary } from "./tiktok-sales";

const PARAMS = { from: "2026-10-01", to: "2026-10-31", granularity: "day" } as const;
const ORDER_ROW = {
  placed_at: "2026-10-05T03:00:00Z",
  created_at: "2026-10-05T03:00:00Z",
  total_amount: "1500.00",
  status: "completed",
  channel_account_id: "ca-1",
};

/** getSalesSummary reads `orders` twice: first-order date (maybeSingle -> one row) then the window (rows). */
function wireOrders(): void {
  let ordersCalls = 0;
  h.fromMock.mockImplementation((table: string) => {
    if (table === "channel_account") return chain({ data: [{ id: "ca-1", channel: { code: "tiktok" } }], error: null });
    if (table === "orders") {
      ordersCalls += 1;
      return chain(ordersCalls === 1 ? { data: ORDER_ROW, error: null } : { data: [ORDER_ROW], error: null });
    }
    return chain({ data: [], error: null });
  });
}

const originalAuthGate = process.env.AUTH_GATE;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  setAuth(h, AUTH.gateOffOwner);
  setTables(h, {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalAuthGate === undefined) delete process.env.AUTH_GATE;
  else process.env.AUTH_GATE = originalAuthGate;
});

describe("getSalesSummary — READ-member gate", () => {
  gateMatrix(h, "member", { call: () => getSalesSummary({ ...PARAMS }), setup: wireOrders }, "");
});

describe("getSalesSummary — ลำดับ guard/validation + ข้อมูลเท่าเดิม", () => {
  it("staff member ได้ยอดขายเท่า owner เป๊ะ (ไม่ mask เพิ่ม)", async () => {
    setAuth(h, AUTH.ownerMember);
    wireOrders();
    const asOwner = await getSalesSummary({ ...PARAMS });
    setAuth(h, AUTH.staffMember);
    wireOrders();
    const asStaff = await getSalesSummary({ ...PARAMS });

    expect(asStaff).toEqual(asOwner);
    expect(asStaff).toMatchObject({ ok: true });
    expect(JSON.stringify(asStaff)).toContain("1500");
  });

  it("ช่วงวันผิดรูป + ไม่มี session -> ข้อความ guard ไม่ใช่ 'ช่วงวันที่ไม่ถูกต้อง'", async () => {
    setAuth(h, AUTH.noSession);

    await expect(getSalesSummary({ from: "x", to: "y", granularity: "day" })).resolves.toEqual({
      ok: false,
      error: "ต้องเข้าสู่ระบบก่อน",
    });
  });

  it("ช่วงวันผิดรูป + สมาชิก -> ยัง validate ตามเดิม ไม่แตะ DB", async () => {
    setAuth(h, AUTH.staffMember);

    await expect(getSalesSummary({ from: "x", to: "y", granularity: "day" })).resolves.toEqual({
      ok: false,
      error: "ช่วงวันที่ไม่ถูกต้อง",
    });
    expect(touchedDb(h)).toBe(false);
  });
});
