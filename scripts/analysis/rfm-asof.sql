-- scripts/analysis/rfm-asof.sql — RFM segment "ณ วันที่ใดๆ" (as-of) + ชุดวิเคราะห์ T1/T6 ของ Weekly Brief #5
--
-- อ่านอย่างเดียว · รันผ่าน query-sql.mjs (เปิด transaction READ ONLY + ROLLBACK เสมอ):
--   export PATH="/c/Program Files/nodejs:$PATH"
--   node scripts/query-sql.mjs scripts/analysis/rfm-asof.sql
-- รันเฉพาะบาง section: ตัดไฟล์ตามหัวข้อ "-- ==== Qn" ด้วย awk/sed แล้วส่งไฟล์ชั่วคราวให้ query-sql.mjs
--   (ตัวอย่าง Q7 เท่านั้น:  sed -n '/^-- ==== Q7/,$p' scripts/analysis/rfm-asof.sql > /tmp/q7.sql)
-- ผล analysis: docs/3j-jewelry/analytics/rfm-at-risk-and-new-cohort-2026-10-06.md
--
-- ===== วิธีแทนค่า as_of =====
-- Q0 (ตัวทั่วไป) แก้บรรทัดที่มีป้าย "<< EDIT" เพียงบรรทัดเดียว:
--     as_of    = เวลาที่อยากดู (ใส่ offset +07 เสมอ ห้ามปล่อยให้ตีความเป็น UTC)
--     as_known = false → "replay": ใช้ข้อมูล fact_order ปัจจุบันทั้งหมดที่ order_date <= as_of
--                true  → "as-known": เพิ่มเงื่อนไข created_at <= as_of คือเห็นเท่าที่ import เข้ามาแล้ว ณ เวลานั้น
--                         (ประมาณสิ่งที่วิวโชว์ตอนนั้น · ใช้ได้เฉพาะ >= 16 ส.ค. 69 เพราะ backfill ม.ค.-ก.ค. ถูก import ทีเดียว 14 ส.ค.)
-- Q1-Q7 มีวันที่ฝังใน CTE ของตัวเอง (หา "<< EDIT" ไม่ต้อง — แก้ตรง generate_series / values)
--
-- ===== กติกาที่ลอกจากวิว (pg_get_viewdef สด 6 ต.ค. 69) =====
-- แหล่งข้อมูล = analytics.v_fact_order (override order_date/revenue ของ crm_order_override) → รวมต่อ customer_id
--   → join analytics.dim_customer เฉพาะ merged_into_id is null  (= v_customer_master)
--   ใบที่ยกเลิก/tombstone (fact_order_deleted) ถูกลบออกจาก fact_order ไปแล้ว วิวจึงไม่เห็น — as-of ก็ไม่เห็นเช่นกัน
--   ใบที่ customer_id is null (25 ใบ ณ 6 ต.ค.) ถูกตัดทิ้งเหมือนวิว
-- segment CASE (ลำดับสำคัญ): no_orders → at_risk(>90d) → champion(<30d & oc>=4 & rev>1500) → loyal(<=90d & oc>=2)
--   → new(oc=1 & <30d) → standard
-- ⚠️ order_date เป็น DATE (ไม่มี order_at) · วิวคำนวณ now() - last_order_at::timestamptz  โดย session TimeZone = UTC
--   ⇒ ที่นี่เขียน (last_order::timestamp at time zone 'UTC') ให้ตรงกับวิวโดยไม่พึ่ง session setting
--   ผลข้างเคียง (เหมือนวิวทุกประการ): at_risk ⇔ (วันที่ UTC ของ as_of) - last_order >= 90 วัน · new ⇔ ห่าง <= 29 วัน
-- ⚠️ filter order_date ใช้ "วันไทยของ as_of" ((as_of at time zone 'Asia/Bangkok')::date) เพราะ order_date เป็นวันธุรกิจไทย
-- ⚠️ "จันทร์ 00:00 เวลาไทย" ในซีรีส์รายสัปดาห์ = as_of จันทร์ 00:00 ลบ 1 วินาที (= อาทิตย์ 23:59:59)
--   ไม่งั้นออเดอร์ของวันจันทร์เองจะหลุดเข้าไปในภาพ "ก่อนเริ่มวันจันทร์"

-- ==== Q0 — as-of ตัวทั่วไป: จำนวนต่อ segment ณ as_of ที่กำหนด ====
with p as (
  select timestamptz '2026-09-08 23:59:59+07' as as_of,   -- << EDIT
         false as as_known                                  -- << EDIT
),
o as (
  select v.customer_id, v.order_date, v.revenue
  from analytics.v_fact_order v cross join p
  where v.customer_id is not null
    and v.order_date <= (p.as_of at time zone 'Asia/Bangkok')::date
    and (not p.as_known or v.created_at <= p.as_of)
),
agg as (
  select customer_id, count(*) order_count, sum(revenue) revenue_sum, max(order_date) last_order_at
  from o group by customer_id
),
cm as (
  select dc.id customer_id, coalesce(a.order_count, 0) order_count, coalesce(a.revenue_sum, 0) revenue_sum, a.last_order_at
  from analytics.dim_customer dc left join agg a on a.customer_id = dc.id
  where dc.merged_into_id is null
),
seg as (
  select cm.customer_id,
    case
      when cm.order_count <= 0 or cm.last_order_at is null then 'no_orders'
      when p.as_of - (cm.last_order_at::timestamp at time zone 'UTC') > interval '90 days' then 'at_risk'
      when p.as_of - (cm.last_order_at::timestamp at time zone 'UTC') < interval '30 days' and cm.order_count >= 4 and cm.revenue_sum > 1500 then 'champion'
      when p.as_of - (cm.last_order_at::timestamp at time zone 'UTC') <= interval '90 days' and cm.order_count >= 2 then 'loyal'
      when cm.order_count = 1 and p.as_of - (cm.last_order_at::timestamp at time zone 'UTC') < interval '30 days' then 'new'
      else 'standard' end as segment
  from cm cross join p
)
select segment, count(*) as customers from seg group by segment order by segment;

-- ==== Q1 — พิสูจน์: as_of = now() ต้องตรงกับ v_rfm_segment เป๊ะ ทั้งราย customer ====
-- ผลที่ถูก: ทุกแถวมี asof_seg = view_seg (ไม่มีแถวมุมทแยง) · ถ้ามีแถวไม่ตรง = ห้ามสรุปต่อ
with p as (select now() as as_of, false as as_known),
o as (
  select v.customer_id, v.order_date, v.revenue
  from analytics.v_fact_order v cross join p
  where v.customer_id is not null
    and v.order_date <= (p.as_of at time zone 'Asia/Bangkok')::date
    and (not p.as_known or v.created_at <= p.as_of)
),
agg as (
  select customer_id, count(*) order_count, sum(revenue) revenue_sum, max(order_date) last_order_at
  from o group by customer_id
),
cm as (
  select dc.id customer_id, coalesce(a.order_count, 0) order_count, coalesce(a.revenue_sum, 0) revenue_sum, a.last_order_at
  from analytics.dim_customer dc left join agg a on a.customer_id = dc.id
  where dc.merged_into_id is null
),
seg as (
  select cm.customer_id,
    case
      when cm.order_count <= 0 or cm.last_order_at is null then 'no_orders'
      when p.as_of - (cm.last_order_at::timestamp at time zone 'UTC') > interval '90 days' then 'at_risk'
      when p.as_of - (cm.last_order_at::timestamp at time zone 'UTC') < interval '30 days' and cm.order_count >= 4 and cm.revenue_sum > 1500 then 'champion'
      when p.as_of - (cm.last_order_at::timestamp at time zone 'UTC') <= interval '90 days' and cm.order_count >= 2 then 'loyal'
      when cm.order_count = 1 and p.as_of - (cm.last_order_at::timestamp at time zone 'UTC') < interval '30 days' then 'new'
      else 'standard' end as segment
  from cm cross join p
)
select coalesce(s.segment, '(ไม่มีใน asof)') as asof_seg, coalesce(v.segment, '(ไม่มีในวิว)') as view_seg, count(*) as customers
from seg s full outer join analytics.v_rfm_segment v on v.customer_id = s.customer_id
group by 1, 2 order by 1, 2;

-- ==== Q2 — T1 ซีรีส์รายสัปดาห์: ทุก segment ณ จันทร์ 00:00 เวลาไทย 1 มิ.ย. - 5 ต.ค. 69 ====
-- as_known=false = replay (ข้อมูลปัจจุบัน) · as_known=true = as-known (เฉพาะ >= 17 ส.ค. เพราะก่อนหน้านั้น created_at ยังไม่มี backfill)
-- no_orders ไม่รายงาน (ใน replay หมายถึงลูกค้าที่ยังไม่เคยซื้อ ณ วันนั้น ไม่ใช่ลูกค้าจริงของวันนั้น)
with p as (
  select ((d::date)::timestamp - interval '1 second') at time zone 'Asia/Bangkok' as as_of, k.as_known   -- << EDIT ช่วงวันที่
  from generate_series(date '2026-06-01', date '2026-10-05', interval '7 days') d
  cross join (values (false), (true)) k(as_known)
),
o as (
  select p.as_of, p.as_known, v.customer_id, v.order_date, v.revenue
  from p join analytics.v_fact_order v
    on v.customer_id is not null
   and v.order_date <= (p.as_of at time zone 'Asia/Bangkok')::date
   and (not p.as_known or v.created_at <= p.as_of)
),
agg as (
  select as_of, as_known, customer_id, count(*) order_count, sum(revenue) revenue_sum, max(order_date) last_order_at
  from o group by 1, 2, 3
),
seg as (
  select p.as_of, p.as_known, a.customer_id,
    case
      when p.as_of - (a.last_order_at::timestamp at time zone 'UTC') > interval '90 days' then 'at_risk'
      when p.as_of - (a.last_order_at::timestamp at time zone 'UTC') < interval '30 days' and a.order_count >= 4 and a.revenue_sum > 1500 then 'champion'
      when p.as_of - (a.last_order_at::timestamp at time zone 'UTC') <= interval '90 days' and a.order_count >= 2 then 'loyal'
      when a.order_count = 1 and p.as_of - (a.last_order_at::timestamp at time zone 'UTC') < interval '30 days' then 'new'
      else 'standard' end as segment
  from p join agg a on a.as_of = p.as_of and a.as_known = p.as_known
  join analytics.dim_customer dc on dc.id = a.customer_id and dc.merged_into_id is null
)
select to_char((as_of at time zone 'Asia/Bangkok')::date + 1, 'YYYY-MM-DD') as monday_00_bkk, as_known,
  count(*) filter (where segment = 'at_risk') as at_risk,
  count(*) filter (where segment = 'new') as new,
  count(*) filter (where segment = 'loyal') as loyal,
  count(*) filter (where segment = 'champion') as champion,
  count(*) filter (where segment = 'standard') as standard,
  count(*) as with_orders
from seg
where as_known = false or as_of >= timestamptz '2026-08-16 23:59:59+07'
group by as_of, as_known order by as_known, as_of;

-- ==== Q3 — T1 แยก delta ของ at_risk เป็น (ก) aging-in (ข) returned-out (ค) อื่นๆ ====
-- ต่อ 1 ช่วง (t0 → t1) จับคู่ลูกค้าคนเดียวกันสองภาพ แล้วจัดกลุ่มคนที่ข้ามเส้น at_risk:
--   A_aging_in        = ไม่ at_risk ที่ t0 → at_risk ที่ t1 โดย last_order เดิม (คนแก่ตัวข้าม 90 วัน)   = (ก)
--   B_returned_out    = at_risk ที่ t0 → ไม่ at_risk ที่ t1 เพราะมีออเดอร์ที่ order_date > วัน t0       = (ข)
--   C_late_import_in  = (as-known) ลูกค้าที่ t0 ยังไม่มีออเดอร์ในระบบ แล้วโผล่เป็น at_risk ที่ t1 (import ย้อนหลัง) = (ค)
--   C_late_import_out = (as-known) หลุดจาก at_risk เพราะ import ออเดอร์ที่ order_date <= t0 ภายหลัง          = (ค)
--   C_other_*         = กรณีอื่น (ควรเป็น 0 — ถ้าไม่ใช่ต้องตามต่อ)
-- check ต้อง = 0 ทุกแถว (delta = ก - ข + ค)
-- ⚠️ merge: ลูกค้าถูก merge ครั้งเดียว 12 ส.ค. (72 แถว ก่อนช่วงนี้ทั้งหมด) และสถานะ merge ปัจจุบันใช้กับทุก as_of → ไม่มี effect ในช่วงที่วัด
-- ⚠️ ไม่มีทางจำลอง "ใบที่ถูกยกเลิกทีหลัง" (7 ใบ 8-9 ก.ย.) — ใน replay/as-known ใบเหล่านี้หายตั้งแต่ต้น
with w as (
  select 'weekly' as kind,
         ((d::date)::timestamp - interval '1 second') at time zone 'Asia/Bangkok' as t0,
         (((d::date + 7))::timestamp - interval '1 second') at time zone 'Asia/Bangkok' as t1
  from generate_series(date '2026-06-01', date '2026-09-28', interval '7 days') d    -- << EDIT
  union all
  select 'brief', t0, t1 from (values                                                  -- ช่วงตามวันที่อ้างใน Brief
    (timestamptz '2026-08-28 23:59:59+07', timestamptz '2026-09-11 23:59:59+07'),
    (timestamptz '2026-09-11 23:59:59+07', timestamptz '2026-09-16 23:59:59+07'),
    (timestamptz '2026-09-16 23:59:59+07', timestamptz '2026-09-27 23:59:59+07'),
    (timestamptz '2026-09-27 23:59:59+07', timestamptz '2026-10-05 23:59:59+07')) b(t0, t1)
),
wm as (
  select w.*, m.as_known from w cross join (values (false), (true)) m(as_known)
  where not m.as_known or w.t0 >= timestamptz '2026-08-16 23:59:59+07'
),
pts as (select t0 as as_of, as_known from wm union select t1, as_known from wm),
o as (
  select pts.as_of, pts.as_known, v.customer_id, v.order_date, v.revenue
  from pts join analytics.v_fact_order v
    on v.customer_id is not null
   and v.order_date <= (pts.as_of at time zone 'Asia/Bangkok')::date
   and (not pts.as_known or v.created_at <= pts.as_of)
),
agg as (
  select as_of, as_known, customer_id, count(*) order_count, sum(revenue) revenue_sum, max(order_date) last_order_at
  from o group by 1, 2, 3
),
snap as (
  select pts.as_of, pts.as_known, dc.id customer_id, coalesce(a.order_count, 0) order_count, a.last_order_at,
    case
      when a.customer_id is null then 'no_orders'
      when pts.as_of - (a.last_order_at::timestamp at time zone 'UTC') > interval '90 days' then 'at_risk'
      when pts.as_of - (a.last_order_at::timestamp at time zone 'UTC') < interval '30 days' and a.order_count >= 4 and a.revenue_sum > 1500 then 'champion'
      when pts.as_of - (a.last_order_at::timestamp at time zone 'UTC') <= interval '90 days' and a.order_count >= 2 then 'loyal'
      when a.order_count = 1 and pts.as_of - (a.last_order_at::timestamp at time zone 'UTC') < interval '30 days' then 'new'
      else 'standard' end as segment
  from pts cross join analytics.dim_customer dc
  left join agg a on a.as_of = pts.as_of and a.as_known = pts.as_known and a.customer_id = dc.id
  where dc.merged_into_id is null
),
cls as (
  select wm.kind, wm.as_known, wm.t0, wm.t1, s0.segment seg0, s1.segment seg1, s0.order_count oc0,
    case
      when s1.segment = 'at_risk' and s0.segment <> 'at_risk' then
        case when s0.segment = 'no_orders' then 'C_late_import_in'
             when s0.last_order_at = s1.last_order_at then 'A_aging_in'
             else 'C_other_in' end
      when s0.segment = 'at_risk' and s1.segment <> 'at_risk' then
        case when s1.segment = 'no_orders' then 'C_other_out'
             when s1.last_order_at > (wm.t0 at time zone 'Asia/Bangkok')::date then 'B_returned_out'
             else 'C_late_import_out' end
    end as cls
  from wm
  join snap s0 on s0.as_of = wm.t0 and s0.as_known = wm.as_known
  join snap s1 on s1.as_of = wm.t1 and s1.as_known = wm.as_known and s1.customer_id = s0.customer_id
)
select kind, as_known,
  to_char((t0 at time zone 'Asia/Bangkok')::date + case when kind = 'weekly' then 1 else 0 end, 'YYYY-MM-DD') as from_label,
  to_char((t1 at time zone 'Asia/Bangkok')::date + case when kind = 'weekly' then 1 else 0 end, 'YYYY-MM-DD') as to_label,
  count(*) filter (where seg0 = 'at_risk') as at_risk_t0,
  count(*) filter (where seg1 = 'at_risk') as at_risk_t1,
  count(*) filter (where seg1 = 'at_risk') - count(*) filter (where seg0 = 'at_risk') as delta,
  count(*) filter (where cls = 'A_aging_in') as a_aging_in,
  count(*) filter (where cls = 'A_aging_in' and oc0 = 1) as a_aging_in_onetime,
  count(*) filter (where cls = 'B_returned_out') as b_returned_out,
  count(*) filter (where cls = 'C_late_import_in') as c_late_in,
  count(*) filter (where cls = 'C_late_import_out') as c_late_out,
  count(*) filter (where cls = 'C_other_in') as c_other_in,
  count(*) filter (where cls = 'C_other_out') as c_other_out,
  count(*) filter (where seg1 = 'at_risk') - count(*) filter (where seg0 = 'at_risk')
    - (count(*) filter (where cls = 'A_aging_in') - count(*) filter (where cls = 'B_returned_out')
       + count(*) filter (where cls = 'C_late_import_in') - count(*) filter (where cls = 'C_late_import_out')
       + count(*) filter (where cls = 'C_other_in') - count(*) filter (where cls = 'C_other_out')) as check_must_be_0
from cls group by kind, as_known, t0, t1 order by kind desc, as_known, t0;

-- ==== Q4 — คนที่ aging-in ช่วง 28 ส.ค. → 11 ก.ย. มาจากวันไหน (last_order รายวัน) เทียบกับการซื้อ/ลูกค้าใหม่ของวันนั้น ====
-- กติกา: at_risk ณ วันไทย X ⇔ last_order + 90 <= X  ⇒ aging-in = last_order ใน [28 ส.ค.-89, 11 ก.ย.-90] = [31 พ.ค., 13 มิ.ย.]
with ord as (
  select v.customer_id, v.order_date
  from analytics.v_fact_order v join analytics.dim_customer dc on dc.id = v.customer_id and dc.merged_into_id is null
  where v.customer_id is not null
),
cust as (
  select customer_id, count(*) oc, min(order_date) first_d, max(order_date) last_d   -- << EDIT วันที่ใน where ด้านล่าง
  from ord where order_date <= date '2026-09-11' group by customer_id
),
days as (select d::date as dt from generate_series(date '2026-05-31', date '2026-06-13', interval '1 day') d)
select to_char(days.dt, 'YYYY-MM-DD') as last_order_date, to_char(days.dt, 'Dy') as dow,
  (select count(*) from cust c where c.last_d = days.dt) as aged_in_customers,
  (select count(*) from cust c where c.last_d = days.dt and c.oc = 1) as aged_in_onetime,
  (select count(*) from cust c where c.first_d = days.dt) as first_order_customers_that_day,
  (select count(*) from ord o where o.order_date = days.dt) as orders_that_day
from days order by days.dt;

-- ==== Q5 — T1 คาดการณ์ inflow at_risk 4 สัปดาห์ข้างหน้า (คนที่ last_order อยู่ช่วง 62-89 วัน ณ 4 ต.ค. 69 · k5-10 = เพดานล้วน) ====
-- k 1-4 ใช้คู่กับ Q5b ได้ · k 5-10 เป็นเพดานล้วน (คนกลุ่มนี้ยังอยู่ในช่วง 20-61 วันที่มีโอกาสซื้อซ้ำสูงกว่ามาก)
-- n_max = ถ้าไม่มีใครซื้อซ้ำเลย (เพดาน) · ฐานข้อมูลถึง order_date 3 ต.ค. (import ล่าสุด 4 ต.ค. 02:00 เวลาไทย)
-- c = วันที่เหลือก่อนข้ามเส้น (last_order + 90 - D0) · สัปดาห์ k = ceil(c/7) · week_monday = จันทร์ 00:00 เวลาไทยที่ภาพนั้นถูกตัด
with params as (select date '2026-10-04' as d0),      -- << EDIT วันอาทิตย์ปลายสัปดาห์ฐาน
cust as (
  select v.customer_id, count(*) oc, max(v.order_date) last_d
  from analytics.v_fact_order v
  join analytics.dim_customer dc on dc.id = v.customer_id and dc.merged_into_id is null
  cross join params
  where v.customer_id is not null and v.order_date <= params.d0
  group by v.customer_id
),
pool as (
  select c.*, (c.last_d + 90 - params.d0) as c_days from cust c cross join params
  where (c.last_d + 90 - params.d0) between 1 and 70
)
select ceil(c_days / 7.0)::int as k,
  to_char((select d0 from params) + 7 * ceil(c_days / 7.0)::int + 1, 'YYYY-MM-DD') as week_monday,
  count(*) as n_max, count(*) filter (where oc = 1) as n_onetime, count(*) filter (where oc >= 2) as n_repeat,
  case when ceil(c_days / 7.0)::int <= 4 then 'ใช้ได้ (มีฐาน Q5b)' else 'เพดานเท่านั้น (ไม่มีฐาน survival)' end as note
from pool group by 1, 2 order by 1;

-- ==== Q5b — ฐานสัดส่วน "ซื้อซ้ำทันก่อนข้ามเส้น" จากประวัติ ใช้ลดเพดานใน Q5 ====
-- ทุกวันอาทิตย์ D ตั้งแต่ 31 พ.ค. ถึง 30 ส.ค. (ต้องมีข้อมูลตามหลังอย่างน้อย 28 วันก่อน 3 ต.ค.) เอาลูกค้าที่ c in 1..28 แล้วดูว่ามีออเดอร์
-- order_date ใน (D, D+c] ไหม (ถ้ามี = last_order ขยับ ไม่ข้ามเส้น) · ลบข้อมูล 25 ใบ customer_id null ออกเหมือนวิว
with snaps as (select d::date as dd from generate_series(date '2026-05-31', date '2026-08-30', interval '7 days') d),
ord as (
  select v.customer_id, v.order_date
  from analytics.v_fact_order v join analytics.dim_customer dc on dc.id = v.customer_id and dc.merged_into_id is null
  where v.customer_id is not null
),
last_at as (
  select s.dd, o.customer_id, count(*) oc, max(o.order_date) last_d
  from snaps s join ord o on o.order_date <= s.dd group by s.dd, o.customer_id
),
pool as (
  select la.*, (la.last_d + 90 - la.dd) as c_days from last_at la where (la.last_d + 90 - la.dd) between 1 and 28
),
res as (
  select p.*, exists (select 1 from ord o2 where o2.customer_id = p.customer_id and o2.order_date > p.dd and o2.order_date <= p.dd + p.c_days) as returned
  from pool p
)
select ceil(c_days / 7.0)::int as k, count(*) as pool_n, count(*) filter (where returned) as returned_n,
  round(100.0 * count(*) filter (where returned) / count(*), 1) as returned_pct,
  count(*) filter (where oc = 1) as pool_onetime,
  round(100.0 * count(*) filter (where oc = 1 and returned) / nullif(count(*) filter (where oc = 1), 0), 1) as returned_pct_onetime
from res group by 1 order by 1;

-- ==== Q6 — T6 cohort new ณ freeze (8 มิ.ย./8 ก.ค./8 ส.ค./8 ก.ย. 69 23:59:59 เวลาไทย) → ออเดอร์ที่ 2 ภายใน 14 วัน ====
-- new = order_count=1 (นับถึง freeze) และ freeze - last_order < 30 วัน (กติกาเดียวกับวิว)
-- ซื้อซ้ำ 14 วัน = มีออเดอร์ order_date ใน (freeze, freeze+14]  (8 ก.ย. → 9-22 ก.ย.)
-- variant: replay = ข้อมูลปัจจุบัน · known = เฉพาะที่ import แล้ว ณ freeze (ใช้ได้เฉพาะ 8 ก.ย.)
-- ช่องทาง = ช่องทางของออเดอร์เดียวที่ลูกค้าคนนั้นมี ณ freeze · wilson = ช่วงเชื่อมั่น 95%
with fz as (
  select * from (values
    (date '2026-06-08', false), (date '2026-07-08', false), (date '2026-08-08', false),
    (date '2026-09-08', false), (date '2026-09-08', true)) v(frz, as_known)   -- << EDIT
),
ord as (
  select v.customer_id, v.order_date, v.channel_id, v.created_at
  from analytics.v_fact_order v join analytics.dim_customer dc on dc.id = v.customer_id and dc.merged_into_id is null
  where v.customer_id is not null
),
asof as (select frz, as_known, ((frz + 1)::timestamp - interval '1 second') at time zone 'Asia/Bangkok' as as_of from fz),
agg as (
  select a.frz, a.as_known, a.as_of, o.customer_id, count(*) oc, min(o.order_date) first_d, max(o.order_date) last_d
  from asof a join ord o on o.order_date <= a.frz and (not a.as_known or o.created_at <= a.as_of)
  group by a.frz, a.as_known, a.as_of, o.customer_id
),
cohort as (
  select g.frz, g.as_known, g.customer_id, g.first_d,
    (select ch.code from ord o join analytics.dim_channel ch on ch.id = o.channel_id
      where o.customer_id = g.customer_id and o.order_date = g.first_d
        and (not g.as_known or o.created_at <= g.as_of) limit 1) as channel,
    (select min(o2.order_date) from ord o2 where o2.customer_id = g.customer_id and o2.order_date > g.frz) as second_d
  from agg g
  where g.oc = 1 and g.as_of - (g.last_d::timestamp at time zone 'UTC') < interval '30 days'
),
m as (
  select frz, as_known, coalesce(channel, 'ALL') as channel, count(*) n,
    count(*) filter (where second_d <= frz + 14) k14,
    count(*) filter (where second_d is not null) k_any
  from cohort group by grouping sets ((frz, as_known, channel), (frz, as_known))
)
select to_char(frz, 'YYYY-MM-DD') as frz, case when as_known then 'known' else 'replay' end as variant, channel, n, k14,
  round(100.0 * k14 / n, 1) as pct_14d,
  round(100.0 * ((k14::numeric / n) + 3.8416 / (2 * n) - 1.96 * sqrt((k14::numeric / n) * (1 - k14::numeric / n) / n + 3.8416 / (4 * (n::numeric * n)))) / (1 + 3.8416 / n), 1) as wilson_lo,
  round(100.0 * ((k14::numeric / n) + 3.8416 / (2 * n) + 1.96 * sqrt((k14::numeric / n) * (1 - k14::numeric / n) / n + 3.8416 / (4 * (n::numeric * n)))) / (1 + 3.8416 / n), 1) as wilson_hi,
  k_any, round(100.0 * k_any / n, 1) as pct_any_to_date
from m order by frz, as_known, case when channel = 'ALL' then 0 else 1 end, channel;

-- ==== Q6b — cohort new (replay) แยกตาม "อายุ" นับจากออเดอร์แรก ณ freeze ====
-- เหตุผล: new = คนที่ยังไม่ซื้อซ้ำ ⇒ คนที่ซื้อซ้ำเร็ว (มัธยฐาน 6 วัน) หลุดจากกลุ่ม new ไปแล้ว → อายุมากหมายถึงผู้รอดคัดเลือก
--         ใช้เทียบว่าสัดส่วนอายุของ cohort ต่างกันแค่ไหนระหว่าง freeze (ตัวกวน mix)
with fz as (select * from (values (date '2026-06-08'), (date '2026-07-08'), (date '2026-08-08'), (date '2026-09-08')) v(frz)),   -- << EDIT
ord as (
  select v.customer_id, v.order_date
  from analytics.v_fact_order v join analytics.dim_customer dc on dc.id = v.customer_id and dc.merged_into_id is null
  where v.customer_id is not null
),
agg as (
  select fz.frz, o.customer_id, count(*) oc, max(o.order_date) last_d from fz join ord o on o.order_date <= fz.frz group by fz.frz, o.customer_id
),
cohort as (
  select a.frz, a.customer_id, (a.frz - a.last_d) as age_days,
    (select min(o2.order_date) from ord o2 where o2.customer_id = a.customer_id and o2.order_date > a.frz) as second_d
  from agg a
  where a.oc = 1 and ((a.frz + 1)::timestamp - interval '1 second') at time zone 'Asia/Bangkok' - (a.last_d::timestamp at time zone 'UTC') < interval '30 days'
)
select to_char(frz, 'YYYY-MM-DD') as frz_date,
  case when age_days <= 6 then '0-6 วัน' when age_days <= 13 then '7-13 วัน' when age_days <= 20 then '14-20 วัน' else '21-29 วัน' end as age_bucket,
  count(*) n, count(*) filter (where second_d <= frz + 14) k14,
  round(100.0 * count(*) filter (where second_d <= frz + 14) / count(*), 1) pct_14d
from cohort group by frz, 2 order by frz, min(age_days);

-- ==== Q6c — ตรวจสมมติฐาน "new = 507 คน ณ ตอนตั้งแคมเปญ" (campaign.created_at = 28 ส.ค. 03:07 เวลาไทย) ====
-- เทียบ replay กับ as-known ณ เวลาสร้างแคมเปญ และ ณ สิ้นวันที่ 27 ส.ค.
with pts as (
  select * from (values
    (timestamptz '2026-08-28 03:07:01+07', false), (timestamptz '2026-08-28 03:07:01+07', true),
    (timestamptz '2026-08-27 23:59:59+07', false), (timestamptz '2026-08-27 23:59:59+07', true)) v(as_of, as_known)   -- << EDIT
),
ord as (
  select v.customer_id, v.order_date, v.created_at, v.channel_id
  from analytics.v_fact_order v join analytics.dim_customer dc on dc.id = v.customer_id and dc.merged_into_id is null
  where v.customer_id is not null
),
agg as (
  select p.as_of, p.as_known, o.customer_id, count(*) oc, max(o.order_date) last_d
  from pts p join ord o on o.order_date <= (p.as_of at time zone 'Asia/Bangkok')::date and (not p.as_known or o.created_at <= p.as_of)
  group by p.as_of, p.as_known, o.customer_id
)
select to_char(a.as_of at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI') as as_of_bkk, a.as_known,
  count(*) filter (where a.oc = 1 and a.as_of - (a.last_d::timestamp at time zone 'UTC') < interval '30 days') as new_customers,
  count(*) filter (where a.oc = 1 and a.as_of - (a.last_d::timestamp at time zone 'UTC') < interval '30 days'
                   and exists (select 1 from ord o join analytics.dim_channel ch on ch.id = o.channel_id
                               where o.customer_id = a.customer_id and o.order_date = a.last_d and ch.code = 'line_oa')) as new_first_order_line
from agg a group by a.as_of, a.as_known order by a.as_of, a.as_known;

-- ==== Q7 — รายชื่อ cohort new 8 ก.ย. 69 (replay) สำหรับ CSV — ไม่มี PII (ไม่ select ชื่อ/เบอร์/LINE id) ====
-- สร้างไฟล์ CSV:
--   node scripts/query-sql.mjs --json <ไฟล์ที่ตัดเฉพาะ Q7> | node -e "..."   (ดูวิธีใน doc §ภาคผนวก)
-- คอลัมน์: customer_id · first_order_at (order_date ของออเดอร์เดียว) · channel · second_order_at (ออเดอร์แรกหลัง 8 ก.ย. ถึงข้อมูลล่าสุด · ว่างถ้ายังไม่มี) · second_within_14d
with fz as (select date '2026-09-08' as frz),                       -- << EDIT
ord as (
  select v.customer_id, v.order_date, v.channel_id
  from analytics.v_fact_order v join analytics.dim_customer dc on dc.id = v.customer_id and dc.merged_into_id is null
  where v.customer_id is not null
),
agg as (
  select o.customer_id, count(*) oc, max(o.order_date) last_d from ord o cross join fz where o.order_date <= fz.frz group by o.customer_id
)
select a.customer_id,
  to_char(a.last_d, 'YYYY-MM-DD') as first_order_at,
  (select ch.code from ord o join analytics.dim_channel ch on ch.id = o.channel_id where o.customer_id = a.customer_id and o.order_date = a.last_d limit 1) as channel,
  to_char((select min(o2.order_date) from ord o2 where o2.customer_id = a.customer_id and o2.order_date > fz.frz), 'YYYY-MM-DD') as second_order_at,
  coalesce((select min(o2.order_date) from ord o2 where o2.customer_id = a.customer_id and o2.order_date > fz.frz) <= fz.frz + 14, false) as second_within_14d
from agg a cross join fz
where a.oc = 1 and ((fz.frz + 1)::timestamp - interval '1 second') at time zone 'Asia/Bangkok' - (a.last_d::timestamp at time zone 'UTC') < interval '30 days'
order by a.last_d, a.customer_id;
