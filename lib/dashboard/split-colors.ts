// lib/dashboard/split-colors.ts — single source of truth for color/label/
// order used by the /dashboard trend-split UI (0119, "แบ่งสีแท่งกราฟยอดขาย
// รายวัน", design approved by architect 14 ก.ย. 69). TrendChart imports these
// to render the stacked bars + legend; nothing else should define a second
// copy of any of these maps.
//
// Also home for BUCKET_COLOR (moved here from
// app/(dashboard)/dashboard/page.tsx, which now imports it back) — the
// product-mix donut and the trend-split "product" mode share the exact same
// 4 buckets/colors, so this is the one place both read from.
//
// Colors/labels are plain `Record<string, string>` (not keyed by a literal
// union) on purpose, same convention as lib/dashboard/channel-colors.ts:
// TrendSplitKey (lib/dashboard/types.ts) is a plain string coming straight
// off the DB, so any lookup here has to tolerate an unrecognized key without
// a TS error — components fall back to the `unknown` entry, never throw.

import { SEGMENT_LABEL_SHORT_TH } from "@/lib/crm/segments";

// ---------------------------------------------------------------------------
// ซื้อครั้งแรก / ซื้อซ้ำ (first_repeat split) — same red/blue pairing as the
// "ลูกค้าใหม่ vs ลูกค้าเก่า" donut already on this page, so the two charts
// read as the same concept.
// ---------------------------------------------------------------------------
export const FIRST_REPEAT_COLOR: Record<string, string> = {
  first: "#a2191d",
  repeat: "#0ea5e9",
  unknown: "#a1a1aa",
};

export const FIRST_REPEAT_LABEL: Record<string, string> = {
  first: "ซื้อครั้งแรก",
  repeat: "ซื้อซ้ำ",
  unknown: "ไม่ระบุ",
};

// Canonical stack order (bottom → up) and legend order — same order both
// places, per design.
export const FIRST_REPEAT_ORDER: string[] = ["first", "repeat", "unknown"];

// ---------------------------------------------------------------------------
// กลุ่มลูกค้า RFM (rfm split, segment ณ วันนี้ — ไม่ใช่ ณ วันที่ซื้อ, see the
// mandatory legend note in TrendChart). Deliberately NOT brand red (#a2191d)
// for at_risk: the "ไม่แบ่ง" (unsplit) bar already IS that color, so reusing
// it for one segment inside a split bar would read as "this whole bar is
// at_risk" at a glance.
//
// `no_orders` is part of RfmSegment (lib/crm/segments.ts) but structurally
// CANNOT appear in this split: split_rfm (migration 0119) only groups rows
// from `ord` (orders that exist in the selected range) joined to
// v_rfm_segment — a customer with an order in-range cannot be classified
// no_orders (that segment means zero orders, ever). Kept here anyway (mapped
// to the same gray as unknown) purely so this Record's key-set matches
// RfmSegment exactly — it will just never be looked up in practice.
// ---------------------------------------------------------------------------
export const RFM_COLOR: Record<string, string> = {
  champion: "#f59e0b",
  loyal: "#059669",
  new: "#2563eb",
  standard: "#cbd5e1",
  at_risk: "#991b1b",
  no_orders: "#a1a1aa",
  unknown: "#a1a1aa",
};

export const RFM_SPLIT_LABEL: Record<string, string> = {
  ...SEGMENT_LABEL_SHORT_TH,
  unknown: "ไม่ระบุ",
};

// 6 groups (champion/loyal/new/standard/at_risk/unknown) — `no_orders`
// excluded on purpose, see the comment on RFM_COLOR above.
export const RFM_ORDER: string[] = ["champion", "loyal", "new", "standard", "at_risk", "unknown"];

// ---------------------------------------------------------------------------
// ประเภทสินค้า (product split) — moved from app/(dashboard)/dashboard/
// page.tsx's old local BUCKET_COLOR (0044). Labels mirror the exact Thai
// strings the `dashboard_charts` RPC already returns for product_mix (see
// migration's `mix` CTE) so the trend-split legend and the Product Mix donut
// never disagree on what a bucket is called.
// ---------------------------------------------------------------------------
export const BUCKET_COLOR: Record<string, string> = {
  silver_bar: "#a2191d", // primary-600
  jewelry: "#d97706", // amber-600
  art_toy: "#7c3aed", // violet-600
  other: "#a1a1aa", // zinc-400
};

export const BUCKET_LABEL: Record<string, string> = {
  silver_bar: "เงินแท่ง",
  jewelry: "เครื่องเงิน 925",
  art_toy: "Art Toy เงิน",
  other: "อื่นๆ",
};

export const BUCKET_ORDER: string[] = ["silver_bar", "jewelry", "art_toy", "other"];
