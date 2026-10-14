"use server";

// lib/actions/job-office-write.ts — เขียนใบงาน (ออฟฟิศ): พิมพ์ QR · กรอกแทน รับ/ส่ง · ข้าม/ย้อนขั้น · กำหนดส่ง · ปิดงาน · ยกเลิก
// guard() บรรทัดแรก · p_actor/p_shop_id ใส่ฝั่ง server หลัง spread (callOffice) · ตรวจชนิด/ช่วง input ก่อนถึง DB · DB ยังเป็นด่านจริง
// 🔴 token ดิบจาก job_token_issue ใช้สร้าง QR ฝั่ง server แล้วทิ้ง — คืนให้ client เฉพาะ SVG (token ไม่ถูกเก็บ/log/ส่งกลับเป็นข้อความ)

import { revalidatePath } from "next/cache";
import { effectiveDateBangkok } from "@/lib/tiktok/format";
import { isUuid, parseCount, parseDate, parseLabel, parseSeq, parseText, parseWeight, parseWeightOrZero, parseScrapReason } from "@/lib/jobs/input";
import { callOffice, fail, guard } from "@/lib/jobs/office-server";
import type { JobResult } from "@/lib/jobs/office-server";
import { currentAppOrigin } from "@/lib/jobs/origin-server";
import { renderQrSvg, workerUrl } from "@/lib/jobs/qr";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";

type Raw = Record<string, unknown>;
const done = (jobId: string) => {
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
};

// ---------------------------------------------------------------------------
// พิมพ์ใบงาน: ออก token ใหม่ (เพิกถอนใบเก่าเป็นค่าเริ่ม) → QR SVG
// ---------------------------------------------------------------------------
export interface IssuedQr {
  svg: string;
  printNo: number;
  jobNo: string;
  revokedPrevious: number;
}

export async function issueJobQr(jobId: string, keepPrevious: boolean): Promise<JobResult<IssuedQr>> {
  const g = await guard();
  if (g) return g;
  if (!isUuid(jobId)) return fail("ไม่พบใบงาน");
  // origin ใน QR: env APP_ORIGIN (production) ก่อน · ไม่ได้ตั้ง = host ที่ผ่านการตรวจรูปแบบ (lib/jobs/origin.ts) · ผิดรูปแบบ = ไม่ออก token (ไม่เรียก RPC)
  const origin = await currentAppOrigin();
  if (!origin.ok) return fail(origin.error);
  const r = await callOffice<Raw>("job_token_issue", { p_job_id: jobId, p_revoke_previous: keepPrevious !== true });
  if (!r.ok) return r;
  const token = r.data.token;
  const printNo = r.data.print_no;
  const jobNo = r.data.job_no;
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(token) || typeof printNo !== "number" || typeof jobNo !== "string") return fail(GENERIC_JOB_ERROR);
  let svg: string;
  try {
    svg = renderQrSvg(workerUrl(origin.origin, token));
  } catch {
    return fail("สร้าง QR ไม่สำเร็จ ลองใหม่อีกครั้ง");
  }
  done(jobId);
  return { ok: true, data: { svg, printNo, jobNo, revokedPrevious: typeof r.data.revoked_previous === "number" ? r.data.revoked_previous : 0 } };
}

export async function revokeJobQr(jobId: string, reason: string): Promise<JobResult<{ revoked: number }>> {
  const g = await guard();
  if (g) return g;
  if (!isUuid(jobId)) return fail("ไม่พบใบงาน");
  const why = parseText(reason, "เหตุผลที่เพิกถอน QR", 200, true);
  if (!why.ok) return fail(why.error);
  const r = await callOffice<Raw>("job_token_revoke", { p_job_id: jobId, p_reason: why.value });
  if (!r.ok) return r;
  done(jobId);
  return { ok: true, data: { revoked: typeof r.data.revoked === "number" ? r.data.revoked : 0 } };
}

// ---------------------------------------------------------------------------
// กรอกแทนจากกระดาษ — วันที่ย้อนได้ ≤ 14 วัน ไม่อนาคต (DB ตรวจซ้ำ)
// ---------------------------------------------------------------------------
function checkBackdate(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const d = parseDate(raw, "วันที่");
  if (!d.ok) return d;
  const today = effectiveDateBangkok(new Date().toISOString());
  if (d.value > today) return { ok: false, error: "วันที่ต้องไม่อยู่ในอนาคต" };
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d.value}T00:00:00Z`)) / 86_400_000);
  if (diff > 14) return { ok: false, error: "ย้อนหลังได้ไม่เกิน 14 วัน" };
  return d;
}

export interface OfficeReceiveInput {
  jobId: string;
  expectedSeq: number;
  occurredOn: string;
  weightIn: string | null;
  workerId: string | null;
  assigneeName: string | null;
}

export async function officeReceiveStage(i: OfficeReceiveInput): Promise<JobResult<null>> {
  const g = await guard();
  if (g) return g;
  if (typeof i !== "object" || i === null || !isUuid(i.jobId)) return fail("ไม่พบใบงาน");
  const seq = parseSeq(i.expectedSeq);
  if (!seq.ok) return fail(seq.error);
  const on = checkBackdate(i.occurredOn);
  if (!on.ok) return fail(on.error);
  const w = parseWeight(i.weightIn, "น้ำหนักเข้า");
  if (!w.ok) return fail(w.error);
  if (i.workerId !== null && i.workerId !== undefined && !isUuid(i.workerId)) return fail("เลือกช่างไม่ถูกต้อง");
  const name = parseLabel(i.assigneeName, "ชื่อผู้รับงาน", 60, false); // ชื่อนี้ไหลไปหน้าจอช่าง (holder_name) → ห้าม < > เหมือนชื่อช่าง
  if (!name.ok) return fail(name.error);
  if (!i.workerId && !name.value) return fail("ระบุผู้รับงาน (เลือกช่างหรือพิมพ์ชื่อ)");
  const r = await callOffice<Raw>("job_office_receive", { p_job_id: i.jobId, p_expected_seq: seq.value, p_occurred_on: on.value, p_weight_in_g: w.value, p_worker_id: i.workerId ?? null, p_assignee_name: name.value, p_channel: "job_page" });
  if (!r.ok) return r;
  done(i.jobId);
  return { ok: true, data: null };
}

export interface OfficeSendInput {
  jobId: string;
  expectedSeq: number;
  occurredOn: string;
  weightOut: string | null;
  qtyScrap: number;
  scrapReason: string | null;
  metalAdded: string | null;
  weightNote: string | null;
}

export async function officeSendStage(i: OfficeSendInput): Promise<JobResult<null>> {
  const g = await guard();
  if (g) return g;
  if (typeof i !== "object" || i === null || !isUuid(i.jobId)) return fail("ไม่พบใบงาน");
  const seq = parseSeq(i.expectedSeq);
  if (!seq.ok) return fail(seq.error);
  const on = checkBackdate(i.occurredOn);
  if (!on.ok) return fail(on.error);
  const w = parseWeight(i.weightOut, "น้ำหนักออก");
  if (!w.ok) return fail(w.error);
  const scrap = parseCount(i.qtyScrap, "จำนวนของเสีย", 100000);
  if (!scrap.ok) return fail(scrap.error);
  const reason = parseScrapReason(i.scrapReason, scrap.value);
  if (!reason.ok) return fail(reason.error);
  const added = parseWeightOrZero(i.metalAdded, "เติมโลหะ");
  if (!added.ok) return fail(added.error);
  const note = parseText(i.weightNote, "หมายเหตุน้ำหนัก", 200, added.value > 0);
  if (!note.ok) return fail(note.error);
  const r = await callOffice<Raw>("job_office_send", { p_job_id: i.jobId, p_expected_seq: seq.value, p_occurred_on: on.value, p_weight_out_g: w.value, p_qty_scrap: scrap.value, p_scrap_reason: reason.value, p_metal_added_g: added.value, p_weight_note: note.value, p_channel: "job_page" });
  if (!r.ok) return r;
  done(i.jobId);
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// ข้าม / ย้อน / กำหนดส่ง / เหตุผลเริ่มก่อนมัดจำ / ปิดงาน / ยกเลิก
// ---------------------------------------------------------------------------
export async function skipJobStage(jobId: string, stageCode: string, reason: string): Promise<JobResult<null>> {
  const g = await guard();
  if (g) return g;
  if (!isUuid(jobId) || typeof stageCode !== "string" || !/^[a-z][a-z0-9_]{1,30}$/.test(stageCode)) return fail("ข้อมูลไม่ถูกต้อง");
  const why = parseText(reason, "เหตุผลที่ข้ามขั้น", 200, true);
  if (!why.ok) return fail(why.error);
  const r = await callOffice("job_stage_skip", { p_job_id: jobId, p_stage_code: stageCode, p_reason: why.value });
  if (!r.ok) return r;
  done(jobId);
  return { ok: true, data: null };
}

export async function reopenJobStage(jobId: string, reason: string): Promise<JobResult<null>> {
  const g = await guard();
  if (g) return g;
  if (!isUuid(jobId)) return fail("ไม่พบใบงาน");
  const why = parseText(reason, "เหตุผลที่ย้อนขั้น", 200, true);
  if (!why.ok) return fail(why.error);
  const r = await callOffice("job_stage_reopen", { p_job_id: jobId, p_reason: why.value });
  if (!r.ok) return r;
  done(jobId);
  return { ok: true, data: null };
}

/** แก้ชื่อเรียกใบงาน (ช่างเห็นบนมือถือ + ใบพิมพ์) — เฉพาะใบที่ยังไม่ปิด · DB เก็บประวัติก่อน/หลังเป็น event */
export async function setJobDesignLabel(jobId: string, label: string): Promise<JobResult<null>> {
  const g = await guard();
  if (g) return g;
  if (!isUuid(jobId)) return fail("ไม่พบใบงาน");
  const t = parseLabel(label, "ชื่อเรียกใบงาน", 200, true);
  if (!t.ok) return fail(t.error);
  const r = await callOffice("job_design_label_set", { p_job_id: jobId, p_design_label: t.value });
  if (!r.ok) return r;
  done(jobId);
  return { ok: true, data: null };
}

export async function setJobDue(jobId: string, dueDate: string | null): Promise<JobResult<null>> {
  const g = await guard();
  if (g) return g;
  if (!isUuid(jobId)) return fail("ไม่พบใบงาน");
  let due: string | null = null;
  if (dueDate) {
    const d = parseDate(dueDate, "กำหนดส่ง");
    if (!d.ok) return fail(d.error);
    due = d.value;
  }
  const r = await callOffice("job_set_due", { p_job_id: jobId, p_due_date: due });
  if (!r.ok) return r;
  done(jobId);
  return { ok: true, data: null };
}

export async function setJobStartGateNote(jobId: string, note: string): Promise<JobResult<null>> {
  const g = await guard();
  if (g) return g;
  if (!isUuid(jobId)) return fail("ไม่พบใบงาน");
  const n = parseText(note, "เหตุผลที่เริ่มผลิตก่อนมัดจำ", 500, true);
  if (!n.ok) return fail(n.error);
  const r = await callOffice("job_start_gate_note_set", { p_job_id: jobId, p_note: n.value });
  if (!r.ok) return r;
  done(jobId);
  return { ok: true, data: null };
}

export interface DoneJobInput {
  jobId: string;
  qtyGood: number;
  qtyScrap: number;
  weightFinal: string | null;
  note: string | null;
}

export async function doneJob(i: DoneJobInput): Promise<JobResult<null>> {
  const g = await guard();
  if (g) return g;
  if (typeof i !== "object" || i === null || !isUuid(i.jobId)) return fail("ไม่พบใบงาน");
  const good = parseCount(i.qtyGood, "จำนวนดี");
  if (!good.ok) return fail(good.error);
  const scrap = parseCount(i.qtyScrap, "จำนวนเสีย");
  if (!scrap.ok) return fail(scrap.error);
  const w = parseWeight(i.weightFinal, "น้ำหนักสุทธิ");
  if (!w.ok) return fail(w.error);
  const note = parseText(i.note, "หมายเหตุ", 500, false);
  if (!note.ok) return fail(note.error);
  const r = await callOffice("job_done", { p_job_id: i.jobId, p_qty_good: good.value, p_qty_scrap: scrap.value, p_weight_final_g: w.value, p_note: note.value });
  if (!r.ok) return r;
  done(i.jobId);
  return { ok: true, data: null };
}

export async function cancelJob(jobId: string, reason: string): Promise<JobResult<null>> {
  const g = await guard();
  if (g) return g;
  if (!isUuid(jobId)) return fail("ไม่พบใบงาน");
  const why = parseText(reason, "เหตุผลที่ยกเลิก", 300, true);
  if (!why.ok) return fail(why.error);
  const r = await callOffice("job_cancel", { p_job_id: jobId, p_reason: why.value });
  if (!r.ok) return r;
  done(jobId);
  return { ok: true, data: null };
}
