#!/usr/bin/env node
// scripts/import-aug.mjs
//
// Phase A2 import pilot — loads one Excel order report into
// analytics.stg_import_batch / analytics.stg_order_import, then calls
// analytics.transform_pending_orders() to populate dims/facts.
// Per docs/3j-jewelry/analytics/stg-import-schema.md + task brief field
// mapping (25 columns, verified against the real Aug file).
//
// Usage:
//   node scripts/import-aug.mjs "C:\path\to\1-10 Aug sell report.xlsx"
//
// Required env vars (see .env.local.example):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (service_role — RLS-bypassing, required:
//                                 analytics.transform_pending_orders and the
//                                 staging tables are service_role/owner-only)
//   DEV_SHOP_ID                 (shop.id to import into — same convention as
//                                 lib/dev/context.ts; no auth/UI yet)
//
// Idempotent: re-running with the same file is safe — file_hash is unique
// per (shop_id, file_hash) on stg_import_batch, so a duplicate file is
// detected and the script exits without inserting/transforming anything
// twice. Re-running transform_pending_orders on an already-transformed
// batch is also a no-op (see 0013's import_status filter).

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

const STAGING_INSERT_CHUNK_SIZE = 200;

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`${name} is not set. See scripts/import-aug.mjs header comment for required env vars.`);
  }
  return value;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function toIntOrNull(value) {
  const n = toNumberOrNull(value);
  return n === null ? null : Math.trunc(n);
}

function toTextOrNull(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/**
 * Parses "dd/MM/yyyy HH:mm" (optionally "dd/MM/yyyy HH:mm:ss") explicitly —
 * deliberately NOT `new Date(str)` or any locale-based parse, which silently
 * swaps dd/MM for MM/dd on many locales/Node builds. Confirmed (task brief)
 * that source dates are TEXT in this format, not Excel date serials.
 * Returns an ISO 8601 string (for timestamptz columns) or null.
 */
function parseThaiDateText(value) {
  const s = toTextOrNull(value);
  if (s === null) return null;

  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) {
    console.warn(`  ! could not parse date "${s}" (expected dd/MM/yyyy HH:mm) — leaving null`);
    return null;
  }
  const [, ddStr, MMStr, yyyyStr, HHStr, mmStr, ssStr] = m;
  const dd = Number(ddStr);
  const MM = Number(MMStr);
  const yyyy = Number(yyyyStr);
  const HH = Number(HHStr);
  const mm = Number(mmStr);
  const ss = ssStr ? Number(ssStr) : 0;

  if (MM < 1 || MM > 12 || dd < 1 || dd > 31 || HH > 23 || mm > 59 || ss > 59) {
    console.warn(`  ! date "${s}" out of range after dd/MM/yyyy parse — leaving null`);
    return null;
  }

  // Thailand has no DST / single UTC+7 offset year-round — safe to build a
  // fixed-offset ISO string directly instead of relying on the host TZ.
  const pad = (n, len = 2) => String(n).padStart(len, "0");
  return `${yyyy}-${pad(MM)}-${pad(dd)}T${pad(HH)}:${pad(mm)}:${pad(ss)}+07:00`;
}

// Field mapping — task brief, 25-column report (columns 24/25 unmapped,
// still captured verbatim in `raw`). 1-based column index -> staging field.
const COLUMN_MAP = {
  0: "source_order_no",
  1: "customer_name_raw",
  2: "phone_raw",
  3: "channel_raw",
  4: "contact_display_name_raw",
  5: "carrier_raw",
  6: "shipping_fee_customer",
  7: "province_raw",
  8: "bank_raw",
  9: "tracking_no",
  10: "shipping_cost_shop",
  11: "note_raw",
  12: "created_by_raw",
  13: "order_created_at",
  14: "paid_at",
  15: "printed_at",
  16: "marketplace_order_id",
  17: "discount_code",
  18: "discount_total",
  19: "item_count_total",
  20: "revenue",
  21: "profit_raw",
  22: "tags_raw",
};

function mapRow(headerRow, cells, rowNo) {
  const raw = {};
  headerRow.forEach((h, i) => {
    const key = toTextOrNull(h) ?? `col_${i + 1}`;
    raw[key] = cells[i] ?? null;
  });

  const field = (i) => cells[i];

  return {
    source_row_no: rowNo,
    raw,
    source_kind: "excel",
    source_order_no: toTextOrNull(field(0)),
    marketplace_order_id: toTextOrNull(field(16)),
    channel_raw: toTextOrNull(field(3)),
    customer_name_raw: toTextOrNull(field(1)),
    contact_display_name_raw: toTextOrNull(field(4)),
    phone_raw: toTextOrNull(field(2)),
    province_raw: toTextOrNull(field(7)),
    carrier_raw: toTextOrNull(field(5)),
    tracking_no: toTextOrNull(field(9)),
    shipping_fee_customer: toNumberOrNull(field(6)),
    shipping_cost_shop: toNumberOrNull(field(10)),
    revenue: toNumberOrNull(field(20)),
    discount_total: toNumberOrNull(field(18)),
    discount_code: toTextOrNull(field(17)),
    item_count_total: toIntOrNull(field(19)),
    profit_raw: toNumberOrNull(field(21)),
    order_created_at: parseThaiDateText(field(13)),
    paid_at: parseThaiDateText(field(14)),
    printed_at: parseThaiDateText(field(15)),
    created_by_raw: toTextOrNull(field(12)),
    note_raw: toTextOrNull(field(11)),
    bank_raw: toTextOrNull(field(8)),
    tags_raw: toTextOrNull(field(22)),
  };
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node scripts/import-aug.mjs <path-to-excel-file>");
    process.exit(1);
  }
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const shopId = requireEnv("DEV_SHOP_ID");

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  console.log(`Reading ${filePath} ...`);
  const fileBuf = readFileSync(filePath);
  const fileHash = createHash("sha256").update(fileBuf).digest("hex");

  const workbook = XLSX.read(fileBuf, { type: "buffer", raw: true, cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    console.error("No sheets found in workbook.");
    process.exit(1);
  }
  const sheet = workbook.Sheets[sheetName];
  // header:1 -> array-of-arrays, raw:true -> keep native cell types
  // (numbers stay numbers; dates in this file are text cells per task brief,
  // so they stay strings and go through parseThaiDateText above).
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: false });
  if (rows.length < 2) {
    console.error("Sheet has no data rows (need a header row + at least 1 data row).");
    process.exit(1);
  }
  const [headerRow, ...dataRows] = rows;

  console.log(`Parsed ${dataRows.length} data rows. file_hash=${fileHash.slice(0, 12)}...`);

  // --- 1. insert batch (idempotent on shop_id+file_hash) --------------------
  const { data: batch, error: batchErr } = await db
    .schema("analytics")
    .from("stg_import_batch")
    .insert({
      shop_id: shopId,
      source_type: "excel_order_report",
      file_name: basename(filePath),
      file_hash: fileHash,
      row_count_parsed: dataRows.length,
      status: "loaded",
    })
    .select("id")
    .single();

  if (batchErr) {
    // 23505 = unique_violation on (shop_id, file_hash)
    if (batchErr.code === "23505") {
      console.log(`ไฟล์นี้ import แล้ว (file_hash already recorded for this shop). Nothing to do.`);
      process.exit(0);
    }
    console.error("Failed to insert stg_import_batch:", batchErr);
    process.exit(1);
  }
  const batchId = batch.id;
  console.log(`Created batch ${batchId}`);

  // --- 2. map + insert stg_order_import rows (chunked) -----------------------
  const mapped = dataRows
    .map((cells, idx) => mapRow(headerRow, cells, idx + 1))
    .filter((row) => {
      if (!row.source_order_no) {
        console.warn(`  ! skipping row ${row.source_row_no}: missing source_order_no`);
        return false;
      }
      return true;
    })
    .map((row) => ({ ...row, batch_id: batchId, shop_id: shopId }));

  let insertedCount = 0;
  for (let i = 0; i < mapped.length; i += STAGING_INSERT_CHUNK_SIZE) {
    const chunk = mapped.slice(i, i + STAGING_INSERT_CHUNK_SIZE);
    const { error: insertErr, count } = await db
      .schema("analytics")
      .from("stg_order_import")
      .insert(chunk, { count: "exact" });
    if (insertErr) {
      console.error(`Failed inserting stg_order_import rows [${i}..${i + chunk.length}):`, insertErr);
      process.exit(1);
    }
    insertedCount += count ?? chunk.length;
  }
  console.log(`Inserted ${insertedCount} stg_order_import rows (skipped ${dataRows.length - mapped.length}).`);

  await db
    .schema("analytics")
    .from("stg_import_batch")
    .update({ row_count_loaded: insertedCount })
    .eq("id", batchId);

  // --- 3. transform -----------------------------------------------------------
  const { data: transformResult, error: transformErr } = await db
    .schema("analytics")
    .rpc("transform_pending_orders", { p_shop_id: shopId, p_batch_id: batchId });

  if (transformErr) {
    console.error("transform_pending_orders failed:", transformErr);
    process.exit(1);
  }
  const { transformed_count: transformed, errored_count: errored } = transformResult[0] ?? {
    transformed_count: 0,
    errored_count: 0,
  };

  await db
    .schema("analytics")
    .from("stg_import_batch")
    .update({ status: "transformed" })
    .eq("id", batchId);

  const { count: factOrderTotal, error: countErr } = await db
    .schema("analytics")
    .from("fact_order")
    .select("*", { count: "exact", head: true })
    .eq("shop_id", shopId);
  if (countErr) {
    console.warn("Could not fetch fact_order total count:", countErr);
  }

  console.log("---");
  console.log(`batch_id:        ${batchId}`);
  console.log(`inserted:        ${insertedCount}`);
  console.log(`transformed:     ${transformed}`);
  console.log(`errored:         ${errored}`);
  console.log(`fact_order total (shop): ${factOrderTotal ?? "unknown"}`);
  if (errored > 0) {
    console.log(
      `\n${errored} row(s) failed to transform — check analytics.stg_order_import.error_detail ` +
        `where batch_id = '${batchId}' and import_status = 'error'.`,
    );
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
