set local lock_timeout = '8s';
set local statement_timeout = '20min';
-- scripts/verify/verify-0194-qa.sql  (QA R2-D2 27 ต.ค. 69 · เติมช่องที่ verify-0194.sql/-b ไม่ครอบ · ไม่แตะ trigger/คอลัมน์/โหมด replication ใดๆ — dry-run กลางวันได้)
-- ตรวจ supabase/migrations/0194_stage_order_gem_before_buff.sql ส่วน A (ทะเบียน + job_stage_def_ensure + job_stage_guard) — ต้องรัน "หลังมี 0194 ส่วน A อยู่ในทรานแซกชันเดียวกัน หรือหลัง apply"
--   dry-run ก่อน apply: ต่อ "0194 ตัดบล็อก PART B (บรรทัดระหว่าง >>> PART B BEGIN ถึง <<< PART B END)" + ไฟล์นี้ แล้วรันไม่ใส่ --commit
-- self-rolling-back (3j-migration-traps ข้อ 11) · ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน · [SKIP] ไม่นับเป็นผ่าน
-- ข้อมูลทดสอบสร้างผ่าน RPC ของระบบ · ข้อยกเว้นที่บอกตรงๆ (ในทรานแซกชันที่ถอยกลับทั้งหมด): ใบเสนอราคา OEM = โคลนจากรายการจริงด้วย INSERT (เหมือน verify-0172..0194) ·
--   จำลองใบเก่า: UPDATE job_stage_def buff -> 92 ชั่วคราวแล้วคืน 105 (เหมือน verify-0194 F*) · mutant = create or replace ฟังก์ชันจริงแล้วถอยกลับ
-- 🔴 สร้างใบทดสอบประมาณ 10 ใบ + mutant 1 ตัว — ล็อกแถว job_counter ช่วงรัน (สั้นกว่า verify-0194) ⇒ ไม่รันตอนมีคนสร้างใบใหม่
--
-- ============ ช่องที่ verify-0194 ไม่ครอบ -> เทสต์ในไฟล์นี้ ============
--  Q1  แยกซ้อน (ส่วนย่อยของส่วนย่อย) บนใบเก่า (buff7 gem_set8): ส่วนใหม่ชี้ใบแม่เดิม ลอกขั้นจากส่วนที่แยก ต้องตรงใบแม่เป๊ะ — F4 ครอบแค่แยกจากใบแม่ตรงๆ
--  Q2  "ได้รับเพิ่มแล้ว" (arrive) ของส่วนต่างที่เกิดบน "ส่วนย่อย" ของใบเก่า — F6 ครอบแค่ส่วนต่างบนใบแม่
--  Q3  รับ buff ก่อน gem_set บนใบลำดับใหม่ = ปฏิเสธ (ลำดับใหม่บังคับจริง ไม่ใช่แค่ทะเบียน) · gem_set รับได้ปกติ
--  Q4  ใบมีพลอยแต่ออฟฟิศข้ามขั้นฝังพลอย -> ขัดรับต่อจากแต่งได้
--  Q5  ย้อนขั้น (reopen) ข้าม gem_set -> buff บนใบลำดับใหม่ แล้วเดินต่อได้
--  Q6  แยกส่วนที่ขั้นขัดของใบลำดับใหม่: แต่ง+ฝังพลอยของส่วนใหม่ถูกข้ามแบบ split_inherit ครบ · ลำดับเท่าใบแม่ · drift 0
--  Q7  บอร์ด (v_job_board): current_stage_code/board_column เดินตามลำดับใหม่ แต่ง -> ฝังพลอย -> ขัด
--  R1  md5 นิยามฟังก์ชันหลัง 0194 = ค่าที่ pre-check (ของ 0194 รันซ้ำ และของ 0195 "ฉบับเดิมของ ensure") คาดไว้ — ถ้าไม่ตรง apply 0195 จะ raise ตอน pre-check
--  MU-Q1  mutant: ส่วนย่อยกลับไปเทียบทะเบียน -> Q1 หรือ Q2 ต้องล้ม
--
--  ❌ ไม่มีเทสต์ครอบ (บอกตรงๆ): W1 job_worker_open p_gem_answer='has' (ต้องมี token+session ผู้จัดการ — ลำดับมาจาก job_sort_stage_codes เดียวกับ C4 ของ verify-0194) · race 2 connection ·
--    ผล PART B กับใบจริง (JB-0040) = verify-0194-b.sql ต้องรันนอกเวลางาน · ชั้น UI/หน้าพิมพ์ A5 (เรียงตาม job_stage.seq ที่ stages_of ยืนยันแล้ว แต่ไม่ได้เรนเดอร์)

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
  v_def := pg_get_functiondef(v_oid);
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


-- ===== helper เฉพาะ 0194 =====
create function pg_temp.std_gem() returns text[] language sql as $c$
  select array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'finish', 'gem_set', 'buff', 'qc', 'pack'] $c$;
create function pg_temp.std_gem_old() returns text[] language sql as $c$
  select array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'finish', 'buff', 'gem_set', 'qc', 'pack'] $c$;
create function pg_temp.o_reopen(p_shop uuid, p_job uuid, p_reason text default 'verify') returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_stage_reopen(p_shop_id=>%L, p_job_id=>%L, p_reason=>%L, p_actor=>%L)', p_shop, p_job, p_reason, pg_temp.act())) $c$;
create function pg_temp.o_recv2(p_shop uuid, p_job uuid, p_seq int, p_qty int default null, p_worker uuid default null, p_name text default 'verify') returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_office_receive(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_occurred_on=>%L, p_worker_id=>%L, p_assignee_name=>%L, p_qty_received=>%L, p_actor=>%L)',
    p_shop, p_job, p_seq, analytics.job_today(), p_worker, p_name, p_qty, pg_temp.act())) $c$;
create function pg_temp.oa(p_shop uuid, p_disc uuid, p_qty int, p_w numeric default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_discrepancy_arrive(p_shop_id=>%L, p_discrepancy_id=>%L, p_qty=>%L, p_weight_g=>%L, p_received_on=>%L, p_worker_id=>%L, p_actor=>%L, p_expected_open=>%L)',
    p_shop, p_disc, p_qty, p_w, null, null, pg_temp.act(), null)) $c$;
create function pg_temp.disc_of(p_job uuid) returns uuid language sql as $c$
  select d.id from analytics.job_discrepancy d where d.job_id = p_job and d.status = 'open' and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = d.id) order by d.created_at limit 1 $c$;
create function pg_temp.drift(p_root uuid) returns int language sql as $c$ select count(*)::int from analytics.v_job_tree_drift where root_job_id = p_root $c$;
create function pg_temp.lot(r jsonb) returns uuid language sql as $c$ select (r ->> 'lot_job_id')::uuid $c$;
-- จำลองใบเก่า: ตั้ง buff กลับ 92 (ผังเดิม ขัดก่อนฝังพลอย) ชั่วคราว → สร้างใบ → คืน 105 (ในทรานแซกชันที่ถอยกลับ)
create function pg_temp.mk_old_order(p_shop uuid, p_tpl uuid, p_metal text default 'silver', p_qty int default 10) returns jsonb
 language plpgsql as $c$
declare d jsonb;
begin
  update analytics.job_stage_def set seq_default = 92 where shop_id = p_shop and code = 'buff';
  d := pg_temp.mkp(p_shop, p_tpl, p_metal, pg_temp.pid(p_shop, case when p_metal = 'gold' then 'gold' else 'none' end), pg_temp.std_gem_old(), p_qty);
  update analytics.job_stage_def set seq_default = 105 where shop_id = p_shop and code = 'buff';
  return d;
end;
$c$;
create function pg_temp.mk_old_polish(p_shop uuid, p_tpl uuid) returns jsonb
 language plpgsql as $c$
declare d jsonb;
begin
  update analytics.job_stage_def set is_active = true where shop_id = p_shop and code = 'polish';
  d := pg_temp.mkp(p_shop, p_tpl, 'silver', pg_temp.pid(p_shop, 'none'), pg_temp.std_polish(), 10);
  update analytics.job_stage_def set is_active = false where shop_id = p_shop and code = 'polish';
  return d;
end;
$c$;


-- ===== helper เฉพาะไฟล์ QA =====
create function pg_temp.o_skip(p_shop uuid, p_job uuid, p_code text, p_reason text default 'verify ข้ามขั้น') returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_stage_skip(%L, %L, %L, %L, %L)', p_shop, p_job, p_code, p_reason, pg_temp.act())) $c$;
create function pg_temp.board_of(p_job uuid) returns text language sql as $c$
  select b.current_stage_code || '/' || b.board_column from analytics.v_job_board b where b.id = p_job $c$;
create function pg_temp.lots_of(p_root uuid) returns int language sql as $c$
  select count(*)::int from analytics.job where parent_job_id = p_root $c$;

-- ===== Q: guard ส่วนย่อย + ลำดับใหม่ (ต้องมี 0194 ส่วน A อยู่แล้ว) =====
create function pg_temp.run_q(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare
  v text := ''; d jsonb; j uuid; rr jsonb; r jsonb; r2 jsonb; r3 jsonb; l1 uuid; l2 uuid; dd uuid; n int; dr jsonb; b1 text; b2 text; b3 text;
  v_today date := analytics.job_today();
begin
  -- Q1 แยกซ้อนบนใบเก่า (finish6 buff7 gem_set8 qc9 pack10): root รับ buff(7) แยก 6 ชิ้น -> L1 · L1 รับ gem_set(8) แยก 2 ชิ้น -> L2
  d := pg_temp.mk_old_order(p_shop, p_tpl);
  j := pg_temp.jid(d);
  rr := pg_temp.rw(p_shop, j, null, 6);
  r := pg_temp.o_recv(p_shop, j, 7, v_today, null, null, 'verify');
  r2 := pg_temp.o_split(p_shop, j, 7, 6);
  l1 := pg_temp.lot(r2);
  r := case when l1 is null then jsonb_build_object('_err', 'no L1') else pg_temp.o_recv(p_shop, l1, 8, v_today, null, null, 'verify') end;
  r3 := case when l1 is null then jsonb_build_object('_err', 'no L1') else pg_temp.o_split(p_shop, l1, 8, 2) end;
  l2 := pg_temp.lot(r3);
  dr := pg_temp.q(format('select to_jsonb(analytics.job_tree_dominant_stage(%L))', j));
  v := v || pg_temp.chk('Q1', '🔴 ใบเก่า: แยกซ้อน (ส่วนของส่วน) ผ่าน · ส่วนใหม่ชี้ใบแม่เดิม · ลำดับขั้นเท่าใบแม่เป๊ะ (finish,buff,gem_set,..) · drift 0 · dominant ไม่ error — '
      || coalesce(pg_temp.codeof(r2), 'ok') || '/' || coalesce(pg_temp.codeof(r), 'ok') || '/' || coalesce(pg_temp.codeof(r3), 'ok') || ' · lots ' || pg_temp.lots_of(j),
    pg_temp.okr(rr) and l1 is not null and l2 is not null and pg_temp.okr(r) and pg_temp.okr(r3)
    and (select parent_job_id from analytics.job where id = l2) = j
    and pg_temp.stages_of(l2) = pg_temp.stages_of(j) and pg_temp.stages_of(l1) = pg_temp.stages_of(j)
    and pg_temp.stages_of(j) like '%finish,buff,gem_set,qc,pack'
    and pg_temp.drift(j) = 0 and not (dr ? '_err'));

  -- Q2 arrive ของส่วนต่างบนส่วนย่อยของใบเก่า: root รับ buff(7) แยก 6 -> L1 · L1 รับ gem_set(8) แค่ 5 จาก 6 -> ส่วนต่าง 1 บน L1 · arrive 1 -> ส่วนใหม่
  d := pg_temp.mk_old_order(p_shop, p_tpl);
  j := pg_temp.jid(d);
  rr := pg_temp.rw(p_shop, j, null, 6);
  r := pg_temp.o_recv(p_shop, j, 7, v_today, null, null, 'verify');
  r2 := pg_temp.o_split(p_shop, j, 7, 6);
  l1 := pg_temp.lot(r2);
  r := case when l1 is null then jsonb_build_object('_err', 'no L1') else pg_temp.o_recv2(p_shop, l1, 8, 5) end;
  dd := case when l1 is null then null else pg_temp.disc_of(l1) end;
  r3 := case when dd is null then jsonb_build_object('_err', 'no discrepancy') else pg_temp.oa(p_shop, dd, 1) end;
  select count(*) into n from analytics.job k where k.parent_job_id = j and k.id <> l1;
  v := v || pg_temp.chk('Q2', '🔴 ใบเก่า: ส่วนต่างเกิดบนส่วนย่อย -> "ได้รับเพิ่มแล้ว" ผ่าน · เกิดส่วนใหม่ 1 ส่วนที่ลำดับขั้นเท่าใบแม่ — ' || coalesce(pg_temp.codeof(r), 'ok') || '/' || coalesce(pg_temp.codeof(r3), 'ok') || ' · ส่วนใหม่ ' || n,
    pg_temp.okr(rr) and l1 is not null and pg_temp.okr(r) and dd is not null and pg_temp.okr(r3) and n = 1
    and (select pg_temp.stages_of(k.id) = pg_temp.stages_of(j) from analytics.job k where k.parent_job_id = j and k.id <> l1 limit 1)
    and pg_temp.drift(j) = 0);

  -- Q3 ลำดับใหม่บังคับจริง: แต่งส่งแล้ว gem_set ยัง pending -> รับ buff ไม่ได้ · รับ gem_set ได้
  d := pg_temp.mkp(p_shop, p_tpl, 'silver', pg_temp.pid(p_shop, 'none'), pg_temp.std_gem(), 10);
  j := pg_temp.jid(d);
  rr := pg_temp.rw(p_shop, j, null, 6);
  r := pg_temp.o_recv(p_shop, j, 8, v_today, null, null, 'verify');
  v := v || pg_temp.chk('Q3', 'ห้ามผ่าน: ใบลำดับใหม่ แต่งส่งแล้ว รับ "ขัด"(8) ก่อน "ฝังพลอย"(7) = ปฏิเสธ · ขัดยัง pending — ' || coalesce(pg_temp.codeof(r), 'ผ่าน?'),
    j is not null and pg_temp.okr(rr) and not pg_temp.okr(r) and pg_temp.sv(j, 8, 'status') = 'pending' and pg_temp.sv(j, 7, 'status') = 'pending');
  r2 := pg_temp.o_recv(p_shop, j, 7, v_today, null, null, 'verify');
  v := v || pg_temp.chk('Q3b', 'ต้องไม่พัง: รับ "ฝังพลอย"(7) หลังแต่งได้ตามปกติ — ' || coalesce(pg_temp.codeof(r2), 'ok'), pg_temp.okr(r2) and pg_temp.sv(j, 7, 'status') = 'received');

  -- Q4 ข้ามขั้นฝังพลอย (ใบมีพลอยแต่ไม่ฝังที่ร้านนี้) -> ขัดรับต่อจากแต่ง
  d := pg_temp.mkp(p_shop, p_tpl, 'silver', pg_temp.pid(p_shop, 'none'), pg_temp.std_gem(), 10);
  j := pg_temp.jid(d);
  rr := pg_temp.rw(p_shop, j, null, 6);
  r := pg_temp.o_skip(p_shop, j, 'gem_set');
  r2 := pg_temp.o_recv(p_shop, j, 8, v_today, null, null, 'verify');
  r3 := pg_temp.o_send(p_shop, j, 8, v_today);
  v := v || pg_temp.chk('Q4', 'ต้องไม่พัง: ข้าม gem_set(7) แล้ว รับ/ส่ง buff(8) ต่อจากแต่งได้ — ' || coalesce(pg_temp.codeof(r), 'ok') || '/' || coalesce(pg_temp.codeof(r2), 'ok') || '/' || coalesce(pg_temp.codeof(r3), 'ok'),
    pg_temp.okr(rr) and pg_temp.okr(r) and pg_temp.sv(j, 7, 'status') = 'skipped' and pg_temp.okr(r2) and pg_temp.okr(r3) and pg_temp.sv(j, 8, 'status') = 'sent');

  -- Q5 ย้อนขั้นข้ามคู่ gem_set/buff: gem_set ส่งแล้ว · buff รับ -> reopen (buff -> pending) -> reopen (gem_set -> received) -> เดินต่อ
  d := pg_temp.mkp(p_shop, p_tpl, 'silver', pg_temp.pid(p_shop, 'none'), pg_temp.std_gem(), 10);
  j := pg_temp.jid(d);
  rr := pg_temp.rw(p_shop, j, null, 7);
  r := pg_temp.o_recv(p_shop, j, 8, v_today, null, null, 'verify');
  r2 := pg_temp.o_reopen(p_shop, j);
  b1 := pg_temp.sv(j, 8, 'status');
  r3 := pg_temp.o_reopen(p_shop, j);
  b2 := pg_temp.sv(j, 7, 'status');
  v := v || pg_temp.chk('Q5a', 'ใบลำดับใหม่: ย้อนขั้น buff(รับ -> pending) แล้ว gem_set (sent -> received) ได้ทีละขั้น — ' || coalesce(pg_temp.codeof(r2), 'ok') || '/' || coalesce(pg_temp.codeof(r3), 'ok') || ' · ' || coalesce(b1, '?') || '/' || coalesce(b2, '?'),
    pg_temp.okr(rr) and pg_temp.okr(r) and pg_temp.okr(r2) and pg_temp.okr(r3) and b1 = 'pending' and b2 = 'received');
  r := pg_temp.o_send(p_shop, j, 7, v_today);
  r2 := pg_temp.o_recv(p_shop, j, 8, v_today, null, null, 'verify');
  r3 := pg_temp.o_send(p_shop, j, 8, v_today);
  v := v || pg_temp.chk('Q5b', 'ต้องไม่พัง: หลังย้อนขั้น ส่ง gem_set -> รับ/ส่ง buff ต่อได้ — ' || coalesce(pg_temp.codeof(r), 'ok') || '/' || coalesce(pg_temp.codeof(r2), 'ok') || '/' || coalesce(pg_temp.codeof(r3), 'ok'),
    pg_temp.okr(r) and pg_temp.okr(r2) and pg_temp.okr(r3) and pg_temp.sv(j, 8, 'status') = 'sent');

  -- Q6 แยกส่วนที่ขั้นขัดของใบลำดับใหม่
  d := pg_temp.mkp(p_shop, p_tpl, 'silver', pg_temp.pid(p_shop, 'none'), pg_temp.std_gem(), 10);
  j := pg_temp.jid(d);
  rr := pg_temp.rw(p_shop, j, null, 7);
  r := pg_temp.o_recv(p_shop, j, 8, v_today, null, null, 'verify');
  r2 := pg_temp.o_split(p_shop, j, 8, 4);
  l1 := pg_temp.lot(r2);
  select count(*) into n from analytics.job_stage s where s.job_id = l1 and s.seq < 8 and s.status = 'skipped' and s.skip_reason = 'split_inherit';
  dr := pg_temp.q(format('select to_jsonb(analytics.job_tree_dominant_stage(%L))', j));
  v := v || pg_temp.chk('Q6', 'ใบลำดับใหม่ แยกที่ขั้นขัด(8): ส่วนใหม่ข้ามขั้น 1-7 แบบ split_inherit ครบ (รวมแต่ง/ฝังพลอย) · ลำดับเท่าใบแม่ · ขัดของส่วนใหม่ sent · drift 0 · dominant ไม่ error — skip ' || n || ' · ' || coalesce(pg_temp.codeof(r2), 'ok'),
    pg_temp.okr(rr) and pg_temp.okr(r) and pg_temp.okr(r2) and l1 is not null and n = 7
    and pg_temp.stages_of(l1) = pg_temp.stages_of(j) and pg_temp.sv(l1, 8, 'status') = 'sent' and pg_temp.sv(l1, 9, 'status') = 'pending'
    and pg_temp.drift(j) = 0 and not (dr ? '_err'));

  -- Q7 บอร์ดตามลำดับใหม่: แต่งส่งแล้ว -> อยู่ gem_set · รับ gem_set -> ยัง gem_set · ส่ง gem_set -> ขึ้น buff
  d := pg_temp.mkp(p_shop, p_tpl, 'silver', pg_temp.pid(p_shop, 'none'), pg_temp.std_gem(), 10);
  j := pg_temp.jid(d);
  rr := pg_temp.rw(p_shop, j, null, 6);
  b1 := pg_temp.board_of(j);
  r := pg_temp.o_recv(p_shop, j, 7, v_today, null, null, 'verify');
  b2 := pg_temp.board_of(j);
  r2 := pg_temp.o_send(p_shop, j, 7, v_today);
  b3 := pg_temp.board_of(j);
  v := v || pg_temp.chk('Q7', 'บอร์ด v_job_board ตามลำดับใหม่ — แต่งส่งแล้ว ' || coalesce(b1, '?') || ' · รับฝังพลอย ' || coalesce(b2, '?') || ' · ส่งฝังพลอย ' || coalesce(b3, '?'),
    pg_temp.okr(rr) and pg_temp.okr(r) and pg_temp.okr(r2) and b1 = 'gem_set/gem_set' and b2 = 'gem_set/gem_set' and b3 = 'buff/buff');
  return v;
end;
$c$;

-- ===== R: md5 นิยามฟังก์ชันหลัง 0194 (ค่าที่ pre-check คาดไว้) =====
create function pg_temp.run_r() returns text
 language plpgsql as $c$
declare
  v text := ''; g text; e text;
begin
  select md5(pg_get_functiondef(p.oid)) into g from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'job_stage_guard';
  select md5(pg_get_functiondef(p.oid)) into e from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'job_stage_def_ensure';
  v := v || pg_temp.chk('R1a', 'md5 job_stage_guard หลัง 0194 = ค่า "ฉบับใหม่" ใน allow-list ของ pre-check 0194(รันซ้ำได้) · ไม่ตรง = ฟังก์ชันถูกสร้างจากไฟล์ CRLF (ต้อง apply จากไฟล์ LF) — ' || coalesce(g, 'null'), g = 'f78049fa169cfb0e9e1d689f4c0a3943');
  v := v || pg_temp.chk('R1b', 'md5 job_stage_def_ensure หลัง 0194 = ค่า "ฉบับใหม่" ของ 0194 และ "ฉบับเดิม" ที่ pre-check 0195 คาด (ไม่ตรง = 0195 raise ตอน apply · สาเหตุที่เจอจริง: apply จากไฟล์ CRLF) — ' || coalesce(e, 'null'), e = 'c751a76d5f18845c72f5aaf6497814e0');
  return v;
end;
$c$;

do $vqa$
declare
  v_shop uuid; v_tpl uuid; v_log text := ''; v_s text := ''; v_fail int; v_snap0 text; v_hit int; v_g text; v_buff int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select id into v_shop from public.shop order by created_at limit 1;
  select i.id into v_tpl from analytics.oem_quote_item i join analytics.oem_quote q on q.id = i.quote_id
   where i.shop_id = v_shop and i.input ->> 'metal' = 'silver' and q.quote_no !~ '^V1[0-9]{2}-' order by q.created_at, i.seq limit 1;
  if v_tpl is null then
    raise exception E'[FAIL] S0  ไม่มี oem_quote_item เงินจริงให้ใช้เป็นแม่แบบโคลน\n';
  end if;
  -- ต้องมี 0194 ส่วน A อยู่ในทรานแซกชัน (หรือ apply แล้ว) — ไม่งั้นทุกเคสผิดเพราะผังเก่า ไม่ใช่เพราะบั๊ก
  select md5(pg_get_functiondef(p.oid)) into v_g from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'job_stage_guard';
  select seq_default into v_buff from analytics.job_stage_def where shop_id = v_shop and code = 'buff';
  if v_g = 'ea1258e01ab33739a5fefbd34cd4586b' or v_buff is distinct from 105 then
    raise exception E'[FAIL] S0  ยังไม่มี 0194 ส่วน A (guard md5 % · buff seq_default %) — ต่อไฟล์ migration (ตัด PART B) ก่อนไฟล์นี้\n', v_g, v_buff;
  end if;

  v_snap0 := pg_temp.snap();
  begin
    v_s := pg_temp.grp('Q', format('select pg_temp.run_q(%L, %L)', v_shop, v_tpl)) || pg_temp.grp('R', 'select pg_temp.run_r()');
    raise exception 'QA_ROLLBACK';
  exception when others then
    if sqlerrm <> 'QA_ROLLBACK' then
      v_s := coalesce(v_s, '') || pg_temp.chk('S1-crash', 'ชุดหลัก raise นอกกลุ่ม: ' || sqlstate || ' ' || sqlerrm, false);
    end if;
  end;
  v_log := v_log || v_s;
  v_log := v_log || pg_temp.chk('K0', 'ไม่ทิ้งรอย: snapshot job/job_stage/event/token/worker/profile/def/oem_quote/production/shop เท่าเดิมหลังถอยกลับ', pg_temp.snap() = v_snap0);

  -- MU-Q1: ส่วนย่อยกลับไปเทียบทะเบียน (ถอดด่านสำเนาใบแม่) -> ใบเก่า (buff<gem_set) แยกซ้อน/arrive ต้องล้ม
  v_s := '';
  begin
    perform pg_temp.mutate('job_stage_guard', E'if v_job.parent_job_id is null then\n      if exists (', E'if true then\n      if exists (');
    v_s := pg_temp.grp('Q', format('select pg_temp.run_q(%L, %L)', v_shop, v_tpl));
    raise exception 'MX_ROLLBACK';
  exception when others then
    if sqlerrm <> 'MX_ROLLBACK' then
      v_s := v_s || '[FAIL] MX-crash-MU-Q1  ' || sqlerrm || E'\n';
    end if;
  end;
  v_hit := (case when position('[FAIL] Q1 ' in v_s) > 0 then 1 else 0 end) + (case when position('[FAIL] Q2 ' in v_s) > 0 then 1 else 0 end);
  v_log := v_log || pg_temp.chk('MU-Q1', 'mutant ส่วนย่อยเทียบทะเบียนแทนใบแม่ ถูกจับ (Q1/Q2 ล้ม ' || v_hit || ' จาก 2) — ถ้ารอด = Q1/Q2 ไม่ได้ทดสอบด่านสำเนาใบแม่จริง', v_hit > 0);
  v_log := v_log || pg_temp.chk('K0b', 'state ไม่ขยับหลังรัน mutant', pg_temp.snap() = v_snap0);

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_log := v_log || format(E'\n=== สรุป (verify-0194-qa): [OK] %s · [SKIP] %s · [FAIL] = %s %s ===\n',
    (length(v_log) - length(replace(v_log, '[OK]', ''))) / 4, (length(v_log) - length(replace(v_log, '[SKIP]', ''))) / 6, v_fail, case when v_fail = 0 then '(ผ่าน)' else '(ไม่ผ่าน)' end);
  raise exception E'%', v_log;
end;
$vqa$;
