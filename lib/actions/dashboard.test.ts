// lib/actions/dashboard.test.ts — H1 Phase 2: READ-mask actions (design §1.3 / §3 / §5).
// getDashboard / getDashboardCharts are open to every shop member, but money sections are
// stripped for staff by p_include_money=false (the RPC does the stripping). The new
// membership gate must run FIRST and must not disturb that mask:
//   order = requireMemberAccess() -> validateRange() -> getEffectiveRole() mask -> RPC
//   ห้ามผ่าน  : gate on + anonymous / pending / auth-env broken -> {ok:false}, RPC never called
//              (BEFORE this change an anonymous direct POST got the masked payload)
//   ต้องไม่พัง : staff MEMBER -> p_include_money:false exactly · owner/admin -> true ·
//              gate off DEV_ROLE=staff -> false, =owner -> true · bad range still rejected
//              ("ช่วงวันที่ไม่ถูกต้อง") for a member
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

import { getDashboard, getDashboardCharts } from "./dashboard";

const PARAMS = { from: "2026-10-01", to: "2026-10-27", channel: null };
const BAD_PARAMS = { from: "2026-13-45", to: "2026-10-27", channel: null };

const ACTIONS: [string, string, (p: typeof PARAMS) => Promise<unknown>][] = [
  ["getDashboard", "dashboard_summary", (p) => getDashboard(p)],
  ["getDashboardCharts", "dashboard_charts", (p) => getDashboardCharts(p)],
];

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

describe.each(ACTIONS)("%s — membership gate ก่อน validate/mask", (_name, rpcName, call) => {
  const denied: [string, AuthState, string][] = [
    ["gate on + ไม่มี session", AUTH.noSession, MSG.needLogin],
    ["gate on + getSessionUser throw (fail-closed)", AUTH.sessionThrows, MSG.needLogin],
    ["gate on + pending", AUTH.pending, MSG.notApproved],
  ];

  it.each(denied)("ห้ามผ่าน: %s -> {ok:false} และ RPC ไม่ถูกเรียก", async (_label, auth, error) => {
    setAuth(h, auth);

    await expect(call(PARAMS)).resolves.toEqual({ ok: false, error });
    expect(touchedDb(h)).toBe(false);
  });

  it("ห้ามผ่าน: ช่วงวันที่เพี้ยน + ไม่มี session -> ได้ข้อความ guard ไม่ใช่ 'ช่วงวันที่ไม่ถูกต้อง' (guard มาก่อน validateRange)", async () => {
    setAuth(h, AUTH.noSession);

    await expect(call(BAD_PARAMS)).resolves.toEqual({ ok: false, error: MSG.needLogin });
  });

  const masks: [string, AuthState, boolean][] = [
    ["gate on + staff member -> mask เงิน", AUTH.staffMember, false],
    ["gate on + owner -> เห็นเงิน", AUTH.ownerMember, true],
    ["gate on + admin -> เห็นเงิน", AUTH.adminMember, true],
    ["gate off + DEV_ROLE=staff -> mask เงิน", AUTH.gateOffStaff, false],
    ["gate off + DEV_ROLE=owner -> เห็นเงิน", AUTH.gateOffOwner, true],
  ];

  it.each(masks)("ต้องไม่พัง: %s (p_include_money เป๊ะ)", async (_label, auth, includeMoney) => {
    setAuth(h, auth);

    const result = (await call(PARAMS)) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(h.rpcMock).toHaveBeenCalledTimes(1);
    expect(h.rpcMock).toHaveBeenCalledWith(rpcName, {
      p_shop_id: "shop-1",
      p_from: "2026-10-01",
      p_to: "2026-10-27",
      p_channel: null,
      p_include_money: includeMoney,
    });
  });

  it("ต้องไม่พัง: ช่วงวันที่เพี้ยน + owner -> ยัง 'ช่วงวันที่ไม่ถูกต้อง' และไม่เรียก RPC (validate ยังทำงานหลัง guard)", async () => {
    setAuth(h, AUTH.ownerMember);

    await expect(call(BAD_PARAMS)).resolves.toEqual({ ok: false, error: "ช่วงวันที่ไม่ถูกต้อง" });
    expect(h.rpcMock).not.toHaveBeenCalled();
  });

  it("ต้องไม่พัง: ช่วงวันที่เพี้ยน + staff member -> ยัง 'ช่วงวันที่ไม่ถูกต้อง' (ไม่ใช่ข้อความ guard)", async () => {
    setAuth(h, AUTH.staffMember);

    await expect(call(BAD_PARAMS)).resolves.toEqual({ ok: false, error: "ช่วงวันที่ไม่ถูกต้อง" });
  });

  it("ข้อความ guard ไม่ถูก catch ทับเป็น 'โหลด...ไม่สำเร็จ'", async () => {
    setAuth(h, AUTH.pending);

    const result = (await call(PARAMS)) as { ok: false; error: string };
    expect(result.error).not.toMatch(/ไม่สำเร็จ/);
  });
});

describe("mask เงินเดิมยังอยู่ — payload ที่ RPC ตัดให้ staff ไม่ถูกเติมกลับ", () => {
  it("getDashboard: staff member + RPC คืน kpi:null -> data.kpi เป็น null (ไม่มีเลขเงินโผล่)", async () => {
    setAuth(h, AUTH.staffMember);
    setTables(h, {}, { data: { kpi: null, action: { oversold: 1, oversold_breached: 0, low_stock: 2 }, reco: [], rfm: {} }, error: null });

    const result = await getDashboard(PARAMS);

    expect(result).toMatchObject({ ok: true, data: { kpi: null, action: { oversold: 1, lowStock: 2 } } });
  });

  it("getDashboard: owner + RPC คืน kpi -> map ตามเดิม", async () => {
    setAuth(h, AUTH.ownerMember);
    setTables(h, {}, { data: { kpi: { revenue: 1000, orders: 4, profit: 300, aov: 250 } }, error: null });

    await expect(getDashboard(PARAMS)).resolves.toMatchObject({
      ok: true,
      data: { kpi: { revenue: 1000, orders: 4, profit: 300, aov: 250 } },
    });
  });
});
