-- 0080_oem_setting_clearable.sql
-- แก้บั๊กที่เจ้าของเจอจริง: oem_setting_upsert ใช้ coalesce(p_x, os.x) กับ
-- scalar field ทุกตัว ทำให้ "ไม่ส่งมา" กับ "ส่งมาเป็นค่าว่าง" แยกกันไม่ออก —
-- เจ้าของลบข้อความในช่องข้อมูลร้าน (เช่น ชื่อสาขา/เบอร์โทร) จนว่างแล้วกดบันทึก
-- ค่าเดิมจะค้างอยู่ ลบทิ้งไม่ได้เลย
--
-- ============ ขอบเขตที่แก้ — เฉพาะ text ของ seller_* เท่านั้น ============
-- seller_legal_name, seller_display_name, seller_branch_label, seller_tax_id,
-- seller_phone, seller_line, seller_email, seller_website
-- เปลี่ยนเป็น 3 สถานะ: p_x is null (ไม่แก้) / p_x = '' (ล้างเป็น null) /
-- อย่างอื่น (เขียนทับ, trim ด้วย btrim)
--
-- ============ ที่ "ไม่แตะ" เจตนา ============
-- - margin/rate ตัวเลขทั้งหมด (margin_target_pct, margin_discount_cap_pct,
--   margin_floor_pct, margin_hard_floor_pct, nre_max_share_pct,
--   min_job_value_thb, quote_valid_days_silver/gold/brass, bar_margin_pct) —
--   เป็นค่าที่คุมเงิน/คุมด่านส่วนลด ห้ามล้างเป็น null เด็ดขาด คง coalesce เดิม
-- - seller_vat_registered (boolean) — checkbox ฝั่งแอปส่งมาเสมอ (ไม่มี "ไม่ส่ง
--   มา" ที่ตั้งใจ) คง coalesce เดิม
-- - seller_address_lines / seller_terms (jsonb array) — เคลียร์ได้อยู่แล้วด้วย
--   '[]' (ไม่ใช่ scalar coalesce แบบ text) แต่เพิ่ม normalize: ถ้าทั้ง array มี
--   แต่ string ว่าง/ช่องว่างล้วน (เช่น เจ้าของลบทีละบรรทัดจนเหลือ ["","",""])
--   ให้เก็บเป็น [] แทนที่จะปล่อยให้บรรทัดว่างค้างแล้วไปโผล่บนเอกสารพิมพ์จริง —
--   ไม่ strip รายบรรทัดถ้ามีอย่างน้อย 1 บรรทัดที่มีข้อความจริง (คงของเดิมทั้ง
--   array ตามที่ส่งมา ไม่ตัดสินใจเกินขอบเขตที่สั่ง)
--
-- ============ signature ============
-- คง 22 พารามิเตอร์เดิมเป๊ะ (ชนิด/ลำดับเหมือน 0079 ทุกตัว) = plain
-- create-or-replace ไม่เกิด overload ไม่ต้อง drop — แต่ยัง re-grant execute
-- ใหม่ตามคำสั่ง (กัน grant หลุดถ้ามีการ drop/สร้างใหม่ระหว่างทางโดยไม่ตั้งใจ)
--
-- อ่านคู่กับ 0079 (oem_setting_upsert เดิม, ตาราง+constraint seller_tax_id)
-- ============================================================================

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
  p_seller_terms jsonb default null
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
    updated_by = auth.uid(), updated_at = now();
end;
$$;

-- 0080: signature เดิมเป๊ะ 22 ตัว (ไม่มี drop) — create or replace แทนที่ OID
-- เดิมได้ตรงๆ แต่ยัง re-grant execute ใหม่ตามที่สั่ง (กัน grant หลุดถ้ามีคน
-- drop/สร้างใหม่ระหว่างทางโดยไม่ตั้งใจ ไม่ใช่เพราะ overload — arg list ตรงกัน
-- 100% กับ 0079)
revoke execute on function analytics.oem_setting_upsert(uuid, numeric, numeric, numeric, numeric, numeric, numeric, int, int, int, numeric, text, text, text, jsonb, text, boolean, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function analytics.oem_setting_upsert(uuid, numeric, numeric, numeric, numeric, numeric, numeric, int, int, int, numeric, text, text, text, jsonb, text, boolean, text, text, text, text, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
