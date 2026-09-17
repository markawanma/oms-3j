// lib/auth/role.test.ts — getEffectiveRole() precedence (17 ก.ย. 69 fix).
// Prod bug this covers: after AUTH_GATE=on shipped, every page/action still
// decided role from DEV_ROLE (an env var) instead of the real session, so a
// logged-in owner with DEV_ROLE unset (defaults to 'staff') was gated out of
// owner-only pages. These cases pin the fix's precedence so it can't regress
// silently: a real session's shop_member.role always wins over DEV_ROLE.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSessionUserMock = vi.fn();
const getMembershipMock = vi.fn();
const getDevRoleMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: () => getSessionUserMock(),
  getMembership: (userId: string) => getMembershipMock(userId),
}));

vi.mock("@/lib/dev/context", () => ({
  getDevRole: () => getDevRoleMock(),
}));

const originalAuthGate = process.env.AUTH_GATE;

// React.cache() dedupes within a single request/render; each test starts a
// fresh module instance (vi.resetModules) so caching in one test can't leak
// into the next and hide a real bug behind a stale cached value. AUTH_GATE
// is explicitly cleared per test (security review 2026-09-17, H1) so every
// case's expectation doesn't depend on whatever happens to be ambient in the
// shell/CI environment.
beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.AUTH_GATE;
});

afterEach(() => {
  if (originalAuthGate === undefined) delete process.env.AUTH_GATE;
  else process.env.AUTH_GATE = originalAuthGate;
});

describe("getEffectiveRole", () => {
  it("real session + owner membership -> owner, even when DEV_ROLE=staff", async () => {
    getSessionUserMock.mockResolvedValue({ id: "user-1", email: "owner@3j.test" });
    getMembershipMock.mockResolvedValue({ shopId: "shop-1", role: "owner" });
    getDevRoleMock.mockReturnValue("staff"); // must NOT win over the real session

    const { getEffectiveRole } = await import("./role");
    await expect(getEffectiveRole()).resolves.toBe("owner");
    expect(getDevRoleMock).not.toHaveBeenCalled();
  });

  it("real session but NO membership (pending user) -> staff, even when DEV_ROLE=owner", async () => {
    getSessionUserMock.mockResolvedValue({ id: "user-2", email: "pending@3j.test" });
    getMembershipMock.mockResolvedValue(null);
    getDevRoleMock.mockReturnValue("owner"); // must NOT leak elevated access

    const { getEffectiveRole } = await import("./role");
    await expect(getEffectiveRole()).resolves.toBe("staff");
    expect(getDevRoleMock).not.toHaveBeenCalled();
  });

  it("approved staff membership -> staff", async () => {
    getSessionUserMock.mockResolvedValue({ id: "user-3", email: "staff@3j.test" });
    getMembershipMock.mockResolvedValue({ shopId: "shop-1", role: "staff" });
    getDevRoleMock.mockReturnValue("owner");

    const { getEffectiveRole } = await import("./role");
    await expect(getEffectiveRole()).resolves.toBe("staff");
  });

  it("no session at all (AUTH_GATE off / local dev / scripts) -> falls back to DEV_ROLE", async () => {
    getSessionUserMock.mockResolvedValue(null);
    getDevRoleMock.mockReturnValue("owner");

    const { getEffectiveRole } = await import("./role");
    await expect(getEffectiveRole()).resolves.toBe("owner");
    expect(getMembershipMock).not.toHaveBeenCalled();
  });

  it("no session + DEV_ROLE unset -> default staff (fail closed, unchanged from getDevRole())", async () => {
    getSessionUserMock.mockResolvedValue(null);
    getDevRoleMock.mockReturnValue("staff");

    const { getEffectiveRole } = await import("./role");
    await expect(getEffectiveRole()).resolves.toBe("staff");
  });

  // Security review 2026-09-17 (H1): once the login gate is actually
  // enforced, DEV_ROLE must have zero authority over "nobody is logged in".
  it("H1: no session + AUTH_GATE=on -> staff, even when DEV_ROLE=owner (env has no vote while the gate is on)", async () => {
    process.env.AUTH_GATE = "on";
    getSessionUserMock.mockResolvedValue(null);
    getDevRoleMock.mockReturnValue("owner");

    const { getEffectiveRole } = await import("./role");
    await expect(getEffectiveRole()).resolves.toBe("staff");
    expect(getDevRoleMock).not.toHaveBeenCalled();
  });

  // Security review 2026-09-17 (H2): a misconfigured auth environment
  // (getSessionUser()/getUserClient() throwing) must never be
  // indistinguishable from "logged in as owner".
  it("H2: getSessionUser() throws + AUTH_GATE=on -> staff, not a crash and not DEV_ROLE", async () => {
    process.env.AUTH_GATE = "on";
    getSessionUserMock.mockRejectedValue(new Error("SUPABASE_URL not set"));
    getDevRoleMock.mockReturnValue("owner");

    const { getEffectiveRole } = await import("./role");
    await expect(getEffectiveRole()).resolves.toBe("staff");
    expect(getDevRoleMock).not.toHaveBeenCalled();
    expect(getMembershipMock).not.toHaveBeenCalled();
  });

  it("H2: getSessionUser() throws + AUTH_GATE off -> falls back to DEV_ROLE (unchanged pre-A2-lite behavior)", async () => {
    getSessionUserMock.mockRejectedValue(new Error("SUPABASE_URL not set"));
    getDevRoleMock.mockReturnValue("owner");

    const { getEffectiveRole } = await import("./role");
    await expect(getEffectiveRole()).resolves.toBe("owner");
  });
});
