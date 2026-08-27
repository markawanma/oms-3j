"use server";

// lib/actions/labels.ts — server actions backing the label-upload feature
// (design: docs/3j-jewelry/analytics/design-label-upload.md). Same auth
// model as lib/actions/import-orders.ts / catalog.ts: getServiceClient()
// uses the service role (BYPASSES RLS) — requireOwnerAdmin() below is the
// only thing gating access. Every export here calls it first.
//
// File bytes never pass through a server action body (design §3, to dodge
// Next's serverActions.bodySizeLimit — labels run up to MAX_LABEL_FILE_BYTES
// / 300 pages, far past the 4MB budget lib/actions/import-orders.ts already
// uses up for .xlsx): createLabelUpload hands back a Supabase Storage signed
// upload URL; the browser PUTs bytes directly to Storage; parseLabelFile
// downloads server-side afterward. Only lib/actions/import-orders.ts's
// pattern (parse -> stage -> transform, best-effort sequential writes, mark
// 'failed' on error rather than a real DB transaction) is followed here too
// — same trade-off, same reason (supabase-js doesn't give this app a
// multi-statement transaction primitive).
//
// This module is deliberately "use server" + async-function-exports ONLY
// (lesson from 0ae940d: `export const` in a "use server" file breaks the
// build) — every constant/type this file needs lives in lib/labels/*
// (plain modules) instead.

import { revalidatePath } from "next/cache";
import { createHash } from "node:crypto";
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId, getDevRole } from "@/lib/dev/context";
import type { ActionResult } from "@/lib/types";
import {
  MAX_LABEL_FILE_BYTES,
  MAX_LABEL_PAGES,
  SHA256_HEX_PATTERN,
  SHIPPING_LABELS_BUCKET,
} from "@/lib/labels/constants";
import type { CreateLabelUploadResult, LabelParseSummary, LabelReviewRow } from "@/lib/labels/types";
import { looksLikePdf, openPdf, extractPageTexts, PdfExtractError } from "@/lib/labels/pdf";
import { detectFormat } from "@/lib/labels/formats";
import { matchProvince, type ProvinceCandidate } from "@/lib/labels/match";

const SCHEMA = "analytics";
const PARSER_VERSION = "labels-v1";
const TRACKING_LOOKUP_CHUNK_SIZE = 200;
const PAGE_INSERT_CHUNK_SIZE = 200;

function requireOwnerAdmin(): ActionResult<never> | null {
  if (getDevRole() === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่จัดการใบปะหน้าพัสดุได้" };
  }
  return null;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Storage path folder prefix — Asia/Bangkok for consistency with the rest of
 * the app's "business day" convention (skill 3j-migration-traps #6). This is
 * just a storage folder key, not a legal/business-critical value, but there's
 * no reason to introduce a UTC-vs-Bangkok inconsistency for no benefit. */
function bangkokYearMonth(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(d);
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "00";
  return `${year}-${month}`;
}

function revalidateLabelPaths(): void {
  revalidatePath("/tiktok/upload");
}

// ============================================================================
// createLabelUpload — validate -> dedupe by (shop_id, file_sha256) -> insert
// label_file(status='uploaded') -> signed upload URL. Design §1/§3.
// ============================================================================

export interface CreateLabelUploadInput {
  fileName: string;
  fileSize: number;
  sha256: string;
}

export async function createLabelUpload(
  input: CreateLabelUploadInput
): Promise<ActionResult<CreateLabelUploadResult>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  // security 2a (Medium #5): ตัด control chars + RTL/LTR override (U+202E ทำชื่อ
  // บนจอกลับด้าน หลอกพนักงานได้) + จำกัด 255 ตัวอักษรกัน row bloat
  const fileName = (input?.fileName ?? "")
    .trim()
    .replace(/[\u0000-\u001F\u200E\u200F\u202A-\u202E]/g, "")
    .slice(0, 255);
  const fileSize = Number(input?.fileSize);
  const sha256 = (input?.sha256 ?? "").trim().toLowerCase();

  if (!fileName) return { ok: false, error: "ไม่พบชื่อไฟล์" };
  if (!fileName.toLowerCase().endsWith(".pdf")) {
    return { ok: false, error: "รองรับเฉพาะไฟล์ .pdf เท่านั้น (เฟสนี้ยังไม่รองรับรูปถ่าย/JPG/PNG)" };
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return { ok: false, error: "ขนาดไฟล์ไม่ถูกต้อง" };
  }
  if (fileSize > MAX_LABEL_FILE_BYTES) {
    return {
      ok: false,
      error: `ไฟล์ใหญ่เกิน ${(MAX_LABEL_FILE_BYTES / 1024 / 1024).toFixed(0)}MB (${(fileSize / 1024 / 1024).toFixed(1)}MB)`,
    };
  }
  if (!SHA256_HEX_PATTERN.test(sha256)) {
    return { ok: false, error: "sha256 ที่ส่งมาไม่ถูกต้อง (ต้องเป็น hex 64 ตัวอักษร)" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data: existing, error: existingErr } = await supabase
      .schema(SCHEMA)
      .from("label_file")
      .select("id, status, storage_path")
      .eq("shop_id", shopId)
      .eq("file_sha256", sha256)
      .maybeSingle();
    if (existingErr) throw existingErr;

    // dedupe (design §1: "sha256 เป็นชื่อไฟล์ = dedupe โดยโครงสร้าง") — EXCEPT
    // when the previous record was already 'purged' by retention: the
    // storage object is gone, so re-uploading genuinely needs a fresh signed
    // URL rather than pointing the UI at bytes that no longer exist. Not an
    // explicit design case — flagged in the handoff report.
    if (existing && existing.status !== "purged") {
      // security 2a (Medium #3): แถว DB มี ≠ bytes ขึ้น storage แล้วจริง — ถ้า PUT
      // รอบก่อนล้ม (เน็ตหลุด/ปิดแท็บ) การตอบ alreadyExists จะพาไฟล์นั้นติดตาย
      // ถาวร (parse หา object ไม่เจอ -> parse_failed -> วนซ้ำ) จึงเช็คว่า object
      // มีจริงก่อน ถ้าไม่มีให้ออก signed URL ใหม่บน path เดิมแทน
      const existingPath = String(existing.storage_path ?? "");
      const dirEnd = existingPath.lastIndexOf("/");
      const { data: found } = await supabase.storage
        .from(SHIPPING_LABELS_BUCKET)
        .list(existingPath.slice(0, dirEnd), { search: existingPath.slice(dirEnd + 1), limit: 1 });
      if (found && found.length > 0) {
        return { ok: true, data: { fileId: String(existing.id), uploadUrl: null, alreadyExists: true } };
      }
      const { data: reSigned, error: reSignErr } = await supabase.storage
        .from(SHIPPING_LABELS_BUCKET)
        .createSignedUploadUrl(existingPath);
      if (reSignErr || !reSigned) throw reSignErr ?? new Error("createSignedUploadUrl returned no data");
      const { error: reviveErr } = await supabase
        .schema(SCHEMA)
        .from("label_file")
        .update({ status: "uploaded", file_name: fileName, file_size_bytes: fileSize, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
        .eq("shop_id", shopId);
      if (reviveErr) throw reviveErr;
      return { ok: true, data: { fileId: String(existing.id), uploadUrl: reSigned.signedUrl, alreadyExists: false } };
    }

    const path = `${shopId}/${bangkokYearMonth()}/${sha256}.pdf`;
    let fileId: string;

    if (existing) {
      const { error: updErr } = await supabase
        .schema(SCHEMA)
        .from("label_file")
        .update({
          storage_path: path,
          file_name: fileName,
          file_size_bytes: fileSize,
          page_count: null,
          status: "uploaded",
          parser_version: null,
          uploaded_at: new Date().toISOString(),
          parsed_at: null,
          purged_at: null,
        })
        .eq("id", existing.id)
        .eq("shop_id", shopId);
      if (updErr) throw updErr;
      fileId = String(existing.id);

      // clear stale review rows from the purged file's previous parse — the
      // storage object (and therefore any provable match) is gone.
      const { error: delPagesErr } = await supabase
        .schema(SCHEMA)
        .from("stg_label_page")
        .delete()
        .eq("label_file_id", fileId);
      if (delPagesErr) throw delPagesErr;
    } else {
      const { data: inserted, error: insErr } = await supabase
        .schema(SCHEMA)
        .from("label_file")
        .insert({
          shop_id: shopId,
          storage_path: path,
          file_name: fileName,
          file_sha256: sha256,
          file_size_bytes: fileSize,
          status: "uploaded",
        })
        .select("id")
        .single();
      if (insErr) {
        // 23505 = unique_violation on (shop_id, file_sha256) — a concurrent
        // upload of the same file won the race between our SELECT above and
        // this INSERT. Surface as the normal dedupe path, not a hard error.
        if ((insErr as { code?: string }).code === "23505") {
          const { data: raced } = await supabase
            .schema(SCHEMA)
            .from("label_file")
            .select("id")
            .eq("shop_id", shopId)
            .eq("file_sha256", sha256)
            .maybeSingle();
          if (raced) {
            return { ok: true, data: { fileId: String(raced.id), uploadUrl: null, alreadyExists: true } };
          }
        }
        throw insErr;
      }
      fileId = String(inserted.id);
    }

    const { data: signed, error: signErr } = await supabase.storage
      .from(SHIPPING_LABELS_BUCKET)
      .createSignedUploadUrl(path);
    if (signErr || !signed) {
      // best-effort rollback — don't leave a dangling 'uploaded' row with no
      // way to actually upload bytes to it.
      try {
        await supabase.schema(SCHEMA).from("label_file").delete().eq("id", fileId).eq("shop_id", shopId);
      } catch (rollbackErr) {
        console.error("createLabelUpload: rollback after signed-URL failure also failed", rollbackErr);
      }
      throw signErr ?? new Error("createSignedUploadUrl returned no data");
    }

    revalidateLabelPaths();
    return { ok: true, data: { fileId, uploadUrl: signed.signedUrl, alreadyExists: false } };
  } catch (err) {
    console.error("createLabelUpload failed", err);
    return { ok: false, error: "เตรียมอัปโหลดไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// parseLabelFile — download -> validate -> extract per-page text -> classify
// (format detect + tracking extract + province match) -> DB order lookup ->
// replace stg_label_page for this file -> RPC label_apply_matched -> summary.
// Design §3/§4/§5.
// ============================================================================

interface PageClassification {
  pageNo: number;
  detectedFormat: string | null;
  trackingNo: string | null;
  zipcode: string | null;
  provinceCode: string | null;
  candidates: ProvinceCandidate[];
  status: "matched" | "needs_review" | "order_not_found" | "undetected" | "parse_failed";
}

/** Pure per-page classification — no DB access (the order-not-found
 * reclassification happens afterward, batched, in parseLabelFile itself). */
function classifyPage(pageNo: number, pageText: string): PageClassification {
  const base = {
    pageNo,
    detectedFormat: null as string | null,
    trackingNo: null as string | null,
    zipcode: null as string | null,
    provinceCode: null as string | null,
    candidates: [] as ProvinceCandidate[],
  };

  if (!pageText || pageText.trim().length === 0) {
    return { ...base, status: "parse_failed" };
  }

  const format = detectFormat(pageText);
  if (!format) {
    return { ...base, status: "undetected" };
  }

  const extract = format.extract(pageText);
  const province = matchProvince(pageText);

  if (!extract.trackingNo) {
    // ambiguous (>1 distinct tracking number) or, defensively, 0 matches
    // despite detect() succeeding — either way a human needs to look at it
    // (design §4 rule 7). Candidates still recorded for review context.
    return {
      ...base,
      detectedFormat: format.id,
      zipcode: province.zipcode,
      candidates: province.candidates,
      status: "needs_review",
    };
  }

  if (province.status !== "matched") {
    return {
      ...base,
      detectedFormat: format.id,
      trackingNo: extract.trackingNo,
      zipcode: province.zipcode,
      candidates: province.candidates,
      status: "needs_review",
    };
  }

  return {
    ...base,
    detectedFormat: format.id,
    trackingNo: extract.trackingNo,
    zipcode: province.zipcode,
    provinceCode: province.provinceCode,
    candidates: province.candidates,
    status: "matched", // tentative — reclassified to order_not_found below if no fact_order row matches
  };
}

export async function parseLabelFile(fileId: string): Promise<ActionResult<LabelParseSummary>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const cleanFileId = (fileId ?? "").trim();
  if (!cleanFileId) return { ok: false, error: "ไม่พบไฟล์ที่จะอ่าน" };

  const shopId = getDevShopId();
  const supabase = getServiceClient();

  try {
    const { data: file, error: fileErr } = await supabase
      .schema(SCHEMA)
      .from("label_file")
      .select("id, storage_path, file_name, file_sha256, status")
      .eq("id", cleanFileId)
      .eq("shop_id", shopId)
      .maybeSingle();
    if (fileErr) throw fileErr;
    if (!file) return { ok: false, error: "ไม่พบไฟล์นี้ในร้าน" };
    if (file.status === "purged") {
      return { ok: false, error: "ไฟล์นี้ถูกลบตามนโยบายเก็บข้อมูลแล้ว — อัปโหลดใหม่ก่อนอ่าน" };
    }

    const { data: blob, error: downloadErr } = await supabase.storage
      .from(SHIPPING_LABELS_BUCKET)
      .download(file.storage_path);
    if (downloadErr || !blob) {
      throw downloadErr ?? new Error("storage download returned no data");
    }

    // security 2a (High #1): เพดานขนาดต้องวัดจาก bytes จริงใน storage ฝั่ง server
    // — ตัวเลขตอน createLabelUpload มาจาก client ล้วนๆ เชื่อไม่ได้ และต้องเช็ค
    // ก่อน arrayBuffer() ไม่งั้นไฟล์ 2GB ถูกดูดเข้า heap ก่อนถึงด่าน
    // object ที่ผิดกติกา = ลบทิ้งทันที ไม่ปล่อยขยะค้างในบัคเก็ต
    if (blob.size > MAX_LABEL_FILE_BYTES) {
      await supabase.storage.from(SHIPPING_LABELS_BUCKET).remove([file.storage_path]);
      await markFileParseFailed(supabase, cleanFileId, shopId);
      return { ok: false, error: "ไฟล์จริงในระบบใหญ่เกิน 20MB — อัปโหลดใหม่" };
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());

    if (!looksLikePdf(bytes)) {
      await supabase.storage.from(SHIPPING_LABELS_BUCKET).remove([file.storage_path]);
      await markFileParseFailed(supabase, cleanFileId, shopId);
      return { ok: false, error: "ไฟล์นี้ไม่ใช่ PDF จริง (magic bytes ไม่ตรง) — อัปโหลดใหม่" };
    }

    // defensive integrity check — the sha256 was computed client-side at
    // upload time; re-verify server-side against what actually landed in
    // storage before trusting it as this file's identity.
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (actualSha256 !== file.file_sha256) {
      // security 2a (High #1): ของปลอมต้องถูกเก็บกวาด ไม่ใช่แค่ mark แล้วปล่อยค้าง
      await supabase.storage.from(SHIPPING_LABELS_BUCKET).remove([file.storage_path]);
      await markFileParseFailed(supabase, cleanFileId, shopId);
      return { ok: false, error: "ไฟล์ในระบบเก็บข้อมูลไม่ตรงกับ sha256 ที่บันทึกไว้ — อัปโหลดใหม่" };
    }

    let pdf;
    try {
      pdf = await openPdf(bytes);
    } catch (err) {
      await markFileParseFailed(supabase, cleanFileId, shopId);
      if (err instanceof PdfExtractError) {
        return { ok: false, error: "เปิดไฟล์ PDF ไม่สำเร็จ (ไฟล์เสียหายหรือมีรหัสผ่าน) — อัปโหลดใหม่" };
      }
      throw err;
    }

    if (pdf.numPages > MAX_LABEL_PAGES) {
      await markFileParseFailed(supabase, cleanFileId, shopId);
      return {
        ok: false,
        error: `ไฟล์นี้มี ${pdf.numPages} หน้า เกินขีดจำกัด ${MAX_LABEL_PAGES} หน้าต่อไฟล์ — แยกไฟล์แล้วอัปโหลดใหม่`,
      };
    }

    const pageTexts = await extractPageTexts(pdf);

    // 1st pass: pure classification (no DB).
    const classified = pageTexts.map((text, i) => classifyPage(i + 1, text));

    // 2nd pass: batched fact_order existence lookup for tentatively-"matched"
    // pages — tracking not found among this shop's orders => order_not_found
    // (design §"เคสห้ามผ่าน" #5: "tracking ไม่ match ออเดอร์ใด → ไม่เขียนอะไร +
    // โผล่ summary เป็น order_not_found").
    const trackingToCheck = [
      ...new Set(classified.filter((p) => p.status === "matched" && p.trackingNo).map((p) => p.trackingNo as string)),
    ];
    const foundTracking = new Set<string>();
    for (const chunk of chunkArray(trackingToCheck, TRACKING_LOOKUP_CHUNK_SIZE)) {
      const { data: rows, error: lookupErr } = await supabase
        .schema(SCHEMA)
        .from("fact_order")
        .select("tracking_no")
        .eq("shop_id", shopId)
        .in("tracking_no", chunk);
      if (lookupErr) throw lookupErr;
      for (const r of (rows ?? []) as { tracking_no: string }[]) foundTracking.add(r.tracking_no);
    }

    const finalRows = classified.map((p) => {
      if (p.status === "matched" && p.trackingNo && !foundTracking.has(p.trackingNo)) {
        return { ...p, status: "order_not_found" as const };
      }
      return p;
    });

    // Replace this file's stg_label_page set wholesale (design §2: "ปุ่ม
    // 'อ่านใหม่' download+parse ทับ stg ชุดเดิมของไฟล์นี้" — re-parse can
    // legitimately produce a different page count/classification than the
    // last run, so a delete-then-insert is used instead of an upsert that
    // could leave stale rows beyond the new page count. Not a single atomic
    // DB transaction — same sequential-steps trade-off as
    // lib/actions/import-orders.ts's commitOrderImport).
    // security 2a (Medium #4): แถวที่ apply แล้วถือหลักฐาน revert
    // (fact_order_ids + applied_prev_code) — "อ่านใหม่" ห้ามลบทิ้ง ลบเฉพาะแถว
    // ที่ยังไม่ apply แล้ว insert เฉพาะหน้า่ที่ไม่ชนหน้า applied เดิม
    const { data: appliedRows, error: appliedErr } = await supabase
      .schema(SCHEMA)
      .from("stg_label_page")
      .select("page_no")
      .eq("label_file_id", cleanFileId)
      .eq("shop_id", shopId)
      .not("applied_at", "is", null);
    if (appliedErr) throw appliedErr;
    const appliedPageNos = new Set(((appliedRows ?? []) as { page_no: number }[]).map((r) => r.page_no));

    const { error: delErr } = await supabase
      .schema(SCHEMA)
      .from("stg_label_page")
      .delete()
      .eq("label_file_id", cleanFileId)
      .eq("shop_id", shopId)
      .is("applied_at", null);
    if (delErr) throw delErr;

    const insertRows = finalRows.filter((p) => !appliedPageNos.has(p.pageNo)).map((p) => ({
      label_file_id: cleanFileId,
      shop_id: shopId,
      page_no: p.pageNo,
      detected_format: p.detectedFormat,
      tracking_no: p.trackingNo,
      zipcode: p.zipcode,
      province_code: p.provinceCode,
      match_status: p.status,
      // PDPA (design §7, ข้อบังคับ): candidates only ({code,nameTh}[]) — never
      // raw page text / name / phone / full address.
      match_detail: { candidates: p.candidates },
    }));
    for (const chunk of chunkArray(insertRows, PAGE_INSERT_CHUNK_SIZE)) {
      const { error: insPagesErr } = await supabase.schema(SCHEMA).from("stg_label_page").insert(chunk);
      if (insPagesErr) throw insPagesErr;
    }

    const { error: updFileErr } = await supabase
      .schema(SCHEMA)
      .from("label_file")
      .update({
        status: "parsed",
        page_count: pageTexts.length,
        parser_version: PARSER_VERSION,
        parsed_at: new Date().toISOString(),
      })
      .eq("id", cleanFileId)
      .eq("shop_id", shopId);
    if (updFileErr) throw updFileErr;

    // Auto-apply matched pages (design §5) — guarded structurally in SQL
    // (0097: fo.province_code = 'TH-XX'), never in application code.
    const { data: applyResult, error: applyErr } = await supabase
      .schema(SCHEMA)
      .rpc("label_apply_matched", { p_shop_id: shopId, p_file_id: cleanFileId });
    if (applyErr) throw applyErr;
    const applyRow = (Array.isArray(applyResult) ? applyResult[0] : applyResult) as
      | { applied?: number; skipped_has_province?: number; conflict_cnt?: number }
      | null;

    // Re-read the post-RPC state (label_apply_matched may have flipped some
    // rows to 'conflict'/'order_not_found') to build the review queue and the
    // counts that aren't returned directly by the RPC.
    const { data: finalPages, error: finalErr } = await supabase
      .schema(SCHEMA)
      .from("stg_label_page")
      .select("id, page_no, tracking_no, zipcode, match_status, match_detail")
      .eq("label_file_id", cleanFileId)
      .eq("shop_id", shopId)
      .order("page_no", { ascending: true });
    if (finalErr) throw finalErr;

    type FinalPageRow = {
      id: string;
      page_no: number;
      tracking_no: string | null;
      zipcode: string | null;
      match_status: string;
      match_detail: { candidates?: ProvinceCandidate[] } | null;
    };

    const rows = (finalPages ?? []) as FinalPageRow[];
    let needsReview = 0;
    let orderNotFound = 0;
    let undetectedFormat = 0;
    let parseFailedPages = 0;
    const reviewRows: LabelReviewRow[] = [];

    for (const r of rows) {
      switch (r.match_status) {
        case "needs_review":
          needsReview += 1;
          break;
        case "order_not_found":
          orderNotFound += 1;
          break;
        case "undetected":
          undetectedFormat += 1;
          break;
        case "parse_failed":
          parseFailedPages += 1;
          break;
        default:
          break;
      }
      if (
        r.match_status === "needs_review" ||
        r.match_status === "conflict" ||
        r.match_status === "order_not_found" ||
        r.match_status === "undetected" ||
        r.match_status === "parse_failed"
      ) {
        reviewRows.push({
          pageId: r.id,
          pageNo: r.page_no,
          trackingNo: r.tracking_no,
          zipcode: r.zipcode,
          status: r.match_status as LabelReviewRow["status"],
          candidates: r.match_detail?.candidates ?? [],
        });
      }
    }

    revalidateLabelPaths();

    return {
      ok: true,
      data: {
        fileId: cleanFileId,
        fileName: file.file_name,
        pageCount: pageTexts.length,
        applied: Number(applyRow?.applied) || 0,
        skippedHasProvince: Number(applyRow?.skipped_has_province) || 0,
        conflictCount: Number(applyRow?.conflict_cnt) || 0,
        needsReview,
        orderNotFound,
        undetectedFormat,
        parseFailedPages,
        reviewRows,
      },
    };
  } catch (err) {
    console.error("parseLabelFile failed", err);
    await markFileParseFailed(supabase, cleanFileId, shopId).catch((markErr) =>
      console.error("parseLabelFile: failed to mark file as parse_failed", markErr)
    );
    return { ok: false, error: "อ่านไฟล์ไม่สำเร็จ ระบบทำเครื่องหมายไฟล์นี้เป็น parse_failed แล้ว ลองใหม่อีกครั้งได้ทันที" };
  }
}

async function markFileParseFailed(
  supabase: ReturnType<typeof getServiceClient>,
  fileId: string,
  shopId: string
): Promise<void> {
  await supabase.schema(SCHEMA).from("label_file").update({ status: "parse_failed" }).eq("id", fileId).eq("shop_id", shopId);
}

// ============================================================================
// getLabelFiles — recent upload history (design §"เปลี่ยนผ่านจาก simulation").
// ============================================================================

export interface LabelFileRow {
  id: string;
  fileName: string;
  pageCount: number | null;
  status: "uploaded" | "parsed" | "parse_failed" | "purged";
  uploadedAt: string;
}

const LABEL_FILE_STATUSES = ["uploaded", "parsed", "parse_failed", "purged"] as const;

export async function getLabelFiles(): Promise<ActionResult<LabelFileRow[]>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("label_file")
      .select("id, file_name, page_count, status, uploaded_at")
      .eq("shop_id", shopId)
      .order("uploaded_at", { ascending: false })
      .limit(50);
    if (error) throw error;

    const rows: LabelFileRow[] = (
      (data ?? []) as { id: string; file_name: string; page_count: number | null; status: string; uploaded_at: string }[]
    ).map((r) => ({
      id: r.id,
      fileName: r.file_name,
      pageCount: r.page_count,
      status: (LABEL_FILE_STATUSES as readonly string[]).includes(r.status)
        ? (r.status as LabelFileRow["status"])
        : "uploaded",
      uploadedAt: r.uploaded_at,
    }));

    return { ok: true, data: rows };
  } catch (err) {
    console.error("getLabelFiles failed", err);
    return { ok: false, error: "โหลดประวัติไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
