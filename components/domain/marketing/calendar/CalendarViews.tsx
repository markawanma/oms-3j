// CalendarViews — 3 มุมมองของปฏิทินใหม่ (สัปดาห์ · เดือน · รายการ) + แผนเดิม (legacy lane) + แถบเครื่องมือ — server-safe
// ข้อมูลทั้งหมดมาจาก view ผ่าน getCalendarData · ที่นี่จัดกลุ่ม/เรียง/แสดง ไม่ตัดสินสถานะ/ธง/โควตา
// - ไม่มีแถบโฮสต์รายวัน (ไม่มี entity ตารางเวรโฮสต์ใน schema — B8) · โฮสต์แสดงเป็น chip บนการ์ดที่ระบุ expected_host เท่านั้น
// - ไม่มีลากวาง: เลื่อนวันผ่านปุ่มบนการ์ด (D7) · ไม่มีเลขขั้น (brief 0.4)

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { CalendarPieceCard } from "@/components/domain/marketing/calendar/CalendarPieceCard";
import { CalendarFilters } from "@/components/domain/marketing/calendar/CalendarFilters";
import { AddMenu } from "@/components/domain/marketing/calendar/AddMenu";
import { RememberView } from "@/components/domain/marketing/calendar/RememberView";
import { ContentTypeChip } from "@/components/domain/marketing/ContentTypeChip";
import {
  CALENDAR_VIEWS,
  VIEW_LABEL,
  WEEKDAY_SHORT_TH,
  WEEKDAY_TH,
  addDays,
  calendarHref,
  compareInDay,
  dayOfMonth,
  festivalsOnDay,
  festivalsStartingOn,
  firstVisibleDay,
  groupByDay,
  isMultiDay,
  layoutSpans,
  monthGridOf,
  periodLabel,
  canShift,
  shiftAnchor,
  slotText,
} from "@/lib/marketing/calendar-view";
import type { CalendarUrlState, FestivalSpan, FilterOptions } from "@/lib/marketing/calendar-view";
import type { LegacyStep } from "@/lib/marketing/calendar-types";
import { EFFECTIVE_STATUS_LABEL } from "@/lib/marketing/campaign-types";
import { formatThaiDay } from "@/lib/marketing/format";
import { CHANNEL_LABEL, pieceStatusLabel } from "@/lib/marketing/piece-labels";
import type { ContentTypeRow } from "@/lib/marketing/content-types";
import type { PieceRow } from "@/lib/marketing/piece-types";

const NAV_BTN = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50";

// ---------------------------------------------------------------------------
// แถบเครื่องมือ
// ---------------------------------------------------------------------------

export function CalendarToolbar({
  state,
  anchor,
  todayTh,
  options,
  typeLabels,
}: {
  state: CalendarUrlState;
  anchor: string;
  todayTh: string;
  options: FilterOptions;
  typeLabels: Record<string, string>;
}) {
  const { view } = state;
  return (
    <div className="space-y-3">
      <RememberView view={view} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-zinc-900">ปฏิทิน</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {canShift(view, anchor, -1) ? (
              <Link href={calendarHref(state, { d: shiftAnchor(view, anchor, -1) })} aria-label={view === "week" ? "สัปดาห์ก่อน" : "เดือนก่อน"} className={NAV_BTN}>
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </Link>
            ) : (
              <span role="img" aria-label={view === "week" ? "ไม่มีสัปดาห์ก่อนหน้านี้" : "ไม่มีเดือนก่อนหน้านี้"} className={`${NAV_BTN} cursor-not-allowed opacity-40`}>
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </span>
            )}
            <span className="min-w-[8.5rem] text-center text-base font-semibold text-zinc-900 tabular-nums" aria-live="polite">
              {periodLabel(view, anchor)}
            </span>
            {canShift(view, anchor, 1) ? (
              <Link href={calendarHref(state, { d: shiftAnchor(view, anchor, 1) })} aria-label={view === "week" ? "สัปดาห์ถัดไป" : "เดือนถัดไป"} className={NAV_BTN}>
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            ) : (
              <span role="img" aria-label={view === "week" ? "ไม่มีสัปดาห์ถัดไป" : "ไม่มีเดือนถัดไป"} className={`${NAV_BTN} cursor-not-allowed opacity-40`}>
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </span>
            )}
            <Link href={calendarHref(state, { d: todayTh })} className={NAV_BTN}>
              วันนี้
            </Link>
          </div>
        </div>
        <AddMenu defaultDate={anchor} todayTh={todayTh} />
      </div>

      <nav aria-label="มุมมองปฏิทิน" className="flex w-full gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1 sm:w-auto sm:self-start sm:inline-flex">
        {CALENDAR_VIEWS.map((v) => (
          <Link
            key={v}
            href={calendarHref(state, { view: v })}
            aria-current={v === view ? "page" : undefined}
            className={`flex min-h-11 flex-1 items-center justify-center rounded-md px-4 text-sm font-semibold sm:flex-none ${
              v === view ? "bg-white text-primary-700 shadow-sm" : "text-zinc-700 hover:text-zinc-900"
            }`}
          >
            {VIEW_LABEL[v]}
          </Link>
        ))}
      </nav>

      {/* มือถือ: ตัวกรองพับไว้ (ไม่ให้กินจอก่อนถึงวัน) กางอัตโนมัติเมื่อมีตัวกรองใช้อยู่ · PC: แสดงแถวเต็ม */}
      <details className="rounded-lg border border-zinc-200 bg-white lg:hidden" open={Boolean(state.campaign || state.channel || state.status || state.type)}>
        <summary className="flex min-h-11 cursor-pointer select-none items-center px-3 text-sm font-semibold text-zinc-800">ตัวกรอง</summary>
        <div className="border-t border-zinc-100 p-3">
          <CalendarFilters state={state} options={options} typeLabels={typeLabels} idPrefix="cal-m" />
        </div>
      </details>
      <div className="hidden lg:block">
        <CalendarFilters state={state} options={options} typeLabels={typeLabels} idPrefix="cal-d" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ชิ้นของวัน
// ---------------------------------------------------------------------------

function DayCards({
  entries,
  contentTypes,
  todayTh,
}: {
  entries: { item: PieceRow; continuation: boolean }[];
  contentTypes: ContentTypeRow[];
  todayTh: string;
}) {
  const sorted = [...entries].sort((a, b) => compareInDay(a.item, b.item));
  return (
    <ul className="space-y-2">
      {sorted.map(({ item, continuation }) => (
        <li key={item.stepId}>
          <CalendarPieceCard piece={item} contentTypes={contentTypes} continuation={continuation} todayTh={todayTh} />
        </li>
      ))}
    </ul>
  );
}

function FestivalChips({ spans }: { spans: FestivalSpan[] }) {
  if (spans.length === 0) return null;
  return (
    <ul className="space-y-1">
      {spans.map((s) => (
        <li key={`${s.name}-${s.from}`} className="rounded-sm bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-800">
          เทศกาล: {s.name}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// สัปดาห์ — PC (lg) 7 คอลัมน์ · มือถือ/แท็บเล็ต = รายการแนวตั้งต่อวัน (ไม่ใช่ตาราง 7 คอลัมน์)
// ---------------------------------------------------------------------------

const COL_START = ["", "col-start-1", "col-start-2", "col-start-3", "col-start-4", "col-start-5", "col-start-6", "col-start-7"];
const COL_SPAN = ["", "col-span-1", "col-span-2", "col-span-3", "col-span-4", "col-span-5", "col-span-6", "col-span-7"];

function rangeLabel(from: string, to: string): string {
  return `${formatThaiDay(from).replace(/^\S+\s/, "")} – ${formatThaiDay(to).replace(/^\S+\s/, "")}`;
}

/** งานหลายวัน + เทศกาลหลายวัน ของสัปดาห์ → แถบเดียวบนหัวสัปดาห์ (PC) / รายการรวมด้านบน (มือถือ) — ไม่ซ้ำทุกวัน (มติเจ้าของ 10 ต.ค.) */
function SpanBand({
  weekFrom,
  pieces,
  festivals,
  contentTypes,
  todayTh,
}: {
  weekFrom: string;
  pieces: PieceRow[];
  festivals: FestivalSpan[];
  contentTypes: ContentTypeRow[];
  todayTh: string;
}) {
  type Band = { key: string; resolvedStart: string; resolvedEnd: string; piece?: PieceRow; festival?: FestivalSpan };
  const items: Band[] = [
    ...pieces.filter(isMultiDay).map((p) => ({ key: p.stepId, resolvedStart: p.resolvedStart as string, resolvedEnd: p.resolvedEnd as string, piece: p })),
    ...festivals.filter((f) => f.to > f.from).map((f) => ({ key: `fest-${f.name}-${f.from}`, resolvedStart: f.from, resolvedEnd: f.to, festival: f })),
  ];
  const bars = layoutSpans(items, weekFrom);
  if (bars.length === 0) return null;
  const lanes = Math.max(...bars.map((b) => b.lane)) + 1;
  const colorOf = (code: string | null) => contentTypes.find((c) => c.code === code)?.colorHex ?? "#71717a";

  return (
    <section aria-label="งานต่อเนื่องและเทศกาลของสัปดาห์" className="mb-3">
      {/* PC: แถบพาดช่วงวันที่คร่อม */}
      <div className="hidden space-y-1 lg:block">
        {Array.from({ length: lanes }, (_, lane) => (
          <div key={lane} className="grid grid-cols-7 gap-2">
            {bars
              .filter((b) => b.lane === lane)
              .map((b) => {
                const cls = `${COL_START[b.startCol]} ${COL_SPAN[b.endCol - b.startCol + 1]} min-w-0`;
                const range = rangeLabel(b.item.resolvedStart, b.item.resolvedEnd);
                if (b.item.festival) {
                  return (
                    <div key={b.item.key} className={`${cls} flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1.5 text-xs font-medium text-zinc-800`}>
                      {b.continuesBefore && <ChevronLeft className="h-3 w-3 shrink-0" aria-hidden="true" />}
                      <span className="min-w-0 truncate">
                        เทศกาล: {b.item.festival.name} · {range}
                      </span>
                      {b.continuesAfter && <ChevronRight className="ml-auto h-3 w-3 shrink-0" aria-hidden="true" />}
                    </div>
                  );
                }
                const p = b.item.piece as PieceRow;
                return (
                  <Link
                    key={b.item.key}
                    href={`/marketing/pieces/${p.stepId}?from=calendar`}
                    title={`${p.title} · ${range}`}
                    className={`${cls} flex min-h-11 items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs hover:border-zinc-500`}
                  >
                    {b.continuesBefore && <ChevronLeft className="h-3 w-3 shrink-0" aria-hidden="true" />}
                    <span aria-hidden="true" style={{ backgroundColor: colorOf(p.contentTypeCode) }} className="h-2 w-2 shrink-0 rounded-full" />
                    <span className="min-w-0 truncate font-semibold text-zinc-900">{p.title}</span>
                    <span className="shrink-0 text-zinc-700">
                      · {range} · {pieceStatusLabel(p.effectiveStatus)}
                    </span>
                    {b.continuesAfter && <ChevronRight className="ml-auto h-3 w-3 shrink-0" aria-hidden="true" />}
                  </Link>
                );
              })}
          </div>
        ))}
      </div>

      {/* มือถือ/แท็บเล็ต: พับเป็นบรรทัดเดียว "งานต่อเนื่อง n รายการ ▸" (กางได้) — ให้รายการวันแรกขึ้นเร็ว · ไม่ซ้ำทุกวัน */}
      <details className="rounded-md border border-zinc-200 bg-white lg:hidden">
        <summary className="flex min-h-11 cursor-pointer select-none items-center gap-2 px-3 text-sm font-semibold text-zinc-900">
          งานต่อเนื่อง {bars.length} รายการ
          <span aria-hidden="true">▸</span>
        </summary>
        <ul className="space-y-2 px-2 pb-2">
          {bars.map((b) =>
            b.item.piece ? (
              <li key={b.item.key}>
                <CalendarPieceCard piece={b.item.piece} contentTypes={contentTypes} todayTh={todayTh} />
              </li>
            ) : (
              <li key={b.item.key} className="rounded-md bg-zinc-100 px-2 py-1.5 text-xs font-medium text-zinc-800">
                เทศกาล: {b.item.festival?.name} · {rangeLabel(b.item.resolvedStart, b.item.resolvedEnd)}
              </li>
            )
          )}
        </ul>
      </details>
    </section>
  );
}

export function WeekView({
  weekFrom,
  pieces,
  festivals,
  contentTypes,
  todayTh,
}: {
  weekFrom: string;
  pieces: PieceRow[];
  festivals: FestivalSpan[];
  contentTypes: ContentTypeRow[];
  todayTh: string;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekFrom, i));
  // ช่องของแต่ละวันมีเฉพาะงานวันเดียว · งาน/เทศกาลหลายวันอยู่ในแถบด้านบน
  const by = groupByDay(
    pieces.filter((p) => !isMultiDay(p)),
    days
  );
  const dayFestivals = festivals.filter((f) => f.to <= f.from);
  return (
    <section aria-label={`สัปดาห์ ${formatThaiDay(days[0])} ถึง ${formatThaiDay(days[6])}`}>
      <SpanBand weekFrom={weekFrom} pieces={pieces} festivals={festivals} contentTypes={contentTypes} todayTh={todayTh} />
      <ol className="grid gap-3 lg:grid-cols-7 lg:gap-2">
        {days.map((d, i) => {
          const isToday = d === todayTh;
          const entries = by[d];
          return (
            <li
              key={d}
              aria-current={isToday ? "date" : undefined}
              className={`min-w-0 space-y-2 rounded-lg border p-2 ${isToday ? "border-primary-600 bg-primary-50" : "border-zinc-200 bg-zinc-50"}`}
            >
              <h3 className="flex items-baseline justify-between gap-1">
                <span className="text-sm font-semibold text-zinc-900">{WEEKDAY_TH[i]}</span>
                <span className="text-sm font-bold text-zinc-900 tabular-nums">
                  {dayOfMonth(d)}
                  {isToday && <span className="ml-1 text-xs font-semibold text-primary-700">วันนี้</span>}
                </span>
              </h3>
              <FestivalChips spans={festivalsOnDay(dayFestivals, d)} />
              {entries.length === 0 ? (
                <p className="py-1 text-xs text-zinc-600">ไม่มีชิ้นงาน</p>
              ) : (
                <DayCards entries={entries} contentTypes={contentTypes} todayTh={todayTh} />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// เดือน — กริด 7 คอลัมน์ (จำนวนเป็นข้อความ + จุดสีประเภท) · กดวัน → รายการของวันนั้นด้านล่าง
// ---------------------------------------------------------------------------

export function MonthView({
  state,
  anchor,
  selectedDay,
  pieces,
  festivals,
  contentTypes,
  todayTh,
}: {
  state: CalendarUrlState;
  anchor: string;
  selectedDay: string;
  pieces: PieceRow[];
  festivals: FestivalSpan[];
  contentTypes: ContentTypeRow[];
  todayTh: string;
}) {
  const grid = monthGridOf(anchor);
  const all = grid.weeks.flat();
  const by = groupByDay(pieces, all);
  const selected = by[selectedDay] ?? [];
  const colorOf = (code: string | null) => contentTypes.find((c) => c.code === code)?.colorHex ?? "#71717a";

  return (
    <section aria-label={`เดือน ${periodLabel("month", anchor)}`} className="space-y-4">
      <table className="w-full table-fixed border-separate border-spacing-1">
        <thead>
          <tr>
            {WEEKDAY_SHORT_TH.map((w, i) => (
              <th key={w} scope="col" className="py-1 text-center text-xs font-semibold text-zinc-700">
                <span aria-hidden="true">{w}</span>
                <span className="sr-only">{WEEKDAY_TH[i]}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((d) => {
                const inMonth = d >= grid.monthStart && d <= grid.monthEnd;
                const n = by[d].length;
                const isToday = d === todayTh;
                const isSel = d === selectedDay;
                const fest = festivalsOnDay(festivals, d).length > 0;
                const multi = by[d].filter((e) => isMultiDay(e.item)).length;
                const dots = Array.from(new Set(by[d].map((e) => e.item.contentTypeCode))).slice(0, 4);
                return (
                  <td key={d} className="p-0 align-top">
                    <Link
                      href={calendarHref(state, { d })}
                      aria-current={isSel ? "date" : undefined}
                      aria-label={`${formatThaiDay(d)} ${n > 0 ? `${n} ชิ้น` : "ไม่มีชิ้นงาน"}${multi > 0 ? ` (รวมงานต่อเนื่อง ${multi})` : ""}${fest ? " มีเทศกาล" : ""}${isToday ? " วันนี้" : ""}`}
                      className={`flex min-h-14 flex-col items-center justify-start gap-0.5 rounded-md border px-0.5 py-1 text-center ${
                        isSel ? "border-primary-600 bg-primary-50" : isToday ? "border-zinc-900 bg-white" : "border-zinc-200 bg-white hover:bg-zinc-50"
                      } ${inMonth ? "" : "opacity-60"}`}
                    >
                      <span className={`text-sm tabular-nums ${isToday ? "font-bold text-zinc-900" : "font-medium text-zinc-800"}`}>{dayOfMonth(d)}</span>
                      {n > 0 && (
                        <span className="text-xs leading-none text-zinc-800 tabular-nums">
                          {n} ชิ้น{multi > 0 && <span aria-hidden="true">↔</span>}
                        </span>
                      )}
                      {n > 0 && (
                        <span className="flex gap-0.5" aria-hidden="true">
                          {dots.map((c, i) => (
                            <span key={`${c}-${i}`} style={{ backgroundColor: colorOf(c) }} className="h-1.5 w-1.5 rounded-full" />
                          ))}
                        </span>
                      )}
                      {fest && <span className="text-xs leading-none text-zinc-700">เทศกาล</span>}
                    </Link>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-zinc-700">
        <span aria-hidden="true">↔</span> = จำนวนในวันนั้นรวมงานต่อเนื่องหลายวันที่คร่อมวันนั้น (นับซ้ำทุกวันที่คร่อม) — กดวันเพื่อดูรายละเอียดและช่วงวันของแต่ละงาน
      </p>

      <div className="space-y-2">
        <h2 className="text-base font-semibold text-zinc-900">{formatThaiDay(selectedDay, true)}</h2>
        <FestivalChips spans={festivalsOnDay(festivals, selectedDay)} />
        {selected.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 bg-white p-3 text-sm text-zinc-700">ไม่มีชิ้นงานในวันนี้ — กด “เพิ่มชิ้นงาน” ด้านบนเพื่อวางแผน</p>
        ) : (
          <DayCards entries={selected} contentTypes={contentTypes} todayTh={todayTh} />
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// รายการ — เฉพาะวันที่มีงาน (หัววัน sticky) · งานหลายวันอยู่ทุกวันที่ครอบ ป้าย "ต่อเนื่อง"
// ---------------------------------------------------------------------------

export function ListView({
  anchor,
  pieces,
  festivals,
  contentTypes,
  todayTh,
}: {
  anchor: string;
  pieces: PieceRow[];
  festivals: FestivalSpan[];
  contentTypes: ContentTypeRow[];
  todayTh: string;
}) {
  const grid = monthGridOf(anchor);
  const days: string[] = [];
  for (let d = grid.monthStart; d <= grid.monthEnd; d = addDays(d, 1)) days.push(d);
  // งานหลายวันแสดงครั้งเดียวที่วันเริ่ม (หรือวันแรกของเดือนถ้าเริ่มก่อนหน้า) พร้อมช่วงวันบนการ์ด — ไม่ซ้ำทุกวัน
  const by: Record<string, { item: PieceRow; continuation: boolean }[]> = Object.fromEntries(days.map((d) => [d, []]));
  for (const p of pieces) {
    const d = firstVisibleDay(p, grid.monthStart);
    if (d && d >= grid.monthStart && d <= grid.monthEnd && by[d]) by[d].push({ item: p, continuation: false });
  }
  const filled = days.filter((d) => by[d].length > 0 || festivalsStartingOn(festivals, d, grid.monthStart).length > 0);

  if (filled.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-700">
        ไม่มีชิ้นงานใน{periodLabel("month", anchor)} — กด “เพิ่มชิ้นงาน” ด้านบนเพื่อวางแผน
      </p>
    );
  }
  return (
    <section aria-label={`รายการ ${periodLabel("month", anchor)}`} className="space-y-4">
      {filled.map((d) => (
        <div key={d} className="space-y-2">
          <h2 className="sticky top-16 z-[5] -mx-1 bg-zinc-50/95 px-1 py-1 text-sm font-bold text-zinc-900 md:top-[calc(4rem+3.5rem)]">
            {formatThaiDay(d, true)}
            {d === todayTh && <span className="ml-2 rounded-sm bg-primary-100 px-1.5 text-xs font-semibold text-primary-700">วันนี้</span>}
          </h2>
          <FestivalChips spans={festivalsStartingOn(festivals, d, grid.monthStart)} />
          <DayCards entries={by[d]} contentTypes={contentTypes} todayTh={todayTh} />
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// แผนเดิม (legacy lane) — steps ที่ไม่อยู่ใน workflow ใหม่ · อ่านอย่างเดียว · ลิงก์หน้าเดิม
// ---------------------------------------------------------------------------

export function LegacyLane({
  steps,
  from,
  to,
  contentTypes,
  filtersActive,
}: {
  steps: LegacyStep[];
  from: string;
  to: string;
  contentTypes: ContentTypeRow[];
  filtersActive: boolean;
}) {
  if (steps.length === 0) return null;
  const sorted = [...steps].sort((a, b) => (a.resolvedStart ?? "").localeCompare(b.resolvedStart ?? "") || compareInDay({ ...a, timeSlot: null }, { ...b, timeSlot: null }));
  return (
    <section aria-label="แผนเดิม" className="rounded-lg border border-dashed border-zinc-300 bg-white p-3">
      <h2 className="text-base font-semibold text-zinc-900">
        แผนเดิม ({steps.length}) <span className="text-sm font-normal text-zinc-700">· ช่วง {formatThaiDay(from)} – {formatThaiDay(to)}</span>
      </h2>
      <p className="mt-0.5 text-xs text-zinc-700">
        งานที่สร้างจากแผนสำเร็จรูป/Ad Copilot ก่อนระบบใหม่ — เปิดดูและแก้ที่หน้าเดิม
        {filtersActive && " · ตัวกรองด้านบนไม่ใช้กับแผนเดิม (แสดงครบ)"}
      </p>
      <ul className="mt-2 divide-y divide-zinc-100">
        {sorted.map((s) => {
          const ct = s.contentTypeCode ? contentTypes.find((c) => c.code === s.contentTypeCode) : undefined;
          const status = (EFFECTIVE_STATUS_LABEL as Record<string, string>)[s.effectiveStatus] ?? "ตามแผน";
          const channel = s.channel ? ((CHANNEL_LABEL as Record<string, string>)[s.channel] ?? s.channel) : null;
          const slot = slotText({ startTime: s.startTime });
          return (
            <li key={s.stepId}>
              <Link href={`/marketing/calendar/${s.stepId}`} className="block min-h-11 space-y-1 py-2.5 hover:bg-zinc-50">
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-700">
                  <span className="font-semibold tabular-nums">{formatThaiDay(s.resolvedStart)}</span>
                  {s.resolvedEnd && s.resolvedEnd !== s.resolvedStart && <span className="tabular-nums">– {formatThaiDay(s.resolvedEnd)}</span>}
                  {slot && <span>{slot}</span>}
                  <Badge tone="slate">แผนเดิม</Badge>
                  {ct && <ContentTypeChip contentType={ct} />}
                </span>
                <span className="block break-words text-sm font-semibold text-zinc-900">{s.title}</span>
                <span className="block text-xs text-zinc-700">
                  {[s.campaignType !== "content_task" ? s.campaignName : null, channel, status].filter(Boolean).join(" · ")}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

