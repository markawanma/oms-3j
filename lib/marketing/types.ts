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

// ============================================================================
// Audience builder (analytics.v_audience, 0033) — one row per customer with
// RFM segment + channel + province, for pulling LINE-broadcast target lists.
// No raw PII (display_name only).
// ============================================================================

export interface AudienceRow {
  customerId: string;
  displayName: string;
  segment: string;
  orderCount: number;
  revenueSum: number;
  recencyDays: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  channelCode: string | null;
  channelName: string | null;
  provinceCode: string | null;
  provinceNameTh: string | null;
  /** เงินแท่ง vs เครื่องประดับ (analytics.v_customer_affinity, 0099) — สอง
   * กลุ่มลูกค้าทับกันแค่ 2.7% ยิงคอนเทนต์ผิดฝั่ง = เผาเงิน */
  boughtBar: boolean;
  boughtJewelry: boolean;
  barRevenue: number;
  jewelryRevenue: number;
  affinity: ProductAffinity;
  barOrderCount: number;
  jewelryOrderCount: number;
}

/** 'unknown' = ไม่เคยซื้อฝั่งไหนที่ระบุได้เลย (ซื้อแต่ค่าส่ง/กล่อง/น้ำยา/SKU ที่
 * ยัง match ไม่ได้ หรือไม่มีออเดอร์เลย) — ไม่ใช่ error, เป็นค่าที่ตั้งใจให้เกิด */
export type ProductAffinity = "bar_only" | "jewelry_only" | "both" | "unknown";

export const AUDIENCE_AFFINITY_LABEL_TH: Record<ProductAffinity, string> = {
  bar_only: "เงินแท่งเท่านั้น",
  jewelry_only: "เครื่องประดับเท่านั้น",
  both: "ซื้อทั้งสองอย่าง",
  unknown: "ไม่ระบุ",
};

/** Segment display order + labels (RFM). `at_risk` is future — appears once
 * the dataset spans >90 days; today the shop has 0 (data is ~1 month old). */
export const AUDIENCE_SEGMENTS = ["champion", "loyal", "new", "at_risk"] as const;

export const AUDIENCE_SEGMENT_LABEL_TH: Record<string, string> = {
  champion: "ชั้นดี (Champion)",
  loyal: "ประจำ (Loyal)",
  new: "ใหม่ (ซื้อครั้งเดียว)",
  at_risk: "เสี่ยงหาย (At-risk)",
};

export function audienceSegmentLabel(segment: string): string {
  return AUDIENCE_SEGMENT_LABEL_TH[segment] ?? segment;
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

// ============================================================================
// analytics.v_campaign_calendar — Thai retail calendar (mega-sale/festival/
// gift-occasion), 1 row/event, "next occurrence" already computed by the view
// (event_date/days_until/in_lead_window). No shop_id: this is global
// reference data shared by every shop, not per-tenant. /marketing/calendar.
// ============================================================================

export interface CampaignEvent {
  code: string;
  nameTh: string;
  /** 'mega_sale' | 'festival' | 'gift_occasion' today — kept as string (not a
   * union) so a future event_type the view adds still renders via the
   * fallback in campaignEventTypeLabel/Tone instead of failing to typecheck. */
  eventType: string;
  recurMonth: number | null;
  recurDay: number | null;
  /** "YYYY-MM-DD" — set only for one-off (non-recurring) events. */
  specificDate: string | null;
  durationDays: number;
  leadDays: number;
  prepNoteTh: string | null;
  /** "YYYY-MM-DD" — the next occurrence of this event from today. */
  eventDate: string;
  /** Days from today until eventDate (0 = today). */
  daysUntil: number;
  /** true when today falls inside [eventDate - leadDays, eventDate] — the
   * same window that surfaces this event as a "seasonal_calendar" card on
   * /marketing/copilot (0027 §4). */
  inLeadWindow: boolean;
}

/** Cosmetic label/tone lookups only, per "อย่า hardcode business logic ใน
 * frontend" — an event_type the view emits that isn't listed here still
 * renders (raw code / slate badge) instead of crashing. */
export const CAMPAIGN_EVENT_TYPE_LABEL_TH: Record<string, string> = {
  mega_sale: "มหกรรมลดราคา",
  festival: "เทศกาล",
  gift_occasion: "โอกาสให้ของขวัญ",
};

export const CAMPAIGN_EVENT_TYPE_TONE: Record<string, BadgeTone> = {
  mega_sale: "red",
  festival: "amber",
  gift_occasion: "indigo",
};

export function campaignEventTypeLabel(eventType: string): string {
  return CAMPAIGN_EVENT_TYPE_LABEL_TH[eventType] ?? eventType;
}

export function campaignEventTypeTone(eventType: string): BadgeTone {
  return CAMPAIGN_EVENT_TYPE_TONE[eventType] ?? "slate";
}

// ============================================================================
// /marketing/attribution — manual promo-code attribution log (0036). No
// automatic tracking link for a LINE broadcast (e.g. "รับสิทธิ์99") so the
// owner logs each order the buyer typed the code for in chat. Deliberately
// separate from dim_campaign (paid-ad/UTM) — see 0036's own header comment.
// ============================================================================

/** analytics.v_promo_attribution_summary — one row per code, totals. */
export interface PromoAttributionSummary {
  code: string;
  entries: number;
  totalAmount: number;
  avgAmount: number;
  /** "YYYY-MM-DD" */
  firstOn: string;
  /** "YYYY-MM-DD" */
  lastOn: string;
}

/** analytics.promo_attribution — raw log rows, most recent first. */
export interface PromoAttributionEntry {
  id: string;
  code: string;
  /** "YYYY-MM-DD" */
  occurredOn: string;
  amount: number;
  channelId: string | null;
  /** Resolved from analytics.dim_channel — null if channelId is null. */
  channelName: string | null;
  customerRef: string | null;
  note: string | null;
  /** ISO timestamp */
  loggedAt: string;
}

/** analytics.v_promo_attribution_auto (0040) — one row per (shop, code) built
 * from fact_order.discount_code (Excel order-report col R, "รหัสส่วนลด"),
 * NOT the manual log above. Never sum with PromoAttributionSummary's totals
 * — see 0040's own header + design §D4 ("ห้ามรวมยอด auto+manual"). */
export interface PromoAttributionAuto {
  code: string;
  orders: number;
  totalRevenue: number;
  avgRevenue: number;
  /** "YYYY-MM-DD" */
  firstOn: string;
  /** "YYYY-MM-DD" */
  lastOn: string;
  channelBreakdown: { channelName: string; orders: number; revenue: number }[];
}

/** analytics.promo_attribution_add RPC input. */
export interface AddPromoAttributionInput {
  code: string;
  amount: number;
  /** "YYYY-MM-DD" */
  occurredOn: string;
  channelId?: string | null;
  customerRef?: string | null;
  note?: string | null;
}

/** Default code owner uses in LINE broadcasts today — pre-filled in the
 * form, still editable (future campaigns will use a different code). */
export const PROMO_ATTRIBUTION_DEFAULT_CODE = "รับสิทธิ์99";
