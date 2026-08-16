"use server";

// lib/actions/tiktok-dashboard.ts — real-data replacement for
// lib/tiktok/mock-actions.ts's getDailyDashboard(), per design §5 "สลับไฟล์
// เดียว UI ไม่แก้": DailyDashboardData (lib/tiktok/types.ts) is unchanged, so
// components/domain/tiktok/DashboardPageClient.tsx only swaps its import.
//
// Single RPC round trip (analytics.tiktok_daily_dashboard, 0051) — same
// getServiceClient() + getDevShopId() + ActionResult<T> pattern as
// lib/actions/tiktok-sales.ts and lib/actions/dashboard.ts.
//
// SCOPE NOTE: this is an ALL-CHANNEL, single-day snapshot from
// analytics.fact_order (TikTok + Shopee + LINE mixed) — NOT TikTok-only,
// despite the page living under /tiktok. Confirmed by design.

import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId } from "@/lib/dev/context";
import type { ActionResult } from "@/lib/types";
import type { BreakdownRow, DailyDashboardData } from "@/lib/tiktok/types";
import { formatCount, formatTHBCompact } from "@/lib/tiktok/format";

const SCHEMA = "analytics";

// Not exercised by the current UI (no date filter wired up yet — see NOTE in
// DashboardPageClient), but `dateISO` is a public function param, so it gets
// the same defensive validation as tiktok-sales.ts's isValidDateStr rather
// than trusting an arbitrary string into the RPC's `date` param.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateStr(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

interface RawKpiPair {
  value: number;
  prev: number;
}

interface RawDashboard {
  date: string | null;
  has_data: boolean;
  kpis: {
    sales: RawKpiPair;
    orders: RawKpiPair;
    profit: RawKpiPair & { coverage_pct: number };
    aov: RawKpiPair;
  };
  data_quality: {
    cost_coverage_pct: number;
    province_unknown_pct: number;
    address_pending_review_count: number;
  };
  breakdown: {
    channel: { label: string; sales: number; orders: number; share_pct: number }[];
    province: { label: string; orders: number; is_unknown: boolean }[];
    top_products: { label: string; qty: number }[];
  };
}

/** Percent change vs the previous day. Returns `null` when prev<=0 but there
 * IS a value today ("up from zero" — yesterday had no orders): no finite % is
 * definable, so the KpiCard renders a "ใหม่" badge rather than a misleading
 * "0%". Both-zero days return 0 (genuinely flat). Never NaN/Infinity. */
function deltaPct(value: number, prev: number): number | null {
  if (prev > 0) return Math.round(((value - prev) / prev) * 100);
  if (value > 0) return null;
  return 0;
}

/** Trend is derived from the raw value-vs-prev direction, NOT from deltaPct —
 * so a jump from a zero baseline (deltaPct === null) still reads as "up", not
 * "flat". */
function trendOf(value: number, prev: number): "up" | "down" | "flat" {
  if (value > prev) return "up";
  if (value < prev) return "down";
  return "flat";
}

/** Guards every bar-chart share against division by zero (empty breakdown or
 * an all-zero day) — barPct is always a finite 0-100 integer. */
function barPct(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.round((100 * value) / max);
}

export async function getDailyDashboard(dateISO?: string): Promise<ActionResult<DailyDashboardData>> {
  if (dateISO !== undefined && !isValidDateStr(dateISO)) {
    return { ok: false, error: "วันที่ไม่ถูกต้อง" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("tiktok_daily_dashboard", {
      p_shop_id: shopId,
      p_date: dateISO ?? null,
    });
    if (error) throw error;

    const raw = data as RawDashboard;

    const salesValue = Number(raw.kpis.sales.value) || 0;
    const salesPrev = Number(raw.kpis.sales.prev) || 0;
    const salesDelta = deltaPct(salesValue, salesPrev);

    const ordersValue = Number(raw.kpis.orders.value) || 0;
    const ordersPrev = Number(raw.kpis.orders.prev) || 0;
    const ordersDelta = deltaPct(ordersValue, ordersPrev);

    const profitValue = Number(raw.kpis.profit.value) || 0;
    const profitPrev = Number(raw.kpis.profit.prev) || 0;
    const profitDelta = deltaPct(profitValue, profitPrev);
    const coveragePct = Number(raw.kpis.profit.coverage_pct) || 0;

    const aovValue = Number(raw.kpis.aov.value) || 0;
    const aovPrev = Number(raw.kpis.aov.prev) || 0;
    const aovDelta = deltaPct(aovValue, aovPrev);

    const channelRows = raw.breakdown.channel ?? [];
    const maxSales = channelRows.reduce((m, r) => Math.max(m, Number(r.sales) || 0), 0);
    const channel: BreakdownRow[] = channelRows.map((r) => {
      const sales = Number(r.sales) || 0;
      return {
        label: r.label,
        value: sales,
        displayValue: formatTHBCompact(sales),
        barPct: barPct(sales, maxSales),
        subLabel: `${Math.round(Number(r.share_pct) || 0)}%`,
      };
    });

    const provinceRows = raw.breakdown.province ?? [];
    const maxOrders = provinceRows.reduce((m, r) => Math.max(m, Number(r.orders) || 0), 0);
    const province: BreakdownRow[] = provinceRows.map((r) => {
      const orders = Number(r.orders) || 0;
      return {
        label: r.is_unknown ? "ไม่ระบุ" : r.label,
        value: orders,
        displayValue: formatCount(orders),
        barPct: barPct(orders, maxOrders),
        isUnknown: r.is_unknown,
      };
    });

    const topProductRows = raw.breakdown.top_products ?? [];
    const maxQty = topProductRows.reduce((m, r) => Math.max(m, Number(r.qty) || 0), 0);
    const topProducts: BreakdownRow[] = topProductRows.map((r) => {
      const qty = Number(r.qty) || 0;
      return {
        label: r.label,
        value: qty,
        displayValue: `${qty} ชิ้น`,
        barPct: barPct(qty, maxQty),
      };
    });

    const result: DailyDashboardData = {
      // Falls back to "" (never throws) when the shop has zero orders ever
      // (RPC returns date:null, has_data:false) — DashboardPageClient's
      // existing empty-day branch keys off kpis.orderCount.value === 0, not
      // this field, so an empty string here is safe.
      date: raw.date ?? "",
      kpis: {
        salesToday: {
          label: "ยอดขายวันนี้",
          value: salesValue,
          displayValue: formatTHBCompact(salesValue),
          deltaPct: salesDelta,
          trend: trendOf(salesValue, salesPrev),
        },
        orderCount: {
          label: "จำนวนออเดอร์",
          value: ordersValue,
          displayValue: formatCount(ordersValue),
          deltaPct: ordersDelta,
          trend: trendOf(ordersValue, ordersPrev),
        },
        profitEstimate: {
          label: "กำไรโดยประมาณ",
          value: profitValue,
          displayValue: formatTHBCompact(profitValue),
          deltaPct: profitDelta,
          trend: trendOf(profitValue, profitPrev),
          coveragePct,
        },
        aov: {
          label: "ยอดเฉลี่ย/ออเดอร์",
          value: aovValue,
          displayValue: formatTHBCompact(aovValue),
          deltaPct: aovDelta,
          trend: trendOf(aovValue, aovPrev),
        },
      },
      dataQuality: {
        costCoveragePct: Number(raw.data_quality.cost_coverage_pct) || 0,
        provinceUnknownPct: Number(raw.data_quality.province_unknown_pct) || 0,
        addressPendingReviewCount: Number(raw.data_quality.address_pending_review_count) || 0,
      },
      breakdown: {
        channel,
        province,
        // TECHNICAL DEBT: analytics.fact_order has no address_type column
        // (no source data for it yet) — always empty; BreakdownTabs/
        // BreakdownPanel already render an empty state for this dimension.
        addressType: [],
        topProducts,
      },
    };

    return { ok: true, data: result };
  } catch (err) {
    console.error("getDailyDashboard failed", err);
    return { ok: false, error: "โหลดข้อมูลแดชบอร์ดรายวันไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
