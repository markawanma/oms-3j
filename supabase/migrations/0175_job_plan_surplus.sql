-- 0175_job_plan_surplus.sql — M1 ส่วนแรก: จำนวนสั่ง/จำนวนเริ่มผลิต (เผื่อเสีย) + แผนโลหะ + ของเหลือ + ปิดหนี้ J1 D2/D6
-- ต่อจาก 0172-0174 (apply แล้ว แก้ไฟล์เดิมไม่ได้) · spec: docs/3j-jewelry/oms/design-job-plan-metal-gems.md §8.0-8.13 (ส่วนของ 0175) · ledger เบิกโลหะ = 0176 (ไม่อยู่ในไฟล์นี้)
-- ⚠️ ยังไม่ APPLY — dry-run เท่านั้น (apply หลัง security ผ่าน)
--
-- ทำไม: ใบงาน J1 มี qty_planned ช่องเดียว — แต่ "จำนวนที่ลูกค้าสั่ง" (qty_order) กับ "จำนวนที่เริ่มผลิต" (qty_planned, เผื่อเสียจากหล่อ/ขัด/ชุบ) ต่างกันโดยตั้งใจ
--   ผลิตเกิน = ของเหลือต้องมีที่ไป (hold ถือไว้ก่อน ตามมติ Q1) · ผลิตขาด = ป้ายเหลือง (Q9) · โลหะที่ต้องเตรียม DB คำนวณให้ (ไม่คูณใน client)
--
-- 1 คอลัมน์ใหม่บน job: qty_order (backfill = qty_planned) · target_piece_g · metal_plan_g · metal_plan_basis · surplus_disposition · surplus_note
-- 2 job_event.event_type + plan_change / surplus_set
-- 3 helper D6: job_deposit_blocked · job_worker_can_do (job_core_receive ใช้) · drop job_counter_bump (ไม่มีคนเรียกแล้ว)
-- 4 D2: job_office_receive เรียก job_label_clean กับชื่อผู้รับงาน
-- 5 job_plan_compute (ภายใน) · job_source_info (+target_piece_g) · job_plan_suggest · job_create_insert/_from_quote_item/_from_production_item (arg ใหม่ ต่อท้าย)
-- 6 job_qty_planned_set · job_plan_set · job_done (+surplus) · job_surplus_set · job_guard (replace) · v_job_board (ต่อท้าย)
--
-- ไม่มีราคา/ต้นทุนในทุก object ของไฟล์นี้ (ยืนยัน §8.6) — sprue/reject rate เป็นอัตราส่วน % จาก oem_rate_value ไม่ใช่เงิน

-- baseline ก่อนแตะ: ฟังก์ชันทุกตัวในสคีมา (md5) + ตัวชี้วัด updated_at ของ job — ตรวจท้ายไฟล์ว่าไม่มีอะไรขยับนอกรายการที่ตั้งใจแทนที่
create temp table _j175_fn_base on commit drop as
select p.oid::regprocedure::text as sig, p.proname, md5(pg_get_functiondef(p.oid)) as h
from pg_proc p
where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f';

create temp table _j175_job_base on commit drop as
select count(*) as n,
       count(distinct updated_at) as n_distinct_updated,
       coalesce(md5(string_agg(updated_at::text, '|' order by id)), '') as h
from analytics.job;

-- ============================================================================
-- 1. คอลัมน์ใหม่ + backfill (ข้อ 19: UPDATE ยิง trigger · job_guard raise บนแถว done/cancelled และตั้ง updated_at เอง ⇒ ปิดเฉพาะ trg_job_guard ในทรานแซกชันนี้)
-- ============================================================================
do $a$
declare
  v_trg text;
  v_en  "char";
  v_n_before bigint;
  v_n_after  bigint;
  v_base record;
  v_now  record;
begin
  -- trigger ที่มีจริงบน job ต้องเป็นสองตัวที่รู้จักเท่านั้น — มีตัวอื่น = หยุด (อาจยิงตอน backfill แล้วทำ updated_at/ข้อมูลเพี้ยน)
  select string_agg(t.tgname, ', ' order by t.tgname) into v_trg
    from pg_trigger t
   where t.tgrelid = 'analytics.job'::regclass and not t.tgisinternal
     and t.tgname not in ('trg_job_guard', 'trg_job_deny_truncate');
  if v_trg is not null then
    raise exception '0175: พบ trigger ที่ไม่รู้จักบน analytics.job: % — ตรวจก่อน backfill', v_trg;
  end if;

  select * into v_base from _j175_job_base;

  alter table analytics.job add column if not exists qty_order int;
  alter table analytics.job add column if not exists target_piece_g numeric(10, 3);
  alter table analytics.job add column if not exists metal_plan_g numeric(10, 3);
  alter table analytics.job add column if not exists metal_plan_basis jsonb;
  alter table analytics.job add column if not exists surplus_disposition text;
  alter table analytics.job add column if not exists surplus_note text;

  alter table analytics.job disable trigger trg_job_guard;
  -- แคบ where: เฉพาะแถวที่ยังไม่มีค่า (รันซ้ำไม่แตะแถวที่ตั้งแล้ว)
  update analytics.job set qty_order = qty_planned where qty_order is null;
  alter table analytics.job enable trigger trg_job_guard;

  select t.tgenabled into v_en from pg_trigger t where t.tgrelid = 'analytics.job'::regclass and t.tgname = 'trg_job_guard';
  if v_en is distinct from 'O' then
    raise exception '0175: trg_job_guard ไม่ได้เปิดกลับ (tgenabled=%) — rollback', v_en;
  end if;

  select count(*) into v_n_after from analytics.job where qty_order is null;
  if v_n_after <> 0 then
    raise exception '0175: backfill qty_order ไม่ครบ (% แถวยัง null)', v_n_after;
  end if;

  select count(*) as n, count(distinct updated_at) as n_distinct_updated,
         coalesce(md5(string_agg(updated_at::text, '|' order by id)), '') as h
    into v_now from analytics.job;
  if v_now.n <> v_base.n or v_now.n_distinct_updated <> v_base.n_distinct_updated or v_now.h <> v_base.h then
    raise exception '0175: backfill ทำ updated_at ของ job ขยับ (n % -> %, distinct % -> %)', v_base.n, v_now.n, v_base.n_distinct_updated, v_now.n_distinct_updated;
  end if;
end;
$a$;

alter table analytics.job alter column qty_order set not null;

alter table analytics.job drop constraint if exists job_qty_order_ck;
alter table analytics.job add constraint job_qty_order_ck check (qty_order between 1 and 100000);
alter table analytics.job drop constraint if exists job_target_piece_ck;
alter table analytics.job add constraint job_target_piece_ck check (target_piece_g is null or (target_piece_g > 0 and target_piece_g <= 10000));
alter table analytics.job drop constraint if exists job_metal_plan_g_ck;
alter table analytics.job add constraint job_metal_plan_g_ck check (metal_plan_g is null or (metal_plan_g > 0 and metal_plan_g <= 100000));
alter table analytics.job drop constraint if exists job_metal_plan_basis_ck;
alter table analytics.job add constraint job_metal_plan_basis_ck check (metal_plan_basis is null or jsonb_typeof(metal_plan_basis) = 'object');
alter table analytics.job drop constraint if exists job_surplus_disp_ck;
alter table analytics.job add constraint job_surplus_disp_ck check (surplus_disposition is null or surplus_disposition in ('hold', 'spare', 'deliver', 'stock'));
alter table analytics.job drop constraint if exists job_surplus_note_ck;
alter table analytics.job add constraint job_surplus_note_ck
  check (surplus_note is null or (length(surplus_note) <= 200 and analytics.oem_note_valid(surplus_note)));
-- แผนทั้งสามคอลัมน์ null/ไม่ null พร้อมกัน (basis ใช้อธิบายตัวเลข — ไม่มี basis = ตัวเลขลอย)
alter table analytics.job drop constraint if exists job_plan_ck;
alter table analytics.job add constraint job_plan_ck
  check ((target_piece_g is null) = (metal_plan_g is null) and (metal_plan_g is null) = (metal_plan_basis is null));
-- ของเหลือ: ตั้งได้เฉพาะใบ done ที่ qty_good > qty_order · และใบ done ที่มีของเหลือต้องมี disposition เสมอ (job_done ใส่ใน UPDATE เดียวกับ status='done')
alter table analytics.job drop constraint if exists job_surplus_ck;
alter table analytics.job add constraint job_surplus_ck
  check ((surplus_disposition is null or (status = 'done' and qty_good > qty_order))
         and (status <> 'done' or qty_good <= qty_order or surplus_disposition is not null));
alter table analytics.job drop constraint if exists job_surplus_note_only_ck;
alter table analytics.job add constraint job_surplus_note_only_ck check (surplus_note is null or surplus_disposition is not null);

-- job_event.event_type: เพิ่ม plan_change / surplus_set (0172 ไม่ได้ตั้งชื่อ constraint — หาชื่อจริงจาก pg_constraint ไม่เดา)
do $e$
declare
  v_name text;
begin
  for v_name in
    select c.conname from pg_constraint c
     where c.conrelid = 'analytics.job_event'::regclass and c.contype = 'c'
       and c.conname <> 'je_who_ck'  -- je_who_ck อ้าง event_type ด้วย แต่เป็นคนละด่าน ห้ามลบ
       and pg_get_constraintdef(c.oid) like 'CHECK ((event_type = ANY%'
  loop
    execute format('alter table analytics.job_event drop constraint %I', v_name);
  end loop;
  alter table analytics.job_event add constraint job_event_event_type_ck check (event_type in (
    'create', 'stage_receive', 'stage_send', 'stage_skip', 'stage_reopen', 'weigh', 'scrap', 'batch_join',
    'batch_leave', 'due_set', 'hold', 'resume', 'photo_add', 'note', 'done', 'cancel', 'token_issue', 'token_revoke',
    'plan_change', 'surplus_set'));
end;
$e$;
