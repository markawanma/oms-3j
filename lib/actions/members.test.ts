// lib/actions/members.test.ts
//
// Mocks BOTH the owner-session gate (lib/auth/session.ts) and the Supabase
// client (lib/supabase/server.ts) — this must never touch a real Supabase
// project (3j-migration-traps skill #11: writes/deletes are not something to
// exercise against live/persistent state in a test). Covers the two
// must-reject cases called out in the A2-lite backend brief:
//   - approveMember rejects a wrong verify code
//   - removeMember refuses to delete yourself or the last owner
// plus one "must NOT break" happy path per case, per CLAUDE.md's "เคสที่ต้อง
// ไม่พัง สำคัญเท่าเคสที่ต้องถูกปฏิเสธ".

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOwnerSessionMock = vi.fn();
const getUserByIdMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireOwnerSession: () => requireOwnerSessionMock(),
  verifyCodeFor: (userId: string) => userId.slice(-6).toUpperCase(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: fromMock,
    auth: { admin: { getUserById: getUserByIdMock, listUsers: vi.fn() } },
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

/** Minimal chainable stand-in for supabase-js's PostgrestFilterBuilder:
 * .select()/.eq()/.delete() return itself (so calls can chain any order),
 * .maybeSingle()/.upsert() are terminal and return the configured result,
 * and the builder itself is awaitable (`await supabase.from(...).select(...).eq(...)`
 * without a terminal call, used by the owner-count HEAD query). */
function chainable(result: { data?: unknown; error?: unknown; count?: number | null }) {
  const promise = Promise.resolve(result);
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    insert: vi.fn(() => promise),
    maybeSingle: vi.fn(() => promise),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  return builder;
}

const OWNER_ID = "11111111-1111-1111-1111-111111111own";
const SHOP_ID = "shop-1";

beforeEach(() => {
  vi.clearAllMocks();
  requireOwnerSessionMock.mockResolvedValue({ userId: OWNER_ID, shopId: SHOP_ID });
});

describe("approveMember — must reject", () => {
  it("wrong verify code, never touches Supabase", async () => {
    const { approveMember } = await import("./members");
    const targetId = "22222222-2222-2222-2222-222222222abc"; // verifyCodeFor -> "222ABC"

    const result = await approveMember({ userId: targetId, role: "staff", code: "000000" });

    expect(result).toEqual({ ok: false, error: "รหัสยืนยันไม่ตรง" });
    expect(getUserByIdMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("code check is case-insensitive on the RIGHT code but still rejects a near-miss", async () => {
    const { approveMember } = await import("./members");
    const targetId = "22222222-2222-2222-2222-222222222abc"; // -> "222ABC"

    const result = await approveMember({ userId: targetId, role: "staff", code: "222ABD" }); // one char off

    expect(result).toEqual({ ok: false, error: "รหัสยืนยันไม่ตรง" });
  });

  it("invalid role is rejected before code is even checked", async () => {
    const { approveMember } = await import("./members");
    const targetId = "22222222-2222-2222-2222-222222222abc";

    // @ts-expect-error deliberately invalid role for the test
    const result = await approveMember({ userId: targetId, role: "owner", code: "222ABC" });

    expect(result).toEqual({ ok: false, error: "role ไม่ถูกต้อง" });
  });

  it("M1 — user already has a shop_member row (e.g. owner) is never upserted over", async () => {
    const { approveMember } = await import("./members");
    const targetId = "22222222-2222-2222-2222-222222222abc"; // -> "222ABC"

    getUserByIdMock.mockResolvedValue({ data: { user: { id: targetId } }, error: null });
    fromMock.mockReturnValueOnce(chainable({ data: { user_id: targetId }, error: null })); // existing-member check: found

    const result = await approveMember({ userId: targetId, role: "staff", code: "222ABC" });

    expect(result).toEqual({ ok: false, error: "ผู้ใช้นี้เป็นสมาชิกอยู่แล้ว" });
    expect(fromMock).toHaveBeenCalledTimes(1); // insert must never be reached
  });

  it("M1 — concurrent approval race (unique violation on insert) reports the same error, not a generic failure", async () => {
    const { approveMember } = await import("./members");
    const targetId = "22222222-2222-2222-2222-222222222abc"; // -> "222ABC"

    getUserByIdMock.mockResolvedValue({ data: { user: { id: targetId } }, error: null });
    fromMock
      .mockReturnValueOnce(chainable({ data: null, error: null })) // existing-member check: not found (yet)
      .mockReturnValueOnce(chainable({ data: null, error: { code: "23505", message: "duplicate key" } })); // insert loses the race

    const result = await approveMember({ userId: targetId, role: "staff", code: "222ABC" });

    expect(result).toEqual({ ok: false, error: "ผู้ใช้นี้เป็นสมาชิกอยู่แล้ว" });
  });
});

describe("approveMember — must NOT break", () => {
  it("correct code (case-insensitive) + existing auth user + not-yet-a-member inserts and succeeds", async () => {
    const { approveMember } = await import("./members");
    const targetId = "22222222-2222-2222-2222-222222222abc"; // -> "222ABC"

    getUserByIdMock.mockResolvedValue({ data: { user: { id: targetId } }, error: null });
    fromMock
      .mockReturnValueOnce(chainable({ data: null, error: null })) // existing-member check: not found
      .mockReturnValueOnce(chainable({ data: null, error: null })); // insert

    const result = await approveMember({ userId: targetId, role: "staff", code: "222abc" }); // lowercase on purpose

    expect(result).toEqual({ ok: true });
    expect(getUserByIdMock).toHaveBeenCalledWith(targetId);
    expect(fromMock).toHaveBeenCalledTimes(2);
  });
});

describe("removeMember — must reject", () => {
  it("removing yourself, never touches Supabase", async () => {
    const { removeMember } = await import("./members");

    const result = await removeMember(OWNER_ID);

    expect(result).toEqual({ ok: false, error: "ห้ามลบตัวเอง" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("removing the last owner", async () => {
    const { removeMember } = await import("./members");
    const targetId = "owner-2";

    fromMock
      .mockReturnValueOnce(chainable({ data: { role: "owner" }, error: null })) // targetRow lookup
      .mockReturnValueOnce(chainable({ count: 1, error: null })); // owner count

    const result = await removeMember(targetId);

    expect(result).toEqual({ ok: false, error: "ห้ามลบเจ้าของคนสุดท้าย" });
    expect(fromMock).toHaveBeenCalledTimes(2); // delete() must never be reached
  });

  it("target user is not a member at all", async () => {
    const { removeMember } = await import("./members");

    fromMock.mockReturnValueOnce(chainable({ data: null, error: null })); // targetRow lookup: no row

    const result = await removeMember("not-a-member");

    expect(result).toEqual({ ok: false, error: "ไม่พบสมาชิกนี้" });
  });
});

describe("removeMember — must NOT break", () => {
  it("removing a non-owner member succeeds", async () => {
    const { removeMember } = await import("./members");
    const targetId = "staff-1";

    fromMock
      .mockReturnValueOnce(chainable({ data: { role: "staff" }, error: null })) // targetRow lookup
      .mockReturnValueOnce(chainable({ error: null })); // delete

    const result = await removeMember(targetId);

    expect(result).toEqual({ ok: true });
    expect(fromMock).toHaveBeenCalledTimes(2); // no owner-count check needed for a non-owner
  });

  it("removing one owner when a second owner still remains succeeds", async () => {
    const { removeMember } = await import("./members");
    const targetId = "owner-2";

    fromMock
      .mockReturnValueOnce(chainable({ data: { role: "owner" }, error: null })) // targetRow lookup
      .mockReturnValueOnce(chainable({ count: 2, error: null })) // owner count: two owners
      .mockReturnValueOnce(chainable({ error: null })); // delete

    const result = await removeMember(targetId);

    expect(result).toEqual({ ok: true });
    expect(fromMock).toHaveBeenCalledTimes(3);
  });
});

describe("every export requires an owner session first", () => {
  it("listPendingUsers propagates requireOwnerSession's rejection untouched", async () => {
    requireOwnerSessionMock.mockRejectedValue(new Error("ต้องเป็นเจ้าของร้านเท่านั้น"));
    const { listPendingUsers } = await import("./members");

    await expect(listPendingUsers()).rejects.toThrow("ต้องเป็นเจ้าของร้านเท่านั้น");
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("approveMember propagates requireOwnerSession's rejection untouched (pending/staff caller)", async () => {
    requireOwnerSessionMock.mockRejectedValue(new Error("ต้องเป็นเจ้าของร้านเท่านั้น"));
    const { approveMember } = await import("./members");

    await expect(approveMember({ userId: "x", role: "staff", code: "AAAAAA" })).rejects.toThrow(
      "ต้องเป็นเจ้าของร้านเท่านั้น"
    );
  });
});
