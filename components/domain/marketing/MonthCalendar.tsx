"use client";

// MonthCalendar — the plan tab's primary date picker: a full month grid, the
// shape people already read calendars in. It replaced a horizontal ±7-day
// strip, which forced you to scroll to answer "what does this month look
// like?" and never showed the month as a whole.
//
// Same URL-driven contract as the rest of the CRM/marketing filters: picking a
// day (or flipping a month) pushes `?tab=plan&d=`, the server component
// re-fetches that month, and this renders the dots it hands back. No local
// copy of the task list lives here.

import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Per-day summary the page computes once from the month's rows. `alert` = at
 * least one task that day is blocked/waiting — worth a different colour than
 * "there is work here". */
export interface DayDots {
  count: number;
  alert: boolean;
}

const WEEKDAY_HEADER = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const MONTH_YEAR_FMT = new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric" });

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function MonthCalendar({
  dots,
  year,
  month,
  selectedDate,
  today,
}: {
  dots: Record<string, DayDots>;
  year: number;
  /** 1-12 */
  month: number;
  selectedDate: string;
  today: string;
}) {
  const router = useRouter();

  // Date-only math in UTC: these strings carry no time, so UTC keeps the
  // arithmetic from drifting a day near midnight in any timezone.
  const startWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0 = Sunday
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells: (string | null)[] = [
    ...Array.from({ length: startWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => isoDate(year, month, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function go(date: string) {
    router.push(`/marketing/calendar?tab=plan&d=${date}`);
  }

  /** Flip a month while keeping the day-of-month where it exists (Jan 31 →
   * Feb 28, not Mar 3), so stepping back and forth stays predictable. */
  function shiftMonth(delta: number) {
    const target = new Date(Date.UTC(year, month - 1 + delta, 1));
    const ty = target.getUTCFullYear();
    const tm = target.getUTCMonth() + 1;
    const selectedDay = Number(selectedDate.slice(8, 10));
    const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
    go(isoDate(ty, tm, Math.min(selectedDay, lastDay)));
  }

  const monthLabel = MONTH_YEAR_FMT.format(new Date(Date.UTC(year, month - 1, 1)));

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          aria-label="เดือนก่อนหน้า"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-primary-700"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <p className="text-sm font-bold text-zinc-900">{monthLabel}</p>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          aria-label="เดือนถัดไป"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-primary-700"
        >
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-1 grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAY_HEADER.map((w) => (
          <div key={w} className="py-1 text-[0.68rem] font-semibold text-zinc-400">
            {w}
          </div>
        ))}

        {cells.map((date, i) => {
          if (!date) return <div key={`pad-${i}`} aria-hidden="true" />;
          const d = dots[date];
          const isSelected = date === selectedDate;
          const isToday = date === today;
          const dayNum = Number(date.slice(8, 10));

          return (
            <button
              key={date}
              type="button"
              onClick={() => go(date)}
              aria-current={isSelected ? "date" : undefined}
              aria-label={`${dayNum} — ${d ? `${d.count} งาน` : "ไม่มีงาน"}`}
              className={`flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md text-sm transition-colors ${
                isSelected
                  ? "bg-primary-600 font-bold text-white"
                  : isToday
                    ? "font-bold text-primary-700 ring-1 ring-primary-300 ring-inset hover:bg-primary-50"
                    : "text-zinc-700 hover:bg-zinc-100"
              }`}
            >
              <span className="tabular-nums leading-none">{dayNum}</span>
              {/* dot carries "there is work here"; colour separates a normal
                  day from one holding something blocked/waiting */}
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  !d
                    ? "bg-transparent"
                    : isSelected
                      ? "bg-white"
                      : d.alert
                        ? "bg-amber-500"
                        : "bg-primary-600"
                }`}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-zinc-100 pt-2">
        <div className="flex items-center gap-3 text-[0.68rem] text-zinc-400">
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-primary-600" aria-hidden="true" /> มีงาน
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" /> ติดเงื่อนไข/รอข้อมูล
          </span>
        </div>
        {selectedDate !== today && (
          <button
            type="button"
            onClick={() => go(today)}
            className="rounded-full border border-zinc-300 px-2.5 py-1 text-[0.68rem] font-semibold text-zinc-600 hover:border-primary-600 hover:text-primary-700"
          >
            กลับวันนี้
          </button>
        )}
      </div>
    </div>
  );
}
