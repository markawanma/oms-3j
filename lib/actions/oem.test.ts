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
const schemaMock = vi.fn();

vi.mock("@/lib/auth/role", () => ({
  getEffectiveRole: () => getEffectiveRoleMock(),
}));

vi.mock("@/lib/dev/context", () => ({
  getDevShopId: () => "shop-1",
}));

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    // schema() records its argument: oem_metal_price_set lives in `analytics`,
    // and a silent switch to `public` would otherwise keep every case green.
    schema: (name: string) => {
      schemaMock(name);
      return { rpc: rpcMock };
    },
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
    expect(schemaMock).toHaveBeenCalledWith("analytics");
    // Whole payload, key for key — NOT objectContaining. objectContaining
    // passes when EXTRA keys appear, so it would have stayed green if
    // p_as_of were ever added back (the H2 regression this file exists to
    // catch). Adding a parameter to this RPC should fail here on purpose.
    expect(rpcMock).toHaveBeenCalledWith("oem_metal_price_set", {
      p_shop_id: "shop-1",
      p_metal: "silver",
      p_price: 67.7,
      p_source: "manual",
    });
  });

  it("accepts the inclusive bounds themselves — 5 and 500 must pass", async () => {
    // 5 and 500 are inclusive in all four layers that must agree:
    // saveMetalPrice, silverSpotValidationError, oem_metal_price_set (0129)
    // and the sheet-sync trigger. An off-by-one in any of them shows up here.
    const { saveMetalPrice } = await import("./oem");
    expect((await saveMetalPrice({ metal: "silver", priceThbPerGram: 5 })).ok).toBe(true);
    expect((await saveMetalPrice({ metal: "silver", priceThbPerGram: 500 })).ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(2);
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

  it("never sends p_as_of, even if a caller smuggles asOfDate past TypeScript", async () => {
    const { saveMetalPrice } = await import("./oem");
    const result = await saveMetalPrice({
      metal: "silver",
      priceThbPerGram: 67.7,
      // @ts-expect-error — SaveMetalPriceInput no longer has `asOfDate` (H2);
      // this simulates a hand-built payload hitting the server action
      // directly. p_as_of must never reach the RPC: oem_metal_price_set
      // resolves "today" (Asia/Bangkok) itself, and an attacker-chosen date
      // could overwrite a past day's price row or plant a future-dated one.
      asOfDate: "2026-01-01",
    });
    expect(result.ok).toBe(true);
    expect(rpcMock.mock.calls[0][1]).not.toHaveProperty("p_as_of");
    expect(Object.keys(rpcMock.mock.calls[0][1]).sort()).toEqual([
      "p_metal",
      "p_price",
      "p_shop_id",
      "p_source",
    ]);
  });

  it("surfaces an RPC error as the generic Thai failure message (never leaks the raw DB error)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom", code: "XXXXX" } });
    const { saveMetalPrice } = await import("./oem");
    const result = await saveMetalPrice({ metal: "silver", priceThbPerGram: 67.7 });
    expect(result).toEqual({ ok: false, error: "บันทึกราคาโลหะไม่สำเร็จ ลองใหม่อีกครั้ง" });
  });

  // 0186 (PM-A): ช่วงที่เจ้าของเคาะ 20 ต.ค. — ทอง 100% 2,000–8,000 · ทองเหลือง 0.10–1.00 บาท/กรัม (= 100–1,000 บาท/กก.) · ด่านจริงอยู่ที่ RPC + CHECK ตาราง
  it("0186: gold per-gram bounds — 2000/8000 pass · 1999.99/8000.01 fail with a message that names the unit (before any RPC)", async () => {
    const { saveMetalPrice } = await import("./oem");
    expect((await saveMetalPrice({ metal: "gold", priceThbPerGram: 2000 })).ok).toBe(true);
    expect((await saveMetalPrice({ metal: "gold", priceThbPerGram: 8000 })).ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(2);
    rpcMock.mockClear();
    for (const bad of [1999.99, 8000.01, 41250]) {
      const result = await saveMetalPrice({ metal: "gold", priceThbPerGram: bad });
      expect(result.ok, String(bad)).toBe(false);
      if (!result.ok) expect(result.error).toContain("2,000–8,000 บาท/กรัม");
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("0186: brass per-gram bounds — 0.1/1 pass · 0.0999/1.0001/350 (a per-kg price typed as per-gram) fail", async () => {
    const { saveMetalPrice } = await import("./oem");
    expect((await saveMetalPrice({ metal: "brass", priceThbPerGram: 0.1 })).ok).toBe(true);
    expect((await saveMetalPrice({ metal: "brass", priceThbPerGram: 1 })).ok).toBe(true);
    rpcMock.mockClear();
    for (const bad of [0.0999, 1.0001, 350]) {
      const result = await saveMetalPrice({ metal: "brass", priceThbPerGram: bad });
      expect(result.ok, String(bad)).toBe(false);
      if (!result.ok) expect(result.error).toContain("100–1,000 บาท/กก.");
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

// 0186: กรอกราคาทอง/ทองเหลืองด้วยหน่วยหน้างานจริง ให้ DB แปลง
describe("saveMetalPriceInput", () => {
  const RPC_OK = {
    data: { metal: "gold", as_of_date: "2026-10-20", price_thb_per_gram: "2804.1271", input_value: "41250.00", input_unit: "assoc965_sell_per_baht" },
    error: null,
  };

  it("rejects staff before any RPC call", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { saveMetalPriceInput } = await import("./oem");
    const result = await saveMetalPriceInput({ metal: "gold", inputValue: 41250 });
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("sends exactly 4 args (no p_as_of — today only; no p_source) and returns what the SERVER stored (not the client preview)", async () => {
    rpcMock.mockResolvedValue(RPC_OK);
    const { saveMetalPriceInput } = await import("./oem");
    const result = await saveMetalPriceInput({ metal: "gold", inputValue: " 41,250 " });
    expect(rpcMock).toHaveBeenCalledWith("oem_metal_price_set_input", {
      p_shop_id: "shop-1",
      p_metal: "gold",
      p_input_value: 41250,
      p_input_unit: "assoc965_sell_per_baht",
    });
    expect(schemaMock).toHaveBeenCalledWith("analytics");
    expect(result).toEqual({
      ok: true,
      data: { metal: "gold", asOfDate: "2026-10-20", priceThbPerGram: 2804.1271, inputValue: 41250, inputUnit: "assoc965_sell_per_baht" },
    });
  });

  it("brass: sends thb_per_kg and the typed kg value", async () => {
    rpcMock.mockResolvedValue({ data: { metal: "brass", as_of_date: "2026-10-20", price_thb_per_gram: 0.35, input_value: 350, input_unit: "thb_per_kg" }, error: null });
    const { saveMetalPriceInput } = await import("./oem");
    const result = await saveMetalPriceInput({ metal: "brass", inputValue: "350" });
    expect(rpcMock).toHaveBeenCalledWith("oem_metal_price_set_input", { p_shop_id: "shop-1", p_metal: "brass", p_input_value: 350, p_input_unit: "thb_per_kg" });
    expect(result.ok && result.data).toMatchObject({ priceThbPerGram: 0.35, inputUnit: "thb_per_kg" });
  });

  it("rejects every out-of-range / malformed price before any RPC — with the CONVERTED value in the message (UX P4)", async () => {
    const { saveMetalPriceInput } = await import("./oem");
    const cases: Array<[Parameters<typeof saveMetalPriceInput>[0], string]> = [
      [{ metal: "gold", inputValue: "29420.91" }, "1999.9993"],
      [{ metal: "gold", inputValue: "117683.69" }, "8000.0007"],
      [{ metal: "gold", inputValue: 2800 }, "ต่ำกว่า 2,000"],
      [{ metal: "brass", inputValue: "99.99" }, "100–1,000 บาท/กก."],
      [{ metal: "brass", inputValue: "1000.01" }, "100–1,000 บาท/กก."],
      [{ metal: "gold", inputValue: "" }, "ตัวเลข"],
      [{ metal: "gold", inputValue: "NaN" }, "ตัวเลข"],
      [{ metal: "gold", inputValue: -1 }, "ตัวเลข"],
      [{ metal: "gold", inputValue: "41250.123" }, "ทศนิยม"],
    ];
    for (const [input, fragment] of cases) {
      const result = await saveMetalPriceInput(input);
      expect(result.ok, JSON.stringify(input)).toBe(false);
      if (!result.ok) expect(result.error, JSON.stringify(input)).toContain(fragment);
    }
    // โลหะนอก gold/brass (เงิน/silver999/product) กรอกด้วยหน่วยหน้างานไม่ได้
    for (const metal of ["silver", "silver999", "product"]) {
      expect((await saveMetalPriceInput({ metal, inputValue: 72 } as never)).ok).toBe(false);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("boundary values that must pass: 29,420.92 · 117,683.68 · brass 100 · 1000", async () => {
    rpcMock.mockResolvedValue(RPC_OK);
    const { saveMetalPriceInput } = await import("./oem");
    for (const input of [
      { metal: "gold", inputValue: "29420.92" },
      { metal: "gold", inputValue: "117683.68" },
      { metal: "brass", inputValue: 100 },
      { metal: "brass", inputValue: 1000 },
    ] as const) {
      expect((await saveMetalPriceInput(input)).ok, JSON.stringify(input)).toBe(true);
    }
    expect(rpcMock).toHaveBeenCalledTimes(4);
  });

  it("passes the DB's own Thai 22023 message through; any other error → generic (never leaks the raw DB error)", async () => {
    const { saveMetalPriceInput } = await import("./oem");
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", message: "แปลงแล้วได้ 1999.9993 บาท/กรัม (โลหะ 100%) อยู่นอกช่วงที่รับ 2,000-8,000 บาท/กรัม" } });
    const a = await saveMetalPriceInput({ metal: "gold", inputValue: 41250 });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.error).toContain("1999.9993");
    rpcMock.mockResolvedValue({ data: null, error: { code: "XX000", message: "relation analytics.oem_metal_price does not exist" } });
    const b = await saveMetalPriceInput({ metal: "gold", inputValue: 41250 });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error).not.toContain("oem_metal_price");
  });
});
