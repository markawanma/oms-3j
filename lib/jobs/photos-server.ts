// lib/jobs/photos-server.ts — ชั้น server ของรูปอ้างอิงบนใบงาน (0182 · server-only · ไม่ใช่ "use server": เรียกจาก client ตรงไม่ได้)
// ใช้โดย lib/actions/job-photos.ts (อัปโหลด/ลบ/ตั้งหลัก/เรียง/ดึงจากแคตตาล็อก) · lib/actions/job-office.ts (getJobDetail · createJob) · หน้าพิมพ์ (primaryPhotoMdUrl)
// 🔴 กติกา: (1) path ใน bucket สร้างที่นี่จาก uuid ที่ server สร้าง + shop/job จาก DB เท่านั้น — ไม่มีชื่อไฟล์/SKU/ข้อความ/path จาก client เข้าใกล้ (บทเรียน catalog-images)
//         (2) path (storage_path/variant_sm_path) ไม่ออกจากไฟล์นี้ไปถึง client — ออกเฉพาะ signed URL 15 นาที (JobPhotoRow)
//         (3) ไม่เขียน product_image / bucket product-images — ดึงรูปแคตตาล็อก = อ่าน (download) + copy เข้า bucket ใบงาน (ห้ามเขียนกลับ catalog)
//         (4) log เฉพาะ label + code/hint (logJobFailure) — ไม่ log path/URL/ชื่อไฟล์/error ทั้งก้อน (PII)
// หน้าช่าง (/w/) ห้าม import ไฟล์นี้ (ใช้ db() ของออฟฟิศ) — ช่างได้รูปจาก job_worker_resolve + lib/images/signing เท่านั้น

import "server-only";
import { randomUUID } from "node:crypto";
import { getServiceClient } from "@/lib/supabase/server";
import { BUCKET as PRODUCT_IMAGES_BUCKET, JOB_PHOTOS_BUCKET, MAX_BYTES } from "@/lib/images/constants";
import { cleanJpegForStorage, extractJpegDimensions } from "@/lib/images/server";
import { signJobPhotoPaths } from "@/lib/images/signing";
import { isUuid } from "@/lib/jobs/input";
import { logJobFailure } from "@/lib/jobs/log";
import { JOB_PHOTO_COLUMNS, JOB_PHOTO_GENERIC_ERROR, jobPhotoErrorMessage, mapJobPhotoRow } from "@/lib/jobs/photos";
import type { JobPhotoRow } from "@/lib/jobs/photos";
import { callOffice, db, fail, shopId } from "@/lib/jobs/office-server";
import type { JobResult } from "@/lib/jobs/office-server";

const JPEG = "image/jpeg";
const rows = (d: unknown): Record<string, unknown>[] => (Array.isArray(d) ? (d as Record<string, unknown>[]) : []);

/** เปลี่ยนผลล้มของ callOffice เป็นข้อความไทยของด่านรูป (code = hint ของ RPC) — ไม่รู้จัก = ข้อความจาก DB ที่สะอาดแล้ว หรือข้อความกลาง */
export function photoFail(r: { ok: false; error: string; code?: string }): { ok: false; error: string; code?: string } {
  return fail(jobPhotoErrorMessage(r.code) ?? (r.error || JOB_PHOTO_GENERIC_ERROR), r.code);
}

// ---------------------------------------------------------------------------
// อ่าน
// ---------------------------------------------------------------------------

/** รูป active ของใบ (เรียง รูปหลักก่อน → sort_order → เวลา) พร้อม signed URL (sm+md เซ็นรวดเดียว) · throw เมื่ออ่าน DB ไม่ได้ — ผู้เรียกตัดสินว่าล้มทั้งหน้าหรือไม่ */
export async function loadJobPhotos(jobId: string): Promise<JobPhotoRow[]> {
  const { data, error } = await db()
    .from("job_photo")
    .select(JOB_PHOTO_COLUMNS)
    .eq("shop_id", shopId())
    .eq("job_id", jobId)
    .is("deleted_at", null)
    .order("is_primary", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(50);
  if (error) throw error;
  const list = rows(data);
  if (list.length === 0) return [];
  const paths: string[] = [];
  for (const r of list) {
    if (typeof r.storage_path === "string") paths.push(r.storage_path);
    if (typeof r.variant_sm_path === "string") paths.push(r.variant_sm_path);
  }
  // เซ็นไม่สำเร็จ = url null ของรูปนั้น (ไม่ล้มทั้งหน้า) · signPaths ไม่ throw
  const signed = await signJobPhotoPaths(getServiceClient(), paths);
  return list.map((r) => mapJobPhotoRow(r, signed)).filter((p): p is JobPhotoRow => p !== null);
}

/** แถวของรูปที่เพิ่งเก็บ (sort_order/created_at จริงจาก DB) + signed URL · อ่านไม่ได้ = สร้างจากค่าที่เพิ่งเก็บ (รูปมีอยู่จริงแล้ว — ห้ามตอบว่าอัปโหลดล้ม) · ไม่ throw */
export async function jobPhotoRowAfterStore(jobId: string, s: StoredJobPhoto, source: "office" | "product", caption: string | null): Promise<JobPhotoRow | null> {
  let row: Record<string, unknown> = { id: s.photoId, source, storage_path: s.mdPath, variant_sm_path: s.smPath, is_primary: s.isPrimary, sort_order: 0, caption, created_at: null };
  try {
    const { data, error } = await db().from("job_photo").select(JOB_PHOTO_COLUMNS).eq("shop_id", shopId()).eq("job_id", jobId).eq("id", s.photoId).is("deleted_at", null).maybeSingle();
    if (error) throw error;
    if (data && typeof data === "object" && !Array.isArray(data)) row = data as Record<string, unknown>;
  } catch (err) {
    logJobFailure("jobPhotoRowAfterStore", err);
  }
  const signed = await signJobPhotoPaths(getServiceClient(), [s.mdPath, s.smPath]);
  return mapJobPhotoRow(row, signed);
}

/** signed URL (md · 15 นาที) ของรูปหลักของใบ — หน้าพิมพ์ A5 · ไม่มีรูป/เซ็นไม่ได้/อ่านไม่ได้ = null (พิมพ์ต่อโดยไม่มีรูป — ใบเดิมเป๊ะ) · ไม่ throw */
export async function primaryPhotoMdUrl(jobId: string): Promise<string | null> {
  try {
    const { data, error } = await db()
      .from("job_photo")
      .select("storage_path")
      .eq("shop_id", shopId())
      .eq("job_id", jobId)
      .eq("kind", "reference")
      .eq("is_primary", true)
      .is("deleted_at", null)
      .limit(1);
    if (error) throw error;
    const path = rows(data)[0]?.storage_path;
    if (typeof path !== "string") return null;
    const signed = await signJobPhotoPaths(getServiceClient(), [path]);
    return signed.get(path) ?? null;
  } catch (err) {
    logJobFailure("primaryPhotoMdUrl", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// ไฟล์ใน bucket
// ---------------------------------------------------------------------------

/** ลบ object ใน bucket job-photos (best-effort — ล้มแล้วเป็นไฟล์ค้างเก็บกวาดทีหลัง ไม่ใช่ปัญหาความถูกต้อง · log เฉพาะ code) */
export async function removeJobPhotoObjects(paths: readonly string[]): Promise<void> {
  const list = paths.filter((p) => typeof p === "string" && p !== "");
  if (list.length === 0) return;
  try {
    const { error } = await getServiceClient().storage.from(JOB_PHOTOS_BUCKET).remove([...list]);
    if (error) throw error;
  } catch (err) {
    logJobFailure("removeJobPhotoObjects", err);
  }
}

export interface StoredJobPhoto {
  photoId: string;
  isPrimary: boolean;
  mdPath: string;
  smPath: string;
}

export interface StoreJobPhotoInput {
  /** uuid ของใบที่ผ่านการตรวจแล้ว (DB-verified · ไม่ใช่สตริงดิบจาก client) */
  jobId: string;
  md: Uint8Array;
  sm: Uint8Array;
  width: number | null;
  height: number | null;
  caption: string | null;
  source: "office" | "product";
  productImageId: string | null;
}

/**
 * อัปโหลด md+sm เข้า bucket (uuid ใหม่เสมอ ไม่ทับ path เดิม) แล้วลงทะเบียนด้วย RPC job_photo_add — ล้มช่วงไหนลบ object ที่เพิ่งอัปให้หมด
 * คืน path (ใช้เซ็น URL ฝั่ง server ต่อ — ห้ามส่งต่อถึง client) · ข้อความผิดพลาดเป็นไทยแล้ว
 */
export async function storeJobPhoto(i: StoreJobPhotoInput): Promise<JobResult<StoredJobPhoto>> {
  const photoId = randomUUID();
  const mdPath = `${shopId()}/${i.jobId}/${photoId}_md.jpg`;
  const smPath = `${shopId()}/${i.jobId}/${photoId}_sm.jpg`;
  const bucket = getServiceClient().storage.from(JOB_PHOTOS_BUCKET);
  try {
    const up1 = await bucket.upload(mdPath, i.md, { contentType: JPEG, upsert: false, cacheControl: "60" });
    if (up1.error) throw up1.error;
    const up2 = await bucket.upload(smPath, i.sm, { contentType: JPEG, upsert: false, cacheControl: "60" });
    if (up2.error) {
      await removeJobPhotoObjects([mdPath]);
      throw up2.error;
    }
  } catch (err) {
    logJobFailure("storeJobPhoto.upload", err);
    return fail(JOB_PHOTO_GENERIC_ERROR);
  }
  const r = await callOffice<Record<string, unknown>>("job_photo_add", {
    p_job_id: i.jobId,
    p_kind: "reference",
    p_source: i.source,
    p_storage_path: mdPath,
    p_variant_sm_path: smPath,
    p_bytes: i.md.byteLength + i.sm.byteLength, // L1: budget นับ md+sm รวม
    p_width: i.width,
    p_height: i.height,
    p_caption: i.caption,
    p_product_image_id: i.productImageId,
  });
  if (!r.ok) {
    await removeJobPhotoObjects([mdPath, smPath]);
    return photoFail(r);
  }
  const id = r.data?.photo_id;
  if (typeof id !== "string" || !isUuid(id) || id !== photoId) {
    // RPC ตอบผิดสัญญา (ไม่ควรเกิด): แถวอาจเกิดแล้ว — ไม่ลบ object (ลบแล้วแถวชี้ไฟล์ที่ไม่มี) ให้ออฟฟิศเห็นรูปพังแล้วลบเอง
    logJobFailure("storeJobPhoto.contract", { code: "bad_rpc_result" });
    return fail(JOB_PHOTO_GENERIC_ERROR);
  }
  return { ok: true, data: { photoId, isPrimary: r.data.is_primary === true, mdPath, smPath } };
}

// ---------------------------------------------------------------------------
// ดึงรูปแคตตาล็อกเข้าใบ (copy ไม่ใช่ link — มติ ซ4)
// ---------------------------------------------------------------------------

export type CopyCatalogResult =
  | { ok: true; photoId: string; isPrimary: boolean; mdPath: string; smPath: string }
  | { ok: false; reason: "no_product" | "no_catalog_image" | "catalog_file_invalid" | "failed"; error: string; code?: string };

const COPY_FAIL_TH: Record<string, string> = {
  no_product: "ใบงานนี้ไม่ได้ผูกกับสินค้าในแคตตาล็อก",
  no_catalog_image: "สินค้านี้ยังไม่มีรูปในแคตตาล็อก",
  catalog_file_invalid: "รูปในแคตตาล็อกใช้ไม่ได้ (ไฟล์เสียหายหรือโครงสร้างไม่ถูกต้อง) — อัปโหลดรูปเองที่ใบงาน",
  failed: JOB_PHOTO_GENERIC_ERROR,
};
const copyFail = (reason: Exclude<CopyCatalogResult, { ok: true }>["reason"], code?: string): CopyCatalogResult => ({ ok: false, reason, error: COPY_FAIL_TH[reason], ...(code ? { code } : {}) });

async function downloadCatalogObject(path: string): Promise<Uint8Array | null> {
  const { data, error } = await getServiceClient().storage.from(PRODUCT_IMAGES_BUCKET).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * copy รูปหลักของ SKU (ที่ใบงานผูกอยู่) เข้า bucket ใบงานเป็นรูปของใบนี้ (source = product · เป็นรูปหลักถ้าใบยังไม่มีหลัก)
 * ไม่ throw · ไม่เขียน product_image/product-images (อ่านอย่างเดียว) · ใช้ทั้งตอนสร้างใบ (ไม่บล็อก — ล้มแล้วใบเกิดปกติ) และปุ่ม "ดึงรูปจากแคตตาล็อก"
 */
export async function copyCatalogPhotoToJob(jobId: string): Promise<CopyCatalogResult> {
  try {
    // ใบไม่ผูก SKU = ไม่ต้องยิง RPC (ประหยัดทุกใบ OEM ที่ไม่มี SKU)
    const jr = await db().from("job").select("product_id").eq("shop_id", shopId()).eq("id", jobId).maybeSingle();
    if (jr.error) throw jr.error;
    const job = jr.data as { product_id?: unknown } | null;
    if (!job || typeof job !== "object" || Array.isArray(job) || typeof job.product_id !== "string") return copyFail("no_product");

    const src = await callOffice<Record<string, unknown>>("job_photo_catalog_source", { p_job_id: jobId }, { noActor: true });
    if (!src.ok) return { ok: false, reason: "failed", error: photoFail(src).error, code: src.code };
    if (src.data?.found !== true) return copyFail(src.data?.reason === "no_product" ? "no_product" : "no_catalog_image");
    const mdSrc = src.data.md_path;
    const smSrc = src.data.sm_path;
    const pimg = src.data.product_image_id;
    if (typeof mdSrc !== "string" || typeof smSrc !== "string" || !isUuid(pimg)) return copyFail("failed");

    const [md, sm] = await Promise.all([downloadCatalogObject(mdSrc), downloadCatalogObject(smSrc)]);
    if (!md || !sm) return copyFail("failed");
    // ไฟล์ที่ copy ผ่านด่านเดียวกับไฟล์ที่อัปโหลดใหม่ (JPEG จริง · ตัด metadata ที่ marker + ตรวจซ้ำ · ≤ 1 MB) — รูปแคตตาล็อกจะถึงมือถือช่าง · เก็บ bytes ที่ตัดแล้ว
    const cmd = cleanJpegForStorage(md, MAX_BYTES);
    const csm = cleanJpegForStorage(sm, MAX_BYTES);
    if (!cmd.ok || !csm.ok) return copyFail("catalog_file_invalid");
    const dims = extractJpegDimensions(cmd.bytes);
    const stored = await storeJobPhoto({ jobId, md: cmd.bytes, sm: csm.bytes, width: dims?.width ?? null, height: dims?.height ?? null, caption: null, source: "product", productImageId: pimg });
    if (!stored.ok) return { ok: false, reason: "failed", error: stored.error, code: stored.code };
    return { ok: true, ...stored.data };
  } catch (err) {
    logJobFailure("copyCatalogPhotoToJob", err);
    return copyFail("failed");
  }
}
