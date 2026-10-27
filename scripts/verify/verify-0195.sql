-- scripts/verify/verify-0195.sql
-- ตรวจ supabase/migrations/0195_gold_weigh_exempt_buff.sql (ใบทองไม่บังคับชั่งขั้นขัด · job_stage_def.gold_weigh_exempt)
-- self-rolling-back (3j-migration-traps ข้อ 11) · ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน · [SKIP] ไม่นับเป็นผ่าน
-- ข้อมูลทดสอบสร้างผ่าน RPC ของระบบ (ใบ/แบบบันทึก/ช่าง) · ข้อยกเว้นที่บอกตรงๆ (ในทรานแซกชันที่ถอยกลับ): ใบเสนอราคา OEM = โคลนจากรายการจริงด้วย INSERT · ร้านใหม่ (public.shop) = INSERT ·
--   C3 ตั้ง gold_weigh_exempt=true บนขั้นที่ไม่มีโลหะด้วย UPDATE ชั่วคราว · mutant ใช้ UPDATE/create or replace ของจริงแล้วถอยกลับ
-- 🔴 ต้องรัน "หลัง apply 0194 + 0195" เท่านั้น (ไม่มีคอลัมน์ใหม่ = S0b FAIL) — dry-run ก่อน apply: ต่อ 0194 (ตัด PART B ถ้ากลางวัน) + 0195 + ไฟล์นี้ (LF) ใน transaction เดียว
--   ⚠️ ต่อแบบนั้นถือ ACCESS EXCLUSIVE บน job_stage_def (จาก add column ใน 0195) ตลอดเวลารันไฟล์นี้ (หลายนาที) ⇒ รันนอกเวลางานเท่านั้น
-- 🔴 สร้างใบงานทดสอบหลายสิบใบ + mutant 7 ตัว — ล็อกแถว job_counter ช่วงรัน
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0195.sql
--
-- ============ ตารางแมป design-0195 ข้อ 4 -> เทสต์ที่ครอบ ============
--  ห้ามผ่าน
--   1 ใบทอง ขั้น gem_set/plating/qc/pack ไม่ติ๊กชั่ง -> gold_unguarded=true ทั้ง state และ board (mutant: exempt ที่ gem_set) -> C1-gem_set C1-plating C1-qc C1-pack · MV-1
--   2 แบบทองใหม่ที่ไม่ติ๊ก cast (และ cut_sprue/finish) -> ติดป้าย (กฎเดิมไม่หลวม)                                          -> C1-cast C1-cut_sprue C1-finish
--   3 exempt=true แต่ metal_present=false -> ไม่ทำให้ตั้งชั่งบนขั้นไม่มีโลหะได้ (22023 ยังเกิด)                            -> C3 · C3b (exempt เฉพาะ buff)
--   4 ensure ร้านใหม่: buff exempt อื่น false · เรียกซ้ำไม่เพิ่ม · profile_ensure ร้านใหม่ แบบทอง buff ไม่ชั่ง           -> D1 D2 D3 · MV-4 MV-5
--   5 migration 2 รอบ รอบสองไม่แตะอะไร                                                                                -> D4 (ensure ซ้ำบนร้านจริง) · ทั้งไฟล์ migration 2 รอบ = dry-run แยก (ตามรายงานส่งงาน — ครอบแล้วด้วย dbl dry-run)
--  ต้องไม่พัง
--   6 ใบทองใหม่จากแบบทอง: buff weigh=false · gold_unguarded=false · has_weigh=true · job_done ยังบังคับน้ำหนักสุทธิ ·
--     รับ plating ไม่เทียบกับ buff · v_job_stage_loss.buff.not_weighed=true                                              -> E1 E2 E3 E4 · MV-2 MV-3 MV-7
--   7 ใบที่สร้างก่อน 0195 (buff ชั่ง): ชั่ง buff ต่อได้ · gold_unguarded=false · เปลี่ยนแบบก่อนเริ่ม -> buff ไม่ชั่ง       -> E5 E6 E7  (จำลองด้วยแบบทองที่ชั่ง buff — ผลต่อ flag ของใบเหมือนกัน)
--   8 ใบเงิน/ทุก status: gold_unguarded=false เหมือนเดิม · บอร์ดเปิดได้ · stage_suggest/profile_list คืน key ใหม่ครบ        -> F1 F2 F3 F4 · MV-6
--   9 ใบทองเก่า profile_id null ไม่ error                                                                             -> F5 (SKIP ถ้าไม่มีใบแบบนี้บน DB — ตอนเขียนไม่มี)
--  ข้อเพิ่มรอบแก้หลัง security/QA:
--   M2 ของเสียทองต้องมีน้ำหนักเสมอ (job_lot_cancel_core): ใบทองแยกที่ขั้นขัด (ไม่ชั่ง) ยกเลิกเป็นของเสียโดยไม่มีน้ำหนัก = ปฏิเสธ · ใบเงินยกเลิกของเสียไม่ชั่ง = ผ่านเหมือนเดิม · ก่อนมีโลหะ/ชั้นชั่ง/คืนชิ้น ไม่เปลี่ยน -> M1 M1b M1c M2 M3 M4 M5 · MV-8 MV-9
--   L2 rename แบบทองปริยายชนชื่อแบบอื่น -> pre-check raise                                                               -> D6 (ตัวตรวจ) + dry-run pre-check แยก (conflict)
--   CRLF: md5 ตัด \r ทุกจุด · mutant ตัด \r (pg_temp.mutate / mutate_view) — รันจากสำเนา LF เหมือนเดิม (ข้อ 20 ของ 3j-migration-traps)
--  K0: ชุดทดสอบทั้งชุดไม่ทิ้งรอย · MY: md5 ฟังก์ชันเท่าเดิมหลัง mutant · P1: ไม่มี overload/สิทธิ์
--
--  ❌ ไม่มีเทสต์ครอบ (บอกตรงๆ):
--    - ฝั่ง TS ป้ายบน ProfileEditor/JobCreateDialog = vitest (lib/jobs/profile.test.ts ฯลฯ) ไม่ใช่ไฟล์นี้ · race 2 connection
--    - "ไม่แตะใบงานที่สร้างแล้ว / แถวแบบอื่น" ของ migration ครอบด้วยด่านท้ายไฟล์ migration เอง (ทำงานตอน apply) ไม่ใช่ในไฟล์นี้
--    - ไฟล์นี้ยังไม่เคยรันจริง ณ ตอนส่งงาน (ต้องรันนอกเวลางานหลัง 0194+0195) — เคยตรวจแค่ไวยากรณ์ plpgsql ตอนสร้างฟังก์ชัน
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
  v_def := replace(pg_get_viewdef(('analytics.' || p_name)::regclass, true), E'\r', '');
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

-- ===== C1-C3: ห้ามผ่าน — exempt ไม่หลุดไปขั้นอื่น (เคส 1 2 3) =====
create function pg_temp.run_c(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare
  v text := ''; t text; pf uuid; d jsonb; j uuid; r jsonb; n int;
begin
  -- ชั่งทุกขั้นที่มีโลหะ ยกเว้น buff และขั้น t ⇒ ใบทองต้องติดป้าย gold_unguarded (ทั้ง job_profile_state และ v_job_board) — เฉพาะ buff เท่านั้นที่ไม่ติด
  foreach t in array array['cast', 'cut_sprue', 'finish', 'gem_set', 'plating', 'qc', 'pack'] loop
    pf := pg_temp.mkprof_gold(p_shop, 'v195-ทอง-ไม่ชั่ง-' || t, t);
    d := pg_temp.mkp(p_shop, p_tpl, 'gold', pf, pg_temp.gold_codes(), 10);
    j := pg_temp.jid(d);
    v := v || pg_temp.chk('C1-' || t, 'เคส 1/2 (ห้ามผ่าน): ใบทอง ไม่ติ๊กชั่งขั้น ' || t || ' (ชั่งขั้นอื่น ยกเว้นขัด) = gold_unguarded true ทั้ง job_profile_state และ v_job_board — state ' || coalesce(pg_temp.gu_state(j), '?') || ' · board ' || coalesce(pg_temp.gu_board(j), '?'),
      j is not null and pg_temp.gu_state(j) = 'true' and pg_temp.gu_board(j) = 'true');
  end loop;
  -- ตัวควบคุม: ชั่งทุกขั้นที่มีโลหะ ยกเว้นขัด ⇒ ไม่ติดป้าย
  pf := pg_temp.mkprof_gold(p_shop, 'v195-ทอง-ครบยกเว้นขัด', null);
  d := pg_temp.mkp(p_shop, p_tpl, 'gold', pf, pg_temp.gold_codes(), 10);
  j := pg_temp.jid(d);
  v := v || pg_temp.chk('C1-ctl', 'ต้องไม่พัง: ใบทองชั่งทุกขั้นที่มีโลหะ ยกเว้นขัด = gold_unguarded false (ขัดไม่ชั่งไม่ติดป้าย) ทั้ง state และ board — state ' || coalesce(pg_temp.gu_state(j), '?') || ' · board ' || coalesce(pg_temp.gu_board(j), '?'),
    j is not null and pg_temp.gu_state(j) = 'false' and pg_temp.gu_board(j) = 'false' and pg_temp.sv(j, 8, 'stage_code') = 'buff' and pg_temp.sv(j, 8, 'weigh_required') = 'false');
  -- เคส 3: exempt=true บนขั้นที่ไม่มีโลหะ (wax_inject) ไม่ทำให้ตั้งชั่งบนขั้นนั้นได้ (ด่านแบบบันทึกยังตรวจ metal_present)
  update analytics.job_stage_def set gold_weigh_exempt = true where shop_id = p_shop and code = 'wax_inject';
  r := pg_temp.pu(p_shop, null, 'v195-ชั่งเทียน', null, '[{"stage_code":"wax_inject","weigh":true,"scrap_qty":false,"scrap_weight":false}]');
  v := v || pg_temp.chk('C3', 'เคส 3 (ห้ามผ่าน): ขั้น wax_inject exempt=true แต่ไม่มีโลหะ — ตั้งชั่งในแบบไม่ได้ (22023 ไม่มีโลหะอยู่ในมือ) — ' || left(coalesce(r ->> '_err', 'ผ่าน?'), 70),
    r ? '_err' and r ->> '_state' = '22023' and (r ->> '_err') like '%ไม่มีโลหะอยู่ในมือ%');
  update analytics.job_stage_def set gold_weigh_exempt = false where shop_id = p_shop and code = 'wax_inject';
  select count(*) into n from analytics.job_stage_def where shop_id = p_shop and gold_weigh_exempt and code <> 'buff';
  v := v || pg_temp.chk('C3b', 'ทะเบียนร้านจริง: gold_weigh_exempt เป็น true เฉพาะ buff — ขั้นอื่นผิด ' || n || ' แถว', n = 0 and (select gold_weigh_exempt from analytics.job_stage_def where shop_id = p_shop and code = 'buff'));
  return v;
end;
$c$;

-- ===== D: ensure/seed ร้านใหม่ (เคส 4) + ร้านจริงเรียกซ้ำไม่ขยับ (เคส 5) =====
create function pg_temp.run_d(p_shop uuid) returns text
 language plpgsql as $c$
declare
  v text := ''; v_s uuid; n int; n2 int; m1 text; m2 text; v_gold uuid; s text;
begin
  insert into public.shop (name) values ('verify-0195-ร้านใหม่') returning id into v_s;
  perform analytics.job_stage_def_ensure(v_s);
  select count(*) into n from analytics.job_stage_def where shop_id = v_s and gold_weigh_exempt;
  select count(*) into n2 from analytics.job_stage_def where shop_id = v_s and gold_weigh_exempt and code = 'buff';
  v := v || pg_temp.chk('D1', 'เคส 4: job_stage_def_ensure ร้านใหม่ — buff exempt true เป็นแถวเดียว · อื่น false (' || n || '/' || n2 || ')', n = 1 and n2 = 1);
  perform analytics.job_stage_def_ensure(v_s);
  select count(*) into n from analytics.job_stage_def where shop_id = v_s;
  v := v || pg_temp.chk('D2', 'เคส 4/5: ensure ซ้ำบนร้านใหม่ยัง 14 แถว (' || n || ')', n = 14);
  perform analytics.job_record_profile_ensure(v_s);
  select p.id into v_gold from analytics.job_record_profile p where p.shop_id = v_s and p.is_default_gold;
  select count(*) filter (where ps.weigh), count(*) filter (where ps.stage_code = 'buff' and not ps.weigh) into n, n2
    from analytics.job_record_profile_stage ps where ps.profile_id = v_gold;
  select name into s from analytics.job_record_profile where id = v_gold;
  v := v || pg_temp.chk('D3', 'เคส 4: job_record_profile_ensure ร้านใหม่ — แบบทองปริยายชั่ง 7 ขั้น (ทุกขั้นที่มีโลหะ ยกเว้น buff) · buff ไม่ชั่ง · ชื่อใหม่ — ชั่ง ' || n || ' · buff ไม่ชั่ง ' || n2 || ' · ' || coalesce(s, 'null'),
    n = 7 and n2 = 1 and s = 'ทอง — ชั่งทุกขั้นที่มีโลหะ (ยกเว้นขัด) + ชั่งสุทธิตอนปิด');
  -- ร้านจริง: ensure ซ้ำ ไม่ขยับทะเบียน/แบบ
  select md5(coalesce((select string_agg(d::text, '|' order by d.code) from analytics.job_stage_def d where d.shop_id = p_shop), '') || '#' ||
             coalesce((select string_agg(x::text, '|' order by x.id, x.stage_code) from analytics.job_record_profile_stage x where x.shop_id = p_shop), '') || '#' ||
             coalesce((select string_agg(x::text, '|' order by x.id) from analytics.job_record_profile x where x.shop_id = p_shop), '')) into m1;
  perform analytics.job_stage_def_ensure(p_shop);
  perform analytics.job_record_profile_ensure(p_shop);
  select md5(coalesce((select string_agg(d::text, '|' order by d.code) from analytics.job_stage_def d where d.shop_id = p_shop), '') || '#' ||
             coalesce((select string_agg(x::text, '|' order by x.id, x.stage_code) from analytics.job_record_profile_stage x where x.shop_id = p_shop), '') || '#' ||
             coalesce((select string_agg(x::text, '|' order by x.id) from analytics.job_record_profile x where x.shop_id = p_shop), '')) into m2;
  v := v || pg_temp.chk('D4', 'เคส 5: ensure ทะเบียน+แบบ ซ้ำบนร้านจริง = ไม่ขยับอะไร (md5 ทะเบียน/แบบ/ขั้นของแบบเท่าเดิม) · ทั้งไฟล์ migration รัน 2 รอบ = dry-run แยก (ตามรายงานส่งงาน)', m1 = m2);
  -- L2: query เดียวกับ pre-check ของ 0195 — เจอแบบอื่นใช้ชื่อใหม่ (ไม่สนตัวพิมพ์) ขณะแบบทองปริยายยังชื่อเดิม = นับ > 0 (migration raise) · ไม่มีชนหรือ rename แล้ว = 0
  update analytics.job_record_profile set name = 'ทอง — ชั่งทุกขั้นที่มีโลหะ + ชั่งสุทธิตอนปิด' where shop_id = p_shop and is_default_gold;
  select count(*) into n from analytics.job_record_profile g join analytics.job_record_profile o on o.shop_id = g.shop_id and o.id <> g.id and lower(o.name) = lower('ทอง — ชั่งทุกขั้นที่มีโลหะ (ยกเว้นขัด) + ชั่งสุทธิตอนปิด')
   where g.is_default_gold and g.name = 'ทอง — ชั่งทุกขั้นที่มีโลหะ + ชั่งสุทธิตอนปิด' and g.shop_id = p_shop;
  insert into analytics.job_record_profile (shop_id, name, note, seq) values (p_shop, 'ทอง — ชั่งทุกขั้นที่มีโลหะ (ยกเว้นขัด) + ชั่งสุทธิตอนปิด', 'แบบชนชื่อ (ทดสอบ L2)', 99);
  select count(*) into n2 from analytics.job_record_profile g join analytics.job_record_profile o on o.shop_id = g.shop_id and o.id <> g.id and lower(o.name) = lower('ทอง — ชั่งทุกขั้นที่มีโลหะ (ยกเว้นขัด) + ชั่งสุทธิตอนปิด')
   where g.is_default_gold and g.name = 'ทอง — ชั่งทุกขั้นที่มีโลหะ + ชั่งสุทธิตอนปิด' and g.shop_id = p_shop;
  v := v || pg_temp.chk('D6', 'L2: ตัวตรวจชนชื่อ — ไม่มีแบบอื่นใช้ชื่อใหม่ = 0 · มีแบบอื่นใช้ชื่อใหม่ = 1 (pre-check ของ 0195 จะ raise) — ' || n || '/' || n2, n = 0 and n2 = 1);
  -- แบบทองปริยายของร้านจริง: buff ไม่ชั่ง · ขั้นอื่นที่มีโลหะ (เปิดใช้งาน) ชั่ง
  select count(*) into n from analytics.job_record_profile_stage ps join analytics.job_record_profile p on p.id = ps.profile_id
   where p.shop_id = p_shop and p.is_default_gold and ps.stage_code = 'buff' and ps.weigh;
  v := v || pg_temp.chk('D5', 'ร้านจริง: แบบทองปริยาย buff ไม่ชั่ง (ผิด ' || n || ' แบบ) · ขั้นอื่นของแบบ (ที่ผู้ใช้อาจตั้งเอง) ไม่ตรวจที่นี่', n = 0);
  return v;
end;
$c$;

-- ===== E: ใบทองใหม่จากแบบทองปริยาย เดินผ่านขัดไม่ชั่ง (เคส 6) + ใบก่อน 0195 (เคส 7) =====
create function pg_temp.run_e(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare
  v text := ''; d jsonb; j uuid; rr jsonb; r jsonb; r2 jsonb; v_today date := analytics.job_today(); l jsonb; st jsonb; j2 uuid; pf uuid; r3 jsonb;
begin
  d := pg_temp.mkp(p_shop, p_tpl, 'gold', pg_temp.pid(p_shop, 'gold'), pg_temp.gold_codes(), 10);
  j := pg_temp.jid(d);
  st := analytics.job_profile_state(j);
  v := v || pg_temp.chk('E1', 'เคส 6: ใบทองใหม่จากแบบทองปริยาย — buff weigh_required=false · gem_set/plating ชั่ง · gold_unguarded false (state+board) · has_weigh true — ' || coalesce(pg_temp.flags_of(j), d::text),
    j is not null and pg_temp.sv(j, 8, 'stage_code') = 'buff' and pg_temp.sv(j, 8, 'weigh_required') = 'false' and pg_temp.sv(j, 7, 'weigh_required') = 'true' and pg_temp.sv(j, 9, 'weigh_required') = 'true'
    and (st ->> 'gold_unguarded') = 'false' and pg_temp.gu_board(j) = 'false' and (st ->> 'has_weigh') = 'true');
  rr := pg_temp.rwg(p_shop, j, 10, 8);
  r := pg_temp.o_recv(p_shop, j, 9, v_today, 12, null, 'verify');
  v := v || pg_temp.chk('E2', 'เคส 6: เดิน finish(ชั่ง) → gem_set(ชั่ง) → buff(ไม่ชั่ง) แล้วรับ plating น้ำหนัก 12 — ไม่เทียบกับ buff (ขั้นก่อนไม่ชั่ง) ไม่ handoff_mismatch — ' || coalesce(pg_temp.codeof(rr), 'ok') || '/' || coalesce(pg_temp.codeof(r), 'ok'),
    pg_temp.okr(rr) and pg_temp.okr(r) and pg_temp.sv(j, 9, 'status') = 'received');
  l := pg_temp.q(format('select to_jsonb(l) from analytics.v_job_stage_loss l where l.job_id = %L and l.stage_code = %L', j, 'buff'));
  v := v || pg_temp.chk('E3', 'เคส 6: v_job_stage_loss แถว buff not_weighed = true (ทองหายตอนขัดดูได้ที่นี่ + ยอดรวมตอนปิดงาน) — ' || left(l::text, 60), (l ->> 'not_weighed') = 'true');
  r := pg_temp.o_send(p_shop, j, 9, v_today, 12);
  rr := pg_temp.rwg(p_shop, j, 12, 11);
  r2 := pg_temp.o_done(p_shop, j, 10, 0, null);
  r3 := pg_temp.o_done(p_shop, j, 10, 0, 9.5);
  v := v || pg_temp.chk('E4', 'เคส 6: job_done ใบทองไม่ใส่น้ำหนักสุทธิ = ปฏิเสธ weight_required (ยังบังคับ) · ใส่แล้วผ่าน — ' || coalesce(pg_temp.codeof(r2), 'ok') || '/' || coalesce(pg_temp.codeof(r3), 'ok'),
    pg_temp.okr(r) and pg_temp.okr(rr) and pg_temp.rej(r2, 'weight_required') and pg_temp.okr(r3) and (select status from analytics.job where id = j) = 'done');
  -- เคส 7: จำลองใบที่สร้างก่อน 0195 (buff ชั่ง) — สร้างจากแบบทองที่ชั่ง buff ด้วย (ผลต่อ flag ของใบ = เหมือนแบบทองปริยายก่อน 0195)
  pf := pg_temp.mkprof_gold(p_shop, 'v195-ทอง-ชั่งรวมขัด', null, true);
  d := pg_temp.mkp(p_shop, p_tpl, 'gold', pf, pg_temp.gold_codes(), 10);
  j2 := pg_temp.jid(d);
  st := analytics.job_profile_state(j2);
  v := v || pg_temp.chk('E5', 'เคส 7: ใบทองที่สร้างตอน buff ยังชั่ง (ก่อน 0195) — buff weigh_required=true คงเดิม · gold_unguarded false (state+board) — ' || coalesce(pg_temp.sv(j2, 8, 'weigh_required'), '?'),
    j2 is not null and pg_temp.sv(j2, 8, 'weigh_required') = 'true' and (st ->> 'gold_unguarded') = 'false' and pg_temp.gu_board(j2) = 'false');
  rr := pg_temp.rwg(p_shop, j2, 10, 7);
  r := pg_temp.o_recv(p_shop, j2, 8, v_today, null, null, 'verify');
  r2 := pg_temp.o_recv(p_shop, j2, 8, v_today, 10, null, 'verify');
  v := v || pg_temp.chk('E6', 'เคส 7: ใบเดิม (buff ชั่ง) รับ buff โดยไม่ชั่ง = weight_required · ชั่งแล้วรับได้ — ' || coalesce(pg_temp.codeof(r), 'ok') || '/' || coalesce(pg_temp.codeof(r2), 'ok'),
    pg_temp.codeof(r) = 'weight_required' and pg_temp.okr(r2) and pg_temp.sv(j2, 8, 'status') = 'received');
  -- เปลี่ยนแบบก่อนเริ่ม: ใบใหม่ (ยังไม่มีขั้นไหนถูกรับ) ที่ buff ชั่ง -> เปลี่ยนเป็นแบบทองปริยายปัจจุบัน (buff ไม่ชั่ง)
  d := pg_temp.mkp(p_shop, p_tpl, 'gold', pf, pg_temp.gold_codes(), 10);
  j2 := pg_temp.jid(d);
  r := pg_temp.o_pset(p_shop, j2, pg_temp.pid(p_shop, 'gold'));
  v := v || pg_temp.chk('E7', 'เคส 7: ใบที่ยังไม่เริ่ม (buff ชั่ง) เปลี่ยนแบบเป็นแบบทองปริยายปัจจุบัน → buff กลายเป็นไม่ชั่ง — ' || coalesce(pg_temp.codeof(r), 'ok'),
    pg_temp.okr(r) and pg_temp.sv(j2, 8, 'weigh_required') = 'false');
  return v;
end;
$c$;

-- ===== F: ใบเงิน/ใบทั้งหมดที่มีจริง + key ใหม่ครบ (เคส 8 9) =====
create function pg_temp.run_f(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare
  v text := ''; n int; n2 int; r jsonb; d jsonb; k int; k2 int; r2 jsonb; nb int;
begin
  -- บอร์ดเปิดได้ · ใบที่ไม่ใช่ทองไม่ติดป้ายเลย (เหมือนเดิม) — ทุก status ที่มีจริง
  select count(*), count(*) filter (where metal <> 'gold' and gold_unguarded) into n, n2 from analytics.v_job_board;
  v := v || pg_temp.chk('F1', 'เคส 8: v_job_board เปิดได้ (' || n || ' ใบ) · ใบที่ไม่ใช่ทอง gold_unguarded = true ' || n2 || ' ใบ (ต้อง 0)', n > 0 and n2 = 0);
  select count(*) into n from analytics.job j where j.metal = 'gold' and j.status not in ('done', 'cancelled')
     and (analytics.job_profile_state(j.id) ->> 'gold_unguarded')::boolean is distinct from (select b.gold_unguarded from analytics.v_job_board b where b.id = j.id);
  v := v || pg_temp.chk('F2', 'เคส 8: ใบทองที่เปิดอยู่ทุกใบ gold_unguarded ของ job_profile_state = ของ v_job_board (ผิด ' || n || ' ใบ)', n = 0);
  -- key ใหม่ครบ
  r := pg_temp.q(format('select analytics.job_record_profile_list(%L)', p_shop));
  select count(*), count(*) filter (where e ? 'gold_weigh_exempt' and jsonb_typeof(e -> 'gold_weigh_exempt') = 'boolean'),
         count(*) filter (where (e ->> 'gold_weigh_exempt') = 'true' and e ->> 'code' = 'buff')
    into n, k, k2 from jsonb_array_elements(coalesce(r -> 'stage_defs', '[]'::jsonb)) e;
  v := v || pg_temp.chk('F3', 'เคส 8: job_record_profile_list.stage_defs ทุกขั้นมี key gold_weigh_exempt (boolean) · true เฉพาะ buff — ' || k || '/' || n || ' · buff true ' || k2, n > 0 and n = k and k2 = 1
    and (select count(*) from jsonb_array_elements(r -> 'stage_defs') e where (e ->> 'gold_weigh_exempt') = 'true') = 1);
  d := pg_temp.clone_deal(p_tpl, 'gold', 10);
  r2 := pg_temp.q(format('select analytics.job_stage_suggest(%L, %L, %L)', p_shop, 'oem', d ->> 'item_id'));
  select count(*), count(*) filter (where e ? 'gold_weigh_exempt' and jsonb_typeof(e -> 'gold_weigh_exempt') = 'boolean'),
         count(*) filter (where (e ->> 'gold_weigh_exempt') = 'true')
    into n, k, k2 from jsonb_array_elements(coalesce(r2 -> 'stages', '[]'::jsonb)) e;
  v := v || pg_temp.chk('F4', 'เคส 8: job_stage_suggest.stages ทุกขั้นมี key gold_weigh_exempt (boolean) · true 1 ขั้น (buff) — ' || k || '/' || n || ' · true ' || k2, n > 0 and n = k and k2 = 1);
  -- เคส 9: ใบทองที่ profile_id null — ถ้ามี
  select count(*) into nb from analytics.job j where j.metal = 'gold' and j.profile_id is null;
  if nb = 0 then
    v := v || '[SKIP] F5  เคส 9: ไม่มีใบทองที่ profile_id null บน DB (ไม่ได้ทดสอบ)' || E'\n';
  else
    select count(*) into n from analytics.job j where j.metal = 'gold' and j.profile_id is null and (analytics.job_profile_state(j.id) ->> 'gold_unguarded') is null;
    v := v || pg_temp.chk('F5', 'เคส 9: ใบทองเก่า profile_id null ไม่ error · gold_unguarded ไม่ null', n = 0);
  end if;
  return v;
end;
$c$;


-- ===== M: ของเสียทองต้องมีน้ำหนักเสมอ (M2 · job_lot_cancel_core) =====
create function pg_temp.lot(r jsonb) returns uuid language sql as $c$ select (r ->> 'lot_job_id')::uuid $c$;
create function pg_temp.o_lcancel(p_shop uuid, p_lot uuid, p_reason text, p_disp text, p_sreason text default null, p_sw numeric default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_lot_cancel(p_shop_id=>%L, p_lot_job_id=>%L, p_reason=>%L, p_disposition=>%L, p_scrap_reason=>%L, p_actor=>%L, p_scrap_weight_g=>%L)',
    p_shop, p_lot, p_reason, p_disp, p_sreason, pg_temp.act(), p_sw)) $c$;
create function pg_temp.o_split_raw(p_shop uuid, p_job uuid, p_seq int, p_qty int, p_scrap int, p_reason text, p_hold int, p_wmove numeric) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_lot_split(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_qty=>%L, p_qty_scrap=>%L, p_scrap_reason=>%L, p_qty_hold=>%L, p_actor=>%L, p_weight_move_g=>%L)',
    p_shop, p_job, p_seq, p_qty, p_scrap, p_reason, p_hold, pg_temp.act(), p_wmove)) $c$;
create function pg_temp.run_m(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare
  v text := ''; pf uuid; d jsonb; j uuid; rr jsonb; r jsonb; rs jsonb; lot uuid; r2 jsonb; r3 jsonb; v_today date := analytics.job_today(); st text; w numeric;
begin
  -- M1: ใบทอง (แบบที่ไม่ชั่งขัด) เดินถึงขัด รับขัดแล้วแยกส่วนที่ขัด (นับจำนวนอย่างเดียว) → ยกเลิกส่วนเป็นของเสียโดยไม่มีน้ำหนัก = ต้องถูกปฏิเสธ
  pf := pg_temp.mkprof_gold(p_shop, 'v195-M2-ทองไม่ชั่งขัด', null);
  d := pg_temp.mkp(p_shop, p_tpl, 'gold', pf, pg_temp.gold_codes(), 10);
  j := pg_temp.jid(d);
  rr := pg_temp.rwg(p_shop, j, 10, 7);
  r := pg_temp.o_recv(p_shop, j, 8, v_today, null, null, 'verify');
  rs := pg_temp.o_split(p_shop, j, 8, 4);
  lot := pg_temp.lot(rs);
  r2 := pg_temp.o_lcancel(p_shop, lot, 'ทดสอบ M2', 'scrap', 'broken', null);
  select status into st from analytics.job where id = lot;
  v := v || pg_temp.chk('M1', 'M2 (ห้ามผ่าน): ใบทองแยกที่ขั้นขัด (ไม่ชั่ง) แล้วยกเลิกเป็นของเสียโดยไม่มีน้ำหนัก = ปฏิเสธ scrap_weight_required · ส่วนยังไม่ถูกยกเลิก — ' || coalesce(pg_temp.codeof(r2), 'ผ่าน?') || ' · split ' || coalesce(pg_temp.codeof(rs), 'ok'),
    pg_temp.okr(rr) and pg_temp.okr(r) and pg_temp.okr(rs) and lot is not null and pg_temp.codeof(r2) = 'scrap_weight_required' and st <> 'cancelled');
  r3 := pg_temp.o_lcancel(p_shop, lot, 'ทดสอบ M2', 'scrap', 'broken', 3.5);
  select status, cancel_scrap_weight_g into st, w from analytics.job where id = lot;
  v := v || pg_temp.chk('M1b', 'ต้องไม่พัง: ใบเดียวกัน ใส่น้ำหนักของเสีย 3.5 g (ส่วนที่ไม่เคยชั่ง — เพดานใช้น้ำหนักสูงสุดของใบแม่ 10 g) = ผ่าน · เก็บ cancel_scrap_weight_g — ' || coalesce(pg_temp.codeof(r3), 'ok'),
    pg_temp.okr(r3) and st = 'cancelled' and w = 3.5);
  -- เกินน้ำหนักสูงสุดของใบแม่ = weight_over (เพดานยังทำงาน)
  d := pg_temp.mkp(p_shop, p_tpl, 'gold', pf, pg_temp.gold_codes(), 10);
  j := pg_temp.jid(d);
  rr := pg_temp.rwg(p_shop, j, 10, 7);
  r := pg_temp.o_recv(p_shop, j, 8, v_today, null, null, 'verify');
  rs := pg_temp.o_split(p_shop, j, 8, 4);
  lot := pg_temp.lot(rs);
  r2 := pg_temp.o_lcancel(p_shop, lot, 'ทดสอบ M2', 'scrap', 'broken', 99);
  v := v || pg_temp.chk('M1c', 'ห้ามผ่าน: น้ำหนักของเสีย 99 g มากกว่าน้ำหนักสูงสุดของใบแม่ (10 g) = weight_over — ' || coalesce(pg_temp.codeof(r2), 'ผ่าน?'), pg_temp.codeof(r2) = 'weight_over');
  -- M2: ใบเงิน ยกเลิกส่วนเป็นของเสียโดยไม่ชั่ง = ผ่านเหมือนเดิม · ใส่น้ำหนักมา = weight_unexpected (เหมือนเดิม)
  d := pg_temp.mkp(p_shop, p_tpl, 'silver', pg_temp.pid(p_shop, 'none'), pg_temp.gold_codes(), 10);
  j := pg_temp.jid(d);
  rr := pg_temp.rwg(p_shop, j, null, 7);
  r := pg_temp.o_recv(p_shop, j, 8, v_today, null, null, 'verify');
  rs := pg_temp.o_split(p_shop, j, 8, 4);
  lot := pg_temp.lot(rs);
  r2 := pg_temp.o_lcancel(p_shop, lot, 'ทดสอบ M2', 'scrap', 'broken', 1);
  r3 := pg_temp.o_lcancel(p_shop, lot, 'ทดสอบ M2', 'scrap', 'broken', null);
  select status into st from analytics.job where id = lot;
  v := v || pg_temp.chk('M2', 'ต้องไม่พัง: ใบเงินยกเลิกส่วนเป็นของเสียโดยไม่ชั่ง = ผ่าน · ส่งน้ำหนักมา = weight_unexpected — ' || coalesce(pg_temp.codeof(r2), 'ok') || '/' || coalesce(pg_temp.codeof(r3), 'ok'),
    pg_temp.codeof(r2) = 'weight_unexpected' and pg_temp.okr(r3) and st = 'cancelled');
  -- M3: ใบทองแยกก่อนถึงขั้นมีโลหะ (ขั้นติดต้นเทียน) ยกเลิกเป็นของเสียโดยไม่ชั่ง = ผ่าน (ไม่มีทองให้ชั่ง · M-D เดิม)
  d := pg_temp.mkp(p_shop, p_tpl, 'gold', pf, pg_temp.gold_codes(), 10);
  j := pg_temp.jid(d);
  rr := pg_temp.rwg(p_shop, j, 10, 1);
  r := pg_temp.o_recv(p_shop, j, 2, v_today, null, null, 'verify');
  rs := pg_temp.o_split(p_shop, j, 2, 4);
  lot := pg_temp.lot(rs);
  r2 := pg_temp.o_lcancel(p_shop, lot, 'ทดสอบ M2', 'scrap', 'broken', null);
  select status into st from analytics.job where id = lot;
  v := v || pg_temp.chk('M3', 'ต้องไม่พัง: ใบทองแยกที่ขั้นติดต้นเทียน (ยังไม่มีโลหะ) ยกเลิกเป็นของเสียโดยไม่ชั่ง = ผ่าน — ' || coalesce(pg_temp.codeof(rs), 'ok') || '/' || coalesce(pg_temp.codeof(r2), 'ok'),
    pg_temp.okr(rr) and pg_temp.okr(r) and pg_temp.okr(rs) and pg_temp.okr(r2) and st = 'cancelled');
  -- M4: ใบทองแยกที่ขั้นที่ชั่ง (ตัดต้น) ยังบังคับชั่งของเสียเหมือนเดิม
  d := pg_temp.mkp(p_shop, p_tpl, 'gold', pf, pg_temp.gold_codes(), 10);
  j := pg_temp.jid(d);
  rr := pg_temp.rwg(p_shop, j, 10, 4);
  r := pg_temp.o_recv(p_shop, j, 5, v_today, 10, null, 'verify');
  rs := pg_temp.o_split_raw(p_shop, j, 5, 4, 0, null, 10, 3);
  lot := pg_temp.lot(rs);
  r2 := pg_temp.o_lcancel(p_shop, lot, 'ทดสอบ M2', 'scrap', 'broken', null);
  v := v || pg_temp.chk('M4', 'ต้องไม่พัง (ยังห้าม): ใบทองแยกที่ขั้นตัดต้น (ชั่ง) ยกเลิกเป็นของเสียโดยไม่ชั่ง = ปฏิเสธ scrap_weight_required เหมือนเดิม — ' || coalesce(pg_temp.codeof(rs), 'ok') || '/' || coalesce(pg_temp.codeof(r2), 'ผ่าน?'),
    pg_temp.okr(rs) and lot is not null and pg_temp.codeof(r2) = 'scrap_weight_required');
  -- M5: คืนชิ้นให้ผู้ถือเดิม (ไม่ใช่ของเสีย) ของใบทองที่ขัดไม่ชั่ง = ไม่บังคับน้ำหนัก (ไม่เปลี่ยน)
  d := pg_temp.mkp(p_shop, p_tpl, 'gold', pf, pg_temp.gold_codes(), 10);
  j := pg_temp.jid(d);
  rr := pg_temp.rwg(p_shop, j, 10, 7);
  r := pg_temp.o_recv(p_shop, j, 8, v_today, null, null, 'verify');
  rs := pg_temp.o_split(p_shop, j, 8, 4);
  lot := pg_temp.lot(rs);
  r2 := pg_temp.o_lcancel(p_shop, lot, 'ทดสอบ M2', 'return_to_parent', null, null);
  select status into st from analytics.job where id = lot;
  v := v || pg_temp.chk('M5', 'ต้องไม่พัง: ใบทองที่ขัดไม่ชั่ง ยกเลิกส่วนแบบ "คืนชิ้นให้ผู้ถือเดิม" (ไม่ใช่ของเสีย) = ผ่านโดยไม่ต้องมีน้ำหนัก — ' || coalesce(pg_temp.codeof(r2), 'ok'),
    pg_temp.okr(r2) and st = 'cancelled');
  return v;
end;
$c$;

create function pg_temp.run_all(p_shop uuid, p_tpl uuid) returns text
 language sql as $c$
  select pg_temp.grp('C', format('select pg_temp.run_c(%L, %L)', p_shop, p_tpl))
      || pg_temp.grp('D', format('select pg_temp.run_d(%L)', p_shop))
      || pg_temp.grp('E', format('select pg_temp.run_e(%L, %L)', p_shop, p_tpl))
      || pg_temp.grp('F', format('select pg_temp.run_f(%L, %L)', p_shop, p_tpl))
      || pg_temp.grp('M', format('select pg_temp.run_m(%L, %L)', p_shop, p_tpl))
$c$;

do $v195$
declare
  v_shop uuid; v_tpl uuid;
  v_log text := ''; v_s text; v_fail int; v_snap0 text; v_m jsonb; v_killed int := 0; v_total int; v_survived text := ''; v_id text; v_hit int; v_k int; v_cnt int;
  v_mutants jsonb := jsonb_build_array(
    jsonb_build_object('id', 'MV-1', 'what', 'ทะเบียน: gem_set เป็น exempt (exempt หลุดไปขั้นอื่น)', 'ddl', 'update analytics.job_stage_def set gold_weigh_exempt = true where code = ''gem_set''', 'expect', jsonb_build_array('C1-gem_set', 'C3b')),
    jsonb_build_object('id', 'MV-2', 'what', 'job_profile_state: ถอด not gold_weigh_exempt (ขัดไม่ชั่งติดป้าย)', 'fn', 'job_profile_state', 'from', 'and not d.gold_weigh_exempt', 'to', '', 'expect', jsonb_build_array('C1-ctl', 'E1')),
    jsonb_build_object('id', 'MV-3', 'what', 'v_job_board: ถอด NOT d2.gold_weigh_exempt (board ไม่ตรง state)', 'view', true, 'from', 'NOT d2.gold_weigh_exempt AND ', 'to', '', 'expect', jsonb_build_array('C1-ctl', 'E1', 'F2')),
    jsonb_build_object('id', 'MV-4', 'what', 'job_stage_def_ensure: buff ไม่ exempt ในร้านใหม่', 'fn', 'job_stage_def_ensure', 'from', '105, ''per_piece'', null,           false, true,  true)', 'to', '105, ''per_piece'', null,           false, true,  false)', 'expect', jsonb_build_array('D1')),
    jsonb_build_object('id', 'MV-5', 'what', 'job_record_profile_ensure: แบบทองร้านใหม่ seed buff ชั่ง (ไม่สน exempt)', 'fn', 'job_record_profile_ensure', 'from', 'd.metal_present and not d.gold_weigh_exempt', 'to', 'd.metal_present', 'expect', jsonb_build_array('D3')),
    jsonb_build_object('id', 'MV-6', 'what', 'job_stage_suggest: ไม่ส่ง key gold_weigh_exempt', 'fn', 'job_stage_suggest', 'from', ', ''gold_weigh_exempt'', d.gold_weigh_exempt', 'to', '', 'expect', jsonb_build_array('F4')),
    jsonb_build_object('id', 'MV-8', 'what', 'job_lot_cancel_core: ไม่บังคับชั่งของเสียทอง (v_wreq เป็น false เสมอ — ช่องเดิมก่อน M2)', 'fn', 'job_lot_cancel_core', 'from', 'and x.status in (''received'', ''sent'') and d.metal_present)', 'to', 'and false)', 'expect', jsonb_build_array('M1', 'M4')),
    jsonb_build_object('id', 'MV-9', 'what', 'job_lot_cancel_core: ถอดการตกกลับไปเพดานน้ำหนักใบแม่ (ส่วนที่ไม่เคยชั่งไม่มีเพดาน — น้ำหนักเกินใบแม่ผ่าน)', 'fn', 'job_lot_cancel_core', 'from', 'if coalesce(v_wbasis, 0) = 0 then', 'to', 'if false then', 'expect', jsonb_build_array('M1c')),
    jsonb_build_object('id', 'MV-10', 'what', 'job_lot_cancel_core: เพดานกลับเป็นแบบเดิม (ไม่มีน้ำหนักฐาน = ใส่น้ำหนักไม่ได้เลย) + ไม่ตกกลับใบแม่', 'fn', 'job_lot_cancel_core', 'from', 'if coalesce(v_wbasis, 0) > 0 and p_scrap_weight > v_wbasis then', 'to', 'if p_scrap_weight > 0 then', 'expect', jsonb_build_array('M1b')),
    jsonb_build_object('id', 'MV-7', 'what', 'ข้อมูล: แบบทองปริยาย buff กลับไปชั่ง (UPDATE แบบไม่ครบ)', 'ddl', 'update analytics.job_record_profile_stage ps set weigh = true from analytics.job_record_profile p where p.id = ps.profile_id and p.is_default_gold and ps.stage_code = ''buff''', 'expect', jsonb_build_array('E1', 'D5', 'E4'))
  );
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select id into v_shop from public.shop order by created_at limit 1;
  select i.id into v_tpl from analytics.oem_quote_item i join analytics.oem_quote q on q.id = i.quote_id
   where i.shop_id = v_shop and i.input ->> 'metal' = 'silver' and q.quote_no !~ '^V1[0-9]{2}-' order by q.created_at, i.seq limit 1;
  if v_tpl is null then
    v_log := v_log || '[FAIL] S0  ไม่มี oem_quote_item เงินจริงให้ใช้เป็นแม่แบบโคลน — ชุดทดสอบรันต่อไม่ได้' || E'\n';
    raise exception E'%', v_log;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'analytics' and table_name = 'job_stage_def' and column_name = 'gold_weigh_exempt') then
    v_log := v_log || '[FAIL] S0b  ยังไม่มีคอลัมน์ job_stage_def.gold_weigh_exempt — ยังไม่ apply 0195 (หรือต่อไฟล์ 0194+0195 ก่อนไฟล์นี้)' || E'\n';
    raise exception E'%', v_log;
  end if;

  create temp table _v195_orig on commit drop as
    select p.oid::regprocedure::text as sig, md5(replace(pg_get_functiondef(p.oid), E'\r', '')) as h, p.proacl::text as acl
      from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.prokind in ('f', 'p');
  v_snap0 := pg_temp.snap();

  begin
    v_s := pg_temp.run_all(v_shop, v_tpl);
    raise exception 'V195_ROLLBACK';
  exception when others then
    if sqlerrm <> 'V195_ROLLBACK' then
      v_s := coalesce(v_s, '') || pg_temp.chk('S1-crash', 'ชุดหลัก raise นอกกลุ่ม: ' || sqlstate || ' ' || sqlerrm, false);
    end if;
  end;
  v_log := v_log || v_s;
  v_log := v_log || pg_temp.chk('K0', 'ชุดทดสอบทั้งชุดไม่ทิ้งรอย: snapshot job/job_stage/event/token/worker/profile/def/oem_quote/production/shop เท่าเดิมหลังถอยกลับ', pg_temp.snap() = v_snap0);
  v_cnt := (length(v_s) - length(replace(v_s, '[OK]', ''))) / 4;

  v_total := jsonb_array_length(v_mutants);
  for v_k in 0 .. v_total - 1 loop
    v_m := v_mutants -> v_k;
    v_s := '';
    begin
      if v_m ? 'view' then
        perform pg_temp.mutate_view('v_job_board', v_m ->> 'from', v_m ->> 'to');
      elsif v_m ? 'fn' then
        perform pg_temp.mutate(v_m ->> 'fn', v_m ->> 'from', v_m ->> 'to');
      else
        execute v_m ->> 'ddl';
      end if;
      v_s := pg_temp.run_all(v_shop, v_tpl);
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

  select count(*) into v_hit from _v195_orig o join pg_proc p on p.pronamespace = 'analytics'::regnamespace and p.prokind in ('f', 'p') and p.oid::regprocedure::text = o.sig where md5(replace(pg_get_functiondef(p.oid), E'\r', '')) = o.h and p.proacl::text is not distinct from o.acl;
  v_log := v_log || pg_temp.chk('MY', format('หลัง mutant: md5 นิยาม + สิทธิ์ของฟังก์ชันทุกตัวในสคีมา analytics (%s ตัว) เท่าเดิมเป๊ะ', (select count(*) from _v195_orig)),
    v_hit = (select count(*) from _v195_orig) and (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace and prokind in ('f', 'p')) = (select count(*) from _v195_orig));
  v_log := v_log || pg_temp.chk('K0b', 'state ไม่ขยับหลังรัน mutant ทั้งหมด', pg_temp.snap() = v_snap0);
  v_log := v_log || pg_temp.chk('P1', 'ไม่มี overload 5 ฟังก์ชัน · ไม่มีใคร (public/anon/authenticated) ถือ EXECUTE ฟังก์ชันที่แก้ · v_job_board: authenticated/anon ไม่มี select · security_invoker เปิด',
    (select count(*) from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname in ('job_stage_def_ensure', 'job_profile_state', 'job_stage_suggest', 'job_record_profile_list', 'job_record_profile_ensure')) = 5
    and not exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     where p.pronamespace = 'analytics'::regnamespace and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole)
                       and p.proname in ('job_stage_def_ensure', 'job_profile_state', 'job_stage_suggest', 'job_record_profile_list', 'job_record_profile_ensure'))
    and not has_table_privilege('anon', 'analytics.v_job_board', 'select') and not has_table_privilege('authenticated', 'analytics.v_job_board', 'select')
    and (select coalesce(c.reloptions::text, '') like '%security_invoker=true%' from pg_class c where c.oid = 'analytics.v_job_board'::regclass));

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_log := v_log || format(E'\n=== สรุป (0195): [OK] ~%s (ชุดหลัก) · mutant %s ตัว · [SKIP] %s · [FAIL] ทั้งไฟล์ = %s %s ===\n', v_cnt, v_total,
    (length(v_log) - length(replace(v_log, '[SKIP]', ''))) / 6, v_fail, case when v_fail = 0 then '(ผ่าน)' else '(ไม่ผ่าน)' end);
  raise exception E'%', v_log;
end;
$v195$;
