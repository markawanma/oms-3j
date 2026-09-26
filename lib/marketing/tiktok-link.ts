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
//
// 🔴 L4 (security รอบ 2, 26 ก.ย. 69): resolveShortLink() below depends on
// `redirect: "manual"` actually handing back a 3xx response with a readable
// `Location` header — that is Node's `undici` fetch behavior specifically.
// On the Edge runtime, `fetch()`'s "manual" redirect mode returns an
// **opaqueredirect** response instead (status 0, no headers readable at
// all, by the Fetch spec's CORS-derived design) — every `response.status`
// check and `response.headers.get("location")` call below would silently
// see nothing usable, and this module would reject every short link with
// TIKTOK_SHORT_LINK_UNRESOLVED_ERROR while every existing mocked-fetch unit
// test still passes (the mocks don't emulate opaqueredirect). If anyone
// ever adds `export const runtime = "edge"` to a route that imports this
// module: stop, this module needs the Node runtime, full stop.

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
 * none of those strings can end in ".tiktok.com".
 *
 * 🔴 M5 fix (security รอบ 2, 26 ก.ย. 69): strip exactly ONE trailing dot
 * before comparing — DNS allows a trailing "." to mean "this is already a
 * fully-qualified name" (e.g. "www.tiktok.com."), and the WHATWG URL parser
 * preserves that dot in `.hostname` rather than stripping it. Without this,
 * `endsWith(".tiktok.com")` is false for that exact string ⇒ it fell
 * through to pass-through-unchanged (treated as "not TikTok at all") ⇒ a
 * link pasted in FQDN form created a second, un-deduplicated content_post
 * row for a clip already stored under the normal form. Stripping one
 * trailing dot doesn't open any new SSRF surface: "evil.com." still doesn't
 * end in ".tiktok.com" after the strip either. */
function isTikTokHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
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
 * call and reused across every fetch in the loop below.
 *
 * 🔴 M4 fix (security รอบ 2, 26 ก.ย. 69): was 8000 — cut in half now that
 * M3 (below) removes the confirming second request on the common path, so
 * 4s is no longer tighter than the old budget actually was in practice for
 * a single-hop short link. The real reason to cut it: Vercel's function
 * timeout is a hard wall — if this budget is close to (or over) it, a slow
 * TikTok response means Vercel kills the whole request with a bare 504
 * before this module's own `TIKTOK_SHORT_LINK_UNRESOLVED_ERROR` (or any
 * Thai message at all) ever reaches the browser. See maxDuration on the two
 * pages that call into this (app/(dashboard)/marketing/content/entry/page.tsx,
 * app/(dashboard)/marketing/calendar/[stepId]/page.tsx) — this constant
 * must stay comfortably under that. */
const TOTAL_TIMEOUT_MS = 4000;

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "unknown";
}

/** True only if it's safe to send a request to this exact hop — https only,
 * and host is tiktok.com or a real subdomain of it. Checked before EVERY
 * fetch in the loop below (including the very first one), so a redirect
 * that points somewhere else is rejected before a second request is ever
 * sent — using `redirect: "manual"` (never "follow") is what makes that
 * possible; "follow" would send the request to the untrusted target before
 * this module ever gets a chance to look at it.
 *
 * 🔴 L1 fix (security รอบ 2, 26 ก.ย. 69): also require a standard/implicit
 * HTTPS port — a redirect to "https://vt.tiktok.com:8080/..." passed the
 * old check (protocol+host only) and would have been followed to whatever
 * is actually listening on that port on TikTok's infrastructure (or, if the
 * host check itself were ever weakened, an attacker-chosen port on an
 * attacker-chosen host). `u.port` is `""` for the default port (443, since
 * `u.protocol` is already pinned to "https:") or the explicit string if one
 * was given — anything other than "" or "443" is rejected. */
function isSafeHopUrl(u: URL): boolean {
  return u.protocol === "https:" && isTikTokHost(u.hostname) && (u.port === "" || u.port === "443");
}

/** A realistic desktop browser User-Agent — L3 fix (security รอบ 2, 26 ก.ย.
 * 69). Without an explicit one, undici sends its own default UA string,
 * which is a much easier signal for bot-protection to key off of than a
 * mainstream browser's — this single header is what most affects whether
 * this feature actually works against TikTok's real infrastructure from a
 * Vercel-hosted IP, as opposed to just passing this file's mocked-fetch
 * unit tests. Kept as one shared constant, not per-request-randomized —
 * rotating UAs to look "less botlike" is an arms race this module has no
 * business entering; a stable, honest, current browser UA is the ask. */
const SHORT_LINK_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Resolves a TikTok short link to its real destination and canonicalizes
 * that destination — network calls are HEAD-of-chain only: manual redirect
 * following, host+scheme+port validated before every hop, response body
 * never read (only `status` and the `location` header), no cookies sent,
 * ≤4s total across the whole chain, ≤5 redirects followed. */
async function resolveShortLink(startUrl: string): Promise<CanonicalizeTikTokLinkResult> {
  // One signal for the entire chain — reusing it across every fetch() call
  // below is what makes the 4s budget a TOTAL budget, not 4s per hop.
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
        headers: { "user-agent": SHORT_LINK_USER_AGENT },
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
    //
    // 🔴 L2 fix (security รอบ 2, 26 ก.ย. 69): `try/catch` alone only catches
    // a SYNCHRONOUS throw from the `.cancel()` call itself — `.cancel()`
    // returns a Promise, so a REJECTION from it was an unhandled promise
    // rejection this catch never saw (Node logs those and, depending on
    // version/flags, can crash the process). `.catch()` on the promise is
    // what actually swallows the async failure path; the outer try/catch
    // stays as defense against a synchronous throw from the property
    // access itself.
    try {
      response.body?.cancel().catch(() => {});
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

      // 🔴 M3 fix (security รอบ 2, 26 ก.ย. 69): if this Location header
      // already points at a safe hop whose PATH is unambiguously a video/
      // photo page, return right now instead of following up with a whole
      // second GET request just to confirm the response is 2xx. That
      // confirming request never taught this function anything new — the
      // body was never read either way (only `status`), and a video/photo
      // path shape from a `Location` header is exactly as trustworthy as
      // the same path pasted directly (classifyTikTokPath() is the same
      // function either way) — it's also the single highest-risk request
      // in the whole chain for a 403 from bot protection, since it's a GET
      // against www.tiktok.com's actual page rendering path rather than a
      // redirect-only endpoint. Intentionally scoped to video/photo only
      // (not live/profile/other) — those still fall through to the normal
      // fetch-and-classify path below, unchanged from before this fix.
      if (isSafeHopUrl(next)) {
        const earlyClassification = classifyTikTokPath(next.pathname);
        if (earlyClassification.kind === "video" || earlyClassification.kind === "photo") {
          return resultFromClassification(earlyClassification);
        }
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
