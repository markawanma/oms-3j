// lib/catalog/image-client.test.ts — coverage for the pure pieces of the
// browser resize pipeline (calcTargetDimensions / isHeicFile / QUALITY_STEPS
// shape). The canvas/createImageBitmap path (resizeImageVariant,
// resizeProductImage) needs real browser APIs Vitest's node environment
// doesn't provide (vitest.config.ts) — that half is exercised manually by
// frontend-dev once the upload UI exists, per the design brief.
import { describe, expect, it } from "vitest";
import { calcTargetDimensions, isHeicFile, isSourceTooLarge, MAX_SOURCE_BYTES, QUALITY_STEPS } from "./image-client";
import { MD_MAX_PX, SM_MAX_PX } from "./image-constants";

describe("calcTargetDimensions", () => {
  it("never upscales — an image already under maxPx keeps its original size", () => {
    expect(calcTargetDimensions(300, 200, MD_MAX_PX)).toEqual({ width: 300, height: 200 });
  });

  it("scales down a landscape image to the long-edge cap", () => {
    // 4000x3000 -> long edge 4000 scaled to 1200 -> scale 0.3 -> 4000*0.3=1200, 3000*0.3=900
    expect(calcTargetDimensions(4000, 3000, MD_MAX_PX)).toEqual({ width: 1200, height: 900 });
  });

  it("scales down a portrait image to the long-edge cap (height is the long edge)", () => {
    // 3000x4000 -> long edge 4000 -> scale 0.3 -> 900x1200
    expect(calcTargetDimensions(3000, 4000, MD_MAX_PX)).toEqual({ width: 900, height: 1200 });
  });

  it("handles a square image", () => {
    expect(calcTargetDimensions(2000, 2000, SM_MAX_PX)).toEqual({ width: 480, height: 480 });
  });

  it("keeps an exact-boundary image unchanged (long edge === maxPx)", () => {
    expect(calcTargetDimensions(1200, 600, MD_MAX_PX)).toEqual({ width: 1200, height: 600 });
  });

  it("never produces a zero dimension for a very thin, oversized image", () => {
    const result = calcTargetDimensions(10000, 1, MD_MAX_PX);
    expect(result.width).toBe(1200);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });

  it("returns {0,0} for invalid (non-positive) input instead of throwing", () => {
    expect(calcTargetDimensions(0, 100, MD_MAX_PX)).toEqual({ width: 0, height: 0 });
    expect(calcTargetDimensions(100, -5, MD_MAX_PX)).toEqual({ width: 0, height: 0 });
  });
});

describe("isHeicFile", () => {
  it("detects HEIC by mime type", () => {
    expect(isHeicFile({ type: "image/heic", name: "photo.heic" })).toBe(true);
  });

  it("detects HEIF by mime type", () => {
    expect(isHeicFile({ type: "image/heif", name: "photo.heif" })).toBe(true);
  });

  it("detects HEIC by extension when mime type is empty (iOS quirk from the design brief)", () => {
    expect(isHeicFile({ type: "", name: "IMG_1234.HEIC" })).toBe(true);
  });

  it("is case-insensitive on both mime and extension", () => {
    expect(isHeicFile({ type: "IMAGE/HEIC", name: "photo.jpg" })).toBe(true);
    expect(isHeicFile({ type: "", name: "photo.Heic" })).toBe(true);
  });

  it("does not flag a real JPEG", () => {
    expect(isHeicFile({ type: "image/jpeg", name: "photo.jpg" })).toBe(false);
  });

  it("does not flag a file with no type and an unrelated extension", () => {
    expect(isHeicFile({ type: "", name: "photo.png" })).toBe(false);
  });
});

describe("isSourceTooLarge", () => {
  it("accepts a typical camera JPEG well under the ceiling", () => {
    expect(isSourceTooLarge(8 * 1024 * 1024)).toBe(false);
  });

  it("accepts a file exactly at the ceiling (boundary is exclusive)", () => {
    expect(isSourceTooLarge(MAX_SOURCE_BYTES)).toBe(false);
  });

  it("rejects a file one byte over the ceiling", () => {
    expect(isSourceTooLarge(MAX_SOURCE_BYTES + 1)).toBe(true);
  });

  it("rejects a pathological 200MB source (L4, security audit 2026-09-02)", () => {
    expect(isSourceTooLarge(200 * 1024 * 1024)).toBe(true);
  });
});

describe("QUALITY_STEPS", () => {
  it("is a descending ladder starting below 1.0, per the Tech Lead's quality-reduction decision", () => {
    expect(QUALITY_STEPS.length).toBeGreaterThan(1);
    for (let i = 1; i < QUALITY_STEPS.length; i++) {
      expect(QUALITY_STEPS[i]).toBeLessThan(QUALITY_STEPS[i - 1]);
    }
    expect(QUALITY_STEPS[0]).toBeLessThan(1);
    expect(QUALITY_STEPS[QUALITY_STEPS.length - 1]).toBeGreaterThan(0);
  });
});
