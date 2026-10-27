-- scripts/verify/verify-0194-b.sql  (ส่วน B — 🔴 มี alter table analytics.job_stage disable trigger = ล็อก job_stage ตลอดทรานแซกชัน · รันนอกเวลางานเท่านั้น หลัง 23:00)
-- ตรวจ "สลับ seq ใบค้าง" (PART B ของ supabase/migrations/0194_stage_order_gem_before_buff.sql) + ด่านสำเนาส่วนย่อยทิศ "ไม่ตรงใบแม่" ของ job_stage_guard
-- ส่วน A (ทะเบียน/guard/ensure/ใบเก่า/ใบใหม่ · ไม่ล็อก) = scripts/verify/verify-0194.sql
-- ฟังก์ชัน pg_temp.swap194() ข้างล่างเป็น "สำเนา" ของบล็อก do $swap194$ ใน migration (สร้างด้วยสคริปต์ — ห้ามแก้มือ) โดยแทน 2 บรรทัด alter table ... disable/enable trigger
--   ด้วย pg_temp.guard_off()/guard_on() (ในไฟล์นี้ = alter table จริง) · ถ้าแก้ PART B ของ migration ต้องสร้างไฟล์นี้ใหม่ · ตรวจว่าสำเนาตรง: เทียบข้อความระหว่าง "create function pg_temp.swap194()" ถึง "$swap194$;" กับบล็อกใน migration
-- self-rolling-back · ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน · ทุกเคสรันในทรานแซกชันย่อยที่ถอยกลับ (pg_temp.iso) — swap194 จะแตะใบจริงที่เข้าเงื่อนไข (เช่น JB-0040) ในทรานแซกชันนั้นแล้วถอยกลับ
-- ข้อมูลทดสอบ: ใบสร้างผ่าน RPC (ใบเก่า = ผังเก่าจำลองด้วย UPDATE job_stage_def ชั่วคราว) · ข้อยกเว้น: tb3/tb5 ปิด guard ชั่วคราวเพื่อจัดฉาก (เรียง seq ใหม่ด้วยมือ) ในทรานแซกชันย่อยที่ถอยกลับ
-- ใช้ได้ทั้งแบบรันหลัง apply และแบบ dry-run ต่อท้าย migration (ทั้งไฟล์)
--
-- ============ ตารางแมป design ข้อ 5 -> เทสต์ ============
--   2 ส่วนย่อยที่ (stage_code, seq) ไม่ตรงใบแม่ -> split_link        -> T5a (ควบคุม) T5b · MB-6
--   3 ใบที่ขั้นใดไม่ pending ไม่ถูกสลับ (md5 เท่าเดิม)                 -> T1b · MB-4
--   4 buff/gem_set ไม่ติดกัน หรือมีส่วนย่อย -> block สลับ raise (mutant) -> T3 T4 · MB-1 MB-2
--   5 รัน 2 รอบ รอบสองไม่เปลี่ยนอะไร (ส่วนสลับ)                       -> T1d
--   9 ใบที่สลับแล้ว (แบบ JB-0040) เดินครบ · แยกที่ gem_set · drift=false -> T2a T2b
--  13 trg_job_stage_guard กลับมา enabled                              -> T0 T1c K0 K0b · MB-3
--  L1 ส่วนต่าง (ไม่ void) ชี้ขั้นขัด/ฝังพลอย -> swap raise (ส่วนต่างที่ void แล้วไม่นับ)   -> T6a T6b · MB-7
-- 🔴 รันจากสำเนา LF (git show <ref>:<path> หรือ sed 's/\r$//') — ไฟล์ทน \r (md5/mutant ตัด \r) แต่ prosrc ที่ได้จะไม่ตรงกับสำเนาที่ลอกมา (ข้อ 20 ของ 3j-migration-traps)
--   ไม่แตะแถวอื่นของการสลับ                                        -> T1c · MB-5 (+ ด่านท้าย PART B ของ migration)
--  ❌ ไม่มีเทสต์ครอบ: race 2 connection · trg_job_stage_sync ปรับ current_stage_code ของใบที่ขั้นแรกที่ pending เป็น buff/gem_set (ฟิกซ์เจอร์ทุกใบมีขั้นก่อนหน้า pending อยู่ — ไม่ใช่เคสนั้น) · ผลของล็อกต่อช่างจริง
set local statement_timeout = '45min';
set local lock_timeout = '8s';

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
  -- ตัด \r ก่อนแทนข้อความ: ฟังก์ชันที่ apply จากไฟล์ CRLF มี \r\n ใน body ⇒ ข้อความหลายบรรทัดของ mutant ไม่ตรง (MUTANT_NOT_APPLIED) · mutant ไม่ขึ้นกับ line ending
  v_def := replace(pg_get_functiondef(v_oid), E'\r', '');
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


-- ===== guard on/off + สำเนา swap194 =====
create function pg_temp.guard_off() returns void language plpgsql as $c$ begin execute 'alter table analytics.job_stage disable trigger trg_job_stage_guard'; end; $c$;
create function pg_temp.guard_on() returns void language plpgsql as $c$ begin execute 'alter table analytics.job_stage enable trigger trg_job_stage_guard'; end; $c$;
create function pg_temp.swap194() returns void language plpgsql as $swap194$
declare
  c        record;
  v_n      int;
  v_bad    text;
  v_en     "char";
  v_nsw    int := 0;
  v_ev0    text;
  v_ev1    text;
begin
  -- 1) ดูก่อนว่ามีใบเข้าเงื่อนไขไหม (ยังไม่ล็อก) — ไม่มี = จบ
  if not exists (
       select 1 from analytics.job j
         join analytics.job_stage b on b.job_id = j.id and b.stage_code = 'buff'
         join analytics.job_stage g on g.job_id = j.id and g.stage_code = 'gem_set'
        where j.parent_job_id is null and j.status in ('open', 'in_progress', 'on_hold')
          and b.status = 'pending' and g.status = 'pending' and b.seq < g.seq) then
    raise notice '0194: ไม่มีใบค้างที่ต้องสลับ (ขัด/ฝังพลอย ยังไม่เริ่มทั้งคู่) — ข้ามส่วนสลับ ไม่ล็อกตาราง';
    return;
  end if;

  -- 2) ล็อก (disable trigger = ล็อกตารางจนจบทรานแซกชัน — ไม่มีใครเขียน job_stage ได้) แล้วอ่านสถานะก่อนแก้
  perform pg_temp.guard_off();
  create temp table _j194_sb on commit drop as select * from analytics.job_stage;
  create temp table _j194_jb on commit drop as select * from analytics.job;
  select count(*)::text || '/' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '') into v_ev0 from analytics.job_event x;
  create temp table _j194_swapped (job_id uuid, buff_id uuid, gem_id uuid, buff_seq int, gem_seq int) on commit drop;

  -- 3) อ่านใบเข้าเงื่อนไขใหม่ (หลังล็อก) แล้วตรวจก่อนแตะ — ผิดเงื่อนไขข้อไหน raise ถอยทั้งก้อน
  for c in
    select j.id as job_id, j.job_no, b.id as buff_id, b.seq as buff_seq, g.id as gem_id, g.seq as gem_seq
      from analytics.job j
      join analytics.job_stage b on b.job_id = j.id and b.stage_code = 'buff'
      join analytics.job_stage g on g.job_id = j.id and g.stage_code = 'gem_set'
     where j.parent_job_id is null and j.status in ('open', 'in_progress', 'on_hold')
       and b.status = 'pending' and g.status = 'pending' and b.seq < g.seq
     order by j.job_no
  loop
    if c.buff_seq + 1 <> c.gem_seq then
      raise exception '0194: ใบ % ขัด(seq %) กับฝังพลอย(seq %) ไม่ติดกัน — สลับอัตโนมัติไม่ได้ ให้คนตัดสินใจ', c.job_no, c.buff_seq, c.gem_seq;
    end if;
    if exists (select 1 from analytics.job k where k.parent_job_id = c.job_id) then
      raise exception '0194: ใบ % มีส่วนย่อย — สลับ seq ใบแม่อย่างเดียวไม่ได้ (ส่วนย่อยคัดลอก seq ใบแม่) ให้คนตัดสินใจ', c.job_no;
    end if;
    -- ส่วนต่าง (job_discrepancy ที่ยังไม่ถูก void) ชี้ขั้น buff/gem_set ของใบนี้ = ผูกกับ seq/ลำดับขั้น — สลับเงียบๆ ไม่ได้ (ปกติเกิดไม่ได้กับขั้นที่ยัง pending ทั้งคู่ — กันไว้เป็นด่านสุดท้าย)
    if exists (select 1 from analytics.job_discrepancy d
                where d.status <> 'void' and (d.from_stage_id in (c.buff_id, c.gem_id) or d.to_stage_id in (c.buff_id, c.gem_id))
                  and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = d.id)) then
      raise exception '0194: ใบ % มีส่วนต่างที่ชี้ขั้นขัด/ฝังพลอย — สลับ seq ไม่ได้ ให้คนตัดสินใจ', c.job_no;
    end if;
    if exists (select 1 from analytics.job_stage x where x.job_id = c.job_id and x.seq = 100) then
      raise exception '0194: ใบ % มีขั้น seq 100 อยู่แล้ว — ใช้เป็นค่ากลางตอนสลับไม่ได้', c.job_no;
    end if;
    -- 3 จังหวะ กัน unique (job_id, seq) ชนกลางทาง: buff -> 100 · gem_set -> seq เดิมของ buff · buff -> seq เดิมของ gem_set
    update analytics.job_stage set seq = 100 where id = c.buff_id and seq = c.buff_seq and status = 'pending';
    if not found then raise exception '0194: ใบ % สลับจังหวะ 1 ไม่สำเร็จ', c.job_no; end if;
    update analytics.job_stage set seq = c.buff_seq, updated_at = now() where id = c.gem_id and seq = c.gem_seq and status = 'pending';
    if not found then raise exception '0194: ใบ % สลับจังหวะ 2 ไม่สำเร็จ', c.job_no; end if;
    update analytics.job_stage set seq = c.gem_seq, updated_at = now() where id = c.buff_id and seq = 100 and status = 'pending';
    if not found then raise exception '0194: ใบ % สลับจังหวะ 3 ไม่สำเร็จ', c.job_no; end if;
    insert into _j194_swapped values (c.job_id, c.buff_id, c.gem_id, c.buff_seq, c.gem_seq);
    v_nsw := v_nsw + 1;
  end loop;

  perform pg_temp.guard_on();
  select t.tgenabled into v_en from pg_trigger t where t.tgrelid = 'analytics.job_stage'::regclass and t.tgname = 'trg_job_stage_guard';
  if v_en is distinct from 'O' then
    raise exception '0194: trg_job_stage_guard ไม่กลับมา enabled (tgenabled = %)', v_en;
  end if;

  -- 4) ด่านหลังสลับ: แตะเฉพาะ 2 แถวต่อใบที่สลับ
  select count(*) into v_n from analytics.job_stage;
  if v_n <> (select count(*) from _j194_sb) then
    raise exception '0194: จำนวนแถว job_stage เปลี่ยน (% -> %)', (select count(*) from _j194_sb), v_n;
  end if;
  -- ขั้นที่ไม่ใช่ 2 แถวที่ตั้งใจ = เหมือนเดิมทุกคอลัมน์ (รวม seq/updated_at)
  select count(*) into v_n
    from _j194_sb b join analytics.job_stage a on a.id = b.id
   where a.id not in (select buff_id from _j194_swapped union select gem_id from _j194_swapped)
     and to_jsonb(a) is distinct from to_jsonb(b);
  if v_n > 0 then
    raise exception '0194: ขั้นนอกเป้าหมาย % แถวถูกแก้ระหว่างสลับ', v_n;
  end if;
  -- 2 แถวที่สลับ = เปลี่ยนเฉพาะ seq + updated_at · seq สลับตำแหน่งกันจริง
  select count(*) into v_n
    from _j194_sb b join analytics.job_stage a on a.id = b.id
   where a.id in (select buff_id from _j194_swapped union select gem_id from _j194_swapped)
     and (to_jsonb(a) - 'seq' - 'updated_at') is distinct from (to_jsonb(b) - 'seq' - 'updated_at');
  if v_n > 0 then
    raise exception '0194: ขั้นที่สลับ % แถวมีคอลัมน์อื่นนอกจาก seq/updated_at เปลี่ยน', v_n;
  end if;
  select count(*) into v_n
    from _j194_swapped s
    join analytics.job_stage ab on ab.id = s.buff_id
    join analytics.job_stage ag on ag.id = s.gem_id
   where ab.seq = s.gem_seq and ag.seq = s.buff_seq and ab.stage_code = 'buff' and ag.stage_code = 'gem_set' and ab.status = 'pending' and ag.status = 'pending';
  if v_n <> v_nsw then
    raise exception '0194: สลับสำเร็จ % จาก % ใบเท่านั้น', v_n, v_nsw;
  end if;
  -- job: ใบที่ไม่เกี่ยว = เหมือนเดิมทั้งแถว · ใบที่สลับ = เปลี่ยนได้เฉพาะ current_stage_code/updated_at (trg_job_stage_sync คำนวณขั้นปัจจุบันใหม่)
  select count(*) into v_n from _j194_jb;
  if v_n <> (select count(*) from analytics.job) then
    raise exception '0194: จำนวนแถว job เปลี่ยน';
  end if;
  select string_agg(a.job_no, ', ') into v_bad
    from _j194_jb b join analytics.job a on a.id = b.id
   where case when a.id in (select job_id from _j194_swapped)
              then (to_jsonb(a) - 'current_stage_code' - 'updated_at') is distinct from (to_jsonb(b) - 'current_stage_code' - 'updated_at')
              else to_jsonb(a) is distinct from to_jsonb(b) end;
  if v_bad is not null then
    raise exception '0194: ใบงานขยับนอกเงื่อนไข: %', v_bad;
  end if;
  select count(*)::text || '/' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '') into v_ev1 from analytics.job_event x;
  if v_ev1 is distinct from v_ev0 then
    raise exception '0194: job_event ขยับระหว่างสลับ (ต้องไม่เขียน event)';
  end if;
  raise notice '0194: สลับ ขัด/ฝังพลอย ให้ % ใบ (ด่านหลังสลับผ่าน)', v_nsw;
end;
$swap194$;


-- ===== ตัวช่วยส่วน B =====
-- ทดสอบทีละเคสแบบแยกทรานแซกชันย่อย (ถอยกลับทุกอย่างหลังเคส — รวมการสลับใบจริงที่ swap194 อาจแตะ) · ผลเป็น text
create function pg_temp.iso(p_sql text) returns text
 language plpgsql as $c$
declare v text; d text;
begin
  execute p_sql into v;
  raise exception 'V194_ISO' using detail = coalesce(v, '');
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  if sqlerrm = 'V194_ISO' then
    return coalesce(d, '');
  end if;
  return pg_temp.chk('crash', 'เคส raise: ' || sqlstate || ' ' || sqlerrm, false);
end;
$c$;
-- รัน swap194 แล้วคืน 'OK' หรือ 'ERR:<ข้อความ>' (เคลียร์ temp table ของรอบก่อนในทรานแซกชันเดียวกัน)
create function pg_temp.swap_run() returns text
 language plpgsql as $c$
declare v_msg text;
begin
  if to_regclass('pg_temp._j194_sb') is not null then execute 'drop table _j194_sb'; end if;
  if to_regclass('pg_temp._j194_jb') is not null then execute 'drop table _j194_jb'; end if;
  if to_regclass('pg_temp._j194_swapped') is not null then execute 'drop table _j194_swapped'; end if;
  begin
    perform pg_temp.swap194();
    return 'OK';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    return 'ERR:' || v_msg;
  end;
end;
$c$;
create function pg_temp.swap_mut(p_from text, p_to text) returns void
 language plpgsql as $c$
declare v_def text; v_new text;
begin
  v_def := replace(pg_get_functiondef('pg_temp.swap194()'::regprocedure), E'\r', '');
  v_new := replace(v_def, p_from, p_to);
  if v_new = v_def then
    raise exception 'MUTANT_NOT_APPLIED: swap194 ไม่พบข้อความ [%]', p_from;
  end if;
  execute v_new;
end;
$c$;
create function pg_temp.guard_on_ok() returns boolean language sql as $c$
  select coalesce((select t.tgenabled = 'O' from pg_trigger t where t.tgrelid = 'analytics.job_stage'::regclass and t.tgname = 'trg_job_stage_guard'), false)
     and current_setting('session_replication_role') = 'origin' $c$;
create function pg_temp.rows_md5(p_jobs uuid[], p_exclude_codes text[] default '{}') returns text language sql as $c$
  select coalesce(md5(string_agg(s::text, '|' order by s.id)), '') from analytics.job_stage s where s.job_id = any (p_jobs) and not (s.stage_code = any (p_exclude_codes)) $c$;
-- สลับ seq buff/gem_set ของใบแม่ด้วยมือ (ปิด guard ชั่วคราว) — ใช้ตอนสร้างสถานการณ์ในเคสที่ต้องการใบ "สลับแล้ว"
create function pg_temp.hand_swap(p_job uuid) returns void language plpgsql as $c$
declare b int; g int;
begin
  select seq into b from analytics.job_stage where job_id = p_job and stage_code = 'buff';
  select seq into g from analytics.job_stage where job_id = p_job and stage_code = 'gem_set';
  perform pg_temp.guard_off();
  update analytics.job_stage set seq = 100 where job_id = p_job and stage_code = 'buff';
  update analytics.job_stage set seq = b where job_id = p_job and stage_code = 'gem_set';
  update analytics.job_stage set seq = g where job_id = p_job and stage_code = 'buff';
  perform pg_temp.guard_on();
end;
$c$;

-- ===== เคสส่วน B =====
-- tb1: สลับได้ถูกต้อง + ไม่แตะแถวอื่น/ใบอื่น + รันซ้ำไม่ทำอะไร + guard กลับมา enabled (เคส 13 · ข้อ "ไม่แตะแถวอื่น")
create function pg_temp.tb1(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare
  v text := ''; j1 uuid; da uuid; db uuid; r text; r2 text; m_dec text; m_oth text; m_j1 text; ev0 int; ev1 int; rr jsonb; v_today date := analytics.job_today();
begin
  j1 := pg_temp.jid(pg_temp.mk_old_order(p_shop, p_tpl));
  da := pg_temp.jid(pg_temp.mk_old_order(p_shop, p_tpl));
  db := pg_temp.jid(pg_temp.mk_old_order(p_shop, p_tpl));
  rr := pg_temp.rw(p_shop, da, null, 6);
  perform pg_temp.o_recv(p_shop, da, 7, v_today, null, null, 'verify');   -- buff received = เริ่มแล้ว
  rr := pg_temp.rw(p_shop, db, null, 7);                                  -- buff sent · gem_set pending
  m_dec := pg_temp.rows_md5(array[da, db]);
  m_oth := pg_temp.rows_md5(array[j1], array['buff', 'gem_set']);
  select count(*) into ev0 from analytics.job_event where job_id = j1;
  r := pg_temp.swap_run();
  select count(*) into ev1 from analytics.job_event where job_id = j1;
  v := v || pg_temp.chk('T1a', 'ใบที่ขัด+ฝังพลอย pending ทั้งคู่ติดกันถูกสลับ: seq 7=gem_set 8=buff · ทั้งคู่ pending · ไม่เขียน event — ' || r || ' · ' || coalesce(pg_temp.stages_of(j1), '?'),
    r = 'OK' and pg_temp.stages_of(j1) = 'wax_inject,wax_tree,invest_burnout,cast,cut_sprue,finish,gem_set,buff,qc,pack'
    and pg_temp.sv(j1, 7, 'status') = 'pending' and pg_temp.sv(j1, 8, 'status') = 'pending' and ev0 = ev1);
  v := v || pg_temp.chk('T1b', 'เคส 3 (ห้ามผ่าน): ใบที่ขั้นใดเริ่มแล้ว (buff received · buff sent) ไม่ถูกสลับ — ทุกแถวเท่าเดิมเป๊ะ',
    pg_temp.rows_md5(array[da, db]) = m_dec and pg_temp.stages_of(da) like '%finish,buff,gem_set%' and pg_temp.stages_of(db) like '%finish,buff,gem_set%');
  v := v || pg_temp.chk('T1c', 'ไม่แตะแถวอื่นของใบที่สลับ (ขั้นอื่นทุกแถวเท่าเดิม รวม seq/updated_at) · trg_job_stage_guard กลับมา enabled (เคส 13)',
    pg_temp.rows_md5(array[j1], array['buff', 'gem_set']) = m_oth and pg_temp.guard_on_ok());
  m_j1 := pg_temp.rows_md5(array[j1]);
  r2 := pg_temp.swap_run();
  v := v || pg_temp.chk('T1d', 'รันซ้ำ (เคส 5): ใบที่สลับแล้วไม่ถูกสลับกลับ · ไม่เปลี่ยนอะไร — ' || r2, r2 = 'OK' and pg_temp.rows_md5(array[j1]) = m_j1 and pg_temp.rows_md5(array[da, db]) = m_dec);
  return v;
end;
$c$;

-- tb2: ใบที่สลับแล้ว (แบบ JB-0040) เดินครบ · แยกส่วนที่ฝังพลอย · drift · dominant stage (เคส 9)
create function pg_temp.tb2(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare
  v text := ''; ja uuid; jb uuid; r text; rr jsonb; dn jsonb; r1 jsonb; r2 jsonb; lot uuid; dr jsonb; v_today date := analytics.job_today();
begin
  ja := pg_temp.jid(pg_temp.mk_old_order(p_shop, p_tpl));
  jb := pg_temp.jid(pg_temp.mk_old_order(p_shop, p_tpl));
  r := pg_temp.swap_run();
  rr := pg_temp.rw(p_shop, ja, null, 10);
  dn := pg_temp.o_done(p_shop, ja, 10, 0);
  v := v || pg_temp.chk('T2a', 'ใบที่สลับแล้วเดิน หล่อ→แต่ง→ฝังพลอย→ขัด→QC→แพ็ก ครบแล้วปิดงานได้ — ' || r || ' · ' || rr::text || ' · ' || coalesce(pg_temp.codeof(dn), 'ok'),
    r = 'OK' and pg_temp.okr(rr) and pg_temp.okr(dn) and (select status from analytics.job where id = ja) = 'done');
  rr := pg_temp.rw(p_shop, jb, null, 6);
  r1 := pg_temp.o_recv(p_shop, jb, 7, v_today, null, null, 'verify');
  r2 := pg_temp.o_split(p_shop, jb, 7, 4);
  lot := pg_temp.lot(r2);
  dr := pg_temp.q(format('select to_jsonb(analytics.job_tree_dominant_stage(%L))', jb));
  v := v || pg_temp.chk('T2b', 'ใบที่สลับแล้ว: แยกส่วนที่ขั้นฝังพลอย (7) ได้ · ส่วนย่อยลำดับเหมือนใบแม่ · drift 0 · dominant stage ไม่ error — ' || coalesce(pg_temp.codeof(r2), 'ok') || ' · drift ' || pg_temp.drift(jb),
    pg_temp.okr(rr) and pg_temp.okr(r1) and pg_temp.okr(r2) and lot is not null and pg_temp.stages_of(lot) = pg_temp.stages_of(jb) and pg_temp.drift(jb) = 0 and not (dr ? '_err'));
  return v;
end;
$c$;

-- tb3: buff/gem_set ไม่ติดกัน -> raise (เคส 4)
create function pg_temp.tb3(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare v text := ''; j uuid; r text;
begin
  j := pg_temp.jid(pg_temp.mk_old_order(p_shop, p_tpl));
  perform pg_temp.guard_off();
  update analytics.job_stage set seq = 50 where job_id = j and stage_code = 'qc';
  update analytics.job_stage set seq = 9 where job_id = j and stage_code = 'gem_set';
  update analytics.job_stage set seq = 8 where job_id = j and stage_code = 'qc';
  perform pg_temp.guard_on();
  r := pg_temp.swap_run();
  v := v || pg_temp.chk('T3', 'เคส 4 (ห้ามผ่าน): buff7 · qc8 · gem_set9 ไม่ติดกัน = swap raise "ไม่ติดกัน" · ไม่สลับ · guard enabled — ' || left(r, 90),
    r like 'ERR:0194:%ไม่ติดกัน%' and pg_temp.sv(j, 7, 'stage_code') = 'buff' and pg_temp.guard_on_ok());
  return v;
end;
$c$;

-- tb4: ใบมีส่วนย่อย -> raise (เคส 4)
create function pg_temp.tb4(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare v text := ''; j uuid; r text; rr jsonb; rs jsonb; v_today date := analytics.job_today();
begin
  j := pg_temp.jid(pg_temp.mk_old_order(p_shop, p_tpl));
  rr := pg_temp.rw(p_shop, j, null, 4);
  perform pg_temp.o_recv(p_shop, j, 5, v_today, null, null, 'verify');
  rs := pg_temp.o_split(p_shop, j, 5, 4);
  r := pg_temp.swap_run();
  v := v || pg_temp.chk('T4', 'เคส 4 (ห้ามผ่าน): ใบมีส่วนย่อย (ขัด/ฝังพลอย pending ทั้งคู่) = swap raise "มีส่วนย่อย" · ไม่สลับ — ' || coalesce(pg_temp.codeof(rs), 'split ok') || ' · ' || left(r, 90),
    pg_temp.okr(rs) and r like 'ERR:0194:%มีส่วนย่อย%' and pg_temp.sv(j, 7, 'stage_code') = 'buff' and pg_temp.guard_on_ok());
  return v;
end;
$c$;

-- tb5: ด่านสำเนาของส่วนย่อย — ทิศ "ไม่ตรงใบแม่" ต้องปฏิเสธ (เคส 2) + ตัวควบคุม: ไม่สลับ = แยกซ้ำผ่าน
create function pg_temp.tb5(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare
  v text := ''; j uuid; c1 uuid; r jsonb; rs jsonb; n0 int; n1 int; j2 uuid; c2 uuid; rs2 jsonb; rr jsonb; v_today date := analytics.job_today();
begin
  -- ตัวควบคุม: ใบแม่ + ส่วนที่ 1 ตามผังเดียวกัน → แยกจากส่วนที่ 1 อีกรอบผ่าน
  j2 := pg_temp.jid(pg_temp.mk_old_order(p_shop, p_tpl));
  rr := pg_temp.rw(p_shop, j2, null, 4);
  perform pg_temp.o_recv(p_shop, j2, 5, v_today, null, null, 'verify');
  rs := pg_temp.o_split(p_shop, j2, 5, 4);
  c2 := pg_temp.lot(rs);
  perform pg_temp.o_recv(p_shop, c2, 6, v_today, null, null, 'verify');
  rs2 := pg_temp.o_split(p_shop, c2, 6, 2);
  v := v || pg_temp.chk('T5a', 'ตัวควบคุม: ส่วนที่ 1 แยกซ้ำจากส่วนที่ 1 ได้เมื่อ seq ตรงใบแม่ — ' || coalesce(pg_temp.codeof(rs), 'ok') || '/' || coalesce(pg_temp.codeof(rs2), 'ok'),
    pg_temp.okr(rs) and pg_temp.okr(rs2) and pg_temp.lot(rs2) is not null);
  -- ของจริง: สลับ seq ใบแม่ด้วยมือ (จำลองใบที่ถูกสลับทั้งที่มีส่วนย่อย) แล้วแยกจากส่วนที่ 1 (ผังเก่า) → ส่วนใหม่ไม่ตรงใบแม่
  j := pg_temp.jid(pg_temp.mk_old_order(p_shop, p_tpl));
  rr := pg_temp.rw(p_shop, j, null, 4);
  perform pg_temp.o_recv(p_shop, j, 5, v_today, null, null, 'verify');
  rs := pg_temp.o_split(p_shop, j, 5, 4);
  c1 := pg_temp.lot(rs);
  perform pg_temp.hand_swap(j);
  perform pg_temp.o_recv(p_shop, c1, 6, v_today, null, null, 'verify');
  select count(*) into n0 from analytics.job where parent_job_id = j;
  r := pg_temp.o_split(p_shop, c1, 6, 2);
  select count(*) into n1 from analytics.job where parent_job_id = j;
  v := v || pg_temp.chk('T5b', 'เคส 2 (ห้ามผ่าน): ส่วนใหม่ที่ (รหัส, seq) ไม่ตรงใบแม่ (ใบแม่สลับแล้ว ส่วนที่ 1 ยังผังเก่า) = ปฏิเสธ split_link · ไม่เกิดส่วนใหม่ — ' || left(coalesce(r ->> '_err', 'ผ่าน?'), 80),
    r ? '_err' and (r ->> '_hint' = 'split_link' or r ->> '_err' like '%สำเนา%') and n0 = n1);
  return v;
end;
$c$;

-- tb6: ใบที่มีส่วนต่าง (ไม่ void) ชี้ขั้น buff/gem_set -> raise ไม่สลับ (L1) · ส่วนต่างที่ถูก void แล้วไม่นับ
-- แถวส่วนต่างสร้างด้วย INSERT ตรง (ด้วย session_replication_role=replica ชั่วคราว ข้ามด่านผู้เขียน/FK) — ขั้น pending ทั้งคู่ไม่มีทางเกิดส่วนต่างผ่าน RPC (ด่านสุดท้ายของ migration จึงทดสอบด้วยแถวจัดฉาก)
create function pg_temp.tb6(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare v text := ''; j uuid; r text; r2 text; v_fin uuid; v_buff uuid; v_gem uuid; d1 uuid;
begin
  j := pg_temp.jid(pg_temp.mk_old_order(p_shop, p_tpl));
  select id into v_fin from analytics.job_stage where job_id = j and stage_code = 'finish';
  select id into v_buff from analytics.job_stage where job_id = j and stage_code = 'buff';
  select id into v_gem from analytics.job_stage where job_id = j and stage_code = 'gem_set';
  execute 'set local session_replication_role = replica';
  insert into analytics.job_discrepancy (shop_id, root_job_id, job_id, from_stage_id, to_stage_id, qty, created_by_actor)
  values (p_shop, j, j, v_fin, v_buff, 1, pg_temp.act()) returning id into d1;
  execute 'set local session_replication_role = origin';
  r := pg_temp.swap_run();
  v := v || pg_temp.chk('T6a', 'L1 (ห้ามผ่าน): ใบมีส่วนต่างที่ชี้ขั้นขัด (ไม่ void) = swap raise "มีส่วนต่าง" · ไม่สลับ · guard enabled — ' || left(r, 90),
    r like 'ERR:0194:%มีส่วนต่าง%' and pg_temp.sv(j, 7, 'stage_code') = 'buff' and pg_temp.guard_on_ok());
  -- ส่วนต่างถูก void แล้ว (แถว void ชี้กลับ) = ไม่นับ → สลับได้
  execute 'set local session_replication_role = replica';
  insert into analytics.job_discrepancy (shop_id, root_job_id, job_id, from_stage_id, to_stage_id, qty, status, void_of_id, void_reason, created_by_actor)
  values (p_shop, j, j, v_fin, v_buff, 1, 'void', d1, 'ยกเลิกเพื่อทดสอบ', pg_temp.act());
  execute 'set local session_replication_role = origin';
  r2 := pg_temp.swap_run();
  v := v || pg_temp.chk('T6b', 'ต้องไม่พัง: ส่วนต่างที่ถูก void แล้วไม่นับ → ใบสลับได้ — ' || left(r2, 60),
    r2 = 'OK' and pg_temp.sv(j, 7, 'stage_code') = 'gem_set' and pg_temp.sv(j, 8, 'stage_code') = 'buff');
  return v;
end;
$c$;

create function pg_temp.run_b_all(p_shop uuid, p_tpl uuid) returns text
 language sql as $c$
  select pg_temp.iso(format('select pg_temp.tb1(%L, %L)', p_shop, p_tpl))
      || pg_temp.iso(format('select pg_temp.tb2(%L, %L)', p_shop, p_tpl))
      || pg_temp.iso(format('select pg_temp.tb3(%L, %L)', p_shop, p_tpl))
      || pg_temp.iso(format('select pg_temp.tb4(%L, %L)', p_shop, p_tpl))
      || pg_temp.iso(format('select pg_temp.tb5(%L, %L)', p_shop, p_tpl))
      || pg_temp.iso(format('select pg_temp.tb6(%L, %L)', p_shop, p_tpl))
$c$;

do $v194b$
declare
  v_shop uuid; v_tpl uuid;
  v_log text := ''; v_s text; v_fail int; v_snap0 text; v_m jsonb; v_killed int := 0; v_total int; v_survived text := ''; v_id text; v_hit int; v_k int; v_cnt int;
  v_mutants jsonb := jsonb_build_array(
    jsonb_build_object('id', 'MB-1', 'what', 'swap194: ถอดด่านติดกัน (buff+1 = gem_set)', 'swap', true, 'from', 'if c.buff_seq + 1 <> c.gem_seq then', 'to', 'if false then', 'expect', jsonb_build_array('T3')),
    jsonb_build_object('id', 'MB-2', 'what', 'swap194: ถอดด่านใบมีส่วนย่อย', 'swap', true, 'from', 'if exists (select 1 from analytics.job k where k.parent_job_id = c.job_id) then', 'to', 'if false then', 'expect', jsonb_build_array('T4')),
    jsonb_build_object('id', 'MB-3', 'what', 'swap194: ลืมเปิด guard กลับ', 'swap', true, 'from', 'perform pg_temp.guard_on();', 'to', 'null;', 'expect', jsonb_build_array('T1a', 'T1c')),
    jsonb_build_object('id', 'MB-4', 'what', 'swap194: ถอดเงื่อนไข pending ทั้งคู่ (ใบที่เริ่มแล้วเข้าเงื่อนไข)', 'swap', true, 'from', 'b.status = ''pending'' and g.status = ''pending'' and', 'to', '', 'expect', jsonb_build_array('T1a', 'T1b')),
    jsonb_build_object('id', 'MB-5', 'what', 'swap194: แตะขั้นอื่นของใบที่สลับ (qc updated_at) — ด่านหลังสลับต้องจับ', 'swap', true, 'from', 'insert into _j194_swapped values (c.job_id, c.buff_id, c.gem_id, c.buff_seq, c.gem_seq);',
       'to', 'update analytics.job_stage set updated_at = now() + interval ''1 second'' where job_id = c.job_id and stage_code = ''qc''; insert into _j194_swapped values (c.job_id, c.buff_id, c.gem_id, c.buff_seq, c.gem_seq);', 'expect', jsonb_build_array('T1a')),
    jsonb_build_object('id', 'MB-7', 'what', 'swap194: ถอดด่านส่วนต่างที่ชี้ขั้นขัด/ฝังพลอย (L1)', 'swap', true, 'from', 'd.status <> ''void'' and (d.from_stage_id in (c.buff_id, c.gem_id) or d.to_stage_id in (c.buff_id, c.gem_id))', 'to', 'false', 'expect', jsonb_build_array('T6a')),
    jsonb_build_object('id', 'MB-6', 'what', 'job_stage_guard: ส่วนย่อยไม่ต้องตรง seq ใบแม่ (เช็คแค่รหัสขั้น)', 'fn', 'job_stage_guard', 'from', 'ps.stage_code = new.stage_code and ps.seq = new.seq', 'to', 'ps.stage_code = new.stage_code', 'expect', jsonb_build_array('T5b'))
  );
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select id into v_shop from public.shop order by created_at limit 1;
  select i.id into v_tpl from analytics.oem_quote_item i join analytics.oem_quote q on q.id = i.quote_id
   where i.shop_id = v_shop and i.input ->> 'metal' = 'silver' and q.quote_no !~ '^V1[0-9]{2}-' order by q.created_at, i.seq limit 1;
  if v_tpl is null then
    v_log := v_log || '[FAIL] S0  ไม่มี oem_quote_item เงินจริงให้ใช้เป็นแม่แบบโคลน' || E'\n';
    raise exception E'%', v_log;
  end if;
  create temp table _v194b_orig on commit drop as
    select p.oid::regprocedure::text as sig, md5(replace(pg_get_functiondef(p.oid), E'\r', '')) as h, p.proacl::text as acl
      from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.prokind in ('f', 'p');
  v_snap0 := pg_temp.snap();
  v_log := v_log || pg_temp.chk('T0', 'ก่อนเริ่ม: trg_job_stage_guard enabled (เคส 13)', pg_temp.guard_on_ok());

  v_s := pg_temp.run_b_all(v_shop, v_tpl);
  v_log := v_log || v_s;
  v_log := v_log || pg_temp.chk('K0', 'ชุดส่วน B ไม่ทิ้งรอย: snapshot ตารางใบงาน/ทะเบียน/ช่าง/แบบ/ใบเสนอราคา/shop เท่าเดิม · guard enabled', pg_temp.snap() = v_snap0 and pg_temp.guard_on_ok());
  v_cnt := (length(v_s) - length(replace(v_s, '[OK]', ''))) / 4;

  v_total := jsonb_array_length(v_mutants);
  for v_k in 0 .. v_total - 1 loop
    v_m := v_mutants -> v_k;
    v_s := '';
    begin
      if v_m ? 'swap' then
        perform pg_temp.swap_mut(v_m ->> 'from', v_m ->> 'to');
      else
        perform pg_temp.mutate(v_m ->> 'fn', v_m ->> 'from', v_m ->> 'to');
      end if;
      v_s := pg_temp.run_b_all(v_shop, v_tpl);
      raise exception 'MX_ROLLBACK';
    exception when others then
      if sqlerrm <> 'MX_ROLLBACK' then
        v_s := v_s || '[FAIL] MX-crash-' || (v_m ->> 'id') || '  ' || sqlerrm || E'\n';
      end if;
    end;
    v_hit := 0;
    for v_id in select jsonb_array_elements_text(v_m -> 'expect') loop
      if position('[FAIL] ' || v_id || ' ' in v_s) > 0 then v_hit := v_hit + 1; end if;
    end loop;
    if v_hit > 0 then
      v_killed := v_killed + 1;
      v_log := v_log || format('[OK] %s  mutant ถูกจับ (%s จาก %s id ที่คาด ล้ม): %s', v_m ->> 'id', v_hit, jsonb_array_length(v_m -> 'expect'), v_m ->> 'what') || E'\n';
    else
      v_survived := v_survived || (v_m ->> 'id') || ' ';
      v_log := v_log || format('[FAIL] %s  mutant รอด (ไม่มี id ที่คาด %s ล้มเลย): %s', v_m ->> 'id', v_m -> 'expect', v_m ->> 'what') || E'\n';
    end if;
  end loop;
  v_log := v_log || pg_temp.chk('MX', format('mutant ถูกจับครบ %s/%s ตัว %s', v_killed, v_total, case when v_survived = '' then '' else 'รอด: ' || v_survived end), v_killed = v_total);

  select count(*) into v_hit from _v194b_orig o join pg_proc p on p.pronamespace = 'analytics'::regnamespace and p.prokind in ('f', 'p') and p.oid::regprocedure::text = o.sig where md5(replace(pg_get_functiondef(p.oid), E'\r', '')) = o.h and p.proacl::text is not distinct from o.acl;
  v_log := v_log || pg_temp.chk('MY', format('หลัง mutant: md5 นิยาม + สิทธิ์ของฟังก์ชันทุกตัวในสคีมา analytics (%s ตัว) เท่าเดิมเป๊ะ', (select count(*) from _v194b_orig)),
    v_hit = (select count(*) from _v194b_orig) and (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace and prokind in ('f', 'p')) = (select count(*) from _v194b_orig));
  v_log := v_log || pg_temp.chk('K0b', 'state ไม่ขยับหลังรัน mutant ทั้งหมด · guard enabled', pg_temp.snap() = v_snap0 and pg_temp.guard_on_ok());

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_log := v_log || format(E'\n=== สรุป (ส่วน B): [OK] ~%s (ชุดหลัก) · mutant %s ตัว · [SKIP] %s · [FAIL] ทั้งไฟล์ = %s %s ===\n', v_cnt, v_total,
    (length(v_log) - length(replace(v_log, '[SKIP]', ''))) / 6, v_fail, case when v_fail = 0 then '(ผ่าน)' else '(ไม่ผ่าน)' end);
  raise exception E'%', v_log;
end;
$v194b$;
