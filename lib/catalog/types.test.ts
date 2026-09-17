// lib/catalog/types.test.ts — coverage for the silver-spot validation added
// in 0125 (fixes the ฿1,097 per-baht-typed-as-per-gram bug). This is the
// SAME validator shared by lib/actions/catalog.ts (upsertShopSetting) and
// components/domain/catalog/SettingsForm.tsx — testing it once here covers
// both call sites' logic (the DB-level gate in shop_setting_upsert, 0125, is
// the layer that's actually always enforced; this is the client/action-layer
// mirror that fails fast).
import { describe, expect, it } from "vitest";
import { GRAMS_PER_BAHT_WEIGHT, MAX_SILVER_SPOT_THB_PER_GRAM, silverSpotValidationError } from "./types";

describe("silverSpotValidationError", () => {
  it("accepts null (not provided — always valid, callers check required-ness separately)", () => {
    expect(silverSpotValidationError(null)).toBeNull();
  });

  it("accepts 0", () => {
    expect(silverSpotValidationError(0)).toBeNull();
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

  it("error message names the correct conversion constant", () => {
    const err = silverSpotValidationError(600);
    expect(err).toContain(String(GRAMS_PER_BAHT_WEIGHT));
  });
});
