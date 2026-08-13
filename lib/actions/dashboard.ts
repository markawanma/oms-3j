"use server";

// lib/actions/dashboard.ts — Home/Dashboard (docs/3j-jewelry/design/ui-refresh-
// plan.md §1). Single RPC analytics.dashboard_summary aggregates everything.
// NOT owner/admin gated: staff may see the dashboard, but the money sections
// (KPI/reco/RFM/channel) are stripped by passing p_include_money=false — the
// RPC returns them null/empty for staff, so no revenue/profit ever reaches a
// staff session.

import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId, getDevRole } from "@/lib/dev/context";
import type { ActionResult } from "@/lib/types";
import type {
  DashboardData,
  DashboardPeriod,
  DashboardReco,
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
      kpi?: { revenue: number; orders: number; profit: number; aov: number } | null;
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
