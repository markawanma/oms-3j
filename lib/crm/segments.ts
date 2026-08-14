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
