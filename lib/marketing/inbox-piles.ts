// lib/marketing/inbox-piles.ts — การจัดกองงาน "งานที่รอฉัน" (/marketing) · pure function ทดสอบได้
// (content-ui-build-plan.md §1.3 board 1+2, §2.3, §4 P1a)
//
// ขอบเขต: จัดกลุ่ม / เรียง / ตัดแสดง — ไม่ตัดสินแทน DB (ผ่านด่านไหม · อนุมัติได้ไหม · คิวเกินไหม มาจาก view ล้วน)
// เงื่อนไขกองใช้สถานะ "ดิบ" (piece_status) เพื่อให้จำนวนตรงกับ v_content_inbox_counts
// (post_today = approved/produced + resolved_start <= วันนี้ · review_queue = in_review) แม้ชิ้นนั้นถูก hold อยู่

import type { PieceRow, RecoInboxRow } from "@/lib/marketing/piece-types";

/** กอง 4 แสดงสูงสุดกี่ใบบนหน้าแรก (ที่เหลือ "ดูทั้งหมด") — ค่าแสดงผล ไม่ใช่นโยบาย (§2.3) */
export const RECO_PREVIEW_LIMIT = 3;

export interface InboxPiles {
  /** กอง 1 วันนี้ต้องโพสต์ — ที่เลยกำหนดแล้วยังไม่วางลิงก์ขึ้นก่อน */
  post: PieceRow[];
  /** กอง 2 รออนุมัติ */
  review: PieceRow[];
  /** กอง 4 ข้อเสนอ AI ที่รอตอบ (แสดงสูงสุด RECO_PREVIEW_LIMIT) */
  reco: RecoInboxRow[];
  /** จำนวนข้อเสนอที่รอตอบทั้งหมด (สำหรับ "ดูทั้งหมด n") */
  recoTotal: number;
}

function cmpDateAsc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1; // ไม่มีวัน ไปท้าย
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

function cmpStr(a: string | null, b: string | null): number {
  return cmpDateAsc(a, b);
}

/** ชิ้นที่ "ถึงเวลาโพสต์แล้วแต่ยังไม่วางลิงก์" — DB ตอบมาเป็น flag ใน v_content_piece_calendar (ส่งเข้ามาเป็น set ของ step id) */
export function buildPostPile(rows: PieceRow[], todayTh: string, overdueNoLinkIds: ReadonlySet<string>): PieceRow[] {
  return rows
    .filter((r) => (r.pieceStatus === "approved" || r.pieceStatus === "produced") && r.resolvedStart !== null && r.resolvedStart <= todayTh)
    .sort((a, b) => {
      const ao = overdueNoLinkIds.has(a.stepId) ? 0 : 1;
      const bo = overdueNoLinkIds.has(b.stepId) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return cmpDateAsc(a.resolvedStart, b.resolvedStart) || cmpStr(a.startTime, b.startTime) || a.title.localeCompare(b.title, "th");
    });
}

export function buildReviewPile(rows: PieceRow[]): PieceRow[] {
  return rows
    .filter((r) => r.pieceStatus === "in_review")
    .sort((a, b) => cmpDateAsc(a.resolvedStart, b.resolvedStart) || a.title.localeCompare(b.title, "th"));
}

/** เรียงข้อเสนอ: respond_by ใกล้สุดก่อน (ไม่มี = ท้าย) แล้ว created_at ใหม่สุดก่อน */
export function sortRecoPending(rows: RecoInboxRow[]): RecoInboxRow[] {
  return rows
    .filter((r) => r.effectiveAction === "pending")
    .sort((a, b) => {
      const byDue = cmpDateAsc(a.respondBy, b.respondBy);
      if (byDue !== 0) return byDue;
      const ac = a.createdAt ?? "";
      const bc = b.createdAt ?? "";
      return ac === bc ? 0 : ac < bc ? 1 : -1; // ใหม่สุดก่อน
    });
}

export function buildInboxPiles(input: {
  postRows: PieceRow[];
  reviewRows: PieceRow[];
  recoRows: RecoInboxRow[];
  todayTh: string;
  overdueNoLinkIds: ReadonlySet<string>;
}): InboxPiles {
  const pending = sortRecoPending(input.recoRows);
  return {
    post: buildPostPile(input.postRows, input.todayTh, input.overdueNoLinkIds),
    review: buildReviewPile(input.reviewRows),
    reco: pending.slice(0, RECO_PREVIEW_LIMIT),
    recoTotal: pending.length,
  };
}

/** หน้าแรกว่างจริงไหม (ไม่มีกองไหนมีของ) — ใช้ตัดสินแสดง empty state "ไม่มีอะไรรอคุณ" */
export function isInboxEmpty(piles: InboxPiles): boolean {
  return piles.post.length === 0 && piles.review.length === 0 && piles.recoTotal === 0;
}

// ---------------------------------------------------------------------------
// สัปดาห์นี้ (จันทร์–อาทิตย์ ตามเวลาไทย)
// ---------------------------------------------------------------------------

function parseIsoDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ช่วงสัปดาห์ (จ–อา) ที่คลุมวันที่ที่ให้ — วันที่เป็น YYYY-MM-DD ล้วน ไม่ผูก timezone เครื่อง */
export function thaiWeekRange(todayTh: string): { from: string; to: string } | null {
  const d = parseIsoDate(todayTh);
  if (!d) return null;
  const dow = d.getUTCDay(); // 0=อา
  const sinceMonday = (dow + 6) % 7;
  const monday = new Date(d.getTime() - sinceMonday * 86_400_000);
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  return { from: toIsoDate(monday), to: toIsoDate(sunday) };
}

export interface WeekSummary {
  total: number;
  posted: number;
  hasFootage: number;
  inReview: number;
  needsShoot: number;
}

/** นับชิ้นของสัปดาห์ตามสถานะดิบ — ข้อมูลประกอบ (ไม่ใช่การตัดสิน) · cancelled ไม่นับ */
export function summarizeWeek(rows: PieceRow[]): WeekSummary {
  const live = rows.filter((r) => r.pieceStatus !== "cancelled");
  return {
    total: live.length,
    posted: live.filter((r) => r.pieceStatus === "posted").length,
    hasFootage: live.filter(
      (r) => r.pieceStatus !== "posted" && (r.footageStatus === "has_footage" || r.footageStatus === "shot")
    ).length,
    inReview: live.filter((r) => r.pieceStatus === "in_review").length,
    needsShoot: live.filter((r) => r.pieceStatus !== "posted" && r.footageStatus === "needs_shoot").length,
  };
}

/** รวมเวลาประเมินถ่ายทำ (นาที) ของชิ้นที่ยังต้องถ่าย — null เมื่อไม่มีชิ้นไหนระบุเวลา (ไม่เดาเป็น 0) */
export function totalShootMinutes(rows: PieceRow[]): number | null {
  const need = rows.filter((r) => r.pieceStatus === "approved" && r.footageStatus === "needs_shoot");
  const known = need.map((r) => r.shootMinutesEst).filter((n): n is number => n !== null);
  if (known.length === 0) return null;
  return known.reduce((a, b) => a + b, 0);
}
