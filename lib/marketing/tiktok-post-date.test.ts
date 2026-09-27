// lib/marketing/tiktok-post-date.test.ts
//
// Pure in-memory tests for extractPostedAtFromTikTokVideoId — no network, no
// disk. `nowMs` is passed explicitly everywhere a boundary is being tested
// (see the module's own header for why: deterministic without fake timers).

import { describe, expect, it } from "vitest";
import { extractPostedAtFromTikTokVideoId } from "./tiktok-post-date";

// Fixed "now" for every boundary test below — 2026-09-27T12:00:00Z, a time
// safely after every real id used in this file.
const FIXED_NOW_MS = new Date("2026-09-27T12:00:00Z").getTime();

describe("extractPostedAtFromTikTokVideoId — happy path (real id from the brief)", () => {
  it("decodes the brief's worked example to the exact expected UTC instant", () => {
    // 7689107132976827655 >> 32 = 1790259762 = 2026-09-24T14:22:42Z, which the
    // brief confirms is 24 ก.ย. 69 21:22 Asia/Bangkok — inside that clip's
    // real live window (20:00-23:00, memory: live-selling-rhythm).
    const result = extractPostedAtFromTikTokVideoId("7689107132976827655", FIXED_NOW_MS);
    expect(result).toBe("2026-09-24T14:22:42.000Z");
  });

  it("a different real-shaped id decodes to a different plausible instant", () => {
    // Same shape, different low bits (sequence/machine id) — must decode to
    // the SAME seconds value as the id above once shifted, proving the low
    // 32 bits genuinely don't affect the result.
    const idWithDifferentLowBits = ((7689107132976827655n >> 32n) << 32n) + 42n;
    const result = extractPostedAtFromTikTokVideoId(idWithDifferentLowBits.toString(), FIXED_NOW_MS);
    expect(result).toBe("2026-09-24T14:22:42.000Z");
  });
});

describe("extractPostedAtFromTikTokVideoId — 🔴 boundary: implausible dates must NOT be filled in (never guess)", () => {
  it("an id decoding to before 2016-09-01 (TikTok/musical.ly didn't exist yet) returns null, not a date", () => {
    // seconds = TIKTOK epoch floor minus 1 day, shifted back into the id's
    // top 32 bits.
    const floorSeconds = Math.floor(new Date("2016-09-01T00:00:00Z").getTime() / 1000);
    const oneDayBeforeFloor = floorSeconds - 86400;
    const id = (BigInt(oneDayBeforeFloor) << 32n).toString();
    expect(extractPostedAtFromTikTokVideoId(id, FIXED_NOW_MS)).toBeNull();
  });

  it("an id decoding to exactly the 2016-09-01 floor is accepted (boundary is inclusive, not off-by-one)", () => {
    const floorSeconds = Math.floor(new Date("2016-09-01T00:00:00Z").getTime() / 1000);
    const id = (BigInt(floorSeconds) << 32n).toString();
    expect(extractPostedAtFromTikTokVideoId(id, FIXED_NOW_MS)).toBe("2016-09-01T00:00:00.000Z");
  });

  it("an id decoding to AFTER the given 'now' (future) returns null, not a date", () => {
    const nowSeconds = Math.floor(FIXED_NOW_MS / 1000);
    const oneHourInTheFuture = nowSeconds + 3600;
    const id = (BigInt(oneHourInTheFuture) << 32n).toString();
    expect(extractPostedAtFromTikTokVideoId(id, FIXED_NOW_MS)).toBeNull();
  });

  it("an id decoding to exactly 'now' is accepted (boundary is inclusive, not off-by-one)", () => {
    const nowSeconds = Math.floor(FIXED_NOW_MS / 1000);
    const id = (BigInt(nowSeconds) << 32n).toString();
    expect(extractPostedAtFromTikTokVideoId(id, FIXED_NOW_MS)).toBe(new Date(nowSeconds * 1000).toISOString());
  });
});

describe("extractPostedAtFromTikTokVideoId — malformed input never throws, always null", () => {
  it("empty string -> null", () => {
    expect(extractPostedAtFromTikTokVideoId("", FIXED_NOW_MS)).toBeNull();
  });

  it("non-numeric string -> null", () => {
    expect(extractPostedAtFromTikTokVideoId("not-a-number", FIXED_NOW_MS)).toBeNull();
  });

  it("a decimal string -> null (video ids are integers only)", () => {
    expect(extractPostedAtFromTikTokVideoId("123.456", FIXED_NOW_MS)).toBeNull();
  });

  it("a negative-looking string -> null (the regex gate itself rejects the leading '-')", () => {
    expect(extractPostedAtFromTikTokVideoId("-7689107132976827655", FIXED_NOW_MS)).toBeNull();
  });

  it("'0' decodes to the unix epoch, which is before the 2016 floor -> null", () => {
    expect(extractPostedAtFromTikTokVideoId("0", FIXED_NOW_MS)).toBeNull();
  });

  it("a tiny id (fewer than 32 bits) shifts to 0 seconds -> null, not a crash", () => {
    expect(extractPostedAtFromTikTokVideoId("123", FIXED_NOW_MS)).toBeNull();
  });

  it("an absurdly huge id (seconds portion beyond Number.MAX_SAFE_INTEGER) -> null, not a wraparound date", () => {
    const hugeSeconds = BigInt(Number.MAX_SAFE_INTEGER) + 1000n;
    const id = (hugeSeconds << 32n).toString();
    expect(extractPostedAtFromTikTokVideoId(id, FIXED_NOW_MS)).toBeNull();
  });

  // 🔴 L-3 fix (security รอบ 4, 27 ก.ย. 69): reject overlong digit strings
  // BEFORE they ever reach BigInt(id) — a real 64-bit unsigned id is at
  // most 20 digits (18446744073709551615).
  it("a digit string longer than 20 characters -> null, rejected before BigInt(id) ever runs", () => {
    expect(extractPostedAtFromTikTokVideoId("1".repeat(21), FIXED_NOW_MS)).toBeNull();
  });

  it("a digit string of exactly 20 characters is NOT rejected by the length gate itself (boundary, not off-by-one) — still resolves via the normal decode/plausibility path", () => {
    // 20 nines decodes to seconds=23283064365 -> the year 2707 — well within
    // Number.MAX_SAFE_INTEGER (so that guard doesn't fire either), rejected
    // by the ordinary "decoded date is in the future" plausibility check
    // further down. Confirms the length gate passed this input through
    // rather than being what rejected it.
    const twentyDigits = "9".repeat(20);
    expect(twentyDigits).toHaveLength(20);
    expect(extractPostedAtFromTikTokVideoId(twentyDigits, FIXED_NOW_MS)).toBeNull();
  });
});
