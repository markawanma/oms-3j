// lib/marketing/text-safe-truncate.ts
//
// 🔴 M-3 fix (security รอบ 4, 27 ก.ย. 69): slicing a JS string at a fixed
// UTF-16 code-unit length can cut a surrogate pair (e.g. an emoji, which is
// 2 code units) in half, leaving a lone high surrogate at the end of the
// result. That's not just a cosmetic glitch — a lone surrogate makes the
// string malformed, and serializing malformed UTF-16 into the JSON body
// Postgres receives fails the WHOLE upsert, not just the caption field.
// That directly contradicts the rule this feature was built under: "oEmbed
// ห้ามบล็อกการบันทึก" — a caption that happens to have an emoji at exactly
// the wrong position would break the entire save.
//
// Shared between lib/marketing/tiktok-oembed.ts (truncating a caption
// fetched from TikTok) and lib/marketing/content-types.ts (L-1: defensive
// server-side re-normalization of whatever a client actually sends) so the
// surrogate-pair logic exists in exactly one place. Pure, zero
// dependencies — safe to import from either without creating a cycle.
//
// Deliberately hand-rolled instead of `String.prototype.toWellFormed()` /
// `.isWellFormed()` (ES2024): this repo's tsconfig.json pins `"lib":
// ["ES2022", ...]`, so those methods have no type declarations here even
// though the Node version running the tests happens to support them at
// runtime — using them would type-check against a DIFFERENT lib target
// than the rest of the project and silently rely on a coincidence of the
// current Node version, not the project's declared target.

const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;

/** Slices `text` to at most `maxLen` UTF-16 code units, backing off ONE
 * extra unit if the cut would otherwise land between a surrogate pair's two
 * halves (i.e. the last code unit of the naive slice is a high surrogate,
 * meaning its low-surrogate partner got cut off). Returns `text` unchanged
 * (no allocation) when it's already within the limit.
 *
 * This function only guards the cut point IT introduces — a lone low
 * surrogate already present at/before `maxLen` in already-malformed input
 * is left as-is; repairing pre-existing malformed input is a different
 * problem this function doesn't attempt to solve. */
export function truncateUtf16Safe(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  let cut = text.slice(0, maxLen);
  const lastCode = cut.charCodeAt(cut.length - 1);
  if (lastCode >= HIGH_SURROGATE_MIN && lastCode <= HIGH_SURROGATE_MAX) {
    cut = cut.slice(0, -1);
  }
  return cut;
}
