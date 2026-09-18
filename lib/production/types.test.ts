import { describe, expect, it } from "vitest";
import { humanizeProductionError } from "./types";

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

  it("falls back when there is no usable message at all", () => {
    expect(humanizeProductionError(null, "fallback")).toBe("fallback");
    expect(humanizeProductionError(undefined, "fallback")).toBe("fallback");
    expect(humanizeProductionError({}, "fallback")).toBe("fallback");
    expect(humanizeProductionError("a plain string, not a PostgREST-shaped object", "fallback")).toBe("fallback");
  });
});
