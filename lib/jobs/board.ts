// lib/jobs/board.ts — จัดข้อมูลบอร์ดใบงาน (pure): แบ่งคอลัมน์ตามขั้น · ตัวกรอง · สรุปตัวเลข · ป้ายบนการ์ด
// ไม่ตัดสินแทน DB: เลยกำหนด/ค้างนาน/ยังไม่มีมัดจำ/ไม่ตรงใบเสนอราคา มาจาก v_job_board ตรงๆ (is_overdue/is_stale/deposit_missing/quote_qty_mismatch)
// ที่นี่คำนวณเฉพาะ "ครบกำหนดใน 3 วัน" (ข้อมูลประกอบ จากวันที่ไทยของ server) และจัดกลุ่ม

import { addDays, daysBetween } from "@/lib/jobs/dates";
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
  return {
    active: rows.length,
    overdue: rows.filter((r) => matchesSignal(r, "overdue", todayTh)).length,
    dueSoon: rows.filter((r) => matchesSignal(r, "dueSoon", todayTh)).length,
    stale: rows.filter((r) => matchesSignal(r, "stale", todayTh)).length,
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
  if (r.depositMissing && r.status !== "done" && r.status !== "cancelled") out.push({ key: "deposit", label: r.startGateNotePresent ? "ยังไม่มีมัดจำ (เริ่มก่อนด้วยเหตุผล)" : "ยังไม่มีมัดจำ", tone: "amber" });
  if (r.isStale) out.push({ key: "stale", label: "ไม่มีความเคลื่อนไหวเกิน 3 วัน", tone: "amber" });
  if (r.handoffMismatchCount > 0) out.push({ key: "mismatch", label: `ชั่งไม่ตรง ${r.handoffMismatchCount} ครั้ง`, tone: "amber" });
  if (r.handoffGapG !== null && r.handoffGapG > 0) out.push({ key: "handoff", label: `ส่วนต่างส่งมอบ ${Math.round(r.handoffGapG * 1000) / 1000} g`, tone: "amber" });
  if (r.hasAutoClosed) out.push({ key: "auto", label: "มีขั้นที่ปิดให้อัตโนมัติ", tone: "gray" });
  if (r.quoteQtyMismatch) out.push({ key: "qty", label: `จำนวนไม่ตรงใบเสนอราคา${r.quoteItemQty !== null ? ` (${r.quoteItemQty})` : ""}`, tone: "blue" });
  return out;
}

/**
 * จำนวนบนการ์ด (0175): เท่ากัน = "30 ชิ้น" (ใบเดิมไม่ขึ้นสองเลข) · เริ่มผลิตต่างจากที่สั่ง = "30 (เริ่ม 35) ชิ้น"
 * ใช้ได้กับ BoardRow และ JobDetail (มี qtyOrder/qtyPlanned เหมือนกัน)
 */
export function qtyLabel(r: { qtyOrder: number; qtyPlanned: number }): string {
  return r.qtyOrder === r.qtyPlanned ? `${r.qtyPlanned} ชิ้น` : `${r.qtyOrder} (เริ่ม ${r.qtyPlanned}) ชิ้น`;
}

/**
 * ข้อความ "สั่ง X · เริ่มผลิต Y ชิ้น" (0175) — ที่เดียวของทุกจอ (หน้ารายละเอียด · ใบพิมพ์ · dialog)
 * เท่ากัน = "30 ชิ้น" (ใบเดิมไม่ขึ้นสองเลข) · alwaysOrder = เท่ากันก็ขึ้น "สั่ง 30 ชิ้น" (dialog ที่ต้องบอกว่าตัวเลขคือจำนวนสั่ง)
 */
export function qtyOrderPlannedText(r: { qtyOrder: number; qtyPlanned: number }, opts: { alwaysOrder?: boolean } = {}): string {
  if (r.qtyOrder === r.qtyPlanned) return opts.alwaysOrder ? `สั่ง ${r.qtyOrder} ชิ้น` : `${r.qtyPlanned} ชิ้น`;
  return `สั่ง ${r.qtyOrder} · เริ่มผลิต ${r.qtyPlanned} ชิ้น`;
}

/** เผื่อกี่ชิ้น = เริ่มผลิต − สั่ง เมื่อเริ่มผลิตมากกว่าที่สั่ง · ไม่งั้น 0 (ผลต่างจำนวนชิ้น ไม่ใช่เงิน/น้ำหนัก) */
export function bufferQtyOf(r: { qtyOrder: number; qtyPlanned: number }): number {
  return r.qtyPlanned > r.qtyOrder ? r.qtyPlanned - r.qtyOrder : 0;
}

/** ป้าย "เผื่อ +5" — ที่เดียวของทุกจอ (ฟอร์มสร้าง · การ์ดแผน · บอร์ด) */
export const bufferLabel = (n: number): string => `เผื่อ +${n.toLocaleString("en-US")}`;

/** "ค้าง n วัน" ในขั้นนี้ — null = ไม่มีข้อมูล (ไม่แสดง) */
export function stageAgeLabel(r: BoardRow): string | null {
  if (r.daysInStage === null || r.daysInStage < 0) return null;
  return r.daysInStage === 0 ? "วันนี้" : `${r.daysInStage} วัน`;
}

export function holderOptions(rows: readonly BoardRow[]): string[] {
  return [...new Set(rows.map((r) => r.holderName).filter((h): h is string => !!h))].sort((a, b) => a.localeCompare(b, "th"));
}

// ---------------------------------------------------------------------------
// บอร์ด v2 (14 ต.ค. 69) — ชุดข้อมูลที่กรองแล้วชุดเดียวป้อนทั้ง "งานที่วิ่งอยู่" และบอร์ด
// เพิ่มข้างๆ ของเดิม (cardBadges / applyFilters / compareCards / BoardFilters คงไว้ — test เดิมใช้) · ยังไม่ตัดสินแทน DB: ธงทุกตัวมาจาก v_job_board
// ---------------------------------------------------------------------------

/** ตัวกรองจาก tile (ทำงานต่อจาก dropdown) */
export type Signal = "overdue" | "dueSoon" | "stale";

/** ครบกำหนดใน 3 วัน = วันนี้ ≤ due ≤ วันนี้+3 และยังไม่เลยกำหนด */
function isDueSoon(r: BoardRow, todayTh: string): boolean {
  // ใบที่ปิดแล้ว/ยกเลิกไม่มี "ครบกำหนด" ให้เตือน (S3)
  if (r.status === "done" || r.status === "cancelled") return false;
  if (r.isOverdue || r.dueDate === null) return false;
  return r.dueDate >= todayTh && r.dueDate <= addDays(todayTh, 3);
}

export function matchesSignal(r: BoardRow, signal: Signal, todayTh: string): boolean {
  if (signal === "overdue") return r.isOverdue;
  if (signal === "stale") return r.isStale;
  return isDueSoon(r, todayTh);
}

export function applySignal(rows: readonly BoardRow[], signal: Signal | null, todayTh: string): BoardRow[] {
  return signal ? rows.filter((r) => matchesSignal(r, signal, todayTh)) : [...rows];
}

export type StatusTone = BadgeTone | "green";
export type StatusKey = "overdue" | "dueSoon" | "mismatch" | "handoff" | "stale" | "deposit" | "hold" | "normal" | "auto" | "qty" | "surplusPending" | "underPlanned" | "buffer" | "goldUnguarded";

export interface StatusSignal {
  key: StatusKey;
  /** 1-7 = ต้องดู · 8 = เดินปกติ · 9+ = ข้อมูลประกอบ (รองเท่านั้น) — 9 = ทองไม่มีด่านชั่ง · 10 = ปิดให้อัตโนมัติ · 11 = จำนวนไม่ตรงใบเสนอราคา */
  rank: number;
  label: string;
  tone: StatusTone;
}

/** rank สูงสุดที่ถือว่า "ต้องดู" */
export const ATTENTION_MAX_RANK = 7;

const NORMAL: StatusSignal = { key: "normal", rank: 8, label: "เดินปกติ", tone: "green" };

/** ทุกป้ายที่ใบนี้มี เรียงตาม rank (1-7 ต้องดู → 9+ ข้อมูลประกอบ) · ไม่มี "เดินปกติ" ในนี้ */
export function statusSignals(r: BoardRow, todayTh: string): StatusSignal[] {
  const out: StatusSignal[] = [];
  if (r.isOverdue) {
    const n = r.dueDate ? daysBetween(r.dueDate, todayTh) : 0;
    out.push({ key: "overdue", rank: 1, label: n > 0 ? `เลยกำหนด ${n} วัน` : "เลยกำหนด", tone: "red" });
  }
  if (isDueSoon(r, todayTh)) {
    const n = daysBetween(todayTh, r.dueDate as string);
    out.push({ key: "dueSoon", rank: 2, label: n === 0 ? "ครบวันนี้" : `ครบใน ${n} วัน`, tone: "amber" });
  }
  if (r.handoffMismatchCount > 0) out.push({ key: "mismatch", rank: 3, label: `ชั่งไม่ตรง ${r.handoffMismatchCount} ครั้ง`, tone: "amber" });
  if (r.handoffGapG !== null && r.handoffGapG > 0) out.push({ key: "handoff", rank: 4, label: `ส่วนต่างส่งมอบ ${Math.round(r.handoffGapG * 1000) / 1000} g`, tone: "amber" });
  if (r.isStale) out.push({ key: "stale", rank: 5, label: "นิ่งเกิน 3 วัน", tone: "amber" });
  if (r.depositMissing && r.status !== "done" && r.status !== "cancelled") out.push({ key: "deposit", rank: 6, label: r.startGateNotePresent ? "ยังไม่มีมัดจำ (เริ่มก่อนด้วยเหตุผล)" : "ยังไม่มีมัดจำ", tone: "amber" });
  // 0175: ใบ done ที่ของเหลือยังถือไว้ไม่ตัดสิน (ปกติไม่อยู่บนบอร์ด เพราะบอร์ดดึงเฉพาะใบที่ยังไม่ปิด — ขึ้นที่หน้ารายละเอียดใบงาน) · n = qty_surplus จาก DB
  if (r.surplusPending && r.qtySurplus !== null && r.qtySurplus > 0) out.push({ key: "surplusPending", rank: 6.5, label: `เหลือ ${r.qtySurplus} ชิ้น ยังไม่ตัดสิน`, tone: "amber" });
  if (r.status === "on_hold") out.push({ key: "hold", rank: 7, label: "พักไว้", tone: "gray" });
  // 0176: ใบทองที่มีขั้นโลหะอยู่ในมือแต่ไม่ชั่ง (ไม่มีด่านกันทองหาย) — ข้อมูลประกอบสีแดง ไม่ใช่ป้ายหลัก/ไม่นับ "ต้องดู" (rank 9 > ATTENTION_MAX_RANK) · gold_unguarded จาก DB (ไม่นับใบปิด/ขั้นที่ข้าม)
  if (r.goldUnguarded && r.status !== "done" && r.status !== "cancelled") out.push({ key: "goldUnguarded", rank: 9, label: "ทอง · ไม่มีด่านชั่ง", tone: "red" });
  if (r.hasAutoClosed) out.push({ key: "auto", rank: 10, label: "มีขั้นที่ปิดให้อัตโนมัติ", tone: "gray" });
  if (r.quoteQtyMismatch) out.push({ key: "qty", rank: 11, label: `จำนวนไม่ตรงใบเสนอราคา${r.quoteItemQty !== null ? ` (${r.quoteItemQty})` : ""}`, tone: "blue" });
  // 0175: ผลิตบางส่วน (เริ่มผลิตน้อยกว่าที่สั่ง) — ข้อมูลประกอบ ไม่ใช่ความผิดปกติ · under_planned จาก DB (ใบเดิม qty_order = qty_planned ไม่ขึ้น)
  if (r.underPlanned && r.qtyPlanned < r.qtyOrder) out.push({ key: "underPlanned", rank: 10.1, label: `เริ่มผลิต ${r.qtyPlanned} จากสั่ง ${r.qtyOrder}`, tone: "blue" });
  // เผื่อของเสีย (เริ่มผลิตมากกว่าที่สั่ง) — ข้อมูลประกอบ rank หลัง underPlanned · ส่วนต่างจำนวนชิ้น (ไม่ใช่เงิน/น้ำหนัก) · ใบที่เท่ากัน/น้อยกว่าไม่ขึ้น
  const buf = bufferQtyOf(r);
  if (buf > 0) out.push({ key: "buffer", rank: 10.2, label: bufferLabel(buf), tone: "blue" });
  return out;
}

/** ป้ายหลัก = rank ต่ำสุดที่จริง (1-7) · ไม่มี → เดินปกติ (ป้ายข้อมูลประกอบไม่นับ) */
export function primaryStatus(r: BoardRow, todayTh: string): StatusSignal {
  const first = statusSignals(r, todayTh)[0];
  return first && first.rank <= ATTENTION_MAX_RANK ? first : NORMAL;
}

/** ป้ายรอง = ที่เหลือหลังป้ายหลัก (รวมข้อมูลประกอบ) */
export function secondaryStatuses(r: BoardRow, todayTh: string): StatusSignal[] {
  const p = primaryStatus(r, todayTh);
  return statusSignals(r, todayTh).filter((s) => s.key !== p.key);
}

/** ส่วนบน: rank → กำหนดส่งน้อยก่อน (ไม่มี = ท้าย) → ค้างขั้นนานก่อน (ไม่มีข้อมูล = ท้าย) → เลขใบ */
export function compareBySeverity(a: BoardRow, b: BoardRow, todayTh: string): number {
  const ra = primaryStatus(a, todayTh).rank;
  const rb = primaryStatus(b, todayTh).rank;
  if (ra !== rb) return ra - rb;
  const ad = a.dueDate ?? "9999";
  const bd = b.dueDate ?? "9999";
  const byDue = ad.localeCompare(bd);
  if (byDue !== 0) return byDue;
  const da = a.daysInStage ?? -1;
  const db = b.daysInStage ?? -1;
  if (da !== db) return db - da;
  return a.seq - b.seq;
}

/** จำนวนใบที่ "ต้องดู" (ป้ายหลัก rank ≤ 7) */
export function attentionCount(rows: readonly BoardRow[], todayTh: string): number {
  return rows.filter((r) => primaryStatus(r, todayTh).rank <= ATTENTION_MAX_RANK).length;
}

export interface DueInfo {
  kind: "overdue" | "soon" | "normal" | "none";
  text: string;
}

/** บรรทัด "เลย 3 วัน" / "อีก 2 วัน" / "วันนี้" / "ไม่ตั้งกำหนดส่ง" (ใต้วันที่กำหนดส่ง) */
export function dueInfo(r: BoardRow, todayTh: string): DueInfo {
  if (!r.dueDate) return { kind: "none", text: "ไม่ตั้งกำหนดส่ง" };
  const n = daysBetween(todayTh, r.dueDate);
  if (n < 0) return { kind: "overdue", text: `เลย ${-n} วัน` };
  if (r.isOverdue) return { kind: "overdue", text: "เลยกำหนด" };
  if (n === 0) return { kind: "soon", text: "วันนี้" };
  return { kind: n <= 3 ? "soon" : "normal", text: `อีก ${n} วัน` };
}

/** คอลัมน์ที่แสดงในบอร์ด/rail ตามกติกาเดิม (ซ่อนเฉพาะ "ยังไม่เริ่ม" ที่ว่าง) */
export function boardColumns(cols: readonly BoardColumn[]): BoardColumn[] {
  return cols.filter((c) => c.code !== NO_STAGE || c.rows.length > 0);
}

export function hasFilters(f: BoardFilters, signal: Signal | null): boolean {
  return !!(f.metal || f.source || f.holder || f.overdueOnly || signal);
}

const SIGNAL_LABEL: Record<Signal, string> = { overdue: "เลยกำหนด", dueSoon: "ครบใน 3 วัน", stale: "นิ่งเกิน 3 วัน" };
export const SIGNAL_TEXT = SIGNAL_LABEL;

/** "เลยกำหนด · โลหะ ทอง · แหล่ง งาน OEM · ผู้ถือ ช่างเอ" — ป้ายชื่อโลหะ/แหล่งส่งเข้ามาเพื่อไม่ผูก lib นี้กับ types */
export function describeFilters(f: BoardFilters, signal: Signal | null, labels: { metal: Record<string, string>; source: Record<string, string> }): string {
  const parts: string[] = [];
  if (signal) parts.push(SIGNAL_LABEL[signal]);
  if (f.overdueOnly && signal !== "overdue") parts.push("เลยกำหนด");
  if (f.metal) parts.push(`โลหะ ${labels.metal[f.metal] ?? f.metal}`);
  if (f.source) parts.push(`แหล่ง ${labels.source[f.source] ?? f.source}`);
  if (f.holder) parts.push(`ผู้ถือ ${f.holder}`);
  return parts.join(" · ");
}
