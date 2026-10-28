// lib/jobs/shop-photos.ts — ตรรกะ pure ของ "รูปจากหน้างาน" บนมือถือผู้จัดการ /w/s/<token> (W2 · UX ux-w2-shop-photos.md)
//
// 🔴 อยู่ในกราฟหน้าช่าง (สาธารณะ): ห้าม import lib/production · lib/oem · lib/catalog · lib/actions/* (ยกเว้น type) · lib/images/client (ย่อรูปเป็นงานของ useShopPhotos เท่านั้น — ไฟล์เดียวใน allowlist ของ worker-boundary.shop.test)
// 🔴 ไม่มีตัวเลขเงิน/น้ำหนักทอง · ข้อความ error ผ่าน photoErrorView เท่านั้น (ไม่มีรหัสดิบ/ชื่อตาราง)
// เพดาน 3 รูป/ใบ = MAX_SHOPFLOOR_PHOTOS (ค่าเดียวกับ trigger ใน migration 0189 — เลขอยู่ 2 ที่ ขยับต้องขยับคู่กัน) · ที่นี่ "อ้างค่าเดิม" ไม่เขียนเลขซ้ำ

import { MAX_SHOPFLOOR_PHOTOS } from "@/lib/images/constants";
import { JOB_PHOTO_FILE_CODE } from "@/lib/jobs/photos";
import { isCleanMessage } from "@/lib/jobs/shop-open";

export const SHOP_PHOTO_MAX = MAX_SHOPFLOOR_PHOTOS;

/** resizing/ready = อยู่ในเครื่อง (ยังไม่ส่ง) · queued/uploading = ส่งอยู่ · done = อยู่บน server · error = ล้ม · locked = ช่างรับงานแล้ว/ใบปิด ส่งไม่ได้ */
export type ShopPhotoPhase = "resizing" | "ready" | "queued" | "uploading" | "done" | "error" | "locked";

export interface ShopPhotoItem {
  /** รหัสในเครื่อง (สร้างตอนเลือก) — React key + อ้างรูปในคิว */
  key: string;
  phase: ShopPhotoPhase;
  /** รูปหลักตามที่ผู้ใช้เลือก (UI แสดง ★ ตามนี้เสมอ) */
  isPrimary: boolean;
  /** รูปหลักตามที่ server บอกล่าสุด (เฉพาะรูปที่ส่งแล้ว) — ใช้ตัดสินใจย้ายดาวเมื่อรูปหลักถูกเอาออก */
  serverPrimary: boolean;
  /** อยู่บน server ตั้งแต่โหลดจอ (W-10) — ไม่แสดงสถานะ "ส่งแล้ว" */
  saved: boolean;
  serverId: string | null;
  smUrl: string | null;
  mdUrl: string | null;
  message: string | null;
  retryable: boolean;
  /** ล้มเพราะ session หมดเวลา — ต้องใส่ PIN ใหม่ก่อนลองใหม่ */
  needsPin: boolean;
  /** คำขอส่งหลุดกลางทาง (ไม่รู้ว่าถึง server ไหม) — "เอาออก" จากจอนี้ไม่ลบรูปที่อาจถึงแล้ว: บอกผู้ใช้ว่าไปลบได้ที่ "ใบที่ฉันเปิด" */
  maybeSent: boolean;
}

/** locked = ช่างรับงานแล้ว · closed = ใบปิด/ยกเลิก · not_open = ใบไม่อยู่สถานะที่แก้รูปได้ (ไม่ใช่ปิด/ยกเลิก — ใช้คำกลาง) · not_owner = ไม่ใช่ผู้เปิดใบ */
export type ShopPhotoLock = "locked" | "closed" | "not_open" | "not_owner";

// ============================================================================
// ข้อความ (ไทยล้วน · UX §9)
// ============================================================================

export const SHOP_PHOTO_TH = {
  title: "ใส่รูปให้ช่างดู",
  subtitle: `ไม่บังคับ · ใส่ได้สูงสุด ${SHOP_PHOTO_MAX} รูป`,
  keptLocal: "รูปยังอยู่ในเครื่องนี้ ยังไม่ส่ง — จะส่งหลังกด \"เปิดงาน\" · ถ้ารีเฟรชหรือปิดหน้า รูปจะหาย",
  careful: "ถ่ายเฉพาะชิ้นงาน/แบบที่ต้องการ · ช่างทุกขั้นเห็นรูปนี้",
  full: `ครบ ${SHOP_PHOTO_MAX} รูปแล้ว — เอารูปออกก่อนถ้าจะเพิ่ม`,
  emptyWithSku: "ยังไม่มีรูป — ไม่บังคับ ช่างดูจากชื่อและรหัสสินค้าได้",
  emptyNoSku: "สินค้าใหม่ไม่มีรหัส — ถ่ายรูปให้ช่างรู้ว่าทำชิ้นไหน",
  next: "ถัดไป",
  skip: "ข้าม ไม่ใส่รูป",
  waitResize: "รอย่อรูป…",
  resizing: "กำลังย่อรูป…",
  reviewNone: "ไม่มีรูป",
  reviewNoSkuNone: "⚑ ช่างจะไม่เห็นภาพชิ้นงาน",
  reviewWillSend: "จะส่งหลังกด \"เปิดงาน\"",
  reviewFooter: (n: number) => `ส่งรูป ${n} รูปหลังเปิดงาน — อยู่หน้าจอนี้จนส่งเสร็จ`,
  cardTitle: "รูปจากหน้างาน",
  queued: "รอคิวส่ง",
  uploading: "กำลังส่ง…",
  sent: "✓ ส่งแล้ว",
  dontClose: "อย่าปิดหน้านี้ · อย่าล็อกจอ",
  stillPending: "ยังมีรูปที่ส่งไม่เสร็จ",
  noNet: "ไม่มีอินเทอร์เน็ต — ส่งรูปไม่ได้ตอนนี้ ห้ามปิดหน้านี้",
  netBack: "เน็ตกลับมาแล้ว — แตะ \"ลองใหม่\" ที่รูปสีแดง",
  failNet: "ส่งไม่สำเร็จ — ไม่มีเน็ต",
  failGeneric: "ส่งไม่สำเร็จ — ลองอีกครั้ง",
  failPin: "หมดเวลาแล้ว — ใส่ PIN ใหม่",
  failRate: "ส่งถี่เกินไป — รอสักครู่แล้วกด \"ลองใหม่\"",
  failCap: `ใบนี้มีรูปจากหน้างานครบ ${SHOP_PHOTO_MAX} รูปแล้ว`,
  /** โควตา M1 (backend 21 ต.ค.): พื้นที่รวมรูปหน้างานของร้านเต็ม / ช่างแนบครบต่อ 24 ชม. — ข้อความตรงกับ PHOTO_CODE_TH ฝั่ง server (ไม่มีตัวเลขโควตาบนจอ) */
  failKeyUsed: "รูปนี้ถูกใช้ไปแล้ว — เลือกรูปใหม่",
  primaryLocked: "รูปหลักออฟฟิศตั้งไว้แล้ว — แจ้งออฟฟิศถ้าจะเปลี่ยน",
  failShopBudget: "พื้นที่รูปจากหน้างานเต็มแล้ว — แจ้งออฟฟิศ",
  failDailyCap: "วันนี้แนบรูปครบกำหนดแล้ว",
  failClosed: "ใบนี้ปิดหรือยกเลิกแล้ว — ส่งรูปไม่ได้",
  failNotOpen: "ใบนี้แก้ไม่ได้ตอนนี้ — แจ้งออฟฟิศ",
  failCapRef: "ใบนี้มีรูปครบ 5 รูปแล้ว — แจ้งออฟฟิศ",
  failCapTotal: "ใบนี้มีรูปครบกำหนดแล้ว — แจ้งออฟฟิศ",
  /** ป้ายสถานะการ์ด "ใบที่ฉันเปิด" เมื่อ editable=false — ไม่ระบุสาเหตุ (อาจเป็นช่างรับงาน/ใบไม่อยู่สถานะแก้ได้) */
  cardNotEditable: "แก้รูปไม่ได้ตอนนี้",
  removedMaybeSent: "ถ้ารูปนี้ส่งถึงแล้ว จะอยู่ใน \"ใบที่ฉันเปิด\" — ลบได้ที่นั่น",
  failNotOwner: "แก้รูปได้เฉพาะคนที่เปิดใบนี้",
  failQr: "QR ร้านนี้ใช้ไม่ได้แล้ว — ขอออฟฟิศออก QR ใหม่",
  locked: "ช่างรับงานแล้ว แก้รูปไม่ได้ — แจ้งออฟฟิศ",
  lockedUnsent: "ไม่ได้ส่ง — ช่างรับงานแล้ว",
  editable: "แก้ได้จนช่างเริ่มรับงาน",
  leaveHint: "ออกจากหน้านี้แล้ว กลับมาแก้ได้ที่ \"ใบที่ฉันเปิด\" จนช่างเริ่มรับงาน",
  removeDraft: "เอารูปนี้ออก",
  removedDraft: "เอารูปออกแล้ว",
  removeSent: "ลบรูปนี้",
  deleteTitle: "ลบรูปนี้? ลบแล้วกู้คืนไม่ได้",
  deletedToast: "ลบรูปแล้ว",
  primaryToast: "ตั้งเป็นรูปหลักแล้ว",
  setPrimary: "ตั้งเป็นรูปหลัก",
  isPrimaryNow: "เป็นรูปหลักอยู่แล้ว",
  removeFail: "ลบรูปไม่สำเร็จ — เช็คสัญญาณแล้วลองอีกครั้ง",
  primaryFail: "ตั้งรูปหลักไม่สำเร็จ — ลองอีกครั้ง",
  qrGate: "QR จะขึ้นเมื่อส่งรูปครบ — ให้ช่างรอก่อนสแกน จะได้เห็นรูปตอนรับงาน",
  qrShowNow: "แสดง QR เลย (รูปที่เหลือส่งต่อได้ถ้าช่างยังไม่รับงาน)",
  qrReady: "ส่งรูปครบแล้ว — QR พร้อมให้สแกน",
  primaryCaption: "★ รูปหลัก · ช่างจะเห็นรูปนี้",
  primaryUnsent: "⚠ ยังไม่ได้ส่ง",
  primarySending: "กำลังส่ง…",
  addAfter: "＋ เพิ่มรูป (ช่างจะเห็นตอนสแกน)",
  guardTitle: "ยังส่งรูปไม่ครบ",
  guardStay: "กลับไปส่งรูปต่อ",
  guardLeave: "ออกเลย — ทิ้งรูปที่ยังไม่ส่ง",
  guardLeaveLocked: "ออกจากหน้านี้",
  guardLocked: "รูปที่ไม่ได้ส่งจะหาย — ช่างรับงานแล้ว ส่งเพิ่มไม่ได้",
  guardQr: "และ QR ก็จะหายจากจอด้วย — ดูซ้ำไม่ได้ ต้องให้ออฟฟิศพิมพ์ใบให้ช่าง หรือออก QR ใหม่ที่ \"ใบที่ฉันเปิด\"",
  guardKept: "ใบนี้ยังอยู่ใน \"ใบที่ฉันเปิด\" เพิ่มรูปใหม่ได้ถ้าช่างยังไม่รับงาน",
  retry: "ลองใหม่",
  retryAll: (n: number) => `ลองใหม่ทั้งหมด (${n} รูป)`,
  pinAgain: "ใส่ PIN ใหม่",
  qrPartial: (ks: string) => `รูปที่ ${ks} ยังไม่ได้ส่ง — ให้ช่างสแกนได้เลย แต่ช่างจะยังไม่เห็นรูปนั้น · ลองส่งใหม่ได้จนช่างรับงาน`,
  cutNotice: (n: number, k: number) => `เลือกมา ${n} รูป ใส่ได้อีก ${k} รูป — ตัด ${n - k} รูปท้ายออก`,
  cutFull: `ครบ ${SHOP_PHOTO_MAX} รูปแล้ว — เอารูปออกก่อนถ้าจะเพิ่ม`,
  loadFail: "โหลดรูปไม่ได้ — เช็คสัญญาณแล้วลองอีกครั้ง",
  retryAgain: "ลองอีกครั้ง",
} as const;

/** ข้อความ HEIC ตัวเดียวกับจอรูปของออฟฟิศ (HEIC_MESSAGE) — เขียนซ้ำที่นี่เพราะไฟล์นั้นลาก hook ของออฟฟิศเข้ากราฟสาธารณะ */
export const SHOP_HEIC_MESSAGE = "ไฟล์ HEIC เปิดไม่ได้ — iPhone: ตั้งค่า > กล้อง > รูปแบบ > รองรับมากที่สุด แล้วถ่ายใหม่ หรือส่งผ่าน LINE ก่อน";

/** error ตอนย่อรูป (class ของ lib/images/client — จับด้วยชื่อ ไม่ import เพื่อไม่ลาก canvas เข้ากราฟ) → ข้อความไทย */
export function describeShopResizeError(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "HeicNotSupportedError") return SHOP_HEIC_MESSAGE;
  if (name === "ImageTooLargeError") return "ไฟล์รูปใหญ่เกินไป แม้ลดคุณภาพแล้วก็ยังเกิน 1MB — ลองถ่ายรูปใหม่ที่ความละเอียดต่ำกว่านี้";
  if (name === "ImageDecodeError") return "เปิดไฟล์รูปนี้ไม่ได้ (ไฟล์เสียหายหรือไม่ใช่รูปภาพ) — ลองไฟล์อื่น";
  if (name === "SourceImageTooLargeError") {
    const bytes = (err as { bytes?: unknown }).bytes;
    const mb = typeof bytes === "number" && Number.isFinite(bytes) ? ` (${(bytes / 1024 / 1024).toFixed(0)}MB)` : "";
    return `ไฟล์ต้นฉบับใหญ่เกินไป${mb} — ลองเลือกไฟล์ที่เล็กกว่านี้ หรือลดความละเอียดกล้องก่อนถ่าย`;
  }
  return "ย่อรูปไม่สำเร็จ ลองเลือกรูปใหม่อีกครั้ง";
}

// ============================================================================
// error ของการส่ง/ลบ/ตั้งรูปหลัก → ข้อความ + "ลองใหม่ช่วยไหม"
// ============================================================================

export interface PhotoFail {
  error?: string;
  code?: string;
  retryAfterSeconds?: number;
}

export interface PhotoErrorView {
  message: string;
  retryable: boolean;
  needsPin?: boolean;
  /** โควตาร้าน/ช่างเต็ม — ลองใหม่ไม่ช่วย และรูปที่เหลือในคิวจะล้มเหมือนกัน (หยุดคิวทั้งชุด ไม่ยิงซ้ำ) */
  quota?: boolean;
  /** ใบเข้าสภาพที่ส่ง/ลบอีกไม่ได้ (ทั้งใบ — ไม่ใช่แค่รูปนี้) */
  lock?: ShopPhotoLock;
}

const FILE_CODES: ReadonlySet<string> = new Set(Object.values(JOB_PHOTO_FILE_CODE));
const CLOSED_CODES: ReadonlySet<string> = new Set(["job_cancelled", "job_closed"]);
const NOT_OWNER_CODES: ReadonlySet<string> = new Set(["not_allowed", "order_not_found"]);

/** code จาก action (job-worker) → ข้อความไทยของแถวรูป · ตัดสินจาก code ไม่ใช่ข้อความ (แก้ข้อความแล้วด่านไม่พัง) */
export function photoErrorView(f: PhotoFail): PhotoErrorView {
  const code = f.code ?? "";
  if (code === "session_required") return { message: SHOP_PHOTO_TH.failPin, retryable: true, needsPin: true };
  if (code === "rate_limited") return { message: SHOP_PHOTO_TH.failRate, retryable: true };
  if (code === "job_locked") return { message: SHOP_PHOTO_TH.lockedUnsent, retryable: false, lock: "locked" };
  if (CLOSED_CODES.has(code)) return { message: SHOP_PHOTO_TH.failClosed, retryable: false, lock: "closed" };
  if (code === "job_not_open") return { message: SHOP_PHOTO_TH.failNotOpen, retryable: false, lock: "not_open" };
  if (NOT_OWNER_CODES.has(code)) return { message: SHOP_PHOTO_TH.failNotOwner, retryable: false, lock: "not_owner" };
  if (code === "photo_cap_shopfloor") return { message: SHOP_PHOTO_TH.failCap, retryable: false };
  if (code === "photo_cap_ref") return { message: SHOP_PHOTO_TH.failCapRef, retryable: false };
  if (code === "photo_cap_total") return { message: SHOP_PHOTO_TH.failCapTotal, retryable: false };
  // clientPhotoKey ซ้ำกับรูปที่ลบแล้ว/ใบอื่น — เอารูปนี้ออกแล้วเลือกใหม่ (ลองใหม่ด้วย key เดิมได้ผลเดิม)
  if (code === "photo_key_used") return { message: SHOP_PHOTO_TH.failKeyUsed, retryable: false };
  if (code === "photo_budget_shopfloor") return { message: SHOP_PHOTO_TH.failShopBudget, retryable: false, quota: true };
  if (code === "photo_daily_cap") return { message: SHOP_PHOTO_TH.failDailyCap, retryable: false, quota: true };
  if (code === "invalid_token" || code === "token_budget_exhausted") return { message: SHOP_PHOTO_TH.failQr, retryable: false };
  if (code === "photo_bytes_invalid" || code === "photo_dims_invalid" || FILE_CODES.has(code)) {
    return { message: isCleanMessage(f.error) ? f.error : "ไฟล์รูปนี้ส่งไม่ได้ — เอาออกแล้วเลือกรูปใหม่", retryable: false };
  }
  if (isCleanMessage(f.error) && code !== "") return { message: f.error, retryable: true };
  return { message: SHOP_PHOTO_TH.failGeneric, retryable: true };
}

/** ข้อความเมื่อ "ลบ"/"ตั้งรูปหลัก" ล้ม (ไม่ใช่การส่ง) */
export function photoActionErrorMessage(f: PhotoFail, fallback: string): string {
  // รูปหลักที่ออฟฟิศ/แคตตาล็อกตั้งไว้ผู้จัดการสลับไม่ได้ (ไม่ล็อกทั้งใบ — ลบ/เพิ่มรูปของตัวเองยังทำได้)
  if (f.code === "primary_locked") return SHOP_PHOTO_TH.primaryLocked;
  const v = photoErrorView(f);
  if (v.needsPin) return SHOP_PHOTO_TH.failPin;
  if (v.lock === "locked") return SHOP_PHOTO_TH.locked;
  if (v.lock === "closed") return SHOP_PHOTO_TH.failClosed;
  if (v.lock === "not_open") return SHOP_PHOTO_TH.failNotOpen;
  if (v.lock === "not_owner") return SHOP_PHOTO_TH.failNotOwner;
  if (f.code === "rate_limited") return SHOP_PHOTO_TH.failRate;
  return isCleanMessage(f.error) && (f.code ?? "") !== "" && f.code !== "error" ? f.error : fallback;
}

// ============================================================================
// ออก QR ใหม่ (intakeReissueToken) — ข้อความ error
// ============================================================================

export const REISSUE_TH = {
  button: "ออก QR ใหม่",
  note: "QR ใบงานแสดงซ้ำไม่ได้ — ออก QR ใหม่ได้ (QR เดิมที่ติดไปแล้วยังใช้ได้) หรือให้ออฟฟิศพิมพ์ใบ A5 ให้ช่างสแกน",
  title: (jobNo: string) => `ออก QR ใหม่ของ ${jobNo}?`,
  body: "QR เดิมที่ให้ช่างไปแล้วยังใช้ได้ · ใบงานหนึ่งมี QR ที่ใช้งานอยู่ได้ไม่เกิน 5 ใบ · QR ใหม่แสดงครั้งเดียว ออกจากหน้านี้แล้วดูซ้ำไม่ได้",
  confirm: "ออก QR ใหม่",
  working: "กำลังออก QR…",
  resultTitle: (jobNo: string) => `QR ใหม่ ${jobNo}`,
  once: "⚠ QR นี้แสดงครั้งเดียว — ออกจากหน้านี้แล้วจะหายจากจอ",
  done: "เสร็จแล้ว",
  /** คำขอหลุดกลางทาง: กดลองใหม่ได้ปลอดภัย — ใช้ idem key เดิม (ถ้าครั้งก่อนออกไปแล้ว server บอก already ไม่กินโควตาเพิ่ม) */
  netFail: "ออก QR ไม่สำเร็จ — เช็คสัญญาณแล้วลองอีกครั้ง",
  /** idem key เดิมออกไปแล้ว (คำขอก่อนหน้าถึง server แต่ตอบไม่ถึง) — server ไม่มี QR ดิบส่งซ้ำ: กดใหม่ = key ใหม่ = QR ใบใหม่ (นับโควตา) */
  already: "ออกไปแล้ว ถ้าไม่เห็น QR ให้กดออกใหม่อีกครั้ง",
  generic: "ออก QR ใหม่ไม่สำเร็จ — ลองอีกครั้ง",
} as const;

const REISSUE_CLOSED: ReadonlySet<string> = new Set(["job_closed", "job_cancelled"]);

/** ผลล้มของ action ออก QR ใหม่ → ข้อความไทย (ตัดสินจาก code) · needsPin = ต้องใส่ PIN ใหม่ */
export function reissueErrorView(f: PhotoFail): { message: string; needsPin: boolean; final: boolean } {
  const code = f.code ?? "";
  if (code === "session_required") return { message: SHOP_PHOTO_TH.failPin, needsPin: true, final: false };
  if (code === "rate_limited") return { message: "ส่งถี่เกินไป — รอสักครู่แล้วลองอีกครั้ง", needsPin: false, final: false };
  if (code === "token_cap") return { message: "ใบนี้มี QR ที่ใช้งานอยู่ครบ 5 ใบแล้ว — แจ้งออฟฟิศให้เพิกถอนก่อน", needsPin: false, final: true };
  if (code === "job_not_open") return { message: SHOP_PHOTO_TH.failNotOpen, needsPin: false, final: true };
  if (REISSUE_CLOSED.has(code)) return { message: "ใบนี้ปิดหรือยกเลิกแล้ว — ออก QR ใหม่ไม่ได้", needsPin: false, final: true };
  if (NOT_OWNER_CODES.has(code)) return { message: SHOP_PHOTO_TH.failNotOwner, needsPin: false, final: true };
  if (code === "token_not_issued") return { message: "ออก QR ไม่ได้ตอนนี้ — แจ้งออฟฟิศ", needsPin: false, final: true };
  if (code === "invalid_token" || code === "token_budget_exhausted") return { message: SHOP_PHOTO_TH.failQr, needsPin: false, final: true };
  if (isCleanMessage(f.error) && code !== "" && code !== "error") return { message: f.error, needsPin: false, final: false };
  return { message: REISSUE_TH.generic, needsPin: false, final: false };
}

// ============================================================================
// คิว / สรุป / ด่านก่อนออกจากจอ
// ============================================================================

/** รูปที่รอคิวส่ง เรียงรูปหลักก่อน แล้วตามลำดับที่เลือก (กันรูปหลักสลับ — server ตั้งรูปแรกที่ส่งสำเร็จเป็นหลัก) */
export function uploadOrder<T extends { phase: ShopPhotoPhase; isPrimary: boolean }>(items: readonly T[]): T[] {
  const queued = items.filter((i) => i.phase === "queued");
  return [...queued.filter((i) => i.isPrimary), ...queued.filter((i) => !i.isPrimary)];
}

export type ShopPhotosSummary = "none" | "sending" | "partial" | "done" | "locked";

/** สรุปการส่ง (ใช้ตัดสิน QR gate): ส่งอยู่ > มีล้มค้าง > ล็อก > ครบ */
export function photosSummary(items: readonly Pick<ShopPhotoItem, "phase">[]): ShopPhotosSummary {
  if (items.length === 0) return "none";
  if (items.some((i) => i.phase === "resizing" || i.phase === "ready" || i.phase === "queued" || i.phase === "uploading")) return "sending";
  if (items.some((i) => i.phase === "error")) return "partial";
  if (items.some((i) => i.phase === "locked")) return "locked";
  return "done";
}

/** รูปที่ยังไม่ถึง server (ออกจากจอตอนนี้ = หาย) — ไม่นับรูปที่ล็อกแล้ว (ส่งต่อไม่ได้) แยกคืนเป็น locked */
export function leaveGuard(items: readonly Pick<ShopPhotoItem, "phase">[], lock: ShopPhotoLock | null): { needed: boolean; unsent: number; lockedUnsent: number; canStillSend: boolean } {
  const lockedUnsent = items.filter((i) => i.phase === "locked").length;
  const unsent = items.filter((i) => i.phase === "resizing" || i.phase === "ready" || i.phase === "queued" || i.phase === "uploading" || i.phase === "error").length;
  return { needed: unsent + lockedUnsent > 0, unsent, lockedUnsent, canStillSend: lock === null && unsent > 0 };
}

/** รูปที่ส่งไม่ถึง server อยู่ตอนนี้ (queued/uploading/error/locked/ready) */
export function unsentItems<T extends Pick<ShopPhotoItem, "phase" | "serverId">>(items: readonly T[]): T[] {
  return items.filter((i) => i.serverId === null && i.phase !== "resizing");
}

/** invariant: มีรูป ≥ 1 ⇒ มีรูปหลักพอดี 1 (ถ้าไม่มี: เอารูปที่ server บอกว่าเป็นหลักก่อน ไม่งั้นรูปแรก) — ใช้กับฟอร์มเปิดใบ/ใบที่เพิ่งเปิดเท่านั้น */
export function normalizePrimary<T extends Pick<ShopPhotoItem, "isPrimary" | "serverPrimary" | "phase">>(items: readonly T[]): T[] {
  if (items.length === 0) return [...items];
  const primaries = items.filter((i) => i.isPrimary);
  if (primaries.length === 1) return [...items];
  if (primaries.length > 1) {
    const keep = primaries.find((i) => i.serverPrimary) ?? primaries[0];
    return items.map((i) => (i === keep || !i.isPrimary ? i : { ...i, isPrimary: false }));
  }
  const keep = items.find((i) => i.serverPrimary) ?? items[0];
  return items.map((i) => (i === keep ? { ...i, isPrimary: true } : i));
}

/** ตัวเลขลำดับรูป (1-based) → "2" / "2, 3" */
export function positions(items: readonly unknown[], pick: (i: number) => boolean): string {
  const out: string[] = [];
  items.forEach((_, i) => {
    if (pick(i)) out.push(String(i + 1));
  });
  return out.join(", ");
}
