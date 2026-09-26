// lib/marketing/tiktok-link.ts
//
// Canonicalizes every shape of TikTok link the owner might paste into ONE
// form (https://www.tiktok.com/@<user>/video/<id> or .../photo/<id>) before
// lib/actions/content.ts's upsertContentPost() calls deriveExternalId() on
// it. Real production incident this fixes (26 ก.ย. 69):
//
//   https://vt.tiktok.com/ZSbYUGv9e            = a short link for the SAME
//   https://www.tiktok.com/@3jjewelry/video/... = clip, pasted on two
//                                                  different days
//
//   deriveExternalId() (lib/marketing/content-types.ts) only strips query/
//   hash — it never normalizes host or resolves short links — so the two
//   links above became two content_post rows and the same clip's numbers
//   got split in half.
//
//   https://vt.tiktok.com/ZS9As5qtoAyuL-dgskp — a second short link pasted
//   the same week — doesn't even point at a clip. It resolves to
//   /@3jjewelry/live. A live stream isn't a "post" (that's measured
//   separately via analytics.live_night_snapshot, see memory
//   live-session-log) — it got stuck in the T+1/T+3/T+7 read queue forever
//   with no real numbers ever obtainable.
//
// Pure module — no "use server", no "server-only" — same reasoning as
// content-errors.ts: needs to be unit-testable directly (fetch mocked, no
// real TikTok requests — see tiktok-link.test.ts's header for why that's a
// hard rule) and importable from both the server action and tests.
//
// Anything that ISN'T tiktok.com or a *.tiktok.com subdomain (Facebook,
// Instagram, LINE OA, or garbage that doesn't even parse as a URL) is
// returned completely unchanged, with zero network calls — this module
// only ever tightens TikTok handling, never touches other platforms.

/** Result of canonicalizeTikTokLink(). Discriminated on `ok` so a caller
 * can't read `.url` off a rejected result or `.error` off an accepted one
 * without narrowing first — same shape convention as this repo's
 * ActionResult<T> (lib/types.ts), kept separate because this isn't a server
 * action result and doesn't want that import here. */
export type CanonicalizeTikTokLinkResult = { ok: true; url: string } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Thai error messages — exported so tests can assert by identity instead of
// duplicating the Thai text, and so content-errors.ts / callers can reuse
// the exact wording if they ever need to recognize these specific failures.
// ---------------------------------------------------------------------------

export const TIKTOK_LIVE_LINK_ERROR =
  "ลิงก์นี้เป็นลิงก์ไลฟ์ ไม่ใช่โพสต์คลิป — ระบบนี้เก็บได้เฉพาะคลิป (ยอดไลฟ์ดูที่หน้าไลฟ์)";

export const TIKTOK_PROFILE_LINK_ERROR =
  "ลิงก์นี้เป็นลิงก์หน้าโปรไฟล์ ไม่ใช่ลิงก์คลิป — เปิดคลิปที่ต้องการแล้วกด \"คัดลอกลิงก์\" จากหน้าคลิปมาวางแทน";

export const TIKTOK_UNRECOGNIZED_LINK_ERROR =
  "ระบบไม่รู้จักลิงก์ TikTok รูปแบบนี้ — เปิดคลิปใน TikTok แล้วกด \"คัดลอกลิงก์\" จากหน้าคลิป " +
  "(ลิงก์ยาวที่มีคำว่า /video/) มาวางแทน";

/** Shared with the "fetch failed to resolve the short link" path AND every
 * hard-stop mid-redirect-chain case (blocked host, non-https hop, too many
 * hops, non-2xx/3xx status, missing/unparseable Location) — from the
 * owner's point of view all of these are the same actionable instruction:
 * the short link didn't work, go get the long one instead. We deliberately
 * do NOT fall back to storing the short link raw — that reopens the exact
 * "จอกับ DB พูดไม่ตรงกันโดยไม่มี error" bug class this project has already
 * closed 8 instances of (see brief). */
export const TIKTOK_SHORT_LINK_UNRESOLVED_ERROR =
  "เปิดลิงก์สั้นไม่สำเร็จ — เปิดคลิปใน TikTok แล้วกด \"คัดลอกลิงก์\" จากหน้าคลิป " +
  "(ลิงก์ยาวที่มีคำว่า /video/) มาวางแทน";

// ---------------------------------------------------------------------------
// Host / path classification
// ---------------------------------------------------------------------------

/** Exact match on "tiktok.com" or a real subdomain suffix ".tiktok.com" —
 * deliberately NOT `hostname.includes("tiktok.com")`, which would also
 * accept "evil-tiktok.com" (contains the substring, isn't a subdomain) and
 * "tiktok.com.evil.net" (contains the substring, resolves to evil.net).
 * `URL.hostname` is already lowercased and IDNA/IPv4-literal-normalized by
 * the WHATWG URL parser, so this one check also rejects every IP-literal
 * encoding (dotted-decimal, hex, octal, decimal) and bracketed IPv6 —
 * none of those strings can end in ".tiktok.com". */
function isTikTokHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "tiktok.com" || h.endsWith(".tiktok.com");
}

/** Short-link hosts/paths that require a network hop to resolve — the
 * mobile share-sheet's "copy link" button produces one of these, never a
 * full /video/ or /photo/ URL. `vt.`/`vm.` short-code paths are opaque (any
 * path counts); `www.tiktok.com/t/<code>` is TikTok's other short-link
 * shape and needs the specific `/t/<code>` path check since www.tiktok.com
 * otherwise hosts real pages. */
function isShortLinkUrl(u: URL): boolean {
  const host = u.hostname.toLowerCase();
  if (host === "vt.tiktok.com" || host === "vm.tiktok.com") return true;
  if (host === "www.tiktok.com" || host === "tiktok.com") {
    return SHORT_LINK_T_PATH_RE.test(normalizePath(u.pathname));
  }
  return false;
}

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

const VIDEO_OR_PHOTO_PATH_RE = /^\/(@[A-Za-z0-9_.]+)\/(video|photo)\/(\d+)$/;
const LIVE_PATH_RE = /^\/@[A-Za-z0-9_.]+\/live$/;
const PROFILE_ONLY_PATH_RE = /^\/@[A-Za-z0-9_.]+$/;
const SHORT_LINK_T_PATH_RE = /^\/t\/[A-Za-z0-9_-]+$/;

type PathClassification =
  | { kind: "video" | "photo"; user: string; id: string }
  | { kind: "live" }
  | { kind: "profile" }
  | { kind: "other" };

/** Classifies a TikTok path into the 4 shapes this module knows about.
 * Used both for a link pasted directly (already-canonical or a direct
 * live/profile paste) AND for the final landing page after following a
 * short link's redirect chain — same rules either way, single source of
 * truth so "resolved via redirect" can never be treated more leniently
 * than "pasted directly". */
function classifyTikTokPath(pathname: string): PathClassification {
  const path = normalizePath(pathname);
  const videoOrPhoto = path.match(VIDEO_OR_PHOTO_PATH_RE);
  if (videoOrPhoto) {
    return { kind: videoOrPhoto[2] as "video" | "photo", user: videoOrPhoto[1], id: videoOrPhoto[3] };
  }
  if (LIVE_PATH_RE.test(path)) return { kind: "live" };
  if (PROFILE_ONLY_PATH_RE.test(path)) return { kind: "profile" };
  return { kind: "other" };
}

function buildCanonicalUrl(user: string, kind: "video" | "photo", id: string): string {
  return `https://www.tiktok.com/${user}/${kind}/${id}`;
}

function resultFromClassification(c: PathClassification): CanonicalizeTikTokLinkResult {
  if (c.kind === "video" || c.kind === "photo") {
    return { ok: true, url: buildCanonicalUrl(c.user, c.kind, c.id) };
  }
  if (c.kind === "live") return { ok: false, error: TIKTOK_LIVE_LINK_ERROR };
  if (c.kind === "profile") return { ok: false, error: TIKTOK_PROFILE_LINK_ERROR };
  return { ok: false, error: TIKTOK_UNRECOGNIZED_LINK_ERROR };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** Canonicalizes a pasted URL for storage as content_post.post_url — call
 * this BEFORE deriveExternalId() (see lib/actions/content.ts's
 * upsertContentPost). Non-TikTok URLs and unparseable strings are returned
 * unchanged, synchronously, with zero network calls. TikTok URLs that
 * already contain /video/<id> or /photo/<id> are canonicalized locally
 * (strip query/hash, force host to www.tiktok.com) — also zero network
 * calls. Only TikTok short links (vt./vm./www.tiktok.com/t/<code>) hit the
 * network, and only to read the `Location` header of each redirect hop —
 * see resolveShortLink() below for the SSRF/timeout/redirect-count guards
 * on that path. */
export async function canonicalizeTikTokLink(rawUrl: string): Promise<CanonicalizeTikTokLinkResult> {
  const trimmed = rawUrl.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // Not a parseable URL at all — not this module's concern. upsertContentPost's
    // own http(s):// regex (checked before this function is called) is the
    // real gate on garbage input; pass through unchanged either way.
    return { ok: true, url: trimmed };
  }

  if (!isTikTokHost(parsed.hostname)) {
    return { ok: true, url: trimmed }; // Facebook / Instagram / LINE OA / anything else
  }

  // Check "already has /video/ or /photo/ in the path" BEFORE the short-link
  // check (brief's own ordering: item 2 before item 3) — a URL can only
  // match one of the two path shapes, but this ordering keeps "does this
  // already look like a real post" the authoritative check regardless of
  // which host it arrived on.
  const local = classifyTikTokPath(parsed.pathname);
  if (local.kind === "video" || local.kind === "photo") {
    return resultFromClassification(local);
  }

  if (isShortLinkUrl(parsed)) {
    return resolveShortLink(trimmed);
  }

  // TikTok host, not a short link, not already a video/photo path — either a
  // direct paste of a live/profile link, or some other TikTok page shape
  // (search, hashtag, music, malformed username, ...) this module doesn't
  // recognize. Reject rather than guess; see the "ห้ามผ่าน" table in the brief.
  return resultFromClassification(local);
}

// ---------------------------------------------------------------------------
// Short-link resolution
// ---------------------------------------------------------------------------

/** Hops allowed after the initial request — i.e. up to 5 redirects may be
 * followed; encountering a 6th is rejected as "too many redirects" without
 * being followed. */
const MAX_REDIRECTS = 5;

/** Total wall-clock budget for the WHOLE resolution (all hops combined),
 * not per-hop — a single AbortSignal.timeout() instance is created once per
 * call and reused across every fetch in the loop below. */
const TOTAL_TIMEOUT_MS = 8000;

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "unknown";
}

/** True only if it's safe to send a request to this exact hop — https only,
 * and host is tiktok.com or a real subdomain of it. Checked before EVERY
 * fetch in the loop below (including the very first one), so a redirect
 * that points somewhere else is rejected before a second request is ever
 * sent — using `redirect: "manual"` (never "follow") is what makes that
 * possible; "follow" would send the request to the untrusted target before
 * this module ever gets a chance to look at it. */
function isSafeHopUrl(u: URL): boolean {
  return u.protocol === "https:" && isTikTokHost(u.hostname);
}

/** Resolves a TikTok short link to its real destination and canonicalizes
 * that destination — network calls are HEAD-of-chain only: manual redirect
 * following, host+scheme validated before every hop, response body never
 * read (only `status` and the `location` header), no cookies sent, ≤8s
 * total across the whole chain, ≤5 redirects followed. */
async function resolveShortLink(startUrl: string): Promise<CanonicalizeTikTokLinkResult> {
  // One signal for the entire chain — reusing it across every fetch() call
  // below is what makes the 8s budget a TOTAL budget, not 8s per hop.
  const signal = AbortSignal.timeout(TOTAL_TIMEOUT_MS);

  let current: URL;
  try {
    current = new URL(startUrl);
  } catch {
    // Unreachable in practice (the caller already parsed this URL
    // successfully before routing here) — handled anyway so this function
    // can never throw.
    return { ok: false, error: TIKTOK_SHORT_LINK_UNRESOLVED_ERROR };
  }

  let redirectsFollowed = 0;

  for (;;) {
    if (!isSafeHopUrl(current)) {
      // Either the very first URL wasn't https (shouldn't happen — callers
      // only reach here via isShortLinkUrl(), which is already TikTok-only —
      // this branch's real job is catching a REDIRECT that points off
      // tiktok.com, or downgrades to http, per the brief's SSRF guard) or a
      // prior hop's Location header pointed somewhere unsafe. Reject WITHOUT
      // sending a request to `current` — never log the path (it may carry
      // the untrusted redirect target's query string).
      console.error("canonicalizeTikTokLink: rejected an unsafe redirect hop", {
        host: current.hostname,
        protocol: current.protocol,
      });
      return { ok: false, error: TIKTOK_SHORT_LINK_UNRESOLVED_ERROR };
    }

    let response: Response;
    try {
      response = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        signal,
      });
    } catch (err) {
      // Network error, DNS failure, or the shared AbortSignal firing
      // (timeout) — never log `err` directly, some fetch implementations
      // embed the request URL (with query string) in the error message.
      console.error("canonicalizeTikTokLink: fetch failed while resolving short link", {
        host: current.hostname,
        errorName: errorName(err),
      });
      return { ok: false, error: TIKTOK_SHORT_LINK_UNRESOLVED_ERROR };
    }

    // Never read the body — we only ever need `status` and the `location`
    // header. Release the underlying connection immediately either way.
    try {
      void response.body?.cancel();
    } catch {
      // best-effort cleanup only
    }

    if (response.status >= 300 && response.status < 400) {
      if (redirectsFollowed >= MAX_REDIRECTS) {
        console.error("canonicalizeTikTokLink: too many redirects resolving short link", {
          host: current.hostname,
          redirectsFollowed,
        });
        return { ok: false, error: TIKTOK_SHORT_LINK_UNRESOLVED_ERROR };
      }

      const location = response.headers.get("location");
      if (!location) {
        console.error("canonicalizeTikTokLink: redirect response had no Location header", {
          host: current.hostname,
          status: response.status,
        });
        return { ok: false, error: TIKTOK_SHORT_LINK_UNRESOLVED_ERROR };
      }

      let next: URL;
      try {
        // Resolve relative Location headers against the current URL, same
        // as a browser would.
        next = new URL(location, current);
      } catch {
        console.error("canonicalizeTikTokLink: Location header did not parse as a URL", {
          host: current.hostname,
        });
        return { ok: false, error: TIKTOK_SHORT_LINK_UNRESOLVED_ERROR };
      }

      redirectsFollowed += 1;
      current = next; // isSafeHopUrl(current) is re-checked at the top of the next loop iteration
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      console.error("canonicalizeTikTokLink: short link fetch returned a non-2xx/3xx status", {
        host: current.hostname,
        status: response.status,
      });
      return { ok: false, error: TIKTOK_SHORT_LINK_UNRESOLVED_ERROR };
    }

    // 2xx — `current` is the fully-resolved destination. Classify it with
    // the exact same rules a direct paste would get (see canonicalizeTikTokLink).
    const finalClassification = classifyTikTokPath(current.pathname);
    if (finalClassification.kind !== "video" && finalClassification.kind !== "photo") {
      console.error("canonicalizeTikTokLink: short link resolved to a non-post page", {
        host: current.hostname,
        kind: finalClassification.kind,
      });
    }
    return resultFromClassification(finalClassification);
  }
}
