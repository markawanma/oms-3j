// lib/crm/retention.ts — types + display constants for the CRM retention
// read layer (0120_crm_retention.sql: analytics.crm_recency_ladder +
// analytics.crm_repeat_cohort). Kept OUT of lib/actions/crm-retention.ts
// (which is "use server") for the same reason as lib/crm/segments.ts: a
// "use server" module may only export async functions, so runtime const
// values (RECENCY_BUCKETS, labels) can't live there.

import type { ProductAffinity } from "@/lib/marketing/types";

// ============================================================================
// Recency ladder (analytics.crm_recency_ladder, 0120 part C)
// ============================================================================

/** Display order + Thai label for recency_bucket (analytics.v_audience,
 * 0120 part B). "91+" — not "90+" — and "≈" semantics, not "=": a bucket is
 * a rough distance since the customer's last order, never a claim that
 * they're lost/unreachable. */
export type RecencyBucket = "0-7" | "8-14" | "15-30" | "31-60" | "61-90" | "91+";

export const RECENCY_BUCKETS: RecencyBucket[] = ["0-7", "8-14", "15-30", "31-60", "61-90", "91+"];

export const RECENCY_BUCKET_LABEL_TH: Record<RecencyBucket, string> = {
  "0-7": "0-7 วัน",
  "8-14": "8-14 วัน",
  "15-30": "15-30 วัน",
  "31-60": "31-60 วัน",
  "61-90": "61-90 วัน",
  "91+": "≈91 วันขึ้นไป",
};

export interface RecencyLadderCell {
  bucket: RecencyBucket;
  /** "เคยสั่งผ่านช่องทางที่ติดต่อได้" — LIFETIME (bool_or ทั้งประวัติการซื้อ),
   * ไม่ใช่ช่องทางออเดอร์ล่าสุด และไม่ใช่การยืนยันว่าติดต่อได้แน่นอนวันนี้
   * (block/unfriend เราไม่รู้) — ใช้คำนี้ในจอด้วย ห้ามเขียนว่า "ติดต่อได้" เฉยๆ */
  reachable: boolean;
  affinity: ProductAffinity;
  customers: number;
  /** null เมื่อ p_include_money=false (เช่น staff role) — ไม่ใช่ 0 */
  revenue: number | null;
}

export interface RecencyLadder {
  /** วันนี้ (เวลาไทย) ที่คำนวณ ladder นี้ — คนละความหมายกับ maxOrderDate */
  asOf: string;
  /** วันที่ order ล่าสุดในข้อมูลจริง — สัญญาณความล่าช้าของการ import
   * (Shipnity ตามหลังเสมอ) ไม่ใช่ error */
  maxOrderDate: string | null;
  customersTotal: number;
  cells: RecencyLadderCell[];
}

// ============================================================================
// Repeat-purchase cohort (analytics.crm_repeat_cohort, 0120 part D)
// ============================================================================

export interface RepeatWindowStat {
  n: number;
  /** null = cell ยังไม่ mature (as_of ยังไม่ผ่านไปพอสำหรับลูกค้าทุกคนใน
   * สัปดาห์นี้จะมีโอกาสซื้อซ้ำครบ N วัน) — ห้ามแสดงเป็น 0% บนจอเด็ดขาด */
  rate: number | null;
  mature: boolean;
}

export interface RepeatCohortWeek {
  weekStart: string;
  channelCode: string;
  newN: number;
  w7: RepeatWindowStat;
  w14: RepeatWindowStat;
  w30: RepeatWindowStat;
}

export interface RepeatBaselineWindowStat {
  n: number;
  rate: number | null;
}

export interface RepeatCohortBaseline {
  channelCode: string;
  /** denominator ร่วมของ w7/w14/w30 ทั้งสามตัว — pooled เฉพาะสัปดาห์ที่
   * mature ครบสำหรับหน้าต่างที่เข้มที่สุด (30 วัน) เพื่อให้ทั้งสามอัตรา
   * เทียบกันได้ตรงๆ (คนละกลุ่มสัปดาห์กัน = เทียบกันไม่ได้) */
  newN: number;
  w7: RepeatBaselineWindowStat;
  w14: RepeatBaselineWindowStat;
  w30: RepeatBaselineWindowStat;
}

export interface RepeatCohort {
  /** = max(order_date) ของร้าน (ไม่ใช่วันนี้) — กัน import lag ทำให้สัปดาห์
   * ล่าสุดโชว์ 0% ทั้งที่ยังไม่มีข้อมูลจริง */
  asOf: string | null;
  excludedOrdersNoCustomer: number;
  weeks: RepeatCohortWeek[];
  baseline: RepeatCohortBaseline[];
}

// ============================================================================
// Combined shape returned by getCrmRetention() (lib/actions/crm-retention.ts)
// ============================================================================

export interface CrmRetentionData {
  ladder: RecencyLadder;
  cohort: RepeatCohort;
  /** false สำหรับ staff (เหมือน p_include_money) — ให้ frontend ใช้ gate
   * ปุ่ม "ดึงรายชื่อ" ในอนาคตโดยไม่ต้องคำนวณ role ซ้ำฝั่ง client */
  canPullList: boolean;
}
