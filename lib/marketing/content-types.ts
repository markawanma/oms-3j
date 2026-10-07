// lib/marketing/content-types.ts — TS mirror of the content measurement
// schema (supabase/migrations/0145_content_taxonomy.sql,
// 0148_content_post.sql, 0149_content_metric_views.sql — all applied to
// prod, docs/3j-jewelry/analytics/ux-content-measurement.md is the design
// this implements). Pattern: same shape discipline as campaign-types.ts
// (Thai label maps, enums mirroring DB CHECK constraints exactly).

import { truncateUtf16Safe } from "./text-safe-truncate";
import type { ContentKpiState } from "./content-kpi";

/** Mirrors content_post.platform / content_post_metric CHECK constraints
 * (0148 §1). Keep in sync if a platform is ever added there. */
export type ContentPlatform = "tiktok" | "facebook" | "instagram" | "line_oa";

export const PLATFORMS: ContentPlatform[] = ["tiktok", "facebook", "instagram", "line_oa"];

export const PLATFORM_LABEL: Record<ContentPlatform, string> = {
  tiktok: "TikTok",
  facebook: "Facebook",
  instagram: "Instagram",
  line_oa: "LINE OA",
};

/** Mirrors content_post.status CHECK (0148 §1). */
export type ContentPostStatus = "active" | "deleted" | "private";

export const CONTENT_POST_STATUS_LABEL: Record<ContentPostStatus, string> = {
  active: "ใช้งานอยู่",
  deleted: "ลบแล้ว",
  private: "ตั้งเป็นส่วนตัว",
};

/** analytics.content_type reference row (0145 §1) — 5 seeded rows, more
 * added by INSERT only (never re-palette per the migration's own comment). */
export interface ContentTypeRow {
  code: string;
  labelTh: string;
  colorHex: string;
  sortOrder: number;
}

/** analytics.v_content_entry_queue row (0149 §2) + caption_snapshot enriched
 * separately from analytics.content_post (the view's own select list omits
 * it — see lib/actions/content.ts's getContentEntryQueue for why). */
export interface ContentEntryQueueRow {
  postId: string;
  shopId: string;
  platform: ContentPlatform;
  externalId: string;
  postUrl: string;
  postedAt: string;
  postedDateTh: string;
  contentTypeCode: string | null;
  ageDaysToday: number;
  /** 1 = T+1 window (age 1-2), 2 = T+3 window (age 3-4), 3 = T+7 window
   * (age 5-9) — matches r.read_round in 0149's cross join lateral. */
  readRound: 1 | 2 | 3;
  /** Enriched from content_post.caption_snapshot, not part of the view —
   * null both when never captured and when genuinely empty. */
  captionSnapshot: string | null;
}

export const READ_ROUND_LABEL: Record<1 | 2 | 3, string> = {
  1: "T+1 · อายุ 1-2 วัน",
  2: "T+3 · อายุ 3-4 วัน",
  3: "T+7 · อายุ 5-9 วัน",
};

// ---- /marketing/content/history (ดูย้อนหลัง) ---------------------------

/** analytics.content_post_metric's latest row for one post (max captured_on
 * — not specifically the T+7 snapshot v_content_post_t7 uses; "latest" here
 * means whichever read round was entered most recently, any round). Every
 * count field is independently nullable, same "null ≠ 0" rule as the DB
 * column itself (0148's own comment) — a field being null here means that
 * specific number was never entered on the latest row, not zero. */
export interface ContentPostHistoryMetric {
  capturedOn: string;
  view: number | null;
  like: number | null;
  comment: number | null;
  save: number | null;
  share: number | null;
}

/** One row of /marketing/content/history's read-only table — every saved
 * analytics.content_post (status='active'), newest posted_at first, plus
 * whatever content_post_metric row is most recent for it, if any exists at
 * all. `latestMetric: null` means the post has never had a single metric
 * entered (getContentPostHistory in lib/actions/content.ts). */
export interface ContentPostHistoryRow {
  postId: string;
  platform: ContentPlatform;
  postUrl: string;
  postedAt: string;
  postedDateTh: string;
  contentTypeCode: string | null;
  captionSnapshot: string | null;
  latestMetric: ContentPostHistoryMetric | null;
}

// ---- /marketing/content/history/[postId] (ดู KPI ของคลิป + suggestion) --

/** Header/display fields for one post's KPI detail page — present
 * regardless of which lib/marketing/content-kpi.ts ContentKpiState the post
 * is currently in. Sourced from analytics.content_post directly (NOT
 * v_content_post_t7 — that view doesn't select caption_snapshot at all, see
 * 0149's column list), while every NUMBER on the page comes from
 * v_content_post_t7 only (screen design §3.2: never "latest", always T+7). */
export interface ContentPostKpiHeader {
  postId: string;
  platform: ContentPlatform;
  postUrl: string;
  postedAt: string;
  postedDateTh: string;
  contentTypeCode: string | null;
  captionSnapshot: string | null;
}

/** getContentPostKpiDetail's success payload — `null` means "not found"
 * (postId doesn't exist, isn't active, or wasn't even a valid UUID), same
 * "ok:true, data:null, page checks !data" convention as
 * lib/actions/calendar.ts's getCalendarTask. */
export interface ContentPostKpiDetail {
  header: ContentPostKpiHeader;
  state: ContentKpiState;
}

/** One row of analytics.content_post — used for the "already linked" state
 * of ContentPostLinkForm when rendered against a specific artifact. */
export interface ContentPostSummary {
  id: string;
  platform: ContentPlatform;
  externalId: string;
  postUrl: string;
  postedAt: string;
  contentTypeCode: string | null;
  status: ContentPostStatus;
}

// ---- Metric entry form ------------------------------------------------

/** Single source for field order (design doc §1.3/§6 item 4 + §7 Q1: owner
 * hasn't confirmed this matches TikTok Studio's on-screen order yet —
 * Tech Lead brief 25 ก.ย. 69 says ship this default, keep it a one-line
 * change). Every consumer (form inputs, review screen, DB param mapping)
 * iterates this array so re-ordering here reorders everything at once. */
export const METRIC_FIELD_ORDER = ["view", "like", "comment", "save", "share"] as const;
export type MetricField = (typeof METRIC_FIELD_ORDER)[number];

export const METRIC_FIELD_LABEL: Record<MetricField, string> = {
  view: "ยอดวิว",
  like: "ถูกใจ",
  comment: "คอมเมนต์",
  save: "บันทึก",
  share: "แชร์",
};

/** design §1.3: "บันทึก" is the headline signal per the KPI doc, but must
 * NOT get a louder visual treatment (color/size) than the other fields —
 * only this caption line distinguishes it. */
export const METRIC_FIELD_HINT: Partial<Record<MetricField, string>> = {
  save: "ตัวชี้วัดหลัก — คนกดบันทึกมากกว่าแชร์ 3.5 เท่า",
};

/** Raw text the owner typed per field, kept as strings (not numbers) so an
 * in-progress "12" isn't silently coerced and so an empty field stays
 * empty instead of becoming 0 — see the project's most expensive repeated
 * bug (docs brief: "ตัวเลขที่ยังไม่ได้กรอก = ว่าง ไม่ใช่ 0"). */
export type MetricDraft = Partial<Record<MetricField, string>>;

/** Parses one field's typed text into a value content_post_metric_upsert
 * accepts: empty string -> undefined (field untouched, RPC's own
 * null-preserving default), otherwise a non-negative integer or null if
 * unparseable (caller should treat null as "invalid, block submit"). */
export function parseMetricFieldValue(raw: string | undefined): number | null | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : null;
}

/** step_artifact.artifact_type values that can carry a real public post link
 * (design doc §2.1(a)) — mirrors the design's explicit list, NOT the full
 * artifact_type enum (broadcast_script_line / dm_script_1to1 / parcel_card
 * have no public URL to attach). Single source so calendar/[stepId]/page.tsx
 * and any future caller agree. */
export const POSTABLE_ARTIFACT_TYPES = ["short_form_clip", "live_highlight_clip", "fb_post"] as const;

export function isPostableArtifactType(artifactType: string): boolean {
  return (POSTABLE_ARTIFACT_TYPES as readonly string[]).includes(artifactType);
}

/** Derives content_post_upsert's p_external_id from a pasted URL — strips
 * query string + hash so share-link tracking params (?_r=..., ?utm_...)
 * that differ every time the owner copies the same link don't create
 * duplicate content_post rows for the same clip (design doc §7 Q4: decided
 * "normalize" as the middle path). The full, unmodified URL is still what
 * gets stored/displayed as post_url — only the dedup key is normalized.
 * Falls back to the raw trimmed string if the URL doesn't parse; content_
 * post_upsert's own http(s):// check is the real gate on bad input, not
 * this helper. */
export function deriveExternalId(url: string): string {
  const trimmed = url.trim();
  try {
    const u = new URL(trimmed);
    u.search = "";
    u.hash = "";
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.origin}${path}`;
  } catch {
    return trimmed;
  }
}

// ---- content_post_upsert RPC param builder ----------------------------

/** Exact shape of analytics.content_post_upsert's (0148 §3) positional
 * params — kept here (not inline in lib/actions/content.ts) as a pure,
 * directly unit-testable function that doesn't need any Supabase client to
 * exercise (see content-types.test.ts's "buildContentPostUpsertParams"
 * suite). That suite only proves this function is internally consistent
 * (it echoes back the `canonicalPostUrl` it's given) — it does NOT prove
 * the call site (lib/actions/content.ts's upsertContentPost) actually
 * passes the canonicalized URL here instead of the raw pasted one. QA's
 * mutation test (26 ก.ย. 69, security รอบ 2) swapped the call site's
 * argument back to raw `postUrl` and got 554/0 unchanged, because no test
 * file imported lib/actions/content.ts at all — "use server" modules ARE
 * directly unit-testable with a mocked Supabase client (see
 * lib/actions/oem.test.ts / members.test.ts / production.test.ts /
 * hero-stock.test.ts, all four do exactly this); nobody had written that
 * test yet. lib/actions/content.test.ts (27 ก.ย. 69, security รอบ 3) closes
 * that gap by asserting on the RPC params the real call site produces. */
export interface ContentPostUpsertRpcParams {
  p_shop_id: string;
  p_platform: ContentPlatform;
  p_external_id: string;
  p_post_url: string;
  p_posted_at: string;
  p_content_type_code: string | null;
  p_artifact_id: string | null;
  p_caption: string | null;
}

/** 🔴 L-1 fix (security รอบ 4, 27 ก.ย. 69): defensive server-side cap —
 * `content_post.caption_snapshot` (0148) is plain `text`, NO length CHECK
 * at the DB layer, and `caption` on UpsertContentPostInput is typed
 * `string | null` but nothing at THIS layer enforced either the type or a
 * length ceiling before this fix — a caller that isn't
 * ContentPostLinkForm's oEmbed-fed path (a future integration, a bug
 * upstream, anything) could hand this an arbitrarily large or
 * non-string-shaped value and it would flow straight into the RPC call.
 * 500 matches lib/marketing/tiktok-oembed.ts's own CAPTION_MAX_LEN — one
 * number, same reasoning (mirrors this project's existing post_url/
 * external_id caps), enforced at BOTH the point captions are produced
 * (oEmbed) and the point they're written (here), independently. */
const CAPTION_MAX_LEN = 500;

/** Pure — decides exactly what goes into content_post_upsert's params, given
 * the ALREADY-canonicalized URL (never the raw pasted string — the caller,
 * upsertContentPost, must run canonicalizeTikTokLink() first and pass its
 * `.url` here). Both p_post_url and the external_id derived from it use
 * `canonicalPostUrl`, never `rawPostUrl` — that equality is the exact thing
 * under test. */
export function buildContentPostUpsertParams(
  shopId: string,
  canonicalPostUrl: string,
  input: {
    platform: ContentPlatform;
    postedAt: string;
    contentTypeCode?: string | null;
    artifactId?: string | null;
    caption?: string | null;
  }
): ContentPostUpsertRpcParams {
  return {
    p_shop_id: shopId,
    p_platform: input.platform,
    p_external_id: deriveExternalId(canonicalPostUrl),
    p_post_url: canonicalPostUrl,
    p_posted_at: input.postedAt,
    p_content_type_code: input.contentTypeCode || null,
    p_artifact_id: input.artifactId || null,
    // L-1: `typeof` guard first — a non-string value (bad upstream caller,
    // not something the current TS types should let happen but this is the
    // actual runtime boundary) becomes null instead of crashing on
    // `.trim()`; truncateUtf16Safe is the same surrogate-pair-safe cut
    // tiktok-oembed.ts uses (M-3), so this layer can't reintroduce that bug
    // even if a future caller's input skipped that module entirely.
    p_caption: typeof input.caption === "string" ? truncateUtf16Safe(input.caption.trim(), CAPTION_MAX_LEN) || null : null,
  };
}

/** ขอบล่างของ posted_at ที่ยอมรับ = 2025-01-01 00:00 เวลาไทย — ตรงกับด่านใน DB
 * (0160: content_piece_post · content_post_link_step · trigger content_post_guard_link) */
export const POSTED_AT_MIN_MS = Date.parse("2025-01-01T00:00:00+07:00");
/** เพดานอนาคต = now() + 1 วัน (เผื่อนาฬิกาเครื่องเหลื่อม) — เท่ากับด่านใน DB */
export const POSTED_AT_MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

export type PostedAtCheck = { ok: true; iso: string } | { ok: false };

/** Pure — ตรวจ posted_at ก่อนส่งเข้า content_post_upsert (QA I1/I2, 7 ต.ค. 69).
 * คิวเดิมของ DB (0148) ไม่ตรวจขอบเขต ⇒ '-infinity' / ปี 1990 เข้า content_post ได้ แล้ว view ที่
 * คำนวณ age_days ตก 22008 ทั้งร้าน. คืน ISO (UTC) ที่ parse แล้ว เพื่อให้ค่าที่ตรวจ = ค่าที่เขียนจริง
 * (ไม่ปล่อยสตริงดิบให้ Postgres ตีความต่างจาก JS เช่น "10/07/2026" หรือสตริงไม่มี timezone) */
export function checkPostedAt(raw: unknown, nowMs: number = Date.now()): PostedAtCheck {
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false };
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return { ok: false };
  if (ms < POSTED_AT_MIN_MS || ms > nowMs + POSTED_AT_MAX_FUTURE_MS) return { ok: false };
  return { ok: true, iso: new Date(ms).toISOString() };
}
