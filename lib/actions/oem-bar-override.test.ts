// lib/actions/oem-bar-override.test.ts — 0163 ราคาพิเศษเงินแท่ง: ด่านฝั่ง server action
//   1. toCalcInputPayload (ผ่าน calcPrice/saveQuote): ส่ง bar_price_override_* "เฉพาะเมื่อมีราคา" · ไม่มี = payload เดิมเป๊ะ
//   2. ด่านที่ขอบ action: รูปร่างของราคา/เหตุผล/วัน ถูกปฏิเสธก่อนถึง RPC (ตัดสิน "ต่ำกว่าทุน" ที่ DB เท่านั้น)
//   3. saveQuote ส่ง p_bar_valid_until เฉพาะเมื่อมีวัน (ไม่มี = 9 params เดิม — app เก่า/ใบปกติไม่เปลี่ยน)
//   4. fromCalcResult / fromInputPayload: อ่าน override กลับมาครบ — ไม่งั้นเปิดร่าง/ใบที่เก็บแล้ว ราคาพิเศษหายเงียบๆ
// pattern mock เดียวกับ lib/actions/oem.test.ts (+ chain ของ .from() สำหรับ getQuoteItems)
import { beforeEach, describe, expect, it, vi } from "vitest";

const getEffectiveRoleMock = vi.fn();
const rpcMock = vi.fn();
const schemaMock = vi.fn();
const fromRowsMock = vi.fn();

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => getEffectiveRoleMock() }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => null })); // 0165: ไม่มี session = ไม่ส่ง p_actor_id
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => "shop-1" }));
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    schema: (name: string) => {
      schemaMock(name);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.order = () => Promise.resolve(fromRowsMock());
      return { rpc: rpcMock, from: () => chain };
    },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveRoleMock.mockResolvedValue("owner");
  rpcMock.mockResolvedValue({ data: null, error: null });
});

// calc jsonb ที่ DB (0163) คืนเมื่อมีราคาพิเศษ — ตัวเลข fixture สมมติ
function overrideCalcJson(pass: boolean | null) {
  return {
    is_complete: true,
    missing: [],
    breakdown: {
      q_run: null,
      reject_pct_total: null,
      margin_pct_used: null,
      metal: { per_piece: null },
      labor: { per_piece: 0, steps: [] },
      batch: { per_piece: 0, lines: [] },
      nre: { cad: null, print3d: null, mold: null, cost: 0, price: 0 },
      bar: {
        size: "1_baht",
        price_column: "bar_1_baht",
        bar_price_per_piece: 1100,
        web_price_per_piece: 1000,
        override: { thb: 1100, reason: "bid งาน A" },
        engrave_image_thb: null,
        engrave_text_thb: null,
        margin_pct_embedded: 0.19,
        cost_basis: "buyback",
        as_of_date: "2026-10-07",
        sheet_time: "13:00",
        captured_at: "2026-10-07T06:00:00Z",
        source: "sheet",
      },
      cost_piece: 750,
      price_per_piece: 1100,
      quote_total: 2200,
      margin_actual_pct: 0.3182,
    },
    floors: {
      qty: { pass: true, moq: null, actual: 2 },
      job_value: { pass: true, min: 0 },
      metal_weight: { pass: true, applies: false },
      margin: { state: null, value: null, blended: 0.3182, target: 0.3 },
      price_fresh: { pass: true, as_of_date: "2026-10-07", today_bkk: "2026-10-07" },
      bar_price: { applies: true, pass },
    },
    warnings: ["ราคาพิเศษ — ยืนราคาตามวันที่กรอกในใบ (ไม่เกิน 30 วัน)"],
    formula_version: 4,
  };
}

const barInput = (over: Record<string, unknown> = {}) => ({
  metal: "silver999" as const,
  barSize: "1_baht" as const,
  qty: 2,
  engraveImageThb: null,
  engraveTextThb: null,
  ...over,
});

describe("calcPrice — payload ของราคาพิเศษ", () => {
  it("มีราคา+เหตุผล → ส่ง bar_price_override_thb/_reason ไปกับ payload เดิม (key ต่อ key)", async () => {
    rpcMock.mockResolvedValue({ data: overrideCalcJson(true), error: null });
    const { calcPrice } = await import("./oem");
    const r = await calcPrice(barInput({ barPriceOverrideThb: 1100, barPriceOverrideReason: "bid งาน A" }));
    expect(r.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("oem_price_calc", {
      p_shop_id: "shop-1",
      p_input: {
        metal: "silver999",
        bar_size: "1_baht",
        qty: 2,
        engrave_image_thb: null,
        engrave_text_thb: null,
        as_of_date: null,
        bar_price_override_thb: 1100,
        bar_price_override_reason: "bid งาน A",
      },
    });
  });

  it("ไม่มีราคา → payload เดิมเป๊ะ ไม่มี key override เลย (ต้องไม่พัง — เท่ากับก่อน 0163)", async () => {
    rpcMock.mockResolvedValue({ data: overrideCalcJson(true), error: null });
    const { calcPrice } = await import("./oem");
    await calcPrice(barInput());
    const payload = rpcMock.mock.calls[0][1].p_input as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["as_of_date", "bar_size", "engrave_image_thb", "engrave_text_thb", "metal", "qty"]);
    // ฟอร์มส่ง null มา (ช่องว่าง) ก็ต้องไม่ถูกแปลงเป็น key
    rpcMock.mockClear();
    await calcPrice(barInput({ barPriceOverrideThb: null, barPriceOverrideReason: null }));
    expect(rpcMock.mock.calls[0][1].p_input).not.toHaveProperty("bar_price_override_thb");
    expect(rpcMock.mock.calls[0][1].p_input).not.toHaveProperty("bar_price_override_reason");
  });

  it("งานผลิตที่มีค่า override หลงมา → ไม่ถูกส่ง (payload งานผลิตไม่มี key นี้)", async () => {
    rpcMock.mockResolvedValue({ data: overrideCalcJson(true), error: null });
    const { calcPrice } = await import("./oem");
    await calcPrice({
      metal: "silver",
      itemKind: "แหวน",
      polishTier: "เรียบ",
      qty: 10,
      weightG: 5,
      barPriceOverrideThb: 1100,
      barPriceOverrideReason: "หลงมา",
    });
    expect(rpcMock.mock.calls[0][1].p_input).not.toHaveProperty("bar_price_override_thb");
    expect(rpcMock.mock.calls[0][1].p_input).not.toHaveProperty("bar_price_override_reason");
  });

  it.each([
    ["ราคา 0", { barPriceOverrideThb: 0, barPriceOverrideReason: "x" }],
    ["ราคาติดลบ", { barPriceOverrideThb: -5, barPriceOverrideReason: "x" }],
    ["ราคา NaN", { barPriceOverrideThb: NaN, barPriceOverrideReason: "x" }],
    ["ราคา Infinity", { barPriceOverrideThb: Infinity, barPriceOverrideReason: "x" }],
    ["ราคาเกิน 1,000,000", { barPriceOverrideThb: 1_000_001, barPriceOverrideReason: "x" }],
    ["ทศนิยม 3 ตำแหน่ง", { barPriceOverrideThb: 1234.567, barPriceOverrideReason: "x" }],
    ["ไม่มีเหตุผล", { barPriceOverrideThb: 1100, barPriceOverrideReason: null }],
    ["เหตุผลเว้นวรรค", { barPriceOverrideThb: 1100, barPriceOverrideReason: "   " }],
    ["เหตุผลลอยไม่มีราคา", { barPriceOverrideThb: null, barPriceOverrideReason: "ลอย" }],
  ])("ปฏิเสธก่อนถึง RPC: %s", async (_label, over) => {
    const { calcPrice } = await import("./oem");
    const r = await calcPrice(barInput(over));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toBe("คำนวณราคาไม่สำเร็จ — ตรวจข้อมูลที่กรอก แล้วลองใหม่อีกครั้ง"); // ต้องเป็นข้อความที่บอกสาเหตุ
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("calcPrice — อ่านผลที่มีราคาพิเศษกลับมา (fromCalcResult)", () => {
  it("override / ราคาเว็บ / floors.barPrice ถูก map ครบ", async () => {
    rpcMock.mockResolvedValue({ data: overrideCalcJson(true), error: null });
    const { calcPrice } = await import("./oem");
    const r = await calcPrice(barInput({ barPriceOverrideThb: 1100, barPriceOverrideReason: "bid งาน A" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const bar = r.data.breakdown.bar!;
    expect(bar.barPricePerPiece).toBe(1100);
    expect(bar.webPricePerPiece).toBe(1000);
    expect(bar.override).toEqual({ thb: 1100, reason: "bid งาน A" });
    expect(r.data.floors.barPrice).toEqual({ applies: true, pass: true });
  });

  it("pass=false (ต่ำกว่าทุน) และ pass=null (ตัดสินไม่ได้) ไม่ถูกแปลงเป็น true", async () => {
    const { calcPrice } = await import("./oem");
    rpcMock.mockResolvedValue({ data: overrideCalcJson(false), error: null });
    const below = await calcPrice(barInput({ barPriceOverrideThb: 700, barPriceOverrideReason: "x" }));
    expect(below.ok && below.data.floors.barPrice).toEqual({ applies: true, pass: false });
    rpcMock.mockResolvedValue({ data: overrideCalcJson(null), error: null });
    const unknown = await calcPrice(barInput({ barPriceOverrideThb: 700, barPriceOverrideReason: "x" }));
    expect(unknown.ok && unknown.data.floors.barPrice).toEqual({ applies: true, pass: null });
  });

  it("ผลที่ไม่มีราคาพิเศษ (jsonb เดิม) → override = null · barPrice = undefined (ต้องไม่พัง)", async () => {
    const legacy = overrideCalcJson(true) as Record<string, unknown>;
    const b = legacy.breakdown as { bar: Record<string, unknown> };
    delete b.bar.override;
    delete b.bar.web_price_per_piece;
    delete (legacy.floors as Record<string, unknown>).bar_price;
    rpcMock.mockResolvedValue({ data: legacy, error: null });
    const { calcPrice } = await import("./oem");
    const r = await calcPrice(barInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.breakdown.bar?.override).toBeNull();
    expect(r.data.breakdown.bar?.webPricePerPiece).toBeNull();
    expect(r.data.floors.barPrice).toBeUndefined();
  });

  it("🔴 ผลที่ map แล้วไม่มีราคารับซื้อคืน (kilo_buy/buy_per_baht) แม้ RPC จะคืนมาโดยพลาด", async () => {
    const leaky = overrideCalcJson(true) as Record<string, unknown>;
    (leaky.breakdown as { bar: Record<string, unknown> }).bar.kilo_buy = 75000;
    (leaky.breakdown as { bar: Record<string, unknown> }).bar.buy_per_baht = 750;
    rpcMock.mockResolvedValue({ data: leaky, error: null });
    const { calcPrice } = await import("./oem");
    const r = await calcPrice(barInput({ barPriceOverrideThb: 1100, barPriceOverrideReason: "x" }));
    expect(JSON.stringify(r)).not.toMatch(/kilo_buy|buy_per_baht|kiloBuy|buyPerBaht|75000/);
  });
});

describe("saveQuote — ราคาพิเศษ + วันยืนราคา", () => {
  const overrideItem = { input: barInput({ barPriceOverrideThb: 1100, barPriceOverrideReason: "bid งาน A" }) };

  it("มีวัน → ส่ง p_bar_valid_until · input ของ item มี override keys", async () => {
    rpcMock.mockResolvedValue({ data: "quote-1", error: null });
    const { saveQuote } = await import("./oem");
    const r = await saveQuote({ items: [overrideItem], status: "quoted", barValidUntil: "2026-10-17" });
    expect(r).toEqual({ ok: true, data: { quoteId: "quote-1" } });
    const [fn, args] = rpcMock.mock.calls[0];
    expect(fn).toBe("oem_quote_save");
    expect(args.p_bar_valid_until).toBe("2026-10-17");
    expect(args.p_items[0].input.bar_price_override_thb).toBe(1100);
    expect(args.p_items[0].input.bar_price_override_reason).toBe("bid งาน A");
  });

  it("ไม่มีวัน (ใบปกติ/app เก่า) → ไม่มี key p_bar_valid_until เลย = 9 params เดิมเป๊ะ", async () => {
    rpcMock.mockResolvedValue({ data: "quote-2", error: null });
    const { saveQuote } = await import("./oem");
    await saveQuote({ items: [{ input: barInput() }], status: "quoted" });
    expect(Object.keys(rpcMock.mock.calls[0][1]).sort()).toEqual(
      [
        "p_approval_note",
        "p_customer_contact",
        "p_customer_name",
        "p_discount_reason",
        "p_discount_thb",
        "p_items",
        "p_quote_id",
        "p_shop_id",
        "p_status",
      ].sort()
    );
    rpcMock.mockClear();
    await saveQuote({ items: [{ input: barInput() }], status: "draft", barValidUntil: "" });
    expect(rpcMock.mock.calls[0][1]).not.toHaveProperty("p_bar_valid_until");
    rpcMock.mockClear();
    await saveQuote({ items: [{ input: barInput() }], status: "draft", barValidUntil: null });
    expect(rpcMock.mock.calls[0][1]).not.toHaveProperty("p_bar_valid_until");
  });

  it("flow ร่าง → ออกใบ (ฟอร์มเดิมในหน้าเดียว): ทั้งสองครั้งส่ง override + วันชุดเดียวกัน — ราคาพิเศษไม่หายระหว่างทาง", async () => {
    rpcMock.mockResolvedValue({ data: "quote-3", error: null });
    const { saveQuote } = await import("./oem");
    await saveQuote({ items: [overrideItem], status: "draft", barValidUntil: "2026-10-17" });
    await saveQuote({ items: [overrideItem], quoteId: "quote-3", status: "quoted", barValidUntil: "2026-10-17" });
    const [draft, quoted] = rpcMock.mock.calls.map((c) => c[1]);
    expect(draft.p_status).toBe("draft");
    expect(quoted.p_status).toBe("quoted");
    expect(quoted.p_quote_id).toBe("quote-3");
    expect(quoted.p_items).toEqual(draft.p_items);
    expect(quoted.p_bar_valid_until).toBe(draft.p_bar_valid_until);
  });

  it.each(["17/10/2026", "2026-10-17T00:00:00Z", "tomorrow", "2026-1-7"])("วันรูปแบบผิด %s → ปฏิเสธก่อนถึง RPC", async (bad) => {
    const { saveQuote } = await import("./oem");
    const r = await saveQuote({ items: [overrideItem], status: "quoted", barValidUntil: bad });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ราคาพิเศษไม่มีเหตุผล / ผิดรูปร่างใน item ใดก็ได้ → ปฏิเสธก่อนถึง RPC", async () => {
    const { saveQuote } = await import("./oem");
    const r = await saveQuote({
      items: [{ input: barInput() }, { input: barInput({ barPriceOverrideThb: 1100, barPriceOverrideReason: "" }) }],
      status: "draft",
    });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("22023 จาก DB (ต่ำกว่าทุน / วันเกิน 30) ส่งข้อความไทยของด่านให้ผู้ใช้เห็นตรงๆ", async () => {
    const msg = "oem_quote_save: รายการที่ 1 — ราคาพิเศษต่ำกว่าทุน ออกใบเสนอราคาไม่ได้ ไม่มีทางลัด ต้องปรับราคาขึ้น";
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", message: msg } });
    const { saveQuote } = await import("./oem");
    const r = await saveQuote({ items: [overrideItem], status: "quoted", barValidUntil: "2026-10-17" });
    expect(r).toEqual({ ok: false, error: msg });
  });

  it("staff บันทึกไม่ได้ (ด่านสิทธิ์เดิม) แม้มีราคาพิเศษ", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { saveQuote } = await import("./oem");
    const r = await saveQuote({ items: [overrideItem], status: "draft" });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("getQuoteItems — อ่านใบที่เก็บไว้กลับมา (fromInputPayload)", () => {
  const baseRow = {
    id: "i1",
    shop_id: "shop-1",
    quote_id: "q1",
    quote_no: "RT-0001",
    seq: 1,
    product_id: null,
    sku_snapshot: null,
    product_name_snapshot: null,
    qty: 2,
    cost_piece: 750,
    price_per_piece: 1100,
    item_total: 2200,
    created_at: "2026-10-07T03:00:00Z",
    updated_at: "2026-10-07T03:00:00Z",
  };

  it("input ที่เก็บเป็น snake_case มี override → อ่านกลับเป็น barPriceOverrideThb/Reason + calc.override (เปิดร่างแล้วไม่หาย)", async () => {
    fromRowsMock.mockReturnValue({
      data: [
        {
          ...baseRow,
          input: {
            metal: "silver999",
            bar_size: "1_baht",
            qty: 2,
            engrave_image_thb: null,
            engrave_text_thb: null,
            as_of_date: null,
            bar_price_override_thb: 1100,
            bar_price_override_reason: "bid งาน A",
          },
          calc: overrideCalcJson(true),
        },
      ],
      error: null,
    });
    const { getQuoteItems } = await import("./oem");
    const r = await getQuoteItems("q1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data[0].input.barPriceOverrideThb).toBe(1100);
    expect(r.data[0].input.barPriceOverrideReason).toBe("bid งาน A");
    expect(r.data[0].calc?.breakdown.bar?.override).toEqual({ thb: 1100, reason: "bid งาน A" });
  });

  it("แถวเก่าก่อน 0163 (ไม่มี key) → null/null ไม่พัง", async () => {
    const legacyCalc = overrideCalcJson(true) as Record<string, unknown>;
    delete ((legacyCalc.breakdown as { bar: Record<string, unknown> }).bar as Record<string, unknown>).override;
    fromRowsMock.mockReturnValue({
      data: [
        {
          ...baseRow,
          input: { metal: "silver999", bar_size: "1_baht", qty: 2, engrave_image_thb: null, engrave_text_thb: null, as_of_date: null },
          calc: legacyCalc,
        },
      ],
      error: null,
    });
    const { getQuoteItems } = await import("./oem");
    const r = await getQuoteItems("q1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data[0].input.barPriceOverrideThb).toBeNull();
    expect(r.data[0].input.barPriceOverrideReason).toBeNull();
    expect(r.data[0].calc?.breakdown.bar?.override).toBeNull();
  });
});
