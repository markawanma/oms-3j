// lib/marketing/piece-labels.ts — ป้ายไทย + tone ของ enum ทั้งหมดใน workflow ชิ้นงาน content
// (docs/3j-jewelry/marketing/content-ui-build-plan.md §5.1, §7)
//
// Pure module (ไม่มี "use server"/"server-only") — ใช้ได้ทั้ง server action, component, และ vitest.
// ทุก enum ที่ DB CHECK ไว้ต้องมี label ครบ — piece-labels.test.ts ไล่ค่าครบ (กัน enum ใหม่หลุดเป็นภาษาอังกฤษดิบบนจอ).

import type { BadgeTone } from "@/components/ui/Badge";
import { PLATFORM_LABEL } from "@/lib/marketing/content-types";

// ---------------------------------------------------------------------------
// สถานะชิ้นงาน
// ---------------------------------------------------------------------------

/** สถานะดิบใน campaign_step.piece_status (ตรง CHECK ใน 0159) */
export const RAW_PIECE_STATUSES = [
  "idea",
  "planned",
  "drafting",
  "in_review",
  "approved",
  "produced",
  "posted",
  "cancelled",
] as const;
export type RawPieceStatus = (typeof RAW_PIECE_STATUSES)[number];

/** สถานะที่ view คำนวณสด (v_content_piece.effective_piece_status) */
export const EFFECTIVE_PIECE_STATUSES = [
  "idea",
  "planned",
  "drafting",
  "in_review",
  "approved",
  "produced",
  "posted",
  "measuring",
  "measured",
  "missed_measure",
  "on_hold",
  "cancelled",
] as const;
export type EffectivePieceStatus = (typeof EFFECTIVE_PIECE_STATUSES)[number];

export const PIECE_STATUS_LABEL: Record<EffectivePieceStatus, string> = {
  idea: "ไอเดีย",
  planned: "วางแผนแล้ว",
  drafting: "AI ร่าง",
  in_review: "รอตรวจ",
  approved: "อนุมัติแล้ว",
  produced: "ผลิตแล้ว",
  posted: "โพสต์แล้ว",
  measuring: "กำลังวัดผล",
  measured: "วัดผลแล้ว",
  missed_measure: "พลาดรอบวัด",
  on_hold: "รอเงื่อนไข",
  cancelled: "ยกเลิก",
};

/** tone เริ่มต้นตาม §5.1 — "อนุมัติแล้ว" (เขียว) ต้องต่างจาก "ผลิตแล้ว" (cyan) ชัดเจน */
export const PIECE_STATUS_TONE: Record<EffectivePieceStatus, BadgeTone> = {
  idea: "slate",
  planned: "slate",
  drafting: "blue",
  in_review: "amber",
  approved: "green",
  produced: "cyan",
  posted: "black",
  measuring: "indigo",
  measured: "indigo",
  missed_measure: "slate",
  on_hold: "orange",
  cancelled: "slate",
};

export function pieceStatusLabel(status: string | null | undefined): string {
  if (!status) return "ยังไม่ระบุ";
  return PIECE_STATUS_LABEL[status as EffectivePieceStatus] ?? "ไม่ทราบสถานะ";
}

/** 9 ขั้นของ stepper (ไม่มีเลขกำกับ — brief 0.4) เรียงตามลำดับ */
export const STEPPER_STEPS = [
  "idea",
  "planned",
  "drafting",
  "in_review",
  "approved",
  "produced",
  "posted",
  "measuring",
  "measured",
] as const;
export type StepperStep = (typeof STEPPER_STEPS)[number];

/**
 * ตำแหน่งปัจจุบันบน stepper จากสถานะดิบ + สถานะ effective
 * - on_hold/cancelled: ใช้สถานะดิบ (ไม่ย้ายตำแหน่ง)
 * - missed_measure: ยืนที่ "โพสต์แล้ว" (ผ่านขั้นวัดผลไม่ได้) — ผู้เรียกแสดงป้ายแยก
 * คืน null เมื่อไม่รู้จักสถานะ (ไม่เดา)
 */
export function stepperIndex(rawStatus: string | null | undefined, effective: string | null | undefined): number | null {
  const key =
    effective === "on_hold" || effective === "cancelled" || !effective
      ? rawStatus
      : effective === "missed_measure"
        ? "posted"
        : effective;
  if (!key) return null;
  const idx = (STEPPER_STEPS as readonly string[]).indexOf(key);
  return idx >= 0 ? idx : null;
}

/** ขั้นถัดไปที่ "ควรเกิด" บน stepper (แสดงข้อความ "ถัดไป: …") — null เมื่อถึงปลายทาง/ไม่รู้ */
export function nextStepperLabel(index: number | null): string | null {
  if (index === null) return null;
  const next = STEPPER_STEPS[index + 1];
  return next ? PIECE_STATUS_LABEL[next] : null;
}

// ---------------------------------------------------------------------------
// enum ของแผน
// ---------------------------------------------------------------------------

export const PIECE_KINDS = ["short_clip", "live_cut", "ig_fb_post", "line_message", "story"] as const;
export type PieceKind = (typeof PIECE_KINDS)[number];
export const PIECE_KIND_LABEL: Record<PieceKind, string> = {
  short_clip: "คลิปสั้น",
  live_cut: "คลิปตัดจากไลฟ์",
  ig_fb_post: "โพสต์ FB/IG",
  line_message: "ข้อความ LINE",
  story: "สตอรี่",
};

export const CHANNELS = ["line_oa", "tiktok_live", "shopee", "facebook", "parcel_insert", "tiktok", "instagram"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABEL: Record<Channel, string> = {
  line_oa: "LINE OA",
  tiktok_live: "TikTok LIVE",
  shopee: "Shopee",
  facebook: "Facebook",
  parcel_insert: "การ์ดในพัสดุ",
  tiktok: "TikTok",
  instagram: "Instagram",
};

/** ตารางเดียวกับ content_piece_kind_channel_ok_ (0159 ~บรรทัด 654) — ใช้ซ่อนตัวเลือกที่ไม่เข้าคู่ ไม่ใช่ให้เลือกแล้วฟ้อง */
export const KIND_CHANNELS: Record<PieceKind, readonly Channel[]> = {
  short_clip: ["tiktok", "tiktok_live"],
  live_cut: ["tiktok", "tiktok_live"],
  ig_fb_post: ["facebook", "instagram"],
  line_message: ["line_oa"],
  story: ["instagram", "facebook"],
};

export const CUSTOMER_GROUPS = ["jewelry_925", "silver_bar"] as const;
export type CustomerGroup = (typeof CUSTOMER_GROUPS)[number];
export const CUSTOMER_GROUP_LABEL: Record<CustomerGroup, string> = {
  jewelry_925: "เครื่องประดับ 925",
  silver_bar: "เงินแท่ง",
};

export const TIME_SLOTS = ["morning", "afternoon", "before_live", "during_live"] as const;
export type TimeSlot = (typeof TIME_SLOTS)[number];
export const TIME_SLOT_LABEL: Record<TimeSlot, string> = {
  morning: "เช้า",
  afternoon: "บ่าย",
  before_live: "ก่อนไลฟ์",
  during_live: "ระหว่างไลฟ์",
};

export const FOOTAGE_STATUSES = ["needs_shoot", "has_footage", "shot"] as const;
export type FootageStatus = (typeof FOOTAGE_STATUSES)[number];
export const FOOTAGE_STATUS_LABEL: Record<FootageStatus, string> = {
  needs_shoot: "ต้องถ่าย",
  has_footage: "มีภาพแล้ว",
  shot: "ถ่ายแล้ว",
};

export const SHOOT_LOCATIONS = ["factory", "product_table", "host_cam", "other"] as const;
export type ShootLocation = (typeof SHOOT_LOCATIONS)[number];
export const SHOOT_LOCATION_LABEL: Record<ShootLocation, string> = {
  factory: "โรงงาน",
  product_table: "โต๊ะถ่ายสินค้า",
  host_cam: "กล้องโฮสต์",
  other: "อื่นๆ",
};

export const METRIC_CODES = ["save_rate", "share_rate", "peak_viewers", "line_reply_count", "none"] as const;
export type MetricCode = (typeof METRIC_CODES)[number];
export const METRIC_CODE_LABEL: Record<MetricCode, string> = {
  save_rate: "อัตราบันทึก",
  share_rate: "อัตราแชร์",
  peak_viewers: "คนดูสูงสุดคืนนั้น",
  line_reply_count: "จำนวนตอบกลับ LINE",
  none: "ไม่วัดผล (evergreen)",
};

/**
 * Preflight Q1a (9 ต.ค. 69): DB ยังไม่มีแถว save_rate/share_rate ที่ตั้งฐาน/เกณฑ์เลย → ไม่รู้ว่าเก็บเป็นเศษส่วน (0.0042) หรือเปอร์เซ็นต์ (0.42)
 * ค่าเริ่มต้นตามแผน §8.A: ไม่ใส่ "%" และปิดช่องกรอกฐาน/เกณฑ์ของสองตัวนี้ในฟอร์มแผน จนกว่าจะได้คำตอบ
 */
export const METRICS_UNIT_UNCONFIRMED: readonly MetricCode[] = ["save_rate", "share_rate"];

export const PASS_OP_LABEL: Record<string, string> = { ">=": "ไม่น้อยกว่า", "<=": "ไม่เกิน" };

export const HOOK_TYPES = [
  "question",
  "fact",
  "warning",
  "process",
  "before_after",
  "customer_voice",
  "direct_live",
  "story",
] as const;
export type HookType = (typeof HOOK_TYPES)[number];
export const HOOK_TYPE_LABEL: Record<HookType, string> = {
  question: "คำถาม",
  fact: "ข้อเท็จจริง",
  warning: "คำเตือน",
  process: "ขั้นตอน/เบื้องหลัง",
  before_after: "ก่อน–หลัง",
  customer_voice: "เสียงลูกค้า",
  direct_live: "พาเข้าไลฟ์",
  story: "เรื่องเล่า",
};

export const LINE_AUDIENCE_LABEL: Record<string, string> = { all: "ทุกคน", segment: "เฉพาะกลุ่ม" };

// ---------------------------------------------------------------------------
// ด่าน (gate) และผลตรวจ
// ---------------------------------------------------------------------------

export const GATE_KINDS = ["fact_check", "brand_rule", "risk_owner"] as const;
export type GateKind = (typeof GATE_KINDS)[number];
export const GATE_KIND_LABEL: Record<GateKind, string> = {
  fact_check: "ข้อเท็จจริง",
  brand_rule: "กฎแบรนด์",
  risk_owner: "ความเสี่ยง",
};

export const GATE_STATUSES = ["pending", "passed", "blocked", "na"] as const;
export type GateStatus = (typeof GATE_STATUSES)[number];
export const GATE_STATUS_LABEL: Record<GateStatus, string> = {
  pending: "รอตรวจ",
  passed: "ผ่าน",
  blocked: "ติด",
  na: "ไม่เกี่ยวข้อง",
};

/** ด่านที่ยังไม่มีแถวใน step_gate = ยังไม่เคยตรวจ → "รอตรวจ" */
export function gateStatusLabel(status: string | null | undefined): string {
  if (!status) return GATE_STATUS_LABEL.pending;
  return GATE_STATUS_LABEL[status as GateStatus] ?? "ไม่ทราบสถานะ";
}

// ---------------------------------------------------------------------------
// ข้อเสนอ AI / ผู้กระทำ / event
// ---------------------------------------------------------------------------

export const ACTOR_ROLE_LABEL: Record<string, string> = { owner: "คุณ", ai: "AI", system: "ระบบ" };

export function actorRoleLabel(role: string | null | undefined): string {
  if (!role) return "ระบบ";
  return ACTOR_ROLE_LABEL[role] ?? "ระบบ";
}

export const EVENT_KIND_LABEL: Record<string, string> = {
  create: "สร้างชิ้นงาน",
  advance: "เปลี่ยนสถานะ",
  revert: "ย้อนสถานะ",
  hold: "พักรอเงื่อนไข",
  resume: "กลับมาทำต่อ",
  defer: "เลื่อนวัน",
  cancel: "ยกเลิก",
  restore: "กู้คืน",
  post: "โพสต์",
  unpost: "ปลดโพสต์",
  gate: "ตรวจด่าน",
  confirm: "ตอบข้อที่ต้องยืนยัน",
  plan: "แก้แผน",
};

export function eventKindLabel(kind: string | null | undefined): string {
  if (!kind) return "เหตุการณ์";
  return EVENT_KIND_LABEL[kind] ?? "เหตุการณ์";
}

// ชื่อแพลตฟอร์มมาจาก PLATFORM_LABEL (content-types.ts) ชุดเดียว — ที่นี่เลือกเฉพาะช่องที่ "โพสต์ลิงก์" ได้ (ไม่รวม LINE OA)
export const PLATFORM_POST_LABEL: Record<string, string> = {
  tiktok: PLATFORM_LABEL.tiktok,
  facebook: PLATFORM_LABEL.facebook,
  instagram: PLATFORM_LABEL.instagram,
};

export const RECO_KIND_LABEL: Record<string, string> = { question: "คำถามจาก AI", proposal: "ข้อเสนอ" };
export const RECO_ACTION_LABEL: Record<string, string> = {
  pending: "รอตอบ",
  done: "ตกลง/ตอบแล้ว",
  rejected: "ปฏิเสธ",
  expired: "หมดเวลา",
};

// ---------------------------------------------------------------------------
// ปุ่มหลักตามสถานะ (§2.4 "ปุ่มหลักตามสถานะ") — ตัดสินแค่ "ปุ่มไหนเป็นตัวหลัก" ไม่ตัดสินสิทธิ์/ผ่านด่าน
// ---------------------------------------------------------------------------

export type PrimaryActionKey =
  | "plan"
  | "submit_review"
  | "approve"
  | "mark_produced"
  | "mark_posted"
  | "resume"
  | "restore"
  | "none";

export interface PrimaryActionInput {
  /** effective_piece_status จาก view */
  effective: string;
  pieceKind: string | null;
  footageStatus: string | null;
}

export interface PrimaryAction {
  key: PrimaryActionKey;
  label: string;
}

/**
 * ปุ่มหลัก 1 อันต่อสถานะ — ตารางใน §2.4. ไม่ตัดสินว่า "กดได้ไหม" (อนุมัติ = can_approve จาก DB ที่ผู้เรียกนำไป disable)
 * - approved: คลิป needs_shoot → "ถ่ายแล้ว" · อย่างอื่น → "โพสต์แล้ว"
 *   (ชิ้นที่ footage_status ยังเป็น null ของคลิป = ยังไม่ยืนยันว่ามีภาพ → DB จะปฏิเสธการข้าม produced
 *   จึงให้ปุ่มหลักเป็น "ถ่ายแล้ว" ก่อน ไม่ใช่ "โพสต์แล้ว" เพื่อไม่ชี้ทางที่ตันแน่ๆ)
 */
export function primaryActionFor(input: PrimaryActionInput): PrimaryAction {
  const isClip = input.pieceKind === "short_clip" || input.pieceKind === "live_cut";
  switch (input.effective) {
    case "idea":
      return { key: "plan", label: "วางแผน…" };
    case "drafting":
      return { key: "submit_review", label: "ส่งตรวจ" };
    case "in_review":
      return { key: "approve", label: "อนุมัติ" };
    case "approved":
      // ig_fb_post: DB ยอมข้าม produced ได้เมื่อ footage_status ไม่ใช่ needs_shoot (null = ยอม) · คลิป: ต้องมีภาพ (null ไม่ยอม)
      if (
        (isClip && (input.footageStatus === "needs_shoot" || input.footageStatus === null)) ||
        (input.pieceKind === "ig_fb_post" && input.footageStatus === "needs_shoot")
      ) {
        return { key: "mark_produced", label: "ถ่ายแล้ว" };
      }
      return { key: "mark_posted", label: "โพสต์แล้ว" };
    case "produced":
      return { key: "mark_posted", label: "โพสต์แล้ว" };
    case "on_hold":
      return { key: "resume", label: "กลับมาทำต่อ" };
    case "cancelled":
      return { key: "restore", label: "กู้คืน…" };
    // planned: รอ AI ร่าง · posted/measuring/measured/missed_measure: ดูผล
    default:
      return { key: "none", label: "" };
  }
}

/** สถานะที่ "ล็อกเนื้อหา/hook" (§2.4: แก้ได้เฉพาะ drafting/in_review) — ใช้ซ่อนโหมดแก้ */
export function isContentLocked(rawStatus: string | null | undefined): boolean {
  return rawStatus !== "drafting" && rawStatus !== "in_review";
}

/** ชนิดที่มีลิงก์โพสต์ภายนอก (ผ่าน content_piece_post) — LINE/สตอรี่ใช้ content_piece_advance('posted') */
export function pieceKindHasPostUrl(kind: string | null | undefined): boolean {
  return kind === "short_clip" || kind === "live_cut" || kind === "ig_fb_post";
}

// ---------------------------------------------------------------------------
// สัญญาณต้นทาง (content_signal.kind — 0158)
// ---------------------------------------------------------------------------

export const SIGNAL_KINDS = ["reference_clip", "trend", "live_question", "craft_moment", "insight"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];
export const SIGNAL_KIND_LABEL: Record<SignalKind, string> = {
  reference_clip: "คลิปอ้างอิง",
  trend: "เทรนด์",
  live_question: "คำถามจากไลฟ์",
  craft_moment: "ช่วงงานช่าง",
  insight: "ข้อสังเกต",
};

export function signalKindLabel(kind: string | null | undefined): string {
  if (!kind) return "สัญญาณ";
  return SIGNAL_KIND_LABEL[kind as SignalKind] ?? "สัญญาณ";
}

/**
 * ป้ายชื่อด่านบนหน้าเดิม (CampaignBoard/AgendaTaskCard): ด่านของ workflow ใหม่ (fact_check/brand_rule/risk_owner) ต้องไม่ขึ้นเป็นชื่อดิบ
 * ลำดับ: ป้ายเดิมของบอร์ด (legacy) → ป้ายของ workflow ใหม่ → "ด่านตรวจ" (ไม่รู้จัก ไม่โชว์ identifier)
 */
export function gateKindLabel(kind: string | null | undefined, legacy: Record<string, string> = {}): string {
  if (!kind) return "ด่านตรวจ";
  return legacy[kind] ?? GATE_KIND_LABEL[kind as GateKind] ?? "ด่านตรวจ";
}

/** ป้ายประเภท hook — ใช้ร่วมกันหลายหน้า ("ยังไม่ระบุประเภท" เมื่อ null หรือค่าดิบนอก 8 ประเภท) */
export function hookTypeLabel(type: string | null | undefined): string {
  if (!type) return "ยังไม่ระบุประเภท";
  return HOOK_TYPE_LABEL[type as HookType] ?? "ยังไม่ระบุประเภท";
}
