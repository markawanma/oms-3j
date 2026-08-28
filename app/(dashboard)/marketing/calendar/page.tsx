import { Lock } from "lucide-react";
import { getCampaignCalendar } from "@/lib/actions/marketing";
import { getCalendarTasks } from "@/lib/actions/calendar";
import { getDevRole } from "@/lib/dev/context";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { CampaignCalendar } from "@/components/domain/marketing/CampaignCalendar";
import { CalendarPageTabs } from "@/components/domain/marketing/CalendarPageTabs";
import { MonthCalendar } from "@/components/domain/marketing/MonthCalendar";
import type { DayDots } from "@/components/domain/marketing/MonthCalendar";
import { MonthTimeline } from "@/components/domain/marketing/MonthTimeline";
import { AddPlanForm } from "@/components/domain/marketing/AddPlanForm";
import { effectiveDateBangkok } from "@/lib/tiktok/format";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Shape AND calendar validity. The regex alone lets "2026-02-30" through,
 * which JS then rolls over to Mar 2 — the agenda heading would say one date
 * while the URL and the grid disagreed. A round-trip check rejects those, so
 * any bad ?d= falls back to today instead of rendering a confusing (or
 * error-page) state. */
function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** "YYYY-MM-DD" -> whole calendar month it falls in (design §4: agenda/date
 * grid and agenda both read one getCalendarTasks(from,to) call per month,
 * grouped client-side — "ไม่ต้องมี view นับวัน"). UTC date math throughout:
 * these are date-only strings with no time component, so UTC keeps the
 * arithmetic from drifting a day. */
function monthRangeOf(dateStr: string): { from: string; to: string; year: number; month: number } {
  const [y, m] = dateStr.split("-").map(Number);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { from, to, year: y, month: m };
}

// /marketing/calendar — 2 tabs (design phase-content-calendar-design.md §6):
// "แผนงาน" (default: month grid + whole-month timeline, both reading
// analytics.v_campaign_board via M2's getCalendarTasks — one fetch, two
// views of the same month so the grid's "zoom in to one day" and the
// timeline's "scroll the whole month" never disagree) and "เทศกาลทั้งปี"
// (the original 0034 CampaignCalendar, untouched — long-range festival
// look-ahead, a different data source and a different question than "what
// do I do today"). Owner/admin only, same gate as before this change.
export default async function MarketingCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; d?: string }>;
}) {
  if (getDevRole() === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูปฏิทินแคมเปญได้"
      />
    );
  }

  const sp = await searchParams;
  const tab: "plan" | "seasonal" = sp.tab === "seasonal" ? "seasonal" : "plan";
  const today = effectiveDateBangkok(new Date().toISOString());
  const selectedDate = sp.d && isRealDate(sp.d) ? sp.d : today;

  if (tab === "seasonal") {
    let result;
    try {
      result = await getCampaignCalendar();
    } catch (err) {
      return (
        <div className="space-y-4">
          <CalendarPageTabs activeTab={tab} selectedDate={selectedDate} />
          <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <CalendarPageTabs activeTab={tab} selectedDate={selectedDate} />
        {result.ok ? <CampaignCalendar events={result.data} /> : <ErrorState message={result.error} />}
      </div>
    );
  }

  const { from, to, year, month } = monthRangeOf(selectedDate);

  let tasksResult;
  try {
    tasksResult = await getCalendarTasks(from, to);
  } catch (err) {
    return (
      <div className="space-y-4">
        <CalendarPageTabs activeTab={tab} selectedDate={selectedDate} />
        <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />
      </div>
    );
  }

  if (!tasksResult.ok) {
    return (
      <div className="space-y-4">
        <CalendarPageTabs activeTab={tab} selectedDate={selectedDate} />
        <ErrorState message={tasksResult.error} />
      </div>
    );
  }

  // Per-day dot info for the month grid — one pass over the
  // month's rows, computed here rather than in either child so both agree.
  const dots: Record<string, DayDots> = {};
  for (const t of tasksResult.data) {
    if (!t.resolvedStart) continue;
    const cur = dots[t.resolvedStart] ?? { count: 0, alert: false };
    cur.count += 1;
    if (t.effectiveStatus === "blocked" || t.effectiveStatus === "waiting_data") cur.alert = true;
    dots[t.resolvedStart] = cur;
  }

  return (
    <div className="space-y-4">
      <CalendarPageTabs activeTab={tab} selectedDate={selectedDate} />

      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-zinc-900">ปฏิทินการตลาด</h1>
        <AddPlanForm variant="button" defaultDate={selectedDate} />
      </div>

      <MonthCalendar year={year} month={month} selectedDate={selectedDate} today={today} dots={dots} />

      <MonthTimeline tasks={tasksResult.data} selectedDate={selectedDate} today={today} />

      {/* Mobile-only floating trigger — stays reachable while the agenda
          list scrolls long (UX doc mobile rule); header button above covers
          desktop where scroll distance to a long list is less of an issue. */}
      <AddPlanForm variant="fab" defaultDate={selectedDate} />
    </div>
  );
}
