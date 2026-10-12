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
}
export interface SendInput {
  expectedSeq: number;
  weightOutG: number | null;
  qtyScrap: number;
  scrapReason: string | null;
  metalAddedG: number;
  scrapWeightG?: number | null;
}

/** already=true: ขั้นนี้มีคนทำไปแล้ว (แพ้การแย่ง/กดซ้ำ) · by = ชื่อผู้รับ (เฉพาะรับงาน) — client เทียบกับชื่อตัวเองเพื่อแยก "ฉันเอง" ออกจาก "คนอื่นชนะ" */
export type StageResult = { already: boolean; message: string | null; by: string | null };

export async function workerReceive(token: unknown, i: ReceiveInput): Promise<WorkerOk<StageResult> | WorkerFail> {
  const c = await readCaller(token);
  if (!c.tokenHash) return fail("invalid_token");
  if (!c.sessionHash) return fail("session_required");
  const r = await callWorkerRpc("job_worker_receive", {
    p_token_hash: c.tokenHash, p_session_hash: c.sessionHash, p_expected_seq: i.expectedSeq, p_weight_in_g: i.weightInG, p_user_agent: c.userAgent, p_ip_hash: c.ipHash,
  });
  if (isFail(r)) return r;
  const by = shortText(r.by);
  return { ok: true, data: { already: r.already === true, by, message: r.already === true ? workerFailMessage("already_received", r.message, { by }) : null } };
}

export async function workerSend(token: unknown, i: SendInput): Promise<WorkerOk<StageResult> | WorkerFail> {
  const c = await readCaller(token);
  if (!c.tokenHash) return fail("invalid_token");
  if (!c.sessionHash) return fail("session_required");
  const r = await callWorkerRpc("job_worker_send", {
    p_token_hash: c.tokenHash, p_session_hash: c.sessionHash, p_expected_seq: i.expectedSeq, p_weight_out_g: i.weightOutG, p_qty_scrap: i.qtyScrap,
    p_scrap_reason: i.scrapReason, p_metal_added_g: i.metalAddedG, p_weight_note: i.metalAddedG > 0 ? "เติมโลหะ (ช่างแจ้งผ่าน QR)" : null,
    p_scrap_weight_g: i.scrapWeightG ?? null, p_user_agent: c.userAgent, p_ip_hash: c.ipHash,
  });
  if (isFail(r)) return r;
  return { ok: true, data: { already: r.already === true, by: null, message: r.already === true ? workerFailMessage("already_sent", r.message) : null } };
}

/** ออกจากระบบ: เพิกถอน session ใน DB (ถ้ามี cookie) — ผู้เรียกลบ cookie เอง */
export async function revokeWorkerSession(): Promise<void> {
  const c = await readCaller(null);
  if (!c.sessionHash) return;
  await callWorkerRpc("job_worker_logout", { p_session_hash: c.sessionHash });
}
