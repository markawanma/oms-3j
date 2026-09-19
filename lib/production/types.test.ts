import { describe, expect, it } from "vitest";
import { humanizeProductionError, parseProductionSpecCostCalc } from "./types";

describe("humanizeProductionError", () => {
  it("rewrites the 'no spot price today' raise into the two actionable ways out, without linking /oem/rates", () => {
    const err = {
      code: "22023",
      message:
        "production_spot_resolve: ยังไม่มีราคาเงินของวันนี้ (2026-09-18) และไม่มี override — ออกใบผลิตไม่ได้ (ห้าม fallback ราคาเมื่อวาน)",
    };
    const msg = humanizeProductionError(err, "fallback");
    expect(msg).toContain("ยังไม่มีราคาเงินของวันนี้");
    expect(msg).toContain("ราคาเงินเฉพาะใบนี้");
    expect(msg).toContain("รอราคาที่จะเข้าระบบอัตโนมัติ");
    expect(msg).not.toContain("/oem/rates");
  });

  it("passes every other 0131 error message straight through unmodified (already Thai + specific)", () => {
    const err = { code: "22023", message: "production_order_item_set: SKU live0.5 เป็น SKU เฉพาะไลฟ์ (live*) ไม่นับสต็อก ใส่ในใบผลิตไม่ได้" };
    expect(humanizeProductionError(err, "fallback")).toBe(err.message);
  });

  it("passes the 'spot mode SKU has no weight' message through as-is (already tells the user to go to /catalog)", () => {
    const err = {
      code: "22023",
      message: "production_cost_calc: SKU R-0099 เป็นโหมด spot แต่ยังไม่กรอกน้ำหนักเงิน (silver_weight_g) — กรอกที่ /catalog ก่อนสั่งผลิต",
    };
    expect(humanizeProductionError(err, "fallback")).toBe(err.message);
  });

  // 0132 M1 — the "spot price moved between preview and done" raise already
  // tells the user exactly what to do (close and reopen); it must NOT get
  // caught by the NO_SPOT_PRICE_MARKER rewrite above (different Thai text —
  // "ราคาเงินเปลี่ยนไป..." vs "ยังไม่มีราคาเงินของวันนี้"), so it should pass
  // through unmodified like every other already-specific 0131/0132 message.
  it("passes the 'spot price moved between preview and done' (0132 M1) message through as-is", () => {
    const err = {
      code: "22023",
      message:
        "production_order_done: ราคาเงินเปลี่ยนไประหว่างที่เปิดหน้าต่างนี้ค้างไว้ (ตอนเปิดหน้าต่างเห็นราคา 70 บาท/กรัม แต่ตอนนี้ระบบคำนวณได้ 71 บาท/กรัม) — ปิดหน้าต่างยืนยันนี้แล้วเปิดใบผลิตใหม่อีกครั้งเพื่อดูราคาล่าสุดก่อนยืนยัน",
    };
    expect(humanizeProductionError(err, "fallback")).toBe(err.message);
  });

  it("falls back when there is no usable message at all", () => {
    expect(humanizeProductionError(null, "fallback")).toBe("fallback");
    expect(humanizeProductionError(undefined, "fallback")).toBe("fallback");
    expect(humanizeProductionError({}, "fallback")).toBe("fallback");
    expect(humanizeProductionError("a plain string, not a PostgREST-shaped object", "fallback")).toBe("fallback");
  });
});

// 0141/0142: the `cost_calc` jsonb analytics.production_cost_calc returns for
// cost_type='spec' — snake_case DB keys -> camelCase, defensive (never
// throws on a malformed shape). Real numbers below are the ones the task
// brief itself quotes (5 ชิ้น=305.07 · 3 ชิ้น=325.07) as evidence that spec
// cost depends on qty.
describe("parseProductionSpecCostCalc", () => {
  it("returns null for null (fixed/spot lines, or an open order's not-yet-done item)", () => {
    expect(parseProductionSpecCostCalc(null)).toBeNull();
  });

  it("returns null for a non-object value", () => {
    expect(parseProductionSpecCostCalc("nope")).toBeNull();
    expect(parseProductionSpecCostCalc(42)).toBeNull();
  });

  it("parses a complete breakdown (5 pieces — brief's own test number, 305.07)", () => {
    const raw = {
      is_complete: true,
      missing: [],
      price_source: "sheet",
      as_of_date: "2026-09-19",
      labor_steps: [{ key: "wax_inject", minutes: 5, thb: 12.5 }],
      batch_lines: [{ key: "flask", capacity: 40, count: 1, cost: 300 }],
      metal_per_piece: 100.5,
      labor_per_piece: 150,
      batch_per_piece: 54.57,
      cost_piece: 305.07,
      nre_cost: 0,
      nre_per_piece: 0,
      qty: 5,
      is_new_design: false,
      metal_price_thb_per_gram: 67.7,
      unit_cost: 305.07,
    };
    const parsed = parseProductionSpecCostCalc(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.unitCost).toBe(305.07);
    expect(parsed?.qty).toBe(5);
    expect(parsed?.isComplete).toBe(true);
    expect(parsed?.isNewDesign).toBe(false);
    expect(parsed?.laborSteps).toEqual([{ key: "wax_inject", minutes: 5, thb: 12.5 }]);
    expect(parsed?.batchLines).toEqual([{ key: "flask", capacity: 40, count: 1, cost: 300 }]);
  });

  it("parses an incomplete breakdown (missing rates) with the missing[] list intact", () => {
    const raw = {
      is_complete: false,
      missing: [{ rate_key: "polish_labor_thb_per_piece", scope: "ละเอียด", question_th: "ค่าแรงขัดละเอียด?", priority: "P0" }],
      price_source: "sheet",
      as_of_date: "2026-09-19",
      labor_steps: [],
      batch_lines: [],
      metal_per_piece: 100.5,
      labor_per_piece: 0,
      batch_per_piece: 0,
      cost_piece: 100.5,
      nre_cost: 0,
      nre_per_piece: 0,
      qty: 3,
      is_new_design: false,
      metal_price_thb_per_gram: 67.7,
      unit_cost: 100.5,
    };
    const parsed = parseProductionSpecCostCalc(raw);
    expect(parsed?.isComplete).toBe(false);
    expect(parsed?.missing).toEqual([
      { rateKey: "polish_labor_thb_per_piece", scope: "ละเอียด", questionTh: "ค่าแรงขัดละเอียด?", priority: "P0" },
    ]);
  });

  it("defaults array fields to [] when absent, instead of throwing", () => {
    const raw = { is_complete: true, metal_per_piece: 1, labor_per_piece: 1, batch_per_piece: 1, cost_piece: 3, unit_cost: 3, qty: 1 };
    const parsed = parseProductionSpecCostCalc(raw);
    expect(parsed?.missing).toEqual([]);
    expect(parsed?.laborSteps).toEqual([]);
    expect(parsed?.batchLines).toEqual([]);
  });
});
