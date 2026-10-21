// lib/jobs/photos.ts — รูปอ้างอิงบนใบงาน (0182 · design-job-photos.md): ชนิดข้อมูลที่ออกจาก server + ตัวแปลงแถว + ข้อความไทยของด่านรูป (pure · ใช้ได้ทั้ง server และ client)
// 🔴 JobPhotoRow ที่ถึง client ไม่มี storage_path / variant_sm_path / product_image_id / uploaded_by / bytes — มีเฉพาะ signed URL (หมดอายุ 15 นาที) + สถานะที่ UI ต้องใช้
//    ประกอบทีละ field จากแถว DB ห้าม spread (field ใหม่ในตารางต้องไม่หลุดถึงเบราว์เซอร์โดยอัตโนมัติ — เหมือน PrintableJob)

import { JOB_PHOTO_CAPTION_MAX, MAX_JOB_PHOTOS, MAX_REFERENCE_PHOTOS } from "@/lib/images/constants";

export type JobPhotoSource = "office" | "shopfloor" | "product";

export interface JobPhotoRow {
  id: string;
  /** signed URL ของรูปย่อ (sm 480px) · null = เซ็นไม่สำเร็จ (UI แสดงไอคอนพัง + ปุ่มโหลดใหม่) */
  smUrl: string | null;
  /** signed URL ของรูปกลาง (md 1200px) */
  mdUrl: string | null;
  isPrimary: boolean;
  sortOrder: number;
  caption: string | null;
  source: JobPhotoSource;
  createdAt: string | null;
}

/** คอลัมน์ที่อ่านจาก analytics.job_photo (service_role มี select ทั้งตาราง) — storage_path/variant_sm_path ใช้เซ็น URL ฝั่ง server เท่านั้น */
export const JOB_PHOTO_COLUMNS = "id, kind, source, storage_path, variant_sm_path, is_primary, sort_order, caption, created_at";

const SOURCES: readonly string[] = ["office", "shopfloor", "product"];
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** แถวรูป (รวม path ที่ไม่ปล่อยออกไป) → JobPhotoRow · path ที่เซ็นไม่ได้ = url null (ไม่ทิ้งรูป) · แถวผิดรูป = null */
export function mapJobPhotoRow(r: Record<string, unknown>, signed: ReadonlyMap<string, string>): JobPhotoRow | null {
  const id = str(r.id);
  const source = typeof r.source === "string" && SOURCES.includes(r.source) ? (r.source as JobPhotoSource) : null;
  if (!id || !source) return null;
  const md = str(r.storage_path);
  const sm = str(r.variant_sm_path);
  const sort = typeof r.sort_order === "number" && Number.isFinite(r.sort_order) ? r.sort_order : 0;
  return {
    id,
    smUrl: sm ? (signed.get(sm) ?? null) : null,
    mdUrl: md ? (signed.get(md) ?? null) : null,
    isPrimary: r.is_primary === true,
    sortOrder: sort,
    caption: str(r.caption),
    source,
    createdAt: str(r.created_at),
  };
}

/** path ของรูปใบงานที่ DB เก็บ: <shop>/<job>/<photo>_md.jpg|_sm.jpg (uuid พิมพ์เล็ก — บังคับโดย CHECK job_photo_path_ck) · ใช้กรองก่อนเซ็น URL */
export const JOB_PHOTO_PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_(?:md|sm)\.jpg$/;

/**
 * signed URL ของ bucket job-photos เท่านั้น (https · path /storage/v1/object/sign/job-photos/ · ไม่มีช่องว่าง · ยาวพอประมาณ) — ด่านซ้ำฝั่งแอปก่อน URL ไปถึงหน้าช่าง/ใบพิมพ์:
 * path ดิบ (storage_path) · URL ของ bucket อื่น (รูปแคตตาล็อก) · URL ภายนอก ไม่ผ่านรูปร่างนี้
 */
export function isJobPhotoSignedUrl(v: unknown): v is string {
  return typeof v === "string" && v.length <= 1500 && /^https:\/\/[^\s/?#]+\/storage\/v1\/object\/sign\/job-photos\/[^\s]+$/.test(v);
}

/** ข้อความไทยของด่านรูป — key = hint ของ RPC (job_photo_*) · SQLSTATE P0001/P0002/P0003 ของ trigger เพดานมาในรูป hint เดียวกัน */
export const JOB_PHOTO_ERROR_TH: Record<string, string> = {
  photo_cap_ref: `ใบงานนี้มีรูปอ้างอิงครบ ${MAX_REFERENCE_PHOTOS} รูปแล้ว — ลบรูปเก่าก่อนเพิ่ม`,
  photo_cap_total: `ใบงานนี้มีรูปครบ ${MAX_JOB_PHOTOS} รูปแล้ว — ลบรูปเก่าก่อนเพิ่ม`,
  photo_budget: "พื้นที่เก็บรูปใบงานของร้านเต็มแล้ว — ลบรูปที่ไม่ใช้แล้วก่อนเพิ่ม",
  lot_no_photo: "ส่วนย่อยไม่มีรูปของตัวเอง — ใส่รูปที่ใบแม่",
  job_not_found: "ไม่พบใบงานนี้",
  photo_not_found: "ไม่พบรูปนี้ — โหลดหน้าใหม่",
  already_deleted: "รูปนี้ถูกลบไปแล้ว — โหลดหน้าใหม่",
  photo_set_mismatch: "รูปในใบเปลี่ยนไปแล้ว — โหลดหน้าใหม่แล้วเรียงอีกครั้ง",
  photo_catalog_dup: "รูปนี้ถูกดึงจากแคตตาล็อกเข้าใบงานนี้แล้ว",
  photo_product_mismatch: "รูปแคตตาล็อกไม่ใช่ของสินค้าในใบงานนี้",
  photo_path_dup: "รูปนี้ถูกบันทึกไปแล้ว — โหลดหน้าใหม่",
  photo_path_invalid: "บันทึกรูปไม่สำเร็จ ลองใหม่อีกครั้ง",
  photo_bytes_invalid: `ไฟล์รูปไม่ถูกต้อง (ใหญ่เกิน 1 MB หรือว่างเปล่า)`,
  photo_dims_invalid: "ขนาดภาพไม่ถูกต้อง ลองถ่าย/เลือกรูปใหม่",
  photo_kind_invalid: "ชนิดรูปไม่ถูกต้อง",
  photo_source_invalid: "ที่มาของรูปไม่ถูกต้อง",
  photo_not_yet: "ยังไม่เปิดใช้รูปชนิดนี้",
  caption_invalid: `ป้ายรูปไม่ถูกต้อง — ห้ามขึ้นบรรทัดใหม่/อักขระล่องหน และยาวไม่เกิน ${JOB_PHOTO_CAPTION_MAX} ตัวอักษร`,
  reason_invalid: "เหตุผลที่ลบมีอักขระที่ไม่อนุญาตหรือยาวเกินไป",
  // 0189: รูปที่ผู้จัดการแนบจากหน้างาน ออฟฟิศลบต้องระบุเหตุผล (DB บังคับที่ job_photo_remove)
  reason_required: "รูปนี้ผู้จัดการแนบจากหน้างาน — ต้องระบุเหตุผลที่ลบ (อย่างน้อย 2 ตัวอักษร)",
};

export const JOB_PHOTO_GENERIC_ERROR = "ทำรายการกับรูปไม่สำเร็จ ลองใหม่อีกครั้ง";

/** ข้อความของ code (hint) ที่รู้จัก · ไม่รู้จัก = undefined (ให้ผู้เรียกใช้ข้อความกลาง/ข้อความจาก DB ที่สะอาดแล้ว) */
export function jobPhotoErrorMessage(code: unknown): string | undefined {
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(JOB_PHOTO_ERROR_TH, code) ? JOB_PHOTO_ERROR_TH[code] : undefined;
}

/** ข้อความของ error ฝั่งไฟล์ (ก่อนถึง DB) — ใช้ร่วมกับ client (error class ของ lib/images/client.ts แปลที่ UI) */
export const JOB_PHOTO_FILE_ERROR_TH = {
  missing: "ไม่พบไฟล์รูปที่จะอัปโหลด (ต้องมีทั้งรูปขนาดกลางและรูปย่อ)",
  empty: "ไฟล์รูปว่างเปล่า",
  tooLarge: "ไฟล์รูปใหญ่เกิน 1 MB",
  notJpeg: "ไฟล์ไม่ใช่ JPEG จริง — เลือกรูปถ่ายแล้วอัปโหลดผ่านหน้าเว็บ",
  /** ขนาดภาพ (พิกเซล) เกินที่หน้าเว็บผลิต — ไฟล์ที่ยิงตรงข้ามการย่อรูป (กันรูป 12000×12000 กินหน่วยความจำตอนพิมพ์/ดู) */
  tooLargeDim: "ขนาดภาพ (พิกเซล) ใหญ่เกินที่ระบบรับ — อัปโหลดผ่านหน้าเว็บ ระบบจะย่อให้ หรือเลือกรูปใหม่",
  /** ไฟล์เสียหาย/โครงสร้างผิด/ไม่รู้จัก (ตัด metadata ไม่ได้อย่างปลอดภัย) — ไม่เก็บ */
  broken: "ไฟล์รูปเสียหายหรือโครงสร้างไม่ถูกต้อง — เลือกรูปใหม่",
  /** ตัด metadata แล้วยังเหลือ (ไม่ควรเกิด — ด่านสุดท้าย) */
  cameraMetadata: "ล้างข้อมูลจากกล้องออกจากรูปไม่สำเร็จ — เลือกรูปใหม่หรืออัปโหลดผ่านหน้าเว็บ",
  jobMissing: "ไม่พบใบงานที่จะอัปโหลดรูป",
} as const;

/**
 * code (hint) ของด่านไฟล์ฝั่ง action — UI ตัดสินว่า "ลองใหม่ช่วยไหม" จาก code ไม่ใช่จากข้อความไทย (แก้ข้อความแล้วด่านไม่พัง)
 * ไฟล์เดิมส่งซ้ำได้ผลเดิม → ทุก code ในนี้ลองใหม่ไม่ช่วย (UI: มีแต่ "เอาออก")
 */
export const JOB_PHOTO_FILE_CODE = {
  missing: "photo_file_missing",
  empty: "photo_file_empty",
  tooLarge: "photo_file_too_large",
  notJpeg: "photo_file_not_jpeg",
  broken: "photo_file_broken",
  cameraMetadata: "photo_file_metadata",
  tooLargeDim: "photo_file_too_large_dim",
} as const;
