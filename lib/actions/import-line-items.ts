"use server";

// lib/actions/import-line-items.ts — server actions backing the line-item
// ("สินค้าในออเดอร์") import flow on /crm/import (design:
// docs/3j-jewelry/analytics/phase-lineitem-import-design.md §5). Mirrors
// lib/actions/import-orders.ts's shape (preview/commit/service-client/gate)
// but wraps the NEW staging table + proc from supabase/migrations/0041:
// analytics.stg_order_line_import + analytics.transform_pending_order_lines.
//
// Same auth model as import-orders.ts: getServiceClient() uses the service
// role (BYPASSES RLS) — requireOwnerAdmin() is the only gate. This module
// writes fact_order.cogs/profit for a whole month, so every export here
// (including the read) calls it first.
//
// Dependency note (design §7 decision 7, "soft-enforce"): line-item import
// is expected to run AFTER the matching order-level file
// (import-orders.ts) — an order with no fact_order match yet just sits as
// 'orphan' in staging and gets picked up automatically the next time this
// batch (or any batch touching the same order) is transformed. Preview
// surfaces orphanOrderCount so the owner sees this before committing, but
// commit is never hard-blocked by it.

import { revalidatePath } from "next/cache";
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId, getDevRole } from "@/lib/dev/context";
import type { ActionResult } from "@/lib/types";
import {
  ImportParseError,
  parseOrderLineReportXlsx,
  type LineReportShapeIssue,
  type ParsedLineReport,
} from "@/lib/import/order-line-report";

const SCHEMA = "analytics";
// Exported so import-orders.ts's getImportBatches() can query both source
// types from one place instead of hardcoding this literal a second time.
export const LINE_ITEM_SOURCE_TYPE = "excel_line_item_report" as const;
const SOURCE_TYPE = LINE_ITEM_SOURCE_TYPE;

const MAX_FILE_BYTES = 4 * 1024 * 1024; // matches next.config.mjs serverActions.bodySizeLimit
const MAX_FILE_MB = 4;
const CHECK_CHUNK_SIZE = 200;
const STAGING_UPSERT_CHUNK_SIZE = 200;

function requireOwnerAdmin(): ActionResult<never> | null {
  if (getDevRole() === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่นำเข้ารายงานสินค้าในออเดอร์ได้" };
  }
  return null;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Thai text for one shape issue — UI-facing strings stay here, structured
 * LineReportShapeIssue lives in the lib layer (order-line-report.ts). */
function shapeIssueToThaiMessage(issue: LineReportShapeIssue): string {
  switch (issue.kind) {
    case "column_count":
      return `จำนวนคอลัมน์หัวตารางเป็น ${issue.found} คอลัมน์ (ต้องมี 20 คอลัมน์พอดี) — ไฟล์นี้อาจไม่ใช่รายงาน "สินค้าในออเดอร์" ของ Shipnity`;
    case "header_mismatch":
      return `หัวคอลัมน์ที่ ${issue.colIndex + 1} เป็น "${issue.found || "(ว่าง)"}" ไม่ใช่ "${issue.expected}" — ไฟล์อาจถูกแก้ไข/คนละ format`;
    case "date_column_unparseable":
      return `คอลัมน์วันที่สร้าง (คอลัมน์ที่ 20) แปลงวันที่ได้แค่ ${Math.round(issue.parsedPct * 100)}% ของแถวที่มีข้อมูล (ต้องการอย่างน้อย 90%) — คอลัมน์อาจเลื่อนหรือรูปแบบวันที่เปลี่ยน`;
    default: {
      const _exhaustive: never = issue;
      return _exhaustive;
    }
  }
}

/** Shared file validation + parse for both preview and commit. */
async function readAndParseFile(
  formData: FormData
): Promise<{ ok: true; file: File; parsed: ParsedLineReport } | { ok: false; error: string }> {
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
    const parsed = parseOrderLineReportXlsx(buf);
    return { ok: true, file, parsed };
  } catch (err) {
    if (err instanceof ImportParseError) {
      return { ok: false, error: err.message };
    }
    console.error("readAndParseFile (line-items): parse failed", err);
    return { ok: false, error: "อ่านไฟล์ไม่สำเร็จ — ตรวจว่าเป็นไฟล์ Excel (.xlsx) ที่ไม่เสียหาย" };
  }
}

// ============================================================================
// previewLineImport — dry-run: parse + validate, check hash/dedup/orphan/
// unknown-sku, write nothing.
// ============================================================================

export interface LineImportPreview {
  fileName: string;
  fileHash: string;
  rowCount: number;
  distinctOrders: number;
  blankSkuCount: number;
  /** distinct source_order_no in the file with no matching fact_order yet
   * (design §5: "เตือน 'นำเข้า order-level ก่อน'") — informational, never blocks commit. */
  orphanOrderCount: number;
  /** distinct sku_raw not found in public.product for this shop. */
  unknownSkus: string[];
  shapeIssues: string[];
  periodHint: string | null;
  periodMin: string | null;
  periodMax: string | null;
  crossesMonth: boolean;
  dateWarningCount: number;
  duplicateFile: { batchId: string; importedAt: string; status: string } | null;
}

export async function previewLineImport(formData: FormData): Promise<ActionResult<LineImportPreview>> {
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

    let orphanOrderCount = 0;
    let unknownSkus: string[] = [];

    // Only worth hitting the DB when the shape is trustworthy — a
    // shape-broken file gets blocked in the UI regardless (commit rejects
    // it outright), so checking orphan/unknown against garbage positions is
    // wasted work.
    if (parsed.shapeIssues.length === 0) {
      const orderNos = Array.from(
        new Set(parsed.rows.map((r) => r.source_order_no).filter((v): v is string => v !== null))
      );
      if (orderNos.length > 0) {
        const matchedOrders = new Set<string>();
        for (const chunk of chunkArray(orderNos, CHECK_CHUNK_SIZE)) {
          const { data, error } = await supabase
            .schema(SCHEMA)
            .from("fact_order")
            .select("source_order_no")
            .eq("shop_id", shopId)
            .in("source_order_no", chunk);
          if (error) throw error;
          for (const row of (data ?? []) as { source_order_no: string }[]) {
            matchedOrders.add(row.source_order_no);
          }
        }
        orphanOrderCount = orderNos.length - matchedOrders.size;
      }

      const skus = Array.from(new Set(parsed.rows.map((r) => r.sku_raw).filter((v): v is string => v !== null)));
      if (skus.length > 0) {
        const knownSkus = new Set<string>();
        for (const chunk of chunkArray(skus, CHECK_CHUNK_SIZE)) {
          // public.product is the DEFAULT schema (no .schema() call) — same
          // convention as lib/actions/catalog.ts.
          const { data, error } = await supabase
            .from("product")
            .select("sku")
            .eq("shop_id", shopId)
            .in("sku", chunk);
          if (error) throw error;
          for (const row of (data ?? []) as { sku: string }[]) knownSkus.add(row.sku);
        }
        unknownSkus = skus.filter((s) => !knownSkus.has(s)).sort();
      }
    }

    const preview: LineImportPreview = {
      fileName: file.name,
      fileHash: parsed.fileHash,
      rowCount: parsed.rows.length,
      distinctOrders: parsed.distinctOrders,
      blankSkuCount: parsed.blankSkuCount,
      orphanOrderCount,
      unknownSkus,
      shapeIssues: parsed.shapeIssues.map(shapeIssueToThaiMessage),
      periodHint: parsed.periodHint,
      periodMin: parsed.periodMin,
      periodMax: parsed.periodMax,
      crossesMonth: parsed.crossesMonth,
      dateWarningCount: parsed.dateWarningCount,
      duplicateFile: dupBatch
        ? { batchId: dupBatch.id as string, importedAt: dupBatch.imported_at as string, status: dupBatch.status as string }
        : null,
    };
    return { ok: true, data: preview };
  } catch (err) {
    console.error("previewLineImport failed", err);
    return { ok: false, error: "ตรวจสอบไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// commitLineImport — parse+validate -> resolve prior batch by hash -> insert
// batch -> upsert staging rows -> transform -> mark done. Any throw mid-flow
// marks the batch 'failed' (best-effort), same recovery contract as
// commitOrderImport.
// ============================================================================

export interface LineImportCommitResult {
  batchId: string;
  inserted: number;
  transformed: number;
  orphan: number;
  skippedBlank: number;
  unknown: number;
  errored: number;
}

export async function commitLineImport(formData: FormData): Promise<ActionResult<LineImportCommitResult>> {
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
    return { ok: false, error: "ไม่พบแถวข้อมูลในไฟล์นี้ — ไม่มีอะไรให้นำเข้า" };
  }

  const shopId = getDevShopId();
  const supabase = getServiceClient();
  let batchId: string | null = null;

  try {
    // 1. resolve any prior batch with the same file_hash for this shop
    //    (unique key is (shop_id, file_hash) regardless of source_type).
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
        const { error: delErr } = await supabase
          .schema(SCHEMA)
          .from("stg_import_batch")
          .delete()
          .eq("id", existingBatch.id);
        if (delErr) throw delErr;
      } else {
        return {
          ok: false,
          error: "มี batch ค้างอยู่จากการนำเข้าไฟล์นี้ก่อนหน้า — ลบรายการค้างในตารางประวัติแล้วลองใหม่",
        };
      }
    }

    // 2. insert the batch.
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
      if ((batchErr as { code?: string }).code === "23505") {
        return { ok: false, error: "ไฟล์นี้กำลังถูกนำเข้าอยู่แล้ว (อาจเปิดหลายแท็บ) — รอสักครู่แล้วรีเฟรชหน้า" };
      }
      throw batchErr;
    }
    batchId = batch.id as string;

    // 3. UPSERT staging rows, chunked, on (shop_id, source_order_no, line_no)
    //    — a re-uploaded/edited file overwrites its own prior staging rows
    //    instead of 23505'ing. Never send fact_order_item_id (transform owns
    //    that lineage).
    const payloadRows = parsed.rows.map((row) => ({
      batch_id: batchId,
      shop_id: shopId,
      source_order_no: row.source_order_no,
      line_no: row.line_no,
      sku_raw: row.sku_raw,
      product_name_raw: row.product_name_raw,
      unit_price: row.unit_price,
      qty: row.qty,
      raw: row.raw,
      import_status: "pending",
      error_detail: null,
    }));

    let upsertedCount = 0;
    for (const chunk of chunkArray(payloadRows, STAGING_UPSERT_CHUNK_SIZE)) {
      const { error: upsertErr, count } = await supabase
        .schema(SCHEMA)
        .from("stg_order_line_import")
        .upsert(chunk, { onConflict: "shop_id,source_order_no,line_no", count: "exact" });
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

    // 5. transform (proc owns fact_order_item/fact_order.cogs/profit — not touched here).
    const { data: transformResult, error: transformErr } = await supabase
      .schema(SCHEMA)
      .rpc("transform_pending_order_lines", { p_shop_id: shopId, p_batch_id: batchId });
    if (transformErr) throw transformErr;
    const result = (transformResult?.[0] ?? {
      transformed_count: 0,
      orphan_count: 0,
      skipped_blank_count: 0,
      unknown_sku_count: 0,
      errored_count: 0,
    }) as {
      transformed_count: number;
      orphan_count: number;
      skipped_blank_count: number;
      unknown_sku_count: number;
      errored_count: number;
    };

    // 6. mark done. Same convention as commitOrderImport: 'transformed' means
    //    "this batch was processed", not "every row succeeded" — orphan/error
    //    counts are surfaced in the return value / import-errors page instead.
    const { error: updStatusErr } = await supabase
      .schema(SCHEMA)
      .from("stg_import_batch")
      .update({ status: "transformed" })
      .eq("id", batchId);
    if (updStatusErr) throw updStatusErr;

    revalidatePath("/crm/import");
    revalidatePath("/dashboard");
    revalidatePath("/catalog");
    revalidatePath("/crm/orders");

    return {
      ok: true,
      data: {
        batchId,
        inserted: upsertedCount,
        transformed: Number(result.transformed_count) || 0,
        orphan: Number(result.orphan_count) || 0,
        skippedBlank: Number(result.skipped_blank_count) || 0,
        unknown: Number(result.unknown_sku_count) || 0,
        errored: Number(result.errored_count) || 0,
      },
    };
  } catch (err) {
    console.error("commitLineImport failed", err);
    if (batchId) {
      try {
        await supabase.schema(SCHEMA).from("stg_import_batch").update({ status: "failed" }).eq("id", batchId);
      } catch (markErr) {
        console.error("commitLineImport: failed to mark batch as failed", markErr);
      }
    }
    return {
      ok: false,
      error: "นำเข้าไฟล์ไม่สำเร็จ — ระบบทำเครื่องหมาย batch นี้เป็น failed แล้ว แก้ปัญหาแล้วลองใหม่ได้ทันที",
    };
  }
}
