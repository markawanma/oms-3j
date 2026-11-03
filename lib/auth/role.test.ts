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
const originalVercelEnv = process.env.VERCEL_ENV;

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
  // Existing cases model local dev (VERCEL_ENV unset); deployment cases set it explicitly.
  delete process.env.VERCEL_ENV;
});

afterEach(() => {
  if (originalAuthGate === undefined) delete process.env.AUTH_GATE;
  else process.env.AUTH_GATE = originalAuthGate;
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
  vi.unstubAllEnvs(); // restores NODE_ENV (vitest sets "test") after the NODE_ENV cases below
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

// Security audit 3 พ.ย. 69: Vercel production has DEV_ROLE set, and switching
// AUTH_GATE off is the documented emergency fallback (middleware.ts) — on a
// real deployment DEV_ROLE must never speak for an anonymous request.
describe("getEffectiveRole — real deployment must ignore DEV_ROLE (VERCEL_ENV)", () => {
  // The QA matrix below covers production/preview/staging/Production/" production "/dev x gate x failure, the local
  // paths and real sessions on every env; wrong-case "Development" is the one spelling it does not exercise.
  it('VERCEL_ENV="Development" (wrong case) + no session + DEV_ROLE=owner -> staff (only exact "development" is local)', async () => {
    process.env.VERCEL_ENV = "Development";
    getSessionUserMock.mockResolvedValue(null);
    getDevRoleMock.mockReturnValue("owner");

    const { getEffectiveRole } = await import("./role");
    await expect(getEffectiveRole()).resolves.toBe("staff");
    expect(getDevRoleMock).not.toHaveBeenCalled();
  });
});

describe("getEffectiveRole — unknown membership role fails closed", () => {
  // QA matrix below covers case/whitespace variants (OWNER, " owner", ...), non-strings, null/undefined, viewer;
  // these three strings are the ones it does not list.
  for (const bad of ["superadmin", "Owner", ""]) {
    it(`membership.role=${JSON.stringify(bad)} -> staff`, async () => {
      getSessionUserMock.mockResolvedValue({ id: "user-5", email: "x@3j.test" });
      getMembershipMock.mockResolvedValue({ shopId: "shop-1", role: bad });
      getDevRoleMock.mockReturnValue("owner");

      const { getEffectiveRole } = await import("./role");
      await expect(getEffectiveRole()).resolves.toBe("staff");
      expect(getDevRoleMock).not.toHaveBeenCalled();
    });
  }
});

// QA (R2-D2) 3 พ.ย. 69 — fills the gaps left by the cases above: every
// (VERCEL_ENV x AUTH_GATE x failure-mode) combination that must NOT reach
// DEV_ROLE, plus the "must not break" side on every path that is legitimately
// local. Each case asserts DEV_ROLE was never consulted, not just the result.
describe("QA matrix — deployment x AUTH_GATE x no-session/throw must never reach DEV_ROLE", () => {
  const deployments = ["production", "preview", "staging", "Production", " production ", "dev", "0", "false"];
  const gates: Array<string | undefined> = [undefined, "off", "on", "ON", "", "true"];
  const failures: Array<"no-session" | "throws"> = ["no-session", "throws"];

  for (const vercelEnv of deployments) {
    for (const gate of gates) {
      for (const failure of failures) {
        it(`VERCEL_ENV=${JSON.stringify(vercelEnv)} AUTH_GATE=${JSON.stringify(gate)} ${failure} DEV_ROLE=owner -> staff`, async () => {
          process.env.VERCEL_ENV = vercelEnv;
          if (gate !== undefined) process.env.AUTH_GATE = gate;
          if (failure === "throws") getSessionUserMock.mockRejectedValue(new Error("boom"));
          else getSessionUserMock.mockResolvedValue(null);
          getDevRoleMock.mockReturnValue("owner");

          const { getEffectiveRole } = await import("./role");
          await expect(getEffectiveRole()).resolves.toBe("staff");
          expect(getDevRoleMock).not.toHaveBeenCalled();
          expect(getMembershipMock).not.toHaveBeenCalled();
        });
      }
    }
  }

  it("DEV_ROLE=admin on production + no session -> staff (admin is also elevated, not only owner)", async () => {
    process.env.VERCEL_ENV = "production";
    getSessionUserMock.mockResolvedValue(null);
    getDevRoleMock.mockReturnValue("admin");
    const { getEffectiveRole } = await import("./role");
    await expect(getEffectiveRole()).resolves.toBe("staff");
  });
});

describe("QA matrix — local paths must keep working (must not break)", () => {
  for (const vercelEnv of [undefined, "", "   ", "development", " development "]) {
    it(`VERCEL_ENV=${JSON.stringify(vercelEnv)} AUTH_GATE=off + no session -> DEV_ROLE (owner)`, async () => {
      if (vercelEnv !== undefined) process.env.VERCEL_ENV = vercelEnv;
      process.env.AUTH_GATE = "off";
      getSessionUserMock.mockResolvedValue(null);
      getDevRoleMock.mockReturnValue("owner");
      const { getEffectiveRole } = await import("./role");
      await expect(getEffectiveRole()).resolves.toBe("owner");
    });

    it(`VERCEL_ENV=${JSON.stringify(vercelEnv)} + getSessionUser throws + gate unset -> DEV_ROLE (admin)`, async () => {
      if (vercelEnv !== undefined) process.env.VERCEL_ENV = vercelEnv;
      getSessionUserMock.mockRejectedValue(new Error("SUPABASE_URL not set"));
      getDevRoleMock.mockReturnValue("admin");
      const { getEffectiveRole } = await import("./role");
      await expect(getEffectiveRole()).resolves.toBe("admin");
    });

    it(`VERCEL_ENV=${JSON.stringify(vercelEnv)} + AUTH_GATE=on + no session -> staff (gate on still beats DEV_ROLE locally)`, async () => {
      if (vercelEnv !== undefined) process.env.VERCEL_ENV = vercelEnv;
      process.env.AUTH_GATE = "on";
      getSessionUserMock.mockResolvedValue(null);
      getDevRoleMock.mockReturnValue("owner");
      const { getEffectiveRole } = await import("./role");
      await expect(getEffectiveRole()).resolves.toBe("staff");
      expect(getDevRoleMock).not.toHaveBeenCalled();
    });
  }
});

describe("QA matrix — a real session decides, regardless of VERCEL_ENV / AUTH_GATE / DEV_ROLE", () => {
  const envs: Array<string | undefined> = [undefined, "development", "preview", "production", "staging"];
  const gates: Array<string | undefined> = [undefined, "off", "on"];
  const cases: Array<{ role: "owner" | "admin" | "staff"; devRole: string }> = [
    { role: "owner", devRole: "staff" },
    { role: "admin", devRole: "owner" },
    { role: "staff", devRole: "owner" },
    { role: "staff", devRole: "admin" },
  ];
  for (const vercelEnv of envs) {
    for (const gate of gates) {
      for (const c of cases) {
        it(`VERCEL_ENV=${JSON.stringify(vercelEnv)} AUTH_GATE=${JSON.stringify(gate)} session=${c.role} DEV_ROLE=${c.devRole} -> ${c.role}`, async () => {
          if (vercelEnv !== undefined) process.env.VERCEL_ENV = vercelEnv;
          if (gate !== undefined) process.env.AUTH_GATE = gate;
          getSessionUserMock.mockResolvedValue({ id: "u", email: "u@3j.test" });
          getMembershipMock.mockResolvedValue({ shopId: "shop-1", role: c.role });
          getDevRoleMock.mockReturnValue(c.devRole);
          const { getEffectiveRole } = await import("./role");
          await expect(getEffectiveRole()).resolves.toBe(c.role);
          expect(getDevRoleMock).not.toHaveBeenCalled();
        });
      }
    }
  }

  it("production + session but NO membership + DEV_ROLE=owner -> staff", async () => {
    process.env.VERCEL_ENV = "production";
    getSessionUserMock.mockResolvedValue({ id: "u", email: "u@3j.test" });
    getMembershipMock.mockResolvedValue(null);
    getDevRoleMock.mockReturnValue("owner");
    const { getEffectiveRole } = await import("./role");
    await expect(getEffectiveRole()).resolves.toBe("staff");
    expect(getDevRoleMock).not.toHaveBeenCalled();
  });
});

describe("QA matrix — malformed membership.role never elevates (cast values from a drifting DB enum)", () => {
  const bad: unknown[] = [
    "STAFF", "ADMIN", "OWNER", " owner", "owner ", "owner\n", "admin\u0000", "own​er", "Ｏwner",
    "owner,admin", "super_admin", "manager", "viewer", "root",
    0, 1, true, false, null, undefined, NaN, [], ["owner"], {}, { toString: () => "owner" },
  ];
  for (const b of bad) {
    const shown = typeof b === "string" ? JSON.stringify(b) : Array.isArray(b) ? `array(${b.length})` : typeof b === "object" && b !== null ? "object" : String(b);
    it(`membership.role=${shown} (${typeof b}) -> staff`, async () => {
      process.env.VERCEL_ENV = "production";
      getSessionUserMock.mockResolvedValue({ id: "u", email: "u@3j.test" });
      getMembershipMock.mockResolvedValue({ shopId: "shop-1", role: b });
      getDevRoleMock.mockReturnValue("owner");
      const { getEffectiveRole } = await import("./role");
      await expect(getEffectiveRole()).resolves.toBe("staff");
      expect(getDevRoleMock).not.toHaveBeenCalled();
    });
  }

  it("getMembership() itself throws (e.g. service client env missing) -> never resolves to owner/admin (rejecting is acceptable: fail closed)", async () => {
    process.env.VERCEL_ENV = "production";
    getSessionUserMock.mockResolvedValue({ id: "u", email: "u@3j.test" });
    getMembershipMock.mockRejectedValue(new Error("SUPABASE_SERVICE_ROLE_KEY not set"));
    getDevRoleMock.mockReturnValue("owner");
    const { getEffectiveRole } = await import("./role");
    const settled = await getEffectiveRole().then(
      (r) => ({ ok: true as const, r }),
      () => ({ ok: false as const, r: null }),
    );
    if (settled.ok) expect(settled.r).toBe("staff");
    expect(getDevRoleMock).not.toHaveBeenCalled();
  });
});

describe("QA matrix — isOwnerOrAdmin is a strict allowlist", () => {
  it("only the two exact strings pass; everything else (non-strings, prototype keys, boxed strings) fails", async () => {
    const { isOwnerOrAdmin } = await import("./owner-admin");
    const passes: unknown[] = ["owner", "admin"];
    const fails: unknown[] = [
      "staff", "Owner", "ADMIN", " owner", "owner ", "", "viewer", "__proto__", "constructor", "toString",
      0, 1, NaN, true, null, undefined, [], ["owner"], {}, new String("owner"), { valueOf: () => "owner" },
    ];
    for (const p of passes) {
      expect(isOwnerOrAdmin(p as never)).toBe(true);
    }
    for (const f of fails) {
      expect(isOwnerOrAdmin(f as never)).toBe(false);
    }
  });
});

// Round 2 (M1): NODE_ENV=production is a backup "real deployment" signal for when
// VERCEL_ENV is missing (Vercel not exposing system env / self-hosted next start).
// vitest runs with NODE_ENV="test", which is why every case above still models local dev.
describe("getEffectiveRole — NODE_ENV=production backup signal", () => {
  it("suite default NODE_ENV is 'test' (the premise of every local-dev case in this file)", () => {
    expect(process.env.NODE_ENV).toBe("test");
  });

  it("VERCEL_ENV unset + NODE_ENV=production + no session + AUTH_GATE unset + DEV_ROLE=owner -> staff", async () => {
    vi.stubEnv("NODE_ENV", "production");
    getSessionUserMock.mockResolvedValue(null);
    getDevRoleMock.mockReturnValue("owner");

    const { getEffectiveRole } = await import("./role");
    await expect(getEffectiveRole()).resolves.toBe("staff");
    expect(getDevRoleMock).not.toHaveBeenCalled();
  });

  it("VERCEL_ENV unset + NODE_ENV=production + getSessionUser() throws + AUTH_GATE=off -> staff", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.AUTH_GATE = "off";
    getSessionUserMock.mockRejectedValue(new Error("boom"));
    getDevRoleMock.mockReturnValue("admin");

    const { getEffectiveRole } = await import("./role");
    await expect(getEffectiveRole()).resolves.toBe("staff");
    expect(getDevRoleMock).not.toHaveBeenCalled();
  });

  it('VERCEL_ENV="development" + NODE_ENV=production -> staff (production build wins, fail-closed)', async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.VERCEL_ENV = "development";
    getSessionUserMock.mockResolvedValue(null);
    getDevRoleMock.mockReturnValue("owner");

    const { getEffectiveRole } = await import("./role");
    await expect(getEffectiveRole()).resolves.toBe("staff");
    expect(getDevRoleMock).not.toHaveBeenCalled();
  });

  it("VERCEL_ENV unset + NODE_ENV=development + no session -> DEV_ROLE (owner) (must not break)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    getSessionUserMock.mockResolvedValue(null);
    getDevRoleMock.mockReturnValue("owner");

    const { getEffectiveRole } = await import("./role");
    await expect(getEffectiveRole()).resolves.toBe("owner");
  });

  it("VERCEL_ENV unset + NODE_ENV=test (suite default) + no session -> DEV_ROLE (owner) (must not break)", async () => {
    getSessionUserMock.mockResolvedValue(null);
    getDevRoleMock.mockReturnValue("owner");

    const { getEffectiveRole } = await import("./role");
    await expect(getEffectiveRole()).resolves.toBe("owner");
  });

  it("NODE_ENV=production + real session + owner membership -> owner (logged-in owner never demoted)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    getSessionUserMock.mockResolvedValue({ id: "user-1", email: "owner@3j.test" });
    getMembershipMock.mockResolvedValue({ shopId: "shop-1", role: "owner" });

    const { getEffectiveRole } = await import("./role");
    await expect(getEffectiveRole()).resolves.toBe("owner");
  });
});
