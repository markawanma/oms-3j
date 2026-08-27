---
name: 3j-qa-regression-map
description: >-
  แผนที่ regression ของ 3J Insight — ไฟล์/ตาราง/ฟังก์ชันกลางตัวไหน ผูกกับ flow
  ไหนบ้าง + เกณฑ์แบ่งระดับการตรวจ S/M/L. ใช้ทุกครั้งที่ QA วางแผนว่าต้องกดอะไร
  หลัง dev แก้โค้ด, ตอน Tech Lead กำหนดขอบเขต QA จาก diff, และตอนประเมินว่า
  การแก้ "ของกลาง" ตัวหนึ่งกระทบหน้าไหนบ้าง. QA มีสิทธิ์ขยาย scope เกินที่
  Tech Lead สั่งเสมอถ้าแผนที่บอกว่ากระทบมากกว่านั้น
---

# แผนที่ Regression — 3J Insight

> อ่าน diff ก่อน (`git diff main --stat`) แล้วเทียบกับตาราง "ของกลาง" ข้างล่าง
> แตะของกลางตัวไหน = ต้องกดทุก flow ในคอลัมน์ขวาของตัวนั้น ไม่ใช่แค่ feature ที่แก้

## เกณฑ์ระดับการตรวจ (ตัดสินเชิงกลไกจาก diff)

- **S** — ข้อความ/คอมเมนต์/เอกสาร ไม่มี logic → ไม่ต้อง QA, `tsc --noEmit` พอ
- **M** — logic เฉพาะจุด ไม่แตะของกลาง → กด flow ที่แก้ + smoke flow ข้างเคียง (~10 นาที)
- **L** — แตะของกลางตัวใดตัวหนึ่งข้างล่าง → กด flow ที่แก้ + **ทุก flow ที่ผูกกับของกลางตัวนั้น**
- **💰** — แตะเงิน/เอกสารภาษี/สิทธิ์ → ระดับ L + security-auditor ต้องผ่าน **ก่อน merge**

## ตาราง "ของกลาง" → flow ที่ผูก

| ของกลาง | ใครพึ่งบ้าง (ต้องกดทั้งหมดเมื่อแตะ) |
|---|---|
| `components/ui/Modal.tsx` | **ทุก dialog ในระบบ**: SkuPrefixDialog, CreateSkuDialog, BillingDialog (20 ช่อง), DepositDialog, ReceiptIssueDialog, VoidReceiptDialog, VatModeDialog, RenegotiateDialog, LostQuoteDialog, modal คำเตือนใน ImportBatchHistory — บั๊กโฟกัสเด้ง (27 ส.ค.) พังพร้อมกัน 9 ตัวเพราะไฟล์นี้ไฟล์เดียว |
| `lib/dev/context.ts` (getDevShopId/getDevRole) | ทุก server action ทั้งระบบ — แตะแล้วต้อง smoke ทุกหน้าเขียนข้อมูล |
| `analytics.transform_pending_order_lines` (0095 ล่าสุด) | **กำไร/COGS/profit_status ของทุกออเดอร์** → /crm/import (commit ไฟล์ SKU), CRM ภาพรวม, ประวัติออเดอร์, dashboard, ยอดขาย TikTok — แตะแล้วต้องนำเข้าไฟล์จริง 1 รอบและดูตัวเลขกำไรปลายทาง |
| `analytics.v_dim_product` (0028) | ตัวจับคู่ SKU ตอนนำเข้า + /catalog (margin) + preview seed — view นี้ **append-only** (กับดัก 42P16) |
| `analytics.product_upsert` (0031) | /catalog ฟอร์มสินค้า + CSV import + `catalog_sku_create` (claiming insert 0096 พึ่ง on-conflict ของมัน) |
| `catalog_sku_create` / `sku_prefix_*` (0096 ล่าสุด) | /catalog/sku-prefix ทั้งหน้า + ปุ่ม "+ สินค้าใหม่" ใน /oem/quote |
| `PrintableQuote` / `PrintableReceipt` (lib/oem/printable*.ts) | หน้าพิมพ์ใบเสนอราคา + ใบเสร็จ/ใบกำกับภาษี — 💰 เสมอ, ห้ามต้นทุน/margin เข้า type, ประกอบทีละ field ห้าม spread |
| `oem_*` RPCs (quote/receipt/renegotiate) | ทั้ง flow ใบเสนอราคา→ใบเสร็จ — 💰 เสมอ (เอกสารภาษี แก้ย้อนหลังไม่ได้) |
| import pipeline (`stg_import_batch`, `stg_order_import`, `stg_order_line_import`, actions import-*) | /crm/import (เลือกไฟล์/preview/commit/ประวัติ/คำเตือน) + ตรวจ import — จำบั๊ก live FileList (แก้แล้ว 15d9017) |
| `fact_order` / `fact_order_item` | dashboard ทุกหน้า, CRM, การตลาด (RFM/audience) — แก้ schema ต้อง smoke หน้าอ่านทั้งหมด |
| `silver_price_daily` | คิดราคาเงินแท่งใน OEM calculator — ราคาไม่สด = ออกใบไม่ได้ (by design อย่ารายงานเป็นบั๊ก) |

## flow หลักของระบบ (เดินให้ครบตอนระดับ L)

1. **SKU config**: /catalog/sku-prefix — เพิ่ม (preview เลขแนะนำ) / แก้ (prefix+work_type ต้อง disabled) / ลบ (มี SKU แล้วต้องปฏิเสธพร้อมจำนวน)
2. **สร้างสินค้าใหม่**: /oem/quote → "+ สินค้าใหม่" → SKU เข้า form + โผล่ใน picker ทันที
3. **นำเข้ายอดขาย**: /crm/import — เลือกไฟล์ (เดี่ยว/หลายไฟล์/ผิดชนิด) → preview → commit → กล่องคำเตือน → ตารางประวัติ (2 ชนิดไฟล์ + คอลัมน์คำเตือน)
4. **ใบเสนอราคา OEM**: สร้าง → คิดราคา (production + เงินแท่ง) → บันทึก → พิมพ์ (ห้ามมีต้นทุน/ข้อความภายในบนกระดาษ)
5. **ใบเสร็จ**: ผูกผู้ซื้อ → ออกใบ → พิมพ์ → ยกเลิก → ออกใบแทน (ผูก 5 อย่างกับใบเดิม)
6. **หน้าอ่าน**: dashboard, CRM ภาพรวม, ยอดขาย TikTok — ตัวเลขต้องไม่เปลี่ยนถ้างานไม่ได้ตั้งใจเปลี่ยน

## ⛔ ด่านที่ต้องผ่านก่อนเรียก UAT ทุกครั้ง

** ต้องผ่าน —  ไม่พอ**
(บทเรียน 27 ส.ค. 69: tsc ผ่านสะอาด แต่เจ้าของเปิดหน้าเว็บแล้วเจอ Build Error
ทันที เพราะ Next.js มีกฎของตัวเองที่ TypeScript ไม่รู้จัก)

กฎของ Next.js ที่ tsc จับไม่ได้ — ต้องเช็คด้วยตา/สแกนเอง:
- ไฟล์  **export ได้เฉพาะ async function** —  /
  class / enum ทำให้ build ล้ม (type export ไม่นับ ถูกลบตอน compile)
  ค่าคงที่ที่ต้องแชร์ให้ย้ายไปไฟล์ธรรมดา เช่น - สแกนให้ถูก: เช็ค**บรรทัดแรก**ของไฟล์ ไม่ใช่ grep ทั้งไฟล์ (ไฟล์ที่แค่เอ่ยถึง
   ในคอมเมนต์จะติดมาด้วยเป็น false positive)
-  component ห้าม import server-only module ทางอ้อม
- async component ใน client boundary / metadata export ผิดที่

## วิธีทำงานของ QA ในโปรเจกต์นี้

- **ห้าม browser automation** — เบราว์เซอร์เครื่องนี้ไม่ render ในแท็บ hidden ใช้เวลาเปล่า
  อ่านโค้ดแบบ "คนกดจริง" (ไล่ event → state → render) + เขียน/รัน vitest เมื่อคุ้ม
- `lib/import/*.test.ts` มี 4 เทสต์ fail อยู่ก่อนแล้วบน main — baseline เก่า อย่ารายงานเป็นบั๊กใหม่
- ทดสอบอะไรแตะตัวนับ/เอกสารกฎหมายบน DB → do-block + raise บังคับ rollback (skill `3j-migration-traps` ข้อ 11)
- รายงานแยก 3 ถัง: **"เจ้าของจะเจอแน่ๆ" / "เจอถ้าซวย" / "ไม่กระทบการใช้งาน"** + บอกขั้นตอนกดที่ทำให้เจอ
- ไม่เจอ = บอกว่าไม่เจอ ห้ามปั้นข้อ · scope ที่ได้รับถ้าแคบไปตามแผนที่นี้ **ขยายเองได้เลยแล้วบอกว่าขยายเพราะอะไร**
