// lib/marketing/campaign-types.ts — Campaign Playbook (Ad Copilot "แคมเปญตามแผน")
// TS mirror of analytics.v_campaign_board (0049, extended by 0057) + Thai label
// maps. Enum values are the source of truth in
// docs/3j-jewelry/marketing/campaign-playbook-taxonomy.md §ENUMS and the CHECK
// constraints in 0049/0057 — keep these in sync with both.

import type { ClipBrief } from "@/lib/marketing/clip-brief";

export type EffectiveStatus =
  | "todo"
  | "scheduled"
  | "active"
  | "blocked"
  | "waiting_data"
  | "done";

// 0057 widens this to 6 values (design §D5): 'draft_pending_review' = an AI
// agent wrote it and nobody has looked yet, 'approved' = a human signed off
// (reviewed_by/at stamped by campaign_set_artifact_status). The original 4
// stay exactly as they were — CampaignBoard (9.9 board) keeps working as-is.
export type ArtifactStatus =
  | "todo"
  | "draft_pending_review"
  | "draft"
  | "approved"
  | "done"
  | "blocked";
export type GateStatus = "pending" | "passed" | "blocked" | "na";

export type ArtifactGeneratedBy = "human" | "ai_copywriter" | "template_seed";

export interface CampaignArtifact {
  id: string;
  artifactType: string;
  ownerRole: string;
  sourceDoc: string | null;
  status: ArtifactStatus;
  isDynamic: boolean;
  dynamicSource: string | null;
  discountPct: number | null;
  note: string | null;
  /** Full copy the copywriter wrote (LINE script ฯลฯ) — null when not written
   * yet. Rendered expandable in the board so the owner reads it in-app instead
   * of digging in repo docs. */
  contentBody: string | null;
  /** Structured shooting brief for short_form_clip / live_highlight_clip
   * artifacts (design §5). null for every other artifact_type. */
  clipBrief: ClipBrief | null;
  generatedBy: ArtifactGeneratedBy;
  generatedModel: string | null;
  humanEdited: boolean;
  reviewedAt: string | null;
}

export interface CampaignGate {
  gateKind: string;
  status: GateStatus;
  passedAt: string | null;
  note: string | null;
}

export interface CampaignBoardStep {
  stepId: string;
  campaignId: string;
  campaignName: string;
  campaignType: string;
  triggerKind: string;
  anchorDate: string | null;
  seq: number;
  stepKind: string;
  resolvedStart: string | null;
  resolvedEnd: string | null;
  daysUntil: number | null;
  audienceSegment: string | null;
  audienceLiveCount: number | null;
  channel: string | null;
  goalKpi: string | null;
  stepStatus: string;
  stepBlockedReason: string | null;
  artifacts: CampaignArtifact[];
  artTotal: number;
  artDone: number;
  gates: CampaignGate[];
  effectiveStatus: EffectiveStatus;
  /** cs.title (0057) — a person-typed name for this step; null = fall back to
   * STEP_KIND_LABEL[stepKind] (unchanged rendering rule for template steps). */
  stepTitle: string | null;
  /** cp.source_reco_key (0057) — the Ad Copilot reco_key that spawned this
   * campaign, if any. Lets the calendar link back to /marketing/copilot. */
  sourceRecoKey: string | null;
  /** campaign_step.start_time (0060), "HH:MM" 24-hour text or null — the
   * live's start time isn't fixed day to day (18:00 one day, 21:00 the
   * next), so this is owner-typed, never derived. null = no time set
   * ("ทั้งวัน" in the UI), not midnight. */
  startTime: string | null;
  /** v_campaign_board.step_origin (0060): 'template' rows came from a
   * campaign_template plan and can't be deleted (R8 rejects them
   * server-side already) — surfaced here so the UI can disable the delete
   * button instead of letting the owner hit an error. */
  stepOrigin: "template" | "manual";
}

// ---- Thai labels ----------------------------------------------------------

export const STEP_KIND_LABEL: Record<string, string> = {
  teaser: "Teaser (ปล่อยตัวอย่าง)",
  vip_private_access: "VIP เปิดจองก่อน",
  main_day: "วันจริง",
  last_call: "ปิดการขาย (last call)",
  post_sale: "หลังการขาย",
  reconnect: "ทักกลับ (soft)",
  segment_offer: "ยื่นข้อเสนอตามกลุ่ม",
  followup_nudge: "กระตุ้นซ้ำ",
  pre_live_hook: "hook ก่อนไลฟ์",
  live_session: "ไลฟ์",
  live_highlight_recap: "ตัดคลิปไฮไลต์",
  identify: "คัดกลุ่มเป้าหมาย",
  personal_outreach: "ทัก 1:1",
  perk_fulfillment: "จัด perk (สลัก/กล่อง)",
  remind: "เตือน",
  cross_sell_matching: "เสนอชิ้นเข้าชุด",
  insert_card: "การ์ดในพัสดุ",
  live_cta: "CTA ในไลฟ์",
  capture_consent: "เก็บ consent",
  close: "ปิดแคมเปญ",
  content_task: "งานที่เพิ่มเอง",
};

export const ARTIFACT_TYPE_LABEL: Record<string, string> = {
  broadcast_script_line: "สคริปต์ broadcast (LINE)",
  dm_script_1to1: "สคริปต์ทัก 1:1",
  teaser_image: "รูป teaser",
  cta_button_flex: "ปุ่ม CTA (Flex)",
  parcel_card: "การ์ดใส่พัสดุ",
  live_rundown: "รันดาวน์ไลฟ์",
  attribution_code: "โค้ดวัดผล",
  short_form_clip: "คลิปสั้น",
  live_highlight_clip: "คลิปไฮไลต์ไลฟ์",
  fb_post: "โพสต์ Facebook",
  bundle_offer_spec: "สเปกบันเดิล",
};

export const OWNER_ROLE_LABEL: Record<string, string> = {
  copywriter: "Copywriter",
  content_repurposer: "Content",
  owner: "เจ้าของร้าน",
  cfo: "CFO",
  coo: "COO",
  tech_lead: "Tech Lead",
  host: "Host ไลฟ์",
};

export const AUDIENCE_LABEL: Record<string, string> = {
  champion: "ลูกค้าชั้นดี (champion)",
  loyal: "ลูกค้าประจำ (loyal)",
  new: "ลูกค้าใหม่",
  at_risk: "ลูกค้าเสี่ยงหาย",
  all_followers: "ผู้ติดตามทั้งหมด",
  geo_bkk: "กรุงเทพฯ",
  silver_bar: "สายเงินแท่ง/ลงทุน",
  tiktok_buyer: "ลูกค้า TikTok",
  line_follower: "ผู้ติดตาม LINE",
};

export const GATE_LABEL: Record<string, string> = {
  cfo_discount_approval: "CFO อนุมัติส่วนลด",
  coo_stock_check: "COO เช็คสต็อก",
  pdpa_consent: "PDPA consent",
  quota_check: "เช็คโควตาข้อความ",
  price_realtime_fill: "กรอกราคาเงินวันนี้",
};

export const ARTIFACT_STATUS_LABEL: Record<ArtifactStatus, string> = {
  todo: "ยังไม่ทำ",
  draft_pending_review: "AI ร่าง รอตรวจ",
  draft: "ร่างแล้ว",
  approved: "อนุมัติแล้ว",
  done: "เสร็จ",
  blocked: "ติดเงื่อนไข",
};

/** Runtime whitelist for the status write path. Genuinely derived from the
 * label map above (which TS forces to be exhaustive over ArtifactStatus), so a
 * new state can't be added to the union and silently left out here — a
 * hand-written array would only catch extras, never omissions, and an omission
 * is exactly what made the "อนุมัติ" button reject its own status. */
export const ARTIFACT_STATUSES = Object.keys(ARTIFACT_STATUS_LABEL) as ArtifactStatus[];

export const EFFECTIVE_STATUS_LABEL: Record<EffectiveStatus, string> = {
  todo: "ยังไม่ถึงคิว",
  scheduled: "ตามแผน",
  active: "กำลังทำ",
  blocked: "ติดเงื่อนไข",
  waiting_data: "รอข้อมูล",
  done: "เสร็จแล้ว",
};
