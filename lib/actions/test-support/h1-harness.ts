// lib/actions/test-support/h1-harness.ts — shared test harness for the H1 Phase 2
// in-action authz guard tests (orders / crm reads / dashboard / ... and the
// Phase 2/3 files that follow).
//
// What it fakes, and what it deliberately does NOT:
//   fakes     : the SESSION layer (getSessionUser / getMembership /
//               requireSessionIfGateOn), lib/dev/context (shop id + DEV_ROLE),
//               and the supabase service client (records every .from()/.rpc()).
//   real      : lib/auth/action-guard.ts AND lib/auth/role.ts — so a test proves the
//               action really calls the helper (not a mocked-away one) and that a
//               pending user really collapses to "staff" via getEffectiveRole().
//
// Usage (vi.mock factories are hoisted above imports, so wire it like this):
//   const h = vi.hoisted(() => ({ getSessionUser: vi.fn(), getMembership: vi.fn(),
//     devRole: vi.fn(), fromMock: vi.fn(), rpcMock: vi.fn() }));
//   vi.mock("@/lib/auth/session", async () => (await import("./test-support/h1-harness")).sessionModuleMock(h));
//   vi.mock("@/lib/dev/context", async () => (await import("./test-support/h1-harness")).devContextMock(h));
//   vi.mock("@/lib/supabase/server", async () => (await import("./test-support/h1-harness")).supabaseServerMock(h));
//   vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { expect, it, type Mock } from "vitest";

export interface Harness {
  getSessionUser: Mock;
  getMembership: Mock;
  devRole: Mock;
  fromMock: Mock;
  rpcMock: Mock;
}

/** Awaitable, infinitely chainable stand-in for a supabase-js query builder:
 * any method returns the builder, awaiting it yields `result`. */
export function chain(result: unknown): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
        return () => proxy;
      },
    },
  );
  return proxy;
}

export function sessionModuleMock(h: Harness) {
  return {
    getSessionUser: () => h.getSessionUser(),
    getMembership: (userId: string) => h.getMembership(userId),
    // same contract as the real one: no-op unless AUTH_GATE === "on", then throw without a session
    requireSessionIfGateOn: async () => {
      if (process.env.AUTH_GATE !== "on") return;
      const user = await h.getSessionUser();
      if (!user) throw new Error("ไม่ได้เข้าสู่ระบบ");
    },
  };
}

export function devContextMock(h: Harness) {
  return {
    getDevShopId: () => "shop-1",
    getDevRole: () => h.devRole(),
  };
}

export function supabaseServerMock(h: Harness) {
  const from = (table: string) => h.fromMock(table);
  const rpc = (...args: unknown[]) => h.rpcMock(...args);
  return { getServiceClient: () => ({ from, rpc, schema: () => ({ from, rpc }) }) };
}

export interface AuthState {
  /** AUTH_GATE=on? */
  gate: boolean;
  /** DEV_ROLE (only has a vote when there is no real session and the gate is off) */
  devRole?: "owner" | "admin" | "staff";
  /** null = no session · "throw" = getSessionUser rejects (auth env broken) */
  user?: null | "throw" | { id: string; email?: string | null };
  /** shop_member row for the session user (null = pending / revoked) */
  membership?: null | { shopId: string; role: "owner" | "admin" | "staff" };
}

export const AUTH = {
  /** DEV flow: gate off, DEV_ROLE=owner */
  gateOffOwner: { gate: false, devRole: "owner" },
  /** DEV flow: gate off, DEV_ROLE=staff (repo default) */
  gateOffStaff: { gate: false, devRole: "staff" },
  /** gate on, anonymous */
  noSession: { gate: true, user: null },
  /** gate on, Supabase auth env broken -> getSessionUser throws */
  sessionThrows: { gate: true, user: "throw" },
  /** gate on, signed up but not approved: real session, NO shop_member */
  pending: { gate: true, user: { id: "u-pending", email: "p@3j.test" }, membership: null },
  /** gate on, approved staff member */
  staffMember: { gate: true, user: { id: "u-staff" }, membership: { shopId: "shop-1", role: "staff" } },
  /** gate on, approved admin member */
  adminMember: { gate: true, user: { id: "u-admin" }, membership: { shopId: "shop-1", role: "admin" } },
  /** gate on, owner */
  ownerMember: { gate: true, user: { id: "u-owner" }, membership: { shopId: "shop-1", role: "owner" } },
} satisfies Record<string, AuthState>;

export function setAuth(h: Harness, s: AuthState): void {
  if (s.gate) process.env.AUTH_GATE = "on";
  else delete process.env.AUTH_GATE;

  if (s.user === "throw") h.getSessionUser.mockRejectedValue(new Error("Missing Supabase Auth env"));
  else h.getSessionUser.mockResolvedValue(s.user ?? null);
  h.getMembership.mockResolvedValue(s.membership ?? null);
  h.devRole.mockReturnValue(s.devRole ?? "staff");
}

/** DB tables default: empty result with count 0 (fetchAllRows needs a non-null count). */
export const EMPTY_RESULT = { data: [], error: null, count: 0 };

/** Wire fromMock/rpcMock to per-table results (anything unlisted -> EMPTY_RESULT). */
export function setTables(h: Harness, tables: Record<string, unknown>, rpcResult: unknown = { data: null, error: null }): void {
  h.fromMock.mockImplementation((table: string) => chain(table in tables ? tables[table] : EMPTY_RESULT));
  h.rpcMock.mockResolvedValue(rpcResult);
}

/** True if the action reached the database at all. */
export function touchedDb(h: Harness): boolean {
  return h.fromMock.mock.calls.length > 0 || h.rpcMock.mock.calls.length > 0;
}

export const MSG = {
  needLogin: "ต้องเข้าสู่ระบบก่อน",
  notApproved: "บัญชีนี้ยังไม่ได้รับอนุมัติให้ใช้งาน",
} as const;

// ---------------------------------------------------------------------------
// Table-driven gate matrix (shared by the Phase 2/3 files). Call inside a
// describe(); the file's own beforeEach must already reset mocks + setAuth.
//
//   member : READ-member  -> requireMemberAccess()
//   owner  : READ-owner / WRITE -> requireWriteAccess(requireOwnerAdmin)
//
// ห้ามผ่าน  : every denied auth state returns exactly {ok:false,error} and the DB mock is never touched
// ต้องไม่พัง: every allowed auth state reaches the DB and the action's own success predicate holds
// ---------------------------------------------------------------------------
export type GateKind = "member" | "owner";

export interface GateCase {
  call: () => Promise<unknown>;
  /** per-table results for the allowed path (default: everything empty) */
  tables?: Record<string, unknown>;
  rpcResult?: unknown;
  /** extra wiring after setTables (e.g. rpc builder that needs .maybeSingle()) */
  setup?: () => void;
  /** success predicate for the allowed path (default: result.ok === true) */
  allowed?: (result: any) => boolean;
}

export function gateMatrix(h: Harness, kind: GateKind, c: GateCase, deniedByRole: string): void {
  const denied: [string, AuthState, string][] =
    kind === "member"
      ? [
          ["gate on + ไม่มี session", AUTH.noSession, MSG.needLogin],
          ["gate on + getSessionUser throw (fail-closed)", AUTH.sessionThrows, MSG.needLogin],
          ["gate on + pending (มี session ไม่มี shop_member)", AUTH.pending, MSG.notApproved],
        ]
      : [
          ["gate on + ไม่มี session", AUTH.noSession, MSG.needLogin],
          ["gate on + getSessionUser throw (fail-closed)", AUTH.sessionThrows, MSG.needLogin],
          ["gate on + pending (role ยุบเป็น staff)", AUTH.pending, deniedByRole],
          ["gate on + staff member", AUTH.staffMember, deniedByRole],
          ["gate off + DEV_ROLE=staff (default ของ repo)", AUTH.gateOffStaff, deniedByRole],
        ];
  const allowed: [string, AuthState][] =
    kind === "member"
      ? [
          ["gate off + DEV_ROLE=staff (DEV flow เดิม)", AUTH.gateOffStaff],
          ["gate off + DEV_ROLE=owner", AUTH.gateOffOwner],
          ["gate on + owner", AUTH.ownerMember],
          ["gate on + admin", AUTH.adminMember],
          ["gate on + staff member", AUTH.staffMember],
        ]
      : [
          ["gate off + DEV_ROLE=owner", AUTH.gateOffOwner],
          ["gate on + owner", AUTH.ownerMember],
          ["gate on + admin", AUTH.adminMember],
        ];

  for (const [label, auth, error] of denied) {
    it(`ห้ามผ่าน: ${label} -> {ok:false} และ DB ไม่ถูกแตะ`, async () => {
      setAuth(h, auth);
      setTables(h, c.tables ?? {}, c.rpcResult);
      c.setup?.();

      await expect(c.call()).resolves.toEqual({ ok: false, error });
      expect(touchedDb(h)).toBe(false);
    });
  }
  for (const [label, auth] of allowed) {
    it(`ต้องไม่พัง: ${label} -> ผ่าน guard แล้วทำงานตามเดิม`, async () => {
      setAuth(h, auth);
      setTables(h, c.tables ?? {}, c.rpcResult);
      c.setup?.();

      const result = await c.call();
      const isAllowed = c.allowed ?? ((r: { ok?: boolean }) => r?.ok === true);
      expect(isAllowed(result as { ok?: boolean }), JSON.stringify(result)).toBe(true);
      expect(touchedDb(h)).toBe(true);
    });
  }
}
