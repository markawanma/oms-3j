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
import { getDevShopId, getDevRole } from "@/lib/dev/context";
import type { ActionResult } from "@/lib/types";
import type { BreakdownRow, DailyDashboardData, DashboardMeta } from "@/lib/tiktok/types";
import { formatCount, formatTHBCompact, effectiveDateBangkok } from "@/lib/tiktok/format";

const SCHEMA = "analytics";

// `dateISO` is driven by DashboardDateFilter's `?date=` query param (via
// DashboardPageClient), so it's untrusted input by the time it reaches here —
// same defensive validation as tiktok-sales.ts's isValidDateStr rather than
// trusting an arbitrary string into the RPC's `date` param.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// "Day might be incomplete" cutoff (design handoff, date-picker chunk): a
// business day is only treated as fully imported once the data-import
// timestamp reaches this Bangkok hour. Import files are typically exported
// midday, well before the 20:00-23:00 TikTok live window that drives most of
// a day's orders — so every "today" view is incomplete until the next day's
// import lands. 23 (not 24) because a same-day import at say 23:05 is close
// enough to day-close to trust.
const DAY_COMPLETE_HOUR = 23;

// `s: unknown` (not `string`) because RegExp#test() coerces its argument to
// a string — DATE_RE.test(["2026-08-21"]) is `true` at runtime even though
// TS's `string` parameter type claims that can't happen (the caller's own
// `dateISO?: string` type is only as honest as whatever produced it; see
// searchParams handling in the dashboard page). The explicit `typeof`
// check below is the actual guard; the type predicate lets callers narrow.
//
// The round-trip re-format (`toISOString().slice(0, 10) === s`) closes the
// other hole: `new Date("2026-02-30T00:00:00Z")` rolls over to 2026-03-02
// instead of returning NaN, so a naive Number.isNaN check alone would let
// impossible calendar days (2026-02-30, 2026-04-31, 2026-06-31, ...) through
// to the RPC, where they'd fail as a generic Postgres error instead of this
// function's intended "วันที่ไม่ถูกต้อง" message.
function isValidDateStr(s: unknown): s is string {
  if (typeof s !== "string") return false;
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;
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
  // Optional: 0070 adds this alongside the rest of the payload. Until that
  // migration ships (or for any RPC row from before it), `meta` is simply
  // absent — every read below goes through `raw.meta?.x`, never a bare
  // `raw.meta.x`, so this file doesn't create a hard dependency on a
  // migration file this chunk is explicitly told not to touch.
  meta?: {
    min_order_date: string | null;
    max_order_date: string | null;
    /** Shop-wide import horizon (max order_created_at across EVERY imported
     * day, not just `date` above) — see 0070's header for why this (not
     * last_order_at) is the right signal for "is `date` possibly stale":
     * once the horizon has moved past `date`, a later import would already
     * have picked up any of `date`'s late orders. */
    data_through: string | null;
    /** Last order timestamp within `date` specifically. Not consumed here —
     * 0070 exposes it for a future "ข้อมูลถึง 15:29 น." per-day label, but
     * this round's warning text is built from data_through only (design
     * handoff), so this field is typed for documentation, not mapped into
     * DashboardMeta. */
    last_order_at: string | null;
  } | null;
}

/**
 * Computes the "day might be incomplete" signal server-side (design handoff:
 * "ไม่ใช่ใน component") so DashboardPageClient only ever renders a boolean +
 * a ready-made label, never re-derives the Bangkok-hour cutoff rule itself.
 *
 * Fail-quiet by design: a null/unparseable `dataThroughISO` returns
 * `{ isPossiblyIncomplete: false }` rather than guessing — better to stay
 * silent than to warn off bad input.
 */
function computeIncompleteness(
  dataThroughISO: string | null,
  viewedDate: string | null,
  maxOrderDate: string | null
): Pick<DashboardMeta, "isPossiblyIncomplete" | "incompleteLabel"> {
  const NOT_INCOMPLETE = { isPossiblyIncomplete: false, incompleteLabel: null };
  if (!dataThroughISO || !viewedDate) return NOT_INCOMPLETE;

  // A day strictly past the last day with any order data has no data and
  // never will (by definition — see minDate/maxDate's own docstring) — e.g.
  // ?date=2027-01-01 with maxOrderDate somewhere in 2026. Warning "อาจยังไม่
  // ครบวัน" there would contradict the empty state's own "0 ตามจริง (ไม่ใช่
  // error)" message right below it. `viewedDate === maxOrderDate` (today,
  // with some orders already in but import still pending) is deliberately
  // NOT covered by this early-out — that's exactly the case this warning
  // exists for.
  if (maxOrderDate && viewedDate > maxOrderDate) return NOT_INCOMPLETE;

  const d = new Date(dataThroughISO);
  if (Number.isNaN(d.getTime())) return NOT_INCOMPLETE;

  const throughDate = effectiveDateBangkok(dataThroughISO);
  const throughHour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", hour12: false }).format(d)
  );

  const isPossiblyIncomplete = throughDate < viewedDate || (throughDate === viewedDate && throughHour < DAY_COMPLETE_HOUR);
  if (!isPossiblyIncomplete) return NOT_INCOMPLETE;

  const throughTimeLabel = new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);

  return {
    isPossiblyIncomplete: true,
    // States the import time as fact, not a verdict (design handoff) — even
    // wrong on a genuinely quiet night, this sentence stays true.
    incompleteLabel: `ข้อมูลอาจยังไม่ครบวัน — นำเข้าล่าสุดถึง ${throughTimeLabel} (ช่วงไลฟ์ 20:00–23:00 อาจยังไม่ถูกนับ)`,
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
  // Security gate: unlike getDashboard/getDashboardCharts (lib/actions/
  // dashboard.ts), this action has no p_include_money toggle — the RPC
  // always returns sales/profit figures, and getServiceClient() below
  // bypasses RLS entirely. Staff must not reach this money data at all, so
  // the check happens before the shop/client lookup, not as a field-level
  // filter after the fact.
  if (getDevRole() === "staff") {
    return { ok: false, error: "ไม่มีสิทธิ์ดูข้อมูลนี้" };
  }

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

    // meta is entirely optional (raw.meta may not exist pre-0070) — every
    // field defaults to null/false rather than throwing, so an RPC without
    // `meta` degrades to "no clamp, no incomplete-day warning", not a crash.
    const meta: DashboardMeta | undefined = raw.meta
      ? {
          minDate: raw.meta.min_order_date ?? null,
          maxDate: raw.meta.max_order_date ?? null,
          dataThrough: raw.meta.data_through ?? null,
          ...computeIncompleteness(raw.meta.data_through ?? null, raw.date ?? null, raw.meta.max_order_date ?? null),
        }
      : undefined;

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
      meta,
    };

    return { ok: true, data: result };
  } catch (err) {
    console.error("getDailyDashboard failed", err);
    return { ok: false, error: "โหลดข้อมูลแดชบอร์ดรายวันไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
