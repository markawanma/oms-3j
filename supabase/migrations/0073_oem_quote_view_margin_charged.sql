-- 0073_oem_quote_view_margin_charged.sql
-- แก้บั๊กที่ UAT เจอ: หน้า "ใบเสนอราคา" โหลดไม่ขึ้นเลยสักใบ
--
-- อาการ: กดบันทึกแล้วขึ้นว่าสำเร็จ (บันทึกได้จริง — มี 2 ใบใน oem_quote)
-- แต่พอเข้าแท็บใบเสนอราคาขึ้น "โหลดใบเสนอราคาไม่สำเร็จ ลองใหม่อีกครั้ง"
-- ทำให้ดูเหมือนบันทึกไม่ติด ทั้งที่ข้อมูลอยู่ครบ
--
-- สาเหตุ: 0063 เพิ่มคอลัมน์ margin_charged_pct เข้า **ตาราง** analytics.oem_quote
-- (แยก margin ที่คิดจริงออกจาก margin เฉลี่ยที่รายงาน) และฝั่ง TypeScript
-- (lib/actions/oem.ts QUOTE_COLUMNS) ก็ขอคอลัมน์นี้มาด้วย — แต่ **view**
-- v_oem_quote ที่หน้าจออ่านจริงถูกสร้างไว้ตั้งแต่ 0062 และไม่เคยถูกอัปเดต
-- ให้มีคอลัมน์ใหม่นี้
--
-- PostgREST เจอคอลัมน์ที่ไม่มีใน select list → ตีกลับทั้ง query ไม่ใช่แค่
-- ข้ามคอลัมน์นั้น → getQuotes() และ getQuote() ล้มทั้งคู่ → หน้าจอว่างเปล่า
--
-- บทเรียนที่ควรจำ: เพิ่มคอลัมน์ในตารางที่มี view ครอบอยู่ ต้องอัปเดต view
-- ในไฟล์เดียวกันเสมอ ไม่งั้นบั๊กจะไปโผล่ตอน UAT แบบนี้ — และอาการที่เห็น
-- ("บันทึกไม่ติด") จะชี้ไปคนละที่กับต้นเหตุจริง (view ขาดคอลัมน์)

create or replace view analytics.v_oem_quote
with (security_invoker = true) as
select
  id,
  shop_id,
  quote_no,
  customer_name,
  customer_contact,
  input,
  calc,
  rate_snapshot,
  cost_piece,
  price_per_piece,
  nre_cost,
  nre_price,
  pieces_subtotal,
  quote_total,
  margin_actual_pct,
  margin_charged_pct,   -- 0073: คอลัมน์ที่ขาดไป ต้นเหตุของบั๊ก
  q_run,
  flask_count,
  plating_batch_count,
  status,
  approval_note,
  approved_by,
  quote_valid_until,
  lost_reason,
  lost_to,
  created_by,
  updated_by,
  created_at,
  updated_at,
  status = 'quoted' and quote_valid_until is not null and quote_valid_until < current_date
    as is_expired,
  case when quote_valid_until is not null then quote_valid_until - current_date else null::integer end
    as days_left
from analytics.oem_quote q;

notify pgrst, 'reload schema';
