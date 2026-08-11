"use server";

// lib/actions/tiktok-sales.ts — the one REAL data action behind the TikTok
// Ops "sales" page (design §3). Everything else in the module (dashboard,
// copilot, upload) is fixture-backed (lib/tiktok/mock-actions.ts) until an
// analytics DB exists — this action intentionally follows the exact same
// service-client + getDevShopId() + ActionResult<T> pattern as
// lib/actions/orders.ts so it's a drop-in sibling, not a new pattern.
//
// HONEST SCOPE NOTE (design §3): `orders` only ever contains Shopee/TikTok
// rows (seeded channels, see 0001_core_schema.sql) — LINE sales (the bulk of
// H1's ฿19.8M per docs/3j-jewelry/analytics/sales-2026-h1-summary.md) are
// NOT in this table and CANNOT be reconstructed here. This action's output
// is marketplace-only; the UI is required to render the scope label so
// numbers here don't get silently compared against the H1 file and look
// "wrong".

import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId } from "@/lib/dev/context";
import type { ActionResult, ChannelCode, OrderStatus } from "@/lib/types";
import type {
  ChannelSalesBreakdown,
  SalesGranularity,
  SalesPeriodPoint,
  SalesSummary,
} from "@/lib/tiktok/types";
import { effectiveDateBangkok } from "@/lib/tiktok/format";

export interface GetSalesSummaryParams {
  /** "YYYY-MM-DD", inclusive. */
  from: string;
  /** "YYYY-MM-DD", inclusive. */
  to: string;
  granularity: SalesGranularity;
}

// Statuses excluded from "ยอดขาย" per design §3 decision (confirmed default,
// not yet re-confirmed by owner — flagged in handoff): cancelled orders never
// happened; oversold_hold orders never actually reserved/shipped stock, so
// counting them as sales would overstate revenue for orders that may still
// end up cancelled or re-mapped.
const EXCLUDED_STATUSES: OrderStatus[] = ["cancelled", "oversold_hold"];

// The DB filter is deliberately wider than the requested [from, to] window
// (design §3: "filter DB บน created_at กว้างแล้วกรองละเอียด JS") — placed_at
// (the field we actually bucket/filter on) can differ from created_at by a
// few days in edge cases (e.g. a delayed webhook backfilling an older order),
// so we over-fetch on created_at and then apply the precise date filter on
// the effective date (placed_at ?? created_at) in JS. 3 days each side is a
// generous margin at current order volume (~700/month, see design §3 debt
// note on JS aggregation not yet needing a SQL function).
const BUCKET_FETCH_MARGIN_DAYS = 3;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateStr(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function bucketKey(effectiveDate: string, granularity: SalesGranularity): string {
  return granularity === "month" ? effectiveDate.slice(0, 7) : effectiveDate;
}

/** Generates every bucket key in [from, to] so the summary has zero-filled
 * points for empty buckets (chart continuity) instead of gaps. */
function enumerateBuckets(from: string, to: string, granularity: SalesGranularity): string[] {
  const keys: string[] = [];
  if (granularity === "day") {
    let cur = from;
    // Bounded loop guard: a shop querying a multi-year range would otherwise
    // let a malformed date pair spin forever.
    let guard = 0;
    while (cur <= to && guard < 3660) {
      keys.push(cur);
      cur = addDays(cur, 1);
      guard++;
    }
  } else {
    let [y, m] = from.split("-").map(Number);
    const [toY, toM] = to.split("-").map(Number);
    let guard = 0;
    while ((y < toY || (y === toY && m <= toM)) && guard < 600) {
      keys.push(`${y}-${String(m).padStart(2, "0")}`);
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
      guard++;
    }
  }
  return keys;
}

function emptySummary(params: GetSalesSummaryParams, scopeChannels: ChannelCode[], firstOrderDate: string | null): SalesSummary {
  const points: SalesPeriodPoint[] = enumerateBuckets(params.from, params.to, params.granularity).map((period) => ({
    period,
    sales: 0,
    orders: 0,
    aov: 0,
    byChannel: [],
  }));
  return {
    granularity: params.granularity,
    points,
    totals: { sales: 0, orders: 0, aov: 0 },
    scope: {
      channels: scopeChannels,
      firstOrderDate,
      requestedFrom: params.from,
      requestedTo: params.to,
    },
  };
}

export async function getSalesSummary(params: GetSalesSummaryParams): Promise<ActionResult<SalesSummary>> {
  if (!isValidDateStr(params.from) || !isValidDateStr(params.to)) {
    return { ok: false, error: "ช่วงวันที่ไม่ถูกต้อง" };
  }
  if (params.granularity !== "day" && params.granularity !== "month") {
    return { ok: false, error: "granularity ไม่ถูกต้อง" };
  }
  // Swap if reversed rather than erroring — the sales page's date presets
  // (Q1/Q2/all) never send a reversed range, but a manually-typed <input
  // type=month> pair could.
  const from = params.from <= params.to ? params.from : params.to;
  const to = params.from <= params.to ? params.to : params.from;

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    // Channel scope: whichever channels this shop actually has a
    // channel_account for (marketplace only — no LINE, see module header).
    const { data: accounts, error: accountsErr } = await supabase
      .from("channel_account")
      .select("id, channel:channel_id(code)")
      .eq("shop_id", shopId);
    if (accountsErr) throw accountsErr;
    const accountMap = new Map<string, ChannelCode>(
      (accounts ?? []).map((a: any) => [a.id as string, a.channel?.code as ChannelCode])
    );
    const scopeChannels = Array.from(new Set(accountMap.values())).sort();

    // First order date for this shop, across all time (not just the
    // requested window) — used by the UI's scope label ("ข้อมูลจาก OMS ...
    // ตั้งแต่ [วันแรก]").
    // NOTE (L1, approximate by design): ordered by created_at (indexed,
    // monotonic insert order) but the label below is derived from placed_at
    // ?? created_at — for the rare order where placed_at was backfilled
    // earlier/later than its created_at (e.g. delayed webhook), the "first"
    // row by created_at may not be the row with the single earliest placed_at.
    // Off by at most a few days at current volume; not worth a second query
    // for a label-only value.
    const { data: firstOrderRow, error: firstOrderErr } = await supabase
      .from("orders")
      .select("placed_at, created_at")
      .eq("shop_id", shopId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (firstOrderErr) throw firstOrderErr;
    const firstOrderDate = firstOrderRow
      ? effectiveDateBangkok(firstOrderRow.placed_at ?? firstOrderRow.created_at)
      : null;

    if (accountMap.size === 0) {
      // No channel_account at all for this shop -> no orders possible.
      return { ok: true, data: emptySummary({ from, to, granularity: params.granularity }, scopeChannels, firstOrderDate) };
    }

    const dbFrom = `${addDays(from, -BUCKET_FETCH_MARGIN_DAYS)}T00:00:00.000Z`;
    const dbTo = `${addDays(to, BUCKET_FETCH_MARGIN_DAYS)}T23:59:59.999Z`;

    const { data, error } = await supabase
      .from("orders")
      .select("placed_at, created_at, total_amount, status, channel_account_id")
      .eq("shop_id", shopId)
      .gte("created_at", dbFrom)
      .lte("created_at", dbTo)
      .not("status", "in", `(${EXCLUDED_STATUSES.join(",")})`);
    if (error) throw error;

    const rows = data ?? [];
    if (rows.length === 0) {
      return { ok: true, data: emptySummary({ from, to, granularity: params.granularity }, scopeChannels, firstOrderDate) };
    }

    // period -> channel -> { sales, orders }
    const buckets = new Map<string, Map<ChannelCode, { sales: number; orders: number }>>();
    let totalSales = 0;
    let totalOrders = 0;

    for (const r of rows as any[]) {
      const effDate = effectiveDateBangkok(r.placed_at ?? r.created_at);
      // Precise range filter (the DB query above is intentionally wider —
      // see BUCKET_FETCH_MARGIN_DAYS comment).
      if (effDate < from || effDate > to) continue;

      // M2 (security/correctness): channel_account_id must resolve to a real
      // channel this shop owns — silently defaulting to "shopee" here would
      // corrupt the channel mix (misattributing e.g. orphaned/other-shop
      // rows as Shopee sales). Skip the row instead; this should be rare
      // (accountMap is built from this shop's own channel_account rows
      // above) so a warn is enough to catch it if it ever isn't.
      const channelCode = accountMap.get(r.channel_account_id);
      if (!channelCode) {
        console.warn("getSalesSummary: skipping order with unresolved channel_account_id", {
          shopId,
          channelAccountId: r.channel_account_id,
        });
        continue;
      }
      const key = bucketKey(effDate, params.granularity);
      const amount = Number(r.total_amount) || 0;

      if (!buckets.has(key)) buckets.set(key, new Map());
      const channelMap = buckets.get(key)!;
      const cur = channelMap.get(channelCode) ?? { sales: 0, orders: 0 };
      cur.sales += amount;
      cur.orders += 1;
      channelMap.set(channelCode, cur);

      totalSales += amount;
      totalOrders += 1;
    }

    // Zero-fill every bucket in range so the chart has no gaps, then overlay
    // the aggregated ones.
    const allKeys = enumerateBuckets(from, to, params.granularity);
    const points: SalesPeriodPoint[] = allKeys.map((period) => {
      const channelMap = buckets.get(period);
      if (!channelMap) {
        return { period, sales: 0, orders: 0, aov: 0, byChannel: [] };
      }
      let periodSales = 0;
      let periodOrders = 0;
      const byChannel: ChannelSalesBreakdown[] = Array.from(channelMap.entries())
        .map(([channelCode, v]) => {
          periodSales += v.sales;
          periodOrders += v.orders;
          return { channelCode, sales: v.sales, orders: v.orders };
        })
        .sort((a, b) => b.sales - a.sales);
      return {
        period,
        sales: periodSales,
        orders: periodOrders,
        aov: periodOrders > 0 ? Math.round(periodSales / periodOrders) : 0,
        byChannel,
      };
    });

    return {
      ok: true,
      data: {
        granularity: params.granularity,
        points,
        totals: {
          sales: totalSales,
          orders: totalOrders,
          aov: totalOrders > 0 ? Math.round(totalSales / totalOrders) : 0,
        },
        scope: {
          channels: scopeChannels,
          firstOrderDate,
          requestedFrom: from,
          requestedTo: to,
        },
      },
    };
  } catch (err) {
    console.error("getSalesSummary failed", err);
    return { ok: false, error: "โหลดข้อมูลยอดขายไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
