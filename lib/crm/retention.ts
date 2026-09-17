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
  // ขอบ 91 วันเป็นตัวเลขเป๊ะ สิ่งที่คลุมเครือคือ "การตีความ" (เงียบ ≠ เลิกซื้อ)
  // ไม่ใช่ตัวเลข ⇒ label บอกข้อเท็จจริงเฉยๆ คำอธิบายเชิงตีความไปอยู่ใต้ตาราง
  // 🔴 bucket "91+" ≠ segment `at_risk` เป๊ะ (code-review N2): การ์ด RFM ใช้
  // `now() - last_order_at > interval '90 days'` แต่ ladder ใช้ recency_days
  // ที่เป็น extract(day ...)::int ซึ่ง **ตัดเศษทิ้ง** ⇒ คนที่เงียบมา 90 วัน
  // 14 ชม. จะเป็น at_risk บนการ์ด แต่ตกอยู่ bucket "61-90" บน ladder
  // เหลื่อมกันได้ ≤ 1 วัน/คน — ตั้งใจไม่แก้ logic (ต้องไปแตะ view เก่า ไม่คุ้ม)
  // ถ้าสองหน้านี้อยู่จอเดียวกันแล้วเจ้าของถามว่าทำไมเลขไม่ตรง คำตอบอยู่ตรงนี้
  "91+": "91 วันขึ้นไป",
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
  /** 🔴 null ได้ **2 สาเหตุ ห้ามยุบเป็นเคสเดียวบนจอ** (SQL: 0120 บรรทัด
   * 442/447/452 `case when mature_N and new_n > 0 then ... else null end`):
   *   1. `mature === false` → ยังไม่ครบกำหนด as_of ยังไม่ผ่านไปพอให้ลูกค้า
   *      ทุกคนในสัปดาห์นี้มีโอกาสซื้อซ้ำครบ N วัน → แสดง "รอครบกำหนด"
   *   2. `mature === true && n === 0` → สัปดาห์นั้นช่องทางนั้น**ไม่มีลูกค้าใหม่
   *      เลย** (cohort grid zero-fill ทุกช่อง สัปดาห์ × ช่องทาง) → แสดง "—"
   * ทั้งสองเคส **ห้ามแสดงเป็น 0%** เพราะ 0% แปลว่า "วัดแล้วไม่มีใครกลับมา"
   * ซึ่งเป็นคนละเรื่องกับ "ยังไม่ได้วัด" และ "ไม่มีใครให้วัด" */
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
