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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (originalGate === undefined) delete process.env.AUTH_GATE;
  else process.env.AUTH_GATE = originalGate;
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
