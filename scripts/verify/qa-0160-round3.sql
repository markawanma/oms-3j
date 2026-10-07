-- scripts/verify/qa-0160-round3.sql (QA R2-D2, 7 ต.ค. 69) — regression ของ trigger content_post_guard_link (0160 รอบ 3) + 0159 รอบเก็บงาน
-- รัน: cat qa-0160-pre.sql 0159 0160 qa-0160-round3.sql > tmp.sql && node scripts/run-sql.mjs tmp.sql (ไม่ใส่ --commit · ผลออกที่ raise ท้ายไฟล์)
-- ทุกคำสั่งทดสอบรันภายใต้ set local role service_role จริง · T trigger · Q คิวเดิม · V view · F FK set null · I -infinity · C caption · S stale_sources

create or replace function pg_temp.qx_ex(p_sql text, p_expect text[], p_like text default null) returns text
 language plpgsql as $f$
declare v_state text; v_msg text;
begin
  execute p_sql;
  return 'FAIL ผ่านทั้งที่ควรปฏิเสธ';
exception when others then
  get stacked diagnostics v_msg = message_text;
  v_state := sqlstate;
  if v_state = any (p_expect) then
    if p_like is not null and position(p_like in v_msg) = 0 then
      return 'FAIL sqlstate ถูก (' || v_state || ') แต่ข้อความไม่มี "' || p_like || '" → ' || left(v_msg, 160);
    end if;
    return 'OK ' || v_state || ' ' || left(v_msg, 70);
  end if;
  return 'FAIL sqlstate=' || v_state || ' (คาด ' || array_to_string(p_expect, '/') || ') msg=' || left(v_msg, 160);
end $f$;

create or replace function pg_temp.qx_ok(p_sql text) returns text
 language plpgsql as $f$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return 'FAIL ควรสำเร็จแต่ตก sqlstate=' || sqlstate || ' msg=' || left(sqlerrm, 200);
end $f$;

create or replace function pg_temp.lg(p_id text, p_what text, p_res text) returns text
 language sql as $f$
  select '[' || case when p_res like 'OK%' and p_res not like '%FAIL%' then 'OK' else 'FAIL' end || '] ' || p_id || ' ' || p_what || ' → ' || p_res || E'\n'
$f$;

create or replace function pg_temp.bb(p_id text, p_what text, p_cond boolean, p_detail text default '') returns text
 language sql as $f$
  select '[' || case when p_cond is true then 'OK' else 'FAIL' end || '] ' || p_id || ' ' || p_what
         || case when p_detail <> '' then ' → ' || p_detail else '' end || E'\n'
$f$;

create or replace function pg_temp.nn(p_id text, p_what text) returns text
 language sql as $f$ select '[NOTE] ' || p_id || ' ' || p_what || E'\n' $f$;

-- สร้างชิ้นผ่าน RPC จริง · p_stage: planned | in_review | approved | produced · p_dayoff = วันที่ตั้งเทียบวันนี้ไทย
create or replace function pg_temp.mkp(p_shop uuid, p_kind text, p_channel text, p_stage text default 'produced', p_dayoff int default 5) returns uuid
 language plpgsql as $f$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_s uuid; v_a uuid;
begin
  v_s := analytics.content_piece_create(p_shop, 'qa160 ' || p_kind || ' ' || substr(gen_random_uuid()::text, 1, 8), p_kind, p_channel, 'jewelry_925', 'owner', v_today + p_dayoff);
  if p_stage = 'planned' then return v_s; end if;
  perform analytics.content_piece_advance(p_shop, v_s, 'drafting', 'owner');
  select a.id into v_a from analytics.step_artifact a where a.step_id = v_s;
  if p_kind in ('short_clip', 'live_cut') then
    perform analytics.content_hook_upsert(p_shop, v_s, 'A', 'qa hook A', 'question', null, 'owner', null);
    perform analytics.content_hook_upsert(p_shop, v_s, 'B', 'qa hook B', 'fact', null, 'owner', null);
    perform analytics.campaign_set_artifact_content(v_a, 'qa body',
      jsonb_build_object('segments', jsonb_build_array(jsonb_build_object('role', 'hook')),
                         'shots', jsonb_build_array(jsonb_build_object('id', 's1', 'desc', 'ถ่ายหน้าโต๊ะ'), jsonb_build_object('id', 's2', 'desc', 'ใกล้ๆ'))));
  else
    perform analytics.campaign_set_artifact_content(v_a, 'qa body', null);
  end if;
  perform analytics.content_piece_advance(p_shop, v_s, 'in_review', 'owner');
  if p_stage = 'in_review' then return v_s; end if;
  perform analytics.content_gate_record(p_shop, v_s, 'fact_check', 'passed', 'owner', jsonb_build_object('sources', jsonb_build_array('https://example.com/qa160')));
  perform analytics.content_gate_record(p_shop, v_s, 'brand_rule', 'passed', 'owner');
  perform analytics.content_gate_record(p_shop, v_s, 'risk_owner', 'passed', 'owner');
  perform analytics.content_piece_advance(p_shop, v_s, 'approved', 'owner', null, 45);
  if p_stage = 'approved' then return v_s; end if;
  perform analytics.content_piece_advance(p_shop, v_s, 'produced', 'owner');
  return v_s;
end $f$;

create or replace function pg_temp.st(p_step uuid) returns text
 language sql as $f$
  select piece_status || '/' || status || coalesce('/hold=' || hold_reason, '') from analytics.campaign_step where id = p_step
$f$;

create or replace function pg_temp.hk(p_step uuid, p_label text) returns uuid
 language sql as $f$ select id from analytics.content_hook where step_id = p_step and label = p_label $f$;

create or replace function pg_temp.pid(p_j jsonb) returns uuid
 language sql as $f$ select (p_j ->> 'post_id')::uuid $f$;

-- ภาพรวมที่ต้องไม่ขยับเมื่อ RPC ปฏิเสธ
create or replace function pg_temp.snap() returns text
 language sql as $f$
  select (select count(*) || ':' || md5(coalesce(string_agg(concat_ws('|', id, step_id, hook_id, post_url, posted_at, status, artifact_id), ',' order by id), '')) from analytics.content_post)
      || '/' || (select count(*) || ':' || md5(coalesce(string_agg(concat_ws('|', id, text, step_id, label), ',' order by id), '')) from analytics.content_hook)
      || '/' || (select count(*) from analytics.content_piece_event)
      || '/' || (select md5(coalesce(string_agg(concat_ws('|', id, piece_status, status, offset_start_days), ',' order by id), '')) from analytics.campaign_step)
$f$;


-- อ่าน view ทุกตัวภายใต้ role ปัจจุบัน — คืนรายชื่อ view ที่พัง (ว่าง = ครบ)
create or replace function pg_temp.rdv() returns text
 language plpgsql as $f$
declare v_bad text := ''; vn text;
begin
  foreach vn in array array['v_content_piece','v_content_piece_calendar','v_content_inbox_counts','v_line_quota_28d','v_content_hook_library','v_content_entry_queue','v_content_post_t7'] loop
    begin
      execute 'select md5(coalesce(string_agg(t::text, '','' order by t::text), '''')) from analytics.' || vn || ' t';
    exception when others then v_bad := v_bad || vn || ':' || sqlstate || ' ';
    end;
  end loop;
  return v_bad;
end $f$;

do $qa0160r3$
declare
  v_log   text := E'\n=== qa-0160-round3 ===\n';
  v_shop  uuid;
  v_n     bigint; v_n2 bigint;
  v_r     text; v_txt text; v_bad text;
  v_b     boolean;
  v_j     jsonb;
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_sf uuid; v_sg uuid;
  v_p1 uuid; v_p2 uuid; v_p9 uuid; v_pq uuid; v_pf uuid;
  v_a1 uuid; v_a2 uuid; v_af uuid; v_ag uuid;
  v_hA uuid;
  v_snap text;
  v_ok int; v_fail int; v_note int;
  i int;
  rr record;
  c_tt constant text := 'https://www.tiktok.com/@qa160r3/video/';
begin
  begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  select id into v_shop from public.shop;

  -- setup (owner/definer)
  v_s1 := pg_temp.mkp(v_shop, 'short_clip', 'tiktok', 'produced');
  v_s2 := pg_temp.mkp(v_shop, 'short_clip', 'tiktok', 'produced');
  select a.id into v_a1 from analytics.step_artifact a where a.step_id = v_s1;
  select a.id into v_a2 from analytics.step_artifact a where a.step_id = v_s2;
  v_hA := pg_temp.hk(v_s2, 'A');
  v_j  := analytics.content_piece_post(v_shop, v_s1, 'tiktok', c_tt || 'p1', c_tt || 'p1', now() - interval '2 days', 'owner', pg_temp.hk(v_s1, 'A'));
  v_p1 := pg_temp.pid(v_j);
  v_p9 := analytics.content_post_upsert(v_shop, 'tiktok', c_tt || 'p9', c_tt || 'p9', now() - interval '1 day');

  ----------------------------------------------------------------------------
  -- T. trigger ภายใต้ service_role จริง
  ----------------------------------------------------------------------------
  begin
    execute 'set local role service_role';
    v_snap := pg_temp.snap();
    v_log := v_log || pg_temp.lg('T1a', 'service_role INSERT content_post ที่มี step_id ตรง → 55000', pg_temp.qx_ex(format('insert into analytics.content_post (shop_id, platform, external_id, post_url, posted_at, posted_date_th, step_id) values (%L::uuid, ''tiktok'', %L, %L, now(), current_date, %L::uuid)', v_shop, c_tt || 't1a', c_tt || 't1a', v_s2), array['55000']));
    v_log := v_log || pg_temp.lg('T1a2', 'service_role INSERT ที่มี hook_id ตรง → 55000', pg_temp.qx_ex(format('insert into analytics.content_post (shop_id, platform, external_id, post_url, posted_at, posted_date_th, hook_id) values (%L::uuid, ''tiktok'', %L, %L, now(), current_date, %L::uuid)', v_shop, c_tt || 't1b', c_tt || 't1b', v_hA), array['55000']));
    v_log := v_log || pg_temp.lg('T1b', 'service_role UPDATE step_id ของโพสต์ที่ยังไม่ผูก → 55000', pg_temp.qx_ex(format('update analytics.content_post set step_id = %L::uuid where id = %L::uuid', v_s2, v_p9), array['55000']));
    perform set_config('c2.piece_rpc', '1', true);
    v_log := v_log || pg_temp.lg('T1c', 'service_role ตั้ง GUC c2.piece_rpc=1 เองแล้ว UPDATE step_id → ยัง 55000', pg_temp.qx_ex(format('update analytics.content_post set step_id = %L::uuid where id = %L::uuid', v_s2, v_p9), array['55000']));
    v_log := v_log || pg_temp.lg('T1c2', 'GUC=1 + UPDATE hook_id ตรง → 55000', pg_temp.qx_ex(format('update analytics.content_post set hook_id = %L::uuid where id = %L::uuid', v_hA, v_p9), array['55000']));
    v_log := v_log || pg_temp.lg('T1c3', 'GUC=1 + INSERT ที่มี step_id → 55000', pg_temp.qx_ex(format('insert into analytics.content_post (shop_id, platform, external_id, post_url, posted_at, posted_date_th, step_id) values (%L::uuid, ''tiktok'', %L, %L, now(), current_date, %L::uuid)', v_shop, c_tt || 't1c', c_tt || 't1c', v_s2), array['55000']));
    perform set_config('c2.piece_rpc', '', true);
    v_log := v_log || pg_temp.lg('T1d', 'service_role UPDATE hook_id ของโพสต์ที่ผูกชิ้นแล้ว → 55000', pg_temp.qx_ex(format('update analytics.content_post set hook_id = %L::uuid where id = %L::uuid', v_hA, v_p1), array['55000']));
    v_log := v_log || pg_temp.lg('T1e', 'service_role UPDATE artifact_id ของโพสต์ที่ผูกชิ้นแล้ว → 55000', pg_temp.qx_ex(format('update analytics.content_post set artifact_id = %L::uuid where id = %L::uuid', v_a2, v_p1), array['55000']));
    v_log := v_log || pg_temp.lg('T1e2', 'service_role UPDATE artifact_id = null ของโพสต์ที่ผูกชิ้น → 55000', pg_temp.qx_ex(format('update analytics.content_post set artifact_id = null where id = %L::uuid', v_p1), array['55000']));
    v_log := v_log || pg_temp.lg('T1f', 'service_role UPDATE step_id = null (ปลดตรง) → 55000', pg_temp.qx_ex(format('update analytics.content_post set step_id = null where id = %L::uuid', v_p1), array['55000']));
    v_log := v_log || pg_temp.bb('T1z', 'ข้อมูลไม่ขยับหลัง T1a-T1f (snap เท่าเดิม)', pg_temp.snap() = v_snap, '');
    -- ต้องไม่พัง
    v_log := v_log || pg_temp.lg('T2a', 'UPDATE no-op (set updated_at) บนโพสต์ผูกชิ้น → OK', pg_temp.qx_ok(format('update analytics.content_post set updated_at = now() where id = %L::uuid', v_p1)));
    v_log := v_log || pg_temp.lg('T2b', 'UPDATE caption_snapshot ตรงบนโพสต์ผูกชิ้น → OK (ไม่ใช่คอลัมน์ที่ guard)', pg_temp.qx_ok(format('update analytics.content_post set caption_snapshot = ''แก้ตรง'' where id = %L::uuid', v_p1)));
    v_log := v_log || pg_temp.lg('T2c', 'UPDATE status deleted ตรงบนโพสต์ผูกชิ้น → OK', pg_temp.qx_ok(format('update analytics.content_post set status = ''deleted'' where id = %L::uuid', v_p1)));
    v_log := v_log || pg_temp.lg('T2d', 'เปิดกลับ active ตรง (ไม่มีโพสต์ active platform เดียวกันในชิ้น) → OK', pg_temp.qx_ok(format('update analytics.content_post set status = ''active'' where id = %L::uuid', v_p1)));
    v_log := v_log || pg_temp.lg('T2e', 'content_post_set_status RPC → deleted บนโพสต์ผูกชิ้น → OK', pg_temp.qx_ok(format('select analytics.content_post_set_status(%L::uuid, %L::uuid, ''deleted'')', v_shop, v_p1)));
    v_s3 := pg_temp.mkp(v_shop, 'ig_fb_post', 'facebook', 'produced');
    v_j := analytics.content_piece_post(v_shop, v_s3, 'facebook', 'qa160r3-t3a', 'https://www.facebook.com/qa160r3/posts/t3a', now() - interval '3 hours', 'owner');
    v_p2 := pg_temp.pid(v_j);
    perform analytics.content_post_set_status(v_shop, v_p2, 'deleted');
    v_pf := analytics.content_post_upsert(v_shop, 'facebook', 'qa160r3-t3b', 'https://www.facebook.com/qa160r3/posts/t3b', now() - interval '2 hours');
    v_log := v_log || pg_temp.lg('T3a', 'link_step โพสต์ facebook ใหม่เข้าชิ้นที่โพสต์ facebook เดิมถูก deleted → OK (ไม่นับ deleted)', pg_temp.qx_ok(format('select analytics.content_post_link_step(%L::uuid,%L::uuid,%L::uuid,''owner'')', v_shop, v_pf, v_s3)));
    v_log := v_log || pg_temp.lg('T3b', 'S-L2 เปิดโพสต์เดิมกลับผ่าน RPC set_status ขณะโพสต์ใหม่ active platform เดียวกันในชิ้น → 55000', pg_temp.qx_ex(format('select analytics.content_post_set_status(%L::uuid, %L::uuid, ''active'')', v_shop, v_p2), array['55000']));
    v_log := v_log || pg_temp.lg('T3c', 'S-L2 เปิดกลับตรงด้วย UPDATE (service_role) → 55000', pg_temp.qx_ex(format('update analytics.content_post set status = ''active'' where id = %L::uuid', v_p2), array['55000']));
    perform analytics.content_post_unlink_step(v_shop, v_pf, 'ทดสอบ T3', 'owner');
    v_log := v_log || pg_temp.lg('T3c3', 'ปลดโพสต์ใหม่ออกจากชิ้นแล้ว เปิดโพสต์เดิมกลับ → OK (ไม่ชนแล้ว)', pg_temp.qx_ok(format('select analytics.content_post_set_status(%L::uuid, %L::uuid, ''active'')', v_shop, v_p2)));
    v_log := v_log || pg_temp.lg('T3d', 'โพสต์ไม่ผูกชิ้น (p9) deleted → OK', pg_temp.qx_ok(format('select analytics.content_post_set_status(%L::uuid, %L::uuid, ''deleted'')', v_shop, v_p9)));
    v_log := v_log || pg_temp.lg('T3e', 'p9 เปิดกลับ active → OK (ด่าน S-L2 เฉพาะที่ผูกชิ้น)', pg_temp.qx_ok(format('select analytics.content_post_set_status(%L::uuid, %L::uuid, ''active'')', v_shop, v_p9)));
    v_log := v_log || pg_temp.lg('T3f', 'DELETE content_post ตรง (โพสต์ไม่ผูกชิ้น p9) → OK ไม่ถูก trigger ขวาง', pg_temp.qx_ok(format('delete from analytics.content_post where id = %L::uuid', v_p9)));
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_log := v_log || format(E'[FAIL] T ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  ----------------------------------------------------------------------------
  -- Q. คิววางลิงก์เดิม (content_post_upsert) บนโพสต์ที่ผูกชิ้นแล้ว — ภายใต้ service_role
  ----------------------------------------------------------------------------
  begin
    v_sg := pg_temp.mkp(v_shop, 'short_clip', 'tiktok', 'produced');
    select a.id into v_ag from analytics.step_artifact a where a.step_id = v_sg;
    v_j := analytics.content_piece_post(v_shop, v_sg, 'tiktok', c_tt || 'q1', c_tt || 'q1', now() - interval '2 days', 'owner', pg_temp.hk(v_sg, 'A'));
    v_pq := pg_temp.pid(v_j);
    select count(*) into v_n from analytics.content_post where id = v_pq and step_id = v_sg and hook_id is not null and artifact_id = v_ag;
    v_log := v_log || pg_temp.bb('Q0', 'setup: โพสต์ผูก step + hook + artifact ของชิ้นนั้น', v_n = 1, '');
    v_snap := (select concat_ws('|', step_id, hook_id, artifact_id) from analytics.content_post where id = v_pq);
    execute 'set local role service_role';
    v_log := v_log || pg_temp.lg('Q1', 'คิววางซ้ำค่าเดิมบนโพสต์ผูกชิ้น → OK', pg_temp.qx_ok(format('select analytics.content_post_upsert(%L::uuid,''tiktok'',%L,%L,now() - interval ''2 days'')', v_shop, c_tt || 'q1', c_tt || 'q1')));
    v_log := v_log || pg_temp.lg('Q2', 'คิววางซ้ำพร้อม artifact ของชิ้นเดียวกัน (calendar/[stepId] ส่ง artifactId) → OK', pg_temp.qx_ok(format('select analytics.content_post_upsert(%L::uuid,''tiktok'',%L,%L,now() - interval ''2 days'', null, %L::uuid)', v_shop, c_tt || 'q1', c_tt || 'q1', v_ag)));
    v_log := v_log || pg_temp.lg('Q3', 'คิววางซ้ำ + ประเภท + caption ใหม่ บนโพสต์ผูกชิ้น → OK', pg_temp.qx_ok(format('select analytics.content_post_upsert(%L::uuid,''tiktok'',%L,%L,now() - interval ''2 days'', (select code from analytics.content_type order by code limit 1), null, ''caption ใหม่ 🔥'')', v_shop, c_tt || 'q1', c_tt || 'q1')));
    v_log := v_log || pg_temp.lg('Q3b', 'content_post_update_type บนโพสต์ผูกชิ้น → OK', pg_temp.qx_ok(format('select analytics.content_post_update_type(%L::uuid,%L::uuid,(select code from analytics.content_type order by code desc limit 1))', v_shop, v_pq)));
    v_log := v_log || pg_temp.lg('Q3c', 'content_post_metric_upsert บนโพสต์ผูกชิ้น → OK', pg_temp.qx_ok(format('select analytics.content_post_metric_upsert(%L::uuid,%L::uuid,100,5,1,3,1,''manual'')', v_shop, v_pq)));
    v_r := pg_temp.qx_ex(format('select analytics.content_post_upsert(%L::uuid,''tiktok'',%L,%L,now() - interval ''2 days'', null, %L::uuid)', v_shop, c_tt || 'q1', c_tt || 'q1', v_a2), array['55000']);
    v_log := v_log || case when v_r like 'OK%' then pg_temp.lg('Q5', 'ด่านตาราง: คิววางซ้ำโดยส่ง artifact ของ "ชิ้นอื่น" บนโพสต์ผูกชิ้น → 55000 (เดิม 0148 เงียบๆ ย้าย artifact_id ผิดชิ้น)', v_r)
      else pg_temp.nn('Q5', 'คิวเดิมส่ง artifact ของชิ้นอื่นบนโพสต์ผูกชิ้นแล้ว ผลเปลี่ยน: ' || v_r) end;
    execute 'reset role';
    select concat_ws('|', step_id, hook_id, artifact_id) into v_txt from analytics.content_post where id = v_pq;
    v_log := v_log || pg_temp.bb('Q6', 'หลัง Q1-Q5 step_id/hook_id/artifact_id ของโพสต์ผูกชิ้นไม่ขยับ', v_txt = v_snap, '');
    v_pf := analytics.content_post_upsert(v_shop, 'tiktok', c_tt || 'q9', c_tt || 'q9', now() - interval '1 day');
    execute 'set local role service_role';
    v_log := v_log || pg_temp.lg('Q7', 'โพสต์นอกแผนผูก artifact ผ่านคิว แล้วเปลี่ยนเป็น artifact อื่น → OK ทั้งสองครั้ง',
      pg_temp.qx_ok(format('select analytics.content_post_upsert(%L::uuid,''tiktok'',%L,%L,now() - interval ''1 day'', null, %L::uuid)', v_shop, c_tt || 'q9', c_tt || 'q9', v_a1))
      || ' / ' || pg_temp.qx_ok(format('select analytics.content_post_upsert(%L::uuid,''tiktok'',%L,%L,now() - interval ''1 day'', null, %L::uuid)', v_shop, c_tt || 'q9', c_tt || 'q9', v_a2)));
    perform analytics.content_post_set_status(v_shop, v_pq, 'deleted');
    v_log := v_log || pg_temp.lg('Q8', 'โพสต์ผูกชิ้นถูก deleted แล้ววางซ้ำผ่านคิว → 22023 (L1 เดิม)', pg_temp.qx_ex(format('select analytics.content_post_upsert(%L::uuid,''tiktok'',%L,%L,now() - interval ''2 days'')', v_shop, c_tt || 'q1', c_tt || 'q1'), array['22023']));
    perform analytics.content_post_set_status(v_shop, v_pq, 'active');
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_log := v_log || format(E'[FAIL] Q ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  ----------------------------------------------------------------------------
  -- V. view คิว + T+7 กับโพสต์ผูกชิ้น · อ่านทุก view ภายใต้ service_role
  ----------------------------------------------------------------------------
  begin
    execute 'set local role service_role';
    v_bad := pg_temp.rdv();
    select count(*) into v_n from analytics.v_content_entry_queue where post_id = v_pq;
    execute 'reset role';
    v_log := v_log || pg_temp.bb('V1', 'หลังทดสอบข้างบน view 7 ตัวอ่านได้ครบภายใต้ service_role', v_bad = '', coalesce(nullif(v_bad, ''), 'ครบ'));
    v_log := v_log || pg_temp.bb('V2', 'โพสต์ผูกชิ้นอายุ 2 วัน: อยู่ในคิวกรอก metric หรือมี metric แล้ว (ไม่ตกหล่นเพราะผูกชิ้น)', v_n = 1 or exists (select 1 from analytics.content_post_metric m where m.post_id = v_pq), 'in_queue=' || v_n);
    perform analytics.content_post_set_status(v_shop, v_pq, 'deleted');
    select count(*) into v_n from analytics.v_content_entry_queue where post_id = v_pq;
    select count(*) into v_n2 from analytics.v_content_post_t7 where post_id = v_pq and status = 'active';
    perform analytics.content_post_set_status(v_shop, v_pq, 'active');
    v_log := v_log || pg_temp.bb('V3', 'โพสต์ผูกชิ้นที่ deleted → หายจากคิว และ T+7 ไม่นับ active', v_n = 0 and v_n2 = 0, format('queue=%s t7_active=%s', v_n, v_n2));
  exception when others then
    execute 'reset role';
    v_log := v_log || format(E'[FAIL] V ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  ----------------------------------------------------------------------------
  -- F. FK on delete set null (artifact / step) กับ trigger
  ----------------------------------------------------------------------------
  begin
    v_sf := pg_temp.mkp(v_shop, 'ig_fb_post', 'facebook', 'planned');
    select a.id into v_af from analytics.step_artifact a where a.step_id = v_sf;
    v_pf := analytics.content_post_upsert(v_shop, 'facebook', 'qa160r3-f1', 'https://www.facebook.com/qa160r3/posts/f1', now() - interval '1 day', null, v_af);
    execute 'set local role service_role';
    v_r := pg_temp.qx_ok(format('delete from analytics.step_artifact where id = %L::uuid', v_af));
    execute 'reset role';
    select (artifact_id is null)::text into v_txt from analytics.content_post where id = v_pf;
    v_log := v_log || case when v_r = 'OK' then pg_temp.bb('F1', 'ลบ step_artifact ที่โพสต์นอกแผนอ้างอยู่ (FK set null) ไม่ถูก trigger ขวาง · artifact_id → null', v_txt = 'true', v_r || ' artifact_null=' || v_txt)
      else pg_temp.nn('F1', 'ลบ step_artifact ที่โพสต์อ้างอยู่ตรงๆ ถูกขวาง: ' || v_r) end;
    v_sf := pg_temp.mkp(v_shop, 'ig_fb_post', 'facebook', 'planned');
    select a.id into v_af from analytics.step_artifact a where a.step_id = v_sf;
    v_pf := analytics.content_post_upsert(v_shop, 'facebook', 'qa160r3-f2', 'https://www.facebook.com/qa160r3/posts/f2', now() - interval '1 day', null, v_af);
    execute 'set local role service_role';
    v_r := pg_temp.qx_ok(format('delete from analytics.campaign_step where id = %L::uuid', v_sf));
    execute 'reset role';
    select (artifact_id is null)::text into v_txt from analytics.content_post where id = v_pf;
    v_log := v_log || case when v_r = 'OK' then pg_temp.bb('F2', 'ลบชิ้น planned (cascade ลบ artifact) ที่โพสต์อ้าง artifact → artifact_id null · ไม่ถูก trigger ขวาง', v_txt = 'true', v_r || ' artifact_null=' || v_txt)
      else pg_temp.nn('F2', 'ลบชิ้น planned ตรงๆ ถูกขวาง: ' || v_r) end;
    execute 'set local role service_role';
    v_log := v_log || pg_temp.lg('F3', 'ลบชิ้นที่มีโพสต์ผูก (posted) ตรงๆ ใต้ service_role → ปฏิเสธ 55000 (กันที่ 0159)', pg_temp.qx_ex(format('delete from analytics.campaign_step where id = %L::uuid', v_s1), array['55000']));
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_log := v_log || format(E'[FAIL] F ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  ----------------------------------------------------------------------------
  -- I. posted_at = -infinity / 1970 ผ่านคิวเดิม → view ใหม่ของ 0160 ทั้งร้านพังไหม
  ----------------------------------------------------------------------------
  begin
    begin
      execute 'set local role service_role';
      v_r := pg_temp.qx_ok(format('select analytics.content_post_upsert(%L::uuid,''tiktok'',%L,%L,''-infinity''::timestamptz)', v_shop, c_tt || 'inf1', c_tt || 'inf1'));
      v_bad := pg_temp.rdv();
      execute 'reset role';
      v_log := v_log || case when v_r <> 'OK' then pg_temp.nn('I1', 'คิวเดิมปฏิเสธ -infinity: ' || v_r)
        when v_bad = '' then pg_temp.nn('I1', 'คิวเดิมรับ posted_at=-infinity (โพสต์ไม่ผูกชิ้น) · view ทั้ง 7 ยังอ่านได้')
        else pg_temp.nn('I1', 'คิวเดิมรับ posted_at=-infinity (โพสต์ไม่ผูกชิ้น) · view พัง: ' || v_bad) end;
      raise exception 'qa_rollback' using errcode = 'QA001';
    exception when sqlstate 'QA001' then execute 'reset role';
    end;
    v_s3 := pg_temp.mkp(v_shop, 'short_clip', 'tiktok', 'produced');
    v_j := analytics.content_piece_post(v_shop, v_s3, 'tiktok', c_tt || 'i2', c_tt || 'i2', now() - interval '2 days', 'owner', pg_temp.hk(v_s3, 'A'));
    -- I2b: โพสต์ผูกชิ้นที่ "มี metric แล้ว" (Q3c) วางซ้ำ -infinity → ล้มที่ age_days (22008 ดิบ) ไม่ใช่ด่านตรวจ — บันทึกพฤติกรรม
    begin
      execute 'set local role service_role';
      v_r := pg_temp.qx_ok(format('select analytics.content_post_upsert(%L::uuid,''tiktok'',%L,%L,''-infinity''::timestamptz)', v_shop, c_tt || 'q1', c_tt || 'q1'));
      execute 'reset role';
      v_log := v_log || pg_temp.nn('I2b', 'โพสต์ผูกชิ้นที่มี metric แล้ว วางซ้ำ -infinity ผ่านคิว → ' || left(v_r, 90) || ' (ล้มเพราะคำนวณ age_days ไม่ใช่ validation — ไม่มีแถวเสีย)');
      raise exception 'qa_rollback' using errcode = 'QA001';
    exception when sqlstate 'QA001' then execute 'reset role';
    end;
    begin
      execute 'set local role service_role';
      v_r := pg_temp.qx_ok(format('select analytics.content_post_upsert(%L::uuid,''tiktok'',%L,%L,''-infinity''::timestamptz)', v_shop, c_tt || 'i2', c_tt || 'i2'));
      v_bad := pg_temp.rdv();
      execute 'reset role';
      v_log := v_log || case when v_r <> 'OK' then pg_temp.bb('I2', 'วางซ้ำโพสต์ผูกชิ้นด้วย -infinity ผ่านคิวเดิม ถูกปฏิเสธ (' || left(v_r, 80) || ')', true, '')
        else pg_temp.bb('I2', 'BUG-MED: โพสต์ที่ผูกชิ้นแล้วถูกวางซ้ำผ่านคิวเดิมด้วย posted_at=-infinity สำเร็จ (0160 ตรวจ ±infinity เฉพาะ content_piece_post/link_step ไม่ตรวจคิว) · view ที่อ่านไม่ได้', v_bad = '', 'view พัง=[' || v_bad || ']') end;
      raise exception 'qa_rollback' using errcode = 'QA001';
    exception when sqlstate 'QA001' then execute 'reset role';
    end;
    begin
      execute 'set local role service_role';
      v_r := pg_temp.qx_ok(format('select analytics.content_post_upsert(%L::uuid,''tiktok'',%L,%L,timestamptz ''1970-01-01 00:00+00'')', v_shop, c_tt || 'i2', c_tt || 'i2'));
      v_bad := pg_temp.rdv();
      execute 'reset role';
      v_log := v_log || case when v_r <> 'OK' then pg_temp.nn('I3', 'วางซ้ำโพสต์ผูกชิ้นด้วยปี 1970 ถูกปฏิเสธ: ' || left(v_r, 80))
        else pg_temp.bb('I3', 'วางซ้ำโพสต์ผูกชิ้นด้วยปี 1970 ผ่านคิวเดิม (ด่าน ≥2025 อยู่ที่ post/link_step เท่านั้น) · view ต้องอ่านได้ทุกตัว', v_bad = '', 'view พัง=[' || v_bad || ']') end;
      raise exception 'qa_rollback' using errcode = 'QA001';
    exception when sqlstate 'QA001' then execute 'reset role';
    end;
    begin
      v_pf := analytics.content_post_upsert(v_shop, 'tiktok', c_tt || 'inf4', c_tt || 'inf4', '-infinity'::timestamptz);
      v_s3 := pg_temp.mkp(v_shop, 'short_clip', 'tiktok', 'produced');
      execute 'set local role service_role';
      v_log := v_log || pg_temp.lg('I4', 'link_step โพสต์ -infinity (เข้าคิวเดิมมาก่อน) → 22023', pg_temp.qx_ex(format('select analytics.content_post_link_step(%L::uuid,%L::uuid,%L::uuid,''owner'')', v_shop, v_pf, v_s3), array['22023']));
      execute 'reset role';
      raise exception 'qa_rollback' using errcode = 'QA001';
    exception when sqlstate 'QA001' then execute 'reset role';
    end;
  exception when others then
    execute 'reset role';
    v_log := v_log || format(E'[FAIL] I ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  ----------------------------------------------------------------------------
  -- C. caption cap ขอบ
  ----------------------------------------------------------------------------
  begin
    v_s3 := pg_temp.mkp(v_shop, 'ig_fb_post', 'facebook', 'produced');
    execute 'set local role service_role';
    v_log := v_log || pg_temp.lg('C1', 'caption ไทย 2,200 ตัวพอดี → OK', pg_temp.qx_ok(format('select analytics.content_piece_post(%L::uuid,%L::uuid,''facebook'',%L,%L,now() - interval ''1 hour'',''owner'',null,null,null,%L)', v_shop, v_s3, 'qa160r3-c1', 'https://www.facebook.com/qa160r3/posts/c1', repeat('ก', 2200))));
    execute 'reset role';
    v_s3 := pg_temp.mkp(v_shop, 'ig_fb_post', 'facebook', 'produced');
    execute 'set local role service_role';
    v_log := v_log || pg_temp.lg('C2', 'caption 2,201 ตัว → 22023', pg_temp.qx_ex(format('select analytics.content_piece_post(%L::uuid,%L::uuid,''facebook'',%L,%L,now() - interval ''1 hour'',''owner'',null,null,null,%L)', v_shop, v_s3, 'qa160r3-c2', 'https://www.facebook.com/qa160r3/posts/c2', repeat('ก', 2201)), array['22023']));
    v_log := v_log || pg_temp.lg('C3', 'caption 2,200 ตัว + เว้นวรรคหัวท้าย 500 (btrim ก่อนนับ) → OK', pg_temp.qx_ok(format('select analytics.content_piece_post(%L::uuid,%L::uuid,''facebook'',%L,%L,now() - interval ''1 hour'',''owner'',null,null,null,%L)', v_shop, v_s3, 'qa160r3-c3', 'https://www.facebook.com/qa160r3/posts/c3', repeat(' ', 250) || repeat('ก', 2200) || repeat(' ', 250))));
    execute 'reset role';
    v_s3 := pg_temp.mkp(v_shop, 'ig_fb_post', 'facebook', 'produced');
    execute 'set local role service_role';
    v_log := v_log || pg_temp.lg('C4', 'caption emoji 2,200 ตัว (นับอักขระ ไม่ใช่ byte) → OK', pg_temp.qx_ok(format('select analytics.content_piece_post(%L::uuid,%L::uuid,''facebook'',%L,%L,now() - interval ''1 hour'',''owner'',null,null,null,%L)', v_shop, v_s3, 'qa160r3-c4', 'https://www.facebook.com/qa160r3/posts/c4', repeat('🔥', 2200))));
    execute 'reset role';
    v_s3 := pg_temp.mkp(v_shop, 'ig_fb_post', 'facebook', 'produced');
    execute 'set local role service_role';
    v_log := v_log || pg_temp.lg('C5', 'caption เว้นวรรคล้วน → OK (ถือว่าไม่มี caption)', pg_temp.qx_ok(format('select analytics.content_piece_post(%L::uuid,%L::uuid,''facebook'',%L,%L,now() - interval ''1 hour'',''owner'',null,null,null,%L)', v_shop, v_s3, 'qa160r3-c5', 'https://www.facebook.com/qa160r3/posts/c5', '     ')));
    execute 'reset role';
    select caption_snapshot is null into v_b from analytics.content_post where external_id = 'qa160r3-c5';
    v_log := v_log || pg_temp.bb('C5b', 'caption เว้นวรรคล้วน เก็บเป็น null', v_b is true, '');
  exception when others then
    execute 'reset role';
    v_log := v_log || format(E'[FAIL] C ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  ----------------------------------------------------------------------------
  -- S. stale_sources: สะสม · เพดาน 100 · ค่าแปลก
  ----------------------------------------------------------------------------
  begin
    v_s3 := pg_temp.mkp(v_shop, 'ig_fb_post', 'facebook', 'in_review');
    select a.id into v_af from analytics.step_artifact a where a.step_id = v_s3;
    for i in 1..3 loop
      perform analytics.content_gate_record(v_shop, v_s3, 'fact_check', 'passed', 'owner',
        jsonb_build_object('sources', (select jsonb_agg('https://example.com/r' || i || '-' || n) from generate_series(1, 40) n)));
      perform analytics.campaign_set_artifact_content(v_af, 'แก้รอบ ' || i, null);
    end loop;
    select g.detail into rr from analytics.step_gate g where g.step_id = v_s3 and g.gate_kind = 'fact_check';
    v_log := v_log || pg_temp.bb('S1', '3 รอบ x 40 ลิงก์ → stale_sources ยาว 100 · ท้ายสุดเป็นของรอบ 3 · หัวคือ r1-21 (ตัด 20 เก่าสุด)',
      jsonb_array_length(rr.detail -> 'stale_sources') = 100 and rr.detail -> 'stale_sources' ->> 99 = 'https://example.com/r3-40' and rr.detail -> 'stale_sources' ->> 0 = 'https://example.com/r1-21' and not (rr.detail ? 'sources'),
      format('len=%s first=%s last=%s', jsonb_array_length(rr.detail -> 'stale_sources'), rr.detail -> 'stale_sources' ->> 0, rr.detail -> 'stale_sources' ->> 99));
    update analytics.step_gate set detail = jsonb_build_object('sources', jsonb_build_array('https://example.com/x'), 'stale_sources', to_jsonb('oops'::text)) where step_id = v_s3 and gate_kind = 'fact_check';
    v_r := pg_temp.qx_ok(format('select analytics.campaign_set_artifact_content(%L::uuid, ''แก้หลังค่าแปลก'', null)', v_af));
    select g.detail into rr from analytics.step_gate g where g.step_id = v_s3 and g.gate_kind = 'fact_check';
    v_log := v_log || pg_temp.bb('S2', 'stale_sources เก่าเป็น string → แก้เนื้อหาไม่ล้ม · stale = [x]', v_r = 'OK' and rr.detail -> 'stale_sources' = jsonb_build_array('https://example.com/x'), v_r || ' ' || left(rr.detail::text, 120));
    update analytics.step_gate set detail = jsonb_build_object('sources', jsonb_build_object('a', 1)) where step_id = v_s3 and gate_kind = 'fact_check';
    v_r := pg_temp.qx_ok(format('select analytics.campaign_set_artifact_content(%L::uuid, ''แก้หลัง sources เป็น object'', null)', v_af));
    v_log := v_log || pg_temp.bb('S3', 'sources เป็น object → แก้เนื้อหาไม่ล้ม (ไม่ 500)', v_r = 'OK', v_r);
    update analytics.step_gate set detail = jsonb_build_object('stale_sources', jsonb_build_array('https://example.com/keep')), status = 'pending' where step_id = v_s3 and gate_kind = 'fact_check';
    v_r := pg_temp.qx_ok(format('select analytics.content_gate_record(%L::uuid,%L::uuid,''fact_check'',''pending'',''owner'',jsonb_build_object(''sources'',jsonb_build_array(''https://example.com/n1'')))', v_shop, v_s3));
    select g.detail into rr from analytics.step_gate g where g.step_id = v_s3 and g.gate_kind = 'fact_check';
    v_log := v_log || pg_temp.bb('S4', 'บันทึก pending พร้อม sources ใหม่ → stale เดิมอยู่ครบ · sources=[n1]', v_r = 'OK' and rr.detail -> 'stale_sources' = jsonb_build_array('https://example.com/keep') and rr.detail -> 'sources' = jsonb_build_array('https://example.com/n1'), v_r || ' ' || left(rr.detail::text, 160));
    v_r := pg_temp.qx_ok(format('select analytics.content_gate_record(%L::uuid,%L::uuid,''brand_rule'',''passed'',''owner'')', v_shop, v_s3));
    select g.detail into rr from analytics.step_gate g where g.step_id = v_s3 and g.gate_kind = 'brand_rule';
    v_log := v_log || pg_temp.bb('S5', 'brand_rule ผ่าน → detail ไม่มี stale_sources/sources', v_r = 'OK' and not coalesce(rr.detail ? 'stale_sources', false) and not coalesce(rr.detail ? 'sources', false), v_r || ' ' || coalesce(rr.detail::text, 'null'));
    update analytics.step_gate set detail = jsonb_build_object('stale_sources', jsonb_build_array('https://example.com/only-stale')), status = 'pending' where step_id = v_s3 and gate_kind = 'fact_check';
    v_log := v_log || pg_temp.lg('S6', 'passed โดยมีแต่ stale_sources ในแถว (ไม่ส่ง sources) → 22023', pg_temp.qx_ex(format('select analytics.content_gate_record(%L::uuid,%L::uuid,''fact_check'',''passed'',''owner'',jsonb_build_object(''note'',''x''))', v_shop, v_s3), array['22023']));
  exception when others then
    v_log := v_log || format(E'[FAIL] S ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  exception when others then
    v_log := v_log || format(E'[FAIL] ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_ok   := (length(v_log) - length(replace(v_log, '[OK]', ''))) / 4;
  v_note := (length(v_log) - length(replace(v_log, '[NOTE]', ''))) / 6;
  v_log := v_log || format(E'\n=== สรุป: [OK] %s · [FAIL] %s · [NOTE] %s — raise ด้านล่างบังคับ ROLLBACK ทั้งหมด ===\n', v_ok, v_fail, v_note);
  raise exception '%', v_log;
end
$qa0160r3$;
