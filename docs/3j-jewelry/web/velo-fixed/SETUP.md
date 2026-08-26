# Setup — แก้ราคา "0 บาท" นอกเวลาทำการ (silver-bar / silver-price)

> อ้างอิง design: `docs/3j-jewelry/web/price-system-analysis.md`
> ไฟล์โค้ด: `silverPrice.backend.js`, `silverPrice.page.js` (โฟลเดอร์เดียวกับไฟล์นี้)

## 0. สรุปสิ่งที่แก้ (ก่อนลงมือ)

1. เพิ่ม snapshot fallback — ราคาไม่ valid หรือ fetch พัง → ใช้ราคาล่าสุดที่เคยเซฟไว้แทน 0
2. ไม่มี snapshot เลย → โชว์ "กำลังอัปเดตราคา ติดต่อ LINE" แทนตารางราคา (ไม่มี 0 บาทหลุดออกจอแน่นอน)
3. แก้บั๊ก `price.buyPerBaht` ที่ backend ไม่เคย return (ตอนนี้ = ค่าเดียวกับ `buyOneBaht`, rows[4][10]) — **ต้องให้เจ้าของยืนยันว่าถูกต้องไหม** (ดู §4)
4. Logic เดิมทั้งหมด (parseCSV, index rows/columns) **ไม่แตะ** — ตอน Sheet ปกติ ราคาต้องแสดงเป๊ะเหมือนเดิม

---

## 1. สร้าง Wix Data Collection `PriceSnapshots`

ใน Wix Editor → **CMS (Content Manager)** → **+ Create Collection**

- ชื่อ collection: `PriceSnapshots` (ตัวสะกดต้องตรงเป๊ะ เพราะโค้ดอ้างชื่อนี้ตรงๆ)
- Fields ที่ต้องเพิ่ม (นอกจาก `_id` ที่มีอยู่แล้วโดย default):

| Field key | Type | หมายเหตุ |
|---|---|---|
| `payload` | Text | เก็บราคาทั้งหมดเป็น JSON string |
| `fetchedAt` | Date and Time | เวลาที่ fetch ราคาสดสำเร็จล่าสุด |

- **Permissions** (แท็บ Permissions ของ collection):
  - **Read**: Anyone (ถ้าจะให้ frontend อ่านตรงๆ ในอนาคต; ปัจจุบันโค้ดอ่าน/เขียนผ่าน backend ด้วย `suppressAuth: true` เท่านั้น จะตั้ง Read = Admin ก็ได้ไม่กระทบ แต่ตั้ง Anyone ไว้เผื่อ debug ผ่าน CMS UI)
  - **Write/Insert/Update**: **Admin** (สำคัญ — ห้ามตั้งเป็น Anyone มิฉะนั้น visitor แก้ราคาปลอมผ่าน API ได้)

- ไม่ต้องสร้าง record ล่วงหน้า — โค้ดจะสร้าง record `_id: "latest"` เองอัตโนมัติตอน fetch ราคาสดสำเร็จครั้งแรก

---

## 2. วางโค้ด backend

1. Editor → **Velo sidebar (ไอคอน `</>`)** → **Backend** → เปิดไฟล์ `silverPrice.js` (ไฟล์เดิม)
2. **สำรองโค้ดเดิมก่อน** — copy โค้ดปัจจุบันทั้งหมดวางไว้ที่อื่น (Notepad/Google Doc) ตั้งชื่อว่า "silverPrice.js — backup ก่อน 2026-08-06"
3. ลบเนื้อหาทั้งหมดในไฟล์ แล้ววาง เนื้อหาจาก `silverPrice.backend.js` (ไฟล์นี้อยู่โฟลเดอร์เดียวกับ SETUP.md) ทับลงไป
4. Save (Ctrl+S) — เช็คว่าไม่มี syntax error สีแดงในแถบซ้าย

---

## 3. วางโค้ด frontend (หน้า /silver-bar และ /silver-price — ทำทีละหน้า)

สำหรับแต่ละหน้า (`/silver-bar`, `/silver-price`):

1. เปิดหน้านั้นใน Editor → กด `</>` (Page code)
2. **สำรองโค้ดเดิมของหน้านั้นก่อน** เหมือนขั้นตอน backend
3. เช็ค element ID บนหน้าจริงให้ตรงกับที่โค้ดใหม่อ้างถึง (ดูรายการใน comment หัวไฟล์ `silverPrice.page.js`) — ถ้าหน้าเจ้าของใช้ชื่อ element ต่างจากนี้ (เช่น `#txtSellHalf` แทน `#sellHalf`) **ต้องแก้ชื่อใน `silverPrice.page.js` ให้ตรงก่อนวาง** ไม่งั้น error "element not found"
4. **เพิ่ม text element ใหม่ 1 ตัว** ชื่อ `#lastUpdate` ถ้าหน้ายังไม่มี (ใช้แสดง badge "อัปเดตราคาล่าสุด : ..." หรือ "ราคาล่าสุด ณ ..." หรือ "กำลังอัปเดตราคา ติดต่อ LINE") — วางตำแหน่งใต้ตารางราคาหรือหัวตาราง
5. (ทางเลือก ไม่บังคับ) ถ้าอยากซ่อนตารางราคาทั้งหมดตอนไม่มี snapshot เลย (`empty:true`) — จัด container ครอบตารางราคาเป็น 1 กล่อง ตั้งชื่อ `#priceTable` (และ `#priceTable1` ถ้ามีตารางชุดที่ 2) โค้ดจะ hide/show ให้อัตโนมัติ ถ้าไม่ตั้งชื่อ container ก็ไม่เป็นไร — โค้ดมี try/catch กันไว้ ไม่ทำหน้าพัง แค่ตารางจะยังอยู่แต่โชว์ตัวเลขจาก snapshot เก่าแทน (ก็ยังไม่ใช่ 0 บาท)
6. วางโค้ดจาก `silverPrice.page.js` ทับ
7. **ถ้าหน้ามี `formatPrice()` ที่ประกาศซ้ำอยู่แล้วในไฟล์เดิม** (นอกเหนือจากที่แปะมาให้ดู) ให้ลบตัวซ้ำออก เหลือไว้ตัวเดียว — Velo จะ error "duplicate declaration" ถ้ามี `function formatPrice` 2 อัน
8. Save

---

## 4. จุดที่ต้องให้เจ้าของยืนยัน (backend-dev ตัดสินใจเองชั่วคราว)

**`buyPerBaht`** — ในโค้ดเดิม frontend เรียก `price.buyPerBaht` แต่ backend ไม่เคยมี field นี้เลย (บั๊กเดิม ทำให้ element นี้โชว์ 0 บาทมาตลอด ไม่ใช่แค่นอกเวลาทำการ)

ตอนนี้แก้ให้ `buyPerBaht = buyOneBaht` (rows[4][10] — คอลัมน์ "ซื้อเข้า" แถวขนาด 1 บาท) เพราะเป็นสมมติฐานที่สมเหตุสมผลที่สุด (ราคารับซื้อคืนต่อหน่วย "1 บาท") แต่ **ไม่ใช่การยืนยันจริงว่า element `#buyPerBaht` บนหน้าเว็บควรโชว์เลขนี้**

**ให้เจ้าของทำ:** เปิด `/silver-bar` หรือ `/silver-price` ตอนราคาแสดงปกติ (กลางวัน) เทียบว่าตัวเลขที่ element `#buyPerBaht` เคยโชว์ (ตอนที่ไม่ error) ตรงกับ `#buyOne` หรือไม่ ถ้าไม่ตรง แจ้งกลับมาว่าควรมาจากคอลัมน์ไหนใน Sheet แล้วแก้บรรทัดเดียวใน `extractPrices()`:

```js
buyPerBaht: cleanNumber(rows[4]?.[10]),   // <- แก้ index ตรงนี้ถ้าจำเป็น
```

---

## 5. Test steps (ทำเองบน Wix จริงหลัง publish หรือ preview)

### 5.1 ราคาปกติ (regression — ต้องเหมือนเดิมเป๊ะ)
- เปิดหน้าในเวลาทำการที่ Sheet มีราคาครบ → เทียบตัวเลขทุกช่อง (ขายออก/ซื้อเข้า 0.5-10 บาท, ราคากิโล 3 บรรทัด) กับที่เคยเห็นก่อนแก้โค้ด (จากภาพ audit ตอน 16:21 หรือเปิด production ปัจจุบันเทียบคู่กันในแท็บ)
- badge `#lastUpdate` ต้องขึ้น "อัปเดตราคาล่าสุด : [วันที่เวลาปัจจุบัน]"
- เปิด CMS → collection `PriceSnapshots` → ต้องมี record `_id: latest` ถูกสร้าง/อัปเดต `fetchedAt` เป็นเวลาปัจจุบัน

### 5.2 จำลองราคา invalid (สำคัญที่สุด — ทดสอบ fallback)
วิธีจำลองโดยไม่แตะ Sheet จริง: ชั่วคราวแก้ `isValid()` ใน backend เป็น `return false;` เพื่อบังคับ path snapshot (**อย่าลืมเปลี่ยนกลับหลัง test เสร็จ**) แล้ว publish/preview:
- ถ้าเคยมี snapshot จากขั้นตอน 5.1 มาก่อน → ตารางราคาต้องโชว์เลขเดิม (จาก snapshot) ไม่ใช่ 0
- badge ต้องขึ้น "ราคาล่าสุด ณ [เวลาตอนที่เคย fetch สำเร็จ] (อัปเดตอีกครั้งในเวลาทำการ)"
- **ต้องไม่มี "0 บาท" โผล่ที่ไหนเลยบนหน้า**
- แก้ `isValid()` กลับเป็นของเดิมหลัง test

### 5.3 ไม่มี snapshot เลย (empty state)
- ลบ record `latest` ออกจาก CMS ชั่วคราว (หรือ test บน environment ใหม่ที่ยังไม่เคย fetch สำเร็จ) แล้วบังคับ `isValid()` return false เหมือน 5.2
- ต้องเห็น `#lastUpdate` = "กำลังอัปเดตราคา ติดต่อ LINE" และไม่มี "0 บาท" ที่ไหน
- คืนค่า `isValid()` กลับปกติ แล้วโหลดหน้าอีกครั้งตอน Sheet มีราคาจริง เพื่อให้ snapshot ถูกสร้างใหม่

### 5.4 นอกเวลาทำการจริง (final check)
- เปิดหน้าตอนตี 3-4 (เวลาที่เคย audit เจอ 0 บาททุกช่อง) → ต้องเห็นราคาจาก snapshot (เลขของเมื่อวานตอนเย็น/บ่าย) พร้อม badge stale ไม่ใช่ 0 บาท

---

## 6. Rollback

ถ้าแก้แล้วมีปัญหา (ราคาไม่ขึ้น, element error, ฯลฯ):

1. เปิด Velo backend `silverPrice.js` → ลบเนื้อหาทั้งหมด → วางโค้ด backup ที่เก็บไว้ใน §2 ข้อ 2 กลับ
2. ทำแบบเดียวกันกับ page code ของแต่ละหน้า (backup จาก §3 ข้อ 2)
3. Save + Publish
4. Collection `PriceSnapshots` ทิ้งไว้เฉยๆ ได้ ไม่กระทบระบบเดิม (ไม่มีโค้ดไหนอ้างถึงมันแล้วหลัง rollback) จะลบทีหลังก็ได้ ไม่เร่งด่วน

---

## 7. Known issues ที่ยังไม่แก้ในรอบนี้ (บันทึกไว้ตรงๆ)

- `sellVat1kg` fallback (`getNumber(rows[64]) || getNumber(findRow(...))`) เป็น dead code เพราะ `getNumber` คืน `"0"` (truthy) เสมอ — ไม่กระทบราคาปกติที่ทำงานอยู่ (`rows[64]` เจอค่าตรงอยู่แล้ว) แต่ถ้าวันไหน `rows[64]` เพี้ยน fallback จะไม่ทำงานจริง — ไม่แตะรอบนี้ตามกติกาเหล็ก "ห้ามเปลี่ยน index/logic เดิม" ที่ยังทำงานได้
- Hardcoded row/column index (`rows[63]`, `rows[3][7]` ฯลฯ) ยังเปราะเหมือนเดิม — ถ้าเจ้าของแทรก/ลบแถวหรือคอลัมน์ใน Sheet วันไหน ราคาจะเพี้ยนแบบเงียบๆ (ไม่ error ไม่ error ให้เห็น) ระบบ snapshot ที่เพิ่มรอบนี้ช่วยกัน "0 บาท" แต่ไม่ช่วยกัน "ราคาเพี้ยนแต่ดูเหมือนปกติ" — ต้องแก้ด้วยการเปลี่ยนไป `findRow` keyword-based ทั้งหมด (ยกเครื่องใหญ่กว่านี้ ควรทำเป็นงานแยก)
- Field ซ้ำชุดที่ 2 (`sellHalfBaht1` ฯลฯ) ยังคงไว้ตามเดิมเพื่อ backward-compat กับหน้าที่มี element 2 ชุด — ควร refactor ให้ frontend set 2 element จาก field เดียวในอนาคต ลดโค้ดซ้ำ
- ไม่มี scheduled job อัตโนมัติ — snapshot จะอัปเดตก็ต่อเมื่อมีคนเข้าเว็บช่วงที่ Sheet มีราคา valid เท่านั้น ถ้าทั้งวันไม่มีใครเข้าเว็บตอนราคาปกติเลย snapshot จะค้างเก่าข้ามวัน (ยังดีกว่า 0 บาท แต่ badge เวลาจะห่างมาก) — แผนเสริม: เพิ่ม `jobs.config` fetch ทุก 15 นาทีช่วงเวลาทำการ (ระบุไว้แล้วใน price-system-analysis.md เป็น "Optional เฟสหลัง" ไม่ได้ทำในรอบนี้)
- ยังไม่ได้ทดสอบบน Wix Editor จริง (เขียนตาม Velo API spec + สังเกตโค้ดเดิมที่เจ้าของส่งมา) — เจ้าของต้องรัน test steps §5 เองก่อนเชื่อว่าใช้งานได้จริง 100%
