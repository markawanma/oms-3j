// lib/actions/hero-stock.test.ts — addHeroWatch/removeHeroWatch session
// gate (security review 2026-09-16, H4). /stock/hero is exempt from
// middleware.ts's AUTH_GATE entirely (public wall-display screen), so these
// two mutations are the only place left that can require a real session —
// requireOwnerAdmin() alone is just a DEV_ROLE `if`, not authentication.
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSessionIfGateOnMock = vi.fn();
const getEffectiveRoleMock = vi.fn();
const rpcMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireSessionIfGateOn: () => requireSessionIfGateOnMock(),
}));

// hero-stock.ts's requireOwnerAdmin() reads role via getEffectiveRole()
// (lib/auth/role.ts, 17 ก.ย. 69 fix) — not getDevRole() directly anymore.
vi.mock("@/lib/auth/role", () => ({
  getEffectiveRole: () => getEffectiveRoleMock(),
}));

vi.mock("@/lib/dev/context", () => ({
  getDevShopId: () => "shop-1",
}));

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    schema: () => ({ rpc: rpcMock }),
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveRoleMock.mockResolvedValue("owner");
  requireSessionIfGateOnMock.mockResolvedValue(undefined); // AUTH_GATE off (or on + real session) — no-op
  rpcMock.mockResolvedValue({ data: null, error: null });
});

describe("addHeroWatch — session gate (H4)", () => {
  it("gate off / gate on with a real session — requireSessionIfGateOn is checked, RPC proceeds", async () => {
    const { addHeroWatch } = await import("./hero-stock");

    const result = await addHeroWatch("prod-1", 3, null);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(requireSessionIfGateOnMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("gate on + no session (requireSessionIfGateOn throws) — rejected before the RPC ever runs", async () => {
    requireSessionIfGateOnMock.mockRejectedValue(new Error("ไม่ได้เข้าสู่ระบบ"));
    const { addHeroWatch } = await import("./hero-stock");

    const result = await addHeroWatch("prod-1", 3, null);

    expect(result).toEqual({ ok: false, error: "ต้องเข้าสู่ระบบก่อน" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("staff role is still rejected even with a valid session (requireOwnerAdmin unaffected by H4)", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { addHeroWatch } = await import("./hero-stock");

    const result = await addHeroWatch("prod-1", 3, null);

    expect(result).toEqual({ ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูจอสต็อก Hero SKU ได้" });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("removeHeroWatch — session gate (H4)", () => {
  it("gate off / gate on with a real session — proceeds normally", async () => {
    const { removeHeroWatch } = await import("./hero-stock");

    const result = await removeHeroWatch("prod-1");

    expect(result).toEqual({ ok: true, data: undefined });
    expect(requireSessionIfGateOnMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("gate on + no session — rejected before the RPC ever runs", async () => {
    requireSessionIfGateOnMock.mockRejectedValue(new Error("ไม่ได้เข้าสู่ระบบ"));
    const { removeHeroWatch } = await import("./hero-stock");

    const result = await removeHeroWatch("prod-1");

    expect(result).toEqual({ ok: false, error: "ต้องเข้าสู่ระบบก่อน" });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
