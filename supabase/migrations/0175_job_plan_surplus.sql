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
-- แผน: มี target ⇔ มี basis (basis อธิบายตัวเลข/รายการ rate ที่ขาด) · metal_plan_g ไม่ null ได้เฉพาะเมื่อมี target
-- เบี่ยงจาก design §8.1 ที่เขียน (target null) = (plan null): ขัดกับเคส "rate ก้านต้นว่าง ⇒ สร้างได้ มี target แต่ metal_plan_g null + missing[]" ของ §8.3/§8.7 เอง
alter table analytics.job drop constraint if exists job_plan_ck;
alter table analytics.job add constraint job_plan_ck
  check ((target_piece_g is null) = (metal_plan_basis is null) and (metal_plan_g is null or target_piece_g is not null));
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

-- ============================================================================
-- 2. helper D6 (ภายใน — ไม่ grant ให้ role ไหน) + drop job_counter_bump
--    ทำไม: ด่านมัดจำ/scope ช่างเขียนซ้ำหลายที่ — แก้กติกาทีเดียวต้องไล่แก้หลายฟังก์ชัน (J1 หนี้ D6)
--    รอบนี้ใช้ใน job_core_receive · job_worker_resolve (ใช้ใน 0176) · v_job_board.deposit_missing คงเป็นนิพจน์แยก (ความหมายต่าง: ใบที่รับแล้วก็ยังนับว่า "ไม่มีเงินเข้า")
-- ============================================================================

-- ด่านมัดจำ: ใบ OEM ที่ยังไม่มีขั้นไหนถูกรับ + ไม่มีเหตุผลเริ่มก่อนมัดจำ + ดีลยังไม่มีเงินเข้าเลย = true (ห้ามรับขั้นแรก)
-- ข้อ 13: ดีลที่ไม่มีแถว/paid null นับเป็น 0 (ไม่ใช่ "ผ่าน") — เหมือน job_core_receive เดิมทุกประการ
create or replace function analytics.job_deposit_blocked(p_job analytics.job)
 returns boolean
 language sql
 stable
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
  select p_job.source_kind = 'oem'
     and p_job.start_gate_note is null
     and not exists (select 1 from analytics.job_stage s where s.job_id = p_job.id and s.status in ('received', 'sent'))
     and coalesce((select v.paid_thb
                     from analytics.oem_quote_item i
                     join analytics.v_oem_quote v on v.id = i.quote_id
                    where i.id = p_job.oem_quote_item_id), 0) <= 0
$f$;

-- scope ช่าง: ไม่ได้ตั้งขอบเขต (null/ว่าง) = ทำได้ทุกขั้น · ตั้งแล้ว = ต้องอยู่ในรายการ
create or replace function analytics.job_worker_can_do(p_codes text[], p_stage_code text)
 returns boolean
 language sql
 immutable
 set search_path to 'pg_catalog', 'pg_temp'
as $f$
  select coalesce(cardinality(p_codes), 0) = 0 or p_stage_code = any (p_codes)
$f$;

-- job_counter_bump: 0174 เปลี่ยน worker_pin_verify ไปใช้ job_budget_take แล้ว — ไม่มีคนเรียก · drop ต้องไม่มี prosrc ไหนอ้างถึง (ไม่งั้น raise → rollback)
do $d$
declare v_refs text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_refs
    from pg_proc p
   where p.prosrc like '%job_counter_bump%' and p.proname <> 'job_counter_bump';
  if v_refs is not null then
    raise exception '0175: ยังมีฟังก์ชันอ้าง job_counter_bump: %', v_refs;
  end if;
end;
$d$;
drop function if exists analytics.job_counter_bump(text, timestamptz);

-- ============================================================================
-- 3. job_core_receive — ใช้ helper แทนบล็อก scope + มัดจำ (ตรรกะอื่นเท่าเดิมทุกบรรทัด · def ต้นทาง 0174:245) · verify เทียบกับ legacy
-- ============================================================================
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
      if v_job.metal = 'gold' then
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

-- ============================================================================
-- 4. D2 — job_office_receive (def ต้นทาง 0172:1629 · เปลี่ยนเฉพาะบรรทัด assignee)
-- ============================================================================
create or replace function analytics.job_office_receive(
  p_shop_id       uuid,
  p_job_id        uuid,
  p_expected_seq  int,
  p_occurred_on   date,
  p_weight_in_g   numeric default null,
  p_worker_id     uuid default null,
  p_assignee_name text default null,
  p_channel       text default 'job_page',
  p_actor         uuid default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor    uuid := coalesce(p_actor, auth.uid());
  v_job      analytics.job%rowtype;
  v_assignee text;
  v_r        jsonb;
begin
  v_job := analytics.job_office_begin('job_office_receive', p_shop_id, p_job_id, v_actor);
  if p_channel is null or p_channel not in ('job_page', 'daily_sheet') then
    raise exception 'ช่องทางต้องเป็น job_page หรือ daily_sheet' using errcode = '22023', hint = 'channel_invalid';
  end if;
  -- D2: ชื่อผู้รับงานที่ออฟฟิศพิมพ์ ต้องผ่านด่านเดียวกับชื่อช่าง (ห้าม < >) · ว่าง/null = ไม่ระบุ (job_label_clean บังคับต้องมีค่า จึงกันก่อน)
  v_assignee := case when nullif(btrim(coalesce(p_assignee_name, '')), '') is null then null
                     else analytics.job_label_clean(p_assignee_name, 'ชื่อผู้รับงาน', 60) end;
  if p_worker_id is not null and not exists (
       select 1 from analytics.worker w where w.id = p_worker_id and w.shop_id = p_shop_id and w.is_active) then
    raise exception 'ไม่พบช่างที่ใช้งานอยู่ในร้านนี้' using errcode = '22023', hint = 'worker_not_found';
  end if;
  v_r := analytics.job_core_receive(p_job_id, p_expected_seq, p_occurred_on, p_weight_in_g, p_worker_id, v_assignee,
                                    p_channel, v_actor, null, false);
  if not (v_r ->> 'ok')::boolean then
    raise exception '%', v_r ->> 'message' using errcode = '22023', hint = v_r ->> 'code';
  end if;
  return v_r;
end;
$f$;

-- ============================================================================
-- 5. แผนโลหะ + ค่าแนะนำจำนวนเผื่อ + สร้างใบงานรับจำนวนสั่ง/เริ่มผลิต
-- ============================================================================

-- คำนวณแผนโลหะ (ภายใน · DB คำนวณ client ไม่คูณเอง) → {metal_plan_g, basis}
--   ปกติ: qty_planned × target_piece_g × (1 + sprue_loss_pct/100) · ไม่มี target ⇒ {null,null} · ไม่มี rate ก้านต้นและไม่ override ⇒ metal_plan_g = null + basis.missing (ไม่ใช่ 0 — ข้อ 13)
--   override: เจ้าของกำหนดเอง ต้องมีเหตุผล (oem_note_present) · เก็บ computed_g ไว้เทียบ
create or replace function analytics.job_plan_compute(
  p_shop_id         uuid,
  p_metal           text,
  p_qty_planned     int,
  p_target_piece_g  numeric,
  p_override_g      numeric,
  p_override_reason text
)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_today    date := analytics.job_today();
  v_sprue    numeric;
  v_missing  jsonb := '[]'::jsonb;
  v_computed numeric := null;
  v_reason   text := null;
  v_plan     numeric;
begin
  if p_target_piece_g is null then
    if p_override_g is not null or p_override_reason is not null then
      raise exception 'ตั้งแผนโลหะเองได้เมื่อมีน้ำหนักเป้าหมายต่อชิ้นเท่านั้น' using errcode = '22023', hint = 'plan_target_required';
    end if;
    return jsonb_build_object('metal_plan_g', null, 'basis', null);
  end if;
  if p_qty_planned is null or not (p_qty_planned between 1 and 100000) then
    raise exception 'จำนวนเริ่มผลิตต้องอยู่ระหว่าง 1 ถึง 100,000' using errcode = '22023', hint = 'qty_planned_invalid';
  end if;
  if not (p_target_piece_g > 0 and p_target_piece_g <= 10000 and p_target_piece_g = round(p_target_piece_g, 3)) then
    raise exception 'น้ำหนักเป้าหมายต่อชิ้นต้องมากกว่า 0 ไม่เกิน 10,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)' using errcode = '22023', hint = 'target_invalid';
  end if;
  if p_override_g is null and p_override_reason is not null then
    raise exception 'ส่งเหตุผลมาโดยไม่มีน้ำหนักโลหะที่กำหนดเอง' using errcode = '22023', hint = 'plan_override_missing';
  end if;
  if p_override_g is not null and not (p_override_g > 0 and p_override_g <= 100000 and p_override_g = round(p_override_g, 3)) then
    raise exception 'โลหะที่กำหนดเองต้องมากกว่า 0 ไม่เกิน 100,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)' using errcode = '22023', hint = 'plan_override_invalid';
  end if;

  v_sprue := analytics.oem_rate_value(p_shop_id, 'sprue_loss_pct', p_metal, v_today);
  if v_sprue is not null and not (v_sprue >= 0 and v_sprue <= 500) then
    v_sprue := null;  -- ค่าที่ไม่สมเหตุผล (ติดลบ/NaN/มหาศาล) = ถือว่าไม่มี rate ไม่ใช้คำนวณ
  end if;
  if v_sprue is null then
    v_missing := jsonb_build_array(format('sprue_loss_pct[%s]', p_metal));
  else
    v_computed := round(p_qty_planned * p_target_piece_g * (1 + v_sprue / 100), 3);
    if not (v_computed > 0 and v_computed <= 100000) then
      if p_override_g is null then
        raise exception 'โลหะที่ต้องเตรียมเกิน 100,000 กรัม — ตรวจจำนวน/น้ำหนักต่อชิ้น' using errcode = '22023', hint = 'plan_too_large';
      end if;
      v_computed := null;
    end if;
  end if;

  if p_override_g is not null then
    if nullif(btrim(coalesce(p_override_reason, '')), '') is null then
      raise exception 'ต้องระบุเหตุผลที่กำหนดน้ำหนักโลหะเอง' using errcode = '22023', hint = 'plan_reason_required';
    end if;
    begin
      v_reason := analytics.job_text_clean(p_override_reason, 'เหตุผลที่กำหนดน้ำหนักโลหะเอง', 200, true);
    exception when sqlstate '22023' then
      raise exception '%', sqlerrm using errcode = '22023', hint = 'plan_reason_required';
    end;
    v_plan := p_override_g;
    v_missing := '[]'::jsonb;  -- กำหนดเองแล้ว ไม่ต้องใช้ rate
  else
    v_plan := v_computed;
  end if;

  return jsonb_build_object('metal_plan_g', v_plan, 'basis', jsonb_build_object(
    'target_piece_g', p_target_piece_g, 'qty_planned', p_qty_planned, 'sprue_loss_pct', v_sprue, 'sprue_rate_as_of', v_today,
    'formula', 'qty_planned*target_piece_g*(1+sprue_loss_pct/100)', 'computed_g', v_computed,
    'override_g', p_override_g, 'override_reason', v_reason, 'missing', v_missing));
end;
$f$;

-- job_source_info: เพิ่ม target_piece_g (+ที่มา) · def ต้นทาง 0172:1281
--   OEM = weight_g ในรายการใบเสนอราคา (น้ำหนัก/ชิ้นที่ใช้คิดราคา) · production = silver_weight_g ของสินค้า "เฉพาะงานเงิน" (คอลัมน์นี้คือน้ำหนักเงิน — ห้ามเอาไปเป็นน้ำหนักทอง/ทองเหลือง)
--   ไม่เข้าเงื่อนไขช่วง (> 0 และ <= 10000) = null (ไม่เดา)
create or replace function analytics.job_source_info(p_shop_id uuid, p_source_kind text, p_item_id uuid)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_metal     text;
  v_new       boolean;
  v_gem       int;
  v_plating   text;
  v_i         record;
  v_p         record;
  v_paid      numeric;
  v_existing  record;
  v_label     text;
  v_codes     text[];
  v_pmetal    text;
  v_tw        numeric;
  v_tw_src    text;
begin
  if p_source_kind = 'oem' then
    select i.id, i.shop_id, i.seq, i.qty, i.input, i.product_id, i.sku_snapshot, i.product_name_snapshot,
           q.id as quote_id, q.status as quote_status, coalesce(q.root_quote_id, q.id) as root_id
      into v_i
      from analytics.oem_quote_item i
      join analytics.oem_quote q on q.id = i.quote_id
     where i.id = p_item_id and i.shop_id = p_shop_id;
    if not found then
      raise exception 'ไม่พบรายการในใบเสนอราคา' using errcode = '22023', hint = 'item_not_found';
    end if;
    if v_i.quote_status <> 'won' then
      raise exception 'สร้างใบงานได้เฉพาะใบเสนอราคาที่ได้งานแล้ว (won) — ใบนี้สถานะ %', v_i.quote_status
        using errcode = '22023', hint = 'quote_not_won';
    end if;
    v_metal := v_i.input ->> 'metal';
    if v_metal = 'product' then
      raise exception 'รายการสินค้า/บริการไม่ใช่งานผลิต สร้างใบงานไม่ได้' using errcode = '22023', hint = 'metal_unsupported';
    elsif v_metal = 'silver999' then
      raise exception 'เงินแท่งไม่มีขั้นตอนผลิตในโรงงาน สร้างใบงานไม่ได้' using errcode = '22023', hint = 'metal_unsupported';
    elsif v_metal is null or v_metal not in ('silver', 'gold', 'brass') then
      raise exception 'รายการนี้ไม่ระบุโลหะที่ใบงานรองรับ (เงิน/ทอง/ทองเหลือง)' using errcode = '22023', hint = 'metal_unsupported';
    end if;
    v_new := coalesce((v_i.input ->> 'is_new_design') = 'true', false);
    v_gem := case when (v_i.input ->> 'gem_count') ~ '^[0-9]+$' then (v_i.input ->> 'gem_count')::int else 0 end;
    v_plating := nullif(btrim(coalesce(v_i.input ->> 'plating_type', '')), '');
    select coalesce(v.paid_thb, 0) into v_paid from analytics.v_oem_quote v where v.id = v_i.quote_id;
    select j.id, j.job_no into v_existing from analytics.job j
     where j.status <> 'cancelled' and (j.oem_quote_item_id = v_i.id or (j.root_quote_id = v_i.root_id and j.oem_item_seq = v_i.seq)) limit 1;
    v_label := coalesce(nullif(btrim(v_i.product_name_snapshot), ''), nullif(btrim(v_i.sku_snapshot), ''),
                        coalesce(nullif(v_i.input ->> 'item_kind', ''), 'งาน OEM') || ' #' || v_i.seq);
    v_tw := case when (v_i.input ->> 'weight_g') ~ '^[0-9]{1,6}(\.[0-9]+)?$' then round((v_i.input ->> 'weight_g')::numeric, 3) end;
    if v_tw is not null and not (v_tw > 0 and v_tw <= 10000) then v_tw := null; end if;
    v_tw_src := case when v_tw is null then null else 'quote' end;
    v_codes := array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'polish', 'qc', 'pack'];
    if v_new then v_codes := array['cad', 'print3d', 'mold'] || v_codes; end if;
    if v_gem > 0 then v_codes := v_codes || 'gem_set'::text; end if;
    if v_plating is not null and v_plating not in ('none', 'null') then v_codes := v_codes || 'plating'::text; end if;
    return jsonb_build_object('source_kind', 'oem', 'item_id', v_i.id, 'quote_id', v_i.quote_id, 'root_quote_id', v_i.root_id,
      'item_seq', v_i.seq, 'metal', v_metal, 'qty', v_i.qty, 'is_new_design', v_new, 'design_label', left(v_label, 200),
      'sku', left(v_i.sku_snapshot, 100), 'product_id', v_i.product_id, 'deposit_missing', coalesce(v_paid, 0) <= 0,
      'existing_job', case when v_existing.id is null then null else jsonb_build_object('id', v_existing.id, 'job_no', v_existing.job_no) end,
      'suggested_stage_codes', to_jsonb(analytics.job_sort_stage_codes(p_shop_id, v_codes)),
      'target_piece_g', v_tw, 'target_piece_g_source', v_tw_src);
  elsif p_source_kind = 'production' then
    select poi.id, poi.shop_id, poi.qty_planned, poi.is_new_design, poi.product_id,
           po.status as po_status, p.sku, p.name, p.cost_type, p.make_spec, p.silver_weight_g
      into v_p
      from analytics.production_order_item poi
      join analytics.production_order po on po.id = poi.production_order_id
      join public.product p on p.id = poi.product_id
     where poi.id = p_item_id and poi.shop_id = p_shop_id;
    if not found then
      raise exception 'ไม่พบรายการในใบผลิต' using errcode = '22023', hint = 'item_not_found';
    end if;
    if v_p.po_status <> 'open' then
      raise exception 'สร้างใบงานได้เฉพาะใบผลิตที่ยังเปิดอยู่ (open) — ใบนี้สถานะ %', v_p.po_status using errcode = '22023', hint = 'po_not_open';
    end if;
    v_pmetal := v_p.make_spec ->> 'metal';
    v_metal := case
      when v_pmetal in ('silver', 'gold', 'brass') then v_pmetal
      when v_pmetal is null and v_p.cost_type in ('fixed', 'spot') then 'silver'
      else null end;
    if v_metal is null then
      raise exception 'ระบุโลหะของสินค้านี้ไม่ได้ (ใบงานรองรับเงิน/ทอง/ทองเหลือง) — ตรวจสเปกการผลิตของสินค้าก่อน' using errcode = '22023', hint = 'metal_unsupported';
    end if;
    select j.id, j.job_no into v_existing from analytics.job j where j.status <> 'cancelled' and j.production_order_item_id = v_p.id limit 1;
    v_tw := case when v_metal = 'silver' and v_p.silver_weight_g > 0 and v_p.silver_weight_g <= 10000 then round(v_p.silver_weight_g, 3) end;
    v_tw_src := case when v_tw is null then null else 'product' end;
    v_codes := array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'polish', 'qc', 'pack'];
    if coalesce(v_p.is_new_design, false) then v_codes := array['cad', 'print3d', 'mold'] || v_codes; end if;
    return jsonb_build_object('source_kind', 'production', 'item_id', v_p.id, 'metal', v_metal, 'qty', v_p.qty_planned,
      'is_new_design', coalesce(v_p.is_new_design, false), 'design_label', left(coalesce(nullif(btrim(v_p.name), ''), v_p.sku), 200),
      'sku', left(v_p.sku, 100), 'product_id', v_p.product_id, 'deposit_missing', false,
      'existing_job', case when v_existing.id is null then null else jsonb_build_object('id', v_existing.id, 'job_no', v_existing.job_no) end,
      'suggested_stage_codes', to_jsonb(analytics.job_sort_stage_codes(p_shop_id, v_codes)),
      'target_piece_g', v_tw, 'target_piece_g_source', v_tw_src);
  end if;
  raise exception 'source_kind ต้องเป็น oem หรือ production' using errcode = '22023', hint = 'source_invalid';
end;
$f$;

-- ฟอร์มสร้างใบงานถาม DB (ไม่คิดเอง): จำนวนเผื่อที่แนะนำ + โลหะที่ต้องเตรียม · ใช้ reject rate ชุดเดียวกับ oem_cost_calc (ผลข้างเคียง: แก้ rate = ต้นทุนใบเสนอราคาใหม่ขยับตาม — ใบที่ออกแล้วไม่ขยับ)
-- rate ตัวที่ต้องใช้ว่าง/ไม่สมเหตุผล ⇒ qty_planned_suggest = null + missing[] (ไม่ใช่ 0 — ข้อ 13)
create or replace function analytics.job_plan_suggest(
  p_shop_id        uuid,
  p_source_kind    text,
  p_item_id        uuid,
  p_qty_planned    int default null,
  p_target_piece_g numeric default null
)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_today   date := analytics.job_today();
  v_info    jsonb;
  v_qty_ord int;
  v_has_pl  boolean;
  v_rc      numeric;
  v_rp      numeric;
  v_rpl     numeric;
  v_missing jsonb := '[]'::jsonb;
  v_suggest int := null;
  v_den     numeric;
  v_sug_n   numeric;
  v_eff     int;
  v_target  numeric;
  v_tsrc    text;
  v_metal   text;
  v_plan    jsonb;
begin
  if p_shop_id is null or p_item_id is null then
    raise exception 'job_plan_suggest: p_shop_id และ p_item_id จำเป็น' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  if p_qty_planned is not null and not (p_qty_planned between 1 and 100000) then
    raise exception 'จำนวนเริ่มผลิตต้องอยู่ระหว่าง 1 ถึง 100,000' using errcode = '22023', hint = 'qty_planned_invalid';
  end if;
  if p_target_piece_g is not null
     and not (p_target_piece_g > 0 and p_target_piece_g <= 10000 and p_target_piece_g = round(p_target_piece_g, 3)) then
    raise exception 'น้ำหนักเป้าหมายต่อชิ้นต้องมากกว่า 0 ไม่เกิน 10,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)' using errcode = '22023', hint = 'target_invalid';
  end if;

  v_info := analytics.job_source_info(p_shop_id, p_source_kind, p_item_id);
  v_qty_ord := (v_info ->> 'qty')::int;
  v_metal := v_info ->> 'metal';
  v_has_pl := (v_info -> 'suggested_stage_codes') ? 'plating';

  v_rc := analytics.oem_rate_value(p_shop_id, 'reject_rate_cast_pct', '-', v_today);
  v_rp := analytics.oem_rate_value(p_shop_id, 'reject_rate_polish_pct', '-', v_today);
  v_rpl := case when v_has_pl then analytics.oem_rate_value(p_shop_id, 'reject_rate_plate_pct', '-', v_today) else 0 end;
  -- ค่าที่ไม่สมเหตุผล (null/ติดลบ/NaN/>= 100) = ถือว่าไม่มี rate — กันตัวหารศูนย์/ติดลบ (migration-traps ข้อ 4-5)
  if v_rc is null or not (v_rc >= 0 and v_rc < 100) then
    v_rc := null; v_missing := v_missing || to_jsonb('reject_rate_cast_pct[-]'::text);
  end if;
  if v_rp is null or not (v_rp >= 0 and v_rp < 100) then
    v_rp := null; v_missing := v_missing || to_jsonb('reject_rate_polish_pct[-]'::text);
  end if;
  if v_has_pl and (v_rpl is null or not (v_rpl >= 0 and v_rpl < 100)) then
    v_rpl := null; v_missing := v_missing || to_jsonb('reject_rate_plate_pct[-]'::text);
  end if;

  if v_rc is not null and v_rp is not null and (v_rpl is not null or not v_has_pl) then
    v_den := (1 - v_rc / 100) * (1 - v_rp / 100) * (1 - coalesce(v_rpl, 0) / 100);
    v_sug_n := ceil(v_qty_ord / v_den);
    if v_sug_n between 1 and 100000 then
      v_suggest := v_sug_n::int;
    else
      v_missing := v_missing || to_jsonb('qty_planned_suggest_over_limit'::text);
    end if;
  end if;

  v_eff := coalesce(p_qty_planned, v_suggest, v_qty_ord);
  v_target := coalesce(p_target_piece_g, nullif(v_info ->> 'target_piece_g', '')::numeric);
  v_tsrc := case when p_target_piece_g is not null then 'input' else v_info ->> 'target_piece_g_source' end;
  v_plan := analytics.job_plan_compute(p_shop_id, v_metal, v_eff, v_target, null, null);
  if jsonb_typeof(v_plan -> 'basis') = 'object' then
    v_missing := v_missing || (v_plan -> 'basis' -> 'missing');
  end if;

  return jsonb_build_object(
    'qty_order', v_qty_ord, 'qty_planned_suggest', v_suggest, 'qty_planned_eff', v_eff, 'under_planned', v_eff < v_qty_ord,
    'reject_basis', jsonb_build_object('cast_pct', v_rc, 'polish_pct', v_rp, 'plate_pct', case when v_has_pl then v_rpl else null end, 'has_plating', v_has_pl),
    'target_piece_g', v_target, 'target_piece_g_source', v_tsrc, 'metal', v_metal,
    'metal_plan_g', v_plan -> 'metal_plan_g', 'metal_plan_basis', v_plan -> 'basis', 'missing', v_missing);
end;
$f$;

-- ============================================================================
-- 6. สร้างใบงาน — signature เปลี่ยน ⇒ drop เดิมเต็มๆ ก่อน (migration-traps ข้อ 1 · ไม่งั้น PostgREST เจอ 2 ตัว PGRST203)
--    named args: caller เดิมที่ไม่ส่ง arg ใหม่ = ค่าเริ่ม (qty_planned = qty_order · plan จาก source)
-- ============================================================================
drop function if exists analytics.job_create_insert(uuid, text, uuid, uuid, int, uuid, uuid, text, text, text, int, date, text, text, text[], boolean, uuid);
drop function if exists analytics.job_create_from_quote_item(uuid, uuid, text[], date, text, text, text, uuid);
drop function if exists analytics.job_create_from_production_item(uuid, uuid, text[], date, text, text, uuid);

create or replace function analytics.job_create_insert(
  p_shop_id uuid, p_source_kind text, p_oem_item_id uuid, p_root_quote_id uuid, p_oem_item_seq int,
  p_poi_id uuid, p_product_id uuid, p_design_label text, p_sku text, p_metal text, p_qty int,
  p_due date, p_gate_note text, p_note text, p_codes text[], p_is_new_design boolean, p_actor uuid,
  p_qty_order int, p_target_piece_g numeric, p_plan jsonb
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
begin
  -- p_qty = qty_planned (จำนวนเริ่มผลิต) · p_qty_order = จำนวนที่สั่ง · p_plan = ผลของ job_plan_compute
  if p_qty_order is null or not (p_qty_order between 1 and 100000) or p_qty is null or not (p_qty between 1 and 100000) then
    raise exception 'จำนวนสั่ง/จำนวนเริ่มผลิตต้องอยู่ระหว่าง 1 ถึง 100,000' using errcode = '22023', hint = 'qty_planned_invalid';
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
                             start_gate_note, created_by, note, target_piece_g, metal_plan_g, metal_plan_basis)
  values (p_shop_id, v_seq, p_source_kind, p_oem_item_id, p_root_quote_id, p_oem_item_seq, p_poi_id,
          p_product_id, p_design_label, p_sku, p_metal, p_qty_order, p_qty, p_metal in ('gold', 'silver'), p_due,
          p_gate_note, p_actor, p_note, p_target_piece_g, (p_plan ->> 'metal_plan_g')::numeric, v_basis)
  returning * into v_job;

  -- weigh_required ต่อขั้น: ทอง = ขั้นที่โลหะอยู่ในมือ (cast..pack) · เงิน = หล่อ/ตัดต้น/ขัด · ทองเหลือง = ไม่บังคับ (มติ Q1)
  insert into analytics.job_stage (job_id, shop_id, stage_code, seq, weigh_required)
  select v_job.id, p_shop_id, a.code, a.ord::int,
         case p_metal when 'gold' then d.metal_present when 'silver' then d.weigh_default else false end
    from unnest(p_codes) with ordinality as a(code, ord)
    join analytics.job_stage_def d on d.shop_id = p_shop_id and d.code = a.code
   order by a.ord;

  perform analytics.job_event_write(v_job.id, null, 'create', v_today, p_actor, null, 'job_page', null,
    jsonb_build_object('source_kind', p_source_kind, 'stage_codes', to_jsonb(p_codes), 'qty_planned', p_qty, 'metal', p_metal,
                       'qty_order', p_qty_order, 'target_piece_g', p_target_piece_g, 'metal_plan_g', v_job.metal_plan_g,
                       'due_date', p_due, 'start_gate_note_present', p_gate_note is not null));

  return jsonb_build_object('job_id', v_job.id, 'job_no', v_job.job_no, 'status', v_job.status, 'metal', v_job.metal,
                            'qty_planned', v_job.qty_planned, 'stage_codes', to_jsonb(p_codes), 'warnings', to_jsonb(v_warn),
                            'start_gate_note_set', p_gate_note is not null,
                            'qty_order', v_job.qty_order, 'under_planned', v_job.qty_planned < v_job.qty_order,
                            'metal_plan_g', v_job.metal_plan_g, 'plan_missing', coalesce(v_basis -> 'missing', '[]'::jsonb));
end;
$f$;

-- job_create_from_quote_item (def ต้นทาง 0174:631 · ต่อท้าย 4 arg · ตรรกะเดิมคงไว้ทุกบรรทัด)
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
  p_metal_plan_reason     text default null
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
  v_plan := analytics.job_plan_compute(p_shop_id, v_info ->> 'metal', v_qty_planned, v_target, p_metal_plan_override_g, p_metal_plan_reason);

  return analytics.job_create_insert(p_shop_id, 'oem', p_quote_item_id, (v_info ->> 'root_quote_id')::uuid, (v_info ->> 'item_seq')::int,
    null, nullif(v_info ->> 'product_id', '')::uuid, v_label, nullif(v_info ->> 'sku', ''), v_info ->> 'metal', v_qty_planned,
    p_due_date, v_gate, v_note, p_stage_codes, (v_info ->> 'is_new_design')::boolean, v_actor,
    v_qty_order, v_target, v_plan);
end;
$f$;

-- job_create_from_production_item (def ต้นทาง 0174:690 · ต่อท้าย 4 arg)
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
  p_metal_plan_reason        text default null
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
  v_plan := analytics.job_plan_compute(p_shop_id, v_info ->> 'metal', v_qty_planned, v_target, p_metal_plan_override_g, p_metal_plan_reason);

  return analytics.job_create_insert(p_shop_id, 'production', null, null, null, p_production_order_item_id,
    nullif(v_info ->> 'product_id', '')::uuid, v_label, nullif(v_info ->> 'sku', ''), v_info ->> 'metal', v_qty_planned,
    p_due_date, null, v_note, p_stage_codes, (v_info ->> 'is_new_design')::boolean, v_actor,
    v_qty_order, v_target, v_plan);
end;
$f$;
