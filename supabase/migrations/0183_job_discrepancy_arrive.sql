-- 0183_job_discrepancy_arrive.sql — ส่วนต่างรอชี้แจง: ทางที่ 3 "ได้รับเพิ่มแล้ว" (มติเจ้าของ 20 ต.ค. 69) · ต่อจาก 0181 (L1) + 0182 (รูปใบงาน) — apply บน DB แล้วทั้งคู่ · แก้ไฟล์เดิมไม่ได้
-- สถานะ: ยังไม่ apply · apply ด้วย node scripts/run-sql.mjs --commit --record เท่านั้น (พึ่งทรานแซกชันที่ runner ครอบทั้งไฟล์: temp table on commit drop) · ห้าม supabase db push · ไฟล์ต้องเป็น LF · def ของทุกฟังก์ชัน/view ที่ replace ลอกจาก DB สด 20 ต.ค. 69 (md5 อยู่ใน pre-check)
--
-- ทำไม: ใบ JB-0018 ชุบส่ง 50 → QC รับ 48 → ส่วนหลักไปแพ็กแล้ว ส่วนต่าง 2 ชิ้นค้าง — ของเดิมมีแค่ เสียหาย/หาย (ชี้แจง) หรือ void (ต้องย้อนขั้นผู้รับ ใช้ไม่ได้เมื่อขั้นรับส่งต่อไปแล้ว)
-- ของนับผิด/ส่งตามมาทีหลัง = ได้รับเพิ่มแล้ว: ชิ้นที่มาถึง → "ส่วนใหม่" (ส่วนย่อยของใบแม่) ที่ขั้นที่รับขาด สถานะ received ผู้ถือ = ช่างที่กด/ที่ออฟฟิศเลือก แล้วเดินต่อตามปกติ (ส่ง/แยก/ปิดส่วน)
--
-- โมเดล (ตัดสินแล้ว — เหตุผล):
--  · ส่วนต่าง append-only (qty แก้ไม่ได้) ⇒ arrive = void แถวเดิม + แถวใหม่ "resolved/arrived" (qty ที่มาถึง) + แถวใหม่ "open" (ที่เหลือ ถ้ามี) — ผลรวม qty เท่าเดิมเสมอ · ผลรวม/ประวัติชัด · ไม่แตะตรรกะ resolve/void เดิม
--  · ส่วนที่ resolved/arrived ยังนับเป็น "ส่วนต่างที่บันทึกแล้ว" ฝั่งใบเดิม (job_disc_active_qty · โซ่ discrepancy_chain · job_identity_gap ใบที่ยังไม่ปิด) เพราะขั้นผู้รับของใบเดิมไม่เปลี่ยน (qty_in เท่าเดิม) —
--    แต่ "ไม่ซ้ำ" ที่ระดับต้นไม้: v_job_tree.qty_discrepancy_resolved ไม่นับ arrived (ชิ้นนั้นไปนับเป็น qty_live ของส่วนใหม่) · drift tree_sum หัก Σ arrived · ใบเดิมที่ปิด (done): ดี + เสีย + แยกออก + arrived = จำนวนเริ่มผลิต (job_arrived_qty — job_done/job_identity_gap)
--  · ส่วนใหม่ผูกกับส่วนต่างด้วย job_stage.arrive_discrepancy_id (ขั้นที่รับขาด) แทน split_from_stage_id: ขั้นผู้รับของใบเดิมรับไปแล้ว/อาจส่งต่อแล้ว — ใช้ qty_split_out ของขั้นนั้นไม่ได้ (จะหัก live ผิด) · drift lot_split_stage นับทั้งสองชนิด · drift ใหม่ arrive_link (Σ จำนวนส่วนใหม่ = qty ของแถว arrived)
--  · ส่วนที่มาจาก arrive: ยกเลิกแบบ "คืนชิ้น" ไม่ได้ (job_lot_return_blocker ตอบ not_lot — ไม่มีขั้นแม่ที่ถืออยู่ให้คืน) · ยกเลิกเป็นของเสีย (scrap) ได้ตามเดิม · ย้อนขั้นที่รับขาดของส่วนนั้นไม่ได้ (has_split)
--  · void แถว arrived ไม่ได้ (guard) — ชิ้นอยู่ที่ส่วนใหม่แล้ว
-- กติกา arrive
--  · ผู้มีสิทธิ์ (ช่าง) = ช่างที่เป็นผู้รับขั้นที่รับขาด (job_stage.worker_id ของ to_stage) · ออฟฟิศกรอกแทนได้ (เลือกผู้ถือได้ ไม่เลือก = ผู้รับเดิม)
--  · 1 ≤ qty ≤ ส่วนต่างที่ยัง open · ไม่ครบ ⇒ ที่เหลือยัง open (แถวใหม่) · p_expected_open (ถ้าส่ง) ต้องเท่ายอด open ปัจจุบัน — กดซ้ำ/2 มือถือ ⇒ stage_changed (ไม่สร้างส่วนซ้ำ) · แถวที่ชี้แจง/void/arrive แล้ว ⇒ already_resolved
--  · ทอง + ขั้นที่รับขาดตั้งชั่ง (weigh_required): ต้องชั่งชิ้นที่มาถึง · น้ำหนักที่มาถึง ≤ (ส่งออกของขั้นก่อน − รับเข้าเดิม ที่ยังไม่ถูก arrive) + 0.05 g · ชั่งเกิน 3 ครั้งบนส่วนต่างเดียว (ช่าง) = office_required (กันไล่เดาน้ำหนัก — แบบ L-2) ·
--    ไม่แสดงน้ำหนัก/ส่วนต่างให้ช่าง (N1) · gap ที่เหลือเก็บในแถว open ที่เหลือ + payload event (ออฟฟิศเห็น) · เงิน/ทอง ขั้นไม่ชั่ง: นับจำนวนอย่างเดียว ส่งน้ำหนักมา = weight_unexpected
--  · ใบ (แม่/ที่ส่วนต่างอยู่) done/cancelled = job_closed · ใบถูกพัก = job_on_hold · วันรับ: ช่าง = วันนี้ · ออฟฟิศย้อนได้ ≤ 14 วัน ไม่ก่อนวันที่ขั้นต้นทางส่ง
--  · event ใหม่ discrepancy_arrive (ใบเดิม) + create/stage_skip/stage_receive ของส่วนใหม่ (รูปแบบเดียวกับแยกส่วน — v_job_stage_from_events ตรงเสมอ)
-- สิ่งที่ migration นี้ทำ
--  1 คอลัมน์ job_stage.arrive_discrepancy_id (+FK +unique) · jd_kind_ck + 'arrived' · job_done_ck นับ arrived (ดี + เสีย + แยกออก + arrived = เริ่มผลิต) · job_event CHECK + 'discrepancy_arrive' (รายการ 28 ชนิดเดิมจาก DB สดหลัง 0182 — ครบ photo_*)
--  2 helper job_arrived_qty · replace: job_identity_gap · job_done · job_stage_guard · job_discrepancy_guard · job_lot_cancel_core (event ฝั่งแม่ของส่วนที่ไม่มีขั้นแยก) · job_worker_resolve (+action arrive ใน my_actions) · views: v_job_tree (+qty_discrepancy_arrived ต่อท้าย · resolved ไม่นับ arrived) · v_job_tree_drift
--  3 ใหม่: job_discrepancy_arrive_core (ภายใน) · job_discrepancy_arrive (ออฟฟิศ) · job_worker_discrepancy_arrive (ช่าง)
--  4 สิทธิ์ service_role เท่านั้น (ข้อ 18) · post-check: ฟังก์ชันอื่น md5 ไม่ขยับ · แถวเดิมไม่ขยับ · ไม่มี overload/grant รั่ว · ใบที่ไม่มีส่วนต่างทำงานเหมือนเดิม
--
-- ตัดสินเอง (นอกคำสั่ง — เหตุผล)
--  (1) arrive ผ่านเส้น void + แถวใหม่เสมอ (แม้ครบทั้งก้อน) ไม่ UPDATE แถวเดิมเป็น arrived — น้ำหนักของแถวที่ resolved ค้างใน tree_weight_gap_excess_g ถ้าใช้แถวเดิม · แถว arrived ไม่เก็บน้ำหนัก (null)
--  (2) guard ของส่วนต่างอนุญาตสร้างแถวตอนขั้นผู้รับ received/sent เฉพาะเมื่อ app.job_arrive = on (ตั้งใน core ภายในทรานแซกชัน — service_role ไม่มี INSERT บนตาราง) · void ของแถว arrived ปฏิเสธเสมอ · UPDATE เป็น arrived ปฏิเสธเสมอ
--  (3) ล็อก 3 ครั้งของน้ำหนักทอง (office_required) — ไม่อยู่ในคำสั่ง · เพิ่มเพราะด่านน้ำหนัก ≤ missing + 0.05 g ถูกไล่เดาได้ถ้าไม่จำกัดครั้ง (N1)
--  (4) p_expected_open (CAS) เป็นพารามิเตอร์ท้ายที่ไม่บังคับ — กดซ้ำ/2 มือถือไม่สร้างส่วนซ้ำเมื่อ arrive บางส่วน
--  (5) job_done บนใบเดิม: ดี + เสีย + แยกออก + arrived = จำนวนเริ่มผลิต (เดิม: ดี + เสีย + แยกออก) — ใบที่ไม่มี arrived ผลเท่าเดิมเป๊ะ
--  (6) ส่วนใหม่ที่ขั้นรับขาด weigh_required = ตามขั้นของใบเดิม · weigh_required ของใบส่วนใหม่ = มีขั้นหลังขั้นนั้นที่ต้องชั่ง หรือ ทอง+ขั้นชั่ง (เหมือนแยกส่วน)
--  (7) job_lot_cancel_core: แก้เฉพาะ event split_cancel ฝั่งแม่ — ส่วนที่เกิดจาก arrive ไม่มีขั้นแยก (v_ms ว่าง) เดิมล้มด้วย job_event_write ไม่พบใบงาน (ถอยทั้งก้อน ไม่มีข้อมูลเสีย) · ตอนนี้ยกเลิกเป็นของเสียได้ (ชิ้นที่ได้รับเพิ่มแต่ใช้ไม่ได้) event ฝั่งแม่เขียนที่ใบแม่ไม่ผูกขั้น · ส่วนที่แยกตามปกติ payload/ผลเท่าเดิมเป๊ะ (golden: verify-0181 รันซ้ำ)
--  หนี้ที่รู้: (a) ส่วนที่มาจาก arrive คืนชิ้นไม่ได้ (ดูโมเดล) (b) รายงานน้ำหนักต้นไม้ (v_job_board.tree_*) ไม่รู้จัก arrive โดยเฉพาะ — น้ำหนักชิ้นที่มาถึงอยู่ที่ weight_in_g ของส่วนใหม่ (c) UI ปิดงานของใบเดิมต้องหัก qty_discrepancy_arrived ออกจากช่องเสีย (ต่อท้าย v_job_tree)

-- baseline ก่อนแตะ: ฟังก์ชันทุกตัวในสคีมา (md5) + ตัวชี้วัดแถวของตารางที่เกี่ยวข้อง (ไฟล์นี้ไม่ UPDATE/INSERT แถวเดิม)
create temp table _j183_fn_base on commit drop as
select p.oid::regprocedure::text as sig, p.proname, md5(pg_get_functiondef(p.oid)) as h
from pg_proc p
where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f';

create temp table _j183_view_base on commit drop as
select c.table_name, count(*)::int as n from information_schema.columns c
 where c.table_schema = 'analytics' and c.table_name in ('v_job_tree', 'v_job_tree_summary', 'v_job_tree_drift', 'v_job_board', 'v_job_discrepancy') group by c.table_name;
create temp table _j183_drift_base on commit drop as select count(*)::int as n from analytics.v_job_tree_drift;

create temp table _j183_row_base on commit drop as
select 'job'::text as t, count(*) as n, coalesce(md5(string_agg(j::text, '|' order by j.id)), '') as h from analytics.job j
union all select 'job_stage', count(*), coalesce(md5(string_agg((to_jsonb(s) - 'arrive_discrepancy_id')::text, '|' order by s.id)), '') from analytics.job_stage s
union all select 'job_event', count(*), coalesce(md5(string_agg(e::text, '|' order by e.id)), '') from analytics.job_event e
union all select 'job_discrepancy', count(*), coalesce(md5(string_agg(d::text, '|' order by d.id)), '') from analytics.job_discrepancy d
union all select 'job_token', count(*), coalesce(md5(string_agg(k.id::text || coalesce(k.revoked_at::text, ''), '|' order by k.id)), '') from analytics.job_token k
union all select 'job_counter', count(*), coalesce(md5(string_agg(c::text, '|' order by c::text)), '') from analytics.job_counter c
union all select 'job_photo', count(*), coalesce(md5(string_agg(ph::text, '|' order by ph.id)), '') from analytics.job_photo ph;

-- ============================================================================
-- 0. pre-check
-- ============================================================================
do $p$
declare
  r record;
  v_n int;
  v_def text;
begin
  perform 1 from pg_temp._j183_fn_base limit 1;  -- รันแบบ autocommit ตารางหาย ⇒ ล้มก่อน DDL ใดๆ
  if to_regclass('analytics.job_discrepancy') is null or to_regclass('analytics.job_photo') is null then
    raise exception '0183: ยังไม่พบ 0181 (job_discrepancy) หรือ 0182 (job_photo) — apply ก่อน';
  end if;
  -- md5: ฟังก์ชันที่ replace ต้องเป็นฉบับที่ลอกมา (DB สด 20 ต.ค. 69) หรือฉบับ 0183 (รันซ้ำ — มีเครื่องหมาย 0183 ในตัวฟังก์ชัน)
  for r in
    select * from (values
      ('job_stage_guard',      '8938808d51b69218d7274bf674481f9c'),
      ('job_discrepancy_guard','ee2fbb304e5399f3129907e62363fcc0'),
      ('job_identity_gap',     'b0b62907777f323a464d0adf39ab5467'),
      ('job_done',             'edbd55b7bb74431148788e3dc7710751'),
      ('job_worker_resolve',   '168bb2bed65f5a0d3cb5415806a60594'),
      ('job_lot_cancel_core',  '70a178bcb1f40ce7e0f59533a3c9fe44')
    ) as v(n, h_old)
  loop
    select count(*) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and proname = r.n;
    if v_n <> 1 then
      raise exception '0183: % มี % signature (ต้องมี 1) — หยุดตรวจ overload ก่อน', r.n, v_n;
    end if;
    select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = r.n;
    if md5(v_def) <> r.h_old and position('0183' in v_def) = 0 then
      raise exception '0183: def ของ % บน DB ไม่ใช่ฉบับที่ลอกมา (md5 % ≠ %) และไม่ใช่ฉบับ 0183 — มีคนแก้นอก migration · หยุด ห้าม replace ทับ', r.n, md5(v_def), r.h_old;
    end if;
  end loop;
  for r in
    select * from (values
      ('v_job_tree',       '6ae8554b102c0db03a1ace5dec296175', 'qty_discrepancy_arrived'),
      ('v_job_tree_drift', '40249424e24069b96b591d590389b189', 'arrive_link')
    ) as v(n, h_old, marker)
  loop
    select pg_get_viewdef(c.oid) into v_def from pg_class c where c.relnamespace = 'analytics'::regnamespace and c.relname = r.n and c.relkind = 'v';
    if v_def is null then
      raise exception '0183: ไม่พบ view % — apply 0181 ก่อน', r.n;
    end if;
    if md5(v_def) <> r.h_old and position(r.marker in v_def) = 0 then
      raise exception '0183: def ของ view % บน DB ไม่ใช่ฉบับที่ลอกมา (md5 % ≠ %) — มีคนแก้นอก migration · หยุด', r.n, md5(v_def), r.h_old;
    end if;
  end loop;
  -- job_done_ck: ต้องเป็นฉบับ 0181 (md5 ด้านล่าง) หรือฉบับ 0183 — ไม่งั้นมีคนแก้นอก migration
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c where c.conrelid = 'analytics.job'::regclass and c.conname = 'job_done_ck';
  if v_def is null then
    raise exception '0183: ไม่พบ job_done_ck — apply 0181 ก่อน';
  end if;
  if md5(v_def) <> 'fb6fafd280035c9141aba3c711525aeb' and position('job_arrived_qty' in v_def) = 0 then
    raise exception '0183: def ของ job_done_ck บน DB ไม่ใช่ฉบับที่ลอกมา (md5 % ≠ fb6fafd2…) — มีคนแก้นอก migration · หยุด', md5(v_def);
  end if;
  -- รายการชนิด event ของ DB ต้องมี photo_reorder (ฉบับ 0182) — ไม่งั้นลอกรายการผิดฉบับแล้วชนิดของรูปจะหลุด
  if not exists (select 1 from pg_constraint c where c.conrelid = 'analytics.job_event'::regclass and c.conname = 'job_event_event_type_ck'
                   and pg_get_constraintdef(c.oid) like '%photo_reorder%') then
    raise exception '0183: job_event_event_type_ck ไม่ใช่ฉบับ 0182 (ไม่พบ photo_reorder) — ลอกรายการผิดฉบับ · หยุด';
  end if;
  raise notice '0183: ใบงานเดิม % ใบ · ส่วนต่าง % แถว (ไม่มี UPDATE/INSERT แถวเดิมในไฟล์นี้)', (select count(*) from analytics.job), (select count(*) from analytics.job_discrepancy);
end;
$p$;

-- ============================================================================
-- 1. โครงสร้าง (add column default null ไม่ยิง trigger · ไม่ UPDATE แถวเดิม — ข้อ 19)
-- ============================================================================
alter table analytics.job_stage add column if not exists arrive_discrepancy_id uuid;
do $ddl$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'analytics.job_stage'::regclass and conname = 'js_arrive_fk') then
    alter table analytics.job_stage add constraint js_arrive_fk foreign key (arrive_discrepancy_id) references analytics.job_discrepancy (id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'analytics.job_stage'::regclass and conname = 'js_arrive_split_ck') then
    -- ขั้นเดียวกันเป็นทั้งขั้นแยกและขั้น arrive ไม่ได้
    alter table analytics.job_stage add constraint js_arrive_split_ck check (arrive_discrepancy_id is null or split_from_stage_id is null);
  end if;
end;
$ddl$;
create unique index if not exists uq_job_stage_arrive on analytics.job_stage (arrive_discrepancy_id) where arrive_discrepancy_id is not null;

alter table analytics.job_discrepancy drop constraint if exists jd_kind_ck;
alter table analytics.job_discrepancy add constraint jd_kind_ck check (resolved_kind is null or resolved_kind in ('scrap', 'lost', 'arrived'));

alter table analytics.job_event drop constraint if exists job_event_event_type_ck;
alter table analytics.job_event add constraint job_event_event_type_ck check (event_type = any (array[
  'create', 'stage_receive', 'stage_send', 'stage_skip', 'stage_reopen', 'weigh', 'scrap', 'batch_join', 'batch_leave', 'due_set', 'hold', 'resume',
  'photo_add', 'note', 'done', 'cancel', 'token_issue', 'token_revoke', 'plan_change', 'surplus_set', 'profile_set',
  'split', 'split_cancel', 'discrepancy', 'discrepancy_resolve', 'photo_remove', 'photo_primary', 'photo_reorder', 'discrepancy_arrive']));

-- ============================================================================
-- 2. helper: ชิ้นที่ "ได้รับเพิ่มแล้ว" ของใบ (ส่วนต่างของใบนี้ที่ resolved เป็น arrived · ไม่ถูก void) — ใช้ใน identity ของใบที่ปิดแล้ว + job_done
-- ============================================================================
create or replace function analytics.job_arrived_qty(p_job_id uuid)
 returns integer
 language sql
 stable
 set search_path to 'pg_catalog', 'analytics', 'pg_temp'
as $f$
  -- 0183
  select coalesce(sum(d.qty), 0)::integer
    from analytics.job_discrepancy d
   where d.job_id = p_job_id and d.status = 'resolved' and d.resolved_kind = 'arrived'
     and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = d.id)
$f$;

-- job_done_ck: ดี + เสีย + แยกออก + ได้รับเพิ่มไปเป็นส่วนใหม่ (arrived) = เริ่มผลิต — ใบที่ไม่มี arrived: job_arrived_qty = 0 ⇒ นิยามเดิมเป๊ะ (ที่เหลือของ CHECK ลอกจาก DB สด)
-- ตรวจแถวเดิมทั้งหมดตอนเพิ่ม (ตารางเล็ก · ใบ done ทุกใบต้องผ่าน — ไม่ผ่านจะถอยทั้งไฟล์ ไม่ใช่แก้ข้อมูล)
alter table analytics.job drop constraint if exists job_done_ck;
alter table analytics.job add constraint job_done_ck check (
  status <> 'done'
  or (done_at is not null and qty_good is not null and qty_scrap is not null
      and (qty_good + qty_scrap + qty_split_out + analytics.job_arrived_qty(id)) = qty_planned
      and (metal <> 'gold' or not weigh_required or weight_final_g is not null)
      and (not require_final_weight or weight_final_g is not null)));

-- ============================================================================
-- 3. replace ฟังก์ชัน (def ลอกจาก DB สด 20 ต.ค. 69 + แก้เฉพาะจุดที่มีเครื่องหมาย 0183)
-- ============================================================================
-- job_identity_gap: ใบ done นับ arrived ด้วย
CREATE OR REPLACE FUNCTION analytics.job_identity_gap(p_job_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'analytics', 'pg_temp'
AS $f$
  -- 0183: ใบที่ปิด (done): ดี + เสีย + แยกออก + ได้รับเพิ่มไปเป็นส่วนใหม่ (arrived) = จำนวนเริ่มผลิต — ใบที่ไม่มี arrived ผลเท่าเดิมเป๊ะ
  select case
           when j.status = 'cancelled' and j.cancel_scrap_qty is null then null
           when j.status = 'done' then j.qty_planned - (coalesce(j.qty_good, 0) + coalesce(j.qty_scrap, 0) + j.qty_split_out + analytics.job_arrived_qty(j.id))
           when j.status = 'cancelled' then j.qty_planned - (a.scrap + a.split + a.disc + j.cancel_scrap_qty)
           else j.qty_planned - (analytics.job_live_qty(j.id) + a.scrap + a.split + a.disc)
         end
    from analytics.job j
    cross join lateral (
      select coalesce(sum(s.qty_scrap), 0)::integer as scrap, coalesce(sum(s.qty_split_out), 0)::integer as split,
             coalesce(sum(analytics.job_disc_active_qty(s.id, null)), 0)::integer as disc
        from analytics.job_stage s where s.job_id = j.id) a
   where j.id = p_job_id
$f$;

-- job_done: ดี + เสีย + แยกออก + arrived = เริ่มผลิต
CREATE OR REPLACE FUNCTION analytics.job_done(p_shop_id uuid, p_job_id uuid, p_qty_good integer, p_qty_scrap integer, p_weight_final_g numeric DEFAULT NULL::numeric, p_note text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid, p_surplus_disposition text DEFAULT NULL::text, p_surplus_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $f$
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
  -- 0181 + 0183: ดี + เสีย + แยกออก + ได้รับเพิ่มไปเป็นส่วนใหม่ = จำนวนเริ่มผลิต
  v_job := analytics.job_office_begin('job_done', p_shop_id, p_job_id, v_actor);
  select count(*), min(d.name_th) into v_open, v_first
    from analytics.job_stage s join analytics.job_stage_def d on d.shop_id = s.shop_id and d.code = s.stage_code
   where s.job_id = p_job_id and s.status in ('pending', 'received');
  if v_open > 0 then
    raise exception 'ปิดงานไม่ได้ — ยังมี % ขั้นที่ยังไม่เสร็จ (เช่น %)', v_open, v_first using errcode = '22023', hint = 'stages_open';
  end if;
  if (v_job.parent_job_id is null and exists (select 1 from analytics.job c where c.parent_job_id = p_job_id and c.status not in ('done', 'cancelled')))
     or exists (select 1 from analytics.job_discrepancy d
                 where d.status = 'open' and (d.job_id = p_job_id or (v_job.parent_job_id is null and d.root_job_id = p_job_id))
                   and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = d.id)) then
    raise exception 'ปิดงานไม่ได้ — ยังมีส่วนย่อยที่ยังไม่ปิด หรือส่วนต่างรอชี้แจง' using errcode = '22023', hint = 'parts_open';
  end if;
  if p_qty_good is null or p_qty_scrap is null or p_qty_good < 0 or p_qty_scrap < 0 or p_qty_good > 100000 or p_qty_scrap > 100000
     or p_qty_good + p_qty_scrap + v_job.qty_split_out + analytics.job_arrived_qty(p_job_id) <> v_job.qty_planned then
    raise exception 'จำนวนดี + จำนวนเสีย + จำนวนที่แยกออก/ได้รับเพิ่มเป็นส่วนใหม่ ต้องเท่ากับจำนวนที่วางแผน (% ชิ้น)', v_job.qty_planned using errcode = '22023', hint = 'qty_mismatch';
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
                       'qty_order', v_job.qty_order, 'surplus', greatest(v_surplus, 0), 'surplus_disposition', v_disp)
                       || case when v_job.qty_split_out > 0 then jsonb_build_object('qty_split_out', v_job.qty_split_out) else '{}'::jsonb end);
  perform analytics.job_tree_check(p_job_id);
  return jsonb_build_object('ok', true, 'job_no', v_job.job_no, 'status', 'done', 'qty_good', p_qty_good, 'qty_scrap', p_qty_scrap,
                            'surplus', greatest(v_surplus, 0), 'surplus_disposition', v_disp);
end;
$f$;

-- job_stage_guard: ขั้น arrive (ขั้นต้นทางของส่วนที่เกิดจากได้รับเพิ่มแล้ว)
CREATE OR REPLACE FUNCTION analytics.job_stage_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $f$
declare
  v_job    analytics.job%rowtype;
  v_prev   analytics.job_stage%rowtype;
  v_exp_in int;
  v_link   int;
  v_wlink  numeric;
begin
  -- 0183: + arrive_discrepancy_id — ขั้นที่รับขาดของส่วนที่เกิดจาก "ได้รับเพิ่มแล้ว" ทำหน้าที่เป็นขั้นต้นทางของส่วน (แทน split_from_stage_id · ไม่มี qty_split_out)
  -- 0181: ส่วนย่อย (แยก/ยกเลิก/ส่วนต่าง) — ของเดิมทุกข้อคงไว้ · เพิ่ม: qty_split_out (ผูกกับส่วนที่ชี้ขั้นนี้) · split_from_stage_id · โซ่จำนวนหักส่วนต่าง · ห้าม auto-close/ย้อนขั้นที่แยก
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
    if new.qty_split_out <> 0 then
      raise exception 'job_stage: ขั้นใหม่ต้องมี qty_split_out = 0' using errcode = '22023';
    end if;
    -- ส่วนย่อยคัดลอกขั้นจากใบแม่ — ขั้นที่ถูกปิดใช้งานทีหลังก็ต้องคัดลอกได้ (ใบแม่เองยังเช็คทะเบียนตามเดิม)
    if v_job.parent_job_id is null
       and not exists (select 1 from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = new.stage_code and d.is_active) then
      raise exception 'job_stage: ขั้น % ถูกปิดใช้งานหรือไม่มีในทะเบียน', new.stage_code using errcode = '22023';
    end if;
    if new.split_from_stage_id is not null then
      if v_job.parent_job_id is null
         or not exists (select 1 from analytics.job_stage ps join analytics.job pj on pj.id = ps.job_id
                         where ps.id = new.split_from_stage_id and ps.stage_code = new.stage_code
                           and (pj.id = v_job.parent_job_id or pj.parent_job_id = v_job.parent_job_id)) then
        raise exception 'job_stage: split_from_stage_id ต้องชี้ขั้นเดียวกันของใบแม่/ส่วนในต้นไม้เดียวกัน' using errcode = '22023', hint = 'split_link';
      end if;
      if exists (select 1 from analytics.job_stage x where x.job_id = new.job_id and (x.split_from_stage_id is not null or x.arrive_discrepancy_id is not null)) then
        raise exception 'job_stage: 1 ส่วนมีขั้นแยกได้ขั้นเดียว' using errcode = '22023', hint = 'split_link';
      end if;
    end if;
    -- 0183: ขั้นที่รับขาดของส่วนที่เกิดจากได้รับเพิ่มแล้ว: ต้องเป็นส่วนย่อย · ชี้แถวส่วนต่าง resolved/arrived ของใบแม่เดียวกัน · ขั้นเดียวกับขั้นผู้รับของส่วนต่าง · 1 ส่วนมีได้ขั้นเดียว
    if new.arrive_discrepancy_id is not null then
      if v_job.parent_job_id is null or new.split_from_stage_id is not null
         or not exists (select 1 from analytics.job_discrepancy ad join analytics.job_stage ats on ats.id = ad.to_stage_id
                         where ad.id = new.arrive_discrepancy_id and ad.status = 'resolved' and ad.resolved_kind = 'arrived'
                           and ad.root_job_id = v_job.parent_job_id and ats.stage_code = new.stage_code) then
        raise exception 'job_stage: arrive_discrepancy_id ต้องชี้ส่วนต่าง arrived ของใบแม่เดียวกัน ที่ขั้นเดียวกัน' using errcode = '22023', hint = 'arrive_link';
      end if;
      if exists (select 1 from analytics.job_stage x where x.job_id = new.job_id and (x.split_from_stage_id is not null or x.arrive_discrepancy_id is not null)) then
        raise exception 'job_stage: 1 ส่วนมีขั้นแยกได้ขั้นเดียว' using errcode = '22023', hint = 'arrive_link';
      end if;
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
  if new.job_id <> old.job_id or new.shop_id <> old.shop_id or new.stage_code <> old.stage_code or new.seq <> old.seq
     or new.split_from_stage_id is distinct from old.split_from_stage_id or new.arrive_discrepancy_id is distinct from old.arrive_discrepancy_id then
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
  if (new.qty_split_out is distinct from old.qty_split_out or new.weight_split_out_g is distinct from old.weight_split_out_g) and old.status <> 'received' then
    raise exception 'job_stage: qty_split_out เปลี่ยนได้เฉพาะขั้นที่ถืออยู่ (received)' using errcode = '22023', hint = 'has_split';
  end if;

  if new.status = old.status then
    if old.status in ('received', 'sent') and analytics.job_stage_state(new) is distinct from analytics.job_stage_state(old) then
      -- ข้อยกเว้นเดียว: ขั้น received เปลี่ยนเฉพาะ qty_split_out/qty_scrap/scrap_reason ตอนแยก (เพิ่ม — เหลือผู้ถืออย่างน้อย 1 ชิ้น) หรือคืนชิ้นจากส่วนที่ยกเลิก (ลด — ของเสียเท่าเดิม)
      if not (old.status = 'received'
              and (analytics.job_stage_state(new) - 'qty_split_out' - 'weight_split_out_g' - 'qty_scrap' - 'scrap_reason')
                  = (analytics.job_stage_state(old) - 'qty_split_out' - 'weight_split_out_g' - 'qty_scrap' - 'scrap_reason')
              and ((new.qty_split_out > old.qty_split_out and new.qty_scrap >= old.qty_scrap and new.weight_split_out_g >= old.weight_split_out_g)
                   or (new.qty_split_out < old.qty_split_out and new.weight_split_out_g <= old.weight_split_out_g and new.qty_scrap = old.qty_scrap and new.scrap_reason is not distinct from old.scrap_reason))
              and new.qty_split_out + new.qty_scrap < new.qty_in) then
        raise exception 'job_stage: ขั้นที่รับ/ส่งแล้วแก้ตรงไม่ได้ — ใช้ย้อนขั้น (job_stage_reopen) พร้อมเหตุผล' using errcode = '22023';
      end if;
      -- qty_split_out ต้องเท่ากับผลรวมจำนวนของส่วนที่ชี้ขั้นนี้ (ไม่นับส่วนที่ยกเลิกแบบคืนชิ้น) — แก้ตรงๆ โดยไม่มีส่วนรองรับไม่ได้
      select coalesce(sum(lj.qty_planned), 0) into v_link
        from analytics.job_stage ls join analytics.job lj on lj.id = ls.job_id
       where ls.split_from_stage_id = new.id and not (lj.status = 'cancelled' and lj.cancel_scrap_qty is null);
      if new.qty_split_out <> v_link then
        raise exception 'job_stage: qty_split_out ต้องเท่ากับผลรวมจำนวนของส่วนที่แยกจากขั้นนี้' using errcode = '22023', hint = 'split_link';
      end if;
      -- H2: น้ำหนักที่แยกออก (ทองที่ขั้นชั่ง) ต้องเท่า Σ น้ำหนักออกของขั้นแยกของส่วนที่ชี้ขั้นนี้ — กระทบยอดน้ำหนักได้เสมอ
      select coalesce(sum(ls.weight_out_g), 0) into v_wlink
        from analytics.job_stage ls join analytics.job lj on lj.id = ls.job_id
       where ls.split_from_stage_id = new.id and not (lj.status = 'cancelled' and lj.cancel_scrap_qty is null);
      if new.weight_split_out_g <> v_wlink then
        raise exception 'job_stage: weight_split_out_g ต้องเท่าผลรวมน้ำหนักของส่วนที่แยกจากขั้นนี้' using errcode = '22023', hint = 'split_link';
      end if;
    end if;
    new.updated_at := now();
    return new;
  end if;

  -- เปลี่ยนสถานะ: qty_split_out ห้ามขยับพร้อมกัน (received→sent คงค่าเดิม — js_sent_ck ใช้ค่านั้น)
  if new.qty_split_out is distinct from old.qty_split_out or new.weight_split_out_g is distinct from old.weight_split_out_g then
    raise exception 'job_stage: ห้ามเปลี่ยน qty_split_out พร้อมเปลี่ยนสถานะ' using errcode = '22023', hint = 'has_split';
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
      -- 0181: ผู้รับได้ = ที่ขั้นก่อนส่งออก − ส่วนต่างที่บันทึกไว้ (open/resolved ที่ไม่ถูก void) — ไม่มีส่วนต่าง ⇒ นิยามเดิมเป๊ะ
      v_exp_in := v_prev.qty_out - analytics.job_disc_active_qty(v_prev.id, new.id);
      if new.received_on < v_prev.sent_on then
        raise exception 'job_stage: วันรับ (%) ต้องไม่ก่อนวันส่งของขั้นก่อนหน้า (%)', new.received_on, v_prev.sent_on using errcode = '22023';
      end if;
    else
      v_exp_in := v_job.qty_planned;
    end if;
    if new.qty_in is distinct from v_exp_in then
      raise exception 'job_stage: จำนวนเข้า (%) ต้องเท่าจำนวนที่ส่งออกจากขั้นก่อนหน้า (%) หักส่วนต่างที่บันทึก', new.qty_in, v_exp_in using errcode = '22023';
    end if;
  elsif old.status = 'pending' and new.status = 'skipped' then
    -- ข้ามขั้น QC/แพ็กไม่ได้ · ยกเว้นเดียว: ส่วนย่อยที่รับช่วงมา (split_inherit) ข้ามขั้นที่ใบแม่ผ่านไปแล้ว — ต้องมีขั้นแยกของส่วนนั้นอยู่ถัดไป (ตั้งตอนสร้างส่วนเท่านั้น)
    if new.stage_code in ('qc', 'pack')
       and not (v_job.parent_job_id is not null and new.skip_reason = 'split_inherit'
                and exists (select 1 from analytics.job_stage x where x.job_id = new.job_id and x.seq > new.seq and (x.split_from_stage_id is not null or x.arrive_discrepancy_id is not null))) then
      raise exception 'job_stage: ข้ามขั้น QC และแพ็กไม่ได้' using errcode = '22023';
    end if;
  elsif old.status = 'received' and new.status = 'sent' then
    -- 0176: ขั้นที่ต้องชั่งปิดอัตโนมัติไม่ได้ทุกโลหะ + ใบทองเดิม (ก่อน profile) ปิดอัตโนมัติไม่ได้ทุกขั้นเหมือน J1
    if new.auto_closed and (new.weigh_required or (v_job.metal = 'gold' and v_job.profile_id is null)) then
      raise exception 'job_stage: งานทอง/ขั้นที่ต้องชั่งปิดขั้นอัตโนมัติไม่ได้ — ต้องกดส่งต่อพร้อมน้ำหนักออก' using errcode = '22023';
    end if;
    if new.auto_closed and old.qty_split_out > 0 then
      raise exception 'job_stage: ขั้นที่แยกส่วนออกไปแล้วปิดอัตโนมัติไม่ได้ — ผู้ถือต้องกดส่งต่อส่วนที่เหลือเอง' using errcode = '22023', hint = 'prev_not_sent';
    end if;
  elsif (old.status = 'received' and new.status = 'pending')
     or (old.status = 'sent' and new.status = 'received')
     or (old.status = 'skipped' and new.status = 'pending') then
    -- ย้อนขั้น: ทำได้เมื่อไม่มีขั้นถัดไปที่ received/sent อยู่ (design §3 ข้อ 4)
    if exists (select 1 from analytics.job_stage s where s.job_id = new.job_id and s.seq > new.seq and s.status in ('received', 'sent')) then
      raise exception 'job_stage: ย้อนข้ามขั้นที่ขั้นถัดไปรับหรือส่งไปแล้วไม่ได้ — ย้อนทีละขั้นจากขั้นล่าสุด' using errcode = '22023';
    end if;
    -- 0181: ขั้นที่แยกส่วนออก/เป็นขั้นแยกของส่วนย่อย/รับช่วงมา (split_inherit)/เป็นต้นทางของส่วนต่างย้อนไม่ได้ (ขั้นที่ "รับ" แล้วมีส่วนต่างย้อนได้ — ออฟฟิศ void ส่วนต่างต่อ)
    if old.qty_split_out > 0 or old.split_from_stage_id is not null or old.arrive_discrepancy_id is not null
       or (old.status = 'skipped' and old.skip_reason = 'split_inherit')
       or analytics.job_disc_active_qty(old.id, null) > 0 then
      raise exception 'job_stage: ขั้นนี้มีการแยกส่วน/ส่วนต่างอ้างอิงอยู่ ย้อนขั้นไม่ได้ (has_split)' using errcode = '22023', hint = 'has_split';
    end if;
  else
    raise exception 'job_stage: เปลี่ยนสถานะ % -> % ไม่ได้', old.status, new.status using errcode = '22023';
  end if;

  new.updated_at := now();
  return new;
end;
$f$;

-- job_discrepancy_guard: สร้างแถวตอนขั้นผู้รับ received/sent ได้เฉพาะเส้น arrive · void/UPDATE แถว arrived ไม่ได้
CREATE OR REPLACE FUNCTION analytics.job_discrepancy_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $f$
declare
  v_job analytics.job%rowtype;
  v_f   analytics.job_stage%rowtype;
  v_t   analytics.job_stage%rowtype;
  v_o   analytics.job_discrepancy%rowtype;
  v_arr boolean := coalesce(current_setting('app.job_arrive', true), '') = 'on';
begin
  -- 0181 + 0183: สร้างแถวตอนขั้นผู้รับ received/sent ได้เฉพาะในเส้น "ได้รับเพิ่มแล้ว" (app.job_arrive = on ที่ job_discrepancy_arrive_core)
  if tg_op = 'DELETE' then
    raise exception 'job_discrepancy: ห้ามลบ (append-only) — ออฟฟิศยกเลิกด้วย void แถวใหม่' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    select * into v_f from analytics.job_stage where id = new.from_stage_id;
    select * into v_t from analytics.job_stage where id = new.to_stage_id;
    select * into v_job from analytics.job where id = new.job_id;
    if v_f.id is null or v_t.id is null or v_job.id is null or v_f.job_id <> new.job_id or v_t.job_id <> new.job_id then
      raise exception 'job_discrepancy: ขั้นต้นทางและปลายทางต้องอยู่ในใบงานเดียวกัน' using errcode = '22023';
    end if;
    if v_job.shop_id <> new.shop_id or new.root_job_id is distinct from coalesce(v_job.parent_job_id, v_job.id) then
      raise exception 'job_discrepancy: ร้าน/ใบแม่ไม่ตรงกับใบงาน' using errcode = '22023';
    end if;
    if v_f.status <> 'sent' or not (v_t.status = 'pending' or (v_arr and v_t.status in ('received', 'sent'))) or v_f.seq >= v_t.seq
       or exists (select 1 from analytics.job_stage x where x.job_id = new.job_id and x.seq > v_f.seq and x.seq < v_t.seq and x.status <> 'skipped') then
      raise exception 'job_discrepancy: ต้องเป็นขั้นที่ส่งแล้ว → ขั้นถัดไปที่ยังไม่รับ (ติดกัน)' using errcode = '22023';
    end if;
    if new.status = 'open' then
      if v_f.qty_out - analytics.job_disc_active_qty(new.from_stage_id, new.to_stage_id) - new.qty < 1 then
        raise exception 'job_discrepancy: ส่วนต่างต้องไม่ทำให้ผู้รับเหลือน้อยกว่า 1 ชิ้น' using errcode = '22023', hint = 'qty_invalid';
      end if;
    elsif new.status = 'void' then
      select * into v_o from analytics.job_discrepancy where id = new.void_of_id;
      if not found or v_o.status not in ('open', 'resolved') or v_o.from_stage_id <> new.from_stage_id or v_o.to_stage_id <> new.to_stage_id
         or v_o.qty <> new.qty or v_o.job_id <> new.job_id then
        raise exception 'job_discrepancy: void ต้องชี้แถวเดิม (open/resolved) ที่คู่ขั้น/จำนวนตรงกัน' using errcode = '22023';
      end if;
      -- 0183: ชิ้นที่ได้รับเพิ่มแล้วอยู่ที่ส่วนใหม่แล้ว — void แถว arrived ไม่ได้ (ยกเว้นเส้น arrive เองที่ void แถว open เดิม ไม่ใช่แถว arrived)
      if v_o.resolved_kind = 'arrived' then
        raise exception 'job_discrepancy: ส่วนต่างที่ได้รับเพิ่มแล้ว void ไม่ได้ (ชิ้นอยู่ที่ส่วนใหม่แล้ว)' using errcode = '22023', hint = 'arrived_no_void';
      end if;
    elsif new.status = 'resolved' and v_arr and new.resolved_kind = 'arrived' then
      -- 0183: แถว arrived ของเส้น "ได้รับเพิ่มแล้ว" (resolved ตั้งแต่สร้าง · ไม่มีทางอื่นสร้าง arrived)
      if v_f.qty_out - analytics.job_disc_active_qty(new.from_stage_id, new.to_stage_id) - new.qty < 1 then
        raise exception 'job_discrepancy: ส่วนต่างต้องไม่ทำให้ผู้รับเหลือน้อยกว่า 1 ชิ้น' using errcode = '22023', hint = 'qty_invalid';
      end if;
    else
      raise exception 'job_discrepancy: แถวใหม่ต้องเป็น open หรือ void' using errcode = '22023';
    end if;
    return new;
  end if;
  -- UPDATE: open -> resolved ครั้งเดียว · ทุกคอลัมน์อื่นห้ามขยับ · แถวที่ถูก void แล้วชี้แจงไม่ได้
  if old.status <> 'open' or new.status <> 'resolved' then
    raise exception 'job_discrepancy: แก้ได้เฉพาะ open → resolved ครั้งเดียว (ชี้แจงแล้วแก้ไม่ได้ — ให้ออฟฟิศ void)' using errcode = '22023', hint = 'already_resolved';
  end if;
  -- 0183: ห้าม UPDATE เป็น arrived (arrived เกิดจากแถวใหม่ในเส้น arrive เท่านั้น — มีส่วนใหม่ผูกอยู่เสมอ)
  if new.resolved_kind = 'arrived' then
    raise exception 'job_discrepancy: arrived สร้างได้ทางเดียวคือบันทึกได้รับเพิ่มแล้ว' using errcode = '22023', hint = 'arrived_no_update';
  end if;
  if (to_jsonb(new) - 'status' - 'resolved_kind' - 'resolved_reason' - 'resolved_by_worker' - 'resolved_by_actor' - 'resolved_at')
     is distinct from (to_jsonb(old) - 'status' - 'resolved_kind' - 'resolved_reason' - 'resolved_by_worker' - 'resolved_by_actor' - 'resolved_at') then
    raise exception 'job_discrepancy: แก้คอลัมน์อื่นนอกจากผลการชี้แจงไม่ได้' using errcode = '22023';
  end if;
  if exists (select 1 from analytics.job_discrepancy v where v.void_of_id = old.id) then
    raise exception 'job_discrepancy: แถวนี้ถูก void แล้ว ชี้แจงไม่ได้' using errcode = '22023', hint = 'voided';
  end if;
  return new;
end;
$f$;

-- job_lot_cancel_core: event ฝั่งแม่ของส่วนที่ไม่มีขั้นแยก (ส่วนที่เกิดจากได้รับเพิ่มแล้ว) — ที่เหลือเหมือนเดิมทุกตัวอักษร
CREATE OR REPLACE FUNCTION analytics.job_lot_cancel_core(p_lot_job_id uuid, p_disposition text, p_reason text, p_scrap_reason text, p_scrap_weight numeric, p_worker_id uuid, p_channel text, p_actor uuid, p_device_hint text, p_enforce_splitter boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $f$
declare
  v_l      analytics.job%rowtype;
  v_ms     analytics.job_stage%rowtype;
  v_ms2    analytics.job_stage%rowtype;
  v_s2     analytics.job_stage%rowtype;
  v_blk    text;
  v_live   int;
  v_today  date := analytics.job_today();
  v_sreason text := null;
  v_who    uuid;
  v_wreq   boolean;
  v_wbasis numeric;
  v_wgap   numeric;
begin
  -- 0181 (M-C security: ทอง + ส่วนมีขั้นชั่ง + นับเป็นของเสีย ⇒ ต้องชั่งน้ำหนักของเสียที่เลิกใช้ ไม่งั้นทองหายจากยอดเงียบๆ)
  select * into v_l from analytics.job where id = p_lot_job_id;
  if not found or v_l.parent_job_id is null then
    return analytics.job_fail('not_lot', 'ไม่พบส่วนย่อยนี้');
  end if;
  perform 1 from analytics.job where id = v_l.parent_job_id for update;
  select * into v_l from analytics.job where id = p_lot_job_id;
  if p_disposition is null or p_disposition not in ('return_to_parent', 'scrap') then
    return analytics.job_fail('disposition_invalid', 'ต้องเลือกที่ไปของชิ้น: คืนให้ผู้ถือเดิม หรือนับเป็นของเสีย');
  end if;
  if v_l.status in ('done', 'cancelled') then
    return analytics.job_fail('job_closed', 'ส่วนนี้ปิดหรือยกเลิกไปแล้ว');
  end if;
  if exists (select 1 from analytics.job_discrepancy d where d.job_id = p_lot_job_id and d.status = 'open'
               and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = d.id)) then
    return analytics.job_fail('discrepancy_open', 'ส่วนนี้มีส่วนต่างรอชี้แจง — ชี้แจงก่อนจึงยกเลิกได้');
  end if;
  if exists (select 1 from analytics.job_stage x join analytics.job c on c.id = x.job_id
              where x.split_from_stage_id in (select s.id from analytics.job_stage s where s.job_id = p_lot_job_id)
                and not (c.status = 'cancelled' and c.cancel_scrap_qty is null)) then
    return analytics.job_fail('has_split', 'ส่วนนี้มีส่วนที่แยกต่อออกไปแล้ว — ยกเลิกส่วนนั้นก่อน');
  end if;
  select * into v_s2 from analytics.job_stage where job_id = p_lot_job_id and split_from_stage_id is not null;
  select * into v_ms from analytics.job_stage where id = v_s2.split_from_stage_id;
  -- M-D (security delta): บังคับชั่งของเสียเฉพาะส่วนที่มีขั้นชั่ง "ที่ชั่งแล้ว" — ส่วนที่ยังไม่ถึงขั้นชั่ง (แยกที่ขั้นเทียน ฯลฯ) ยังไม่มีน้ำหนักให้เทียบ ยกเลิกเป็นของเสียโดยไม่ชั่งได้
  v_wreq := p_disposition = 'scrap' and v_l.metal = 'gold'
            and exists (select 1 from analytics.job_stage x where x.job_id = p_lot_job_id and x.status <> 'skipped' and x.weigh_required
                           and (x.weight_in_g is not null or x.weight_out_g is not null));
  if p_scrap_weight is not null and not v_wreq then
    return analytics.job_fail('weight_unexpected', 'ส่วนนี้ไม่ต้องระบุน้ำหนักของเสีย');
  end if;

  if p_disposition = 'return_to_parent' then
    v_blk := analytics.job_lot_return_blocker(p_lot_job_id);
    if v_blk is not null then
      return analytics.job_fail(v_blk, case v_blk
        when 'already_received' then 'มีคนรับส่วนนี้ไปแล้ว — ช่างยกเลิกเองไม่ได้ แจ้งออฟฟิศ'
        when 'cannot_return' then 'ผู้ถือเดิมส่งต่อส่วนที่เหลือไปแล้ว คืนชิ้นไม่ได้ — แจ้งออฟฟิศ'
        when 'scrap_recorded' then 'การแยกครั้งนี้มีของเสียที่บันทึกไว้ คืนชิ้นไม่ได้ — แจ้งออฟฟิศ (ยกเลิกเป็นของเสีย)'
        when 'has_discrepancy' then 'ส่วนนี้มีส่วนต่างบันทึกอยู่ — แจ้งออฟฟิศ'
        else 'ยกเลิกส่วนนี้ไม่ได้' end);
    end if;
    -- ช่าง: ยกเลิกได้เฉพาะส่วนที่ตัวเองแยก (ตาม event split) และยังเป็นผู้ถือขั้นแม่ — ออฟฟิศไม่ถูกจำกัด
    if p_enforce_splitter then
      select e.worker_id into v_who from analytics.job_event e
       where e.job_id = v_ms.job_id and e.event_type = 'split' and e.payload ->> 'lot_job_id' = p_lot_job_id::text limit 1;
      if v_who is distinct from p_worker_id or v_ms.worker_id is distinct from p_worker_id then
        return analytics.job_fail('not_splitter', 'ยกเลิกได้เฉพาะส่วนที่คุณแยกเอง และยังเป็นผู้ถือขั้นนี้');
      end if;
    end if;
  else
    if p_enforce_splitter then
      return analytics.job_fail('disposition_invalid', 'ช่างยกเลิกได้เฉพาะแบบคืนชิ้นให้ผู้ถือเดิม');
    end if;
    v_sreason := nullif(btrim(p_scrap_reason), '');
    if v_sreason is null or not analytics.job_scrap_reason_valid(v_sreason) then
      return analytics.job_fail('reason_required', 'ยกเลิกเป็นของเสียต้องระบุเหตุผล (รูพรุน/หัก/ผิดแบบ/หาย/อื่นๆ)');
    end if;
  end if;
  if v_wreq then
    if p_scrap_weight is null then
      return analytics.job_fail('scrap_weight_required', 'ทอง: ยกเลิกเป็นของเสียต้องชั่งน้ำหนักของเสียที่เลิกใช้');
    end if;
    if p_scrap_weight <= 0 or not analytics.job_weight_ok(p_scrap_weight) then
      return analytics.job_fail('weight_invalid', 'น้ำหนักของเสียต้องมากกว่า 0 และไม่เกิน 100,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)');
    end if;
    -- ไม่เกินน้ำหนักสูงสุดที่ส่วนนี้เคยมี (เข้า + เติมโลหะ / ออก ของทุกขั้น)
    select max(greatest(coalesce(x.weight_in_g + x.metal_added_g, 0), coalesce(x.weight_out_g, 0))) into v_wbasis
      from analytics.job_stage x where x.job_id = p_lot_job_id;
    if p_scrap_weight > coalesce(v_wbasis, 0) then
      return analytics.job_fail('weight_over', 'น้ำหนักของเสียมากกว่าน้ำหนักที่ส่วนนี้มีอยู่ — ชั่งใหม่');
    end if;
    -- L-new-1 (security delta): น้ำหนักเศษที่ชั่งน้อยกว่าน้ำหนักล่าสุดของส่วนเกิน 0.05 g = ทองส่วนต่างหายไปไหนไม่มีใครรู้ — ต้องมีคำอธิบายเป็นข้อความ (ไม่ใช่รหัสเหตุผลล้วน · ไม่เปิดตัวเลขให้ช่าง: ฝั่งออฟฟิศเท่านั้น)
    v_wgap := analytics.job_latest_weight_g(p_lot_job_id) - p_scrap_weight;
    if v_wgap > 0.05 and not analytics.job_note_is_free_text(v_sreason) then
      return analytics.job_fail('gold_note_required', 'ทอง: น้ำหนักของเสียที่ชั่งน้อยกว่าน้ำหนักล่าสุดของส่วนนี้ — ต้องเขียนคำอธิบายเป็นข้อความ (ไม่ใช่แค่เลือกรหัสเหตุผล)');
    end if;
  end if;

  v_live := analytics.job_live_qty(p_lot_job_id);
  update analytics.job
     set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason,
         cancel_scrap_qty = case when p_disposition = 'scrap' then v_live end,
         cancel_scrap_reason = case when p_disposition = 'scrap' then v_sreason end,
         cancel_scrap_weight_g = case when v_wreq then p_scrap_weight end
   where id = p_lot_job_id;
  if p_disposition = 'return_to_parent' then
    update analytics.job_stage set qty_split_out = qty_split_out - v_l.qty_planned, weight_split_out_g = weight_split_out_g - coalesce(v_s2.weight_out_g, 0) where id = v_ms.id returning * into v_ms2;
  else
    select * into v_ms2 from analytics.job_stage where id = v_ms.id;
  end if;
  perform analytics.job_event_write(p_lot_job_id, null, 'split_cancel', v_today, p_actor, p_worker_id, p_channel, p_device_hint,
    jsonb_build_object('disposition', p_disposition, 'reason', p_reason, 'qty', v_l.qty_planned, 'live_qty', v_live, 'scrap_reason', v_sreason,
                       'scrap_weight_g', case when v_wreq then p_scrap_weight end));
  -- 0183: ส่วนที่เกิดจาก "ได้รับเพิ่มแล้ว" ไม่มีขั้นแยก (v_ms ว่าง) — event ฝั่งแม่เขียนที่ใบแม่โดยไม่ผูกขั้น · ส่วนที่แยกตามปกติ ผลเท่าเดิมเป๊ะ
  perform analytics.job_event_write(coalesce(v_ms.job_id, v_l.parent_job_id), v_ms.id, 'split_cancel', v_today, p_actor, p_worker_id, p_channel, p_device_hint,
    jsonb_build_object('lot_job_id', p_lot_job_id, 'lot_seq', v_l.lot_seq, 'disposition', p_disposition, 'qty', v_l.qty_planned, 'live_qty', v_live,
                       'before', case when v_ms.id is not null then analytics.job_stage_state(v_ms) end,
                       'after', case when v_ms.id is not null then analytics.job_stage_state(v_ms2) end)
    || case when v_ms.id is null then jsonb_build_object('arrive_lot', true) else '{}'::jsonb end);
  perform analytics.job_tree_check(p_lot_job_id);
  return jsonb_build_object('ok', true, 'action', 'split_cancel', 'lot_job_id', p_lot_job_id, 'lot_seq', v_l.lot_seq,
                            'disposition', p_disposition, 'qty', v_l.qty_planned, 'live_qty', v_live);
end;
$f$;

-- ============================================================================
-- 4. views (ต่อท้ายคอลัมน์เท่านั้น — 42P16) — v_job_tree: resolved ไม่นับ arrived (ชิ้นนั้นนับเป็น qty_live ของส่วนใหม่) + qty_discrepancy_arrived · drift: tree_sum หัก arrived · lot_split_stage นับ arrive · arrive_link
-- ============================================================================
create or replace view analytics.v_job_tree
  with (security_invoker = true) as
 SELECT j.id AS job_id,
    COALESCE(j.parent_job_id, j.id) AS root_job_id,
    j.shop_id,
    j.parent_job_id,
    j.lot_seq,
    (r.job_no ||
        CASE
            WHEN (j.parent_job_id IS NULL) THEN ''::text
            ELSE (' · ส่วนที่ '::text || j.lot_seq)
        END) AS label,
    j.job_no,
    j.status,
    j.qty_planned,
    analytics.job_live_qty(j.id) AS qty_live,
    a.stage_scrap AS qty_stage_scrap,
    j.qty_split_out,
    dsc.disc_open AS qty_discrepancy_open,
    dsc.disc_resolved AS qty_discrepancy_resolved,
    j.cancel_scrap_qty,
    j.cancel_scrap_weight_g,
        CASE
            WHEN (j.cancel_scrap_weight_g IS NULL) THEN NULL::numeric
            ELSE (analytics.job_latest_weight_g(j.id) - j.cancel_scrap_weight_g)
        END AS weight_scrap_gap_g,
    j.qty_good,
    j.qty_scrap AS qty_scrap_final,
    cur.stage_code,
    cur.stage_name,
    cur.stage_status,
    cur.holder_name,
    (analytics.job_today() - COALESCE(cur.received_on, ps.last_sent_on, analytics.job_bkk_date(j.created_at))) AS days_in_stage,
    qcs.qty_out AS qty_qc_passed,
    j.profile_name,
    j.design_label,
    j.metal,
    dsc.disc_arrived AS qty_discrepancy_arrived
   FROM ((((((analytics.job j
     JOIN analytics.job r ON ((r.id = COALESCE(j.parent_job_id, j.id))))
     LEFT JOIN LATERAL ( SELECT (COALESCE(sum(s.qty_scrap), (0)::bigint))::integer AS stage_scrap
           FROM analytics.job_stage s
          WHERE (s.job_id = j.id)) a ON (true))
     LEFT JOIN LATERAL ( SELECT (COALESCE(sum(dq.qty) FILTER (WHERE (dq.status = 'open'::text)), (0)::bigint))::integer AS disc_open,
            (COALESCE(sum(dq.qty) FILTER (WHERE ((dq.status = 'resolved'::text) AND (dq.resolved_kind IS DISTINCT FROM 'arrived'::text))), (0)::bigint))::integer AS disc_resolved,
            (COALESCE(sum(dq.qty) FILTER (WHERE ((dq.status = 'resolved'::text) AND (dq.resolved_kind = 'arrived'::text))), (0)::bigint))::integer AS disc_arrived
           FROM analytics.job_discrepancy dq
          WHERE ((dq.job_id = j.id) AND (dq.status = ANY (ARRAY['open'::text, 'resolved'::text])) AND (NOT (EXISTS ( SELECT 1
                   FROM analytics.job_discrepancy vq
                  WHERE (vq.void_of_id = dq.id)))))) dsc ON (true))
     LEFT JOIN LATERAL ( SELECT s.stage_code,
            d.name_th AS stage_name,
            s.status AS stage_status,
            COALESCE(w.display_name, s.assignee_name) AS holder_name,
            s.received_on
           FROM ((analytics.job_stage s
             JOIN analytics.job_stage_def d ON (((d.shop_id = s.shop_id) AND (d.code = s.stage_code))))
             LEFT JOIN analytics.worker w ON ((w.id = s.worker_id)))
          WHERE ((s.job_id = j.id) AND (s.status = ANY (ARRAY['received'::text, 'pending'::text])))
          ORDER BY (s.status = 'received'::text) DESC, s.seq
         LIMIT 1) cur ON (true))
     LEFT JOIN LATERAL ( SELECT max(s.sent_on) AS last_sent_on
           FROM analytics.job_stage s
          WHERE (s.job_id = j.id)) ps ON (true))
     LEFT JOIN LATERAL ( SELECT s.qty_out
           FROM analytics.job_stage s
          WHERE ((s.job_id = j.id) AND (s.stage_code = 'qc'::text) AND (s.status = 'sent'::text))) qcs ON (true));

create or replace view analytics.v_job_tree_drift
  with (security_invoker = true) as
 SELECT COALESCE(j.parent_job_id, j.id) AS root_job_id,
    j.id AS job_id,
    'job_identity'::text AS check_code,
    (analytics.job_identity_gap(j.id))::text AS detail
   FROM analytics.job j
  WHERE ((analytics.job_identity_gap(j.id) IS NOT NULL) AND (analytics.job_identity_gap(j.id) <> 0))
UNION ALL
 SELECT COALESCE(j.parent_job_id, j.id) AS root_job_id,
    j.id AS job_id,
    'split_link'::text AS check_code,
    (s.qty_split_out)::text AS detail
   FROM (analytics.job_stage s
     JOIN analytics.job j ON ((j.id = s.job_id)))
  WHERE (s.qty_split_out <> ( SELECT COALESCE(sum(lj.qty_planned), (0)::bigint) AS "coalesce"
           FROM (analytics.job_stage ls
             JOIN analytics.job lj ON ((lj.id = ls.job_id)))
          WHERE ((ls.split_from_stage_id = s.id) AND (NOT ((lj.status = 'cancelled'::text) AND (lj.cancel_scrap_qty IS NULL))))))
UNION ALL
 SELECT COALESCE(j.parent_job_id, j.id) AS root_job_id,
    j.id AS job_id,
    'weight_link'::text AS check_code,
    (s.weight_split_out_g)::text AS detail
   FROM (analytics.job_stage s
     JOIN analytics.job j ON ((j.id = s.job_id)))
  WHERE (s.weight_split_out_g <> ( SELECT COALESCE(sum(ls.weight_out_g), (0)::numeric) AS "coalesce"
           FROM (analytics.job_stage ls
             JOIN analytics.job lj ON ((lj.id = ls.job_id)))
          WHERE ((ls.split_from_stage_id = s.id) AND (NOT ((lj.status = 'cancelled'::text) AND (lj.cancel_scrap_qty IS NULL))))))
UNION ALL
 SELECT COALESCE(j.parent_job_id, j.id) AS root_job_id,
    j.id AS job_id,
    'job_split_sum'::text AS check_code,
    (j.qty_split_out)::text AS detail
   FROM analytics.job j
  WHERE (j.qty_split_out <> ( SELECT COALESCE(sum(s.qty_split_out), (0)::bigint) AS "coalesce"
           FROM analytics.job_stage s
          WHERE (s.job_id = j.id)))
UNION ALL
 SELECT j.parent_job_id AS root_job_id,
    j.id AS job_id,
    'lot_split_stage'::text AS check_code,
    NULL::text AS detail
   FROM analytics.job j
  WHERE ((j.parent_job_id IS NOT NULL) AND (( SELECT count(*) AS count
           FROM analytics.job_stage s
          WHERE ((s.job_id = j.id) AND ((s.split_from_stage_id IS NOT NULL) OR (s.arrive_discrepancy_id IS NOT NULL)))) <> 1))
UNION ALL
 SELECT r.id AS root_job_id,
    r.id AS job_id,
    'tree_sum'::text AS check_code,
    (r.qty_planned)::text AS detail
   FROM analytics.job r
  WHERE ((r.parent_job_id IS NULL) AND (((r.qty_planned)::numeric + ( SELECT (COALESCE(sum(ad.qty), (0)::bigint))::numeric AS "coalesce"
           FROM analytics.job_discrepancy ad
          WHERE ((ad.root_job_id = r.id) AND (ad.status = 'resolved'::text) AND (ad.resolved_kind = 'arrived'::text) AND (NOT (EXISTS ( SELECT 1
                   FROM analytics.job_discrepancy av
                  WHERE (av.void_of_id = ad.id))))))) <> ( SELECT ((COALESCE(sum(t.qty_planned), (0)::bigint))::numeric - COALESCE(sum(( SELECT COALESCE(sum(s.qty_split_out), (0)::bigint) AS "coalesce"
                   FROM analytics.job_stage s
                  WHERE (s.job_id = t.id))), (0)::numeric))
           FROM analytics.job t
          WHERE (((t.id = r.id) OR (t.parent_job_id = r.id)) AND (NOT ((t.status = 'cancelled'::text) AND (t.parent_job_id IS NOT NULL) AND (t.cancel_scrap_qty IS NULL)))))))
UNION ALL
 SELECT d.root_job_id,
    d.job_id,
    'discrepancy_chain'::text AS check_code,
    (d.qty)::text AS detail
   FROM ((analytics.job_discrepancy d
     JOIN analytics.job_stage tos ON ((tos.id = d.to_stage_id)))
     JOIN analytics.job_stage fs ON ((fs.id = d.from_stage_id)))
  WHERE ((d.status = ANY (ARRAY['open'::text, 'resolved'::text])) AND (NOT (EXISTS ( SELECT 1
           FROM analytics.job_discrepancy v
          WHERE (v.void_of_id = d.id)))) AND (tos.status = ANY (ARRAY['received'::text, 'sent'::text])) AND (tos.qty_in IS DISTINCT FROM (fs.qty_out - analytics.job_disc_active_qty(fs.id, tos.id))))
UNION ALL
 SELECT j.parent_job_id AS root_job_id,
    j.id AS job_id,
    'cancel_weight'::text AS check_code,
    NULL::text AS detail
   FROM analytics.job j
  WHERE ((j.parent_job_id IS NOT NULL) AND (j.status = 'cancelled'::text) AND (j.cancel_scrap_qty IS NOT NULL) AND (j.metal = 'gold'::text) AND (EXISTS ( SELECT 1
           FROM analytics.job_stage s
          WHERE ((s.job_id = j.id) AND (s.status <> 'skipped'::text) AND s.weigh_required AND ((s.weight_in_g IS NOT NULL) OR (s.weight_out_g IS NOT NULL))))) AND (j.cancel_scrap_weight_g IS NULL))
UNION ALL
 -- 0183: ส่วนต่างที่ได้รับเพิ่มแล้ว (arrived) ต้องมีส่วนใหม่ผูกอยู่ และ Σ จำนวนของส่วนใหม่ = qty ของแถว
 SELECT d.root_job_id,
    d.job_id,
    'arrive_link'::text AS check_code,
    (d.qty)::text AS detail
   FROM analytics.job_discrepancy d
  WHERE ((d.status = 'resolved'::text) AND (d.resolved_kind = 'arrived'::text) AND (NOT (EXISTS ( SELECT 1
           FROM analytics.job_discrepancy v
          WHERE (v.void_of_id = d.id)))) AND (d.qty <> ( SELECT (COALESCE(sum(lj.qty_planned), (0)::bigint))::integer AS "coalesce"
           FROM (analytics.job_stage ls
             JOIN analytics.job lj ON ((lj.id = ls.job_id)))
          WHERE ((ls.arrive_discrepancy_id = d.id) AND (NOT ((lj.status = 'cancelled'::text) AND (lj.cancel_scrap_qty IS NULL)))))));

-- ============================================================================
-- 5. ได้รับเพิ่มแล้ว (ภายใน): void แถวเดิม + แถว arrived (qty ที่มาถึง) + แถว open (ที่เหลือ) + ส่วนใหม่ที่ขั้นที่รับขาด (received)
-- ผู้เรียกล็อกใบแม่แล้ว (job_worker_auth p_lock / job_office_begin) — ที่นี่ล็อกซ้ำ (ไม่มีผล) · คืน job_fail แบบไม่ raise (ช่างเห็นข้อความไทย) · ออฟฟิศ wrapper raise ด้วย hint = code
-- p_actor_worker = ช่างที่กด (ช่องช่าง) · p_holder_worker = ผู้ถือส่วนใหม่ที่ออฟฟิศเลือก (null = ช่างที่กด/ผู้รับเดิม)
-- ============================================================================
create or replace function analytics.job_discrepancy_arrive_core(p_discrepancy_id uuid, p_qty integer, p_weight numeric, p_received_on date, p_holder_worker uuid, p_expected_open integer,
                                                                 p_actor_worker uuid, p_channel text, p_actor uuid, p_device_hint text, p_enforce_receiver boolean)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_d       analytics.job_discrepancy%rowtype;
  v_fs      analytics.job_stage%rowtype;
  v_ts      analytics.job_stage%rowtype;
  v_src     analytics.job%rowtype;
  v_root    analytics.job%rowtype;
  v_lot     analytics.job%rowtype;
  v_today   date := analytics.job_today();
  v_on      date;
  v_gold_w  boolean;
  v_missing numeric;
  v_n_mm    int;
  v_holder  uuid;
  v_hname   text;
  v_void    uuid;
  v_arr     uuid;
  v_rem     uuid := null;
  v_rem_qty int;
  v_rem_gap numeric := null;
  v_seq     int;
  v_lot_seq int;
  v_weigh   boolean;
  v_text    constant text := 'ได้รับเพิ่มแล้ว';
  r         analytics.job_stage%rowtype;
  v_ns      analytics.job_stage%rowtype;
begin
  -- 0183 (มติเจ้าของ 20 ต.ค. 69): ส่วนต่างทางที่ 3 "ได้รับเพิ่มแล้ว" — ดูหัวไฟล์ migration
  select * into v_d from analytics.job_discrepancy where id = p_discrepancy_id;
  if not found then
    return analytics.job_fail('invalid_part', 'ไม่พบรายการส่วนต่างนี้ — โหลดหน้าใหม่');
  end if;
  select * into v_root from analytics.job where id = v_d.root_job_id for update;
  select * into v_d from analytics.job_discrepancy where id = p_discrepancy_id;
  select * into v_src from analytics.job where id = v_d.job_id;
  if v_root.status in ('done', 'cancelled') or v_src.status in ('done', 'cancelled') then
    return analytics.job_fail('job_closed', 'ใบงานนี้ปิดแล้ว รับของเพิ่มไม่ได้');
  end if;
  if v_root.status = 'on_hold' or v_src.status = 'on_hold' then
    return analytics.job_fail('job_on_hold', 'ใบงานนี้ถูกพักไว้ — แจ้งออฟฟิศ');
  end if;
  -- กดซ้ำ/2 มือถือ: แถวที่ถูกชี้แจง/void/arrive ไปแล้ว = ไม่ใช่ open (ไม่สร้างส่วนซ้ำ)
  if v_d.status <> 'open' or exists (select 1 from analytics.job_discrepancy v where v.void_of_id = v_d.id) then
    return analytics.job_fail('already_resolved', 'ส่วนต่างนี้ชี้แจงแล้วหรือถูกยกเลิกแล้ว');
  end if;
  select * into v_fs from analytics.job_stage where id = v_d.from_stage_id;
  select * into v_ts from analytics.job_stage where id = v_d.to_stage_id;
  -- ขั้นผู้รับต้องรับไว้แล้ว (received/sent) · ถ้าออฟฟิศย้อนเป็นยังไม่รับ ให้ใช้ void แทน
  if v_fs.status <> 'sent' or v_ts.status not in ('received', 'sent') then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;
  if p_enforce_receiver and v_ts.worker_id is distinct from p_actor_worker then
    return analytics.job_fail('not_receiver', 'บันทึกว่าได้รับเพิ่มได้เฉพาะช่างที่รับของขั้นนี้ (หรือให้ออฟฟิศกรอกแทน)');
  end if;
  if p_expected_open is not null and p_expected_open <> v_d.qty then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;
  if p_qty is null or p_qty < 1 or p_qty > v_d.qty then
    return analytics.job_fail('qty_invalid', 'จำนวนที่ได้รับเพิ่มต้องมากกว่า 0 และไม่เกินส่วนต่างที่ค้างอยู่');
  end if;

  -- น้ำหนัก: ทอง + ขั้นที่รับขาดตั้งชั่ง = ต้องชั่งชิ้นที่มาถึง · อื่นๆ นับจำนวนอย่างเดียว (ข้อความไม่มีตัวเลข — N1)
  v_gold_w := v_root.metal = 'gold' and v_ts.weigh_required;
  if v_gold_w then
    if p_weight is null then
      return analytics.job_fail('arrive_weight_required', 'ทอง: ต้องชั่งน้ำหนักชิ้นที่มาถึงก่อน');
    end if;
    if p_weight <= 0 or not analytics.job_weight_ok(p_weight) then
      return analytics.job_fail('weight_invalid', 'น้ำหนักต้องมากกว่า 0 และไม่เกิน 100,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)');
    end if;
    -- น้ำหนักที่ยังขาดอยู่ของส่วนต่างนี้ = −gap ของแถว (แถว open ที่เหลือหลัง arrive บางส่วนถือ gap ที่หักไปแล้ว) · ไม่มี gap แต่มีน้ำหนักส่งออก/รับเข้า = เทียบสองขั้น · ไม่มีเลย = ไม่มีเพดานอ้างอิง
    v_missing := case when v_d.weight_gap_g is not null then -v_d.weight_gap_g
                      when v_fs.weight_out_g is not null and v_ts.weight_in_g is not null then v_fs.weight_out_g - v_ts.weight_in_g end;
    if v_missing is not null and p_weight > v_missing + 0.05 then
      -- ผู้ชั่งต้องชั่งแบบไม่รู้คำตอบ: ไม่บอกส่วนต่าง/น้ำหนักที่ขาด · บันทึก event ทุกครั้ง (ออฟฟิศเห็น) · ช่างชั่งไม่ผ่านครบ 3 ครั้ง = ให้ออฟฟิศกรอกแทน (กันไล่เดา)
      perform analytics.job_event_write(v_d.job_id, v_ts.id, 'weigh', v_today, p_actor, p_actor_worker, p_channel, p_device_hint,
        jsonb_build_object('kind', 'arrive_mismatch', 'discrepancy_id', v_d.id, 'stage_code', v_ts.stage_code, 'weight_g', p_weight, 'missing_g', v_missing));
      select count(*) into v_n_mm from analytics.job_event e
       where e.job_id = v_d.job_id and e.event_type = 'weigh' and e.payload ->> 'kind' = 'arrive_mismatch' and e.payload ->> 'discrepancy_id' = v_d.id::text;
      if p_channel = 'worker_qr' and v_n_mm >= 3 then
        return analytics.job_fail('office_required', 'ชั่งชิ้นที่มาถึงไม่ตรงหลายครั้งแล้ว — แจ้งออฟฟิศให้บันทึกแทน');
      end if;
      return analytics.job_fail('arrive_heavy', 'น้ำหนักชิ้นที่มาถึงไม่ตรงกับส่วนที่ขาด — ชั่งใหม่ ถ้ายังไม่ตรงให้แจ้งออฟฟิศ');
    end if;
    if p_channel = 'worker_qr' and exists (
         select 1 from analytics.job_event e
          where e.job_id = v_d.job_id and e.event_type = 'weigh' and e.payload ->> 'kind' = 'arrive_mismatch' and e.payload ->> 'discrepancy_id' = v_d.id::text
          having count(*) >= 3) then
      return analytics.job_fail('office_required', 'ชั่งชิ้นที่มาถึงไม่ตรงหลายครั้งแล้ว — แจ้งออฟฟิศให้บันทึกแทน');
    end if;
  elsif p_weight is not null then
    return analytics.job_fail('weight_unexpected', 'ขั้นนี้ไม่ต้องชั่งน้ำหนักชิ้นที่ได้รับเพิ่ม (นับจำนวนอย่างเดียว) — โหลดหน้าใหม่');
  end if;

  -- วันที่: ช่างผ่าน QR = วันนี้ · ออฟฟิศย้อนได้ ≤ 14 วัน ไม่อนาคต ไม่ก่อนวันที่ขั้นต้นทางส่ง
  v_on := coalesce(p_received_on, v_today);
  if (p_channel = 'worker_qr' and v_on <> v_today) or v_on > v_today or v_on < v_today - 14 or v_on < v_fs.sent_on then
    return analytics.job_fail('date_invalid', 'วันที่รับต้องไม่ใช่อนาคต ไม่ก่อนวันที่ขั้นก่อนส่งของ และย้อนหลังได้ไม่เกิน 14 วัน');
  end if;

  -- ผู้ถือส่วนใหม่: ช่างที่กด (ช่อง QR) · ออฟฟิศเลือก (ต้องเป็นช่างที่ใช้งานอยู่ของร้านนี้) · ไม่เลือก = ผู้รับเดิมของขั้นนั้น
  v_holder := coalesce(p_holder_worker, case when p_channel = 'worker_qr' then p_actor_worker end, v_ts.worker_id);
  if v_holder is not null then
    select w.id into v_holder from analytics.worker w where w.id = v_holder and w.shop_id = v_root.shop_id and w.is_active;
    if v_holder is null then
      return analytics.job_fail('who_invalid', 'ไม่พบช่างที่เลือก หรือช่างคนนี้ปิดใช้งานอยู่');
    end if;
  else
    v_hname := v_ts.assignee_name;
    if v_hname is null then
      return analytics.job_fail('who_required', 'ต้องระบุผู้ถือชิ้นที่ได้รับเพิ่ม');
    end if;
  end if;

  -- แถวส่วนต่าง: void แถวเดิม → แถว arrived → แถว open ที่เหลือ (guard ยอมให้สร้างตอนขั้นผู้รับ received/sent เฉพาะเมื่อ app.job_arrive = on)
  perform set_config('app.job_arrive', 'on', true);
  insert into analytics.job_discrepancy (shop_id, root_job_id, job_id, from_stage_id, to_stage_id, qty, status, void_of_id, void_reason, created_by_worker, created_by_actor)
  values (v_d.shop_id, v_d.root_job_id, v_d.job_id, v_d.from_stage_id, v_d.to_stage_id, v_d.qty, 'void', v_d.id, v_text || ' (แยกแถวใหม่)', p_actor_worker, p_actor)
  returning id into v_void;
  insert into analytics.job_discrepancy (shop_id, root_job_id, job_id, from_stage_id, to_stage_id, qty, status, resolved_kind, resolved_reason, resolved_by_worker, resolved_by_actor, resolved_at,
                                         created_by_worker, created_by_actor)
  values (v_d.shop_id, v_d.root_job_id, v_d.job_id, v_d.from_stage_id, v_d.to_stage_id, p_qty, 'resolved', 'arrived', v_text, p_actor_worker, p_actor, clock_timestamp(),
          p_actor_worker, p_actor)
  returning id into v_arr;
  v_rem_qty := v_d.qty - p_qty;
  if v_rem_qty > 0 then
    -- gap ที่เหลือ = gap เดิม + น้ำหนักที่มาถึง (ขาดน้อยลง) · น้ำหนักส่งออก/จำนวนส่งออกคัดลอก (jd_sent_ck: ทั้งสามค่าพร้อมกัน)
    v_rem_gap := case when v_d.weight_gap_g is not null then v_d.weight_gap_g + coalesce(p_weight, 0) end;
    insert into analytics.job_discrepancy (shop_id, root_job_id, job_id, from_stage_id, to_stage_id, qty, status, created_by_worker, created_by_actor, weight_gap_g, weight_sent_g, qty_sent)
    values (v_d.shop_id, v_d.root_job_id, v_d.job_id, v_d.from_stage_id, v_d.to_stage_id, v_rem_qty, 'open', p_actor_worker, p_actor, v_rem_gap,
            case when v_rem_gap is not null then v_d.weight_sent_g end, case when v_rem_gap is not null then v_d.qty_sent end)
    returning id into v_rem;
  end if;
  perform set_config('app.job_arrive', 'off', true);

  -- ส่วนใหม่ (ส่วนย่อยของใบแม่) — เหมือนแยกส่วน: เลขส่วนรันต่อ · เลขใบงานกินตัวนับร้าน · ขั้นคัดลอกจากใบที่ส่วนต่างอยู่
  select coalesce(max(l.lot_seq), 0) + 1 into v_lot_seq from analytics.job l where l.parent_job_id = v_root.id;
  insert into analytics.job_counter as c (shop_id, last_no) values (v_root.shop_id, 1)
  on conflict (shop_id) do update set last_no = c.last_no + 1
  returning c.last_no into v_seq;
  select exists (select 1 from analytics.job_stage x where x.job_id = v_d.job_id and x.seq > v_ts.seq and x.status <> 'skipped' and x.weigh_required) or v_gold_w into v_weigh;
  insert into analytics.job (shop_id, seq, source_kind, oem_quote_item_id, root_quote_id, oem_item_seq, production_order_item_id, product_id,
                             design_label, sku_snapshot, metal, qty_planned, qty_order, weigh_required, due_date, created_by,
                             profile_id, profile_name, require_final_weight, parent_job_id, lot_seq)
  values (v_root.shop_id, v_seq, v_root.source_kind, v_root.oem_quote_item_id, v_root.root_quote_id, v_root.oem_item_seq, v_root.production_order_item_id,
          v_root.product_id, v_root.design_label, v_root.sku_snapshot, v_root.metal, p_qty, p_qty, v_weigh, v_root.due_date,
          coalesce(p_actor, v_root.created_by), v_root.profile_id, v_root.profile_name, v_root.require_final_weight, v_root.id, v_lot_seq)
  returning * into v_lot;
  for r in select s.* from analytics.job_stage s where s.job_id = v_d.job_id order by s.seq loop
    insert into analytics.job_stage (job_id, shop_id, stage_code, seq, weigh_required, scrap_qty_ask, scrap_weight_ask, arrive_discrepancy_id)
    values (v_lot.id, v_lot.shop_id, r.stage_code, r.seq, r.weigh_required, r.scrap_qty_ask, r.scrap_weight_ask, case when r.id = v_ts.id then v_arr end);
  end loop;
  perform analytics.job_event_write(v_lot.id, null, 'create', v_today, p_actor, p_actor_worker, p_channel, p_device_hint,
    jsonb_build_object('kind', 'arrive_lot', 'parent_job_id', v_root.id, 'lot_seq', v_lot_seq, 'qty_planned', p_qty, 'from_job_id', v_d.job_id,
                       'discrepancy_id', v_arr, 'to_stage_code', v_ts.stage_code, 'metal', v_root.metal, 'profile_id', v_root.profile_id));
  for r in select s.* from analytics.job_stage s where s.job_id = v_lot.id order by s.seq loop
    if r.seq < v_ts.seq then
      update analytics.job_stage set status = 'skipped', skip_reason = 'split_inherit' where id = r.id returning * into v_ns;
      perform analytics.job_event_write(v_lot.id, r.id, 'stage_skip', v_today, p_actor, p_actor_worker, p_channel, p_device_hint,
        jsonb_build_object('stage_code', r.stage_code, 'reason', 'split_inherit', 'before', analytics.job_stage_state(r), 'after', analytics.job_stage_state(v_ns)));
    elsif r.seq = v_ts.seq then
      update analytics.job_stage
         set status = 'received', received_on = v_on, worker_id = v_holder, assignee_name = v_hname, qty_in = p_qty,
             weight_in_g = case when v_gold_w then p_weight end
       where id = r.id returning * into v_ns;
      perform analytics.job_event_write(v_lot.id, r.id, 'stage_receive', v_on, p_actor, p_actor_worker, p_channel, p_device_hint,
        jsonb_build_object('stage_code', r.stage_code, 'arrive_lot', true, 'before', analytics.job_stage_state(r), 'after', analytics.job_stage_state(v_ns)));
    elsif exists (select 1 from analytics.job_stage o where o.job_id = v_d.job_id and o.seq = r.seq and o.status = 'skipped') then
      update analytics.job_stage set status = 'skipped', skip_reason = (select o.skip_reason from analytics.job_stage o where o.job_id = v_d.job_id and o.seq = r.seq)
       where id = r.id returning * into v_ns;
      perform analytics.job_event_write(v_lot.id, r.id, 'stage_skip', v_today, p_actor, p_actor_worker, p_channel, p_device_hint,
        jsonb_build_object('stage_code', r.stage_code, 'reason', v_ns.skip_reason, 'before', analytics.job_stage_state(r), 'after', analytics.job_stage_state(v_ns)));
    end if;
  end loop;
  if v_gold_w then
    update analytics.job set weight_start_g = p_weight where id = v_lot.id and weight_start_g is null;
  end if;

  perform analytics.job_event_write(v_d.job_id, v_fs.id, 'discrepancy_arrive', v_on, p_actor, p_actor_worker, p_channel, p_device_hint,
    jsonb_build_object('discrepancy_id', v_d.id, 'void_id', v_void, 'arrived_id', v_arr, 'remaining_id', v_rem, 'qty', p_qty, 'qty_remaining', greatest(v_rem_qty, 0),
                       'lot_job_id', v_lot.id, 'lot_seq', v_lot_seq, 'to_stage_code', v_ts.stage_code, 'holder_worker_id', v_holder,
                       'weight_g', case when v_gold_w then p_weight end, 'gap_after_g', v_rem_gap));
  perform analytics.job_tree_check(v_d.job_id);
  return jsonb_build_object('ok', true, 'action', 'arrive', 'discrepancy_id', v_rem, 'arrived_id', v_arr, 'qty', p_qty, 'qty_remaining', greatest(v_rem_qty, 0),
                            'lot_job_id', v_lot.id, 'lot_seq', v_lot_seq, 'label', v_root.job_no || ' · ส่วนที่ ' || v_lot_seq,
                            'stage_seq', v_ts.seq, 'stage_code', v_ts.stage_code);
end;
$f$;

-- ออฟฟิศกรอกแทน (security definer · p_actor · crm_require_owner_admin ผ่าน job_office_begin ล็อกใบแม่ก่อน) · ผิดกติกา = raise 22023 + hint = รหัสเดียวกับฝั่งช่าง
create or replace function analytics.job_discrepancy_arrive(p_shop_id uuid, p_discrepancy_id uuid, p_qty integer, p_weight_g numeric default null, p_received_on date default null,
                                                            p_worker_id uuid default null, p_actor uuid default null, p_expected_open integer default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_d     analytics.job_discrepancy%rowtype;
  v_r     jsonb;
begin
  -- 0183: ออฟฟิศบันทึก "ได้รับเพิ่มแล้ว" แทนช่าง (เลือกผู้ถือส่วนใหม่ได้ · ไม่เลือก = ผู้รับเดิม)
  if p_discrepancy_id is null then
    raise exception 'job_discrepancy_arrive: p_discrepancy_id จำเป็น' using errcode = '22023', hint = 'discrepancy_not_found';
  end if;
  select * into v_d from analytics.job_discrepancy where id = p_discrepancy_id and shop_id = p_shop_id;
  if not found then
    raise exception 'ไม่พบส่วนต่างนี้ในร้านนี้' using errcode = '22023', hint = 'discrepancy_not_found';
  end if;
  perform analytics.job_office_begin('job_discrepancy_arrive', p_shop_id, v_d.job_id, v_actor);
  v_r := analytics.job_discrepancy_arrive_core(p_discrepancy_id, p_qty, p_weight_g, p_received_on, p_worker_id, p_expected_open, null, 'job_page', v_actor, null, false);
  if not (v_r ->> 'ok')::boolean then
    raise exception '%', v_r ->> 'message' using errcode = '22023', hint = v_r ->> 'code';
  end if;
  return v_r;
end;
$f$;

-- ช่าง (หน้า /w/): ช่างที่เป็นผู้รับของขั้นที่รับขาดเท่านั้น · token พิสูจน์ใบ (ใบแม่) · ส่วนต่างต้องอยู่ในต้นไม้ของ token
create or replace function analytics.job_worker_discrepancy_arrive(p_token_hash text, p_session_hash text, p_discrepancy_id uuid, p_qty integer, p_weight_g numeric default null,
                                                                   p_expected_open integer default null, p_user_agent text default null, p_ip_hash text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_a    jsonb;
  v_root uuid;
begin
  -- 0183 (มติ 20 ต.ค.): ช่างที่รับของขั้นนั้นบันทึก "ได้รับเพิ่มแล้ว" (ของนับผิด/ส่งตามมาทีหลัง) · ได้ไม่ครบ = ที่เหลือยังค้าง
  v_a := analytics.job_worker_auth(p_token_hash, p_session_hash, p_ip_hash, true, true, 'write');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  v_root := (v_a ->> 'job_id')::uuid;
  if p_discrepancy_id is null or not exists (select 1 from analytics.job_discrepancy d where d.id = p_discrepancy_id and d.root_job_id = v_root) then
    return analytics.job_fail('invalid_part', 'ไม่พบรายการส่วนต่างนี้ในใบงาน — โหลดหน้าใหม่');
  end if;
  return analytics.job_discrepancy_arrive_core(p_discrepancy_id, p_qty, p_weight_g, null, null, p_expected_open, (v_a ->> 'worker_id')::uuid, 'worker_qr', null,
                                               analytics.job_device_hint(p_user_agent, p_ip_hash), true);
end;
$f$;

-- ============================================================================
-- 6. job_worker_resolve (replace · signature เดิม) — ลอกจาก pg_get_functiondef บน DB สด (ฉบับ 0182 md5 168bb2be…) + action arrive ใน my_actions
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
  -- 0181 + 0182 (รูปอ้างอิงของใบ — เฉพาะช่างที่ระบุตัวแล้ว) + 0183 (my_actions: arrive = ได้รับเพิ่มแล้ว ให้ผู้รับของขั้นที่รับขาด)
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
      -- 0183: ส่วนต่างที่ยัง open ซึ่ง "ฉันเป็นผู้รับของขั้นที่รับขาด" → ปุ่ม "ได้รับเพิ่มแล้ว" (qty = ยอดที่ยังค้าง · weight_required = ทอง + ขั้นนั้นตั้งชั่ง — ไม่ส่งน้ำหนัก/ส่วนต่างให้ช่าง N1)
      for dr in select dd.id, dd.qty, ts.seq as t_seq, ts.stage_code as t_code, (p.metal = 'gold' and ts.weigh_required) as w_req
                  from analytics.job_discrepancy dd join analytics.job_stage ts on ts.id = dd.to_stage_id
                 where dd.job_id = p.id and dd.status = 'open' and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = dd.id)
                   and ts.worker_id = v_worker and ts.status in ('received', 'sent')
                 order by dd.created_at loop
        v_acts := v_acts || jsonb_build_object('lot_job_id', p.id, 'label', v_lbl, 'action', 'arrive', 'stage_seq', dr.t_seq, 'stage_code', dr.t_code,
          'stage_name', (select d8.name_th from analytics.job_stage_def d8 where d8.shop_id = p.shop_id and d8.code = dr.t_code),
          'weight_required', dr.w_req, 'scrap_qty_ask', false, 'scrap_weight_ask', false,
          'qty_hold', null, 'qty_expected', null, 'discrepancy_id', dr.id, 'qty', dr.qty, 'office_only', false);
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
-- 7. สิทธิ์ — service_role เท่านั้น (migration-traps ข้อ 2, 7, 18) · ปิดทุกอย่างก่อนแล้วเปิดเฉพาะที่ตั้งใจ (4 ชื่อเสมอ — ข้อ 18.1)
-- ============================================================================
do $g$
declare
  r record;
  v_touched constant text[] := array[
    'job_arrived_qty', 'job_discrepancy_arrive_core', 'job_discrepancy_arrive', 'job_worker_discrepancy_arrive',
    'job_identity_gap', 'job_done', 'job_stage_guard', 'job_discrepancy_guard', 'job_worker_resolve', 'job_lot_cancel_core'];
  -- RPC/helper ที่ service_role ต้องเรียก (job_identity_gap + job_arrived_qty = view security_invoker เรียก) · core + guard = ภายในเท่านั้น
  v_rpc constant text[] := array['job_arrived_qty', 'job_discrepancy_arrive', 'job_worker_discrepancy_arrive', 'job_identity_gap', 'job_done', 'job_worker_resolve'];
  v_dup text;
  v_n int;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p
     where p.pronamespace = 'analytics'::regnamespace and p.proname = any (v_touched)
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
    raise exception '0183: พบ overload ของฟังก์ชัน: %', v_dup;
  end if;
  select count(*) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and proname = any (v_touched);
  if v_n <> cardinality(v_touched) then
    raise exception '0183: ฟังก์ชันที่ประกาศ % ตัว แต่พบใน pg_proc % ตัว', cardinality(v_touched), v_n;
  end if;
end;
$g$;

-- ============================================================================
-- 8. post-check: ไม่แตะของเดิมนอกรายการ · ข้อมูลเดิมไม่ขยับ · view/คอลัมน์/drift เป็นไปตามที่ตั้งใจ · สิทธิ์ปิด
-- ============================================================================
do $c$
declare
  v_changed text;
  v_new text;
  v_bad int;
  v_cols int;
  v_touched constant text[] := array['job_identity_gap', 'job_done', 'job_stage_guard', 'job_discrepancy_guard', 'job_worker_resolve', 'job_lot_cancel_core'];
  v_added constant text[] := array['job_arrived_qty', 'job_discrepancy_arrive_core', 'job_discrepancy_arrive', 'job_worker_discrepancy_arrive'];
begin
  -- (1) ฟังก์ชันเดิมนอกรายการ md5 ต้องเท่าเดิมเป๊ะ (oem_*/production_*/stock_*/job_*/worker_* ทุกตัวในสคีมา)
  select string_agg(b.sig, ', ') into v_changed
    from _j183_fn_base b
    left join pg_proc p on p.oid = to_regprocedure(b.sig)
   where b.proname <> all (v_touched) and (p.oid is null or md5(pg_get_functiondef(p.oid)) <> b.h);
  if v_changed is not null then
    raise exception '0183 แตะฟังก์ชันเดิมนอกรายการ (md5 ไม่เท่า/หาย): %', v_changed;
  end if;
  -- (2) ฟังก์ชันที่ replace เปลี่ยนจริง (มีเครื่องหมาย 0183) · ฟังก์ชันใหม่ = รายการที่ประกาศเท่านั้น
  select string_agg(n, ', ') into v_new
    from unnest(v_touched) as n
   where not exists (select 1 from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = n and position('0183' in pg_get_functiondef(p.oid)) > 0);
  if v_new is not null then
    raise exception '0183: ฟังก์ชันที่ควรถูกแทนที่แต่ยังไม่ใช่ฉบับ 0183: %', v_new;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_new
    from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
     and not exists (select 1 from _j183_fn_base b where b.sig = p.oid::regprocedure::text)
     and not (p.proname = any (v_added) or p.proname = any (v_touched));
  if v_new is not null then
    raise exception '0183: มีฟังก์ชันใหม่นอกรายการที่ประกาศ: %', v_new;
  end if;
  -- (3) แถวเดิมไม่ขยับ (ไฟล์นี้ไม่ UPDATE/INSERT แถวใดๆ ของตารางเหล่านี้ — ข้อ 19)
  select string_agg(b.t, ', ') into v_changed
    from _j183_row_base b
    join (select 'job'::text as t, count(*) as n, coalesce(md5(string_agg(j::text, '|' order by j.id)), '') as h from analytics.job j
          union all select 'job_stage', count(*), coalesce(md5(string_agg((to_jsonb(s) - 'arrive_discrepancy_id')::text, '|' order by s.id)), '') from analytics.job_stage s
          union all select 'job_event', count(*), coalesce(md5(string_agg(e::text, '|' order by e.id)), '') from analytics.job_event e
          union all select 'job_discrepancy', count(*), coalesce(md5(string_agg(d::text, '|' order by d.id)), '') from analytics.job_discrepancy d
          union all select 'job_token', count(*), coalesce(md5(string_agg(k.id::text || coalesce(k.revoked_at::text, ''), '|' order by k.id)), '') from analytics.job_token k
          union all select 'job_counter', count(*), coalesce(md5(string_agg(c::text, '|' order by c::text)), '') from analytics.job_counter c
          union all select 'job_photo', count(*), coalesce(md5(string_agg(ph::text, '|' order by ph.id)), '') from analytics.job_photo ph) a on a.t = b.t
   where a.n <> b.n or a.h <> b.h;
  if v_changed is not null then
    raise exception '0183: แถวเดิมขยับในตาราง: %', v_changed;
  end if;
  -- (4) view: v_job_tree ได้คอลัมน์ใหม่ 1 ตัวต่อท้าย · อีกสามตัวคอลัมน์เท่าเดิม · drift ของข้อมูลเดิมเท่าก่อน apply
  select count(*) into v_cols from information_schema.columns where table_schema = 'analytics' and table_name = 'v_job_tree';
  if v_cols <> (select b.n from _j183_view_base b where b.table_name = 'v_job_tree') + 1
     or (select column_name from information_schema.columns where table_schema = 'analytics' and table_name = 'v_job_tree' order by ordinal_position desc limit 1) <> 'qty_discrepancy_arrived' then
    raise exception '0183: v_job_tree ต้องได้คอลัมน์ qty_discrepancy_arrived ต่อท้าย 1 ตัวพอดี';
  end if;
  select string_agg(b.table_name, ', ') into v_changed
    from _j183_view_base b
    where b.table_name <> 'v_job_tree'
      and (select count(*) from information_schema.columns c where c.table_schema = 'analytics' and c.table_name = b.table_name) <> b.n;
  if v_changed is not null then
    raise exception '0183: จำนวนคอลัมน์ของ view เปลี่ยน: %', v_changed;
  end if;
  select count(*) into v_bad from analytics.v_job_tree_drift;
  if v_bad <> (select n from _j183_drift_base) then
    raise exception '0183: v_job_tree_drift ของข้อมูลเดิมเปลี่ยน (ก่อน % · หลัง %)', (select n from _j183_drift_base), v_bad;
  end if;
  -- (5) constraint/trigger/สิทธิ์
  if not exists (select 1 from pg_constraint where conrelid = 'analytics.job'::regclass and conname = 'job_done_ck' and pg_get_constraintdef(oid) like '%job_arrived_qty%') then
    raise exception '0183: job_done_ck ต้องนับ job_arrived_qty';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'analytics.job_discrepancy'::regclass and conname = 'jd_kind_ck' and pg_get_constraintdef(oid) like '%arrived%') then
    raise exception '0183: jd_kind_ck ต้องมี arrived';
  end if;
  if (select count(*) from pg_trigger t where t.tgrelid = 'analytics.job_discrepancy'::regclass and not t.tgisinternal and t.tgenabled in ('O', 'A')) <> 2 then
    raise exception '0183: job_discrepancy ต้องมี trigger เปิดอยู่ 2 ตัว (guard + deny truncate)';
  end if;
  select count(*) into v_bad from pg_trigger t
   where t.tgrelid in ('analytics.job'::regclass, 'analytics.job_stage'::regclass, 'analytics.job_event'::regclass, 'analytics.job_token'::regclass, 'analytics.job_discrepancy'::regclass)
     and not t.tgisinternal and t.tgenabled not in ('O', 'A');
  if v_bad > 0 then
    raise exception '0183: พบ trigger ของตารางใบงาน/ส่วนต่างที่ไม่ได้เปิด % ตัว', v_bad;
  end if;
  if coalesce(nullif(current_setting('app.job_arrive', true), ''), 'off') <> 'off' then
    raise exception '0183: app.job_arrive ต้องไม่ค้างเปิด';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_new
    from pg_proc p cross join lateral aclexplode(p.proacl) a
   where p.pronamespace = 'analytics'::regnamespace and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  if v_new is not null then
    raise exception '0183: พบฟังก์ชันในสคีมา analytics ที่ PUBLIC/anon/authenticated ถือ EXECUTE: %', v_new;
  end if;
  raise notice '0183: ฟังก์ชันเดิม % ตัว md5 เท่าเดิมทั้งหมด (ยกเว้น % ตัวที่ replace) · ฟังก์ชันใหม่ % ตัว · แถวเดิมไม่ขยับ · drift เดิม % แถว',
    (select count(*) from _j183_fn_base) - (select count(*) from _j183_fn_base where proname = any (v_touched)),
    cardinality(v_touched), cardinality(v_added), (select n from _j183_drift_base);
end;
$c$;

comment on column analytics.job_stage.arrive_discrepancy_id is
  '0183: ขั้นที่รับขาดของ "ส่วนที่เกิดจากได้รับเพิ่มแล้ว" ชี้แถวส่วนต่าง resolved/arrived ที่เป็นต้นเหตุ (แทน split_from_stage_id — ขั้นผู้รับของใบเดิมรับไปแล้ว) · ส่วนหนึ่งมีได้ 1 ขั้นที่เป็นทั้ง split หรือ arrive (ไม่ใช่ทั้งสอง)';

notify pgrst, 'reload schema';
