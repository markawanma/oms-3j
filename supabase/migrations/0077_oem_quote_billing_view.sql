-- 0077_oem_quote_billing_view.sql
--
-- 0075 เพิ่ม analytics.oem_customer (legal_name/tax_id/address/phone/
-- contact_channel) และ oem_quote_set_billing() ให้ผูกใบเสนอราคากับผู้ออกบิลได้
-- แล้ว แต่ analytics.v_oem_quote — view เดียวที่ฝั่งแอปอ่านข้อมูลใบเสนอราคา —
-- ไม่เคย join ตารางนี้เข้ามาเลย ผลคือหน้าที่จะพิมพ์ใบเสนอราคา/ใบกำกับภาษี
-- เป็น PDF ไม่มีทางอ่านชื่อผู้ออกบิล/เลขผู้เสียภาษี/ที่อยู่ ออกมาได้เลย
-- ทั้งที่ข้อมูลถูกบันทึกไว้ใน DB แล้ว
--
-- แก้: left join oem_customer เข้า v_oem_quote แล้วเปิดฟิลด์ผู้ออกบิลออกมา
-- เป็น bill_* ต่อท้ายคอลัมน์เดิมทั้งหมด — ตาม 0075's own note: CREATE OR
-- REPLACE VIEW ต่อคอลัมน์ใหม่ได้เฉพาะท้ายสุดเท่านั้น แทรกกลางหรือสลับลำดับ
-- คอลัมน์เดิมจะชน 42P16 ทันที (กับดักเดิมที่ทีมเจอมาแล้วตอนต่อ margin_charged_pct
-- ใน 0075) จึง copy select list เดิมทั้งชุดมาแบบคำต่อคำ ไม่แตะแม้แต่ตัวเดียว
-- แล้วเพิ่ม join + คอลัมน์ใหม่ไว้ล่างสุด
--
-- left join (ไม่ใช่ inner join): ใบเสนอราคาที่ยังไม่เคยเรียก
-- oem_quote_set_billing (customer_id เป็น null — ทุกใบก่อนฟีเจอร์นี้ และใบใหม่
-- ที่ยังไม่กรอกข้อมูลบิล) ต้องยังอยู่ในผลลัพธ์ view ปกติ ไม่ใช่หายไปจากรายการ
--
-- address คงเป็น jsonb ตามที่เก็บ ไม่แกะ/จัดรูปแบบใน SQL — การจัดวางที่อยู่
-- ให้เป็นข้อความสำหรับพิมพ์ใบเสนอราคาเป็นเรื่องของ presentation layer ฝั่งแอป
-- ไม่ใช่ของ view ชั้นนี้
--
-- security_invoker = true คงไว้เหมือนเดิม (ตาม 0075/0062): สิทธิ์อ่านจริงตัดสิน
-- โดย RLS ของผู้เรียก ไม่ใช่ของเจ้าของ view — oem_customer มีแค่ owner/admin
-- select policy (0075 §2) เท่ากับ bill_* จะเป็น null สำหรับ shop_member ที่ไม่ใช่
-- owner/admin แม้ join จะ match แถวจริงก็ตาม เป็นพฤติกรรมที่ตั้งใจ ไม่ใช่บั๊ก

create or replace view analytics.v_oem_quote
  with (security_invoker = true) as
select
  q.id,
  q.shop_id,
  q.quote_no,
  q.customer_name,
  q.customer_contact,
  q.input,
  q.calc,
  q.rate_snapshot,
  q.cost_piece,
  q.price_per_piece,
  q.nre_cost,
  q.nre_price,
  q.pieces_subtotal,
  q.quote_total,
  q.margin_actual_pct,
  q.q_run,
  q.flask_count,
  q.plating_batch_count,
  q.status,
  q.approval_note,
  q.approved_by,
  q.quote_valid_until,
  q.lost_reason,
  q.lost_to,
  q.created_by,
  q.updated_by,
  q.created_at,
  q.updated_at,
  (q.status = 'quoted' and q.quote_valid_until is not null and q.quote_valid_until < current_date) as is_expired,
  case when q.quote_valid_until is not null then q.quote_valid_until - current_date else null end as days_left,
  q.margin_charged_pct,
  q.discount_thb,
  q.discount_reason,
  q.grand_total,
  q.margin_after_discount_pct,
  q.parent_quote_id,
  q.root_quote_id,
  q.customer_id,
  q.vat_mode,
  pq.quote_no as parent_quote_no,
  (select count(*) from analytics.oem_quote_item i where i.quote_id = q.id) as item_count,
  -- ---- appended 0077+ only; do not insert new columns above this line ----
  c.legal_name as bill_legal_name,
  c.tax_id as bill_tax_id,
  c.phone as bill_phone,
  c.contact_channel as bill_contact_channel,
  c.address as bill_address
from analytics.oem_quote q
left join analytics.oem_quote pq on pq.id = q.parent_quote_id
left join analytics.oem_customer c on c.id = q.customer_id and c.shop_id = q.shop_id;

-- Re-grant เฉพาะ view ที่แก้ในไฟล์นี้ ตามแนวเดิม (0075/0076): ไม่แตะ
-- oem_customer/oem_quote_item — สิทธิ์ของสองตัวนั้นตั้งไว้แล้วจาก 0075 และไม่ได้
-- ถูกแก้ในไฟล์นี้ ไม่มีเหตุผลต้องยิง grant ซ้ำ
grant select on analytics.v_oem_quote to authenticated, service_role;

notify pgrst, 'reload schema';
