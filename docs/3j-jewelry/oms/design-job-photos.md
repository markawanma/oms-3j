# Design — รูปสินค้าบนใบงาน (job photos · W2 รอบแรก: ออฟฟิศอัปโหลด → A5 + หน้าช่าง) · 19 ต.ค. 69

> architect (Yoda) · สถานะ: **design เท่านั้น — ยังไม่มี migration/โค้ด** · มติเจ้าของ 19 ต.ค. 69: *"ในใบงานควรจะมีรูปสินค้าไปด้วย จะได้รู้ว่าทำงานอันนี้ถูกต้องไหม บางทีช่างดูจากชื่อสินค้าหรือ sku จะไม่รู้"* — **ทำก่อนงานอื่น**
> ขอบเขตรอบนี้: ออฟฟิศอัปโหลด/ถ่ายรูปใน `/jobs/[id]` · รูปหลักพิมพ์บน A5 · ช่างเห็นรูปบน `/w/[token]` · **หน้างานเปิดใบเอง (W1) และรูปผลงานต่อขั้น (W2b) ใช้ระบบเดียวกันทีหลัง — วางโครงรองรับ ไม่ทำรอบนี้**
> ที่มา: มติ §9.1 ใน `workflow-shopfloor-order-gems-photos.md` (จ1 5 รูป · จ2 20 รูปรวม · จ3 รูปหลัก 40×40 มม. ข้าง QR · จ5 ออฟฟิศลบ มีประวัติ · จ6 เก็บตลอด · จ7 OEM ช่างเห็น · ซ4 รูป SKU เป็นรูปหลักอัตโนมัติ) · `design-job-tracking.md` §2.9 (J1 โครง `job_photo`) · `design-job-lots-shopfloor.md` §1.2/§7.3 (token ออกให้ใบแม่เท่านั้น · Q11 ไม่มีสวิตช์ซ่อนรูป) · UX: `ux-handoff-job-lots/HANDOFF-ux-ui-job-lots.md` (Open5 · Prints) · `ux-review-job-lots.md` (Prints ก · T7)
> 🔴 ไม่มีตัวเลขเงินในไฟล์นี้ · ชื่อตาราง/RPC เป็นข้อเสนอ ชื่อจริงตามไฟล์ migration ที่ apply

---

## 0. สิ่งที่ตรวจกับของจริงก่อนออกแบบ (19 ต.ค. 69 · DB สด + โค้ดบน main)

| เรื่อง | ของจริง | ผลต่อ design |
|---|---|---|
| ระบบรูปที่มีอยู่ | bucket `product-images` **private** · `file_size_limit` 1 MB · `allowed_mime_types {image/jpeg}` · ตาราง `public.product_image` (md 1200px + sm 480px · `sort_order` · cap trigger advisory lock · budget bytes ต่อร้าน 0105) · pipeline `lib/catalog/image-client.ts` (resize+re-encode canvas ⇒ **EXIF/GPS หายโดยธรรมชาติ**) · `image-server.ts` (magic bytes + SOF parse) · `image-signing.ts` (signed URL 1 ชม. batch) · เขียนผ่าน service client เท่านั้น · storage.objects **ไม่มี policy** เลย | ใช้ pipeline เดิมทั้งก้อน · เพิ่ม bucket ที่สอง + ด่าน EXIF ฝั่ง server |
| รูป SKU บน prod | `product_image` **1 แถว / 1 SKU** (active SKU 291) · ใบงานที่ SKU มีรูป = **0** | "ค่าเริ่มจากรูป SKU" ถูกต้องตามมติ ซ4 แต่วันนี้แทบไม่มีผล — ต้องมีทางอัปโหลดตรงที่ใบงานเป็นหลัก |
| พื้นที่ Storage | product-images 2 objects ≈ 0.15 MB · shipping-labels 87 objects ≈ 32 MB · free tier 1 GB | budget bytes ของ bucket ใหม่ตั้งได้สบาย (§2.3) · tile "ที่ใช้ไป" = หนี้ J1 R8 ปิดรอบนี้ |
| ใบงาน | `job.product_id` (uuid → `public.product`) มีอยู่แล้ว · `parent_job_id`/`lot_seq` (0181) · `job_guard` ห้ามแก้ใบ done/cancelled · `job_event` มี `photo_add` ใน CHECK แล้ว · ใบบน prod: open 3 · in_progress 1 · done 1 · cancelled 31 | `job_photo.job_id` = ใบแม่เท่านั้น · event `photo_add` ใช้ได้ทันที · ต้องเพิ่ม `photo_remove` |
| token/QR | `job_token_issue` (0181) **ออกให้ใบแม่เท่านั้น** (`lot_no_token`) ⇒ `/w/<token>` ทุกใบ (traveler/sublot/delivery_note) resolve ไปใบแม่ | หน้าช่างไม่ต้องรู้เรื่องส่วนย่อย — อ่านรูปของใบที่ token ชี้ก็ได้รูปแม่เอง |
| `job_worker_auth` (0173) | คืน `job_id · shop_id · worker_id · worker_name · session_expired` · ปฏิเสธ `job_closed`/`invalid_token`/`session_required` · rate limit `tok:` 60/ถัง | RPC อ่านรูปฝั่งช่างต่อจาก auth ตัวนี้ ไม่เขียนด่านใหม่ |
| ด่าน module graph ช่าง | `lib/jobs/worker-boundary.test.ts` ห้าม import `lib/catalog/**` และห้ามมี `.from(` ในไฟล์กราฟช่าง | signing helper ต้องอยู่นอก `lib/catalog/` และนอกไฟล์กราฟช่าง (§3.2) |
| ขนาด body server action | `next.config.mjs` `bodySizeLimit: "4mb"` | md+sm ≤ 2 MB ต่อรูป ผ่าน · อัปโหลดทีละรูป |
| migration | `schema_migrations` ล่าสุด **0181** (apply 19 ต.ค.) — ไฟล์ยังอยู่บนสายงาน `feature/job-lots-l1` ยังไม่เข้า main · 0182 ถูกจองซ้อนโดย PM-A (`design-production-item-metal.md`) และ L3 (`design-job-lots-shopfloor.md` §9) | รูป = **0182** (มติ "ทำก่อน") → เลื่อน PM-A 0183 · L3 0184 · L2 0185 · W1 0186 · L4 0187 (§7) |

---

## 1. ภาพรวม — data flow

```
ออฟฟิศ /jobs/[id] (owner/admin · session)                       ช่าง /w/<token> (ไม่มี session แอป)
──────────────────────────────────────────                      ─────────────────────────────────────
ถ่าย/เลือกรูป → resize canvas (md 1200 · sm 480 · JPEG ≤1MB)      สแกน QR → ชื่อ+PIN → job_worker_resolve
   │ (EXIF/GPS หายตอน re-encode)                                     │ คืน job.photos[] = path ของรูป active ของใบแม่
   ▼ FormData {jobId, md, sm, caption}                                ▼ (หลังระบุตัวเท่านั้น)
server action uploadJobPhoto                                     worker-server: signJobPhotoPaths(paths) 15 นาที
   ├ guard() owner/admin · magic bytes · ไม่มี APP1 Exif · ≤1MB      ▼
   ├ upload 2 objects → job-photos/<shop>/<job>/<uuid>_{md,sm}.jpg   WorkerApp: รูปหลักย่อบนหัว · แตะดูทั้งชุด (lazy)
   └ RPC job_photo_add(...) → แถว job_photo + event photo_add
         (ล้มเหลว → ลบ object ที่เพิ่งอัป)
สร้างใบงานจากรายการที่ SKU มีรูป → copy รูปหลัก SKU เข้า bucket ใบงาน (source='product')
พิมพ์ A5 /jobs/[id]/print → toPrintableJob(job, stages, primaryPhotoUrl) → รูปหลัก 40×40 มม. ข้าง QR (ไม่มีรูป = ใบเดิมเป๊ะ)
```

หลักที่ยึด: **bucket private · ไม่มี URL ถาวร · server เป็นคนออก signed URL หลังด่านเดียวกับข้อมูลใบงาน · รูปเป็นของ "ใบ" ไม่ใช่ของ SKU (copy ไม่ใช่ link) · ใบไม่มีรูป = พฤติกรรมเดิมทุกจุด**

---

## 2. เก็บที่ไหน (ตอบข้อ 1)

### 2.1 bucket `job-photos`
- `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('job-photos','job-photos', false, 1048576, '{image/jpeg}')` — แบบ 0104 แต่ **private ตั้งแต่แรก** (บทเรียน 0105)
- **ไม่มี storage policy** (เหมือน product-images/shipping-labels): ทุก write/read ผ่าน service client ฝั่ง server · anon/authenticated แตะ bucket ไม่ได้เลย
- ทำไมแยก bucket จาก `product-images`: (1) วงจรชีวิตต่างกัน (รูปใบงาน = หลักฐานการผลิต · รูป SKU = แคตตาล็อก) (2) budget/ตัวเลขที่ใช้ไปแยกกันอ่านง่าย (3) signing ฝั่งช่างจำกัดอยู่ bucket เดียว — ช่องทางสาธารณะไม่มีทางได้ URL ของรูปแคตตาล็อก · ที่แลก: helper signing ต้องรับชื่อ bucket (J1 §2.9 วางไว้แล้ว)
- path: `<shop_id>/<root_job_id>/<photo_id>_md.jpg` และ `_sm.jpg` — **ทั้งสาม uuid server สร้าง/อ่านจาก DB** · ไม่มีชื่อไฟล์เดิม/SKU/เลขงาน/ข้อความจาก client เข้าใกล้ path (บทเรียน catalog-images) · `upsert:false` · `cacheControl "60"`
- 2 ขนาดเหมือนแคตตาล็อก: **md** (1200px — A5 พิมพ์ + ออฟฟิศดูเต็ม) · **sm** (480px — หัวใบบนมือถือช่าง · แถบรูปย่อ) ⇒ หน้า `/w/` ยังเบา (sm ~30–40 KB · lazy load)

### 2.2 ตาราง `analytics.job_photo` (ใหม่ · RLS on · ไม่มี policy · revoke public/anon/authenticated — สคีมา analytics ปิด REST อยู่แล้ว ข้อ 18)

| คอลัมน์ | ชนิด / ด่าน | หมายเหตุ |
|---|---|---|
| `id` | uuid pk `gen_random_uuid()` | ชื่อไฟล์ใช้ค่านี้ — เดาไม่ได้ (122 bit) |
| `shop_id` | uuid not null → `shop` · trigger derive จาก job และต้องเท่ากัน | แบบ `job_event_before_insert` |
| `job_id` | uuid not null → `job(id)` | **ใบแม่เท่านั้น**: trigger ปฏิเสธถ้า `job.parent_job_id is not null` (hint `lot_no_photo` — คู่กับ `lot_no_token` ของ 0181) · ส่วนย่อย/ใบย่อย/ใบส่งของ ใช้รูปแม่ |
| `kind` | text check in (`'reference'`, `'stage'`) | รอบนี้ใช้ **reference** เท่านั้น · `stage` = รูปผลงานต่อขั้น (W2b) ใส่ไว้ใน CHECK + เพดานเลย เพื่อไม่ต้องแก้ trigger รอบหน้า |
| `job_stage_id` | uuid null → `job_stage` | null เสมอสำหรับ reference · W2b ใช้ |
| `source` | text check in (`'office'`, `'shopfloor'`, `'product'`) | office = อัปโหลดจาก `/jobs/[id]` · product = copy จากรูป SKU · shopfloor = W1 (ยังไม่มี RPC ให้) |
| `product_image_id` | uuid null → `public.product_image(id)` **on delete set null** | ที่มา (provenance) เมื่อ `source='product'` · ไม่ใช่ตัวชี้ไปอ่านไฟล์ — ไฟล์ copy มาแล้ว |
| `storage_path` · `variant_sm_path` | text not null · **unique** ทั้งคู่ · ตรวจรูปแบบ `shop_id/job_id/<uuid>_md.jpg` ใน trigger (อ้างคอลัมน์อื่น) | กัน RPC ถูกยิงให้ลงทะเบียน path ของใบ/ร้านอื่น (signing ใช้ path เป็นกุญแจ) |
| `bytes` | int not null check `> 0` · `width`/`height` int null check `> 0` | server วัดจาก bytes จริง (SOF parse) · ไม่รับจาก client |
| `is_primary` | boolean not null default false | partial unique index `(job_id) where is_primary and deleted_at is null` ⇒ รูปหลัก ≤ 1 ต่อใบเสมอ แม้ service key เขียนตรง |
| `sort_order` | int not null default 0 check `>= 0` | ลำดับแสดง · ไม่มีน้ำหนักทางธุรกิจ |
| `caption` | text null · `analytics.job_text_clean(…, 60)` (ห้ามอักขระล่องหน/bidi) | ป้ายสั้น เช่น "ด้านข้าง" · **ไม่พิมพ์บน A5** |
| `uploaded_by` | uuid null (ผู้ใช้ออฟฟิศ) · `worker_id` uuid null → `worker` | check: `source in ('office','product') ⇒ uploaded_by not null` · `source='shopfloor' ⇒ worker_id not null` |
| `created_at` | timestamptz default now() | |
| `deleted_at` · `deleted_by` uuid · `delete_reason` text null | **soft delete** = ประวัติใครลบ (จ5) | ไฟล์ใน bucket **ถูกลบจริงทันที** (§5) — แถวเหลือเป็นบันทึก |

ทำไม `is_primary` ทั้งที่ `product_image` เลือก "แถวแรกตาม sort_order = รูปหลัก": รูปหลักของใบงานคือสิ่งที่ **พิมพ์ลงกระดาษ** และช่างยึดเป็นหลัก — ออฟฟิศต้องตั้งได้ชัดและการจัดเรียงแถบรูปต้องไม่เปลี่ยนรูปที่พิมพ์โดยไม่ตั้งใจ · ที่แลก: state 1 ตัวที่ต้องคุมด้วย partial unique index (คุมแล้ว)

ทำไม **copy** รูป SKU เข้า bucket ใบงาน ไม่ link ไป `product-images`: รูปใบงาน = ความจริงของรอบผลิตนั้น (หลักเดียวกับ `sku-autofill-decisions` และ snapshot `calc.breakdown.product` ของ OEM) — แก้/ลบรูปแคตตาล็อกทีหลังใบงานต้องไม่เปลี่ยน · ช่องทางช่าง sign ได้แค่ bucket เดียว · ที่แลก: ไฟล์ซ้ำ ≤ 2 MB ต่อใบที่ใช้ค่าเริ่ม (วันนี้ 0 ใบ)

### 2.3 เพดาน · budget · ด่านบนตาราง (trigger — บังคับที่ DB ไม่ใช่แค่ app)
- `job_photo_enforce_cap` BEFORE INSERT: `pg_advisory_xact_lock(hashtextextended(job_id::text, 2))` → นับแถว `deleted_at is null`: `kind='reference'` ≥ **5** ⇒ `P0001` · รวมทุก kind ≥ **20** ⇒ `P0002` · lock ร้าน seed 3 → `sum(bytes)` ของร้าน (active) + `new.bytes` > **250 MB** ⇒ `P0003` (md อย่างเดียว · sm ≈ ⅓ ⇒ ~330 MB บนดิสก์ · รวม budget แคตตาล็อก 600 MB + ใบปะหน้า ยังใต้ 1 GB ในการใช้จริง — ตัวเลขเทคนิค ไม่ต้องถามเจ้าของ · ตัวเลขทั้งสองอยู่ใน `lib/images/constants.ts` คู่กับ trigger — 🔴 2 ที่ ต้องขยับพร้อมกัน (บทเรียน `MAX_IMAGES_PER_SKU`))
- `job_photo_guard` BEFORE INSERT/UPDATE/DELETE: INSERT ต้อง job อยู่ร้านเดียวกัน · `parent_job_id is null` · **job.status not in ('done','cancelled')** สำหรับ `kind='reference'` (ข้อยกเว้น `stage` ตาม J1 §2.9 ค่อยเปิดตอน W2b) · path prefix ตรง · UPDATE แก้ได้เฉพาะ `is_primary · sort_order · caption · deleted_at/deleted_by/delete_reason` (identity/path/bytes/kind/source แก้ไม่ได้) · ใบปิดแล้ว ⇒ UPDATE ปฏิเสธ · **DELETE ปฏิเสธเสมอ** (`42501`) + deny TRUNCATE — แถว = หลักฐาน (ชุดทดสอบใช้ do-block rollback ตามกติกา)
- `job_event`: เพิ่ม `'photo_remove'` ใน CHECK (drop + add constraint · ลอกรายการล่าสุดจาก **0181** ไม่ใช่ 0176) + `EVENT_TYPE_LABEL` ฝั่งแอป ("ลบรูป") — เทสต์ events-labels ล้มถ้าลืม

### 2.4 ย่อฝั่ง client · ลบ EXIF/GPS ที่ไหน
- **client** (`resizeProductImage` เดิม — เปลี่ยนชื่อเป็น `resizeImageVariants` ใน `lib/images/client.ts`): ปฏิเสธ source > 30 MB · HEIC · decode ไม่ได้ · ย่อ md/sm + quality ladder ≤ 1 MB · **re-encode ผ่าน canvas ⇒ metadata ทั้งหมดรวม EXIF GPS หายโดยโครงสร้าง** (คอมเมนต์ใน image-client บอกไว้ว่า load-bearing)
- **server ยืนยัน** (`lib/images/server.ts` เพิ่ม `findExifApp1(bytes): boolean`): เดิน marker หลัง SOI · ถ้าพบ segment `0xFFE1` ที่ payload ขึ้นต้น `"Exif\0\0"` ⇒ **ปฏิเสธ** ("รูปยังมีข้อมูลจากกล้อง — อัปโหลดผ่านหน้าเว็บ ระบบจะล้างให้") — ไม่ strip เองฝั่ง server (เขียน JPEG ใหม่โดยไม่มีไลบรารี = ความเสี่ยงที่ไม่คุ้ม · เหตุผลเดียวกับ 0105 ที่ไม่เอา `sharp`) · canvas output ไม่มี APP1 Exif อยู่แล้ว ⇒ ผู้ใช้ปกติไม่เจอด่านนี้ · unit test ด้วย bytes สังเคราะห์ (SOI + APP1 Exif) และไฟล์จริงที่มี GPS ให้ QA ยิงตรงเข้า action (ข้าม client) ต้องถูกปฏิเสธ
- ด่านเดิมยังอยู่ทุกข้อ: `looksLikeJpeg` · ≤ 1 MB ต่อ variant · ไม่ว่าง · ขนาดจาก SOF (informational)

---

## 3. ใครเห็นยังไง (ตอบข้อ 2)

### 3.1 ออฟฟิศ `/jobs/[id]`
- `getJobDetail` เพิ่ม `photos: JobPhotoRow[]` = `{ id, smUrl, mdUrl, isPrimary, sortOrder, caption, source, createdAt }` (ไม่ส่ง `storage_path`/`product_image_id`/`uploaded_by` ถึง client — ไม่จำเป็น) · sign ครั้งเดียวแบบ batch (`createSignedUrls`) · TTL **15 นาที** (ค่าเดียวทั้งออฟฟิศและช่าง — สั้นกว่า 1 ชม. ของแคตตาล็อก เพราะรูปแบบลูกค้า OEM · หน้า force-dynamic อยู่แล้ว กดดูใหม่ = sign ใหม่ · ที่แลก: แกลเลอรีเปิดค้าง > 15 นาที แตะขยายแล้วรูปไม่โหลด → ปุ่ม "โหลดใหม่")
- การ์ด **"รูปสินค้า"** ใน `JobDetailClient` (component ใหม่ `JobPhotosCard`): รูปหลักใหญ่ + แถบรูปย่อ ≤ 5 · ปุ่ม "ถ่ายรูป" (input file รับ jpeg/png/webp + `capture=environment`) + "เลือกจากเครื่อง" (หลายไฟล์) · อัปโหลด**ทีละรูปทันทีที่เลือก** (เน็ตสะดุดเสียแค่รูปเดียว — มติ §4.2) · ต่อรูป: ดาว "ตั้งเป็นรูปหลัก" · ลบ (ยืนยัน + เหตุผลไม่บังคับ) · caption · ปุ่ม "ดึงรูปจากแคตตาล็อก" (เมื่อ SKU มีรูปและใบยังไม่มีรูป `source='product'`) · ใบ done/cancelled = อ่านอย่างเดียว · ข้อความ error ไทยต่อเคส (เต็ม 5 · ไฟล์ใหญ่ · HEIC · ไม่ใช่รูป · พื้นที่ร้านเต็ม)
- 🔴 **ux-ui ก่อน frontend** (memory `ui-through-ux-first`): การ์ดนี้เป็นจอใหม่ที่ใช้ทุกวัน · มี Open5 (W-5) + Prints ก เป็นฐานแล้ว ⇒ งาน ux-ui ขนาด S: วางการ์ดในหน้า `/jobs/[id]` (PC + มือถือ) + สถานะ อัปโหลด/ล้ม/เต็ม/ปิดแล้ว

### 3.2 ช่าง `/w/[token]` — ไม่มี Supabase session
- **DB เป็นผู้ตัดสินว่าเห็นอะไร**: `job_worker_resolve` (replace · signature เดิม 3 arg · **ลอก def สดจาก DB หลัง 0181** ไม่ใช่จากไฟล์ 0172) เพิ่ม key `job.photos` = `[{id, sm_path, md_path, is_primary, caption}]` เฉพาะ **หลังระบุตัว** (`v_worker is not null` — บล็อกเดียวกับที่ปล่อย `design_label`) · กรอง `deleted_at is null` · เรียง `is_primary desc, sort_order, created_at` · ก่อน PIN = ไม่มี key (คนเก็บกระดาษได้ไม่เห็นแบบลูกค้า OEM — ด่านเดียวกับชื่อแบบ)
- **server sign** ใน `lib/jobs/worker-server.ts`: เอา path **เฉพาะที่ RPC คืนมา** ไป `signJobPhotoPaths(paths)` (helper ใน `lib/images/signing.ts` — รับ bucket+TTL · อยู่**นอก**รายชื่อไฟล์กราฟช่าง และ worker-server เองต้องไม่มี `.from(` ตามเทสต์ boundary) · sign ล้ม = รูปนั้นหาย ไม่ล้มทั้งหน้า (แบบ `signImagePaths`)
- `sanitizeWorkerView` allowlist ขยายทีละ key: `job.photos?: { id, smUrl, mdUrl, isPrimary, caption }[]` (uuid regex · url ต้องเป็น `https://` ≤ 1000 ตัว · ≤ 20 รายการ) · key อื่นทิ้ง · `FORBIDDEN_KEY_PATTERN` ไม่ชน (ไม่มี price/cost)
- UI (`WorkerApp`): รูปหลักย่อ (sm · ~96px) บนหัวใบข้างชื่อแบบ · แตะ → เต็มจอ (md) เลื่อนดูทั้งชุด + caption · `loading="lazy"` · `referrerPolicy="no-referrer"` (layout ตั้ง `referrer: no-referrer` อยู่แล้ว — ใส่ซ้ำที่ img) · ไม่มีปุ่มอัปโหลด/ลบในรอบนี้ (ไม่มี RPC เขียนให้ช่าง = ไม่มีช่อง)
- ทางที่ตัดทิ้ง: (ก) route proxy `/w/[token]/photo/[id]` stream bytes ผ่าน Next — ต้องขยาย middleware exempt regex (ตอนนี้แคบ 1 เซกเมนต์โดยตั้งใจ) + bandwidth ผ่าน server · (ข) bucket public — ปฏิเสธถาวรตั้งแต่ 0105 · (ค) URL อายุยาว/ถาวร — ขัดมติ §4.3

### 3.3 ใบพิมพ์ (type boundary)
- `PrintableJob` เพิ่ม **field เดียว** `primaryPhotoUrl: string | null` · `toPrintableJob(job, stages, primaryPhotoUrl)` รับเป็น**พารามิเตอร์ที่สาม** (ไม่ spread · ไม่ส่ง `JobDetailData.photos` ทั้งก้อน) · หน้า print sign md ของรูปหลักตอน render (15 นาที — พิมพ์ทันทีหลังออก QR)
- A5 (`JobSheet`): รูปหลัก **40×40 มม.** ใต้/ข้าง QR ในคอลัมน์ขวา (`object-fit: contain` · ใช้ img element ไม่ใช่ CSS background — Chrome ไม่พิมพ์ background เป็นค่าเริ่ม) · ใบย่อย `?lot=n` (0181 UI) และใบส่งของผู้รับจ้าง (L2) = field เดียวกันจากใบแม่ (`PrintableDeliveryNote` ประกอบเอง) · **Q11 มติแล้ว: ไม่มีสวิตช์ซ่อน** ⇒ มีรูปหลัก = พิมพ์เสมอ
- **ใบไม่มีรูป = markup เดิมเป๊ะ** (ไม่มีกรอบว่าง/ข้อความ "ไม่มีรูป") — เทสต์ snapshot `JobSheet` กับ `primaryPhotoUrl: null` ต้องเท่าผลเดิม
- `JobPrintClient`: รอรูปหลัก `complete`/`decode()` ก่อน `window.print()` (race เดิม 250 ms หลัง QR — ใส่ `Promise.race` กับ timeout 3 วิ แล้วพิมพ์ต่อโดยไม่มีรูป + แถบเตือน `print:hidden`) · รูปขาวดำ/หมึก = ข้อแลกที่เจ้าของรับแล้ว (จ3 ①)

---

## 4. ค่าเริ่มจากรูป SKU (ตอบข้อ 3)
- **ตอนสร้างใบงาน** (action ออฟฟิศ `createJob*` ใน `lib/actions/job-office*.ts` หลัง RPC สร้างใบสำเร็จ): ถ้า `job.product_id` มี `product_image` → อ่านแถวรูปหลักของ SKU (ลำดับ `sort_order, created_at, id` แบบ `getProducts`) **จาก DB (shop_id + product_id ตรงกับใบ)** → download md+sm ด้วย service client → upload เข้า `job-photos/<shop>/<job>/<uuid>_{md,sm}.jpg` → `job_photo_add(source='product', product_image_id=…, is_primary=true)` · **ล้มเหลว = ไม่บล็อกการสร้างใบ** (log code เท่านั้น · ใบงานมีปุ่ม "ดึงรูปจากแคตตาล็อก" ให้ทำซ้ำ)
- **ใบที่เปิดอยู่ก่อนหน้า** (ซ1 ①): ปุ่ม "ดึงรูปจากแคตตาล็อก" บนการ์ด — กดเอง ไม่ auto ย้อนหลัง (ใบ open/in_progress/on_hold เท่านั้น)
- **ห้ามเขียนกลับ catalog — กันด้วยโครงสร้าง**: ไม่มี action/RPC ใดในชุดนี้ที่ UPDATE/INSERT `product_image` หรือ upload เข้า `product-images` · action รูปใบงานแตะ `product_image` แค่ SELECT แถวเดียว · verify: md5 ของ `product_image` ทั้งตาราง + จำนวน object ใน `product-images` ก่อน/หลังทุกเคส **ต้องเท่าเดิม** (เทสต์ "ของใหม่เจอของเก่า" ข้อ 17)
- แก้/ลบรูปในใบ = แถว `job_photo` ของใบนั้น · เปลี่ยน SKU ของรายการทีหลัง (`production_order_item_bind_product` W1) ไม่ลบรูปที่มี — ออฟฟิศตัดสินเอง

---

## 5. ลบ / เปลี่ยน / ใบปิดแล้ว / audit (ตอบข้อ 4)

| เรื่อง | ตัดสิน | เหตุผล · ทางที่ตัดทิ้ง |
|---|---|---|
| ลบ | **soft delete แถว + ลบไฟล์ใน bucket จริงทันที** (`job_photo_remove` คืน path → action remove object · remove ล้ม = log + แถวยังถือว่าลบแล้ว · ไฟล์ค้างเป็นหนี้เก็บกวาดแบบเดียวกับ catalog) | จ5 ต้องมี "ใครลบ เมื่อไร" ⇒ แถวต้องอยู่ · แต่แบบลูกค้า OEM ที่สั่งลบต้องหายจริง ⇒ bytes ต้องไป · hard delete ทิ้งประวัติ / soft delete เก็บ bytes = ลบแล้วแต่ยังอยู่ |
| เปลี่ยนรูป | = ลบ + อัปโหลดใหม่ (uuid ใหม่เสมอ ไม่ทับ path เดิม — กัน CDN cache เก่า) | เหมือน `deleteProductImage + uploadProductImage` |
| ตั้งรูปหลัก | RPC `job_photo_set_primary` ทรานแซกชันเดียว (ล้างตัวเก่า → ตั้งตัวใหม่) · ลบรูปหลัก ⇒ RPC เลื่อนรูป active ถัดไปขึ้นเป็นหลักอัตโนมัติ (ไม่ให้ใบที่ยังมีรูปแต่ไม่มีรูปหลัก) | partial unique index เป็นกำแพงสุดท้าย |
| จัดเรียง | RPC `job_photo_reorder(p_ids uuid[])` ต้องเป็นชุดเดียวกับ active ids เป๊ะ (ไม่มี partial/ซ้ำ/ของใบอื่น) | ลอกกติกา `reorderProductImages` แต่ทำใน DB ครั้งเดียว |
| ใบ done/cancelled | **แก้รูปไม่ได้** (เพิ่ม/ลบ/ตั้งหลัก/เรียง ⇒ `job_closed`) — คงหลัก `job_guard` "ปิดคือปิด" · ข้อยกเว้น J1 §2.9 ("แนบได้แม้ done — รูปคือหลักฐาน") สงวนไว้ให้ `kind='stage'` ใน W2b เท่านั้น | รูปอ้างอิงหลังปิดงานไม่มีผู้ใช้ (ใบไม่พิมพ์ · ช่างได้ `job_closed`) — เปิดทางแก้ = เพิ่มพื้นผิวแก้ใบปิดโดยไม่มีประโยชน์ · → คำถามเจ้าของ Q1 |
| audit | `job_event` `photo_add` (payload: `photo_id · kind · source · bytes · product_image_id · is_primary`) · `photo_remove` (payload: `photo_id · reason`) · actor = ผู้ใช้ออฟฟิศ (`p_actor` จาก session — `callOffice` ใส่ให้หลัง spread) · ตั้งหลัก/เรียง **ไม่** เขียน event (ลำดับแสดงผล ไม่มีน้ำหนักทางธุรกิจ — เหตุผลเดียวกับ reorder ของ catalog) · หน้าใบงานโชว์ในไทม์ไลน์เดิม |

---

## 6. RPC / action / ไฟล์ (contract)

### 6.1 RPC (ทั้งหมด `security definer` · pin `search_path` · `crm_require_owner_admin` · `revoke … from public, anon, authenticated` · `grant … to service_role` · `for update` แถว job · ตัวเลข `not (x between …)`)

| RPC | ทำอะไร | ด่าน |
|---|---|---|
| `job_photo_add(p_shop_id, p_job_id, p_kind, p_source, p_storage_path, p_variant_sm_path, p_bytes, p_width, p_height, p_caption, p_product_image_id, p_actor)` → `{photo_id, is_primary}` | insert แถว · ถ้าใบยังไม่มีรูปหลัก active ⇒ ตั้งตัวนี้ · event `photo_add` | job ร้านเดียวกัน · ใบแม่ · ไม่ปิด · `p_kind='reference'` เท่านั้นรอบนี้ (`stage` ⇒ 22023 `not_yet`) · `p_source in ('office','product')` (shopfloor ⇒ 22023 — ไม่มี worker ผ่านทางนี้) · path prefix = `shop/job/` + suffix `_md.jpg`/`_sm.jpg` + uuid เดียวกัน · `p_product_image_id` ต้องเป็นแถวของร้านนี้และ `product_id = job.product_id` · cap ที่ trigger |
| `job_photo_remove(p_shop_id, p_photo_id, p_reason, p_actor)` → `{storage_path, variant_sm_path, promoted_photo_id}` | soft delete · เลื่อนรูปหลักถัดไป · event `photo_remove` | แถว active ของร้านนี้ · ใบไม่ปิด · ลบซ้ำ = 22023 `already_deleted` (ไม่ no-op เงียบ) |
| `job_photo_set_primary(p_shop_id, p_photo_id, p_actor)` | ล้าง+ตั้งในทรานแซกชันเดียว | active · ใบไม่ปิด |
| `job_photo_reorder(p_shop_id, p_job_id, p_ids uuid[], p_actor)` | sort_order = index | ชุด id = active ids เป๊ะ · ≤ 20 |
| `job_worker_resolve(text,text,text)` **replace** | เพิ่ม `job.photos` หลังระบุตัว | ลอก def สดหลัง 0181 · `pg_proc` 1 แถวหลัง replace · re-grant |

### 6.2 ไฟล์ที่สร้าง/แก้

| path | หน้าที่ | ใหม่/แก้ |
|---|---|---|
| `supabase/migrations/0182_job_photos.sql` · `scripts/verify/verify-0182.sql` | bucket · ตาราง · 2 trigger · 4 RPC · replace resolve · CHECK event · ชุดทดสอบ do-block rollback + ตารางแมปข้อ→เทสต์ | ใหม่ |
| `lib/images/{constants,client,server,signing}.ts` (+ tests) | **ย้าย** `lib/catalog/image-*.ts` ออกจาก `lib/catalog/` (rename ทั้งไฟล์ · logic เดิม 100%) · `constants` เพิ่ม `JOB_PHOTOS_BUCKET` · `MAX_REFERENCE_PHOTOS=5` · `MAX_JOB_PHOTOS=20` · `JOB_PHOTO_SIGNED_URL_TTL_S=900` · `signing` รับ bucket+ttl (`signPaths(supabase, bucket, paths, ttl)`) · `server` เพิ่ม `findExifApp1` | ย้าย+แก้ — เหตุผล: กราฟช่างห้าม `lib/catalog/**` (boundary test) · W1 ต้องใช้ client resize จากหน้าช่าง · ทำตอนนี้ตอนไม่มีใครแตะไฟล์ชุดนี้ (5 จุด import ใน catalog actions/ProductForm) |
| `lib/actions/job-photos.ts` ("use server") | `uploadJobPhoto(fd)` · `removeJobPhoto` · `setPrimaryJobPhoto` · `reorderJobPhotos` · `pullJobPhotoFromCatalog(jobId)` · `getJobPhotos(jobId)` — `guard()` บรรทัดแรก · ตรวจ bytes ก่อน upload · rollback object เมื่อ RPC ล้ม | ใหม่ |
| `lib/actions/job-office.ts` | `getJobDetail` + `photos` · action สร้างใบ: copy รูป SKU (non-blocking) | แก้ |
| `lib/jobs/print.ts` · `app/(dashboard)/jobs/[id]/print/page.tsx` · `components/domain/jobs/JobPrintClient.tsx` | `primaryPhotoUrl` · sign ตอน render · 40×40 มม. · รอโหลดก่อนพิมพ์ | แก้ (🔴 ชนกับ 0181 UI ที่แก้ 3 ไฟล์นี้ — §8) |
| `components/domain/jobs/JobPhotosCard.tsx` (+ test) · `JobDetailClient.tsx` | การ์ดรูป | ใหม่/แก้ |
| `lib/jobs/worker-view.ts` · `lib/jobs/worker-server.ts` · `components/domain/jobs/worker/WorkerApp.tsx` (+ `WorkerPhotos.tsx`) | allowlist `photos` · sign · UI | แก้ |
| `lib/jobs/types.ts` | `EVENT_TYPE_LABEL.photo_remove` | แก้ |
| `app/(dashboard)/settings/…` | tile "พื้นที่รูปที่ใช้ไป" (sum bytes ต่อ bucket จาก `storage.objects.metadata->>'size'` ผ่าน view `analytics.v_storage_usage` service-only) — ปิดหนี้ J1 R8 | ใหม่ (เล็ก · ทำท้ายสุด ตัดได้ถ้าเวลาไม่พอ) |

---

## 7. phase · ขนาด · migration · QA · security (ตอบข้อ 6)

| phase | ส่งมอบ | migration | ขนาด | QA | security | พึ่ง |
|---|---|---|---|---|---|---|
| **PH-0 ลำดับก่อนเริ่ม** | เอา `feature/job-lots-l1` เข้า main ก่อน (0181 apply แล้ว แต่ไฟล์ยังไม่อยู่ main) · ux-ui spec การ์ดรูป (S) | — | S | — | — | — |
| **PH-A DB** | §2 + §6.1 + `verify-0182.sql` | **0182** | M (~400 บรรทัด) | — | **บังคับก่อนรวมเข้า main** | PH-0 |
| **PH-B ออฟฟิศ + พิมพ์** | ย้าย `lib/images/` · `job-photos.ts` · การ์ด · copy รูป SKU · A5 · settings tile | — | M | **L** | (รวมกับ PH-A) | PH-A apply |
| **PH-C ช่าง** | resolve→sign→allowlist→UI · เทสต์ boundary/forbidden/sanitize | — | S | รวมใน L | (รวม) | PH-A · ขนานกับ PH-B ได้ (worktree แยก — ไฟล์ไม่ทับกัน) |
| W2b รูปผลงานต่อขั้น (ช่างถ่ายตอนส่งต่อ) · W1 รูปตอนเปิดใบหน้างาน | ใช้ `kind='stage'`/`source='shopfloor'` + RPC ช่าง `job_worker_photo_add` (ผ่าน `job_worker_auth` + rate limit `ipw:`) · ตารางไม่ต้องแก้ | 0186+ | S–M | M | ใช่ (ช่องสาธารณะ**สร้าง**ข้อมูล) | W1 |

- **เลข migration**: 0181 apply แล้ว (19 ต.ค.) ⇒ รูป = **0182** ตามมติ "ทำก่อน" · ต้องเลื่อนในเอกสารอื่น: PM-A โลหะ 0182→**0183** (`design-production-item-metal.md` §5) · L3 0182/0183→**0184** · L2 0183→**0185** · W1 0184→**0186** · L4 0185→**0187** (`design-job-lots-shopfloor.md` §9) — ให้คนเขียน migration ตัวนั้นแก้เอกสารตอนสร้างไฟล์ (เลขจริง = เลขว่างถัดไป ณ วันสร้างไฟล์เสมอ)
- 0182 ไม่ชนกับ PM-A (แตะคนละฟังก์ชัน — PM-A แตะ `job_source_info`/`production_*` · 0182 แตะ `job_worker_resolve` ที่ 0181 เพิ่งแทน) ⇒ ทำคู่ขนานได้ถ้า apply ตามลำดับเลข
- **QA scope = L** (skill `3j-qa-regression-map`): แตะของกลาง 3 ตัว — `job_worker_resolve` (ทุก flow `/w/` รวมส่วนย่อย 0181) · type boundary ใบพิมพ์ (ใบงาน/ใบย่อย) · pipeline รูปที่แคตตาล็อกใช้ร่วม (ย้ายไฟล์) ⇒ ไล่: สร้างใบงาน (OEM + ผลิต · SKU มี/ไม่มีรูป) · หน้าใบงาน อัป/ลบ/ตั้งหลัก/เรียง/ดึงจากแคตตาล็อก · พิมพ์ A5 มี/ไม่มีรูป · ใบย่อย · `/w/` ก่อน-หลัง PIN · รับ/ส่งต่อเดิม · `/catalog` อัปโหลดรูป SKU เดิม · ใบ done/cancelled บน prod (32 ใบ) เปิดหน้าได้เหมือนเดิม
- **security บังคับ** แม้ไม่ใช่ 💰: ช่องทางสาธารณะได้ข้อมูลชนิดใหม่ (แบบลูกค้า OEM ถึงมือถือช่าง) + bucket/signing ใหม่ + ด่านไฟล์ (EXIF · ชนิดไฟล์) — ให้ยิงหน้า `/w/` จริงแล้ว grep RSC payload ว่าไม่มี `storage_path`/`product_image_id`/`uploaded_by` และมี URL เฉพาะโดเมน Storage ของโปรเจกต์ · ทดสอบ EXIF ด้วยไฟล์ GPS จริงยิงตรง action

---

## 8. ความเสี่ยง · จุดที่พังง่ายตอน implement
1. 🔴 **ชนไฟล์กับ 0181 UI** (`feature/job-lots-l1` แก้ `lib/jobs/print.ts` · `print/page.tsx` · `WorkerApp.tsx` · `job-office.ts` · `job-worker.ts`): ต้องเอา L1 เข้า main ก่อนแตกสายงานรูป — ไม่งั้น conflict บน type boundary ที่ต้องรีวิวละเอียด
2. 🔴 **ลอก def `job_worker_resolve` ผิดฉบับ**: ของบน prod = ฉบับ 0181 (มี `parts[]`/`my_actions[]`/`next_action='multi'`) ไม่ใช่ 0172 — ลอกจาก `pg_get_functiondef` สด แล้วเทียบ md5 ก่อน/หลังด้วย verify (memory `migrations-0107-0109-off-main`) · signature เดิม ⇒ ไม่เกิด overload แต่ grant หาย (ข้อ 2)
3. **เทสต์ boundary ของกราฟช่าง**: `worker-server.ts` ห้ามมี `.from(` และห้าม import `lib/catalog/` ⇒ signing ต้องอยู่ `lib/images/signing.ts` และ worker-server เรียก helper เท่านั้น · ถ้า dev "แก้ regex ให้ผ่าน" = ตีกลับ
4. **race พิมพ์ก่อนรูปโหลด**: `window.print()` ยิง 250 ms หลัง QR — ต้องรอ `img.decode()` (timeout 3 วิ) · QA พิมพ์ใบที่มีรูปบนเน็ตช้า (throttle) แล้วดู preview
5. **ย้าย `lib/catalog/image-*` → `lib/images/`**: 0 logic เปลี่ยน แต่ typecheck + เทสต์เดิม 2 ไฟล์ + smoke อัปโหลดรูป SKU บน `/catalog` ต้องผ่าน · ถ้าทีมไม่อยากย้ายรอบนี้ → ทางเลือก B: สร้าง `lib/images/` ใหม่เฉพาะ `signing` + `server.findExifApp1` แล้วให้ `job-photos.ts` import resize จาก `lib/catalog/image-client` (ได้ เพราะ action ออฟฟิศไม่อยู่ในกราฟช่าง) — แต่ W1 จะต้องย้ายอยู่ดี
6. **ไฟล์ค้างใน bucket** เมื่อ remove object ล้มหลัง RPC ลบแถวแล้ว (หรือ upload สำเร็จแต่ RPC ล้มและ rollback ล้ม) — ยอมรับแบบเดียวกับ catalog · settings tile ทำให้เห็นตัวเลขจริง · เก็บกวาด = script เทียบ `storage.objects` กับแถว active (หนี้ที่รู้ตัว)
7. **เพดานร้าน 250 MB** เป็นตัวเลขทีม — ถ้าร้านถ่าย 5 รูป × ใบละ ~0.4 MB (md+sm) ≈ 600 ใบ ก่อนชน · ก่อนถึงมี tile เตือน
8. **URL ที่ออกไปแล้ว** ยังใช้ได้ ≤ 15 นาทีหลังเพิกถอน QR/ปิดใบ/ลบรูป (ลบรูป = object หาย URL ตายทันที · เพิกถอน/ปิดใบ = URL เดิมยังโหลดได้จนหมดอายุ) — ขอบเขตที่ยอม เหมือนแคตตาล็อก
9. **job_event payload ของ `photo_add` ตอน copy จาก SKU** ต้องไม่มีชื่อไฟล์/path (payload ไปโชว์ในไทม์ไลน์ออฟฟิศเท่านั้น แต่ไม่ต้องมี) — เก็บแค่ id/bytes/source
10. A5 คอลัมน์ขวาสูงขึ้น ~45 มม. — ใบที่มีขั้น ≥ 9 + หมายเหตุ อาจล้นหน้า · ux/frontend ต้องลองกับใบขั้นเยอะสุดบน prod ก่อนปล่อย

---

## 9. เคสห้ามผ่าน / ต้องไม่พัง (ให้ backend/QA/security แมป "ข้อ → เทสต์" · ข้อไหนไม่มีเทสต์ครอบให้เขียนว่า "ไม่มี" พร้อมเหตุผล)

### 9.1 ห้ามผ่าน
| # | เคส | ด่านที่ตก |
|---|---|---|
| 1 | ไฟล์ไม่ใช่ JPEG (svg/html/png/pdf/exe เปลี่ยนนามสกุล · `Content-Type` ปลอม) | action `looksLikeJpeg` (bytes จริง) → bucket `allowed_mime_types` → ต่อให้หลุด bucket private + เสิร์ฟเป็น `image/jpeg` ผ่าน signed URL เท่านั้น (ไม่ execute) |
| 2 | JPEG ที่มี APP1 Exif (GPS) — ยิงตรงเข้า action ข้าม client | `findExifApp1` ⇒ ปฏิเสธ (vitest bytes สังเคราะห์ + QA ไฟล์จริง) |
| 3 | ขนาด: variant > 1 MB · 0 byte · body > 4 MB · source > 30 MB | action + bucket limit · Next bodySizeLimit · client ไม่ decode |
| 4 | รูปที่ 6 (reference) · รูปที่ 21 (รวม) · 2 อัปโหลดพร้อมกันตอนมี 4 | app count + trigger advisory lock (P0001/P0002) — race 2 connection **ไม่มีเทสต์ใน do-block** (ทรานแซกชันเดียวจำลองไม่ได้) ⇒ code review ยืนยัน pattern = 0104/0105 เป๊ะ |
| 5 | path ไม่ใช่ `<shop>/<job>/<uuid>_md.jpg` คู่ `_sm.jpg` · path ของใบ/ร้านอื่น · path ซ้ำ · client ส่ง path มาเอง | RPC ตรวจ prefix/suffix/uuid เดียวกัน · unique · action ไม่รับ path จาก FormData เลย |
| 6 | ใบย่อย (`parent_job_id is not null`) · ใบ done/cancelled · ใบร้านอื่น · job ไม่มี | trigger + RPC (`lot_no_photo` · `job_closed` · 22023) |
| 7 | `product_image_id` ของร้านอื่น / ของ SKU ที่ไม่ใช่ `job.product_id` | RPC |
| 8 | `kind='stage'` · `source='shopfloor'` · `worker_id` ตั้งมาผ่าน RPC ออฟฟิศรอบนี้ | RPC `not_yet`/22023 (ประตูยังปิดจนกว่า W2b/W1 เปิดด้วย RPC ช่างของตัวเอง) |

| 9 | `is_primary` 2 แถวต่อใบ ผ่าน service key UPDATE ตรง · เปลี่ยน path/job_id/bytes/kind/source ของแถวเดิม · DELETE/TRUNCATE | partial unique index · `job_photo_guard` · deny |
| 10 | ลบซ้ำ · ตั้งหลัก/เรียงรูปที่ลบแล้ว · reorder ชุด id ไม่ครบ/ซ้ำ/ของใบอื่น | RPC 22023 |
| 11 | caption มีอักขระล่องหน/bidi/ยาว > 60 | `job_text_clean` |
| 12 | anon/authenticated เรียก RPC ใหม่ · อ่าน `job_photo` ผ่าน REST · อ่าน bucket ตรง | revoke 3 ชื่อ + RLS ไม่มี policy + bucket ไม่มี policy · `scripts/check-analytics-grants.sql` หลัง apply · verify Part 4c แบบ 0147 (`set local role authenticated` ยิงจริงต้อง 42501) |
| 13 | ช่างก่อน PIN เห็นรูป · token เพิกถอน/ใบปิด ได้ `photos` · ช่างได้ path ของใบอื่น · RSC payload หน้า `/w/` มี `storage_path`/`product_image_id`/`uploaded_by`/คีย์ต้องห้ามเดิม | RPC ปล่อย `photos` เฉพาะหลัง auth · `sanitizeWorkerView` allowlist · เทสต์ยิงหน้าจริง grep |
| 14 | ใบพิมพ์ได้ field รูปอื่นนอกจาก `primaryPhotoUrl` · caption/ที่มา/ชื่อคนอัปโหลดขึ้นกระดาษ | `PrintableJob` ประกอบทีละ field · เทสต์ type boundary เดิมขยาย |
| 15 | action ใดเขียน `product_image`/`product-images` (เขียนกลับ catalog) | ไม่มีโค้ด path · verify md5 ตาราง + นับ object ก่อน/หลัง |
| 16 | log มี signed URL / path / token | `logJobFailure` (code+hint เท่านั้น) · review grep `console.` ในไฟล์ใหม่ |

### 9.2 ต้องไม่พัง
| # | เคส | พิสูจน์ |
|---|---|---|
| A | ใบไม่มีรูป: A5 markup เท่าเดิมเป๊ะ · หน้าใบงานเหมือนเดิม + การ์ดว่าง · `/w/` เหมือนเดิม (ไม่มี key `photos`) | snapshot `JobSheet(null)` · `job_worker_resolve` ของทุกใบบน prod ก่อน/หลัง apply: JSON ลบ key `photos` แล้วต้อง**เท่ากันทุกใบ** (verify) |
| B | J1/0181 flow ช่างเดิม (รับ/ส่งต่อ/ส่วนย่อย/ชี้แจง) ไม่เปลี่ยน | เทสต์เดิม worker-view/boundary/lots ผ่าน · QA ไล่ `/w/` |
| C | สร้างใบงานเมื่อ SKU ไม่มีรูป (291/291 วันนี้) หรือ copy ล้ม = ใบเกิดปกติ | เทสต์ action: mock storage ล้ม → ใบสร้างสำเร็จ · ไม่มี throw |
| D | อัปโหลดรูป SKU ที่ `/catalog` หลังย้ายไฟล์ | เทสต์เดิม `image-client/server` ผ่านที่ path ใหม่ · smoke 1 รูป |
| E | ใบ done/cancelled บน prod เปิด `/jobs/[id]` ได้ · การ์ดรูปอ่านอย่างเดียว ไม่ error | QA |
| F | พิมพ์ใบที่มีรูปบนเน็ตช้า = รูปมาก่อนพิมพ์ หรือพิมพ์โดยไม่มีรูป + แถบเตือนบนจอ (ไม่ค้าง) | QA throttle |
| G | signing ล้ม 1 รูป = รูปนั้นหาย หน้าไม่ล้ม | unit test helper |

---

## 10. คำถามเจ้าของ (ตอบเป็นเลขข้อ · ไม่ตอบ = ใช้ข้อ ①)

| # | คำถาม | ตัวเลือก | แนะนำ |
|---|---|---|---|
| Q1 | ใบงานที่ **ปิดแล้ว** (เสร็จ/ยกเลิก) ยังเพิ่ม/ลบรูปสินค้าได้ไหม | ① ไม่ได้ — ปิดคือปิด (รูปผลงานของช่างในอนาคตจะเป็นข้อยกเว้นแยก) · ② ได้ตลอด | ① — ไม่มีใครใช้รูปอ้างอิงหลังปิด และไม่เปิดช่องแก้ใบปิด |
| Q2 | ใบที่เปิดอยู่ตอนนี้ (3–4 ใบ) ให้ระบบ**ดึงรูป SKU ให้เอง**ย้อนหลัง หรือออฟฟิศกดปุ่มเอง | ① กดเอง ("ดึงรูปจากแคตตาล็อก") · ② ดึงให้อัตโนมัติ | ① — ใบใหม่ดึงให้เองอยู่แล้ว · ของเก่าคนตัดสิน (วันนี้ SKU มีรูปแค่ 1 ตัว ผลต่างแทบไม่มี) |
| Q3 | ช่างเห็นรูป**ก่อน**ใส่ชื่อ+PIN ไหม | ① หลัง PIN เท่านั้น (คนเก็บกระดาษได้ไม่เห็นแบบลูกค้า) · ② เห็นรูปหลักได้เลยตอนสแกน | ① — กติกาเดียวกับชื่อแบบที่ซ่อนจนระบุตัว |
| Q4 | ลบรูปต้อง**ใส่เหตุผล**ไหม | ① ไม่บังคับ (มีประวัติ ใคร/เมื่อไร แล้ว) · ② บังคับ | ① |
| Q5 | ป้ายใต้รูป (เช่น "ด้านข้าง" · "ตำแหน่งพลอย") | ① มี ไม่บังคับ ≤ 60 ตัวอักษร · เห็นในแอป ไม่พิมพ์บน A5 · ② ไม่ต้องมี | ① |
| Q6 | เตือน "พื้นที่รูปใกล้เต็ม" ที่กี่ % ของ 1 GB | ① 80% · ② **[ค่าจริง]** ____ | ① |

มติที่ **ไม่ถามซ้ำ** (ตอบแล้ว 17–18 ต.ค.): 5 รูป/ใบ · 20 รวม · A5 มีรูปหลัก 40×40 มม. · ออฟฟิศลบได้มีประวัติ · เก็บตลอด · OEM ช่างเห็น · รูป SKU เป็นหลักอัตโนมัติ · ใบส่งของผู้รับจ้างมีรูปทุกใบไม่มีสวิตช์ซ่อน (Q11)

---

## 11. สิ่งที่ตัดทิ้ง (อย่าเสนอซ้ำโดยไม่มีเหตุใหม่)
- bucket public / URL ถาวร (0105) · re-encode ฝั่ง server ด้วย `sharp` (0105 — จนกว่าจะต้องฝังรูปในอีเมลลูกค้า) · proxy route ผ่าน Next · ช่างอัปโหลดในรอบนี้ (รอ W2b/W1 ที่มี RPC ช่างแยก + rate limit `ipw:`) · link รูป SKU แทน copy · hard delete · ใส่รูปทุกใบในแถบ A5 (มีแค่รูปหลัก — จ3) · บังคับถ่ายรูป (จ4 ①)
