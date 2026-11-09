-- 0196_ring_builder.sql — Ring Builder P1 (หน้า "ออกแบบแหวนแถวเอง" /ring-builder): ทรงพลอย · แบบแหวน · ราคาตัวเรือน · พลอยสำหรับขาย · ราคาพลอยตามทรง×ขนาด · RPC สาธารณะ (INVOKER) · RPC หลังบ้าน (DEFINER) · bucket รูปการ์ด
-- สถานะ: ยังไม่ apply · dry-run เท่านั้น · apply ด้วย node scripts/run-sql.mjs --commit --record เท่านั้น (🔴 ห้าม supabase db push) · ชุดทดสอบ scripts/verify/verify-0196.sql · ไฟล์ต้องเป็น LF (ข้อ 20)
-- design: docs/3j-jewelry/oms/design-ring-builder.md — §16.0 มติเจ้าของ (ทับทุกอย่าง) > §16 delta > §2 §3 §4 §8 §9 §15 · หน้าจอหลังบ้าน: ring-builder-handoff/screens/Admin*.dc.html
--
-- ทำไม (ภาษาคน): ลูกค้าออกแบบแหวนแถวเอง (เลือกจำนวนเม็ด → แบบ → พลอยทีละเม็ด → ไซซ์) แล้วส่งรหัส+รูปสรุปเข้า LINE · "ราคาที่ผูกพัน" ต้องคิดที่ DB ณ วินาทีที่ออกรหัส
--   และต้องตรวจย้อนได้ว่ารหัสเก่าราคาเท่าไรตอนสร้าง ⇒ ราคาทุกชนิดเป็นแบบ effective-dated insert-only (แก้/ลบ = ล้ม) · รหัสไม่เก็บใน DB (stateless HMAC ฝั่ง TS) ⇒ ไม่มีช่องเขียนสาธารณะเลย
--
-- สิ่งที่ไฟล์นี้ทำ
--  1. ตาราง analytics.rb_gem_shape · rb_design · rb_design_price · rb_stone · rb_stone_offer · rb_offer_price (RLS เปิดไม่มี policy · เขียนผ่าน RPC definer เท่านั้น)
--  2. trigger: ราคา insert-only (UPDATE/DELETE/TRUNCATE ล้ม) · ห้ามลบแถวทุกตาราง (soft เท่านั้น) · ล็อกแบบหลัง publish (design_no · stone_count · ทรง · ขนาดเม็ด · ทิศเม็ดไข่)
--     · ห้ามแก้ render_kind ของทรง · ห้ามแก้ stone_no/มิติของ offer · round ต้อง major = minor · oval ต้อง major > minor (ตรวจใน trigger เพราะ CHECK ข้ามตารางไม่ได้ — render_kind แก้ไม่ได้ ผลตรวจจึงไม่เน่า)
--  3. RPC สาธารณะ (SECURITY INVOKER · เรียกโดย service_role): rb_public_catalog · rb_quote — กำแพงต้นทุน = service_role "ไม่มีสิทธิ์" อ่าน analytics.gem_item_price (0190 revoke ไว้) ⇒ ถ้าวันหน้ามีคน join ตารางต้นทุนเข้ามาได้ 42501 ไม่ใช่ข้อมูลรั่ว
--  4. RPC หลังบ้าน (SECURITY DEFINER · ตรวจ actor owner/admin): rb_shape_upsert · rb_stone_upsert · rb_offer_upsert · rb_offer_price_set · rb_design_upsert · rb_design_price_set · rb_design_card_set ·
--     rb_design_publish · rb_design_duplicate · rb_set_active · rb_admin_catalog (coverage "ขายได้ x/y แบบ · ขาดเพราะ…") · rb_code_check
--  5. storage bucket 'ring-builder' (public read · 1 MB · image/jpeg · ไม่มี storage policy — เขียนผ่าน service role เท่านั้น)
--  6. สิทธิ์: service_role เท่านั้น (ข้อ 2/7/18) · ตาราง = select เท่านั้น (ไม่มี insert/update/delete/truncate/maintain) · ฟังก์ชัน = execute เฉพาะ RPC
--
-- ตัดสินเอง (นอก design/brief — เหตุผล)
--  (1) effective_from ของราคาใหม่ = date_trunc('second', clock_timestamp()) + 1 วินาที และ rb_quote คิดราคา ณ date_trunc('second', clock_timestamp()) — ใช้ clock_timestamp() ไม่ใช่ now()
--      เหตุผล: now() = เวลาเริ่มทรานแซกชัน (ข้อ 22) — ทรานแซกชันแอดมินที่ค้างนานจะตั้งราคาย้อนเข้าไปในอดีตหลังจากลูกค้าได้รหัสไปแล้ว ⇒ ราคาที่ตรวจย้อนไม่ตรงกับที่ลูกค้าเห็น
--  (2) rb_public_catalog / rb_quote มีพารามิเตอร์ p_at (default null = ตอนนี้) — route สาธารณะไม่ส่ง · ใช้ในชุดทดสอบและ rb_code_check เพื่อคิดราคา ณ วินาทีใดก็ได้ (dry-run อยู่ทรานแซกชันเดียว เวลาไม่ขยับเอง)
--  (3) rb_require_office เป็นของไฟล์นี้เอง (ลอกตรรกะเดียวกับ gem_require_office ของ 0190: crm_require_owner_admin + actor ต้องเป็นสมาชิก owner/admin จริง) — ไม่พึ่งฟังก์ชันภายในของ 0190 เพื่อให้ migration นี้ไม่ผูกกับลำดับ apply
--  (4) ช่วงไซซ์ร้านอยู่ที่ analytics.rb_size_range() (45–68) ⇔ RING_BUILDER_SIZES ใน lib/ring-builder/config.ts ⇔ SHOP_RING_SIZES ของ /ring-size — parity test ล็อกทั้งสามที่ · ไม่แก้ /ring-size
--  (5) rb_stone.name_th ห้ามซ้ำ (norm) ต่อร้าน · ไม่มี group/cut (ตัดตาม §16) · ไม่มี rb_design_photo (ใช้ card_image_path รูปเดียวตาม §16) · รูปการ์ดไม่บังคับ (N3 ยังค้าง)
--  (6) แบบใหม่เป็น draft เสมอ (is_active=false · published_at null) — เปิดขายได้ทาง rb_design_publish ทางเดียว (ตรวจราคา/ทรงเปิดอยู่) · CHECK: is_active ⇒ published_at not null
--  (7) rb_offer_upsert สลับ major/minor ให้เป็น canonical (major ≥ minor) ก่อน — 3×4 กับ 4×3 เป็นแถวเดียวกัน (X13) · key ซ้ำกับแถวที่ปิดไว้ = เปิดแถวเดิม (ประวัติราคาต่อเนื่อง)
--  (8) ไม่ validate "ความยาวแถวไม่เกินครึ่งเส้นรอบวง" (design §5.1) — ต้องมี gap/ความหนาตัวเรือนซึ่ง P1 ไม่มี · ค้างเป็นหนี้ (ถาม Q1: 7 เม็ดไข่ 4×3 ที่เบอร์ 45 ทำได้จริงไหม)
--  (9) รูปการ์ด path = designs/<uuid สุ่ม>.jpg (ไม่ใช่ design_no) — แบบที่ยังไม่ publish ไม่เดา URL ได้ (bucket เปิดอ่านสาธารณะ)
--
-- post-check: ไม่มี overload · ไม่มีสิทธิ์ anon/authenticated/PUBLIC · service_role select ตารางได้อย่างเดียว · bucket ตั้งค่าถูก

set local lock_timeout = '8s';

do $pre$
begin
  if to_regclass('public.shop') is null or to_regclass('public.shop_member') is null
     or to_regprocedure('analytics.crm_require_owner_admin(uuid)') is null then
    raise exception '0196: ไม่พบ public.shop / public.shop_member / analytics.crm_require_owner_admin — ตรวจลำดับ migration';
  end if;
  if to_regclass('storage.buckets') is null then
    raise exception '0196: ไม่พบ storage.buckets';
  end if;
end;
$pre$;

-- ============================================================================
-- 1. ฟังก์ชันบริสุทธิ์ (immutable)
-- ============================================================================
-- ช่วงไซซ์ร้าน [45,68] — แหล่งเดียวใน DB ⇔ RING_BUILDER_SIZES (lib/ring-builder/config.ts) ⇔ SHOP_RING_SIZES (lib/ring-size/config.ts) · แก้คู่เสมอ
create or replace function analytics.rb_size_range() returns int4range
  language sql immutable
as $f$select int4range(45, 68, '[]')$f$;

-- ข้อความที่ลูกค้า/แอดมินเห็น: ไม่มีช่องว่างหัวท้าย · ไม่มี control/ล่องหน/bidi/ช่องว่างแปลก · ต้องมีตัวอักษรหรือตัวเลขจริง ≥ 1 (whitelist ไม่ใช่ blacklist — oem-quote-invariants 6.2)
create or replace function analytics.rb_text_ok(p_t text, p_min integer, p_max integer) returns boolean
  language sql immutable
as $f$
  select p_t is not null
     and p_t = btrim(p_t)
     and char_length(p_t) between p_min and p_max
     and p_t !~ '[[:cntrl:] ­ᅟᅠ᠎ -‏ -  -⁯⠀　ㅤ️﻿]'
     and p_t ~ '[[:alnum:]]'
$f$;

-- ============================================================================
-- 2. ตาราง (สคีมา analytics · RLS เปิดไม่มี policy)
-- ============================================================================
create table if not exists analytics.rb_gem_shape (
  id                uuid primary key default gen_random_uuid(),
  shop_id           uuid not null references public.shop (id) on delete restrict,
  name_th           text not null,
  name_norm         text generated always as (lower(btrim(name_th))) stored,
  render_kind       text not null,
  is_active         boolean not null default true,
  sort              integer not null default 0,
  created_at        timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  constraint rb_gem_shape_id_shop_uq unique (id, shop_id),
  constraint rb_gem_shape_kind_ck check (render_kind in ('round', 'oval')),
  constraint rb_gem_shape_name_ck check (analytics.rb_text_ok(name_th, 1, 20)),
  constraint rb_gem_shape_sort_ck check (sort between -1000 and 100000)
);
create unique index if not exists uq_rb_gem_shape_name on analytics.rb_gem_shape (shop_id, name_norm);

create table if not exists analytics.rb_design (
  id                uuid primary key default gen_random_uuid(),
  shop_id           uuid not null references public.shop (id) on delete restrict,
  design_no         smallint not null,
  name              text not null,
  stone_count       smallint not null,
  shape_id          uuid not null,
  stone_major_mm100 smallint not null,
  stone_minor_mm100 smallint not null,
  stone_axis        text,
  size_min          smallint not null,
  size_max          smallint not null,
  card_image_path   text,
  model             jsonb,
  is_active         boolean not null default false,
  published_at      timestamptz,
  status_changed_at timestamptz not null default now(),
  sort              integer not null default 0,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  constraint rb_design_id_shop_uq unique (id, shop_id),
  constraint rb_design_no_uq unique (shop_id, design_no),
  constraint rb_design_shape_fk foreign key (shape_id, shop_id) references analytics.rb_gem_shape (id, shop_id) on delete restrict,
  constraint rb_design_no_ck check (design_no between 1 and 4095),
  constraint rb_design_name_ck check (analytics.rb_text_ok(name, 1, 40)),
  constraint rb_design_count_ck check (stone_count between 3 and 7),
  constraint rb_design_major_ck check (stone_major_mm100 between 50 and 2000),
  constraint rb_design_minor_ck check (stone_minor_mm100 between 50 and 2000),
  constraint rb_design_major_minor_ck check (stone_major_mm100 >= stone_minor_mm100),
  constraint rb_design_axis_ck check (stone_axis is null or stone_axis in ('along_row', 'across_row')),
  constraint rb_design_size_min_ck check (analytics.rb_size_range() @> size_min::integer),
  constraint rb_design_size_max_ck check (analytics.rb_size_range() @> size_max::integer),
  constraint rb_design_size_order_ck check (size_min <= size_max),
  constraint rb_design_card_ck check (card_image_path is null or card_image_path ~ '^designs/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'),
  constraint rb_design_model_ck check (model is null or jsonb_typeof(model) = 'object'),
  constraint rb_design_active_pub_ck check (published_at is not null or not is_active),
  constraint rb_design_sort_ck check (sort between -1000 and 100000)
);
create unique index if not exists uq_rb_design_card_path on analytics.rb_design (card_image_path) where card_image_path is not null;
-- X15: แบบที่เปิดอยู่ 2 แบบ ชื่อซ้ำในจำนวนเม็ดเดียวกัน (ไม่สนตัวพิมพ์) ไม่ได้ — แบบปิดแล้วซ้ำได้
create unique index if not exists uq_rb_design_active_name on analytics.rb_design (shop_id, stone_count, lower(name)) where is_active;
create index if not exists idx_rb_design_shape on analytics.rb_design (shape_id);

create table if not exists analytics.rb_design_price (
  design_id      uuid not null references analytics.rb_design (id) on delete restrict,
  effective_from timestamptz not null,
  body_price_thb integer not null,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  primary key (design_id, effective_from),
  constraint rb_design_price_ck check (body_price_thb between 1 and 1000000)
);

create table if not exists analytics.rb_stone (
  id                uuid primary key default gen_random_uuid(),
  shop_id           uuid not null references public.shop (id) on delete restrict,
  stone_no          smallint not null,
  name_th           text not null,
  name_norm         text generated always as (lower(btrim(name_th))) stored,
  short_name        text not null,
  color_hex         text not null,
  is_active         boolean not null default true,
  sort              integer not null default 0,
  created_at        timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  constraint rb_stone_id_shop_uq unique (id, shop_id),
  constraint rb_stone_no_uq unique (shop_id, stone_no),
  constraint rb_stone_no_ck check (stone_no between 1 and 1023),
  constraint rb_stone_name_ck check (analytics.rb_text_ok(name_th, 1, 40)),
  constraint rb_stone_short_ck check (analytics.rb_text_ok(short_name, 1, 6)),
  constraint rb_stone_color_ck check (color_hex ~ '^#[0-9A-F]{6}$'),
  constraint rb_stone_sort_ck check (sort between -1000 and 100000)
);
create unique index if not exists uq_rb_stone_name on analytics.rb_stone (shop_id, name_norm);

create table if not exists analytics.rb_stone_offer (
  id                uuid primary key default gen_random_uuid(),
  shop_id           uuid not null references public.shop (id) on delete restrict,
  stone_id          uuid not null,
  shape_id          uuid not null,
  major_mm100       smallint not null,
  minor_mm100       smallint not null,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  constraint rb_stone_offer_stone_fk foreign key (stone_id, shop_id) references analytics.rb_stone (id, shop_id) on delete restrict,
  constraint rb_stone_offer_shape_fk foreign key (shape_id, shop_id) references analytics.rb_gem_shape (id, shop_id) on delete restrict,
  constraint rb_stone_offer_major_ck check (major_mm100 between 50 and 2000),
  constraint rb_stone_offer_minor_ck check (minor_mm100 between 50 and 2000),
  constraint rb_stone_offer_order_ck check (major_mm100 >= minor_mm100),
  -- unique รวมแถวที่ปิดแล้ว: ปิด offer เดิมแล้วเปิดใหม่ = เปิดแถวเดิม (ประวัติราคาต่อเนื่อง)
  constraint rb_stone_offer_key_uq unique (stone_id, shape_id, major_mm100, minor_mm100)
);
create index if not exists idx_rb_stone_offer_shape on analytics.rb_stone_offer (shape_id, major_mm100, minor_mm100);

create table if not exists analytics.rb_offer_price (
  offer_id       uuid not null references analytics.rb_stone_offer (id) on delete restrict,
  effective_from timestamptz not null,
  price_thb      integer not null,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  primary key (offer_id, effective_from),
  constraint rb_offer_price_ck check (price_thb between 1 and 100000)
);

alter table analytics.rb_gem_shape enable row level security;
alter table analytics.rb_design enable row level security;
alter table analytics.rb_design_price enable row level security;
alter table analytics.rb_stone enable row level security;
alter table analytics.rb_stone_offer enable row level security;
alter table analytics.rb_offer_price enable row level security;
-- ไม่มี policy โดยตั้งใจ: anon/authenticated ไม่มีสิทธิ์ทั้งสคีมา (ข้อ 18) · service_role bypass RLS แต่ถูกจำกัดด้วย grant (select อย่างเดียว) ท้ายไฟล์

-- ============================================================================
-- 3. trigger
-- ============================================================================
create or replace function analytics.rb_append_only() returns trigger
  language plpgsql
  set search_path to 'pg_catalog', 'pg_temp'
as $f$
begin
  raise exception 'rb: ตาราง % เป็น insert-only (ราคาย้อนหลังต้องตรวจย้อนได้)', tg_table_name using errcode = '55000', hint = 'append_only';
end;
$f$;

create or replace function analytics.rb_deny_truncate() returns trigger
  language plpgsql
  set search_path to 'pg_catalog', 'pg_temp'
as $f$
begin
  raise exception 'rb: ห้าม truncate ตาราง %', tg_table_name using errcode = '55000', hint = 'no_truncate';
end;
$f$;

create or replace function analytics.rb_shape_guard() returns trigger
  language plpgsql
  set search_path to 'pg_catalog', 'analytics', 'pg_temp'
as $f$
begin
  if tg_op = 'DELETE' then
    raise exception 'rb: ห้ามลบทรงพลอย (ปิดใช้งานแทน)' using errcode = '55000', hint = 'no_delete';
  end if;
  if new.id <> old.id or new.shop_id <> old.shop_id or new.created_at <> old.created_at then
    raise exception 'rb: id/ร้าน/วันที่สร้างของทรงแก้ไม่ได้' using errcode = '55000', hint = 'immutable';
  end if;
  if new.render_kind <> old.render_kind then
    raise exception 'rb: render_kind ของทรงแก้ไม่ได้ (ทรงใหม่ให้สร้างแถวใหม่)' using errcode = '55000', hint = 'shape_kind_locked';
  end if;
  if new.is_active is distinct from old.is_active then
    new.status_changed_at := clock_timestamp();
  end if;
  return new;
end;
$f$;

create or replace function analytics.rb_design_guard() returns trigger
  language plpgsql
  set search_path to 'pg_catalog', 'analytics', 'pg_temp'
as $f$
declare
  v_kind text;
begin
  if tg_op = 'DELETE' then
    raise exception 'rb: ห้ามลบแบบแหวน (ปิดใช้งานแทน — เลขแบบห้ามใช้ซ้ำ)' using errcode = '55000', hint = 'no_delete';
  end if;

  if tg_op = 'INSERT' then
    if new.published_at is not null or new.is_active then
      raise exception 'rb: แบบใหม่ต้องเป็นร่าง (เปิดขายผ่าน rb_design_publish เท่านั้น)' using errcode = '55000', hint = 'draft_only';
    end if;
  else
    if new.id <> old.id or new.shop_id <> old.shop_id or new.design_no <> old.design_no
       or new.created_at <> old.created_at or new.created_by is distinct from old.created_by then
      raise exception 'rb: id/ร้าน/เลขแบบ/วันที่สร้างแก้ไม่ได้' using errcode = '55000', hint = 'immutable';
    end if;
    if old.published_at is not null and new.published_at is distinct from old.published_at then
      raise exception 'rb: published_at ตั้งแล้วแก้/ล้างไม่ได้' using errcode = '55000', hint = 'immutable';
    end if;
    -- ล็อกตั้งแต่เปิดขายครั้งแรก (มติเจ้าของ Q5) — ทางที่ถูกคือทำสำเนาเป็นแบบใหม่
    if old.published_at is not null and (
         new.stone_count <> old.stone_count or new.shape_id <> old.shape_id
         or new.stone_major_mm100 <> old.stone_major_mm100 or new.stone_minor_mm100 <> old.stone_minor_mm100
         or new.stone_axis is distinct from old.stone_axis) then
      raise exception 'rb: แบบนี้เปิดขายแล้ว — แก้จำนวนเม็ด/ทรง/ขนาดเม็ด/ทิศเม็ดไม่ได้ (ทำสำเนาเป็นแบบใหม่)' using errcode = '55000', hint = 'design_locked';
    end if;
    if new.stone_count <> old.stone_count and old.model is not null then
      raise exception 'rb: แบบนี้มีโมเดลผูกอยู่ — แก้จำนวนเม็ดไม่ได้' using errcode = '55000', hint = 'model_bound';
    end if;
    if new.is_active is distinct from old.is_active then
      new.status_changed_at := clock_timestamp();
    end if;
  end if;

  -- ทรง × มิติ × ทิศ ต้องสอดคล้อง (ตรวจเมื่อ insert หรือค่าที่เกี่ยวเปลี่ยน)
  if tg_op = 'INSERT' or new.shape_id <> old.shape_id or new.stone_major_mm100 <> old.stone_major_mm100
     or new.stone_minor_mm100 <> old.stone_minor_mm100 or new.stone_axis is distinct from old.stone_axis then
    select s.render_kind into v_kind from analytics.rb_gem_shape s where s.id = new.shape_id and s.shop_id = new.shop_id;
    if v_kind = 'round' then
      if new.stone_major_mm100 <> new.stone_minor_mm100 then
        raise exception 'rb: ทรงกลมต้องกว้าง = ยาว' using errcode = '22023', hint = 'shape_dims_invalid';
      end if;
      if new.stone_axis is not null then
        raise exception 'rb: ทรงกลมไม่มีทิศเม็ด' using errcode = '22023', hint = 'axis_not_allowed';
      end if;
    elsif v_kind = 'oval' then
      if new.stone_major_mm100 <= new.stone_minor_mm100 then
        raise exception 'rb: ทรงไข่ต้องยาว > กว้าง (กว้าง = ยาวให้ใช้ทรงกลม)' using errcode = '22023', hint = 'shape_dims_invalid';
      end if;
      if new.stone_axis is null then
        raise exception 'rb: ทรงไข่ต้องระบุทิศเม็ด' using errcode = '22023', hint = 'axis_required';
      end if;
    else
      raise exception 'rb: ไม่พบทรงของแบบนี้' using errcode = '22023', hint = 'shape_not_found';
    end if;
  end if;
  return new;
end;
$f$;

create or replace function analytics.rb_stone_guard() returns trigger
  language plpgsql
  set search_path to 'pg_catalog', 'analytics', 'pg_temp'
as $f$
begin
  if tg_op = 'DELETE' then
    raise exception 'rb: ห้ามลบพลอย (ปิดใช้งานแทน — เลขพลอยห้ามใช้ซ้ำ)' using errcode = '55000', hint = 'no_delete';
  end if;
  if new.id <> old.id or new.shop_id <> old.shop_id or new.stone_no <> old.stone_no or new.created_at <> old.created_at then
    raise exception 'rb: id/ร้าน/เลขพลอย/วันที่สร้างแก้ไม่ได้' using errcode = '55000', hint = 'immutable';
  end if;
  if new.is_active is distinct from old.is_active then
    new.status_changed_at := clock_timestamp();
  end if;
  return new;
end;
$f$;

create or replace function analytics.rb_offer_guard() returns trigger
  language plpgsql
  set search_path to 'pg_catalog', 'analytics', 'pg_temp'
as $f$
declare
  v_kind text;
begin
  if tg_op = 'DELETE' then
    raise exception 'rb: ห้ามลบ offer (ปิดใช้งานแทน)' using errcode = '55000', hint = 'no_delete';
  end if;
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.shop_id <> old.shop_id or new.stone_id <> old.stone_id or new.shape_id <> old.shape_id
       or new.major_mm100 <> old.major_mm100 or new.minor_mm100 <> old.minor_mm100 or new.created_at <> old.created_at then
      raise exception 'rb: พลอย/ทรง/ขนาดของ offer แก้ไม่ได้ (ปิดแล้วเปิดแถวใหม่)' using errcode = '55000', hint = 'immutable';
    end if;
    if new.is_active is distinct from old.is_active then
      new.status_changed_at := clock_timestamp();
    end if;
    return new;
  end if;
  select s.render_kind into v_kind from analytics.rb_gem_shape s where s.id = new.shape_id and s.shop_id = new.shop_id;
  if v_kind = 'round' and new.major_mm100 <> new.minor_mm100 then
    raise exception 'rb: ทรงกลมต้องกว้าง = ยาว' using errcode = '22023', hint = 'shape_dims_invalid';
  elsif v_kind = 'oval' and new.major_mm100 <= new.minor_mm100 then
    raise exception 'rb: ทรงไข่ต้องยาว > กว้าง' using errcode = '22023', hint = 'shape_dims_invalid';
  elsif v_kind is null then
    raise exception 'rb: ไม่พบทรง' using errcode = '22023', hint = 'shape_not_found';
  end if;
  return new;
end;
$f$;

drop trigger if exists trg_rb_shape_guard on analytics.rb_gem_shape;
create trigger trg_rb_shape_guard before update or delete on analytics.rb_gem_shape
  for each row execute function analytics.rb_shape_guard();
drop trigger if exists trg_rb_design_guard on analytics.rb_design;
create trigger trg_rb_design_guard before insert or update or delete on analytics.rb_design
  for each row execute function analytics.rb_design_guard();
drop trigger if exists trg_rb_stone_guard on analytics.rb_stone;
create trigger trg_rb_stone_guard before update or delete on analytics.rb_stone
  for each row execute function analytics.rb_stone_guard();
drop trigger if exists trg_rb_offer_guard on analytics.rb_stone_offer;
create trigger trg_rb_offer_guard before insert or update or delete on analytics.rb_stone_offer
  for each row execute function analytics.rb_offer_guard();
drop trigger if exists trg_rb_design_price_append_only on analytics.rb_design_price;
create trigger trg_rb_design_price_append_only before update or delete on analytics.rb_design_price
  for each row execute function analytics.rb_append_only();
drop trigger if exists trg_rb_offer_price_append_only on analytics.rb_offer_price;
create trigger trg_rb_offer_price_append_only before update or delete on analytics.rb_offer_price
  for each row execute function analytics.rb_append_only();

do $trg$
declare
  t text;
begin
  foreach t in array array['rb_gem_shape', 'rb_design', 'rb_design_price', 'rb_stone', 'rb_stone_offer', 'rb_offer_price'] loop
    execute format('drop trigger if exists trg_%s_no_truncate on analytics.%I', t, t);
    execute format('create trigger trg_%s_no_truncate before truncate on analytics.%I for each statement execute function analytics.rb_deny_truncate()', t, t);
  end loop;
end;
$trg$;

-- ============================================================================
-- 4. helper ภายใน
-- ============================================================================
-- ผู้ทำรายการต้องเป็นสมาชิก owner/admin ของร้านจริง แม้ผู้เรียกเป็น service_role (ซึ่งผ่าน crm_require_owner_admin เสมอ) — role-single-level: กฎที่ต้องบังคับจริงอยู่ที่ DB ไม่ใช่ปุ่ม
create or replace function analytics.rb_require_office(p_shop_id uuid, p_actor uuid) returns void
  language plpgsql
  set search_path to 'public', 'analytics', 'pg_temp'
as $f$
begin
  perform analytics.crm_require_owner_admin(p_shop_id);
  if p_actor is null then
    raise exception 'ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  if not exists (select 1 from public.shop_member m where m.shop_id = p_shop_id and m.user_id = p_actor and m.role in ('owner', 'admin')) then
    raise exception 'หลังบ้านออกแบบแหวนใช้ได้เฉพาะ owner/admin ของร้าน' using errcode = '42501', hint = 'rb_actor_forbidden';
  end if;
end;
$f$;


-- ============================================================================
-- 5. RPC สาธารณะ — SECURITY INVOKER (รันในฐานะ service_role ซึ่งไม่มีสิทธิ์อ่าน analytics.gem_item_price)
--    key ของ jsonb ที่คืน = allowlist (TS: lib/ring-builder/types.ts + catalog-server.ts ประกอบทีละ field) · ไม่มีต้นทุน/id ภายใน/is_active/published_at
-- ============================================================================
drop function if exists analytics.rb_public_catalog(uuid, timestamptz);
create function analytics.rb_public_catalog(p_shop_id uuid, p_at timestamptz default null)
  returns jsonb
  language plpgsql
  set search_path to 'pg_catalog', 'analytics', 'pg_temp'
as $f$
declare
  v_at      timestamptz;
  v_rng     int4range := analytics.rb_size_range();
  v_stones  jsonb;
  v_designs jsonb;
begin
  if p_shop_id is null then
    raise exception 'rb: p_shop_id ต้องไม่ว่าง' using errcode = '22023', hint = 'invalid';
  end if;
  v_at := date_trunc('second', coalesce(p_at, clock_timestamp()));

  -- แบบจะโผล่เมื่อ: active ∧ published ∧ ทรงเปิดอยู่ ∧ มีราคาตัวเรือน ณ v_at (ไม่บังคับรูปการ์ด — N3)
  -- พลอยจะโผล่ในแบบหนึ่งเมื่อ: พลอยเปิด ∧ offer เปิด ∧ ทรง/ขนาดเท่ากับแบบเป๊ะ (เทียบจำนวนเต็ม) ∧ มีราคา ณ v_at — ไม่มี query ไหนหยิบขนาดใกล้เคียงมาแทน
  with d as (
    select dz.id, dz.design_no, dz.name, dz.stone_count, dz.shape_id, dz.stone_major_mm100 as major, dz.stone_minor_mm100 as minor,
           dz.stone_axis, dz.size_min, dz.size_max, dz.card_image_path, dz.sort, s.name_th as shape_name, s.render_kind, bp.body_price_thb
      from analytics.rb_design dz
      join analytics.rb_gem_shape s on s.id = dz.shape_id and s.shop_id = dz.shop_id and s.is_active
      cross join lateral (
        select p.body_price_thb from analytics.rb_design_price p
         where p.design_id = dz.id and p.effective_from <= v_at
         order by p.effective_from desc limit 1) bp
     where dz.shop_id = p_shop_id and dz.is_active and dz.published_at is not null
  ), o as (
    select d.design_no, st.stone_no, st.sort as stone_sort, op.price_thb
      from d
      join analytics.rb_stone_offer so on so.shop_id = p_shop_id and so.shape_id = d.shape_id
                                      and so.major_mm100 = d.major and so.minor_mm100 = d.minor and so.is_active
      join analytics.rb_stone st on st.id = so.stone_id and st.shop_id = so.shop_id and st.is_active
      cross join lateral (
        select p.price_thb from analytics.rb_offer_price p
         where p.offer_id = so.id and p.effective_from <= v_at
         order by p.effective_from desc limit 1) op
  ), sold as (
    select distinct st.stone_no, st.name_th, st.short_name, st.color_hex, st.sort
      from o join analytics.rb_stone st on st.shop_id = p_shop_id and st.stone_no = o.stone_no
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object('no', x.stone_no, 'name', x.name_th, 'short_name', x.short_name, 'color_hex', x.color_hex)
                              order by x.sort, x.stone_no), '[]'::jsonb) from sold x),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'no', d.design_no, 'name', d.name, 'stone_count', d.stone_count,
        'shape_kind', d.render_kind, 'shape_name', d.shape_name,
        'major_mm100', d.major, 'minor_mm100', d.minor, 'stone_axis', d.stone_axis,
        'size_min', d.size_min, 'size_max', d.size_max, 'body_price_thb', d.body_price_thb, 'card_image_path', d.card_image_path,
        'offers', (select coalesce(jsonb_agg(jsonb_build_object('stone_no', o.stone_no, 'price_thb', o.price_thb) order by o.stone_sort, o.stone_no), '[]'::jsonb)
                     from o where o.design_no = d.design_no))
      order by d.stone_count, d.sort, d.design_no), '[]'::jsonb) from d)
  into v_stones, v_designs;

  return jsonb_build_object(
    'catalog_at', to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'sizes', jsonb_build_object('min', lower(v_rng), 'max', upper(v_rng) - 1),
    'stones', v_stones,
    'designs', v_designs);
end;
$f$;

-- ราคาผูกพัน ณ วินาที (p_at null = ตอนนี้) · p_size null = "ให้แอดมินช่วยเช็ก" · คืน {ok:true,...} หรือ {ok:false, code[, stone_nos]}
--   ลำดับด่าน: invalid → design_unavailable → count_mismatch → size_out_of_range → stone_unavailable → total_too_large
--   p_at ไม่ผ่อนด่านการมองเห็น (active ทุกชั้นบังคับเสมอ) — ใช้เปลี่ยนเฉพาะ "ราคา ณ วินาทีไหน"
drop function if exists analytics.rb_quote(uuid, integer, integer, integer[], timestamptz);
create function analytics.rb_quote(p_shop_id uuid, p_design_no integer, p_size integer, p_positions integer[], p_at timestamptz default null)
  returns jsonb
  language plpgsql
  set search_path to 'pg_catalog', 'analytics', 'pg_temp'
as $f$
declare
  v_at        timestamptz;
  v_rng       int4range := analytics.rb_size_range();
  v_d         record;
  v_n         integer;
  v_bad       integer[];
  v_lines     jsonb;
  v_sum       bigint;
  v_total     bigint;
begin
  -- รูปร่าง input (ตัวเลขทุกตัวเป็น int — NaN/Infinity ไม่มีทางมาถึง · ข้อ 4) · ผิด = invalid ไม่ใช่ exception (route แปลเป็น 400)
  if p_shop_id is null or p_design_no is null or p_design_no not between 1 and 4095
     or p_positions is null or array_ndims(p_positions) is distinct from 1 or array_lower(p_positions, 1) <> 1
     or exists (select 1 from unnest(p_positions) u(x) where x is null or x not between 0 and 1023) then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  v_n := cardinality(p_positions);
  v_at := date_trunc('second', coalesce(p_at, clock_timestamp()));

  select dz.id, dz.name, dz.stone_count, dz.shape_id, dz.stone_major_mm100 as major, dz.stone_minor_mm100 as minor, dz.size_min, dz.size_max,
         s.name_th as shape_name, s.render_kind, bp.body_price_thb
    into v_d
    from analytics.rb_design dz
    join analytics.rb_gem_shape s on s.id = dz.shape_id and s.shop_id = dz.shop_id and s.is_active
    cross join lateral (
      select p.body_price_thb from analytics.rb_design_price p
       where p.design_id = dz.id and p.effective_from <= v_at
       order by p.effective_from desc limit 1) bp
   where dz.shop_id = p_shop_id and dz.design_no = p_design_no and dz.is_active and dz.published_at is not null;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'design_unavailable');
  end if;

  if v_n <> v_d.stone_count then
    return jsonb_build_object('ok', false, 'code', 'count_mismatch');
  end if;

  -- ไซซ์: null = ให้แอดมินช่วยเช็ก (ผ่าน) · มีค่า = ต้องอยู่ในช่วงร้านและช่วงของแบบ
  if p_size is not null and not (v_rng @> p_size and p_size between v_d.size_min and v_d.size_max) then
    return jsonb_build_object('ok', false, 'code', 'size_out_of_range');
  end if;

  with req as (
    select u.stone_no, u.pos::integer as pos from unnest(p_positions) with ordinality as u(stone_no, pos)
  ), priced as (
    select r.pos, r.stone_no, st.name_th, pr.price_thb,
           (r.stone_no = 0 or pr.price_thb is not null) as ok
      from req r
      left join analytics.rb_stone st on r.stone_no > 0 and st.shop_id = p_shop_id and st.stone_no = r.stone_no and st.is_active
      left join analytics.rb_stone_offer so on st.id is not null and so.stone_id = st.id and so.shop_id = p_shop_id and so.shape_id = v_d.shape_id
                                            and so.major_mm100 = v_d.major and so.minor_mm100 = v_d.minor and so.is_active
      left join lateral (
        select p.price_thb from analytics.rb_offer_price p
         where p.offer_id = so.id and p.effective_from <= v_at
         order by p.effective_from desc limit 1) pr on so.id is not null
  )
  select coalesce(array_agg(distinct pr.stone_no) filter (where not pr.ok), '{}'::integer[]),
         coalesce(jsonb_agg(jsonb_build_object('pos', pr.pos, 'stone_no', pr.stone_no, 'name', pr.name_th, 'price', case when pr.stone_no = 0 then 0 else pr.price_thb end) order by pr.pos), '[]'::jsonb),
         coalesce(sum(case when pr.stone_no = 0 then 0 else pr.price_thb end), 0)
    into v_bad, v_lines, v_sum
    from priced pr;

  if cardinality(v_bad) > 0 then
    return jsonb_build_object('ok', false, 'code', 'stone_unavailable', 'stone_nos', to_jsonb(v_bad));
  end if;

  v_total := v_d.body_price_thb + v_sum;
  if v_total > 262143 then
    return jsonb_build_object('ok', false, 'code', 'total_too_large');
  end if;

  return jsonb_build_object(
    'ok', true,
    'total', v_total,
    'body', v_d.body_price_thb,
    'size', p_size,
    'design', jsonb_build_object('name', v_d.name, 'shape_kind', v_d.render_kind, 'shape_name', v_d.shape_name, 'major_mm100', v_d.major, 'minor_mm100', v_d.minor),
    'lines', v_lines,
    'priced_at', to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
end;
$f$;

-- ============================================================================
-- 6. RPC หลังบ้าน — SECURITY DEFINER · pin search_path · rb_require_office บรรทัดแรก (ก่อนตรวจ input — คนนอกไม่ควรได้ข้อความตรวจ)
--    ข้อผิดพลาดของกติกา = 22023 + hint เป็นรหัส snake_case · สิทธิ์ = 42501 · แถวไม่พบ = 22023 hint not_found
--    p_shop_id/p_actor ใส่ฝั่ง server เท่านั้น (lib/ring-builder/admin-server.ts) — ไม่รับจาก client
-- ============================================================================
drop function if exists analytics.rb_shape_upsert(uuid, uuid, uuid, text, text, integer);
create function analytics.rb_shape_upsert(p_shop_id uuid, p_actor uuid, p_id uuid, p_name text, p_render_kind text, p_sort integer)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public', 'analytics', 'pg_temp'
as $f$
declare
  v_name text := btrim(p_name);
  v_row  analytics.rb_gem_shape;
begin
  perform analytics.rb_require_office(p_shop_id, p_actor);
  if not analytics.rb_text_ok(v_name, 1, 20) then
    raise exception 'ชื่อทรงต้องยาว 1-20 ตัวอักษรและไม่มีอักขระซ่อน' using errcode = '22023', hint = 'name_invalid';
  end if;
  if p_sort is not null and p_sort not between -1000 and 100000 then
    raise exception 'ลำดับไม่ถูกต้อง' using errcode = '22023', hint = 'sort_invalid';
  end if;

  if p_id is null then
    if p_render_kind is null or p_render_kind not in ('round', 'oval') then
      raise exception 'ต้องเลือกรูปร่างที่ระบบรองรับ (กลม/ไข่)' using errcode = '22023', hint = 'render_kind_invalid';
    end if;
    begin
      insert into analytics.rb_gem_shape (shop_id, name_th, render_kind, sort) values (p_shop_id, v_name, p_render_kind, coalesce(p_sort, 0)) returning * into v_row;
    exception when unique_violation then
      raise exception 'มีทรงชื่อนี้อยู่แล้ว' using errcode = '22023', hint = 'name_dup';
    end;
    return jsonb_build_object('ok', true, 'id', v_row.id, 'created', true);
  end if;

  select * into v_row from analytics.rb_gem_shape s where s.id = p_id and s.shop_id = p_shop_id for update;
  if not found then
    raise exception 'ไม่พบทรงนี้' using errcode = '22023', hint = 'not_found';
  end if;
  if p_render_kind is not null and p_render_kind <> v_row.render_kind then
    raise exception 'รูปร่างของทรงแก้ไม่ได้ (ทรงใหม่ให้สร้างแถวใหม่)' using errcode = '22023', hint = 'shape_kind_locked';
  end if;
  begin
    update analytics.rb_gem_shape s set name_th = v_name, sort = coalesce(p_sort, s.sort) where s.id = v_row.id;
  exception when unique_violation then
    raise exception 'มีทรงชื่อนี้อยู่แล้ว' using errcode = '22023', hint = 'name_dup';
  end;
  return jsonb_build_object('ok', true, 'id', v_row.id, 'created', false);
end;
$f$;

drop function if exists analytics.rb_stone_upsert(uuid, uuid, uuid, text, text, text, integer);
create function analytics.rb_stone_upsert(p_shop_id uuid, p_actor uuid, p_id uuid, p_name_th text, p_short_name text, p_color_hex text, p_sort integer)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public', 'analytics', 'pg_temp'
as $f$
declare
  v_name  text := btrim(p_name_th);
  v_short text := btrim(p_short_name);
  v_color text := upper(btrim(p_color_hex));
  v_row   analytics.rb_stone;
  v_no    integer;
begin
  perform analytics.rb_require_office(p_shop_id, p_actor);
  if not analytics.rb_text_ok(v_name, 1, 40) then
    raise exception 'ชื่อพลอยต้องยาว 1-40 ตัวอักษรและไม่มีอักขระซ่อน' using errcode = '22023', hint = 'name_invalid';
  end if;
  if not analytics.rb_text_ok(v_short, 1, 6) then
    raise exception 'ชื่อสั้น (ที่แสดงบนแถบตำแหน่ง) ต้องยาว 1-6 ตัวอักษร' using errcode = '22023', hint = 'short_name_invalid';
  end if;
  if v_color is null or v_color !~ '^#[0-9A-F]{6}$' then
    raise exception 'สีต้องเป็นรหัส #RRGGBB' using errcode = '22023', hint = 'color_invalid';
  end if;
  if p_sort is not null and p_sort not between -1000 and 100000 then
    raise exception 'ลำดับไม่ถูกต้อง' using errcode = '22023', hint = 'sort_invalid';
  end if;

  if p_id is null then
    -- เลขพลอยห้ามใช้ซ้ำ (อยู่ในรหัสสั่งทำ) — max+1 ใต้ล็อกของร้าน (ไม่ลบแถว จึงไม่มีช่องว่างให้เติมกลับ)
    perform pg_advisory_xact_lock(hashtextextended('rb_stone_no:' || p_shop_id::text, 0));
    select coalesce(max(s.stone_no), 0) + 1 into v_no from analytics.rb_stone s where s.shop_id = p_shop_id;
    if v_no > 1023 then
      raise exception 'เลขพลอยเต็ม (1023 ชนิดตลอดอายุร้าน)' using errcode = '22023', hint = 'stone_no_exhausted';
    end if;
    begin
      insert into analytics.rb_stone (shop_id, stone_no, name_th, short_name, color_hex, sort)
      values (p_shop_id, v_no, v_name, v_short, v_color, coalesce(p_sort, 0)) returning * into v_row;
    exception when unique_violation then
      raise exception 'มีพลอยชื่อนี้อยู่แล้ว' using errcode = '22023', hint = 'name_dup';
    end;
    return jsonb_build_object('ok', true, 'id', v_row.id, 'stone_no', v_row.stone_no, 'created', true);
  end if;

  select * into v_row from analytics.rb_stone s where s.id = p_id and s.shop_id = p_shop_id for update;
  if not found then
    raise exception 'ไม่พบพลอยนี้' using errcode = '22023', hint = 'not_found';
  end if;
  begin
    update analytics.rb_stone s set name_th = v_name, short_name = v_short, color_hex = v_color, sort = coalesce(p_sort, s.sort) where s.id = v_row.id;
  exception when unique_violation then
    raise exception 'มีพลอยชื่อนี้อยู่แล้ว' using errcode = '22023', hint = 'name_dup';
  end;
  return jsonb_build_object('ok', true, 'id', v_row.id, 'stone_no', v_row.stone_no, 'created', false);
end;
$f$;

-- offer = (พลอย × ทรง × ขนาดกว้าง×ยาว) · canonical: major ≥ minor (3×4 = 4×3 เป็นแถวเดียว — X13) · key ซ้ำกับแถวที่ปิดไว้ = เปิดแถวเดิม
drop function if exists analytics.rb_offer_upsert(uuid, uuid, uuid, uuid, integer, integer);
create function analytics.rb_offer_upsert(p_shop_id uuid, p_actor uuid, p_stone_id uuid, p_shape_id uuid, p_major_mm100 integer, p_minor_mm100 integer)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public', 'analytics', 'pg_temp'
as $f$
declare
  v_hi  integer;
  v_lo  integer;
  v_row analytics.rb_stone_offer;
begin
  perform analytics.rb_require_office(p_shop_id, p_actor);
  if p_major_mm100 is null or p_minor_mm100 is null or p_major_mm100 not between 50 and 2000 or p_minor_mm100 not between 50 and 2000 then
    raise exception 'ขนาดพลอยต้องอยู่ระหว่าง 0.50-20.00 มม.' using errcode = '22023', hint = 'size_invalid';
  end if;
  v_hi := greatest(p_major_mm100, p_minor_mm100);
  v_lo := least(p_major_mm100, p_minor_mm100);
  if not exists (select 1 from analytics.rb_stone s where s.id = p_stone_id and s.shop_id = p_shop_id) then
    raise exception 'ไม่พบพลอยนี้' using errcode = '22023', hint = 'not_found';
  end if;
  if not exists (select 1 from analytics.rb_gem_shape s where s.id = p_shape_id and s.shop_id = p_shop_id) then
    raise exception 'ไม่พบทรงนี้' using errcode = '22023', hint = 'not_found';
  end if;

  select * into v_row from analytics.rb_stone_offer o
   where o.stone_id = p_stone_id and o.shape_id = p_shape_id and o.major_mm100 = v_hi and o.minor_mm100 = v_lo for update;
  if found then
    if v_row.is_active then
      return jsonb_build_object('ok', true, 'id', v_row.id, 'created', false, 'reactivated', false);
    end if;
    update analytics.rb_stone_offer o set is_active = true where o.id = v_row.id;
    return jsonb_build_object('ok', true, 'id', v_row.id, 'created', false, 'reactivated', true);
  end if;

  insert into analytics.rb_stone_offer (shop_id, stone_id, shape_id, major_mm100, minor_mm100) values (p_shop_id, p_stone_id, p_shape_id, v_hi, v_lo) returning * into v_row;
  return jsonb_build_object('ok', true, 'id', v_row.id, 'created', true, 'reactivated', false);
end;
$f$;

-- ตั้งราคาพลอย (บาทต่อเม็ด · จำนวนเต็ม) — แถวใหม่ effective_from = วินาทีถัดไป (ดู "ตัดสินเอง" ข้อ 1) · ราคาเท่าล่าสุด = ไม่เขียน
drop function if exists analytics.rb_offer_price_set(uuid, uuid, uuid, integer);
create function analytics.rb_offer_price_set(p_shop_id uuid, p_actor uuid, p_offer_id uuid, p_price_thb integer)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public', 'analytics', 'pg_temp'
as $f$
declare
  v_last integer;
  v_eff  timestamptz;
begin
  perform analytics.rb_require_office(p_shop_id, p_actor);
  if p_price_thb is null or p_price_thb not between 1 and 100000 then
    raise exception 'ราคาพลอยต้องเป็นจำนวนเต็มบาท 1-100,000' using errcode = '22023', hint = 'price_invalid';
  end if;
  perform 1 from analytics.rb_stone_offer o where o.id = p_offer_id and o.shop_id = p_shop_id for update;
  if not found then
    raise exception 'ไม่พบรายการราคานี้' using errcode = '22023', hint = 'not_found';
  end if;
  select p.price_thb into v_last from analytics.rb_offer_price p where p.offer_id = p_offer_id order by p.effective_from desc limit 1;
  if v_last is not null and v_last = p_price_thb then
    return jsonb_build_object('ok', true, 'unchanged', true);
  end if;
  v_eff := date_trunc('second', clock_timestamp()) + interval '1 second';
  if exists (select 1 from analytics.rb_offer_price p where p.offer_id = p_offer_id and p.effective_from >= v_eff) then
    raise exception 'ตั้งราคาถี่เกินไป — รอสักครู่แล้วลองใหม่' using errcode = '22023', hint = 'price_too_fast';
  end if;
  insert into analytics.rb_offer_price (offer_id, effective_from, price_thb, created_by) values (p_offer_id, v_eff, p_price_thb, p_actor);
  return jsonb_build_object('ok', true, 'unchanged', false, 'effective_from', to_char(v_eff at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
end;
$f$;

-- สร้าง/แก้แบบ (draft) · create: ได้ design_no ใหม่ (max+1 ห้ามใช้ซ้ำ) · update: หลัง publish แก้ได้เฉพาะ ชื่อ/ช่วงไซซ์/ลำดับ (ที่เหลือ trigger ล็อก)
--   p_axis: ทรงกลมต้อง null · ทรงไข่ต้องมี (along_row/across_row) · ราคาตัวเรือนตั้งทาง rb_design_price_set
drop function if exists analytics.rb_design_upsert(uuid, uuid, uuid, text, integer, uuid, integer, integer, text, integer, integer, integer);
create function analytics.rb_design_upsert(
  p_shop_id uuid, p_actor uuid, p_id uuid, p_name text, p_stone_count integer, p_shape_id uuid,
  p_major_mm100 integer, p_minor_mm100 integer, p_axis text, p_size_min integer, p_size_max integer, p_sort integer)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public', 'analytics', 'pg_temp'
as $f$
declare
  v_name text := btrim(p_name);
  v_hi   integer;
  v_lo   integer;
  v_row  analytics.rb_design;
  v_no   integer;
  v_rng  int4range := analytics.rb_size_range();
begin
  perform analytics.rb_require_office(p_shop_id, p_actor);
  if not analytics.rb_text_ok(v_name, 1, 40) then
    raise exception 'ชื่อแบบต้องยาว 1-40 ตัวอักษรและไม่มีอักขระซ่อน' using errcode = '22023', hint = 'name_invalid';
  end if;
  if p_stone_count is null or p_stone_count not between 3 and 7 then
    raise exception 'จำนวนเม็ดต้องเป็น 3-7' using errcode = '22023', hint = 'stone_count_invalid';
  end if;
  if p_major_mm100 is null or p_minor_mm100 is null or p_major_mm100 not between 50 and 2000 or p_minor_mm100 not between 50 and 2000 then
    raise exception 'ขนาดพลอยต้องอยู่ระหว่าง 0.50-20.00 มม.' using errcode = '22023', hint = 'size_invalid';
  end if;
  if p_size_min is null or p_size_max is null or not (v_rng @> p_size_min and v_rng @> p_size_max) or p_size_min > p_size_max then
    raise exception 'ช่วงไซซ์ของแบบต้องอยู่ในช่วงร้านและต่ำสุด ≤ สูงสุด' using errcode = '22023', hint = 'size_range_invalid';
  end if;
  if p_axis is not null and p_axis not in ('along_row', 'across_row') then
    raise exception 'ทิศเม็ดไม่ถูกต้อง' using errcode = '22023', hint = 'axis_invalid';
  end if;
  if p_sort is not null and p_sort not between -1000 and 100000 then
    raise exception 'ลำดับไม่ถูกต้อง' using errcode = '22023', hint = 'sort_invalid';
  end if;
  v_hi := greatest(p_major_mm100, p_minor_mm100);
  v_lo := least(p_major_mm100, p_minor_mm100);
  if not exists (select 1 from analytics.rb_gem_shape s where s.id = p_shape_id and s.shop_id = p_shop_id) then
    raise exception 'ไม่พบทรงนี้' using errcode = '22023', hint = 'not_found';
  end if;

  if p_id is null then
    perform pg_advisory_xact_lock(hashtextextended('rb_design_no:' || p_shop_id::text, 0));
    select coalesce(max(d.design_no), 0) + 1 into v_no from analytics.rb_design d where d.shop_id = p_shop_id;
    if v_no > 4095 then
      raise exception 'เลขแบบเต็ม (4095 แบบตลอดอายุร้าน)' using errcode = '22023', hint = 'design_no_exhausted';
    end if;
    insert into analytics.rb_design (shop_id, design_no, name, stone_count, shape_id, stone_major_mm100, stone_minor_mm100, stone_axis, size_min, size_max, sort, created_by)
    values (p_shop_id, v_no, v_name, p_stone_count, p_shape_id, v_hi, v_lo, p_axis, p_size_min, p_size_max, coalesce(p_sort, 0), p_actor)
    returning * into v_row;
    return jsonb_build_object('ok', true, 'id', v_row.id, 'design_no', v_row.design_no, 'created', true);
  end if;

  select * into v_row from analytics.rb_design d where d.id = p_id and d.shop_id = p_shop_id for update;
  if not found then
    raise exception 'ไม่พบแบบนี้' using errcode = '22023', hint = 'not_found';
  end if;
  begin
    update analytics.rb_design d
       set name = v_name, stone_count = p_stone_count, shape_id = p_shape_id, stone_major_mm100 = v_hi, stone_minor_mm100 = v_lo,
           stone_axis = p_axis, size_min = p_size_min, size_max = p_size_max, sort = coalesce(p_sort, d.sort)
     where d.id = v_row.id;
  exception when unique_violation then
    raise exception 'มีแบบที่เปิดอยู่ชื่อนี้ในจำนวนเม็ดเดียวกันแล้ว' using errcode = '22023', hint = 'name_dup';
  end;
  return jsonb_build_object('ok', true, 'id', v_row.id, 'design_no', v_row.design_no, 'created', false);
end;
$f$;

drop function if exists analytics.rb_design_price_set(uuid, uuid, uuid, integer);
create function analytics.rb_design_price_set(p_shop_id uuid, p_actor uuid, p_design_id uuid, p_price_thb integer)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public', 'analytics', 'pg_temp'
as $f$
declare
  v_last integer;
  v_eff  timestamptz;
begin
  perform analytics.rb_require_office(p_shop_id, p_actor);
  if p_price_thb is null or p_price_thb not between 1 and 1000000 then
    raise exception 'ราคาตัวเรือนต้องเป็นจำนวนเต็มบาท 1-1,000,000' using errcode = '22023', hint = 'price_invalid';
  end if;
  perform 1 from analytics.rb_design d where d.id = p_design_id and d.shop_id = p_shop_id for update;
  if not found then
    raise exception 'ไม่พบแบบนี้' using errcode = '22023', hint = 'not_found';
  end if;
  select p.body_price_thb into v_last from analytics.rb_design_price p where p.design_id = p_design_id order by p.effective_from desc limit 1;
  if v_last is not null and v_last = p_price_thb then
    return jsonb_build_object('ok', true, 'unchanged', true);
  end if;
  v_eff := date_trunc('second', clock_timestamp()) + interval '1 second';
  if exists (select 1 from analytics.rb_design_price p where p.design_id = p_design_id and p.effective_from >= v_eff) then
    raise exception 'ตั้งราคาถี่เกินไป — รอสักครู่แล้วลองใหม่' using errcode = '22023', hint = 'price_too_fast';
  end if;
  insert into analytics.rb_design_price (design_id, effective_from, body_price_thb, created_by) values (p_design_id, v_eff, p_price_thb, p_actor);
  return jsonb_build_object('ok', true, 'unchanged', false, 'effective_from', to_char(v_eff at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
end;
$f$;

-- ผูกรูปการ์ด (path ที่ server สร้างเอง: designs/<uuid>.jpg) · null = ล้าง · คืน previous_path ให้ server ลบ object เก่า (best-effort)
drop function if exists analytics.rb_design_card_set(uuid, uuid, uuid, text);
create function analytics.rb_design_card_set(p_shop_id uuid, p_actor uuid, p_design_id uuid, p_path text)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public', 'analytics', 'pg_temp'
as $f$
declare
  v_prev text;
begin
  perform analytics.rb_require_office(p_shop_id, p_actor);
  if p_path is not null and p_path !~ '^designs/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$' then
    raise exception 'path รูปการ์ดไม่ถูกต้อง' using errcode = '22023', hint = 'path_invalid';
  end if;
  select d.card_image_path into v_prev from analytics.rb_design d where d.id = p_design_id and d.shop_id = p_shop_id for update;
  if not found then
    raise exception 'ไม่พบแบบนี้' using errcode = '22023', hint = 'not_found';
  end if;
  begin
    update analytics.rb_design d set card_image_path = p_path where d.id = p_design_id;
  exception when unique_violation then
    raise exception 'path รูปการ์ดซ้ำ' using errcode = '22023', hint = 'path_invalid';
  end;
  return jsonb_build_object('ok', true, 'previous_path', v_prev);
end;
$f$;

-- เปิดขายครั้งแรก: ตั้ง published_at (ล็อกจำนวนเม็ด/ทรง/ขนาดเม็ด/ทิศ ถาวร) + is_active · ต้องมีราคาตัวเรือน · ทรงต้องเปิดอยู่ · idempotent (เคย publish แล้ว = already)
drop function if exists analytics.rb_design_publish(uuid, uuid, uuid);
create function analytics.rb_design_publish(p_shop_id uuid, p_actor uuid, p_design_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public', 'analytics', 'pg_temp'
as $f$
declare
  v_row analytics.rb_design;
  v_shape_active boolean;
begin
  perform analytics.rb_require_office(p_shop_id, p_actor);
  select * into v_row from analytics.rb_design d where d.id = p_design_id and d.shop_id = p_shop_id for update;
  if not found then
    raise exception 'ไม่พบแบบนี้' using errcode = '22023', hint = 'not_found';
  end if;
  if v_row.published_at is not null then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  select s.is_active into v_shape_active from analytics.rb_gem_shape s where s.id = v_row.shape_id and s.shop_id = v_row.shop_id;
  if v_shape_active is not true then
    raise exception 'ทรงพลอยของแบบนี้ปิดอยู่ — เปิดทรงก่อนเปิดขายแบบ' using errcode = '22023', hint = 'shape_inactive';
  end if;
  if not exists (select 1 from analytics.rb_design_price p where p.design_id = v_row.id) then
    raise exception 'ตั้งราคาตัวเรือนก่อนเปิดขาย' using errcode = '22023', hint = 'price_required';
  end if;
  begin
    update analytics.rb_design d set published_at = clock_timestamp(), is_active = true where d.id = v_row.id;
  exception when unique_violation then
    raise exception 'มีแบบที่เปิดอยู่ชื่อนี้ในจำนวนเม็ดเดียวกันแล้ว' using errcode = '22023', hint = 'name_dup';
  end;
  return jsonb_build_object('ok', true, 'already', false);
end;
$f$;

-- ทำสำเนาเป็นแบบใหม่ (ร่าง · design_no ใหม่ · ไม่คัดลอกโมเดล/รูปการ์ด · คัดลอกราคาตัวเรือนล่าสุดถ้ามี)
drop function if exists analytics.rb_design_duplicate(uuid, uuid, uuid);
create function analytics.rb_design_duplicate(p_shop_id uuid, p_actor uuid, p_design_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public', 'analytics', 'pg_temp'
as $f$
declare
  v_src  analytics.rb_design;
  v_new  analytics.rb_design;
  v_no   integer;
  v_last integer;
begin
  perform analytics.rb_require_office(p_shop_id, p_actor);
  select * into v_src from analytics.rb_design d where d.id = p_design_id and d.shop_id = p_shop_id;
  if not found then
    raise exception 'ไม่พบแบบนี้' using errcode = '22023', hint = 'not_found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rb_design_no:' || p_shop_id::text, 0));
  select coalesce(max(d.design_no), 0) + 1 into v_no from analytics.rb_design d where d.shop_id = p_shop_id;
  if v_no > 4095 then
    raise exception 'เลขแบบเต็ม (4095 แบบตลอดอายุร้าน)' using errcode = '22023', hint = 'design_no_exhausted';
  end if;
  insert into analytics.rb_design (shop_id, design_no, name, stone_count, shape_id, stone_major_mm100, stone_minor_mm100, stone_axis, size_min, size_max, sort, created_by)
  values (p_shop_id, v_no, v_src.name, v_src.stone_count, v_src.shape_id, v_src.stone_major_mm100, v_src.stone_minor_mm100, v_src.stone_axis, v_src.size_min, v_src.size_max, v_src.sort, p_actor)
  returning * into v_new;
  select p.body_price_thb into v_last from analytics.rb_design_price p where p.design_id = v_src.id order by p.effective_from desc limit 1;
  if v_last is not null then
    insert into analytics.rb_design_price (design_id, effective_from, body_price_thb, created_by)
    values (v_new.id, date_trunc('second', clock_timestamp()) + interval '1 second', v_last, p_actor);
  end if;
  return jsonb_build_object('ok', true, 'id', v_new.id, 'design_no', v_new.design_no);
end;
$f$;

-- เปิด/ปิด: design | stone | offer | shape · design เปิดได้เฉพาะที่เคย publish (ครั้งแรกใช้ rb_design_publish) · shape คืน affected_designs (จำนวนแบบเปิดอยู่ที่ใช้ทรงนี้ — คำเตือนก่อนปิด)
drop function if exists analytics.rb_set_active(uuid, uuid, text, uuid, boolean);
create function analytics.rb_set_active(p_shop_id uuid, p_actor uuid, p_kind text, p_id uuid, p_active boolean)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public', 'analytics', 'pg_temp'
as $f$
declare
  v_was boolean;
  v_pub timestamptz;
  v_affected integer := 0;
begin
  perform analytics.rb_require_office(p_shop_id, p_actor);
  if p_kind is null or p_kind not in ('design', 'stone', 'offer', 'shape') or p_active is null then
    raise exception 'ชนิดหรือสถานะไม่ถูกต้อง' using errcode = '22023', hint = 'invalid';
  end if;

  if p_kind = 'design' then
    select d.is_active, d.published_at into v_was, v_pub from analytics.rb_design d where d.id = p_id and d.shop_id = p_shop_id for update;
    if not found then raise exception 'ไม่พบแบบนี้' using errcode = '22023', hint = 'not_found'; end if;
    if p_active and v_pub is null then
      raise exception 'แบบนี้ยังไม่เคยเปิดขาย — ใช้ "เปิดขาย" ครั้งแรก' using errcode = '22023', hint = 'not_published';
    end if;
    if v_was <> p_active then
      begin
        update analytics.rb_design d set is_active = p_active where d.id = p_id;
      exception when unique_violation then
        raise exception 'มีแบบที่เปิดอยู่ชื่อนี้ในจำนวนเม็ดเดียวกันแล้ว' using errcode = '22023', hint = 'name_dup';
      end;
    end if;
  elsif p_kind = 'stone' then
    select s.is_active into v_was from analytics.rb_stone s where s.id = p_id and s.shop_id = p_shop_id for update;
    if not found then raise exception 'ไม่พบพลอยนี้' using errcode = '22023', hint = 'not_found'; end if;
    if v_was <> p_active then update analytics.rb_stone s set is_active = p_active where s.id = p_id; end if;
  elsif p_kind = 'offer' then
    select o.is_active into v_was from analytics.rb_stone_offer o where o.id = p_id and o.shop_id = p_shop_id for update;
    if not found then raise exception 'ไม่พบรายการราคานี้' using errcode = '22023', hint = 'not_found'; end if;
    if v_was <> p_active then update analytics.rb_stone_offer o set is_active = p_active where o.id = p_id; end if;
  else
    select s.is_active into v_was from analytics.rb_gem_shape s where s.id = p_id and s.shop_id = p_shop_id for update;
    if not found then raise exception 'ไม่พบทรงนี้' using errcode = '22023', hint = 'not_found'; end if;
    select count(*)::integer into v_affected from analytics.rb_design d where d.shape_id = p_id and d.is_active;
    if v_was <> p_active then update analytics.rb_gem_shape s set is_active = p_active where s.id = p_id; end if;
  end if;
  return jsonb_build_object('ok', true, 'changed', v_was <> p_active, 'affected_designs', v_affected);
end;
$f$;

-- ============================================================================
-- 7. rb_admin_catalog — ข้อมูลหลังบ้านทั้งชุด + coverage (ขายได้ x/y แบบ · ขาดเพราะ…) · ไม่มีต้นทุน (ไม่มีตารางต้นทุนในสคีมานี้)
--    y = จำนวนแบบที่ลูกค้าเห็นอยู่จริง (active ∧ published ∧ ทรงเปิด ∧ มีราคาตัวเรือน) · reason: stone_closed | no_offer | offer_closed | no_price
-- ============================================================================
drop function if exists analytics.rb_admin_catalog(uuid, uuid);
create function analytics.rb_admin_catalog(p_shop_id uuid, p_actor uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public', 'analytics', 'pg_temp'
as $f$
declare
  v_at     timestamptz := date_trunc('second', clock_timestamp());
  v_rng    int4range := analytics.rb_size_range();
  v_shapes jsonb;
  v_designs jsonb;
  v_stones jsonb;
begin
  perform analytics.rb_require_office(p_shop_id, p_actor);

  with dz as (
    select d.*, s.name_th as shape_name, s.render_kind, s.is_active as shape_active,
           bp.body_price_thb as body_price,
           (d.is_active and d.published_at is not null and s.is_active and bp.body_price_thb is not null) as visible
      from analytics.rb_design d
      join analytics.rb_gem_shape s on s.id = d.shape_id and s.shop_id = d.shop_id
      left join lateral (
        select p.body_price_thb from analytics.rb_design_price p where p.design_id = d.id and p.effective_from <= v_at order by p.effective_from desc limit 1) bp on true
     where d.shop_id = p_shop_id
  ), cov as (
    select st.id as stone_id, st.stone_no, dz.id as design_id, dz.design_no, dz.name as design_name, dz.stone_count, dz.shape_name,
           dz.stone_major_mm100 as major, dz.stone_minor_mm100 as minor, dz.visible,
           case when not st.is_active then 'stone_closed'
                when so.id is null then 'no_offer'
                when not so.is_active then 'offer_closed'
                when pr.price_thb is null then 'no_price' end as reason
      from analytics.rb_stone st
      cross join dz
      left join analytics.rb_stone_offer so on so.stone_id = st.id and so.shape_id = dz.shape_id and so.major_mm100 = dz.stone_major_mm100 and so.minor_mm100 = dz.stone_minor_mm100
      left join lateral (
        select p.price_thb from analytics.rb_offer_price p where p.offer_id = so.id and p.effective_from <= v_at order by p.effective_from desc limit 1) pr on so.id is not null
     where st.shop_id = p_shop_id
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'name_th', s.name_th, 'render_kind', s.render_kind, 'is_active', s.is_active, 'sort', s.sort,
        'status_changed_at', to_char(s.status_changed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'used_by_active_designs', (select count(*) from analytics.rb_design d where d.shape_id = s.id and d.is_active),
        'used_by_designs', (select count(*) from analytics.rb_design d where d.shape_id = s.id))
      order by s.sort, s.name_th), '[]'::jsonb) from analytics.rb_gem_shape s where s.shop_id = p_shop_id),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'id', z.id, 'design_no', z.design_no, 'name', z.name, 'stone_count', z.stone_count,
        'shape_id', z.shape_id, 'shape_name', z.shape_name, 'shape_kind', z.render_kind, 'shape_active', z.shape_active,
        'major_mm100', z.stone_major_mm100, 'minor_mm100', z.stone_minor_mm100, 'stone_axis', z.stone_axis,
        'size_min', z.size_min, 'size_max', z.size_max, 'body_price_thb', z.body_price, 'card_image_path', z.card_image_path,
        'is_active', z.is_active, 'published', (z.published_at is not null), 'locked', (z.published_at is not null),
        'visible', z.visible,
        'hidden_reason', case when z.published_at is null then 'draft' when not z.is_active then 'closed' when not z.shape_active then 'shape_closed' when z.body_price is null then 'no_price' end,
        'status_changed_at', to_char(z.status_changed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'sort', z.sort,
        'sellable_stones', (select count(*) from cov c where c.design_id = z.id and c.reason is null))
      order by z.stone_count, z.sort, z.design_no), '[]'::jsonb) from dz z),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'id', st.id, 'stone_no', st.stone_no, 'name_th', st.name_th, 'short_name', st.short_name, 'color_hex', st.color_hex,
        'is_active', st.is_active, 'sort', st.sort,
        'status_changed_at', to_char(st.status_changed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'offers', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', so.id, 'shape_id', so.shape_id, 'shape_name', sh.name_th, 'major_mm100', so.major_mm100, 'minor_mm100', so.minor_mm100,
                      'is_active', so.is_active,
                      'price_thb', (select p.price_thb from analytics.rb_offer_price p where p.offer_id = so.id and p.effective_from <= v_at order by p.effective_from desc limit 1))
                    order by sh.sort, so.major_mm100, so.minor_mm100), '[]'::jsonb)
                     from analytics.rb_stone_offer so join analytics.rb_gem_shape sh on sh.id = so.shape_id and sh.shop_id = so.shop_id
                    where so.stone_id = st.id),
        'coverage', jsonb_build_object(
          'visible_designs', (select count(*) from cov c where c.stone_id = st.id and c.visible),
          'sellable_designs', (select count(*) from cov c where c.stone_id = st.id and c.visible and c.reason is null),
          'missing', (select coalesce(jsonb_agg(jsonb_build_object(
                        'design_no', c.design_no, 'design_name', c.design_name, 'stone_count', c.stone_count,
                        'shape_name', c.shape_name, 'major_mm100', c.major, 'minor_mm100', c.minor, 'reason', c.reason)
                      order by c.stone_count, c.design_no), '[]'::jsonb)
                        from cov c where c.stone_id = st.id and c.visible and c.reason is not null)))
      order by st.sort, st.stone_no), '[]'::jsonb) from analytics.rb_stone st where st.shop_id = p_shop_id)
  into v_shapes, v_designs, v_stones;

  return jsonb_build_object(
    'catalog_at', to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'sizes', jsonb_build_object('min', lower(v_rng), 'max', upper(v_rng) - 1),
    'shapes', v_shapes, 'designs', v_designs, 'stones', v_stones);
end;
$f$;

-- ============================================================================
-- 8. rb_code_check — ตรวจรหัส (หลัง TS ตรวจ check char + HMAC แล้วเท่านั้น) · อ่านประวัติราคา "ไม่สน" is_active (คิดย้อนได้แม้ปิดแบบ/พลอย/ทรงไปแล้ว)
--    ลูกค้า: ราคา ณ ตอนสร้าง (priced_at) เทียบราคาปัจจุบัน แยกรายตำแหน่ง · ธง signed_total = ที่คิดย้อนได้ · สถานะแบบ/พลอยปัจจุบัน
--    p_size: null = "ให้แอดมินช่วยเช็ก" (sentinel 31 ในรหัส) · 45..68 · อื่น = invalid
-- ============================================================================
drop function if exists analytics.rb_code_check(uuid, uuid, integer, integer, integer[], timestamptz, integer);
create function analytics.rb_code_check(p_shop_id uuid, p_actor uuid, p_design_no integer, p_size integer, p_positions integer[], p_priced_at timestamptz, p_signed_total integer)
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public', 'analytics', 'pg_temp'
as $f$
declare
  v_rng      int4range := analytics.rb_size_range();
  v_now      timestamptz := date_trunc('second', clock_timestamp());
  v_then     timestamptz;
  v_d        record;
  v_n        integer;
  v_c_body   integer;
  v_n_body   integer;
  v_c_lines  jsonb;
  v_n_lines  jsonb;
  v_c_sum    bigint;
  v_n_sum    bigint;
  v_c_ok     boolean;
  v_n_ok     boolean;
  v_closed   jsonb;
  v_size_st  text;
begin
  perform analytics.rb_require_office(p_shop_id, p_actor);
  if p_design_no is null or p_design_no not between 1 and 4095 or p_positions is null or array_ndims(p_positions) is distinct from 1
     or array_lower(p_positions, 1) <> 1 or exists (select 1 from unnest(p_positions) u(x) where x is null or x not between 0 and 1023)
     or p_priced_at is null or p_signed_total is null or p_signed_total not between 0 and 262143
     or (p_size is not null and not v_rng @> p_size) then
    raise exception 'ข้อมูลรหัสไม่ถูกต้อง' using errcode = '22023', hint = 'invalid';
  end if;
  v_n := cardinality(p_positions);
  v_then := date_trunc('second', p_priced_at);

  select dz.id, dz.name, dz.stone_count, dz.shape_id, dz.stone_major_mm100 as major, dz.stone_minor_mm100 as minor, dz.size_min, dz.size_max,
         dz.is_active, dz.published_at, dz.status_changed_at, s.name_th as shape_name, s.render_kind, s.is_active as shape_active
    into v_d
    from analytics.rb_design dz
    join analytics.rb_gem_shape s on s.id = dz.shape_id and s.shop_id = dz.shop_id
   where dz.shop_id = p_shop_id and dz.design_no = p_design_no;
  if not found or v_d.published_at is null then
    -- รหัสที่ HMAC ถูกแต่ไม่มีแบบนี้ในระบบ (เช่น ฐานข้อมูลถูกย้อน) — ไม่ใช่รหัสผิด
    return jsonb_build_object('ok', true, 'found', false);
  end if;
  if v_n <> v_d.stone_count then
    raise exception 'จำนวนเม็ดในรหัสไม่ตรงกับแบบ' using errcode = '22023', hint = 'count_mismatch';
  end if;

  v_c_body := (select p.body_price_thb from analytics.rb_design_price p where p.design_id = v_d.id and p.effective_from <= v_then order by p.effective_from desc limit 1);
  v_n_body := (select p.body_price_thb from analytics.rb_design_price p where p.design_id = v_d.id and p.effective_from <= v_now order by p.effective_from desc limit 1);

  with req as (
    select u.stone_no, u.pos::integer as pos from unnest(p_positions) with ordinality as u(stone_no, pos)
  ), x as (
    select r.pos, r.stone_no, st.name_th, st.is_active as stone_active, so.is_active as offer_active,
           (select p.price_thb from analytics.rb_offer_price p where p.offer_id = so.id and p.effective_from <= v_then order by p.effective_from desc limit 1) as price_then,
           (select p.price_thb from analytics.rb_offer_price p where p.offer_id = so.id and p.effective_from <= v_now order by p.effective_from desc limit 1) as price_now
      from req r
      left join analytics.rb_stone st on r.stone_no > 0 and st.shop_id = p_shop_id and st.stone_no = r.stone_no
      left join analytics.rb_stone_offer so on st.id is not null and so.stone_id = st.id and so.shop_id = p_shop_id and so.shape_id = v_d.shape_id
                                            and so.major_mm100 = v_d.major and so.minor_mm100 = v_d.minor
  )
  select
    coalesce(jsonb_agg(jsonb_build_object('pos', x.pos, 'stone_no', x.stone_no, 'name', x.name_th, 'price', case when x.stone_no = 0 then 0 else x.price_then end) order by x.pos), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('pos', x.pos, 'stone_no', x.stone_no, 'name', x.name_th, 'price', case when x.stone_no = 0 then 0 else x.price_now end,
                                          'stone_active', case when x.stone_no = 0 then true else x.stone_active end,
                                          'offer_active', case when x.stone_no = 0 then true else x.offer_active end) order by x.pos), '[]'::jsonb),
    coalesce(sum(case when x.stone_no = 0 then 0 else x.price_then end), 0),
    coalesce(sum(case when x.stone_no = 0 then 0 else x.price_now end), 0),
    coalesce(bool_and(x.stone_no = 0 or x.price_then is not null), true),
    coalesce(bool_and(x.stone_no = 0 or x.price_now is not null), true),
    coalesce(jsonb_agg(distinct jsonb_build_object('stone_no', x.stone_no, 'name', x.name_th))
             filter (where x.stone_no > 0 and (x.stone_active is not true or x.offer_active is not true)), '[]'::jsonb)
    into v_c_lines, v_n_lines, v_c_sum, v_n_sum, v_c_ok, v_n_ok, v_closed
    from x;
  v_c_ok := v_c_ok and v_c_body is not null;
  v_n_ok := v_n_ok and v_n_body is not null;

  v_size_st := case when p_size is null then 'admin_check'
                    when p_size between v_d.size_min and v_d.size_max then 'ok'
                    else 'out_of_range' end;

  return jsonb_build_object(
    'ok', true, 'found', true,
    'design', jsonb_build_object(
      'no', p_design_no, 'name', v_d.name, 'stone_count', v_d.stone_count, 'shape_kind', v_d.render_kind, 'shape_name', v_d.shape_name,
      'major_mm100', v_d.major, 'minor_mm100', v_d.minor, 'size_min', v_d.size_min, 'size_max', v_d.size_max,
      'is_active', v_d.is_active, 'shape_active', v_d.shape_active,
      'status_changed_at', to_char(v_d.status_changed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    'size_status', v_size_st,
    'creation', jsonb_build_object('at', to_char(v_then at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'complete', v_c_ok,
                                   'body', v_c_body, 'total', case when v_c_ok then v_c_body + v_c_sum end, 'lines', v_c_lines),
    'current', jsonb_build_object('at', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'complete', v_n_ok,
                                  'body', v_n_body, 'total', case when v_n_ok then v_n_body + v_n_sum end, 'lines', v_n_lines),
    'signed_total_match', (v_c_ok and v_c_body + v_c_sum = p_signed_total),
    'closed_stones', v_closed);
end;
$f$;

-- ============================================================================
-- 9. storage bucket 'ring-builder' — public read (รูปการ์ดแบบ) · 1 MB · image/jpeg · ไม่มี storage policy (เขียน/ลบผ่าน service role ซึ่ง bypass storage RLS)
--    path = designs/<uuid สุ่ม>.jpg (rb_design_card_ck) — ร่างที่ยังไม่ publish เดา URL ไม่ได้
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ring-builder', 'ring-builder', true, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

do $b$
begin
  if not exists (select 1 from storage.buckets b where b.id = 'ring-builder' and b.public = true and b.file_size_limit = 1048576 and b.allowed_mime_types = array['image/jpeg']) then
    raise exception '0196: bucket ring-builder ต้อง public · 1 MB · image/jpeg (มี bucket ชื่อนี้อยู่ก่อนด้วยค่าอื่น — หยุดตรวจ)';
  end if;
  if exists (select 1 from pg_policies p where p.schemaname = 'storage' and p.tablename in ('objects', 'buckets') and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%ring-builder%') then
    raise exception '0196: ไม่ควรมี storage policy ที่อ้าง ring-builder (เขียนผ่าน service role เท่านั้น)';
  end if;
end;
$b$;

-- ============================================================================
-- 10. สิทธิ์ — service_role เท่านั้น (ข้อ 2, 7, 18) · ปิดทุกอย่างก่อนแล้วเปิดเฉพาะที่ตั้งใจ
--     ตาราง: select อย่างเดียว (RPC INVOKER อ่านในฐานะ service_role) · ไม่มี insert/update/delete/truncate/maintain — เขียนได้ทาง RPC definer เท่านั้น
-- ============================================================================
revoke all on analytics.rb_gem_shape, analytics.rb_design, analytics.rb_design_price, analytics.rb_stone, analytics.rb_stone_offer, analytics.rb_offer_price
  from public, anon, authenticated, service_role;
grant select on analytics.rb_gem_shape, analytics.rb_design, analytics.rb_design_price, analytics.rb_stone, analytics.rb_stone_offer, analytics.rb_offer_price
  to service_role;

do $g$
declare
  r record;
  v_rpc constant text[] := array[
    'rb_public_catalog', 'rb_quote', 'rb_size_range',
    'rb_shape_upsert', 'rb_stone_upsert', 'rb_offer_upsert', 'rb_offer_price_set', 'rb_design_upsert', 'rb_design_price_set',
    'rb_design_card_set', 'rb_design_publish', 'rb_design_duplicate', 'rb_set_active', 'rb_admin_catalog', 'rb_code_check'];
  v_internal constant text[] := array[
    'rb_text_ok', 'rb_append_only', 'rb_deny_truncate', 'rb_shape_guard', 'rb_design_guard', 'rb_stone_guard', 'rb_offer_guard', 'rb_require_office'];
  v_dup text;
  v_n int;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p
     where p.pronamespace = 'analytics'::regnamespace and (p.proname = any (v_rpc) or p.proname = any (v_internal))
  loop
    -- 4 ชื่อเสมอ: public/anon/authenticated มาจากคนละทาง (ข้อ 18.1) · default privilege ของสคีมาให้ service_role ทุกฟังก์ชันใหม่ → ถอนก่อนแล้วให้เฉพาะ RPC
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname = any (v_rpc) then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
  select string_agg(proname, ', ') into v_dup from (
    select proname from pg_proc where pronamespace = 'analytics'::regnamespace and (proname = any (v_rpc) or proname = any (v_internal))
    group by proname having count(*) > 1) d;
  if v_dup is not null then
    raise exception '0196: พบ overload ของฟังก์ชัน: %', v_dup;
  end if;
  select count(distinct proname) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and (proname = any (v_rpc) or proname = any (v_internal));
  if v_n <> cardinality(v_rpc) + cardinality(v_internal) then
    raise exception '0196: ฟังก์ชันที่ประกาศ % ตัว แต่พบใน pg_proc % ชื่อ', cardinality(v_rpc) + cardinality(v_internal), v_n;
  end if;
end;
$g$;

comment on table analytics.rb_design is
  '0196: แบบแหวนแถว (Ring Builder) — ล็อก จำนวนเม็ด/ทรง/ขนาดเม็ด/ทิศ หลัง published_at (trigger) · ราคาตัวเรือนอยู่ rb_design_price (insert-only) · model = P2 (null ใน P1)';
comment on table analytics.rb_offer_price is
  '0196: ราคาขายพลอยต่อเม็ด (THB จำนวนเต็ม) ตามทรง×ขนาด — insert-only · แยกจากต้นทุนพลอยงานผลิต (analytics.gem_item_price ของ 0190) โดยสิ้นเชิง: ห้าม join/อ้างตารางนั้นจาก rb_* (rb_public_catalog/rb_quote เป็น INVOKER ใต้ service_role ที่ไม่มีสิทธิ์ตารางนั้น)';
