# Staging Schema — `analytics.stg_order_import` (Import ขาย 2 source)

> architect (Yoda) · 2026-08-10 · ต่อยอด `marketing-analytics-db-design.md` (§2.3 alias, §11 dim_address, §12 sku_alias, §13 TikTok label)
> รับ 2 source: Excel order report (ทุกช่องทาง) + TikTok PDF (Shipping Label + Packing Slip) · ปลายทาง = analytics layer (ไม่แตะ OMS `public.orders`)

## Overview — 3 ตาราง (grain ต่างกัน)

```
stg_import_batch (1 แถว = 1 ไฟล์)              ← idempotency ระดับไฟล์ (file_hash)
 ├─ stg_order_import (1 แถว = 1 order/source)   ← Excel row · PDF label = คนละแถว, merge ตอน transform
 └─ stg_order_item_import (1 แถว = 1 line item) ← จาก Packing Slip เท่านั้น
```
Flow: `parse → insert staging (raw jsonb + typed cols) → merge (join TikTok order id) → transform → fact_order / fact_order_item / dim_customer(+identity) / dim_address / pii_customer`

**ทำไม 3 ตาราง:** order กับ line item คนละ grain (ยัดตารางเดียว = column บังคับที่อีก type ไม่มี, type เลอะ) · **ทำไม merge เป็น step แยก:** 2 source มาไม่พร้อมกัน — merge ต้องรันซ้ำได้

## 1. `stg_import_batch`
| column | type | note |
|---|---|---|
| id | uuid PK | |
| shop_id | uuid FK not null | RLS เหมือน OMS |
| source_type | text CHECK (`excel_order_report`/`tiktok_label_pdf`/`tiktok_slip_pdf`) | |
| file_name / file_hash | text / text | file_hash = SHA-256 · **unique (shop_id, file_hash)** = ไฟล์เดิมซ้ำโดนบล็อก |
| period_hint | text null | เช่น `2026-08` |
| row_count_parsed / row_count_loaded | int | จับ parse หลุด |
| status | text CHECK (`loaded`/`merged`/`transformed`/`failed`) default `loaded` | |
| imported_by / imported_at | uuid / timestamptz | |

## 2. `stg_order_import` (typed cols nullable ทั้งหมด — ไฟล์เก่าคอลัมน์ไม่ครบก็ลงได้, ความจริงเต็มใน `raw`)
| column | type | source | mapping | note |
|---|---|---|---|---|
| id / batch_id / shop_id | uuid | — | | FK |
| source_row_no | int | — | ลำดับแถว/หน้า | debug ชี้กลับไฟล์ |
| **raw** | **jsonb not null** | ทั้งคู่ | row/label ดิบ key=หัวคอลัมน์เดิม | **หัวใจยืดหยุ่น** — format เปลี่ยนไม่หาย; ธนาคาร/tags/url อยู่นี่ |
| source_kind | text CHECK (`excel`/`pdf_label`/`pdf_slip`) | derived | | |
| source_order_no | text | excel | เลขที่ออเดอร์ (E582) | key ฝั่งร้าน |
| **marketplace_order_id** | text | ทั้งคู่ | Excel "เลขที่บน Marketplace" = PDF "Order ID" | **join key** |
| channel_raw | text | excel | ช่องทางติดต่อ | LINE_OA/Tiktok/facebook → map ผ่าน dim_channel_alias |
| customer_name_raw | text | ทั้งคู่ | Excel ชื่อ / PDF ผู้รับ(mask) | PII |
| contact_display_name_raw | text | excel | ชื่อตามช่องทาง | → dim_customer_identity |
| phone_raw | text | ทั้งคู่ | Excel เบอร์ / PDF mask | PDF mask resolve ไม่ได้ |
| province_raw | text | excel | จังหวัด | |
| full_address_raw | text | pdf_label | ที่อยู่เต็ม | → dim_address parse |
| zipcode_raw | text | pdf_label | ไปรษณีย์ | cross-check |
| carrier_raw / tracking_no | text | ทั้งคู่ | ขนส่ง/เลขพัสดุ | PDF ชนะถ้าขัด |
| shipping_fee_customer / shipping_cost_shop | numeric(12,2) | excel | | |
| cod_amount | numeric(12,2) | pdf_label | COD | |
| revenue / discount_total / discount_code | numeric / numeric / text | excel | ยอดขาย/ส่วนลด | |
| item_count_total | int | excel | จำนวนรวม | reconcile กับ sum(qty) จาก slip |
| profit_raw | numeric(12,2) | excel | กำไร | **เก็บแต่ไม่เชื่อ** — ไม่ copy ลง fact_order.profit |
| order_created_at / paid_at / printed_at | timestamptz | excel | | |
| created_by_raw / note_raw / bank_raw | text | excel | | bank → fact_order.bank |
| tags_raw | text | excel | | split → fact_order.tags[] |
| sort_code / sender_raw | text | pdf_label | | YAGNI ตัดได้ |
| **dedup_key** | text generated | derived | excel `E:`+order_no · pdf `P:`+marketplace_id | **unique** — ซ้ำ→upsert ทับ, เก่า superseded |
| import_status | text CHECK (`pending`/`merged`/`transformed`/`pdf_orphan`/`error`/`superseded`) | — | | pdf_orphan = PDF ไม่มีคู่ Excel → คิว manual |
| error_detail | text | | | |
| fact_order_id | uuid FK → fact_order null | | | lineage staging→fact |
| created_at | timestamptz | | | |

## 3. `stg_order_item_import` (จาก Packing Slip)
`id, batch_id, shop_id, marketplace_order_id (not null), line_no, product_name_raw, variant_raw, seller_sku_raw, qty, raw jsonb, import_status (pending/transformed/sku_unmapped/error), fact_order_item_id null`
· unique `(shop_id, marketplace_order_id, line_no)` (batch เก่า supersede) · `sku_unmapped` = alias ใหม่ที่ sku_alias ยังไม่รู้จัก → คิว manual

## 4. Mapping — จุดทับซ้อน (ผู้ชนะตอน merge)
| field | Excel | PDF | ชนะ |
|---|---|---|---|
| marketplace_order_id | ✓ | ✓ | join key (เท่ากัน) |
| tracking/carrier | ✓ | ✓ | **PDF** (จากระบบขนส่งจริง) |
| ชื่อลูกค้า | ✓ เต็ม | mask | **Excel** |
| เบอร์ | ✓ (LINE/FB เต็ม) | mask | **Excel** (ถ้าไม่ mask) |
| ที่อยู่ | จังหวัดเท่านั้น | เต็ม+zip | **PDF** |
| ยอด/ส่วนลด/วันที่/contact/bank/tags | ✓ | — | Excel |
| line items (SKU/qty) / COD | — | ✓ | PDF |

## 5. Merge strategy
- **TikTok:** Excel (canonical: ยอด/วันที่/contact) ⟕ pdf_label (address/tracking) ⟕ slip items บน `(shop_id, marketplace_order_id)` · Excel ไม่มีคู่ PDF → transform ได้ (province-only ไม่มี item) · PDF ไม่มีคู่ Excel → **pdf_orphan** (order ตกหล่นจาก report — ต้องมีคนดู)
- **LINE/FB:** Excel อย่างเดียว จบ
- province ขัดกัน → เชื่อ PDF + log warning

## 6. Transform → fact/dim (ตาม design เดิม)
- `fact_order` upsert ด้วย **unique (shop_id, source_order_no)** ← ต้องเพิ่ม constraint นี้ (design เดิมมีแต่ oms_order_id unique) · `oms_order_id=null` (import มือ) · TikTok เก่า `profit_status='missing'`; มี item+standard_cost → `estimated`
- Customer: phone เต็ม→E.164→hash→`exact` · TikTok→tiktok_handle จาก display_name→`probable` · ชื่อ+เบอร์ดิบ+ที่อยู่ → **pii_customer เท่านั้น**
- dim_address: เฉพาะแถวมี full_address_raw (PDF) · Excel-only ลงแค่ `fact_order.province_code` (จังหวัด→TH-XX, ไม่รู้→unknown) ไม่สร้าง address ครึ่งๆ
- Channel: `dim_channel` **มี line_oa/facebook อยู่แล้ว** → gap จริงแค่ seed `dim_channel_alias` (LINE_OA→line_oa, Tiktok→tiktok, facebook→facebook)

## 7. Gaps / Decisions (⚠️ ต้อง confirm เจ้าของ)
- **(ค) profit [เจ้าของยืนยัน 2026-08-10]:** ไม่ใช้ `profit_raw` จาก Excel (เชื่อไม่ได้) · ตั้ง **estimated margin 10% placeholder** → `fact_order.profit = revenue × 0.10`, `profit_status='estimated'` (เจ้าของกำลังคิดต้นทุนจริงต่อ SKU) · เมื่อ `standard_cost` ต่อ SKU มาแล้ว → คำนวณ profit จริง + flip `profit_status='actual'` · เก็บ `profit_raw` ไว้ audit · ⚠️ ยืนยัน: 10% = margin (กำไร 10% ของยอด) ไม่ใช่ cost 10%
- (ง) ธนาคาร/tags → มีปลายทางใน fact_order · url บิล/slip → อยู่ raw jsonb พอ
- **(จ) PDPA [เจ้าของยืนยัน 2026-08-10]:** staging มี PII ดิบชั่วคราว (ต้อง parse/QA) → RLS เข้มเท่า pii_customer + **retention: job null คอลัมน์ PII หลัง transformed 180 วัน** (PII ถาวรอยู่ pii_customer ที่เดียว) · ไม่ทำ column encryption (700/เดือน RLS+retention พอ)
- (ฉ) Idempotency 2 ชั้น: file_hash block ไฟล์ซ้ำ · dedup_key upsert order ซ้ำ (ล่าสุดชนะ) · transform รันซ้ำปลอดภัยด้วย fact_order unique

## 8. Import flow
1. Parse Excel → batch + rows · 2. Parse PDF: text-layer ก่อน, OCR fallback → label + slip rows · 3. `merge()` SQL proc → merged/pdf_orphan · 4. `transform()` → dims → facts → lineage · 5. Reconcile: count(excel) = count(fact_order ของ batch) + item_count_total vs sum(qty)

## ความเสี่ยง
1. PDF layout เปลี่ยนตาม carrier/version → parser fail-loud ลง error ไม่ silently ข้าม
2. เบอร์ Excel ของ TikTok อาจ mask ที่ดูเหมือนจริง → validator reject pattern `*`/สั้นผิดปกติ ก่อน hash (กัน false-merge identity)
3. `source_order_no` **[เจ้าของยืนยัน 2026-08-10]: รันต่อเนื่องไม่ reset** (E999→F001→G001…) → dedup key = `source_order_no` ตรงๆ ไม่ต้องเพิ่มปี ✓ (ตัดความเสี่ยงข้อนี้ทิ้ง)
4. RLS: staging ห้าม grant authenticated ทั่วไป (PII)
