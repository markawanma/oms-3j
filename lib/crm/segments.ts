// lib/crm/segments.ts — RFM segment enum + display labels shared by CRM server
// actions and client components. Kept OUT of lib/actions/crm.ts because that
// file is "use server" and a "use server" module may only export async
// functions — exporting these runtime const values from it is a Next.js build
// error (invalid-use-server-value). Types + plain data live here instead.

export type RfmSegment = "champion" | "loyal" | "new" | "standard" | "at_risk" | "no_orders";

export const RFM_SEGMENTS: RfmSegment[] = ["champion", "loyal", "new", "standard", "at_risk", "no_orders"];

export const SEGMENT_LABEL_TH: Record<RfmSegment, string> = {
  champion: "ลูกค้าชั้นดี",
  loyal: "ลูกค้าประจำ",
  new: "ลูกค้าใหม่",
  standard: "ทั่วไป",
  at_risk: "เสี่ยงหาย (เงียบ >90 วัน)",
  no_orders: "ยังไม่มีออเดอร์",
};

export const SEGMENT_DESC_TH: Record<RfmSegment, string> = {
  champion: "ซื้อใน 30 วัน · ≥4 ออเดอร์ · ยอด >฿1,500 — รักษาไว้/upsell",
  loyal: "ซื้อซ้ำ ≥2 ออเดอร์ ใน 90 วัน — ดันให้ขึ้นชั้นดี",
  new: "เพิ่งซื้อครั้งแรก (ใน 30 วัน) — ทำให้ซื้อครั้งที่ 2",
  standard: "ซื้อบ้าง ความถี่/ยอดน้อย — nurture ทั่วไป",
  at_risk: "เงียบเกิน 90 วัน — ยิง win-back",
  no_orders: "มีชื่อในระบบแต่ยังไม่เคยซื้อ",
};

// value_tier — sub-split of segment='champion' only (migration
// 0055_crm_province_champion_tier.sql). NOT a new RfmSegment value: every
// value_tier row still has segment='champion', this just distinguishes
// "champion, ordinary" (core) from "champion, revenue_sum > 5,000 THB" (high).
export type ValueTier = "high" | "core";

export const VALUE_TIER_LABEL_TH: Record<ValueTier, string> = {
  high: "แชมป์เปี้ยน (ยอดเยอะ)",
  core: "แชมป์เปี้ยน (ปกติ)",
};

export const VALUE_TIER_DESC_TH: Record<ValueTier, string> = {
  high: "ชั้นดี + ยอดสะสม >฿5,000 — VIP ดูแล 1:1/perk พิเศษ",
  core: "ชั้นดีทั่วไป (ยอดสะสม ≤฿5,000)",
};
