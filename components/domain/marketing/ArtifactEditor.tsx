"use client";

// ArtifactEditor — one step_artifact card on /marketing/calendar/[stepId]
// (M4, design ux-content-calendar.md §3 item 3 + phase-content-calendar-design.md
// §D5). Same content-body read/edit/copy affordance as CampaignBoard.tsx's
// checklist item, expanded to a full status stepper (todo -> draft ->
// approved -> done) instead of a single done/not-done toggle, plus the AI
// provenance badges 0057 added (generated_by/generated_model/human_edited).
//
// Status writes go through setCampaignArtifactStatus (lib/actions/marketing.ts,
// unchanged this phase) — ⚠️ that action's runtime whitelist is
// ["todo","draft","done","blocked"] and does NOT yet include the two 0057
// values ("draft_pending_review","approved") even though its `status`
// param is typed ArtifactStatus (all 6). Clicking "อนุมัติ" today will hit
// that whitelist and show "สถานะไม่ถูกต้อง" via toast — a real gap in a file
// this task is not allowed to touch (see PR notes). The button is still
// wired correctly (campaign_set_artifact_status, the RPC underneath,
// already supports 'approved' per 0057 R7) so it starts working the moment
// that one-line whitelist is widened.

import { useState, useTransition } from "react";
import { setCampaignArtifactStatus } from "@/lib/actions/marketing";
import { setArtifactContent } from "@/lib/actions/calendar";
import { ARTIFACT_STATUS_LABEL, ARTIFACT_TYPE_LABEL, OWNER_ROLE_LABEL } from "@/lib/marketing/campaign-types";
import type { ArtifactStatus, CampaignArtifact } from "@/lib/marketing/campaign-types";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

const STATUS_TONE: Record<ArtifactStatus, BadgeTone> = {
  todo: "slate",
  draft_pending_review: "amber",
  draft: "amber",
  approved: "green",
  done: "green",
  blocked: "red",
};

export function ArtifactEditor({ artifact }: { artifact: CampaignArtifact }) {
  const toast = useToast();
  const [status, setStatus] = useState<ArtifactStatus>(artifact.status);
  const [contentBody, setContentBody] = useState(artifact.contentBody ?? "");
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(contentBody);
  const [savingContent, startSaveContentTransition] = useTransition();
  const [changingStatus, startStatusTransition] = useTransition();

  function handleSaveContent() {
    startSaveContentTransition(async () => {
      const result = await setArtifactContent(artifact.id, { contentBody: draftText });
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      setContentBody(draftText);
      setEditing(false);
      toast.push("บันทึกเนื้อหาแล้ว");
    });
  }

  function handleStatusChange(next: ArtifactStatus) {
    startStatusTransition(async () => {
      const result = await setCampaignArtifactStatus(artifact.id, next);
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      setStatus(next);
      toast.push("อัปเดตสถานะแล้ว");
    });
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(contentBody);
      toast.push("คัดลอกแล้ว");
    } catch {
      toast.push("คัดลอกไม่สำเร็จ ลองใหม่อีกครั้ง", "error");
    }
  }

  const isBlocked = status === "blocked";
  const isDone = status === "done";

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-zinc-800">
          {ARTIFACT_TYPE_LABEL[artifact.artifactType] ?? artifact.artifactType}
          <span className="font-normal text-zinc-400"> · {OWNER_ROLE_LABEL[artifact.ownerRole] ?? artifact.ownerRole}</span>
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge tone={STATUS_TONE[status]}>{ARTIFACT_STATUS_LABEL[status]}</Badge>
          {artifact.generatedBy === "ai_copywriter" && (
            <span title={artifact.generatedModel ? `model: ${artifact.generatedModel}` : undefined}>
              <Badge tone="indigo" className="text-[0.65rem]">
                🤖 AI ร่าง
              </Badge>
            </span>
          )}
          {artifact.humanEdited && (
            <Badge tone="slate" className="text-[0.65rem]">
              แก้โดยคน
            </Badge>
          )}
        </div>
      </div>

      {artifact.note && <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{artifact.note}</p>}

      <div className="mt-2.5">
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              rows={6}
              className="w-full rounded-md border border-zinc-300 p-2.5 text-sm leading-relaxed focus:border-primary-500 focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setDraftText(contentBody);
                  setEditing(false);
                }}
              >
                ยกเลิก
              </Button>
              <Button size="sm" loading={savingContent} onClick={handleSaveContent}>
                บันทึก
              </Button>
            </div>
          </div>
        ) : contentBody ? (
          <div className="rounded-md border border-zinc-100 bg-zinc-50/60 p-2.5">
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-700">{contentBody}</p>
            <div className="mt-1.5 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setDraftText(contentBody);
                  setEditing(true);
                }}
                className="min-h-8 text-[0.7rem] font-semibold text-primary-600 hover:underline"
              >
                แก้ไข
              </button>
              <button type="button" onClick={handleCopy} className="min-h-8 text-[0.7rem] font-semibold text-primary-600 hover:underline">
                คัดลอก
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraftText("");
              setEditing(true);
            }}
            className="min-h-9 text-xs font-semibold text-primary-600 hover:underline"
          >
            + เพิ่มเนื้อหา
          </button>
        )}
      </div>

      {!isBlocked && (
        <div className="mt-3 flex flex-wrap gap-2">
          {status === "todo" && (
            <Button variant="secondary" size="sm" loading={changingStatus} onClick={() => handleStatusChange("draft")}>
              เริ่มร่าง
            </Button>
          )}
          {(status === "draft" || status === "draft_pending_review") && (
            <Button size="sm" loading={changingStatus} onClick={() => handleStatusChange("approved")}>
              อนุมัติ
            </Button>
          )}
          {status === "approved" && (
            <Button size="sm" loading={changingStatus} onClick={() => handleStatusChange("done")}>
              ทำเครื่องหมายเสร็จ
            </Button>
          )}
          {isDone && (
            <Button variant="ghost" size="sm" loading={changingStatus} onClick={() => handleStatusChange("draft")}>
              ปรับเป็นยังไม่เสร็จ
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
