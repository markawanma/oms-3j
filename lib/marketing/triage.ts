// lib/marketing/triage.ts — ตรรกะ pure ของหน้า "คัดไอเดีย" (/marketing/triage) · แผน §4 P1b ข้อ 1
// ไม่ตัดสินแทน DB: ที่นี่แค่จัดกลุ่มแถว/นับ/ทำป้ายข้อความ — ผ่านด่านวางแผนไหม (55000) · เกินโควตาไหม ฯลฯ DB บอก

import { addDays, isCalendarDate, weekRangeOf, weekdayIndex } from "@/lib/marketing/calendar-view";
import { thaiWeekRange } from "@/lib/marketing/inbox-piles";
import { formatThaiDay } from "@/lib/marketing/format";
import type { ContentTypeOption, HostOption, InboxCounts, LineQuota, Part, PieceRow, SignalOrigin } from "@/lib/marketing/piece-types";

/**
 * วันจันทร์ของสัปดาห์เป้าหมาย: ?w=YYYY-MM-DD (วันใดก็ได้ในสัปดาห์ · ปี 2025–2030)
 * ไม่ระบุ/ไม่ถูกต้อง = ค่าเริ่มต้น: สัปดาห์นี้ — แต่เสาร์–อาทิตย์ = สัปดาห์ถัดไป (คัดสัปดาห์ที่ผ่านไปแล้วไม่มีประโยชน์)
 */
export function triageWeekFrom(todayTh: string, param: string | null | undefined): string {
  if (param && isCalendarDate(param)) return weekRangeOf(param).from;
  const range = isCalendarDate(todayTh) ? weekRangeOf(todayTh) : thaiWeekRange(todayTh);
  if (!range) return todayTh;
  return weekdayIndex(todayTh) >= 5 ? addDays(range.from, 7) : range.from;
}

export function triageWeekDays(weekFrom: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekFrom, i));
}

/** ลิงก์สัปดาห์ก่อน/ถัดไป · null = ออกนอกช่วงปีที่รองรับ (ไม่แสดงลิงก์) · สัปดาห์นี้ = ไม่มี ?w */
export function triageWeekHref(weekFrom: string, offsetWeeks: -1 | 1, todayTh: string): string | null {
  const target = addDays(weekFrom, 7 * offsetWeeks);
  if (!isCalendarDate(target)) return null;
  return target === triageWeekFrom(todayTh, null) ? "/marketing/triage" : `/marketing/triage?w=${target}`;
}

export function triageWeekLabel(weekFrom: string): string {
  const to = addDays(weekFrom, 6);
  const a = formatThaiDay(weekFrom).replace(/^\S+\s/, "");
  const b = formatThaiDay(to).replace(/^\S+\s/, "");
  return `${a} – ${b}`;
}

export interface IdeaGroups {
  /** รอคัด: piece_status idea และไม่ถูกพัก */
  pending: PieceRow[];
  /** เลื่อนไว้: idea ที่ถูกพัก (hold overlay) — ปุ่ม "กลับมาคัด" */
  held: PieceRow[];
}

export function groupIdeas(rows: readonly PieceRow[]): IdeaGroups {
  const ideas = rows.filter((r) => r.pieceStatus === "idea");
  return {
    pending: ideas.filter((r) => !r.holdReason),
    held: ideas.filter((r) => !!r.holdReason),
  };
}

/** ชิ้นที่ "ลงปฏิทินแล้ว" ของสัปดาห์ = สถานะ planned เท่านั้น (ยกเลิกการเลือกได้ — เลยขั้นนี้แล้วต้องทำที่หน้าชิ้นงาน) */
export function chosenInWeek(rows: readonly PieceRow[]): PieceRow[] {
  return rows
    .filter((r) => r.pieceStatus === "planned" && !r.holdReason)
    .sort((a, b) => (a.resolvedStart ?? "").localeCompare(b.resolvedStart ?? ""));
}

/** จำนวนชิ้นต่อวัน (ไม่นับยกเลิก และไม่นับ idea — ไอเดียยังไม่ถูกจัดลงวัน วันที่ค้างเดิมไม่ใช่ชิ้นในปฏิทิน) — ชิ้นหลายวันนับทุกวันที่คร่อม · ใช้บอก "<วัน> · มี n ชิ้น" และ "วันที่ยังไม่มีชิ้นงาน" */
export function pieceCountsByDay(rows: readonly PieceRow[], days: readonly string[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(days.map((d) => [d, 0]));
  for (const r of rows) {
    if (r.pieceStatus === "cancelled" || r.pieceStatus === "idea" || !r.resolvedStart) continue;
    const start = r.resolvedStart;
    const end = r.resolvedEnd ?? r.resolvedStart;
    for (const d of days) if (d >= start && d <= end) out[d] += 1;
  }
  return out;
}

export function emptyDayCount(counts: Record<string, number>): number {
  return Object.values(counts).filter((n) => n === 0).length;
}

/** จำนวนที่ทำแล้วของสัปดาห์แยกช่องทาง — ไม่มีตัวหาร (ไม่มีโควตารายช่องใน DB) · ข้ามยกเลิก */
export function countByChannel(rows: readonly PieceRow[]): { channel: string; n: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.pieceStatus === "cancelled" || !r.channel) continue;
    map.set(r.channel, (map.get(r.channel) ?? 0) + 1);
  }
  return [...map.entries()].map(([channel, n]) => ({ channel, n })).sort((a, b) => b.n - a.n || a.channel.localeCompare(b.channel));
}

/** ข้อความตัวเลือกวัน: "พ. 14 ต.ค. · มี 2 ชิ้น" */
export function dayOptionLabel(day: string, n: number): string {
  return `${formatThaiDay(day)} · ${n === 0 ? "ยังไม่มีชิ้น" : `มี ${n} ชิ้น`}`;
}

/** ต้องถามยืนยันก่อน ✓ ไหม: ชิ้น LINE message และ DB บอกว่า over_quota_planned หรือเหลือ 0 (ไม่คำนวณโควตาเอง — ใช้ค่าจาก view) */
export function needsLineConfirm(piece: Pick<PieceRow, "pieceKind" | "channel">, quota: LineQuota | null): boolean {
  if (!quota) return false;
  const isLine = piece.pieceKind === "line_message" || piece.channel === "line_oa";
  return isLine && (quota.overQuotaPlanned || quota.remaining28d <= 0);
}

/** ประเภท hook ตั้งต้นที่ไม่ซ้ำกัน (ต้องมี ≥ 2 ประเภทตามด่านส่งตรวจ — ที่นี่แค่บอกว่ายังไม่ครบ ไม่ใช่ตัดสิน) */
export function distinctHookTypes(piece: Pick<PieceRow, "hooks">): string[] {
  return [...new Set(piece.hooks.map((h) => h.hookType).filter((t): t is string => !!t))];
}

// ---------------------------------------------------------------------------
// รูปข้อมูลที่ server ส่งให้หน้า (แต่ละส่วนล้มอิสระ — Part)
// ---------------------------------------------------------------------------

export interface TriageIdeas {
  rows: PieceRow[];
  /** แถวไอเดียเกินเพดาน query — หน้าต้องบอกว่าแสดงไม่ครบ */
  truncated: boolean;
  /** สัญญาณต้นทาง (ที่มา) ตาม source_signal_id */
  signals: Record<string, SignalOrigin>;
}

export interface TriageData {
  todayTh: string;
  weekFrom: string;
  ideas: Part<TriageIdeas>;
  /** ชิ้นที่ทับสัปดาห์เป้าหมาย (แถวเบา) — ใช้นับต่อวัน/ต่อช่อง/รายการ "ลงปฏิทินแล้ว" */
  weekRows: Part<PieceRow[]>;
  weekTruncated: boolean;
  lineQuota: Part<LineQuota | null>;
  counts: Part<InboxCounts>;
  /** บรรทัดแรกของสรุปรายสัปดาห์ล่าสุด (ไม่ประกอบเอง) */
  lastWeekLine: Part<string | null>;
  hosts: HostOption[];
  contentTypes: ContentTypeOption[];
}

// ---------------------------------------------------------------------------
// ข้อความบนการ์ด
// ---------------------------------------------------------------------------

/** "ฐาน 0.3 ณ 11 ต.ค. → เกณฑ์ ไม่น้อยกว่า 0.36" — ตัวเลขดิบจาก DB ไม่ใส่ % (Q1a ยังไม่ยืนยันหน่วย) · ไม่มีค่าฐาน/เกณฑ์ = null */
export function baselineLine(
  p: Pick<PieceRow, "baselineValue" | "baselineAsOf" | "passThreshold" | "passOp" | "metricCode">,
  passOpLabel: Record<string, string>
): string | null {
  if (p.metricCode === "none") return null;
  const parts: string[] = [];
  if (p.baselineValue !== null) {
    parts.push(`ฐาน ${p.baselineValue}${p.baselineAsOf ? ` ณ ${formatThaiDay(p.baselineAsOf)}` : ""}`);
  }
  if (p.passThreshold !== null) {
    const op = p.passOp ? passOpLabel[p.passOp] : null;
    parts.push(`เกณฑ์ ${op ? `${op} ` : ""}${p.passThreshold}`);
  }
  return parts.length > 0 ? parts.join(" → ") : null;
}

/** ข้อความ 55000 "วางแผนไม่ได้ — a · b" → รายการสิ่งที่ขาด (null = ไม่ใช่ข้อความรูปนี้) */
export function parsePlanBlockers(message: string | null | undefined): string[] | null {
  if (!message) return null;
  const m = /^วางแผนไม่ได้\s*[—-]\s*(.+)$/s.exec(message.trim());
  if (!m) return null;
  const items = m[1]
    .split(/\s*·\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : null;
}
