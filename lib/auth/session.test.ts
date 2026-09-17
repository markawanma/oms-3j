// lib/auth/session.test.ts — verifyCodeFor is pure (given a fixed
// SIGNUP_CODE_SECRET), no Supabase mocking needed.
// getSessionUser/getMembership/requireOwnerSession/requireSessionIfGateOn
// all depend on live Supabase clients (cookies() + network) and are
// exercised indirectly via lib/actions/members.test.ts's mocked
// requireOwnerSession instead of here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyCodeFor } from "./session";

describe("verifyCodeFor", () => {
  const originalSecret = process.env.SIGNUP_CODE_SECRET;
  const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    // Pin a known secret so the HMAC output is a fixed, testable vector
    // regardless of what's ambient in the shell/CI environment.
    process.env.SIGNUP_CODE_SECRET = "test-secret";
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.SIGNUP_CODE_SECRET;
    else process.env.SIGNUP_CODE_SECRET = originalSecret;
    if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
  });

  it("matches a known HMAC-SHA256 vector for a fixed secret (M4 — no longer userId.slice(-6))", () => {
    expect(verifyCodeFor("11111111-1111-1111-1111-111111111abc")).toBe("07A5D2");
  });

  it("is deterministic for the same id", () => {
    const id = "22222222-2222-2222-2222-222222222def";
    expect(verifyCodeFor(id)).toBe(verifyCodeFor(id));
  });

  it("differs for different ids (not a constant fallback)", () => {
    const a = verifyCodeFor("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    const b = verifyCodeFor("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    expect(a).not.toBe(b);
  });

  it("is 6 uppercase hex chars and NOT a substring of the userId (pre-M4 behavior would have been)", () => {
    const id = "11111111-1111-1111-1111-111111111abc";
    const code = verifyCodeFor(id);
    expect(code).toMatch(/^[0-9A-F]{6}$/);
    // Pre-M4 this function returned userId.slice(-6).toUpperCase() ->
    // "111ABC" for this id, derivable by anyone who ever saw the raw uuid.
    expect(code).not.toBe(id.slice(-6).toUpperCase());
  });

  it("falls back to sha256(SUPABASE_SERVICE_ROLE_KEY) when SIGNUP_CODE_SECRET is unset — still deterministic, never throws", () => {
    delete process.env.SIGNUP_CODE_SECRET;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "fallback-service-key-value";

    const id = "33333333-3333-3333-3333-333333333333";
    const first = verifyCodeFor(id);
    const second = verifyCodeFor(id);

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9A-F]{6}$/);
  });

  it("switching the secret changes the output for the same id (proves the secret is actually used as the HMAC key)", () => {
    const id = "44444444-4444-4444-4444-444444444444";
    process.env.SIGNUP_CODE_SECRET = "secret-a";
    const withA = verifyCodeFor(id);
    process.env.SIGNUP_CODE_SECRET = "secret-b";
    const withB = verifyCodeFor(id);
    expect(withA).not.toBe(withB);
  });
});

describe("getMembership — shop-scoped lookup (security review 2026-09-17, M1)", () => {
  const originalDevShopId = process.env.DEV_SHOP_ID;

  beforeEach(() => {
    process.env.DEV_SHOP_ID = "shop-1";
    vi.resetModules();
  });

  afterEach(() => {
    if (originalDevShopId === undefined) delete process.env.DEV_SHOP_ID;
    else process.env.DEV_SHOP_ID = originalDevShopId;
    vi.doUnmock("@/lib/supabase/server");
  });

  it("filters by shop_id (getDevShopId()) as well as user_id — a row for another shop must not match this shop's membership", async () => {
    const eqCalls: [string, unknown][] = [];
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: () => {
          const builder = {
            select: () => builder,
            eq: (col: string, val: unknown) => {
              eqCalls.push([col, val]);
              return builder;
            },
            maybeSingle: async () => ({ data: { shop_id: "shop-1", role: "owner" }, error: null }),
          };
          return builder;
        },
      }),
    }));

    const { getMembership } = await import("./session");
    const result = await getMembership("user-1");

    expect(eqCalls).toContainEqual(["user_id", "user-1"]);
    expect(eqCalls).toContainEqual(["shop_id", "shop-1"]); // M1 — was missing before this fix
    expect(result).toEqual({ shopId: "shop-1", role: "owner" });
  });

  it("no row for this shop (e.g. membership belongs to a different shop_id) -> null, not a leaked cross-shop role", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: () => {
          const builder = {
            select: () => builder,
            eq: () => builder,
            // Postgres would exclude the row once .eq("shop_id", "shop-1") is
            // added if the real row's shop_id is "shop-2" — simulate that by
            // returning no match.
            maybeSingle: async () => ({ data: null, error: null }),
          };
          return builder;
        },
      }),
    }));

    const { getMembership } = await import("./session");
    const result = await getMembership("user-1");

    expect(result).toBeNull();
  });
});
