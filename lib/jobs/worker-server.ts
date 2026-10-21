// lib/jobs/worker-server.ts — ชั้นเรียก RPC ฝั่งช่าง (หน้า /w/<token> สาธารณะ) · server-only · ไม่ใช่ "use server" (เรียกจาก client โดยตรงไม่ได้)
// สัญญา (0172 §15): ส่ง "hash" ไม่ใช่ค่าดิบ · RPC ไม่ raise กรณีคาดได้ — คืน {ok:false, code, message}
// 🔴 ไม่มี requireOwnerAdmin/getSessionUser ที่นี่ โดยตั้งใจ: ช่องทางนี้พิสูจน์ตัวด้วย token (QR) + session ช่าง (PIN) ที่ DB ตรวจเอง
//    ห้าม import ไฟล์ที่เรียก RPC ออฟฟิศ (lib/actions/job-office.ts) เข้ามาในไฟล์นี้หรือใต้ app/(worker)/ — มีเทสต์ตรวจ module graph
// ห้าม log token/session/PIN/พารามิเตอร์ — ใช้ logJobFailure (code + hint เท่านั้น)

import "server-only";
import { cookies, headers } from "next/headers";
import { getServiceClient } from "@/lib/supabase/server";
import { signImagePaths, signJobPhotoPaths } from "@/lib/images/signing";
import { JOB_PHOTO_PATH_RE } from "@/lib/jobs/photos";
import { clientIpFromHeaders, ipHashOrNull, sessionHashOrNull, tokenHashOrNull } from "@/lib/jobs/hash";
import { logJobFailure } from "@/lib/jobs/log";
import { isUuid } from "@/lib/jobs/input";
import { GENERIC_JOB_ERROR, WORKER_ARRIVE_CODE_TH, WORKER_RECEIVE_LOCK_TH, workerFailMessage } from "@/lib/jobs/messages";
import type { WorkerFailExtra } from "@/lib/jobs/messages";
import { findForbiddenKeys, sanitizeWorkerView } from "@/lib/jobs/worker-view";
import type { WorkerView } from "@/lib/jobs/worker-view";

export const WORKER_SESSION_COOKIE = "w_session";
export const WORKER_SESSION_MAX_AGE_S = 12 * 60 * 60;

/** jobNo: เฉพาะช่องทางเปิดใบ (0187) — เลขใบงานที่ชน (job_exists) เพื่อบอกผู้จัดการ · ช่องทางอื่นไม่ใส่ (รูปเดิมไม่เปลี่ยน) */
export type WorkerFail = { ok: false; code: string; error: string; retryAfterSeconds?: number; jobNo?: string; budgetLeft?: number };
export type WorkerOk<T> = { ok: true; data: T };

export const fail = (code: string, error?: string): WorkerFail => ({ ok: false, code, error: error ?? workerFailMessage(code, null) });

export interface Caller {
  tokenHash: string | null;
  sessionHash: string | null;
  ipHash: string | null;
  userAgent: string | null;
}

export async function readCaller(token: unknown): Promise<Caller> {
  const [c, h] = await Promise.all([cookies(), headers()]);
  return {
    tokenHash: tokenHashOrNull(token),
    sessionHash: sessionHashOrNull(c.get(WORKER_SESSION_COOKIE)?.value),
    ipHash: ipHashOrNull(clientIpFromHeaders((n) => h.get(n))),
    userAgent: (h.get("user-agent") ?? "").slice(0, 200) || null,
  };
}

export const isFail = (r: Record<string, unknown> | WorkerFail): r is WorkerFail => r.ok === false && typeof (r as WorkerFail).error === "string";

export const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
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
export async function callWorkerRpc(fn: string, params: Record<string, unknown>, opts: { keepJobNo?: boolean; intake?: boolean } = {}): Promise<Record<string, unknown> | WorkerFail> {
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
  const extra = failExtra(r);
  // QR ร้าน: งบผิดเป็นของ "ทั้งร้าน" — ข้อความ "ใบนี้ใส่ PIN ผิดได้อีก n ครั้ง" ของ QR ใบงานไม่ใช้ (ตัวเลขส่งต่อทาง budgetLeft ให้ intakeFail ประกอบข้อความของร้านเอง)
  if (opts.intake) extra.tokenBudgetLeft = null;
  const out: WorkerFail = { ok: false, code, error: workerFailMessage(code, r.message, extra) };
  if (opts.intake) {
    const b = finite(r.token_budget_left);
    if (b !== null && b >= 0 && b <= INTAKE_PIN_BUDGET) out.budgetLeft = b;
  }
  const retry = typeof r.retry_after_seconds === "number" ? r.retry_after_seconds : null;
  if (retry !== null && Number.isFinite(retry) && retry > 0) out.retryAfterSeconds = Math.min(Math.ceil(retry), 3600);
  const jn = opts.keepJobNo ? shortText(r.job_no, 20) : null;
  if (jn !== null && /^JB-\d{1,8}$/.test(jn)) out.jobNo = jn;
  return out;
}

/**
 * 0182: แปลง job.photos ของ RPC ({id, sm_path, md_path, is_primary, caption}) เป็น URL ที่เซ็นแล้ว ({id, sm_url, md_url, is_primary, caption}) — path ถูกทิ้งตรงนี้
 * 🔴 เซ็นเฉพาะ path ที่ RPC ส่งมาหลังระบุตัว (หน้าตาตรง <shop>/<job>/<uuid>_md|sm.jpg) · ไม่มี viewer = ทิ้งทั้งก้อน (ไม่ควรมี — RPC ไม่ส่ง) · TTL 15 นาที · เซ็นล้มทั้งคู่ = รูปนั้นหาย (ไม่ล้มทั้งหน้า)
 */
async function signWorkerPhotos(r: Record<string, unknown>): Promise<Record<string, unknown>> {
  const job = r.job;
  if (typeof job !== "object" || job === null || Array.isArray(job)) return r;
  const list = (job as Record<string, unknown>).photos;
  if (!Array.isArray(list)) return r;
  const rest = { ...(job as Record<string, unknown>) };
  delete rest.photos;
  const hasViewer = typeof r.viewer === "object" && r.viewer !== null;
  if (!hasViewer) return { ...r, job: rest };
  const items = list.slice(0, 20).filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x));
  const paths: string[] = [];
  for (const it of items) {
    for (const p of [it.md_path, it.sm_path]) if (typeof p === "string" && JOB_PHOTO_PATH_RE.test(p)) paths.push(p);
  }
  const signed = paths.length > 0 ? await signJobPhotoPaths(getServiceClient(), paths) : new Map<string, string>();
  const photos = items.flatMap((it) => {
    const md = typeof it.md_path === "string" ? signed.get(it.md_path) : undefined;
    const sm = typeof it.sm_path === "string" ? signed.get(it.sm_path) : undefined;
    if (!md && !sm) return [];
    return [{ id: it.id, sm_url: sm ?? md, md_url: md ?? sm, is_primary: it.is_primary === true, caption: it.caption }];
  });
  return { ...r, job: photos.length > 0 ? { ...rest, photos } : rest };
}

/** อ่านข้อมูลหน้าช่าง (เรียกจาก server component ของหน้า /w/<token> เท่านั้น) */
export async function loadWorkerView(token: unknown): Promise<WorkerOk<WorkerView> | WorkerFail> {
  const c = await readCaller(token);
  if (!c.tokenHash) return fail("invalid_token");
  const r = await callWorkerRpc("job_worker_resolve", { p_token_hash: c.tokenHash, p_session_hash: c.sessionHash, p_ip_hash: c.ipHash });
  if (isFail(r)) return r;
  const view = sanitizeWorkerView(await signWorkerPhotos(r));
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
  if (isFail(r)) return r.code === "office_required" ? { ...r, error: WORKER_RECEIVE_LOCK_TH } : r;
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
  const lotId = isUuid(r.lot_job_id) ? r.lot_job_id : null;
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

export interface ArriveDiscrepancyInput {
  discrepancyId: string;
  /** กี่ชิ้นที่ได้รับเพิ่ม (1 ≤ n ≤ ส่วนต่างที่ค้าง · DB ตรวจ) */
  qty: number;
  /** ทอง + ขั้นที่รับขาดตั้งชั่ง: น้ำหนักชิ้นที่มาถึง (กรัม) · อย่างอื่นห้ามส่ง (DB ตอบ weight_unexpected) */
  weightG?: number | null;
  /** จำนวนส่วนต่างที่ค้างตามที่เห็นบนจอ (CAS · กดซ้ำ/2 มือถือ → DB ตอบ stage_changed) */
  expectedOpen?: number | null;
}
export interface ArriveResult {
  /** ที่ได้รับเพิ่มครั้งนี้ */
  qty: number;
  /** ส่วนต่างที่ยังค้าง (0 = ครบ) */
  qtyRemaining: number;
  /** แถวส่วนต่างที่ยังค้าง (id ใหม่ — ใช้กดต่อ) · null = ครบ */
  remainingDiscrepancyId: string | null;
  /** ส่วนใหม่ที่เกิดจากชิ้นที่มาถึง (ส่วนย่อยของใบแม่) */
  lot: { lotJobId: string; lotSeq: number; label: string; stageCode: string | null };
}

/**
 * 0183 (มติ 20 ต.ค.): ผู้รับของขั้นที่รับขาดกด "ได้รับเพิ่มแล้ว" (ของนับผิด/ส่งตามมาทีหลัง) — ชิ้นที่มาถึงเป็นส่วนใหม่ที่ขั้นนั้น (received · ผู้ถือ = คนกด)
 * 🔴 ไม่มีน้ำหนัก/ส่วนที่ขาด/เพดานในผลลัพธ์และข้อความ (N1: ผู้ชั่งต้องชั่งแบบไม่รู้คำตอบ) · ข้อความ code ที่ซ้ำกับบริบทอื่นใช้ WORKER_ARRIVE_CODE_TH
 */
export async function workerArriveDiscrepancy(token: unknown, i: ArriveDiscrepancyInput): Promise<WorkerOk<ArriveResult> | WorkerFail> {
  const c = await readCaller(token);
  if (!c.tokenHash) return fail("invalid_token");
  if (!c.sessionHash) return fail("session_required");
  const r = await callWorkerRpc("job_worker_discrepancy_arrive", {
    p_token_hash: c.tokenHash, p_session_hash: c.sessionHash, p_discrepancy_id: i.discrepancyId, p_qty: i.qty,
    p_user_agent: c.userAgent, p_ip_hash: c.ipHash,
    // ส่งเฉพาะที่ระบุ (ค่าเริ่มของ RPC = null)
    ...(i.weightG != null ? { p_weight_g: i.weightG } : {}), ...(i.expectedOpen != null ? { p_expected_open: i.expectedOpen } : {}),
  });
  if (isFail(r)) {
    const override = Object.prototype.hasOwnProperty.call(WORKER_ARRIVE_CODE_TH, r.code) ? WORKER_ARRIVE_CODE_TH[r.code] : null;
    return override ? { ...r, error: override } : r;
  }
  const qty = intOrNull(r.qty);
  const remaining = intOrNull(r.qty_remaining);
  const lotId = isUuid(r.lot_job_id) ? r.lot_job_id : null;
  const lotSeq = intOrNull(r.lot_seq);
  if (r.action !== "arrive" || qty === null || remaining === null || !lotId || lotSeq === null) return fail("error", GENERIC_JOB_ERROR);
  return {
    ok: true,
    data: {
      qty,
      qtyRemaining: remaining,
      remainingDiscrepancyId: isUuid(r.discrepancy_id) ? r.discrepancy_id : null,
      lot: { lotJobId: lotId, lotSeq, label: shortText(r.label) ?? "", stageCode: shortText(r.stage_code, 40) },
    },
  };
}

// ---------------------------------------------------------------------------
// 0187 W1 — ผู้จัดการเปิดใบจากมือถือ (QR ร้าน /w/s/<token> + PIN) · ช่องทางสาธารณะที่ "สร้างข้อมูล"
// 🔴 ไม่มี shop id ในพารามิเตอร์เลย — ร้านมาจาก token ร้านที่ DB ตรวจเอง (ห้ามเพิ่ม p_shop_id) · สิทธิ์ can_open_job ตรวจสดที่ DB ทุกครั้ง
// 🔴 ผลลัพธ์ผ่านรูปร่าง allowlist เท่านั้น (ไม่ spread ผลดิบ) + ด่านซ้ำ findForbiddenKeys ที่ผลดิบ — เงิน/ต้นทุน/น้ำหนักทองห้ามถึง client
// ---------------------------------------------------------------------------

/** ข้อความของ code ในบริบท QR ร้าน (ทับตาราง WORKER_CODE_TH ที่เขียนเรื่อง "ใบงาน") */
const INTAKE_CODE_TH: Record<string, string> = {
  invalid_token: "QR ร้านนี้ใช้ไม่ได้แล้ว — ขอ QR ใหม่จากออฟฟิศ",
  session_required: "หมดเวลาแล้ว — ใส่ PIN ใหม่",
  rate_limited: "ส่งถี่เกินไป — รอสักครู่แล้วลองอีกครั้ง",
  // งบผิด 7 ครั้ง/วัน รวมทั้งร้าน (มติเจ้าของ 21 ต.ค.) — ไม่พูดถึงใบงาน (ข้อความของ QR ใบงานคนละบริบท)
  token_budget_exhausted: "วันนี้ใส่ PIN ผิดครบกำหนดแล้ว — ขอ QR ร้านใหม่จากออฟฟิศ",
};
export const intakeFail = (f: WorkerFail): WorkerFail => {
  const own = Object.prototype.hasOwnProperty.call(INTAKE_CODE_TH, f.code) ? INTAKE_CODE_TH[f.code] : null;
  if (f.code === "job_exists") return { ...f, error: f.jobNo ? `SKU นี้มีใบงาน ${f.jobNo} เปิดอยู่แล้ว — ถ้าต้องการเพิ่มจำนวน แจ้งออฟฟิศ หรือเลือกสินค้าอื่น` : "SKU นี้มีใบงานเปิดอยู่แล้ว — ถ้าต้องการเพิ่มจำนวน แจ้งออฟฟิศ หรือเลือกสินค้าอื่น" };
  // PIN ผิดใกล้งบของร้านหมด (เหลือ ≤ 3) — บอกให้รู้ตัว (ทั้งร้านใช้งบร่วมกัน)
  if (f.code === "bad_credentials" && typeof f.budgetLeft === "number" && f.budgetLeft <= 3) return { ...f, error: `${f.error} · วันนี้ใส่ PIN ผิดได้อีก ${f.budgetLeft} ครั้ง (ทั้งร้านใช้ร่วมกัน)` };
  return own ? { ...f, error: own } : f;
};
/** ผลดิบมี key ต้องห้าม (เงิน/ต้นทุน/ลูกค้า/เลขเอกสาร ฯลฯ) = ไม่ส่งต่อ · ไม่ log ผล (อาจมี token) */
const INTAKE_EXTRA_FORBIDDEN = /target_piece|thb|margin|cost|price/i; // เพิ่มจากตัวกรองของหน้าช่าง: น้ำหนักเป้าหมายทอง (N1) + เงิน/ต้นทุนทุกรูปแบบ
const hasExtraForbiddenKey = (v: unknown, depth = 0): boolean => {
  if (depth > 8 || v === null || typeof v !== "object") return false;
  if (Array.isArray(v)) return v.some((x) => hasExtraForbiddenKey(x, depth + 1));
  return Object.entries(v as Record<string, unknown>).some(([k, x]) => INTAKE_EXTRA_FORBIDDEN.test(k) || hasExtraForbiddenKey(x, depth + 1));
};
export const intakeClean = (r: Record<string, unknown>, fn: string): WorkerFail | null => {
  if (findForbiddenKeys(r).length > 0 || hasExtraForbiddenKey(r)) {
    logJobFailure(fn, new Error("intake response had forbidden keys"));
    return fail("error", GENERIC_JOB_ERROR);
  }
  return null;
};

/** งบ PIN ผิดของ QR ร้าน ต่อวัน รวมทั้งร้าน (มติเจ้าของ 21 ต.ค. — ต้องตรงกับ worker_pin_verify_intake ใน 0187: p_budget_max = 7) */
export const INTAKE_PIN_BUDGET = 7;

const METALS = ["silver", "gold", "brass"] as const;
export type IntakeMetal = (typeof METALS)[number];
const parseMetalOrNull = (v: unknown): IntakeMetal | null => (typeof v === "string" && (METALS as readonly string[]).includes(v) ? (v as IntakeMetal) : null);

export interface IntakeHubView {
  /** identify = ยังไม่มี session (เลือกชื่อ + PIN) · ready = ระบุตัวแล้ว */
  state: "identify" | "ready";
  /** เฉพาะ identify: ช่างที่ can_open_job (มติ Q8) — id + ชื่อเท่านั้น */
  workers: { id: string; displayName: string }[];
  worker: { id: string; displayName: string } | null;
  /** ready แต่ไม่มีสิทธิ์เปิด = false (หน้าจอบอกให้แจ้งออฟฟิศ) */
  openAllowed: boolean;
  /** ร้านมีแบบการบันทึกค่าเริ่มสำหรับเงิน/ทองเหลือง · สำหรับทอง (UX R1) — รู้ตั้งแต่ hub ไม่ต้องรอกรอกฟอร์มยาวแล้วตก */
  profileReady: boolean;
  goldProfileReady: boolean;
  sessionExpired: boolean;
}

/** hub: อ่านสถานะ QR ร้าน + session (เรียกจาก server component ของ /w/s/<token>) */
export async function loadIntakeHub(token: unknown): Promise<WorkerOk<IntakeHubView> | WorkerFail> {
  const c = await readCaller(token);
  if (!c.tokenHash) return intakeFail(fail("invalid_token"));
  const r = await callWorkerRpc("shop_intake_resolve", { p_token_hash: c.tokenHash, p_session_hash: c.sessionHash, p_ip_hash: c.ipHash });
  if (isFail(r)) return intakeFail(r);
  const bad = intakeClean(r, "shop_intake_resolve");
  if (bad) return bad;
  const pickWorker = (x: unknown): { id: string; displayName: string } | null => {
    if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
    const o = x as Record<string, unknown>;
    const name = shortText(o.display_name, 60);
    return isUuid(o.id) && name ? { id: o.id, displayName: name } : null;
  };
  const state = r.state === "ready" ? "ready" : r.state === "identify" ? "identify" : null;
  if (state === null) return fail("error", GENERIC_JOB_ERROR);
  const workers = state === "identify" && Array.isArray(r.workers) ? r.workers.slice(0, 50).map(pickWorker).filter((w): w is { id: string; displayName: string } => w !== null) : [];
  const worker = state === "ready" ? pickWorker(r.worker) : null;
  if (state === "ready" && !worker) return fail("error", GENERIC_JOB_ERROR);
  return {
    ok: true,
    data: {
      state, workers, worker,
      openAllowed: state === "ready" && r.open_allowed === true,
      profileReady: r.profile_ready === true, goldProfileReady: r.gold_profile_ready === true, sessionExpired: r.session_expired === true,
    },
  };
}

/** ระบุตัวที่ QR ร้าน: ชื่อ + PIN → session token (ค่าดิบ — ผู้เรียกตั้ง cookie ทันที · cookie เดียวกับ QR ใบงาน) */
export async function verifyIntakePin(token: unknown, workerId: string, pin: string): Promise<WorkerOk<{ sessionToken: string; maxAgeSeconds: number }> | WorkerFail> {
  const c = await readCaller(token);
  if (!c.tokenHash) return intakeFail(fail("invalid_token"));
  const r = await callWorkerRpc("worker_pin_verify_intake", { p_token_hash: c.tokenHash, p_worker_id: workerId, p_pin: pin, p_user_agent: c.userAgent, p_ip_hash: c.ipHash }, { intake: true });
  if (isFail(r)) return intakeFail(r);
  const raw = r.session_token;
  if (typeof raw !== "string" || sessionHashOrNull(raw) === null) return fail("error", GENERIC_JOB_ERROR);
  const exp = typeof r.expires_at === "string" ? Date.parse(r.expires_at) : NaN;
  const left = Number.isFinite(exp) ? Math.floor((exp - Date.now()) / 1000) : WORKER_SESSION_MAX_AGE_S;
  return { ok: true, data: { sessionToken: raw, maxAgeSeconds: Math.max(60, Math.min(left, WORKER_SESSION_MAX_AGE_S)) } };
}

export interface IntakeProduct {
  id: string;
  sku: string;
  name: string;
  /** URL ที่เซ็นแล้ว (1 ชม.) — null = ไม่มีรูป/เซ็นไม่ได้ */
  imageUrl: string | null;
  prefill: {
    metal: IntakeMetal;
    /** สัดส่วน 0..1 (0.925) — หน้าจอแปลงเป็น % ผ่าน lib/units/purity */
    purity: number | null;
    /** น้ำหนักเงินจาก SKU เท่านั้น (ทอง/ทองเหลืองไม่ส่ง — N1) */
    weightG: number | null;
    /** true เฉพาะ SKU ที่ระบุโลหะจริง (Q4) — false = ข้อความกลาง ไม่ใช่คำเตือน */
    metalKnown: boolean;
  };
}

const IMAGE_PATH_RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,199}$/;

/** ค้นสินค้า (เฉพาะ can_open_job) — คืนเฉพาะ id/sku/ชื่อ/รูป/prefill · รูปเซ็น URL ฝั่ง server (path ดิบไม่ถึง client) */
export async function searchIntakeProducts(token: unknown, q: string): Promise<WorkerOk<IntakeProduct[]> | WorkerFail> {
  const c = await readCaller(token);
  if (!c.tokenHash) return intakeFail(fail("invalid_token"));
  if (!c.sessionHash) return intakeFail(fail("session_required"));
  const r = await callWorkerRpc("job_product_search", { p_token_hash: c.tokenHash, p_session_hash: c.sessionHash, p_q: q, p_ip_hash: c.ipHash });
  if (isFail(r)) return intakeFail(r);
  const bad = intakeClean(r, "job_product_search");
  if (bad) return bad;
  const raw = Array.isArray(r.items) ? r.items.slice(0, 20) : [];
  const rows = raw.flatMap((x) => {
    if (typeof x !== "object" || x === null || Array.isArray(x)) return [];
    const o = x as Record<string, unknown>;
    const pf = typeof o.prefill === "object" && o.prefill !== null && !Array.isArray(o.prefill) ? (o.prefill as Record<string, unknown>) : null;
    const metal = parseMetalOrNull(pf?.metal);
    const sku = shortText(o.sku, 100);
    const name = shortText(o.name, 200);
    if (!isUuid(o.id) || !sku || !name || !pf || !metal) return [];
    return [{ o, pf, metal, sku, name, id: o.id as string }];
  });
  const paths = rows.map((x) => x.o.image_path).filter((p): p is string => typeof p === "string" && IMAGE_PATH_RE.test(p) && !p.includes(".."));
  let signed = new Map<string, string>();
  if (paths.length > 0) {
    try {
      signed = await signImagePaths(getServiceClient(), paths);
    } catch (err) {
      logJobFailure("intake_sign_images", err); // รูปหาย ไม่ล้มทั้งการค้น
    }
  }
  const items: IntakeProduct[] = rows.map((x) => ({
    id: x.id, sku: x.sku, name: x.name,
    imageUrl: typeof x.o.image_path === "string" ? (signed.get(x.o.image_path) ?? null) : null,
    prefill: {
      metal: x.metal,
      purity: finite(x.pf.purity),
      weightG: x.metal === "silver" ? finite(x.pf.weight_g) : null, // ด่านซ้ำ: น้ำหนักที่ไม่ใช่เงินไม่ถึง client แม้ DB ส่งมา (N1)
      metalKnown: x.pf.metal_known === true,
    },
  }));
  return { ok: true, data: items };
}

export interface IntakeOpenInput {
  /** คีย์กันกดซ้ำ — หน้าจอสร้างครั้งเดียวตอนเปิดฟอร์ม (16–64 ตัว [A-Za-z0-9_-]) · ใช้ซ้ำตอน "ลองใหม่" เสมอ */
  idemKey: string;
  productId: string | null;
  pendingLabel: string | null;
  metal: IntakeMetal | null;
  /** สัดส่วน 0..1 (ผ่านตัวแปลง % แล้ว) */
  purity: number | null;
  weightG: number | null;
  qtyOrder: number;
  qtyPlanned: number | null;
  dueDate: string | null;
  isNewDesign: boolean;
  note: string | null;
}

const JOB_STATUSES = ["open", "in_progress", "on_hold", "done", "cancelled"] as const;
export type IntakeJobStatus = (typeof JOB_STATUSES)[number];

export interface IntakeOpenResult {
  /** true = key เดิมเปิดไปแล้ว (กดซ้ำ/เน็ตสะดุด) — ไม่มี QR (เก็บ hash แสดงซ้ำไม่ได้) */
  already: boolean;
  /** สถานะจริงของใบ (DB) — already + cancelled = หน้าจอบอก "ใบนี้ถูกยกเลิกแล้ว" ไม่ใช่ "เปิดไว้แล้ว" */
  status: IntakeJobStatus;
  jobNo: string;
  /** QR ใบงานดิบ — แสดงครั้งเดียว (ผู้เรียกห้าม log/เก็บ) · null เมื่อ already */
  token: string | null;
  designLabel: string;
  sku: string | null;
  skuPending: boolean;
  metal: IntakeMetal;
  qtyOrder: number;
  qtyPlanned: number | null;
  isNewDesign: boolean;
  dueDate: string | null;
}

/** เปิดใบผลิต + ใบงาน + QR ทรานแซกชันเดียว — ส่งเฉพาะที่ระบุ (null = ไม่ส่ง · ค่าเริ่มของ RPC เป็น null ทั้งหมด) */
export async function openIntakeJob(token: unknown, i: IntakeOpenInput): Promise<WorkerOk<IntakeOpenResult> | WorkerFail> {
  const c = await readCaller(token);
  if (!c.tokenHash) return intakeFail(fail("invalid_token"));
  if (!c.sessionHash) return intakeFail(fail("session_required"));
  const r = await callWorkerRpc(
    "job_worker_open",
    {
      p_token_hash: c.tokenHash, p_session_hash: c.sessionHash, p_idem_key: i.idemKey, p_qty_order: i.qtyOrder, p_is_new_design: i.isNewDesign, p_user_agent: c.userAgent, p_ip_hash: c.ipHash,
      ...(i.productId ? { p_product_id: i.productId } : {}), ...(i.pendingLabel ? { p_pending_label: i.pendingLabel } : {}), ...(i.metal ? { p_metal: i.metal } : {}),
      ...(i.purity !== null ? { p_purity: i.purity } : {}), ...(i.weightG !== null ? { p_weight_g: i.weightG } : {}), ...(i.qtyPlanned !== null ? { p_qty_planned: i.qtyPlanned } : {}),
      ...(i.dueDate ? { p_due_date: i.dueDate } : {}), ...(i.note ? { p_note: i.note } : {}),
    },
    { keepJobNo: true },
  );
  if (isFail(r)) return intakeFail(r);
  const bad = intakeClean(r, "job_worker_open");
  if (bad) return bad;
  const jobNo = shortText(r.job_no, 20);
  const metal = parseMetalOrNull(r.metal);
  if (!jobNo || !/^JB-\d{1,8}$/.test(jobNo) || !metal) return fail("error", GENERIC_JOB_ERROR);
  const already = r.already === true;
  const raw = r.token;
  if (!already && (typeof raw !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(raw))) return fail("error", GENERIC_JOB_ERROR);
  const due = typeof r.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.due_date) ? r.due_date : null;
  // ทุกค่ามาจาก DB เท่านั้น (ไม่ fallback ไปค่าที่ client ส่งมา — กด "ลองใหม่" ด้วยค่าอื่นต้องเห็นของจริงที่เปิดไปแล้ว) · status ไม่รู้จัก = ข้อความกลาง
  const status = typeof r.status === "string" && (JOB_STATUSES as readonly string[]).includes(r.status) ? (r.status as IntakeJobStatus) : null;
  const qtyOrder = intOrNull(r.qty_order);
  const designLabel = shortText(r.design_label, 200);
  if (status === null || qtyOrder === null || !designLabel) return fail("error", GENERIC_JOB_ERROR);
  return {
    ok: true,
    data: {
      already, jobNo, token: already ? null : (raw as string), status,
      designLabel, sku: shortText(r.sku, 100), skuPending: r.sku_pending === true, metal,
      qtyOrder, qtyPlanned: intOrNull(r.qty_planned), isNewDesign: r.is_new_design === true, dueDate: due,
    },
  };
}

/** ออกจากระบบ: เพิกถอน session ใน DB (ถ้ามี cookie) — ผู้เรียกลบ cookie เอง */
export async function revokeWorkerSession(): Promise<void> {
  const c = await readCaller(null);
  if (!c.sessionHash) return;
  await callWorkerRpc("job_worker_logout", { p_session_hash: c.sessionHash });
}
