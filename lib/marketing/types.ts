// lib/marketing/types.ts — type/const shared by the Marketing Activation
// write layer (lib/actions/marketing.ts) and its client UI. Kept OUT of
// lib/actions/marketing.ts for the same reason lib/crm/merge.ts is: that
// file is "use server" and may only export async functions.
//
// Column shapes below are copied 1:1 from supabase/migrations/
// 0027_marketing_activation.sql (v_channel_perf_roas, v_ad_spend_weekly,
// v_marketing_reco, mkt_reco_decision) — do not add/rename fields without
// re-checking that file, the DB has not been applied yet so nothing here can
// be verified against a live schema.

import type { BadgeTone } from "@/components/ui/Badge";

// ============================================================================
// v_channel_perf_roas (0027 §2) — month x channel spend/ROAS/CAC.
// spend/roas/profitRoas/cac are ALL nullable — null means "no ad spend
// entered for this month/channel", must render "ยังไม่มีข้อมูลค่าแอด", never 0.
// ============================================================================

export interface MktChannelRoasRow {
  /** "YYYY-MM-DD" (first day of month). */
  month: string;
  channelCode: string;
  channelName: string;
  orders: number;
  revenue: number;
  aov: number | null;
  newCustomers: number;
  spend: number | null;
  roas: number | null;
  /** Estimate from the shop's blended margin (0028 wired v_fact_order /
   * v_channel_perf_roas to analytics.shop_setting.blended_margin_pct) — UI
   * labels it "ประมาณการ margin X%" using the live margin, not a fixed 20%. */
  profitRoas: number | null;
  cac: number | null;
  /** 1/margin — the ROAS at which ads exactly break even (gross). Independent
   * of spend, so non-null even for months with no spend entered (0028 §6). */
  breakEvenRoas: number | null;
  /** 1/(margin × ad_gp_share) — the ROAS the owner is aiming for (0028 §6). */
  targetRoas: number | null;
}

// ============================================================================
// v_ad_spend_weekly (0027 §3) — entry-history table on /marketing/ad-spend.
// ============================================================================

export interface MktAdSpendWeeklyRow {
  /** "YYYY-MM-DD", Monday. */
  weekStart: string;
  /** "YYYY-MM-DD", Sunday. */
  weekEnd: string;
  channelCode: string;
  channelName: string;
  spend: number;
  impressions: number | null;
  clicks: number | null;
  daysEntered: number;
}

// ============================================================================
// mkt_upsert_ad_spend RPC input (0027 §1) — form on /marketing/ad-spend.
// ============================================================================

export interface UpsertAdSpendInput {
  channelId: string;
  /** "YYYY-MM-DD", inclusive. */
  dateFrom: string;
  /** "YYYY-MM-DD", inclusive. */
  dateTo: string;
  amount: number;
  impressions?: number | null;
  clicks?: number | null;
}

// ============================================================================
// v_marketing_reco (0027 §4) + mkt_reco_decision (0027 §5) — Ad Copilot feed.
// Card rendering MUST be generic over rule_code (loop every row from the
// view) — the labels/tones below are cosmetic lookups only, never business
// logic; an unrecognized rule_code still renders correctly via the fallback
// branches.
// ============================================================================

export type MktRecoSeverity = "blocker" | "high" | "medium" | "info";

export type MktRecoStatus = "pending" | "approved" | "dismissed";

export interface MktRecoRow {
  /** Deterministic key (rule_code + period) — PK on mkt_reco_decision, also
   * the React list key. */
  recoKey: string;
  ruleCode: string;
  severity: MktRecoSeverity;
  /** Sort order, ascending (0 = show first). */
  priority: number;
  title: string;
  /** jsonb payload — shape depends on ruleCode, see the per-rule interfaces
   * below for the ones the SQL view currently emits (0027 §4 header comment). */
  detail: Record<string, unknown>;
  isBlocked: boolean;
  blockedReason: string | null;
  /** "pending" when no row exists yet in mkt_reco_decision for this reco_key. */
  status: MktRecoStatus;
  decidedAt: string | null;
  dismissReason: string | null;
}

export interface DecideRecoInput {
  recoKey: string;
  status: Exclude<MktRecoStatus, "pending">;
  dismissReason?: string | null;
}

/** Known detail payload shapes (0027 §4) — optional typed helpers for the
 * card renderer; any rule not listed here (present or future) still renders
 * via a generic key/value fallback, per "อย่า hardcode กฎในโค้ด frontend". */
export interface MktLiveTargetingDetail {
  channel_code: string;
  top_provinces: { province_code: string; province_name: string; orders: number; revenue: number; aov: number }[];
  segment_mix: Record<string, number>;
  hourly_orders: { hour: number; orders: number }[];
}

export const MKT_SEVERITY_LABEL_TH: Record<MktRecoSeverity, string> = {
  blocker: "ก่อนอื่น · blocker",
  high: "สำคัญ",
  medium: "ควรทำ",
  info: "แจ้งเพื่อทราบ",
};

export const MKT_SEVERITY_TONE: Record<MktRecoSeverity, BadgeTone> = {
  blocker: "amber",
  high: "red",
  medium: "indigo",
  info: "slate",
};

function isMktRecoSeverity(v: string): v is MktRecoSeverity {
  return v === "blocker" || v === "high" || v === "medium" || v === "info";
}

/** Fail-safe accessor — an unrecognized severity string from the DB (future
 * rule the frontend hasn't shipped a label for yet) falls back to "info"
 * styling rather than crashing the card render. */
export function mktSeverityLabel(severity: string): string {
  return isMktRecoSeverity(severity) ? MKT_SEVERITY_LABEL_TH[severity] : severity;
}

export function mktSeverityTone(severity: string): BadgeTone {
  return isMktRecoSeverity(severity) ? MKT_SEVERITY_TONE[severity] : "slate";
}

/** Short Thai category chip per rule_code — cosmetic only (orientation aid),
 * NOT used to branch rendering logic. Unknown rule_code (new rule added to
 * the SQL view later) falls back to the raw code so the card still renders
 * something meaningful instead of blank. */
export const MKT_RULE_LABEL_TH: Record<string, string> = {
  spend_missing: "ค่าแอดขาดหาย",
  winback_at_risk: "ลูกค้าเสี่ยงหาย",
  geo_focus: "โฟกัสจังหวัด",
  cac_vs_aov: "ต้นทุนต่อลูกค้า",
  roas_drop: "ROAS ตก",
  lookalike_seed: "Lookalike audience",
  live_targeting_brief: "บรีฟยิงแอดไลฟ์",
  seasonal_calendar: "ปฏิทินเทศกาล",
};

export function mktRuleLabel(ruleCode: string): string {
  return MKT_RULE_LABEL_TH[ruleCode] ?? ruleCode;
}
