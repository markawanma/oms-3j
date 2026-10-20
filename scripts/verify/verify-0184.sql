-- scripts/verify/verify-0184.sql
-- ตรวจ supabase/migrations/0184_split_polish_stage.sql (แยกขั้น "แต่ง ขัด" polish -> "แต่ง" finish + "ขัด" buff · หน้างานขอ 20 ต.ค. 69)
-- self-rolling-back (3j-migration-traps ข้อ 11) · ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน · [SKIP] ไม่นับเป็นผ่าน (บอกเหตุผลในบรรทัด)
-- ข้อมูลทดสอบสร้างผ่าน RPC ของระบบทั้งหมด · ข้อยกเว้นที่บอกตรงๆ (ทั้งหมดในทรานแซกชันที่ถอยกลับ):
--   · ใบเสนอราคา OEM = โคลนจากรายการจริงด้วย INSERT (แบบเดียวกับ verify-0172..0183) · ร้านใหม่ (public.shop) = INSERT เพื่อทดสอบ job_stage_def_ensure
--   · D5/D6 ยิง INSERT job_stage ตรงเพื่อให้ถึงด่าน trigger (ทางปกติผ่านด่าน validator ก่อนเสมอ) · G* เปิด polish ชั่วคราวแล้วปิดกลับเพื่อ "จำลองใบที่สร้างก่อนปิดขั้น" (UPDATE job_stage_def ตรงในทรานแซกชันที่ถอยกลับ)
-- รอบแรก = ของจริง (ในทรานแซกชันย่อยที่ถอยกลับ แล้วเทียบ state) · รอบถัดไป = mutant (ทุกตัวต้องถูกจับด้วย id ที่ระบุ ไม่งั้น MX FAIL) · ปิดท้ายตรวจ md5 ฟังก์ชันทุกตัวเท่าเดิม
-- 🔴 สร้างใบงานทดสอบหลายสิบใบในทรานแซกชัน — ล็อกตาราง job ช่วงรัน · รันหลัง Tech Lead แจ้งว่ารันได้
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0184.sql
-- dry-run ก่อน apply: ต่อไฟล์ migration + ไฟล์นี้ (จาก git blob ไม่ใช่ working tree CRLF) แล้วรันไม่ใส่ --commit
--
-- ============ ตารางแมป "ข้อในบรีฟ 20 ต.ค. -> เทสต์ที่ครอบ" ============
--  ✅ สร้างใบใหม่ค่าเริ่ม -> ...cut_sprue, finish, buff, qc, pack                                  -> C1 C1b C1c C3 · C2 (ใบผลิต — SKIP ถ้าไม่มีรายการใบผลิต open) · C4 C5 (รายการให้ติ๊กบน UI) · MU-1 MU-2
--  ✅ ช่างรับ/ส่ง finish -> buff ได้ (ขอบเขตขั้นของช่างยังบังคับ · ข้ามขั้นไม่ได้)                       -> E1 E2 E3 E4 E5 · MU-9
--  ✅ ใบเก่าที่มี polish รับ/ส่งต่อได้ปกติ (office + ช่างที่ถือ polish + แยกส่วนย่อยคัดลอกขั้น polish)       -> G1 G2 G3 G4 G5
--  ✅ ทองชั่งที่ finish/buff ตามกฎ (รับ/ส่งโดยไม่ชั่ง = ปฏิเสธ · ชั่งแล้วผ่าน · gold_unguarded = false)   -> F1 F2 F3 F4 · MU-6
--  ✅ แบบบันทึกที่ polish ชั่ง -> finish/buff ชั่งด้วย (ข้อมูล + ใบที่สร้างจากแบบ + แบบใหม่ผ่าน RPC)        -> A5 A5b F1 F5 · MU-6
--  ✅ job_stage_def_ensure ร้านใหม่ 14 แถว seq ไม่ชน · เรียกซ้ำไม่เพิ่ม · ร้านเดิมเรียกซ้ำไม่ขยับ          -> B1 B2 B3 B4 A6 · MU-3 MU-4
--  ✅ ผังขั้นร้านจริง: seq x10 สัมพัทธ์เดิม · polish ปิด · finish/buff เปิดตามสเปก · ไม่มีแถวค้าง 501+       -> A1 A2 A3 · MU-5 MU-7
--  ✅ worker ที่มี polish ได้ finish+buff (คง polish)                                                -> A4 · MU-8
--  ❌ ห้ามผ่าน: สร้างใบใหม่ที่ขอ polish (ปิดใช้งาน) ทุกรูปแบบ                                        -> D1 D2 (validator) · D6 (trigger INSERT ขั้นปิดใช้งาน) · MU-3b MU-10 MU-11
--  ❌ ห้ามผ่าน: buff ก่อน finish ในใบเดียว                                                            -> D3 (validator) · D5 (trigger ลำดับ) · MU-12
--  🟢 ต้องไม่พัง: ใบที่ขอ finish อย่างเดียว/buff อย่างเดียวผ่าน (ขั้นเลือกได้)                          -> D4a D4b
--  K0: ชุดทดสอบทั้งชุดไม่ทิ้งรอย (snapshot ตาราง job/worker/profile/def/shop เท่าเดิมหลังถอยกลับ) · MY: md5 ฟังก์ชันเท่าเดิมหลัง mutant
--
--  ❌ ไม่มีเทสต์ครอบ (บอกตรงๆ):
--    - "ไม่แตะใบที่เปิดอยู่" ครอบด้วยด่านในไฟล์ migration เอง (md5 job/job_stage/job_event ก่อน-หลัง raise ถอยทั้งก้อน — ทำงานตอน apply) ไม่ใช่ในไฟล์นี้ — ไฟล์นี้รันหลัง migration เทียบก่อนไม่ได้
--    - ความแคบของ UPDATE worker (ช่างที่ไม่มี polish ไม่ถูกแตะ) ไม่มีเทสต์ในไฟล์นี้ (state ก่อน migration หายไปแล้ว) — ครอบด้วย dry-run ต่อไฟล์: migration x2 (รอบสองต้องไม่ขยับอะไร) ตามรายงานส่งงาน
--    - race หลาย connection (ช่างสองคนกดรับขั้นเดียวกัน) — do-block ทรานแซกชันเดียวจำลองไม่ได้ · ล็อกแถวใบแม่เดิมของ J1 ครอบ ไม่ได้ทดสอบซ้ำที่นี่
--    - ฝั่ง TS/หน้าจอ (WorkersClient แสดงรหัส "polish" ใต้ช่างที่ยังถือ · ฟอร์มสร้างใบ) = ไม่มีเทสต์ในไฟล์นี้ (vitest ฝั่ง lib/components)
--    - เส้นใบผลิต (C2): SKIP เมื่อไม่มี production_order_item ของใบผลิต open บน DB — ถ้า SKIP ถือว่าไม่ได้ทดสอบ (แก้ 2 บรรทัดใน job_source_info เหมือนเส้น OEM แต่ไม่ได้รันจริง)
--    - ชุดทดสอบเก่า verify-0172..0183 ที่สร้างใบด้วย polish จะล้มถ้ารันซ้ำหลัง apply (ดูหนี้ท้ายไฟล์ migration) — ไม่ได้แก้
set local statement_timeout = '45min';

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
      to_jsonb(v_quote) || jsonb_build_object('id', v_q, 'quote_no', 'V184-' || substr(v_q::text, 1, 8), 'status', 'won',
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
    p_shop, p_item, coalesce(p_codes, pg_temp.std()), 'verify: เริ่มผลิตก่อนมัดจำ', 'v184-ชื่อเรียกภายใน', pg_temp.act(), p_profile)) $c$;
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

-- ===== A: ผังขั้นของร้านจริง + ช่าง + แบบการบันทึก =====
create function pg_temp.run_a(p_shop uuid) returns text
 language plpgsql as $c$
declare
  v text := ''; s text; n int; m1 text; m2 text;
begin
  select string_agg(d.code || ':' || d.seq_default, ',' order by d.seq_default) into s from analytics.job_stage_def d where d.shop_id = p_shop;
  v := v || pg_temp.chk('A1', 'ผังขั้นร้านจริง: seq x10 สัมพัทธ์เดิม + polish 90 · finish 91 · buff 92 — ' || coalesce(s, 'null'),
    s = 'cad:10,print3d:20,mold:30,wax_inject:40,wax_tree:50,invest_burnout:60,cast:70,cut_sprue:80,polish:90,finish:91,buff:92,gem_set:100,plating:110,qc:120,pack:130');
  select count(*) into n from analytics.job_stage_def d where d.shop_id = p_shop and (
      (d.code = 'finish' and d.name_th = 'แต่ง' and d.is_active and d.cost_block = 'per_piece' and d.batch_kind is null and d.weigh_default and d.metal_present and d.loss_warn_pct is null)
   or (d.code = 'buff'   and d.name_th = 'ขัด'  and d.is_active and d.cost_block = 'per_piece' and d.batch_kind is null and d.weigh_default and d.metal_present and d.loss_warn_pct is null)
   or (d.code = 'polish' and d.name_th = 'แต่ง ขัด' and not d.is_active and d.cost_block = 'per_piece' and d.batch_kind is null and d.weigh_default and d.metal_present));
  v := v || pg_temp.chk('A2', 'finish/buff เปิด (per_piece · ชั่ง · มีโลหะ · ไม่มี loss_warn) · polish ปิดและยังชื่อเดิม "แต่ง ขัด" — ตรง ' || n || '/3', n = 3);
  select count(*) into n from analytics.job_stage_def d where d.shop_id = p_shop;
  v := v || pg_temp.chk('A3', 'ร้านจริงมี 15 แถว (13 เดิม + finish + buff) ไม่มีแถวค้าง seq 501+ — พบ ' || n || ' แถว · ค้าง ' ||
    (select count(*) from analytics.job_stage_def d where d.shop_id = p_shop and d.seq_default > 500),
    n = 15 and not exists (select 1 from analytics.job_stage_def d where d.shop_id = p_shop and d.seq_default > 500));
  select string_agg(w.display_name, ', ') into s from analytics.worker w where w.shop_id = p_shop and 'polish' = any (w.stage_codes) and not (w.stage_codes @> array['finish', 'buff']);
  v := v || pg_temp.chk('A4', 'ช่างทุกคนที่ถือ polish ถือ finish+buff ด้วย (และยังถือ polish) — ค้าง: ' || coalesce(s, 'ไม่มี'), s is null);
  select count(*) into n from analytics.job_record_profile_stage ps
   where ps.stage_code = 'polish'
     and (select count(*) from analytics.job_record_profile_stage x where x.profile_id = ps.profile_id and x.stage_code in ('finish', 'buff')
            and (x.weigh, x.scrap_qty, x.scrap_weight) = (ps.weigh, ps.scrap_qty, ps.scrap_weight)) <> 2;
  v := v || pg_temp.chk('A5', 'ทุกแบบที่มีแถว polish มี finish+buff flag (ชั่ง/ของเสียจำนวน/ของเสียน้ำหนัก) เหมือน polish เป๊ะ — ไม่ตรง ' || n || ' แบบ', n = 0);
  select count(*) into n from analytics.job_record_profile_stage ps join analytics.job_record_profile p on p.id = ps.profile_id
   where p.shop_id = p_shop and p.is_default_gold and ps.stage_code in ('finish', 'buff') and ps.weigh;
  v := v || pg_temp.chk('A5b', 'แบบทองปริยายชั่งที่ finish และ buff (เหมือน polish เดิมที่ชั่ง) — ' || n || '/2', n = 2);
  -- ensure ซ้ำบนร้านเดิม = ไม่ขยับอะไร
  select md5(string_agg(d::text, '|' order by d.code)) into m1 from analytics.job_stage_def d where d.shop_id = p_shop;
  perform analytics.job_stage_def_ensure(p_shop);
  select md5(string_agg(d::text, '|' order by d.code)) into m2 from analytics.job_stage_def d where d.shop_id = p_shop;
  v := v || pg_temp.chk('A6', 'job_stage_def_ensure ซ้ำบนร้านเดิม: ทะเบียนไม่ขยับ (ไม่เพิ่ม ไม่ทับ ไม่ชน unique)', m1 = m2);
  return v;
end;
$c$;

-- ===== B: ร้านใหม่ =====
create function pg_temp.run_b() returns text
 language plpgsql as $c$
declare
  v text := ''; v_s uuid; r text; n int; s text; r2 text; n2 int;
begin
  insert into public.shop (name) values ('verify-0184-ร้านใหม่') returning id into v_s;
  r := pg_temp.x(format('select analytics.job_stage_def_ensure(%L)', v_s));
  v := v || pg_temp.chk('B1', 'ensure ร้านใหม่สำเร็จ (' || r || ')', r = 'OK');
  select count(*), count(distinct seq_default) into n, n2 from analytics.job_stage_def where shop_id = v_s;
  v := v || pg_temp.chk('B2', 'ร้านใหม่ได้ 14 แถว seq ไม่ชน (distinct 14) — ' || n || '/' || n2, n = 14 and n2 = 14);
  select string_agg(d.code || ':' || d.seq_default, ',' order by d.seq_default) into s from analytics.job_stage_def d where d.shop_id = v_s;
  v := v || pg_temp.chk('B3', 'ร้านใหม่: ชุดขั้น+seq ตรงผังใหม่ ไม่มี polish — ' || coalesce(s, 'null'),
    s = 'cad:10,print3d:20,mold:30,wax_inject:40,wax_tree:50,invest_burnout:60,cast:70,cut_sprue:80,finish:91,buff:92,gem_set:100,plating:110,qc:120,pack:130');
  select count(*) into n from analytics.job_stage_def d where d.shop_id = v_s and d.code in ('finish', 'buff') and d.is_active and d.weigh_default and d.metal_present and d.cost_block = 'per_piece' and d.batch_kind is null;
  r2 := pg_temp.x(format('select analytics.job_stage_def_ensure(%L)', v_s));
  select count(*) into n2 from analytics.job_stage_def where shop_id = v_s;
  v := v || pg_temp.chk('B4', 'finish/buff ร้านใหม่ครบสเปก (' || n || '/2) · เรียก ensure ซ้ำยัง 14 แถว (' || n2 || ' · ' || r2 || ')', n = 2 and n2 = 14 and r2 = 'OK');
  perform analytics.job_record_profile_ensure(v_s);
  select count(*) into n from analytics.job_record_profile_stage ps join analytics.job_record_profile p on p.id = ps.profile_id
   where p.shop_id = v_s and p.is_default_gold and ps.stage_code in ('finish', 'buff') and ps.weigh;
  select count(*) into n2 from analytics.job_record_profile_stage ps join analytics.job_record_profile p on p.id = ps.profile_id where p.shop_id = v_s and p.is_default_gold;
  v := v || pg_temp.chk('B5', 'ร้านใหม่: แบบทองปริยายสร้างจากทะเบียนใหม่ — ชั่งที่ finish+buff (' || n || '/2) ครบ 14 ขั้น (' || n2 || ')', n = 2 and n2 = 14);
  return v;
end;
$c$;

-- ===== C: ชุดขั้นค่าเริ่ม + รายการให้ติ๊ก =====
create function pg_temp.run_c(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare
  v text := ''; d jsonb; r jsonb; j uuid; n int; n2 int; v_poi uuid; v_ok boolean;
  c_base constant jsonb := to_jsonb(pg_temp.std());
begin
  d := pg_temp.clone_deal(p_tpl, 'silver', 10);
  r := pg_temp.q(format('select analytics.job_source_info(%L, %L, %L)', p_shop, 'oem', d ->> 'item_id'));
  v := v || pg_temp.chk('C1', 'job_source_info (oem · เงิน · ไม่ใช่แบบใหม่) แนะนำ ...cut_sprue, finish, buff, qc, pack — ' || coalesce((r -> 'suggested_stage_codes')::text, r::text),
    r -> 'suggested_stage_codes' = c_base);
  d := pg_temp.clone_deal(p_tpl, 'silver', 10, true, '{"gem_count": 3, "plating_type": "rhodium"}'::jsonb);
  r := pg_temp.q(format('select analytics.job_source_info(%L, %L, %L)', p_shop, 'oem', d ->> 'item_id'));
  v := v || pg_temp.chk('C1b', 'แบบใหม่ + พลอย + ชุบ: cad,print3d,mold,...,cut_sprue,finish,buff,gem_set,plating,qc,pack (เรียงตามทะเบียนใหม่) — ' || coalesce((r -> 'suggested_stage_codes')::text, r::text),
    r -> 'suggested_stage_codes' = to_jsonb(array['cad', 'print3d', 'mold', 'wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'finish', 'buff', 'gem_set', 'plating', 'qc', 'pack']));
  d := pg_temp.clone_deal(p_tpl, 'gold', 10);
  r := pg_temp.q(format('select analytics.job_source_info(%L, %L, %L)', p_shop, 'oem', d ->> 'item_id'));
  v_ok := (r -> 'suggested_stage_codes' = c_base);
  d := pg_temp.clone_deal(p_tpl, 'brass', 10);
  r := pg_temp.q(format('select analytics.job_source_info(%L, %L, %L)', p_shop, 'oem', d ->> 'item_id'));
  v := v || pg_temp.chk('C1c', 'ทอง และ ทองเหลือง ได้ชุดเดียวกัน (ไม่ผูกโลหะ)', v_ok and r -> 'suggested_stage_codes' = c_base);
  -- เส้นใบผลิต: ต้องมีรายการใบผลิต open จริง
  select poi.id into v_poi from analytics.production_order_item poi join analytics.production_order po on po.id = poi.production_order_id
   where po.status = 'open' and poi.shop_id = p_shop order by po.created_at limit 1;
  if v_poi is null then
    v := v || '[SKIP] C2  เส้นใบผลิตของ job_source_info — ไม่มี production_order_item ของใบผลิต open บน DB (ไม่ได้ทดสอบ)' || E'\n';
  else
    r := pg_temp.q(format('select analytics.job_source_info(%L, %L, %L)', p_shop, 'production', v_poi));
    v := v || pg_temp.chk('C2', 'job_source_info (production) แนะนำ finish, buff — ' || coalesce((r -> 'suggested_stage_codes')::text, r::text),
      (r -> 'suggested_stage_codes' @> '["finish","buff"]'::jsonb) and not (r -> 'suggested_stage_codes' @> '["polish"]'::jsonb));
  end if;
  -- สร้างใบจริงด้วยชุดค่าเริ่ม
  d := pg_temp.mkp(p_shop, p_tpl, 'silver', pg_temp.pid(p_shop, 'none'), null, 10);
  j := pg_temp.jid(d);
  v := v || pg_temp.chk('C3', 'สร้างใบ OEM ด้วยชุดค่าเริ่ม: ขั้นเรียง ...cut_sprue,finish,buff,qc,pack ที่ seq 5-9 · ใบ open — ' || coalesce(pg_temp.stages_of(j), d::text),
    j is not null and pg_temp.stages_of(j) = 'wax_inject,wax_tree,invest_burnout,cast,cut_sprue,finish,buff,qc,pack'
    and pg_temp.sv(j, 6, 'stage_code') = 'finish' and pg_temp.sv(j, 7, 'stage_code') = 'buff');
  -- รายการที่ UI ให้ติ๊ก (ฟอร์มสร้างใบ + หน้าตั้งค่าแบบ)
  r := pg_temp.q(format('select analytics.job_stage_suggest(%L, %L, %L)', p_shop, 'oem', (pg_temp.clone_deal(p_tpl, 'silver', 10)) ->> 'item_id'));
  select count(*) into n from jsonb_array_elements(coalesce(r -> 'stages', '[]'::jsonb)) e where e ->> 'code' in ('finish', 'buff') and (e ->> 'default_selected')::boolean;
  select count(*) into n2 from jsonb_array_elements(coalesce(r -> 'stages', '[]'::jsonb)) e where e ->> 'code' = 'polish';
  v := v || pg_temp.chk('C4', 'job_stage_suggest (รายการติ๊กตอนสร้างใบ): finish+buff อยู่ในรายการและถูกเลือกค่าเริ่ม · polish ไม่อยู่ในรายการ — ' || n || '/2 · polish ' || n2, n = 2 and n2 = 0);
  r := pg_temp.q(format('select analytics.job_record_profile_list(%L)', p_shop));
  select count(*) into n from jsonb_array_elements(coalesce(r -> 'stage_defs', '[]'::jsonb)) e
   where (e ->> 'code' in ('finish', 'buff') and (e ->> 'is_active')::boolean) or (e ->> 'code' = 'polish' and not (e ->> 'is_active')::boolean);
  v := v || pg_temp.chk('C5', 'job_record_profile_list (หน้าตั้งค่าแบบ): finish/buff is_active=true · polish is_active=false — ' || n || '/3', n = 3);
  return v;
end;
$c$;

-- ===== D: ห้ามผ่าน + ต้องไม่พัง (ด่านสร้างใบ) =====
create function pg_temp.run_d(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare
  v text := ''; d jsonb; r jsonb; j uuid; n0 int; n1 int; x text; c0 text; c1 text;
begin
  d := pg_temp.clone_deal(p_tpl, 'silver', 10);
  select count(*) into n0 from analytics.job;
  c0 := (select last_no::text from analytics.job_counter where shop_id = p_shop);
  r := pg_temp.jcp(p_shop, (d ->> 'item_id')::uuid, pg_temp.std_polish(), pg_temp.pid(p_shop, 'none'));
  select count(*) into n1 from analytics.job;
  c1 := (select last_no::text from analytics.job_counter where shop_id = p_shop);
  v := v || pg_temp.chk('D1', 'สร้างใบใหม่ขอ polish (ปิดใช้งาน) = ปฏิเสธ 22023 stages_unknown · ไม่เกิดใบ ตัวนับไม่ขยับ — ' || coalesce(pg_temp.codeof(r), '?'),
    pg_temp.rej(r, 'stages_unknown') and (r ->> '_err') like '%polish%' and n0 = n1 and c0 is not distinct from c1);
  r := pg_temp.jcp(p_shop, (d ->> 'item_id')::uuid, array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'polish', 'finish', 'buff', 'qc', 'pack'], pg_temp.pid(p_shop, 'none'));
  v := v || pg_temp.chk('D2', 'polish ปนกับ finish+buff ก็ปฏิเสธ (ปิดใช้งานทั้งขั้น ไม่ใช่เฉพาะตอนไม่มีทางเลือกอื่น)', pg_temp.rej(r, 'stages_unknown'));
  r := pg_temp.jcp(p_shop, (d ->> 'item_id')::uuid, array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'buff', 'finish', 'qc', 'pack'], pg_temp.pid(p_shop, 'none'));
  v := v || pg_temp.chk('D3', 'buff ก่อน finish ในใบเดียว = ปฏิเสธ 22023 stages_order (validator)', pg_temp.rej(r, 'stages_order'));
  r := pg_temp.jcp(p_shop, (d ->> 'item_id')::uuid, array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'finish', 'qc', 'pack'], pg_temp.pid(p_shop, 'none'));
  v := v || pg_temp.chk('D4a', 'ต้องไม่พัง: ขอ finish อย่างเดียว (ไม่มี buff) ผ่าน — ' || coalesce(pg_temp.codeof(r), 'ok'), pg_temp.okr(r) and pg_temp.jid(r) is not null);
  d := pg_temp.clone_deal(p_tpl, 'silver', 10);
  r := pg_temp.jcp(p_shop, (d ->> 'item_id')::uuid, array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'buff', 'qc', 'pack'], pg_temp.pid(p_shop, 'none'));
  j := pg_temp.jid(r);
  v := v || pg_temp.chk('D4b', 'ต้องไม่พัง: ขอ buff อย่างเดียว (ไม่มี finish) ผ่าน — ' || coalesce(pg_temp.codeof(r), 'ok'), pg_temp.okr(r) and j is not null);
  -- ด่าน trigger (ทางลัดที่ข้าม validator): ลำดับ + ขั้นปิดใช้งาน
  x := pg_temp.x(format('insert into analytics.job_stage (job_id, shop_id, stage_code, seq, weigh_required, scrap_qty_ask, scrap_weight_ask) values (%L, %L, %L, 9, false, false, false)', j, p_shop, 'finish'));
  v := v || pg_temp.chk('D5', 'trigger job_stage_guard: INSERT finish หลัง buff/qc/pack (ลำดับสวน seq_default) = ปฏิเสธ — ' || left(x, 90), x like 'ERR:22023:job_stage: ลำดับขั้นต้องเรียงตาม%');
  x := pg_temp.x(format('insert into analytics.job_stage (job_id, shop_id, stage_code, seq, weigh_required, scrap_qty_ask, scrap_weight_ask) values (%L, %L, %L, 9, false, false, false)', j, p_shop, 'polish'));
  v := v || pg_temp.chk('D6', 'trigger job_stage_guard: INSERT ขั้น polish (ปิดใช้งาน) เข้าใบแม่ = ปฏิเสธ — ' || left(x, 90), x like 'ERR:22023:job_stage: ขั้น polish ถูกปิดใช้งาน%');
  return v;
end;
$c$;

-- ===== E: ช่างรับ/ส่ง finish -> buff =====
create function pg_temp.run_e(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare
  v text := ''; d jsonb; j uuid; rr jsonb; th text; wf uuid; wb uuid; sf text; sb text; r jsonb; r2 jsonb;
begin
  d := pg_temp.mkp(p_shop, p_tpl, 'silver', pg_temp.pid(p_shop, 'none'), null, 10);
  j := pg_temp.jid(d);
  rr := pg_temp.rw(p_shop, j, null, 5);
  v := v || pg_temp.chk('E0', 'office เดินขั้น 1-5 (ถึงตัดต้น) ได้ก่อนเข้า finish — ' || rr::text, pg_temp.okr(rr));
  th := pg_temp.newtok(p_shop, j);
  wf := (pg_temp.wu(p_shop, 'v184-ช่างแต่ง', 'finish', '4829') ->> 'id')::uuid;
  wb := (pg_temp.wu(p_shop, 'v184-ช่างขัด', 'buff', '7351') ->> 'id')::uuid;
  sf := pg_temp.sess(th, wf, '4829');
  sb := pg_temp.sess(th, wb, '7351');
  r := pg_temp.wr(th, sb, 7);
  v := v || pg_temp.chk('E1', 'ช่างขัดรับ buff ก่อน finish ส่งต่อ = ปฏิเสธ (ข้ามลำดับไม่ได้) — ' || coalesce(pg_temp.codeof(r), 'ok'), not pg_temp.okr(r));
  r := pg_temp.wr(th, sf, 6);
  v := v || pg_temp.chk('E2a', 'ช่างแต่ง (ถือ finish) รับ finish ได้ — ' || coalesce(pg_temp.codeof(r), 'ok'), pg_temp.okr(r) and pg_temp.sv(j, 6, 'status') = 'received');
  r := pg_temp.ws(th, sf, 6);
  v := v || pg_temp.chk('E2b', 'ช่างแต่งส่งต่อ finish ได้ — ' || coalesce(pg_temp.codeof(r), 'ok'), pg_temp.okr(r) and pg_temp.sv(j, 6, 'status') = 'sent');
  r := pg_temp.wr(th, sf, 7);
  v := v || pg_temp.chk('E3', 'ช่างแต่ง (ไม่ถือ buff) รับ buff ไม่ได้ — ขอบเขตขั้นยังบังคับ — ' || coalesce(pg_temp.codeof(r), 'ok'), not pg_temp.okr(r) and pg_temp.sv(j, 7, 'status') = 'pending');
  r := pg_temp.wr(th, sb, 7);
  r2 := pg_temp.ws(th, sb, 7);
  v := v || pg_temp.chk('E4', 'ช่างขัด (ถือ buff) รับ+ส่ง buff ได้หลัง finish ส่ง — ' || coalesce(pg_temp.codeof(r), 'ok') || '/' || coalesce(pg_temp.codeof(r2), 'ok'),
    pg_temp.okr(r) and pg_temp.okr(r2) and pg_temp.sv(j, 7, 'status') = 'sent');
  r := pg_temp.wr(th, sb, 8);
  v := v || pg_temp.chk('E5', 'ช่างขัดรับ qc ไม่ได้ (นอกขอบเขต) · qc ยัง pending', not pg_temp.okr(r) and pg_temp.sv(j, 8, 'status') = 'pending');
  return v;
end;
$c$;

-- ===== F: ทอง + แบบบันทึก =====
create function pg_temp.run_f(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare
  v text := ''; d jsonb; j uuid; rr jsonb; r jsonb; st jsonb; v_today date := analytics.job_today(); pr jsonb; pid_ uuid;
begin
  d := pg_temp.mkp(p_shop, p_tpl, 'gold', pg_temp.pid(p_shop, 'gold'), null, 10);
  j := pg_temp.jid(d);
  st := analytics.job_profile_state(j);
  v := v || pg_temp.chk('F1', 'ใบทอง (แบบทองปริยาย): finish+buff ต้องชั่ง · gold_unguarded = false — ' || coalesce(pg_temp.flags_of(j), d::text) || ' · ' || coalesce(st ->> 'gold_unguarded', '?'),
    j is not null and pg_temp.flags_of(j) like '%cut_sprue:wq,finish:wq,buff:wq,qc:wq,pack:wq' and (st ->> 'gold_unguarded') = 'false');
  rr := pg_temp.rw(p_shop, j, 10, 5);
  r := pg_temp.o_recv(p_shop, j, 6, v_today, null, null, 'verify');
  v := v || pg_temp.chk('F2', 'ทอง: รับ finish โดยไม่ชั่ง = ปฏิเสธ weight_required · ขั้นยัง pending — ' || coalesce(pg_temp.codeof(r), 'ok'), pg_temp.codeof(r) = 'weight_required' and pg_temp.sv(j, 6, 'status') = 'pending');
  r := pg_temp.o_recv(p_shop, j, 6, v_today, 10, null, 'verify');
  v := v || pg_temp.chk('F3a', 'ทอง: รับ finish พร้อมชั่งผ่าน — ' || coalesce(pg_temp.codeof(r), 'ok'), pg_temp.okr(r) and pg_temp.sv(j, 6, 'status') = 'received');
  r := pg_temp.o_send(p_shop, j, 6, v_today, null);
  v := v || pg_temp.chk('F3b', 'ทอง: ส่งต่อ finish โดยไม่ชั่งออก = ปฏิเสธ weight_required — ' || coalesce(pg_temp.codeof(r), 'ok'), pg_temp.codeof(r) = 'weight_required' and pg_temp.sv(j, 6, 'status') = 'received');
  r := pg_temp.o_send(p_shop, j, 6, v_today, 10);
  v := v || pg_temp.chk('F3c', 'ทอง: ส่งต่อ finish พร้อมชั่งผ่าน — ' || coalesce(pg_temp.codeof(r), 'ok'), pg_temp.okr(r) and pg_temp.sv(j, 6, 'status') = 'sent');
  r := pg_temp.o_recv(p_shop, j, 7, v_today, null, null, 'verify');
  v := v || pg_temp.chk('F4a', 'ทอง: รับ buff โดยไม่ชั่ง = ปฏิเสธ weight_required — ' || coalesce(pg_temp.codeof(r), 'ok'), pg_temp.codeof(r) = 'weight_required');
  r := pg_temp.o_recv(p_shop, j, 7, v_today, 10, null, 'verify');
  rr := pg_temp.o_send(p_shop, j, 7, v_today, null);
  v := v || pg_temp.chk('F4b', 'ทอง: รับ buff ชั่งผ่าน · ส่งต่อโดยไม่ชั่งออก = ปฏิเสธ — ' || coalesce(pg_temp.codeof(r), 'ok') || '/' || coalesce(pg_temp.codeof(rr), 'ok'),
    pg_temp.okr(r) and pg_temp.codeof(rr) = 'weight_required' and pg_temp.sv(j, 7, 'status') = 'received');
  -- แบบใหม่ผ่าน RPC: ชั่งที่ finish · นับของเสียที่ buff
  pr := pg_temp.pu(p_shop, null, 'v184-แบบแต่งขัด', null,
    '[{"stage_code":"finish","weigh":true,"scrap_qty":true,"scrap_weight":false},{"stage_code":"buff","weigh":false,"scrap_qty":true,"scrap_weight":false}]');
  pid_ := (pr ->> 'id')::uuid;
  d := pg_temp.mkp(p_shop, p_tpl, 'silver', pid_, null, 10);
  j := pg_temp.jid(d);
  v := v || pg_temp.chk('F5a', 'สร้างแบบใหม่ที่อ้าง finish/buff ผ่าน RPC ได้ · ใบที่สร้างจากแบบ: finish ชั่ง+นับเสีย · buff นับเสียอย่างเดียว — ' || coalesce(pg_temp.flags_of(j), d::text),
    pid_ is not null and j is not null and pg_temp.flags_of(j) like '%cut_sprue:--,finish:wq,buff:-q,qc:--,pack:--');
  rr := pg_temp.rw(p_shop, j, null, 5);
  r := pg_temp.o_recv(p_shop, j, 6, v_today, null, null, 'verify');
  v := v || pg_temp.chk('F5b', 'เงิน + แบบที่ชั่งที่ finish: รับ finish โดยไม่ชั่ง = ปฏิเสธ weight_required (ไม่ใช่เฉพาะทอง)', pg_temp.codeof(r) = 'weight_required');
  return v;
end;
$c$;

-- ===== G: ใบเก่าที่มี polish =====
create function pg_temp.mk_old(p_shop uuid, p_tpl uuid) returns jsonb
 language plpgsql as $c$
declare d jsonb;
begin
  update analytics.job_stage_def set is_active = true where shop_id = p_shop and code = 'polish';
  d := pg_temp.mkp(p_shop, p_tpl, 'silver', pg_temp.pid(p_shop, 'none'), pg_temp.std_polish(), 10);
  update analytics.job_stage_def set is_active = false where shop_id = p_shop and code = 'polish';
  return d;
end;
$c$;
create function pg_temp.run_g(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare
  v text := ''; d jsonb; j uuid; rr jsonb; r jsonb; dn jsonb; th text; ww uuid; sw text; r2 jsonb; j3 uuid; lot uuid; n int; v_today date := analytics.job_today();
begin
  -- G1-G2: office เดินใบเก่าผ่านขั้น polish (ปิดใช้งานแล้ว) จนปิดงาน
  d := pg_temp.mk_old(p_shop, p_tpl);
  j := pg_temp.jid(d);
  v := v || pg_temp.chk('G1', 'จำลองใบเก่า: สร้างตอน polish ยังเปิดแล้วปิดขั้นกลับ — ใบมีขั้น polish ที่ seq 6 · polish ปิดอยู่ — ' || coalesce(pg_temp.stages_of(j), d::text),
    j is not null and pg_temp.stages_of(j) = 'wax_inject,wax_tree,invest_burnout,cast,cut_sprue,polish,qc,pack'
    and not (select is_active from analytics.job_stage_def where shop_id = p_shop and code = 'polish'));
  rr := pg_temp.rw(p_shop, j, null, 8);
  dn := pg_temp.o_done(p_shop, j, 10, 0);
  v := v || pg_temp.chk('G2', 'office รับ/ส่งผ่านขั้น polish ได้ปกติ แล้วปิดงาน (done) ได้ — ' || rr::text || ' · ' || coalesce(pg_temp.codeof(dn), 'ok'),
    pg_temp.okr(rr) and pg_temp.okr(dn) and pg_temp.sv(j, 6, 'status') = 'sent' and (select status from analytics.job where id = j) = 'done');
  -- G3: ช่างที่ถือ polish รับ/ส่งขั้น polish ของใบเก่า
  d := pg_temp.mk_old(p_shop, p_tpl);
  j := pg_temp.jid(d);
  rr := pg_temp.rw(p_shop, j, null, 5);
  th := pg_temp.newtok(p_shop, j);
  ww := (pg_temp.wu(p_shop, 'v184-ช่างเก่า', 'polish', '1357') ->> 'id')::uuid;
  sw := pg_temp.sess(th, ww, '1357');
  r := pg_temp.wr(th, sw, 6);
  r2 := pg_temp.ws(th, sw, 6);
  v := v || pg_temp.chk('G3', 'ช่างที่ถือรหัส polish รับ+ส่งขั้น polish ของใบเก่าได้ (worker_codes_clean ยอมขั้นปิดใช้งาน) — ' || coalesce(pg_temp.codeof(r), 'ok') || '/' || coalesce(pg_temp.codeof(r2), 'ok'),
    pg_temp.okr(rr) and pg_temp.okr(r) and pg_temp.okr(r2) and pg_temp.sv(j, 6, 'status') = 'sent');
  -- G4: ช่างที่ไม่ถือ polish (ถือแค่ finish+buff) รับขั้น polish ไม่ได้ (ขอบเขตขั้นไม่หลวม)
  d := pg_temp.mk_old(p_shop, p_tpl);
  j := pg_temp.jid(d);
  rr := pg_temp.rw(p_shop, j, null, 5);
  th := pg_temp.newtok(p_shop, j);
  ww := (pg_temp.wu(p_shop, 'v184-ช่างใหม่', 'finish,buff', '2468') ->> 'id')::uuid;
  sw := pg_temp.sess(th, ww, '2468');
  r := pg_temp.wr(th, sw, 6);
  v := v || pg_temp.chk('G4', 'ต้องไม่หลวม: ช่างที่ถือแค่ finish+buff รับขั้น polish ของใบเก่าไม่ได้ — ' || coalesce(pg_temp.codeof(r), 'ok'), not pg_temp.okr(r) and pg_temp.sv(j, 6, 'status') = 'pending');
  -- G5: แยกส่วนย่อยจากใบเก่า (ส่วนย่อยคัดลอกขั้น รวมขั้น polish ที่ปิดใช้งาน)
  d := pg_temp.mk_old(p_shop, p_tpl);
  j3 := pg_temp.jid(d);
  rr := pg_temp.rw(p_shop, j3, null, 4);
  r := pg_temp.o_recv(p_shop, j3, 5, v_today, null, null, 'verify');
  r2 := pg_temp.o_split(p_shop, j3, 5, 4);
  lot := (r2 ->> 'lot_job_id')::uuid;
  select count(*) into n from analytics.job_stage s where s.job_id = lot and s.stage_code = 'polish';
  v := v || pg_temp.chk('G5', 'แยกส่วนย่อยจากใบเก่า (ตัดต้นถืออยู่) สำเร็จ · ส่วนย่อยคัดลอกขั้น polish (ปิดใช้งาน) ได้ — ' || coalesce(pg_temp.codeof(r2), 'ok'),
    pg_temp.okr(r) and pg_temp.okr(r2) and lot is not null and n = 1);
  return v;
end;
$c$;

create function pg_temp.run_all(p_shop uuid, p_tpl uuid) returns text
 language sql as $c$
  select pg_temp.grp('A', format('select pg_temp.run_a(%L)', p_shop))
      || pg_temp.grp('B', 'select pg_temp.run_b()')
      || pg_temp.grp('C', format('select pg_temp.run_c(%L, %L)', p_shop, p_tpl))
      || pg_temp.grp('D', format('select pg_temp.run_d(%L, %L)', p_shop, p_tpl))
      || pg_temp.grp('E', format('select pg_temp.run_e(%L, %L)', p_shop, p_tpl))
      || pg_temp.grp('F', format('select pg_temp.run_f(%L, %L)', p_shop, p_tpl))
      || pg_temp.grp('G', format('select pg_temp.run_g(%L, %L)', p_shop, p_tpl))
$c$;

do $v184$
declare
  v_shop uuid; v_tpl uuid;
  v_log text := ''; v_s text; v_fail int; v_snap0 text; v_m jsonb; v_killed int := 0; v_total int; v_survived text := ''; v_id text; v_hit int; v_k int; v_cnt int;
  v_mutants jsonb := jsonb_build_array(
    jsonb_build_object('id', 'MU-1', 'what', 'job_source_info: ชุดค่าเริ่มกลับไปใช้ polish แทน finish+buff', 'fn', 'job_source_info', 'from', '''cut_sprue'', ''finish'', ''buff'', ''qc'', ''pack''', 'to', '''cut_sprue'', ''polish'', ''qc'', ''pack''', 'expect', jsonb_build_array('C1', 'C1b', 'C3')),
    jsonb_build_object('id', 'MU-2', 'what', 'job_source_info: ตก buff จากชุดค่าเริ่ม', 'fn', 'job_source_info', 'from', '''finish'', ''buff'', ''qc''', 'to', '''finish'', ''qc''', 'expect', jsonb_build_array('C1', 'C3')),
    jsonb_build_object('id', 'MU-3', 'what', 'ทะเบียน: เปิด polish กลับ (ใบใหม่ขอ polish ผ่าน)', 'ddl', 'update analytics.job_stage_def set is_active = true where code = ''polish''', 'expect', jsonb_build_array('A2', 'D1', 'D2', 'C4', 'C5')),
    jsonb_build_object('id', 'MU-4', 'what', 'job_stage_def_ensure: finish ชน seq กับ buff (91 -> 92)', 'fn', 'job_stage_def_ensure', 'from', '91,  ''per_piece''', 'to', '92,  ''per_piece''', 'expect', jsonb_build_array('B1', 'B2', 'B3', 'B-crash')),
    jsonb_build_object('id', 'MU-5', 'what', 'ทะเบียน: buff ไม่มีโลหะในมือ (กฎทอง/แบบบันทึกไม่ครอบ)', 'ddl', 'update analytics.job_stage_def set metal_present = false where code = ''buff''', 'expect', jsonb_build_array('A2')),
    jsonb_build_object('id', 'MU-6', 'what', 'แบบบันทึก: ลบแถว buff ทุกแบบ (copy flag ไม่ครบ)', 'ddl', 'delete from analytics.job_record_profile_stage where stage_code = ''buff''', 'expect', jsonb_build_array('A5', 'A5b', 'F1', 'F4a')),
    jsonb_build_object('id', 'MU-7', 'what', 'ทะเบียน: สลับ finish/buff (buff มาก่อน)', 'ddl', 'update analytics.job_stage_def set seq_default = 591 where code = ''finish''; update analytics.job_stage_def set seq_default = 91 where code = ''buff''; update analytics.job_stage_def set seq_default = 92 where code = ''finish''', 'expect', jsonb_build_array('A1', 'C1', 'C3')),
    jsonb_build_object('id', 'MU-8', 'what', 'ช่าง: ถอด finish ออกจากช่างที่ถือ polish', 'ddl', 'update analytics.worker set stage_codes = array_remove(stage_codes, ''finish'') where ''polish'' = any (stage_codes)', 'expect', jsonb_build_array('A4')),
    jsonb_build_object('id', 'MU-9', 'what', 'job_core_receive: ถอดด่านขอบเขตขั้นของช่าง (job_worker_can_do)', 'fn', 'job_core_receive', 'from', 'if not analytics.job_worker_can_do(v_codes, v_t.stage_code) then', 'to', 'if false then', 'expect', jsonb_build_array('E3', 'E5', 'G4')),
    jsonb_build_object('id', 'MU-10', 'what', 'job_validate_stage_codes: ไม่เช็ค is_active (polish ผ่าน)', 'fn', 'job_validate_stage_codes', 'from', 'd.code is null or not d.is_active', 'to', 'd.code is null', 'expect', jsonb_build_array('D1', 'D2')),
    jsonb_build_object('id', 'MU-11', 'what', 'job_stage_guard: INSERT ขั้นปิดใช้งานเข้าใบแม่ผ่าน', 'fn', 'job_stage_guard', 'from', ' and d.is_active) then', 'to', ') then', 'expect', jsonb_build_array('D6')),
    jsonb_build_object('id', 'MU-12', 'what', 'job_stage_guard: ถอดด่านลำดับ seq_default', 'fn', 'job_stage_guard', 'from', 'd.seq_default > dn.seq_default', 'to', 'd.seq_default > dn.seq_default + 100000', 'expect', jsonb_build_array('D5'))
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

  create temp table _v184_orig on commit drop as
    select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h, p.proacl::text as acl
      from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.prokind in ('f', 'p');
  v_snap0 := pg_temp.snap();

  -- รอบจริง: ในทรานแซกชันย่อยที่ถอยกลับ (ผลเป็นตัวแปร — ตัวแปรไม่ถอยตาม DB)
  begin
    v_s := pg_temp.run_all(v_shop, v_tpl);
    raise exception 'V184_ROLLBACK';
  exception when others then
    if sqlerrm <> 'V184_ROLLBACK' then
      v_s := coalesce(v_s, '') || pg_temp.chk('S1-crash', 'ชุดหลัก raise นอกกลุ่ม: ' || sqlstate || ' ' || sqlerrm, false);
    end if;
  end;
  v_log := v_log || v_s;
  v_log := v_log || pg_temp.chk('K0', 'ชุดทดสอบทั้งชุดไม่ทิ้งรอย: snapshot job/job_stage/event/token/worker/profile/def/oem_quote/production/shop เท่าเดิมหลังถอยกลับ', pg_temp.snap() = v_snap0);
  v_cnt := (length(v_s) - length(replace(v_s, '[OK]', ''))) / 4;

  -- mutant: แต่ละตัวต้องถูกจับด้วย id ที่ระบุ
  v_total := jsonb_array_length(v_mutants);
  for v_k in 0 .. v_total - 1 loop
    v_m := v_mutants -> v_k;
    v_s := '';
    begin
      if v_m ? 'fn' then
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

  -- หลัง mutant: ทุกฟังก์ชัน/สิทธิ์เท่าเดิมเป๊ะ · state เท่าเดิม
  select count(*) into v_hit from _v184_orig o join pg_proc p on p.pronamespace = 'analytics'::regnamespace and p.prokind in ('f', 'p') and p.oid::regprocedure::text = o.sig where md5(pg_get_functiondef(p.oid)) = o.h and p.proacl::text is not distinct from o.acl;
  v_log := v_log || pg_temp.chk('MY', format('หลัง mutant: md5 definition + สิทธิ์ของฟังก์ชันทุกตัวในสคีมา analytics (%s ตัว) เท่าเดิมเป๊ะ', (select count(*) from _v184_orig)),
    v_hit = (select count(*) from _v184_orig) and (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace and prokind in ('f', 'p')) = (select count(*) from _v184_orig));
  v_log := v_log || pg_temp.chk('K0b', 'state ไม่ขยับหลังรัน mutant ทั้งหมด', pg_temp.snap() = v_snap0);
  v_log := v_log || pg_temp.chk('P1', 'ไม่มี overload: job_source_info / job_stage_def_ensure อย่างละ 1 signature · ไม่มีใคร (public/anon/authenticated) ถือ EXECUTE ฟังก์ชันสองตัวนี้',
    (select count(*) from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname in ('job_source_info', 'job_stage_def_ensure')) = 2
    and not has_function_privilege('anon', 'analytics.job_source_info(uuid,text,uuid)', 'execute') and not has_function_privilege('authenticated', 'analytics.job_source_info(uuid,text,uuid)', 'execute')
    and not has_function_privilege('anon', 'analytics.job_stage_def_ensure(uuid)', 'execute') and not has_function_privilege('authenticated', 'analytics.job_stage_def_ensure(uuid)', 'execute')
    and not exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     where p.pronamespace = 'analytics'::regnamespace and p.proname in ('job_source_info', 'job_stage_def_ensure') and a.privilege_type = 'EXECUTE' and a.grantee = 0));

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_log := v_log || format(E'\n=== สรุป: [OK] ~%s (ชุดหลัก) · mutant %s ตัว · [SKIP] %s · [FAIL] ทั้งไฟล์ = %s %s ===\n', v_cnt, v_total,
    (length(v_log) - length(replace(v_log, '[SKIP]', ''))) / 6, v_fail, case when v_fail = 0 then '(ผ่าน)' else '(ไม่ผ่าน)' end);
  raise exception E'%', v_log;
end;
$v184$;
