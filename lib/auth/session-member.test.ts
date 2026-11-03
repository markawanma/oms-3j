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
const originalVercelEnv = process.env.VERCEL_ENV;

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.VERCEL_ENV; // เคสเดิมจำลอง local dev
  eqCalls.length = 0;
  memberResult = { data: null, error: null };
  getUserClientMock.mockImplementation(async () => ({ auth: { getUser: getUserMock } }));
  getServiceClientMock.mockImplementation(() => ({ from: () => memberChain() }));
  delete process.env.AUTH_GATE;
});

afterEach(() => {
  if (originalGate === undefined) delete process.env.AUTH_GATE;
  else process.env.AUTH_GATE = originalGate;
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
  vi.unstubAllEnvs(); // คืน NODE_ENV ("test") หลังเคส NODE_ENV=production
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

// มติ 3 พ.ย. 69 (A-แคบ): บน deployment จริง ชั้น action บังคับเสมอ ไม่ฟัง AUTH_GATE
describe("real deployment — requireMemberIfGateOn / denyIfNotMember บังคับเสมอ แม้ AUTH_GATE ไม่ตั้ง/off", () => {
  const GATES: (string | undefined)[] = [undefined, "off"];

  for (const gate of GATES) {
    const label = `VERCEL_ENV=production AUTH_GATE=${JSON.stringify(gate)}`;
    const arrange = () => {
      process.env.VERCEL_ENV = "production";
      if (gate === undefined) delete process.env.AUTH_GATE;
      else process.env.AUTH_GATE = gate;
    };

    it(`${label} + ไม่มี session — requireMemberIfGateOn throws "ไม่ได้เข้าสู่ระบบ", ไม่แตะ shop_member`, async () => {
      arrange();
      getUserMock.mockResolvedValue({ data: { user: null }, error: null });
      const { requireMemberIfGateOn } = await import("./session");
      await expect(requireMemberIfGateOn()).rejects.toThrow("ไม่ได้เข้าสู่ระบบ");
      expect(getServiceClientMock).not.toHaveBeenCalled();
    });

    it(`${label} + pending (session แต่ไม่มี shop_member) — throws "บัญชียังไม่ได้รับอนุมัติ"`, async () => {
      arrange();
      getUserMock.mockResolvedValue(SESSION);
      memberResult = { data: null, error: null };
      const { requireMemberIfGateOn } = await import("./session");
      await expect(requireMemberIfGateOn()).rejects.toThrow("บัญชียังไม่ได้รับอนุมัติ");
    });

    it(`${label} + ไม่มี session — denyIfNotMember คืน { ok:false } ข้อความเดิม`, async () => {
      arrange();
      getUserMock.mockResolvedValue({ data: { user: null }, error: null });
      const { denyIfNotMember } = await import("./action-guard");
      await expect(denyIfNotMember()).resolves.toEqual({ ok: false, error: "ต้องเข้าสู่ระบบก่อน" });
    });

    it(`${label} + member (staff) — ผ่าน (ต้องไม่พัง: staff ที่ล็อกอินจริงใช้งานได้โดยไม่ต้องมี AUTH_GATE)`, async () => {
      arrange();
      getUserMock.mockResolvedValue(SESSION);
      memberResult = { data: { shop_id: "shop-1", role: "staff" }, error: null };
      const { requireMemberIfGateOn } = await import("./session");
      await expect(requireMemberIfGateOn()).resolves.toBeUndefined();
    });
  }

  it("NODE_ENV=production (ไม่มี VERCEL_ENV) AUTH_GATE unset + ไม่มี session — throws", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.AUTH_GATE;
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const { requireMemberIfGateOn } = await import("./session");
    await expect(requireMemberIfGateOn()).rejects.toThrow("ไม่ได้เข้าสู่ระบบ");
  });

  it("VERCEL_ENV=production + Supabase Auth env หาย (getUserClient throws) — throws ไม่ fail-open", async () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.AUTH_GATE;
    getUserClientMock.mockRejectedValue(new Error("Missing NEXT_PUBLIC_SUPABASE_URL ..."));
    const { requireMemberIfGateOn } = await import("./session");
    await expect(requireMemberIfGateOn()).rejects.toThrow("ไม่ได้เข้าสู่ระบบ");
  });

  it("ต้องไม่พัง: local (VERCEL_ENV unset, NODE_ENV=test) + AUTH_GATE unset — ยัง no-op ไม่แตะ session/shop_member", async () => {
    delete process.env.AUTH_GATE;
    expect(process.env.NODE_ENV).toBe("test");
    const { requireMemberIfGateOn } = await import("./session");
    await expect(requireMemberIfGateOn()).resolves.toBeUndefined();
    expect(getUserClientMock).not.toHaveBeenCalled();
    expect(getServiceClientMock).not.toHaveBeenCalled();
  });
});
