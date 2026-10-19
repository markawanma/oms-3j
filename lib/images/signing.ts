// lib/images/signing.ts (เดิม lib/catalog/image-signing.ts) — server-side signed-URL helpers for the PRIVATE storage buckets:
//   · 'product-images' (SKU catalog photos · 0105) — signImagePath/signImagePaths · TTL 1 hr
//   · 'job-photos'     (รูปอ้างอิงบนใบงาน · 0182) — signJobPhotoPaths · TTL 15 min (JOB_PHOTO_SIGNED_URL_TTL_S)
//
// ย้ายจาก lib/catalog/ เพราะกราฟหน้าช่าง /w/ ห้าม import lib/catalog/** (lib/jobs/worker-boundary.test.ts) แต่ worker-server ต้องเซ็นรูปใบงานได้ —
// ไฟล์นี้อยู่นอกรายชื่อไฟล์กราฟช่าง (มี `.from(` ของ storage ได้) · worker-server เรียกเฉพาะ signJobPhotoPaths(client, paths) ที่ได้ path มาจาก RPC เท่านั้น
//
// Plain module (no "use server") — imported by "use server" action files, which may only export async functions themselves.
//
// Every function here degrades to null/an-empty-map on failure — NEVER throws. A broken thumbnail is an acceptable outcome; failing an entire page load over one
// unsignable image is not.
// 🔴 log เฉพาะ code + จำนวน — ห้ามพ่น error ทั้งก้อน/path/URL (บทเรียน supabase-error-logging-trap: details พ่วง host+stack · path มี uuid ร้าน/ใบ)

import type { SupabaseClient } from "@supabase/supabase-js";
import { BUCKET, JOB_PHOTOS_BUCKET, JOB_PHOTO_SIGNED_URL_TTL_S } from "@/lib/images/constants";

/** TTL for every signed URL this app hands out for SKU product images. 1 hour
 * comfortably outlives a single page view or admin session without needing
 * a refresh loop, while staying short enough that a URL copied out of
 * devtools stops working well within the same business day. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

/** log รูปร่างปลอดภัย: SQLSTATE/รหัส + ชื่อ error เท่านั้น (ไม่มี message/details/stack) */
function safeShape(err: unknown): { code: string | null; name: string | null } {
  const e = (typeof err === "object" && err !== null ? err : {}) as { code?: unknown; name?: unknown };
  return { code: typeof e.code === "string" ? e.code : null, name: typeof e.name === "string" ? e.name : null };
}

/**
 * Batch-signs many paths of ONE bucket in ONE Storage API call (createSignedUrls) — do NOT loop per path. Returns a Map keyed by the EXACT path string that was
 * requested, containing only paths that were both requested and successfully signed — callers treat a missing key as "no image" (never a hard error for one bad row).
 */
export async function signPaths(
  supabase: SupabaseClient,
  bucket: string,
  paths: readonly (string | null | undefined)[],
  ttlSeconds: number
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(paths.filter((p): p is string => typeof p === "string" && p !== "")));
  const result = new Map<string, string>();
  if (unique.length === 0) return result;
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls(unique, ttlSeconds);
    if (error || !data) {
      console.error("signPaths: batch signing failed", { bucket, count: unique.length, ...safeShape(error) });
      return result;
    }
    for (const entry of data) {
      // Per-item shape: { path, signedUrl, error }. A per-path failure (e.g. the object was deleted between the DB read and this call) shows up as entry.error,
      // NOT a thrown exception — skip just that one row rather than failing the whole batch.
      if (!entry.error && entry.signedUrl && entry.path) result.set(entry.path, entry.signedUrl);
    }
  } catch (err) {
    console.error("signPaths failed", { bucket, count: unique.length, ...safeShape(err) });
  }
  return result;
}

/** Signs ONE catalog-image path (1 hr). Prefer signImagePaths() whenever more than one path needs signing in the same request. */
export async function signImagePath(supabase: SupabaseClient, path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const m = await signPaths(supabase, BUCKET, [path], SIGNED_URL_TTL_SECONDS);
  return m.get(path) ?? null;
}

/** Batch-signs catalog-image paths (bucket 'product-images' · 1 hr) — same contract as before the move. */
export function signImagePaths(supabase: SupabaseClient, paths: (string | null | undefined)[]): Promise<Map<string, string>> {
  return signPaths(supabase, BUCKET, paths, SIGNED_URL_TTL_SECONDS);
}

/**
 * Batch-signs job-photo paths (bucket 'job-photos' · 15 min). 🔴 ผู้เรียกต้องส่ง path ที่ได้มาจาก DB/RPC หลังด่านสิทธิ์เท่านั้น (office: แถว job_photo ของร้านนี้ ·
 * ช่าง: job.photos จาก job_worker_resolve หลังระบุตัว) — ห้ามเซ็น path ที่ client ส่งมา
 */
export function signJobPhotoPaths(supabase: SupabaseClient, paths: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  return signPaths(supabase, JOB_PHOTOS_BUCKET, paths, JOB_PHOTO_SIGNED_URL_TTL_S);
}
