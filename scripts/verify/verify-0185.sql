-- scripts/verify/verify-0185.sql
-- ตรวจ supabase/migrations/0185_worker_pin_relax.sql (ผ่อนกฎ PIN ช่าง: ตัวเลข 4 หลักอย่างเดียว · เจ้าของ 20 ต.ค. 69)
-- self-rolling-back (3j-migration-traps ข้อ 11) · ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน
-- ทดสอบผ่าน RPC ของระบบ (worker_upsert / worker_pin_set / worker_pin_verify) · ข้อยกเว้นที่บอกตรงๆ (ในทรานแซกชันที่ถอยกลับ):
--   · ใบเสนอราคา OEM = โคลนจากรายการจริงด้วย INSERT (แบบเดียวกับ verify-0172..0184) เพื่อได้ใบงาน/QR ให้ช่าง login · P4 ตั้งสถานะล็อกช่างด้วย UPDATE ตรง (จำลองช่างโดนล็อก)
-- รอบแรก = ของจริง (ถอยกลับแล้วเทียบ state) · รอบถัดไป = mutant (ต้องถูกจับด้วย id ที่ระบุ) · ปิดท้ายตรวจ md5 ฟังก์ชันทุกตัวเท่าเดิม
--
-- รัน (หลัง apply 0185):  node scripts/run-sql.mjs scripts/verify/verify-0185.sql
-- dry-run ก่อน apply:     ต่อไฟล์ migration + ไฟล์นี้ (จาก git blob ไม่ใช่ working tree CRLF) แล้วรันไม่ใส่ --commit
--
-- ============ ตารางแมป "ข้อในบรีฟ -> เทสต์ที่ครอบ" ============
--  ✅ ต้องผ่าน: 1111 · 1212 · 1234 · 0000 · 1122 (+ 2580 0123 4321 9999)                         -> P1 (job_pin_ok) · P3 (เพิ่มช่างด้วย PIN เหล่านี้ผ่าน RPC) · MU-1
--  ✅ ตั้ง PIN แล้ว login ด้วย PIN นั้นได้ · PIN ไม่ถูกคืน/ไม่ลง audit                                 -> P3 P4 · MU-8
--  ✅ ตั้ง PIN ใหม่ = ปลดล็อก + ล้างตัวนับ + session เดิมหมดอายุ + PIN เดิมใช้ไม่ได้ (พฤติกรรมเดิม)   -> P4 · MU-6 MU-7
--  ❌ ห้ามผ่าน: '123' '12345' 'abcd' '12a4' ' 1234' '' null เลขไทย full-width                     -> P2 (ฟังก์ชัน) · P2b (ผ่าน RPC ทั้ง 2 ทาง = hint pin_invalid) · MU-2 MU-3 MU-4 MU-8
--     ('1234 ' · '1234\n' · '12\n34' · '+123' · '-123' · '12.4' ด้วย)
--  🟢 null ผ่าน RPC = สุ่ม (ไม่ใช่ null=ผ่าน job_pin_ok) · PIN สุ่มยังห้ามเดาง่ายเหมือนเดิม            -> P2c · P5 (สุ่ม 3000 ครั้ง ไม่มีซ้ำ/คู่ซ้ำ/เรียง/0000/2580) · MU-5
--  🟢 แก้ช่างเดิมยังไม่รับ PIN (ต้องใช้ worker_pin_set)                                           -> P6
--  ✅ ไม่แตะนโยบายล็อก 5/10/15: md5 worker_pin_verify · worker_pin_set · worker_upsert · worker_unlock · job_worker_resolve เท่ากับของก่อน 0185 -> P7
--  ✅ IMMUTABLE/search_path/ACL เดิม · ไม่มี overload                                             -> P7
--  K0: ชุดทดสอบไม่ทิ้งรอย · MY: md5 ฟังก์ชันเท่าเดิมหลัง mutant
--
--  ❌ ไม่มีเทสต์ครอบ (บอกตรงๆ):
--    - ด่านล็อก 5/10/15 ครั้งเอง (ไม่แตะในงานนี้ — ล็อก md5 ของ worker_pin_verify ไว้แทนการทดสอบพฤติกรรมซ้ำ)
--    - ข้อความ error ภายใน DB ของ worker_pin_set/worker_upsert ยังพูดถึง "เลขซ้ำ/เรียง" (ไม่ได้ replace — หน้าจอแปลงจาก hint · ดูหนี้ใน migration)
--    - ฝั่ง TS/หน้าจอ (ปุ่ม "ตั้ง PIN เอง" · parsePin) = vitest ฝั่ง lib/components ไม่ใช่ไฟล์นี้
--    - race (ตั้ง PIN กับ login พร้อมกัน): do-block ทรานแซกชันเดียวจำลองไม่ได้ · worker_pin_set ล็อกแถวช่าง for update เหมือนเดิม
set local statement_timeout = '45min';

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
create function pg_temp.act() returns uuid language sql as $c$ select '00000000-0000-0000-0000-0000000000a1'::uuid $c$;
create function pg_temp.okr(r jsonb) returns boolean language sql as $c$
  select not (r ? '_err') and (r ->> 'ok') is distinct from 'false' $c$;
create function pg_temp.rej(r jsonb, p_hint text) returns boolean language sql as $c$
  select coalesce(r ? '_err' and r ->> '_state' = '22023' and (p_hint is null or r ->> '_hint' = p_hint), false) $c$;
create function pg_temp.std() returns text[] language sql as $c$
  select array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'qc', 'pack'] $c$;
create function pg_temp.clone_deal(p_tpl_item uuid, p_metal text, p_qty int) returns jsonb
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
  v_input := v_item.input || jsonb_build_object('metal', p_metal, 'is_new_design', false);
  insert into analytics.oem_quote
    select (jsonb_populate_record(null::analytics.oem_quote,
      to_jsonb(v_quote) || jsonb_build_object('id', v_q, 'quote_no', 'V185-' || substr(v_q::text, 1, 8), 'status', 'won',
        'root_quote_id', v_q, 'parent_quote_id', null))).*;
  insert into analytics.oem_quote_item
    select (jsonb_populate_record(null::analytics.oem_quote_item,
      to_jsonb(v_item) || jsonb_build_object('id', v_i, 'quote_id', v_q, 'seq', 1, 'input', v_input, 'qty', p_qty))).*;
  return jsonb_build_object('quote_id', v_q, 'item_id', v_i);
end;
$c$;
create function pg_temp.mkjob_tok(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare d jsonb; r jsonb; j uuid;
begin
  d := pg_temp.clone_deal(p_tpl, 'silver', 10);
  r := pg_temp.q(format('select analytics.job_create_from_quote_item(p_shop_id=>%L, p_quote_item_id=>%L, p_stage_codes=>%L::text[], p_start_gate_note=>%L, p_design_label=>%L, p_actor=>%L)',
    p_shop, d ->> 'item_id', pg_temp.std(), 'verify: เริ่มผลิตก่อนมัดจำ', 'v185-ชื่อเรียกภายใน', pg_temp.act()));
  j := (r ->> 'job_id')::uuid;
  if j is null then raise exception 'mkjob_tok: สร้างใบไม่ได้ %', r::text; end if;
  r := pg_temp.q(format('select analytics.job_token_issue(%L, %L, %L, %L)', p_shop, j, true, pg_temp.act()));
  if not (r ? 'token') then raise exception 'mkjob_tok: ออก token ไม่ได้ %', r::text; end if;
  return analytics.job_sha256_hex(r ->> 'token');
end;
$c$;
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
create function pg_temp.login_ok(p_tokh text, p_worker uuid, p_pin text) returns boolean
 language sql as $c$ select (pg_temp.login(p_tokh, p_worker, p_pin) ->> 'ok') = 'true' $c$;
create function pg_temp.wu(p_shop uuid, p_name text, p_pin text) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.worker_upsert(p_shop_id=>%L, p_display_name=>%L, p_stage_codes=>%L::text[], p_pin=>%L, p_actor=>%L)',
    p_shop, p_name, '{qc,pack}', p_pin, pg_temp.act())) $c$;
create function pg_temp.wset(p_shop uuid, p_worker uuid, p_pin text) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.worker_pin_set(p_shop_id=>%L, p_worker_id=>%L, p_pin=>%L, p_actor=>%L)', p_shop, p_worker, p_pin, pg_temp.act())) $c$;
-- เกณฑ์ "เดาง่าย" แบบเขียนใหม่อิสระจากตัวสุ่ม (ใช้ตรวจ PIN ที่ระบบสุ่มให้)
create function pg_temp.weak(v text) returns boolean language sql as $c$
  select v ~ '^(.)\1{3}$' or v ~ '^(..)\1$'
      or v = any (array['0123', '1234', '2345', '3456', '4567', '5678', '6789', '3210', '4321', '5432', '6543', '7654', '8765', '9876', '0000', '2580']) $c$;
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
  for r in select unnest(array['job', 'job_stage', 'job_event', 'job_token', 'worker', 'worker_audit', 'worker_session', 'job_counter', 'oem_quote', 'oem_quote_item']) as t loop
    if to_regclass('analytics.' || r.t) is not null then
      execute format('select count(*)::text || ''/'' || coalesce(md5(string_agg(x::text, ''|'' order by x::text)), '''') from analytics.%I x', r.t) into n;
      v := v || r.t || '=' || n || ';';
    end if;
  end loop;
  return md5(v);
end;
$c$;
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

-- ===== P1-P2: ฟังก์ชัน job_pin_ok ตรงๆ =====
create function pg_temp.run_fn() returns text
 language plpgsql as $c$
declare
  v text := ''; s text; p text; n int;
  c_good constant text[] := array['1111', '1212', '1234', '0000', '1122', '2580', '0123', '4321', '9999', '0001', '0910'];
  c_bad  constant text[] := array['123', '12345', 'abcd', '12a4', ' 1234', '1234 ', '', '๑๒๓๔', '１２３４', E'1234\n', E'12\n34', '1234a', '-123', '12.4', '+123', '١٢٣٤', '12 34', E'\t123'];
begin
  s := '';
  foreach p in array c_good loop
    if analytics.job_pin_ok(p) is not true then s := s || p || ' '; end if;
  end loop;
  v := v || pg_temp.chk('P1', 'job_pin_ok ยอม 1111 · 1212 · 1234 · 0000 · 1122 · 2580 · 0123 · 4321 · 9999 · 0001 · 0910 — ถูกปฏิเสธผิด: ' || coalesce(nullif(s, ''), 'ไม่มี'), s = '');
  s := '';
  foreach p in array c_bad loop
    if analytics.job_pin_ok(p) is true then s := s || '[' || replace(replace(p, E'\n', '\n'), E'\t', '\t') || '] '; end if;
  end loop;
  v := v || pg_temp.chk('P2', 'job_pin_ok ปฏิเสธ 123 · 12345 · abcd · 12a4 · " 1234" · "1234 " · "" · เลขไทย · full-width · อาหรับ-อินดิก · ขึ้นบรรทัดใหม่ · แท็บ · เครื่องหมาย — หลุดผ่าน: ' || coalesce(nullif(s, ''), 'ไม่มี')
    || ' · null = ' || coalesce(analytics.job_pin_ok(null)::text, 'null (ไม่ใช่ true)'),
    s = '' and analytics.job_pin_ok(null) is not true);
  return v;
end;
$c$;

-- ===== P2b-P6: ผ่าน RPC =====
create function pg_temp.run_rpc(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare
  v text := ''; s text; p text; r jsonb; r2 jsonb; w uuid; w2 uuid; th text; ses1 jsonb; n int; i int; v_pin text;
  c_bad constant text[] := array['123', '12345', 'abcd', '12a4', ' 1234', '', '๑๒๓๔', '１２３４', E'1234\n'];
  c_good constant text[] := array['1111', '1212', '1234', '0000', '1122'];
  v_unlocked boolean; v_old_login boolean; v_new_login boolean;
begin
  th := pg_temp.mkjob_tok(p_shop, p_tpl);

  -- P2b: PIN ผิดรูปแบบผ่าน worker_upsert (เพิ่ม) และ worker_pin_set (ตั้งใหม่) = ปฏิเสธ pin_invalid · ไม่มีช่างเกิดจากทางที่ปฏิเสธ
  r := pg_temp.wu(p_shop, 'v185-ช่างฐาน', '2468');
  w := (r ->> 'id')::uuid;
  s := '';
  foreach p in array c_bad loop
    r := pg_temp.wu(p_shop, 'v185-ช่างผิด-' || md5(p), p);
    r2 := pg_temp.wset(p_shop, w, p);
    if not (pg_temp.rej(r, 'pin_invalid') and pg_temp.rej(r2, 'pin_invalid')) then s := s || '[' || replace(p, E'\n', '\n') || ':' || coalesce(r ->> '_hint', 'ผ่าน') || '/' || coalesce(r2 ->> '_hint', 'ผ่าน') || '] '; end if;
  end loop;
  select count(*) into n from analytics.worker where display_name like 'v185-ช่างผิด-%';
  v := v || pg_temp.chk('P2b', 'PIN ผิดรูปแบบ ปฏิเสธ 22023 pin_invalid ทั้ง worker_upsert และ worker_pin_set · ไม่เกิดช่างจากทางที่ปฏิเสธ (' || n || ') — หลุด: ' || coalesce(nullif(s, ''), 'ไม่มี'), s = '' and n = 0);
  r := pg_temp.wset(p_shop, w, '123');
  v := v || pg_temp.chk('P2b2', 'PIN เดิมของช่างไม่ถูกแตะเมื่อตั้งใหม่ล้มเหลว (ยัง login ด้วย 2468 ได้)', pg_temp.login_ok(th, w, '2468'));

  -- P2c: null = สุ่ม (ไม่ใช่ทางลัดผ่านด่าน) · คืน PIN 4 หลักที่เดาไม่ง่าย
  r := pg_temp.wu(p_shop, 'v185-ช่างสุ่ม', null);
  r2 := pg_temp.wset(p_shop, w, null);
  v := v || pg_temp.chk('P2c', 'ไม่ส่ง PIN (null) = สุ่ม: เพิ่มช่างและตั้งใหม่ pin_generated=true คืน PIN 4 หลักไม่เดาง่าย — ' || coalesce(r ->> 'pin', '?') || '/' || coalesce(r2 ->> 'pin', '?'),
    (r ->> 'pin_generated') = 'true' and (r2 ->> 'pin_generated') = 'true'
    and (r ->> 'pin') ~ '^[0-9]{4}$' and (r2 ->> 'pin') ~ '^[0-9]{4}$' and not pg_temp.weak(r ->> 'pin') and not pg_temp.weak(r2 ->> 'pin')
    and pg_temp.login_ok(th, w, r2 ->> 'pin'));

  -- P3: เพิ่มช่างด้วย PIN เลขซ้ำ/เรียง/0000 ผ่าน · ไม่คืน PIN กลับ · login ด้วย PIN นั้นได้ · PIN อื่นเข้าไม่ได้
  s := '';
  i := 0;
  foreach p in array c_good loop
    i := i + 1;
    r := pg_temp.wu(p_shop, 'v185-ช่างตั้งเอง-' || i, p);
    w2 := (r ->> 'id')::uuid;
    if not (pg_temp.okr(r) and w2 is not null and (r ->> 'pin_generated') = 'false' and (r ->> 'pin') is null
            and pg_temp.login_ok(th, w2, p) and not pg_temp.login_ok(th, w2, case when p = '9999' then '9998' else '9999' end)) then
      s := s || p || ':' || coalesce(r::text, '?') || ' ';
    end if;
  end loop;
  v := v || pg_temp.chk('P3', 'เพิ่มช่างด้วย PIN 1111 · 1212 · 1234 · 0000 · 1122 ผ่าน (ไม่คืน PIN) · login ด้วย PIN นั้นได้ · PIN อื่นไม่ได้ — ผิด: ' || coalesce(nullif(s, ''), 'ไม่มี'), s = '');

  -- P4: ตั้ง PIN เอง = ปลดล็อก + ล้างตัวนับ + session เดิมหมดอายุ + PIN เดิมใช้ไม่ได้ + audit ไม่มี PIN
  r := pg_temp.wu(p_shop, 'v185-ช่างรีเซ็ต', '2468');
  w2 := (r ->> 'id')::uuid;
  ses1 := pg_temp.login(th, w2, '2468');
  update analytics.worker set failed_attempts = 5, failed_window_start = now(), last_failed_at = now(), locked_until = now() + interval '1 hour' where id = w2;
  r := pg_temp.wset(p_shop, w2, '1111');
  select count(*) into n from analytics.worker_session where worker_id = w2 and revoked_at is null;
  select (locked_until is null and failed_attempts = 0 and failed_window_start is null and last_failed_at is null) into v_unlocked from analytics.worker where id = w2;
  v_old_login := pg_temp.login_ok(th, w2, '2468');
  v_new_login := pg_temp.login_ok(th, w2, '1111');
  v := v || pg_temp.chk('P4', 'ตั้ง PIN เอง 1111: ok · ไม่คืน PIN · ปลดล็อก+ล้างตัวนับ · session เดิมหมดอายุ (ค้าง ' || n || ') · PIN เดิม 2468 ใช้ไม่ได้ · 1111 login ได้ · audit pin_set ไม่มีตัวเลข PIN — ' || coalesce(r::text, '?'),
    pg_temp.okr(r) and (r ->> 'pin') is null and (r ->> 'pin_generated') = 'false'
    and v_unlocked
    and (ses1 ->> 'ok') = 'true' and n = 0
    and not v_old_login and v_new_login
    and exists (select 1 from analytics.worker_audit a where a.worker_id = w2 and a.action = 'pin_set' and (a.detail ->> 'pin_generated') = 'false' and a.detail::text !~ '1111|2468'));

  -- P6: แก้ช่างเดิมยังไม่รับ PIN
  r := pg_temp.q(format('select analytics.worker_upsert(p_shop_id=>%L, p_id=>%L, p_display_name=>%L, p_stage_codes=>%L::text[], p_pin=>%L, p_actor=>%L)', p_shop, w2, 'v185-ช่างรีเซ็ต', '{qc,pack}', '1111', pg_temp.act()));
  v := v || pg_temp.chk('P6', 'worker_upsert แก้ช่างเดิมที่ส่ง PIN มา = ปฏิเสธ use_pin_set (ไม่เปลี่ยนจากเดิม) — ' || coalesce(r ->> '_hint', 'ผ่าน'), pg_temp.rej(r, 'use_pin_set'));
  return v;
end;
$c$;

-- ===== P5: ตัวสุ่ม · P7: ฟังก์ชัน/ACL/นโยบายล็อกไม่ขยับ =====
create function pg_temp.run_gen() returns text
 language plpgsql as $c$
declare
  v_out text := ''; n_bad int; n_all int; n_distinct int;
begin
  select count(*) filter (where t.pin !~ '^[0-9]{4}$' or pg_temp.weak(t.pin)), count(*), count(distinct t.pin) into n_bad, n_all, n_distinct
    from (select analytics.job_pin_generate() as pin from generate_series(1, 3000)) t;
  v_out := v_out || pg_temp.chk('P5', 'job_pin_generate 3000 ครั้ง: ทุกค่าเป็นเลข 4 หลัก ไม่มีเลขซ้ำ/คู่ซ้ำ/เรียง/0000/2580 (ผิด ' || n_bad || ' · ค่าต่างกัน ' || n_distinct || ' — ต้องกว้างพอไม่ใช่ค่าคงที่)', n_bad = 0 and n_all = 3000 and n_distinct > 500);
  return v_out;
end;
$c$;
create function pg_temp.run_fixed() returns text
 language plpgsql as $c$
declare
  v text := ''; s text;
begin
  select string_agg(x.sig || ' ' || x.h, E'\n   ') into s from (
    select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h from pg_proc p
     where p.pronamespace = 'analytics'::regnamespace
       and ((p.proname = 'worker_pin_verify' and md5(pg_get_functiondef(p.oid)) <> 'bf7bdec64872171efe68ada504993c7b')
         or (p.proname = 'worker_pin_set' and md5(pg_get_functiondef(p.oid)) <> '7726e18f686d2107e9ccae37eb1cfa55')
         or (p.proname = 'worker_upsert' and md5(pg_get_functiondef(p.oid)) <> '0329dd3188842b7431ff3ebf8e179e7b')
         or (p.proname = 'worker_unlock' and md5(pg_get_functiondef(p.oid)) <> '8e72e6fc913f79c180a729d767114eba')
         or (p.proname = 'job_worker_resolve' and md5(pg_get_functiondef(p.oid)) <> 'd79d01d139e268fe384a5a87753ddb01'))) x;
  v := v || pg_temp.chk('P7a', 'ไม่แตะนโยบายล็อก/ช่าง: md5 definition ของ worker_pin_verify · worker_pin_set · worker_upsert · worker_unlock · job_worker_resolve เท่าก่อน 0185 — ขยับ: ' || coalesce(s, 'ไม่มี'),
    s is null and (select count(*) from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname in ('worker_pin_verify', 'worker_pin_set', 'worker_upsert', 'worker_unlock', 'job_worker_resolve')) = 5);
  v := v || pg_temp.chk('P7b', 'job_pin_ok/job_pin_generate: อย่างละ 1 signature · IMMUTABLE / VOLATILE เดิม · search_path เดิม · proacl = เจ้าของอย่างเดียว (ไม่มี PUBLIC/anon/authenticated/service_role)',
    (select count(*) from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname in ('job_pin_ok', 'job_pin_generate')) = 2
    and (select p.provolatile::text || p.proconfig::text || p.proacl::text from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'job_pin_ok') = 'i{"search_path=pg_catalog, pg_temp"}{postgres=X/postgres}'
    and (select p.provolatile::text || p.proconfig::text || p.proacl::text from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'job_pin_generate') = 'v{"search_path=pg_catalog, extensions, pg_temp"}{postgres=X/postgres}'
    and not has_function_privilege('anon', 'analytics.job_pin_ok(text)', 'execute') and not has_function_privilege('authenticated', 'analytics.job_pin_ok(text)', 'execute')
    and not has_function_privilege('anon', 'analytics.job_pin_generate()', 'execute') and not has_function_privilege('authenticated', 'analytics.job_pin_generate()', 'execute'));
  return v;
end;
$c$;

create function pg_temp.run_all(p_shop uuid, p_tpl uuid) returns text
 language sql as $c$
  select pg_temp.grp('FN', 'select pg_temp.run_fn()')
      || pg_temp.grp('RPC', format('select pg_temp.run_rpc(%L, %L)', p_shop, p_tpl))
      || pg_temp.grp('GEN', 'select pg_temp.run_gen()')
      || pg_temp.grp('FIX', 'select pg_temp.run_fixed()')
$c$;

do $v185$
declare
  v_shop uuid; v_tpl uuid;
  v_log text := ''; v_s text; v_fail int; v_snap0 text; v_m jsonb; v_killed int := 0; v_total int; v_survived text := ''; v_id text; v_hit int; v_k int; v_cnt int;
  v_mutants jsonb := jsonb_build_array(
    jsonb_build_object('id', 'MU-1', 'what', 'job_pin_ok: ใส่กฎห้ามเลขซ้ำ 4 ตัวกลับ', 'fn', 'job_pin_ok', 'from', 'select p_pin ~ ''^[0-9]{4}$''', 'to', 'select p_pin ~ ''^[0-9]{4}$'' and p_pin !~ ''^(.)\1{3}$''', 'expect', jsonb_build_array('P1', 'P3')),
    jsonb_build_object('id', 'MU-2', 'what', 'job_pin_ok: ยอมความยาว 3-5 หลัก', 'fn', 'job_pin_ok', 'from', '[0-9]{4}', 'to', '[0-9]{3,5}', 'expect', jsonb_build_array('P2', 'P2b')),
    jsonb_build_object('id', 'MU-3', 'what', 'job_pin_ok: ถอด anchor ^ $ (มีขยะนำหน้า/ต่อท้ายผ่าน)', 'fn', 'job_pin_ok', 'from', '''^[0-9]{4}$''', 'to', '''[0-9]{4}''', 'expect', jsonb_build_array('P2', 'P2b')),
    jsonb_build_object('id', 'MU-4', 'what', 'job_pin_ok: null ผ่าน', 'fn', 'job_pin_ok', 'from', 'select p_pin ~', 'to', 'select p_pin is null or p_pin ~', 'expect', jsonb_build_array('P2')),
    jsonb_build_object('id', 'MU-5', 'what', 'job_pin_generate: ถอดกรองคู่ซ้ำ (ตัวสุ่มแจก 1212 ฯลฯ)', 'fn', 'job_pin_generate', 'from', 'and v !~ ''^(..)\1$''', 'to', '', 'expect', jsonb_build_array('P5')),
    jsonb_build_object('id', 'MU-6', 'what', 'worker_pin_set: ไม่เพิกถอน session เดิม', 'fn', 'worker_pin_set', 'from', 'update analytics.worker_session set revoked_at = clock_timestamp() where worker_id = p_worker_id and revoked_at is null;', 'to', '', 'expect', jsonb_build_array('P4', 'P7a')),
    jsonb_build_object('id', 'MU-7', 'what', 'worker_pin_set: ไม่ปลดล็อก', 'fn', 'worker_pin_set', 'from', ', locked_until = null', 'to', '', 'expect', jsonb_build_array('P4', 'P7a')),
    jsonb_build_object('id', 'MU-8', 'what', 'job_pin_ok: รับทุกข้อความที่ไม่ null (ไม่ตรวจรูปแบบ)', 'fn', 'job_pin_ok', 'from', 'select p_pin ~ ''^[0-9]{4}$''', 'to', 'select p_pin is not null', 'expect', jsonb_build_array('P2', 'P2b'))
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

  create temp table _v185_orig on commit drop as
    select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h, p.proacl::text as acl
      from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.prokind in ('f', 'p');
  v_snap0 := pg_temp.snap();

  begin
    v_s := pg_temp.run_all(v_shop, v_tpl);
    raise exception 'V185_ROLLBACK';
  exception when others then
    if sqlerrm <> 'V185_ROLLBACK' then
      v_s := coalesce(v_s, '') || pg_temp.chk('S1-crash', 'ชุดหลัก raise นอกกลุ่ม: ' || sqlstate || ' ' || sqlerrm, false);
    end if;
  end;
  v_log := v_log || v_s;
  v_log := v_log || pg_temp.chk('K0', 'ชุดทดสอบไม่ทิ้งรอย: snapshot job/worker/worker_audit/worker_session/oem_quote เท่าเดิมหลังถอยกลับ', pg_temp.snap() = v_snap0);
  v_cnt := (length(v_s) - length(replace(v_s, '[OK]', ''))) / 4;

  v_total := jsonb_array_length(v_mutants);
  for v_k in 0 .. v_total - 1 loop
    v_m := v_mutants -> v_k;
    v_s := '';
    begin
      perform pg_temp.mutate(v_m ->> 'fn', v_m ->> 'from', v_m ->> 'to');
      v_s := pg_temp.run_all(v_shop, v_tpl);
      raise exception 'MX_ROLLBACK';
    exception when others then
      if sqlerrm <> 'MX_ROLLBACK' then
        v_s := v_s || '[FAIL] MX-crash-' || (v_m ->> 'id') || '  ' || sqlerrm || E'\n';
      end if;
    end;
    v_hit := 0;
    for v_id in select jsonb_array_elements_text(v_m -> 'expect') loop
      if position('[FAIL] ' || v_id || ' ' in v_s) > 0 or position('[FAIL] ' || v_id || '-crash ' in v_s) > 0 then v_hit := v_hit + 1; end if;
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

  select count(*) into v_hit from _v185_orig o join pg_proc p on p.pronamespace = 'analytics'::regnamespace and p.prokind in ('f', 'p') and p.oid::regprocedure::text = o.sig
   where md5(pg_get_functiondef(p.oid)) = o.h and p.proacl::text is not distinct from o.acl;
  v_log := v_log || pg_temp.chk('MY', format('หลัง mutant: md5 definition + สิทธิ์ของฟังก์ชันทุกตัวในสคีมา analytics (%s ตัว) เท่าเดิมเป๊ะ', (select count(*) from _v185_orig)),
    v_hit = (select count(*) from _v185_orig) and (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace and prokind in ('f', 'p')) = (select count(*) from _v185_orig));
  v_log := v_log || pg_temp.chk('K0b', 'state ไม่ขยับหลังรัน mutant ทั้งหมด', pg_temp.snap() = v_snap0);

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_log := v_log || format(E'\n=== สรุป: [OK] ~%s (ชุดหลัก) · mutant %s ตัว · [FAIL] ทั้งไฟล์ = %s %s ===\n', v_cnt, v_total, v_fail, case when v_fail = 0 then '(ผ่าน)' else '(ไม่ผ่าน)' end);
  raise exception E'%', v_log;
end;
$v185$;
