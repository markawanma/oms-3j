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
