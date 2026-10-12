// lib/jobs/board.ts — จัดข้อมูลบอร์ดใบงาน (pure): แบ่งคอลัมน์ตามขั้น · ตัวกรอง · สรุปตัวเลข · ป้ายบนการ์ด
// ไม่ตัดสินแทน DB: เลยกำหนด/ค้างนาน/ยังไม่มีมัดจำ/ไม่ตรงใบเสนอราคา มาจาก v_job_board ตรงๆ (is_overdue/is_stale/deposit_missing/quote_qty_mismatch)
// ที่นี่คำนวณเฉพาะ "ครบกำหนดใน 3 วัน" (ข้อมูลประกอบ จากวันที่ไทยของ server) และจัดกลุ่ม

import { addDays } from "@/lib/jobs/dates";
import type { BoardRow, StageDef } from "@/lib/jobs/types";

export const NO_STAGE = "__none__";
/** 0173: ส่งต่อ/ข้ามครบทุกขั้นแล้วแต่ออฟฟิศยังไม่ปิดงาน — DB ตัดสินใน v_job_board.board_column */
export const AWAITING_CLOSE = "awaiting_close";

export interface BoardFilters {
  metal: string;
  source: string;
  holder: string;
  overdueOnly: boolean;
}

export const EMPTY_FILTERS: BoardFilters = { metal: "", source: "", holder: "", overdueOnly: false };

export function applyFilters(rows: readonly BoardRow[], f: BoardFilters): BoardRow[] {
  return rows.filter(
    (r) => (!f.metal || r.metal === f.metal) && (!f.source || r.sourceKind === f.source) && (!f.holder || r.holderName === f.holder) && (!f.overdueOnly || r.isOverdue)
  );
}

export interface BoardColumn {
  code: string;
  name: string;
  rows: BoardRow[];
}

/** คอลัมน์ที่ใบนี้ควรอยู่ — ยึด board_column ของ DB (0173) · ไม่มีค่า/ไม่รู้จัก: ครบทุกขั้นแล้วแต่ไม่มีขั้นปัจจุบัน = รอปิดงาน (กันกรณีข้อมูลเก่า) ไม่งั้น "ยังไม่เริ่ม" */
export function columnOf(r: BoardRow, known: ReadonlySet<string>): string {
  const bc = r.boardColumn ?? r.stageCode;
  if (bc === AWAITING_CLOSE) return AWAITING_CLOSE;
  if (bc && known.has(bc)) return bc;
  if (!r.stageCode && r.stageCount > 0 && r.stageDoneCount >= r.stageCount) return AWAITING_CLOSE;
  return NO_STAGE;
}

/** คอลัมน์ = "ยังไม่เริ่ม" (ข้อมูลที่ไม่มีขั้น) + ขั้นที่ใช้งาน (เรียงตามลำดับมาตรฐาน) + "รอปิดงาน" ท้ายสุด — ขั้นที่ไม่มีใบงานก็แสดง (เห็นภาพรวมสายผลิต) */
export function groupByStage(rows: readonly BoardRow[], defs: readonly StageDef[]): BoardColumn[] {
  const known = new Set(defs.map((d) => d.code));
  const cols: BoardColumn[] = [
    { code: NO_STAGE, name: "ยังไม่เริ่ม", rows: [] },
    ...defs.map((d) => ({ code: d.code, name: d.nameTh, rows: [] as BoardRow[] })),
    { code: AWAITING_CLOSE, name: "รอปิดงาน", rows: [] },
  ];
  const by = new Map(cols.map((c) => [c.code, c]));
  for (const r of rows) by.get(columnOf(r, known))!.rows.push(r);
  for (const c of cols) c.rows.sort(compareCards);
  return cols;
}

/** เลยกำหนดก่อน · แล้วกำหนดส่งใกล้ก่อน (ไม่มีกำหนด = ท้าย) · แล้วเลขใบ */
export function compareCards(a: BoardRow, b: BoardRow): number {
  if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
  const ad = a.dueDate ?? "9999";
  const bd = b.dueDate ?? "9999";
  return ad.localeCompare(bd) || a.seq - b.seq;
}

export interface BoardSummary {
  active: number;
  overdue: number;
  dueSoon: number;
  stale: number;
  depositMissing: number;
}

/** ครบกำหนดใน 3 วัน = วันนี้ ≤ due ≤ วันนี้+3 และยังไม่เลยกำหนด — ข้อมูลประกอบ */
export function summarize(rows: readonly BoardRow[], todayTh: string): BoardSummary {
  const soonTo = addDays(todayTh, 3);
  return {
    active: rows.length,
    overdue: rows.filter((r) => r.isOverdue).length,
    dueSoon: rows.filter((r) => !r.isOverdue && r.dueDate !== null && r.dueDate >= todayTh && r.dueDate <= soonTo).length,
    stale: rows.filter((r) => r.isStale).length,
    depositMissing: rows.filter((r) => r.depositMissing).length,
  };
}

export type BadgeTone = "red" | "amber" | "gray" | "blue";
export interface CardBadge {
  key: string;
  label: string;
  tone: BadgeTone;
}

/** ป้ายบนการ์ด — ข้อความ + ไอคอน (ไม่พึ่งสีอย่างเดียว) */
export function cardBadges(r: BoardRow): CardBadge[] {
  const out: CardBadge[] = [];
  if (r.isOverdue) out.push({ key: "overdue", label: "เลยกำหนด", tone: "red" });
  if (r.status === "on_hold") out.push({ key: "hold", label: "พักไว้", tone: "amber" });
  if (r.depositMissing && r.status !== "done") out.push({ key: "deposit", label: r.startGateNotePresent ? "ยังไม่มีมัดจำ (เริ่มก่อนด้วยเหตุผล)" : "ยังไม่มีมัดจำ", tone: "amber" });
  if (r.isStale) out.push({ key: "stale", label: "ไม่มีความเคลื่อนไหวเกิน 3 วัน", tone: "amber" });
  if (r.handoffMismatchCount > 0) out.push({ key: "mismatch", label: `ชั่งไม่ตรง ${r.handoffMismatchCount} ครั้ง`, tone: "amber" });
  if (r.handoffGapG !== null && r.handoffGapG > 0) out.push({ key: "handoff", label: `ส่วนต่างส่งมอบ ${Math.round(r.handoffGapG * 1000) / 1000} g`, tone: "amber" });
  if (r.hasAutoClosed) out.push({ key: "auto", label: "มีขั้นที่ปิดให้อัตโนมัติ", tone: "gray" });
  if (r.quoteQtyMismatch) out.push({ key: "qty", label: `จำนวนไม่ตรงใบเสนอราคา${r.quoteItemQty !== null ? ` (${r.quoteItemQty})` : ""}`, tone: "blue" });
  return out;
}

/** "ค้าง n วัน" ในขั้นนี้ — null = ไม่มีข้อมูล (ไม่แสดง) */
export function stageAgeLabel(r: BoardRow): string | null {
  if (r.daysInStage === null || r.daysInStage < 0) return null;
  return r.daysInStage === 0 ? "วันนี้" : `${r.daysInStage} วัน`;
}

export function holderOptions(rows: readonly BoardRow[]): string[] {
  return [...new Set(rows.map((r) => r.holderName).filter((h): h is string => !!h))].sort((a, b) => a.localeCompare(b, "th"));
}
