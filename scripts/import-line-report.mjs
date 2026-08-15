#!/usr/bin/env node
// scripts/import-line-report.mjs
//
// Imports one Shipnity "สินค้าในออเดอร์" (per-SKU line-item) Excel report into
// analytics.stg_order_line_import, then calls analytics.transform_pending_order_lines
// to populate analytics.fact_order_item (real per-SKU COGS/profit). Sibling of
// import-aug.mjs (order-level). 20-column format, verified against
// "shipnity orderAug1-15withSKU.xlsx".
//
// Usage:
//   node --env-file=.env.local scripts/import-line-report.mjs "C:\path\to\...withSKU.xlsx"
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEV_SHOP_ID (same as import-aug.mjs).
// Idempotent on (shop_id, file_hash). Line-items whose order isn't in fact_order
// yet are marked 'orphan' by the transform (re-runnable once the order lands).

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

const CHUNK = 200;
// 20-col line-item report: 0 รหัสสินค้า | 1 สินค้า | 2 ราคา | 3 จำนวน | 4 เลขที่ออเดอร์ ...
const COL = { sku: 0, name: 1, price: 2, qty: 3, order_no: 4 };

function env(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`${name} is not set (source .env.local via --env-file).`);
  return v;
}
const text = (v) => { if (v === null || v === undefined) return null; const s = String(v).trim(); return s === "" || s === "-" ? null : s; };
const num = (v) => { if (v === null || v === undefined || v === "") return null; const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "").trim()); return Number.isFinite(n) ? n : null; };
const int = (v) => { const n = num(v); return n === null ? null : Math.trunc(n); };

async function main() {
  const filePath = process.argv[2];
  if (!filePath || !existsSync(filePath)) { console.error("Usage: node scripts/import-line-report.mjs <xlsx> (file not found)"); process.exit(1); }
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const shopId = env("DEV_SHOP_ID");

  const buf = readFileSync(filePath);
  const fileHash = createHash("sha256").update(buf).digest("hex");
  const wb = XLSX.read(buf, { type: "buffer", raw: true, cellDates: false });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null, blankrows: false });
  const [header, ...data] = rows;
  console.log(`Parsed ${data.length} line rows. file_hash=${fileHash.slice(0, 12)}...`);

  const { data: batch, error: bErr } = await db.schema("analytics").from("stg_import_batch")
    .insert({ shop_id: shopId, source_type: "excel_line_item_report", file_name: basename(filePath), file_hash: fileHash, row_count_parsed: data.length, status: "loaded" })
    .select("id").single();
  if (bErr) { if (bErr.code === "23505") { console.log("ไฟล์นี้ import แล้ว (file_hash ซ้ำ). ไม่ทำอะไร."); process.exit(0); } console.error("batch insert failed:", bErr); process.exit(1); }
  const batchId = batch.id;
  console.log(`Created batch ${batchId}`);

  // line_no is a per-order running counter (source has no explicit line index).
  const lineNoByOrder = new Map();
  const mapped = [];
  for (const cells of data) {
    const order_no = text(cells[COL.order_no]);
    if (!order_no) continue; // can't attribute a line with no order
    const n = (lineNoByOrder.get(order_no) ?? 0) + 1;
    lineNoByOrder.set(order_no, n);
    const raw = {};
    header.forEach((h, i) => { raw[text(h) ?? `col_${i + 1}`] = cells[i] ?? null; });
    mapped.push({
      shop_id: shopId, batch_id: batchId, source_order_no: order_no, line_no: n,
      sku_raw: text(cells[COL.sku]), product_name_raw: text(cells[COL.name]),
      unit_price: num(cells[COL.price]), qty: int(cells[COL.qty]) ?? 1, raw, import_status: "pending",
    });
  }

  let inserted = 0;
  for (let i = 0; i < mapped.length; i += CHUNK) {
    const chunk = mapped.slice(i, i + CHUNK);
    const { error, count } = await db.schema("analytics").from("stg_order_line_import")
      .upsert(chunk, { onConflict: "shop_id,source_order_no,line_no", count: "exact" });
    if (error) { console.error(`upsert [${i}..${i + chunk.length}) failed:`, error); process.exit(1); }
    inserted += count ?? chunk.length;
  }
  console.log(`Upserted ${inserted} line rows (skipped ${data.length - mapped.length} w/o order_no).`);
  await db.schema("analytics").from("stg_import_batch").update({ row_count_loaded: inserted }).eq("id", batchId);

  const { data: tr, error: tErr } = await db.schema("analytics").rpc("transform_pending_order_lines", { p_shop_id: shopId, p_batch_id: batchId });
  if (tErr) { console.error("transform_pending_order_lines failed:", tErr); process.exit(1); }
  await db.schema("analytics").from("stg_import_batch").update({ status: "transformed" }).eq("id", batchId);
  const r = tr?.[0] ?? {};
  console.log("---");
  console.log(`batch_id:     ${batchId}`);
  console.log(`transformed:  ${r.transformed_count}`);
  console.log(`orphan:       ${r.orphan_count}  (order ยังไม่มีใน fact_order)`);
  console.log(`skipped_blank:${r.skipped_blank_count}`);
  console.log(`unknown_sku:  ${r.unknown_sku_count}`);
  console.log(`errored:      ${r.errored_count}`);
}
main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
