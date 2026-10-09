import { cookies } from "next/headers";
import { Lock } from "lucide-react";
import { getCampaignCalendar } from "@/lib/actions/marketing";
import { getCalendarData } from "@/lib/actions/content-calendar";
import { getContentTypes } from "@/lib/actions/content";
import { getEffectiveRole } from "@/lib/auth/role";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { CampaignCalendar } from "@/components/domain/marketing/CampaignCalendar";
import { CalendarPageTabs } from "@/components/domain/marketing/CalendarPageTabs";
import { CalendarOverdue } from "@/components/domain/marketing/calendar/CalendarOverdue";
import { CalendarToolbar, LegacyLane, ListView, MonthView, WeekView } from "@/components/domain/marketing/calendar/CalendarViews";
import { LineQuotaNotice } from "@/components/domain/marketing/workflow/InboxSections";
import { PageError, SectionError } from "@/components/domain/marketing/workflow/PageError";
import {
  VIEW_COOKIE,
  applyFilters,
  calendarHref,
  filterOptions,
  isRealDate,
  parseFilters,
  parseView,
  viewRange,
  weekRangeOf,
} from "@/lib/marketing/calendar-view";
import type { CalendarUrlState } from "@/lib/marketing/calendar-view";
import { effectiveDateBangkok } from "@/lib/tiktok/format";

export const dynamic = "force-dynamic";

// /marketing/calendar — ปฏิทินใหม่ (content-ui-build-plan.md §1.3 #7 · §2.6 ก · §4 P1b ข้อ 2)
// 2 แท็บ: "แผนงาน" (สัปดาห์ | เดือน | รายการ — ค่าเริ่มต้นสัปดาห์ จำมุมมองล่าสุดใน cookie) · "เทศกาลทั้งปี" (CampaignCalendar เดิมจาก 0034)
// ข้อมูลแผนงานมาจาก v_content_piece_calendar (overlap query) + step เก่าจาก v_campaign_board ที่ไม่อยู่ใน workflow ใหม่ (แผนเดิม)
export default async function MarketingCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if ((await getEffectiveRole()) === "staff") {
    return (
      <EmptyState icon={Lock} title="หน้านี้จำกัดสิทธิ์" description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูปฏิทินแคมเปญได้" />
    );
  }

  const sp = await searchParams;
  const one = (k: string): string | undefined => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined));
  const tab: "plan" | "seasonal" = one("tab") === "seasonal" ? "seasonal" : "plan";
  const todayTh = effectiveDateBangkok(new Date().toISOString());
  const dParam = one("d");
  const anchor = dParam && isRealDate(dParam) ? dParam : todayTh;

  const view = parseView(sp.view, (await cookies()).get(VIEW_COOKIE)?.value ?? null);
  const filters = parseFilters(sp);
  const state: CalendarUrlState = { view, d: anchor, ...filters };

  if (tab === "seasonal") {
    let result;
    try {
      result = await getCampaignCalendar();
    } catch (err) {
      console.error("MarketingCalendarPage seasonal failed", { message: err instanceof Error ? err.message : "unknown" });
      return (
        <div className="space-y-4">
          <CalendarPageTabs activeTab={tab} selectedDate={anchor} planHref={calendarHref(state)} />
          <ErrorState message="โหลดเทศกาลไม่สำเร็จ ลองใหม่อีกครั้ง" />
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <CalendarPageTabs activeTab={tab} selectedDate={anchor} planHref={calendarHref(state)} />
        {result.ok ? <CampaignCalendar events={result.data} /> : <ErrorState message={result.error} />}
      </div>
    );
  }

  const range = viewRange(view, anchor);
  let res;
  let typesRes;
  try {
    [res, typesRes] = await Promise.all([
      getCalendarData(range.from, range.to, todayTh),
      getContentTypes().catch(() => ({ ok: false as const, error: "" })),
    ]);
  } catch (err) {
    console.error("MarketingCalendarPage failed", { message: err instanceof Error ? err.message : "unknown" });
    return <PageError message="โหลดปฏิทินไม่สำเร็จ ลองใหม่อีกครั้ง" />;
  }
  if (!res.ok) return <PageError message={res.error} />;
  const d = res.data;
  const contentTypes = typesRes.ok ? typesRes.data : [];
  const typeLabels = Object.fromEntries(contentTypes.map((c) => [c.code, c.labelTh]));

  const allPieces = d.pieces.ok ? d.pieces.data : [];
  const pieces = applyFilters(allPieces, filters);
  const options = filterOptions(allPieces);
  const legacy = d.legacy.ok ? d.legacy.data : [];
  const festivals = d.festivals.ok ? d.festivals.data : [];
  const filtersActive = Boolean(filters.campaign || filters.channel || filters.status || filters.type);

  const lineVisible = filters.channel === "line_oa" || pieces.some((p) => p.pieceKind === "line_message");
  const noItems = d.pieces.ok && d.legacy.ok && pieces.length === 0 && legacy.length === 0;

  return (
    <div className="space-y-4">
      <CalendarPageTabs activeTab={tab} selectedDate={anchor} planHref={calendarHref(state)} />

      <CalendarToolbar state={state} anchor={anchor} todayTh={todayTh} options={options} typeLabels={typeLabels} />

      {!d.pieces.ok && <SectionError message={d.pieces.error} />}
      {!d.festivals.ok && <SectionError message={d.festivals.error} />}
      {lineVisible && d.lineQuota.ok && d.lineQuota.data && <LineQuotaNotice q={d.lineQuota.data} />}

      {view !== "list" && d.overdue.ok && <CalendarOverdue pieces={d.overdue.data} todayTh={todayTh} />}
      {!d.overdue.ok && <SectionError message={d.overdue.error} />}

      {view === "week" && (
        <WeekView weekFrom={weekRangeOf(anchor).from} pieces={pieces} festivals={festivals} contentTypes={contentTypes} todayTh={todayTh} />
      )}
      {view === "month" && (
        <MonthView state={state} anchor={anchor} selectedDay={anchor} pieces={pieces} festivals={festivals} contentTypes={contentTypes} todayTh={todayTh} />
      )}
      {view === "list" && (
        <>
          {d.overdue.ok && d.overdue.data.length > 0 && <CalendarOverdue pieces={d.overdue.data} todayTh={todayTh} />}
          <ListView anchor={anchor} pieces={pieces} festivals={festivals} contentTypes={contentTypes} todayTh={todayTh} />
        </>
      )}

      {noItems && (
        <p className="text-sm text-zinc-700">
          {filtersActive ? "ไม่มีชิ้นงานที่ตรงกับตัวกรองในช่วงนี้" : "ช่วงนี้ยังไม่มีชิ้นงาน — กด “เพิ่มชิ้นงาน” เพื่อวางแผน"}
        </p>
      )}

      {!d.legacy.ok ? (
        <SectionError message={d.legacy.error} />
      ) : (
        <LegacyLane steps={legacy} from={d.from} to={d.to} contentTypes={contentTypes} filtersActive={filtersActive} />
      )}
    </div>
  );
}
