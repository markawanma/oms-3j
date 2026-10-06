-- scripts/verify/qa-0158-extra.sql  (QA R2-D2, 6 ต.ค. 69) — เคส "ต้องไม่พัง" + edge ที่ verify-0158 ของ dev ไม่ได้คลุม
--
-- ต้องรันต่อท้าย migration ใน dry-run เดียวกัน และมี qa-0158-pre.sql เป็นต้นไฟล์ (baseline v1 ก่อน migration):
--   cat scripts/verify/qa-0158-pre.sql supabase/migrations/0158_content_signal_hook_host.sql \
--       scripts/verify/qa-0158-extra.sql > tmp.sql && node scripts/run-sql.mjs tmp.sql        (ไม่ใส่ --commit)
-- ถ้าไม่มี pre (รันหลัง apply จริง) เคสที่ต้องเทียบ "ก่อน/หลัง" จะขึ้น [SKIP] ไม่ใช่ FAIL
-- ผลทั้งหมดออกทาง raise exception ท้ายไฟล์ (บังคับ ROLLBACK ตาม 3j-migration-traps #11) — [FAIL] ≥ 1 = ไม่ผ่าน · [NOTE] = ผ่านแต่ควรรู้
-- ไฟล์นี้ไม่เคย COMMIT · แถวทดสอบทั้งหมดอยู่ในทรานแซกชันเดียวกับ migration

create or replace function pg_temp.qa_try(p_sql text) returns text
 language plpgsql as $q$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate || ':' || sqlerrm;
end $q$;

create or replace function pg_temp.qa_sig(p_id uuid) returns text
 language sql as $q$
  select concat_ws('|',
    extract(epoch from l.started_at - (l.live_date::timestamp at time zone 'Asia/Bangkok'))::text,
    extract(epoch from l.ended_at - (l.live_date::timestamp at time zone 'Asia/Bangkok'))::text,
    coalesce(l.peak_viewers::text, '~'), coalesce(l.note, '~'), l.source,
    (l.created_by is null)::text, (l.updated_by is null)::text)
  from analytics.live_session_log l where l.id = p_id
$q$;

-- คืน 'OK|<uuid>|' เมื่อสำเร็จ · 'sqlstate|detail|message' เมื่อถูกปฏิเสธ
create or replace function pg_temp.qa_cap(p_shop uuid, p_kind text, p_summary text, p_extra text default '') returns text
 language plpgsql as $q$
declare v_id uuid; v_detail text; v_msg text;
begin
  execute format('select analytics.content_signal_capture(%L::uuid, %L, %L%s)', p_shop, p_kind, p_summary,
                 case when p_extra <> '' then ', ' || p_extra else '' end) into v_id;
  return 'OK|' || v_id || '|';
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail, v_msg = message_text;
  return sqlstate || '|' || coalesce(v_detail, '') || '|' || v_msg;
end $q$;

create or replace function pg_temp.qa_l(p_id text, p_what text, p_ok boolean, p_detail text default '', p_kind text default 'FAIL')
 returns text language sql as $q$
  select '[' || case when p_ok is true then 'OK' else p_kind end || '] ' || p_id || ' ' || p_what
         || case when p_detail <> '' then ' → ' || p_detail else '' end || E'\n'
$q$;

create or replace function pg_temp.qa_st(p_res text) returns text language sql as $q$ select split_part(p_res, '|', 1) $q$;

do $qa$
declare
  v_log     text := E'\n=== qa-0158-extra (R2-D2) ===\n';
  v_have    boolean := coalesce(current_setting('qa.shop', true), '') <> '';
  v_today   date := (now() at time zone 'Asia/Bangkok')::date;
  v_shop    uuid;
  v_shop2   uuid;
  v_ha      uuid;
  v_hb      uuid;
  v_hx      uuid;
  v_id      uuid;
  v_id2     uuid;
  v_r       text;
  v_r2      text;
  v_n       bigint;
  v_n2      bigint;
  v_i       int;
  v_s       text;
  v_rest    text[];
  v_err     text[];
  v_pairs   text[];
  v_cols    text[] := array['p_account_followers', 'p_views', 'p_likes', 'p_comments', 'p_saves', 'p_shares'];
  v_row     record;
  v_t0      timestamptz;
  v_ms      numeric;
  v_step    uuid;
  v_step_l  uuid;
  v_fail    int;
  v_ok      int;
  v_note    int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);

  if (select count(*) from public.shop) <> 1 then
    raise exception 'qa-0158-extra: ต้องมีร้านเดียวใน public.shop';
  end if;
  select id into v_shop from public.shop;
  insert into public.shop (name) values ('qa-0158 shop B') returning id into v_shop2;
  select id into v_ha from analytics.live_host where shop_id = v_shop and display_name = 'หมีเนย';
  select id into v_hb from analytics.live_host where shop_id = v_shop and display_name = 'ฮันนี้ ปิ๊กๆ';
  v_log := v_log || pg_temp.qa_l('S0', 'seed โฮสต์ 2 แถวพร้อมใช้ (public_label ไม่ใช่ชื่อจริง)',
    v_ha is not null and v_hb is not null
    and (select count(*) from analytics.live_host where shop_id = v_shop) = 2
    and (select count(*) from analytics.live_host where shop_id = v_shop and public_label in ('โฮสต์ A', 'โฮสต์ B')) = 2);

  ------------------------------------------------------------------------------------------------
  -- V. ของเดิมที่ dashboard/weekly brief อ่านต้องไม่ขยับ (เทียบ baseline ก่อน migration)
  ------------------------------------------------------------------------------------------------
  if v_have then
    v_log := v_log || pg_temp.qa_l('V1', 'v_live_night: คอลัมน์ (ชื่อ+ชนิด) เท่า baseline ก่อน migration',
      (select md5(string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' order by attnum))
         from pg_attribute where attrelid = 'analytics.v_live_night'::regclass and attnum > 0 and not attisdropped)
      = current_setting('qa.vln_cols'));
    select count(*)::text || ':' || md5(coalesce(string_agg(t::text, E'\n' order by t.shop_id, t.live_date), ''))
      into v_r from analytics.v_live_night t;
    v_log := v_log || pg_temp.qa_l('V2', 'v_live_night: จำนวนแถว + เนื้อหาทุกแถวเท่า baseline (md5)', v_r = current_setting('qa.vln_rows'),
      'now=' || split_part(v_r, ':', 1) || ' before=' || split_part(current_setting('qa.vln_rows'), ':', 1));
    v_log := v_log || pg_temp.qa_l('V3', 'live_night_snapshot_capture (ฟังก์ชัน cron ที่อ่าน v_live_night) definition เดิม',
      (select md5(pg_get_functiondef(p.oid)) from pg_proc p
        where p.pronamespace = 'analytics'::regnamespace and p.proname = 'live_night_snapshot_capture') = current_setting('qa.snapfn'));
    select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, step_id, status, content_body, clip_brief::text, updated_at), E'\n' order by id), ''))
      into v_r from analytics.step_artifact;
    v_log := v_log || pg_temp.qa_l('V4', 'step_artifact ทั้งตาราง (clip_brief + updated_at) เท่า baseline', v_r = current_setting('qa.art'));
    select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, shop_id, live_date, started_at, ended_at,
             peak_viewers, note, source, created_by, updated_by, created_at, updated_at), E'\n' order by id), ''))
      into v_r from analytics.live_session_log where live_date >= date '2025-01-01';
    v_log := v_log || pg_temp.qa_l('V5', 'คืนไลฟ์จริง (3 แถว) ไม่ขยับหลัง migration', v_r = current_setting('qa.live_orig'), v_r);
  else
    v_log := v_log || E'[SKIP] V1-V5 ไม่มี qa-0158-pre.sql เป็นต้นไฟล์ — ไม่มี baseline\n';
  end if;
  v_log := v_log || pg_temp.qa_l('V6', 'v_live_night ไม่มีคอลัมน์ host (ไม่แตะ view เดิม) · คืนจริงทั้ง 3 host_id = null',
    not exists (select 1 from pg_attribute where attrelid = 'analytics.v_live_night'::regclass and attnum > 0 and attname like '%host%')
    and (select count(*) from analytics.live_session_log where live_date >= date '2025-01-01' and host_id is not null) = 0);
  v_log := v_log || pg_temp.qa_l('V7', 'ACL live_session_upsert v2: authenticated/anon ไม่มี EXECUTE · service_role มี',
    not has_function_privilege('authenticated', 'analytics.live_session_upsert(uuid, date, time, time, int, text, text, uuid, text[], text)'::regprocedure, 'execute')
    and not has_function_privilege('anon', 'analytics.live_session_upsert(uuid, date, time, time, int, text, text, uuid, text[], text)'::regprocedure, 'execute')
    and has_function_privilege('service_role', 'analytics.live_session_upsert(uuid, date, time, time, int, text, text, uuid, text[], text)'::regprocedure, 'execute'));

  ------------------------------------------------------------------------------------------------
  -- P. ผลของ live_session_upsert v2 = v1 เมื่อเรียกด้วยพารามิเตอร์ชุดเดียวกับแอป (lib/actions/live-metrics.ts)
  --    แอปส่ง named-arg: p_shop p_live_date p_start p_end p_peak p_note p_source (7 ตัว) เท่านั้น
  ------------------------------------------------------------------------------------------------
  if v_have then
    v_rest := array[
      $s$p_start => '20:00', p_end => '23:00', p_peak => 300, p_note => '  หมายเหตุ  ', p_source => 'admin_ui'$s$,
      $s$p_start => '22:00', p_end => '01:00', p_peak => null, p_note => null, p_source => 'owner_chat'$s$,
      $s$p_start => '20:00', p_end => '23:00', p_peak => 0, p_note => '', p_source => 'backfill'$s$,
      $s$placeholder-replaced-below$s$,
      $s$p_start => '20:00', p_end => '23:00'$s$,
      $s$p_start => '19:45', p_end => '23:10', p_peak => 2147483647, p_note => '🔥ไลฟ์คืนนี้ 💎 "quote" ''single''', p_source => 'admin_ui'$s$
    ];
    v_rest[4] := $s$p_start => '20:30', p_end => '08:29', p_peak => 120, p_note => $s$ || quote_literal(repeat('ก', 500)) || $s$, p_source => 'owner_chat'$s$;
    for v_i in 1 .. array_length(v_rest, 1) loop
      execute format('select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => %L::date, %s)',
                     v_shop, '2019-04-0' || v_i, v_rest[v_i]) into v_id;
      v_log := v_log || pg_temp.qa_l('P' || v_i, 'ลายเซ็นผล (เวลา/peak/note/source/audit) v2 = v1 · param ชุดที่ ' || v_i,
        pg_temp.qa_sig(v_id) = current_setting('qa.v1h' || v_i), 'v2=' || left(pg_temp.qa_sig(v_id), 60) || ' v1=' || left(current_setting('qa.v1h' || v_i), 60));
    end loop;
    execute format('select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date ''2019-04-07'', p_start => ''20:00'', p_end => ''23:00'', p_peak => 100, p_note => ''รอบแรก'', p_source => ''admin_ui'')', v_shop) into v_id;
    execute format('select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date ''2019-04-07'', p_start => ''20:15'', p_end => ''23:45'', p_peak => 450, p_note => null, p_source => ''admin_ui'')', v_shop) into v_id2;
    v_r := (v_id = v_id2)::text || '/' || pg_temp.qa_sig(v_id2) || '/n=' || (select count(*) from analytics.live_session_log where shop_id = v_shop and live_date = date '2019-04-07');
    v_log := v_log || pg_temp.qa_l('P7', 'upsert ซ้ำคืนเดิม: id เดิม · ไม่เพิ่มแถว · note ถูกทับเป็น null เหมือน v1', v_r = current_setting('qa.v1h7'), v_r || ' vs ' || current_setting('qa.v1h7'));
    v_log := v_log || pg_temp.qa_l('P8', 'ทางเรียกแบบแอป ไม่สร้าง host/สัญญาณพ่วง (host_id null · content_signal live_question 0 แถวในคืน 2019-04-*)',
      (select count(*) from analytics.live_session_log where live_date between date '2019-04-01' and date '2019-04-07' and host_id is not null) = 0
      and (select count(*) from analytics.content_signal where origin_live_date between date '2019-04-01' and date '2019-04-07') = 0);

    v_err := array[
      $s$select analytics.live_session_upsert(p_shop => %1$L::uuid, p_live_date => date '2019-03-20', p_start => '20:00', p_end => '23:00', p_peak => -1)$s$,
      $s$select analytics.live_session_upsert(p_shop => %1$L::uuid, p_live_date => date '2019-03-20', p_start => '20:00', p_end => '23:00', p_note => repeat('x', 501))$s$,
      $s$select analytics.live_session_upsert(p_shop => %1$L::uuid, p_live_date => date '2019-03-20', p_start => '20:00', p_end => '23:00', p_source => 'hack')$s$,
      $s$select analytics.live_session_upsert(p_shop => %1$L::uuid, p_live_date => date '2019-03-20', p_start => '20:00', p_end => '20:00')$s$,
      $s$select analytics.live_session_upsert(p_shop => %1$L::uuid, p_live_date => date '2019-03-20', p_start => '08:00', p_end => '21:00')$s$,
      $s$select analytics.live_session_upsert(p_shop => %1$L::uuid, p_live_date => null::date, p_start => '20:00', p_end => '23:00')$s$,
      $s$select analytics.live_session_upsert(p_shop => null::uuid, p_live_date => date '2019-03-20', p_start => '20:00', p_end => '23:00')$s$,
      $s$select analytics.live_session_upsert(p_shop => %1$L::uuid, p_live_date => date '2019-03-20', p_start => '20:00', p_end => '23:00', p_source => null::text)$s$,
      $s$select analytics.live_session_upsert(p_shop => '00000000-0000-0000-0000-0000000000aa'::uuid, p_live_date => date '2019-03-20', p_start => '20:00', p_end => '23:00')$s$,
      $s$select analytics.live_session_upsert(p_shop => %1$L::uuid, p_live_date => date '2019-03-21', p_start => '20:00', p_end => '23:00', p_note => repeat(' ', 600))$s$,
      $s$select analytics.live_session_upsert(p_shop => %1$L::uuid, p_live_date => date '2019-03-20', p_start => '00:00', p_end => '23:59')$s$,
      $s$select analytics.live_session_upsert(p_shop => %1$L::uuid, p_live_date => date '2019-03-20', p_start => '20:00', p_end => '23:00', p_peak => 2147483648)$s$
    ];
    v_n := 0;
    for v_i in 1 .. array_length(v_err, 1) loop
      v_r := pg_temp.qa_try(format(v_err[v_i], v_shop));
      if v_r is distinct from current_setting('qa.v1e' || v_i) then
        v_n := v_n + 1;
        v_log := v_log || pg_temp.qa_l('PE' || v_i, 'error v2 ≠ v1', false, 'v2=' || left(v_r, 110) || ' | v1=' || left(current_setting('qa.v1e' || v_i), 110));
      end if;
    end loop;
    v_log := v_log || pg_temp.qa_l('PE', 'error 12 เคส (peak ติดลบ · note>500 · source ผิด/null · start=end · >12ชม. · null shop/วัน · shop ไม่มี · ฯลฯ) sqlstate+ข้อความตรง v1 ทุกเคส', v_n = 0, 'เคสที่ต่าง=' || v_n);
  else
    v_log := v_log || E'[SKIP] P1-P8/PE ไม่มี baseline v1\n';
  end if;

  ------------------------------------------------------------------------------------------------
  -- H. host ไม่หายเมื่อบันทึกซ้ำโดยไม่ส่ง host (D-c) + ด่านโฮสต์
  ------------------------------------------------------------------------------------------------
  execute format($s$select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date '2019-05-01', p_start => '20:00', p_end => '23:00', p_peak => 100, p_note => 'n1', p_source => 'admin_ui', p_host_id => %L::uuid)$s$, v_shop, v_ha) into v_id;
  v_log := v_log || pg_temp.qa_l('H1', 'ตั้ง host ตอนบันทึกคืนใหม่', (select host_id from analytics.live_session_log where id = v_id) = v_ha);
  execute format($s$select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date '2019-05-01', p_start => '20:10', p_end => '23:20', p_peak => 250, p_note => 'n2', p_source => 'admin_ui')$s$, v_shop) into v_id2;
  select * into v_row from analytics.live_session_log where id = v_id;
  v_log := v_log || pg_temp.qa_l('H2', 'บันทึกซ้ำแบบแอป (ไม่ส่ง host) → host เดิมอยู่ · id เดิม · peak/note/เวลาอัปเดต',
    v_id2 = v_id and v_row.host_id = v_ha and v_row.peak_viewers = 250 and v_row.note = 'n2');
  execute format($s$select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date '2019-05-01', p_start => '20:10', p_end => '23:20', p_peak => 260, p_host_id => null::uuid)$s$, v_shop) into v_id2;
  v_log := v_log || pg_temp.qa_l('H3', 'ส่ง p_host_id = null ชัดๆ ก็ไม่ล้าง host (D-c — ผลคือ "ล้างโฮสต์ผ่าน RPC นี้ไม่ได้")', (select host_id from analytics.live_session_log where id = v_id) = v_ha, '',  'NOTE');
  v_log := v_log || pg_temp.qa_l('H3b', 'ล้าง host ไม่ได้จริง (ยืนยันข้อจำกัดให้ UI รอบ 2 รู้)', (select host_id from analytics.live_session_log where id = v_id) is null, 'host ยังอยู่ — ไม่มีทางตั้งกลับเป็น "ไม่ระบุ" ผ่าน RPC', 'NOTE');
  execute format($s$select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date '2019-05-01', p_start => '20:10', p_end => '23:20', p_peak => 260, p_host_id => %L::uuid)$s$, v_shop, v_hb) into v_id2;
  v_log := v_log || pg_temp.qa_l('H4', 'เปลี่ยน host A → B ได้', (select host_id from analytics.live_session_log where id = v_id) = v_hb);
  perform analytics.live_host_upsert(v_shop, 'ฮันนี้ ปิ๊กๆ', 'โฮสต์ B', false, v_hb);
  v_log := v_log || pg_temp.qa_l('H5a', 'host B ปิดใช้งานแล้ว บันทึกคืนเดิมซ้ำ (host B เดิม / ส่ง B ซ้ำ) ยังผ่าน',
    pg_temp.qa_try(format($s$select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date '2019-05-01', p_start => '20:10', p_end => '23:20', p_peak => 270)$s$, v_shop)) = 'OK'
    and pg_temp.qa_try(format($s$select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date '2019-05-01', p_start => '20:10', p_end => '23:20', p_peak => 271, p_host_id => %L::uuid)$s$, v_shop, v_hb)) = 'OK'
    and (select host_id from analytics.live_session_log where id = v_id) = v_hb);
  v_r := pg_temp.qa_try(format($s$select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date '2019-05-02', p_start => '20:00', p_end => '23:00', p_host_id => %L::uuid)$s$, v_shop, v_hb));
  v_log := v_log || pg_temp.qa_l('H5b', 'มอบ host ที่ปิดใช้งานให้คืนใหม่ → 22023', left(v_r, 5) = '22023', left(v_r, 90));
  perform analytics.live_session_upsert(v_shop, date '2019-05-03', time '20:00', time '23:00', null, null, 'admin_ui', v_ha);
  v_r := pg_temp.qa_try(format($s$select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date '2019-05-03', p_start => '20:00', p_end => '23:00', p_host_id => %L::uuid)$s$, v_shop, v_hb));
  v_log := v_log || pg_temp.qa_l('H5c', 'คืนที่ host A อยู่ → สลับไป host ที่ปิดแล้ว → 22023 และ host A ยังอยู่',
    left(v_r, 5) = '22023' and (select host_id from analytics.live_session_log where shop_id = v_shop and live_date = date '2019-05-03') = v_ha, left(v_r, 90));
  v_hx := analytics.live_host_upsert(v_shop2, 'qa host X', 'โฮสต์ X');
  v_r := pg_temp.qa_try(format($s$select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date '2019-05-04', p_start => '20:00', p_end => '23:00', p_host_id => %L::uuid)$s$, v_shop, v_hx));
  v_log := v_log || pg_temp.qa_l('H6', 'host ของร้านอื่น → 22023 · ไม่สร้างแถว log',
    left(v_r, 5) = '22023' and not exists (select 1 from analytics.live_session_log where shop_id = v_shop and live_date = date '2019-05-04'), left(v_r, 90));
  v_r := pg_temp.qa_try(format($s$select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date '2019-05-04', p_start => '20:00', p_end => '23:00', p_host_id => gen_random_uuid())$s$, v_shop));
  v_log := v_log || pg_temp.qa_l('H7', 'host uuid ที่ไม่มีอยู่ → 22023', left(v_r, 5) = '22023', left(v_r, 90));

  -- R: บันทึก "คืนจริง" เดิมซ้ำ (แถวจริงตัวแรก) ใน txn นี้ — ตั้ง host แล้วบันทึกซ้ำแบบแอป
  select * into v_row from analytics.live_session_log where live_date >= date '2025-01-01' order by live_date limit 1;
  if v_row.id is not null then
    execute format($s$select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => %L::date, p_start => %L, p_end => %L, p_peak => %L::int, p_note => %L, p_source => %L, p_host_id => %L::uuid)$s$,
      v_row.shop_id, v_row.live_date, to_char(v_row.started_at at time zone 'Asia/Bangkok', 'HH24:MI'), to_char(v_row.ended_at at time zone 'Asia/Bangkok', 'HH24:MI'),
      v_row.peak_viewers, v_row.note, v_row.source, v_ha) into v_id;
    execute format($s$select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => %L::date, p_start => %L, p_end => %L, p_peak => %L::int, p_note => %L, p_source => 'admin_ui')$s$,
      v_row.shop_id, v_row.live_date, to_char(v_row.started_at at time zone 'Asia/Bangkok', 'HH24:MI'), to_char(v_row.ended_at at time zone 'Asia/Bangkok', 'HH24:MI'),
      coalesce(v_row.peak_viewers, 0) + 5, v_row.note) into v_id2;
    select count(*) into v_n from analytics.live_session_log where live_date >= date '2025-01-01';
    v_log := v_log || pg_temp.qa_l('R1', 'คืนจริง ' || v_row.live_date || ': ตั้ง host → บันทึกซ้ำแบบแอป host คงอยู่ · id/created_at เดิม · ยังมี 3 แถวจริง',
      v_id = v_row.id and v_id2 = v_row.id and v_n = 3
      and (select host_id from analytics.live_session_log where id = v_row.id) = v_ha
      and (select created_at from analytics.live_session_log where id = v_row.id) = v_row.created_at
      and (select started_at from analytics.live_session_log where id = v_row.id) = v_row.started_at
      and (select ended_at from analytics.live_session_log where id = v_row.id) = v_row.ended_at);
  end if;

  ------------------------------------------------------------------------------------------------
  -- Q. p_questions (live_question)
  ------------------------------------------------------------------------------------------------
  execute format($s$select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date '2019-06-01', p_start => '20:00', p_end => '23:00', p_questions => array[' ราคา  เท่าไหร่ ', 'ราคา เท่าไหร่', null, '', '   ', 'ส่งฟรีไหม'])$s$, v_shop) into v_id;
  select count(*) into v_n from analytics.content_signal where shop_id = v_shop and origin_live_date = date '2019-06-01';
  v_log := v_log || pg_temp.qa_l('Q1', 'คำถามซ้ำหลัง trim/ยุบช่องว่าง/ว่าง/null ถูกกรอง → เหลือ 2 ข้อ', v_n = 2, 'n=' || v_n);
  execute format($s$select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date '2019-06-01', p_start => '20:00', p_end => '23:00', p_questions => array['ส่งฟรีไหม', 'ราคา เท่าไหร่'])$s$, v_shop) into v_id2;
  select count(*) into v_n from analytics.content_signal where shop_id = v_shop and origin_live_date = date '2019-06-01';
  v_log := v_log || pg_temp.qa_l('Q2', 'ส่งคำถามเดิมซ้ำ (re-submit) ไม่เพิ่มแถว · log id เดิม', v_n = 2 and v_id = v_id2, 'n=' || v_n);
  select * into v_row from analytics.content_signal where shop_id = v_shop and origin_live_date = date '2019-06-01' order by summary limit 1;
  v_log := v_log || pg_temp.qa_l('Q2b', 'สัญญาณคำถาม: kind=live_question · seen_on=คืนนั้น · status=new · source=owner · url null',
    v_row.kind = 'live_question' and v_row.seen_on = date '2019-06-01' and v_row.status = 'new' and v_row.source = 'owner' and v_row.url is null);
  v_r := pg_temp.qa_try(format($s$select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date '2019-06-02', p_start => '20:00', p_end => '23:00', p_questions => (select array_agg('q' || g) from generate_series(1, 21) g))$s$, v_shop));
  v_log := v_log || pg_temp.qa_l('Q3', '21 คำถาม → 22023 และไม่เขียนแถว log (atomic)', left(v_r, 5) = '22023' and not exists (select 1 from analytics.live_session_log where shop_id = v_shop and live_date = date '2019-06-02'), left(v_r, 80));
  v_r := pg_temp.qa_try(format($s$select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date '2019-06-02', p_start => '20:00', p_end => '23:00', p_questions => array['ok', repeat('ก', 301)])$s$, v_shop));
  v_log := v_log || pg_temp.qa_l('Q4', 'คำถามยาว 301 → 22023 ก่อนเขียนอะไร (ข้อ "ok" ที่มาก่อนก็ไม่หลุดเข้า DB)',
    left(v_r, 5) = '22023' and not exists (select 1 from analytics.live_session_log where shop_id = v_shop and live_date = date '2019-06-02')
    and not exists (select 1 from analytics.content_signal where shop_id = v_shop and origin_live_date = date '2019-06-02'), left(v_r, 80));
  v_log := v_log || pg_temp.qa_l('Q4b', 'คำถาม 300 ตัวอักษรไทยพอดี + 20 ข้อพอดี ผ่าน',
    pg_temp.qa_try(format($s$select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date '2019-06-05', p_start => '20:00', p_end => '23:00', p_questions => array[repeat('ก', 300)] || (select array_agg('Q' || g) from generate_series(1, 19) g))$s$, v_shop)) = 'OK');
  v_log := v_log || pg_temp.qa_l('Q5', 'p_questions = {} / null ไม่พัง · ไม่มีสัญญาณ',
    pg_temp.qa_try(format($s$select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date '2019-06-06', p_start => '20:00', p_end => '23:00', p_questions => '{}'::text[])$s$, v_shop)) = 'OK'
    and not exists (select 1 from analytics.content_signal where origin_live_date = date '2019-06-06'));
  -- [แก้รอบ 2 ตามมติ Tech Lead S-M2] เดิม: AI ส่งคำถามได้แต่ source ถูกจดเป็น owner (NOTE) · ตอนนี้ AI เรียก live_session_upsert ไม่ได้เลย
  v_r := pg_temp.qa_try(format($s$select analytics.live_session_upsert(%L::uuid, date '2019-06-04', time '20:00', time '23:00', null, null, 'owner_chat', null, array['คำถามที่ AI ส่ง'], 'ai')$s$, v_shop));
  v_log := v_log || pg_temp.qa_l('Q6', 'actor_role=ai เรียก live_session_upsert (พร้อมคำถาม) → 42501 · ไม่มีแถว log/สัญญาณเกิด',
    left(v_r, 5) = '42501'
    and not exists (select 1 from analytics.live_session_log where shop_id = v_shop and live_date = date '2019-06-04')
    and not exists (select 1 from analytics.content_signal where shop_id = v_shop and origin_live_date = date '2019-06-04'), left(v_r, 90));
  perform analytics.live_session_upsert(v_shop, date '2019-06-07', time '20:00', time '23:00', null, null, 'owner_chat', null, array['คำถามระบบ'], 'system');
  v_log := v_log || pg_temp.qa_l('Q7', 'actor_role=system → source=system', (select source from analytics.content_signal where origin_live_date = date '2019-06-07') = 'system');
  v_log := v_log || pg_temp.qa_l('Q8', 'actor_role ผิด (admin / null / AI ตัวใหญ่) → 22023 ทุกตัว',
    (select bool_and(left(pg_temp.qa_try(format($s$select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date '2019-06-08', p_start => '20:00', p_end => '23:00', p_actor_role => %s)$s$, v_shop, x)), 5) = '22023')
       from unnest(array['''admin''', 'null::text', '''AI''', '''''']) as t(x)));
  v_r := pg_temp.qa_cap(v_shop, 'live_question', 'ส่งฟรีไหม', 'p_origin_live_date => date ''2019-06-01''');
  v_log := v_log || pg_temp.qa_l('Q9', 'live_question ซ้ำคืน+ข้อความเดียวกันผ่าน capture → 23505 + id เดิมใน detail', pg_temp.qa_st(v_r) = '23505' and split_part(v_r, '|', 2) <> '', left(v_r, 80));
  v_r := pg_temp.qa_try(format($s$select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date '2019-06-09', p_start => '20:00', p_end => '23:00', p_peak => 10, p_questions => array[E'\t'])$s$, v_shop));
  v_log := v_log || pg_temp.qa_l('Q10', 'คำถามเป็น tab ล้วน ต้องไม่ทำให้ "บันทึกคืนนี้ทั้งก้อน" ล้ม (peak/เวลาที่กรอกต้องไม่หาย)',
    v_r = 'OK' and exists (select 1 from analytics.live_session_log where shop_id = v_shop and live_date = date '2019-06-09'),
    'ได้ ' || left(v_r, 130) || ' · แถว log ' || case when exists (select 1 from analytics.live_session_log where shop_id = v_shop and live_date = date '2019-06-09') then 'มี' else 'ไม่มี (ถอยทั้งก้อน)' end);
  v_r := pg_temp.qa_try(format($s$select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date '2019-06-10', p_start => '20:00', p_end => '23:00', p_questions => array[E'\u00a0', E'\u200b', E'\u3000'])$s$, v_shop));
  select count(*) into v_n from analytics.content_signal where shop_id = v_shop and origin_live_date = date '2019-06-10';
  v_log := v_log || pg_temp.qa_l('Q11', 'คำถามที่เป็นช่องว่างพิเศษ (NBSP / zero-width / ideographic) ไม่ถูกเก็บเป็นสัญญาณขยะ', v_r = 'OK' and v_n = 0,
    'ผล=' || left(v_r, 60) || ' แถวสัญญาณ=' || v_n, 'NOTE');

  ------------------------------------------------------------------------------------------------
  -- U. content_url_norm + กันลิงก์ซ้ำ
  ------------------------------------------------------------------------------------------------
  v_s := 'tiktok.com/@shopx/video/7000000000000000001';
  v_log := v_log || pg_temp.qa_l('U1', 'TikTok เต็ม = base', analytics.content_url_norm('https://www.tiktok.com/@shopx/video/7000000000000000001') = v_s, analytics.content_url_norm('https://www.tiktok.com/@shopx/video/7000000000000000001'));
  v_log := v_log || pg_temp.qa_l('U2', 'TikTok + ?is_from_webapp=1&sender_device=pc ตัด query ทิ้ง = base',
    analytics.content_url_norm('https://www.tiktok.com/@shopx/video/7000000000000000001?is_from_webapp=1&sender_device=pc') = v_s);
  v_log := v_log || pg_temp.qa_l('U3', 'scheme/host ตัวพิมพ์ใหญ่ (HTTPS://WWW.TIKTOK.COM) = base', analytics.content_url_norm('HTTPS://WWW.TIKTOK.COM/@shopx/video/7000000000000000001') = v_s);
  v_log := v_log || pg_temp.qa_l('U4', 'มี / และ // ท้าย + fragment + ช่องว่างหัวท้าย = base',
    analytics.content_url_norm('https://tiktok.com/@shopx/video/7000000000000000001/') = v_s
    and analytics.content_url_norm('https://tiktok.com/@shopx/video/7000000000000000001//#x') = v_s
    and analytics.content_url_norm('  https://m.tiktok.com/@shopx/video/7000000000000000001  ') = v_s);
  v_log := v_log || pg_temp.qa_l('U5', 'ตัวพิมพ์ใหญ่ใน path (@ShopX vs @shopx) ถือเป็นลิงก์เดียวกัน', analytics.content_url_norm('https://www.tiktok.com/@ShopX/video/7000000000000000001') = v_s,
    'ได้ ' || analytics.content_url_norm('https://www.tiktok.com/@ShopX/video/7000000000000000001') || ' — คนละ url_norm ⇒ ลิงก์เดียวกันที่พิมพ์ handle ต่างตัวพิมพ์หลุดด่านซ้ำ (แอป canonicalizeTikTokLink ก็ไม่ lowercase handle)', 'NOTE');
  v_log := v_log || pg_temp.qa_l('U6', 'YouTube watch?v=A กับ v=B คนละคลิป (ไม่ชน)', analytics.content_url_norm('https://www.youtube.com/watch?v=AAAAAAAAAAA') <> analytics.content_url_norm('https://youtube.com/watch?v=BBBBBBBBBBB'));
  v_log := v_log || pg_temp.qa_l('U6b', 'YouTube A + &si=..&t=5 / ?V=A (key ตัวใหญ่) / m.youtube = A เดียวกัน',
    analytics.content_url_norm('https://www.youtube.com/watch?v=AAAAAAAAAAA&si=xyz&t=5') = analytics.content_url_norm('https://www.youtube.com/watch?v=AAAAAAAAAAA')
    and analytics.content_url_norm('https://m.youtube.com/watch?V=AAAAAAAAAAA') = analytics.content_url_norm('https://www.youtube.com/watch?v=AAAAAAAAAAA'));
  v_log := v_log || pg_temp.qa_l('U6c', 'YouTube id ต่างตัวพิมพ์ (v=aaa vs v=AAA) = คนละคลิป (id เป็น case-sensitive)', analytics.content_url_norm('https://youtube.com/watch?v=abcDEF') <> analytics.content_url_norm('https://youtube.com/watch?v=ABCdef'));
  v_log := v_log || pg_temp.qa_l('U6d', 'youtu.be/ID กับ youtube.com/watch?v=ID ถือเป็นคลิปเดียวกัน', analytics.content_url_norm('https://youtu.be/AAAAAAAAAAA') = analytics.content_url_norm('https://youtube.com/watch?v=AAAAAAAAAAA'),
    'DB รวมให้ไม่ได้ — ลิงก์เดียวกันคนละรูปแบบหลุดซ้ำได้ (คาดไว้ ไม่ใช่บั๊ก)', 'NOTE');
  v_log := v_log || pg_temp.qa_l('U7', 'Facebook watch/?v=1 เต็ม = m.facebook ...&app=fbl', analytics.content_url_norm('https://www.facebook.com/watch/?v=123') = analytics.content_url_norm('https://m.facebook.com/watch?v=123&app=fbl'));
  -- [แก้รอบ 2 ตามมติ Tech Lead S-M1] เดิม: userinfo ถูกตัดเงียบ → ชนกับลิงก์จริง · ตอนนี้ปฏิเสธ (null) · พอร์ต 443 ยังถูกตัดเมื่อไม่มี userinfo
  v_log := v_log || pg_temp.qa_l('U8', 'userinfo → null (ปฏิเสธ ไม่ตัดเงียบ) · พอร์ต 443 ไม่มี userinfo ยังถูกตัด',
    analytics.content_url_norm('https://user:pw@www.tiktok.com:443/@shopx/video/7000000000000000001') is null
    and analytics.content_url_norm('https://www.tiktok.com:443/@shopx/video/7000000000000000001') = v_s);
  v_s := null;
  select string_agg(x, ' | ') into v_s from unnest(array['javascript:alert(1)', 'ftp://x.y/z', '//a.b/c', 'https://nohost', 'https://', '', '   ', 'https://a b.com/x', 'https://ตัวอย่าง.com/x', 'tiktok.com/@a/video/1', 'data:text/html,x', 'https://[::1]/x', 'https://-a.com/x', 'https://a..b/x']) as t(x)
   where analytics.content_url_norm(x) is not null;
  v_log := v_log || pg_temp.qa_l('U9', 'ค่าที่ไม่ใช่ http(s) URL ที่ถูกรูป → null ทั้ง 14 แบบ (รวม javascript: / data: / IPv6 / โดเมนไทย)', v_s is null, coalesce(v_s, ''));
  v_log := v_log || pg_temp.qa_l('U9b', 'content_url_norm(null) = null', analytics.content_url_norm(null) is null);

  -- ReDoS / ขนาดใหญ่: norm คำนวณก่อนเช็คความยาว 500 ใน capture
  v_t0 := clock_timestamp();
  perform analytics.content_url_norm('https://a.b/' || repeat('/', 300000));
  perform analytics.content_url_norm('https://a.b/' || repeat('a', 300000));
  perform analytics.content_url_norm('https://a.b/x?' || repeat('&', 300000) || 'v=1');
  perform analytics.content_url_norm('https://a.b/x?' || repeat('v=1&', 100000));
  v_ms := extract(epoch from clock_timestamp() - v_t0) * 1000;
  v_log := v_log || pg_temp.qa_l('U10', 'URL ยาว 300k ตัวอักษร 4 รูปแบบ (// ท้าย · path · & ซ้ำ · v= ซ้ำ) ประมวลผล < 3 วินาที', v_ms < 3000, round(v_ms) || ' ms');
  v_r := pg_temp.qa_cap(v_shop, 'reference_clip', 'ลิงก์ยาวเกิน', format($e$p_url => %L, p_hook_text => 'h'$e$, 'https://a.b/' || repeat('x', 600)));
  v_log := v_log || pg_temp.qa_l('U11', 'URL 501+ ตัวอักษร → 22023 (ไม่ใช่ error ดิบ)', pg_temp.qa_st(v_r) = '22023', left(v_r, 90));
  v_r := pg_temp.qa_cap(v_shop, 'reference_clip', 'ลิงก์ 500 พอดี', format($e$p_url => %L, p_hook_text => 'h'$e$, 'https://qa-0158.invalid/' || repeat('x', 500 - 25)));
  v_log := v_log || pg_temp.qa_l('U11b', 'URL 500 ตัวอักษรพอดี ผ่าน', pg_temp.qa_st(v_r) = 'OK', left(v_r, 90));
  -- [แก้รอบ 2 ตาม S-M1] payload เดิมมีช่องว่าง ("drop table") ⇒ ถูกปฏิเสธเพราะ whitespace (ถูกต้อง) · ตรวจทั้งสองแบบ: มีช่องว่าง → 22023 · ไม่มีช่องว่าง → เก็บเป็นข้อความ ตารางไม่หาย
  v_r := pg_temp.qa_cap(v_shop, 'reference_clip', 'url ฝัง SQL มีช่องว่าง', format($e$p_url => %L, p_hook_text => 'h'$e$, $u$https://qa-0158.invalid/x';drop table analytics.content_signal;--$u$));
  v_r2 := pg_temp.qa_cap(v_shop, 'reference_clip', 'url ฝัง SQL ไม่มีช่องว่าง', format($e$p_url => %L, p_hook_text => 'h'$e$, $u$https://qa-0158.invalid/x';drop/**/table/**/analytics.content_signal;--$u$));
  v_log := v_log || pg_temp.qa_l('U12', 'url ฝัง SQL: มีช่องว่าง → 22023 · ไม่มีช่องว่าง → เก็บเป็นข้อความเฉยๆ · ตารางไม่หายทั้งสองกรณี',
    pg_temp.qa_st(v_r) = '22023' and pg_temp.qa_st(v_r2) = 'OK' and to_regclass('analytics.content_signal') is not null, left(v_r, 40) || ' / ' || left(v_r2, 40));
  v_r := pg_temp.qa_cap(v_shop, 'reference_clip', 'url มี newline', format($e$p_url => %L, p_hook_text => 'h'$e$, 'https://qa-0158.invalid/a' || chr(10) || 'b'));
  v_log := v_log || pg_temp.qa_l('U13', 'url มีตัวขึ้นบรรทัดใหม่/ตัวควบคุมถูกปฏิเสธ', pg_temp.qa_st(v_r) <> 'OK', 'ผ่านเข้าตาราง url แล้ว (url CHECK ตรวจแค่ ^https?://) — ถ้า UI/CSV แสดงดิบ อาจทำให้ลิงก์เพี้ยน', 'NOTE');
  -- dedupe ผ่าน capture
  v_r := pg_temp.qa_cap(v_shop, 'reference_clip', 'คลิป dedupe ต้นฉบับ', $e$p_url => 'https://www.tiktok.com/@shopx/video/7000000000000000099', p_hook_text => 'hook ต้นฉบับ'$e$);
  v_id := nullif(split_part(v_r, '|', 2), '')::uuid;
  v_log := v_log || pg_temp.qa_l('U14a', 'capture คลิปแรกผ่าน', pg_temp.qa_st(v_r) = 'OK', left(v_r, 80));
  for v_i in 1 .. 4 loop
    v_r := pg_temp.qa_cap(v_shop, 'reference_clip', 'ซ้ำ ' || v_i, format($e$p_url => %L, p_hook_text => 'x'$e$,
      (array['https://www.tiktok.com/@shopx/video/7000000000000000099?is_from_webapp=1&sender_device=pc',
             'HTTPS://TikTok.com/@shopx/video/7000000000000000099/',
             'http://m.tiktok.com/@shopx/video/7000000000000000099#f',
             '  https://www.tiktok.com//@shopx/video/7000000000000000099?lang=th  '])[v_i]));
    v_log := v_log || pg_temp.qa_l('U14b' || v_i, 'ลิงก์เดียวกันแต่ตกแต่งต่างกัน → 23505 + id คลิปแรกใน detail',
      pg_temp.qa_st(v_r) = '23505' and split_part(v_r, '|', 2) = v_id::text, left(v_r, 90));
  end loop;
  v_r := pg_temp.qa_cap(v_shop2, 'reference_clip', 'ร้านอื่นลิงก์เดียวกัน', $e$p_url => 'https://www.tiktok.com/@shopx/video/7000000000000000099', p_hook_text => 'h'$e$);
  v_log := v_log || pg_temp.qa_l('U14c', 'ร้านอื่นบันทึกลิงก์เดียวกันได้ (unique ต่อร้าน)', pg_temp.qa_st(v_r) = 'OK', left(v_r, 80));
  v_r := pg_temp.qa_cap(v_shop, 'reference_clip', 'ไม่มี hook', $e$p_url => 'https://qa-0158.invalid/nohook'$e$);
  v_log := v_log || pg_temp.qa_l('U15', 'reference_clip ไม่มี hook_text → 22023 · ไม่มี url → 22023',
    pg_temp.qa_st(v_r) = '22023' and pg_temp.qa_st(pg_temp.qa_cap(v_shop, 'reference_clip', 'ไม่มี url', $e$p_hook_text => 'h'$e$)) = '22023');

  ------------------------------------------------------------------------------------------------
  -- N. ตัวเลข: ค่าย่อ/ประมาณ · 0 · null · ลบ · ขอบ
  ------------------------------------------------------------------------------------------------
  v_r := pg_temp.qa_cap(v_shop, 'reference_clip', 'ยอด 16K ประมาณ', $e$p_url => 'https://qa-0158.invalid/n1', p_hook_text => 'h', p_views => 16000, p_account_followers => 5000, p_saves => 800, p_likes => 1200, p_metrics_approx => true$e$);
  v_id := nullif(split_part(v_r, '|', 2), '')::uuid;
  select * into v_row from analytics.v_content_signal where id = v_id;
  v_log := v_log || pg_temp.qa_l('N1', 'views 16000 + flag ประมาณ: เก็บ 16000 เป๊ะ · metrics_approx=true · mass_ratio 3.2 → mass · save_rate 0.05',
    v_row.views = 16000 and v_row.metrics_approx and v_row.mass_ratio = 3.2 and v_row.mass_label = 'mass' and v_row.save_rate = 0.05, 'ratio=' || coalesce(v_row.mass_ratio::text, 'null') || ' label=' || coalesce(v_row.mass_label, 'null'));
  v_r := pg_temp.qa_cap(v_shop, 'reference_clip', 'ยอดศูนย์ followers ศูนย์', $e$p_url => 'https://qa-0158.invalid/n2', p_hook_text => 'h', p_views => 0, p_account_followers => 0, p_saves => 0$e$);
  select * into v_row from analytics.v_content_signal where id = nullif(split_part(v_r, '|', 2), '')::uuid;
  v_log := v_log || pg_temp.qa_l('N2', 'views=0 followers=0 รับได้ เก็บ 0 (ไม่ใช่ null) · ไม่หารศูนย์ · label unknown · mass_ratio/save_rate null',
    pg_temp.qa_st(v_r) = 'OK' and v_row.views = 0 and v_row.account_followers = 0 and v_row.mass_label = 'unknown' and v_row.mass_ratio is null and v_row.save_rate is null, left(v_r, 80));
  v_r := pg_temp.qa_cap(v_shop, 'reference_clip', 'ไม่เห็นยอดเลย', $e$p_url => 'https://qa-0158.invalid/n3', p_hook_text => 'h'$e$);
  select * into v_row from analytics.v_content_signal where id = nullif(split_part(v_r, '|', 2), '')::uuid;
  v_log := v_log || pg_temp.qa_l('N3', 'ตัวเลขว่าง (null) รับได้ · เก็บ null ไม่แปลงเป็น 0 · metrics_approx=false · label unknown',
    pg_temp.qa_st(v_r) = 'OK' and v_row.views is null and v_row.likes is null and v_row.account_followers is null and not v_row.metrics_approx and v_row.mass_label = 'unknown', left(v_r, 80));
  v_n := 0; v_s := '';
  foreach v_r in array v_cols loop
    if left(pg_temp.qa_cap(v_shop, 'craft_moment', 'neg ' || v_r, v_r || ' => -1'), 5) <> '22023' then v_n := v_n + 1; v_s := v_s || v_r || ' '; end if;
    if left(pg_temp.qa_cap(v_shop, 'craft_moment', 'over ' || v_r, v_r || ' => 10000000001'), 5) <> '22023' then v_n := v_n + 1; v_s := v_s || v_r || '(over) '; end if;
    if pg_temp.qa_st(pg_temp.qa_cap(v_shop, 'craft_moment', 'edge ' || v_r, v_r || ' => 10000000000')) <> 'OK' then v_n := v_n + 1; v_s := v_s || v_r || '(edge) '; end if;
  end loop;
  v_log := v_log || pg_temp.qa_l('N4', 'ทั้ง 6 คอลัมน์ตัวเลข: -1 → 22023 · 10^10+1 → 22023 · 10^10 พอดี ผ่าน', v_n = 0, v_s);
  v_r := pg_temp.qa_cap(v_shop, 'craft_moment', 'bigint overflow', 'p_views => 9223372036854775808');
  v_r2 := pg_temp.qa_cap(v_shop, 'craft_moment', 'NaN', $e$p_views => 'NaN'$e$);
  v_log := v_log || pg_temp.qa_l('N5', 'เกิน bigint / "NaN" ถูกปฏิเสธ (ไม่เก็บเงียบ)', pg_temp.qa_st(v_r) <> 'OK' and pg_temp.qa_st(v_r2) <> 'OK',
    'state=' || pg_temp.qa_st(v_r) || ' / ' || pg_temp.qa_st(v_r2) || ' (cast พังก่อนถึง RPC — ผู้ใช้เห็นข้อความดิบ ถ้า UI ไม่ตรวจเอง)');
  v_r := pg_temp.qa_cap(v_shop, 'craft_moment', 'approx null', 'p_metrics_approx => null::boolean');
  v_r2 := pg_temp.qa_cap(v_shop, 'craft_moment', 'approx ไม่มีเลข', 'p_metrics_approx => true');
  -- [แก้รอบ 2 ตาม QA note 4] เดิม: approx=true ไม่มีตัวเลข ผ่านได้ (N6b NOTE) · ตอนนี้ RPC 22023 + CHECK ปฏิเสธ
  v_log := v_log || pg_temp.qa_l('N6', 'metrics_approx = null → เก็บ false · approx=true แต่ไม่มีตัวเลขสักช่อง → 22023',
    pg_temp.qa_st(v_r) = 'OK' and left(pg_temp.qa_st(v_r2), 5) = '22023'
    and (select metrics_approx from analytics.content_signal where id = nullif(split_part(v_r, '|', 2), '')::uuid) is false,
    left(v_r, 60) || ' / ' || left(v_r2, 60));
  v_log := v_log || pg_temp.qa_l('N6b', 'flag ประมาณโดยไม่มีตัวเลขเลย ถูกปฏิเสธที่ CHECK ด้วย (insert ตรง 23514)',
    left(pg_temp.qa_try($e$insert into analytics.content_signal (shop_id, kind, source, seen_on, summary, metrics_approx) select id, 'craft_moment', 'owner', current_date, 'qa approx direct', true from public.shop limit 1$e$), 5) = '23514');
  v_n := 0;
  foreach v_s in array array['p_duration_sec => 0', 'p_duration_sec => -5', 'p_duration_sec => 36001'] loop
    if left(pg_temp.qa_cap(v_shop, 'craft_moment', 'dur ' || v_s, v_s), 5) <> '22023' then v_n := v_n + 1; end if;
  end loop;
  foreach v_s in array array['p_duration_sec => 1', 'p_duration_sec => 36000', 'p_duration_sec => null::int'] loop
    if pg_temp.qa_st(pg_temp.qa_cap(v_shop, 'craft_moment', 'dur ok ' || v_s, v_s)) <> 'OK' then v_n := v_n + 1; end if;
  end loop;
  v_log := v_log || pg_temp.qa_l('N7', 'duration_sec: 0/-5/36001 ปฏิเสธ · 1/36000/null ผ่าน', v_n = 0, 'ผิด=' || v_n);
  v_n := 0;
  if left(pg_temp.qa_cap(v_shop, 'craft_moment', 'seen future', format('p_seen_on => %L::date', v_today + 1)), 5) <> '22023' then v_n := v_n + 1; end if;
  if left(pg_temp.qa_cap(v_shop, 'craft_moment', 'posted after seen', format('p_seen_on => %L::date, p_posted_on => %L::date', v_today - 1, v_today)), 5) <> '22023' then v_n := v_n + 1; end if;
  if left(pg_temp.qa_cap(v_shop, 'craft_moment', 'mseen future', format('p_metrics_seen_on => %L::date', v_today + 1)), 5) <> '22023' then v_n := v_n + 1; end if;
  if pg_temp.qa_st(pg_temp.qa_cap(v_shop, 'craft_moment', 'seen today BKK', format('p_seen_on => %L::date', v_today))) <> 'OK' then v_n := v_n + 1; end if;
  v_log := v_log || pg_temp.qa_l('N8', 'วัน: seen_on อนาคต / posted_on หลัง seen / metrics_seen_on อนาคต ปฏิเสธ · วันนี้ (เวลาไทย) ผ่าน', v_n = 0, 'ผิด=' || v_n);
  v_r := pg_temp.qa_cap(v_shop, 'craft_moment', E'ช่าง

  ขัด 💎 แหวน', '');
  v_log := v_log || pg_temp.qa_l('N9a', 'summary หลายบรรทัด/emoji: ยุบช่องว่างเป็นบรรทัดเดียว', pg_temp.qa_st(v_r) = 'OK'
    and exists (select 1 from analytics.content_signal where shop_id = v_shop and summary = 'ช่าง ขัด 💎 แหวน'), left(v_r, 80));
  v_log := v_log || pg_temp.qa_l('N9b', 'summary ว่าง / ช่องว่างล้วน → 22023 (ข้อความไทย)',
    left(pg_temp.qa_cap(v_shop, 'craft_moment', '', ''), 5) = '22023' and left(pg_temp.qa_cap(v_shop, 'craft_moment', '    ', ''), 5) = '22023');
  v_r := pg_temp.qa_cap(v_shop, 'craft_moment', E' 
	 ', '');
  v_r2 := pg_temp.qa_cap(v_shop, 'craft_moment', E'	', '');
  v_log := v_log || pg_temp.qa_l('N9c', 'summary เป็น tab/ขึ้นบรรทัดใหม่ล้วน → 22023 ข้อความไทย (ไม่หลุดไปถึง CHECK ของตาราง)',
    pg_temp.qa_st(v_r) = '22023' and pg_temp.qa_st(v_r2) = '22023', 'ได้ ' || pg_temp.qa_st(v_r) || '/' || pg_temp.qa_st(v_r2) || ' — btrim ตัดแค่ช่องว่าง ไม่ตัด tab/newline แล้ว regexp_replace ยุบเหลือช่องว่าง 1 ตัว ผ่านด่านความยาว 1-300 ไปตาย CHECK content_signal_summary_check (23514 + ข้อความดิบ)');
  v_log := v_log || pg_temp.qa_l('N9d', 'summary 301 ตัวปฏิเสธ · 300 ตัวผ่าน',
    left(pg_temp.qa_cap(v_shop, 'craft_moment', repeat('ก', 301), ''), 5) = '22023' and pg_temp.qa_st(pg_temp.qa_cap(v_shop, 'craft_moment', repeat('ก', 300), '')) = 'OK');
  v_n := 0;
  if left(pg_temp.qa_cap(v_shop, 'live_question', 'k1', ''), 5) <> '22023' then v_n := v_n + 1; end if;
  if left(pg_temp.qa_cap(v_shop, 'insight', 'k2', ''), 5) <> '22023' then v_n := v_n + 1; end if;
  if left(pg_temp.qa_cap(v_shop, 'trend', 'k3', ''), 5) <> '22023' then v_n := v_n + 1; end if;
  if left(pg_temp.qa_cap(v_shop, 'bogus', 'k4', ''), 5) <> '22023' then v_n := v_n + 1; end if;
  if left(pg_temp.qa_cap(v_shop, 'craft_moment', 'k5', 'p_source => ''hacker'''), 5) <> '22023' then v_n := v_n + 1; end if;
  if left(pg_temp.qa_cap(v_shop, 'craft_moment', 'k6', 'p_actor_role => ''ai'', p_source => ''owner'''), 5) <> '22023' then v_n := v_n + 1; end if;
  if pg_temp.qa_st(pg_temp.qa_cap(v_shop, 'craft_moment', 'k7', 'p_actor_role => ''ai'', p_source => ''ai_radar''')) <> 'OK' then v_n := v_n + 1; end if;
  if left(pg_temp.qa_cap(v_shop, 'craft_moment', 'k8', 'p_actor_role => null::text'), 5) <> '22023' then v_n := v_n + 1; end if;
  if left(pg_temp.qa_cap(null::uuid, 'craft_moment', 'k9', ''), 5) <> '22023' then v_n := v_n + 1; end if;
  if left(pg_temp.qa_cap(v_shop, 'insight', 'k10', format('p_origin_post_id => %L::uuid', gen_random_uuid())), 5) <> '22023' then v_n := v_n + 1; end if;
  v_log := v_log || pg_temp.qa_l('N10', 'kind/source/actor/shop ผิด · insight ผูกโพสต์ที่ไม่มี · AI อ้าง source=owner → ปฏิเสธ 22023 ครบ · AI + ai_radar ผ่าน', v_n = 0, 'เคสที่หลุด=' || v_n);

  -- ข้อความที่เป็น tab/newline ล้วนในช่อง hook_text (btrim ตัดแค่ช่องว่าง)
  v_r := pg_temp.qa_cap(v_shop, 'reference_clip', 'hook เป็น tab ล้วน', $e$p_url => 'https://qa-0158.invalid/tabhook', p_hook_text => E'\t'$e$);
  v_log := v_log || pg_temp.qa_l('N12', 'reference_clip ที่ hook_text เป็น tab ล้วน ควรถูกปฏิเสธ (hook ว่าง = ใช้ถอดโครงไม่ได้)', pg_temp.qa_st(v_r) <> 'OK',
    'DB รับ hook_text=tab 1 ตัว (CHECK length(btrim()) ผ่านเพราะ btrim ไม่ตัด tab) ผล=' || left(v_r, 50), 'NOTE');

  -- set_status
  v_id :=nullif(split_part(pg_temp.qa_cap(v_shop, 'craft_moment', 'status test', ''), '|', 2), '')::uuid;
  v_err := array[
    format($s$select analytics.content_signal_set_status(%L::uuid, %L::uuid, 'rejected', 'x', null, 'ai')$s$, v_shop, v_id),
    format($s$select analytics.content_signal_set_status(%L::uuid, %L::uuid, 'deferred', 'x', null, 'owner')$s$, v_shop, v_id),
    format($s$select analytics.content_signal_set_status(%L::uuid, %L::uuid, 'deferred', 'x', %L::date, 'owner')$s$, v_shop, v_id, v_today - 1),
    format($s$select analytics.content_signal_set_status(%L::uuid, %L::uuid, 'picked', 'x', null, 'owner')$s$, v_shop, v_id),
    format($s$select analytics.content_signal_set_status(%L::uuid, %L::uuid, 'new', 'x', %L::date, 'owner')$s$, v_shop, v_id, v_today),
    format($s$select analytics.content_signal_set_status(%L::uuid, %L::uuid, 'rejected', 'x', null, 'owner')$s$, v_shop2, v_id),
    format($s$select analytics.content_signal_set_status(%L::uuid, %L::uuid, 'deferred', 'ไว้ก่อน', %L::date, 'owner')$s$, v_shop, v_id, v_today),
    format($s$select analytics.content_signal_set_status(%L::uuid, %L::uuid, 'new', null, null, 'owner')$s$, v_shop, v_id)
  ];
  v_pairs := array['42501', '22023', '22023', '22023', '22023', '22023', 'OK', 'OK'];
  v_n := 0; v_s := '';
  for v_i in 1 .. array_length(v_err, 1) loop
    v_r := pg_temp.qa_try(v_err[v_i]);
    if left(v_r, 5) is distinct from left(v_pairs[v_i], 5) and v_r is distinct from v_pairs[v_i] then
      v_n := v_n + 1; v_s := v_s || '#' || v_i || '=' || left(v_r, 70) || ' ; ';
    end if;
  end loop;
  if (select status_reason from analytics.content_signal where id = v_id) is not null
     or (select review_on from analytics.content_signal where id = v_id) is not null then
    v_n := v_n + 1; v_s := v_s || 'new ไม่ล้าง reason/review_on ; ';
  end if;
  v_log := v_log || pg_temp.qa_l('N11', 'set_status: AI→42501 · deferred ไม่มีวัน/วันอดีต · picked · review_on กับ new · ข้ามร้าน → ปฏิเสธ · deferred วันนี้ผ่าน · กลับ new ล้าง reason/วัน', v_n = 0, v_s);

  ------------------------------------------------------------------------------------------------
  -- LH. live_host_upsert
  ------------------------------------------------------------------------------------------------
  v_n := 0;
  if left(pg_temp.qa_try(format($s$select analytics.live_host_upsert(%L::uuid, 'ใหม่', 'โฮสต์ C', true, null, 'ai')$s$, v_shop)), 5) <> '42501' then v_n := v_n + 1; end if;
  if left(pg_temp.qa_try(format($s$select analytics.live_host_upsert(%L::uuid, '  หมีเนย  ', 'โฮสต์ Z')$s$, v_shop)), 5) <> '23505' then v_n := v_n + 1; end if;
  if left(pg_temp.qa_try(format($s$select analytics.live_host_upsert(%L::uuid, 'ใหม่ Z', 'โฮสต์ a')$s$, v_shop)), 5) <> '23505' then v_n := v_n + 1; end if;
  if left(pg_temp.qa_try(format($s$select analytics.live_host_upsert(%L::uuid, repeat('ก', 81), 'โฮสต์ Z')$s$, v_shop)), 5) <> '22023' then v_n := v_n + 1; end if;
  if left(pg_temp.qa_try(format($s$select analytics.live_host_upsert(%L::uuid, 'ใหม่ Z', repeat('ก', 41))$s$, v_shop)), 5) <> '22023' then v_n := v_n + 1; end if;
  if left(pg_temp.qa_try(format($s$select analytics.live_host_upsert(%L::uuid, '   ', 'โฮสต์ Z')$s$, v_shop)), 5) <> '22023' then v_n := v_n + 1; end if;
  if left(pg_temp.qa_try(format($s$select analytics.live_host_upsert(%L::uuid, 'ใหม่ Z', 'โฮสต์ Z', null)$s$, v_shop)), 5) <> '22023' then v_n := v_n + 1; end if;
  if left(pg_temp.qa_try(format($s$select analytics.live_host_upsert(%L::uuid, 'แก้ข้ามร้าน', 'โฮสต์ Y', true, %L::uuid)$s$, v_shop, v_hx)), 5) <> '22023' then v_n := v_n + 1; end if;
  if pg_temp.qa_try(format($s$select analytics.live_host_upsert(%L::uuid, '🌟 พี่ฟ้า 😀', 'โฮสต์ ✨')$s$, v_shop)) <> 'OK' then v_n := v_n + 1; end if;
  if (select display_name from analytics.live_host where id = v_hx) <> 'qa host X' then v_n := v_n + 1; end if;
  v_log := v_log || pg_temp.qa_l('LH1', 'live_host_upsert: AI→42501 · ชื่อ/ป้ายซ้ำ (trim, ตัวพิมพ์) 23505 · ยาวเกิน/ว่าง/is_active null 22023 · แก้โฮสต์ร้านอื่นไม่ได้ (แถวเดิมไม่เปลี่ยน) · emoji ผ่าน', v_n = 0, 'ผิด=' || v_n);

  ------------------------------------------------------------------------------------------------
  -- K. hook ที่ย้ายมา 26 แถว + กติกา A/B ของ RPC
  ------------------------------------------------------------------------------------------------
  select count(*), coalesce(sum(jsonb_array_length(clip_brief -> 'hooks')), 0) into v_n, v_n2
    from analytics.step_artifact where jsonb_typeof(clip_brief -> 'hooks') = 'array';
  v_log := v_log || pg_temp.qa_l('K1', 'artifact ที่มี hooks = ' || v_n || ' ตัว · รวม hook ใน JSON = ' || v_n2 || ' · แถว legacy ใน content_hook เท่ากัน',
    (select count(*) from analytics.content_hook where legacy_json_id is not null) = v_n2 and v_n2 = 26, 'legacy=' || (select count(*) from analytics.content_hook where legacy_json_id is not null));
  select count(*), min(c), max(c) into v_n, v_i, v_n2 from (
    select a.id, count(ch.id) c from analytics.step_artifact a
      left join analytics.content_hook ch on ch.step_id = a.step_id and ch.legacy_json_id is not null
     where jsonb_typeof(a.clip_brief -> 'hooks') = 'array' group by a.id) x;
  v_log := v_log || pg_temp.qa_l('K2', 'นับ hook ต่อ artifact = 2 ทุกตัว', v_i = 2 and v_n2 = 2, 'artifact=' || v_n || ' min=' || v_i || ' max=' || v_n2);
  select count(*) into v_n
    from analytics.step_artifact a
    cross join lateral jsonb_array_elements(case when jsonb_typeof(a.clip_brief -> 'hooks') = 'array' then a.clip_brief -> 'hooks' else '[]'::jsonb end) with ordinality as h(elem, ord)
    left join analytics.content_hook ch on ch.step_id = a.step_id and ch.legacy_json_id = coalesce(nullif(btrim(h.elem ->> 'id'), ''), 'pos' || h.ord)
   where ch.id is null
      or ch.text is distinct from btrim(h.elem ->> 'line')
      or ch.hook_type_raw is distinct from (h.elem ->> 'hook_type')
      or ch.origin <> 'ours' or ch.shop_id <> a.shop_id
      or ch.label is distinct from (case when jsonb_array_length(a.clip_brief -> 'hooks') = 2 then case h.ord when 1 then 'A' else 'B' end end)
      or (ch.hook_type is not null and ch.hook_type is distinct from ch.hook_type_raw);
  v_log := v_log || pg_temp.qa_l('K3', 'ทุก hook: ข้อความตรง JSON เดิม (หลัง trim) · hook_type_raw = ค่าเดิม · label ลำดับ 1→A 2→B · origin ours · shop ตรง · hook_type ที่ไม่ null = raw', v_n = 0, 'ไม่ตรง=' || v_n);
  select count(*) filter (where hook_type is null), count(*) filter (where hook_type is not null and hook_type_raw is not null) into v_n, v_n2
    from analytics.content_hook where legacy_json_id is not null;
  v_log := v_log || pg_temp.qa_l('K4', 'hook_type ของ legacy: ติดป้าย 8 ประเภท ' || v_n2 || ' แถว · ค้าง null ' || v_n || ' แถว (ค่า free-form เก็บใน hook_type_raw)',
    v_n + v_n2 = 26, '(rollup ต้องไม่นับ null — R19)', 'NOTE');
  select count(*) into v_n from analytics.step_artifact a
   where jsonb_typeof(a.clip_brief -> 'chosen_hook_id') = 'string'
     and not exists (select 1 from analytics.content_hook ch where ch.step_id = a.step_id and ch.legacy_json_id = a.clip_brief ->> 'chosen_hook_id');
  v_log := v_log || pg_temp.qa_l('K5', 'chosen_hook_id ใน clip_brief ยังชี้ hook ที่ย้ายมาได้ทุก artifact', v_n = 0, 'ชี้ไม่เจอ=' || v_n);
  select count(*) into v_n from (select step_id from analytics.content_hook where label is not null group by step_id
                                   having count(*) filter (where label = 'A') <> 1 or count(*) filter (where label = 'B') > 1) x;
  v_log := v_log || pg_temp.qa_l('K6', 'ไม่มี step ที่ป้าย A ซ้ำ/ขาด หรือ B ซ้ำ', v_n = 0, 'step ผิด=' || v_n);
  select count(*) into v_n from analytics.content_hook a join analytics.content_hook b on a.step_id = b.step_id and a.label = 'A' and b.label = 'B'
   where a.hook_type is not null and a.hook_type = b.hook_type;
  v_log := v_log || pg_temp.qa_l('K7', 'ไม่มี step ที่ A/B ประเภทเดียวกัน (ด่าน "≥2 ประเภทต่างกัน")', v_n = 0, 'step ที่ซ้ำประเภท=' || v_n, 'NOTE');

  -- RPC กติกา A/B บน step ใหม่ (ไม่มี hook)
  select s.id into v_step from analytics.campaign_step s where s.shop_id = v_shop and not exists (select 1 from analytics.content_hook h where h.step_id = s.id) order by s.created_at, s.id limit 1;
  select h.step_id into v_step_l from analytics.content_hook h where h.legacy_json_id is not null order by h.step_id limit 1;
  if v_step is not null then
    v_n := 0;
    if pg_temp.qa_try(format($s$select analytics.content_hook_upsert(%L::uuid, %L::uuid, 'A', 'hook ทดสอบ A', 'question')$s$, v_shop, v_step)) <> 'OK' then v_n := v_n + 1; end if;
    if left(pg_temp.qa_try(format($s$select analytics.content_hook_upsert(%L::uuid, %L::uuid, 'B', 'hook ทดสอบ B', 'question')$s$, v_shop, v_step)), 5) <> '22023' then v_n := v_n + 1; end if;
    if pg_temp.qa_try(format($s$select analytics.content_hook_upsert(%L::uuid, %L::uuid, 'B', 'hook ทดสอบ B', 'fact', null, 'ai')$s$, v_shop, v_step)) <> 'OK' then v_n := v_n + 1; end if;
    -- [แก้รอบ 2 ตาม S-M3 ข] ป้าย A มีอยู่แล้ว + ไม่ส่ง p_id → 23505 · ส่ง p_id ของ A แล้วตั้งประเภทเท่า B → 22023 (ด่านประเภทยังทำงาน)
    if left(pg_temp.qa_try(format($s$select analytics.content_hook_upsert(%L::uuid, %L::uuid, 'A', 'แก้ A เป็นประเภทเดียวกับ B', 'fact')$s$, v_shop, v_step)), 5) <> '23505' then v_n := v_n + 1; end if;
    if left(pg_temp.qa_try(format($s$select analytics.content_hook_upsert(%L::uuid, %L::uuid, 'A', 'แก้ A เป็นประเภทเดียวกับ B', 'fact', null, 'owner', %L::uuid)$s$, v_shop, v_step,
         (select id from analytics.content_hook where step_id = v_step and label = 'A'))), 5) <> '22023' then v_n := v_n + 1; end if;
    if left(pg_temp.qa_try(format($s$select analytics.content_hook_upsert(%L::uuid, %L::uuid, 'C', 'x', 'fact')$s$, v_shop, v_step)), 5) <> '22023' then v_n := v_n + 1; end if;
    if left(pg_temp.qa_try(format($s$select analytics.content_hook_upsert(%L::uuid, %L::uuid, 'A', repeat('ก', 501), 'process')$s$, v_shop, v_step)), 5) <> '22023' then v_n := v_n + 1; end if;
    if left(pg_temp.qa_try(format($s$select analytics.content_hook_upsert(%L::uuid, %L::uuid, 'A', 'x', null)$s$, v_shop, v_step)), 5) <> '22023' then v_n := v_n + 1; end if;
    if left(pg_temp.qa_try(format($s$select analytics.content_hook_upsert(%L::uuid, %L::uuid, 'A', 'x', 'reveal')$s$, v_shop, v_step)), 5) <> '22023' then v_n := v_n + 1; end if;
    if left(pg_temp.qa_try(format($s$select analytics.content_hook_upsert(%L::uuid, %L::uuid, 'A', 'x', 'process')$s$, v_shop2, v_step)), 5) <> '22023' then v_n := v_n + 1; end if;
    if (select generated_by from analytics.content_hook where step_id = v_step and label = 'B') <> 'ai' then v_n := v_n + 1; end if;
    if pg_temp.qa_try(format($s$select analytics.content_hook_upsert(%L::uuid, %L::uuid, null, 'ไม่มีป้าย 1', 'story')$s$, v_shop, v_step)) <> 'OK'
       or pg_temp.qa_try(format($s$select analytics.content_hook_upsert(%L::uuid, %L::uuid, null, 'ไม่มีป้าย 2', 'story')$s$, v_shop, v_step)) <> 'OK' then v_n := v_n + 1; end if;
    v_log := v_log || pg_temp.qa_l('K8', 'RPC hook A/B: คนละประเภท · ป้ายนอก A/B · ข้อความ >500 · type null/นอก 8 ค่า · ข้ามร้าน ปฏิเสธ · AI → generated_by=ai · hook ไม่มีป้ายซ้ำประเภทได้', v_n = 0, 'ผิด=' || v_n);
  else
    v_log := v_log || E'[SKIP] K8 ไม่มี step ว่างสำหรับทดสอบ\n';
  end if;
  if v_step_l is not null then
    select h.id, h.text, h.legacy_json_id into v_row from analytics.content_hook h where h.step_id = v_step_l and h.label = 'A';
    -- [แก้รอบ 2 ตาม S-M3 ข / QA K9] เดิม: AI ทับ hook เดิมเงียบๆ (NOTE) · ตอนนี้ปฏิเสธ 23505 และ hook เดิมต้องไม่ถูกแตะ
    v_r := pg_temp.qa_try(format($s$select analytics.content_hook_upsert(%L::uuid, %L::uuid, 'A', 'ข้อความใหม่ทับ hook เดิม', 'question', null, 'ai')$s$, v_shop, v_step_l));
    v_log := v_log || pg_temp.qa_l('K9', 'content_hook_upsert ป้าย A บน step ที่มี hook legacy (ไม่ส่ง p_id) → 23505 · hook เดิมไม่ถูกทับ',
      left(v_r, 5) = '23505' and exists (select 1 from analytics.content_hook h where h.id = v_row.id and h.text = v_row.text and h.legacy_json_id = v_row.legacy_json_id), left(v_r, 90));
  end if;

  ------------------------------------------------------------------------------------------------
  -- W. v_live_log_recent (view ใหม่ที่หน้า UI รอบ 2 จะใช้) + จบ: view เดิมยังแถวเดิม
  ------------------------------------------------------------------------------------------------
  perform analytics.live_session_upsert(v_shop, v_today, time '21:00', time '01:00', 77, null, 'admin_ui', v_ha);
  select count(*) into v_n from analytics.v_live_log_recent where shop_id = v_shop;
  v_log := v_log || pg_temp.qa_l('W1', 'v_live_log_recent: 1 ร้าน = 7 แถว (วันไทยวันนี้ย้อน 6 วัน) · ร้านที่ไม่มี log ก็ได้ 7 แถว logged=false',
    v_n = 7 and (select min(live_date) from analytics.v_live_log_recent where shop_id = v_shop) = v_today - 6
    and (select max(live_date) from analytics.v_live_log_recent where shop_id = v_shop) = v_today
    and (select count(*) from analytics.v_live_log_recent where shop_id = v_shop2) = 7
    and (select count(*) from analytics.v_live_log_recent where shop_id = v_shop2 and logged) = 0, 'n=' || v_n);
  select * into v_row from analytics.v_live_log_recent where shop_id = v_shop and live_date = v_today;
  v_log := v_log || pg_temp.qa_l('W2', 'แถววันนี้: logged · host_public_label=โฮสต์ A · เวลาไทย 21:00→01:00 (ข้ามเที่ยงคืน) · peak 77',
    v_row.logged and v_row.host_public_label = 'โฮสต์ A' and v_row.started_time_th = '21:00' and v_row.ended_time_th = '01:00' and v_row.peak_viewers = 77,
    coalesce(v_row.started_time_th, 'null') || '→' || coalesce(v_row.ended_time_th, 'null'));
  v_log := v_log || pg_temp.qa_l('W3', 'จำนวนแถวที่ logged ใน 7 วัน = จำนวนแถว log จริงในช่วงเดียวกัน (ไม่ซ้ำ/ไม่ตกหล่น)',
    (select count(*) from analytics.v_live_log_recent where shop_id = v_shop and logged) = (select count(*) from analytics.live_session_log where shop_id = v_shop and live_date between v_today - 6 and v_today));
  v_log := v_log || pg_temp.qa_l('W4', 'v_live_night ยังเป็น 1 แถว/แถว log · แถวทดสอบ (ไม่มีออเดอร์) ได้ 0 ไม่ใช่ null',
    (select count(*) from analytics.v_live_night) = (select count(*) from analytics.live_session_log)
    and not exists (select 1 from analytics.v_live_night where live_date between date '2019-01-01' and date '2019-12-31' and (day_orders is distinct from 0 or day_revenue is distinct from 0 or live_sku_orders is distinct from 0)));

  -- สรุป
  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_ok   := (length(v_log) - length(replace(v_log, '[OK]', ''))) / 4;
  v_note := (length(v_log) - length(replace(v_log, '[NOTE]', ''))) / 6;
  raise exception E'%\n=== สรุป: [OK] % · [FAIL] % · [NOTE] % — raise นี้บังคับ ROLLBACK ทั้งหมด ===', v_log, v_ok, v_fail, v_note;
end
$qa$;
