-- 0091_sku_pad_width.sql
-- เจ้าของสั่ง: "เอาแบบเติมศูนย์ตาม convention เดิมด้วย" — catalog จริงใช้ B-01..B-20
-- (เลข 2 หลักเติมศูนย์) แต่ 0089/0090 ออกเลขไม่เติมศูนย์ ซีรีส์ B-07 ที่ค้างอยู่จะได้
-- B-8 ผิด convention จึงเพิ่ม pad_width ต่อ config (0 = ไม่เติม, n>0 = เติมศูนย์
-- จนครบ n หลัก) ให้พนักงานตั้งเองตอน sku_prefix_upsert แล้ว catalog_sku_create
-- เอาไปใช้ตอนประกอบเลข SKU
--
-- แตะ: analytics.sku_prefix (เพิ่มคอลัมน์) + sku_prefix_preview_seed (return type
-- เปลี่ยน → ต้อง drop ก่อน) + sku_prefix_upsert (เพิ่ม arg ท้ายสุด → overload ใหม่
-- → ต้อง drop signature เดิมก่อนเช่นกัน) + catalog_sku_create (signature เดิม
-- plain replace พอ)
--
-- ⚠️ กับดัก lpad ตัดเลขทิ้ง: lpad('100', 2, '0') คืน '10' ไม่ใช่ '100' — ถ้า pad
-- ตรงๆ ไม่มีเงื่อนไข เลขที่ยาวเกิน pad_width อยู่แล้วจะถูกตัดหางแล้วชนของเก่า/เพี้ยน
-- ถาวร (ตัวนับเป็น monotonic ไปแล้วด้วย) จึง guard ด้วย length(...) < pad_width
-- ก่อน lpad เสมอ — ดูคอมเมนต์ในจุดที่แก้ใน catalog_sku_create ข้างล่าง
--
-- ทดสอบบน DB จริงแล้ว (do-block + raise บังคับ rollback, state ไม่ขยับ):
--  1) pad 2, counter 7            -> X-08
--  2) pad 2, counter 99           -> X-100 (ไม่ใช่ X-10 — กัน lpad ตัด)
--  3) pad 2, มี X-08 อยู่แล้ว, counter 7 -> ข้ามไป X-09 (collision check ใช้
--     candidate ที่เติมศูนย์แล้ว)
--  4) pad 0, RP9963 อยู่แล้ว        -> RP9964 (regression เดิมไม่เปลี่ยน)
--  5) pad -1 / pad 7               -> reject ทั้งคู่ (check constraint + RPC gate)
--  6) preview "B-" บนข้อมูลจริง (B-01..B-20) -> seed 20, pad 2
--  7) preview prefix ที่ไม่มี SKU เลย -> seed 0, pad 0
--  8) gate เดิมของ 0090 ครบ: regex ^[A-Z]{1,5}-?$, work_type แก้ไม่ได้,
--     prefix แก้ได้เฉพาะไม่มี SKU ใช้, unique handler สองที่, counter greatest

-- ============================================================================
-- 1. คอลัมน์ pad_width — 0 = ไม่เติมศูนย์, n>0 = เติมศูนย์จนครบ n หลัก
-- ============================================================================

alter table analytics.sku_prefix
  add column if not exists pad_width int not null default 0
  check (pad_width >= 0 and pad_width <= 6);

comment on column analytics.sku_prefix.pad_width is
  '0091: ความกว้างเติมศูนย์ของเลข SKU — 0 = ไม่เติม, n>0 = เติมศูนย์หน้าจนครบ n หลัก
   (เฉพาะตอนตัวเลขสั้นกว่า n เท่านั้น ห้าม lpad ตรงๆ เพราะตัดเลขที่ยาวเกินทิ้ง)';

-- ============================================================================
-- 2. sku_prefix_preview_seed — return type เปลี่ยนจาก int เป็น
--    table(suggested_seed, suggested_pad_width) ต้อง drop ก่อน (Postgres ห้าม
--    เปลี่ยน return type ด้วย create or replace)
--
--    suggested_seed      = เดิม (max ตัวเลขหลัง prefix)
--    suggested_pad_width = ความยาวของ "string ตัวเลข" (ไม่ใช่ค่า int หลัง cast —
--                           cast แล้ว "07" -> 7 ความยาวหาย) ของ SKU ตัวที่เลข
--                           สูงสุด — วัดจาก captured text ก่อน cast เสมอ
-- ============================================================================

drop function if exists analytics.sku_prefix_preview_seed(uuid, text);

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

  -- เลือกแถวที่ตัวเลข (cast เป็น int) สูงสุด แล้วอ่านความยาวจาก string ที่ capture
  -- มาดิบๆ ก่อน cast (กัน "07" -> 7 หายความยาว) เสมอกันที่ค่า int ใช้ length มาก
  -- กว่าเป็นตัวตัดสิน (อนุรักษ์นิยม เติมศูนย์มากกว่าดีกว่าน้อยกว่า)
  select m.num_text::int, m.num_text
    into v_seed, v_num_text
    from (
      select (regexp_match(pr.sku, '^' || p_prefix || '([0-9]+)'))[1] as num_text
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
-- 3. sku_prefix_upsert — เพิ่ม p_pad_width int default null ต่อท้ายสุด (arg list
--    เปลี่ยน = overload ใหม่ ต้อง drop signature เดิมก่อน)
--
--    p_pad_width: null = ไม่แตะ (insert ใหม่ = 0, update = คงค่าเดิม) · มีค่า =
--    ต้องอยู่ 0-6 (not(between) กัน NaN เหมือนช่องอื่นในไฟล์นี้) แก้ pad_width
--    เปลี่ยนได้เสมอแม้มี SKU ใช้ prefix แล้ว — กระทบเฉพาะ SKU ที่จะออกในอนาคต
--    ไม่แตะของเก่า (ต่างจาก prefix เองที่ล็อกเมื่อมี SKU ใช้แล้ว)
--
--    body ที่เหลือลอกจาก 0090 คำต่อคำ — gate ทั้งหมดคงไว้ครบ (regex, work_type
--    แก้ไม่ได้, prefix แก้ได้เฉพาะไม่มี SKU ใช้, unique handler สองที่, counter
--    greatest)
-- ============================================================================

drop function if exists analytics.sku_prefix_upsert(uuid, text, text, text, uuid, int);

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

  -- not(between) กัน NaN/negative/เกินเพดาน (บทเรียน 0083) — null ผ่านได้ (แปลว่า
  -- ไม่แก้), มีค่าแล้วต้องอยู่ 0-6 เท่านั้น
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
      select count(*) into v_sku_count
        from public.product pr
       where pr.shop_id = p_shop_id and pr.sku like (v_existing.prefix || '%');

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
-- 4. catalog_sku_create — signature เดิม (uuid, uuid, text, jsonb) ไม่เปลี่ยน จึง
--    plain replace พอ (ไม่ต้อง drop) แต่ยังต้อง re-grant เพราะ grant หายทุกครั้ง
--    ที่ replace ฟังก์ชัน (กับดักข้อ 2) — body เหมือน 0089 ทุกจุด ยกเว้นตอนประกอบ
--    candidate ที่เพิ่มการเติมศูนย์แบบมี guard
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

  perform analytics.crm_require_owner_admin(p_shop_id);

  select * into v_prefix_row
    from analytics.sku_prefix
   where id = p_prefix_id and shop_id = p_shop_id;
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

  -- ไล่หาเลขที่ไม่ชน SKU เดิมใน catalog แล้วเติมศูนย์ตาม pad_width ของ config
  -- (0091) — ⚠️ ห้าม lpad ตรงๆ ไม่มีเงื่อนไข: lpad('100', 2, '0') คืน '10' คือ
  -- "ตัด" เลขที่ยาวเกิน pad_width ทิ้ง ไม่ใช่ปัดขึ้น ถ้าไม่ guard ด้วย length(...)
  -- ก่อน เลข 100 จะถูกเขียนเป็น 10 แล้วชนของเก่า/เพี้ยนถาวร (ตัวนับเดินหน้าไปแล้ว
  -- ด้วย) จึงเติมศูนย์เฉพาะตอนตัวเลขสั้นกว่า pad_width จริงๆ เท่านั้น
  for v_i in 1..20 loop
    v_num_text := (v_last_no + v_i)::text;
    if v_prefix_row.pad_width > 0 and length(v_num_text) < v_prefix_row.pad_width then
      v_num_text := lpad(v_num_text, v_prefix_row.pad_width, '0');
    end if;
    v_candidate := v_prefix_row.prefix || v_num_text;
    if not exists (select 1 from public.product pr where pr.shop_id = p_shop_id and pr.sku = v_candidate) then
      v_final_no := v_last_no + v_i;
      v_found := true;
      exit;
    end if;
  end loop;

  if not v_found then
    raise exception 'catalog_sku_create: หาเลข SKU ว่างให้ prefix % ไม่ได้ภายใน 20 รอบ — ไปตรวจตัวนับที่หน้า /catalog/sku-prefix',
      v_prefix_row.prefix
      using errcode = '22023';
  end if;

  update analytics.sku_counter
     set last_no = v_final_no
   where shop_id = p_shop_id and prefix = v_prefix_row.prefix;

  -- แกะ p_attrs เป็น field ที่ product_upsert เดิมรองรับ (pattern เดียวกับ
  -- product_upsert_bulk 0031) — p_attrs เป็น null ได้ ->> บน null jsonb คืน null เฉยๆ
  v_category        := nullif(btrim(coalesce(p_attrs ->> 'category', '')), '');
  v_cost_type        := coalesce(nullif(btrim(p_attrs ->> 'cost_type'), ''), 'fixed');
  v_unit_cost        := nullif(btrim(coalesce(p_attrs ->> 'unit_cost', '')), '')::numeric;
  v_silver_weight_g  := nullif(btrim(coalesce(p_attrs ->> 'silver_weight_g', '')), '')::numeric;
  v_silver_purity    := nullif(btrim(coalesce(p_attrs ->> 'silver_purity', '')), '')::numeric;
  v_labor_cost       := nullif(btrim(coalesce(p_attrs ->> 'labor_cost', '')), '')::numeric;
  v_list_price       := nullif(btrim(coalesce(p_attrs ->> 'list_price', '')), '')::numeric;
  v_barcode          := nullif(btrim(coalesce(p_attrs ->> 'barcode', '')), '');
  v_supplier         := nullif(btrim(coalesce(p_attrs ->> 'supplier', '')), '');
  v_note             := nullif(btrim(coalesce(p_attrs ->> 'note', '')), '');

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
