# Phase B — CRM Design (architect)

> architect (Yoda) · 2026-08-11 · ต่อยอด Phase A (migrations 0010-0013 + province seed/alias ที่ apply ผ่าน MCP)
> สถานะ: **APPROVED 2026-08-11** — เริ่ม B1 ได้ (decision ล็อกด้านล่าง)
> ฐานข้อมูลจริง ณ วันออกแบบ: 334 orders (ส.ค.) · 310 dim_customer · fact_order_item / fact_ad_spend / dim_campaign **ว่าง**

---

## ✅ Decisions LOCKED (เจ้าของเคาะ 2026-08-11)

| # | คำตอบ | ผลต่อ design |
|---|---|---|
| Q1 | override layer | ตาม §2.1 ไม่เปลี่ยน |
| Q2 | RFM fixed threshold | ตาม §2.4 · at_risk = เงียบ >90 วัน |
| Q3 | **LTV = กำไร margin 20%** (ยังไม่มี cost จริง) | **เปลี่ยน profit placeholder 10% → 20%** ทุกจุด (transform proc + recompute 334 แถวที่ลงแล้ว) · LTV view ใช้ profit · UI label "ประมาณการ 20%" · profit_status ยัง 'estimated' · actual cost = debt ค้างต่อ |
| Q4 | manual + **จำการตัดสิน** | เพิ่ม `crm_merge_decision` (จำทั้ง merged + "ไม่ใช่คนเดียวกัน") → candidate queue ไม่เด้งคู่ที่ตัดสินแล้วซ้ำ · cadence รายสัปดาห์ (batch) — รายละเอียด §3 |
| Q5 | **เจ้าของกรอก ad spend เอง** | B3 ไม่ blocked เรื่องคน — มีผู้รับผิดชอบแล้ว |
| Q6 | promo attribution **+ bundle SKU จริง** | ยืนยัน scope ใหญ่: (1) วัด lift ช่วงโปร + แยก "ซื้อเพราะโปร vs วิ่งมาเอง" (2) bundle เช่นแหวน+ต่างหูจัดเซตราคาโปร = **ตัดสต็อกตาม BOM กระทบ OMS `public.product`/stock** → B4 ต้อง design ร่วม OMS แยกงาน + ยัง blocked ด้วย fact_order_item (รอ PDF slip) |
| Q7 | staff เห็นทุกจอ PII ว่าง | ตาม default ไม่ทำ role ใหม่ |

**ถามกลับที่ยังค้าง:** ต้นทุนจริงต่อ SKU จะกรอกเมื่อไหร่ (blocker ของ profit จริง — ตอนนี้ปะ 20% ไปก่อน)

---

## 0. หลักคิดที่คุมทั้ง Phase B

1. **Raw ไม่โดนแก้** — fact/dim ที่ ELT เขียนยังเป็น SELECT-only เหมือนเดิม การแก้ของมนุษย์ทั้งหมดอยู่ใน **override layer + audit** แยกตาราง → import รอบใหม่ทับ raw ได้เสมอโดยไม่ชนกับที่แก้มือ (โจทย์ "แก้แล้วห้ามโดน import ทับ" แก้ด้วยโครงสร้าง ไม่ใช่ด้วยวินัย)
2. **ทุก write ของ CRM ผ่าน RPC (security definer)** ที่เขียน audit ใน transaction เดียว — pattern เดียวกับ stock RPC (0003/0005) ของ repo นี้ ไม่ปล่อยให้ client เขียนตารางตรงแล้วหวังว่าจะจำ audit เอง
3. **Marts เป็น plain view ไม่ใช่ materialized view** — ที่ 334 orders/เดือน query สดเร็วพอ, plain view รันด้วยสิทธิ์ผู้เรียก → **สืบทอด RLS ของ fact/dim อัตโนมัติ** (matview ทำ RLS ไม่ได้ ต้องสร้าง security-definer wrapper เพิ่มอีกชั้น = ความซับซ้อนที่ยังไม่ต้องจ่าย) เปลี่ยนเป็น matview + pg_cron เมื่อช้าจริงเท่านั้น (YAGNI) — ต่างจาก design doc เดิม §4 ที่ระบุ matview ไว้ตอนคิดเผื่อ 700+/เดือน
4. **ของที่ data ยังไม่มี ไม่สร้าง UI ให้** — ROAS/campaign/product performance รอ ad spend + PDF slip → อยู่ sub-phase หลัง

---

## 1. Scope แบ่ง Sub-phase

### B1 — CRM Read Layer + Data Quality (แนะนำเริ่มตัวนี้) · ~5-6 dev-days
ใช้ data ที่มีอยู่แล้ววันนี้ 100% ไม่รอใคร ไม่มี write path ใหม่ (เสี่ยงต่ำ ส่งมอบเร็ว):
- **Side nav refactor** — hamburger (mobile) / persistent sidebar (desktop) แทน header icon-nav (§4)
- **CRM แบรนด์:** `/crm/overview` — KPI รวม, RFM segment breakdown, channel performance รายเดือน (revenue/AOV/new customers — **ยังไม่มี ROAS** เพราะ spend ว่าง แสดง "ไม่มีข้อมูล ad spend" ตรงๆ ไม่โชว์เลขหลอก)
- **CRM บุคคล:** `/crm/customers` (list + search + segment filter) → `/crm/customers/[id]` customer 360 **read-only** (profile, RFM, ประวัติออเดอร์, identities; PII แสดงเฉพาะ owner/admin ตาม RLS เดิม)
- **Import error review:** `/crm/import-errors` — group ตาม `error_code` (column ใหม่, §2.5), แก้ typed cols ใน staging (RLS owner/admin update มีอยู่แล้ว) + ปุ่ม retry (transform proc รองรับ rerun แถว error อยู่แล้ว)
- Views: `v_customer_master`, `v_rfm_segment`, `v_customer_ltv`, `v_channel_perf_monthly` (§2.4)

### B2 — Write Path: แก้ข้อมูล + Merge ลูกค้า · ~5 dev-days
- Override layer + audit log + notes (§2.1-2.3) + RPC ชุดแก้ไข
- Customer 360 เปิดแก้: display_name, PII (owner/admin), tags, note
- Order แก้ผ่าน override: channel, province, revenue/discount, tags
- **Merge:** `/crm/merge` — candidate queue (§3) + confirm ทีละคู่ + audit ครบพอ unmerge มือได้
- เก็บ debt PDPA: retention job 180 วันของ staging (ค้างจาก Phase A)

### B3 — Marketing Activation: Ad Spend + Campaign + Recommendation · ~4 dev-days
- UI กรอก fact_ad_spend (RLS write มีแล้วตั้งแต่ 0012) + CRUD dim_campaign (ต้องเพิ่ม RLS write policy — 0012 จงใจเว้นไว้เป็น open decision)
- `v_campaign_roas` / เติม ROAS ลง channel perf
- **Recommendation แบบ rule-based** (ไม่ใช่ ML): at_risk เกิน N คน → เสนอ win-back broadcast, champion list → เสนอเป็น lookalike seed, จังหวัด AOV สูง → เสนอ geo-bid — reuse pattern Copilot card ของ TikTok module
- `v_audience_export` (consent-gated ตาม design เดิม §4.6)
- ⚠️ **เงื่อนไขก่อนเริ่ม B3:** เจ้าของ commit ว่าจะกรอก ad spend สม่ำเสมอ (อย่างน้อยรายสัปดาห์) — ไม่งั้น ROAS/recommendation เป็น dashboard ผี สร้างแล้วไม่มีคนป้อนข้อมูล

### B4 — Master Data + Campaign SKU · ~5+ dev-days · **blocked**
- ติด dependency: fact_order_item ยังว่าง (รอ PDF label/slip parser — งานคนละก้อน ไม่ใช่ของ CRM) → product/campaign-SKU performance ยังวัดไม่ได้
- ทำเมื่อ slip pipeline มา: `sku_alias` (design เดิม §12), `campaign_sku_map` (§2.6), หน้า master data
- **จุดที่ vision ขัดกันเอง ต้องเคลียร์ก่อน (§5 Q6):** "SKU ชั่วคราวช่วง campaign" — ถ้าเซ็ตโปรคือ bundle ของ SKU จริง การตัดสต็อกต้องรู้ BOM (1 เซ็ต = สร้อย 1 + จี้ 1) ซึ่งกระทบ OMS `public.product`/stock ไม่ใช่แค่ analytics — ห้าม design ฝั่ง analytics เดาเอง

**เหตุผลลำดับ:** B1 = value เร็วสุดจาก data ที่มีจริง + วางโครง nav/route ให้ทุก phase ถัดไป · B2 ก่อน B3 เพราะ merge ทำให้ segment/audience ถูกต้องก่อนเอาไปยิงแอด (ยิงแอดจาก data ที่นับลูกค้าซ้ำ = เผางบ) · B4 ท้ายสุดเพราะ blocked ด้วย data + คำถามธุรกิจ

---

## 2. Data Model เพิ่ม (schema `analytics` ทั้งหมด — ไม่แตะ `public`)

> migration เริ่มที่ **เลขถัดจากที่ DB apply จริง** — ⚠️ repo มีไฟล์ถึง 0013 แต่ DB apply ถึง ~0017 (province seed/alias ผ่าน MCP) → Tech Lead ต้อง sync ไฟล์ migration ให้ตรง DB ก่อนเริ่ม B ไม่งั้นเลขชนกัน

### 2.1 `crm_order_override` (B2) — override layer ของ fact_order
```
fact_order_id uuid PK -> fact_order on delete cascade
shop_id uuid not null -> shop
overrides jsonb not null   -- เฉพาะ key ใน whitelist: channel_id, province_code,
                           -- revenue, discount, tags, order_date, payment_method, bank
reason text
updated_by uuid -> auth.users · updated_at timestamptz
```
- อ่านผ่าน view **`v_fact_order`** = fact_order LEFT JOIN override แล้ว coalesce ทีละ field — **marts/UI ทุกตัวอ่าน view นี้ ไม่อ่าน fact_order ตรง**
- whitelist key บังคับใน RPC `crm_set_order_override(p_fact_order_id, p_overrides jsonb, p_reason)` — key นอก list = raise exception
- *Trade-off vs แก้ fact ตรง + lock flag:* แก้ตรง query ง่ายกว่า (ไม่มี view ซ้อน) แต่ ELT ทุกตัวต้องรู้ semantics ของ lock ทุก field ตลอดไป และ diff กับ platform report หายไป (พิสูจน์ไม่ได้ว่าเลขเดิมคืออะไร) — override layer ทำให้ ELT โง่ต่อไปได้ (upsert ทับ raw อย่างเดียว) + เห็น raw vs edited เสมอ
- *Trade-off vs EAV (1 แถว/field):* EAV query ยาก; jsonb 1 แถว/order พอ เพราะ audit รายละเอียดอยู่ใน crm_audit_log อยู่แล้ว
- **ยกเว้น dim_customer/pii_customer ไม่ใช้ override** — แก้ตรง (ผ่าน RPC + audit) แต่เพิ่ม `dim_customer.profile_source` text default "import" check in ("import","manual"); แก้ transform ให้**ข้ามการอัปเดต display_name/full_name เมื่อ profile_source = manual** — เหตุผล: profile ลูกค้าเป็น entity ที่มนุษย์เป็นเจ้าของร่วมโดยธรรมชาติ (ต่างจาก fact ที่ platform เป็นเจ้าของ) view ซ้อนอีกชั้นไม่คุ้ม แลกกับต้องแก้ transform proc 1 จุด

### 2.2 `crm_customer_note` (B2)
```
id uuid PK · shop_id -> shop · customer_id -> dim_customer on delete cascade
body text not null · created_by -> auth.users · created_at / updated_at
```
- merge ลูกค้า → repoint customer_id ตาม (อยู่ใน merge RPC)

### 2.3 `crm_audit_log` (B2) — append-only กลาง
```
id uuid PK · shop_id · actor uuid -> auth.users
action text check in (order_override_set, order_override_clear, customer_edit,
  pii_edit, customer_merge, note_add, note_edit, import_row_edit, import_retry)
entity_type text · entity_id uuid · before jsonb · after jsonb · created_at
```
- เขียนได้ทาง RPC (definer) เท่านั้น — ไม่มี insert policy ให้ user ใดๆ; ไม่มี update/delete policy เลย (append-only)
- index `(shop_id, entity_type, entity_id, created_at desc)` — customer 360 โชว์ "ใครแก้อะไรเมื่อไหร่" ได้ตรงๆ

### 2.4 Views / Marts (B1 — plain view ทั้งหมด, อ่านจาก `v_fact_order` + `dim_customer where merged_into_id is null`)
- **`v_customer_master`** — dim_customer (master only) + order count/revenue รวม + last_order + identities count → หน้า list
- **`v_rfm_segment`** — ตาม sketch design เดิม §4.1 (ntile 5) · ⚠️ ntile บน N=310 คนทำ threshold แกว่งทุกครั้งที่ data เพิ่ม — เสนอ**เกณฑ์ fixed** แทน (เช่น R: <30วัน / 30-90 / >90 · F: 1 / 2-3 / 4+ · M: <500 / 500-1500 / >1500 อิง AOV จริง LINE 1,626 vs TikTok 489) → segment stable อ่านรู้เรื่อง — เป็นคำถามเจ้าของ (§5 Q2)
- **`v_customer_ltv`** — revenue สะสม, AOV, first_touch_channel, profit สะสม **พร้อม profit_status mix กำกับเสมอ** (ตอนนี้ estimated 10% ทั้งหมด — LTV เชิง profit คือเลขสมมติ ต้อง label ใน UI ว่า "ประมาณการ")
- **`v_channel_perf_monthly`** — เดือน x channel: revenue, orders, AOV, new_customers (+ B3 เติม spend/ROAS/CAC จาก fact_ad_spend)
- **`v_import_error_summary`** — count ตาม error_code ต่อ batch → หน้า review
- cohort retention view เลื่อนไป B3 (data 1 เดือนยังไม่มี cohort ให้ดู — สร้างตอนนี้ได้แต่โชว์ตารางว่าง)

### 2.5 แก้ staging เล็กน้อย (B1)
- `stg_order_import` เพิ่ม **`error_code text`** (ค่า: channel_alias_missing / order_date_missing / phone_invalid / exception) — transform proc ตอนนี้ยัดทุกอย่างลง error_detail เป็น free text UI จะ group ประเภทไม่ได้ถ้าไม่มี code · แก้ proc ให้ set ทั้งคู่

### 2.6 `campaign_sku_map` (B4 — sketch ไว้ ยังไม่ commit)
```
id · shop_id · campaign_id -> dim_campaign · product_id -> public.product
  (หรือ sku_pattern text) · valid_from / valid_to date
```
- ผูกยอดจาก fact_order_item เข้า campaign — **รอคำตอบ Q6 ก่อน อย่าเพิ่งสร้าง**

### 2.7 RLS Tier ของตารางใหม่ + PDPA
| ตาราง | tier |
|---|---|
| `crm_order_override`, `crm_customer_note` | SELECT = tenant member · write = **ผ่าน RPC เท่านั้น** (RPC ตรวจ owner/admin เอง; ไม่มี direct write policy) |
| `crm_audit_log` | SELECT = owner/admin (before/after อาจมี PII เช่น pii_edit) · write = definer only |
| views ทุกตัว | invoker → สืบทอด RLS ตาราง underlying · **ห้ามใส่คอลัมน์ PII ดิบใน view ใดๆ** — customer 360 ดึง pii_customer แยก query (RLS owner/admin กรองเอง: staff เห็นหน้าเดิมแต่ช่อง PII ว่าง) |
| PDPA | override whitelist **ไม่รับ** field PII (แก้เบอร์/ที่อยู่ → RPC `crm_edit_pii` เขียน pii_customer + audit pii_edit) · retention job 180 วันของ staging **ยังค้างจาก Phase A** — เอาเข้า scope B2 (pg_cron 1 statement) ไม่ปล่อยค้างต่อ |

---

## 3. Merge Flow (B2)

**ตัดสินใจ: manual confirm ทั้งหมด ไม่มี auto-merge** — auto ที่ปลอดภัย (เบอร์เต็มตรงกัน) transform ทำอยู่แล้วตั้งแต่ Phase A (upsert บน primary_phone_hash); ที่เหลือคือกลุ่มไม่มี key แข็ง (TikTok เบอร์ mask) ซึ่ง false-merge ทำ RFM/audience เพี้ยนถาวร แพงกว่า miss-merge (สอดคล้อง trade-off เดิม design doc §2.2: ปฏิเสธ probabilistic matching) และ 310 คนตรวจมือไหวสบาย

- **Candidate queue — view `v_merge_candidate`** จับคู่ dim_customer (เฉพาะ master, `merged_into_id is null`) ใน shop เดียวกัน ด้วย heuristic เรียงตาม confidence:
  1. **identity ตรงกันคนละ customer** — tiktok_handle / line_id / shopee_username เดียวกันใน dim_customer_identity แต่ชี้คนละ customer_id (เกิดได้จากรอบ import ที่ identity ยังไม่ครบ) → confidence สูง
  2. **ชื่อ normalize ตรงกัน + จังหวัดล่าสุดตรงกัน** — lower/trim display_name (ตัดคำนำหน้า คุณ/นาย/นาง) + province จาก order ล่าสุดของแต่ละฝั่ง → confidence กลาง
  3. **ชื่อตรงกันอย่างเดียว** → confidence ต่ำ แสดงท้ายคิว
  - แต่ละคู่แสดงหลักฐานประกอบ: ชื่อ, identities, จังหวัด, ช่วงเวลาซื้อ, ยอดรวม — ให้คนตัดสิน ไม่ตัดสินแทน
- **Confirm ทีละคู่** — เลือก survivor (default = คนที่มี order เก่าสุด/ข้อมูลครบกว่า) แล้วเรียก RPC
- **RPC `crm_merge_customer(p_shop_id, p_survivor_id, p_victim_id)`** — security definer ทำใน transaction เดียว:
  1. ตรวจ caller เป็น owner/admin ของ shop + ทั้งคู่เป็น master row ของ shop เดียวกัน (กัน merge ข้าม tenant / merge ซ้อน)
  2. repoint `fact_order.customer_id`, `dim_customer_identity.customer_id`, `dim_address.customer_id`, `crm_customer_note.customer_id`, `fact_touchpoint.customer_id` → survivor
  3. merge `pii_customer`: survivor ชนะ field ที่มีค่า field ว่างเติมจาก victim แล้วลบแถว victim
  4. set `victim.merged_into_id = survivor` (soft-delete ตาม pattern schema เดิม — partial unique index เว้นแถว merged ไว้แล้ว)
  5. recompute `first_order_at` / `last_order_at` / `first_touch_channel_id` ของ survivor จาก fact_order จริง
  6. audit `customer_merge`: เก็บ before ของทั้งสองแถว + รายการ fact_order id ที่ย้าย → **ข้อมูลพอสำหรับ unmerge มือ**
- **ทำไม repoint fact_order** (ไม่ปล่อยชี้ victim แล้วให้ mart resolve chain): mart ทุกตัว join ตรง customer_id — resolve chain ทุก query = ภาระถาวรและพลาดง่าย; repoint ครั้งเดียวจบ ย้อนได้จาก audit
- **Unmerge:** ไม่มีปุ่ม — ทำมือจาก audit log (มี order id list ครบ) · เหตุผล: flow manual-confirm ทำให้โอกาสผิดต่ำ สร้าง unmerge UI = effort สูงกว่า value
- **ข้อจำกัดต้องบอกเจ้าของตรงๆ:** (1) `is_new_customer` ของ order เก่าไม่ recompute อัตโนมัติ (freeze by design ตั้งแต่ 0013) → เลขลูกค้าใหม่ย้อนหลังสูงเกินจริงเล็กน้อยแม้ merge แล้ว — เสนอ job recompute เป็น optional ใน B2 (2) ลูกค้า TikTok ที่ไม่มี identity เลย **merge ไม่ได้ด้วยข้อมูลที่มี** — ข้อจำกัด platform ไม่ใช่ CRM ตัวเลขฝั่ง TikTok ต้องขึ้น banner นับหัวเกินจริง (reuse DataQualityBanner ของ TikTok module)

---

## 4. UX โครง 2-CRM + Navigation (propose — รายละเอียด visual ประสาน ux-ui ทีหลัง)

**Side nav:** desktop = sidebar ค้างซ้าย · mobile = hamburger + drawer — แก้ที่ `app/(dashboard)/layout.tsx` ที่เดียว ทุก module ได้ผลทันที (ตอนนี้เป็น header icon-nav 5 ปุ่มซึ่งเต็มแล้ว)

```
หน้าร้าน          ออเดอร์ /  ·  สต็อก /stock  ·  เพิ่มสินค้า /products/new  ·  ไลฟ์ /live
TikTok Ops        /tiktok/dashboard · /tiktok/sales · /tiktok/upload · /tiktok/copilot   (sub-nav เดิมคงไว้)
CRM (B1)          ภาพรวมแบรนด์   /crm/overview          <- CRM บริหารแบรนด์
                  ลูกค้า          /crm/customers          <- CRM บริหารบุคคล (list/search/segment filter)
                  ลูกค้ารายคน     /crm/customers/[id]     <- customer 360 (ไม่อยู่ใน nav เข้าจาก list)
                  ตรวจ import     /crm/import-errors
CRM (B2 เพิ่ม)    รวมลูกค้าซ้ำ    /crm/merge
การตลาด (B3)      แคมเปญ /marketing/campaigns · ค่าแอด /marketing/ad-spend
                  คำแนะนำ /marketing/copilot · Audience export /marketing/audience
```
- CRM เป็น route group มี `app/(dashboard)/crm/layout.tsx` ของตัวเอง ตาม pattern TikTok module (accent bar + sub-nav) — consistency กับของเดิม ไม่คิด pattern ใหม่
- Customer 360 (`/crm/customers/[id]`): profile + RFM badge + ประวัติออเดอร์ + identities + (B2: แก้ไข/note/audit timeline) — PII section render จาก query แยก โดน RLS กรองเองถ้าเป็น staff
- ไฟล์หลักที่แตะใน B1: `app/(dashboard)/layout.tsx` (nav) · `app/(dashboard)/crm/{layout,overview,customers,customers/[id],import-errors}` · `components/domain/crm/*` · `lib/actions/crm.ts` · migration (views + error_code)

---

## 5. จุดตัดสินใจ — ต้องได้คำตอบเจ้าของก่อนเริ่ม phase ที่เกี่ยว (B1 เริ่มได้ทันทีที่ตอบ Q2)

| # | คำถาม | Options | คำแนะนำ architect |
|---|---|---|---|
| Q1 | การแก้ order ภายหลัง | (ก) override layer — raw ไม่โดนแตะ เทียบ report platform ได้เสมอ UI โชว์ icon "แก้ไขแล้ว" · (ข) แก้ fact ตรง + lock flag — query ง่ายกว่าแต่เลขเดิมหาย ELT ต้องรู้ lock ทุก field | **(ก) override** — เหตุผลเต็ม §2.1; ยอมรับว่าเลข CRM อาจต่างจาก report platform เมื่อแก้มือ |
| Q2 | เกณฑ์ RFM | (ก) fixed threshold — stable อ่านรู้เรื่อง จูนมือได้ · (ข) ntile relative — ปรับตัวเองแต่ segment แกว่งทุก import ที่ N=310 | **(ก) fixed** ค่าเริ่มต้นตาม §2.4 · at_risk เมื่อเงียบ >90 วัน (รอบซื้อซ้ำสินค้าเงิน ~เดือน-ไตรมาส) แล้วจูนจากของจริง |
| Q3 | นิยาม LTV | (ก) revenue สะสม — เชื่อได้วันนี้ · (ข) profit สะสม — ตอนนี้ = สมมติ 10% ทั้งกระดาน เลขสวยแต่ไม่จริง | **(ก) revenue-LTV เป็นหลัก** จนกว่ามี actual cost — และถามกลับ: **ต้นทุนจริงต่อ SKU จะกรอกเมื่อไหร่?** (ค้างจาก Phase A เป็น blocker ของ profit ทุกจอ) |
| Q4 | Merge ลูกค้า | (ก) manual confirm ทุกคู่ · (ข) auto-merge เมื่อ heuristic มั่นใจสูง | **(ก) manual** — false-merge แพงกว่า miss-merge, 310 คนตรวจไหว · auto ที่ปลอดภัย (เบอร์เต็มตรง) มีแล้วใน transform · รับข้อจำกัด is_new_customer + TikTok no-identity ตาม §3 |
| Q5 | Ad spend (เงื่อนไข B3) | ใครกรอกค่าแอดรายสัปดาห์? | ต้องมี**ชื่อคนรับผิดชอบ**ก่อน dev เริ่ม B3 — ไม่มีคน commit = เลื่อน B3 ไม่สร้างจอร้าง |
| Q6 | Campaign SKU (เงื่อนไข B4) | (ก) bundle ของ SKU จริง — ตัดสต็อกตาม BOM → กระทบ OMS `public.product`/stock ต้องออกแบบร่วม OMS แยกอีกงาน · (ข) แค่ tag/รหัส track ยอด — จบใน analytics ด้วย `campaign_sku_map` | ตอบก่อน **B4 ห้ามเริ่ม** — ถ้า (ก) scope ใหญ่กว่าที่คุยกันมาก ต้องวางแผนใหม่ |
| Q7 | สิทธิ์ staff | staff เห็นหน้า CRM ไหม? | ใช้ default ปัจจุบัน: เห็นทุกจอแต่ช่อง PII ว่าง (RLS จัดการเอง) — ไม่ทำ role ใหม่ |

**ความเสี่ยงรวม:** (1) migration file ใน repo (ถึง 0013) ไม่ sync กับ DB (~0017 ผ่าน MCP) — ต้อง reconcile ก่อนเขียน migration ใหม่ ไม่งั้นเลขชน (2) data มีแค่ 1 เดือน — cohort/trend ยังบาง อย่าตัดสินธุรกิจเร็วเกิน (3) staging PII retention job 180 วันยังไม่มีจริง — PDPA debt จาก Phase A เอาเข้า B2 (4) environment dev ไม่มี Node — build/test ผู้ใช้ต้องรันเอง เผื่อ loop นี้ใน estimate

---

## 6. Definition of Done — B1 (ตัวที่เริ่มก่อน)

- [ ] Side nav ใหม่ (drawer mobile / sidebar desktop) — ทุก route เดิมเข้าถึงได้ ไม่มี regression
- [ ] Migration apply บน DB จริง: views (`v_fact_order` — ตอน B1 ยังไม่มี override = passthrough, `v_customer_master`, `v_rfm_segment`, `v_customer_ltv`, `v_channel_perf_monthly`, `v_import_error_summary`) + `stg_order_import.error_code` + แก้ transform proc ให้ set error_code
- [ ] `/crm/overview` แสดง KPI + segment breakdown + channel perf จาก data ส.ค. จริง — spot-check เทียบ query มืออย่างน้อย 3 ตัวเลข
- [ ] `/crm/customers` list + search ครบ 310 คน · `/crm/customers/[id]` ประวัติออเดอร์ครบ · **login เป็น staff แล้วไม่เห็น PII (ทดสอบจริง ไม่ใช่เชื่อ RLS เฉยๆ)**
- [ ] `/crm/import-errors` group ตาม error_code · แก้ field ใน staging + retry แล้วแถว error เดิมกลายเป็น transformed จริง
- [ ] ทุกจอที่มี profit มี label "ประมาณการ 10%" · จอฝั่ง TikTok มี banner นับหัวเกินจริง
- [ ] security-auditor + qa ผ่าน (โฟกัส: view ไม่รั่ว PII, RLS staging/pii) · code-review ผ่าน · deploy checklist จาก devops
- [ ] Technical debt บันทึกตรงๆ: retention job, is_new_customer recompute, cohort รอ data, เปลี่ยนเป็น matview เมื่อช้าจริง
