-- 0074_silver_price_basis_fix.sql
-- แก้การเทียบราคาที่เอาคนละหน่วยมาเทียบกัน
--
-- อาการ: หลังเก็บราคาได้ 2 วัน view v_silver_price_trend รายงานว่าราคา
-- "ขึ้น 28.65%" ในวันเดียว ซึ่งไม่จริง
--
-- สาเหตุ: คอลัมน์ sell_per_baht ถูกใส่ค่าคนละความหมายในสองวัน
--   24 ส.ค. (กรอกมือจากชีต) = 1,131 = ราคา "เนื้อเงิน" ต่อน้ำหนัก 1 บาท
--   25 ส.ค. (สคริปต์อ่านเว็บ) = 1,455 = ราคา "แท่ง 1 บาท" ซึ่งรวม premium แล้ว
-- ต่างกัน ~29% ซึ่งคือค่า premium ของแท่งเล็ก ไม่ใช่การเคลื่อนไหวของราคาตลาด
--
-- ต้นเหตุที่แท้จริง: หน้าเว็บร้าน **ไม่ได้ประกาศราคาเนื้อเงินขาขายออก** เลย
-- ประกาศแต่ราคาแท่งแต่ละขนาด (ซึ่งรวม premium) สคริปต์จึงไม่มีทางรู้ค่านี้
-- แล้วไปเดาเอาจากราคาแท่ง 1 บาท — การเดาแบบนั้นคือที่มาของบั๊ก
--
-- ทางแก้ที่เลือก: ไม่เดา
--   1. sell_per_baht ของวันที่มาจากเว็บ = null (เรา "ไม่รู้" ไม่ใช่ "เท่ากับแท่ง 1 บาท")
--      ราคาขายยังอยู่ครบใน bar_0_5/1/3/5/10_baht และ kilo_sell อยู่แล้ว
--   2. view เปลี่ยนไปคิด % จาก buy_per_baht แทน
--
-- ทำไม buy_per_baht ถึงเชื่อได้: ราคารับซื้อคืนของร้านเป็นเส้นตรงกับน้ำหนัก
-- เป๊ะทุกขนาด (547.5 = 1,095x0.5 · 3,285 = x3 · 10,950 = x10 — ตรวจแล้ว)
-- แปลว่ามันคือ "ราคาเนื้อเงินล้วน" จริงๆ ไม่มี premium ปน จึงเป็นชุดตัวเลข
-- ชุดเดียวที่นิยามตรงกันทั้งจากชีตและจากเว็บ
--   24 ส.ค. 1,101 -> 25 ส.ค. 1,095 = -0.54% ซึ่งสมเหตุสมผลสำหรับ 1 วัน
--
-- บทเรียน: เก็บ "ไม่รู้" เป็น null ดีกว่าเดาค่าที่ดูใกล้เคียง — ค่าที่เดามา
-- จะไปโผล่เป็นเปอร์เซ็นต์ที่ผิดในรายงาน แล้วคนอ่านจะเชื่อ

-- 1. ล้างค่าที่เดามาจากเว็บทิ้ง (เก็บเฉพาะที่กรอกมือจากชีตซึ่งเป็นเนื้อเงินจริง)
update analytics.silver_price_daily
set sell_per_baht = null,
    updated_at = now()
where source = 'feed';

comment on column analytics.silver_price_daily.sell_per_baht is
  'ราคาเนื้อเงินขาขายออกต่อน้ำหนัก 1 บาท (ไม่รวม premium ของแท่ง) — หน้าเว็บร้านไม่ประกาศค่านี้ จึงเป็น null เมื่อ source=feed · ราคาขายจริงต่อขนาดอยู่ที่ bar_*_baht';

comment on column analytics.silver_price_daily.buy_per_baht is
  'ราคาเนื้อเงินขารับซื้อคืนต่อน้ำหนัก 1 บาท — เป็นเส้นตรงกับน้ำหนักเป๊ะทุกขนาด จึงเป็นชุดตัวเลขที่นิยามตรงกันทุกแหล่ง ใช้เป็นฐานคิด % การเปลี่ยนแปลง';

-- 2. view คิด % จาก buy_per_baht แทน sell_per_baht
create or replace view analytics.v_silver_price_trend
with (security_invoker = true) as
select
  s.shop_id,
  s.as_of_date,
  s.sell_per_baht,
  s.buy_per_baht,
  s.sell_per_baht - s.buy_per_baht                          as spread_per_baht,
  s.bar_1_baht,
  s.bar_10_baht,
  s.kilo_sell,
  s.kilo_buy,
  lag(s.buy_per_baht) over w                                as prev_buy,
  round(
    100.0 * (s.buy_per_baht - lag(s.buy_per_baht) over w)
    / nullif(lag(s.buy_per_baht) over w, 0), 2
  )                                                         as pct_change_vs_prev,
  round(
    100.0 * (s.buy_per_baht - first_value(s.buy_per_baht) over w7)
    / nullif(first_value(s.buy_per_baht) over w7, 0), 2
  )                                                         as pct_change_7d
from analytics.silver_price_daily s
window
  w  as (partition by s.shop_id order by s.as_of_date),
  w7 as (partition by s.shop_id order by s.as_of_date
         rows between 7 preceding and current row);

comment on view analytics.v_silver_price_trend is
  'แนวโน้มราคาเงินรายวัน — คิด % จาก buy_per_baht (ราคาเนื้อเงินล้วน) เพราะเป็นชุดเดียวที่นิยามตรงกันทุกแหล่งข้อมูล';

notify pgrst, 'reload schema';
