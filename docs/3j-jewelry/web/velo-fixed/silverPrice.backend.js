/**
 * backend/silverPrice.js  (Wix Velo backend web module)
 *
 * เหตุการณ์ 2 ก.ย. 69: หน้า 3jthailand.com/silver-price โชว์ "0 บาท" ทุกช่อง จริง (ลูกค้าเห็น)
 *
 * สาเหตุ: แท็บที่เผยแพร่เปลี่ยนจาก "5%" (แท็บต้นทุน/กำไร ของภายในร้าน) -> "Web Price"
 * (ตั้งใจเปลี่ยน เพราะแท็บ "5%" มีต้นทุน+กำไรของร้าน ห้ามเผยแพร่เด็ดขาด เคยหลุดขึ้น repo สาธารณะมาแล้ว
 * ครั้งหนึ่ง — ⚠️ ห้ามแก้กลับไปเผยแพร่แท็บ "5%" เด็ดขาด ไม่ว่าจะด้วยเหตุผลอะไร)
 *
 * แท็บ "Web Price" มีแค่ 11 แถว x 7 คอลัมน์ (แท็บ "5%" มี 60+ แถว) — โค้ดเวอร์ชันก่อนหน้านี้อ่านด้วย
 * index ตายตัวที่ผูกกับโครง "5%" (rows[63]/rows[64]/rows[65], rows[3..7][7]/[10]) พอสลับแท็บ
 * ตำแหน่งพวกนั้นกลายเป็น undefined -> cleanNumber(undefined) คืน "0" -> เว็บโชว์ 0 ทั้งกระดานเงียบๆ
 * โดยไม่มี error ให้เห็นที่ไหนเลย (นี่คือสาเหตุจริงที่แก้ในรอบนี้ — ไม่ใช่ snapshot/fetch พัง)
 *
 * แก้โดยเปลี่ยนมาอ่านด้วย "label" (ข้อความในเซลล์) แทน index ตายตัว — ทนต่อการสลับแท็บ/เพิ่มคอลัมน์/
 * สลับลำดับแถวในอนาคต ตราบใดที่ label (ข้อความ) ยังเหมือนเดิม ถ้าหา label ไม่เจอในชีต จะ
 * console.error บอกชื่อ label ที่หาไม่เจอ (เวอร์ชันก่อนเงียบแล้วคืน 0 — ไม่มีใครรู้ว่าพังจนลูกค้าทักมา)
 *
 * ฟีเจอร์ snapshot fallback (จาก fix ก่อนหน้า 6 ส.ค. 69) ยังคงอยู่ครบ ไม่แตะ:
 *   - fetch ได้ราคาที่ valid (ช่องหลัก > 0) -> ใช้ราคาสด + เขียนทับ snapshot
 *   - fetch ได้ราคาที่ไม่ valid (0/ว่าง) หรือ fetch พังทั้งก้อน -> อ่าน snapshot ล่าสุดมาคืนแทน + stale:true
 *   - ไม่มี snapshot เลย -> คืน { empty:true } ให้ frontend โชว์ข้อความติดต่อ LINE แทน 0 บาท
 *
 * field ที่ return ออกไปห้ามเปลี่ยนชื่อ/ตัดออกแม้แต่ตัวเดียว — หน้าเว็บ (silverPrice.page.js) ผูกอยู่ตรงๆ
 * ค่าที่คืนยังเป็น string ที่ตัดจุลภาคออกแล้วเหมือนเดิม (เช่น "67900")
 *
 * parseCSV/extractPrices/isValid/cleanNumber ถูก export เพิ่มจากเดิม (นอกเหนือ getSheetPrice) เพื่อให้
 * unit test เรียกตรงได้โดยไม่ต้อง mock fetch/wix-data — ไม่กระทบพฤติกรรมฝั่ง Wix เพราะไฟล์นี้เป็น
 * backend module ธรรมดา (ไม่ใช่ .web.js) export เพิ่มไม่ได้ทำให้กลายเป็น public web method
 */

import { fetch } from 'wix-fetch';
import wixData from 'wix-data';

const SHEET_URL = "<SILVER_SHEET_CSV_URL — ดูใน .env.local ห้ามใส่ URL จริงลง repo>";
const SNAPSHOT_COLLECTION = "PriceSnapshots";
const SNAPSHOT_ID = "latest";

// เซลล์ที่เป็น "ตัวเลขราคาล้วน" หลังตัด comma คั่นหลักพัน (รองรับทศนิยมเผื่ออนาคต) — ใช้คัดเซลล์ราคา
// ออกจากเซลล์ label/วันที่ ("2-Sep-2026")/เวลา ("14:30") ซึ่งมีตัวอักษรหรือ : / - ปนอยู่เสมอ ไม่ match ที่นี่
const NUMERIC_CELL = /^[\d,]+(\.\d+)?$/;

// ---------- CSV parsing ----------

/**
 * แปลง 1 บรรทัด CSV เป็น array ของเซลล์ — เขียนใหม่แทน regex เดี่ยวเดิม
 * (`(".*?"|[^",\s]+)(?=\s*,|\s*$)`) เพราะตัวเดิมพังกับเซลล์ที่ไม่ได้ครอบ quote แต่มีช่องว่างในข้อความ
 * (พบจริงตอนแก้บั๊กนี้: cell "ขายออก รวม VAT" -> เหลือแค่ "VAT", cell "0.5 บาท"/"1 บาท"/... -> เหลือแค่
 * "บาท" ตัวเดียวกันหมดทุกขนาด ทำให้แยกขนาดไม่ออกเลย) parser ใหม่นี้เป็น CSV parser มาตรฐาน
 * (รองรับ quote และ escaped-quote "") ไม่ผูกกับ format ของแท็บไหนทั้งสิ้น
 */
function parseCSVLine(line) {
    const cells = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (line[i + 1] === '"') {
                    cur += '"';
                    i++; // escaped quote ("") ภายในเซลล์ที่ครอบด้วย quote
                } else {
                    inQuotes = false;
                }
            } else {
                cur += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            cells.push(cur.trim());
            cur = "";
        } else {
            cur += ch;
        }
    }
    cells.push(cur.trim());
    return cells;
}

export function parseCSV(text) {
    return String(text ?? "").split(/\r\n|\n|\r/).map(parseCSVLine);
}

export function cleanNumber(val) {
    if (!val) return "0";
    return val.replace(/,/g, "");
}

// ---------- อ่านค่าด้วย label (แทน index ตายตัวของเดิม) ----------

function rowHasExactCell(row, label) {
    return row.some(cell => cell === label);
}

/**
 * ไล่หาตัวเลขในแถว โดยเริ่มมองหลังตำแหน่ง label เท่านั้น (ไม่มองย้อนไปก่อน label) — กันปัญหาถ้ามีคอลัมน์
 * อื่น (เช่น เลขลำดับแถว) อยู่ก่อนหน้า label ในแถวเดียวกันแล้วดันถูกหยิบผิดตัวไปเป็นราคา
 * คืน array ตามลำดับที่เจอ ยาวสุด maxCount ตัว — ไม่ครบก็คืนเท่าที่มี (caller ตัดสินเองว่าจะ fallback ยังไง)
 * คืน null ถ้าไม่พบ label นี้ในแถวนี้เลย
 */
function numbersAfterLabel(row, label, maxCount) {
    const idx = row.indexOf(label);
    if (idx === -1) return null;
    const found = [];
    for (let i = idx + 1; i < row.length && found.length < maxCount; i++) {
        if (NUMERIC_CELL.test(row[i])) found.push(row[i]);
    }
    return found;
}

/**
 * หาค่าตัวเลขตัวแรกหลัง label เดียว ไล่ทีละแถวในชีต — ใช้กับ label ที่มีค่าเดียวต่อชีต เช่น
 * "ขายออก"/"ซื้อเข้า"/"ขายออก รวม VAT" ในแถวราคากิโล และ "ซื้อเข้า" ในแถว buyPerBaht
 * rowFilter ใช้จำกัดว่าต้องเป็นแถวแบบไหน (เช่น ต้องมี/ไม่มี label อื่นร่วมด้วยในแถวเดียวกัน) เพื่อแยก
 * แถวราคากิโล ("ขายออก" + "ซื้อเข้า" อยู่คู่กัน) ออกจากแถว buyPerBaht ("ซื้อเข้า" อยู่ตัวเดียว)
 */
function valueAfterLabelInSheet(rows, label, rowFilter, labelForLog) {
    const candidateRows = rows.filter(rowFilter);
    for (const row of candidateRows) {
        const nums = numbersAfterLabel(row, label, 1);
        if (nums && nums.length > 0) return cleanNumber(nums[0]);
    }
    console.error(
        `[silverPrice] ไม่พบค่าของ label "${labelForLog || label}" ใน Web Price sheet — ` +
        `เช็คว่าข้อความ label ในชีตเปลี่ยนไปหรือยัง (index ตายตัวเดิมเคยพังเพราะเหตุนี้มาแล้วครั้งหนึ่ง)`
    );
    return "0";
}

/**
 * แถวราคาต่อขนาด ("0.5 บาท"/"1 บาท"/"3 บาท"/"5 บาท"/"10 บาท") — เทียบ label แบบตรงตัวเป๊ะ (===) เท่านั้น
 * ห้ามใช้ includes/startsWith เด็ดขาด เพราะ "1 บาท" เป็น substring ของ "10 บาท" ตรงๆ (และของ "0.5 บาท"
 * ถ้าเทียบแบบหลวม) — ใช้ includes จะทำให้ "1 บาท" ไปหยิบค่าของแถว "10 บาท" หรือ "0.5 บาท" แทน
 * ตัวเลขตัวแรกหลัง label = ราคาขาย · ตัวที่สอง = ราคาซื้อ (ชีตยังไม่มีคอลัมน์ซื้อ -> ไม่มีตัวที่สอง -> "0")
 */
function sizeSellBuy(rows, label) {
    const row = rows.find(r => rowHasExactCell(r, label));
    if (!row) {
        console.error(`[silverPrice] ไม่พบแถวขนาด "${label}" ใน Web Price sheet`);
        return { sell: "0", buy: "0" };
    }
    const nums = numbersAfterLabel(row, label, 2) || [];
    if (nums.length === 0) {
        console.error(`[silverPrice] แถวขนาด "${label}" ไม่มีตัวเลขราคาขายถัดจาก label`);
    }
    return {
        sell: nums[0] ? cleanNumber(nums[0]) : "0",
        buy: nums[1] ? cleanNumber(nums[1]) : "0",
    };
}

// ---------- ดึงราคาทั้งหมด ----------

/**
 * ดึงราคาทั้งหมดจาก rows ที่ parse แล้ว — คืน field set เดิมทุกตัว (ห้ามเปลี่ยนชื่อ/ตัดออก)
 * แยกออกมาเป็นฟังก์ชันย่อยจาก getSheetPrice() เพื่อให้ isValid()/snapshot/test เรียกใช้ซ้ำได้
 */
export function extractPrices(rows) {
    const half = sizeSellBuy(rows, "0.5 บาท");
    const one = sizeSellBuy(rows, "1 บาท");
    const three = sizeSellBuy(rows, "3 บาท");
    const five = sizeSellBuy(rows, "5 บาท");
    const ten = sizeSellBuy(rows, "10 บาท");

    // แถวราคากิโล = แถวที่มีทั้ง "ขายออก" และ "ซื้อเข้า" อยู่ด้วยกัน — แยกจากแถว buyPerBaht ที่มีแค่ "ซื้อเข้า"
    const isKiloRow = r => rowHasExactCell(r, "ขายออก") && rowHasExactCell(r, "ซื้อเข้า");
    const sell1kg = valueAfterLabelInSheet(rows, "ขายออก", isKiloRow, "ขายออก (ราคากิโล)");
    const buy1kg = valueAfterLabelInSheet(rows, "ซื้อเข้า", isKiloRow, "ซื้อเข้า (ราคากิโล)");
    const sellVat1kg = valueAfterLabelInSheet(rows, "ขายออก รวม VAT", isKiloRow, "ขายออก รวม VAT (ราคากิโล)");

    // buyPerBaht = แถวที่มี "ซื้อเข้า" แต่ไม่มี "ขายออก" ร่วมด้วย (แยกจากแถวราคากิโลด้านบน)
    const isBuyPerBahtRow = r => rowHasExactCell(r, "ซื้อเข้า") && !rowHasExactCell(r, "ขายออก");
    const buyPerBaht = valueAfterLabelInSheet(rows, "ซื้อเข้า", isBuyPerBahtRow, "ซื้อเข้า (ราคาต่อบาท)");

    return {
        sell1kg,
        sellVat1kg,
        buy1kg,
        sellHalfBaht: half.sell,
        sellOneBaht: one.sell,
        sellThreeBaht: three.sell,
        sellFiveBaht: five.sell,
        sellTenBaht: ten.sell,
        buyHalfBaht: half.buy,
        buyOneBaht: one.buy,
        buyThreeBaht: three.buy,
        buyFiveBaht: five.buy,
        buyTenBaht: ten.buy,
        buyPerBaht,

        // field ซ้ำชุดที่ 2 (ค่าเดียวกัน) — คงไว้ตามเดิมเพราะหน้าเว็บมี element 2 ชุด (#xxx + #xxx1)
        // known issue (ไม่แก้ในรอบนี้): เป็น redundant data ที่ควร refactor รวมเป็นชุดเดียวแล้วให้ frontend
        // set 2 element จาก field เดียว — คงพฤติกรรมเดิมไว้ตามที่สั่ง ไม่ตัดทิ้งเพื่อไม่ให้หน้าเว็บพัง
        // ราคากิโลชุดที่ 2 — โค้ดที่รันอยู่บน Wix จริงคืน 3 ตัวนี้ด้วย (ตรวจจากไฟล์ที่
        // เจ้าของ paste มา 2 ก.ย. 69). ถ้าไม่คืน element ชุด #xxx1 บนหน้าเว็บจะได้
        // undefined แทนตัวเลข — พังกว่าเดิมที่อย่างน้อยยังโชว์ 0
        sell1kg1: sell1kg,
        sellVat1kg1: sellVat1kg,
        buy1kg1: buy1kg,
        sellHalfBaht1: half.sell,
        sellOneBaht1: one.sell,
        sellThreeBaht1: three.sell,
        sellFiveBaht1: five.sell,
        sellTenBaht1: ten.sell,
        buyHalfBaht1: half.buy,
        buyOneBaht1: one.buy,
        buyThreeBaht1: three.buy,
        buyFiveBaht1: five.buy,
        buyTenBaht1: ten.buy,
        buyPerBaht1: buyPerBaht,
    };
}

/**
 * ราคา "valid" ต้องมีช่องหลักเป็นเลข > 0 อย่างน้อย sell1kg และ sellOneBaht
 * (สองช่องนี้เป็นราคาที่เจ้าของกรอก/สูตรคำนวณก่อน — ถ้า 0 แปลว่า Sheet ยังไม่ update จริง)
 */
export function isValid(d) {
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
/**
 * ทุกช่องราคาเป็น "0" — ใช้เป็นฐานของ return ตอนไม่มีอะไรให้แสดงจริงๆ
 *
 * ทำไมต้องมี: โค้ดที่รันอยู่บน Wix ตอนนี้คืน "ทุกช่องเสมอ" (เป็น "0" เมื่ออ่านไม่ได้)
 * ⇒ หน้าเว็บเขียนแบบพึ่งพาว่าช่องมีอยู่จริง ถ้าเราคืน { empty:true } เปล่าๆ
 * หน้าเว็บจะได้ undefined แล้วโชว์คำว่า "undefined บาท" ซึ่งแย่กว่าโชว์ 0
 * (เจอตอนเทียบกับโค้ดจริงที่เจ้าของ paste มา 2 ก.ย. 69)
 */
function zeroPrices() {
    const keys = [
        "sell1kg", "sellVat1kg", "buy1kg",
        "sellHalfBaht", "sellOneBaht", "sellThreeBaht", "sellFiveBaht", "sellTenBaht",
        "buyHalfBaht", "buyOneBaht", "buyThreeBaht", "buyFiveBaht", "buyTenBaht",
        "buyPerBaht",
    ];
    const out = {};
    for (const k of keys) {
        out[k] = "0";
        out[`${k}1`] = "0";
    }
    return out;
}

async function readSnapshot() {
    try {
        const r = await wixData.get(SNAPSHOT_COLLECTION, SNAPSHOT_ID, { suppressAuth: true });
        if (!r) return { ...zeroPrices(), empty: true, stale: true };
        return { ...zeroPrices(), ...JSON.parse(r.payload), stale: true, empty: false, fetchedAt: r.fetchedAt };
    } catch (err) {
        // ครอบคลุมกรณี collection "PriceSnapshots" ยังไม่ถูกสร้างบน Wix ด้วย —
        // ไม่ควรทำให้หน้าเว็บพัง แค่ไม่มีของสำรองให้ใช้
        console.error("[silverPrice] readSnapshot failed:", err);
        return { ...zeroPrices(), empty: true, stale: true };
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

        // ราคาสด invalid (0/ว่าง เช่น ตอนตี 4 เจ้าของยังไม่กรอก หรือหา label ไม่เจอ) -> ใช้ snapshot แทน
        return await readSnapshot();
    } catch (err) {
        // fetch ทั้งก้อนพัง (เน็ตหลุด/Sheet unpublish ชั่วคราว ฯลฯ) -> ใช้ snapshot แทนเช่นกัน
        console.error("[silverPrice] getSheetPrice fetch failed:", err);
        return await readSnapshot();
    }
}
