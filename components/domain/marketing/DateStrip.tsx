"use client";

// DateStrip — /marketing/calendar plan tab (design ux-content-calendar.md §2,
// phase-content-calendar-design.md §7 component table). Horizontal-scroll ±7
// days around the currently selected date, dot per day (gray = has tasks,
// red = a task that day is blocked/waiting_data), today + selected highlight.
// URL-driven like CrmChannelFilter/CrmDateRangeFilter: this component holds
// no calendar data itself, it only pushes `?tab=plan&d=YYYY-MM-DD` and lets
// the server page re-fetch.

import { useRouter } from "next/navigation";

export interface DayDots {
  count: number;
  alert: boolean;
}

function addDaysISO(dateStr: string, delta: number): string {
  // Date-only strings have no time component — arithmetic in UTC millis is
  // safe (no DST), mirrors CampaignCalendar's formatEventDate() pattern.
  const base = new Date(`${dateStr}T00:00:00Z`);
  const d = new Date(base.getTime() + delta * 86_400_000);
  return d.toISOString().slice(0, 10);
}

const WEEKDAY_FMT = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", weekday: "short" });
const DAY_FMT = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric" });

export function DateStrip({
  selectedDate,
  today,
  dots,
}: {
  selectedDate: string;
  today: string;
  /** Per-day dot info, keyed "YYYY-MM-DD" — only covers the currently
   * fetched month (design §4: whole month, one call). Days spilling into an
   * adjacent month from the ±7 window simply render no dot — accepted
   * limitation, not a bug (re-fetching a second month just to dot a handful
   * of edge days isn't worth the extra round trip). */
  dots: Record<string, DayDots>;
}) {
  const router = useRouter();
  const days = Array.from({ length: 15 }, (_, i) => addDaysISO(selectedDate, i - 7));

  function goTo(date: string) {
    router.push(`/marketing/calendar?tab=plan&d=${date}`);
  }

  return (
    <div className="space-y-1.5">
      <div
        role="group"
        aria-label="เลือกวันที่"
        className="flex snap-x snap-mandatory gap-1.5 overflow-x-auto scroll-smooth pb-1 scrollbar-none"
      >
        {days.map((date) => {
          const isSelected = date === selectedDate;
          const isToday = date === today;
          const info = dots[date];
          const d = new Date(`${date}T00:00:00Z`);
          return (
            <button
              key={date}
              type="button"
              onClick={() => goTo(date)}
              aria-current={isSelected ? "date" : undefined}
              className={`flex min-h-14 w-14 shrink-0 snap-center flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1.5 transition-colors ${
                isSelected ? "border-primary-600 bg-primary-50" : "border-zinc-200 bg-white hover:border-primary-300"
              }`}
            >
              <span className={`text-[0.7rem] ${isToday ? "font-bold text-primary-700" : "text-zinc-500"}`}>
                {WEEKDAY_FMT.format(d)}
              </span>
              <span className={`text-base font-bold ${isToday ? "text-primary-700" : "text-zinc-800"}`}>
                {DAY_FMT.format(d)}
              </span>
              <span
                className={`h-1.5 w-1.5 rounded-full ${!info ? "bg-transparent" : info.alert ? "bg-red-500" : "bg-zinc-400"}`}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
      {selectedDate !== today && (
        <button
          type="button"
          onClick={() => goTo(today)}
          className="min-h-9 rounded-full border border-primary-300 px-3 text-xs font-semibold text-primary-700 hover:bg-primary-50"
        >
          กลับวันนี้
        </button>
      )}
    </div>
  );
}
