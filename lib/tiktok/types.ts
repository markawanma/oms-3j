// lib/tiktok/types.ts — shared interfaces for the TikTok Ops app (Phase 1),
// per docs/3j-jewelry/ops-app/tech-design-phase1-nextjs.md §5 "mock strategy".
//
// `SalesSummary` is the ONE interface shared between the real server action
// (lib/actions/tiktok-sales.ts, backed by orders) and the sales page UI —
// no separate "mock SalesSummary" exists. Dashboard/Copilot/Upload types are
// currently only produced by lib/tiktok/mock-actions.ts (fixtures) — when the
// analytics DB ships, only mock-actions.ts gets replaced; these types (and
// therefore the UI) stay the same.

import type { ChannelCode } from "@/lib/types";

// ============================================================================
// Sales (real data — lib/actions/tiktok-sales.ts)
// ============================================================================

export type SalesGranularity = "day" | "month";

export interface ChannelSalesBreakdown {
  channelCode: ChannelCode;
  sales: number;
  orders: number;
}

export interface SalesPeriodPoint {
  /** Bucket key: "YYYY-MM-DD" for day granularity, "YYYY-MM" for month. */
  period: string;
  sales: number;
  orders: number;
  /** 0 when orders = 0 (never NaN/Infinity — see aggregation code). */
  aov: number;
  byChannel: ChannelSalesBreakdown[];
}

export interface SalesTotals {
  sales: number;
  orders: number;
  aov: number;
}

export interface SalesScope {
  /** Channels this shop actually has a channel_account for (marketplace only — no LINE). */
  channels: ChannelCode[];
  /** Earliest order date (placed_at ?? created_at) for this shop across all time, or null if no orders exist yet. */
  firstOrderDate: string | null;
  /** Echoes the requested range back, so the UI can render the scope label without re-deriving it. */
  requestedFrom: string;
  requestedTo: string;
}

export interface SalesSummary {
  granularity: SalesGranularity;
  points: SalesPeriodPoint[];
  totals: SalesTotals;
  scope: SalesScope;
}

// ============================================================================
// Daily dashboard (MOCK — รอ analytics DB)
// ============================================================================

export type KpiTrend = "up" | "down" | "flat";

export interface DashboardKpi {
  label: string;
  value: number;
  /** Pre-formatted display string (e.g. "฿12,480", "26") — currency/number formatting decided by fixture, not the component, since some KPIs are counts and some are THB. */
  displayValue: string;
  /** Percent change vs the comparison period. `null` means "up from a zero
   * baseline" (yesterday had no orders) — there is no finite %, so the card
   * shows a "ใหม่" badge instead of a misleading "0%". `trend` still carries
   * the direction in that case. */
  deltaPct: number | null;
  trend: KpiTrend;
  /** Only set on KPIs with incomplete underlying data (e.g. profit — cost coverage < 100%). */
  coveragePct?: number;
}

export interface DashboardKpis {
  salesToday: DashboardKpi;
  orderCount: DashboardKpi;
  profitEstimate: DashboardKpi;
  aov: DashboardKpi;
}

export interface DashboardDataQuality {
  costCoveragePct: number;
  provinceUnknownPct: number;
  addressPendingReviewCount: number;
}

export interface BreakdownRow {
  label: string;
  value: number;
  /** Pre-formatted display for `value` (e.g. "฿6,800", "9", "8 ชิ้น"). */
  displayValue: string;
  /** Percentage / share of the bar within its panel (0-100), used for bar width. */
  barPct: number;
  /** Secondary small text next to the value, e.g. "55%". */
  subLabel?: string;
  isUnknown?: boolean;
  /** e.g. "ต้อง review" — shown as an amber badge next to an unknown/ambiguous row. */
  reviewBadge?: string;
}

export type DashboardBreakdownDimension = "channel" | "province" | "addressType" | "topProducts";

/**
 * Date-picker clamp + "day might be incomplete" warning (0070 — added to the
 * analytics.tiktok_daily_dashboard RPC alongside the rest of the payload).
 * Optional on DailyDashboardData below so this type keeps compiling against
 * both an RPC that hasn't shipped `meta` yet and the static MOCK_DASHBOARD_DATA
 * fixture (lib/tiktok/fixtures.ts) — `undefined` just means "no meta", never
 * a crash, and the UI treats it as "don't clamp, don't warn" (fail-quiet).
 */
export interface DashboardMeta {
  /** Earliest business day with any order data ("YYYY-MM-DD"), or null if unknown — clamps the date picker's `min`. */
  minDate: string | null;
  /** Latest business day with any order data ("YYYY-MM-DD"), or null if unknown — clamps the date picker's `max`. */
  maxDate: string | null;
  /** Bangkok-local ISO timestamp the import data actually reaches (last row seen), or null if unknown. Drives isPossiblyIncomplete below; also the raw source for incompleteLabel's time-of-day text. */
  dataThrough: string | null;
  /** True when the viewed day might still be missing later-in-the-day orders
   * (import ran before this day's close-of-business) — computed server-side
   * (lib/actions/tiktok-dashboard.ts, DAY_COMPLETE_HOUR = 23 Bangkok) so the
   * component never re-derives the cutoff rule. Always false when dataThrough
   * is null: no signal means no warning, not an assumed-incomplete guess. */
  isPossiblyIncomplete: boolean;
  /** Pre-formatted Thai warning text, ready to render as-is, e.g. "ข้อมูลอาจยังไม่ครบวัน — นำเข้าล่าสุดถึง 15:29 (ช่วงไลฟ์ 20:00–23:00 อาจยังไม่ถูกนับ)". States the import time as fact, not a verdict — stays true even on a genuinely quiet night. Null when isPossiblyIncomplete is false. */
  incompleteLabel: string | null;
}

export interface DailyDashboardData {
  /** "YYYY-MM-DD", Asia/Bangkok business day this snapshot covers. */
  date: string;
  kpis: DashboardKpis;
  dataQuality: DashboardDataQuality;
  breakdown: Record<DashboardBreakdownDimension, BreakdownRow[]>;
  /** See DashboardMeta above. Optional — absent until the 0070 RPC ships / for the static fixture. */
  meta?: DashboardMeta;
}

// ============================================================================
// Ad Copilot (MOCK — รอ analytics DB + LLM engine)
// ============================================================================

export type CopilotConfidence = "high" | "medium" | "low";

/** Approve/dismiss is tracked client-side in localStorage per design §5 — this
 * is just the fixture's initial state, not a persisted DB status. */
export type CopilotStatus = "pending" | "approved" | "dismissed";

export interface CopilotMetric {
  label: string;
  /** Pre-formatted display string, e.g. "฿15.4M", "45%", "×1.9". */
  value: string;
}

export interface CopilotRecommendation {
  id: string;
  /** lucide-react icon component name (e.g. "MessageCircle", "TrendingUp") — mapped to a component in the UI layer, never a raw emoji (design §7). */
  icon: string;
  title: string;
  reasonText: string;
  reasonMetrics: CopilotMetric[];
  confidence: CopilotConfidence;
  status: CopilotStatus;
  /** True for the "fix cost data entry first" blocker card — renders with the warn/amber card style and no "Apply" affordance. */
  isBlocker?: boolean;
  decidedAt?: string | null;
}

// ============================================================================
// Upload labels (UI-only in Phase 1 — no backend, state simulated client-side)
// ============================================================================

export type UploadItemStatus = "done" | "parsing" | "failed";

export interface UploadQueueItem {
  id: string;
  fileName: string;
  /** e.g. "18 หน้า · 4.2MB" or "กำลังอ่าน… หน้า 22/30". */
  metaText: string;
  status: UploadItemStatus;
  progressPct?: number;
  errorText?: string;
}

export interface UploadBatchSummary {
  success: number;
  needsReview: number;
  duplicate: number;
  failed: number;
}

export type UploadReviewIssueType = "address_unclear" | "sku_unknown" | "recipient_name_error";

export interface UploadReviewRow {
  id: string;
  externalOrderId: string;
  issueType: UploadReviewIssueType;
  issueBadgeLabel: string;
}

export interface UploadBatchState {
  queue: UploadQueueItem[];
  summary: UploadBatchSummary;
  reviewQueue: UploadReviewRow[];
}
