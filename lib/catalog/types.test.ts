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
  GRAMS_PER_BAHT_WEIGHT,
  MAX_SILVER_SPOT_THB_PER_GRAM,
  MIN_SILVER_SPOT_THB_PER_GRAM,
  silverSpotValidationError,
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
