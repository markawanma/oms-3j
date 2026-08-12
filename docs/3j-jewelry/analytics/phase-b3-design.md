# Phase B3 — Marketing Activation Design (architect)

> architect (Yoda) · 2026-08-12 · ต่อจาก B1/B2 (migrations 0020-0026 apply แล้ว) · สถานะ: **DRAFT — รอ owner เคาะ Q1-Q6 ก่อน implement**
> ฐานจริง ณ วันออกแบบ: 334 orders / 238 ลูกค้า (ส.ค.) · TikTok AOV 489 / LINE AOV 1,626 · `fact_ad_spend` + `dim_campaign` **ว่างทั้งคู่** · `fact_order.campaign_id_first/last` **null ทั้งหมด** · profit = ประมาณการ 20%

---

## 0. หลักคิดที่คุม B3

1. **ออกแบบตาม data ที่จะมีจริง ไม่ใช่ data ในฝัน** — attribution ระดับ campaign ไม่มีทางเดินของข้อมูล (ไม่มี UTM ingest, ออเดอร์มาจากไฟล์ export ของ platform ที่ไม่มี campaign ref) → default = **channel-level** และพูดตรงๆ ว่า campaign-level ทำไม่ได้จนกว่าจะมี data path ใหม่
2. **Owner กรอกเอง → form ต้องเสร็จใน <30 วินาที** — ถ้ากรอกยาก จะไม่กรอก แล้วทั้ง phase กลายเป็น dashboard ผี
3. **เลขที่ไม่จริง ต้อง label** — profit-ROAS ใช้ margin สมมติ 20% → label "ประมาณการ" ทุกจุด (pattern เดียวกับ LTV ใน B1)
4. Reuse pattern ที่มีแล้วทั้งหมด: CopilotCard ของ TikTok module, plain view + `security_invoker`, RLS tier ของ 0012, marketing routes ตามโครง nav ใน phase-b-crm-design §4

---

## 1. Ad Spend Entry Model

### 1.1 Granularity — schema รองรับพอ ไม่ต้องแก้ DDL

`fact_ad_spend` (0010) มีครบแล้ว: `spend_date date NOT NULL` · `channel_id NOT NULL` · `campaign_id NULLABLE` · `spend_amount` · `impressions / clicks / platform_reported_conversions` (optional) · `entry_method` + unique key `(shop_id, spend_date, channel_id, coalesce(campaign_id, uuid_nil()))` → รองรับทั้ง **date × channel** (campaign_id = null) และ **date × channel × campaign** ในตารางเดียว โดย row channel-level upsert ได้สะอาดผ่าน uuid_nil() sentinel

**เสนอ: เริ่มที่ date × channel เท่านั้น (campaign_id = null ทุกแถว)** — ตรงกับความจริงว่า 3J ยิง boost/โปรโมตไลฟ์ ไม่ได้รันแคมเปญมีชื่อเป็นระบบ (ยืนยันใน Q3) · *Trade-off:* เสีย granularity campaign แต่แลกกับ form 3 ช่อง (วันที่ / ช่องทาง / จำนวนเงิน) ที่ owner กรอกไหวจริง — เพิ่ม campaign ทีหลังได้โดยไม่แตะ schema เลย

### 1.2 Owner กรอกรายสัปดาห์ แต่ column เป็นรายวัน — จัดการยังไง

| Option | วิธี | ปัญหา |
|---|---|---|
| (ก) กรอกรายวัน 7 แถว/สัปดาห์/channel | ตรง schema ที่สุด | 14+ แถว/สัปดาห์ (2 channels) — owner เลิกกรอกแน่ |
| (ข) กรอกยอดรวมสัปดาห์ → เก็บลงวันเดียว (วันจันทร์ของสัปดาห์) | ง่ายสุด | **สัปดาห์คร่อมเดือนทำ monthly ROAS เพี้ยน** (spend ทั้งก้อนตกเดือนเดียว) — mart หลักเป็นรายเดือน จุดนี้แพง |
| (ค) **กรอกเป็นช่วง (from–to) + ยอดรวม → ระบบหารเฉลี่ยลงรายวันเท่าๆ กัน** | form 1 ครั้ง/สัปดาห์/channel · monthly rollup ถูกเสมอ (คร่อมเดือนก็แบ่งตามวันจริง) | เลขรายวันเป็น synthetic (ค่าเฉลี่ย) — รับได้เพราะไม่มี mart รายวันใน scope |

**เสนอ (ค)** — form: ช่วงวันที่ (default = สัปดาห์ล่าสุด) / channel / ยอดเงิน / (optional พับเก็บ: impressions, clicks) → server action แตกเป็นแถวรายวัน upsert · หน้า `/marketing/ad-spend` โชว์ตารางย้อนหลัง group รายสัปดาห์ แก้/ลบได้ (RLS owner/admin write มีแล้วตั้งแต่ 0012 — ไม่ต้องแก้ policy)

⚠️ **Implementation gotcha:** unique key เป็น expression index → PostgREST `.upsert({onConflict})` อ้าง expression index ไม่ได้ — ต้อง write ผ่าน **RPC `mkt_upsert_ad_spend(...)`** (SQL `insert ... on conflict` ธรรมดา, security invoker พอ — RLS จัดการสิทธิ์เอง) อย่าปล่อยให้ backend-dev ไปเจอเองตอนเขียน

## 2. dim_campaign + RLS — เสนอ "ยังไม่ทำ"

0012 จงใจเว้น write policy ของ `dim_campaign` ไว้เป็น open decision — ตอนนี้ต้องตัดสิน:

- ถ้า 3J **ไม่มีแคมเปญมีชื่อ** (แค่ spend ต่อ channel) → **ไม่เพิ่ม policy ไม่สร้าง CRUD UI** (YAGNI) — ตารางนอนรอเฉยๆ ไม่มีต้นทุน
- ถ้า owner ยืนยันว่ามี/จะมี → เพิ่ม owner/admin insert/update policy (pattern เดียวกับ fact_ad_spend ~15 บรรทัด) + หน้า `/marketing/campaigns` CRUD — แต่พูดตรงๆ: **campaign ROAS ยังวัดไม่ได้อยู่ดี** (ฝั่ง revenue ไม่มี campaign ref — §3) ได้แค่ "spend ต่อแคมเปญ" ฝั่งเดียว value ต่ำ → **แนะนำ: ข้าม campaign ทั้งก้อนใน B3** (Q3)
- ยกเว้น: ถ้าอนาคตทำ auto-ads (§6.5) การยิงผ่าน API จะสร้าง campaign จริงบน platform → ตอนนั้น dim_campaign ถูกเขียนโดย integration (service role) ไม่ใช่มือ — ก็ยังไม่ต้องมี write policy ฝั่ง user อยู่ดี

## 3. ROAS / CAC — นิยาม + attribution

**Attribution = channel-level เท่านั้นใน B3** — TikTok spend เทียบ revenue ของออเดอร์ `channel_id` = TikTok เดือนเดียวกัน ทำได้จริงวันนี้เพราะ fact_order มี channel_id ครบทุกแถว

**Campaign-level: blocked ด้วย data ไม่ใช่ effort** — `campaign_id_first/last` จะมีค่าได้ต้องมีแหล่ง: (1) UTM/touchpoint ingest (fact_touchpoint ก็ว่าง) หรือ (2) ไฟล์ order export ของ platform มี campaign ref (ไม่มี) หรือ (3) กรอกมือต่อออเดอร์ (334 ออเดอร์/เดือน ไม่มีใครทำไหว) → **อย่ารับปาก owner ว่าจะเห็น "แคมเปญไหนคุ้ม" — เห็นได้แค่ "ช่องทางไหนคุ้ม"**

นิยาม (ต่อเดือน × channel — replace `v_channel_perf_monthly` เดิมจาก 0020):

```
spend        = sum(fact_ad_spend.spend_amount) เดือน×channel
roas         = revenue / nullif(spend, 0)            -- null ถ้าไม่มี spend → UI "ไม่มีข้อมูลค่าแอด" ห้ามโชว์ 0 หรือ infinity
profit_roas  = (revenue * 0.20) / nullif(spend, 0)   -- label "ประมาณการ 20%" เสมอ · สลับเป็น profit จริงเมื่อ cost มา (debt เดิม)
cac          = spend / nullif(new_customers, 0)
```

- View เพิ่ม: `v_ad_spend_weekly` (ตารางหน้า entry) — ทั้งหมด plain view + security_invoker ตาม convention 0020
- ⚠️ Data-quality ต้องแปะ: **CAC ฝั่ง TikTok ต่ำกว่าจริง** — ลูกค้า TikTok ไม่มี identity นับหัวซ้ำเป็น "ลูกค้าใหม่" เกินจริง (ข้อจำกัดเดิม B2 §3) → reuse DataQualityBanner บนจอที่โชว์ CAC
- ⚠️ เดือนแรกมี spend เดือนเดียว → trend rule (roas_drop) ยังทำงานไม่ได้จนมี ≥2 เดือน — expectation ที่ต้องบอก owner ไม่ใช่ blocker ของ dev

## 4. Recommendation Engine (rule-based ไม่ใช่ ML)

**สถาปัตยกรรม:** SQL view `v_marketing_reco` (union กฎทุกตัว คำนวณสดจาก marts — scale นี้ถูกและ always fresh ไม่ต้องมี job) + ตาราง **`mkt_reco_decision`** เก็บ approve/dismiss ลง **DB** — *ยกระดับจาก TikTok copilot ที่ใช้ localStorage* (comment ใน `lib/tiktok/copilot-storage.ts` เขียนไว้เองว่า "schema ควรเกิดพร้อม analytics DB" — ถึงเวลาแล้ว) · UI reuse `CopilotCard`/`CopilotSection` เดิมทั้งชุด แค่ย้าย approve/dismiss จาก localStorage เป็น server action

```
mkt_reco_decision:
  shop_id -> shop · reco_key text        -- deterministic: rule_code + period เช่น winback_at_risk:2026-08
  status text check in (approved, dismissed) · dismiss_reason text
  decided_by -> auth.users · decided_at
  PK (shop_id, reco_key)
```
- reco_key ผูก period → กฎเดิมเด้งใหม่เมื่อขึ้นเดือนใหม่ (dismiss ไม่ใช่ปิดถาวร)
- RLS: SELECT tenant member · write owner/admin **direct policy** (ไม่ผ่าน RPC) — *trade-off vs pattern RPC+audit ของ B2:* นี่คือ preference ไม่ใช่การแก้ data ไม่ต้องมี audit trail แบบ override — ความซับซ้อน RPC ไม่คุ้ม

**กฎที่เสนอ (owner เลือกใน Q5):**

| # | rule_code | Trigger (จาก view ที่มีแล้ว) | คำแนะนำบน card | ใช้ได้เมื่อ |
|---|---|---|---|---|
| R0 | spend_missing (blocker) | ไม่มีแถว fact_ad_spend ใน 14 วันล่าสุด | "กรอกค่าแอดก่อน — ROAS ทุกใบข้างล่างรอข้อมูลนี้" | ทันที (reuse isBlocker style) |
| R1 | winback_at_risk | v_rfm_segment: at_risk ≥ 20 คน | win-back broadcast ทาง LINE (AOV 1,626 — คุ้มตาม) | ทันที |
| R2 | geo_focus | จังหวัด AOV ≥ 1.5× median + orders ≥ 5 ใน 60 วัน | เพิ่ม geo-bid จังหวัดนั้น | ทันที |
| R3 | cac_vs_aov | cac > aov ของ channel เดือนล่าสุด | จ่ายแพงกว่าที่ลูกค้าซื้อ — ทบทวนงบ channel | เมื่อมี spend เดือนแรก |
| R4 | roas_drop | roas < 2.0 หรือตก ≥30% MoM | ลด/หยุดงบ channel | **รอ spend ≥2 เดือน** |
| R5 | lookalike_seed | champion ≥ 10 คน | export seed audience | **รอ consent (Q6)** — และ platform match ได้เฉพาะคนที่มีเบอร์จริง (ลูกค้า LINE) ไม่ใช่ลูกค้า TikTok ที่เบอร์ mask — irony นี้ต้องบอก owner ตรงๆ |
| R6 | live_targeting_brief | รวม data ที่มีจริงต่อ channel: top-5 จังหวัด (orders/revenue/AOV), segment mix ของผู้ซื้อ, ช่วงเวลา order (จาก paid_at) | "ยิงแอดโปรโมตไลฟ์ TikTok เจาะ [จังหวัด...] ช่วง [เวลา...]" — targeting brief ที่ owner เอาไปตั้งใน Ads Manager ได้เลย | **ทันที — นี่คือข้อ 4 ของ vision ที่ data พร้อมแล้ว** |

Threshold hardcode ใน view ก่อน (จูนด้วย migration สั้นๆ) — ตาราง config ต่อเมื่อ owner ขอปรับบ่อยจริง (YAGNI)

## 5. Audience Export — เจอ blocker จริง ต้องเคาะ

`v_audience_export` ตาม design เดิมเป็น consent-gated (`pdpa_consent = true`) แต่**ความจริง: pdpa_consent = false ทั้ง 238 คน ไม่เคยมี flow เก็บ consent** → สร้างจอนี้วันนี้ = จอว่าง 100%
- ทางออกที่ถูกกฎ: LINE broadcast หาเพื่อนใน OA เดิม **ไม่ต้อง export PII ออกจากระบบ** (R1 ใช้ได้เลย — ให้ list ชื่อ/segment ไม่มีเบอร์) · custom-audience upload (เบอร์เข้า ad platform) ต้องมี consent ก่อน → **เสนอตัด audience export ออกจาก B3** — R5 แสดงเป็น card ที่บอกว่า blocked เพราะอะไร ดีกว่าสร้าง export ที่ชวนละเมิด PDPA
- กติกา §2.7 เดิมยังคุม: **ห้าม PII ดิบใน view ใดๆ** — ถ้าทำ export จริงในอนาคต join pii_customer ตอน export ใน server action ภายใต้ RLS owner/admin เท่านั้น
- งานเก็บ consent = phase แยก (touchpoint ตอนขาย/LINE) — ไม่ใช่ของ B3

## 6. Product Hero Pipeline (vision ใหม่ของ owner — fold เข้า B3)

Vision 5 ขั้น: หา product ขายดีในไลฟ์ → แตกเป็น hero SKU ขายทั่วไป → content clip เล่า story → แนะนำ ads targeting จาก CRM → เสนองบ+อนุมัติ+ยิง auto — **ออกแบบเป็น pipeline เดียว แต่ dependency ต่างกันคนละโลก ต้องแบ่งตามความจริง:**

| ขั้น | ต้องมี | สถานะวันนี้ | ทำได้เมื่อ |
|---|---|---|---|
| 6.1 หา item ขายดีในไลฟ์ | **item-level data** — nuance: สินค้าไลฟ์หลายแบบใช้ "live SKU" รวมๆ ตัวเดียว → ต้องเห็นระดับ item/คำอธิบายใน slip ไม่ใช่แค่ SKU | **blocked** — `fact_order_item` ว่างเปล่า (รอ PDF slip parser — งานคนละก้อน) และต่อให้ parse แล้ว ถ้า slip เขียนแค่ live SKU รวม ก็ยังแยก item ไม่ได้ ต้องเปลี่ยนวิธีจดตอนไลฟ์ด้วย (process ไม่ใช่ software) | หลัง slip parser + ตกลงวิธีจดรายการตอนไลฟ์ (Q7) |
| 6.2 แตก hero SKU ขายทั่วไป (ปักตะกร้า) | 6.1 + master data — สร้าง SKU ใหม่ใน OMS `public.product`, ถ้า hero เป็นเซต = BOM กระทบ stock | **blocked** — ทับกับ B4/Q6 เดิมพอดี (campaign SKU / bundle) ห้าม design ฝั่ง analytics เดาเอง | design ร่วม OMS ใน B4 |
| 6.3 Content clip pipeline (story: แรงบันดาลใจ วัตถุดิบ พลอย ความหมาย ขั้นตอนผลิต — เช่นแหวน Treasure bag เงิน 925 + ทับทิมพม่า) | คน ไม่ใช่ DB — ทีม content (copywriter/content-repurposer) | ทำได้เลยแบบ manual | ฝั่งระบบทำแค่ **"content brief card"** ใน copilot: เมื่อมี hero (จาก 6.1 หรือ owner เลือกมือ) → card แนบ template brief ส่งต่อทีม content · **ไม่สร้าง content-management system ใน B3** (YAGNI — ทีม content ทำงานใน workflow ตัวเองอยู่แล้ว) |
| 6.4 Ads targeting จาก CRM | data ที่มีวันนี้ (จังหวัด/segment/channel/เวลา) | **ทำได้เลย** | = R6 live_targeting_brief (§4) — จุดที่ vision กับความจริงเจอกันพอดี เริ่มที่นี่ |
| 6.5 เสนองบ → อนุมัติ → ยิง auto | spend history + Ads API integration | เสนองบ: รอ spend ≥1 เดือน · ยิง auto: **integration ใหญ่ + financial action** | แบ่ง 2 จังหวะตาม §6.6 |

### 6.6 Budget proposal + approval gate (design เต็ม, implement เป็น 2 จังหวะ)

```
mkt_budget_proposal:
  id uuid PK · shop_id -> shop · channel_id -> dim_channel · period date (เดือน)
  suggested_amount numeric(12,2) · rationale jsonb   -- เก็บ input ของสูตร: spend_prev, roas_actual, roas_target
  status text check in (proposed, approved, rejected) default proposed
  approved_amount numeric(12,2)                       -- owner แก้เลขได้ตอนอนุมัติ
  decided_by -> auth.users · decided_at · created_at
  unique (shop_id, channel_id, period)
```
- RLS: SELECT tenant member · **approve/reject = owner เท่านั้น** (ไม่รวม admin — เงินจริง ให้แคบไว้ก่อน ขยายทีหลังง่ายกว่าหด) · แถว proposed สร้างโดย server action (คำนวณจากสูตร)
- **สูตรตั้งต้น (rule-based โปร่งใส จูนได้):** `suggested = clamp(spend_prev_month × (roas_actual / roas_target), spend_prev ± 30%)` — ROAS ดีกว่าเป้า → เพิ่มงบ, แย่กว่า → ลด, clamp ±30% กันเหวี่ยง · `roas_target` default 3.0 (owner เคาะ Q9) · เดือนแรกไม่มี spend_prev → เสนอ seed budget คงที่ที่ owner กำหนดเอง ระบบไม่เดา
- **จังหวะที่ 1 (B3c): approval = decision log** — อนุมัติแล้ว owner ไปตั้งงบเองใน Ads Manager · ระบบได้ครบ: เสนอ → อนุมัติ → เทียบผลจริง (spend ที่กรอกเข้า fact_ad_spend vs approved_amount) — **human-in-the-loop เต็มตัว ไม่มีเงินวิ่งอัตโนมัติ**
- **จังหวะที่ 2 (B3e — อนาคต): auto-execute ผ่าน Ads API** — ต้องพูดตรง: (1) TikTok/Meta Ads API ต้องขอ app access + เก็บ token (secret custody — Vercel env + service role เท่านั้น) (2) เป็น financial transaction ใช้เงินจริง ต้องมี hard cap ต่อวัน/เดือนใน DB + kill switch + idempotency กันยิงซ้ำ (3) ยิงจริงต้องสร้าง campaign บน platform → ตอนนั้น dim_campaign ถูกเขียนโดย integration และ campaign attribution เริ่มมี data path จริงเป็นครั้งแรก · **แนะนำ: อย่า commit B3e จนกว่าจังหวะที่ 1 รันแล้วอย่างน้อย 1-2 เดือนและ owner ยังต้องการ auto จริง** — มูลค่าเพิ่มของ "auto กด" เทียบ "ระบบเสนอ คนกดใน Ads Manager 2 นาที" ต่ำมากที่ scale ปัจจุบัน แต่ risk สูงสุดในทั้ง pipeline

---

## 7.0 Owner answers Q1-Q7 (2026-08-12)

- **Q1 budget:** ใช้ **daily budget + test→scale** (ไม่ใช่ก้อนใหญ่ยิงจนหมด) · ของใหม่ = seed test owner ตั้ง (เช่น 200/วัน×7) → มีผลค่อย scale ตาม ROAS · auto-ปิดถ้าขายไม่ได้ = platform rule อยู่เฟส B3e
- **Q2:** ข้าม campaign · **เพิ่ม R7 seasonal_calendar** — ปฏิทินเทศกาลไทย + เมกาเซล (7.7/8.8/9.9/11.11/12.12) เตือนล่วงหน้า 30 วัน (hardcode data)
- **Q3:** channel-level ไปก่อน · **TikTok integration (Shop+Ads API) = เฟสอนาคต** ปลดล็อก spend จริง+attribution+auto-ads · รอ data จาก admin ด้วย
- **Q4:** เปิดกฎตามแนะนำ (R0-R3, R6)
- **Q5:** internal use = OK (R1/R6 เดินได้) · clarify: export เบอร์ขึ้น ad platform = PII ออก third-party คนละเรื่อง + ได้แค่ลูกค้า LINE
- **Q6 roas_target:** **แก้เป็น margin-based** — break-even ROAS = 1/margin → ที่ margin 20% = **ROAS 5** (ไม่ใช่ 3 = ขาดทุน) · default ผูกกับ margin setting
- **Q7 product hero via images:** owner จะ capture รูปสินค้าไลฟ์ทุกชิ้น (~70-80/วัน = ~2.5GB/เดือน ไม่หนัก) → **AI pre-tag+จัดกลุ่มภาพ + คนยืนยัน+จดยอด** = รู้ winner **โดยไม่ต้องรอ PDF slip** · ต้อง link ภาพ↔ยอดขาย (จดตอนไลฟ์)

## 7. Locked future requirements (owner 2026-08-12 — ทำเมื่อมี product master/item data)

- **จัดการต้นทุนต่อ SKU เอง** — owner กรอก cost ต่อ SKU (เงิน×น้ำหนัก+ค่าแรง) → fact_order.cogs/profit ใช้ของจริงแทนประมาณการ 20% · ต้องมี `public.product` master + item-level data ก่อน (blocked เดียวกับ hero) · interim ระหว่างรอ = margin setting (ปรับ % แทน hardcode 20%)
- **Unknown-SKU alert → prompt เพิ่ม SKU** — เมื่อ import/ไลฟ์ เจอ SKU ที่ระบบไม่รู้จัก → เด้งแจ้งให้ owner ลงทะเบียน SKU ใหม่ (ชื่อ + ต้นทุน) ทันที "รู้จักไปพร้อมกัน" · เป็น master-data hygiene flow ผูกกับ item-data pipeline (B3d/B4) · card ใน copilot: "เจอ SKU ใหม่ N ตัวจากไลฟ์ล่าสุด — เพิ่มเข้าระบบ?"
