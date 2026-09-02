#!/usr/bin/env node
// scripts/capture-silver-price-sheet.mjs
//
// อ่านราคาเงินตรงจาก Google Sheet ต้นทางที่ป้อนราคาเข้าเว็บ Wix อยู่แล้ว
// แล้วบันทึกลง analytics.silver_price_history (ทุก capture ทุกแถว — log
// ที่เก็บได้บ่อยกว่าที่โชว์สาธารณะ) และ upsert ลง analytics.silver_price_daily
// เดิมด้วย (คงพฤติกรรมเดิมให้ผู้ใช้ตารางเก่า — oem_bar_quote/v_silver_price_trend
// อ่านตารางนั้นอยู่).
//
// ทำไมไม่ต้องเปิดเบราว์เซอร์ (ต่างจาก scrape-silver-price.mjs): ตัวนี้อ่าน
// จาก Google Sheets API v4 โดยตรง (JSON REST) ซึ่งไม่ต้อง render JS เหมือน
// หน้าเว็บ Wix — fetch ธรรมดาพอ
//
// 🔴 2026-09-02 (feat/sheets-api-auth): เปลี่ยนจากลิงก์ "เผยแพร่สู่เว็บ"
// (public CSV publish endpoint) มาเป็น Google Sheets API v4 +
// service account (JWT bearer, scope readonly) เพราะลิงก์เผยแพร่แบบเดิม
// เปิดให้ใครก็ได้ที่มี URL ดาวน์โหลดทั้งแท็บ (ไม่ใช่แค่ราคาที่ขึ้นเว็บ) —
// ยืนยันแล้วว่า URL เดิมเคยหลุดขึ้น repo สาธารณะ ⇒ ถือว่ารั่วถาวรแล้ว
// (ดู pricing-disclosure-policy memory + brief งานนี้)
// ไม่มี fallback ไปลิงก์สาธารณะอีกต่อไป — ขาด credential = สคริปต์หยุดทำงาน
// ทันที ไม่ใช่ปิดช่องโหว่แล้วเปิดใหม่โดยไม่ตั้งใจ
//
// วิธีอ่าน mapping: ใช้ text anchor หา header row ก่อน (ไม่ผูก index ตรงๆ)
// แล้วอ่านค่าจากตำแหน่งคอลัมน์ที่หาเจอจริงในแถวนั้น + แถวถัดไป — กันปัญหา
// คอลัมน์เยื้อง/ลำดับสลับที่เกิดขึ้นจริงในชีตนี้ (ดู docs/3j-jewelry/web/
// velo-fixed/silverPrice.backend.js กับดักเดิม + brief งานนี้) — ยกไปอยู่ที่
// scripts/lib/silver-sheet-parse.mjs (pure, unit-tested แยกจากไฟล์นี้)
//
// Usage:
//   node --env-file=.env.local scripts/capture-silver-price-sheet.mjs [--commit]
//     --commit  เขียนลง DB จริง (ไม่ใส่ = dry-run พิมพ์ค่าที่อ่านได้เฉยๆ)
//
// Env (ทั้งหมดจำเป็น แม้จะเป็น dry-run เพราะต้องใช้ดึงราคาจากชีต):
//   GOOGLE_SERVICE_ACCOUNT_KEY_FILE  path ไปไฟล์ .json ของ service account
//                                    (อยู่นอก repo — ห้ามยัดคีย์ลง env ตรงๆ
//                                    เพราะเป็น multi-line ป้องกัน escape พัง)
//   SILVER_SHEET_ID                  spreadsheet id
//   SILVER_SHEET_RANGE               เช่น 'ราคา'!A1:Z80
// Env (จำเป็นเฉพาะตอน --commit): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEV_SHOP_ID
//
// 🔴 ห้าม log: private key · access token · spreadsheet id — ข้อความ error
// ทุกจุดด้านล่างอ้างชื่อ env var เท่านั้น ไม่พิมพ์ค่าจริง
// ข้อยกเว้นเดียว: client_email พิมพ์ได้เฉพาะใน error 403 (ดูเหตุผลตรงจุดนั้น) —
// มันคือ "ชื่อผู้ใช้" ของ service account สิ่งที่เป็นความลับจริงคือ private key

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extractServiceAccountFields, buildJwtClaimSet, signJwt } from "./lib/google-sheets-auth.mjs";
import { parseSheet } from "./lib/silver-sheet-parse.mjs";

const SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

// ---- required env (checked immediately, before any network/file I/O, so a
// missing var fails fast with a list of exactly what's missing) ----
const REQUIRED_ENV = ["GOOGLE_SERVICE_ACCOUNT_KEY_FILE", "SILVER_SHEET_ID", "SILVER_SHEET_RANGE"];
const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name] || !process.env[name].trim());
const hasRequiredEnv = missingEnv.length === 0;
// process.exitCode (never process.exit()) everywhere in this file: no
// fetch() has happened yet at THIS point so process.exit() would be safe
// here, but every path below performs a fetch(), and Node 24 on Windows has
// a reproducible crash (`Assertion failed: !(handle->flags &
// UV_HANDLE_CLOSING)`, libuv src/win/async.c) when process.exit() runs
// shortly after any fetch() in the same process — confirmed via isolated
// repro during this change. process.exitCode + letting the module finish
// naturally avoids it everywhere (here, the cross-check failure below, and
// main().catch() at the bottom) without special-casing "did we fetch yet".
if (!hasRequiredEnv) {
  console.error(`❌ ไม่พบ environment variable ต่อไปนี้ใน .env.local: ${missingEnv.join(", ")}`);
  console.error("   ดูตัวอย่างที่ต้องตั้งใน .env.local.example (หัวข้อ Silver price — Google Sheets API)");
  process.exitCode = 1;
}

function env(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`${name} is not set (source .env.local via --env-file).`);
  return v;
}

/** Reads + validates the service-account key file. Every failure mode gets
 * its own Thai message per brief (missing env handled above already; this
 * covers: file not found/unreadable, not valid JSON, valid JSON but missing
 * required fields). Never includes the key file's contents in the message. */
function loadServiceAccountKey(keyFilePath) {
  let raw;
  try {
    raw = readFileSync(keyFilePath, "utf8");
  } catch (err) {
    throw new Error(
      `อ่านไฟล์ service account key ไม่ได้ตาม path ที่ตั้งไว้ใน GOOGLE_SERVICE_ACCOUNT_KEY_FILE (${err.code ?? err.name}) — ตรวจว่าไฟล์มีอยู่จริงและมีสิทธิ์อ่าน`
    );
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(
      "ไฟล์ที่ GOOGLE_SERVICE_ACCOUNT_KEY_FILE ชี้ไปอ่านได้แต่ไม่ใช่ JSON ที่ถูกต้อง — ตรวจว่าดาวน์โหลดไฟล์ service account key JSON มาแบบไม่เพี้ยน/ไม่ถูกตัดครึ่ง"
    );
  }
  return extractServiceAccountFields(json); // throws Thai-message errors on missing fields (see google-sheets-auth.mjs)
}

/** JWT-bearer token exchange (RFC 7523) — builds + signs the assertion, then
 * POSTs it to Google's token endpoint. Returns an access_token string. */
async function getAccessToken({ clientEmail, privateKey, tokenUri }) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const claimSet = buildJwtClaimSet({ clientEmail, scope: SHEETS_READONLY_SCOPE, tokenUri, nowSeconds });

  let assertion;
  try {
    assertion = signJwt(claimSet, privateKey);
  } catch {
    throw new Error(
      "เซ็น JWT ด้วย private key ในไฟล์ key ไม่สำเร็จ — ตรวจว่าฟิลด์ private_key ในไฟล์ JSON เป็น PEM ที่ถูกต้องครบ (ขึ้นต้น -----BEGIN PRIVATE KEY-----) ไม่ได้ถูกตัด/แก้ไขระหว่างทาง"
    );
  }

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  let res;
  try {
    res = await fetch(tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (err) {
    throw new Error(`เชื่อมต่อ Google token endpoint ไม่สำเร็จ (${err.message}) — ตรวจการเชื่อมต่อเน็ตเวิร์กของเครื่องนี้`);
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const reason = json?.error_description || json?.error || `HTTP ${res.status}`;
    throw new Error(
      `ขอ access token จาก Google ไม่สำเร็จ (${reason}) — สาเหตุที่เป็นไปได้: key ถูก revoke/ลบไปแล้ว, หรือเวลาของเครื่องนี้ (system clock) คลาดเกิน 5 นาที (JWT หมดอายุทันทีถ้าเวลาไม่ตรง) — ตรวจสองอย่างนี้ก่อน`
    );
  }
  if (!json?.access_token) {
    throw new Error("Google ตอบกลับ HTTP 200 แต่ไม่มี access_token ในผลลัพธ์ — โครงสร้าง response ของ Google อาจเปลี่ยน ต้องดู log ละเอียดเพิ่ม");
  }
  return json.access_token;
}

/** Calls spreadsheets.values.get. Returns `values` (string[][], same shape
 * parseSheet() already expects). 403/404/400 each get a distinct, actionable
 * Thai message per brief — none of them print the spreadsheet id itself. */
async function fetchSheetValues({ accessToken, spreadsheetId, range, clientEmail }) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch (err) {
    throw new Error(`เชื่อมต่อ Google Sheets API ไม่สำเร็จ (${err.message}) — ตรวจการเชื่อมต่อเน็ตเวิร์กของเครื่องนี้`);
  }
  if (!res.ok) {
    const errJson = await res.json().catch(() => null);
    if (res.status === 403) {
      throw new Error(
        // client_email ถูกพิมพ์ออกมาตรงนี้โดยตั้งใจ (Tech Lead ตัดสิน 1 ก.ย. 69):
        // มันเป็น "ชื่อผู้ใช้" ของ service account ไม่ใช่ความลับ — สิ่งที่ให้สิทธิ์
        // เข้าถึงคือ private key ในไฟล์ ไม่ใช่อีเมลนี้ และนี่คือ error เดียวที่คน
        // ตั้งค่าต้องอ่านตอนติดตั้ง การให้เขาไปเปิดไฟล์ JSON หาเองเพิ่มขั้นตอน
        // โดยไม่ได้ปลอดภัยขึ้นจริง. ส่วน private key / access token ยังห้ามพิมพ์เด็ดขาด
        `Google Sheets API ตอบ 403 (permission denied) — ยังไม่ได้แชร์ Google Sheet ให้ service account\n` +
          `  ให้ไปที่ Google Sheet กดปุ่ม Share แล้วเพิ่มอีเมลนี้เป็น Viewer:\n` +
          `    ${clientEmail}\n` +
          `  (Viewer พอ เพราะ scope ขอแค่ readonly)`
      );
    }
    if (res.status === 404) {
      throw new Error("Google Sheets API ตอบ 404 (not found) — ตรวจค่า SILVER_SHEET_ID ใน .env.local ว่าถูกต้องและสเปรดชีตยังไม่ถูกลบ/ย้าย");
    }
    if (res.status === 400) {
      throw new Error(
        `Google Sheets API ตอบ 400 (bad request${errJson?.error?.message ? `: ${errJson.error.message}` : ""}) — ตรวจรูปแบบ SILVER_SHEET_RANGE ใน .env.local (เช่น 'ราคา'!A1:Z80) ว่าชื่อชีต/ช่วงเซลล์ถูกต้อง`
      );
    }
    throw new Error(`Google Sheets API ตอบ HTTP ${res.status}${errJson?.error?.status ? ` (${errJson.error.status})` : ""} — ลองใหม่อีกครั้ง ถ้ายังไม่หายให้ตรวจ Google Cloud status/quota`);
  }
  const json = await res.json();
  return json.values ?? [];
}

// ============================================================================
// Main
// ============================================================================
async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");

  const serviceAccount = loadServiceAccountKey(env("GOOGLE_SERVICE_ACCOUNT_KEY_FILE"));
  const accessToken = await getAccessToken(serviceAccount);
  const values = await fetchSheetValues({
    accessToken,
    spreadsheetId: env("SILVER_SHEET_ID"),
    range: env("SILVER_SHEET_RANGE"),
    clientEmail: serviceAccount.clientEmail,
  });

  const { data, problems, warnings, asOfDate, asOfDateRaw, sheetTime } = parseSheet(values);

  console.log("อ่านได้จาก Google Sheet:");
  console.log(`  วันที่บนชีต : ${asOfDateRaw ?? "(หาไม่เจอ)"} -> ${asOfDate ?? "(แปลงไม่ได้)"}  เวลา: ${sheetTime ?? "-"}`);
  console.log("  🟢 สาธารณะ:");
  for (const [label, suffix] of [["0.5", "0_5"], ["1", "1"], ["3", "3"], ["5", "5"], ["10", "10"]]) {
    console.log(`    แท่ง ${label.padStart(4)} บาท : ขาย ${data[`sell_${suffix}`] ?? "-"} · ซื้อ ${data[`buy_${suffix}`] ?? "-"}`);
  }
  console.log(`    กิโล            : ขาย ${data.kilo_sell ?? "-"} · +VAT ${data.kilo_sell_vat ?? "-"} · ซื้อ ${data.kilo_buy ?? "-"}`);
  console.log("  🔴 ภายใน (ไม่ขึ้นสาธารณะ):");
  console.log(`    silver_value_per_baht=${data.silver_value_per_baht ?? "-"} usd_per_kg=${data.usd_per_kg ?? "-"} usd_thb=${data.usd_thb ?? "-"} thb_per_kg=${data.thb_per_kg ?? "-"} block_fee_kg=${data.block_fee_kg ?? "-"}`);

  if (warnings.length > 0) {
    console.warn("\n⚠️  คำเตือน (ไม่บล็อกการบันทึก):");
    for (const w of warnings) console.warn(`   - ${w}`);
  }

  if (problems.length > 0) {
    console.error("\n❌ ไม่บันทึกอะไรลง DB เพราะ cross-check ล้มเหลว:");
    for (const p of problems) console.error(`   - ${p}`);
    process.exitCode = 1; // see the note near REQUIRED_ENV re: process.exit() after fetch() crashing on Node 24/Windows
    return;
  }

  console.log("\n✅ cross-check ผ่านทุกข้อ");

  if (!commit) {
    console.log("\nDRY-RUN — ยังไม่เขียนลง DB · ใส่ --commit เพื่อเขียนจริง");
    return;
  }

  const shopId = env("DEV_SHOP_ID");
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

  // hash เฉพาะฟิลด์ตัวเลขที่ parse ได้ (ไม่รวม raw/เวลา capture) — เรียง key
  // ให้ deterministic กันหน้าตา JSON ต่างกันแต่ข้อมูลเหมือนกัน
  const hashSource = Object.keys(data)
    .sort()
    .reduce((acc, k) => {
      acc[k] = data[k];
      return acc;
    }, {});
  const sheetRowHash = createHash("sha256").update(JSON.stringify(hashSource)).digest("hex");

  const { error: historyError } = await db
    .schema("analytics")
    .from("silver_price_history")
    .insert({ shop_id: shopId, sheet_row_hash: sheetRowHash, raw: data, ...data });

  if (historyError) {
    if (historyError.code === "23505") {
      console.log("ℹ️  ราคาไม่เปลี่ยนจาก capture ครั้งก่อน (hash ซ้ำ) — ข้ามการบันทึก silver_price_history");
    } else {
      throw historyError;
    }
  } else {
    console.log("✅ บันทึก silver_price_history แล้ว");
  }

  if (!asOfDate) {
    console.warn("⚠️  ข้าม upsert silver_price_daily เพราะแปลงวันที่บนชีตไม่ได้");
  } else {
    const { error: dailyError } = await db.schema("analytics").rpc("silver_price_set", {
      p_shop_id: shopId,
      p_as_of_date: asOfDate,
      p_sell_per_baht: data.silver_value_per_baht ?? null,
      p_buy_per_baht: data.buy_1 ?? null,
      p_bar_0_5: data.sell_0_5 ?? null,
      p_bar_1: data.sell_1 ?? null,
      p_bar_3: data.sell_3 ?? null,
      p_bar_5: data.sell_5 ?? null,
      p_bar_10: data.sell_10 ?? null,
      p_kilo_sell: data.kilo_sell ?? null,
      p_kilo_sell_vat: data.kilo_sell_vat ?? null,
      p_kilo_buy: data.kilo_buy ?? null,
      p_sheet_time: sheetTime,
      p_source: "sheet",
      p_raw: data,
    });
    if (dailyError) throw dailyError;
    console.log(`✅ upsert silver_price_daily (${asOfDate}) แล้ว`);
  }
}

if (hasRequiredEnv) {
  main().catch((err) => {
    // ห้ามพิมพ์ error object ทั้งก้อน — ของเดิม (ก่อน 2026-09-02) พิมพ์ err ทั้งก้อน
    // ซึ่ง err.cause ของ fetch อาจพ่วง URL/host ออกมาได้ พิมพ์แค่ name+message พอ
    console.error(`${err.name}: ${err.message}`);
    process.exitCode = 1; // see the note near REQUIRED_ENV re: process.exit() after fetch() crashing on Node 24/Windows
  });
}
// (no `else`: missing-env case above already set process.exitCode = 1 and
// there's nothing left to run, so the module just finishes naturally.)
