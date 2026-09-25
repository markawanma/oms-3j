// lib/marketing/content-types.ts — TS mirror of the content measurement
// schema (supabase/migrations/0145_content_taxonomy.sql,
// 0148_content_post.sql, 0149_content_metric_views.sql — all applied to
// prod, docs/3j-jewelry/analytics/ux-content-measurement.md is the design
// this implements). Pattern: same shape discipline as campaign-types.ts
// (Thai label maps, enums mirroring DB CHECK constraints exactly).

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
