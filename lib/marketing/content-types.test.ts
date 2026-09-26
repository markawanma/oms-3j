// lib/marketing/content-types.test.ts
//
// QA regression tests (2026-09-26, post-hoc review of the content-measure UI
// that shipped to main without QA — see incident brief). Pure in-memory
// tests — no disk I/O, no DB — same style as calendar-errors.test.ts.
//
// Focus: parseMetricFieldValue and deriveExternalId are the two pure
// functions standing between "whatever the owner typed/pasted at night" and
// a DB write. Both are exercised here mostly with inputs the UI *shouldn't*
// be able to produce today (the metric input strips non-digits, the URL
// input requires http(s)://) — testing them anyway because both functions
// are exported and reusable, and because "the UI currently prevents this"
// is exactly the kind of assumption that silently breaks group
// (docs brief 26 ส.ค. rule: edge cases matter as much as the happy path).

import { describe, expect, it } from "vitest";
import { deriveExternalId, isPostableArtifactType, parseMetricFieldValue } from "./content-types";

describe("parseMetricFieldValue — happy path", () => {
  it("parses a plain positive integer", () => {
    expect(parseMetricFieldValue("123")).toBe(123);
  });

  it("parses zero", () => {
    expect(parseMetricFieldValue("0")).toBe(0);
  });

  it("undefined (field never touched) stays undefined, not 0", () => {
    expect(parseMetricFieldValue(undefined)).toBeUndefined();
  });
});

describe("parseMetricFieldValue — edge cases the UI's onChange filter is the only other line of defense for", () => {
  it("empty string -> undefined (untouched), matching the 'ว่าง ไม่ใช่ 0' rule", () => {
    expect(parseMetricFieldValue("")).toBeUndefined();
  });

  it("whitespace-only string -> undefined after trim", () => {
    expect(parseMetricFieldValue("   ")).toBeUndefined();
  });

  it("leading/trailing whitespace around digits is trimmed", () => {
    expect(parseMetricFieldValue("  42  ")).toBe(42);
  });

  it("leading zeros still parse to the numeric value", () => {
    expect(parseMetricFieldValue("007")).toBe(7);
  });

  it("negative sign is rejected (null), not silently made positive", () => {
    expect(parseMetricFieldValue("-5")).toBeNull();
  });

  it("decimal point is rejected (null) — metrics are counts, not fractions", () => {
    expect(parseMetricFieldValue("12.5")).toBeNull();
  });

  it("thousands separator is rejected (null) — no locale-formatted input accepted", () => {
    expect(parseMetricFieldValue("12,000")).toBeNull();
  });

  it("scientific notation text is rejected (null)", () => {
    expect(parseMetricFieldValue("1e5")).toBeNull();
  });

  it("Thai numeral digits are rejected (null) — \\d is ASCII-only", () => {
    expect(parseMetricFieldValue("๑๒๓")).toBeNull();
  });

  it("trailing non-digit garbage (e.g. pasted emoji) is rejected (null)", () => {
    expect(parseMetricFieldValue("12👍")).toBeNull();
  });

  it("plus sign is rejected (null)", () => {
    expect(parseMetricFieldValue("+5")).toBeNull();
  });

  it("Number.MAX_SAFE_INTEGER parses fine (boundary, still valid)", () => {
    expect(parseMetricFieldValue("9007199254740991")).toBe(9007199254740991);
  });

  it("Number.MAX_SAFE_INTEGER + 1 is rejected (null) — unsafe integer", () => {
    expect(parseMetricFieldValue("9007199254740992")).toBeNull();
  });

  it("a 30-digit fat-finger number is rejected (null), not silently truncated", () => {
    expect(parseMetricFieldValue("999999999999999999999999999999")).toBeNull();
  });

  it("⚠️ KNOWN GAP: an invalid/overflow field is indistinguishable from an untouched one to the caller " +
    "(both parseMetricFieldValue calls that matter return non-number — the UI's goToReview() only checks " +
    "typeof parsed === 'number' and silently drops the field with no error shown to the owner, see " +
    "ContentMetricCard.tsx goToReview()). Documenting the actual return shape here so this doesn't regress " +
    "further, not asserting it's the desired behavior.", () => {
    expect(parseMetricFieldValue("999999999999999999999999999999")).toBe(parseMetricFieldValue("-5"));
    expect(parseMetricFieldValue("999999999999999999999999999999")).not.toBe(parseMetricFieldValue(""));
  });
});

describe("deriveExternalId — happy path", () => {
  it("strips query string and hash, keeps origin + path", () => {
    expect(deriveExternalId("https://www.tiktok.com/@3jjewelry/video/123?_r=1&utm_source=x#foo")).toBe(
      "https://www.tiktok.com/@3jjewelry/video/123"
    );
  });
});

describe("deriveExternalId — edge cases", () => {
  it("strips a single trailing slash", () => {
    expect(deriveExternalId("https://www.tiktok.com/@3jjewelry/video/123/")).toBe(
      "https://www.tiktok.com/@3jjewelry/video/123"
    );
  });

  it("strips multiple trailing slashes", () => {
    expect(deriveExternalId("https://www.tiktok.com/@3jjewelry/video/123///")).toBe(
      "https://www.tiktok.com/@3jjewelry/video/123"
    );
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(deriveExternalId("   https://www.tiktok.com/@x/video/1   ")).toBe("https://www.tiktok.com/@x/video/1");
  });

  it("root path with no extra segments keeps a bare origin (path becomes empty string)", () => {
    expect(deriveExternalId("https://www.facebook.com/")).toBe("https://www.facebook.com");
  });

  it("a string that isn't a parseable URL falls back to the raw trimmed string, not a throw", () => {
    expect(deriveExternalId("not a url at all")).toBe("not a url at all");
  });

  it("empty string falls back to empty string, not a throw", () => {
    expect(deriveExternalId("")).toBe("");
  });

  it("whitespace-only string falls back to empty string after trim", () => {
    expect(deriveExternalId("   ")).toBe("");
  });

  it("two different tracking-param variants of the same post collapse to the same key " +
    "(this is the whole point of the function — dedup across re-copied share links)", () => {
    const a = deriveExternalId("https://www.tiktok.com/@x/video/1?_r=1");
    const b = deriveExternalId("https://www.tiktok.com/@x/video/1?utm_source=copy&utm_medium=share");
    expect(a).toBe(b);
  });

  it("query-string-only difference on otherwise-different paths still yields different keys " +
    "(sanity check that normalization isn't over-aggressive)", () => {
    const a = deriveExternalId("https://www.tiktok.com/@x/video/1?_r=1");
    const b = deriveExternalId("https://www.tiktok.com/@x/video/2?_r=1");
    expect(a).not.toBe(b);
  });

  it("unicode path segments (Thai text in a URL) round-trip without throwing", () => {
    expect(() => deriveExternalId("https://example.com/โพสต์ทดสอบ")).not.toThrow();
  });

  it("non-http(s) scheme still parses as a URL (this helper does not gate on scheme — " +
    "content_post_upsert's own http(s):// check, and upsertContentPost's client-side regex, are the real gate)", () => {
    expect(deriveExternalId("ftp://example.com/x/")).toBe("ftp://example.com/x");
  });
});

describe("isPostableArtifactType", () => {
  it("returns true for all 3 documented postable types", () => {
    expect(isPostableArtifactType("short_form_clip")).toBe(true);
    expect(isPostableArtifactType("live_highlight_clip")).toBe(true);
    expect(isPostableArtifactType("fb_post")).toBe(true);
  });

  it("returns false for a non-postable artifact type", () => {
    expect(isPostableArtifactType("broadcast_script_line")).toBe(false);
    expect(isPostableArtifactType("parcel_card")).toBe(false);
    expect(isPostableArtifactType("dm_script_1to1")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isPostableArtifactType("")).toBe(false);
  });

  it("is case-sensitive — a differently-cased match is rejected, not silently accepted", () => {
    expect(isPostableArtifactType("Short_Form_Clip")).toBe(false);
    expect(isPostableArtifactType("SHORT_FORM_CLIP")).toBe(false);
  });

  it("returns false for a completely unknown artifact_type string", () => {
    expect(isPostableArtifactType("some_future_artifact_type")).toBe(false);
  });
});
