// lib/marketing/tiktok-oembed.ts
//
// Fetches a TikTok clip's caption + channel name from TikTok's own oEmbed
// endpoint (https://www.tiktok.com/oembed?url=...) — a public, documented
// endpoint TikTok itself serves specifically so third parties can embed a
// clip's title/author without scraping the page. This is NOT the "ห้ามสร้าง
// ตัวไล่เปิดลิงก์ TikTok อัตโนมัติเพื่อขูดตัวเลขจากหน้าเว็บ" the brief still
// forbids — oEmbed is a purpose-built API response (small JSON document),
// never the rendered page, and carries no view/like/comment/share numbers at
// all (see docs/3j-jewelry/analytics/ux-content-measurement.md §2.2's table —
// those numbers are gated behind the separate, not-yet-registered TikTok
// Display API, which this module does NOT call).
//
// Pure-ish module (does hit the network, unlike this directory's other
// "pure" helpers) — no "use server", no "server-only", so it stays directly
// unit-testable with a mocked global.fetch, same convention as
// tiktok-link.ts's resolveShortLink().
//
// 🔴 Decorative data only: per the brief, "oEmbed ล้มเหลว ห้ามบล็อกการบันทึก"
// — every failure path here returns `{ ok: false }` with NO error string at
// all (unlike canonicalizeTikTokLink's CanonicalizeTikTokLinkResult, which
// DOES carry an error the caller must surface). There is nothing for a
// caller to show the owner on failure; a caption is a nice-to-have
// confirmation aid, not a gate. Callers must silently fall back to
// `caption: null, authorName: null` and keep going.

import { parseCanonicalTikTokPostUrl, SHORT_LINK_USER_AGENT } from "./tiktok-link";

/** Result of fetchTikTokOEmbed(). Deliberately has NO `error` field on the
 * failure branch — see the module header for why (nothing actionable to
 * show the owner; every failure is silent-and-continue by design). */
export type TikTokOEmbedResult =
  | { ok: true; caption: string | null; authorName: string | null }
  | { ok: false };

/** Total wall-clock budget for the oEmbed request — same order of magnitude
 * as tiktok-link.ts's short-link resolution budget (4s), for the same
 * reason: this runs inside the same Vercel function call as the rest of
 * inspectContentLink, which has its own hard function-timeout wall. */
const OEMBED_TIMEOUT_MS = 4000;

/** Caption length cap. supabase/migrations/0148_content_post.sql's
 * `content_post.caption_snapshot` column is plain `text` with NO length
 * CHECK constraint (confirmed by reading the migration directly, not
 * assumed) — so this is a defensive cap this module imposes on ITS OWN
 * output, not a mirror of a DB constraint. 500 matches the cap this
 * project already uses for `post_url`/`external_id` (0148's own
 * `content_post_url_len_check`/`content_post_external_id_len_check`) as a
 * reasonable, consistent ceiling for a single line of free text. */
const CAPTION_MAX_LEN = 500;

function truncateCaption(raw: string): string {
  return raw.length > CAPTION_MAX_LEN ? raw.slice(0, CAPTION_MAX_LEN) : raw;
}

/** True only when `oembedUrl` is a request this module is willing to send —
 * built ONLY from a URL that already parses as a canonical
 * (https://www.tiktok.com/@user/video|photo/<id>) post link. This is a
 * defensive re-check of the caller's contract (inspectContentLink must only
 * ever pass the `.url` a prior canonicalizeTikTokLink() call already
 * accepted — never raw pasted input), not a trust boundary this module
 * establishes on its own. */
function isSafeCanonicalTikTokUrl(url: string): boolean {
  return parseCanonicalTikTokPostUrl(url) !== null;
}

/**
 * Fetches https://www.tiktok.com/oembed?url=<canonicalUrl> and extracts the
 * clip's caption (`title`) and channel display name (`author_name`).
 *
 * `canonicalUrl` MUST already be the canonical output of
 * canonicalizeTikTokLink() — this function builds the request URL by
 * encoding exactly that string, never any raw/untrusted input, and refuses
 * (network call skipped entirely) if it doesn't look like one.
 *
 * Never throws. Every failure — non-2xx response, network error, timeout,
 * malformed/non-JSON body, a JSON body that isn't shaped like an oEmbed
 * response — is swallowed and reported as `{ ok: false }`. Only `status`
 * and the request host are ever logged; the response body is never logged
 * verbatim (see lib/supabase/postgrest-error.ts's redactUrls for the same
 * discipline applied to a different data source).
 */
export async function fetchTikTokOEmbed(canonicalUrl: string): Promise<TikTokOEmbedResult> {
  if (!isSafeCanonicalTikTokUrl(canonicalUrl)) {
    console.error("fetchTikTokOEmbed: refused — input is not a canonical TikTok post URL");
    return { ok: false };
  }

  const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(canonicalUrl)}`;

  let response: Response;
  try {
    response = await fetch(oembedUrl, {
      method: "GET",
      credentials: "omit",
      signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS),
      headers: { "user-agent": SHORT_LINK_USER_AGENT, accept: "application/json" },
    });
  } catch (err) {
    // Network error / timeout — never log `err` itself (some fetch
    // implementations embed the request URL, including query string, in the
    // error message — same risk tiktok-link.ts's resolveShortLink documents).
    console.error("fetchTikTokOEmbed: fetch failed", {
      host: "www.tiktok.com",
      errorName: err instanceof Error ? err.name : "unknown",
    });
    return { ok: false };
  }

  if (!response.ok) {
    console.error("fetchTikTokOEmbed: non-2xx response", { host: "www.tiktok.com", status: response.status });
    return { ok: false };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    // Malformed/non-JSON body — TikTok returning an HTML error page instead
    // of JSON (bot protection, endpoint hiccup, etc.) must not throw.
    console.error("fetchTikTokOEmbed: response body was not valid JSON", { host: "www.tiktok.com" });
    return { ok: false };
  }

  if (typeof json !== "object" || json === null) {
    console.error("fetchTikTokOEmbed: response JSON was not an object", { host: "www.tiktok.com" });
    return { ok: false };
  }

  const body = json as Record<string, unknown>;
  const rawTitle = body.title;
  const rawAuthorName = body.author_name;

  const caption = typeof rawTitle === "string" && rawTitle.trim() !== "" ? truncateCaption(rawTitle.trim()) : null;
  const authorName =
    typeof rawAuthorName === "string" && rawAuthorName.trim() !== "" ? rawAuthorName.trim() : null;

  return { ok: true, caption, authorName };
}
