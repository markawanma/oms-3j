// lib/catalog/types.test.ts — coverage for the silver-spot validation added
// in 0125 (fixes the ฿1,097 per-baht-typed-as-per-gram bug) and tightened in
// 0126 (security review: floor raised 0 -> 5, closes the "0 is technically
// >= 0" hole). This is the SAME validator shared by lib/actions/catalog.ts
// (upsertShopSetting) and components/domain/catalog/SettingsForm.tsx — testing
// it once here covers both call sites' logic (the DB-level gates in
// shop_setting_upsert / silver_spot_sync_from_history, 0125/0126, are the
// layers that are actually always enforced; this is the client/action-layer
// mirror that fails fast, using the SAME 5/500 bounds).
import { describe, expect, it } from "vitest";
import {
  computeEffectiveCost,
  GRAMS_PER_BAHT_WEIGHT,
  humanizeCatalogError,
  MAX_SILVER_SPOT_THB_PER_GRAM,
  MIN_SILVER_SPOT_THB_PER_GRAM,
  parseMakeSpec,
  silverSpotValidationError,
  spotChanged,
} from "./types";

describe("silverSpotValidationError", () => {
  it("accepts null (not provided — always valid, callers check required-ness separately)", () => {
    expect(silverSpotValidationError(null)).toBeNull();
  });

  it("rejects 0 (0126: floor raised to 5 — nothing with real value prices at ฿0/g)", () => {
    expect(silverSpotValidationError(0)).not.toBeNull();
  });

  it("rejects values below the 5 floor", () => {
    expect(silverSpotValidationError(4.99)).not.toBeNull();
  });

  it("accepts exactly the lower bound (5)", () => {
    expect(silverSpotValidationError(MIN_SILVER_SPOT_THB_PER_GRAM)).toBeNull();
  });

  it("accepts a realistic per-gram spot price (today's ~฿67.70)", () => {
    expect(silverSpotValidationError(67.7)).toBeNull();
  });

  it("accepts exactly the upper bound (500)", () => {
    expect(silverSpotValidationError(MAX_SILVER_SPOT_THB_PER_GRAM)).toBeNull();
  });

  it("rejects negative values", () => {
    expect(silverSpotValidationError(-1)).not.toBeNull();
  });

  it("rejects values just above the 500 ceiling", () => {
    expect(silverSpotValidationError(500.01)).not.toBeNull();
  });

  it("rejects the exact ฿1,097 per-baht value that caused the original bug", () => {
    const err = silverSpotValidationError(1097);
    expect(err).not.toBeNull();
    expect(err).toContain("ต่อบาท");
  });

  it("rejects NaN", () => {
    expect(silverSpotValidationError(NaN)).not.toBeNull();
  });

  it("rejects Infinity", () => {
    expect(silverSpotValidationError(Infinity)).not.toBeNull();
  });

  it("rejects -Infinity", () => {
    expect(silverSpotValidationError(-Infinity)).not.toBeNull();
  });

  it("error message names the correct conversion constant", () => {
    const err = silverSpotValidationError(600);
    expect(err).toContain(String(GRAMS_PER_BAHT_WEIGHT));
  });
});

// 0127 code review (B1): SettingsForm.tsx prefills the spot input with the
// shop's current value and resubmits it on every save, including a
// margin-only edit — spotChanged() is what lets the form tell "resubmitted
// unchanged" apart from "actually edited" so it doesn't send a value that
// would make shop_setting_upsert treat a no-op as a manual entry.
describe("spotChanged", () => {
  it("is false when both are null (never synced, never touched)", () => {
    expect(spotChanged(null, null)).toBe(false);
  });

  it("is false when the field is cleared back to empty (next=null), regardless of prev", () => {
    expect(spotChanged(null, 67.7)).toBe(false);
  });

  it("is true the first time a value is entered (prev was null)", () => {
    expect(spotChanged(67.7, null)).toBe(true);
  });

  it("is false when resubmitting the exact prefilled value — the B1 bug case", () => {
    expect(spotChanged(67.6988, 67.6988)).toBe(false);
  });

  it("is false for float noise within 1e-9 of the previous value", () => {
    expect(spotChanged(67.6988000001, 67.6988)).toBe(false);
  });

  it("is true for a real edit, even a small one", () => {
    expect(spotChanged(67.7, 67.6988)).toBe(true);
  });

  it("is true for a large edit (e.g. emergency manual override)", () => {
    expect(spotChanged(70, 65.5996)).toBe(true);
  });
});

// 0141: 3rd cost mode "คำนวณจากสเปค" — computeEffectiveCost must NEVER
// attempt the spec formula client-side (oem-quote-invariants §2: it's a
// dozens-of-rates DB calculation, not a 3-variable multiply like spot).
describe("computeEffectiveCost", () => {
  it("returns unitCost unchanged for fixed mode", () => {
    expect(computeEffectiveCost("fixed", 500, null, null, null, null)).toBe(500);
  });

  it("computes weight × spot × purity + labor for spot mode", () => {
    expect(computeEffectiveCost("spot", null, 10, 0.925, 50, 67.7)).toBeCloseTo(10 * 67.7 * 0.925 + 50, 2);
  });

  it("returns null for spot mode with no silver spot price set", () => {
    expect(computeEffectiveCost("spot", null, 10, 0.925, 50, null)).toBeNull();
  });

  it("returns null for spec mode always — even with weight+spot both present", () => {
    expect(computeEffectiveCost("spec", null, 10, 0.925, null, 67.7)).toBeNull();
  });

  it("returns null for spec mode with everything null too (same result — not gated on missing data)", () => {
    expect(computeEffectiveCost("spec", null, null, null, null, null)).toBeNull();
  });
});

// ปล่อยผ่านเฉพาะ errcode 22023 (raise ที่ 0141/0142/0028/0031 ตั้งใจพูดกับ
// ผู้ใช้) — code อื่นเป็นของภายใน (เช่น analytics.oem_cost_calc ไม่ tag
// errcode ตอน validate input พัง) ห้ามหลุดออกจอ
describe("humanizeCatalogError", () => {
  it("passes through a 22023-coded message from product_make_spec_set", () => {
    const err = { code: "22023", message: "product_make_spec_set: make_spec.item_kind is required" };
    expect(humanizeCatalogError(err, "fallback")).toBe(err.message);
  });

  it("passes through the 0142 exit-guard message from product_upsert", () => {
    const err = {
      code: "22023",
      message:
        'product_upsert: SKU R-0099 อยู่โหมด "คำนวณจากสเปค" (spec) อยู่ — พลิกออกจากโหมดนี้ต้องผ่าน analytics.product_make_spec_clear เท่านั้น (กันต้นทุนพลิกเงียบโดยไม่ผ่าน audit log)',
    };
    expect(humanizeCatalogError(err, "fallback")).toBe(err.message);
  });

  it("falls back for an un-coded internal raise (e.g. oem_cost_calc's own validation, no errcode tag)", () => {
    const err = { message: "oem_price_calc: p_input.gem_count > 0 requires p_input.gem_tier" };
    expect(humanizeCatalogError(err, "fallback")).toBe("fallback");
  });

  it("falls back for a non-22023 code (e.g. 22P02, which leaks a raw uuid)", () => {
    const err = { code: "22P02", message: 'invalid input syntax for type uuid: "nope"' };
    expect(humanizeCatalogError(err, "fallback")).toBe("fallback");
  });

  it("falls back when there is no usable message at all", () => {
    expect(humanizeCatalogError(null, "fallback")).toBe("fallback");
    expect(humanizeCatalogError(undefined, "fallback")).toBe("fallback");
    expect(humanizeCatalogError({}, "fallback")).toBe("fallback");
  });
});

// public.product.make_spec (jsonb, snake_case — written by
// analytics.product_make_spec_set) -> MakeSpec (camelCase). Defensive: a
// malformed row must degrade to null, never throw (getProducts() maps 303
// SKUs through this in one request).
describe("parseMakeSpec", () => {
  it("parses a full spec (all fields present)", () => {
    const raw = {
      metal: "silver",
      item_kind: "แหวน",
      polish_tier: "ละเอียด",
      plating_type: "ทอง",
      gem_tier: "เล็ก",
      gem_count: 3,
    };
    expect(parseMakeSpec(raw)).toEqual({
      metal: "silver",
      itemKind: "แหวน",
      polishTier: "ละเอียด",
      platingType: "ทอง",
      gemTier: "เล็ก",
      gemCount: 3,
    });
  });

  it("parses a minimal spec (no plating, no gems — both null/empty)", () => {
    const raw = { metal: "silver", item_kind: "จี้", polish_tier: "เรียบ", plating_type: "", gem_tier: "", gem_count: 0 };
    expect(parseMakeSpec(raw)).toEqual({
      metal: "silver",
      itemKind: "จี้",
      polishTier: "เรียบ",
      platingType: null,
      gemTier: null,
      gemCount: 0,
    });
  });

  it("returns null for null input (fixed/spot SKUs — make_spec is null by nature)", () => {
    expect(parseMakeSpec(null)).toBeNull();
  });

  it("returns null when item_kind is missing (malformed row — never guess)", () => {
    expect(parseMakeSpec({ metal: "silver", polish_tier: "เรียบ" })).toBeNull();
  });

  it("returns null when polish_tier is missing", () => {
    expect(parseMakeSpec({ metal: "silver", item_kind: "แหวน" })).toBeNull();
  });

  it("returns null for a non-object value (string/number/array)", () => {
    expect(parseMakeSpec("not an object")).toBeNull();
    expect(parseMakeSpec(42)).toBeNull();
    expect(parseMakeSpec([])).toBeNull();
  });
});
