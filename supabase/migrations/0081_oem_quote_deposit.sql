-- 0081_oem_quote_deposit.sql
-- มัดจำในใบเสนอราคา OEM — เจ้าของพูดตรงๆ ว่า "มัดจำปกติ 50% เดียว ตรงนี้เว้น
-- ให้กรอกเป็น % หรือเป็นยอดแล้วให้คำนวณกลับ ได้ไหม" แปลว่าใบเสนอราคาต้องมี
-- บรรทัดมัดจำ กรอกได้ 2 ทาง (เปอร์เซ็นต์ / จำนวนเงินบาท) แล้วให้ระบบคำนวณอีก
-- ฝั่งให้เอง
--
-- ============ หลักการเดียวที่คุมทั้งไฟล์ ============
-- เก็บ "สิ่งที่ผู้ใช้กรอก" (deposit_mode + deposit_input) ไม่เก็บผลลัพธ์ที่
-- คำนวณแล้ว (deposit_amount_thb/balance_thb) — เพราะ grand_total เปลี่ยนได้
-- ตอนต่อราคา (oem_quote_renegotiate) หรือแก้ draft (oem_quote_save) ถ้าเก็บ
-- ผลลัพธ์ไว้มันจะค้างเป็นเลขเก่าโดยไม่มีใครรู้ — ให้ v_oem_quote เป็นคนคำนวณ
-- อีกฝั่งให้สดเสมอจาก grand_total ปัจจุบัน
--
-- ============ ขอบเขต ============
-- 1) oem_setting.deposit_default_pct — ค่าตั้งต้นระดับร้าน (0.50) ผ่าน
--    oem_setting_upsert (ขยาย arg list = ต้อง drop signature เดิมก่อน) +
--    เปิดออกทาง v_oem_seller
-- 2) oem_quote.deposit_mode/deposit_input — เงื่อนไขมัดจำระดับใบ
-- 3) v_oem_quote — append deposit_mode/deposit_input (ดิบ) +
--    deposit_amount_thb/deposit_pct_effective/balance_thb (คำนวณสด)
-- 4) oem_quote_set_deposit — RPC ตั้ง/ล้างมัดจำรายใบ แก้ได้เฉพาะ draft/quoted
--    (ใบที่ปิดงาน/แพ้/ถูกแทนที่/หมดอายุแล้ว แก้ตัวเลขเงินย้อนหลังไม่ได้)
-- 5) oem_quote_save — ออกใบใหม่ (p_quote_id is null) ตั้ง deposit_mode='pct'
--    + deposit_input=deposit_default_pct อัตโนมัติ ไม่ทับของเดิมตอนแก้ใบเก่า
-- 6) oem_quote_renegotiate — ใบใหม่สืบทอดเงื่อนไขมัดจำจากใบแม่ + clamp โหมด
--    thb ที่เกิน grand_total ใหม่ลงมา (ดู §6 ท้ายไฟล์ สำหรับผลข้างเคียงที่
--    ตั้งใจปล่อยให้เห็น)
--
-- อ่านคู่กับ 0079 (oem_setting_upsert เดิม 22 params, oem_quote_save/
-- renegotiate ฐาน), 0080 (semantics 3 สถานะของ text — deposit_default_pct
-- "ไม่ใช้" semantics นั้น เป็นตัวเลขคุมเงินแบบ coalesce เหมือน bar_margin_pct),
-- 0078 (v_oem_quote ฉบับล่าสุดก่อนไฟล์นี้ — select list คัดลอกมาแบบคำต่อคำ)
-- ============================================================================

-- ============================================================================
-- 1. oem_setting.deposit_default_pct — ค่ามัดจำเริ่มต้นระดับร้าน
-- ============================================================================

alter table analytics.oem_setting
  add column if not exists deposit_default_pct numeric(5, 4) not null default 0.50;

alter table analytics.oem_setting drop constraint if exists oem_setting_deposit_default_pct_check;
alter table analytics.oem_setting add constraint oem_setting_deposit_default_pct_check
  check (deposit_default_pct > 0 and deposit_default_pct <= 1);

comment on column analytics.oem_setting.deposit_default_pct is
  '0081: มัดจำเริ่มต้นของร้าน (สัดส่วน 0-1, default 0.50 = 50%) — oem_quote_save ใช้ตั้งค่านี้อัตโนมัติให้ deposit_mode/deposit_input ตอนออกใบเสนอราคาใหม่เท่านั้น (ไม่ทับใบเก่าที่ผู้ใช้ตั้งเองแล้ว) ผู้ใช้แก้รายใบทีหลังได้ผ่าน oem_quote_set_deposit — ตัวเลขคุมเงิน ใช้ coalesce แบบเดียวกับ bar_margin_pct ไม่ใช่ semantics ล้างค่าแบบ text (0080)';

-- ============================================================================
-- 2. oem_setting_upsert — ขยายรับ p_deposit_default_pct (พารามิเตอร์ที่ 23,
--    ต่อท้ายสุด) coalesce กับค่าเดิมเหมือน bar_margin_pct/margin_target_pct
--    ทุกตัว ไม่ใช่ semantics ล้างค่าแบบ text ของ seller_* (0080) — เป็นตัวเลข
--    คุมเงิน ห้ามเป็น null ถาวร
--
--    ⚠️ กับดัก overload: เปลี่ยน arg list = สร้างฟังก์ชันใหม่ ไม่ใช่แทนที่ —
--    ต้อง drop signature เดิม 22 พารามิเตอร์ก่อน (uuid, numeric x6, int x3,
--    numeric, text x3, jsonb, text, boolean, text x4, jsonb — ตรงกับที่ 0079/
--    0080 ใช้อยู่) แล้ว re-grant execute ใหม่หลัง create (grant ไม่ติดมาเอง
--    ข้าม signature — ทีมนี้เจอกับดักนี้มาแล้ว 3 รอบ)
-- ============================================================================

drop function if exists analytics.oem_setting_upsert(uuid, numeric, numeric, numeric, numeric, numeric, numeric, int, int, int, numeric, text, text, text, jsonb, text, boolean, text, text, text, text, jsonb);

create or replace function analytics.oem_setting_upsert(
  p_shop_id uuid,
  p_margin_target_pct numeric default null,
  p_margin_discount_cap_pct numeric default null,
  p_margin_floor_pct numeric default null,
  p_margin_hard_floor_pct numeric default null,
  p_nre_max_share_pct numeric default null,
  p_min_job_value_thb numeric default null,
  p_quote_valid_days_silver int default null,
  p_quote_valid_days_gold int default null,
  p_quote_valid_days_brass int default null,
  p_bar_margin_pct numeric default null,
  p_seller_legal_name text default null,
  p_seller_display_name text default null,
  p_seller_branch_label text default null,
  p_seller_address_lines jsonb default null,
  p_seller_tax_id text default null,
  p_seller_vat_registered boolean default null,
  p_seller_phone text default null,
  p_seller_line text default null,
  p_seller_email text default null,
  p_seller_website text default null,
  p_seller_terms jsonb default null,
  p_deposit_default_pct numeric default null
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_seller_address_lines jsonb;
  v_seller_terms jsonb;
begin
  if p_shop_id is null then
    raise exception 'oem_setting_upsert: p_shop_id is required';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  -- 0080: validate ต้องไม่ไป reject ค่าว่างที่ตั้งใจส่งมาเพื่อ "ล้าง" — ตรวจ
  -- เฉพาะเมื่อ trim แล้วไม่ว่าง (btrim(...) <> '') ค่อยเช็ครูปแบบ 13 หลัก
  -- ค่าว่าง/whitespace ล้วนปล่อยผ่านไปเป็นสถานะ "ล้างเป็น null" ในขั้น upsert —
  -- ฝั่งตาราง constraint (0079: is null or ~ '^[0-9]{13}$') รองรับ null อยู่แล้ว
  if p_seller_tax_id is not null and btrim(p_seller_tax_id) <> ''
     and btrim(p_seller_tax_id) !~ '^[0-9]{13}$' then
    raise exception 'oem_setting_upsert: p_seller_tax_id ต้องเป็นตัวเลข 13 หลัก' using errcode = '22023';
  end if;
  if p_seller_address_lines is not null and jsonb_typeof(p_seller_address_lines) <> 'array' then
    raise exception 'oem_setting_upsert: p_seller_address_lines ต้องเป็น json array' using errcode = '22023';
  end if;
  if p_seller_terms is not null and jsonb_typeof(p_seller_terms) <> 'array' then
    raise exception 'oem_setting_upsert: p_seller_terms ต้องเป็น json array' using errcode = '22023';
  end if;

  -- 0080: normalize array ที่มีแต่ string ว่าง/ช่องว่างล้วนให้เป็น '[]' —
  -- element ที่ไม่ใช่ string (เช่น ส่งเลข/object ผิดรูปแบบมาปนโดยไม่ตั้งใจ) ถือ
  -- เป็น "ไม่ว่าง" เพื่อความปลอดภัย (คง array เดิมไว้ ไม่เดาทิ้ง) — exists()
  -- คืน false เมื่อ array ว่างเปล่าอยู่แล้ว ([]) ก็ normalize เป็น [] เหมือนเดิม
  -- (no-op) เช่นกัน
  if p_seller_address_lines is not null then
    if exists (
      select 1 from jsonb_array_elements(p_seller_address_lines) as elem
      where jsonb_typeof(elem) <> 'string' or btrim(elem #>> '{}') <> ''
    ) then
      v_seller_address_lines := p_seller_address_lines;
    else
      v_seller_address_lines := '[]'::jsonb;
    end if;
  else
    v_seller_address_lines := null;
  end if;

  if p_seller_terms is not null then
    if exists (
      select 1 from jsonb_array_elements(p_seller_terms) as elem
      where jsonb_typeof(elem) <> 'string' or btrim(elem #>> '{}') <> ''
    ) then
      v_seller_terms := p_seller_terms;
    else
      v_seller_terms := '[]'::jsonb;
    end if;
  else
    v_seller_terms := null;
  end if;

  insert into analytics.oem_setting as os (
    shop_id, margin_target_pct, margin_discount_cap_pct, margin_floor_pct, margin_hard_floor_pct,
    nre_max_share_pct, min_job_value_thb, quote_valid_days_silver, quote_valid_days_gold, quote_valid_days_brass,
    bar_margin_pct,
    seller_legal_name, seller_display_name, seller_branch_label, seller_address_lines, seller_tax_id, seller_vat_registered,
    seller_phone, seller_line, seller_email, seller_website, seller_terms,
    deposit_default_pct,
    updated_by, updated_at
  ) values (
    p_shop_id,
    coalesce(p_margin_target_pct, 0.30), coalesce(p_margin_discount_cap_pct, 0.25),
    coalesce(p_margin_floor_pct, 0.20), coalesce(p_margin_hard_floor_pct, 0.15),
    coalesce(p_nre_max_share_pct, 0.25), coalesce(p_min_job_value_thb, 8000),
    coalesce(p_quote_valid_days_silver, 30), coalesce(p_quote_valid_days_gold, 7), coalesce(p_quote_valid_days_brass, 45),
    coalesce(p_bar_margin_pct, 0.19),
    -- 0080: nullif(btrim(...), '') บนแถวใหม่ (ยังไม่มี os.x ให้ coalesce) —
    -- ถ้าส่ง '' มาตอนสร้างแถวแรกก็เก็บเป็น null (ไม่มีอะไรให้ "ล้าง" อยู่แล้ว)
    -- ไม่เก็บ '' ดิบๆ ลง DB
    nullif(btrim(p_seller_legal_name), ''), nullif(btrim(p_seller_display_name), ''),
    nullif(btrim(p_seller_branch_label), ''), v_seller_address_lines,
    nullif(btrim(p_seller_tax_id), ''),
    coalesce(p_seller_vat_registered, false),
    nullif(btrim(p_seller_phone), ''), nullif(btrim(p_seller_line), ''),
    nullif(btrim(p_seller_email), ''), nullif(btrim(p_seller_website), ''),
    v_seller_terms,
    -- 0081: ตัวเลขคุมเงิน — coalesce กับ default ตอนสร้างแถวใหม่ เหมือน
    -- bar_margin_pct ทุกประการ ไม่มี semantics ล้างค่า
    coalesce(p_deposit_default_pct, 0.50),
    auth.uid(), now()
  )
  on conflict (shop_id) do update set
    margin_target_pct       = coalesce(p_margin_target_pct, os.margin_target_pct),
    margin_discount_cap_pct = coalesce(p_margin_discount_cap_pct, os.margin_discount_cap_pct),
    margin_floor_pct        = coalesce(p_margin_floor_pct, os.margin_floor_pct),
    margin_hard_floor_pct   = coalesce(p_margin_hard_floor_pct, os.margin_hard_floor_pct),
    nre_max_share_pct       = coalesce(p_nre_max_share_pct, os.nre_max_share_pct),
    min_job_value_thb       = coalesce(p_min_job_value_thb, os.min_job_value_thb),
    quote_valid_days_silver = coalesce(p_quote_valid_days_silver, os.quote_valid_days_silver),
    quote_valid_days_gold   = coalesce(p_quote_valid_days_gold, os.quote_valid_days_gold),
    quote_valid_days_brass  = coalesce(p_quote_valid_days_brass, os.quote_valid_days_brass),
    bar_margin_pct           = coalesce(p_bar_margin_pct, os.bar_margin_pct),
    -- 0080: 3 สถานะ — null=ไม่แก้(คง os.x) / ''=ล้างเป็น null / อย่างอื่น=เขียนทับ(trim)
    seller_legal_name        = case when p_seller_legal_name is null then os.seller_legal_name
                                     when btrim(p_seller_legal_name) = '' then null
                                     else btrim(p_seller_legal_name) end,
    seller_display_name      = case when p_seller_display_name is null then os.seller_display_name
                                     when btrim(p_seller_display_name) = '' then null
                                     else btrim(p_seller_display_name) end,
    seller_branch_label      = case when p_seller_branch_label is null then os.seller_branch_label
                                     when btrim(p_seller_branch_label) = '' then null
                                     else btrim(p_seller_branch_label) end,
    -- jsonb array: coalesce เดิม (ล้างได้อยู่แล้วด้วย '[]') + normalize
    -- all-blank ผ่าน v_seller_address_lines/v_seller_terms ที่คำนวณไว้ข้างบน
    seller_address_lines     = coalesce(v_seller_address_lines, os.seller_address_lines),
    seller_tax_id             = case when p_seller_tax_id is null then os.seller_tax_id
                                      when btrim(p_seller_tax_id) = '' then null
                                      else btrim(p_seller_tax_id) end,
    seller_vat_registered    = coalesce(p_seller_vat_registered, os.seller_vat_registered),
    seller_phone              = case when p_seller_phone is null then os.seller_phone
                                      when btrim(p_seller_phone) = '' then null
                                      else btrim(p_seller_phone) end,
    seller_line               = case when p_seller_line is null then os.seller_line
                                      when btrim(p_seller_line) = '' then null
                                      else btrim(p_seller_line) end,
    seller_email               = case when p_seller_email is null then os.seller_email
                                       when btrim(p_seller_email) = '' then null
                                       else btrim(p_seller_email) end,
    seller_website             = case when p_seller_website is null then os.seller_website
                                       when btrim(p_seller_website) = '' then null
                                       else btrim(p_seller_website) end,
    seller_terms              = coalesce(v_seller_terms, os.seller_terms),
    -- 0081: ตัวเลขคุมเงิน — coalesce กับค่าเดิมเหมือน bar_margin_pct ไม่ใช่
    -- semantics ล้างค่าแบบ text ของ seller_* ข้างบน
    deposit_default_pct      = coalesce(p_deposit_default_pct, os.deposit_default_pct),
    updated_by = auth.uid(), updated_at = now();
end;
$$;

revoke execute on function analytics.oem_setting_upsert(uuid, numeric, numeric, numeric, numeric, numeric, numeric, int, int, int, numeric, text, text, text, jsonb, text, boolean, text, text, text, text, jsonb, numeric) from public, anon, authenticated;
grant execute on function analytics.oem_setting_upsert(uuid, numeric, numeric, numeric, numeric, numeric, numeric, int, int, int, numeric, text, text, text, jsonb, text, boolean, text, text, text, text, jsonb, numeric) to authenticated, service_role;

-- ============================================================================
-- 3. v_oem_seller — append deposit_default_pct ต่อท้าย (view สั้น ยังไม่เคย
--    ถูกขยายมาก่อนไฟล์นี้ แต่ยึดหลัก append-only เดียวกับ v_oem_quote กันเผื่อ
--    อนาคต) ระดับร้าน (1 แถวต่อ shop_id) เหตุผลเดียวกับ seller_* ทั้งชุด (0079
--    §7): หน้าพิมพ์ใบเสนอราคาอ่านค่านี้ตอน render ครั้งเดียว ไม่ใช่ต่อแถวใบ
-- ============================================================================

create or replace view analytics.v_oem_seller
  with (security_invoker = true) as
select
  shop_id,
  seller_legal_name,
  seller_display_name,
  seller_branch_label,
  seller_address_lines,
  seller_tax_id,
  seller_vat_registered,
  seller_phone,
  seller_line,
  seller_email,
  seller_website,
  seller_terms,
  -- ---- appended 0081+ only; do not insert new columns above this line ----
  deposit_default_pct
from analytics.oem_setting;

comment on view analytics.v_oem_seller is
  'ข้อมูลร้าน (ผู้ออกใบเสนอราคา) 1 แถวต่อ shop_id — แทนที่ lib/oem/sellerProfile.ts ฝั่งแอปอ่านค่านี้ตอน render หน้าพิมพ์ใบเสนอราคา (0079) + มัดจำเริ่มต้นของร้าน (0081)';

grant select on analytics.v_oem_seller to authenticated, service_role;

-- ============================================================================
-- 4. oem_quote.deposit_mode/deposit_input — เงื่อนไขมัดจำระดับใบเสนอราคา
--    เก็บ "สิ่งที่ผู้ใช้กรอก" เท่านั้น (ดูหลักการที่หัวไฟล์) — deposit_input
--    โหมด pct เก็บเป็นสัดส่วน 0-1 ไม่ใช่ 0-100
-- ============================================================================

alter table analytics.oem_quote
  add column if not exists deposit_mode text,
  add column if not exists deposit_input numeric;

alter table analytics.oem_quote drop constraint if exists oem_quote_deposit_check;
alter table analytics.oem_quote add constraint oem_quote_deposit_check
  check (
    deposit_mode is null
    or (
      deposit_mode in ('pct', 'thb')
      and deposit_input is not null
      and deposit_input > 0
      and (deposit_mode <> 'pct' or deposit_input <= 1)
    )
  );

comment on column analytics.oem_quote.deposit_mode is
  '0081: โหมดกรอกมัดจำของใบนี้ — ''pct'' (สัดส่วน 0-1 ของ grand_total) / ''thb'' (จำนวนเงินบาทตรงๆ) / null (ไม่ระบุมัดจำในใบนี้) เก็บ "สิ่งที่ผู้ใช้กรอก" เท่านั้น ไม่เก็บผลลัพธ์ที่คำนวณแล้ว (deposit_amount_thb/balance_thb คำนวณสดที่ v_oem_quote จาก grand_total ปัจจุบันเสมอ เพราะยอดสุทธิเปลี่ยนได้ตอนต่อราคา) แก้ผ่าน analytics.oem_quote_set_deposit เท่านั้น (แก้ได้เฉพาะสถานะ draft/quoted)';
comment on column analytics.oem_quote.deposit_input is
  '0081: ค่าที่ผู้ใช้กรอกตาม deposit_mode — โหมด pct เก็บเป็นสัดส่วน 0-1 (0.5 = 50%, ไม่ใช่ 0-100) ต้อง <= 1 · โหมด thb เก็บเป็นจำนวนเงินบาทตรงๆ ต้อง > 0 — oem_quote_set_deposit gate ไม่ให้เกิน grand_total ตอนตั้งค่า แต่ไม่มีการ re-validate ย้อนหลังถ้า grand_total เปลี่ยนทีหลังจากแก้ items ผ่าน oem_quote_save บนใบ draft เดิม (deposit_mode/deposit_input ไม่ถูกแตะตอนแก้ draft โดยตั้งใจ — ดู oem_quote_save) ดู v_oem_quote.balance_thb ถ้าติดลบคือเคสนี้';

-- ============================================================================
-- 5. v_oem_quote — append-only (42P16): copy select list คำต่อคำจากฉบับ 0078
--    (52 คอลัมน์ ลำดับเดิมเป๊ะ) แล้วต่อท้ายด้วย deposit_mode/deposit_input
--    (ดิบ) + deposit_amount_thb/deposit_pct_effective/balance_thb (คำนวณสด)
--
--    deposit_amount_thb คำนวณครั้งเดียวใน lateral join แล้วใช้ซ้ำกับ
--    balance_thb — กันพลาดจากการก็อป CASE เดียวกัน 2 ที่แล้วแก้ไม่ครบทั้งคู่
--    ในอนาคต
--
--    2 เคสที่ตั้งใจจัดการ (ดูรายละเอียดที่คอลัมน์แต่ละตัว):
--      - grand_total เป็น 0/null → ใช้ nullif กัน div-by-zero (deposit_pct_effective
--        โหมด thb) และปล่อยให้ deposit_amount_thb/balance_thb เป็น null ไปเอง
--        ตามธรรมชาติของเลขคณิตกับ null (ไม่ error)
--      - โหมด thb ที่ยอดมัดจำมากกว่า grand_total (ต่อราคาแล้วยอดลดลงต่ำกว่า
--        มัดจำเดิม) → balance_thb ติดลบตามจริง ตั้งใจไม่ปัดเป็น 0 (ซ่อนปัญหา
--        แย่กว่าแสดงมัน) ฝั่งแอปต้องเช็ค < 0 แล้วเตือนเอง
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
  -- ---- appended 0081+ only; do not insert new columns above this line ----
  q.deposit_mode,
  q.deposit_input,
  dep.deposit_amount_thb,
  -- โหมด pct: deposit_input เป็นสัดส่วนอยู่แล้ว ส่งกลับตรงๆ · โหมด thb: หาร
  -- ด้วย grand_total เพื่อรายงานเป็นสัดส่วนเทียบเท่า (nullif กัน div-by-zero) ·
  -- null: ไม่ระบุมัดจำ
  case q.deposit_mode
    when 'pct' then q.deposit_input
    when 'thb' then q.deposit_input / nullif(q.grand_total, 0)
    else null
  end as deposit_pct_effective,
  case when q.deposit_mode is not null then q.grand_total - dep.deposit_amount_thb else null end as balance_thb
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
) dep on true;

grant select on analytics.v_oem_quote to authenticated, service_role;

-- ============================================================================
-- 6. oem_quote_set_deposit — ตั้ง/ล้างมัดจำรายใบ security definer + pin
--    search_path + crm_require_owner_admin (เหมือนฟังก์ชันอื่นในกลุ่มนี้) +
--    for update กันสอง request ยิงพร้อมกันแล้วอ่านสถานะ/grand_total เก่าทั้งคู่
--    (แบบเดียวกับ oem_quote_set_status ที่ 0076 แก้)
--
--    แก้ได้เฉพาะสถานะ draft/quoted — ใบที่ปิดงาน/แพ้/ถูกแทนที่/หมดอายุแล้ว
--    (won/lost/rejected/expired/superseded) แก้ตัวเลขเงินย้อนหลังไม่ได้
--
--    ⚠️ ที่ตั้งใจ "ไม่" เช็คเพิ่ม (นอกเหนือคำสั่ง): ใบสถานะ quoted ที่
--    quote_valid_until ผ่านไปแล้วจริง (is_expired_th = true ที่ v_oem_quote)
--    แต่ status column ยังเป็น 'quoted' อยู่ (ระบบนี้ไม่มี auto-transition
--    เป็น 'expired' ต้องเรียก oem_quote_set_status เอง) — RPC นี้ยังแก้มัดจำ
--    ได้ต่างจาก oem_quote_renegotiate ที่เช็ค quote_valid_until ก่อนเสมอ
--    เป็นความไม่สม่ำเสมอที่พบระหว่างทำ ไม่ได้อยู่ในสเปกที่สั่ง จึงไม่เติมเอง
--    — ทีมควรตัดสินใจว่าจะปิดช่องนี้เพิ่มไหม (ดูสรุปส่งมอบ)
-- ============================================================================

create or replace function analytics.oem_quote_set_deposit(
  p_shop_id uuid,
  p_quote_id uuid,
  p_mode text,
  p_input numeric
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_status text;
  v_grand_total numeric;
begin
  if p_shop_id is null or p_quote_id is null then
    raise exception 'oem_quote_set_deposit: p_shop_id and p_quote_id are required';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  if p_mode is not null and p_mode not in ('pct', 'thb') then
    raise exception 'oem_quote_set_deposit: p_mode ต้องเป็น pct, thb หรือปล่อยว่างไว้เพื่อล้างมัดจำ' using errcode = '22023';
  end if;

  -- for update: กันสอง request ยิงพร้อมกันแล้วอ่านสถานะ/grand_total เก่าทั้งคู่
  select status, grand_total into v_status, v_grand_total
    from analytics.oem_quote
   where id = p_quote_id and shop_id = p_shop_id
   for update;
  if not found then
    raise exception 'oem_quote_set_deposit: quote % not found for this shop', p_quote_id;
  end if;

  if v_status not in ('draft', 'quoted') then
    raise exception 'oem_quote_set_deposit: แก้เงื่อนไขมัดจำได้เฉพาะใบสถานะ draft หรือ quoted เท่านั้น (ใบนี้สถานะ %) — ใบที่ปิดงาน/แพ้/ถูกแทนที่/หมดอายุแล้ว แก้ตัวเลขเงินย้อนหลังไม่ได้', v_status
      using errcode = '22023';
  end if;

  if p_mode is null then
    update analytics.oem_quote
       set deposit_mode = null, deposit_input = null, updated_by = auth.uid(), updated_at = now()
     where id = p_quote_id and shop_id = p_shop_id;
    return;
  end if;

  if p_input is null or p_input <= 0 then
    raise exception 'oem_quote_set_deposit: p_input ต้องมากกว่า 0' using errcode = '22023';
  end if;

  if p_mode = 'pct' and p_input > 1 then
    raise exception 'oem_quote_set_deposit: มัดจำแบบเปอร์เซ็นต์ต้องกรอกเป็นสัดส่วน 0-1 (เช่น 0.5 = 50%%) ไม่ใช่ 0-100 — กรอกมา %', p_input
      using errcode = '22023';
  end if;

  -- thb: ต้องไม่เกิน grand_total ของใบนี้ — grand_total null (ไม่ควรเกิดกับ
  -- ใบที่ผ่าน oem_quote_save มาแล้วอย่างน้อยหนึ่งครั้ง) coalesce เป็น 0 แทน
  -- การข้ามด่านไปเงียบๆ (คำนวณไม่ได้ = ตก ไม่ใช่ผ่าน — ตามแบบ 0079)
  if p_mode = 'thb' and p_input > coalesce(v_grand_total, 0) then
    raise exception 'oem_quote_set_deposit: ยอดมัดจำ % บาท เกินยอดรวมใบเสนอราคา (% บาท) — มัดจำเกินยอดทั้งใบไม่ได้', round(p_input, 2), round(coalesce(v_grand_total, 0), 2)
      using errcode = '22023';
  end if;

  update analytics.oem_quote
     set deposit_mode = p_mode, deposit_input = p_input, updated_by = auth.uid(), updated_at = now()
   where id = p_quote_id and shop_id = p_shop_id;
end;
$$;

revoke execute on function analytics.oem_quote_set_deposit(uuid, uuid, text, numeric) from public, anon;
grant execute on function analytics.oem_quote_set_deposit(uuid, uuid, text, numeric) to authenticated, service_role;

-- ============================================================================
-- 7. oem_quote_save — signature เดิม 9 ตัวเป๊ะ (plain replace, ไม่ต้อง drop)
--    แก้จุดเดียว: ตอนสร้างใบใหม่ (v_is_new = true) ตั้ง deposit_mode='pct' +
--    deposit_input=deposit_default_pct ของร้านอัตโนมัติ — เจ้าของบอกว่ามัดจำ
--    ปกติ 50% ไม่ควรต้องมากรอกซ้ำทุกใบ
--
--    ห้ามทับของเดิมตอนแก้ใบเก่า (v_is_new = false): ทำได้ฟรีอยู่แล้วเพราะ
--    branch แก้ใบเก่าไม่ผ่าน insert เลย (update ที่แถวไปถึง — ก้อน "final
--    update" ท้ายฟังก์ชัน — ไม่มี deposit_mode/deposit_input อยู่ใน SET clause
--    เลยสักตัว จึงไม่แตะคอลัมน์นี้ไม่ว่าจะสร้างใหม่หรือแก้เก่า)
--
--    ทุกอย่างอื่น (comment/logic 0079 เดิมทั้งหมด) คงเดิมเป๊ะ ไม่แตะ
-- ============================================================================

create or replace function analytics.oem_quote_save(p_shop_id uuid, p_items jsonb, p_quote_id uuid DEFAULT NULL::uuid, p_status text DEFAULT 'draft'::text, p_approval_note text DEFAULT NULL::text, p_customer_name text DEFAULT NULL::text, p_customer_contact text DEFAULT NULL::text, p_discount_thb numeric DEFAULT 0, p_discount_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $function$
declare
  v_set analytics.oem_setting%rowtype;
  v_quote_id uuid := p_quote_id;
  v_is_new boolean := (p_quote_id is null);
  v_current_status text;
  v_quote_no text;
  v_i int;
  v_item jsonb;
  v_seq int;
  v_item_input jsonb;
  v_item_calc jsonb;
  v_item_product_id uuid;
  v_item_sku text;
  v_item_name text;
  v_item_metal text;
  v_item_qty int;
  v_item_cost_piece numeric;
  v_item_price_piece numeric;
  v_item_total numeric;
  v_item_nre_cost numeric;
  v_item_nre_price numeric;
  v_item_q_run int;
  v_item_flask_count int;
  v_item_plate_count int;
  v_item_margin_charged numeric;
  v_item_metal_per_piece numeric;
  v_item_is_complete boolean;
  v_item_qty_pass boolean;
  v_item_metalweight_pass boolean;
  v_item_valid_days int;
  v_calc_agg jsonb := '[]'::jsonb;
  v_is_complete_all boolean := true;
  v_qty_pass_all boolean := true;
  v_metalweight_pass_all boolean := true;
  v_nre_cost_sum numeric := 0;
  v_nre_price_sum numeric := 0;
  v_pieces_subtotal_sum numeric := 0;
  v_flask_count_sum int := 0;
  v_plate_count_sum int := 0;
  v_qrun_sum int := 0;
  v_price_ex_gold_sum numeric := 0;
  v_cost_ex_gold_sum numeric := 0;
  v_price_total_all numeric := 0;
  v_cost_total_all numeric := 0;
  v_min_margin_charged numeric;
  v_min_margin_seq int;
  -- 0079-fix: "มี item ที่ระบบตรวจ margin รายชิ้นไม่ได้อยู่ในใบไหม" — ตัวแทนที่
  -- ถูกของ "ด่านรวมทั้งใบเป็นด่านเดียวที่เหลือสำหรับรายการนั้น" ไม่ใช่
  -- "v_min_margin_charged is null" (ซึ่งแปลว่า "ไม่มี item งานผลิตเลย" — เติม
  -- item งานผลิตชิ้นเล็ก margin สูงเข้าไปก็ปลดล็อกด่านทั้งใบได้ทันที) อิงจาก
  -- margin_charged is null ของแต่ละ item ไม่อิงจาก metal='silver999' ตรงๆ
  -- เพื่อคุ้มครองสินค้าประเภทอื่นที่ตรวจ margin รายชิ้นไม่ได้ในอนาคตอัตโนมัติ
  v_has_ungated_item boolean := false;
  v_valid_days int;
  v_quote_total_sum numeric;
  v_grand_total numeric;
  v_margin_after_discount numeric;
  v_margin_actual_blended numeric;
  v_jobvalue_min numeric;
  v_approved_by uuid;
  -- ---- silver999 (bar) ----
  v_bkk_today date;
  v_has_bar_item boolean := false;
  v_production_total_sum numeric := 0;
  -- ---- 0079: note-tier message (แยกตามสาเหตุจริง — LOW-6) ----
  v_note_tier_msg text;
begin
  if p_shop_id is null then
    raise exception 'oem_quote_save: p_shop_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'oem_quote_save: p_items must be a non-empty json array';
  end if;
  -- H3: เพดานจำนวนรายการ กัน request เดียวถือ lock ยาวจน connection pool ตัน
  if jsonb_array_length(p_items) > 50 then
    raise exception 'oem_quote_save: 1 ใบเสนอราคารับได้สูงสุด 50 รายการ (ส่งมา % รายการ)', jsonb_array_length(p_items)
      using errcode = '22023';
  end if;
  if p_status not in ('draft', 'quoted') then
    raise exception 'oem_quote_save: p_status must be draft or quoted';
  end if;
  if p_discount_thb is null or p_discount_thb < 0 then
    raise exception 'oem_quote_save: p_discount_thb must be >= 0';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  -- timezone ไทย เสมอ — DB เป็น UTC ก่อน 07:00 ไทยจะเหลื่อมวัน
  v_bkk_today := (now() at time zone 'Asia/Bangkok')::date;

  select * into v_set from analytics.oem_setting where shop_id = p_shop_id;
  if v_set.shop_id is null then
    v_set.margin_target_pct := 0.30; v_set.margin_discount_cap_pct := 0.25;
    v_set.margin_floor_pct := 0.20; v_set.margin_hard_floor_pct := 0.15;
    v_set.nre_max_share_pct := 0.25; v_set.min_job_value_thb := 8000;
    v_set.quote_valid_days_silver := 30; v_set.quote_valid_days_gold := 7; v_set.quote_valid_days_brass := 45;
    v_set.bar_margin_pct := 0.19;
    -- 0081: seed ให้ครบเหมือนค่าอื่นในบล็อกนี้ ไม่งั้นร้านที่ยังไม่เคยตั้งค่า
    -- อะไรเลย (แถว oem_setting ยังไม่ถูกสร้าง) จะได้ deposit_input เป็น null
    -- ทั้งที่ deposit_mode ถูกตั้งเป็น 'pct' ไปแล้วข้างล่าง — ชน check constraint
    v_set.deposit_default_pct := 0.50;
  end if;

  if not v_is_new then
    select status into v_current_status
      from analytics.oem_quote where id = v_quote_id and shop_id = p_shop_id for update;
    if not found then
      raise exception 'oem_quote_save: quote % not found for this shop', v_quote_id;
    end if;
    if v_current_status <> 'draft' then
      raise exception 'oem_quote_save: แก้ใบเสนอราคาได้เฉพาะสถานะ draft เท่านั้น (ใบนี้สถานะ %) — ใบที่ออกแล้วให้ใช้ oem_quote_renegotiate', v_current_status
        using errcode = '22023';
    end if;
    delete from analytics.oem_quote_item where quote_id = v_quote_id;
  else
    for v_i in 1..5 loop
      v_quote_no := analytics.oem_quote_next_no(p_shop_id);
      v_quote_id := gen_random_uuid();
      begin
        insert into analytics.oem_quote (
          id, shop_id, quote_no, root_quote_id, customer_name, customer_contact,
          rate_snapshot, status, deposit_mode, deposit_input, created_by, updated_by
        ) values (
          v_quote_id, p_shop_id, v_quote_no, v_quote_id, p_customer_name, p_customer_contact,
          -- 0081: ใบใหม่ตั้งมัดจำเริ่มต้นจาก oem_setting.deposit_default_pct
          -- อัตโนมัติ (ปกติ 50% ไม่ต้องกรอกซ้ำทุกใบ ตามที่เจ้าของสั่ง) — ทำ
          -- เฉพาะ branch สร้างแถวใหม่นี้เท่านั้น ไม่มีทางไปทับใบเก่าที่ผู้ใช้
          -- เคยตั้งเอง (ดู final update ท้ายฟังก์ชัน — ไม่มี deposit_mode/
          -- deposit_input อยู่ใน SET clause นั้นเลย ไม่ว่าจะสร้างใหม่หรือแก้เก่า)
          '[]'::jsonb, 'draft', 'pct', v_set.deposit_default_pct, auth.uid(), auth.uid()
        );
        exit;
      exception when unique_violation then
        if v_i = 5 then
          raise exception 'oem_quote_save: ออกเลขที่ใบเสนอราคาไม่สำเร็จ ลองใหม่อีกครั้ง';
        end if;
      end;
    end loop;
  end if;

  for v_item, v_seq in
    select elem, ord::int from jsonb_array_elements(p_items) with ordinality as t(elem, ord)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'oem_quote_save: p_items[%] must be a json object', v_seq;
    end if;
    v_item_input := v_item->'input';
    if v_item_input is null or jsonb_typeof(v_item_input) <> 'object' then
      raise exception 'oem_quote_save: p_items[%].input is required and must be a json object', v_seq;
    end if;

    v_item_product_id := nullif(v_item->>'product_id', '')::uuid;
    if v_item_product_id is not null and not exists (
      select 1 from public.product where id = v_item_product_id and shop_id = p_shop_id
    ) then
      raise exception 'oem_quote_save: p_items[%].product_id ไม่ใช่สินค้าของร้านนี้', v_seq;
    end if;
    -- H3: ตัดความยาวข้อความที่รับจาก client ก่อนเก็บ (เป็น snapshot ไม่ใช่ free text)
    v_item_sku := left(nullif(btrim(v_item->>'sku_snapshot'), ''), 64);
    v_item_name := left(nullif(btrim(v_item->>'product_name_snapshot'), ''), 200);

    v_item_calc := analytics.oem_price_calc(p_shop_id, v_item_input);
    v_calc_agg := v_calc_agg || jsonb_build_array(jsonb_build_object('seq', v_seq, 'calc', v_item_calc));

    v_item_metal := v_item_input->>'metal';
    if v_item_metal = 'silver999' then
      v_has_bar_item := true;
    end if;
    v_item_qty := nullif(v_item_input->>'qty', '')::int;
    if v_item_qty is null or v_item_qty <= 0 then
      raise exception 'oem_quote_save: p_items[%].input.qty must be > 0', v_seq;
    end if;

    v_item_cost_piece := nullif(v_item_calc->'breakdown'->>'cost_piece', '')::numeric;
    v_item_price_piece := nullif(v_item_calc->'breakdown'->>'price_per_piece', '')::numeric;
    v_item_nre_cost := nullif(v_item_calc->'breakdown'->'nre'->>'cost', '')::numeric;
    v_item_nre_price := nullif(v_item_calc->'breakdown'->'nre'->>'price', '')::numeric;
    v_item_metal_per_piece := nullif(v_item_calc->'breakdown'->'metal'->>'per_piece', '')::numeric;
    v_item_margin_charged := nullif(v_item_calc->'floors'->'margin'->>'value', '')::numeric;
    v_item_q_run := nullif(v_item_calc->'breakdown'->>'q_run', '')::int;
    v_item_is_complete := (v_item_calc->>'is_complete')::boolean;
    v_item_qty_pass := (v_item_calc->'floors'->'qty'->>'pass')::boolean;
    v_item_metalweight_pass := coalesce((v_item_calc->'floors'->'metal_weight'->>'pass')::boolean, true);

    select (l->>'count')::int into v_item_flask_count
      from jsonb_array_elements(coalesce(v_item_calc->'breakdown'->'batch'->'lines', '[]'::jsonb)) l
      where l->>'key' = 'flask';
    select (l->>'count')::int into v_item_plate_count
      from jsonb_array_elements(coalesce(v_item_calc->'breakdown'->'batch'->'lines', '[]'::jsonb)) l
      where l->>'key' = 'plating';

    v_item_total := case
      when v_item_calc->'breakdown'->>'quote_total' is not null
      then (v_item_calc->'breakdown'->>'quote_total')::numeric - coalesce(v_item_nre_price, 0)
    end;

    insert into analytics.oem_quote_item (
      shop_id, quote_id, seq, product_id, sku_snapshot, product_name_snapshot,
      input, calc, qty, cost_piece, price_per_piece, item_total,
      q_run, flask_count, plating_batch_count, margin_charged_pct
    ) values (
      p_shop_id, v_quote_id, v_seq, v_item_product_id, v_item_sku, v_item_name,
      v_item_input, v_item_calc, v_item_qty, v_item_cost_piece, v_item_price_piece, v_item_total,
      v_item_q_run, v_item_flask_count, v_item_plate_count, v_item_margin_charged
    );

    v_is_complete_all := v_is_complete_all and coalesce(v_item_is_complete, false);
    v_qty_pass_all := v_qty_pass_all and coalesce(v_item_qty_pass, false);
    v_metalweight_pass_all := v_metalweight_pass_all and v_item_metalweight_pass;
    v_nre_cost_sum := v_nre_cost_sum + coalesce(v_item_nre_cost, 0);
    v_nre_price_sum := v_nre_price_sum + coalesce(v_item_nre_price, 0);
    v_pieces_subtotal_sum := v_pieces_subtotal_sum + coalesce(v_item_total, 0);
    v_flask_count_sum := v_flask_count_sum + coalesce(v_item_flask_count, 0);
    v_plate_count_sum := v_plate_count_sum + coalesce(v_item_plate_count, 0);
    v_qrun_sum := v_qrun_sum + coalesce(v_item_q_run, 0);

    v_price_total_all := v_price_total_all + coalesce(v_item_price_piece, 0) * v_item_qty;
    v_cost_total_all := v_cost_total_all + coalesce(v_item_cost_piece, 0) * v_item_qty;

    -- ทองเป็น pass-through: ตัดเนื้อทองออกทั้งฝั่งราคาและฝั่งต้นทุน
    if v_item_metal = 'gold' then
      v_price_ex_gold_sum := v_price_ex_gold_sum + coalesce(v_item_total, 0)
                              - coalesce(v_item_metal_per_piece, 0) * v_item_qty;
      v_cost_ex_gold_sum := v_cost_ex_gold_sum + coalesce(v_item_cost_piece, 0) * v_item_qty
                             - coalesce(v_item_metal_per_piece, 0) * v_item_qty;
    else
      -- silver999 (เงินแท่ง) เข้า branch นี้ด้วย cost_piece จริงที่อนุมานมาแล้ว
      -- (ไม่ใช่ null) — margin รวมจึงไม่พองปลอม ไม่ต้องแก้อะไรเพิ่ม
      v_price_ex_gold_sum := v_price_ex_gold_sum + coalesce(v_item_total, 0);
      v_cost_ex_gold_sum := v_cost_ex_gold_sum + coalesce(v_item_cost_piece, 0) * v_item_qty;
    end if;

    -- ด่านมูลค่างานขั้นต่ำ (production-only): นับเฉพาะรายการที่ไม่ใช่เงินแท่ง
    if v_item_metal <> 'silver999' then
      v_production_total_sum := v_production_total_sum + coalesce(v_item_total, 0);
    end if;

    if v_item_margin_charged is not null
       and (v_min_margin_charged is null or v_item_margin_charged < v_min_margin_charged) then
      v_min_margin_charged := v_item_margin_charged;
      v_min_margin_seq := v_seq;
    end if;
    -- 0079-fix: item นี้ระบบตรวจ margin รายชิ้นไม่ได้ (floors.margin.value เป็น
    -- null — ปัจจุบันมีแค่ silver999 แต่เช็คจากค่า ไม่เช็คจาก metal ตรงๆ) ด่าน
    -- รวมทั้งใบคือด่านเดียวที่เหลือสำหรับ item นี้ ต้องทำงานเสมอไม่ว่าใบจะมี
    -- item งานผลิต margin สูงมาช่วยดันค่าเฉลี่ยหรือไม่ก็ตาม
    if v_item_margin_charged is null then
      v_has_ungated_item := true;
    end if;

    v_item_valid_days := case v_item_metal
      when 'gold' then coalesce(v_set.quote_valid_days_gold, 7)
      when 'brass' then coalesce(v_set.quote_valid_days_brass, 45)
      -- เงินแท่ง: ยืนราคาวันเดียว (ราคาเว็บเปลี่ยนได้ทุกวัน ไม่ใช่ตามรอบยืนราคางานผลิต)
      when 'silver999' then 0
      else coalesce(v_set.quote_valid_days_silver, 30)
    end;
    -- ยืนราคาตามโลหะที่ผันผวนสุดในใบ (ทอง/แท่งสั้นสุด) ไม่ใช่ตามรายการสุดท้าย
    v_valid_days := case when v_valid_days is null then v_item_valid_days else least(v_valid_days, v_item_valid_days) end;
  end loop;

  v_quote_total_sum := v_pieces_subtotal_sum + v_nre_price_sum;
  -- ด่านมูลค่างานขั้นต่ำ (production-only): รวม NRE เข้าไปด้วย (ก่อนหักส่วนลด)
  v_production_total_sum := v_production_total_sum + v_nre_price_sum;

  -- C1: กันตัวหารของสูตร margin ไม่ให้ <= 0 ตั้งแต่ต้นทาง
  -- ส่วนลด >= มูลค่างานส่วนที่คิดกำไรได้ = ปฏิเสธ ไม่ใช่ปล่อยให้อัตราส่วนพลิกเครื่องหมาย
  if p_discount_thb > 0 and p_discount_thb >= v_price_ex_gold_sum then
    raise exception 'oem_quote_save: ส่วนลด % บาท มากกว่าหรือเท่ากับมูลค่างานส่วนที่คิดกำไรได้ (% บาท) — เป็นไปไม่ได้ ไม่มีทางลัด',
      p_discount_thb, round(v_price_ex_gold_sum, 2)
      using errcode = '22023';
  end if;
  if p_discount_thb > v_quote_total_sum then
    raise exception 'oem_quote_save: ส่วนลด % บาท มากกว่ายอดรวมทั้งใบ (% บาท)',
      p_discount_thb, round(v_quote_total_sum, 2)
      using errcode = '22023';
  end if;

  v_grand_total := v_quote_total_sum - p_discount_thb;
  v_margin_actual_blended := case when v_price_total_all <> 0
    then round((v_price_total_all - v_cost_total_all) / v_price_total_all, 4) end;
  v_margin_after_discount := case when (v_price_ex_gold_sum - p_discount_thb) > 0
    then round(((v_price_ex_gold_sum - p_discount_thb) - v_cost_ex_gold_sum) / (v_price_ex_gold_sum - p_discount_thb), 4) end;

  if p_status = 'quoted' then
    if not v_is_complete_all then
      raise exception 'oem_quote_save: มีบางรายการยังกรอกข้อมูลไม่ครบ ออกใบเสนอราคาไม่ได้ — บันทึกเป็น draft ก่อนได้' using errcode = '22023';
    end if;
    if not v_qty_pass_all or not v_metalweight_pass_all then
      raise exception 'oem_quote_save: มีบางรายการไม่ผ่านเกณฑ์ floor (จำนวนชิ้น/น้ำหนักโลหะ) ออกใบเสนอราคาไม่ได้' using errcode = '22023';
    end if;

    v_jobvalue_min := greatest(
      coalesce(v_set.min_job_value_thb, 8000),
      case when v_nre_cost_sum > 0 then v_nre_cost_sum / coalesce(v_set.nre_max_share_pct, 0.25) else 0 end
    );
    -- มี item เงินแท่ง -> ด่านนี้ดูเฉพาะมูลค่างานผลิต (ก่อนหักส่วนลด) ข้ามถ้า = 0
    -- (ใบแท่งล้วน) · ไม่มี item เงินแท่ง -> พฤติกรรมเดิมเป๊ะ (gate v_grand_total)
    if v_has_bar_item then
      if v_production_total_sum > 0 and v_production_total_sum < v_jobvalue_min then
        raise exception 'oem_quote_save: มูลค่างานส่วนที่เป็นงานผลิต (% บาท) ต่ำกว่าเกณฑ์ขั้นต่ำ % บาท ออกใบเสนอราคาไม่ได้ (ใบเงินแท่งล้วนไม่ติดด่านนี้)',
          v_production_total_sum, v_jobvalue_min using errcode = '22023';
      end if;
    else
      if v_grand_total < v_jobvalue_min then
        raise exception 'oem_quote_save: มูลค่างานรวม (%) ต่ำกว่าเกณฑ์ขั้นต่ำ % บาท ออกใบเสนอราคาไม่ได้',
          v_grand_total, v_jobvalue_min using errcode = '22023';
      end if;
    end if;

    -- hard floor ระดับรายชิ้น (v_min_margin_charged) — ด่านที่คุ้มครองงานผลิต
    -- ไม่แตะ ไม่มีเงื่อนไข (bar items ไม่เข้าเงื่อนไขนี้อยู่แล้ว เพราะ
    -- floors.margin.value ของแท่งเป็น null เสมอ v_item_margin_charged จึงเป็น
    -- null ไม่ทำให้ v_min_margin_charged ขยับ)
    if v_min_margin_charged is not null and v_min_margin_charged < v_set.margin_hard_floor_pct then
      raise exception 'oem_quote_save: รายการที่ % — margin ที่คิด % ต่ำกว่า hard floor % — ไม่มีทางลัด ต้องปรับราคาหรือปฏิเสธงาน',
        v_min_margin_seq, round(v_min_margin_charged * 100, 1)::text || '%', round(v_set.margin_hard_floor_pct * 100, 1)::text || '%'
        using errcode = '22023';
    end if;

    -- 0079: hard floor "รวมทั้งใบ" — เติม p_discount_thb > 0 ด่านนี้มีไว้กัน
    -- "ส่วนลดกัดกำไร" ไม่ได้มีไว้กันราคาที่ร้านประกาศเอง (ไม่มีส่วนลด = ไม่มี
    -- อะไรให้กันตรงนี้) ไม่งั้นใบแท่ง 1 กก. (margin จริง 8.4% < hard floor 15%
    -- ตั้งแต่ §2) จะถูกปฏิเสธทั้งที่ไม่ได้ลดราคาสักบาท — ยังคง "คำนวณไม่ได้ =
    -- ตก" (ไม่ใช่ "คำนวณไม่ได้ = ข้าม gate") เมื่อมีส่วนลดจริง
    if p_discount_thb > 0
       and (v_margin_after_discount is null or v_margin_after_discount < v_set.margin_hard_floor_pct) then
      raise exception 'oem_quote_save: ส่วนลด % บาท ทำให้ margin รวมหลังหักส่วนลด % ต่ำกว่า hard floor % — ไม่มีทางลัด ต้องลดส่วนลดหรือปฏิเสธงาน',
        p_discount_thb,
        coalesce(round(v_margin_after_discount * 100, 1)::text || '%', 'คำนวณไม่ได้'),
        round(v_set.margin_hard_floor_pct * 100, 1)::text || '%'
        using errcode = '22023';
    end if;

    -- 0079-fix (แก้จากรอบแรก): note-tier clause แรก (margin รายตัว) ไม่มี
    -- เงื่อนไขเหมือนเดิม (ไม่แตะ) · clause ที่สอง (margin รวมหลังส่วนลด) เดิม
    -- ใช้ "or v_min_margin_charged is null" ซึ่งแปลว่า "ไม่มี item งานผลิตเลย"
    -- — ตัวแทนที่ผิด เพราะเติม item งานผลิตชิ้นเล็ก margin สูงเข้าไปก็ปลดล็อก
    -- ด่านทั้งใบได้ทันที (v_min_margin_charged จะไม่ null อีกต่อไป) แก้เป็น
    -- "or v_has_ungated_item" (ตั้งจริงระหว่าง loop ข้างบน เมื่อ item ไหนก็ตาม
    -- ตรวจ margin รายชิ้นไม่ได้ — ไม่อิงจาก metal='silver999' ตรงๆ เพื่อ
    -- คุ้มครองสินค้าประเภทอื่นที่ตรวจ margin รายชิ้นไม่ได้ในอนาคตอัตโนมัติ)
    -- ด่านรวมทั้งใบเป็นด่านเดียวที่เหลือสำหรับ item แบบนี้ ต้องทำงานเสมอไม่ว่า
    -- ใบจะมี item งานผลิต margin สูงมาช่วยดันค่าเฉลี่ยหรือไม่ก็ตาม · LOW-6:
    -- ข้อความต้องไม่โทษ "ส่วนลด" เมื่อ clause ไฟจากเหตุผลอื่น
    if ((v_min_margin_charged is not null and v_min_margin_charged < v_set.margin_floor_pct)
        or ((p_discount_thb > 0 or v_has_ungated_item) and v_margin_after_discount < v_set.margin_floor_pct))
       and (p_approval_note is null or btrim(p_approval_note) = '') then
      if v_min_margin_charged is not null and v_min_margin_charged < v_set.margin_floor_pct then
        v_note_tier_msg := format('รายการที่ %s — margin ที่คิด %s%% ต่ำกว่า floor %s%% — ต้องใส่เหตุผลก่อนออกใบเสนอราคา',
          v_min_margin_seq, round(v_min_margin_charged * 100, 1), round(v_set.margin_floor_pct * 100, 1));
      elsif p_discount_thb > 0 then
        v_note_tier_msg := format('ส่วนลด %s บาท ทำให้ margin รวมหลังหักส่วนลด %s ต่ำกว่า floor %s%% — ต้องใส่เหตุผลก่อนออกใบเสนอราคา',
          p_discount_thb, coalesce(round(v_margin_after_discount * 100, 1)::text || '%', 'คำนวณไม่ได้'), round(v_set.margin_floor_pct * 100, 1));
      else
        v_note_tier_msg := format('ใบนี้มีรายการที่ระบบตรวจ margin รายชิ้นไม่ได้อยู่ด้วย (เช่น เงินแท่ง) ทำให้ margin รวม %s ต่ำกว่า floor %s%% — ต้องใส่เหตุผลก่อนออกใบเสนอราคา แม้ไม่ได้ลดราคาก็ตาม',
          coalesce(round(v_margin_after_discount * 100, 1)::text || '%', 'คำนวณไม่ได้'), round(v_set.margin_floor_pct * 100, 1));
      end if;
      raise exception 'oem_quote_save: %', v_note_tier_msg using errcode = '22023';
    end if;
  end if;

  v_approved_by := case when p_approval_note is not null and btrim(p_approval_note) <> '' then auth.uid() else null end;

  update analytics.oem_quote set
    input = null,
    calc = null,
    rate_snapshot = jsonb_build_object('formula_version', 2, 'items', v_calc_agg),
    customer_name = coalesce(p_customer_name, customer_name),
    customer_contact = coalesce(p_customer_contact, customer_contact),
    cost_piece = null,
    price_per_piece = null,
    nre_cost = v_nre_cost_sum,
    nre_price = v_nre_price_sum,
    pieces_subtotal = v_pieces_subtotal_sum,
    quote_total = v_quote_total_sum,
    margin_actual_pct = v_margin_actual_blended,
    margin_charged_pct = v_min_margin_charged,
    q_run = v_qrun_sum,
    flask_count = v_flask_count_sum,
    plating_batch_count = v_plate_count_sum,
    status = p_status,
    discount_thb = p_discount_thb,
    discount_reason = p_discount_reason,
    grand_total = v_grand_total,
    margin_after_discount_pct = v_margin_after_discount,
    approval_note = coalesce(p_approval_note, approval_note),
    approved_by = coalesce(v_approved_by, approved_by),
    -- timezone ไทย: กัน 00:00–07:00 ไทยของวันถัดไปที่ current_date (UTC) ยัง
    -- เป็นเมื่อวาน แล้วใบเงินแท่ง (ยืน 0 วัน) ดูเหมือนยังไม่หมดอายุ
    quote_valid_until = case when p_status = 'quoted' then v_bkk_today + v_valid_days else quote_valid_until end,
    updated_by = auth.uid(), updated_at = now()
    -- 0081: deposit_mode/deposit_input ตั้งใจไม่อยู่ใน SET clause นี้เลย —
    -- ทั้งใบใหม่ (ตั้งไปแล้วตอน insert ข้างบน) และใบเก่าที่แก้ (ต้องคงของเดิม
    -- ที่ผู้ใช้เคยตั้งเองไว้ ห้ามทับ) ต่างก็ไม่ต้องการให้ update statement นี้
    -- แตะคอลัมน์นี้
  where id = v_quote_id and shop_id = p_shop_id;

  return v_quote_id;
end;
$function$;

revoke execute on function analytics.oem_quote_save(uuid, jsonb, uuid, text, text, text, text, numeric, text) from public, anon;
grant execute on function analytics.oem_quote_save(uuid, jsonb, uuid, text, text, text, text, numeric, text) to authenticated, service_role;

-- ============================================================================
-- 8. oem_quote_renegotiate — signature เดิม 4 ตัวเป๊ะ (plain replace, ไม่ต้อง
--    drop) แก้จุดเดียว: ใบใหม่สืบทอด deposit_mode/deposit_input จากใบแม่
--    (v_old) เสมอ (เงื่อนไขมัดจำที่ตกลงกันไว้ไม่ควรหายตอนต่อราคา)
--
--    ข้อยกเว้น: โหมด thb ที่ยอดมัดจำเดิม "มากกว่า" grand_total ใหม่ (เกิดได้
--    เมื่อต่อราคาแล้วยอดลดลงจนต่ำกว่ามัดจำที่ตั้งไว้) ต้องลดยอดมัดจำลงมาเท่ากับ
--    grand_total ใหม่ — ห้ามปล่อยให้ใบใหม่มีมัดจำมากกว่ายอดทั้งใบ (deposit_input
--    > grand_total ไม่มีความหมายทางธุรกิจ และ check constraint ของตาราง
--    ตรวจแค่ deposit_input > 0 ไม่ได้เทียบข้าม grand_total ให้ ต้อง clamp เอง
--    ในฟังก์ชันนี้)
--
--    ⚠️ ผลข้างเคียงที่ตั้งใจปล่อยให้เห็น (ตามที่สั่ง ไม่มีช่องทาง warning ออกไป
--    ฝั่งแอปเพราะ return type เป็น uuid เดียว): กรณีนี้มัดจำจะกลายเป็น "เต็มยอด"
--    (100% ของ grand_total ใหม่) ต่างจากเงื่อนไขที่ตกลงกันไว้เดิม (เช่น จาก
--    50% กลายเป็น 100%) ฝั่งแอปควรเช็คว่ามัดจำถูกปรับหรือไม่แล้วเตือนผู้ใช้เอง
--    หลัง renegotiate สำเร็จ (เทียบ deposit_input ของใบใหม่กับใบแม่)
--
--    ⚠️ เคสขอบ (defensive, เกินสเปกที่สั่งเล็กน้อย): ถ้า grand_total ใหม่ <= 0
--    การ clamp deposit_input ลงมาเท่ากับ grand_total จะได้ค่า <= 0 ซึ่งชน
--    check constraint (deposit_input ต้อง > 0) ทันที — ในทางทฤษฎี gate อื่น
--    (C1 + hard floor รวมทั้งใบ) กัน grand_total ใหม่ไม่ให้ <= 0 อยู่แล้ว แต่
--    ถ้าเกิดขึ้นจริง (เช่น gate อื่นมีรูรั่วที่ยังไม่พบ) จะให้ renegotiate
--    ทั้งใบพังด้วย constraint violation ที่อ่านยากแทนที่จะเป็นข้อความชัดเจน —
--    จึงเคลียร์มัดจำทั้งชุด (mode/input เป็น null) แทนการ clamp ในเคสนี้เท่านั้น
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
        parent_quote_id, root_quote_id, customer_id, vat_mode,
        deposit_mode, deposit_input,
        quote_valid_until, created_by, updated_by
      ) values (
        v_new_id, v_old.shop_id, v_new_no, v_old.customer_name, v_old.customer_contact, null, null, v_old.rate_snapshot,
        v_old.cost_piece, v_old.price_per_piece, v_old.nre_cost, v_old.nre_price, v_old.pieces_subtotal, v_old.quote_total,
        v_old.margin_actual_pct, v_old.margin_charged_pct, v_old.q_run, v_old.flask_count, v_old.plating_batch_count,
        'quoted', p_new_discount_thb, p_reason, v_new_grand_total, v_margin_after,
        v_old.id, coalesce(v_old.root_quote_id, v_old.id), v_old.customer_id, v_old.vat_mode,
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
