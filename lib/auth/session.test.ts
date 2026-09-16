// lib/auth/session.test.ts — verifyCodeFor is pure, no mocking needed.
// getSessionUser/getMembership/requireOwnerSession all depend on live
// Supabase clients (cookies() + network) and are exercised indirectly via
// lib/actions/members.test.ts's mocked requireOwnerSession instead of here.
import { describe, expect, it } from "vitest";
import { verifyCodeFor } from "./session";

describe("verifyCodeFor", () => {
  it("returns the last 6 characters of the user id, uppercased", () => {
    expect(verifyCodeFor("11111111-1111-1111-1111-111111111abc")).toBe("111ABC");
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

  it("already-uppercase input round-trips unchanged", () => {
    expect(verifyCodeFor("ffffffff-ffff-ffff-ffff-ffffffFFABCD")).toBe("FFABCD");
  });
});
