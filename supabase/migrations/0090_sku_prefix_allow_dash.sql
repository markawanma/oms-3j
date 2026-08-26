-- 0090_sku_prefix_allow_dash.sql
-- ตรวจ catalog จริงหลัง apply 0089 พบว่า SKU ใน OMS ใช้ convention "มีขีดคั่น"
-- (B-01, B-20, AT-Caishen45) ส่วนตระกูล R10012PL/RP9963 ที่ design อ้างอิงอยู่บน
-- เว็บ Wix ไม่ได้อยู่ในตาราง public.product เลย — ถ้าพนักงานอยากตั้ง prefix ต่อ
-- ซีรีส์เดิม (เช่น "B-" ให้ได้ B-21 ต่อจาก B-20) รูปแบบ ^[A-Z]{1,5}$ ของ 0089
-- จะไม่ยอม จึงเปิดให้มี "-" ท้าย prefix ได้หนึ่งตัวแบบ optional: ^[A-Z]{1,5}-?$
-- (ยังกัน newline/ตัวเล็ก/ภาษาไทย/ขีดกลางคำ/ขีดล้วน เหมือนเดิม และ "-" เป็น
-- literal ใน regex ของ preview_seed ไม่มีช่อง injection)
--
-- ทดสอบบน DB จริงแล้ว (rollback): preview "B-" = 20 (ต่อจาก B-20 จริง) ·
-- catalog_sku_create ได้ B-21 · "B-C"/"--" ถูกปฏิเสธ · แบบไม่มีขีด RP+seed 9963
-- ได้ RP9964
--
-- แตะ: check constraint ของตาราง + sku_prefix_preview_seed + sku_prefix_upsert
-- (สองตัวที่ validate รูปแบบ prefix — catalog_sku_create ไม่ validate เองเพราะ
-- อ่านจาก config row จึงไม่ต้องแตะ) ทั้งคู่ plain replace signature เดิม + re-grant
-- (กับดักข้อ 2: grant ไม่รอด create or replace)

alter table analytics.sku_prefix drop constraint if exists sku_prefix_prefix_check;
alter table analytics.sku_prefix drop constraint if exists ck_sku_prefix_format;
alter table analytics.sku_prefix add constraint ck_sku_prefix_format check (prefix ~ '^[A-Z]{1,5}-?$');

create or replace function analytics.sku_prefix_preview_seed(
  p_shop_id uuid,
  p_prefix text
)
 returns int
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_max int;
begin
  if p_shop_id is null then
    raise exception 'sku_prefix_preview_seed: p_shop_id is required';
  end if;
  if p_prefix is null or p_prefix !~ '^[A-Z]{1,5}-?$' then
    raise exception 'sku_prefix_preview_seed: p_prefix must match ^[A-Z]{1,5}-?$ (uppercase letters 1-5 chars, optional trailing dash)'
      using errcode = '22023';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  select max((regexp_match(pr.sku, '^' || p_prefix || '([0-9]+)'))[1]::int)
    into v_max
    from public.product pr
   where pr.shop_id = p_shop_id;

  return coalesce(v_max, 0);
end;
$$;

revoke execute on function analytics.sku_prefix_preview_seed(uuid, text) from public, anon;
grant execute on function analytics.sku_prefix_preview_seed(uuid, text) to authenticated, service_role;

create or replace function analytics.sku_prefix_upsert(
  p_shop_id uuid,
  p_kind_label text,
  p_work_type text,
  p_prefix text,
  p_id uuid default null,
  p_seed_last_no int default null
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

  perform analytics.crm_require_owner_admin(p_shop_id);

  if p_id is null then
    if p_seed_last_no is null then
      raise exception 'sku_prefix_upsert: ต้องระบุ p_seed_last_no ตอนสร้าง config ใหม่ (เรียก sku_prefix_preview_seed แล้วให้ผู้ใช้ยืนยันก่อน)'
        using errcode = '22023';
    end if;

    begin
      insert into analytics.sku_prefix (shop_id, kind_label, work_type, prefix, created_by, updated_by)
      values (p_shop_id, v_kind_label, p_work_type, p_prefix, auth.uid(), auth.uid())
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
         set kind_label = v_kind_label, prefix = p_prefix, updated_by = auth.uid(), updated_at = now()
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

revoke execute on function analytics.sku_prefix_upsert(uuid, text, text, text, uuid, int) from public, anon;
grant execute on function analytics.sku_prefix_upsert(uuid, text, text, text, uuid, int) to authenticated, service_role;

notify pgrst, 'reload schema';
