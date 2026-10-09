// lib/marketing/piece-input.ts — allowlist + pre-check ของอินพุตที่ server action รับจาก client (§5.4)
//
// หลักการ: ที่นี่ตรวจ "รูปร่าง" เพื่อให้ข้อความผิดเป็นไทยที่แก้ได้ทันที (ไม่ใช่ข้อความ dev ของ 22023) —
// ส่วนตัดสินจริง (ผ่านด่านไหม · อนุมัติได้ไหม · ชิ้นนี้ทำได้ไหม) เป็นของ DB เสมอ ที่นี่ไม่ซ้ำกฎนั้น
//
// Pure module — ไม่มี "use server"/"server-only"

import {
  CHANNELS,
  CUSTOMER_GROUPS,
  FOOTAGE_STATUSES,
  HOOK_TYPES,
  METRIC_CODES,
  PIECE_KINDS,
  SHOOT_LOCATIONS,
  TIME_SLOTS,
} from "@/lib/marketing/piece-labels";

export type InputResult<T> = { ok: true; value: T } | { ok: false; error: string };

const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/g;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** uuid (ตัวเดียวของสาย content — piece-server re-export) */
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** อ็อบเจ็กต์ธรรมดา (ไม่ใช่ null/array) — server action รับ object จาก client ต้องเช็คก่อนเข้าถึง field (กัน TypeError → 500) */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** ตัดอักขระล่องหน + trim — ใช้นับความยาวก่อนส่ง (DB ทำซ้ำด้วย content_text_clean) */
export function cleanText(input: unknown): string {
  return typeof input === "string" ? input.replace(INVISIBLE, "").trim() : "";
}

// ---------------------------------------------------------------------------
// การเปลี่ยนสถานะ
// ---------------------------------------------------------------------------

/** ค่า p_to ที่หน้าจอส่งได้ (ตรงกับ allowlist ของ content_piece_advance — ภาคผนวก A) */
export const ADVANCE_TARGETS = [
  "idea",
  "planned",
  "drafting",
  "in_review",
  "approved",
  "produced",
  "posted",
  "cancelled",
  "hold",
  "resume",
  "restore",
] as const;
export type AdvanceTarget = (typeof ADVANCE_TARGETS)[number];

export function isAdvanceTarget(v: unknown): v is AdvanceTarget {
  return typeof v === "string" && (ADVANCE_TARGETS as readonly string[]).includes(v);
}

export const REASON_MIN = 3;
export const REASON_MAX = 500;

/** การเปลี่ยนที่ "ต้องมีเหตุผลเสมอ" โดยไม่ขึ้นกับสถานะต้นทาง (hold · ยกเลิก · กู้คืน) — ที่เหลือ (ย้อนสถานะ) DB ตัดสินจาก from */
export function reasonAlwaysRequired(to: AdvanceTarget): boolean {
  return to === "hold" || to === "cancelled" || to === "restore";
}

export function checkReason(raw: unknown, required: boolean): InputResult<string | null> {
  const text = cleanText(raw);
  if (!text) {
    return required ? { ok: false, error: `ใส่เหตุผลอย่างน้อย ${REASON_MIN} ตัวอักษร` } : { ok: true, value: null };
  }
  if (text.length < REASON_MIN) return { ok: false, error: `ใส่เหตุผลอย่างน้อย ${REASON_MIN} ตัวอักษร` };
  if (text.length > REASON_MAX) return { ok: false, error: `เหตุผลยาวเกิน ${REASON_MAX} ตัวอักษร` };
  return { ok: true, value: text };
}

/** วินาทีที่อ่านก่อนอนุมัติ: จำนวนเต็ม 0–86400 (ตรง p_review_seconds) — นอกช่วง/ไม่ใช่เลข = ไม่ส่ง (ไม่ปฏิเสธการอนุมัติ) */
export function normalizeReviewSeconds(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const n = Math.floor(raw);
  return n >= 0 && n <= 86_400 ? n : null;
}

// ---------------------------------------------------------------------------
// ด่านตรวจ
// ---------------------------------------------------------------------------

const GATE_KIND_SET = new Set(["fact_check", "brand_rule", "risk_owner"]);
const GATE_STATUS_SET = new Set(["pending", "passed", "blocked", "na"]);
export const MAX_SOURCES = 30;
export const MAX_LIST_ITEM = 300;
export const NOTE_MAX = 500;
export const ANSWER_MAX = 1000;

export function isGateKind(v: unknown): v is "fact_check" | "brand_rule" | "risk_owner" {
  return typeof v === "string" && GATE_KIND_SET.has(v);
}
export function isGateStatus(v: unknown): v is "pending" | "passed" | "blocked" | "na" {
  return typeof v === "string" && GATE_STATUS_SET.has(v);
}

/** ลิงก์แหล่งอ้างอิง: http/https เท่านั้น · ไม่มีช่องว่าง · ≤ 500 (ตรง content_url_ok ของ DB แบบหลวม — DB ตัดสินจริง) */
export function checkSourceUrl(raw: string): InputResult<string> {
  const t = raw.trim();
  if (!t) return { ok: false, error: "วางลิงก์แหล่งอ้างอิงก่อน" };
  if (t.length > 500) return { ok: false, error: "ลิงก์ยาวเกินไป" };
  if (/\s/.test(t) || !/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(t)) {
    return { ok: false, error: "ลิงก์ไม่ถูกต้อง (ต้องขึ้นต้นด้วย http:// หรือ https://)" };
  }
  try {
    new URL(t);
  } catch {
    return { ok: false, error: "ลิงก์ไม่ถูกต้อง (ต้องขึ้นต้นด้วย http:// หรือ https://)" };
  }
  return { ok: true, value: t };
}

function cleanList(raw: unknown, label: string): InputResult<string[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: `${label} ต้องเป็นรายการ` };
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") return { ok: false, error: `${label} ต้องเป็นข้อความ` };
    const t = cleanText(item);
    if (!t) continue;
    if (t.length > MAX_LIST_ITEM) return { ok: false, error: `${label} ยาวเกิน ${MAX_LIST_ITEM} ตัวอักษร` };
    out.push(t);
  }
  if (out.length > MAX_SOURCES) return { ok: false, error: `${label} มากเกินไป` };
  return { ok: true, value: out };
}

export interface GateInput {
  gateKind: "fact_check" | "brand_rule" | "risk_owner";
  status: "pending" | "passed" | "blocked" | "na";
  /** fact_check — ส่งทั้งชุด (RPC เขียนทับ) */
  sources?: string[];
  flagged?: string[];
  /** brand_rule — ส่งทั้งชุด */
  rulesHit?: string[];
  /** risk_owner — คำตอบของเจ้าของ (ไม่บังคับ) */
  answer?: string;
  note?: string | null;
}

export interface GatePayload {
  detail: Record<string, unknown> | null;
  note: string | null;
}

/**
 * ประกอบ p_detail ตามชนิดด่าน (key ตรง content_gate_record) — risk_owner: คำถามเดิมให้ผู้เรียกส่งมาจาก DB (existingQuestion) ไม่ใช่จาก client
 * ผ่าน fact_check โดยไม่มีแหล่ง ≥ 1: ปฏิเสธตรงนี้ด้วยข้อความเดียวกับ DB (pre-check · DB ยังเป็นผู้ตัดสิน)
 */
export function buildGatePayload(input: GateInput, existingQuestion: string | null): InputResult<GatePayload> {
  if (!isRecord(input)) return { ok: false, error: "ข้อมูลผลตรวจไม่ถูกต้อง" };
  if (input.sources !== undefined && input.sources !== null && !Array.isArray(input.sources)) return { ok: false, error: "แหล่งอ้างอิงต้องเป็นรายการ" };
  if (input.note !== undefined && input.note !== null && typeof input.note !== "string") return { ok: false, error: "หมายเหตุต้องเป็นข้อความ" };
  if (input.answer !== undefined && input.answer !== null && typeof input.answer !== "string") return { ok: false, error: "คำตอบต้องเป็นข้อความ" };
  const note = input.note === undefined || input.note === null ? null : cleanText(input.note);
  if (note && note.length > NOTE_MAX) return { ok: false, error: `หมายเหตุยาวเกิน ${NOTE_MAX} ตัวอักษร` };

  if (input.gateKind === "fact_check") {
    const rawSources = input.sources ?? [];
    const sources: string[] = [];
    for (const s of rawSources) {
      const c = checkSourceUrl(String(s));
      if (!c.ok) return c;
      if (!sources.includes(c.value)) sources.push(c.value);
    }
    if (sources.length > MAX_SOURCES) return { ok: false, error: "แหล่งอ้างอิงมากเกินไป" };
    const flagged = cleanList(input.flagged, "รายการที่ติด");
    if (!flagged.ok) return flagged;
    if (input.status === "passed" && sources.length === 0) {
      return { ok: false, error: "ผ่านได้ต้องมีลิงก์แหล่งอ้างอิงอย่างน้อย 1 ลิงก์" };
    }
    return { ok: true, value: { detail: { sources, flagged: flagged.value }, note: note || null } };
  }

  if (input.gateKind === "brand_rule") {
    const rules = cleanList(input.rulesHit, "กฎที่ชน");
    if (!rules.ok) return rules;
    return { ok: true, value: { detail: { rules_hit: rules.value }, note: note || null } };
  }

  // risk_owner
  const answer = cleanText(input.answer);
  if (answer.length > ANSWER_MAX) return { ok: false, error: `คำตอบยาวเกิน ${ANSWER_MAX} ตัวอักษร` };
  if (/\[\s*ต้อง\s*ยืนยัน/.test(answer)) return { ok: false, error: "คำตอบต้องไม่มี [ต้องยืนยัน…] ค้างอยู่" };
  const detail: Record<string, unknown> = {};
  if (existingQuestion) detail.question = existingQuestion;
  if (answer) detail.answer = answer;
  return { ok: true, value: { detail: Object.keys(detail).length > 0 ? detail : null, note: note || null } };
}

// ---------------------------------------------------------------------------
// ตอบ [ต้องยืนยัน] / ตอบข้อเสนอ AI
// ---------------------------------------------------------------------------

export function checkConfirmAnswer(raw: unknown): InputResult<string> {
  const t = cleanText(raw);
  if (!t) return { ok: false, error: "พิมพ์คำตอบก่อนบันทึก" };
  if (t.length > ANSWER_MAX) return { ok: false, error: `คำตอบยาวเกิน ${ANSWER_MAX} ตัวอักษร` };
  if (/\[\s*ต้อง\s*ยืนยัน/.test(t)) return { ok: false, error: "คำตอบต้องไม่มี [ต้องยืนยัน…] ค้างอยู่" };
  return { ok: true, value: t };
}

export type RecoAction = "done" | "rejected";

/** ตอบข้อเสนอ: rejected ต้องมีเหตุผล 3–1000 · done ไม่บังคับ · ทั้งคู่ ≤ 1000 · ห้ามมี [ต้องยืนยัน */
export function checkRecoResponse(action: unknown, raw: unknown): InputResult<{ action: RecoAction; response: string | null }> {
  if (action !== "done" && action !== "rejected") return { ok: false, error: "เลือกการตอบให้ถูกต้อง" };
  const t = cleanText(raw);
  if (t.length > ANSWER_MAX) return { ok: false, error: `ข้อความยาวเกิน ${ANSWER_MAX} ตัวอักษร` };
  if (/\[\s*ต้อง\s*ยืนยัน/.test(t)) return { ok: false, error: "คำตอบต้องไม่มี [ต้องยืนยัน…] ค้างอยู่" };
  if (action === "rejected" && t.length < REASON_MIN) return { ok: false, error: `ใส่เหตุผลอย่างน้อย ${REASON_MIN} ตัวอักษร` };
  return { ok: true, value: { action, response: t || null } };
}

// ---------------------------------------------------------------------------
// แก้แผน (content_piece_set_plan)
// ---------------------------------------------------------------------------

type PlanKind = "date" | "time" | "enum" | "text" | "number" | "uuid";

const PLAN_SPEC: Record<string, { kind: PlanKind; values?: readonly string[]; clearable: boolean; max?: number }> = {
  date: { kind: "date", clearable: false },
  start_time: { kind: "time", clearable: true },
  time_slot: { kind: "enum", values: TIME_SLOTS, clearable: true },
  piece_kind: { kind: "enum", values: PIECE_KINDS, clearable: true },
  channel: { kind: "enum", values: CHANNELS, clearable: true },
  customer_group: { kind: "enum", values: CUSTOMER_GROUPS, clearable: true },
  hypothesis: { kind: "text", clearable: true, max: 1000 },
  metric_code: { kind: "enum", values: METRIC_CODES, clearable: true },
  baseline_value: { kind: "number", clearable: true },
  baseline_as_of: { kind: "date", clearable: true },
  baseline_note: { kind: "text", clearable: true, max: 500 },
  pass_threshold: { kind: "number", clearable: true },
  pass_op: { kind: "enum", values: [">=", "<="], clearable: true },
  baseline_spread: { kind: "number", clearable: true },
  expected_host_id: { kind: "uuid", clearable: true },
  line_audience: { kind: "enum", values: ["all", "segment"], clearable: true },
  line_audience_reason: { kind: "text", clearable: true, max: 500 },
  footage_status: { kind: "enum", values: FOOTAGE_STATUSES, clearable: true },
  footage_url: { kind: "text", clearable: true, max: 500 },
  shoot_note: { kind: "text", clearable: true, max: 500 },
  shoot_location: { kind: "enum", values: SHOOT_LOCATIONS, clearable: true },
  shoot_minutes_est: { kind: "number", clearable: true },
  shoot_date: { kind: "date", clearable: true },
  content_type_code: { kind: "text", clearable: true, max: 60 },
};

export const PLAN_KEYS: readonly string[] = Object.keys(PLAN_SPEC);



function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/**
 * ตรวจ p_set ก่อนส่ง: key ต้องอยู่ใน allowlist · ชนิดค่าถูก · enum อยู่ในรายการ ·
 * null = ล้างค่า (ส่งชัดๆ) · ตัวเลข 0 เป็นค่าจริง (ไม่ใช้ truthiness) · NaN/Infinity ปฏิเสธ
 * ส่งเฉพาะ key ที่เปลี่ยนเท่านั้น — ผู้เรียกต้อง diff มาก่อน
 */
export function sanitizePlanSet(raw: unknown): InputResult<Record<string, string | number | null>> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "ไม่มีค่าที่เปลี่ยน" };
  const out: Record<string, string | number | null> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const spec = PLAN_SPEC[key];
    if (!spec) return { ok: false, error: "มีช่องที่แก้ไม่ได้ในฟอร์มนี้" };
    if (value === null) {
      if (!spec.clearable) return { ok: false, error: "ช่องวันที่ล้างค่าไม่ได้" };
      out[key] = null;
      continue;
    }
    if (spec.kind === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, error: "ตัวเลขไม่ถูกต้อง" };
      if (key === "shoot_minutes_est" && (!Number.isInteger(value) || value < 0 || value > 1440)) {
        return { ok: false, error: "เวลาประเมินถ่ายทำต้องเป็นจำนวนนาที (จำนวนเต็ม)" };
      }
      if (key === "baseline_spread" && value < 0) return { ok: false, error: "ช่วงแกว่งต้องไม่ติดลบ" };
      out[key] = value;
      continue;
    }
    if (typeof value !== "string") return { ok: false, error: "ค่าที่กรอกไม่ถูกต้อง" };
    if (spec.kind === "date") {
      if (!isRealDate(value)) return { ok: false, error: "วันที่ไม่ถูกต้อง" };
      out[key] = value;
    } else if (spec.kind === "time") {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return { ok: false, error: "เวลาต้องเป็นรูปแบบ ชม:นาที" };
      out[key] = value;
    } else if (spec.kind === "enum") {
      if (!spec.values?.includes(value)) return { ok: false, error: "ตัวเลือกที่เลือกไม่ถูกต้อง" };
      out[key] = value;
    } else if (spec.kind === "uuid") {
      if (!isUuid(value)) return { ok: false, error: "ตัวเลือกที่เลือกไม่ถูกต้อง" };
      out[key] = value;
    } else {
      const t = cleanText(value);
      if (!t) return { ok: false, error: "ช่องข้อความว่างเปล่า — ถ้าจะล้างค่าให้กด 'ล้าง'" };
      if (spec.max && t.length > spec.max) return { ok: false, error: `ข้อความยาวเกิน ${spec.max} ตัวอักษร` };
      out[key] = t;
    }
  }
  if (Object.keys(out).length === 0) return { ok: false, error: "ไม่มีค่าที่เปลี่ยน" };
  return { ok: true, value: out };
}

// ---------------------------------------------------------------------------
// hook
// ---------------------------------------------------------------------------

export interface HookInput {
  id?: string | null;
  label: "A" | "B";
  text: string;
  hookType: string;
}

export function checkHookInput(raw: HookInput): InputResult<HookInput> {
  if (!isRecord(raw)) return { ok: false, error: "ข้อมูล hook ไม่ถูกต้อง" };
  if (typeof raw.text !== "string") return { ok: false, error: "พิมพ์ข้อความ hook ก่อนบันทึก" };
  if (typeof raw.hookType !== "string") return { ok: false, error: "เลือกประเภท hook" };
  if (raw.label !== "A" && raw.label !== "B") return { ok: false, error: "เลือก hook A หรือ B" };
  const text = cleanText(raw.text);
  if (!text) return { ok: false, error: "พิมพ์ข้อความ hook ก่อนบันทึก" };
  if (text.length > 500) return { ok: false, error: "ข้อความ hook ยาวเกิน 500 ตัวอักษร" };
  if (!(HOOK_TYPES as readonly string[]).includes(raw.hookType)) return { ok: false, error: "เลือกประเภท hook" };
  if (raw.id != null && !isUuid(raw.id)) return { ok: false, error: "ไม่พบ hook ที่จะแก้" };
  return { ok: true, value: { id: raw.id ?? null, label: raw.label, text, hookType: raw.hookType } };
}
