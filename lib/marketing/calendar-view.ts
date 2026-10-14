// lib/marketing/calendar-view.ts — ตรรกะ pure ของปฏิทินใหม่ (/marketing/calendar): ช่วงวัน · นำทาง · จัดกลุ่มต่อวัน · ตัวกรอง · เทศกาล
// (content-ui-build-plan.md §1.3 #7, §2.6 ก, §4 P1b ข้อ 2)
//
// ขอบเขต: วันที่เป็น "YYYY-MM-DD" ล้วน (คำนวณด้วย UTC ไม่ผูก timezone เครื่อง — วันไทยมาจากผู้เรียก) · จัดกลุ่ม/เรียง/กรอง/นับ
// ไม่ตัดสินแทน DB (ธงบนการ์ด · สถานะ · โควตา มาจาก view ทั้งหมด)

import { CHANNEL_LABEL, PIECE_STATUS_LABEL, TIME_SLOT_LABEL } from "@/lib/marketing/piece-labels";
import type { EffectivePieceStatus } from "@/lib/marketing/piece-labels";

export type CalendarView = "week" | "month" | "list";
export const CALENDAR_VIEWS: readonly CalendarView[] = ["week", "month", "list"];
export const VIEW_LABEL: Record<CalendarView, string> = { week: "สัปดาห์", month: "เดือน", list: "รายการ" };
/** cookie ที่จำมุมมองล่าสุด (ฝั่ง server อ่าน · ฝั่ง client เขียนตอนเปิดหน้า) */
export const VIEW_COOKIE = "mkt_cal_view";

/** เพดานช่วงที่ขอจาก DB ต่อครั้ง (เดือนเต็ม 6 สัปดาห์ = 42 วัน) — กัน query ช่วงยาวบน view ที่ช้า (D15) */
export const MAX_RANGE_DAYS = 45;

export const WEEKDAY_TH = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"] as const;
export const WEEKDAY_SHORT_TH = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** รูปแบบและวันที่มีจริง (ปฏิเสธ 2026-02-30 ที่ JS จะปัดเป็น 2 มี.ค.) */
export function isRealDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function toUtc(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  return fmt(new Date(toUtc(date).getTime() + n * 86_400_000));
}

export function daysInclusive(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000) + 1;
}

/** 0 = จันทร์ … 6 = อาทิตย์ */
export function weekdayIndex(date: string): number {
  return (toUtc(date).getUTCDay() + 6) % 7;
}

export function weekRangeOf(date: string): { from: string; to: string } {
  const from = addDays(date, -weekdayIndex(date));
  return { from, to: addDays(from, 6) };
}

export function monthStartOf(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function monthEndOf(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return fmt(new Date(Date.UTC(y, m, 0)));
}

export interface MonthGrid {
  monthStart: string;
  monthEnd: string;
  /** วันแรก/สุดท้ายของกริด (เต็มสัปดาห์ จ–อา) */
  gridFrom: string;
  gridTo: string;
  weeks: string[][];
}

export function monthGridOf(date: string): MonthGrid {
  const monthStart = monthStartOf(date);
  const monthEnd = monthEndOf(date);
  const gridFrom = weekRangeOf(monthStart).from;
  const gridTo = weekRangeOf(monthEnd).to;
  const weeks: string[][] = [];
  for (let w = gridFrom; w <= gridTo; w = addDays(w, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(w, i)));
  }
  return { monthStart, monthEnd, gridFrom, gridTo, weeks };
}

/** ช่วงวันที่ต้องดึงข้อมูลของแต่ละมุมมอง (สัปดาห์ = จ–อา · เดือน/รายการ = กริดของเดือนที่ครอบวันนั้น) */
export function viewRange(view: CalendarView, anchor: string): { from: string; to: string } {
  if (view === "week") return weekRangeOf(anchor);
  const g = monthGridOf(anchor);
  return { from: g.gridFrom, to: g.gridTo };
}

/** ‹ › : สัปดาห์ ±7 วัน · เดือน/รายการ ±1 เดือน (ไปวันที่ 1 ของเดือนใหม่ — ไม่ล้นเดือนสั้น) */
export function shiftAnchor(view: CalendarView, anchor: string, dir: -1 | 1): string {
  if (view === "week") return addDays(anchor, 7 * dir);
  const [y, m] = anchor.split("-").map(Number);
  return fmt(new Date(Date.UTC(y, m - 1 + dir, 1)));
}

/** ‹ › เลื่อนได้ไหม — ปลายทางต้องยังอยู่ในปี 2025–2030 (ถึงขอบ = ปุ่มปิด ไม่ใช่ลิงก์ไปหน้า error) */
export function canShift(view: CalendarView, anchor: string, dir: -1 | 1): boolean {
  return isCalendarDate(shiftAnchor(view, anchor, dir));
}

/** มุมมองที่ใช้: ?view= ที่ถูกต้อง → cookie ล่าสุดที่ถูกต้อง → "week" (ค่าเริ่มต้นตามเจ้าของสั่ง) */
export function parseView(param: string | string[] | undefined, cookie?: string | null): CalendarView {
  const p = Array.isArray(param) ? param[0] : param;
  if (p && (CALENDAR_VIEWS as readonly string[]).includes(p)) return p as CalendarView;
  if (cookie && (CALENDAR_VIEWS as readonly string[]).includes(cookie)) return cookie as CalendarView;
  return "week";
}

// ---------------------------------------------------------------------------
// จัดกลุ่มต่อวัน
// ---------------------------------------------------------------------------

export interface Dated {
  resolvedStart: string | null;
  resolvedEnd: string | null;
}

/** ชิ้น/step ครอบวันนี้ไหม — overlap จริง (งานหลายวันอยู่ทุกวันที่คร่อม · ไม่ใช่กรองแค่ resolvedStart) */
export function dayCovers(item: Dated, day: string): boolean {
  if (!item.resolvedStart) return false;
  const end = item.resolvedEnd && item.resolvedEnd >= item.resolvedStart ? item.resolvedEnd : item.resolvedStart;
  return item.resolvedStart <= day && day <= end;
}

export interface DayEntry<T> {
  item: T;
  /** วันที่ 2+ ของงานหลายวัน — แสดงป้าย "ต่อเนื่อง" */
  continuation: boolean;
}

export function groupByDay<T extends Dated>(items: readonly T[], days: readonly string[]): Record<string, DayEntry<T>[]> {
  const out: Record<string, DayEntry<T>[]> = {};
  for (const d of days) out[d] = [];
  for (const item of items) {
    for (const d of days) {
      if (dayCovers(item, d)) out[d].push({ item, continuation: item.resolvedStart !== d });
    }
  }
  return out;
}

const SLOT_ORDER = ["morning", "afternoon", "before_live", "during_live"];

/** เรียงในวัน: มีเวลา (HH:MM) ก่อนตามเวลา → ช่วง (เช้า/บ่าย/ก่อนไลฟ์/ระหว่างไลฟ์) → ไม่ระบุ · ท้ายสุดชื่อ */
export function compareInDay(
  a: { startTime?: string | null; timeSlot?: string | null; title: string },
  b: { startTime?: string | null; timeSlot?: string | null; title: string }
): number {
  const rank = (x: { startTime?: string | null; timeSlot?: string | null }): [number, string] => {
    if (x.startTime) return [0, x.startTime];
    const s = x.timeSlot ? SLOT_ORDER.indexOf(x.timeSlot) : -1;
    return [s >= 0 ? 1 : 2, String(s >= 0 ? s : 9)];
  };
  const [ra, ka] = rank(a);
  const [rb, kb] = rank(b);
  if (ra !== rb) return ra - rb;
  if (ka !== kb) return ka < kb ? -1 : 1;
  return a.title.localeCompare(b.title, "th");
}

/** ข้อความช่วงเวลาบนการ์ด: "20:00 น." > ช่วง (เช้า/บ่าย/ก่อนไลฟ์…) > null (ไม่แต่งว่า "ทั้งวัน") */
export function slotText(p: { startTime?: string | null; timeSlot?: string | null }): string | null {
  if (p.startTime) return `${p.startTime} น.`;
  if (p.timeSlot) return (TIME_SLOT_LABEL as Record<string, string>)[p.timeSlot] ?? null;
  return null;
}

// ---------------------------------------------------------------------------
// ตัวกรอง (แคมเปญ / ช่องทาง / สถานะ / ประเภท) — ค้างใน URL
// ---------------------------------------------------------------------------

export interface CalendarFilters {
  campaign?: string;
  channel?: string;
  status?: string;
  type?: string;
}

export const FILTER_KEYS: readonly (keyof CalendarFilters)[] = ["campaign", "channel", "status", "type"];

export function parseFilters(sp: Record<string, string | string[] | undefined>): CalendarFilters {
  const one = (k: string): string | undefined => {
    const v = Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined);
    return typeof v === "string" && v.length > 0 && v.length <= 80 ? v : undefined;
  };
  return { campaign: one("campaign"), channel: one("channel"), status: one("status"), type: one("type") };
}

export interface FilterablePiece {
  campaignId: string;
  campaignType: string | null;
  channel: string | null;
  effectiveStatus: string;
  contentTypeCode: string | null;
}

export function applyFilters<T extends FilterablePiece>(items: readonly T[], f: CalendarFilters): T[] {
  return items.filter(
    (p) =>
      (!f.campaign || p.campaignId === f.campaign) &&
      (!f.channel || p.channel === f.channel) &&
      (!f.status || p.effectiveStatus === f.status) &&
      (!f.type || p.contentTypeCode === f.type)
  );
}

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterOptions {
  campaigns: FilterOption[];
  channels: FilterOption[];
  statuses: FilterOption[];
  types: string[];
}

/** ตัวเลือกจากข้อมูลที่ดึงมา (ก่อนกรอง) — แคมเปญ = เฉพาะแคมเปญจริง (ไม่รวมงานเดี่ยว content_task ที่ชื่อแคมเปญ = ชื่อชิ้น) */
export function filterOptions(items: readonly (FilterablePiece & { campaignName: string | null })[]): FilterOptions {
  const campaigns = new Map<string, string>();
  const channels = new Set<string>();
  const statuses = new Set<string>();
  const types = new Set<string>();
  for (const p of items) {
    if (p.campaignType && p.campaignType !== "content_task" && p.campaignName) campaigns.set(p.campaignId, p.campaignName);
    if (p.channel) channels.add(p.channel);
    statuses.add(p.effectiveStatus);
    if (p.contentTypeCode) types.add(p.contentTypeCode);
  }
  return {
    campaigns: [...campaigns].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "th")),
    channels: [...channels].map((value) => ({ value, label: (CHANNEL_LABEL as Record<string, string>)[value] ?? "ช่องทางอื่น" })),
    statuses: [...statuses].map((value) => ({ value, label: PIECE_STATUS_LABEL[value as EffectivePieceStatus] ?? "สถานะอื่น" })),
    types: [...types],
  };
}

// ---------------------------------------------------------------------------
// เทศกาล (campaign_calendar 0034 — วันมาจาก DB ห้ามเขียนวันเอง)
// ---------------------------------------------------------------------------

export interface FestivalInput {
  nameTh: string;
  eventDate: string;
  durationDays: number;
}

export interface FestivalSpan {
  name: string;
  from: string;
  to: string;
}

/** เทศกาลที่ช่วงวันคร่อมช่วงที่แสดง — [eventDate, eventDate + duration − 1] */
export function festivalSpansInRange(events: readonly FestivalInput[], from: string, to: string): FestivalSpan[] {
  const out: FestivalSpan[] = [];
  for (const e of events) {
    if (!isRealDate(e.eventDate)) continue;
    const dur = Number.isFinite(e.durationDays) && e.durationDays >= 1 ? Math.floor(e.durationDays) : 1;
    const end = addDays(e.eventDate, dur - 1);
    if (e.eventDate <= to && end >= from) out.push({ name: e.nameTh, from: e.eventDate, to: end });
  }
  return out.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

export function festivalsOnDay(spans: readonly FestivalSpan[], day: string): FestivalSpan[] {
  return spans.filter((s) => s.from <= day && day <= s.to);
}

// ---------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------

export interface CalendarUrlState extends CalendarFilters {
  view: CalendarView;
  d?: string;
}

/** สร้าง query string ของหน้าปฏิทิน (คง filter · ไม่ใส่ค่าว่าง) */
export function calendarHref(s: CalendarUrlState, over: Partial<CalendarUrlState> = {}): string {
  const m = { ...s, ...over };
  const p = new URLSearchParams();
  p.set("view", m.view);
  if (m.d) p.set("d", m.d);
  for (const k of FILTER_KEYS) if (m[k]) p.set(k, m[k] as string);
  return `/marketing/calendar?${p.toString()}`;
}

/** เลขจำนวนชิ้นต่อวัน (ใช้กับมุมมองเดือน) — นับตามที่ครอบวันนั้น */
export function countsByDay<T extends Dated>(items: readonly T[], days: readonly string[]): Record<string, number> {
  const g = groupByDay(items, days);
  return Object.fromEntries(days.map((d) => [d, g[d].length]));
}

// ---------------------------------------------------------------------------
// ป้ายช่วงเวลา (พ.ศ.)
// ---------------------------------------------------------------------------

const MONTH_LONG = new Intl.DateTimeFormat("th-TH", { timeZone: "UTC", month: "long", year: "numeric" });
const DAY_MONTH_SHORT = new Intl.DateTimeFormat("th-TH", { timeZone: "UTC", day: "numeric", month: "short" });
const DAY_MONTH_YEAR_SHORT = new Intl.DateTimeFormat("th-TH", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

/** สัปดาห์: "5–11 ต.ค. 2569" (เดือนเดียวกัน) · "28 ก.ย. – 4 ต.ค. 2569" · เดือน/รายการ: "ตุลาคม 2569" */
export function periodLabel(view: CalendarView, anchor: string): string {
  if (view !== "week") return MONTH_LONG.format(toUtc(monthStartOf(anchor)));
  const { from, to } = weekRangeOf(anchor);
  const a = toUtc(from);
  const b = toUtc(to);
  if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) {
    return `${a.getUTCDate()}–${DAY_MONTH_YEAR_SHORT.format(b)}`;
  }
  return `${DAY_MONTH_SHORT.format(a)} – ${DAY_MONTH_YEAR_SHORT.format(b)}`;
}

/** เลขวันที่ของ "YYYY-MM-DD" (1–31) */
export function dayOfMonth(date: string): number {
  return toUtc(date).getUTCDate();
}

// ---------------------------------------------------------------------------
// ช่วงปีที่สมเหตุผลของ ?d= (QA ต่ำ: ปีหลุดทำให้กริดว่าง/คำนวณแปลก) — นอกช่วง = กลับวันนี้
// ---------------------------------------------------------------------------

export const MIN_CALENDAR_YEAR = 2025;
export const MAX_CALENDAR_YEAR = 2030;

/** วันที่จริงและปีอยู่ใน 2025–2030 */
export function isCalendarDate(s: unknown): s is string {
  if (!isRealDate(s)) return false;
  const y = Number(s.slice(0, 4));
  return y >= MIN_CALENDAR_YEAR && y <= MAX_CALENDAR_YEAR;
}

// ---------------------------------------------------------------------------
// งานหลายวัน — แถบเดียวบนหัวสัปดาห์ (ไม่ซ้ำทุกวัน)
// ---------------------------------------------------------------------------

export function isMultiDay(item: Dated): boolean {
  return Boolean(item.resolvedStart && item.resolvedEnd && item.resolvedEnd > item.resolvedStart);
}

export interface SpanBar<T> {
  item: T;
  /** คอลัมน์เริ่ม/จบ 1–7 (จ–อา) หลังตัดให้อยู่ในสัปดาห์ */
  startCol: number;
  endCol: number;
  /** ต่อไปก่อนสัปดาห์นี้ / ต่อหลังสัปดาห์นี้ (แสดงลูกศร) */
  continuesBefore: boolean;
  continuesAfter: boolean;
  /** แถวที่แถบอยู่ (0..) — แถบที่ช่วงชนกันไม่ซ้อนแถวเดียวกัน */
  lane: number;
}

/** วางแถบงานหลายวันของสัปดาห์ (จองแถวแบบ greedy เรียงตามวันเริ่มแล้วยาวก่อน) */
export function layoutSpans<T extends Dated>(items: readonly T[], weekFrom: string): SpanBar<T>[] {
  const weekTo = addDays(weekFrom, 6);
  const cands = items
    .filter((i) => isMultiDay(i) && (i.resolvedStart as string) <= weekTo && (i.resolvedEnd as string) >= weekFrom)
    .map((item) => {
      const s = item.resolvedStart as string;
      const e = item.resolvedEnd as string;
      const cs = s < weekFrom ? weekFrom : s;
      const ce = e > weekTo ? weekTo : e;
      return { item, startCol: weekdayIndex(cs) + 1, endCol: weekdayIndex(ce) + 1, continuesBefore: s < weekFrom, continuesAfter: e > weekTo };
    })
    .sort((a, b) => a.startCol - b.startCol || b.endCol - b.startCol - (a.endCol - a.startCol));
  const laneEnds: number[] = [];
  return cands.map((c) => {
    let lane = laneEnds.findIndex((end) => end < c.startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(c.endCol);
    } else {
      laneEnds[lane] = c.endCol;
    }
    return { ...c, lane };
  });
}

/** วันที่ของรายการแบบ "แสดงครั้งเดียว" ในช่วงที่เห็น: วันเริ่ม หรือวันแรกของช่วงถ้างานเริ่มก่อนหน้านั้น */
export function firstVisibleDay(item: Dated, rangeFrom: string): string | null {
  if (!item.resolvedStart) return null;
  return item.resolvedStart < rangeFrom ? rangeFrom : item.resolvedStart;
}

/** เทศกาลที่ "เริ่ม" (หรือเริ่มก่อนช่วงและนี่คือวันแรกที่เห็น) ในวันนี้ — มุมมองรายการแสดงครั้งเดียว */
export function festivalsStartingOn(spans: readonly FestivalSpan[], day: string, rangeFrom: string): FestivalSpan[] {
  return spans.filter((s) => firstVisibleDay({ resolvedStart: s.from, resolvedEnd: s.to }, rangeFrom) === day && s.to >= day);
}
