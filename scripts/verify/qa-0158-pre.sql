-- scripts/verify/qa-0158-pre.sql  (QA R2-D2, 6 ต.ค. 69) — baseline "ก่อน" migration 0158
--
-- ต้องรันเป็น "ต้นไฟล์" ของ dry-run เดียวกัน: pre + migration 0158 + qa-0158-extra.sql
--   cat scripts/verify/qa-0158-pre.sql supabase/migrations/0158_content_signal_hook_host.sql \
--       scripts/verify/qa-0158-extra.sql > tmp.sql && node scripts/run-sql.mjs tmp.sql      (ไม่ใส่ --commit = ROLLBACK เสมอ)
-- ทำอะไร: (1) เรียก live_session_upsert v1 (ตัวที่ live อยู่) ด้วยชุดพารามิเตอร์ที่แอปส่งจริง แล้วเก็บ "ลายเซ็นผล" +
-- "ข้อความ/sqlstate ของ error" ไว้ใน GUC ระดับทรานแซกชัน (2) เก็บ baseline ของ v_live_night / step_artifact / ฟังก์ชัน snapshot
-- ไม่แตะ DB จริง: ทุกแถวเขียนในทรานแซกชันที่ถูก ROLLBACK · ไม่มี raise ที่นี่ (ให้ extra เป็นคนสรุป)

create or replace function pg_temp.qa_try(p_sql text) returns text
 language plpgsql as $q$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate || ':' || sqlerrm;
end $q$;

-- ลายเซ็นผลของแถว log ที่ไม่ขึ้นกับ "วัน" (ใช้ offset จากเที่ยงคืนไทยของ live_date) — เทียบ v1 กับ v2 ข้ามวันที่ได้
create or replace function pg_temp.qa_sig(p_id uuid) returns text
 language sql as $q$
  select concat_ws('|',
    extract(epoch from l.started_at - (l.live_date::timestamp at time zone 'Asia/Bangkok'))::text,
    extract(epoch from l.ended_at - (l.live_date::timestamp at time zone 'Asia/Bangkok'))::text,
    coalesce(l.peak_viewers::text, '~'), coalesce(l.note, '~'), l.source,
    (l.created_by is null)::text, (l.updated_by is null)::text)
  from analytics.live_session_log l where l.id = p_id
$q$;

do $qapre$
declare
  v_shop  uuid;
  v_rest  text[];
  v_err   text[];
  v_i     int;
  v_id    uuid;
  v_id2   uuid;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);

  if (select count(*) from public.shop) <> 1 then
    raise exception 'qa-0158-pre: ต้องมีร้านเดียวใน public.shop';
  end if;
  select id into v_shop from public.shop;
  perform set_config('qa.shop', v_shop::text, true);

  -- baseline ก่อนเขียนอะไรทั้งสิ้น
  perform set_config('qa.live_orig', (
    select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, shop_id, live_date, started_at, ended_at,
             peak_viewers, note, source, created_by, updated_by, created_at, updated_at), E'\n' order by id), ''))
    from analytics.live_session_log), true);
  perform set_config('qa.art', (
    select count(*)::text || ':' || md5(coalesce(string_agg(concat_ws('|', id, step_id, status, content_body,
             clip_brief::text, updated_at), E'\n' order by id), ''))
    from analytics.step_artifact), true);
  perform set_config('qa.snapfn', (
    select md5(pg_get_functiondef(p.oid)) from pg_proc p
     where p.pronamespace = 'analytics'::regnamespace and p.proname = 'live_night_snapshot_capture'), true);

  -- ชุดพารามิเตอร์ "แบบที่ lib/actions/live-metrics.ts ส่งจริง" (named-arg p_start/p_end เป็นสตริง HH:MM · p_note null เมื่อว่าง)
  v_rest := array[
    $s$p_start => '20:00', p_end => '23:00', p_peak => 300, p_note => '  หมายเหตุ  ', p_source => 'admin_ui'$s$,
    $s$p_start => '22:00', p_end => '01:00', p_peak => null, p_note => null, p_source => 'owner_chat'$s$,
    $s$p_start => '20:00', p_end => '23:00', p_peak => 0, p_note => '', p_source => 'backfill'$s$,
    $s$placeholder-replaced-below$s$,
    $s$p_start => '20:00', p_end => '23:00'$s$,
    $s$p_start => '19:45', p_end => '23:10', p_peak => 2147483647, p_note => '🔥ไลฟ์คืนนี้ 💎 "quote" ''single''', p_source => 'admin_ui'$s$
  ];
  -- แถวที่ 4: note ไทย 500 ตัวพอดี (ขอบ) ต้องต่อสตริงด้วย quote_literal
  v_rest[4] :=$s$p_start => '20:30', p_end => '08:29', p_peak => 120, p_note => $s$ || quote_literal(repeat('ก', 500)) || $s$, p_source => 'owner_chat'$s$;

  for v_i in 1 .. array_length(v_rest, 1) loop
    execute format('select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => %L::date, %s)',
                   v_shop, '2019-03-0' || v_i, v_rest[v_i]) into v_id;
    perform set_config('qa.v1h' || v_i, pg_temp.qa_sig(v_id), true);
  end loop;
  -- upsert ซ้ำคืนเดิม (วันที่ 7): ต้อง id เดิม ไม่เพิ่มแถว
  execute format('select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date ''2019-03-07'', p_start => ''20:00'', p_end => ''23:00'', p_peak => 100, p_note => ''รอบแรก'', p_source => ''admin_ui'')', v_shop) into v_id;
  execute format('select analytics.live_session_upsert(p_shop => %L::uuid, p_live_date => date ''2019-03-07'', p_start => ''20:15'', p_end => ''23:45'', p_peak => 450, p_note => null, p_source => ''admin_ui'')', v_shop) into v_id2;
  perform set_config('qa.v1h7', (v_id = v_id2)::text || '/' || pg_temp.qa_sig(v_id2) || '/n=' ||
    (select count(*) from analytics.live_session_log where shop_id = v_shop and live_date = date '2019-03-07'), true);

  -- error parity: sqlstate + ข้อความของ v1 (ใช้วันที่ตายตัว 2019-03-20)
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
  for v_i in 1 .. array_length(v_err, 1) loop
    perform set_config('qa.v1e' || v_i, pg_temp.qa_try(format(v_err[v_i], v_shop)), true);
  end loop;

  -- baseline view ที่ dashboard/weekly brief อ่าน (หลังเขียนแถว QA ของ v1 แล้ว — แถวพวกนั้นไม่มีออเดอร์จึงเทียบกันได้ตรงๆ)
  perform set_config('qa.vln_cols', (
    select md5(string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' order by attnum))
      from pg_attribute where attrelid = 'analytics.v_live_night'::regclass and attnum > 0 and not attisdropped), true);
  perform set_config('qa.vln_rows', (
    select count(*)::text || ':' || md5(coalesce(string_agg(t::text, E'\n' order by t.shop_id, t.live_date), ''))
      from analytics.v_live_night t), true);
  perform set_config('qa.log_cnt', (select count(*)::text from analytics.live_session_log), true);
end
$qapre$;
