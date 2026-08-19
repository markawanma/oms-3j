// DayAgenda — /marketing/calendar plan tab (design ux-content-calendar.md
// §2/§4 empty-state rule, phase-content-calendar-design.md §7). Server-safe
// (no hooks): tasks for the whole month already arrive from the page via
// getCalendarTasks, this component just filters+sorts down to the selected
// day and renders. Interactive bits (add-plan sheet, month overlay) are
// self-contained client components dropped in as children.

import { CalendarDays } from "lucide-react";
import type { CampaignBoardStep } from "@/lib/marketing/campaign-types";
import { EmptyState } from "@/components/ui/EmptyState";
import { AgendaTaskCard } from "@/components/domain/marketing/AgendaTaskCard";
import { AddPlanForm } from "@/components/domain/marketing/AddPlanForm";
import { MonthOverlay } from "@/components/domain/marketing/MonthOverlay";
import type { DayDots } from "@/components/domain/marketing/DateStrip";

const HEADING_FMT = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  weekday: "long",
  day: "numeric",
  month: "long",
});

export function DayAgenda({
  tasks,
  selectedDate,
  today,
  year,
  month,
  dots,
}: {
  /** Whole month's rows (design §4: one getCalendarTasks call, grouped
   * client-side) — filtered down to selectedDate here. */
  tasks: CampaignBoardStep[];
  selectedDate: string;
  today: string;
  year: number;
  /** 1-12, passed through to MonthOverlay. */
  month: number;
  dots: Record<string, DayDots>;
}) {
  const dayTasks = tasks
    .filter((t) => t.resolvedStart === selectedDate)
    .sort((a, b) => {
      const byCampaign = a.campaignName.localeCompare(b.campaignName, "th");
      return byCampaign !== 0 ? byCampaign : a.seq - b.seq;
    });

  const heading = HEADING_FMT.format(new Date(`${selectedDate}T00:00:00Z`));
  const isToday = selectedDate === today;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-bold text-zinc-800">{heading}</h2>

      {dayTasks.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={isToday ? "วันนี้ยังไม่มีงานการตลาด" : "ยังไม่มีงานการตลาดในวันนี้"}
          description="เพิ่มแผนเองได้เลย หรือรออนุมัติ reco จาก Ad Copilot"
          action={<AddPlanForm variant="button" defaultDate={selectedDate} />}
        />
      ) : (
        <ul className="space-y-2.5">
          {dayTasks.map((t) => (
            <AgendaTaskCard key={t.stepId} step={t} />
          ))}
        </ul>
      )}

      <div className="flex justify-center pt-1">
        <MonthOverlay dots={dots} year={year} month={month} selectedDate={selectedDate} today={today} />
      </div>
    </div>
  );
}
