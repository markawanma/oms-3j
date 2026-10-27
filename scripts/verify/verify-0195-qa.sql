set local lock_timeout = '8s';
set local statement_timeout = '20min';
-- scripts/verify/verify-0195-qa.sql  (QA R2-D2 27 ต.ค. 69 · เติมช่องที่ verify-0195.sql ไม่ครอบ)
-- 🔴 ยังไม่เคยรันจริง (ต้องมี 0194 + 0195 — 0195 เพิ่มคอลัมน์ ⇒ ห้ามรันกลางวัน) · ผ่านการตรวจด้วยตา + helper ลอกจาก verify-0195.sql ที่ Han ส่งมา — ถ้า FAIL ให้ดูก่อนว่าเป็นสมมติฐานของไฟล์นี้ผิดหรือบั๊กจริง (ระบุสมมติฐานไว้ที่แต่ละเคส)
-- รันหลัง apply 0194 + 0195:  node scripts/run-sql.mjs scripts/verify/verify-0195-qa.sql   (หรือ dry-run: ต่อ 0194 (ตัด PART B ถ้ากลางวัน) + 0195 + ไฟล์นี้)
-- self-rolling-back (3j-migration-traps ข้อ 11) · ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน · [SKIP] ไม่นับเป็นผ่าน
-- ข้อมูลทดสอบสร้างผ่าน RPC ของระบบ · ข้อยกเว้นที่บอกตรงๆ (ในทรานแซกชันที่ถอยกลับ): ใบเสนอราคา OEM = โคลนจากรายการจริงด้วย INSERT (เหมือน verify-0195)
-- 🔴 สร้างใบทดสอบ ~5 ใบ — ล็อกแถว job_counter ช่วงรัน (สั้น)
--
-- ============ ช่องที่ verify-0195 ไม่ครอบ -> เทสต์ในไฟล์นี้ ============
--  X1  ขั้นที่ข้าม (skipped) ไม่นับเป็น gold_unguarded — ทั้ง job_profile_state และ v_job_board (นิพจน์ `status <> 'skipped'` ของ 0195 ไม่มีเทสต์ใน verify-0195)
--  X2  exempt ไม่ลดด่าน "ระดับรับ/ส่ง" ของขั้นข้างเคียง: แบบทองปริยาย — gem_set รับไม่ชั่ง = weight_required · gem_set ต่างจาก finish > 0.05 = handoff_mismatch ·
--      หลังข้ามขัดที่ไม่ชั่ง plating รับไม่ชั่ง = weight_required (verify-0195 ตรวจเฉพาะ "ป้าย" และ "รับ plating ได้เมื่อชั่ง" ไม่ได้ตรวจว่ายังบังคับเมื่อลืมชั่ง)
--  X3  ร้านจริง: แบบทองปริยายถูก rename (หรือชื่อตั้งเอง = SKIP) · ไม่มีแบบอื่นถูก rename ตาม (ตรวจ "ชื่อ" — verify-0195 D5 ตรวจเฉพาะ weigh)
--  X4  ใบทองแยกส่วนที่ขั้นขัด (ไม่ชั่ง): แยกได้โดยไม่ต้องชั่งน้ำหนักส่วนที่แยก · ส่วนใหม่ gold_unguarded=false · ลำดับขั้นเท่าใบแม่
--  MU-X1 mutant: v_job_board ถอด `AND s.status <> 'skipped'` -> X1 ต้องล้ม
--  MU-X2 mutant: job_profile_state ถอด `and s.status <> 'skipped'` -> X1 ต้องล้ม
--
--  สมมติฐานที่ไฟล์นี้พึ่ง (ถ้าผิด เคสนั้นจะ FAIL ผิดจุด): แบบทองปริยายของร้านจริงชั่ง cast/cut_sprue/finish/gem_set/plating/qc/pack (E1 ของ verify-0195 สมมติเหมือนกัน) ·
--    job_stage_skip ข้าม gem_set ได้ตอนใบ open และยังไม่มีขั้นไหนรับ · job_lot_split ที่ขั้นไม่ชั่งของใบทองไม่ต้องส่ง p_weight_move_g (v_gold_w = ทอง ∧ stage.weigh_required)
--  ❌ ไม่มีเทสต์ครอบ: migration รัน 2 รอบ (ในทรานแซกชันเดียวทำไม่ได้ — temp table ชื่อซ้ำ) → หลัง apply จริงให้ dry-run ไฟล์ 0195 ซ้ำอีกรอบ (pre-check ต้องรับ md5 ฉบับใหม่) ·
--    ช่องทางช่างมือถือ (job_worker_receive) ของใบทองขั้นขัด · race 2 connection · ผลต่อใบทองเปิดจริง (ตอนนี้ 0 ใบ)

-- ===== helper (ลอกจาก verify-0183 แล้วตัดเฉพาะที่ใช้ · ชุดขั้นมาตรฐาน = finish + buff) =====
create function pg_temp.chk(p_id text, p_desc text, p_ok boolean) returns text
 language sql as $c$
  select format('[%s] %s  %s', case when coalesce(p_ok, false) then 'OK' else 'FAIL' end, p_id, p_desc) || E'\n'
$c$;
create function pg_temp.q(p_sql text) returns jsonb
 language plpgsql as $c$
declare
  v jsonb; v_msg text; v_state text; v_hint text;
begin
  execute p_sql into v;
  return coalesce(v, '{}'::jsonb);
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
  return jsonb_build_object('_err', v_msg, '_state', v_state, '_hint', v_hint);
end;
$c$;
create function pg_temp.x(p_sql text) returns text
 language plpgsql as $c$
declare v_msg text; v_state text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  return 'ERR:' || v_state || ':' || v_msg;
end;
$c$;
create function pg_temp.act() returns uuid language sql as $c$ select '00000000-0000-0000-0000-0000000000a1'::uuid $c$;
create function pg_temp.std() returns text[] language sql as $c$
  select array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'finish', 'buff', 'qc', 'pack'] $c$;
create function pg_temp.std_polish() returns text[] language sql as $c$
  select array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'polish', 'qc', 'pack'] $c$;
-- สำเร็จ = ไม่มี _err และไม่ใช่ {ok:false}
create function pg_temp.okr(r jsonb) returns boolean language sql as $c$
  select not (r ? '_err') and (r ->> 'ok') is distinct from 'false' $c$;
create function pg_temp.codeof(r jsonb) returns text language sql as $c$ select coalesce(r ->> 'code', r ->> '_hint', r ->> '_err') $c$;
create function pg_temp.rej(r jsonb, p_hint text) returns boolean language sql as $c$
  select coalesce(r ? '_err' and r ->> '_state' = '22023' and (p_hint is null or r ->> '_hint' = p_hint), false) $c$;
create function pg_temp.o_recv(p_shop uuid, p_job uuid, p_seq int, p_on date, p_w numeric default null,
                               p_worker uuid default null, p_name text default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_office_receive(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_occurred_on=>%L,
      p_weight_in_g=>%L, p_worker_id=>%L, p_assignee_name=>%L, p_actor=>%L)',
      p_shop, p_job, p_seq, p_on, p_w, p_worker, p_name, pg_temp.act())) $c$;
create function pg_temp.o_send(p_shop uuid, p_job uuid, p_seq int, p_on date, p_w numeric default null, p_scrap int default 0,
                               p_reason text default null, p_added numeric default 0, p_note text default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_office_send(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_occurred_on=>%L,
      p_weight_out_g=>%L, p_qty_scrap=>%L, p_scrap_reason=>%L, p_metal_added_g=>%L, p_weight_note=>%L, p_actor=>%L)',
      p_shop, p_job, p_seq, p_on, p_w, p_scrap, p_reason, p_added, p_note, pg_temp.act())) $c$;
create function pg_temp.login(p_tokh text, p_worker uuid, p_pin text) returns jsonb
 language plpgsql as $c$
declare r jsonb;
begin
  r := pg_temp.q(format('select analytics.worker_pin_verify(%L, %L, %L, %L, %L)', p_tokh, p_worker, p_pin, 'verify-ua/1.0', null));
  if (r ->> 'ok') = 'true' then
    r := r || jsonb_build_object('session_hash', analytics.job_sha256_hex(r ->> 'session_token'));
  end if;
  return r;
end;
$c$;
create function pg_temp.tok(p_shop uuid, p_job uuid, p_revoke boolean default true) returns jsonb
 language plpgsql as $c$
declare r jsonb;
begin
  r := pg_temp.q(format('select analytics.job_token_issue(%L, %L, %L, %L)', p_shop, p_job, p_revoke, pg_temp.act()));
  if r ? 'token' then
    r := r || jsonb_build_object('hash', analytics.job_sha256_hex(r ->> 'token'));
  end if;
  return r;
end;
$c$;
-- โคลนรายการใบเสนอราคา OEM จากรายการจริง (status won) + merge input เพิ่ม
create function pg_temp.clone_deal(p_tpl_item uuid, p_metal text, p_qty int, p_new_design boolean default false, p_extra jsonb default '{}'::jsonb) returns jsonb
 language plpgsql as $c$
declare
  v_q   uuid := gen_random_uuid();
  v_i   uuid := gen_random_uuid();
  v_item  analytics.oem_quote_item;
  v_quote analytics.oem_quote;
  v_input jsonb;
begin
  select * into v_item from analytics.oem_quote_item where id = p_tpl_item;
  select * into v_quote from analytics.oem_quote where id = v_item.quote_id;
  v_input := v_item.input || jsonb_build_object('metal', p_metal, 'is_new_design', p_new_design) || coalesce(p_extra, '{}'::jsonb);
  insert into analytics.oem_quote
    select (jsonb_populate_record(null::analytics.oem_quote,
      to_jsonb(v_quote) || jsonb_build_object('id', v_q, 'quote_no', 'V194-' || substr(v_q::text, 1, 8), 'status', 'won',
        'root_quote_id', v_q, 'parent_quote_id', null))).*;
  insert into analytics.oem_quote_item
    select (jsonb_populate_record(null::analytics.oem_quote_item,
      to_jsonb(v_item) || jsonb_build_object('id', v_i, 'quote_id', v_q, 'seq', 1, 'input', v_input, 'qty', p_qty))).*;
  return jsonb_build_object('quote_id', v_q, 'item_id', v_i);
end;
$c$;
create function pg_temp.jid(r jsonb) returns uuid language sql as $c$ select (r ->> 'job_id')::uuid $c$;
create function pg_temp.pid(p_shop uuid, p_kind text) returns uuid language sql as $c$
  select id from analytics.job_record_profile where shop_id = p_shop
     and case p_kind when 'def' then is_default when 'gold' then is_default_gold when 'none' then name like 'ไม่ชั่ง%' end limit 1 $c$;
create function pg_temp.pu(p_shop uuid, p_id uuid, p_name text, p_note text, p_stages text) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_record_profile_upsert(p_shop_id=>%L, p_id=>%L, p_name=>%L, p_note=>%L, p_stages=>%L::jsonb, p_actor=>%L)',
    p_shop, p_id, p_name, p_note, p_stages, pg_temp.act())) $c$;
create function pg_temp.jcp(p_shop uuid, p_item uuid, p_codes text[], p_profile uuid) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_create_from_quote_item(p_shop_id=>%L, p_quote_item_id=>%L, p_stage_codes=>%L::text[], p_start_gate_note=>%L, p_design_label=>%L, p_actor=>%L, p_profile_id=>%L)',
    p_shop, p_item, coalesce(p_codes, pg_temp.std()), 'verify: เริ่มผลิตก่อนมัดจำ', 'v194-ชื่อเรียกภายใน', pg_temp.act(), p_profile)) $c$;
create function pg_temp.mkp(p_shop uuid, p_tpl uuid, p_metal text, p_profile uuid default null, p_codes text[] default null, p_qty int default 10, p_extra jsonb default '{}'::jsonb) returns jsonb
 language plpgsql as $c$
declare d jsonb;
begin
  d := pg_temp.clone_deal(p_tpl, p_metal, p_qty, false, p_extra);
  return d || pg_temp.jcp(p_shop, (d ->> 'item_id')::uuid, p_codes, p_profile);
end;
$c$;
-- เดินใบ (office) ขั้น 1..p_to รับ+ส่งทีละขั้น (ขั้นที่ถูกรับค้างอยู่ก็ส่งต่อ)
create function pg_temp.rw(p_shop uuid, p_job uuid, p_w numeric, p_to int default 9) returns jsonb language plpgsql as $c$
declare s int; r jsonb; v_st text; v_today date := analytics.job_today();
begin
  for s in 1 .. p_to loop
    select status into v_st from analytics.job_stage where job_id = p_job and seq = s;
    if v_st = 'pending' then
      r := pg_temp.o_recv(p_shop, p_job, s, v_today, p_w, null, 'verify');
      if not pg_temp.okr(r) then return jsonb_build_object('_err', 'recv', '_at', s, 'r', r); end if;
      v_st := 'received';
    end if;
    if v_st = 'received' then
      r := pg_temp.o_send(p_shop, p_job, s, v_today, p_w);
      if not pg_temp.okr(r) then return jsonb_build_object('_err', 'send', '_at', s, 'r', r); end if;
    end if;
  end loop;
  return jsonb_build_object('ok', true);
end;
$c$;
create function pg_temp.wu(p_shop uuid, p_name text, p_codes text, p_pin text) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.worker_upsert(p_shop_id=>%L, p_display_name=>%L, p_stage_codes=>%L::text[], p_pin=>%L, p_actor=>%L)',
    p_shop, p_name, '{' || p_codes || '}', p_pin, pg_temp.act())) $c$;
create function pg_temp.newtok(p_shop uuid, p_job uuid) returns text language sql as $c$ select pg_temp.tok(p_shop, p_job) ->> 'hash' $c$;
create function pg_temp.sess(p_tokh text, p_worker uuid, p_pin text) returns text
 language sql as $c$ select pg_temp.login(p_tokh, p_worker, p_pin) ->> 'session_hash' $c$;
create function pg_temp.ws(p_tokh text, p_sesh text, p_seq int, p_wout numeric default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_worker_send(p_token_hash=>%L, p_session_hash=>%L, p_expected_seq=>%L, p_weight_out_g=>%L, p_user_agent=>%L)',
    p_tokh, p_sesh, p_seq, p_wout, 'verify-ua/1.0')) $c$;
create function pg_temp.wr(p_tokh text, p_sesh text, p_seq int, p_w numeric default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_worker_receive(p_token_hash=>%L, p_session_hash=>%L, p_expected_seq=>%L, p_weight_in_g=>%L, p_user_agent=>%L)',
    p_tokh, p_sesh, p_seq, p_w, 'verify-ua/1.0')) $c$;
create function pg_temp.sv(p_job uuid, p_seq int, p_col text) returns text language plpgsql as $c$
declare v text;
begin
  execute format('select %I::text from analytics.job_stage where job_id = %L and seq = %s', p_col, p_job, p_seq) into v;
  return v;
end;
$c$;
create function pg_temp.stages_of(p_job uuid) returns text language sql as $c$
  select coalesce(string_agg(stage_code, ',' order by seq), '') from analytics.job_stage where job_id = p_job $c$;
create function pg_temp.flags_of(p_job uuid) returns text language sql as $c$
  select coalesce(string_agg(stage_code || ':' || case when weigh_required then 'w' else '-' end || case when scrap_qty_ask then 'q' else '-' end, ',' order by seq), '') from analytics.job_stage where job_id = p_job $c$;
create function pg_temp.o_done(p_shop uuid, p_job uuid, p_good int, p_scrap int, p_w numeric default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_done(p_shop_id=>%L, p_job_id=>%L, p_qty_good=>%L, p_qty_scrap=>%L, p_weight_final_g=>%L, p_actor=>%L)', p_shop, p_job, p_good, p_scrap, p_w, pg_temp.act())) $c$;
create function pg_temp.o_split(p_shop uuid, p_job uuid, p_seq int, p_qty int) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_lot_split(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_qty=>%L, p_qty_scrap=>%L, p_scrap_reason=>%L, p_qty_hold=>%L, p_actor=>%L, p_weight_move_g=>%L)',
    p_shop, p_job, p_seq, p_qty, 0, null,
    (select s.qty_in - s.qty_scrap - s.qty_split_out from analytics.job_stage s where s.job_id = p_job and s.seq = p_seq), pg_temp.act(), null)) $c$;
create function pg_temp.mutate(p_name text, p_from text, p_to text) returns void
 language plpgsql as $c$
declare v_oid oid; v_def text; v_new text;
begin
  select p.oid into strict v_oid from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = p_name;
  v_def := replace(pg_get_functiondef(v_oid), E'', '');
  v_new := replace(v_def, p_from, p_to);
  if v_new = v_def then
    raise exception 'MUTANT_NOT_APPLIED: % ไม่พบข้อความ [%]', p_name, p_from;
  end if;
  execute v_new;
end;
$c$;
create function pg_temp.snap() returns text
 language plpgsql as $c$
declare v text := ''; r record; n text;
begin
  for r in select unnest(array['job', 'job_stage', 'job_event', 'job_token', 'worker', 'worker_audit', 'worker_session', 'job_counter', 'job_stage_def', 'job_record_profile', 'job_record_profile_stage',
                               'oem_quote', 'oem_quote_item', 'oem_doc_counter', 'production_order', 'production_order_item']) as t loop
    if to_regclass('analytics.' || r.t) is not null then
      execute format('select count(*)::text || ''/'' || coalesce(md5(string_agg(x::text, ''|'' order by x::text)), '''') from analytics.%I x', r.t) into n;
      v := v || r.t || '=' || n || ';';
    end if;
  end loop;
  execute 'select count(*)::text || ''/'' || coalesce(md5(string_agg(x::text, ''|'' order by x::text)), '''') from public.shop x' into n;
  v := v || 'public.shop=' || n || ';';
  return md5(v);
end;
$c$;
-- รันกลุ่มเทสต์แบบกันพัง: กลุ่มที่ raise = FAIL <ชื่อ>-crash (ไม่ทำให้ทั้งชุดตาย) · DML ของกลุ่มนั้นถอยกลับเอง
create function pg_temp.grp(p_name text, p_sql text) returns text
 language plpgsql as $c$
declare v text;
begin
  execute p_sql into v;
  return coalesce(v, '');
exception when others then
  return pg_temp.chk(p_name || '-crash', 'กลุ่มเทสต์ raise: ' || sqlstate || ' ' || sqlerrm, false);
end;
$c$;

-- ===== helper เฉพาะ 0195 (ทุกตัวเป็น plpgsql — อ้างคอลัมน์ใหม่แบบ runtime ได้ แม้ยังไม่ apply 0195) =====
create function pg_temp.gold_codes() returns text[] language sql as $c$
  select array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'finish', 'gem_set', 'buff', 'plating', 'qc', 'pack'] $c$;
-- แบบทองกำหนดเอง: ชั่งทุกขั้นที่มีโลหะ (เปิดใช้งาน) ยกเว้น buff และขั้น p_off (null = ไม่ยกเว้นอะไรเพิ่ม)
create function pg_temp.mkprof_gold(p_shop uuid, p_name text, p_off text, p_with_buff boolean default false) returns uuid
 language plpgsql as $c$
declare v_stages jsonb; r jsonb;
begin
  select jsonb_agg(jsonb_build_object('stage_code', d.code, 'weigh', true, 'scrap_qty', true, 'scrap_weight', false) order by d.seq_default) into v_stages
    from analytics.job_stage_def d where d.shop_id = p_shop and d.metal_present and d.is_active and (p_with_buff or d.code <> 'buff') and d.code is distinct from p_off;
  r := pg_temp.pu(p_shop, null, p_name, null, v_stages::text);
  if r ? '_err' then
    raise exception 'mkprof_gold: %', r::text;
  end if;
  return (r ->> 'id')::uuid;
end;
$c$;
-- ทำวิวเวอร์ชัน mutant: แทนข้อความใน viewdef แล้ว create or replace (ไม่เจอข้อความ = raise)
create function pg_temp.mutate_view(p_name text, p_from text, p_to text) returns void
 language plpgsql as $c$
declare v_def text; v_new text;
begin
  v_def := replace(pg_get_viewdef(('analytics.' || p_name)::regclass, true), E'', '');
  v_new := replace(v_def, p_from, p_to);
  if v_new = v_def then
    raise exception 'MUTANT_NOT_APPLIED: view % ไม่พบข้อความ [%]', p_name, p_from;
  end if;
  execute 'create or replace view analytics.' || p_name || ' with (security_invoker = true) as ' || v_new;
end;
$c$;
create function pg_temp.gu_state(p_job uuid) returns text language plpgsql as $c$
begin
  return analytics.job_profile_state(p_job) ->> 'gold_unguarded';
end;
$c$;
create function pg_temp.gu_board(p_job uuid) returns text language plpgsql as $c$
declare v text;
begin
  execute format('select (to_jsonb(b) ->> %L) from analytics.v_job_board b where b.id = %L', 'gold_unguarded', p_job) into v;
  return v;
end;
$c$;
-- เดินใบ (office) ขั้น 1..p_to : ชั่งน้ำหนัก p_w เฉพาะขั้นที่ weigh_required (ขั้นที่ไม่ชั่งส่งโดยไม่ใส่น้ำหนัก)
create function pg_temp.rwg(p_shop uuid, p_job uuid, p_w numeric, p_to int) returns jsonb language plpgsql as $c$
declare s int; r jsonb; v_st text; v_wr boolean; v_today date := analytics.job_today();
begin
  for s in 1 .. p_to loop
    select status, weigh_required into v_st, v_wr from analytics.job_stage where job_id = p_job and seq = s;
    if v_st = 'pending' then
      r := pg_temp.o_recv(p_shop, p_job, s, v_today, case when v_wr then p_w end, null, 'verify');
      if not pg_temp.okr(r) then return jsonb_build_object('_err', 'recv', '_at', s, 'r', r); end if;
      v_st := 'received';
    end if;
    if v_st = 'received' then
      r := pg_temp.o_send(p_shop, p_job, s, v_today, case when v_wr then p_w end);
      if not pg_temp.okr(r) then return jsonb_build_object('_err', 'send', '_at', s, 'r', r); end if;
    end if;
  end loop;
  return jsonb_build_object('ok', true);
end;
$c$;
create function pg_temp.o_pset(p_shop uuid, p_job uuid, p_profile uuid) returns jsonb language sql as $c$
  select pg_temp.q(format('select analytics.job_profile_set(p_shop_id=>%L, p_job_id=>%L, p_profile_id=>%L, p_actor=>%L)', p_shop, p_job, p_profile, pg_temp.act())) $c$;


-- ===== helper เฉพาะไฟล์ QA =====
create function pg_temp.o_skip(p_shop uuid, p_job uuid, p_code text, p_reason text default 'verify ข้ามขั้น') returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_stage_skip(%L, %L, %L, %L, %L)', p_shop, p_job, p_code, p_reason, pg_temp.act())) $c$;
create function pg_temp.lot(r jsonb) returns uuid language sql as $c$ select (r ->> 'lot_job_id')::uuid $c$;

create function pg_temp.run_x(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare
  v text := ''; pf uuid; d jsonb; j uuid; l uuid; a text; b text; rr jsonb; r jsonb; r1 jsonb; r2 jsonb; r3 jsonb; r4 jsonb; r5 jsonb; r6 jsonb; r7 jsonb; r8 jsonb;
  n text; t text; v_today date := analytics.job_today();
begin
  -- X1 ขั้นที่ข้ามไม่นับ: แบบทองที่ไม่ชั่ง gem_set (ชั่งขั้นอื่นที่มีโลหะ ยกเว้นขัด) -> ติดป้าย · ข้าม gem_set -> ไม่ติด
  pf := pg_temp.mkprof_gold(p_shop, 'v195qa-ทอง-ไม่ชั่งฝังพลอย', 'gem_set');
  d := pg_temp.mkp(p_shop, p_tpl, 'gold', pf, pg_temp.gold_codes(), 10);
  j := pg_temp.jid(d);
  a := coalesce(pg_temp.gu_state(j), '?') || '/' || coalesce(pg_temp.gu_board(j), '?');
  r := pg_temp.o_skip(p_shop, j, 'gem_set');
  b := coalesce(pg_temp.gu_state(j), '?') || '/' || coalesce(pg_temp.gu_board(j), '?');
  v := v || pg_temp.chk('X1', 'ใบทอง: ไม่ชั่ง gem_set -> ติดป้าย (true/true) · ออฟฟิศข้าม gem_set -> ไม่ติด (false/false) ทั้ง state/board — ก่อน ' || a || ' · หลังข้าม ' || b || ' · skip ' || coalesce(pg_temp.codeof(r), 'ok'),
    j is not null and a = 'true/true' and pg_temp.okr(r) and pg_temp.sv(j, 7, 'status') = 'skipped' and b = 'false/false');

  -- X2 exempt ไม่ลดด่านระดับรับ/ส่งของขั้นข้างเคียง (แบบทองปริยายของร้าน)
  d := pg_temp.mkp(p_shop, p_tpl, 'gold', pg_temp.pid(p_shop, 'gold'), pg_temp.gold_codes(), 10);
  j := pg_temp.jid(d);
  rr := pg_temp.rwg(p_shop, j, 10, 6);                                   -- ถึง finish(6) ส่งแล้ว น้ำหนักออก 10
  r1 := pg_temp.o_recv(p_shop, j, 7, v_today, null, null, 'verify');       -- gem_set ไม่ชั่ง
  r2 := pg_temp.o_recv(p_shop, j, 7, v_today, 11, null, 'verify');         -- ต่างจาก finish.out 10 เกิน 0.05
  r3 := pg_temp.o_recv(p_shop, j, 7, v_today, 10, null, 'verify');         -- ตรง
  r4 := pg_temp.o_send(p_shop, j, 7, v_today, 10);
  v := v || pg_temp.chk('X2a', 'exempt ไม่หลุดไป gem_set: รับ gem_set ไม่ชั่ง = weight_required · ชั่ง 11 ต่างจาก finish 10 = handoff_mismatch · ชั่ง 10 รับ+ส่งได้ — '
      || coalesce(pg_temp.codeof(r1), 'ok') || '/' || coalesce(pg_temp.codeof(r2), 'ok') || '/' || coalesce(pg_temp.codeof(r3), 'ok') || '/' || coalesce(pg_temp.codeof(r4), 'ok'),
    j is not null and pg_temp.okr(rr) and pg_temp.codeof(r1) = 'weight_required' and pg_temp.codeof(r2) = 'handoff_mismatch' and pg_temp.okr(r3) and pg_temp.okr(r4) and pg_temp.sv(j, 7, 'status') = 'sent');
  r5 := pg_temp.o_recv(p_shop, j, 8, v_today, null, null, 'verify');       -- buff exempt: รับไม่ชั่งได้
  r6 := pg_temp.o_send(p_shop, j, 8, v_today);
  r7 := pg_temp.o_recv(p_shop, j, 9, v_today, null, null, 'verify');       -- plating ยังบังคับชั่ง
  r8 := pg_temp.o_recv(p_shop, j, 9, v_today, 10, null, 'verify');
  v := v || pg_temp.chk('X2b', 'exempt ไม่หลุดไป plating: buff รับ/ส่งไม่ชั่งได้ · plating รับไม่ชั่ง = weight_required · ชั่งแล้วรับได้ — '
      || coalesce(pg_temp.codeof(r5), 'ok') || '/' || coalesce(pg_temp.codeof(r6), 'ok') || '/' || coalesce(pg_temp.codeof(r7), 'ok') || '/' || coalesce(pg_temp.codeof(r8), 'ok'),
    pg_temp.okr(r5) and pg_temp.okr(r6) and pg_temp.codeof(r7) = 'weight_required' and pg_temp.sv(j, 9, 'status') = 'received' and pg_temp.okr(r8));

  -- X3 ร้านจริง: แบบทองปริยายถูก rename · แบบอื่นไม่ถูก rename ตาม
  select p.name into n from analytics.job_record_profile p where p.shop_id = p_shop and p.is_default_gold limit 1;
  select count(*)::text into t from analytics.job_record_profile p where p.shop_id = p_shop and p.name like '%ยกเว้นขัด%';
  if n is null then
    v := v || '[SKIP] X3  ร้านจริงไม่มีแบบทองปริยาย (ไม่ได้ทดสอบ rename)' || E'\n';
  elsif n = 'ทอง — ชั่งทุกขั้นที่มีโลหะ + ชั่งสุทธิตอนปิด' then
    v := v || pg_temp.chk('X3', 'แบบทองปริยายยังใช้ชื่อเดิม (ไม่ถูก rename) — ชื่อจะโกหกว่า "ชั่งทุกขั้น" ทั้งที่ขัดไม่ชั่งแล้ว', false);
  elsif n = 'ทอง — ชั่งทุกขั้นที่มีโลหะ (ยกเว้นขัด) + ชั่งสุทธิตอนปิด' then
    v := v || pg_temp.chk('X3', 'แบบทองปริยายถูก rename เป็น "(ยกเว้นขัด)" · จำนวนแบบที่ชื่อมี "ยกเว้นขัด" = ' || t || ' (ต้อง 1 — ไม่มีแบบอื่นถูก rename ตาม)', t = '1');
  else
    v := v || '[SKIP] X3  แบบทองปริยายของร้านใช้ชื่อที่เจ้าของตั้งเอง (' || n || ') — migration ไม่ rename (ตามที่ออกแบบ) ไม่ได้ทดสอบ' || E'\n';
  end if;

  -- X4 ใบทองแยกส่วนที่ขั้นขัด (exempt · ไม่ชั่ง): ไม่ต้องส่งน้ำหนักส่วนที่แยก
  d := pg_temp.mkp(p_shop, p_tpl, 'gold', pg_temp.pid(p_shop, 'gold'), pg_temp.gold_codes(), 10);
  j := pg_temp.jid(d);
  rr := pg_temp.rwg(p_shop, j, 10, 7);                                   -- ถึง gem_set(7) ส่งแล้ว
  r1 := pg_temp.o_recv(p_shop, j, 8, v_today, null, null, 'verify');       -- buff รับไม่ชั่ง
  r2 := pg_temp.o_split(p_shop, j, 8, 4);                                  -- แยก 4 ชิ้น (ไม่ส่ง p_weight_move_g)
  l := pg_temp.lot(r2);
  a := case when l is null then '?' else coalesce(pg_temp.gu_state(l), '?') || '/' || coalesce(pg_temp.gu_board(l), '?') end;
  v := v || pg_temp.chk('X4', 'ใบทองแยกส่วนที่ขัด(8 ไม่ชั่ง) สำเร็จโดยไม่ต้องชั่งส่วนที่แยก · ส่วนใหม่ลำดับเท่าใบแม่ · ขัดของส่วนใหม่ไม่ชั่ง plating ชั่ง · gold_unguarded ส่วนใหม่ = false/false — '
      || coalesce(pg_temp.codeof(r1), 'ok') || '/' || coalesce(pg_temp.codeof(r2), 'ok') || ' · ' || a,
    j is not null and pg_temp.okr(rr) and pg_temp.okr(r1) and pg_temp.okr(r2) and l is not null and pg_temp.stages_of(l) = pg_temp.stages_of(j)
    and pg_temp.sv(l, 8, 'weigh_required') = 'false' and pg_temp.sv(l, 9, 'weigh_required') = 'true' and a = 'false/false');
  return v;
end;
$c$;

do $vqa195$
declare
  v_shop uuid; v_tpl uuid; v_log text := ''; v_s text := ''; v_fail int; v_snap0 text; v_hit int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select id into v_shop from public.shop order by created_at limit 1;
  select i.id into v_tpl from analytics.oem_quote_item i join analytics.oem_quote q on q.id = i.quote_id
   where i.shop_id = v_shop and i.input ->> 'metal' = 'silver' and q.quote_no !~ '^V1[0-9]{2}-' order by q.created_at, i.seq limit 1;
  if v_tpl is null then
    raise exception E'[FAIL] S0  ไม่มี oem_quote_item เงินจริงให้ใช้เป็นแม่แบบโคลน\n';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'analytics' and table_name = 'job_stage_def' and column_name = 'gold_weigh_exempt') then
    raise exception E'[FAIL] S0b  ยังไม่มีคอลัมน์ job_stage_def.gold_weigh_exempt — ยังไม่ apply 0195 (ต่อ 0194+0195 ก่อนไฟล์นี้)\n';
  end if;
  if (select seq_default from analytics.job_stage_def where shop_id = v_shop and code = 'buff') is distinct from 105 then
    raise exception E'[FAIL] S0c  buff ไม่ได้อยู่ 105 — ยังไม่ apply 0194\n';
  end if;

  v_snap0 := pg_temp.snap();
  begin
    v_s := pg_temp.grp('X', format('select pg_temp.run_x(%L, %L)', v_shop, v_tpl));
    raise exception 'QA_ROLLBACK';
  exception when others then
    if sqlerrm <> 'QA_ROLLBACK' then
      v_s := coalesce(v_s, '') || pg_temp.chk('S1-crash', 'ชุดหลัก raise นอกกลุ่ม: ' || sqlstate || ' ' || sqlerrm, false);
    end if;
  end;
  v_log := v_log || v_s;
  v_log := v_log || pg_temp.chk('K0', 'ไม่ทิ้งรอย: snapshot job/job_stage/event/token/worker/profile/def/oem_quote/production/shop เท่าเดิมหลังถอยกลับ', pg_temp.snap() = v_snap0);

  -- MU-X1: v_job_board ถอด "AND s.status <> 'skipped'" ใน subquery pw -> X1 (หลังข้าม) ต้องล้ม
  v_s := '';
  begin
    perform pg_temp.mutate_view('v_job_board', 'NOT s.weigh_required AND s.status <> ''skipped''::text', 'NOT s.weigh_required');
    v_s := pg_temp.grp('X', format('select pg_temp.run_x(%L, %L)', v_shop, v_tpl));
    raise exception 'MX_ROLLBACK';
  exception when others then
    if sqlerrm <> 'MX_ROLLBACK' then
      v_s := v_s || '[FAIL] MX-crash-MU-X1  ' || sqlerrm || E'\n';
    end if;
  end;
  v_hit := case when position('[FAIL] X1 ' in v_s) > 0 then 1 else 0 end;
  v_log := v_log || pg_temp.chk('MU-X1', 'mutant v_job_board ถอดเงื่อนไขขั้นที่ข้าม ถูกจับ (X1 ล้ม) — ' || case when position('MX-crash' in v_s) > 0 then 'มี crash: ' || left(v_s, 200) else 'ok' end, v_hit = 1);

  -- MU-X2: job_profile_state ถอด "and s.status <> 'skipped'" -> X1 ต้องล้ม
  v_s := '';
  begin
    perform pg_temp.mutate('job_profile_state', 'and not s.weigh_required and s.status <> ''skipped''', 'and not s.weigh_required');
    v_s := pg_temp.grp('X', format('select pg_temp.run_x(%L, %L)', v_shop, v_tpl));
    raise exception 'MX_ROLLBACK';
  exception when others then
    if sqlerrm <> 'MX_ROLLBACK' then
      v_s := v_s || '[FAIL] MX-crash-MU-X2  ' || sqlerrm || E'\n';
    end if;
  end;
  v_hit := case when position('[FAIL] X1 ' in v_s) > 0 then 1 else 0 end;
  v_log := v_log || pg_temp.chk('MU-X2', 'mutant job_profile_state ถอดเงื่อนไขขั้นที่ข้าม ถูกจับ (X1 ล้ม) — ' || case when position('MX-crash' in v_s) > 0 then 'มี crash: ' || left(v_s, 200) else 'ok' end, v_hit = 1);
  v_log := v_log || pg_temp.chk('K0b', 'state ไม่ขยับหลังรัน mutant', pg_temp.snap() = v_snap0);

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_log := v_log || format(E'\n=== สรุป (verify-0195-qa): [OK] %s · [SKIP] %s · [FAIL] = %s %s ===\n',
    (length(v_log) - length(replace(v_log, '[OK]', ''))) / 4, (length(v_log) - length(replace(v_log, '[SKIP]', ''))) / 6, v_fail, case when v_fail = 0 then '(ผ่าน)' else '(ไม่ผ่าน)' end);
  raise exception E'%', v_log;
end;
$vqa195$;
