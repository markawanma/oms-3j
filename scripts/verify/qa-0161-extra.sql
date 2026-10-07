-- scripts/verify/qa-0161-extra.sql  (QA R2-D2 · 7 ต.ค. 69 · เคส "ต้องไม่พัง" เสริม verify-0161 — ของใหม่ใส่ของเก่าภายใต้ role จริง)
--
-- self-rolling-back do-block (3j-migration-traps #11): ทุกเคสเก็บผลลง v_log แล้ว raise exception ปิดท้ายเสมอ ⇒ ROLLBACK ทั้งหมด · DB จริงไม่ขยับ
-- ทุกการเขียนทำผ่าน RPC/ตารางของ "ร้านทดสอบ qa-0161" ที่สร้างในทรานแซกชัน · ส่วนที่แตะร้านจริงเป็น SELECT ล้วน
-- ทุก call ของแอปรันภายใต้ `set local role service_role` จริง (pg_temp.vq) ด้วยพารามิเตอร์ชุดเดียวกับ lib/actions/content.ts
--
-- รัน 2 โหมด แล้ว diff บรรทัด [SIG] — พิสูจน์ "ผลเหมือนก่อน 0161" โดยไม่ต้องเชื่อความจำ:
--   ก่อน 0161:  node scripts/run-sql.mjs scripts/verify/qa-0161-extra.sql                      (เคสที่ต้องมี 0161 จะ [SKIP])
--   หลัง 0161:  cat supabase/migrations/0161_*.sql scripts/verify/qa-0161-extra.sql > tmp.sql && node scripts/run-sql.mjs tmp.sql
--   เทียบ:      diff <(grep '^\[SIG\]' ก่อน.txt) <(grep '^\[SIG\]' หลัง.txt)   ต้องไม่ต่าง
-- [SIG] = ค่าที่ไม่ขึ้นกับ uuid/เวลาจริง (อายุเป็นวัน · ตัวเลข · ธง · source) · [NOTE] = ตัวเลขที่ต้องรายงาน ไม่ใช่ pass/fail

-- ---------- helper ----------
create or replace function pg_temp.vb(p_id text, p_what text, p_cond boolean, p_detail text default '') returns text
 language sql as $vb$
  select '[' || case when p_cond is true then 'OK' else 'FAIL' end || '] ' || p_id || ' ' || p_what
         || case when p_detail <> '' then ' → ' || p_detail else '' end || E'\n'
$vb$;

create or replace function pg_temp.sig(p_id text, p_val text) returns text
 language sql as $sg$ select '[SIG] ' || p_id || '=' || coalesce(p_val, '<null>') || E'\n' $sg$;

create or replace function pg_temp.note(p_id text, p_val text) returns text
 language sql as $nt$ select '[NOTE] ' || p_id || ' ' || coalesce(p_val, '<null>') || E'\n' $nt$;

-- รัน SQL ที่คืนค่าเดียวภายใต้ role จริง · error → 'ERR:<sqlstate>:<msg>' · reset role ทุกทาง
create or replace function pg_temp.vq(p_role text, p_sql text) returns text
 language plpgsql as $vq$
declare v_out text;
begin
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v_out;
  exception when others then
    execute 'reset role';
    return 'ERR:' || sqlstate || ':' || left(sqlerrm, 160);
  end;
  execute 'reset role';
  return coalesce(v_out, '<null>');
end $vq$;

-- signature ของ query ใดๆ ภายใต้ role: จำนวนแถว : md5 ของข้อความแถว (เรียงข้อความ)
create or replace function pg_temp.qsig(p_role text, p_query text) returns text
 language sql as $qs$
  select pg_temp.vq(p_role, format('select count(*)::text || '':'' || md5(coalesce(string_agg(t::text, E''\n'' order by t::text), '''')) from (%s) t', p_query))
$qs$;

create or replace function pg_temp.colsig(p_rel text) returns text
 language sql as $cs$
  select count(*)::text || ':' || md5(coalesce(string_agg(column_name || '/' || data_type, ',' order by ordinal_position), ''))
    from information_schema.columns where table_schema = 'analytics' and table_name = p_rel
$cs$;

create or replace function pg_temp.mkpost(p_shop uuid, p_days_ago int, p_ext text default null) returns uuid
 language plpgsql as $mp$
declare v_ext text := coalesce(p_ext, 'qa161-' || substr(gen_random_uuid()::text, 1, 12));
begin
  return analytics.content_post_upsert(p_shop, 'tiktok', v_ext, 'https://www.tiktok.com/@qa0161/video/' || v_ext,
                                       now() - make_interval(days => p_days_ago), null, null, null);
end $mp$;

create or replace function pg_temp.mkmet(p_post uuid, p_cap date, p_view bigint, p_like bigint, p_comment bigint, p_save bigint, p_share bigint)
 returns uuid language plpgsql as $mm$
declare v_id uuid;
begin
  insert into analytics.content_post_metric (shop_id, post_id, captured_on, age_days, view_count, like_count, comment_count, save_count, share_count,
                                             source, sources, is_regression)
  select p.shop_id, p.id, p_cap, p_cap - p.posted_date_th, p_view, p_like, p_comment, p_save, p_share, 'manual', array['manual'], false
    from analytics.content_post p where p.id = p_post
  returning id into v_id;
  return v_id;
end $mm$;

-- แถว metric ของโพสต์เป็นข้อความที่ไม่ขึ้นกับ uuid/เวลา: age|view|like|comment|save|share|reg|source|sources
create or replace function pg_temp.rowsig(p_post uuid) returns text
 language sql as $rs$
  select coalesce(string_agg(concat_ws('|', age_days, coalesce(view_count::text, '~'), coalesce(like_count::text, '~'), coalesce(comment_count::text, '~'),
                                       coalesce(save_count::text, '~'), coalesce(share_count::text, '~'), is_regression::text, source,
                                       array_to_string(sources, ',')), ' ; ' order by captured_on), '-')
    from analytics.content_post_metric where post_id = p_post
$rs$;

create or replace function pg_temp.upsert_q(p_shop uuid, p_post uuid, p_view text, p_like text, p_comment text, p_save text, p_share text, p_source text) returns text
 language sql as $uq$
  select format('select analytics.content_post_metric_upsert(%L::uuid, %L::uuid, %s::bigint, %s::bigint, %s::bigint, %s::bigint, %s::bigint, %L)::text',
                p_shop, p_post, p_view, p_like, p_comment, p_save, p_share, p_source)
$uq$;

do $qa0161$
declare
  v_log     text := E'\n=== qa-0161-extra ===\n';
  v_today   date := (now() at time zone 'Asia/Bangkok')::date;
  v_has161  boolean := to_regprocedure('analytics.content_post_metric_amend(uuid,uuid,date,jsonb,text,text)') is not null;
  v_shop    uuid;
  v_qa      uuid;
  v_qax     uuid;
  v_n       bigint;
  v_n2      bigint;
  v_t       text;
  v_t2      text;
  v_j       jsonb;
  v_b       boolean;
  v_p1      uuid;
  v_p2      uuid;
  v_p3      uuid;
  v_p4      uuid;
  v_p5      uuid;
  v_p6      uuid;
  v_pf      uuid;
  v_ext4    text;
  v_step    uuid;
  v_i       int;
  v_view    text;
  v_t0      timestamptz;
  v_ms1     numeric;
  v_ms2     numeric;
  r         record;
  v_fail    int;
  v_ok      int;
begin
  begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);

  select count(*) into v_n from public.shop;
  if v_n <> 1 then raise exception 'qa-0161: ต้องมีร้านเดียวใน public.shop (พบ %)', v_n; end if;
  select id into v_shop from public.shop;
  insert into public.shop (name) values ('qa-0161 shop') returning id into v_qa;
  insert into public.shop (name) values ('qa-0161 shop X') returning id into v_qax;
  v_log := v_log || pg_temp.note('MODE', case when v_has161 then 'หลัง 0161 (มีฟังก์ชัน amend)' else 'ก่อน 0161 (ไม่มีฟังก์ชัน amend — เคสที่ต้องมี 0161 = SKIP)' end);

  ----------------------------------------------------------------------------
  -- V. view/หน้าเดิม — จำนวนแถว · คอลัมน์ · เนื้อแถว บนข้อมูลจริง (SELECT ล้วน) ภายใต้ service_role เหมือนแอป
  ----------------------------------------------------------------------------
  foreach v_t in array array['v_content_post_t7', 'v_content_entry_queue', 'v_content_hook_library', 'v_content_inbox_counts', 'v_content_piece',
                             'v_campaign_board', 'v_recommendation_acceptance', 'v_live_log_recent'] loop
    v_log := v_log || pg_temp.sig('V.' || v_t || '.cols', pg_temp.colsig(v_t));
    -- 2 view นี้มีค่าที่ขึ้นกับเวลาจริงในแถว (เทียบ pre กับ pre ก็ไม่นิ่ง) ⇒ เทียบจำนวนแถว + definition เท่านั้น
    v_log := v_log || pg_temp.sig('V.' || v_t || '.rows', case when v_t in ('v_content_inbox_counts', 'v_live_log_recent')
      then split_part(pg_temp.qsig('service_role', format('select * from analytics.%I', v_t)), ':', 1)
      else pg_temp.qsig('service_role', format('select * from analytics.%I', v_t)) end);
    v_log := v_log || pg_temp.sig('V.' || v_t || '.def', (select md5(pg_get_viewdef(('analytics.' || v_t)::regclass))));
  end loop;
  -- คิวกรอกยอดตาม lib/actions/content.ts getContentEntryQueue (คอลัมน์/ตัวกรองเดียวกัน)
  v_log := v_log || pg_temp.sig('V.app.entry_queue', pg_temp.qsig('service_role', format(
    'select post_id, shop_id, platform, external_id, post_url, posted_at, posted_date_th, content_type_code, age_days_today, read_round from analytics.v_content_entry_queue where shop_id = %L', v_shop)));
  -- หน้า history ตาม getContentPostHistory (2 query: โพสต์ active ≤50 + metric ของโพสต์เหล่านั้น)
  v_log := v_log || pg_temp.sig('V.app.history_posts', pg_temp.qsig('service_role', format(
    'select id, platform, post_url, posted_at, posted_date_th, content_type_code, caption_snapshot from (select * from analytics.content_post where shop_id = %L and status = ''active'' order by posted_at desc limit 50) z', v_shop)));
  v_log := v_log || pg_temp.sig('V.app.history_metrics', pg_temp.qsig('service_role', format(
    'select post_id, captured_on, view_count, like_count, comment_count, save_count, share_count from analytics.content_post_metric where post_id in (select id from analytics.content_post where shop_id = %L and status = ''active'')', v_shop)));
  -- KPI ตาม content-kpi (v_content_post_t7 ร้านเดียว)
  v_log := v_log || pg_temp.sig('V.app.kpi_t7', pg_temp.qsig('service_role', format('select * from analytics.v_content_post_t7 where shop_id = %L', v_shop)));
  v_log := v_log || pg_temp.vb('V1', 'ข้อมูลจริง: content_post 10 · metric 5 · hook 26 (ตรงตัวเลขหัวสเปก §13)',
    (select count(*) from analytics.content_post where shop_id = v_shop) = 10
    and (select count(*) from analytics.content_post_metric where shop_id = v_shop) = 5
    and (select count(*) from analytics.content_hook where shop_id = v_shop) = 26,
    (select count(*) from analytics.content_post where shop_id = v_shop) || '/' || (select count(*) from analytics.content_post_metric where shop_id = v_shop)
    || '/' || (select count(*) from analytics.content_hook where shop_id = v_shop));

  ----------------------------------------------------------------------------
  -- U. คิวกรอกยอด: content_post_metric_upsert ด้วยพารามิเตอร์ชุดเดียวกับ lib/actions/content.ts (p_source = 'manual') ภายใต้ service_role
  ----------------------------------------------------------------------------
  v_p1 := pg_temp.mkpost(v_qa, 3);
  v_t := pg_temp.vq('service_role', pg_temp.upsert_q(v_qa, v_p1, '1000', 'null', 'null', '50', 'null', 'manual'));
  v_log := v_log || pg_temp.vb('U1', 'ครั้งแรก (view 1000 · save 50 ที่เหลือ null) ผ่านภายใต้ service_role', v_t not like 'ERR:%', left(v_t, 80));
  v_log := v_log || pg_temp.sig('U1.row', pg_temp.rowsig(v_p1));
  v_t := pg_temp.vq('service_role', pg_temp.upsert_q(v_qa, v_p1, '1200', 'null', 'null', 'null', 'null', 'manual'));
  v_log := v_log || pg_temp.vb('U2', 'ซ้ำวันเดียวกัน (view 1200 อย่างเดียว) ผ่าน · null-preserving: save ยัง 50', v_t not like 'ERR:%'
    and (select view_count = 1200 and save_count = 50 and not is_regression from analytics.content_post_metric where post_id = v_p1), pg_temp.rowsig(v_p1));
  v_log := v_log || pg_temp.sig('U2.row', pg_temp.rowsig(v_p1));

  v_p2 := pg_temp.mkpost(v_qa, 4);
  perform pg_temp.mkmet(v_p2, v_today - 1, 5000, 400, 20, 100, 30);
  v_t := pg_temp.vq('service_role', pg_temp.upsert_q(v_qa, v_p2, '4000', 'null', 'null', 'null', 'null', 'manual'));
  v_log := v_log || pg_temp.vb('U3', 'regression จริง (view 4000 < 5000 เมื่อวาน) → is_regression = true', v_t not like 'ERR:%'
    and (select is_regression from analytics.content_post_metric where post_id = v_p2 and captured_on = v_today), pg_temp.rowsig(v_p2));
  v_log := v_log || pg_temp.sig('U3.row', pg_temp.rowsig(v_p2));
  v_t := pg_temp.vq('service_role', pg_temp.upsert_q(v_qa, v_p2, 'null', 'null', 'null', '200', 'null', 'manual'));
  v_log := v_log || pg_temp.vb('U4', 'ยิงซ้ำวันเดียวกันด้วยคอลัมน์อื่น (save 200) → ธง regression ยังเป็น true (H1)', v_t not like 'ERR:%'
    and (select is_regression and view_count = 4000 and save_count = 200 from analytics.content_post_metric where post_id = v_p2 and captured_on = v_today), pg_temp.rowsig(v_p2));
  v_log := v_log || pg_temp.sig('U4.row', pg_temp.rowsig(v_p2));
  v_t := pg_temp.vq('service_role', pg_temp.upsert_q(v_qa, v_p2, '6000', 'null', 'null', 'null', 'null', 'manual'));
  v_log := v_log || pg_temp.vb('U5', 'แก้ view เป็น 6000 วันเดียวกัน → regression กลับเป็น false', v_t not like 'ERR:%'
    and (select not is_regression and view_count = 6000 from analytics.content_post_metric where post_id = v_p2 and captured_on = v_today), pg_temp.rowsig(v_p2));
  v_log := v_log || pg_temp.sig('U5.row', pg_temp.rowsig(v_p2));

  v_t := pg_temp.vq('service_role', pg_temp.upsert_q(v_qa, v_p2, 'null', 'null', 'null', 'null', 'null', 'manual'));
  v_log := v_log || pg_temp.sig('U6.all_null', left(v_t, 9));
  v_log := v_log || pg_temp.vb('U6', 'ว่างทั้ง 5 ช่อง → 22023', v_t like 'ERR:22023%', left(v_t, 90));
  v_t := pg_temp.vq('service_role', pg_temp.upsert_q(v_qa, v_p2, '-1', 'null', 'null', 'null', 'null', 'manual'));
  v_log := v_log || pg_temp.vb('U7', 'ติดลบ → 22023', v_t like 'ERR:22023%', left(v_t, 90));
  v_t := pg_temp.vq('service_role', pg_temp.upsert_q(v_qa, v_p2, '1', 'null', 'null', 'null', 'null', 'robot'));
  v_log := v_log || pg_temp.vb('U8', 'source ไม่รู้จัก → 22023', v_t like 'ERR:22023%', left(v_t, 90));
  v_t := pg_temp.vq('service_role', pg_temp.upsert_q(v_qax, v_p2, '1', 'null', 'null', 'null', 'null', 'manual'));
  v_log := v_log || pg_temp.vb('U9', 'โพสต์ต่างร้าน → 22023', v_t like 'ERR:22023%', left(v_t, 90));
  v_pf := pg_temp.mkpost(v_qa, 0);
  v_t := pg_temp.vq('service_role', pg_temp.upsert_q(v_qa, v_pf, '1', 'null', 'null', 'null', 'null', 'manual'));
  v_log := v_log || pg_temp.vb('U10', 'โพสต์ปล่อยวันนี้ (age 0 = ขอบ) กรอกยอดได้ · age_days=0 · ไม่ใช่ regression', v_t not like 'ERR:%'
    and (select age_days = 0 and not is_regression from analytics.content_post_metric where post_id = v_pf), pg_temp.rowsig(v_pf));
  v_log := v_log || pg_temp.sig('U10.row', pg_temp.rowsig(v_pf));

  v_t := pg_temp.vq('service_role', pg_temp.upsert_q(v_qa, v_p2, '6500', 'null', 'null', 'null', 'null', 'tiktok_api'));
  v_log := v_log || pg_temp.vb('U11', 'tiktok_api บนแถวที่ไม่เคย amend = ทับได้ปกติ · sources สะสม manual+tiktok_api · ไม่มี log', v_t not like 'ERR:%'
    and (select view_count = 6500 and source = 'tiktok_api' and sources = array['manual', 'tiktok_api'] from analytics.content_post_metric where post_id = v_p2 and captured_on = v_today),
    pg_temp.rowsig(v_p2));
  v_log := v_log || pg_temp.sig('U11.row', pg_temp.rowsig(v_p2));
  if v_has161 then
    v_log := v_log || pg_temp.vb('U11b', 'tiktok_api ทับแถวที่ไม่ amend → amend_log 0 แถว · amended_cols ว่าง',
      (select count(*) from analytics.content_post_metric_amend_log where post_id = v_p2) = 0
      and (select amended_cols = '{}' from analytics.content_post_metric where post_id = v_p2 and captured_on = v_today));
  end if;

  -- คิวกรอกยอด: โพสต์อายุ 1 วันไม่มีตัวเลข = อยู่ในคิวรอบ 1 → หลังกรอกหลุดจากคิว
  v_p3 := pg_temp.mkpost(v_qa, 1);
  v_t := (select coalesce(string_agg(read_round || '/' || age_days_today, ',' order by read_round, age_days_today), '-') from analytics.v_content_entry_queue where shop_id = v_qa);
  v_log := v_log || pg_temp.vb('U12', 'คิว (ร้านทดสอบ): มีเฉพาะโพสต์อายุ 1 วันที่ยังไม่มีตัวเลข = "1/1"', v_t = '1/1', v_t);
  v_log := v_log || pg_temp.sig('U12.queue_before', v_t);
  perform pg_temp.vq('service_role', pg_temp.upsert_q(v_qa, v_p3, '300', 'null', 'null', 'null', 'null', 'manual'));
  v_t := (select coalesce(string_agg(read_round || '/' || age_days_today, ',' order by read_round, age_days_today), '-') from analytics.v_content_entry_queue where shop_id = v_qa);
  v_log := v_log || pg_temp.vb('U13', 'หลังกรอกยอด โพสต์หลุดจากคิว', v_t = '-', v_t);
  v_log := v_log || pg_temp.sig('U13.queue_after', v_t);

  ----------------------------------------------------------------------------
  -- S. content_piece_set_plan: metric_code เดิมทุกค่าต้องผ่าน · 'orders' ผ่านเฉพาะหลัง 0161 · ค่าแปลกถูกปฏิเสธ
  ----------------------------------------------------------------------------
  v_step := analytics.content_piece_create(v_qa, 'qa-0161 set_plan', 'short_clip', 'tiktok', 'jewelry_925', 'owner', v_today + 5);
  foreach v_t in array array['save_rate', 'share_rate', 'peak_viewers', 'line_reply_count', 'none'] loop
    v_t2 := pg_temp.vq('service_role', format('select (analytics.content_piece_set_plan(%L::uuid, %L::uuid, jsonb_build_object(''metric_code'', %L), ''owner''))::text', v_qa, v_step, v_t));
    v_log := v_log || pg_temp.vb('S.' || v_t, 'set_plan metric_code=' || v_t || ' ผ่าน (ค่าเดิม — ห้ามพังหลัง replace content_piece_enum_ok_)',
      v_t2 not like 'ERR:%' and (select metric_code from analytics.campaign_step where id = v_step) = v_t, left(v_t2, 80));
    v_log := v_log || pg_temp.sig('S.' || v_t, (select metric_code from analytics.campaign_step where id = v_step));
  end loop;
  v_t2 := pg_temp.vq('service_role', format('select (analytics.content_piece_set_plan(%L::uuid, %L::uuid, jsonb_build_object(''metric_code'', ''orders''), ''owner''))::text', v_qa, v_step));
  if v_has161 then
    v_log := v_log || pg_temp.vb('S.orders', 'หลัง 0161: set_plan metric_code=orders ผ่านจริง (CHECK + helper ตรงกัน)', v_t2 not like 'ERR:%'
      and (select metric_code from analytics.campaign_step where id = v_step) = 'orders', left(v_t2, 80));
  else
    v_log := v_log || pg_temp.note('S.orders(pre)', 'ก่อน 0161 ผล = ' || left(v_t2, 90));
  end if;
  -- ค่าแปลกต้องยังถูกปฏิเสธ 22023 (helper ยังเป็น whitelist ไม่ใช่ "รับทุกอย่าง")
  foreach v_t in array array['revenue', 'ORDERS', 'orders ', 'order', '', ' ', 'save_rate;--', 'ออเดอร์', '😀'] loop
    v_t2 := pg_temp.vq('service_role', format('select (analytics.content_piece_set_plan(%L::uuid, %L::uuid, jsonb_build_object(''metric_code'', %L), ''owner''))::text', v_qa, v_step, v_t));
    v_log := v_log || pg_temp.vb('S.bad[' || v_t || ']', 'metric_code แปลก → 22023', v_t2 like 'ERR:22023%', left(v_t2, 90));
    v_log := v_log || pg_temp.sig('S.bad[' || v_t || ']', left(v_t2, 9));
  end loop;
  -- metric_code ที่ตั้งไว้ต้องไม่ถูกแตะโดยการปฏิเสธข้างบน (ยัง = ค่าล่าสุดที่ผ่าน)
  v_log := v_log || pg_temp.vb('S.bad.untouched', 'หลังปฏิเสธค่าแปลกทั้งหมด metric_code ยังเป็นค่าที่ผ่านล่าสุด', (select metric_code from analytics.campaign_step where id = v_step) = case when v_has161 then 'orders' else 'none' end,
    (select metric_code from analytics.campaign_step where id = v_step));
  -- CHECK ระดับตาราง: ค่าแปลกยังถูกปฏิเสธ 23514 แม้ postgres เขียนตรง
  begin
    update analytics.campaign_step set metric_code = 'revenue' where id = v_step;
    v_log := v_log || pg_temp.vb('S.check', 'CHECK ตารางปฏิเสธ metric_code=revenue', false, 'ผ่านทั้งที่ควรปฏิเสธ');
  exception when check_violation then
    v_log := v_log || pg_temp.vb('S.check', 'CHECK ตารางปฏิเสธ metric_code=revenue (23514)', true);
  end;

  ----------------------------------------------------------------------------
  -- ต่อจากนี้ต้องมี 0161
  ----------------------------------------------------------------------------
  if not v_has161 then
    v_log := v_log || E'[SKIP] M/Q/R/O/W/X — ต้องมี 0161 (รันแบบ cat 0161 + ไฟล์นี้)\n';
  else
    -- ==========================================================================
    -- M. amend → ค่าใหม่ไหลเข้า t7/result · log ครบ · รอบถัดไปไม่ทับ · regression ใช้ฐานที่แก้
    -- ==========================================================================
    v_ext4 := 'qa161-p4-' || substr(gen_random_uuid()::text, 1, 8);
    v_p4 := pg_temp.mkpost(v_qa, 7, v_ext4);
    perform pg_temp.mkmet(v_p4, v_today - 6, 800, 40, 4, 8, 3);
    perform pg_temp.mkmet(v_p4, v_today, 1000, 60, 5, 20, 10);
    select t7_save_count, save_rate into r from analytics.v_content_post_t7 where post_id = v_p4;
    v_log := v_log || pg_temp.vb('M0', 'ก่อน amend: t7_save_count=20 · save_rate≈0.02', r.t7_save_count = 20 and abs(r.save_rate - 0.02) < 0.0001, r.t7_save_count || '/' || r.save_rate);
    v_t := pg_temp.vq('service_role', format('select analytics.content_post_metric_amend(%L::uuid, %L::uuid, %L::date, %L::jsonb, %L, ''owner'')::text',
                                              v_qa, v_p4, v_today, '{"save_count": 40}', 'QA แก้ค่าที่พิมพ์ผิด'));
    v_log := v_log || pg_temp.vb('M1', 'amend T+7 save 20→40 ผ่านภายใต้ service_role', v_t not like 'ERR:%', left(v_t, 200));
    select t7_save_count, save_rate into r from analytics.v_content_post_t7 where post_id = v_p4;
    v_log := v_log || pg_temp.vb('M2', 'ค่าใหม่ไหลเข้า v_content_post_t7: t7_save_count=40 · save_rate≈0.04', r.t7_save_count = 40 and abs(r.save_rate - 0.04) < 0.0001, r.t7_save_count || '/' || r.save_rate);
    select t7_save_count, save_rate, computed_reason into r from analytics.v_content_post_result where post_id = v_p4;
    v_log := v_log || pg_temp.vb('M3', 'ค่าใหม่ไหลเข้า v_content_post_result: t7_save_count=40 · save_rate≈0.04 (เทียบ t7 view เท่ากัน)',
      r.t7_save_count = 40 and abs(r.save_rate - 0.04) < 0.0001
      and r.save_rate is not distinct from (select t.save_rate from analytics.v_content_post_t7 t where t.post_id = v_p4), r.t7_save_count || '/' || r.save_rate || ' reason=' || coalesce(r.computed_reason, '-'));
    v_log := v_log || pg_temp.vb('M4', 'log 1 แถว: kind=amend · actor=owner · changed={save_count} · before.save=20 · after.save=40 · before/after มีครบ 5 คอลัมน์',
      (select count(*) = 1 and bool_and(change_kind = 'amend' and actor_role = 'owner' and changed_cols = array['save_count']
              and (before->>'save_count')::int = 20 and (after->>'save_count')::int = 40
              and (select count(*) from jsonb_object_keys(before)) = 5 and (select count(*) from jsonb_object_keys(after)) = 5 and reason = 'QA แก้ค่าที่พิมพ์ผิด')
         from analytics.content_post_metric_amend_log where post_id = v_p4));
    v_log := v_log || pg_temp.vb('M5', 'แถว metric: source=manual · amended_cols={save_count} · view/like เดิม', (select source = 'manual' and amended_cols = array['save_count'] and view_count = 1000 and like_count = 60
                                                                                                                     from analytics.content_post_metric where post_id = v_p4 and captured_on = v_today));

    -- รอบถัดไป: แถวอายุ 1 ที่แก้แล้วต้องไม่ถูกคิวรอบใหม่ทับ · regression ของแถววันหลังใช้ฐานที่แก้
    v_p5 := pg_temp.mkpost(v_qa, 5);
    perform pg_temp.mkmet(v_p5, v_today - 4, 700, 30, 3, 6, 2);
    v_t := pg_temp.vq('service_role', format('select analytics.content_post_metric_amend(%L::uuid, %L::uuid, %L::date, %L::jsonb, %L, ''owner'')::text',
                                              v_qa, v_p5, v_today - 4, '{"view_count": 750}', 'QA แก้ยอดวันแรก'));
    v_log := v_log || pg_temp.vb('M6', 'amend แถวย้อนหลัง 4 วัน (view 700→750) ผ่าน', v_t not like 'ERR:%', left(v_t, 160));
    v_t := pg_temp.vq('service_role', pg_temp.upsert_q(v_qa, v_p5, '740', 'null', 'null', 'null', 'null', 'manual'));
    v_log := v_log || pg_temp.vb('M7', 'คิวรอบถัดไป (วันนี้ view 740) สร้างแถวใหม่ ไม่ทับแถวที่แก้ · regression true เพราะเทียบฐาน 750 ที่แก้', v_t not like 'ERR:%'
      and (select count(*) = 2 and bool_or(captured_on = v_today - 4 and view_count = 750 and amended_cols = array['view_count'] and not is_regression)
                 and bool_or(captured_on = v_today and view_count = 740 and is_regression and amended_cols = '{}') from analytics.content_post_metric where post_id = v_p5),
      pg_temp.rowsig(v_p5));
    v_log := v_log || pg_temp.vb('M8', 'log ของโพสต์นี้ยัง 1 แถว (การกรอกรอบถัดไปไม่เขียน log)', (select count(*) from analytics.content_post_metric_amend_log where post_id = v_p5) = 1);

    -- กรอกซ้ำวันเดียวกันด้วยมือบนแถวที่ amend (คน vs คน = ค่าล่าสุดชนะ · amended_cols คงอยู่ ตามสเปก 13.1 ข้อ 4)
    v_t := pg_temp.vq('service_role', pg_temp.upsert_q(v_qa, v_p4, '1100', 'null', 'null', 'null', 'null', 'manual'));
    v_log := v_log || pg_temp.vb('M9', 'manual upsert วันเดียวกันบนแถวที่ amend: view=1100 · save ยัง 40 (null-preserving) · amended_cols คงอยู่', v_t not like 'ERR:%'
      and (select view_count = 1100 and save_count = 40 and amended_cols = array['save_count'] and source = 'manual' from analytics.content_post_metric where post_id = v_p4 and captured_on = v_today));

    -- Q9: tiktok_api ทับค่าที่แก้มือ
    v_t := pg_temp.vq('service_role', pg_temp.upsert_q(v_qa, v_p4, '2000', 'null', 'null', 'null', 'null', 'tiktok_api'));
    v_log := v_log || pg_temp.vb('Q1', 'tiktok_api ส่งเฉพาะ view (save null = ไม่ส่ง) → view=2000 · save 40 อยู่ · ธง amended คงอยู่ · ไม่มี api_override log', v_t not like 'ERR:%'
      and (select view_count = 2000 and save_count = 40 and amended_cols = array['save_count'] and source = 'tiktok_api' from analytics.content_post_metric where post_id = v_p4 and captured_on = v_today)
      and (select count(*) from analytics.content_post_metric_amend_log where post_id = v_p4 and change_kind = 'api_override') = 0);
    v_t := pg_temp.vq('service_role', pg_temp.upsert_q(v_qa, v_p4, 'null', 'null', 'null', '99', 'null', 'tiktok_api'));
    v_log := v_log || pg_temp.vb('Q2', 'tiktok_api ส่ง save=99 ทับค่าที่แก้มือ (40) → ทับได้ (Q9) · ถอดธง save_count', v_t not like 'ERR:%'
      and (select save_count = 99 and amended_cols = '{}' and source = 'tiktok_api' from analytics.content_post_metric where post_id = v_p4 and captured_on = v_today));
    select * into r from analytics.content_post_metric_amend_log where post_id = v_p4 and change_kind = 'api_override';
    v_log := v_log || pg_temp.vb('Q3', 'log api_override 1 แถว: actor=system · changed={save_count} · before.save=40 → after.save=99 · before/after.view = 2000 ทั้งคู่ (ไม่ใช่คอลัมน์ที่ถูกทับ)',
      (select count(*) from analytics.content_post_metric_amend_log where post_id = v_p4 and change_kind = 'api_override') = 1
      and r.actor_role = 'system' and r.changed_cols = array['save_count'] and (r.before->>'save_count')::int = 40 and (r.after->>'save_count')::int = 99
      and (r.before->>'view_count')::int = 2000 and (r.after->>'view_count')::int = 2000, concat_ws('|', r.actor_role, r.changed_cols::text, r.before::text, r.after::text));
    v_t := pg_temp.vq('service_role', pg_temp.upsert_q(v_qa, v_p4, 'null', 'null', 'null', '100', 'null', 'tiktok_api'));
    v_log := v_log || pg_temp.vb('Q4', 'API ทับซ้ำหลังธงถูกถอด → ไม่เขียน log เพิ่ม (ค่านั้นไม่ใช่ค่าที่คนยืนยันแล้ว)', v_t not like 'ERR:%'
      and (select count(*) from analytics.content_post_metric_amend_log where post_id = v_p4) = 2 and
          (select save_count from analytics.content_post_metric where post_id = v_p4 and captured_on = v_today) = 100);
    v_t := pg_temp.vq('service_role', format('select analytics.content_post_metric_amend(%L::uuid, %L::uuid, %L::date, %L::jsonb, %L, ''owner'')::text',
                                              v_qa, v_p4, v_today, '{"save_count": 50}', 'QA เจ้าของแก้ทับ API'));
    v_log := v_log || pg_temp.vb('Q5', 'เจ้าของแก้ทับค่า API ได้อีกรอบ → log รวม 3 · ธง save_count กลับมา', v_t not like 'ERR:%'
      and (select count(*) from analytics.content_post_metric_amend_log where post_id = v_p4) = 3
      and (select amended_cols = array['save_count'] and source = 'manual' from analytics.content_post_metric where post_id = v_p4 and captured_on = v_today));
    -- ประวัติอ่านได้ภายใต้ service_role · เขียนตรง/ลบ/แก้ไม่ได้
    v_t := pg_temp.vq('service_role', format('select count(*)::text from analytics.content_post_metric_amend_log where post_id = %L', v_p4));
    v_log := v_log || pg_temp.vb('Q6', 'service_role อ่าน amend_log ได้ (3 แถว)', v_t = '3', v_t);
    v_t := pg_temp.vq('service_role', format('insert into analytics.content_post_metric_amend_log (shop_id, metric_id, post_id, captured_on, before, after, changed_cols, reason, actor_role) select shop_id, id, post_id, captured_on, ''{}''::jsonb, ''{}''::jsonb, array[''view_count''], ''ปลอม'', ''owner'' from analytics.content_post_metric where post_id = %L limit 1 returning id::text', v_p4));
    v_log := v_log || pg_temp.vb('Q7', 'service_role INSERT ตรงลง amend_log (ปลอมว่าเจ้าของแก้) → 42501', v_t like 'ERR:42501%', left(v_t, 100));
    v_t := pg_temp.vq('service_role', format('update analytics.content_post_metric set view_count = 1 where post_id = %L returning id::text', v_p4));
    v_log := v_log || pg_temp.vb('Q8', 'service_role UPDATE ตรงยอด → 55000', v_t like 'ERR:55000%', left(v_t, 100));
    v_t := pg_temp.vq('service_role', format('delete from analytics.content_post_metric where post_id = %L returning id::text', v_p4));
    v_log := v_log || pg_temp.vb('Q9', 'service_role DELETE ตรง metric → 55000', v_t like 'ERR:55000%', left(v_t, 100));

    -- ==========================================================================
    -- X. ผลต่อโพสต์ (verdict) ต้องรอดจากเส้นทางเดิมของโพสต์: upsert ซ้ำ · set_status ซ่อน/เปิด
    -- ==========================================================================
    v_t := pg_temp.vq('service_role', format('select analytics.content_post_verdict_confirm(%L::uuid, %L::uuid, ''above'', %L, ''owner'', null)::text', v_qa, v_p4, 'QA บทเรียนหลังยืนยัน'));
    v_log := v_log || pg_temp.vb('X1', 'verdict_confirm ภายใต้ service_role (T+7 มีแล้ว) ผ่าน · effective_label=above · label_source=owner', v_t not like 'ERR:%'
      and (select effective_label = 'above' and label_source = 'owner' from analytics.v_content_post_result where post_id = v_p4), left(v_t, 160));
    v_t := pg_temp.vq('service_role', format('select analytics.content_post_upsert(%L::uuid, ''tiktok'', %L, %L, now() - interval ''7 days'', null, null, %L)::text',
                                              v_qa, v_ext4, 'https://www.tiktok.com/@qa0161/video/' || v_ext4, 'caption ใหม่หลังยืนยัน'));
    v_log := v_log || pg_temp.vb('X2', 'วางลิงก์โพสต์เดิมซ้ำ (content_post_upsert) หลังเจ้าของยืนยันผล → ผ่าน · result_* ไม่ถูกล้าง · caption อัปเดต', v_t not like 'ERR:%'
      and (select result_label_override = 'above' and result_confirmed_by_role = 'owner' and result_lesson = 'QA บทเรียนหลังยืนยัน' and caption_snapshot = 'caption ใหม่หลังยืนยัน'
             from analytics.content_post where id = v_p4), left(v_t, 160));
    v_t := pg_temp.vq('service_role', format('select analytics.content_post_set_status(%L::uuid, %L::uuid, ''deleted'')::text', v_qa, v_p4));
    v_log := v_log || pg_temp.vb('X3', 'ซ่อนโพสต์ (set_status deleted) ผ่าน · หายจาก v_content_post_result', v_t not like 'ERR:%'
      and not exists (select 1 from analytics.v_content_post_result where post_id = v_p4), left(v_t, 120));
    v_t := pg_temp.vq('service_role', format('select analytics.content_post_set_status(%L::uuid, %L::uuid, ''active'')::text', v_qa, v_p4));
    v_log := v_log || pg_temp.vb('X4', 'เปิดกลับ (active) ผ่าน · result_* + amended_cols + log ยังอยู่ · ป้ายเจ้าของกลับมา', v_t not like 'ERR:%'
      and (select effective_label = 'above' and label_source = 'owner' and result_lesson = 'QA บทเรียนหลังยืนยัน' from analytics.v_content_post_result where post_id = v_p4)
      and (select amended_cols = array['save_count'] from analytics.content_post_metric where post_id = v_p4 and captured_on = v_today)
      and (select count(*) from analytics.content_post_metric_amend_log where post_id = v_p4) = 3, left(v_t, 120));
    -- ยืนยันป้ายโดย role ภายนอก/เขียนตรง ต้องไม่ผ่าน (ปลอมการตัดสินของเจ้าของ)
    v_t := pg_temp.vq('service_role', format('update analytics.content_post set result_label_override = ''below'', result_confirmed_at = now(), result_confirmed_by_role = ''owner'' where id = %L returning id::text', v_p4));
    v_log := v_log || pg_temp.vb('X5', 'service_role UPDATE result_* ตรง → 55000', v_t like 'ERR:55000%', left(v_t, 100));
    v_t := pg_temp.vq('service_role', format('select analytics.content_post_verdict_confirm(%L::uuid, %L::uuid, ''below'', null, ''ai'', null)::text', v_qa, v_p4));
    v_log := v_log || pg_temp.vb('X6', 'verdict_confirm ในนาม ai → 42501', v_t like 'ERR:42501%', left(v_t, 100));
    -- บทเรียนยาว: 300 ผ่าน / 301 ตก · ไทย+emoji นับเป็นตัวอักษร ไม่ใช่ byte
    v_t := pg_temp.vq('service_role', format('select analytics.content_post_verdict_confirm(%L::uuid, %L::uuid, ''normal'', %L, ''owner'', null)::text', v_qa, v_p4, repeat('ก', 300)));
    v_log := v_log || pg_temp.vb('X7', 'บทเรียนไทย 300 ตัวอักษร (900 byte) ผ่าน', v_t not like 'ERR:%', left(v_t, 100));
    v_t := pg_temp.vq('service_role', format('select analytics.content_post_verdict_confirm(%L::uuid, %L::uuid, ''normal'', %L, ''owner'', null)::text', v_qa, v_p4, repeat('ก', 301)));
    v_log := v_log || pg_temp.vb('X8', 'บทเรียน 301 ตัวอักษร → 22023', v_t like 'ERR:22023%', left(v_t, 100));
    v_t := pg_temp.vq('service_role', format('select analytics.content_post_verdict_confirm(%L::uuid, %L::uuid, ''normal'', %L, ''owner'', null)::text', v_qa, v_p4, repeat('😀', 150)));
    v_log := v_log || pg_temp.vb('X9', 'บทเรียน emoji 150 ตัว (surrogate/4-byte) ผ่าน · ไม่ล้มที่ content_signal', v_t not like 'ERR:%', left(v_t, 100));
    -- amend: input ประหลาดนอกชุดของ verify
    foreach v_t in array array['{"view_count": 99999999999999999999}', '{"view_count": 1000000000001}', '{"ยอดวิว": 5}', '{"view_count": {"a": 1}}', '{"view_count": [1]}', '{"view_count": 1, "save_count": "5"}',
                               '{"view_count": 0.0}', 'null', '"view_count"', '5'] loop
      v_t2 := pg_temp.vq('service_role', format('select analytics.content_post_metric_amend(%L::uuid, %L::uuid, %L::date, %L::jsonb, ''QA ทดสอบ'', ''owner'')::text', v_qa, v_p5, v_today, v_t));
      v_log := v_log || pg_temp.vb('X10[' || v_t || ']', 'amend input ผิดรูป → 22023 ไม่ใช่ error อื่น (22003/22P02/XX000)', v_t2 like 'ERR:22023%', left(v_t2, 110));
    end loop;
    v_t2 := pg_temp.vq('service_role', format('select analytics.content_post_metric_amend(%L::uuid, %L::uuid, %L::date, %L::jsonb, %L, ''owner'')::text', v_qa, v_p5, v_today, '{"view_count": 760}', repeat('ก', 501)));
    v_log := v_log || pg_temp.vb('X11', 'amend เหตุผล 501 ตัวอักษร → 22023', v_t2 like 'ERR:22023%', left(v_t2, 100));
    v_t2 := pg_temp.vq('service_role', format('select analytics.content_post_metric_amend(%L::uuid, %L::uuid, %L::date, %L::jsonb, %L, ''owner'')::text', v_qa, v_p5, v_today, '{"view_count": 760}', repeat('😀', 100)));
    v_log := v_log || pg_temp.vb('X12', 'amend เหตุผล emoji 100 ตัว ผ่าน', v_t2 not like 'ERR:%', left(v_t2, 100));
    v_t2 := pg_temp.vq('service_role', format('select analytics.content_post_metric_amend(%L::uuid, %L::uuid, %L::date, %L::jsonb, %L, ''owner'')::text', v_qa, v_p5, v_today, '{"view_count": 1000000000000}', 'QA ค่าสูงสุดที่รับได้'));
    v_log := v_log || pg_temp.vb('X13', 'amend view = 1,000,000,000,000 (ขอบบน) ผ่าน · เก็บเป็น bigint ได้', v_t2 not like 'ERR:%', left(v_t2, 100));
    -- กรณีลูกโซ่: ขอบบนทำให้แถว today ของ P5 สูงกว่าทุกแถวก่อนหน้า ⇒ ไม่ควร regression
    v_log := v_log || pg_temp.vb('X14', 'หลังแก้ขอบบน แถวหลังสุดไม่ใช่ regression (ธงคิดจากค่าใหม่)', (select not is_regression from analytics.content_post_metric where post_id = v_p5 and captured_on = v_today),
      pg_temp.rowsig(v_p5));

    -- ==========================================================================
    -- R. v_content_post_result / v_content_hook_type_rollup บนข้อมูลจริง (SELECT ล้วน)
    -- ==========================================================================
    select count(*) into v_n from analytics.v_content_post_result where shop_id = v_shop;
    v_log := v_log || pg_temp.vb('R1', 'v_content_post_result ร้านจริง = จำนวนโพสต์ active (8) · ไม่มีแถว deleted', v_n = 8 and v_n = (select count(*) from analytics.content_post where shop_id = v_shop and status = 'active'), v_n::text);
    select count(*) into v_n2 from analytics.v_content_post_result pr
     where pr.shop_id = v_shop and pr.baseline_n is distinct from (
       select least(10, count(*))::int from analytics.v_content_post_t7 b
        where b.shop_id = pr.shop_id and b.platform = pr.platform and b.status = 'active' and b.t7_captured_on is not null and b.save_rate is not null
          and (b.posted_at, b.post_id) < (pr.posted_at, pr.post_id));
    v_log := v_log || pg_temp.vb('R2', 'baseline_n ทุกแถวจริงเท่านับอิสระ (โพสต์ก่อนหน้าที่มี T+7 · ≤10)', v_n2 = 0, 'ไม่ตรง ' || v_n2);
    select count(*) into v_n2 from analytics.v_content_post_result pr where pr.shop_id = v_shop and pr.t7_captured_on is null and (pr.computed_label is not null or pr.computed_reason not like 'ไม่มี snapshot T+7:%');
    v_log := v_log || pg_temp.vb('R3', 'แถวไม่มี T+7: computed_label null + reason ขึ้นต้น "ไม่มี snapshot T+7:" ทุกแถว', v_n2 = 0, 'ผิด ' || v_n2);
    select count(*) into v_n2 from analytics.v_content_post_result pr where pr.shop_id = v_shop and pr.label_source <> 'none';
    v_log := v_log || pg_temp.vb('R4', 'ข้อมูลจริง ไม่มีป้ายใดถูกสร้าง/ยืนยัน (label_source=none ทั้ง 8 แถว — ไม่มีการเดาป้ายเมื่อฐาน <4)', v_n2 = 0, 'มีป้าย ' || v_n2);
    select string_agg(distinct coalesce(computed_reason, '-'), ' | ') into v_t from analytics.v_content_post_result where shop_id = v_shop and t7_captured_on is not null;
    v_log := v_log || pg_temp.note('R5 เหตุผลของแถวที่มี T+7 จริง', v_t);
    select string_agg(table_name || '.' || column_name, ', ') into v_t from information_schema.columns
     where table_schema = 'analytics' and table_name in ('v_content_post_result', 'v_content_hook_type_rollup', 'v_content_post_missed_window', 'v_content_order_daily', 'content_post_metric_amend_log')
       and column_name <> 'customer_group'   -- กลุ่มสินค้าของชิ้นงาน (jewelry_925/silver_bar) ไม่ใช่ข้อมูลลูกค้า
       and (column_name ~* 'host|display_name|phone|email|tel_|address|customer|buyer|line_id|full_name|first_name|last_name');
    v_log := v_log || pg_temp.vb('R6', 'ไม่มีคอลัมน์โฮสต์/PII (host·ชื่อ·เบอร์·อีเมล·ที่อยู่·ลูกค้า) ใน view/ตารางใหม่ทั้ง 5 (Q11) — ยกเว้น customer_group ที่เป็นกลุ่มสินค้า', v_t is null, coalesce(v_t, '-'));
    select count(*) into v_n from analytics.v_content_hook_type_rollup u
     where u.verdict is distinct from (select max(l.type_verdict) from analytics.v_content_hook_library l where l.shop_id = u.shop_id and l.side = 'ours' and l.hook_type = u.hook_type);
    select count(*) into v_n2 from (select distinct l.shop_id, l.hook_type, l.type_n_pieces, l.type_verdict from analytics.v_content_hook_library l where l.side = 'ours' and l.hook_type is not null and l.type_n_pieces > 0) l
     where not exists (select 1 from analytics.v_content_hook_type_rollup u where u.shop_id = l.shop_id and u.hook_type = l.hook_type and u.measured_pieces_n = l.type_n_pieces and u.verdict = l.type_verdict);
    v_log := v_log || pg_temp.vb('R7', 'rollup ↔ library: verdict ตรงทุก (shop, hook_type) · ทุกประเภทที่ library นับ n>0 มีแถว rollup n เท่ากัน (รวมแถว fixture ร้านทดสอบ=0)', v_n = 0 and v_n2 = 0, v_n || '/' || v_n2);
    v_log := v_log || pg_temp.note('R8 ข้อมูลจริง', format('rollup ร้านจริง %s แถว (โพสต์จริงไม่มี hook_id/step_id เลย ⇒ 0 แถว = ถูกต้อง) · library ours %s hook · ติดประเภท %s · type_n_pieces>0: %s',
      (select count(*) from analytics.v_content_hook_type_rollup where shop_id = v_shop), (select count(*) from analytics.v_content_hook_library where shop_id = v_shop and side = 'ours'),
      (select count(*) from analytics.v_content_hook_library where shop_id = v_shop and side = 'ours' and hook_type is not null),
      (select count(*) from analytics.v_content_hook_library where shop_id = v_shop and side = 'ours' and type_n_pieces > 0)));
    v_log := v_log || pg_temp.vb('R9', 'rollup คอลัมน์: n เป็น int ไม่ติดลบ · above+normal+below = labeled_n ทุกแถว (ทั้งร้านจริง+ทดสอบ)',
      not exists (select 1 from analytics.v_content_hook_type_rollup where above_n + normal_n + below_n <> labeled_n or posts_n < 0 or pieces_n > posts_n or measured_pieces_n > pieces_n));

    -- ==========================================================================
    -- W. v_content_post_missed_window บนข้อมูลจริง — เทียบนับอิสระ + ไม่ทับคิว
    -- ==========================================================================
    with win(read_round, lo, hi) as (values (1, 1, 2), (2, 3, 4), (3, 5, 9)),
    exp as (
      select p.id as post_id, w.read_round
        from analytics.content_post p cross join win w
       where p.shop_id = v_shop and p.status = 'active' and (v_today - p.posted_date_th) > w.hi
         and not exists (select 1 from analytics.content_post_metric m where m.post_id = p.id and m.age_days between w.lo and w.hi
                            and (m.view_count is not null or m.like_count is not null or m.comment_count is not null or m.save_count is not null or m.share_count is not null)))
    select (select count(*) from exp) as f1, (select count(*) from analytics.v_content_post_missed_window where shop_id = v_shop) as f2,
           (select count(*) from (select post_id, read_round from exp except select post_id, read_round from analytics.v_content_post_missed_window where shop_id = v_shop) a) as f3,
           (select count(*) from (select post_id, read_round from analytics.v_content_post_missed_window where shop_id = v_shop except select post_id, read_round from exp) b) as f4
      into r;
    v_log := v_log || pg_temp.vb('W1', 'missed_window ร้านจริงตรงกับนับอิสระจาก content_post+metric ทุกแถว (ขาด/เกิน = 0)', r.f1 = r.f2 and r.f3 = 0 and r.f4 = 0, r.f1 || ' vs ' || r.f2 || ' · ขาด ' || r.f3 || ' · เกิน ' || r.f4);
    select count(*) into v_n from analytics.v_content_post_missed_window m join analytics.v_content_entry_queue q on q.post_id = m.post_id and q.read_round = m.read_round;
    v_log := v_log || pg_temp.vb('W2', 'แถวที่อยู่ในคิวกรอกยอด ไม่อยู่ใน missed ของรอบเดียวกัน (ทั้งร้านจริง+ทดสอบ)', v_n = 0, 'ทับ ' || v_n);
    select count(*) into v_n from analytics.v_content_post_missed_window m join analytics.content_post p on p.id = m.post_id where p.status <> 'active';
    v_log := v_log || pg_temp.vb('W3', 'ไม่มีโพสต์ deleted ใน missed_window', v_n = 0, 'พบ ' || v_n);
    v_log := v_log || pg_temp.note('W4 missed_window ร้านจริง', format('%s แถว จาก %s โพสต์ active · รอบ1=%s รอบ2=%s รอบ3=%s · โพสต์ที่พลาด "ครบ 3 รอบ"=%s',
      (select count(*) from analytics.v_content_post_missed_window where shop_id = v_shop),
      (select count(distinct post_id) from analytics.v_content_post_missed_window where shop_id = v_shop),
      (select count(*) from analytics.v_content_post_missed_window where shop_id = v_shop and read_round = 1),
      (select count(*) from analytics.v_content_post_missed_window where shop_id = v_shop and read_round = 2),
      (select count(*) from analytics.v_content_post_missed_window where shop_id = v_shop and read_round = 3),
      (select count(*) from (select post_id from analytics.v_content_post_missed_window where shop_id = v_shop group by post_id having count(*) = 3) z)));
    -- ลำดับ: posted_at desc
    v_log := v_log || pg_temp.vb('W5', 'เรียง posted_at desc', (select bool_and(posted_at <= lag_p) from (select posted_at, lag(posted_at) over () as lag_p from analytics.v_content_post_missed_window where shop_id = v_shop) z where lag_p is not null) is not false);

    -- ==========================================================================
    -- O. v_content_order_daily — เทียบนับอิสระจาก fact_order (7 วันล่าสุด + ทั้งประวัติ) · ไม่มี PII
    -- ==========================================================================
    if to_regclass('public.product') is null then
      v_log := v_log || E'[SKIP] O — ไม่พบ public.product สำหรับนับเงินแท่งอิสระ\n';
    else
      -- 7 วันล่าสุด (วันไทยวันนี้ − 6 .. วันนี้)
      select count(*) into v_n from analytics.fact_order fo where fo.shop_id = v_shop and fo.order_date between v_today - 6 and v_today;
      select coalesce(sum(orders_n), 0) into v_n2 from analytics.v_content_order_daily where shop_id = v_shop and affinity = 'all' and order_date between v_today - 6 and v_today;
      v_log := v_log || pg_temp.vb('O1', 'ออเดอร์ทั้งหมด 7 วันล่าสุด: นับตรงจาก fact_order = sum(view affinity=all)', v_n = v_n2, v_n || ' vs ' || v_n2);
      select count(*) into v_n from analytics.fact_order fo join analytics.dim_channel dc on dc.id = fo.channel_id
       where fo.shop_id = v_shop and dc.code = 'line_oa' and fo.order_date between v_today - 6 and v_today;
      select coalesce(sum(orders_n), 0) into v_n2 from analytics.v_content_order_daily where shop_id = v_shop and affinity = 'all' and channel_code = 'line_oa' and order_date between v_today - 6 and v_today;
      v_log := v_log || pg_temp.vb('O2', 'ออเดอร์ LINE 7 วันล่าสุด ตรง', v_n = v_n2, v_n || ' vs ' || v_n2);
      select count(*) into v_n from analytics.fact_order fo join analytics.dim_channel dc on dc.id = fo.channel_id
       where fo.shop_id = v_shop and dc.code = 'line_oa' and fo.order_date between v_today - 6 and v_today
         and exists (select 1 from analytics.fact_order_item fi join public.product p on p.id = fi.product_id where fi.fact_order_id = fo.id and p.category = 'เงินแท่ง');
      select coalesce(sum(orders_n), 0) into v_n2 from analytics.v_content_order_daily where shop_id = v_shop and affinity = 'bar' and channel_code = 'line_oa' and order_date between v_today - 6 and v_today;
      v_log := v_log || pg_temp.vb('O3', 'ออเดอร์ LINE ที่มีเงินแท่ง (category=เงินแท่ง) 7 วันล่าสุด ตรง', v_n = v_n2, v_n || ' vs ' || v_n2);
      select count(*) into v_n from analytics.fact_order fo
       where fo.shop_id = v_shop and fo.order_date between v_today - 6 and v_today
         and exists (select 1 from analytics.fact_order_item fi join public.product p on p.id = fi.product_id where fi.fact_order_id = fo.id and p.category = 'เงินแท่ง');
      select coalesce(sum(orders_n), 0) into v_n2 from analytics.v_content_order_daily where shop_id = v_shop and affinity = 'bar' and order_date between v_today - 6 and v_today;
      v_log := v_log || pg_temp.vb('O4', 'ออเดอร์ที่มีเงินแท่ง ทุกช่องทาง 7 วันล่าสุด ตรง', v_n = v_n2, v_n || ' vs ' || v_n2);
      v_log := v_log || pg_temp.note('O5 ตัวเลข 7 วันล่าสุด', format('ทั้งหมด=%s · LINE=%s · เงินแท่ง(ทุกช่อง)=%s · เงินแท่ง×LINE=%s · jewelry=%s',
        (select coalesce(sum(orders_n), 0) from analytics.v_content_order_daily where shop_id = v_shop and affinity = 'all' and order_date between v_today - 6 and v_today),
        (select coalesce(sum(orders_n), 0) from analytics.v_content_order_daily where shop_id = v_shop and affinity = 'all' and channel_code = 'line_oa' and order_date between v_today - 6 and v_today),
        (select coalesce(sum(orders_n), 0) from analytics.v_content_order_daily where shop_id = v_shop and affinity = 'bar' and order_date between v_today - 6 and v_today),
        (select coalesce(sum(orders_n), 0) from analytics.v_content_order_daily where shop_id = v_shop and affinity = 'bar' and channel_code = 'line_oa' and order_date between v_today - 6 and v_today),
        (select coalesce(sum(orders_n), 0) from analytics.v_content_order_daily where shop_id = v_shop and affinity = 'jewelry' and order_date between v_today - 6 and v_today)));
      -- ทั้งประวัติ: ทุก (วัน × ช่องทาง × affinity) เทียบ diff สองทาง
      with ind as (
        select fo.shop_id, fo.order_date, dc.code as channel_code, 'all'::text as affinity, count(*)::int as n
          from analytics.fact_order fo join analytics.dim_channel dc on dc.id = fo.channel_id group by 1, 2, 3
        union all
        select fo.shop_id, fo.order_date, dc.code, 'bar', count(*)::int
          from analytics.fact_order fo join analytics.dim_channel dc on dc.id = fo.channel_id
         where exists (select 1 from analytics.fact_order_item fi join public.product p on p.id = fi.product_id where fi.fact_order_id = fo.id and p.category = 'เงินแท่ง')
         group by 1, 2, 3),
      vw as (select shop_id, order_date, channel_code, affinity, orders_n as n from analytics.v_content_order_daily where affinity in ('all', 'bar'))
      select (select count(*) from (select * from ind except select * from vw) a) as f1, (select count(*) from (select * from vw except select * from ind) b) as f2, (select count(*) from ind) as f3
        into r;
      v_log := v_log || pg_temp.vb('O6', 'ทั้งประวัติ (วัน×ช่องทาง×{all,bar}) view = นับอิสระ ทุกแถว (ขาด/เกิน = 0)', r.f1 = 0 and r.f2 = 0, 'ขาด ' || r.f1 || ' · เกิน ' || r.f2 || ' · จาก ' || r.f3 || ' กลุ่ม');
      select count(*) into v_n from analytics.v_content_order_daily where orders_n <= 0 or affinity not in ('all', 'bar', 'jewelry') or channel_code is null or order_date is null;
      v_log := v_log || pg_temp.vb('O7', 'ไม่มีแถวนับ ≤0 · affinity อยู่ใน 3 ค่า · ไม่มี channel/date null', v_n = 0, 'พบ ' || v_n);
      select count(*) into v_n from (select shop_id, order_date, channel_code, affinity from analytics.v_content_order_daily group by 1, 2, 3, 4 having count(*) > 1) z;
      v_log := v_log || pg_temp.vb('O8', 'คีย์ (ร้าน·วัน·ช่องทาง·affinity) ไม่ซ้ำ', v_n = 0, 'ซ้ำ ' || v_n);
      v_log := v_log || pg_temp.vb('O9', 'คอลัมน์ view ออเดอร์ = 5 คอลัมน์เป๊ะ (shop_id · order_date · channel_code · affinity · orders_n) ไม่มีเงิน/ลูกค้า',
        (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'analytics' and table_name = 'v_content_order_daily') = 'shop_id,order_date,channel_code,affinity,orders_n');
      -- ออเดอร์ที่ไม่มี line item (18 ใบใน 7 วัน) ต้องนับใน all แต่ไม่นับใน bar/jewelry
      select count(*) into v_n from analytics.fact_order fo where fo.shop_id = v_shop and not exists (select 1 from analytics.fact_order_item fi where fi.fact_order_id = fo.id);
      v_log := v_log || pg_temp.note('O10 ออเดอร์ที่ไม่มี line item (นับใน all เท่านั้น)', v_n::text);
      -- ประสิทธิภาพ: query แบบแอป (ช่วง 7 วัน) vs ทั้งตาราง
      v_t0 := clock_timestamp();
      perform count(*) from analytics.v_content_order_daily where shop_id = v_shop and order_date between v_today - 6 and v_today;
      v_ms1 := extract(epoch from clock_timestamp() - v_t0) * 1000;
      v_t0 := clock_timestamp();
      perform count(*) from analytics.v_content_order_daily;
      v_ms2 := extract(epoch from clock_timestamp() - v_t0) * 1000;
      v_log := v_log || pg_temp.note('O11 เวลา view ออเดอร์', format('กรองร้าน+7 วัน %s ms · ทั้งตาราง %s ms (fact_order %s แถว)', round(v_ms1), round(v_ms2), (select count(*) from analytics.fact_order)));
      v_log := v_log || pg_temp.vb('O12', 'service_role อ่าน view ออเดอร์ได้ภายใต้ role จริง', pg_temp.vq('service_role', 'select count(*)::text from analytics.v_content_order_daily') not like 'ERR:%');
    end if;

    -- ==========================================================================
    -- Z. สิทธิ์ของ view/ตารางใหม่ภายใต้ role จริง (anon/authenticated ต้องอ่านไม่ได้)
    -- ==========================================================================
    foreach v_t in array array['v_content_post_missed_window', 'v_content_post_result', 'v_content_hook_type_rollup', 'v_content_order_daily', 'content_post_metric_amend_log'] loop
      v_log := v_log || pg_temp.vb('Z.' || v_t, 'service_role อ่านได้ · anon ไม่มี SELECT · authenticated ไม่มี SELECT',
        has_table_privilege('service_role', 'analytics.' || v_t, 'select') and not has_table_privilege('anon', 'analytics.' || v_t, 'select')
        and not has_table_privilege('authenticated', 'analytics.' || v_t, 'select'));
    end loop;
  end if;

  exception when others then
    v_log := v_log || format(E'[FAIL] ABORT qa-0161-extra หยุดกลางทาง sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;
  begin execute 'reset role'; exception when others then null; end;
  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_ok   := (length(v_log) - length(replace(v_log, '[OK]', ''))) / 4;
  v_log := v_log || format(E'\n=== สรุป: [OK] %s · [FAIL] %s — raise ด้านล่างบังคับ ROLLBACK ทั้งหมด ===\n', v_ok, v_fail);
  raise exception '%', v_log;
end;
$qa0161$;
