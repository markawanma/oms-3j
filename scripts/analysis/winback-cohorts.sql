-- scripts/analysis/winback-cohorts.sql — T11: cohort ย้อนหลังของ win-back (d) และ ครั้งที่ 2 (f) + baseline
--
-- สถานะ: รันผ่านบน DB จริง 6 ต.ค. 69 (ข้อมูล fact_order ถึง order_date 6 ต.ค.) · ผลสรุปอยู่
--   docs/3j-jewelry/analytics/winback-cohorts-2026-10-06.md · ตัวเลขทุกตัวเป็น snapshot ณ วันนั้น ห้ามใช้แทน query สด
--
-- อ่านอย่างเดียว:  export PATH="/c/Program Files/nodejs:$PATH"
--   node scripts/query-sql.mjs scripts/analysis/winback-cohorts.sql      (query-sql.mjs เปิด READ ONLY + ROLLBACK เสมอ)
--   ⚠️ connection ไป session pooler หลุดเป็นช่วงๆ (ECONNRESET) — รันซ้ำได้ ไม่มี side effect
--   รันบาง section: ตัดตามหัวข้อ "-- ==== Qn" ด้วย sed แล้วส่งไฟล์ชั่วคราว (เหมือน rfm-asof.sql)
--
-- นิยาม (ตั้งใจให้ตรง scripts/analysis/rfm-asof.sql และ docs/.../rfm-at-risk-and-new-cohort-2026-10-06.md §2.1):
--   แหล่งข้อมูล = analytics.v_fact_order + dim_customer (merged_into_id is null) · ตัดใบ customer_id is null
--   as_of        = 23:59:59 +07 ของวัน frz (ลบ lag วัน) · order_date เป็น DATE · recency ใช้เที่ยงคืน UTC ตามวิว
--   at_risk      ⇔ as_of - last_order(UTC midnight) > 90 วัน              (cohort d)
--   f  = one-time ทุกอายุ  (order_count = 1)                              ← นิยามตามบรีฟ T11 (ส่วนใหญ่อยู่ใน at_risk ด้วย)
--   fr = one-time และ "ไม่ at_risk" (อายุออเดอร์ <= 90 วัน)                ← ใกล้ขนาด 171 ที่ hypothesis อ้างที่สุด (Hypothesis)
--   fn = one-time และอายุ < 30 วัน = segment `new` ของ v_rfm_segment       ← audience_segment ที่ลงใน campaign_step ของ d87c19b1
--   กลับมา       = มีออเดอร์ (ช่องทางใดก็ได้) order_date ใน (frz - lag, frz + 14]   lag=0: cohort ณ สิ้นวันส่ง นับ 14 วันถัดไป (เหมือน T6)
--   lag = 1      = sensitivity: freeze สิ้นวันก่อนส่ง + นับตั้งแต่วันส่ง (กันออเดอร์วันส่งที่เกิดก่อนข้อความออก)
--
-- 🔴 นิยาม "ผูก LINE" (ตัดสินจากผล Q0 · 6 ต.ค. 69):
--   dim_customer_identity มีแค่ identity_type = phone / tiktok_handle — **ไม่มี line_id เลย** · channel_follower_log = 0 แถว ·
--   dim_customer.pdpa_consent = false ทุกแถว · ไม่มี timestamp ว่าเพิ่มเพื่อน LINE OA ที่ไหนในระบบ
--   ⇒ "ผูก LINE" ทำได้แค่ proxy: มีออเดอร์ช่องทาง line_oa อย่างน้อย 1 ใบ ที่ order_date <= วัน freeze (line_first_d)
--   พลาดได้ 4 ทาง: (1) คนที่เป็นเพื่อน LINE แต่ไม่เคยสั่งผ่าน LINE (เช่น ลูกค้า TikTok ที่สแกนการ์ดในกล่อง) = ไม่นับ → cohort ต่ำกว่าจริง
--   (2) สั่งผ่าน LINE แล้ว block/unfriend = นับเกิน (3) ลูกค้าคนเดียวสั่ง 2 ช่องทางแต่ถูกสร้างเป็น 2 customer (phone vs tiktok_handle) = ไม่เชื่อม
--   (4) ไม่ใช่ audience จริงที่ส่ง — audience จริงของ 30d43365/d87c19b1 ไม่มี log (artifact 0/1) · ใช้ได้เฉพาะ "ตัวเศษประมาณ" ไม่ใช่ตัวหาร
--   ⚠️ ไม่ใช่ v_audience.reachable (นั่นรวม facebook และเป็น lifetime ไม่ผูกวัน)

-- ==== Q0 — probe นิยาม "ผูก LINE": identity + ช่องทาง ====
select 'identity_by_type' as k, identity_type as a, count(*)::text as n,
       to_char(min(created_at at time zone 'Asia/Bangkok'), 'YYYY-MM-DD') as min_created,
       to_char(max(created_at at time zone 'Asia/Bangkok'), 'YYYY-MM-DD') as max_created
from analytics.dim_customer_identity group by identity_type
union all
select 'line_id_rows', 'line_id', count(*)::text, null, null
from analytics.dim_customer_identity where identity_type = 'line_id'
union all
select 'follower_log_rows', 'channel_follower_log', count(*)::text, null, null from analytics.channel_follower_log
union all
select 'pdpa_consent', pdpa_consent::text, count(*)::text, null, null
from analytics.dim_customer where merged_into_id is null group by pdpa_consent
order by 1, 2;

select ch.code, ch.is_contactable, count(*) as orders, count(distinct v.customer_id) as customers,
       to_char(min(v.order_date), 'YYYY-MM-DD') as first_order, to_char(max(v.order_date), 'YYYY-MM-DD') as last_order
from analytics.v_fact_order v join analytics.dim_channel ch on ch.id = v.channel_id
group by 1, 2 order by 1;

-- ==== Q0b — ลูกค้าที่เคยสั่ง line_oa: มีกี่คนที่สั่งช่องทางอื่นด้วย (ใต้ customer_id เดียวกัน) ====
with ord as (
  select v.customer_id, ch.code from analytics.v_fact_order v
  join analytics.dim_customer dc on dc.id = v.customer_id and dc.merged_into_id is null
  join analytics.dim_channel ch on ch.id = v.channel_id where v.customer_id is not null
)
select count(*) filter (where has_line) as cust_with_line_order,
       count(*) filter (where has_line and has_tiktok) as line_and_tiktok_same_customer,
       count(*) filter (where has_line and not has_tiktok) as line_only,
       count(*) filter (where has_tiktok and not has_line) as tiktok_only
from (select customer_id, bool_or(code = 'line_oa') has_line, bool_or(code = 'tiktok') has_tiktok from ord group by customer_id) t;

-- ==== Q1 — ขนาด cohort + กลับมา (d, f, fr, fn · baseline) พร้อม Wilson 95% ====
-- n_all = ทุกคนในกลุ่ม · n_line = เฉพาะที่ผูก LINE (proxy) · k14 = กลับมาใน 14 วัน (เฉพาะ n_line) · k14_all = ไม่สนใจ LINE
-- k_first = กลับมาก่อน/ใน frz+5 (d 13 ก.ย.: 14-18 ก.ย. ก่อน a69dea60 ยิงครั้งแรก 19 ก.ย.) · k_after = หลังจากนั้นถึง frz+14
-- เช็คตัวเอง: d_2026-09-13 n_all ต้อง = 1,694 (rfm-asof Q2 14 ก.ย. at_risk) · fn_2026-09-14_lag1 n_all ต้อง = 500 (rfm-asof Q2 14 ก.ย. new)
with runs as (
  select * from (values
    ('d_2026-09-13',      'd',  date '2026-09-13', 0), ('d_2026-09-13_lag1',  'd',  date '2026-09-13', 1),
    ('d_2026-08-13',      'd',  date '2026-08-13', 0), ('d_2026-07-13',       'd',  date '2026-07-13', 0), ('d_2026-06-13', 'd', date '2026-06-13', 0),
    ('f_2026-09-14',      'f',  date '2026-09-14', 0), ('f_2026-09-14_lag1',  'f',  date '2026-09-14', 1),
    ('f_2026-08-14',      'f',  date '2026-08-14', 0), ('f_2026-07-14',       'f',  date '2026-07-14', 0), ('f_2026-06-14', 'f', date '2026-06-14', 0),
    ('fr_2026-09-14',     'fr', date '2026-09-14', 0), ('fr_2026-09-14_lag1', 'fr', date '2026-09-14', 1),
    ('fr_2026-08-14',     'fr', date '2026-08-14', 0), ('fr_2026-07-14',      'fr', date '2026-07-14', 0), ('fr_2026-06-14', 'fr', date '2026-06-14', 0),
    ('fn_2026-09-14',     'fn', date '2026-09-14', 0), ('fn_2026-09-14_lag1', 'fn', date '2026-09-14', 1),
    ('fn_2026-08-14',     'fn', date '2026-08-14', 0), ('fn_2026-07-14',      'fn', date '2026-07-14', 0), ('fn_2026-06-14', 'fn', date '2026-06-14', 0)
  ) v(run_id, kind, frz, lag)
),
ord as (
  select v.customer_id, v.order_date, ch.code as ch
  from analytics.v_fact_order v
  join analytics.dim_customer dc on dc.id = v.customer_id and dc.merged_into_id is null
  join analytics.dim_channel ch on ch.id = v.channel_id
  where v.customer_id is not null
),
agg as (
  select r.run_id, r.kind, r.frz, r.lag, o.customer_id, (r.frz - r.lag) as cut_d,
         count(*) as oc, max(o.order_date) as last_d,
         min(o.order_date) filter (where o.ch = 'line_oa') as line_first_d,
         ((r.frz - r.lag + 1)::timestamp - interval '1 second') at time zone 'Asia/Bangkok' as as_of
  from runs r join ord o on o.order_date <= r.frz - r.lag
  group by r.run_id, r.kind, r.frz, r.lag, o.customer_id
),
cohort as (
  select a.*, (select min(o2.order_date) from ord o2 where o2.customer_id = a.customer_id and o2.order_date > a.cut_d) as ret_d
  from agg a
  where (a.kind = 'd'  and a.as_of - (a.last_d::timestamp at time zone 'UTC') > interval '90 days')
     or (a.kind = 'f'  and a.oc = 1)
     or (a.kind = 'fr' and a.oc = 1 and a.as_of - (a.last_d::timestamp at time zone 'UTC') <= interval '90 days')
     or (a.kind = 'fn' and a.oc = 1 and a.as_of - (a.last_d::timestamp at time zone 'UTC') < interval '30 days')
),
m as (
  select run_id, kind, frz, lag,
    count(*) as n_all, count(*) filter (where line_first_d is not null) as n_line,
    count(*) filter (where line_first_d is not null and ret_d <= frz + 14) as k14,
    count(*) filter (where line_first_d is not null and ret_d <= frz + 5) as k_first,
    count(*) filter (where line_first_d is not null and ret_d > frz + 5 and ret_d <= frz + 14) as k_after,
    count(*) filter (where ret_d <= frz + 14) as k14_all
  from cohort group by run_id, kind, frz, lag
)
select run_id, n_all, n_line, k14, k_first, k_after,
  round(100.0 * k14 / nullif(n_line, 0), 2) as pct_14d,
  round(100.0 * ((k14::numeric / n_line) + 3.8416 / (2 * n_line) - 1.96 * sqrt((k14::numeric / n_line) * (1 - k14::numeric / n_line) / n_line + 3.8416 / (4 * (n_line::numeric * n_line)))) / (1 + 3.8416 / n_line), 2) as wilson_lo,
  round(100.0 * ((k14::numeric / n_line) + 3.8416 / (2 * n_line) + 1.96 * sqrt((k14::numeric / n_line) * (1 - k14::numeric / n_line) / n_line + 3.8416 / (4 * (n_line::numeric * n_line)))) / (1 + 3.8416 / n_line), 2) as wilson_hi,
  k14_all, round(100.0 * k14_all / nullif(n_all, 0), 2) as pct_14d_all_cust_ignoring_line
from m where n_line > 0
order by case kind when 'd' then 1 when 'f' then 2 when 'fr' then 3 else 4 end, frz desc, lag;

-- ==== Q2 — ทับซ้อน (d)∩(f) + ช่องทาง/ช่วงเวลาของคนที่กลับมา (lag = 0 · d = freeze 13 ก.ย. · f = freeze 14 ก.ย.) ====
-- in_d = at_risk ณ สิ้น 13 ก.ย. · in_f = one-time ทุกอายุ ณ สิ้น 14 ก.ย. · in_fr = one-time ไม่ at_risk · in_fn = one-time < 30 วัน
-- ⚠️ in_d กับ in_fr เป็น 0 โดยนิยาม (at_risk ณ 13 ก.ย. → วันถัดไปอายุ > 90 วันยิ่งกว่า) — เป็น sanity check ไม่ใช่ข้อค้นพบ
-- ret_window: d = 14-18 ก.ย. / 19-27 ก.ย. · f = 15-19 ก.ย. / 20-28 ก.ย. (ตัดที่ frz+5 · วัน a69dea60 ครั้งแรก = 19 ก.ย.)
with ord as (
  select v.customer_id, v.order_date, ch.code as ch
  from analytics.v_fact_order v
  join analytics.dim_customer dc on dc.id = v.customer_id and dc.merged_into_id is null
  join analytics.dim_channel ch on ch.id = v.channel_id
  where v.customer_id is not null
),
cd as (  -- cohort d
  select customer_id, count(*) oc, max(order_date) last_d, min(order_date) filter (where ch = 'line_oa') line_first_d
  from ord where order_date <= date '2026-09-13' group by customer_id
  having timestamptz '2026-09-13 23:59:59+07' - (max(order_date)::timestamp at time zone 'UTC') > interval '90 days'
),
cf as (  -- one-time ณ 14 ก.ย. (f) พร้อมธงอายุ
  select customer_id, max(order_date) last_d, min(order_date) filter (where ch = 'line_oa') line_first_d,
    (timestamptz '2026-09-14 23:59:59+07' - (max(order_date)::timestamp at time zone 'UTC')) as age
  from ord where order_date <= date '2026-09-14' group by customer_id having count(*) = 1
),
u as (
  select coalesce(d.customer_id, f.customer_id) customer_id,
    (d.customer_id is not null) in_d, (f.customer_id is not null) in_f,
    coalesce(f.age <= interval '90 days', false) in_fr, coalesce(f.age < interval '30 days', false) in_fn,
    coalesce(d.line_first_d, f.line_first_d) line_first_d
  from cd d full join cf f on f.customer_id = d.customer_id
)
select 'overlap' as sec, in_d::text as a, in_f::text as b, in_fr::text as c, in_fn::text as d,
       (line_first_d is not null)::text as line_proxy, count(*)::text as n, null::text as e
from u group by in_d, in_f, in_fr, in_fn, (line_first_d is not null)
union all
select 'returned', 'd', (u.line_first_d is not null)::text, ret.ch,
       case when ret.d <= date '2026-09-18' then '14-18 ก.ย.' else '19-27 ก.ย.' end, null, count(*)::text, null
from u join lateral (
  select min(o.order_date) d, string_agg(distinct o.ch, '+' order by o.ch) filter (where o.order_date = (select min(o2.order_date) from ord o2 where o2.customer_id = u.customer_id and o2.order_date > date '2026-09-13')) ch
  from ord o where o.customer_id = u.customer_id and o.order_date > date '2026-09-13' and o.order_date <= date '2026-09-27') ret on ret.d is not null
where u.in_d group by 3, 4, 5
union all
select 'returned', case when u.in_fr then 'fr' when u.in_f then 'f_gt90' end, (u.line_first_d is not null)::text, ret.ch,
       case when ret.d <= date '2026-09-19' then '15-19 ก.ย.' else '20-28 ก.ย.' end, null, count(*)::text, null
from u join lateral (
  select min(o.order_date) d, string_agg(distinct o.ch, '+' order by o.ch) filter (where o.order_date = (select min(o2.order_date) from ord o2 where o2.customer_id = u.customer_id and o2.order_date > date '2026-09-14')) ch
  from ord o where o.customer_id = u.customer_id and o.order_date > date '2026-09-14' and o.order_date <= date '2026-09-28') ret on ret.d is not null
where u.in_f group by 2, 3, 4, 5
order by 1, 2, 3, 4, 5;

-- ==== Q3d — รายชื่อ cohort (d) at_risk ณ สิ้น 13 ก.ย. 69 (lag 0) สำหรับ CSV — ไม่มี PII (ไม่ select ชื่อ/เบอร์/LINE id) ====
-- สร้าง CSV: ตัด section นี้ไปไฟล์ชั่วคราว (จนก่อนหัวข้อ Q3f) → node scripts/query-sql.mjs <ไฟล์> --json → แปลงเป็น CSV (header + LF)
-- line_proxy_first_order = วันที่ของออเดอร์ line_oa ใบแรก (ค่าประมาณวันผูก LINE · ว่าง = ไม่ผูกตาม proxy)
-- returned_at = ออเดอร์แรกหลัง 13 ก.ย. ถึงข้อมูลล่าสุด · returned_within_14d = returned_at <= 27 ก.ย. · in_d_and_f = ยังเป็น one-time ณ 14 ก.ย. ด้วย
with ord as (
  select v.customer_id, v.order_date, ch.code as ch
  from analytics.v_fact_order v
  join analytics.dim_customer dc on dc.id = v.customer_id and dc.merged_into_id is null
  join analytics.dim_channel ch on ch.id = v.channel_id
  where v.customer_id is not null
),
cd as (
  select customer_id, count(*) oc, max(order_date) last_d, min(order_date) filter (where ch = 'line_oa') line_first_d
  from ord where order_date <= date '2026-09-13' group by customer_id
  having timestamptz '2026-09-13 23:59:59+07' - (max(order_date)::timestamp at time zone 'UTC') > interval '90 days'
),
oc14 as (select customer_id from ord where order_date <= date '2026-09-14' group by customer_id having count(*) = 1)
select c.customer_id,
  to_char(c.line_first_d, 'YYYY-MM-DD') as line_proxy_first_order,
  to_char(c.last_d, 'YYYY-MM-DD') as last_order_before_freeze,
  c.oc as order_count,
  to_char(r.d, 'YYYY-MM-DD') as returned_at,
  r.ch as returned_channel,
  coalesce(r.d <= date '2026-09-27', false) as returned_within_14d,
  (f.customer_id is not null) as in_d_and_f
from cd c
left join oc14 f on f.customer_id = c.customer_id
left join lateral (
  select o.order_date d, string_agg(distinct o.ch, '+' order by o.ch) ch
  from ord o where o.customer_id = c.customer_id
    and o.order_date = (select min(o2.order_date) from ord o2 where o2.customer_id = c.customer_id and o2.order_date > date '2026-09-13')
  group by o.order_date) r on true
order by c.last_d, c.customer_id;

-- ==== Q3f — รายชื่อ cohort (f) one-time ณ สิ้น 14 ก.ย. 69 (ทุกอายุ · lag 0) สำหรับ CSV — ไม่มี PII ====
-- f_scope: new_lt30 (= fn, segment new) · le90 (= fr ส่วนที่อายุ 30-90 วัน) · gt90 (ส่วนที่เกิน 90 วัน ซึ่งส่วนใหญ่อยู่ใน (d) ด้วย)
-- returned_within_14d = ออเดอร์ที่ 2 ภายใน 28 ก.ย. · in_d_and_f = เป็น at_risk ณ 13 ก.ย. ด้วย
with ord as (
  select v.customer_id, v.order_date, ch.code as ch
  from analytics.v_fact_order v
  join analytics.dim_customer dc on dc.id = v.customer_id and dc.merged_into_id is null
  join analytics.dim_channel ch on ch.id = v.channel_id
  where v.customer_id is not null
),
cf as (
  select customer_id, max(order_date) last_d, min(order_date) filter (where ch = 'line_oa') line_first_d
  from ord where order_date <= date '2026-09-14' group by customer_id having count(*) = 1
),
ar13 as (
  select customer_id from ord where order_date <= date '2026-09-13' group by customer_id
  having timestamptz '2026-09-13 23:59:59+07' - (max(order_date)::timestamp at time zone 'UTC') > interval '90 days'
)
select c.customer_id,
  to_char(c.line_first_d, 'YYYY-MM-DD') as line_proxy_first_order,
  to_char(c.last_d, 'YYYY-MM-DD') as last_order_before_freeze,
  (date '2026-09-14' - c.last_d) as age_days_at_freeze,
  case when timestamptz '2026-09-14 23:59:59+07' - (c.last_d::timestamp at time zone 'UTC') < interval '30 days' then 'new_lt30'
       when timestamptz '2026-09-14 23:59:59+07' - (c.last_d::timestamp at time zone 'UTC') <= interval '90 days' then 'le90' else 'gt90' end as f_scope,
  to_char(r.d, 'YYYY-MM-DD') as returned_at,
  r.ch as returned_channel,
  coalesce(r.d <= date '2026-09-28', false) as returned_within_14d,
  (a.customer_id is not null) as in_d_and_f
from cf c
left join ar13 a on a.customer_id = c.customer_id
left join lateral (
  select o.order_date d, string_agg(distinct o.ch, '+' order by o.ch) ch
  from ord o where o.customer_id = c.customer_id
    and o.order_date = (select min(o2.order_date) from ord o2 where o2.customer_id = c.customer_id and o2.order_date > date '2026-09-14')
  group by o.order_date) r on true
order by c.last_d, c.customer_id;

-- ==== Q4 — ออเดอร์ line_oa รายวัน 6-30 ก.ย. + คนแรกที่กลับมาจาก cohort (d) (ทุกช่องทาง) ในแต่ละวัน ====
-- ใช้ดู "วันที่ออเดอร์ LINE พุ่ง" เทียบวันที่แคมเปญ a69dea60 ตั้งไว้ (19/22/26 ก.ย.) · ⚠️ ไม่ใช่หลักฐานว่าส่งจริง (ดู Q5 + R11)
-- d_first_return_* = ออเดอร์แรกหลัง 13 ก.ย. ของคนใน cohort (d) ที่ตกในวันนั้น · line = เฉพาะที่ผูก LINE (proxy)
with ord as (
  select v.customer_id, v.order_date, ch.code as ch
  from analytics.v_fact_order v
  join analytics.dim_customer dc on dc.id = v.customer_id and dc.merged_into_id is null
  join analytics.dim_channel ch on ch.id = v.channel_id
  where v.customer_id is not null
),
cd as (
  select customer_id, min(order_date) filter (where ch = 'line_oa') line_first_d from ord where order_date <= date '2026-09-13' group by customer_id
  having timestamptz '2026-09-13 23:59:59+07' - (max(order_date)::timestamp at time zone 'UTC') > interval '90 days'
),
fr as (select c.customer_id, c.line_first_d, (select min(o.order_date) from ord o where o.customer_id = c.customer_id and o.order_date > date '2026-09-13') as ret_d from cd c)
select to_char(g.d, 'YYYY-MM-DD Dy') as dt,
  (select count(*) from ord o where o.order_date = g.d and o.ch = 'line_oa') as line_orders_all,
  (select count(*) from fr where fr.ret_d = g.d) as d_first_return_all,
  (select count(*) from fr where fr.ret_d = g.d and fr.line_first_d is not null) as d_first_return_line
from generate_series(date '2026-09-06', date '2026-09-30', interval '1 day') g(d) order by g.d;

-- ==== Q5 — step ช่องทาง LINE ทุกตัวใน analytics.campaign_step: วันตามแผน (anchor + offset) + สถานะ ====
-- ตรวจ "baseline มี broadcast LINE ไปกลุ่มนี้ไหม" ได้เท่าที่ระบบจดไว้ — ตาราง campaign เริ่มใช้ 15 ส.ค. 69 (campaign ตัวแรก) ⇒ ก่อนนั้นไม่มี record = ตรวจไม่ได้ (ไม่ใช่ "ไม่มี")
-- status: done = เจ้าของยืนยันว่าส่ง · scheduled/todo/waiting_data = ไม่มีหลักฐานว่าส่ง (artifact 0/1)
select left(c.id::text, 8) as cid, left(c.name, 28) as campaign, s.seq, s.step_kind, coalesce(s.audience_segment, '(ไม่ระบุ)') as audience, s.status,
  to_char(c.anchor_date + s.offset_start_days, 'YYYY-MM-DD') as planned_from,
  to_char(c.anchor_date + coalesce(s.offset_end_days, s.offset_start_days), 'YYYY-MM-DD') as planned_to
from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id
where s.channel = 'line_oa' order by c.anchor_date + s.offset_start_days, c.created_at, s.seq;
