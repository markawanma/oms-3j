-- 0195_gold_weigh_exempt_buff.sql — ใบทองไม่บังคับชั่งขั้น "ขัด" (buff) · มติเจ้าของ 27 ต.ค. 69 (ต่อจาก 0194 "แต่ง → ฝังพลอย → ขัด")
-- สถานะ: ยังไม่ apply · 🔴 ห้าม apply ก่อน 0194 (pre-check ไฟล์นี้ raise ถ้า job_stage_def_ensure ยังไม่ใช่ฉบับ 0194 หรือ buff ยังไม่อยู่ 105) · apply ด้วย node scripts/run-sql.mjs --commit --record เท่านั้น (ห้าม supabase db push)
-- ชุดทดสอบ scripts/verify/verify-0195.sql · design ท้ายไฟล์ docs/3j-jewelry/oms/design-stage-order-gem-before-buff.md (ภาค 0195)
-- 🔴 apply จากสำเนา LF เท่านั้น (git show <ref>:supabase/migrations/0195_... หรือ sed 's/\r$//') — working tree บน Windows เป็น CRLF ⇒ \r ติดเข้าไปใน body ฟังก์ชัน/วิว (ข้อ 20 ของ 3j-migration-traps) · ไฟล์นี้ทน \r แล้ว (เทียบ md5 ตัด \r ทุกจุด) แต่ prosrc จะไม่ตรงกับที่ลอกมา
-- 🔴 มี alter table analytics.job_stage_def add column = ACCESS EXCLUSIVE บน job_stage_def (ทุก RPC/ตัวตรวจ/บอร์ดอ่านตารางนี้) ช่วงสั้น ⇒ รันนอกเวลางาน · lock_timeout 8s กันค้างคิว
--
-- ทำไม: ทองที่หายตอนขัด (ขัดหลังฝังพลอย — พลอยทำให้ weight_out รวมพลอยต่างกฎ "ชั่งทุกขั้นที่มีโลหะ") เจ้าของไม่ต้องการบังคับชั่งขั้นขัด · ทองที่หายจะเห็นที่ยอดรวมใบตอน job_done (weight_start − weight_final) + แถว buff "ไม่ได้ชั่ง" ใน v_job_stage_loss
--
-- โมเดล (ทาง A ตาม design — เหตุผล):
--  1. คอลัมน์ใหม่ job_stage_def.gold_weigh_exempt boolean not null default false = "ขั้นที่ทองไม่บังคับชั่ง" · default false ⇒ ทุกขั้นเดิม (gem_set/plating/qc/pack) เข้มเท่าเดิม ขั้นใหม่ในอนาคตก็เข้มโดยค่าเริ่ม · ตั้ง true เฉพาะ buff
--     ไม่ใส่ CHECK (exempt -> metal_present): ขั้นที่ไม่มีโลหะไม่เข้านิพจน์อยู่แล้ว และ CHECK บนตารางที่มี on conflict (ensure) = กับดักข้อ 14
--     นิยาม gold_unguarded (ต้องตรงกันคำต่อคำ DB 2 ที่ + TS 1 ที่): ใบทองยังไม่ปิด และมีขั้นที่ metal_present ∧ ¬gold_weigh_exempt ∧ ¬weigh_required ∧ status <> 'skipped'
--  2. replace 7 อย่าง (6 + job_lot_cancel_core ข้อ 4b) (ลอกสดจาก DB ก่อนเขียน — md5 pre-check): job_stage_def_ensure (ลอกจากไฟล์ 0194 + คอลัมน์ใหม่ · buff = true) · job_profile_state (นิพจน์ gold_unguarded) · v_job_board (นิพจน์ pw.unguarded บรรทัดเดียว · คอลัมน์ 56 ตัวลำดับเดิม ตรวจก่อน/หลัง)
--     · job_stage_suggest / job_record_profile_list (เพิ่ม key gold_weigh_exempt ใน stages/stage_defs — additive) · job_record_profile_ensure (seed แบบทองร้านใหม่: weigh = metal_present ∧ ¬exempt + ชื่อ/note ใหม่)
--     ไม่แตะ job_create_insert (แค่ส่งต่อค่าจาก job_profile_apply) · job_core_* / job_done (ไม่อ่าน gold_unguarded) · job_record_profile_upsert / _stage_guard (ติ๊กชั่ง buff ให้ทองยังทำได้ — exempt ≠ ห้าม)
--  3. แบบทองปริยาย (is_default_gold) ที่ buff weigh=true -> false (UPDATE แคบ: เฉพาะแถว buff ของแบบทองปริยาย) · ไม่ UPDATE แถวแบบอื่น (แบบเงิน/แบบที่ผู้ใช้ตั้งเอง — ไม่ใช่เรื่องของมตินี้ แม้ติ๊กชั่ง buff ไว้)
--     rename แบบทองปริยาย "ทอง — ชั่งทุกขั้นที่มีโลหะ + ชั่งสุทธิตอนปิด" -> "ทอง — ชั่งทุกขั้นที่มีโลหะ (ยกเว้นขัด) + ชั่งสุทธิตอนปิด" + note (Tech Lead เอา 27 ต.ค.) · job.profile_name ของใบเดิมเป็น snapshot ไม่เปลี่ยน (ตั้งใจ)
--  4. ใบที่สร้างแล้ว: ไม่ backfill job_stage.weigh_required (flag เป็น snapshot ตอนสร้าง — 0176 หนี้ 9 · guard ห้ามเปลี่ยนหลังขั้นแรกถูกรับ) · ปัจจุบันไม่มีใบทองเปิด · ใบทองที่ยังไม่เริ่มในอนาคต -> ออฟฟิศกด "เปลี่ยนแบบ" เอง
--  4b. [security M2 · Tech Lead ตัดสิน 27 ต.ค. 69] ของเสียทองที่ออกจากระบบต้องมีน้ำหนักเสมอ ไม่ผูกกับ weigh_required ของขั้น: job_lot_cancel_core (ลอกสดจาก DB) — v_wreq เดิมผูกกับ "มีขั้นชั่งที่ชั่งแล้ว" ⇒ ใบทองแยกที่ขั้นขัด (ไม่ชั่ง) แล้วยกเลิกเป็นของเสีย
--     จะไม่ถูกบังคับชั่ง = ทองหายเงียบๆ · แก้: บังคับเมื่อส่วนนั้นถือโลหะแล้ว (มีขั้น received/sent ที่ metal_present) · ส่วนที่แยกก่อนถึงขั้นมีโลหะ (ขั้นเทียน) ไม่มีทองให้ชั่ง ยังยกเลิกเป็นของเสียโดยไม่ชั่งได้ (M-D เดิม) — ต่างจากสูตรตรง "scrap ∧ gold" เฉพาะกรณีไม่มีทองในมือ
--     เพดานน้ำหนักของเสีย: ส่วนที่ไม่เคยชั่ง (ขัดไม่ชั่ง ⇒ ไม่มี weight_in/out ของตัวเอง) ใช้น้ำหนักสูงสุดของใบแม่แทน · ไม่มีน้ำหนักเลยทั้งต้นไม้ = ไม่มีเพดาน (ยังบังคับ > 0 และ ≤ 100,000) — ไม่งั้น "ต้องชั่ง" + "เพดาน 0" = ยกเลิกไม่ได้เลย
--     ไม่แก้: split weight_move (0181) / arrive (0183) — ไม่ใช่ของเสีย (มติขัดไม่ชั่ง) · ของเสียตอนแยกส่วน (นับชิ้นเสีย p_qty_scrap) ไม่รับน้ำหนักอยู่แล้วทุกขั้น (0181 มติ ค1) = ช่องเดิมไม่ใช่ของ 0195 (บอกใน design)
--  5. ป้าย gold_unguarded เป็นเตือนอย่างเดียว (ไม่มี RPC ไหนบล็อกจากมัน) ⇒ 0195 ไม่เปลี่ยนด่านรับ/ส่ง/ปิดงาน
--
-- หนี้: ไม่มี UI ตั้ง gold_weigh_exempt (เปลี่ยนต้องผ่าน migration — มติระดับร้าน) · ป้าย gold_unguarded จะไม่เตือนเรื่องทองหายตอนขัดอีก (ตั้งใจ)

set local lock_timeout = '8s';

-- baseline ก่อนแตะอะไร
create temp table _j195_job_base on commit drop as
  select 'job'::text as t, count(*) as n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as h from analytics.job x
  union all select 'job_stage', count(*), coalesce(md5(string_agg(x::text, '|' order by x::text)), '') from analytics.job_stage x
  union all select 'job_event', count(*), coalesce(md5(string_agg(x::text, '|' order by x::text)), '') from analytics.job_event x;
create temp table _j195_def_base on commit drop as select * from analytics.job_stage_def;
create temp table _j195_ps_base on commit drop as select * from analytics.job_record_profile_stage;
create temp table _j195_prof_base on commit drop as select * from analytics.job_record_profile;
create temp table _j195_fn_base on commit drop as
  select p.oid::regprocedure::text as sig, md5(replace(pg_get_functiondef(p.oid), E'\r', '')) as h, coalesce(p.proacl::text, 'NULL') as acl
    from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.prokind in ('f', 'p')
     and p.proname not in ('job_stage_def_ensure', 'job_profile_state', 'job_stage_suggest', 'job_record_profile_list', 'job_record_profile_ensure', 'job_lot_cancel_core');
create temp table _j195_acl_base on commit drop as
  select p.oid::regprocedure::text as sig, coalesce(p.proacl::text, 'NULL') as acl
    from pg_proc p where p.pronamespace = 'analytics'::regnamespace
     and p.proname in ('job_stage_def_ensure', 'job_profile_state', 'job_stage_suggest', 'job_record_profile_list', 'job_record_profile_ensure', 'job_lot_cancel_core');
create temp table _j195_view_base on commit drop as
  select c.relacl::text as acl, c.reloptions::text as ro,
         (select string_agg(a.ordinal_position || ':' || a.column_name, ',' order by a.ordinal_position) from information_schema.columns a where a.table_schema = 'analytics' and a.table_name = 'v_job_board') as cols
    from pg_class c where c.relnamespace = 'analytics'::regnamespace and c.relname = 'v_job_board';

-- ============================================================================
-- 0. pre-check — ต้องหลัง 0194 · ฟังก์ชัน/วิวที่จะ replace ต้องเป็นฉบับที่ลอกมา (หรือฉบับใหม่ของไฟล์นี้ = รันซ้ำ) ไม่งั้นมีคน replace ทับ ⇒ หยุด
-- ============================================================================
do $pre195$
declare
  v_h text;
  v_n int;
  r record;
begin
  for r in
    select * from (values
      ('job_stage_def_ensure',       'c751a76d5f18845c72f5aaf6497814e0', '61f196623f418fb9baeec6b72e7c169d'),
      ('job_profile_state',          '0e355fc743e1c123a0723e607a0584cb', '2b1f27932e7e20da4edcd9afe08b7a3d'),
      ('job_stage_suggest',          '8600395a3ff129cece5a48088045c9b8', '2f96e27d7b67c550af0e9f0aabb8ce92'),
      ('job_record_profile_list',    'f65ed70bd17b035d656d9dc39149b28e', '49dd75e21529dd0320d71471067b71fb'),
      ('job_record_profile_ensure',  'ac7757a8ccbacae0975157e3041e66e2', '3d15de020586f6da8482352e83901f09'),
      ('job_lot_cancel_core',        '8428cabb96839aa273be96873f89e79f', '1fb7a6384c050caf1c340847fa9ec872')
    ) as t(fn, h_old, h_new)
  loop
    select md5(replace(pg_get_functiondef(p.oid), E'\r', '')) into v_h from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = r.fn;
    if v_h is null or v_h not in (r.h_old, r.h_new) then
      raise exception '0195: % บน DB ไม่ใช่ฉบับที่ลอกมา (md5 %) — ถ้าเป็น job_stage_def_ensure แปลว่ายังไม่ apply 0194 · ถ้าตัวอื่นแปลว่ามีคน replace ทับ · ลอก definition สดใหม่ก่อน', r.fn, v_h;
    end if;
  end loop;
  select md5(replace(pg_get_viewdef(c.oid, true), E'\r', '')) into v_h from pg_class c where c.relnamespace = 'analytics'::regnamespace and c.relname = 'v_job_board';
  if v_h is null or v_h not in ('e9da58a60dfb8a6aeb7293c1dc53cccb', 'b1e89853ffa04cf88c3adf84f23afb34') then
    raise exception '0195: v_job_board บน DB ไม่ใช่ฉบับที่ลอกมา (md5 %) — ลอก viewdef สดใหม่ก่อน', v_h;
  end if;
  -- L2: rename แบบทองปริยายต้องไม่ชนชื่อแบบอื่นในร้านเดียวกัน (unique ชื่อต่อร้าน · ไม่สนตัวพิมพ์) — raise ก่อนแตะอะไร
  select count(*) into v_n from analytics.job_record_profile g
    join analytics.job_record_profile o on o.shop_id = g.shop_id and o.id <> g.id and lower(o.name) = lower('ทอง — ชั่งทุกขั้นที่มีโลหะ (ยกเว้นขัด) + ชั่งสุทธิตอนปิด')
   where g.is_default_gold and g.name = 'ทอง — ชั่งทุกขั้นที่มีโลหะ + ชั่งสุทธิตอนปิด';
  if v_n > 0 then
    raise exception '0195: มีแบบอื่นใช้ชื่อ "ทอง — ชั่งทุกขั้นที่มีโลหะ (ยกเว้นขัด) + ชั่งสุทธิตอนปิด" อยู่แล้ว % ร้าน — เปลี่ยนชื่อแบบนั้นก่อน (rename แบบทองปริยายจะชน unique)', v_n;
  end if;
  -- 0194 ต้องลงแล้ว: ทุกร้านที่มี buff ต้องอยู่ 105
  select count(*) into v_n from analytics.job_stage_def b where b.code = 'buff' and b.seq_default <> 105;
  if v_n > 0 then
    raise exception '0195: มี % ร้านที่ buff.seq_default ไม่ใช่ 105 — ยังไม่ apply 0194', v_n;
  end if;
end;
$pre195$;

-- ============================================================================
-- 1. คอลัมน์ใหม่ + ตั้ง buff เป็น exempt (ไม่มี trigger บน job_stage_def · where แคบ ⇒ รันซ้ำไม่แตะแถวเดิม)
-- ============================================================================
alter table analytics.job_stage_def add column if not exists gold_weigh_exempt boolean not null default false;
comment on column analytics.job_stage_def.gold_weigh_exempt is 'ขั้นที่ใบทองไม่บังคับชั่ง (มติเจ้าของ 27 ต.ค. 69: ขัด) — ไม่นับเป็น gold_unguarded · default false = เข้มเท่ากฎทองเดิม';
update analytics.job_stage_def set gold_weigh_exempt = true where code = 'buff' and not gold_weigh_exempt;

-- ============================================================================
-- 2. job_stage_def_ensure — ลอกจากไฟล์ 0194 + คอลัมน์ gold_weigh_exempt (buff = true ที่เหลือ false) · on conflict do nothing ⇒ ร้านเดิมไม่ขยับ
-- ============================================================================
create or replace function analytics.job_stage_def_ensure(p_shop_id uuid)
 returns void
 language sql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
  insert into analytics.job_stage_def (shop_id, code, name_th, seq_default, cost_block, batch_kind, weigh_default, metal_present, gold_weigh_exempt)
  select p_shop_id, v.code, v.name_th, v.seq, v.cost_block, v.batch_kind, v.weigh_default, v.metal_present, v.gold_exempt
  from (values
    ('cad',            'ออกแบบ CAD',               10,  'nre',       null,           false, false, false),
    ('print3d',        'ปริ้น 3D ต้นแบบ',          20,  'nre',       null,           false, false, false),
    ('mold',           'อัดก้อนยาง',               30,  'nre',       null,           false, false, false),
    ('wax_inject',     'ฉีดเทียน',                 40,  'per_piece', null,           false, false, false),
    ('wax_tree',       'ติดต้นเทียน',              50,  'batch',     null,           false, false, false),
    ('invest_burnout', 'ปั่นปูน เทปูน เผา',        60,  'batch',     'flask',        false, false, false),
    ('cast',           'หล่อ',                     70,  'batch',     'flask',        true,  true,  false),
    ('cut_sprue',      'ตัดต้น',                   80,  'per_piece', null,           true,  true,  false),
    ('finish',         'แต่ง',                     91,  'per_piece', null,           true,  true,  false),
    ('gem_set',        'ฝังพลอย',                  100, 'per_piece', null,           false, true,  false),
    ('buff',           'ขัด',                      105, 'per_piece', null,           false, true,  true),
    ('plating',        'ชุบ',                      110, 'batch',     'plating_tank', false, true,  false),
    ('qc',             'ตรวจ QC',                  120, 'per_piece', null,           false, true,  false),
    ('pack',           'แพ็ก',                     130, 'per_piece', null,           false, true,  false)
  ) as v(code, name_th, seq, cost_block, batch_kind, weigh_default, metal_present, gold_exempt)
  on conflict (shop_id, code) do nothing
$f$;
revoke execute on function analytics.job_stage_def_ensure(uuid) from public, anon, authenticated;

-- ============================================================================
-- 3. job_profile_state — นิพจน์ gold_unguarded (ลอกสดจาก DB · แก้บรรทัดเดียว) · ไม่มีใครถือ EXECUTE (เหมือนเดิม)
-- ============================================================================
CREATE OR REPLACE FUNCTION analytics.job_profile_state(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $function$
  -- 0195: ขั้นที่ gold_weigh_exempt (ขัด — มติ 27 ต.ค. 69) ทองไม่บังคับชั่ง ⇒ ไม่นับเป็น gold_unguarded
  select jsonb_build_object(
    'profile_id', j.profile_id, 'profile_name', j.profile_name, 'require_final_weight', j.require_final_weight,
    'has_weigh', exists (select 1 from analytics.job_stage s where s.job_id = j.id and s.weigh_required),
    'gold_unguarded', (j.metal = 'gold' and j.status not in ('done', 'cancelled') and exists (
        select 1 from analytics.job_stage s join analytics.job_stage_def d on d.shop_id = s.shop_id and d.code = s.stage_code
         where s.job_id = j.id and d.metal_present and not d.gold_weigh_exempt and not s.weigh_required and s.status <> 'skipped')),
    'stages', coalesce((select jsonb_agg(jsonb_build_object('stage_code', s.stage_code, 'weigh', s.weigh_required,
                                                           'scrap_qty', s.scrap_qty_ask, 'scrap_weight', s.scrap_weight_ask) order by s.seq)
                          from analytics.job_stage s where s.job_id = j.id), '[]'::jsonb))
    from analytics.job j where j.id = p_job_id
$function$
;
revoke execute on function analytics.job_profile_state(uuid) from public, anon, authenticated;

-- ============================================================================
-- 4. v_job_board — ลอกสดจาก DB · แก้นิพจน์ pw.unguarded บรรทัดเดียว (create or replace ไม่เปลี่ยนสิทธิ์/reloptions · ด่านหลังทำตรวจซ้ำ)
-- ============================================================================
-- 0195: เปลี่ยนเฉพาะนิพจน์ pw.unguarded (+ NOT d2.gold_weigh_exempt) · คอลัมน์ 56 ตัวลำดับเดิม · ลอก viewdef สดจาก DB
create or replace view analytics.v_job_board with (security_invoker = true) as
SELECT b.id,
    b.shop_id,
    b.job_no,
    b.seq,
    b.source_kind,
    b.source_ref,
    b.design_label,
    b.sku_snapshot,
    b.metal,
    b.qty_planned,
    b.status,
    b.due_date,
    b.current_stage_code,
    b.current_stage_name,
    b.current_stage_status,
    b.holder_name,
    b.days_in_stage,
    b.is_overdue,
    b.last_event_at,
    b.last_scan_at,
    b.is_stale,
    b.stage_count,
    b.stage_done_count,
    b.has_auto_closed,
    b.deposit_missing,
    b.start_gate_note_present,
    b.quote_qty_mismatch,
    b.quote_item_qty,
    b.created_at,
    b.done_at,
    b.cancelled_at,
    b.board_column,
    b.handoff_gap_g,
    b.handoff_mismatch_count,
    b.qty_order,
    b.qty_surplus,
    b.under_planned,
    b.surplus_pending,
    b.surplus_disposition,
    b.target_piece_g,
    b.metal_plan_g,
    b.profile_name,
    b.has_weigh,
    b.gold_unguarded,
    jj.parent_job_id,
    jj.lot_seq,
    lt.parts_count,
    lt.parts_open,
    lt.qty_pending_explanation,
        CASE
            WHEN jj.parent_job_id IS NULL THEN COALESCE(analytics.job_tree_dominant_stage(jj.id), b.current_stage_code)
            ELSE b.current_stage_code
        END AS dominant_stage_code,
    hgp.gap AS handoff_gap_partial_g,
    tg.gap AS tree_handoff_gap_g,
    tgp.gap AS tree_handoff_gap_partial_g,
    tmc.n AS tree_handoff_mismatch_count,
    tex.v AS tree_weight_gap_excess_g,
    tlg.v AS tree_lot_first_gap_sum_g
   FROM ( SELECT j.id,
            j.shop_id,
            j.job_no,
            j.seq,
            j.source_kind,
                CASE j.source_kind
                    WHEN 'oem'::text THEN aq.quote_no
                    ELSE po.po_no
                END AS source_ref,
            j.design_label,
            j.sku_snapshot,
            j.metal,
            j.qty_planned,
            j.status,
            j.due_date,
            j.current_stage_code,
            d.name_th AS current_stage_name,
            cs.status AS current_stage_status,
            COALESCE(w.display_name, cs.assignee_name) AS holder_name,
            analytics.job_today() - COALESCE(cs.received_on, ps.last_sent_on, analytics.job_bkk_date(j.created_at)) AS days_in_stage,
            j.due_date IS NOT NULL AND (j.status = ANY (ARRAY['open'::text, 'in_progress'::text, 'on_hold'::text])) AND j.due_date < analytics.job_today() AS is_overdue,
            ev.last_event_at,
            ev.last_scan_at,
            (j.status = ANY (ARRAY['open'::text, 'in_progress'::text])) AND analytics.job_bkk_date(COALESCE(ev.last_event_at, j.created_at)) < (analytics.job_today() - 3) AS is_stale,
            st.stage_count,
            st.stage_done_count,
            st.has_auto_closed,
            j.source_kind = 'oem'::text AND COALESCE(pay.paid, 0::numeric) <= 0::numeric AS deposit_missing,
            j.start_gate_note IS NOT NULL AS start_gate_note_present,
            j.source_kind = 'oem'::text AND (j.status <> ALL (ARRAY['done'::text, 'cancelled'::text])) AND j.parent_job_id IS NULL AND aqi.qty IS DISTINCT FROM j.qty_order AS quote_qty_mismatch,
            aqi.qty AS quote_item_qty,
            j.created_at,
            j.done_at,
            j.cancelled_at,
                CASE
                    WHEN j.status = ANY (ARRAY['done'::text, 'cancelled'::text]) THEN j.status
                    WHEN j.current_stage_code IS NULL THEN 'awaiting_close'::text
                    ELSE j.current_stage_code
                END AS board_column,
            hg.handoff_gap_g,
            hmc.handoff_mismatch_count,
            j.qty_order,
                CASE
                    WHEN j.status = 'done'::text THEN j.qty_good - j.qty_order
                    ELSE NULL::integer
                END AS qty_surplus,
            (j.status <> ALL (ARRAY['done'::text, 'cancelled'::text])) AND j.qty_planned < j.qty_order AS under_planned,
            j.status = 'done'::text AND j.qty_good > j.qty_order AND j.surplus_disposition = 'hold'::text AS surplus_pending,
            j.surplus_disposition,
            j.target_piece_g,
            j.metal_plan_g,
            j.profile_name,
            COALESCE(pw.has_weigh, false) AS has_weigh,
            j.metal = 'gold'::text AND (j.status <> ALL (ARRAY['done'::text, 'cancelled'::text])) AND COALESCE(pw.unguarded, false) AS gold_unguarded
           FROM analytics.job j
             LEFT JOIN analytics.job_stage cs ON cs.job_id = j.id AND cs.stage_code = j.current_stage_code
             LEFT JOIN analytics.job_stage_def d ON d.shop_id = j.shop_id AND d.code = j.current_stage_code
             LEFT JOIN analytics.worker w ON w.id = cs.worker_id
             LEFT JOIN LATERAL ( SELECT max(s.sent_on) AS last_sent_on
                   FROM analytics.job_stage s
                  WHERE s.job_id = j.id) ps ON true
             LEFT JOIN LATERAL ( SELECT max(e.recorded_at) AS last_event_at,
                    max(e.recorded_at) FILTER (WHERE e.channel = 'worker_qr'::text) AS last_scan_at
                   FROM analytics.job_event e
                  WHERE e.job_id = j.id) ev ON true
             LEFT JOIN LATERAL ( SELECT count(*)::integer AS stage_count,
                    count(*) FILTER (WHERE s.status = ANY (ARRAY['sent'::text, 'skipped'::text]))::integer AS stage_done_count,
                    COALESCE(bool_or(s.auto_closed), false) AS has_auto_closed
                   FROM analytics.job_stage s
                  WHERE s.job_id = j.id) st ON true
             LEFT JOIN LATERAL ( SELECT q.id,
                    q.quote_no
                   FROM analytics.oem_quote q
                  WHERE j.source_kind = 'oem'::text AND COALESCE(q.root_quote_id, q.id) = j.root_quote_id
                  ORDER BY (q.status = 'superseded'::text), q.created_at DESC
                 LIMIT 1) aq ON true
             LEFT JOIN LATERAL ( SELECT COALESCE(v.paid_thb, 0::numeric) AS paid
                   FROM analytics.v_oem_quote v
                  WHERE v.id = aq.id) pay ON true
             LEFT JOIN LATERAL ( SELECT i.qty
                   FROM analytics.oem_quote_item i
                  WHERE i.quote_id = aq.id AND i.seq = j.oem_item_seq) aqi ON true
             LEFT JOIN analytics.production_order_item poi ON poi.id = j.production_order_item_id
             LEFT JOIN analytics.production_order po ON po.id = poi.production_order_id
             LEFT JOIN LATERAL ( SELECT max(abs(l.handoff_gap_g)) AS handoff_gap_g
                   FROM analytics.v_job_stage_loss l
                  WHERE l.job_id = j.id) hg ON true
             LEFT JOIN LATERAL ( SELECT count(*)::integer AS handoff_mismatch_count
                   FROM analytics.job_event e
                  WHERE e.job_id = j.id AND e.event_type = 'weigh'::text AND (e.payload ->> 'kind'::text) = 'handoff_mismatch'::text) hmc ON true
             LEFT JOIN LATERAL ( SELECT bool_or(s.weigh_required) AS has_weigh,
                    bool_or(d2.metal_present AND NOT d2.gold_weigh_exempt AND NOT s.weigh_required AND s.status <> 'skipped'::text) AS unguarded
                   FROM analytics.job_stage s
                     JOIN analytics.job_stage_def d2 ON d2.shop_id = s.shop_id AND d2.code = s.stage_code
                  WHERE s.job_id = j.id) pw ON true) b
     JOIN analytics.job jj ON jj.id = b.id
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE t.status <> 'cancelled'::text)::integer AS parts_count,
            count(*) FILTER (WHERE t.status = ANY (ARRAY['open'::text, 'in_progress'::text, 'on_hold'::text]))::integer AS parts_open,
            COALESCE(( SELECT sum(d.qty) AS sum
                   FROM analytics.job_discrepancy d
                  WHERE d.root_job_id = jj.id AND d.status = 'open'::text AND NOT (EXISTS ( SELECT 1
                           FROM analytics.job_discrepancy v
                          WHERE v.void_of_id = d.id))), 0::bigint)::integer AS qty_pending_explanation
           FROM analytics.job t
          WHERE jj.parent_job_id IS NULL AND (t.id = jj.id OR t.parent_job_id = jj.id)) lt ON true
     LEFT JOIN LATERAL ( SELECT max(abs(l.handoff_gap_partial_g)) AS gap
           FROM analytics.v_job_stage_loss l
          WHERE l.job_id = jj.id) hgp ON true
     LEFT JOIN LATERAL ( SELECT max(abs(l.handoff_gap_g)) AS gap
           FROM analytics.v_job_stage_loss l
             JOIN analytics.job t ON t.id = l.job_id
          WHERE t.id = jj.id OR t.parent_job_id = jj.id) tg ON true
     LEFT JOIN LATERAL ( SELECT max(abs(l.handoff_gap_partial_g)) AS gap
           FROM analytics.v_job_stage_loss l
             JOIN analytics.job t ON t.id = l.job_id
          WHERE t.id = jj.id OR t.parent_job_id = jj.id) tgp ON true
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS n
           FROM analytics.job_event e
             JOIN analytics.job t ON t.id = e.job_id
          WHERE (t.id = jj.id OR t.parent_job_id = jj.id) AND e.event_type = 'weigh'::text AND (e.payload ->> 'kind'::text) = 'handoff_mismatch'::text) tmc ON true
     LEFT JOIN LATERAL ( SELECT sum(analytics.job_disc_excess_g(d.weight_gap_g, d.weight_sent_g, d.qty, d.qty_sent)) AS v
           FROM analytics.job_discrepancy d
          WHERE d.root_job_id = COALESCE(jj.parent_job_id, jj.id) AND (d.job_id IN ( SELECT t.id
                   FROM analytics.job t
                  WHERE t.id = jj.id OR t.parent_job_id = jj.id)) AND (d.status = ANY (ARRAY['open'::text, 'resolved'::text])) AND NOT (EXISTS ( SELECT 1
                   FROM analytics.job_discrepancy v
                  WHERE v.void_of_id = d.id))) tex ON true
     LEFT JOIN LATERAL ( SELECT min(g.s) AS v
           FROM ( SELECT sum(l.handoff_gap_g) AS s
                   FROM analytics.job t
                     JOIN analytics.job_stage ls ON ls.job_id = t.id AND ls.split_from_stage_id IS NOT NULL
                     JOIN analytics.job_stage nx ON nx.job_id = t.id AND nx.seq = (( SELECT min(n.seq) AS min
                           FROM analytics.job_stage n
                          WHERE n.job_id = t.id AND n.seq > ls.seq AND n.status <> 'skipped'::text))
                     JOIN analytics.v_job_stage_loss l ON l.job_stage_id = nx.id
                  WHERE jj.parent_job_id IS NULL AND t.parent_job_id = jj.id AND l.handoff_gap_g IS NOT NULL
                  GROUP BY ls.split_from_stage_id) g) tlg ON true;

-- ============================================================================
-- 5. job_stage_suggest / job_record_profile_list — เพิ่ม key gold_weigh_exempt (additive) · security definer เดิม · สิทธิ์ service_role เดิม
-- ============================================================================
CREATE OR REPLACE FUNCTION analytics.job_stage_suggest(p_shop_id uuid, p_source_kind text, p_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $function$
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
                                                 'metal_present', d.metal_present, 'gold_weigh_exempt', d.gold_weigh_exempt)
                              order by d.seq_default), '[]'::jsonb)
      from analytics.job_stage_def d where d.shop_id = p_shop_id and d.is_active),
    'profiles', (select coalesce(jsonb_agg(analytics.job_profile_json(p.id) order by p.seq, p.name), '[]'::jsonb)
                   from analytics.job_record_profile p where p.shop_id = p_shop_id and p.is_active),
    'default_profile_id', analytics.job_profile_default_for(p_shop_id, v_info ->> 'metal'));
end;
$function$
;
revoke execute on function analytics.job_stage_suggest(uuid, text, uuid) from public, anon, authenticated;
grant execute on function analytics.job_stage_suggest(uuid, text, uuid) to service_role;

CREATE OR REPLACE FUNCTION analytics.job_record_profile_list(p_shop_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $function$
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
                                                               'metal_present', d.metal_present, 'is_active', d.is_active, 'gold_weigh_exempt', d.gold_weigh_exempt)
                                             order by d.seq_default), '[]'::jsonb)
                     from analytics.job_stage_def d where d.shop_id = p_shop_id));
end;
$function$
;
revoke execute on function analytics.job_record_profile_list(uuid) from public, anon, authenticated;
grant execute on function analytics.job_record_profile_list(uuid) to service_role;

-- ============================================================================
-- 6. job_record_profile_ensure — seed แบบทองร้านใหม่: weigh = metal_present ∧ ¬exempt + ชื่อ/note ใหม่ · ไม่มีใครถือ EXECUTE (เหมือนเดิม)
-- ============================================================================
CREATE OR REPLACE FUNCTION analytics.job_record_profile_ensure(p_shop_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $function$
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
  values (p_shop_id, 'ทอง — ชั่งทุกขั้นที่มีโลหะ (ยกเว้นขัด) + ชั่งสุทธิตอนปิด', 'ค่าเริ่มงานทอง — ชั่งเข้า-ออกทุกขั้นที่โลหะอยู่ในมือ ยกเว้นขั้นขัด (มติเจ้าของ 27 ต.ค. 69) และต้องชั่งน้ำหนักสุทธิตอนปิดงาน', 30, true, true)
  returning id into v_p3;
  insert into analytics.job_record_profile_stage (profile_id, shop_id, stage_code, weigh, scrap_qty, scrap_weight)
  select v_p3, d.shop_id, d.code, d.metal_present and not d.gold_weigh_exempt, true, false
    from analytics.job_stage_def d where d.shop_id = p_shop_id;
end;
$function$
;
revoke execute on function analytics.job_record_profile_ensure(uuid) from public, anon, authenticated;

-- ============================================================================
-- 7. job_lot_cancel_core (M2) — ของเสียทองต้องมีน้ำหนักเสมอเมื่อส่วนถือโลหะ (ลอกสดจาก DB · แก้ v_wreq + เพดานน้ำหนัก) · ไม่มีใครถือ EXECUTE (เหมือนเดิม)
-- ============================================================================
CREATE OR REPLACE FUNCTION analytics.job_lot_cancel_core(p_lot_job_id uuid, p_disposition text, p_reason text, p_scrap_reason text, p_scrap_weight numeric, p_worker_id uuid, p_channel text, p_actor uuid, p_device_hint text, p_enforce_splitter boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $function$
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
  -- 0195 M2: ของเสียทองที่ออกจากระบบต้องมีน้ำหนักเสมอ ไม่ผูกกับ weigh_required ของขั้น (ขัดไม่ชั่ง ⇒ ไม่มีน้ำหนักให้เทียบ แต่ทองยังอยู่ในมือ) —
  -- บังคับเมื่อส่วนนี้ถือโลหะแล้ว (มีขั้น received/sent ที่ metal_present) · ส่วนที่แยกก่อนถึงขั้นมีโลหะ (ขั้นเทียน) ไม่มีทองให้ชั่ง ยกเลิกเป็นของเสียโดยไม่ชั่งได้ (M-D เดิม)
  v_wreq := p_disposition = 'scrap' and v_l.metal = 'gold'
            and exists (select 1 from analytics.job_stage x join analytics.job_stage_def d on d.shop_id = x.shop_id and d.code = x.stage_code
                         where x.job_id = p_lot_job_id and x.status in ('received', 'sent') and d.metal_present);
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
    -- 0195 M2: ส่วนที่ไม่เคยชั่ง (ขัดไม่ชั่ง) ไม่มีน้ำหนักของตัวเอง — เพดานใช้น้ำหนักสูงสุดของใบแม่ · ไม่มีน้ำหนักเลยทั้งต้นไม้ = ไม่มีเพดาน (ยังบังคับ > 0 และ ≤ 100,000 ด้านบน)
    if coalesce(v_wbasis, 0) = 0 then
      select max(greatest(coalesce(x.weight_in_g + x.metal_added_g, 0), coalesce(x.weight_out_g, 0))) into v_wbasis
        from analytics.job_stage x where x.job_id = v_l.parent_job_id;
    end if;
    if coalesce(v_wbasis, 0) > 0 and p_scrap_weight > v_wbasis then
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
$function$
;
revoke execute on function analytics.job_lot_cancel_core(uuid, text, text, text, numeric, uuid, text, uuid, text, boolean) from public, anon, authenticated;

-- ============================================================================
-- 8. แบบทองปริยาย: buff ไม่ชั่ง + rename (UPDATE แคบ — trigger บน job_record_profile_stage = _stage_guard (ตรวจ metal_present/ค่าที่ติ๊ก) · บน job_record_profile = _guard (ตั้ง updated_at ตอนแก้จริง) ·
--    ข้อ 19: where ตรงเฉพาะแถวที่ค่าเปลี่ยนจริง ⇒ รันซ้ำไม่แตะ · ไม่ UPDATE แถวแบบเงิน/แบบที่ผู้ใช้ตั้งเอง)
-- ============================================================================
update analytics.job_record_profile_stage ps
   set weigh = false
  from analytics.job_record_profile p
 where p.id = ps.profile_id and p.is_default_gold and ps.stage_code = 'buff' and ps.weigh;

update analytics.job_record_profile
   set name = 'ทอง — ชั่งทุกขั้นที่มีโลหะ (ยกเว้นขัด) + ชั่งสุทธิตอนปิด',
       note = 'ค่าเริ่มงานทอง — ชั่งเข้า-ออกทุกขั้นที่โลหะอยู่ในมือ ยกเว้นขั้นขัด (มติเจ้าของ 27 ต.ค. 69) และต้องชั่งน้ำหนักสุทธิตอนปิดงาน'
 where is_default_gold and name = 'ทอง — ชั่งทุกขั้นที่มีโลหะ + ชั่งสุทธิตอนปิด';

-- ============================================================================
-- 9. ด่านหลังทำ — ผิดข้อไหน raise ถอยทั้งก้อน
-- ============================================================================
do $chk195$
declare
  v_n    int;
  v_bad  text;
  v_cols text;
  v_ro   text;
  v_acl  text;
begin
  -- คอลัมน์ใหม่: true เฉพาะ buff · ทุกร้านที่มี buff เป็น true · แถวอื่นของทะเบียนเท่าเดิมทุกคอลัมน์
  select count(*) into v_n from analytics.job_stage_def d where d.gold_weigh_exempt and d.code <> 'buff';
  if v_n > 0 then raise exception '0195: มีขั้นอื่นนอกจาก buff ที่ gold_weigh_exempt = true (% แถว)', v_n; end if;
  select count(*) into v_n from analytics.job_stage_def d where d.code = 'buff' and not d.gold_weigh_exempt;
  if v_n > 0 then raise exception '0195: มี % ร้านที่ buff ไม่เป็น gold_weigh_exempt', v_n; end if;
  select count(*) into v_n
    from _j195_def_base b join analytics.job_stage_def a on a.shop_id = b.shop_id and a.code = b.code
   where (to_jsonb(a) - 'gold_weigh_exempt') is distinct from (to_jsonb(b) - 'gold_weigh_exempt');
  if v_n > 0 or (select count(*) from analytics.job_stage_def) <> (select count(*) from _j195_def_base) then
    raise exception '0195: ทะเบียนขั้นขยับนอกจากคอลัมน์ใหม่ (% แถว) หรือจำนวนแถวเปลี่ยน', v_n;
  end if;

  -- แบบบันทึก: เปลี่ยนเฉพาะ (แบบทองปริยาย · buff · weigh true -> false) · ตารางแบบ: เปลี่ยนเฉพาะ name/note/updated_at ของแบบทองปริยายที่ rename
  select count(*) into v_n
    from _j195_ps_base b join analytics.job_record_profile_stage a on a.profile_id = b.profile_id and a.stage_code = b.stage_code
    join analytics.job_record_profile p on p.id = a.profile_id
   where case when p.is_default_gold and b.stage_code = 'buff' and b.weigh
              then not (a.weigh = false) or (to_jsonb(a) - 'weigh' - 'updated_at') is distinct from (to_jsonb(b) - 'weigh' - 'updated_at')
              else to_jsonb(a) is distinct from to_jsonb(b) end;
  if v_n > 0 or (select count(*) from analytics.job_record_profile_stage) <> (select count(*) from _j195_ps_base) then
    raise exception '0195: job_record_profile_stage ขยับนอกเงื่อนไข (% แถว) หรือจำนวนแถวเปลี่ยน', v_n;
  end if;
  if exists (select 1 from analytics.job_record_profile_stage a join analytics.job_record_profile p on p.id = a.profile_id
              where p.is_default_gold and a.stage_code = 'buff' and a.weigh) then
    raise exception '0195: แบบทองปริยายยังมี buff ที่ชั่งอยู่';
  end if;
  select count(*) into v_n
    from _j195_prof_base b join analytics.job_record_profile a on a.id = b.id
   where case when a.is_default_gold and b.name = 'ทอง — ชั่งทุกขั้นที่มีโลหะ + ชั่งสุทธิตอนปิด'
              then (to_jsonb(a) - 'name' - 'note' - 'updated_at') is distinct from (to_jsonb(b) - 'name' - 'note' - 'updated_at')
                   or a.name <> 'ทอง — ชั่งทุกขั้นที่มีโลหะ (ยกเว้นขัด) + ชั่งสุทธิตอนปิด'
              else to_jsonb(a) is distinct from to_jsonb(b) end;
  if v_n > 0 or (select count(*) from analytics.job_record_profile) <> (select count(*) from _j195_prof_base) then
    raise exception '0195: job_record_profile ขยับนอกเงื่อนไข (% แถว) หรือจำนวนแถวเปลี่ยน', v_n;
  end if;

  -- ใบงานทุกใบไม่ขยับ (job · job_stage · job_event)
  select string_agg(b.t, ', ') into v_bad
    from _j195_job_base b
    join (select 'job'::text as t, count(*) as n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as h from analytics.job x
          union all select 'job_stage', count(*), coalesce(md5(string_agg(x::text, '|' order by x::text)), '') from analytics.job_stage x
          union all select 'job_event', count(*), coalesce(md5(string_agg(x::text, '|' order by x::text)), '') from analytics.job_event x) a
      on a.t = b.t and (a.n, a.h) is distinct from (b.n, b.h);
  if v_bad is not null then
    raise exception '0195: ตารางใบงานขยับระหว่าง migration: % (ต้องไม่แตะใบที่สร้างแล้ว)', v_bad;
  end if;

  -- ฟังก์ชัน: ไม่มี overload · สิทธิ์ 5 ตัวที่แก้เท่าเดิมเป๊ะ · ตัวอื่นทั้งสคีมา (นิยาม + สิทธิ์) เท่าเดิม · จำนวนเท่าเดิม
  if (select count(*) from pg_proc p where p.pronamespace = 'analytics'::regnamespace
         and p.proname in ('job_stage_def_ensure', 'job_profile_state', 'job_stage_suggest', 'job_record_profile_list', 'job_record_profile_ensure', 'job_lot_cancel_core')) <> 6 then
    raise exception '0195: ฟังก์ชันที่แก้ต้องมีอย่างละ 1 signature (overload หลุด?)';
  end if;
  if exists (select 1 from _j195_acl_base b join pg_proc p on p.oid::regprocedure::text = b.sig where coalesce(p.proacl::text, 'NULL') <> b.acl)
     or (select count(*) from _j195_acl_base) <> 6 then
    raise exception '0195: proacl ของฟังก์ชันที่แก้เปลี่ยนไปจากก่อนรัน';
  end if;
  select count(*) into v_n
    from _j195_fn_base b join pg_proc p on p.pronamespace = 'analytics'::regnamespace and p.oid::regprocedure::text = b.sig
   where md5(replace(pg_get_functiondef(p.oid), E'\r', '')) = b.h and coalesce(p.proacl::text, 'NULL') = b.acl;
  if v_n <> (select count(*) from _j195_fn_base)
     or (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace and prokind in ('f', 'p')) <> (select count(*) from _j195_fn_base) + 6 then
    raise exception '0195: ฟังก์ชันอื่นในสคีมา analytics ขยับ (ตรง % จาก %) หรือจำนวนฟังก์ชันเปลี่ยน', v_n, (select count(*) from _j195_fn_base);
  end if;
  -- ฟังก์ชันที่แก้ต้องมีนิยามใหม่จริง
  if (select prosrc from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'job_profile_state') !~ 'not d\.gold_weigh_exempt'
     or (select prosrc from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'job_record_profile_ensure') !~ 'not d\.gold_weigh_exempt'
     or (select prosrc from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'job_stage_suggest') !~ 'gold_weigh_exempt'
     or (select prosrc from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'job_record_profile_list') !~ 'gold_weigh_exempt'
     or (select prosrc from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'job_stage_def_ensure') !~ 'gold_exempt'
     or (select prosrc from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'job_lot_cancel_core') !~ 'd\.metal_present' then
    raise exception '0195: นิยามฟังก์ชันที่แก้ไม่มี gold_weigh_exempt ครบ';
  end if;

  -- v_job_board: คอลัมน์ 56 ตัวลำดับเดิมเป๊ะ · สิทธิ์/reloptions เท่าเดิม · นิพจน์ใหม่ + ไม่มีนิพจน์เก่าค้าง
  select (select string_agg(a.ordinal_position || ':' || a.column_name, ',' order by a.ordinal_position) from information_schema.columns a where a.table_schema = 'analytics' and a.table_name = 'v_job_board'),
         c.reloptions::text, c.relacl::text into v_cols, v_ro, v_acl
    from pg_class c where c.relnamespace = 'analytics'::regnamespace and c.relname = 'v_job_board';
  if exists (select 1 from _j195_view_base b where b.cols is distinct from v_cols or b.ro is distinct from v_ro or b.acl is distinct from v_acl) then
    raise exception '0195: v_job_board เปลี่ยนคอลัมน์/สิทธิ์/reloptions (ต้องเท่าเดิม) — cols %', v_cols;
  end if;
  if position('NOT d2.gold_weigh_exempt AND NOT s.weigh_required' in pg_get_viewdef('analytics.v_job_board'::regclass, true)) = 0 then
    raise exception '0195: v_job_board ไม่มีนิพจน์ gold_weigh_exempt';
  end if;
  raise notice '0195: ทะเบียน/แบบ/ฟังก์ชัน/วิว/ใบงานผ่านด่านหลังทำครบ';
end;
$chk195$;
