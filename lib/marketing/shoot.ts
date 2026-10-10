// lib/marketing/shoot.ts — ตรรกะ pure ของหน้า "รอบถ่าย" (/marketing/shoot · แผน §4 P1b ข้อ 3)
// ชุดชิ้นของหน้านี้ = approved + footage_status 'needs_shoot' + วันอยู่ในสัปดาห์ (นิยามเดียวกับตัวนับ shoot_this_week ของ v_content_inbox_counts)
// ไม่มีชิ้น in_review ในหน้านี้ (ยังไม่อนุมัติ = ยังไม่มีบทสุดท้ายให้ถ่าย) · ตัวเลขเวลาประเมินรวมเฉพาะชิ้นที่ระบุ (ไม่เดาเป็น 0)

import { addDays, isCalendarDate, weekRangeOf } from "@/lib/marketing/calendar-view";
import { SHOOT_LOCATIONS, SHOOT_LOCATION_LABEL } from "@/lib/marketing/piece-labels";
import { formatThaiDay } from "@/lib/marketing/format";
import type { ClipShot } from "@/lib/marketing/clip-brief";
import type { PieceRow } from "@/lib/marketing/piece-types";

export const UNSPECIFIED_LOCATION = "unspecified";
export type LocationKey = (typeof SHOOT_LOCATIONS)[number] | typeof UNSPECIFIED_LOCATION;
export const LOCATION_ORDER: readonly LocationKey[] = [...SHOOT_LOCATIONS, UNSPECIFIED_LOCATION];

export function locationLabel(key: LocationKey): string {
  return key === UNSPECIFIED_LOCATION ? "ยังไม่ระบุสถานที่" : SHOOT_LOCATION_LABEL[key];
}

export function locationKeyOf(piece: Pick<PieceRow, "shootLocation">): LocationKey {
  const v = piece.shootLocation;
  return v && (SHOOT_LOCATIONS as readonly string[]).includes(v) ? (v as LocationKey) : UNSPECIFIED_LOCATION;
}

// ---------------------------------------------------------------------------
// สัปดาห์
// ---------------------------------------------------------------------------

/** วันจันทร์ของสัปดาห์ที่ดู: ?w= (วันใดก็ได้ ปี 2025–2030) · ไม่ถูกต้อง = สัปดาห์นี้ */
export function shootWeekFrom(todayTh: string, param: string | null | undefined): string {
  const base = param && isCalendarDate(param) ? param : todayTh;
  return weekRangeOf(isCalendarDate(base) ? base : todayTh).from;
}

export function shootWeekHref(weekFrom: string, offsetWeeks: -1 | 1, todayTh: string): string | null {
  const target = addDays(weekFrom, 7 * offsetWeeks);
  if (!isCalendarDate(target)) return null;
  return target === shootWeekFrom(todayTh, null) ? "/marketing/shoot" : `/marketing/shoot?w=${target}`;
}

export function shootWeekLabel(weekFrom: string): string {
  const strip = (d: string) => formatThaiDay(d).replace(/^\S+\s/, "");
  return `${strip(weekFrom)} – ${strip(addDays(weekFrom, 6))}`;
}

// ---------------------------------------------------------------------------
// ช็อต (clip_brief.shots) — ทนข้อมูลไม่ครบ: ช็อตที่ไม่มี id/desc ถูกข้าม ไม่ throw
// ---------------------------------------------------------------------------

export function shotsOf(piece: Pick<PieceRow, "clipBrief">): ClipShot[] {
  const raw = (piece.clipBrief as { shots?: unknown } | null)?.shots;
  if (!Array.isArray(raw)) return [];
  const out: ClipShot[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const r = s as Record<string, unknown>;
    if (typeof r.id !== "string" || r.id === "" || typeof r.desc !== "string") continue;
    out.push({ id: r.id, desc: r.desc, done: r.done === true, ...(typeof r.ref_role === "string" ? { ref_role: r.ref_role as ClipShot["ref_role"] } : {}) });
  }
  return out;
}

export interface ShootItem {
  piece: PieceRow;
  shots: ClipShot[];
}

export function toShootItems(rows: readonly PieceRow[]): ShootItem[] {
  return rows
    .filter((p) => p.pieceStatus === "approved" && p.footageStatus === "needs_shoot")
    .map((piece) => ({ piece, shots: shotsOf(piece) }))
    .sort((a, b) => (a.piece.resolvedStart ?? "9999").localeCompare(b.piece.resolvedStart ?? "9999") || a.piece.title.localeCompare(b.piece.title, "th"));
}

/** สถานะติ๊กปัจจุบันของช็อต = ค่าจาก server ทับด้วยค่าที่ผู้ใช้เพิ่งติ๊ก (local) */
export type DoneMap = Record<string, boolean>;
const key = (stepId: string, shotId: string) => `${stepId}:${shotId}`;
export const doneKey = key;

export function isShotDone(item: ShootItem, shot: ClipShot, local: DoneMap): boolean {
  const v = local[key(item.piece.stepId, shot.id)];
  return v === undefined ? shot.done : v;
}

export function remainingShots(item: ShootItem, local: DoneMap): number {
  return item.shots.filter((s) => !isShotDone(item, s, local)).length;
}

// ---------------------------------------------------------------------------
// จัดกลุ่ม + สรุป
// ---------------------------------------------------------------------------

export interface LocationGroup {
  key: LocationKey;
  items: ShootItem[];
}

export function groupByLocation(items: readonly ShootItem[]): LocationGroup[] {
  return LOCATION_ORDER.map((k) => ({ key: k, items: items.filter((i) => locationKeyOf(i.piece) === k) })).filter((g) => g.items.length > 0);
}

export interface ShootSummary {
  pieces: number;
  shots: number;
  shotsDone: number;
  /** รวมนาทีเฉพาะชิ้นที่ระบุ — null เมื่อไม่มีชิ้นไหนระบุ */
  minutes: number | null;
  unknownMinutesPieces: number;
}

export function summarize(items: readonly ShootItem[], local: DoneMap): ShootSummary {
  const known = items.map((i) => i.piece.shootMinutesEst).filter((n): n is number => n !== null);
  return {
    pieces: items.length,
    shots: items.reduce((n, i) => n + i.shots.length, 0),
    shotsDone: items.reduce((n, i) => n + i.shots.filter((s) => isShotDone(i, s, local)).length, 0),
    minutes: known.length > 0 ? known.reduce((a, b) => a + b, 0) : null,
    unknownMinutesPieces: items.length - known.length,
  };
}

/** ชิ้นที่ติ๊ก "ถ่ายครบ" แต่ยังมีช็อตไม่ติ๊ก — ต้องถามยืนยันก่อนจบรอบ (3.8) */
export function needsShotConfirm(items: readonly ShootItem[], completed: ReadonlySet<string>, local: DoneMap): { stepId: string; title: string; remaining: number }[] {
  return items
    .filter((i) => completed.has(i.piece.stepId))
    .map((i) => ({ stepId: i.piece.stepId, title: i.piece.title, remaining: remainingShots(i, local) }))
    .filter((x) => x.remaining > 0);
}
