"use server";

// lib/actions/job-photos.ts — รูปอ้างอิงบนใบงาน ฝั่งออฟฟิศ (owner/admin) · ระบบใบงาน 0182 · design-job-photos.md §3-§6
// ทุก action: guard() บรรทัดแรก (session จริงเมื่อ AUTH_GATE on + allowlist owner|admin) · shop/actor จาก server (callOffice ใส่ p_shop_id/p_actor หลัง spread — client ทับไม่ได้)
// 🔴 ด่านที่ไม่ผ่อน (ทุกด่านรันทุกครั้ง — อย่าถอด):
//    - action ไม่รับ path/ชื่อไฟล์/shop/ที่มา จาก FormData เลย — รับแค่ jobId + md + sm + caption · path สร้างที่ server จาก uuid ใหม่ + shop/job ที่ DB ยืนยัน
//    - ไฟล์: ไม่ว่าง · ≤ 1 MB ต่อ variant · magic bytes เป็น JPEG จริง (ไม่เชื่อ Content-Type/นามสกุล) · server ตัด metadata ระดับ marker (Exif/XMP/APP13/COM/ท้าย EOI — GPS หาย) แล้วตรวจซ้ำก่อนเก็บ ·
//      เก็บ "bytes ที่ตัดแล้ว" เท่านั้น (ไฟล์ที่ยิงตรงเข้า action ข้าม client ก็ไม่มี GPS ค้าง) · โครงสร้างพัง/polyglot/ไม่รู้จัก = ปฏิเสธ
//    - ใบ: ต้องอยู่ร้านนี้ · เป็นใบแม่ (ส่วนย่อยใช้รูปแม่) · เพดาน 5 reference/20 รวม/250 MB ต่อร้าน (app เช็คก่อน + trigger DB เป็นด่านจริงกัน race)
//    - ผลที่ถึง client = JobPhotoRow (signed URL 15 นาที) เท่านั้น — ไม่มี storage_path/product_image_id/uploaded_by
//    - log เฉพาะ label + code/hint (logJobFailure) — ไม่ log path/URL/error ทั้งก้อน
//    - ใบปิดแล้ว (done/cancelled) แก้รูปได้ (มติเจ้าของ 19 ต.ค. 69) — ยังมีประวัติ job_event ใครเพิ่ม/ลบ
// หน้าช่าง (/w/) ห้าม import ไฟล์นี้ — มีเทสต์ module graph (lib/jobs/worker-boundary.test.ts)
// ไฟล์ "use server": export ได้เฉพาะ async function (ชนิด/ค่าคงที่อยู่ lib/jobs/photos.ts · lib/images/constants.ts)

import { revalidatePath } from "next/cache";
import { JOB_PHOTO_CAPTION_MAX, JOB_PHOTO_DIM_SLACK_PX, JOB_PHOTO_REASON_MAX, MAX_BYTES, MAX_JOB_PHOTOS, MAX_REFERENCE_PHOTOS, MD_MAX_PX, SM_MAX_PX } from "@/lib/images/constants";
import { cleanJpegForStorage, extractJpegDimensions, looksLikeJpeg } from "@/lib/images/server";
import { isUuid, parseText } from "@/lib/jobs/input";
import { logJobFailure } from "@/lib/jobs/log";
import { JOB_PHOTO_ERROR_TH, JOB_PHOTO_FILE_CODE, JOB_PHOTO_FILE_ERROR_TH, JOB_PHOTO_GENERIC_ERROR } from "@/lib/jobs/photos";
import type { JobPhotoRow } from "@/lib/jobs/photos";
import { copyCatalogPhotoToJob, jobPhotoRowAfterStore, loadJobPhotos, photoFail, removeJobPhotoObjects, storeJobPhoto } from "@/lib/jobs/photos-server";
import { callOffice, db, fail, guard, shopId } from "@/lib/jobs/office-server";
import type { JobResult } from "@/lib/jobs/office-server";

const revalidateJob = (jobId: string): void => {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
};

/** แถวใบที่ต้องใช้ตรวจก่อนอัปโหลด: อยู่ร้านนี้ + เป็นใบแม่ (id ที่ DB ยืนยันแล้ว — ใช้สร้าง path) */
async function loadRootJob(jobId: string): Promise<{ ok: true } | { ok: false; error: string; code?: string }> {
  const { data, error } = await db().from("job").select("id, parent_job_id").eq("shop_id", shopId()).eq("id", jobId).maybeSingle();
  if (error) throw error;
  const j = data as { id?: unknown; parent_job_id?: unknown } | null;
  if (!j || typeof j !== "object" || Array.isArray(j) || j.id !== jobId) return fail(JOB_PHOTO_FILE_ERROR_TH.jobMissing, "job_not_found");
  if (j.parent_job_id !== null && j.parent_job_id !== undefined) return fail("ส่วนย่อยไม่มีรูปของตัวเอง — ใส่รูปที่ใบแม่", "lot_no_photo");
  return { ok: true };
}

// ============================================================================
// getJobPhotos — รูป active ของใบ (เรียงรูปหลักก่อน) พร้อม signed URL — ปุ่ม "โหลดใหม่" เมื่อ URL หมดอายุ
// ============================================================================
export async function getJobPhotos(jobId: string): Promise<JobResult<JobPhotoRow[]>> {
  const g = await guard();
  if (g) return g;
  if (!isUuid(jobId)) return fail("ข้อมูลไม่ถูกต้อง");
  try {
    return { ok: true, data: await loadJobPhotos(jobId) };
  } catch (err) {
    logJobFailure("getJobPhotos", err);
    return fail("โหลดรูปไม่สำเร็จ ลองใหม่อีกครั้ง");
  }
}

// ============================================================================
// uploadJobPhoto — FormData { jobId, md: File, sm: File, caption? } (ย่อ+re-encode เป็น JPEG ที่ client ด้วย lib/images/client.ts resizeImageVariants มาแล้ว)
// action นี้ไม่เชื่อว่า client ทำถูก: ตรวจ bytes จริงซ้ำทุกด่าน · อัปโหลดทีละรูป (เน็ตสะดุดเสียแค่รูปเดียว)
// ============================================================================
export async function uploadJobPhoto(fd: FormData): Promise<JobResult<JobPhotoRow>> {
  const g = await guard();
  if (g) return g;
  if (!(fd instanceof FormData)) return fail("ข้อมูลไม่ถูกต้อง");

  const jobId = String(fd.get("jobId") ?? "").trim();
  if (!isUuid(jobId)) return fail(JOB_PHOTO_FILE_ERROR_TH.jobMissing, "job_not_found");
  const mdFile = fd.get("md");
  const smFile = fd.get("sm");
  if (!(mdFile instanceof File) || !(smFile instanceof File)) return fail(JOB_PHOTO_FILE_ERROR_TH.missing, JOB_PHOTO_FILE_CODE.missing);
  if (mdFile.size === 0 || smFile.size === 0) return fail(JOB_PHOTO_FILE_ERROR_TH.empty, JOB_PHOTO_FILE_CODE.empty);
  if (mdFile.size > MAX_BYTES || smFile.size > MAX_BYTES) return fail(JOB_PHOTO_FILE_ERROR_TH.tooLarge, JOB_PHOTO_FILE_CODE.tooLarge);
  const rawCaption = fd.get("caption");
  const caption = parseText(rawCaption === null || typeof rawCaption === "string" ? rawCaption : null, "ป้ายรูป", JOB_PHOTO_CAPTION_MAX, false);
  if (!caption.ok) return fail(caption.error, "caption_invalid");

  try {
    // ใบ: ร้านนี้ + ใบแม่ + เพดาน reference (เช็คก่อนอ่านไฟล์/อัปโหลด — trigger DB ยังเป็นด่านจริงตอนมี 2 อัปโหลดพร้อมกัน)
    const job = await loadRootJob(jobId);
    if (!job.ok) return job;
    const cnt = await db().from("job_photo").select("id", { count: "exact", head: true }).eq("shop_id", shopId()).eq("job_id", jobId).eq("kind", "reference").is("deleted_at", null);
    if (cnt.error) throw cnt.error;
    if ((cnt.count ?? 0) >= MAX_REFERENCE_PHOTOS) return fail(JOB_PHOTO_ERROR_TH.photo_cap_ref, "photo_cap_ref");

    const md = new Uint8Array(await mdFile.arrayBuffer());
    const sm = new Uint8Array(await smFile.arrayBuffer());
    // ไม่เชื่อ Content-Type/นามสกุลของ client — ตรวจ byte จริง (FF D8 FF)
    if (!looksLikeJpeg(md) || !looksLikeJpeg(sm)) return fail(JOB_PHOTO_FILE_ERROR_TH.notJpeg, JOB_PHOTO_FILE_CODE.notJpeg);
    // H1: ตัด metadata (Exif/XMP/APP13/COM/ท้าย EOI) ที่ marker — ไม่ decode/re-encode · iPhone (WebKit canvas เขียน Exif ขั้นต่ำ) ผ่านได้ · โครงสร้างพัง = ปฏิเสธ · เก็บเฉพาะ bytes ที่ตัดแล้วและตรวจซ้ำแล้ว
    const cmd = cleanJpegForStorage(md, MAX_BYTES);
    const csm = cleanJpegForStorage(sm, MAX_BYTES);
    if (!cmd.ok || !csm.ok) {
      const why = !cmd.ok ? cmd.reason : !csm.ok ? csm.reason : "broken";
      if (why === "broken") return fail(JOB_PHOTO_FILE_ERROR_TH.broken, JOB_PHOTO_FILE_CODE.broken);
      if (why === "too_large") return fail(JOB_PHOTO_FILE_ERROR_TH.tooLarge, JOB_PHOTO_FILE_CODE.tooLarge);
      return fail(JOB_PHOTO_FILE_ERROR_TH.cameraMetadata, JOB_PHOTO_FILE_CODE.cameraMetadata);
    }
    // เพดาน pixel (อ่านจากค่าคงที่ของ resizeImageVariants + เผื่อเล็กน้อย): ไฟล์ ≤ 1 MB ยังเป็น JPEG 12000×12000 ได้ — decode แล้วกินหน่วยความจำของเครื่องที่เปิดดู/พิมพ์ · อ่านขนาดไม่ได้ = ปฏิเสธ (พิสูจน์เพดานไม่ได้)
    const dims = extractJpegDimensions(cmd.bytes);
    const sdims = extractJpegDimensions(csm.bytes);
    if (!dims || !sdims) return fail(JOB_PHOTO_FILE_ERROR_TH.broken, JOB_PHOTO_FILE_CODE.broken);
    if (Math.max(dims.width, dims.height) > MD_MAX_PX + JOB_PHOTO_DIM_SLACK_PX || Math.max(sdims.width, sdims.height) > SM_MAX_PX + JOB_PHOTO_DIM_SLACK_PX) {
      return fail(JOB_PHOTO_FILE_ERROR_TH.tooLargeDim, JOB_PHOTO_FILE_CODE.tooLargeDim);
    }

    const stored = await storeJobPhoto({ jobId, md: cmd.bytes, sm: csm.bytes, width: dims.width, height: dims.height, caption: caption.value, source: "office", productImageId: null });
    if (!stored.ok) return stored;

    revalidateJob(jobId);
    const row = await jobPhotoRowAfterStore(jobId, stored.data, "office", caption.value);
    // รูปถูกเก็บแล้วแน่นอน — ถ้าประกอบแถวตอบกลับไม่ได้ (ไม่ควรเกิด) ให้ client โหลดรายการใหม่ ไม่ตอบว่าอัปโหลดล้ม
    return row ? { ok: true, data: row } : fail("บันทึกรูปแล้ว แต่แสดงผลไม่ได้ — โหลดหน้าใหม่", "photo_reload");
  } catch (err) {
    logJobFailure("uploadJobPhoto", err);
    return fail("อัปโหลดรูปไม่สำเร็จ ลองใหม่อีกครั้ง");
  }
}

// ============================================================================
// removeJobPhoto — soft delete แถว + ลบไฟล์ใน bucket จริงทันที · ลบรูปหลัก = เลื่อนรูปถัดไปขึ้นเป็นหลัก · เหตุผลไม่บังคับ
// ============================================================================
export async function removeJobPhoto(photoId: string, reason?: string | null): Promise<JobResult<{ promotedPhotoId: string | null }>> {
  const g = await guard();
  if (g) return g;
  if (!isUuid(photoId)) return fail("ข้อมูลไม่ถูกต้อง");
  const why = parseText(reason ?? null, "เหตุผลที่ลบ", JOB_PHOTO_REASON_MAX, false);
  if (!why.ok) return fail(why.error, "reason_invalid");

  const r = await callOffice<Record<string, unknown>>("job_photo_remove", { p_photo_id: photoId, p_reason: why.value });
  if (!r.ok) return photoFail(r);
  // path ที่ RPC คืนใช้ลบ object เท่านั้น (ไม่ส่งต่อถึง client) · ลบ object ล้ม = log code + ไฟล์ค้างเก็บกวาดทีหลัง (แถวถือว่าลบแล้ว)
  const paths = [r.data?.storage_path, r.data?.variant_sm_path].filter((p): p is string => typeof p === "string");
  await removeJobPhotoObjects(paths);
  const promoted = r.data?.promoted_photo_id;
  revalidatePath("/jobs");
  return { ok: true, data: { promotedPhotoId: typeof promoted === "string" && isUuid(promoted) ? promoted : null } };
}

// ============================================================================
// setPrimaryJobPhoto — ตั้งรูปหลัก (รูปที่พิมพ์บน A5) · เป็นหลักอยู่แล้ว = ok
// ============================================================================
export async function setPrimaryJobPhoto(photoId: string): Promise<JobResult<null>> {
  const g = await guard();
  if (g) return g;
  if (!isUuid(photoId)) return fail("ข้อมูลไม่ถูกต้อง");
  const r = await callOffice<Record<string, unknown>>("job_photo_set_primary", { p_photo_id: photoId });
  if (!r.ok) return photoFail(r);
  revalidatePath("/jobs");
  return { ok: true, data: null };
}

// ============================================================================
// reorderJobPhotos — ลำดับแสดง (ต้องส่งรูป active ของใบครบทุกรูป ไม่ซ้ำ) · ไม่เปลี่ยนรูปหลัก
// ============================================================================
export async function reorderJobPhotos(jobId: string, photoIds: string[]): Promise<JobResult<null>> {
  const g = await guard();
  if (g) return g;
  if (!isUuid(jobId) || !Array.isArray(photoIds) || photoIds.length === 0 || photoIds.length > MAX_JOB_PHOTOS || !photoIds.every(isUuid) || new Set(photoIds).size !== photoIds.length) {
    return fail("ลำดับรูปไม่ถูกต้อง — โหลดหน้าใหม่แล้วเรียงอีกครั้ง", "photo_set_mismatch");
  }
  const r = await callOffice<Record<string, unknown>>("job_photo_reorder", { p_job_id: jobId, p_ids: photoIds });
  if (!r.ok) return photoFail(r);
  revalidateJob(jobId);
  return { ok: true, data: null };
}

// ============================================================================
// pullJobPhotoFromCatalog — ปุ่ม "ดึงรูปจากแคตตาล็อก": copy รูปหลักของ SKU ที่ใบผูกอยู่เข้าใบ (กดเอง — ไม่ auto ย้อนหลัง) · ไม่เขียนกลับ catalog
// ============================================================================
export async function pullJobPhotoFromCatalog(jobId: string): Promise<JobResult<JobPhotoRow>> {
  const g = await guard();
  if (g) return g;
  if (!isUuid(jobId)) return fail("ข้อมูลไม่ถูกต้อง");
  try {
    const job = await loadRootJob(jobId);
    if (!job.ok) return job;
    const c = await copyCatalogPhotoToJob(jobId);
    if (!c.ok) return fail(c.error, c.code ?? c.reason);
    revalidateJob(jobId);
    const row = await jobPhotoRowAfterStore(jobId, { photoId: c.photoId, isPrimary: c.isPrimary, mdPath: c.mdPath, smPath: c.smPath }, "product", null);
    return row ? { ok: true, data: row } : fail("บันทึกรูปแล้ว แต่แสดงผลไม่ได้ — โหลดหน้าใหม่", "photo_reload");
  } catch (err) {
    logJobFailure("pullJobPhotoFromCatalog", err);
    return fail(JOB_PHOTO_GENERIC_ERROR);
  }
}
