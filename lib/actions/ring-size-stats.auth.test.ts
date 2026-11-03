// lib/actions/ring-size-stats.auth.test.ts — เคส 2 ของ brief: ไม่ล็อกอิน / ไม่ใช่สมาชิกร้าน ⇒ ปฏิเสธก่อน RPC
//
// ต่างจาก ring-size-stats.test.ts ตรงที่ไม่ mock getEffectiveRole — ใช้ lib/auth/role.ts จริง แล้ว mock แค่ชั้น session/membership
// เพื่อพิสูจน์ว่า "ด่านแอปคือด่านเดียว" (RPC ข้ามการตรวจสิทธิ์เมื่อเป็น service_role) ทำงานจริงครบทุกสถานะ auth
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSessionUserMock = vi.fn();
const getMembershipMock = vi.fn();
const getDevRoleMock = vi.fn();
const rpcMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: () => getSessionUserMock(),
  getMembership: (userId: string) => getMembershipMock(userId),
}));

vi.mock("@/lib/dev/context", () => ({
  getDevRole: () => getDevRoleMock(),
  getDevShopId: () => "shop-from-env",
}));

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({ schema: () => ({ rpc: rpcMock }) }),
}));

const INPUT = { from: "2026-10-05", to: "2026-11-03" };
const originalAuthGate = process.env.AUTH_GATE;

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules(); // React.cache ของ getEffectiveRole ต้องไม่ข้ามเทสต์
  process.env.AUTH_GATE = "on";
  getDevRoleMock.mockReturnValue("owner"); // ต้องไม่มีผลเมื่อ gate เปิด — ถ้ามีผล = ช่องโหว่
  rpcMock.mockResolvedValue({ data: { sessions: 0, returning: 0, measured: 0 }, error: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  if (originalAuthGate === undefined) delete process.env.AUTH_GATE;
  else process.env.AUTH_GATE = originalAuthGate;
});

async function call() {
  const { getRingSizeStats } = await import("./ring-size-stats");
  return getRingSizeStats(INPUT);
}

describe("ไม่ผ่านด่านสิทธิ์ ⇒ RPC ไม่ถูกเรียกเลย", () => {
  it("ไม่ล็อกอิน (ไม่มี session · AUTH_GATE=on) แม้ DEV_ROLE=owner ⇒ ปฏิเสธ", async () => {
    getSessionUserMock.mockResolvedValue(null);
    const r = await call();
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("session พัง/ตั้งค่า auth ไม่ครบ (getSessionUser throw) ⇒ ปฏิเสธ (ไม่เท่ากับ owner)", async () => {
    getSessionUserMock.mockRejectedValue(new Error("Supabase Auth env missing"));
    const r = await call();
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ล็อกอินแล้วแต่ไม่ใช่สมาชิกร้านใดเลย (pending/ถูกถอนสิทธิ์) แม้ DEV_ROLE=owner ⇒ ปฏิเสธ", async () => {
    getSessionUserMock.mockResolvedValue({ id: "user-pending", email: "p@3j.test" });
    getMembershipMock.mockResolvedValue(null);
    const r = await call();
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(getDevRoleMock).not.toHaveBeenCalled();
  });

  it("สมาชิกร้านระดับ staff ⇒ ปฏิเสธ (ด่านชั้นแอป — RPC ไม่กันให้เพราะเป็น service_role)", async () => {
    getSessionUserMock.mockResolvedValue({ id: "user-staff", email: "s@3j.test" });
    getMembershipMock.mockResolvedValue({ shopId: "shop-from-env", role: "staff" });
    const r = await call();
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("ผ่านด่านสิทธิ์ (ต้องไม่พัง)", () => {
  it.each(["owner", "admin"] as const)("สมาชิกร้านระดับ %s ⇒ เรียก RPC ได้", async (role) => {
    getSessionUserMock.mockResolvedValue({ id: "user-1", email: "o@3j.test" });
    getMembershipMock.mockResolvedValue({ shopId: "shop-from-env", role });
    getDevRoleMock.mockReturnValue("staff"); // env ต้องไม่ลดสิทธิ์คนที่ล็อกอินจริง
    const r = await call();
    expect(r.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});
