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
import { GEM_ERROR_TH } from "@/lib/jobs/gem-errors";
import type { GemForceItem } from "@/lib/jobs/gem-wire";
import { findForbiddenKeys, sanitizeWorkerView } from "@/lib/jobs/worker-view";
import type { WorkerView } from "@/lib/jobs/worker-view";

export const WORKER_SESSION_COOKIE = "w_session";
export const WORKER_SESSION_MAX_AGE_S = 12 * 60 * 60;

/** 0191 W3: ชื่อที่ DB ถามว่า "คล้ายของที่มี" — kind ชนิด/รูปทรง · name ที่พิมพ์ · rows แถวที่พิมพ์ · matches ชื่อที่มีอยู่ (id null = ชื่อใหม่อีกตัวในคำขอเดียวกัน) */
export interface GemSimilar {
  kind: "type" | "shape";
  name: string;
  rows: number[];
  matches: { id: string | null; name: string }[];
}
/** 0191 W3: รายละเอียดของ error พลอยที่ DB ระบุแถว/ช่อง (row 1-based · 0 = ทั้งรายการ · 31 = เกินเพดาน) */
export interface GemFailInfo {
  code: string;
  row?: number;
  field?: string;
}
/** jobNo: เฉพาะช่องทางเปิดใบ (0187) — เลขใบงานที่ชน (job_exists) เพื่อบอกผู้จัดการ · ช่องทางอื่นไม่ใส่ (รูปเดิมไม่เปลี่ยน) · gem/similar: เฉพาะช่องทางพลอย (0191) */
export type WorkerFail = { ok: false; code: string; error: string; retryAfterSeconds?: number; jobNo?: string; budgetLeft?: number; gem?: GemFailInfo; similar?: GemSimilar[] };
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
export async function callWorkerRpc(fn: string, params: Record<string, unknown>, opts: { keepJobNo?: boolean; intake?: boolean; gem?: boolean } = {}): Promise<Record<string, unknown> | WorkerFail> {
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
  // 0191 W3: รายละเอียด error พลอย (รหัส/แถว/ช่อง/ชื่อคล้าย) — ผ่านรูปร่างตรวจเข้มทีละ field · ไม่ส่งข้อความดิบของ DB
  if (opts.gem) {
    const gem = parseGemFail(r);
    if (gem) out.gem = gem;
    const similar = mapGemSimilar(r.similar);
    if (similar.length > 0) out.similar = similar;
  }
  return out;
}

const GEM_CODE_RE = /^[a-z][a-z_]{0,39}$/;
const GEM_FIELD_RE = /^[a-z][a-z_]{0,30}$/;

/** gem_code/gem_row/gem_field ที่ RPC แนบมากับ {ok:false, code:'gem_line_invalid'} → GemFailInfo (รูปร่างผิด = null) */
export function parseGemFail(r: Record<string, unknown>): GemFailInfo | null {
  const code = typeof r.gem_code === "string" && GEM_CODE_RE.test(r.gem_code) ? r.gem_code : null;
  if (!code) return null;
  const info: GemFailInfo = { code };
  const row = typeof r.gem_row === "number" && Number.isInteger(r.gem_row) && r.gem_row >= 0 && r.gem_row <= 31 ? r.gem_row : null;
  if (row !== null) info.row = row;
  if (typeof r.gem_field === "string" && GEM_FIELD_RE.test(r.gem_field)) info.field = r.gem_field;
  return info;
}

/** similar[] ของ DB → รายการที่รูปร่างถูก (kind · ชื่อ ≤ 80 · แถว 1-31 · ชื่อที่มี ≤ 5) — ที่เหลือทิ้ง */
export function mapGemSimilar(raw: unknown): GemSimilar[] {
  if (!Array.isArray(raw)) return [];
  const out: GemSimilar[] = [];
  for (const h of raw.slice(0, 20)) {
    if (typeof h !== "object" || h === null || Array.isArray(h)) continue;
    const o = h as Record<string, unknown>;
    if (o.kind !== "type" && o.kind !== "shape") continue;
    const name = shortText(o.name, 80);
    if (!name) continue;
    const rows = (Array.isArray(o.rows) ? o.rows : []).filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 31).slice(0, 31);
    const matches = (Array.isArray(o.matches) ? o.matches : []).slice(0, 5).flatMap((m): { id: string | null; name: string }[] => {
      if (typeof m !== "object" || m === null || Array.isArray(m)) return [];
      const mo = m as Record<string, unknown>;
      const n = shortText(mo.name, 80);
      return n ? [{ id: isUuid(mo.id) ? mo.id : null, name: n }] : [];
    });
    out.push({ kind: o.kind, name, rows, matches });
  }
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
  /** 0191 W3 (S3): พลอยของใบ — บังคับ (ไม่มีทาง null: เรียก RPC ด้วย p_gem_answer เสมอ) · answer: none = ไม่มีพลอย (ไม่มีขั้นฝัง) · has = มีพลอย (ต้องมี lines) · template = ตามแม่แบบ SKU (DB บังคับว่า SKU ต้องมีแม่แบบ) */
  gems: IntakeGemsParam;
}

/** payload ที่ผ่าน allowlist แล้ว (toWireGemLines/toWireGemForce) — ชั้นนี้ไม่แปลงซ้ำ */
export interface IntakeGemsParam {
  answer: "none" | "has" | "template";
  lines?: Record<string, unknown>[] | null;
  force?: GemForceItem[] | null;
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
  /** 0191 W3: สรุปพลอยของใบ (จาก DB — รวม replay) · ไม่มี = ผลเดิม */
  gem?: IntakeGemSummary;
}

export type GemState = "specified" | "unspecified" | "not_needed";
const GEM_STATES = ["specified", "unspecified", "not_needed"] as const;
export const parseGemState = (v: unknown): GemState | null => (typeof v === "string" && (GEM_STATES as readonly string[]).includes(v) ? (v as GemState) : null);

/** สรุปพลอยของใบที่เพิ่งเปิด — ชื่อใหม่ที่เข้าแคตตาล็อก · ชื่อที่ "ใช้ตัวเดิมให้" · แถวที่รวมให้ · 🔴 ไม่มีราคา/ผู้ขาย/ผู้สร้าง */
export interface IntakeGemSummary {
  count: number;
  /** รวมเม็ดทั้งใบ = จำนวน/ชิ้น x จำนวนที่เริ่มผลิต (DB คำนวณ) */
  total: number;
  state: GemState;
  createdTypes: string[];
  createdShapes: string[];
  reused: { row: number | null; kind: "type" | "shape"; typed: string; name: string }[];
  mergedRows: number[][];
}

const gemInt = (v: unknown, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null);
const strList = (v: unknown, n = 30): string[] => (Array.isArray(v) ? v.slice(0, n).flatMap((x) => { const s = shortText(x, 80); return s ? [s] : []; }) : []);

/** ส่วนรายชื่อของสรุปพลอย (ชื่อใหม่ · ชื่อที่ใช้ตัวเดิมให้ · แถวที่รวมให้) — ใช้ร่วมกันทั้งตอนเปิดใบและตอนแก้ · รูปร่างผิดทีละรายการ = ทิ้งรายการนั้น */
export function mapGemNames(raw: unknown): Pick<IntakeGemSummary, "createdTypes" | "createdShapes" | "reused" | "mergedRows"> {
  const o: Record<string, unknown> = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const reused = (Array.isArray(o.reused) ? o.reused.slice(0, 60) : []).flatMap((x): IntakeGemSummary["reused"] => {
    if (typeof x !== "object" || x === null || Array.isArray(x)) return [];
    const r = x as Record<string, unknown>;
    const typed = shortText(r.typed, 80);
    const name = shortText(r.name, 80);
    return (r.kind === "type" || r.kind === "shape") && typed && name ? [{ row: gemInt(r.row, 31), kind: r.kind, typed, name }] : [];
  });
  const mergedRows = (Array.isArray(o.merged_rows) ? o.merged_rows.slice(0, 30) : []).flatMap((x): number[][] => {
    const rows = (Array.isArray(x) ? x : []).filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 31).slice(0, 31);
    return rows.length > 0 ? [rows] : [];
  });
  return { createdTypes: strList(o.created_types), createdShapes: strList(o.created_shapes), reused, mergedRows };
}

/** สรุปผล create/replay → IntakeGemSummary (ประกอบทีละ field · รูปร่างผิด = null) */
export function mapGemSummary(raw: unknown): IntakeGemSummary | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const count = gemInt(o.count, 30);
  const total = gemInt(o.total, 1e12);
  const state = parseGemState(o.state);
  if (count === null || total === null || state === null) return null;
  return { count, total, state, ...mapGemNames(o) };
}

/** เปิดใบผลิต + ใบงาน + QR ทรานแซกชันเดียว — ส่งเฉพาะที่ระบุ (null = ไม่ส่ง · ค่าเริ่มของ RPC เป็น null ทั้งหมด) */
export async function openIntakeJob(token: unknown, i: IntakeOpenInput): Promise<WorkerOk<IntakeOpenResult> | WorkerFail> {
  // 0191 W3 (S3 · security L1): กันซ้ำชั้น server — ไม่มี gems.answer ที่ถูก (action ปฏิเสธไปแล้ว ที่นี่กันผู้เรียกอื่น/ทางลัด) = ล้มก่อนเรียก RPC · ไม่มีทางส่ง p_gem_answer ว่าง/แปลก (= ไม่มีทางไปทาง null ของ W1)
  const answer = (i.gems as { answer?: unknown } | null | undefined)?.answer;
  if (answer !== "none" && answer !== "has" && answer !== "template") return gemFail(fail("gem_answer_invalid"), "open");
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
      // 0191 W3 (S3): ส่ง p_gem_answer เสมอ (ไม่มีทาง null) · 'none'/'template' ไม่ส่ง lines · force ส่งเฉพาะที่มี (รายการชื่อที่ถูกถาม)
      p_gem_answer: i.gems.answer, ...(i.gems.lines ? { p_gem_lines: i.gems.lines } : {}), ...(i.gems.force && i.gems.force.length > 0 ? { p_gem_force: i.gems.force } : {}),
    },
    { keepJobNo: true, gem: true },
  );
  if (isFail(r)) return gemFail(r, "open");
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
  const gem = mapGemSummary(r.gem);
  return {
    ok: true,
    data: {
      already, jobNo, token: already ? null : (raw as string), status,
      designLabel, sku: shortText(r.sku, 100), skuPending: r.sku_pending === true, metal,
      qtyOrder, qtyPlanned: intOrNull(r.qty_planned), isNewDesign: r.is_new_design === true, dueDate: due,
      ...(gem ? { gem } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// 0191 W3 — ผู้จัดการกรอก/แก้พลอยจากมือถือ (QR ร้าน + PIN) · อ่านแคตตาล็อก · อ่านพลอยของใบตัวเอง · แก้ทั้งชุด
// 🔴 ราคาพลอย = ต้นทุน: ไม่มี field ราคา/ผู้ขาย/ผู้สร้าง/เผื่อแตกใน type ใดของส่วนนี้ · ผลดิบผ่าน intakeClean (key ต้องห้ามทิ้ง) แล้วประกอบทีละ field (ไม่ spread)
// 🔴 ไม่มี shop id ในพารามิเตอร์ (ร้านมาจาก token ร้านที่ DB ตรวจ) · ด่านจริง (ผู้เปิดใบ · ขั้นแรกยังไม่รับ · ใบ open · มีขั้นฝัง · CAS) อยู่ที่ DB (RPC job_worker_gem_*)
// ---------------------------------------------------------------------------

/** ข้อความไทยตายตัวของ code ในช่องทางพลอย (ทับตาราง QR ร้านที่เขียนเรื่องรูป/ใบงาน) — ไม่มีตัวเลขเงิน/ชื่อตาราง/รหัสดิบ */
const GEM_CODE_TH: Record<string, string> = {
  gem_conflict: "มีการแก้พลอยของใบนี้ไปแล้ว (อาจจากอีกเครื่อง) — โหลดหน้าใหม่แล้วแก้อีกครั้ง",
  gem_rev_invalid: "ข้อมูลพลอยของใบนี้เปลี่ยนไป — โหลดหน้าใหม่แล้วลองอีกครั้ง",
  no_gem_stage: "ใบนี้ไม่มีขั้นฝังพลอย — แจ้งออฟฟิศให้เพิ่มขั้นก่อน",
  job_locked: "ช่างรับงานแล้ว แก้พลอยไม่ได้ — แจ้งออฟฟิศ",
  job_cancelled: "ใบนี้ถูกยกเลิกแล้ว — แก้พลอยไม่ได้",
  job_closed: "ใบนี้ปิดแล้ว — แก้พลอยไม่ได้",
  job_not_open: "ใบนี้ไม่อยู่ในสถานะที่แก้พลอยได้ — แจ้งออฟฟิศ",
  order_not_found: "ไม่พบใบงานที่เปิดไว้ — โหลดหน้าใหม่แล้วลองอีกครั้ง",
  not_allowed: "บัญชีนี้ไม่มีสิทธิ์จัดการใบงานจากหน้างาน — แจ้งออฟฟิศ",
  gem_answer_required: "สินค้านี้ยังไม่มีแม่แบบพลอย — เลือกก่อนว่าฝังพลอยหรือไม่ฝังพลอย",
  gem_answer_invalid: "เลือกก่อนว่าใบนี้ฝังพลอยไหม",
  gem_args_invalid: "ข้อมูลพลอยไม่ถูกต้อง — โหลดหน้าใหม่แล้วลองอีกครั้ง",
  gem_lines_required: "เพิ่มพลอยอย่างน้อย 1 รายการ หรือเลือก \"ไม่มีพลอย\"",
  gem_force_invalid: "ข้อมูลยืนยันชื่อพลอยไม่ถูกต้อง — โหลดหน้าใหม่แล้วลองอีกครั้ง",
  // hint เดียวกันครอบทั้ง "เพดานชื่อใหม่ (ชนิด/รูปทรง)" และ "เพดานรายการใหม่ (ขนาดใหม่)" ต่อผู้จัดการต่อ 24 ชม. — ข้อความกลาง ห้ามบอกว่าเป็นเรื่องชื่ออย่างเดียว
  gem_name_cap: "เพิ่มพลอยใหม่ถี่เกินไปวันนี้ — เลือกจากรายการที่มี หรือแจ้งออฟฟิศ",
  gem_similar: GEM_ERROR_TH.gem_similar,
  gem_line_invalid: "ข้อมูลพลอยไม่ถูกต้อง — ตรวจแถวที่ระบุแล้วลองอีกครั้ง",
};

/** ผลล้มของช่องทางพลอย → ข้อความไทย: แถวผิด = "พลอยแถว n: เหตุผล" (เหตุผลจาก GEM_ERROR_TH ตามรหัสที่ DB ระบุ) · code อื่นใช้ตารางด้านบน แล้วตกไป intakeFail */
export const gemFail = (f: WorkerFail, ctx: "open" | "gem" = "gem"): WorkerFail => {
  const base = intakeFail(f);
  if (f.code === "gem_line_invalid" && f.gem) {
    const reason = Object.prototype.hasOwnProperty.call(GEM_ERROR_TH, f.gem.code) ? GEM_ERROR_TH[f.gem.code] : GEM_CODE_TH.gem_line_invalid;
    return { ...base, error: typeof f.gem.row === "number" && f.gem.row >= 1 && f.gem.row <= 30 ? `พลอยแถว ${f.gem.row}: ${reason}` : reason };
  }
  if (f.code === "idem_conflict" || f.code === "job_exists") return base;
  // ช่องทางเปิดใบ (open) ใช้ข้อความเดิมของ W1 กับ code ที่ W1 มีอยู่แล้ว (not_allowed ฯลฯ) — ทับเฉพาะ code ใหม่ของพลอย (gem_*) · ช่องทาง catalog/get/set ใช้ตารางเต็ม
  if (ctx === "open" && !f.code.startsWith("gem_")) return base;
  return Object.prototype.hasOwnProperty.call(GEM_CODE_TH, f.code) ? { ...base, error: GEM_CODE_TH[f.code] } : base;
};

const num2 = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 100 ? v : null);
const optUuid = (v: unknown): string | null => (isUuid(v) ? v : null);

export interface GemCatalogType { id: string; name: string }
export interface GemCatalogShape { id: string; name: string; hasLength: boolean }
/** ขนาดที่เคยใช้ (≤ 6 ต่อ ชนิด x รูปทรง) — ให้ chip "เคยใช้" */
export interface GemCatalogSize { typeId: string; shapeId: string; sizeA: number; sizeB: number | null }
/** แถวแม่แบบ SKU (หรือแถวของใบ) — ชนิด/รูปทรง/ขนาดตามรายการปัจจุบัน · label = ฉลากที่ DB ประกอบ */
export interface IntakeGemLine {
  gemItemId: string;
  label: string;
  typeId: string | null;
  typeName: string | null;
  shapeId: string | null;
  shapeName: string | null;
  hasLength: boolean | null;
  sizeA: number | null;
  sizeB: number | null;
  qtyPerPiece: number;
  position: string | null;
}
export interface IntakeGemCatalog {
  types: GemCatalogType[];
  shapes: GemCatalogShape[];
  sizes: GemCatalogSize[];
  /** SKU ที่ส่ง productId มีแม่แบบพลอยไหม (ไม่ผ่านเงื่อนไข SKU = false เหมือนไม่มีแม่แบบ — ไม่เปิดเผยว่ามี SKU นั้น) */
  hasTemplate: boolean;
  template: IntakeGemLine[];
  maxLines: number;
}

function mapGemLine(x: unknown): IntakeGemLine | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const gemItemId = optUuid(o.gem_item_id);
  const label = shortText(o.label, 200);
  const qty = gemInt(o.qty_per_piece, 1000);
  if (!gemItemId || !label || qty === null || qty < 1) return null;
  return {
    gemItemId, label,
    typeId: optUuid(o.type_id), typeName: shortText(o.type_name, 80), shapeId: optUuid(o.shape_id), shapeName: shortText(o.shape_name, 80),
    hasLength: typeof o.has_length === "boolean" ? o.has_length : null, sizeA: num2(o.size_a), sizeB: num2(o.size_b),
    qtyPerPiece: qty, position: shortText(o.position, 40),
  };
}

/** ตัวเรียก RPC ที่ต้องมี token + session (ไม่มี = ไม่ส่งไป DB เลย) */
async function gemCaller(token: unknown): Promise<{ c: Caller & { tokenHash: string; sessionHash: string } } | { f: WorkerFail }> {
  const c = await readCaller(token);
  if (!c.tokenHash) return { f: intakeFail(fail("invalid_token")) };
  if (!c.sessionHash) return { f: intakeFail(fail("session_required")) };
  return { c: { ...c, tokenHash: c.tokenHash, sessionHash: c.sessionHash } };
}

/** ชนิด/รูปทรงที่ใช้ได้ + ขนาดที่เคยใช้ + (ถ้าส่ง productId) แม่แบบพลอยของ SKU — เฉพาะผู้จัดการ (can_open_job) · ไม่มีราคา */
export async function loadIntakeGemCatalog(token: unknown, productId: string | null): Promise<WorkerOk<IntakeGemCatalog> | WorkerFail> {
  if (productId !== null && !isUuid(productId)) return gemFail(fail("sku_invalid"));
  const a = await gemCaller(token);
  if ("f" in a) return a.f;
  const r = await callWorkerRpc("job_worker_gem_catalog", { p_token_hash: a.c.tokenHash, p_session_hash: a.c.sessionHash, p_ip_hash: a.c.ipHash, ...(productId ? { p_product_id: productId } : {}) }, { gem: true });
  if (isFail(r)) return gemFail(r);
  const bad = intakeClean(r, "job_worker_gem_catalog");
  if (bad) return bad;
  const types = (Array.isArray(r.types) ? r.types.slice(0, 1000) : []).flatMap((t): GemCatalogType[] => {
    if (typeof t !== "object" || t === null || Array.isArray(t)) return [];
    const o = t as Record<string, unknown>;
    const name = shortText(o.name, 80);
    return isUuid(o.id) && name ? [{ id: o.id, name }] : [];
  });
  const shapes = (Array.isArray(r.shapes) ? r.shapes.slice(0, 300) : []).flatMap((s): GemCatalogShape[] => {
    if (typeof s !== "object" || s === null || Array.isArray(s)) return [];
    const o = s as Record<string, unknown>;
    const name = shortText(o.name, 80);
    return isUuid(o.id) && name ? [{ id: o.id, name, hasLength: o.has_length === true }] : [];
  });
  const sizes = (Array.isArray(r.sizes) ? r.sizes.slice(0, 600) : []).flatMap((z): GemCatalogSize[] => {
    if (typeof z !== "object" || z === null || Array.isArray(z)) return [];
    const o = z as Record<string, unknown>;
    const a2 = num2(o.size_a);
    return isUuid(o.type_id) && isUuid(o.shape_id) && a2 !== null ? [{ typeId: o.type_id, shapeId: o.shape_id, sizeA: a2, sizeB: num2(o.size_b) }] : [];
  });
  const template = (Array.isArray(r.template) ? r.template.slice(0, 30) : []).flatMap((x) => { const l = mapGemLine(x); return l ? [l] : []; });
  return { ok: true, data: { types, shapes, sizes, hasTemplate: r.has_template === true && template.length > 0, template, maxLines: 30 } };
}

export interface IntakeJobGems {
  job: { jobId: string; jobNo: string; designLabel: string; status: string; qtyPlanned: number };
  state: GemState;
  /** แก้ได้ตอนนี้ (ผู้เปิด · ขั้นแรกยังไม่รับ · ใบ open · มีขั้นฝัง) — DB ตัดสิน · บันทึกจริงตรวจซ้ำใต้ล็อกแถวใบ */
  editable: boolean;
  /** เหตุที่แก้ไม่ได้: job_locked · job_cancelled · job_closed · job_not_open · no_gem_stage */
  lockCode: string | null;
  hasGemStage: boolean;
  /** ลายนิ้วมือของพลอยใบ (CAS) — ส่งกลับตอนบันทึก */
  rev: string;
  lines: (IntakeGemLine & { qtyTotal: number })[];
  maxLines: number;
}

const REV_RE = /^([0-9a-f]{32}|empty)$/;
const LOCK_CODES = ["job_locked", "job_cancelled", "job_closed", "job_not_open", "no_gem_stage"] as const;

/** พลอยของใบที่ช่างคนนี้เปิดเอง (W-10) — ใบคนอื่น/ออฟฟิศ/ส่วนย่อย/ร้านอื่น = order_not_found จาก DB · อ่านได้แม้ถูกล็อก */
export async function loadIntakeJobGems(token: unknown, jobId: unknown): Promise<WorkerOk<IntakeJobGems> | WorkerFail> {
  if (typeof jobId !== "string" || !isUuid(jobId)) return gemFail(fail("order_not_found"));
  const a = await gemCaller(token);
  if ("f" in a) return a.f;
  const r = await callWorkerRpc("job_worker_gem_get", { p_token_hash: a.c.tokenHash, p_session_hash: a.c.sessionHash, p_job_id: jobId, p_ip_hash: a.c.ipHash }, { gem: true });
  if (isFail(r)) return gemFail(r);
  const bad = intakeClean(r, "job_worker_gem_get");
  if (bad) return bad;
  const j = typeof r.job === "object" && r.job !== null && !Array.isArray(r.job) ? (r.job as Record<string, unknown>) : null;
  const state = parseGemState(r.state);
  const rev = typeof r.rev === "string" && REV_RE.test(r.rev) ? r.rev : null;
  const jobNo = j ? shortText(j.job_no, 20) : null;
  const designLabel = j ? shortText(j.design_label, 200) : null;
  const status = j ? shortText(j.status, 20) : null;
  const qtyPlanned = j ? gemInt(j.qty_planned, 100000) : null;
  if (!j || !isUuid(j.job_id) || !jobNo || !/^JB-\d{1,8}$/.test(jobNo) || !designLabel || !status || qtyPlanned === null || state === null || rev === null) return fail("error", GENERIC_JOB_ERROR);
  // 🔴 ห้ามทิ้งแถวผิดรูปเงียบๆ: หน้าแก้ส่งชุดนี้กลับเป็น replace-all — แถวที่หายไปจากจอ = ถูกลบจริงตอนบันทึก (review S2) → จำนวนแถวที่ map ได้ต้องเท่าที่ DB ส่ง ไม่งั้นล้มปลอดภัย
  if (!Array.isArray(r.lines) || r.lines.length > 30) return fail("error", GENERIC_JOB_ERROR);
  const lines = r.lines.flatMap((x) => {
    const l = mapGemLine(x);
    const t = typeof x === "object" && x !== null ? gemInt((x as Record<string, unknown>).qty_total, 1e9) : null;
    return l && t !== null ? [{ ...l, qtyTotal: t }] : [];
  });
  if (lines.length !== r.lines.length) return fail("error", GENERIC_JOB_ERROR);
  const lockCode = typeof r.lock_code === "string" && (LOCK_CODES as readonly string[]).includes(r.lock_code) ? r.lock_code : null;
  return {
    ok: true,
    data: {
      job: { jobId: j.job_id, jobNo, designLabel, status, qtyPlanned },
      state, editable: r.editable === true && lockCode === null, lockCode, hasGemStage: r.has_gem_stage === true, rev, lines, maxLines: 30,
    },
  };
}

export interface IntakeGemSetInput {
  jobId: string;
  /** ผ่าน toWireGemLines แล้ว (allowlist) */
  lines: Record<string, unknown>[];
  /** rev จาก loadIntakeJobGems (CAS) — ว่าง/ผิดรูป = ไม่ถึง DB */
  expectedRev: string;
  /** ชื่อที่ผู้ใช้ยืนยันหลัง DB ถาม (gem_similar) */
  force?: GemForceItem[] | null;
}
export interface IntakeGemSetResult {
  changed: boolean;
  count: number;
  lines: { gemItemId: string; label: string; qtyPerPiece: number; qtyTotal: number; position: string | null }[];
  summary: Pick<IntakeGemSummary, "createdTypes" | "createdShapes" | "reused" | "mergedRows">;
  state: GemState;
  rev: string;
}

/** แก้พลอยทั้งชุด (all-or-nothing) — ล้ม = ไม่เขียนอะไร · ผิดแถว = gem.row/gem.field · ชื่อคล้าย = similar[] (ส่งกลับพร้อม force ที่ผู้ใช้ยืนยัน) */
export async function setIntakeJobGems(token: unknown, i: IntakeGemSetInput): Promise<WorkerOk<IntakeGemSetResult> | WorkerFail> {
  if (typeof i.jobId !== "string" || !isUuid(i.jobId)) return gemFail(fail("order_not_found"));
  if (typeof i.expectedRev !== "string" || !REV_RE.test(i.expectedRev)) return gemFail(fail("gem_rev_invalid"));
  const a = await gemCaller(token);
  if ("f" in a) return a.f;
  const r = await callWorkerRpc("job_worker_gem_set", {
    p_token_hash: a.c.tokenHash, p_session_hash: a.c.sessionHash, p_job_id: i.jobId, p_lines: i.lines, p_expected_rev: i.expectedRev, p_ip_hash: a.c.ipHash,
    ...(i.force && i.force.length > 0 ? { p_force: i.force } : {}),
  }, { gem: true });
  if (isFail(r)) return gemFail(r);
  const bad = intakeClean(r, "job_worker_gem_set");
  if (bad) return bad;
  const state = parseGemState(r.state);
  const rev = typeof r.rev === "string" && REV_RE.test(r.rev) ? r.rev : null;
  const count = gemInt(r.count, 30);
  if (state === null || rev === null || count === null || typeof r.changed !== "boolean") return fail("error", GENERIC_JOB_ERROR);
  const lines = (Array.isArray(r.lines) ? r.lines.slice(0, 30) : []).flatMap((x) => {
    if (typeof x !== "object" || x === null || Array.isArray(x)) return [];
    const o = x as Record<string, unknown>;
    const gemItemId = optUuid(o.gem_item_id);
    const label = shortText(o.label, 200);
    const qty = gemInt(o.qty_per_piece, 1000);
    const total = gemInt(o.qty_total, 1e9);
    return gemItemId && label && qty !== null && qty >= 1 && total !== null ? [{ gemItemId, label, qtyPerPiece: qty, qtyTotal: total, position: shortText(o.position, 40) }] : [];
  });
  return { ok: true, data: { changed: r.changed, count, lines, state, rev, summary: mapGemNames(r.summary) } };
}

/** ออกจากระบบ: เพิกถอน session ใน DB (ถ้ามี cookie) — ผู้เรียกลบ cookie เอง */
export async function revokeWorkerSession(): Promise<void> {
  const c = await readCaller(null);
  if (!c.sessionHash) return;
  await callWorkerRpc("job_worker_logout", { p_session_hash: c.sessionHash });
}
