# Design: ระบบเก็บไฟล์ + อ่านใบปะหน้าพัสดุ → เติมจังหวัด

> ผู้ออกแบบ: architect (Yoda) · 28 ส.ค. 2569 · สถานะ: **รอเจ้าของเคาะ 4 ข้อท้ายเอกสาร**
> โจทย์: ลากใบปะหน้า PDF ใส่ `/tiktok/upload` → เก็บไฟล์จริง → อ่านเลขพัสดุ+จังหวัด → เติม `fact_order.province_code` ให้ออเดอร์ TH-XX (2,841 แถว, มี tracking_no ครบ 100%)

## 0. คำถามค้างจาก design เดิม (§8): OCR vs text-layer

ใช้ **text layer ผ่าน `unpdf` + parser ต่อ format** ไม่ใช้ OCR/LLM-vision — พิสูจน์กับใบจริงแล้วว่าได้ tracking+จังหวัด+zipcode ครบ ฟรี เร็ว deterministic
ผลพวง: **เฟสนี้รับ PDF เท่านั้น** JPG/PNG (ไม่มี text layer) reject พร้อมเหตุผล
trade-off ที่แพ้: OCR รองรับรูปถ่ายได้ แต่ช้า/แพง/ไม่ deterministic และยังไม่มีเคสจริง

## 1. เก็บไฟล์

- Supabase Storage bucket `shipping-labels` **private ล้วน** — ไม่มี storage policy ให้ anon/authenticated เลย (แอปยังไม่มี anon key อยู่แล้ว) เข้าถึงทาง service role ฝั่ง server เท่านั้น
- path: `{shop_id}/{yyyy-mm}/{sha256}.pdf` — **sha256 เป็นชื่อไฟล์ = dedupe โดยโครงสร้าง**
- .xlsx ยอดขาย**ยังไม่เก็บ** (flow นั้นไม่มีปัญหา re-parse จริง เจ้าของเก็บต้นฉบับเอง — YAGNI)
- โควตา 1GB: backlog ~2.8k หน้า ≈ 150–400MB พอ แต่ต้องมี retention (ข้อ 7)

## 2. ตารางผลอ่าน

สร้างใหม่ใน `analytics` — **ไม่ใช้ `public.shipment`** เพราะ FK เข้า `public.orders` ที่ว่างเปล่า (ยอดจริงอยู่ `analytics.fact_order`) ยืมมาใช้ = ผูกโดเมนผิดแล้ววันที่ OMS เกิดจริงต้องรื้อ

- `analytics.label_file` — 1 แถว/ไฟล์: `storage_path, file_sha256, page_count, status(uploaded|parsed|parse_failed|purged), parser_version` + `unique(shop_id, file_sha256)`
- `analytics.stg_label_page` — 1 แถว/หน้า (1 ใบ): `detected_format, tracking_no, zipcode, province_code, match_status, match_detail jsonb, fact_order_ids uuid[], applied_at, applied_prev_code` + `unique(label_file_id, page_no)`
- **Re-parse ได้เสมอ**: ไฟล์ตัวจริงอยู่ storage → ปุ่ม "อ่านใหม่" download+parse ทับ stg ชุดเดิมใน tx เดียว ไม่ต้องอัปใหม่
- **ไม่เก็บ raw text ลง DB** — มี PII เต็ม และ re-parse จากไฟล์ได้อยู่แล้ว

## 3. อ่านที่ไหน

server action + `unpdf` — แต่**ไฟล์ไม่ผ่าน server action body เลย**:
`createLabelUpload(name,size,sha256)` → ตอบ `createSignedUploadUrl` → client `PUT` ตรงเข้า Storage (token ใน URL ไม่ต้องใช้ anon key) → `parseLabelFile(fileId)` download ฝั่ง server แล้ว parse
→ ไม่ชน `serverActions.bodySizeLimit` 4MB · ไฟล์ 100 หน้า/20MB ผ่านได้ · text extraction หลักวินาที ไม่ชน timeout

ตัดทิ้ง: ขยาย `bodySizeLimit` (global ทุก action = เปิด DoS ฟรี) · edge function (runtime ใหม่ทั้งชุดเพื่องานที่ action ทำได้) · parse ฝั่ง client (เชื่อผลจาก client ไม่ได้)

⚠️ implementer ต้องตรวจก่อนเชื่อ: `createSignedUploadUrl` + PUT ตรงจาก browser โดยไม่มี anon key — อ่านจาก API contract ยังไม่ได้ยิงจริง ถ้าติดจริง ทางถอยคือขยาย `bodySizeLimit` เฉพาะกิจ + cap ขนาดไฟล์ฝั่ง action (แลก DoS surface ที่ต้องบันทึกเป็น debt)

## 4. จับคู่จังหวัด (หัวใจ)

ใช้ `thai-provinces.json` เป็นแหล่งเดียว (generate เป็น TS const) กติกาเรียงชั้น:

1. **Fold สองฝั่ง** — ตัดวรรณยุกต์+สระบน/ล่าง (ที่ฟอนต์ PUA กิน) จากทั้งข้อความใบและชื่อจังหวัดอ้างอิงก่อนเทียบ
2. **ห้าม substring — exact equality ของ token หลัง fold เท่านั้น** โดยมี boundary (ช่องว่าง/จุลภาค/ตัวเลข/ขึ้นบรรทัด) สองด้าน → ฆ่าบั๊ก `ลาดกระบัง→กระบี่`
3. **จังหวัด candidate ต้อง co-locate กับ zipcode 5 หลัก** (ห่าง ≤ ~80 ตัวอักษรใน text stream) — ที่อยู่ไทยบนใบจบด้วย "จังหวัด รหัสไปรษณีย์" เสมอ กัน false positive จากคำพ้องกลางหน้า
4. **ตัด sender ด้วย fingerprint คู่ (จังหวัดร้าน + zipcode ร้าน) จาก config — ตัดหนึ่ง occurrence ที่ตรงทั้งคู่เท่านั้น** ไม่กวาดทุกกรุงเทพ → ลูกค้ากรุงเทพจริง (คนละ zipcode) ยังผ่าน
5. เหลือ candidate **จังหวัดเดียว → matched** · เหลือ 0 หรือ >1 → `needs_review` เก็บ candidates ใน `match_detail` ให้คนเลือก — **ไม่เดา ไม่เขียน DB**
6. **zipcode เดี่ยวห้ามชี้จังหวัด** (บทเรียน prefix 79.5%) — ใช้เป็น anchor ข้อ 3 เท่านั้น จนกว่ามีตาราง 5 หลักเต็มที่พิสูจน์แล้ว (Phase 3)
7. Tracking: หน้าที่เจอเลขพัสดุต่างกัน >1 ค่า = `needs_review`

## 5. เขียนกลับ fact_order

**auto-apply เฉพาะเคส matched ผ่าน RPC ที่ guard ใน SQL: `... and f.province_code = 'TH-XX'`** — ทับข้อมูลดี**ไม่ได้โดยโครงสร้าง** ไม่ใช่โดยวินัย · apply ซ้ำ = idempotent ฟรี

- เหตุผลไม่รอกดยืนยันรายใบ: 2.8k ใบ กดทีละใบคืองานที่เจ้าของไม่ทำจริง — trade-off ที่แพ้: ปุ่มยืนยันดู "ปลอดภัยกว่า" แต่ guard ทำหน้าที่นั้นแน่นกว่าและข้อมูลได้เติมจริง
- ออเดอร์มีจังหวัดแล้ว: ตรงกับใบ → `skipped_has_province` · ไม่ตรง → `conflict` เข้าคิวคน ห้าม auto ทั้งสองทิศ
- tracking เดียวหลายออเดอร์ (รวมพัสดุ) = กล่องเดียว จังหวัดเดียว เขียนทุกแถวที่ยัง TH-XX ได้
- **Revert**: เก็บ `applied_prev_code` (= TH-XX เสมอ) + `fact_order_ids` → RPC revert เขียนกลับเฉพาะแถวที่ค่าปัจจุบันยังเท่าค่าที่เรา apply (ไม่ทับที่คนแก้มือทีหลัง)

## 6. หลาย format

parser registry `lib/labels/formats/{tiktok,shopee}.ts` — แต่ละตัว `{id, detect(pageText), extract(pageText)}` เพิ่ม format = เพิ่มไฟล์เดียว
detect จาก pattern เลขพัสดุ (`JTTH\d{10,}` vs `TH\d{12}[A-Z]?`) + marker เฉพาะ · detect ไม่ได้ = นับใน summary ไม่เงียบ
**P1 ทำ TikTok ตัวเดียว** (2,721/2,841 = 96% ของปัญหา)

## 7. PDPA / ความปลอดภัย

- PII (ชื่อ/เบอร์/ที่อยู่เต็ม) อยู่ใน**ไฟล์ PDF ที่เดียว** — DB เก็บเฉพาะ tracking+zipcode+province
- `match_detail` **ห้ามมีชื่อ/เบอร์/ที่อยู่เต็ม** (ข้อบังคับ ไม่ใช่ข้อแนะนำ)
- เปิดดูใบตอน review ผ่าน action สร้าง signed download URL อายุ 60 วิ หลัง `requireOwnerAdmin()` (pattern `import-orders.ts` เดิม — ไม่สร้าง role ใหม่)
- ตารางใหม่ไม่ grant ให้ anon/authenticated เลย + RLS enable แบบไม่มี policy (รอ A2)
- **Retention 90 วันหลัง parse แล้วลบไฟล์** (mark `purged`, ผล apply คงอยู่ — จังหวัดไม่ใช่ PII รายบุคคล) — P1–P2 เป็นปุ่ม "ล้างไฟล์เก่า" manual ไม่ทำ cron

## 8. เปลี่ยนผ่านจาก simulation

- types ใน `lib/tiktok/types.ts` + component tree (`UploadDropzone`/`UploadQueueList`/`BatchSummaryCard`/`ReviewQueueList`) **คงไว้ทั้งหมด** — ขยาย `UploadReviewRow` แบบ additive (pageId, candidates, trackingNo)
- `UploadPageClient` แทน setTimeout chain ด้วย flow จริง (validate → sha256 ด้วย `crypto.subtle` → signed URL → PUT → parse action) โครง JSX/state เดิมใช้ต่อ
- `upload-simulation.ts` **ลบทั้งไฟล์** (util ที่ยังใช้ย้ายไป `lib/labels/constants.ts`, `ACCEPTED_EXTENSIONS` → `["pdf"]`)
- แบนเนอร์ "(จำลอง)" ทุกจุด**ต้องหายใน commit เดียวกับที่ต่อ backend จริง** — ห้ามมีสถานะครึ่งจริงครึ่งหลอก

## เคสห้ามผ่าน (ทดสอบเป็นข้อ)

1. `ลาดกระบัง` ต้องไม่ถูก match เป็น `กระบี่` — ใช้ text จริงจากใบที่เคยพลาดเป็น test case
2. ที่อยู่ผู้ส่ง (ร้าน กทม.) ต้องไม่ทำให้ออเดอร์ต่างจังหวัดกลายเป็น TH-10
3. ออเดอร์ที่มีจังหวัดถูกอยู่แล้ว ต้องไม่ถูกทับ — ทั้ง apply ปกติ / apply ซ้ำ / re-parse
4. ไฟล์เดิมอัปซ้ำ / parse ซ้ำ / apply ซ้ำ → ผลใน `fact_order` เท่ารอบเดียวเป๊ะ
5. tracking ไม่ match ออเดอร์ใด → ไม่เขียนอะไร + โผล่ summary เป็น `order_not_found`
6. zipcode เดี่ยวๆ (ไม่มีชื่อจังหวัด match) ต้องไม่ถูกแปลงเป็นจังหวัด
7. ไฟล์ไม่ใช่ PDF จริง (magic bytes) / >20MB / >300 หน้า → reject ก่อน parse · เดา path ยิงตรง bucket → 400/403
8. ชื่อ/เบอร์/ที่อยู่เต็มลูกค้า ต้องไม่โผล่ใน `stg_label_page` แถวใดเลย (query ตรวจจริงหลัง parse ชุดแรก)

**ฝั่ง "ต้องไม่พัง"**: ใบสระหาย (PUA) ต้อง match ได้ · ลูกค้ากรุงเทพจริงต้องได้ TH-10 · ไฟล์ 100+ หน้าอัปได้ · re-parse จากไฟล์เก็บไว้ได้โดยไม่อัปใหม่ · จังหวัดสะกด alias/อังกฤษ match ได้

## Phase

- **P1** (เจ้าของใช้ได้เร็วสุด): migration (2 ตาราง + 2 RPC + bucket) → upload ผ่าน signed URL → parser TikTok → auto-apply + review queue อ่านอย่างเดียว + ปุ่ม re-parse — จบ P1 อัป backlog แล้วจังหวัดเติมทันที · **อัปไฟล์จริงชุดเล็กวัด match rate ก่อนลุย backlog ทั้งก้อน**
- **P2**: Shopee parser · review UI เลือกจังหวัดเอง (`manual_applied`) · ปุ่ม revert · ปุ่มล้างไฟล์ retention
- **P3 (ถ้ายังจำเป็น)**: ตาราง zipcode 5 หลักเต็มเป็น cross-check · เก็บ .xlsx · cron retention

## ความเสี่ยงใหญ่สุด 3

1. **Layout ใบจริง ม.ค.–ส.ค. หลากหลายกว่า sample** — match rate จริงอาจต่ำ ระบบออกแบบให้ตกลง `needs_review` (ไม่ผิดเงียบ) แต่ถ้าคิวบวมพันแถว = ใช้ไม่ได้จริง → ต้องวัดจากไฟล์จริงชุดแรกก่อน
2. **PDF ไม่มี text layer** (สแกน/รูป) → ได้ข้อความว่าง ต้อง fail ชัดต่อหน้า ไม่เงียบ — OCR นอก scope จนกว่าเจอของจริง
3. **Retention manual** — ไม่กดล้าง = ไฟล์ PII ค้างเกิน 90 วันได้ (+ debt: sender fingerprint เป็น config ใน code, พอเพิ่ม shop ต้องย้ายลง DB)

## ให้เจ้าของเคาะ (4 ข้อ)

1. auto-apply เคสมั่นใจโดยไม่กดยืนยันรายใบ (guard เขียนเฉพาะแถวที่ยังไม่รู้จังหวัด) — โอเคไหม
2. เก็บไฟล์ใบปะหน้า 90 วันแล้วลบ — พอสำหรับการตรวจย้อนของร้านไหม
3. P1 รับ PDF เท่านั้น — มีใบที่เป็นรูปถ่าย JPG/PNG สัดส่วนเยอะไหม (ถ้ามีต้องคุย OCR ใหม่)
4. ใบเก่าย้อนถึง ม.ค. ยังดาวน์โหลดจาก TikTok seller center ได้ครบไหม — ตัวนี้กำหนด scope backlog จริง
