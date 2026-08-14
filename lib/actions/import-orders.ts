"use server";

// lib/actions/import-orders.ts — server actions backing /crm/import (design:
// docs/3j-jewelry/analytics/phase-import-ui-design.md). Wraps
// lib/import/order-report.ts (parse) + the existing staging pipeline
// (supabase/migrations/0011 tables, 0026 transform_pending_orders) — this
// file adds zero new DB objects (D7: "migration ใหม่ ไม่มี").
//
// Same auth model as lib/actions/catalog.ts / crm.ts: getServiceClient() uses
// the service role, which BYPASSES RLS — requireOwnerAdmin() below is the
// only thing gating access. This module writes a whole month of revenue, so
// EVERY export here (including the read, per D5) calls it first.

import { revalidatePath } from "next/cache";
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId, getDevRole } from "@/lib/dev/context";
import type { ActionResult } from "@/lib/types";
import {
  ImportParseError,
  parseOrderReportXlsx,
  type ParsedOrderReport,
  type ShapeIssue,
} from "@/lib/import/order-report";

const SCHEMA = "analytics";
const SOURCE_TYPE = "excel_order_report" as const;

const MAX_FILE_BYTES = 4 * 1024 * 1024; // matches next.config.mjs serverActions.bodySizeLimit
const MAX_FILE_MB = 4;
const DEDUP_CHECK_CHUNK_SIZE = 200;
const STAGING_UPSERT_CHUNK_SIZE = 200;

function requireOwnerAdmin(): ActionResult<never> | null {
  if (getDevRole() === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่นำเข้ารายงานยอดขายได้" };
  }
  return null;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Thai text for one shape issue — the structured ShapeIssue lives in the lib
 * layer (order-report.ts); this string-ification is UI-facing, so it stays
 * here rather than polluting the parse lib with copy. */
function shapeIssueToThaiMessage(issue: ShapeIssue): string {
  switch (issue.kind) {
    case "column_count":
      return `จำนวนคอลัมน์หัวตารางเป็น ${issue.found} คอลัมน์ (ต้องอยู่ระหว่าง 23–25 คอลัมน์) — ไฟล์นี้อาจคนละ format`;
    case "header_mismatch":
      return `หัวคอลัมน์ที่ ${issue.colIndex + 1} เป็น "${issue.found || "(ว่าง)"}" ไม่ใช่ "${issue.expected}" — ไฟล์อาจถูกแก้ไข/คนละ format`;
    case "date_column_unparseable":
      return `คอลัมน์วันที่สร้าง (คอลัมน์ที่ 14) แปลงวันที่ได้แค่ ${Math.round(issue.parsedPct * 100)}% ของแถวที่มีข้อมูล (ต้องการอย่างน้อย 90%) — คอลัมน์อาจเลื่อนหรือรูปแบบวันที่เปลี่ยน`;
    default: {
      const _exhaustive: never = issue;
      return _exhaustive;
    }
  }
}

/** Shared file validation + parse for both preview and commit — keeps the
 * "reject bad file before touching DB" behavior identical between the two. */
async function readAndParseFile(
  formData: FormData
): Promise<{ ok: true; file: File; parsed: ParsedOrderReport } | { ok: false; error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "ไม่พบไฟล์ที่อัปโหลด" };
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return { ok: false, error: "รองรับเฉพาะไฟล์ .xlsx เท่านั้น" };
  }
  if (file.size === 0) {
    return { ok: false, error: "ไฟล์นี้ว่างเปล่า" };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: `ไฟล์ใหญ่เกิน ${MAX_FILE_MB}MB (${(file.size / 1024 / 1024).toFixed(1)}MB) — ตรวจว่าไฟล์ไม่เสียหาย` };
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const parsed = parseOrderReportXlsx(buf);
    return { ok: true, file, parsed };
  } catch (err) {
    if (err instanceof ImportParseError) {
      return { ok: false, error: err.message };
    }
    console.error("readAndParseFile: parse failed", err);
    return { ok: false, error: "อ่านไฟล์ไม่สำเร็จ — ตรวจว่าเป็นไฟล์ Excel (.xlsx) ที่ไม่เสียหาย" };
  }
}

// ============================================================================
// previewOrderImport — dry-run: parse + validate, check hash/dedup, write
// nothing.
// ============================================================================

export interface ImportPreview {
  fileName: string;
  fileHash: string;
  rowCount: number;
  skippedCount: number;
  shapeIssues: string[];
  channelCounts: { label: string; count: number }[];
  periodHint: string | null;
  periodMin: string | null;
  periodMax: string | null;
  crossesMonth: boolean;
  dateWarningCount: number;
  duplicateFile: { batchId: string; importedAt: string; status: string } | null;
  updateExistingCount: number;
}

export async function previewOrderImport(formData: FormData): Promise<ActionResult<ImportPreview>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const parseResult = await readAndParseFile(formData);
  if (!parseResult.ok) return { ok: false, error: parseResult.error };
  const { file, parsed } = parseResult;

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data: dupBatch, error: dupErr } = await supabase
      .schema(SCHEMA)
      .from("stg_import_batch")
      .select("id, imported_at, status")
      .eq("shop_id", shopId)
      .eq("file_hash", parsed.fileHash)
      .maybeSingle();
    if (dupErr) throw dupErr;

    // Only worth checking dedup collisions when the shape is trustworthy and
    // there's something to check — a shape-broken file gets blocked in the UI
    // regardless, and hitting the DB with a huge/garbage key list is wasted.
    let updateExistingCount = 0;
    if (parsed.shapeIssues.length === 0 && parsed.rows.length > 0) {
      const dedupKeys = parsed.rows.map((r) => `E:${r.source_order_no}`);
      for (const chunk of chunkArray(dedupKeys, DEDUP_CHECK_CHUNK_SIZE)) {
        const { data, error } = await supabase
          .schema(SCHEMA)
          .from("stg_order_import")
          .select("dedup_key")
          .eq("shop_id", shopId)
          .in("dedup_key", chunk);
        if (error) throw error;
        updateExistingCount += (data ?? []).length;
      }
    }

    const preview: ImportPreview = {
      fileName: file.name,
      fileHash: parsed.fileHash,
      rowCount: parsed.rows.length,
      skippedCount: parsed.skippedRowNos.length,
      shapeIssues: parsed.shapeIssues.map(shapeIssueToThaiMessage),
      channelCounts: parsed.channelCounts.map((c) => ({ label: c.label, count: c.count })),
      periodHint: parsed.periodHint,
      periodMin: parsed.periodMin,
      periodMax: parsed.periodMax,
      crossesMonth: parsed.crossesMonth,
      dateWarningCount: parsed.dateWarningCount,
      duplicateFile: dupBatch
        ? { batchId: dupBatch.id as string, importedAt: dupBatch.imported_at as string, status: dupBatch.status as string }
        : null,
      updateExistingCount,
    };
    return { ok: true, data: preview };
  } catch (err) {
    console.error("previewOrderImport failed", err);
    return { ok: false, error: "ตรวจสอบไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// commitOrderImport — parse+validate → resolve prior batch by hash → insert
// batch → upsert staging rows (D7: upsert, not insert — re-uploads of an
// edited file must not 23505 on dedup_key) → transform → mark transformed.
// Any throw mid-flow marks the batch 'failed' (best-effort) so a retry with
// the same file self-heals via the 'failed' branch below.
// ============================================================================

export interface ImportCommitResult {
  batchId: string;
  inserted: number;
  transformed: number;
  errored: number;
}

export async function commitOrderImport(formData: FormData): Promise<ActionResult<ImportCommitResult>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const parseResult = await readAndParseFile(formData);
  if (!parseResult.ok) return { ok: false, error: parseResult.error };
  const { file, parsed } = parseResult;

  if (parsed.shapeIssues.length > 0) {
    return {
      ok: false,
      error: `ไฟล์นี้โครงสร้างไม่ตรงที่คาด นำเข้าไม่ได้ — ${parsed.shapeIssues.map(shapeIssueToThaiMessage).join("; ")}`,
    };
  }
  if (parsed.rows.length === 0) {
    return { ok: false, error: "ไม่พบแถวข้อมูลที่มีเลขที่ออเดอร์ในไฟล์นี้ — ไม่มีอะไรให้นำเข้า" };
  }

  const shopId = getDevShopId();
  const supabase = getServiceClient();
  let batchId: string | null = null;

  try {
    // 1. resolve any prior batch with the same file_hash for this shop.
    const { data: existingBatch, error: existingErr } = await supabase
      .schema(SCHEMA)
      .from("stg_import_batch")
      .select("id, status, imported_at")
      .eq("shop_id", shopId)
      .eq("file_hash", parsed.fileHash)
      .maybeSingle();
    if (existingErr) throw existingErr;

    if (existingBatch) {
      if (existingBatch.status === "transformed") {
        return {
          ok: false,
          error: `ไฟล์นี้นำเข้าแล้วเมื่อ ${String(existingBatch.imported_at).slice(0, 10)} — ไม่ต้องนำเข้าซ้ำ`,
        };
      }
      if (existingBatch.status === "failed") {
        // retry-after-fail: delete the dead batch (FK cascade removes its
        // stg_order_import rows) and fall through to insert a fresh one.
        const { error: delErr } = await supabase
          .schema(SCHEMA)
          .from("stg_import_batch")
          .delete()
          .eq("id", existingBatch.id);
        if (delErr) throw delErr;
      } else {
        // 'loaded' or 'merged' — a batch is mid-flight or stuck. Don't
        // auto-delete (would race a commit that's still running); ask the
        // owner to clear it from history first.
        return {
          ok: false,
          error: "มี batch ค้างอยู่จากการนำเข้าไฟล์นี้ก่อนหน้า — ลบรายการค้างในตารางประวัติแล้วลองใหม่",
        };
      }
    }

    // 2. insert the batch (idempotent on shop_id+file_hash).
    const { data: batch, error: batchErr } = await supabase
      .schema(SCHEMA)
      .from("stg_import_batch")
      .insert({
        shop_id: shopId,
        source_type: SOURCE_TYPE,
        file_name: file.name,
        file_hash: parsed.fileHash,
        period_hint: parsed.periodHint,
        row_count_parsed: parsed.rowCountParsed,
        status: "loaded",
      })
      .select("id")
      .single();
    if (batchErr) {
      // 23505 = unique_violation on (shop_id, file_hash) — a concurrent
      // commit of the same file won the race between our check above and
      // this insert. Surface as the normal duplicate message.
      if ((batchErr as { code?: string }).code === "23505") {
        return { ok: false, error: "ไฟล์นี้กำลังถูกนำเข้าอยู่แล้ว (อาจเปิดหลายแท็บ) — รอสักครู่แล้วรีเฟรชหน้า" };
      }
      throw batchErr;
    }
    batchId = batch.id as string;

    // 3. UPSERT staging rows, chunked. D7: upsert (not insert) on
    // (shop_id, dedup_key) — a re-uploaded, edited file must overwrite the
    // prior staging row instead of 23505'ing the whole chunk. Never send
    // dedup_key (generated column) or fact_order_id (preserves lineage —
    // transform's own fact_order upsert on (shop_id, source_order_no) is
    // what actually replaces the old amount).
    const payloadRows = parsed.rows.map((row) => ({
      ...row,
      batch_id: batchId,
      shop_id: shopId,
      import_status: "pending",
      error_detail: null,
    }));

    let upsertedCount = 0;
    for (const chunk of chunkArray(payloadRows, STAGING_UPSERT_CHUNK_SIZE)) {
      const { error: upsertErr, count } = await supabase
        .schema(SCHEMA)
        .from("stg_order_import")
        .upsert(chunk, { onConflict: "shop_id,dedup_key", count: "exact" });
      if (upsertErr) throw upsertErr;
      upsertedCount += count ?? chunk.length;
    }

    // 4. row_count_loaded.
    const { error: updLoadedErr } = await supabase
      .schema(SCHEMA)
      .from("stg_import_batch")
      .update({ row_count_loaded: upsertedCount })
      .eq("id", batchId);
    if (updLoadedErr) throw updLoadedErr;

    // 5. transform (proc owns dims/facts — not touched here at all).
    const { data: transformResult, error: transformErr } = await supabase
      .schema(SCHEMA)
      .rpc("transform_pending_orders", { p_shop_id: shopId, p_batch_id: batchId });
    if (transformErr) throw transformErr;
    const result = (transformResult?.[0] ?? { transformed_count: 0, errored_count: 0 }) as {
      transformed_count: number;
      errored_count: number;
    };

    // 6. mark done.
    const { error: updStatusErr } = await supabase
      .schema(SCHEMA)
      .from("stg_import_batch")
      .update({ status: "transformed" })
      .eq("id", batchId);
    if (updStatusErr) throw updStatusErr;

    revalidatePath("/crm/import");
    revalidatePath("/crm/overview");
    revalidatePath("/crm/orders");
    revalidatePath("/crm/customers");
    revalidatePath("/crm/import-errors");
    revalidatePath("/dashboard");

    return {
      ok: true,
      data: {
        batchId,
        inserted: upsertedCount,
        transformed: Number(result.transformed_count) || 0,
        errored: Number(result.errored_count) || 0,
      },
    };
  } catch (err) {
    console.error("commitOrderImport failed", err);
    if (batchId) {
      try {
        await supabase.schema(SCHEMA).from("stg_import_batch").update({ status: "failed" }).eq("id", batchId);
      } catch (markErr) {
        console.error("commitOrderImport: failed to mark batch as failed", markErr);
      }
    }
    return {
      ok: false,
      error: "นำเข้าไฟล์ไม่สำเร็จ — ระบบทำเครื่องหมาย batch นี้เป็น failed แล้ว แก้ปัญหาแล้วลองใหม่ได้ทันที",
    };
  }
}

// ============================================================================
// getImportBatches — history table for /crm/import.
// ============================================================================

export interface ImportBatchRow {
  batchId: string;
  fileName: string | null;
  periodHint: string | null;
  rowCountParsed: number | null;
  rowCountLoaded: number | null;
  errorCount: number;
  status: "loaded" | "merged" | "transformed" | "failed";
  importedAt: string;
}

const BATCH_STATUSES = ["loaded", "merged", "transformed", "failed"] as const;

export async function getImportBatches(): Promise<ActionResult<ImportBatchRow[]>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data: batches, error: batchesErr } = await supabase
      .schema(SCHEMA)
      .from("stg_import_batch")
      .select("id, file_name, period_hint, row_count_parsed, row_count_loaded, status, imported_at")
      .eq("shop_id", shopId)
      .eq("source_type", SOURCE_TYPE)
      .order("imported_at", { ascending: false });
    if (batchesErr) throw batchesErr;

    // Error counts computed client-side per batch — row volume here is
    // hundreds, not worth a second RPC/view for this page (design §3.2).
    const { data: errorRows, error: errorRowsErr } = await supabase
      .schema(SCHEMA)
      .from("stg_order_import")
      .select("batch_id")
      .eq("shop_id", shopId)
      .eq("import_status", "error");
    if (errorRowsErr) throw errorRowsErr;

    const errorCountByBatch = new Map<string, number>();
    for (const r of (errorRows ?? []) as { batch_id: string }[]) {
      errorCountByBatch.set(r.batch_id, (errorCountByBatch.get(r.batch_id) ?? 0) + 1);
    }

    const rows: ImportBatchRow[] = (
      (batches ?? []) as {
        id: string;
        file_name: string | null;
        period_hint: string | null;
        row_count_parsed: number | null;
        row_count_loaded: number | null;
        status: string;
        imported_at: string;
      }[]
    ).map((b) => ({
      batchId: b.id,
      fileName: b.file_name,
      periodHint: b.period_hint,
      rowCountParsed: b.row_count_parsed,
      rowCountLoaded: b.row_count_loaded,
      errorCount: errorCountByBatch.get(b.id) ?? 0,
      status: (BATCH_STATUSES as readonly string[]).includes(b.status)
        ? (b.status as ImportBatchRow["status"])
        : "loaded",
      importedAt: b.imported_at,
    }));

    return { ok: true, data: rows };
  } catch (err) {
    console.error("getImportBatches failed", err);
    return { ok: false, error: "โหลดประวัติการนำเข้าไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// deleteStuckBatch — clears a 'failed' or 'loaded' batch from history.
// 'transformed' batches are never deletable here (fact_order already linked).
// ============================================================================

export async function deleteStuckBatch(batchId: string): Promise<ActionResult<null>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const cleanId = batchId?.trim();
  if (!cleanId) return { ok: false, error: "ไม่พบ batch ที่จะลบ" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data: batch, error: selErr } = await supabase
      .schema(SCHEMA)
      .from("stg_import_batch")
      .select("id, status")
      .eq("id", cleanId)
      .eq("shop_id", shopId)
      .maybeSingle();
    if (selErr) throw selErr;
    if (!batch) return { ok: false, error: "ไม่พบ batch นี้" };

    if (batch.status !== "failed" && batch.status !== "loaded") {
      return { ok: false, error: "ลบไม่ได้ — batch นี้นำเข้าสำเร็จแล้ว (ข้อมูลผูกกับออเดอร์จริง)" };
    }

    // scope the DELETE by shop_id too (not just the pre-check SELECT above) —
    // defense-in-depth so a future refactor that drops the SELECT gate can't
    // turn this into a cross-shop delete (security audit #3).
    const { error: delErr } = await supabase
      .schema(SCHEMA)
      .from("stg_import_batch")
      .delete()
      .eq("id", cleanId)
      .eq("shop_id", shopId);
    if (delErr) throw delErr;

    revalidatePath("/crm/import");
    return { ok: true, data: null };
  } catch (err) {
    console.error("deleteStuckBatch failed", err);
    return { ok: false, error: "ลบ batch ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
