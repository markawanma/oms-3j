// lib/actions/oem.test.ts — saveMetalPrice coverage, added while QA-ing the
// restored "ล็อกราคานี้ไว้วันนี้" button (MetalPriceSection.tsx) + the S2
// `source` field removal from SaveMetalPriceInput (lib/oem/types.ts). This
// action is the ONLY caller of analytics.oem_metal_price_set, and it's the
// last client-reachable gate before that RPC, guarding two things that have
// bitten this feature before:
//   1. an invalid/out-of-bound/NaN silver price reaching the RPC instead of
//      failing here with a real message — if it slips through, the RPC's
//      exception gets swallowed into the generic "บันทึกราคาโลหะไม่สำเร็จ
//      ลองใหม่อีกครั้ง" (see the catch block below), which tells the owner
//      nothing about WHY (this is exactly the failure mode the task brief's
//      case #2 asks QA to prove doesn't happen).
//   2. `source` ever reaching the RPC as anything other than "manual" — the
//      client-side type no longer even HAS a `source` field (S2), but that's
//      a compile-time guard only; this proves the RUNTIME payload is
//      hardcoded too, even for a caller that smuggles an extra `source`
//      property past TypeScript (e.g. via `as any` / a future careless
//      caller of this same action from somewhere else in the app).
// Mocking pattern copied from lib/actions/production.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getEffectiveRoleMock = vi.fn();
const rpcMock = vi.fn();

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
  rpcMock.mockResolvedValue({ data: null, error: null });
});

describe("saveMetalPrice", () => {
  it("rejects staff before any RPC call", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { saveMetalPrice } = await import("./oem");
    const result = await saveMetalPrice({ metal: "silver", priceThbPerGram: 67.7 });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a silver price below the 5 floor before any RPC call", async () => {
    const { saveMetalPrice } = await import("./oem");
    const result = await saveMetalPrice({ metal: "silver", priceThbPerGram: 4.99 });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a silver price above the 500 ceiling before any RPC call (the ฿1,097 per-baht-typed-as-per-gram bug)", async () => {
    const { saveMetalPrice } = await import("./oem");
    const result = await saveMetalPrice({ metal: "silver", priceThbPerGram: 1097 });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects NaN before any RPC call, with a real message (not the generic RPC-failure fallback)", async () => {
    const { saveMetalPrice } = await import("./oem");
    const result = await saveMetalPrice({ metal: "silver", priceThbPerGram: NaN });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toBe("บันทึกราคาโลหะไม่สำเร็จ ลองใหม่อีกครั้ง");
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a non-silver metal at 0 (must stay > 0, no 5-500 bound applies to gold/brass)", async () => {
    const { saveMetalPrice } = await import("./oem");
    const result = await saveMetalPrice({ metal: "gold", priceThbPerGram: 0 });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("accepts a valid silver price and always sends p_source: 'manual'", async () => {
    const { saveMetalPrice } = await import("./oem");
    const result = await saveMetalPrice({ metal: "silver", priceThbPerGram: 67.7 });
    expect(result.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith(
      "oem_metal_price_set",
      expect.objectContaining({ p_metal: "silver", p_price: 67.7, p_source: "manual" }),
    );
  });

  it("hardcodes p_source: 'manual' even if a caller smuggles a different source past TypeScript", async () => {
    const { saveMetalPrice } = await import("./oem");
    const result = await saveMetalPrice({
      metal: "silver",
      priceThbPerGram: 67.7,
      // @ts-expect-error — SaveMetalPriceInput no longer has `source` (S2);
      // this simulates a caller that bypasses the type (e.g. `as any`) to
      // prove the server action itself is the gate, not just the compiler.
      source: "sheet",
    });
    expect(result.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith(
      "oem_metal_price_set",
      expect.objectContaining({ p_source: "manual" }),
    );
  });

  it("surfaces an RPC error as the generic Thai failure message (never leaks the raw DB error)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom", code: "XXXXX" } });
    const { saveMetalPrice } = await import("./oem");
    const result = await saveMetalPrice({ metal: "silver", priceThbPerGram: 67.7 });
    expect(result).toEqual({ ok: false, error: "บันทึกราคาโลหะไม่สำเร็จ ลองใหม่อีกครั้ง" });
  });
});
