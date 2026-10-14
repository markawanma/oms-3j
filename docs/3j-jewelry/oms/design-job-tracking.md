# Design — ระบบส่งงานตั้งแต่ต้นจนจบ (job tracking) · 12 ต.ค. 69

> architect (Yoda) · สถานะ: **design รอเจ้าของตอบ §8 ก่อนเขียน migration** · ยังไม่มีโค้ด/migration ใดถูกเขียน
> ขอบเขต: ดีล OEM (quote → มัดจำ → ผลิต → ส่งของ → งวดสุดท้าย/ใบเสร็จ) **ต่อกับ** ใบงานผลิตที่เดินผ่านแต่ละขั้นในโรงงาน · ใบผลิตเข้าสต็อก (`/production`) ใช้ตัวติดตามเดียวกัน
> อ่านคู่: `design-production-order.md` · `design-own-production-costing.md` · `marketing/oem-pricing-floor.md` §1.1–1.5 · skill `oem-quote-invariants` · memory `role-single-level`
> 🔴 เอกสารนี้ไม่มีตัวเลขต้นทุน/ราคาจริงโดยตั้งใจ — ตัวเลขอยู่ใน DB เท่านั้น

## 0. โมเดลการทำงานที่เจ้าของเคาะ (12 ต.ค. 69 — ปรับ 2 รอบ ยึดรอบหลัง)

> "list รายการสำหรับปริ้นออกมาเพื่อ track งาน รวมถึงส่งงานด้วย … จะกลับมา update ความคืบหน้าผ่านระบบ"
> "คนทำงานไม่ถนัดใช้คอม แต่ถ้า scan QR code ผ่านมือถือเข้ามา update ได้จะง่ายขึ้นเยอะ · ปกติใช้กระดาษส่งกัน เซ็นชื่อรับส่งงาน … มีกระดาษแปะติดไปกับงานเสมอ"

⇒ **กระดาษยังเป็นหลัก** (ใบงานแปะไปกับงานทุกขั้น มีช่องเซ็นรับ-ส่ง) · **QR บนกระดาษ = ทางอัปเดตหลักของช่าง** (กล้องมือถือปกติ ไม่ลงแอป ไม่มีรหัสผ่าน) · **ออฟฟิศกรอกรายวัน = ทางสำรอง**
ผลต่อการออกแบบ:
- ช่าง **ไม่ใช่ผู้ใช้แอป** (ไม่มี `auth.users`/`shop_member`) — ระบุตัวด้วยตาราง `worker` + PIN (§5.2) · สิทธิ์ในแอปยังชั้นเดียวตาม memory `role-single-level` · ทุก RPC ออฟฟิศรับ `p_actor` (pattern 0132 M4) เป็น audit ไม่ใช่กุญแจ
- QR = token สุ่มยาวผูกใบงาน (ไม่ใช่เลขงาน) เปิด route สาธารณะ `/w/<token>` ที่เห็นเฉพาะข้อมูลผลิตและทำได้แค่ รับ / ส่งต่อ / ถ่ายรูป (§5.5)
- ทุกเหตุการณ์มี **2 เวลา**: `occurred_on` (วันจริง — ช่างผ่าน QR = วันนี้เสมอ · ออฟฟิศย้อนได้ในขอบเขต) กับ `recorded_at` (`clock_timestamp()` แก้ไม่ได้) + ใครทำ (`worker_id` หรือ `actor`) + ช่องทาง
- ยืนยัน **ฝ่ายเดียว** ในระบบ (ผู้รับสแกน "รับงาน") — ลายเซ็นสองฝ่ายยังอยู่บนกระดาษ (§5.1 ข้อ 4)
- เฟสแรกเล็กสุดที่ใช้จริง = พิมพ์ใบงาน A5+QR · รับ/ส่งต่อ · น้ำหนัก · บอร์ด (§7 J1) — ของเสีย/รูป/กรอกรายวัน/ส่งของ ตามมา

## 1. ภาพรวม flow ปลายต่อปลาย — อะไรมีแล้ว / อะไรขาด

```
[OEM ลูกค้า]                                          [ผลิตเข้าสต็อกร้านเอง]
oem_quote (draft→quoted→won) ──┐                      production_order (open)
  oem_quote_item (qty, metal,   │                        production_order_item (qty_planned)
  polish/gem/plating/new_design)│                              │
        │ มัดจำ = oem_receipt_issue(kind=deposit) → won        │
        ▼                                                      ▼
  ┌──────────────── ใหม่: analytics.job (ใบงาน 1 ใบ = 1 source item) ────────────────┐
  │ job_stage[] (ขั้นที่ใบนี้ต้องผ่าน · เลือกตอนสร้าง · ข้ามได้ด้วยเหตุผล)               │
  │ job_event (append-only: ส่ง/รับ/ชั่ง/ของเสีย/ย้อน/รูป · occurred_on + recorded_at)  │
  │ job_batch (แฟลสก์/ถังชุบ รวมหลายใบงาน)  · job_photo (Storage private)                │
  └───────────────┬──────────────────────────────────────────┬──────────────────────────┘
                  │ job done (qty_good/qty_scrap/น้ำหนักสุดท้าย)│
                  ▼                                            ▼
  ใหม่: oem_delivery (ส่งของ · วันที่ · จำนวน · ผู้รับ)     production_order_done (เดิม 0131/0138 💰)
                  │                                            → stock_lot + adjust_stock (ไม่แตะ)
                  ▼                                            (dialog prefill qty_done จาก job.qty_good)
  oem_receipt_issue(kind=final) (เดิม 0084 — ไม่แตะ)
  v_oem_quote.is_fully_paid → ดีลปิด
```

| ช่วง | มีแล้ว (ไม่แตะ) | ขาด (งานนี้) |
|---|---|---|
| รับงาน → ใบเสนอราคา → won | `oem_quote` v2 (0075–0171) · renegotiate สร้างแถวใหม่ผูก `root_quote_id` | — |
| มัดจำ / งวด / ใบเสร็จ | `oem_receipt` (deposit/partial/final) · `v_oem_quote.paid_thb/outstanding_thb/is_fully_paid` · trigger กันแก้ · reissue 5 เงื่อนไข | ด่าน "เริ่มผลิตก่อนมัดจำเข้า" (pricing-floor §8 ข้อ 5) — **ยังไม่มี** |
| ใบงานผลิต / ขั้นตอน / น้ำหนัก / ของเสีย / รูป / กำหนดส่ง | ไม่มีเลย — `oem_quote_item.flask_count/plating_batch_count` เป็น**ประมาณการ**ตอนตีราคา ไม่ใช่ของจริง | ทั้งหมด = หัวใจของ design นี้ (§2) |
| ใบผลิตเข้าสต็อก | `production_order` open→done · done = lot + stock 💰 (0131/0138/0139) · `is_new_design` ต่อ item (0141) | ใบผลิตเดินผ่านขั้นในโรงงานไม่ได้ · `qty_done` กรอกมือตอน done ไม่มีที่มา |
| ส่งของให้ลูกค้า OEM | ไม่มี concept เลย (grep deliver/ship ใน OEM = 0) | `oem_delivery` (§4.3) |
| เศษโลหะ | `metal_scrap_ledger` ถูกอ้างใน 0066/pricing-floor §8.8 แต่ **ไม่มีตารางจริง** | เฟสหลัง (§7 J6) — design นี้เก็บ `scrap_weight_g` ต่อขั้นไว้เป็นต้นทาง |
| audit | `oem_quote_audit` (append-only, `clock_timestamp`) · `crm_audit_log` · `catalog_audit_log` | `job_event` ใช้แบบเดียวกับ `oem_quote_audit` (trigger ห้าม UPDATE/DELETE) |
| รูปภาพ | bucket `product-images` private · jpeg ≤1MB · signed URL 1 ชม. · resize ฝั่ง client (`lib/catalog/image-*`) | bucket `job-photos` ใช้ pipeline เดิม (§2.7) |

**ขั้นตอนจริง (เจ้าของเล่า — ฐานของ `job_stage_def`)**: CAD → ปริ้น 3D → อัดก้อนยาง (3 ขั้นแรกเฉพาะแบบใหม่) → ฉีดเทียน → ติดต้นเทียน → ปั่นปูน/เทปูน/เผา (ต่อแฟลสก์) → หล่อ → ตัดต้นเงิน → แต่ง/ขัด → ฝังพลอย (ถ้ามี) → ชุบ (ถ้ามี) → QC → แพ็ก
ตรงกับ pricing-floor §1.1 ทั้ง 11 แถว ⇒ ก้อนต้นทุน (NRE / ต่อชิ้น / batch) ของแต่ละขั้นรู้อยู่แล้ว ใส่ใน `job_stage_def.cost_block` เพื่อให้รายงาน "ประมาณการ vs จริง" ต่อได้ภายหลัง

## 2. Data model (สคีมา `analytics` · grant `service_role` เท่านั้น · RLS เปิดไม่มี policy แบบ `stock_lot`)

หลัก: **สถานะปัจจุบันอยู่ที่ `job`/`job_stage` (แก้ได้ผ่าน RPC เท่านั้น) · ประวัติอยู่ที่ `job_event` (เขียนแล้วแก้ไม่ได้)** — สองชั้นต้อง reconstruct กันได้ (view `v_job_stage_from_events` ตรวจ drift)

### 2.1 `job_stage_def` — ทะเบียนขั้นตอนต่อร้าน (seed 13 แถวใน migration · แก้ที่ `/jobs/stages` เฟสหลัง)
| คอลัมน์ | ความหมาย |
|---|---|
| `shop_id, code` (PK) | code คงที่: `cad, print3d, mold, wax_inject, wax_tree, invest_burnout, cast, cut_sprue, polish, gem_set, plating, qc, pack` |
| `name_th` · `seq_default int` | ชื่อบนจอ/กระดาษ · ลำดับมาตรฐาน (ใช้บังคับลำดับใน job) |
| `cost_block text check in ('nre','per_piece','batch')` | ตาม pricing-floor §1.1 |
| `batch_kind text null check in ('flask','plating_tank')` | ขั้นที่รวมหลายใบงานได้: `invest_burnout`,`cast` = flask · `plating` = tank |
| `weigh_default boolean` | ขั้นนี้ต้องชั่งไหม (ทับด้วยกฎโลหะ §3 ข้อ 8) |
| `loss_warn_pct numeric(5,2) null` | เกณฑ์เตือนน้ำหนักหาย % — **null = ไม่เตือน** (ตัวเลขรอเจ้าของ §8 Q2) |
| `is_active boolean` | ปิดขั้นที่ไม่ใช้โดยไม่ลบ |

### 2.2 `job` — ใบงาน (1 ใบ = 1 source item · ทุกชิ้นในใบเดินด้วยกัน)
| คอลัมน์ | ความหมาย / ด่าน |
|---|---|
| `id` · `shop_id` · `seq int` · `job_no text generated ('JB-' + lpad(seq,4))` | ตัวนับ `job_counter` แบบ `production_order_counter` (เลขข้ามได้ ไม่ใช่เอกสารภาษี) · unique (shop_id, seq) |
| `source_kind text check in ('oem','production')` | |
| `oem_quote_item_id uuid null → oem_quote_item (restrict)` · `root_quote_id uuid null` | OEM: ผูก item **และ** ดีล — renegotiate สร้างแถว quote/item ใหม่ ใบงานเป็นของดีล ไม่ใช่ของแถวราคา (§9 R1) |
| `production_order_item_id uuid null → production_order_item (restrict)` | ใบผลิตเข้าสต็อก |
| `check ((oem_quote_item_id is null) <> (production_order_item_id is null))` · partial unique บนแต่ละ FK `where status <> 'cancelled'` | 1 item = 1 job (เฟสแรกไม่แบ่ง job — §8 Q8) |
| `product_id uuid null` · `design_label text not null` · `sku_snapshot text` | ป้ายบนกระดาษ — snapshot ตอนสร้าง ไม่ดึงสด |
| `metal text not null check in ('silver','gold','brass')` | คัดลอกจาก item input / `make_spec` ตอนสร้าง · **กำหนดกฎชั่ง** · `metal='product'` ของ 0166 สร้างใบงานไม่ได้ |
| `qty_planned int check (1..100000)` · `qty_good int null` · `qty_scrap int null` | ผลสุดท้ายเขียนตอน `job_done` เท่านั้น |
| `weight_start_g numeric(10,3)` · `weight_final_g numeric(10,3)` | น้ำหนักโลหะตั้งต้น (ตอนหล่อ) / สุทธิตอนปิดงาน — ทศนิยม 3 ตำแหน่งรองรับทอง (§8 Q6) |
| `weigh_required boolean not null` | derive ตอนสร้าง: gold ⇒ true เสมอ (CHECK) · อื่น ⇒ ตาม §8 Q1 |
| `due_date date null` · `status text check in ('open','in_progress','on_hold','done','cancelled')` | `done/cancelled` ปลายทาง (trigger deny mutation แบบ `production_order`) |
| `current_stage_code text null` | denormalize ให้บอร์ด query ถูก — RPC เท่านั้นที่เขียน · view ตรวจ drift |
| `start_gate_note text null` | เหตุผลที่ยอมเริ่มผลิตก่อนมัดจำเข้า (OEM — §3 ข้อ 13) |
| `created_by` · `created_at` · `done_at` · `cancelled_at` · `cancel_reason` · `note` | |

### 2.3 `job_stage` — ขั้นที่ใบงานนี้ต้องผ่าน (สร้างทั้งชุดตอน `job_create` · ลำดับล็อก)
| คอลัมน์ | ความหมาย |
|---|---|
| `id` · `job_id` · `shop_id` (trigger derive จาก job) · `stage_code` · `seq int` | unique (job_id, seq) + unique (job_id, stage_code) · `seq` เรียงตาม `seq_default` (ด่าน RPC + trigger) |
| `status text check in ('pending','received','sent','skipped')` | pending → **received** (ช่างสแกน "รับงาน") → **sent** (ช่างกด "ส่งต่อ" = จบขั้นนี้) · skipped เฉพาะจาก pending + เหตุผล |
| `received_on date` · `sent_on date` · `worker_id uuid null → worker` · `assignee_name text` | วันจริง · ช่างที่ถือ (จาก QR) · ชื่อพิมพ์มือ (ทางสำรองออฟฟิศ) |
| `auto_closed boolean default false` | ขั้นก่อนหน้าถูกปิดอัตโนมัติเพราะช่างขั้นถัดไปสแกน "รับ" ก่อน (§5.1) — ขึ้นเตือนบนบอร์ด |
| `qty_in` · `qty_out` · `qty_scrap` · `scrap_reason text` | ด่าน §3 ข้อ 3 |
| `weight_in_g` · `weight_out_g` · `metal_added_g default 0` · `weight_note text` (numeric(10,3)) | ด่าน §3 ข้อ 2 |
| `scrap_weight_g numeric(10,3) null` | เศษที่เก็บได้ (ก้านต้น/ตัด) — ต้นทางของ `metal_scrap_ledger` ในอนาคต |
| `batch_id uuid null → job_batch` · `due_date date null` · `updated_at` | batch เฉพาะ stage ที่ def มี `batch_kind` · ไม่มี `updated_by` — คนกดอยู่ใน `job_event` |

### 2.4 `job_event` — ประวัติ append-only (ชั้นที่เชื่อถือได้)
`id` · `shop_id` · `job_id` · `job_stage_id null` · `event_type check in ('create','stage_receive','stage_send','stage_skip','stage_reopen','weigh','scrap','batch_join','batch_leave','due_set','hold','resume','photo_add','note','done','cancel','token_issue','token_revoke')` · `occurred_on date not null` · `recorded_at timestamptz default clock_timestamp()` · `actor uuid null` (ผู้ใช้ออฟฟิศ) · `worker_id uuid null` (ช่างผ่าน QR) · `channel check in ('worker_qr','daily_sheet','job_page','rpc')` · `device_hint text` (UA ตัดสั้น + ip hash — ไม่เก็บ ip ดิบ) · `payload jsonb` (before/after · น้ำหนัก · จำนวน · เหตุผล)
- trigger `job_event_append_only` ห้าม UPDATE/DELETE/TRUNCATE (ลอก `oem_quote_audit_append_only` 0165) · `clock_timestamp()` เพราะหลาย event ในทรานแซกชันเดียว (migration-traps ข้อ 22)
- `check (actor is not null or worker_id is not null or event_type in ('create','token_issue'))` — ทุก event มีคนรับผิดชอบ

### 2.5 `worker` — ทะเบียนช่าง (ไม่ใช่ `auth.users` · ไม่แตะ `shop_member`/AUTH_GATE)
`id` · `shop_id` · `display_name` · `stage_codes text[]` (ขั้นที่รับงานได้ — ว่าง = ทุกขั้น) · `pin_hash text` (`crypt(pin, gen_salt('bf'))` ใน pgcrypto — มีใน extensions อยู่แล้ว) · `is_active boolean` · `failed_attempts int` · `locked_until timestamptz` · `created_by` · `created_at` · `deactivated_at`
- เจ้าของ/แอดมินเพิ่ม-ปิด-รีเซ็ต PIN ที่ `/jobs/workers` · ปิดแล้ว **ทุก RPC ของช่างปฏิเสธทันที** (เช็ค `is_active` ทุกครั้ง ไม่เชื่อ cookie)

### 2.6 `job_token` — QR บนกระดาษ
`id` · `shop_id` · `job_id` · `token_hash text unique` (sha256 ของ token สุ่ม 32 bytes · **ไม่เก็บ token ดิบ**) · `issued_at` · `issued_by` · `revoked_at` · `revoke_reason` · `print_no int`
- URL บน QR = `https://<host>/w/<token base64url 43 ตัว>` · พิมพ์ใบงานใหม่ = ออก token ใหม่ **และเพิกถอนตัวเก่าโดยอัตโนมัติ** (ใบหายแล้วคนเก็บได้ใช้ไม่ได้) — เจ้าของเลือกไม่เพิกถอนได้ตอนพิมพ์ (เช่น พิมพ์ 2 ใบติดถุง 2 ใบ)
- token เป็น **กุญแจของใบงานเดียว** ไม่ใช่ session ของแอป: route `/w/*` อ่าน/เขียนได้เฉพาะผ่าน RPC ที่รับ `p_token_hash` และคืน/แก้เฉพาะใบงานนั้น

### 2.7 `job_batch` — แฟลสก์ / ถังชุบ ที่รวมหลายใบงาน
`id` · `shop_id` · `batch_no generated ('FL-'|'PT-' + seq)` · `kind check in ('flask','plating_tank')` · `stage_code` (def ต้องมี `batch_kind` ตรงกัน) · `metal` · `status check in ('open','closed')` · `opened_on` · `closed_on` · `weight_in_g` · `weight_out_g` · `note` · `created_by`
- ใบงานเข้า batch ผ่าน `job_stage.batch_id` (RPC `job_batch_add`/`job_batch_remove` — ออฟฟิศทำ ไม่ใช่ช่าง) · ปิดแล้วเพิ่ม/ถอดไม่ได้
- น้ำหนักถังชุบชั่งระดับ batch ได้ · **แฟลสก์ทอง** ต้องมี `weight_in/out` ต่อ job_stage ด้วย · batch เงินต่อ job เป็นทางเลือก
- ไม่คำนวณ batch cost เฟสนี้ — แค่รู้ "แฟลสก์เดียวมีกี่ใบงาน" พอเทียบกับ `flask_count` ที่ประมาณตอนตีราคา

### 2.8 `oem_delivery` — ส่งของให้ลูกค้า (ระดับดีล)
`id` · `shop_id` · `root_quote_id` · `job_id null` · `delivered_on` · `qty` · `method` · `tracking_ref` · `recipient_name` · `photo_id null` · `note` · `created_by` · `voided_at/void_reason` (ห้าม DELETE — trigger)
- **ไม่แตะ `oem_receipt`/`oem_doc_counter`** — งวดสุดท้ายยังออกด้วย `oem_receipt_issue(kind=final)` มือ · หน้าดีลแค่โชว์ "ส่งครบ/ยังค้าง + outstanding จาก `v_oem_quote`" (invariant §7 ไม่ถูกแตะ)

### 2.9 `job_photo` + bucket `job-photos`
`id` · `shop_id` · `job_id` · `job_stage_id null` · `storage_path` · `bytes` · `taken_on` · `caption` · `uploaded_by null` · `worker_id null` · `created_at`
- bucket **private** · jpeg · ≤1MB · path `<shop_id>/<job_id>/<uuid>.jpg` · signed URL 1 ชม. (ขยาย `lib/catalog/image-signing.ts` ให้รับ bucket) · resize ฝั่ง client ด้วย `lib/catalog/image-client.ts` — ไม่เพิ่ม dependency server (เหตุผลเดียวกับ 0105)
- ช่างถ่ายผ่าน `<input type=file accept=image/* capture=environment>` บนหน้า `/w/` → server action ตรวจ token+worker ก่อนอัปโหลดด้วย service client (ช่างไม่มีสิทธิ์ Storage ตรง)
- เพดาน **20 รูป/ใบงาน** 2 ชั้น (app + trigger แบบ `product_image_enforce_cap`) · quota free tier 1GB ⇒ ~1,000 รูป — ต้องโชว์ที่ใช้ไปบน settings (หนี้ §9)
- แนบทีหลังได้แม้ job done (ข้อยกเว้นเดียวของ "ปิดแล้วแก้ไม่ได้" — รูปคือหลักฐาน · event `photo_add` ยังถูกเขียน)

### 2.10 Views (อ่านฝั่ง server ผ่าน service role เท่านั้น — migration-traps ข้อ 18)
- `v_job_board` — job + ขั้นปัจจุบัน + ช่างที่ถือ + `days_in_stage` + `is_overdue` (`due_date < (now() at time zone 'Asia/Bangkok')::date`) + `last_scan_at` + `is_stale` (ไม่มี event เกิน N วัน) + source (quote_no/po_no) — **ไม่มีคอลัมน์ต้นทุน/ราคา/ชื่อลูกค้า**
- `v_job_stage_loss` — `loss_g = weight_in + metal_added − weight_out − scrap_weight` · `loss_pct` · `warn = loss_pct > loss_warn_pct`
- `v_job_overdue` · `v_job_daily_sheet` (งานที่ `received_on`/`sent_on` = วันที่ ของขั้นนั้น) · `v_job_stage_from_events` (reconstruct จาก event เทียบ `job_stage` — ตรวจ drift) · `v_production_order_job_mismatch` (`qty_done` ≠ `job.qty_good`)

## 3. กติกาที่ DB ต้องบังคับ — เคสห้ามผ่าน + ด่านที่จับ

ทุก RPC: `security definer` · pin `search_path` · revoke `public, anon, authenticated` (ข้อ 18.1) · `for update` แถว job ก่อนแตะ stage · ตัวเลขทุกช่อง `not (x between a and b)` กัน NaN (ข้อ 4) · วันที่ไทย `(now() at time zone 'Asia/Bangkok')::date` ห้าม `current_date` (ข้อ 6)
RPC ฝั่งออฟฟิศ: `crm_require_owner_admin` + `p_actor` จาก session · **RPC ฝั่งช่าง (`job_worker_*`)**: รับ `p_token_hash` + `p_worker_id` + `p_pin`/`p_worker_session` — ไม่มี `auth.uid()` และห้ามข้ามไปใช้ RPC ฝั่งออฟฟิศ

| # | เคสที่ต้องถูกปฏิเสธ | ด่าน |
|---|---|---|
| 1 | รับงาน (`stage_receive`) ขั้น seq N ขณะขั้น seq < N ยัง `pending` (ยังไม่มีใครรับ/ข้าม) | RPC + trigger BEFORE UPDATE บน `job_stage` (กัน service key เขียนตรง) · ขั้น N−1 ที่ `received` แต่ยังไม่ `sent` → **ปิดอัตโนมัติ** `auto_closed=true` (§5.1) ยกเว้นทอง = ปฏิเสธ (ต้องกด "ส่งต่อ" พร้อมน้ำหนักออกก่อน) |
| 2 | `weight_out_g > weight_in_g + metal_added_g` · `metal_added_g > 0` ไม่มี `weight_note` · น้ำหนัก ≤ 0/NaN/> 100,000 g | CHECK บน `job_stage` + RPC ข้อความอ่านรู้เรื่อง (ไม่มี UUID ในข้อความ — บทเรียน 0139) |
| 3 | `qty_out + qty_scrap ≠ qty_in` · `qty_scrap > 0` ไม่มี `scrap_reason` (ผ่าน `oem_note_present` หรือ code จากชุดที่กำหนด) · `qty_in` ขั้นแรก ≠ `qty_planned` · `qty_in` ขั้น N ≠ `qty_out` ของขั้นก่อนหน้าที่ไม่ถูก skip | CHECK + RPC — ของหาย = scrap เหตุผล `missing` ไม่มีช่อง "หายเฉยๆ" |
| 4 | ย้อนขั้น (`stage_reopen`) ไม่มีเหตุผล · ย้อนข้ามขั้นที่มีขั้นถัดไป `received/sent` อยู่ · **ช่างย้อนขั้นผ่าน QR** | RPC ออฟฟิศเท่านั้น · ถอยทีละขั้นจากล่าสุด · ค่าเก่าเก็บใน `job_event.payload.before` |
| 5 | UPDATE/DELETE/TRUNCATE `job_event` ทุกกรณี (รวม owner/service_role) | trigger append-only (แบบ 0165) |
| 6 | แก้ `job`/`job_stage`/`job_batch` เมื่อ `job.status in ('done','cancelled')` · DELETE `job` ทุกกรณี | trigger deny_mutation (ลอก `production_order_deny_mutation`) · ยกเว้น `job_photo` insert (§2.9) |
| 7 | ข้ามร้าน: stage/event/photo/batch/token ที่ `shop_id` ไม่ตรง job · job ผูก item ของร้านอื่น · batch รวม job คนละร้าน/โลหะ/stage · worker ร้านอื่นสแกน token | `shop_id` derive ด้วย trigger จาก parent + RPC เทียบ `worker.shop_id = job.shop_id` |
| 8 | **ทอง**: `stage_send` โดยไม่มี `weight_out_g` และ `stage_receive` โดยไม่มี `weight_in_g` ทุกขั้นตั้งแต่ `cast` ถึง `pack` · ทอง `weigh_required=false` · ทอง auto_close | RPC + CHECK `(metal <> 'gold' or weigh_required)` · เงิน/ทองเหลือง: บังคับเฉพาะขั้น `weigh_default=true` (เสนอ cast/cut_sprue/polish) — รอ §8 Q1 |
| 9 | `occurred_on` > วันนี้ (ไทย) หรือ < วันนี้ − 14 · `sent_on < received_on` ขั้นเดียวกัน · `received_on` ขั้น N < `sent_on` ขั้น N−1 | RPC · ช่างผ่าน QR: `occurred_on` = วันนี้เสมอ (ย้อนได้เฉพาะออฟฟิศ) · 14 = ค่าเริ่ม รอ §8 Q3 |
| 10 | `job_done` ขณะมีขั้น `pending/received` · `qty_good + qty_scrap ≠ qty_planned` · ทองไม่มี `weight_final_g` | RPC `job_done` (ออฟฟิศ) |
| 11 | สร้าง job จาก quote item ที่ quote ไม่ใช่ `won` · จาก production item ที่ใบไม่ใช่ `open` · item มี job (ไม่ cancelled) อยู่แล้ว · item `metal='product'` | RPC + partial unique index |
| 12 | stage list มี code `is_active=false` · เรียงไม่ตาม `seq_default` · ว่าง · ไม่มี `qc`,`pack` · มี `cad/print3d/mold` ทั้งที่ item ไม่ใช่แบบใหม่ (เตือน ไม่ปฏิเสธ) | RPC `job_create` |
| 13 | **OEM**: `stage_receive` ขั้นแรก ขณะ `v_oem_quote.paid_thb = 0` ของดีล โดยไม่มี `start_gate_note` | RPC (ด่านอ่อนแบบ 0168 — ออฟฟิศต้องใส่ note ก่อนพิมพ์ใบงาน · ช่างสแกนแล้วเจอ "รอมัดจำ" ทำอะไรไม่ได้) — รอ §8 Q4 |
| 14 | batch ปิดแล้วเพิ่ม/ถอด · job เข้า batch ซ้ำขั้นเดียว · ชั่ง batch ติดลบ | RPC + unique บน `job_stage.batch_id` ต่อ stage |
| 15 | หน้ากรอกรายวันส่ง 30 แถว แถวที่ 17 ผิด — ต้องไม่บันทึก 16 แถวแรก | RPC `job_daily_update(jsonb[])` ทรานแซกชันเดียว · error ระบุแถว |
| 16 | **token**: token ไม่มี/เพิกถอน/ของ job ที่ done-cancelled · token ถูกใช้กับ job อื่น · token เดารูปแบบ (`JB-0001`) · ส่ง token ดิบมาเทียบ (ต้อง hash ฝั่ง server ก่อนเสมอ) | RPC `job_worker_resolve(p_token_hash)` คืน job เดียว · ไม่มี list endpoint |
| 17 | **worker**: PIN ผิดเกิน 5 ครั้ง/15 นาที · worker `is_active=false` · worker ไม่มี `stage_code` นี้ใน `stage_codes` · cookie session ของ worker ที่ถูกปิดหลังออก cookie · session หมดอายุ (12 ชม.) | RPC `worker_pin_verify` (lock ใน DB ไม่ใช่ใน memory) · ทุก `job_worker_*` เช็ค `is_active` สด |
| 18 | ช่างทำ action ของขั้นที่ไม่ใช่ขั้นปัจจุบัน/ถัดไป · ช่างกด "ส่งต่อ" ขั้นที่ตัวเองไม่ได้ "รับ" (worker_id ไม่ตรง — ยกเว้นออฟฟิศ) | RPC ฝั่งช่างรับแค่ 3 action: receive / send / photo — ไม่มี parameter เลือกขั้นเอง |
| 19 | anon/authenticated เรียก RPC/อ่าน view ผ่าน REST · route `/w/` ถูกใช้เข้า `/jobs`, `/oem`, อื่นๆ | revoke 3 ชื่อ + `scripts/check-analytics-grants.sql` · middleware exempt **เฉพาะ prefix `/w/`** และหน้า `/w/` ไม่มีลิงก์ภายในแอป |
| 20 | หน้า `/w/` streamed payload มี `cost_*`, `price_*`, `margin`, `customer_*`, `quote_no` | type `WorkerJobView` ประกอบทีละ field (แบบ `PrintableQuote`) · เทสต์ยิงหน้าจริงแล้ว grep ค่าต้นทุนจาก DB (invariant ข้อ 1) |

**เคสที่ต้องไม่พัง** (ทดสอบเท่าเคสปฏิเสธ): job เงินไม่ชั่งเลยเดินจนจบได้ · job ข้าม gem_set/plating/3 ขั้น NRE · reopen แล้วเดินใหม่ · ออฟฟิศกรอกย้อน 3 วันลำดับสลับ · 2 มือถือสแกน "รับ" ขั้นเดียวกันพร้อมกัน (row lock → ตัวหลังเห็น received → ตอบ "รับแล้วโดย X" ไม่ raise) · ช่างคนเดียวทำ 2 ขั้นติดกัน (ขัดแล้วฝังเอง) · มือถือใช้ร่วมกัน สลับช่างด้วย PIN · พิมพ์ใบงานซ้ำแล้ว QR ใหม่ใช้ได้/เก่าใช้ไม่ได้ · `production_order_done` ของใบที่ **ไม่มี** job ทำงานเหมือนเดิม · quote ทุกสถานะที่มีจริง (`OEM-2610-004`) เปิดหน้าเดิมได้ · AUTH_GATE=on แล้ว `/w/<token>` ยังเปิดได้โดยไม่ login · token ถูกต้องแต่ไม่มี worker session → เห็นแค่เลขงาน+ขั้น ไม่เห็นปุ่ม

## 4. การเชื่อมกับของเดิม (แตะไฟล์/ฟังก์ชันเดิมให้น้อยที่สุด)

### 4.1 ใบเสนอราคา won → ใบงาน
- ปุ่ม "สร้างใบงาน" บน `/oem/quotes/[id]` เมื่อ `status='won'` → `job_create_from_quote_item(p_quote_item_id, p_stage_codes[], p_due_date, p_actor)` — 1 item = 1 job · ใบมีหลาย item = สร้างทีละ item หรือ "สร้างทุกรายการ" (loop ในทรานแซกชันเดียว)
- RPC อ่านจาก `oem_quote_item.input` เฉพาะ: metal · qty · `is_new_design` (เสนอ stage list: มี cad/print3d/mold เฉพาะแบบใหม่) · มีพลอย/ชุบ (เสนอ gem_set/plating) — **ไม่คัดลอก calc/cost/price ใดๆ** ลง job
- `root_quote_id` ของ job = ดีล · ถ้าต่อราคาหลังมี job: quote item ใหม่ถูกสร้าง — job เดิมยังชี้ item เก่า (restrict ลบไม่ได้อยู่แล้วเพราะ superseded ไม่ลบแถว) · `v_job_board` join ผ่าน `root_quote_id` ไปแถว quote ที่ active จึงเห็นเลขใบล่าสุด (§9 R1)
- **ไม่แก้** `oem_quote_save/renegotiate/set_status/receipt_issue` แม้บรรทัดเดียว (golden replay 0140 + invariants) — ด่านมัดจำ (§3 ข้อ 13) อ่าน `v_oem_quote.paid_thb` อย่างเดียว

### 4.2 ใบผลิตเข้าสต็อก → ใบงาน → done (ต้นทุน + สต็อก เดิม)
- ปุ่ม "สร้างใบงาน" บน `/production/[id]` (ใบ `open`) ต่อ item · metal จาก `product.make_spec->>'metal'` หรือ `silver` เมื่อ `cost_type in ('fixed','spot')` (SKU เงินทั้งหมดวันนี้)
- **`production_order_done` ไม่ถูกแก้** — ยังเป็นด่าน 💰 เดียวที่แตะ `stock_lot`/`adjust_stock`/ต้นทุน · `ProductionDoneDialog` prefill `qty_done` จาก `job.qty_good` เมื่อ job done (แก้ได้ แต่ถ้าต่างกัน `v_production_order_job_mismatch` โผล่บน `/stock`) · job ที่ยังไม่ done ⇒ dialog เตือน "ใบงาน JB-xxxx ยังอยู่ขั้น …" ไม่บล็อก (เจ้าของยังต้องปิดใบที่ไม่ใช้ job ได้)
- ของเสียจริงต่อขั้น (`job_stage.qty_scrap`) = ข้อ 7 ของ pricing-floor §8 ("`actual_reject_qty` ต่อ job แยกตามขั้น") — เทียบกับ `reject_rate` ที่ใช้ตีราคาได้ในรายงาน §6 ไม่ป้อนกลับเข้า rate อัตโนมัติ

### 4.3 งานเสร็จ → ส่งของ → งวดสุดท้าย/ใบเสร็จ
- `oem_delivery_add(root_quote_id, job_id, delivered_on, qty, ...)` บนหน้าดีล · แถบสถานะดีล: `ส่งแล้ว x/y ชิ้น` + `outstanding_thb` (จาก `v_oem_quote` — ไม่คำนวณใหม่) + ปุ่มเดิม "ออกใบเสร็จ" (`ReceiptIssueDialog` kind=final)
- **ไม่มี auto-issue ใบเสร็จ** เมื่อส่งของ — เอกสารภาษีต้องมีคนกดและวันรับเงินจริง (invariant §7) · ไม่มีด่าน "ส่งของก่อนเก็บครบ" (นโยบายขายตัดสินเอง — บอร์ดโชว์เตือนพอ)

### 4.4 เศษโลหะ
`metal_scrap_ledger` ยังไม่มีจริง — design นี้สะสม `job_stage.scrap_weight_g` ต่อขั้น/โลหะ แล้ว view `v_job_scrap_by_metal` รวมต่อเดือน · ตาราง ledger (ส่งหลอม/ได้คืน) = เฟส J6 คนละ migration

## 5. ใครกดอัปเดต — โมเดล "กระดาษเป็นหลัก · QR เป็นทางอัปเดตหลักของช่าง · ออฟฟิศเป็นทางสำรอง"

### 5.1 การไหลของ 1 ขั้น (ช่าง)
1. ช่างได้ถุงงาน + ใบงาน (A5) → สแกน QR ด้วยกล้องมือถือ → `/w/<token>` → ถ้ายังไม่ระบุตัว: เลือกชื่อ (ปุ่มใหญ่ กรองตามขั้นที่ทำได้) + PIN 4 หลัก → จำในเครื่อง 12 ชม.
2. หน้าเดียว: เลขงาน · รูปแบบ · จำนวน · โลหะ · **ขั้นถัดไปที่ต้องทำ** · ปุ่มใหญ่ปุ่มเดียว **"รับงาน"** (+ช่องน้ำหนักเข้า ถ้าขั้นนี้ต้องชั่ง) → เสร็จ ≤ 10 วินาที
3. ทำงานเสร็จ → สแกนอีกครั้ง → ปุ่มเดียว **"ส่งต่อ"** (+น้ำหนักออก · ของเสีย +/− · เหตุผลเป็นปุ่มเลือก · ถ่ายรูปไม่บังคับ) → ระบบปิดขั้นนี้ ขั้นถัดไปรอ "รับ" · เซ็นกระดาษตามเดิม
4. **ยืนยันฝ่ายเดียวพอ**: event สำคัญคือ "รับ" ของคนถัดไป (ของอยู่ในมือคนที่สแกน = หลักฐานกว่าคนส่งกด) · ถ้าคนส่งลืมกด "ส่งต่อ" ระบบปิดขั้นก่อนหน้าให้ `auto_closed=true` (น้ำหนักออกว่าง → บอร์ดเตือน · ทองห้าม auto_close §3 ข้อ 1/8) — เหตุผล: บังคับสองฝ่ายกดทุกขั้น = 2 เท่าของการสแกน แล้วช่างจะเลิกใช้ กลับไปกระดาษล้วน
5. ไม่มีเน็ต: หน้า `/w/` เบา (ไม่มีรูปจนกว่าจะกดดู · < 50KB) · **ไม่ทำ offline queue เฟสนี้** — สแกน QR ต้องโหลดหน้าอยู่แล้ว การเก็บคิวต้อง service worker + ตีกันเรื่องลำดับขั้น (ข้อ 1) และกระดาษคือ fallback ที่มีอยู่แล้ว (ออฟฟิศกรอกตาม §5.4) · ประเมินใหม่เมื่อเห็นอัตราล้มเหลวจริงใน `job_event.channel`

### 5.2 ระบุตัวช่างโดยไม่ต้องจำรหัสผ่าน — ทางเลือกและคำแนะนำ
| ทาง | ข้อดี | ข้อเสีย | มือถือใช้ร่วม/เปลี่ยนเครื่อง |
|---|---|---|---|
| (ก) บัตร QR ประจำตัว สแกนครั้งแรกจำในเครื่อง | ไม่ต้องจำอะไร · เร็วสุด | บัตรหาย = ใครก็เป็นคนนั้นได้จนกว่าจะเพิกถอน · ต้องพิมพ์/แจกบัตร | ❌ เครื่องร่วม = คนสุดท้ายที่สแกน · สลับต้องพกบัตร |
| **(ข) เลือกชื่อ + PIN 4 หลัก** | ไม่มีของต้องพก · สลับคนบนเครื่องเดียวได้ · แอดมินรีเซ็ตได้ · ไม่มีค่าใช้จ่าย | PIN บอกต่อกันได้ (ยอมรับ — audit บอกชื่อ ไม่ใช่กุญแจเงิน) · ต้อง lockout | ✅ เครื่องร่วมได้ · เปลี่ยนเครื่องแค่ใส่ PIN ใหม่ |
| (ค) เบอร์โทร + OTP | ยืนยันตัวแรงสุด | ค่า SMS ต่อครั้ง · สัญญาณในโรงงาน · ช่างต้องมีเบอร์ตัวเอง · ช้ากว่า 30 วินาทีแน่ | ❌ ผูกเบอร์ ไม่ผูกเครื่อง แต่เสียเวลาทุกครั้ง |
**แนะนำ (ข)** · เก็บ (ก) ไว้เป็นทางลัดเพิ่มทีหลังได้โดยไม่รื้อ (`worker_card_token` อีกตาราง) · ค่าตั้ง: session 12 ชม. · lock 15 นาทีหลังผิด 5 ครั้ง (นับใน DB) · PIN ตั้งโดยแอดมินตอนเพิ่มช่าง แสดงครั้งเดียว

### 5.3 ออฟฟิศ (owner/admin คนเดิม — ไม่มี role ใหม่)
สร้างใบงาน · พิมพ์ · ตั้งกำหนดส่ง · ข้าม/ย้อนขั้น · batch · กรอกย้อนหลังจากกระดาษ (`/jobs/daily`) · ปิดงาน · ยกเลิก · จัดการช่าง/PIN · ทุกอย่างผ่าน `requireWriteAccess` + `p_actor` เดิม · `assignee_name` พิมพ์มือใช้เมื่อช่างไม่ได้สแกน

### 5.4 ถ้าวันหน้าอยากให้ช่าง login เป็นผู้ใช้แอปจริง
ต้องเพิ่ม: บัญชี `auth.users` + `shop_member role=staff` ต่อคน · ด่านสิทธิ์ที่ RPC (วันนี้ `requireWriteAccess` บล็อก staff ทั้งก้อน) · หน้าช่างแยกที่ไม่มีต้นทุน (มีแล้วคือ `/w/`) ⇒ โครงนี้รองรับโดยเปลี่ยนแค่ "วิธีได้ `worker_id`" (จาก PIN → จาก session) ไม่ต้องรื้อตาราง

### 5.5 Security ของช่องทาง `/w/` (ช่องทางใหม่ที่คนนอกระบบเข้าถึงได้ — ต้อง security ผ่านก่อน merge)
- **middleware**: เพิ่ม exempt **prefix `/w/`** (วันนี้ exempt เป็น exact path — ต้องขยาย `lib/auth/exempt-path.ts` ให้รองรับ prefix เฉพาะตัวนี้ + เทสต์ว่า `/w/../jobs` ไม่หลุด) · `/w/` ไม่ใช้ `getSessionUser` · ไม่มี nav/ลิงก์ไปหน้าอื่น
- **token**: 32 bytes จาก `gen_random_bytes` → base64url ใน URL · DB เก็บ `sha256` เท่านั้น · server action hash ก่อน query ทุกครั้ง · เพิกถอนทันทีเมื่อพิมพ์ใหม่/ job done+30 วัน/ ออฟฟิศกด · ไม่มี endpoint list token · log การ resolve ล้มเหลวเป็น `job_event`? **ไม่** — เขียนลง `worker_rate_limit` แทน กัน event table บวมจากการยิงสุ่ม
- **rate limit** (ไม่เพิ่ม dependency): ตาราง `analytics.worker_rate_limit(key text, window_start, hits)` key = `ip_hash` และ `token_hash` · เพดาน 60 ครั้ง/10 นาที ต่อ key · ตรวจใน RPC ก่อนทำงานจริง · ล้างด้วย cron ของ Supabase (`pg_cron` มีไหมต้องเช็ค — ไม่มีก็ลบใน RPC เดียวกันแบบ opportunistic)
- **worker session cookie**: `w_session` = HMAC-SHA256(`worker_id|exp`, secret env `WORKER_SESSION_SECRET` ≥32 ตัว — แบบ `GEM_QUIZ_TOKEN_SECRET`) · `HttpOnly; SameSite=Lax; Secure` · path `/w` · ทุก RPC เช็ค `worker.is_active` สด → ปิดช่างแล้วหลุดทันทีแม้ cookie ยังไม่หมด
- **ขอบเขตข้อมูล**: `job_worker_resolve` คืน `WorkerJobView` = {job_no, design_label, sku_snapshot, metal, qty_planned, stage list (code,name,status,received_on,sent_on,worker_name), current stage, due_date, primary photo path} — **ไม่มี** ราคา/ต้นทุน/margin/ชื่อลูกค้า/quote_no/po_no · ทดสอบแบบ invariant ข้อ 1: ยิงหน้า `/w/<token>` จริง แล้ว grep ค่าต้นทุนและชื่อลูกค้าจาก DB ใน HTML + RSC payload
- **action ที่ช่างทำได้**: `job_worker_receive` · `job_worker_send` · `job_worker_photo_add` — 3 ตัว · ไม่มี reopen/skip/done/cancel/due · RPC คำนวณเองว่าขั้นไหน ไม่รับ `stage_code` จาก client
- **audit**: ทุก event ช่างมี `worker_id` + `channel='worker_qr'` + `device_hint` (UA ตัด 80 ตัว + sha256(ip) 8 ตัวแรก) · ไม่เก็บ ip ดิบ (PDPA — ช่างเป็นบุคคล)
- **grant**: ตารางใหม่ทั้งหมดใน `analytics` → `service_role` เท่านั้น · หน้า `/w/` อ่านผ่าน service client ฝั่ง server เหมือนทุกหน้า (ข้อ 18) · รันด่าน `scripts/check-analytics-grants.sql` หลัง apply

## 6. หน้าจอ + กระดาษ (ระดับรายการหน้า — ux-ui ทำ wireframe ต่อ)

### 6.1 กระดาษ (พิมพ์จากแอป · render HTML `@media print` แบบหน้าใบเสนอราคา · ไม่ต้องใช้ PDF lib)
| ใบ | ขนาด | เนื้อหา |
|---|---|---|
| **ใบงาน (traveler)** `/jobs/[id]/print` | **A5 แนวตั้ง** (ครึ่ง A4 ใส่ซองพลาสติกติดถุงงาน — A4 ใหญ่เกินถุง · สติกเกอร์เล็กเกินจะมีตารางเซ็น) · ตัวเลือก A4 = 2 ใบ/หน้า | QR ≥ 35 mm มุมบน + เลขงานตัวใหญ่ · รูปแบบ (ถ้ามี) · จำนวน · โลหะ · น้ำหนักตั้งต้น (ช่องว่างให้เขียน) · กำหนดส่ง · ตาราง 1 แถว/ขั้นที่ต้องผ่าน: ขั้น / วันรับ / ผู้รับเซ็น / นน.เข้า / วันส่ง / นน.ออก / เสีย / ผู้ส่งเซ็น · ช่องหมายเหตุ · **ไม่มี ราคา/ต้นทุน/ชื่อลูกค้า** (OEM โชว์แค่ "งานลูกค้า") |
| **ใบส่งงานรายวัน/รายแผนก** `/jobs/handoff/print?date&stage` | A4 | รายการงานที่ส่งเข้าขั้นนั้นวันนั้น (เลขงาน · แบบ · จำนวน · นน.) · ช่องเซ็นรับเป็นชุด · ใช้กับแผนกที่รับทีละหลายถุง (หล่อ/ชุบ) |
| **สติกเกอร์ QR** (เฟสหลัง) | 50×30 mm | เลขงาน + QR อย่างเดียว ติดถุงเล็ก — ต้องรู้ก่อนว่าร้านมีเครื่องพิมพ์สติกเกอร์ไหม (§8 Q9) |
QR = SVG สร้างฝั่ง server — ต้องเพิ่ม dependency 1 ตัว (`qrcode` หรือ `uqr`) → ให้ security เช็ค supply chain ก่อน · ทางเลือกไม่เพิ่ม dep = เขียน QR encoder เอง (ไม่คุ้ม)

### 6.2 หน้าช่าง `/w/[token]` (มือถือ · ไม่ login · ไทยล้วน · ฟอนต์ ≥ 18px · ปุ่มสูง ≥ 56px)
1. **ระบุตัว** (ครั้งแรก/หมดอายุ): รายชื่อช่างเป็นปุ่มใหญ่ (กรองตามขั้นถัดไปของงานนี้) → แป้น PIN 4 หลัก · "ไม่ใช่คุณ? เปลี่ยน" อยู่ทุกหน้า
2. **หน้างาน**: เลขงาน · รูป (แตะเพื่อดู) · แบบ · จำนวน · โลหะ · แถบขั้น (ผ่านแล้ว/ปัจจุบัน/ถัดไป) · **ปุ่มหลักปุ่มเดียว** ตามสถานะ: `รับงาน` / `ส่งต่อ` / `รอมัดจำ` (OEM §3 ข้อ 13) / `งานปิดแล้ว`
3. **รับงาน**: ช่องน้ำหนักเข้า (`inputmode=decimal` ตัวเลขใหญ่ · แสดง "ครั้งก่อนส่งออก X g" ให้เทียบ) → ยืนยัน → หน้าติ๊กถูกเต็มจอ 2 วินาที
4. **ส่งต่อ**: น้ำหนักออก · ของเสีย +/− (เริ่ม 0) · ถ้า > 0 เลือกเหตุผลเป็นชิป (รูพรุน/หัก/ผิดแบบ/หาย/อื่นๆ) · ปุ่มถ่ายรูป (ไม่บังคับ) · ยืนยัน · ขั้นถัดไปโชว์ชื่อไว้บอกว่าส่งให้ใคร
5. ข้อผิดพลาดเป็นภาษาคน ("น้ำหนักออกมากกว่าเข้า 0.4 g — ถ้าเติมโลหะให้แตะ 'เติมโลหะ'") · ไม่มีช่องพิมพ์ข้อความบังคับที่ใดเลย

### 6.3 หน้าออฟฟิศ (ใต้ section ใหม่ `/jobs` · เมนู "ใบงาน" แยกจาก OEM/ผลิตเอง เหมือนที่ `/production` แยกมา)
| หน้า | ต้องเห็น |
|---|---|
| `/jobs` **บอร์ด** (kanban คอลัมน์ = ขั้นจาก `job_stage_def` ที่ active · แถว = การ์ดใบงาน) | เลขงาน · แบบ · จำนวน · โลหะ · **ชื่อช่างที่ถือ** · วันในขั้นนี้ · ป้าย: เลยกำหนด (แดง) / ไม่มีสแกนเกิน N วัน (ส้ม) / ขั้นก่อนปิดอัตโนมัติ (เทา) / รอมัดจำ · กรอง: โลหะ · แหล่ง (OEM/ผลิตเอง) · ช่าง · เฉพาะเลยกำหนด · refresh ทุก 30 วิ (polling — ไม่ใช้ Supabase Realtime เพราะสคีมา analytics ปิด REST และ publication ต้องเปิด table ให้ client ซึ่งขัดข้อ 18) · มุมมองรายการ (ตาราง) สลับได้ |
| `/jobs/[id]` **หน้าใบงาน** | หัว: เลขงาน · แหล่ง (ลิงก์ไป quote/PO — เฉพาะออฟฟิศ) · due · สถานะ · timeline ขั้น (รับ/ส่ง/ช่าง/นน.เข้า-ออก/หาย g และ %/ของเสีย) · ตารางน้ำหนักสะสม · รูปตามขั้น · event log เต็ม (occurred_on vs recorded_at · channel · ช่าง/ผู้ใช้) · ปุ่ม: พิมพ์ใบงาน (ออก token ใหม่ + เตือนว่าใบเก่าจะใช้ไม่ได้) · ตั้งกำหนด · ข้าม/ย้อนขั้น (เหตุผลบังคับ) · batch · พัก/ต่อ · ปิดงาน (กรอก qty_good/scrap/นน.สุดท้าย) · ยกเลิก |
| `/jobs/daily` **กรอกจากกระดาษ** (ทางสำรอง) | เลือกวันที่ + ขั้น (+ช่าง) → รายการงานที่อยู่ก่อนขั้นนั้น/ในขั้นนั้น → ติ๊ก "รับ"/"ส่ง" ต่อแถว + ช่อง นน.เข้า/ออก/เสีย/ชื่อช่าง → **บันทึกทีเดียว** (all-or-nothing · error ชี้แถว) · ใช้บนมือถือได้ (แถวสูง · input ตัวเลข) |
| `/jobs/handoff` | เลือกวัน+ขั้น → รายการ + ปุ่มพิมพ์ใบส่งงานรายวัน (§6.1) |
| `/jobs/batches` · `/jobs/batches/[id]` | เปิดแฟลสก์/ถังชุบ · ลากใบงานเข้า · ชั่งรวม · ปิด |
| `/jobs/workers` | เพิ่ม/ปิดช่าง · ขั้นที่ทำได้ · รีเซ็ต PIN (แสดงครั้งเดียว) · เครื่องที่ล็อกอินอยู่ (นับจาก event) |
| `/jobs/stages` (เฟสหลัง) | เปิด/ปิดขั้น · ชื่อ · เกณฑ์เตือน loss % |
| `/jobs/reports` | **น้ำหนักหายต่อขั้นต่อโลหะ** (g และ % · เดือนนี้/ย้อนหลัง · ต่อช่าง) · **ของเสียต่อขั้น** เทียบ reject rate ที่ใช้ตีราคา (ไม่โชว์ราคา) · งานเลยกำหนด/ค้างนาน · เวลาเฉลี่ยต่อขั้น · เศษที่เก็บได้ต่อโลหะ |
| ปุ่มบนหน้าเดิม | `/oem/quotes/[id]` (won): "สร้างใบงาน" + แถบสถานะงาน/ส่งของ/ค้างชำระ · `/production/[id]` (open): "สร้างใบงาน" + สถานะ · `ProductionDoneDialog` prefill (§4.2) |

### 6.4 เตือนเลยกำหนด
- ชั้นที่ 1 (เฟสแรก): ป้ายบนบอร์ด + การ์ดนับ "เลยกำหนด n / ครบใน 3 วัน m / ไม่สแกนเกิน N วัน k" บน `/jobs` และ dashboard หลัก
- ชั้นที่ 2 (เฟสหลัง): LINE ทุกเช้า 1 ข้อความ — ต่อกับข้อเสนอ P3b ใน `system-flow-2026-09.md` §2 (ช่องทางเดียวกับสต็อกใกล้หมด · ยังรอของจากเจ้าของ)
- **ไม่ส่งถึงลูกค้า** (§8 Q5)

## 7. แผน phase (ส่งมอบใช้ได้ทีละช่วง · ระดับ QA ตาม `3j-qa-regression-map` · security = ก่อน merge)

| เฟส | ส่งมอบ | ขนาด | QA / security |
|---|---|---|---|
| **J0** | เจ้าของตอบ §8 · ux-ui ร่างหน้า `/w/` + ใบงาน A5 (ให้ช่างจริงดู 1 คนก่อนเขียนโค้ด) | S | — |
| **J1 เล็กสุดที่ใช้จริงได้** | migration `0172`: `job_stage_def` (seed 13) · `job` · `job_stage` · `job_event` · `worker` · `job_token` · `worker_rate_limit` · counter · trigger (append-only/deny/derive shop) · RPC: `job_create_from_quote_item` · `job_create_from_production_item` · `job_token_issue/revoke` · `worker_upsert/deactivate/pin_set/pin_verify` · `job_worker_resolve/receive/send` · `job_stage_skip/reopen` · `job_set_due` · `job_done` · `job_cancel` · view `v_job_board`/`v_job_stage_loss`/`v_job_stage_from_events` · verify `scripts/verify/verify-0172.sql` (do-block rollback · ตารางแมปบรีฟ→เทสต์) · **หน้า**: `/jobs` บอร์ด · `/jobs/[id]` · `/jobs/[id]/print` (A5+QR) · `/w/[token]` (ระบุตัว+รับ+ส่ง+น้ำหนัก) · `/jobs/workers` · ปุ่มสร้างใบงานบน quote/PO · middleware exempt `/w/` | **L** (backend 1 migration ใหญ่ + frontend 6 หน้า — แตกเป็น J1a backend → security → J1b frontend) | QA **L** (แตะ `/oem/quotes/[id]`, `/production/[id]`, middleware) · **security บังคับ** (ช่องทางสาธารณะใหม่ + สคีมา analytics ใหม่) · ไม่ใช่ 💰 เพราะไม่แตะเงิน/สต็อก/เอกสารภาษี — แต่ด่านข้อ 13 อ่าน `v_oem_quote` จึงให้ security ดู boundary ด้วย |
| **J2** | ของเสีย (+/− · เหตุผล) · รูปถ่าย (bucket `job-photos` + `job_photo` + upload จาก `/w/` และ `/jobs/[id]`) · `ProductionDoneDialog` prefill + `v_production_order_job_mismatch` | M | QA M · security (Storage policy + upload path) |
| **J3** | `/jobs/daily` (กรอกจากกระดาษ all-or-nothing) · `/jobs/handoff` + ใบส่งงานรายวัน · `job_batch` 2 หน้า | M | QA M |
| **J4** | `oem_delivery` + แถบสถานะดีล (ส่งแล้ว/ค้างชำระ) · ปุ่มไปออกใบเสร็จงวดสุดท้าย (ของเดิม) | S–M | QA M · **security 💰** (อยู่ติดหน้าเอกสารภาษี — พิสูจน์ว่าไม่แตะ `oem_receipt`/counter และไม่คำนวณเงินใหม่) |
| **J5** | `/jobs/reports` (loss/scrap/เวลา/ค้าง) · `/jobs/stages` · เตือน LINE (ถ้า P3b มีของแล้ว) | M | QA M |
| **J6** | `metal_scrap_ledger` (ส่งหลอม/ได้คืน) จาก `scrap_weight_g` · บัตร QR ช่าง (ทาง ก) ถ้าเจ้าของอยากได้ · สติกเกอร์ QR | M | QA M · security (ledger แตะมูลค่าโลหะ) |

เหตุผลที่ J1 ใส่ "น้ำหนัก" แต่ยังไม่ใส่ "ของเสีย/รูป": เจ้าของบอกน้ำหนักสำคัญมากกับทอง และกฎทองบังคับชั่งทุกขั้น (§3 ข้อ 8) — ถ้า J1 ไม่มีน้ำหนัก จะมีช่วงที่ event ทองถูกเขียนโดยไม่มีน้ำหนักแล้วย้อนเติมไม่ได้ (append-only) · ของเสีย/รูปเติมทีหลังได้โดยไม่ทำให้ประวัติเก่าผิดความหมาย

## 8. คำถามถึงเจ้าของ (เฉพาะที่ตัดสินเองไม่ได้ — ที่เหลือตัดสินแล้วใน §2–§7)

| # | คำถาม | ค่าเริ่มถ้าไม่ตอบ |
|---|---|---|
| Q1 | **เงิน/ทองเหลือง** ต้องชั่งทุกขั้นเหมือนทองไหม — เสนอ: เงินบังคับเฉพาะ หล่อ → ตัดต้น → ขัด (ขั้นที่เนื้อหาย) · ทองเหลืองไม่บังคับ (pricing-floor §1.5: loss ทองเหลือง % สูงแต่เงินน้อย) | ตามที่เสนอ |
| Q2 | **เกณฑ์น้ำหนักหายที่ให้เตือน** ต่อขั้น/ต่อโลหะ (เป็น % ของน้ำหนักเข้า) — ไม่รู้ตัวเลข ห้ามเดา | `null` = ไม่เตือน จนกว่าจะกรอกที่ `/jobs/stages` |
| Q3 | ออฟฟิศกรอกย้อนหลังได้กี่วัน | 14 วัน |
| Q4 | OEM เริ่มผลิตก่อนมัดจำเข้า: **ห้ามเด็ดขาด** หรือ **ได้เมื่อมีเหตุผล** (pricing-floor §4 บอกห้าม · 0168 เคยผ่อนด่าน MOQ เป็น "มีเหตุผล") | ได้เมื่อมีเหตุผล (note บังคับ · โชว์บนบอร์ด) |
| Q5 | ให้ลูกค้า OEM เห็นสถานะงานไหม (ลิงก์สาธารณะ) | **ไม่** ในทุกเฟสนี้ — เพิ่มช่องทางสาธารณะอีกช่องก่อน `/w/` นิ่ง = เสี่ยงซ้อน |
| Q6 | หน่วยน้ำหนัก: ทอง 3 ตำแหน่ง (0.001 g) เงิน 2 ตำแหน่งพอไหม · เครื่องชั่งในโรงงานอ่านได้กี่ตำแหน่ง | เก็บ 3 ตำแหน่งทุกโลหะ · จอแสดงตามโลหะ |
| Q7 | ระบุตัวช่าง: ยืนยัน **ชื่อ + PIN 4 หลัก** (§5.2 ข) · ช่างมีกี่คน/กี่แผนก · มือถือใช้ร่วมกันไหม | (ข) · session 12 ชม. |
| Q8 | งาน OEM 1 รายการ (เช่น 200 ชิ้น) เดินเป็น **ใบงานเดียว** หรือต้องแบ่งหลายใบ (ล็อตละแฟลสก์/ส่งบางส่วนก่อน) — ถ้าต้องแบ่ง ต้องมี `job_split` ตั้งแต่ J1 | 1 รายการ = 1 ใบงาน · แบ่งเป็นเฟสหลัง |
| Q9 | ร้านมีเครื่องพิมพ์สติกเกอร์ไหม · ใบงานใส่ซองติดถุงงานแบบไหนวันนี้ (ขนาดกระดาษที่ใช้จริง) | A5 ใส่ซอง |
| Q10 | "ไม่มีสแกนเกิน N วัน" ถือว่าผิดปกติที่กี่วัน (ขั้นหล่อรอแฟลสก์เต็มอาจค้างนาน) | 3 วัน · ต่อขั้นตั้งได้ที่ `/jobs/stages` |
| Q11 | พิมพ์ใบงานซ้ำ = QR เก่าใช้ไม่ได้ทันที (ปลอดภัยกว่า) หรือให้ใช้ได้ทั้ง 2 ใบ (สะดวกกว่า) | เพิกถอนทันที · มี checkbox "พิมพ์สำเนาเพิ่ม ไม่เพิกถอน" |

## 9. ความเสี่ยง · หนี้ · trade-off

**Trade-off ที่เลือก (และทางที่ตัดทิ้ง)**
- ตารางใหม่ ไม่ reuse `production_order`/`oem_quote_item` — เหตุผลเดียวกับ 0131 (OEM 0 diff · golden replay 0140 ยังจริง) · ตัดทิ้ง: เพิ่ม `stage` ลงใน `production_order` ตรงๆ (OEM ใช้ไม่ได้ + trigger deny mutation ของมันจะขวางการเดินขั้น)
- stage ต่อ job เป็นแถว (`job_stage`) ไม่ใช่ jsonb — ต้อง constraint ลำดับ/น้ำหนัก/unique ต่อขั้น + join บอร์ด · ตัดทิ้ง: jsonb array (ด่านตรวจไม่ได้ · ข้อ 13 ค่าว่างตาบอด)
- สถานะ denormalize (`job_stage.status`, `job.current_stage_code`) + event append-only ควบคู่ — บอร์ด query เร็ว + ประวัติแก้ไม่ได้ · ราคาที่จ่าย: drift ได้ → view ตรวจ + verify · ตัดทิ้ง: event-sourcing ล้วน (บอร์ดช้าและซับซ้อนเกินงาน 2–3 คน)
- ยืนยันฝ่ายเดียว (ผู้รับ) + auto_close — ตัดทิ้ง: สองฝ่ายกดทุกขั้น (จำนวนสแกน ×2 → ช่างเลิกใช้)
- worker + PIN แทน auth.users — ตัดทิ้ง: บัญชี staff จริง (ต้องรื้อ `requireWriteAccess`/role ซึ่งเจ้าของสั่งไม่แบ่ง level · memory `role-single-level`)
- polling 30 วิ แทน Realtime — ตัดทิ้ง: Supabase Realtime (ต้องเปิด table ให้ client — ขัดข้อ 18)
- ไม่ offline queue — ตัดทิ้งเฟสนี้ (§5.1 ข้อ 5)

**ความเสี่ยงตอน implement**
- R1 **renegotiate หลังมี job**: item ใหม่ถูกสร้าง job ยังชี้ item เก่า · ถ้าจำนวนชิ้นเปลี่ยน `qty_planned` ของ job ไม่ตาม → RPC renegotiate **ห้ามแก้** ⇒ ให้ `v_job_board` เทียบ `qty_planned` กับ item active ของดีลแล้วขึ้นป้าย "จำนวนในใบเสนอราคาเปลี่ยน" ออฟฟิศยกเลิก job แล้วสร้างใหม่ · ต้องมีเทสต์ "renegotiate ดีลที่มี job"
- R2 **สองความจริง** `production_order_item.qty_done` vs `job.qty_good` — จงใจไม่บังคับเท่ากัน (ใบที่ไม่ใช้ job ต้องปิดได้) · view mismatch + ป้ายบน `/stock` · ห้ามใครมา "แก้ให้ตรง" ด้วยการเขียน `production_order_done` ใหม่โดยไม่ผ่าน security 💰
- R3 **auto_close ทำให้น้ำหนักออกหาย** ในขั้นที่เงินไม่บังคับชั่ง — รายงาน loss ต่อขั้นจะมีรู · แสดง "ไม่ได้ชั่ง n ครั้ง" ข้างตัวเลข % เสมอ ไม่ใช่ซ่อน
- R4 **QR บนกระดาษในโรงงาน** (น้ำมัน/ฝุ่น/ความร้อนใกล้เตาเผา) — QR ≥ 35 mm + error correction ระดับ H · ถ้าสแกนไม่ได้ ช่างพิมพ์เลขงาน 4 หลักที่ `/w/` ไม่ได้ (จงใจ — เลขเดาได้) ⇒ ไปออฟฟิศพิมพ์ใบใหม่ · ต้องบอกช่างตั้งแต่วันแรก
- R5 **token ใน URL** ติดใน history/screenshot/LINE ที่ช่างส่งต่อกัน — ขอบเขตความเสียหาย = อัปเดตงานเดียวในชื่อช่างที่มี PIN · ไม่มีข้อมูลเงิน · เพิกถอนได้ · ยอมรับ
- R6 **middleware exempt prefix** เป็นครั้งแรกที่ exempt ไม่ใช่ exact path — ต้องเทสต์ path traversal/`/w/` ว่างเปล่า/ตัวพิมพ์ใหญ่ · ถ้า security ไม่ผ่าน ทางเลือกคือ `/w/[token]` เป็น route เดียวที่ exact-match ด้วย regex `^/w/[A-Za-z0-9_-]{43}$`
- R7 **เวลาไทย vs UTC** ทุกจุดที่มี "วันนี้" (due, overdue, occurred_on ของช่าง) — ข้อ 6 · verify ต้องรันเคส 00:00–07:00
- R8 **Storage quota** 1GB รวมกับ product-images — ต้องมีตัวเลขใช้ไปบน settings ก่อนเปิด J2
- R9 **ช่างใช้ `/w/` แทนกระดาษแล้วเลิกเซ็น** — ไม่ใช่ปัญหาระบบ แต่ถ้ากระดาษหายไป fallback หาย · ใบงานพิมพ์ยังบังคับเป็นทางเดียวที่ได้ QR ⇒ กระดาษอยู่กับงานเสมอโดยโครงสร้าง

**หนี้ที่รู้ตั้งแต่ design**
- ไม่มี `job_split`/รวมใบงาน (Q8) · ไม่มี offline · ไม่มีต้นทุนจริงต่อ batch (แค่นับ) · `assignee_name` free text ไม่ผูก worker (ทางสำรอง) · rate limit ใน DB ไม่ใช่ edge (ยิงหนักยังถึง DB) · `job_stage_def` ต่อร้าน แก้ seq หลังมี job แล้วไม่ย้อนผลใบเก่า (ล็อกที่ `job_stage.seq` ตอนสร้าง — ตั้งใจ)

## 11. มติเจ้าของ (12 ต.ค. 69) — ทับค่าเริ่มต้นใน §8

| # | มติ |
|---|---|
| Q1 | **ทองชั่งทุกขั้น · เงินบังคับชั่งเฉพาะ หล่อ → ตัดต้น → ขัด · ทองเหลืองไม่บังคับ** |
| Q4 | **OEM เริ่มผลิตก่อนมัดจำได้เมื่อใส่เหตุผล** (บอร์ดโชว์ป้าย "ยังไม่มีมัดจำ") · เจ้าของย้ำว่า **ผลิตขายปลีกในบ้านด้วย** ⇒ ใบผลิตเข้าสต็อก (`/production`) ใช้ระบบใบงานเดียวกันตั้งแต่ J1 |
| Q7 | **ช่างไม่เกิน 10 คน · มือถือส่วนตัว** ⇒ ชื่อ + PIN 4 หลัก จำในเครื่อง 12 ชม. |
| Q8 | **1 รายการ = 1 ใบงานก่อน** · แบ่งล็อต/ส่งบางส่วนเป็นเฟสหลัง |
| อื่นๆ | Q2 Q3 Q5 Q6 Q9 Q10 Q11 ใช้ค่าเริ่มต้นใน §8 จนกว่าเจ้าของจะบอก |

## 12. สถานะส่งมอบ J1 + หนี้ที่รู้ตัว (14 ต.ค. 69)

ขึ้น production 14 ต.ค. 69 (DB 0172-0174 · UI บอร์ด v2 ตาม spec Padmé · ทะเบียนช่างแยกแท็บ) · โดเมน QR = `APP_ORIGIN` (ดู memory `app-domain`) · ผ่าน security (0173/0174) · code review APPROVE · QA 4 รอบ · เจ้าของ UAT ผ่าน

| # | หนี้ | ผล | ปิดเมื่อ |
|---|---|---|---|
| D1 | `lib/vendor/uqr/` vendored (uqr@0.1.3 byte-identical) — `npm audit`/dependabot มองไม่เห็น | ต้องตาม CVE เอง | สลับเป็น `npm i uqr@0.1.3 --save-exact` ใน dir หลัก (ไม่ทำผ่าน worktree เพราะ node_modules เป็น junction) |
| D2 | DB ไม่ตรวจ `<` `>` ใน `job.assignee_name` (`job_office_receive`) — กันแค่ชั้น TS (`parseLabel`) | ไหลไปหน้าช่างผ่าน holder_name (React escape อยู่ ไม่อันตรายทันที) | migration ถัดไปที่แตะ job (M1/0175) เรียก `job_label_clean` |
| D3 | ฟอร์มเพิ่มช่างไม่เตือนก่อนกดเมื่อไม่เลือกขั้น (DB บังคับ ≥1 ขั้น · ข้อความมาจาก server) | UX | รอบ UI ถัดไป |
| D4 | `source_ref` ของใบงานส่งถึง client ในหน้าบอร์ด (ไม่ render) | ข้อมูลภายในใน payload หน้าออฟฟิศ | ตัดใน `getJobBoard` ฝั่ง server |
| D5 | `handoff_mismatch_count` สะสมไม่ล้าง → ป้าย "ชั่งไม่ตรง" ค้างจนปิดงาน · ทองยังเดาน้ำหนักได้โดยลองซ้ำ (rate limit 60/10 นาที + ป้ายบนบอร์ด) | ป้ายบนบอร์ด = สัญญาณให้เดินไปดู ไม่ใช่สถิติ | view flag "ยังค้าง" รอบหน้า |
| D6 | SQL ซ้ำ: ด่านมัดจำ 4 ที่ · เงื่อนไข handoff 2 ที่ · scope ช่าง 3 ที่ · `job_counter_bump` ไม่มีคนเรียก | แก้ทีหลังต้องแก้หลายที่ | helper `job_deposit_blocked` / `job_worker_can_do` ใน migration ถัดไปที่แตะ |
| D7 | เว็บ preview ล็อก Vercel SSO → ทดสอบ QR บน preview ต้อง login Vercel (production ไม่มี) | เฉพาะการทดสอบ | — |
