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
const PRICE_WAIT_MS = 45_000;   // รอราคาโหลด (หน้าเว็บใช้ ~5-6 วิ เผื่อวันเน็ตช้า)
const UPDATE_RETRY_MS = 25_000; // รออีกรอบหลังกดปุ่ม Update

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
function parsePage(text, rows) {
  const out = { raw_text_len: text.length };

  for (const [key, v] of Object.entries(rows ?? {})) out[key] = v;

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

  // ตารางขนาดแท่ง — ค่าถูกอ่านจากตำแหน่งจริงบนจอ (ดู readRowsByPosition)
  // แล้วส่งเข้ามาทาง rows ไม่ได้แกะจาก innerText ตรงนี้อีกแล้ว
  //
  // เหตุผล: Wix วางข้อความแบบ absolute ลำดับใน DOM/innerText จึงไม่ตรงกับ
  // ลำดับที่ตาเห็น ตอนแกะด้วย regex จาก innerText แถว "ขนาด 3 บาท" ไปหยิบ
  // เลข 5 จากคำว่า "ขนาด 5 บาท" ที่อยู่ติดกันมาเป็นราคาซื้อเข้า (ได้ 5 บาท)
  // ราคาผิดแบบนี้ถ้าหลุดเข้า DB จะเอาไปตีราคารับซื้อคืนผิดทันที

  // ราคาเนื้อเงินต่อน้ำหนัก 1 บาท — หน้าเว็บไม่ได้โชว์ตรงๆ แต่ราคาซื้อคืน
  // เป็นเส้นตรงพอดี (ตรวจแล้ว: 11,010 = 1,101x10 · 5,505 = 1,101x5)
  // จึงถอดออกมาจากแท่ง 1 บาทได้
  // ราคารับซื้อคืนเป็นเส้นตรงกับน้ำหนักเป๊ะ (11,010 = 1,101x10 - ตรวจแล้ว)
  // จึงถอด "ราคาเนื้อเงิน" ขารับซื้อออกมาจากแท่ง 1 บาทได้ตรงๆ
  out.buy_per_baht = out.bar_1_buy ?? null;
  // ขาขายออกถอดแบบเดียวกันไม่ได้ - ราคาแท่งรวม premium ไว้แล้ว และแท่งเล็ก
  // premium สูงกว่าแท่งใหญ่ (0.5 บาท +32% / 10 บาท +22%) หน้าเว็บก็ไม่ได้
  // ประกาศราคาเนื้อเงินขาขายไว้ที่ไหนเลย จึงปล่อยเป็น null = "ไม่รู้"
  // เคยเผลอใส่ราคาแท่ง 1 บาทลงช่องนี้ แล้วรายงานคิด % เทียบกับวันที่กรอกมือ
  // (ซึ่งเป็นราคาเนื้อเงินจริง) ได้ผลว่า "ขึ้น 28.65% ในวันเดียว" ทั้งที่
  // 28.65% คือค่า premium ไม่ใช่การเคลื่อนไหวของราคา - ดู migration 0074
  out.sell_per_baht = null;

  return out;
}


/** อ่านตารางราคาโดยดูตำแหน่งจริงบนจอ ไม่ใช่ลำดับใน DOM
 *
 * รันในเบราว์เซอร์: เก็บ element ทุกตัวที่ข้อความเป็น "ขนาด X บาท" หรือเป็น
 * ตัวเลข "N บาท" พร้อมพิกัด แล้วจัดกลุ่มเป็นแถวตามพิกัดแนวตั้ง (y ใกล้กัน
 * = แถวเดียวกัน) จากนั้นเรียงซ้ายไปขวาในแถว
 *
 * ตารางบนหน้าเว็บคือ  [ขนาด] [ราคาขายออก] [ราคาซื้อเข้า]  ซ้ายไปขวา
 * จึงได้ขายออก = ตัวแรก, ซื้อเข้า = ตัวที่สอง ตรงตามที่คนอ่าน */
const READ_ROWS_FN = () => {
  const SIZE_KEY = { "0.5": "bar_0_5", "1": "bar_1", "3": "bar_3", "5": "bar_5", "10": "bar_10" };
  const items = [];
  for (const el of document.querySelectorAll("*")) {
    if (el.children.length > 0) continue; // เอาเฉพาะ leaf จะได้ไม่นับซ้ำ
    const t = (el.textContent || "").trim();
    if (!t) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const size = t.match(/^ขนาด\s*([\d.]+)\s*บาท$/);
    const price = t.match(/^([\d,]+(?:\.\d+)?)\s*บาท$/);
    if (size) items.push({ kind: "size", size: size[1], x: r.left, y: r.top });
    else if (price) items.push({ kind: "price", value: Number(price[1].replace(/,/g, "")), x: r.left, y: r.top });
  }

  const out = {};
  for (const it of items.filter((i) => i.kind === "size")) {
    const key = SIZE_KEY[it.size];
    if (!key) continue;
    // ราคาที่อยู่แถวเดียวกัน (ต่างกันแนวตั้งไม่เกิน 20px) และอยู่ขวาของป้ายขนาด
    const sameRow = items
      .filter((p) => p.kind === "price" && Math.abs(p.y - it.y) <= 20 && p.x > it.x)
      .sort((a, b) => a.x - b.x);
    if (sameRow.length >= 2) {
      out[key + "_sell"] = sameRow[0].value;
      out[key + "_buy"] = sameRow[1].value;
    }
  }
  return out;
};

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

    // รอจน "ราคาเป็นตัวเลขจริง" ไม่ใช่แค่ตารางโผล่
    //
    // หน้านี้เรนเดอร์ตารางทันทีพร้อมเลข 0 ทุกช่อง แล้วอีก ~5-6 วินาทีค่อยดึง
    // ราคาจริงมาใส่ทับ — สคริปต์รอบแรกรอแค่ข้อความ "ขนาด 10 บาท" ซึ่งโผล่
    // ตั้งแต่วินาทีแรกพร้อมเลข 0 จึงอ่านไปตอนยังเป็นศูนย์ทั้งหน้า
    //
    // ไม่ใช้ sleep ตายตัว 10 วิ เพราะวันที่เน็ตช้ากว่าปกติก็จะพลาดเหมือนเดิม
    // และวันที่เร็วก็เสียเวลารอเปล่า — เช็คเงื่อนไขจริงแล้วรอจนกว่าจะจริง
    // ดีกว่าเดาเวลา
    const pricesLoaded = () => {
      const m = document.body.innerText.match(/ขนาด\s*10\s*บาท[\s\S]{0,60}?([\d,.]+)\s*บาท/);
      if (!m) return false;
      return Number(m[1].replace(/,/g, "")) > 0;
    };

    let loaded = true;
    try {
      await page.waitForFunction(pricesLoaded, undefined, { timeout: PRICE_WAIT_MS });
    } catch {
      loaded = false;
    }

    // ถ้ายังเป็น 0 ลองกดปุ่ม "Update" บนหน้าเว็บ (ปุ่มสั่งดึงราคาใหม่)
    // แล้วรออีกรอบ — เจ้าของยืนยันว่ากดปุ่มนี้แล้วราคาขึ้นปกติ
    if (!loaded) {
      console.log("ราคายังเป็น 0 — ลองกดปุ่ม Update บนหน้าเว็บ");
      const btn = page.getByRole("button", { name: /update/i }).first();
      try {
        await btn.click({ timeout: 10_000 });
        await page.waitForFunction(pricesLoaded, undefined, { timeout: UPDATE_RETRY_MS });
        loaded = true;
      } catch {
        loaded = false;
      }
    }

    if (!loaded) {
      throw new Error(
        "หน้าเว็บยังโชว์ราคา 0 หลังรอและกด Update แล้ว — ไม่บันทึกอะไรลง DB (ดูว่าเว็บมีปัญหาหรือเปล่า)"
      );
    }

    const text = await page.evaluate(() => document.body.innerText);
    const rows = await page.evaluate(READ_ROWS_FN);
    parsed = parsePage(text, rows);
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
  for (const [label, v] of [["แท่ง 1 บาท", parsed.bar_1_sell], ["แท่ง 10 บาท", parsed.bar_10_sell], ["แท่ง 1 กิโล", parsed.kilo_sell]]) {
    if (v !== null && v !== undefined && v <= 0) problems.push(`${label} ราคาเป็น 0 — หน้าเว็บยังโหลดราคาไม่เสร็จ`);
  }
  if (parsed.sell_per_baht && parsed.buy_per_baht && parsed.sell_per_baht < parsed.buy_per_baht) {
    problems.push("ราคาขายออกต่ำกว่าซื้อเข้า — น่าจะอ่านสลับคอลัมน์");
  }
  // ราคารับซื้อคืนของร้านเป็นเส้นตรงกับน้ำหนักเป๊ะ (ตรวจจากข้อมูลจริงหลายวัน)
  // ถ้าแถวไหนหลุดจากเส้นนี้เกิน 2% แปลว่าอ่านผิดแถว — เป็นด่านที่จับบั๊ก
  // "3 บาท ได้ซื้อเข้า 5 บาท" ได้ตั้งแต่ก่อนเขียนลง DB
  if (parsed.buy_per_baht) {
    for (const [label, key, weight] of [["0.5", "bar_0_5", 0.5], ["3", "bar_3", 3], ["5", "bar_5", 5], ["10", "bar_10", 10]]) {
      const got = parsed[`${key}_buy`];
      if (got === null || got === undefined) continue;
      const expect = parsed.buy_per_baht * weight;
      if (Math.abs(got - expect) / expect > 0.02) {
        problems.push(`แท่ง ${label} บาท ราคาซื้อเข้า ${got} ผิดจากที่ควรเป็น ~${Math.round(expect)} — น่าจะอ่านผิดแถว`);
      }
    }
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
