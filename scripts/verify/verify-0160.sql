-- scripts/verify/verify-0160.sql
-- ตรวจ supabase/migrations/0160_content_piece_post_views.sql หลัง apply (หรือต่อท้าย 0159 + 0160 ใน dry-run เดียวกัน)
-- self-rolling-back do-block ตาม 3j-migration-traps #11: ทุกเคสเก็บผลลง v_log แล้ว raise exception ปิดท้ายเสมอ ⇒ ทั้งทรานแซกชัน
-- rollback · ผลทดสอบออกทาง error message · DB ไม่ขยับ ไม่ว่า PASS หรือ FAIL (ยิงใส่ข้อมูลจริงบน prod ได้ — แต่ rollback หมด)
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0160.sql
-- dry-run ก่อน apply: ต่อ 0159 + 0160 + ไฟล์นี้เป็นไฟล์ชั่วคราวแล้วรันแบบไม่ใส่ --commit
--   (cat supabase/migrations/0159_*.sql supabase/migrations/0160_*.sql scripts/verify/verify-0160.sql > tmp.sql)
-- ผล: run-sql พิมพ์ "🔴 ล้มเหลว" พร้อม message = v_log (ช่องทางรายงานผลปกติ) · [FAIL] ≥ 1 = ไม่ผ่าน · [SKIP] = พิสูจน์ไม่ได้ในไฟล์นี้
--
-- ⚠️ ก่อน/หลังรันตรวจด้วยมือ (trap #11): count(*) ของ content_post / content_hook / content_piece_event / campaign_step ต้องเท่ากันทั้งก่อนและหลัง
--
-- ============ ตารางแมป "เคสในสเปก → assertion" (id ใน log) ============
--  X31 content_piece_post: actor ai/system · kind line/story · platform ผิดชนิด · hook step อื่น · hook reference · hook+other พร้อมกัน ·
--      posted_at อนาคต · โพสต์ผูกชิ้นอื่น  → X31a-X31w (ชุดปฏิเสธ + นับแถวก่อน/หลังเท่าเดิม) + X31x (hook อื่นถูกสร้างแล้วล้มกลางทาง → hook ถอยหมด · GUC ไม่ค้าง)
--  X32 link: โพสต์ deleted · step in_review · unlink ไม่มี reason → X32a-X32j
--  X33 defer: idea/posted/cancelled/ai/ไม่มีเหตุผล/วันเท่าเดิม → X33a-X33i (ข้อ "ห้ามกลายเป็น 500 เงียบ": idea ได้ 55000 ข้อความไทย ไม่ใช่ P0001 ดิบ)
--  K13 flow LINE: ไม่สร้าง content_post · used_28d +1 · effective posted ถาวร → K13a-K13f (+ ขอบหน้าต่าง 27/28 วัน · overdue · over_quota)
--  K14 ig_fb_post 2 แพลตฟอร์ม: facebook แล้ว instagram · posts ใน view 2 · event additional → K14a-K14g
--  K18 idea (anchor null): v_campaign_board 1 แถว · v_content_piece 1 แถว · v_content_piece_calendar 0 แถว → K18a-K18c
--  K12(z) post → posted → set_status deleted → unlink → produced → K12z
--  ต้องไม่พัง: content_post_upsert ตรง (คิววางลิงก์เดิม) ยังทำงาน · คิวยอดเห็นโพสต์นอกแผน → KQ1-KQ3 · posted_on · effective 'measuring' → B3
--  ชุดอื่น: A (โครงสร้าง/สิทธิ์/overload/วันไทย/ไม่มีชื่อโฮสต์) · L (link/unlink) · D (defer) · V (view) · H (hook library + กฎ 4 ชิ้น) · X37 (authenticated)
--
-- ถ้ามีร้านมากกว่า 1 ร้านใน public.shop ไฟล์นี้หยุด · ร้านเพิ่ม (B/C/D) สร้างเองในทรานแซกชัน

-- ---------- helper (temp function — หายพร้อมทรานแซกชัน) ----------

create or replace function pg_temp.vx(p_sql text, p_expect text[], p_like text default null) returns text
 language plpgsql as $vx$
declare
  v_state text; v_msg text;
begin
  execute p_sql;
  return 'FAIL ผ่านทั้งที่ควรปฏิเสธ';
exception when others then
  get stacked diagnostics v_msg = message_text;
  v_state := sqlstate;
  if v_state = any (p_expect) then
    if p_like is not null and position(p_like in v_msg) = 0 then
      return 'FAIL sqlstate ถูก (' || v_state || ') แต่ข้อความไม่มี "' || p_like || '" → ' || left(v_msg, 200);
    end if;
    return 'OK ' || v_state || ' msg=' || left(v_msg, 90);
  end if;
  return 'FAIL sqlstate=' || v_state || ' msg=' || left(v_msg, 160);
end $vx$;

create or replace function pg_temp.vok(p_sql text) returns text
 language plpgsql as $vk$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return 'FAIL ควรสำเร็จแต่ตก sqlstate=' || sqlstate || ' msg=' || left(sqlerrm, 200);
end $vk$;

create or replace function pg_temp.vl(p_id text, p_what text, p_res text) returns text
 language sql as $vl$
  select '[' || case when p_res like 'OK%' and p_res not like '%FAIL%' then 'OK' else 'FAIL' end || '] ' || p_id || ' ' || p_what || ' → ' || p_res || E'\n'
$vl$;

create or replace function pg_temp.vb(p_id text, p_what text, p_cond boolean, p_detail text default '') returns text
 language sql as $vb$
  select '[' || case when p_cond is true then 'OK' else 'FAIL' end || '] ' || p_id || ' ' || p_what
         || case when p_detail <> '' then ' → ' || p_detail else '' end || E'\n'
$vb$;

-- สร้างชิ้นงานทดสอบผ่าน RPC จริง (create → drafting → [hook A/B + เนื้อหา] → in_review) — ลอกจาก verify-0159
create or replace function pg_temp.mk_step(p_shop uuid, p_kind text, p_channel text, p_stage text default 'in_review') returns uuid
 language plpgsql as $mk$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_s     uuid;
  v_a     uuid;
begin
  v_s := analytics.content_piece_create(p_shop, 'verify-0160 ' || substr(gen_random_uuid()::text, 1, 8), p_kind, p_channel,
                                        'jewelry_925', 'owner', v_today + 5);
  if p_stage = 'planned' then
    return v_s;
  end if;
  perform analytics.content_piece_advance(p_shop, v_s, 'drafting', 'owner');
  select a.id into v_a from analytics.step_artifact a where a.step_id = v_s;
  if p_kind in ('short_clip', 'live_cut') then
    perform analytics.content_hook_upsert(p_shop, v_s, 'A', 'verify hook A', 'question', null, 'owner', null);
    perform analytics.content_hook_upsert(p_shop, v_s, 'B', 'verify hook B', 'fact', null, 'owner', null);
    perform analytics.campaign_set_artifact_content(v_a, 'verify body',
      jsonb_build_object('segments', jsonb_build_array(jsonb_build_object('role', 'hook')),
                         'shots', jsonb_build_array(jsonb_build_object('id', 's1', 'desc', 'ถ่ายหน้าโต๊ะ'),
                                                    jsonb_build_object('id', 's2', 'desc', 'ใกล้ๆ'))));
  else
    perform analytics.campaign_set_artifact_content(v_a, 'verify body', null);
  end if;
  perform analytics.content_piece_advance(p_shop, v_s, 'in_review', 'owner');
  return v_s;
end $mk$;

create or replace function pg_temp.approve_ready(p_shop uuid, p_step uuid) returns void
 language plpgsql as $ar$
begin
  perform analytics.content_gate_record(p_shop, p_step, 'fact_check', 'passed', 'owner',
    jsonb_build_object('sources', jsonb_build_array('https://example.com/a')));
  perform analytics.content_gate_record(p_shop, p_step, 'brand_rule', 'passed', 'owner');
  perform analytics.content_gate_record(p_shop, p_step, 'risk_owner', 'passed', 'owner');
end $ar$;

-- approved (p_stage='approved') / produced (+advance produced)
create or replace function pg_temp.mk_ready(p_shop uuid, p_kind text, p_channel text, p_stage text default 'produced') returns uuid
 language plpgsql as $ma$
declare v_s uuid;
begin
  v_s := pg_temp.mk_step(p_shop, p_kind, p_channel);
  perform pg_temp.approve_ready(p_shop, v_s);
  perform analytics.content_piece_advance(p_shop, v_s, 'approved', 'owner', null, 45);
  if p_stage = 'produced' then
    perform analytics.content_piece_advance(p_shop, v_s, 'produced', 'owner');
  end if;
  return v_s;
end $ma$;

create or replace function pg_temp.st(p_step uuid) returns text
 language sql as $st$
  select piece_status || '/' || status || coalesce('/hold=' || hold_reason, '') from analytics.campaign_step where id = p_step
$st$;

create or replace function pg_temp.hook_a(p_step uuid) returns uuid
 language sql as $ha$
  select id from analytics.content_hook where step_id = p_step and label = 'A'
$ha$;

create or replace function pg_temp.ext() returns text
 language sql as $ex$ select 'v160-' || substr(gen_random_uuid()::text, 1, 12) $ex$;

create or replace function pg_temp.url(p_ext text default null) returns text
 language sql as $ur$ select 'https://www.tiktok.com/@verify160/video/' || coalesce(p_ext, substr(gen_random_uuid()::text, 1, 12)) $ur$;

-- สร้าง SQL สั้นๆ สำหรับ vx/vok · p_hook/p_ot/p_oty ใส่ null ได้
create or replace function pg_temp.q_post(p_shop uuid, p_step uuid, p_platform text, p_ext text, p_url text, p_at timestamptz, p_role text,
                                          p_hook uuid default null, p_ot text default null, p_oty text default null) returns text
 language sql as $q$
  select format('select analytics.content_piece_post(%L::uuid,%L::uuid,%L,%L,%L,%L::timestamptz,%L,%L::uuid,%L,%L,null)',
                p_shop, p_step, p_platform, p_ext, p_url, p_at, p_role, p_hook, p_ot, p_oty)
$q$;

create or replace function pg_temp.q_link(p_shop uuid, p_post uuid, p_step uuid, p_role text, p_hook uuid default null) returns text
 language sql as $q$
  select format('select analytics.content_post_link_step(%L::uuid,%L::uuid,%L::uuid,%L,%L::uuid)', p_shop, p_post, p_step, p_role, p_hook)
$q$;

create or replace function pg_temp.q_unlink(p_shop uuid, p_post uuid, p_reason text, p_role text) returns text
 language sql as $q$
  select format('select analytics.content_post_unlink_step(%L::uuid,%L::uuid,%L,%L)', p_shop, p_post, p_reason, p_role)
$q$;

create or replace function pg_temp.q_defer(p_shop uuid, p_step uuid, p_date date, p_reason text, p_role text, p_time time default null) returns text
 language sql as $q$
  select format('select analytics.content_piece_defer(%L::uuid,%L::uuid,%L::date,%L,%L,%L::time)', p_shop, p_step, p_date, p_reason, p_role, p_time)
$q$;

create or replace function pg_temp.q_adv(p_shop uuid, p_step uuid, p_to text, p_role text, p_reason text default null, p_secs int default null)
 returns text language sql as $q$
  select format('select analytics.content_piece_advance(%L::uuid,%L::uuid,%L,%L,%L,%L::int)', p_shop, p_step, p_to, p_role, p_reason, p_secs)
$q$;

-- ภาพรวมแถวที่ต้องไม่ขยับเมื่อ RPC ปฏิเสธ (โพสต์ · hook · event · step)
create or replace function pg_temp.snap() returns text
 language sql as $sn$
  select (select count(*) || ':' || md5(coalesce(string_agg(concat_ws('|', id, step_id, hook_id, post_url, posted_at, status, artifact_id), ',' order by id), '')) from analytics.content_post)
      || '/' || (select count(*) || ':' || md5(coalesce(string_agg(concat_ws('|', id, text, step_id, label), ',' order by id), '')) from analytics.content_hook)
      || '/' || (select count(*) from analytics.content_piece_event)
      || '/' || (select md5(coalesce(string_agg(concat_ws('|', id, piece_status, status), ',' order by id), '')) from analytics.campaign_step)
$sn$;

do $verify0160$
declare
  v_log     text := E'\n=== verify-0160 ===\n';
  v_today   date := (now() at time zone 'Asia/Bangkok')::date;
  v_shop    uuid;
  v_shopB   uuid;
  v_shopC   uuid;
  v_shopD   uuid;
  v_n       bigint;
  v_n2      bigint;
  v_r       text;
  v_txt     text;
  v_bad     text;
  v_j       jsonb;
  v_b       boolean;
  v_snap    text;
  v_snap2   text;
  v_p1      uuid;   -- ชิ้น produced (short_clip) หลัก
  v_p2      uuid;
  v_p3      uuid;
  v_p4      uuid;
  v_p5      uuid;
  v_p6      uuid;
  v_p7      uuid;
  v_ig      uuid;
  v_line    uuid;
  v_story   uuid;
  v_plan    uuid;
  v_inrev   uuid;
  v_canc    uuid;
  v_hold    uuid;
  v_idea    uuid;
  v_post1   uuid;
  v_post2   uuid;
  v_post3   uuid;
  v_ext1    text;
  v_hookA   uuid;
  v_hookB   uuid;
  v_hookO   uuid;
  v_hookX   uuid;
  v_ref_sig uuid;
  v_ref_h   uuid;
  v_host    uuid;
  v_art     uuid;
  v_id      uuid;
  v_id2     uuid;
  v_camp    uuid;
  v_d1      date;
  v_d2      date;
  r         record;
  v_fail    int;
  v_ok      int;
begin
  begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);

  select count(*) into v_n from public.shop;
  if v_n <> 1 then
    raise exception 'verify-0160: ต้องมีร้านเดียวใน public.shop (พบ %) — ทดสอบไม่ได้', v_n;
  end if;
  select id into v_shop from public.shop;
  insert into public.shop (name) values ('verify-0160 shop B') returning id into v_shopB;
  insert into public.shop (name) values ('verify-0160 shop C') returning id into v_shopC;

  ----------------------------------------------------------------------------
  -- A. โครงสร้าง / สิทธิ์ / overload / วันไทย / ไม่มีชื่อโฮสต์
  ----------------------------------------------------------------------------
  v_log := v_log || pg_temp.vb('A1', 'ฟังก์ชันของ 0160 มี 6 ตัว signature เดียวต่อชื่อ (trap #1)',
    (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace
        and proname ~ '^(content_piece_post$|content_piece_defer$|content_post_link_step$|content_post_unlink_step$|content_post_platform_ok_$|content_post_hook_check_$)') = 6
    and (select count(distinct proname) from pg_proc where pronamespace = 'analytics'::regnamespace
        and proname ~ '^(content_piece_post$|content_piece_defer$|content_post_link_step$|content_post_unlink_step$|content_post_platform_ok_$|content_post_hook_check_$)') = 6);
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.pronamespace = 'analytics'::regnamespace
     and p.proname ~ '^(content_piece_post$|content_piece_defer$|content_post_link_step$|content_post_unlink_step$|content_post_platform_ok_$|content_post_hook_check_$)'
     and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  v_log := v_log || pg_temp.vb('A2', 'ไม่มี PUBLIC/anon/authenticated ถือ EXECUTE บนฟังก์ชันของ 0160', v_bad is null, coalesce(v_bad, ''));
  v_log := v_log || pg_temp.vb('A2b', 'service_role มี EXECUTE ครบ 6 ตัว',
    (select bool_and(has_function_privilege('service_role', p.oid, 'execute')) from pg_proc p
      where p.pronamespace = 'analytics'::regnamespace
        and p.proname ~ '^(content_piece_post$|content_piece_defer$|content_post_link_step$|content_post_unlink_step$|content_post_platform_ok_$|content_post_hook_check_$)'));
  select string_agg(c.relname || ':' || case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ', ') into v_bad
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.relnamespace = 'analytics'::regnamespace
     and c.relname in ('v_content_piece_calendar', 'v_content_inbox_counts', 'v_line_quota_28d', 'v_content_hook_library')
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  v_log := v_log || pg_temp.vb('A3', 'ไม่มี PUBLIC/anon/authenticated ถือสิทธิ์บน view ใหม่ 4 ตัว', v_bad is null, coalesce(v_bad, ''));
  v_log := v_log || pg_temp.vb('A3b', 'view ใหม่ทั้ง 4 เป็น security_invoker · service_role select ได้',
    (select count(*) from pg_class c where c.relnamespace = 'analytics'::regnamespace and c.relkind = 'v'
        and c.relname in ('v_content_piece_calendar', 'v_content_inbox_counts', 'v_line_quota_28d', 'v_content_hook_library')
        and c.reloptions @> array['security_invoker=true']) = 4
    and has_table_privilege('service_role', 'analytics.v_content_piece_calendar', 'select')
    and has_table_privilege('service_role', 'analytics.v_content_inbox_counts', 'select')
    and has_table_privilege('service_role', 'analytics.v_line_quota_28d', 'select')
    and has_table_privilege('service_role', 'analytics.v_content_hook_library', 'select'));
  v_log := v_log || pg_temp.vb('K21', 'view ใหม่ใช้วันไทย: มี Asia/Bangkok ไม่มี current_date (trap #6) · ฟังก์ชันใหม่ไม่มี current_date',
    (select bool_and(pg_get_viewdef(c.oid) !~* 'current_date') from pg_class c where c.relnamespace = 'analytics'::regnamespace
        and c.relname in ('v_content_piece_calendar', 'v_content_inbox_counts', 'v_line_quota_28d', 'v_content_hook_library'))
    and pg_get_viewdef('analytics.v_content_inbox_counts'::regclass) ~ 'Asia/Bangkok'
    and pg_get_viewdef('analytics.v_line_quota_28d'::regclass) ~ 'Asia/Bangkok'
    and pg_get_viewdef('analytics.v_content_piece_calendar'::regclass) ~ 'Asia/Bangkok'
    and (select bool_and(pg_get_functiondef(p.oid) !~* 'current_date') from pg_proc p where p.pronamespace = 'analytics'::regnamespace
        and p.proname ~ '^(content_piece_post$|content_piece_defer$|content_post_link_step$|content_post_unlink_step$)'));
  select string_agg(c.relname || '.' || a.attname, ', ') into v_bad
    from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
   where c.relnamespace = 'analytics'::regnamespace
     and c.relname in ('v_content_piece_calendar', 'v_content_inbox_counts', 'v_line_quota_28d', 'v_content_hook_library')
     and (a.attname in ('display_name', 'account', 'host_name') or a.attname ilike '%display_name%');
  v_log := v_log || pg_temp.vb('A4', 'ไม่มีคอลัมน์ชื่อจริงโฮสต์/ชื่อบัญชี (display_name · account) ในทั้ง 4 view', v_bad is null, coalesce(v_bad, ''));
  v_log := v_log || pg_temp.vb('A5', 'ไม่มี display_name ใน definition ของทั้ง 4 view (ไม่ join live_host.display_name)',
    (select bool_and(pg_get_viewdef(c.oid) !~* 'display_name') from pg_class c where c.relnamespace = 'analytics'::regnamespace
        and c.relname in ('v_content_piece_calendar', 'v_content_inbox_counts', 'v_line_quota_28d', 'v_content_hook_library')));
  v_log := v_log || pg_temp.vb('A6', 'helper kind↔platform: short_clip/live_cut → tiktok · ig_fb_post → facebook/instagram · line/story/null → ไม่ผ่านเสมอ',
    analytics.content_post_platform_ok_('short_clip', 'tiktok') and analytics.content_post_platform_ok_('live_cut', 'tiktok')
    and analytics.content_post_platform_ok_('ig_fb_post', 'facebook') and analytics.content_post_platform_ok_('ig_fb_post', 'instagram')
    and not analytics.content_post_platform_ok_('short_clip', 'facebook') and not analytics.content_post_platform_ok_('ig_fb_post', 'tiktok')
    and not analytics.content_post_platform_ok_('line_message', 'line_oa') and not analytics.content_post_platform_ok_('story', 'instagram')
    and not analytics.content_post_platform_ok_(null, 'tiktok') and not analytics.content_post_platform_ok_('short_clip', null));

  ----------------------------------------------------------------------------
  -- B. content_piece_post — ชุดปฏิเสธ (X31) · ต้องไม่ทิ้งอะไรไว้เลย (นับก่อน/หลัง)
  ----------------------------------------------------------------------------
  begin
    v_p1 := pg_temp.mk_ready(v_shop, 'short_clip', 'tiktok');                       -- produced
    v_p2 := pg_temp.mk_ready(v_shop, 'short_clip', 'tiktok');                       -- produced (hook ของ step อื่น)
    v_ig := pg_temp.mk_ready(v_shop, 'ig_fb_post', 'facebook');
    v_line := pg_temp.mk_ready(v_shop, 'line_message', 'line_oa', 'approved');
    v_story := pg_temp.mk_ready(v_shop, 'story', 'instagram', 'approved');
    v_plan := pg_temp.mk_step(v_shop, 'ig_fb_post', 'facebook', 'planned');
    v_inrev := pg_temp.mk_step(v_shop, 'ig_fb_post', 'facebook');
    v_canc := pg_temp.mk_step(v_shop, 'ig_fb_post', 'facebook');
    perform analytics.content_piece_advance(v_shop, v_canc, 'cancelled', 'owner', 'ยกเลิก X31');
    v_hold := pg_temp.mk_ready(v_shop, 'short_clip', 'tiktok');
    perform analytics.content_piece_advance(v_shop, v_hold, 'hold', 'owner', 'พัก X31');
    v_idea := analytics.content_piece_create(v_shop, 'verify-0160 idea', 'short_clip', 'tiktok', 'jewelry_925', 'owner');
    v_hookA := pg_temp.hook_a(v_p1);
    v_hookB := pg_temp.hook_a(v_p2);
    v_ref_sig := analytics.content_signal_capture(v_shop, 'reference_clip', 'verify-0160 คลิปอ้างอิง', 'owner',
                   p_url => 'https://www.tiktok.com/@ref160/video/1600001', p_hook_text => 'hook ของเขา X31', p_hook_type => 'question', p_platform => 'tiktok');
    select h.id into v_ref_h from analytics.content_hook h where h.source_signal_id = v_ref_sig and h.origin = 'reference';
    v_p3 := pg_temp.mk_ready(v_shop, 'short_clip', 'tiktok', 'approved');             -- approved + ยังไม่ยืนยันภาพ (ใช้ X31t)
    v_snap := pg_temp.snap();
    v_r := ''
      || pg_temp.vl('X31a', 'actor ai → 42501', pg_temp.vx(pg_temp.q_post(v_shop, v_p1, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', 'ai'), array['42501'], 'ไม่มีสิทธิ์'))
      || pg_temp.vl('X31b', 'actor system → 42501', pg_temp.vx(pg_temp.q_post(v_shop, v_p1, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', 'system'), array['42501'], 'ไม่มีสิทธิ์'))
      || pg_temp.vl('X31c', 'ชิ้น line_message (approved) → 55000 บอกทางไป advance', pg_temp.vx(pg_temp.q_post(v_shop, v_line, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', 'owner'), array['55000'], 'ไม่มีลิงก์โพสต์'))
      || pg_temp.vl('X31d', 'ชิ้น story (approved) → 55000', pg_temp.vx(pg_temp.q_post(v_shop, v_story, 'instagram', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', 'owner'), array['55000'], 'ไม่มีลิงก์โพสต์'))
      || pg_temp.vl('X31e', 'platform tiktok บน ig_fb_post → 22023', pg_temp.vx(pg_temp.q_post(v_shop, v_ig, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', 'owner'), array['22023'], 'โพสต์บน'))
      || pg_temp.vl('X31f', 'platform facebook บน short_clip → 22023', pg_temp.vx(pg_temp.q_post(v_shop, v_p1, 'facebook', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', 'owner'), array['22023'], 'โพสต์บน'))
      || pg_temp.vl('X31g', 'platform line_oa / banana → 22023', pg_temp.vx(pg_temp.q_post(v_shop, v_p1, 'line_oa', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', 'owner'), array['22023'], 'platform ต้องเป็น')
                                                              || pg_temp.vx(pg_temp.q_post(v_shop, v_p1, 'banana', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', 'owner'), array['22023'], 'platform ต้องเป็น'))
      || pg_temp.vl('X31h', 'p_hook_id = hook ของ step อื่น → 22023', pg_temp.vx(pg_temp.q_post(v_shop, v_p1, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', 'owner', v_hookB), array['22023'], 'ไม่ใช่ของชิ้นงานนี้'))
      || pg_temp.vl('X31i', 'p_hook_id = hook origin reference (จาก capture จริง) → 22023', pg_temp.vx(pg_temp.q_post(v_shop, v_p1, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', 'owner', v_ref_h), array['22023'], 'hook ของเขา'))
      || pg_temp.vl('X31j', 'ส่ง hook_id + other_text พร้อมกัน → 22023', pg_temp.vx(pg_temp.q_post(v_shop, v_p1, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', 'owner', v_hookA, 'อื่นๆ', 'story'), array['22023'], 'อย่างใดอย่างหนึ่ง'))
      || pg_temp.vl('X31k', 'other_text ไม่มีประเภท · ประเภทไม่มีข้อความ · ข้อความ ZWSP ล้วน → 22023', pg_temp.vx(pg_temp.q_post(v_shop, v_p1, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', 'owner', null, 'อื่นๆ', null), array['22023'], 'ทั้งข้อความและประเภท')
                                                              || pg_temp.vx(pg_temp.q_post(v_shop, v_p1, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', 'owner', null, null, 'story'), array['22023'], 'ทั้งข้อความและประเภท')
                                                              || pg_temp.vx(pg_temp.q_post(v_shop, v_p1, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', 'owner', null, E'​', 'story'), array['22023'], 'ยาว 1-500'))
      || pg_temp.vl('X31l', 'other_text มี [ต้องยืนยัน → 22023 (ไม่ให้ marker เล็ดลอดเข้าชิ้นที่ posted)', pg_temp.vx(pg_temp.q_post(v_shop, v_p1, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', 'owner', null, 'ลองดู [ต้องยืนยัน: ราคา]', 'story'), array['22023'], 'ต้องยืนยัน'))
      || pg_temp.vl('X31m', 'p_posted_at อนาคต → 22023 (ตกที่ content_post_upsert เดิม)', pg_temp.vx(pg_temp.q_post(v_shop, v_p1, 'tiktok', pg_temp.ext(), pg_temp.url(), now() + interval '2 days', 'owner'), array['22023'], 'อนาคต'))
      || pg_temp.vl('X31n', 'p_posted_at null · external_id ว่าง · ลิงก์ว่าง → 22023', pg_temp.vx(format('select analytics.content_piece_post(%L::uuid,%L::uuid,''tiktok'',%L,%L,null,''owner'')', v_shop, v_p1, pg_temp.ext(), pg_temp.url()), array['22023'], 'ต้องระบุ')
                                                              || pg_temp.vx(pg_temp.q_post(v_shop, v_p1, 'tiktok', '   ', pg_temp.url(), now() - interval '1 hour', 'owner'), array['22023'], 'ต้องระบุ')
                                                              || pg_temp.vx(pg_temp.q_post(v_shop, v_p1, 'tiktok', pg_temp.ext(), '', now() - interval '1 hour', 'owner'), array['22023'], 'ต้องระบุ'))
      || pg_temp.vl('X31o', 'ลิงก์ javascript: / มี user@ / ยาวเกิน 500 → 22023', pg_temp.vx(pg_temp.q_post(v_shop, v_p1, 'tiktok', pg_temp.ext(), 'javascript:alert(1)', now() - interval '1 hour', 'owner'), array['22023'], 'ลิงก์โพสต์ไม่ถูกต้อง')
                                                              || pg_temp.vx(pg_temp.q_post(v_shop, v_p1, 'tiktok', pg_temp.ext(), 'https://good.com@evil.com/x', now() - interval '1 hour', 'owner'), array['22023'], 'ลิงก์โพสต์ไม่ถูกต้อง')
                                                              || pg_temp.vx(pg_temp.q_post(v_shop, v_p1, 'tiktok', pg_temp.ext(), 'https://x.com/' || repeat('a', 600), now() - interval '1 hour', 'owner'), array['22023'], 'ลิงก์โพสต์ไม่ถูกต้อง'))
      || pg_temp.vl('X31p', 'ชิ้น in_review / planned / cancelled / idea → 55000 (ยังไม่อนุมัติ)', pg_temp.vx(pg_temp.q_post(v_shop, v_inrev, 'facebook', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', 'owner'), array['55000'], 'อนุมัติแล้ว')
                                                              || pg_temp.vx(pg_temp.q_post(v_shop, v_plan, 'facebook', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', 'owner'), array['55000'], 'อนุมัติแล้ว')
                                                              || pg_temp.vx(pg_temp.q_post(v_shop, v_canc, 'facebook', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', 'owner'), array['55000'], 'อนุมัติแล้ว')
                                                              || pg_temp.vx(pg_temp.q_post(v_shop, v_idea, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', 'owner'), array['55000'], 'อนุมัติแล้ว'))
      || pg_temp.vl('X31q', 'ชิ้นที่ hold อยู่ → 55000 บอกให้ resume', pg_temp.vx(pg_temp.q_post(v_shop, v_hold, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', 'owner'), array['55000'], 'resume'))
      || pg_temp.vl('X31r', 'step ต่างร้าน (p_shop_id = ร้าน B) · step ไม่มี · null ทุกตัว → 22023', pg_temp.vx(pg_temp.q_post(v_shopB, v_p1, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', 'owner'), array['22023'], 'ไม่พบชิ้นงาน')
                                                              || pg_temp.vx(pg_temp.q_post(v_shop, gen_random_uuid(), 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', 'owner'), array['22023'], 'ไม่พบชิ้นงาน')
                                                              || pg_temp.vx('select analytics.content_piece_post(null,null,null,null,null,null,''owner'')', array['22023'], 'ต้องระบุ'))
      || pg_temp.vl('X31s', 'actor_role null / banana → 22023', pg_temp.vx(pg_temp.q_post(v_shop, v_p1, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', null), array['22023'], 'actor_role')
                                                              || pg_temp.vx(pg_temp.q_post(v_shop, v_p1, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', 'banana'), array['22023'], 'actor_role'));
    -- ชิ้น approved ที่ยังไม่มีภาพ (คลิป footage null) → ข้าม produced ไม่ได้ · สร้าง hook อื่นแล้วล้มกลางทาง → hook ต้องถอยหมด (X31x)
    v_r := v_r || pg_temp.vl('X31t', 'approved + คลิปยังไม่ยืนยันว่ามีภาพ (ข้าม produced) พร้อม hook อื่น → 55000 · hook อื่นที่สร้างกลางทางต้องถอยหมด',
      pg_temp.vx(pg_temp.q_post(v_shop, v_p3, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', 'owner', null, 'hook อื่น X31t', 'story'), array['55000'], 'ยังไม่ยืนยันว่ามีภาพ'));
    v_log := v_log || v_r;
    v_log := v_log || pg_temp.vb('X31u', 'หลังชุดปฏิเสธ X31a-t ทั้งหมด (รวม hook อื่นที่ถูกสร้างแล้วล้มกลางทาง) แถวโพสต์/hook/event/step เท่าเดิมเป๊ะ — นับด้วย md5 ทั้งแถว',
      v_snap = pg_temp.snap(), 'ก่อน=' || left(v_snap, 40) || ' หลัง=' || left(pg_temp.snap(), 40));
    v_log := v_log || pg_temp.vb('X31x', 'GUC c2.piece_rpc ไม่ค้าง (ว่างหลัง RPC ล้มกลางทางหลังเปิด GUC สร้าง hook อื่น) — เคส service_role+GUC เอง = B6b',
      coalesce(current_setting('c2.piece_rpc', true), '') <> '1', coalesce(current_setting('c2.piece_rpc', true), '(null)'));
  exception when others then
    v_log := v_log || format(E'[FAIL] B-reject ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  ----------------------------------------------------------------------------
  -- B (ต่อ). content_piece_post — ทางสำเร็จ: hook เดิม · hook อื่น · ไม่เลือก hook (Q6) · ข้าม produced · โพสต์เดิมนอกแผน
  ----------------------------------------------------------------------------
  begin
    v_ext1 := pg_temp.ext();
    v_hookA := pg_temp.hook_a(v_p1);
    v_j := analytics.content_piece_post(v_shop, v_p1, 'tiktok', v_ext1, pg_temp.url(v_ext1), now() - interval '1 day', 'owner', v_hookA);
    v_post1 := (v_j ->> 'post_id')::uuid;
    v_log := v_log || pg_temp.vb('B1', 'produced short_clip + hook A → posted · ค่าที่คืน {post_id, step_id, piece_status=posted, additional=false}',
      v_j ->> 'piece_status' = 'posted' and (v_j ->> 'step_id')::uuid = v_p1 and (v_j ->> 'additional')::boolean is false and v_post1 is not null, v_j::text);
    v_log := v_log || pg_temp.vb('B2', 'แถว content_post: step_id · hook_id = hook A · artifact_id = เอกสารของชิ้น · status active · platform/external_id ตรง',
      (select cp.step_id = v_p1 and cp.hook_id = v_hookA and cp.status = 'active' and cp.platform = 'tiktok' and cp.external_id = v_ext1
              and cp.artifact_id = (select a.id from analytics.step_artifact a where a.step_id = v_p1)
         from analytics.content_post cp where cp.id = v_post1));
    v_log := v_log || pg_temp.vb('B3', 'projection posted/done · artifact done · event post 1 แถว (from produced → posted · payload.post_id) · effective = measuring (โพสต์เมื่อวาน) · posted_on = เมื่อวานไทย',
      pg_temp.st(v_p1) = 'posted/done'
      and (select string_agg(status, ',') from analytics.step_artifact where step_id = v_p1) = 'done'
      and (select count(*) from analytics.content_piece_event e where e.step_id = v_p1 and e.event_kind = 'post' and e.from_status = 'produced'
             and e.to_status = 'posted' and (e.payload ->> 'post_id')::uuid = v_post1) = 1
      and (select effective_piece_status = 'measuring' and posted_on = v_today - 1 and jsonb_array_length(posts) = 1 from analytics.v_content_piece where step_id = v_p1),
      pg_temp.st(v_p1));
    -- Q6: ไม่เลือก hook เลย → ผ่าน · hook_id null
    v_p4 := pg_temp.mk_ready(v_shop, 'short_clip', 'tiktok');
    v_j := analytics.content_piece_post(v_shop, v_p4, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '2 hours', 'owner');
    v_log := v_log || pg_temp.vb('B4', 'Q6: ไม่ส่ง hook เลย → posted ได้ · hook_id = null (ไม่บังคับที่ DB)',
      pg_temp.st(v_p4) = 'posted/done' and (select hook_id is null and step_id = v_p4 from analytics.content_post where id = (v_j ->> 'post_id')::uuid));
    -- hook อื่น บนชิ้น produced: สร้าง ours label null (ผ่าน guard ด้วย GUC เฉพาะรอบ) · ผลตรวจ 3 ด่านไม่ถูกล้าง
    v_p5 := pg_temp.mk_ready(v_shop, 'short_clip', 'tiktok');
    select count(*) into v_n from analytics.content_hook where step_id = v_p5;
    v_j := analytics.content_piece_post(v_shop, v_p5, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '3 hours', 'owner',
                                        null, '  hook   อื่นๆ ของจริง  ', 'story');
    v_hookO := (v_j ->> 'hook_id')::uuid;
    v_log := v_log || pg_temp.vb('B5', 'hook อื่น (ข้อความ+ประเภท) บนชิ้น produced → สร้าง hook ours label null · ข้อความถูก clean · human · ประเภทตามที่ส่ง · post.hook_id ชี้ตัวนั้น · hook ของชิ้น = เดิม+1',
      v_hookO is not null
      and (select h.origin = 'ours' and h.step_id = v_p5 and h.label is null and h.text = 'hook อื่นๆ ของจริง' and h.hook_type = 'story' and h.generated_by = 'human'
             from analytics.content_hook h where h.id = v_hookO)
      and (select cp.hook_id = v_hookO from analytics.content_post cp where cp.id = (v_j ->> 'post_id')::uuid)
      and (select count(*) from analytics.content_hook where step_id = v_p5) = v_n + 1, v_j::text);
    v_log := v_log || pg_temp.vb('B6', 'หลัง B5 ผลตรวจ 3 ด่านยัง passed (hook อื่นไม่ล้างผลตรวจของชิ้นที่ approved) · GUC ไม่ค้าง · hook อื่นไม่นับในด่าน "A/B ต่างประเภท" (label null)',
      (select count(*) from analytics.step_gate where step_id = v_p5 and status = 'passed') = 3 and coalesce(current_setting('c2.piece_rpc', true), '') <> '1');
    -- GUC ที่ RPC เปิดไว้ชั่วคราวต้องไม่ใช่ช่องโหว่: service_role+GUC เองเพิ่ม hook ตรงบนชิ้น posted ยังโดน guard
    perform set_config('c2.piece_rpc', '1', true);
    execute 'set local role service_role';
    begin
      insert into analytics.content_hook (shop_id, text, hook_type, origin, step_id, generated_by) values (v_shop, 'แทรกตรง', 'story', 'ours', v_p5, 'human');
      v_r := 'FAIL ผ่านทั้งที่ควรปฏิเสธ';
    exception when sqlstate '55000' then v_r := 'OK 55000';
    when others then v_r := 'FAIL sqlstate=' || sqlstate;
    end;
    execute 'reset role';
    perform set_config('c2.piece_rpc', '', true);
    v_log := v_log || pg_temp.vl('B6b', 'หลัง RPC เปิด GUC ชั่วคราว: service_role (+ตั้ง GUC เอง) INSERT hook ตรงบนชิ้น posted → 55000 (ช่องข้ามเฉพาะรอบ call ของ RPC)', v_r);
    -- ข้าม produced: approved + คลิปยืนยันว่ามีภาพ (has_footage) → posted ตรง
    v_p6 := pg_temp.mk_ready(v_shop, 'short_clip', 'tiktok', 'approved');
    perform analytics.content_piece_set_plan(v_shop, v_p6, jsonb_build_object('footage_status', 'has_footage'), 'owner');
    v_j := analytics.content_piece_post(v_shop, v_p6, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '4 hours', 'owner', pg_temp.hook_a(v_p6));
    v_log := v_log || pg_temp.vb('B7', 'ต้องไม่พัง: approved + footage has_footage → posted ตรงโดยข้าม produced', pg_temp.st(v_p6) = 'posted/done', pg_temp.st(v_p6));

    -- โพสต์เดิมที่ผูกชิ้นอื่น/ชิ้นนี้อยู่ ต้องล้มก่อน upsert (ไม่ทับ post_url/posted_at ของใบเดิม)
    v_p7 := pg_temp.mk_ready(v_shop, 'short_clip', 'tiktok');
    v_snap := (select md5(concat_ws('|', post_url, posted_at, step_id, hook_id, updated_at)) from analytics.content_post where id = v_post1);
    v_log := v_log || pg_temp.vl('X31v', 'โพสต์เดิม (platform+external_id เดียวกัน) ผูกชิ้น P1 อยู่ → ผูกกับ P7 = 55000 · ผูกกับ P1 ซ้ำ = 55000 · ใบเดิมไม่ถูกทับ',
      pg_temp.vx(pg_temp.q_post(v_shop, v_p7, 'tiktok', v_ext1, 'https://www.tiktok.com/@other/video/999', now() - interval '1 hour', 'owner'), array['55000'], 'ผูกกับชิ้นงานอื่น')
      || pg_temp.vx(pg_temp.q_post(v_shop, v_p1, 'tiktok', v_ext1, pg_temp.url(v_ext1), now() - interval '1 hour', 'owner'), array['55000'], 'โพสต์แล้ว')
      || case when v_snap = (select md5(concat_ws('|', post_url, posted_at, step_id, hook_id, updated_at)) from analytics.content_post where id = v_post1)
              then 'OK ใบเดิมไม่ขยับ' else 'FAIL ใบเดิมถูกทับ' end);
    v_log := v_log || pg_temp.vl('X31w', 'ชิ้นที่ posted แล้ว (short_clip) เพิ่มโพสต์ใบที่ 2 → 55000 (เฉพาะ ig_fb_post ที่เพิ่มได้)',
      pg_temp.vx(pg_temp.q_post(v_shop, v_p1, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', 'owner'), array['55000'], 'ชิ้น ig_fb_post'));

    -- B8: โพสต์ใบที่ 2 (additional · ไม่ผ่าน transition_) พร้อม hook อื่น → GUC ที่เปิดไว้สร้าง hook ต้องถูกปิดคืนโดย RPC เอง (ไม่พึ่ง transition_ มาล้างให้)
    v_ig := pg_temp.mk_ready(v_shop, 'ig_fb_post', 'facebook');
    perform analytics.content_piece_post(v_shop, v_ig, 'facebook', pg_temp.ext(), 'https://www.facebook.com/verify160/posts/b8a', now() - interval '1 hour', 'owner');
    perform analytics.content_piece_post(v_shop, v_ig, 'instagram', pg_temp.ext(), 'https://www.instagram.com/p/b8b/', now() - interval '1 hour', 'owner', null, 'hook อื่น B8', 'warning');
    v_log := v_log || pg_temp.vb('B8', 'โพสต์ใบที่ 2 (ไม่ผ่าน transition_) พร้อม hook อื่น: GUC c2.piece_rpc ถูกปิดคืนหลัง RPC · hook อื่นสร้างบนชิ้น posted สำเร็จ',
      coalesce(current_setting('c2.piece_rpc', true), '') <> '1'
      and exists (select 1 from analytics.content_hook h where h.step_id = v_ig and h.label is null and h.hook_type = 'warning' and h.text = 'hook อื่น B8'),
      coalesce(current_setting('c2.piece_rpc', true), '(null)'));

    -- ต้องไม่พัง: คิววางลิงก์เดิม (content_post_upsert ตรง) ทำงานเหมือนเดิม · โพสต์นอกแผนไม่มี step_id · เห็นในคิวยอด · แล้ว piece_post "รับเป็นของชิ้น" ได้
    v_ext1 := pg_temp.ext();
    v_post2 := analytics.content_post_upsert(v_shop, 'tiktok', v_ext1, pg_temp.url(v_ext1), now() - interval '2 days', null, null, 'แคปชันนอกแผน');
    v_log := v_log || pg_temp.vb('KQ1', 'content_post_upsert ตรง (คิวเดิม) ยังสร้างโพสต์ได้ · step_id/hook_id = null · caption เก็บ',
      (select step_id is null and hook_id is null and status = 'active' and caption_snapshot = 'แคปชันนอกแผน' from analytics.content_post where id = v_post2));
    v_log := v_log || pg_temp.vb('KQ2', 'โพสต์นอกแผนอยู่ในคิวกรอกยอด v_content_entry_queue (อายุ 2 วัน = รอบ 1) และ v_content_post_t7',
      exists (select 1 from analytics.v_content_entry_queue q where q.post_id = v_post2)
      and exists (select 1 from analytics.v_content_post_t7 t where t.post_id = v_post2));
    v_log := v_log || pg_temp.vb('KQ3', 'content_post_upsert ซ้ำ (แก้ลิงก์โพสต์เดิม) ยังทำงาน ไม่แตะ step/hook · v_content_piece ไม่รู้จักโพสต์นี้',
      pg_temp.vok(format('select analytics.content_post_upsert(%L::uuid,''tiktok'',%L,%L,now() - interval ''2 days'')', v_shop, v_ext1, pg_temp.url(v_ext1) || '?x=1')) = 'OK'
      and not exists (select 1 from analytics.v_content_piece p where p.posts @> jsonb_build_array(jsonb_build_object('post_id', v_post2))));
  exception when others then
    v_log := v_log || format(E'[FAIL] B-post ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  ----------------------------------------------------------------------------
  -- K14: ig_fb_post โพสต์ facebook แล้ว instagram บนชิ้นเดียว · 1 platform 1 โพสต์
  ----------------------------------------------------------------------------
  begin
    v_ig := pg_temp.mk_ready(v_shop, 'ig_fb_post', 'facebook');
    v_j := analytics.content_piece_post(v_shop, v_ig, 'facebook', pg_temp.ext(), 'https://www.facebook.com/verify160/posts/1', now() - interval '3 hours', 'owner');
    v_log := v_log || pg_temp.vb('K14a', 'ig_fb_post โพสต์ facebook → posted · additional=false', pg_temp.st(v_ig) = 'posted/done' and (v_j ->> 'additional')::boolean is false);
    select count(*) into v_n from analytics.content_piece_event where step_id = v_ig and event_kind = 'post';
    v_j := analytics.content_piece_post(v_shop, v_ig, 'instagram', pg_temp.ext(), 'https://www.instagram.com/p/verify160/', now() - interval '2 hours', 'owner');
    v_log := v_log || pg_temp.vb('K14b', 'โพสต์ instagram ใบที่ 2 บนชิ้นที่ posted แล้ว → ผ่าน · additional=true · สถานะคง posted/done',
      (v_j ->> 'additional')::boolean is true and pg_temp.st(v_ig) = 'posted/done', v_j::text);
    v_log := v_log || pg_temp.vb('K14c', 'event post เพิ่ม 1 แถว (from posted → posted · payload.additional=true · platform=instagram)',
      (select count(*) from analytics.content_piece_event where step_id = v_ig and event_kind = 'post') = v_n + 1
      and exists (select 1 from analytics.content_piece_event e where e.step_id = v_ig and e.event_kind = 'post' and e.from_status = 'posted'
                    and (e.payload ->> 'additional')::boolean and e.payload ->> 'platform' = 'instagram'));
    v_log := v_log || pg_temp.vb('K14d', 'v_content_piece.posts มี 2 รายการ (facebook + instagram) · posted_on = วันไทยของโพสต์ที่เก่าสุด',
      (select jsonb_array_length(posts) = 2 and (select count(distinct x ->> 'platform') from jsonb_array_elements(posts) x) = 2
         and posted_on = (select min(cp.posted_date_th) from analytics.content_post cp where cp.step_id = v_ig and cp.status = 'active')
         from analytics.v_content_piece where step_id = v_ig));
    v_log := v_log || pg_temp.vl('K14e', 'ใบที่ 3 (facebook อีกใบ คนละ external_id) → 55000 (1 platform 1 โพสต์) · tiktok → 22023',
      pg_temp.vx(pg_temp.q_post(v_shop, v_ig, 'facebook', pg_temp.ext(), 'https://www.facebook.com/verify160/posts/3', now() - interval '1 hour', 'owner'), array['55000'], '1 platform')
      || pg_temp.vx(pg_temp.q_post(v_shop, v_ig, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '1 hour', 'owner'), array['22023'], 'โพสต์บน'));
  exception when others then
    v_log := v_log || format(E'[FAIL] K14 ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  ----------------------------------------------------------------------------
  -- L. link / unlink (X32) + K12z
  ----------------------------------------------------------------------------
  begin
    v_p2 := pg_temp.mk_ready(v_shop, 'short_clip', 'tiktok');                       -- produced
    v_p3 := pg_temp.mk_ready(v_shop, 'short_clip', 'tiktok');                       -- produced
    v_inrev := pg_temp.mk_step(v_shop, 'short_clip', 'tiktok');                     -- in_review
    v_ext1 := pg_temp.ext();
    v_post1 := analytics.content_post_upsert(v_shop, 'tiktok', v_ext1, pg_temp.url(v_ext1), now() - interval '3 days');   -- นอกแผน
    v_post2 := analytics.content_post_upsert(v_shop, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '3 days');
    v_post3 := analytics.content_post_upsert(v_shop, 'instagram', pg_temp.ext(), 'https://www.instagram.com/p/l160/', now() - interval '3 days');
    perform analytics.content_post_set_status(v_shop, v_post2, 'deleted');
    v_hookA := pg_temp.hook_a(v_p2);
    v_snap := pg_temp.snap();
    v_log := v_log || pg_temp.vl('X32a', 'link โพสต์ที่ deleted → 55000 · step in_review → 55000 · platform ไม่ตรงชนิด (instagram → short_clip) → 22023',
      pg_temp.vx(pg_temp.q_link(v_shop, v_post2, v_p2, 'owner'), array['55000'], 'ต้อง active')
      || pg_temp.vx(pg_temp.q_link(v_shop, v_post1, v_inrev, 'owner'), array['55000'], 'ผูกได้เฉพาะ')
      || pg_temp.vx(pg_temp.q_link(v_shop, v_post3, v_p2, 'owner'), array['22023'], 'ผูกกับโพสต์'));
    v_log := v_log || pg_temp.vl('X32b', 'link: actor ai/system → 42501 · hook ของ step อื่น/reference → 22023 · ต่างร้าน (post หรือ step) → 22023 · null → 22023',
      pg_temp.vx(pg_temp.q_link(v_shop, v_post1, v_p2, 'ai'), array['42501'], 'ไม่มีสิทธิ์')
      || pg_temp.vx(pg_temp.q_link(v_shop, v_post1, v_p2, 'system'), array['42501'], 'ไม่มีสิทธิ์')
      || pg_temp.vx(pg_temp.q_link(v_shop, v_post1, v_p2, 'owner', pg_temp.hook_a(v_p3)), array['22023'], 'ไม่ใช่ของชิ้นงานนี้')
      || pg_temp.vx(pg_temp.q_link(v_shop, v_post1, v_p2, 'owner', v_ref_h), array['22023'], 'hook ของเขา')
      || pg_temp.vx(pg_temp.q_link(v_shopB, v_post1, v_p2, 'owner'), array['22023'], 'ไม่พบชิ้นงาน')
      || pg_temp.vx(pg_temp.q_link(v_shop, gen_random_uuid(), v_p2, 'owner'), array['22023'], 'ไม่พบโพสต์')
      || pg_temp.vx('select analytics.content_post_link_step(null,null,null,''owner'')', array['22023'], 'ต้องระบุ'));
    v_log := v_log || pg_temp.vb('X32c', 'ชุดปฏิเสธ link ไม่ทิ้งร่องรอย (โพสต์/hook/event/step เท่าเดิม)', v_snap = pg_temp.snap());
    -- ข้ามร้าน: โพสต์ของร้าน B + step ของร้าน A
    insert into analytics.content_post (shop_id, platform, external_id, post_url, posted_at, posted_date_th)
      values (v_shopB, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '2 days', v_today - 2) returning id into v_id;
    v_log := v_log || pg_temp.vl('X32d', 'ผูกโพสต์ของร้าน B กับ step ร้าน A: เรียกด้วยร้าน A → ไม่พบโพสต์ · เรียกด้วยร้าน B → ไม่พบชิ้นงาน (ทั้งสองทาง 22023)',
      pg_temp.vx(pg_temp.q_link(v_shop, v_id, v_p2, 'owner'), array['22023'], 'ไม่พบโพสต์')
      || pg_temp.vx(pg_temp.q_link(v_shopB, v_id, v_p2, 'owner'), array['22023'], 'ไม่พบชิ้นงาน'));
    v_log := v_log || pg_temp.vb('X32e', 'หลังพยายามข้ามร้าน โพสต์ร้าน B ยัง step_id null', (select step_id is null from analytics.content_post where id = v_id));

    -- สำเร็จ: ผูกโพสต์นอกแผน + hook A → posted · กันผูกซ้ำ/ผูก 2 ชิ้น
    v_j := analytics.content_post_link_step(v_shop, v_post1, v_p2, 'owner', v_hookA);
    v_log := v_log || pg_temp.vb('L1', 'link โพสต์นอกแผนกับ P2 (produced) + hook A → posted · post.step_id/hook_id/artifact_id ตั้ง · event post (payload.post_id)',
      pg_temp.st(v_p2) = 'posted/done'
      and (select step_id = v_p2 and hook_id = v_hookA and artifact_id = (select a.id from analytics.step_artifact a where a.step_id = v_p2)
             from analytics.content_post where id = v_post1)
      and exists (select 1 from analytics.content_piece_event e where e.step_id = v_p2 and e.event_kind = 'post' and (e.payload ->> 'post_id')::uuid = v_post1), v_j::text);
    v_log := v_log || pg_temp.vl('L2', 'ผูกโพสต์เดิมซ้ำ (ชิ้นเดียวกัน) → 55000 · ผูกกับชิ้นอื่น P3 → 55000 "ปลดผูกก่อน" (โพสต์เดียวไม่ผูก 2 ชิ้น)',
      pg_temp.vx(pg_temp.q_link(v_shop, v_post1, v_p2, 'owner'), array['55000'], 'ผูกกับชิ้นงานนี้')
      || pg_temp.vx(pg_temp.q_link(v_shop, v_post1, v_p3, 'owner'), array['55000'], 'ผูกกับชิ้นงานอื่น'));
    v_log := v_log || pg_temp.vb('L2b', 'ชิ้น P3 ไม่ถูกแตะ (ยัง produced · ไม่มีโพสต์)', pg_temp.st(v_p3) = 'produced/active'
      and not exists (select 1 from analytics.content_post where step_id = v_p3));

    -- X32: unlink ไม่มี reason
    v_snap := pg_temp.snap();
    v_log := v_log || pg_temp.vl('X32f', 'unlink: reason null / ว่าง / สั้นเกิน / ZWSP ล้วน → 22023',
      pg_temp.vx(pg_temp.q_unlink(v_shop, v_post1, null, 'owner'), array['22023'], 'เหตุผล')
      || pg_temp.vx(pg_temp.q_unlink(v_shop, v_post1, '', 'owner'), array['22023'], 'เหตุผล')
      || pg_temp.vx(pg_temp.q_unlink(v_shop, v_post1, 'ab', 'owner'), array['22023'], 'เหตุผล')
      || pg_temp.vx(pg_temp.q_unlink(v_shop, v_post1, E'​​​​', 'owner'), array['22023'], 'เหตุผล'));
    v_log := v_log || pg_temp.vl('X32g', 'unlink: actor ai/system → 42501 · ต่างร้าน → 22023 · โพสต์ที่ไม่ได้ผูกชิ้นใด → 55000 · โพสต์ไม่มี → 22023',
      pg_temp.vx(pg_temp.q_unlink(v_shop, v_post1, 'ปลดทดสอบ', 'ai'), array['42501'], 'ไม่มีสิทธิ์')
      || pg_temp.vx(pg_temp.q_unlink(v_shopB, v_post1, 'ปลดทดสอบ', 'owner'), array['22023'], 'ไม่พบโพสต์')
      || pg_temp.vx(pg_temp.q_unlink(v_shop, v_post3, 'ปลดทดสอบ', 'owner'), array['55000'], 'ไม่ได้ผูก')
      || pg_temp.vx(pg_temp.q_unlink(v_shop, gen_random_uuid(), 'ปลดทดสอบ', 'owner'), array['22023'], 'ไม่พบโพสต์'));
    v_log := v_log || pg_temp.vb('X32h', 'ชุดปฏิเสธ unlink ไม่ทิ้งร่องรอย', v_snap = pg_temp.snap());

    -- unlink สำเร็จ: posted → produced · โพสต์ไม่ถูกลบ · artifact_id คง · hook/step null · event unpost + reason
    select artifact_id into v_art from analytics.content_post where id = v_post1;
    v_j := analytics.content_post_unlink_step(v_shop, v_post1, '  ผูกผิดชิ้น  ', 'owner');
    v_log := v_log || pg_temp.vb('L3', 'unlink ใบเดียวของชิ้น → ถอย posted→produced (artifact done→approved) · โพสต์ยังอยู่ active · step_id/hook_id null · artifact_id คงไว้',
      pg_temp.st(v_p2) = 'produced/active'
      and (select string_agg(status, ',') from analytics.step_artifact where step_id = v_p2) = 'approved'
      and (select step_id is null and hook_id is null and status = 'active' and artifact_id = v_art from analytics.content_post where id = v_post1)
      and (v_j ->> 'remaining_active_posts')::int = 0, v_j::text);
    v_log := v_log || pg_temp.vb('L3b', 'event unpost: reason ถูก clean · from posted → to produced · อยู่ในคิวยอดเป็นโพสต์นอกแผนอีกครั้ง',
      exists (select 1 from analytics.content_piece_event e where e.step_id = v_p2 and e.event_kind = 'unpost' and e.reason = 'ผูกผิดชิ้น'
                and e.from_status = 'posted' and e.to_status = 'produced')
      and exists (select 1 from analytics.v_content_post_t7 t where t.post_id = v_post1));
    -- ผูกใหม่ได้ (วงจรกลับไปกลับมา)
    v_log := v_log || pg_temp.vl('L4', 'ต้องไม่พัง: ปลดแล้วผูกกับชิ้นเดิมอีกรอบได้ → posted', pg_temp.vok(pg_temp.q_link(v_shop, v_post1, v_p2, 'owner'))
      || case when pg_temp.st(v_p2) = 'posted/done' then 'OK' else 'FAIL ' || pg_temp.st(v_p2) end);

    -- ig_fb_post 2 โพสต์: ปลดใบหนึ่งแล้วยัง posted (event unpost from=to=posted) · ปลดใบสุดท้ายถอย produced
    select cp.id into v_post2 from analytics.content_post cp where cp.step_id = v_ig and cp.platform = 'facebook';
    select cp.id into v_post3 from analytics.content_post cp where cp.step_id = v_ig and cp.platform = 'instagram';
    v_j := analytics.content_post_unlink_step(v_shop, v_post2, 'ผูกผิดแพลตฟอร์ม', 'owner');
    v_log := v_log || pg_temp.vb('L5', 'ig_fb_post ปลดใบ facebook ใบเดียว → ยัง posted (เหลือ instagram active 1) · event unpost from=to=posted · remaining=1',
      pg_temp.st(v_ig) = 'posted/done' and (v_j ->> 'remaining_active_posts')::int = 1
      and exists (select 1 from analytics.content_piece_event e where e.step_id = v_ig and e.event_kind = 'unpost' and e.from_status = 'posted' and e.to_status = 'posted'), v_j::text);
    v_j := analytics.content_post_unlink_step(v_shop, v_post3, 'ผูกผิดแพลตฟอร์ม 2', 'owner');
    v_log := v_log || pg_temp.vb('L6', 'ปลดใบสุดท้าย → produced · ต้องไม่พัง: วางลิงก์ใหม่ผ่าน content_piece_post ได้อีก (posted)',
      pg_temp.st(v_ig) = 'produced/active'
      and pg_temp.vok(pg_temp.q_post(v_shop, v_ig, 'facebook', (select external_id from analytics.content_post where id = v_post2),
            (select post_url from analytics.content_post where id = v_post2), now() - interval '1 hour', 'owner')) = 'OK'
      and pg_temp.st(v_ig) = 'posted/done');

    -- C: link โพสต์ใบที่ 2 นอกแผนเข้า ig_fb_post ที่ posted แล้ว
    v_post2 := analytics.content_post_upsert(v_shop, 'instagram', pg_temp.ext(), 'https://www.instagram.com/p/l160b/', now() - interval '2 days');
    v_j := analytics.content_post_link_step(v_shop, v_post2, v_ig, 'owner');
    v_log := v_log || pg_temp.vb('L7', 'link โพสต์ instagram นอกแผนเข้า ig_fb_post ที่ posted แล้ว → ผ่าน additional=true (ตัดสินใจ C)',
      (v_j ->> 'additional')::boolean is true and (select jsonb_array_length(posts) from analytics.v_content_piece where step_id = v_ig) >= 2);

    -- K12z: โพสต์ถูกตั้ง deleted → ย้อน/ปลดได้ (นับเฉพาะโพสต์ active)
    v_p4 := pg_temp.mk_ready(v_shop, 'short_clip', 'tiktok');
    v_j := analytics.content_piece_post(v_shop, v_p4, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '1 day', 'owner', pg_temp.hook_a(v_p4));
    v_post1 := (v_j ->> 'post_id')::uuid;
    v_r := pg_temp.vx(pg_temp.q_adv(v_shop, v_p4, 'produced', 'owner', 'ย้อนทดสอบ K12z'), array['55000'], 'ยังมีโพสต์');
    perform analytics.content_post_set_status(v_shop, v_post1, 'deleted');
    v_r := v_r || pg_temp.vok(pg_temp.q_adv(v_shop, v_p4, 'produced', 'owner', 'ย้อนทดสอบ K12z'));
    v_log := v_log || pg_temp.vl('K12z', 'โพสต์ active: advance ย้อน posted→produced = 55000 · หลัง set_status deleted: ย้อนได้ → produced/active · event unpost',
      v_r || case when pg_temp.st(v_p4) = 'produced/active' then 'OK' else 'FAIL ' || pg_temp.st(v_p4) end);
    v_p5 := pg_temp.mk_ready(v_shop, 'short_clip', 'tiktok');
    v_j := analytics.content_piece_post(v_shop, v_p5, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '1 day', 'owner', pg_temp.hook_a(v_p5));
    v_post2 := (v_j ->> 'post_id')::uuid;
    perform analytics.content_post_set_status(v_shop, v_post2, 'deleted');
    v_r := pg_temp.vok(pg_temp.q_unlink(v_shop, v_post2, 'โพสต์ถูกลบแล้ว K12z', 'owner'));
    v_log := v_log || pg_temp.vl('K12z2', 'โพสต์ deleted แล้ว unlink → ถอย produced (นับเฉพาะ active = 0) · แถวโพสต์ยังอยู่สถานะ deleted',
      v_r || case when pg_temp.st(v_p5) = 'produced/active' and (select status = 'deleted' and step_id is null from analytics.content_post where id = v_post2) then 'OK' else 'FAIL ' || pg_temp.st(v_p5) end);
  exception when others then
    v_log := v_log || format(E'[FAIL] L ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  ----------------------------------------------------------------------------
  -- D. content_piece_defer (X33)
  ----------------------------------------------------------------------------
  begin
    v_idea := analytics.content_piece_create(v_shop, 'verify-0160 idea D', 'ig_fb_post', 'facebook', 'jewelry_925', 'owner');
    v_plan := pg_temp.mk_step(v_shop, 'ig_fb_post', 'facebook', 'planned');
    v_inrev := pg_temp.mk_step(v_shop, 'ig_fb_post', 'facebook');
    v_canc := pg_temp.mk_step(v_shop, 'ig_fb_post', 'facebook');
    perform analytics.content_piece_advance(v_shop, v_canc, 'cancelled', 'owner', 'ยกเลิก D');
    v_p5 := pg_temp.mk_ready(v_shop, 'ig_fb_post', 'facebook', 'approved');
    v_p6 := pg_temp.mk_ready(v_shop, 'line_message', 'line_oa', 'approved');
    perform analytics.content_piece_advance(v_shop, v_p6, 'posted', 'owner');
    v_snap := pg_temp.snap();
    v_log := v_log || pg_temp.vl('X33a', 'defer ชิ้น idea (anchor null) → 55000 ข้อความไทยบอกให้ใช้ set_plan (ไม่ใช่ P0001 ดิบจาก campaign_reschedule_step · ไม่เงียบ)',
      pg_temp.vx(pg_temp.q_defer(v_shop, v_idea, v_today + 3, 'ทดสอบเลื่อน', 'owner'), array['55000'], 'content_piece_set_plan'));
    v_log := v_log || pg_temp.vl('X33b', 'defer ชิ้น posted / cancelled → 55000',
      pg_temp.vx(pg_temp.q_defer(v_shop, v_p6, v_today + 3, 'ทดสอบเลื่อน', 'owner'), array['55000'], 'เลื่อนวันไม่ได้')
      || pg_temp.vx(pg_temp.q_defer(v_shop, v_canc, v_today + 3, 'ทดสอบเลื่อน', 'owner'), array['55000'], 'เลื่อนวันไม่ได้'));
    v_log := v_log || pg_temp.vl('X33c', 'defer: actor ai/system → 42501',
      pg_temp.vx(pg_temp.q_defer(v_shop, v_plan, v_today + 3, 'ทดสอบเลื่อน', 'ai'), array['42501'], 'ไม่มีสิทธิ์')
      || pg_temp.vx(pg_temp.q_defer(v_shop, v_plan, v_today + 3, 'ทดสอบเลื่อน', 'system'), array['42501'], 'ไม่มีสิทธิ์'));
    v_log := v_log || pg_temp.vl('X33d', 'defer: เหตุผล null / ว่าง / สั้นเกิน / ZWSP ล้วน → 22023',
      pg_temp.vx(pg_temp.q_defer(v_shop, v_plan, v_today + 3, null, 'owner'), array['22023'], 'เหตุผล')
      || pg_temp.vx(pg_temp.q_defer(v_shop, v_plan, v_today + 3, '', 'owner'), array['22023'], 'เหตุผล')
      || pg_temp.vx(pg_temp.q_defer(v_shop, v_plan, v_today + 3, 'ab', 'owner'), array['22023'], 'เหตุผล')
      || pg_temp.vx(pg_temp.q_defer(v_shop, v_plan, v_today + 3, E'​​​', 'owner'), array['22023'], 'เหตุผล'));
    select c.anchor_date + s.offset_start_days into v_d1 from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id where s.id = v_plan;
    v_log := v_log || pg_temp.vl('X33e', 'defer: วันเท่าเดิม → 55000 · วันนอกช่วง (2024 · +5 ปี) → 22023 · วัน null → 22023',
      pg_temp.vx(pg_temp.q_defer(v_shop, v_plan, v_d1, 'ทดสอบเลื่อน', 'owner'), array['55000'], 'เท่าเดิม')
      || pg_temp.vx(pg_temp.q_defer(v_shop, v_plan, date '2024-01-01', 'ทดสอบเลื่อน', 'owner'), array['22023'], 'นอกช่วง')
      || pg_temp.vx(pg_temp.q_defer(v_shop, v_plan, v_today + 2000, 'ทดสอบเลื่อน', 'owner'), array['22023'], 'นอกช่วง')
      || pg_temp.vx(format('select analytics.content_piece_defer(%L::uuid,%L::uuid,null,''ทดสอบ'',''owner'')', v_shop, v_plan), array['22023'], 'ต้องระบุ'));
    v_log := v_log || pg_temp.vl('X33f', 'defer: ต่างร้าน / step ไม่มี → 22023 · step นอก workflow (piece_status null จริง) → 22023',
      pg_temp.vx(pg_temp.q_defer(v_shopB, v_plan, v_today + 3, 'ทดสอบเลื่อน', 'owner'), array['22023'], 'ไม่พบชิ้นงาน')
      || pg_temp.vx(pg_temp.q_defer(v_shop, gen_random_uuid(), v_today + 3, 'ทดสอบเลื่อน', 'owner'), array['22023'], 'ไม่พบชิ้นงาน')
      || pg_temp.vx(pg_temp.q_defer(v_shop, (select s.id from analytics.campaign_step s where s.piece_status is null limit 1), v_today + 3, 'ทดสอบเลื่อน', 'owner'), array['22023'], 'นอก workflow'));
    v_log := v_log || pg_temp.vb('X33g', 'ชุดปฏิเสธ defer ไม่ทิ้งร่องรอย (วัน/event/step เท่าเดิม)', v_snap = pg_temp.snap());

    -- สำเร็จ: wrapper 1 step (ตั้ง anchor) · campaign หลาย step (ตั้ง offset ของชิ้นเดียว) · เวลา · ทุกสถานะ planned..produced
    v_j := analytics.content_piece_defer(v_shop, v_plan, v_today + 9, '  ลูกค้าขอเลื่อน  ', 'owner', time '19:30');
    v_log := v_log || pg_temp.vb('D1', 'defer planned (wrapper 1 step) → วันใหม่ · เวลา 19:30 · piece_status ไม่เปลี่ยน · event defer payload from/to + reason clean',
      (select c.anchor_date + s.offset_start_days = v_today + 9 and s.start_time = time '19:30' and s.piece_status = 'planned'
         from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id where s.id = v_plan)
      and exists (select 1 from analytics.content_piece_event e where e.step_id = v_plan and e.event_kind = 'defer' and e.reason = 'ลูกค้าขอเลื่อน'
                    and e.payload ->> 'from_date' = v_d1::text and e.payload ->> 'to_date' = (v_today + 9)::text and e.from_status = 'planned' and e.to_status = 'planned'),
      v_j::text);
    -- campaign หลาย step: ชิ้นแรกกับชิ้นที่สองใน campaign เดียวกัน
    select s.campaign_id into v_camp from analytics.campaign_step s where s.id = v_plan;
    v_id := analytics.content_piece_create(v_shop, 'verify-0160 D2 ชิ้นที่ 2', 'ig_fb_post', 'facebook', 'jewelry_925', 'owner', v_today + 12, null, v_camp);
    select c.anchor_date + s.offset_start_days into v_d1 from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id where s.id = v_id;
    perform analytics.content_piece_defer(v_shop, v_id, v_today + 20, 'เลื่อนชิ้นที่ 2', 'owner');
    select c.anchor_date + s.offset_start_days into v_d2 from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id where s.id = v_id;
    v_log := v_log || pg_temp.vb('D2', 'campaign หลาย step: เลื่อนชิ้นที่ 2 ไป +20 · ชิ้นแรกในแคมเปญเดียวกันยัง +9 (ไม่ขยับตาม)',
      v_d1 = v_today + 12 and v_d2 = v_today + 20
      and (select c.anchor_date + s.offset_start_days = v_today + 9 from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id where s.id = v_plan));
    v_log := v_log || pg_temp.vl('D3', 'defer ได้ทุกสถานะ planned/in_review/approved/produced (ต้องไม่พัง) · ชิ้นที่ hold อยู่เลื่อนได้',
      pg_temp.vok(pg_temp.q_defer(v_shop, v_inrev, v_today + 6, 'เลื่อน in_review', 'owner'))
      || pg_temp.vok(pg_temp.q_defer(v_shop, v_p5, v_today + 6, 'เลื่อน approved', 'owner'))
      || pg_temp.vok(pg_temp.q_defer(v_shop, (select id from analytics.campaign_step where piece_status = 'produced' and shop_id = v_shop limit 1), v_today + 6, 'เลื่อน produced', 'owner')));
    -- ต้องไม่พัง: ทางปฏิทินเดิม (campaign_reschedule_step) ยังเลื่อนชิ้นใน workflow ได้ (K5) โดยไม่มี event defer
    select count(*) into v_n from analytics.content_piece_event where step_id = v_inrev and event_kind = 'defer';
    v_r := pg_temp.vok(format('select analytics.campaign_reschedule_step(%L::uuid, %L::date)', v_inrev, v_today + 8));
    v_log := v_log || pg_temp.vb('K5r', 'ต้องไม่พัง: campaign_reschedule_step เดิมยังเลื่อนชิ้นใน workflow ได้ · ไม่เพิ่ม event defer',
      v_r = 'OK' and (select count(*) from analytics.content_piece_event where step_id = v_inrev and event_kind = 'defer') = v_n);
  exception when others then
    v_log := v_log || format(E'[FAIL] D ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  ----------------------------------------------------------------------------
  -- V. view: K18 · ปฏิทิน · inbox (นับซ้ำด้วยวิธีอื่น) · host ไม่รั่ว
  ----------------------------------------------------------------------------
  begin
    -- K18: idea (anchor null)
    v_idea := analytics.content_piece_create(v_shop, 'verify-0160 K18 idea', 'short_clip', 'tiktok', 'jewelry_925', 'owner');
    v_log := v_log || pg_temp.vb('K18a', 'idea (anchor null): v_campaign_board 1 แถว (resolved_start/days_until null) · select * ไม่ error',
      (select count(*) = 1 and bool_and(resolved_start is null and days_until is null) from analytics.v_campaign_board where step_id = v_idea));
    v_log := v_log || pg_temp.vb('K18b', 'idea: v_content_piece 1 แถว · v_content_piece_calendar 0 แถว (R18 — ไม่โผล่ปฏิทิน)',
      (select count(*) from analytics.v_content_piece where step_id = v_idea) = 1
      and (select count(*) from analytics.v_content_piece_calendar where step_id = v_idea) = 0);

    -- ปฏิทิน: planned โผล่ · cancelled ไม่โผล่ · ธง
    v_plan := pg_temp.mk_step(v_shop, 'short_clip', 'tiktok', 'planned');
    v_canc := pg_temp.mk_step(v_shop, 'ig_fb_post', 'facebook');
    perform analytics.content_piece_advance(v_shop, v_canc, 'cancelled', 'owner', 'ยกเลิก V');
    v_p1 := pg_temp.mk_ready(v_shop, 'short_clip', 'tiktok', 'approved');
    perform analytics.content_piece_set_plan(v_shop, v_p1, jsonb_build_object('footage_status', 'needs_shoot'), 'owner');
    v_hold := pg_temp.mk_step(v_shop, 'ig_fb_post', 'facebook');
    perform analytics.content_piece_advance(v_shop, v_hold, 'hold', 'owner', 'พัก V');
    v_p2 := pg_temp.mk_ready(v_shop, 'ig_fb_post', 'facebook');                            -- produced → ใช้ทำ no_link_overdue
    perform analytics.content_piece_defer(v_shop, v_p2, v_today - 2, 'ย้อนวันทดสอบ overdue', 'owner');
    v_log := v_log || pg_temp.vb('K18c', 'ปฏิทิน: planned โผล่ · cancelled ไม่โผล่ · ทุกแถวมี resolved_start และไม่ cancelled',
      exists (select 1 from analytics.v_content_piece_calendar where step_id = v_plan)
      and not exists (select 1 from analytics.v_content_piece_calendar where step_id = v_canc)
      and (select count(*) from analytics.v_content_piece_calendar where resolved_start is null or piece_status = 'cancelled') = 0
      and (select count(*) from analytics.v_content_piece_calendar) = (select count(*) from analytics.v_content_piece where resolved_start is not null and piece_status <> 'cancelled'));
    v_log := v_log || pg_temp.vb('V1', 'ธงการ์ด: approved+needs_shoot → flag_needs_shoot · hold → flag_on_hold · in_review ที่มี [ต้องยืนยัน] ค้างจริง (backfill) → flag_confirm_pending · ชิ้นปกติไม่มีธง',
      (select flag_needs_shoot and not flag_on_hold from analytics.v_content_piece_calendar where step_id = v_p1)
      and (select flag_on_hold and not flag_needs_shoot from analytics.v_content_piece_calendar where step_id = v_hold)
      and (select not flag_needs_shoot and not flag_on_hold and not flag_confirm_pending and not flag_no_link_overdue from analytics.v_content_piece_calendar where step_id = v_plan)
      and (select count(*) filter (where flag_confirm_pending) = count(*) filter (where confirm_pending > 0) from analytics.v_content_piece_calendar));
    v_log := v_log || pg_temp.vb('V2', 'flag_no_link_overdue: produced + ชนิดมีลิงก์ + เกินวัน + ไม่มีโพสต์ active → true · active_post_n = 0 · ชิ้นวันนี้/อนาคตไม่ติดธง',
      (select flag_no_link_overdue and active_post_n = 0 from analytics.v_content_piece_calendar where step_id = v_p2)
      and (select not flag_no_link_overdue from analytics.v_content_piece_calendar where step_id = v_p1));
    -- ผูกโพสต์แล้ว (piece_status posted) ธงดับ
    v_j := analytics.content_piece_post(v_shop, v_p2, 'facebook', pg_temp.ext(), 'https://www.facebook.com/verify160/posts/v2', now() - interval '2 days', 'owner');
    v_log := v_log || pg_temp.vb('V3', 'วางลิงก์แล้ว flag_no_link_overdue ดับ · active_post_n = 1',
      (select not flag_no_link_overdue and active_post_n = 1 and piece_status = 'posted' from analytics.v_content_piece_calendar where step_id = v_p2));

    -- โฮสต์: ชื่อจริงไม่ออกทุก view (public_label เท่านั้น)
    v_host := analytics.live_host_upsert(v_shop, 'ชื่อจริงลับ ทดสอบ0160', 'โฮสต์ทดสอบ0160', true, null, 'owner');
    perform analytics.content_piece_set_plan(v_shop, v_plan, jsonb_build_object('expected_host_id', v_host::text), 'owner');
    v_log := v_log || pg_temp.vb('V4', 'โฮสต์: calendar แสดง expected_host_label = public_label · ชื่อจริงไม่ปรากฏใน JSON ของทุกแถวของ 4 view ใหม่',
      (select expected_host_label = 'โฮสต์ทดสอบ0160' from analytics.v_content_piece_calendar where step_id = v_plan)
      and not exists (select 1 from analytics.v_content_piece_calendar t where to_jsonb(t)::text like '%ชื่อจริงลับ%')
      and not exists (select 1 from analytics.v_content_inbox_counts t where to_jsonb(t)::text like '%ชื่อจริงลับ%')
      and not exists (select 1 from analytics.v_line_quota_28d t where to_jsonb(t)::text like '%ชื่อจริงลับ%')
      and not exists (select 1 from analytics.v_content_hook_library t where to_jsonb(t)::text like '%ชื่อจริงลับ%'));

    v_p3 := pg_temp.mk_ready(v_shop, 'ig_fb_post', 'facebook');                            -- produced เกินวัน ไม่โพสต์ (ให้ overdue ≥ 1 หลัง V3)
    perform analytics.content_piece_defer(v_shop, v_p3, v_today - 1, 'ย้อนวันทดสอบ overdue 2', 'owner');
    -- ขอบ post_today: ชิ้น approved วันพรุ่งนี้ไม่นับ · เลื่อนมาเป็นวันนี้ = นับ (+1) · เลื่อนไปเมื่อวาน = ยังนับ (ถึงวันแล้ว)
    select post_today into v_n from analytics.v_content_inbox_counts where shop_id = v_shop;
    v_id := pg_temp.mk_ready(v_shop, 'ig_fb_post', 'facebook', 'approved');
    perform analytics.content_piece_defer(v_shop, v_id, v_today + 1, 'ขอบ post_today พรุ่งนี้', 'owner');
    select post_today into v_n2 from analytics.v_content_inbox_counts where shop_id = v_shop;
    perform analytics.content_piece_defer(v_shop, v_id, v_today, 'ขอบ post_today วันนี้', 'owner');
    v_log := v_log || pg_temp.vb('V5b', 'ขอบ post_today: approved วันพรุ่งนี้ไม่นับ (เท่าเดิม) · เลื่อนเป็นวันนี้ → +1 (resolved_start <= วันนี้ไทย)',
      v_n2 = v_n and (select post_today from analytics.v_content_inbox_counts where shop_id = v_shop) = v_n + 1, format('ก่อน=%s พรุ่งนี้=%s วันนี้=%s', v_n, v_n2, (select post_today from analytics.v_content_inbox_counts where shop_id = v_shop)));
    -- inbox: นับซ้ำจากตารางฐานด้วยสูตรอีกชุด (ร้าน A ข้อมูลจริง + ร้าน B/C ของทดสอบ) · ต้องตรงทุกคอลัมน์
    v_bad := '';
    for r in select unnest(array[v_shop, v_shopB, v_shopC]) as sid loop
      select
        ((select count(*) from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id
           where s.shop_id = r.sid and s.piece_status in ('approved', 'produced') and c.anchor_date + s.offset_start_days <= v_today)
         = (select post_today from analytics.v_content_inbox_counts where shop_id = r.sid))
        and ((select count(*) from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id
               where s.shop_id = r.sid and s.piece_status = 'produced' and s.piece_kind in ('short_clip', 'live_cut', 'ig_fb_post')
                 and c.anchor_date + s.offset_start_days < v_today
                 and not exists (select 1 from analytics.content_post cp where cp.step_id = s.id and cp.status = 'active'))
             = (select post_overdue_no_link from analytics.v_content_inbox_counts where shop_id = r.sid))
        and ((select count(*) from analytics.campaign_step s where s.shop_id = r.sid and s.piece_status = 'in_review')
             = (select review_queue from analytics.v_content_inbox_counts where shop_id = r.sid))
        and ((select count(*) from analytics.campaign_step s where s.shop_id = r.sid and s.piece_status = 'idea')
             = (select ideas from analytics.v_content_inbox_counts where shop_id = r.sid))
        and ((select count(*) from analytics.step_gate g join analytics.campaign_step s on s.id = g.step_id
               where g.shop_id = r.sid and g.gate_kind = 'risk_owner' and g.status in ('pending', 'blocked') and s.piece_status in ('drafting', 'in_review'))
             = (select owner_questions from analytics.v_content_inbox_counts where shop_id = r.sid))
        and ((select count(*) from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id
               where s.shop_id = r.sid and s.piece_status = 'approved' and s.footage_status = 'needs_shoot'
                 and c.anchor_date + s.offset_start_days between v_today - (extract(isodow from v_today)::int - 1)
                                                            and v_today - (extract(isodow from v_today)::int - 1) + 6)
             = (select shoot_this_week from analytics.v_content_inbox_counts where shop_id = r.sid))
        and ((select count(*) from analytics.campaign_step s where s.shop_id = r.sid and s.hold_reason is not null and s.piece_status not in ('posted', 'cancelled'))
             = (select on_hold from analytics.v_content_inbox_counts where shop_id = r.sid))
        and ((select (review_queue > 10) = review_over_limit from analytics.v_content_inbox_counts where shop_id = r.sid))
      into v_b;
      if v_b is not true then v_bad := v_bad || r.sid::text || ' '; end if;
    end loop;
    v_log := v_log || pg_temp.vb('V5', 'v_content_inbox_counts ตรงกับการนับซ้ำจากตารางฐานทุกคอลัมน์ (ร้านจริง + ร้าน B + ร้าน C) — post_today · overdue_no_link · review_queue · ideas · owner_questions · shoot_this_week · on_hold · over_limit',
      v_bad = '', 'ไม่ตรง: ' || v_bad);
    v_log := v_log || pg_temp.vb('V6', 'สูตร overdue เดียวกันทั้งสอง view: จำนวนแถวที่ calendar.flag_no_link_overdue = inbox.post_overdue_no_link (ต่อร้าน)',
      (select count(*) filter (where flag_no_link_overdue) from analytics.v_content_piece_calendar where shop_id = v_shop)
      = (select post_overdue_no_link from analytics.v_content_inbox_counts where shop_id = v_shop)
      and (select post_overdue_no_link from analytics.v_content_inbox_counts where shop_id = v_shop) >= 1);
    -- ผู้ถามเจ้าของ (risk pending) นับเฉพาะ drafting/in_review
    v_id := pg_temp.mk_step(v_shop, 'ig_fb_post', 'facebook');
    select owner_questions into v_n from analytics.v_content_inbox_counts where shop_id = v_shop;
    perform analytics.content_gate_record(v_shop, v_id, 'risk_owner', 'pending', 'ai', jsonb_build_object('question', 'ใช้คำว่าแท้ได้ไหม'));
    v_log := v_log || pg_temp.vb('V7', 'AI ตั้ง risk_owner pending + คำถาม → owner_questions +1 · ส่งกลับ planned/ยกเลิกแล้วไม่นับ',
      (select owner_questions from analytics.v_content_inbox_counts where shop_id = v_shop) = v_n + 1);
    perform analytics.content_piece_advance(v_shop, v_id, 'cancelled', 'owner', 'ยกเลิก V7');
    v_log := v_log || pg_temp.vb('V7b', 'ชิ้น cancelled ที่มี risk pending ไม่นับใน owner_questions', (select owner_questions from analytics.v_content_inbox_counts where shop_id = v_shop) = v_n);

    -- review_over_limit: ร้าน B ใส่ in_review 10 ชิ้น = false · 11 = true · ร้านว่าง (D) ได้แถวเลข 0
    for i in 1..10 loop
      perform pg_temp.mk_step(v_shopB, 'ig_fb_post', 'facebook');
    end loop;
    v_log := v_log || pg_temp.vb('V8a', 'ร้าน B in_review 10 ชิ้น → review_queue = 10 · review_over_limit = false (เกณฑ์ > 10)',
      (select review_queue = 10 and review_over_limit is false from analytics.v_content_inbox_counts where shop_id = v_shopB));
    perform pg_temp.mk_step(v_shopB, 'ig_fb_post', 'facebook');
    v_log := v_log || pg_temp.vb('V8b', 'ร้าน B 11 ชิ้น → review_over_limit = true', (select review_queue = 11 and review_over_limit is true from analytics.v_content_inbox_counts where shop_id = v_shopB));
    insert into public.shop (name) values ('verify-0160 shop D (ว่าง)') returning id into v_shopD;
    v_log := v_log || pg_temp.vb('V9', 'ร้านที่ไม่มีชิ้นงานเลย: inbox ได้ 1 แถวเลข 0 ทุกคอลัมน์ · quota ได้ 1 แถว used=0 planned=0 quota=4 remaining=4',
      (select count(*) = 1 and bool_and(post_today = 0 and post_overdue_no_link = 0 and review_queue = 0 and not review_over_limit and ideas = 0
                                         and owner_questions = 0 and shoot_this_week = 0 and on_hold = 0)
         from analytics.v_content_inbox_counts where shop_id = v_shopD)
      and (select count(*) = 1 and bool_and(used_28d = 0 and planned_28d = 0 and overdue_planned = 0 and quota = 4 and remaining_28d = 4 and not over_quota_planned)
         from analytics.v_line_quota_28d where shop_id = v_shopD));
  exception when others then
    v_log := v_log || format(E'[FAIL] V ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  ----------------------------------------------------------------------------
  -- K13: flow LINE + v_line_quota_28d (ร้าน B)
  ----------------------------------------------------------------------------
  begin
    v_log := v_log || pg_temp.vb('K13a', 'ตั้งต้นร้าน B (ยังไม่มีชิ้น LINE): used=0 planned=0 overdue=0 quota=4',
      (select used_28d = 0 and planned_28d = 0 and overdue_planned = 0 and quota = 4 from analytics.v_line_quota_28d where shop_id = v_shopB));
    v_line := analytics.content_piece_create(v_shopB, 'verify-0160 LINE K13', 'line_message', 'line_oa', 'jewelry_925', 'owner', v_today + 3);
    v_log := v_log || pg_temp.vb('K13b', 'create line_message → line_audience = all อัตโนมัติ · planned_28d = 1 · used = 0',
      (select line_audience = 'all' from analytics.campaign_step where id = v_line)
      and (select planned_28d = 1 and used_28d = 0 from analytics.v_line_quota_28d where shop_id = v_shopB));
    -- เดินครบวงจรจน approved แล้ว advance posted (ไม่สร้าง content_post)
    perform analytics.content_piece_advance(v_shopB, v_line, 'drafting', 'owner');
    select a.id into v_art from analytics.step_artifact a where a.step_id = v_line;
    perform analytics.campaign_set_artifact_content(v_art, 'ข้อความ LINE ทดสอบ K13', null);
    perform analytics.content_piece_advance(v_shopB, v_line, 'in_review', 'owner');
    perform pg_temp.approve_ready(v_shopB, v_line);
    perform analytics.content_piece_advance(v_shopB, v_line, 'approved', 'owner', null, 20);
    select count(*) into v_n from analytics.content_post where shop_id = v_shopB;
    perform analytics.content_piece_advance(v_shopB, v_line, 'posted', 'owner');
    v_log := v_log || pg_temp.vb('K13c', 'advance posted ชิ้น LINE → ไม่สร้าง content_post (จำนวนแถวเท่าเดิม) · piece posted/done',
      (select count(*) from analytics.content_post where shop_id = v_shopB) = v_n and pg_temp.st(v_line) = 'posted/done');
    v_log := v_log || pg_temp.vb('K13d', 'v_line_quota_28d: used_28d +1 (=1) · planned_28d ลดเหลือ 0 (ชิ้นที่โพสต์ไม่นับเป็นแผน) · remaining 3 · effective_piece_status = posted',
      (select used_28d = 1 and planned_28d = 0 and remaining_28d = 3 and quota = 4 from analytics.v_line_quota_28d where shop_id = v_shopB)
      and (select effective_piece_status = 'posted' and posted_on = v_today from analytics.v_content_piece where step_id = v_line));
    -- ขอบหน้าต่าง used: event post อายุ 27 วัน = ยังนับ · 28 วัน = ไม่นับ (ปิด append-only ชั่วคราวในทรานแซกชันทดสอบ)
    alter table analytics.content_piece_event disable trigger trg_content_piece_event_append_only;
    update analytics.content_piece_event set created_at = now() - interval '27 days' where step_id = v_line and event_kind = 'post';
    select used_28d into v_n from analytics.v_line_quota_28d where shop_id = v_shopB;
    update analytics.content_piece_event set created_at = now() - interval '28 days' where step_id = v_line and event_kind = 'post';
    select used_28d into v_n2 from analytics.v_line_quota_28d where shop_id = v_shopB;
    update analytics.content_piece_event set created_at = now() where step_id = v_line and event_kind = 'post';
    alter table analytics.content_piece_event enable trigger trg_content_piece_event_append_only;
    v_log := v_log || pg_temp.vb('K13e', 'ขอบหน้าต่าง 28 วัน (วันไทย): โพสต์เมื่อ 27 วันก่อน used=1 · 28 วันก่อน used=0', v_n = 1 and v_n2 = 0, format('27d=%s 28d=%s', v_n, v_n2));
    -- planned window + overdue + over_quota
    v_id := analytics.content_piece_create(v_shopB, 'verify-0160 LINE +27', 'line_message', 'line_oa', 'jewelry_925', 'owner', v_today + 27);
    v_id2 := analytics.content_piece_create(v_shopB, 'verify-0160 LINE +28', 'line_message', 'line_oa', 'jewelry_925', 'owner', v_today + 28);
    perform analytics.content_piece_create(v_shopB, 'verify-0160 LINE เมื่อวาน', 'line_message', 'line_oa', 'jewelry_925', 'owner', v_today - 1);
    perform analytics.content_piece_create(v_shopB, 'verify-0160 LINE ไม่ใช่ line (ig)', 'ig_fb_post', 'facebook', 'jewelry_925', 'owner', v_today + 2);
    v_log := v_log || pg_temp.vb('K13f', 'planned_28d นับ [วันนี้, วันนี้+27] → +27 นับ · +28 ไม่นับ · overdue_planned นับเมื่อวาน (ไม่อยู่ใน planned_28d) · ชิ้นไม่ใช่ line ไม่นับ',
      (select planned_28d = 1 and overdue_planned = 1 and used_28d = 1 and not over_quota_planned from analytics.v_line_quota_28d where shop_id = v_shopB));
    perform analytics.content_piece_create(v_shopB, 'verify-0160 LINE +1', 'line_message', 'line_oa', 'jewelry_925', 'owner', v_today + 1);
    perform analytics.content_piece_create(v_shopB, 'verify-0160 LINE +2', 'line_message', 'line_oa', 'jewelry_925', 'owner', v_today + 2);
    perform analytics.content_piece_create(v_shopB, 'verify-0160 LINE +3', 'line_message', 'line_oa', 'jewelry_925', 'owner', v_today + 3);
    v_log := v_log || pg_temp.vb('K13g', 'used 1 + planned 4 = 5 > quota 4 → over_quota_planned = true · remaining_28d = 3 (greatest(quota-used,0))',
      (select used_28d = 1 and planned_28d = 4 and over_quota_planned and remaining_28d = 3 from analytics.v_line_quota_28d where shop_id = v_shopB));
    perform analytics.content_piece_advance(v_shopB, v_id, 'cancelled', 'owner', 'ยกเลิก K13');
    v_log := v_log || pg_temp.vb('K13h', 'ยกเลิกชิ้น planned → ออกจาก planned_28d (3) · used+planned = 4 ไม่เกิน quota → over_quota_planned = false',
      (select planned_28d = 3 and not over_quota_planned from analytics.v_line_quota_28d where shop_id = v_shopB));
    -- ตรงกับนับซ้ำจากตารางฐาน (ร้านจริง + B)
    v_bad := '';
    for r in select unnest(array[v_shop, v_shopB]) as sid loop
      select (select count(*) from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id
               where s.shop_id = r.sid and s.piece_kind = 'line_message' and s.piece_status in ('planned', 'drafting', 'in_review', 'approved', 'produced')
                 and c.anchor_date + s.offset_start_days between v_today and v_today + 27) = (select planned_28d from analytics.v_line_quota_28d where shop_id = r.sid)
          and (select count(*) from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id
               where s.shop_id = r.sid and s.piece_kind = 'line_message' and s.piece_status in ('planned', 'drafting', 'in_review', 'approved', 'produced')
                 and c.anchor_date + s.offset_start_days < v_today) = (select overdue_planned from analytics.v_line_quota_28d where shop_id = r.sid)
          and (select count(*) from analytics.campaign_step s
                where s.shop_id = r.sid and s.piece_kind = 'line_message' and s.piece_status = 'posted'
                  and exists (select 1 from analytics.content_piece_event e where e.step_id = s.id and e.event_kind = 'post'
                                and (e.created_at at time zone 'Asia/Bangkok')::date between v_today - 27 and v_today)) = (select used_28d from analytics.v_line_quota_28d where shop_id = r.sid)
        into v_b;
      if v_b is not true then v_bad := v_bad || r.sid::text || ' '; end if;
    end loop;
    v_log := v_log || pg_temp.vb('K13i', 'v_line_quota_28d ตรงกับนับซ้ำจากตารางฐาน (ร้านจริง + B): used · planned · overdue', v_bad = '', 'ไม่ตรง: ' || v_bad);
  exception when others then
    execute 'alter table analytics.content_piece_event enable trigger trg_content_piece_event_append_only';
    v_log := v_log || format(E'[FAIL] K13 ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  ----------------------------------------------------------------------------
  -- H. v_content_hook_library — ของเขา+ของเรา · สถิตินับเฉพาะ ours · กฎ 4 ชิ้น (ร้าน C)
  ----------------------------------------------------------------------------
  begin
    -- ตัวช่วย: ชิ้นคลิป produced → โพสต์ (hook A = question) อายุ 7 วัน + metric T+7 (save/view = p_save/1000)
    -- c1-c3 วัดผลแล้ว (question) → n=3 → ยังสรุปไม่ได้
    for i in 1..3 loop
      v_id := pg_temp.mk_ready(v_shopC, 'short_clip', 'tiktok');
      v_j := analytics.content_piece_post(v_shopC, v_id, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '7 days', 'owner', pg_temp.hook_a(v_id));
      perform analytics.content_post_metric_upsert(v_shopC, (v_j ->> 'post_id')::uuid, 1000, 10, 2, i * 50, i * 10, 'manual');
    end loop;
    select h.id into v_hookA from analytics.content_hook h where h.shop_id = v_shopC and h.origin = 'ours' and h.hook_type = 'question' limit 1;
    v_log := v_log || pg_temp.vb('H1', 'question 3 ชิ้นวัดผลแล้ว → type_n_pieces = 3 · verdict "ยังสรุปไม่ได้" · ค่าเฉลี่ย save_rate = 0.1000 (0.05/0.10/0.15)',
      (select count(*) = 3 and bool_and(type_n_pieces = 3 and type_verdict = 'ยังสรุปไม่ได้' and type_avg_save_rate = 0.1000)
         from analytics.v_content_hook_library where shop_id = v_shopC and side = 'ours' and hook_type = 'question' and label = 'A'));
    -- ไม่นับ: โพสต์ที่ยังไม่มีผล T+7 · hook ที่ไม่ได้เลือก (null) · โพสต์ที่ถูกตั้ง deleted · hook ของร้านอื่น
    v_id := pg_temp.mk_ready(v_shopC, 'short_clip', 'tiktok');
    perform analytics.content_piece_post(v_shopC, v_id, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '1 day', 'owner', pg_temp.hook_a(v_id));          -- ไม่มี T+7
    v_id := pg_temp.mk_ready(v_shopC, 'short_clip', 'tiktok');
    v_j := analytics.content_piece_post(v_shopC, v_id, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '7 days', 'owner');                              -- ไม่เลือก hook
    perform analytics.content_post_metric_upsert(v_shopC, (v_j ->> 'post_id')::uuid, 1000, 10, 2, 500, 100, 'manual');
    v_id := pg_temp.mk_ready(v_shopC, 'short_clip', 'tiktok');
    v_j := analytics.content_piece_post(v_shopC, v_id, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '7 days', 'owner', pg_temp.hook_a(v_id));
    perform analytics.content_post_metric_upsert(v_shopC, (v_j ->> 'post_id')::uuid, 1000, 10, 2, 500, 100, 'manual');
    perform analytics.content_post_set_status(v_shopC, (v_j ->> 'post_id')::uuid, 'deleted');                                                                   -- deleted
    v_id := pg_temp.mk_ready(v_shopB, 'short_clip', 'tiktok');
    v_j := analytics.content_piece_post(v_shopB, v_id, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '7 days', 'owner', pg_temp.hook_a(v_id));        -- ร้าน B
    perform analytics.content_post_metric_upsert(v_shopB, (v_j ->> 'post_id')::uuid, 1000, 10, 2, 500, 100, 'manual');
    v_log := v_log || pg_temp.vb('H2', 'ไม่นับ: ไม่มีผล T+7 · ไม่เลือก hook · โพสต์ deleted · ร้านอื่น → question ของร้าน C ยัง n=3 (ยังสรุปไม่ได้)',
      (select bool_and(type_n_pieces = 3 and type_verdict = 'ยังสรุปไม่ได้') from analytics.v_content_hook_library where shop_id = v_shopC and side = 'ours' and hook_type = 'question'));
    -- ชิ้นที่ 4 → สรุปได้ · ประเภทอื่น (fact) ยังไม่ถึง
    v_id := pg_temp.mk_ready(v_shopC, 'short_clip', 'tiktok');
    v_j := analytics.content_piece_post(v_shopC, v_id, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '7 days', 'owner', pg_temp.hook_a(v_id));
    perform analytics.content_post_metric_upsert(v_shopC, (v_j ->> 'post_id')::uuid, 1000, 10, 2, 200, 40, 'manual');
    v_id2 := pg_temp.mk_ready(v_shopC, 'short_clip', 'tiktok');
    select h.id into v_hookB from analytics.content_hook h where h.step_id = v_id2 and h.label = 'B';                                                            -- fact
    v_j := analytics.content_piece_post(v_shopC, v_id2, 'tiktok', pg_temp.ext(), pg_temp.url(), now() - interval '7 days', 'owner', v_hookB);
    perform analytics.content_post_metric_upsert(v_shopC, (v_j ->> 'post_id')::uuid, 1000, 10, 2, 300, 60, 'manual');
    v_log := v_log || pg_temp.vb('H3', 'ชิ้นที่ 4 ของ question วัดผลแล้ว → type_n_pieces = 4 · verdict "สรุปได้" (ขอบ 3→4) · fact (1 ชิ้น) ยัง "ยังสรุปไม่ได้"',
      (select count(*) >= 4 and bool_and(type_n_pieces = 4 and type_verdict = 'สรุปได้') from analytics.v_content_hook_library
         where shop_id = v_shopC and side = 'ours' and hook_type = 'question')
      and (select bool_and(type_n_pieces = 1 and type_verdict = 'ยังสรุปไม่ได้' and type_avg_save_rate = 0.3000) from analytics.v_content_hook_library
         where shop_id = v_shopC and side = 'ours' and hook_type = 'fact' ));
    -- ig_fb_post 2 โพสต์ใช้ hook อื่นตัวเดียวกัน (ประเภท question) วัดผลทั้งคู่ → นับ 1 ชิ้น (distinct step) ไม่ใช่ 2
    v_ig := pg_temp.mk_ready(v_shopC, 'ig_fb_post', 'facebook');
    v_j := analytics.content_piece_post(v_shopC, v_ig, 'facebook', pg_temp.ext(), 'https://www.facebook.com/verify160/posts/h4a', now() - interval '7 days', 'owner',
                                        null, 'hook อื่น H4', 'question');
    v_hookO := (v_j ->> 'hook_id')::uuid;
    perform analytics.content_post_metric_upsert(v_shopC, (v_j ->> 'post_id')::uuid, 1000, 10, 2, 250, 50, 'manual');
    v_j := analytics.content_piece_post(v_shopC, v_ig, 'instagram', pg_temp.ext(), 'https://www.instagram.com/p/h4b/', now() - interval '7 days', 'owner', v_hookO);
    perform analytics.content_post_metric_upsert(v_shopC, (v_j ->> 'post_id')::uuid, 1000, 10, 2, 350, 70, 'manual');
    v_log := v_log || pg_temp.vb('H4', 'ชิ้น ig_fb_post โพสต์ 2 แพลตฟอร์มด้วย hook อื่นตัวเดียวกัน วัดผลทั้งคู่ → posts_n = 2 · measured_n = 2 · ประเภท question นับเป็นชิ้นที่ 5 (ไม่ใช่ 6) · avg_save_rate ของ hook = 0.3000',
      (select posts_n = 2 and measured_n = 2 and avg_save_rate = 0.3000 and type_n_pieces = 5 and type_verdict = 'สรุปได้' and label is null and piece_kind = 'ig_fb_post'
         from analytics.v_content_hook_library where hook_id = v_hookO));
    -- hook ของเขา (reference) อยู่ตารางเดียวกัน: ไม่นับเข้าสถิติ · โชว์สถิติของประเภทเดียวกันของเรา · ไม่มี account
    v_ref_sig := analytics.content_signal_capture(v_shopC, 'reference_clip', 'verify-0160 คลิปอ้างอิง C', 'owner',
                   p_url => 'https://www.tiktok.com/@refc160/video/1600002', p_hook_text => 'hook ของเขา H5', p_hook_type => 'question', p_platform => 'tiktok');
    v_id := analytics.content_signal_capture(v_shopC, 'reference_clip', 'verify-0160 คลิปอ้างอิง C2', 'owner',
                   p_url => 'https://www.tiktok.com/@refc160/video/1600003', p_hook_text => 'hook ของเขา H5b (ยังไม่ติดประเภท)', p_platform => 'tiktok');
    v_log := v_log || pg_temp.vb('H5', 'แถว reference (question): side=reference · step_id/label/posts null · ref_platform/ref_url มี · โชว์สถิติ question ของเรา n=5 สรุปได้ · ไม่ถูกนับเข้าสถิติ (ours ยัง n=5 ไม่เป็น 6)',
      (select side = 'reference' and step_id is null and label is null and posts_n is null and ref_platform = 'tiktok' and ref_url like '%1600002' and type_n_pieces = 5
              and type_verdict = 'สรุปได้' from analytics.v_content_hook_library where source_signal_id = v_ref_sig and side = 'reference')
      and (select bool_and(type_n_pieces = 5) from analytics.v_content_hook_library where shop_id = v_shopC and side = 'ours' and hook_type = 'question'));
    v_log := v_log || pg_temp.vb('H6', 'reference ที่ยังไม่ติดประเภท → verdict "ยังไม่ติดประเภท" · type_n_pieces = 0 · สถิติ null',
      (select side = 'reference' and hook_type is null and type_verdict = 'ยังไม่ติดประเภท' and type_n_pieces = 0 and type_avg_save_rate is null
         from analytics.v_content_hook_library where source_signal_id = v_id and side = 'reference'));
    v_log := v_log || pg_temp.vb('H7', 'รายต่อ hook (ours): c1 hook A ที่วัดผลแล้ว posts_n=1 measured_n=1 avg_save_rate=0.0500 · hook ที่ไม่มีโพสต์ posts_n=0 (ไม่ใช่ null) · ours มี step_id/step_title/piece_status',
      exists (select 1 from analytics.v_content_hook_library where shop_id = v_shopC and side = 'ours' and label = 'A' and posts_n = 1 and measured_n = 1 and avg_save_rate = 0.0500
                 and step_id is not null and step_title like 'verify-0160%' and piece_status = 'posted')
      and exists (select 1 from analytics.v_content_hook_library where shop_id = v_shopC and side = 'ours' and label = 'B' and posts_n = 0 and measured_n = 0));
    v_log := v_log || pg_temp.vb('H8', 'ร้านแยกกัน: สถิติของร้าน B ไม่ปนร้าน C (question ของร้าน B n=1 · ร้าน C n=5) · ทุกแถวของ view ร้านเดียวกับ hook',
      (select max(type_n_pieces) from analytics.v_content_hook_library where shop_id = v_shopB and side = 'ours' and hook_type = 'question') = 1
      and (select max(type_n_pieces) from analytics.v_content_hook_library where shop_id = v_shopC and side = 'ours' and hook_type = 'question') = 5
      and (select count(*) from analytics.v_content_hook_library l join analytics.content_hook h on h.id = l.hook_id where l.shop_id <> h.shop_id) = 0);
    v_log := v_log || pg_temp.vb('H9', 'จำนวนแถว view = จำนวน hook ทั้งตาราง (ของเขา+ของเรา ตารางเดียว · ไม่หายไม่ซ้ำ)',
      (select count(*) from analytics.v_content_hook_library) = (select count(*) from analytics.content_hook));
  exception when others then
    v_log := v_log || format(E'[FAIL] H ABORT sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;

  ----------------------------------------------------------------------------
  -- X37: เรียกฟังก์ชันของ 0160 ทุกตัวจาก role authenticated (หลังจำลองกำแพงชั้นนอกหลุด — 3j-migration-traps 18.5)
  ----------------------------------------------------------------------------
  execute 'grant usage on schema analytics to authenticated';
  v_n := 0; v_n2 := 0; v_bad := null;
  for r in
    select p.proname, (select string_agg('null::' || format_type(t, null), ', ' order by o) from unnest(p.proargtypes::oid[]) with ordinality as u(t, o)) as args
      from pg_proc p
     where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
       and p.proname ~ '^(content_piece_post$|content_piece_defer$|content_post_link_step$|content_post_unlink_step$|content_post_platform_ok_$|content_post_hook_check_$)'
     order by p.proname
  loop
    v_n := v_n + 1;
    begin
      execute 'set local role authenticated';
      execute format('select analytics.%I(%s)', r.proname, coalesce(r.args, ''));
      v_bad := coalesce(v_bad || ', ', '') || r.proname || ':ผ่าน';
    exception when others then
      if sqlstate = '42501' then v_n2 := v_n2 + 1; else v_bad := coalesce(v_bad || ', ', '') || r.proname || ':' || sqlstate; end if;
    end;
    execute 'reset role';
  end loop;
  -- view: authenticated ต้องอ่านไม่ได้เช่นกัน
  for r in select unnest(array['v_content_piece_calendar', 'v_content_inbox_counts', 'v_line_quota_28d', 'v_content_hook_library']) as vn loop
    v_n := v_n + 1;
    begin
      execute 'set local role authenticated';
      execute format('select 1 from analytics.%I limit 1', r.vn);
      v_bad := coalesce(v_bad || ', ', '') || r.vn || ':ผ่าน';
    exception when others then
      if sqlstate = '42501' then v_n2 := v_n2 + 1; else v_bad := coalesce(v_bad || ', ', '') || r.vn || ':' || sqlstate; end if;
    end;
    execute 'reset role';
  end loop;
  execute 'revoke usage on schema analytics from authenticated';
  v_log := v_log || pg_temp.vb('X37', 'role authenticated (แม้ได้ usage สคีมา) เรียกฟังก์ชัน 6 ตัว + อ่าน view 4 ตัวของ 0160 → 42501 ทั้งหมด', v_n = 10 and v_n2 = v_n,
    format('ทดสอบ %s · 42501 %s · ผิดปกติ: %s', v_n, v_n2, coalesce(v_bad, '-')));
  v_log := v_log || pg_temp.vb('X37b', 'สิทธิ์ usage ของ authenticated บนสคีมากลับสู่เดิม (false) หลังทดสอบ', not has_schema_privilege('authenticated', 'analytics', 'usage'));

  ----------------------------------------------------------------------------
  -- ที่ไม่ครอบในไฟล์นี้ (บอกตรงๆ)
  ----------------------------------------------------------------------------
  v_log := v_log || E'[SKIP] การชนกันจริงของ 2 คำสั่งพร้อมกัน (post/link/unlink แข่งกัน — พิสูจน์ลำดับล็อก step→post) = ต้อง 2 connection · do-block ทรานแซกชันเดียวจำลองไม่ได้\n';
  v_log := v_log || E'[SKIP] K21 เวลาคร่อม 00:00-07:00 ไทยจริง — ตรวจแบบ static (Asia/Bangkok ใน definition + ไม่มี current_date) เท่านั้น\n';
  v_log := v_log || E'[SKIP] K18 ส่วน QA เปิดบอร์ด+ปฏิทินบนเว็บ = ไม่มี (ต้องกดจริง — scope L ของ QA)\n';
  v_log := v_log || E'[SKIP] ไม่ครอบ: ผลต่อ content_post_metric_upsert/สถิติรายชิ้นของ ig_fb_post ที่มี 2 โพสต์ (R24 — view วัดโพสต์แรกเท่านั้น) · หน้าจอ UI ทั้งหมด\n';

  exception when others then
    v_log := v_log || format(E'[FAIL] ABORT verify หยุดกลางทาง sqlstate=%s msg=%s
', sqlstate, left(sqlerrm, 300));
  end;
  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_ok   := (length(v_log) - length(replace(v_log, '[OK]', ''))) / 4;
  v_log := v_log || format(E'\n=== สรุป: [OK] %s · [FAIL] %s — raise ด้านล่างบังคับ ROLLBACK ทั้งหมด ===\n', v_ok, v_fail);
  raise exception '%', v_log;
end;
$verify0160$;
