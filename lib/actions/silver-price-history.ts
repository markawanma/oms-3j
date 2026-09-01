"use server";

// lib/actions/silver-price-history.ts — read layer for /catalog/silver-price
// (supabase/migrations/0102_silver_price_history.sql). Read-only: this page
// has no write action — rows come exclusively from
// scripts/capture-silver-price-sheet.mjs / scripts/scrape-silver-price.mjs
// running as a scheduled task (service-role client, outside this app).
//
// Owner/admin gate (security audit fix, 0901): the internal columns
// returned here (silver_value_per_baht, block_fee_1, shopee_1) are cost
// numbers, same class as lib/actions/catalog.ts's cost/margin fields and
// lib/actions/oem.ts's rate data — every other action in this app that
// touches cost/margin gates on requireOwnerAdmin(), this one was the sole
// exception. The comment this replaced claimed the same posture as
// listSkuPrefixes in lib/actions/catalog-sku.ts; that was wrong —
// listSkuPrefixes returns only SKU prefix codes, never a cost figure.

import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId, getDevRole } from "@/lib/dev/context";
import type { ActionResult } from "@/lib/types";
import type { SilverPriceHistoryRow } from "@/lib/catalog/silver-price-history";

const SCHEMA = "analytics";

function requireOwnerAdmin(): ActionResult<never> | null {
  if (getDevRole() === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูประวัติราคาเนื้อเงินได้" };
  }
  return null;
}

// 90 days is a fixed, bounded window (per brief: "จำกัด 90 วันล่าสุดพอ ไม่ต้อง
// unbounded") — no lib/supabase/query-limits.ts fetchAllRows() needed. Even
// at 3 captures/day (the busiest cadence scripts/run-silver-price.bat's
// scheduled task uses) that's ≤270 rows, safely under PostgREST's 1000-row
// cap — LIMIT below is a defensive ceiling, not the expected path.
const WINDOW_DAYS = 90;
const ROW_LIMIT = 1000;

function toNum(v: number | string | null): number | null {
  return v === null ? null : Number(v);
}

export async function getSilverPriceHistory(): Promise<ActionResult<SilverPriceHistoryRow[]>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("silver_price_history")
      .select("id, captured_at, silver_value_per_baht, sell_1, buy_1, kilo_sell, kilo_buy, block_fee_1, shopee_1")
      .eq("shop_id", shopId)
      .gte("captured_at", cutoff)
      .order("captured_at", { ascending: false })
      .order("id", { ascending: false }) // deterministic tie-break for equal-timestamp rows
      .limit(ROW_LIMIT);
    if (error) throw error;

    const rows: SilverPriceHistoryRow[] = (
      (data ?? []) as {
        id: string;
        captured_at: string;
        silver_value_per_baht: number | string | null;
        sell_1: number | string | null;
        buy_1: number | string | null;
        kilo_sell: number | string | null;
        kilo_buy: number | string | null;
        block_fee_1: number | string | null;
        shopee_1: number | string | null;
      }[]
    ).map((r) => ({
      id: r.id,
      capturedAt: r.captured_at,
      silverValuePerBaht: toNum(r.silver_value_per_baht),
      sell1: toNum(r.sell_1),
      buy1: toNum(r.buy_1),
      kiloSell: toNum(r.kilo_sell),
      kiloBuy: toNum(r.kilo_buy),
      blockFee1: toNum(r.block_fee_1),
      shopee1: toNum(r.shopee_1),
    }));

    return { ok: true, data: rows };
  } catch (err) {
    console.error("getSilverPriceHistory failed", err);
    return { ok: false, error: "โหลดประวัติราคาเงินไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
