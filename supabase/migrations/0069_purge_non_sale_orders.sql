-- 0069_purge_non_sale_orders.sql
-- ลบออเดอร์ที่ไม่ใช่การขายออกจาก fact_order (เจ้าของร้านสั่ง 2026-08-21)
--
-- ที่มา: Shipnity ต้องสร้าง "ออเดอร์" ทุกครั้งที่จะพิมพ์ใบปะหน้า แม้ตอนนั้น
-- จะไม่ได้ขายอะไร — ส่งซ่อม / ส่งของตามไปทีหลัง / ส่งของแถม พวกนี้เข้ามาเป็น
-- ออเดอร์ยอด 0 บาท 202 รายการ (LINE 166 · Facebook 36 · TikTok 0)
-- ดูจากหมายเหตุจริงในไฟล์: "ส่งซ่อม" "ซ่อมตาเสือ" "ส่งตาม" "น้ำยาล้างเงิน"
-- และ 21 รายการที่มี line item ก็เป็น SKU ปลอมทั้งหมด (Deliver / laser /
-- box3j) ราคา 0 บาท ไม่ใช่สินค้าที่ขายจริง
--
-- ปัญหาที่มันสร้าง: ปั้มลูกค้าปลอมเข้าฐานข้อมูล (ออเดอร์ส่งซ่อมถูกนับเป็น
-- "ลูกค้าใหม่") ทำให้จำนวนลูกค้าเฟ้อ และไหลเข้ากลุ่ม RFM ที่ใช้ยิง broadcast
--
-- ทางเลือกที่เสนอไปคือติดป้ายแยกประเภทแทนการลบ (เก็บอัตราส่งซ่อมไว้เป็น
-- สัญญาณคุณภาพงาน + ไม่ทำค่าส่งที่ร้านจ่ายจริงหายไป) เจ้าของเลือก "ลบไปเลย"
-- ไฟล์นี้จึงลบตามสั่ง แต่ **archive ไว้ก่อนลบ** เพราะการลบ 202 แถวจาก
-- production โดยไม่มีทางย้อนกลับ ไม่ใช่สิ่งที่ควรทำแม้จะสั่งมา — ตาราง
-- archive ไม่ถูกอ้างอิงจาก view ไหนเลย ตัวเลขทุกหน้าจึงสะอาดตามที่สั่งจริง
-- ถ้าแน่ใจแล้วว่าไม่ต้องการ ค่อย drop ตาราง archive ทีหลังเมื่อไหร่ก็ได้
--
-- ⚠️ ข้อจำกัดที่ยังอยู่หลังรันไฟล์นี้: ตัวนำเข้าไม่รู้จักออเดอร์ประเภทนี้
-- ถ้า export ไฟล์ช่วงเดิมเข้ามาใหม่ ออเดอร์เหล่านี้จะกลับมาอีก และออเดอร์
-- ส่งซ่อมของสัปดาห์หน้าก็จะเข้ามาเหมือนเดิม การลบครั้งนี้แก้ที่ปลายทาง
-- ไม่ได้แก้ที่ต้นทาง

-- ============================================================
-- 1. Archive ก่อนลบ
-- ============================================================

create table if not exists analytics.archive_non_sale_order (
  archived_at   timestamptz not null default now(),
  archive_note  text,
  like analytics.fact_order
);

create table if not exists analytics.archive_non_sale_order_item (
  archived_at timestamptz not null default now(),
  like analytics.fact_order_item
);

-- service_role เท่านั้น (เหมือนตาราง analytics อื่น) — ไม่มี policy = ไม่มีใคร
-- นอกจาก service_role เข้าถึงได้ ตั้งใจให้เป็นแบบนั้น เพราะเป็นข้อมูลดิบที่
-- ถูกถอดออกจากระบบแล้ว ไม่ควรมีหน้าไหนอ่านมันโดยบังเอิญ
alter table analytics.archive_non_sale_order      enable row level security;
alter table analytics.archive_non_sale_order_item enable row level security;

insert into analytics.archive_non_sale_order_item
select now(), i.*
from analytics.fact_order_item i
join analytics.fact_order f on f.id = i.fact_order_id
where f.revenue = 0 or f.revenue is null;

insert into analytics.archive_non_sale_order
select now(), 'purge 0069: non-sale order (ส่งซ่อม/ส่งตาม/ของแถม)', f.*
from analytics.fact_order f
where f.revenue = 0 or f.revenue is null;

-- ============================================================
-- 2. ลบ (fact_order_item / dim_address / crm_order_override cascade เอง,
--    stg_order_import.fact_order_id เป็น on delete set null)
-- ============================================================

delete from analytics.fact_order
where revenue = 0 or revenue is null;

-- ============================================================
-- 3. ซ่อมข้อมูลที่เพี้ยนเพราะออเดอร์ที่ลบไป
-- ============================================================

-- 3.1 first_order_at / last_order_at ของลูกค้าที่เคยนับออเดอร์ส่งซ่อมรวมไปด้วย
update analytics.dim_customer c
set first_order_at = agg.first_at,
    last_order_at  = agg.last_at,
    updated_at     = now()
from (
  select customer_id,
         min(order_date)::timestamptz as first_at,
         max(order_date)::timestamptz as last_at
  from analytics.fact_order
  where customer_id is not null
  group by customer_id
) agg
where agg.customer_id = c.id
  and (c.first_order_at is distinct from agg.first_at
    or c.last_order_at  is distinct from agg.last_at);

-- 3.2 is_new_customer: ถ้าออเดอร์แรกของลูกค้าคนหนึ่งคือออเดอร์ส่งซ่อมที่เพิ่ง
--     ถูกลบไป ออเดอร์ที่เหลืออันแรกของเขาต้องกลายเป็น "ออเดอร์แรก" แทน
--     ไม่งั้นลูกค้าคนนั้นจะไม่เคยถูกนับเป็นลูกค้าใหม่ในเดือนไหนเลย
with first_remaining as (
  select distinct on (customer_id) customer_id, id as order_id
  from analytics.fact_order
  where customer_id is not null
  order by customer_id, order_date, id
)
update analytics.fact_order f
set is_new_customer = (f.id = fr.order_id),
    updated_at = now()
from first_remaining fr
where fr.customer_id = f.customer_id
  and f.is_new_customer is distinct from (f.id = fr.order_id);

notify pgrst, 'reload schema';
