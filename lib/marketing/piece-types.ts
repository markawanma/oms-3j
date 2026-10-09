// lib/marketing/piece-types.ts — type + mapper (snake_case แถวจาก view → camelCase) ของ workflow ชิ้นงาน content
// ลอกจาก migration จริง 0159/0160/0162 (ภาคผนวก A ของ content-ui-build-plan.md) — ไม่ใช่ §13 ของ design doc
//
// Pure module (ไม่มี "use server"/"server-only") — mapper ทดสอบตรงได้ใน vitest
//
// 🔴 ห้ามใส่ชื่อจริงโฮสต์ (live_host.display_name) ในชนิดใดๆ ที่นี่ — มีแค่ expectedHostLabel (= public_label)

import type { ClipBrief } from "@/lib/marketing/clip-brief";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function strReq(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function numReq(v: unknown, fallback = 0): number {
  return num(v) ?? fallback;
}
function bool(v: unknown): boolean {
  return v === true;
}
function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function strArr(v: unknown): string[] {
  return arr(v).filter((x): x is string => typeof x === "string");
}
/** date จาก PostgREST เป็น "YYYY-MM-DD" อยู่แล้ว — ตัดส่วนเวลาถ้ามี (กัน timestamptz หลุดมา) */
function dateOnly(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  return s.length >= 10 ? s.slice(0, 10) : s;
}

// ---------------------------------------------------------------------------
// ชิ้นงาน (v_content_piece)
// ---------------------------------------------------------------------------

export interface PieceHook {
  id: string;
  label: "A" | "B" | null;
  text: string;
  /** ประเภทที่ผ่าน CHECK แล้ว (null = ยังไม่ติดประเภท — ค่าดิบเก่าไม่อยู่ใน 8 ประเภท) */
  hookType: string | null;
  derivedFromHookId: string | null;
  sourceSignalId: string | null;
}

export interface PieceGate {
  status: string;
  detail: Record<string, unknown> | null;
  note: string | null;
  checkedByRole: string | null;
  passedAt: string | null;
}

export interface PiecePost {
  postId: string;
  platform: string;
  postUrl: string;
  postedAt: string | null;
  status: string;
  hookId: string | null;
}

export interface PieceGates {
  factCheck: PieceGate | null;
  brandRule: PieceGate | null;
  riskOwner: PieceGate | null;
}

export interface PieceRow {
  stepId: string;
  campaignId: string;
  campaignName: string | null;
  campaignType: string | null;
  title: string;
  pieceStatus: string;
  effectiveStatus: string;
  holdReason: string | null;
  pieceKind: string | null;
  channel: string | null;
  customerGroup: string | null;
  timeSlot: string | null;
  startTime: string | null;
  resolvedStart: string | null;
  resolvedEnd: string | null;
  daysUntil: number | null;
  hypothesis: string | null;
  metricCode: string | null;
  baselineValue: number | null;
  baselineAsOf: string | null;
  passThreshold: number | null;
  passOp: string | null;
  baselineSpread: number | null;
  thresholdTooNarrow: boolean;
  footageStatus: string | null;
  footageUrl: string | null;
  shootNote: string | null;
  shootLocation: string | null;
  shootMinutesEst: number | null;
  shootDate: string | null;
  expectedHostId: string | null;
  /** public_label ("โฮสต์ A") เท่านั้น — ไม่ใช่ชื่อจริง */
  expectedHostLabel: string | null;
  draftedByAi: boolean;
  lineAudience: string | null;
  lineAudienceReason: string | null;
  audienceSegment: string | null;
  contentTypeCode: string | null;
  artifactId: string | null;
  artifactType: string | null;
  /** เฉพาะ query แบบ full (หน้า detail / การ์ดอนุมัติ) */
  contentBody: string | null;
  clipBrief: ClipBrief | null;
  humanEdited: boolean;
  hooks: PieceHook[];
  gates: PieceGates;
  gatesPassed: boolean;
  confirmPending: number;
  confirmMarkerInText: boolean;
  canApprove: boolean;
  posts: PiecePost[];
  postedOn: string | null;
  sourceSignalId: string | null;
  approvedAt: string | null;
  approvedByRole: string | null;
  lastEventAt: string | null;
}

function mapHook(raw: unknown): PieceHook | null {
  const r = obj(raw);
  if (!r) return null;
  const label = str(r.label);
  return {
    id: strReq(r.id),
    label: label === "A" || label === "B" ? label : null,
    text: strReq(r.text),
    hookType: str(r.hook_type),
    derivedFromHookId: str(r.derived_from_hook_id),
    sourceSignalId: str(r.source_signal_id),
  };
}

function mapGate(raw: unknown): PieceGate | null {
  const r = obj(raw);
  if (!r) return null;
  return {
    status: strReq(r.status, "pending"),
    detail: obj(r.detail),
    note: str(r.note),
    checkedByRole: str(r.checked_by_role),
    passedAt: str(r.passed_at),
  };
}

function mapPost(raw: unknown): PiecePost | null {
  const r = obj(raw);
  if (!r) return null;
  return {
    postId: strReq(r.post_id),
    platform: strReq(r.platform),
    postUrl: strReq(r.post_url),
    postedAt: str(r.posted_at),
    status: strReq(r.status, "active"),
    hookId: str(r.hook_id),
  };
}

export function mapPieceRow(r: Record<string, unknown>): PieceRow {
  const gates = obj(r.gates) ?? {};
  const pieceStatus = strReq(r.piece_status);
  return {
    stepId: strReq(r.step_id),
    campaignId: strReq(r.campaign_id),
    campaignName: str(r.campaign_name),
    campaignType: str(r.campaign_type),
    title: strReq(r.title, "(ไม่มีชื่อ)"),
    pieceStatus,
    effectiveStatus: strReq(r.effective_piece_status, pieceStatus),
    holdReason: str(r.hold_reason),
    pieceKind: str(r.piece_kind),
    channel: str(r.channel),
    customerGroup: str(r.customer_group),
    timeSlot: str(r.time_slot),
    startTime: str(r.start_time),
    resolvedStart: dateOnly(r.resolved_start),
    resolvedEnd: dateOnly(r.resolved_end),
    daysUntil: num(r.days_until),
    hypothesis: str(r.hypothesis),
    metricCode: str(r.metric_code),
    baselineValue: num(r.baseline_value),
    baselineAsOf: dateOnly(r.baseline_as_of),
    passThreshold: num(r.pass_threshold),
    passOp: str(r.pass_op),
    baselineSpread: num(r.baseline_spread),
    thresholdTooNarrow: bool(r.threshold_too_narrow),
    footageStatus: str(r.footage_status),
    footageUrl: str(r.footage_url),
    shootNote: str(r.shoot_note),
    shootLocation: str(r.shoot_location),
    shootMinutesEst: num(r.shoot_minutes_est),
    shootDate: dateOnly(r.shoot_date),
    expectedHostId: str(r.expected_host_id),
    expectedHostLabel: str(r.expected_host_label),
    draftedByAi: bool(r.drafted_by_ai),
    lineAudience: str(r.line_audience),
    lineAudienceReason: str(r.line_audience_reason),
    audienceSegment: str(r.audience_segment),
    contentTypeCode: str(r.content_type_code),
    artifactId: str(r.artifact_id),
    artifactType: str(r.artifact_type),
    contentBody: str(r.content_body),
    clipBrief: (obj(r.clip_brief) as unknown as ClipBrief | null) ?? null,
    humanEdited: bool(r.human_edited),
    hooks: arr(r.hooks)
      .map(mapHook)
      .filter((h): h is PieceHook => h !== null),
    gates: {
      factCheck: mapGate(gates.fact_check),
      brandRule: mapGate(gates.brand_rule),
      riskOwner: mapGate(gates.risk_owner),
    },
    gatesPassed: bool(r.gates_passed),
    confirmPending: numReq(r.confirm_pending),
    confirmMarkerInText: bool(r.confirm_marker_in_text),
    canApprove: bool(r.can_approve),
    posts: arr(r.posts)
      .map(mapPost)
      .filter((p): p is PiecePost => p !== null),
    postedOn: dateOnly(r.posted_on),
    sourceSignalId: str(r.source_signal_id),
    approvedAt: str(r.approved_at),
    approvedByRole: str(r.approved_by_role),
    lastEventAt: str(r.last_event_at),
  };
}

/** คอลัมน์เบา (ไม่มี content_body/clip_brief) — ใช้กับ list/นับ */
export const PIECE_LIGHT_COLUMNS = [
  "step_id",
  "campaign_id",
  "campaign_name",
  "campaign_type",
  "title",
  "piece_status",
  "effective_piece_status",
  "hold_reason",
  "piece_kind",
  "channel",
  "customer_group",
  "time_slot",
  "start_time",
  "resolved_start",
  "resolved_end",
  "days_until",
  "footage_status",
  "footage_url",
  "shoot_note",
  "shoot_location",
  "shoot_minutes_est",
  "shoot_date",
  "expected_host_id",
  "expected_host_label",
  "drafted_by_ai",
  "line_audience",
  "line_audience_reason",
  "content_type_code",
  "artifact_id",
  "artifact_type",
  "human_edited",
  "hooks",
  "gates",
  "gates_passed",
  "confirm_pending",
  "confirm_marker_in_text",
  "can_approve",
  "posts",
  "posted_on",
  "source_signal_id",
  "approved_at",
  "approved_by_role",
  "last_event_at",
].join(", ");

/** คอลัมน์เต็ม — หน้ารายละเอียดชิ้นงาน / การ์ดอนุมัติ (มีเนื้อหา + storyboard) */
export const PIECE_FULL_COLUMNS = [
  PIECE_LIGHT_COLUMNS,
  "hypothesis",
  "metric_code",
  "baseline_value",
  "baseline_as_of",
  "pass_threshold",
  "pass_op",
  "baseline_spread",
  "threshold_too_narrow",
  "audience_segment",
  "content_body",
  "clip_brief",
].join(", ");

// ---------------------------------------------------------------------------
// ตัวนับกองงาน (v_content_inbox_counts)
// ---------------------------------------------------------------------------

export interface InboxCounts {
  postToday: number;
  postOverdueNoLink: number;
  reviewQueue: number;
  /** DB ตัดสิน (> เพดานของ view) — ห้ามเทียบเลขเองใน client */
  reviewOverLimit: boolean;
  ideas: number;
  ownerQuestions: number;
  shootThisWeek: number;
  onHold: number;
}

export function mapInboxCounts(r: Record<string, unknown> | null): InboxCounts {
  const x = r ?? {};
  return {
    postToday: numReq(x.post_today),
    postOverdueNoLink: numReq(x.post_overdue_no_link),
    reviewQueue: numReq(x.review_queue),
    reviewOverLimit: bool(x.review_over_limit),
    ideas: numReq(x.ideas),
    ownerQuestions: numReq(x.owner_questions),
    shootThisWeek: numReq(x.shoot_this_week),
    onHold: numReq(x.on_hold),
  };
}

// ---------------------------------------------------------------------------
// ข้อเสนอ/คำถาม AI (v_recommendation_inbox)
// ---------------------------------------------------------------------------

export type RecoItemKind = "reco" | "risk_gate" | "campaign_verdict";

export interface RecoInboxRow {
  itemKind: RecoItemKind | string;
  itemId: string;
  /** reco: question | proposal · ชนิดอื่น: null */
  kind: string | null;
  title: string;
  detail: string | null;
  effortMinutesEst: number | null;
  respondBy: string | null;
  defaultAction: string | null;
  relatedCampaignId: string | null;
  relatedStepId: string | null;
  summaryId: string | null;
  source: string | null;
  createdAt: string | null;
  ownerAction: string | null;
  effectiveAction: string;
  daysLeft: number | null;
  isLate: boolean;
  outcomeNote: string | null;
  actedAt: string | null;
  ownerResponse: string | null;
  /** token CAS ของแถวที่ view ให้ — ส่งกลับตอนตอบ ห้ามสร้างเอง */
  contentToken: string | null;
}

export function mapRecoRow(r: Record<string, unknown>): RecoInboxRow {
  return {
    itemKind: strReq(r.item_kind),
    itemId: strReq(r.item_id),
    kind: str(r.kind),
    title: strReq(r.title, "(ไม่มีหัวข้อ)"),
    detail: str(r.detail),
    effortMinutesEst: num(r.effort_minutes_est),
    respondBy: dateOnly(r.respond_by),
    defaultAction: str(r.default_action),
    relatedCampaignId: str(r.related_campaign_id),
    relatedStepId: str(r.related_step_id),
    summaryId: str(r.summary_id),
    source: str(r.source),
    createdAt: str(r.created_at),
    ownerAction: str(r.owner_action),
    effectiveAction: strReq(r.effective_action, "pending"),
    daysLeft: num(r.days_left),
    isLate: bool(r.is_late),
    outcomeNote: str(r.outcome_note),
    actedAt: str(r.acted_at),
    ownerResponse: str(r.owner_response),
    contentToken: str(r.content_token),
  };
}

// ---------------------------------------------------------------------------
// สรุปสัปดาห์ (content_weekly_summary — เฉพาะที่หน้า inbox ใช้ ไม่ดึง body_md)
// ---------------------------------------------------------------------------

export interface WeeklySummaryRow {
  id: string;
  weekStart: string;
  briefDate: string | null;
  briefNo: number | null;
  summaryLines: string[];
}

export function mapWeeklySummary(r: Record<string, unknown>): WeeklySummaryRow {
  return {
    id: strReq(r.id),
    weekStart: dateOnly(r.week_start) ?? "",
    briefDate: dateOnly(r.brief_date),
    briefNo: num(r.brief_no),
    summaryLines: strArr(r.summary_lines),
  };
}

// ---------------------------------------------------------------------------
// event + รายการต้องยืนยัน
// ---------------------------------------------------------------------------

export interface PieceEvent {
  id: string;
  seq: number;
  eventKind: string;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  actorRole: string | null;
  reviewSeconds: number | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export function mapPieceEvent(r: Record<string, unknown>): PieceEvent {
  return {
    id: strReq(r.id),
    seq: numReq(r.seq),
    eventKind: strReq(r.event_kind),
    fromStatus: str(r.from_status),
    toStatus: str(r.to_status),
    reason: str(r.reason),
    actorRole: str(r.actor_role),
    reviewSeconds: num(r.review_seconds),
    payload: obj(r.payload) ?? {},
    createdAt: strReq(r.created_at),
  };
}

export interface ConfirmItem {
  id: string;
  key: string;
  question: string;
  answer: string | null;
  resolvedAt: string | null;
}

export function mapConfirmItem(r: Record<string, unknown>): ConfirmItem {
  return {
    id: strReq(r.id),
    key: strReq(r.key),
    question: strReq(r.question, "(ไม่ระบุ)"),
    answer: str(r.answer),
    resolvedAt: str(r.resolved_at),
  };
}

/** ตัวเลือกโฮสต์ที่คาด — public_label เท่านั้น */
export interface HostOption {
  id: string;
  publicLabel: string;
}

export interface ContentTypeOption {
  code: string;
  labelTh: string;
  colorHex: string;
}

// ---------------------------------------------------------------------------
// ผลรวมสำหรับหน้า (server action → page)
// ---------------------------------------------------------------------------

/** ผลของส่วนหนึ่งของหน้า — ล้มได้อิสระ (Promise.allSettled ไม่ใช่ all: กองหนึ่งล้ม กองอื่นยังแสดง) */
export type Part<T> = { ok: true; data: T } | { ok: false; error: string };

export interface SignalOrigin {
  kind: string;
  summary: string;
  seenOn: string | null;
}

export interface PieceDetailData {
  piece: PieceRow;
  /** เรียง seq มาก→น้อย (ล่าสุดก่อน) */
  events: PieceEvent[];
  confirmItems: ConfirmItem[];
  sourceSignal: SignalOrigin | null;
  hosts: HostOption[];
  contentTypes: ContentTypeOption[];
}

export interface LineQuota {
  used28d: number;
  planned28d: number;
  quota: number;
  remaining28d: number;
  overQuotaPlanned: boolean;
}

export interface NextScheduled {
  stepId: string;
  title: string;
  resolvedStart: string;
}

export interface InboxData {
  todayTh: string;
  counts: Part<InboxCounts>;
  postRows: Part<PieceRow[]>;
  /** step id ของชิ้นที่ถึงเวลาโพสต์แล้วแต่ยังไม่วางลิงก์ (flag_no_link_overdue จาก view — DB ตัดสิน) */
  overdueNoLinkIds: string[];
  reviewRows: Part<PieceRow[]>;
  weekRows: Part<PieceRow[]>;
  weekFrom: string;
  weekTo: string;
  reco: Part<RecoInboxRow[]>;
  weekly: Part<WeeklySummaryRow | null>;
  entryTodayCount: Part<number>;
  lineQuota: Part<LineQuota | null>;
  nextScheduled: Part<NextScheduled | null>;
}
