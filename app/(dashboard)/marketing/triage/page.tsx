import Link from "next/link";
import { CalendarDays, Lightbulb, Lock } from "lucide-react";
import { canUseContentWorkflow } from "@/lib/marketing/page-gate";
import { logRpcFailure } from "@/lib/marketing/piece-server";
import { getTriageData } from "@/lib/actions/content-triage";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageError, SectionError } from "@/components/domain/marketing/workflow/PageError";
import { ChosenRow, HeldIdeaRow, IdeaCard } from "@/components/domain/marketing/triage/IdeaCard";
import type { IdeaCardShared } from "@/components/domain/marketing/triage/IdeaCard";
import { TriageSummary } from "@/components/domain/marketing/triage/TriageSummary";
import { TruncatedNotice } from "@/components/domain/marketing/calendar/CalendarNotices";
import { calendarHref } from "@/lib/marketing/calendar-view";
import { chosenInWeek, groupIdeas, pieceCountsByDay, triageWeekDays, triageWeekFrom, triageWeekHref, triageWeekLabel } from "@/lib/marketing/triage";
import { formatThaiDay } from "@/lib/marketing/format";

export const dynamic = "force-dynamic";

// /marketing/triage — "คัดไอเดีย สัปดาห์ <ช่วงวัน>" (content-ui-build-plan.md §4 P1b ข้อ 1) · มือถือ/PC ชุดเดียวกัน
// ✓ ต้องเลือกวันเอง · บันทึกทันทีต่อใบ (ไม่มีปุ่ม "ยืนยันชุดนี้") · ไม่มีปุ่มอนุมัติ (คนละขั้น)
export default async function TriagePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!(await canUseContentWorkflow())) {
    return <EmptyState icon={Lock} title="หน้านี้จำกัดสิทธิ์" description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่คัดไอเดียได้" />;
  }

  const sp = await searchParams;
  const one = (k: string): string | undefined => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined));
  const tab: "pending" | "held" = one("tab") === "held" ? "held" : "pending";

  let res;
  try {
    res = await getTriageData(one("w"));
  } catch (err) {
    logRpcFailure("TriagePage", err);
    return <PageError message="โหลดหน้าคัดไอเดียไม่สำเร็จ ลองใหม่อีกครั้ง" />;
  }
  if (!res.ok) return <PageError message={res.error} />;
  const d = res.data;

  const days = triageWeekDays(d.weekFrom);
  const week = d.weekRows.ok ? d.weekRows.data : [];
  const shared: IdeaCardShared = {
    weekDays: days,
    dayCounts: pieceCountsByDay(week, days),
    lineQuota: d.lineQuota.ok ? d.lineQuota.data : null,
    hosts: d.hosts,
    contentTypes: d.contentTypes,
    todayTh: d.todayTh,
  };
  const typeOf = (code: string | null) => (code ? d.contentTypes.find((t) => t.code === code) : undefined);

  const ideas = d.ideas.ok ? d.ideas.data : null;
  const groups = ideas ? groupIdeas(ideas.rows) : { pending: [], held: [] };
  const chosen = chosenInWeek(week);

  const prev = triageWeekHref(d.weekFrom, -1, d.todayTh);
  const next = triageWeekHref(d.weekFrom, 1, d.todayTh);
  const tabHref = (t: "pending" | "held") => {
    const p = new URLSearchParams();
    const w = one("w");
    if (w) p.set("w", d.weekFrom);
    if (t === "held") p.set("tab", "held");
    const qs = p.toString();
    return qs ? `/marketing/triage?${qs}` : "/marketing/triage";
  };
  const withTab = (href: string | null) => (href && tab === "held" ? `${href}${href.includes("?") ? "&" : "?"}tab=held` : href);

  const NAV_LINK =
    "inline-flex min-h-11 items-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50";
  const TAB_CLS = "inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-semibold";

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <p className="text-sm text-zinc-700">{formatThaiDay(d.todayTh, true)}</p>
        <h1 className="text-2xl font-bold text-zinc-900">คัดไอเดีย สัปดาห์ {triageWeekLabel(d.weekFrom)}</h1>
        <nav aria-label="เลือกสัปดาห์" className="flex flex-wrap gap-2">
          {prev ? (
            <Link href={withTab(prev) ?? prev} className={NAV_LINK}>
              ‹ สัปดาห์ก่อน
            </Link>
          ) : null}
          {d.weekFrom !== triageWeekFrom(d.todayTh, null) && (
            <Link href={tab === "held" ? "/marketing/triage?tab=held" : "/marketing/triage"} className={NAV_LINK}>
              กลับสัปดาห์เริ่มต้น
            </Link>
          )}
          {next ? (
            <Link href={withTab(next) ?? next} className={NAV_LINK}>
              สัปดาห์ถัดไป ›
            </Link>
          ) : null}
        </nav>
      </header>

      <TriageSummary d={d} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-x-6">
        <section aria-labelledby="triage-list-heading" className="min-w-0 space-y-3">
          <h2 id="triage-list-heading" tabIndex={-1} className="sr-only">
            รายการไอเดีย
          </h2>
          <div role="group" aria-label="แท็บไอเดีย" className="flex gap-1 rounded-lg bg-zinc-100 p-1">
            <Link
              href={tabHref("pending")}
              aria-current={tab === "pending" ? "page" : undefined}
              className={`${TAB_CLS} flex-1 justify-center ${tab === "pending" ? "bg-white text-primary-700 shadow-sm" : "text-zinc-700 hover:bg-white/60"}`}
            >
              รอคัด <span className="tabular-nums">({groups.pending.length})</span>
            </Link>
            <Link
              href={tabHref("held")}
              aria-current={tab === "held" ? "page" : undefined}
              className={`${TAB_CLS} flex-1 justify-center ${tab === "held" ? "bg-white text-primary-700 shadow-sm" : "text-zinc-700 hover:bg-white/60"}`}
            >
              รอเงื่อนไข <span className="tabular-nums">({groups.held.length})</span>
            </Link>
          </div>

          {!d.ideas.ok ? (
            <SectionError message={d.ideas.error} />
          ) : (
            <>
              {ideas?.truncated && <TruncatedNotice what="ไอเดีย" />}
              {tab === "pending" ? (
                groups.pending.length === 0 ? (
                  <EmptyState
                    icon={Lightbulb}
                    title="ไม่มีไอเดียรอคัด"
                    description={
                      groups.held.length > 0
                        ? `มี ${groups.held.length} ไอเดียที่รอเงื่อนไข — เปิดแท็บ “รอเงื่อนไข” เพื่อกลับมาคัด`
                        : "ไอเดียใหม่จะเข้ามาเมื่อ AI เสนอหรือเมื่อหยิบจากสัญญาณ"
                    }
                  />
                ) : (
                  <ul className="space-y-3">
                    {groups.pending.map((p) => (
                      <IdeaCard
                        key={p.stepId}
                        piece={p}
                        contentType={typeOf(p.contentTypeCode)}
                        signal={p.sourceSignalId ? ideas?.signals[p.sourceSignalId] : undefined}
                        shared={shared}
                      />
                    ))}
                  </ul>
                )
              ) : groups.held.length === 0 ? (
                <EmptyState icon={Lightbulb} title="ไม่มีไอเดียที่รอเงื่อนไข" description="ไอเดียที่กด “พักรอเงื่อนไข” จะมารอที่นี่ แล้วกด “กลับมาคัด” ได้" />
              ) : (
                <ul className="space-y-3">
                  {groups.held.map((p) => (
                    <HeldIdeaRow key={p.stepId} piece={p} contentType={typeOf(p.contentTypeCode)} />
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        <aside aria-label="ลงปฏิทินแล้ว" className="min-w-0 space-y-3 lg:self-start">
          <h2 className="text-base font-semibold text-zinc-900">
            ลงปฏิทินแล้ว <span className="tabular-nums">{chosen.length}</span> ใบ
          </h2>
          {chosen.length === 0 ? (
            <p className="text-sm text-zinc-700">ยังไม่มีไอเดียที่เลือกลงสัปดาห์นี้</p>
          ) : (
            <ul className="space-y-2">
              {chosen.map((p) => (
                <ChosenRow key={p.stepId} piece={p} contentType={typeOf(p.contentTypeCode)} />
              ))}
            </ul>
          )}
          <Link
            href={calendarHref({ view: "week", d: d.weekFrom, campaign: "", channel: "", status: "", type: "" })}
            className={`${NAV_LINK} gap-1.5`}
          >
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            ไปดูปฏิทิน
          </Link>
        </aside>
      </div>
    </div>
  );
}
