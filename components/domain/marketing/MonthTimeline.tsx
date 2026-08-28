"use client";

// MonthTimeline — /marketing/calendar plan tab, whole-month view (owner UAT
// feedback on the original per-day-only agenda: "มันจะต้องมานั่งคลิกทีละวัน
// ... แต่อยากจะได้ภาพรวมทั้งเดือนด้วย ไล่ตาม timeline บนไปล่าง"). Renders
// every day in the month that has at least one task, top to bottom, in one
// scroll — the month grid above stays as the "zoom in to one day" control
// (owner's own words), this is the "see the whole month at once" answer.
// Replaces DayAgenda (deleted): showing the selected day's tasks a second
// time in a separate filtered list right next to a timeline that already
// highlights that same day would just be the same information twice.
//
// Client component only for the scroll-to-selected-day effect — the data
// itself still arrives pre-fetched from the page (one getCalendarTasks call
// per month, same contract as before), no fetching happens here.

import { useEffect, useRef } from "react";
import { CalendarDays } from "lucide-react";
import type { CampaignBoardStep } from "@/lib/marketing/campaign-types";
import { EmptyState } from "@/components/ui/EmptyState";
import { AgendaTaskCard } from "@/components/domain/marketing/AgendaTaskCard";
import { AddPlanForm } from "@/components/domain/marketing/AddPlanForm";

const DAY_HEADER_FMT = new Intl.DateTimeFormat("th-TH", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** Absolute day count between two "YYYY-MM-DD" strings — used only to find
 * the nearest day-with-tasks when the clicked day itself has none (see
 * "nearest fallback" below). UTC, same date-only convention as the rest of
 * this page's date math. */
function daysBetween(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  return Math.abs(ta - tb) / 86_400_000;
}

/** Same ordering DayAgenda used: timed tasks earliest-first, untimed
 * ("ทั้งวัน") last, then campaign name / seq as a stable tiebreaker. */
function sortDayTasks(tasks: CampaignBoardStep[]): CampaignBoardStep[] {
  return [...tasks].sort((a, b) => {
    if (a.startTime && b.startTime) {
      const byTime = a.startTime.localeCompare(b.startTime);
      if (byTime !== 0) return byTime;
    } else if (a.startTime && !b.startTime) {
      return -1;
    } else if (!a.startTime && b.startTime) {
      return 1;
    }
    const byCampaign = a.campaignName.localeCompare(b.campaignName, "th");
    return byCampaign !== 0 ? byCampaign : a.seq - b.seq;
  });
}

export function MonthTimeline({
  tasks,
  selectedDate,
  today,
}: {
  /** Whole month's rows (one getCalendarTasks call, same as before) —
   * grouped by resolvedStart here instead of filtered down to one day. */
  tasks: CampaignBoardStep[];
  selectedDate: string;
  today: string;
}) {
  const groupRefs = useRef<Map<string, HTMLLIElement>>(new Map());

  // Multi-day steps (resolvedStart !== resolvedEnd) render once, on their
  // start day, not once per day they span. Two reasons: (1) the month grid's
  // dots above are already computed from resolvedStart only (page.tsx) — if
  // the timeline showed the same step on every day it spans, the two views
  // would visibly disagree on "how much is happening on day N"; (2) for a
  // task that runs several days, the start date is the actionable one (when
  // prep needs to happen), and repeating the same card 3-5 times down the
  // list works against the exact complaint this feature exists to fix
  // ("อ่านไหว ไม่รก" for a busy month). The end date isn't lost — AgendaTaskCard
  // prints "→ <end date>" inline on the same row when resolvedEnd differs
  // from resolvedStart, so it's visible without a second click.
  const byDate = new Map<string, CampaignBoardStep[]>();
  for (const t of tasks) {
    if (!t.resolvedStart) continue;
    const list = byDate.get(t.resolvedStart);
    if (list) list.push(t);
    else byDate.set(t.resolvedStart, [t]);
  }
  const dates = [...byDate.keys()].sort();

  useEffect(() => {
    const exact = groupRefs.current.get(selectedDate);
    if (exact) {
      exact.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    // Clicking a day in the month grid that has no tasks is still a
    // deliberate "look here" — land on the nearest day that actually has
    // something instead of leaving the scroll position wherever it happened
    // to be (which would make the click look like it did nothing). Not
    // ring-highlighted as if it were the selected day — it isn't.
    let nearest: string | null = null;
    let bestDiff = Infinity;
    for (const d of dates) {
      const diff = daysBetween(d, selectedDate);
      if (diff < bestDiff) {
        bestDiff = diff;
        nearest = d;
      }
    }
    if (nearest) groupRefs.current.get(nearest)?.scrollIntoView({ behavior: "smooth", block: "start" });
    // dates/byDate are recomputed from `tasks` every render but only their
    // membership (not identity) matters for this effect — re-running it
    // whenever the month's task list changes underneath the same
    // selectedDate is correct (a plan just got added/removed), not extra.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, tasks]);

  if (dates.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="เดือนนี้ยังไม่มีงานการตลาดเลย"
        description="เพิ่มแผนเองได้เลย หรือรออนุมัติ reco จาก Ad Copilot"
        action={<AddPlanForm variant="button" defaultDate={selectedDate} />}
      />
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-bold text-zinc-800">ภาพรวมทั้งเดือน</h2>
      <ol className="space-y-4">
        {dates.map((date) => {
          const dayTasks = sortDayTasks(byDate.get(date) ?? []);
          const isToday = date === today;
          const isSelected = date === selectedDate;
          const isPast = date < today;

          return (
            <li
              key={date}
              ref={(el) => {
                if (el) groupRefs.current.set(date, el);
                else groupRefs.current.delete(date);
              }}
              className={`scroll-mt-20 rounded-lg transition-shadow ${
                isSelected ? "ring-2 ring-primary-500 ring-offset-2" : ""
              }`}
            >
              <div className="mb-1.5 flex items-center gap-2 px-0.5">
                <p
                  className={`text-xs font-bold tracking-wide uppercase ${
                    isToday ? "text-primary-700" : isPast ? "text-zinc-400" : "text-zinc-600"
                  }`}
                >
                  {DAY_HEADER_FMT.format(new Date(`${date}T00:00:00Z`))}
                </p>
                {isToday && (
                  <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[0.65rem] font-bold text-primary-700">
                    วันนี้
                  </span>
                )}
              </div>
              <ul className="space-y-2">
                {dayTasks.map((t) => (
                  <AgendaTaskCard key={t.stepId} step={t} dimmed={isPast && !isToday} />
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
