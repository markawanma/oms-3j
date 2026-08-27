-- 0089_sku_prefix.sql
-- Phase 1a — Quote Email + Product Image + SKU Generator (Email/SKU/Image project)
-- Design: docs/3j-jewelry/oem/design-email-sku-phase1.md (Yoda, อนุมัติแล้ว)
--
-- ขอบเขตไฟล์นี้: เฉพาะ 1a (SKU generator) เท่านั้น — ไม่แตะ product_image /
-- oem_email_log (อยู่ 0090/0091) และไม่แตะตาราง/ฟังก์ชัน OEM ใดๆ ทั้งสิ้น
--
-- ============ หลักการเดียวที่คุมทั้งไฟล์ ============
-- SKU ใหม่ต้อง "ไม่มีทางชนกัน" แม้สองคนกดสร้างพร้อมกัน (row lock บน sku_counter)
-- และต้อง "ไม่มีทางชน SKU เก่าที่มีอยู่แล้วใน catalog" (ตรวจ public.product ก่อน
-- ยืนยันทุกครั้ง แล้วขยับเลขข้ามไปเรื่อยๆ ถ้าชน) — SKU ไม่ใช่เอกสารกฎหมายเหมือน
-- oem_doc_counter จึงไม่มี deny-mutation trigger และเลขข้ามได้ (ต่างจาก 0084/0087/0088
-- โดยตั้งใจ)
--
-- ============ สร้าง/แก้ product จริงผ่าน product_upsert เดิมเท่านั้น (ไม่แก้ไฟล์นั้นเลย) =
-- signature จริงที่ตรวจแล้วจาก DB migration ล่าสุด (0031_catalog_management.sql,
-- ไม่มี migration ไหนหลัง 0032 มา create-or-replace ทับซ้ำอีก — grep ยืนยันแล้ว):
--   analytics.product_upsert(
--     p_shop_id uuid, p_sku text, p_name text,
--     p_category text default null, p_cost_type text default 'fixed',
--     p_unit_cost numeric default null, p_silver_weight_g numeric default null,
--     p_silver_purity numeric default null, p_labor_cost numeric default null,
--     p_list_price numeric default null, p_barcode text default null,
--     p_supplier text default null, p_note text default null,
--     p_is_active boolean default true
--   ) returns uuid
-- upsert บน unique (shop_id, sku) (constraint uq_product_shop_sku จาก 0001) — insert
-- ให้แน่ใจก่อนเรียกว่า sku ที่จะส่งไปยังไม่มีอยู่จริง มิฉะนั้นจะกลายเป็น "แก้ของเดิม
-- เงียบๆ" แทนที่จะเป็นสินค้าใหม่
--
-- ============ ขอบเขต ============
-- 1) analytics.sku_prefix   — config พนักงานกรอกเอง ไม่มี seed hardcode
-- 2) analytics.sku_counter  — ตัวนับต่อ (shop_id, prefix) แบบ oem_doc_counter แต่
--                              ไม่มี deny-mutation trigger (ดูหลักการข้างบน)
-- 3) analytics.sku_prefix_preview_seed  — เลขแนะนำจาก SKU เดิมใน catalog
-- 4) analytics.sku_prefix_upsert        — สร้าง/แก้ config (ดู §2 ท้ายไฟล์นี้สำหรับ
--    เงื่อนไข "แก้อะไรได้บ้าง" ซึ่งกำกวมในเอกสารต้นทาง — ดูคำอธิบายละเอียดที่ฟังก์ชัน)
-- 5) analytics.catalog_sku_create       — ออก SKU ใหม่ + เรียก product_upsert
-- ============================================================================

-- ============================================================================
-- 1. analytics.sku_prefix — config prefix ต่อ (kind_label, work_type) พนักงานกรอกเอง
--    ไม่มี seed hardcode ใดๆ ในไฟล์นี้ RLS select owner/admin (เหมือน oem_customer/
--    oem_receipt) เขียนได้ทาง sku_prefix_upsert เท่านั้น
-- ============================================================================

create table if not exists analytics.sku_prefix (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shop (id) on delete cascade,
  kind_label  text not null,                       -- ป้ายที่พนักงานเห็น เช่น "แหวน"
  work_type   text not null check (work_type in ('plain', 'gem')),
  prefix      text not null check (prefix ~ '^[A-Z]{1,5}$'),  -- ตัวพิมพ์ใหญ่ล้วน 1-5 ตัว
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_by  uuid,
  updated_at  timestamptz not null default now(),
  constraint uq_sku_prefix_shop_kind_work unique (shop_id, kind_label, work_type),
  constraint uq_sku_prefix_shop_prefix unique (shop_id, prefix)
);

create index if not exists idx_sku_prefix_shop_id on analytics.sku_prefix (shop_id);

comment on table analytics.sku_prefix is
  '0089: config prefix SKU ต่อ (kind_label, work_type) — พนักงานกรอกเอง ไม่มีค่าเริ่มต้นจาก
   ระบบ เขียนได้ทาง analytics.sku_prefix_upsert เท่านั้น (ไม่มี insert/update policy)
   prefix ตรวจด้วย check constraint ^[A-Z]{1,5}$ ซ้ำกับที่ RPC ตรวจอีกชั้น (defense-in-depth
   กันคนเรียก DDL ตรงข้าม RPC ในอนาคต)';

alter table analytics.sku_prefix enable row level security;

drop policy if exists owner_admin_select on analytics.sku_prefix;
create policy owner_admin_select on analytics.sku_prefix
  for select
  using (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

grant select on analytics.sku_prefix to authenticated, service_role;

-- ============================================================================
-- 2. analytics.sku_counter — ตัวนับ SKU ต่อ (shop_id, prefix) — pattern เดียวกับ
--    oem_doc_counter (0084): row lock ผ่าน insert..on conflict..returning ภายใน
--    transaction เดียวกับงานที่ต้องใช้เลข แต่ **ไม่มี deny-mutation trigger** —
--    SKU ไม่ใช่เอกสารทางกฎหมาย เลขข้ามได้ (ต่างจาก oem_doc_counter โดยตั้งใจ)
--    RLS เปิดแต่ไม่มี policy และไม่ grant ให้ authenticated/anon เลย — เข้าถึงได้
--    เฉพาะภายใน sku_prefix_upsert / catalog_sku_create (security definer)
-- ============================================================================

create table if not exists analytics.sku_counter (
  shop_id  uuid not null references public.shop (id) on delete cascade,
  prefix   text not null,
  last_no  int  not null default 0,
  primary key (shop_id, prefix)
);

alter table analytics.sku_counter enable row level security;
-- ไม่มี create policy บรรทัดไหนเลยในไฟล์นี้โดยตั้งใจ (เหมือน oem_doc_counter)

comment on table analytics.sku_counter is
  '0089: ตัวนับเลข SKU ถัดไปต่อ (shop_id, prefix) — ต่างจาก analytics.oem_doc_counter
   ตรงที่ "เลขข้ามได้" (ไม่มี deny-mutation trigger) เพราะ SKU ไม่ใช่เอกสารกฎหมาย
   RLS เปิดแต่ไม่มี policy/grant — เข้าถึงได้เฉพาะผ่าน sku_prefix_upsert (seed) และ
   catalog_sku_create (ออกเลขจริง) ซึ่งทั้งคู่ security definer';

-- ============================================================================
-- 3. analytics.sku_prefix_preview_seed — เลขแนะนำจาก SKU เดิมที่มีอยู่แล้วใน
--    catalog (สำหรับ prefix ที่ "ยังไม่เคยมี config" — พนักงานพิมพ์ prefix ที่คิด
--    ไว้ ระบบไปไล่ดู SKU เดิมที่ขึ้นต้นด้วย prefix นั้นแล้วเดาเลขถัดไปให้ แต่ไม่ auto
--    ใช้ — UI ต้องให้คนยืนยัน/แก้ก่อนเสมอ)
--
--    ⚠️ p_prefix ไม่ผ่านการ trim/แปลงใดๆ ก่อน validate — ต้อง reject ตรงๆ ถ้ามี
--    space/newline/ตัวพิมพ์เล็ก/ภาษาไทย ไม่ใช่แก้ให้เงียบๆ แล้วค่อยใช้ต่อ (ถ้าแก้ให้
--    เงียบๆ คนจะเห็นเลขแนะนำที่ไม่ตรงกับ prefix ที่เขาจะเซฟจริงตอน upsert)
--    prefix ผ่าน check นี้แล้วการันตีว่ามีแต่ [A-Z] เท่านั้น — เอาไปต่อ regex ตรงๆ
--    ได้อย่างปลอดภัย ไม่มีช่อง regex injection
-- ============================================================================

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
  if p_prefix is null or p_prefix !~ '^[A-Z]{1,5}$' then
    raise exception 'sku_prefix_preview_seed: p_prefix must match ^[A-Z]{1,5}$ (uppercase letters only, 1-5 chars)'
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
-- grant authenticated ตรงนี้เพราะ UI เรียก RPC นี้ตรงจากหน้า config (dialog พิมพ์
-- prefix แล้วขอเลขแนะนำสด) ไม่ได้ถูกเรียกผ่านฟังก์ชันอื่นเป็น internal helper
grant execute on function analytics.sku_prefix_preview_seed(uuid, text) to authenticated, service_role;

-- ============================================================================
-- 4. analytics.sku_prefix_upsert — สร้าง/แก้ config หนึ่งแถว ระบุแถวด้วย p_id ตรงๆ
--    (Tech Lead แก้ signature ให้หลัง code review รอบแรก — เดิมพยายามเดาแถวจาก
--    kind_label/prefix ซึ่งกำกวมกับตัวเองและจะ mismatch กับ action ฝั่ง Luke ที่ส่ง
--    id มาอยู่แล้ว ตอนนี้ตัด branch เดาทิ้งทั้งหมด ระบุแถวด้วย p_id เท่านั้น)
--
--    p_id null      = insert ใหม่ (บังคับ p_seed_last_no ไม่เป็น null)
--    p_id มีค่า      = update แถวนั้นตรงๆ (เช็ค shop_id ด้วยกันข้ามร้าน)
--      - kind_label แก้ได้เสมอ
--      - work_type แก้ไม่ได้เลย ไม่มีข้อยกเว้น (เข้มกว่า design เดิม — ตัดสินใจ
--        ไว้ตั้งแต่รอบก่อน ยืนยันอีกครั้งว่ายังเป็นแบบนี้)
--      - prefix แก้ได้เฉพาะเมื่อไม่มี product ที่ sku ขึ้นต้นด้วย prefix
--        เดิมเท่านั้น (มี product ใช้แล้ว = reject) แก้สำเร็จ = ลบ counter ของ
--        prefix เดิมทิ้ง (ไม่มี SKU อ้างอิงอยู่แล้วถึงแก้ผ่านมาได้
--        ไม่มีอะไรต้อง migrate)
--    unique ชนกัน (ทั้งสองทาง insert/update) จับด้วย exception handler แล้ว
--    แปลงเป็นข้อความอ่านรู้เรื่อง ไม่ปล่อย constraint ดิบ (SQLSTATE 23505 +
--    ชื่อ constraint บอกไม่ได้ว่าฟิลด์ไหนซ้ำ) — ใช้ GET STACKED DIAGNOSTICS
--    อ่านชื่อ constraint ที่ตั้งไว้ explicit แล้วข้างบน
--    (uq_sku_prefix_shop_prefix / uq_sku_prefix_shop_kind_work)
--
--    seed: สร้างใหม่บังคับไม่เป็น null · แก้ของเดิมส่งมาด้วยก็รับ (เผื่อแก้ prefix
--    ที่ยังไม่เคยมี SKU มาก่อน) เข้า sku_counter แบบ greatest (ไม่ทับของเดิมที่มากกว่า)
--
--    ⚠️ หมายเหตุ signature: พารามิเตอร์ที่มี default ต้องอยู่ท้ายสุดตาม syntax
--    ของ Postgres เท่านั้น (ประกาศพารามิเตอร์ที่มี default แล้วตามด้วยตัวที่ไม่มี
--    default จะ CREATE FUNCTION ไม่ผ่านเลย ไม่ใช่แค่ static-review — รันจริงจะ error ทันที)
--    จึงย้าย p_id ไปอยู่ก่อน p_seed_last_no (ทั้งคู่ default null ท้ายสุด) แทนที่จะ
--    แทรกกลางตามที่เสนอมา — ไม่กระทบการเรียกจาก Luke เลย เพราะ Supabase
--    RPC เรียกด้วย named parameter (JSON object) เสมอ ไม่ใช่ positional ลำดับ
--    พารามิเตอร์จึงไม่มีผลกับโค้ดฝั่ง action ที่ระบุชื่อ p_id/p_seed_last_no
--    ตรงๆอยู่แล้ว
-- ============================================================================

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

  -- ห้าม trim/uppercase ก่อนตรวจ — reject ตรงๆ ถ้ามี space/newline/ตัวเล็ก/ภาษาไทย
  if p_prefix is null or p_prefix !~ '^[A-Z]{1,5}$' then
    raise exception 'sku_prefix_upsert: p_prefix must match ^[A-Z]{1,5}$ (uppercase letters only, 1-5 chars)'
      using errcode = '22023';
  end if;

  -- not(between) กัน NaN/negative/เกินเพดาน แม้ type เป็น int จะกัน NaN ให้แล้ว
  -- ตั้งแต่ cast ชั้น PostgREST ก็ตาม (บทเรียน 0083) — เขียนไว้เผื่อ type เปลี่ยน
  if p_seed_last_no is not null and not (p_seed_last_no >= 0 and p_seed_last_no <= 1000000) then
    raise exception 'sku_prefix_upsert: p_seed_last_no must be between 0 and 1,000,000' using errcode = '22023';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  if p_id is null then
    -- ---- insert ใหม่ — บังคับ seed ----
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
    -- ---- update แถวเดิมตรงๆ ด้วย p_id (เช็ค shop_id กันข้ามร้าน) ----
    select * into v_existing
      from analytics.sku_prefix
     where id = p_id and shop_id = p_shop_id
     for update;
    if not found then
      raise exception 'sku_prefix_upsert: ไม่พบ config id % ในร้านนี้', p_id using errcode = '22023';
    end if;

    -- work_type เปลี่ยนไม่ได้เลย ไม่มีข้อยกเว้น
    if v_existing.work_type <> p_work_type then
      raise exception 'sku_prefix_upsert: work_type ของ config นี้เปลี่ยนไม่ได้ (เดิม % ส่งมา %)',
        v_existing.work_type, p_work_type
        using errcode = '22023';
    end if;

    -- แก้ prefix ได้เฉพาะยังไม่มี SKU ผูกกับ prefix เดิม
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

  -- seed เข้า counter แบบ greatest — ไม่ทับของเดิมที่มากกว่า
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

-- ============================================================================
-- 5. analytics.catalog_sku_create — ออก SKU ใหม่จาก config ที่มีอยู่แล้ว แล้วเรียก
--    product_upsert เดิมเพื่อสร้างแถว product จริง (ได้ audit log ของ catalog_audit_log
--    ฟรีเพราะ product_upsert เขียนไว้แล้วตั้งแต่ 0031)
--
--    lock sku_counter row (ensure-then-lock ในสเตตเมนต์เดียว) -> loop <=20 หา
--    candidate เลขที่ยังไม่ชน SKU เดิมใน public.product -> persist last_no ตัวที่
--    ใช้จริง -> product_upsert -> คืน (product_id, sku)
--
--    p_attrs เป็น bag ทางเลือก map เข้า field ที่ product_upsert เดิมรองรับอยู่แล้ว
--    (category/cost_type/unit_cost/silver_weight_g/silver_purity/labor_cost/
--    list_price/barcode/supplier/note) — validation ตัวเลขทั้งหมดไปเกิดที่
--    product_upsert เดิมอยู่แล้ว (unit_cost/labor_cost/list_price >= 0, silver_purity
--    in (0,1], spot ต้องมี silver_weight_g > 0) ไม่ต้องซ้ำ logic ที่นี่
--
--    ⚠️ OUT vars ของ RETURNS TABLE คือ product_id/sku — ชนกับชื่อคอลัมน์จริงของ
--    public.product ถ้าอ้างแบบไม่ qualify (บทเรียน Supabase gotcha #2, 42702) จึง
--    alias public.product เป็น pr ทุกจุดในฟังก์ชันนี้
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

  -- ไล่หาเลขที่ไม่ชน SKU เดิมใน catalog (ไม่ pad zero) — ข้ามเลขที่ชนไปเรื่อยๆ
  for v_i in 1..20 loop
    v_candidate := v_prefix_row.prefix || (v_last_no + v_i)::text;
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
