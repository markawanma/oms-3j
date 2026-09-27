// lib/marketing/text-safe-truncate.test.ts
//
// Pure in-memory tests. `isWellFormedUtf16` below is a TEST-ONLY assertion
// helper (not exported from production code) — this repo's tsconfig.json
// pins `"lib": ["ES2022"]`, so the real `String.prototype.isWellFormed()`
// (ES2024) has no type declarations under this project's build target; see
// text-safe-truncate.ts's own header for why production code doesn't use it
// either. This reimplements the same check by hand purely so the test can
// assert on it without depending on a lib version the project doesn't
// declare.

import { describe, expect, it } from "vitest";
import { truncateUtf16Safe } from "./text-safe-truncate";

/** True if `s` has no lone (unpaired) surrogate anywhere. */
function isWellFormedUtf16(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return false;
      i++; // skip the low surrogate we just validated as paired
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false; // lone low surrogate, not preceded by a matched high one
    }
  }
  return true;
}

describe("truncateUtf16Safe — happy path", () => {
  it("string shorter than maxLen is returned unchanged", () => {
    expect(truncateUtf16Safe("hello", 500)).toBe("hello");
  });

  it("string exactly at maxLen is returned unchanged (boundary, not off-by-one)", () => {
    const exact = "a".repeat(500);
    expect(truncateUtf16Safe(exact, 500)).toBe(exact);
    expect(truncateUtf16Safe(exact, 500)).toHaveLength(500);
  });

  it("string longer than maxLen (pure ASCII, no surrogate risk) is cut to exactly maxLen", () => {
    const long = "a".repeat(600);
    const result = truncateUtf16Safe(long, 500);
    expect(result).toHaveLength(500);
    expect(result).toBe(long.slice(0, 500));
  });
});

describe("truncateUtf16Safe — 🔴 M-3: never cut a surrogate pair in half", () => {
  it("an emoji (2 code units) straddling exactly the cut point -> backs off one extra unit, stays well-formed", () => {
    // 499 ASCII chars + a 2-unit emoji = 501 code units. Slicing naively at
    // 500 keeps the emoji's HIGH surrogate (index 499) but drops its LOW
    // surrogate (index 500) -> a lone high surrogate, malformed.
    const emoji = "\u{1F600}"; // 😀 — U+1F600, encoded as a surrogate pair
    expect(emoji).toHaveLength(2);
    const text = "a".repeat(499) + emoji;
    expect(text).toHaveLength(501);

    const result = truncateUtf16Safe(text, 500);

    expect(isWellFormedUtf16(result)).toBe(true);
    // Backed off the WHOLE emoji, not just its trailing surrogate — the
    // result is the 499 plain chars with the (now-incomplete) emoji dropped
    // entirely, never a half-emoji.
    expect(result).toBe("a".repeat(499));
    expect(result).toHaveLength(499);
  });

  it("an emoji that fits ENTIRELY within maxLen is preserved whole, not truncated", () => {
    const emoji = "\u{1F600}";
    const text = "a".repeat(498) + emoji; // 498 + 2 = 500, fits exactly
    expect(text).toHaveLength(500);
    const result = truncateUtf16Safe(text, 500);
    expect(result).toBe(text);
    expect(isWellFormedUtf16(result)).toBe(true);
  });

  it("multiple emoji, cut point lands after a complete pair -> unaffected, still well-formed", () => {
    const emoji = "\u{1F600}";
    const text = emoji.repeat(300); // 600 code units, 300 complete pairs
    const result = truncateUtf16Safe(text, 500);
    // 500 is itself an even number of code units into a run of 2-unit
    // pairs, so the naive cut already lands cleanly on a pair boundary —
    // this proves the function doesn't OVER-trim when it doesn't need to.
    expect(result).toHaveLength(500);
    expect(isWellFormedUtf16(result)).toBe(true);
  });

  it("a lone low surrogate already present well before the cut point is left as-is (not this function's problem to fix)", () => {
    // Deliberately malformed INPUT (not something this function introduced)
    // — documents the stated scope limit rather than silently "fixing" data
    // that was already broken before truncation ever ran.
    const alreadyMalformed = "a" + String.fromCharCode(0xdc00) + "b".repeat(600);
    const result = truncateUtf16Safe(alreadyMalformed, 500);
    expect(result).toHaveLength(500);
    expect(result.charCodeAt(1)).toBe(0xdc00);
  });
});
