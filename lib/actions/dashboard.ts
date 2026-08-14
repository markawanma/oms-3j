"use server";

// lib/actions/dashboard.ts — Home/Dashboard (docs/3j-jewelry/design/ui-refresh-
// plan.md §1). Single RPC analytics.dashboard_summary aggregates everything.
// NOT owner/admin gated: staff may see the dashboard, but the money sections
// (KPI/reco/RFM/channel) are stripped by passing p_include_money=false — the
// RPC returns them null/empty for staff, so no revenue/profit ever reaches a
// staff session.

import { getServiceClient } from "@/lib/supabase/server";
import { formatCount, formatTHBCompact } from "@/lib/tiktok/format";
import { getDevShopId, getDevRole } from "@/lib/dev/context";
import type { ActionResult } from "@/lib/types";
import type {
  ChartCoverage,
  DashboardCharts,
  DashboardData,
  DashboardPeriod,
  DashboardReco,
  HBarRow,
  MixSlice,
  NewReturning,
  TrendPoint,
  WeekdayPoint,
} from "@/lib/dashboard/types";
import { toDashboardPeriod } from "@/lib/dashboard/types";

const SCHEMA = "analytics";

export async function getDashboard(period: DashboardPeriod): Promise<ActionResult<DashboardData>> {
  try {
    const shopId = getDevShopId();
    const includeMoney = getDevRole() !== "staff";
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("dashboard_summary", {
      p_shop_id: shopId,
      p_period: period,
      p_include_money: includeMoney,
    });
    if (error) throw error;

    const raw = (data ?? {}) as {
      period?: string;
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
      period: toDashboardPeriod(raw.period),
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
    };

    return { ok: true, data: result };
  } catch (err) {
    console.error("getDashboard failed", err);
    return { ok: false, error: "โหลดหน้าแดชบอร์ดไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// getDashboardCharts — analytics.dashboard_charts (0044), see design §1b/§5.
// Separate RPC from dashboard_summary (loaded in parallel via Promise.all in
// page.tsx) so the 6-chart payload doesn't bloat the KPI-row round trip.
// Same p_include_money gate as getDashboard: money sections (topSku/
// productMix/aovByChannel, salesTrend/weekday revenue|aov) come back []/null
// from the RPC itself for staff — never stripped client-side.
export async function getDashboardCharts(period: DashboardPeriod): Promise<ActionResult<DashboardCharts>> {
  try {
    const shopId = getDevShopId();
    const includeMoney = getDevRole() !== "staff";
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("dashboard_charts", {
      p_shop_id: shopId,
      p_period: period,
      p_include_money: includeMoney,
    });
    if (error) throw error;

    const raw = (data ?? {}) as {
      period?: string;
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

    const result: DashboardCharts = {
      period: toDashboardPeriod(raw.period),
      coverage,
      topSku,
      productMix,
      aovByChannel,
      newReturning,
      salesTrend,
      weekday,
    };

    return { ok: true, data: result };
  } catch (err) {
    console.error("getDashboardCharts failed", err);
    return { ok: false, error: "โหลดกราฟแดชบอร์ดไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
