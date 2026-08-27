# Design: Quote Email + Product Image + SKU Generator (Phase 1)

> ออกแบบโดย architect (Yoda) 26 ส.ค. 2569 · อนุมัติโดย Tech Lead
> โจทย์เจ้าของ: ส่งใบเสนอราคาทาง email + รูปสินค้า + สร้าง item ใหม่ → เกิด SKU ใน catalog
> Phase 2 (เมลนำเสนอ collection ขายส่ง) และ 2.2 (Gmail sync/auto-reply) วางรอยต่อไว้ ไม่ build

## Overview

```
1a SKU:    UI config prefix ──▶ sku_prefix + sku_counter ──▶ catalog_sku_create (RPC)
                                                              └▶ เรียก product_upsert เดิม (audit ฟรี)
           QuoteCalculator "สินค้าใหม่" dialog ──▶ product_id+sku ──▶ กรอกเข้า item form
           ──▶ save ผ่าน oem_quote_save เดิม ไม่แก้เลย

1b Image:  upload (server action, validate magic bytes) ──▶ Storage private bucket
           ──▶ analytics.product_image (ref) · แสดงผล join ผ่าน oem_quote_item.product_id
           (จงใจไม่เพิ่มคอลัมน์ใน oem_quote_item — เพิ่ม = ต้องแก้ renegotiate ที่ copy item)

1c Email:  sendQuoteEmail ─ pre-check gate เดียวกับ canPrint
           ──▶ oem_email_begin (RPC: gate สถานะ + dedup ที่ DB) ──▶ log 'sending'
           ──▶ PDF: playwright chromium_headless_shell เปิด route ใหม่
               /oem/quotes/[id]/pdf-render?token=HMAC(60s)  — reuse toPrintableQuote +
               PrintQuoteClient ตัวเดิม = template เดียว, print page เดิม diff 0 บรรทัด
           ──▶ EmailProvider.send (nodemailer Gmail SMTP, รูปฝัง CID ไม่ใช่ signed URL)
           ──▶ oem_email_finish (sent/failed + message_id)
```

## Data model (0089–0091)

**`analytics.sku_prefix`** — config พนักงานกรอกเอง **ไม่มี seed hardcode**
- `id PK · shop_id · kind_label text ("แหวน") · work_type check in ('plain','gem') · prefix check (~ '^[A-Z]{1,5}$') · created/updated by/at`
- `unique (shop_id, kind_label, work_type)` · `unique (shop_id, prefix)`
- RLS select owner/admin · เขียนผ่าน `sku_prefix_upsert` เท่านั้น

**`analytics.sku_counter`** — `(shop_id, prefix) PK, last_no int` — pattern `oem_doc_counter` (insert..on conflict..returning ใน RPC) · **ไม่มี** deny-mutation trigger (SKU ไม่ใช่เอกสารกฎหมาย เลขข้ามได้) · RLS เปิด ไม่มี policy/grant

**`analytics.product_image`**
- `id PK · shop_id · product_id FK public.product on delete cascade · storage_path unique · mime check in (jpeg,png,webp) · size_bytes check (>0 and <=5MB) · is_primary · created_by/at`
- RLS select ทุก shop_member · เขียนผ่าน RPC
- Storage bucket **`oem-product-images` private** — ไม่มี storage policy ให้ anon/authenticated เลย ทุก access ผ่าน service role + signed URL TTL 1 ชม.

**`analytics.oem_email_log`**
- `id PK · shop_id · kind check in ('quote')` ← Phase 2 เติม 'campaign','followup'
- `quote_id nullable · customer_id nullable · to_email · cc_emails[] · subject`
- `status check in ('sending','sent','failed') · error · provider_message_id · pdf_sha256 · created_by/at · finished_at`
- RLS select owner/admin เท่านั้น (มี email ลูกค้า = PII) · เขียนผ่าน 2 RPC

## RPC contract (ทุกตัว: security definer + pin search_path + crm_require_owner_admin + re-grant)

- `sku_prefix_preview_seed(shop, prefix)` → เลขตั้งต้นแนะนำจาก `max(regexp_match(sku,'^'||prefix||'(\d+)'))` ของ product เดิม — **UI แสดงให้พนักงานยืนยัน/แก้ก่อน** (เลขตั้งต้นเป็นการตัดสินใจของคน ไม่ใช่ระบบเดา)
- `sku_prefix_upsert(shop, kind_label, work_type, prefix, seed_last_no)` — สร้างใหม่ต้องส่ง seed ชัดเจน · seed เข้า sku_counter
- `catalog_sku_create(shop, prefix_id, name, attrs) returns (product_id, sku)` — ไม่มี config → raise ชี้ไปหน้า config · lock counter → loop ≤20: candidate `prefix||last_no+1` (ไม่ pad zero ตาม legacy `RP9963`) ชน unique ของ SKU เก่า → +1 ต่อ · insert ผ่าน `product_upsert` เดิม (validation + catalog_audit_log ฟรี)
- `product_image_add/delete` — ref หลัง upload สำเร็จ (upload ก่อน ref; ref fail → action ลบไฟล์)
- `oem_email_begin(shop, quote_id, to_email, subject, force)` — **ด่านที่ DB**: status `in ('quoted','won','expired')` (เซ็ตเดียวกับที่พิมพ์ได้ — ใบ draft ส่งไม่ได้เชิงโครงสร้าง) · reject `[\n\r\t]` ใน to/subject (header injection — pattern เดียวกับ branch_label 0088) · dedup (quote_id,to_email) ใน 10 นาที เว้น force · insert 'sending'
- `oem_email_finish(shop, log_id, status, message_id, error)` — transition sending → sent|failed เท่านั้น

## Server actions (ไฟล์ใหม่ ไม่แตะ `oem.ts`)

- `lib/actions/catalog-sku.ts` — `createCatalogSku`, `upsertSkuPrefix`, `previewSkuSeed`
- `lib/actions/catalog-image.ts` — `uploadProductImage` (mime whitelist + **magic bytes 12 ไบต์แรก** + ≤5MB), `getProductImageUrls`
- `lib/actions/oem-email.ts` — `sendQuoteEmail`: requireOwnerAdmin → pre-check `canPrint` เงื่อนไขเดียวกัน → begin → gen PDF → send → finish · UI confirm modal + disable ระหว่างส่ง
- `lib/email/provider.ts` — `interface EmailProvider { send(msg): Promise<{messageId}> }` · impl แรก `NodemailerGmailProvider` (`GMAIL_USER`, `GMAIL_APP_PASSWORD` ใน env)
- `lib/email/quoteEmail.ts` — `buildQuoteEmailHtml(quote: PrintableQuote, images: CidImage[])` — **input เดียวคือ PrintableQuote** = ด่านกันต้นทุนเดิมที่พิสูจน์แล้ว
- `lib/pdf/renderQuotePdf.ts` — HMAC token (60s) → chromium_headless_shell → `page.pdf()` (print media → `print:hidden` หายเชิง CSS) → buffer + sha256
- `app/(dashboard)/oem/quotes/[id]/pdf-render/page.tsx` — ตรวจ token → `toPrintableQuote` → render `PrintQuoteClient` เดิม
  ⚠️ implementation note: middleware auth ต้องยอมให้ path นี้ผ่านด้วย token (playwright ไม่มี session cookie) — ห้ามเปิดกว้างกว่า token HMAC + อายุ 60 วิ

## Sub-phases

| Phase | เนื้อหา | UAT |
|---|---|---|
| **1a** | sku_prefix/counter + create RPC + หน้า `/catalog/sku-prefix` + dialog "สินค้าใหม่" | กรอก prefix → สร้าง SKU → เห็นใน /catalog |
| **1b** | bucket + product_image + upload/แสดงรูป (catalog + dialog + quote detail) | อัปรูป → เห็นในระบบ |
| **1c** | email log + provider + PDF route + ปุ่มส่งเมล + ประวัติส่งบนหน้า quote | ส่งเมลถึงกล่องจริง เปิด PDF ตรวจ |

## จุดเสี่ยง 3 อันดับ + วิธีลด

1. **PDF pipeline** (dev server ต้องรัน, token, font ไทย, print media) — เสี่ยงแนบหน้า error/หน้าเปล่า → pre-check gate ก่อน gen เสมอ + หลัง gen extract text ต้องเจอ `quoteNo` และ**ไม่เจอ** string ภายใน ("พิมพ์ใบนี้ไม่ได้") → fail = ไม่ส่ง + log failed · QA ยิง PDF จริง grep เลขต้นทุนจาก DB
2. **prefix ตระกูลซ้อน** (`N` กับ `NP`) — unique `(shop_id, sku)` คือกำแพงจริง + retry loop + หน้า config เตือนเมื่อ prefix ใหม่เป็น prefix/superset ของตัวเดิม
3. **เมลผิดมือ/ส่งซ้ำ ถอนไม่ได้** — confirm modal + dedup ที่ DB (ไม่ใช่แค่ disable ปุ่ม) + log ทุก attempt + ประวัติบนหน้า quote

## รอยต่อ Phase 2/2.2

- `EmailProvider` interface → สลับ Gmail API ได้โดย caller ไม่รู้เรื่อง (Gmail SMTP เพดาน ~500 ฉบับ/วัน — พอสำหรับใบเสนอราคา แต่ Phase 2 broadcast ต้องข้ามไป API/provider จริง = tech debt ที่รู้ตัว)
- `oem_email_log.kind/customer_id/provider_message_id` → campaign ใช้ log เดียวกัน · 2.2 จับ Gmail thread ด้วย Message-ID เพิ่มแค่คอลัมน์ `direction` ต่อท้าย
- `product_image` + CID builder ใช้ซ้ำกับ draft email Phase 2 ตรงๆ
- SKU ใหม่ query จาก `catalog_audit_log`/`created_at` ได้เลย ไม่ต้องมีตารางเพิ่ม

## ข้อสรุปที่ตัดสินแล้ว

- รูปในเมลใช้ **CID attachment ไม่ใช่ signed URL** (URL หมดอายุ → เมลลูกค้ารูปแตกถาวร)
- ไม่แก้ print page เดิมให้รับ token — แตก route แยกที่ reuse component เดิม
- SKU ไม่ pad zero · work_type = plain/gem · dedup window 10 นาที · ไม่ทำ Reply-To พิเศษ (ตอบกลับเข้า 3jjewelry@gmail.com ตรงตามทิศ Phase 2.2)
