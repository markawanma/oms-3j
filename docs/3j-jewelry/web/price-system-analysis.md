# ระบบราคาเงินแท่งปัจจุบัน — วิเคราะห์ + แผนแก้ 0 บาท

> Tech Lead วิเคราะห์จากโค้ด Velo จริงที่เจ้าของส่งให้ · 2026-08-06
> **สถาปัตยกรรม: Velo backend fetch Google Sheet (published CSV) → frontend set text** — ไม่ใช่ iframe embed → snapshot fallback ทำได้

## สถาปัตยกรรมปัจจุบัน

```
Google Sheet (เจ้าของกรอก/สูตร)
   │ publish เป็น CSV: docs.google.com/.../pub?output=csv
   ▼
backend/silverPrice.js  getSheetPrice()
   │ fetch CSV → parseCSV → ดึงค่าตาม row/column index
   │   • 1kg: rows[63][2], rows[64], rows[65]
   │   • ขาย: rows[3..7][7]  (column H)
   │   • ซื้อ: rows[3..7][10] (column K)
   ▼
frontend page  loadPrice() → $w("#...").text = formatPrice(...)
```

## 🔴 Root cause "0 บาท" ตอนนอกเวลา (ยืนยันจากโค้ด)

`cleanNumber(val)` → คืน `"0"` เมื่อ val ว่าง/undefined → `formatPrice(0)` = `"0 บาท"`

**เมื่อ Sheet คืนค่าว่าง/0 (ตอนตี 4 เจ้าของยังไม่กรอก หรือสูตรยังไม่ update) → ทุกช่องกลายเป็น "0 บาท"** ไม่มี logic ตรวจว่า "ราคา 0 = ผิดปกติ" แล้ว fallback → ตรงกับอาการที่ audit เจอเป๊ะ (ตี 4 = 0 ทุกช่อง, บ่าย = มีราคา)

## 🐛 Bug อื่นที่เจอระหว่างอ่านโค้ด

1. **`price.buyPerBaht` ไม่มีใน backend** — frontend เรียก `$w("#buyPerBaht").text = formatPrice(price.buyPerBaht)` แต่ `getSheetPrice()` ไม่ return field นี้ → `undefined` → element #buyPerBaht แสดง "0 บาท" **ตลอดเวลา** (ไม่ใช่แค่ตอนนอกเวลา)
2. **`sellVat1kg` fallback เป็น dead code** — `getNumber(rows[64]) || getNumber(findRow(...))` — `getNumber` คืน string `"0"` เมื่อไม่เจอ ซึ่ง truthy → `||` ฝั่งขวาไม่ทำงานเลย
3. **Hardcoded index เปราะ** — `rows[63]`, `rows[3][7]` ถ้าเจ้าของแทรก/ลบแถวหรือคอลัมน์ใน Sheet ราคาเพี้ยนหมดเงียบๆ (มี `findRow` keyword fallback แต่ใช้แค่ 1kg)
4. **Field ซ้ำ 2 ชุด** — backend return `sellHalfBaht` + `sellHalfBaht1` (ค่าเดียวกัน), frontend set 2 element ชุด — redundant น่าจะเพราะมีตาราง 2 ตำแหน่ง refactor รวมได้

## ✅ แผนแก้ (snapshot fallback — ไม่แตะ Google Sheet ของเจ้าของ)

**หลักการ:** เพิ่ม Wix Data Collection `PriceSnapshots` เก็บราคาดีล่าสุด. ทุกครั้งที่ fetch:
- ถ้าราคา valid (ช่องหลัก > 0) → แสดงสด + **เขียนทับ snapshot**
- ถ้าราคา 0/ว่าง/fetch fail → **อ่าน snapshot ล่าสุดมาแสดง** + badge "ราคาล่าสุด ณ [เวลา]"

**Backend (แนวทาง — ให้ backend-dev เขียนเต็ม):**
```js
import wixData from 'wix-data';

function isValid(d){
  // ราคาหลักต้องเป็นเลข > 0 อย่างน้อยช่องสำคัญ
  return Number(d.sell1kg) > 0 && Number(d.sellOneBaht) > 0;
}

export async function getSheetPrice(){
  try {
    const res = await fetch(url);
    const rows = parseCSV(await res.text());
    const data = extractPrices(rows);      // logic เดิม + เพิ่ม buyPerBaht

    if (isValid(data)) {
      await wixData.save("PriceSnapshots",  // เขียนทับ record เดียว (fixed _id)
        { _id: "latest", payload: JSON.stringify(data), fetchedAt: new Date() },
        { suppressAuth: true });
      return { ...data, stale: false, fetchedAt: new Date() };
    }
    return await readSnapshot();            // ราคาไม่ valid → snapshot
  } catch (err) {
    return await readSnapshot();            // fetch fail → snapshot
  }
}

async function readSnapshot(){
  const r = await wixData.get("PriceSnapshots", "latest", { suppressAuth: true });
  if (!r) return { stale: true, empty: true };
  return { ...JSON.parse(r.payload), stale: true, fetchedAt: r.fetchedAt };
}
```

**Frontend:**
```js
const price = await getSheetPrice();
if (price.empty) {
  $w("#lastUpdate").text = "กำลังอัปเดตราคา ติดต่อ LINE";
} else {
  // set ราคาตามเดิม ...
  $w("#lastUpdate").text = price.stale
    ? "ราคาล่าสุด ณ " + fmt(price.fetchedAt) + " (อัปเดตอีกครั้งในเวลาทำการ)"
    : "อัปเดตราคาล่าสุด : " + fmt(new Date());
}
```

**UX rule:** ห้ามแสดง "0 บาท" ทุกกรณี — มี snapshot ใช้ snapshot, ไม่มีเลยแสดงข้อความติดต่อ

**Collection `PriceSnapshots`:** `_id` (Text, ใช้ "latest"), `payload` (Text/JSON), `fetchedAt` (Date). Permission: read = Anyone, write = Admin (backend `suppressAuth`)

**Effort:** M · **ไม่แตะ Google Sheet workflow เจ้าของเลย** — แค่เพิ่มชั้น cache ใน Velo

**Optional เฟสหลัง:** scheduled job (`jobs.config`) fetch ทุก 15 นาทีช่วงเวลาทำการ ให้ snapshot สดแม้ไม่มีคนเข้าเว็บ
