-- 0068_channel_alias_line.sql
-- Shipnity เขียนช่องทาง LINE ได้ 2 แบบ ไม่ใช่แบบเดียว
--
-- ไฟล์ order report ที่นำเข้าก่อนหน้านี้ทุกไฟล์ใช้คำว่า "line_oa" ในคอลัมน์
-- "ช่องทางติดต่อ" แต่ไฟล์ 19-21 ส.ค. 2026 มี 1 แถวที่เขียนว่า "line" เฉยๆ
-- (ออเดอร์ F498) ทำให้ transform_pending_orders ตีกลับด้วย
--     "no dim_channel_alias match for channel_raw: line"
--
-- นี่คือ fail-loud ที่ถูกต้องแล้ว — ระบบไม่เดาว่า "line" คือช่องทางไหน
-- แล้วเอายอดขายไปลงผิดช่อง สิ่งที่ขาดคือ alias ไม่ใช่ตรรกะ
--
-- ผลถ้าไม่แก้: ทุกออเดอร์ที่ Shipnity เขียนว่า "line" จะตกค้างเป็น error
-- ในตาราง staging เงียบๆ ยอดขาย LINE จะต่ำกว่าความจริงโดยไม่มีใครเห็น
--
-- on conflict do nothing — migration นี้รันซ้ำได้ และ alias นี้ถูกใส่เข้า DB
-- จริงไปแล้วตอนนำเข้าไฟล์ 19-21 ส.ค. ไฟล์นี้มีไว้ให้ environment อื่น
-- (และการ rebuild จากศูนย์) ได้ alias เดียวกัน

insert into analytics.dim_channel_alias (alias_raw, channel_id)
select 'line', id
from analytics.dim_channel
where code = 'line_oa'
on conflict do nothing;
