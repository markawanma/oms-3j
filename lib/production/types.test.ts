import { describe, expect, it } from "vitest";
import {
  humanizeProductionError,
  PRICE_CHANGED_MARKER,
  parseMetalPrices,
  parseMissingPrices,
  parseProductionSpecCostCalc,
  productionItemInputIssue,
} from "./types";

// 0186 — ราคาทอง/ทองเหลืองของวันนี้ยังไม่มี: ต่างจากเงินที่ห้ามชี้ /oem/rates (ล็อกชีต) — ทอง/ทองเหลืองไม่มี feed ทางออกคือกรอกที่ /oem/rates
describe("humanizeProductionError — 0186 gold/brass price missing", () => {
  it("gold: tells the owner to fill today's gold price at /oem/rates (no per-order price, no old price)", () => {
    const msg = humanizeProductionError({ code: "22023", message: "production_metal_price_resolve: ยังไม่มีราคาทองของวันนี้ (2026-10-20) — กรอกที่ /oem/rates (ทอง/ทองเหลืองไม่มี feed จึงไม่ล็อกชีต)" }, "fallback");
    expect(msg).toContain("ยังไม่มีราคาทองของวันนี้");
    expect(msg).toContain("/oem/rates");
    expect(msg).toContain("ไม่มีราคาเฉพาะใบ");
  });
  it("brass gets its own wording (marker is not a substring of the gold one and vice versa)", () => {
    const msg = humanizeProductionError({ code: "22023", message: "production_metal_price_resolve: ยังไม่มีราคาทองเหลืองของวันนี้ (2026-10-20) — กรอกที่ /oem/rates" }, "fallback");
    expect(msg).toContain("ยังไม่มีราคาทองเหลืองของวันนี้");
    expect(msg).not.toContain("ยังไม่มีราคาทองของวันนี้");
  });
  it("silver message still takes the original path (two ways out, never links /oem/rates) — must not break", () => {
    const msg = humanizeProductionError({ code: "22023", message: "production_spot_resolve: ยังไม่มีราคาเงินของวันนี้ (2026-10-20) และไม่มี override" }, "fallback");
    expect(msg).toContain("ราคาเงินเฉพาะใบนี้");
    expect(msg).not.toContain("/oem/rates");
  });
  it("sku_required / metal_locked / job_exists messages (Thai, 22023) pass through with the DB function-name prefix stripped; non-22023 still falls back", () => {
    const skuReq = { code: "22023", message: "production_order_done: ใบ PO-0034 มีรายการที่ยังไม่ผูก SKU — ผูก SKU ให้ครบก่อนผลิตเสร็จ" };
    expect(humanizeProductionError(skuReq, "fallback")).toBe("ใบ PO-0034 มีรายการที่ยังไม่ผูก SKU — ผูก SKU ให้ครบก่อนผลิตเสร็จ");
    const locked = { code: "22023", message: "production_order_item_set: เปลี่ยนโลหะไม่ได้ — มีใบงาน JB-0031 เดินอยู่ ยกเลิกใบงานก่อน แล้วแก้โลหะ" };
    expect(humanizeProductionError(locked, "fallback")).toBe("เปลี่ยนโลหะไม่ได้ — มีใบงาน JB-0031 เดินอยู่ ยกเลิกใบงานก่อน แล้วแก้โลหะ");
    expect(humanizeProductionError({ code: "23514", message: "new row violates check constraint production_order_item_gold_purity_ck" }, "fallback")).toBe("fallback");
  });

  it("คำนำหน้าชื่อฟังก์ชัน: ตัดเฉพาะรูป snake_case ตัวพิมพ์เล็กที่ตามด้วย ': ' · ข้อความไทย/ที่ไม่มีคำนำหน้า/มี ':' กลางประโยคคงเดิม · ตัดแล้วว่าง → fallback", () => {
    const h = (message: string) => humanizeProductionError({ code: "22023", message }, "fallback");
    expect(h("production_cost_calc: SKU SV-1 ยังไม่ระบุน้ำหนัก")).toBe("SKU SV-1 ยังไม่ระบุน้ำหนัก");
    expect(h("production_order_item_remove_by_id: ไม่พบรายการนี้ในใบ")).toBe("ไม่พบรายการนี้ในใบ");
    expect(h("ราคาทองไม่ถูกต้อง: ลองใหม่")).toBe("ราคาทองไม่ถูกต้อง: ลองใหม่");
    expect(h("SKU: ซ้ำ")).toBe("SKU: ซ้ำ");
    expect(h("error: อะไรสักอย่าง")).toBe("error: อะไรสักอย่าง"); // ไม่มี _ = ไม่ใช่ชื่อฟังก์ชันของเรา
    expect(h("production_order_done: ")).toBe("fallback");
    expect(h("ราคาโลหะ A: production_order_done: ซ้อน")).toBe("ราคาโลหะ A: production_order_done: ซ้อน");
  });
});

describe("parseMetalPrices / parseMissingPrices (0186)", () => {
  it("keeps only the 3 metals with finite numbers; accepts numeric strings (PostgREST numerics)", () => {
    expect(parseMetalPrices({ silver: 72, gold: "2804.1271", brass: 0.35, platinum: 5, copper: 1 })).toEqual({ silver: 72, gold: 2804.1271, brass: 0.35 });
    expect(parseMetalPrices({ gold: "abc", silver: null })).toEqual({});
  });
  it("never throws on non-objects", () => {
    for (const bad of [null, undefined, 5, "x", [1, 2], true]) expect(parseMetalPrices(bad)).toEqual({});
  });
  it("missing_prices keeps only known metals", () => {
    expect(parseMissingPrices(["gold", "brass", "platinum", 5, null])).toEqual(["gold", "brass"]);
    expect(parseMissingPrices(null)).toEqual([]);
    expect(parseMissingPrices("gold")).toEqual([]);
  });
});

describe("productionItemInputIssue (0186) — mirrors the DB gates; DB stays the real gate", () => {
  const sku = "11111111-1111-4111-8111-111111111111";
  const base = { productionOrderId: "po-1", qtyPlanned: 5 };
  it("needs exactly one of SKU / label", () => {
    expect(productionItemInputIssue({ ...base })).not.toBeNull();
    expect(productionItemInputIssue({ ...base, productId: sku, pendingProductLabel: "x" })).not.toBeNull();
    expect(productionItemInputIssue({ ...base, productId: sku })).toBeNull();
    expect(productionItemInputIssue({ ...base, pendingProductLabel: "แหวนทดลอง", metal: "silver" })).toBeNull();
  });
  it("item without SKU must pick a metal (no guessing)", () => {
    expect(productionItemInputIssue({ ...base, pendingProductLabel: "แหวนทดลอง" })).toContain("เลือกโลหะ");
  });
  it("purity: 0.375 / 1 ok · 0.374 / 1.0001 / NaN / Infinity / 5 decimals fail · brass locked at 1", () => {
    for (const p of [0.375, 0.9, 1]) expect(productionItemInputIssue({ ...base, productId: sku, metal: "gold", purity: p })).toBeNull();
    for (const p of [0.374, 1.0001, Number.NaN, Number.POSITIVE_INFINITY, 0.37501, 0, -1]) {
      expect(productionItemInputIssue({ ...base, productId: sku, metal: "gold", purity: p }), String(p)).not.toBeNull();
    }
    expect(productionItemInputIssue({ ...base, productId: sku, metal: "brass", purity: 1 })).toBeNull();
    expect(productionItemInputIssue({ ...base, productId: sku, metal: "brass", purity: 0.925 })).toContain("ล็อก");
  });
  it("weight: needs source · 0.001 / 10000 ok · 0 / negative / 10000.001 / 4 decimals / NaN fail", () => {
    expect(productionItemInputIssue({ ...base, productId: sku, weightG: 3.2, weightSource: "input" })).toBeNull();
    expect(productionItemInputIssue({ ...base, productId: sku, weightG: 0.001, weightSource: "product" })).toBeNull();
    expect(productionItemInputIssue({ ...base, productId: sku, weightG: 10000, weightSource: "input" })).toBeNull();
    for (const w of [0, -1, 10000.001, 3.2001, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(productionItemInputIssue({ ...base, productId: sku, weightG: w, weightSource: "input" }), String(w)).not.toBeNull();
    }
    expect(productionItemInputIssue({ ...base, productId: sku, weightG: 3 })).not.toBeNull();
    expect(productionItemInputIssue({ ...base, productId: sku, weightSource: "input" })).not.toBeNull();
    expect(productionItemInputIssue({ ...base, productId: sku, weightG: 3, weightSource: "input", clearWeight: true })).not.toBeNull();
  });
  it("label: ≤ 200 code points, no < >, not blank", () => {
    expect(productionItemInputIssue({ ...base, pendingProductLabel: "ก".repeat(200), metal: "silver" })).toBeNull();
    expect(productionItemInputIssue({ ...base, pendingProductLabel: "ก".repeat(201), metal: "silver" })).not.toBeNull();
    expect(productionItemInputIssue({ ...base, pendingProductLabel: "a<b", metal: "silver" })).not.toBeNull();
    expect(productionItemInputIssue({ ...base, pendingProductLabel: "  ", metal: "silver" })).not.toBeNull();
  });
});

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

  // 0186 PM-B: คำนำหน้าชื่อฟังก์ชัน ("production_xxx: ") ถูกตัดที่ humanizeProductionError ที่เดียว (UI ไม่ตัดเอง) — ข้อความไทยส่วนที่เหลือต้องไม่ถูกแตะ
  const dropPrefix = (m: string) => m.slice(m.indexOf(": ") + 2);

  it("passes every other 0131 error message straight through (already Thai + specific) — only the DB function-name prefix is dropped", () => {
    const err = { code: "22023", message: "production_order_item_set: SKU live0.5 เป็น SKU เฉพาะไลฟ์ (live*) ไม่นับสต็อก ใส่ในใบผลิตไม่ได้" };
    expect(humanizeProductionError(err, "fallback")).toBe("SKU live0.5 เป็น SKU เฉพาะไลฟ์ (live*) ไม่นับสต็อก ใส่ในใบผลิตไม่ได้");
  });

  it("passes the 'spot mode SKU has no weight' message through as-is (already tells the user to go to /catalog)", () => {
    const err = {
      code: "22023",
      message: "production_cost_calc: SKU R-0099 เป็นโหมด spot แต่ยังไม่กรอกน้ำหนักเงิน (silver_weight_g) — กรอกที่ /catalog ก่อนสั่งผลิต",
    };
    expect(humanizeProductionError(err, "fallback")).toBe(dropPrefix(err.message));
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
    expect(humanizeProductionError(err, "fallback")).toBe(dropPrefix(err.message));
  });

  // 0186 รอบ 3: ข้อความปิดใบของทอง/ทองเหลืองใช้ชื่อไทย (ไม่ใช่รหัส gold/brass) — ต้องผ่านเข้าหน้าจอครบ ไม่ถูก rewrite และไม่มีคำผิด
  it.each([
    "production_order_done: ราคาทองเปลี่ยนไประหว่างที่เปิดหน้าต่างนี้ค้างไว้ (ตอนเปิดหน้าต่างเห็นราคา 2800.1271 บาท/กรัม แต่ตอนนี้ระบบคำนวณได้ 2805.1271 บาท/กรัม) — ปิดหน้าต่างยืนยันนี้แล้วเปิดใบผลิตใหม่อีกครั้งเพื่อดูราคาล่าสุดก่อนยืนยัน",
    "production_order_done: ราคาทองเหลืองเปลี่ยนไประหว่างที่เปิดหน้าต่างนี้ค้างไว้ (ตอนเปิดหน้าต่างเห็นราคา 0.35 บาท/กรัม แต่ตอนนี้ระบบคำนวณได้ 0.36 บาท/กรัม) — ปิดหน้าต่างยืนยันนี้แล้วเปิดใบผลิตใหม่อีกครั้งเพื่อดูราคาล่าสุดก่อนยืนยัน",
    "production_order_done: ไม่มีราคาทองที่หน้าจอเห็นมาด้วย (p_expected_metal_prices) — ปิดหน้าต่างแล้วเปิดใบผลิตใหม่อีกครั้ง",
  ])("passes the gold/brass done messages (0186 round 3, Thai metal names) through as-is: %s", (message) => {
    const shown = humanizeProductionError({ code: "22023", message }, "fallback");
    expect(shown).toBe(dropPrefix(message));
    expect(shown).not.toMatch(/^production_/);
    expect(message).not.toMatch(/gold|brass|ไปประหว่าง/);
    // ข้อความ "ราคาโลหะเปลี่ยน" ยังมี marker ที่ UI ใช้แยกกรณีหลังตัดคำนำหน้า
    if (message.includes("เปลี่ยนไประหว่าง")) expect(shown).toContain(PRICE_CHANGED_MARKER);
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
