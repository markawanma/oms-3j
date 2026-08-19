"use server";

// lib/actions/marketing.ts — Phase B3a+B3b Marketing Activation (docs/3j-jewelry/
// analytics/phase-b3-design.md §1 ad spend entry, §3 ROAS/CAC, §4 recommendation
// engine), backed by supabase/migrations/0027_marketing_activation.sql.
//
// ⚠️ 0027 is NOT applied yet (written by backend-dev, apply pending — see the
// migration's own header). Every query/RPC name and column below is copied
// 1:1 from that file, not guessed — once applied this module should work
// against the real DB unmodified.
//
// Pattern: identical service-client + getDevShopId() + getDevRole() gate +
// ActionResult<T> shape as lib/actions/crm.ts (this file's sibling for the
// B2 write layer) — same SHOP SCOPING NOTE applies: getServiceClient() uses
// the service role, which BYPASSES every RLS policy in 0027 (including
// mkt_reco_decision's owner_admin_* policies and analytics.
// crm_require_owner_admin() inside mkt_upsert_ad_spend, which short-circuits
// for service_role — see crm.ts's B2a header comment for the same gap). That
// means getDevRole() below is the ONLY thing gating writes in this app today,
// not the DB. Every write action must call it first.

import { revalidatePath } from "next/cache";
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId, getDevRole } from "@/lib/dev/context";
import type { ActionResult } from "@/lib/types";
import type {
  AddPromoAttributionInput,
  AudienceRow,
  CampaignEvent,
  DecideRecoInput,
  MktAdSpendWeeklyRow,
  MktChannelRoasRow,
  MktRecoRow,
  MktRecoStatus,
  PromoAttributionAuto,
  PromoAttributionEntry,
  PromoAttributionSummary,
  UpsertAdSpendInput,
} from "@/lib/marketing/types";
import type { ArtifactStatus, CampaignBoardStep } from "@/lib/marketing/campaign-types";
import { ARTIFACT_STATUSES } from "@/lib/marketing/campaign-types";
import { CAMPAIGN_BOARD_SELECT, mapCampaignBoardRow } from "@/lib/marketing/campaign-board-mapper";

const SCHEMA = "analytics";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValidDateStr(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

function requireOwnerAdmin(): ActionResult<never> | null {
  if (getDevRole() === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ใช้งานส่วนการตลาดได้" };
  }
  return null;
}

// ============================================================================
// /marketing/ad-spend — reads (0027 §2/§3)
// ============================================================================

/** analytics.v_channel_perf_roas — month x channel spend/ROAS/CAC (0027 §2).
 * Read-only, NOT role-gated (mirrors ChannelPerfTable on /crm/overview, which
 * every dev role can see today) — only entering spend and the recommendation
 * feed are owner/admin actions per the design. */
export async function getChannelRoas(): Promise<ActionResult<MktChannelRoasRow[]>> {
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("v_channel_perf_roas")
      .select(
        "month, channel_code, channel_name, orders, revenue, aov, new_customers, spend, roas, profit_roas, cac, break_even_roas, target_roas"
      )
      .eq("shop_id", shopId)
      .order("month", { ascending: false })
      .order("channel_code", { ascending: true });
    if (error) throw error;

    const rows: MktChannelRoasRow[] = (
      (data ?? []) as {
        month: string;
        channel_code: string;
        channel_name: string;
        orders: number;
        revenue: number;
        aov: number | null;
        new_customers: number;
        spend: number | null;
        roas: number | null;
        profit_roas: number | null;
        cac: number | null;
        break_even_roas: number | null;
        target_roas: number | null;
      }[]
    ).map((r) => ({
      month: r.month,
      channelCode: r.channel_code,
      channelName: r.channel_name,
      orders: Number(r.orders) || 0,
      revenue: Number(r.revenue) || 0,
      aov: r.aov === null ? null : Number(r.aov),
      newCustomers: Number(r.new_customers) || 0,
      spend: r.spend === null ? null : Number(r.spend),
      roas: r.roas === null ? null : Number(r.roas),
      profitRoas: r.profit_roas === null ? null : Number(r.profit_roas),
      cac: r.cac === null ? null : Number(r.cac),
      breakEvenRoas: r.break_even_roas === null ? null : Number(r.break_even_roas),
      targetRoas: r.target_roas === null ? null : Number(r.target_roas),
    }));

    return { ok: true, data: rows };
  } catch (err) {
    console.error("getChannelRoas failed", err);
    return { ok: false, error: "โหลดข้อมูล ROAS ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

/** analytics.v_ad_spend_weekly — entry-history table (0027 §3). Same
 * not-role-gated reasoning as getChannelRoas above. */
export async function getAdSpendWeekly(): Promise<ActionResult<MktAdSpendWeeklyRow[]>> {
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("v_ad_spend_weekly")
      .select("week_start, week_end, channel_code, channel_name, spend, impressions, clicks, days_entered")
      .eq("shop_id", shopId)
      .order("week_start", { ascending: false })
      .order("channel_code", { ascending: true });
    if (error) throw error;

    const rows: MktAdSpendWeeklyRow[] = (
      (data ?? []) as {
        week_start: string;
        week_end: string;
        channel_code: string;
        channel_name: string;
        spend: number;
        impressions: number | null;
        clicks: number | null;
        days_entered: number;
      }[]
    ).map((r) => ({
      weekStart: r.week_start,
      weekEnd: r.week_end,
      channelCode: r.channel_code,
      channelName: r.channel_name,
      spend: Number(r.spend) || 0,
      impressions: r.impressions === null ? null : Number(r.impressions),
      clicks: r.clicks === null ? null : Number(r.clicks),
      daysEntered: Number(r.days_entered) || 0,
    }));

    return { ok: true, data: rows };
  } catch (err) {
    console.error("getAdSpendWeekly failed", err);
    return { ok: false, error: "โหลดประวัติค่าแอดไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// /marketing/ad-spend — write: analytics.mkt_upsert_ad_spend RPC (0027 §1).
// SECURITY DEFINER, splits p_amount evenly across [p_date_from, p_date_to]
// (remainder folded into the last day) and upserts against fact_ad_spend's
// expression-index key — see the RPC's own comments for why this can't go
// through PostgREST .upsert({onConflict}) directly.
// ============================================================================

export async function upsertAdSpend(
  input: UpsertAdSpendInput
): Promise<ActionResult<{ daysWritten: number; amountPerDay: number }>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!input.channelId) return { ok: false, error: "กรุณาเลือกช่องทาง" };
  if (!isValidDateStr(input.dateFrom) || !isValidDateStr(input.dateTo)) {
    return { ok: false, error: "รูปแบบวันที่ไม่ถูกต้อง" };
  }
  if (input.dateFrom > input.dateTo) {
    return { ok: false, error: "วันที่เริ่มต้องมาก่อนวันที่สิ้นสุด" };
  }
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    return { ok: false, error: "กรุณากรอกยอดเงินให้ถูกต้อง (ตั้งแต่ 0 ขึ้นไป)" };
  }
  if (input.impressions != null && (!Number.isFinite(input.impressions) || input.impressions < 0)) {
    return { ok: false, error: "จำนวนการเข้าถึง (impressions) ต้องเป็นจำนวนตั้งแต่ 0 ขึ้นไป" };
  }
  if (input.clicks != null && (!Number.isFinite(input.clicks) || input.clicks < 0)) {
    return { ok: false, error: "จำนวนคลิกต้องเป็นจำนวนตั้งแต่ 0 ขึ้นไป" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("mkt_upsert_ad_spend", {
      p_shop_id: shopId,
      p_channel_id: input.channelId,
      p_date_from: input.dateFrom,
      p_date_to: input.dateTo,
      p_amount: input.amount,
      p_impressions: input.impressions ?? null,
      p_clicks: input.clicks ?? null,
    });
    if (error) throw error;

    // RPC returns `table(days_written int, amount_per_day numeric)` — one row.
    const row = (Array.isArray(data) ? data[0] : data) as
      | { days_written: number; amount_per_day: number }
      | undefined;

    revalidatePath("/marketing/ad-spend");
    // ROAS/CAC and R0/R3/R6 recommendations all read from spend the moment
    // it lands, so the copilot feed must refresh too, not just the entry page.
    revalidatePath("/marketing/copilot");

    return {
      ok: true,
      data: {
        daysWritten: Number(row?.days_written) || 0,
        amountPerDay: Number(row?.amount_per_day) || 0,
      },
    };
  } catch (err) {
    console.error("upsertAdSpend failed", err);
    return { ok: false, error: "บันทึกค่าแอดไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// /marketing/copilot — analytics.v_marketing_reco + mkt_reco_decision (0027
// §4/§5). Read side merges the two: the view is always freshly computed from
// marts (no stored "pending" state), decision status is layered on top by
// reco_key.
// ============================================================================

export async function getMarketingReco(): Promise<ActionResult<MktRecoRow[]>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const [recoRes, decisionRes] = await Promise.all([
      supabase
        .schema(SCHEMA)
        .from("v_marketing_reco")
        .select("reco_key, rule_code, severity, priority, title, detail, is_blocked, blocked_reason")
        .eq("shop_id", shopId)
        .order("priority", { ascending: true })
        .order("reco_key", { ascending: true }),
      supabase
        .schema(SCHEMA)
        .from("mkt_reco_decision")
        .select("reco_key, status, dismiss_reason, decided_at")
        .eq("shop_id", shopId),
    ]);
    if (recoRes.error) throw recoRes.error;
    if (decisionRes.error) throw decisionRes.error;

    const decisionMap = new Map<string, { status: MktRecoStatus; dismiss_reason: string | null; decided_at: string }>();
    for (const d of (decisionRes.data ?? []) as {
      reco_key: string;
      status: string;
      dismiss_reason: string | null;
      decided_at: string;
    }[]) {
      decisionMap.set(d.reco_key, {
        status: d.status as MktRecoStatus,
        dismiss_reason: d.dismiss_reason,
        decided_at: d.decided_at,
      });
    }

    const rows: MktRecoRow[] = (
      (recoRes.data ?? []) as {
        reco_key: string;
        rule_code: string;
        severity: string;
        priority: number;
        title: string;
        detail: Record<string, unknown> | null;
        is_blocked: boolean;
        blocked_reason: string | null;
      }[]
    ).map((r) => {
      const decision = decisionMap.get(r.reco_key);
      return {
        recoKey: r.reco_key,
        ruleCode: r.rule_code,
        severity: r.severity as MktRecoRow["severity"],
        priority: Number(r.priority) || 0,
        title: r.title,
        detail: r.detail ?? {},
        isBlocked: Boolean(r.is_blocked),
        blockedReason: r.blocked_reason,
        status: decision?.status ?? "pending",
        decidedAt: decision?.decided_at ?? null,
        dismissReason: decision?.dismiss_reason ?? null,
      };
    });

    return { ok: true, data: rows };
  } catch (err) {
    console.error("getMarketingReco failed", err);
    return { ok: false, error: "โหลดคำแนะนำการตลาดไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// /marketing/audience — pull a broadcast target list per RFM segment
// (analytics.v_audience, 0033). Owner/admin only: a customer list is sensitive
// even without raw PII.
// ============================================================================

export async function getAudience(segment?: string): Promise<ActionResult<AudienceRow[]>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    let query = supabase
      .schema(SCHEMA)
      .from("v_audience")
      .select(
        "customer_id, display_name, segment, order_count, revenue_sum, recency_days, first_order_at, last_order_at, channel_code, channel_name, province_code, province_name_th"
      )
      .eq("shop_id", shopId);

    if (segment && segment !== "all") query = query.eq("segment", segment);

    const { data, error } = await query.order("revenue_sum", { ascending: false });
    if (error) throw error;

    const rows: AudienceRow[] = (
      (data ?? []) as {
        customer_id: string;
        display_name: string;
        segment: string;
        order_count: number;
        revenue_sum: number;
        recency_days: number;
        first_order_at: string | null;
        last_order_at: string | null;
        channel_code: string | null;
        channel_name: string | null;
        province_code: string | null;
        province_name_th: string | null;
      }[]
    ).map((r) => ({
      customerId: r.customer_id,
      displayName: r.display_name,
      segment: r.segment,
      orderCount: Number(r.order_count) || 0,
      revenueSum: Number(r.revenue_sum) || 0,
      recencyDays: Number(r.recency_days) || 0,
      firstOrderAt: r.first_order_at,
      lastOrderAt: r.last_order_at,
      channelCode: r.channel_code,
      channelName: r.channel_name,
      provinceCode: r.province_code,
      provinceNameTh: r.province_name_th,
    }));

    return { ok: true, data: rows };
  } catch (err) {
    console.error("getAudience failed", err);
    return { ok: false, error: "โหลดรายชื่อกลุ่มลูกค้าไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// /marketing/calendar — analytics.v_campaign_calendar. No shop_id column on
// this view (global Thai retail calendar, same 11 events for every shop) —
// unlike every other read above, do NOT filter by getDevShopId(). Owner/admin
// gated like the rest of this file: prep_note_th carries pricing/discount
// prep strategy, not something staff needs to see.
// ============================================================================

export async function getCampaignCalendar(): Promise<ActionResult<CampaignEvent[]>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  try {
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("v_campaign_calendar")
      .select(
        "code, name_th, event_type, recur_month, recur_day, specific_date, duration_days, lead_days, prep_note_th, event_date, days_until, in_lead_window"
      )
      .order("days_until", { ascending: true });
    if (error) throw error;

    const rows: CampaignEvent[] = (
      (data ?? []) as {
        code: string;
        name_th: string;
        event_type: string;
        recur_month: number | null;
        recur_day: number | null;
        specific_date: string | null;
        duration_days: number;
        lead_days: number;
        prep_note_th: string | null;
        event_date: string;
        days_until: number;
        in_lead_window: boolean;
      }[]
    ).map((r) => ({
      code: r.code,
      nameTh: r.name_th,
      eventType: r.event_type,
      recurMonth: r.recur_month,
      recurDay: r.recur_day,
      specificDate: r.specific_date,
      durationDays: Number(r.duration_days) || 0,
      leadDays: Number(r.lead_days) || 0,
      prepNoteTh: r.prep_note_th,
      eventDate: r.event_date,
      daysUntil: Number(r.days_until) || 0,
      inLeadWindow: Boolean(r.in_lead_window),
    }));

    return { ok: true, data: rows };
  } catch (err) {
    console.error("getCampaignCalendar failed", err);
    return { ok: false, error: "โหลดปฏิทินแคมเปญไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// /marketing/attribution — TWO independent data sources, deliberately never
// merged into one total (design docs/3j-jewelry/analytics/
// phase-auto-attribution-design.md §D4):
//   - manual (0036): owner-logged ledger for codes buyers typed in LINE chat
//     (no automatic tracking link exists for a broadcast).
//   - auto (0040): v_promo_attribution_auto, built from fact_order.discount_code
//     — the discount-code column the marketplace itself records in the Excel
//     order report. Read-only, no write RPC (it's derived, not entered).
// Owner/admin only for both (same reasoning as audience: sensitive-ish ledger
// data, not read-only reference data).
// ============================================================================

export async function getPromoAttribution(): Promise<
  ActionResult<{
    summary: PromoAttributionSummary[];
    entries: PromoAttributionEntry[];
    auto: PromoAttributionAuto[];
  }>
> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const [summaryRes, entriesRes, channelsRes, autoRes] = await Promise.all([
      supabase
        .schema(SCHEMA)
        .from("v_promo_attribution_summary")
        .select("code, entries, total_amount, avg_amount, first_on, last_on")
        .eq("shop_id", shopId)
        .order("total_amount", { ascending: false }),
      supabase
        .schema(SCHEMA)
        .from("promo_attribution")
        .select("id, code, occurred_on, amount, channel_id, customer_ref, note, logged_at")
        .eq("shop_id", shopId)
        .order("occurred_on", { ascending: false })
        .order("logged_at", { ascending: false })
        .limit(100),
      // dim_channel has no shop_id column (global reference data, same as
      // getCrmEditOptions) — fetched every call rather than joined, since
      // PostgREST can't join across schemas/foreign tables here.
      supabase.schema(SCHEMA).from("dim_channel").select("id, name"),
      supabase
        .schema(SCHEMA)
        .from("v_promo_attribution_auto")
        .select("code, orders, total_revenue, avg_revenue, first_on, last_on, channel_breakdown")
        .eq("shop_id", shopId)
        .order("total_revenue", { ascending: false }),
    ]);
    if (summaryRes.error) throw summaryRes.error;
    if (entriesRes.error) throw entriesRes.error;
    if (channelsRes.error) throw channelsRes.error;
    if (autoRes.error) throw autoRes.error;

    const channelNameById = new Map<string, string>(
      ((channelsRes.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name])
    );

    const summary: PromoAttributionSummary[] = (
      (summaryRes.data ?? []) as {
        code: string;
        entries: number;
        total_amount: number;
        avg_amount: number;
        first_on: string;
        last_on: string;
      }[]
    ).map((r) => ({
      code: r.code,
      entries: Number(r.entries) || 0,
      totalAmount: Number(r.total_amount) || 0,
      avgAmount: Number(r.avg_amount) || 0,
      firstOn: r.first_on,
      lastOn: r.last_on,
    }));

    const entries: PromoAttributionEntry[] = (
      (entriesRes.data ?? []) as {
        id: string;
        code: string;
        occurred_on: string;
        amount: number;
        channel_id: string | null;
        customer_ref: string | null;
        note: string | null;
        logged_at: string;
      }[]
    ).map((r) => ({
      id: r.id,
      code: r.code,
      occurredOn: r.occurred_on,
      amount: Number(r.amount) || 0,
      channelId: r.channel_id,
      channelName: r.channel_id ? channelNameById.get(r.channel_id) ?? null : null,
      customerRef: r.customer_ref,
      note: r.note,
      loggedAt: r.logged_at,
    }));

    const auto: PromoAttributionAuto[] = (
      (autoRes.data ?? []) as {
        code: string;
        orders: number;
        total_revenue: number;
        avg_revenue: number;
        first_on: string;
        last_on: string;
        channel_breakdown: unknown;
      }[]
    ).map((r) => ({
      code: r.code,
      orders: Number(r.orders) || 0,
      totalRevenue: Number(r.total_revenue) || 0,
      avgRevenue: Number(r.avg_revenue) || 0,
      firstOn: r.first_on,
      lastOn: r.last_on,
      // jsonb_agg from the view — defend against null/malformed shape rather
      // than trusting it blindly, same caution as any externally-sourced data.
      channelBreakdown: (Array.isArray(r.channel_breakdown) ? r.channel_breakdown : []).map(
        (c: { channel_name?: unknown; orders?: unknown; revenue?: unknown }) => ({
          channelName: typeof c?.channel_name === "string" ? c.channel_name : "ไม่ระบุ",
          orders: Number(c?.orders) || 0,
          revenue: Number(c?.revenue) || 0,
        })
      ),
    }));

    return { ok: true, data: { summary, entries, auto } };
  } catch (err) {
    console.error("getPromoAttribution failed", err);
    return { ok: false, error: "โหลดข้อมูลการวัดผลโค้ดไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function addPromoAttribution(input: AddPromoAttributionInput): Promise<ActionResult<string>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const code = input.code.trim();
  if (!code) return { ok: false, error: "กรุณากรอกโค้ด" };
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    return { ok: false, error: "กรุณากรอกยอดเงินให้ถูกต้อง (ตั้งแต่ 0 ขึ้นไป)" };
  }
  if (!isValidDateStr(input.occurredOn)) {
    return { ok: false, error: "รูปแบบวันที่ไม่ถูกต้อง" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("promo_attribution_add", {
      p_shop_id: shopId,
      p_code: code,
      p_amount: input.amount,
      p_occurred_on: input.occurredOn,
      p_channel_id: input.channelId ?? null,
      p_customer_ref: input.customerRef?.trim() || null,
      p_note: input.note?.trim() || null,
    });
    if (error) throw error;

    revalidatePath("/marketing/attribution");
    return { ok: true, data: data as string };
  } catch (err) {
    console.error("addPromoAttribution failed", err);
    return { ok: false, error: "บันทึกรายการไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function deletePromoAttribution(id: string): Promise<ActionResult> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!id) return { ok: false, error: "ไม่พบรายการที่จะลบ" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { error } = await supabase.schema(SCHEMA).rpc("promo_attribution_delete", {
      p_id: id,
      p_shop_id: shopId,
    });
    if (error) throw error;

    revalidatePath("/marketing/attribution");
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("deletePromoAttribution failed", err);
    return { ok: false, error: "ลบรายการไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function decideReco(input: DecideRecoInput): Promise<ActionResult> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!input.recoKey) return { ok: false, error: "ไม่พบรหัสคำแนะนำ" };
  if (input.status !== "approved" && input.status !== "dismissed") {
    return { ok: false, error: "สถานะไม่ถูกต้อง" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    // Direct RLS-style table write, no RPC — per 0027 §5's own design note
    // ("preference, not a data edit, no audit trail needed"). shop_id+reco_key
    // is the table's real primary key (not an expression index), so
    // PostgREST .upsert({onConflict}) can target it directly, unlike
    // fact_ad_spend above.
    const { error } = await supabase
      .schema(SCHEMA)
      .from("mkt_reco_decision")
      .upsert(
        {
          shop_id: shopId,
          reco_key: input.recoKey,
          status: input.status,
          dismiss_reason: input.status === "dismissed" ? input.dismissReason?.trim() || null : null,
          decided_at: new Date().toISOString(),
        },
        { onConflict: "shop_id,reco_key" }
      );
    if (error) throw error;

    revalidatePath("/marketing/copilot");
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("decideReco failed", err);
    return { ok: false, error: "บันทึกการตัดสินใจไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// /marketing/copilot — Campaign Playbook (analytics.v_campaign_board, 0049).
// One row per campaign step; effective_status/audience_live_count are resolved
// live in the view (from v_rfm_segment + gate/artifact state), so winback shows
// waiting_data on its own when at_risk grows/shrinks. Owner/admin only — same
// gate as the rest of the copilot. Writes go ONLY through the two RPCs below
// (they enforce rule 1: silver_bar steps must never carry a discount).
// ============================================================================

export async function getCampaignBoard(): Promise<ActionResult<CampaignBoardStep[]>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("v_campaign_board")
      .select(CAMPAIGN_BOARD_SELECT)
      .eq("shop_id", shopId)
      .order("campaign_id", { ascending: true })
      .order("seq", { ascending: true });
    if (error) throw error;

    const rows: CampaignBoardStep[] = ((data ?? []) as Record<string, unknown>[]).map(mapCampaignBoardRow);

    return { ok: true, data: rows };
  } catch (err) {
    console.error("getCampaignBoard failed", err);
    return { ok: false, error: "โหลดบอร์ดแคมเปญไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function setCampaignArtifactStatus(
  artifactId: string,
  status: ArtifactStatus
): Promise<ActionResult> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!artifactId) return { ok: false, error: "ไม่พบรายการ content" };
  if (!ARTIFACT_STATUSES.includes(status)) {
    return { ok: false, error: "สถานะไม่ถูกต้อง" };
  }

  try {
    const supabase = getServiceClient();
    const { error } = await supabase.schema(SCHEMA).rpc("campaign_set_artifact_status", {
      p_artifact_id: artifactId,
      p_status: status,
    });
    if (error) throw error;

    revalidatePath("/marketing/copilot");
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("setCampaignArtifactStatus failed", err);
    // rule 1 (silver_bar + discount) is raised with SQLSTATE 22023 — match the
    // code first (stable), fall back to the message text only if the code
    // didn't propagate, so re-wording the SQL exception can't break this.
    const code = (err as { code?: string })?.code;
    const msg =
      code === "22023" || (err instanceof Error && err.message.includes("silver_bar"))
        ? "สินค้าเงินแท่งห้ามมีส่วนลด (กันเก็งกำไรราคา)"
        : "อัปเดตสถานะไม่สำเร็จ ลองใหม่อีกครั้ง";
    return { ok: false, error: msg };
  }
}

export async function passCampaignGate(stepId: string, gateKind: string): Promise<ActionResult> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!stepId || !gateKind) return { ok: false, error: "ไม่พบเงื่อนไขที่จะผ่าน" };

  try {
    const supabase = getServiceClient();
    const { error } = await supabase.schema(SCHEMA).rpc("campaign_pass_gate", {
      p_step_id: stepId,
      p_gate_kind: gateKind,
    });
    if (error) throw error;

    revalidatePath("/marketing/copilot");
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("passCampaignGate failed", err);
    return { ok: false, error: "อัปเดตเงื่อนไขไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
