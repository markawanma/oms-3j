// AgendaTaskCard — one task in the day agenda (design ux-content-calendar.md
// §2 mock, §7: "ดัดแปลงจาก StepCard ใน CampaignBoard.tsx"). Trimmed on
// purpose vs. StepCard: no checklist/gate-pass actions here — the full
// artifact list lives on the detail page (/marketing/calendar/[stepId], M4),
// this card is a scannable summary the whole card links to. Server-safe (no
// hooks) — Link works fine from a server component.

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

export function AgendaTaskCard({ step }: { step: CampaignBoardStep }) {
  const title = step.stepTitle ?? STEP_KIND_LABEL[step.stepKind] ?? step.stepKind;
  // "ยังไม่ผ่าน" = anything short of passed (pending or explicitly blocked);
  // "na" gates never applied to this step, not worth surfacing.
  const pendingGates = step.gates.filter((g) => g.status !== "passed" && g.status !== "na");

  return (
    <li>
      <Link
        href={`/marketing/calendar/${step.stepId}`}
        className="block rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm transition-colors hover:border-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-bold text-zinc-900">
              {step.startTime && <span className="mr-1.5 text-primary-700">{step.startTime}</span>}
              {title}
            </p>
            {/* standalone "content_task" steps have no meaningful parent
                campaign to show (design item 4: "ถ้าไม่ใช่ content_task") */}
            {step.campaignType !== "content_task" && (
              <p className="mt-0.5 text-xs text-zinc-500">{step.campaignName}</p>
            )}
          </div>
          <Badge tone={STATUS_TONE[step.effectiveStatus]}>{EFFECTIVE_STATUS_LABEL[step.effectiveStatus]}</Badge>
        </div>

        {(step.audienceSegment || step.artTotal > 0) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
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
      </Link>
    </li>
  );
}
