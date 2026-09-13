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
import { fetchAllRows } from "@/lib/supabase/query-limits";
import { isPostgrestInSafe } from "@/lib/import/source-types";
import {
  MAX_LABEL_FILE_BYTES,
  MAX_LABEL_PAGES,
  SHA256_HEX_PATTERN,
  SHIPPING_LABELS_BUCKET,
} from "@/lib/labels/constants";
import {
  LABEL_REASON_CODES,
  type CreateLabelUploadResult,
  type LabelParseSummary,
  type LabelPageSnippetResult,
  type LabelPageViewUrlResult,
  type LabelReasonCode,
  type LabelReviewRow,
  type OrderSourceRef,
  type PendingLabelReviewRow,
  type ResolveLabelPageResult,
} from "@/lib/labels/types";
import { looksLikePdf, openPdf, extractPageTexts, extractSinglePageText, PdfExtractError } from "@/lib/labels/pdf";
import { detectFormat, looksLikePackingSlipOnly } from "@/lib/labels/formats";
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

// L8 fix (12 ก.ย. 69, QA), widened by QA-3 (13 ก.ย. 69): setOrderProvince/
// revertOrderProvince/resolveLabelPage/revertLabelPage all write
// analytics.fact_order.province_code directly (not just stg_label_page) — a
// stale cache on any page that renders province would show the old value
// right after a successful edit until some OTHER action happened to
// revalidate that route. QA-3 found the original list incomplete: it covered
// /crm/orders + /crm/customers (list pages) but not the customer DETAIL page
// (dynamic route, own revalidatePath call — a list-path revalidate does NOT
// cover a `[id]` dynamic segment), nor /crm/overview (province breakdown
// widgets) or /tiktok/dashboard (province_source ends up in its channel/
// province mix once TikTok live orders get relabeled here). ignoreLabelPage
// does NOT call this — it never touches fact_order, only
// revalidateLabelPaths() applies.
function revalidateProvinceChangePaths(): void {
  revalidateLabelPaths();
  revalidatePath("/crm/orders");
  revalidatePath("/crm/customers");
  revalidatePath("/crm/customers/[id]", "page");
  revalidatePath("/crm/overview");
  revalidatePath("/tiktok/dashboard");
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

  // security 2a (Medium #5 + re-check): ตัด control chars + bidi ทุกชุด (รวม
  // isolate ยุคใหม่ U+2066-2069 ที่สปูฟชื่อได้เหมือน U+202E) + zero-width ·
  // เช็ค .pdf จาก "ชื่อเต็มก่อนตัด" (ชื่อยาว 300 ตัวที่เป็น PDF จริงต้องไม่โดน
  // ปฏิเสธด้วยข้อความโกหก) · ตัด 255 แบบ code point ไม่ผ่ากลาง surrogate
  // (อีโมจิครึ่งตัวทำ Postgres ตีกลับเป็น 500)
  const rawName = (input?.fileName ?? "")
    .trim()
    .replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "");
  const fileName = [...rawName].slice(0, 255).join("");
  const fileSize = Number(input?.fileSize);
  const sha256 = (input?.sha256 ?? "").trim().toLowerCase();

  if (!fileName) return { ok: false, error: "ไม่พบชื่อไฟล์" };
  if (!rawName.toLowerCase().endsWith(".pdf")) {
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
      const { data: found, error: listErr } = await supabase.storage
        .from(SHIPPING_LABELS_BUCKET)
        .list(existingPath.slice(0, dirEnd), { search: existingPath.slice(dirEnd + 1), limit: 1 });
      // security re-check: ตรวจไม่ได้ (list error) = ถือว่า object มีไว้ก่อน —
      // fail ไปทางที่ไม่ถอยสถานะงานที่เสร็จแล้ว (network blip ห้ามลดชั้นไฟล์
      // parsed กลับเป็น uploaded) ผู้ใช้แค่กดใหม่
      if (listErr || (found && found.length > 0)) {
        return { ok: true, data: { fileId: String(existing.id), uploadUrl: null, alreadyExists: true } };
      }
      const { data: reSigned, error: reSignErr } = await supabase.storage
        .from(SHIPPING_LABELS_BUCKET)
        .createSignedUploadUrl(existingPath);
      if (reSignErr || !reSigned) throw reSignErr ?? new Error("createSignedUploadUrl returned no data");
      const { error: reviveErr } = await supabase
        .schema(SCHEMA)
        .from("label_file")
        .update({
          status: "uploaded",
          file_name: fileName,
          file_size_bytes: fileSize,
          page_count: null,
          parsed_at: null,
          parser_version: null,
          updated_at: new Date().toISOString(),
        })
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
  /** UAT 29 ส.ค. 69: 'undetected' pages are not automatically a problem — a
   * known subset (TikTok's trailing packing-slip-only page) is a real,
   * expected non-label page. Recorded into match_detail (jsonb, no schema
   * change) so getPendingLabelReviews()/the review-queue UI can say "not a
   * label" instead of "unrecognized format." undefined = no known reason. */
  reason?: "packing_slip_only";
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
    return {
      ...base,
      status: "undetected",
      reason: looksLikePackingSlipOnly(pageText) ? "packing_slip_only" : undefined,
    };
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
      // raw page text / name / phone / full address. `reason` is a fixed
      // enum-like classification hint (see PageClassification), also PDPA-safe.
      match_detail: { candidates: p.candidates, reason: p.reason },
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
      match_detail: { candidates?: ProvinceCandidate[]; reason?: "packing_slip_only" } | null;
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
          reason: r.match_detail?.reason,
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
  // "อ่านใหม่" hint (task brief 4 ก.ย. 69) — see comment block below
  // getLabelFiles() for how these are computed and why they can be null.
  orderNotFoundCount: number | null;
  rematchableCount: number | null;
}

const LABEL_FILE_STATUSES = ["uploaded", "parsed", "parse_failed", "purged"] as const;

interface OrderNotFoundPageRow {
  label_file_id: string;
  tracking_no: string | null;
}

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

    const baseRows = (
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

    // "อ่านใหม่" hint (task brief 4 ก.ย. 69, §2 "กดแล้วได้อะไร") — per file:
    // how many pages are stuck at order_not_found, and of those, how many
    // now have a matching fact_order row (i.e. worth clicking "อ่านใหม่" for).
    // Deliberately best-effort and separate from the file-list query above:
    // this is read-only, nice-to-have context on top of a list that must
    // always render — any failure here degrades BOTH counts to null on
    // EVERY file rather than failing getLabelFiles() (and the whole history
    // table) outright.
    const orderNotFoundCountByFile = new Map<string, number>();
    const rematchableCountByFile = new Map<string, number>();
    let countsAvailable = true;

    if (baseRows.length > 0) {
      try {
        // label_file.id values are our own just-read UUID primary keys, not
        // user-controlled text — safe to .in() directly (isPostgrestInSafe
        // below guards the untrusted value: tracking_no lifted off a PDF).
        const fileIds = baseRows.map((r) => r.id);

        const pageResult = await fetchAllRows<OrderNotFoundPageRow>((from, to) =>
          supabase
            .schema(SCHEMA)
            .from("stg_label_page")
            .select("label_file_id, tracking_no", { count: "exact" })
            .eq("shop_id", shopId)
            .eq("match_status", "order_not_found")
            .in("label_file_id", fileIds)
            .order("id", { ascending: true })
            .range(from, to)
        );
        if (pageResult.truncated) {
          // Same rule as everywhere else fetchAllRows() is used in this app
          // (see lib/supabase/query-limits.ts header, the ฿9,423 incident):
          // never show a count we know is incomplete — treat as "couldn't
          // check" and let the catch below null out both counts.
          throw new Error("getLabelFiles: order_not_found page read truncated, cannot count reliably");
        }

        for (const p of pageResult.rows) {
          orderNotFoundCountByFile.set(p.label_file_id, (orderNotFoundCountByFile.get(p.label_file_id) ?? 0) + 1);
        }

        // security 0901 (isPostgrestInSafe, lib/import/source-types.ts):
        // tracking_no came off a PDF the owner uploaded — untrusted text.
        // postgrest-js's .in() does not escape a literal `"`, so a
        // crafted/corrupted value could otherwise widen or narrow the match
        // silently. A value that fails the check is dropped from the lookup
        // set entirely — never guessed, never counted as rematchable (but
        // its page still counts toward orderNotFoundCount above, which is
        // already locked in and unaffected by this filter).
        const trackingToCheck = [
          ...new Set(
            pageResult.rows.map((p) => p.tracking_no).filter((t): t is string => !!t && isPostgrestInSafe(t))
          ),
        ];

        const foundTracking = new Set<string>();
        for (const chunk of chunkArray(trackingToCheck, TRACKING_LOOKUP_CHUNK_SIZE)) {
          const { data: foundRows, error: lookupErr } = await supabase
            .schema(SCHEMA)
            .from("fact_order")
            .select("tracking_no")
            .eq("shop_id", shopId)
            .in("tracking_no", chunk);
          if (lookupErr) throw lookupErr;
          for (const r of (foundRows ?? []) as { tracking_no: string }[]) foundTracking.add(r.tracking_no);
        }

        for (const p of pageResult.rows) {
          if (p.tracking_no && isPostgrestInSafe(p.tracking_no) && foundTracking.has(p.tracking_no)) {
            rematchableCountByFile.set(p.label_file_id, (rematchableCountByFile.get(p.label_file_id) ?? 0) + 1);
          }
        }
      } catch (countErr) {
        console.error("getLabelFiles: order_not_found/rematchable count failed, degrading to null", countErr);
        countsAvailable = false;
      }
    }

    const rows: LabelFileRow[] = baseRows.map((r) => ({
      ...r,
      orderNotFoundCount: countsAvailable ? orderNotFoundCountByFile.get(r.id) ?? 0 : null,
      rematchableCount: countsAvailable ? rematchableCountByFile.get(r.id) ?? 0 : null,
    }));

    return { ok: true, data: rows };
  } catch (err) {
    console.error("getLabelFiles failed", err);
    return { ok: false, error: "โหลดประวัติไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// getPendingLabelReviews — bug 2 (UAT 29 ส.ค. 69): "ขึ้นว่ารอคนตรวจ แต่พอกดไป
// หน้าอื่นแล้วกลับมา ส่วนที่รอคนตรวจหายไป" — LabelParseSummary.reviewRows only
// ever lived in UploadPageClient's React state for the upload round that just
// ran; the queue itself lives durably in analytics.stg_label_page regardless.
// This reads that DB state directly — "ทั้งร้าน" across every file, not just
// the last upload — so the review queue survives navigation/refresh.
// ============================================================================

const PENDING_REVIEW_STATUSES = ["needs_review", "conflict", "order_not_found", "undetected"] as const;
const PENDING_REVIEW_FILE_LOOKUP_CHUNK_SIZE = 200;

interface PendingReviewPageRow {
  id: string;
  label_file_id: string;
  page_no: number;
  tracking_no: string | null;
  zipcode: string | null;
  match_status: string;
  match_detail: { candidates?: ProvinceCandidate[]; reason?: "packing_slip_only" } | null;
}

export async function getPendingLabelReviews(): Promise<ActionResult<PendingLabelReviewRow[]>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    // fetchAllRows() pages past PostgREST's max-rows cap — see
    // lib/supabase/query-limits.ts. Ordered by `id` (unique per row) as
    // required for correct paging; display order (by file, then page) is
    // applied client-side below once every row is in hand.
    const pageResult = await fetchAllRows<PendingReviewPageRow>((from, to) =>
      supabase
        .schema(SCHEMA)
        .from("stg_label_page")
        .select("id, label_file_id, page_no, tracking_no, zipcode, match_status, match_detail", { count: "exact" })
        .eq("shop_id", shopId)
        .in("match_status", PENDING_REVIEW_STATUSES)
        .order("id", { ascending: true })
        .range(from, to)
    );
    if (pageResult.truncated) {
      // Not expected at this app's volume (see MAX_UNBOUNDED_ROWS comment)
      // but fail loudly rather than silently show a partial queue.
      console.error("getPendingLabelReviews: row cap hit, queue truncated", {
        rows: pageResult.rows.length,
        totalCount: pageResult.totalCount,
      });
      return {
        ok: false,
        error: `คิวรอตรวจมีมากกว่าที่ระบบแสดงได้ตอนนี้ (${pageResult.totalCount} หน้า) — แจ้งทีมเทคนิค`,
      };
    }

    const fileIds = [...new Set(pageResult.rows.map((r) => r.label_file_id))];
    const fileNameById = new Map<string, string>();
    for (let i = 0; i < fileIds.length; i += PENDING_REVIEW_FILE_LOOKUP_CHUNK_SIZE) {
      const chunk = fileIds.slice(i, i + PENDING_REVIEW_FILE_LOOKUP_CHUNK_SIZE);
      const { data, error } = await supabase
        .schema(SCHEMA)
        .from("label_file")
        .select("id, file_name")
        .eq("shop_id", shopId)
        .in("id", chunk);
      if (error) throw error;
      for (const f of (data ?? []) as { id: string; file_name: string }[]) fileNameById.set(f.id, f.file_name);
    }

    // Owner 11 ก.ย. 69, decision #3 ("ทุกแถวต้องบอกที่มาให้เจ้าของเปิดอ่านเองได้"):
    // ฝั่งออเดอร์ (stg_import_batch.file_name + stg_order_import.source_row_no ของ
    // แถวล่าสุดที่ fact_order_id ชี้มา) ต่อจากฝั่งใบปะหน้าที่มีอยู่แล้วด้านบน. เฉพาะ
    // หน้าที่มี trackingNo เท่านั้นที่พอจะหาออเดอร์ได้ — best-effort เหมือน
    // getLabelFiles' rematchableCount ข้างบน: ล้มเหลว = orderSources ว่างเปล่า
    // ทุกแถว ไม่ใช่ทำให้ทั้งคิวโหลดไม่ขึ้น.
    const orderSourcesByTracking = new Map<string, OrderSourceRef[]>();
    try {
      const trackingNos = [
        ...new Set(
          pageResult.rows.map((r) => r.tracking_no).filter((t): t is string => !!t && isPostgrestInSafe(t))
        ),
      ];

      interface FactOrderByTrackingRow {
        id: string;
        source_order_no: string;
        tracking_no: string | null;
        province_code: string;
        province_source: "import" | "label" | "manual";
      }
      const ordersByTracking = new Map<string, FactOrderByTrackingRow[]>();
      for (const chunk of chunkArray(trackingNos, TRACKING_LOOKUP_CHUNK_SIZE)) {
        const { data, error } = await supabase
          .schema(SCHEMA)
          .from("fact_order")
          .select("id, source_order_no, tracking_no, province_code, province_source")
          .eq("shop_id", shopId)
          .in("tracking_no", chunk);
        if (error) throw error;
        for (const o of (data ?? []) as FactOrderByTrackingRow[]) {
          if (!o.tracking_no) continue;
          const arr = ordersByTracking.get(o.tracking_no) ?? [];
          arr.push(o);
          ordersByTracking.set(o.tracking_no, arr);
        }
      }

      const allOrderIds = [...ordersByTracking.values()].flat().map((o) => o.id);

      interface StgOrderImportSourceRow {
        fact_order_id: string | null;
        batch_id: string;
        source_row_no: number | null;
        created_at: string;
      }
      // "แถวล่าสุดที่ fact_order_id ชี้มา" — sort ฝั่ง DB ด้วย created_at desc
      // แล้วเก็บแค่ตัวแรกที่เจอต่อ fact_order_id (first-seen = ล่าสุด)
      const latestImportByOrderId = new Map<string, { batchId: string; sourceRowNo: number | null }>();
      for (const chunk of chunkArray(allOrderIds, PENDING_REVIEW_FILE_LOOKUP_CHUNK_SIZE)) {
        const { data, error } = await supabase
          .schema(SCHEMA)
          .from("stg_order_import")
          .select("fact_order_id, batch_id, source_row_no, created_at")
          .eq("shop_id", shopId)
          .in("fact_order_id", chunk)
          .order("created_at", { ascending: false });
        if (error) throw error;
        for (const r of (data ?? []) as StgOrderImportSourceRow[]) {
          if (!r.fact_order_id || latestImportByOrderId.has(r.fact_order_id)) continue;
          latestImportByOrderId.set(r.fact_order_id, { batchId: r.batch_id, sourceRowNo: r.source_row_no });
        }
      }

      const batchIds = [...new Set([...latestImportByOrderId.values()].map((v) => v.batchId))];
      const fileNameByBatchId = new Map<string, string | null>();
      for (const chunk of chunkArray(batchIds, PENDING_REVIEW_FILE_LOOKUP_CHUNK_SIZE)) {
        const { data, error } = await supabase
          .schema(SCHEMA)
          .from("stg_import_batch")
          .select("id, file_name")
          .in("id", chunk);
        if (error) throw error;
        for (const b of (data ?? []) as { id: string; file_name: string | null }[]) {
          fileNameByBatchId.set(b.id, b.file_name);
        }
      }

      for (const [trackingNo, orders] of ordersByTracking) {
        orderSourcesByTracking.set(
          trackingNo,
          orders.map((o) => {
            const imp = latestImportByOrderId.get(o.id);
            return {
              factOrderId: o.id,
              sourceOrderNo: o.source_order_no,
              trackingNo: o.tracking_no,
              provinceCode: o.province_code,
              provinceSource: o.province_source,
              importFileName: imp ? (fileNameByBatchId.get(imp.batchId) ?? null) : null,
              sourceRowNo: imp ? imp.sourceRowNo : null,
            };
          })
        );
      }
    } catch (orderSourceErr) {
      console.error("getPendingLabelReviews: order-side source lookup failed, degrading to empty", orderSourceErr);
      orderSourcesByTracking.clear();
    }

    const rows: PendingLabelReviewRow[] = pageResult.rows.map((r) => ({
      pageId: r.id,
      fileId: r.label_file_id,
      // A row whose label_file was deleted out from under it shouldn't ever
      // happen (FK is ON DELETE CASCADE — see 0097) but fail safe with a
      // visible placeholder rather than crashing the whole queue render.
      fileName: fileNameById.get(r.label_file_id) ?? "(ไม่พบชื่อไฟล์)",
      pageNo: r.page_no,
      trackingNo: r.tracking_no,
      zipcode: r.zipcode,
      status: r.match_status as LabelReviewRow["status"],
      candidates: r.match_detail?.candidates ?? [],
      reason: r.match_detail?.reason,
      orderSources: r.tracking_no ? (orderSourcesByTracking.get(r.tracking_no) ?? []) : [],
    }));

    // Display order: group by file (newest-looking name sort is meaningless
    // here — group by fileId for stability, then page number ascending)
    // rather than the DB's arbitrary id order.
    rows.sort((a, b) => {
      if (a.fileName !== b.fileName) return a.fileName < b.fileName ? -1 : 1;
      return a.pageNo - b.pageNo;
    });

    return { ok: true, data: rows };
  } catch (err) {
    console.error("getPendingLabelReviews failed", err);
    return { ok: false, error: "โหลดคิวรอตรวจไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// Phase A — คิวกดได้ + แก้/ย้อนจังหวัด + เก็บการสอน (design scratchpad
// design-label-teach-loop-yoda-11sep.md §5 A, owner decisions 11 ก.ย. 69,
// migration 0116_label_review_resolve.sql). Full contract for frontend-dev:
// see lib/actions/labels.contract.md.
//
// Every export below: requireOwnerAdmin() first · every user-typed string
// that reaches a PostgREST filter goes through isPostgrestInSafe() first ·
// every reason code is validated against LABEL_REASON_CODES here (mirrors
// the CHECK constraints + RPC-level checks in 0116 — defense in depth, not
// the only gate) · no numeric business logic computed client-side, every
// write goes through the 0116 RPCs and reads back only what they wrote.
// ============================================================================

const SNIPPET_CONTEXT_CHARS = 80; // owner 11 ก.ย.: "±80 ตัวอักษรรอบ zipcode"
const LABEL_PAGE_VIEW_URL_TTL_SECONDS = 60; // owner 11 ก.ย.: "signed URL 60 วิ"
const FIND_ORDER_QUERY_MAX_LENGTH = 100;

function isValidReasonCode(v: unknown): v is LabelReasonCode {
  return typeof v === "string" && (LABEL_REASON_CODES as readonly string[]).includes(v);
}

/** Same 5-digit-isolated convention as lib/labels/match.ts's ZIPCODE_RE
 * (not imported from there — that module folds Thai text first, which this
 * function's plain-digit search doesn't need). Returns the index of the
 * FIRST occurrence that exactly equals `zipcode`, or -1 if not found (e.g.
 * the PDF's extracted text shifted since the original parse). */
function findStoredZipcodeIndex(text: string, zipcode: string | null): number {
  if (!zipcode) return -1;
  const re = /(?<!\d)\d{5}(?!\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0] === zipcode) return m.index;
  }
  return -1;
}

/** Fallback when the stored zipcode can't be relocated — first isolated
 * 5-digit run on the page, whatever it is. Still far more useful to the
 * owner than an empty snippet, and still PDPA-safe (a zipcode alone is not
 * PII, same reasoning as design §7 / lib/labels/match.ts header). */
function findAnyZipcode(text: string): { index: number; length: number } | null {
  const m = /(?<!\d)\d{5}(?!\d)/.exec(text);
  return m ? { index: m.index, length: m[0].length } : null;
}

/** PDPA (owner 11 ก.ย., decision #2ข): mask any run of >=9 digits (tracking
 * numbers, phone numbers) inside a snippet that is about to be sent to the
 * browser — this is the ONLY processing step between raw extracted PDF text
 * and the response; nothing upstream of this ever writes the snippet to a
 * table or a log line.
 *
 * M4 fix (12 ก.ย. 69, security): the original `/\d{9,}/g` only caught a
 * literal unbroken run of digits — a phone number printed with separators
 * ("081-234-5678", "081 234 5678") sailed straight through unmasked, since
 * each hyphen/space-separated GROUP is only 3-4 digits on its own. Matches a
 * digit optionally followed by one space/hyphen, repeated >=9 times, so
 * "081-234-5678" (10 digits across 3 groups) is caught as one run.
 *
 * M5 note (12 ก.ย. 69, security): this can now also swallow a zipcode that
 * sits right next to a phone/tracking number ("0812345678 10240" is ONE
 * run under the rule above) — that's intentional/safe here (over-masking is
 * the safe failure direction), the caller (getLabelPageSnippet) is
 * responsible for splicing the real zipcode characters back in afterward
 * since it knows the zipcode's own known-safe span; this function stays a
 * dumb, maximally-conservative masker with no zipcode-awareness of its own. */
function maskLongDigitRuns(text: string): string {
  return text.replace(/(?:\d[\s-]?){9,}/g, (run) => "•".repeat(run.length));
}

interface OrderRefRow {
  id: string;
  source_order_no: string;
  tracking_no: string | null;
  province_code: string;
  province_source: "import" | "label" | "manual";
  channel_id: string;
  order_date: string;
}

/** Shared by getPendingLabelReviews (above) in spirit but kept separate here
 * (different caller shape: an arbitrary order id list, not "every tracking_no
 * in today's review queue") — batch-looks-up "the latest stg_order_import
 * row per fact_order_id" + the import batch's file_name for a set of orders
 * already known to exist. Owner 11 ก.ย., decision #3.
 *
 * frontend-dev request (12 ก.ย. 69): also attaches channelName (dim_channel
 * — global reference data, no shop_id column, same as getCrmEditOptions in
 * lib/actions/crm.ts) and hasRevertableHistory (Mace M1, 13 ก.ย. 69 — whether
 * ANY province_set/province_revert crm_audit_log row exists per order,
 * reduced to a boolean here so the raw before/after jsonb never leaves this
 * function) — see OrderSourceRef's field comments in lib/labels/types.ts for
 * why these are findOrdersByTracking-only. */
async function attachOrderSources(
  supabase: ReturnType<typeof getServiceClient>,
  shopId: string,
  orders: OrderRefRow[]
): Promise<OrderSourceRef[]> {
  if (orders.length === 0) return [];

  interface StgOrderImportSourceRow {
    fact_order_id: string | null;
    batch_id: string;
    source_row_no: number | null;
    created_at: string;
  }
  const orderIds = orders.map((o) => o.id);
  const latestImportByOrderId = new Map<string, { batchId: string; sourceRowNo: number | null }>();
  for (const chunk of chunkArray(orderIds, PENDING_REVIEW_FILE_LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("stg_order_import")
      .select("fact_order_id, batch_id, source_row_no, created_at")
      .eq("shop_id", shopId)
      .in("fact_order_id", chunk)
      .order("created_at", { ascending: false });
    if (error) throw error;
    for (const r of (data ?? []) as StgOrderImportSourceRow[]) {
      if (!r.fact_order_id || latestImportByOrderId.has(r.fact_order_id)) continue;
      latestImportByOrderId.set(r.fact_order_id, { batchId: r.batch_id, sourceRowNo: r.source_row_no });
    }
  }

  const batchIds = [...new Set([...latestImportByOrderId.values()].map((v) => v.batchId))];
  const fileNameByBatchId = new Map<string, string | null>();
  for (const chunk of chunkArray(batchIds, PENDING_REVIEW_FILE_LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await supabase.schema(SCHEMA).from("stg_import_batch").select("id, file_name").in("id", chunk);
    if (error) throw error;
    for (const b of (data ?? []) as { id: string; file_name: string | null }[]) fileNameByBatchId.set(b.id, b.file_name);
  }

  // channel name — dim_channel is global reference data (no shop_id column,
  // same reasoning as getCrmEditOptions in lib/actions/crm.ts), small table,
  // one query regardless of how many distinct channels this order set uses.
  const channelIds = [...new Set(orders.map((o) => o.channel_id))];
  const channelNameById = new Map<string, string>();
  for (const chunk of chunkArray(channelIds, PENDING_REVIEW_FILE_LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await supabase.schema(SCHEMA).from("dim_channel").select("id, name").in("id", chunk);
    if (error) throw error;
    for (const c of (data ?? []) as { id: string; name: string }[]) channelNameById.set(c.id, c.name);
  }

  // Mace M1 (13 ก.ย. 69, security): only need EXISTENCE of a province_set/
  // province_revert audit row per order, not its content — select just
  // entity_id (no before/after/action) so the raw jsonb audit payload never
  // even leaves the database into this function's memory, let alone the
  // client (was: lastProvinceAuditByOrderId<ProvinceAuditEntry> carrying
  // before/after all the way to OrderSourceRef — removed). No .order()/
  // dedupe-to-latest needed either since existence, not recency, is what
  // hasRevertableHistory means here.
  const orderIdsWithProvinceAudit = new Set<string>();
  for (const chunk of chunkArray(orderIds, PENDING_REVIEW_FILE_LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("crm_audit_log")
      .select("entity_id")
      .eq("shop_id", shopId)
      .eq("entity_type", "fact_order")
      .in("entity_id", chunk)
      .in("action", ["province_set", "province_revert"]);
    if (error) throw error;
    for (const r of (data ?? []) as { entity_id: string | null }[]) {
      if (r.entity_id) orderIdsWithProvinceAudit.add(r.entity_id);
    }
  }

  return orders.map((o) => {
    const imp = latestImportByOrderId.get(o.id);
    return {
      factOrderId: o.id,
      sourceOrderNo: o.source_order_no,
      trackingNo: o.tracking_no,
      provinceCode: o.province_code,
      provinceSource: o.province_source,
      importFileName: imp ? (fileNameByBatchId.get(imp.batchId) ?? null) : null,
      sourceRowNo: imp ? imp.sourceRowNo : null,
      orderDate: o.order_date,
      channelName: channelNameById.get(o.channel_id) ?? null,
      hasRevertableHistory: orderIdsWithProvinceAudit.has(o.id),
    };
  });
}

// ----------------------------------------------------------------------------
// findOrdersByTracking — ค้นเลขพัสดุ/เลขที่ออเดอร์ (ProvinceFixPanel, /tiktok/upload)
// ----------------------------------------------------------------------------

export async function findOrdersByTracking(query: string): Promise<ActionResult<OrderSourceRef[]>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const clean = (query ?? "").trim();
  if (!clean) return { ok: false, error: "กรอกเลขพัสดุหรือเลขที่ออเดอร์ก่อนค้นหา" };
  if (clean.length > FIND_ORDER_QUERY_MAX_LENGTH) return { ok: false, error: "คำค้นยาวเกินไป" };
  // security 0901 (isPostgrestInSafe) — คำค้นพิมพ์เอง เชื่อไม่ได้ ต่อให้ใช้แค่
  // .eq() (ไม่ใช่ .in()) ก็เช็คไว้เผื่ออนาคตขยายเป็นค้นหลายคำ
  if (!isPostgrestInSafe(clean)) return { ok: false, error: "คำค้นมีอักขระที่ไม่รองรับ" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const [byTracking, byOrderNo] = await Promise.all([
      supabase
        .schema(SCHEMA)
        .from("fact_order")
        .select("id, source_order_no, tracking_no, province_code, province_source, channel_id, order_date")
        .eq("shop_id", shopId)
        .eq("tracking_no", clean)
        .limit(20),
      supabase
        .schema(SCHEMA)
        .from("fact_order")
        .select("id, source_order_no, tracking_no, province_code, province_source, channel_id, order_date")
        .eq("shop_id", shopId)
        .eq("source_order_no", clean)
        .limit(20),
    ]);
    if (byTracking.error) throw byTracking.error;
    if (byOrderNo.error) throw byOrderNo.error;

    const byId = new Map<string, OrderRefRow>();
    for (const o of [...((byTracking.data ?? []) as OrderRefRow[]), ...((byOrderNo.data ?? []) as OrderRefRow[])]) {
      byId.set(o.id, o);
    }
    const orders = [...byId.values()];
    if (orders.length === 0) return { ok: true, data: [] };

    const result = await attachOrderSources(supabase, shopId, orders);
    return { ok: true, data: result };
  } catch (err) {
    console.error("findOrdersByTracking failed", err);
    return { ok: false, error: "ค้นหาออเดอร์ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ----------------------------------------------------------------------------
// setOrderProvince / revertOrderProvince — แก้/ย้อนจังหวัดตรงจากออเดอร์ (ไม่ผูก
// กับ stg_label_page ใดๆ) — RPC label_set_order_province / label_revert_order_province.
// ----------------------------------------------------------------------------

export async function setOrderProvince(
  factOrderId: string,
  provinceCode: string,
  reason?: LabelReasonCode | null,
  note?: string | null
): Promise<ActionResult> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const cleanOrderId = (factOrderId ?? "").trim();
  const cleanProvince = (provinceCode ?? "").trim();
  if (!cleanOrderId || !cleanProvince) return { ok: false, error: "ไม่พบรหัสออเดอร์หรือจังหวัด" };
  if (reason != null && !isValidReasonCode(reason)) return { ok: false, error: "รหัสเหตุผลไม่ถูกต้อง" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { error } = await supabase.schema(SCHEMA).rpc("label_set_order_province", {
      p_shop_id: shopId,
      p_fact_order_id: cleanOrderId,
      p_province_code: cleanProvince,
      p_reason: reason ?? null,
      p_note: note?.trim() ? note.trim() : null,
    });
    if (error) throw error;

    revalidateProvinceChangePaths();
    return { ok: true, data: undefined };
  } catch (err) {
    // RPC raises a specific Thai/English message (e.g. "reason code is
    // required to overwrite it") but this action deliberately returns a
    // generic message, same convention as crmSetOrderOverride/every other
    // write action in this app — see contract doc for the guard list so the
    // UI can pre-validate (e.g. require a reason client-side once it knows
    // the order's current province isn't TH-XX) instead of round-tripping
    // to discover it.
    console.error("setOrderProvince failed", err);
    return { ok: false, error: "ตั้งค่าจังหวัดไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function revertOrderProvince(factOrderId: string): Promise<ActionResult> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const cleanOrderId = (factOrderId ?? "").trim();
  if (!cleanOrderId) return { ok: false, error: "ไม่พบรหัสออเดอร์" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { error } = await supabase.schema(SCHEMA).rpc("label_revert_order_province", {
      p_shop_id: shopId,
      p_fact_order_id: cleanOrderId,
    });
    if (error) throw error;

    revalidateProvinceChangePaths();
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("revertOrderProvince failed", err);
    return { ok: false, error: "ย้อนค่าจังหวัดไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ----------------------------------------------------------------------------
// resolveLabelPage / ignoreLabelPage / revertLabelPage — การกระทำในคิวรอตรวจ
// ----------------------------------------------------------------------------

export interface ResolveLabelPageInput {
  pageId: string;
  provinceCode: string;
  reason?: LabelReasonCode | null;
  note?: string | null;
  /** owner 11 ก.ย., decision #2(ข้อความที่เขาชี้ว่า "จังหวัดอยู่ตรงนี้") —
   * optional. RPC ปฏิเสธทั้งคำสั่ง (province ก็ไม่ถูกตั้งด้วย) ถ้ารูปแบบไม่ผ่าน
   * (>25 ตัวอักษร หรือมีเลข >=3 หลักติดกัน) — validate ฝั่ง UI ก่อนส่งได้ แต่
   * DB คือด่านจริง. */
  taughtSnippet?: string | null;
}

export async function resolveLabelPage(input: ResolveLabelPageInput): Promise<ActionResult<ResolveLabelPageResult>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const cleanPageId = (input?.pageId ?? "").trim();
  const cleanProvince = (input?.provinceCode ?? "").trim();
  if (!cleanPageId || !cleanProvince) return { ok: false, error: "ไม่พบหน้าหรือจังหวัดที่จะตั้งค่า" };
  if (input.reason != null && !isValidReasonCode(input.reason)) return { ok: false, error: "รหัสเหตุผลไม่ถูกต้อง" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("label_resolve_page", {
      p_shop_id: shopId,
      p_page_id: cleanPageId,
      p_province_code: cleanProvince,
      p_reason: input.reason ?? null,
      p_note: input.note?.trim() ? input.note.trim() : null,
      p_taught_snippet: input.taughtSnippet?.trim() ? input.taughtSnippet.trim() : null,
    });
    if (error) throw error;

    const row = (Array.isArray(data) ? data[0] : data) as { applied_orders?: number } | null;

    revalidateProvinceChangePaths();
    return { ok: true, data: { appliedOrders: Number(row?.applied_orders) || 0 } };
  } catch (err) {
    console.error("resolveLabelPage failed", err);
    return { ok: false, error: "ยืนยันจังหวัดไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export interface IgnoreLabelPageInput {
  pageId: string;
  reason?: LabelReasonCode | null;
  note?: string | null;
}

export async function ignoreLabelPage(input: IgnoreLabelPageInput): Promise<ActionResult> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const cleanPageId = (input?.pageId ?? "").trim();
  if (!cleanPageId) return { ok: false, error: "ไม่พบหน้าที่จะข้าม" };
  if (input.reason != null && !isValidReasonCode(input.reason)) return { ok: false, error: "รหัสเหตุผลไม่ถูกต้อง" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { error } = await supabase.schema(SCHEMA).rpc("label_ignore_page", {
      p_shop_id: shopId,
      p_page_id: cleanPageId,
      p_reason: input.reason ?? null,
      p_note: input.note?.trim() ? input.note.trim() : null,
    });
    if (error) throw error;

    revalidateLabelPaths();
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("ignoreLabelPage failed", err);
    return { ok: false, error: "ทำเครื่องหมาย 'ไม่ใช่ใบปะหน้า' ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function revertLabelPage(pageId: string): Promise<ActionResult> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const cleanPageId = (pageId ?? "").trim();
  if (!cleanPageId) return { ok: false, error: "ไม่พบหน้าที่จะย้อน" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { error } = await supabase.schema(SCHEMA).rpc("label_revert_page", {
      p_shop_id: shopId,
      p_page_id: cleanPageId,
    });
    if (error) throw error;

    revalidateProvinceChangePaths();
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("revertLabelPage failed", err);
    return { ok: false, error: "ย้อนค่าหน้านี้ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ----------------------------------------------------------------------------
// getLabelPageViewUrl / getLabelPageSnippet — "เข้ามาช่วยดูหน่อย" (owner 11 ก.ย.,
// decision #2) — signed URL ไปดูใบจริง + ข้อความรอบ zipcode สดจาก PDF
// ----------------------------------------------------------------------------

interface LabelPageLookup {
  page_no: number;
  zipcode: string | null;
  label_file_id: string;
}

/** Shared page+file lookup (tenant-scoped, purged-file guard) for the two
 * functions below — both need "this page's file, still readable." */
async function loadPageAndFile(
  supabase: ReturnType<typeof getServiceClient>,
  shopId: string,
  pageId: string
): Promise<
  | { ok: true; page: LabelPageLookup; storagePath: string }
  | { ok: false; error: string }
> {
  const { data: page, error: pageErr } = await supabase
    .schema(SCHEMA)
    .from("stg_label_page")
    .select("page_no, zipcode, label_file_id")
    .eq("id", pageId)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (pageErr) throw pageErr;
  if (!page) return { ok: false, error: "ไม่พบหน้านี้ในร้าน" };

  const { data: file, error: fileErr } = await supabase
    .schema(SCHEMA)
    .from("label_file")
    .select("storage_path, status")
    .eq("id", (page as LabelPageLookup).label_file_id)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (fileErr) throw fileErr;
  if (!file) return { ok: false, error: "ไม่พบไฟล์ต้นทางของหน้านี้" };
  if (file.status === "purged") {
    return { ok: false, error: "ไฟล์นี้ถูกลบตามนโยบายเก็บข้อมูลแล้ว — เปิดดูไม่ได้อีก" };
  }

  return { ok: true, page: page as LabelPageLookup, storagePath: file.storage_path as string };
}

export async function getLabelPageViewUrl(pageId: string): Promise<ActionResult<LabelPageViewUrlResult>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const cleanPageId = (pageId ?? "").trim();
  if (!cleanPageId) return { ok: false, error: "ไม่พบหน้าที่จะดู" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const found = await loadPageAndFile(supabase, shopId, cleanPageId);
    if (!found.ok) return found;

    const { data: signed, error: signErr } = await supabase.storage
      .from(SHIPPING_LABELS_BUCKET)
      .createSignedUrl(found.storagePath, LABEL_PAGE_VIEW_URL_TTL_SECONDS);
    if (signErr || !signed?.signedUrl) throw signErr ?? new Error("createSignedUrl returned no data");

    return { ok: true, data: { url: `${signed.signedUrl}#page=${found.page.page_no}` } };
  } catch (err) {
    console.error("getLabelPageViewUrl failed", err);
    return { ok: false, error: "สร้างลิงก์ดูใบไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function getLabelPageSnippet(pageId: string): Promise<ActionResult<LabelPageSnippetResult>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const cleanPageId = (pageId ?? "").trim();
  if (!cleanPageId) return { ok: false, error: "ไม่พบหน้าที่จะดู" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const found = await loadPageAndFile(supabase, shopId, cleanPageId);
    if (!found.ok) return found;

    const { data: blob, error: downloadErr } = await supabase.storage
      .from(SHIPPING_LABELS_BUCKET)
      .download(found.storagePath);
    if (downloadErr || !blob) throw downloadErr ?? new Error("storage download returned no data");

    // M2 fix (12 ก.ย. 69, security): same guard as parseLabelFile (line ~402
    // at the time of this fix) — check the byte size BEFORE arrayBuffer()
    // pulls the whole blob into heap. Storage should never actually hand
    // back something over MAX_LABEL_FILE_BYTES (0098's bucket-level limit),
    // but that's an external contract, not something this function should
    // trust blindly for a "just show me a snippet" click.
    if (blob.size > MAX_LABEL_FILE_BYTES) {
      return { ok: false, error: "ไฟล์จริงในระบบใหญ่เกิน 20MB — ดูข้อความไม่ได้ แจ้งทีมเทคนิค" };
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!looksLikePdf(bytes)) {
      return { ok: false, error: "ไฟล์นี้ไม่ใช่ PDF ที่อ่านได้แล้ว — อัปโหลดใหม่" };
    }

    let text: string;
    try {
      const pdf = await openPdf(bytes);
      // M2 fix (12 ก.ย. 69, security perf): extract ONLY this page, not the
      // whole document — see extractSinglePageText's header comment
      // (lib/labels/pdf.ts) for why extractPageTexts() here would redo work
      // for every other page on a file up to MAX_LABEL_PAGES=300 long, on
      // every single "ดูข้อความ" click.
      text = await extractSinglePageText(pdf, found.page.page_no);
    } catch (extractErr) {
      // PdfExtractError (or anything else openPdf/extractSinglePageText
      // throws) is not a hard-fail case here — the file opened fine at the
      // original parse, this is just a best-effort re-read. Logging the
      // error OBJECT is fine (stack trace / message only, never page
      // content) — the PDPA "ไม่เก็บ ไม่ log" rule is about the extracted
      // TEXT, not this.
      console.error("getLabelPageSnippet: re-extract failed, degrading to no snippet", extractErr);
      return { ok: true, data: { snippet: null, zipcodeFound: false } };
    }

    if (!text.trim()) {
      return { ok: true, data: { snippet: null, zipcodeFound: false } };
    }

    let idx = findStoredZipcodeIndex(text, found.page.zipcode);
    const zipcodeFound = idx >= 0;
    let matchLen = found.page.zipcode?.length ?? 5;
    if (idx < 0) {
      const fallback = findAnyZipcode(text);
      if (fallback) {
        idx = fallback.index;
        matchLen = fallback.length;
      }
    }

    if (idx < 0) {
      return { ok: true, data: { snippet: null, zipcodeFound: false } };
    }

    const start = Math.max(0, idx - SNIPPET_CONTEXT_CHARS);
    const end = Math.min(text.length, idx + matchLen + SNIPPET_CONTEXT_CHARS);
    const rawSnippet = text.slice(start, end);
    const maskedSnippet = maskLongDigitRuns(rawSnippet);

    // M5 fix (12 ก.ย. 69, security): the zipcode itself is the whole reason
    // this snippet exists (it's what the owner needs to visually verify) and
    // is NOT PII on its own (design §7 / lib/labels/match.ts header — same
    // reasoning zipcode is stored in stg_label_page.zipcode unmasked
    // already). But when it sits directly next to a phone/tracking number
    // with only a space between them ("0812345678 10240"), maskLongDigitRuns'
    // `/(?:\d[\s-]?){9,}/g` run can swallow BOTH — the owner would see
    // "••••••••••• •••••" with the one number they actually need to read
    // blacked out too. maskLongDigitRuns() preserves string length (masks
    // 1:1 with "•"), so the zipcode's own span — idx/matchLen, already known
    // relative to `text` — maps to the SAME offsets in maskedSnippet as in
    // rawSnippet; splice the real characters back in at that span,
    // regardless of whether the mask ate into it.
    const zipStart = idx - start;
    const zipEnd = zipStart + matchLen;
    const snippet = maskedSnippet.slice(0, zipStart) + rawSnippet.slice(zipStart, zipEnd) + maskedSnippet.slice(zipEnd);

    // PDPA (owner 11 ก.ย., decision #2ข: "ไม่เก็บ ไม่ log") — ไม่มี insert/
    // update ใดๆ ในฟังก์ชันนี้เลย และห้าม console.log/console.error ตัวแปร
    // snippet/text ที่ไหนในไฟล์นี้ทั้งไฟล์ ไม่ว่ากรณีใด — เฉพาะ err (Error
    // object จาก Supabase/Node) เท่านั้นที่ log ได้ ด้านล่าง
    return { ok: true, data: { snippet, zipcodeFound } };
  } catch (err) {
    console.error("getLabelPageSnippet failed", err);
    return { ok: false, error: "ดูข้อความหน้านี้ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
