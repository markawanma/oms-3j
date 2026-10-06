-- scripts/verify/verify-0158.sql
-- ตรวจ supabase/migrations/0158_content_signal_hook_host.sql หลัง apply
-- (self-rolling-back do-block ตาม 3j-migration-traps #11: ทุกเคสเก็บผลลง v_log แล้ว raise exception
-- ปิดท้ายเสมอ ⇒ ทั้งทรานแซกชัน rollback · ผลทดสอบออกทาง error message · DB ไม่ขยับ ไม่ว่า PASS หรือ FAIL)
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0158.sql
-- dry-run ก่อน apply: ต่อไฟล์ migration + ไฟล์นี้เข้าด้วยกันเป็นไฟล์ชั่วคราวแล้วรันแบบไม่ใส่ --commit
--   (cat supabase/migrations/0158_*.sql scripts/verify/verify-0158.sql > tmp.sql) — ไฟล์นี้ต้องการ object ของ 0158
--
-- ผล: run-sql พิมพ์ "🔴 ล้มเหลว" พร้อม message = v_log นี่คือช่องทางรายงานผลปกติ (raise ตั้งใจ)
-- สรุป [OK]/[FAIL] อยู่ท้าย log · ถ้ามี [FAIL] ≥ 1 = ไม่ผ่าน
--
-- ⚠️ ก่อน/หลังรันตรวจด้วยมือ (trap #11): select count(*) จาก live_session_log / content_signal / content_hook /
-- live_host ต้องเท่ากันทั้งก่อนและหลัง (ไฟล์นี้เขียนแถวชั่วคราวในทรานแซกชันเท่านั้น ไม่เคย COMMIT)
--
-- ตาราง "เคสในบรีฟ → เทสต์" อยู่ในรายงานส่งมอบ (ไม่ซ้ำที่นี่) · รหัสเทสต์: A=สิทธิ์/RLS · B=เคสห้ามผ่าน ·
-- C=เคสต้องไม่พัง
--
-- 🔴 ข้อจำกัดที่ไฟล์นี้พิสูจน์ไม่ได้ (บอกตรงๆ): "ไม่แตะ view/ตาราง/ฟังก์ชันเดิม" ต้องมี baseline ก่อน apply —
-- ด่านนั้นอยู่ใน migration เอง (snapshot GUC c1.snap_* ก่อน แล้วเทียบตอนท้ายไฟล์ · raise ถ้าขยับ) ·
-- ไฟล์นี้ตรวจแค่สภาพหลัง apply + พิมพ์ md5 ไว้เทียบมือ
--
-- ถ้ามีร้านมากกว่า 1 ร้านใน public.shop ไฟล์นี้หยุด (ต้องการร้านเดียวเหมือน seed) — ร้านที่ 2 สร้างเองในทรานแซกชัน

-- ---------- helper (temp function — หายพร้อมทรานแซกชัน) ----------

-- รัน SQL ที่ "ควรถูกปฏิเสธ" — OK เมื่อ sqlstate อยู่ใน p_expect
create or replace function pg_temp.vx(p_sql text, p_expect text[]) returns text
 language plpgsql as $vx$
declare
  v_state text; v_msg text; v_detail text;
begin
  execute p_sql;
  return 'FAIL ผ่านทั้งที่ควรปฏิเสธ';
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail, v_msg = message_text;
  v_state := sqlstate;
  if v_state = any (p_expect) then
    return 'OK ' || v_state || coalesce(' detail=' || nullif(v_detail, ''), '') || ' msg=' || left(v_msg, 70);
  end if;
  return 'FAIL sqlstate=' || v_state || ' msg=' || left(v_msg, 140);
end $vx$;

-- รัน SQL ที่ "ควรสำเร็จ"
create or replace function pg_temp.vok(p_sql text) returns text
 language plpgsql as $vk$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return 'FAIL ควรสำเร็จแต่ตก sqlstate=' || sqlstate || ' msg=' || left(sqlerrm, 160);
end $vk$;

-- รัน SQL ที่คืน uuid ควรสำเร็จ
create or replace function pg_temp.vid(p_sql text, out o_id uuid, out o_res text)
 language plpgsql as $vi$
begin
  execute p_sql into o_id;
  o_res := 'OK';
exception when others then
  o_id := null;
  o_res := 'FAIL ควรสำเร็จแต่ตก sqlstate=' || sqlstate || ' msg=' || left(sqlerrm, 160);
end $vi$;

-- นับแถวที่มองเห็น (ใช้พิสูจน์ RLS ชั้นที่สอง) — 0 แถว หรือถูกปฏิเสธ 42501 = OK
create or replace function pg_temp.vrows(p_sql text) returns text
 language plpgsql as $vr$
declare v_n bigint;
begin
  execute p_sql into v_n;
  if v_n = 0 then return 'OK 0 แถว (RLS กรองหมด)'; end if;
  return 'FAIL เห็น ' || v_n || ' แถว';
exception when sqlstate '42501' then
  return 'OK ถูกปฏิเสธ 42501 (' || left(sqlerrm, 60) || ')';
when others then
  return 'FAIL sqlstate=' || sqlstate || ' msg=' || left(sqlerrm, 120);
end $vr$;

create or replace function pg_temp.vl(p_id text, p_what text, p_res text) returns text
 language sql as $vl$
  select '[' || case when p_res like 'OK%' then 'OK' else 'FAIL' end || '] ' || p_id || ' ' || p_what || ' → ' || p_res || E'\n'
$vl$;

create or replace function pg_temp.vb(p_id text, p_what text, p_cond boolean, p_detail text default '') returns text
 language sql as $vb$
  select '[' || case when p_cond is true then 'OK' else 'FAIL' end || '] ' || p_id || ' ' || p_what
         || case when p_detail <> '' then ' → ' || p_detail else '' end || E'\n'
$vb$;

do $verify0158$
declare
  v_log        text := E'\n=== verify-0158 ===\n';
  v_today      date := (now() at time zone 'Asia/Bangkok')::date;
  v_shop       uuid;
  v_shop2      uuid;
  v_host_a     uuid;
  v_host_b     uuid;
  v_host_x     uuid;
  v_step       uuid;
  v_step2      uuid;
  v_step_leg   uuid;
  v_id         uuid;
  v_sig_id     uuid;
  v_legacy0    bigint;
  v_id2        uuid;
  v_first      uuid;
  v_r          text;
  v_n          bigint;
  v_n2         bigint;
  v_bad        text;
  v_stmt       text;
  v_role       text;
  v_col        text;
  v_sig        text;
  v_md_before  text;
  v_md_after   text;
  v_live_ids   uuid[];
  v_live_cnt   bigint;
  v_hook_exp   int;
  v_fail       int;
  v_ok         int;
  r            record;
  v_b_type     text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);

  select count(*) into v_n from public.shop;
  if v_n <> 1 then
    raise exception 'verify-0158: ต้องมีร้านเดียวใน public.shop (พบ %) — ทดสอบไม่ได้', v_n;
  end if;
  select id into v_shop from public.shop;
  insert into public.shop (name) values ('verify-0158 shop B') returning id into v_shop2;

  select id into v_host_a from analytics.live_host where shop_id = v_shop and display_name = 'หมีเนย';
  select id into v_host_b from analytics.live_host where shop_id = v_shop and display_name = 'ฮันนี้ ปิ๊กๆ';
  select array_agg(id), count(*) into v_live_ids, v_live_cnt from analytics.live_session_log;
  select count(*) into v_legacy0 from analytics.content_hook where legacy_json_id is not null;
  select coalesce(sum(jsonb_array_length(a.clip_brief -> 'hooks')), 0)::int into v_hook_exp
    from analytics.step_artifact a where jsonb_typeof(a.clip_brief -> 'hooks') = 'array';

  select s.id into v_step from analytics.campaign_step s
   where s.shop_id = v_shop and not exists (select 1 from analytics.content_hook h where h.step_id = s.id)
   order by s.created_at, s.id limit 1;
  select s.id into v_step2 from analytics.campaign_step s
   where s.shop_id = v_shop and s.id <> v_step and not exists (select 1 from analytics.content_hook h where h.step_id = s.id)
   order by s.created_at, s.id limit 1;
  select h.step_id into v_step_leg from analytics.content_hook h where h.legacy_json_id is not null order by h.step_id limit 1;
  if v_step is null or v_step2 is null then
    raise exception 'verify-0158: หา step ที่ยังไม่มี hook ไม่ได้ — ทดสอบไม่ได้';
  end if;

  -- host ของร้านอื่น (ทรานแซกชันนี้เท่านั้น)
  select o_id, o_res into v_host_x, v_r from pg_temp.vid(format(
    'select analytics.live_host_upsert(%L::uuid, ''verify host X'', ''โฮสต์ X'')', v_shop2));
  v_log := v_log || pg_temp.vl('S0', 'สร้างโฮสต์ร้านอื่น (ใช้ทดสอบข้ามร้าน)', v_r);

  ----------------------------------------------------------------------------
  -- A. สิทธิ์ / RLS / overload  (เคสห้ามผ่าน #1 · #7)
  ----------------------------------------------------------------------------
  v_log := v_log || pg_temp.vb('A1', 'RLS เปิดทั้ง 3 ตาราง',
    (select count(*) from pg_class where relnamespace = 'analytics'::regnamespace
        and relname in ('live_host', 'content_signal', 'content_hook') and relrowsecurity) = 3);

  select string_agg(c.relname || ':' || case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ', ')
    into v_bad
    from pg_class c cross join lateral aclexplode(c.relacl) a
   where c.relnamespace = 'analytics'::regnamespace
     and c.relname in ('live_host', 'content_signal', 'content_hook', 'v_content_signal', 'v_live_log_recent')
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  v_log := v_log || pg_temp.vb('A2', 'ไม่มี PUBLIC/anon/authenticated ถือสิทธิ์บนตาราง/view ใหม่ทั้ง 5', v_bad is null, coalesce(v_bad, ''));

  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p cross join lateral aclexplode(p.proacl) a
   where p.pronamespace = 'analytics'::regnamespace
     and p.proname ~ '^(content_signal_|content_hook_|content_actor_|content_url_|live_host_|live_session_upsert$)'
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  v_log := v_log || pg_temp.vb('A3', 'ไม่มี PUBLIC/anon/authenticated ถือ EXECUTE บนฟังก์ชันของ 0158 ทั้ง 7', v_bad is null, coalesce(v_bad, ''));

  v_log := v_log || pg_temp.vb('A3b', 'service_role มี EXECUTE ครบทุกฟังก์ชันของ 0158',
    (select bool_and(has_function_privilege('service_role', p.oid, 'execute')) from pg_proc p
      where p.pronamespace = 'analytics'::regnamespace
        and p.proname ~ '^(content_signal_|content_hook_|content_actor_|content_url_|live_host_|live_session_upsert$)'));

  -- case 7: signature เดียว
  select string_agg(proname || '=' || n, ', ') into v_bad from (
    select proname, count(*) n from pg_proc where pronamespace = 'analytics'::regnamespace
       and proname ~ '^(content_signal_|content_hook_|content_actor_|content_url_|live_host_|live_session_upsert$)'
     group by proname having count(*) <> 1) x;
  v_log := v_log || pg_temp.vb('A4', 'ทุกฟังก์ชันของ 0158 มี signature เดียว (ไม่มี overload ค้าง)', v_bad is null, coalesce(v_bad, ''));
  select pg_get_function_identity_arguments(oid) into v_sig from pg_proc
   where pronamespace = 'analytics'::regnamespace and proname = 'live_session_upsert';
  v_log := v_log || pg_temp.vb('A4b', 'live_session_upsert = v2 (10 พารามิเตอร์ · 7 ตัวแรกเดิมเป๊ะ)',
    v_sig = 'p_shop uuid, p_live_date date, p_start time without time zone, p_end time without time zone, p_peak integer, p_note text, p_source text, p_host_id uuid, p_questions text[], p_actor_role text',
    v_sig);

  select string_agg(c.column_name, ', ') into v_bad from information_schema.columns c
   where c.table_schema = 'analytics' and c.table_name in ('content_signal', 'content_hook')
     and c.column_name ~ '(^|_)(name|phone|email|tel|address|line_id)(_|$)';
  v_log := v_log || pg_temp.vb('A5', 'content_signal/content_hook ไม่มีคอลัมน์ชื่อคน/เบอร์/อีเมล', v_bad is null, coalesce(v_bad, ''));

  -- สร้างสัญญาณ 1 แถวไว้ให้ A6/A7 (ต้องมีแถวให้ RLS กรอง)
  select o_id, o_res into v_sig_id, v_r from pg_temp.vid(format(
    'select analytics.content_signal_capture(%L::uuid, ''craft_moment'', ''ช่างขัดแหวนรุ่นใหม่'')', v_shop));
  v_log := v_log || pg_temp.vl('A5b', 'สร้างสัญญาณทดสอบ (craft_moment) ด้วย service_role', v_r);

  -- A6: จำลองวันที่กำแพงชั้นนอกหลุด (USAGE บนสคีมากลับมา) — ต้องตกที่ grant ระดับ object (42501)
  grant usage on schema analytics to anon, authenticated;
  foreach v_role in array array['anon', 'authenticated'] loop
    execute format('set local role %I', v_role);
    foreach v_stmt in array array[
      'select 1 from analytics.live_host limit 1',
      'select 1 from analytics.content_signal limit 1',
      'select 1 from analytics.content_hook limit 1',
      'select 1 from analytics.v_content_signal limit 1',
      'select 1 from analytics.v_live_log_recent limit 1',
      format('insert into analytics.content_signal (shop_id, kind, source, seen_on, summary) values (%L, ''craft_moment'', ''owner'', current_date, ''x'')', v_shop),
      format('insert into analytics.live_host (shop_id, display_name, public_label) values (%L, ''x'', ''x'')', v_shop),
      format('insert into analytics.content_hook (shop_id, text, hook_type, origin, generated_by) values (%L, ''x'', ''fact'', ''reference'', ''human'')', v_shop),
      'update analytics.content_hook set text = text',
      'delete from analytics.content_signal',
      'select analytics.content_signal_capture(null::uuid, null::text, null::text)',
      'select analytics.content_signal_set_status(null::uuid, null::uuid, null::text)',
      'select analytics.content_hook_upsert(null::uuid, null::uuid, null::text, null::text, null::text)',
      'select analytics.live_host_upsert(null::uuid, null::text, null::text)',
      'select analytics.live_session_upsert(null::uuid, null::date, null::time, null::time)',
      'select analytics.content_url_norm(''https://a.b'')',
      'select analytics.content_actor_assert(''owner'')'
    ] loop
      v_log := v_log || pg_temp.vl('A6', v_role || ' → ' || left(v_stmt, 70), pg_temp.vx(v_stmt, array['42501']));
    end loop;
    reset role;
  end loop;

  -- A7: RLS ชั้นที่สอง — ให้ SELECT ชั่วคราวแล้วต้องยังไม่เห็นแถวของร้าน (ไม่ใช่สมาชิกร้าน) หรือถูกปฏิเสธ
  grant select on analytics.live_host, analytics.content_signal, analytics.content_hook to anon, authenticated;
  foreach v_role in array array['anon', 'authenticated'] loop
    execute format('set local role %I', v_role);
    foreach v_stmt in array array[
      'select count(*) from analytics.live_host',
      'select count(*) from analytics.content_signal',
      'select count(*) from analytics.content_hook'
    ] loop
      v_log := v_log || pg_temp.vl('A7', v_role || ' (ได้ SELECT ชั่วคราว) → ' || v_stmt, pg_temp.vrows(v_stmt));
    end loop;
    reset role;
  end loop;
  -- A7b: ชั้นที่ 3 (shop_member ที่ policy อ้าง) ก็ปิดอยู่ ⇒ ผล A7 มาจากด่านนั้น ไม่ได้พิสูจน์ว่า policy กรองแถวเอง
  -- ⇒ เปิด SELECT บน shop_member ชั่วคราวด้วย แล้วต้องเห็น 0 แถว (policy กรองด้วย auth.uid() ที่เป็น null)
  grant select on public.shop_member to anon, authenticated;
  foreach v_role in array array['anon', 'authenticated'] loop
    execute format('set local role %I', v_role);
    foreach v_stmt in array array[
      'select count(*) from analytics.live_host',
      'select count(*) from analytics.content_signal',
      'select count(*) from analytics.content_hook'
    ] loop
      v_r := pg_temp.vrows(v_stmt);
      v_log := v_log || pg_temp.vl('A7b', v_role || ' (เปิดทุกชั้นชั่วคราว ให้ policy ทำงานเอง) → ' || v_stmt,
        case when v_r like 'OK 0 แถว%' then v_r else 'FAIL ' || v_r end);
    end loop;
    reset role;
  end loop;
  revoke select on public.shop_member from anon, authenticated;
  revoke select on analytics.live_host, analytics.content_signal, analytics.content_hook from anon, authenticated;
  revoke usage on schema analytics from anon, authenticated;

  ----------------------------------------------------------------------------
  -- B. เคสที่ "ต้องถูกปฏิเสธ"
  ----------------------------------------------------------------------------

  -- B-hook (case 2): hook_type นอก 8 ประเภท → CHECK · ข้อยกเว้นแคบเฉพาะแถว legacy
  v_log := v_log || pg_temp.vl('B2a', 'hook_type=reveal (นอก 8 · ไม่ใช่ legacy) → CHECK',
    pg_temp.vx(format('insert into analytics.content_hook (shop_id, text, hook_type, origin, step_id, generated_by) values (%L, ''t'', ''reveal'', ''ours'', %L, ''ai'')', v_shop, v_step), array['23514']));
  v_log := v_log || pg_temp.vl('B2b', 'hook_type=null (ไม่ใช่ legacy) → CHECK',
    pg_temp.vx(format('insert into analytics.content_hook (shop_id, text, hook_type, origin, step_id, generated_by) values (%L, ''t'', null, ''ours'', %L, ''ai'')', v_shop, v_step), array['23514']));
  v_log := v_log || pg_temp.vl('B2c', 'hook_type=reveal แม้มี legacy_json_id → CHECK (ค่านอก 8 ใส่ในคอลัมน์ hook_type ไม่ได้เลย)',
    pg_temp.vx(format('insert into analytics.content_hook (shop_id, text, hook_type, origin, step_id, generated_by, legacy_json_id) values (%L, ''t'', ''reveal'', ''ours'', %L, ''ai'', ''zz'')', v_shop, v_step), array['23514']));
  v_log := v_log || pg_temp.vl('B2d', '[ต้องไม่พัง] legacy: hook_type=null + hook_type_raw=reveal + legacy_json_id → ผ่าน (ข้อยกเว้นแคบที่ตั้งใจ)',
    pg_temp.vok(format('insert into analytics.content_hook (shop_id, text, hook_type, origin, step_id, generated_by, hook_type_raw, legacy_json_id) values (%L, ''t'', null, ''ours'', %L, ''ai'', ''reveal'', ''zz'')', v_shop, v_step)));
  v_log := v_log || pg_temp.vl('B2e', 'hook_type_raw มีค่าแต่ไม่ใช่ legacy → CHECK (ข้อยกเว้นใช้ข้ามประตูไม่ได้)',
    pg_temp.vx(format('insert into analytics.content_hook (shop_id, text, hook_type, origin, step_id, generated_by, hook_type_raw) values (%L, ''t'', ''question'', ''ours'', %L, ''ai'', ''reveal'')', v_shop, v_step2), array['23514']));
  v_log := v_log || pg_temp.vl('B2f', 'hook ของเขา (reference) มีป้าย A → CHECK',
    pg_temp.vx(format('insert into analytics.content_hook (shop_id, text, hook_type, origin, label, generated_by) values (%L, ''t'', ''fact'', ''reference'', ''A'', ''human'')', v_shop), array['23514']));
  v_log := v_log || pg_temp.vl('B2g', 'hook ของเขา (reference) ผูก step → CHECK',
    pg_temp.vx(format('insert into analytics.content_hook (shop_id, text, hook_type, origin, step_id, generated_by) values (%L, ''t'', ''fact'', ''reference'', %L, ''human'')', v_shop, v_step2), array['23514']));
  v_log := v_log || pg_temp.vl('B2h', 'RPC hook_upsert hook_type=reveal → 22023',
    pg_temp.vx(format('select analytics.content_hook_upsert(%L::uuid, %L::uuid, ''A'', ''t'', ''reveal'')', v_shop, v_step2), array['22023']));
  v_log := v_log || pg_temp.vl('B2i', 'RPC hook_upsert label=C → 22023',
    pg_temp.vx(format('select analytics.content_hook_upsert(%L::uuid, %L::uuid, ''C'', ''t'', ''fact'')', v_shop, v_step2), array['22023']));
  v_log := v_log || pg_temp.vl('B2j', 'RPC hook_upsert ข้ามร้าน (step ของร้านหนึ่ง ส่ง shop อีกร้าน) → 22023',
    pg_temp.vx(format('select analytics.content_hook_upsert(%L::uuid, %L::uuid, ''A'', ''t'', ''fact'')', v_shop2, v_step2), array['22023']));
  select o_id, o_res into v_id, v_r from pg_temp.vid(format(
    'select analytics.content_hook_upsert(%L::uuid, %L::uuid, ''A'', ''ทำไมเงินดำ'', ''question'')', v_shop, v_step2));
  v_log := v_log || pg_temp.vl('B2k', '[ต้องไม่พัง] hook_upsert A/question → ผ่าน', v_r);
  v_log := v_log || pg_temp.vl('B2l', 'hook B ประเภทเดียวกับ A (question) → 22023',
    pg_temp.vx(format('select analytics.content_hook_upsert(%L::uuid, %L::uuid, ''B'', ''x'', ''question'')', v_shop, v_step2), array['22023']));
  select o_id, o_res into v_id2, v_r from pg_temp.vid(format(
    'select analytics.content_hook_upsert(%L::uuid, %L::uuid, ''B'', ''เงินแท้ดูยังไง'', ''fact'')', v_shop, v_step2));
  v_log := v_log || pg_temp.vl('B2m', '[ต้องไม่พัง] hook B คนละประเภท → ผ่าน', v_r);
  select o_id, o_res into v_first, v_r from pg_temp.vid(format(
    'select analytics.content_hook_upsert(%L::uuid, %L::uuid, ''B'', ''เงินแท้ดูยังไง (แก้)'', ''story'')', v_shop, v_step2));
  v_log := v_log || pg_temp.vb('B2n', 'hook_upsert ป้าย B ซ้ำ = แก้แถวเดิม ไม่เพิ่มแถว',
    v_first = v_id2 and (select count(*) from analytics.content_hook where step_id = v_step2 and label = 'B') = 1);
  v_log := v_log || pg_temp.vl('B2o', 'ป้าย A ซ้ำใน step เดียว (insert ตรง) → unique 23505',
    pg_temp.vx(format('insert into analytics.content_hook (shop_id, text, hook_type, origin, step_id, label, generated_by) values (%L, ''t'', ''warning'', ''ours'', %L, ''A'', ''human'')', v_shop, v_step2), array['23505']));

  -- B-url (case 3): ลิงก์ซ้ำในร้านเดียวกัน → unique
  select o_id, o_res into v_first, v_r from pg_temp.vid(format(
    'select analytics.content_signal_capture(%L::uuid, ''reference_clip'', ''คลิปคู่แข่งโชว์ขัดเงิน'', p_url => %L, p_hook_text => ''เงินดำเพราะอะไร'')',
    v_shop, 'https://www.tiktok.com/@shopx/video/7000000000000000001?utm_source=copy&is_from_webapp=1'));
  v_log := v_log || pg_temp.vl('B3a', '[ต้องไม่พัง] แปะลิงก์อ้างอิงครั้งแรก → ผ่าน', v_r);
  foreach v_stmt in array array[
    'https://TikTok.com/@shopx/video/7000000000000000001/',
    'http://m.tiktok.com/@shopx/video/7000000000000000001#frag',
    'https://www.tiktok.com//@shopx/video/7000000000000000001?lang=th&refer=x',
    '  https://www.tiktok.com/@shopx/video/7000000000000000001  '
  ] loop
    v_r := pg_temp.vx(format(
      'select analytics.content_signal_capture(%L::uuid, ''reference_clip'', ''ซ้ำ'', p_url => %L, p_hook_text => ''h'')', v_shop, v_stmt), array['23505']);
    v_log := v_log || pg_temp.vb('B3b', 'ลิงก์ซ้ำ (' || btrim(v_stmt) || ') → 23505 พร้อม id เดิมใน detail',
      v_r like 'OK%' and position(v_first::text in v_r) > 0, v_r);
  end loop;
  v_log := v_log || pg_temp.vl('B3c', 'insert ตรงด้วย url_norm เดิม → unique index 23505 (ด่านที่ไม่พึ่ง RPC)',
    pg_temp.vx(format('insert into analytics.content_signal (shop_id, kind, source, seen_on, summary, url, url_norm, hook_text) values (%L, ''reference_clip'', ''owner'', current_date, ''d'', ''https://tiktok.com/@shopx/video/7000000000000000001'', %L, ''h'')',
      v_shop, (select url_norm from analytics.content_signal where id = v_first)), array['23505']));
  v_log := v_log || pg_temp.vl('B3d', '[ต้องไม่พัง] คนละคลิป (video id ต่าง) → ผ่าน',
    pg_temp.vok(format('select analytics.content_signal_capture(%L::uuid, ''reference_clip'', ''คนละคลิป'', p_url => ''https://www.tiktok.com/@shopx/video/7000000000000000002'', p_hook_text => ''h'')', v_shop)));
  v_log := v_log || pg_temp.vl('B3e', '[ต้องไม่พัง] YouTube watch?v=A ผ่าน',
    pg_temp.vok(format('select analytics.content_signal_capture(%L::uuid, ''reference_clip'', ''yt A'', p_url => ''https://www.youtube.com/watch?v=AAAAAAAAAAA'', p_hook_text => ''h'')', v_shop)));
  v_log := v_log || pg_temp.vl('B3f', '[ต้องไม่พัง] YouTube watch?v=B (คนละคลิป · query เป็นตัวระบุ) ผ่าน ไม่ถูกมองว่าซ้ำ',
    pg_temp.vok(format('select analytics.content_signal_capture(%L::uuid, ''reference_clip'', ''yt B'', p_url => ''https://youtube.com/watch?v=BBBBBBBBBBB'', p_hook_text => ''h'')', v_shop)));
  v_log := v_log || pg_temp.vl('B3g', 'YouTube v=A + si/t (ตัวติดตาม) → ซ้ำ 23505',
    pg_temp.vx(format('select analytics.content_signal_capture(%L::uuid, ''reference_clip'', ''yt A2'', p_url => ''https://www.youtube.com/watch?v=AAAAAAAAAAA&si=xyz&t=5'', p_hook_text => ''h'')', v_shop), array['23505']));
  v_log := v_log || pg_temp.vl('B3h', '[ต้องไม่พัง] ลิงก์เดียวกันคนละร้าน → ผ่าน (unique ต่อร้าน)',
    pg_temp.vok(format('select analytics.content_signal_capture(%L::uuid, ''reference_clip'', ''ร้านอื่น'', p_url => ''https://www.tiktok.com/@shopx/video/7000000000000000001'', p_hook_text => ''h'')', v_shop2)));
  foreach v_stmt in array array['javascript:alert(1)', 'ftp://x.y/z', 'https://nohost', 'tiktok.com/@a/video/1', 'data:text/html,x', 'https://a b.com/x'] loop
    v_log := v_log || pg_temp.vl('B3i', 'ลิงก์ไม่ถูกรูป (' || v_stmt || ') → 22023',
      pg_temp.vx(format('select analytics.content_signal_capture(%L::uuid, ''reference_clip'', ''bad'', p_url => %L, p_hook_text => ''h'')', v_shop, v_stmt), array['22023']));
  end loop;
  v_log := v_log || pg_temp.vl('B3j', 'url มีแต่ url_norm ว่าง (insert ตรง) → CHECK 23514',
    pg_temp.vx(format('insert into analytics.content_signal (shop_id, kind, source, seen_on, summary, url, hook_text) values (%L, ''reference_clip'', ''owner'', current_date, ''d'', ''https://a.b/c'', ''h'')', v_shop), array['23514']));
  v_log := v_log || pg_temp.vb('B3k', 'content_url_norm: variant ทั้งหมดของคลิปเดียวกัน → ค่าเดียวกัน',
    analytics.content_url_norm('https://www.tiktok.com/@a/video/1?x=1#y') = analytics.content_url_norm('HTTP://TikTok.com/@a/video/1/')
    and analytics.content_url_norm('https://youtu.be/abc?si=1') = 'youtu.be/abc',
    coalesce(analytics.content_url_norm('https://www.tiktok.com/@a/video/1?x=1#y'), 'null'));
  v_log := v_log || pg_temp.vl('B3l', 'ลิงก์คลิปเดียวกันแบบสั้น vs เต็ม (vt.tiktok.com) — DB รวมให้ไม่ได้ (แอป canonicalize ก่อน · R16) — แยกกันเป็น 2 แถวได้',
    case when analytics.content_url_norm('https://vt.tiktok.com/ZSabc/') is distinct from analytics.content_url_norm('https://www.tiktok.com/@a/video/1')
         then 'OK ยืนยันข้อจำกัด: norm ต่างกัน' else 'FAIL norm เท่ากัน?' end);

  -- B-actor (case 4)
  foreach v_stmt in array array['assistant', 'host', 'OWNER', '', 'null'] loop
    v_log := v_log || pg_temp.vl('B4a', 'capture actor=' || v_stmt || ' → 22023',
      pg_temp.vx(format('select analytics.content_signal_capture(%L::uuid, ''craft_moment'', ''x'', p_actor_role => %L)', v_shop, nullif(v_stmt, 'null')), array['22023']));
    v_log := v_log || pg_temp.vl('B4b', 'set_status actor=' || v_stmt || ' → 22023',
      pg_temp.vx(format('select analytics.content_signal_set_status(%L::uuid, %L::uuid, ''rejected'', p_actor_role => %L)', v_shop, v_sig_id, nullif(v_stmt, 'null')), array['22023']));
    v_log := v_log || pg_temp.vl('B4c', 'hook_upsert actor=' || v_stmt || ' → 22023',
      pg_temp.vx(format('select analytics.content_hook_upsert(%L::uuid, %L::uuid, null, ''x'', ''fact'', p_actor_role => %L)', v_shop, v_step2, nullif(v_stmt, 'null')), array['22023']));
    v_log := v_log || pg_temp.vl('B4d', 'live_host_upsert actor=' || v_stmt || ' → 22023',
      pg_temp.vx(format('select analytics.live_host_upsert(%L::uuid, ''n'', ''l'', p_actor_role => %L)', v_shop, nullif(v_stmt, 'null')), array['22023']));
    v_log := v_log || pg_temp.vl('B4e', 'live_session_upsert actor=' || v_stmt || ' → 22023',
      pg_temp.vx(format('select analytics.live_session_upsert(%L::uuid, date ''2020-02-01'', time ''20:00'', time ''23:00'', p_actor_role => %L)', v_shop, nullif(v_stmt, 'null')), array['22023']));
  end loop;
  v_log := v_log || pg_temp.vl('B4f', 'insert ตรง created_by_role=assistant → CHECK 23514',
    pg_temp.vx(format('insert into analytics.content_signal (shop_id, kind, source, seen_on, summary, created_by_role) values (%L, ''craft_moment'', ''owner'', current_date, ''x'', ''assistant'')', v_shop), array['23514']));
  v_log := v_log || pg_temp.vl('B4g', 'insert ตรง source=assistant → CHECK 23514',
    pg_temp.vx(format('insert into analytics.content_signal (shop_id, kind, source, seen_on, summary) values (%L, ''craft_moment'', ''assistant'', current_date, ''x'')', v_shop), array['23514']));
  v_log := v_log || pg_temp.vl('B4h', 'AI เรียก set_status (ตัดสินแทนเจ้าของ) → 42501',
    pg_temp.vx(format('select analytics.content_signal_set_status(%L::uuid, %L::uuid, ''rejected'', p_actor_role => ''ai'')', v_shop, v_sig_id), array['42501']));
  v_log := v_log || pg_temp.vl('B4i', 'AI สร้างโฮสต์ → 42501',
    pg_temp.vx(format('select analytics.live_host_upsert(%L::uuid, ''ai host'', ''โฮสต์ AI'', p_actor_role => ''ai'')', v_shop), array['42501']));
  v_log := v_log || pg_temp.vl('B4j', 'AI บันทึกสัญญาณโดยอ้าง source=owner → 22023',
    pg_temp.vx(format('select analytics.content_signal_capture(%L::uuid, ''craft_moment'', ''x'', p_source => ''owner'', p_actor_role => ''ai'')', v_shop), array['22023']));
  v_log := v_log || pg_temp.vl('B4k', '[ต้องไม่พัง] AI บันทึกเทรนด์ source=ai_radar → ผ่าน',
    pg_temp.vok(format('select analytics.content_signal_capture(%L::uuid, ''trend'', ''เทรนด์ขัดเงิน'', p_source => ''ai_radar'', p_radar_date => %L::date, p_radar_angle_idx => 1, p_confidence => ''hypothesis'', p_actor_role => ''ai'')', v_shop, v_today)));
  v_log := v_log || pg_temp.vl('B4l', '[ต้องไม่พัง] AI เขียน hook ผ่าน hook_upsert → ผ่าน generated_by=ai',
    pg_temp.vok(format('select analytics.content_hook_upsert(%L::uuid, %L::uuid, null, ''ai เสนอ'', ''warning'', p_actor_role => ''ai'')', v_shop, v_step2)));
  v_log := v_log || pg_temp.vb('B4m', 'hook ที่ AI เขียน generated_by=ai',
    (select generated_by from analytics.content_hook where step_id = v_step2 and text = 'ai เสนอ') = 'ai');
  v_log := v_log || pg_temp.vl('B4n', '[ต้องไม่พัง] system เรียก set_status ได้',
    pg_temp.vok(format('select analytics.content_signal_set_status(%L::uuid, %L::uuid, ''rejected'', p_actor_role => ''system'')', v_shop, v_sig_id)));

  -- B-host (case 5)
  select o_id, o_res into v_id2, v_r from pg_temp.vid(format(
    'select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date ''2020-01-10'', p_start => time ''20:00'', p_end => time ''23:00'')', v_shop));
  v_log := v_log || pg_temp.vl('B5a', 'สร้างแถว log ทดสอบ 2020-01-10 (ไม่มีโฮสต์)', v_r);
  v_log := v_log || pg_temp.vl('B5b', 'RPC: p_host_id = โฮสต์ของร้านอื่น → 22023',
    pg_temp.vx(format('select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date ''2020-01-10'', p_start => time ''20:00'', p_end => time ''23:00'', p_host_id => %L::uuid)', v_shop, v_host_x), array['22023']));
  v_log := v_log || pg_temp.vl('B5c', 'RPC: p_host_id ไม่มีอยู่จริง → 22023',
    pg_temp.vx(format('select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date ''2020-01-10'', p_start => time ''20:00'', p_end => time ''23:00'', p_host_id => %L::uuid)', v_shop, gen_random_uuid()), array['22023']));
  v_log := v_log || pg_temp.vl('B5d', 'update ตรง host_id = โฮสต์ร้านอื่น → composite FK 23503',
    pg_temp.vx(format('update analytics.live_session_log set host_id = %L where id = %L', v_host_x, v_id2), array['23503']));
  v_log := v_log || pg_temp.vl('B5e', 'update ตรง host_id ไม่มีอยู่จริง → FK 23503',
    pg_temp.vx(format('update analytics.live_session_log set host_id = %L where id = %L', gen_random_uuid(), v_id2), array['23503']));
  v_log := v_log || pg_temp.vl('B5f', 'insert ตรง log ร้านอื่น (v_shop2) ชี้โฮสต์ร้านแรก → composite FK 23503',
    pg_temp.vx(format('insert into analytics.live_session_log (shop_id, live_date, started_at, ended_at, host_id) values (%L, date ''2020-01-11'', now() - interval ''3 hours'', now(), %L)', v_shop2, v_host_a), array['23503']));
  v_log := v_log || pg_temp.vl('B5g', '[ต้องไม่พัง] โฮสต์ของร้านเดียวกัน → ผ่าน',
    pg_temp.vok(format('select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date ''2020-01-10'', p_start => time ''20:00'', p_end => time ''23:00'', p_host_id => %L::uuid)', v_shop, v_host_a)));
  v_log := v_log || pg_temp.vb('B5h', 'host_id ถูกเก็บ', (select host_id from analytics.live_session_log where id = v_id2) = v_host_a);
  v_log := v_log || pg_temp.vl('B5i', '[ต้องไม่พัง] live_host_upsert ปิดโฮสต์ B', pg_temp.vok(format(
    'select analytics.live_host_upsert(%L::uuid, ''ฮันนี้ ปิ๊กๆ'', ''โฮสต์ B'', false, %L::uuid)', v_shop, v_host_b)));
  v_log := v_log || pg_temp.vl('B5j', 'มอบหมายโฮสต์ที่ปิดแล้วให้แถวใหม่ → 22023',
    pg_temp.vx(format('select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date ''2020-01-12'', p_start => time ''20:00'', p_end => time ''23:00'', p_host_id => %L::uuid)', v_shop, v_host_b), array['22023']));
  v_log := v_log || pg_temp.vl('B5k', 'live_host_upsert ซ้ำชื่อ (ต่างตัวพิมพ์/ช่องว่าง) → 23505',
    pg_temp.vx(format('select analytics.live_host_upsert(%L::uuid, ''  หมีเนย '', ''ป้ายใหม่'')', v_shop), array['23505']));
  v_log := v_log || pg_temp.vl('B5l', 'live_host_upsert ซ้ำป้าย → 23505',
    pg_temp.vx(format('select analytics.live_host_upsert(%L::uuid, ''คนใหม่'', ''โฮสต์ a'')', v_shop), array['23505']));
  v_log := v_log || pg_temp.vl('B5m', 'live_host_upsert แก้โฮสต์ของร้านอื่นด้วย id → 22023',
    pg_temp.vx(format('select analytics.live_host_upsert(%L::uuid, ''hack'', ''hack'', true, %L::uuid)', v_shop, v_host_x), array['22023']));
  v_log := v_log || pg_temp.vl('B5n', '[ต้องไม่พัง] เปิดโฮสต์ B กลับ', pg_temp.vok(format(
    'select analytics.live_host_upsert(%L::uuid, ''ฮันนี้ ปิ๊กๆ'', ''โฮสต์ B'', true, %L::uuid)', v_shop, v_host_b)));

  -- B-num (case 6): ติดลบ / เกินเพดาน / NaN
  foreach v_col in array array['account_followers', 'views', 'likes', 'comments', 'saves', 'shares'] loop
    foreach v_stmt in array array['-1', '10000000001'] loop
      v_log := v_log || pg_temp.vl('B6a', 'insert ตรง ' || v_col || '=' || v_stmt || ' → CHECK 23514',
        pg_temp.vx(format('insert into analytics.content_signal (shop_id, kind, source, seen_on, summary, %I) values (%L, ''craft_moment'', ''owner'', current_date, ''n'', %s)', v_col, v_shop, v_stmt), array['23514']));
      v_log := v_log || pg_temp.vl('B6b', 'RPC p_' || v_col || '=' || v_stmt || ' → 22023',
        pg_temp.vx(format('select analytics.content_signal_capture(%L::uuid, ''craft_moment'', ''n'', p_%s => %s)', v_shop, v_col, v_stmt), array['22023']));
    end loop;
    foreach v_stmt in array array['0', '10000000000'] loop
      v_log := v_log || pg_temp.vl('B6c', '[ต้องไม่พัง] ขอบเขต ' || v_col || '=' || v_stmt || ' → ผ่าน',
        pg_temp.vok(format('select analytics.content_signal_capture(%L::uuid, ''craft_moment'', ''edge'', p_%s => %s)', v_shop, v_col, v_stmt)));
    end loop;
  end loop;
  v_log := v_log || pg_temp.vl('B6d', '''NaN''::numeric → bigint พังที่ cast (ไม่ถึงคอลัมน์)',
    pg_temp.vx('select ''NaN''::numeric::bigint', array['22003', '22P02', '0A000']));
  v_log := v_log || pg_temp.vl('B6e', 'RPC p_views => ''NaN'' (text) → ตกที่ cast 22P02',
    pg_temp.vx(format('select analytics.content_signal_capture(%L::uuid, ''craft_moment'', ''n'', p_views => ''NaN'')', v_shop), array['22P02', '22003']));
  v_log := v_log || pg_temp.vl('B6f', 'RPC p_views => ''Infinity'' → ตกที่ cast',
    pg_temp.vx(format('select analytics.content_signal_capture(%L::uuid, ''craft_moment'', ''n'', p_views => ''Infinity'')', v_shop), array['22P02', '22003']));
  v_log := v_log || pg_temp.vl('B6g', 'duration_sec=0 → 22023',
    pg_temp.vx(format('select analytics.content_signal_capture(%L::uuid, ''craft_moment'', ''n'', p_duration_sec => 0)', v_shop), array['22023']));
  v_log := v_log || pg_temp.vl('B6h', 'seen_on อนาคต → 22023',
    pg_temp.vx(format('select analytics.content_signal_capture(%L::uuid, ''craft_moment'', ''n'', p_seen_on => %L::date)', v_shop, v_today + 1), array['22023']));
  v_log := v_log || pg_temp.vl('B6i', 'posted_on หลังวันที่เห็น → 22023',
    pg_temp.vx(format('select analytics.content_signal_capture(%L::uuid, ''craft_moment'', ''n'', p_seen_on => %L::date, p_posted_on => %L::date)', v_shop, v_today - 1, v_today), array['22023']));
  v_log := v_log || pg_temp.vl('B6j', 'summary ว่าง/ยาวเกิน 300 → 22023',
    pg_temp.vx(format('select analytics.content_signal_capture(%L::uuid, ''craft_moment'', %L)', v_shop, repeat('ก', 301)), array['22023']));

  -- B-kind: ข้อกำหนดต่อ kind
  foreach v_stmt in array array[
    'reference_clip|p_url => ''https://a.b/c1''',
    'reference_clip|p_hook_text => ''h''',
    'live_question|p_actor_role => ''owner''',
    'insight|p_actor_role => ''owner''',
    'trend|p_actor_role => ''owner'''
  ] loop
    v_log := v_log || pg_temp.vl('B7a', 'RPC kind ขาดข้อกำหนด (' || v_stmt || ') → 22023',
      pg_temp.vx(format('select analytics.content_signal_capture(%L::uuid, %L, ''s'', %s)', v_shop, split_part(v_stmt, '|', 1), split_part(v_stmt, '|', 2)), array['22023']));
  end loop;
  v_log := v_log || pg_temp.vl('B7b', 'insert ตรง reference_clip ไม่มี hook_text → CHECK 23514',
    pg_temp.vx(format('insert into analytics.content_signal (shop_id, kind, source, seen_on, summary, url, url_norm) values (%L, ''reference_clip'', ''owner'', current_date, ''x'', ''https://a.b/zz'', ''a.b/zz'')', v_shop), array['23514']));
  v_log := v_log || pg_temp.vl('B7c', 'insert ตรง live_question ไม่มี origin_live_date → CHECK 23514',
    pg_temp.vx(format('insert into analytics.content_signal (shop_id, kind, source, seen_on, summary) values (%L, ''live_question'', ''owner'', current_date, ''x'')', v_shop), array['23514']));
  v_log := v_log || pg_temp.vl('B7d', 'insert ตรง insight ไม่มี origin → CHECK 23514',
    pg_temp.vx(format('insert into analytics.content_signal (shop_id, kind, source, seen_on, summary) values (%L, ''insight'', ''owner'', current_date, ''x'')', v_shop), array['23514']));
  v_log := v_log || pg_temp.vl('B7e', 'insert ตรง trend ไม่มี radar_date → CHECK 23514',
    pg_temp.vx(format('insert into analytics.content_signal (shop_id, kind, source, seen_on, summary) values (%L, ''trend'', ''ai_radar'', current_date, ''x'')', v_shop), array['23514']));
  v_log := v_log || pg_temp.vl('B7f', 'insert ตรง status=deferred ไม่มี review_on → CHECK 23514',
    pg_temp.vx(format('insert into analytics.content_signal (shop_id, kind, source, seen_on, summary, status) values (%L, ''craft_moment'', ''owner'', current_date, ''x'', ''deferred'')', v_shop), array['23514']));
  v_log := v_log || pg_temp.vl('B7g', 'insert ตรง format=tutorial (นอก 9 ค่า) → CHECK 23514',
    pg_temp.vx(format('insert into analytics.content_signal (shop_id, kind, source, seen_on, summary, format) values (%L, ''craft_moment'', ''owner'', current_date, ''x'', ''tutorial'')', v_shop), array['23514']));
  v_log := v_log || pg_temp.vl('B7h', 'RPC origin_post_id ไม่มีอยู่/ข้ามร้าน → 22023',
    pg_temp.vx(format('select analytics.content_signal_capture(%L::uuid, ''insight'', ''x'', p_origin_post_id => %L::uuid)', v_shop, gen_random_uuid()), array['22023']));

  -- B-status: set_status
  select o_id, o_res into v_id, v_r from pg_temp.vid(format(
    'select analytics.content_signal_capture(%L::uuid, ''craft_moment'', ''สถานะทดสอบ'')', v_shop));
  v_log := v_log || pg_temp.vl('B8a', 'สร้างสัญญาณสำหรับทดสอบสถานะ', v_r);
  v_log := v_log || pg_temp.vl('B8b', 'set_status deferred ไม่ใส่ review_on → 22023',
    pg_temp.vx(format('select analytics.content_signal_set_status(%L::uuid, %L::uuid, ''deferred'')', v_shop, v_id), array['22023']));
  v_log := v_log || pg_temp.vl('B8c', 'set_status deferred review_on ย้อนหลัง → 22023',
    pg_temp.vx(format('select analytics.content_signal_set_status(%L::uuid, %L::uuid, ''deferred'', p_review_on => %L::date)', v_shop, v_id, v_today - 1), array['22023']));
  v_log := v_log || pg_temp.vl('B8d', 'set_status picked ตั้งตรงไม่ได้ → 22023',
    pg_temp.vx(format('select analytics.content_signal_set_status(%L::uuid, %L::uuid, ''picked'')', v_shop, v_id), array['22023']));
  v_log := v_log || pg_temp.vl('B8e', 'set_status ข้ามร้าน → 22023',
    pg_temp.vx(format('select analytics.content_signal_set_status(%L::uuid, %L::uuid, ''rejected'')', v_shop2, v_id), array['22023']));
  v_log := v_log || pg_temp.vl('B8f', 'set_status review_on กับสถานะที่ไม่ใช่ deferred → 22023',
    pg_temp.vx(format('select analytics.content_signal_set_status(%L::uuid, %L::uuid, ''rejected'', p_review_on => %L::date)', v_shop, v_id, v_today), array['22023']));
  v_log := v_log || pg_temp.vl('B8g', '[ต้องไม่พัง] new → deferred(วันนี้) → rejected(เหตุผล) → new', pg_temp.vok(format(
    'select analytics.content_signal_set_status(%1$L::uuid, %2$L::uuid, ''deferred'', ''รอดูก่อน'', %3$L::date);
     select analytics.content_signal_set_status(%1$L::uuid, %2$L::uuid, ''rejected'', ''ไม่เข้าแบรนด์'');
     select analytics.content_signal_set_status(%1$L::uuid, %2$L::uuid, ''new'')', v_shop, v_id, v_today)));
  v_log := v_log || pg_temp.vb('B8h', 'กลับเป็น new ล้างเหตุผล/review_on',
    (select status_reason is null and review_on is null and status = 'new' from analytics.content_signal where id = v_id));
  update analytics.content_signal set status = 'picked', picked_step_id = v_step where id = v_id;
  v_log := v_log || pg_temp.vl('B8i', 'ปฏิเสธสัญญาณที่ picked แล้วโดยไม่ force → 22023 + detail = step ที่กระทบ',
    case when pg_temp.vx(format('select analytics.content_signal_set_status(%L::uuid, %L::uuid, ''rejected'')', v_shop, v_id), array['22023']) like '%detail=' || v_step::text || '%'
         then 'OK' else 'FAIL detail ไม่มี step id' end);
  v_log := v_log || pg_temp.vl('B8j', 'picked → new ไม่ได้แม้ force → 22023',
    pg_temp.vx(format('select analytics.content_signal_set_status(%L::uuid, %L::uuid, ''new'', p_force => true)', v_shop, v_id), array['22023']));
  v_log := v_log || pg_temp.vl('B8k', '[ต้องไม่พัง] picked → rejected ด้วย force → ผ่าน',
    pg_temp.vok(format('select analytics.content_signal_set_status(%L::uuid, %L::uuid, ''rejected'', ''เลิกใช้'', p_force => true)', v_shop, v_id)));

  ----------------------------------------------------------------------------
  -- C. เคสที่ "ต้องไม่พัง"
  ----------------------------------------------------------------------------

  -- C-live (ไม่พัง #1): ทางเรียกเดิมของแอป (named 7 พารามิเตอร์)
  select o_id, o_res into v_id, v_r from pg_temp.vid(
    'select analytics.live_session_upsert(p_shop => ' || quote_literal(v_shop) || '::uuid, p_live_date => date ''2020-01-02'', p_start => time ''20:00'', p_end => time ''23:15'', p_peak => 120, p_note => ''ทดสอบ'', p_source => ''admin_ui'')');
  v_log := v_log || pg_temp.vl('C1a', 'ทางเรียกเดิมของแอป (named: p_shop/p_live_date/p_start/p_end/p_peak/p_note/p_source) → ผ่าน', v_r);
  v_log := v_log || pg_temp.vb('C1b', 'แถวถูกสร้างครบ host_id=null source=admin_ui peak=120',
    (select host_id is null and source = 'admin_ui' and peak_viewers = 120 and note = 'ทดสอบ' from analytics.live_session_log where id = v_id));
  select o_id, o_res into v_id2, v_r from pg_temp.vid(
    'select analytics.live_session_upsert(p_shop => ' || quote_literal(v_shop) || '::uuid, p_live_date => date ''2020-01-02'', p_start => time ''20:00'', p_end => time ''23:15'', p_peak => 300, p_note => null, p_source => ''admin_ui'')');
  v_log := v_log || pg_temp.vb('C1c', 'เรียกซ้ำวันเดิม = แก้แถวเดิม (id เดิม · peak=300 · note ถูกทับเป็น null ตามพฤติกรรมเดิม)',
    v_id2 = v_id and (select peak_viewers = 300 and note is null from analytics.live_session_log where id = v_id)
    and (select count(*) from analytics.live_session_log where live_date = date '2020-01-02' and shop_id = v_shop) = 1);
  v_log := v_log || pg_temp.vl('C1d', 'เรียกแบบ positional 7 ตัว → ผ่าน', pg_temp.vok(format(
    'select analytics.live_session_upsert(%L::uuid, date ''2020-01-03'', time ''20:00'', time ''22:00'', 10, null, ''owner_chat'')', v_shop)));
  v_log := v_log || pg_temp.vl('C1e', 'เรียกแบบ 4 พารามิเตอร์ขั้นต่ำ → ผ่าน', pg_temp.vok(format(
    'select analytics.live_session_upsert(%L::uuid, date ''2020-01-04'', time ''20:00'', time ''22:00'')', v_shop)));
  select o_id, o_res into v_id2, v_r from pg_temp.vid(format(
    'select analytics.live_session_upsert(%L::uuid, date ''2020-01-05'', time ''22:00'', time ''01:00'')', v_shop));
  v_log := v_log || pg_temp.vb('C1f', 'ไลฟ์ข้ามเที่ยงคืน 22:00-01:00 = 3 ชม. (พฤติกรรมเดิม)',
    (select ended_at - started_at = interval '3 hours' from analytics.live_session_log where id = v_id2));
  foreach v_stmt in array array[
    'select analytics.live_session_upsert(%L::uuid, date ''2020-01-06'', time ''20:00'', time ''20:00'')',
    'select analytics.live_session_upsert(%L::uuid, date ''2020-01-06'', time ''08:00'', time ''21:00'')',
    'select analytics.live_session_upsert(%L::uuid, date ''2020-01-06'', time ''20:00'', time ''21:00'', -1)'
  ] loop
    v_log := v_log || pg_temp.vl('C1g', 'ด่านเดิมยังทำงาน: ' || substring(v_stmt from 'date ''2020-01-06'', (.*)[)]$') || ' → P0001 ข้อความไทยเดิม',
      pg_temp.vx(format(v_stmt, v_shop), array['P0001']));
  end loop;

  -- C-live-existing (#17: ยิงฟังก์ชันใหม่ใส่ข้อมูลจริงทุกแถวที่มี)
  v_n := 0; v_n2 := 0;
  for r in select * from analytics.live_session_log where id = any (v_live_ids) order by live_date loop
    v_md_before := md5(concat_ws('|', r.live_date, r.started_at, r.ended_at, r.peak_viewers, r.note, r.source, r.created_by, r.created_at));
    select o_id, o_res into v_id, v_r from pg_temp.vid(format(
      'select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => %L::date, p_start => %L::time, p_end => %L::time, p_peak => %L::int, p_note => %L::text, p_source => %L::text)',
      r.shop_id, r.live_date, to_char(r.started_at at time zone 'Asia/Bangkok', 'HH24:MI:SS'),
      to_char(r.ended_at at time zone 'Asia/Bangkok', 'HH24:MI:SS'), r.peak_viewers, r.note, r.source));
    select md5(concat_ws('|', live_date, started_at, ended_at, peak_viewers, note, source, created_by, created_at))
      into v_md_after from analytics.live_session_log where id = r.id;
    v_log := v_log || pg_temp.vb('C2a', 'เรียกเดิมใส่คืนจริง ' || r.live_date || ' ด้วยค่าเดิม → id เดิม ข้อมูลเดิมเป๊ะ',
      v_r = 'OK' and v_id = r.id and v_md_before = v_md_after, v_r);
    -- โฮสต์: ตั้งไว้ก่อน → เรียกแบบเดิม (ไม่ส่ง host) ต้องไม่ล้าง
    update analytics.live_session_log set host_id = v_host_a where id = r.id;
    perform pg_temp.vid(format(
      'select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => %L::date, p_start => %L::time, p_end => %L::time, p_peak => %L::int, p_note => %L::text, p_source => %L::text)',
      r.shop_id, r.live_date, to_char(r.started_at at time zone 'Asia/Bangkok', 'HH24:MI:SS'),
      to_char(r.ended_at at time zone 'Asia/Bangkok', 'HH24:MI:SS'), r.peak_viewers, r.note, r.source));
    v_log := v_log || pg_temp.vb('C2b', 'คืน ' || r.live_date || ': เรียกแบบเดิมหลังตั้งโฮสต์ → host_id ไม่ถูกล้าง (D-c)',
      (select host_id from analytics.live_session_log where id = r.id) = v_host_a);
    perform pg_temp.vid(format(
      'select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => %L::date, p_start => %L::time, p_end => %L::time, p_peak => %L::int, p_note => %L::text, p_source => %L::text, p_host_id => %L::uuid)',
      r.shop_id, r.live_date, to_char(r.started_at at time zone 'Asia/Bangkok', 'HH24:MI:SS'),
      to_char(r.ended_at at time zone 'Asia/Bangkok', 'HH24:MI:SS'), r.peak_viewers, r.note, r.source, v_host_b));
    v_log := v_log || pg_temp.vb('C2c', 'คืน ' || r.live_date || ': ส่ง p_host_id ใหม่ → เปลี่ยนโฮสต์',
      (select host_id from analytics.live_session_log where id = r.id) = v_host_b);
    v_n := v_n + 1;
  end loop;
  v_log := v_log || pg_temp.vb('C2d', 'ยิงกับแถว log เดิมครบทุกแถวที่มีจริง', v_n = v_live_cnt, v_n || '/' || v_live_cnt);

  -- C-questions
  v_log := v_log || pg_temp.vl('C3a', 'p_questions (มีซ้ำหลัง normalize + ว่าง + ช่องว่างเกิน) → ผ่าน', pg_temp.vok(format(
    'select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date ''2020-01-02'', p_start => time ''20:00'', p_end => time ''23:15'', p_questions => array[''ราคาเท่าไหร่'', ''  ราคาเท่าไหร่ '', '''', ''มี   ไซส์ 7 ไหม'', null])', v_shop)));
  v_log := v_log || pg_temp.vb('C3b', 'ได้ live_question 2 แถว (ตัดซ้ำ/ว่าง/ช่องว่าง) source=owner origin_live_date ตรง',
    (select count(*) = 2 and bool_and(source = 'owner' and origin_live_date = date '2020-01-02' and kind = 'live_question')
       and bool_and(summary in ('ราคาเท่าไหร่', 'มี ไซส์ 7 ไหม'))
       from analytics.content_signal where shop_id = v_shop and origin_live_date = date '2020-01-02'));
  perform analytics.live_session_upsert(p_shop => v_shop, p_live_date => date '2020-01-02', p_start => time '20:00', p_end => time '23:15',
    p_questions => array['ราคาเท่าไหร่', 'ส่งฟรีไหม']);
  v_log := v_log || pg_temp.vb('C3c', 're-submit คืนเดิม ไม่เพิ่มคำถามซ้ำ (เพิ่มเฉพาะข้อใหม่ → รวม 3)',
    (select count(*) from analytics.content_signal where shop_id = v_shop and origin_live_date = date '2020-01-02' and kind = 'live_question') = 3);
  v_log := v_log || pg_temp.vl('C3d', 'คำถามเดียวยาวเกิน 300 → 22023 และไม่เกิดแถว log ใหม่', pg_temp.vx(format(
    'select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date ''2020-02-05'', p_start => time ''20:00'', p_end => time ''21:00'', p_questions => array[%L])', v_shop, repeat('ก', 301)), array['22023']));
  v_log := v_log || pg_temp.vb('C3e', 'ไม่มีแถว log 2020-02-05 ค้างหลัง error',
    (select count(*) from analytics.live_session_log where live_date = date '2020-02-05') = 0);
  v_log := v_log || pg_temp.vl('C3f', 'คำถามเกิน 20 ข้อ → 22023', pg_temp.vx(format(
    'select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date ''2020-02-05'', p_start => time ''20:00'', p_end => time ''21:00'', p_questions => (select array_agg(''q'' || g) from generate_series(1, 21) g))', v_shop), array['22023']));
  v_log := v_log || pg_temp.vl('C3g', 'capture live_question ซ้ำคืน/ข้อความเดิม → 23505', pg_temp.vx(format(
    'select analytics.content_signal_capture(%L::uuid, ''live_question'', ''ส่งฟรีไหม'', p_origin_live_date => date ''2020-01-02'')', v_shop), array['23505']));

  -- C-hooks ย้ายครบ (ไม่พัง #2)
  v_log := v_log || pg_temp.vb('C4a', 'hook legacy ย้ายครบ = จำนวนใน clip_brief.hooks[] (คาด 26 · นับก่อนเขียนแถวทดสอบ)', v_legacy0 = v_hook_exp, v_legacy0 || '/' || v_hook_exp);
  select count(*) into v_n
    from analytics.step_artifact a
    cross join lateral jsonb_array_elements(case when jsonb_typeof(a.clip_brief -> 'hooks') = 'array' then a.clip_brief -> 'hooks' else '[]'::jsonb end)
      with ordinality as h(e, ord)
    join analytics.content_hook ch on ch.step_id = a.step_id and ch.legacy_json_id = (h.e ->> 'id')
   where ch.shop_id = a.shop_id and ch.text = btrim(h.e ->> 'line')
     and ch.hook_type_raw is not distinct from (h.e ->> 'hook_type')
     and ch.label is not distinct from (case when jsonb_array_length(a.clip_brief -> 'hooks') = 2 then (case h.ord when 1 then 'A' else 'B' end) end)
     and ch.origin = 'ours' and ch.generated_by = (case when a.generated_by like 'ai%' then 'ai' else 'human' end);
  v_log := v_log || pg_temp.vb('C4b', 'ทุก hook เดิมตรงกับแถวใหม่ (ข้อความ · hook_type_raw · ป้าย A/B ตามตำแหน่ง · generated_by · id เดิม)',
    v_n = v_hook_exp, v_n || '/' || v_hook_exp);
  select count(*) into v_n from analytics.content_hook
   where legacy_json_id is not null and hook_type is not null
     and hook_type is distinct from hook_type_raw;
  select count(*) into v_n2 from analytics.content_hook
   where legacy_json_id is not null and hook_type is null
     and hook_type_raw in ('question', 'fact', 'warning', 'process', 'before_after', 'customer_voice', 'direct_live', 'story');
  v_log := v_log || pg_temp.vb('C4c', 'hook_type ใช้ค่าเดิมเฉพาะที่อยู่ใน 8 ค่า · นอกนั้น null + เก็บ raw (ไม่เดา)', v_n = 0 and v_n2 = 0);
  select count(*) into v_n from analytics.content_hook where legacy_json_id is not null and hook_type_raw is null;
  v_log := v_log || pg_temp.vb('C4d', 'ทุกแถว legacy มี hook_type_raw (ไม่มีข้อมูลหาย)', v_n = 0, v_n::text);
  select count(*) filter (where jsonb_typeof(clip_brief -> 'hooks') = 'array' and jsonb_array_length(clip_brief -> 'hooks') > 0),
         coalesce(sum(case when jsonb_typeof(clip_brief -> 'hooks') = 'array' then jsonb_array_length(clip_brief -> 'hooks') end), 0)
    into v_n, v_n2 from analytics.step_artifact;
  v_log := v_log || pg_temp.vb('C4e', 'clip_brief jsonb เดิมยังมี hooks[] ครบ (UI เดิมอ่านได้ · migration ไม่ได้ลบ/แก้)', v_n2 = v_hook_exp, v_n || ' artifact / ' || v_n2 || ' hooks');
  select md5(string_agg(id::text || clip_brief::text, '|' order by id)) into v_md_after from analytics.step_artifact;
  v_log := v_log || pg_temp.vb('C4f', 'md5 step_artifact(id+clip_brief) ปัจจุบัน — เทียบมือกับก่อน apply (ด่านจริงอยู่ในไฟล์ migration)', true, v_md_after);

  -- hook_upsert บน step ทุกโหมดที่มีจริง (#17)
  select count(*) into v_n from analytics.campaign_step where shop_id = v_shop;
  v_n2 := 0;
  for r in select id from analytics.campaign_step where shop_id = v_shop order by id loop
    if pg_temp.vok(format('select analytics.content_hook_upsert(%L::uuid, %L::uuid, null, ''ทดสอบทุกโหมด'', ''fact'')', v_shop, r.id)) = 'OK' then
      v_n2 := v_n2 + 1;
    end if;
  end loop;
  v_log := v_log || pg_temp.vb('C5a', 'hook_upsert (ไม่มีป้าย) ผ่านกับ campaign_step จริงทุกแถวทุกโหมด (มี/ไม่มี/หลาย artifact · template · task)', v_n2 = v_n, v_n2 || '/' || v_n);
  if v_step_leg is not null then
    select hook_type into v_b_type from analytics.content_hook where step_id = v_step_leg and label = 'B';
    v_log := v_log || pg_temp.vl('C5b', 'step legacy: แก้ hook ป้าย A (ประเภท warning) ผ่าน', pg_temp.vok(format(
      'select analytics.content_hook_upsert(%L::uuid, %L::uuid, ''A'', ''แก้ข้อความ'', ''warning'')', v_shop, v_step_leg)));
    v_log := v_log || pg_temp.vb('C5c', 'แก้แล้ว legacy_json_id และ hook_type_raw เดิมยังอยู่',
      (select legacy_json_id is not null and hook_type_raw is not null and hook_type = 'warning' and text = 'แก้ข้อความ'
         from analytics.content_hook where step_id = v_step_leg and label = 'A'));
    v_log := v_log || pg_temp.vl('C5d', 'step legacy: ตั้ง B ประเภทเดียวกับ A (warning) → 22023', pg_temp.vx(format(
      'select analytics.content_hook_upsert(%L::uuid, %L::uuid, ''B'', ''x'', ''warning'')', v_shop, v_step_leg), array['22023']));
  end if;

  -- capture ผูกโพสต์/แคมเปญจริงทุกแถว
  select count(*) into v_n from analytics.content_post where shop_id = v_shop;
  v_n2 := 0;
  for r in select id from analytics.content_post where shop_id = v_shop loop
    if pg_temp.vok(format('select analytics.content_signal_capture(%L::uuid, ''insight'', ''บทเรียนทดสอบ'', p_origin_post_id => %L::uuid, p_confidence => ''observation'')', v_shop, r.id)) = 'OK' then
      v_n2 := v_n2 + 1;
    end if;
  end loop;
  v_log := v_log || pg_temp.vb('C6a', 'capture insight ผูก content_post จริงทุกแถว', v_n2 = v_n, v_n2 || '/' || v_n);
  select count(*) into v_n from analytics.campaign where shop_id = v_shop;
  v_n2 := 0;
  for r in select id from analytics.campaign where shop_id = v_shop loop
    if pg_temp.vok(format('select analytics.content_signal_capture(%L::uuid, ''insight'', ''บทเรียนแคมเปญ'', p_origin_campaign_id => %L::uuid)', v_shop, r.id)) = 'OK' then
      v_n2 := v_n2 + 1;
    end if;
  end loop;
  v_log := v_log || pg_temp.vb('C6b', 'capture insight ผูก campaign จริงทุกแถว', v_n2 = v_n, v_n2 || '/' || v_n);

  -- C-views
  select count(*) into v_n from information_schema.columns where table_schema = 'analytics' and table_name = 'v_campaign_board';
  v_log := v_log || pg_temp.vb('C7a', 'v_campaign_board ยังมี 36 คอลัมน์ (ไม่ถูกแตะ)', v_n = 36, v_n::text);
  v_log := v_log || pg_temp.vb('C7b', 'v_live_night ยังอยู่และอ่านได้',
    pg_temp.vok('select count(*) from analytics.v_live_night') = 'OK');
  select md5(string_agg(c.relname || '=' || pg_get_viewdef(c.oid), E'\n' order by c.relname)) into v_md_after
    from pg_class c where c.relnamespace = 'analytics'::regnamespace and c.relkind = 'v'
     and c.relname not in ('v_content_signal', 'v_live_log_recent');
  v_log := v_log || pg_temp.vb('C7c', 'md5 definition ของ view เดิมทั้งหมด — เทียบมือก่อน/หลัง apply (ด่านจริงอยู่ใน migration)', true, v_md_after);

  -- v_content_signal: mass / unripe / save_rate
  perform analytics.content_signal_capture(v_shop, 'reference_clip', 'mass3', p_url => 'https://a.b/m3', p_hook_text => 'h',
    p_account_followers => 1000, p_views => 3000, p_saves => 15, p_seen_on => v_today, p_posted_on => v_today - 2);
  perform analytics.content_signal_capture(v_shop, 'reference_clip', 'normal-edge', p_url => 'https://a.b/m4', p_hook_text => 'h',
    p_account_followers => 2000, p_views => 1000, p_posted_on => v_today - 3);
  perform analytics.content_signal_capture(v_shop, 'reference_clip', 'low-edge', p_url => 'https://a.b/m5', p_hook_text => 'h',
    p_account_followers => 2000, p_views => 999);
  perform analytics.content_signal_capture(v_shop, 'reference_clip', 'unknown-null', p_url => 'https://a.b/m6', p_hook_text => 'h',
    p_views => 5000, p_account_followers => null);
  perform analytics.content_signal_capture(v_shop, 'reference_clip', 'unknown-zero', p_url => 'https://a.b/m7', p_hook_text => 'h',
    p_views => 5000, p_account_followers => 0);
  perform analytics.content_signal_capture(v_shop, 'reference_clip', 'zero-views', p_url => 'https://a.b/m8', p_hook_text => 'h',
    p_views => 0, p_saves => 0, p_account_followers => 100);
  v_log := v_log || pg_temp.vb('C8a', 'mass_label: 3.0→mass · 0.5→normal · 0.4995→low',
    (select mass_label from analytics.v_content_signal where summary = 'mass3' and shop_id = v_shop) = 'mass'
    and (select mass_label from analytics.v_content_signal where summary = 'normal-edge' and shop_id = v_shop) = 'normal'
    and (select mass_label from analytics.v_content_signal where summary = 'low-edge' and shop_id = v_shop) = 'low');
  v_log := v_log || pg_temp.vb('C8b', 'mass_label = unknown เมื่อ followers null หรือ 0 (ไม่หารศูนย์ ไม่เดา)',
    (select mass_label from analytics.v_content_signal where summary = 'unknown-null' and shop_id = v_shop) = 'unknown'
    and (select mass_label from analytics.v_content_signal where summary = 'unknown-zero' and shop_id = v_shop) = 'unknown'
    and (select mass_ratio from analytics.v_content_signal where summary = 'unknown-zero' and shop_id = v_shop) is null);
  v_log := v_log || pg_temp.vb('C8c', 'is_unripe: ห่าง 2 วัน=true · 3 วัน=false · ไม่มี posted_on=null',
    (select is_unripe from analytics.v_content_signal where summary = 'mass3' and shop_id = v_shop) is true
    and (select is_unripe from analytics.v_content_signal where summary = 'normal-edge' and shop_id = v_shop) is false
    and (select is_unripe from analytics.v_content_signal where summary = 'low-edge' and shop_id = v_shop) is null);
  v_log := v_log || pg_temp.vb('C8d', 'save_rate = saves/views · views=0 → null (ไม่หารศูนย์) · ไม่ใช่ reference_clip → mass/save null',
    (select save_rate from analytics.v_content_signal where summary = 'mass3' and shop_id = v_shop) = 0.005000
    and (select save_rate from analytics.v_content_signal where summary = 'zero-views' and shop_id = v_shop) is null
    and (select mass_ratio is null and mass_label is null and save_rate is null from analytics.v_content_signal where summary = 'ช่างขัดแหวนรุ่นใหม่' and shop_id = v_shop limit 1));

  -- v_live_log_recent
  v_log := v_log || pg_temp.vb('C9a', 'v_live_log_recent = 7 วันไทย (วันนี้ย้อน 6) ต่อร้าน',
    (select count(*) = 7 and min(live_date) = v_today - 6 and max(live_date) = v_today from analytics.v_live_log_recent where shop_id = v_shop));
  v_log := v_log || pg_temp.vb('C9b', 'logged ตรงกับ live_session_log จริง (นับคืนที่มี log ในหน้าต่าง)',
    (select count(*) filter (where logged) from analytics.v_live_log_recent where shop_id = v_shop)
    = (select count(*) from analytics.live_session_log where shop_id = v_shop and live_date between v_today - 6 and v_today));

  -- C-seed / ความต่อเนื่อง
  v_log := v_log || pg_temp.vb('C10a', 'seed โฮสต์ 2 แถวผูกร้านจริงที่ query ตอน apply (หมีเนย=โฮสต์ A · ฮันนี้ ปิ๊กๆ=โฮสต์ B)',
    (select count(*) from analytics.live_host where shop_id = v_shop and
       ((display_name = 'หมีเนย' and public_label = 'โฮสต์ A') or (display_name = 'ฮันนี้ ปิ๊กๆ' and public_label = 'โฮสต์ B'))) = 2);
  insert into analytics.live_host (shop_id, display_name, public_label) values (v_shop, 'หมีเนย', 'โฮสต์ A'), (v_shop, 'ฮันนี้ ปิ๊กๆ', 'โฮสต์ B')
    on conflict do nothing;
  get diagnostics v_n = row_count;
  v_log := v_log || pg_temp.vb('C10b', 'seed รันซ้ำ (insert เดิม on conflict do nothing) ไม่เพิ่มแถว', v_n = 0 and
    (select count(*) from analytics.live_host where shop_id = v_shop and display_name in ('หมีเนย', 'ฮันนี้ ปิ๊กๆ')) = 2);
  v_log := v_log || pg_temp.vb('C10c', 'แถว live_session_log เดิมอยู่ครบทุก id',
    (select count(*) from analytics.live_session_log where id = any (v_live_ids)) = v_live_cnt, v_live_cnt::text);

  v_log := v_log || E'\nmd5 live_session_upsert (v2): ' || md5(pg_get_functiondef('analytics.live_session_upsert(uuid, date, time, time, int, text, text, uuid, text[], text)'::regprocedure)) || E'\n';

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_ok   := (length(v_log) - length(replace(v_log, '[OK]', ''))) / 4;
  v_log := v_log || format(E'\n=== สรุป: [OK] %s · [FAIL] %s — raise ด้านล่างบังคับ ROLLBACK ทั้งหมด ===\n', v_ok, v_fail);
  raise exception '%', v_log;
end;
$verify0158$;
