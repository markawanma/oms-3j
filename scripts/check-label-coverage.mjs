#!/usr/bin/env node
// scripts/check-label-coverage.mjs
//
// ตอบคำถาม "ใบปะหน้าไฟล์นี้เป็นออเดอร์ของวันไหน และเข้าระบบไปหรือยัง"
// โดยไม่เขียนอะไรลง DB เลย (อ่านอย่างเดียว)
//
// ทำไมต้องมี: **ชื่อไฟล์ใบปะหน้าเชื่อไม่ได้** — เจ้าของกดพิมพ์ใบปะหน้าของ
// ออเดอร์ที่ค้างสะสมทีเดียว ไม่ได้พิมพ์วันต่อวัน ไฟล์ที่ชื่อ
// "08-20_1_Shipping label..." จึงเป็นออเดอร์ของวันที่ 18 ส.ค. ไม่ใช่วันที่ 20
// และไฟล์คนละชื่อก็มีออเดอร์ซ้ำกันได้ (พิมพ์ซ้ำรอบใหม่)
//
// ผลที่ตามมา: นับจำนวนไฟล์แล้วเดาว่า "ครบแล้ว" คือคำตอบที่ผิดเสมอ ต้องเปิด
// ดูข้างในว่ามี order id อะไรบ้าง แล้วไปเทียบกับ fact_order จริง
//
// Usage:
//   node --env-file=.env.local scripts/check-label-coverage.mjs <file.pdf> [...]
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (เหมือน import-tiktok-labels.mjs)
//
// คู่กับ scripts/import-tiktok-labels.mjs — ตัวนั้นเป็นตัวเขียนจริง ตัวนี้
// เป็นตัวสำรวจก่อน/ตรวจหลัง

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { extractText, getDocumentProxy } from "unpdf";

const UNKNOWN_PROVINCE = "TH-XX";
const CHUNK = 200;

function env(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`${name} is not set (source .env.local via --env-file).`);
  return v;
}

async function main() {
  const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (files.length === 0) {
    console.error("Usage: node --env-file=.env.local scripts/check-label-coverage.mjs <file.pdf> [...]");
    process.exit(1);
  }
  for (const f of files) {
    if (!existsSync(f)) {
      console.error(`ไม่พบไฟล์: ${f}`);
      process.exit(1);
    }
  }

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

  // ---- อ่าน order id ออกจากทุกไฟล์ (Set = ตัดใบที่พิมพ์ซ้ำออกเอง) ----
  const ids = new Set();
  for (const file of files) {
    const pdf = await getDocumentProxy(new Uint8Array(readFileSync(file)));
    const { text } = await extractText(pdf, { mergePages: false });
    let n = 0;
    for (const page of text) {
      const id = page.match(/Order ID:\s*(\d{15,20})/)?.[1];
      if (id) {
        ids.add(id);
        n += 1;
      }
    }
    console.log(`${file.split(/[\\/]/).pop()}: ${text.length} หน้า · เจอ order id ${n} ครั้ง`);
  }
  console.log(`รวม order id ไม่ซ้ำ: ${ids.size}`);

  // ---- เทียบกับ fact_order ----
  const list = [...ids];
  const stg = [];
  for (let i = 0; i < list.length; i += CHUNK) {
    const { data, error } = await db
      .schema("analytics")
      .from("stg_order_import")
      .select("marketplace_order_id, fact_order_id")
      .in("marketplace_order_id", list.slice(i, i + CHUNK));
    if (error) throw error;
    stg.push(...data);
  }
  const factIds = [...new Set(stg.map((r) => r.fact_order_id).filter(Boolean))];
  const notInDb = ids.size - new Set(stg.map((r) => r.marketplace_order_id)).size;

  const byDate = new Map();
  for (let i = 0; i < factIds.length; i += CHUNK) {
    const { data, error } = await db
      .schema("analytics")
      .from("fact_order")
      .select("order_date, province_code")
      .in("id", factIds.slice(i, i + CHUNK));
    if (error) throw error;
    for (const r of data) {
      const cur = byDate.get(r.order_date) ?? { total: 0, withProvince: 0 };
      cur.total += 1;
      if (r.province_code && r.province_code !== UNKNOWN_PROVINCE) cur.withProvince += 1;
      byDate.set(r.order_date, cur);
    }
  }

  console.log("---");
  console.log(`เจอในระบบ ${factIds.length} ออเดอร์` + (notInDb > 0 ? ` · ยังไม่มีในระบบ ${notInDb} (ยังไม่ได้นำเข้าไฟล์ยอดขายของวันนั้น)` : ""));
  for (const [date, v] of [...byDate].sort()) {
    const left = v.total - v.withProvince;
    console.log(`  ${date}: ${v.total} ออเดอร์ · มีจังหวัดแล้ว ${v.withProvince}` + (left > 0 ? ` · ยังขาด ${left} (รัน import-tiktok-labels.mjs --commit ได้เลย)` : " ✓"));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
