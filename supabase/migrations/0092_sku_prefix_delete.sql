-- 0092_sku_prefix_delete.sql
-- UAT จริงของเจ้าของร้าน: สร้าง prefix แรก "แหวน · งานเกลี้ยง · RP" ผิด — convention
-- ร้านคือ RP = แหวนฝังพลอย (R = แหวนเกลี้ยง) กรอก work_type ผิดตั้งแต่ครั้งแรก
-- work_type ล็อกแก้ไม่ได้โดยตั้งใจ (0089/0091 — แก้แล้วความหมาย SKU เก่าเพี้ยน)
-- และไม่เคยมีทางลบ config เลย -> ผู้ใช้ติดกับดักตั้งแต่ครั้งแรกที่ใช้งานจริง แก้เอง
-- ไม่ได้ การล็อกถูกแล้ว แต่ขาดทางออก จึงเพิ่ม "ลบได้ถ้ายังไม่เคยออก SKU"
--
-- แตะ:
--   1) analytics.sku_prefix_delete (ใหม่) — ลบ config แถวเดียว + counter ของ
--      prefix นั้น ปฏิเสธถ้ามี SKU ใช้ prefix นี้แล้วแม้แถวเดียว
--   2) analytics.sku_prefix_upsert (แก้ signature เดิม 7 args ไม่เปลี่ยน — plain
--      replace + re-grant) — เปลี่ยนเกณฑ์ "มี SKU ใช้ prefix นี้อยู่ไหม" จาก
--      `like (prefix || '%')` เป็น regex `^prefix[0-9]+` ให้ตรงกับ
--      sku_prefix_preview_seed/catalog_sku_create (C-3PO เคยจับไว้ในรีวิว 1a ว่า
--      สองที่ในไฟล์เดียวนิยามไม่ตรงกัน) — body ที่เหลือลอกจาก 0091 คำต่อคำ
--      (definition ล่าสุด ไม่ใช่ 0089/0090 — pad_width ต้องอยู่ครบ)
--
-- ⚠️ กับดัก `like 'R%'`: จะจับ RP9963 (ตระกูล RP คนละ config) เข้ามาด้วย ทำให้
-- ลบ/แก้ prefix "R" ไม่ได้ทั้งที่ไม่มี SKU ของตระกูล R เองอยู่เลย ต้องใช้
-- `pr.sku ~ ('^' || v_row.prefix || '[0-9]+')` เท่านั้น — prefix การันตีว่าผ่าน
-- check constraint ^[A-Z]{1,5}-?$ มาแล้วเสมอ (มีแต่ [A-Z] และ "-" ท้ายตัวเดียว)
-- จึงเอาไปต่อ regex ตรงๆ ได้อย่างปลอดภัย ไม่มีช่อง regex injection (pattern เดียว
-- กับที่ sku_prefix_preview_seed ใช้มาตั้งแต่ 0089)
--
-- ทดสอบบน DB จริงแล้ว (do-block + raise บังคับ rollback, state ไม่ขยับ):
--  1) ลบ prefix ที่ยังไม่มี SKU -> สำเร็จ + แถว sku_counter หายไปด้วย
--  2) ลบ prefix ที่มี SKU แล้ว -> ปฏิเสธ พร้อมบอกจำนวน
--  3) ลบ prefix ของร้านอื่น / id มั่ว -> ปฏิเสธ "ไม่พบ config"
--  4) คนที่ไม่ใช่ owner/admin -> ปฏิเสธ (crm_require_owner_admin)
--  5) prefix "R" ที่มี SKU ตระกูล RP อยู่ (คนละ config) -> ลบได้ (regex ไม่จับ RP)
--  6) regression 0091: สร้าง+แก้ pad_width ยังทำงานครบ (pad guard lpad,
--     preview_seed คืน suggested_pad_width, catalog_sku_create เติมศูนย์ถูกต้อง)

-- ============================================================================
-- 1. analytics.sku_prefix_delete — ลบ config แถวเดียว ปฏิเสธถ้ามี SKU ใช้อยู่แล้ว
--    (ต่างจากแก้ prefix ที่ตัดสิทธิ์เฉพาะฟิลด์ prefix — ตัวนี้ลบทั้งแถวถาวร ต้อง
--    เข้มกว่า: เช็คด้วย regex เดียวกับที่ upsert/preview ใช้ตัดสิน "SKU ของ
--    prefix นี้")
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

  -- regex ตัดสิน "SKU ของ prefix นี้" ให้ตรงกับ sku_prefix_preview_seed/
  -- sku_prefix_upsert — ห้ามใช้ like (prefix || '%') เพราะ prefix "R" จะจับ
  -- "RP9963" (คนละ config ในตระกูล RP) มาด้วยและปิดทางลบ/แก้โดยไม่มีเหตุผลจริง
  select count(*) into v_sku_count
    from public.product pr
   where pr.shop_id = p_shop_id
     and pr.sku ~ ('^' || v_row.prefix || '[0-9]+');

  if v_sku_count > 0 then
    raise exception 'sku_prefix_delete: prefix % มี SKU ใช้งานแล้ว % รายการ — ลบไม่ได้ (ลบได้เฉพาะ config ที่ยังไม่เคยออก SKU)',
      v_row.prefix, v_sku_count
      using errcode = '22023';
  end if;

  delete from analytics.sku_prefix where id = p_id and shop_id = p_shop_id;
  -- ไม่มี SKU อ้างอิงอยู่แล้วถึงลบผ่านมาได้ -> counter ของ prefix นี้ไม่มีอะไร
  -- ต้องอ้างถึงต่ออีกแล้ว ลบทิ้งไปด้วยกันเป็น atomic เดียวกับการลบ config
  delete from analytics.sku_counter where shop_id = p_shop_id and prefix = v_row.prefix;
end;
$$;

revoke execute on function analytics.sku_prefix_delete(uuid, uuid) from public, anon;
grant execute on function analytics.sku_prefix_delete(uuid, uuid) to authenticated, service_role;

-- ============================================================================
-- 2. analytics.sku_prefix_upsert — signature เดิม 7 args ไม่เปลี่ยน (plain
--    replace พอ) body ลอกจาก 0091 คำต่อคำ ยกเว้นจุดเดียว: เกณฑ์เช็ค "มี SKU ใช้
--    prefix เดิมอยู่ไหม" ตอนแก้ prefix เปลี่ยนจาก `like (v_existing.prefix ||
--    '%')` (หลวมกว่า จับ RP เข้าไปตอนแก้ prefix "R") เป็น regex เดียวกับที่ใช้ใน
--    sku_prefix_delete/preview_seed ข้างบน — ทั้งไฟล์นิยาม "SKU ของ prefix นี้"
--    ตรงกันหมดแล้ว
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
      -- 0092: regex แทน like (prefix || '%') — เดิมจับ "RP9963" มาด้วยตอนแก้
      -- prefix "R" ทั้งที่เป็นคนละ config ในตระกูล RP (เกณฑ์เดียวกับ
      -- sku_prefix_delete/preview_seed)
      select count(*) into v_sku_count
        from public.product pr
       where pr.shop_id = p_shop_id
         and pr.sku ~ ('^' || v_existing.prefix || '[0-9]+');

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

notify pgrst, 'reload schema';
