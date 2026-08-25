#!/usr/bin/env node
// scripts/scrape-silver-price.mjs
//
// อ่านราคาเงินจากหน้าเว็บร้าน https://www.3jthailand.com/silver-price
// แล้วบันทึกลง analytics.silver_price_daily
//
// ทำไมต้องเปิดเบราว์เซอร์จริง (ไม่ใช่ curl):
// หน้านี้เป็น Wix และราคาไม่ได้อยู่ใน HTML ที่เซิร์ฟเวอร์ส่งมาเลย — ตรวจแล้ว
// ทั้ง HTML ดิบ (174KB), ไฟล์เนื้อหาหน้าเว็บของ Wix (248KB) และ bundle ของ
// Velo ไม่มีตัวเลขสักตัว และตอนโหลดหน้าก็ไม่มี request ไหนที่ดึงราคาให้เห็น
// (Wix รันโค้ดหน้าเว็บใน Web Worker ซึ่งมองไม่เห็นจากภายนอก)
//
// แปลว่าไม่มี URL ไหนที่ยิงแล้วได้ราคากลับมา — ราคาปรากฏก็ต่อเมื่อหน้าเว็บ
// ทำงานจริงเท่านั้น จึงต้องเปิดเบราว์เซอร์ให้มันทำงานแล้วค่อยอ่านตัวเลข
//
// ใช้ Chrome ที่เครื่องมีอยู่แล้ว (channel: chrome) ไม่ต้องโหลด browser
// เพิ่ม 150MB
//
// Usage:
//   node --env-file=.env.local scripts/scrape-silver-price.mjs [--commit] [--show]
//     --commit  เขียนลง DB จริง (ไม่ใส่ = อ่านแล้วโชว์เฉยๆ)
//     --show    เปิดหน้าต่างเบราว์เซอร์ให้เห็น (ใช้ตอน debug)
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEV_SHOP_ID
//
// ตั้งเวลารันอัตโนมัติ: ดู scripts/setup-silver-price-task.ps1

import { chromium } from "playwright-core";
import { createClient } from "@supabase/supabase-js";

const PAGE_URL = "https://www.3jthailand.com/silver-price";
const NAV_TIMEOUT_MS = 60_000;
const PRICE_WAIT_MS = 30_000;

function env(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`${name} is not set (source .env.local via --env-file).`);
  return v;
}

/** "74,200 บาท" -> 74200 · "550.5 บาท" -> 550.5 · อย่างอื่น -> null */
function toNumber(s) {
  if (!s) return null;
  const m = String(s).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** แปลงวันที่ไทยบนหน้าเว็บ ("25 สิงหาคม 2569 เวลา 13:36:27") เป็น ISO + เวลา
 *
 * ปีบนหน้าเว็บเป็น พ.ศ. ต้องลบ 543 · ถ้าแปลงไม่ได้ให้คืน null แล้วให้ผู้เรียก
 * ตัดสินใจ — ห้ามเดาเป็น "วันนี้" เงียบๆ เพราะถ้าหน้าเว็บค้างราคาเก่าไว้
 * เราจะบันทึกราคาเก่าทับวันปัจจุบันโดยไม่มีใครรู้ */
const TH_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];
function parseThaiDate(text) {
  const m = text.match(/(\d{1,2})\s+([฀-๿]+)\s+(\d{4})(?:\s*เวลา\s*([\d:]+))?/);
  if (!m) return { date: null, time: null };
  const day = Number(m[1]);
  const monthIdx = TH_MONTHS.indexOf(m[2]);
  const buddhistYear = Number(m[3]);
  if (monthIdx < 0 || !Number.isFinite(day) || !Number.isFinite(buddhistYear)) {
    return { date: null, time: m[4] ?? null };
  }
  const year = buddhistYear - 543;
  const iso = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { date: iso, time: m[4] ?? null };
}

/** ดึงตัวเลขทั้งหมดจากข้อความทั้งหน้า
 *
 * อ่านจาก innerText ของทั้งหน้า ไม่ผูกกับ CSS selector หรือ component id
 * ของ Wix โดยเจตนา — id พวกนั้น (เช่น comp-mrdc7bbh) เปลี่ยนเองเมื่อแก้หน้าเว็บ
 * ส่วนคำว่า "ขนาด 1 บาท" กับ "ราคารวม VAT" เป็นข้อความที่คนอ่าน ถ้ามันเปลี่ยน
 * แปลว่าหน้าเว็บเปลี่ยนจริง ซึ่งเราอยากให้ดังมากกว่าอยากให้เดาต่อ */
function parsePage(text) {
  const out = { raw_text_len: text.length };

  const { date, time } = parseThaiDate(text);
  out.as_of_date = date;
  out.sheet_time = time;

  // แท่ง 1 กิโล: ตัวเลขหลัก 3 ตัวเรียงกัน — ซื้อเข้า, ขายออก, รวม VAT
  const kilo = text.match(/([\d,]+)\s*บาท\s+([\d,]+)\s*บาท[\s\S]{0,80}?VAT[\s\S]{0,40}?([\d,]+)\s*บาท/);
  if (kilo) {
    out.kilo_buy = toNumber(kilo[1]);
    out.kilo_sell = toNumber(kilo[2]);
    out.kilo_sell_vat = toNumber(kilo[3]);
  }

  // ตารางขนาดแท่ง: "ขนาด X บาท | ราคาขายออก | ราคาซื้อเข้า"
  // ⚠️ ในตารางจริงบางแถวสลับลำดับ (เช่น 3 บาท ขึ้นซื้อเข้าก่อนขายออก)
  // จึงจับเลข 2 ตัวแล้วตัดสินจากค่า: ตัวมากคือขายออก ตัวน้อยคือซื้อเข้า
  // (ร้านขายแพงกว่ารับซื้อคืนเสมอ — เป็นจริงทุกขนาดตามข้อมูลที่ตรวจแล้ว)
  const sizes = [
    ["0.5", "bar_0_5"],
    ["1", "bar_1"],
    ["3", "bar_3"],
    ["5", "bar_5"],
    ["10", "bar_10"],
  ];
  for (const [label, key] of sizes) {
    const re = new RegExp(`ขนาด\\s*${label}\\s*บาท[\\s\\S]{0,60}?([\\d,.]+)\\s*บาท[\\s\\S]{0,40}?([\\d,.]+)\\s*บาท`);
    const m = text.match(re);
    if (!m) continue;
    const a = toNumber(m[1]);
    const b = toNumber(m[2]);
    if (a === null || b === null) continue;
    out[`${key}_sell`] = Math.max(a, b);
    out[`${key}_buy`] = Math.min(a, b);
  }

  // ราคาเนื้อเงินต่อน้ำหนัก 1 บาท — หน้าเว็บไม่ได้โชว์ตรงๆ แต่ราคาซื้อคืน
  // เป็นเส้นตรงพอดี (ตรวจแล้ว: 11,010 = 1,101x10 · 5,505 = 1,101x5)
  // จึงถอดออกมาจากแท่ง 1 บาทได้
  out.buy_per_baht = out.bar_1_buy ?? null;
  out.sell_per_baht = out.bar_1_sell ?? null;

  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const show = args.includes("--show");

  const browser = await chromium.launch({ channel: "chrome", headless: !show });
  let parsed;
  try {
    const page = await browser.newPage({ locale: "th-TH" });
    page.setDefaultTimeout(NAV_TIMEOUT_MS);
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });

    // รอจนราคาโผล่จริง — ห้ามใช้ sleep ตายตัว เพราะวันที่เน็ตช้าจะอ่านหน้าเปล่า
    // แล้วบันทึกค่าว่างทับของดีในฐานข้อมูล
    await page.waitForFunction(
      () => /ขนาด\s*10\s*บาท/.test(document.body.innerText) && /VAT/.test(document.body.innerText),
      undefined,
      { timeout: PRICE_WAIT_MS }
    );

    const text = await page.evaluate(() => document.body.innerText);
    parsed = parsePage(text);
    parsed.source_url = PAGE_URL;
  } finally {
    await browser.close();
  }

  console.log("อ่านได้จากหน้าเว็บ:");
  console.log(`  วันที่บนหน้าเว็บ : ${parsed.as_of_date ?? "(แปลงไม่ได้)"} ${parsed.sheet_time ?? ""}`);
  console.log(`  เนื้อเงิน/บาท    : ขายออก ${parsed.sell_per_baht ?? "-"} · ซื้อเข้า ${parsed.buy_per_baht ?? "-"}`);
  for (const [label, key] of [["0.5", "bar_0_5"], ["1", "bar_1"], ["3", "bar_3"], ["5", "bar_5"], ["10", "bar_10"]]) {
    console.log(`  แท่ง ${label.padStart(4)} บาท   : ขายออก ${parsed[`${key}_sell`] ?? "-"} · ซื้อเข้า ${parsed[`${key}_buy`] ?? "-"}`);
  }
  console.log(`  แท่ง 1 กิโล      : ขายออก ${parsed.kilo_sell ?? "-"} · +VAT ${parsed.kilo_sell_vat ?? "-"} · ซื้อเข้า ${parsed.kilo_buy ?? "-"}`);

  // ---- ตรวจก่อนเขียน ----
  const problems = [];
  if (!parsed.as_of_date) problems.push("แปลงวันที่บนหน้าเว็บไม่ได้");
  if (!parsed.bar_1_sell || !parsed.bar_10_sell || !parsed.kilo_sell) problems.push("อ่านราคาหลักไม่ครบ (หน้าเว็บอาจเปลี่ยนโครงสร้าง)");
  if (parsed.sell_per_baht && parsed.buy_per_baht && parsed.sell_per_baht < parsed.buy_per_baht) {
    problems.push("ราคาขายออกต่ำกว่าซื้อเข้า — น่าจะอ่านสลับคอลัมน์");
  }
  if (problems.length) {
    console.error("\n❌ ไม่เขียนลง DB เพราะ:");
    for (const p of problems) console.error(`   - ${p}`);
    process.exit(1);
  }

  if (!commit) {
    console.log("\nDRY-RUN — ยังไม่เขียนลง DB · ใส่ --commit เพื่อเขียนจริง");
    return;
  }

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const { error } = await db.schema("analytics").rpc("silver_price_set", {
    p_shop_id: env("DEV_SHOP_ID"),
    p_as_of_date: parsed.as_of_date,
    p_sell_per_baht: parsed.sell_per_baht,
    p_buy_per_baht: parsed.buy_per_baht,
    p_bar_0_5: parsed.bar_0_5_sell ?? null,
    p_bar_1: parsed.bar_1_sell ?? null,
    p_bar_3: parsed.bar_3_sell ?? null,
    p_bar_5: parsed.bar_5_sell ?? null,
    p_bar_10: parsed.bar_10_sell ?? null,
    p_kilo_sell: parsed.kilo_sell ?? null,
    p_kilo_sell_vat: parsed.kilo_sell_vat ?? null,
    p_kilo_buy: parsed.kilo_buy ?? null,
    p_sheet_time: parsed.sheet_time,
    p_source: "feed",
    p_raw: parsed,
  });
  if (error) throw error;

  console.log(`\n✅ บันทึกราคาวันที่ ${parsed.as_of_date} ลงฐานข้อมูลแล้ว`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
