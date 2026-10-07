-- scripts/verify/qa-0160-extra.sql  (QA R2-D2, 7 ต.ค. 69) — เคส "ต้องไม่พัง" + edge ของ 0160 (และส่วนที่เก็บใน 0159) ที่ verify-0160 ของ dev ไม่ได้คลุม
--
-- รัน: qa-0160-pre.sql + 0159 + 0160 + ไฟล์นี้ ต่อเป็นไฟล์เดียว แล้วรันแบบไม่ใส่ --commit (ไม่เคย COMMIT · raise ท้ายไฟล์บังคับ ROLLBACK)
--   cat scripts/verify/qa-0160-pre.sql supabase/migrations/0159_content_piece_workflow.sql supabase/migrations/0160_content_piece_post_views.sql \
--       scripts/verify/qa-0160-extra.sql > tmp.sql && node scripts/run-sql.mjs tmp.sql
-- ผลออกทาง raise exception ท้ายไฟล์ · [FAIL] ≥ 1 = พบข้อบกพร่อง · [NOTE] = ผ่านแต่ควรรู้ · [SKIP] = พิสูจน์ไม่ได้ในไฟล์นี้
--
-- กลุ่มเคส:
--   D  differential: คิววางลิงก์เดิม (content_post_upsert ด้วยพารามิเตอร์ชุดเดียวกับ lib/actions/content.ts) + v_content_post_t7 + v_content_entry_queue เท่าก่อน 0159/0160
--   R  view 4 ตัวกับข้อมูลจริงหลัง backfill · เทียบกับการนับอิสระจากตารางดิบ · ไม่รั่วชื่อจริงโฮสต์ (ฝังชื่อทดสอบแล้ว scan ทุก view)
--   Q  คิวเดิมอยู่ร่วมกับ workflow: โพสต์นอกแผน → link → unlink · โพสต์ผูก artifact ของชิ้นใน workflow · วางซ้ำบนโพสต์ที่ผูกชิ้นแล้ว · ลบ step/hook
--   F  วงจรเต็มชิ้นใหม่: clip (เลือก hook / ไม่เลือก / hook อื่น) · LINE ไม่มีลิงก์ · ig_fb_post · view ต้องนับตรง
--   C  content_piece_defer บนชิ้น ต.ค. จริง ทุกชิ้น (ปฏิทินแสดงวันใหม่ · ชิ้นอื่นไม่ขยับ · piece_status ไม่เปลี่ยน)
--   E  E4a (set_plan เปลี่ยน kind ↔ line_audience อัตโนมัติ) · ตรวจ 0159 รอบเก็บงาน: stale_sources · artifact ≤ 1
--   I  input edge ของ content_piece_post/link/unlink/defer (platform/ext/url/วันที่/hook/role)
--   Z  ภายใต้ role service_role จริง: อ่าน view 4 ตัว (security_invoker) + เรียก RPC 4 ตัว
--   P  view = การนับอิสระจากตารางดิบ ณ สถานะปนท้ายไฟล์ (inbox · quota · calendar · hook library)

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

do $qa0160$
declare
  v_log   text := E'\n=== qa-0160-extra ===\n';
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_shop  uuid;
  v_n     bigint; v_n2 bigint; v_n3 bigint;
  v_r     text; v_txt text; v_bad text;
  v_j     jsonb; v_j2 jsonb;
  v_b     boolean;
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s4 uuid; v_s5 uuid; v_s6 uuid;
  v_p1 uuid; v_p2 uuid; v_p3 uuid;
  v_h uuid; v_hB uuid; v_art uuid; v_art2 uuid;
  v_snap text; v_snap2 text;
  v_q record; v_q0 record; v_in record;
  v_a numeric; v_b2 numeric;
  v_ok int; v_fail int; v_note int;
  i int;
  rr record;
  c_tt constant text := 'https://www.tiktok.com/@qa160x/video/';
begin
  begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  select count(*) into v_n from public.shop;
  if v_n <> 1 then raise exception 'qa-0160-extra: ต้องมีร้านเดียว (พบ %)', v_n; end if;
  select id into v_shop from public.shop;

  ----------------------------------------------------------------------------
  -- D. differential (ก่อน 0159/0160 ↔ หลัง 0160) — คิววางลิงก์เดิม + หน้าประวัติ/KPI
  ----------------------------------------------------------------------------
  begin
    if to_regclass('pg_temp.qa160_pre') is null then
      v_log := v_log || E'[SKIP] D ไม่มี baseline qa160_pre (ไม่ได้ต่อ qa-0160-pre.sql ไว้ต้นไฟล์)\n';
    else
      v_bad := null;
      for i in 1..21 loop
        v_txt := pg_temp.qx_case(i);
        select p.v into v_r from qa160_pre p where p.k = 'U' || i;
        if v_txt is distinct from v_r then
          v_bad := coalesce(v_bad || E'\n   ', '') || 'U' || i || ' ก่อน=[' || left(coalesce(v_r, 'null'), 150) || '] หลัง=[' || left(v_txt, 150) || ']';
        end if;
      end loop;
      v_log := v_log || pg_temp.bb('D1', 'content_post_upsert ด้วยพารามิเตอร์แบบ lib/actions/content.ts 21 เคส (โพสต์นอกแผน · ผูก artifact จริง · วางซ้ำ null-preserving · 4 platform · ปฏิเสธ 10 แบบ · ขอบ 500 · metric→ออกคิว · T+7 · caption 100k · case/trim · -infinity · โพสต์จริงทุกใบ) ผลเหมือนก่อน 0159/0160 ทุกเคส',
        v_bad is null, coalesce(v_bad, '21/21 เท่ากัน'));
      select p.v into v_r from qa160_pre p where p.k = 'V_t7';
      v_txt := (select count(*)::text from analytics.v_content_post_t7) || '/' ||
        (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum) from pg_attribute a
          where a.attrelid = 'analytics.v_content_post_t7'::regclass and a.attnum > 0 and not a.attisdropped) || '/' ||
        (select md5(coalesce(string_agg(t::text, E'\n' order by t.post_id), '')) from analytics.v_content_post_t7 t);
      v_log := v_log || pg_temp.bb('D2', 'v_content_post_t7 (KPI รายโพสต์): จำนวนแถว + ชื่อ/ชนิดคอลัมน์/ลำดับ + md5 ทุกแถว เท่าก่อน', v_txt = v_r, left(v_txt, 12) || ' vs ' || left(v_r, 12));
      select p.v into v_r from qa160_pre p where p.k = 'V_queue';
      v_txt := (select count(*)::text from analytics.v_content_entry_queue) || '/' ||
        (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum) from pg_attribute a
          where a.attrelid = 'analytics.v_content_entry_queue'::regclass and a.attnum > 0 and not a.attisdropped) || '/' ||
        (select md5(coalesce(string_agg(t::text, E'\n' order by t.post_id), '')) from analytics.v_content_entry_queue t);
      v_log := v_log || pg_temp.bb('D3', 'v_content_entry_queue (คิววางลิงก์): จำนวนแถว + คอลัมน์ + md5 ทุกแถว เท่าก่อน', v_txt = v_r, left(v_txt, 12) || ' vs ' || left(v_r, 12));
      -- แถวที่ select ในหน้าคิวจริง (content.ts getContentEntryQueue เลือก 10 คอลัมน์นี้) ต้องยัง select ได้
      v_log := v_log || pg_temp.lg('D4', 'select 10 คอลัมน์ของ getContentEntryQueue จาก v_content_entry_queue ได้ (ไม่มีคอลัมน์หาย)',
        pg_temp.qx_ok('select post_id, shop_id, platform, external_id, post_url, posted_at, posted_date_th, content_type_code, age_days_today, read_round from analytics.v_content_entry_queue'));
      v_log := v_log || pg_temp.lg('D5', 'select คอลัมน์ KPI ของ getContentPostKpiDetail จาก v_content_post_t7 ได้',
        pg_temp.qx_ok('select post_id, platform, external_id, post_url, posted_at, posted_date_th, content_type_code, status, t7_captured_on, t7_age_days, t7_view_count, t7_like_count, t7_comment_count, t7_save_count, t7_share_count, t7_is_regression, save_rate, share_rate, t7_unavailable_reason from analytics.v_content_post_t7'));
      -- โพสต์เก่า (ก่อน 0159) ต้องมี step_id/hook_id = null ทุกใบ (ไม่ถูก backfill ผูกเอง)
      select count(*) into v_n from analytics.content_post where step_id is not null or hook_id is not null;
      v_log := v_log || pg_temp.bb('D6', 'โพสต์จริงที่มีอยู่ทั้งหมดยัง step_id/hook_id = null (0159/0160 ไม่ผูกย้อนหลัง)', v_n = 0, 'ผูกอยู่ ' || v_n);
    end if;
  exception when others then
    v_log := v_log || format(E'[FAIL] D ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  ----------------------------------------------------------------------------
  -- R. view 4 ตัวกับข้อมูลจริงหลัง backfill (ยังไม่มีแถวทดสอบ — นับก่อนสร้างอะไร)
  ----------------------------------------------------------------------------
  begin
    select count(*) into v_n from analytics.v_content_piece_calendar;
    select count(*) into v_n2 from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id
     where s.piece_status is not null and s.piece_status <> 'cancelled' and c.anchor_date is not null;
    v_log := v_log || pg_temp.bb('R1', 'ปฏิทิน = 26 ชิ้น ต.ค. จริง · เท่ากับการนับอิสระจาก campaign_step+campaign', v_n = 26 and v_n2 = 26, 'view=' || v_n || ' ตารางดิบ=' || v_n2);
    select count(*) into v_n from analytics.v_content_piece_calendar
     where resolved_start < date '2026-10-01' or resolved_start > date '2026-10-31';
    v_log := v_log || pg_temp.bb('R1b', 'ทุกชิ้นในปฏิทินอยู่ในเดือน ต.ค. 69 (resolved_start 2026-10-01..31)', v_n = 0, 'นอกเดือน ' || v_n);
    select string_agg(piece_status || '=' || n, ' ' order by piece_status) into v_txt from (select piece_status, count(*) n from analytics.v_content_piece_calendar group by 1) x;
    v_log := v_log || pg_temp.nn('R1c', 'การกระจายสถานะในปฏิทิน: ' || v_txt);
    select * into v_in from analytics.v_content_inbox_counts where shop_id = v_shop;
    v_log := v_log || pg_temp.bb('R2', 'inbox_counts 1 แถว/ร้าน · review_queue = 13 (in_review) · ideas = 0 · on_hold = 0 · post_today = 0 (ยังไม่มี approved)',
      (select count(*) from analytics.v_content_inbox_counts where shop_id = v_shop) = 1 and v_in.review_queue = 13 and v_in.ideas = 0 and v_in.on_hold = 0 and v_in.post_today = 0,
      format('review=%s ideas=%s hold=%s post_today=%s overdue=%s over_limit=%s owner_q=%s shoot_wk=%s', v_in.review_queue, v_in.ideas, v_in.on_hold, v_in.post_today, v_in.post_overdue_no_link, v_in.review_over_limit, v_in.owner_questions, v_in.shoot_this_week));
    select count(*) into v_n from analytics.campaign_step where piece_status = 'in_review';
    select count(*) into v_n2 from analytics.step_gate g join analytics.campaign_step s on s.id = g.step_id
     where g.gate_kind = 'risk_owner' and g.status in ('pending', 'blocked') and s.piece_status in ('drafting', 'in_review');
    v_log := v_log || pg_temp.bb('R2b', 'review_queue/owner_questions เท่ากับนับอิสระจากตารางดิบ · review_over_limit = (13 > 10) = true',
      v_in.review_queue = v_n and v_in.owner_questions = v_n2 and v_in.review_over_limit is true, format('ดิบ review=%s owner_q=%s', v_n, v_n2));
    v_log := v_log || pg_temp.nn('R2c', format('ตัวเลขจริงหลัง backfill: ต้องตรวจรอบแรก=%s · ถามเจ้าของค้าง=%s · ถ่ายสัปดาห์นี้=%s · เกินวันไม่มีลิงก์=%s', v_in.review_queue, v_in.owner_questions, v_in.shoot_this_week, v_in.post_overdue_no_link));
    select count(*), count(*) filter (where side = 'ours'), count(*) filter (where side = 'reference'), count(*) filter (where posts_n > 0), count(*) filter (where type_verdict = 'สรุปได้')
      into v_n, v_n2, v_n3, v_a, v_b2 from analytics.v_content_hook_library;
    v_log := v_log || pg_temp.bb('R3', 'คลังhook: 26 แถว ours · 0 reference (ยังไม่มี signal) · ไม่มี hook ที่มีโพสต์ · ไม่มีประเภทที่ "สรุปได้" · แถว = จำนวน content_hook ทั้งตาราง',
      v_n = 26 and v_n2 = 26 and v_n3 = 0 and v_a = 0 and v_b2 = 0 and v_n = (select count(*) from analytics.content_hook), format('total=%s ours=%s ref=%s มีโพสต์=%s สรุปได้=%s', v_n, v_n2, v_n3, v_a, v_b2));
    select count(*) filter (where hook_type is null), count(distinct hook_type) into v_n, v_n2 from analytics.v_content_hook_library;
    v_log := v_log || pg_temp.nn('R3b', format('hook จริง 26 ตัว: ยังไม่ติดประเภท %s · ประเภทที่ต่างกัน %s (verdict ทั้งหมด = ยังไม่ติดประเภท/ยังสรุปไม่ได้ จนกว่าจะมีโพสต์+T+7 ≥ 4 ชิ้น/ประเภท)', v_n, v_n2));
    select * into v_q from analytics.v_line_quota_28d where shop_id = v_shop;
    select count(*) into v_n from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id
     where s.piece_kind = 'line_message' and s.piece_status in ('planned', 'drafting', 'in_review', 'approved', 'produced')
       and c.anchor_date + s.offset_start_days between v_today and v_today + 27;
    select count(*) into v_n2 from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id
     where s.piece_kind = 'line_message' and s.piece_status in ('planned', 'drafting', 'in_review', 'approved', 'produced')
       and c.anchor_date + s.offset_start_days < v_today;
    v_log := v_log || pg_temp.bb('R4', 'v_line_quota_28d 1 แถว/ร้าน · quota=4 · used=0 · planned/overdue เท่าการนับอิสระ · remaining=4 · คอลัมน์ครบ',
      (select count(*) from analytics.v_line_quota_28d where shop_id = v_shop) = 1 and v_q.quota = 4 and v_q.used_28d = 0 and v_q.planned_28d = v_n and v_q.overdue_planned = v_n2 and v_q.remaining_28d = 4,
      format('used=%s planned=%s(ดิบ %s) overdue=%s(ดิบ %s) remaining=%s over=%s', v_q.used_28d, v_q.planned_28d, v_n, v_q.overdue_planned, v_n2, v_q.remaining_28d, v_q.over_quota_planned));
    v_log := v_log || pg_temp.nn('R4b', 'LINE จริง ต.ค.: ตัวนับเริ่มที่ used_28d=0 เพราะนับเฉพาะ broadcast ที่ลงผ่าน workflow ใหม่ — broadcast ที่ส่งไปแล้วก่อนระบบนี้/นอกระบบ ไม่ถูกนับ ⇒ 28 วันแรกโควตา "เหลือ" จะสูงเกินจริงได้ (ธุรกิจต้องรู้)');
    -- คอลัมน์ต้องห้าม
    select string_agg(c.relname || '.' || a.attname, ', ') into v_bad
      from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
     where c.relnamespace = 'analytics'::regnamespace and c.relname in ('v_content_piece_calendar', 'v_content_inbox_counts', 'v_line_quota_28d', 'v_content_hook_library')
       and (a.attname ~* '(display_name|real_name|host_name|full_name|phone|tel|email|line_id|handle|owner_name)' or a.attname = 'account');
    v_log := v_log || pg_temp.bb('R5', 'ไม่มีคอลัมน์ชื่อจริง/ช่องติดต่อ/account ใน view ใหม่ 4 ตัว (expected_host_label = public_label เท่านั้น)', v_bad is null, coalesce(v_bad, 'ไม่พบ'));
    v_log := v_log || pg_temp.nn('R5b', 'คลัง hook เปิด ref_account_followers (ตัวเลข — อยู่ในสเปก §11.2 ข้อ 7) และ ref_url (URL คลิปคู่แข่ง ซึ่งมี @handle ของคู่แข่งอยู่ใน URL เอง) · ไม่เปิดคอลัมน์ account · ไม่ใช่ชื่อคนของเรา/โฮสต์');
    -- ฝังชื่อจริงโฮสต์ทดสอบแล้ว scan ทุกแถวของ view (ไม่ใช่แค่ดูชื่อคอลัมน์)
    declare v_host uuid; v_hit text;
    begin
      insert into analytics.live_host (shop_id, display_name, public_label) values (v_shop, 'นางสาวสมหญิง ทดสอบจริงใจ qa160name', 'qa160-label') returning id into v_host;
      select s.id into v_s1 from analytics.campaign_step s where s.piece_status = 'in_review' and s.piece_kind = 'short_clip' order by s.id limit 1;
      v_r := pg_temp.qx_ok(format('select analytics.content_piece_set_plan(%L::uuid, %L::uuid, jsonb_build_object(''expected_host_id'', %L), ''owner'')', v_shop, v_s1, v_host));
      v_log := v_log || pg_temp.lg('R6a', 'ตั้ง expected_host_id ให้ชิ้นจริง (in_review) ผ่าน set_plan', v_r);
      select string_agg(x.vn, ', ') into v_hit from (
        select 'v_content_piece_calendar' vn where exists (select 1 from analytics.v_content_piece_calendar t where t::text ilike '%qa160name%' or t::text like '%สมหญิง%')
        union all select 'v_content_inbox_counts' where exists (select 1 from analytics.v_content_inbox_counts t where t::text like '%สมหญิง%' or t::text ilike '%qa160name%')
        union all select 'v_line_quota_28d' where exists (select 1 from analytics.v_line_quota_28d t where t::text like '%สมหญิง%' or t::text ilike '%qa160name%')
        union all select 'v_content_hook_library' where exists (select 1 from analytics.v_content_hook_library t where t::text like '%สมหญิง%' or t::text ilike '%qa160name%')
        union all select 'v_content_piece' where exists (select 1 from analytics.v_content_piece t where t::text like '%สมหญิง%' or t::text ilike '%qa160name%')) x;
      v_log := v_log || pg_temp.bb('R6b', 'ชื่อจริงโฮสต์ (display_name) ไม่โผล่ในแถวไหนของ 4 view ใหม่ + v_content_piece (scan ทั้งแถว as text)', v_hit is null, coalesce('รั่วใน: ' || v_hit, 'ไม่พบ'));
      -- ชื่อจริงของโฮสต์ "จริง" ทุกคนใน DB (ตัวเลข/ค่าจริงจาก DB ไม่ใช่แค่ชื่อคอลัมน์ — แบบเดียวกับการหาต้นทุนจริงในหน้าพิมพ์)
      select count(*) into v_n from analytics.live_host where display_name not like '%qa160name%';
      select string_agg(distinct h.display_name || '@' || x.vn, ', ') into v_hit
        from analytics.live_host h
        cross join lateral (
          select 'v_content_piece_calendar' as vn from analytics.v_content_piece_calendar t where position(lower(h.display_name) in lower(t::text)) > 0
          union all select 'v_content_inbox_counts' from analytics.v_content_inbox_counts t where position(lower(h.display_name) in lower(t::text)) > 0
          union all select 'v_line_quota_28d' from analytics.v_line_quota_28d t where position(lower(h.display_name) in lower(t::text)) > 0
          union all select 'v_content_hook_library' from analytics.v_content_hook_library t where position(lower(h.display_name) in lower(t::text)) > 0
          union all select 'v_content_piece' from analytics.v_content_piece t where position(lower(h.display_name) in lower(t::text)) > 0) x
       where h.display_name not like '%qa160name%';
      v_log := v_log || pg_temp.bb('R6d', 'ชื่อจริงของโฮสต์จริงใน DB (' || v_n || ' คน) ไม่ปรากฏในแถวใดของ view ใหม่ 4 ตัว + v_content_piece', v_hit is null, coalesce('พบ: ' || v_hit, 'ไม่พบ'));
      select expected_host_label into v_txt from analytics.v_content_piece_calendar where step_id = v_s1;
      v_log := v_log || pg_temp.bb('R6c', 'ปฏิทินแสดง expected_host_label = public_label ("qa160-label") ของชิ้นนั้น', v_txt = 'qa160-label', coalesce(v_txt, 'null'));
      update analytics.campaign_step set expected_host_id = null where id = v_s1;
      delete from analytics.live_host where id = v_host;
    end;
  exception when others then
    v_log := v_log || format(E'[FAIL] R ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  ----------------------------------------------------------------------------
  -- Q. คิวเดิมอยู่ร่วมกับ workflow
  ----------------------------------------------------------------------------
  begin
    -- Q1: โพสต์นอกแผน (วางผ่านคิวเดิม) → link_step → unlink_step · คิวต้องเห็นโพสต์ตลอด
    select pid into v_p1 from (select analytics.content_post_upsert(v_shop, 'tiktok', c_tt || 'q1', c_tt || 'q1', now() - interval '2 days', null, null, 'cap คิวเดิม') as pid) x;
    v_s1 := pg_temp.mkp(v_shop, 'short_clip', 'tiktok', 'produced');
    select count(*) into v_n from analytics.v_content_entry_queue where post_id = v_p1;
    v_snap := (select md5(t::text) from analytics.v_content_entry_queue t where t.post_id = v_p1);
    v_j := analytics.content_post_link_step(v_shop, v_p1, v_s1, 'owner', pg_temp.hk(v_s1, 'A'));
    select count(*) into v_n2 from analytics.v_content_entry_queue where post_id = v_p1;
    v_snap2 := (select md5(t::text) from analytics.v_content_entry_queue t where t.post_id = v_p1);
    v_log := v_log || pg_temp.bb('Q1a', 'โพสต์ที่เพิ่งวางผ่านคิวเดิมอยู่ในคิว (1 แถว) → link_step → แถวในคิวเหมือนเดิมเป๊ะ (การผูกชิ้นไม่ทำให้หลุดคิวยอด) · ชิ้นเป็น posted',
      v_n = 1 and v_n2 = 1 and v_snap = v_snap2 and pg_temp.st(v_s1) = 'posted/done', format('before=%s after=%s st=%s', v_n, v_n2, pg_temp.st(v_s1)));
    v_j2 := analytics.content_post_unlink_step(v_shop, v_p1, 'ผูกผิดชิ้น', 'owner');
    select count(*) into v_n3 from analytics.v_content_entry_queue where post_id = v_p1;
    v_log := v_log || pg_temp.bb('Q1b', 'unlink → ชิ้นถอย produced · โพสต์ยังอยู่ (ไม่ถูกลบ) · ยังอยู่ในคิว · hook_id/step_id null · caption เดิมไม่หาย',
      pg_temp.st(v_s1) = 'produced/doing' or pg_temp.st(v_s1) like 'produced/%'
      and v_n3 = 1 and (select step_id is null and hook_id is null and caption_snapshot = 'cap คิวเดิม' from analytics.content_post where id = v_p1), pg_temp.st(v_s1) || ' inq=' || v_n3);
    -- ผูกซ้ำกลับได้หลัง unlink (วงจร ผูก→ปลด→ผูก)
    v_r := pg_temp.qx_ok(format('select analytics.content_post_link_step(%L::uuid,%L::uuid,%L::uuid,''owner'')', v_shop, v_p1, v_s1));
    v_log := v_log || pg_temp.lg('Q1c', 'หลัง unlink ผูกโพสต์เดิมกลับชิ้นเดิมได้ (ไม่เหลือสถานะค้าง)', v_r);

    -- Q2: โพสต์ที่วางผ่านคิวเดิมโดยระบุ artifact ของ "ชิ้นใน workflow" → step_id ยัง null · ชิ้นไม่ขยับ · ปฏิทินยังธง "ไม่มีลิงก์"? · link_step ตามหลังต้องสำเร็จ
    v_s2 := pg_temp.mkp(v_shop, 'short_clip', 'tiktok', 'produced', -3);
    select a.id into v_art from analytics.step_artifact a where a.step_id = v_s2;
    v_p2 := analytics.content_post_upsert(v_shop, 'tiktok', c_tt || 'q2', c_tt || 'q2', now() - interval '1 day', null, v_art, null);
    v_log := v_log || pg_temp.bb('Q2a', 'โพสต์ผ่านคิวเดิมที่ผูก artifact ของชิ้น workflow: step_id = null · ชิ้นยัง produced (คิวเดิมไม่ขยับ workflow เอง)',
      (select step_id is null from analytics.content_post where id = v_p2) and pg_temp.st(v_s2) like 'produced/%', pg_temp.st(v_s2));
    select flag_no_link_overdue, active_post_n into v_q0 from analytics.v_content_piece_calendar where step_id = v_s2;
    select post_overdue_no_link into v_n from analytics.v_content_inbox_counts where shop_id = v_shop;
    v_log := v_log || pg_temp.nn('Q2b', format('ชิ้น produced เกินวันที่มีโพสต์ผูก artifact (ผ่านคิวเดิม) แต่ step_id ว่าง → ปฏิทิน flag_no_link_overdue=%s active_post_n=%s · inbox post_overdue_no_link=%s (ธง/เลขนี้ยังเรียกให้ผูกด้วย link_step — UI ต้องให้ทางผูกเมื่อเห็นธงนี้)', v_q0.flag_no_link_overdue, v_q0.active_post_n, v_n));
    v_r := pg_temp.qx_ok(format('select analytics.content_post_link_step(%L::uuid,%L::uuid,%L::uuid,''owner'')', v_shop, v_p2, v_s2));
    v_log := v_log || pg_temp.lg('Q2c', 'link_step โพสต์ที่ artifact_id = artifact ของชิ้นนั้นเอง → สำเร็จ (ทางกู้หลังวางลิงก์ผ่านคิวเดิม)', v_r);
    select flag_no_link_overdue, active_post_n into v_q0 from analytics.v_content_piece_calendar where step_id = v_s2;
    v_log := v_log || pg_temp.bb('Q2d', 'หลัง link: ชิ้น posted · ธง no_link_overdue ดับ · active_post_n = 1', pg_temp.st(v_s2) = 'posted/done' and v_q0.flag_no_link_overdue is false and v_q0.active_post_n = 1, pg_temp.st(v_s2));

    -- Q3: วางซ้ำผ่านคิวเดิมบนโพสต์ที่ผูกชิ้นแล้ว (external_id เดียวกัน) — content_post_upsert เดิมไม่รู้จัก step_id: บันทึกผล
    v_s3 := pg_temp.mkp(v_shop, 'short_clip', 'tiktok', 'produced');
    v_j := analytics.content_piece_post(v_shop, v_s3, 'tiktok', c_tt || 'q3', c_tt || 'q3', now() - interval '3 days', 'owner', pg_temp.hk(v_s3, 'A'));
    v_p3 := pg_temp.pid(v_j);
    select a.id into v_art2 from analytics.step_artifact a where a.step_id = v_s2;
    v_txt := pg_temp.qx_ok(format('select analytics.content_post_upsert(%L::uuid,''tiktok'',%L,%L,now() - interval ''1 day'',null,%L::uuid,null)', v_shop, c_tt || 'q3', c_tt || 'q3', v_art2));
    select (cp.artifact_id = v_art2) into v_b from analytics.content_post cp where cp.id = v_p3;
    v_log := v_log || case when v_txt = 'OK' and v_b then
      pg_temp.nn('Q3', 'ช่องของคิวเดิม (content_post_upsert ไม่แตะ ตั้งใจ): วางลิงก์ซ้ำบนโพสต์ที่ผูกชิ้น A โดยเลือก artifact ของชิ้น B → สำเร็จ · artifact_id ของโพสต์ถูกย้ายไปชิ้น B แต่ step_id ยังชิ้น A (post ผูกสองชิ้นไม่ตรงกัน) · ต้องผ่านคิวเดิม/ฟอร์มปฏิทินด้วยมือเท่านั้น — content_piece_post กันกรณีนี้ แต่ทางเดิมไม่กัน')
      else pg_temp.bb('Q3', 'วางซ้ำบนโพสต์ที่ผูกชิ้น + artifact ชิ้นอื่น ถูกปฏิเสธ/ไม่ย้าย', v_txt <> 'OK' or not v_b, v_txt) end;

    -- Q4: ลบ step/hook ที่ผูกโพสต์ — โพสต์ต้องไม่หาย/ไม่ค้าง FK
    select count(*) into v_n from analytics.content_post;
    v_snap := pg_temp.qx_ex(format('delete from analytics.content_hook where id = %L::uuid', pg_temp.hk(v_s3, 'A')), array['23503', '55000', 'P0001', '42501'], null);
    if v_snap like 'FAIL ผ่าน%' then
      select hook_id into v_h from analytics.content_post where id = v_p3;
      v_log := v_log || pg_temp.bb('Q4a', 'ลบ hook ที่ผูกโพสต์ได้ → content_post.hook_id ต้องไม่ชี้ hook ที่หายไป (set null) และโพสต์ยังอยู่', v_h is null and exists (select 1 from analytics.content_post where id = v_p3), coalesce(v_h::text, 'null'));
    else
      v_log := v_log || pg_temp.nn('Q4a', 'ลบ hook ที่ผูกโพสต์ถูกกัน: ' || v_snap);
    end if;
    v_snap := pg_temp.qx_ex(format('delete from analytics.campaign_step where id = %L::uuid', v_s3), array['23503', '55000', 'P0001', '42501'], null);
    if v_snap like 'FAIL ผ่าน%' then
      select count(*) into v_n2 from analytics.content_post where id = v_p3 and step_id is null;
      v_log := v_log || pg_temp.bb('Q4b', 'ลบ step ที่ผูกโพสต์ได้ → โพสต์ยังอยู่ step_id null (ไม่ cascade ลบยอด/ไม่ค้าง FK) · จำนวนโพสต์ไม่ลด', v_n2 = 1 and (select count(*) from analytics.content_post) = v_n, 'โพสต์ null step=' || v_n2);
      select count(*) into v_n2 from analytics.content_piece_event where step_id = v_s3;
      v_log := v_log || pg_temp.nn('Q4c', 'หลังลบ step: event ของชิ้นนั้นเหลือ ' || v_n2 || ' แถว (event มี FK → campaign_step)');
    else
      v_log := v_log || pg_temp.nn('Q4b', 'ลบ step ที่ผูกโพสต์ถูกกัน: ' || v_snap);
    end if;
  exception when others then
    v_log := v_log || format(E'[FAIL] Q ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  ----------------------------------------------------------------------------
  -- F. วงจรเต็มชิ้นใหม่ (create→plan→drafting→in_review→3 ด่าน→approved→produced→post) + view ต้องนับตรง (วัดเป็น delta จากของจริง)
  ----------------------------------------------------------------------------
  begin
    -- baseline ของ view ณ ตอนนี้ (หลัง Q ที่มีแถวทดสอบแล้ว ใช้ delta ทุกจุด)
    select coalesce(max(type_n_pieces), 0) into v_n from analytics.v_content_hook_library where shop_id = v_shop and hook_type = 'question';
    select coalesce(max(type_n_pieces), 0) into v_n2 from analytics.v_content_hook_library where shop_id = v_shop and hook_type = 'fact';
    select * into v_q0 from analytics.v_line_quota_28d where shop_id = v_shop;
    select count(*) into v_n3 from analytics.content_post;

    -- ชิ้นให้ P1a/P1b ไม่ว่างเปล่า: approved ที่ถึงวันวันนี้ (post_today) · produced เกินวันไม่มีลิงก์ (post_overdue_no_link) · approved needs_shoot สัปดาห์นี้
    perform pg_temp.mkp(v_shop, 'short_clip', 'tiktok', 'approved', 0);
    v_s6 := pg_temp.mkp(v_shop, 'short_clip', 'tiktok', 'produced', -1);
    perform pg_temp.mkp(v_shop, 'ig_fb_post', 'facebook', 'produced', -2);
    v_s5 := pg_temp.mkp(v_shop, 'live_cut', 'tiktok', 'approved', 0);
    perform analytics.content_piece_set_plan(v_shop, v_s5, jsonb_build_object('footage_status', 'needs_shoot'), 'owner');
    select * into v_in from analytics.v_content_inbox_counts where shop_id = v_shop;
    v_log := v_log || pg_temp.bb('F0', 'inbox หลังสร้าง approved(วันนี้)×2 + produced เกินวัน×2 ไม่มีลิงก์ → post_today ≥ 2 · post_overdue_no_link ≥ 2 · shoot_this_week ≥ 1', v_in.post_today >= 2 and v_in.post_overdue_no_link >= 2 and v_in.shoot_this_week >= 1, format('today=%s overdue=%s shoot=%s', v_in.post_today, v_in.post_overdue_no_link, v_in.shoot_this_week));
    -- F1: clip เลือก hook A → โพสต์อายุ 7 วัน + metric → hook A posts_n=1 measured_n=1 · hook B posts_n=0 · question +1 ชิ้น
    v_s1 := pg_temp.mkp(v_shop, 'short_clip', 'tiktok', 'produced');
    v_j := analytics.content_piece_post(v_shop, v_s1, 'tiktok', c_tt || 'f1', c_tt || 'f1', now() - interval '7 days', 'owner', pg_temp.hk(v_s1, 'A'));
    perform analytics.content_post_metric_upsert(v_shop, pg_temp.pid(v_j), 1000, 10, 2, 80, 20, 'manual');
    v_log := v_log || pg_temp.bb('F1a', 'clip produced → content_piece_post (เลือก hook A) → posted/done · hook_id บนโพสต์ = A · คืน piece_status posted', pg_temp.st(v_s1) = 'posted/done'
      and (select hook_id = pg_temp.hk(v_s1, 'A') from analytics.content_post where id = pg_temp.pid(v_j)) and v_j ->> 'piece_status' = 'posted', pg_temp.st(v_s1));
    v_log := v_log || pg_temp.bb('F1b', 'คลังhook: hook A posts_n=1 measured_n=1 avg_save_rate=0.0800 · hook B posts_n=0 measured_n=0 · step/ชื่อชิ้น/สถานะแสดงตรง',
      exists (select 1 from analytics.v_content_hook_library where hook_id = pg_temp.hk(v_s1, 'A') and posts_n = 1 and measured_n = 1 and avg_save_rate = 0.0800 and avg_share_rate = 0.0200 and piece_status = 'posted' and step_id = v_s1)
      and exists (select 1 from analytics.v_content_hook_library where hook_id = pg_temp.hk(v_s1, 'B') and posts_n = 0 and measured_n = 0 and avg_save_rate is null), '');
    select max(type_n_pieces) into v_a from analytics.v_content_hook_library where shop_id = v_shop and hook_type = 'question';
    select max(type_n_pieces) into v_b2 from analytics.v_content_hook_library where shop_id = v_shop and hook_type = 'fact';
    v_log := v_log || pg_temp.bb('F1c', 'ประเภท question นับ +1 ชิ้น · fact (hook B ไม่ถูกเลือก) ไม่เพิ่ม', v_a = v_n + 1 and v_b2 = v_n2, format('question %s→%s fact %s→%s', v_n, v_a, v_n2, v_b2));
    -- F2: ไม่เลือก hook เลย
    v_s2 := pg_temp.mkp(v_shop, 'short_clip', 'tiktok', 'produced');
    v_j := analytics.content_piece_post(v_shop, v_s2, 'tiktok', c_tt || 'f2', c_tt || 'f2', now() - interval '7 days', 'owner');
    perform analytics.content_post_metric_upsert(v_shop, pg_temp.pid(v_j), 1000, 10, 2, 500, 20, 'manual');
    select max(type_n_pieces) into v_a from analytics.v_content_hook_library where shop_id = v_shop and hook_type = 'question';
    v_log := v_log || pg_temp.bb('F2', 'ไม่เลือก hook: โพสต์ได้ (hook_id null · ชิ้น posted) · ไม่นับเข้าคลัง hook ใดๆ (question ยัง ' || v_n + 1 || ') · hook A/B ของชิ้นนั้น posts_n=0',
      pg_temp.st(v_s2) = 'posted/done' and (select hook_id is null from analytics.content_post where id = pg_temp.pid(v_j)) and v_a = v_n + 1
      and (select bool_and(posts_n = 0) from analytics.v_content_hook_library where step_id = v_s2), format('question=%s', v_a));
    -- F3: hook อื่น (ข้อความ+ประเภท) บนชิ้นที่ approved → สร้าง hook ours label null · วัดผลแล้ว นับเข้า question
    v_s3 := pg_temp.mkp(v_shop, 'live_cut', 'tiktok', 'approved');
    v_log := v_log || pg_temp.lg('F3pre', 'approved แต่ยังไม่ยืนยันว่ามีภาพ (footage_status ว่าง/needs_shoot) → content_piece_post ปฏิเสธ 55000 (ไม่โพสต์คลิปที่ยังไม่ได้ถ่าย) · ชิ้นไม่ขยับ',
      pg_temp.qx_ex(format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,%L,now() - interval ''1 hour'',''owner'')', v_shop, v_s3, c_tt || 'f3x', c_tt || 'f3x'), array['55000']) || case when pg_temp.st(v_s3) = 'approved/active' or pg_temp.st(v_s3) like 'approved/%' then '' else ' FAIL ขยับ ' || pg_temp.st(v_s3) end);
    v_log := v_log || pg_temp.nn('F3pre2', 'ข้อความปฏิเสธของ content_piece_post บน approved ที่ไม่มีภาพขึ้นชื่อ content_piece_advance (มาจาก transition_ ร่วม) — UI ต้องแมปตามรหัส 55000 + ข้อความไทย ห้ามพึ่งชื่อฟังก์ชันในข้อความ');
    perform analytics.content_piece_set_plan(v_shop, v_s3, jsonb_build_object('footage_status', 'has_footage'), 'owner');
    select count(*) into v_n3 from analytics.content_hook where step_id = v_s3;
    v_j := analytics.content_piece_post(v_shop, v_s3, 'tiktok', c_tt || 'f3', c_tt || 'f3', now() - interval '7 days', 'owner', null, 'hook อื่น 🔥 ภาษาไทย', 'question');
    perform analytics.content_post_metric_upsert(v_shop, pg_temp.pid(v_j), 1000, 10, 2, 100, 20, 'manual');
    select max(type_n_pieces) into v_a from analytics.v_content_hook_library where shop_id = v_shop and hook_type = 'question';
    v_log := v_log || pg_temp.bb('F3', 'approved (live_cut) โพสต์ตรงพร้อม hook อื่น → posted · hook ใหม่ ours label null ผูกโพสต์ · hook จริงบนชิ้น +1 · question นับเพิ่มเป็น ' || v_n + 2,
      pg_temp.st(v_s3) = 'posted/done' and (select count(*) from analytics.content_hook where step_id = v_s3) = v_n3 + 1
      and exists (select 1 from analytics.v_content_hook_library where hook_id = (v_j ->> 'hook_id')::uuid and label is null and text = 'hook อื่น 🔥 ภาษาไทย' and posts_n = 1 and measured_n = 1) and v_a = v_n + 2, format('question=%s', v_a));
    -- F4: LINE: approved → posted ไม่มีลิงก์ · ไม่สร้าง content_post · นับใน v_line_quota_28d
    select count(*) into v_n3 from analytics.content_post;
    v_s4 := pg_temp.mkp(v_shop, 'line_message', 'line_oa', 'approved');
    v_j := analytics.content_piece_advance(v_shop, v_s4, 'posted', 'owner');
    select * into v_q from analytics.v_line_quota_28d where shop_id = v_shop;
    v_log := v_log || pg_temp.bb('F4a', 'LINE approved → posted โดยไม่มีลิงก์ · content_post ไม่เพิ่ม · used_28d +1 · remaining −1 (ไม่ต่ำกว่า 0) · planned_28d ไม่เพิ่มจากชิ้นที่ posted แล้ว',
      pg_temp.st(v_s4) = 'posted/done' and (select count(*) from analytics.content_post) = v_n3 and v_q.used_28d = v_q0.used_28d + 1 and v_q.remaining_28d = greatest(4 - v_q.used_28d, 0)
      and v_q.planned_28d = v_q0.planned_28d, format('used %s→%s planned %s→%s remaining=%s', v_q0.used_28d, v_q.used_28d, v_q0.planned_28d, v_q.planned_28d, v_q.remaining_28d));
    v_log := v_log || pg_temp.bb('F4b', 'ชิ้น LINE ที่ posted: effective_piece_status = posted · posted_on = วันนี้ไทย · อยู่ในปฏิทิน ธง no_link_overdue = false',
      exists (select 1 from analytics.v_content_piece p where p.step_id = v_s4 and p.effective_piece_status = 'posted' and p.posted_on = v_today)
      and exists (select 1 from analytics.v_content_piece_calendar c where c.step_id = v_s4 and c.flag_no_link_overdue is false), '');
    v_log := v_log || pg_temp.lg('F4c', 'content_piece_post บนชิ้น LINE → ปฏิเสธ 55000 (ไม่มีลิงก์ ใช้ advance posted)', pg_temp.qx_ex(format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,%L,now() - interval ''1 hour'',''owner'')', v_shop, v_s4, c_tt || 'f4', c_tt || 'f4'), array['55000']));
    -- F4d: LINE เกิน quota (≥ 5 ใน 28 วัน) → remaining ไม่ติดลบ · over_quota_planned
    for i in 1..5 loop
      v_s5 := pg_temp.mkp(v_shop, 'line_message', 'line_oa', 'approved', i);
      perform analytics.content_piece_advance(v_shop, v_s5, 'posted', 'owner');
    end loop;
    select * into v_q from analytics.v_line_quota_28d where shop_id = v_shop;
    v_log := v_log || pg_temp.bb('F4d', 'LINE posted เกินโควตา (6 ใบใน 28 วัน) → remaining_28d = 0 (ไม่ติดลบ) · used_28d = ' || v_q.used_28d, v_q.used_28d = v_q0.used_28d + 6 and v_q.remaining_28d = 0 and v_q.over_quota_planned is not null, format('used=%s remaining=%s', v_q.used_28d, v_q.remaining_28d));
    -- F5: ig_fb_post 2 โพสต์ + unlink ใบหนึ่ง: ชิ้นไม่ถอย · unlink ใบสุดท้าย: ถอย produced
    v_s6 := pg_temp.mkp(v_shop, 'ig_fb_post', 'facebook', 'produced');
    v_j := analytics.content_piece_post(v_shop, v_s6, 'facebook', 'qa160-fb-f5', 'https://www.facebook.com/qa160x/posts/f5', now() - interval '1 day', 'owner');
    v_j2 := analytics.content_piece_post(v_shop, v_s6, 'instagram', 'qa160-ig-f5', 'https://www.instagram.com/p/qa160xf5/', now() - interval '1 day', 'owner');
    v_log := v_log || pg_temp.bb('F5a', 'ig_fb_post: facebook แล้ว instagram → posted · ใบที่ 2 additional=true · posts ใน v_content_piece = 2', pg_temp.st(v_s6) = 'posted/done' and (v_j2 ->> 'additional')::boolean and (v_j ->> 'additional')::boolean is false
      and (select jsonb_array_length(posts) = 2 from analytics.v_content_piece where step_id = v_s6), '');
    perform analytics.content_post_unlink_step(v_shop, pg_temp.pid(v_j), 'ถอดใบ FB', 'owner');
    v_log := v_log || pg_temp.bb('F5b', 'unlink 1 ใน 2 โพสต์ → ชิ้นยัง posted · event unpost เขียนแล้ว (remaining_active_posts=1)', pg_temp.st(v_s6) = 'posted/done'
      and exists (select 1 from analytics.content_piece_event where step_id = v_s6 and event_kind = 'unpost' and (payload ->> 'remaining_active_posts')::int = 1), pg_temp.st(v_s6));
    perform analytics.content_post_unlink_step(v_shop, pg_temp.pid(v_j2), 'ถอดใบ IG', 'owner');
    v_log := v_log || pg_temp.bb('F5c', 'unlink ใบสุดท้าย → ชิ้นถอย produced (ไม่ใช่ approved/ค้าง posted ทั้งที่ไม่มีโพสต์)', pg_temp.st(v_s6) like 'produced/%', pg_temp.st(v_s6));
    -- F5d: post ซ้ำ platform เดียวกันหลัง unlink ได้ (ไม่ติด unique ของใบเก่า) · โพสต์ใหม่ external_id เดิมกับที่ unlink ไปแล้ว = ใช้โพสต์เดิมซ้ำได้
    v_log := v_log || pg_temp.lg('F5d', 'หลัง unlink วางลิงก์ facebook เดิม (external_id เดิม) ผ่าน content_piece_post ได้อีก (โพสต์ไม่ผูกชิ้นแล้ว)',
      pg_temp.qx_ok(format('select analytics.content_piece_post(%L::uuid,%L::uuid,''facebook'',''qa160-fb-f5'',''https://www.facebook.com/qa160x/posts/f5'',now() - interval ''1 day'',''owner'')', v_shop, v_s6)));
  exception when others then
    v_log := v_log || format(E'[FAIL] F ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  ----------------------------------------------------------------------------
  -- C. content_piece_defer บนชิ้น ต.ค. จริง (26 ชิ้น) — ใน subtransaction แล้วถอยเอง · ตัวแปรเก็บผล
  ----------------------------------------------------------------------------
  begin
    declare
      v_cnt int := 0; v_badc text := ''; v_old date; v_new date; v_oth_before text; v_oth_after text; v_ev int; v_cal date; v_st_before text; v_st_after text;
      v_sid uuid;
    begin
      begin
        for rr in select s.id, s.piece_status, s.piece_kind from analytics.campaign_step s
                   where s.piece_status is not null and s.title not like 'qa160%' order by s.id loop
          v_sid := rr.id;
          select resolved_start into v_old from analytics.v_content_piece where step_id = v_sid;
          select md5(string_agg(step_id::text || resolved_start::text, ',' order by step_id)) into v_oth_before from analytics.v_content_piece where step_id <> v_sid;
          v_st_before := pg_temp.st(v_sid);
          perform analytics.content_piece_defer(v_shop, v_sid, v_old + 1, 'เลื่อนทดสอบ QA ' || rr.piece_status, 'owner');
          select resolved_start into v_cal from analytics.v_content_piece_calendar where step_id = v_sid;
          select md5(string_agg(step_id::text || resolved_start::text, ',' order by step_id)) into v_oth_after from analytics.v_content_piece where step_id <> v_sid;
          select count(*) into v_ev from analytics.content_piece_event where step_id = v_sid and event_kind = 'defer' and (payload ->> 'to_date')::date = v_old + 1 and (payload ->> 'from_date')::date = v_old;
          v_st_after := pg_temp.st(v_sid);
          v_cnt := v_cnt + 1;
          if v_cal is distinct from v_old + 1 or v_oth_before is distinct from v_oth_after or v_ev <> 1 or v_st_before is distinct from v_st_after then
            v_badc := v_badc || format('[%s %s cal=%s≠%s oth=%s ev=%s st=%s→%s] ', left(v_sid::text, 8), rr.piece_status, v_cal, v_old + 1, v_oth_before = v_oth_after, v_ev, v_st_before, v_st_after);
          end if;
        end loop;
        raise exception 'qa_rollback' using errcode = 'QA001';
      exception when sqlstate 'QA001' then null;
      end;
      v_log := v_log || pg_temp.bb('C1', 'defer +1 วัน กับ "ทุกชิ้น" ที่ไม่ใช่ของทดสอบ (' || v_cnt || ' ชิ้น ต.ค. จริง): ปฏิทินแสดงวันใหม่ · ชิ้นอื่นวันไม่ขยับ · event defer 1 แถว (from/to ถูก) · piece_status/สถานะไม่เปลี่ยน',
        v_cnt >= 26 and v_badc = '', coalesce(nullif(v_badc, ''), v_cnt || ' ชิ้นผ่านหมด'));
    end;
    -- C2: หลังถอย (rollback sentinel) ของจริงไม่ขยับ
    select count(*) into v_n from analytics.content_piece_event where event_kind = 'defer' and step_id in (select id from analytics.campaign_step where title not like 'qa160%');
    v_log := v_log || pg_temp.bb('C2', 'sentinel rollback ของ C1 ทำงาน: ไม่มี event defer ค้างบนชิ้นจริง', v_n = 0, 'ค้าง ' || v_n);
    -- C3: ขอบวัน/เวลา
    v_s1 := pg_temp.mkp(v_shop, 'short_clip', 'tiktok', 'approved', 3);
    v_log := v_log || pg_temp.lg('C3a', 'defer วันเท่าเดิม ไม่ส่งเวลา → 55000 (ไม่ no-op เงียบ)', pg_temp.qx_ex(format('select analytics.content_piece_defer(%L::uuid,%L::uuid,%L::date,''ทดสอบ'',''owner'')', v_shop, v_s1, v_today + 3), array['55000']));
    v_log := v_log || pg_temp.lg('C3b', 'defer วันเดิม + เวลาใหม่ → สำเร็จ (เปลี่ยนเวลาอย่างเดียว) · start_time ใหม่ถูกเก็บ',
      pg_temp.qx_ok(format('select analytics.content_piece_defer(%L::uuid,%L::uuid,%L::date,''เปลี่ยนเวลา'',''owner'',''19:30''::time)', v_shop, v_s1, v_today + 3)));
    v_log := v_log || pg_temp.bb('C3c', 'start_time = 19:30 ในปฏิทิน · วันไม่เปลี่ยน', (select start_time = '19:30' and resolved_start = v_today + 3 from analytics.v_content_piece_calendar where step_id = v_s1), '');
    v_log := v_log || pg_temp.lg('C3d', 'defer ไปวันที่ 2024-12-31 / วันนี้+1101 / วันที่ผิดรูป (infinity) → 22023', pg_temp.qx_ex(format('select analytics.content_piece_defer(%L::uuid,%L::uuid,date ''2024-12-31'',''ทดสอบ'',''owner'')', v_shop, v_s1), array['22023'])
      || pg_temp.qx_ex(format('select analytics.content_piece_defer(%L::uuid,%L::uuid,%L::date,''ทดสอบ'',''owner'')', v_shop, v_s1, v_today + 1101), array['22023'])
      || pg_temp.qx_ex(format('select analytics.content_piece_defer(%L::uuid,%L::uuid,date ''infinity'',''ทดสอบ'',''owner'')', v_shop, v_s1), array['22023']));
    v_log := v_log || pg_temp.lg('C3e', 'defer ขอบ: 2025-01-01 และ วันนี้+1100 ผ่าน (ขอบในช่วง)', pg_temp.qx_ok(format('select analytics.content_piece_defer(%L::uuid,%L::uuid,date ''2025-01-01'',''ถอยขอบล่าง'',''owner'')', v_shop, v_s1))
      || pg_temp.qx_ok(format('select analytics.content_piece_defer(%L::uuid,%L::uuid,%L::date,''ขอบบน'',''owner'')', v_shop, v_s1, v_today + 1100)));
    v_log := v_log || pg_temp.lg('C3f', 'defer: ไม่มีเหตุผล / เหตุผล ZWSP ล้วน / 501 ตัว / actor ai → ปฏิเสธ', pg_temp.qx_ex(format('select analytics.content_piece_defer(%L::uuid,%L::uuid,%L::date,null,''owner'')', v_shop, v_s1, v_today + 9), array['22023'])
      || pg_temp.qx_ex(format('select analytics.content_piece_defer(%L::uuid,%L::uuid,%L::date,%L,''owner'')', v_shop, v_s1, v_today + 9, chr(8203) || chr(8203) || chr(8203)), array['22023'])
      || pg_temp.qx_ex(format('select analytics.content_piece_defer(%L::uuid,%L::uuid,%L::date,%L,''owner'')', v_shop, v_s1, v_today + 9, repeat('ก', 501)), array['22023'])
      || pg_temp.qx_ex(format('select analytics.content_piece_defer(%L::uuid,%L::uuid,%L::date,''เหตุผล'',''ai'')', v_shop, v_s1, v_today + 9), array['42501', '22023', '55000']));
    -- C4: defer ชิ้น posted/cancelled/idea/ข้ามร้าน/ไม่ใช่ workflow
    v_s2 := pg_temp.mkp(v_shop, 'line_message', 'line_oa', 'approved');
    perform analytics.content_piece_advance(v_shop, v_s2, 'posted', 'owner');
    v_log := v_log || pg_temp.lg('C4a', 'defer ชิ้น posted → 55000', pg_temp.qx_ex(format('select analytics.content_piece_defer(%L::uuid,%L::uuid,%L::date,''ทดสอบ'',''owner'')', v_shop, v_s2, v_today + 9), array['55000']));
    v_log := v_log || pg_temp.lg('C4b', 'defer step_id ที่ไม่มีอยู่จริง → 22023', pg_temp.qx_ex(format('select analytics.content_piece_defer(%L::uuid,gen_random_uuid(),%L::date,''ทดสอบ'',''owner'')', v_shop, v_today + 9), array['22023']));
    v_log := v_log || pg_temp.lg('C4c', 'defer ด้วย shop_id คนละร้าน (ร้านที่ไม่มีอยู่) → ไม่แตะข้อมูล (22023/42501)',
      pg_temp.qx_ex(format('select analytics.content_piece_defer(gen_random_uuid(),%L::uuid,%L::date,''ทดสอบ'',''owner'')', v_s1, v_today + 9), array['22023', '42501']));
    v_snap := pg_temp.snap();
    v_log := v_log || pg_temp.lg('C4d', 'defer ชิ้นที่ไม่ใช่ workflow (step ก่อน ต.ค. piece_status null) → 22023', coalesce(
      (select pg_temp.qx_ex(format('select analytics.content_piece_defer(%L::uuid,%L::uuid,%L::date,''ทดสอบ'',''owner'')', v_shop, s.id, v_today + 9), array['22023'])
         from analytics.campaign_step s where s.piece_status is null order by s.id limit 1), 'OK (ไม่มี step นอก workflow ให้ทดสอบ)'));
    v_log := v_log || pg_temp.bb('C4e', 'ชุดปฏิเสธ C4 ไม่ทำให้ข้อมูลขยับ (snap เท่าเดิม)', v_snap = pg_temp.snap(), '');
  exception when others then
    v_log := v_log || format(E'[FAIL] C ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  ----------------------------------------------------------------------------
  -- E. E4a (เปลี่ยน kind ↔ line_audience อัตโนมัติ) + 0159 รอบเก็บงาน (stale_sources · artifact ≤ 1)
  ----------------------------------------------------------------------------
  begin
    v_s1 := pg_temp.mkp(v_shop, 'line_message', 'line_oa', 'planned');
    select line_audience into v_txt from analytics.campaign_step where id = v_s1;
    v_log := v_log || pg_temp.bb('E1a', 'ชิ้น line_message ใหม่ได้ line_audience = all อัตโนมัติ', v_txt = 'all', coalesce(v_txt, 'null'));
    v_log := v_log || pg_temp.lg('E1b', 'line_message → story (ส่งแค่ piece_kind+channel · ไม่ส่ง line_audience) สำเร็จ', pg_temp.qx_ok(format('select analytics.content_piece_set_plan(%L::uuid,%L::uuid,jsonb_build_object(''piece_kind'',''story'',''channel'',''instagram''),''owner'')', v_shop, v_s1)));
    select line_audience, line_audience_reason, piece_kind into rr from analytics.campaign_step where id = v_s1;
    v_log := v_log || pg_temp.bb('E1c', 'หลังเปลี่ยนเป็น story: line_audience/reason = null · piece_kind = story', rr.line_audience is null and rr.line_audience_reason is null and rr.piece_kind = 'story', format('aud=%s reason=%s kind=%s', rr.line_audience, rr.line_audience_reason, rr.piece_kind));
    v_log := v_log || pg_temp.bb('E1d', 'event plan บันทึก diff ที่มี line_audience เปลี่ยน (ตามรอยได้ว่าทำไมหาย)', exists (select 1 from analytics.content_piece_event where step_id = v_s1 and event_kind = 'plan' and payload::text like '%line_audience%'), '');
    v_log := v_log || pg_temp.lg('E1e', 'story → line_message (channel line_oa · ไม่ส่ง audience) สำเร็จ · ได้ line_audience = all', pg_temp.qx_ok(format('select analytics.content_piece_set_plan(%L::uuid,%L::uuid,jsonb_build_object(''piece_kind'',''line_message'',''channel'',''line_oa''),''owner'')', v_shop, v_s1)));
    select line_audience into v_txt from analytics.campaign_step where id = v_s1;
    v_log := v_log || pg_temp.bb('E1f', 'หลังกลับเป็น line_message: line_audience = all (ค่าเริ่มต้นตามมติ)', v_txt = 'all', coalesce(v_txt, 'null'));
    -- segment + reason แล้วออกจาก line_message → ล้างทั้งคู่ · แล้ว audience_segment (ของบอร์ดเดิม) ไม่ถูกล้าง
    update analytics.campaign_step set audience_segment = 'champion' where id = v_s1;
    perform analytics.content_piece_set_plan(v_shop, v_s1, jsonb_build_object('line_audience', 'segment', 'line_audience_reason', 'เหตุผลทดสอบ segment'), 'owner');
    perform analytics.content_piece_set_plan(v_shop, v_s1, jsonb_build_object('piece_kind', 'story', 'channel', 'instagram'), 'owner');
    select line_audience, line_audience_reason, audience_segment into rr from analytics.campaign_step where id = v_s1;
    v_log := v_log || pg_temp.bb('E1g', 'segment+reason → story: ล้าง line_audience+reason · audience_segment (คอลัมน์บอร์ดเดิม) ไม่ถูกล้าง', rr.line_audience is null and rr.line_audience_reason is null and rr.audience_segment = 'champion', format('aud=%s reason=%s seg=%s', rr.line_audience, rr.line_audience_reason, rr.audience_segment));
    -- ส่ง line_audience เองตอนออกจาก line_message = เจตนาชัด → ยังต้องปฏิเสธตามกติกา (ไม่กลืนเงียบ)
    v_s2 := pg_temp.mkp(v_shop, 'line_message', 'line_oa', 'planned');
    v_log := v_log || pg_temp.lg('E1i', 'line_message → story + line_audience=all ส่งมาเอง → 22023', pg_temp.qx_ex(format('select analytics.content_piece_set_plan(%L::uuid,%L::uuid,jsonb_build_object(''piece_kind'',''story'',''channel'',''instagram'',''line_audience'',''all''),''owner'')', v_shop, v_s2), array['22023']));
    -- ไม่เปลี่ยน kind จริง (ส่ง kind เดิม) ต้องไม่ล้าง line_audience/reason
    update analytics.campaign_step set audience_segment = 'loyal' where id = v_s2;
    perform analytics.content_piece_set_plan(v_shop, v_s2, jsonb_build_object('line_audience', 'segment', 'line_audience_reason', 'เหตุผลเดิม'), 'owner');
    perform analytics.content_piece_set_plan(v_shop, v_s2, jsonb_build_object('piece_kind', 'line_message', 'channel', 'line_oa'), 'owner');
    select line_audience, line_audience_reason into rr from analytics.campaign_step where id = v_s2;
    v_log := v_log || pg_temp.bb('E1j', 'ส่ง piece_kind เดิม (ไม่เปลี่ยนจริง) ไม่ล้าง line_audience=segment/reason', rr.line_audience = 'segment' and rr.line_audience_reason = 'เหตุผลเดิม', format('aud=%s reason=%s', rr.line_audience, rr.line_audience_reason));
    select count(*) into v_n from analytics.content_piece_event where step_id = v_s2 and event_kind = 'plan';
    perform analytics.content_piece_set_plan(v_shop, v_s2, jsonb_build_object('piece_kind', 'line_message', 'channel', 'line_oa'), 'owner');
    select count(*) into v_n2 from analytics.content_piece_event where step_id = v_s2 and event_kind = 'plan';
    v_log := v_log || pg_temp.bb('E1k', 'set_plan ค่าเดิมซ้ำ → ไม่เกิด event plan ใหม่ (ไม่ท่วม timeline)', v_n = v_n2, v_n || '→' || v_n2);
    -- ชิ้นที่ approved แล้วเปลี่ยน kind (ล็อกแล้ว) ยังต้องปฏิเสธ — E4a ต้องไม่เปิดช่อง
    v_s3 := pg_temp.mkp(v_shop, 'line_message', 'line_oa', 'approved');
    v_log := v_log || pg_temp.lg('E1l', 'ชิ้น approved เปลี่ยน piece_kind ผ่าน set_plan → ปฏิเสธ (ล็อกหลังอนุมัติ — E4a ไม่เปิดช่อง)', pg_temp.qx_ex(format('select analytics.content_piece_set_plan(%L::uuid,%L::uuid,jsonb_build_object(''piece_kind'',''story'',''channel'',''instagram''),''owner'')', v_shop, v_s3), array['55000', '22023']));
    select piece_kind, line_audience into rr from analytics.campaign_step where id = v_s3;
    v_log := v_log || pg_temp.bb('E1m', 'ชิ้น approved ที่ถูกปฏิเสธ ยังเป็น line_message + audience เดิม (ไม่ล้างครึ่งๆ กลางๆ)', rr.piece_kind = 'line_message' and rr.line_audience = 'all', format('kind=%s aud=%s', rr.piece_kind, rr.line_audience));

    -- stale_sources (R): fact_check ผ่านด้วย sources → แก้เนื้อหา → ผลตรวจ pending + sources ย้ายเป็น stale_sources → pass ซ้ำโดยไม่มีแหล่งใหม่ต้องถูกปฏิเสธ
    v_s4 := pg_temp.mkp(v_shop, 'ig_fb_post', 'facebook', 'in_review');
    perform analytics.content_gate_record(v_shop, v_s4, 'fact_check', 'passed', 'owner', jsonb_build_object('sources', jsonb_build_array('https://example.com/old-source')));
    select a.id into v_art from analytics.step_artifact a where a.step_id = v_s4;
    perform analytics.campaign_set_artifact_content(v_art, 'เนื้อหาใหม่หลังตรวจแล้ว', null);
    select g.status, g.detail into rr from analytics.step_gate g where g.step_id = v_s4 and g.gate_kind = 'fact_check';
    v_log := v_log || pg_temp.bb('E2a', 'แก้เนื้อหาหลัง fact_check ผ่าน → fact_check = pending · detail.sources หาย · detail.stale_sources เก็บของเก่า (ไม่ลบ)',
      rr.status = 'pending' and not (rr.detail ? 'sources') and rr.detail -> 'stale_sources' = jsonb_build_array('https://example.com/old-source'), format('status=%s detail=%s', rr.status, left(rr.detail::text, 120)));
    v_log := v_log || pg_temp.lg('E2b', 'กด passed ซ้ำโดยไม่ส่งแหล่งใหม่ → 22023 (ไม่หยิบแหล่งของข้อความเก่ามาผ่านด่าน)', pg_temp.qx_ex(format('select analytics.content_gate_record(%L::uuid,%L::uuid,''fact_check'',''passed'',''owner'')', v_shop, v_s4), array['22023']));
    v_log := v_log || pg_temp.lg('E2c', 'ส่ง detail = {stale_sources:[...]} มาเองเพื่อลักไก่ → 22023 (ไม่รับ key นี้ขาเข้า)', pg_temp.qx_ex(format('select analytics.content_gate_record(%L::uuid,%L::uuid,''fact_check'',''passed'',''owner'',jsonb_build_object(''stale_sources'',jsonb_build_array(''https://example.com/old-source'')))', v_shop, v_s4), array['22023']));
    v_log := v_log || pg_temp.lg('E2d', 'ส่งแหล่งใหม่ผ่านด่านได้ · stale_sources เดิมยังอยู่ในประวัติ', pg_temp.qx_ok(format('select analytics.content_gate_record(%L::uuid,%L::uuid,''fact_check'',''passed'',''owner'',jsonb_build_object(''sources'',jsonb_build_array(''https://example.com/new-source'')))', v_shop, v_s4)));
    select g.status, g.detail into rr from analytics.step_gate g where g.step_id = v_s4 and g.gate_kind = 'fact_check';
    v_log := v_log || pg_temp.bb('E2e', 'หลังผ่านด้วยแหล่งใหม่: status=passed · sources=[new] (ไม่มีแหล่งเก่าปน)', rr.status = 'passed' and rr.detail -> 'sources' = jsonb_build_array('https://example.com/new-source'), left(rr.detail::text, 160));
    v_log := v_log || pg_temp.nn('E2e2', 'หลังผ่านด่านใหม่ detail ถูกแทนทั้งก้อน → stale_sources (ประวัติแหล่งเก่า) หายจากแถว step_gate · ประวัติเหลือในตาราง event เท่านั้น: payload มี URL แหล่งเก่า = ' || exists (select 1 from analytics.content_piece_event e where e.step_id = v_s4 and e.payload::text like '%old-source%')::text || ' (คอมเมนต์ใน 0159 ข้อ R เขียน "ไม่ลบ — เห็นประวัติ" จริงเฉพาะช่วงที่ด่านยัง pending)');
    -- แก้เนื้อหาซ้ำ 2 รอบ (ไม่ผ่านด่านระหว่างนั้น) → stale ไม่ทับของเก่าจนหาย? บันทึกพฤติกรรม
    perform analytics.campaign_set_artifact_content(v_art, 'เนื้อหารอบ 3', null);
    perform analytics.campaign_set_artifact_content(v_art, 'เนื้อหารอบ 4', null);
    select g.detail into rr from analytics.step_gate g where g.step_id = v_s4 and g.gate_kind = 'fact_check';
    v_log := v_log || pg_temp.bb('E2f', 'แก้เนื้อหา 2 ครั้งติดหลังผ่านด่านด้วยแหล่งใหม่ → detail.sources หาย (ไม่มีแหล่งค้างให้ผ่านด่านได้) · stale_sources สะสม [old, new] (I-1 รอบ 3: ต่อท้ายไม่ทับ · เดิมคาดแค่ [new])', not (rr.detail ? 'sources') and rr.detail -> 'stale_sources' = jsonb_build_array('https://example.com/old-source', 'https://example.com/new-source'), left(rr.detail::text, 140));
    -- ≤ 1 artifact ต่อชิ้นใน workflow · step นอก workflow ยังเพิ่มได้ (ต้องไม่พัง)
    v_log := v_log || pg_temp.lg('E3a', 'เสียบ artifact ตัวที่ 2 ให้ชิ้นใน workflow ตรงๆ → 55000 (v_content_piece แสดงตัวแรกตัวเดียว)',
      pg_temp.qx_ex(format('insert into analytics.step_artifact (step_id, shop_id, artifact_type, owner_role) select step_id, shop_id, artifact_type, owner_role from analytics.step_artifact where step_id = %L::uuid', v_s4), array['55000']));
    select s.id into v_s5 from analytics.campaign_step s where s.piece_status is null and exists (select 1 from analytics.step_artifact a where a.step_id = s.id) order by s.id limit 1;
    if v_s5 is null then
      v_log := v_log || E'[SKIP] E3b ไม่มี step นอก workflow ที่มี artifact ให้ทดสอบ "ต้องไม่พัง"\n';
    else
      v_log := v_log || pg_temp.lg('E3b', 'ต้องไม่พัง: step นอก workflow (piece_status null) เพิ่ม artifact ตัวที่ 2 ได้ตามเดิม',
        pg_temp.qx_ok(format('insert into analytics.step_artifact (step_id, shop_id, artifact_type, owner_role) select step_id, shop_id, artifact_type, owner_role from analytics.step_artifact where step_id = %L::uuid limit 1', v_s5)));
    end if;
    v_log := v_log || pg_temp.bb('E3c', 'ไม่มีชิ้นใน workflow ที่มี artifact > 1 ตัว (ด่านท้ายของ 0159 เทียบกับจริงอีกรอบ)',
      (select count(*) from (select s.id from analytics.campaign_step s join analytics.step_artifact a on a.step_id = s.id where s.piece_status is not null group by s.id having count(*) > 1) x) = 0, '');
  exception when others then
    v_log := v_log || format(E'[FAIL] E ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  ----------------------------------------------------------------------------
  -- I. input edge ของ RPC 0160 — ทุกเคสปฏิเสธต้องไม่แตะข้อมูล (snap เท่าเดิม)
  ----------------------------------------------------------------------------
  begin
    v_s1 := pg_temp.mkp(v_shop, 'short_clip', 'tiktok', 'produced');
    v_s2 := pg_temp.mkp(v_shop, 'short_clip', 'tiktok', 'produced');
    v_snap := pg_temp.snap();
    v_bad := null; v_n := 0;
    -- (id, sql) เคสที่ต้องถูกปฏิเสธด้วย 22023 (อินพุตผิด)
    for rr in
      select * from (values
        ('platform ตัวพิมพ์ใหญ่ TikTok', format('select analytics.content_piece_post(%L::uuid,%L::uuid,''TikTok'',%L,%L,now() - interval ''1 hour'',''owner'')', v_shop, v_s1, c_tt || 'i1', c_tt || 'i1')),
        ('platform มีช่องว่างท้าย', format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok '',%L,%L,now() - interval ''1 hour'',''owner'')', v_shop, v_s1, c_tt || 'i2', c_tt || 'i2')),
        ('platform line_oa', format('select analytics.content_piece_post(%L::uuid,%L::uuid,''line_oa'',%L,%L,now() - interval ''1 hour'',''owner'')', v_shop, v_s1, c_tt || 'i3', c_tt || 'i3')),
        ('external_id ว่าง', format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'','''',%L,now() - interval ''1 hour'',''owner'')', v_shop, v_s1, c_tt || 'i4')),
        ('external_id เว้นวรรคล้วน', format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',''   '',%L,now() - interval ''1 hour'',''owner'')', v_shop, v_s1, c_tt || 'i5')),
        ('url ว่าง', format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,'''',now() - interval ''1 hour'',''owner'')', v_shop, v_s1, c_tt || 'i6')),
        ('url javascript:', format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,''javascript:alert(1)'',now() - interval ''1 hour'',''owner'')', v_shop, v_s1, c_tt || 'i7')),
        ('url มี user@', format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,''https://user@www.tiktok.com/x'',now() - interval ''1 hour'',''owner'')', v_shop, v_s1, c_tt || 'i8')),
        ('url มีช่องว่างกลาง', format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,''https://www.tiktok.com/a b'',now() - interval ''1 hour'',''owner'')', v_shop, v_s1, c_tt || 'i9')),
        ('url 501 ตัว', format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,%L,now() - interval ''1 hour'',''owner'')', v_shop, v_s1, c_tt || 'i10', 'https://example.com/' || repeat('u', 482))),
        ('url มี < >', format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,''https://example.com/<script>'',now() - interval ''1 hour'',''owner'')', v_shop, v_s1, c_tt || 'i11')),
        ('posted_at อนาคต 1 นาที', format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,%L,now() + interval ''1 minute'',''owner'')', v_shop, v_s1, c_tt || 'i12', c_tt || 'i12')),
        ('posted_at infinity', format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,%L,''infinity''::timestamptz,''owner'')', v_shop, v_s1, c_tt || 'i13', c_tt || 'i13')),
        ('hook text เปล่า + type', format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,%L,now() - interval ''1 hour'',''owner'',null,'''',''question'')', v_shop, v_s1, c_tt || 'i14', c_tt || 'i14')),
        ('hook text ZWSP ล้วน + type', format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,%L,now() - interval ''1 hour'',''owner'',null,%L,''question'')', v_shop, v_s1, c_tt || 'i15', c_tt || 'i15', chr(8203) || chr(8203))),
        ('hook text 501 ตัว', format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,%L,now() - interval ''1 hour'',''owner'',null,%L,''question'')', v_shop, v_s1, c_tt || 'i16', c_tt || 'i16', repeat('ก', 501))),
        ('hook type ไม่รู้จัก', format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,%L,now() - interval ''1 hour'',''owner'',null,''ข้อความ'',''no_such_type'')', v_shop, v_s1, c_tt || 'i17', c_tt || 'i17')),
        ('hook type ตัวพิมพ์ใหญ่ QUESTION', format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,%L,now() - interval ''1 hour'',''owner'',null,''ข้อความ'',''QUESTION'')', v_shop, v_s1, c_tt || 'i18', c_tt || 'i18')),
        ('hook text มีแต่ไม่มี type', format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,%L,now() - interval ''1 hour'',''owner'',null,''ข้อความ'',null)', v_shop, v_s1, c_tt || 'i19', c_tt || 'i19')),
        ('hook type มีแต่ไม่มี text', format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,%L,now() - interval ''1 hour'',''owner'',null,null,''question'')', v_shop, v_s1, c_tt || 'i20', c_tt || 'i20')),
        ('hook marker [ต้องยืนยัน', format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,%L,now() - interval ''1 hour'',''owner'',null,%L,''question'')', v_shop, v_s1, c_tt || 'i21', c_tt || 'i21', 'ข้อความ [ต้องยืนยัน: ราคา]')),
        ('hook_id สุ่ม (ไม่มีจริง)', format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,%L,now() - interval ''1 hour'',''owner'',gen_random_uuid())', v_shop, v_s1, c_tt || 'i22', c_tt || 'i22')),
        ('hook_id ของชิ้นอื่น', format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,%L,now() - interval ''1 hour'',''owner'',%L::uuid)', v_shop, v_s1, c_tt || 'i23', c_tt || 'i23', pg_temp.hk(v_s2, 'A'))),
        ('hook_id + hook อื่น พร้อมกัน', format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,%L,now() - interval ''1 hour'',''owner'',%L::uuid,''x'',''question'')', v_shop, v_s1, c_tt || 'i24', c_tt || 'i24', pg_temp.hk(v_s1, 'A'))),
        ('step_id สุ่ม', format('select analytics.content_piece_post(%L::uuid,gen_random_uuid(),''tiktok'',%L,%L,now() - interval ''1 hour'',''owner'')', v_shop, c_tt || 'i25', c_tt || 'i25')),
        ('ชนิด short_clip โพสต์ facebook', format('select analytics.content_piece_post(%L::uuid,%L::uuid,''facebook'',%L,%L,now() - interval ''1 hour'',''owner'')', v_shop, v_s1, 'qa-i26', 'https://www.facebook.com/qa160x/posts/i26'))
      ) as t(n, q)
    loop
      v_n := v_n + 1;
      v_r := pg_temp.qx_ex(rr.q, array['22023']);
      if v_r not like 'OK%' then v_bad := coalesce(v_bad || E'\n   ', '') || rr.n || ': ' || v_r; end if;
    end loop;
    v_log := v_log || pg_temp.bb('I1', 'content_piece_post อินพุตผิด ' || v_n || ' แบบ (platform ตัวพิมพ์/ช่องว่าง/line_oa · ext ว่าง · url อันตราย/ยาว · วันอนาคต/infinity · hook ว่าง/ZWSP/501/type ผิด/ตัวใหญ่/ขาดครึ่ง/marker/ไอดีสุ่ม/ข้ามชิ้น/ซ้อน · step สุ่ม · kind↔platform ผิด) = 22023 ทุกแบบ ไม่ใช่ 500/ผ่านเงียบ',
      v_bad is null and v_n >= 25, coalesce(v_bad, v_n || '/' || v_n));
    v_log := v_log || pg_temp.bb('I2', 'หลังชุดปฏิเสธ I1 ข้อมูลไม่ขยับเลย (โพสต์/hook/event/step เท่าเดิม) · GUC c2.piece_rpc ไม่ค้าง', v_snap = pg_temp.snap() and coalesce(current_setting('c2.piece_rpc', true), '') <> '1',
      case when v_snap = pg_temp.snap() then 'เท่าเดิม' else 'ข้อมูลขยับ!' end);
    -- actor ผิด
    v_bad := null;
    for rr in select unnest(array['ai', 'system', '', 'OWNER', ' owner', 'admin', 'x']) as role loop
      v_r := pg_temp.qx_ex(format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,%L,now() - interval ''1 hour'',%L)', v_shop, v_s1, c_tt || 'ia', c_tt || 'ia', rr.role), array['42501', '22023']);
      if v_r not like 'OK%' then v_bad := coalesce(v_bad || ', ', '') || '"' || rr.role || '": ' || v_r; end if;
    end loop;
    v_log := v_log || pg_temp.bb('I3', 'actor_role ai/system/ว่าง/OWNER/" owner"/admin/x ผ่าน content_piece_post ไม่ได้ (owner ตัวพิมพ์เล็กเป๊ะเท่านั้น)', v_bad is null, coalesce(v_bad, '7/7'));
    v_log := v_log || pg_temp.lg('I3b', 'actor ai บน link/unlink/defer → ปฏิเสธ', pg_temp.qx_ex(format('select analytics.content_post_link_step(%L::uuid,gen_random_uuid(),%L::uuid,''ai'')', v_shop, v_s1), array['42501', '22023'])
      || pg_temp.qx_ex(format('select analytics.content_post_unlink_step(%L::uuid,gen_random_uuid(),''เหตุผล'',''ai'')', v_shop), array['42501', '22023'])
      || pg_temp.qx_ex(format('select analytics.content_piece_defer(%L::uuid,%L::uuid,%L::date,''เหตุผล'',''ai'')', v_shop, v_s1, v_today + 4), array['42501', '22023']));
    -- ข้อความ hook ขอบ: 500 ตัวไทย+emoji ผ่าน · ZWSP แทรกกลางถูกล้าง
    v_r := pg_temp.qx_ok(format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,%L,now() - interval ''1 hour'',''owner'',null,%L,''story'')', v_shop, v_s1, c_tt || 'ib', c_tt || 'ib', repeat('ก', 250) || repeat('😀', 250)));
    v_log := v_log || pg_temp.lg('I4', 'hook อื่นยาว 500 ตัวอักษร (ไทย 250 + emoji 250) ผ่านได้ที่ขอบ', v_r);
    select h.text into v_txt from analytics.content_hook h where h.step_id = v_s1 and h.label is null order by h.created_at desc limit 1;
    v_log := v_log || pg_temp.bb('I4b', 'hook 500 ตัวถูกเก็บครบ (length = 500 ตัวอักษร ไม่ใช่ byte)', length(v_txt) = 500, 'length=' || coalesce(length(v_txt)::text, 'null'));
    -- caption ยาวมาก (0160 ไม่ครอบ — ช่องของฟังก์ชันเดิม)
    v_r := pg_temp.qx_ok(format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,%L,now() - interval ''1 hour'',''owner'',null,null,null,%L)', v_shop, v_s2, c_tt || 'ic', c_tt || 'ic', repeat('ก', 200000)));
    select length(cp.caption_snapshot) into v_n from analytics.content_post cp where cp.external_id = c_tt || 'ic';
    v_log := v_log || case when v_r = 'OK' and v_n = 200000 then pg_temp.nn('I5', 'caption 200,000 ตัวอักษรผ่าน content_piece_post (ไม่มีเพดานฝั่ง DB — เพดานอยู่ที่ lib เท่านั้น CAPTION_MAX_LEN · ผู้เรียกที่ถือ service key ยัดได้ไม่จำกัด) — Low')
      else pg_temp.bb('I5', 'caption ยาวมากถูกปฏิเสธ 22023 (S-L3 รอบ 3: เพดาน 2,200 ใน content_piece_post) · ไม่มีแถวค้าง', v_r like 'FAIL ควรสำเร็จแต่ตก sqlstate=22023%' and v_n is null, v_r || ' len=' || coalesce(v_n::text, 'null')) end;
    -- ขอบล่างวันโพสต์: -infinity / 1970 ผ่านไหม และผลต่อ view ทั้งชุด
    -- I6: ขอบล่างวันโพสต์ — ทดลองใน subtransaction แล้วถอยเอง (ไม่ให้แถว -infinity ค้างกวนส่วนอื่น) · อ่านทุกคอลัมน์ของทุก view (count(*) ไม่ประเมินคอลัมน์ที่ไม่ใช้)
    v_s3 := pg_temp.mkp(v_shop, 'short_clip', 'tiktok', 'produced');
    v_txt := '';
    begin
      v_r := pg_temp.qx_ok(format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,%L,''-infinity''::timestamptz,''owner'')', v_shop, v_s3, c_tt || 'inf', c_tt || 'inf'));
      if v_r = 'OK' then
        for rr in select unnest(array['v_content_piece', 'v_content_piece_calendar', 'v_content_inbox_counts', 'v_line_quota_28d', 'v_content_hook_library', 'v_content_entry_queue', 'v_content_post_t7']) as vn loop
          v_bad := pg_temp.qx_ok('select md5(coalesce(string_agg(t::text, '','' order by t::text), '''')) from analytics.' || rr.vn || ' t');
          if v_bad <> 'OK' then v_txt := v_txt || rr.vn || ' '; end if;
        end loop;
        v_txt := 'รับค่า; view อ่านไม่ได้: ' || coalesce(nullif(v_txt, ''), '(ไม่มี)');
      else
        v_txt := 'ปฏิเสธ: ' || v_r;
      end if;
      raise exception 'qa_rollback' using errcode = 'QA001';
    exception when sqlstate 'QA001' then null;
    end;
    v_log := v_log || case when v_txt like 'ปฏิเสธ:%' or v_txt like '%(ไม่มี)' then pg_temp.nn('I6', 'posted_at = -infinity: ' || v_txt)
      else pg_temp.bb('I6', 'BUG-LOW: content_piece_post (และ content_post_upsert เดิม 0148) รับ posted_at = -infinity เพราะไม่มีขอบล่าง → posted_date_th = -infinity → อ่านแถวจาก view ต่อไปนี้ไม่ได้ทั้งร้าน (22008 cannot subtract infinite dates) ' || v_txt || ' · ต้องเรียก RPC ตรงด้วยค่าประหลาด (UI/lib ส่ง ISO วันจริง) · แก้ถูก: ปฏิเสธ p_posted_at < 2025-01-01 ใน content_piece_post (ขอบเดียวกับ defer)', false, v_txt) end;
    -- I7: กดซ้ำ (double click) — คำสั่งเดียวกัน 2 ครั้งติด: ครั้งที่ 2 ปฏิเสธ 55000 · ไม่เกิดแถวซ้ำ/event ซ้ำ
    v_s4 := pg_temp.mkp(v_shop, 'short_clip', 'tiktok', 'produced');
    v_j := analytics.content_piece_post(v_shop, v_s4, 'tiktok', c_tt || 'dbl', c_tt || 'dbl', now() - interval '1 hour', 'owner', pg_temp.hk(v_s4, 'A'));
    v_snap := pg_temp.snap();
    v_log := v_log || pg_temp.lg('I7a', 'content_piece_post ซ้ำคำสั่งเดิมเป๊ะ (กดสองครั้ง) → 55000 ไม่ใช่ 500', pg_temp.qx_ex(format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,%L,now() - interval ''1 hour'',''owner'',%L::uuid)', v_shop, v_s4, c_tt || 'dbl', c_tt || 'dbl', pg_temp.hk(v_s4, 'A')), array['55000']));
    v_log := v_log || pg_temp.lg('I7b', 'ซ้ำแบบเปลี่ยน external_id (คนละลิงก์ platform เดียวกัน ชิ้นเดียวกัน) → 55000', pg_temp.qx_ex(format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,%L,now() - interval ''1 hour'',''owner'')', v_shop, v_s4, c_tt || 'dbl2', c_tt || 'dbl2'), array['55000']));
    v_log := v_log || pg_temp.bb('I7c', 'หลังกดซ้ำ ข้อมูลไม่ขยับเลย', v_snap = pg_temp.snap(), '');
    -- I8: hook อื่นข้อความ/ประเภทเดียวกันซ้ำ 2 ครั้งบน ig_fb_post (FB แล้ว IG) — ต้องไม่เป็น 500 (23505 ดิบ)
    v_s5 := pg_temp.mkp(v_shop, 'ig_fb_post', 'facebook', 'produced');
    v_j := analytics.content_piece_post(v_shop, v_s5, 'facebook', 'qa160-i8-fb', 'https://www.facebook.com/qa160x/posts/i8', now() - interval '1 hour', 'owner', null, 'hook อื่นซ้ำ', 'question');
    v_r := pg_temp.qx_ok(format('select analytics.content_piece_post(%L::uuid,%L::uuid,''instagram'',''qa160-i8-ig'',''https://www.instagram.com/p/qa160xi8/'',now() - interval ''1 hour'',''owner'',null,''hook อื่นซ้ำ'',''question'')', v_shop, v_s5));
    select count(*) into v_n from analytics.content_hook where step_id = v_s5 and text = 'hook อื่นซ้ำ';
    v_log := v_log || case when v_r = 'OK' then pg_temp.nn('I8', 'hook อื่นข้อความเดียวกันซ้ำบน ig_fb_post (IG หลัง FB): สำเร็จ · จำนวน hook ข้อความนี้บนชิ้น = ' || v_n || case when v_n > 1 then ' (สร้างซ้ำ — คลังนับตามชิ้น distinct จึงไม่เพี้ยน แต่ UI ควรเสนอ hook ที่เพิ่งสร้างแทน)' else ' (ใช้ hook เดิม)' end)
      else pg_temp.nn('I8', 'hook อื่นข้อความเดียวกันซ้ำบน ig_fb_post ถูกปฏิเสธ: ' || v_r || ' — UI ต้องส่ง p_hook_id ของ hook ที่เพิ่งสร้างสำหรับโพสต์ใบที่ 2') end;
  exception when others then
    v_log := v_log || format(E'[FAIL] I ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  exception when others then
    v_log := v_log || format(E'[FAIL] ABORT ก่อนถึงส่วนท้าย sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_ok   := (length(v_log) - length(replace(v_log, '[OK]', ''))) / 4;
  v_note := (length(v_log) - length(replace(v_log, '[NOTE]', ''))) / 6;
  perform set_config('qa160.log1', v_log, true);
end
$qa0160$;

do $qa0160b$
declare
  v_log   text := coalesce(current_setting('qa160.log1', true), E'[FAIL] ไม่พบ log ส่วน 1\n');
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_shop  uuid;
  v_n bigint; v_n2 bigint; v_n3 bigint; v_n4 bigint; v_a1 bigint; v_a2 bigint;
  v_r text; v_txt text; v_bad text;
  v_j jsonb; v_j2 jsonb;
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_p1 uuid; v_p2 uuid; v_b boolean; v_b2 boolean;
  v_in record; v_q record; rr record;
  v_wk date;
  v_ok int; v_fail int; v_note int;
  c_tt constant text := 'https://www.tiktok.com/@qa160z/video/';
begin
  begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  select id into v_shop from public.shop;

  ----------------------------------------------------------------------------
  -- Z. role service_role จริง: อ่าน view (security_invoker ⇒ service_role ต้องถือ select ตารางข้างใต้ครบ) + เรียก RPC ของ 0160
  ----------------------------------------------------------------------------
  begin
    v_s1 := pg_temp.mkp(v_shop, 'short_clip', 'tiktok', 'produced');
    v_s2 := pg_temp.mkp(v_shop, 'short_clip', 'tiktok', 'approved');
    perform analytics.content_piece_set_plan(v_shop, v_s2, jsonb_build_object('footage_status', 'has_footage'), 'owner');
    v_s3 := pg_temp.mkp(v_shop, 'ig_fb_post', 'facebook', 'approved');
    v_p1 := analytics.content_post_upsert(v_shop, 'tiktok', c_tt || 'z1', c_tt || 'z1', now() - interval '1 day');
    v_bad := '';
    execute 'set local role service_role';
    begin
      for rr in select unnest(array['v_content_piece_calendar', 'v_content_inbox_counts', 'v_line_quota_28d', 'v_content_hook_library', 'v_content_piece', 'v_content_entry_queue', 'v_content_post_t7']) as vn loop
        begin
          execute 'select count(*), md5(coalesce(string_agg(t::text, '','' order by t::text), '''')) from analytics.' || rr.vn || ' t' into v_n, v_txt;
        exception when others then
          v_bad := v_bad || rr.vn || ':' || sqlstate || ' ';
        end;
      end loop;
      v_j  := analytics.content_piece_post(v_shop, v_s1, 'tiktok', c_tt || 'z2', c_tt || 'z2', now() - interval '2 hours', 'owner', pg_temp.hk(v_s1, 'A'));
      v_j2 := analytics.content_post_link_step(v_shop, v_p1, v_s2, 'owner', pg_temp.hk(v_s2, 'B'));
      perform analytics.content_post_unlink_step(v_shop, v_p1, 'ทดสอบ service_role', 'owner');
      perform analytics.content_piece_defer(v_shop, v_s3, v_today + 11, 'ทดสอบ service_role', 'owner');
      v_r := 'OK';
    exception when others then
      v_r := 'FAIL sqlstate=' || sqlstate || ' msg=' || left(sqlerrm, 200);
    end;
    execute 'reset role';
    v_log := v_log || pg_temp.bb('Z1', 'service_role อ่าน view 7 ตัว (คลัง hook/ปฏิทิน/inbox/โควตา LINE + v_content_piece/คิวยอด/T+7) ได้ครบ — security_invoker ไม่ติดสิทธิ์ตารางข้างใต้', v_bad = '', coalesce(nullif(v_bad, ''), 'อ่านได้ครบ'));
    v_log := v_log || pg_temp.lg('Z2', 'service_role เรียก content_piece_post / link_step / unlink_step / defer สำเร็จทั้ง 4 ตัว (flow จริงของแอป)', v_r);
    v_log := v_log || pg_temp.bb('Z3', 'ผลจาก Z2 ถูกต้อง: s1 posted · โพสต์ p1 หลัง link→unlink ไม่ผูกชิ้น · s3 เลื่อนวัน +11 ในปฏิทิน',
      pg_temp.st(v_s1) = 'posted/done' and (select step_id is null from analytics.content_post where id = v_p1)
      and (select resolved_start = v_today + 11 from analytics.v_content_piece_calendar where step_id = v_s3), pg_temp.st(v_s1) || ' / ' || pg_temp.st(v_s2));
    v_bad := '';
    for rr in select unnest(array['v_content_piece_calendar', 'v_content_inbox_counts', 'v_line_quota_28d', 'v_content_hook_library']) as vn loop
      v_bad := v_bad || rr.vn || ':' || has_table_privilege('authenticated', 'analytics.' || rr.vn, 'select')::text || '/' || has_table_privilege('anon', 'analytics.' || rr.vn, 'select')::text || ' ';
    end loop;
    v_log := v_log || pg_temp.bb('Z4', 'authenticated/anon ไม่มีสิทธิ์ select view ใหม่ทั้ง 4 (has_table_privilege = false)', v_bad !~ 'true', v_bad);
  exception when others then
    execute 'reset role';
    v_log := v_log || format(E'[FAIL] Z ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  ----------------------------------------------------------------------------
  -- G. ชั้นตาราง: ผูกผิดชิ้น/ผิดร้าน/ซ้ำ ที่ชั้น DB ไม่พึ่ง RPC อย่างเดียว (บันทึกพฤติกรรม — RPC กันครบแล้ว นี่คือ defense in depth)
  ----------------------------------------------------------------------------
  begin
    select string_agg(x.p || '=' || has_table_privilege('service_role', 'analytics.content_post', x.p)::text, ' ') into v_txt from (values ('insert'), ('update'), ('delete')) x(p);
    v_log := v_log || pg_temp.nn('G1', 'สิทธิ์ service_role บนตาราง content_post: ' || v_txt || ' (ถ้า update=true ผู้ถือ service key เขียน step_id/hook_id ตรงได้ข้าม RPC — ดูข้อ G2-G5)');
    v_s1 := pg_temp.mkp(v_shop, 'short_clip', 'tiktok', 'produced');
    v_s2 := pg_temp.mkp(v_shop, 'short_clip', 'tiktok', 'produced');
    v_j  := analytics.content_piece_post(v_shop, v_s1, 'tiktok', c_tt || 'g1', c_tt || 'g1', now() - interval '1 hour', 'owner', pg_temp.hk(v_s1, 'A'));
    v_p1 := pg_temp.pid(v_j);
    v_r := pg_temp.qx_ex(format('update analytics.content_post set hook_id = %L::uuid where id = %L::uuid', pg_temp.hk(v_s2, 'A'), v_p1), array['23503', '23514', '55000', '42501', 'P0001', '22023']);
    v_log := v_log || case when v_r like 'OK%' then pg_temp.bb('G2', 'UPDATE content_post.hook_id ชี้ hook ของ "ชิ้นอื่น" ถูกปฏิเสธที่ชั้นตาราง', true, v_r)
      else pg_temp.nn('G2', 'UPDATE ตรง content_post.hook_id → hook ของชิ้นอื่น "ผ่าน" (ไม่มี constraint/trigger ที่ชั้นตาราง — ความถูกต้องพึ่ง RPC อย่างเดียว) ⇒ คลัง hook นับ hook ผิดชิ้นได้ถ้ามีคนเขียนตรง') end;
    v_s3 := pg_temp.mkp(v_shop, 'line_message', 'line_oa', 'planned');
    v_r := pg_temp.qx_ex(format('update analytics.content_post set step_id = %L::uuid where id = %L::uuid', v_s3, v_p1), array['23503', '23514', '55000', '42501', 'P0001', '22023']);
    v_log := v_log || case when v_r like 'OK%' then pg_temp.bb('G3', 'UPDATE content_post.step_id ไปชิ้น line_message (ชนิดไม่มีลิงก์) ถูกปฏิเสธที่ชั้นตาราง', true, v_r)
      else pg_temp.nn('G3', 'UPDATE ตรง content_post.step_id → ชิ้น line_message "ผ่าน" (ไม่มี guard ชนิด/platform ที่ชั้นตาราง — พึ่ง RPC)') end;
    v_p2 := analytics.content_post_upsert(v_shop, 'tiktok', c_tt || 'g4', c_tt || 'g4', now() - interval '1 hour');
    v_r := pg_temp.qx_ex(format('update analytics.content_post set step_id = %L::uuid where id = %L::uuid', v_s1, v_p2), array['23503', '23505', '23514', '55000', '42501', 'P0001', '22023']);
    v_log := v_log || case when v_r like 'OK%' then pg_temp.bb('G4', 'UPDATE ผูกโพสต์ tiktok ใบที่ 2 เข้าชิ้น clip ที่มีโพสต์ tiktok active อยู่แล้ว ถูกปฏิเสธที่ชั้นตาราง', true, v_r)
      else pg_temp.nn('G4', 'UPDATE ตรง ผูกโพสต์ tiktok ใบที่ 2 เข้าชิ้น clip ที่มี tiktok active แล้ว "ผ่าน" (กฎ 1 platform ต่อชิ้น 1 โพสต์ อยู่ใน RPC ไม่ใช่ unique index)') end;
    -- G6: ชิ้น produced เกินวันที่มีโพสต์ active ผูกอยู่ (สภาพไม่ปกติ — เขียนตรง) → ธง/เลข "ไม่มีลิงก์" ต้องไม่นับชิ้นนี้
    v_s3 := pg_temp.mkp(v_shop, 'short_clip', 'tiktok', 'produced', -4);
    select post_overdue_no_link into v_n from analytics.v_content_inbox_counts where shop_id = v_shop;
    select flag_no_link_overdue into v_b from analytics.v_content_piece_calendar where step_id = v_s3;
    v_p2 := analytics.content_post_upsert(v_shop, 'tiktok', c_tt || 'g6', c_tt || 'g6', now() - interval '1 hour');
    -- [รอบ 3 · S-M3] ด่านตารางขวางการเขียน step_id ตรงแล้ว — setup สภาพไม่ปกติต้องตั้ง GUC ของ role ภายใน (รันเป็นเจ้าของตาราง ไม่ใช่ service_role)
    perform set_config('c2.piece_rpc', '1', true);
    update analytics.content_post set step_id = v_s3 where id = v_p2;
    perform set_config('c2.piece_rpc', '', true);
    select post_overdue_no_link into v_n2 from analytics.v_content_inbox_counts where shop_id = v_shop;
    select flag_no_link_overdue into v_b2 from analytics.v_content_piece_calendar where step_id = v_s3;
    v_log := v_log || pg_temp.bb('G6', 'produced เกินวัน: ก่อนมีโพสต์ธง=true/นับ · หลังมีโพสต์ active ผูกอยู่ ธงดับ + inbox.post_overdue_no_link ลด 1 (สูตรไม่นับชิ้นที่มีโพสต์ active)', v_b is true and coalesce(v_b2, true) is false and v_n2 = v_n - 1, format('flag %s→%s inbox %s→%s', v_b, v_b2, v_n, v_n2));
  exception when others then
    v_log := v_log || format(E'[FAIL] G ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  ----------------------------------------------------------------------------
  -- P. view = การนับอิสระจากตารางดิบ ณ สถานะปนท้ายไฟล์ (ของจริง 26 + แถวทดสอบทั้งหมดข้างบน)
  ----------------------------------------------------------------------------
  begin
    v_wk := v_today - (extract(isodow from v_today)::int - 1);
    select * into v_in from analytics.v_content_inbox_counts where shop_id = v_shop;
    select count(*) into v_n from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id
     where s.piece_status in ('approved', 'produced') and c.anchor_date is not null and c.anchor_date + s.offset_start_days <= v_today;
    v_log := v_log || pg_temp.bb('P1a', 'inbox.post_today = นับอิสระ (approved/produced ที่ถึงวัน)', v_in.post_today = v_n, v_in.post_today || ' vs ' || v_n);
    select count(*) into v_n from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id
     where s.piece_status = 'produced' and s.piece_kind in ('short_clip', 'live_cut', 'ig_fb_post') and c.anchor_date + s.offset_start_days < v_today
       and not exists (select 1 from analytics.content_post p where p.step_id = s.id and p.status = 'active');
    v_log := v_log || pg_temp.bb('P1b', 'inbox.post_overdue_no_link = นับอิสระ', v_in.post_overdue_no_link = v_n, v_in.post_overdue_no_link || ' vs ' || v_n);
    select count(*) into v_n from analytics.campaign_step s where s.piece_status = 'in_review';
    v_log := v_log || pg_temp.bb('P1c', 'inbox.review_queue = นับอิสระ · review_over_limit = (review_queue > 10)', v_in.review_queue = v_n and v_in.review_over_limit = (v_n > 10), v_in.review_queue || ' vs ' || v_n);
    select count(*) into v_n from analytics.campaign_step s where s.piece_status = 'idea';
    v_log := v_log || pg_temp.bb('P1d', 'inbox.ideas = นับอิสระ', v_in.ideas = v_n, v_in.ideas || ' vs ' || v_n);
    select count(*) into v_n from analytics.step_gate g join analytics.campaign_step s on s.id = g.step_id
     where g.gate_kind = 'risk_owner' and g.status in ('pending', 'blocked') and s.piece_status in ('drafting', 'in_review');
    v_log := v_log || pg_temp.bb('P1e', 'inbox.owner_questions = นับอิสระ', v_in.owner_questions = v_n, v_in.owner_questions || ' vs ' || v_n);
    select count(*) into v_n from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id
     where s.piece_status = 'approved' and s.footage_status = 'needs_shoot' and c.anchor_date + s.offset_start_days between v_wk and v_wk + 6;
    v_log := v_log || pg_temp.bb('P1f', 'inbox.shoot_this_week = นับอิสระ (จันทร์–อาทิตย์ไทย)', v_in.shoot_this_week = v_n, v_in.shoot_this_week || ' vs ' || v_n);
    select count(*) into v_n from analytics.campaign_step s where s.hold_reason is not null and s.piece_status not in ('posted', 'cancelled');
    v_log := v_log || pg_temp.bb('P1g', 'inbox.on_hold = นับอิสระ', v_in.on_hold = v_n, v_in.on_hold || ' vs ' || v_n);

    select * into v_q from analytics.v_line_quota_28d where shop_id = v_shop;
    select count(*) into v_n from analytics.campaign_step s
     where s.piece_kind = 'line_message' and s.piece_status = 'posted'
       and (select (e.created_at at time zone 'Asia/Bangkok')::date from analytics.content_piece_event e where e.step_id = s.id and e.event_kind = 'post' order by e.seq desc limit 1) between v_today - 27 and v_today;
    v_log := v_log || pg_temp.bb('P2a', 'quota.used_28d = นับอิสระจาก event post ล่าสุดของชิ้น LINE ที่ posted (หน้าต่าง [วันนี้−27, วันนี้])', v_q.used_28d = v_n, v_q.used_28d || ' vs ' || v_n);
    select count(*) into v_n from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id
     where s.piece_kind = 'line_message' and s.piece_status in ('planned', 'drafting', 'in_review', 'approved', 'produced') and c.anchor_date + s.offset_start_days between v_today and v_today + 27;
    select count(*) into v_n2 from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id
     where s.piece_kind = 'line_message' and s.piece_status in ('planned', 'drafting', 'in_review', 'approved', 'produced') and c.anchor_date + s.offset_start_days < v_today;
    v_log := v_log || pg_temp.bb('P2b', 'quota.planned_28d / overdue_planned = นับอิสระ · remaining = max(4 − used, 0) · over_quota_planned = (used + planned > 4)',
      v_q.planned_28d = v_n and v_q.overdue_planned = v_n2 and v_q.remaining_28d = greatest(4 - v_q.used_28d, 0) and v_q.over_quota_planned = (v_q.used_28d + v_q.planned_28d > 4),
      format('used=%s planned=%s/%s overdue=%s/%s remaining=%s', v_q.used_28d, v_q.planned_28d, v_n, v_q.overdue_planned, v_n2, v_q.remaining_28d));

    select count(*) into v_n from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id where s.piece_status is not null and s.piece_status <> 'cancelled' and c.anchor_date is not null;
    select count(*) into v_n2 from analytics.v_content_piece_calendar;
    v_log := v_log || pg_temp.bb('P3a', 'calendar แถว = นับอิสระ (มีวัน · ไม่ cancelled)', v_n = v_n2, v_n2 || ' vs ' || v_n);
    select count(*) filter (where flag_needs_shoot), count(*) filter (where flag_on_hold), count(*) filter (where flag_confirm_pending), count(*) filter (where flag_no_link_overdue)
      into v_n, v_n2, v_n3, v_n4 from analytics.v_content_piece_calendar;
    select count(*) filter (where s.footage_status = 'needs_shoot'), count(*) filter (where s.hold_reason is not null)
      into v_a1, v_a2 from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id where s.piece_status is not null and s.piece_status <> 'cancelled' and c.anchor_date is not null;
    v_log := v_log || pg_temp.bb('P3b', 'calendar ธง needs_shoot / on_hold = นับอิสระ · no_link_overdue = inbox.post_overdue_no_link (สูตรเดียวกัน)', v_n = v_a1 and v_n2 = v_a2 and v_n4 = v_in.post_overdue_no_link,
      format('shoot %s/%s hold %s/%s overdue %s/%s', v_n, v_a1, v_n2, v_a2, v_n4, v_in.post_overdue_no_link));

    -- hook library: ต่อ (shop, hook_type) นับ distinct step ที่มีโพสต์ active + T+7 → เทียบ type_n_pieces
    v_bad := '';
    for rr in
      select h.hook_type, count(distinct p.step_id)::int as n
        from analytics.content_hook h
        join analytics.content_post p on p.hook_id = h.id and p.status = 'active'
       where h.origin = 'ours' and h.hook_type is not null and h.shop_id = v_shop
         and exists (select 1 from analytics.content_post_metric m where m.post_id = p.id and m.age_days between 5 and 9)
       group by h.hook_type
    loop
      select coalesce(max(type_n_pieces), -1) into v_n from analytics.v_content_hook_library where shop_id = v_shop and hook_type = rr.hook_type;
      if v_n <> rr.n then v_bad := v_bad || format('%s: view=%s ดิบ=%s; ', rr.hook_type, v_n, rr.n); end if;
    end loop;
    select count(*) into v_n from analytics.v_content_hook_library where type_n_pieces > 0 and hook_type not in (
      select h.hook_type from analytics.content_hook h join analytics.content_post p on p.hook_id = h.id and p.status = 'active' where h.origin = 'ours' and h.hook_type is not null);
    v_log := v_log || pg_temp.bb('P4a', 'คลัง hook: type_n_pieces ต่อประเภท = นับ distinct step อิสระ (โพสต์ active + มี T+7) · ไม่มีประเภทที่ไม่มีโพสต์แต่ n>0', v_bad = '' and v_n = 0, coalesce(nullif(v_bad, ''), 'ตรงทุกประเภท'));
    select count(*) into v_n from analytics.v_content_hook_library l
     where l.side = 'ours' and l.posts_n is distinct from (select count(*) from analytics.content_post p where p.hook_id = l.hook_id and p.status = 'active');
    select count(*) into v_n2 from analytics.v_content_hook_library l join analytics.content_hook h on h.id = l.hook_id where l.shop_id <> h.shop_id or l.side <> h.origin;
    select count(*) into v_n3 from analytics.content_hook;
    select count(*) into v_n4 from analytics.v_content_hook_library;
    v_log := v_log || pg_temp.bb('P4b', 'คลัง hook: posts_n ต่อ hook = นับอิสระ · shop/side ตรง hook ต้นทาง · แถว view = จำนวน hook ทั้งตาราง (ไม่ซ้ำ/ไม่หาย แม้ hook หลายประเภท/หลายโพสต์)', v_n = 0 and v_n2 = 0 and v_n3 = v_n4, format('posts_n ผิด %s · shop/side ผิด %s · hook=%s view=%s', v_n, v_n2, v_n3, v_n4));
  exception when others then
    v_log := v_log || format(E'[FAIL] P ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  exception when others then
    v_log := v_log || format(E'[FAIL] ABORT ส่วน 2 sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  v_log := v_log || E'[SKIP] การชนกันจริง 2 connection (post/link/unlink/defer พร้อมกัน — ลำดับล็อก step→post) = ต้อง apply แล้วยิง 2 connection ด้วย id เจาะจงแล้วเก็บกวาด · dry-run ทำไม่ได้\n';
  v_log := v_log || E'[SKIP] เวลาคร่อม 00:00–07:00 ไทย (UTC ต่างวัน) ของ inbox/quota/calendar = ตรวจเฉพาะ static + ทดสอบด้วยวันที่ ณ เวลาที่รัน\n';
  v_log := v_log || E'[SKIP] หน้าเว็บ (ปฏิทิน/คลัง hook/inbox/กดวางลิงก์) = ยังไม่มี UI ใน commit นี้ — smoke หลัง apply\n';

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_ok   := (length(v_log) - length(replace(v_log, '[OK]', ''))) / 4;
  v_note := (length(v_log) - length(replace(v_log, '[NOTE]', ''))) / 6;
  v_log := v_log || format(E'\n=== สรุป: [OK] %s · [FAIL] %s · [NOTE] %s — raise ด้านล่างบังคับ ROLLBACK ทั้งหมด ===\n', v_ok, v_fail, v_note);
  raise exception '%', v_log;
end
$qa0160b$;
