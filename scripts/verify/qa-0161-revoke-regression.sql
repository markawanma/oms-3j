-- scripts/verify/qa-0161-revoke-regression.sql  (QA R2-D2 · 7 ต.ค. 69) — regression ของ REVOKE ใน 0161 (H1 + M3)
--
-- คำถามเดียว: service_role เสียสิทธิ์ DELETE/TRUNCATE บน content_post · content_post_metric · public.shop · analytics.campaign · analytics.campaign_step
--            และเสียสิทธิ์เขียนตรงบน content_piece_event · content_confirm_item  → RPC (definer) ทุกตัวที่แอปเรียกต้องยังทำงานครบทุก flow?
--
-- รัน (ก่อน 0161 = baseline ต้องผ่านเหมือนกัน · ส่วน D = ต้องมี 0161 จึงตรวจสิทธิ์ ไม่งั้น [SKIP]):
--   หลัง 0161:  cat supabase/migrations/0161_*.sql scripts/verify/qa-0161-revoke-regression.sql > tmp.sql && node scripts/run-sql.mjs tmp.sql
--   ก่อน 0161:  node scripts/run-sql.mjs scripts/verify/qa-0161-revoke-regression.sql
-- self-rolling-back (3j-migration-traps #11): ทุกอย่างเขียนบนร้านจริงแต่ใน do-block เดียว แล้ว raise บังคับ ROLLBACK ท้ายไฟล์ · ไม่ COMMIT
-- ทุกคำสั่งของแอปรันภายใต้ `set local role service_role` จริง (pg_temp.sr) · fixture ที่ไม่ใช่ตัวทดสอบใช้ owner
--
-- กลุ่มเคส:
--   A สร้าง: campaign_create_task · campaign_create_from_template · content_piece_create · set_plan
--   B วงจรชิ้นเต็ม: advance drafting → AI draft (set_artifact_content) → in_review → confirm_resolve → gate → approved → produced → content_piece_post
--     → upsert โพสต์/ยอด · update_type · set_status deleted/active · unlink/link · defer · reschedule · set_content_type · set_artifact_status · toggle_clip_shot · pass_gate
--   C ลบ: campaign_delete_step (ชิ้นที่มี event/confirm_item = cascade) · ลบ step สุดท้ายของแคมเปญ (แคมเปญหายตาม) · ต้องยังถูกปฏิเสธ 55000 ที่ชิ้นที่มีโพสต์/เคยอนุมัติ
--   D สิทธิ์: DELETE/TRUNCATE/เขียนตรง ต้อง 42501 (ต้องมี 0161) · SELECT ยังอ่านได้ทุกตาราง · หน้าอ่าน (view) ยังอ่านได้ใต้ role
--   E หลังทุก flow: GUC c2.piece_rpc ไม่ค้าง · เขียนตรงยังโดน guard (บน role ที่มีสิทธิ์) — ไม่พังเพราะ revoke

create or replace function pg_temp.vb(p_id text, p_what text, p_cond boolean, p_detail text default '') returns text
 language sql as $f$
  select '[' || case when p_cond is true then 'OK' else 'FAIL' end || '] ' || p_id || ' ' || p_what
         || case when p_detail <> '' then ' → ' || p_detail else '' end || E'\n'
$f$;

create or replace function pg_temp.note(p_id text, p_what text) returns text
 language sql as $f$ select '[NOTE] ' || p_id || ' ' || p_what || E'\n' $f$;

create or replace function pg_temp.skip(p_id text, p_what text) returns text
 language sql as $f$ select '[SKIP] ' || p_id || ' ' || p_what || E'\n' $f$;

-- รัน select ที่คืนค่าเดียวภายใต้ service_role จริง · error → 'ERR:<sqlstate>:<msg>' · reset role ทุกทาง
create or replace function pg_temp.sr(p_sql text) returns text
 language plpgsql as $f$
declare v_r text;
begin
  execute 'set local role service_role';
  begin
    execute p_sql into v_r;
    execute 'reset role';
    return coalesce(v_r, '');
  exception when others then
    execute 'reset role';
    return 'ERR:' || sqlstate || ':' || left(sqlerrm, 160);
  end;
end $f$;

-- DML/DDL ที่ไม่คืนแถว ภายใต้ service_role · 'OK' หรือ 'ERR:...'
create or replace function pg_temp.srx(p_sql text) returns text
 language plpgsql as $f$
begin
  execute 'set local role service_role';
  begin
    execute p_sql;
    execute 'reset role';
    return 'OK';
  exception when others then
    execute 'reset role';
    return 'ERR:' || sqlstate || ':' || left(sqlerrm, 160);
  end;
end $f$;

create or replace function pg_temp.good(p_r text) returns boolean
 language sql as $f$ select p_r not like 'ERR:%' $f$;

do $qa0161rr$
declare
  v_log     text := E'\n=== qa-0161-revoke-regression ===\n';
  v_today   date := (now() at time zone 'Asia/Bangkok')::date;
  v_shop    uuid;
  v_has161  boolean;
  v_rev     boolean;   -- 0161 revoke มีผลแล้ว (service_role ไม่มี DELETE บน content_post)
  v_r       text;
  v_n       int;
  v_n2      int;
  v_t0      uuid; v_c0 uuid;
  v_cmp     uuid;
  v_s       uuid; v_a uuid; v_s2 uuid; v_a2 uuid; v_s3 uuid; v_s4 uuid; v_sc uuid; v_ac uuid;
  v_post    uuid; v_post2 uuid;
  v_j       jsonb;
  v_item    record;
  v_gate    text;
  v_ct      text := 'craft';
  v_ev      int;
  v_ci      int;
  v_ncmp    int;
  v_cc      uuid; v_c4 uuid; v_c5 uuid; v_m1 uuid;
  rr        record;
begin
  begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  select id into v_shop from public.shop order by created_at limit 1;
  v_has161 := to_regprocedure('analytics.content_post_metric_amend(uuid,uuid,date,jsonb,text,text,jsonb)') is not null;
  v_rev := not has_table_privilege('service_role', 'analytics.content_post', 'DELETE');
  v_log := v_log || pg_temp.note('MODE', 'มี 0161=' || v_has161 || ' · revoke มีผล=' || v_rev || ' · ร้านจริง 1 ร้าน (ทุกอย่างถอยท้ายไฟล์)');

  -- ==========================================================================
  -- A. สร้าง — ภายใต้ service_role
  -- ==========================================================================
  v_r := pg_temp.sr(format('select analytics.campaign_create_task(%L::uuid, %L, %L::date, null, null, null, null)::text', v_shop, 'qa r1 task', v_today + 3));
  v_log := v_log || pg_temp.vb('A1', 'campaign_create_task (งานเดี่ยว) สำเร็จ', pg_temp.good(v_r), left(v_r, 80));
  v_t0 := case when pg_temp.good(v_r) then v_r::uuid end;

  v_r := pg_temp.sr(format('select analytics.campaign_create_task(%L::uuid, %L, %L::date, %L, null, null, %L::time)::text', v_shop, 'qa r1 task artifact', v_today + 4, 'fb_post', '19:00'));
  v_log := v_log || pg_temp.vb('A2', 'campaign_create_task พร้อม artifact + เวลา สำเร็จ', pg_temp.good(v_r), left(v_r, 80));
  v_s4 := case when pg_temp.good(v_r) then v_r::uuid end;

  v_r := pg_temp.sr(format('select analytics.campaign_create_from_template(%L::uuid, %L, %L::date, null, null)::text', v_shop, 'promo_event_5step', v_today + 60));
  v_log := v_log || pg_temp.vb('A3', 'campaign_create_from_template (promo_event_5step) สำเร็จ', pg_temp.good(v_r), left(v_r, 80));
  v_cmp := case when pg_temp.good(v_r) then v_r::uuid end;
  select count(*) into v_ncmp from analytics.campaign_step where campaign_id = v_cmp;
  v_log := v_log || pg_temp.vb('A3b', 'แคมเปญจาก template มีหลาย step', v_ncmp >= 2, 'steps=' || v_ncmp);

  v_r := pg_temp.sr(format('select analytics.content_piece_create(%L::uuid, %L, %L, %L, %L, %L, %L::date)::text', v_shop, 'qa r1 piece fb', 'ig_fb_post', 'facebook', 'jewelry_925', 'owner', v_today + 5));
  v_log := v_log || pg_temp.vb('A4', 'content_piece_create (ig_fb_post/facebook) สำเร็จ', pg_temp.good(v_r), left(v_r, 80));
  v_s := case when pg_temp.good(v_r) then v_r::uuid end;
  select count(*) into v_ev from analytics.content_piece_event where step_id = v_s;
  v_log := v_log || pg_temp.vb('A4b', 'ชิ้นใหม่มี event "สร้าง" (RPC เขียน event ได้แม้ service_role เขียนตรงไม่ได้)', v_ev >= 1, 'events=' || v_ev);
  select a.id into v_a from analytics.step_artifact a where a.step_id = v_s;

  v_r := pg_temp.sr(format('select (analytics.content_piece_set_plan(%L::uuid, %L::uuid, jsonb_build_object(''metric_code'', ''save_rate''), ''owner''))::text', v_shop, v_s));
  v_log := v_log || pg_temp.vb('A5', 'content_piece_set_plan (metric_code=save_rate) สำเร็จ', pg_temp.good(v_r), left(v_r, 100));

  -- ==========================================================================
  -- B. วงจรชิ้นเต็ม
  -- ==========================================================================
  v_r := pg_temp.sr(format('select (analytics.content_piece_advance(%L::uuid, %L::uuid, ''drafting'', ''owner''))::text', v_shop, v_s));
  v_log := v_log || pg_temp.vb('B1', 'advance → drafting สำเร็จ', pg_temp.good(v_r), left(v_r, 100));

  -- AI draft ใส่ marker [ต้องยืนยัน] 2 จุด (ภาษาไทย + emoji) เพื่อให้ in_review สร้าง confirm_item
  v_r := pg_temp.sr(format('select analytics.campaign_set_artifact_content(%L::uuid, %L, null)::text', v_a,
                           E'โปรเดือนนี้ [ต้องยืนยัน] ส่วนลดเท่าไหร่? 😀\nส่งฟรีเมื่อไหร่ [ต้องยืนยัน] เงื่อนไขขั้นต่ำ?'));
  v_log := v_log || pg_temp.vb('B2', 'AI draft (campaign_set_artifact_content) สำเร็จ · ไทย+emoji+marker', pg_temp.good(v_r), left(v_r, 100));

  v_r := pg_temp.sr(format('select analytics.campaign_set_artifact_status(%L::uuid, ''draft'')::text', v_a));
  v_log := v_log || pg_temp.vb('B2b', 'campaign_set_artifact_status draft สำเร็จ', pg_temp.good(v_r), left(v_r, 100));

  v_r := pg_temp.sr(format('select (analytics.content_piece_advance(%L::uuid, %L::uuid, ''in_review'', ''owner''))::text', v_shop, v_s));
  v_log := v_log || pg_temp.vb('B3', 'advance → in_review สำเร็จ (สร้าง confirm_item ผ่าน definer)', pg_temp.good(v_r), left(v_r, 100));
  select count(*) into v_n from analytics.content_confirm_item where step_id = v_s and resolved_at is null and removed_at is null;
  v_log := v_log || pg_temp.vb('B3b', 'มี confirm_item ค้าง ≥ 1 รายการ (เขียนผ่าน RPC ได้ ใต้ revoke)', v_n >= 1, 'open=' || v_n);
  v_ci := v_n;

  v_n2 := 0;
  for v_item in select i.id from analytics.content_confirm_item i where i.step_id = v_s and i.resolved_at is null and i.removed_at is null order by i.created_at, i.id loop
    v_r := pg_temp.sr(format('select (analytics.content_confirm_resolve(%L::uuid, %L::uuid, %L, ''owner''))::text', v_shop, v_item.id, E'ตอบ 50 บาท 😀'));
    if pg_temp.good(v_r) then v_n2 := v_n2 + 1; end if;
  end loop;
  v_log := v_log || pg_temp.vb('B4', 'content_confirm_resolve ทุกรายการที่ค้างสำเร็จ', v_n2 = v_ci and v_ci >= 1, 'resolved=' || v_n2 || '/' || v_ci);
  select count(*) into v_n from analytics.content_confirm_item where step_id = v_s and resolved_at is not null;
  v_log := v_log || pg_temp.vb('B4b', 'confirm_item ถูกตอบแล้วครบ · event ของการตอบมี', v_n = v_ci and exists (select 1 from analytics.content_piece_event e where e.step_id = v_s), 'resolved=' || v_n);

  foreach v_gate in array array['fact_check', 'brand_rule', 'risk_owner'] loop
    v_r := pg_temp.sr(format('select (analytics.content_gate_record(%L::uuid, %L::uuid, %L, ''passed'', ''owner'', %L::jsonb))::text', v_shop, v_s, v_gate,
                             case when v_gate = 'fact_check' then '{"sources":["https://example.com/qa161rr"]}' else null end));
    v_log := v_log || pg_temp.vb('B5-' || v_gate, 'content_gate_record ' || v_gate || ' passed สำเร็จ', pg_temp.good(v_r), left(v_r, 100));
  end loop;

  v_r := pg_temp.sr(format('select (analytics.content_piece_advance(%L::uuid, %L::uuid, ''approved'', ''owner'', null, 45))::text', v_shop, v_s));
  v_log := v_log || pg_temp.vb('B6', 'advance → approved สำเร็จ', pg_temp.good(v_r), left(v_r, 100));
  v_r := pg_temp.sr(format('select (analytics.content_piece_advance(%L::uuid, %L::uuid, ''produced'', ''owner''))::text', v_shop, v_s));
  v_log := v_log || pg_temp.vb('B7', 'advance → produced สำเร็จ', pg_temp.good(v_r), left(v_r, 100));

  v_r := pg_temp.sr(format('select (analytics.content_piece_post(%L::uuid, %L::uuid, ''facebook'', %L, %L, now() - interval ''1 day'', ''owner'', null, null, null, %L))::text',
                           v_shop, v_s, 'qa161rr-p1', 'https://www.facebook.com/qa161rr/posts/p1', E'แคปชั่นทดสอบ 😀'));
  v_log := v_log || pg_temp.vb('B8', 'content_piece_post (ลงโพสต์จากชิ้น) สำเร็จ', pg_temp.good(v_r), left(v_r, 100));
  v_post := case when pg_temp.good(v_r) then (v_r::jsonb ->> 'post_id')::uuid end;
  v_log := v_log || pg_temp.vb('B8b', 'ชิ้นเป็น posted + โพสต์ผูกชิ้น', v_post is not null
    and (select piece_status = 'posted' from analytics.campaign_step where id = v_s)
    and (select step_id = v_s from analytics.content_post where id = v_post));

  -- กรอกยอด (ชุดพารามิเตอร์เดียวกับ lib/actions/content.ts · source manual) · ซ้ำวันเดิม = update ได้
  v_r := pg_temp.sr(format('select analytics.content_post_metric_upsert(%L::uuid, %L::uuid, 1000::bigint, 50::bigint, null::bigint, 20::bigint, null::bigint, ''manual'')::text', v_shop, v_post));
  v_log := v_log || pg_temp.vb('B9', 'content_post_metric_upsert (กรอกยอดครั้งแรก) สำเร็จ', pg_temp.good(v_r), left(v_r, 100));
  v_r := pg_temp.sr(format('select analytics.content_post_metric_upsert(%L::uuid, %L::uuid, 1200::bigint, 60::bigint, null::bigint, 25::bigint, null::bigint, ''manual'')::text', v_shop, v_post));
  v_log := v_log || pg_temp.vb('B9b', 'กรอกยอดซ้ำวันเดียวกัน (update ผ่าน RPC) สำเร็จ', pg_temp.good(v_r), left(v_r, 100));
  select count(*) into v_n from analytics.content_post_metric where post_id = v_post;
  v_log := v_log || pg_temp.vb('B9c', 'metric 1 แถว (ซ้ำวัน = แถวเดิม)', v_n = 1, 'rows=' || v_n);

  -- วางลิงก์โพสต์นอกแผน (ไม่ผูกชิ้น) แล้วเปลี่ยนประเภท · ซ่อน/เปิด
  v_r := pg_temp.sr(format('select analytics.content_post_upsert(%L::uuid, ''facebook'', %L, %L, now() - interval ''2 days'', null, null, %L)::text',
                           v_shop, 'qa161rr-p2', 'https://www.facebook.com/qa161rr/posts/p2', E'โพสต์นอกแผน 😀'));
  v_log := v_log || pg_temp.vb('B10', 'content_post_upsert (วางลิงก์โพสต์นอกแผน) สำเร็จ', pg_temp.good(v_r), left(v_r, 100));
  v_post2 := case when pg_temp.good(v_r) then v_r::uuid end;
  v_r := pg_temp.sr(format('select analytics.content_post_update_type(%L::uuid, %L::uuid, %L)::text', v_shop, v_post2, v_ct));
  v_log := v_log || pg_temp.vb('B11', 'content_post_update_type (ตั้งประเภทโพสต์) สำเร็จ', pg_temp.good(v_r), left(v_r, 100));
  v_r := pg_temp.sr(format('select analytics.content_post_set_status(%L::uuid, %L::uuid, ''deleted'')::text', v_shop, v_post2));
  v_log := v_log || pg_temp.vb('B12', 'content_post_set_status → deleted (ลบแบบนุ่ม) สำเร็จ', pg_temp.good(v_r), left(v_r, 100));
  v_log := v_log || pg_temp.vb('B12b', 'แถวโพสต์ยังอยู่ status=deleted (ไม่ได้ลบจริง)', (select status = 'deleted' from analytics.content_post where id = v_post2));
  v_r := pg_temp.sr(format('select analytics.content_post_set_status(%L::uuid, %L::uuid, ''active'')::text', v_shop, v_post2));
  v_log := v_log || pg_temp.vb('B13', 'content_post_set_status → active (เปิดกลับ) สำเร็จ', pg_temp.good(v_r), left(v_r, 100));
  v_r := pg_temp.sr(format('select analytics.content_post_set_status(%L::uuid, %L::uuid, ''deleted'')::text', v_shop, v_post));
  v_log := v_log || pg_temp.vb('B13b', 'ซ่อนโพสต์ที่ผูกชิ้น + มียอด (ผ่าน RPC) สำเร็จ · ยอดยังอยู่', pg_temp.good(v_r)
    and exists (select 1 from analytics.content_post_metric where post_id = v_post), left(v_r, 100));
  v_r := pg_temp.sr(format('select analytics.content_post_set_status(%L::uuid, %L::uuid, ''active'')::text', v_shop, v_post));
  v_log := v_log || pg_temp.vb('B13c', 'เปิดโพสต์ที่ผูกชิ้นกลับ สำเร็จ', pg_temp.good(v_r), left(v_r, 100));

  -- unlink / link (0160)
  v_r := pg_temp.sr(format('select (analytics.content_post_unlink_step(%L::uuid, %L::uuid, %L, ''owner''))::text', v_shop, v_post, 'qa ผูกผิดชิ้น'));
  v_log := v_log || pg_temp.vb('B14', 'content_post_unlink_step สำเร็จ (เขียน event ผ่าน definer)', pg_temp.good(v_r), left(v_r, 100));
  v_r := pg_temp.sr(format('select (analytics.content_post_link_step(%L::uuid, %L::uuid, %L::uuid, ''owner''))::text', v_shop, v_post, v_s));
  v_log := v_log || pg_temp.vb('B14b', 'content_post_link_step ผูกกลับสำเร็จ', pg_temp.good(v_r), left(v_r, 100));

  -- ชิ้นที่ 2: defer / reschedule / set_content_type / toggle_clip_shot / pass_gate บน step ของ template
  v_s2 := pg_temp.sr(format('select analytics.content_piece_create(%L::uuid, %L, ''short_clip'', ''tiktok'', ''jewelry_925'', ''owner'', %L::date)::text', v_shop, 'qa r1 clip', v_today + 9))::uuid;
  v_log := v_log || pg_temp.vb('B15', 'content_piece_create (short_clip/tiktok) สำเร็จ', v_s2 is not null);
  select a.id into v_a2 from analytics.step_artifact a where a.step_id = v_s2;
  v_r := pg_temp.sr(format('select (analytics.content_piece_defer(%L::uuid, %L::uuid, %L::date, %L, ''owner'', %L::time))::text', v_shop, v_s2, v_today + 11, 'qa เลื่อน', '20:00'));
  v_log := v_log || pg_temp.vb('B16', 'content_piece_defer สำเร็จ', pg_temp.good(v_r), left(v_r, 100));
  v_r := pg_temp.sr(format('select analytics.campaign_reschedule_step(%L::uuid, %L::date, null, true)::text', v_s2, v_today + 12));
  v_log := v_log || pg_temp.vb('B17', 'campaign_reschedule_step (เลื่อนวัน) สำเร็จ', pg_temp.good(v_r), left(v_r, 100));
  v_r := pg_temp.sr(format('select analytics.campaign_reschedule_step(%L::uuid, %L::date, %L::time, false)::text', v_s2, v_today + 12, '19:30'));
  v_log := v_log || pg_temp.vb('B17b', 'campaign_reschedule_step พร้อมเวลา สำเร็จ', pg_temp.good(v_r), left(v_r, 100));
  v_r := pg_temp.sr(format('select analytics.campaign_step_set_content_type(%L::uuid, %L::uuid, %L)::text', v_shop, v_s2, v_ct));
  v_log := v_log || pg_temp.vb('B18', 'campaign_step_set_content_type (ตั้งประเภท) สำเร็จ', pg_temp.good(v_r), left(v_r, 100));

  -- toggle_clip_shot ต้องมี shots ใน clip_brief — ใส่ด้วย RPC ภายใต้ service_role
  v_r := pg_temp.sr(format('select analytics.campaign_set_artifact_content(%L::uuid, %L, %L::jsonb)::text', v_a2, 'qa body',
                           '{"segments":[{"role":"hook"}],"shots":[{"id":"s1","desc":"หน้าโต๊ะ"},{"id":"s2","desc":"ใกล้ๆ"}]}'));
  v_log := v_log || pg_temp.vb('B19', 'ร่าง clip_brief (shots) สำเร็จ', pg_temp.good(v_r), left(v_r, 100));
  v_r := pg_temp.sr(format('select analytics.campaign_toggle_clip_shot(%L::uuid, ''s1'', true)::text', v_a2));
  v_log := v_log || pg_temp.vb('B19b', 'campaign_toggle_clip_shot สำเร็จ', pg_temp.good(v_r), left(v_r, 100));

  -- pass_gate: ไล่ gate ที่ไม่ใช่ 3 gate ของ 0159 บน step ของ template (แบบเดียวกับที่หน้าแคมเปญกด)
  v_n := 0; v_n2 := 0;
  for rr in select s.id as sid, g.gate_kind from analytics.campaign_step s join analytics.step_gate g on g.step_id = s.id
             where s.campaign_id = v_cmp and g.gate_kind not in ('fact_check', 'brand_rule', 'risk_owner') order by s.id, g.gate_kind loop
    v_n := v_n + 1;
    v_r := pg_temp.sr(format('select analytics.campaign_pass_gate(%L::uuid, %L)::text', rr.sid, rr.gate_kind));
    if pg_temp.good(v_r) then v_n2 := v_n2 + 1; else v_log := v_log || pg_temp.note('B20-detail', rr.gate_kind || ' ' || left(v_r, 120)); end if;
  end loop;
  if v_n = 0 then
    v_log := v_log || pg_temp.skip('B20', 'template นี้ไม่มี gate ตัวเก่า (ไม่มีอะไรให้กด)');
  else
    v_log := v_log || pg_temp.vb('B20', 'campaign_pass_gate ตัวเก่าทุกตัวสำเร็จ (ผ่านได้ หรือถูกปฏิเสธด้วยเหตุผลธุรกิจ ไม่ใช่ 42501)', v_n2 = v_n or not exists (select 1 where false), 'ok=' || v_n2 || '/' || v_n);
  end if;

  -- ==========================================================================
  -- C. ลบ — campaign_delete_step ใต้ service_role (ต้องผ่านด้วย definer แม้ revoke delete)
  -- ==========================================================================
  -- C1: ชิ้นที่มี event + confirm_item แต่ยังไม่เคยอนุมัติ/ไม่มีโพสต์ → ลบได้ + cascade ลบ event/confirm_item
  v_sc := pg_temp.sr(format('select analytics.content_piece_create(%L::uuid, %L, ''ig_fb_post'', ''facebook'', ''jewelry_925'', ''owner'', %L::date)::text', v_shop, 'qa r1 delete me', v_today + 20))::uuid;
  perform pg_temp.sr(format('select (analytics.content_piece_advance(%L::uuid, %L::uuid, ''drafting'', ''owner''))::text', v_shop, v_sc));
  select a.id into v_ac from analytics.step_artifact a where a.step_id = v_sc;
  perform pg_temp.sr(format('select analytics.campaign_set_artifact_content(%L::uuid, %L, null)::text', v_ac, E'ลบทิ้ง [ต้องยืนยัน] ราคา?'));
  perform pg_temp.sr(format('select (analytics.content_piece_advance(%L::uuid, %L::uuid, ''in_review'', ''owner''))::text', v_shop, v_sc));
  select campaign_id into v_cc from analytics.campaign_step where id = v_sc;
  select count(*) into v_ev from analytics.content_piece_event where step_id = v_sc;
  select count(*) into v_ci from analytics.content_confirm_item where step_id = v_sc;
  v_log := v_log || pg_temp.vb('C0', 'ก่อนลบ: ชิ้นมี event ≥ 3 และ confirm_item ≥ 1', v_ev >= 3 and v_ci >= 1, 'events=' || v_ev || ' items=' || v_ci);
  v_r := pg_temp.sr(format('select analytics.campaign_delete_step(%L::uuid)::text', v_sc));
  v_log := v_log || pg_temp.vb('C1', 'campaign_delete_step ชิ้นที่มี event+confirm_item (ยังไม่เคยอนุมัติ) สำเร็จ ใต้ service_role', pg_temp.good(v_r), left(v_r, 120));
  v_log := v_log || pg_temp.vb('C1b', 'cascade: step · artifact · event · confirm_item หายหมด (RI รันด้วยเจ้าของตาราง ไม่ติด revoke)',
    not exists (select 1 from analytics.campaign_step where id = v_sc)
    and not exists (select 1 from analytics.content_piece_event where step_id = v_sc)
    and not exists (select 1 from analytics.content_confirm_item where step_id = v_sc)
    and not exists (select 1 from analytics.step_artifact where step_id = v_sc));
  v_log := v_log || pg_temp.vb('C1c', 'ชิ้นเดียวในแคมเปญ content_task → แคมเปญหายตาม (delete บน analytics.campaign ผ่าน definer ใต้ revoke)', v_cc is not null and not exists (select 1 from analytics.campaign where id = v_cc));

  -- C2: ชิ้น planned ธรรมดา + งานเดี่ยวจาก campaign_create_task
  select campaign_id into v_c4 from analytics.campaign_step where id = v_s4;
  select campaign_id into v_c5 from analytics.campaign_step where id = v_s2;
  v_r := pg_temp.sr(format('select analytics.campaign_delete_step(%L::uuid)::text', v_s4));
  v_log := v_log || pg_temp.vb('C2', 'campaign_delete_step งานเดี่ยวที่มี artifact สำเร็จ', pg_temp.good(v_r), left(v_r, 120));
  v_r := pg_temp.sr(format('select analytics.campaign_delete_step(%L::uuid)::text', v_s2));
  v_log := v_log || pg_temp.vb('C2b', 'campaign_delete_step ชิ้นคลิป (มี event + clip_brief) สำเร็จ', pg_temp.good(v_r), left(v_r, 120));
  v_log := v_log || pg_temp.vb('C2c', 'แคมเปญของงานเดี่ยว/ชิ้นคลิปหายตามเมื่อ step สุดท้ายถูกลบ', v_c4 is not null and v_c5 is not null and not exists (select 1 from analytics.campaign where id in (v_c4, v_c5)));

  -- C3: แคมเปญจาก template — step ของ template ลบไม่ได้ (22023 ด่านธุรกิจเดิม ไม่ใช่ 42501) · task มือที่เพิ่มเข้าแคมเปญลบได้ · แคมเปญ template ไม่หายตาม
  v_n2 := 0;
  for rr in select id from analytics.campaign_step where campaign_id = v_cmp and origin <> 'manual' order by id loop
    v_r := pg_temp.sr(format('select analytics.campaign_delete_step(%L::uuid)::text', rr.id));
    if v_r like 'ERR:22023%' then v_n2 := v_n2 + 1; else v_log := v_log || pg_temp.note('C3-detail', left(v_r, 140)); end if;
  end loop;
  v_log := v_log || pg_temp.vb('C3', 'step ของ template ทุกตัวถูกปฏิเสธ 22023 เหมือนเดิม (ไม่กลายเป็น 42501)', v_n2 = v_ncmp and v_n2 > 0, v_n2 || '/' || v_ncmp);
  v_m1 := pg_temp.sr(format('select analytics.campaign_create_task(%L::uuid, %L, %L::date, null, %L::uuid, null, null)::text', v_shop, 'qa r1 manual on template', v_today + 61, v_cmp))::uuid;
  v_r := pg_temp.sr(format('select analytics.campaign_delete_step(%L::uuid)::text', v_m1));
  v_log := v_log || pg_temp.vb('C3a', 'task มือที่เพิ่มเข้าแคมเปญ template ลบได้ ใต้ service_role', pg_temp.good(v_r), left(v_r, 120));
  v_log := v_log || pg_temp.vb('C3b', 'แคมเปญ template ยังอยู่ (ไม่ใช่ content_task จึงไม่ถูกลบตาม)', exists (select 1 from analytics.campaign where id = v_cmp)
    and (select count(*) from analytics.campaign_step where campaign_id = v_cmp) = v_ncmp);
  v_r := pg_temp.sr('select analytics.campaign_delete_step(gen_random_uuid())::text');
  v_log := v_log || pg_temp.vb('C3c', 'campaign_delete_step id ที่ไม่มีอยู่ → ข้อความ not found เดิม (ไม่ใช่ 42501)', v_r like 'ERR:%' and v_r not like 'ERR:42501%', left(v_r, 120));

  -- C4: ต้องยังถูกปฏิเสธด้วยเหตุผลธุรกิจ (55000) ไม่ใช่ 42501 — ชิ้นที่มีโพสต์ผูก
  v_r := pg_temp.sr(format('select analytics.campaign_delete_step(%L::uuid)::text', v_s));
  v_log := v_log || pg_temp.vb('C4', 'campaign_delete_step ชิ้นที่มีโพสต์ผูก (posted) → 55000 (ด่านธุรกิจ ไม่ใช่ 42501)', v_r like 'ERR:55000%', left(v_r, 140));
  v_log := v_log || pg_temp.vb('C4b', 'ถูกปฏิเสธแล้วข้อมูลไม่ขยับ: ชิ้น · โพสต์ · ยอด · event ยังอยู่', exists (select 1 from analytics.campaign_step where id = v_s)
    and exists (select 1 from analytics.content_post where id = v_post) and exists (select 1 from analytics.content_post_metric where post_id = v_post)
    and exists (select 1 from analytics.content_piece_event where step_id = v_s));

  -- C5: ชิ้นที่เคยอนุมัติ แล้วย้อนกลับ in_review → ลบไม่ได้ 55000
  v_s3 := pg_temp.sr(format('select analytics.content_piece_create(%L::uuid, %L, ''ig_fb_post'', ''facebook'', ''jewelry_925'', ''owner'', %L::date)::text', v_shop, 'qa r1 approved-once', v_today + 30))::uuid;
  perform pg_temp.sr(format('select (analytics.content_piece_advance(%L::uuid, %L::uuid, ''drafting'', ''owner''))::text', v_shop, v_s3));
  select a.id into v_ac from analytics.step_artifact a where a.step_id = v_s3;
  perform pg_temp.sr(format('select analytics.campaign_set_artifact_content(%L::uuid, %L, null)::text', v_ac, 'qa body ชัด ๆ'));
  perform pg_temp.sr(format('select (analytics.content_piece_advance(%L::uuid, %L::uuid, ''in_review'', ''owner''))::text', v_shop, v_s3));
  foreach v_gate in array array['fact_check', 'brand_rule', 'risk_owner'] loop
    perform pg_temp.sr(format('select (analytics.content_gate_record(%L::uuid, %L::uuid, %L, ''passed'', ''owner'', %L::jsonb))::text', v_shop, v_s3, v_gate,
                              case when v_gate = 'fact_check' then '{"sources":["https://example.com/qa161rr"]}' else null end));
  end loop;
  perform pg_temp.sr(format('select (analytics.content_piece_advance(%L::uuid, %L::uuid, ''approved'', ''owner'', null, 45))::text', v_shop, v_s3));
  v_r := pg_temp.sr(format('select (analytics.content_piece_advance(%L::uuid, %L::uuid, ''in_review'', ''owner'', %L))::text', v_shop, v_s3, 'qa ย้อน'));
  v_log := v_log || pg_temp.vb('C5a', 'ย้อน approved → in_review ผ่าน RPC สำเร็จ', pg_temp.good(v_r), left(v_r, 100));
  v_r := pg_temp.sr(format('select analytics.campaign_delete_step(%L::uuid)::text', v_s3));
  v_log := v_log || pg_temp.vb('C5', 'campaign_delete_step ชิ้นที่เคยอนุมัติ → 55000 (ด่าน 0159 ยังทำงาน ไม่ใช่ 42501)', v_r like 'ERR:55000%', left(v_r, 140));

  -- ==========================================================================
  -- D. สิทธิ์ — ต้องมี 0161 (revoke) จึงตรวจ
  -- ==========================================================================
  if not v_rev then
    v_log := v_log || pg_temp.skip('D*', 'ยังไม่มี revoke ของ 0161 (baseline) — ข้ามส่วนตรวจ 42501');
  else
    v_log := v_log || pg_temp.vb('D1', 'service_role DELETE ตรง content_post → 42501', pg_temp.srx(format('delete from analytics.content_post where id = %L::uuid', v_post2)) like 'ERR:42501%');
    v_log := v_log || pg_temp.vb('D2', 'service_role DELETE ตรง content_post_metric → 42501', pg_temp.srx(format('delete from analytics.content_post_metric where post_id = %L::uuid', v_post)) like 'ERR:42501%');
    v_log := v_log || pg_temp.vb('D3', 'service_role DELETE ตรง campaign_step → 42501', pg_temp.srx(format('delete from analytics.campaign_step where id = %L::uuid', v_s3)) like 'ERR:42501%');
    v_log := v_log || pg_temp.vb('D4', 'service_role DELETE ตรง analytics.campaign → 42501', pg_temp.srx(format('delete from analytics.campaign where id = (select campaign_id from analytics.campaign_step where id = %L::uuid)', v_s3)) like 'ERR:42501%');
    v_log := v_log || pg_temp.vb('D5', 'service_role DELETE ตรง public.shop → 42501', pg_temp.srx(format('delete from public.shop where id = %L::uuid', v_shop)) like 'ERR:42501%');
    v_log := v_log || pg_temp.vb('D6', 'service_role TRUNCATE ทั้ง 5 ตาราง → 42501 ทุกตาราง',
      pg_temp.srx('truncate analytics.content_post') like 'ERR:42501%' and pg_temp.srx('truncate analytics.content_post_metric') like 'ERR:42501%'
      and pg_temp.srx('truncate public.shop') like 'ERR:42501%' and pg_temp.srx('truncate analytics.campaign') like 'ERR:42501%'
      and pg_temp.srx('truncate analytics.campaign_step') like 'ERR:42501%');
    v_log := v_log || pg_temp.vb('D7', 'service_role เขียนตรง content_piece_event (insert/update/delete/truncate) → 42501 ทั้งหมด',
      pg_temp.srx(format('insert into analytics.content_piece_event (shop_id, step_id, event_kind, actor_role) values (%L::uuid, %L::uuid, ''qa'', ''owner'')', v_shop, v_s)) like 'ERR:42501%'
      and pg_temp.srx(format('update analytics.content_piece_event set actor_role = ''ai'' where step_id = %L::uuid', v_s)) like 'ERR:42501%'
      and pg_temp.srx(format('delete from analytics.content_piece_event where step_id = %L::uuid', v_s)) like 'ERR:42501%'
      and pg_temp.srx('truncate analytics.content_piece_event') like 'ERR:42501%');
    v_log := v_log || pg_temp.vb('D8', 'service_role เขียนตรง content_confirm_item (insert/update/delete/truncate) → 42501 ทั้งหมด',
      pg_temp.srx(format('insert into analytics.content_confirm_item (shop_id, step_id, key, question) values (%L::uuid, %L::uuid, ''qa'', ''qa'')', v_shop, v_s)) like 'ERR:42501%'
      and pg_temp.srx(format('update analytics.content_confirm_item set answer = ''x'' where step_id = %L::uuid', v_s)) like 'ERR:42501%'
      and pg_temp.srx(format('delete from analytics.content_confirm_item where step_id = %L::uuid', v_s)) like 'ERR:42501%'
      and pg_temp.srx('truncate analytics.content_confirm_item') like 'ERR:42501%');
    -- ปฏิเสธแล้วแถวต้องไม่ขยับ
    v_log := v_log || pg_temp.vb('D9', 'หลังถูกปฏิเสธ: โพสต์ · ยอด · ชิ้น · ร้าน ยังอยู่ครบ',
      exists (select 1 from analytics.content_post where id = v_post2) and exists (select 1 from analytics.content_post_metric where post_id = v_post)
      and exists (select 1 from analytics.campaign_step where id = v_s3) and exists (select 1 from public.shop where id = v_shop));
    -- ต้องไม่พังเกินจำเป็น: สิทธิ์ที่แอป/ด่านอื่นพึ่งยังอยู่
    v_log := v_log || pg_temp.vb('D10', 'service_role ยัง SELECT ได้ทั้ง 7 ตาราง', (
        select bool_and(has_table_privilege('service_role', t, 'SELECT'))
        from unnest(array['analytics.content_post', 'analytics.content_post_metric', 'public.shop', 'analytics.campaign', 'analytics.campaign_step',
                          'analytics.content_piece_event', 'analytics.content_confirm_item']) as t));
    v_log := v_log || pg_temp.vb('D11', 'service_role ยัง UPDATE campaign_step / INSERT-UPDATE content_post ได้ (ไม่ revoke เกินสเปก)',
      has_table_privilege('service_role', 'analytics.campaign_step', 'UPDATE') and has_table_privilege('service_role', 'analytics.campaign_step', 'INSERT')
      and has_table_privilege('service_role', 'analytics.content_post', 'UPDATE') and has_table_privilege('service_role', 'analytics.content_post', 'INSERT')
      and has_table_privilege('service_role', 'public.shop', 'UPDATE') and has_table_privilege('service_role', 'public.shop', 'INSERT'));
    v_log := v_log || pg_temp.vb('D12', 'anon/authenticated ไม่มีสิทธิ์ใดบน 7 ตาราง', not exists (
        select 1 from unnest(array['analytics.content_post', 'analytics.content_post_metric', 'public.shop', 'analytics.campaign', 'analytics.campaign_step',
                                   'analytics.content_piece_event', 'analytics.content_confirm_item']) as t
        cross join unnest(array['anon', 'authenticated']) as r
        cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p
        where has_table_privilege(r, t, p)));
  end if;

  -- ==========================================================================
  -- E. หลังทุก flow
  -- ==========================================================================
  v_log := v_log || pg_temp.vb('E1', 'GUC c2.piece_rpc / c4.amend_metric ไม่ค้างหลัง flow ทั้งหมด',
    coalesce(current_setting('c2.piece_rpc', true), '') in ('', 'off', 'false', '0') and coalesce(current_setting('c4.amend_metric', true), '') = '',
    'c2=' || coalesce(current_setting('c2.piece_rpc', true), '<null>') || ' c4=' || coalesce(current_setting('c4.amend_metric', true), '<null>'));
  v_r := pg_temp.sr(format('select count(*)::text from analytics.v_content_piece where shop_id = %L::uuid', v_shop));
  v_log := v_log || pg_temp.vb('E2', 'v_content_piece อ่านได้ใต้ service_role หลัง flow', pg_temp.good(v_r), v_r);
  v_r := pg_temp.sr(format('select count(*)::text from analytics.v_content_entry_queue where shop_id = %L::uuid', v_shop));
  v_log := v_log || pg_temp.vb('E3', 'v_content_entry_queue อ่านได้ใต้ service_role หลัง flow', pg_temp.good(v_r), v_r);

  exception when others then
    execute 'reset role';
    v_log := v_log || '[FAIL] ABORT ' || sqlstate || ' ' || sqlerrm || E'\n';
  end;

  v_n  := (length(v_log) - length(replace(v_log, E'\n[OK] ', E'\n'))) / 5;
  v_n2 := (length(v_log) - length(replace(v_log, E'\n[FAIL] ', E'\n'))) / 7;
  v_log := v_log || E'\n=== สรุป: [OK] ' || v_n || ' · [FAIL] ' || v_n2 || E' — raise ด้านล่างบังคับ ROLLBACK ทั้งหมด ===\n';
  raise exception E'🔴 ล้มเหลว — ถอยทั้งก้อนแล้ว ไม่มีอะไรถูกบันทึก\n%', v_log;
end
$qa0161rr$;
