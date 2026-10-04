"use server";

// lib/actions/trend-radar.ts — "/marketing/trend-radar" (Tech Lead brief
// 4 ต.ค. 69): reads the daily-trend-radar scheduled task's output WITHOUT
// touching that task or its markdown files — this module only reads.
//
// 🔴 Reads from GitHub, not local disk. The scheduled task writes
// docs/3j-jewelry/marketing/trend-radar/YYYY-MM-DD.md on the DEV machine's
// disk, but the live site runs on Vercel — a completely different machine
// that can never see that file until it's merged to main and redeployed,
// which defeats "daily". The task instead pushes those files to a separate
// branch (`trend-radar-feed`, deliberately never merged into main — see that
// branch's own history) and this module fetches straight from GitHub's API
// on every page load, so the owner always sees today's file without any
// deploy in between.
//
// Auth token is OPTIONAL (backward-compatible): `GITHUB_TRENDRADAR_TOKEN`
// (server-only env var, fine-grained PAT scoped to Contents:read on this one
// repo) is read by githubHeaders() below and attached as `authorization:
// Bearer <token>` when set. While the owner hasn't created that token yet
// (repo still public), every request below runs exactly as before —
// unauthenticated, same as when this file was first written. Once the repo
// goes private, setting the env var in Vercel is the only step needed; no
// URL changes required on that day.
//
// 🔴 Both GitHub endpoints below go through api.github.com, NOT
// raw.githubusercontent.com — raw.githubusercontent.com is a separate CDN
// domain that does not reliably serve private-repo content even with a
// valid token (and Authorization headers sent to a CDN host carry their own
// leak risk via redirects/caching). api.github.com's Contents API is
// GitHub's officially documented way to fetch raw file content for BOTH
// public and private repos — pass `ref=<branch>` and
// `accept: application/vnd.github.raw+json` and the response body is the
// file's raw text, not JSON. This repo used to call raw.githubusercontent.com
// directly for the per-day file content (listing already used the Contents
// API) — migrated here specifically so private-repo support doesn't require
// a second channel change later.
//
// Gated with requireOwnerAdmin() like every other action in this app, even
// though the underlying GitHub content is public — this repo's rule is "the
// gate is the same shape everywhere", not "skip the gate when the backing
// data happens to not be secret" (calendar.ts / content.ts do the exact same
// thing for data that's shop-internal but not technically secret either).

import { getEffectiveRole } from "@/lib/auth/role";
import type { ActionResult } from "@/lib/types";
import { extractDateFromFilename, parseTrendRadarDay, type TrendRadarDay } from "@/lib/marketing/trend-radar-parse";

const GITHUB_OWNER = "markawanma";
const GITHUB_REPO = "oms-3j";
const GITHUB_BRANCH = "trend-radar-feed";
const GITHUB_DIR_PATH = "docs/3j-jewelry/marketing/trend-radar";

/** Wall-clock budget per GitHub request — this runs inside the page's own
 * server-render, so a slow/hung GitHub must not hang the page itself (brief:
 * "ห้ามปล่อยให้หน้าแขวนถ้า GitHub ช้า/ล่ม"). Same order of magnitude as this
 * project's other external-fetch budgets (lib/marketing/tiktok-oembed.ts's
 * 4s single call) but a bit larger since this module makes up to
 * `limit + 1` requests total (one listing + one per file), not one. */
const GITHUB_FETCH_TIMEOUT_MS = 8000;

const MIN_LIMIT = 1;
const MAX_LIMIT = 20;

/** Hard cap on how much of one day's file this module will read into memory
 * — a 256 KiB markdown file is already absurdly large for this feature (real
 * files are a few KB); anything bigger is either a mistake or someone having
 * gained write access to the `trend-radar-feed` branch, not a legitimate
 * daily digest. Shared with lib/marketing/trend-radar-parse.ts's own
 * MAX_LINE_CHARS cap — this one bounds total file size, that one bounds a
 * single line's length (prevents pathological-regex cost per line). */
const MAX_FILE_CHARS = 256 * 1024;

/** Errors this module throws itself inside the per-file Promise.allSettled
 * below — message text is always authored here (never copies a thrown
 * value's own .message), so logging `.message` on this specific type can
 * never leak a header value. A generic `Error` (e.g. undici's own TypeError
 * when a header value is malformed) is NOT this type — see the logging site
 * near the bottom of getTrendRadarFeed() for why that distinction matters. */
class TrendRadarFetchError extends Error {}

/** Maps a non-2xx status into a Thai message that tells the owner what to
 * actually do — written for the exact transition this feature is going
 * through (repo going from public to private, token being introduced),
 * where a bare "HTTP 404" or "HTTP 401" would send them looking in the wrong
 * place. Shared between the listing fetch and could be reused per-file if
 * that error path ever needs the same nuance. */
function githubStatusErrorMessage(status: number): string {
  const hasToken = Boolean(process.env.GITHUB_TRENDRADAR_TOKEN);
  switch (status) {
    case 401:
      return "GitHub ปฏิเสธ token (GITHUB_TRENDRADAR_TOKEN หมดอายุหรือไม่ถูกต้อง) — สร้าง token ใหม่แล้วตั้งค่าใน Vercel";
    case 403:
    case 429:
      return hasToken
        ? `GitHub ปฏิเสธคำขอ (HTTP ${status}) — token อาจไม่มีสิทธิ์ Contents: Read หรือโดนจำกัดจำนวนครั้งเรียก ลองใหม่ภายหลัง`
        : `GitHub จำกัดจำนวนครั้งเรียกแบบไม่ใช้ token (HTTP ${status}) — ตั้ง GITHUB_TRENDRADAR_TOKEN ใน Vercel เพื่อเพิ่มโควตา`;
    case 404:
      return hasToken
        ? "ไม่พบโฟลเดอร์เรดาร์เทรนด์บน GitHub — token อาจไม่ได้ผูกกับ repo oms-3j หรือ branch trend-radar-feed ถูกลบ/ย้าย"
        : "ไม่พบโฟลเดอร์เรดาร์เทรนด์บน GitHub — ถ้า repo เปลี่ยนเป็น private แล้ว ต้องตั้ง GITHUB_TRENDRADAR_TOKEN ใน Vercel (หรือ branch trend-radar-feed ถูกลบ/ย้าย)";
    default:
      return `ดึงรายการไฟล์เรดาร์เทรนด์จาก GitHub ไม่สำเร็จ (HTTP ${status})`;
  }
}

/** Builds the headers for every GitHub API request in this module.
 * `GITHUB_TRENDRADAR_TOKEN` is read fresh on every call (not cached at
 * module scope) so a token set after this module was first imported — e.g.
 * hot-reload in dev, or a serverless cold-start that re-evaluates env vars —
 * is always picked up. Never throws, never logs the token: the only consumer
 * of the return value is `fetch`'s own `headers` option. */
function githubHeaders(accept: string): HeadersInit {
  const h: Record<string, string> = { accept, "x-github-api-version": "2022-11-28" };
  const token = process.env.GITHUB_TRENDRADAR_TOKEN;
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

// Not exported from marketing.ts/calendar.ts (module-private there too) —
// same gate, copied rather than imported so this file has no dependency on
// either (lib/actions/calendar.ts's own header explains why this repo copies
// this one small function per action file instead of sharing it).
async function requireOwnerAdmin(): Promise<ActionResult<never> | null> {
  if ((await getEffectiveRole()) === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ใช้งานส่วนการตลาดได้" };
  }
  return null;
}

/** Minimal shape read out of the GitHub Contents API's listing response —
 * the real response has many more fields (sha, size, url, ...), all ignored
 * here on purpose; this module never forwards raw GitHub JSON to the
 * client, only the parsed TrendRadarDay[] shape it builds itself. */
interface GitHubContentsItem {
  name?: unknown;
  type?: unknown;
}

function isGitHubContentsItem(v: unknown): v is GitHubContentsItem {
  return typeof v === "object" && v !== null;
}

/**
 * Fetches the `limit` most recent trend-radar days from the
 * `trend-radar-feed` GitHub branch (listing first, then each file's raw
 * content), parses each with parseTrendRadarDay(), and returns them newest
 * first.
 *
 * Never throws. A listing failure (network/timeout/non-2xx/malformed JSON)
 * returns `{ ok: false, error }` with a Thai message — nothing partial to
 * show in that case. A single file's content fetch failing is tolerated
 * (that one day is skipped, logged, the rest still render); only returns
 * `{ ok: false }` if EVERY file's content fetch failed.
 */
export async function getTrendRadarFeed(limit = 5): Promise<ActionResult<TrendRadarDay[]>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  const clampedLimit = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.trunc(limit) || 5));

  const listingUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_DIR_PATH}?ref=${GITHUB_BRANCH}`;

  let listingResponse: Response;
  try {
    listingResponse = await fetch(listingUrl, {
      method: "GET",
      cache: "no-store", // brief: ต้องดึงสดทุกครั้งที่เปิดหน้า ห้ามให้ Next.js data cache จำคำตอบเก่าไว้
      signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
      headers: githubHeaders("application/vnd.github+json"),
    });
  } catch (err) {
    console.error("getTrendRadarFeed: listing fetch failed", {
      host: "api.github.com",
      errorName: err instanceof Error ? err.name : "unknown",
    });
    return { ok: false, error: "ดึงรายการไฟล์เรดาร์เทรนด์จาก GitHub ไม่สำเร็จ (เครือข่ายขัดข้องหรือหมดเวลา) ลองใหม่อีกครั้ง" };
  }

  if (!listingResponse.ok) {
    console.error("getTrendRadarFeed: listing non-2xx", { host: "api.github.com", status: listingResponse.status });
    return { ok: false, error: githubStatusErrorMessage(listingResponse.status) };
  }

  let listingJson: unknown;
  try {
    listingJson = await listingResponse.json();
  } catch {
    console.error("getTrendRadarFeed: listing body was not valid JSON", { host: "api.github.com" });
    return { ok: false, error: "อ่านรายการไฟล์เรดาร์เทรนด์จาก GitHub ไม่สำเร็จ" };
  }

  if (!Array.isArray(listingJson)) {
    console.error("getTrendRadarFeed: listing JSON was not an array", { host: "api.github.com" });
    return { ok: false, error: "อ่านรายการไฟล์เรดาร์เทรนด์จาก GitHub ไม่สำเร็จ" };
  }

  const fileNames = listingJson
    .filter(isGitHubContentsItem)
    .filter((item) => item.type === "file" && typeof item.name === "string" && extractDateFromFilename(item.name) !== null)
    .map((item) => item.name as string)
    // "YYYY-MM-DD.md" sorts lexically exactly the same as chronologically —
    // descending string compare is enough, no Date parsing needed.
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, clampedLimit);

  if (fileNames.length === 0) {
    return { ok: true, data: [] };
  }

  const settled = await Promise.allSettled(
    fileNames.map(async (name) => {
      const contentUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_DIR_PATH}/${name}?ref=${GITHUB_BRANCH}`;
      const response = await fetch(contentUrl, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
        // "raw+json" (not the listing's "vnd.github+json") makes the
        // Contents API respond with the file's raw bytes as the body
        // instead of a JSON envelope with base64 content — same endpoint
        // shape as the listing request above, different `accept` only.
        headers: githubHeaders("application/vnd.github.raw+json"),
      });
      if (!response.ok) throw new TrendRadarFetchError(`HTTP ${response.status}`);

      // Size guard BEFORE reading the body — `content-length` is untrusted
      // (a misbehaving/compromised server could omit or lie about it) so
      // this is a fast-path short-circuit only; the authoritative check is
      // on `text.length` below regardless of what this says. Cancelling the
      // body on reject avoids buffering a file we already know we'll throw
      // away.
      const contentLengthHeader = response.headers.get("content-length");
      if (contentLengthHeader !== null) {
        const contentLength = Number(contentLengthHeader);
        if (Number.isFinite(contentLength) && contentLength > MAX_FILE_CHARS) {
          await response.body?.cancel().catch(() => undefined);
          throw new TrendRadarFetchError(`file too large (content-length ${contentLength} bytes)`);
        }
      }

      const text = await response.text();
      if (text.length > MAX_FILE_CHARS) {
        throw new TrendRadarFetchError(`file too large (${text.length} chars, content-length header absent or understated)`);
      }

      const date = extractDateFromFilename(name);
      // Unreachable in practice — `fileNames` was already filtered above —
      // but typed as nullable so this still can't silently pass `null`
      // through to parseTrendRadarDay if that filter is ever loosened later.
      if (!date) throw new TrendRadarFetchError("filename no longer matches YYYY-MM-DD.md");
      return parseTrendRadarDay(date, text);
    })
  );

  const days: TrendRadarDay[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      days.push(result.value);
    } else {
      // Only TrendRadarFetchError's .message is ours to log — its text is
      // always authored in this file. Any other thrown value (e.g. a
      // fetch/undici-internal TypeError, which can embed a raw header value
      // in .message when that header fails validation) is logged by .name
      // only, never .message, so a malformed Authorization header value can
      // never end up in this log line.
      console.error("getTrendRadarFeed: one file's content fetch failed, skipping that day", {
        host: "api.github.com",
        reason:
          result.reason instanceof TrendRadarFetchError
            ? result.reason.message
            : result.reason instanceof Error
              ? result.reason.name
              : "unknown",
      });
    }
  }

  if (days.length === 0) {
    return { ok: false, error: "ดึงเนื้อหาเรดาร์เทรนด์จาก GitHub ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }

  // Promise.allSettled preserves input order already (fileNames was sorted
  // descending), but re-sorting explicitly here means a future change to
  // the fetch order above can't silently reverse the displayed order too.
  days.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return { ok: true, data: days };
}
