-- scripts/verify/verify-0194.sql  (ส่วน A — ไม่มี disable trigger · dry-run กลางวันได้)
-- ตรวจ supabase/migrations/0194_stage_order_gem_before_buff.sql (เรียงขั้น แต่ง → ฝังพลอย → ขัด) ส่วนที่ไม่ล็อก job_stage
-- ส่วน B (สลับ seq ใบค้างจริง · ล็อกตาราง · เคส 3/4 + ด่านส่วนย่อยทิศ "ไม่ตรงใบแม่") = scripts/verify/verify-0194-b.sql — รันนอกเวลางานเท่านั้น
-- self-rolling-back (3j-migration-traps ข้อ 11) · ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน · [SKIP] ไม่นับเป็นผ่าน
-- ข้อมูลทดสอบสร้างผ่าน RPC ของระบบ · ข้อยกเว้นที่บอกตรงๆ (ในทรานแซกชันที่ถอยกลับทั้งหมด):
--   · ใบเสนอราคา OEM = โคลนจากรายการจริงด้วย INSERT (แบบเดียวกับ verify-0172..0191) · ร้านใหม่ (public.shop) = INSERT เพื่อทดสอบ job_stage_def_ensure
--   · D2 ยิง INSERT job_stage ตรงเพื่อให้ถึงด่าน trigger (ทางปกติผ่านด่าน validator ก่อน)
--   · F*/E* จำลองใบเก่า: UPDATE job_stage_def ชั่วคราว (buff -> 92 / polish เปิด) แล้วคืนค่า — ใบที่ได้ = ใบที่สร้างภายใต้ผังเก่า
-- รอบแรก = ของจริง (ทรานแซกชันย่อยถอยกลับ แล้วเทียบ state) · รอบถัดไป = mutant (ทุกตัวต้องถูกจับด้วย id ที่ระบุ) · ปิดท้ายตรวจ md5 ฟังก์ชันทุกตัวเท่าเดิม
-- 🔴 สร้างใบงานทดสอบหลายสิบใบ (ชุดหลัก + mutant 6 ตัว) — ล็อกแถว job_counter ช่วงรัน ⇒ รันตอนที่ไม่มีใครสร้างใบใหม่ · ไม่ล็อก job_stage ทั้งตาราง
-- 🔴 กลุ่ม H (ทอง ค-1) ใช้ได้เฉพาะ "ก่อน 0195" — หลัง 0195 (ใบทองไม่ชั่งขัด) H2/H3/H4 จะ FAIL ตามที่ควร: แก้ให้ตรงกติกาใหม่ก่อนรันซ้ำ
--
-- 🔴 รันจากสำเนา LF (git show <ref>:<path> หรือ sed 's/\r$//') — ไฟล์ทน \r แล้ว (md5 ของนิยามตัด \r · mutant ตัด \r ก่อนแทนข้อความ ⇒ MU-1 ไม่รอดปลอมเมื่อ CRLF) แต่ prosrc ที่ได้จากไฟล์ CRLF ไม่ตรงกับสำเนาที่ลอกมา (ข้อ 20)
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0194.sql
-- dry-run ก่อน apply: ต่อไฟล์ migration (ตัดบล็อก PART B ออก ถ้ารันกลางวัน) + ไฟล์นี้ (LF) แล้วรันไม่ใส่ --commit
--
-- ============ ตารางแมป "ข้อใน design ข้อ 5 -> เทสต์ที่ครอบ" ============
--  ห้ามผ่าน
--   1 สร้างใบใหม่ [..buff,gem_set..] -> stages_order · INSERT ใบแม่ buff(n) แล้ว gem_set(n+1) -> trigger raise -> D1 D2 · MU-2 (ถอดด่านลำดับ) · MU-3
--   2 ส่วนย่อยที่ (stage_code, seq) ไม่ตรงใบแม่ -> split_link   -> ❌ ส่วน A ครอบไม่ได้ (child ต้อง status open ถึง INSERT ได้ ซึ่ง RPC ทำให้เป็น in_progress ทันที) -> verify-0194-b.sql (ปิด guard สลับ seq ใบแม่ที่มีส่วนย่อยแล้วแยกซ้ำ)
--   3 ใบที่ขั้นใดไม่ pending ไม่ถูกสลับ (md5 เท่าเดิม)           -> ส่วน B (verify-0194-b.sql) · ด่านท้าย PART B ของ migration
--   4 buff/gem_set ไม่ติดกัน หรือมีส่วนย่อย -> block สลับ raise (mutant) -> ส่วน B
--   5 ensure ซ้ำ -> แถวไม่เพิ่ม · รัน 2 รอบ รอบสองไม่เปลี่ยน   -> A3 B3 · (migration รัน 2 รอบ = dry-run แยก ตามรายงานส่งงาน) · MU-5 MU-6
--   6 ทอง (ค-1): รับ buff ไม่ชั่ง -> weight_required · buff.in ต่าง gem_set.out > 0.05 -> handoff_mismatch -> H2 H3
--  ต้องไม่พัง
--   7 ใบ polish เดินถึง done · แยกส่วนย่อยจากใบ polish          -> E1 E2
--   8 ใบเก่า buff→gem_set ผ่านแล้ว: รับ qc · reopen · แยกส่วน · arrive ส่วนต่าง -> F1 F2 F3 F4 F5 F6 · MU-1 (ถอดด่านสำเนาใบแม่ ต้องล้มที่ F4 F6)
--   9 ใบลำดับใหม่ (แบบที่สลับแล้ว): เดินครบ · แยกที่ gem_set · drift=false · dominant stage ไม่ error -> G1 G2  (ใบที่ได้จากการสร้างใหม่ ไม่ใช่จากการสลับจริง — การสลับจริงอยู่ส่วน B)
--  10 ใบไม่มีขั้นฝัง: suggested ..finish,buff,qc,pack            -> C1 D4 · (v_gem_purchase_job ยังไม่มีบน main — ฝั่ง 0192 ตรวจที่ verify-0192)
--  11 suggested ใหม่ finish,gem_set,buff · job_profile_apply ได้ flag ตามแบบ -> C2 C3 C4 C5(SKIP ถ้าไม่มีใบผลิต) C6 C7 · W1 p_gem_answer='has' = ❌ ไม่ได้ยิงตรง (เส้นเดียวกับ C4: ลำดับมาจาก job_sort_stage_codes)
--  12 ACL/overload: signature อย่างละ 1 · proacl เท่าเดิม · md5 ฟังก์ชันอื่นเท่าเดิม -> P1 MY · check-analytics-grants.sql (รันแยกหลัง apply)
--  13 trg_job_stage_guard กลับมา enabled                      -> A4 (ส่วน A หลังรัน migration) · ส่วน B
--  K0: ชุดทดสอบทั้งชุดไม่ทิ้งรอย · MY: md5 ฟังก์ชันเท่าเดิมหลัง mutant
--
--  ❌ ไม่มีเทสต์ครอบ (บอกตรงๆ):
--    - "ไม่แตะแถวอื่น" ของการสลับ — ครอบด้วยด่านท้าย PART B ของ migration (ทำงานตอน apply) ไม่ใช่ในไฟล์นี้ · race 2 connection
--    - เคส 2 (ส่วนย่อยไม่ตรงใบแม่ -> split_link) ส่วน A ไม่มี — ดูข้างบน · ฝั่ง TS/หน้าจอ (DEPT_ORDER = vitest lib/oem/display-dept-order.test.ts)
--    - W1 (job_worker_open · p_gem_answer) ไม่ได้ยิงตรง · ชุดทดสอบ verify-0172..0191 เก่ารันซ้ำไม่ได้หลัง 0194 (ใช้ขัดก่อนฝังพลอย)
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

-- ===== A: ทะเบียนร้านจริง =====
create function pg_temp.run_a(p_shop uuid) returns text
 language plpgsql as $c$
declare
  v text := ''; s text; n int; m1 text; m2 text; r jsonb;
begin
  select string_agg(d.code || ':' || d.seq_default, ',' order by d.seq_default) into s from analytics.job_stage_def d where d.shop_id = p_shop;
  v := v || pg_temp.chk('A1', 'ผังขั้นร้านจริง: ฝังพลอย 100 มาก่อนขัด 105 · ที่เหลือสัมพัทธ์เดิม — ' || coalesce(s, 'null'),
    s = 'cad:10,print3d:20,mold:30,wax_inject:40,wax_tree:50,invest_burnout:60,cast:70,cut_sprue:80,polish:90,finish:91,gem_set:100,buff:105,plating:110,qc:120,pack:130');
  select count(*) into n from analytics.job_stage_def d where d.shop_id = p_shop and (
      (d.code = 'buff' and d.name_th = 'ขัด' and d.is_active and d.cost_block = 'per_piece' and d.batch_kind is null and not d.weigh_default and d.metal_present and d.loss_warn_pct is null)
   or (d.code = 'gem_set' and d.name_th = 'ฝังพลอย' and d.is_active and d.seq_default = 100 and d.cost_block = 'per_piece' and d.metal_present)
   or (d.code = 'finish' and d.is_active and d.weigh_default and d.metal_present));
  v := v || pg_temp.chk('A2', 'buff: 105 · เปิด · per_piece · weigh_default=false (ค-1) · metal_present · gem_set/finish ไม่ขยับ — ตรง ' || n || '/3', n = 3);
  select md5(string_agg(d::text, '|' order by d.code)) into m1 from analytics.job_stage_def d where d.shop_id = p_shop;
  perform analytics.job_stage_def_ensure(p_shop);
  select md5(string_agg(d::text, '|' order by d.code)) into m2 from analytics.job_stage_def d where d.shop_id = p_shop;
  v := v || pg_temp.chk('A3', 'job_stage_def_ensure ซ้ำบนร้านเดิม: ทะเบียนไม่ขยับ (เคส 5 · ไม่เพิ่ม ไม่ทับ ไม่ชน unique)', m1 = m2);
  v := v || pg_temp.chk('A4', 'trg_job_stage_guard enabled (เคส 13) · trg_job_stage_sync enabled',
    (select count(*) from pg_trigger t where t.tgrelid = 'analytics.job_stage'::regclass and t.tgname in ('trg_job_stage_guard', 'trg_job_stage_sync') and t.tgenabled = 'O') = 2);
  return v;
end;
$c$;

-- ===== B: ร้านใหม่ (ensure) =====
create function pg_temp.run_b() returns text
 language plpgsql as $c$
declare
  v text := ''; v_s uuid; r text; n int; s text; r2 text; n2 int;
begin
  insert into public.shop (name) values ('verify-0194-ร้านใหม่') returning id into v_s;
  r := pg_temp.x(format('select analytics.job_stage_def_ensure(%L)', v_s));
  select count(*), count(distinct seq_default) into n, n2 from analytics.job_stage_def where shop_id = v_s;
  select string_agg(d.code || ':' || d.seq_default, ',' order by d.seq_default) into s from analytics.job_stage_def d where d.shop_id = v_s;
  v := v || pg_temp.chk('B1', 'ensure ร้านใหม่ (' || r || '): 14 แถว seq ไม่ชน · ชุดขั้น+seq ตรงผังใหม่ ไม่มี polish — ' || n || '/' || n2 || ' · ' || coalesce(s, 'null'),
    r = 'OK' and n = 14 and n2 = 14 and s = 'cad:10,print3d:20,mold:30,wax_inject:40,wax_tree:50,invest_burnout:60,cast:70,cut_sprue:80,finish:91,gem_set:100,buff:105,plating:110,qc:120,pack:130');
  select count(*) into n from analytics.job_stage_def d where d.shop_id = v_s and d.code = 'buff' and d.is_active and not d.weigh_default and d.metal_present and d.cost_block = 'per_piece' and d.batch_kind is null;
  v := v || pg_temp.chk('B2', 'ร้านใหม่: buff ไม่ชั่งค่าเริ่ม (weigh_default=false) · มีโลหะ · per_piece', n = 1);
  r2 := pg_temp.x(format('select analytics.job_stage_def_ensure(%L)', v_s));
  select count(*) into n2 from analytics.job_stage_def where shop_id = v_s;
  v := v || pg_temp.chk('B3', 'ensure รอบสองบนร้านเดิม: ยัง 14 แถว (' || n2 || ' · ' || r2 || ') ไม่ทับ', n2 = 14 and r2 = 'OK');
  return v;
end;
$c$;

-- ===== C: ชุดขั้นค่าเริ่ม + รายการให้ติ๊ก + ใบใหม่ได้ flag ตามแบบ (เคส 10 11) =====
create function pg_temp.run_c(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare
  v text := ''; d jsonb; r jsonb; j uuid; n int; v_poi uuid; pid_ uuid; pr jsonb; a int; b int;
begin
  d := pg_temp.clone_deal(p_tpl, 'silver', 10);
  r := pg_temp.q(format('select analytics.job_source_info(%L, %L, %L)', p_shop, 'oem', d ->> 'item_id'));
  v := v || pg_temp.chk('C1', 'ใบไม่มีพลอย: แนะนำ ...cut_sprue, finish, buff, qc, pack (ไม่มี gem_set) — ' || coalesce((r -> 'suggested_stage_codes')::text, r::text),
    r -> 'suggested_stage_codes' = to_jsonb(pg_temp.std()));
  d := pg_temp.clone_deal(p_tpl, 'silver', 10, false, '{"gem_count": 3}'::jsonb);
  r := pg_temp.q(format('select analytics.job_source_info(%L, %L, %L)', p_shop, 'oem', d ->> 'item_id'));
  v := v || pg_temp.chk('C2', 'OEM gem_count>0: finish, gem_set, buff, qc, pack (ฝังพลอยก่อนขัด) — ' || coalesce((r -> 'suggested_stage_codes')::text, r::text),
    r -> 'suggested_stage_codes' = to_jsonb(pg_temp.std_gem()));
  d := pg_temp.clone_deal(p_tpl, 'silver', 10, true, '{"gem_count": 3, "plating_type": "rhodium"}'::jsonb);
  r := pg_temp.q(format('select analytics.job_source_info(%L, %L, %L)', p_shop, 'oem', d ->> 'item_id'));
  v := v || pg_temp.chk('C3', 'แบบใหม่+พลอย+ชุบ: cad..cut_sprue, finish, gem_set, buff, plating, qc, pack — ' || coalesce((r -> 'suggested_stage_codes')::text, r::text),
    r -> 'suggested_stage_codes' = to_jsonb(array['cad', 'print3d', 'mold', 'wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'finish', 'gem_set', 'buff', 'plating', 'qc', 'pack']));
  v := v || pg_temp.chk('C4', 'job_sort_stage_codes เรียง pack,buff,gem_set,finish -> finish,gem_set,buff,pack',
    analytics.job_sort_stage_codes(p_shop, array['pack', 'buff', 'gem_set', 'finish']) = array['finish', 'gem_set', 'buff', 'pack']);
  select poi.id into v_poi from analytics.production_order_item poi join analytics.production_order po on po.id = poi.production_order_id
   where po.status = 'open' and poi.shop_id = p_shop order by po.created_at limit 1;
  if v_poi is null then
    v := v || '[SKIP] C5  job_source_info เส้นใบผลิต — ไม่มี production_order_item ของใบผลิต open บน DB (ไม่ได้ทดสอบ · ลำดับมาจาก job_sort_stage_codes เดียวกับ C4)' || E'\n';
  else
    r := pg_temp.q(format('select analytics.job_source_info(%L, %L, %L)', p_shop, 'production', v_poi));
    a := coalesce(array_position(array(select jsonb_array_elements_text(r -> 'suggested_stage_codes')), 'gem_set'), 0);
    b := coalesce(array_position(array(select jsonb_array_elements_text(r -> 'suggested_stage_codes')), 'buff'), 0);
    v := v || pg_temp.chk('C5', 'job_source_info (production): finish มาก่อน buff · ถ้ามี gem_set ต้องมาก่อน buff — ' || coalesce((r -> 'suggested_stage_codes')::text, r::text),
      b > 0 and (a = 0 or a < b));
  end if;
  -- รายการติ๊กบน UI: gem_set ก่อน buff
  r := pg_temp.q(format('select analytics.job_stage_suggest(%L, %L, %L)', p_shop, 'oem', (pg_temp.clone_deal(p_tpl, 'silver', 10, false, '{"gem_count": 2}'::jsonb)) ->> 'item_id'));
  select min(o) filter (where e ->> 'code' = 'gem_set'), min(o) filter (where e ->> 'code' = 'buff') into a, b
    from jsonb_array_elements(coalesce(r -> 'stages', '[]'::jsonb)) with ordinality as t(e, o);
  v := v || pg_temp.chk('C6', 'job_stage_suggest (รายการติ๊กตอนสร้างใบ): gem_set อยู่ก่อน buff — ตำแหน่ง ' || coalesce(a::text, '?') || '/' || coalesce(b::text, '?'), a is not null and b is not null and a < b);
  -- ใบใหม่ได้ flag ตามแบบ (job_profile_apply): finish ชั่ง+นับเสีย · gem_set ชั่ง · buff นับเสียอย่างเดียว
  pr := pg_temp.pu(p_shop, null, 'v194-แบบแต่งฝังขัด', null,
    '[{"stage_code":"finish","weigh":true,"scrap_qty":true,"scrap_weight":false},{"stage_code":"gem_set","weigh":true,"scrap_qty":false,"scrap_weight":false},{"stage_code":"buff","weigh":false,"scrap_qty":true,"scrap_weight":false}]');
  pid_ := (pr ->> 'id')::uuid;
  d := pg_temp.mkp(p_shop, p_tpl, 'silver', pid_, pg_temp.std_gem(), 10);
  j := pg_temp.jid(d);
  v := v || pg_temp.chk('C7', 'ใบใหม่ลำดับ แต่ง→ฝัง→ขัด ได้ flag ตามแบบ (job_profile_apply) — ' || coalesce(pg_temp.flags_of(j), d::text),
    pid_ is not null and j is not null and pg_temp.flags_of(j) like '%finish:wq,gem_set:w-,buff:-q,qc:--,pack:--');
  return v;
end;
$c$;

-- ===== D: ห้ามผ่าน + ต้องไม่พัง (ด่านสร้างใบ · ลำดับใบแม่) =====
create function pg_temp.run_d(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare
  v text := ''; d jsonb; r jsonb; j uuid; x text; n0 int; n1 int; c0 text; c1 text;
begin
  d := pg_temp.clone_deal(p_tpl, 'silver', 10);
  select count(*) into n0 from analytics.job;
  c0 := (select last_no::text from analytics.job_counter where shop_id = p_shop);
  r := pg_temp.jcp(p_shop, (d ->> 'item_id')::uuid, pg_temp.std_gem_old(), pg_temp.pid(p_shop, 'none'));
  select count(*) into n1 from analytics.job;
  c1 := (select last_no::text from analytics.job_counter where shop_id = p_shop);
  v := v || pg_temp.chk('D1', 'ห้ามผ่าน (เคส 1): สร้างใบใหม่ [..finish,buff,gem_set..] = 22023 stages_order · ไม่เกิดใบ ตัวนับไม่ขยับ — ' || coalesce(pg_temp.codeof(r), '?'),
    pg_temp.rej(r, 'stages_order') and n0 = n1 and c0 is not distinct from c1);
  -- ทางลัดข้าม validator: ใบแม่ลงท้ายด้วย buff แล้ว INSERT gem_set ต่อท้าย (buff n แล้ว gem_set n+1)
  r := pg_temp.jcp(p_shop, (d ->> 'item_id')::uuid, pg_temp.std(), pg_temp.pid(p_shop, 'none'));
  j := pg_temp.jid(r);
  x := case when j is null then 'ERR:fixture:' || r::text else
    pg_temp.x(format('insert into analytics.job_stage (job_id, shop_id, stage_code, seq, weigh_required, scrap_qty_ask, scrap_weight_ask) values (%L, %L, %L, 8, false, false, false)', j, p_shop, 'gem_set')) end;
  v := v || pg_temp.chk('D2', 'ห้ามผ่าน (เคส 1): trigger INSERT ใบแม่ buff(7) แล้ว gem_set(8) = ปฏิเสธลำดับ — ' || left(x, 100), x like 'ERR:22023:job_stage: ลำดับขั้นต้องเรียงตาม%');
  d := pg_temp.clone_deal(p_tpl, 'silver', 10);
  r := pg_temp.jcp(p_shop, (d ->> 'item_id')::uuid, pg_temp.std_gem(), pg_temp.pid(p_shop, 'none'));
  j := pg_temp.jid(r);
  v := v || pg_temp.chk('D3', 'ต้องไม่พัง: ใบใหม่ [..finish,gem_set,buff..] สร้างได้ ลำดับ seq 6/7/8 — ' || coalesce(pg_temp.stages_of(j), r::text),
    j is not null and pg_temp.stages_of(j) = 'wax_inject,wax_tree,invest_burnout,cast,cut_sprue,finish,gem_set,buff,qc,pack'
    and pg_temp.sv(j, 7, 'stage_code') = 'gem_set' and pg_temp.sv(j, 8, 'stage_code') = 'buff');
  d := pg_temp.clone_deal(p_tpl, 'silver', 10);
  r := pg_temp.jcp(p_shop, (d ->> 'item_id')::uuid, array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'finish', 'buff', 'qc', 'pack'], pg_temp.pid(p_shop, 'none'));
  v := v || pg_temp.chk('D4', 'ต้องไม่พัง (เคส 10): ใบไม่มีฝังพลอย [..finish,buff,qc,pack] สร้างได้ — ' || coalesce(pg_temp.codeof(r), 'ok'), pg_temp.okr(r) and pg_temp.jid(r) is not null);
  d := pg_temp.clone_deal(p_tpl, 'silver', 10);
  r := pg_temp.jcp(p_shop, (d ->> 'item_id')::uuid, array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'finish', 'gem_set', 'qc', 'pack'], pg_temp.pid(p_shop, 'none'));
  v := v || pg_temp.chk('D5', 'ต้องไม่พัง: ใบมีฝังพลอยไม่มีขัด [..finish,gem_set,qc,pack] สร้างได้ — ' || coalesce(pg_temp.codeof(r), 'ok'), pg_temp.okr(r) and pg_temp.jid(r) is not null);
  return v;
end;
$c$;

-- ===== E: ใบ polish เดิน + แยกส่วน (เคส 7) =====
create function pg_temp.run_e(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare
  v text := ''; d jsonb; j uuid; rr jsonb; dn jsonb; r jsonb; r2 jsonb; lot uuid; n int; v_today date := analytics.job_today();
begin
  d := pg_temp.mk_old_polish(p_shop, p_tpl);
  j := pg_temp.jid(d);
  rr := pg_temp.rw(p_shop, j, null, 8);
  dn := pg_temp.o_done(p_shop, j, 10, 0);
  v := v || pg_temp.chk('E1', 'ใบ polish (ปิดใช้งานแล้ว) เดิน 1-8 ถึงปิดงาน (done) ได้ — ' || rr::text || ' · ' || coalesce(pg_temp.codeof(dn), 'ok'),
    j is not null and pg_temp.okr(rr) and pg_temp.okr(dn) and (select status from analytics.job where id = j) = 'done');
  d := pg_temp.mk_old_polish(p_shop, p_tpl);
  j := pg_temp.jid(d);
  rr := pg_temp.rw(p_shop, j, null, 4);
  r := pg_temp.o_recv(p_shop, j, 5, v_today, null, null, 'verify');
  r2 := pg_temp.o_split(p_shop, j, 5, 4);
  lot := pg_temp.lot(r2);
  select count(*) into n from analytics.job_stage s where s.job_id = lot and s.stage_code = 'polish';
  v := v || pg_temp.chk('E2', 'แยกส่วนย่อยจากใบ polish สำเร็จ · ส่วนย่อยคัดลอกขั้น polish (ปิดใช้งาน) ได้ (ด่านสำเนาใบแม่) — ' || coalesce(pg_temp.codeof(r2), 'ok'),
    pg_temp.okr(r) and pg_temp.okr(r2) and lot is not null and n = 1 and pg_temp.stages_of(lot) = pg_temp.stages_of(j));
  return v;
end;
$c$;

-- ===== F: ใบเก่าที่ผ่าน ขัด→ฝังพลอย แล้ว (แบบ JB-0041) ต้องไม่พัง (เคส 8) =====
create function pg_temp.run_f(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare
  v text := ''; d jsonb; j uuid; j2 uuid; j3 uuid; j4 uuid; rr jsonb; r jsonb; r2 jsonb; lot uuid; dd uuid; v_today date := analytics.job_today(); n int; dr jsonb;
begin
  d := pg_temp.mk_old_order(p_shop, p_tpl);
  j := pg_temp.jid(d);
  rr := pg_temp.rw(p_shop, j, null, 8);
  v := v || pg_temp.chk('F1', 'จำลองใบเก่า: seq ตามผังเก่า finish6 buff7 gem_set8 · ทะเบียนจริงคืน buff 105 · เดินผ่านขัด→ฝังพลอยจนถึงขั้น 8 ส่งแล้ว — ' || coalesce(pg_temp.stages_of(j), d::text),
    j is not null and pg_temp.stages_of(j) = 'wax_inject,wax_tree,invest_burnout,cast,cut_sprue,finish,buff,gem_set,qc,pack' and pg_temp.okr(rr)
    and pg_temp.sv(j, 8, 'status') = 'sent'
    and (select seq_default from analytics.job_stage_def where shop_id = p_shop and code = 'buff') = 105);
  r := pg_temp.o_recv(p_shop, j, 9, v_today, null, null, 'verify');
  r2 := pg_temp.o_send(p_shop, j, 9, v_today);
  v := v || pg_temp.chk('F2', 'ใบเก่า: office รับ/ส่งขั้นถัดจากฝังพลอยได้ (เส้น UPDATE ไม่อ่านทะเบียน) — ' || coalesce(pg_temp.codeof(r), 'ok') || '/' || coalesce(pg_temp.codeof(r2), 'ok'),
    pg_temp.okr(r) and pg_temp.okr(r2) and pg_temp.sv(j, 9, 'status') = 'sent');
  -- ย้อนขั้น (reopen)
  d := pg_temp.mk_old_order(p_shop, p_tpl);
  j2 := pg_temp.jid(d);
  rr := pg_temp.rw(p_shop, j2, null, 8);
  r := pg_temp.o_recv(p_shop, j2, 9, v_today, null, null, 'verify');
  r2 := pg_temp.o_reopen(p_shop, j2);
  v := v || pg_temp.chk('F3', 'ใบเก่า: ย้อนขั้น (reopen) ขั้นที่รับอยู่ได้ — ' || coalesce(pg_temp.codeof(r2), 'ok'), pg_temp.okr(r) and pg_temp.okr(r2) and pg_temp.sv(j2, 9, 'status') = 'pending');
  -- แยกส่วนย่อยที่ขั้นหลังฝังพลอย: ส่วนย่อยคัดลอก seq ใบแม่ (ผังเก่า) ผ่านด่านใหม่
  d := pg_temp.mk_old_order(p_shop, p_tpl);
  j3 := pg_temp.jid(d);
  rr := pg_temp.rw(p_shop, j3, null, 8);
  r := pg_temp.o_recv(p_shop, j3, 9, v_today, null, null, 'verify');
  r2 := pg_temp.o_split(p_shop, j3, 9, 4);
  lot := pg_temp.lot(r2);
  v := v || pg_temp.chk('F4', '🔴 เหตุผลหลักของไฟล์: ใบเก่า (buff7 gem_set8) แยกส่วนย่อยที่ขั้น 9 ได้ · ส่วนย่อยลำดับเหมือนใบแม่เป๊ะ — ' || coalesce(pg_temp.codeof(r2), 'ok'),
    pg_temp.okr(r) and pg_temp.okr(r2) and lot is not null and pg_temp.stages_of(lot) = pg_temp.stages_of(j3));
  dr := pg_temp.q(format('select to_jsonb(analytics.job_tree_dominant_stage(%L))', j3));
  v := v || pg_temp.chk('F5', 'ใบเก่าหลังแยก: ไม่มี drift · job_tree_dominant_stage ไม่ error — drift ' || pg_temp.drift(j3) || ' · ' || dr::text,
    pg_temp.drift(j3) = 0 and not (dr ? '_err'));
  -- ได้รับเพิ่มแล้ว (arrive): ขั้น 9 รับ 8 จาก 10 → ส่วนต่าง 2 → arrive 2 → ส่วนใหม่คัดลอกขั้น
  d := pg_temp.mk_old_order(p_shop, p_tpl);
  j4 := pg_temp.jid(d);
  rr := pg_temp.rw(p_shop, j4, null, 8);
  r := pg_temp.o_recv2(p_shop, j4, 9, 8);
  dd := pg_temp.disc_of(j4);
  r2 := pg_temp.oa(p_shop, dd, 2);
  select count(*) into n from analytics.job where parent_job_id = j4;
  v := v || pg_temp.chk('F6', '🔴 ใบเก่า: ขั้น 9 รับ 8 จาก 10 → ส่วนต่าง 2 → "ได้รับเพิ่มแล้ว" ผ่าน · เกิดส่วนใหม่ 1 ส่วนที่ลำดับขั้นเหมือนใบแม่ — ' || coalesce(pg_temp.codeof(r), 'ok') || '/' || coalesce(pg_temp.codeof(r2), 'ok'),
    pg_temp.okr(r) and dd is not null and pg_temp.okr(r2) and n = 1
    and (select pg_temp.stages_of(l.id) = pg_temp.stages_of(j4) from analytics.job l where l.parent_job_id = j4 limit 1));
  return v;
end;
$c$;

-- ===== G: ใบใหม่ลำดับ แต่ง→ฝังพลอย→ขัด (แบบ JB-0040 หลังสลับ) เดินครบ (เคส 9) =====
create function pg_temp.run_g(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare
  v text := ''; d jsonb; j uuid; j2 uuid; rr jsonb; dn jsonb; r jsonb; r2 jsonb; lot uuid; dr jsonb; v_today date := analytics.job_today();
begin
  d := pg_temp.mkp(p_shop, p_tpl, 'silver', pg_temp.pid(p_shop, 'none'), pg_temp.std_gem(), 10);
  j := pg_temp.jid(d);
  rr := pg_temp.rw(p_shop, j, null, 10);
  dn := pg_temp.o_done(p_shop, j, 10, 0);
  v := v || pg_temp.chk('G1', 'ใบลำดับใหม่เดิน หล่อ→แต่ง→ฝังพลอย→ขัด→QC→แพ็ก ครบแล้วปิดงานได้ — ' || rr::text || ' · ' || coalesce(pg_temp.codeof(dn), 'ok'),
    j is not null and pg_temp.okr(rr) and pg_temp.okr(dn) and (select status from analytics.job where id = j) = 'done');
  d := pg_temp.mkp(p_shop, p_tpl, 'silver', pg_temp.pid(p_shop, 'none'), pg_temp.std_gem(), 10);
  j2 := pg_temp.jid(d);
  rr := pg_temp.rw(p_shop, j2, null, 6);
  r := pg_temp.o_recv(p_shop, j2, 7, v_today, null, null, 'verify');
  r2 := pg_temp.o_split(p_shop, j2, 7, 4);
  lot := pg_temp.lot(r2);
  dr := pg_temp.q(format('select to_jsonb(analytics.job_tree_dominant_stage(%L))', j2));
  v := v || pg_temp.chk('G2', 'ใบลำดับใหม่ แยกส่วนย่อยที่ขั้นฝังพลอย (ขั้น 7) ได้ · ส่วนย่อยลำดับเหมือนใบแม่ · ไม่มี drift · dominant stage ไม่ error — ' || coalesce(pg_temp.codeof(r2), 'ok') || ' · drift ' || pg_temp.drift(j2),
    pg_temp.okr(r) and pg_temp.okr(r2) and lot is not null and pg_temp.stages_of(lot) = pg_temp.stages_of(j2) and pg_temp.drift(j2) = 0 and not (dr ? '_err'));
  return v;
end;
$c$;

-- ===== H: ทอง (ค-1: ไม่แตะแบบบันทึกของทอง) — ใช้ได้เฉพาะก่อน 0195 =====
create function pg_temp.run_h(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare
  v text := ''; d jsonb; j uuid; rr jsonb; r jsonb; st jsonb; v_today date := analytics.job_today();
begin
  d := pg_temp.mkp(p_shop, p_tpl, 'gold', pg_temp.pid(p_shop, 'gold'), pg_temp.std_gem(), 10);
  j := pg_temp.jid(d);
  st := analytics.job_profile_state(j);
  v := v || pg_temp.chk('H1', 'ใบทอง (แบบทองปริยาย) ลำดับใหม่: finish/gem_set/buff ชั่งตามแบบเดิม (ค-1 ไม่แตะแบบทอง) · gold_unguarded=false — ' || coalesce(pg_temp.flags_of(j), d::text),
    j is not null and pg_temp.flags_of(j) like '%cut_sprue:wq,finish:wq,gem_set:wq,buff:wq,qc:wq,pack:wq' and (st ->> 'gold_unguarded') = 'false');
  rr := pg_temp.rw(p_shop, j, 10, 7);
  r := pg_temp.o_recv(p_shop, j, 8, v_today, null, null, 'verify');
  v := v || pg_temp.chk('H2', 'ทอง (เคส 6): รับ buff โดยไม่ชั่ง = weight_required · ขั้นยัง pending — ' || coalesce(pg_temp.codeof(r), 'ok'),
    pg_temp.okr(rr) and pg_temp.codeof(r) = 'weight_required' and pg_temp.sv(j, 8, 'status') = 'pending');
  r := pg_temp.o_recv(p_shop, j, 8, v_today, 11, null, 'verify');
  v := v || pg_temp.chk('H3', 'ทอง (เคส 6): buff.in 11 ต่างจาก gem_set.out 10 เกิน 0.05 = handoff_mismatch · ขั้นยัง pending — ' || coalesce(pg_temp.codeof(r), 'ok'),
    pg_temp.codeof(r) = 'handoff_mismatch' and pg_temp.sv(j, 8, 'status') = 'pending');
  r := pg_temp.o_recv(p_shop, j, 8, v_today, 10, null, 'verify');
  v := v || pg_temp.chk('H4', 'ต้องไม่พัง: ทอง buff.in 10 ตรง gem_set.out 10 รับได้', pg_temp.okr(r) and pg_temp.sv(j, 8, 'status') = 'received');
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
      || pg_temp.grp('H', format('select pg_temp.run_h(%L, %L)', p_shop, p_tpl))
$c$;

do $v194$
declare
  v_shop uuid; v_tpl uuid;
  v_log text := ''; v_s text; v_fail int; v_snap0 text; v_m jsonb; v_killed int := 0; v_total int; v_survived text := ''; v_id text; v_hit int; v_k int; v_cnt int;
  v_mutants jsonb := jsonb_build_array(
    jsonb_build_object('id', 'MU-1', 'what', 'job_stage_guard: ส่วนย่อยกลับไปเทียบทะเบียนเหมือนใบแม่ (ถอดด่านสำเนาใบแม่ = พฤติกรรมเดิม 0183)', 'fn', 'job_stage_guard', 'from', 'if v_job.parent_job_id is null then
      if exists (', 'to', 'if true then
      if exists (', 'expect', jsonb_build_array('F4', 'F6')),
    jsonb_build_object('id', 'MU-2', 'what', 'job_stage_guard: ถอดด่านลำดับ seq_default ของใบแม่', 'fn', 'job_stage_guard', 'from', '(s.seq < new.seq and d.seq_default > dn.seq_default)', 'to', '(s.seq < new.seq and d.seq_default > dn.seq_default + 100000)', 'expect', jsonb_build_array('D2')),
    jsonb_build_object('id', 'MU-3', 'what', 'ทะเบียน: buff กลับไป 92 (ลำดับเก่า ขัดก่อนฝังพลอย)', 'ddl', 'update analytics.job_stage_def set seq_default = 92 where code = ''buff''', 'expect', jsonb_build_array('A1', 'C2', 'D1', 'D3')),
    jsonb_build_object('id', 'MU-4', 'what', 'ทะเบียน: buff weigh_default กลับเป็น true', 'ddl', 'update analytics.job_stage_def set weigh_default = true where code = ''buff''', 'expect', jsonb_build_array('A2')),
    jsonb_build_object('id', 'MU-5', 'what', 'job_stage_def_ensure: buff กลับไป seq 92 (ร้านใหม่)', 'fn', 'job_stage_def_ensure', 'from', '105, ''per_piece''', 'to', '92, ''per_piece''', 'expect', jsonb_build_array('B1')),
    jsonb_build_object('id', 'MU-6', 'what', 'job_stage_def_ensure: buff ชั่งค่าเริ่ม (weigh_default true)', 'fn', 'job_stage_def_ensure', 'from', '105, ''per_piece'', null,           false, true', 'to', '105, ''per_piece'', null,           true,  true', 'expect', jsonb_build_array('B2'))
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

  create temp table _v194_orig on commit drop as
    select p.oid::regprocedure::text as sig, md5(replace(pg_get_functiondef(p.oid), E'\r', '')) as h, p.proacl::text as acl
      from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.prokind in ('f', 'p');
  v_snap0 := pg_temp.snap();

  begin
    v_s := pg_temp.run_all(v_shop, v_tpl);
    raise exception 'V194_ROLLBACK';
  exception when others then
    if sqlerrm <> 'V194_ROLLBACK' then
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

  select count(*) into v_hit from _v194_orig o join pg_proc p on p.pronamespace = 'analytics'::regnamespace and p.prokind in ('f', 'p') and p.oid::regprocedure::text = o.sig where md5(replace(pg_get_functiondef(p.oid), E'\r', '')) = o.h and p.proacl::text is not distinct from o.acl;
  v_log := v_log || pg_temp.chk('MY', format('หลัง mutant: md5 นิยาม + สิทธิ์ของฟังก์ชันทุกตัวในสคีมา analytics (%s ตัว) เท่าเดิมเป๊ะ (เคส 12)', (select count(*) from _v194_orig)),
    v_hit = (select count(*) from _v194_orig) and (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace and prokind in ('f', 'p')) = (select count(*) from _v194_orig));
  v_log := v_log || pg_temp.chk('K0b', 'state ไม่ขยับหลังรัน mutant ทั้งหมด', pg_temp.snap() = v_snap0);
  v_log := v_log || pg_temp.chk('P1', 'ไม่มี overload: job_stage_guard / job_stage_def_ensure อย่างละ 1 signature · ไม่มีใคร (public/anon/authenticated) ถือ EXECUTE (เคส 12)',
    (select count(*) from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname in ('job_stage_guard', 'job_stage_def_ensure')) = 2
    and not has_function_privilege('anon', 'analytics.job_stage_def_ensure(uuid)', 'execute') and not has_function_privilege('authenticated', 'analytics.job_stage_def_ensure(uuid)', 'execute')
    and not has_function_privilege('anon', 'analytics.job_stage_guard()', 'execute') and not has_function_privilege('authenticated', 'analytics.job_stage_guard()', 'execute')
    and not exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     where p.pronamespace = 'analytics'::regnamespace and p.proname in ('job_stage_guard', 'job_stage_def_ensure') and a.privilege_type = 'EXECUTE' and a.grantee = 0));

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_log := v_log || format(E'\n=== สรุป (ส่วน A): [OK] ~%s (ชุดหลัก) · mutant %s ตัว · [SKIP] %s · [FAIL] ทั้งไฟล์ = %s %s ===\n', v_cnt, v_total,
    (length(v_log) - length(replace(v_log, '[SKIP]', ''))) / 6, v_fail, case when v_fail = 0 then '(ผ่าน)' else '(ไม่ผ่าน)' end);
  raise exception E'%', v_log;
end;
$v194$;

