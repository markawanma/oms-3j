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
// No auth token used — markawanma/oms-3j is a public repo, confirmed
// reachable unauthenticated (both endpoints below tested working without a
// token before this was written). 🔴 If the repo is ever made private (an
// explicit decision only the owner makes — see memory note on GitHub repo
// visibility), every fetch in this file starts returning 404 and this
// feature goes dark; fixing that means adding a GITHUB_TOKEN env var and an
// `authorization: Bearer` header to both requests below, not changing the
// URLs themselves.
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
      headers: { accept: "application/vnd.github+json" },
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
    return {
      ok: false,
      error:
        listingResponse.status === 404
          ? "ไม่พบโฟลเดอร์เรดาร์เทรนด์บน GitHub (branch trend-radar-feed อาจถูกลบหรือย้าย)"
          : `ดึงรายการไฟล์เรดาร์เทรนด์จาก GitHub ไม่สำเร็จ (HTTP ${listingResponse.status})`,
    };
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
      const rawUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${GITHUB_DIR_PATH}/${name}`;
      const response = await fetch(rawUrl, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      const date = extractDateFromFilename(name);
      // Unreachable in practice — `fileNames` was already filtered above —
      // but typed as nullable so this still can't silently pass `null`
      // through to parseTrendRadarDay if that filter is ever loosened later.
      if (!date) throw new Error("filename no longer matches YYYY-MM-DD.md");
      return parseTrendRadarDay(date, text);
    })
  );

  const days: TrendRadarDay[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      days.push(result.value);
    } else {
      console.error("getTrendRadarFeed: one file's content fetch failed, skipping that day", {
        host: "raw.githubusercontent.com",
        reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
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
