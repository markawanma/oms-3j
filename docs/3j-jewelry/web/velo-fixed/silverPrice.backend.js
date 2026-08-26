/**
 * backend/silverPrice.js  (Wix Velo backend web module)
 *
 * แก้ปัญหา "0 บาท" นอกเวลาทำการ:
 *   - เดิม: ถ้า Google Sheet คืนค่าว่าง/0 → cleanNumber() คืน "0" → หน้าเว็บโชว์ 0 บาทตรงๆ
 *   - ใหม่: เพิ่ม snapshot fallback ผ่าน Wix Data collection "PriceSnapshots"
 *     - fetch ได้ราคาที่ valid (ช่องหลัก > 0) -> ใช้ราคาสด + เขียนทับ snapshot
 *     - fetch ได้ราคาที่ไม่ valid (0/ว่าง) หรือ fetch พังทั้งก้อน -> อ่าน snapshot ล่าสุดมาคืนแทน + flag stale:true
 *     - ไม่มี snapshot เลย (ครั้งแรกสุดที่ deploy ก่อนเคยมีราคาสด) -> คืน { empty:true } ให้ frontend โชว์ข้อความติดต่อ LINE แทน 0 บาท
 *
 * กติกาเหล็กที่ยึดตาม:
 *   - ไม่แตะ Google Sheet, ไม่แก้ index rows/columns เดิม (rows[3..7][7]/[10], rows[63..65])
 *   - parseCSV / cleanNumber / findRow / getNumber เหมือนเดิมทุกตัวอักษร (ยกเว้นเพิ่ม export ภายในไฟล์เท่านั้น ไม่กระทบ behavior)
 *   - ตอน Sheet ปกติ ต้องคืนค่าเป๊ะเหมือนโค้ดเดิม (ฟิลด์ครบ ค่าตรงกัน) — เพิ่มแค่ stale/fetchedAt/empty เป็น field เสริม
 */

import { fetch } from 'wix-fetch';
import wixData from 'wix-data';

const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRXbHasns4u6S9CWICbGDL2Rnj5fRAiYYwxBhYgjP_jYwY6Ccoqhdz5mQgPlC2DjzrCW4tyh1TIhTZg/pub?output=csv";
const SNAPSHOT_COLLECTION = "PriceSnapshots";
const SNAPSHOT_ID = "latest";

// ---------- Logic เดิม (ห้ามแก้ — ผูกกับโครงสร้าง Sheet จริง) ----------

function parseCSV(text) {
    return text.split("\n").map(row => row.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g)?.map(cell => cell.replace(/"/g, "")) || []);
}

function cleanNumber(val) {
    if (!val) return "0";
    return val.replace(/,/g, "");
}

function findRow(rows, keyword) {
    return rows.find(r => r.join("").includes(keyword));
}

function getNumber(row) {
    if (!row) return "0";
    if (row[2] && /^[\d,]+$/.test(row[2])) {
        return cleanNumber(row[2]);
    }
    const num = row.find(c => /^[\d,]+$/.test(c));
    return num ? cleanNumber(num) : "0";
}

// ---------- ส่วนที่เพิ่มใหม่ ----------

/**
 * ดึงราคาทั้งหมดจาก rows ที่ parse แล้ว — เนื้อหาเดิมทุกฟิลด์ + เพิ่ม buyPerBaht
 *
 * แยกออกมาเป็นฟังก์ชันย่อยจาก getSheetPrice() เดิม เพื่อให้ isValid()/snapshot
 * เรียกใช้ซ้ำได้โดยไม่ต้อง fetch ใหม่ — ไม่กระทบผลลัพธ์ที่ frontend เห็น
 */
function extractPrices(rows) {
    return {
        sell1kg: getNumber(rows[63]) || getNumber(findRow(rows, "ขายออก 1 กิโล")),
        sellVat1kg: getNumber(rows[64]) || getNumber(findRow(rows, "Vat")),
        buy1kg: getNumber(rows[65]) || getNumber(findRow(rows, "ซื้อเข้า")),
        sellHalfBaht: cleanNumber(rows[3]?.[7]),
        sellOneBaht: cleanNumber(rows[4]?.[7]),
        sellThreeBaht: cleanNumber(rows[5]?.[7]),
        sellFiveBaht: cleanNumber(rows[6]?.[7]),
        sellTenBaht: cleanNumber(rows[7]?.[7]),
        buyHalfBaht: cleanNumber(rows[3]?.[10]),
        buyOneBaht: cleanNumber(rows[4]?.[10]),
        buyThreeBaht: cleanNumber(rows[5]?.[10]),
        buyFiveBaht: cleanNumber(rows[6]?.[10]),
        buyTenBaht: cleanNumber(rows[7]?.[10]),

        // --- BUG FIX: buyPerBaht ---
        // เดิม frontend เรียก price.buyPerBaht แต่ backend ไม่เคย return field นี้ -> undefined -> "0 บาท" ตลอดเวลา (ไม่ใช่แค่นอกเวลาทำการ)
        // สมมติฐาน: "ราคารับซื้อคืนต่อบาท" ที่หน้าเว็บโชว์เป็นตัวเลขเดี่ยว (ไม่ใช่ตาราง) น่าจะหมายถึงราคารับซื้อคืนของขนาด "1 บาท" ซึ่งตรงกับ buyOneBaht (rows[4][10]) อยู่แล้ว
        // จึงตั้งค่า buyPerBaht = buyOneBaht ไปก่อน เพื่อไม่ให้ "0 บาท" ค้าง — ไม่ได้เดา index ใหม่จาก Sheet
        // [รอเจ้าของยืนยัน]: ถ้า element #buyPerBaht บนหน้าเว็บจริงๆ ควรโชว์เลขอื่น (เช่น ราคาต่อบาททองรวม VAT, หรือคอลัมน์อื่นใน Sheet) แจ้งกลับมาแล้วแก้บรรทัดนี้จุดเดียว
        buyPerBaht: cleanNumber(rows[4]?.[10]),

        // field ซ้ำชุดที่ 2 (ค่าเดียวกัน) — คงไว้ตามเดิมเพราะหน้าเว็บมี element 2 ชุด (#xxx + #xxx1)
        // known issue (ไม่แก้ในรอบนี้): เป็น redundant data ที่ควร refactor รวมเป็นชุดเดียวแล้วให้ frontend set 2 element จาก field เดียว
        sellHalfBaht1: cleanNumber(rows[3]?.[7]),
        sellOneBaht1: cleanNumber(rows[4]?.[7]),
        sellThreeBaht1: cleanNumber(rows[5]?.[7]),
        sellFiveBaht1: cleanNumber(rows[6]?.[7]),
        sellTenBaht1: cleanNumber(rows[7]?.[7]),
        buyHalfBaht1: cleanNumber(rows[3]?.[10]),
        buyOneBaht1: cleanNumber(rows[4]?.[10]),
        buyThreeBaht1: cleanNumber(rows[5]?.[10]),
        buyFiveBaht1: cleanNumber(rows[6]?.[10]),
        buyTenBaht1: cleanNumber(rows[7]?.[10]),
        buyPerBaht1: cleanNumber(rows[4]?.[10]),
    };
}

/**
 * ราคา "valid" ต้องมีช่องหลักเป็นเลข > 0 อย่างน้อย sell1kg และ sellOneBaht
 * (สองช่องนี้เป็นราคาที่เจ้าของกรอก/สูตรคำนวณก่อน — ถ้า 0 แปลว่า Sheet ยังไม่ update จริง)
 */
function isValid(d) {
    return Number(d.sell1kg) > 0 && Number(d.sellOneBaht) > 0;
}

/**
 * เขียนทับ snapshot ล่าสุด — ใช้ suppressAuth เพราะ backend module รันด้วยสิทธิ์ระบบ
 * (ไม่ใช่สิทธิ์ visitor ที่เข้าเว็บ) collection ตั้ง permission "write: Admin" ไว้อยู่แล้ว
 * suppressAuth ทำให้เขียนได้แม้ visitor เป็น anonymous
 */
async function saveSnapshot(data) {
    try {
        await wixData.save(SNAPSHOT_COLLECTION, {
            _id: SNAPSHOT_ID,
            payload: JSON.stringify(data),
            fetchedAt: new Date()
        }, { suppressAuth: true });
    } catch (err) {
        // เขียน snapshot ไม่สำเร็จ (เช่น permission ผิด/collection ยังไม่สร้าง) ไม่ควรทำให้ราคาสดที่ fetch ได้แล้วหายไปด้วย
        // -> log ไว้เฉยๆ ปล่อยให้ getSheetPrice() คืนราคาสดต่อไปตามปกติ
        console.error("[silverPrice] saveSnapshot failed:", err);
    }
}

/**
 * อ่าน snapshot ล่าสุด — ใช้ตอนราคาสด invalid หรือ fetch fail
 * คืน { empty: true } ถ้าไม่เคยมี snapshot เลย (deploy ใหม่ครั้งแรกและดันเจอนอกเวลาทำการพอดี)
 */
async function readSnapshot() {
    try {
        const r = await wixData.get(SNAPSHOT_COLLECTION, SNAPSHOT_ID, { suppressAuth: true });
        if (!r) return { empty: true, stale: true };
        return { ...JSON.parse(r.payload), stale: true, empty: false, fetchedAt: r.fetchedAt };
    } catch (err) {
        console.error("[silverPrice] readSnapshot failed:", err);
        return { empty: true, stale: true };
    }
}

/**
 * Entry point เดิมที่ frontend เรียก — ชื่อฟังก์ชัน/signature เหมือนเดิม (async, ไม่มี parameter)
 * เพื่อไม่ต้องแก้จุดเรียกใช้ฝั่ง frontend อื่นๆ ที่อาจมีเพิ่มเติมนอกเหนือหน้านี้
 */
export async function getSheetPrice() {
    try {
        const res = await fetch(SHEET_URL);
        const text = await res.text();
        const rows = parseCSV(text);
        const data = extractPrices(rows);

        if (isValid(data)) {
            // ราคาสด valid -> แสดงสด + เขียนทับ snapshot ไว้ใช้ตอน Sheet ว่าง/fetch fail ครั้งหน้า
            await saveSnapshot(data);
            return { ...data, stale: false, empty: false, fetchedAt: new Date() };
        }

        // ราคาสด invalid (0/ว่าง เช่น ตอนตี 4 เจ้าของยังไม่กรอก) -> ใช้ snapshot แทน
        return await readSnapshot();
    } catch (err) {
        // fetch ทั้งก้อนพัง (เน็ตหลุด/Sheet unpublish ชั่วคราว ฯลฯ) -> ใช้ snapshot แทนเช่นกัน
        console.error("[silverPrice] getSheetPrice fetch failed:", err);
        return await readSnapshot();
    }
}
