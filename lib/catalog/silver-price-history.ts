// lib/catalog/silver-price-history.ts — types for /catalog/silver-price,
// backed by analytics.silver_price_history (supabase/migrations/
// 0102_silver_price_history.sql). Kept OUT of the "use server" actions file
// (which may only export async fns), same split as lib/catalog/types.ts.
//
// This page is an INTERNAL app screen (owner/staff only, behind the same
// dashboard auth every other /catalog/* page is behind) — unlike the future
// public Wix page (which reads analytics.v_silver_price_public_14d and must
// NEVER see the internal fields below), this type intentionally includes
// internal cost/margin columns because the brief calls for showing them
// here ("แอปภายใน — โชว์ชั้นภายในได้"). Do NOT reuse this type for anything
// that renders outside the dashboard.

/** One capture row — public columns + the specific internal columns this
 * internal-only page is allowed to show (เนื้อเงิน/บาท, ค่าบล๊อค 1 บาท,
 * Shopee 1 บาท per the brief's table spec). Every other internal column
 * that exists in the DB (usd_*, block_fee_0_5/3/5/10, margin_component_*,
 * shopee_0_5/3/5/10) is deliberately NOT selected by getSilverPriceHistory —
 * "select only what the screen shows" keeps the set of internal data this
 * page's query surface can leak (e.g. via a future bug) as small as possible. */
export interface SilverPriceHistoryRow {
  id: string;
  capturedAt: string;
  /** 🔴 internal — "เนื้อเงิน/บาท" ในตาราง */
  silverValuePerBaht: number | null;
  /** 🟢 public — ราคาแท่ง 1 บาท */
  sell1: number | null;
  buy1: number | null;
  /** 🟢 public — แท่ง 1 กิโลกรัม */
  kiloSell: number | null;
  kiloBuy: number | null;
  /** 🔴 internal — ค่าบล๊อคของแท่ง 1 บาท */
  blockFee1: number | null;
  /** 🔴 internal — ราคาที่ตั้งขายบน Shopee ของแท่ง 1 บาท */
  shopee1: number | null;
}

/** Direction of change vs. the previous capture — drives the stat-bar
 * green/red coloring the brief asks for explicitly (a deliberate exception
 * to the "no red for down" KPI-card convention elsewhere in this app: that
 * rule is about order-count trend not being an error state, this is a price
 * ticker where up/down green/red is the standard convention and the owner
 * asked for it by name). */
export type PriceChangeDirection = "up" | "down" | "flat" | "unknown";

export interface PriceChangeSummary {
  latest: number | null;
  previous: number | null;
  deltaAbs: number | null;
  deltaPct: number | null;
  direction: PriceChangeDirection;
}
