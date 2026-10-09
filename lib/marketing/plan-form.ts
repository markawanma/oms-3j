// lib/marketing/plan-form.ts — ฟอร์ม "แก้แผน" (PlanForm): ค่าฟอร์ม ↔ p_set ของ content_piece_set_plan
// (content-ui-build-plan.md §2.6 ง)
//
// หลักการ:
//  - ส่งเฉพาะ key ที่เปลี่ยน (p_set) · ล้างค่า = ส่ง null ชัดๆ · ตัวเลข 0 เป็นค่าจริง (ห้ามใช้ truthiness — trap #13)
//  - ช่องที่แก้ไม่ได้ในสถานะนี้ (ตาม DB: approved/produced เหลือเฉพาะชุดถ่ายทำ/เวลา/โฮสต์ · posted/cancelled เหลือ footage_url + shoot_note)
//    ไม่แสดงเป็น input และไม่ถูกส่ง
//  - ไม่ตัดสินแทน DB (ครบเกณฑ์วางแผนไหม ฯลฯ) — แค่แปลงค่าให้ถูกรูปร่างก่อนส่ง

import { KIND_CHANNELS, METRICS_UNIT_UNCONFIRMED } from "@/lib/marketing/piece-labels";
import type { PieceKind } from "@/lib/marketing/piece-labels";
import type { PieceRow } from "@/lib/marketing/piece-types";

export interface PlanFormValues {
  pieceKind: string;
  channel: string;
  customerGroup: string;
  date: string;
  startTime: string;
  timeSlot: string;
  contentTypeCode: string;
  metricCode: string;
  hypothesis: string;
  baselineValue: string;
  baselineAsOf: string;
  baselineNote: string;
  passOp: string;
  passThreshold: string;
  baselineSpread: string;
  footageStatus: string;
  shootLocation: string;
  shootMinutesEst: string;
  shootDate: string;
  footageUrl: string;
  shootNote: string;
  expectedHostId: string;
  lineAudience: string;
  lineAudienceReason: string;
}

type Field = keyof PlanFormValues;

interface FieldSpec {
  key: string; // key ของ set_plan
  type: "text" | "number";
}

const FIELDS: Record<Field, FieldSpec> = {
  pieceKind: { key: "piece_kind", type: "text" },
  channel: { key: "channel", type: "text" },
  customerGroup: { key: "customer_group", type: "text" },
  date: { key: "date", type: "text" },
  startTime: { key: "start_time", type: "text" },
  timeSlot: { key: "time_slot", type: "text" },
  contentTypeCode: { key: "content_type_code", type: "text" },
  metricCode: { key: "metric_code", type: "text" },
  hypothesis: { key: "hypothesis", type: "text" },
  baselineValue: { key: "baseline_value", type: "number" },
  baselineAsOf: { key: "baseline_as_of", type: "text" },
  baselineNote: { key: "baseline_note", type: "text" },
  passOp: { key: "pass_op", type: "text" },
  passThreshold: { key: "pass_threshold", type: "number" },
  baselineSpread: { key: "baseline_spread", type: "number" },
  footageStatus: { key: "footage_status", type: "text" },
  shootLocation: { key: "shoot_location", type: "text" },
  shootMinutesEst: { key: "shoot_minutes_est", type: "number" },
  shootDate: { key: "shoot_date", type: "text" },
  footageUrl: { key: "footage_url", type: "text" },
  shootNote: { key: "shoot_note", type: "text" },
  expectedHostId: { key: "expected_host_id", type: "text" },
  lineAudience: { key: "line_audience", type: "text" },
  lineAudienceReason: { key: "line_audience_reason", type: "text" },
};

const ALL_KEYS = Object.values(FIELDS).map((f) => f.key);
const APPROVED_KEYS = ["time_slot", "start_time", "expected_host_id", "footage_status", "footage_url", "shoot_note", "shoot_location", "shoot_minutes_est", "shoot_date"];
const CLOSED_KEYS = ["footage_url", "shoot_note"];

/** ช่องที่แก้ได้ตามสถานะดิบ (ตรง c_keys / c_appr_keys / c_closed_keys ของ content_piece_set_plan) */
export function editablePlanKeys(rawStatus: string): Set<string> {
  if (rawStatus === "idea" || rawStatus === "planned") return new Set(ALL_KEYS);
  if (rawStatus === "drafting" || rawStatus === "in_review") return new Set(ALL_KEYS.filter((k) => k !== "date")); // เลื่อนวันหลังวางแผน = content_piece_defer
  if (rawStatus === "approved" || rawStatus === "produced") return new Set(APPROVED_KEYS);
  return new Set(CLOSED_KEYS);
}

function numToStr(n: number | null): string {
  return n === null ? "" : String(n);
}

export function valuesFromPiece(p: PieceRow): PlanFormValues {
  return {
    pieceKind: p.pieceKind ?? "",
    channel: p.channel ?? "",
    customerGroup: p.customerGroup ?? "",
    date: p.resolvedStart ?? "",
    startTime: p.startTime ?? "",
    timeSlot: p.timeSlot ?? "",
    contentTypeCode: p.contentTypeCode ?? "",
    metricCode: p.metricCode ?? "",
    hypothesis: p.hypothesis ?? "",
    baselineValue: numToStr(p.baselineValue),
    baselineAsOf: p.baselineAsOf ?? "",
    baselineNote: "",
    passOp: p.passOp ?? "",
    passThreshold: numToStr(p.passThreshold),
    baselineSpread: numToStr(p.baselineSpread),
    footageStatus: p.footageStatus ?? "",
    shootLocation: p.shootLocation ?? "",
    shootMinutesEst: numToStr(p.shootMinutesEst),
    shootDate: p.shootDate ?? "",
    footageUrl: p.footageUrl ?? "",
    shootNote: p.shootNote ?? "",
    expectedHostId: p.expectedHostId ?? "",
    lineAudience: p.lineAudience ?? "",
    lineAudienceReason: p.lineAudienceReason ?? "",
  };
}

/** แปลงข้อความตัวเลขจากช่องกรอก: "" → undefined (ว่าง) · ไม่ใช่เลขจำกัดค่า → null (ไม่ถูกต้อง) · "0" → 0 */
export function parseDecimal(raw: string): number | null | undefined {
  const t = raw.trim();
  if (t === "") return undefined;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export type PlanDiff = { ok: true; set: Record<string, string | number | null> } | { ok: false; error: string; field: Field };

/**
 * เทียบค่าฟอร์มกับค่าเดิม → p_set เฉพาะ key ที่เปลี่ยน
 * - ว่างจากเดิมมีค่า = null (ล้าง) · ว่างทั้งคู่ = ไม่ส่ง
 * - ตัวเลขที่พิมพ์ผิดรูป → error ที่ช่องนั้น (ไม่ปล่อยให้ DB ตอบ 22023)
 * - baselineNote: DB ไม่ส่งค่ากลับใน view → ส่งเมื่อผู้ใช้พิมพ์เท่านั้น (ไม่ล้างจากฟอร์ม)
 */
export function diffPlanValues(orig: PlanFormValues, draft: PlanFormValues, editable: ReadonlySet<string>): PlanDiff {
  const set: Record<string, string | number | null> = {};
  for (const field of Object.keys(FIELDS) as Field[]) {
    const spec = FIELDS[field];
    if (!editable.has(spec.key)) continue;
    const before = orig[field];
    const after = draft[field];
    if (before === after) continue;

    if (field === "baselineNote") {
      if (after.trim() !== "") set[spec.key] = after.trim();
      continue;
    }

    if (spec.type === "number") {
      const nb = parseDecimal(before);
      const na = parseDecimal(after);
      if (na === null) return { ok: false, error: "ตัวเลขไม่ถูกต้อง (พิมพ์ตัวเลข เช่น 12 หรือ 0.5)", field };
      if (nb === na) continue;
      set[spec.key] = na === undefined ? null : na;
      continue;
    }

    const trimmed = after.trim();
    if (trimmed === before.trim()) continue;
    set[spec.key] = trimmed === "" ? null : trimmed;
  }
  return { ok: true, set };
}

/** ช่องทางที่เลือกได้ของชนิดนี้ — ซ่อนตัวเลือกที่ไม่เข้าคู่ (ไม่ใช่ให้เลือกแล้วฟ้อง) */
export function channelsForKind(kind: string): readonly string[] {
  return (KIND_CHANNELS as Record<string, readonly string[]>)[kind as PieceKind] ?? [];
}

/** metric ที่ฟอร์มยังเลือกใหม่ไม่ได้ (Q1a: ยังไม่รู้หน่วยฐาน/เกณฑ์ของ rate) */
export function isMetricSelectable(code: string, current: string): boolean {
  return !METRICS_UNIT_UNCONFIRMED.includes(code as never) || code === current;
}

/** ตัวชี้วัดที่ต้องกรอกสมมติฐาน/ฐาน/เกณฑ์ (ทุกตัวยกเว้น none/ยังไม่เลือก) */
export function metricNeedsHypothesis(code: string): boolean {
  return code !== "" && code !== "none";
}
