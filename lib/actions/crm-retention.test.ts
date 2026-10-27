// lib/actions/crm-retention.test.ts — H1 Phase 2: READ-mask gate on getCrmRetention
// (design §1.3). Membership gate first, then the UNCHANGED staff money mask
// (includeMoney / canPullList = role !== "staff"). No page imports this action today —
// guarded anyway because a "use server" export is reachable by a direct POST.
//   ห้ามผ่าน  : gate on + anonymous / pending / auth-env broken -> {ok:false}, RPC never called
//   ต้องไม่พัง : staff member -> p_include_money:false + canPullList:false (shape still returned) ·
//              owner/admin -> true/true · gate off follows DEV_ROLE
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH, MSG, setAuth, setTables, touchedDb, type AuthState } from "./test-support/h1-harness";

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

import { getCrmRetention } from "./crm-retention";

// one payload that satisfies both mappers (ladder: as_of/cells · cohort: as_of/weeks/baseline)
const RPC_OK = {
  data: {
    as_of: "2026-10-27",
    max_order_date: "2026-10-26",
    customers_total: 3,
    cells: [{ bucket: "d0_30", reachable: true, affinity: "bar", customers: 3, revenue: 900 }],
    excluded_orders_no_customer: 0,
    weeks: [],
    baseline: [],
  },
  error: null,
};

const originalAuthGate = process.env.AUTH_GATE;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  setAuth(h, AUTH.gateOffOwner);
  setTables(h, {}, RPC_OK);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalAuthGate === undefined) delete process.env.AUTH_GATE;
  else process.env.AUTH_GATE = originalAuthGate;
});

describe("getCrmRetention — membership gate ก่อน mask", () => {
  const denied: [string, AuthState, string][] = [
    ["gate on + ไม่มี session", AUTH.noSession, MSG.needLogin],
    ["gate on + getSessionUser throw (fail-closed)", AUTH.sessionThrows, MSG.needLogin],
    ["gate on + pending", AUTH.pending, MSG.notApproved],
  ];

  it.each(denied)("ห้ามผ่าน: %s -> {ok:false} และ RPC ไม่ถูกเรียก", async (_label, auth, error) => {
    setAuth(h, auth);

    await expect(getCrmRetention()).resolves.toEqual({ ok: false, error });
    expect(touchedDb(h)).toBe(false);
  });

  const masks: [string, AuthState, boolean][] = [
    ["gate on + staff member", AUTH.staffMember, false],
    ["gate on + owner", AUTH.ownerMember, true],
    ["gate on + admin", AUTH.adminMember, true],
    ["gate off + DEV_ROLE=staff", AUTH.gateOffStaff, false],
    ["gate off + DEV_ROLE=owner", AUTH.gateOffOwner, true],
  ];

  it.each(masks)("ต้องไม่พัง: %s -> p_include_money และ canPullList = %s เป๊ะ", async (_label, auth, allowed) => {
    setAuth(h, auth);

    const result = await getCrmRetention();

    expect(result).toMatchObject({ ok: true, data: { canPullList: allowed, ladder: { customersTotal: 3 } } });
    expect(h.rpcMock).toHaveBeenCalledWith("crm_recency_ladder", { p_shop_id: "shop-1", p_include_money: allowed });
    expect(h.rpcMock).toHaveBeenCalledWith("crm_repeat_cohort", { p_shop_id: "shop-1" });
  });

  it("ข้อความ guard ไม่ถูก catch ทับเป็น 'โหลด...ไม่สำเร็จ'", async () => {
    setAuth(h, AUTH.pending);

    const result = (await getCrmRetention()) as { ok: false; error: string };
    expect(result.error).not.toMatch(/ไม่สำเร็จ/);
  });
});
