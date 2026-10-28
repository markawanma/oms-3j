// lib/jobs/shop-photo-server.ts — ผู้จัดการแนบรูปสั่งงานจากหน้างาน (W2 · 0189) · QR ร้าน /w/s/<token> + PIN · ช่องสาธารณะที่ "เขียน storage" · server-only · ไม่ใช่ "use server"
// ใช้โดย lib/actions/job-worker.ts เท่านั้น (intakeUploadPhoto · intakeRemovePhoto · intakeListPhotos · intakeMyJobs)
//
// 🔴 ลำดับด่านของการอัปโหลด (ห้ามสลับ — ทุกข้อ "ก่อนแตะ bucket"):
//    1) ตรวจ metadata ไฟล์ (ขนาด/ว่าง) → ไม่ถึง DB  2) job_worker_photo_begin: token ร้าน + session + can_open_job สด + ใบที่ช่างคนนี้เปิดเอง + ยังไม่มีขั้นถูกรับ + เพดาน + rate limit
//    3) ตรวจ bytes ที่ server เอง: JPEG จริง (magic) → ตัด Exif/XMP ระดับ marker → ตรวจซ้ำ → อ่านมิติ → เพดานพิกเซล  4) อัปโหลด md+sm (uuid จาก DB · shop/job จาก DB)  5) job_worker_photo_add (ตรวจทุกด่านซ้ำใต้ล็อกแถวใบ)
//    add ล้ม/ผลกำกวม = ลบ object ที่เพิ่งอัป (ผลกำกวม = ถาม list ก่อนว่าแถวเกิดไหม — เกิดแล้วห้ามลบ ไม่งั้นแถวชี้ไฟล์ที่ไม่มี)
// 🔴 ไม่รับ shop id / path / ที่มา จาก client เลย · path ที่ประกอบจาก uuid ของ DB ไม่ออกจากไฟล์นี้ — ออกเฉพาะ signed URL 15 นาที (IntakePhoto) · ผลดิบของ RPC ผ่าน intakeClean (key เงิน/ต้นทุน/ลูกค้า = ทิ้ง)
// 🔴 lib/images/server (ตัด Exif) โหลดด้วย dynamic import ในจุดที่ใช้จริงเท่านั้น: กราฟ static ของหน้า /w/s/ ต้องไม่ลากมันเข้ามา (worker-boundary.shop.test) — โค้ดนี้รันฝั่ง server เสมอ
// log เฉพาะ label + รหัส (logJobFailure) — ไม่ log path/URL/ชื่อไฟล์/พารามิเตอร์ (มี hash ของ token/session)

import "server-only";
import { JOB_PHOTO_DIM_SLACK_PX, MAX_BYTES, MAX_SHOPFLOOR_PHOTOS, MD_MAX_PX, SM_MAX_PX } from "@/lib/images/constants";
import { deleteJobPhotoObjects, uploadJobPhotoPair } from "@/lib/images/job-photo-storage";
import { signJobPhotoPaths } from "@/lib/images/signing";
import { IDEM_KEY_RE as IDEM_RE, isUuid } from "@/lib/jobs/input";
import { logJobFailure } from "@/lib/jobs/log";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";
import { JOB_PHOTO_FILE_CODE, JOB_PHOTO_FILE_ERROR_TH, JOB_PHOTO_PATH_RE } from "@/lib/jobs/photos";
import { callWorkerRpc, fail, finite, intakeClean, intakeFail, isFail, parseGemState, readCaller } from "@/lib/jobs/worker-server";
import type { Caller, GemState, WorkerFail, WorkerOk } from "@/lib/jobs/worker-server";
import { getServiceClient } from "@/lib/supabase/server";

/** รูปที่ถึง client: signed URL (15 นาที) + สถานะเท่านั้น — ไม่มี path/id ของใบ/ชื่อไฟล์ */
export interface IntakePhoto {
  id: string;
  smUrl: string | null;
  mdUrl: string | null;
  isPrimary: boolean;
  /** รูปที่ช่างคนนี้แนบเอง (ลบได้ถ้าใบยังไม่ล็อก) — รูปจากออฟฟิศ/แคตตาล็อก = false */
  mine: boolean;
}

export interface IntakeUploadResult {
  /** true = clientPhotoKey เดิมเคยแนบสำเร็จแล้ว — คืนรูปเดิม ไม่สร้าง/ไม่อัปซ้ำ */
  already?: boolean;
  photo: IntakePhoto;
  /** รูปจากหน้างานของใบนี้หลังเพิ่ม */
  count: number;
  max: number;
}

export interface IntakePhotoList {
  photos: IntakePhoto[];
  /** รูปจากหน้างานของใบ (ไม่นับรูปออฟฟิศ) */
  count: number;
  max: number;
  /** true = ช่างเริ่มรับงาน/ใบถูกยกเลิก/ไม่อยู่สถานะ open — เพิ่ม/ลบไม่ได้แล้ว */
  locked: boolean;
  lockCode: string | null;
}

export interface MyIntakeJob {
  /** ใช้อ้างใบตอนแนบ/ลบรูป (DB ตรวจซ้ำว่าเป็นใบที่ช่างคนนี้เปิดเอง) */
  jobId: string;
  orderNo: string;
  jobNo: string;
  designLabel: string;
  metal: "silver" | "gold" | "brass" | null;
  qty: number;
  createdAt: string;
  status: string;
  photosCount: number;
  myPhotosCount: number;
  editable: boolean;
  /** 0191 W3 (W-9): บรรทัดพลอยของใบ — specified = มีรายการ · unspecified = มีขั้นฝังแต่ยังไม่มีรายการ (⚑ amber) · not_needed = ไม่มีพลอย · null = DB รุ่นก่อน 0191 (ไม่ส่งมา) · ไม่มีราคา */
  gemState: GemState | null;
  gemCount: number;
  /** รวมเม็ดทั้งใบ = จำนวน/ชิ้น x จำนวนที่เริ่มผลิต (DB คำนวณ) */
  gemPieces: number;
  /** แก้พลอยได้ตอนนี้ (ตัดสินที่ DB เดียวกับ job_worker_gem_set — แยกจาก editable ของรูป) */
  gemEditable: boolean;
}

export interface MyIntakeList {
  openAllowed: boolean;
  jobs: MyIntakeJob[];
  maxPhotos: number;
}

/** อ้างใบ: idem key (เพิ่งเปิดใบในเซสชันนี้) หรือ job id (จากรายการ "ใบที่ฉันเปิด") — อย่างใดอย่างหนึ่ง */
export type IntakeJobRef = { idemKey: string } | { jobId: string };


/** ข้อความของ code ที่ RPC แนบรูปคืน (ไทยล้วน ไม่มีตัวเลขภายใน) — ทับข้อความตาราง/DB เพื่อให้คงที่ */
const PHOTO_CODE_TH: Record<string, string> = {
  order_not_found: "ไม่พบใบงานที่เปิดไว้ — โหลดหน้าใหม่แล้วลองอีกครั้ง",
  idem_invalid: "ข้อมูลไม่ครบ — โหลดหน้าใหม่แล้วลองอีกครั้ง",
  not_allowed: "บัญชีนี้ไม่มีสิทธิ์จัดการใบงานจากหน้างาน — แจ้งออฟฟิศ",
  job_cancelled: "ใบนี้ถูกยกเลิกแล้ว — แนบหรือลบรูปไม่ได้",
  job_locked: "ช่างเริ่มรับงานแล้ว — เพิ่มหรือลบรูปไม่ได้ ถ้าต้องแก้ แจ้งออฟฟิศ",
  job_not_open: "ใบนี้ไม่อยู่ในสถานะที่แนบรูปได้ — แจ้งออฟฟิศ",
  photo_cap_shopfloor: `แนบรูปจากหน้างานได้สูงสุด ${MAX_SHOPFLOOR_PHOTOS} รูปต่อใบ — ลบรูปเก่าก่อนเพิ่ม`,
  photo_cap_ref: "ใบนี้มีรูปอ้างอิงครบ 5 รูปแล้ว — แจ้งออฟฟิศ",
  photo_cap_total: "ใบนี้มีรูปครบกำหนดแล้ว — แจ้งออฟฟิศ",
  photo_budget: "พื้นที่เก็บรูปของร้านเต็มแล้ว — แจ้งออฟฟิศ",
  photo_budget_shopfloor: "พื้นที่รูปจากหน้างานเต็มแล้ว — แจ้งออฟฟิศ",
  photo_daily_cap: "วันนี้แนบรูปครบกำหนดแล้ว",
  photo_not_found: "ไม่พบรูปนี้ — โหลดหน้าใหม่",
  already_deleted: "รูปนี้ถูกลบไปแล้ว — โหลดหน้าใหม่",
  photo_path_invalid: "บันทึกรูปไม่สำเร็จ ลองใหม่อีกครั้ง",
  photo_path_dup: "รูปนี้ถูกบันทึกไปแล้ว — โหลดหน้าใหม่",
  photo_bytes_invalid: "ไฟล์รูปไม่ถูกต้อง (ใหญ่เกินกำหนดหรือว่างเปล่า)",
  photo_dims_invalid: "ขนาดภาพไม่ถูกต้อง ลองถ่ายรูปใหม่",
  photo_conflict: "รูปหลักของใบเปลี่ยนไปพร้อมกัน — ลองอีกครั้ง",
  photo_key_used: "รูปนี้ถูกใช้ไปแล้ว — เลือกรูปใหม่",
  primary_locked: "รูปหลักตั้งโดยออฟฟิศแล้ว — เปลี่ยนไม่ได้ ถ้าต้องแก้ แจ้งออฟฟิศ",
  job_closed: "ใบนี้ปิดแล้ว — ออก QR ใหม่ไม่ได้",
  token_cap: "ใบนี้มี QR ที่ใช้งานอยู่ครบ 5 ใบแล้ว — แจ้งออฟฟิศให้เพิกถอนก่อน",
  token_not_issued: "ออก QR ไม่ได้ตอนนี้ — แจ้งออฟฟิศ",
};

/** ผลล้มของ RPC → ข้อความไทยของทางแนบรูป (ตาราง QR ร้านก่อน แล้วตารางรูป) */
function photoFail(f: WorkerFail): WorkerFail {
  const base = intakeFail(f);
  if (Object.prototype.hasOwnProperty.call(PHOTO_CODE_TH, f.code)) return { ...base, error: PHOTO_CODE_TH[f.code] };
  return base;
}

// ส่งทั้งสองคีย์เสมอ (อีกคีย์ = null): p_idem_key ของ add ไม่มีค่าเริ่ม — ละทิ้งไว้ PostgREST จะหาฟังก์ชันไม่เจอ · DB บังคับ "อย่างใดอย่างหนึ่งเท่านั้น" (num_nonnulls = 1)
const refParams = (ref: IntakeJobRef): Record<string, unknown> => ("idemKey" in ref ? { p_idem_key: ref.idemKey, p_job_id: null } : { p_idem_key: null, p_job_id: ref.jobId });
const refValid = (ref: IntakeJobRef): boolean =>
  typeof ref === "object" && ref !== null && ("idemKey" in ref ? typeof ref.idemKey === "string" && IDEM_RE.test(ref.idemKey) : typeof ref.jobId === "string" && isUuid(ref.jobId));

const lc = (v: unknown): string | null => (typeof v === "string" && v === v.toLowerCase() && isUuid(v) ? v : null);
const intOr0 = (v: unknown): number => {
  const n = finite(v);
  return n !== null && Number.isInteger(n) && n >= 0 && n <= 1000 ? n : 0;
};

/** ตัวเรียก RPC ที่ต้องมี token + session (ไม่มี = ไม่ส่งไป DB เลย) */
async function authed(token: unknown): Promise<{ c: Caller & { tokenHash: string; sessionHash: string } } | { f: WorkerFail }> {
  const c = await readCaller(token);
  if (!c.tokenHash) return { f: intakeFail(fail("invalid_token")) };
  if (!c.sessionHash) return { f: intakeFail(fail("session_required")) };
  return { c: { ...c, tokenHash: c.tokenHash, sessionHash: c.sessionHash } };
}

// ---------------------------------------------------------------------------
// รายการรูปของใบ
// ---------------------------------------------------------------------------

async function signPhotoItems(items: unknown[]): Promise<IntakePhoto[]> {
  const rows = items.slice(0, 20).flatMap((x) => {
    if (typeof x !== "object" || x === null || Array.isArray(x)) return [];
    const o = x as Record<string, unknown>;
    const id = lc(o.id);
    return id ? [{ id, md: typeof o.md_path === "string" && JOB_PHOTO_PATH_RE.test(o.md_path) ? o.md_path : null, sm: typeof o.sm_path === "string" && JOB_PHOTO_PATH_RE.test(o.sm_path) ? o.sm_path : null, primary: o.is_primary === true, mine: o.mine === true }] : [];
  });
  const paths = rows.flatMap((r) => [r.md, r.sm]).filter((p): p is string => p !== null);
  const signed = paths.length > 0 ? await signJobPhotoPaths(getServiceClient(), paths) : new Map<string, string>();
  return rows.map((r) => {
    const md = r.md ? (signed.get(r.md) ?? null) : null;
    const sm = r.sm ? (signed.get(r.sm) ?? null) : null;
    return { id: r.id, smUrl: sm ?? md, mdUrl: md ?? sm, isPrimary: r.primary, mine: r.mine };
  });
}

/** รูป active ของใบที่ช่างคนนี้เปิดเอง (ให้หน้าจอรู้ว่าแนบไปกี่รูป/รูปไหนลบได้) */
export async function listIntakePhotos(token: unknown, ref: IntakeJobRef): Promise<WorkerOk<IntakePhotoList> | WorkerFail> {
  if (!refValid(ref)) return photoFail(fail("idem_invalid"));
  const a = await authed(token);
  if ("f" in a) return a.f;
  const r = await callWorkerRpc("job_worker_photo_list", { p_token_hash: a.c.tokenHash, p_session_hash: a.c.sessionHash, p_ip_hash: a.c.ipHash, ...refParams(ref) });
  if (isFail(r)) return photoFail(r);
  const bad = intakeClean(r, "job_worker_photo_list");
  if (bad) return bad;
  const photos = await signPhotoItems(Array.isArray(r.photos) ? r.photos : []);
  return { ok: true, data: { photos, count: intOr0(r.count), max: MAX_SHOPFLOOR_PHOTOS, locked: r.locked === true, lockCode: typeof r.lock_code === "string" ? r.lock_code.slice(0, 40) : null } };
}

const METALS = ["silver", "gold", "brass"] as const;

/** "ใบที่ฉันเปิด" บน hub — เฉพาะใบของช่างใน session (DB กรอง) · ผ่านรูปร่าง allowlist ทีละ field */
export async function listMyIntakeJobs(token: unknown): Promise<WorkerOk<MyIntakeList> | WorkerFail> {
  const a = await authed(token);
  if ("f" in a) return a.f;
  const r = await callWorkerRpc("job_worker_my_intake_list", { p_token_hash: a.c.tokenHash, p_session_hash: a.c.sessionHash, p_ip_hash: a.c.ipHash });
  if (isFail(r)) return photoFail(r);
  const bad = intakeClean(r, "job_worker_my_intake_list");
  if (bad) return bad;
  const jobs = (Array.isArray(r.jobs) ? r.jobs.slice(0, 20) : []).flatMap((x): MyIntakeJob[] => {
    if (typeof x !== "object" || x === null || Array.isArray(x)) return [];
    const o = x as Record<string, unknown>;
    const jobId = lc(o.job_id);
    const orderNo = typeof o.order_no === "string" ? o.order_no.slice(0, 30) : "";
    const jobNo = typeof o.job_no === "string" ? o.job_no.slice(0, 30) : "";
    const label = typeof o.design_label === "string" ? o.design_label.slice(0, 200) : "";
    const createdAt = typeof o.created_at === "string" ? o.created_at.slice(0, 40) : "";
    const status = typeof o.status === "string" ? o.status.slice(0, 20) : "";
    if (!jobId || !jobNo || !label || !status) return [];
    const metal = typeof o.metal === "string" && (METALS as readonly string[]).includes(o.metal) ? (o.metal as MyIntakeJob["metal"]) : null;
    const gemPieces = finite(o.gem_pieces);
    return [{
      jobId, orderNo, jobNo, designLabel: label, metal, qty: intOr0(o.qty), createdAt, status, photosCount: intOr0(o.photos_count), myPhotosCount: intOr0(o.my_photos_count), editable: o.editable === true,
      gemState: parseGemState(o.gem_state), gemCount: Math.min(intOr0(o.gem_count), 30), gemPieces: gemPieces !== null && Number.isInteger(gemPieces) && gemPieces >= 0 && gemPieces <= 1e12 ? gemPieces : 0, gemEditable: o.gem_editable === true,
    }];
  });
  return { ok: true, data: { openAllowed: r.open_allowed === true, jobs, maxPhotos: MAX_SHOPFLOOR_PHOTOS } };
}

// ---------------------------------------------------------------------------
// ตั้งรูปหลักหลังส่งแล้ว (มติ 21 ต.ค.)
// ---------------------------------------------------------------------------

/** ตั้งรูป (ของตัวเอง) เป็นรูปหลัก — DB ตรวจเจ้าของ/ล็อก · ไม่ล้มรูปหลักที่ออฟฟิศ/แคตตาล็อกตั้ง (primary_locked) */
export async function setPrimaryIntakePhoto(token: unknown, ref: IntakeJobRef, photoId: unknown): Promise<WorkerOk<{ changed: boolean }> | WorkerFail> {
  if (!refValid(ref)) return photoFail(fail("idem_invalid"));
  if (typeof photoId !== "string" || !isUuid(photoId)) return photoFail(fail("photo_not_found"));
  const a = await authed(token);
  if ("f" in a) return a.f;
  const r = await callWorkerRpc("job_worker_photo_set_primary", { p_token_hash: a.c.tokenHash, p_session_hash: a.c.sessionHash, p_photo_id: photoId, p_ip_hash: a.c.ipHash, ...refParams(ref) });
  if (isFail(r)) return photoFail(r);
  const bad = intakeClean(r, "job_worker_photo_set_primary");
  if (bad) return bad;
  return { ok: true, data: { changed: r.changed === true } };
}

// ---------------------------------------------------------------------------
// ออก QR ใหม่ของใบที่ฉันเปิด (มติ 21 ต.ค.)
// ---------------------------------------------------------------------------

export interface IntakeReissueResult {
  /** true = idemKey เดิมออกไปแล้ว (ภายใน 10–20 นาที) — ไม่ออกใหม่ และไม่มี token (ไม่เก็บ raw token ส่งซ้ำไม่ได้): หน้าจอบอก "ออกไปแล้ว ถ้าไม่เห็น QR ให้กดออกใหม่อีกครั้ง" (ใช้ key ใหม่) */
  already: boolean;
  /** QR ใบงานดิบ — แสดงครั้งเดียว (ผู้เรียกห้าม log/เก็บ) · null เมื่อ already */
  token: string | null;
  printNo: number | null;
  jobNo: string;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

export async function reissueIntakeToken(token: unknown, jobId: unknown, idemKey?: unknown): Promise<WorkerOk<IntakeReissueResult> | WorkerFail> {
  if (typeof jobId !== "string" || !isUuid(jobId)) return photoFail(fail("order_not_found"));
  if (idemKey !== null && idemKey !== undefined && (typeof idemKey !== "string" || !IDEM_RE.test(idemKey))) return photoFail(fail("idem_invalid"));
  const a = await authed(token);
  if ("f" in a) return a.f;
  const r = await callWorkerRpc("job_worker_token_reissue", { p_token_hash: a.c.tokenHash, p_session_hash: a.c.sessionHash, p_job_id: jobId, p_ip_hash: a.c.ipHash, ...(typeof idemKey === "string" ? { p_idem_key: idemKey } : {}) });
  if (isFail(r)) return photoFail(r);
  // ผลดิบมี token ดิบ (ตั้งใจ) — ตรวจ key ต้องห้ามบนสำเนาที่ไม่มี token (ไม่ log ผลดิบเด็ดขาด)
  const { token: raw, ...rest } = r;
  const bad = intakeClean(rest, "job_worker_token_reissue");
  if (bad) return bad;
  const jobNo = typeof rest.job_no === "string" ? rest.job_no.slice(0, 20) : "";
  if (rest.already === true) {
    // ออกไปแล้ว: ไม่มี token — ถ้า DB แอบส่ง token มา = ผิดสัญญา ไม่ส่งต่อ
    if (raw !== undefined || !/^JB-\d{1,8}$/.test(jobNo)) return fail("error", GENERIC_JOB_ERROR);
    return { ok: true, data: { already: true, token: null, printNo: null, jobNo } };
  }
  const printNo = finite(rest.print_no);
  if (typeof raw !== "string" || !TOKEN_RE.test(raw) || !/^JB-\d{1,8}$/.test(jobNo) || printNo === null || !Number.isInteger(printNo) || printNo < 1 || printNo > 1000) return fail("error", GENERIC_JOB_ERROR);
  return { ok: true, data: { already: false, token: raw, printNo, jobNo } };
}

// ---------------------------------------------------------------------------
// อัปโหลด
// ---------------------------------------------------------------------------

export interface IntakePhotoUploadInput {
  ref: IntakeJobRef;
  md: File;
  sm: File;
  /** ขอเป็นรูปหลัก (DB ตัดสิน: ไม่ล้มรูปหลักที่ออฟฟิศ/แคตตาล็อกตั้งไว้) */
  isPrimary: boolean;
  /** uuid ต่อรูปจาก client (idempotency) — key เดิมของช่างคนเดิม = คืนรูปเดิม ไม่สร้างซ้ำ ไม่อัปซ้ำ · ไม่ส่ง = พฤติกรรมเดิม */
  clientKey?: string | null;
}

const fileFail = (code: keyof typeof JOB_PHOTO_FILE_CODE, msg: keyof typeof JOB_PHOTO_FILE_ERROR_TH): WorkerFail => ({ ok: false, code: JOB_PHOTO_FILE_CODE[code], error: JOB_PHOTO_FILE_ERROR_TH[msg] });

type Prepared = { ok: true; md: Uint8Array; sm: Uint8Array; width: number; height: number } | { ok: false; f: WorkerFail };

/** bytes → JPEG จริง · ตัด Exif/XMP · ตรวจซ้ำ · มิติ/เพดานพิกเซล — ไม่แตะ DB/storage */
async function prepareJpegPair(mdFile: File, smFile: File): Promise<Prepared> {
  const img = await import("@/lib/images/server");
  const md = new Uint8Array(await mdFile.arrayBuffer());
  const sm = new Uint8Array(await smFile.arrayBuffer());
  if (!img.looksLikeJpeg(md) || !img.looksLikeJpeg(sm)) return { ok: false, f: fileFail("notJpeg", "notJpeg") };
  const cmd = img.cleanJpegForStorage(md, MAX_BYTES);
  const csm = img.cleanJpegForStorage(sm, MAX_BYTES);
  if (!cmd.ok || !csm.ok) {
    const why = !cmd.ok ? cmd.reason : !csm.ok ? csm.reason : "broken";
    if (why === "broken") return { ok: false, f: fileFail("broken", "broken") };
    if (why === "too_large") return { ok: false, f: fileFail("tooLarge", "tooLarge") };
    return { ok: false, f: fileFail("cameraMetadata", "cameraMetadata") };
  }
  const dims = img.extractJpegDimensions(cmd.bytes);
  const sdims = img.extractJpegDimensions(csm.bytes);
  if (!dims || !sdims) return { ok: false, f: fileFail("broken", "broken") };
  if (Math.max(dims.width, dims.height) > MD_MAX_PX + JOB_PHOTO_DIM_SLACK_PX || Math.max(sdims.width, sdims.height) > SM_MAX_PX + JOB_PHOTO_DIM_SLACK_PX) {
    return { ok: false, f: fileFail("tooLargeDim", "tooLargeDim") };
  }
  return { ok: true, md: cmd.bytes, sm: csm.bytes, width: dims.width, height: dims.height };
}

/** รูปเดิมของ key ที่เคยแนบแล้ว (อ่านจาก list — path ไม่ออกถึง client) */
async function existingPhoto(token: unknown, ref: IntakeJobRef, photoId: string): Promise<WorkerOk<IntakeUploadResult> | WorkerFail> {
  const l = await listIntakePhotos(token, ref);
  if (!l.ok) return l;
  const hit = l.data.photos.find((p) => p.id === photoId);
  return hit ? { ok: true, data: { already: true, photo: hit, count: l.data.count, max: MAX_SHOPFLOOR_PHOTOS } } : fail("error", GENERIC_JOB_ERROR);
}

export async function uploadIntakePhoto(token: unknown, i: IntakePhotoUploadInput): Promise<WorkerOk<IntakeUploadResult> | WorkerFail> {
  if (!refValid(i.ref)) return photoFail(fail("idem_invalid"));
  if (!(i.md instanceof File) || !(i.sm instanceof File)) return fileFail("missing", "missing");
  if (i.md.size === 0 || i.sm.size === 0) return fileFail("empty", "empty");
  if (i.md.size > MAX_BYTES || i.sm.size > MAX_BYTES) return fileFail("tooLarge", "tooLarge");
  const a = await authed(token);
  if ("f" in a) return a.f;
  const clientKey = typeof i.clientKey === "string" && isUuid(i.clientKey) ? i.clientKey.toLowerCase() : null;
  if (i.clientKey !== null && i.clientKey !== undefined && clientKey === null) return photoFail(fail("idem_invalid"));
  const base = { p_token_hash: a.c.tokenHash, p_session_hash: a.c.sessionHash, p_ip_hash: a.c.ipHash, ...refParams(i.ref), ...(clientKey ? { p_client_key: clientKey } : {}) };

  // 2) ผ่าน DB ก่อนแตะ bucket
  const b = await callWorkerRpc("job_worker_photo_begin", base);
  if (isFail(b)) return photoFail(b);
  const bBad = intakeClean(b, "job_worker_photo_begin");
  if (bBad) return bBad;
  const jobId = lc(b.job_id);
  const shopId = lc(b.shop_id);
  const photoId = lc(b.photo_id);
  if (!jobId || !shopId || !photoId) return fail("error", GENERIC_JOB_ERROR);
  // key เดิมเคยแนบสำเร็จแล้ว → คืนรูปเดิม ไม่อ่านไฟล์ ไม่แตะ bucket ไม่ลงทะเบียนซ้ำ
  if (b.already === true) return existingPhoto(token, i.ref, photoId);

  // 3) bytes (ตัด Exif ที่ server เอง — ไม่เชื่อว่า client ย่อ/ล้างมาแล้ว)
  const prep = await prepareJpegPair(i.md, i.sm);
  if (!prep.ok) return prep.f;

  // 4) อัปโหลด (uuid ใหม่จาก DB เสมอ ไม่ทับ path เดิม)
  const mdPath = `${shopId}/${jobId}/${photoId}_md.jpg`;
  const smPath = `${shopId}/${jobId}/${photoId}_sm.jpg`;
  if (!JOB_PHOTO_PATH_RE.test(mdPath) || !JOB_PHOTO_PATH_RE.test(smPath)) return fail("error", GENERIC_JOB_ERROR);
  if (!(await uploadJobPhotoPair({ mdPath, smPath, md: prep.md, sm: prep.sm }))) return fail("error", "อัปโหลดรูปไม่สำเร็จ ลองใหม่อีกครั้ง");

  // 5) ลงทะเบียน
  const r = await callWorkerRpc("job_worker_photo_add", {
    ...base,
    p_photo_id: photoId,
    p_storage_path: mdPath,
    p_variant_sm_path: smPath,
    p_bytes: prep.md.byteLength + prep.sm.byteLength, // md+sm รวม (ตรงกับ CHECK ของตาราง)
    p_width: prep.width,
    p_height: prep.height,
    p_is_primary: i.isPrimary,
    p_user_agent: a.c.userAgent,
  });
  if (isFail(r)) {
    if (r.code === "error") {
      // ผลกำกวม (เครือข่าย/ระบบ): แถวอาจเกิดแล้ว — ถามรายการก่อน · เกิดแล้ว = สำเร็จ (ห้ามลบ object) · ไม่เกิด = ลบ · ถามไม่ได้ = เก็บไว้ (ไฟล์ค้างดีกว่ารูปพัง) + log
      const l = await listIntakePhotos(token, i.ref);
      const hit = l.ok ? l.data.photos.find((p) => p.id === photoId) : undefined;
      if (hit) return { ok: true, data: { photo: hit, count: l.ok ? l.data.count : 0, max: MAX_SHOPFLOOR_PHOTOS } };
      if (l.ok) await deleteJobPhotoObjects([mdPath, smPath]);
      else logJobFailure("uploadIntakePhoto.reconcile", { code: "list_failed" });
      return photoFail(r);
    }
    await deleteJobPhotoObjects([mdPath, smPath]);
    return photoFail(r);
  }
  const rBad = intakeClean(r, "job_worker_photo_add");
  if (rBad) return rBad;
  if (r.already === true) {
    // ส่งซ้ำพร้อมกัน/ซ้ำหลัง begin: DB คืนรูปเดิมของ key นี้ — object ที่เพิ่งอัปเป็นของซ้ำ ลบทิ้ง แล้วคืนรูปเดิม
    await deleteJobPhotoObjects([mdPath, smPath]);
    const ex = lc(r.photo_id);
    return ex ? existingPhoto(token, i.ref, ex) : fail("error", GENERIC_JOB_ERROR);
  }
  if (lc(r.photo_id) !== photoId) {
    // ผิดสัญญา (ไม่ควรเกิด): แถวอาจเกิดแล้ว — ไม่ลบ object
    logJobFailure("uploadIntakePhoto.contract", { code: "bad_rpc_result" });
    return fail("error", GENERIC_JOB_ERROR);
  }
  const signed = await signJobPhotoPaths(getServiceClient(), [mdPath, smPath]);
  const md = signed.get(mdPath) ?? null;
  const sm = signed.get(smPath) ?? null;
  return { ok: true, data: { photo: { id: photoId, smUrl: sm ?? md, mdUrl: md ?? sm, isPrimary: r.is_primary === true, mine: true }, count: intOr0(r.count), max: MAX_SHOPFLOOR_PHOTOS } };
}

// ---------------------------------------------------------------------------
// ลบ
// ---------------------------------------------------------------------------

/** ลบรูปของตัวเอง (DB ตรวจเจ้าของ/ล็อก) แล้วลบ object — ลบ object ล้ม = ไฟล์ค้าง (หนี้ sweep) ไม่ใช่ความล้มเหลวของผู้ใช้ */
export async function removeIntakePhoto(token: unknown, photoId: unknown): Promise<WorkerOk<{ promotedPhotoId: string | null; already: boolean }> | WorkerFail> {
  if (typeof photoId !== "string" || !isUuid(photoId)) return photoFail(fail("photo_not_found"));
  const a = await authed(token);
  if ("f" in a) return a.f;
  const r = await callWorkerRpc("job_worker_photo_remove", { p_token_hash: a.c.tokenHash, p_session_hash: a.c.sessionHash, p_photo_id: photoId, p_user_agent: a.c.userAgent, p_ip_hash: a.c.ipHash });
  if (isFail(r)) {
    if (r.code === "already_deleted") return { ok: true, data: { promotedPhotoId: null, already: true } };
    return photoFail(r);
  }
  const bad = intakeClean(r, "job_worker_photo_remove");
  if (bad) return bad;
  const paths = [r.storage_path, r.variant_sm_path].filter((p): p is string => typeof p === "string" && JOB_PHOTO_PATH_RE.test(p));
  await deleteJobPhotoObjects(paths);
  return { ok: true, data: { promotedPhotoId: lc(r.promoted_photo_id), already: false } };
}
