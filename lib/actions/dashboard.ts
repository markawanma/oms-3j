"use server";

// lib/actions/dashboard.ts — Home/Dashboard (docs/3j-jewelry/design/ui-refresh-
// plan.md §1). Single RPC analytics.dashboard_summary aggregates everything.
// NOT owner/admin gated: staff may see the dashboard, but the money sections
// (KPI/reco/RFM/channel) are stripped by passing p_include_money=false — the
// RPC returns them null/empty for staff, so no revenue/profit ever reaches a
// staff session.
//
// 0054: replaced the p_period ("today"/"7d"/"month") toggle with a real
// date-range + channel filter, matching lib/actions/crm.ts's getCrmOverview
// (same validation contract: malformed/unknown values are silently dropped,
// never a 500 — these come straight from URL searchParams on /dashboard).

import { getServiceClient } from "@/lib/supabase/server";
import { formatCount, formatTHBCompact } from "@/lib/tiktok/format";
import { getDevShopId, getDevRole } from "@/lib/dev/context";
import type { ActionResult } from "@/lib/types";
import type {
  ChartCoverage,
  DashboardCharts,
  DashboardData,
  DashboardReco,
  DashboardScope,
  HBarRow,
  MixSlice,
  NewReturning,
  SalesByChannel,
  TrendPoint,
  WeekdayPoint,
} from "@/lib/dashboard/types";

const SCHEMA = "analytics";

/** "YYYY-MM-DD" date-range + channel filter — same shape both getDashboard
 * and getDashboardCharts take, mirroring GetCrmOverviewParams. */
export interface GetDashboardParams {
  /** "YYYY-MM-DD", inclusive. */
  from: string;
  to: string;
  /** analytics.dim_channel.code (e.g. "line", "tiktok"), or null for every channel. */
  channel: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateStr(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  // Round-trip guard: JS rolls "2026-13-45" over to a valid instant (2027-02-14),
  // which passes the regex+NaN check but is not a real calendar date — Postgres
  // would then reject the ::date cast and surface an error card. Requiring the
  // parsed date to serialize back to the same string rejects those.
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

interface ValidatedRange {
  from: string;
  to: string;
  channel: string | null;
}

// Hard cap on how many days a single request may span. dashboard_charts'
// trend CTE does generate_series(p_from, p_to, '1 day'), so an unbounded
// range from the URL (e.g. ?from=0001-01-01&to=9999-12-31) would materialize
// ~3.6M daily rows and hammer Postgres — a cheap DoS on an unauthenticated
// page. 400 covers a full year + buffer (the widest range the "ทั้งหมด"
// button ever sends is min→max order date, ~8 months today). Clamp `from`
// forward toward `to` rather than erroring, so the page still renders.
const MAX_RANGE_DAYS = 400;
const DAY_MS = 86_400_000;

// Shared validation for both RPCs below: from/to must both be well-formed
// "YYYY-MM-DD" (unlike getCrmOverview's from/to, which are individually
// optional and each fall back to "no bound", these RPC params are NOT
// nullable — p_from/p_to have no SQL default — so a malformed value here is
// a hard error, not a silent drop). channel is trimmed/empty-to-null only;
// the RPC itself treats an unknown code as "every channel" (see migration
// 0054 header), so there is nothing further to validate against here.
function validateRange(params: GetDashboardParams): ValidatedRange | null {
  if (!isValidDateStr(params.from) || !isValidDateStr(params.to)) return null;
  let from = params.from <= params.to ? params.from : params.to;
  const to = params.from <= params.to ? params.to : params.from;
  const spanDays = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
  if (spanDays > MAX_RANGE_DAYS) {
    from = new Date(Date.parse(`${to}T00:00:00Z`) - MAX_RANGE_DAYS * DAY_MS).toISOString().slice(0, 10);
  }
  const channel = params.channel?.trim() || null;
  return { from, to, channel };
}

function mapScope(raw: {
  min_order_date?: string | null;
  max_order_date?: string | null;
  channels?: { code: string; name: string }[];
  requested_from?: string | null;
  requested_to?: string | null;
  requested_channel?: string | null;
} | undefined): DashboardScope {
  return {
    minOrderDate: raw?.min_order_date ?? null,
    maxOrderDate: raw?.max_order_date ?? null,
    channels: (raw?.channels ?? []).map((c) => ({ code: c.code, name: c.name })),
    requestedFrom: raw?.requested_from ?? null,
    requestedTo: raw?.requested_to ?? null,
    requestedChannel: raw?.requested_channel ?? null,
  };
}

export async function getDashboard(params: GetDashboardParams): Promise<ActionResult<DashboardData>> {
  const range = validateRange(params);
  if (!range) {
    return { ok: false, error: "ช่วงวันที่ไม่ถูกต้อง" };
  }

  try {
    const shopId = getDevShopId();
    const includeMoney = getDevRole() !== "staff";
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("dashboard_summary", {
      p_shop_id: shopId,
      p_from: range.from,
      p_to: range.to,
      p_channel: range.channel,
      p_include_money: includeMoney,
    });
    if (error) throw error;

    const raw = (data ?? {}) as {
      scope?: {
        min_order_date?: string | null;
        max_order_date?: string | null;
        channels?: { code: string; name: string }[];
        requested_from?: string | null;
        requested_to?: string | null;
        requested_channel?: string | null;
      };
      kpi?: {
        revenue: number;
        orders: number;
        profit: number;
        aov: number;
        customers?: number;
        repeat_rate?: number;
      } | null;
      action?: { oversold: number; oversold_breached: number; low_stock: number };
      reco?: { title: string; severity: string; rule_code: string }[];
      rfm?: Record<string, number>;
      top_channel?: { channel_name: string; revenue: number; roas: number | null } | null;
    };

    const result: DashboardData = {
      kpi: raw.kpi
        ? {
            revenue: Number(raw.kpi.revenue) || 0,
            orders: Number(raw.kpi.orders) || 0,
            profit: Number(raw.kpi.profit) || 0,
            aov: Number(raw.kpi.aov) || 0,
            customers: Number(raw.kpi.customers) || 0,
            repeatRate: Number(raw.kpi.repeat_rate) || 0,
          }
        : null,
      action: {
        oversold: Number(raw.action?.oversold) || 0,
        oversoldBreached: Number(raw.action?.oversold_breached) || 0,
        lowStock: Number(raw.action?.low_stock) || 0,
      },
      reco: (raw.reco ?? []).map(
        (r): DashboardReco => ({ title: r.title, severity: r.severity, ruleCode: r.rule_code })
      ),
      rfm: raw.rfm ?? {},
      topChannel: raw.top_channel
        ? {
            channelName: raw.top_channel.channel_name,
            revenue: Number(raw.top_channel.revenue) || 0,
            roas: raw.top_channel.roas === null ? null : Number(raw.top_channel.roas),
          }
        : null,
      scope: mapScope(raw.scope),
    };

    return { ok: true, data: result };
  } catch (err) {
    console.error("getDashboard failed", err);
    return { ok: false, error: "โหลดหน้าแดชบอร์ดไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// getDashboardCharts — analytics.dashboard_charts (0044, range/channel-scoped
// since 0054). Separate RPC from dashboard_summary (loaded in parallel via
// Promise.all in page.tsx) so the chart payload doesn't bloat the KPI-row
// round trip. Same p_include_money gate as getDashboard: money sections
// (topSku/productMix/aovByChannel/salesByChannel, and salesTrend/weekday's
// revenue|aov fields) come back []/null from the RPC itself for staff —
// never stripped client-side.
export async function getDashboardCharts(params: GetDashboardParams): Promise<ActionResult<DashboardCharts>> {
  const range = validateRange(params);
  if (!range) {
    return { ok: false, error: "ช่วงวันที่ไม่ถูกต้อง" };
  }

  try {
    const shopId = getDevShopId();
    const includeMoney = getDevRole() !== "staff";
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("dashboard_charts", {
      p_shop_id: shopId,
      p_from: range.from,
      p_to: range.to,
      p_channel: range.channel,
      p_include_money: includeMoney,
    });
    if (error) throw error;

    const raw = (data ?? {}) as {
      coverage?: {
        orders_total: number;
        orders_with_items: number;
        items_pct: number;
        range_from: string | null;
        range_to: string | null;
      };
      top_sku?: { sku: string; name: string; revenue: number; qty: number }[];
      product_mix?: { bucket: string; label: string; revenue: number; pct: number }[];
      aov_by_channel?: {
        channel_code: string;
        channel_name: string;
        orders: number;
        revenue: number;
        aov: number;
      }[];
      new_returning?: { new: number; returning: number; unknown: number };
      sales_trend?: { date: string; revenue: number | null; orders: number; aov: number | null }[];
      weekday?: { dow: number; label: string; orders: number; revenue: number | null }[];
      sales_by_channel?: {
        channel_code: string;
        channel_name: string;
        revenue: number;
        orders: number;
        share_pct: number;
      }[];
    };

    const coverage: ChartCoverage = {
      ordersTotal: Number(raw.coverage?.orders_total) || 0,
      ordersWithItems: Number(raw.coverage?.orders_with_items) || 0,
      itemsPct: Number(raw.coverage?.items_pct) || 0,
      rangeFrom: raw.coverage?.range_from ?? null,
      rangeTo: raw.coverage?.range_to ?? null,
    };

    const topSku: HBarRow[] = (raw.top_sku ?? []).map((r) => ({
      label: r.name,
      value: Number(r.revenue) || 0,
      displayValue: formatTHBCompact(Number(r.revenue) || 0),
      sub: `${formatCount(Number(r.qty) || 0)} ชิ้น · ${r.sku}`,
    }));

    const productMix: MixSlice[] = (raw.product_mix ?? []).map((r) => ({
      bucket: r.bucket,
      label: r.label,
      revenue: Number(r.revenue) || 0,
      pct: Number(r.pct) || 0,
    }));

    const aovByChannel: HBarRow[] = (raw.aov_by_channel ?? []).map((r) => ({
      label: r.channel_name,
      value: Number(r.aov) || 0,
      displayValue: formatTHBCompact(Number(r.aov) || 0),
      sub: `${formatCount(Number(r.orders) || 0)} ออเดอร์`,
    }));

    const newReturning: NewReturning = {
      new: Number(raw.new_returning?.new) || 0,
      returning: Number(raw.new_returning?.returning) || 0,
      unknown: Number(raw.new_returning?.unknown) || 0,
    };

    const salesTrend: TrendPoint[] = (raw.sales_trend ?? []).map((p) => ({
      date: p.date,
      revenue: p.revenue === null || p.revenue === undefined ? null : Number(p.revenue),
      orders: Number(p.orders) || 0,
      aov: p.aov === null || p.aov === undefined ? null : Number(p.aov),
    }));

    const weekday: WeekdayPoint[] = (raw.weekday ?? []).map((w) => ({
      dow: Number(w.dow) || 0,
      label: w.label,
      orders: Number(w.orders) || 0,
      revenue: w.revenue === null || w.revenue === undefined ? null : Number(w.revenue),
    }));

    const salesByChannel: SalesByChannel[] = (raw.sales_by_channel ?? []).map((r) => ({
      channelCode: r.channel_code,
      channelName: r.channel_name,
      revenue: Number(r.revenue) || 0,
      orders: Number(r.orders) || 0,
      sharePct: Number(r.share_pct) || 0,
    }));

    const result: DashboardCharts = {
      coverage,
      topSku,
      productMix,
      aovByChannel,
      newReturning,
      salesTrend,
      weekday,
      salesByChannel,
    };

    return { ok: true, data: result };
  } catch (err) {
    console.error("getDashboardCharts failed", err);
    return { ok: false, error: "โหลดกราฟแดชบอร์ดไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
