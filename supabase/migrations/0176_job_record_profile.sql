-- 0176_job_record_profile.sql — แบบการบันทึกของใบงาน (record profile): เลือกต่อใบงานว่าขั้นไหน "ชั่งน้ำหนัก / ถามชิ้นเสีย / ถามน้ำหนักเศษ" · ทองก็เลือกแบบได้
-- ต่อจาก 0172-0175 (0175 apply บน production แล้ว 15 ต.ค. — ไฟล์เดิมแก้ไม่ได้ · def ต้นทางทุกตัวลอกจากฉบับที่ apply จริง) · spec: docs/3j-jewelry/oms/design-job-record-profile.md
-- ⚠️ ยังไม่ APPLY — dry-run เท่านั้น (apply หลัง security ผ่าน)
-- 🔴 apply ด้วย node scripts/run-sql.mjs --commit --record เท่านั้น (ไฟล์พึ่งทรานแซกชันที่ runner ครอบทั้งไฟล์) · ห้าม supabase db push · ไฟล์ต้องเป็น LF
--
-- ทำไม: J1 ผูกกติกา "ต้องกรอกน้ำหนักอะไร" กับ metal ตรงๆ (ทองชั่งทุกขั้น · เงินชั่ง 3 ขั้น · ทองเหลืองไม่ชั่ง) — เจ้าของขอให้เลือกได้ต่อใบ (แบบ 1/2/3 · ปิดการชั่งได้ · ของเสียเลือกขั้นได้)
--   หลัก: ด่านชั่งทุกด่านอ่านจาก job_stage.weigh_required อยู่แล้ว (snapshot ต่อขั้น) — profile แค่เปลี่ยน "ที่มา" ของ flag ตอนสร้าง/เปลี่ยนแบบก่อนช่างรับงานขั้นแรก
--   ใบเดิม (profile_id null) = กติกา J1 เดิมทุกอย่าง — migration นี้ไม่มี UPDATE ใบเดิมสักแถว (JB-0018 เงินเดินต่อเหมือนเดิม)
--
-- 1 ตาราง: job_record_profile (หัว + ค่าเริ่ม is_default/is_default_gold) · job_record_profile_stage (flag ต่อขั้น)
-- 2 คอลัมน์: job.profile_id/profile_name/require_final_weight · job_stage.scrap_qty_ask/scrap_weight_ask · ถอด job_gold_weigh_ck · job_done_ck ใหม่ · job_event 'profile_set'
-- 3 helper ภายใน: job_profile_default_for · job_record_profile_ensure (seed) · job_profile_state · job_profile_apply
-- 4 RPC ใหม่: job_record_profile_list/upsert/set_default · job_profile_set
-- 5 replace: job_stage_suggest · job_create_insert/_from_quote_item/_from_production_item (+p_profile_id · drop sig เดิม) · job_core_receive · job_stage_guard · job_guard · job_worker_resolve (D6 ปิดหนี้ 0175) · job_done
-- 6 v_job_board ต่อท้าย: profile_name · has_weigh · gold_unguarded
--
-- เบี่ยงจาก spec (เหตุผลอยู่ที่จุดนั้นในไฟล์):
--  (1) ค่าเริ่ม 2 scope (มติ Tech Lead/ux-ui): is_default (งานทั่วไป · ร้านต้องมี 1 แบบเสมอ — constraint trigger deferred) + is_default_gold (เฉพาะทอง · ล้างได้ = ใช้ is_default) · seed 3 แบบรวม "ทอง — ชั่งทุกขั้น" = กติกาทอง J1
--  (2) require_final_weight (profile → snapshot บนใบ): บังคับน้ำหนักสุทธิตอนปิดงานทุกโลหะ · นอกจากนั้นใบทองที่มีขั้นชั่งอย่างน้อย 1 ขั้น (job.weigh_required) ยังบังคับเหมือน J1 (security M1) — เฉพาะแบบที่ไม่ชั่งสักขั้นเท่านั้นที่ไม่บังคับ (มติเจ้าของ) · job_done + job_done_ck ตรงกัน
--  (3) ใบทองเดิม (profile_id null) คง "ห้ามปิดขั้นก่อนอัตโนมัติทุกขั้น" ไว้ (job_core_receive/job_stage_guard/job_worker_resolve) — spec §1 สรุปว่าใช้ weigh_required แทนได้ แต่ทองเดิมขั้นก่อน cast (เทียน/ปูน)
--      weigh_required=false ⇒ ถ้าใช้ flag อย่างเดียว กติกาของใบเดิมจะเปลี่ยน · ใบที่มี profile ใช้ flag ของขั้นอย่างเดียวตาม spec
--  (4) job_stage_guard: flag เปลี่ยนได้เมื่อขั้น pending หรือ skipped (spec เขียนเฉพาะ pending) — job_profile_apply แก้ทุกขั้นของใบ รวมขั้นที่ข้ามไว้ก่อนเริ่ม
--  (5) job_record_profile_list ไม่ใช่ stable (เรียก ensure ที่เขียนข้อมูล) · upsert/set_default เรียก ensure ก่อน (ร้านที่ยังไม่มีแบบเลยต้องได้ค่าเริ่มเสมอ — R4)
--  (6) job_worker_resolve: เพิ่ม has_profile (ทั้ง 2 block) + job.profile_name (เฉพาะช่างที่ระบุตัวแล้ว) ตามที่ ux-ui ขอ — แยกใบเดิม (null/false) ออกจากใบใหม่ · เป็นชื่อแบบ/boolean ไม่ใช่น้ำหนัก (N1 คงเดิม)
--  (7) job_guard UPDATE: weigh_required เปลี่ยนได้ก่อนเริ่ม แต่ต้องเท่า exists(ขั้นที่ weigh_required) ณ ตอนนั้น (weigh_drift) — ใบเดิมที่ไม่ตรงอยู่แล้วไม่ถูกแตะเพราะไม่มีใครแก้คอลัมน์นี้
--  (9) หนี้ที่รู้ (security L2): ค่าเริ่มทอง (is_default_gold) เป็นภาพนิ่ง ณ ตอนสร้างใบ — แก้/สลับค่าเริ่มทีหลังไม่กระทบใบที่สร้างไปแล้ว (snapshot) · ใบทองที่สร้างตอนไม่มีค่าเริ่มทองจะได้ค่าเริ่มทั่วไป (ชั่งเฉพาะหล่อ) แต่ยังบังคับน้ำหนักสุทธิตาม M1
--  (8) S6 จาก code review 0175: job_guard แยกบล็อกตรวจ plan_drift ที่ซ้ำเป๊ะ 2 ที่ (INSERT/UPDATE) เป็น job_plan_basis_assert + สูตรเป็น job_plan_formula (ภายใน ไม่ grant) — พฤติกรรม/ข้อความเท่าเดิม (golden GB1-GB6)
--      ไม่ได้ทำ (ไม่ได้ replace ฟังก์ชันนั้นใน 0176): S5 job_plan_set ประทับ target_source=input ทุกครั้ง · job_plan_compute ยังมีสูตรเองอีก 1 ที่ + N11 nullif(btrim) ซ้ำซ้อน — รอ 0177/จดเป็นหนี้
-- ไม่มีราคา/ต้นทุนในทุก object ของไฟล์นี้ (boolean ล้วน)

-- baseline ก่อนแตะ: ฟังก์ชันทุกตัวในสคีมา (md5) + ตัวชี้วัด updated_at ของ job/job_stage — ตรวจท้ายไฟล์ว่าไม่มีอะไรขยับนอกรายการที่ตั้งใจแทนที่
create temp table _j176_fn_base on commit drop as
select p.oid::regprocedure::text as sig, p.proname, md5(pg_get_functiondef(p.oid)) as h
from pg_proc p
where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f';

create temp table _j176_row_base on commit drop as
select 'job'::text as t, count(*) as n, count(distinct updated_at) as nd, coalesce(md5(string_agg(updated_at::text, '|' order by id)), '') as h from analytics.job
union all
select 'job_stage', count(*), count(distinct updated_at), coalesce(md5(string_agg(updated_at::text, '|' order by id)), '') from analytics.job_stage;

create temp table _j176_flag_base on commit drop as
select coalesce(md5(string_agg(id::text || ':' || weigh_required::text || ':' || status, '|' order by id)), '') as h from analytics.job_stage;

-- ============================================================================
-- 0. pre-check: ฟังก์ชันที่จะ replace ต้องเป็นฉบับ 0175 ที่ apply จริง (md5 ที่ query สดจาก prod 15 ต.ค.) หรือฉบับ 0176 ที่ล็อก md5 ไว้ (รันซ้ำ) — อย่างอื่น = มีคนแก้นอก migration → หยุด (ข้อ 21)
-- ============================================================================
do $p$
declare
  r record;
  v_n int;
  v_h text;
begin
  -- ไฟล์นี้พึ่งทรานแซกชันที่ runner ครอบทั้งไฟล์ (temp table on commit drop) — รันแบบ autocommit ตารางหายทันที ⇒ บรรทัดนี้ล้มก่อน DDL ใดๆ
  perform 1 from pg_temp._j176_fn_base limit 1;
  if not exists (select 1 from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'job_plan_suggest') then
    raise exception '0176: ยังไม่พบ 0175 (job_plan_suggest) — apply 0175 ก่อน';
  end if;
  for r in
    select * from (values
      ('job_core_receive', '592d3578722787cfe7c8abc16b00432f', 'a7a6fd32fcb7be3a4cdec82016665da2'),
      ('job_create_from_production_item', '09510c24800e11ddeeed6b02dd590b2d', '59ca6642d8a157bb5848b11e44d60098'),
      ('job_create_from_quote_item', 'e010334fea770b90f2728b8c12345712', '8bf8f169ec7fc25466e5baf1ff4c047d'),
      ('job_create_insert', '56b985e3694977f28f339d9e2dc260db', '38019cdfd775bc38d199798492761d26'),
      ('job_done', '7119da41b4918e331b88a012616fb4e3', '9724f6e02da5ad57d83e838475e449f6'),
      ('job_guard', '7296958583af076c9d7e8b1cd2eb6ebf', 'f12fffe81780e44d01c3f7d58350eafb'),
      ('job_stage_guard', '6db14595e068c7367663f8f1527a39ec', '0e10b2b1b97742a3abbb5030c8fd0288'),
      ('job_stage_suggest', '1ebd62aafca9411c408e4167d05ff3a5', '8600395a3ff129cece5a48088045c9b8'),
      ('job_worker_resolve', '242d16e947661b73599fd3a799b1f9a0', '6b31116d1d143b968b7627de3044eeb5')
    ) as v(n, h_0175, h_0176)
  loop
    select count(*) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and proname = r.n;
    if v_n <> 1 then
      raise exception '0176: % มี % signature (ต้องมี 1) — หยุดตรวจ overload', r.n, v_n;
    end if;
    select md5(pg_get_functiondef(p.oid)) into v_h from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = r.n;
    if v_h not in (r.h_0175, r.h_0176) then
      raise exception '0176: def ของ % บน DB ไม่ใช่ฉบับ 0175 ที่ apply (md5 %) และไม่ใช่ฉบับ 0176 (md5 %) — มีคนแก้นอก migration · หยุด ห้าม replace ทับ', r.n, v_h, r.h_0176;
    end if;
  end loop;
end;
$p$;

-- ============================================================================
-- 1. ตาราง (สคีมา analytics · RLS เปิดไม่มี policy · grant select ให้ service_role อย่างเดียว ท้ายไฟล์ — ข้อ 18 · เขียนผ่าน RPC security definer เท่านั้น)
-- ============================================================================
create table if not exists analytics.job_record_profile (
  id                    uuid primary key default gen_random_uuid(),
  shop_id               uuid not null references public.shop (id) on delete restrict,
  name                  text not null check (name = btrim(name) and length(name) between 1 and 60 and name !~ '[<>]'),
  note                  text check (note is null or (length(note) <= 200 and analytics.oem_note_valid(note))),
  -- ค่าเริ่ม: is_default = งานทั่วไป (ร้านต้องมี 1 แบบเสมอ) · is_default_gold = เฉพาะงานทอง (ไม่มี = ใช้ is_default) — ปิดแบบที่เป็นค่าเริ่มไม่ได้
  is_default            boolean not null default false,
  is_default_gold       boolean not null default false,
  -- ใบงานที่ใช้แบบนี้ต้องใส่น้ำหนักสุทธิตอนปิดงานไหม (snapshot ลง job.require_final_weight) — true = บังคับทุกโลหะ · false = ตามกติกาเดิมของทอง: ใบทองที่มีขั้นชั่งอย่างน้อย 1 ขั้นยังต้องมีน้ำหนักสุทธิ (job.weigh_required) · ใบทอง/โลหะอื่นที่ไม่มีขั้นชั่งเลย (แบบ "ไม่ชั่ง") ไม่บังคับ
  require_final_weight boolean not null default false,
  is_active             boolean not null default true,
  constraint jrp_default_active_ck check ((not is_default or is_active) and (not is_default_gold or is_active)),
  seq                   int not null default 100 check (seq between 1 and 10000),
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_by            uuid,
  updated_at            timestamptz not null default now(),
  unique (id, shop_id)
);
create unique index if not exists uq_job_record_profile_name on analytics.job_record_profile (shop_id, lower(name));
-- ค่าเริ่ม: 1 แบบต่อร้านต่อ scope (งานทั่วไป / ทอง)
create unique index if not exists uq_job_record_profile_default on analytics.job_record_profile (shop_id) where is_default;
create unique index if not exists uq_job_record_profile_default_gold on analytics.job_record_profile (shop_id) where is_default_gold;
alter table analytics.job_record_profile enable row level security;

-- flag ต่อขั้น — ไม่มีแถว = ปิดทั้ง 3 · แถวที่ปิดทั้ง 3 ไม่เก็บ (ความหมายเดียว)
create table if not exists analytics.job_record_profile_stage (
  profile_id   uuid not null,
  shop_id      uuid not null,
  stage_code   text not null,
  weigh        boolean not null default false,
  scrap_qty    boolean not null default false,
  scrap_weight boolean not null default false,
  primary key (profile_id, stage_code),
  foreign key (profile_id, shop_id) references analytics.job_record_profile (id, shop_id) on delete restrict,
  foreign key (shop_id, stage_code) references analytics.job_stage_def (shop_id, code) on delete restrict,
  constraint jrps_any_ck check (weigh or scrap_qty or scrap_weight)
);
alter table analytics.job_record_profile_stage enable row level security;

-- trigger: profile — ห้าม DELETE/TRUNCATE (มีใบอ้างอยู่ · ปิดใช้แทน) · shop_id แช่แข็ง · ปิดแบบที่เป็นค่าเริ่มไม่ได้ · ตั้งแบบที่ปิดอยู่เป็นค่าเริ่มไม่ได้
create or replace function analytics.job_record_profile_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
begin
  if tg_op = 'DELETE' then
    raise exception 'job_record_profile: ห้ามลบแบบการบันทึก — ปิดใช้ (is_active=false) แทน' using errcode = '22023', hint = 'profile_no_delete';
  end if;
  if new.shop_id <> old.shop_id then
    raise exception 'job_record_profile: ห้ามย้ายแบบข้ามร้าน' using errcode = '22023';
  end if;
  if old.is_active and not new.is_active and (new.is_default or new.is_default_gold) then
    raise exception 'ปิดแบบที่เป็นค่าเริ่มไม่ได้ — ตั้งแบบอื่นเป็นค่าเริ่มก่อน' using errcode = '22023', hint = 'default_cannot_close';
  end if;
  if (new.is_default or new.is_default_gold) and not new.is_active then
    raise exception 'ตั้งแบบที่ปิดใช้งานแล้วเป็นค่าเริ่มไม่ได้' using errcode = '22023', hint = 'inactive';
  end if;
  new.updated_at := now();
  return new;
end;
$f$;
drop trigger if exists trg_job_record_profile_guard on analytics.job_record_profile;
create trigger trg_job_record_profile_guard before update or delete on analytics.job_record_profile
  for each row execute function analytics.job_record_profile_guard();

-- ร้านที่มีแบบต้องมีค่าเริ่ม (is_default) 1 แบบเสมอ — ตรวจ "ตอน commit" (deferred) เพราะสลับค่าเริ่มต้องล้างตัวเก่าก่อนตั้งตัวใหม่ (unique index แบบ partial ตรวจทีละแถว
-- ไม่ใช่ท้าย statement ⇒ UPDATE เดียวที่สลับ A→B ล้มได้ตามลำดับแถว) · ใครล้าง is_default โดยไม่ตั้งตัวใหม่ = commit ไม่ผ่าน (R4: ไม่มีค่าเริ่ม = สร้างใบเงียบๆ ไม่ได้)
create or replace function analytics.job_record_profile_default_required()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
begin
  if old.is_default and not new.is_default
     and not exists (select 1 from analytics.job_record_profile p where p.shop_id = old.shop_id and p.is_default) then
    raise exception 'ร้านต้องมีแบบค่าเริ่ม (is_default) 1 แบบเสมอ — ตั้งแบบอื่นเป็นค่าเริ่มแทนก่อนล้างของเดิม' using errcode = '22023', hint = 'default_required';
  end if;
  return null;
end;
$f$;
drop trigger if exists trg_job_record_profile_default_required on analytics.job_record_profile;
create constraint trigger trg_job_record_profile_default_required after update on analytics.job_record_profile
  deferrable initially deferred for each row execute function analytics.job_record_profile_default_required();

-- trigger: profile_stage — shop_id derive จาก profile (ไม่เชื่อ caller) · weigh/scrap_weight ได้เฉพาะขั้นที่ def.metal_present (ชั่งตอน CAD/เทียน = ไร้ความหมาย) · แก้ key ไม่ได้
create or replace function analytics.job_record_profile_stage_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_shop    uuid;
  v_present boolean;
begin
  if tg_op = 'UPDATE' and (new.profile_id <> old.profile_id or new.stage_code <> old.stage_code) then
    raise exception 'job_record_profile_stage: ห้ามเปลี่ยนแบบ/ขั้นของแถวเดิม' using errcode = '22023';
  end if;
  select p.shop_id into v_shop from analytics.job_record_profile p where p.id = new.profile_id;
  if v_shop is null then
    raise exception 'job_record_profile_stage: ไม่พบแบบการบันทึก' using errcode = '22023', hint = 'profile_not_found';
  end if;
  new.shop_id := v_shop;
  select d.metal_present into v_present from analytics.job_stage_def d where d.shop_id = v_shop and d.code = new.stage_code;
  if v_present is null then
    raise exception 'ขั้น % ไม่มีในทะเบียนขั้นตอนของร้านนี้', new.stage_code using errcode = '22023', hint = 'stage_invalid';
  end if;
  if (new.weigh or new.scrap_weight) and not v_present then
    raise exception 'ขั้น % ไม่มีโลหะอยู่ในมือ — ตั้งชั่งน้ำหนัก/น้ำหนักเศษไม่ได้ (ตั้งได้เฉพาะจำนวนชิ้นเสีย)', new.stage_code using errcode = '22023', hint = 'flag_not_applicable';
  end if;
  return new;
end;
$f$;
drop trigger if exists trg_job_record_profile_stage_guard on analytics.job_record_profile_stage;
create trigger trg_job_record_profile_stage_guard before insert or update on analytics.job_record_profile_stage
  for each row execute function analytics.job_record_profile_stage_guard();

drop trigger if exists trg_job_record_profile_deny_truncate on analytics.job_record_profile;
create trigger trg_job_record_profile_deny_truncate before truncate on analytics.job_record_profile
  for each statement execute function analytics.job_deny_truncate();
drop trigger if exists trg_job_record_profile_stage_deny_truncate on analytics.job_record_profile_stage;
create trigger trg_job_record_profile_stage_deny_truncate before truncate on analytics.job_record_profile_stage
  for each statement execute function analytics.job_deny_truncate();
-- ============================================================================
-- 2. คอลัมน์ใหม่ (add column ... default ค่าคงที่ = ไม่ยิง trigger · ไม่ UPDATE ใบเดิม — ข้อ 19) + CHECK
-- ============================================================================
alter table analytics.job add column if not exists profile_id uuid;
alter table analytics.job add column if not exists profile_name text;
alter table analytics.job add column if not exists require_final_weight boolean not null default false;
alter table analytics.job_stage add column if not exists scrap_qty_ask boolean not null default true;
alter table analytics.job_stage add column if not exists scrap_weight_ask boolean not null default false;

alter table analytics.job drop constraint if exists job_profile_fk;
alter table analytics.job add constraint job_profile_fk foreign key (profile_id, shop_id)
  references analytics.job_record_profile (id, shop_id) on delete restrict;
-- profile_id null = ใบเดิมก่อน 0176 ("กติกาเดิม J1") · มี profile ต้องมีชื่อ snapshot (ใบพิมพ์/บอร์ดไม่ join)
alter table analytics.job drop constraint if exists job_profile_pair_ck;
alter table analytics.job add constraint job_profile_pair_ck
  check ((profile_id is null) = (profile_name is null) and (profile_name is null or (length(profile_name) between 1 and 60 and profile_name !~ '[<>]')));

-- ทองไม่บังคับชั่งอีก (มติ 15 ต.ค.: ทองเลือกแบบได้) — ใบทองเดิมทุกใบ weigh_required=true จึงยังผ่านด่านปิดงานเดิม
alter table analytics.job drop constraint if exists job_gold_weigh_ck;
-- ปิดงาน: น้ำหนักสุทธิบังคับเมื่อ (ทอง ∧ weigh_required) [กติกา J1 — ใบเดิมทุกใบ weigh_required=true · ใบใหม่ = มีขั้นชั่งอย่างน้อย 1 ขั้น] หรือ require_final_weight (flag ของแบบ ที่ snapshot ลงใบ)
-- มติเจ้าของ "ทองไม่บล็อก" ครอบเฉพาะแบบไม่ชั่ง (weigh_required=false) · แถว done เดิมผ่านแน่: require_final_weight=false · ทองเดิมที่ done มี weight_final_g อยู่แล้ว (CHECK เดิมบังคับ) · ไม่มีแถว gold done บน prod ด้วยซ้ำ
alter table analytics.job drop constraint if exists job_done_ck;
alter table analytics.job add constraint job_done_ck check (
  status <> 'done' or (
    done_at is not null and qty_good is not null and qty_scrap is not null
    and qty_good + qty_scrap = qty_planned
    and (metal <> 'gold' or not weigh_required or weight_final_g is not null)
    and (not require_final_weight or weight_final_g is not null)
  )
);

-- job_event.event_type: เพิ่ม profile_set (หาชื่อ constraint จริงจาก pg_constraint แบบ 0175 — je_who_ck ห้ามลบ)
do $e$
declare
  v_name text;
begin
  for v_name in
    select c.conname from pg_constraint c
     where c.conrelid = 'analytics.job_event'::regclass and c.contype = 'c'
       and c.conname <> 'je_who_ck'
       and pg_get_constraintdef(c.oid) like 'CHECK ((event_type = ANY%'
  loop
    execute format('alter table analytics.job_event drop constraint %I', v_name);
  end loop;
  alter table analytics.job_event add constraint job_event_event_type_ck check (event_type in (
    'create', 'stage_receive', 'stage_send', 'stage_skip', 'stage_reopen', 'weigh', 'scrap', 'batch_join',
    'batch_leave', 'due_set', 'hold', 'resume', 'photo_add', 'note', 'done', 'cancel', 'token_issue', 'token_revoke',
    'plan_change', 'surplus_set', 'profile_set'));
end;
$e$;

-- ============================================================================
-- 3. helper ภายใน (ไม่ grant ให้ role ไหน — ท้ายไฟล์ revoke ทุกตัวที่ไม่อยู่ในรายการ RPC)
-- ============================================================================

-- ค่าเริ่มของ (ร้าน, โลหะ): ทอง → แบบ is_default_gold ถ้ามี ไม่มี/โลหะอื่น → is_default · ไม่มีเลย = null (ผู้เรียกต้อง raise ไม่เดา — R4)
create or replace function analytics.job_profile_default_for(p_shop_id uuid, p_metal text)
 returns uuid
 language sql
 stable
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
  select p.id
    from analytics.job_record_profile p
   where p.shop_id = p_shop_id and p.is_active
     and (p.is_default or (p_metal = 'gold' and p.is_default_gold))
   order by p.is_default_gold desc
   limit 1
$f$;

-- seed: เฉพาะร้านที่ "ยังไม่มีแบบเลย" (ร้านที่มีแล้วไม่ยัดเพิ่ม) · 3 แบบ (มติ Tech Lead 15 ต.ค.):
--   แบบ 1 = ค่าเริ่มงานทั่วไป (ชั่ง+ชิ้นเสียเฉพาะหล่อ · ไม่บังคับน้ำหนักสุทธิ) · "ไม่ชั่ง" = ไม่มีแถวขั้น · "ทอง — ชั่งทุกขั้น" = ค่าเริ่มงานทอง = กติกาทอง J1 ทุกประการ
--   (ชั่งทุกขั้นที่ def.metal_present · ถามชิ้นเสียทุกขั้น เหมือน J1 · บังคับน้ำหนักสุทธิตอนปิด) — อ่านขั้นจากทะเบียนของร้าน ไม่ hardcode รายการขั้น
-- แบบ 2 ไม่ seed (เจ้าของระบุครึ่งเดียว — ห้ามแต่งค่าให้ดูจริง) · advisory lock กัน 2 session seed พร้อมกัน (unique ชื่อเป็นด่านสุดท้าย)
create or replace function analytics.job_record_profile_ensure(p_shop_id uuid)
 returns void
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_p1 uuid;
  v_p3 uuid;
begin
  if p_shop_id is null then
    raise exception 'job_record_profile_ensure: p_shop_id จำเป็น' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('job_record_profile_ensure:' || p_shop_id::text, 0));
  if exists (select 1 from analytics.job_record_profile where shop_id = p_shop_id) then
    return;
  end if;
  perform analytics.job_stage_def_ensure(p_shop_id);
  insert into analytics.job_record_profile (shop_id, name, note, seq, is_default)
  values (p_shop_id, 'แบบ 1 — ชั่งเฉพาะหล่อ', 'ค่าเริ่มของร้าน — ชั่งน้ำหนักและถามชิ้นเสียเฉพาะขั้นหล่อ', 10, true)
  returning id into v_p1;
  insert into analytics.job_record_profile_stage (profile_id, shop_id, stage_code, weigh, scrap_qty, scrap_weight)
  values (v_p1, p_shop_id, 'cast', true, true, false);
  insert into analytics.job_record_profile (shop_id, name, note, seq)
  values (p_shop_id, 'ไม่ชั่ง (รับ/ส่งอย่างเดียว)', 'ไม่บังคับน้ำหนัก ไม่ถามของเสีย — ช่างกดรับ/ส่งต่ออย่างเดียว', 20);
  insert into analytics.job_record_profile (shop_id, name, note, seq, is_default_gold, require_final_weight)
  values (p_shop_id, 'ทอง — ชั่งทุกขั้นที่มีโลหะ + ชั่งสุทธิตอนปิด', 'ค่าเริ่มงานทอง — กติกาเดิมของทอง: ชั่งเข้า-ออกทุกขั้นที่โลหะอยู่ในมือ และต้องชั่งน้ำหนักสุทธิตอนปิดงาน', 30, true, true)
  returning id into v_p3;
  insert into analytics.job_record_profile_stage (profile_id, shop_id, stage_code, weigh, scrap_qty, scrap_weight)
  select v_p3, d.shop_id, d.code, d.metal_present, true, false
    from analytics.job_stage_def d where d.shop_id = p_shop_id;
end;
$f$;

-- สถานะแบบของใบงาน (ใช้ใน response ของ apply/set + payload event before/after + เทียบใน verify)
-- gold_unguarded: ใบทองที่ยังไม่ปิดและมีขั้นที่ "โลหะอยู่ในมือ" (def.metal_present) แต่ไม่ชั่ง (ไม่นับขั้นที่ข้าม) = ไม่มีด่านกันทองหายในขั้นนั้น — นิพจน์เดียวกับ v_job_board
create or replace function analytics.job_profile_state(p_job_id uuid)
 returns jsonb
 language sql
 stable
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
  select jsonb_build_object(
    'profile_id', j.profile_id, 'profile_name', j.profile_name, 'require_final_weight', j.require_final_weight,
    'has_weigh', exists (select 1 from analytics.job_stage s where s.job_id = j.id and s.weigh_required),
    'gold_unguarded', (j.metal = 'gold' and j.status not in ('done', 'cancelled') and exists (
        select 1 from analytics.job_stage s join analytics.job_stage_def d on d.shop_id = s.shop_id and d.code = s.stage_code
         where s.job_id = j.id and d.metal_present and not s.weigh_required and s.status <> 'skipped')),
    'stages', coalesce((select jsonb_agg(jsonb_build_object('stage_code', s.stage_code, 'weigh', s.weigh_required,
                                                           'scrap_qty', s.scrap_qty_ask, 'scrap_weight', s.scrap_weight_ask) order by s.seq)
                          from analytics.job_stage s where s.job_id = j.id), '[]'::jsonb))
    from analytics.job j where j.id = p_job_id
$f$;

-- ใช้แบบกับใบงาน: flag ต่อขั้น + snapshot บนใบ (ที่เดียวที่ derive flag — ใช้ร่วมโดย job_create_insert และ job_profile_set)
-- ผู้เรียกถือ lock ใบงานแล้ว (สร้างใหม่ / job_office_begin for update) · ตรวจ "ยังไม่เริ่ม" อยู่ที่ job_stage_guard/job_guard (ด่านชั้นตาราง) + job_profile_set (ข้อความที่อ่านรู้เรื่อง)
-- UPDATE ขั้นเฉพาะแถวที่ค่าเปลี่ยนจริง (ข้อ 19: ไม่ยิง trigger/ขยับ updated_at โดยไม่จำเป็น) · ขั้นที่แบบไม่ระบุ = ปิดทั้ง 3
create or replace function analytics.job_profile_apply(p_job_id uuid, p_profile_id uuid)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_job analytics.job%rowtype;
  v_p   analytics.job_record_profile%rowtype;
begin
  select * into v_job from analytics.job where id = p_job_id;
  if not found then
    raise exception 'ไม่พบใบงาน' using errcode = '22023', hint = 'job_not_found';
  end if;
  select * into v_p from analytics.job_record_profile where id = p_profile_id and shop_id = v_job.shop_id;
  if not found or not v_p.is_active then
    raise exception 'แบบการบันทึกไม่ถูกต้อง (ไม่พบ/ของร้านอื่น/ปิดใช้งานแล้ว)' using errcode = '22023', hint = 'profile_invalid';
  end if;

  update analytics.job_stage as js
     set weigh_required = x.w, scrap_qty_ask = x.q, scrap_weight_ask = x.s
    from (select s2.id,
                 coalesce(ps.weigh, false) as w, coalesce(ps.scrap_qty, false) as q, coalesce(ps.scrap_weight, false) as s
            from analytics.job_stage s2
            left join analytics.job_record_profile_stage ps on ps.profile_id = v_p.id and ps.stage_code = s2.stage_code
           where s2.job_id = p_job_id) x
   where js.id = x.id
     and (js.weigh_required, js.scrap_qty_ask, js.scrap_weight_ask) is distinct from (x.w, x.q, x.s);

  -- job.weigh_required = มีขั้นที่ต้องชั่งอย่างน้อย 1 ขั้น (ใช้ใน CHECK ปิดงาน/ป้ายบอร์ด — ไม่มี RPC ไหนตัดสินจากมัน)
  update analytics.job
     set profile_id = v_p.id, profile_name = v_p.name, require_final_weight = v_p.require_final_weight,
         weigh_required = exists (select 1 from analytics.job_stage s where s.job_id = p_job_id and s.weigh_required)
   where id = p_job_id;

  return analytics.job_profile_state(p_job_id);
end;
$f$;

-- JSON ของแบบ 1 แบบ (ใช้ใน list/upsert/suggest) — boolean + ชื่อล้วน ไม่มีราคา/ต้นทุน
create or replace function analytics.job_profile_json(p_profile_id uuid)
 returns jsonb
 language sql
 stable
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'note', p.note, 'require_final_weight', p.require_final_weight,
    'is_active', p.is_active, 'seq', p.seq, 'updated_at', p.updated_at,
    'is_default', p.is_default, 'is_default_gold', p.is_default_gold,
    'stages', coalesce((select jsonb_agg(jsonb_build_object('stage_code', ps.stage_code, 'weigh', ps.weigh,
                                                           'scrap_qty', ps.scrap_qty, 'scrap_weight', ps.scrap_weight) order by dd.seq_default)
                          from analytics.job_record_profile_stage ps
                          join analytics.job_stage_def dd on dd.shop_id = ps.shop_id and dd.code = ps.stage_code
                         where ps.profile_id = p.id), '[]'::jsonb))
    from analytics.job_record_profile p where p.id = p_profile_id
$f$;

-- ============================================================================
-- 4. RPC ออฟฟิศ (security definer · crm_require_owner_admin · grant service_role ท้ายไฟล์)
-- ============================================================================

-- รายการแบบทั้งหมดของร้าน (รวมที่ปิดใช้ — จอจัดการต้องเห็น) + ทะเบียนขั้น (ไว้วาด matrix) + id ค่าเริ่ม (ทั่วไป/ทอง)
create or replace function analytics.job_record_profile_list(p_shop_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
begin
  if p_shop_id is null then
    raise exception 'job_record_profile_list: p_shop_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.job_stage_def_ensure(p_shop_id);
  perform analytics.job_record_profile_ensure(p_shop_id);
  return jsonb_build_object(
    'profiles', (select coalesce(jsonb_agg(analytics.job_profile_json(p.id) || jsonb_build_object('jobs_open', (
                   select count(*)::int from analytics.job j where j.profile_id = p.id and j.status not in ('done', 'cancelled')))
                 order by p.seq, p.name), '[]'::jsonb)
                  from analytics.job_record_profile p where p.shop_id = p_shop_id),
    'default_profile_id', analytics.job_profile_default_for(p_shop_id, null),
    'default_gold_profile_id', analytics.job_profile_default_for(p_shop_id, 'gold'),
    'stage_defs', (select coalesce(jsonb_agg(jsonb_build_object('code', d.code, 'name_th', d.name_th, 'seq_default', d.seq_default,
                                                               'metal_present', d.metal_present, 'is_active', d.is_active)
                                             order by d.seq_default), '[]'::jsonb)
                     from analytics.job_stage_def d where d.shop_id = p_shop_id));
end;
$f$;

-- สร้าง/แก้แบบ — พารามิเตอร์ null = "ไม่เปลี่ยน" (ตอนแก้) · p_stages = รายการทั้งชุดแทนที่ของเดิม (ลบแล้วใส่ใหม่ในทรานแซกชันเดียว · แถวปิดทั้ง 3 ไม่เก็บ)
-- ไม่แตะใบงานที่ใช้แบบนี้อยู่ (snapshot) · รูปร่าง p_stages: [{stage_code, weigh?, scrap_qty?, scrap_weight?}] boolean จริงเท่านั้น (string "true"/1 = stage_invalid)
create or replace function analytics.job_record_profile_upsert(
  p_shop_id               uuid,
  p_id                    uuid default null,
  p_name                  text default null,
  p_note                  text default null,
  p_stages                jsonb default null,
  p_is_active             boolean default null,
  p_seq                   int default null,
  p_require_final_weight boolean default null,
  p_actor                 uuid default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor   uuid := coalesce(p_actor, auth.uid());
  v_cur     analytics.job_record_profile%rowtype;
  v_name    text;
  v_note    text;
  v_id      uuid;
  v_el      jsonb;
  v_k       text;
  v_code    text;
  v_present boolean;
  v_flag    text;
  v_flags   boolean[];
  v_seen    text[] := '{}';
  v_ok      jsonb := '[]'::jsonb;
begin
  if p_shop_id is null then
    raise exception 'job_record_profile_upsert: p_shop_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if v_actor is null then
    raise exception 'job_record_profile_upsert: ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  perform analytics.job_stage_def_ensure(p_shop_id);
  perform analytics.job_record_profile_ensure(p_shop_id);

  if p_id is not null then
    select * into v_cur from analytics.job_record_profile where id = p_id and shop_id = p_shop_id for update;
    if not found then
      raise exception 'ไม่พบแบบการบันทึกในร้านนี้' using errcode = '22023', hint = 'profile_not_found';
    end if;
  end if;

  if p_name is not null then
    v_name := analytics.job_label_clean(p_name, 'ชื่อแบบ', 60);
  elsif p_id is null then
    raise exception 'ต้องระบุชื่อแบบ' using errcode = '22023', hint = 'name_required';
  else
    v_name := v_cur.name;
  end if;
  if exists (select 1 from analytics.job_record_profile p
              where p.shop_id = p_shop_id and lower(p.name) = lower(v_name) and p.id is distinct from p_id) then
    raise exception 'มีแบบชื่อ "%" อยู่แล้ว', v_name using errcode = '22023', hint = 'name_dup';
  end if;
  v_note := case when p_note is not null then analytics.job_text_clean(p_note, 'คำอธิบายแบบ', 200, false)
                 when p_id is not null then v_cur.note end;
  if p_seq is not null and not (p_seq between 1 and 10000) then
    raise exception 'ลำดับต้องอยู่ระหว่าง 1 ถึง 10,000' using errcode = '22023', hint = 'seq_invalid';
  end if;
  if p_id is not null and p_is_active is false and v_cur.is_active and (v_cur.is_default or v_cur.is_default_gold) then
    raise exception 'ปิดแบบที่เป็นค่าเริ่มไม่ได้ — ตั้งแบบอื่นเป็นค่าเริ่มก่อน' using errcode = '22023', hint = 'default_cannot_close';
  end if;

  -- ตรวจ p_stages ทั้งชุดก่อนเขียน: array ≤ 100 · แต่ละรายการ object · key ที่รู้จักเท่านั้น · flag ต้อง boolean จริง · ขั้นมีในร้าน · ไม่ซ้ำ · ชั่ง/เศษเฉพาะขั้นที่มีโลหะ
  if p_stages is not null then
    if jsonb_typeof(p_stages) is distinct from 'array' then
      raise exception 'รายการขั้นต้องเป็น array' using errcode = '22023', hint = 'stage_invalid';
    end if;
    if jsonb_array_length(p_stages) > 100 then
      raise exception 'รายการขั้นยาวเกินไป (ไม่เกิน 100)' using errcode = '22023', hint = 'stage_invalid';
    end if;
    for v_el in select value from jsonb_array_elements(p_stages) loop
      if jsonb_typeof(v_el) is distinct from 'object' then
        raise exception 'แต่ละรายการขั้นต้องเป็น object' using errcode = '22023', hint = 'stage_invalid';
      end if;
      for v_k in select jsonb_object_keys(v_el) loop
        if v_k not in ('stage_code', 'weigh', 'scrap_qty', 'scrap_weight') then
          raise exception 'รายการขั้นมี key ที่ไม่รู้จัก: %', left(v_k, 40) using errcode = '22023', hint = 'stage_invalid';
        end if;
      end loop;
      if jsonb_typeof(v_el -> 'stage_code') is distinct from 'string' then
        raise exception 'stage_code ต้องเป็นข้อความ' using errcode = '22023', hint = 'stage_invalid';
      end if;
      v_code := v_el ->> 'stage_code';
      v_flags := '{}';
      foreach v_flag in array array['weigh', 'scrap_qty', 'scrap_weight'] loop
        if v_el ? v_flag and jsonb_typeof(v_el -> v_flag) is distinct from 'boolean' then
          raise exception 'flag % ต้องเป็น true/false จริง', v_flag using errcode = '22023', hint = 'stage_invalid';
        end if;
        v_flags := v_flags || coalesce((v_el ->> v_flag)::boolean, false);
      end loop;
      select d.metal_present into v_present from analytics.job_stage_def d where d.shop_id = p_shop_id and d.code = v_code;
      if v_present is null then
        raise exception 'ไม่พบขั้น % ในทะเบียนของร้านนี้', left(v_code, 40) using errcode = '22023', hint = 'stage_invalid';
      end if;
      if v_code = any (v_seen) then
        raise exception 'ขั้น % ซ้ำในรายการ', v_code using errcode = '22023', hint = 'stage_dup';
      end if;
      v_seen := v_seen || v_code;
      if (v_flags[1] or v_flags[3]) and not v_present then
        raise exception 'ขั้น % ไม่มีโลหะอยู่ในมือ — ตั้งชั่งน้ำหนัก/น้ำหนักเศษไม่ได้', v_code using errcode = '22023', hint = 'flag_not_applicable';
      end if;
      if v_flags[1] or v_flags[2] or v_flags[3] then
        v_ok := v_ok || jsonb_build_array(jsonb_build_object('stage_code', v_code, 'weigh', v_flags[1], 'scrap_qty', v_flags[2], 'scrap_weight', v_flags[3]));
      end if;
    end loop;
  end if;

  begin
    if p_id is null then
      insert into analytics.job_record_profile (shop_id, name, note, require_final_weight, is_active, seq, created_by, updated_by)
      values (p_shop_id, v_name, v_note, coalesce(p_require_final_weight, false), coalesce(p_is_active, true), coalesce(p_seq, 100), v_actor, v_actor)
      returning id into v_id;
    else
      update analytics.job_record_profile
         set name = v_name, note = v_note,
             require_final_weight = coalesce(p_require_final_weight, require_final_weight),
             is_active = coalesce(p_is_active, is_active), seq = coalesce(p_seq, seq), updated_by = v_actor
       where id = p_id and shop_id = p_shop_id
       returning id into v_id;
    end if;
  exception when unique_violation then
    raise exception 'มีแบบชื่อ "%" อยู่แล้ว', v_name using errcode = '22023', hint = 'name_dup';
  end;

  if p_stages is not null then
    delete from analytics.job_record_profile_stage where profile_id = v_id;
    insert into analytics.job_record_profile_stage (profile_id, shop_id, stage_code, weigh, scrap_qty, scrap_weight)
    select v_id, p_shop_id, e ->> 'stage_code', (e ->> 'weigh')::boolean, (e ->> 'scrap_qty')::boolean, (e ->> 'scrap_weight')::boolean
      from jsonb_array_elements(v_ok) e;
  end if;

  return analytics.job_profile_json(v_id) || jsonb_build_object('jobs_open', (
    select count(*)::int from analytics.job j where j.profile_id = v_id and j.status not in ('done', 'cancelled')));
end;
$f$;

-- ตั้งค่าเริ่ม: p_scope 'general' (งานทั่วไป · ค่าเริ่มของร้าน) | 'gold' (เฉพาะงานทอง) · p_id null + 'gold' = ล้าง (ทองกลับไปใช้ค่าทั่วไป) · 'general' ล้างไม่ได้
-- สลับ = ล้างตัวเก่าก่อนแล้วตั้งตัวใหม่ (2 statement ในทรานแซกชันเดียว — partial unique ตรวจทีละแถว) · แบบต้อง is_active · ไม่กระทบใบที่มีอยู่
create or replace function analytics.job_record_profile_set_default(
  p_shop_id uuid,
  p_id      uuid,
  p_scope   text default 'general',
  p_actor   uuid default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_act   boolean;
begin
  if p_shop_id is null then
    raise exception 'job_record_profile_set_default: p_shop_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if v_actor is null then
    raise exception 'job_record_profile_set_default: ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  if p_scope is null or p_scope not in ('general', 'gold') then
    raise exception 'scope ต้องเป็น general หรือ gold' using errcode = '22023', hint = 'scope_invalid';
  end if;
  perform analytics.job_stage_def_ensure(p_shop_id);
  perform analytics.job_record_profile_ensure(p_shop_id);

  if p_id is null then
    if p_scope = 'general' then
      raise exception 'ค่าเริ่มของงานทั่วไปล้างไม่ได้ — ตั้งแบบอื่นแทน' using errcode = '22023', hint = 'default_required';
    end if;
    update analytics.job_record_profile set is_default_gold = false, updated_by = v_actor where shop_id = p_shop_id and is_default_gold;
  else
    select p.is_active into v_act from analytics.job_record_profile p where p.id = p_id and p.shop_id = p_shop_id for update;
    if not found then
      raise exception 'ไม่พบแบบการบันทึกในร้านนี้' using errcode = '22023', hint = 'profile_not_found';
    end if;
    if not v_act then
      raise exception 'ตั้งแบบที่ปิดใช้งานแล้วเป็นค่าเริ่มไม่ได้' using errcode = '22023', hint = 'inactive';
    end if;
    if p_scope = 'general' then
      update analytics.job_record_profile set is_default = false, updated_by = v_actor where shop_id = p_shop_id and is_default and id <> p_id;
      update analytics.job_record_profile set is_default = true, updated_by = v_actor where id = p_id and not is_default;
    else
      update analytics.job_record_profile set is_default_gold = false, updated_by = v_actor where shop_id = p_shop_id and is_default_gold and id <> p_id;
      update analytics.job_record_profile set is_default_gold = true, updated_by = v_actor where id = p_id and not is_default_gold;
    end if;
  end if;
  return jsonb_build_object('ok', true,
    'default_profile_id', analytics.job_profile_default_for(p_shop_id, null),
    'default_gold_profile_id', analytics.job_profile_default_for(p_shop_id, 'gold'));
end;
$f$;

-- เปลี่ยนแบบของใบงาน — ได้เฉพาะก่อนช่างรับงานขั้นแรก (ใบเดิม profile_id null ก็เปลี่ยนได้ถ้ายังไม่เริ่ม) · เขียน event profile_set พร้อม before/after
create or replace function analytics.job_profile_set(
  p_shop_id    uuid,
  p_job_id     uuid,
  p_profile_id uuid,
  p_actor      uuid default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor  uuid := coalesce(p_actor, auth.uid());
  v_job    analytics.job%rowtype;
  v_before jsonb;
  v_after  jsonb;
begin
  v_job := analytics.job_office_begin('job_profile_set', p_shop_id, p_job_id, v_actor);
  if p_profile_id is null then
    raise exception 'ต้องระบุแบบการบันทึก' using errcode = '22023', hint = 'profile_invalid';
  end if;
  -- security L1: ใบที่เคยมีการรับงาน (event stage_receive) แล้วย้อนขั้นจนทุกขั้นกลับเป็น pending ก็ถือว่าเริ่มแล้ว — flag ชั่งต้องไม่เปลี่ยนใต้ประวัติ/น้ำหนักที่บันทึกไว้
  if exists (select 1 from analytics.job_stage s where s.job_id = p_job_id and s.status in ('received', 'sent'))
     or exists (select 1 from analytics.job_event e where e.job_id = p_job_id and e.event_type = 'stage_receive') then
    raise exception 'เปลี่ยนแบบการบันทึกได้เฉพาะก่อนช่างรับงานขั้นแรก' using errcode = '22023', hint = 'started';
  end if;
  v_before := analytics.job_profile_state(p_job_id);
  v_after := analytics.job_profile_apply(p_job_id, p_profile_id);
  perform analytics.job_event_write(p_job_id, null, 'profile_set', analytics.job_today(), v_actor, null, 'job_page', null,
    jsonb_build_object('before', v_before, 'after', v_after));
  return jsonb_build_object('ok', true, 'job_no', v_job.job_no) || v_after;
end;
$f$;

-- seed ให้ทุกร้านที่มีอยู่ (เฉพาะร้านที่ยังไม่มีแบบเลย — ร้านที่มีแล้วไม่ถูกแตะ) · ร้านใหม่ในอนาคตได้ตอนเรียก suggest/list/upsert/set_default ครั้งแรก
select analytics.job_record_profile_ensure(s.id) from public.shop s;

-- ============================================================================
-- 5. replace — def ต้นทางลอกจากไฟล์ที่ apply จริง (ระบุที่หัวแต่ละตัว) · จุดที่แก้มี "-- 0176:" กำกับ (pre-check ใช้เครื่องหมายนี้แยกฉบับ) · ตรรกะอื่นเท่าเดิมทุกบรรทัด
-- ============================================================================

-- job_stage_suggest (def ต้นทาง 0172:1385 — ไม่เคยถูกแตะ): + ensure แบบ + profiles[] (เฉพาะ active) + default_profile_id (resolve ตามโลหะของรายการแล้ว · null = ร้านไม่มีค่าเริ่ม UI ต้องบล็อก ไม่เดา) + stages[].metal_present
create or replace function analytics.job_stage_suggest(p_shop_id uuid, p_source_kind text, p_item_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_info jsonb;
begin
  if p_shop_id is null or p_item_id is null then
    raise exception 'job_stage_suggest: p_shop_id และ p_item_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  perform analytics.job_stage_def_ensure(p_shop_id);
  -- 0176: seed แบบการบันทึกเฉพาะร้านที่ยังไม่มีแบบเลย
  perform analytics.job_record_profile_ensure(p_shop_id);
  v_info := analytics.job_source_info(p_shop_id, p_source_kind, p_item_id);
  return v_info || jsonb_build_object('stages', (
    select coalesce(jsonb_agg(jsonb_build_object('code', d.code, 'name_th', d.name_th, 'seq_default', d.seq_default,
                                                 'cost_block', d.cost_block, 'default_selected', d.code in (select jsonb_array_elements_text(v_info -> 'suggested_stage_codes')),
                                                 'metal_present', d.metal_present)
                              order by d.seq_default), '[]'::jsonb)
      from analytics.job_stage_def d where d.shop_id = p_shop_id and d.is_active),
    'profiles', (select coalesce(jsonb_agg(analytics.job_profile_json(p.id) order by p.seq, p.name), '[]'::jsonb)
                   from analytics.job_record_profile p where p.shop_id = p_shop_id and p.is_active),
    'default_profile_id', analytics.job_profile_default_for(p_shop_id, v_info ->> 'metal'));
end;
$f$;

-- signature เปลี่ยน ⇒ drop เดิมเต็มๆ ก่อน (ข้อ 1 · ไม่งั้น PostgREST เจอ 2 ตัว PGRST203) · caller เดิมใช้ named args ไม่ส่ง p_profile_id = ค่าเริ่มตามโลหะ
drop function if exists analytics.job_create_insert(uuid, text, uuid, uuid, int, uuid, uuid, text, text, text, int, date, text, text, text[], boolean, uuid, int, numeric, jsonb);
drop function if exists analytics.job_create_from_quote_item(uuid, uuid, text[], date, text, text, text, uuid, int, numeric, numeric, text);
drop function if exists analytics.job_create_from_production_item(uuid, uuid, text[], date, text, text, uuid, int, numeric, numeric, text);

-- job_create_insert (def ต้นทาง 0175:705 · +p_profile_id · flag ต่อขั้นมาจากแบบผ่าน job_profile_apply แทนตรรกะ metal เดิม)
create or replace function analytics.job_create_insert(
  p_shop_id uuid, p_source_kind text, p_oem_item_id uuid, p_root_quote_id uuid, p_oem_item_seq int,
  p_poi_id uuid, p_product_id uuid, p_design_label text, p_sku text, p_metal text, p_qty int,
  p_due date, p_gate_note text, p_note text, p_codes text[], p_is_new_design boolean, p_actor uuid,
  p_qty_order int, p_target_piece_g numeric, p_plan jsonb, p_profile_id uuid
)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_seq    int;
  v_job    analytics.job%rowtype;
  v_warn   text[];
  v_today  date := analytics.job_today();
  v_basis  jsonb;
  v_profile analytics.job_record_profile%rowtype;
  v_apply  jsonb;
begin
  -- p_qty = qty_planned (จำนวนเริ่มผลิต) · p_qty_order = จำนวนที่สั่ง · p_plan = ผลของ job_plan_compute
  if p_qty_order is null or not (p_qty_order between 1 and 100000) or p_qty is null or not (p_qty between 1 and 100000) then
    raise exception 'จำนวนสั่ง/จำนวนเริ่มผลิตต้องอยู่ระหว่าง 1 ถึง 100,000' using errcode = '22023', hint = 'qty_planned_invalid';
  end if;
  -- 0176: แบบการบันทึก — ไม่ส่งมา = ค่าเริ่มตามโลหะ (ทอง: is_default_gold ถ้ามี ไม่งั้น is_default) · ไม่มีค่าเริ่ม/แบบไม่ถูกต้อง (ไม่พบ/ร้านอื่น/ปิดใช้) = ปฏิเสธ ไม่เดา
  if p_profile_id is null then
    select p.* into v_profile from analytics.job_record_profile p where p.id = analytics.job_profile_default_for(p_shop_id, p_metal);
    if not found then
      raise exception 'ร้านนี้ยังไม่มีแบบการบันทึกค่าเริ่ม — ตั้งค่าเริ่มที่หน้าแบบการบันทึกก่อนสร้างใบงาน' using errcode = '22023', hint = 'no_default_profile';
    end if;
  else
    select p.* into v_profile from analytics.job_record_profile p where p.id = p_profile_id and p.shop_id = p_shop_id;
    if not found or not v_profile.is_active then
      raise exception 'แบบการบันทึกไม่ถูกต้อง (ไม่พบ/ของร้านอื่น/ปิดใช้งานแล้ว)' using errcode = '22023', hint = 'profile_invalid';
    end if;
  end if;
  v_basis := case when jsonb_typeof(p_plan -> 'basis') = 'object' then p_plan -> 'basis' end;
  v_warn := analytics.job_validate_stage_codes(p_shop_id, p_codes, p_is_new_design);
  if p_due is not null and (p_due < v_today or p_due > v_today + 730) then
    raise exception 'กำหนดส่งต้องไม่ย้อนหลังและไม่เกิน 2 ปีข้างหน้า' using errcode = '22023', hint = 'due_invalid';
  end if;

  insert into analytics.job_counter as c (shop_id, last_no) values (p_shop_id, 1)
  on conflict (shop_id) do update set last_no = c.last_no + 1
  returning c.last_no into v_seq;

  insert into analytics.job (shop_id, seq, source_kind, oem_quote_item_id, root_quote_id, oem_item_seq, production_order_item_id,
                             product_id, design_label, sku_snapshot, metal, qty_order, qty_planned, weigh_required, due_date,
                             start_gate_note, created_by, note, target_piece_g, metal_plan_g, metal_plan_basis,
                             profile_id, profile_name, require_final_weight)
  values (p_shop_id, v_seq, p_source_kind, p_oem_item_id, p_root_quote_id, p_oem_item_seq, p_poi_id,
          p_product_id, p_design_label, p_sku, p_metal, p_qty_order, p_qty, false, p_due,
          p_gate_note, p_actor, p_note, p_target_piece_g, (p_plan ->> 'metal_plan_g')::numeric, v_basis,
          v_profile.id, v_profile.name, v_profile.require_final_weight)
  returning * into v_job;

  -- 0176: ขั้นเริ่มปิดทั้ง 3 flag แล้ว job_profile_apply ตั้งตามแบบ (ที่เดียวที่ derive flag · ใช้ร่วมกับ job_profile_set) — ตรรกะ metal เดิม (ทอง/เงิน/ทองเหลือง) ถอดแล้ว
  insert into analytics.job_stage (job_id, shop_id, stage_code, seq, weigh_required, scrap_qty_ask, scrap_weight_ask)
  select v_job.id, p_shop_id, a.code, a.ord::int, false, false, false
    from unnest(p_codes) with ordinality as a(code, ord)
    join analytics.job_stage_def d on d.shop_id = p_shop_id and d.code = a.code
   order by a.ord;
  v_apply := analytics.job_profile_apply(v_job.id, v_profile.id);

  perform analytics.job_event_write(v_job.id, null, 'create', v_today, p_actor, null, 'job_page', null,
    jsonb_build_object('source_kind', p_source_kind, 'stage_codes', to_jsonb(p_codes), 'qty_planned', p_qty, 'metal', p_metal,
                       'qty_order', p_qty_order, 'target_piece_g', p_target_piece_g, 'metal_plan_g', v_job.metal_plan_g,
                       'due_date', p_due, 'start_gate_note_present', p_gate_note is not null,
                       'profile_id', v_profile.id, 'profile_name', v_profile.name, 'has_weigh', v_apply -> 'has_weigh',
                       'gold_unguarded', v_apply -> 'gold_unguarded'));

  return jsonb_build_object('job_id', v_job.id, 'job_no', v_job.job_no, 'status', v_job.status, 'metal', v_job.metal,
                            'qty_planned', v_job.qty_planned, 'stage_codes', to_jsonb(p_codes), 'warnings', to_jsonb(v_warn),
                            'start_gate_note_set', p_gate_note is not null,
                            'qty_order', v_job.qty_order, 'under_planned', v_job.qty_planned < v_job.qty_order,
                            'metal_plan_g', v_job.metal_plan_g, 'plan_missing', coalesce(v_basis -> 'missing', '[]'::jsonb),
                            'profile_id', v_profile.id, 'profile_name', v_profile.name, 'has_weigh', v_apply -> 'has_weigh',
                            'gold_unguarded', v_apply -> 'gold_unguarded');
end;
$f$;
-- job_create_from_quote_item (def ต้นทาง 0175:766 · +p_profile_id ส่งต่อ job_create_insert)
create or replace function analytics.job_create_from_quote_item(
  p_shop_id         uuid,
  p_quote_item_id   uuid,
  p_stage_codes     text[],
  p_due_date        date default null,
  p_start_gate_note text default null,
  p_design_label    text default null,
  p_note            text default null,
  p_actor           uuid default null,
  p_qty_planned     int default null,
  p_target_piece_g  numeric default null,
  p_metal_plan_override_g numeric default null,
  p_metal_plan_reason     text default null,
  p_profile_id            uuid default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_info  jsonb;
  v_gate  text;
  v_label text;
  v_note  text;
  v_dup   record;
  v_qty_order   int;
  v_qty_planned int;
  v_target      numeric;
  v_plan        jsonb;
begin
  if p_shop_id is null or p_quote_item_id is null then
    raise exception 'job_create_from_quote_item: p_shop_id และ p_quote_item_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if v_actor is null then
    raise exception 'job_create_from_quote_item: ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  -- กันสร้างซ้ำพร้อมกัน: ล็อกแถวใบเสนอราคาของ item นี้ก่อนตรวจ/นับเลข
  perform 1 from analytics.oem_quote q join analytics.oem_quote_item i on i.quote_id = q.id
   where i.id = p_quote_item_id and q.shop_id = p_shop_id for share of q;
  v_info := analytics.job_source_info(p_shop_id, 'oem', p_quote_item_id);
  if v_info -> 'existing_job' <> 'null'::jsonb then
    raise exception 'รายการนี้มีใบงาน % อยู่แล้ว — ถ้าต้องการสร้างใหม่ให้ยกเลิกใบเดิมก่อน', v_info -> 'existing_job' ->> 'job_no'
      using errcode = '22023', hint = 'job_exists';
  end if;
  v_gate := analytics.job_text_clean(p_start_gate_note, 'เหตุผลที่เริ่มผลิตก่อนมัดจำ', 500, false);
  if (v_info ->> 'deposit_missing')::boolean and v_gate is null then
    raise exception 'ดีลนี้ยังไม่มีเงินมัดจำเข้า — ต้องระบุเหตุผลที่ยอมเริ่มผลิตก่อน (start_gate_note)' using errcode = '22023', hint = 'start_gate_required';
  end if;
  if v_gate is not null and not analytics.oem_note_present(v_gate) then
    raise exception 'เหตุผลที่เริ่มผลิตก่อนมัดจำต้องมีตัวอักษรหรือตัวเลขจริง' using errcode = '22023', hint = 'start_gate_required';
  end if;
  -- มติเจ้าของ 12 ต.ค.: ใบงาน OEM ต้องให้ออฟฟิศตั้ง/ยืนยันชื่อเรียกภายในเสมอ (ค่าเริ่มต้นจาก job_stage_suggest.design_label ให้ UI เติมให้แก้ได้)
  -- ช่าง/ใบพิมพ์แสดงเฉพาะชื่อนี้ ไม่ดึง snapshot ของใบเสนอราคาเอง
  if nullif(btrim(coalesce(p_design_label, '')), '') is null then
    raise exception 'ใบงาน OEM ต้องตั้งชื่อเรียกภายใน (design_label) โดยออฟฟิศก่อนสร้าง' using errcode = '22023', hint = 'design_label_required';
  end if;
  v_label := analytics.job_label_clean(p_design_label, 'ชื่อเรียกใบงาน', 200);
  v_note := analytics.job_text_clean(p_note, 'หมายเหตุ', 500, false);
  -- M1: จำนวนเริ่มผลิต/น้ำหนักเป้าหมาย/แผนโลหะ — จำนวนสั่งมาจากต้นทางเสมอ ไม่รับจาก client
  v_qty_order := (v_info ->> 'qty')::int;
  v_qty_planned := coalesce(p_qty_planned, v_qty_order);
  if not (v_qty_planned between 1 and 100000) then
    raise exception 'จำนวนเริ่มผลิตต้องอยู่ระหว่าง 1 ถึง 100,000' using errcode = '22023', hint = 'qty_planned_invalid';
  end if;
  v_target := coalesce(p_target_piece_g, nullif(v_info ->> 'target_piece_g', '')::numeric);
  if v_target is not null and not (v_target > 0 and v_target <= 10000 and v_target = round(v_target, 3)) then
    raise exception 'น้ำหนักเป้าหมายต่อชิ้นต้องมากกว่า 0 ไม่เกิน 10,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)' using errcode = '22023', hint = 'target_invalid';
  end if;
  v_plan := analytics.job_plan_compute(p_shop_id, v_info ->> 'metal', v_qty_planned, v_target, p_metal_plan_override_g, p_metal_plan_reason,
    case when p_target_piece_g is not null then 'input' else v_info ->> 'target_piece_g_source' end);

  return analytics.job_create_insert(p_shop_id, 'oem', p_quote_item_id, (v_info ->> 'root_quote_id')::uuid, (v_info ->> 'item_seq')::int,
    null, nullif(v_info ->> 'product_id', '')::uuid, v_label, nullif(v_info ->> 'sku', ''), v_info ->> 'metal', v_qty_planned,
    p_due_date, v_gate, v_note, p_stage_codes, (v_info ->> 'is_new_design')::boolean, v_actor,
    v_qty_order, v_target, v_plan, p_profile_id);
end;
$f$;
-- job_create_from_production_item (def ต้นทาง 0175:847 · +p_profile_id)
create or replace function analytics.job_create_from_production_item(
  p_shop_id                  uuid,
  p_production_order_item_id uuid,
  p_stage_codes              text[],
  p_due_date                 date default null,
  p_design_label             text default null,
  p_note                     text default null,
  p_actor                    uuid default null,
  p_qty_planned              int default null,
  p_target_piece_g           numeric default null,
  p_metal_plan_override_g    numeric default null,
  p_metal_plan_reason        text default null,
  p_profile_id               uuid default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_info  jsonb;
  v_label text;
  v_note  text;
  v_qty_order   int;
  v_qty_planned int;
  v_target      numeric;
  v_plan        jsonb;
begin
  if p_shop_id is null or p_production_order_item_id is null then
    raise exception 'job_create_from_production_item: p_shop_id และ p_production_order_item_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if v_actor is null then
    raise exception 'job_create_from_production_item: ต้องระบุผู้ทำรายการ (p_actor)' using errcode = '22023', hint = 'actor_required';
  end if;
  perform 1 from analytics.production_order po join analytics.production_order_item poi on poi.production_order_id = po.id
   where poi.id = p_production_order_item_id and po.shop_id = p_shop_id for share of po;
  v_info := analytics.job_source_info(p_shop_id, 'production', p_production_order_item_id);
  if v_info -> 'existing_job' <> 'null'::jsonb then
    raise exception 'รายการนี้มีใบงาน % อยู่แล้ว — ถ้าต้องการสร้างใหม่ให้ยกเลิกใบเดิมก่อน', v_info -> 'existing_job' ->> 'job_no'
      using errcode = '22023', hint = 'job_exists';
  end if;
  v_label := coalesce(case when nullif(btrim(coalesce(p_design_label, '')), '') is null then null
                          else analytics.job_label_clean(p_design_label, 'ชื่อแบบ', 200) end, v_info ->> 'design_label');
  v_note := analytics.job_text_clean(p_note, 'หมายเหตุ', 500, false);
  -- M1: จำนวนเริ่มผลิต/น้ำหนักเป้าหมาย/แผนโลหะ — จำนวนสั่งมาจากต้นทางเสมอ ไม่รับจาก client
  v_qty_order := (v_info ->> 'qty')::int;
  v_qty_planned := coalesce(p_qty_planned, v_qty_order);
  if not (v_qty_planned between 1 and 100000) then
    raise exception 'จำนวนเริ่มผลิตต้องอยู่ระหว่าง 1 ถึง 100,000' using errcode = '22023', hint = 'qty_planned_invalid';
  end if;
  v_target := coalesce(p_target_piece_g, nullif(v_info ->> 'target_piece_g', '')::numeric);
  if v_target is not null and not (v_target > 0 and v_target <= 10000 and v_target = round(v_target, 3)) then
    raise exception 'น้ำหนักเป้าหมายต่อชิ้นต้องมากกว่า 0 ไม่เกิน 10,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)' using errcode = '22023', hint = 'target_invalid';
  end if;
  v_plan := analytics.job_plan_compute(p_shop_id, v_info ->> 'metal', v_qty_planned, v_target, p_metal_plan_override_g, p_metal_plan_reason,
    case when p_target_piece_g is not null then 'input' else v_info ->> 'target_piece_g_source' end);

  return analytics.job_create_insert(p_shop_id, 'production', null, null, null, p_production_order_item_id,
    nullif(v_info ->> 'product_id', '')::uuid, v_label, nullif(v_info ->> 'sku', ''), v_info ->> 'metal', v_qty_planned,
    p_due_date, null, v_note, p_stage_codes, (v_info ->> 'is_new_design')::boolean, v_actor,
    v_qty_order, v_target, v_plan, p_profile_id);
end;
$f$;
-- job_core_receive (def ต้นทาง 0175:197): ทอง "ห้ามปิดขั้นก่อนอัตโนมัติ" คงไว้เฉพาะใบเดิม (profile_id null) — ใบที่มีแบบใช้ v_p.weigh_required อย่างเดียว (บล็อกถัดไป) · handoff ±0.05 g (N1/N4) ไม่แก้
create or replace function analytics.job_core_receive(
  p_job_id        uuid,
  p_expected_seq  int,
  p_occurred_on   date,
  p_weight_in     numeric,
  p_worker_id     uuid,
  p_assignee      text,
  p_channel       text,
  p_actor         uuid,
  p_device_hint   text,
  p_enforce_scope boolean
)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_job     analytics.job%rowtype;
  v_t       analytics.job_stage%rowtype;
  v_t2      analytics.job_stage%rowtype;
  v_p       analytics.job_stage%rowtype;
  v_p2      analytics.job_stage%rowtype;
  v_today   date := analytics.job_today();
  v_codes   text[];
  v_name    text;
  v_def     text;
  v_auto    text := null;
  v_gap     numeric := null;
begin
  select * into v_job from analytics.job where id = p_job_id;
  if not found then
    return analytics.job_fail('job_not_found', 'ไม่พบใบงาน');
  end if;
  if v_job.status in ('done', 'cancelled') then
    return analytics.job_fail('job_closed', 'ใบงานนี้ปิดแล้ว รับงานไม่ได้');
  end if;
  if v_job.status = 'on_hold' then
    return analytics.job_fail('job_on_hold', 'ใบงานนี้ถูกพักไว้ รับงานไม่ได้ — แจ้งออฟฟิศ');
  end if;
  if p_expected_seq is null then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;

  select * into v_t from analytics.job_stage where job_id = p_job_id and seq = p_expected_seq;
  if not found then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;
  if v_t.status = 'received' then
    select coalesce(w.display_name, v_t.assignee_name, 'ผู้รับก่อนหน้า') into v_name
      from (select 1) x left join analytics.worker w on w.id = v_t.worker_id;
    return analytics.job_fail('already_received', format('ขั้นนี้ถูกรับไปแล้วโดย %s', v_name), jsonb_build_object('by', v_name));
  end if;
  if v_t.status <> 'pending' then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;
  if exists (select 1 from analytics.job_stage s where s.job_id = p_job_id and s.seq < v_t.seq and s.status = 'pending') then
    return analytics.job_fail('out_of_order', 'รับงานข้ามลำดับไม่ได้ — ขั้นก่อนหน้ายังไม่มีใครรับหรือข้าม');
  end if;

  -- วันที่: ช่างผ่าน QR = วันนี้เสมอ · ออฟฟิศย้อนได้ <= 14 วัน ไม่อนาคต (design §3 ข้อ 9 · มติ Q3)
  if p_occurred_on is null
     or p_occurred_on > v_today
     or (p_channel = 'worker_qr' and p_occurred_on <> v_today)
     or p_occurred_on < v_today - 14 then
    return analytics.job_fail('date_invalid', 'วันที่รับงานต้องไม่ใช่อนาคตและย้อนหลังได้ไม่เกิน 14 วัน (ช่างสแกนผ่าน QR ใช้วันนี้เท่านั้น)');
  end if;

  if p_worker_id is null and p_assignee is null then
    return analytics.job_fail('who_required', 'ต้องระบุผู้รับงาน');
  end if;
  if p_enforce_scope and p_worker_id is not null then
    select w.stage_codes into v_codes from analytics.worker w where w.id = p_worker_id;
    if not analytics.job_worker_can_do(v_codes, v_t.stage_code) then
      select d.name_th into v_def from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = v_t.stage_code;
      return analytics.job_fail('stage_not_allowed', format('งานนี้อยู่ขั้น "%s" ซึ่งคุณไม่ได้รับผิดชอบ', coalesce(v_def, v_t.stage_code)));
    end if;
  end if;

  if not analytics.job_weight_ok(p_weight_in) then
    return analytics.job_fail('weight_invalid', 'น้ำหนักเข้าต้องมากกว่า 0 และไม่เกิน 100,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)');
  end if;
  if v_t.weigh_required and p_weight_in is null then
    return analytics.job_fail('weight_required', 'ขั้นนี้ต้องชั่งน้ำหนักก่อนรับงาน');
  end if;

  -- ด่านมัดจำ (design §3 ข้อ 13 · มติ Q4): รับขั้นแรกของงาน OEM ที่ดีลยังไม่มีเงินเข้าเลย ต้องมีเหตุผลที่ออฟฟิศบันทึกไว้
  if analytics.job_deposit_blocked(v_job) then
    return analytics.job_fail('awaiting_deposit', 'รอมัดจำ — ดีลนี้ยังไม่มีเงินเข้า แจ้งออฟฟิศให้บันทึกเหตุผลก่อนเริ่มงาน');
  end if;

  -- ขั้นก่อนหน้า (ข้ามขั้นที่ skipped): ถ้ายังถือค้าง = ปิดอัตโนมัติ (ยกเว้นทอง) — ยืนยันฝ่ายเดียว (design §5.1 ข้อ 4)
  select * into v_p from analytics.job_stage s
   where s.job_id = p_job_id and s.seq < v_t.seq and s.status <> 'skipped' order by s.seq desc limit 1;
  if found then
    if v_p.status = 'received' then
      -- 0176: ใบทองเดิม (ก่อน profile) คงกติกา J1 · ใบที่มีแบบตัดสินจาก weigh_required ของขั้นก่อน (บล็อกถัดไป)
      if v_job.metal = 'gold' and v_job.profile_id is null then
        return analytics.job_fail('prev_not_sent', 'งานทอง: ขั้นก่อนหน้ายังไม่ได้กดส่งต่อ — ผู้ถือต้องกดส่งต่อพร้อมน้ำหนักออกก่อน');
      end if;
      -- QA 6: ขั้นก่อนหน้าบังคับชั่ง (เงิน: หล่อ/ตัดต้น/ขัด) และยังไม่มีน้ำหนักออก = ห้ามปิดอัตโนมัติ (ไม่งั้นรายงานน้ำหนักหายมีรูเงียบๆ)
      if v_p.weigh_required then
        return analytics.job_fail('prev_not_sent', 'ขั้นก่อนหน้าต้องชั่งน้ำหนักออกก่อน — ให้ผู้ถือกดส่งต่อพร้อมน้ำหนัก หรือแจ้งออฟฟิศกรอกแทน');
      end if;
      if p_occurred_on < v_p.received_on then
        return analytics.job_fail('date_invalid', 'วันรับต้องไม่ก่อนวันที่ขั้นก่อนหน้ารับงาน');
      end if;
      update analytics.job_stage
         set status = 'sent', sent_on = p_occurred_on, qty_out = qty_in, auto_closed = true
       where id = v_p.id
       returning * into v_p2;
      perform analytics.job_event_write(p_job_id, v_p.id, 'stage_send', p_occurred_on, p_actor, p_worker_id, p_channel, p_device_hint,
        jsonb_build_object('stage_code', v_p.stage_code, 'auto_closed', true, 'closed_by_receive_of', v_t.stage_code,
                           'before', analytics.job_stage_state(v_p), 'after', analytics.job_stage_state(v_p2)));
      v_auto := v_p.stage_code;
      v_p := v_p2;
    elsif v_p.status <> 'sent' then
      return analytics.job_fail('out_of_order', 'รับงานข้ามลำดับไม่ได้ — ขั้นก่อนหน้ายังไม่เสร็จ');
    end if;
    if p_occurred_on < v_p.sent_on then
      return analytics.job_fail('date_invalid', 'วันรับต้องไม่ก่อนวันที่ขั้นก่อนหน้าส่งต่อ');
    end if;
  end if;

  -- M1: น้ำหนักที่รับ vs น้ำหนักที่ขั้นก่อนหน้าส่งออก · ทอง ต่างเกิน 0.05 g = ปฏิเสธ (ต้องชั่งใหม่/ให้ออฟฟิศย้อนขั้นก่อนแก้) ·
  -- เงิน/ทองเหลือง ไม่บล็อก แต่เก็บส่วนต่างไว้ใน event + v_job_stage_loss.handoff_gap_g
  -- N4: เทียบเฉพาะเมื่อทั้งขั้นก่อนและขั้นนี้บังคับชั่ง (เทียน/ปูนไม่ถูกเทียบกับหล่อ)
  if v_p.id is not null and v_p.status = 'sent' and v_p.weight_out_g is not null and p_weight_in is not null
     and v_t.weigh_required and v_p.weigh_required then
    v_gap := p_weight_in - v_p.weight_out_g;
    if v_job.metal = 'gold' and abs(v_gap) > 0.05 then
      -- N1: ผู้รับต้องชั่งแบบไม่รู้คำตอบ — ข้อความ/ผลลัพธ์ไม่บอกขนาดส่วนต่างหรือน้ำหนักขั้นก่อน · แต่บันทึก event ทุกครั้งที่ไม่ตรงให้ออฟฟิศเห็น
      -- (event_type 'weigh' ที่ 0172 ประกาศไว้แต่ยังไม่ใช้ · payload.kind = handoff_mismatch · คนเรียกฝั่งออฟฟิศ raise ทำให้ event นี้ถอยกลับ ซึ่งยอมรับได้: ออฟฟิศเห็น error ตรงๆ)
      perform analytics.job_event_write(p_job_id, v_t.id, 'weigh', p_occurred_on, p_actor, p_worker_id, p_channel, p_device_hint,
        jsonb_build_object('kind', 'handoff_mismatch', 'stage_code', v_t.stage_code, 'weight_in_g', p_weight_in,
                           'prev_weight_out_g', v_p.weight_out_g, 'gap_g', v_gap));
      return analytics.job_fail('handoff_mismatch', 'น้ำหนักที่รับไม่ตรงกับที่ขั้นก่อนส่งมา — ชั่งใหม่ ถ้ายังไม่ตรงให้แจ้งออฟฟิศ');
    end if;
  end if;

  update analytics.job_stage
     set status = 'received', received_on = p_occurred_on, worker_id = p_worker_id, assignee_name = p_assignee,
         qty_in = case when v_p.id is not null then v_p.qty_out else v_job.qty_planned end,
         weight_in_g = p_weight_in
   where id = v_t.id
   returning * into v_t2;

  if v_job.weight_start_g is null and p_weight_in is not null and v_t.weigh_required then
    update analytics.job set weight_start_g = p_weight_in where id = p_job_id;
  end if;

  perform analytics.job_event_write(p_job_id, v_t.id, 'stage_receive', p_occurred_on, p_actor, p_worker_id, p_channel, p_device_hint,
    jsonb_build_object('stage_code', v_t.stage_code,
                       'auto_closed_prev', v_auto, 'handoff_gap_g', v_gap,
                       'before', analytics.job_stage_state(v_t), 'after', analytics.job_stage_state(v_t2)));

  select d.name_th into v_def from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = v_t.stage_code;
  return jsonb_build_object('ok', true, 'action', 'receive', 'job_no', v_job.job_no, 'stage_seq', v_t.seq, 'stage_code', v_t.stage_code,
                            'stage_name', v_def, 'received_on', p_occurred_on, 'qty_in', v_t2.qty_in, 'weight_in_g', v_t2.weight_in_g,
                            'prev_auto_closed', v_auto is not null,
                            'handoff_gap_g', case when v_job.metal = 'gold' then null else v_gap end);
end;
$f$;
-- job_stage_guard (def ต้นทาง 0173:453)
create or replace function analytics.job_stage_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_job    analytics.job%rowtype;
  v_prev   analytics.job_stage%rowtype;
  v_exp_in int;
begin
  if tg_op = 'DELETE' then
    raise exception 'job_stage: ห้ามลบขั้นของใบงาน' using errcode = '22023';
  end if;
  select * into v_job from analytics.job where id = new.job_id;
  if not found then
    raise exception 'job_stage: ไม่พบใบงาน' using errcode = '22023';
  end if;
  if new.shop_id is null then
    new.shop_id := v_job.shop_id;
  elsif new.shop_id <> v_job.shop_id then
    raise exception 'job_stage: ขั้นต้องอยู่ร้านเดียวกับใบงาน' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    if v_job.status <> 'open' then
      raise exception 'job_stage: เพิ่มขั้นได้เฉพาะตอนสร้างใบงาน' using errcode = '22023';
    end if;
    if new.status <> 'pending' then
      raise exception 'job_stage: ขั้นใหม่ต้องเริ่มที่ pending' using errcode = '22023';
    end if;
    if not exists (select 1 from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = new.stage_code and d.is_active) then
      raise exception 'job_stage: ขั้น % ถูกปิดใช้งานหรือไม่มีในทะเบียน', new.stage_code using errcode = '22023';
    end if;
    -- ลำดับใน job ต้องไม่ขัดกับ seq_default ของทะเบียน (design §3 ข้อ 12)
    if exists (
         select 1
           from analytics.job_stage s
           join analytics.job_stage_def d  on d.shop_id = s.shop_id and d.code = s.stage_code
           join analytics.job_stage_def dn on dn.shop_id = new.shop_id and dn.code = new.stage_code
          where s.job_id = new.job_id
            and ((s.seq < new.seq and d.seq_default > dn.seq_default) or (s.seq > new.seq and d.seq_default < dn.seq_default))) then
      raise exception 'job_stage: ลำดับขั้นต้องเรียงตามลำดับมาตรฐานของทะเบียนขั้นตอน' using errcode = '22023';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.job_id <> old.job_id or new.shop_id <> old.shop_id or new.stage_code <> old.stage_code or new.seq <> old.seq then
    raise exception 'job_stage: ห้ามเปลี่ยนใบงาน/ขั้น/ลำดับของขั้นที่สร้างแล้ว' using errcode = '22023';
  end if;
  -- 0176: flag ชั่ง/ของเสียเปลี่ยนได้เฉพาะขั้นที่ยังไม่เริ่ม (pending/skipped · ไม่เปลี่ยนสถานะพร้อมกัน) และยังไม่มีขั้นไหนของใบถูกรับ/ส่ง — ทางเดียวคือ job_profile_apply
  if (new.weigh_required <> old.weigh_required or new.scrap_qty_ask <> old.scrap_qty_ask or new.scrap_weight_ask <> old.scrap_weight_ask)
     and not (old.status in ('pending', 'skipped') and new.status = old.status
              and not exists (select 1 from analytics.job_stage s where s.job_id = new.job_id and s.status in ('received', 'sent'))) then
    raise exception 'job_stage: ห้ามเปลี่ยนกติกาชั่ง/ของเสียของขั้นหลังช่างรับงานขั้นแรกแล้ว (เปลี่ยนได้ก่อนเริ่มผ่านการเปลี่ยนแบบการบันทึกเท่านั้น)' using errcode = '22023', hint = 'started';
  end if;
  if v_job.status in ('done', 'cancelled') then
    raise exception 'job_stage: ใบงาน % สถานะ % แล้ว แก้ขั้นไม่ได้', v_job.job_no, v_job.status using errcode = '22023';
  end if;

  if new.status = old.status then
    if old.status in ('received', 'sent') and analytics.job_stage_state(new) is distinct from analytics.job_stage_state(old) then
      raise exception 'job_stage: ขั้นที่รับ/ส่งแล้วแก้ตรงไม่ได้ — ใช้ย้อนขั้น (job_stage_reopen) พร้อมเหตุผล' using errcode = '22023';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if old.status = 'pending' and new.status = 'received' then
    if v_job.status = 'on_hold' then
      raise exception 'job_stage: ใบงานถูกพักอยู่ รับงานไม่ได้' using errcode = '22023';
    end if;
    if exists (select 1 from analytics.job_stage s where s.job_id = new.job_id and s.seq < new.seq and s.status = 'pending') then
      raise exception 'job_stage: รับงานข้ามลำดับไม่ได้ — ขั้นก่อนหน้ายังไม่มีใครรับหรือข้าม' using errcode = '22023';
    end if;
    if exists (select 1 from analytics.job_stage s where s.job_id = new.job_id and s.id <> new.id and s.status = 'received') then
      raise exception 'job_stage: ยังมีขั้นอื่นที่รับค้างอยู่ — ต้องส่งต่อก่อน' using errcode = '22023';
    end if;
    select * into v_prev from analytics.job_stage s
     where s.job_id = new.job_id and s.seq < new.seq and s.status <> 'skipped' order by s.seq desc limit 1;
    if found then
      if v_prev.status <> 'sent' then
        raise exception 'job_stage: ขั้นก่อนหน้ายังไม่ถูกส่งต่อ' using errcode = '22023';
      end if;
      v_exp_in := v_prev.qty_out;
      if new.received_on < v_prev.sent_on then
        raise exception 'job_stage: วันรับ (%) ต้องไม่ก่อนวันส่งของขั้นก่อนหน้า (%)', new.received_on, v_prev.sent_on using errcode = '22023';
      end if;
    else
      v_exp_in := v_job.qty_planned;
    end if;
    if new.qty_in is distinct from v_exp_in then
      raise exception 'job_stage: จำนวนเข้า (%) ต้องเท่าจำนวนที่ส่งออกจากขั้นก่อนหน้า (%)', new.qty_in, v_exp_in using errcode = '22023';
    end if;
  elsif old.status = 'pending' and new.status = 'skipped' then
    if new.stage_code in ('qc', 'pack') then
      raise exception 'job_stage: ข้ามขั้น QC และแพ็กไม่ได้' using errcode = '22023';
    end if;
  elsif old.status = 'received' and new.status = 'sent' then
    -- 0176: ขั้นที่ต้องชั่งปิดอัตโนมัติไม่ได้ทุกโลหะ + ใบทองเดิม (ก่อน profile) ปิดอัตโนมัติไม่ได้ทุกขั้นเหมือน J1
    if new.auto_closed and (new.weigh_required or (v_job.metal = 'gold' and v_job.profile_id is null)) then
      raise exception 'job_stage: งานทอง/ขั้นที่ต้องชั่งปิดขั้นอัตโนมัติไม่ได้ — ต้องกดส่งต่อพร้อมน้ำหนักออก' using errcode = '22023';
    end if;
  elsif (old.status = 'received' and new.status = 'pending')
     or (old.status = 'sent' and new.status = 'received')
     or (old.status = 'skipped' and new.status = 'pending') then
    -- ย้อนขั้น: ทำได้เมื่อไม่มีขั้นถัดไปที่ received/sent อยู่ (design §3 ข้อ 4)
    if exists (select 1 from analytics.job_stage s where s.job_id = new.job_id and s.seq > new.seq and s.status in ('received', 'sent')) then
      raise exception 'job_stage: ย้อนข้ามขั้นที่ขั้นถัดไปรับหรือส่งไปแล้วไม่ได้ — ย้อนทีละขั้นจากขั้นล่าสุด' using errcode = '22023';
    end if;
  else
    raise exception 'job_stage: เปลี่ยนสถานะ % -> % ไม่ได้', old.status, new.status using errcode = '22023';
  end if;

  new.updated_at := now();
  return new;
end;
$f$;
-- job_guard (def ต้นทาง 0175:918): INSERT ต้องมีแบบ (active · ร้านเดียวกัน · ชื่อ/flag snapshot ตรงแบบ) · UPDATE: weigh_required/profile_*/require_final_weight ถอดจากรายการแช่แข็งไปตรวจแยก (แก้ได้ก่อนขั้นแรกถูกรับ)
-- S6 (code review 0175): สูตรแผนโลหะ = จำนวน × น้ำหนักต่อชิ้น × (1 + อัตราก้านต้น%) ปัด 3 ตำแหน่ง — job_guard ใช้ผ่าน job_plan_basis_assert
-- (job_plan_compute ของ 0175 ยังมีสูตรเดียวกันอยู่ในตัวเอง — 0176 ไม่แตะฟังก์ชันนั้น · ถ้าแก้สูตร ต้องแก้ 2 ที่จนกว่าจะ replace job_plan_compute ให้เรียก helper นี้)
create or replace function analytics.job_plan_formula(p_qty int, p_target numeric, p_sprue_pct numeric)
 returns numeric
 language sql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $f$
  select round(p_qty * p_target * (1 + p_sprue_pct / 100), 3)
$f$;

-- ตรวจ metal_plan_basis ของแถว job ว่าตรงกับตัวเลขที่มันอธิบาย (plan_drift) — ยกมาจากบล็อกที่ซ้ำกันเป๊ะ 2 ที่ใน job_guard ของ 0175 (INSERT/UPDATE) · พฤติกรรมเท่าเดิมทุกข้อความ/hint
-- ภายใน (ไม่ grant) · เรียกจาก job_guard เท่านั้น
create or replace function analytics.job_plan_basis_assert(p analytics.job)
 returns void
 language plpgsql
 stable
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_ov text;
  v_cp text;
begin
  if p.metal_plan_basis is not null then
    if jsonb_typeof(p.metal_plan_basis -> 'target_piece_g') is distinct from 'number'
       or jsonb_typeof(p.metal_plan_basis -> 'qty_planned') is distinct from 'number'
       or (p.metal_plan_basis ->> 'target_piece_g')::numeric is distinct from p.target_piece_g
       or (p.metal_plan_basis ->> 'qty_planned')::numeric is distinct from p.qty_planned::numeric then
      raise exception 'job: แผนโลหะไม่ตรงกับจำนวนเริ่มผลิต/น้ำหนักเป้าหมาย (plan_drift)' using errcode = '22023', hint = 'plan_drift';
    end if;
    v_ov := jsonb_typeof(p.metal_plan_basis -> 'override_g');
    v_cp := jsonb_typeof(p.metal_plan_basis -> 'computed_g');
    -- basis ต้องไม่ใช่ของปลอม: ที่มาน้ำหนักถูกบันทึก · override ต้องมีเหตุผลจริง · computed_g ต้องเท่าสูตรเดียวกับ job_plan_compute เป๊ะ (security L1/L4)
    if jsonb_typeof(p.metal_plan_basis -> 'target_source') is distinct from 'string'
       or (p.metal_plan_basis ->> 'target_source') not in ('quote', 'product', 'input') then
      raise exception 'job: basis ของแผนโลหะไม่ระบุที่มาของน้ำหนักเป้าหมาย (plan_drift)' using errcode = '22023', hint = 'plan_drift';
    end if;
    if v_ov = 'number' and not coalesce(analytics.oem_note_present(p.metal_plan_basis ->> 'override_reason'), false) then
      raise exception 'job: แผนโลหะที่กำหนดเองต้องมีเหตุผล (plan_drift)' using errcode = '22023', hint = 'plan_drift';
    end if;
    if v_cp = 'number' then
      if jsonb_typeof(p.metal_plan_basis -> 'sprue_loss_pct') is distinct from 'number'
         or (p.metal_plan_basis ->> 'computed_g')::numeric is distinct from analytics.job_plan_formula(p.qty_planned, p.target_piece_g, (p.metal_plan_basis ->> 'sprue_loss_pct')::numeric) then
        raise exception 'job: computed_g ไม่ตรงสูตรจำนวน × น้ำหนัก × (1 + อัตราก้านต้น) (plan_drift)' using errcode = '22023', hint = 'plan_drift';
      end if;
    elsif v_cp = 'null' and v_ov = 'null' and jsonb_typeof(p.metal_plan_basis -> 'sprue_loss_pct') is distinct from 'null' then
      raise exception 'job: ไม่มี computed_g แต่ basis ระบุอัตราก้านต้น (plan_drift)' using errcode = '22023', hint = 'plan_drift';
    end if;
    if v_ov = 'number' then
      if (p.metal_plan_basis ->> 'override_g')::numeric is distinct from p.metal_plan_g then
        raise exception 'job: โลหะที่ต้องเตรียมไม่ตรงกับค่าที่กำหนดเองใน basis (plan_drift)' using errcode = '22023', hint = 'plan_drift';
      end if;
    elsif v_ov = 'null' and v_cp = 'number' then
      if (p.metal_plan_basis ->> 'computed_g')::numeric is distinct from p.metal_plan_g then
        raise exception 'job: โลหะที่ต้องเตรียมไม่ตรงกับค่าที่ DB คำนวณใน basis (plan_drift)' using errcode = '22023', hint = 'plan_drift';
      end if;
    elsif v_ov = 'null' and v_cp = 'null' then
      if p.metal_plan_g is not null then
        raise exception 'job: ไม่มีผลคำนวณใน basis แต่มี metal_plan_g (plan_drift)' using errcode = '22023', hint = 'plan_drift';
      end if;
    else
      raise exception 'job: basis ของแผนโลหะรูปร่างไม่ถูกต้อง (plan_drift)' using errcode = '22023', hint = 'plan_drift';
    end if;
  end if;

end;
$f$;

create or replace function analytics.job_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_item_shop   uuid;
  v_item_seq    int;
  v_item_input  jsonb;
  v_q_status    text;
  v_q_root      uuid;
  v_po_status   text;
  v_poi_product uuid;
  v_prod_shop   uuid;
  v_item_qty    int;
  v_ov          text;
  v_cp          text;
  v_pf_name     text;
  v_pf_final    boolean;
  v_pf_active   boolean;
  v_pf_found    boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'job: ห้ามลบใบงาน — ยกเลิกด้วย job_cancel แทน (เก็บไว้เป็นหลักฐานการผลิต)' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'open' or new.done_at is not null or new.cancelled_at is not null
       or new.qty_good is not null or new.qty_scrap is not null or new.weight_final_g is not null then
      raise exception 'job: ใบงานใหม่ต้องเริ่มที่สถานะ open และยังไม่มีผลปิดงาน' using errcode = '22023';
    end if;
    -- 0176: ใบใหม่ต้องมีแบบการบันทึก (แบบ active ของร้านเดียวกัน) · ชื่อและ flag น้ำหนักสุทธิที่ snapshot ต้องตรงกับแบบ — ไม่งั้นใบเงียบๆ ไม่มีกติกา/ปลอมชื่อแบบ
    if new.profile_id is null then
      raise exception 'job: ใบงานใหม่ต้องมีแบบการบันทึก (profile_required)' using errcode = '22023', hint = 'profile_required';
    end if;
    select p.name, p.require_final_weight, p.is_active, true into v_pf_name, v_pf_final, v_pf_active, v_pf_found
      from analytics.job_record_profile p where p.id = new.profile_id and p.shop_id = new.shop_id;
    if v_pf_found is not true or not v_pf_active then
      raise exception 'job: แบบการบันทึกไม่ถูกต้อง (ไม่พบ/ของร้านอื่น/ปิดใช้งาน)' using errcode = '22023', hint = 'profile_invalid';
    end if;
    if new.profile_name is distinct from v_pf_name or new.require_final_weight is distinct from v_pf_final then
      raise exception 'job: ชื่อแบบ/กติกาน้ำหนักสุทธิของใบไม่ตรงกับแบบการบันทึก' using errcode = '22023', hint = 'profile_invalid';
    end if;
    if new.source_kind = 'oem' then
      select i.shop_id, i.seq, i.input, q.status, coalesce(q.root_quote_id, q.id), i.qty
        into v_item_shop, v_item_seq, v_item_input, v_q_status, v_q_root, v_item_qty
        from analytics.oem_quote_item i
        join analytics.oem_quote q on q.id = i.quote_id
       where i.id = new.oem_quote_item_id;
      if not found then
        raise exception 'job: ไม่พบรายการใบเสนอราคา' using errcode = '22023';
      end if;
      if v_item_shop <> new.shop_id then
        raise exception 'job: รายการใบเสนอราคาเป็นของร้านอื่น สร้างใบงานข้ามร้านไม่ได้' using errcode = '22023';
      end if;
      if v_q_status <> 'won' then
        raise exception 'job: สร้างใบงานได้เฉพาะใบเสนอราคาที่ได้งานแล้ว (won) — ใบนี้สถานะ %', v_q_status using errcode = '22023';
      end if;
      if new.root_quote_id <> v_q_root or new.oem_item_seq <> v_item_seq then
        raise exception 'job: ดีล/ลำดับรายการไม่ตรงกับใบเสนอราคา' using errcode = '22023';
      end if;
      if new.metal is distinct from (v_item_input ->> 'metal') then
        raise exception 'job: โลหะของใบงานไม่ตรงกับรายการใบเสนอราคา' using errcode = '22023';
      end if;
    else
      select poi.shop_id, po.status, poi.product_id, poi.qty_planned
        into v_item_shop, v_po_status, v_poi_product, v_item_qty
        from analytics.production_order_item poi
        join analytics.production_order po on po.id = poi.production_order_id
       where poi.id = new.production_order_item_id;
      if not found then
        raise exception 'job: ไม่พบรายการในใบผลิต' using errcode = '22023';
      end if;
      if v_item_shop <> new.shop_id then
        raise exception 'job: รายการใบผลิตเป็นของร้านอื่น สร้างใบงานข้ามร้านไม่ได้' using errcode = '22023';
      end if;
      if v_po_status <> 'open' then
        raise exception 'job: สร้างใบงานได้เฉพาะใบผลิตที่ยังเปิดอยู่ (open) — ใบนี้สถานะ %', v_po_status using errcode = '22023';
      end if;
      if new.product_id is distinct from v_poi_product then
        raise exception 'job: สินค้าของใบงานไม่ตรงกับรายการใบผลิต' using errcode = '22023';
      end if;
    end if;
    -- M1: จำนวนสั่ง = จำนวนจากต้นทางเสมอ (OEM = qty รายการใบเสนอราคา · ผลิต = qty_planned ของรายการใบผลิต) · ของเหลือตั้งตอนสร้างไม่ได้
    if new.qty_order is distinct from v_item_qty then
      raise exception 'job: จำนวนที่สั่ง (qty_order) ต้องตรงกับจำนวนในต้นทาง (%)', v_item_qty using errcode = '22023';
    end if;
    if new.surplus_disposition is not null or new.surplus_note is not null then
      raise exception 'job: ใบงานใหม่ตั้งการจัดการของเหลือไม่ได้' using errcode = '22023';
    end if;
    -- แผนโลหะต้องตรงกับ basis ที่อธิบายมัน (plan_drift) — helper เดียวกับ UPDATE (0176: ยกจากบล็อกที่ซ้ำกัน 2 ที่ของ 0175)
    perform analytics.job_plan_basis_assert(new);
    if new.product_id is not null then
      select p.shop_id into v_prod_shop from public.product p where p.id = new.product_id;
      if v_prod_shop is distinct from new.shop_id then
        raise exception 'job: สินค้าเป็นของร้านอื่น' using errcode = '22023';
      end if;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.shop_id <> old.shop_id or new.seq <> old.seq or new.source_kind <> old.source_kind
     or new.oem_quote_item_id is distinct from old.oem_quote_item_id
     or new.root_quote_id is distinct from old.root_quote_id
     or new.oem_item_seq is distinct from old.oem_item_seq
     or new.production_order_item_id is distinct from old.production_order_item_id
     or new.product_id is distinct from old.product_id
     or new.sku_snapshot is distinct from old.sku_snapshot
     or new.metal <> old.metal or new.qty_order <> old.qty_order
     or new.created_at <> old.created_at or new.created_by <> old.created_by then
    raise exception 'job: ห้ามเปลี่ยนข้อมูลตั้งต้นของใบงาน (ร้าน/เลขที่/ต้นทาง/แบบ/โลหะ/จำนวน) — ยกเลิกแล้วสร้างใหม่' using errcode = '22023';
  end if;
  if old.status = 'cancelled' then
    raise exception 'job: ใบงาน % สถานะ % แล้ว แก้ไม่ได้', old.job_no, old.status using errcode = '22023';
  end if;
  -- done แล้วแก้ไม่ได้ ยกเว้นการจัดการของเหลือ (surplus_*) — ทุกคอลัมน์อื่นต้องเท่าเดิมเป๊ะ (job_surplus_set เท่านั้นที่ใช้ช่องนี้)
  -- ตัด job_no ออกจากการเทียบ: เป็น generated column คำนวณหลัง BEFORE trigger จึงเป็น null ใน NEW เสมอ (design §8.4 ไม่ได้กันไว้ — verify B4b จับได้)
  if old.status = 'done'
     and (to_jsonb(new) - 'surplus_disposition' - 'surplus_note' - 'updated_at' - 'job_no')
         is distinct from (to_jsonb(old) - 'surplus_disposition' - 'surplus_note' - 'updated_at' - 'job_no') then
    raise exception 'job: ใบงาน % สถานะ % แล้ว แก้ไม่ได้ (ยกเว้นการจัดการของเหลือ)', old.job_no, old.status using errcode = '22023';
  end if;
  if new.status <> old.status and not (
       (old.status = 'open' and new.status in ('in_progress', 'on_hold', 'done', 'cancelled'))
    or (old.status = 'in_progress' and new.status in ('open', 'on_hold', 'done', 'cancelled'))
    or (old.status = 'on_hold' and new.status in ('open', 'in_progress', 'done', 'cancelled'))) then
    raise exception 'job: เปลี่ยนสถานะ % -> % ไม่ได้', old.status, new.status using errcode = '22023';
  end if;
  if new.status = 'done' and exists (
       select 1 from analytics.job_stage s where s.job_id = new.id and s.status in ('pending', 'received')) then
    raise exception 'job: ปิดงานไม่ได้ — ยังมีขั้นที่ยังไม่รับ/ยังไม่ส่งต่อ' using errcode = '22023';
  end if;
  -- จำนวนเริ่มผลิตแก้ได้เฉพาะก่อนขั้นแรกถูกรับ (หลังจากนั้นจำนวนชิ้นในขั้นยึดตามค่านี้แล้ว)
  if new.qty_planned <> old.qty_planned
     and exists (select 1 from analytics.job_stage s where s.job_id = new.id and s.status in ('received', 'sent')) then
    raise exception 'job: แก้จำนวนเริ่มผลิตได้เฉพาะก่อนขั้นแรกถูกรับ' using errcode = '22023', hint = 'started';
  end if;
  -- 0176: แบบการบันทึก/กติกาชั่งของใบ แก้ได้ก่อนขั้นแรกถูกรับเท่านั้น (ทางเดียว = job_profile_apply) · profile_id ถอดคืนเป็น null ไม่ได้ · ใบเดิม (null) ตั้ง require_final_weight เองไม่ได้ ·
  -- แบบต้อง active ร้านเดียวกัน + ชื่อ/flag ตรงแบบ · weigh_required ต้องเท่า exists(ขั้นที่ weigh_required) ณ ตอนนั้น (weigh_drift)
  if new.weigh_required <> old.weigh_required or new.profile_id is distinct from old.profile_id
     or new.profile_name is distinct from old.profile_name or new.require_final_weight <> old.require_final_weight then
    if exists (select 1 from analytics.job_stage s where s.job_id = new.id and s.status in ('received', 'sent')) then
      raise exception 'job: แก้แบบการบันทึก/กติกาชั่งได้เฉพาะก่อนขั้นแรกถูกรับ' using errcode = '22023', hint = 'started';
    end if;
    if new.profile_id is null then
      if old.profile_id is not null or new.require_final_weight <> old.require_final_weight then
        raise exception 'job: ถอดแบบการบันทึกออกจากใบไม่ได้ (profile_invalid)' using errcode = '22023', hint = 'profile_invalid';
      end if;
    else
      select p.name, p.require_final_weight, p.is_active, true into v_pf_name, v_pf_final, v_pf_active, v_pf_found
        from analytics.job_record_profile p where p.id = new.profile_id and p.shop_id = new.shop_id;
      if v_pf_found is not true or not v_pf_active
         or new.profile_name is distinct from v_pf_name or new.require_final_weight is distinct from v_pf_final then
        raise exception 'job: แบบการบันทึกไม่ถูกต้อง/ชื่อหรือกติกาน้ำหนักสุทธิไม่ตรงแบบ (profile_invalid)' using errcode = '22023', hint = 'profile_invalid';
      end if;
    end if;
    if new.weigh_required is distinct from exists (select 1 from analytics.job_stage s where s.job_id = new.id and s.weigh_required) then
      raise exception 'job: weigh_required ไม่ตรงกับขั้นที่ต้องชั่งของใบ (weigh_drift)' using errcode = '22023', hint = 'weigh_drift';
    end if;
  end if;
  -- แผนโลหะแก้ได้จนกว่าขั้นหล่อ (cast) จะถูกรับ
  if (new.target_piece_g is distinct from old.target_piece_g or new.metal_plan_g is distinct from old.metal_plan_g
      or new.metal_plan_basis is distinct from old.metal_plan_basis)
     and exists (select 1 from analytics.job_stage s where s.job_id = new.id and s.stage_code = 'cast' and s.status in ('received', 'sent')) then
    raise exception 'job: แก้แผนโลหะได้เฉพาะก่อนขั้นหล่อถูกรับ' using errcode = '22023', hint = 'cast_started';
  end if;
  -- แผนโลหะต้องตรงกับ basis ที่อธิบายมัน (plan_drift) — helper เดียวกับ INSERT
  perform analytics.job_plan_basis_assert(new);
  if new.status <> 'done' and (new.surplus_disposition is not null or new.surplus_note is not null) then
    raise exception 'job: ตั้งการจัดการของเหลือได้เฉพาะใบงานที่ปิดแล้ว (done)' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$f$;
-- job_worker_resolve (def ต้นทาง 0174:415): D6 ใช้ helper job_deposit_blocked/job_worker_can_do (ปิดหนี้ 0175) · prev_not_sent ตาม weigh_required ของขั้นที่ถือ (ทองเดิมคงกติกา J1) ·
-- action_stage + scrap_qty_ask/scrap_weight_ask · job + has_profile (+ profile_name เฉพาะช่างที่ระบุตัวแล้ว) · ไม่มี key น้ำหนักใหม่ (N1 คงเดิม: prev_weight_out_g ของทอง = null)
create or replace function analytics.job_worker_resolve(p_token_hash text, p_session_hash text default null, p_ip_hash text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
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
begin
  v_a := analytics.job_worker_auth(p_token_hash, p_session_hash, p_ip_hash, false, false, 'none');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  select * into v_job from analytics.job where id = (v_a ->> 'job_id')::uuid;
  v_worker := nullif(v_a ->> 'worker_id', '')::uuid;

  select * into v_hold from analytics.job_stage where job_id = v_job.id and status = 'received' limit 1;
  select * into v_pend from analytics.job_stage where job_id = v_job.id and status = 'pending' order by seq limit 1;
  select exists (select 1 from analytics.job_stage where job_id = v_job.id and status in ('received', 'sent')) into v_started;
  if v_hold.id is not null then
    select coalesce(w.display_name, v_hold.assignee_name) into v_holder from (select 1) x left join analytics.worker w on w.id = v_hold.worker_id;
  end if;

  if v_hold.id is null and v_pend.id is null then
    -- QA 5: ทุกขั้นส่งต่อ/ข้ามครบแล้วแต่ออฟฟิศยังไม่ปิดงาน — ไม่ใช่ "ให้ระบุตัว"
    v_action := 'all_done';
  elsif v_worker is null then
    v_action := 'identify';
    -- รายชื่อช่างที่ทำขั้นถัดไปของงานนี้ได้ (ขั้นที่ถือค้างหรือขั้นที่รอรับ) — เฉพาะ id + ชื่อ
    select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'display_name', w.display_name) order by w.display_name), '[]'::jsonb)
      into v_workers
      from analytics.worker w
     where w.shop_id = v_job.shop_id and w.is_active
       and (cardinality(w.stage_codes) = 0
            or (v_hold.id is not null and v_hold.stage_code = any (w.stage_codes))
            or (v_pend.id is not null and v_pend.stage_code = any (w.stage_codes)));
  else
    select w.stage_codes into v_wcodes from analytics.worker w where w.id = v_worker;
    if v_hold.id is not null and v_hold.worker_id = v_worker then
      v_action := 'send'; v_seq := v_hold.seq; v_code := v_hold.stage_code; v_need_w := v_hold.weigh_required;
    elsif v_pend.id is not null then
      v_seq := v_pend.seq; v_code := v_pend.stage_code; v_need_w := v_pend.weigh_required;
      if v_job.status = 'on_hold' then
        v_action := 'on_hold';
      elsif not analytics.job_worker_can_do(v_wcodes, v_pend.stage_code) then
        v_action := 'not_your_stage';
      elsif v_hold.id is not null and ((v_job.metal = 'gold' and v_job.profile_id is null) or v_hold.weigh_required) then
        -- QA N1: ขั้นก่อนบังคับชั่ง (หรือใบทองเดิม) ยังไม่ส่งต่อ -> บอกตั้งแต่ resolve ไม่ใช่ให้กดแล้วไป fail
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
                                     'profile_name', v_job.profile_name, 'has_profile', v_job.profile_id is not null) end,
    'viewer', case when v_worker is null then null
              else jsonb_build_object('worker_id', v_worker, 'display_name', v_a ->> 'worker_name') end,
    'session_expired', (v_a ->> 'session_expired')::boolean,
    'next_action', v_action,
    'action_stage', case when v_seq is null then null
                      else jsonb_build_object('seq', v_seq, 'code', v_code, 'name', v_name, 'weight_required', v_need_w,
                                           'scrap_qty_ask', coalesce(v_sq, true), 'scrap_weight_ask', coalesce(v_sw, false)) end,
    'prev_weight_out_g', v_prev_w,
    -- L1: ชื่อผู้ถือเห็นได้เฉพาะช่างที่ระบุตัวแล้ว
    'held_by', case when v_worker is null then null else v_holder end,
    'workers', v_workers,
    'scrap_reasons', case when v_action = 'send' then to_jsonb(array['porosity', 'broken', 'wrong_design', 'missing', 'other']) else '[]'::jsonb end
  );
end;
$f$;
-- job_done (def ต้นทาง 0175:1284 — signature เท่าเดิม): น้ำหนักสุทธิบังคับเมื่อ require_final_weight หรือ (ทอง ∧ weigh_required) — กติกา J1 เดิม (security M1)
create or replace function analytics.job_done(
  p_shop_id        uuid,
  p_job_id         uuid,
  p_qty_good       int,
  p_qty_scrap      int,
  p_weight_final_g numeric default null,
  p_note           text default null,
  p_actor          uuid default null,
  p_surplus_disposition text default null,
  p_surplus_note        text default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor     uuid := coalesce(p_actor, auth.uid());
  v_job       analytics.job%rowtype;
  v_open      int;
  v_first     text;
  v_final_out int;
  v_note      text;
  v_tokens    int;
  v_today     date := analytics.job_today();
  v_surplus   int;
  v_disp      text := null;
  v_snote     text := null;
begin
  v_job := analytics.job_office_begin('job_done', p_shop_id, p_job_id, v_actor);
  select count(*), min(d.name_th) into v_open, v_first
    from analytics.job_stage s join analytics.job_stage_def d on d.shop_id = s.shop_id and d.code = s.stage_code
   where s.job_id = p_job_id and s.status in ('pending', 'received');
  if v_open > 0 then
    raise exception 'ปิดงานไม่ได้ — ยังมี % ขั้นที่ยังไม่เสร็จ (เช่น %)', v_open, v_first using errcode = '22023', hint = 'stages_open';
  end if;
  if p_qty_good is null or p_qty_scrap is null or p_qty_good < 0 or p_qty_scrap < 0 or p_qty_good > 100000 or p_qty_scrap > 100000
     or p_qty_good + p_qty_scrap <> v_job.qty_planned then
    raise exception 'จำนวนดี + จำนวนเสีย ต้องเท่ากับจำนวนที่วางแผน (% ชิ้น)', v_job.qty_planned using errcode = '22023', hint = 'qty_mismatch';
  end if;
  select s.qty_out into v_final_out from analytics.job_stage s
   where s.job_id = p_job_id and s.status = 'sent' order by s.seq desc limit 1;
  v_final_out := coalesce(v_final_out, v_job.qty_planned);
  if p_qty_good > v_final_out then
    raise exception 'จำนวนดี (%) มากกว่าจำนวนที่เหลือจากขั้นสุดท้าย (%) — ตรวจของเสียรายขั้นก่อน', p_qty_good, v_final_out
      using errcode = '22023', hint = 'qty_exceeds_final';
  end if;
  if not analytics.job_weight_ok(p_weight_final_g) then
    raise exception 'น้ำหนักสุทธิต้องมากกว่า 0 และไม่เกิน 100,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)' using errcode = '22023', hint = 'weight_invalid';
  end if;
  -- 0176: บังคับตาม snapshot ของใบ (flag ของแบบ) · ทองที่มีขั้นชั่งอย่างน้อย 1 ขั้น (weigh_required · ใบเดิมทุกใบ) = กติกา J1 เดิม (security M1) — แบบไม่ชั่งเท่านั้นที่ไม่บังคับ
  if p_weight_final_g is null and (v_job.require_final_weight or (v_job.metal = 'gold' and v_job.weigh_required)) then
    raise exception '%', case when v_job.metal = 'gold' then 'งานทองต้องระบุน้ำหนักสุทธิตอนปิดงาน' else 'ใบงานนี้ต้องระบุน้ำหนักสุทธิตอนปิดงาน' end
      using errcode = '22023', hint = 'weight_required';
  end if;
  v_note := coalesce(analytics.job_text_clean(p_note, 'หมายเหตุ', 500, false), v_job.note);

  v_surplus := p_qty_good - v_job.qty_order;
  if p_surplus_disposition is not null and p_surplus_disposition not in ('hold', 'spare', 'deliver', 'stock') then
    raise exception 'การจัดการของเหลือต้องเป็น hold / spare / deliver' using errcode = '22023', hint = 'surplus_invalid';
  end if;
  if v_surplus > 0 then
    if v_job.source_kind = 'production' then
      if p_surplus_disposition is not null and p_surplus_disposition <> 'stock' then
        raise exception 'ใบงานของใบผลิต: ของเหลือเข้าสต็อกเสมอ เลือกอย่างอื่นไม่ได้' using errcode = '22023', hint = 'surplus_production_stock_only';
      end if;
      v_disp := 'stock';
    else
      if p_surplus_disposition = 'stock' then
        raise exception 'งาน OEM: ของเหลือเป็นของลูกค้า เข้าสต็อกอัตโนมัติไม่ได้ — เลือก hold / spare / deliver' using errcode = '22023', hint = 'surplus_oem_no_stock';
      end if;
      v_disp := coalesce(p_surplus_disposition, 'hold');
    end if;
    v_snote := analytics.job_text_clean(p_surplus_note, 'หมายเหตุของเหลือ', 200, false);
  elsif p_surplus_disposition is not null or nullif(btrim(coalesce(p_surplus_note, '')), '') is not null then
    raise exception 'ไม่มีของเหลือ (จำนวนดีไม่เกินจำนวนที่สั่ง) แต่ส่งการจัดการของเหลือมา' using errcode = '22023', hint = 'surplus_unexpected';
  end if;

  with r as (
    update analytics.job_token set revoked_at = clock_timestamp(), revoke_reason = 'job_done'
     where job_id = p_job_id and revoked_at is null returning 1)
  select count(*) into v_tokens from r;

  update analytics.job
     set status = 'done', done_at = now(), qty_good = p_qty_good, qty_scrap = p_qty_scrap,
         weight_final_g = p_weight_final_g, note = v_note,
         surplus_disposition = v_disp, surplus_note = v_snote
   where id = p_job_id;

  perform analytics.job_event_write(p_job_id, null, 'done', v_today, v_actor, null, 'job_page', null,
    jsonb_build_object('qty_good', p_qty_good, 'qty_scrap', p_qty_scrap, 'weight_final_g', p_weight_final_g, 'tokens_revoked', v_tokens,
                       'qty_order', v_job.qty_order, 'surplus', greatest(v_surplus, 0), 'surplus_disposition', v_disp));
  return jsonb_build_object('ok', true, 'job_no', v_job.job_no, 'status', 'done', 'qty_good', p_qty_good, 'qty_scrap', p_qty_scrap,
                            'surplus', greatest(v_surplus, 0), 'surplus_disposition', v_disp);
end;
$f$;
-- ============================================================================
-- 6. v_job_board — คอลัมน์ใหม่ต่อท้ายเท่านั้น (ข้อ 3 · ลอกจากฉบับล่าสุด 0175:1384 ไม่ใช่ 0172 · ชื่อ/ชนิด/ลำดับคอลัมน์เดิมไม่เปลี่ยน — ไม่ชน 42P16)
-- ============================================================================
create or replace view analytics.v_job_board
  with (security_invoker = true) as
select
  j.id, j.shop_id, j.job_no, j.seq, j.source_kind,
  case j.source_kind when 'oem' then aq.quote_no else po.po_no end as source_ref,
  j.design_label, j.sku_snapshot, j.metal, j.qty_planned, j.status, j.due_date,
  j.current_stage_code, d.name_th as current_stage_name, cs.status as current_stage_status,
  coalesce(w.display_name, cs.assignee_name) as holder_name,
  (analytics.job_today() - coalesce(cs.received_on, ps.last_sent_on, analytics.job_bkk_date(j.created_at)))::int as days_in_stage,
  (j.due_date is not null and j.status in ('open', 'in_progress', 'on_hold') and j.due_date < analytics.job_today()) as is_overdue,
  ev.last_event_at,
  ev.last_scan_at,
  (j.status in ('open', 'in_progress') and analytics.job_bkk_date(coalesce(ev.last_event_at, j.created_at)) < analytics.job_today() - 3) as is_stale,
  st.stage_count, st.stage_done_count, st.has_auto_closed,
  (j.source_kind = 'oem' and coalesce(pay.paid, 0) <= 0) as deposit_missing,
  (j.start_gate_note is not null) as start_gate_note_present,
  (j.source_kind = 'oem' and j.status not in ('done', 'cancelled') and aqi.qty is distinct from j.qty_order) as quote_qty_mismatch,
  aqi.qty as quote_item_qty,
  j.created_at, j.done_at, j.cancelled_at,
  case when j.status in ('done', 'cancelled') then j.status when j.current_stage_code is null then 'awaiting_close' else j.current_stage_code end as board_column,
  hg.handoff_gap_g,
  hmc.handoff_mismatch_count,
  j.qty_order,
  case when j.status = 'done' then j.qty_good - j.qty_order end as qty_surplus,
  (j.status not in ('done', 'cancelled') and j.qty_planned < j.qty_order) as under_planned,
  (j.status = 'done' and j.qty_good > j.qty_order and j.surplus_disposition = 'hold') as surplus_pending,
  j.surplus_disposition,
  j.target_piece_g,
  j.metal_plan_g,
  -- 0176 (ต่อท้าย): ชื่อแบบ (null = ใบเดิม) · มีขั้นที่ต้องชั่งไหม · ใบทองที่มีขั้น "โลหะอยู่ในมือ" ที่ไม่ชั่ง (ไม่มีด่านกันทองหาย — ไม่นับขั้นที่ข้าม/ใบปิดแล้ว)
  j.profile_name,
  coalesce(pw.has_weigh, false) as has_weigh,
  (j.metal = 'gold' and j.status not in ('done', 'cancelled') and coalesce(pw.unguarded, false)) as gold_unguarded
from analytics.job j
left join analytics.job_stage cs on cs.job_id = j.id and cs.stage_code = j.current_stage_code
left join analytics.job_stage_def d on d.shop_id = j.shop_id and d.code = j.current_stage_code
left join analytics.worker w on w.id = cs.worker_id
left join lateral (select max(s.sent_on) as last_sent_on from analytics.job_stage s where s.job_id = j.id) ps on true
left join lateral (
  select max(e.recorded_at) as last_event_at, max(e.recorded_at) filter (where e.channel = 'worker_qr') as last_scan_at
    from analytics.job_event e where e.job_id = j.id) ev on true
left join lateral (
  select count(*)::int as stage_count,
         (count(*) filter (where s.status in ('sent', 'skipped')))::int as stage_done_count,
         coalesce(bool_or(s.auto_closed), false) as has_auto_closed
    from analytics.job_stage s where s.job_id = j.id) st on true
left join lateral (
  select q.id, q.quote_no from analytics.oem_quote q
   where j.source_kind = 'oem' and coalesce(q.root_quote_id, q.id) = j.root_quote_id
   order by (q.status = 'superseded'), q.created_at desc limit 1) aq on true
left join lateral (select coalesce(v.paid_thb, 0) as paid from analytics.v_oem_quote v where v.id = aq.id) pay on true
left join lateral (select i.qty from analytics.oem_quote_item i where i.quote_id = aq.id and i.seq = j.oem_item_seq) aqi on true
left join analytics.production_order_item poi on poi.id = j.production_order_item_id
left join analytics.production_order po on po.id = poi.production_order_id
left join lateral (select max(abs(l.handoff_gap_g)) as handoff_gap_g from analytics.v_job_stage_loss l where l.job_id = j.id) hg on true
left join lateral (select count(*)::int as handoff_mismatch_count from analytics.job_event e
                    where e.job_id = j.id and e.event_type = 'weigh' and e.payload ->> 'kind' = 'handoff_mismatch') hmc on true
left join lateral (select bool_or(s.weigh_required) as has_weigh,
                          bool_or(d2.metal_present and not s.weigh_required and s.status <> 'skipped') as unguarded
                     from analytics.job_stage s
                     join analytics.job_stage_def d2 on d2.shop_id = s.shop_id and d2.code = s.stage_code
                    where s.job_id = j.id) pw on true;

-- ============================================================================
-- 7. สิทธิ์ — service_role เท่านั้น (ปิดทุกอย่างก่อน เปิดเฉพาะ RPC ที่ตั้งใจ · helper/trigger/ภายใน = ไม่ grant ใคร) + overload guard + นับ RPC
-- ============================================================================
revoke all on analytics.job_record_profile, analytics.job_record_profile_stage from public, anon, authenticated, service_role;
grant select on analytics.job_record_profile, analytics.job_record_profile_stage to service_role;
revoke all on analytics.v_job_board from public, anon, authenticated, service_role;
grant select on analytics.v_job_board to service_role;

do $g$
declare
  r record;
  v_rpc constant text[] := array[
    'job_stage_suggest', 'job_create_from_quote_item', 'job_create_from_production_item', 'job_token_issue', 'job_token_revoke',
    'job_office_receive', 'job_office_send', 'job_stage_skip', 'job_stage_reopen', 'job_set_due', 'job_start_gate_note_set',
    'job_done', 'job_cancel', 'worker_upsert', 'worker_pin_set', 'worker_set_active', 'worker_unlock', 'job_design_label_set',
    'worker_pin_verify', 'job_worker_logout', 'job_worker_resolve', 'job_worker_receive', 'job_worker_send',
    'job_today', 'job_bkk_date', 'job_stage_state',
    -- 0175
    'job_plan_suggest', 'job_qty_planned_set', 'job_plan_set', 'job_surplus_set',
    -- 0176
    'job_record_profile_list', 'job_record_profile_upsert', 'job_record_profile_set_default', 'job_profile_set'];
  v_n int;
  v_dup text;
  v_leak text;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p
     where p.pronamespace = 'analytics'::regnamespace and (p.proname like 'job\_%' or p.proname like 'worker\_%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname = any (v_rpc) then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
  select string_agg(proname, ', ') into v_dup from (
    select proname from pg_proc where pronamespace = 'analytics'::regnamespace and (proname like 'job\_%' or proname like 'worker\_%')
    group by proname having count(*) > 1) d;
  if v_dup is not null then
    raise exception '0176: พบ overload ของฟังก์ชัน: %', v_dup;
  end if;
  select count(*) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and proname = any (v_rpc);
  if v_n <> cardinality(v_rpc) then
    raise exception '0176: RPC ที่ประกาศไว้ % ตัว แต่พบใน pg_proc % ตัว', cardinality(v_rpc), v_n;
  end if;
  -- ไม่มีฟังก์ชัน job_*/worker_* ตัวไหนที่ anon/authenticated รันได้ (ทั้งทาง PUBLIC และ grant ตรง) และมีเฉพาะ RPC ที่ service_role รันได้
  select string_agg(p.oid::regprocedure::text, ', ') into v_leak
    from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and (p.proname like 'job\_%' or p.proname like 'worker\_%')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
          or (has_function_privilege('service_role', p.oid, 'execute') <> (p.proname = any (v_rpc))));
  if v_leak is not null then
    raise exception '0176: สิทธิ์ execute ผิดรูป: %', v_leak;
  end if;
  -- ตารางใหม่: anon/authenticated ต้องไม่มีสิทธิ์อะไรเลย · service_role อ่านอย่างเดียว
  if has_table_privilege('anon', 'analytics.job_record_profile', 'select') or has_table_privilege('authenticated', 'analytics.job_record_profile', 'select')
     or has_table_privilege('anon', 'analytics.job_record_profile_stage', 'select') or has_table_privilege('authenticated', 'analytics.job_record_profile_stage', 'select')
     or has_table_privilege('service_role', 'analytics.job_record_profile', 'insert,update,delete')
     or has_table_privilege('service_role', 'analytics.job_record_profile_stage', 'insert,update,delete') then
    raise exception '0176: สิทธิ์ตารางแบบการบันทึกผิดรูป';
  end if;
end;
$g$;

-- ============================================================================
-- 8. ยืนยันว่าไม่มีอะไรขยับนอกรายการที่ตั้งใจ (md5 ฟังก์ชันทุกตัวในสคีมา · updated_at/flag ของใบเดิมไม่ขยับ · ทุกร้านมีค่าเริ่ม · ไม่งั้น raise → rollback ทั้งไฟล์)
-- ============================================================================
do $c$
declare
  v_changed text;
  v_unexpected text;
  v_row record;
  c_replaced constant text[] := array['job_stage_suggest', 'job_create_insert', 'job_create_from_quote_item', 'job_create_from_production_item',
    'job_core_receive', 'job_stage_guard', 'job_guard', 'job_worker_resolve', 'job_done'];
  c_new constant text[] := array['job_profile_default_for', 'job_record_profile_ensure', 'job_profile_state', 'job_profile_apply', 'job_profile_json',
    'job_record_profile_list', 'job_record_profile_upsert', 'job_record_profile_set_default', 'job_profile_set',
    'job_record_profile_guard', 'job_record_profile_stage_guard', 'job_record_profile_default_required',
    'job_plan_formula', 'job_plan_basis_assert'];
begin
  select string_agg(b.sig, ', ') into v_changed
    from _j176_fn_base b
    left join pg_proc p on p.oid = to_regprocedure(b.sig)
   where not (b.proname = any (c_replaced))
     and (p.oid is null or md5(pg_get_functiondef(p.oid)) <> b.h);
  if v_changed is not null then
    raise exception '0176 แตะฟังก์ชันที่ไม่ได้ตั้งใจแตะ (md5 ไม่เท่า/หาย): %', v_changed;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_unexpected
    from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
     and p.oid::regprocedure::text not in (select sig from _j176_fn_base)
     and not (p.proname = any (c_replaced)) and not (p.proname = any (c_new));
  if v_unexpected is not null then
    raise exception '0176 มีฟังก์ชันใหม่ที่ไม่ได้ประกาศ: %', v_unexpected;
  end if;
  -- ใบเดิม: จำนวนแถว + updated_at + flag ต่อขั้น ต้องเท่าเดิมเป๊ะ (migration นี้ไม่มี UPDATE ใบเดิม — ข้อ 19)
  for v_row in
    select b.t, b.n, b.nd, b.h,
           case b.t when 'job' then (select count(*) from analytics.job) else (select count(*) from analytics.job_stage) end as n2,
           case b.t when 'job' then (select count(distinct updated_at) from analytics.job) else (select count(distinct updated_at) from analytics.job_stage) end as nd2,
           case b.t when 'job' then (select coalesce(md5(string_agg(updated_at::text, '|' order by id)), '') from analytics.job)
                    else (select coalesce(md5(string_agg(updated_at::text, '|' order by id)), '') from analytics.job_stage) end as h2
      from _j176_row_base b
  loop
    if v_row.n <> v_row.n2 or v_row.nd <> v_row.nd2 or v_row.h <> v_row.h2 then
      raise exception '0176: updated_at ของ % ขยับ (n % -> %, distinct % -> %)', v_row.t, v_row.n, v_row.n2, v_row.nd, v_row.nd2;
    end if;
  end loop;
  if (select coalesce(md5(string_agg(id::text || ':' || weigh_required::text || ':' || status, '|' order by id)), '')
        from analytics.job_stage) is distinct from (select h from _j176_flag_base)
     or exists (select 1 from analytics.job_stage s where not s.scrap_qty_ask or s.scrap_weight_ask) then
    raise exception '0176: flag ต่อขั้นของใบเดิมขยับ';
  end if;
  if exists (select 1 from analytics.job where profile_id is not null or profile_name is not null or require_final_weight)
     and (select count(*) from analytics.job where profile_id is not null) <> (select count(*) from analytics.job where profile_name is not null) then
    raise exception '0176: profile_id/profile_name ไม่คู่กัน';
  end if;
  -- ทุกร้านที่มีแบบ ต้องมีค่าเริ่มทั่วไปพอดี 1 และค่าเริ่มทองไม่เกิน 1
  if exists (select 1 from public.shop s where not exists (select 1 from analytics.job_record_profile p where p.shop_id = s.id and p.is_default)) then
    raise exception '0176: มีร้านที่ไม่มีแบบค่าเริ่ม (ensure ไม่ทำงาน)';
  end if;
  if exists (select 1 from analytics.job_record_profile p where p.is_default group by p.shop_id having count(*) > 1)
     or exists (select 1 from analytics.job_record_profile p where p.is_default_gold group by p.shop_id having count(*) > 1) then
    raise exception '0176: ค่าเริ่มซ้ำในร้านเดียวกัน';
  end if;
  if exists (select 1 from pg_trigger t where t.tgrelid in ('analytics.job'::regclass, 'analytics.job_stage'::regclass, 'analytics.job_event'::regclass)
                and not t.tgisinternal and t.tgenabled <> 'O') then
    raise exception '0176: มี trigger บนตารางใบงานที่ไม่ได้อยู่ในสถานะเปิด (O)';
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'analytics.job'::regclass and conname = 'job_gold_weigh_ck') then
    raise exception '0176: job_gold_weigh_ck ยังไม่ถูกถอด';
  end if;
  raise notice '0176: ฟังก์ชันเดิมนอกรายการแทนที่ md5 เท่าเดิมทั้งหมด · updated_at/flag ใบเดิมไม่ขยับ · ทุกร้านมีค่าเริ่ม';
end;
$c$;

notify pgrst, 'reload schema';
