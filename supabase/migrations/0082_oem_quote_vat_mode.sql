-- 0082_oem_quote_vat_mode.sql
-- บริษัทจดทะเบียน VAT แล้ว (oem_setting.seller_vat_registered = true) เจ้าของ
-- อยากเลือก "รายใบ" ว่าจะออกเอกสารแบบไหน: เขียนบรรทัดเดียวว่ารวม VAT แล้ว
-- (เดิม) หรือแยกให้เห็นราคาก่อน VAT / VAT 7% / ยอดสุทธิ (ใหม่)
--
-- ============ หลักการเดียวที่คุมทั้งไฟล์ ============
-- ยอดที่ลูกค้าจ่าย (grand_total) ต้องเท่ากันเป๊ะทั้งสองโหมด — vat_mode ควบคุม
-- "การแสดงผล" เท่านั้น ไม่ใช่ตัวเลขที่เรียกเก็บ ราคาสินค้าทุกวันนี้รวม VAT อยู่
-- แล้วในตัว (VAT-inclusive pricing) ดังนั้นการ "แตกแสดง" ต้องหารถอยหลังจาก
-- grand_total ไม่ใช่บวก VAT เพิ่มเข้าไปใหม่
--
-- ============ ทำไมต้องคำนวณด้วยส่วนที่เหลือ (remainder) ไม่ใช่คูณอัตราตรงๆ ====
-- ถ้าคำนวณ vat_base = round(grand_total/1.07, 2) แล้วคำนวณ vat_amount =
-- round(vat_base * 0.07, 2) แยกจากกัน ปัดเศษ 2 ครั้งอิสระต่อกัน ผลรวมของสองค่า
-- นี้จะไม่เท่ากับ grand_total เป๊ะในบางยอด (คลาดกัน 1 สตางค์จากการปัดเศษสะสม)
-- เอกสารที่ส่งลูกค้าจะ "บวกไม่ลง" ซึ่งเป็นปัญหาจริงในงานบัญชี — ฟังก์ชันนี้จึง
-- คำนวณ vat_base_thb ตัวเดียวด้วยการปัดเศษ (round ครั้งเดียว) แล้วให้
-- vat_amount_thb = grand_total - vat_base_thb (ส่วนที่เหลือ ไม่ปัดเศษซ้ำ)
-- บังคับให้ vat_base_thb + vat_amount_thb = grand_total เสมอทุกยอด ไม่มีข้อยกเว้น
--
-- ============ vat_rate เป็น snapshot ต่อใบ ไม่ใช่ค่าคงที่ลอยใน view ============
-- รอบแรกของไฟล์นี้เคยเก็บ vat_rate เป็น literal 0.07 ใน view (คำนวณสดทุกครั้ง
-- ที่ query) ซึ่งขัดกับเหตุผลที่ต้องมีคอลัมน์นี้ตั้งแต่แรก ("reprint ใบเก่าถูก
-- ถ้าวันหน้าอัตราเปลี่ยน") เพราะถ้าเป็น literal ใน view วันที่อัตราเปลี่ยนจริง
-- ใบเก่าทุกใบจะถูกคำนวณด้วยอัตราใหม่ทันทีตอน reprint ไม่ต่างจากใบใหม่เลย — แก้
-- เป็น oem_quote.vat_rate (คอลัมน์จริงในตาราง, not null default 0.07) ที่ถูก
-- "จารึก" ไว้ตอนแถวถูกสร้าง (ผ่าน default ของคอลัมน์ ไม่ต้องแตะ oem_quote_save)
-- แล้วให้ view อ่าน q.vat_rate ตรงๆ แทน literal — วันหน้าอัตราเปลี่ยนจริง แก้ที่
-- default ของคอลัมน์ (สำหรับใบใหม่) ใบเก่าที่มี vat_rate เดิมฝังอยู่แล้วจะไม่
-- ถูกแตะ พิมพ์ซ้ำกี่ครั้งก็ได้อัตราเดิมที่ออกใบจริง (แนวเดียวกับ rate_snapshot
-- ที่มีอยู่แล้วสำหรับราคาโลหะ)
--
-- ============ ขอบเขต ============
-- 1) oem_quote.vat_mode — constraint เดิม (0075) รับ 3 ค่า ('add_7','included',
--    'none') แต่เป็น "display-only ยังไม่มี arithmetic" (คอมเมนต์ 0075) และ
--    ทุกแถวปัจจุบันเป็น 'included' ล้วน โจทย์รอบนี้ให้รองรับ 2 ค่าเท่านั้น
--    ('included' / 'breakdown') — แคบกว่าดีไซน์เดิม 1 ค่า ('add_7' หาย) ดู
--    หมายเหตุท้ายไฟล์ (§5) สำหรับผลกระทบที่ต้องแจ้งทีม
-- 2) oem_quote.vat_rate — คอลัมน์ใหม่ (numeric not null default 0.07, check
--    0 < x < 1) เป็น snapshot อัตรา VAT ณ วันออกใบ ไม่ใช่ค่าคำนวณสด — ใบเก่า 6
--    ใบที่มีอยู่ก่อนไฟล์นี้ได้ 0.07 จาก default ตอน alter table ซึ่งถูกต้องตรง
--    ความจริง (ออกในยุคอัตรา 7% พอดี) ห้ามแก้ย้อนหลังหลังใบถูกสร้างแล้ว
-- 3) v_oem_quote — append vat_rate (อ่านจาก q.vat_rate ตรงๆ)/vat_base_thb/
--    vat_amount_thb (2 ตัวหลังคำนวณสดจาก grand_total + vat_rate ปัจจุบันของ
--    แถวนั้นเสมอ เหตุผลเดียวกับ deposit_amount_thb ใน 0081: grand_total
--    เปลี่ยนได้ตอนต่อราคา เก็บผลลัพธ์ไว้จะค้างเป็นเลขเก่า)
-- 4) oem_quote_set_vat_mode — RPC ใหม่ ตั้งโหมดรายใบ (vat_mode เท่านั้น ไม่แตะ
--    vat_rate) แก้ได้เฉพาะ draft/quoted (แนวเดียวกับ oem_quote_set_deposit ของ
--    0081) + กัน breakdown ถ้าร้านยังไม่จด VAT
-- 5) oem_quote_renegotiate — signature เดิม 4 args เป๊ะ (plain replace) แก้จุด
--    เดียว: ใบใหม่สืบทอด vat_rate จากใบแม่เหมือน vat_mode (ต่อราคาคือใบเดียวกัน
--    ในเชิงดีล ไม่ควรเปลี่ยนอัตราภาษีกลางคัน) — vat_mode เดิมสืบทอดอยู่แล้ว
--    ตั้งแต่ 0075 (ยืนยันด้วย grep) ไม่ต้องแก้ส่วนนั้น
--
-- อ่านคู่กับ 0075 (นิยาม vat_mode เดิม + comment "display-only"), 0079
-- (seller_vat_registered), 0081 (v_oem_quote ฉบับล่าสุดก่อนไฟล์นี้ — select
-- list 53 คอลัมน์ คัดลอกมาแบบคำต่อคำ, และรูปแบบ RPC set-field-รายใบที่ยึดตาม)
-- ============================================================================

-- ============================================================================
-- 1. oem_quote.vat_mode — เปลี่ยน constraint จาก 3 ค่า (0075) เป็น 2 ค่า
--    หา constraint เดิมด้วยนิยาม (ไม่เดาชื่อ) ตามแบบที่ 0075 ทำกับ status —
--    เพราะ vat_mode ถูกเติมแบบ inline check ตอน add column ไม่เคยถูกตั้งชื่อ
--    explicit มาก่อน ชื่อ auto-generated ไม่ใช่สิ่งที่ควรเดิมพันใน migration
-- ============================================================================

do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'analytics.oem_quote'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%vat_mode%';

  if v_conname is not null then
    execute format('alter table analytics.oem_quote drop constraint %I', v_conname);
  end if;

  alter table analytics.oem_quote
    add constraint oem_quote_vat_mode_check
    check (vat_mode in ('included', 'breakdown'));
end;
$$;

comment on column analytics.oem_quote.vat_mode is
  '0082: โหมดแสดงผล VAT ของใบนี้ — ''included'' (ค่าเริ่มต้น เขียนบรรทัดเดียวว่าราคารวม VAT แล้ว) / ''breakdown'' (แยกแสดงราคาก่อน VAT + VAT 7% + ยอดสุทธิ) ยอดสุทธิที่ลูกค้าจ่าย (grand_total) เท่ากันทั้งสองโหมดเสมอ ต่างกันแค่การแสดงผลในเอกสาร — แก้ผ่าน analytics.oem_quote_set_vat_mode เท่านั้น (แก้ได้เฉพาะสถานะ draft/quoted และห้ามตั้งเป็น breakdown ถ้าร้านยังไม่จด VAT) เดิม (0075) constraint รับ 3 ค่า (''add_7'',''included'',''none'') เป็น display-only ไม่มี arithmetic ยังไม่มีแถวไหนใช้ ''add_7''/''none'' จริง (ทุกแถวเป็น ''included'') จึงตีบให้เหลือ 2 ค่าตามโจทย์ปัจจุบันได้อย่างปลอดภัยด้านข้อมูล — ดูหมายเหตุผลกระทบต่อ lib/oem/types.ts ในสรุปส่งมอบ';

-- ============================================================================
-- 2. oem_quote.vat_rate — snapshot อัตรา VAT ณ วันออกใบ ต่างจาก vat_mode ตรงที่
--    ต้อง "จารึก" ค่าไว้ตอนแถวถูกสร้าง ไม่ใช่คำนวณสดตอน query — ใช้ default ของ
--    คอลัมน์ทำหน้าที่นี้ให้ฟรี ไม่ต้องแก้ oem_quote_save เลย (insert ใบใหม่ที่
--    ไม่ระบุ vat_rate จะได้ default ปัจจุบันอัตโนมัติ) ใบเก่า 6 ใบที่มีอยู่ก่อน
--    ไฟล์นี้ได้ 0.07 จาก default ตอน alter table — ถูกต้องเพราะออกในยุคอัตรา 7%
--    พอดี ไม่ใช่การเดา
--
--    ⚠️ ห้ามแก้ย้อนหลัง: ไม่มี RPC ไหนแก้ vat_rate ของใบที่มีอยู่แล้วโดยตรง (ตั้งใจ
--    — ถ้าจะเปลี่ยนอัตราของใบเดิม ให้ต่อราคาใหม่ผ่าน oem_quote_renegotiate ซึ่ง
--    จะสืบทอด vat_rate ของใบแม่มาให้เหมือนกัน ไม่ได้รีเซ็ตเป็น default ปัจจุบัน
--    — ดู §4) วันหน้าอัตรา VAT ประเทศเปลี่ยนจริง ให้แก้ที่ "default" ของคอลัมน์
--    นี้ (ALTER COLUMN ... SET DEFAULT) สำหรับใบใหม่เท่านั้น ใบเก่าจะไม่กระทบ
-- ============================================================================

alter table analytics.oem_quote
  add column if not exists vat_rate numeric(6, 4) not null default 0.07;

alter table analytics.oem_quote drop constraint if exists oem_quote_vat_rate_check;
alter table analytics.oem_quote add constraint oem_quote_vat_rate_check
  check (vat_rate > 0 and vat_rate < 1);

comment on column analytics.oem_quote.vat_rate is
  '0082: อัตรา VAT ที่ใช้คำนวณ vat_base_thb/vat_amount_thb ของใบนี้ (v_oem_quote) — เป็น snapshot ณ วันออกใบ ไม่ใช่ค่าคำนวณสด (ต่างจาก vat_mode) จารึกด้วย default ของคอลัมน์ตอน insert เท่านั้น ห้ามมี RPC แก้ค่านี้ของใบที่สร้างแล้วโดยตรง — ต่อราคาผ่าน oem_quote_renegotiate จะสืบทอดค่านี้จากใบแม่ (ไม่รีเซ็ตเป็น default ปัจจุบัน) วันหน้าอัตราประเทศเปลี่ยน ให้แก้ default ของคอลัมน์นี้สำหรับใบใหม่เท่านั้น ใบเก่าที่มีค่านี้ฝังอยู่แล้วจะไม่ถูกแตะ พิมพ์ซ้ำกี่ครั้งก็ได้อัตราเดิมตรงกับตอนออกใบจริง';

-- ============================================================================
-- 3. v_oem_quote — append-only (42P16): copy select list คำต่อคำจากฉบับ 0081
--    (53 คอลัมน์ ลำดับเดิมเป๊ะ) แล้วต่อท้ายด้วย vat_rate (อ่านจาก q.vat_rate
--    ตรงๆ ไม่มี literal ใน view อีกต่อไป)/vat_base_thb/vat_amount_thb
--
--    vat_base_thb/vat_amount_thb ยังคำนวณสดจาก grand_total ปัจจุบันของแถวนั้น
--    เสมอ (เหตุผลเดียวกับ deposit_amount_thb: grand_total เปลี่ยนได้ตอนต่อราคา
--    เก็บผลลัพธ์ไว้จะค้างเป็นเลขเก่า) แต่ตัวอัตรา (vat_rate) ที่ใช้คำนวณมาจาก
--    คอลัมน์ snapshot ของแถวนั้นแล้ว ไม่ใช่ literal ลอยของ view — ฝั่งแอปต้อง
--    อ่าน vat_rate จาก view นี้ ห้าม hardcode "7%" ในโค้ด
--
--    ทั้ง 3 คอลัมน์เป็น null เมื่อ grand_total เป็น null (ยังไม่เคยคำนวณราคา)
--    คำนวณให้ทั้งสองโหมด ('included' ก็คำนวณด้วย) — vat_mode เท่านั้นที่เป็น
--    ตัวตัดสินการแสดงผลฝั่งแอป ไม่ใช่การมี/ไม่มีค่าคอลัมน์พวกนี้
-- ============================================================================

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
  c.legal_name as bill_legal_name,
  c.tax_id as bill_tax_id,
  c.phone as bill_phone,
  c.contact_channel as bill_contact_channel,
  c.address as bill_address,
  (q.status = 'quoted' and q.quote_valid_until is not null
     and q.quote_valid_until < (now() at time zone 'Asia/Bangkok')::date) as is_expired_th,
  case when q.quote_valid_until is not null
       then q.quote_valid_until - (now() at time zone 'Asia/Bangkok')::date
       else null end as days_left_th,
  q.deposit_mode,
  q.deposit_input,
  dep.deposit_amount_thb,
  case q.deposit_mode
    when 'pct' then q.deposit_input
    when 'thb' then q.deposit_input / nullif(q.grand_total, 0)
    else null
  end as deposit_pct_effective,
  case when q.deposit_mode is not null then q.grand_total - dep.deposit_amount_thb else null end as balance_thb,
  -- ---- appended 0082+ only; do not insert new columns above this line ----
  q.vat_rate,
  vb.vat_base_thb,
  -- ส่วนที่เหลือ ไม่ใช่ round(base * vat_rate, 2) แยกต่างหาก — บังคับผลรวม =
  -- grand_total เป๊ะเสมอ (ดูเหตุผลที่หัวไฟล์)
  case when q.grand_total is null then null else q.grand_total - vb.vat_base_thb end as vat_amount_thb
from analytics.oem_quote q
left join analytics.oem_quote pq on pq.id = q.parent_quote_id
left join analytics.oem_customer c on c.id = q.customer_id and c.shop_id = q.shop_id
left join lateral (
  select
    case q.deposit_mode
      when 'pct' then round(q.grand_total * q.deposit_input, 2)
      when 'thb' then q.deposit_input
      else null
    end as deposit_amount_thb
) dep on true
left join lateral (
  -- vat_rate มาจาก q.vat_rate (snapshot ของแถวนั้นเอง) ไม่ใช่ literal ของ view
  select case
    when q.grand_total is null then null::numeric(14, 2)
    else round(q.grand_total / (1 + q.vat_rate), 2)
  end as vat_base_thb
) vb on true;

grant select on analytics.v_oem_quote to authenticated, service_role;

comment on view analytics.v_oem_quote is
  'ใบเสนอราคา OEM แบบสมบูรณ์ (join customer/parent + คำนวณสดจาก grand_total ปัจจุบันเสมอ: deposit §0081, VAT §0082) ห้ามแทรกคอลัมน์ใหม่กลางลิสต์ (42P16) ต่อท้ายเท่านั้น';

-- ============================================================================
-- 4. oem_quote_set_vat_mode — ตั้งโหมดแสดงผล VAT รายใบ security definer + pin
--    search_path + crm_require_owner_admin + for update (แบบเดียวกับ
--    oem_quote_set_deposit ของ 0081) แก้ได้เฉพาะสถานะ draft/quoted เท่านั้น —
--    ใบที่ปิดงาน/แพ้/ถูกแทนที่/หมดอายุแล้ว ห้ามแก้เอกสารย้อนหลัง แก้เฉพาะ
--    vat_mode เท่านั้น ไม่แตะ vat_rate (vat_rate เป็น snapshot คนละกลไก ดู §2)
--
--    ด่านเพิ่มเฉพาะไฟล์นี้: ถ้าร้านยังไม่จด VAT (oem_setting.seller_vat_registered
--    = false หรือยังไม่มีแถว oem_setting เลย → ถือเป็น false ตาม default ของ
--    ตาราง) ห้ามตั้งเป็น 'breakdown' — ออกเอกสารแยกบรรทัดภาษีทั้งที่ยังไม่ได้จด
--    ทะเบียนภาษีมูลค่าเพิ่มผิดกฎหมาย ปฏิเสธก่อนเขียน DB ไม่ใช่แค่เตือนฝั่งแอป
--
--    ⚠️ ผลกระทบที่ตั้งใจปล่อยให้เห็น (ตามที่สั่งให้เช็ค — ใบที่ส่งลูกค้าไปแล้ว
--    แล้วมาเปลี่ยนโหมดทีหลัง): RPC นี้ยอมแก้สถานะ 'quoted' ได้เหมือน
--    oem_quote_set_deposit — สถานะ 'quoted' ในระบบนี้แปลว่า "ใบถูกเสนอราคาแล้ว"
--    ซึ่งในทางปฏิบัติมักหมายถึงถูกส่งให้ลูกค้าดู/ตัดสินใจแล้ว ไม่ใช่แค่ draft
--    ภายใน เพราะยอดสุทธิ (grand_total) ไม่ขยับเมื่อเปลี่ยนโหมด การแก้นี้จึง
--    "ปลอดภัยด้านตัวเลข" แต่ไม่ปลอดภัยด้าน "เอกสารสองฉบับไม่ตรงกัน" — ระบบนี้ไม่มี
--    คอลัมน์ "ส่งให้ลูกค้าแล้วเมื่อไร" (ไม่มี sent_at/issued_at) ให้เช็คเพิ่มได้
--    จริง — รับทราบจาก Tech Lead แล้วว่าเป็นหนี้ที่ตั้งใจไม่ปิดรอบนี้ (เจ้าของกำลัง
--    UAT อยู่ ไม่ยัดของใหญ่เข้าไปตอนนี้) จึงคงพฤติกรรมเดิม ไม่เพิ่ม gate ใหม่
-- ============================================================================

create or replace function analytics.oem_quote_set_vat_mode(
  p_shop_id uuid,
  p_quote_id uuid,
  p_mode text
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_status text;
  v_vat_registered boolean;
begin
  if p_shop_id is null or p_quote_id is null then
    raise exception 'oem_quote_set_vat_mode: p_shop_id and p_quote_id are required';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  if p_mode is null or p_mode not in ('included', 'breakdown') then
    raise exception 'oem_quote_set_vat_mode: p_mode ต้องเป็น included หรือ breakdown เท่านั้น' using errcode = '22023';
  end if;

  -- for update: กันสอง request ยิงพร้อมกันแล้วอ่านสถานะเก่าทั้งคู่ (แบบเดียวกับ
  -- oem_quote_set_deposit)
  select status into v_status
    from analytics.oem_quote
   where id = p_quote_id and shop_id = p_shop_id
   for update;
  if not found then
    raise exception 'oem_quote_set_vat_mode: quote % not found for this shop', p_quote_id;
  end if;

  if v_status not in ('draft', 'quoted') then
    raise exception 'oem_quote_set_vat_mode: แก้โหมด VAT ได้เฉพาะใบสถานะ draft หรือ quoted เท่านั้น (ใบนี้สถานะ %) — ใบที่ปิดงาน/แพ้/ถูกแทนที่/หมดอายุแล้ว แก้เอกสารย้อนหลังไม่ได้', v_status
      using errcode = '22023';
  end if;

  if p_mode = 'breakdown' then
    select seller_vat_registered into v_vat_registered
      from analytics.oem_setting
     where shop_id = p_shop_id;
    -- ไม่มีแถว oem_setting เลย (ร้านยังไม่เคยตั้งค่าอะไร) ก็เท่ากับยังไม่จด VAT
    -- ตาม default ของตาราง (seller_vat_registered not null default false)
    v_vat_registered := coalesce(v_vat_registered, false);
    if not v_vat_registered then
      raise exception 'oem_quote_set_vat_mode: ร้านยังไม่ได้ติ๊กสถานะจดทะเบียน VAT (ตั้งค่า > ข้อมูลร้าน > จดทะเบียน VAT) ออกเอกสารแยกบรรทัดภาษีมูลค่าเพิ่มไม่ได้จนกว่าจะติ๊กสถานะนี้ก่อน' using errcode = '22023';
    end if;
  end if;

  update analytics.oem_quote
     set vat_mode = p_mode, updated_by = auth.uid(), updated_at = now()
   where id = p_quote_id and shop_id = p_shop_id;
end;
$$;

revoke execute on function analytics.oem_quote_set_vat_mode(uuid, uuid, text) from public, anon;
grant execute on function analytics.oem_quote_set_vat_mode(uuid, uuid, text) to authenticated, service_role;

-- ============================================================================
-- 5. oem_quote_renegotiate — signature เดิม 4 args เป๊ะ (plain replace, ไม่ต้อง
--    drop) แก้จุดเดียวจากฉบับ 0081: ใบใหม่สืบทอด vat_rate จากใบแม่ (v_old)
--    เพิ่มเข้าไปข้าง vat_mode ในทั้ง insert column list และ values — vat_mode
--    เดิมสืบทอดอยู่แล้วตั้งแต่ 0075 (v_old.vat_mode ยืนยันด้วย grep ก่อนเขียน
--    ไฟล์นี้) ไม่ต้องแก้ส่วนนั้น
--
--    เหตุผล: ต่อราคาคือใบเดียวกันในเชิงดีล (parent/child chain) ไม่ควรเปลี่ยน
--    อัตราภาษีกลางคันจากการต่อราคา — ถ้าไม่สืบทอด ใบใหม่ที่ insert โดยไม่ระบุ
--    vat_rate จะได้ default ของคอลัมน์ ณ เวลานั้น (เช่น หลังอัตราประเทศเปลี่ยน
--    ไปแล้ว) ซึ่งผิดหลักการ snapshot ที่ §2 วางไว้ (ใบในดีลเดียวกันควรใช้อัตรา
--    เดียวกันตลอด ไม่ใช่อัตรา ณ วันต่อราคาครั้งล่าสุด)
--
--    ทุกอย่างอื่น (logic/comment ของ 0081 เดิมทั้งหมด) คงเดิมเป๊ะ ไม่แตะ
-- ============================================================================

create or replace function analytics.oem_quote_renegotiate(p_shop_id uuid, p_quote_id uuid, p_new_discount_thb numeric, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $function$
declare
  v_old analytics.oem_quote%rowtype;
  v_set analytics.oem_setting%rowtype;
  v_new_id uuid;
  v_new_no text;
  v_i int;
  v_price_ex_gold_sum numeric := 0;
  v_cost_ex_gold_sum numeric := 0;
  v_margin_after numeric;
  v_valid_days int;
  v_row record;
  v_new_grand_total numeric;
  v_jobvalue_min numeric;
  v_has_items boolean := false;
  -- ---- silver999 (bar) ----
  v_bkk_today date;
  v_has_bar_item boolean := false;
  v_production_total_sum numeric := 0;
  -- 0079-fix: เหมือน v_has_ungated_item ใน oem_quote_save — true เมื่อ item
  -- ใดก็ตามใน loop มี margin_charged_pct เป็น null (ตรวจ margin รายชิ้นไม่ได้)
  v_has_ungated_item boolean := false;
  -- ---- 0081: มัดจำที่ใบใหม่จะสืบทอด (ก่อน clamp/เคลียร์) ----
  v_new_deposit_mode text;
  v_new_deposit_input numeric;
begin
  if p_shop_id is null or p_quote_id is null then
    raise exception 'oem_quote_renegotiate: p_shop_id and p_quote_id are required';
  end if;
  if p_new_discount_thb is null or p_new_discount_thb < 0 then
    raise exception 'oem_quote_renegotiate: p_new_discount_thb must be >= 0';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  -- timezone ไทย เสมอ — ใช้เช็คหมดอายุและตั้ง valid_until ของใบใหม่
  v_bkk_today := (now() at time zone 'Asia/Bangkok')::date;

  select * into v_old from analytics.oem_quote where id = p_quote_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'oem_quote_renegotiate: quote % not found for this shop', p_quote_id;
  end if;
  if v_old.status <> 'quoted' then
    raise exception 'oem_quote_renegotiate: ต่อรองราคาได้เฉพาะใบสถานะ quoted เท่านั้น (ใบนี้สถานะ %)', v_old.status
      using errcode = '22023';
  end if;
  if v_old.quote_valid_until is null or v_old.quote_valid_until < v_bkk_today then
    raise exception 'oem_quote_renegotiate: ใบเสนอราคาหมดอายุแล้ว ต่อรองราคาไม่ได้ — ออกใบใหม่แทน' using errcode = '22023';
  end if;

  select * into v_set from analytics.oem_setting where shop_id = p_shop_id;
  if v_set.shop_id is null then
    -- LOW: fallback ต้อง seed ให้ครบทุกค่าที่ฟังก์ชันนี้อ่าน ไม่งั้น gate หายเงียบ
    v_set.margin_floor_pct := 0.20; v_set.margin_hard_floor_pct := 0.15;
    v_set.nre_max_share_pct := 0.25; v_set.min_job_value_thb := 8000;
    v_set.quote_valid_days_silver := 30; v_set.quote_valid_days_gold := 7; v_set.quote_valid_days_brass := 45;
    v_set.bar_margin_pct := 0.19;
  end if;

  for v_row in select * from analytics.oem_quote_item where quote_id = v_old.id order by seq loop
    v_has_items := true;
    if (v_row.input->>'metal') = 'silver999' then
      v_has_bar_item := true;
    end if;
    if (v_row.input->>'metal') = 'gold' then
      v_price_ex_gold_sum := v_price_ex_gold_sum + coalesce(v_row.item_total, 0)
                              - coalesce((v_row.calc->'breakdown'->'metal'->>'per_piece')::numeric, 0) * v_row.qty;
      v_cost_ex_gold_sum := v_cost_ex_gold_sum + coalesce(v_row.cost_piece, 0) * v_row.qty
                             - coalesce((v_row.calc->'breakdown'->'metal'->>'per_piece')::numeric, 0) * v_row.qty;
    else
      v_price_ex_gold_sum := v_price_ex_gold_sum + coalesce(v_row.item_total, 0);
      v_cost_ex_gold_sum := v_cost_ex_gold_sum + coalesce(v_row.cost_piece, 0) * v_row.qty;
    end if;

    -- ด่านมูลค่างานขั้นต่ำ (production-only): คิดจาก items จริงในลูปนี้ ห้ามใช้
    -- v_old.quote_total (รวมมูลค่าแท่งด้วย)
    if (v_row.input->>'metal') <> 'silver999' then
      v_production_total_sum := v_production_total_sum + coalesce(v_row.item_total, 0);
    end if;

    -- 0079-fix: item นี้ระบบตรวจ margin รายชิ้นไม่ได้ (บันทึกไว้ตอน save เป็น
    -- margin_charged_pct = null) — เช็คจากค่า ไม่เช็คจาก metal ตรงๆ
    if v_row.margin_charged_pct is null then
      v_has_ungated_item := true;
    end if;

    v_valid_days := least(
      coalesce(v_valid_days, 9999),
      case (v_row.input->>'metal')
        when 'gold' then coalesce(v_set.quote_valid_days_gold, 7)
        when 'brass' then coalesce(v_set.quote_valid_days_brass, 45)
        when 'silver999' then 0
        else coalesce(v_set.quote_valid_days_silver, 30)
      end
    );
  end loop;
  -- LOW: ใช้ตัวแปรของตัวเอง ไม่พึ่ง found หลัง loop (found = ผลของคำสั่งสุดท้าย)
  if not v_has_items then
    raise exception 'oem_quote_renegotiate: ใบ % ไม่มีรายการ ต่อราคาไม่ได้', p_quote_id using errcode = '22023';
  end if;
  v_production_total_sum := v_production_total_sum + coalesce(v_old.nre_price, 0);

  -- C1: guard เดียวกับ save
  if p_new_discount_thb > 0 and p_new_discount_thb >= v_price_ex_gold_sum then
    raise exception 'oem_quote_renegotiate: ส่วนลดใหม่ % บาท มากกว่าหรือเท่ากับมูลค่างานส่วนที่คิดกำไรได้ (% บาท) — ไม่มีทางลัด',
      p_new_discount_thb, round(v_price_ex_gold_sum, 2)
      using errcode = '22023';
  end if;

  -- H1: ด่านมูลค่างานขั้นต่ำ — มี item เงินแท่ง -> ดูเฉพาะมูลค่างานผลิต (ก่อนหัก
  -- ส่วนลด) ข้ามถ้า = 0 (ใบแท่งล้วน) · ไม่มี item เงินแท่ง -> พฤติกรรมเดิมเป๊ะ
  v_new_grand_total := coalesce(v_old.quote_total, 0) - p_new_discount_thb;
  v_jobvalue_min := greatest(
    coalesce(v_set.min_job_value_thb, 8000),
    case when coalesce(v_old.nre_cost, 0) > 0
         then v_old.nre_cost / coalesce(v_set.nre_max_share_pct, 0.25) else 0 end
  );
  if v_has_bar_item then
    if v_production_total_sum > 0 and v_production_total_sum < v_jobvalue_min then
      raise exception 'oem_quote_renegotiate: มูลค่างานส่วนที่เป็นงานผลิต (% บาท) ต่ำกว่าเกณฑ์ขั้นต่ำ % บาท — ต่อราคาไม่ได้ (ใบเงินแท่งล้วนไม่ติดด่านนี้)',
        v_production_total_sum, v_jobvalue_min using errcode = '22023';
    end if;
  else
    if v_new_grand_total < v_jobvalue_min then
      raise exception 'oem_quote_renegotiate: ส่วนลดใหม่ทำให้มูลค่างานรวม (%) ต่ำกว่าเกณฑ์ขั้นต่ำ % บาท — ต่อราคาไม่ได้',
        v_new_grand_total, v_jobvalue_min
        using errcode = '22023';
    end if;
  end if;

  v_margin_after := case when (v_price_ex_gold_sum - p_new_discount_thb) > 0
    then round(((v_price_ex_gold_sum - p_new_discount_thb) - v_cost_ex_gold_sum) / (v_price_ex_gold_sum - p_new_discount_thb), 4) end;

  -- 0079: เติม p_new_discount_thb > 0 เหตุผลเดียวกับ save — ด่านนี้กันส่วนลด
  -- กัดกำไร ไม่ใช่กันราคาที่ร้านประกาศเอง (ใบแท่ง 1 กก. margin จริง 8.4% ต่ำ
  -- กว่า hard floor 15% ได้แม้ p_new_discount_thb = 0 ถ้าไม่กันจะปฏิเสธการ
  -- ต่อราคาที่ไม่มีส่วนลดเลย)
  if p_new_discount_thb > 0
     and (v_margin_after is null or v_margin_after < v_set.margin_hard_floor_pct) then
    raise exception 'oem_quote_renegotiate: ส่วนลดใหม่ % บาท ทำให้ margin % ต่ำกว่า hard floor % — ไม่มีทางลัด',
      p_new_discount_thb,
      coalesce(round(v_margin_after * 100, 1)::text || '%', 'คำนวณไม่ได้'),
      round(v_set.margin_hard_floor_pct * 100, 1)::text || '%'
      using errcode = '22023';
  end if;

  -- 0079-fix (แก้จากรอบแรก): note-tier — เดิมใช้ "v_old.margin_charged_pct is
  -- null" (= "ใบเดิมไม่มี item งานผลิตเลย") เป็นตัวแทนที่ผิดเหมือน §3: เติม
  -- item งานผลิตชิ้นเล็ก margin สูงเข้าไปตอน save ก็ทำให้ v_old.margin_charged_pct
  -- ไม่ null แล้วปลดล็อกด่านทั้งใบตอน renegotiate ได้ทันที ทั้งที่มูลค่าส่วน
  -- ใหญ่ยังเป็นแท่ง margin บางเท่าเดิม — แก้เป็น v_has_ungated_item (ตั้งจริง
  -- ระหว่าง loop items ด้านบน จาก v_row.margin_charged_pct รายตัว ไม่ใช่ค่า
  -- MIN รวมทั้งใบ) ด่านรวมทั้งใบเป็นด่านเดียวที่เหลือสำหรับ item แบบนี้ ต้อง
  -- ทำงานเสมอไม่ว่าใบจะมี item งานผลิต margin สูงมาช่วยดันค่าเฉลี่ยหรือไม่ก็ตาม
  -- · LOW-6: ข้อความต้องไม่โทษ "ส่วนลด" เมื่อ clause ไฟจากเหตุผลอื่น
  if (p_new_discount_thb > 0 or v_has_ungated_item)
     and v_margin_after < v_set.margin_floor_pct
     and (p_reason is null or btrim(p_reason) = '') then
    if p_new_discount_thb > 0 then
      raise exception 'oem_quote_renegotiate: ส่วนลดใหม่ % บาท ทำให้ margin รวม % ต่ำกว่า floor % — ต้องระบุเหตุผล',
        p_new_discount_thb, coalesce(round(v_margin_after * 100, 1)::text || '%', 'คำนวณไม่ได้'),
        round(v_set.margin_floor_pct * 100, 1)::text || '%'
        using errcode = '22023';
    else
      raise exception 'oem_quote_renegotiate: ใบนี้มีรายการที่ระบบตรวจ margin รายชิ้นไม่ได้อยู่ด้วย (เช่น เงินแท่ง) ทำให้ margin รวม % ต่ำกว่า floor % — ต้องระบุเหตุผล แม้ไม่ได้ลดราคาก็ตาม',
        coalesce(round(v_margin_after * 100, 1)::text || '%', 'คำนวณไม่ได้'), round(v_set.margin_floor_pct * 100, 1)::text || '%'
        using errcode = '22023';
    end if;
  end if;

  -- 0081: ใบใหม่สืบทอดเงื่อนไขมัดจำจากใบแม่ (v_old) เสมอ — เงื่อนไขที่ตกลงกัน
  -- ไว้ไม่ควรหายตอนต่อราคา ยกเว้นโหมด thb ที่ยอดมัดจำเดิม "มากกว่า" grand_total
  -- ใหม่ ต้อง clamp ลงมาเท่ากับ grand_total ใหม่ (ดูคอมเมนต์หัวฟังก์ชันสำหรับ
  -- ผลข้างเคียงที่ตั้งใจปล่อยให้เห็น + เคสขอบ grand_total ใหม่ <= 0)
  v_new_deposit_mode := v_old.deposit_mode;
  v_new_deposit_input := v_old.deposit_input;
  if v_new_deposit_mode = 'thb' and v_new_deposit_input is not null then
    if v_new_grand_total <= 0 then
      v_new_deposit_mode := null;
      v_new_deposit_input := null;
    elsif v_new_deposit_input > v_new_grand_total then
      v_new_deposit_input := v_new_grand_total;
    end if;
  end if;

  for v_i in 1..5 loop
    v_new_no := analytics.oem_quote_next_no(p_shop_id);
    v_new_id := gen_random_uuid();
    begin
      insert into analytics.oem_quote (
        id, shop_id, quote_no, customer_name, customer_contact, input, calc, rate_snapshot,
        cost_piece, price_per_piece, nre_cost, nre_price, pieces_subtotal, quote_total,
        margin_actual_pct, margin_charged_pct, q_run, flask_count, plating_batch_count,
        status, discount_thb, discount_reason, grand_total, margin_after_discount_pct,
        parent_quote_id, root_quote_id, customer_id, vat_mode, vat_rate,
        deposit_mode, deposit_input,
        quote_valid_until, created_by, updated_by
      ) values (
        v_new_id, v_old.shop_id, v_new_no, v_old.customer_name, v_old.customer_contact, null, null, v_old.rate_snapshot,
        v_old.cost_piece, v_old.price_per_piece, v_old.nre_cost, v_old.nre_price, v_old.pieces_subtotal, v_old.quote_total,
        v_old.margin_actual_pct, v_old.margin_charged_pct, v_old.q_run, v_old.flask_count, v_old.plating_batch_count,
        'quoted', p_new_discount_thb, p_reason, v_new_grand_total, v_margin_after,
        v_old.id, coalesce(v_old.root_quote_id, v_old.id), v_old.customer_id, v_old.vat_mode, v_old.vat_rate,
        v_new_deposit_mode, v_new_deposit_input,
        v_bkk_today + coalesce(v_valid_days, v_set.quote_valid_days_silver, 30), auth.uid(), auth.uid()
      );
      exit;
    exception when unique_violation then
      if v_i = 5 then
        raise exception 'oem_quote_renegotiate: ออกเลขที่ใบใหม่ไม่สำเร็จ ลองใหม่อีกครั้ง';
      end if;
    end;
  end loop;

  insert into analytics.oem_quote_item (
    shop_id, quote_id, seq, product_id, sku_snapshot, product_name_snapshot,
    input, calc, qty, cost_piece, price_per_piece, item_total,
    q_run, flask_count, plating_batch_count, margin_charged_pct
  )
  select
    shop_id, v_new_id, seq, product_id, sku_snapshot, product_name_snapshot,
    input, calc, qty, cost_piece, price_per_piece, item_total,
    q_run, flask_count, plating_batch_count, margin_charged_pct
  from analytics.oem_quote_item
  where quote_id = v_old.id
  order by seq;

  update analytics.oem_quote set status = 'superseded', updated_by = auth.uid(), updated_at = now()
  where id = v_old.id;

  return v_new_id;
end;
$function$;

revoke execute on function analytics.oem_quote_renegotiate(uuid, uuid, numeric, text) from public, anon;
grant execute on function analytics.oem_quote_renegotiate(uuid, uuid, numeric, text) to authenticated, service_role;

notify pgrst, 'reload schema';
