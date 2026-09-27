// lib/marketing/content-post-inspect-guards.test.ts
//
// Pure in-memory tests — no network, no DOM. See the module's own header
// for the real bug (H-1, security รอบ 4, 27 ก.ย. 69) these two functions
// close: clip A's date/caption silently landing on clip B, no error either
// on the no-race path (edit + immediate submit) or the genuine-race path
// (inspect(A) resolves after the field already shows B).

import { describe, expect, it } from "vitest";
import { autoFilledDateMismatch, shouldApplyInspectResult } from "./content-post-inspect-guards";

describe("shouldApplyInspectResult — no-race case: edited then submitted before any re-inspect", () => {
  it("same URL (requested === current) -> true, apply the result", () => {
    const url = "https://www.tiktok.com/@3jjewelry/video/1";
    expect(shouldApplyInspectResult(url, url)).toBe(true);
  });

  it("🔴 the exact H-1 scenario: requested for clip A, field now shows clip B -> false, discard", () => {
    const clipA = "https://www.tiktok.com/@3jjewelry/video/1111111111111111111";
    const clipB = "https://www.tiktok.com/@3jjewelry/video/2222222222222222222";
    expect(shouldApplyInspectResult(clipA, clipB)).toBe(false);
  });

  it("field cleared to empty while the request was in flight -> false, discard", () => {
    const clipA = "https://www.tiktok.com/@3jjewelry/video/1111111111111111111";
    expect(shouldApplyInspectResult(clipA, "")).toBe(false);
  });

  it("purely whitespace difference (leading/trailing) is NOT treated as a real edit -> true", () => {
    const url = "https://www.tiktok.com/@3jjewelry/video/1";
    expect(shouldApplyInspectResult(url, `  ${url}  `)).toBe(true);
    expect(shouldApplyInspectResult(`  ${url}  `, url)).toBe(true);
  });

  it("a single character different (typo fix) still counts as a different clip -> false", () => {
    const original = "https://www.tiktok.com/@3jjewelry/video/1111111111111111111";
    const typoFixed = "https://www.tiktok.com/@3jjewelry/video/1111111111111111112";
    expect(shouldApplyInspectResult(original, typoFixed)).toBe(false);
  });
});

describe("autoFilledDateMismatch — submit-time block before a mismatched date reaches the DB", () => {
  const urlA = "https://www.tiktok.com/@3jjewelry/video/1111111111111111111";
  const urlB = "https://www.tiktok.com/@3jjewelry/video/2222222222222222222";

  it("autoFilledFor is null (never auto-filled, or owner edited the date by hand) -> never a mismatch, any submitUrl", () => {
    expect(autoFilledDateMismatch(null, urlA)).toBe(false);
    expect(autoFilledDateMismatch(null, "")).toBe(false);
    expect(autoFilledDateMismatch(null, urlB)).toBe(false);
  });

  it("date was auto-filled for the SAME url that's about to be submitted -> no mismatch, safe to submit", () => {
    expect(autoFilledDateMismatch(urlA, urlA)).toBe(false);
  });

  it("🔴 the exact H-1 scenario: date auto-filled for A, submitting B -> mismatch, must block", () => {
    expect(autoFilledDateMismatch(urlA, urlB)).toBe(true);
  });

  it("whitespace-only difference between the two sides is NOT a real mismatch", () => {
    expect(autoFilledDateMismatch(urlA, `  ${urlA}  `)).toBe(false);
    expect(autoFilledDateMismatch(`  ${urlA}  `, urlA)).toBe(false);
  });

  it("a single character different (typo fix) still counts as a mismatch", () => {
    const typoFixed = "https://www.tiktok.com/@3jjewelry/video/1111111111111111112";
    expect(autoFilledDateMismatch(urlA, typoFixed)).toBe(true);
  });
});
