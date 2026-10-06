# Design — snapshot RFM รายสัปดาห์ (คนเข้า/ออก at_risk + cohort freeze)

> architect (Yoda) · 6 ต.ค. 69 · สถานะ: **design รอ Tech Lead/เจ้าของเคาะ** — ยังไม่มี migration
> ตอบ T1 (ทำไม at_risk โตทุกฉบับ) + T6 (cohort freeze) ที่ค้างใน Weekly Brief 4 ฉบับ
> ตัวเลขในไฟล์นี้ = snapshot วันที่เขียน (query สด 6 ต.ค. 69) ห้ามใช้แทน query

## 0. ของจริงที่ design นี้ยืนอยู่ (query สด 6 ต.ค. 69)

| ข้อเท็จจริง | ค่า | ผลต่อ design |
|---|---|---|
| ลูกค้า master (`merged_into_id is null`) | **4,073** (ทั้งหมด 4,145 · merge แล้ว 72) · ร้านเดียว | ต่อลูกค้าได้สบาย — ดู §1 |
| segment สด | at_risk 1,934 · loyal 785 · standard 645 · new 461 · champion 170 · no_orders 78 | no_orders ไม่ใช่สถานะ RFM — ไม่ snapshot (§2.3) |
| ออเดอร์ | 7,927 (5 ม.ค. – 2 ต.ค. 69) | backfill ย้อนได้ถึง ม.ค. แต่ at_risk มีความหมายจริงหลัง ~5 เม.ย. (90 วันหลังข้อมูลเริ่ม) |
| import lag (ตั้งแต่ ส.ค.) | p50 **2 วัน** · p90 **5 วัน** · max 36 · ใบที่ลง >7 วันหลัง order_date = 75/3,609 | snapshot ที่ถ่ายวันจันทร์ **ขาดข้อมูล ส.–อา. เป็นปกติ** — Brief #4 เองก็ import ล่าสุดศุกร์ 19:01 |
| ใบที่ถูก update หลังสร้าง ≥7 วัน | 1,765 ใบ (ลูกค้าสั่งเพิ่มบนใบเดิม — memory `orders-accumulate-across-days`) | กระทบ `revenue_sum`/m_score ย้อนหลัง · ไม่กระทบ `last_order_at` (order_date ค้างวันแรก) ⇒ **at_risk ทนต่อ lag มากกว่า new/champion** |
| `v_rfm_segment` สด | `now() - last_order_at::timestamptz` (DB = UTC · last_order_at เป็น date) · 0055 ต่อท้าย `value_tier` | ต้องแปลงเป็นกติกา "จำนวนวันเต็ม" ให้ถ่ายเวลาไหนก็ได้ค่าเดิม (§3.1) |
| FK → dim_customer | fact_order / fact_touchpoint `on delete set null` · pii_customer / identity / note `cascade` · dim_customer **ไม่เคยถูกลบจริง** (merge = soft ผ่าน merged_into_id) | ตาราง snapshot **ไม่ตั้ง FK** ไป dim_customer (§7) |
| `crm-pii-retention-180d` | scrub เฉพาะ `stg_order_import` · ไม่แตะ dim_customer/pii_customer (pii 4,059 แถว ยังไม่มีแถว scrub) | snapshot เก็บแค่ `customer_id` ⇒ ไม่ชน retention |
| pg_cron ที่มี | `crm-pii-retention-180d` (30 3 UTC) · `live-night-snapshot-capture-daily` (0 2 UTC) · DB TimeZone = **UTC** | ใช้ pattern 0146 (unschedule→schedule) · เวลาไทย = UTC+7 |
| campaign ที่ Brief วัดด้วย cohort | `d87c19b1` ครั้งที่ 2 (anchor 14 ก.ย.) · `a69dea60` ดึงลูกค้าเงียบ (19 ก.ย.) · `240c4df3` เงินแท่ง 1:1 (16 ก.ย.) · `campaign_step.audience_segment` เป็น text อยู่แล้ว | cohort ผูก `campaign_id` ได้ตรง (§6) |

## 1. ตัดสิน 1 — เก็บ **ต่อลูกค้า** (ไม่ใช่นับรวมต่อ segment)

Brief ต้องการ "ใครเข้า/ใครออก at_risk" + cohort freeze ⇒ นับรวมตอบไม่ได้ทั้งสองข้อ · ต่อลูกค้าอนุมานนับรวมได้เสมอ (view §5) แต่ย้อนกลับไม่ได้

**ขนาด**: วันนี้ 3,995 แถว/สัปดาห์ (4,073 − no_orders 78) · ลูกค้าใหม่ ~200–270/สัปดาห์ ⇒ สิ้นปีแรก ~14k ลูกค้า · รวม 52 สัปดาห์ ≈ **470k แถว** · แถวละ ~100 B + PK index ≈ **<100 MB/ปี** — ไม่ต้อง partition ไม่ต้องบีบ (YAGNI) · backfill ย้อน ม.ค.–ต.ค. 69 (39 อาทิตย์) ≈ 100k แถว

ทางที่ตัดทิ้ง: (ก) นับรวมต่อ segment — เล็กกว่า 1,000 เท่าแต่ตอบ T1/T6 ไม่ได้ · (ข) เก็บเฉพาะ "แถวที่เปลี่ยน segment" (event log) — เล็กกว่ามาก แต่ cohort freeze ต้อง reconstruct ทุกครั้ง และ bug ใน reconstruct = ประวัติผิดทั้งชุด · ขนาดยังไม่ใช่ปัญหา จึงเลือกแบบตรงไปตรงมา

## 2. ตัดสิน 2 — ตาราง 2 ชั้น: header run + detail ต่อลูกค้า

### 2.1 `as_of` = **วันอาทิตย์** (วันสุดท้ายที่นับรวม, เวลาไทย) ไม่ใช่วันจันทร์

บรีฟเสนอ "วันจันทร์" — ผมเลือก**อาทิตย์** เพราะ: (1) Brief รายงาน "จันทร์–อาทิตย์ที่เพิ่งจบ" ⇒ `as_of = อาทิตย์` อ่านตรงกับหน้าต่างรายงาน ไม่ต้องลบ 1 ในหัว (2) ฟังก์ชัน as-of นับ `order_date <= as_of` — ถ้า as_of เป็นจันทร์จะต้องเขียน `< as_of` ซึ่งต่างจาก convention ทุก RPC ในสคีมา (3) backfill ย้อนด้วย SQL ของ backend-dev ใช้ `<=` อยู่แล้ว · `as_of` เป็น `date` (ไม่ใช่ timestamptz) เพราะนิยาม RFM อิง `order_date` (date) ⇒ ไม่มีชั่วโมงให้เหลื่อม · เวลาถ่ายจริงอยู่ที่ `captured_at timestamptz` แยกต่างหาก

### 2.2 `is_backfill` คำนวณเอง ไม่ให้ caller บอก

`is_backfill := captured_on_thai > as_of + 1` — ถ่ายวันจันทร์ถัดจากอาทิตย์นั้น = สด · ถ่ายช้ากว่านั้น (cron ล้มแล้วรันซ้ำวันอังคาร / backfill ย้อน 30 สัปดาห์) = backfill อัตโนมัติ ⇒ ไม่มีทาง "ลืม flag" และ cron ที่ล้มแล้วรันชดเชยจะซื่อสัตย์เอง

### 2.3 ขอบเขตแถว

- เฉพาะลูกค้า master (`merged_into_id is null` **ณ เวลาถ่าย** — ประวัติ merge ย้อนหลังไม่มี ดู §4 ข้อจำกัด) ที่มี ≥1 ใบ `order_date <= as_of`
- **ไม่เก็บ `no_orders`** — เป็นถัง data-quality (ชื่อลูกค้าไม่มีใบ) ไม่ใช่สถานะ RFM · ผลคือ `sum(segment)` ใน view รายสัปดาห์ = `v_rfm_segment` สด − no_orders (ต้องเขียนไว้ใน Brief ครั้งแรกที่สลับมาใช้ snapshot)
- ไม่เก็บ `value_tier` (อนุมานได้: champion ∧ revenue_sum > 5000) · ไม่เก็บ affinity (ต้อง recompute จาก fact_order_item — ยังไม่มีใครขอ)
- เก็บ `reachable` (bool_or `dim_channel.is_contactable` ของใบ ≤ as_of — นิยามเดียวกับ 0120 Part B) เพราะ cohort "at_risk ที่ผูก LINE" ต้องใช้

### 2.4 DDL ร่าง

```sql
-- header: 1 แถวต่อ (shop, as_of) — Brief ใช้ดูความสดของข้อมูลใต้ snapshot
create table analytics.rfm_snapshot_run (
  shop_id          uuid not null references public.shop (id) on delete cascade,
  as_of            date not null,
  snapshot_kind    text not null check (snapshot_kind in ('weekly', 'adhoc')),
  captured_at      timestamptz not null default now(),
  captured_on      date not null,              -- (captured_at at time zone 'Asia/Bangkok')::date
  is_backfill      boolean not null,           -- captured_on > as_of + 1
  customers_n      int  not null check (customers_n >= 0),
  orders_n         int  not null check (orders_n >= 0),
  max_order_date   date,                       -- ใบล่าสุดที่ DB รู้จัก ณ ตอนถ่าย (ความสด — Shipnity ตามหลังจริง)
  note             text,
  primary key (shop_id, as_of),
  constraint rfm_snapshot_run_weekly_is_sunday
    check (snapshot_kind <> 'weekly' or extract(isodow from as_of) = 7)
);

-- detail: 1 แถวต่อ (shop, as_of, customer) — ไม่มี PII · ไม่มี FK ไป dim_customer (§7)
create table analytics.rfm_snapshot_customer (
  shop_id        uuid not null,
  as_of          date not null,
  customer_id    uuid not null,
  segment        text not null check (segment in ('new', 'standard', 'loyal', 'champion', 'at_risk')),
  r_score        smallint not null check (r_score between 1 and 3),
  f_score        smallint not null check (f_score between 1 and 3),
  m_score        smallint not null check (m_score between 1 and 3),
  recency_days   int not null check (recency_days >= 0),
  order_count    int not null check (order_count >= 1),
  revenue_sum    numeric(14,2) not null check (revenue_sum >= 0),
  first_order_at date not null,
  last_order_at  date not null,
  reachable      boolean not null,
  primary key (shop_id, as_of, customer_id),
  foreign key (shop_id, as_of) references analytics.rfm_snapshot_run (shop_id, as_of) on delete cascade
);
create index idx_rfm_snapshot_customer_cust on analytics.rfm_snapshot_customer (shop_id, customer_id, as_of);

alter table analytics.rfm_snapshot_run      enable row level security;
alter table analytics.rfm_snapshot_customer enable row level security;
-- policy select tenant_isolation แบบ 0146 (shop_member) — ไว้เป็นชั้นที่สอง แม้ authenticated ไม่มี USAGE บนสคีมา
grant select on analytics.rfm_snapshot_run, analytics.rfm_snapshot_customer to service_role;
-- ไม่ grant insert/update/delete ให้ใคร — เขียนผ่าน rfm_snapshot_capture (security definer) ทางเดียว
```

`revenue_sum` ตรง CHECK `>= 0`: ยืนยันก่อน apply ว่า `v_fact_order.revenue` ไม่มีค่าลบจริง (ใบ ฿0 มี · ใบติดลบยังไม่เคยเห็น — ถ้ามี ให้เปลี่ยนเป็น `not (revenue_sum < 0 ...)` ตาม trap #4/#13 ไม่ใช่ลด CHECK ทิ้ง)

## 3. ตัดสิน 3 — ใครถ่าย: `rfm_snapshot_capture` ตัวเดียว ใช้ทั้ง cron และ backfill

### 3.1 นิยาม RFM as-of (ต้องเท่ากับ `v_rfm_segment` สดทุกตัว — พิสูจน์ด้วย verify T3)

view สดใช้ `now() - last_order_at::timestamptz` เทียบ interval · เมื่อ `now()` ไม่ใช่เที่ยงคืน UTC พอดี ผลเทียบเท่ากับกติกา**วันเต็ม**นี้ (ให้ `d = as_of − last_order_at`):

| view สด | เทียบเท่า | ใช้ใน snapshot |
|---|---|---|
| `< interval '30 days'` | d ≤ 29 | `r_score = 3` |
| `<= interval '90 days'` | d ≤ 89 | `r_score = 2` |
| `> interval '90 days'` | **d ≥ 90** | `at_risk` · `r_score = 1` |

⚠️ **ต้องส่งให้ backend-dev ที่กำลังเขียน `scripts/analysis/rfm-asof.sql`**: at_risk = `recency_days >= 90` ไม่ใช่ `> 90` (ladder `91+` ของ 0120 คือ `> 90` — คนละเส้น เหลื่อม 1 วันโดยตั้งใจ ดู memory `retention-baseline-and-reach`) · F/M/segment ลอก case จาก view สดเป๊ะ · ฐาน = `v_fact_order` (รวม override layer B2 เหมือน `v_customer_master`) ไม่ใช่ `fact_order` ตรง · `order_date <= p_as_of` · master เท่านั้น · ตัด `customer_id is null`
⇒ เมื่อฟังก์ชันลงแล้ว `rfm-asof.sql` ควรเหลือหน้าที่ **cross-check** (verify T3) ไม่ใช่แหล่งที่สอง — fact หนึ่งอยู่ชั้นเดียว

### 3.2 signature

```sql
create function analytics.rfm_snapshot_capture(
  p_as_of    date    default null,     -- null = อาทิตย์ล่าสุดที่จบแล้ว (เวลาไทย): today - isodow(today)
  p_shop_id  uuid    default null,     -- null = ทุกร้าน (วันนี้มีร้านเดียว — ลอก 0146)
  p_kind     text    default 'weekly', -- 'weekly' (as_of ต้องเป็นอาทิตย์) | 'adhoc' (วันไหนก็ได้ — ใช้กับ cohort)
  p_replace  boolean default false     -- ทับ snapshot ที่ถ่ายไว้ "วันก่อนหน้า" (ดู 3.3)
) returns jsonb  -- {as_of, kind, is_backfill, shops:[{shop_id, customers_n, orders_n, max_order_date}]}
  language plpgsql security definer set search_path = public, pg_temp;
-- คืน jsonb ไม่ใช่ returns table — เลี่ยง trap #12 (ชื่อคอลัมน์ชน OUT var ตอนเรียก)
-- revoke execute from public, anon, authenticated; grant execute to service_role; (trap #2/#18)
```

ด่านใน body (เคสที่ห้ามผ่าน):
- `p_as_of > วันนี้ (ไทย)` → raise (snapshot อนาคต) · `p_as_of < date '2026-01-01'` → raise (ก่อนข้อมูลมี — กันพิมพ์ปีผิด)
- `p_kind = 'weekly'` และ `isodow(p_as_of) <> 7` → raise (CHECK ของตารางจับอีกชั้น)
- `p_kind` นอก 2 ค่า → raise
- มี `rfm_cohort` อ้าง `(shop_id, as_of)` นี้ → **raise แม้ `p_replace = true`** (cohort ที่ freeze แล้วต้องไม่ขยับ §6)

### 3.3 idempotent แบบมีเงื่อนไข — "ซ้ำวันเดียวกันทับได้ · ข้ามวันต้องสั่งชัด"

| เคส | ผล |
|---|---|
| ยังไม่มีแถว | insert |
| มีแถว · `captured_on = วันนี้ (ไทย)` | **ทับทั้งชุด** (delete detail ของ (shop, as_of) → insert ใหม่ · upsert header) — retry ของ cron / Brief เรียกซ้ำหลัง import เสร็จ |
| มีแถว · `captured_on < วันนี้` · `p_replace = false` | **raise** `rfm snapshot (as_of) captured on <วัน> — pass p_replace` |
| มีแถว · `captured_on < วันนี้` · `p_replace = true` · ไม่มี cohort อ้าง | ทับ + `is_backfill` คำนวณใหม่ (จะกลายเป็น true) + `note` บันทึกว่า replaced |

ทำไมไม่ upsert เฉยๆ ตามบรีฟ: upsert ต่อแถวทิ้ง**ลูกค้าที่หายไป** (merge แล้ว) ค้างในชุดเก่า ⇒ ต้อง delete+insert ทั้งชุดอยู่ดี · และการทับ snapshot ข้ามวันโดยไม่รู้ตัวคือสิ่งที่ Brief กลัวที่สุด ("เลขเปลี่ยนใต้เท้า") จึงให้มีต้นทุนเป็นการสั่งชัดๆ

### 3.4 pg_cron

```sql
-- จันทร์ 00:05 ไทย = อาทิตย์ 17:05 UTC (DB เป็น UTC — 0146 ใช้ '0 2 * * *' = 09:00 ไทย เป็นหลักฐาน)
-- ห่อด้วย do-block unschedule ก่อนเหมือน 0024/0146
select cron.schedule('rfm-snapshot-weekly', '5 17 * * 0', 'select analytics.rfm_snapshot_capture();');
```

ทำไม 00:05 ไม่ใช่หลัง 09:00 ที่เจ้าของควร import เสร็จ: ของจริง Brief #4 import ล่าสุดคือ**ศุกร์** 19:01 — ไม่มีเวลาไหนในวันจันทร์ที่ "ข้อมูลครบ" ⇒ เลือกเวลาที่**รับประกันว่ามีแถวก่อน Brief รัน** (Brief รัน "จันทร์เช้า" ไม่ระบุโมง) แล้วให้ Brief เรียก `rfm_snapshot_capture()` ซ้ำได้ถ้า import เพิ่งเสร็จ (วันเดียวกัน = ทับได้ตาม 3.3) · ความสดของแต่ละ snapshot อ่านจาก `max_order_date` ใน header — Brief ต้องพิมพ์ค่านี้ใน §0 เสมอ

## 4. ตัดสิน 4 — import ย้อนหลัง: **(ก) ถ่ายสดแล้วไม่แก้** + backfill เฉพาะช่วงก่อนตารางเกิด

| ทางเลือก | ตัด/เลือก | เหตุผล |
|---|---|---|
| (ก) ถ่ายสด ไม่ recompute | **เลือก** | เลขไม่เปลี่ยนหลังวันที่ถ่าย · flow "เข้า/ออก" นิยามได้ชัดว่า "ตามที่ DB รู้ ณ สองจุดเวลา" · ใบที่ import ช้าโผล่เป็น `repurchased` สัปดาห์ถัดไป (ช้า ไม่ผิด) |
| (ข) ถ่ายสด + recompute ย้อน N สัปดาห์ทุกรอบ | ตัด | Brief จะได้ตัวเลขสัปดาห์เดียวกัน 2 ค่าใน 2 ฉบับ — ปัญหาเดียวกับที่ 0146 แก้ด้วย "ล็อกที่ T+3" · ถ้าวันหน้าต้องการ "final ที่ T+7" ทำได้โดย cron เรียก `capture(as_of-7, p_replace=>true)` เพิ่ม 1 บรรทัด + เพิ่ม `finalized_at` ใน header — ไม่ต้องรื้อ schema |
| (ค) ไม่ถ่าย คำนวณตอนอ่าน | ตัด | ตอบ "ใครอยู่ใน audience ตอนส่งจริง" ไม่ได้ (merge/ยกเลิก/ใบสะสมเขียนทับประวัติ) และ Brief อยากเทียบเลขที่**เคยรายงานไปแล้ว** ไม่ใช่เลขที่ถูกต้องที่สุดวันนี้ |

สิ่งที่ (ก) ยอมรับและ Brief ต้องรู้:
- snapshot ล่าสุดนับ `new`/`champion`/`revenue_sum` **ต่ำกว่าจริง** ตาม import lag (p50 2 วัน) · `at_risk` ทนกว่าเพราะขึ้นกับ `order_date` ที่ไม่ขยับ — ใบ import ช้าทำได้แค่**ดึงคนออก**จาก at_risk ไม่ใส่เพิ่ม ⇒ at_risk ใน snapshot = **ขอบบน**
- backfill ย้อน (ม.ค.–ต.ค. 69) คำนวณจาก fact_order วันนี้ ⇒ รวม merge/ยกเลิก/ใบสะสมที่เกิดหลังวันนั้นแล้ว — ดีกว่าจริง ณ วันนั้น · ติด `is_backfill = true` ทุกแถว · Brief ห้ามเทียบ WoW ข้ามรอยต่อ backfill→สด โดยไม่บอก
- ยกเลิกใบ (tombstone `fact_order_deleted`, 7 ใบ) ทำ `last_order_at` ถอยหลัง → อาจ "เข้า at_risk" ด้วยเหตุ `order_removed` ไม่ใช่ `aging` — view §5 แยกให้

## 5. ตัดสิน 5 — view สำหรับ Brief (ทุกตัว `security_invoker = true` · grant select service_role)

### 5.1 `v_rfm_segment_weekly` — นับต่อ segment ต่อสัปดาห์ + WoW

```sql
select r.shop_id, r.as_of, r.is_backfill, r.max_order_date, c.segment,
       count(*) as customers,
       sum(c.revenue_sum) as revenue_sum,
       lag(count(*)) over (partition by r.shop_id, c.segment order by r.as_of) as customers_prev,
       lag(r.as_of)   over (partition by r.shop_id, c.segment order by r.as_of) as prev_as_of
from analytics.rfm_snapshot_run r
join analytics.rfm_snapshot_customer c using (shop_id, as_of)
where r.snapshot_kind = 'weekly'
group by r.shop_id, r.as_of, r.is_backfill, r.max_order_date, c.segment;
-- prev_as_of <> as_of - 7 = มีสัปดาห์หาย (cron ล้ม) — Brief ต้องเขียนว่าเทียบข้ามช่องว่าง ไม่ใช่ WoW
```

### 5.2 `v_rfm_flow_weekly_customer` — รายคน เข้า/ออก at_risk ระหว่าง 2 snapshot weekly ติดกัน (`prev.as_of = cur.as_of − 7` เท่านั้น)

full outer join detail ของ (as_of) กับ (as_of−7) บน customer_id · left join `dim_customer` เพื่อรู้ว่าคนที่หายไปถูก merge หรือไม่:

| direction | reason | เงื่อนไข |
|---|---|---|
| `in` | `aging` | prev มี · prev.segment ≠ at_risk · cur = at_risk · `cur.last_order_at = prev.last_order_at` |
| `in` | `order_removed` | เหมือนบน แต่ `cur.last_order_at < prev.last_order_at` (ยกเลิกใบ/แก้ใบ) |
| `in` | `appeared` | prev ไม่มี · cur = at_risk (ลูกค้าเก่าเพิ่ง import ย้อน / unmerge) |
| `out` | `repurchased` | prev = at_risk · cur ≠ at_risk · `cur.last_order_at > prev.last_order_at` |
| `out` | `merged` | prev = at_risk · cur ไม่มี · `dim_customer.merged_into_id is not null` |
| `out` | `removed` | prev = at_risk · cur ไม่มี · ไม่ได้ merge (ใบถูกลบจนไม่เหลือ / ลบลูกค้า) |

คอลัมน์: shop_id, as_of, prev_as_of, customer_id, direction, reason, segment_prev, segment_cur, reachable (ของ cur หรือ prev ถ้า cur หาย) — ใช้สร้าง audience "คนที่เพิ่งเข้า at_risk สัปดาห์นี้และติดต่อได้" ได้ทันที

### 5.3 `v_rfm_flow_weekly` — 1 แถวต่อสัปดาห์ (ตอบ Brief §1 "at_risk +x WoW" ใน query เดียว)

```sql
select shop_id, as_of, prev_as_of,
       at_risk_prev, at_risk_cur, at_risk_cur - at_risk_prev as delta,
       in_aging, in_order_removed, in_appeared,
       out_repurchased, out_merged, out_removed,
       in_total_reachable, out_repurchased_reachable
-- จาก group by ของ 5.2 + join นับ at_risk ของสอง run · invariant ที่ verify ต้องยืนยัน:
-- at_risk_cur - at_risk_prev = (in_aging + in_order_removed + in_appeared) - (out_repurchased + out_merged + out_removed)
```

Brief query: `select * from analytics.v_rfm_flow_weekly where shop_id = :shop order by as_of desc limit 2;`
T1 ("ทำไม at_risk โตทุกฉบับ") ตอบจาก `in_aging` vs `out_repurchased` โดยตรง — ถ้า in_aging ≈ ลูกค้าใหม่เมื่อ 13 สัปดาห์ก่อน × (1 − 30% ซื้อซ้ำ) แปลว่าเป็นโครงสร้าง ไม่ใช่สัญญาณใหม่

## 6. ตัดสิน 6 — cohort: ตาราง registry + member **ชุดเดียวใช้ทุกแคมเปญ** (ไม่อ้าง snapshot แบบ derived)

| ทางเลือก | ตัด/เลือก | เหตุผล |
|---|---|---|
| อ้าง `(as_of, segment)` ใน snapshot ตรงๆ | ตัด | cohort จริงมีเงื่อนไขเกิน segment ("at_risk ∧ reachable ก่อน 13 ก.ย." · "order_count = 1 ณ 14 ก.ย.") และต้องพึ่ง snapshot ห้ามถูกทับตลอดไป — กฎ 3.3 กันได้ แต่ผูก 2 ตารางด้วยวินัย ไม่ใช่โครงสร้าง |
| ตารางต่อแคมเปญ | ตัด | บรีฟห้าม · ไม่ scale |
| **`rfm_cohort` (registry) + `rfm_cohort_member`** | **เลือก** | member list = "คนที่เราส่งถึงจริง" เป็น fact ของตัวเอง · immutable ด้วยโครงสร้าง (ไม่มี grant update/delete · freeze key ซ้ำ = raise) · วัดผลแคมเปญ = join member → fact_order หลัง as_of |

```sql
create table analytics.rfm_cohort (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shop (id) on delete cascade,
  cohort_key   text not null,                        -- เช่น 'new-freeze-2026-09-08'
  campaign_id  uuid references analytics.campaign (id) on delete set null,
  as_of        date not null,
  rule         jsonb not null,                       -- {"segments":["at_risk"],"reachable":true,"order_count_eq":1,...}
  is_backfill  boolean not null,                     -- freeze หลัง as_of + 1 = reconstruct ไม่ใช่ของจริงตอนส่ง
  members_n    int not null check (members_n >= 0),
  note         text,
  created_at   timestamptz not null default now(),
  unique (shop_id, cohort_key),
  foreign key (shop_id, as_of) references analytics.rfm_snapshot_run (shop_id, as_of)  -- capture ห้าม delete run ที่ถูกอ้าง (3.2)
);
create table analytics.rfm_cohort_member (
  cohort_id             uuid not null references analytics.rfm_cohort (id) on delete cascade,
  customer_id           uuid not null,
  segment_at_freeze     text not null,
  order_count_at_freeze int not null,
  recency_at_freeze     int not null,
  reachable_at_freeze   boolean not null,
  primary key (cohort_id, customer_id)
);
-- RLS on · grant select service_role · ไม่มี insert/update/delete ให้ใคร
create function analytics.rfm_cohort_freeze(
  p_shop_id uuid, p_cohort_key text, p_as_of date, p_rule jsonb,
  p_campaign_id uuid default null, p_note text default null
) returns jsonb  -- {cohort_id, members_n, is_backfill}
-- ขั้นตอน: ถ้าไม่มี run (shop, as_of) → เรียก capture(p_as_of, kind='adhoc') ก่อน · key ซ้ำ → raise (ไม่ upsert)
-- rule ที่รับ: segments text[] · reachable bool · order_count_eq / order_count_min int · recency_min / recency_max int
-- key อื่นใน jsonb → raise (กัน rule ที่สะกดผิดแล้วกลายเป็น "ทุกคน" เงียบๆ)
```

ทำไม `rule` เป็น jsonb ไม่ใช่คอลัมน์: เงื่อนไขมี 5 แบบวันนี้และจะงอก — แต่**ด่าน whitelist key** บังคับ (บทเรียน label-upload: ตัด key จาก whitelist ไม่ใช่ blacklist)
cohort 3 ตัวที่ Brief ใช้อยู่ reconstruct ได้ทันทีหลัง backfill (ทั้งหมด `is_backfill = true` — Brief ต้องบอกว่าเป็นการสร้างย้อน): `new-freeze-2026-09-08` {segments:[new]} · `at-risk-line-2026-09-13` {segments:[at_risk], reachable:true} · `one-time-2026-09-14` {order_count_eq:1}

**Phase 2** — ไม่บล็อก Phase 1 · วัดผล (`rfm_cohort_outcome(p_cohort_key, p_window_days)` → ซื้อหลัง as_of กี่คน/กี่บาท) ยังไม่ออกแบบ รอ CMO ยืนยันนิยามผลลัพธ์ต่อแคมเปญก่อน

## 7. สิทธิ์ / RLS / PII

- ตารางใหม่ทั้ง 4: RLS on + policy select `tenant_isolation` แบบ 0146 · **grant select เฉพาะ service_role** · ไม่มี grant เขียนให้ role ใด (เขียนผ่าน 2 ฟังก์ชัน security definer เท่านั้น)
- ฟังก์ชัน 2 ตัว: `revoke execute from public, anon, authenticated` + `grant to service_role` · ไม่ใส่ `crm_require_owner_admin` เพราะไม่มี end-user caller (เหมือน `live_night_snapshot_capture`) — ถ้าวันหน้าเปิดปุ่ม "freeze cohort" บน UI ให้ห่อด้วย server action ที่เช็ค role ก่อน ไม่แก้ฟังก์ชัน
- ไม่มีคอลัมน์ PII (ไม่มีชื่อ/เบอร์/ที่อยู่/display_name) — verify T11 ตรวจจาก `information_schema.columns`
- **ไม่ตั้ง FK `customer_id → dim_customer`** ตั้งใจ: (1) dim_customer ไม่เคยถูกลบจริงวันนี้ (merge = soft) (2) ถ้าอนาคตมี PDPA erasure ลบ dim_customer จริง snapshot ต้องไม่ถูก cascade หายจนยอดประวัติเปลี่ยน — `customer_id` เป็น pseudonymous key ไม่ใช่ PII · งาน erasure ตัดสินเองว่าจะ null/ลบ · trade-off: orphan uuid เป็นไปได้ ⇒ view 5.2 ใช้ left join dim_customer เสมอ ไม่ใช่ inner
- หลัง apply รัน `node scripts/run-sql.mjs scripts/check-analytics-grants.sql` (trap #18.3)

## 8. retention ของ snapshot

- **ไม่ลบอัตโนมัติในรอบนี้** — <100 MB/ปี ไม่คุ้มเขียน purge ที่ต้องยกเว้น run ที่ cohort อ้าง · เกณฑ์กลับมาทำ: `rfm_snapshot_customer` > 2M แถว หรือ Supabase แจ้ง storage ⇒ ค่อยเพิ่ม `rfm_snapshot_purge(p_keep_weeks := 104)` ที่ข้าม run ซึ่ง `rfm_cohort` อ้าง
- `crm-pii-retention-180d` ไม่กระทบ: scrub staging เท่านั้น · snapshot ไม่มี PII · dim_customer ไม่ถูกลบ ⇒ ไม่มี FK ให้พัง

## 9. แผน backfill (ทำครั้งเดียวหลัง apply)

```sql
-- weekly ทุกอาทิตย์ 11 ม.ค. 69 → อาทิตย์ล่าสุดที่จบแล้ว (เวลาไทย) — ทุกแถวได้ is_backfill = true อัตโนมัติ
select analytics.rfm_snapshot_capture(g.d::date, null, 'weekly', false)
from generate_series(
       date '2026-01-11',
       (now() at time zone 'Asia/Bangkok')::date - extract(isodow from (now() at time zone 'Asia/Bangkok')::date)::int,
       interval '7 days') as g(d);
-- adhoc สำหรับ cohort 3 ตัว: rfm_cohort_freeze(...) สร้าง run adhoc ให้เอง (8/13 ก.ย. 69 · 14 ก.ย. เป็นอาทิตย์ ใช้ run weekly เดิม)
```

- ซ้อมใน rollback ก่อน (`run-sql.mjs` ไม่ใส่ `--commit`) นับแถวต่อ run และดู at_risk ไต่ขึ้นเมื่อไหร่ (ควรเป็น 0 ก่อน ~5 เม.ย.)
- ข้อมูล ม.ค.–ก.ค. coverage ไม่เต็ม (memory `data-coverage-status`) ⇒ snapshot ช่วงนั้นใช้ดู**แนวโน้ม** ไม่ใช่ระดับ · Brief เริ่มอ้าง WoW สดได้ตั้งแต่ snapshot แรกที่ `is_backfill = false` (อาทิตย์ 11 ต.ค. 69 ถ้า apply ทันสัปดาห์นี้)
- หลัง backfill รัน flow view ย้อนทั้งปีเพื่อตอบ T1 ครั้งเดียว — คำตอบไปอยู่ใน Brief #5 ไม่ใช่ใน memory

## 10. ไฟล์ที่ต้องสร้าง/แก้

| path | หน้าที่ |
|---|---|
| `supabase/migrations/0158_rfm_snapshot.sql` | 2 ตาราง snapshot + `rfm_snapshot_capture` + 3 view + cron (Phase 1) |
| `supabase/migrations/0159_rfm_cohort.sql` | 2 ตาราง cohort + `rfm_cohort_freeze` (Phase 2 — แยกไฟล์เพื่อให้ Phase 1 ลงก่อนจันทร์หน้าได้) |
| `scripts/verify/verify-0158.sql` · `verify-0159.sql` | do-block + raise rollback (§11) |
| `scripts/analysis/rfm-asof.sql` (backend-dev) | เหลือเป็น cross-check ของ T3 · หัวไฟล์ต้องชี้มาที่ฟังก์ชันว่าเป็นแหล่งจริง |
| `docs/3j-jewelry/marketing/weekly-brief/TEMPLATE.md` ข้อ 7 | เปลี่ยนเป็น "อ่าน `v_rfm_flow_weekly` + `v_rfm_segment_weekly` · พิมพ์ `max_order_date`/`is_backfill` ของ run" — แก้พร้อมฉบับที่เริ่มใช้ บอกเหตุผลใน commit |
| `~/.claude/scheduled-tasks/weekly-marketing-brief/SKILL.md` | เพิ่มขั้น "เรียก `rfm_snapshot_capture()` ซ้ำถ้า import หลัง 00:05" (นอก repo — Tech Lead ทำเอง) |
| `docs/3j-jewelry/INDEX.md` · `READING-LISTS.md` §5 | เพิ่มไฟล์นี้ + migration ใหม่ |
| memory ใหม่ `rfm-snapshot` (หลัง apply) | ชี้มาที่ไฟล์นี้ + วันที่ snapshot สดแรก — ไม่ copy ตัวเลข |

## 11. verify checklist (`scripts/verify/verify-0158.sql` — do-block เดียว ปิดด้วย raise · state ต้องไม่ขยับ)

| # | เคส | ต้องได้ |
|---|---|---|
| T1 | object ครบ · `has_function_privilege(anon/authenticated)` = false · service_role = true · RLS on ทั้ง 2 ตาราง · ไม่มี overload (trap #1) | ผ่าน |
| T2 | `capture(อาทิตย์ล่าสุด)` บนข้อมูลจริง | `customers_n` = count master ที่มีใบ ≤ as_of · ไม่มี customer ซ้ำ · ไม่มีแถว merged · header.customers_n = count(detail) · ทุก segment ที่มีจริงบน prod ปรากฏ (trap #17) |
| **T3** | **เทียบกับ view สด**: `capture(p_as_of := current_date /*UTC*/, kind 'adhoc')` แล้ว join `v_rfm_segment` ต่อ customer (ตัด no_orders) | segment/r/f/m ต่างกัน = **0 แถว** (ยกเว้นรันคร่อม 00:00 UTC พอดี — ให้เทสต์ raise ถ้า `now()::time` อยู่ใน 23:59–00:01) |
| T4 | เรียกซ้ำ as_of เดิมในทรานแซกชันเดียวกัน | จำนวนแถวเท่าเดิม · ไม่ซ้ำ · `captured_at` = `now()` (trap #22: ห้าม assert "ใหม่กว่า") |
| T5 | จำลอง run ที่ `captured_on = เมื่อวาน` (update header ตรงๆ ในฐานะ postgres) แล้วเรียกโดยไม่ `p_replace` | raise · ใส่ `p_replace` → ผ่านและ `is_backfill = true` · มี `rfm_cohort` อ้าง → raise แม้ p_replace (0159) |
| T6 | `as_of = today − 10` → `is_backfill = true` · `as_of = อาทิตย์ล่าสุด` (รันวันจันทร์) → false | ตรงทั้งคู่ — ถ้ารันเทสต์วันอื่นให้ assert สูตร `captured_on > as_of + 1` แทน |
| T7 | as_of อนาคต · as_of < 2026-01-01 · weekly ที่ไม่ใช่อาทิตย์ · kind แปลก · shop ไม่มี | raise ทุกเคส (shop ไม่มี → 0 shops ใน jsonb ไม่ใช่ error — ตัดสินให้ชัดในไฟล์) |
| T8 | insert 2 run สังเคราะห์ (as_of, as_of−7) ครอบทั้ง 6 reason ใน §5.2 (รวม merged: ต้องสร้าง dim_customer ชั่วคราวที่ merged_into_id ไม่ null) | แต่ละ reason นับได้ 1 เป๊ะ · invariant 5.3 (delta = in − out) จริง |
| T9 | `v_rfm_segment_weekly` เมื่อสัปดาห์ก่อนหายไป (ลบ run as_of−7 ในทรานแซกชัน) | `customers_prev` มาจาก run ที่มีจริงก่อนหน้า + `prev_as_of <> as_of − 7` — ไม่ใช่ 0 |
| T10 | `cron.job` มี `rfm-snapshot-weekly` schedule `5 17 * * 0` command ตรง · ไม่ซ้อนหลัง replay | 1 แถว |
| T11 | `information_schema.columns` ของ 4 ตารางใหม่ ไม่มีชื่อคอลัมน์ ~ `name|phone|address|email|line` | 0 แถว |
| T12 | `revenue_sum` ไม่มีค่าลบใน v_fact_order จริงก่อน apply (ตรวจ CHECK) · `recency_days >= 0` ทุกแถวที่ capture | ผ่าน |
| T13 | state ไม่ขยับ: count `rfm_snapshot_run/customer`, `cron.job` ก่อน/หลัง do-block | เท่าเดิม |
| T14 | `scripts/check-analytics-grants.sql` หลัง apply | สะอาด |
| ไม่มีเทสต์ครอบ | "เลขไม่เปลี่ยนใต้เท้าข้ามสัปดาห์" — พิสูจน์ได้จริงเมื่อ cron รัน 2 รอบจริง (สัปดาห์ 11 + 18 ต.ค.) ไม่ใช่ใน do-block · ให้ QA นัดเช็ค `md5(string_agg(...))` ของ run 11 ต.ค. ซ้ำสัปดาห์ถัดไป | ระบุในตารางส่งงาน |

## 12. ความเสี่ยง / จุดที่ต้องระวังตอน implement

1. **view สด vs ฟังก์ชันเหลื่อมกัน 1 วันตามเขตเวลา**: view ใช้วัน UTC · snapshot ใช้ `as_of` ไทย — T3 ต้องเทียบด้วย `current_date` (UTC) ไม่ใช่วันไทย ไม่งั้น FAIL ปลอม
2. **trap #12**: ถ้า backend-dev เปลี่ยนใจใช้ `returns table` — ชื่อ `as_of`/`segment` ชน CTE แน่ · ยืนยันคืน jsonb
3. **trap #19**: migration นี้ไม่มี UPDATE ตารางเดิม · backfill เป็น insert ล้วน — ห้ามแอบ `update dim_customer.last_order_at` เพื่อ "ช่วย" (คอลัมน์นั้น transform ไม่เคยเติม ดู 0020 คอมเมนต์)
4. **delete+insert ใน capture กับ FK จาก rfm_cohort**: FK (shop_id, as_of) → run ไม่ cascade ⇒ delete run ที่ถูกอ้างจะ error 23503 เอง — เป็นด่านชั้นสองของ 3.2 ไม่ใช่ตัวหลัก (ข้อความ error ของเราต้องมาก่อน)
5. **Brief เปลี่ยนแหล่งตัวเลข**: at_risk จาก snapshot ≠ 1,923 ที่เคยรายงาน (no_orders ไม่รวม + วันต่างกัน) — ฉบับแรกที่สลับต้องวางตัวเลขทั้งสองเคียงกันแล้วอธิบาย ไม่ใช่สลับเงียบ (TEMPLATE กติกา "ห้ามเปลี่ยนแม่แบบเงียบๆ")
6. **เลข migration**: 0157 อยู่บน main แล้ว (gem quiz v2 ยังไม่ apply) — ถ้า 0157 apply ช้ากว่า 0158 ลำดับ version ใน DB จะสลับกับชื่อไฟล์ (เหมือน 0120 คู่แฝด) ไม่พัง แต่ต้องเขียนหัวไฟล์
7. **cron ล้มวันจันทร์** = สัปดาห์นั้นหายถาวรแบบสด — รันชดเชยได้แต่จะติด `is_backfill` · ควรให้ Brief ตรวจ `prev_as_of = as_of − 7` และแจ้ง Tech Lead ทันทีที่ขาด (ไม่ต้องมี alert เพิ่มในรอบนี้)
8. **ร้านเดียววันนี้** — `p_shop_id = null` วน `public.shop` ทุกร้านเหมือน 0146 · อย่า hardcode shop uuid ในฟังก์ชัน (ใน SKILL ของ Brief มีอยู่แล้ว เป็นเรื่องของผู้เรียก)
9. **ขีดจำกัด command line บน Windows (~8K ตัวอักษร)** — ตอนเขียน migration/verify ขนาดใหญ่ด้วย heredoc ผ่าน Bash tool จะถูกตัดเงียบแล้วพังด้วย `unexpected EOF` ที่บรรทัดสุ่ม (เจอจริงตอนเขียนไฟล์นี้) ⇒ เขียนเป็นชิ้น <6KB แล้ว `cat` ต่อ หรือใช้ editor tool

## 13. สิ่งที่ต้องให้เจ้าของ/Tech Lead เคาะก่อนเขียน migration

- O1 `as_of` = **อาทิตย์** (ต่างจากบรีฟที่เสนอจันทร์) — เหตุผล §2.1
- O2 ไม่ recompute ย้อน (ทาง ก) — Brief ยอมรับว่า `new`/`champion` สัปดาห์ล่าสุดต่ำกว่าจริงตาม import lag และพิมพ์ `max_order_date` กำกับเสมอ
- O3 cohort = ตาราง member จริง (Phase 2, 0159) — CMO ต้องส่งนิยาม rule ของ cohort ที่ใช้อยู่ 3 ตัวมายืนยันก่อน freeze ย้อน
- O4 ไม่ snapshot `no_orders` ⇒ ผลรวม segment ใน Brief จะไม่เท่า `v_rfm_segment` สด (ต่าง 78 วันนี้)
