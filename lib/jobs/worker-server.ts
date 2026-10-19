// lib/jobs/worker-server.ts — ชั้นเรียก RPC ฝั่งช่าง (หน้า /w/<token> สาธารณะ) · server-only · ไม่ใช่ "use server" (เรียกจาก client โดยตรงไม่ได้)
// สัญญา (0172 §15): ส่ง "hash" ไม่ใช่ค่าดิบ · RPC ไม่ raise กรณีคาดได้ — คืน {ok:false, code, message}
// 🔴 ไม่มี requireOwnerAdmin/getSessionUser ที่นี่ โดยตั้งใจ: ช่องทางนี้พิสูจน์ตัวด้วย token (QR) + session ช่าง (PIN) ที่ DB ตรวจเอง
//    ห้าม import ไฟล์ที่เรียก RPC ออฟฟิศ (lib/actions/job-office.ts) เข้ามาในไฟล์นี้หรือใต้ app/(worker)/ — มีเทสต์ตรวจ module graph
// ห้าม log token/session/PIN/พารามิเตอร์ — ใช้ logJobFailure (code + hint เท่านั้น)

import "server-only";
import { cookies, headers } from "next/headers";
import { getServiceClient } from "@/lib/supabase/server";
import { clientIpFromHeaders, ipHashOrNull, sessionHashOrNull, tokenHashOrNull } from "@/lib/jobs/hash";
import { logJobFailure } from "@/lib/jobs/log";
import { GENERIC_JOB_ERROR, workerFailMessage } from "@/lib/jobs/messages";
import type { WorkerFailExtra } from "@/lib/jobs/messages";
import { sanitizeWorkerView } from "@/lib/jobs/worker-view";
import type { WorkerView } from "@/lib/jobs/worker-view";

export const WORKER_SESSION_COOKIE = "w_session";
export const WORKER_SESSION_MAX_AGE_S = 12 * 60 * 60;

export type WorkerFail = { ok: false; code: string; error: string; retryAfterSeconds?: number };
export type WorkerOk<T> = { ok: true; data: T };

const fail = (code: string, error?: string): WorkerFail => ({ ok: false, code, error: error ?? workerFailMessage(code, null) });

interface Caller {
  tokenHash: string | null;
  sessionHash: string | null;
  ipHash: string | null;
  userAgent: string | null;
}

async function readCaller(token: unknown): Promise<Caller> {
  const [c, h] = await Promise.all([cookies(), headers()]);
  return {
    tokenHash: tokenHashOrNull(token),
    sessionHash: sessionHashOrNull(c.get(WORKER_SESSION_COOKIE)?.value),
    ipHash: ipHashOrNull(clientIpFromHeaders((n) => h.get(n))),
    userAgent: (h.get("user-agent") ?? "").slice(0, 200) || null,
  };
}

const isFail = (r: Record<string, unknown> | WorkerFail): r is WorkerFail => r.ok === false && typeof (r as WorkerFail).error === "string";

const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const shortText = (v: unknown, max = 60): string | null => (typeof v === "string" && v !== "" ? v.slice(0, max) : null);

/** ตัวเลข/ชื่อที่ RPC แนบมากับ {ok:false} (0173) — กรองชนิดและตัดความยาวก่อนใช้ประกอบข้อความ */
function failExtra(r: Record<string, unknown>): WorkerFailExtra {
  return {
    attemptsLeft: finite(r.attempts_left),
    attemptsUntilOffice: finite(r.attempts_until_office),
    tokenBudgetLeft: finite(r.token_budget_left),
    retryAfterSeconds: finite(r.retry_after_seconds),
    by: shortText(r.by),
  };
}

/**
 * เรียก RPC ฝั่งช่าง · คืน data (ok:true) หรือ WorkerFail เสมอ — ทั้งกรณี {ok:false, code, message} ของ DB และ error ระบบ
 * error ระบบ → ข้อความกลาง (ไม่ log ข้อความดิบ) · ผลที่ไม่ใช่ object → ข้อความกลาง
 */
async function callWorkerRpc(fn: string, params: Record<string, unknown>): Promise<Record<string, unknown> | WorkerFail> {
  let data: unknown;
  try {
    const res = await getServiceClient().schema("analytics").rpc(fn, params);
    if (res.error) throw res.error;
    data = res.data;
  } catch (err) {
    logJobFailure(fn, err);
    return fail("error", GENERIC_JOB_ERROR);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return fail("error", GENERIC_JOB_ERROR);
  const r = data as Record<string, unknown>;
  if (r.ok === true) return r;
  const code = typeof r.code === "string" ? r.code : "error";
  const out: WorkerFail = { ok: false, code, error: workerFailMessage(code, r.message, failExtra(r)) };
  const retry = typeof r.retry_after_seconds === "number" ? r.retry_after_seconds : null;
  if (retry !== null && Number.isFinite(retry) && retry > 0) out.retryAfterSeconds = Math.min(Math.ceil(retry), 3600);
  return out;
}

/** อ่านข้อมูลหน้าช่าง (เรียกจาก server component ของหน้า /w/<token> เท่านั้น) */
export async function loadWorkerView(token: unknown): Promise<WorkerOk<WorkerView> | WorkerFail> {
  const c = await readCaller(token);
  if (!c.tokenHash) return fail("invalid_token");
  const r = await callWorkerRpc("job_worker_resolve", { p_token_hash: c.tokenHash, p_session_hash: c.sessionHash, p_ip_hash: c.ipHash });
  if (isFail(r)) return r;
  const view = sanitizeWorkerView(r);
  return view ? { ok: true, data: view } : fail("error", GENERIC_JOB_ERROR);
}

/** ระบุตัว: ชื่อ + PIN → session token (คืนค่าดิบให้ผู้เรียกตั้ง cookie ทันที — ไม่เก็บ ไม่ log) */
export async function verifyWorkerPin(token: unknown, workerId: string, pin: string): Promise<WorkerOk<{ sessionToken: string; maxAgeSeconds: number }> | WorkerFail> {
  const c = await readCaller(token);
  if (!c.tokenHash) return fail("invalid_token");
  const r = await callWorkerRpc("worker_pin_verify", { p_token_hash: c.tokenHash, p_worker_id: workerId, p_pin: pin, p_user_agent: c.userAgent, p_ip_hash: c.ipHash });
  if (isFail(r)) return r;
  const raw = r.session_token;
  if (typeof raw !== "string" || sessionHashOrNull(raw) === null) return fail("error", GENERIC_JOB_ERROR);
  const exp = typeof r.expires_at === "string" ? Date.parse(r.expires_at) : NaN;
  const left = Number.isFinite(exp) ? Math.floor((exp - Date.now()) / 1000) : WORKER_SESSION_MAX_AGE_S;
  return { ok: true, data: { sessionToken: raw, maxAgeSeconds: Math.max(60, Math.min(left, WORKER_SESSION_MAX_AGE_S)) } };
}

export interface ReceiveInput {
  expectedSeq: number;
  weightInG: number | null;
  /** 0181: ส่วนที่จะรับ (ว่าง = ใบของ token) · ต้องเป็น lotJobId จาก parts/my_actions ที่ DB ส่งมาเท่านั้น */
  lotJobId?: string | null;
  /** 0181: จำนวนที่ได้จริง (ว่าง = ตามที่ส่ง) — น้อยกว่าที่ส่ง = ส่วนต่างรอชี้แจงกลับไปขั้นก่อน */
  qtyReceived?: number | null;
}
export interface SendInput {
  expectedSeq: number;
  /** 0181: ส่วนที่ถืออยู่ (ว่าง = ใบของ token) */
  lotJobId?: string | null;
  /** 0181: ส่งต่อกี่ชิ้น (ว่าง = ส่งทั้งหมดที่ถือ) — น้อยกว่าที่ถือ = แยกส่วน (ส่งต่อ n จาก N) ต้องส่ง qtyHold ด้วย */
  qtySend?: number | null;
  /** 0181: จำนวนที่ถืออยู่ตามที่เห็นบนจอ (กดซ้ำ/2 มือถือ → DB ตอบ stage_changed) */
  qtyHold?: number | null;
  /** 0181 H2: น้ำหนักส่วนที่แยกออก (ทอง + ขั้นชั่ง) — ส่ง p_weight_move_g เฉพาะเมื่อระบุ */
  weightMoveG?: number | null;
  weightOutG: number | null;
  qtyScrap: number;
  scrapReason: string | null;
  metalAddedG: number;
  /** 0176: น้ำหนักเศษโลหะที่เก็บได้ (ขั้นที่แบบการบันทึกให้ถาม) · RPC รับ null ได้ */
  scrapWeightG?: number | null;
}

/** already=true: ขั้นนี้มีคนทำไปแล้ว (แพ้การแย่ง/กดซ้ำ) · by = ชื่อผู้รับ (เฉพาะรับงาน) — client เทียบกับชื่อตัวเองเพื่อแยก "ฉันเอง" ออกจาก "คนอื่นชนะ" */
export type StageResult = {
  already: boolean;
  message: string | null;
  by: string | null;
  /** 0181: ผลการแยกส่วน (ส่งต่อ n จาก N) — มีเมื่อ action = split */
  lot?: { lotJobId: string; lotSeq: number; label: string; qty: number; parentRemaining: number };
  /** 0181: ส่วนต่างที่เกิดตอนรับไม่ครบ (ชิ้น) — มีเมื่อรับน้อยกว่าที่ส่ง */
  discrepancyQty?: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: unknown): string | null => (typeof v === "string" && UUID_RE.test(v) ? v : null);
const intOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);

export async function workerReceive(token: unknown, i: ReceiveInput): Promise<WorkerOk<StageResult> | WorkerFail> {
  const c = await readCaller(token);
  if (!c.tokenHash) return fail("invalid_token");
  if (!c.sessionHash) return fail("session_required");
  const r = await callWorkerRpc("job_worker_receive", {
    p_token_hash: c.tokenHash, p_session_hash: c.sessionHash, p_expected_seq: i.expectedSeq, p_weight_in_g: i.weightInG, p_user_agent: c.userAgent, p_ip_hash: c.ipHash,
    // 0181: ส่งเฉพาะที่ระบุ — ใบเดี่ยว (ไม่มีส่วน) เรียก RPC ด้วย params ชุดเดิมเป๊ะ
    ...(i.lotJobId ? { p_lot_job_id: i.lotJobId } : {}), ...(i.qtyReceived != null ? { p_qty_received: i.qtyReceived } : {}),
  });
  if (isFail(r)) return r;
  const by = shortText(r.by);
  const data: StageResult = { already: r.already === true, by, message: r.already === true ? workerFailMessage("already_received", r.message, { by }) : null };
  const dq = intOrNull(r.discrepancy_qty);
  if (dq !== null && dq > 0) data.discrepancyQty = dq;
  return { ok: true, data };
}

export async function workerSend(token: unknown, i: SendInput): Promise<WorkerOk<StageResult> | WorkerFail> {
  const c = await readCaller(token);
  if (!c.tokenHash) return fail("invalid_token");
  if (!c.sessionHash) return fail("session_required");
  const r = await callWorkerRpc("job_worker_send", {
    p_token_hash: c.tokenHash, p_session_hash: c.sessionHash, p_expected_seq: i.expectedSeq, p_weight_out_g: i.weightOutG, p_qty_scrap: i.qtyScrap,
    p_scrap_reason: i.scrapReason, p_metal_added_g: i.metalAddedG, p_weight_note: i.metalAddedG > 0 ? "เติมโลหะ (ช่างแจ้งผ่าน QR)" : null,
    p_scrap_weight_g: i.scrapWeightG ?? null, p_user_agent: c.userAgent, p_ip_hash: c.ipHash,
    ...(i.lotJobId ? { p_lot_job_id: i.lotJobId } : {}), ...(i.qtySend != null ? { p_qty_send: i.qtySend } : {}), ...(i.qtyHold != null ? { p_qty_hold: i.qtyHold } : {}), ...(i.weightMoveG != null ? { p_weight_move_g: i.weightMoveG } : {}),
  });
  if (isFail(r)) return r;
  const data: StageResult = { already: r.already === true, by: null, message: r.already === true ? workerFailMessage("already_sent", r.message) : null };
  const lotId = uuidOrNull(r.lot_job_id);
  const lotSeq = intOrNull(r.lot_seq);
  const qty = intOrNull(r.qty);
  const remaining = intOrNull(r.parent_remaining);
  if (r.action === "split" && lotId && lotSeq !== null && qty !== null && remaining !== null) {
    data.lot = { lotJobId: lotId, lotSeq, label: shortText(r.label) ?? "", qty, parentRemaining: remaining };
  }
  return { ok: true, data };
}

export interface ResolveDiscrepancyInput {
  discrepancyId: string;
  kind: "scrap" | "lost";
  reason: string;
}

/** 0181 (มติ Q5): ผู้ส่งของขั้นนั้นชี้แจงส่วนต่างที่ผู้รับบันทึกไว้ — เสียหาย (scrap) หรือหาย (lost) + เหตุผล · ครั้งเดียว */
export async function workerResolveDiscrepancy(token: unknown, i: ResolveDiscrepancyInput): Promise<WorkerOk<{ qty: number | null }> | WorkerFail> {
  const c = await readCaller(token);
  if (!c.tokenHash) return fail("invalid_token");
  if (!c.sessionHash) return fail("session_required");
  const r = await callWorkerRpc("job_worker_discrepancy_resolve", {
    p_token_hash: c.tokenHash, p_session_hash: c.sessionHash, p_discrepancy_id: i.discrepancyId, p_kind: i.kind, p_reason: i.reason,
    p_user_agent: c.userAgent, p_ip_hash: c.ipHash,
  });
  if (isFail(r)) return r;
  return { ok: true, data: { qty: intOrNull(r.qty) } };
}

/** 0181 (ข3): ช่างยกเลิกส่วนที่ตัวเองแยกก่อนมีคนรับ — ชิ้นกลับขั้นแม่ที่ยังถืออยู่ · ส่วนอื่น/ที่รับแล้ว = ให้ออฟฟิศยกเลิก */
export async function workerCancelLot(token: unknown, lotJobId: string, reason: string | null): Promise<WorkerOk<{ qty: number | null }> | WorkerFail> {
  const c = await readCaller(token);
  if (!c.tokenHash) return fail("invalid_token");
  if (!c.sessionHash) return fail("session_required");
  const r = await callWorkerRpc("job_worker_lot_cancel", {
    p_token_hash: c.tokenHash, p_session_hash: c.sessionHash, p_lot_job_id: lotJobId, p_reason: reason,
    p_user_agent: c.userAgent, p_ip_hash: c.ipHash,
  });
  if (isFail(r)) return r;
  return { ok: true, data: { qty: intOrNull(r.qty) } };
}

/** ออกจากระบบ: เพิกถอน session ใน DB (ถ้ามี cookie) — ผู้เรียกลบ cookie เอง */
export async function revokeWorkerSession(): Promise<void> {
  const c = await readCaller(null);
  if (!c.sessionHash) return;
  await callWorkerRpc("job_worker_logout", { p_session_hash: c.sessionHash });
}
