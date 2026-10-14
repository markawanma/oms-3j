import Link from "next/link";
import { CalendarCheck, Lock, PartyPopper } from "lucide-react";
import { canUseContentWorkflow } from "@/lib/marketing/page-gate";
import { logRpcFailure } from "@/lib/marketing/piece-server";
import { getContentTypes } from "@/lib/actions/content";
import { getInboxData } from "@/lib/actions/content-inbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { AiQuestionList } from "@/components/domain/marketing/workflow/AiQuestionCard";
import { ApprovalCard } from "@/components/domain/marketing/workflow/ApprovalCard";
import {
  EntryTile,
  LineQuotaNotice,
  OverLimitBanner,
  PileSection,
  WeekStrip,
  WeeklySummaryPanel,
} from "@/components/domain/marketing/workflow/InboxSections";
import { PageError, SectionError } from "@/components/domain/marketing/workflow/PageError";
import { PostCard } from "@/components/domain/marketing/workflow/PostCard";
import { buildInboxPiles, isInboxEmpty, summarizeWeek } from "@/lib/marketing/inbox-piles";
import { formatThaiDay } from "@/lib/marketing/format";
import type { ContentTypeOption } from "@/lib/marketing/piece-types";

export const dynamic = "force-dynamic";

// /marketing — "งานที่รอฉัน" (หน้าแรกของสายการตลาด · content-ui-build-plan.md P1a)
// 4 กอง: วันนี้ต้องโพสต์ · รออนุมัติ · คำถามจาก AI · (สัปดาห์นี้ + ทางลัดกรอกยอด)
// แต่ละกองล้มได้อิสระ (แต่ละ query ครอบ try/catch แยกใน getInboxData แล้วคืนเป็น Part) — กองหนึ่งล้ม กองอื่นยังแสดง
export default async function MarketingInboxPage() {
  if (!(await canUseContentWorkflow())) {
    return <EmptyState icon={Lock} title="หน้านี้จำกัดสิทธิ์" description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูงานการตลาดได้" />;
  }

  let res;
  try {
    res = await getInboxData();
  } catch (err) {
    logRpcFailure("MarketingInboxPage", err);
    return <PageError message="โหลดงานที่รอฉันไม่สำเร็จ ลองใหม่อีกครั้ง" />;
  }
  if (!res.ok) return <PageError message={res.error} />;
  const d = res.data;

  const typesRes = await getContentTypes().catch(() => ({ ok: false as const, error: "" }));
  const types: ContentTypeOption[] = typesRes.ok ? typesRes.data.map((c) => ({ code: c.code, labelTh: c.labelTh, colorHex: c.colorHex })) : [];
  const typeOf = (code: string | null) => (code ? types.find((t) => t.code === code) : undefined);

  const piles = buildInboxPiles({
    postRows: d.postRows.ok ? d.postRows.data : [],
    reviewRows: d.reviewRows.ok ? d.reviewRows.data : [],
    recoRows: d.reco.ok ? d.reco.data : [],
    todayTh: d.todayTh,
    overdueNoLinkIds: new Set(d.overdueNoLinkIds),
  });
  const overdue = new Set(d.overdueNoLinkIds);

  // จำนวนกองมาจาก view ตัวนับ (ตัวเลขที่ DB ตัดสิน) · ถ้า view ตัวนับล้ม ใช้จำนวนแถวที่โหลดได้
  const postCount = d.counts.ok ? d.counts.data.postToday : piles.post.length;
  const reviewCount = d.counts.ok ? d.counts.data.reviewQueue : piles.review.length;
  const waiting = postCount + reviewCount + piles.recoTotal;

  const allPartsOk = d.postRows.ok && d.reviewRows.ok && d.reco.ok && d.counts.ok;
  const empty = allPartsOk && isInboxEmpty(piles);

  const lineInLists = [...piles.post, ...piles.review].some((p) => p.pieceKind === "line_message");
  const weekSummary = d.weekRows.ok ? summarizeWeek(d.weekRows.data) : null;

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm text-zinc-700">{formatThaiDay(d.todayTh, true)}</p>
        <h1 className="text-2xl font-bold text-zinc-900">
          งานที่รอฉัน <span className="tabular-nums text-primary-700">{waiting.toLocaleString("th-TH")}</span>
        </h1>
      </header>

      {d.counts.ok && d.counts.data.reviewOverLimit && <OverLimitBanner reviewQueue={d.counts.data.reviewQueue} />}
      {!d.counts.ok && <SectionError message={d.counts.error} />}

      {lineInLists && d.lineQuota.ok && d.lineQuota.data && <LineQuotaNotice q={d.lineQuota.data} />}

      {/* มือถือ: เรียงตามบอร์ด Main (สรุป → กอง → สัปดาห์/กรอกยอด) · PC (lg): กองงานซ้าย / สรุป+สัปดาห์ขวา
          (ความกว้างหน้านี้ขยายเฉพาะ route นี้ ผ่าน isWideMarketingPath ใน DashboardShell) */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-x-6">
        {d.weekly.ok && d.weekly.data && (
          <div className="lg:col-start-2 lg:self-start">
            <WeeklySummaryPanel summary={d.weekly.data} />
          </div>
        )}

        <div className="min-w-0 space-y-5 lg:col-start-1 lg:row-span-2 lg:row-start-1">
            {empty && (
              <EmptyState
                icon={PartyPopper}
                title="ไม่มีอะไรรอคุณ"
                description={
                  d.nextScheduled.ok && d.nextScheduled.data
                    ? `งานถัดไป: “${d.nextScheduled.data.title}” · ${formatThaiDay(d.nextScheduled.data.resolvedStart, true)}`
                    : "ยังไม่มีชิ้นงานที่วางแผนไว้"
                }
                action={
                  d.nextScheduled.ok && d.nextScheduled.data ? (
                    <Link
                      href={`/marketing/pieces/${d.nextScheduled.data.stepId}?from=inbox`}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                    >
                      <CalendarCheck className="h-4 w-4" aria-hidden="true" />
                      เปิดงานถัดไป
                    </Link>
                  ) : undefined
                }
              />
            )}

            {!d.postRows.ok ? (
              <SectionError message={d.postRows.error} />
            ) : (
              piles.post.length > 0 && (
                <PileSection id="pile-post" title="วันนี้ต้องโพสต์" count={postCount} shown={piles.post.length}>
                  {piles.post.map((p) => (
                    <PostCard key={p.stepId} piece={p} contentType={typeOf(p.contentTypeCode)} overdueNoLink={overdue.has(p.stepId)} todayTh={d.todayTh} />
                  ))}
                </PileSection>
              )
            )}

            {!d.reviewRows.ok ? (
              <SectionError message={d.reviewRows.error} />
            ) : (
              piles.review.length > 0 && (
                <PileSection id="pile-review" title="รออนุมัติ" count={reviewCount} shown={piles.review.length}>
                  {piles.review.map((p) => (
                    <ApprovalCard key={p.stepId} piece={p} contentType={typeOf(p.contentTypeCode)} />
                  ))}
                </PileSection>
              )
            )}

            {!d.reco.ok ? (
              <SectionError message={d.reco.error} />
            ) : (
              piles.recoTotal > 0 && (
                <PileSection id="pile-reco" title="คำถามจาก AI" count={piles.recoTotal} shown={piles.reco.length}>
                  <AiQuestionList rows={piles.reco} />
                </PileSection>
              )
            )}
            {d.reco.ok && piles.recoTotal > 0 && (
              <Link
                href="/marketing/questions"
                className="inline-flex min-h-11 items-center text-sm font-medium text-primary-700 underline underline-offset-2"
              >
                ดูคำถามและข้อเสนอทั้งหมด ({piles.recoTotal})
              </Link>
            )}
        </div>

        <div className="space-y-3 lg:col-start-2 lg:self-start">
            {!d.weekRows.ok ? (
              <SectionError message={d.weekRows.error} />
            ) : (
              weekSummary && <WeekStrip from={d.weekFrom} to={d.weekTo} summary={weekSummary} rows={d.weekRows.data} />
            )}

            {d.entryTodayCount.ok ? <EntryTile count={d.entryTodayCount.data} /> : <SectionError message={d.entryTodayCount.error} />}
        </div>
      </div>
    </div>
  );
}
