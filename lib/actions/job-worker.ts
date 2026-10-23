"use server";

// lib/actions/job-worker.ts — server action ของหน้าช่าง /w/<token> (สาธารณะ — ไม่ผ่าน middleware · พิสูจน์ตัวด้วย token + PIN ที่ DB)
// ไฟล์นี้เป็น "use server" ไฟล์เดียวที่หน้า /w/ ใช้ได้ — ห้าม import action ออฟฟิศ (job-office) เข้า graph ของหน้านี้ (มีเทสต์)
// ทุก action: ตรวจชนิด/ช่วง input ก่อนถึง DB (ไม่ส่งค่าผิดรูปไปให้ RPC) · ไม่รับ stage_code จาก client (RPC คำนวณขั้นเอง มีแค่ expectedSeq)
// session ช่าง: cookie httpOnly · secure (production) · sameSite=lax · path=/w · อายุตาม DB (≤ 12 ชม.) · เก็บ session token ดิบ (DB เก็บแค่ sha256)

import { cookies } from "next/headers";
import { IDEM_KEY_RE as IDEM_RE, INVISIBLE_RE, TARGET_PIECE_MAX_G, parseBufferText, parseCount, parseDate, parseLabel, parsePieces, parsePin, parseQtyText, parseScrapReason, parseSeq, parseText, parseWeight, parseWeightOrZero, isUuid } from "@/lib/jobs/input";
import { WORKER_SESSION_COOKIE, loadIntakeGemCatalog, loadIntakeJobGems, openIntakeJob, revokeWorkerSession, searchIntakeProducts, setIntakeJobGems, verifyIntakePin, verifyWorkerPin, workerArriveDiscrepancy, workerCancelLot, workerReceive, workerResolveDiscrepancy, workerSend } from "@/lib/jobs/worker-server";
import type { GemFailInfo, GemSimilar, IntakeGemCatalog, IntakeGemSetResult, IntakeGemsParam, IntakeJobGems, IntakeMetal, IntakeOpenResult, IntakeProduct, WorkerFail } from "@/lib/jobs/worker-server";
import { toWireGemForce, toWireGemLines } from "@/lib/jobs/gem-wire";
import type { GemForceItem, GemLineInput } from "@/lib/jobs/gem-wire";
import { JOB_PHOTO_FILE_CODE, JOB_PHOTO_FILE_ERROR_TH } from "@/lib/jobs/photos";
import { listIntakePhotos, listMyIntakeJobs, reissueIntakeToken, removeIntakePhoto, setPrimaryIntakePhoto, uploadIntakePhoto } from "@/lib/jobs/shop-photo-server";
import type { IntakeJobRef, IntakePhotoList, IntakeReissueResult, IntakeUploadResult, MyIntakeList } from "@/lib/jobs/shop-photo-server";
import { purityPctIssue, purityPctToFraction } from "@/lib/units/purity";
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
      /** 0183: ผล "ได้รับเพิ่มแล้ว" — ส่วนใหม่ที่เกิดจากชิ้นที่มาถึง + ส่วนต่างที่ยังค้าง (ไม่มีน้ำหนักใดๆ) */
      arrived?: { qty: number; qtyRemaining: number; remainingDiscrepancyId: string | null; lot: { lotJobId: string; lotSeq: number; label: string; stageCode: string | null } };
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

export interface WorkerArriveDiscrepancyInput {
  /** ต้องมาจาก my_actions (action = arrive) ที่ DB ส่งมา — DB ตรวจว่าอยู่ในต้นไม้ของ token และผู้กดเป็นผู้รับของขั้นนั้น */
  discrepancyId: string;
  /** กี่ชิ้นที่ได้รับเพิ่ม (จำนวนเต็ม 1–100,000 · DB ตรวจไม่เกินส่วนต่างที่ค้าง) */
  qty: number | string;
  /** ทอง + ขั้นตั้งชั่ง (my_actions.weightRequired) = ต้องชั่งชิ้นที่มาถึง (กรัม > 0 ทศนิยมไม่เกิน 3) · อย่างอื่นห้ามส่ง */
  weightG?: number | string | null;
  /** จำนวนส่วนต่างที่ค้างตามที่เห็นบนจอ (my_actions.qty) — กดซ้ำ/หน้าจอเก่า → DB ตอบ stage_changed */
  expectedOpen?: number | string | null;
}

/** 0183 (มติ 20 ต.ค.): ผู้รับกด "ได้รับเพิ่มแล้ว" — ชิ้นที่มาถึงเป็นส่วนใหม่ที่ขั้นที่รับขาด (ผู้ถือ = คนกด) · ได้ไม่ครบ = ที่เหลือยังค้าง · ไม่แสดงน้ำหนัก/ส่วนที่ขาดให้ช่าง */
export async function arriveDiscrepancyWorker(token: string, input: WorkerArriveDiscrepancyInput): Promise<WorkerActionResult> {
  if (typeof input !== "object" || input === null || !isUuid(input.discrepancyId)) return bad("ข้อมูลไม่ถูกต้อง");
  const q = parsePieces(input.qty, "จำนวนที่ได้รับเพิ่ม");
  if (!q.ok) return bad(q.error);
  const w = parseWeight(input.weightG ?? null, "น้ำหนักชิ้นที่มาถึง");
  if (!w.ok) return bad(w.error);
  let expectedOpen: number | null = null;
  if (input.expectedOpen != null && input.expectedOpen !== "") {
    const e = parsePieces(input.expectedOpen, "จำนวนส่วนต่างที่ค้าง");
    if (!e.ok) return bad("โหลดหน้าใหม่แล้วลองอีกครั้ง (ข้อมูลส่วนต่างไม่ถูกต้อง)");
    expectedOpen = e.value;
  }
  const r = await workerArriveDiscrepancy(token, { discrepancyId: input.discrepancyId, qty: q.value, weightG: w.value, expectedOpen });
  return r.ok ? { ok: true, arrived: r.data } : { ok: false, error: r.error, code: r.code, retryAfterSeconds: r.retryAfterSeconds };
}

/** 0181 (ข3): ช่างยกเลิกส่วนที่ตัวเองแยกก่อนมีคนรับ (ชิ้นกลับขั้นแม่) */
export async function workerCancelLotAction(token: string, lotJobId: string, reason: string | null): Promise<WorkerActionResult> {
  if (!isUuid(lotJobId)) return bad("ส่วนที่เลือกไม่ถูกต้อง");
  const why = parseText(reason, "เหตุผล", 200, false);
  if (!why.ok) return bad(why.error);
  const r = await workerCancelLot(token, lotJobId, why.value);
  return r.ok ? { ok: true } : { ok: false, error: r.error, code: r.code, retryAfterSeconds: r.retryAfterSeconds };
}

// ---------------------------------------------------------------------------
// 0187 W1 — ผู้จัดการเปิดใบจากมือถือ (QR ร้าน /w/s/<token> + PIN · ไม่ login)
// ไฟล์นี้เป็น "use server" ไฟล์เดียวที่หน้า /w/ ใช้ได้ — ทุก action ตรวจชนิด/ช่วงก่อนถึง DB (ไม่ส่งค่าผิดรูปไปให้ RPC) แล้วส่งเฉพาะที่ระบุ
// 🔴 ไม่รับ shop id จาก client (ร้านมาจาก token ร้านที่ DB ตรวจ) · ไม่รับ stage/profile/ราคา/ต้นทุนจาก client เลย · ผลลัพธ์ผ่าน allowlist ใน worker-server
// ---------------------------------------------------------------------------

/** ช่องที่ผิด (ให้หน้าจอพา focus ไปช่องนั้น) */
export type IntakeField = "label" | "product" | "metal" | "purity" | "weight" | "qty" | "buffer" | "due" | "note" | "key" | "gems";
/** gem: (0191 W3) ผิดแถว/ช่องไหนของพลอย (code = รหัสของ GEM_ERROR_TH · row 1-based · field type/shape/size_a/size_b/qty_per_piece/position/…) · similar: ชื่อที่ DB ถามว่าคล้ายของเดิม (ส่งกลับพร้อม force ของชื่อที่ผู้ใช้ยืนยัน) */
export type IntakeActionFail = { ok: false; error: string; code?: string; retryAfterSeconds?: number; field?: IntakeField; gem?: GemFailInfo; similar?: GemSimilar[] };

const intakeBad = (error: string, field?: IntakeField): IntakeActionFail => (field ? { ok: false, error, field } : { ok: false, error });
/** แถวพลอยผิดรูปจาก allowlist ฝั่ง TS → IntakeActionFail (code ชั้นนอกตรงกับที่ DB ใช้ · รหัสเหตุผลจริงอยู่ใน gem.code · ชื่อ field ที่รูปร่างแปลกไม่สะท้อนกลับ) */
const GEM_FIELD_NAME_RE = /^[a-z][a-z_]{0,30}$/;
const gemWireFail = (error: string, gcode: string, field?: string | null, row?: number | null): IntakeActionFail => ({
  ok: false, error, code: gcode === "gem_lines_required" ? "gem_lines_required" : "gem_line_invalid", field: "gems",
  gem: { code: gcode, ...(row != null ? { row } : {}), ...(field && GEM_FIELD_NAME_RE.test(field) ? { field } : {}) },
});
const failOf = (r: WorkerFail): IntakeActionFail => ({ ok: false, error: r.error, code: r.code, retryAfterSeconds: r.retryAfterSeconds, ...(r.gem ? { gem: r.gem } : {}), ...(r.similar ? { similar: r.similar } : {}) });

/** ระบุตัวที่ QR ร้าน: ชื่อ + PIN → ตั้ง cookie session (cookie เดียวกับ QR ใบงาน: ล็อกอินทางไหนก็ใช้อีกทางได้) */
export async function intakeLogin(token: string, workerId: string, pin: string): Promise<WorkerActionResult> {
  if (!isUuid(workerId)) return bad(WORKER_CODE_TH.bad_credentials);
  const p = parsePin(pin);
  if (!p.ok) return bad(p.error);
  const r = await verifyIntakePin(token, workerId, p.value);
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

export type IntakeSearchResult = { ok: true; items: IntakeProduct[] } | IntakeActionFail;

/** ค้นสินค้า (เฉพาะผู้จัดการ) — คำค้น 1–60 ตัว · ว่าง = ผลว่าง ไม่ถึง DB */
export async function intakeSearch(token: string, q: string): Promise<IntakeSearchResult> {
  if (typeof q !== "string") return intakeBad("คำค้นไม่ถูกต้อง");
  const t = q.trim();
  if (t === "") return { ok: true, items: [] };
  // eslint-disable-next-line no-control-regex
  if (t.length > 60 || /[\u0000-\u001f\u007f<>]/.test(t) || INVISIBLE_RE.test(t)) return intakeBad("คำค้นไม่ถูกต้อง");
  const r = await searchIntakeProducts(token, t);
  return r.ok ? { ok: true, items: r.data } : failOf(r);
}

/** ข้อมูลจากฟอร์มหน้างาน — ทุกช่องเป็นข้อความ/ตัวเลขดิบจากผู้ใช้ (ยังไม่แปลงหน่วย) */
export interface IntakeOpenActionInput {
  /** คีย์กันกดซ้ำ (สร้างครั้งเดียวตอนเปิดฟอร์ม · ใช้ซ้ำตอนลองใหม่) */
  idemKey: string;
  /** มี SKU = ส่ง productId · ไม่มี SKU = ส่ง label (อย่างใดอย่างหนึ่ง) */
  productId?: string | null;
  label?: string | null;
  /** silver | gold | brass — สินค้าใหม่ต้องส่ง · มี SKU ส่งเมื่อแก้โลหะจากค่าของ SKU */
  metal?: string | null;
  /** เนื้อโลหะเป็น % ข้อความ เช่น "92.50" · ทองต้องกรอก · ทองเหลืองเว้นว่างหรือ 100 */
  purityPct?: string | null;
  /** น้ำหนักต่อชิ้น (กรัม) ไม่บังคับ */
  weight?: string | number | null;
  qty: number | string;
  /** เผื่อเพิ่มกี่ชิ้น (สวิตช์เผื่อของเสียเปิดอยู่) — ว่าง/ไม่ส่ง = ไม่เผื่อ */
  buffer?: number | string | null;
  /** YYYY-MM-DD ไม่บังคับ */
  dueDate?: string | null;
  isNewDesign?: boolean;
  note?: string | null;
  /**
   * 0191 W3 (S3): พลอยของใบ — 🔴 บังคับส่งเสมอ (ไม่ส่ง/null = ปฏิเสธที่ action · ไม่ถึง DB — ปิดทาง null ของ W1 เดิมที่ปล่อยใบไม่มีขั้นฝังโดยไม่มีใครตอบ)
   * "none" = ไม่มีพลอย (ไม่มีขั้นฝัง) · "template" = ตามแม่แบบ SKU (DB ปฏิเสธถ้า SKU ไม่มีแม่แบบ — gem_answer_required) · "has" = มีพลอย (ต้อง lines 1-30 แถว)
   * force = ชื่อที่ผู้ใช้ยืนยัน "ใช้ชื่อใหม่แม้คล้ายของเดิม" — ต้องมาจาก similar[] ที่ DB เพิ่งถาม (ชื่อที่ไม่ถูกถามไม่มีผล · boolean/รูปแปลก = ปฏิเสธ) · มีเฉพาะ "has"
   */
  gems: IntakeGemsInput;
}

export type IntakeGemsInput =
  | { answer: "none" }
  | { answer: "template" }
  | { answer: "has"; lines: GemLineInput[]; force?: GemForceItem[] | null };

/** gems ของฟอร์ม → พารามิเตอร์ที่ผ่าน allowlist (ผิดรูป = ไม่ถึง DB · ผิดเนื้อหา DB ตัดสินซ้ำ) */
function parseIntakeGems(raw: unknown, hasProduct: boolean): { ok: true; value: IntakeGemsParam } | IntakeActionFail {
  // gem_line_invalid = แถวผิด · gem_lines_required = has แต่ไม่มีแถว · รหัสเหตุผลจริงอยู่ใน gem.code (ตาราง GEM_ERROR_TH)
  const gfail = gemWireFail;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return intakeBad("ข้อมูลพลอยไม่ถูกต้อง — โหลดหน้าใหม่แล้วลองอีกครั้ง", "gems");
  const g = raw as Record<string, unknown>;
  const answer = g.answer;
  if (answer !== "none" && answer !== "template" && answer !== "has") return intakeBad("เลือกก่อนว่าใบนี้ฝังพลอยไหม", "gems");
  if (answer === "template") {
    if (!hasProduct) return intakeBad("สินค้านี้ยังไม่มีแม่แบบพลอย — เลือกก่อนว่าฝังพลอยหรือไม่ฝังพลอย", "gems");
    if (g.lines !== undefined && g.lines !== null) return intakeBad("ข้อมูลพลอยไม่ถูกต้อง — โหลดหน้าใหม่แล้วลองอีกครั้ง", "gems");
  }
  if (answer === "none" && g.lines !== undefined && g.lines !== null && !(Array.isArray(g.lines) && g.lines.length === 0)) return intakeBad("ตอบว่า \"ไม่มีพลอย\" แต่มีรายการพลอยมาด้วย — ตรวจแล้วลองอีกครั้ง", "gems");
  const force = toWireGemForce(g.force);
  if (!force.ok) return intakeBad(force.error, "gems");
  if (answer !== "has") {
    if (force.value !== null) return intakeBad("ข้อมูลพลอยไม่ถูกต้อง — โหลดหน้าใหม่แล้วลองอีกครั้ง", "gems");
    return { ok: true, value: { answer } };
  }
  const lines = toWireGemLines(g.lines);
  if (!lines.ok) return gfail(lines.error, lines.code, lines.field ?? undefined, lines.row ?? undefined);
  if (lines.value.length === 0) return gfail("เพิ่มพลอยอย่างน้อย 1 รายการ หรือเลือก \"ไม่มีพลอย\"", "gem_lines_required");
  return { ok: true, value: { answer: "has", lines: lines.value, force: force.value } };
}

export type IntakeOpenActionResult = { ok: true; result: IntakeOpenResult } | IntakeActionFail;


/**
 * เปิดใบผลิต + ใบงาน + QR ใบงาน (ครั้งเดียว) — DB ทำทั้งก้อนในทรานแซกชันเดียว
 * ผลสำเร็จมี token ดิบ "ครั้งเดียว" (already=true = กดซ้ำ ไม่มี token) · ฟอร์มและค่าที่กรอกไม่หายทุกกรณี (หน้าจอเก็บเอง)
 */
export async function intakeOpen(token: string, input: IntakeOpenActionInput): Promise<IntakeOpenActionResult> {
  if (typeof input !== "object" || input === null) return intakeBad("ข้อมูลไม่ถูกต้อง");
  if (typeof input.idemKey !== "string" || !IDEM_RE.test(input.idemKey)) return intakeBad("ข้อมูลไม่ครบ — โหลดหน้าใหม่แล้วลองอีกครั้ง", "key");
  const hasProduct = input.productId !== null && input.productId !== undefined && input.productId !== "";
  const hasLabel = input.label !== null && input.label !== undefined && String(input.label).trim() !== "";
  if (hasProduct === hasLabel) return intakeBad("ต้องเลือกสินค้า หรือพิมพ์ชื่อแบบอย่างใดอย่างหนึ่ง", hasProduct ? "product" : "label");
  if (hasProduct && !isUuid(input.productId)) return intakeBad("เลือกสินค้าไม่ถูกต้อง", "product");
  let label: string | null = null;
  if (hasLabel) {
    // ชื่อบรรทัดเดียว: ขึ้นบรรทัดใหม่/แท็บ = ปฏิเสธ (parseText ยุบเป็นช่องว่างเงียบๆ — DB ปฏิเสธเหมือนกัน ไม่ให้สองชั้นตีความต่างกัน)
    if (typeof input.label === "string" && /[\r\n\t]/.test(input.label)) return intakeBad("ชื่อแบบห้ามขึ้นบรรทัดใหม่หรือแท็บ", "label");
    const l = parseLabel(input.label, "ชื่อแบบ", 200, true);
    if (!l.ok) return intakeBad(l.error, "label");
    label = l.value;
  }
  let metal: IntakeMetal | null = null;
  if (input.metal !== null && input.metal !== undefined && input.metal !== "") {
    if (input.metal !== "silver" && input.metal !== "gold" && input.metal !== "brass") return intakeBad("เลือกวัสดุเป็นเงิน ทอง หรือทองเหลือง", "metal");
    metal = input.metal;
  }
  if (!hasProduct && metal === null) return intakeBad("สินค้าใหม่ต้องเลือกวัสดุ", "metal");
  // เนื้อ: ทองบังคับ (ไม่มีค่าเริ่ม) · เงินว่างได้ (DB ใช้ 92.50) · ทองเหลืองล็อก 100 (ว่างหรือ 100 เท่านั้น) — DB เป็นด่านจริง ที่นี่กันก่อนถึง DB
  const pctText = typeof input.purityPct === "string" ? input.purityPct.trim() : input.purityPct === null || input.purityPct === undefined ? "" : null;
  if (pctText === null) return intakeBad("เนื้อโลหะไม่ถูกต้อง", "purity");
  let purity: number | null = null;
  if (metal === "gold" && pctText === "") return intakeBad("ทองต้องใส่เนื้อทอง (ขั้นต่ำ 37.50%)", "purity");
  if (metal === "brass") {
    if (pctText !== "" && purityPctToFraction(pctText) !== 1) return intakeBad("ทองเหลืองเนื้อ 100% (ไม่ต้องกรอก)", "purity");
  } else if (pctText !== "") {
    const issue = purityPctIssue(pctText);
    const frac = purityPctToFraction(pctText);
    if (issue !== null || frac === null) return intakeBad(issue ?? "เนื้อโลหะไม่ถูกต้อง", "purity");
    purity = frac;
  }
  const w = parseWeight(input.weight ?? null, "น้ำหนักต่อชิ้น", { max: TARGET_PIECE_MAX_G });
  if (!w.ok) return intakeBad(w.error, "weight");
  const q = parseQtyText(input.qty);
  if (!q.ok) return intakeBad(q.error, "qty");
  let planned: number | null = null;
  if (input.buffer !== null && input.buffer !== undefined && input.buffer !== "") {
    const b = parseBufferText(input.buffer, q.value);
    if (!b.ok) return intakeBad(b.error, "buffer");
    planned = b.value > 0 ? q.value + b.value : null;
  }
  let due: string | null = null;
  if (input.dueDate !== null && input.dueDate !== undefined && input.dueDate !== "") {
    const d = parseDate(input.dueDate, "กำหนดเสร็จ");
    if (!d.ok) return intakeBad(d.error, "due");
    due = d.value;
  }
  let note: string | null = null;
  if (input.note !== null && input.note !== undefined) {
    if (typeof input.note === "string" && INVISIBLE_RE.test(input.note)) return intakeBad("หมายเหตุมีอักขระที่มองไม่เห็นหรืออักขระควบคุมทิศทาง", "note");
    if (typeof input.note === "string" && /[\r\n\t]/.test(input.note)) return intakeBad("หมายเหตุห้ามขึ้นบรรทัดใหม่หรือแท็บ", "note");
    const n = parseText(input.note, "หมายเหตุ", 500, false);
    if (!n.ok) return intakeBad(n.error, "note");
    note = n.value;
  }
  // 0191 W3 (S3): พลอย "บังคับ" — ไม่ส่ง/null/ผิดรูป = ปฏิเสธที่นี่ (ไม่ส่ง null ไป DB: ทางนั้นเปิดใบได้โดยไม่มีใครตอบว่าฝังพลอยไหม) · ผิด = กลับ W-4 (field "gems" + gem.row/gem.field)
  if (input.gems === undefined || input.gems === null) return intakeBad("เลือกก่อนว่าใบนี้ฝังพลอยไหม", "gems");
  const g = parseIntakeGems(input.gems, hasProduct);
  if (!g.ok) return g;
  const r = await openIntakeJob(token, {
    idemKey: input.idemKey, productId: hasProduct ? (input.productId as string) : null, pendingLabel: label, metal, purity, weightG: w.value,
    qtyOrder: q.value, qtyPlanned: planned, dueDate: due, isNewDesign: input.isNewDesign === true, note, gems: g.value,
  });
  return r.ok ? { ok: true, result: r.data } : failOf(r);
}

// ---------------------------------------------------------------------------
// 0189 W2 — ผู้จัดการแนบรูปสั่งงานจากหน้างาน (QR ร้าน + PIN · ไม่ login) · ≤ 3 รูป/ใบ · เพิ่ม/ลบของตัวเองได้จนช่างเริ่มรับงาน
// 🔴 ด่านจริงทั้งหมดอยู่ที่ DB (RPC job_worker_photo_*) — action นี้ตรวจรูปร่าง input ก่อนถึง DB แล้วให้ lib/jobs/shop-photo-server ทำตามลำดับ "ผ่าน DB ก่อนแตะ bucket"
// 🔴 ไม่รับ shop id / path / ที่มา / ชื่อไฟล์ จาก client — มีแค่ idemKey หรือ jobId (DB ตรวจว่าเป็นใบที่ช่างใน session เปิดเอง) + ไฟล์ md/sm
// ---------------------------------------------------------------------------

const photoRef = (idemKey: unknown, jobId: unknown): IntakeJobRef | null => {
  const hasIdem = idemKey !== null && idemKey !== undefined && idemKey !== "";
  const hasJob = jobId !== null && jobId !== undefined && jobId !== "";
  if (hasIdem === hasJob) return null; // อย่างใดอย่างหนึ่งเท่านั้น
  if (hasIdem) return typeof idemKey === "string" && IDEM_RE.test(idemKey) ? { idemKey } : null;
  return typeof jobId === "string" && isUuid(jobId) ? { jobId } : null;
};

export type IntakePhotoUploadActionResult = ({ ok: true } & IntakeUploadResult) | IntakeActionFail;

/**
 * แนบรูป 1 รูป — FormData { idemKey | jobId, md: File, sm: File, isPrimary?: "true" } (client ย่อ+re-encode เป็น JPEG ด้วย lib/images/client มาแล้ว แต่ server ไม่เชื่อ: ตรวจ bytes + ตัด Exif ซ้ำ)
 * อัปโหลดทีละรูป (เน็ตสะดุดเสียแค่รูปเดียว) · ผลคือ signed URL 15 นาที — ไม่มี path
 */
export async function intakeUploadPhoto(token: string, fd: FormData): Promise<IntakePhotoUploadActionResult> {
  if (!(fd instanceof FormData)) return intakeBad("ข้อมูลไม่ถูกต้อง");
  const ref = photoRef(fd.get("idemKey"), fd.get("jobId"));
  if (!ref) return intakeBad("ข้อมูลไม่ครบ — โหลดหน้าใหม่แล้วลองอีกครั้ง", "key");
  const md = fd.get("md");
  const sm = fd.get("sm");
  if (!(md instanceof File) || !(sm instanceof File)) return { ok: false, error: JOB_PHOTO_FILE_ERROR_TH.missing, code: JOB_PHOTO_FILE_CODE.missing };
  const prim = fd.get("isPrimary");
  // clientPhotoKey (ไม่บังคับ): uuid ต่อรูปจาก client — สร้างตอนเลือกรูป ใช้ซ้ำตอน "ลองใหม่" เสมอ · key เดิม = คืนรูปเดิม (result.already) ไม่สร้างซ้ำ ไม่อัปซ้ำ
  const rawKey = fd.get("clientPhotoKey");
  let clientKey: string | null = null;
  if (rawKey !== null && rawKey !== "") {
    if (typeof rawKey !== "string" || !isUuid(rawKey)) return intakeBad("ข้อมูลไม่ครบ — โหลดหน้าใหม่แล้วลองอีกครั้ง", "key");
    clientKey = rawKey.toLowerCase();
  }
  const r = await uploadIntakePhoto(token, { ref, md, sm, isPrimary: prim === "true" || prim === "1", clientKey });
  return r.ok ? { ok: true, ...r.data } : failOf(r);
}

export type IntakeSetPrimaryActionResult = { ok: true; changed: boolean } | IntakeActionFail;

/**
 * ตั้งรูป (ของตัวเอง) เป็นรูปหลักหลังส่งแล้ว — อ้างใบด้วย idemKey หรือ jobId อย่างใดอย่างหนึ่ง (DB ตรวจว่าเป็นใบ/รูปของช่างใน session · ยังไม่มีขั้นถูกรับ)
 * สลับได้เฉพาะเมื่อรูปหลักปัจจุบันเป็นรูปหน้างานหรือยังไม่มีรูปหลัก — รูปหลักที่ออฟฟิศ/แคตตาล็อกตั้ง = code primary_locked · เป็นหลักอยู่แล้ว = ok changed:false
 */
export async function intakeSetPrimaryPhoto(token: string, input: { idemKey?: string | null; jobId?: string | null; photoId: string }): Promise<IntakeSetPrimaryActionResult> {
  if (typeof input !== "object" || input === null || typeof input.photoId !== "string" || !isUuid(input.photoId)) return intakeBad("ข้อมูลไม่ถูกต้อง");
  const ref = photoRef(input.idemKey, input.jobId);
  if (!ref) return intakeBad("ข้อมูลไม่ครบ — โหลดหน้าใหม่แล้วลองอีกครั้ง", "key");
  const r = await setPrimaryIntakePhoto(token, ref, input.photoId);
  return r.ok ? { ok: true, changed: r.data.changed } : failOf(r);
}

export type IntakePhotoRemoveActionResult = { ok: true; promotedPhotoId: string | null; already: boolean } | IntakeActionFail;

/** ลบรูปของตัวเอง (ได้จนช่างเริ่มรับงาน) — ลบซ้ำ = สำเร็จ (already) */
export async function intakeRemovePhoto(token: string, photoId: string): Promise<IntakePhotoRemoveActionResult> {
  if (typeof photoId !== "string" || !isUuid(photoId)) return intakeBad("ข้อมูลไม่ถูกต้อง");
  const r = await removeIntakePhoto(token, photoId);
  return r.ok ? { ok: true, ...r.data } : failOf(r);
}

export type IntakePhotoListActionResult = ({ ok: true } & IntakePhotoList) | IntakeActionFail;

/** รูปของใบ (อ้างด้วย idemKey หรือ jobId อย่างใดอย่างหนึ่ง) — สำหรับหน้าจอ "รูปที่แนบแล้ว" */
export async function intakeListPhotos(token: string, ref: { idemKey?: string | null; jobId?: string | null }): Promise<IntakePhotoListActionResult> {
  if (typeof ref !== "object" || ref === null) return intakeBad("ข้อมูลไม่ถูกต้อง");
  const rr = photoRef(ref.idemKey, ref.jobId);
  if (!rr) return intakeBad("ข้อมูลไม่ครบ — โหลดหน้าใหม่แล้วลองอีกครั้ง", "key");
  const r = await listIntakePhotos(token, rr);
  return r.ok ? { ok: true, ...r.data } : failOf(r);
}

export type IntakeReissueActionResult = ({ ok: true } & IntakeReissueResult) | IntakeActionFail;

/**
 * "ออก QR ใหม่" ของใบที่ฉันเปิดเอง (DB ตรวจเจ้าของ/สถานะ/เพดาน 5 ใบ) — คืน QR ดิบครั้งเดียวให้หน้าจอวาด (ห้าม log/เก็บ) · QR เดิมยังใช้ได้ (ไม่เพิกถอน)
 */
export async function intakeReissueToken(token: string, jobId: string, idemKey?: string | null): Promise<IntakeReissueActionResult> {
  if (typeof jobId !== "string" || !isUuid(jobId)) return intakeBad("ข้อมูลไม่ถูกต้อง");
  // idemKey (ไม่บังคับ · 16–64 ตัว [A-Za-z0-9_-]): key เดิมภายใน 10–20 นาที = ไม่ออกใหม่ → result.already = true และไม่มี token (DB ไม่เก็บ QR ดิบ) ·
  // หน้าจอบอก "ออกไปแล้ว ถ้าไม่เห็น QR ให้กดออกใหม่อีกครั้ง" แล้วกดใหม่ด้วย key ใหม่
  if (idemKey !== null && idemKey !== undefined && (typeof idemKey !== "string" || !IDEM_RE.test(idemKey))) return intakeBad("ข้อมูลไม่ครบ — โหลดหน้าใหม่แล้วลองอีกครั้ง", "key");
  const r = await reissueIntakeToken(token, jobId, idemKey ?? undefined);
  return r.ok ? { ok: true, ...r.data } : failOf(r);
}

export type IntakeMyJobsActionResult =({ ok: true } & MyIntakeList) | IntakeActionFail;

/** "ใบที่ฉันเปิด" บน hub QR ร้าน — ใบที่ยังไม่ปิด/ไม่ยกเลิก ภายใน 14 วัน ≤ 20 ใบ (เฉพาะของช่างใน session · DB กรอง) */
export async function intakeMyJobs(token: string): Promise<IntakeMyJobsActionResult> {
  const r = await listMyIntakeJobs(token);
  return r.ok ? { ok: true, ...r.data } : failOf(r);
}

// ---------------------------------------------------------------------------
// 0191 W3 — ผู้จัดการกรอก/แก้พลอยจากมือถือ (QR ร้าน + PIN · ไม่ login)
// 🔴 ด่านจริงทั้งหมดอยู่ที่ DB (RPC job_worker_gem_*: ผู้เปิดใบ · ขั้นแรกยังไม่รับ · ใบ open · มีขั้นฝัง · CAS · ตัวดักชื่อคล้าย · rate limit) — action นี้ตรวจรูปร่าง input ก่อนถึง DB เท่านั้น
// 🔴 ไม่รับ shop id จาก client · ไม่มีราคา/ต้นทุน/เผื่อแตกในอินพุตและผลลัพธ์ (type ไม่มี field ราคา) · แถวพลอยผ่าน allowlist เดียวกับออฟฟิศ (toWireGemLines — key แปลกเช่น price = ปฏิเสธ ไม่ทิ้งเงียบ)
// ---------------------------------------------------------------------------

export type IntakeGemCatalogActionResult = ({ ok: true } & IntakeGemCatalog) | IntakeActionFail;

/**
 * ชนิด/รูปทรงที่ใช้ได้ + ขนาดที่เคยใช้ (≤ 6 ต่อคู่) + แม่แบบพลอยของ SKU (ส่ง productId) — เรียกตอนเข้า W-4 และตอนเลือก/เปลี่ยน SKU
 * SKU ที่ DB ไม่ให้ใช้ (ร้านอื่น/ปิดใช้/live (ขึ้นต้น live)/ไม่พบ) = hasTemplate false เหมือนไม่มีแม่แบบ (ไม่เปิดเผยว่ามี SKU นั้น)
 */
export async function intakeGemCatalog(token: string, productId?: string | null): Promise<IntakeGemCatalogActionResult> {
  if (productId !== undefined && productId !== null && productId !== "" && !isUuid(productId)) return intakeBad("เลือกสินค้าไม่ถูกต้อง", "product");
  const r = await loadIntakeGemCatalog(token, productId ? productId : null);
  return r.ok ? { ok: true, ...r.data } : failOf(r);
}

export type IntakeJobGemsActionResult = ({ ok: true } & IntakeJobGems) | IntakeActionFail;

/** พลอยของใบที่ฉันเปิด (W-10) + แก้ได้ไหม (editable/lockCode) + rev สำหรับบันทึก — ใบคนอื่น/ออฟฟิศ/ส่วนย่อย = order_not_found จาก DB */
export async function intakeJobGems(token: string, jobId: string): Promise<IntakeJobGemsActionResult> {
  if (typeof jobId !== "string" || !isUuid(jobId)) return intakeBad("ข้อมูลไม่ถูกต้อง");
  const r = await loadIntakeJobGems(token, jobId);
  return r.ok ? { ok: true, ...r.data } : failOf(r);
}

export interface IntakeSetJobGemsInput {
  jobId: string;
  /** แถวพลอยทั้งชุด (แถวเดิมส่ง gemItemId + qtyPerPiece + position · แถวใหม่ส่งชนิด/รูปทรง/ขนาด) — [] = ล้างพลอย (ใบยังมีขั้นฝัง = state unspecified) */
  lines: GemLineInput[];
  /** rev จาก intakeJobGems (กัน 2 เครื่องทับกัน — เปลี่ยนไปแล้ว = code gem_conflict) */
  expectedRev: string;
  /** ชื่อที่ผู้ใช้ยืนยันหลัง DB ถามว่าคล้าย (similar[] ของคำขอก่อน) */
  force?: GemForceItem[] | null;
}

export type IntakeSetJobGemsActionResult = ({ ok: true } & IntakeGemSetResult) | IntakeActionFail;

/**
 * แก้พลอยทั้งชุดครั้งเดียว (all-or-nothing) จนช่างเริ่มรับงาน — ผิดแถวใด = ไม่เขียนอะไร (gem.row/gem.field) · ชื่อคล้าย = code gem_similar + similar[] (ไม่เขียน — ส่งซ้ำพร้อม force)
 * ล็อก = job_locked/job_cancelled/job_closed/job_not_open/no_gem_stage · ใบไม่ใช่ของฉัน = order_not_found · เครื่องอื่นแก้ไปก่อน = gem_conflict (โหลดใหม่)
 */
export async function intakeSetJobGems(token: string, input: IntakeSetJobGemsInput): Promise<IntakeSetJobGemsActionResult> {
  if (typeof input !== "object" || input === null) return intakeBad("ข้อมูลไม่ถูกต้อง");
  if (typeof input.jobId !== "string" || !isUuid(input.jobId)) return intakeBad("ข้อมูลไม่ถูกต้อง");
  if (typeof input.expectedRev !== "string" || !/^([0-9a-f]{32}|empty)$/.test(input.expectedRev)) return intakeBad("ข้อมูลพลอยของใบนี้เปลี่ยนไป — โหลดหน้าใหม่แล้วลองอีกครั้ง", "key");
  const lines = toWireGemLines(input.lines);
  if (!lines.ok) return gemWireFail(lines.error, lines.code, lines.field, lines.row);
  const force = toWireGemForce(input.force);
  if (!force.ok) return intakeBad(force.error, "gems");
  const r = await setIntakeJobGems(token, { jobId: input.jobId, lines: lines.value, expectedRev: input.expectedRev, force: force.value });
  return r.ok ? { ok: true, ...r.data } : failOf(r);
}
