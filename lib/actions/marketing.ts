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
  AudienceRow,
  DecideRecoInput,
  MktAdSpendWeeklyRow,
  MktChannelRoasRow,
  MktRecoRow,
  MktRecoStatus,
  UpsertAdSpendInput,
} from "@/lib/marketing/types";

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
