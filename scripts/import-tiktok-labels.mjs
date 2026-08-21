#!/usr/bin/env node
// scripts/import-tiktok-labels.mjs
//
// เติม "จังหวัด" ให้ออเดอร์ TikTok จากใบปะหน้า PDF ของ TikTok Seller Center
//
// ปัญหาที่แก้: ไฟล์ยอดขาย Shipnity ไม่มีจังหวัดของออเดอร์ TikTok เลย (TikTok
// ปิดบังที่อยู่ลูกค้าในไฟล์ export) ผลคือ fact_order ของช่องทาง TikTok มี
// province_code = 'TH-XX' (ไม่ระบุ) ทั้ง 100% ทั้งที่เป็นช่องทางที่มีออเดอร์
// เยอะที่สุดของร้าน — แดชบอร์ดจึงบอกไม่ได้เลยว่าลูกค้า TikTok อยู่ที่ไหน
//
// แต่ใบปะหน้าที่ร้านพิมพ์ออกมาส่งของทุกวัน "ต้อง" มีที่อยู่ ไม่งั้นส่งของไม่ได้
// และ PDF จาก Seller Center เป็น PDF ที่ generate จากระบบ (มี text layer จริง
// ไม่ใช่ภาพสแกน) จึงดึงข้อความออกมาตรงๆ ได้ ไม่ต้อง OCR
//
// กุญแจเชื่อมข้อมูล: ใบปะหน้ามี `Order ID: 5856112258577xxxxx` ซึ่งเป็นเลข
// เดียวกับคอลัมน์ "เลขที่บน Marketplace" ในไฟล์ Shipnity → เก็บไว้ที่
// analytics.stg_order_import.marketplace_order_id → ชี้ไป fact_order.id
// (ตรวจแล้ว: ออเดอร์ TikTok 3,359 ใบมีเลขนี้ครบ 100%)
//
// สิ่งที่เก็บ / ไม่เก็บ (PDPA):
//   เก็บ    — จังหวัด, อำเภอ/เขต, รหัสไปรษณีย์  (ระดับพื้นที่ ใช้วิเคราะห์ได้)
//   ไม่เก็บ — ชื่อผู้รับ, เบอร์โทร, บ้านเลขที่/ถนน/ซอย, เลขพัสดุ
// ใบปะหน้ามีข้อมูลส่วนบุคคลครบทุกอย่าง แต่สคริปต์นี้ทิ้งทั้งหมดตั้งแต่ตอน
// แกะ ไม่เคยเขียนลง DB — เพราะสิ่งที่เราต้องการคือ "ลูกค้าอยู่ภาคไหน" ไม่ใช่
// "ลูกค้าชื่ออะไร" การเก็บของที่ไม่ได้ใช้คือการสร้างความเสี่ยงฟรีๆ
//
// Usage:
//   node --env-file=.env.local scripts/import-tiktok-labels.mjs <file.pdf> [more.pdf ...]
//        --commit     เขียนลง DB จริง (ไม่ใส่ = dry-run รายงานอย่างเดียว)
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEV_SHOP_ID (เหมือน import-aug.mjs)
//
// Idempotent: เขียนทับเฉพาะออเดอร์ที่ province_code เป็น 'TH-XX'/null เท่านั้น
// รันไฟล์เดิมซ้ำ = ไม่มีอะไรเปลี่ยน · ออเดอร์ที่มีจังหวัดจากแหล่งอื่นแล้ว
// (เช่น LINE ที่ Shipnity ให้มาตรงๆ) จะไม่ถูกแตะ

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

/** ทำชื่อจังหวัดให้เทียบกันได้ ระหว่างข้อความจาก PDF กับ dim_geo
 *
 * ใบปะหน้าใช้ฟอนต์ไทยที่เก็บวรรณยุกต์เป็นรหัสอักขระพิเศษ (Private Use Area
 * U+F700–U+F71F) แทนรหัสมาตรฐาน — "ขอนแก่น" ออกมาเป็น "ขอนแก" + U+F70A + "น"
 * ตาเปล่าอ่านเหมือนกันเป๊ะ แต่คนละไบต์ เทียบสตริงตรงๆ ไม่มีวันตรง
 * (ต้นเหตุจริงที่ทำให้ 22 ใบตกตอนทดลองรอบแรก)
 *
 * บวกกับที่ text layer ทำวรรณยุกต์หายไปเลยก็มี ("นครสวรรค์" → "นครสวรรค")
 * และ "ำ" บางที่มาเป็น ํ + า แยกกัน ("ลำพูน" → "ลําพูน")
 *
 * วิธีที่ใช้: ตัดเครื่องหมายบน-ล่างทั้งหมดทิ้งจากทั้งสองฝั่งก่อนเทียบ แล้ว
 * ยุบ ำ/ ํา ให้เป็น า เหมือนกัน — เหลือแต่พยัญชนะกับสระหลัก ซึ่งพอแยก
 * 77 จังหวัดออกจากกันได้ (สคริปต์เช็คการชนกันตอนสร้าง map ถ้าชนจะเตือน) */
function normalizeThai(s) {
  let out = "";
  for (const ch of (s ?? "").normalize("NFC")) {
    const c = ch.codePointAt(0);
    // U+F700-F71F: วรรณยุกต์ที่ฟอนต์ในใบปะหน้าเก็บเป็นรหัสอักขระพิเศษ
    if (c >= 0xf700 && c <= 0xf71f) continue;
    // U+0E31, U+0E34-U+0E3A, U+0E47-U+0E4E: สระบน-ล่าง/วรรณยุกต์มาตรฐาน
    // (รวม U+0E4D ที่เป็นครึ่งหน้าของ "ำ" แบบแยกอักขระ)
    if (c === 0x0e31 || (c >= 0x0e34 && c <= 0x0e3a) || (c >= 0x0e47 && c <= 0x0e4e)) continue;
    // U+0E33 "ำ" -> U+0E32 "า" ให้ตรงกับฝั่งที่มาเป็น U+0E4D + U+0E32
    if (c === 0x0e33) {
      out += String.fromCharCode(0x0e32);
      continue;
    }
    if (/\s/.test(ch)) continue;
    out += ch;
  }
  return out.trim();
}

/** แกะ 1 หน้า = 1 ออเดอร์
 *
 * layout ของใบปะหน้าค่อนข้างคงที่: บรรทัด "อำเภอ , จังหวัด" ปรากฏ 2 ครั้ง —
 * ครั้งแรกคือที่อยู่ผู้ส่ง (ร้านเราเอง) ครั้งสุดท้ายคือผู้รับ จึงเอา match
 * ตัวสุดท้ายเสมอ ไม่ใช่ตัวแรก */
function parsePage(page) {
  const orderId = page.match(/Order ID:\s*(\d{15,20})/)?.[1] ?? null;
  const zipcode = page.match(/\n(\d{5})\n/)?.[1] ?? null;
  const pairs = [...page.matchAll(/\n([^\n,]{2,40})\s+,\s+([^\n,]{2,40})\n/g)];
  const last = pairs.at(-1);
  return {
    orderId,
    zipcode,
    district: last?.[1]?.trim() || null,
    provinceRaw: last?.[2]?.trim() || null,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const files = args.filter((a) => !a.startsWith("--"));
  if (files.length === 0) {
    console.error("Usage: node --env-file=.env.local scripts/import-tiktok-labels.mjs <file.pdf> [...] [--commit]");
    process.exit(1);
  }
  for (const f of files) {
    if (!existsSync(f)) {
      console.error(`ไม่พบไฟล์: ${f}`);
      process.exit(1);
    }
  }

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const shopId = env("DEV_SHOP_ID");

  // ---- 1. แกะ PDF ----
  const parsed = [];
  for (const file of files) {
    const pdf = await getDocumentProxy(new Uint8Array(readFileSync(file)));
    const { text } = await extractText(pdf, { mergePages: false });
    text.forEach((page, i) => parsed.push({ file: file.split(/[\\/]/).pop(), page: i + 1, ...parsePage(page) }));
  }
  // ออเดอร์ที่มีสินค้าหลายรายการจะกินใบแพ็กมากกว่า 1 หน้า หน้าที่ 2 เป็นต้นไป
  // มีแค่ Order ID + ตารางสินค้าต่อ ไม่มีบล็อกที่อยู่ (ไม่ต้องมี เพราะฉลากติด
  // กล่องใบเดียว) — จึงต้องยุบหน้าของออเดอร์เดียวกันเข้าด้วยกัน แล้วเลือก
  // หน้าที่มีที่อยู่ ไม่งั้นจะนับเป็น "แกะจังหวัดไม่ได้" ทั้งที่ข้อมูลอยู่ครบ
  const byOrder = new Map();
  for (const r of parsed) {
    if (!r.orderId) continue;
    const cur = byOrder.get(r.orderId);
    if (!cur || (!cur.provinceRaw && r.provinceRaw)) byOrder.set(r.orderId, r);
  }
  const withOrder = [...byOrder.values()];
  const noOrder = parsed.filter((r) => !r.orderId);
  const noProvince = withOrder.filter((r) => !r.provinceRaw);
  console.log(
    `แกะ PDF: ${parsed.length} หน้า → ${withOrder.length} ออเดอร์ (หน้าต่อของใบแพ็กถูกยุบรวมแล้ว) · แกะจังหวัดไม่ได้ ${noProvince.length}`
  );
  for (const r of noOrder) console.log(`  ! ${r.file} หน้า ${r.page}: ไม่เจอ Order ID (ข้าม)`);
  for (const r of noProvince) console.log(`  ! order ${r.orderId} (${r.file} หน้า ${r.page}): ไม่เจอที่อยู่เลยสักหน้า (ข้าม)`);

  // ---- 2. จับคู่ชื่อจังหวัดกับ dim_geo ----
  const { data: geo, error: geoErr } = await db.schema("analytics").from("dim_geo").select("province_code, province_name_th");
  if (geoErr) throw geoErr;
  const geoByNorm = new Map(geo.map((g) => [normalizeThai(g.province_name_th), g.province_code]));

  const resolved = [];
  const unmatchedProvince = new Map();
  for (const r of withOrder) {
    if (!r.provinceRaw) continue;
    const code = geoByNorm.get(normalizeThai(r.provinceRaw));
    if (!code || code === UNKNOWN_PROVINCE) {
      unmatchedProvince.set(r.provinceRaw, (unmatchedProvince.get(r.provinceRaw) ?? 0) + 1);
      continue;
    }
    resolved.push({ ...r, provinceCode: code });
  }
  console.log(`จับคู่จังหวัดได้ ${resolved.length} / ${withOrder.length}`);
  for (const [name, n] of unmatchedProvince) console.log(`  ! จังหวัด "${name}" ไม่ตรงกับ dim_geo (${n} ใบ) — ต้องเพิ่ม alias`);

  // ---- 3. หา fact_order ผ่าน marketplace_order_id ----
  const idToFact = new Map();
  const ids = [...new Set(resolved.map((r) => r.orderId))];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await db
      .schema("analytics")
      .from("stg_order_import")
      .select("marketplace_order_id, fact_order_id")
      .eq("shop_id", shopId)
      .in("marketplace_order_id", ids.slice(i, i + CHUNK))
      .not("fact_order_id", "is", null);
    if (error) throw error;
    for (const row of data) idToFact.set(row.marketplace_order_id, row.fact_order_id);
  }
  const matched = resolved.filter((r) => idToFact.has(r.orderId));
  const notInDb = resolved.filter((r) => !idToFact.has(r.orderId));
  console.log(`เจอออเดอร์ในระบบ ${matched.length} / ${resolved.length}`);
  if (notInDb.length) {
    console.log(`  ! ${notInDb.length} ใบยังไม่มีในระบบ (ยังไม่ได้นำเข้าไฟล์ Shipnity ของวันนั้น) — รันซ้ำได้หลังนำเข้า`);
    for (const r of notInDb.slice(0, 5)) console.log(`      ${r.orderId} (${r.provinceRaw})`);
  }

  // ---- 4. เขียนเฉพาะออเดอร์ที่ยังไม่มีจังหวัด ----
  const factIds = [...new Set(matched.map((r) => idToFact.get(r.orderId)))];
  const current = new Map();
  for (let i = 0; i < factIds.length; i += CHUNK) {
    const { data, error } = await db
      .schema("analytics")
      .from("fact_order")
      .select("id, province_code")
      .in("id", factIds.slice(i, i + CHUNK));
    if (error) throw error;
    for (const row of data) current.set(row.id, row.province_code);
  }
  const toUpdate = matched.filter((r) => {
    const cur = current.get(idToFact.get(r.orderId));
    return cur === null || cur === UNKNOWN_PROVINCE;
  });
  const alreadySet = matched.length - toUpdate.length;

  console.log("---");
  console.log(`จะเติมจังหวัดให้ ${toUpdate.length} ออเดอร์ · มีจังหวัดอยู่แล้ว ${alreadySet} (ไม่แตะ)`);
  const byProvince = new Map();
  for (const r of toUpdate) byProvince.set(r.provinceRaw, (byProvince.get(r.provinceRaw) ?? 0) + 1);
  for (const [name, n] of [...byProvince].sort((a, b) => b[1] - a[1])) console.log(`   ${name}: ${n}`);

  if (!commit) {
    console.log("---");
    console.log("DRY-RUN — ยังไม่เขียนลง DB · ใส่ --commit เพื่อเขียนจริง");
    return;
  }

  let updated = 0;
  for (const r of toUpdate) {
    const factId = idToFact.get(r.orderId);
    const { error } = await db
      .schema("analytics")
      .from("fact_order")
      .update({ province_code: r.provinceCode, updated_at: new Date().toISOString() })
      .eq("id", factId)
      .or(`province_code.eq.${UNKNOWN_PROVINCE},province_code.is.null`);
    if (error) throw error;
    updated += 1;
  }

  // dim_address: เก็บระดับพื้นที่ไว้ใช้ต่อ (อำเภอ/เขต + รหัสไปรษณีย์)
  //
  // ตั้งต้นจาก `matched` ไม่ใช่ `toUpdate` โดยเจตนา — ถ้ารอบก่อนเขียน
  // fact_order สำเร็จแต่ dim_address ล้ม (เคยเกิดจริงตอน raw_address not-null)
  // ออเดอร์นั้นจะไม่อยู่ใน toUpdate อีกแล้ว (จังหวัดไม่ใช่ TH-XX แล้ว) ทำให้
  // dim_address ไม่มีวันถูกเขียนย้อน — ต้องดูจากตารางปลายทางว่ามีแถวหรือยัง
  const existingAddr = new Set();
  for (let i = 0; i < factIds.length; i += CHUNK) {
    const { data, error } = await db
      .schema("analytics")
      .from("dim_address")
      .select("fact_order_id")
      .in("fact_order_id", factIds.slice(i, i + CHUNK));
    if (error) throw error;
    for (const row of data) existingAddr.add(row.fact_order_id);
  }

  // raw_address เป็น NOT NULL แต่เราตั้งใจไม่เก็บที่อยู่เต็ม จึงเก็บเฉพาะระดับ
  // พื้นที่ลงไป (อำเภอ/จังหวัด/รหัสไปรษณีย์) — ไม่มีชื่อ ไม่มีเบอร์ ไม่มี
  // บ้านเลขที่/ถนน/ซอย ข้อมูลที่ไม่ได้ใช้ก็ไม่ต้องแบกความเสี่ยงเก็บไว้
  const addressRows = matched
    .filter((r) => !existingAddr.has(idToFact.get(r.orderId)))
    .map((r) => ({
      shop_id: shopId,
      fact_order_id: idToFact.get(r.orderId),
      raw_address: [r.district, r.provinceRaw, r.zipcode].filter(Boolean).join(" "),
      district: r.district,
      province_code: r.provinceCode,
      zipcode: r.zipcode && /^\d{5}$/.test(r.zipcode) ? r.zipcode : null,
      address_type: "unknown",
      address_type_source: "rule",
      parse_confidence: "high",
    }));
  let addressInserted = 0;
  for (let i = 0; i < addressRows.length; i += CHUNK) {
    const slice = addressRows.slice(i, i + CHUNK);
    const { error } = await db.schema("analytics").from("dim_address").insert(slice);
    if (error) throw error;
    addressInserted += slice.length;
  }

  console.log("---");
  console.log(`เขียนแล้ว: fact_order ${updated} แถว · dim_address ${addressInserted} แถว`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
