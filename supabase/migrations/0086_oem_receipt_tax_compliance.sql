-- 0086_oem_receipt_tax_compliance.sql
-- แก้ 3 ข้อที่ security review ตีกลับ NO-GO บนใบเสร็จ/ใบกำกับภาษี OEM (0084)
-- เจ้าของ+Tech Lead ยืนยันแล้วว่าทั้งสามข้อเกิดขึ้นจริง ไม่ใช่ทฤษฎี
--
-- ============ 1) 🔴 ออกใบกำกับภาษีให้ผู้ซื้อข้อมูลไม่ครบได้ (ป.รัษฎากร ม.86/4) ==
-- oem_receipt_issue (0084) บังคับแค่ buyer_legal_name ส่วนเลขผู้เสียภาษี/ที่อยู่/
-- สาขาไม่บังคับเลย และคอมเมนต์ที่ 0084:287 อ้างว่า "UI เตือนเหลืองเอง" — ตรวจแล้ว
-- ไม่มีจริง (แก้ไว้ตรงนี้แทน — ดู comment ในฟังก์ชันด้านล่าง §3)
--
-- แก้ 3 ส่วน:
--  (ก) analytics.oem_customer.branch_label — คอลัมน์สาขาผู้ซื้อที่ยังไม่มี ทำให้
--      buyer_branch_label ถูก hardcode null ตายตัวที่ 0084:367 มาตลอด
--  (ข) analytics.oem_quote_set_billing — ขยายให้รับ branch_label ผ่าน p_customer
--      (jsonb key ใหม่ ไม่ใช่ parameter ใหม่ — ดูเหตุผล "ไม่ overload" ด้านล่าง)
--  (ค) analytics.oem_receipt_issue — เพิ่มด่าน: ผู้ซื้อมีเลขผู้เสียภาษี (=
--      นิติบุคคล = ใบกำกับภาษีเต็มรูป) ต้องมีที่อยู่ + สาขาครบ ไม่งั้นปฏิเสธ
--      พร้อมบอกไปกรอกที่ไหน · ไม่มีเลขผู้เสียภาษี (บุคคลธรรมดา) ผ่านได้เหมือนเดิม
--      และเขียน buyer_branch_label จาก oem_customer.branch_label จริงแทน null
--
-- ⚠️ ทำไม "ไม่" เปลี่ยน arg list ของทั้งสองฟังก์ชัน (= ไม่มี overload ไม่ต้อง drop):
--  - oem_quote_set_billing รับ p_customer เป็น jsonb object อยู่แล้ว (0075) —
--    branch_label เป็นแค่ key ใหม่ในอ็อบเจกต์เดิม เหมือน legal_name/tax_id/
--    address/phone/contact_channel ทุกตัวที่มีอยู่แล้ว ไม่ต้องเพิ่ม parameter
--  - oem_receipt_issue อ่าน branch_label ได้จาก analytics.oem_customer ตรงๆ
--    (ฟังก์ชันนี้ select เข้า v_customer จากตาราง oem_customer อยู่แล้วตั้งแต่
--    0084 §9 buyer gate เดิม) ไม่ต้องรับพารามิเตอร์ใหม่จาก client เลย
--  ผลคือทั้งสองฟังก์ชันเป็น "plain create or replace" (signature เดิมเป๊ะ) —
--  เลือกทางนี้เพราะแก้น้อยกว่าและตัดความเสี่ยง overload ทิ้งไปทั้งหมด (บทเรียน
--  0060/0064/0081 — ดู skill 3j-migration-traps ข้อ 1) ยังคง re-grant execute
--  ให้ทั้งคู่ตามธรรมเนียมทีม (grant หายได้แม้ signature ไม่เปลี่ยน — ข้อ 2)
--
-- ============ 2) 🔴 "เอกสารออกแล้วห้ามแก้" ยังไม่มีด่านที่ DB ============
-- 0018:23 `alter default privileges ... grant all on tables to service_role`
-- และทุก action ในแอปวิ่งด้วย service_role (BYPASSRLS) แปลว่า oem_receipt ถูก
-- UPDATE/DELETE ตรงๆ ได้เงียบๆ โดยไม่ผ่าน RPC เลย — คอมเมนต์ที่ 0084:129 ที่ว่า
-- "แก้เนื้อหาไม่ได้เลย" จริงแค่ระดับวินัย (ไม่มี RPC ไหนเปิดให้แก้) ไม่จริงระดับ
-- โครงสร้าง (ไม่มีอะไรกันการ UPDATE/DELETE ตรงๆ)
--
-- แก้: trigger `before update or delete` บน oem_receipt (§4 ด้านล่าง)
--  - DELETE ปฏิเสธเสมอ ไม่มีข้อยกเว้น
--  - UPDATE อนุญาตทางเดียว status: issued -> void และแตะได้เฉพาะ 4 คอลัมน์
--    (status, void_reason, voided_at, voided_by) คอลัมน์อื่นเปลี่ยนแม้ตัวเดียว
--    = ปฏิเสธ ตรวจด้วย jsonb diff แบบ "ลบคอลัมน์ที่อนุญาตออกก่อนเทียบ" (ไม่ใช่
--    list คอลัมน์ทีละตัว) เพื่อให้คอลัมน์ใหม่ที่เพิ่มในอนาคตถูกป้องกันเองทันที
--    โดยไม่ต้องมีใครจำมาแก้ trigger นี้อีก
--  - ยืนยันแล้ว: analytics.oem_receipt_void (0084 §4) อัปเดตแค่ status/
--    void_reason/voided_at/voided_by เท่านั้น (แถวอื่นทุกคอลัมน์ไม่อยู่ใน SET
--    clause เลย จึงเท่าค่าเดิมของแถวเสมอ) — ยังทำงานผ่าน trigger ใหม่ได้ 100%
--    ไม่ต้องแก้ไฟล์ 0084 หรือ 0085
--
-- ============ 3) received_date ย้อนหลังข้ามงวดภาษีได้ ============
-- เดิมเช็คแค่ "ไม่เกินวันนี้" — ใส่วันที่ปีที่แล้วได้ ทั้งที่เลขที่เอกสารมาจาก
-- เดือนปัจจุบัน (RT-YYMM ของ v_bkk_today) แปลว่า tax point จะตกงวดที่ยื่นภาษี
-- ไปแล้ว แก้: ปฏิเสธถ้า p_received_date < ต้นเดือนปัจจุบันตามเวลาไทย (§3
-- ด้านล่าง ต่อจากด่านวันในอนาคตเดิม)
--
-- ⚠️ revised (v1 ถูกตีกลับโดย coordinator ก่อน apply): ด่านนี้กว้างเกินไปตอนแรก
-- — บล็อก "reissue ข้ามเดือน" ที่ถูกต้องตามบัญชีไปด้วย (เคสจริง: ออกใบ 15 ส.ค.
-- ด้วย received_date = 15 ส.ค. ถูกต้องตอนนั้น เจอผิดพลาด void วันที่ 5 ก.ย.
-- แล้ว reissue — ใบใหม่ "ต้อง" คง received_date = 15 ส.ค. เพราะเป็น tax point
-- จริง ด่าน v1 จะบังคับให้กรอกวันที่ผิดแทน ซึ่งแย่กว่าปัญหาที่ด่านนี้ตั้งใจกัน)
-- แก้เป็น: เปิดข้อยกเว้นเฉพาะ p_reissued_from is not null และ p_received_date
-- ตรงกับ received_date ของใบเดิมที่ถูก void เป๊ะเท่านั้น (ไม่ใช่ "เป็น reissue
-- ก็ผ่านด่านงวดภาษีไปเลย" — จะกลายเป็นทางลัดย้อนงวดภาษี แค่ void ใบไหนก็ได้แล้ว
-- อ้างว่า reissue ด้วยวันที่ใดก็ได้) ใบที่ไม่ใช่ reissue ยังใช้ด่านงวดภาษีเดิม
-- ทุกประการ ไม่ผ่อน — ดู comment เต็มที่ตัวฟังก์ชัน §3
--
-- ============ อ่านคู่กับ ============
-- 0084 (oem_receipt/oem_receipt_issue/oem_receipt_void/v_oem_receipt ฉบับ
-- ตั้งต้น — ไฟล์นี้ replace เฉพาะ oem_receipt_issue เท่านั้น ไม่แตะ
-- oem_receipt_void/v_oem_receipt/v_oem_quote เลย), 0075 (oem_customer,
-- oem_quote_set_billing ฉบับตั้งต้น), 0079 (seller_* บน oem_setting, ต้นแบบ
-- ด่านข้อมูลผู้ขายที่ §3 ของ oem_receipt_issue ลอกแนวมา), 0085 (renegotiate —
-- ไฟล์นี้ไม่แตะเช่นกัน ตามกติกาเหล็กของทีม)
-- ============================================================================

-- ============================================================================
-- 1. analytics.oem_customer — เพิ่ม branch_label (สาขาผู้ซื้อ) แหล่งข้อมูลจริง
--    ตัวแรกของระบบ (เดิมไม่มีคอลัมน์นี้เลยตั้งแต่ 0075)
-- ============================================================================

alter table analytics.oem_customer
  add column if not exists branch_label text;

comment on column analytics.oem_customer.branch_label is
  '0086: สำนักงานใหญ่ / สาขาที่ ... ของผู้ซื้อ — พิมพ์บนใบกำกับภาษีเต็มรูปตามแบบไทย บังคับกรอกที่ analytics.oem_receipt_issue เฉพาะตอนผู้ซื้อมี tax_id (นิติบุคคล) เท่านั้น บุคคลธรรมดา (ไม่มี tax_id) เว้นว่างได้เหมือนเดิม';

-- ============================================================================
-- 2. analytics.oem_quote_set_billing — plain replace (signature เดิมเป๊ะ
--    uuid, uuid, jsonb — ดูเหตุผล "ไม่ overload" ที่หัวไฟล์) เพิ่มการอ่าน/
--    เขียน branch_label จาก key ใหม่ใน p_customer เท่านั้น ตรรกะอื่นทั้งหมด
--    คัดลอกจาก 0075 คำต่อคำ ไม่แตะ
-- ============================================================================

create or replace function analytics.oem_quote_set_billing(
  p_shop_id uuid,
  p_quote_id uuid,
  p_customer jsonb
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_status text;
  v_existing_customer_id uuid;
  v_customer_id uuid;
  v_legal_name text;
  v_tax_id text;
  v_address jsonb;
  v_phone text;
  v_contact_channel text;
  v_branch_label text; -- 0086: ใหม่ — key เพิ่มใน p_customer เดิม ไม่ใช่ parameter ใหม่
begin
  if p_shop_id is null or p_quote_id is null or p_customer is null then
    raise exception 'oem_quote_set_billing: p_shop_id, p_quote_id and p_customer are required';
  end if;
  if jsonb_typeof(p_customer) <> 'object' then
    raise exception 'oem_quote_set_billing: p_customer must be a json object';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  select status, customer_id into v_status, v_existing_customer_id
    from analytics.oem_quote where id = p_quote_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'oem_quote_set_billing: quote % not found for this shop', p_quote_id;
  end if;
  if v_status not in ('quoted', 'won') then
    raise exception 'oem_quote_set_billing: ผูกข้อมูลออกบิลได้เฉพาะใบที่สถานะ quoted หรือ won (ใบนี้สถานะ %)', v_status
      using errcode = '22023';
  end if;

  v_legal_name := nullif(btrim(p_customer->>'legal_name'), '');
  if v_legal_name is null then
    raise exception 'oem_quote_set_billing: p_customer.legal_name is required' using errcode = '22023';
  end if;
  v_tax_id := nullif(btrim(p_customer->>'tax_id'), '');
  v_address := p_customer->'address';
  v_phone := nullif(btrim(p_customer->>'phone'), '');
  v_contact_channel := nullif(btrim(p_customer->>'contact_channel'), '');
  -- 0086: branch_label ยังคง "optional ที่นี่" เหมือน tax_id — บังคับให้ครบเมื่อ
  -- จำเป็นจริง (ผู้ซื้อมี tax_id) ทำที่ oem_receipt_issue ตอนออกใบเท่านั้น ไม่ใช่
  -- ที่นี่ เพราะจุดนี้เป็นแค่ "บันทึกข้อมูลผู้ซื้อ" ยังไม่ใช่จุดที่ตัดสินว่าจะออก
  -- เอกสารภาษีแบบไหน (ผู้ซื้ออาจเพิ่ม tax_id เข้ามาทีหลังก็ได้ ก่อนออกใบจริง)
  v_branch_label := nullif(btrim(p_customer->>'branch_label'), '');

  if v_existing_customer_id is not null then
    update analytics.oem_customer set
      legal_name = v_legal_name,
      tax_id = v_tax_id,
      address = v_address,
      phone = v_phone,
      contact_channel = v_contact_channel,
      branch_label = v_branch_label,
      updated_at = now()
    where id = v_existing_customer_id and shop_id = p_shop_id;
    v_customer_id := v_existing_customer_id;
  else
    insert into analytics.oem_customer (shop_id, legal_name, tax_id, address, phone, contact_channel, branch_label)
    values (p_shop_id, v_legal_name, v_tax_id, v_address, v_phone, v_contact_channel, v_branch_label)
    returning id into v_customer_id;
  end if;

  update analytics.oem_quote set customer_id = v_customer_id, updated_by = auth.uid(), updated_at = now()
  where id = p_quote_id and shop_id = p_shop_id;

  return v_customer_id;
end;
$$;

revoke execute on function analytics.oem_quote_set_billing(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function analytics.oem_quote_set_billing(uuid, uuid, jsonb) to authenticated, service_role;

-- ============================================================================
-- 3. analytics.oem_receipt_issue — plain replace (signature เดิมเป๊ะ 9 args —
--    ดูเหตุผล "ไม่ overload" ที่หัวไฟล์) เปลี่ยน 3 จุด เทียบกับ 0084:
--      (a) buyer completeness gate ใหม่ — มี tax_id ต้องมีที่อยู่+สาขาครบ
--      (b) buyer_branch_label เขียนค่าจริงจาก v_customer.branch_label แทน null
--      (c) received_date ต้องอยู่ในงวดภาษีเดือนปัจจุบัน (ไทย) ไม่ย้อนข้ามเดือน
--    ตรรกะ/ด่าน/คอมเมนต์อื่นทั้งหมดคัดลอกจาก 0084 คำต่อคำ ไม่แตะ (รวมถึงด่าน
--    กันจ่ายเกิน, การพลิก won อัตโนมัติ, การออกเลขที่เอกสาร)
-- ============================================================================

create or replace function analytics.oem_receipt_issue(
  p_shop_id uuid,
  p_quote_id uuid,
  p_amount_thb numeric,
  p_received_date date,
  p_kind text,
  p_payment_method text default null,
  p_payment_ref text default null,
  p_description text default null,
  p_reissued_from uuid default null
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_quote analytics.oem_quote%rowtype;
  v_set analytics.oem_setting%rowtype;
  v_customer analytics.oem_customer%rowtype;
  v_bkk_today date;
  v_bkk_month_start date;
  v_reissued_from_received_date date; -- 0086: วันรับเงินของใบเดิมที่ถูก void (เฉพาะตอน reissue)
  v_paid_before numeric;
  v_vat_base numeric;
  v_vat_amount numeric;
  v_description text;
  v_payment_ref text;
  v_seller_snapshot jsonb;
  v_doc_key text;
  v_no int;
  v_receipt_no text;
  v_receipt_id uuid;
begin
  if p_shop_id is null or p_quote_id is null then
    raise exception 'oem_receipt_issue: p_shop_id and p_quote_id are required';
  end if;
  -- range check แทน "<= 0" เดี่ยวๆ — บทเรียน 0083 (NaN > ทุกค่ารวม infinity ใน
  -- Postgres จึงไหลผ่าน "> 0" ไปเงียบๆ ได้ ถ้าไม่ล้อมด้วย not(between))
  if p_amount_thb is null or not (p_amount_thb > 0 and p_amount_thb <= 100000000) then
    raise exception 'oem_receipt_issue: p_amount_thb must be a finite number > 0 and <= 100,000,000' using errcode = '22023';
  end if;
  if p_received_date is null then
    raise exception 'oem_receipt_issue: p_received_date is required';
  end if;
  if p_kind is null or p_kind not in ('deposit', 'partial', 'final') then
    raise exception 'oem_receipt_issue: p_kind must be deposit, partial, or final' using errcode = '22023';
  end if;
  if p_payment_method is not null and p_payment_method not in ('transfer', 'cash', 'other') then
    raise exception 'oem_receipt_issue: p_payment_method must be transfer, cash, other, or null' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  -- ยืนยันว่า p_reissued_from ต้องชี้ไปใบที่ถูก void ไปแล้วในร้านนี้เท่านั้น (ผิด
  -- ต้อง void ก่อนถึงจะ reissue ได้ — ตามลำดับที่ §4 ของ design กำหนด) และยังไม่
  -- เคยถูก reissue ซ้ำมาก่อน (กันออกใบแทนใบเดียวกันซ้ำสองครั้งโดยไม่ตั้งใจ) — 0086:
  -- เปลี่ยนจาก exists() เป็น select ... into เพื่อดึง received_date ของใบเดิมมาด้วย
  -- (ใช้เป็นข้อยกเว้นด่านงวดภาษี §3 ด้านล่าง — reissue ต้องใช้วันเดียวกับใบเดิมเท่านั้น)
  if p_reissued_from is not null then
    select received_date into v_reissued_from_received_date
      from analytics.oem_receipt
     where id = p_reissued_from and shop_id = p_shop_id and status = 'void';
    if not found then
      raise exception 'oem_receipt_issue: p_reissued_from ต้องชี้ไปใบเสร็จที่ถูกยกเลิก (void) แล้วในร้านนี้เท่านั้น' using errcode = '22023';
    end if;
    if exists (
      select 1 from analytics.oem_receipt
       where reissued_from_receipt_id = p_reissued_from and status = 'issued'
    ) then
      raise exception 'oem_receipt_issue: ใบเสร็จ % ถูก reissue ไปแล้ว ออกซ้ำอีกใบไม่ได้', p_reissued_from using errcode = '22023';
    end if;
  end if;

  -- timezone ไทย เสมอ — DB เป็น UTC ก่อน 07:00 ไทยจะเหลื่อมวัน ทั้งเลขที่เอกสาร
  -- และการเช็ค p_received_date ต้องยึดวันนี้ตามเวลาไทย ไม่ใช่ current_date (UTC)
  v_bkk_today := (now() at time zone 'Asia/Bangkok')::date;
  v_bkk_month_start := date_trunc('month', v_bkk_today)::date;

  -- for update: กันสอง request ออกใบพร้อมกันแล้วอ่านสถานะ/paid เก่าทั้งคู่
  select * into v_quote
    from analytics.oem_quote
   where id = p_quote_id and shop_id = p_shop_id
   for update;
  if not found then
    raise exception 'oem_receipt_issue: quote % not found for this shop', p_quote_id;
  end if;

  -- §4: ออกใบเสร็จได้เฉพาะใบสถานะ quoted/expired/won (เซ็ตที่ 0076 รับรองว่าไป
  -- won ได้อยู่แล้ว) draft = เลขไม่เคยผ่าน gate เลย · lost/rejected/superseded =
  -- ปฏิเสธ (superseded คือใบที่ถูกแทนที่แล้ว — ต้องใช้ quote_id ของใบ active ปัจจุบัน)
  if v_quote.status not in ('quoted', 'expired', 'won') then
    raise exception 'oem_receipt_issue: ออกใบเสร็จได้เฉพาะใบสถานะ quoted, expired หรือ won เท่านั้น (ใบนี้สถานะ %) — ถ้าใบนี้ถูกต่อราคาไปแล้ว ให้ใช้ quote_id ของใบล่าสุดในดีลนี้แทน', v_quote.status
      using errcode = '22023';
  end if;
  if v_quote.grand_total is null then
    raise exception 'oem_receipt_issue: ใบเสนอราคานี้ยังไม่มียอดรวม (grand_total) — ข้อมูลผิดปกติ ติดต่อทีมพัฒนา';
  end if;

  -- §9: gate ข้อมูลผู้ขาย — ใบกำกับภาษีออกได้เฉพาะร้านที่จดทะเบียน VAT และมีข้อมูล
  -- ครบเท่านั้น บังคับที่ DB ไม่ใช่แค่เตือนที่ปุ่ม
  select * into v_set from analytics.oem_setting where shop_id = p_shop_id;
  if v_set.shop_id is null or not coalesce(v_set.seller_vat_registered, false) then
    raise exception 'oem_receipt_issue: ร้านยังไม่ได้ติ๊กสถานะจดทะเบียน VAT (ตั้งค่า > ข้อมูลร้าน) ออกใบเสร็จ/ใบกำกับภาษีไม่ได้จนกว่าจะติ๊กสถานะนี้ก่อน' using errcode = '22023';
  end if;
  if nullif(btrim(v_set.seller_legal_name), '') is null then
    raise exception 'oem_receipt_issue: ยังไม่ได้กรอกชื่อนิติบุคคลของร้าน (ตั้งค่า > ข้อมูลร้าน) — เอกสารภาษีต้องมีชื่อผู้ขายก่อนออกใบ' using errcode = '22023';
  end if;
  if nullif(btrim(v_set.seller_tax_id), '') is null then
    raise exception 'oem_receipt_issue: ยังไม่ได้กรอกเลขผู้เสียภาษีของร้าน (ตั้งค่า > ข้อมูลร้าน) — เอกสารภาษีต้องมีเลขผู้เสียภาษีของผู้ขายก่อนออกใบ' using errcode = '22023';
  end if;
  if v_set.seller_address_lines is null or jsonb_array_length(v_set.seller_address_lines) = 0 then
    raise exception 'oem_receipt_issue: ยังไม่ได้กรอกที่อยู่ของร้าน (ตั้งค่า > ข้อมูลร้าน) — เอกสารภาษีต้องมีที่อยู่ผู้ขายก่อนออกใบ' using errcode = '22023';
  end if;

  -- §9: gate ข้อมูลผู้ซื้อ — ต้องมี customer_id ผูกไว้แล้ว (ผ่าน
  -- oem_quote_set_billing) และมีชื่อนิติบุคคล/ผู้ซื้อเสมอ
  if v_quote.customer_id is null then
    raise exception 'oem_receipt_issue: ใบนี้ยังไม่ได้ผูกข้อมูลผู้ซื้อ (ชื่อออกบิล/ที่อยู่) — ตั้งค่าก่อนออกใบเสร็จ' using errcode = '22023';
  end if;
  select * into v_customer from analytics.oem_customer where id = v_quote.customer_id and shop_id = p_shop_id;
  if not found or nullif(btrim(v_customer.legal_name), '') is null then
    raise exception 'oem_receipt_issue: ข้อมูลผู้ซื้อของใบนี้ยังไม่มีชื่อนิติบุคคล/ชื่อผู้ซื้อ — ตั้งค่าก่อนออกใบเสร็จ' using errcode = '22023';
  end if;

  -- 0086 §1(ค): แก้คอมเมนต์ที่ผิดของ 0084:287 ("บุคคลธรรมดาไม่ต้องมี — UI เตือน
  -- เหลืองเอง") — ตรวจแล้วไม่มี UI เตือนจริง ด่านจริงอยู่ตรงนี้แทน: ผู้ซื้อมี
  -- tax_id (= นิติบุคคล = ใบกำกับภาษีเต็มรูปตาม ป.รัษฎากร ม.86/4 ต้องมีชื่อ+
  -- ที่อยู่+เลขผู้เสียภาษี+สาขาของทั้งสองฝ่ายครบ) ต้องมีที่อยู่และสาขาครบก่อน
  -- ออกใบได้ — ไม่มี tax_id (บุคคลธรรมดา) ผ่านได้เหมือนเดิม เอกสารที่ออกให้
  -- บุคคลธรรมดาจะไม่พาดหัวว่า "ใบกำกับภาษี" (ฝั่งจอ/frontend-dev ตัดสินใจตอน
  -- render จาก buyer_tax_id is null ของแถวนี้ — ไม่ใช่หน้าที่ของ migration นี้)
  if nullif(btrim(v_customer.tax_id), '') is not null then
    if v_customer.address is null
       or jsonb_typeof(v_customer.address) <> 'object'
       or nullif(btrim(v_customer.address->>'line1'), '') is null
       or nullif(btrim(v_customer.address->>'subdistrict'), '') is null
       or nullif(btrim(v_customer.address->>'district'), '') is null
       or nullif(btrim(v_customer.address->>'province'), '') is null
       or nullif(btrim(v_customer.address->>'postalCode'), '') is null
    then
      raise exception 'oem_receipt_issue: ผู้ซื้อมีเลขผู้เสียภาษี (นิติบุคคล) ต้องกรอกที่อยู่ให้ครบก่อนออกใบกำกับภาษีเต็มรูป (บรรทัด 1, ตำบล/แขวง, อำเภอ/เขต, จังหวัด, รหัสไปรษณีย์) — ไปที่ปุ่ม "ผูกข้อมูลผู้ซื้อ" ของใบเสนอราคานี้แล้วกรอกที่อยู่ให้ครบ' using errcode = '22023';
    end if;
    if nullif(btrim(v_customer.branch_label), '') is null then
      raise exception 'oem_receipt_issue: ผู้ซื้อมีเลขผู้เสียภาษี (นิติบุคคล) ต้องกรอกสาขา (สำนักงานใหญ่ หรือ สาขาที่ ...) ก่อนออกใบกำกับภาษีเต็มรูป — ไปที่ปุ่ม "ผูกข้อมูลผู้ซื้อ" ของใบเสนอราคานี้แล้วกรอกสาขาให้ครบ' using errcode = '22023';
    end if;
  end if;

  -- §6: paid ระดับ deal — sum ทุกใบเสร็จ issued ที่ quote_id อยู่ใน chain เดียวกัน
  -- ผ่าน root_quote_id (ต่อราคาสร้างแถว quote ใหม่ แต่มัดจำที่รับไว้เป็นของ deal
  -- ไม่ใช่ของแถว) ไม่ re-point FK ของ receipt ตอนต่อราคา — aggregation แทน mutation
  select coalesce(sum(r.amount_thb), 0) into v_paid_before
    from analytics.oem_receipt r
    join analytics.oem_quote rq on rq.id = r.quote_id
   where rq.root_quote_id = coalesce(v_quote.root_quote_id, v_quote.id)
     and r.status = 'issued';

  -- §6: กันจ่ายเกิน — ยังเป็นด่านตายตัว (ต่างจากคำสั่งเจ้าของข้อ 3 ที่ยกเลิกเฉพาะ
  -- gate ฝั่ง renegotiate) เทียบกับ grand_total ของใบ active (v_quote) ที่ล็อกไว้
  -- แล้วข้างบน กันสอง request อ่าน paid เก่าทั้งคู่
  if round(v_paid_before + p_amount_thb, 2) > round(v_quote.grand_total, 2) then
    raise exception 'oem_receipt_issue: ยอดรับเงินรวม % บาท (สะสมแล้ว % + ครั้งนี้ %) เกินยอดรวมใบเสนอราคาทั้งดีล (% บาท) — รับเงินเกินยอดไม่ได้',
      round(v_paid_before + p_amount_thb, 2), round(v_paid_before, 2), round(p_amount_thb, 2), round(v_quote.grand_total, 2)
      using errcode = '22023';
  end if;

  if p_received_date > v_bkk_today then
    raise exception 'oem_receipt_issue: วันที่รับเงิน (%) เป็นวันในอนาคตไม่ได้ (วันนี้ตามเวลาไทยคือ %)', p_received_date, v_bkk_today
      using errcode = '22023';
  end if;

  -- 0086 §3 (revised — coordinator ตีกลับ v1): เดิมด่านนี้ปฏิเสธ received_date
  -- ก่อนต้นเดือนนี้เสมอไม่มีข้อยกเว้น ซึ่งบล็อก "reissue ข้ามเดือน" ที่ถูกต้องตาม
  -- บัญชีไปด้วย — เคสจริง: ออกใบ 15 ส.ค. (received_date = 15 ส.ค. ถูกต้องตอนนั้น)
  -- เจอข้อผิดพลาด void วันที่ 5 ก.ย. แล้ว reissue ใบใหม่ ใบใหม่ "ต้อง" ใช้
  -- received_date = 15 ส.ค. เพราะนั่นคือ tax point จริง (วันรับเงินจริง) ไม่ใช่
  -- วันที่ void/reissue — ด่านเดิมจะบังคับให้กรอกวันที่ผิด (5 ก.ย.) ซึ่งแย่กว่า
  -- ปัญหาที่ด่านนี้ตั้งใจกัน
  --
  -- แก้: เปิดข้อยกเว้นเฉพาะ reissue ที่ received_date ตรงกับใบเดิมเป๊ะเท่านั้น —
  -- ไม่ใช่ "เป็น reissue ก็ผ่านด่านงวดภาษีไปเลย" (ถ้าปล่อยกรอกวันไหนก็ได้ตอน
  -- reissue จะกลายเป็นทางลัดย้อนงวดภาษี แค่ void ใบไหนก็ได้แล้วอ้างว่า reissue
  -- ด้วยวันที่ใดก็ได้) v_reissued_from_received_date ถูกดึงมาจากใบเดิมที่ยืนยัน
  -- แล้วว่าเป็นของ shop นี้จริงและ void แล้วเท่านั้น (ดักด้านบน) — ใบ non-reissue
  -- ยังใช้ด่านงวดภาษีเดิมทุกประการ ไม่ผ่อน
  if p_reissued_from is not null then
    if p_received_date is distinct from v_reissued_from_received_date then
      raise exception 'oem_receipt_issue: reissue ต้องใช้วันที่รับเงินเดียวกับใบเดิมที่ถูกยกเลิกเท่านั้น (ใบเดิม % รับเงินวันที่ %) — วันที่รับเงินคือ tax point จริง เปลี่ยนวันที่ตอน reissue ไม่ได้', p_reissued_from, v_reissued_from_received_date
        using errcode = '22023';
    end if;
    -- received_date ตรงกับใบเดิมแล้ว = ไม่ใช่การย้อนงวดภาษีใหม่ ข้ามด่านงวดภาษีปกติ
  elsif p_received_date < v_bkk_month_start then
    raise exception 'oem_receipt_issue: วันที่รับเงิน (%) อยู่คนละงวดภาษีกับวันนี้ (เอกสารนี้จะออกในงวดเดือน %) — ออกย้อนหลังข้ามเดือนไม่ได้ ถ้าจำเป็นต้องบันทึกรับเงินของเดือนก่อน ให้ปรึกษาฝ่ายบัญชีก่อนดำเนินการ',
      p_received_date, to_char(v_bkk_today, 'YYYY-MM')
      using errcode = '22023';
  end if;

  -- ---- ผ่านทุกด่านแล้ว — คำนวณ + snapshot ----
  v_vat_base := round(p_amount_thb / (1 + v_quote.vat_rate), 2);
  v_vat_amount := p_amount_thb - v_vat_base;

  v_description := left(nullif(btrim(p_description), ''), 500);
  if v_description is null then
    v_description := case p_kind
      when 'deposit' then 'เงินมัดจำงาน OEM ตามใบเสนอราคา ' || v_quote.quote_no
      when 'partial' then 'ชำระเงินบางส่วนงาน OEM ตามใบเสนอราคา ' || v_quote.quote_no
      when 'final' then 'ชำระเงินงวดสุดท้ายงาน OEM ตามใบเสนอราคา ' || v_quote.quote_no
    end;
  end if;
  v_payment_ref := left(nullif(btrim(p_payment_ref), ''), 128);

  v_seller_snapshot := jsonb_build_object(
    'legal_name', v_set.seller_legal_name,
    'display_name', v_set.seller_display_name,
    'branch_label', v_set.seller_branch_label,
    'address_lines', v_set.seller_address_lines,
    'tax_id', v_set.seller_tax_id,
    'phone', v_set.seller_phone
  );

  -- §3: ออกเลขที่เอกสาร — counter row lock ภายใน transaction เดียวกับ insert
  -- receipt ข้างล่าง (ถ้า insert fail ทั้งก้อน rollback ตัวนับถอยกลับด้วย = ไม่มี
  -- เลขข้าม) ไม่มี retry loop เพราะ concurrent request ที่สองแค่ "รอ" row lock
  -- แล้วได้เลขถัดไป ไม่ชนกันเลย
  v_doc_key := 'RT-' || to_char(v_bkk_today, 'YYMM');
  insert into analytics.oem_doc_counter as c (shop_id, doc_key, last_no)
  values (p_shop_id, v_doc_key, 1)
  on conflict (shop_id, doc_key) do update set last_no = c.last_no + 1
  returning last_no into v_no;
  v_receipt_no := v_doc_key || '-' || lpad(v_no::text, 3, '0');

  v_receipt_id := gen_random_uuid();
  insert into analytics.oem_receipt (
    id, shop_id, quote_id, receipt_no, kind, status,
    amount_thb, vat_rate, vat_base_thb, vat_amount_thb,
    received_date, issue_date, payment_method, payment_ref, description,
    seller_snapshot, buyer_legal_name, buyer_tax_id, buyer_branch_label, buyer_address,
    quote_no_snapshot, grand_total_snapshot, paid_before_thb, balance_after_thb,
    reissued_from_receipt_id, created_by
  ) values (
    v_receipt_id, p_shop_id, p_quote_id, v_receipt_no, p_kind, 'issued',
    p_amount_thb, v_quote.vat_rate, v_vat_base, v_vat_amount,
    p_received_date, v_bkk_today, p_payment_method, v_payment_ref, v_description,
    -- 0086: buyer_branch_label เขียนค่าจริงจาก oem_customer.branch_label แล้ว
    -- (เดิม 0084 hardcode null ตายตัวเพราะยังไม่มีคอลัมน์ต้นทาง — ตอนนี้มีแล้ว
    -- และผ่านด่านครบ/ไม่ครบด้านบนมาแล้วแล้วแต่กรณี)
    v_seller_snapshot, v_customer.legal_name, v_customer.tax_id, v_customer.branch_label, v_customer.address,
    v_quote.quote_no, v_quote.grand_total, v_paid_before, (v_quote.grand_total - (v_paid_before + p_amount_thb)),
    p_reissued_from, auth.uid()
  );

  -- คำสั่งเจ้าของข้อ 2: รับมัดจำ = รับงาน — ใบยังไม่ won ก็พลิกเป็น won ทันที
  -- (transition quoted/expired -> won ที่ 0076 รับรองไว้แล้วว่า legal)
  if v_quote.status <> 'won' then
    update analytics.oem_quote
       set status = 'won', updated_by = auth.uid(), updated_at = now()
     where id = p_quote_id and shop_id = p_shop_id;
  end if;

  return v_receipt_id;
end;
$$;

revoke execute on function analytics.oem_receipt_issue(uuid, uuid, numeric, date, text, text, text, text, uuid) from public, anon;
grant execute on function analytics.oem_receipt_issue(uuid, uuid, numeric, date, text, text, text, text, uuid) to authenticated, service_role;

comment on column analytics.oem_receipt.buyer_branch_label is
  '0086: สาขาผู้ซื้อ ณ วันออกใบ (snapshot จาก oem_customer.branch_label ที่เพิ่มใน 0086) — ก่อนหน้านี้ (0084) เขียน null เสมอเพราะยังไม่มีคอลัมน์ต้นทาง ตอนนี้ oem_receipt_issue บังคับให้ต้องมีค่าก่อนออกใบเมื่อผู้ซื้อมี tax_id (นิติบุคคล) — บุคคลธรรมดายังเว้นว่างได้';

-- ============================================================================
-- 4. analytics.oem_receipt — trigger กันแก้/ลบตรง (service_role มี BYPASSRLS +
--    0018:23 grant all on tables ให้ service_role อัตโนมัติ — RLS ของตาราง
--    (มีแค่ select policy) กันได้แค่ authenticated ธรรมดา ไม่กัน service_role
--    ซึ่งเป็น role ที่แอปทั้งหมดวิ่งด้วยจริง — ต้องกันที่ trigger เท่านั้น เพราะ
--    trigger ทำงานเสมอไม่ว่า role จะ BYPASSRLS หรือไม่)
--
--    DELETE: ปฏิเสธเสมอ ไม่มีข้อยกเว้น (เอกสารภาษีห้ามหายจากระบบ)
--    UPDATE: อนุญาตเฉพาะ status issued -> void และแตะได้แค่ 4 คอลัมน์ (status,
--    void_reason, voided_at, voided_by) — ตรวจด้วย jsonb diff "ลบ 4 คอลัมน์ที่
--    อนุญาตออกก่อนเทียบทั้งแถว" แทนการ list เทียบทีละคอลัมน์ เพื่อให้คอลัมน์ใหม่
--    ที่เพิ่มเข้า oem_receipt ในอนาคตถูกป้องกันโดยอัตโนมัติทันทีที่ ALTER TABLE
--    ไม่ต้องมีใครจำมาแก้ trigger นี้ซ้ำ
--
--    ยืนยันแล้ว: analytics.oem_receipt_void (0084 §4) มี SET clause เดียวคือ
--    "status = 'void', void_reason = ..., voided_at = now(), voided_by =
--    auth.uid()" — ไม่แตะคอลัมน์อื่นเลยสักตัว จึงผ่าน trigger นี้ได้เสมอ ไม่ต้อง
--    แก้ 0084/0085 ใดๆ
-- ============================================================================

create or replace function analytics.oem_receipt_deny_mutation()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'oem_receipt: ห้ามลบใบเสร็จ/ใบกำกับภาษี — เอกสารภาษีต้องคงเลขที่ไว้ตลอดไป ผิดแล้วให้ยกเลิกด้วย analytics.oem_receipt_void แล้วออกใหม่แทน' using errcode = '22023';
  end if;

  -- tg_op = 'UPDATE' จากนี้ไป
  if old.status is distinct from 'issued' or new.status is distinct from 'void' then
    raise exception 'oem_receipt: แก้ไขได้ทางเดียวคือเปลี่ยนสถานะ issued -> void เท่านั้น (เดิม % ใหม่ %) — เอกสารที่ออกแล้วห้ามแก้เนื้อหา ผิดแล้วต้องยกเลิกแล้วออกใหม่ (analytics.oem_receipt_void + analytics.oem_receipt_issue พร้อม p_reissued_from)',
      old.status, new.status using errcode = '22023';
  end if;

  if (to_jsonb(new) - array['status', 'void_reason', 'voided_at', 'voided_by'])
     is distinct from
     (to_jsonb(old) - array['status', 'void_reason', 'voided_at', 'voided_by'])
  then
    raise exception 'oem_receipt: แก้ได้เฉพาะคอลัมน์ status/void_reason/voided_at/voided_by ตอนยกเลิกเท่านั้น — คอลัมน์อื่นของเอกสารที่ออกแล้วห้ามแก้แม้ค่าเดียว' using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke execute on function analytics.oem_receipt_deny_mutation() from public, anon, authenticated;

comment on function analytics.oem_receipt_deny_mutation() is
  '0086: trigger function กัน UPDATE/DELETE ตรงบน analytics.oem_receipt — จำเป็นเพราะ service_role (role ที่แอปทั้งหมดวิ่งด้วย) มี BYPASSRLS จึงข้าม RLS policy ของตารางได้เสมอ ต้องกันที่ trigger เท่านั้น ดู 0086 หัวไฟล์ §2';

drop trigger if exists trg_oem_receipt_deny_mutation on analytics.oem_receipt;
create trigger trg_oem_receipt_deny_mutation
  before update or delete on analytics.oem_receipt
  for each row execute function analytics.oem_receipt_deny_mutation();

notify pgrst, 'reload schema';
