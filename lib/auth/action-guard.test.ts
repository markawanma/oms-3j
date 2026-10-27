// lib/auth/action-guard.test.ts — requireMemberAccess() (H1 Phase 2, design §2/§5).
// The helper is the READ gate every member-level server action calls first.
// Mocks sit on the session layer (getSessionUser/getMembership), NOT on the
// helper, so these cases pin the helper's own decision table:
//   ห้ามผ่าน : gate on + no session · pending (session, no membership) ·
//             getSessionUser throws (fail-closed)
//   ต้องไม่พัง: gate off (zero auth calls) · owner/admin/staff member -> null
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSessionUserMock = vi.fn();
const getMembershipMock = vi.fn();
const requireSessionIfGateOnMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: () => getSessionUserMock(),
  getMembership: (userId: string) => getMembershipMock(userId),
  requireSessionIfGateOn: () => requireSessionIfGateOnMock(),
}));

const originalAuthGate = process.env.AUTH_GATE;

beforeEach(() => {
  vi.clearAllMocks();
  // React.cache() is per-request; a fresh module per test keeps one case's
  // cached answer from masking the next case's real behaviour.
  vi.resetModules();
  delete process.env.AUTH_GATE;
});

afterEach(() => {
  if (originalAuthGate === undefined) delete process.env.AUTH_GATE;
  else process.env.AUTH_GATE = originalAuthGate;
});

describe("requireMemberAccess — ห้ามผ่าน", () => {
  it("gate on + no session -> 'ต้องเข้าสู่ระบบก่อน' และไม่แตะ getMembership", async () => {
    process.env.AUTH_GATE = "on";
    getSessionUserMock.mockResolvedValue(null);
    const { requireMemberAccess } = await import("./action-guard");

    await expect(requireMemberAccess()).resolves.toEqual({ ok: false, error: "ต้องเข้าสู่ระบบก่อน" });
    expect(getMembershipMock).not.toHaveBeenCalled();
  });

  it("gate on + session แต่ไม่มี shop_member (pending/ถูกถอด) -> 'บัญชีนี้ยังไม่ได้รับอนุมัติให้ใช้งาน'", async () => {
    process.env.AUTH_GATE = "on";
    getSessionUserMock.mockResolvedValue({ id: "user-pending", email: "p@3j.test" });
    getMembershipMock.mockResolvedValue(null);
    const { requireMemberAccess } = await import("./action-guard");

    await expect(requireMemberAccess()).resolves.toEqual({
      ok: false,
      error: "บัญชีนี้ยังไม่ได้รับอนุมัติให้ใช้งาน",
    });
    expect(getMembershipMock).toHaveBeenCalledWith("user-pending");
  });

  it("gate on + getSessionUser throw (env auth พัง) -> fail-closed เหมือนไม่มี session", async () => {
    process.env.AUTH_GATE = "on";
    getSessionUserMock.mockRejectedValue(new Error("Missing Supabase Auth env"));
    const { requireMemberAccess } = await import("./action-guard");

    await expect(requireMemberAccess()).resolves.toEqual({ ok: false, error: "ต้องเข้าสู่ระบบก่อน" });
    expect(getMembershipMock).not.toHaveBeenCalled();
  });

  it("gate on + getMembership throw (service client สร้างไม่ได้) -> fail-closed ไม่ใช่ผ่าน", async () => {
    process.env.AUTH_GATE = "on";
    getSessionUserMock.mockResolvedValue({ id: "user-1", email: null });
    getMembershipMock.mockRejectedValue(new Error("missing service key"));
    const { requireMemberAccess } = await import("./action-guard");

    await expect(requireMemberAccess()).resolves.toEqual({
      ok: false,
      error: "บัญชีนี้ยังไม่ได้รับอนุมัติให้ใช้งาน",
    });
  });

  it("AUTH_GATE ค่าอื่นที่ไม่ใช่ 'on' (เช่น 'ON', 'true') = gate ปิด — ตรงกับ session.ts ที่เทียบ === 'on' เท่านั้น", async () => {
    // pin พฤติกรรมเดิมของแอป: ไม่ normalize ค่า env (requireSessionIfGateOn/role.ts เทียบ === "on" เหมือนกัน)
    process.env.AUTH_GATE = "ON";
    const { requireMemberAccess } = await import("./action-guard");

    await expect(requireMemberAccess()).resolves.toBeNull();
    expect(getSessionUserMock).not.toHaveBeenCalled();
  });
});

describe("requireMemberAccess — ต้องไม่พัง", () => {
  it("gate off -> null และไม่เรียก getSessionUser/getMembership เลย (DEV flow เดิม)", async () => {
    delete process.env.AUTH_GATE;
    const { requireMemberAccess } = await import("./action-guard");

    await expect(requireMemberAccess()).resolves.toBeNull();
    expect(getSessionUserMock).not.toHaveBeenCalled();
    expect(getMembershipMock).not.toHaveBeenCalled();
  });

  it("gate on + owner member -> null", async () => {
    process.env.AUTH_GATE = "on";
    getSessionUserMock.mockResolvedValue({ id: "user-o", email: "o@3j.test" });
    getMembershipMock.mockResolvedValue({ shopId: "shop-1", role: "owner" });
    const { requireMemberAccess } = await import("./action-guard");

    await expect(requireMemberAccess()).resolves.toBeNull();
  });

  it("gate on + staff member -> null (staff ที่เป็นสมาชิกจริงยังอ่านได้เท่าเดิม)", async () => {
    process.env.AUTH_GATE = "on";
    getSessionUserMock.mockResolvedValue({ id: "user-s", email: "s@3j.test" });
    getMembershipMock.mockResolvedValue({ shopId: "shop-1", role: "staff" });
    const { requireMemberAccess } = await import("./action-guard");

    await expect(requireMemberAccess()).resolves.toBeNull();
  });

  it("ห่อด้วย React cache: เรียก 2 ครั้งใน request เดียว -> getSessionUser/getMembership อย่างละ 1 ครั้ง", async () => {
    // vitest รันนอก request scope ของ Next — `cache` ตัวจริงของ React ไม่ dedupe
    // ที่นี่ (ไม่มี dispatcher) จึงแทนด้วย memoizer ง่ายๆ เพื่อพิสูจน์ว่าฟังก์ชัน
    // ถูกส่งผ่าน cache() จริง (ถ้าใครถอด cache ออก เคสนี้ล้ม) ส่วนการ dedupe จริง
    // เป็นพฤติกรรมของ React ใน request ซึ่งทดสอบได้เฉพาะบน Next runtime
    vi.doMock("react", () => ({
      cache: <A extends unknown[], R>(fn: (...a: A) => R) => {
        let memo: { v: R } | null = null;
        return (...a: A): R => (memo ??= { v: fn(...a) }).v;
      },
    }));
    process.env.AUTH_GATE = "on";
    getSessionUserMock.mockResolvedValue({ id: "user-o", email: null });
    getMembershipMock.mockResolvedValue({ shopId: "shop-1", role: "owner" });
    const { requireMemberAccess } = await import("./action-guard");

    await requireMemberAccess();
    await requireMemberAccess();

    expect(getSessionUserMock).toHaveBeenCalledTimes(1);
    expect(getMembershipMock).toHaveBeenCalledTimes(1);
    vi.doUnmock("react");
  });
});
