-- 0099_customer_product_affinity.sql
-- ป้ายแยกลูกค้า "เงินแท่ง (ลงทุน) vs เครื่องประดับ" — ตามที่ CMO ขอ (Leia) และ
-- เจ้าของสั่ง: กลุ่ม win-back ทับกันแค่ 2.7% ระหว่างสองสาย ยิงคอนเทนต์ผิดสาย = เผาเงิน
-- (AOV เฉลี่ย 12,191 แต่ median 5,269 บอกว่ามีคนเงินแท่งปนอยู่ในกลุ่ม win-back จริง)
--
-- ============================================================================
-- 1. analytics.v_product_affinity — จุดเดียวที่ map category/sku -> ฝั่งสินค้า
--    ("อย่า hardcode รายชื่อ category ยาวๆ ในหลายที่" — ทุกที่ที่ต้องรู้ว่า SKU
--    ไหนเป็นฝั่งไหน ให้ join view นี้ ไม่ใช่ก็อป CASE WHEN ไปวางที่อื่น)
--
-- แหล่งความจริง: public.product.category (text, ไม่มี CHECK — เจ้าของพิมพ์เอง
-- ได้อิสระ ดังนั้น category ใหม่ที่ยังไม่รู้จักต้องตกไป 'neutral' เสมอ ไม่ใช่เดา)
--
-- Categories สำรวจครบแล้ว (ผู้ว่าจ้างยืนยันมาในโจทย์):
--   bar     -> 'เงินแท่ง'
--   jewelry -> 'Live (ตามกรัม)', 'สร้อยคอ', 'จี้/โซ่ (ตามกรัม)',
--              'สร้อยข้อมือ/กำไล', 'สร้อยข้อมือ', 'Art Toy เงิน', 'จี้อักษรมงคล',
--              'จี้ปี่เซียะ', 'จี้', 'เครื่องรางมงคล', 'ปี่เซียะ', 'แหวน',
--              'ต่างหู', 'สร้อยข้อเท้า'
--   neutral -> 'กล่อง/บรรจุภัณฑ์', 'น้ำยาล้างเงิน', 'น้ำหอม', 'Partner SKU',
--              category null (4 SKU วันนี้ + SKU ใหม่ในอนาคตที่ยังไม่กรอก),
--              และ category ใดๆ ที่ไม่อยู่ในสองลิสต์บน (กันเดาผิดเมื่อมี
--              category ใหม่โผล่มาโดยไม่มีใครมาแก้ view นี้ทัน)
--
-- SKU-level override (ตัดสินก่อน category เสมอ เพราะเป็นบริการ/ของแถม ไม่ใช่
-- ตัวสินค้าที่บ่งบอกฝั่งลูกค้า):
--   'Deliver'      -> ค่าส่ง ไม่ใช่สินค้า
--   sku มีคำว่า 'laser' -> บริการเลเซอร์สลักพ่วงกับแท่งเงิน ไม่ใช่ตัวสินค้าเอง
--     (เคสห้ามผ่าน #2: ซื้อแท่งเงิน+เลเซอร์ ต้องเป็น bar_only ไม่ใช่ both)
--
-- การตัดสินใจที่ต้องบอกเหตุผล — 'กรอบสมเด็จ' และ 'AT-frame' (category = null):
-- จัดเป็น 'neutral' (ไม่นับเป็นเครื่องประดับ) เพราะเป็นกรอบพระ/พวงกุญแจ
-- accessory ไม่ใช่เครื่องประดับสวมใส่แบบสร้อย/แหวน/ต่างหูที่แคมเปญนี้ต้องแยก
-- สาย — จุดประสงค์ของป้ายนี้คือกันยิงคอนเทนต์เครื่องประดับใส่คนเงินแท่ง (และ
-- กลับกัน) การนับกรอบพระ/พวงกุญแจเป็นเครื่องประดับผิดๆ เสี่ยงเผาเงินแบบเดียว
-- กับปัญหาที่ป้ายนี้ถูกสร้างมาแก้ ปลอดภัยกว่าที่จะไม่นับ (ตรงกับกฎ null-category
-- ข้อ 4 อยู่แล้วในทางปฏิบัติ แต่ระบุชัดตรงนี้เพราะโจทย์ขอให้ตัดสินใจเอง)
create or replace view analytics.v_product_affinity
  with (security_invoker = true) as
select
  p.id as product_id,
  p.shop_id,
  p.sku,
  p.category,
  case
    when p.sku = 'Deliver' then 'neutral'
    when p.sku ilike '%laser%' then 'neutral'
    when p.sku in ('กรอบสมเด็จ', 'AT-frame') then 'neutral'
    when p.category = 'เงินแท่ง' then 'bar'
    when p.category in (
      'Live (ตามกรัม)', 'สร้อยคอ', 'จี้/โซ่ (ตามกรัม)', 'สร้อยข้อมือ/กำไล',
      'สร้อยข้อมือ', 'Art Toy เงิน', 'จี้อักษรมงคล', 'จี้ปี่เซียะ', 'จี้',
      'เครื่องรางมงคล', 'ปี่เซียะ', 'แหวน', 'ต่างหู', 'สร้อยข้อเท้า'
    ) then 'jewelry'
    else 'neutral'
  end as affinity_group
from public.product p;

-- ============================================================================
-- 2. analytics.v_customer_affinity — 1 แถวต่อลูกค้า (ครบทุกลูกค้าใน
--    v_customer_master แม้ไม่มี line item เลย -> affinity='unknown' ไม่ error,
--    เคสห้ามผ่าน #6)
--
-- product_id เป็น null ได้เมื่อ SKU ไม่ match ตอน import (0093/0094 SKU
-- matching 3-tier ยัง unknown_sku อยู่) — รายการเหล่านี้ LEFT JOIN แล้วได้
-- affinity_group = null -> coalesce เป็น 'neutral' เหมือน SKU ไม่รู้ประเภท
-- (เคสห้ามผ่าน #4: ไม่ทำให้ลูกค้าถูกจัดฝั่งผิดจาก SKU ที่เรายังไม่รู้จัก)
--
-- bar_revenue/jewelry_revenue รวมจากแค่ line item ที่ถูกจัดฝั่งนั้นจริง (ไม่รวม
-- neutral) จึงบวกกันแล้วไม่มีทางเกิน revenue จริงของลูกค้า (เคสห้ามผ่าน #5) —
-- affinity_group เป็น mutually exclusive ต่อสินค้า (exactly หนึ่งฝั่งต่อ SKU)
-- จึงไม่มี double count ระหว่าง bar/jewelry ด้วย
create or replace view analytics.v_customer_affinity
  with (security_invoker = true) as
with item_class as (
  select
    fo.shop_id,
    fo.customer_id,
    fi.fact_order_id,
    coalesce(pa.affinity_group, 'neutral') as affinity_group,
    (fi.qty * fi.unit_price)::numeric(14, 2) as line_revenue
  from analytics.fact_order_item fi
  join analytics.fact_order fo on fo.id = fi.fact_order_id
  left join analytics.v_product_affinity pa on pa.product_id = fi.product_id
  where fo.customer_id is not null
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

-- ============================================================================
-- 3. ต่อเข้า analytics.v_audience — กับดัก 42P16 (skill 3j-migration-traps #3):
--    ไล่หา dependent ของ v_audience แล้ว (grep ทั้ง repo หา
--    "analytics.v_audience" / ".from(\"v_audience\")" ในทั้ง supabase/migrations
--    และ lib/) เจอผู้ใช้จริงแค่จุดเดียว: lib/actions/marketing.ts getAudience()
--    ซึ่งอ่านผ่าน PostgREST ด้วยชื่อคอลัมน์ที่ระบุ ไม่มี view/function อื่นใน SQL
--    ที่ select จาก analytics.v_audience เลย (0049 มีตัวแปรชื่อ v_audience_segment
--    ซึ่งเป็นคนละอย่าง ไม่ใช่ dependency) — ⚠️ ไม่มี MCP tool ต่อ DB จริงใน
--    session นี้เพื่อยืนยันด้วย pg_depend สด แนะนำให้ Tech Lead เช็ค pg_depend
--    อีกชั้นก่อน apply จริงเป็นการยืนยันซ้ำ (ตาม skill supabase-migrate ข้อ 1)
--
--    ผลคือ "เพิ่มคอลัมน์ต่อท้าย" (create or replace view) ปลอดภัยแน่นอนอยู่แล้ว
--    ไม่ว่าจะมี dependent จริงหรือไม่ เพราะกฎ Postgres คือห้ามแทรกกลาง/ลบ/
--    เปลี่ยนชนิดคอลัมน์เดิมเท่านั้น ต่อท้ายทำได้เสมอ — จึงไม่ต้อง
--    drop ... cascade เลยในรอบนี้ select list ก่อนหน้าลอกมาจาก 0033 (ฉบับเดียว
--    ที่เคยแก้ view นี้) เป๊ะทุกคอลัมน์ ต่อท้ายด้วย 7 คอลัมน์ affinity ใหม่
create or replace view analytics.v_audience
  with (security_invoker = true) as
with cust_province as (
  select distinct on (v.customer_id)
    v.customer_id,
    v.province_code
  from analytics.v_fact_order v
  where v.customer_id is not null
  order by v.customer_id, v.order_date desc, v.id desc
)
select
  cm.shop_id,
  cm.customer_id,
  cm.display_name,
  rfm.segment,
  cm.order_count,
  cm.revenue_sum,
  rfm.recency_days,
  cm.first_order_at,
  cm.last_order_at,
  dch.code as channel_code,
  dch.name as channel_name,
  cp.province_code,
  g.province_name_th,
  coalesce(ca.bought_bar, false) as bought_bar,
  coalesce(ca.bought_jewelry, false) as bought_jewelry,
  coalesce(ca.bar_revenue, 0)::numeric(14, 2) as bar_revenue,
  coalesce(ca.jewelry_revenue, 0)::numeric(14, 2) as jewelry_revenue,
  coalesce(ca.affinity, 'unknown') as affinity,
  coalesce(ca.bar_order_count, 0)::int as bar_order_count,
  coalesce(ca.jewelry_order_count, 0)::int as jewelry_order_count
from analytics.v_customer_master cm
join analytics.v_rfm_segment rfm on rfm.customer_id = cm.customer_id
left join analytics.dim_channel dch on dch.id = cm.first_touch_channel_id
left join cust_province cp on cp.customer_id = cm.customer_id
left join analytics.dim_geo g on g.province_code = cp.province_code
left join analytics.v_customer_affinity ca on ca.customer_id = cm.customer_id and ca.shop_id = cm.shop_id;

-- ============================================================================
-- 4. Grants — pattern เดิมของ analytics views (ไม่มีต้นทุน/PII ในสามวิวนี้
--    เหมือน v_audience เดิม: revenue รวมระดับลูกค้า ไม่ใช่ unit_cost)
-- ============================================================================

grant select on all tables in schema analytics to authenticated, service_role;

notify pgrst, 'reload schema';
