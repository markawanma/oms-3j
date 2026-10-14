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
