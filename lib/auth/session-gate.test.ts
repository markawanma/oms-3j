// lib/auth/session-gate.test.ts — requireSessionIfGateOn (security review
// 2026-09-16, C1(b)). Split out from session.test.ts so verifyCodeFor's
// tests stay dependency-free — this file mocks @/lib/supabase/server
// because getSessionUser() (which requireSessionIfGateOn calls) depends on
// getUserClient()'s cookies()+network client.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getUserClient: async () => ({ auth: { getUser: getUserMock } }),
  getServiceClient: () => {
    throw new Error("requireSessionIfGateOn must not touch the service client");
  },
}));

const originalGate = process.env.AUTH_GATE;
const originalVercelEnv = process.env.VERCEL_ENV;

beforeEach(() => {
  vi.clearAllMocks();
  // เคสเดิมจำลอง local dev — ไม่ให้ VERCEL_ENV ของเครื่อง/CI รั่วเข้ามาทำให้ no-op กลายเป็นบังคับ
  delete process.env.VERCEL_ENV;
});

afterEach(() => {
  if (originalGate === undefined) delete process.env.AUTH_GATE;
  else process.env.AUTH_GATE = originalGate;
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
  vi.unstubAllEnvs(); // คืน NODE_ENV ("test") หลังเคส NODE_ENV=production
});

describe("requireSessionIfGateOn", () => {
  it("AUTH_GATE off (unset) — no-op, never even checks the session (A1 dev flow must not break)", async () => {
    delete process.env.AUTH_GATE;
    const { requireSessionIfGateOn } = await import("./session");

    await expect(requireSessionIfGateOn()).resolves.toBeUndefined();
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("AUTH_GATE=off (explicit non-'on' value) — same no-op", async () => {
    process.env.AUTH_GATE = "off";
    const { requireSessionIfGateOn } = await import("./session");

    await expect(requireSessionIfGateOn()).resolves.toBeUndefined();
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("AUTH_GATE=on + no session — throws", async () => {
    process.env.AUTH_GATE = "on";
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const { requireSessionIfGateOn } = await import("./session");

    await expect(requireSessionIfGateOn()).rejects.toThrow("ไม่ได้เข้าสู่ระบบ");
  });

  it("AUTH_GATE=on + real session — resolves without throwing", async () => {
    process.env.AUTH_GATE = "on";
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "a@b.com" } }, error: null });
    const { requireSessionIfGateOn } = await import("./session");

    await expect(requireSessionIfGateOn()).resolves.toBeUndefined();
  });

  it("AUTH_GATE=on + getUser() errors — treated as no session (fail closed)", async () => {
    process.env.AUTH_GATE = "on";
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: "network hiccup" } });
    const { requireSessionIfGateOn } = await import("./session");

    await expect(requireSessionIfGateOn()).rejects.toThrow("ไม่ได้เข้าสู่ระบบ");
  });
});

// มติ 3 พ.ย. 69 (A-แคบ): บน deployment จริง ชั้น action บังคับเสมอ ไม่ฟัง AUTH_GATE
describe("requireSessionIfGateOn — real deployment บังคับเสมอ แม้ AUTH_GATE ไม่ตั้ง/off", () => {
  const GATES: (string | undefined)[] = [undefined, "off"];

  for (const gate of GATES) {
    it(`VERCEL_ENV=production AUTH_GATE=${JSON.stringify(gate)} + ไม่มี session — throws "ไม่ได้เข้าสู่ระบบ"`, async () => {
      process.env.VERCEL_ENV = "production";
      if (gate === undefined) delete process.env.AUTH_GATE;
      else process.env.AUTH_GATE = gate;
      getUserMock.mockResolvedValue({ data: { user: null }, error: null });
      const { requireSessionIfGateOn } = await import("./session");

      await expect(requireSessionIfGateOn()).rejects.toThrow("ไม่ได้เข้าสู่ระบบ");
      expect(getUserMock).toHaveBeenCalled();
    });
  }

  it("VERCEL_ENV=preview AUTH_GATE=off + ไม่มี session — throws (preview เขียน DB จริง)", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.AUTH_GATE = "off";
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const { requireSessionIfGateOn } = await import("./session");

    await expect(requireSessionIfGateOn()).rejects.toThrow("ไม่ได้เข้าสู่ระบบ");
  });

  it("NODE_ENV=production (ไม่มี VERCEL_ENV) AUTH_GATE unset + ไม่มี session — throws", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.AUTH_GATE;
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const { requireSessionIfGateOn } = await import("./session");

    await expect(requireSessionIfGateOn()).rejects.toThrow("ไม่ได้เข้าสู่ระบบ");
  });

  it("VERCEL_ENV=production + getUser() error — throws (fail closed)", async () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.AUTH_GATE;
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: "network hiccup" } });
    const { requireSessionIfGateOn } = await import("./session");

    await expect(requireSessionIfGateOn()).rejects.toThrow("ไม่ได้เข้าสู่ระบบ");
  });

  it("ต้องไม่พัง: VERCEL_ENV=production + มี session จริง — ผ่านโดยไม่ต้องมี AUTH_GATE", async () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.AUTH_GATE;
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "a@b.com" } }, error: null });
    const { requireSessionIfGateOn } = await import("./session");

    await expect(requireSessionIfGateOn()).resolves.toBeUndefined();
  });

  it("ต้องไม่พัง: local (VERCEL_ENV unset, NODE_ENV=test) + AUTH_GATE unset — ยัง no-op ไม่แตะ session", async () => {
    delete process.env.VERCEL_ENV;
    delete process.env.AUTH_GATE;
    expect(process.env.NODE_ENV).toBe("test");
    const { requireSessionIfGateOn } = await import("./session");

    await expect(requireSessionIfGateOn()).resolves.toBeUndefined();
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("ต้องไม่พัง: VERCEL_ENV=development (vercel dev) + AUTH_GATE unset — ยัง no-op", async () => {
    process.env.VERCEL_ENV = "development";
    delete process.env.AUTH_GATE;
    const { requireSessionIfGateOn } = await import("./session");

    await expect(requireSessionIfGateOn()).resolves.toBeUndefined();
    expect(getUserMock).not.toHaveBeenCalled();
  });
});
