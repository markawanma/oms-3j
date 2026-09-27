// lib/marketing/tiktok-post-date.ts
//
// Derives a TikTok clip's posted-at timestamp straight from its video id —
// no network call. TikTok ids are Twitter-snowflake-shaped: the top 32 bits
// (id >> 32) are the unix timestamp in seconds the id was minted at. Verified
// against 4 real clips from this shop (27 ก.ย. 69 — Tech Lead brief) and
// re-verified here against the same worked example the brief gives:
//   7689107132976827655 >> 32 = 1790259762 = 2026-09-24T14:22:42Z
//                                           = 24 ก.ย. 69, 21:22 น. (Asia/Bangkok)
// which lands inside that clip's real live window — see memory
// live-selling-rhythm (ไลฟ์ทุกวัน 20:00-23:00).
//
// Pure module — no "use server", no "server-only", no network — same
// reasoning as tiktok-link.ts: needs to be directly unit-testable and
// importable from both the server action (lib/actions/content.ts) and tests.
//
// 🔴 This decoding has NO official TikTok documentation behind it — it is an
// observed pattern, not a contract TikTok promises to keep. If TikTok ever
// changes how ids are minted, this function's only job is to fail SAFE:
// return null (never throw, never guess) so the caller leaves the "วันที่
// โพสต์" field for the owner to fill in by hand — exactly like the boundary
// checks below already do for ids that decode to an implausible date.

/** Floor of the plausible range — TikTok (as "musical.ly") launched
 * 2016-09-01; nothing genuinely on TikTok can predate this. A decoded
 * timestamp below this floor means the id isn't snowflake-shaped the way
 * this function assumes (or is garbage), not that the clip is somehow very
 * old — reject rather than store a nonsense date silently. */
const TIKTOK_ID_EPOCH_FLOOR_SECONDS = Math.floor(new Date("2016-09-01T00:00:00Z").getTime() / 1000);

/**
 * Decodes a TikTok video/photo id's embedded unix timestamp into an ISO
 * datetime string, or null if the id doesn't decode to a plausible date.
 *
 * "Plausible" = inclusive on BOTH ends — a decoded value exactly equal to
 * the 2016-09-01 floor or exactly equal to `nowMs` is accepted; anything
 * strictly outside that closed range is rejected, never clamped into it,
 * per the brief's own boundary rule (ห้ามเดาค่าที่ดูสมเหตุสมผล ต้องปล่อยว่าง
 * ถ้าไม่ชัวร์). Both boundaries have their own explicit test coverage
 * (tiktok-post-date.test.ts) precisely because "inclusive vs. exclusive" is
 * the kind of off-by-one that's easy to get backwards silently.
 *
 * `nowMs` defaults to `Date.now()` and exists ONLY so tests can pin "now"
 * deterministically without `vi.useFakeTimers()` — every real caller should
 * omit it.
 *
 * Never throws: a non-numeric id, a negative id, or a BigInt overflow all
 * fall through to `null` — this function's contract with every caller is
 * "give me a field to leave blank, not an exception to handle".
 */
export function extractPostedAtFromTikTokVideoId(id: string, nowMs: number = Date.now()): string | null {
  if (!/^\d+$/.test(id)) return null;
  // 🔴 L-3 fix (security รอบ 4, 27 ก.ย. 69): a real TikTok id is a 64-bit
  // unsigned value, whose maximum (18446744073709551615) is 20 decimal
  // digits — reject anything longer BEFORE it ever reaches BigInt(id).
  // Today's real ids are 19 digits; 20 leaves headroom without accepting an
  // arbitrarily long digit string some caller could hand this.
  if (id.length > 20) return null;

  let raw: bigint;
  try {
    raw = BigInt(id);
  } catch {
    return null;
  }
  if (raw < 0n) return null;

  const secondsBig = raw >> 32n;
  // Guard the BigInt -> Number conversion BEFORE it happens — a seconds
  // value this large is already nonsense (thousands of years from now), and
  // Number() on a BigInt past MAX_SAFE_INTEGER silently loses precision
  // rather than throwing, which could otherwise round into the plausible
  // range by accident.
  if (secondsBig > BigInt(Number.MAX_SAFE_INTEGER)) return null;

  const seconds = Number(secondsBig);
  if (!Number.isFinite(seconds)) return null;

  const nowSeconds = Math.floor(nowMs / 1000);
  if (seconds < TIKTOK_ID_EPOCH_FLOOR_SECONDS || seconds > nowSeconds) return null;

  return new Date(seconds * 1000).toISOString();
}
