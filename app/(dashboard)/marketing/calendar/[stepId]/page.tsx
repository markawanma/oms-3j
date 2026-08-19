import Link from "next/link";
import { ArrowLeft, CalendarClock, CalendarX, Lock, Users } from "lucide-react";
import { getCalendarTask } from "@/lib/actions/calendar";
import { getDevRole } from "@/lib/dev/context";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { ArtifactEditor } from "@/components/domain/marketing/ArtifactEditor";
import { ClipBriefPanel } from "@/components/domain/marketing/ClipBriefPanel";
import { TaskGateSection } from "@/components/domain/marketing/TaskGateSection";
import { TaskDateActions } from "@/components/domain/marketing/TaskDateActions";
import {
  AUDIENCE_LABEL,
  EFFECTIVE_STATUS_LABEL,
  STEP_KIND_LABEL,
} from "@/lib/marketing/campaign-types";
import type { EffectiveStatus } from "@/lib/marketing/campaign-types";
import { isClipArtifactType } from "@/lib/marketing/clip-brief";
import { formatThaiDateOnly } from "@/lib/tiktok/format";

export const dynamic = "force-dynamic";

// Duplicated (not imported) from CampaignBoard.tsx / AgendaTaskCard.tsx on
// purpose — same convention already established there: this is a
// server-safe module and CampaignBoard is "use client", AgendaTaskCard's
// copy is module-private. Keep the 3 in sync if STATUS_TONE ever changes.
const STATUS_TONE: Record<EffectiveStatus, BadgeTone> = {
  todo: "slate",
  scheduled: "amber",
  active: "green",
  blocked: "red",
  waiting_data: "slate",
  done: "green",
};

// /marketing/calendar/[stepId] — task detail (M4, design
// ux-content-calendar.md §3, phase-content-calendar-design.md §8 step 4).
// Full page, not a modal (design's stated reason: script + shot list + forms
// would scroll-within-scroll on mobile, and a modal can't be deep-linked —
// this route is meant to be shareable, e.g. to a copywriter).
export default async function CalendarTaskDetailPage({ params }: { params: Promise<{ stepId: string }> }) {
  if (getDevRole() === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูรายละเอียดงานการตลาดได้"
      />
    );
  }

  const { stepId } = await params;

  let result;
  try {
    result = await getCalendarTask(stepId);
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!result.ok) {
    return <ErrorState message={result.error} />;
  }

  const step = result.data;

  // Design §4: "งานที่ไม่มีอยู่จริง = 404 → 'ไม่พบงานนี้ อาจถูกลบไปแล้ว' +
  // ปุ่มกลับปฏิทิน ไม่ใช่ EmptyState มาตรฐาน" — reusing EmptyState with that
  // exact copy + a real "กลับปฏิทิน" action gets the same result without a
  // hand-rolled block (no notFound()/not-found.tsx elsewhere in this app to
  // extend, and this message needs the back-link EmptyState already supports).
  if (!step) {
    return (
      <EmptyState
        icon={CalendarX}
        title="ไม่พบงานนี้"
        description="อาจถูกลบไปแล้ว"
        action={
          <Link
            href="/marketing/calendar"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            กลับปฏิทิน
          </Link>
        }
      />
    );
  }

  const title = step.stepTitle ?? STEP_KIND_LABEL[step.stepKind] ?? step.stepKind;
  const backHref = step.resolvedStart ? `/marketing/calendar?d=${step.resolvedStart}` : "/marketing/calendar";

  return (
    <div className="space-y-4">
      <Link
        href={backHref}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-900"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        กลับปฏิทิน
      </Link>

      <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-zinc-900">{title}</h1>
            {/* standalone content_task steps have no meaningful parent campaign
                to show — same rule as AgendaTaskCard */}
            {step.campaignType !== "content_task" && <p className="mt-0.5 text-sm text-zinc-500">{step.campaignName}</p>}
          </div>
          <Badge tone={STATUS_TONE[step.effectiveStatus]}>{EFFECTIVE_STATUS_LABEL[step.effectiveStatus]}</Badge>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
            {formatThaiDateOnly(step.resolvedStart)}
          </span>
          {step.audienceSegment && (
            <span className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              {AUDIENCE_LABEL[step.audienceSegment] ?? step.audienceSegment}
              {step.audienceLiveCount !== null && (
                <span className="font-semibold text-zinc-700">{step.audienceLiveCount.toLocaleString("en-US")} คน</span>
              )}
            </span>
          )}
          {step.channel && <span>ช่องทาง: {step.channel}</span>}
        </div>

        {step.goalKpi && <p className="text-xs leading-relaxed text-zinc-500">🎯 {step.goalKpi}</p>}

        {step.stepBlockedReason && step.effectiveStatus !== "blocked" && (
          <p className="text-xs leading-relaxed text-zinc-500">{step.stepBlockedReason}</p>
        )}
      </div>

      <section className="space-y-2.5">
        <h2 className="text-sm font-bold text-zinc-900">
          content ที่ต้องทำ <span className="font-normal text-zinc-400">({step.artDone}/{step.artTotal})</span>
        </h2>

        {step.artifacts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-4 text-center text-sm text-zinc-400">
            งานนี้ยังไม่มี content ที่ต้องทำ
          </p>
        ) : (
          <div className="space-y-2.5">
            {step.artifacts.map((a) => (
              <div key={a.id} className="space-y-2">
                <ArtifactEditor artifact={a} />
                {isClipArtifactType(a.artifactType) && <ClipBriefPanel artifactId={a.id} clipBrief={a.clipBrief} />}
              </div>
            ))}
          </div>
        )}
      </section>

      <TaskGateSection stepId={step.stepId} gates={step.gates} />

      <TaskDateActions stepId={step.stepId} initialDate={step.resolvedStart} />
    </div>
  );
}
