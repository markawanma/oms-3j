// lib/marketing/content-kpi.ts — pure decision logic for
// /marketing/content/history/[postId] (docs/3j-jewelry/analytics/
// content-kpi-screen-design.md §4/§5/§6, backed by the KPI rule table at
// docs/3j-jewelry/analytics/content-kpi-definition.md §5).
//
// 🔴 PURE MODULE — no Supabase client, no "use server", no I/O of any kind.
// Every function here takes already-fetched numbers and returns a decision;
// lib/actions/content.ts's getContentPostKpiDetail() does 100% of the
// fetching and hands the results in. This split exists specifically so the
// "which suggestion fires" logic — the one thing on this screen that
// actually *decides* something instead of just displaying a number — has
// real, mutation-proof unit test coverage (screen design §9.1's own
// component table calls this out: "ชิ้นใหม่ที่ต้อง unit test ครบ เป็น
// business logic เดียวที่ 'ตัดสิน' อะไรในฟีเจอร์นี้").
//
// 🔴 HIGH_SIGNAL_MARGIN lives HERE and only here (screen design §4.1, owner
// confirmed 28 ก.ย. 69: 1.2× median, not median alone) — every "สูง/ต่ำ"
// classification in this file goes through classifyMetricLevel() below so
// there is exactly one place this number can be wrong.

import { daysBetween as daysBetweenOrNull } from "./format";

// ============================================================================
// Constants
// ============================================================================

/** Screen design §4.1 — owner-confirmed 28 ก.ย. 69. A value must be at
 * least this many times the comparison median to count as "สูง" (high) —
 * plain median alone was rejected as too noisy given how few clips exist
 * per format right now. */
export const HIGH_SIGNAL_MARGIN = 1.2;

/** §4 state table row 4 — "จำนวนคลิปทั้งช่องที่มี T+7 ครบ < 10" gates
 * whether ANY comparison is attempted at all. Also the size of the
 * "10 คลิปล่าสุดทั้งช่อง" comparison set §4.1's median is computed from. */
export const MIN_GLOBAL_CLIPS = 10;

/** §4 state table row 5 — "จำนวนคลิปของ format นี้ที่มี T+7 ครบ < 4" gates
 * whether the format-level (row 7/8) block renders at all. Same number as
 * content-kpi-definition.md §0's "format ใหม่ต้องลงครบ 4 ชิ้นก่อนตัดสินว่า
 * ใช้ได้หรือไม่". */
export const MIN_FORMAT_CLIPS = 4;

/** §11 decision #4 (Tech Lead, closed) — "median เดือน" (definition doc §5
 * row 7) means a rolling 28-day window, matching the "28 วันล่าสุด"
 * convention content-kpi-definition.md §3.1 already uses elsewhere, NOT a
 * calendar month (which would make day 1-2 of every month have an
 * abnormally thin sample). */
export const ROLLING_BASELINE_DAYS = 28;

// v_content_post_t7's t7_unavailable_reason (supabase/migrations/
// 0149_content_metric_views.sql) is literal Thai text, not an enum code —
// these three constants are the ONE place that text is duplicated into TS.
// Keep in sync if 0149's CASE branches ever change wording.
export const T7_REASON_WAITING = "ยังไม่ถึง 7 วัน";
export const T7_REASON_PENDING_ENTRY = "อยู่ในช่วง T+7 ยังเก็บทัน แต่ยังไม่ได้กรอก";
export const T7_REASON_MISSED = "ไม่มีข้อมูลช่วง T+7";

// ============================================================================
// Suggestion text — sourced from docs/3j-jewelry/analytics/
// content-kpi-definition.md §5 (the brief's own instruction: "ข้อความต้อง
// ตรงกับนี้"). Two deliberate departures from verbatim quoting, both
// documented at point of use below:
//   - Row 1's "ถ้าอยากเก็บ ย้ายไปกอง brand แล้วติด goal_kpi_code =
//     brand_no_sales" clause is dropped — it names an internal DB tagging
//     action this screen has no control for (no such button exists here),
//     so surfacing it verbatim would read as a broken instruction. The
//     actionable core clause is kept word-for-word.
//   - Row 7's "positive" case (format doing BETTER than baseline) has no
//     text in §5 at all — that table only defines the negative case
//     ("อัตราบันทึกต่ำกว่า median เดือน" → "ตัดออกจากปฏิทิน"). The positive
//     text below is composed from the screen design's own §4.7 wireframe
//     text instead (still a document-approved source, just a different
//     one), since there's nothing in §5 to quote for that direction.
// ============================================================================

const SINGLE_CLIP_STOP_TEXT = "เลิก format นี้ ห้ามเพิ่มความถี่เพราะวิวสวย";
const SINGLE_CLIP_REPEAT_TEXT = "ทำซ้ำสัปดาห์ละ 2–3 ชิ้น เปลี่ยนแค่ของที่โชว์ อย่ารอให้วิวสวยก่อน";
const FORMAT_NEGATIVE_TEXT = "ไม่ทำงาน ไม่ต้องรอไตรมาส — ตัดออกจากปฏิทิน";
const FORMAT_POSITIVE_TEXT = "อัตราบันทึกเฉลี่ยของประเภทนี้ สูงกว่า median เดือน";

// ============================================================================
// Types
// ============================================================================

export type MetricLevel = "high" | "low";

/** T+7 snapshot numbers for one clip — null-safe mirror of
 * v_content_post_t7's t7_* columns (0149: every field independently
 * nullable, "null ≠ 0" per that view's own comment). Only ever present when
 * t7_unavailable_reason is null (a real snapshot exists). */
export interface ClipT7Metrics {
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  saveCount: number | null;
  shareCount: number | null;
  saveRate: number | null;
  shareRate: number | null;
  capturedOn: string | null;
}

export interface SingleClipSuggestion {
  kind: "stop" | "repeat";
  text: string;
}

export type FormatSuggestionKind = "positive" | "negative";

export interface FormatSuggestion {
  kind: FormatSuggestionKind;
  text: string;
}

export type ConfidenceBadge = "insufficient" | "signal" | "confirmed_positive" | "confirmed_negative";

export type ContentKpiState =
  | { kind: "waiting_t7"; ageDaysToday: number; expectedReadyDateTh: string }
  | { kind: "pending_entry"; ageDaysToday: number }
  | { kind: "missed_window" }
  | { kind: "insufficient_global"; clip: ClipT7Metrics; globalCount: number }
  | {
      kind: "format_unconfirmed";
      clip: ClipT7Metrics;
      /** §4.8: shown even when no suggestion fires (both quadrants moving
       * the same direction) — the UI still prints "วิว: ต่ำกว่าค่ากลาง" etc.
       * null only when there wasn't enough data to classify at all (e.g.
       * the comparison set's median itself is null). */
      viewLevel: MetricLevel | null;
      saveLevel: MetricLevel | null;
      singleClipSuggestion: SingleClipSuggestion | null;
      formatCount: number;
    }
  | {
      kind: "full";
      clip: ClipT7Metrics;
      viewLevel: MetricLevel | null;
      saveLevel: MetricLevel | null;
      singleClipSuggestion: SingleClipSuggestion | null;
      formatSuggestion: FormatSuggestion | null;
      formatCount: number;
      confidenceBadge: ConfidenceBadge;
    };

export interface DetermineKpiStateInput {
  /** v_content_post_t7.t7_unavailable_reason for this post — null means a
   * real snapshot exists. */
  t7UnavailableReason: string | null;
  /** content_post.posted_date_th, "YYYY-MM-DD". */
  postedDateTh: string;
  /** "Today" in Thailand's calendar, "YYYY-MM-DD" — caller computes this
   * (e.g. via lib/tiktok/format.ts's effectiveDateBangkok) so this function
   * stays pure/deterministic and testable without mocking Date. */
  todayDateTh: string;
  /** Required when t7UnavailableReason is null, ignored otherwise. */
  clip: ClipT7Metrics | null;
  /** Exact count (not capped by the comparison set's own limit) of active,
   * valid-T7 posts channel-wide — §4 state table row 4's gate. */
  globalCount: number;
  /** Median t7_view_count across the 10 most-recently-posted active,
   * valid-T7 clips channel-wide (§4.1) — null when that set is empty. */
  comparisonViewMedian: number | null;
  /** Median save_rate across the same 10-clip set — null when every clip in
   * it has a null save_rate. */
  comparisonSaveMedian: number | null;
  /** Count of active, valid-T7 posts sharing this post's content_type_code
   * (all-time, no rolling window — §4 state table row 5 names no window). */
  formatCount: number;
  /** Mean save_rate across this format's own valid-T7 clips. */
  formatMeanSaveRate: number | null;
  /** Median save_rate across ALL active, valid-T7 clips (any format)
   * posted within the last ROLLING_BASELINE_DAYS days — the "median เดือน"
   * row 7 compares the format against. */
  baselineMedianSaveRate: number | null;
}

// ============================================================================
// Pure math helpers
// ============================================================================

export function computeMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function computeMean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Parses a plain "YYYY-MM-DD" date string as UTC midnight for day-diff
 * arithmetic only — same trick lib/tiktok/format.ts's formatThaiDateOnly
 * uses, so a date that's already a Thai calendar date (no time-of-day
 * component to begin with) never gets reinterpreted through a different
 * timezone during the diff. */
function parseDateOnly(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}

/** `dateStr` + `days` (negative allowed) -> "YYYY-MM-DD". */
export function addDaysToDateStr(dateStr: string, days: number): string {
  const d = parseDateOnly(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ============================================================================
// Classification
// ============================================================================

/** value >= median * HIGH_SIGNAL_MARGIN -> "high", otherwise "low" —
 * inclusive at exactly the margin (screen design §4.1: "ค่าพอดี 1.2 เท่าเป๊ะ
 * = 'สูง'"). Note the documented edge case: if `median` is 0, the threshold
 * is also 0, so ANY non-negative value (view/save counts can never be
 * negative) classifies as "high" — a real mathematical consequence of "≥
 * 1.2× a zero baseline", not a bug, but worth knowing before reading a
 * "สูง" badge as meaningful when the comparison set itself had zero
 * engagement. */
export function classifyMetricLevel(value: number, median: number): MetricLevel {
  return value >= median * HIGH_SIGNAL_MARGIN ? "high" : "low";
}

// ============================================================================
// Suggestion pickers
// ============================================================================

/** Rows 1/2 of content-kpi-definition.md §5 — the single-clip signal.
 *
 * 🔴 Deliberate scope decision: only save_rate is used as the second axis,
 * NOT share_rate, even though screen design §4.1 defines a share_rate
 * formula too ("บันทึก/แชร์สูง = save_rate (หรือ share_rate) ... ≥ 1.2×
 * median"). Reasons, flagged back to Tech Lead rather than silently
 * resolved: (a) every wireframe that actually renders a suggestion (§4.6/
 * §4.7) shows only "อัตราบันทึก", never share, (b) share_count is the LAST
 * optional field in the entry form and is frequently left blank (null),
 * which would need its own OR/AND-with-null semantics §4.1's prose doesn't
 * spell out, (c) "บันทึก = สัญญาณที่ดีที่สุดที่เรามี" per
 * content-kpi-definition.md §4 — save_rate alone is the metric the KPI doc
 * itself treats as authoritative. If share_rate should factor in after all,
 * that's a one-function change, isolated here.
 *
 * Only the two "contradictory" quadrants get a suggestion (screen design
 * §4.8: "ห้ามฝืนแต่งคำแนะนำให้ครบทุก quadrant" — view/save moving the SAME
 * direction gets no suggestion at all, just numbers). */
export function pickSingleClipSuggestion(input: {
  viewLevel: MetricLevel | null;
  saveLevel: MetricLevel | null;
}): SingleClipSuggestion | null {
  if (input.viewLevel === "high" && input.saveLevel === "low") {
    return { kind: "stop", text: SINGLE_CLIP_STOP_TEXT };
  }
  if (input.viewLevel === "low" && input.saveLevel === "high") {
    return { kind: "repeat", text: SINGLE_CLIP_REPEAT_TEXT };
  }
  return null;
}

/** Row 7 of content-kpi-definition.md §5 — the format-level signal. Row 8
 * ("ติด top-3 2 สัปดาห์ติด") is deliberately NOT implemented in this pass —
 * see the end-of-task report for why (design doc's own §6 table and its
 * "หลักที่ใช้ตัดสินระดับ" formula assign row 8 to two DIFFERENT confidence
 * badges, a real contradiction that needs Padmé/Tech Lead to resolve, not a
 * guess baked into shipped logic; real data also can't reach any
 * format-level state for weeks yet, so this has zero near-term user
 * impact).
 *
 * formatCount < MIN_FORMAT_CLIPS is re-checked here (not just by the
 * caller) so this function's own contract is correct standalone — matches
 * how classifyMetricLevel/pickSingleClipSuggestion need no external gate to
 * be individually testable. */
export function pickFormatSuggestion(input: {
  formatCount: number;
  formatMeanSaveRate: number | null;
  baselineMedianSaveRate: number | null;
}): FormatSuggestion | null {
  if (input.formatCount < MIN_FORMAT_CLIPS) return null;
  if (input.formatMeanSaveRate === null || input.baselineMedianSaveRate === null) return null;

  const level = classifyMetricLevel(input.formatMeanSaveRate, input.baselineMedianSaveRate);
  if (level === "low") {
    return { kind: "negative", text: FORMAT_NEGATIVE_TEXT };
  }
  return { kind: "positive", text: FORMAT_POSITIVE_TEXT };
}

/** Screen design §6's "หลักที่ใช้ตัดสินระดับ" formula (the authoritative
 * one — see pickFormatSuggestion's comment on row 8 for the contradiction
 * this sidesteps by leaving row 8 out entirely). Format-level (row 7)
 * outranks single-clip (row 1/2): "ยืนยันซ้ำจากหลายคลิป" is explicitly
 * higher confidence than "ยืนยัน 1 รอบ" per §6's own (ก)/(ข) columns, so
 * when both fire at once the format-level badge wins. */
export function computeConfidenceBadge(
  hasSingleClipSuggestion: boolean,
  formatSuggestionKind: FormatSuggestionKind | null
): ConfidenceBadge {
  if (formatSuggestionKind === "positive") return "confirmed_positive";
  if (formatSuggestionKind === "negative") return "confirmed_negative";
  if (hasSingleClipSuggestion) return "signal";
  return "insufficient";
}

// ============================================================================
// State determination — §4's 6-row table, checked top to bottom, stop at
// the first match (design doc is explicit: "ลำดับการเช็ค ... หยุดที่ขั้น
// แรกที่ตรง").
// ============================================================================

export function determineContentKpiState(input: DetermineKpiStateInput): ContentKpiState {
  if (input.t7UnavailableReason === T7_REASON_WAITING) {
    return {
      kind: "waiting_t7",
      ageDaysToday: daysBetweenOrNull(input.postedDateTh, input.todayDateTh) ?? 0,
      expectedReadyDateTh: addDaysToDateStr(input.postedDateTh, 7),
    };
  }

  if (input.t7UnavailableReason === T7_REASON_PENDING_ENTRY) {
    return { kind: "pending_entry", ageDaysToday: daysBetweenOrNull(input.postedDateTh, input.todayDateTh) ?? 0 };
  }

  if (input.t7UnavailableReason !== null) {
    // T7_REASON_MISSED, or any string this module doesn't recognize (0149's
    // CASE wording changed without this file being updated to match) — fail
    // toward the same honest, non-claiming state either way. Never let an
    // unrecognized reason fall through to the "has a real snapshot" branch
    // below, which would read input.clip fields that may not be trustworthy.
    return { kind: "missed_window" };
  }

  // t7UnavailableReason === null ⇒ v_content_post_t7's own contract (0149)
  // guarantees a real snapshot row exists ⇒ input.clip should be present.
  // Defensive fallback only, not an expected path — a caller assembling
  // mismatched input (test bug, future refactor) must not crash the page.
  if (!input.clip) {
    return { kind: "missed_window" };
  }
  const clip = input.clip;

  if (input.globalCount < MIN_GLOBAL_CLIPS) {
    return { kind: "insufficient_global", clip, globalCount: input.globalCount };
  }

  const viewLevel =
    clip.viewCount !== null && input.comparisonViewMedian !== null
      ? classifyMetricLevel(clip.viewCount, input.comparisonViewMedian)
      : null;
  const saveLevel =
    clip.saveRate !== null && input.comparisonSaveMedian !== null
      ? classifyMetricLevel(clip.saveRate, input.comparisonSaveMedian)
      : null;
  const singleClipSuggestion = pickSingleClipSuggestion({ viewLevel, saveLevel });

  if (input.formatCount < MIN_FORMAT_CLIPS) {
    return { kind: "format_unconfirmed", clip, viewLevel, saveLevel, singleClipSuggestion, formatCount: input.formatCount };
  }

  const formatSuggestion = pickFormatSuggestion({
    formatCount: input.formatCount,
    formatMeanSaveRate: input.formatMeanSaveRate,
    baselineMedianSaveRate: input.baselineMedianSaveRate,
  });
  const confidenceBadge = computeConfidenceBadge(singleClipSuggestion !== null, formatSuggestion?.kind ?? null);

  return {
    kind: "full",
    clip,
    viewLevel,
    saveLevel,
    singleClipSuggestion,
    formatSuggestion,
    formatCount: input.formatCount,
    confidenceBadge,
  };
}
