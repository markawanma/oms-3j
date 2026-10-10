// lib/marketing/calendar-types.ts — ชนิดข้อมูลของปฏิทินใหม่ (pure)

import type { FestivalSpan } from "@/lib/marketing/calendar-view";
import type { LineQuota, Part, PieceRow } from "@/lib/marketing/piece-types";

/** step เก่าที่ไม่อยู่ใน workflow ใหม่ (piece_status is null) — แสดงอ่านอย่างเดียว ลิงก์ไปหน้าเดิม /marketing/calendar/[stepId] */
export interface LegacyStep {
  stepId: string;
  campaignId: string;
  campaignName: string;
  campaignType: string | null;
  title: string;
  resolvedStart: string | null;
  resolvedEnd: string | null;
  channel: string | null;
  startTime: string | null;
  /** effective_status ของบอร์ดเดิม (todo/scheduled/active/blocked/waiting_data/done) */
  effectiveStatus: string;
  contentTypeCode: string | null;
  stepOrigin: string | null;
}

/** จำนวนสูงสุดของกลุ่ม "ค้างจากก่อนหน้า" ที่ action ส่งมา — ถึงเท่านี้ = อาจมีเกิน (ลิงก์ไปชิ้นงานทั้งหมด) */
export const OVERDUE_FETCH_LIMIT = 12;

export interface CalendarData {
  from: string;
  to: string;
  /** ชิ้นงาน workflow ใหม่ที่ครอบช่วง (overlap — ไม่ใช่กรองแค่ resolved_start) */
  pieces: Part<PieceRow[]>;
  /** step เก่าในช่วงเดียวกัน (ไม่รวมชิ้น workflow ใหม่ทั้งที่ยกเลิกแล้ว) */
  legacy: Part<LegacyStep[]>;
  /** ชิ้นที่ค้าง (ยังไม่โพสต์) วันที่ก่อนช่วงที่แสดงและก่อนวันนี้ */
  overdue: Part<PieceRow[]>;
  lineQuota: Part<LineQuota | null>;
  festivals: Part<FestivalSpan[]>;
  /** ชิ้นงานถึงเพดานแถวต่อครั้ง — อาจไม่ครบ (แคบช่วงหรือใช้ตัวกรอง) */
  piecesTruncated: boolean;
  legacyTruncated: boolean;
}
