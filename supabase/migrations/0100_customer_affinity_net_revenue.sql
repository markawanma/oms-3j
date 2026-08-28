-- 0100_customer_affinity_net_revenue.sql
-- แก้เคสห้ามผ่านข้อ 5 ที่ 0099 ตกจริงตอนทดสอบบน DB (384 ลูกค้า):
-- bar_revenue + jewelry_revenue มากกว่า revenue_sum
--
-- ต้นเหตุ (ยืนยันแล้ว ผลต่าง = discount พอดีทุกราย): fact_order_item เก็บราคา
-- **ก่อนหักส่วนลด** (qty * unit_price) แต่ fact_order.revenue / revenue_sum เป็น
-- ยอด **หลังหักส่วนลด** — คนละฐาน เทียบกันตรงๆ ไม่ได้
-- ตัวอย่างจริง: line item รวม 4,000 · ส่วนลด 368 · revenue 1,632
-- (0099 คอมเมนต์ว่า "บวกกันแล้วไม่มีทางเกิน" — ข้อสรุปนั้นผิด เพราะมองข้ามส่วนลด)
--
-- แก้: เฉลี่ยยอดสุทธิของออเดอร์ลงแต่ละ line ตามสัดส่วนยอดก่อนหักส่วนลด
-- (เฉลี่ยรวม neutral ด้วย ไม่งั้นส่วนลดที่ตกกับค่าส่ง/กล่องจะถูกโยนให้ bar/jewelry
-- แบกแทน) ⇒ bar + jewelry + neutral = revenue สุทธิ ⇒ bar + jewelry <= ยอดจริงเสมอ
-- ออเดอร์ที่ line รวมเป็น 0 -> ratio 0 ไม่หารศูนย์
--
-- ยืนยันหลัง apply บน DB จริง: T5 = 0 แถว · T1 (ลูกค้าที่ทุกรายการ neutral 21 คน)
-- = unknown ทั้งหมด · T2 (แท่งเงิน+เลเซอร์) = bar_only

create or replace view analytics.v_customer_affinity
  with (security_invoker = true) as
with line_gross as (
  select
    fo.shop_id,
    fo.customer_id,
    fi.fact_order_id,
    fo.revenue as order_revenue,
    coalesce(pa.affinity_group, 'neutral') as affinity_group,
    (fi.qty * fi.unit_price)::numeric(14, 2) as gross
  from analytics.fact_order_item fi
  join analytics.fact_order fo on fo.id = fi.fact_order_id
  left join analytics.v_product_affinity pa on pa.product_id = fi.product_id
  where fo.customer_id is not null
),
order_gross as (
  select fact_order_id, sum(gross) as order_gross
  from line_gross group by fact_order_id
),
item_class as (
  select
    lg.shop_id,
    lg.customer_id,
    lg.fact_order_id,
    lg.affinity_group,
    case when og.order_gross > 0
         then (lg.gross / og.order_gross * lg.order_revenue)::numeric(14, 2)
         else 0::numeric(14, 2)
    end as line_revenue
  from line_gross lg
  join order_gross og on og.fact_order_id = lg.fact_order_id
),
cust_rollup as (
  select
    shop_id,
    customer_id,
    bool_or(affinity_group = 'bar') as bought_bar,
    bool_or(affinity_group = 'jewelry') as bought_jewelry,
    sum(line_revenue) filter (where affinity_group = 'bar') as bar_revenue,
    sum(line_revenue) filter (where affinity_group = 'jewelry') as jewelry_revenue,
    count(distinct fact_order_id) filter (where affinity_group = 'bar') as bar_order_count,
    count(distinct fact_order_id) filter (where affinity_group = 'jewelry') as jewelry_order_count
  from item_class
  group by shop_id, customer_id
)
select
  cm.shop_id,
  cm.customer_id,
  coalesce(cr.bought_bar, false) as bought_bar,
  coalesce(cr.bought_jewelry, false) as bought_jewelry,
  coalesce(cr.bar_revenue, 0)::numeric(14, 2) as bar_revenue,
  coalesce(cr.jewelry_revenue, 0)::numeric(14, 2) as jewelry_revenue,
  coalesce(cr.bar_order_count, 0)::int as bar_order_count,
  coalesce(cr.jewelry_order_count, 0)::int as jewelry_order_count,
  case
    when coalesce(cr.bought_bar, false) and coalesce(cr.bought_jewelry, false) then 'both'
    when coalesce(cr.bought_bar, false) then 'bar_only'
    when coalesce(cr.bought_jewelry, false) then 'jewelry_only'
    else 'unknown'
  end as affinity
from analytics.v_customer_master cm
left join cust_rollup cr on cr.customer_id = cm.customer_id and cr.shop_id = cm.shop_id;

grant select on all tables in schema analytics to authenticated, service_role;

notify pgrst, 'reload schema';
