-- 0096_sku_generator_hardening.sql
-- Security review รอบ 2a ของระบบออกเลข SKU (0089-0092) เจอ 4 ข้อ — ปิดทั้งหมดในไฟล์
-- เดียว ไม่มีข้อไหนเปลี่ยน signature ของฟังก์ชันที่แตะ (plain create or replace ครบ
-- ทุกตัว + re-grant ตามกับดักข้อ 2 ของทีม)
--
-- ============================================================================
-- สรุป 4 ข้อที่ปิด
-- ============================================================================
-- 1) catalog_sku_create ทำ probe (not exists) แล้วค่อยเรียก product_upsert ซึ่ง
--    ลงท้ายด้วย on conflict...do update — uq_product_shop_sku ไม่มีวันทำงานเป็น
--    กำแพงจริง (probe เห็นว่าว่างได้ระหว่างที่อีก request แทรกก่อน) เปลี่ยนเป็น
--    "claiming insert" ในลูป — จองด้วย insert จริงทีละเลข ให้ unique constraint
--    เป็นกำแพงจริง ไม่ใช่แค่ probe เฉยๆ
-- 2) p_attrs ไม่มีด่านกัน NaN — product_upsert (0031/0028) ยัง validate ด้วย
--    < 0 / <= 0 ซึ่ง Postgres ถือว่า NaN "มากกว่า" ทุกค่า เงื่อนไขพวกนี้จึงจับ NaN
--    ไม่ได้ (บทเรียน 0083 / กับดักข้อ 4) ห้ามแตะ product_upsert เอง จึงปิดที่
--    catalog_sku_create ก่อนส่งต่อ: whitelist key ของ p_attrs + ทุกช่องตัวเลขใช้
--    not(between) + ช่อง text ใส่เพดานความยาว
-- 3) catalog_sku_create อ่านแถว config (analytics.sku_prefix) โดยไม่ล็อก ทั้งที่
--    sku_prefix_delete/sku_prefix_upsert ล็อกแถวนี้ด้วย for update — เพิ่ม for
--    update ให้ catalog_sku_create ด้วย ให้ serialize กันจริง และเช็ค found หลัง
--    update sku_counter (found หลัง update เชื่อได้ - กับดักข้อ 8 พูดถึงเฉพาะหลัง
--    for...loop)
-- 4) sku_prefix_preview_seed cast ทุก match เป็น int แบบไม่จำกัดความยาว — SKU เลข
--    ยาวเกิน int (เช่น B-20240101120000) ทำให้ 22003 integer out of range ตั้ง
--    config ของ prefix นั้นไม่ได้เลย แก้ทั้ง 3 จุดที่มี regex ตัดสิน "ตัวเลขหลัง
--    prefix" ให้ตรงกัน: จำกัดความยาว [0-9]{1,9} (การันตี fit ใน int4) + anchor
--    ท้าย $ (ดูเหตุผลข้างล่าง)
--
-- ============================================================================
-- ตัดสินใจเรื่อง anchor $ (ข้อ 4) — Tech Lead สั่งใส่ $ ทั้ง 3 จุด (preview_seed,
-- sku_prefix_delete, sku_prefix_upsert) เหตุผล: generator สร้าง SKU รูปแบบ
-- "prefix + ตัวเลขล้วน" เท่านั้น anchor จึงตรงกับความจริงของสิ่งที่ระบบสร้างเอง
--
-- ผลข้างเคียงที่ยอมรับ: ก่อนแก้ regex '^prefix[0-9]+' (ไม่มี $) จับ SKU legacy
-- อย่าง "B-21X" (ตัวเลขตามด้วยตัวอักษร) ว่า "มี SKU ใช้ prefix นี้อยู่" อยู่แล้ว
-- (ไม่มี $ ก็ยังแมตช์ได้เพราะไม่บังคับจบสตริง) ใส่ $ แล้ว "B-21X" จะไม่ถูกนับว่า
-- "ใช้ prefix นี้" อีกต่อไป → ลบ/แก้ prefix "B-" ได้แม้มี "B-21X" ค้างอยู่
--
-- backend-dev เห็นด้วยกับการตัดสินนี้: "B-21X" ไม่ใช่ SKU ที่ catalog_sku_create
-- เคยออกเอง (generator ไม่เติมตัวอักษรต่อท้ายตัวเลข) เป็น SKU legacy/นำเข้ามือ
-- การชนจริง (exact-match unique constraint ตอน claiming-ins> ข้อ 1) ยังกันซ้ำซ้อน
-- แน่นอนอยู่แล้วเพราะเทียบ sku ตรงตัว ไม่ใช่ prefix อย่างเดียว — "B-21X" กับ "B-21"
-- เป็นคนละสตริง ไม่มีทางชนกัน anchor $ จึงลดความหมายของ "prefix นี้ใช้งานอยู่ไหม"
-- ให้แคบลงเฉพาะ "มี SKU ที่ generator ตัวนี้จะออกจริงๆ อยู่ไหม" ซึ่งตรงกับเจตนา
-- ของด่านนี้มากกว่าเดิม ไม่มีข้อคัดค้าน
--
-- ============================================================================
-- แตะ: analytics.sku_prefix_preview_seed (plain replace, signature เดิม) ·
--      analytics.sku_prefix_delete (plain replace, signature เดิม) ·
--      analytics.sku_prefix_upsert (plain replace, signature เดิม 7 args) ·
--      analytics.catalog_sku_create (plain replace, signature เดิม)
-- ห้ามแตะ: analytics.product_upsert (0031) · analytics.transform_pending_order_lines
-- ============================================================================

-- ============================================================================
-- 1. analytics.sku_prefix_preview_seed — ข้อ 4: จำกัดความยาวตัวเลข [0-9]{1,9}
--    (การันตี fit ใน int4 เสมอ ไม่มีทาง integer out of range อีก) + anchor $
--    (เหตุผล anchor ดูหัวไฟล์) signature เดิม (uuid, text) -> table(int, int)
--    ไม่เปลี่ยน — plain replace พอ
-- ============================================================================

create or replace function analytics.sku_prefix_preview_seed(
  p_shop_id uuid,
  p_prefix text
)
 returns table(suggested_seed int, suggested_pad_width int)
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_seed     int;
  v_num_text text;
begin
  if p_shop_id is null then
    raise exception 'sku_prefix_preview_seed: p_shop_id is required';
  end if;
  if p_prefix is null or p_prefix !~ '^[A-Z]{1,5}-?$' then
    raise exception 'sku_prefix_preview_seed: p_prefix must match ^[A-Z]{1,5}-?$ (uppercase letters 1-5 chars, optional trailing dash)'
      using errcode = '22023';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  -- 0096 ข้อ 4: '([0-9]{1,9})$' — จำกัดความยาว (กัน integer out of range ตอน cast
  -- ข้างล่าง) + anchor ท้าย (ตัดสินใจไว้หัวไฟล์ — ตรงกับ sku_prefix_delete/
  -- sku_prefix_upsert)
  select m.num_text::int, m.num_text
    into v_seed, v_num_text
    from (
      select (regexp_match(pr.sku, '^' || p_prefix || '([0-9]{1,9})$'))[1] as num_text
        from public.product pr
       where pr.shop_id = p_shop_id
    ) m
   where m.num_text is not null
   order by m.num_text::int desc, length(m.num_text) desc
   limit 1;

  suggested_seed := coalesce(v_seed, 0);
  suggested_pad_width := coalesce(length(v_num_text), 0);
  return next;
end;
$$;

revoke execute on function analytics.sku_prefix_preview_seed(uuid, text) from public, anon;
grant execute on function analytics.sku_prefix_preview_seed(uuid, text) to authenticated, service_role;

-- ============================================================================
-- 2. analytics.sku_prefix_delete — ข้อ 4: regex เดียวกับด้านบน ([0-9]{1,9}$)
--    signature เดิม (uuid, uuid) -> void ไม่เปลี่ยน — plain replace พอ
-- ============================================================================

create or replace function analytics.sku_prefix_delete(
  p_shop_id uuid,
  p_id uuid
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_row       analytics.sku_prefix%rowtype;
  v_sku_count bigint;
begin
  if p_shop_id is null then
    raise exception 'sku_prefix_delete: p_shop_id is required';
  end if;
  if p_id is null then
    raise exception 'sku_prefix_delete: p_id is required';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  select * into v_row
    from analytics.sku_prefix
   where id = p_id and shop_id = p_shop_id
   for update;
  if not found then
    raise exception 'sku_prefix_delete: ไม่พบ config id % ในร้านนี้', p_id using errcode = '22023';
  end if;

  -- 0096 ข้อ 4: เติม $ + จำกัดความยาวให้ตรงกับ preview_seed/upsert — ผลข้างเคียง
  -- ที่ยอมรับ (ดูคำอธิบายหัวไฟล์): SKU legacy รูปแบบ "prefix+เลข+ตัวอักษร" (เช่น
  -- B-21X) จะไม่ถูกนับว่า "ใช้ prefix นี้อยู่" อีกต่อไป — ลบ prefix ได้แม้มีแถว
  -- แบบนี้ค้างอยู่ เพราะไม่ใช่ SKU ที่ catalog_sku_create เคยออกจริง และ exact-match
  -- unique constraint ตอนออก SKU ใหม่ (ข้อ 1) กันชนซ้ำอยู่แล้วไม่ว่ากรณีนี้จะนับ
  -- หรือไม่นับ
  select count(*) into v_sku_count
    from public.product pr
   where pr.shop_id = p_shop_id
     and pr.sku ~ ('^' || v_row.prefix || '[0-9]{1,9}$');

  if v_sku_count > 0 then
    raise exception 'sku_prefix_delete: prefix % มี SKU ใช้งานแล้ว % รายการ — ลบไม่ได้ (ลบได้เฉพาะ config ที่ยังไม่เคยออก SKU)',
      v_row.prefix, v_sku_count
      using errcode = '22023';
  end if;

  delete from analytics.sku_prefix where id = p_id and shop_id = p_shop_id;
  delete from analytics.sku_counter where shop_id = p_shop_id and prefix = v_row.prefix;
end;
$$;

revoke execute on function analytics.sku_prefix_delete(uuid, uuid) from public, anon;
grant execute on function analytics.sku_prefix_delete(uuid, uuid) to authenticated, service_role;

-- ============================================================================
-- 3. analytics.sku_prefix_upsert — ข้อ 4: regex เดียวกัน ([0-9]{1,9}$) ตอนเช็ค
--    "มี SKU ใช้ prefix เดิมอยู่ไหม" ก่อนยอมแก้ prefix signature เดิม 7 args
--    ไม่เปลี่ยน — plain replace พอ (body ที่เหลือลอกจาก 0092 คำต่อคำ)
-- ============================================================================

create or replace function analytics.sku_prefix_upsert(
  p_shop_id uuid,
  p_kind_label text,
  p_work_type text,
  p_prefix text,
  p_id uuid default null,
  p_seed_last_no int default null,
  p_pad_width int default null
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_kind_label   text;
  v_existing     analytics.sku_prefix%rowtype;
  v_row_id       uuid;
  v_final_prefix text;
  v_old_prefix   text;
  v_sku_count    bigint;
  v_constraint   text;
begin
  if p_shop_id is null then
    raise exception 'sku_prefix_upsert: p_shop_id is required';
  end if;

  v_kind_label := left(nullif(btrim(p_kind_label), ''), 100);
  if v_kind_label is null then
    raise exception 'sku_prefix_upsert: p_kind_label is required' using errcode = '22023';
  end if;

  if p_work_type is null or p_work_type not in ('plain', 'gem') then
    raise exception 'sku_prefix_upsert: p_work_type must be plain or gem' using errcode = '22023';
  end if;

  if p_prefix is null or p_prefix !~ '^[A-Z]{1,5}-?$' then
    raise exception 'sku_prefix_upsert: p_prefix must match ^[A-Z]{1,5}-?$ (uppercase letters 1-5 chars, optional trailing dash)'
      using errcode = '22023';
  end if;

  if p_seed_last_no is not null and not (p_seed_last_no >= 0 and p_seed_last_no <= 1000000) then
    raise exception 'sku_prefix_upsert: p_seed_last_no must be between 0 and 1,000,000' using errcode = '22023';
  end if;

  if p_pad_width is not null and not (p_pad_width >= 0 and p_pad_width <= 6) then
    raise exception 'sku_prefix_upsert: p_pad_width must be between 0 and 6' using errcode = '22023';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  if p_id is null then
    if p_seed_last_no is null then
      raise exception 'sku_prefix_upsert: ต้องระบุ p_seed_last_no ตอนสร้าง config ใหม่ (เรียก sku_prefix_preview_seed แล้วให้ผู้ใช้ยืนยันก่อน)'
        using errcode = '22023';
    end if;

    begin
      insert into analytics.sku_prefix (shop_id, kind_label, work_type, prefix, pad_width, created_by, updated_by)
      values (p_shop_id, v_kind_label, p_work_type, p_prefix, coalesce(p_pad_width, 0), auth.uid(), auth.uid())
      returning id into v_row_id;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'uq_sku_prefix_shop_prefix' then
        raise exception 'sku_prefix_upsert: prefix % ถูกใช้ในร้านนี้แล้ว', p_prefix using errcode = '23505';
      elsif v_constraint = 'uq_sku_prefix_shop_kind_work' then
        raise exception 'sku_prefix_upsert: มี config kind_label/work_type นี้อยู่แล้วในร้านนี้' using errcode = '23505';
      else
        raise exception 'sku_prefix_upsert: ข้อมูลซ้ำในร้านนี้ (%)', sqlerrm using errcode = '23505';
      end if;
    end;

    v_final_prefix := p_prefix;

  else
    select * into v_existing
      from analytics.sku_prefix
     where id = p_id and shop_id = p_shop_id
     for update;
    if not found then
      raise exception 'sku_prefix_upsert: ไม่พบ config id % ในร้านนี้', p_id using errcode = '22023';
    end if;

    if v_existing.work_type <> p_work_type then
      raise exception 'sku_prefix_upsert: work_type ของ config นี้เปลี่ยนไม่ได้ (เดิม % ส่งมา %)',
        v_existing.work_type, p_work_type
        using errcode = '22023';
    end if;

    if v_existing.prefix <> p_prefix then
      -- 0096 ข้อ 4: เติม $ + จำกัดความยาว (ดูคำอธิบายผลข้างเคียงหัวไฟล์ — เหมือน
      -- sku_prefix_delete เป๊ะ)
      select count(*) into v_sku_count
        from public.product pr
       where pr.shop_id = p_shop_id
         and pr.sku ~ ('^' || v_existing.prefix || '[0-9]{1,9}$');

      if v_sku_count > 0 then
        raise exception 'sku_prefix_upsert: prefix % มี SKU ใช้งานแล้ว % รายการ — แก้ prefix ไม่ได้',
          v_existing.prefix, v_sku_count
          using errcode = '22023';
      end if;

      v_old_prefix := v_existing.prefix;
    end if;

    begin
      update analytics.sku_prefix
         set kind_label = v_kind_label,
             prefix = p_prefix,
             pad_width = coalesce(p_pad_width, pad_width),
             updated_by = auth.uid(),
             updated_at = now()
       where id = p_id and shop_id = p_shop_id;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'uq_sku_prefix_shop_prefix' then
        raise exception 'sku_prefix_upsert: prefix % ถูกใช้ในร้านนี้แล้ว', p_prefix using errcode = '23505';
      elsif v_constraint = 'uq_sku_prefix_shop_kind_work' then
        raise exception 'sku_prefix_upsert: มี config kind_label/work_type นี้อยู่แล้วในร้านนี้' using errcode = '23505';
      else
        raise exception 'sku_prefix_upsert: ข้อมูลซ้ำในร้านนี้ (%)', sqlerrm using errcode = '23505';
      end if;
    end;

    v_row_id := p_id;
    v_final_prefix := p_prefix;

    if v_old_prefix is not null then
      delete from analytics.sku_counter where shop_id = p_shop_id and prefix = v_old_prefix;
    end if;
  end if;

  if p_seed_last_no is not null then
    insert into analytics.sku_counter as c (shop_id, prefix, last_no)
    values (p_shop_id, v_final_prefix, p_seed_last_no)
    on conflict (shop_id, prefix) do update set last_no = greatest(c.last_no, excluded.last_no);
  else
    insert into analytics.sku_counter (shop_id, prefix, last_no)
    values (p_shop_id, v_final_prefix, 0)
    on conflict (shop_id, prefix) do nothing;
  end if;

  return v_row_id;
end;
$$;

revoke execute on function analytics.sku_prefix_upsert(uuid, text, text, text, uuid, int, int) from public, anon;
grant execute on function analytics.sku_prefix_upsert(uuid, text, text, text, uuid, int, int) to authenticated, service_role;

-- ============================================================================
-- 4. analytics.catalog_sku_create — ข้อ 1 + 2 + 3 ปิดพร้อมกันในฟังก์ชันเดียว
--    signature เดิม (uuid, uuid, text, jsonb) -> table(uuid, text) ไม่เปลี่ยน —
--    plain replace พอ
--
--    ข้อ 1 (claiming insert): เดิม probe ด้วย `not exists (select ... where
--    sku = candidate)` แล้วค่อยเรียก product_upsert ซึ่งจบด้วย
--    `on conflict (shop_id, sku) do update` — uq_product_shop_sku ไม่มีวันทำงาน
--    เป็นกำแพงจริงเพราะพอ product_upsert ชนจริง มันไม่ raise แต่ "แก้ของเดิม
--    เงียบๆ" แทน (เคสจริง: กด "+ สินค้าใหม่" พร้อมกับ import CSV ที่กำลัง insert
--    เลขเดียวกัน — probe เห็นว่าง ระหว่างนั้น CSV ได้เลขไปก่อน แล้ว product_upsert
--    ทับต้นทุน/ราคาของสินค้าที่มีอยู่เป็น null เงียบๆ) เปลี่ยนเป็น insert จริง
--    ทีละเลขในลูป ให้ unique constraint บล็อกจริงผ่าน unique_violation
--    exception handler
--
--    ⚠️ ผลข้างเคียงที่ยอมรับ: claiming insert สร้างแถว (shop_id, sku, name)
--    เปล่าๆ ก่อน แล้ว product_upsert เดิม (ห้ามแตะ) เจอแถวนี้อยู่แล้วจึงเดินเส้น
--    "on conflict do update" เสมอ (v_old.id ไม่ null) -> catalog_audit_log.action
--    จะบันทึกเป็น 'edit' ไม่ใช่ 'add' (ค่าที่ check constraint ยอมรับจริงคือ
--    'add'/'edit'/'delete' — ก่อนแก้ไฟล์นี้เข้าเส้น insert ล้วนๆ จึงได้ 'add')
--    ยอมรับผลนี้เพราะ "unique constraint เป็นกำแพงจริง" สำคัญกว่าความถูกต้องของ
--    ป้ายกำกับ action ในประวัติ — แถว "before" ในออดิตล็อกจะโชว์สินค้าที่มีแค่
--    name (fields อื่น null) ซึ่งเป็นภาพจริงของสิ่งที่เกิดขึ้น ไม่ใช่ข้อมูลเท็จ
--
--    ข้อ 2 (กัน NaN ใน p_attrs): whitelist key ก่อน + ทุกช่องตัวเลขใช้
--    not(x >= lo and x <= hi) ไม่ใช้ < 0 / <= 0 (NaN Postgres ถือว่ามากกว่าทุกค่า
--    -> เงื่อนไข < 0 จะ false แล้วลอดผ่าน — บทเรียน 0083/กับดักข้อ 4) ทำที่นี่เอง
--    เพราะ product_upsert (0031:84-92, ห้ามแตะ) ยังใช้ < 0 / <= 0 อยู่ ปิดไม่ได้
--    ที่ต้นทาง ช่อง text ใส่เพดานความยาวด้วย left(...) กันพิมพ์ยาวเกินจริง
--
--    ข้อ 3 (lock config row): เพิ่ม `for update` ตอน select v_prefix_row ให้
--    serialize กับ sku_prefix_delete/sku_prefix_upsert ซึ่งล็อกแถวเดียวกันอยู่
--    แล้ว (0092/0091) กันเคส "ลบ config สำเร็จทั้งที่มี SKU กำลังออก" และเช็ค
--    `found` หลัง `update sku_counter` (เชื่อได้เพราะเป็นคำสั่งเดี่ยว ไม่ใช่หลัง
--    for...loop — กับดักข้อ 8) ถ้า 0 แถว = config ถูกลบ/แก้พร้อมกันระหว่างที่
--    เรากำลังออกเลข ให้ raise บอกลองใหม่แทนที่จะเงียบแล้ว SKU เกิดแต่ตัวนับไม่เดิน
--
--    ⚠️ OUT vars ของ RETURNS TABLE คือ product_id/sku — ชนกับชื่อคอลัมน์จริงของ
--    public.product ถ้าอ้างแบบไม่ qualify (Supabase gotcha #2, 42702) จึง alias
--    public.product เป็น pr ทุกจุดในฟังก์ชันนี้ (คงจาก 0091/0092)
-- ============================================================================

create or replace function analytics.catalog_sku_create(
  p_shop_id uuid,
  p_prefix_id uuid,
  p_name text,
  p_attrs jsonb default null
)
 returns table(product_id uuid, sku text)
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_prefix_row analytics.sku_prefix%rowtype;
  v_name       text;
  v_last_no    int;
  v_final_no   int;
  v_candidate  text;
  v_num_text   text;
  v_found      boolean := false;
  v_i          int;
  v_category         text;
  v_cost_type        text;
  v_unit_cost        numeric;
  v_silver_weight_g  numeric;
  v_silver_purity    numeric;
  v_labor_cost       numeric;
  v_list_price       numeric;
  v_barcode          text;
  v_supplier         text;
  v_note             text;
  v_product_id       uuid;
begin
  if p_shop_id is null or p_prefix_id is null then
    raise exception 'catalog_sku_create: p_shop_id and p_prefix_id are required';
  end if;
  v_name := nullif(btrim(p_name), '');
  if v_name is null then
    raise exception 'catalog_sku_create: p_name is required' using errcode = '22023';
  end if;
  if p_attrs is not null and jsonb_typeof(p_attrs) <> 'object' then
    raise exception 'catalog_sku_create: p_attrs must be a json object' using errcode = '22023';
  end if;

  -- 0096 ข้อ 2: whitelist key ของ p_attrs ก่อนแตะข้อมูลใดๆ — key แปลกปลอมที่ไม่
  -- อยู่ในลิสต์นี้ต้อง reject ตรงๆ ไม่ใช่เพิกเฉยเงียบๆ (เพิกเฉยเงียบๆ = ผู้ใช้คิด
  -- ว่าค่าที่กรอกถูกบันทึกทั้งที่ไม่ถูก)
  if p_attrs is not null and exists (
    select 1 from jsonb_object_keys(p_attrs) k
     where k not in (
       'category', 'cost_type', 'unit_cost', 'silver_weight_g', 'silver_purity',
       'labor_cost', 'list_price', 'barcode', 'supplier', 'note'
     )
  ) then
    raise exception 'catalog_sku_create: p_attrs contains unknown key(s)' using errcode = '22023';
  end if;

  -- แกะ p_attrs เป็น field ที่ product_upsert เดิมรองรับ — p_attrs เป็น null ได้
  -- ->> บน null jsonb คืน null เฉยๆ ช่อง text ใส่เพดานความยาวด้วย left(...)
  v_category         := left(nullif(btrim(coalesce(p_attrs ->> 'category', '')), ''), 100);
  v_cost_type        := coalesce(nullif(btrim(p_attrs ->> 'cost_type'), ''), 'fixed');
  v_unit_cost        := nullif(btrim(coalesce(p_attrs ->> 'unit_cost', '')), '')::numeric;
  v_silver_weight_g  := nullif(btrim(coalesce(p_attrs ->> 'silver_weight_g', '')), '')::numeric;
  v_silver_purity    := nullif(btrim(coalesce(p_attrs ->> 'silver_purity', '')), '')::numeric;
  v_labor_cost       := nullif(btrim(coalesce(p_attrs ->> 'labor_cost', '')), '')::numeric;
  v_list_price       := nullif(btrim(coalesce(p_attrs ->> 'list_price', '')), '')::numeric;
  v_barcode          := left(nullif(btrim(coalesce(p_attrs ->> 'barcode', '')), ''), 64);
  v_supplier         := left(nullif(btrim(coalesce(p_attrs ->> 'supplier', '')), ''), 100);
  v_note             := left(nullif(btrim(coalesce(p_attrs ->> 'note', '')), ''), 500);

  -- 0096 ข้อ 2: not(between) กัน NaN/Infinity/ค่าเกินเพดาน — ห้ามใช้ < 0 / <= 0
  -- (NaN Postgres ถือว่ามากกว่าทุกค่า เงื่อนไข < 0 จะ false แล้วลอดผ่านทั้ง
  -- ชั้นนี้และชั้น product_upsert/column check ที่ก็ใช้ >= 0 อยู่ดี — บทเรียน
  -- 0083 / กับดักข้อ 4) ทำที่นี่เพราะแตะ product_upsert (0031) ไม่ได้
  if v_unit_cost is not null and not (v_unit_cost >= 0 and v_unit_cost <= 10000000) then
    raise exception 'catalog_sku_create: unit_cost must be between 0 and 10,000,000' using errcode = '22023';
  end if;
  if v_labor_cost is not null and not (v_labor_cost >= 0 and v_labor_cost <= 10000000) then
    raise exception 'catalog_sku_create: labor_cost must be between 0 and 10,000,000' using errcode = '22023';
  end if;
  if v_list_price is not null and not (v_list_price >= 0 and v_list_price <= 10000000) then
    raise exception 'catalog_sku_create: list_price must be between 0 and 10,000,000' using errcode = '22023';
  end if;
  if v_silver_weight_g is not null and not (v_silver_weight_g >= 0 and v_silver_weight_g <= 100000) then
    raise exception 'catalog_sku_create: silver_weight_g must be between 0 and 100,000' using errcode = '22023';
  end if;
  if v_silver_purity is not null and not (v_silver_purity > 0 and v_silver_purity <= 1) then
    raise exception 'catalog_sku_create: silver_purity must be in (0,1]' using errcode = '22023';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  -- 0096 ข้อ 3: for update — serialize กับ sku_prefix_delete/sku_prefix_upsert
  -- ที่ล็อกแถวนี้อยู่แล้ว (0091/0092) กันเคส "ลบ config สำเร็จทั้งที่มี SKU
  -- กำลังออก" (ไม่มี for update เดิม ไม่ serialize กันเลย)
  select * into v_prefix_row
    from analytics.sku_prefix
   where id = p_prefix_id and shop_id = p_shop_id
   for update;
  if not found then
    raise exception 'catalog_sku_create: ไม่พบ config SKU นี้ในร้าน — ไปตั้งค่าที่หน้า /catalog/sku-prefix ก่อน'
      using errcode = '22023';
  end if;

  -- ensure-then-lock ในสเตตเมนต์เดียว (pattern เดียวกับ oem_doc_counter 0084):
  -- สร้างแถวถ้ายังไม่มี (last_no=0) แล้วล็อกแถวนั้นทันที ป้องกันสอง request ยิง
  -- catalog_sku_create ของ prefix เดียวกันพร้อมกันแล้วได้เลขซ้ำ
  insert into analytics.sku_counter as c (shop_id, prefix, last_no)
  values (p_shop_id, v_prefix_row.prefix, 0)
  on conflict (shop_id, prefix) do update set last_no = c.last_no
  returning c.last_no into v_last_no;

  -- 0096 ข้อ 1: claiming insert แทน probe (not exists) + product_upsert เดิม —
  -- probe เห็นว่าง ≠ จองสำเร็จจริง มีช่องว่างให้อีก transaction แทรกเลขเดียวกัน
  -- ระหว่างนั้นได้ (เคสจริง: กด "+ สินค้าใหม่" พร้อม import CSV) จองด้วย insert
  -- จริงทีละเลขในลูป ให้ unique constraint (uq_product_shop_sku) เป็นกำแพงจริง
  -- ผ่าน unique_violation handler — เลขไหนชนก็แค่ลองเลขถัดไป ไม่ error ทิ้ง
  -- คงตรรกะเติมศูนย์จาก 0091/0092 (guard ด้วย length ก่อน lpad กัน lpad ตัดเลข
  -- ยาวเกิน pad_width ทิ้ง)
  for v_i in 1..20 loop
    v_num_text := (v_last_no + v_i)::text;
    if v_prefix_row.pad_width > 0 and length(v_num_text) < v_prefix_row.pad_width then
      v_num_text := lpad(v_num_text, v_prefix_row.pad_width, '0');
    end if;
    v_candidate := v_prefix_row.prefix || v_num_text;

    begin
      insert into public.product (shop_id, sku, name) values (p_shop_id, v_candidate, v_name);
      v_final_no := v_last_no + v_i;
      v_found := true;
      exit;
    exception when unique_violation then
      -- มีคนถือเลขนี้อยู่จริง (ไม่ใช่แค่ "ดูเหมือนว่าง" ตอน probe) -> ลองเลขถัดไป
      null;
    end;
  end loop;

  if not v_found then
    raise exception 'catalog_sku_create: หาเลข SKU ว่างให้ prefix % ไม่ได้ภายใน 20 รอบ — ไปตรวจตัวนับที่หน้า /catalog/sku-prefix',
      v_prefix_row.prefix
      using errcode = '22023';
  end if;

  update analytics.sku_counter
     set last_no = v_final_no
   where shop_id = p_shop_id and prefix = v_prefix_row.prefix;

  -- 0096 ข้อ 3: found หลัง update เดี่ยว (ไม่ใช่หลัง for...loop) เชื่อได้ — 0
  -- แถว = แถว config ถูกลบ/แก้พร้อมกันระหว่างที่เรากำลังออกเลข (sku_prefix_delete
  -- ลบ sku_counter ของ prefix นี้ไปแล้ว หรือ sku_prefix_upsert แก้ prefix แล้ว
  -- ลบ counter เดิมทิ้ง) ต้อง raise ให้ผู้ใช้ลองใหม่ ไม่ใช่ปล่อยให้ product เกิด
  -- แล้วแต่ตัวนับไม่เดิน
  if not found then
    raise exception 'catalog_sku_create: ตัวนับ SKU ของ prefix % ถูกลบ/แก้พร้อมกันระหว่างออกเลข — ลองใหม่อีกครั้ง',
      v_prefix_row.prefix
      using errcode = '40001';
  end if;

  -- ⚠️ ผลข้างเคียงที่ยอมรับ (ดูคำอธิบายเต็มหัวฟังก์ชันนี้): เพราะ claiming
  -- insert ข้างบนสร้างแถว (shop_id, sku, name) ไปแล้ว product_upsert เดิม
  -- (ห้ามแตะ) จะเดินเส้น on conflict do update เสมอ -> catalog_audit_log.action
  -- บันทึกเป็น 'edit' ไม่ใช่ 'add' ยอมรับเพราะกำแพงกันชนจริงสำคัญกว่าป้ายกำกับ
  v_product_id := analytics.product_upsert(
    p_shop_id, v_candidate, v_name, v_category, v_cost_type, v_unit_cost,
    v_silver_weight_g, v_silver_purity, v_labor_cost, v_list_price,
    v_barcode, v_supplier, v_note, true
  );

  product_id := v_product_id;
  sku := v_candidate;
  return next;
end;
$$;

revoke execute on function analytics.catalog_sku_create(uuid, uuid, text, jsonb) from public, anon;
grant execute on function analytics.catalog_sku_create(uuid, uuid, text, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
