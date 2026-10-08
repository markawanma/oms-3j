// lib/actions/oem-production-override.test.ts — 0169 ราคาต่อชิ้นพิมพ์ทับของงานผลิต + note shape: ด่านฝั่ง server action
//   1. payload: ส่ง unit_price_override_thb / price_override_reason "เฉพาะเมื่อมีราคา" · ไม่มี = payload งานผลิตเดิมเป๊ะ
//   2. ด่านรูปร่างก่อนถึง RPC: ราคา (NaN/Inf/ทศนิยม/เพดาน) · เหตุผล whitelist (ต้องมีตัวอักษร/ตัวเลข) · เหตุผลลอย
//   3. L2: approval_note / เหตุผลต่อราคา มี control/bidi/ยาว > 500 → ปฏิเสธก่อนถึง RPC
//   4. อ่านกลับ: production_override / price_vs_cost / input.unit_price_override_thb · getQuoteApprovalGates
// pattern mock เดียวกับ lib/actions/oem-product-item.test.ts (ตัวเลข fixture สมมติ)
import { beforeEach, describe, expect, it, vi } from "vitest";

const getEffectiveRoleMock = vi.fn();
const rpcMock = vi.fn();
const maybeSingleMock = vi.fn();
const selectMock = vi.fn();

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => getEffectiveRoleMock() }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => null }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => "shop-1" }));
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    schema: () => {
      const chain: Record<string, unknown> = {};
      chain.select = (cols: string) => {
        selectMock(cols);
        return chain;
      };
      chain.eq = () => chain;
      chain.maybeSingle = () => Promise.resolve(maybeSingleMock());
      return { rpc: rpcMock, from: () => chain };
    },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const cp = (...codes: number[]) => String.fromCodePoint(...codes);

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveRoleMock.mockResolvedValue("owner");
  rpcMock.mockResolvedValue({ data: null, error: null });
});

function prodCalcJson(over: Record<string, unknown> = {}) {
  return {
    is_complete: true,
    missing: [],
    breakdown: {
      q_run: 50,
      reject_pct_total: 0.05,
      margin_pct_used: 0.5,
      metal: { per_piece: 100, price_used: 30, price_source: "manual" },
      labor: { per_piece: 20, steps: [] },
      batch: { per_piece: 0, lines: [] },
      nre: { cad: null, print3d: null, mold: null, cost: 0, price: 0 },
      cost_piece: 500,
      price_per_piece: 580,
      quote_total: 29000,
      margin_actual_pct: 0.1379,
      production_override: { thb: 580, reason: "ลูกค้าประจำ", formula_price_per_piece: 1000 },
    },
    floors: {
      qty: { pass: true, moq: 50, actual: 50 },
      job_value: { pass: true, min: 8000 },
      metal_weight: { pass: true, applies: false },
      margin: { state: "needs_approval_note", value: 0.1379, blended: 0.1379, target: 0.3 },
      price_vs_cost: { applies: true, pass: true },
    },
    warnings: [],
    formula_version: 3,
    ...over,
  };
}

const prodInput = (over: Record<string, unknown> = {}) => ({
  metal: "silver" as const,
  itemKind: "แหวน",
  polishTier: "เรียบ",
  qty: 50,
  weightG: 3.5,
  ...over,
});

describe("calcPrice — payload ราคาที่พิมพ์ทับ (งานผลิต)", () => {
  it("มีราคา + เหตุผล → ส่ง unit_price_override_thb / price_override_reason (ลบอักขระล่องหน + trim) ไปกับ payload เดิม", async () => {
    rpcMock.mockResolvedValue({ data: prodCalcJson(), error: null });
    const { calcPrice } = await import("./oem");
    const r = await calcPrice(prodInput({ unitPriceOverrideThb: 580, priceOverrideReason: "  ลูกค้าประจำ" + cp(0x2060) + " " }));
    expect(r.ok).toBe(true);
    const payload = rpcMock.mock.calls[0][1].p_input as Record<string, unknown>;
    expect(payload.unit_price_override_thb).toBe(580);
    expect(payload.price_override_reason).toBe("ลูกค้าประจำ");
    expect(payload.metal).toBe("silver");
    expect(payload.item_kind).toBe("แหวน");
  });

  it("ไม่มีราคา → payload เดิมเป๊ะ ไม่มี key override เลย (แม้ฟอร์มส่ง null / เหตุผลลอยมา) — ต้องไม่พัง", async () => {
    rpcMock.mockResolvedValue({ data: prodCalcJson(), error: null });
    const { calcPrice } = await import("./oem");
    await calcPrice(prodInput());
    const p1 = rpcMock.mock.calls[0][1].p_input as Record<string, unknown>;
    expect(p1).not.toHaveProperty("unit_price_override_thb");
    expect(p1).not.toHaveProperty("price_override_reason");
    rpcMock.mockClear();
    await calcPrice(prodInput({ unitPriceOverrideThb: null, priceOverrideReason: null }));
    const p2 = rpcMock.mock.calls[0][1].p_input as Record<string, unknown>;
    expect(p2).not.toHaveProperty("unit_price_override_thb");
    expect(p2).not.toHaveProperty("price_override_reason");
  });
});

describe("calcPrice — ด่านรูปร่างที่ขอบ action (ไม่ถึง RPC)", () => {
  it.each([
    ["ราคา 0", prodInput({ unitPriceOverrideThb: 0, priceOverrideReason: "เหตุผล" }), "ราคา"],
    ["ราคาติดลบ", prodInput({ unitPriceOverrideThb: -5, priceOverrideReason: "เหตุผล" }), "ราคา"],
    ["ราคา NaN", prodInput({ unitPriceOverrideThb: Number.NaN, priceOverrideReason: "เหตุผล" }), "ราคา"],
    ["ราคา Infinity", prodInput({ unitPriceOverrideThb: Number.POSITIVE_INFINITY, priceOverrideReason: "เหตุผล" }), "ราคา"],
    ["ราคาเกิน 1,000,000", prodInput({ unitPriceOverrideThb: 1_000_000.01, priceOverrideReason: "เหตุผล" }), "ราคา"],
    ["ราคาทศนิยม 3 ตำแหน่ง", prodInput({ unitPriceOverrideThb: 1.005, priceOverrideReason: "เหตุผล" }), "ทศนิยม"],
    ["ราคาเป็นสตริง", prodInput({ unitPriceOverrideThb: "580" as unknown as number, priceOverrideReason: "เหตุผล" }), "ราคา"],
    ["ไม่มีเหตุผล", prodInput({ unitPriceOverrideThb: 580 }), "เหตุผล"],
    ["เหตุผลช่องว่าง", prodInput({ unitPriceOverrideThb: 580, priceOverrideReason: "   " }), "เหตุผล"],
    ["เหตุผล '.' (whitelist)", prodInput({ unitPriceOverrideThb: 580, priceOverrideReason: "." }), "เหตุผล"],
    ["เหตุผล 👍 ล้วน", prodInput({ unitPriceOverrideThb: 580, priceOverrideReason: cp(0x1f44d) }), "เหตุผล"],
    ["เหตุผล U+2800 ล้วน", prodInput({ unitPriceOverrideThb: 580, priceOverrideReason: cp(0x2800) }), "เหตุผล"],
    ["เหตุผลล่องหนล้วน", prodInput({ unitPriceOverrideThb: 580, priceOverrideReason: cp(0x2060, 0xfeff) }), "เหตุผล"],
    ["เหตุผลไม่ใช่ข้อความ", prodInput({ unitPriceOverrideThb: 580, priceOverrideReason: 5 as unknown as string }), "ข้อความ"],
    ["เหตุผลลอย (ไม่มีราคา)", prodInput({ priceOverrideReason: "เหตุผลลอย" }), "ไม่ได้กรอกราคา"],
  ])("%s → ปฏิเสธ ไม่ยิง RPC", async (_n, input, fragment) => {
    const { calcPrice } = await import("./oem");
    const r = await calcPrice(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(fragment);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ขอบที่ต้องผ่าน: ราคา 1,000,000 · 0.01 · เหตุผลตัวเลขล้วน (ต้องไม่พัง)", async () => {
    rpcMock.mockResolvedValue({ data: prodCalcJson(), error: null });
    const { calcPrice } = await import("./oem");
    expect((await calcPrice(prodInput({ unitPriceOverrideThb: 1_000_000, priceOverrideReason: "123" }))).ok).toBe(true);
    expect((await calcPrice(prodInput({ unitPriceOverrideThb: 0.01, priceOverrideReason: "ก" }))).ok).toBe(true);
  });
});

describe("saveQuote / renegotiateQuote — L2 รูปร่างเหตุผล", () => {
  it.each([
    ["bidi", cp(0x202e) + "ok"],
    ["control", cp(7) + "ok"],
    ["ล่องหน", cp(0x200b) + "ok"],
    ["ยาว 501", "ก".repeat(501)],
  ])("approval_note %s → ปฏิเสธก่อนถึง RPC", async (_n, note) => {
    const { saveQuote } = await import("./oem");
    const r = await saveQuote({ items: [{ input: prodInput() }], status: "quoted", approvalNote: note });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("approval_note ปกติ (500 ตัว / อีโมจิ / หลายบรรทัด) ผ่านไปถึง RPC — ต้องไม่พัง", async () => {
    rpcMock.mockResolvedValue({ data: "q-1", error: null });
    const { saveQuote } = await import("./oem");
    for (const note of ["ก".repeat(500), "ok " + cp(0x1f468, 0x200d, 0x1f469), "บรรทัด1" + cp(10) + "บรรทัด2"]) {
      const r = await saveQuote({ items: [{ input: prodInput() }], status: "quoted", approvalNote: note });
      expect(r.ok).toBe(true);
    }
    expect(rpcMock).toHaveBeenCalledTimes(3);
  });

  it("saveQuote: รายการงานผลิตที่มีราคาทับถูกตรวจรูปร่างด้วย (ราคา 1.005 → ไม่ถึง RPC)", async () => {
    const { saveQuote } = await import("./oem");
    const r = await saveQuote({ items: [{ input: prodInput({ unitPriceOverrideThb: 1.005, priceOverrideReason: "เหตุผล" }) }], status: "draft" });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("renegotiateQuote: เหตุผลมี bidi/control/ยาว > 500 → ปฏิเสธก่อนถึง RPC · เหตุผลปกติผ่าน", async () => {
    const { renegotiateQuote } = await import("./oem");
    for (const reason of [cp(0x202e) + "x", cp(7) + "x", "ก".repeat(501)]) {
      const r = await renegotiateQuote({ quoteId: "q-1", newDiscountThb: 100, reason });
      expect(r.ok).toBe(false);
    }
    expect(rpcMock).not.toHaveBeenCalled();
    rpcMock.mockResolvedValue({ data: "q-2", error: null });
    const ok = await renegotiateQuote({ quoteId: "q-1", newDiscountThb: 100, reason: "ต่อรองกับลูกค้า" });
    expect(ok.ok).toBe(true);
  });
});

describe("อ่านกลับ", () => {
  it("fromCalcResult อ่าน production_override + price_vs_cost ครบ (admin เท่านั้น)", async () => {
    rpcMock.mockResolvedValue({ data: prodCalcJson(), error: null });
    const { calcPrice } = await import("./oem");
    const r = await calcPrice(prodInput({ unitPriceOverrideThb: 580, priceOverrideReason: "ลูกค้าประจำ" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.breakdown.productionOverride).toEqual({ thb: 580, reason: "ลูกค้าประจำ", formulaPricePerPiece: 1000 });
      expect(r.data.floors.priceVsCost).toEqual({ applies: true, pass: true });
      expect(r.data.floors.margin.state).toBe("needs_approval_note");
    }
  });

  it("price_vs_cost.pass=false / null อ่านถูก · calc ที่ไม่มี override → productionOverride = null, priceVsCost = undefined", async () => {
    const j = prodCalcJson();
    (j.floors as Record<string, unknown>).price_vs_cost = { applies: true, pass: false };
    rpcMock.mockResolvedValue({ data: j, error: null });
    const { calcPrice } = await import("./oem");
    const a = await calcPrice(prodInput({ unitPriceOverrideThb: 1, priceOverrideReason: "x" }));
    expect(a.ok && a.data.floors.priceVsCost?.pass).toBe(false);
    const plain = prodCalcJson();
    delete (plain.breakdown as Record<string, unknown>).production_override;
    delete (plain.floors as Record<string, unknown>).price_vs_cost;
    rpcMock.mockResolvedValue({ data: plain, error: null });
    const b = await calcPrice(prodInput());
    expect(b.ok).toBe(true);
    if (b.ok) {
      expect(b.data.breakdown.productionOverride).toBeNull();
      expect(b.data.floors.priceVsCost).toBeUndefined();
    }
  });

  it("getQuoteApprovalGates: อ่านจากตาราง oem_quote เฉพาะ approval_gates · null/ไม่มีแถว → []", async () => {
    maybeSingleMock.mockReturnValue({ data: { approval_gates: ["moq", "override_below_floor"] }, error: null });
    const { getQuoteApprovalGates } = await import("./oem");
    const r = await getQuoteApprovalGates("q-1");
    expect(r).toEqual({ ok: true, data: ["moq", "override_below_floor"] });
    expect(selectMock).toHaveBeenCalledWith("approval_gates");
    maybeSingleMock.mockReturnValue({ data: { approval_gates: null }, error: null });
    expect(await getQuoteApprovalGates("q-1")).toEqual({ ok: true, data: [] });
    maybeSingleMock.mockReturnValue({ data: null, error: null });
    expect(await getQuoteApprovalGates("q-1")).toEqual({ ok: true, data: [] });
  });

  it("getQuoteApprovalGates: ไม่ใช่ owner/admin → ปฏิเสธ ไม่อ่านตาราง", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const { getQuoteApprovalGates } = await import("./oem");
    const r = await getQuoteApprovalGates("q-1");
    expect(r.ok).toBe(false);
    expect(selectMock).not.toHaveBeenCalled();
  });
});
