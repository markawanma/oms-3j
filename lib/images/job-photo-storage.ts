// lib/images/job-photo-storage.ts — เขียน/ลบ object ใน bucket private 'job-photos' ให้ทาง "แนบรูปจากหน้างาน" (0189 · lib/jobs/shop-photo-server.ts)
// server-only · plain module (ไม่ใช่ "use server")
//
// ทำไมแยกไฟล์ (ไม่ใช้ storeJobPhoto ของ lib/jobs/photos-server.ts): ไฟล์นั้นผูกกับ db()/shopId() ของออฟฟิศ (session แอป) — หน้าช่าง /w/ import ไม่ได้ (worker-boundary) ·
// และไฟล์ในกราฟหน้าช่างห้ามมี `.from(` (เทสต์กันอ่านตารางตรง) — การเรียก storage ผ่าน `.storage.from(bucket)` จึงอยู่ในไฟล์นอกรายชื่อกราฟ เหมือน lib/images/signing.ts
//
// 🔴 ไฟล์นี้ "ไม่ตัดสินใจเรื่องสิทธิ์" — ผู้เรียกต้องผ่าน RPC job_worker_photo_begin ก่อนทุกครั้ง (DB ตรวจ token/session/สิทธิ์/ใบ/สถานะ) แล้วส่ง path ที่ประกอบจาก uuid ของ DB เท่านั้น
// 🔴 log เฉพาะรหัส (SQLSTATE/ชื่อ error) ผ่าน logJobFailure — ไม่ log path/URL/ชื่อไฟล์/error ทั้งก้อน (PII: path มี uuid ร้าน/ใบ)

import "server-only";
import { JOB_PHOTOS_BUCKET } from "@/lib/images/constants";
import { logJobFailure } from "@/lib/jobs/log";
import { getServiceClient } from "@/lib/supabase/server";

const JPEG = "image/jpeg";

/** ลบ object (best-effort) — ล้ม = log code แล้วปล่อยเป็นไฟล์ค้าง (เก็บกวาดทีหลัง · ไม่ใช่ปัญหาความถูกต้อง) · ไม่ throw · คืน true เมื่อสั่งลบสำเร็จ */
export async function deleteJobPhotoObjects(paths: readonly string[]): Promise<boolean> {
  const list = paths.filter((p) => typeof p === "string" && p !== "");
  if (list.length === 0) return true;
  try {
    const { error } = await getServiceClient().storage.from(JOB_PHOTOS_BUCKET).remove([...list]);
    if (error) throw error;
    return true;
  } catch (err) {
    logJobFailure("deleteJobPhotoObjects", err);
    return false;
  }
}

/**
 * อัปโหลด md แล้ว sm (upsert:false — ไม่ทับ path เดิม) · sm ล้ม = ลบ md ที่เพิ่งอัปให้ · ล้มช่วงใด = false (ไม่เหลือ object ของรูปนี้ ยกเว้นลบล้มซ้ำ = ไฟล์ค้างตามหนี้ sweep)
 * ไม่ throw
 */
export async function uploadJobPhotoPair(i: { mdPath: string; smPath: string; md: Uint8Array; sm: Uint8Array }): Promise<boolean> {
  const bucket = getServiceClient().storage.from(JOB_PHOTOS_BUCKET);
  try {
    const up1 = await bucket.upload(i.mdPath, i.md, { contentType: JPEG, upsert: false, cacheControl: "60" });
    if (up1.error) throw up1.error;
  } catch (err) {
    logJobFailure("uploadJobPhotoPair.md", err);
    return false;
  }
  try {
    const up2 = await bucket.upload(i.smPath, i.sm, { contentType: JPEG, upsert: false, cacheControl: "60" });
    if (up2.error) throw up2.error;
  } catch (err) {
    logJobFailure("uploadJobPhotoPair.sm", err);
    await deleteJobPhotoObjects([i.mdPath, i.smPath]); // sm อาจขึ้นครึ่งทาง — ลบทั้งคู่ (ลบ path ที่ไม่มี = ไม่ error)
    return false;
  }
  return true;
}
