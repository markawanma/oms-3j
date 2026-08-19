"use client";

// CampaignBoard — /marketing/copilot "แคมเปญ (ตามแผน)" section (design
// docs/3j-jewelry/analytics/phase-campaign-playbook-design.md), backed by
// analytics.v_campaign_board (0049). Turns the CMO's markdown campaign plan
// into an actionable board: each step = what to do + a content checklist the
// owner ticks done. effective_status is computed in the view (winback →
// waiting_data on its own when at_risk=0, silver_bar → waiting_data, a blocked
// artifact → whole step blocked), so this component only groups + renders it.
// Writes go through setCampaignArtifactStatus / passCampaignGate (RPC-gated).

import { useState, useTransition } from "react";
import { CalendarClock, CheckCircle2, Circle, Lock, Users } from "lucide-react";
import { setCampaignArtifactStatus, passCampaignGate } from "@/lib/actions/marketing";
import {
  ARTIFACT_STATUS_LABEL,
  ARTIFACT_TYPE_LABEL,
  AUDIENCE_LABEL,
  EFFECTIVE_STATUS_LABEL,
  GATE_LABEL,
  OWNER_ROLE_LABEL,
  STEP_KIND_LABEL,
} from "@/lib/marketing/campaign-types";
import type { CampaignBoardStep, EffectiveStatus } from "@/lib/marketing/campaign-types";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { CopilotSection } from "@/components/domain/tiktok/CopilotSection";
import { formatThaiDateOnly } from "@/lib/tiktok/format";

const STATUS_TONE: Record<EffectiveStatus, BadgeTone> = {
  todo: "slate",
  scheduled: "amber",
  active: "green",
  blocked: "red",
  waiting_data: "slate",
  done: "green",
};

function countdownText(daysUntil: number | null): string {
  if (daysUntil === null) return "ยังไม่กำหนดวัน";
  if (daysUntil === 0) return "วันนี้";
  if (daysUntil > 0) return `อีก ${daysUntil} วัน`;
  return `ผ่านมา ${Math.abs(daysUntil)} วัน`;
}

function StepCard({
  step,
  busyIds,
  openArtifactIds,
  onToggleArtifact,
  onPassGate,
  onToggleContentOpen,
  onCopyContent,
}: {
  step: CampaignBoardStep;
  busyIds: Set<string>;
  openArtifactIds: Set<string>;
  onToggleArtifact: (artifactId: string, done: boolean) => void;
  onPassGate: (stepId: string, gateKind: string) => void;
  onToggleContentOpen: (artifactId: string) => void;
  onCopyContent: (text: string) => void;
}) {
  const dimmed = step.effectiveStatus === "waiting_data" || step.effectiveStatus === "done";

  return (
    <div className={`flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm ${dimmed ? "opacity-80" : ""}`}>
      {/* header: step name + countdown + status */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-zinc-900">
            <span className="text-zinc-400">#{step.seq}</span> {STEP_KIND_LABEL[step.stepKind] ?? step.stepKind}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
              {countdownText(step.daysUntil)}
              {step.resolvedStart && <span className="text-zinc-400">· {formatThaiDateOnly(step.resolvedStart)}</span>}
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
          </div>
        </div>
        <Badge tone={STATUS_TONE[step.effectiveStatus]}>{EFFECTIVE_STATUS_LABEL[step.effectiveStatus]}</Badge>
      </div>

      {step.goalKpi && <p className="text-xs leading-relaxed text-zinc-500">🎯 {step.goalKpi}</p>}

      {step.stepBlockedReason && step.effectiveStatus !== "blocked" && (
        <p className="text-xs leading-relaxed text-zinc-500">{step.stepBlockedReason}</p>
      )}

      {/* content checklist */}
      {step.artifacts.length > 0 && (
        <div className="rounded-md border border-zinc-100 bg-zinc-50/60 p-2.5">
          <p className="mb-1.5 text-xs font-semibold text-zinc-600">
            content ที่ต้องทำ <span className="text-zinc-400">({step.artDone}/{step.artTotal})</span>
          </p>
          <ul className="flex flex-col gap-1.5">
            {step.artifacts.map((a) => {
              const isDone = a.status === "done";
              const isBlocked = a.status === "blocked";
              const busy = busyIds.has(a.id);
              return (
                <li key={a.id} className="flex items-start gap-2">
                  <button
                    type="button"
                    disabled={isBlocked || busy}
                    onClick={() => onToggleArtifact(a.id, !isDone)}
                    aria-pressed={isDone}
                    aria-label={isDone ? "ทำเครื่องหมายยังไม่เสร็จ" : "ทำเครื่องหมายเสร็จ"}
                    className="flex min-h-8 shrink-0 items-center text-primary-600 disabled:text-zinc-300"
                  >
                    {isBlocked ? (
                      <Lock className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                    ) : isDone ? (
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Circle className="h-4 w-4 text-zinc-300" aria-hidden="true" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`text-xs ${isDone ? "text-zinc-400 line-through" : "text-zinc-700"}`}>
                        {ARTIFACT_TYPE_LABEL[a.artifactType] ?? a.artifactType}
                        <span className="text-zinc-400"> · {OWNER_ROLE_LABEL[a.ownerRole] ?? a.ownerRole}</span>
                      </span>
                      {isBlocked && <Badge tone="slate">{ARTIFACT_STATUS_LABEL.blocked}</Badge>}
                      {/* Anything in flight gets a badge, not just "draft":
                          the same artifacts are now editable from the calendar
                          detail page, so a script the owner approved (or an
                          agent drafted) must not read as untouched here. */}
                      {!isBlocked && a.status !== "todo" && a.status !== "done" && (
                        <Badge tone={a.status === "approved" ? "green" : "amber"}>
                          {ARTIFACT_STATUS_LABEL[a.status]}
                        </Badge>
                      )}
                    </div>
                    {/* note carries the "what to do / why blocked" detail (e.g. bundle
                        blocked reason) — the core value for todo/blocked items */}
                    {a.note && <p className="mt-0.5 text-[0.7rem] leading-relaxed text-zinc-500">{a.note}</p>}
                    {/* full copy (LINE script ฯลฯ) — only shown once the copywriter has
                        actually written something; expandable so the checklist stays
                        scannable by default */}
                    {a.contentBody && (
                      <>
                        <button
                          type="button"
                          onClick={() => onToggleContentOpen(a.id)}
                          className="mt-1 text-[0.7rem] font-semibold text-primary-600 hover:underline"
                        >
                          {openArtifactIds.has(a.id) ? "ซ่อนสคริปต์" : "📄 อ่านสคริปต์"}
                        </button>
                        {openArtifactIds.has(a.id) && (
                          <div className="mt-1.5 rounded-md border border-zinc-200 bg-white p-2.5">
                            <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-700">
                              {a.contentBody}
                            </p>
                            <button
                              type="button"
                              onClick={() => onCopyContent(a.contentBody as string)}
                              className="mt-1.5 text-[0.7rem] font-semibold text-primary-600 hover:underline"
                            >
                              คัดลอก
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* gates */}
      {step.gates.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {step.gates.map((g) => {
            const passed = g.status === "passed";
            const busy = busyIds.has(`${step.stepId}:${g.gateKind}`);
            return passed ? (
              <Badge key={g.gateKind} tone="green">
                ✓ {GATE_LABEL[g.gateKind] ?? g.gateKind}
              </Badge>
            ) : (
              <Button
                key={g.gateKind}
                variant="secondary"
                size="sm"
                loading={busy}
                onClick={() => onPassGate(step.stepId, g.gateKind)}
              >
                ผ่าน: {GATE_LABEL[g.gateKind] ?? g.gateKind}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function CampaignBoard({ initialSteps }: { initialSteps: CampaignBoardStep[] }) {
  const toast = useToast();
  // design §4 "CampaignBoard เดิม" row: standalone owner-added tasks
  // (campaign_type='content_task', 0057) live in v_campaign_board too now
  // (the calendar reads the same view) but must never show up on this
  // multi-step campaign board — they belong on /marketing/calendar instead.
  const [steps, setSteps] = useState(() => initialSteps.filter((s) => s.campaignType !== "content_task"));
  // per-item busy set (not a single id) — two items can be in flight at once
  // without one clearing the other's disabled state (race → double-submit).
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  // artifact ids whose full script is expanded — several can be open at once,
  // same pattern as busyIds above.
  const [openArtifactIds, setOpenArtifactIds] = useState<Set<string>>(() => new Set());
  const [, startTransition] = useTransition();

  const markBusy = (key: string, busy: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(key);
      else next.delete(key);
      return next;
    });

  if (steps.length === 0) return null;

  const campaignName = steps[0].campaignName;

  function handleToggleArtifact(artifactId: string, done: boolean) {
    markBusy(artifactId, true);
    startTransition(async () => {
      const result = await setCampaignArtifactStatus(artifactId, done ? "done" : "draft");
      markBusy(artifactId, false);
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      setSteps((prev) =>
        prev.map((s) => {
          const artifacts = s.artifacts.map((a) =>
            a.id === artifactId ? { ...a, status: (done ? "done" : "draft") as CampaignBoardStep["artifacts"][number]["status"] } : a
          );
          const artDone = artifacts.filter((a) => a.status === "done").length;
          return { ...s, artifacts, artDone };
        })
      );
      toast.push(done ? "ทำเครื่องหมายเสร็จแล้ว" : "ปรับเป็นยังไม่เสร็จ");
    });
  }

  function handleToggleContentOpen(artifactId: string) {
    setOpenArtifactIds((prev) => {
      const next = new Set(prev);
      if (next.has(artifactId)) next.delete(artifactId);
      else next.add(artifactId);
      return next;
    });
  }

  async function handleCopyContent(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.push("คัดลอกแล้ว");
    } catch {
      toast.push("คัดลอกไม่สำเร็จ ลองใหม่อีกครั้ง", "error");
    }
  }

  function handlePassGate(stepId: string, gateKind: string) {
    const key = `${stepId}:${gateKind}`;
    markBusy(key, true);
    startTransition(async () => {
      const result = await passCampaignGate(stepId, gateKind);
      markBusy(key, false);
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      setSteps((prev) =>
        prev.map((s) =>
          s.stepId === stepId
            ? { ...s, gates: s.gates.map((g) => (g.gateKind === gateKind ? { ...g, status: "passed" as const } : g)) }
            : s
        )
      );
      toast.push("ผ่านเงื่อนไขแล้ว");
    });
  }

  const upcoming = steps
    .filter((s) => ["todo", "scheduled", "active"].includes(s.effectiveStatus))
    .sort((a, b) => (a.daysUntil ?? 9999) - (b.daysUntil ?? 9999));
  const waiting = steps.filter((s) => s.effectiveStatus === "waiting_data" || s.effectiveStatus === "blocked");
  const done = steps.filter((s) => s.effectiveStatus === "done");

  const cardProps = {
    busyIds,
    openArtifactIds,
    onToggleArtifact: handleToggleArtifact,
    onPassGate: handlePassGate,
    onToggleContentOpen: handleToggleContentOpen,
    onCopyContent: handleCopyContent,
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-bold text-zinc-900">แคมเปญ (ตามแผน)</h2>
        <p className="text-xs text-zinc-500">{campaignName} · ติ๊ก content ที่ทำเสร็จได้เลย</p>
      </div>

      <CopilotSection title="ต้องทำเร็วๆ นี้" count={upcoming.length}>
        {upcoming.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-400">ยังไม่มี step ที่ต้องทำตอนนี้</p>
        ) : (
          upcoming.map((s) => <StepCard key={s.stepId} step={s} {...cardProps} />)
        )}
      </CopilotSection>

      {waiting.length > 0 && (
        <CopilotSection title="รอข้อมูล / เงื่อนไข" count={waiting.length} collapsible defaultOpen={false}>
          {waiting.map((s) => (
            <StepCard key={s.stepId} step={s} {...cardProps} />
          ))}
        </CopilotSection>
      )}

      {done.length > 0 && (
        <CopilotSection title="เสร็จแล้ว" count={done.length} collapsible defaultOpen={false}>
          {done.map((s) => (
            <StepCard key={s.stepId} step={s} {...cardProps} />
          ))}
        </CopilotSection>
      )}
    </section>
  );
}
