"use server";

// lib/actions/job-worker.ts — server action ของหน้าช่าง /w/<token> (สาธารณะ — ไม่ผ่าน middleware · พิสูจน์ตัวด้วย token + PIN ที่ DB)
// ไฟล์นี้เป็น "use server" ไฟล์เดียวที่หน้า /w/ ใช้ได้ — ห้าม import action ออฟฟิศ (job-office) เข้า graph ของหน้านี้ (มีเทสต์)
// ทุก action: ตรวจชนิด/ช่วง input ก่อนถึง DB (ไม่ส่งค่าผิดรูปไปให้ RPC) · ไม่รับ stage_code จาก client (RPC คำนวณขั้นเอง มีแค่ expectedSeq)
// session ช่าง: cookie httpOnly · secure (production) · sameSite=lax · path=/w · อายุตาม DB (≤ 12 ชม.) · เก็บ session token ดิบ (DB เก็บแค่ sha256)

import { cookies } from "next/headers";
import { parseCount, parsePin, parseScrapReason, parseSeq, parseText, parseWeight, parseWeightOrZero, isUuid } from "@/lib/jobs/input";
import { WORKER_SESSION_COOKIE, revokeWorkerSession, verifyWorkerPin, workerCancelLot, workerReceive, workerResolveDiscrepancy, workerSend } from "@/lib/jobs/worker-server";
import { WORKER_CODE_TH } from "@/lib/jobs/messages";

export type WorkerActionResult =
  | {
      ok: true;
      already?: boolean;
      message?: string | null;
      by?: string | null;
      /** 0181: ผลแยกส่วน (ส่งต่อ n จาก N) */
      lot?: { lotJobId: string; lotSeq: number; label: string; qty: number; parentRemaining: number };
      /** 0181: ส่วนต่างที่เกิดตอนรับไม่ครบ (ชิ้น) */
      discrepancyQty?: number;
    }
  | { ok: false; error: string; code?: string; retryAfterSeconds?: number };

const bad = (error: string): WorkerActionResult => ({ ok: false, error });

/** 0181: ผลขั้นรับ/ส่ง → ผลของ action (ใส่ lot/discrepancyQty เฉพาะเมื่อมี — รูปเดิมของใบเดี่ยวไม่เปลี่ยน) */
function stageOk(d: { already: boolean; message: string | null; by: string | null; lot?: { lotJobId: string; lotSeq: number; label: string; qty: number; parentRemaining: number }; discrepancyQty?: number }): WorkerActionResult {
  const out: WorkerActionResult = { ok: true, already: d.already, message: d.message, by: d.by };
  if (d.lot) out.lot = d.lot;
  if (d.discrepancyQty !== undefined) out.discrepancyQty = d.discrepancyQty;
  return out;
}

export async function workerLogin(token: string, workerId: string, pin: string): Promise<WorkerActionResult> {
  if (!isUuid(workerId)) return bad(WORKER_CODE_TH.bad_credentials);
  const p = parsePin(pin);
  if (!p.ok) return bad(p.error);
  const r = await verifyWorkerPin(token, workerId, p.value);
  if (!r.ok) return { ok: false, error: r.error, code: r.code, retryAfterSeconds: r.retryAfterSeconds };
  const jar = await cookies();
  jar.set(WORKER_SESSION_COOKIE, r.data.sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/w",
    maxAge: r.data.maxAgeSeconds,
  });
  return { ok: true };
}

export async function workerLogout(): Promise<WorkerActionResult> {
  await revokeWorkerSession();
  const jar = await cookies();
  jar.set(WORKER_SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/w", maxAge: 0 });
  return { ok: true };
}

/** 0181: จำนวนชิ้นจากช่องกรอก 1–100,000 จำนวนเต็มเท่านั้น (ไม่กรองอักขระทิ้งเงียบ) */
function parsePieces(raw: unknown, label: string): { ok: true; value: number } | { ok: false; error: string } {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (!Number.isSafeInteger(n) || n < 1 || n > 100000) return { ok: false, error: `${label}ต้องเป็นจำนวนเต็ม 1–100,000` };
  return { ok: true, value: n };
}

export interface WorkerReceiveOpts {
  /** ส่วนที่จะรับ — ต้องมาจาก parts/my_actions ที่ DB ส่งมา (DB ตรวจว่าอยู่ในต้นไม้ของ token) */
  lotJobId?: string | null;
  /** จำนวนที่ได้จริง — ว่าง = ตามที่ส่ง · น้อยกว่าที่ส่ง = ส่วนต่างรอชี้แจง */
  qtyReceived?: number | string | null;
}

export async function workerReceiveStage(token: string, expectedSeq: number, weightIn: string | null, opts?: WorkerReceiveOpts): Promise<WorkerActionResult> {
  const seq = parseSeq(expectedSeq);
  if (!seq.ok) return bad(seq.error);
  const w = parseWeight(weightIn, "น้ำหนักเข้า");
  if (!w.ok) return bad(w.error);
  if (opts?.lotJobId != null && !isUuid(opts.lotJobId)) return bad("ส่วนที่เลือกไม่ถูกต้อง");
  let qtyReceived: number | null = null;
  if (opts?.qtyReceived != null && opts.qtyReceived !== "") {
    const q = parsePieces(opts.qtyReceived, "จำนวนที่ได้รับ");
    if (!q.ok) return bad(q.error);
    qtyReceived = q.value;
  }
  const r = await workerReceive(token, { expectedSeq: seq.value, weightInG: w.value, lotJobId: opts?.lotJobId ?? null, qtyReceived });
  return r.ok ? stageOk(r.data) : { ok: false, error: r.error, code: r.code, retryAfterSeconds: r.retryAfterSeconds };
}

export interface WorkerSendInput {
  expectedSeq: number;
  weightOut: string | null;
  qtyScrap: number;
  scrapReason: string | null;
  metalAdded: string | null;
  /** 0176: น้ำหนักเศษโลหะที่เก็บได้ (กรัม) — เฉพาะขั้นที่แบบการบันทึกให้ถาม · ไม่ส่ง/ว่าง = ไม่บันทึก */
  scrapWeight?: string | null;
  /** 0181: ส่วนที่ถืออยู่ (จาก parts/my_actions) — ว่าง = ใบของ token */
  lotJobId?: string | null;
  /** 0181: ส่งต่อกี่ชิ้น — ว่าง = ส่งทั้งหมดที่ถือ · น้อยกว่าที่ถือ = แยกส่วน (ต้องมี qtyHold) */
  qtySend?: number | string | null;
  /** 0181: จำนวนที่ถืออยู่ตามที่เห็นบนจอ (qty_hold ของ my_actions) */
  qtyHold?: number | string | null;
  /** 0181 H2 (มติ 19 ต.ค. ทองชั่งตอนแบ่ง): น้ำหนักส่วนที่แยกออก (กรัม) — บังคับเมื่อ metal=ทอง + ขั้นนั้นตั้งชั่ง (DB ตอบ weight_move_required) · เงิน/ขั้นไม่ชั่ง = ห้ามส่ง (weight_unexpected) */
  weightMoveG?: number | string | null;
}

export async function workerSendStage(token: string, input: WorkerSendInput): Promise<WorkerActionResult> {
  if (typeof input !== "object" || input === null) return bad("ข้อมูลไม่ถูกต้อง");
  const seq = parseSeq(input.expectedSeq);
  if (!seq.ok) return bad(seq.error);
  const w = parseWeight(input.weightOut, "น้ำหนักออก");
  if (!w.ok) return bad(w.error);
  const scrap = parseCount(input.qtyScrap, "จำนวนของเสีย", 1000);
  if (!scrap.ok) return bad(scrap.error);
  const reason = parseScrapReason(input.scrapReason, scrap.value);
  if (!reason.ok) return bad(reason.error);
  const added = parseWeightOrZero(input.metalAdded, "เติมโลหะ");
  if (!added.ok) return bad(added.error);
  const sw = parseWeight(input.scrapWeight ?? null, "น้ำหนักเศษโลหะ");
  if (!sw.ok) return bad(sw.error);
  if (input.lotJobId != null && !isUuid(input.lotJobId)) return bad("ส่วนที่เลือกไม่ถูกต้อง");
  let qtySend: number | null = null;
  let qtyHold: number | null = null;
  let weightMove: number | null = null;
  if (input.qtySend != null && input.qtySend !== "") {
    // ส่งต่อ n จาก N (แยกส่วน): ต้องมีจำนวนที่ถืออยู่ที่เห็นบนจอ (กันกดซ้ำ) · ห้ามมีน้ำหนักมากับการแยก (มติ ค1 — DB ปฏิเสธซ้ำ)
    const q = parsePieces(input.qtySend, "จำนวนที่ส่งต่อ");
    if (!q.ok) return bad(q.error);
    const h = parsePieces(input.qtyHold, "จำนวนที่ถืออยู่");
    if (!h.ok) return bad("โหลดหน้าใหม่แล้วลองอีกครั้ง (ไม่ทราบจำนวนที่ถืออยู่)");
    qtySend = q.value;
    qtyHold = h.value;
    // น้ำหนักออก/เติม/เศษห้ามมากับการแยก (ค1) — ยกเว้น weightMoveG = น้ำหนักส่วนที่แยกออก (ทองที่ขั้นชั่งเท่านั้น · มติ 19 ต.ค. — DB เป็นด่านจริงว่าเมื่อไรบังคับ/ห้าม)
    if (q.value < h.value && (w.value !== null || added.value > 0 || sw.value !== null)) return bad("การแยกส่วนนับจำนวนอย่างเดียว ไม่ต้องชั่งน้ำหนัก");
    if (input.weightMoveG != null && input.weightMoveG !== "") {
      const wm = parseWeight(input.weightMoveG, "น้ำหนักส่วนที่แยกออก");
      if (!wm.ok) return bad(wm.error);
      if (wm.value === null || wm.value <= 0) return bad("น้ำหนักส่วนที่แยกออกต้องมากกว่า 0");
      weightMove = wm.value;
    }
  } else if (input.weightMoveG != null && input.weightMoveG !== "") {
    return bad("น้ำหนักส่วนที่แยกออกใช้กับการแยกส่วนเท่านั้น");
  } else if (input.qtyHold != null && input.qtyHold !== "") {
    const h = parsePieces(input.qtyHold, "จำนวนที่ถืออยู่");
    if (!h.ok) return bad(h.error);
    qtyHold = h.value;
  }
  const r = await workerSend(token, { expectedSeq: seq.value, weightOutG: w.value, qtyScrap: scrap.value, scrapReason: reason.value, metalAddedG: added.value, scrapWeightG: sw.value, lotJobId: input.lotJobId ?? null, qtySend, qtyHold, weightMoveG: weightMove });
  return r.ok ? stageOk(r.data) : { ok: false, error: r.error, code: r.code, retryAfterSeconds: r.retryAfterSeconds };
}

export interface WorkerResolveDiscrepancyInput {
  discrepancyId: string;
  kind: string;
  reason: string;
}

/** 0181 (Q5): ผู้ส่งชี้แจงส่วนต่าง — เสียหาย (scrap) หรือหาย (lost) + เหตุผล (ชุดเดียวกับเหตุผลของเสีย) */
export async function workerResolveDiscrepancyAction(token: string, input: WorkerResolveDiscrepancyInput): Promise<WorkerActionResult> {
  if (typeof input !== "object" || input === null || !isUuid(input.discrepancyId)) return bad("ข้อมูลไม่ถูกต้อง");
  if (input.kind !== "scrap" && input.kind !== "lost") return bad("เลือกว่าเสียหายหรือหาย");
  const reason = parseScrapReason(input.reason, 1);
  if (!reason.ok || reason.value === null) return bad("เลือกเหตุผล");
  const r = await workerResolveDiscrepancy(token, { discrepancyId: input.discrepancyId, kind: input.kind, reason: reason.value });
  return r.ok ? { ok: true } : { ok: false, error: r.error, code: r.code, retryAfterSeconds: r.retryAfterSeconds };
}

/** 0181 (ข3): ช่างยกเลิกส่วนที่ตัวเองแยกก่อนมีคนรับ (ชิ้นกลับขั้นแม่) */
export async function workerCancelLotAction(token: string, lotJobId: string, reason: string | null): Promise<WorkerActionResult> {
  if (!isUuid(lotJobId)) return bad("ส่วนที่เลือกไม่ถูกต้อง");
  const why = parseText(reason, "เหตุผล", 200, false);
  if (!why.ok) return bad(why.error);
  const r = await workerCancelLot(token, lotJobId, why.value);
  return r.ok ? { ok: true } : { ok: false, error: r.error, code: r.code, retryAfterSeconds: r.retryAfterSeconds };
}
