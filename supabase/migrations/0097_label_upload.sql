-- 0097_label_upload.sql
-- Phase 1 ของระบบเก็บไฟล์ + อ่านใบปะหน้าพัสดุ -> เติม fact_order.province_code
-- ให้ออเดอร์ TH-XX (design: docs/3j-jewelry/analytics/design-label-upload.md,
-- approved 28 ส.ค. 2569 พร้อมคำตัดสินเจ้าของ 4 ข้อ)
--
-- ============================================================================
-- สิ่งที่ไฟล์นี้สร้าง
-- ============================================================================
-- 1) storage bucket 'shipping-labels' — private ล้วน ไม่มี storage policy (เข้า
--    ทาง service role ฝั่ง server เท่านั้น — แอปยังไม่มี anon key จริงอยู่แล้ว)
-- 2) analytics.label_file      — 1 แถว/ไฟล์ PDF ที่อัปโหลด
-- 3) analytics.stg_label_page  — 1 แถว/หน้า (1 ใบปะหน้า) ผลอ่าน+จับคู่จังหวัด
-- 4) analytics.label_apply_matched(uuid, uuid) — RPC เขียนจังหวัดกลับ fact_order
--    เฉพาะเคส matched ที่ยังไม่ apply ผ่าน guard เชิงโครงสร้าง
--    `fo.province_code = 'TH-XX'` (ทับข้อมูลดีไม่ได้โดยโครงสร้าง ไม่ใช่วินัย)
--
-- ทั้งไฟล์ idempotent — รันซ้ำได้ (create table if not exists / create or
-- replace function / on conflict do nothing ทุกจุด)
--
-- ============================================================================
-- ทำไมไม่ใช้ public.shipment / stg_import_batch เดิม (design §2)
-- ============================================================================
-- public.shipment มี FK เข้า public.orders ซึ่งว่างเปล่า (ยอดขายจริงอยู่
-- analytics.fact_order) — ยืมโครงสร้างนั้นมาใช้คือผูกโดเมนผิดตั้งแต่ต้น วันที่
-- OMS จริงเกิดจะต้องรื้อทั้งชุด จึงสร้างตารางใหม่ใน analytics ที่ผูกกับ
-- fact_order ตรงๆ
--
-- ============================================================================
-- ทำไม applied/skipped_has_province/conflict_cnt นับเป็น "รายหน้า (page)" ไม่ใช่
-- "รายแถว fact_order" — จุดที่ตัดสินเองนอกเหนือ design (design ไม่ได้ระบุหน่วยนับ)
-- ============================================================================
-- tracking เดียวอาจ map กับหลาย fact_order (รวมพัสดุ, design §5) — ถ้านับเป็น
-- แถว fact_order ตัวเลข applied จะไม่ตรงกับจำนวนใบที่แปะจริงที่พนักงานอัปโหลด
-- ทำให้ summary บนจอสับสน ("อัป 50 ใบ แต่ applied 63?") จึงนับเป็นรายหน้า/ใบ
-- เสมอ — fact_order_ids ต่อหน้ายังเก็บ array ครบทุกแถวที่ถูกเขียนจริงสำหรับ
-- revert (P2) และ audit
--
-- ============================================================================
-- แตะ: analytics.label_file (ใหม่) · analytics.stg_label_page (ใหม่) ·
--      analytics.label_apply_matched (ใหม่) · analytics.fact_order (เขียน
--      province_code ผ่าน RPC เท่านั้น ไม่แตะ schema)
-- ============================================================================

-- ============================================================================
-- 1. Storage bucket — private (ไม่มี public flag, ไม่มี storage.objects policy
--    ให้ anon/authenticated) เข้าถึงทาง service role ฝั่ง server เท่านั้น
--    (design §1 / §7)
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('shipping-labels', 'shipping-labels', false)
on conflict (id) do nothing;

-- ============================================================================
-- 2. analytics.label_file — 1 แถว/ไฟล์ PDF ที่อัปโหลด
-- ============================================================================

create table if not exists analytics.label_file (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  -- sha256 hex (64 ตัวอักษร) — ชื่อไฟล์จริงใน storage คือค่านี้เอง (design §1:
  -- "sha256 เป็นชื่อไฟล์ = dedupe โดยโครงสร้าง") ตรวจ format ที่ชั้น action
  file_sha256 text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  page_count int,
  status text not null default 'uploaded' check (
    status in ('uploaded', 'parsed', 'parse_failed', 'purged')
  ),
  parser_version text,
  uploaded_by uuid references auth.users (id) on delete set null,
  uploaded_at timestamptz not null default now(),
  parsed_at timestamptz,
  -- retention (design §7, คำตัดสินเจ้าของ 28 ส.ค.: 180 วัน ไม่ใช่ 90) — P1/P2
  -- เป็นปุ่ม manual ("ล้างไฟล์เก่า") ยังไม่ใช่ cron ตามช่อง purged_at นี้เก็บไว้
  -- เป็น audit trail ว่าลบเมื่อไหร่
  purged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_label_file_shop_sha256 unique (shop_id, file_sha256)
);

create index if not exists idx_label_file_shop_id on analytics.label_file (shop_id);

alter table analytics.label_file enable row level security;
-- ไม่มี policy ตั้งใจ — เข้าได้ทาง service role เท่านั้นจนกว่า auth A2 จะสลับ
-- action ทั้งชุดไปใช้ user-scoped client (เดียวกับ stg_import_batch/label
-- ตารางอื่นๆ ในโปรเจกต์นี้) ไม่ grant select/insert/update ให้ anon/authenticated

-- ============================================================================
-- 3. analytics.stg_label_page — 1 แถว/หน้า (1 ใบปะหน้า) ผลอ่าน+จับคู่จังหวัด
-- ============================================================================
-- ⚠️ PDPA (design §7, ข้อบังคับ): ห้ามเก็บ raw text ของหน้า และ match_detail
-- ห้ามมีชื่อ/เบอร์/ที่อยู่เต็มลูกค้า — เก็บได้แค่ candidates (code/nameTh) +
-- zipcode + ตำแหน่งตัวอักษรที่ใช้ตัดสิน ไฟล์ตัวจริงอยู่ storage อยู่แล้ว
-- re-parse ได้เสมอ ไม่จำเป็นต้องเก็บ text ซ้ำใน DB

create table if not exists analytics.stg_label_page (
  id uuid primary key default gen_random_uuid(),
  label_file_id uuid not null references analytics.label_file (id) on delete cascade,
  -- denormalized shop_id (เหมือน stg_order_import/stg_order_line_import) —
  -- ให้ RPC/query กรองตรงได้โดยไม่ต้อง join label_file ทุกครั้ง
  shop_id uuid not null references public.shop (id) on delete cascade,
  page_no int not null check (page_no > 0),
  -- id ของ parser ใน lib/labels/formats/ ที่ detect หน้านี้สำเร็จ (เช่น
  -- 'tiktok') null = detect ไม่ได้เลยสักตัว (match_status='undetected')
  detected_format text,
  tracking_no text,
  zipcode text,
  province_code text references analytics.dim_geo (province_code),
  match_status text not null check (
    match_status in (
      'matched', 'needs_review', 'conflict', 'order_not_found',
      'undetected', 'parse_failed'
    )
  ),
  -- candidates ({code,nameTh}[]) เท่านั้น — ห้ามมี PII (ดูคอมเมนต์หัวตาราง)
  match_detail jsonb,
  -- แถว fact_order ที่ label_apply_matched เขียนจริงสำหรับหน้านี้ (รองรับ
  -- tracking เดียวหลายออเดอร์/รวมพัสดุ — design §5) ใช้ตอน revert (P2)
  fact_order_ids uuid[],
  applied_at timestamptz,
  -- ค่า province_code ของ fact_order ก่อนถูกเขียน — เสมอ 'TH-XX' เพราะ guard
  -- โครงสร้างของ RPC เขียนทับได้เฉพาะแถวที่ยัง TH-XX เท่านั้น (เก็บไว้ให้ revert
  -- ยืนยันได้ว่า "ค่านี้เรา apply เอง" ไม่ทับที่คนแก้มือทีหลัง — P2)
  applied_prev_code text,
  created_at timestamptz not null default now(),
  constraint uq_stg_label_page_file_page unique (label_file_id, page_no)
);

create index if not exists idx_stg_label_page_shop_id on analytics.stg_label_page (shop_id);
create index if not exists idx_stg_label_page_file_id on analytics.stg_label_page (label_file_id);
create index if not exists idx_stg_label_page_tracking
  on analytics.stg_label_page (shop_id, tracking_no)
  where tracking_no is not null;

alter table analytics.stg_label_page enable row level security;
-- ไม่มี policy เหตุผลเดียวกับ label_file ด้านบน

-- OWN ADDITION: fact_order ไม่มี index บน tracking_no มาก่อน — RPC ข้างล่าง
-- และ action ฝั่ง app จะ query fact_order ด้วย (shop_id, tracking_no) ซ้ำๆ ต่อ
-- ไฟล์ที่ parse (matched ~2,721 หน้าตาม design §6) เพิ่ม index ไว้ที่นี่เพราะ
-- เป็น migration แรกที่ต้องพึ่ง query pattern นี้จริงจัง
create index if not exists idx_fact_order_shop_tracking
  on analytics.fact_order (shop_id, tracking_no)
  where tracking_no is not null;

-- ============================================================================
-- 4. analytics.label_apply_matched — เขียนจังหวัดกลับ fact_order เฉพาะเคส
--    matched ที่ยังไม่ apply (design §5)
-- ============================================================================
-- Concurrency: `for ... loop` ข้างล่างใช้ `select ... for update` บน
-- stg_label_page — ภายใต้ READ COMMITTED (default) แถวที่ถูกล็อกโดยอีก
-- transaction จะรอจนกว่า transaction นั้น commit แล้ว Postgres จะ re-check
-- เงื่อนไข WHERE ด้วยค่าล่าสุด ถ้าไม่ผ่านแล้ว (เช่น applied_at ถูกเซ็ตไปแล้ว)
-- แถวนั้นจะถูกข้ามอัตโนมัติ — สอง request ยิง RPC ตัวเดียวกันพร้อมกันจึงไม่มี
-- ทางเขียนซ้ำ ถึงอย่างนั้น guard เชิงโครงสร้าง `fo.province_code = 'TH-XX'`
-- บน UPDATE จริงยังคงเป็นด่านหลักเสมอ (ไม่พึ่ง lock อย่างเดียว)
--
-- Idempotent: เรียกซ้ำ (ไฟล์เดิม/หลัง re-parse) ได้ผลใน fact_order เท่ารอบ
-- เดียวเป๊ะ — เพราะ:
--   (a) หน้าที่ apply สำเร็จแล้ว (applied_at not null) ไม่ถูกหยิบมาประมวลผลซ้ำ
--   (b) ต่อให้ re-parse เคลียร์ applied_at ของหน้านั้นกลับเป็น null (ทับชุดเดิม
--       ทั้งไฟล์ — ฝั่ง action) การ UPDATE fact_order ครั้งถัดไปก็ยังกรองด้วย
--       `province_code = 'TH-XX'` อยู่ดี — ถ้าค่าถูกเขียนไปแล้วครั้งก่อน
--       (ไม่ใช่ TH-XX อีกต่อไป) ครั้งนี้จะไม่เจอแถวให้เขียน แล้วนับเป็น
--       skipped_has_province แทน ไม่เขียนซ้ำ/ไม่ error
--
-- ทดสอบ (ให้เจ้าของรันตอน apply จริงตามกับดักข้อ 11 — do-block + raise บังคับ
-- rollback ไม่แตะ state จริง):
--   T1: หน้า matched ที่ fact_order ยัง TH-XX -> applied เพิ่ม 1, province ถูกเขียน
--   T2: เรียกซ้ำทันที (ไฟล์เดิม, ไม่ re-parse) -> applied=0 (หน้าเดิม
--       applied_at not null แล้ว ไม่ถูกหยิบ) ค่าใน fact_order ไม่เปลี่ยน
--   T3: หน้า matched ที่ fact_order มี province ตรงกับที่ใบบอกอยู่แล้ว (ไม่ใช่
--       TH-XX) -> skipped_has_province เพิ่ม 1, ไม่มีการ UPDATE เกิดขึ้นจริง
--   T4: หน้า matched ที่ fact_order มี province อื่นที่ไม่ตรง (ไม่ใช่ TH-XX และ
--       ไม่ใช่ค่าที่ใบบอก) -> conflict_cnt เพิ่ม 1, match_status ของหน้านั้น
--       เปลี่ยนเป็น 'conflict', fact_order ไม่ถูกแตะเลย
--   T5: หน้า matched ที่ tracking_no ไม่ตรง fact_order แถวไหนเลย (ถูกลบ/แก้
--       tracking หลัง parse) -> match_status เปลี่ยนเป็น 'order_not_found'
--       (ปกติ action ชั้น JS จะกรองเคสนี้ออกไปตั้งแต่ parse แล้ว — เคสนี้ทดสอบ
--       เส้นทาง defensive ใน SQL เอง)
--   T6: เรียกด้วย p_file_id ของไฟล์ shop อื่น -> raise exception ("label file
--       not found for this shop") ไม่ใช่ 0 แถวเงียบๆ

create or replace function analytics.label_apply_matched(
  p_shop_id uuid,
  p_file_id uuid
)
 returns table(applied int, skipped_has_province int, conflict_cnt int)
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_page          record;
  v_applied       int := 0;
  v_skipped       int := 0;
  v_conflict      int := 0;
  v_updated_ids   uuid[];
  v_has_conflict  boolean;
  v_has_any_order boolean;
begin
  if p_shop_id is null or p_file_id is null then
    raise exception 'label_apply_matched: p_shop_id and p_file_id are required';
  end if;

  perform analytics.crm_require_owner_admin(p_shop_id);

  if not exists (
    select 1 from analytics.label_file lf
     where lf.id = p_file_id and lf.shop_id = p_shop_id
  ) then
    raise exception 'label_apply_matched: label file not found for this shop' using errcode = '22023';
  end if;

  for v_page in
    select slp.id, slp.tracking_no, slp.province_code
      from analytics.stg_label_page slp
     where slp.label_file_id = p_file_id
       and slp.shop_id = p_shop_id
       and slp.match_status = 'matched'
       and slp.applied_at is null
       and slp.tracking_no is not null
       and slp.province_code is not null
     order by slp.page_no
     for update
  loop
    v_has_any_order := exists (
      select 1 from analytics.fact_order fo
       where fo.shop_id = p_shop_id and fo.tracking_no = v_page.tracking_no
    );

    if not v_has_any_order then
      -- defensive path — ปกติ action ชั้น JS กรองเคสนี้ออกก่อน upsert แล้ว
      -- (tracking ไม่ตรง fact_order แถวไหนเลย) เผื่อออเดอร์ถูกลบระหว่างที่ไฟล์
      -- ยัง parsed ค้างอยู่
      update analytics.stg_label_page set match_status = 'order_not_found' where id = v_page.id;
      continue;
    end if;

    -- ออเดอร์มีจังหวัดอื่นที่ไม่ใช่ TH-XX และไม่ตรงกับที่ใบบอก -> conflict
    -- ห้ามเขียนทั้งสองทิศ (design §5)
    v_has_conflict := exists (
      select 1 from analytics.fact_order fo
       where fo.shop_id = p_shop_id
         and fo.tracking_no = v_page.tracking_no
         and fo.province_code <> 'TH-XX'
         and fo.province_code <> v_page.province_code
    );

    if v_has_conflict then
      update analytics.stg_label_page set match_status = 'conflict' where id = v_page.id;
      v_conflict := v_conflict + 1;
      continue;
    end if;

    -- guard เชิงโครงสร้าง: UPDATE นี้แตะได้เฉพาะแถวที่ยัง 'TH-XX' เท่านั้น —
    -- ทับข้อมูลดีไม่ได้ไม่ว่า caller จะส่งอะไรมา (ไม่ใช่แค่เช็คก่อนแล้วค่อย
    -- UPDATE แยก ซึ่งจะมีช่องแข่งกันได้)
    with updated as (
      update analytics.fact_order as fo
         set province_code = v_page.province_code,
             updated_at = now()
       where fo.shop_id = p_shop_id
         and fo.tracking_no = v_page.tracking_no
         and fo.province_code = 'TH-XX'
      returning fo.id
    )
    select array_agg(id) into v_updated_ids from updated;

    if v_updated_ids is not null and array_length(v_updated_ids, 1) > 0 then
      update analytics.stg_label_page
         set applied_at = now(),
             applied_prev_code = 'TH-XX',
             fact_order_ids = v_updated_ids
       where id = v_page.id;
      v_applied := v_applied + 1;
    else
      -- fact_order ทุกแถวที่ตรง tracking นี้มี province ตรงกับใบอยู่แล้ว (ไม่มี
      -- แถว TH-XX เหลือให้เขียน) — no-op ที่ถูกต้อง ไม่ใช่ error
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  applied := v_applied;
  skipped_has_province := v_skipped;
  conflict_cnt := v_conflict;
  return next;
end;
$$;

revoke execute on function analytics.label_apply_matched(uuid, uuid) from public, anon;
grant execute on function analytics.label_apply_matched(uuid, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
