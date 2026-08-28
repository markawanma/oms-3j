// AgendaTaskCard — one task row, shared by the plan tab's month timeline
// (MonthTimeline — design ux-calendar-month-timeline §UAT-1) and previously
// the per-day agenda it replaced (design ux-content-calendar.md §2 mock, §7:
// "ดัดแปลงจาก StepCard ใน CampaignBoard.tsx"). Trimmed on purpose vs.
// StepCard: no checklist/gate-pass actions here — the full artifact list
// lives on the detail page (/marketing/calendar/[stepId], M4), this card is
// a scannable summary the whole card links to. Server-safe (no hooks) —
// Link works fine from a server component; MonthTimeline (a client
// component) renders it too, that's still allowed.

import Link from "next/link";
import { Users } from "lucide-react";
import {
  AUDIENCE_LABEL,
  EFFECTIVE_STATUS_LABEL,
  GATE_LABEL,
  STEP_KIND_LABEL,
} from "@/lib/marketing/campaign-types";
import type { CampaignBoardStep, EffectiveStatus } from "@/lib/marketing/campaign-types";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";

// Date-only, UTC — same convention as MonthCalendar/page.tsx for
// resolvedStart/resolvedEnd (plain "YYYY-MM-DD", no time component).
const RANGE_END_FMT = new Intl.DateTimeFormat("th-TH", { timeZone: "UTC", day: "numeric", month: "short" });

// Mirrors CampaignBoard.tsx's STATUS_TONE (module-private, client-only file)
// — same tone mapping, duplicated rather than imported so this (server-safe)
// card has no dependency on that client component.
const STATUS_TONE: Record<EffectiveStatus, BadgeTone> = {
  todo: "slate",
  scheduled: "amber",
  active: "green",
  blocked: "red",
  waiting_data: "slate",
  done: "green",
};

export function AgendaTaskCard({
  step,
  dimmed = false,
}: {
  step: CampaignBoardStep;
  /** Month timeline dims rows on days already past (not today) so the eye
   * lands on what's upcoming — never applied to the status/gate/blocked-
   * reason text itself (dims via container opacity only), so it's still
   * fully legible if the owner is deliberately scrolled back to review a
   * past day. */
  dimmed?: boolean;
}) {
  const title = step.stepTitle ?? STEP_KIND_LABEL[step.stepKind] ?? step.stepKind;
  // "ยังไม่ผ่าน" = anything short of passed (pending or explicitly blocked);
  // "na" gates never applied to this step, not worth surfacing.
  const pendingGates = step.gates.filter((g) => g.status !== "passed" && g.status !== "na");
  // Multi-day step (e.g. a festival window): the month timeline only ever
  // renders this card once, on resolvedStart (see MonthTimeline's grouping
  // comment for why) — this inline "→ end date" is how the end date stays
  // visible without a second click into the detail page.
  const isMultiDay = Boolean(step.resolvedEnd && step.resolvedStart && step.resolvedEnd !== step.resolvedStart);

  return (
    <li>
      <Link
        href={`/marketing/calendar/${step.stepId}`}
        className={`block rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm transition-colors hover:border-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
          dimmed ? "opacity-70" : ""
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-bold text-zinc-900">
              {/* Always shown, not just when set — "ทั้งวัน" is a real answer
                  to "when", not a gap to leave blank (owner's calendar-review
                  feedback: a task with no time still needs a time slot on
                  the line, or the eye reads it as missing information). */}
              <span className={`mr-1.5 font-semibold ${step.startTime ? "text-primary-700" : "text-zinc-400"}`}>
                {step.startTime ? `${step.startTime} น.` : "ทั้งวัน"}
              </span>
              {title}
              {isMultiDay && (
                <span className="ml-1 text-xs font-normal text-zinc-400">
                  → {RANGE_END_FMT.format(new Date(`${step.resolvedEnd}T00:00:00Z`))}
                </span>
              )}
            </p>
            {/* standalone "content_task" steps have no meaningful parent
                campaign to show (design item 4: "ถ้าไม่ใช่ content_task") */}
            {step.campaignType !== "content_task" && (
              <p className="mt-0.5 text-xs text-zinc-500">{step.campaignName}</p>
            )}
          </div>
          <Badge tone={STATUS_TONE[step.effectiveStatus]}>{EFFECTIVE_STATUS_LABEL[step.effectiveStatus]}</Badge>
        </div>

        {(step.channel || step.audienceSegment || step.artTotal > 0) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
            {step.channel && <span>ช่องทาง: {step.channel}</span>}
            {step.audienceSegment && (
              <span className="inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                {AUDIENCE_LABEL[step.audienceSegment] ?? step.audienceSegment}
              </span>
            )}
            {step.artTotal > 0 && (
              <span>
                content {step.artDone}/{step.artTotal}
              </span>
            )}
          </div>
        )}

        {pendingGates.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {pendingGates.map((g) => (
              <Badge key={g.gateKind} tone="amber">
                รอ: {GATE_LABEL[g.gateKind] ?? g.gateKind}
              </Badge>
            ))}
          </div>
        )}

        {/* Shown unconditionally when set — including when effectiveStatus
            is already 'blocked'. CampaignBoard.tsx/[stepId] hide it exactly
            in that case (redundant with the gate badges above, in their
            view); this card intentionally does not, per explicit owner
            ask: "สถานะติดบล็อกต้องเห็น stepBlockedReason ตรงนั้นเลย ไม่ต้อง
            คลิกเข้าไปดู". Worth reconciling with the other two call sites
            later so the rule is consistent everywhere, but that's outside
            this task's scope. */}
        {step.stepBlockedReason && (
          <p className="mt-1.5 text-xs leading-relaxed font-medium text-red-700">🔴 {step.stepBlockedReason}</p>
        )}
      </Link>
    </li>
  );
}
