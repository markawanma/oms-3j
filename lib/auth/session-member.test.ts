// lib/auth/session-member.test.ts — requireMemberIfGateOn() + denyIfNotMember()
// (security fix 25 ต.ค. 69, extension-gate bypass — second auth layer inside server actions).
//
// Why membership and not just a session: /register lets ANYONE create a Supabase
// session (pending, no shop_member row). requireSessionIfGateOn() alone would
// let that pending signup through. These cases pin the 4 outcomes the brief asks
// for (gate on + no session / gate on + pending / gate on + member / gate off)
// plus the fail-closed edges (Auth env missing, shop_member lookup failing).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();
const getUserClientMock = vi.fn();
const getServiceClientMock = vi.fn();
const eqCalls: [string, unknown][] = [];
let memberResult: { data: unknown; error: unknown } = { data: null, error: null };

vi.mock("@/lib/supabase/server", () => ({
  getUserClient: () => getUserClientMock(),
  getServiceClient: () => getServiceClientMock(),
}));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => "shop-1" }));

function memberChain() {
  const p: Record<string, unknown> = {
    select: () => p,
    eq: (col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return p;
    },
    maybeSingle: () => Promise.resolve(memberResult),
  };
  return p;
}

const originalGate = process.env.AUTH_GATE;

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  eqCalls.length = 0;
  memberResult = { data: null, error: null };
  getUserClientMock.mockImplementation(async () => ({ auth: { getUser: getUserMock } }));
  getServiceClientMock.mockImplementation(() => ({ from: () => memberChain() }));
  delete process.env.AUTH_GATE;
});

afterEach(() => {
  if (originalGate === undefined) delete process.env.AUTH_GATE;
  else process.env.AUTH_GATE = originalGate;
  vi.restoreAllMocks();
});

const SESSION = { data: { user: { id: "user-1", email: "a@3j.test" } }, error: null };

describe("requireMemberIfGateOn", () => {
  it("gate off (unset) — no-op: never reads the session or shop_member", async () => {
    const { requireMemberIfGateOn } = await import("./session");
    await expect(requireMemberIfGateOn()).resolves.toBeUndefined();
    expect(getUserClientMock).not.toHaveBeenCalled();
    expect(getServiceClientMock).not.toHaveBeenCalled();
  });

  it("gate off (AUTH_GATE=off) — same no-op", async () => {
    process.env.AUTH_GATE = "off";
    const { requireMemberIfGateOn } = await import("./session");
    await expect(requireMemberIfGateOn()).resolves.toBeUndefined();
    expect(getUserClientMock).not.toHaveBeenCalled();
  });

  it("gate on + no session — rejected, never reaches shop_member", async () => {
    process.env.AUTH_GATE = "on";
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const { requireMemberIfGateOn } = await import("./session");
    await expect(requireMemberIfGateOn()).rejects.toThrow("ไม่ได้เข้าสู่ระบบ");
    expect(getServiceClientMock).not.toHaveBeenCalled();
  });

  it("gate on + session but NO shop_member row (pending signup) — rejected", async () => {
    process.env.AUTH_GATE = "on";
    getUserMock.mockResolvedValue(SESSION);
    memberResult = { data: null, error: null };
    const { requireMemberIfGateOn } = await import("./session");
    await expect(requireMemberIfGateOn()).rejects.toThrow("บัญชียังไม่ได้รับอนุมัติ");
  });

  it("gate on + approved member (even role=staff) — proceeds, lookup is pinned to user_id AND this shop", async () => {
    process.env.AUTH_GATE = "on";
    getUserMock.mockResolvedValue(SESSION);
    memberResult = { data: { shop_id: "shop-1", role: "staff" }, error: null };
    const { requireMemberIfGateOn } = await import("./session");
    await expect(requireMemberIfGateOn()).resolves.toBeUndefined();
    expect(eqCalls).toContainEqual(["user_id", "user-1"]);
    expect(eqCalls).toContainEqual(["shop_id", "shop-1"]);
  });

  it("gate on + Supabase Auth returns an error — rejected (fail closed)", async () => {
    process.env.AUTH_GATE = "on";
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: "jwt expired" } });
    const { requireMemberIfGateOn } = await import("./session");
    await expect(requireMemberIfGateOn()).rejects.toThrow("ไม่ได้เข้าสู่ระบบ");
  });

  it("gate on + Auth env missing (getUserClient throws) — rejected, not an unhandled crash with env text", async () => {
    process.env.AUTH_GATE = "on";
    getUserClientMock.mockRejectedValue(new Error("Missing NEXT_PUBLIC_SUPABASE_URL ..."));
    const { requireMemberIfGateOn } = await import("./session");
    await expect(requireMemberIfGateOn()).rejects.toThrow("ไม่ได้เข้าสู่ระบบ");
  });

  it("gate on + shop_member lookup errors — rejected (could not confirm != is a member)", async () => {
    process.env.AUTH_GATE = "on";
    getUserMock.mockResolvedValue(SESSION);
    memberResult = { data: { shop_id: "shop-1", role: "owner" }, error: { code: "57P01" } };
    const { requireMemberIfGateOn } = await import("./session");
    await expect(requireMemberIfGateOn()).rejects.toThrow("บัญชียังไม่ได้รับอนุมัติ");
  });

  it("gate on + service client cannot be built (throws) — rejected", async () => {
    process.env.AUTH_GATE = "on";
    getUserMock.mockResolvedValue(SESSION);
    getServiceClientMock.mockImplementation(() => {
      throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    });
    const { requireMemberIfGateOn } = await import("./session");
    await expect(requireMemberIfGateOn()).rejects.toThrow("บัญชียังไม่ได้รับอนุมัติ");
  });
});

describe("denyIfNotMember (ActionResult-style wrapper)", () => {
  it("gate off — null (proceed)", async () => {
    const { denyIfNotMember } = await import("./action-guard");
    await expect(denyIfNotMember()).resolves.toBeNull();
  });

  it("gate on + no session — { ok:false } with the shared message", async () => {
    process.env.AUTH_GATE = "on";
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const { denyIfNotMember } = await import("./action-guard");
    await expect(denyIfNotMember()).resolves.toEqual({ ok: false, error: "ต้องเข้าสู่ระบบก่อน" });
  });

  it("gate on + pending (session, no membership) — same { ok:false } (caller can't tell which)", async () => {
    process.env.AUTH_GATE = "on";
    getUserMock.mockResolvedValue(SESSION);
    const { denyIfNotMember } = await import("./action-guard");
    await expect(denyIfNotMember()).resolves.toEqual({ ok: false, error: "ต้องเข้าสู่ระบบก่อน" });
  });

  it("gate on + member — null (proceed)", async () => {
    process.env.AUTH_GATE = "on";
    getUserMock.mockResolvedValue(SESSION);
    memberResult = { data: { shop_id: "shop-1", role: "admin" }, error: null };
    const { denyIfNotMember } = await import("./action-guard");
    await expect(denyIfNotMember()).resolves.toBeNull();
  });

  it("never logs the underlying error (supabase-error-logging-trap)", async () => {
    process.env.AUTH_GATE = "on";
    const spies = [vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "log")];
    getUserClientMock.mockRejectedValue(new Error("getaddrinfo ENOTFOUND abc.supabase.co"));
    const { denyIfNotMember } = await import("./action-guard");
    await denyIfNotMember();
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});
