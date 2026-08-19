// lib/marketing/campaign-board-mapper.ts — single row-shape mapper for
// analytics.v_campaign_board (0049, extended by 0057 — design §D6/§4). Both
// getCampaignBoard (lib/actions/marketing.ts, the 9.9 CampaignBoard) and
// getCalendarTasks/getCalendarTask (lib/actions/calendar.ts, M2) read this
// exact same view and must stay byte-for-byte consistent in how they turn
// its columns into CampaignBoardStep — hence one mapper instead of two
// copies that would silently drift.
import type { ClipBrief } from "@/lib/marketing/clip-brief";
import type { ArtifactStatus, CampaignArtifact, CampaignBoardStep } from "@/lib/marketing/campaign-types";

/** Column list every v_campaign_board query should select — keep in sync
 * with the view's SELECT list (0057 §5.4). Nested artifact fields
 * (clip_brief, generated_by, ...) live inside the `artifacts` jsonb column
 * already, so they don't need their own entry here. */
export const CAMPAIGN_BOARD_SELECT =
  "step_id, campaign_id, campaign_name, campaign_type, trigger_kind, anchor_date, seq, step_kind, resolved_start, resolved_end, days_until, audience_segment, audience_live_count, channel, goal_kpi, step_status, step_blocked_reason, artifacts, art_total, art_done, gates, effective_status, step_title, source_reco_key";

function mapArtifact(a: Record<string, unknown>): CampaignArtifact {
  return {
    id: String(a.id),
    artifactType: String(a.artifact_type),
    ownerRole: String(a.owner_role),
    sourceDoc: (a.source_doc as string) ?? null,
    status: a.status as ArtifactStatus,
    isDynamic: Boolean(a.is_dynamic),
    dynamicSource: (a.dynamic_source as string) ?? null,
    discountPct: a.discount_pct === null || a.discount_pct === undefined ? null : Number(a.discount_pct),
    note: (a.note as string) ?? null,
    contentBody: (a.content_body as string) ?? null,
    // clip_brief is jsonb straight from step_artifact, already validated at
    // write time by R4/R5 (analytics.assert_clip_brief_valid) — cast, don't
    // re-validate here. isValidClipBrief() is for the write path / UI form.
    clipBrief: (a.clip_brief as ClipBrief | null | undefined) ?? null,
    generatedBy: (a.generated_by as CampaignArtifact["generatedBy"]) ?? "human",
    generatedModel: (a.generated_model as string) ?? null,
    humanEdited: Boolean(a.human_edited),
    reviewedAt: (a.reviewed_at as string) ?? null,
  };
}

/** Turns one row of v_campaign_board (selected with CAMPAIGN_BOARD_SELECT)
 * into a CampaignBoardStep. `r` is untyped (Record<string, unknown>) because
 * that's what comes back from PostgREST — every field is defensively cast. */
export function mapCampaignBoardRow(r: Record<string, unknown>): CampaignBoardStep {
  return {
    stepId: String(r.step_id),
    campaignId: String(r.campaign_id),
    campaignName: String(r.campaign_name),
    campaignType: String(r.campaign_type),
    triggerKind: String(r.trigger_kind),
    anchorDate: (r.anchor_date as string) ?? null,
    seq: Number(r.seq) || 0,
    stepKind: String(r.step_kind),
    resolvedStart: (r.resolved_start as string) ?? null,
    resolvedEnd: (r.resolved_end as string) ?? null,
    daysUntil: r.days_until === null || r.days_until === undefined ? null : Number(r.days_until),
    audienceSegment: (r.audience_segment as string) ?? null,
    audienceLiveCount:
      r.audience_live_count === null || r.audience_live_count === undefined ? null : Number(r.audience_live_count),
    channel: (r.channel as string) ?? null,
    goalKpi: (r.goal_kpi as string) ?? null,
    stepStatus: String(r.step_status),
    stepBlockedReason: (r.step_blocked_reason as string) ?? null,
    artifacts: (Array.isArray(r.artifacts) ? r.artifacts : []).map((a: Record<string, unknown>) => mapArtifact(a)),
    artTotal: Number(r.art_total) || 0,
    artDone: Number(r.art_done) || 0,
    gates: (Array.isArray(r.gates) ? r.gates : []).map((g: Record<string, unknown>) => ({
      gateKind: String(g.gate_kind),
      status: g.status as CampaignBoardStep["gates"][number]["status"],
      passedAt: (g.passed_at as string) ?? null,
      note: (g.note as string) ?? null,
    })),
    effectiveStatus: r.effective_status as CampaignBoardStep["effectiveStatus"],
    stepTitle: (r.step_title as string) ?? null,
    sourceRecoKey: (r.source_reco_key as string) ?? null,
  };
}
