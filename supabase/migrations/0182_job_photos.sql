-- 0182_job_photos.sql — รูปสินค้าบนใบงาน ฝั่ง DB (design-job-photos.md §2 · §6.1 · §9 · §10.1 มติเจ้าของ 19 ต.ค. 69)
-- ต่อจาก 0181 (L1 — apply แล้ว 19 ต.ค. 69 · ไฟล์ 0181 อยู่บนสาย feature/job-lots-l1 ยังไม่เข้า main) · def ของ job_worker_resolve ลอกจาก pg_get_functiondef บน DB สด (md5 f2e6916841cdf122eccd93316390810b = ฉบับ 0181)
-- สถานะ: ยังไม่ apply · apply ด้วย node scripts/run-sql.mjs --commit --record เท่านั้น (พึ่งทรานแซกชันที่ runner ครอบทั้งไฟล์: temp table on commit drop) · ห้าม supabase db push · ไฟล์ต้องเป็น LF
--
-- ทำไม: เจ้าของสั่ง "ในใบงานควรจะมีรูปสินค้าไปด้วย จะได้รู้ว่าทำงานอันนี้ถูกต้องไหม บางทีช่างดูจากชื่อสินค้าหรือ sku จะไม่รู้" — ออฟฟิศอัปโหลดรูปอ้างอิงที่ /jobs/[id] · รูปหลักพิมพ์บน A5 · ช่างเห็นบน /w/ หลังใส่ PIN
-- รูปเป็นของ "ใบแม่" (ส่วนย่อย/ใบย่อย/ใบส่งของใช้รูปแม่) · copy ไม่ใช่ link ไปรูป SKU · bucket private ไม่มี URL ถาวร (บทเรียน 0105) · ไม่มีตัวเลขเงินในไฟล์นี้
--
-- สิ่งที่ migration นี้ทำ
--  1 storage bucket 'job-photos' (private · 1 MB · image/jpeg · ไม่มี storage policy — ทุก read/write ผ่าน service client ฝั่ง server)
--  2 ตาราง analytics.job_photo (RLS เปิดไม่มี policy · service_role select อย่างเดียว · เขียนผ่าน RPC definer เท่านั้น) + path = <shop>/<job>/<photo_id>_md.jpg|_sm.jpg บังคับด้วย CHECK (id มาจาก path)
--  3 trigger: job_photo_guard (INSERT: ใบแม่ในร้านเดียวกัน · UPDATE: แก้ได้เฉพาะรูปหลัก/ลำดับ/caption/ลบ · DELETE ปฏิเสธเสมอ) · job_photo_enforce_cap (5 reference · 20 รวม · 330 MB (md+sm) ต่อร้าน — advisory lock)
--  4 RPC ออฟฟิศ: job_photo_add · job_photo_remove · job_photo_set_primary · job_photo_reorder · job_photo_catalog_source (อ่านรูปหลักของ SKU ให้ action copy)
--  5 job_event: + 'photo_remove' · 'photo_primary' · 'photo_reorder' · job_worker_resolve (replace · signature เดิม): + job.photos เฉพาะหลังระบุตัวช่าง · ไม่มีรูป = ไม่มี key (ผลเดิมเป๊ะ)
--  6 สิทธิ์ service_role เท่านั้น (ข้อ 18) · post-check: md5 ฟังก์ชันอื่นไม่ขยับ · ไม่มี overload · bucket private · ไม่มี policy
--
-- ตัดสินเอง (นอก design — เหตุผล)
--  (1) มติเจ้าของ §10.1 Q1 ทับ design §2.3/§5: ใบ done/cancelled เพิ่ม/ลบ/ตั้งหลัก/เรียงรูปได้ (job_office_begin p_allow_terminal = true) · ยังเก็บ audit ใคร/เมื่อไร (soft delete + job_event) · ไม่มี job_closed ในชุดรูป
--  (2) path ผูกกับ id ด้วย CHECK (storage_path = shop/job/id_md.jpg) — design เขียนแค่ "ตรวจรูปแบบ + uuid เดียวกัน" · ผมให้ id ของแถว = uuid ใน path เพื่อให้ client เดาชื่อ/ยัด path ที่ไม่ใช่ของตัวเองไม่ได้แม้เขียนตาราง
--  (3) bytes = ขนาด md + sm รวมกัน (security L1: budget เดิมนับแค่ md ⇒ ดิสก์จริงเกินที่ตั้ง ~⅓) · CHECK 1..2 MB (= 2 × เพดานรายไฟล์ 1 MB ของ bucket) · budget ร้าน 330 MB = ของเดิม 250 MB(md) + sm ≈ ⅓ ⇒ ตัวเลขที่ DB นับ = ที่ใช้ดิสก์จริง
--  (4) partial unique (job_id, product_image_id) เมื่อไม่ลบ — กดดึงรูปแคตตาล็อกซ้ำ/ 2 แท็บ = ไม่ได้รูปซ้ำ (hint photo_catalog_dup)
--  (5) job_worker_resolve ส่งเฉพาะ kind='reference' (design ไม่ระบุ kind) — รูปผลงานต่อขั้น (W2b) ยังไม่มี และต้องออกแบบการแสดงแยกตอนนั้น
--  (6) job_photo_catalog_source เป็น RPC (design ให้ action SELECT product_image ตรง) — ผูก job↔product↔ร้านในที่เดียวและทดสอบใน DB ได้ · อ่านอย่างเดียว ไม่เขียน product_image/product-images
--  (7) trigger ปล่อยให้ FK on delete set null แก้ product_image_id → null ได้ (ลบรูปแคตตาล็อกต้องไม่ติดด่านของรูปใบงาน) · การแก้อย่างอื่นของแถวที่ลบแล้ว = ปฏิเสธ
--  (8) [security L4] ตั้งรูปหลัก/เรียงรูป เขียน job_event (photo_primary · photo_reorder) — ใบปิดแล้วก็แก้รูปได้ตามมติ จึงต้องมีร่องรอยว่าใครเปลี่ยนรูปที่พิมพ์/ที่ช่างเห็นเมื่อไร (ทับ design §5 ที่ให้ไม่เขียน) · เขียนเฉพาะเมื่อเปลี่ยนจริง (ตั้งรูปที่เป็นหลักอยู่แล้ว/ส่งลำดับเดิม = ไม่มี event) · payload มีเฉพาะ id (ไม่มี path)
--  (9) [security H1] ด่าน Exif/GPS ย้ายเป็น "ตัด metadata ระดับ marker ฝั่ง server ก่อนเก็บ" (lib/images/server.ts stripJpegMetadata) แทนปฏิเสธไฟล์ที่มี APP1 — ไม่มีผลต่อ SQL ไฟล์นี้ (DB ไม่เห็น bytes ของไฟล์)
--
-- หนี้ที่รู้ตัว (ไม่ทำในไฟล์นี้)
--  [security L2] ไฟล์ค้างใน bucket job-photos: upload สำเร็จแต่ RPC ล้มแล้วลบ object ล้มซ้ำ / ลบรูปแล้ว remove object ล้ม = object ไม่มีแถว active ชี้ — ยังไม่มีงานเก็บกวาด (ต้องเขียน script เทียบ storage.objects กับ job_photo ที่ deleted_at is null) · budget นับเฉพาะแถว active จึงไม่เห็นไฟล์ค้างพวกนี้
--
-- race 2 connection ของ cap/budget: ไม่มีเทสต์ใน do-block (ทรานแซกชันเดียวจำลองไม่ได้) — pattern advisory lock เหมือน 0104/0105 เป๊ะ

-- baseline ก่อนแตะ: ฟังก์ชันทุกตัวในสคีมา (md5) + ตัวชี้วัดแถวของตารางใบงาน
create temp table _j182_fn_base on commit drop as
select p.oid::regprocedure::text as sig, p.proname, md5(pg_get_functiondef(p.oid)) as h
from pg_proc p
where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f';

create temp table _j182_row_base on commit drop as
select 'job'::text as t, count(*) as n, coalesce(md5(string_agg(j::text, '|' order by j.id)), '') as h from analytics.job j
union all
select 'job_stage', count(*), coalesce(md5(string_agg(s::text, '|' order by s.id)), '') from analytics.job_stage s
union all
select 'job_event', count(*), coalesce(md5(string_agg(e::text, '|' order by e.id)), '') from analytics.job_event e
union all
select 'job_token', count(*), coalesce(md5(string_agg(k.id::text || coalesce(k.revoked_at::text, ''), '|' order by k.id)), '') from analytics.job_token k
union all
select 'job_counter', count(*), coalesce(md5(string_agg(c::text, '|' order by c::text)), '') from analytics.job_counter c
union all
select 'product_image', count(*), coalesce(md5(string_agg(pi::text, '|' order by pi.id)), '') from public.product_image pi;

-- ============================================================================
-- 0. pre-check
-- ============================================================================
do $p$
declare
  v_n int;
  v_def text;
  v_h text;
begin
  perform 1 from pg_temp._j182_fn_base limit 1;  -- รันแบบ autocommit ตารางหาย ⇒ ล้มก่อน DDL ใดๆ
  if to_regclass('analytics.job_discrepancy') is null or to_regprocedure('analytics.job_office_begin(text,uuid,uuid,uuid,boolean)') is null then
    raise exception '0182: ยังไม่พบ 0181 (job_discrepancy / job_office_begin) — apply 0181 ก่อน';
  end if;
  if to_regclass('public.product_image') is null or to_regprocedure('analytics.job_text_clean(text,text,integer,boolean)') is null then
    raise exception '0182: ไม่พบ public.product_image (0104) หรือ job_text_clean — ตรวจฐานข้อมูล';
  end if;
  select count(*) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'job_worker_resolve';
  if v_n <> 1 then
    raise exception '0182: job_worker_resolve มี % signature (ต้องมี 1) — หยุดตรวจ overload ก่อน', v_n;
  end if;
  select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'job_worker_resolve';
  v_h := md5(v_def);
  -- ฉบับที่ลอกมา = 0181 (md5 จาก DB สด 19 ต.ค. 69) หรือฉบับ 0182 แล้ว (รันซ้ำ — มีเครื่องหมาย 0182 ในตัวฟังก์ชัน)
  if v_h <> 'f2e6916841cdf122eccd93316390810b' and position('0182' in v_def) = 0 then
    raise exception '0182: def ของ job_worker_resolve บน DB ไม่ใช่ฉบับ 0181 ที่ลอกมา (md5 %) — มีคนแก้นอก migration · หยุด ห้าม replace ทับ', v_h;
  end if;
  if not exists (select 1 from pg_constraint c where c.conrelid = 'analytics.job_event'::regclass and c.conname = 'job_event_event_type_ck'
                   and pg_get_constraintdef(c.oid) like '%discrepancy_resolve%') then
    raise exception '0182: job_event_event_type_ck ไม่ใช่ฉบับ 0181 (ไม่พบ discrepancy_resolve) — ลอกรายการผิดฉบับ · หยุด';
  end if;
  raise notice '0182: ใบงานเดิม % ใบ (ไม่มี UPDATE แถวเดิมในไฟล์นี้)', (select count(*) from analytics.job);
end;
$p$;

-- ============================================================================
-- 1. bucket 'job-photos' — private ตั้งแต่แรก · ไม่มี policy (0104 + บทเรียน 0105)
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-photos', 'job-photos', false, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

-- รันซ้ำ: ถ้ามีคนแก้ bucket นอก migration ให้กลับเป็นค่าที่ตั้งใจ (แถวเดิมที่ตรงอยู่แล้วไม่ถูกแตะ)
update storage.buckets
   set public = false, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg']
 where id = 'job-photos'
   and (public is distinct from false or file_size_limit is distinct from 1048576 or allowed_mime_types is distinct from array['image/jpeg']);

-- ============================================================================
-- 2. job_event: + photo_remove (ลอกรายการล่าสุดจาก 0181 — ตรวจแล้วใน pre-check ว่ามี discrepancy_resolve)
-- ============================================================================
alter table analytics.job_event drop constraint if exists job_event_event_type_ck;
alter table analytics.job_event add constraint job_event_event_type_ck check (event_type = any (array[
  'create', 'stage_receive', 'stage_send', 'stage_skip', 'stage_reopen', 'weigh', 'scrap', 'batch_join', 'batch_leave', 'due_set', 'hold', 'resume',
  'photo_add', 'note', 'done', 'cancel', 'token_issue', 'token_revoke', 'plan_change', 'surplus_set', 'profile_set',
  'split', 'split_cancel', 'discrepancy', 'discrepancy_resolve', 'photo_remove', 'photo_primary', 'photo_reorder']));

-- ============================================================================
-- 3. ตาราง analytics.job_photo
-- ============================================================================
create table if not exists analytics.job_photo (
  id               uuid primary key default gen_random_uuid(),
  shop_id          uuid not null references public.shop (id) on delete restrict,
  job_id           uuid not null,
  kind             text not null check (kind in ('reference', 'stage')),
  job_stage_id     uuid,
  source           text not null check (source in ('office', 'shopfloor', 'product')),
  product_image_id uuid references public.product_image (id) on delete set null,
  storage_path     text not null,
  variant_sm_path  text not null,
  bytes            int  not null check (bytes between 1 and 2097152), -- md + sm รวมกัน (ไฟล์ละ ≤ 1 MB ที่ bucket)
  width            int  check (width is null or width between 1 and 100000),
  height           int  check (height is null or height between 1 and 100000),
  is_primary       boolean not null default false,
  sort_order       int  not null default 0 check (sort_order >= 0),
  caption          text check (caption is null or length(caption) between 1 and 60),
  uploaded_by      uuid,
  worker_id        uuid,
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  deleted_by       uuid,
  delete_reason    text check (delete_reason is null or length(delete_reason) between 1 and 300),
  constraint job_photo_job_fk foreign key (job_id, shop_id) references analytics.job (id, shop_id) on delete restrict,
  constraint job_photo_stage_fk foreign key (job_stage_id, job_id) references analytics.job_stage (id, job_id) on delete restrict,
  constraint job_photo_worker_fk foreign key (worker_id, shop_id) references analytics.worker (id, shop_id) on delete restrict,
  constraint job_photo_path_uq unique (storage_path),
  constraint job_photo_sm_path_uq unique (variant_sm_path),
  -- path ผูกกับ id/ร้าน/ใบ ตายตัว: uuid ทั้งสามมาจาก server/DB · ไม่มีชื่อไฟล์เดิม/SKU/ข้อความจาก client เข้าใกล้ path
  constraint job_photo_path_ck check (
    storage_path = shop_id::text || '/' || job_id::text || '/' || id::text || '_md.jpg'
    and variant_sm_path = shop_id::text || '/' || job_id::text || '/' || id::text || '_sm.jpg'),
  constraint job_photo_stage_ck check ((kind = 'stage') = (job_stage_id is not null)),
  constraint job_photo_primary_ck check (not is_primary or (kind = 'reference' and deleted_at is null)),
  constraint job_photo_who_ck check (
    (source in ('office', 'product') and uploaded_by is not null and worker_id is null)
    or (source = 'shopfloor' and worker_id is not null)),
  constraint job_photo_deleted_ck check (
    (deleted_at is null and deleted_by is null and delete_reason is null)
    or (deleted_at is not null and deleted_by is not null))
);

-- รูปหลัก ≤ 1 ต่อใบเสมอ (กำแพงสุดท้าย แม้เขียนตรงด้วยสิทธิ์สูง) · ดึงรูปแคตตาล็อกซ้ำไม่ได้รูปซ้ำ
create unique index if not exists job_photo_one_primary_uq on analytics.job_photo (job_id) where is_primary and deleted_at is null;
create unique index if not exists job_photo_product_image_uq on analytics.job_photo (job_id, product_image_id) where product_image_id is not null and deleted_at is null;
create index if not exists idx_job_photo_job on analytics.job_photo (job_id, sort_order, created_at, id) where deleted_at is null;
create index if not exists idx_job_photo_shop on analytics.job_photo (shop_id) where deleted_at is null;

alter table analytics.job_photo enable row level security;
-- ไม่มี policy: service_role (BYPASSRLS) อ่านผ่าน grant select ด้านล่าง · anon/authenticated ไม่มีสิทธิ์ทั้งตารางและสคีมา (ข้อ 18)

-- ============================================================================
-- 4. trigger — กัน service key เขียนตรงข้าม RPC (กันที่ trigger เท่านั้น — บทเรียน 0086/0088)
-- ============================================================================
create or replace function analytics.job_photo_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_shop uuid;
  v_parent uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'analytics.job_photo ห้ามลบแถว (แถวคือหลักฐานว่าใครลบรูปเมื่อไร — ใช้ job_photo_remove)' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    select j.shop_id, j.parent_job_id into v_shop, v_parent from analytics.job j where j.id = new.job_id;
    if not found or v_shop is distinct from new.shop_id then
      raise exception 'ไม่พบใบงานในร้านนี้' using errcode = '22023', hint = 'job_not_found';
    end if;
    if v_parent is not null then
      raise exception 'ส่วนย่อยไม่มีรูปของตัวเอง — ใช้รูปของใบแม่' using errcode = '22023', hint = 'lot_no_photo';
    end if;
    if new.deleted_at is not null or new.deleted_by is not null or new.delete_reason is not null then
      raise exception 'สร้างรูปที่ลบแล้วไม่ได้' using errcode = '22023', hint = 'already_deleted';
    end if;
  else
    -- UPDATE: แก้ได้เฉพาะ is_primary · sort_order · caption · deleted_at/by/reason · product_image_id เปลี่ยนได้ทางเดียวคือเป็น null (FK on delete set null ตอนแคตตาล็อกลบรูป)
    if (new.id, new.shop_id, new.job_id, new.kind, new.job_stage_id, new.source, new.storage_path, new.variant_sm_path, new.bytes, new.width, new.height, new.uploaded_by, new.worker_id, new.created_at)
       is distinct from
       (old.id, old.shop_id, old.job_id, old.kind, old.job_stage_id, old.source, old.storage_path, old.variant_sm_path, old.bytes, old.width, old.height, old.uploaded_by, old.worker_id, old.created_at) then
      raise exception 'analytics.job_photo: ฟิลด์ตัวตน/ไฟล์ของรูปแก้ไม่ได้ (อัปโหลดรูปใหม่แทน)' using errcode = '42501';
    end if;
    if new.product_image_id is distinct from old.product_image_id and new.product_image_id is not null then
      raise exception 'analytics.job_photo: product_image_id เปลี่ยนเป็นค่าอื่นไม่ได้' using errcode = '42501';
    end if;
    if old.deleted_at is not null then
      if (new.is_primary, new.sort_order, new.caption, new.deleted_at, new.deleted_by, new.delete_reason)
         is distinct from (old.is_primary, old.sort_order, old.caption, old.deleted_at, old.deleted_by, old.delete_reason) then
        raise exception 'รูปนี้ถูกลบไปแล้ว แก้ไม่ได้' using errcode = '22023', hint = 'already_deleted';
      end if;
      return new;
    end if;
  end if;

  -- caption/เหตุผลลบ: ต้องผ่าน job_text_clean แล้ว (ตัดช่องว่าง · ห้ามอักขระล่องหน/bidi/ขึ้นบรรทัด · ยาวไม่เกิน) — ค่าว่าง '' ไม่ผ่าน (ต้องเป็น null)
  if new.caption is not null and analytics.job_text_clean(new.caption, 'ป้ายรูป', 60, false) is distinct from new.caption then
    raise exception 'ป้ายรูปไม่ผ่านรูปแบบ (ต้องตัดช่องว่างหัวท้ายแล้ว)' using errcode = '22023', hint = 'caption_invalid';
  end if;
  if new.delete_reason is not null and analytics.job_text_clean(new.delete_reason, 'เหตุผลที่ลบรูป', 300, false) is distinct from new.delete_reason then
    raise exception 'เหตุผลที่ลบรูปไม่ผ่านรูปแบบ' using errcode = '22023', hint = 'reason_invalid';
  end if;
  return new;
end;
$f$;

-- เพดาน + budget: บังคับที่ DB ไม่ใช่แค่ app (ลอก pattern 0104/0105 — advisory lock ต่อใบ seed 2 · ต่อร้าน seed 3 แยกจาก product_image ที่ใช้ seed 0/1)
-- 🔴 ตัวเลข 5 / 20 / 330 MB (+ เพดาน bytes รวม 2 MB ที่ CHECK) อยู่ 2 ที่: ที่นี่ + lib/images/constants.ts (MAX_REFERENCE_PHOTOS · MAX_JOB_PHOTOS · JOB_PHOTOS_BUDGET_BYTES · JOB_PHOTO_TOTAL_MAX_BYTES) — ขยับพร้อมกัน
create or replace function analytics.job_photo_enforce_cap()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_ref int;
  v_all int;
  v_bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.job_id::text, 2));
  select count(*) filter (where p.kind = 'reference'), count(*) into v_ref, v_all
    from analytics.job_photo p where p.job_id = new.job_id and p.deleted_at is null;
  if new.kind = 'reference' and v_ref >= 5 then
    raise exception 'ใบงานนี้มีรูปอ้างอิงครบ 5 รูปแล้ว' using errcode = 'P0001', hint = 'photo_cap_ref';
  end if;
  if v_all >= 20 then
    raise exception 'ใบงานนี้มีรูปครบ 20 รูปแล้ว' using errcode = 'P0002', hint = 'photo_cap_total';
  end if;
  -- budget = bytes ของ md+sm รวม (security L1) · นับเฉพาะรูปที่ยังไม่ลบ (ไฟล์ของรูปที่ลบถูกลบจาก bucket จริงแล้ว)
  perform pg_advisory_xact_lock(hashtextextended(new.shop_id::text, 3));
  select coalesce(sum(p.bytes), 0) into v_bytes from analytics.job_photo p where p.shop_id = new.shop_id and p.deleted_at is null;
  if v_bytes + new.bytes > 330 * 1024 * 1024 then
    raise exception 'พื้นที่เก็บรูปใบงานของร้านเต็มแล้ว' using errcode = 'P0003', hint = 'photo_budget';
  end if;
  return new;
end;
$f$;

drop trigger if exists trg_job_photo_10_guard on analytics.job_photo;
create trigger trg_job_photo_10_guard before insert or update or delete on analytics.job_photo
  for each row execute function analytics.job_photo_guard();
drop trigger if exists trg_job_photo_20_cap on analytics.job_photo;
create trigger trg_job_photo_20_cap before insert on analytics.job_photo
  for each row execute function analytics.job_photo_enforce_cap();
drop trigger if exists trg_job_photo_deny_truncate on analytics.job_photo;
create trigger trg_job_photo_deny_truncate before truncate on analytics.job_photo
  for each statement execute function analytics.job_deny_truncate();

-- ============================================================================
-- 5. RPC ออฟฟิศ (security definer · p_actor · crm_require_owner_admin · job_office_begin ล็อกแถวใบ for update · ใบปิดแล้วแก้รูปได้ตามมติ Q1)
-- ============================================================================
create or replace function analytics.job_photo_add(
  p_shop_id uuid, p_job_id uuid, p_kind text, p_source text, p_storage_path text, p_variant_sm_path text, p_bytes integer,
  p_width integer default null, p_height integer default null, p_caption text default null, p_product_image_id uuid default null, p_actor uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor   uuid := coalesce(p_actor, auth.uid());
  v_job     analytics.job%rowtype;
  v_prefix  text;
  v_id      uuid;
  v_caption text;
  v_primary boolean;
  v_sort    int;
  v_con     text;
begin
  if p_shop_id is null or p_job_id is null then
    raise exception 'job_photo_add: p_shop_id และ p_job_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  v_job := analytics.job_office_begin('job_photo_add', p_shop_id, p_job_id, v_actor, true);
  if v_job.parent_job_id is not null then
    raise exception 'ส่วนย่อยไม่มีรูปของตัวเอง — ใช้รูปของใบแม่' using errcode = '22023', hint = 'lot_no_photo';
  end if;
  -- ประตูที่ยังปิด: รูปผลงานต่อขั้น (W2b) และรูปจากหน้างาน (W1) เปิดด้วย RPC ของช่างเอง ไม่ผ่านทางนี้
  if p_kind = 'stage' then
    raise exception 'รูปผลงานต่อขั้นยังไม่เปิดใช้' using errcode = '22023', hint = 'photo_not_yet';
  elsif p_kind is distinct from 'reference' then
    raise exception 'ชนิดรูปไม่ถูกต้อง' using errcode = '22023', hint = 'photo_kind_invalid';
  end if;
  if p_source is null or p_source not in ('office', 'product') then
    raise exception 'ที่มาของรูปไม่ถูกต้อง' using errcode = '22023', hint = 'photo_source_invalid';
  end if;
  -- path: <shop>/<job>/<uuid>_md.jpg + <shop>/<job>/<uuid>_sm.jpg (uuid เดียวกัน · พิมพ์เล็กล้วน) — shop/job มาจาก server ไม่ใช่ client
  v_prefix := p_shop_id::text || '/' || p_job_id::text || '/';
  if p_storage_path is null or p_variant_sm_path is null
     or p_storage_path !~ ('^' || v_prefix || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_md\.jpg$') then
    raise exception 'ตำแหน่งไฟล์รูปไม่ถูกต้อง' using errcode = '22023', hint = 'photo_path_invalid';
  end if;
  v_id := substr(p_storage_path, length(v_prefix) + 1, 36)::uuid;
  if p_variant_sm_path <> v_prefix || v_id::text || '_sm.jpg' then
    raise exception 'ตำแหน่งไฟล์รูปไม่ถูกต้อง' using errcode = '22023', hint = 'photo_path_invalid';
  end if;
  if p_bytes is null or not (p_bytes between 1 and 2097152) then
    raise exception 'ขนาดไฟล์รูปไม่ถูกต้อง (md + sm รวมไม่เกิน 2 MB)' using errcode = '22023', hint = 'photo_bytes_invalid';
  end if;
  if (p_width is not null and not (p_width between 1 and 100000)) or (p_height is not null and not (p_height between 1 and 100000)) then
    raise exception 'ขนาดภาพไม่ถูกต้อง' using errcode = '22023', hint = 'photo_dims_invalid';
  end if;
  begin
    v_caption := analytics.job_text_clean(p_caption, 'ป้ายรูป', 60, false);
  exception when others then
    raise exception 'ป้ายรูปไม่ถูกต้อง — ห้ามอักขระล่องหน/ขึ้นบรรทัดใหม่ และยาวไม่เกิน 60 ตัวอักษร' using errcode = '22023', hint = 'caption_invalid';
  end;
  -- ที่มาจากแคตตาล็อก: ต้องเป็นรูปของร้านนี้และของ SKU เดียวกับใบ · ไม่ใช่ที่มา = ห้ามส่ง product_image_id
  if p_source = 'product' then
    if p_product_image_id is null or v_job.product_id is null
       or not exists (select 1 from public.product_image pi where pi.id = p_product_image_id and pi.shop_id = p_shop_id and pi.product_id = v_job.product_id) then
      raise exception 'รูปแคตตาล็อกไม่ใช่ของสินค้าในใบงานนี้' using errcode = '22023', hint = 'photo_product_mismatch';
    end if;
  elsif p_product_image_id is not null then
    raise exception 'รูปที่อัปโหลดเองห้ามอ้างรูปแคตตาล็อก' using errcode = '22023', hint = 'photo_product_mismatch';
  end if;

  v_primary := not exists (select 1 from analytics.job_photo p where p.job_id = p_job_id and p.is_primary and p.deleted_at is null);
  select coalesce(max(p.sort_order) + 1, 0) into v_sort from analytics.job_photo p where p.job_id = p_job_id and p.deleted_at is null;
  begin
    insert into analytics.job_photo (id, shop_id, job_id, kind, source, product_image_id, storage_path, variant_sm_path, bytes, width, height,
                                     is_primary, sort_order, caption, uploaded_by)
    values (v_id, p_shop_id, p_job_id, 'reference', p_source, p_product_image_id, p_storage_path, p_variant_sm_path, p_bytes, p_width, p_height,
            v_primary, v_sort, v_caption, v_actor);
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'job_photo_product_image_uq' then
      raise exception 'ดึงรูปนี้จากแคตตาล็อกเข้าใบงานนี้แล้ว' using errcode = '22023', hint = 'photo_catalog_dup';
    end if;
    raise exception 'ไฟล์รูปนี้ลงทะเบียนแล้ว' using errcode = '22023', hint = 'photo_path_dup';
  end;
  perform analytics.job_event_write(p_job_id, null, 'photo_add', analytics.job_today(), v_actor, null, 'job_page', null,
    jsonb_build_object('photo_id', v_id, 'kind', 'reference', 'source', p_source, 'bytes', p_bytes, 'product_image_id', p_product_image_id, 'is_primary', v_primary));
  return jsonb_build_object('ok', true, 'photo_id', v_id, 'is_primary', v_primary);
end;
$f$;

create or replace function analytics.job_photo_remove(p_shop_id uuid, p_photo_id uuid, p_reason text default null, p_actor uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor  uuid := coalesce(p_actor, auth.uid());
  v_job_id uuid;
  v_ph     analytics.job_photo%rowtype;
  v_reason text;
  v_next   uuid;
begin
  if p_shop_id is null or p_photo_id is null then
    raise exception 'job_photo_remove: p_shop_id และ p_photo_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  select ph.job_id into v_job_id from analytics.job_photo ph where ph.id = p_photo_id and ph.shop_id = p_shop_id;
  if v_job_id is null then
    raise exception 'ไม่พบรูปนี้ในร้านนี้' using errcode = '22023', hint = 'photo_not_found';
  end if;
  perform analytics.job_office_begin('job_photo_remove', p_shop_id, v_job_id, v_actor, true);
  select * into v_ph from analytics.job_photo where id = p_photo_id for update;
  if v_ph.deleted_at is not null then
    raise exception 'รูปนี้ถูกลบไปแล้ว' using errcode = '22023', hint = 'already_deleted';
  end if;
  v_reason := analytics.job_text_clean(p_reason, 'เหตุผลที่ลบรูป', 300, false);
  update analytics.job_photo set deleted_at = now(), deleted_by = v_actor, delete_reason = v_reason, is_primary = false where id = p_photo_id;
  -- ลบรูปหลัก ⇒ เลื่อนรูป active ถัดไปขึ้นเป็นหลัก (ใบที่ยังมีรูปต้องมีรูปหลักเสมอ)
  if v_ph.is_primary then
    select p.id into v_next from analytics.job_photo p
     where p.job_id = v_ph.job_id and p.deleted_at is null and p.kind = 'reference' order by p.sort_order, p.created_at, p.id limit 1;
    if v_next is not null then
      update analytics.job_photo set is_primary = true where id = v_next;
    end if;
  end if;
  perform analytics.job_event_write(v_ph.job_id, null, 'photo_remove', analytics.job_today(), v_actor, null, 'job_page', null,
    jsonb_build_object('photo_id', p_photo_id, 'reason', v_reason));
  -- path ส่งกลับให้ server ลบ object ใน bucket (ไปถึง client ไม่ได้ — server action ไม่ส่งต่อ)
  return jsonb_build_object('ok', true, 'storage_path', v_ph.storage_path, 'variant_sm_path', v_ph.variant_sm_path, 'promoted_photo_id', v_next);
end;
$f$;

create or replace function analytics.job_photo_set_primary(p_shop_id uuid, p_photo_id uuid, p_actor uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor  uuid := coalesce(p_actor, auth.uid());
  v_job_id uuid;
  v_ph     analytics.job_photo%rowtype;
  v_prev   uuid;
begin
  if p_shop_id is null or p_photo_id is null then
    raise exception 'job_photo_set_primary: p_shop_id และ p_photo_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  select ph.job_id into v_job_id from analytics.job_photo ph where ph.id = p_photo_id and ph.shop_id = p_shop_id;
  if v_job_id is null then
    raise exception 'ไม่พบรูปนี้ในร้านนี้' using errcode = '22023', hint = 'photo_not_found';
  end if;
  perform analytics.job_office_begin('job_photo_set_primary', p_shop_id, v_job_id, v_actor, true);
  select * into v_ph from analytics.job_photo where id = p_photo_id for update;
  if v_ph.deleted_at is not null then
    raise exception 'รูปนี้ถูกลบไปแล้ว' using errcode = '22023', hint = 'already_deleted';
  end if;
  if v_ph.kind <> 'reference' then
    raise exception 'ตั้งเป็นรูปหลักได้เฉพาะรูปอ้างอิง' using errcode = '22023', hint = 'photo_kind_invalid';
  end if;
  -- ล้างตัวเก่าก่อนตั้งตัวใหม่ (partial unique index ตรวจทันทีทุกคำสั่ง) · ตัวเดิมเป็นหลักอยู่แล้ว = ไม่ทำอะไร (ไม่ใช่ error)
  if not v_ph.is_primary then
    select p.id into v_prev from analytics.job_photo p where p.job_id = v_job_id and p.is_primary and p.deleted_at is null;
    update analytics.job_photo set is_primary = false where job_id = v_job_id and is_primary and deleted_at is null;
    update analytics.job_photo set is_primary = true where id = p_photo_id;
    -- L4: ใบปิดแล้วก็แก้ได้ ⇒ ต้องมีร่องรอย (เฉพาะเมื่อเปลี่ยนจริง)
    perform analytics.job_event_write(v_job_id, null, 'photo_primary', analytics.job_today(), v_actor, null, 'job_page', null,
      jsonb_build_object('photo_id', p_photo_id, 'previous_photo_id', v_prev));
  end if;
  return jsonb_build_object('ok', true, 'photo_id', p_photo_id);
end;
$f$;

create or replace function analytics.job_photo_reorder(p_shop_id uuid, p_job_id uuid, p_ids uuid[], p_actor uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_job   analytics.job%rowtype;
  v_have  uuid[];
  v_old   uuid[];
begin
  if p_shop_id is null or p_job_id is null then
    raise exception 'job_photo_reorder: p_shop_id และ p_job_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  v_job := analytics.job_office_begin('job_photo_reorder', p_shop_id, p_job_id, v_actor, true);
  if v_job.parent_job_id is not null then
    raise exception 'ส่วนย่อยไม่มีรูปของตัวเอง — ใช้รูปของใบแม่' using errcode = '22023', hint = 'lot_no_photo';
  end if;
  -- ต้องเป็นชุดเดียวกับรูป active ของใบเป๊ะ: ไม่ขาด ไม่เกิน ไม่ซ้ำ ไม่มี null ไม่มีของใบอื่น/รูปที่ลบแล้ว
  select coalesce(array_agg(p.id order by p.id), '{}') into v_have from analytics.job_photo p where p.job_id = p_job_id and p.deleted_at is null;
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 20 or array_position(p_ids, null) is not null
     or v_have is distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(p_ids) as x) then
    raise exception 'ลำดับรูปต้องมีรูปทั้งหมดของใบนี้ครบ ไม่ซ้ำ ไม่ขาด' using errcode = '22023', hint = 'photo_set_mismatch';
  end if;
  select coalesce(array_agg(p.id order by p.sort_order, p.created_at, p.id), '{}') into v_old from analytics.job_photo p where p.job_id = p_job_id and p.deleted_at is null;
  update analytics.job_photo p set sort_order = o.ord - 1
    from unnest(p_ids) with ordinality as o(id, ord)
   where p.id = o.id and p.job_id = p_job_id;
  -- L4: event เฉพาะเมื่อลำดับเปลี่ยนจริง (ส่งลำดับเดิม = ไม่มี event · sort_order ถูกจัดให้เรียง 0..n-1 อยู่ดี)
  if v_old is distinct from p_ids then
    perform analytics.job_event_write(p_job_id, null, 'photo_reorder', analytics.job_today(), v_actor, null, 'job_page', null,
      jsonb_build_object('count', cardinality(p_ids), 'photo_ids', to_jsonb(p_ids)));
  end if;
  return jsonb_build_object('ok', true, 'count', cardinality(p_ids));
end;
$f$;

-- อ่านรูปหลักของ SKU ที่ผูกกับใบ ให้ server action copy เข้า bucket ใบงาน (อ่านอย่างเดียว · ไม่เขียน product_image / bucket product-images — ห้ามเขียนกลับ catalog)
-- ลำดับเดียวกับ getProducts: sort_order, created_at, id · ไม่มีรูป/ไม่มี SKU = found false (ไม่ใช่ error)
create or replace function analytics.job_photo_catalog_source(p_shop_id uuid, p_job_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_job analytics.job%rowtype;
  v_pi  public.product_image%rowtype;
begin
  if p_shop_id is null or p_job_id is null then
    raise exception 'job_photo_catalog_source: p_shop_id และ p_job_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  select * into v_job from analytics.job where id = p_job_id and shop_id = p_shop_id;
  if not found then
    raise exception 'ไม่พบใบงานในร้านนี้' using errcode = '22023', hint = 'job_not_found';
  end if;
  if v_job.parent_job_id is not null then
    raise exception 'ส่วนย่อยไม่มีรูปของตัวเอง — ใช้รูปของใบแม่' using errcode = '22023', hint = 'lot_no_photo';
  end if;
  if v_job.product_id is null then
    return jsonb_build_object('ok', true, 'found', false, 'reason', 'no_product');
  end if;
  select pi.* into v_pi from public.product_image pi
   where pi.shop_id = p_shop_id and pi.product_id = v_job.product_id order by pi.sort_order, pi.created_at, pi.id limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'found', false, 'reason', 'no_catalog_image');
  end if;
  return jsonb_build_object('ok', true, 'found', true, 'product_image_id', v_pi.id, 'md_path', v_pi.storage_path, 'sm_path', v_pi.variant_sm_path,
                            'bytes', v_pi.bytes, 'width', v_pi.width, 'height', v_pi.height);
end;
$f$;

-- ============================================================================
-- 6. job_worker_resolve (replace · signature เดิม 3 arg) — ลอกจาก pg_get_functiondef บน DB สด (ฉบับ 0181) + 3 จุดของ 0182 (v_photos · บล็อกอ่านรูป · key job.photos)
-- ============================================================================
CREATE OR REPLACE FUNCTION analytics.job_worker_resolve(p_token_hash text, p_session_hash text DEFAULT NULL::text, p_ip_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $f$
declare
  v_a        jsonb;
  v_job      analytics.job%rowtype;
  v_worker   uuid;
  v_wcodes   text[];
  v_hold     analytics.job_stage%rowtype;
  v_pend     analytics.job_stage%rowtype;
  v_prev     analytics.job_stage%rowtype;
  v_action   text := 'none';
  v_seq      int;
  v_code     text;
  v_name     text;
  v_need_w   boolean := false;
  v_prev_w   numeric := null;
  v_holder   text := null;
  v_paid     numeric;
  v_stages   jsonb;
  v_workers  jsonb := '[]'::jsonb;
  v_started  boolean;
  v_sq       boolean;
  v_sw       boolean;
  v_multi    boolean;
  v_open_disc boolean;
  v_any_active boolean;
  v_can_ext  boolean := false;
  v_parts    jsonb := '[]'::jsonb;
  v_acts     jsonb := '[]'::jsonb;
  v_has_send boolean := false;
  p          analytics.job%rowtype;
  ph         analytics.job_stage%rowtype;
  pp         analytics.job_stage%rowtype;
  pv         analytics.job_stage%rowtype;
  v_lbl      text;
  v_fname    text;
  v_days     int;
  v_cancel   boolean;
  dr         record;
  v_photos   jsonb := null;
begin
  -- 0181 + 0182 (รูปอ้างอิงของใบ — เฉพาะช่างที่ระบุตัวแล้ว)
  v_a := analytics.job_worker_auth(p_token_hash, p_session_hash, p_ip_hash, false, false, 'none');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  select * into v_job from analytics.job where id = (v_a ->> 'job_id')::uuid;
  v_worker := nullif(v_a ->> 'worker_id', '')::uuid;

  -- 0182: รูปอ้างอิงของใบแม่ (token ออกให้ใบแม่เท่านั้น — coalesce กันกรณี token ผูกส่วนย่อย) · เฉพาะหลังระบุตัว (ก่อน PIN ไม่มี key) · ไม่ลบแล้วเท่านั้น
  -- ไม่มีรูป ⇒ jsonb_agg = null ⇒ ไม่มี key photos ⇒ ผลเดิมเป๊ะ · path ถูก server ของช่าง sign แล้วทิ้ง (ไม่ถึงเบราว์เซอร์)
  if v_worker is not null then
    select jsonb_agg(jsonb_build_object('id', phx.id, 'sm_path', phx.variant_sm_path, 'md_path', phx.storage_path, 'is_primary', phx.is_primary, 'caption', phx.caption)
                     order by phx.is_primary desc, phx.sort_order, phx.created_at, phx.id)
      into v_photos
      from analytics.job_photo phx
     where phx.job_id = coalesce(v_job.parent_job_id, v_job.id) and phx.deleted_at is null and phx.kind = 'reference';
  end if;

  select * into v_hold from analytics.job_stage where job_id = v_job.id and status = 'received' limit 1;
  select * into v_pend from analytics.job_stage where job_id = v_job.id and status = 'pending' order by seq limit 1;
  select exists (select 1 from analytics.job_stage where job_id = v_job.id and status in ('received', 'sent')) into v_started;
  if v_hold.id is not null then
    select coalesce(w.display_name, v_hold.assignee_name) into v_holder from (select 1) x left join analytics.worker w on w.id = v_hold.worker_id;
  end if;

  -- ต้นไม้: มีส่วนย่อย (ไม่ยกเลิก) หรือมีส่วนต่างรอชี้แจง = หลายส่วน · ใบเดี่ยวทั่วไปทั้งหมดเป็น false ⇒ ทางเดิมทุกบรรทัด
  select exists (select 1 from analytics.job_discrepancy d2 where d2.root_job_id = v_job.id and d2.status = 'open'
                    and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = d2.id)) into v_open_disc;
  select (v_open_disc or exists (select 1 from analytics.job c where c.parent_job_id = v_job.id and c.status <> 'cancelled')) into v_multi;
  select exists (select 1 from analytics.job j join analytics.job_stage s on s.job_id = j.id
                  where (j.id = v_job.id or j.parent_job_id = v_job.id) and j.status not in ('done', 'cancelled') and s.status in ('received', 'pending')) into v_any_active;

  if not (v_any_active or v_open_disc) then
    -- QA 5: ทุกขั้นส่งต่อ/ข้ามครบแล้วแต่ออฟฟิศยังไม่ปิดงาน — ไม่ใช่ "ให้ระบุตัว"
    v_action := 'all_done';
  elsif v_worker is null then
    v_action := 'identify';
    -- รายชื่อช่างที่ทำงานของต้นไม้นี้ได้ (ขั้นที่ถือค้าง/ขั้นที่รอรับของทุกส่วน + ผู้ส่งที่มีส่วนต่างรอชี้แจง) — เฉพาะ id + ชื่อ
    select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'display_name', w.display_name) order by w.display_name), '[]'::jsonb)
      into v_workers
      from analytics.worker w
     where w.shop_id = v_job.shop_id and w.is_active
       and (cardinality(w.stage_codes) = 0
            or exists (select 1 from analytics.job j join analytics.job_stage s on s.job_id = j.id
                        where (j.id = v_job.id or j.parent_job_id = v_job.id) and j.status not in ('done', 'cancelled')
                          and s.stage_code = any (w.stage_codes)
                          and (s.status = 'received'
                               or (s.status = 'pending' and s.seq = (select min(s2.seq) from analytics.job_stage s2 where s2.job_id = j.id and s2.status = 'pending'))))
            or exists (select 1 from analytics.job_discrepancy d3 join analytics.job_stage fs on fs.id = d3.from_stage_id
                        where d3.root_job_id = v_job.id and d3.status = 'open'
                          and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = d3.id)
                          and (fs.worker_id = w.id or w.can_external)));
  else
    select w.stage_codes, w.can_external into v_wcodes, v_can_ext from analytics.worker w where w.id = v_worker;
    if v_hold.id is not null and v_hold.worker_id = v_worker then
      v_action := 'send'; v_seq := v_hold.seq; v_code := v_hold.stage_code; v_need_w := v_hold.weigh_required;
    elsif v_pend.id is not null then
      v_seq := v_pend.seq; v_code := v_pend.stage_code; v_need_w := v_pend.weigh_required;
      if v_job.status = 'on_hold' then
        v_action := 'on_hold';
      elsif not analytics.job_worker_can_do(v_wcodes, v_pend.stage_code) then
        v_action := 'not_your_stage';
      elsif v_hold.id is not null and ((v_job.metal = 'gold' and v_job.profile_id is null) or v_hold.weigh_required or v_hold.qty_split_out > 0) then
        -- QA N1: ขั้นก่อนบังคับชั่ง (หรือใบทองเดิม) ยังไม่ส่งต่อ -> บอกตั้งแต่ resolve ไม่ใช่ให้กดแล้วไป fail · 0181: ขั้นก่อนที่แยกส่วนออกไปแล้วปิดอัตโนมัติไม่ได้ = ผู้ถือต้องส่งส่วนที่เหลือก่อน
        v_action := 'prev_not_sent';
      else
        v_action := 'receive';
        -- 0176 (D6): ด่านมัดจำใช้ helper เดียวกับ job_core_receive
        if analytics.job_deposit_blocked(v_job) then
          v_action := 'awaiting_deposit';
        end if;
        select * into v_prev from analytics.job_stage
         where job_id = v_job.id and seq < v_pend.seq and status <> 'skipped' order by seq desc limit 1;
        -- N1: งานทองไม่ส่งน้ำหนักขั้นก่อนให้ผู้รับ (ชั่งแบบไม่รู้คำตอบ) · เงิน/ทองเหลืองส่งตามเดิม
        v_prev_w := case when v_job.metal = 'gold' then null else v_prev.weight_out_g end;
      end if;
    elsif v_hold.id is not null then
      v_action := 'held_by_other'; v_seq := v_hold.seq; v_code := v_hold.stage_code;
    end if;

    -- 0181: parts[] + my_actions[] ทั้งต้นไม้ (เฉพาะช่างที่ระบุตัวแล้ว)
    for p in select j.* from analytics.job j where (j.id = v_job.id or j.parent_job_id = v_job.id) and j.status <> 'cancelled' order by j.lot_seq loop
      v_lbl := v_job.job_no || case when p.parent_job_id is null then '' else ' · ส่วนที่ ' || p.lot_seq end;
      select * into ph from analytics.job_stage where job_id = p.id and status = 'received' limit 1;
      select * into pp from analytics.job_stage where job_id = p.id and status = 'pending' order by seq limit 1;
      select d4.name_th into v_fname from analytics.job_stage_def d4 where d4.shop_id = p.shop_id and d4.code = coalesce(ph.stage_code, pp.stage_code);
      v_days := analytics.job_today() - coalesce(ph.received_on, (select max(s3.sent_on) from analytics.job_stage s3 where s3.job_id = p.id), analytics.job_bkk_date(p.created_at));
      v_cancel := p.parent_job_id is not null and analytics.job_lot_return_blocker(p.id) is null
                  and exists (select 1 from analytics.job_stage s4 join analytics.job_stage ms on ms.id = s4.split_from_stage_id
                               join analytics.job_event e on e.job_id = ms.job_id and e.event_type = 'split' and e.payload ->> 'lot_job_id' = p.id::text
                              where s4.job_id = p.id and e.worker_id = v_worker and ms.worker_id = v_worker);
      v_parts := v_parts || jsonb_build_object(
        'lot_job_id', p.id, 'label', v_lbl, 'lot_seq', p.lot_seq, 'status', p.status, 'qty_planned', p.qty_planned,
        'qty_live', analytics.job_live_qty(p.id), 'stage_code', coalesce(ph.stage_code, pp.stage_code), 'stage_name', v_fname,
        'holder_name', case when ph.id is null then null else (select coalesce(w2.display_name, ph.assignee_name) from (select 1) x2 left join analytics.worker w2 on w2.id = ph.worker_id) end,
        'days', v_days, 'is_mine', ph.id is not null and ph.worker_id = v_worker, 'can_cancel_split', v_cancel);
      if p.status = 'done' then
        continue;
      end if;
      if ph.id is not null and ph.worker_id = v_worker then
        v_has_send := true;
        v_acts := v_acts || jsonb_build_object('lot_job_id', p.id, 'label', v_lbl, 'action', 'send', 'stage_seq', ph.seq, 'stage_code', ph.stage_code,
          'stage_name', (select d5.name_th from analytics.job_stage_def d5 where d5.shop_id = p.shop_id and d5.code = ph.stage_code),
          'weight_required', ph.weigh_required, 'scrap_qty_ask', ph.scrap_qty_ask, 'scrap_weight_ask', ph.scrap_weight_ask,
          'qty_hold', ph.qty_in - ph.qty_scrap - ph.qty_split_out, 'qty_expected', null, 'discrepancy_id', null, 'qty', null);
      end if;
      if pp.id is not null and p.status <> 'on_hold'
         and analytics.job_worker_can_do(v_wcodes, pp.stage_code)
         and not (ph.id is not null and (ph.worker_id = v_worker or (p.metal = 'gold' and p.profile_id is null) or ph.weigh_required or ph.qty_split_out > 0))
         and not analytics.job_deposit_blocked(p) then
        select * into pv from analytics.job_stage where job_id = p.id and seq < pp.seq and status <> 'skipped' order by seq desc limit 1;
        v_acts := v_acts || jsonb_build_object('lot_job_id', p.id, 'label', v_lbl, 'action', 'receive', 'stage_seq', pp.seq, 'stage_code', pp.stage_code,
          'stage_name', (select d6.name_th from analytics.job_stage_def d6 where d6.shop_id = p.shop_id and d6.code = pp.stage_code),
          'weight_required', pp.weigh_required, 'scrap_qty_ask', pp.scrap_qty_ask, 'scrap_weight_ask', pp.scrap_weight_ask,
          'qty_hold', null,
          'qty_expected', case when pv.id is null then p.qty_planned
                               else (case when pv.status = 'received' then pv.qty_in else pv.qty_out end) - analytics.job_disc_active_qty(pv.id, pp.id) end,
          'discrepancy_id', null, 'qty', null);
      end if;
      for dr in select dd.id, dd.qty, (dd.weight_gap_g is not null and p.metal = 'gold') as office_only, fs.seq as f_seq, fs.stage_code as f_code
                 from analytics.job_discrepancy dd join analytics.job_stage fs on fs.id = dd.from_stage_id
                where dd.job_id = p.id and dd.status = 'open' and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = dd.id)
                  and (fs.worker_id = v_worker or v_can_ext)
                order by dd.created_at loop
        v_acts := v_acts || jsonb_build_object('lot_job_id', p.id, 'label', v_lbl, 'action', 'explain', 'stage_seq', dr.f_seq, 'stage_code', dr.f_code,
          'stage_name', (select d7.name_th from analytics.job_stage_def d7 where d7.shop_id = p.shop_id and d7.code = dr.f_code),
          'weight_required', false, 'scrap_qty_ask', false, 'scrap_weight_ask', false,
          'qty_hold', null, 'qty_expected', null, 'discrepancy_id', dr.id, 'qty', dr.qty, 'office_only', dr.office_only);
      end loop;
    end loop;
  end if;

  -- 0176: flag ถามของเสียของขั้นที่ action ชี้ (flag = ถาม ไม่ใช่ด่าน DB)
  if v_seq is not null then
    select s.scrap_qty_ask, s.scrap_weight_ask into v_sq, v_sw from analytics.job_stage s where s.job_id = v_job.id and s.seq = v_seq;
  end if;

  select d.name_th into v_name from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = v_code;

  select coalesce(jsonb_agg(
           jsonb_build_object('seq', s.seq, 'code', s.stage_code, 'name', d.name_th, 'status', s.status)
           || case when v_worker is not null then
                jsonb_build_object('received_on', s.received_on, 'sent_on', s.sent_on,
                                   'worker_name', coalesce(w.display_name, s.assignee_name), 'auto_closed', s.auto_closed)
              else '{}'::jsonb end
           order by s.seq), '[]'::jsonb)
    into v_stages
    from analytics.job_stage s
    join analytics.job_stage_def d on d.shop_id = s.shop_id and d.code = s.stage_code
    left join analytics.worker w on w.id = s.worker_id
   where s.job_id = v_job.id;

  return jsonb_build_object(
    'ok', true,
    'job', case when v_worker is null
             then jsonb_build_object('job_no', v_job.job_no, 'status', v_job.status, 'stages', v_stages, 'has_profile', v_job.profile_id is not null)
             else jsonb_build_object('job_no', v_job.job_no, 'status', v_job.status, 'design_label', v_job.design_label,
                                     'sku', v_job.sku_snapshot, 'metal', v_job.metal, 'qty_planned', v_job.qty_planned,
                                     'due_date', v_job.due_date, 'stages', v_stages,
                                     'profile_name', v_job.profile_name, 'has_profile', v_job.profile_id is not null)
                                     || case when v_photos is null then '{}'::jsonb else jsonb_build_object('photos', v_photos) end end,
    'viewer', case when v_worker is null then null
              else jsonb_build_object('worker_id', v_worker, 'display_name', v_a ->> 'worker_name') end,
    'session_expired', (v_a ->> 'session_expired')::boolean,
    'next_action', case when v_multi and v_worker is not null then 'multi' else v_action end,
    'action_stage', case when v_seq is null or (v_multi and v_worker is not null) then null
                      else jsonb_build_object('seq', v_seq, 'code', v_code, 'name', v_name, 'weight_required', v_need_w,
                                           'scrap_qty_ask', coalesce(v_sq, true), 'scrap_weight_ask', coalesce(v_sw, false)) end,
    'prev_weight_out_g', case when v_multi and v_worker is not null then null else v_prev_w end,
    -- L1: ชื่อผู้ถือเห็นได้เฉพาะช่างที่ระบุตัวแล้ว
    'held_by', case when v_worker is null then null else v_holder end,
    'workers', v_workers,
    'scrap_reasons', case when (v_action = 'send' and not v_multi) or (v_multi and v_has_send)
                          then to_jsonb(array['porosity', 'broken', 'wrong_design', 'missing', 'other']) else '[]'::jsonb end,
    'parts', case when v_worker is null then null else v_parts end,
    'my_actions', case when v_worker is null then null else v_acts end
  );
end;
$f$;

-- ============================================================================
-- 7. สิทธิ์ — service_role เท่านั้น (migration-traps ข้อ 2, 7, 18) · ปิดทุกอย่างก่อนแล้วเปิดเฉพาะที่ตั้งใจ
-- ============================================================================
revoke all on analytics.job_photo from public, anon, authenticated, service_role;
-- อ่านอย่างเดียว (เขียนผ่าน RPC security definer เท่านั้น) · ไม่ให้ INSERT/UPDATE/DELETE/TRUNCATE กับ role ไหนเลย
grant select on analytics.job_photo to service_role;

do $g$
declare
  r record;
  v_touched constant text[] := array[
    'job_photo_guard', 'job_photo_enforce_cap', 'job_photo_add', 'job_photo_remove', 'job_photo_set_primary', 'job_photo_reorder', 'job_photo_catalog_source',
    'job_worker_resolve'];
  v_rpc constant text[] := array[
    'job_photo_add', 'job_photo_remove', 'job_photo_set_primary', 'job_photo_reorder', 'job_photo_catalog_source', 'job_worker_resolve'];
  v_dup text;
  v_n int;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p
     where p.pronamespace = 'analytics'::regnamespace and p.proname = any (v_touched)
  loop
    -- 4 ชื่อเสมอ: public/anon/authenticated มาจากคนละทาง (ข้อ 18.1) · trigger function ไม่ต้องมี execute ให้ใคร
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname = any (v_rpc) then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
  -- ห้ามมี overload (migration-traps ข้อ 1)
  select string_agg(proname, ', ') into v_dup from (
    select proname from pg_proc where pronamespace = 'analytics'::regnamespace and (proname like 'job\_%' or proname like 'worker\_%')
    group by proname having count(*) > 1) d;
  if v_dup is not null then
    raise exception '0182: พบ overload ของฟังก์ชัน: %', v_dup;
  end if;
  select count(*) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and proname = any (v_touched);
  if v_n <> cardinality(v_touched) then
    raise exception '0182: ฟังก์ชันที่ประกาศ % ตัว แต่พบใน pg_proc % ตัว', cardinality(v_touched), v_n;
  end if;
end;
$g$;

-- ============================================================================
-- 8. post-check: ไม่แตะของเดิมนอกรายการ · ข้อมูลเดิมไม่ขยับ · bucket private ไม่มี policy · สิทธิ์ปิด
-- ============================================================================
do $c$
declare
  v_changed text;
  v_new text;
  v_bad int;
  v_touched constant text[] := array['job_worker_resolve'];
  v_added constant text[] := array[
    'job_photo_guard', 'job_photo_enforce_cap', 'job_photo_add', 'job_photo_remove', 'job_photo_set_primary', 'job_photo_reorder', 'job_photo_catalog_source'];
begin
  -- (1) ฟังก์ชันเดิมนอกรายการ md5 ต้องเท่าเดิมเป๊ะ (job_* · worker_* · oem_* · production_* · stock_* ทุกตัวในสคีมา)
  select string_agg(b.sig, ', ') into v_changed
    from _j182_fn_base b
    left join pg_proc p on p.oid = to_regprocedure(b.sig)
   where b.proname <> all (v_touched) and (p.oid is null or md5(pg_get_functiondef(p.oid)) <> b.h);
  if v_changed is not null then
    raise exception '0182 แตะฟังก์ชันเดิมนอกรายการ (md5 ไม่เท่า/หาย): %', v_changed;
  end if;
  -- (2) job_worker_resolve เปลี่ยนจริง (มีเครื่องหมาย 0182) · ฟังก์ชันใหม่ = รายการที่ประกาศเท่านั้น
  if not exists (select 1 from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'job_worker_resolve' and position('0182' in pg_get_functiondef(p.oid)) > 0) then
    raise exception '0182: job_worker_resolve ยังไม่ใช่ฉบับ 0182';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_new
    from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
     and not exists (select 1 from _j182_fn_base b where b.sig = p.oid::regprocedure::text)
     and not (p.proname = any (v_added) or p.proname = any (v_touched));
  if v_new is not null then
    raise exception '0182: มีฟังก์ชันใหม่นอกรายการที่ประกาศ: %', v_new;
  end if;
  -- (3) แถวเดิมไม่ขยับ (job · job_stage · job_event · job_token · ตัวนับเลขใบงาน · product_image) — ไฟล์นี้ไม่มี UPDATE/INSERT ตารางเหล่านี้
  select string_agg(b.t, ', ') into v_changed
    from _j182_row_base b
    join (select 'job'::text as t, count(*) as n, coalesce(md5(string_agg(j::text, '|' order by j.id)), '') as h from analytics.job j
          union all select 'job_stage', count(*), coalesce(md5(string_agg(s::text, '|' order by s.id)), '') from analytics.job_stage s
          union all select 'job_event', count(*), coalesce(md5(string_agg(e::text, '|' order by e.id)), '') from analytics.job_event e
          union all select 'job_token', count(*), coalesce(md5(string_agg(k.id::text || coalesce(k.revoked_at::text, ''), '|' order by k.id)), '') from analytics.job_token k
          union all select 'job_counter', count(*), coalesce(md5(string_agg(c::text, '|' order by c::text)), '') from analytics.job_counter c
          union all select 'product_image', count(*), coalesce(md5(string_agg(pi::text, '|' order by pi.id)), '') from public.product_image pi) a on a.t = b.t
   where a.n <> b.n or a.h <> b.h;
  if v_changed is not null then
    raise exception '0182: แถวเดิมขยับในตาราง: %', v_changed;
  end if;
  -- (4) bucket private + จำกัดขนาด/ชนิด · ไม่มี storage policy ที่แตะ bucket นี้ (ไม่เปิด anon/authenticated)
  if not exists (select 1 from storage.buckets b where b.id = 'job-photos' and b.public = false and b.file_size_limit = 1048576 and b.allowed_mime_types = array['image/jpeg']) then
    raise exception '0182: bucket job-photos ต้อง private · 1 MB · image/jpeg';
  end if;
  select count(*) into v_bad from pg_policies p where p.schemaname = 'storage' and p.tablename in ('objects', 'buckets')
     and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%job-photos%';
  if v_bad > 0 then
    raise exception '0182: พบ storage policy ที่อ้าง job-photos % ตัว — ต้องไม่มี', v_bad;
  end if;
  -- (5) ตารางใหม่: RLS เปิด ไม่มี policy · trigger ครบ 3 (guard · cap · deny truncate) เปิดอยู่ · ไม่มีสิทธิ์ anon/authenticated/PUBLIC
  if not (select c.relrowsecurity from pg_class c where c.oid = 'analytics.job_photo'::regclass)
     or exists (select 1 from pg_policy where polrelid = 'analytics.job_photo'::regclass) then
    raise exception '0182: job_photo ต้องเปิด RLS และไม่มี policy';
  end if;
  if (select count(*) from pg_trigger t where t.tgrelid = 'analytics.job_photo'::regclass and not t.tgisinternal and t.tgenabled in ('O', 'A')) <> 3 then
    raise exception '0182: job_photo ต้องมี trigger เปิดอยู่ 3 ตัว (guard + cap + deny truncate)';
  end if;
  if has_table_privilege('anon', 'analytics.job_photo', 'select') or has_table_privilege('authenticated', 'analytics.job_photo', 'select')
     or has_table_privilege('service_role', 'analytics.job_photo', 'insert') or has_table_privilege('service_role', 'analytics.job_photo', 'update')
     or has_table_privilege('service_role', 'analytics.job_photo', 'delete') or not has_table_privilege('service_role', 'analytics.job_photo', 'select') then
    raise exception '0182: สิทธิ์ job_photo ผิด (ต้อง service_role select อย่างเดียว)';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_new
    from pg_proc p cross join lateral aclexplode(p.proacl) a
   where p.pronamespace = 'analytics'::regnamespace and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  if v_new is not null then
    raise exception '0182: พบฟังก์ชันในสคีมา analytics ที่ PUBLIC/anon/authenticated ถือ EXECUTE: %', v_new;
  end if;
  raise notice '0182: ฟังก์ชันเดิม % ตัว md5 เท่าเดิมทั้งหมด (ยกเว้น job_worker_resolve) · ฟังก์ชันใหม่ % ตัว · job_photo 0 แถว',
    (select count(*) from _j182_fn_base) - (select count(*) from _j182_fn_base where proname = any (v_touched)), cardinality(v_added);
end;
$c$;

comment on table analytics.job_photo is
  '0182: รูปอ้างอิงของใบงาน (ใบแม่เท่านั้น) · ไฟล์อยู่ bucket private job-photos path <shop>/<job>/<id>_md.jpg|_sm.jpg · เขียนผ่าน RPC job_photo_* เท่านั้น · ลบ = soft delete (แถวเป็นหลักฐาน) + ลบไฟล์จริงโดย server · ใบปิดแล้วแก้ได้ (มติ 19 ต.ค. 69)';
comment on column analytics.job_photo.product_image_id is
  '0182: ที่มา (provenance) เมื่อ source=product — ไม่ใช่ตัวชี้ไปอ่านไฟล์ (ไฟล์ copy มาแล้ว) · on delete set null ตอนแคตตาล็อกลบรูป';

notify pgrst, 'reload schema';
