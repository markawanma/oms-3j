-- scripts/verify/verify-0161.sql
-- ตรวจ supabase/migrations/0161_content_measure_amend_result.sql หลัง apply (หรือต่อท้าย 0161 ใน dry-run เดียว)
-- self-rolling-back do-block ตาม 3j-migration-traps #11: ทุกเคสเก็บผลลง v_log แล้ว raise exception ปิดท้ายเสมอ ⇒ ทั้งทรานแซกชัน rollback ·
-- ผลทดสอบออกทาง error message · DB ไม่ขยับ ไม่ว่า PASS หรือ FAIL (ร้านทดสอบ B/C/X + ข้อมูลทดสอบสร้างในทรานแซกชันแล้วหายพร้อม rollback)
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0161.sql
-- dry-run ก่อน apply: cat supabase/migrations/0161_*.sql scripts/verify/verify-0161.sql > tmp.sql แล้วรันแบบไม่ใส่ --commit
-- ผล: run-sql พิมพ์ "ล้มเหลว" พร้อม message = v_log (ช่องทางรายงานผลปกติ) · [FAIL] ≥ 1 = ไม่ผ่าน · [SKIP] = พิสูจน์ในไฟล์นี้ไม่ได้ (บอกเหตุผลไว้)
--
-- ⚠️ ข้อมูลจริงไม่ถูกแก้ — ทุกเคสที่เขียน/แก้ใช้แถวของร้านทดสอบ B/C/X ที่สร้างเอง · ส่วนที่อ่านข้อมูลจริงเป็น select ล้วน (ร้านจริงต้องมีร้านเดียวใน public.shop)
-- ⚠️ pin ค่าจริงที่ต้องมารู้ที่นี่ก่อนเมื่อมีคนแก้ของเดิม: md5(prosrc) ของ content_post_metric_upsert (0148 · N4g) · md5(viewdef) ของ v_content_post_t7 /
--    v_content_entry_queue / v_content_hook_library (N2b) — แก้ของเหล่านั้น = ต้องอัปเดตค่า pin + ตรวจ helper content_post_metric_regression_ /
--    v_content_post_missed_window ว่ายังเท่ากัน (D22 · N3) · 0162 ลงแล้วถ้าแตะ 3 view นั้นต้องอัปเดต pin
--
-- ============ ตารางแมป "เคสในสเปก §13.7/§13.8/§13.x (+ metric ออเดอร์) → assertion" (id ใน log) ============
--  Y1  amend actor ai/system/ไม่รู้จัก/null                    → Y1a-d
--  Y2  p_set ผิดรูป 14 แบบ + SQL null + ชื่อ key ในข้อความ       → Y2a-p · 1e3 ผ่านเป็น 1000 (ตัดสินใจ G) → G1
--  Y3  reason ว่าง/2 ตัว/ZWSP/ช่องว่าง/marker×2/null            → Y3a-g
--  Y4  วันที่: พรุ่งนี้/infinity/-infinity/-31/ไม่มีแถว×2 + ขอบ -30 → Y4a-g
--  Y5  ล้างครบ 5 ช่อง → Y5 · Y6 ค่าเท่าเดิม → Y6a-b · Y7 deleted/ร้านอื่น/สุ่ม → Y7a-c · reject แล้วไม่เขียนอะไร → Y7z · Y7y
--  Y8  service_role update/delete/insert ตรงบน metric          → Y8a-i (+ ต้องไม่พัง Y8j-m: update raw/captured_at/source เฉยๆ · insert ตรงไม่มีธง)
--  Y9→Q9 (มติ Q9 ทับสเปกเดิม) tiktok_api ทับค่าที่แก้มือ = ทับได้ + log api_override + ถอดธง → Q9a-k (ไม่ใช่ "ล็อก") · N4a บนแถวไม่เคย amend
--  Y10 amend_log update/delete/truncate/insert ตรง/CHECK       → Y10a-f2 · cascade ลบโพสต์ผ่านทั้งสอง guard → Y10g-h · ลบ metric ที่มี log → Q9j-k
--  Y11 verdict_confirm ปฏิเสธ 12 แบบ + ไม่เขียนอะไร              → Y11a-l · Y11z
--  Y12 service_role แก้/insert result_* · postgres ตั้ง override ขาด confirmed_at → Y12a-c · ต้องไม่พัง Y12d-e · CHECK อื่น → A6a-e
--  Y23 RPC ใหม่ + helper + view + ตาราง จาก role authenticated (grant usage ชั่วคราว) → Y23a-c
--  Y24 helper เท่ากับ is_regression ของทุกแถวจริง + fixture      → Y24a-b · N4e · N5n
--  N1  ข้อมูลเดิมไม่ขยับ (amended_cols ว่าง · result_* null)    → N1a-c (ด่านท้ายไฟล์ migration เทียบ md5 ทุกตาราง ตอน apply)
--  N2  view เดิม 8 ตัวยัง select ได้ + pin md5 ของ 3 ตัวที่ 0161 พึ่ง → N2a-c
--  N3  missed_window ใช้ตารางหน้าต่างเดียวกับ entry_queue + ไม่ทับกัน + fixture 5 โพสต์ → N3a-i
--  N4  content_post_metric_upsert ทุกโหมดเดิม + pin md5          → N4a-g
--  N5  flow amend: แก้แถววันก่อน ⇒ is_regression แถวหลังพลิก · กลับ · log before/after ครบ 5 คอลัมน์ → N5a-n
--  N6  rollup: verdict = type_verdict ของ library · 3/4 ชิ้น · ชิ้นเดียว 2 โพสต์ · ไม่มีโฮสต์ (Q11 → A5) → N6a-k
--  N7  v_content_post_result: ป้ายตาม quartile (คำนวณมือ) · ป้ายนิ่ง · ฐาน<4 · deleted ไม่อยู่ · confirm/ซ้ำ/เปลี่ยนใจ/CAS/บทเรียน→signal → N7a-s
--  N17 pg_proc ต่อชื่อ = 1 · ไม่มี \r ใน body ฟังก์ชัน (idempotent 2 รอบ = dry-run แยก)  → N17a-b
--  N18 ไม่มี current_date · Asia/Bangkok ทุกจุดที่คิดวัน         → N18a-c
--  O   metric ออเดอร์: helper+CHECK รับ 'orders' · ค่าผิดยังถูกปฏิเสธ · set_plan ใช้จริง · view นับถูกตามช่องทาง/affinity/ตะกร้าผสม · ข้อมูลจริงนับครบ → O1-O9
--  P   ข้อมูลจริงห้ามขยับ: แคมเปญ 10.10 (step a74aa1f1…)          → P1
--  A   โครงสร้าง/สิทธิ์/overload/trigger/ไม่มีโฮสต์/CHECK           → A1-A6
--  ไม่ครอบ (บอกตรงๆ): ท้ายไฟล์ [SKIP]
--
-- ============ mutant ที่ทำให้ verify ล้มจริง (ลองแล้ว 25 แบบ — V = verify จับ · G = ด่านท้ายไฟล์ migration จับก่อน) ============
--  ถอดด่าน actor owner ใน amend → Y1a/b V · ถอดด่าน 30 วัน → Y4d V · ถอดด่านล้างครบทุกช่อง → Y5 V · ปิด guard service_role (v_direct=false) → Y8a-i V ·
--  ไม่คิด is_regression แถววันหลัง → N5b/c/g V · ไม่เขียน log ตอน API ทับ → Q9d/e/h/i V · ไม่ถอดธง amended_cols หลัง API ทับ → Q9d/h/i V ·
--  baseline รวมโพสต์ตัวเอง/หลัง → N7b-e V · limit ฐาน 10 → 3 → N7d/e/f/h V · rollup ไม่ distinct step → N6j V · view ออเดอร์นับตาม line item → O4/O5/O7 V ·
--  ถอด guard result_* → Y12a-c V · ถอด compare-and-set → Y11i/j V · reason ไม่ผ่าน content_text_clean → Y3c V · log append-only ปิด cascade → Y10g/Q9j V ·
--  helper ใช้ <= แทน < → N5b/c/g/i V · missed ไม่ตรวจ num_nonnulls → N3b/f V · ถอดด่าน T+7 ของ confirm → Y11e V · ถอด where status ของ amend → Y7a V ·
--  ถอด shop scope ของ amend → Y7b V · ถอด whitelist key → Y2d/e/p V · service_role ได้เขียน amend_log → G (+ A3c V) · CHECK/enum ไม่รับ orders → G (+ O1/O2 V)
--  ⚠️ mutant ที่ "ไม่ล้าง" = เทียบเท่า: ถอดเงื่อนไข "โพสต์แม่หายแล้ว" ใน guard DELETE ของ metric — RI trigger รันด้วยสิทธิ์เจ้าของตาราง จึงไม่เคยเห็น current_user=service_role
--     (ตัดเงื่อนไขทิ้งแล้ว · Y10g พิสูจน์ว่า cascade ผ่าน) · mutant "where p.status='active' → true" ของผลต่อโพสต์ เคยหลุด → เพิ่ม N7s

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

-- รัน p_sql ภายใต้ role จริง (set local role) · reset role ทุกทาง
create or replace function pg_temp.vr(p_role text, p_sql text, p_expect text[], p_like text default null) returns text
 language plpgsql as $vr$
declare v_res text;
begin
  execute format('set local role %I', p_role);
  v_res := pg_temp.vx(p_sql, p_expect, p_like);
  execute 'reset role';
  return v_res;
exception when others then
  execute 'reset role';
  raise;
end $vr$;

create or replace function pg_temp.vro(p_role text, p_sql text) returns text
 language plpgsql as $vro$
declare v_res text;
begin
  execute format('set local role %I', p_role);
  v_res := pg_temp.vok(p_sql);
  execute 'reset role';
  return v_res;
exception when others then
  execute 'reset role';
  raise;
end $vro$;

-- โพสต์ทดสอบผ่าน content_post_upsert จริง (definer) · posted_at = now() - p_days_ago วัน · platform tiktok
create or replace function pg_temp.mkpost(p_shop uuid, p_days_ago int) returns uuid
 language plpgsql as $mp$
declare v_ext text := 'v161-' || substr(gen_random_uuid()::text, 1, 12);
begin
  return analytics.content_post_upsert(p_shop, 'tiktok', v_ext, 'https://www.tiktok.com/@verify161/video/' || v_ext,
                                       now() - make_interval(days => p_days_ago), null, null, null);
end $mp$;

-- แถว metric ทดสอบแบบกำหนดวัน (insert ตรงโดย postgres — ผ่าน guard เพราะไม่ใช่ role ภายนอก) · age_days = captured_on - posted_date_th
create or replace function pg_temp.mkmet(p_post uuid, p_cap date, p_view bigint, p_like bigint, p_comment bigint, p_save bigint, p_share bigint,
                                         p_reg boolean default false) returns uuid
 language plpgsql as $mm$
declare v_id uuid;
begin
  insert into analytics.content_post_metric (shop_id, post_id, captured_on, age_days, view_count, like_count, comment_count, save_count, share_count,
                                             source, sources, is_regression)
  select p.shop_id, p.id, p_cap, p_cap - p.posted_date_th, p_view, p_like, p_comment, p_save, p_share, 'manual', array['manual'], p_reg
    from analytics.content_post p where p.id = p_post
  returning id into v_id;
  return v_id;
end $mm$;

create or replace function pg_temp.q_amend(p_shop uuid, p_post uuid, p_cap text, p_set text, p_reason text, p_role text) returns text
 language sql as $q$
  select format('select analytics.content_post_metric_amend(%L::uuid,%L::uuid,%L::date,%L::jsonb,%L,%L)', p_shop, p_post, p_cap, p_set, p_reason, p_role)
$q$;

create or replace function pg_temp.q_verdict(p_shop uuid, p_post uuid, p_label text, p_lesson text, p_role text, p_exp text default null) returns text
 language sql as $q$
  select format('select analytics.content_post_verdict_confirm(%L::uuid,%L::uuid,%L,%L,%L,%L)', p_shop, p_post, p_label, p_lesson, p_role, p_exp)
$q$;

-- ภาพรวมแถว metric ของโพสต์ + จำนวน log (ไว้เทียบว่า "reject แล้วไม่เขียนอะไร")
create or replace function pg_temp.msnap(p_post uuid) returns text
 language sql as $sn$
  select (select count(*) || ':' || md5(coalesce(string_agg(concat_ws('|', id, captured_on, view_count, like_count, comment_count, save_count, share_count,
            is_regression, source, array_to_string(sources, ','), array_to_string(amended_cols, ',')), ',' order by id), ''))
          from analytics.content_post_metric where post_id = p_post)
      || '/' || (select count(*) from analytics.content_post_metric_amend_log where post_id = p_post)
$sn$;

create or replace function pg_temp.ext() returns text
 language sql as $ex$ select 'v161-' || substr(gen_random_uuid()::text, 1, 12) $ex$;

create or replace function pg_temp.url(p_ext text default null) returns text
 language sql as $ur$ select 'https://www.tiktok.com/@verify161/video/' || coalesce(p_ext, substr(gen_random_uuid()::text, 1, 12)) $ur$;

-- สร้างชิ้นงานทดสอบผ่าน RPC จริง (create → drafting → [hook A/B + เนื้อหา] → in_review) — ลอกจาก verify-0160
create or replace function pg_temp.mk_step(p_shop uuid, p_kind text, p_channel text) returns uuid
 language plpgsql as $mk$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_s     uuid;
  v_a     uuid;
begin
  v_s := analytics.content_piece_create(p_shop, 'verify-0161 ' || substr(gen_random_uuid()::text, 1, 8), p_kind, p_channel,
                                        'jewelry_925', 'owner', v_today + 5);
  perform analytics.content_piece_advance(p_shop, v_s, 'drafting', 'owner');
  select a.id into v_a from analytics.step_artifact a where a.step_id = v_s;
  perform analytics.content_hook_upsert(p_shop, v_s, 'A', 'verify hook A', 'question', null, 'owner', null);
  perform analytics.content_hook_upsert(p_shop, v_s, 'B', 'verify hook B', 'fact', null, 'owner', null);
  perform analytics.campaign_set_artifact_content(v_a, 'verify body',
    jsonb_build_object('segments', jsonb_build_array(jsonb_build_object('role', 'hook')),
                       'shots', jsonb_build_array(jsonb_build_object('id', 's1', 'desc', 'ถ่ายหน้าโต๊ะ'),
                                                  jsonb_build_object('id', 's2', 'desc', 'ใกล้ๆ'))));
  perform analytics.content_piece_advance(p_shop, v_s, 'in_review', 'owner');
  return v_s;
end $mk$;

create or replace function pg_temp.mk_produced(p_shop uuid) returns uuid
 language plpgsql as $ma$
declare v_s uuid;
begin
  v_s := pg_temp.mk_step(p_shop, 'short_clip', 'tiktok');
  perform analytics.content_gate_record(p_shop, v_s, 'fact_check', 'passed', 'owner',
    jsonb_build_object('sources', jsonb_build_array('https://example.com/a')));
  perform analytics.content_gate_record(p_shop, v_s, 'brand_rule', 'passed', 'owner');
  perform analytics.content_gate_record(p_shop, v_s, 'risk_owner', 'passed', 'owner');
  perform analytics.content_piece_advance(p_shop, v_s, 'approved', 'owner', null, 45);
  perform analytics.content_piece_advance(p_shop, v_s, 'produced', 'owner');
  return v_s;
end $ma$;

-- ออเดอร์ทดสอบ (insert ตรงโดย postgres · ร้าน B) พร้อม line item ตามรายการ product_id ที่ส่งมา · p_prods ว่าง = ออเดอร์ไม่มี line item
create or replace function pg_temp.mkord(p_shop uuid, p_channel uuid, p_day date, p_prods uuid[]) returns uuid
 language plpgsql as $mo$
declare
  v_id uuid;
  v_p  uuid;
begin
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
  values (p_shop, 'V161-' || substr(gen_random_uuid()::text, 1, 12), p_channel, p_day, 100)
  returning id into v_id;
  foreach v_p in array coalesce(p_prods, '{}'::uuid[]) loop
    insert into analytics.fact_order_item (shop_id, fact_order_id, product_id, qty, unit_price) values (p_shop, v_id, v_p, 1, 100);
  end loop;
  return v_id;
end $mo$;

do $verify0161$
declare
  v_log     text := E'\n=== verify-0161 ===\n';
  v_today   date := (now() at time zone 'Asia/Bangkok')::date;
  v_shop    uuid;
  v_shopB   uuid;
  v_shopC   uuid;
  v_shopX   uuid;
  v_n       bigint;
  v_n2      bigint;
  v_r       text;
  v_t       text;
  v_bad     text;
  v_j       jsonb;
  v_j2      jsonb;
  v_b       boolean;
  v_s1      text;
  v_s2      text;
  v_d0      date;
  v_p1      uuid;   -- โพสต์หลักของ flow amend (M1-M3)
  v_p2      uuid;
  v_p3      uuid;
  v_p4      uuid;
  v_p5      uuid;
  v_p6      uuid;
  v_p7      uuid;
  v_pa      uuid;
  v_pb      uuid;
  v_pc      uuid;
  v_pd      uuid;
  v_m1      uuid;
  v_m2      uuid;
  v_m3      uuid;
  v_mx      uuid;
  v_id      uuid;
  v_id2     uuid;
  v_sig     uuid;
  v_sig2    uuid;
  v_step    uuid;
  v_hookA   uuid;
  v_prod_bar uuid;
  v_prod_jw  uuid;
  v_prod_nt  uuid;
  v_ch_line  uuid;
  v_ch_tt    uuid;
  v_day     date;
  v_k       text;
  v_ext1    text;
  v_i       int;
  v_posts   uuid[] := '{}';
  v_save    int[] := array[10, 20, 30, 40, 25, 50, 1];
  r         record;
  r2        record;
  v_fail    int;
  v_ok      int;
begin
  begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);

  select count(*) into v_n from public.shop;
  if v_n <> 1 then
    raise exception 'verify-0161: ต้องมีร้านเดียวใน public.shop (พบ %) — ทดสอบไม่ได้', v_n;
  end if;
  select id into v_shop from public.shop;
  insert into public.shop (name) values ('verify-0161 shop B') returning id into v_shopB;
  insert into public.shop (name) values ('verify-0161 shop C') returning id into v_shopC;
  insert into public.shop (name) values ('verify-0161 shop X') returning id into v_shopX;

  ----------------------------------------------------------------------------
  -- A. โครงสร้าง / สิทธิ์ / overload / วันไทย / ไม่มีโฮสต์
  ----------------------------------------------------------------------------
  select count(*) into v_n from pg_proc p where p.pronamespace = 'analytics'::regnamespace
     and p.proname in ('content_post_metric_regression_', 'content_post_metric_guard', 'content_post_metric_amend_log_append_only',
                       'content_post_result_guard', 'content_post_metric_amend', 'content_post_verdict_confirm');
  v_log := v_log || pg_temp.vb('A1', 'ฟังก์ชันของ 0161 มี 6 ตัว (helper 1 + trigger 3 + RPC 2) signature เดียวต่อชื่อ (trap #1)', v_n = 6, 'พบ ' || v_n);
  select count(*) into v_n from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'content_piece_enum_ok_';
  v_log := v_log || pg_temp.vb('A1b', 'content_piece_enum_ok_ ยังมี signature เดียว (replace ไม่ใช่ overload)', v_n = 1, 'พบ ' || v_n);

  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.pronamespace = 'analytics'::regnamespace and a.privilege_type = 'EXECUTE'
     and p.proname in ('content_post_metric_regression_', 'content_post_metric_guard', 'content_post_metric_amend_log_append_only',
                       'content_post_result_guard', 'content_post_metric_amend', 'content_post_verdict_confirm', 'content_piece_enum_ok_')
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  v_log := v_log || pg_temp.vb('A2', 'ไม่มี PUBLIC/anon/authenticated ถือ EXECUTE บนฟังก์ชันของ 0161 (trap #18 · aclexplode+acldefault)', v_bad is null, coalesce(v_bad, '-'));
  select count(*) into v_n from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and has_function_privilege('service_role', p.oid, 'execute')
     and p.proname in ('content_post_metric_regression_', 'content_post_metric_amend', 'content_post_verdict_confirm', 'content_piece_enum_ok_');
  v_log := v_log || pg_temp.vb('A2b', 'service_role เรียกได้: helper + RPC 2 + enum_ok_', v_n = 4, 'พบ ' || v_n);

  select string_agg(c.relname, ', ') into v_bad
    from pg_class c
   where c.relnamespace = 'analytics'::regnamespace
     and c.relname in ('v_content_post_missed_window', 'v_content_post_result', 'v_content_hook_type_rollup', 'v_content_order_daily')
     and not coalesce(c.reloptions @> array['security_invoker=true'], false);
  v_log := v_log || pg_temp.vb('A3', 'view ใหม่ 4 ตัวเป็น security_invoker', v_bad is null, coalesce(v_bad, '-'));
  select string_agg(c.relname || ':' || case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ', ') into v_bad
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.relnamespace = 'analytics'::regnamespace
     and c.relname in ('v_content_post_missed_window', 'v_content_post_result', 'v_content_hook_type_rollup', 'v_content_order_daily', 'content_post_metric_amend_log')
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  v_log := v_log || pg_temp.vb('A3b', 'ไม่มี PUBLIC/anon/authenticated บน view ใหม่ + ตาราง amend_log', v_bad is null, coalesce(v_bad, '-'));
  select string_agg(a.privilege_type, ',') into v_bad
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.oid = 'analytics.content_post_metric_amend_log'::regclass and a.grantee = 'service_role'::regrole and a.privilege_type <> 'SELECT';
  v_log := v_log || pg_temp.vb('A3c', 'service_role เขียนตรงลง amend_log ไม่ได้ (มีแค่ SELECT)', v_bad is null, coalesce(v_bad, '-'));
  v_log := v_log || pg_temp.vb('A3d', 'amend_log เปิด RLS', (select c.relrowsecurity from pg_class c where c.oid = 'analytics.content_post_metric_amend_log'::regclass));

  select count(*) into v_n from pg_trigger t where t.tgrelid = 'analytics.content_post'::regclass and not t.tgisinternal and t.tgenabled = 'O';
  v_log := v_log || pg_temp.vb('A4', 'content_post มี trigger เปิดอยู่ 3 ตัว (link_guard · result_guard · updated_at) — ของ 0160 ไม่ถูกแทน', v_n = 3, 'พบ ' || v_n);
  select count(*) into v_n from pg_trigger t where t.tgrelid = 'analytics.content_post_metric'::regclass and not t.tgisinternal and t.tgenabled = 'O'
     and t.tgname = 'trg_content_post_metric_guard';
  v_log := v_log || pg_temp.vb('A4b', 'content_post_metric มี trg_content_post_metric_guard (ตารางนี้ไม่เคยมี trigger มาก่อน)', v_n = 1);

  select count(*) into v_n from information_schema.columns
   where table_schema = 'analytics' and table_name in ('v_content_post_result', 'v_content_hook_type_rollup') and column_name ~* 'host';
  v_log := v_log || pg_temp.vb('A5', 'ผลต่อโพสต์/rollup ไม่มีคอลัมน์โฮสต์เลย (มติ Q11)', v_n = 0, 'พบ ' || v_n);

  -- CHECK ระดับตาราง (postgres ตรง — ด่านถัดไปจากชนิดข้อมูล)
  select id into v_id from analytics.content_post_metric limit 1;
  if v_id is not null then
    v_log := v_log || pg_temp.vl('A6a', 'amended_cols มีชื่อนอก 5 คอลัมน์ → CHECK',
      pg_temp.vx(format('update analytics.content_post_metric set amended_cols = %L::text[] where id = %L', '{foo}', v_id), array['23514']));
  else
    v_log := v_log || E'[SKIP] A6a ไม่มีแถว metric ให้ลอง\n';
  end if;
  select id into v_id from analytics.content_post limit 1;
  v_log := v_log || pg_temp.vl('A6b', 'result_label_override = great → CHECK',
    pg_temp.vx(format('update analytics.content_post set result_label_override = %L, result_confirmed_at = now(), result_confirmed_by_role = %L where id = %L', 'great', 'owner', v_id), array['23514']));
  v_log := v_log || pg_temp.vl('A6c', 'result_confirmed_by_role = ai → CHECK',
    pg_temp.vx(format('update analytics.content_post set result_label_override = %L, result_confirmed_at = now(), result_confirmed_by_role = %L where id = %L', 'above', 'ai', v_id), array['23514']));
  v_log := v_log || pg_temp.vl('A6d', 'result_lesson ยาว 501 → CHECK',
    pg_temp.vx(format('update analytics.content_post set result_label_override = %L, result_confirmed_at = now(), result_confirmed_by_role = %L, result_lesson = repeat(%L, 501) where id = %L', 'above', 'owner', 'ก', v_id), array['23514']));
  v_log := v_log || pg_temp.vl('A6e', 'result_lesson มีแต่ไม่มีป้าย → CHECK (consistency)',
    pg_temp.vx(format('update analytics.content_post set result_lesson = %L where id = %L', 'x', v_id), array['23514']));

  ----------------------------------------------------------------------------
  -- fixture: โพสต์ P1 ของร้าน B (โพสต์ 12 วันก่อน) + metric M1-M3 อายุ 4/5/6 วัน
  --   M1 view 1000 like 50 save 10 · M2 view 1500 like 80 save 20 · M3 view 1400 (ต่ำกว่า M2 ⇒ regression true) like 80 save 25
  ----------------------------------------------------------------------------
  v_p1 := pg_temp.mkpost(v_shopB, 12);
  select posted_date_th into v_d0 from analytics.content_post where id = v_p1;
  v_m1 := pg_temp.mkmet(v_p1, v_d0 + 4, 1000, 50, null, 10, null, false);
  v_m2 := pg_temp.mkmet(v_p1, v_d0 + 5, 1500, 80, null, 20, null, false);
  v_m3 := pg_temp.mkmet(v_p1, v_d0 + 6, 1400, 80, null, 25, null, true);

  ----------------------------------------------------------------------------
  -- Y1-Y7: amend ต้องถูกปฏิเสธ (ยิงบน M2 · ชุดค่าที่ "ถูก" = {"save_count": 21} ⇒ ถ้าตกจะตกเพราะข้อที่ทดสอบเท่านั้น)
  ----------------------------------------------------------------------------
  v_s1 := pg_temp.msnap(v_p1);
  v_log := v_log || pg_temp.vl('Y1a', 'amend actor ai', pg_temp.vx(pg_temp.q_amend(v_shopB, v_p1, (v_d0 + 5)::text, '{"save_count": 21}', 'verify เหตุผลทดสอบ', 'ai'), array['42501']));
  v_log := v_log || pg_temp.vl('Y1b', 'amend actor system', pg_temp.vx(pg_temp.q_amend(v_shopB, v_p1, (v_d0 + 5)::text, '{"save_count": 21}', 'verify เหตุผลทดสอบ', 'system'), array['42501']));
  v_log := v_log || pg_temp.vl('Y1c', 'amend actor assistant (ไม่รู้จัก)', pg_temp.vx(pg_temp.q_amend(v_shopB, v_p1, (v_d0 + 5)::text, '{"save_count": 21}', 'verify เหตุผลทดสอบ', 'assistant'), array['22023']));
  v_log := v_log || pg_temp.vl('Y1d', 'amend actor null', pg_temp.vx(pg_temp.q_amend(v_shopB, v_p1, (v_d0 + 5)::text, '{"save_count": 21}', 'verify เหตุผลทดสอบ', null), array['22023']));

  v_i := 0;
  foreach v_k in array array['[]', '{}', 'null', '{"saves": 5}', '{"view": 1}', '{"save_count": "12"}', '{"save_count": 12.5}', '{"save_count": 1.0}',
                             '{"save_count": -1}', '{"view_count": true}', '{"save_count": [1]}', '{"save_count": {"a": 1}}',
                             '{"save_count": 10000000000000}', '{"save_count": 1000000000001}'] loop
    v_i := v_i + 1;
    v_log := v_log || pg_temp.vl('Y2' || chr(96 + v_i), 'p_set ผิดรูป ' || v_k,
      pg_temp.vx(pg_temp.q_amend(v_shopB, v_p1, (v_d0 + 5)::text, v_k, 'verify เหตุผลทดสอบ', 'owner'), array['22023']));
  end loop;
  v_log := v_log || pg_temp.vl('Y2o', 'p_set เป็น SQL NULL',
    pg_temp.vx(format('select analytics.content_post_metric_amend(%L::uuid,%L::uuid,%L::date,null::jsonb,%L,%L)', v_shopB, v_p1, v_d0 + 5, 'verify เหตุผลทดสอบ', 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('Y2p', 'key ผิดต้องระบุชื่อ key ในข้อความ',
    pg_temp.vx(pg_temp.q_amend(v_shopB, v_p1, (v_d0 + 5)::text, '{"saves": 5}', 'verify เหตุผลทดสอบ', 'owner'), array['22023'], 'saves'));

  v_i := 0;
  foreach v_k in array array['', 'ok', E'​​​', '   ', '[ต้องยืนยัน: ยอดจริง]', '[ ต้อง  ยืนยัน ยอด]'] loop
    v_i := v_i + 1;
    v_log := v_log || pg_temp.vl('Y3' || chr(96 + v_i), 'reason ผิด: ' || replace(replace(v_k, E'​', '<ZWSP>'), E'\n', ' '),
      pg_temp.vx(pg_temp.q_amend(v_shopB, v_p1, (v_d0 + 5)::text, '{"save_count": 21}', v_k, 'owner'), array['22023']));
  end loop;
  v_log := v_log || pg_temp.vl('Y3g', 'reason เป็น SQL NULL',
    pg_temp.vx(format('select analytics.content_post_metric_amend(%L::uuid,%L::uuid,%L::date,%L::jsonb,null,%L)', v_shopB, v_p1, v_d0 + 5, '{"save_count": 21}', 'owner'), array['22023']));

  v_log := v_log || pg_temp.vl('Y4a', 'วันพรุ่งนี้ (ไทย)', pg_temp.vx(pg_temp.q_amend(v_shopB, v_p1, (v_today + 1)::text, '{"save_count": 21}', 'verify เหตุผลทดสอบ', 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('Y4b', 'วัน infinity', pg_temp.vx(pg_temp.q_amend(v_shopB, v_p1, 'infinity', '{"save_count": 21}', 'verify เหตุผลทดสอบ', 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('Y4c', 'วัน -infinity', pg_temp.vx(pg_temp.q_amend(v_shopB, v_p1, '-infinity', '{"save_count": 21}', 'verify เหตุผลทดสอบ', 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('Y4d', 'วันไทย − 31 (เกิน 30 วัน)', pg_temp.vx(pg_temp.q_amend(v_shopB, v_p1, (v_today - 31)::text, '{"save_count": 21}', 'verify เหตุผลทดสอบ', 'owner'), array['55000']));
  v_log := v_log || pg_temp.vl('Y4e', 'วันที่ไม่มีแถว (วันถัดจากแถวสุดท้าย) — ย้อนกรอกไม่ได้', pg_temp.vx(pg_temp.q_amend(v_shopB, v_p1, (v_d0 + 7)::text, '{"save_count": 21}', 'verify เหตุผลทดสอบ', 'owner'), array['22023'], 'ย้อนกรอกไม่ได้'));
  v_log := v_log || pg_temp.vl('Y4f', 'วันที่ไม่มีแถว (ก่อนแถวแรก)', pg_temp.vx(pg_temp.q_amend(v_shopB, v_p1, (v_d0 + 3)::text, '{"save_count": 21}', 'verify เหตุผลทดสอบ', 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('Y4g', 'วันเท่า "วันไทย − 30" พอดี ต้องไม่ถูกด่าน 30 วันตัด (ไปตกที่ไม่มีแถวแทน = 22023 ไม่ใช่ 55000)',
    pg_temp.vx(pg_temp.q_amend(v_shopB, v_p1, (v_today - 30)::text, '{"save_count": 21}', 'verify เหตุผลทดสอบ', 'owner'), array['22023']));

  v_log := v_log || pg_temp.vl('Y5', 'ล้างครบทุกช่องบนแถวจริงของ fixture (M1)',
    pg_temp.vx(pg_temp.q_amend(v_shopB, v_p1, (v_d0 + 4)::text,
      '{"view_count": null, "like_count": null, "comment_count": null, "save_count": null, "share_count": null}', 'verify เหตุผลทดสอบ', 'owner'), array['55000']));
  v_log := v_log || pg_temp.vl('Y6a', 'ค่าเท่าเดิมทุก key (view_count 1000 บน M1 ที่เป็น 1000)',
    pg_temp.vx(pg_temp.q_amend(v_shopB, v_p1, (v_d0 + 4)::text, '{"view_count": 1000}', 'verify เหตุผลทดสอบ', 'owner'), array['22023'], 'ไม่มีค่าเปลี่ยน'));
  v_log := v_log || pg_temp.vl('Y6b', 'ล้างช่องที่ว่างอยู่แล้ว (comment_count null → null)',
    pg_temp.vx(pg_temp.q_amend(v_shopB, v_p1, (v_d0 + 4)::text, '{"comment_count": null}', 'verify เหตุผลทดสอบ', 'owner'), array['22023'], 'ไม่มีค่าเปลี่ยน'));

  v_p2 := pg_temp.mkpost(v_shopB, 5);
  select posted_date_th into v_day from analytics.content_post where id = v_p2;
  perform pg_temp.mkmet(v_p2, v_day + 2, 100, 5, null, 2, null, false);
  update analytics.content_post set status = 'deleted' where id = v_p2;
  v_log := v_log || pg_temp.vl('Y7a', 'amend โพสต์ deleted', pg_temp.vx(pg_temp.q_amend(v_shopB, v_p2, (v_day + 2)::text, '{"save_count": 3}', 'verify เหตุผลทดสอบ', 'owner'), array['55000']));
  v_log := v_log || pg_temp.vl('Y7b', 'amend โพสต์ของร้านอื่น (ส่ง shop จริง + post ของร้าน B)', pg_temp.vx(pg_temp.q_amend(v_shop, v_p1, (v_d0 + 5)::text, '{"save_count": 21}', 'verify เหตุผลทดสอบ', 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('Y7c', 'amend โพสต์ uuid สุ่ม', pg_temp.vx(pg_temp.q_amend(v_shopB, gen_random_uuid(), (v_d0 + 5)::text, '{"save_count": 21}', 'verify เหตุผลทดสอบ', 'owner'), array['22023']));
  v_log := v_log || pg_temp.vb('Y7z', 'ทุกเคสปฏิเสธข้างบน "ไม่เขียนอะไร": แถว metric ของ P1 + จำนวน log เท่าเดิมเป๊ะ', pg_temp.msnap(v_p1) = v_s1, v_s1 || ' vs ' || pg_temp.msnap(v_p1));
  select count(*) into v_n from analytics.content_post_metric_amend_log where shop_id = v_shopB;
  v_log := v_log || pg_temp.vb('Y7y', 'ร้าน B ยังไม่มี log เลยก่อนเริ่มเคสสำเร็จ', v_n = 0, 'พบ ' || v_n);

  ----------------------------------------------------------------------------
  -- N5: flow สำเร็จ — แก้ M2 (view 1500→1300) ⇒ M3 (1400) ไม่ถดถอยแล้ว · แก้กลับ ⇒ ถดถอยอีก · log ครบ 5 คอลัมน์
  ----------------------------------------------------------------------------
  v_log := v_log || pg_temp.vb('N5a', 'ก่อนแก้: M3 is_regression = true (1400 < 1500) · M2 = false',
    (select is_regression from analytics.content_post_metric where id = v_m3) is true and (select is_regression from analytics.content_post_metric where id = v_m2) is false);
  v_j := analytics.content_post_metric_amend(v_shopB, v_p1, v_d0 + 5, '{"view_count": 1300}', 'verify ลดยอด view', 'owner');
  v_log := v_log || pg_temp.vb('N5b', 'amend คืน changed {view_count:{from 1500,to 1300}} · regression_recomputed=1 · is_regression ของ M2 = false',
    v_j #>> '{changed,view_count,from}' = '1500' and v_j #>> '{changed,view_count,to}' = '1300' and (v_j ->> 'regression_recomputed')::int = 1
    and (v_j ->> 'is_regression')::boolean is false and (select count(*) from jsonb_object_keys(v_j -> 'changed')) = 1, v_j::text);
  v_log := v_log || pg_temp.vb('N5c', 'M3 พลิกเป็น is_regression = false (1400 ไม่ต่ำกว่า max ฐานใหม่ 1300)', (select is_regression from analytics.content_post_metric where id = v_m3) is false);
  v_log := v_log || pg_temp.vb('N5d', 'M2: view 1300 · source manual · sources มี manual · amended_cols {view_count} · captured_at/raw/age_days ไม่แตะ',
    (select view_count = 1300 and source = 'manual' and 'manual' = any (sources) and amended_cols = array['view_count']
            and age_days = 5 and raw is null from analytics.content_post_metric where id = v_m2));
  v_log := v_log || pg_temp.vb('N5e', 'M1 (ไม่ใช่แถวที่แก้) ไม่ขยับ', (select view_count = 1000 and amended_cols = '{}' and is_regression is false from analytics.content_post_metric where id = v_m1));
  select * into r from analytics.content_post_metric_amend_log where id = (v_j ->> 'log_id')::uuid;
  v_log := v_log || pg_temp.vb('N5f', 'log แถวแรก: before 5 คอลัมน์เต็ม (view 1500 · comment null) · after view 1300 · changed_cols {view_count} · owner/amend · metric/post/วันตรง',
    r.id is not null and (select count(*) from jsonb_object_keys(r.before)) = 5 and (select count(*) from jsonb_object_keys(r.after)) = 5
    and r.before -> 'view_count' = '1500'::jsonb and r.after -> 'view_count' = '1300'::jsonb and r.before -> 'comment_count' = 'null'::jsonb
    and r.changed_cols = array['view_count'] and r.actor_role = 'owner' and r.change_kind = 'amend' and r.metric_id = v_m2 and r.post_id = v_p1
    and r.captured_on = v_d0 + 5 and r.shop_id = v_shopB and r.reason = 'verify ลดยอด view');
  v_j2 := analytics.content_post_metric_amend(v_shopB, v_p1, v_d0 + 5, '{"view_count": 1500}', 'verify แก้กลับ', 'owner');
  v_log := v_log || pg_temp.vb('N5g', 'แก้กลับ 1300→1500: regression_recomputed=1 · M3 กลับเป็น true',
    (v_j2 ->> 'regression_recomputed')::int = 1 and (select is_regression from analytics.content_post_metric where id = v_m3) is true, v_j2::text);
  select count(*) into v_n from analytics.content_post_metric_amend_log where post_id = v_p1;
  v_log := v_log || pg_temp.vb('N5h', 'log ของโพสต์ = 2 แถว (ไม่มีแถวเปล่า/ซ้ำ)', v_n = 2, 'พบ ' || v_n);

  -- แก้แถวสุดท้าย (M3) ไม่มีแถวหลังให้คิดใหม่ ⇒ recomputed = 0 · คิด is_regression ของแถวตัวเองด้วย helper
  v_j := analytics.content_post_metric_amend(v_shopB, v_p1, v_d0 + 6, '{"view_count": 1600}', 'verify แก้แถวสุดท้าย', 'owner');
  v_log := v_log || pg_temp.vb('N5i', 'แก้แถวสุดท้าย (M3 view 1400→1600): recomputed=0 · is_regression ของ M3 = false (1600 ≥ 1500)',
    (v_j ->> 'regression_recomputed')::int = 0 and (v_j ->> 'is_regression')::boolean is false
    and (select is_regression from analytics.content_post_metric where id = v_m3) is false, v_j::text);
  v_j := analytics.content_post_metric_amend(v_shopB, v_p1, v_d0 + 6, '{"view_count": 1400}', 'verify แก้กลับแถวสุดท้าย', 'owner');
  v_log := v_log || pg_temp.vb('N5j', 'แก้กลับ M3 → 1400: is_regression กลับเป็น true', (select is_regression from analytics.content_post_metric where id = v_m3) is true);

  -- ล้างช่อง → ถอดธง · ตั้งเป็นตัวเลข → ใส่ธง · null ไม่ใช่คำยืนยัน
  v_j := analytics.content_post_metric_amend(v_shopB, v_p1, v_d0 + 5, '{"save_count": 22}', 'verify ตั้ง save', 'owner');
  v_log := v_log || pg_temp.vb('N5k', 'ตั้ง save_count เป็นตัวเลข ⇒ amended_cols = {save_count, view_count}',
    (select amended_cols = array['save_count', 'view_count'] from analytics.content_post_metric where id = v_m2));
  v_j := analytics.content_post_metric_amend(v_shopB, v_p1, v_d0 + 5, '{"save_count": null}', 'verify ล้าง save', 'owner');
  v_log := v_log || pg_temp.vb('N5l', 'ล้าง save_count (json null) ⇒ ค่าเป็น null + ถอดออกจาก amended_cols (null ไม่ใช่คำยืนยัน) · ช่องอื่นไม่ขยับ',
    (select save_count is null and amended_cols = array['view_count'] and view_count = 1500 and like_count = 80 from analytics.content_post_metric where id = v_m2));
  v_log := v_log || pg_temp.vb('N5m', 'log ล้างช่อง: before save 22 → after JSON null (ไม่ใช่ข้อความ "null")',
    exists (select 1 from analytics.content_post_metric_amend_log l where l.post_id = v_p1 and l.changed_cols = array['save_count']
             and l.before -> 'save_count' = '22'::jsonb and l.after -> 'save_count' = 'null'::jsonb and jsonb_typeof(l.after -> 'save_count') = 'null'));
  v_log := v_log || pg_temp.vb('N5n', 'helper เท่ากับ is_regression ของ M1-M3 หลังแก้หลายรอบ',
    (select bool_and(analytics.content_post_metric_regression_(m.post_id, m.captured_on, m.view_count, m.like_count, m.comment_count, m.save_count, m.share_count) is not distinct from m.is_regression)
       from analytics.content_post_metric m where m.post_id = v_p1));

  -- G1: 1e3 (jsonb แปลงเป็น 1000 ก่อนถึงฟังก์ชัน) รับเป็น 1000 บนโพสต์แยก (ไม่กวนค่าฐานของ P1)
  v_p6 := pg_temp.mkpost(v_shopB, 9);
  select posted_date_th into v_day from analytics.content_post where id = v_p6;
  v_id := pg_temp.mkmet(v_p6, v_day + 3, 10, 1, null, 1, null, false);
  v_j := analytics.content_post_metric_amend(v_shopB, v_p6, v_day + 3, '{"view_count": 1e3}', 'verify 1e3 = 1000', 'owner');
  v_log := v_log || pg_temp.vb('G1', 'view_count 1e3 ถูกรับเป็น 1000 (jsonb normalize — ตัดสินใจ G)', (select view_count = 1000 from analytics.content_post_metric where id = v_id), v_j::text);

  ----------------------------------------------------------------------------
  -- Y8: ด่านตาราง content_post_metric — เขียนตรงจาก service_role (set local role) ไม่ผ่าน · ต้องไม่พัง: แก้เฉพาะ raw/captured_at/source ผ่าน
  ----------------------------------------------------------------------------
  v_s1 := pg_temp.msnap(v_p1);
  v_log := v_log || pg_temp.vl('Y8a', 'service_role UPDATE save_count ตรง', pg_temp.vr('service_role', format('update analytics.content_post_metric set save_count = 99 where id = %L', v_m2), array['55000']));
  v_log := v_log || pg_temp.vl('Y8b', 'service_role UPDATE view_count ตรง', pg_temp.vr('service_role', format('update analytics.content_post_metric set view_count = 99 where id = %L', v_m2), array['55000']));
  v_log := v_log || pg_temp.vl('Y8c', 'service_role UPDATE is_regression ตรง', pg_temp.vr('service_role', format('update analytics.content_post_metric set is_regression = not is_regression where id = %L', v_m2), array['55000']));
  v_log := v_log || pg_temp.vl('Y8d', 'service_role UPDATE amended_cols ตรง (ปลอมธงแก้มือ)', pg_temp.vr('service_role', format('update analytics.content_post_metric set amended_cols = %L::text[] where id = %L', '{like_count}', v_m1), array['55000']));
  v_log := v_log || pg_temp.vl('Y8e', 'service_role UPDATE captured_on ตรง', pg_temp.vr('service_role', format('update analytics.content_post_metric set captured_on = captured_on + 20 where id = %L', v_m1), array['55000']));
  v_log := v_log || pg_temp.vl('Y8f', 'service_role UPDATE ที่ล้างค่าเป็น null ตรง', pg_temp.vr('service_role', format('update analytics.content_post_metric set like_count = null where id = %L', v_m1), array['55000']));
  v_log := v_log || pg_temp.vl('Y8g', 'service_role DELETE แถว metric ตรง', pg_temp.vr('service_role', format('delete from analytics.content_post_metric where id = %L', v_m1), array['55000']));
  v_log := v_log || pg_temp.vl('Y8h', 'service_role INSERT ที่ใส่ amended_cols (ปลอมธง)', pg_temp.vr('service_role',
    format('insert into analytics.content_post_metric (shop_id, post_id, captured_on, age_days, view_count, amended_cols) values (%L, %L, %L, 7, 1, %L::text[])', v_shopB, v_p1, v_d0 + 7, '{view_count}'), array['55000']));
  v_log := v_log || pg_temp.vb('Y8i', 'ทุกเคสข้างบนไม่เขียนอะไร (แถว metric + log ของ P1 เท่าเดิม)', pg_temp.msnap(v_p1) = v_s1, v_s1 || ' vs ' || pg_temp.msnap(v_p1));
  v_p7 := pg_temp.mkpost(v_shopB, 8);
  select posted_date_th into v_day from analytics.content_post where id = v_p7;
  v_id := pg_temp.mkmet(v_p7, v_day + 1, 10, 1, null, 1, null, false);
  v_log := v_log || pg_temp.vl('Y8j', 'ต้องไม่พัง: service_role UPDATE raw/captured_at เฉยๆ ผ่าน', pg_temp.vro('service_role',
    format('update analytics.content_post_metric set raw = %L::jsonb, captured_at = now() where id = %L', '{"x": 1}', v_id)));
  v_log := v_log || pg_temp.vl('Y8k', 'ต้องไม่พัง: service_role INSERT แถวใหม่ที่ไม่มีธง (insert ตรงเป็นของเดิม) ผ่าน', pg_temp.vro('service_role',
    format('insert into analytics.content_post_metric (shop_id, post_id, captured_on, age_days, view_count, save_count) values (%L, %L, %L, 3, 11, 1)', v_shopB, v_p7, v_day + 3)));
  v_log := v_log || pg_temp.vl('Y8l', 'ต้องไม่พัง: service_role เปลี่ยน source เฉยๆ โดยค่าตัวเลขไม่เปลี่ยน ผ่าน + ไม่มี log (ไม่มีการทับ)', pg_temp.vro('service_role',
    format('update analytics.content_post_metric set source = %L where id = %L', 'tiktok_api', v_id)));
  select count(*) into v_n from analytics.content_post_metric_amend_log where post_id = v_p7;
  v_log := v_log || pg_temp.vb('Y8m', 'แถวที่ไม่เคย amend: เปลี่ยน source เป็น tiktok_api ไม่สร้าง log', v_n = 0, 'พบ ' || v_n);

  ----------------------------------------------------------------------------
  -- Y10: amend_log append-only · เขียนตรงไม่ได้ · cascade ลบโพสต์ต้องผ่าน (ต้องไม่พัง)
  ----------------------------------------------------------------------------
  select id into v_id2 from analytics.content_post_metric_amend_log where post_id = v_p1 limit 1;
  v_log := v_log || pg_temp.vl('Y10a', 'UPDATE amend_log (postgres ตรง)', pg_temp.vx(format('update analytics.content_post_metric_amend_log set reason = %L where id = %L', 'แก้ประวัติ', v_id2), array['42501']));
  v_log := v_log || pg_temp.vl('Y10b', 'DELETE amend_log เมื่อโพสต์/metric ยังอยู่', pg_temp.vx(format('delete from analytics.content_post_metric_amend_log where id = %L', v_id2), array['42501']));
  v_log := v_log || pg_temp.vl('Y10c', 'TRUNCATE amend_log', pg_temp.vx('truncate analytics.content_post_metric_amend_log', array['42501']));
  v_log := v_log || pg_temp.vl('Y10d', 'service_role INSERT amend_log ตรง (ปลอมประวัติ) — ไม่มี grant', pg_temp.vr('service_role',
    format('insert into analytics.content_post_metric_amend_log (shop_id, metric_id, post_id, captured_on, before, after, changed_cols, reason, actor_role) values (%L, %L, %L, %L, %L::jsonb, %L::jsonb, %L::text[], %L, %L)',
           v_shopB, v_m2, v_p1, v_d0 + 5, '{}', '{}', '{view_count}', 'ปลอมประวัติ', 'owner'), array['42501']));
  v_log := v_log || pg_temp.vl('Y10e', 'service_role SELECT amend_log ได้', pg_temp.vro('service_role', 'select count(*) from analytics.content_post_metric_amend_log'));
  v_log := v_log || pg_temp.vl('Y10f', 'INSERT amend_log ที่ kind/actor ไม่คู่กัน (api_override + owner) → CHECK (postgres ตรง)', pg_temp.vx(
    format('insert into analytics.content_post_metric_amend_log (shop_id, metric_id, post_id, captured_on, before, after, changed_cols, reason, change_kind, actor_role) values (%L, %L, %L, %L, %L::jsonb, %L::jsonb, %L::text[], %L, %L, %L)',
           v_shopB, v_m2, v_p1, v_d0 + 5, '{}', '{}', '{view_count}', 'ทดสอบ', 'api_override', 'owner'), array['23514']));
  v_log := v_log || pg_temp.vl('Y10f2', 'INSERT amend_log ที่ changed_cols ว่าง → CHECK', pg_temp.vx(
    format('insert into analytics.content_post_metric_amend_log (shop_id, metric_id, post_id, captured_on, before, after, changed_cols, reason, actor_role) values (%L, %L, %L, %L, %L::jsonb, %L::jsonb, %L::text[], %L, %L)',
           v_shopB, v_m2, v_p1, v_d0 + 5, '{}', '{}', '{}', 'ทดสอบ', 'owner'), array['23514']));
  -- cascade: ลบโพสต์ P6 (มี log ของ G1) โดย service_role จริง ⇒ guard ของ metric (DELETE) + append-only ของ log ต้องปล่อยเพราะแม่หายไปแล้ว
  select count(*) into v_n from analytics.content_post_metric_amend_log where post_id = v_p6;
  v_log := v_log || pg_temp.vl('Y10g', 'ต้องไม่พัง: service_role ลบโพสต์ที่มี metric + amend_log ได้ (cascade ผ่านทั้งสอง guard) — มี log ก่อนลบ ' || v_n,
    pg_temp.vro('service_role', format('delete from analytics.content_post where id = %L', v_p6)));
  select (select count(*) from analytics.content_post_metric where post_id = v_p6) + (select count(*) from analytics.content_post_metric_amend_log where post_id = v_p6) into v_n2;
  v_log := v_log || pg_temp.vb('Y10h', 'หลัง cascade: metric + log ของโพสต์นั้นเหลือ 0', v_n >= 1 and v_n2 = 0, 'log ก่อน ' || v_n || ' · เหลือ ' || v_n2);

  ----------------------------------------------------------------------------
  -- Q9 (มติเจ้าของ 7 ต.ค. ทับสเปกเดิม Y9): tiktok_api ทับค่าที่แก้มือได้ · มี log api_override · ถอดธงของคอลัมน์ที่ถูกทับ · ไม่ใช่ "ล็อกไม่ให้ทับ"
  ----------------------------------------------------------------------------
  v_p3 := pg_temp.mkpost(v_shopB, 3);
  v_id := analytics.content_post_metric_upsert(v_shopB, v_p3, 100, 10, null, 5, null, 'manual');
  select captured_on into v_day from analytics.content_post_metric where id = v_id;
  v_j := analytics.content_post_metric_amend(v_shopB, v_p3, v_day, '{"save_count": 20, "view_count": 120}', 'verify แก้มือก่อน API', 'owner');
  v_log := v_log || pg_temp.vb('Q9a', 'ตั้งต้น: แถววันนี้ view 120 save 20 amended {save_count, view_count} · log 1 แถว (amend)',
    (select view_count = 120 and save_count = 20 and amended_cols = array['save_count', 'view_count'] from analytics.content_post_metric where id = v_id)
    and (select count(*) from analytics.content_post_metric_amend_log where post_id = v_p3) = 1);
  v_id2 := analytics.content_post_metric_upsert(v_shopB, v_p3, 150, 12, null, null, null, 'tiktok_api');
  v_log := v_log || pg_temp.vb('Q9b', 'upsert tiktok_api (view 150 · like 12 · save null) → id เดียวกับแถวเดิม', v_id2 = v_id);
  v_log := v_log || pg_temp.vb('Q9c', 'API ทับ view_count ที่แก้มือได้ (120 → 150) · like 12 · save คง 20 (API ไม่ส่ง — null-preserving ไม่ใช่การทับ)',
    (select view_count = 150 and like_count = 12 and save_count = 20 from analytics.content_post_metric where id = v_id));
  v_log := v_log || pg_temp.vb('Q9d', 'ธงที่ถูกทับถูกถอด: amended_cols เหลือ {save_count} · source = tiktok_api · sources มี manual + tiktok_api',
    (select amended_cols = array['save_count'] and source = 'tiktok_api' and sources @> array['manual', 'tiktok_api'] from analytics.content_post_metric where id = v_id));
  select * into r from analytics.content_post_metric_amend_log where post_id = v_p3 and change_kind = 'api_override';
  v_log := v_log || pg_temp.vb('Q9e', 'log api_override 1 แถว: system · changed_cols {view_count} · before view 120 → after view 150 · 5 คอลัมน์เต็ม · เหตุผลไม่ว่าง',
    r.id is not null and r.actor_role = 'system' and r.changed_cols = array['view_count'] and r.before -> 'view_count' = '120'::jsonb
    and r.after -> 'view_count' = '150'::jsonb and r.after -> 'save_count' = '20'::jsonb and (select count(*) from jsonb_object_keys(r.after)) = 5
    and length(r.reason) >= 3 and r.metric_id = v_id and r.captured_on = v_day);
  select count(*) into v_n from analytics.content_post_metric_amend_log where post_id = v_p3;
  perform analytics.content_post_metric_upsert(v_shopB, v_p3, 150, 12, null, null, null, 'tiktok_api');
  select count(*) into v_n2 from analytics.content_post_metric_amend_log where post_id = v_p3;
  v_log := v_log || pg_temp.vb('Q9f', 'API ส่งค่าเท่าเดิมซ้ำ = ไม่ทับ = ไม่สร้าง log ใหม่', v_n2 = v_n, v_n || ' → ' || v_n2);
  perform analytics.content_post_metric_upsert(v_shopB, v_p3, 150, 99, null, null, null, 'tiktok_api');
  select count(*) into v_n2 from analytics.content_post_metric_amend_log where post_id = v_p3;
  v_log := v_log || pg_temp.vb('Q9g', 'API เปลี่ยนเฉพาะ like (ไม่เคยแก้มือ) = ทับปกติ ไม่สร้าง log', v_n2 = v_n and (select like_count = 99 from analytics.content_post_metric where id = v_id), v_n || ' → ' || v_n2);
  perform analytics.content_post_metric_upsert(v_shopB, v_p3, null, null, null, 7, null, 'tiktok_api');
  v_log := v_log || pg_temp.vb('Q9h', 'API ทับ save_count (20 → 7) ที่แก้มือ: ทับได้ · amended_cols ว่าง · log api_override แถวที่ 2 (changed {save_count})',
    (select save_count = 7 and amended_cols = '{}' from analytics.content_post_metric where id = v_id)
    and (select count(*) from analytics.content_post_metric_amend_log where post_id = v_p3 and change_kind = 'api_override') = 2
    and exists (select 1 from analytics.content_post_metric_amend_log l where l.post_id = v_p3 and l.change_kind = 'api_override'
                 and l.changed_cols = array['save_count'] and l.before -> 'save_count' = '20'::jsonb and l.after -> 'save_count' = '7'::jsonb));
  perform analytics.content_post_metric_upsert(v_shopB, v_p3, 160, null, null, null, null, 'manual');
  v_log := v_log || pg_temp.vb('Q9i', 'manual ทับค่า (คน vs คน ล่าสุดชนะ): view 160 · ไม่มี log เพิ่ม · amended_cols ไม่ถูกแตะ',
    (select view_count = 160 and source = 'manual' and amended_cols = '{}' from analytics.content_post_metric where id = v_id)
    and (select count(*) from analytics.content_post_metric_amend_log where post_id = v_p3) = 3);
  -- แถวที่ไม่เคย amend: tiktok_api ทับปกติ ไม่มี log (N4)
  v_p4 := pg_temp.mkpost(v_shopB, 3);
  v_id := analytics.content_post_metric_upsert(v_shopB, v_p4, 100, 10, null, 5, null, 'manual');
  perform analytics.content_post_metric_upsert(v_shopB, v_p4, 130, null, null, null, null, 'tiktok_api');
  v_log := v_log || pg_temp.vb('N4a', 'tiktok_api บนแถวที่ไม่เคย amend = ทับปกติ (view 100→130 · like/save คง) · ไม่มี log',
    (select view_count = 130 and like_count = 10 and save_count = 5 and source = 'tiktok_api' and sources = array['manual', 'tiktok_api'] from analytics.content_post_metric where id = v_id)
    and (select count(*) from analytics.content_post_metric_amend_log where post_id = v_p4) = 0);
  -- cascade ของแถวที่มี log: postgres ลบ metric ตรงขณะโพสต์ยังอยู่ — log ตามไปได้ (แม่ metric หายแล้ว) ไม่ถูก append-only ขวาง
  v_log := v_log || pg_temp.vl('Q9j', 'ต้องไม่พัง: postgres ลบแถว metric ที่มี log (แม่ metric หายแล้ว log ตาม cascade ได้)',
    pg_temp.vok(format('delete from analytics.content_post_metric where id = %L', (select id from analytics.content_post_metric where post_id = v_p3 limit 1))));
  select count(*) into v_n from analytics.content_post_metric_amend_log where post_id = v_p3;
  v_log := v_log || pg_temp.vb('Q9k', 'หลังลบ metric ของ P3: log ของ P3 หมดตามไปด้วย', v_n = 0, 'พบ ' || v_n);

  ----------------------------------------------------------------------------
  -- N4: content_post_metric_upsert ทุกโหมดเดิมยังทำงานเหมือนเดิม (ครั้งแรก · ซ้ำวันเดียว null-preserving · regression H1) + pin md5
  ----------------------------------------------------------------------------
  v_p5 := pg_temp.mkpost(v_shopB, 20);
  select posted_date_th into v_day from analytics.content_post where id = v_p5;
  perform pg_temp.mkmet(v_p5, v_today - 1, 500, 40, null, null, null, false);
  v_id := analytics.content_post_metric_upsert(v_shopB, v_p5, 400, null, null, null, null, 'manual');
  v_log := v_log || pg_temp.vb('N4b', 'upsert ครั้งแรกของวัน: view 400 < max เมื่อวาน 500 ⇒ is_regression = true · age_days = วันนี้ − posted_date · amended_cols ว่าง',
    (select is_regression is true and age_days = v_today - v_day and amended_cols = '{}' and source = 'manual' and sources = array['manual'] from analytics.content_post_metric where id = v_id));
  perform analytics.content_post_metric_upsert(v_shopB, v_p5, null, null, null, 3, null, 'manual');
  v_log := v_log || pg_temp.vb('N4c', 'upsert ซ้ำวันเดียวด้วยคอลัมน์อื่น: view 400 คงเดิม (null-preserving) · save 3 · is_regression ยัง true (H1)',
    (select view_count = 400 and save_count = 3 and is_regression is true from analytics.content_post_metric where id = v_id));
  perform analytics.content_post_metric_upsert(v_shopB, v_p5, 600, null, null, null, null, 'manual');
  v_log := v_log || pg_temp.vb('N4d', 'แก้เลขวันเดียวกัน 400 → 600 (ไม่ต่ำกว่า 500) ⇒ is_regression กลับเป็น false',
    (select view_count = 600 and is_regression is false from analytics.content_post_metric where id = v_id));
  v_log := v_log || pg_temp.vb('N4e', 'helper เท่ากับ is_regression ของแถว upsert ทั้ง 3 โพสต์ (P3/P4/P5)',
    (select bool_and(analytics.content_post_metric_regression_(m.post_id, m.captured_on, m.view_count, m.like_count, m.comment_count, m.save_count, m.share_count) is not distinct from m.is_regression)
       from analytics.content_post_metric m where m.post_id in (v_p4, v_p5)));
  v_log := v_log || pg_temp.vl('N4f', 'upsert ต้องมีตัวเลขอย่างน้อย 1 ค่า (H3) ยังปฏิเสธเหมือนเดิม',
    pg_temp.vx(format('select analytics.content_post_metric_upsert(%L::uuid,%L::uuid,null,null,null,null,null,%L)', v_shopB, v_p5, 'manual'), array['22023']));
  v_log := v_log || pg_temp.vb('N4g', 'pin md5(prosrc) ของ content_post_metric_upsert (0148) ไม่เปลี่ยน — 0161 ไม่ replace (D22: แก้แล้วต้องตรวจ helper ด้วย)',
    (select md5(prosrc) from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'content_post_metric_upsert') = 'c04da3a5bbef365006ce4ed56422f906',
    coalesce((select md5(prosrc) from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'content_post_metric_upsert'), 'null'));

  ----------------------------------------------------------------------------
  -- N7: v_content_post_result — ป้ายตาม quartile ของฐาน 10 โพสต์ก่อนหน้า (ร้าน B · platform tiktok แยกจากร้านจริง)
  --   โพสต์ i=1..7 โพสต์ห่างกัน 1 วัน (วันที่ 19..13 ก่อนวันนี้) · T+7 ทุกโพสต์ view 1000 · save = 10 20 30 40 25 50 1 ⇒ save_rate .010 .020 .030 .040 .025 .050 .001
  --   โพสต์ 8: view 0 / save 0 ⇒ save_rate null · โพสต์ 9: อายุ 2 วัน ยังไม่มี T+7
  ----------------------------------------------------------------------------
  for v_i in 1 .. 7 loop
    v_posts := v_posts || pg_temp.mkpost(v_shopC, 20 - v_i);
    select posted_date_th into v_day from analytics.content_post where id = v_posts[v_i];
    perform pg_temp.mkmet(v_posts[v_i], v_day + 7, 1000, 100, null, v_save[v_i], null, false);
  end loop;
  v_p6 := pg_temp.mkpost(v_shopC, 12);                       -- โพสต์ 8 (view 0)
  select posted_date_th into v_day from analytics.content_post where id = v_p6;
  perform pg_temp.mkmet(v_p6, v_day + 7, 0, 0, null, 0, null, false);
  v_p2 := pg_temp.mkpost(v_shopC, 2);                        -- โพสต์ 9 (ยังไม่ถึง T+7)

  select count(*) into v_n from analytics.v_content_post_result where shop_id = v_shopC;
  v_log := v_log || pg_temp.vb('N7a', 'ร้าน C มีแถวผลต่อโพสต์ 9 แถว (โพสต์ active ทั้งหมด)', v_n = 9, 'พบ ' || v_n);
  select * into r from analytics.v_content_post_result where post_id = v_posts[1];
  v_log := v_log || pg_temp.vb('N7b', 'โพสต์แรก (ฐาน 0): computed_label null · reason "ยังสรุปไม่ได้ (0/4)" · effective null · label_source none',
    r.computed_label is null and r.computed_reason = 'ยังสรุปไม่ได้ (0/4)' and r.effective_label is null and r.label_source = 'none' and r.baseline_n = 0 and r.save_rate = 0.01, coalesce(r.computed_reason, 'null'));
  select * into r from analytics.v_content_post_result where post_id = v_posts[4];
  v_log := v_log || pg_temp.vb('N7c', 'โพสต์ที่ 4 (ฐาน 3): ยังสรุปไม่ได้ (3/4)', r.computed_label is null and r.computed_reason = 'ยังสรุปไม่ได้ (3/4)' and r.baseline_n = 3, coalesce(r.computed_reason, 'null'));
  select * into r from analytics.v_content_post_result where post_id = v_posts[5];
  v_s1 := concat_ws('|', r.computed_label, r.baseline_n, r.baseline_save_p25, r.baseline_save_p50, r.baseline_save_p75);
  v_log := v_log || pg_temp.vb('N7d', 'โพสต์ที่ 5 (ฐาน 4 = ครบ): p25 .0175 · p50 .0250 · p75 .0325 (คำนวณมือจาก .01 .02 .03 .04) · save_rate .025 ⇒ normal · reason null',
    r.baseline_n = 4 and r.baseline_save_p25 = 0.0175 and r.baseline_save_p50 = 0.025 and r.baseline_save_p75 = 0.0325 and r.save_rate = 0.025
    and r.computed_label = 'normal' and r.save_label = 'normal' and r.computed_reason is null and r.effective_label = 'normal' and r.label_source = 'computed', v_s1);
  select * into r from analytics.v_content_post_result where post_id = v_posts[6];
  v_log := v_log || pg_temp.vb('N7e', 'โพสต์ที่ 6 save_rate .05 > p75 ของฐาน 5 (.03) ⇒ above', r.baseline_n = 5 and r.baseline_save_p75 = 0.03 and r.computed_label = 'above', concat_ws('|', r.baseline_n, r.baseline_save_p75, r.computed_label));
  select * into r from analytics.v_content_post_result where post_id = v_posts[7];
  v_log := v_log || pg_temp.vb('N7f', 'โพสต์ที่ 7 save_rate .001 < p25 ของฐาน 6 (.02125) ⇒ below · ฐานไม่นับโพสต์ตัวเองและโพสต์หลัง',
    r.baseline_n = 6 and r.baseline_save_p25 = 0.0213 and r.computed_label = 'below', concat_ws('|', r.baseline_n, r.baseline_save_p25, r.computed_label));
  select concat_ws('|', computed_label, baseline_n, baseline_save_p25, baseline_save_p50, baseline_save_p75) into v_s2 from analytics.v_content_post_result where post_id = v_posts[5];
  v_log := v_log || pg_temp.vb('N7g', 'ป้ายนิ่ง: หลังมีโพสต์ที่ 6-7 เข้ามา ป้าย/ฐานของโพสต์ที่ 5 เท่าเดิมเป๊ะ', v_s2 = v_s1, v_s1 || ' vs ' || v_s2);
  select * into r from analytics.v_content_post_result where post_id = v_p6;
  v_log := v_log || pg_temp.vb('N7h', 'โพสต์ที่ view 0: save_rate null ⇒ ป้ายไม่มี · reason "ไม่มีค่า save ที่ T+7" · ไม่เข้าฐาน',
    r.save_rate is null and r.computed_label is null and r.computed_reason = 'ไม่มีค่า save ที่ T+7' and r.baseline_n = 7, coalesce(r.computed_reason, 'null') || ' n=' || r.baseline_n);
  select * into r from analytics.v_content_post_result where post_id = v_p2;
  v_log := v_log || pg_temp.vb('N7i', 'โพสต์ยังไม่ถึง T+7: reason ขึ้นต้น "ไม่มี snapshot T+7: " + เหตุผลของ t7 view', r.computed_label is null and r.computed_reason = 'ไม่มี snapshot T+7: ยังไม่ถึง 7 วัน', coalesce(r.computed_reason, 'null'));
  select count(*) into v_n from analytics.v_content_post_result where shop_id = v_shopC and share_label is not null;
  v_log := v_log || pg_temp.vb('N7j', 'share_label null ทุกแถว (ไม่มีค่า share ใน fixture) — ไม่ fallback เงียบไปใช้ save', v_n = 0 and (select bool_and(computed_label is not distinct from save_label) from analytics.v_content_post_result where shop_id = v_shopC));

  -- Y11: confirm ต้องถูกปฏิเสธ
  v_s1 := (select count(*) || ':' || count(result_confirmed_at) from analytics.content_post where shop_id = v_shopC);
  v_log := v_log || pg_temp.vl('Y11a', 'confirm actor ai', pg_temp.vx(pg_temp.q_verdict(v_shopC, v_posts[5], 'below', null, 'ai'), array['42501']));
  v_log := v_log || pg_temp.vl('Y11b', 'confirm actor system', pg_temp.vx(pg_temp.q_verdict(v_shopC, v_posts[5], 'below', null, 'system'), array['42501']));
  v_log := v_log || pg_temp.vl('Y11c', 'confirm ป้าย great', pg_temp.vx(pg_temp.q_verdict(v_shopC, v_posts[5], 'great', null, 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('Y11d', 'confirm ป้าย null', pg_temp.vx(format('select analytics.content_post_verdict_confirm(%L::uuid,%L::uuid,null,null,%L,null)', v_shopC, v_posts[5], 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('Y11e', 'confirm โพสต์ไม่มี T+7 (ยังไม่ถึง 7 วัน) — ข้อความมีเหตุผลของ t7 view', pg_temp.vx(pg_temp.q_verdict(v_shopC, v_p2, 'below', null, 'owner'), array['55000'], 'ยังไม่ถึง 7 วัน'));
  update analytics.content_post set status = 'deleted' where id = v_posts[1];
  v_log := v_log || pg_temp.vb('N7s', 'โพสต์ deleted ไม่อยู่ใน v_content_post_result (ผลต่อโพสต์ใช้เฉพาะ active)', (select count(*) from analytics.v_content_post_result where post_id = v_posts[1]) = 0);
  v_log := v_log || pg_temp.vl('Y11f', 'confirm โพสต์ deleted', pg_temp.vx(pg_temp.q_verdict(v_shopC, v_posts[1], 'below', null, 'owner'), array['55000']));
  v_log := v_log || pg_temp.vl('Y11g', 'confirm บทเรียนมี [ต้องยืนยัน', pg_temp.vx(pg_temp.q_verdict(v_shopC, v_posts[5], 'below', 'บทเรียน [ต้องยืนยัน: ตัวเลข]', 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('Y11h', 'confirm บทเรียนยาว 301 ตัวอักษร', pg_temp.vx(pg_temp.q_verdict(v_shopC, v_posts[5], 'below', repeat('ก', 301), 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('Y11i', 'CAS: expected above ขณะที่ระบบคำนวณเป็น normal', pg_temp.vx(pg_temp.q_verdict(v_shopC, v_posts[5], 'below', null, 'owner', 'above'), array['55000'], 'รีเฟรช'));
  v_log := v_log || pg_temp.vl('Y11j', 'CAS: expected above ขณะที่ computed เป็น null (โพสต์แรก ฐาน 0)', pg_temp.vx(pg_temp.q_verdict(v_shopC, v_posts[2], 'below', null, 'owner', 'above'), array['55000']));
  v_log := v_log || pg_temp.vl('Y11k', 'expected_computed ค่าขยะ', pg_temp.vx(pg_temp.q_verdict(v_shopC, v_posts[5], 'below', null, 'owner', 'bogus'), array['22023']));
  v_log := v_log || pg_temp.vl('Y11l', 'โพสต์ร้านอื่น (ส่งร้าน B + โพสต์ร้าน C)', pg_temp.vx(pg_temp.q_verdict(v_shopB, v_posts[5], 'below', null, 'owner'), array['22023']));
  v_log := v_log || pg_temp.vb('Y11z', 'ทุกเคสปฏิเสธข้างบนไม่ตั้ง result_* ที่ไหนเลย', (select count(*) || ':' || count(result_confirmed_at) from analytics.content_post where shop_id = v_shopC) = v_s1);
  update analytics.content_post set status = 'active' where id = v_posts[1];

  -- Y12: ด่านตาราง content_post.result_*
  v_log := v_log || pg_temp.vl('Y12a', 'service_role UPDATE result_label_override ตรง', pg_temp.vr('service_role',
    format('update analytics.content_post set result_label_override = %L, result_confirmed_at = now(), result_confirmed_by_role = %L where id = %L', 'above', 'owner', v_posts[5]), array['55000']));
  v_log := v_log || pg_temp.vl('Y12b', 'service_role INSERT โพสต์ที่ใส่ result_* (ปลอมการยืนยัน)', pg_temp.vr('service_role',
    format('insert into analytics.content_post (shop_id, platform, external_id, post_url, posted_at, posted_date_th, result_label_override, result_confirmed_at, result_confirmed_by_role) values (%L, %L, %L, %L, now(), %L, %L, now(), %L)',
           v_shopC, 'tiktok', pg_temp.ext(), pg_temp.url(), v_today, 'above', 'owner'), array['55000']));
  v_log := v_log || pg_temp.vl('Y12c', 'postgres ตั้ง result_label_override โดย confirmed_at ว่าง → CHECK consistency', pg_temp.vx(
    format('update analytics.content_post set result_label_override = %L where id = %L', 'above', v_posts[5]), array['23514']));
  v_log := v_log || pg_temp.vl('Y12d', 'ต้องไม่พัง: service_role UPDATE caption_snapshot (คอลัมน์ที่ไม่ใช่ result_*) ผ่าน', pg_temp.vro('service_role',
    format('update analytics.content_post set caption_snapshot = %L where id = %L', 'verify caption', v_posts[5])));
  v_log := v_log || pg_temp.vl('Y12e', 'ต้องไม่พัง: service_role INSERT โพสต์ที่ไม่มี result_* ผ่าน', pg_temp.vro('service_role',
    format('insert into analytics.content_post (shop_id, platform, external_id, post_url, posted_at, posted_date_th) values (%L, %L, %L, %L, now(), %L)',
           v_shopC, 'tiktok', pg_temp.ext(), pg_temp.url(), v_today)));
  delete from analytics.content_post where shop_id = v_shopC and posted_at >= now() - interval '1 minute' and caption_snapshot is null and id <> all (v_posts) and id <> v_p6 and id <> v_p2;

  -- confirm สำเร็จ + ซ้ำ + เปลี่ยนใจ + บทเรียน → signal
  v_j := analytics.content_post_verdict_confirm(v_shopC, v_posts[5], 'below', 'verify บทเรียน hook เปิดด้วยคำถาม', 'owner', 'normal');
  v_log := v_log || pg_temp.vb('N7k', 'confirm below (CAS expected normal ผ่าน): คืน computed normal · previous null · signal_created true',
    v_j ->> 'computed_label' = 'normal' and v_j ->> 'previous_label' is null and (v_j ->> 'signal_created')::boolean and v_j ->> 'signal_id' is not null, v_j::text);
  select * into r from analytics.v_content_post_result where post_id = v_posts[5];
  v_log := v_log || pg_temp.vb('N7l', 'effective_label = below · label_source owner · computed ยัง normal · result_lesson ตรง · confirmed_at ตั้ง',
    r.effective_label = 'below' and r.label_source = 'owner' and r.computed_label = 'normal' and r.result_lesson = 'verify บทเรียน hook เปิดด้วยคำถาม' and r.result_confirmed_at is not null);
  v_log := v_log || pg_temp.vb('N7m', 'ตั้ง result_confirmed_by_role = owner เท่านั้น',
    (select result_confirmed_by_role = 'owner' from analytics.content_post where id = v_posts[5]));
  select count(*) into v_n from analytics.content_signal where origin_post_id = v_posts[5] and kind = 'insight';
  select * into r2 from analytics.content_signal where origin_post_id = v_posts[5] and kind = 'insight';
  v_log := v_log || pg_temp.vb('N7n', 'signal insight 1 แถว: source owner · created_by_role owner · confidence observation · seen_on วันไทย · ผูกโพสต์',
    v_n = 1 and r2.source = 'owner' and r2.created_by_role = 'owner' and r2.confidence = 'observation' and r2.seen_on = v_today and r2.summary = 'verify บทเรียน hook เปิดด้วยคำถาม', 'พบ ' || v_n);
  v_j2 := analytics.content_post_verdict_confirm(v_shopC, v_posts[5], 'below', 'verify บทเรียน hook เปิดด้วยคำถาม', 'owner');
  select count(*) into v_n from analytics.content_signal where origin_post_id = v_posts[5] and kind = 'insight';
  v_log := v_log || pg_temp.vb('N7o', 'ยืนยันซ้ำข้อความเดิม = ไม่สร้าง signal ซ้ำ (ยัง 1) · คืน signal_id เดิม · signal_created false · previous_label below',
    v_n = 1 and (v_j2 ->> 'signal_created')::boolean is false and v_j2 ->> 'signal_id' = v_j ->> 'signal_id' and v_j2 ->> 'previous_label' = 'below', v_j2::text);
  v_j2 := analytics.content_post_verdict_confirm(v_shopC, v_posts[5], 'above', 'verify บทเรียนข้อความใหม่', 'owner');
  select count(*) into v_n from analytics.content_signal where origin_post_id = v_posts[5] and kind = 'insight';
  v_log := v_log || pg_temp.vb('N7p', 'ข้อความต่าง = signal ใหม่ (รวม 2) · เปลี่ยนใจ above · previous below · previous_lesson คืนข้อความเก่า',
    v_n = 2 and (v_j2 ->> 'signal_created')::boolean and v_j2 ->> 'previous_label' = 'below' and v_j2 ->> 'previous_lesson' = 'verify บทเรียน hook เปิดด้วยคำถาม'
    and (select effective_label = 'above' from analytics.v_content_post_result where post_id = v_posts[5]), v_j2::text);
  v_j2 := analytics.content_post_verdict_confirm(v_shopC, v_posts[5], 'normal', null, 'owner');
  select count(*) into v_n from analytics.content_signal where origin_post_id = v_posts[5] and kind = 'insight';
  v_log := v_log || pg_temp.vb('N7q', 'confirm ไม่มีบทเรียน: result_lesson เป็น null (ทับ) · ไม่สร้าง signal · signal_id null',
    (select result_lesson is null and result_label_override = 'normal' from analytics.content_post where id = v_posts[5]) and v_n = 2 and v_j2 ->> 'signal_id' is null and not (v_j2 ->> 'signal_created')::boolean, v_j2::text);


  ----------------------------------------------------------------------------
  -- N3: v_content_post_missed_window — ตารางหน้าต่างเดียวกับ v_content_entry_queue · ไม่ทับกัน · fixture (ร้าน B)
  ----------------------------------------------------------------------------
  v_log := v_log || pg_temp.vb('N3a', 'ทั้งสอง view มีตารางหน้าต่าง VALUES (1,1,2),(2,3,4),(3,5,9) ชุดเดียวกัน',
    regexp_replace(pg_get_viewdef('analytics.v_content_post_missed_window'::regclass), '\s+', '', 'g') ~ 'VALUES\(1,1,2\),\(2,3,4\),\(3,5,9\)'
    and regexp_replace(pg_get_viewdef('analytics.v_content_entry_queue'::regclass), '\s+', '', 'g') ~ 'VALUES\(1,1,2\),\(2,3,4\),\(3,5,9\)');
  v_log := v_log || pg_temp.vb('N3b', 'สูตร "มีตัวเลข" เดียวกับคิว: num_nonnulls(5 คอลัมน์) > 0 ทั้งสอง view',
    regexp_replace(pg_get_viewdef('analytics.v_content_post_missed_window'::regclass), '\s+', '', 'g') ~ 'num_nonnulls\(m\.view_count,m\.like_count,m\.comment_count,m\.save_count,m\.share_count\)>0'
    and regexp_replace(pg_get_viewdef('analytics.v_content_entry_queue'::regclass), '\s+', '', 'g') ~ 'num_nonnulls\(m\.view_count,m\.like_count,m\.comment_count,m\.save_count,m\.share_count\)>0');
  select count(*) into v_n from analytics.v_content_entry_queue e
    join analytics.v_content_post_missed_window m on m.post_id = e.post_id and m.read_round = e.read_round;
  v_log := v_log || pg_temp.vb('N3c', 'แถวที่อยู่ในคิวกรอกยอดต้องไม่อยู่ใน "พลาดรอบ" ของรอบเดียวกัน (ทุกโพสต์จริง+fixture)', v_n = 0, 'ทับกัน ' || v_n);

  v_pa := pg_temp.mkpost(v_shopB, 6);                       -- ไม่มี metric เลย · อายุ 6 ⇒ รอบ 1,2 ปิดแล้ว · รอบ 3 (≤9) ยังเปิด
  v_pb := pg_temp.mkpost(v_shopB, 12);                      -- มีแถว metric แต่ทั้ง 5 ช่องว่าง (insert ตรง — แถวหลอกตาแบบ trap #13)
  select posted_date_th into v_day from analytics.content_post where id = v_pb;
  perform pg_temp.mkmet(v_pb, v_day + 1, null, null, null, null, null, false);
  v_pc := pg_temp.mkpost(v_shopB, 12);                      -- deleted
  update analytics.content_post set status = 'deleted' where id = v_pc;
  v_pd := pg_temp.mkpost(v_shopB, 1);                       -- อายุ 1 ยังไม่ปิดรอบไหน
  select coalesce(string_agg(read_round::text, ',' order by read_round), '-') into v_s1 from analytics.v_content_post_missed_window where post_id = v_p1;
  v_log := v_log || pg_temp.vb('N3d', 'P1 (อายุ 12 · metric อายุ 4/5/6 มีค่า): พลาดเฉพาะรอบ 1', v_s1 = '1', v_s1);
  select coalesce(string_agg(read_round::text, ',' order by read_round), '-') into v_s1 from analytics.v_content_post_missed_window where post_id = v_pa;
  v_log := v_log || pg_temp.vb('N3e', 'โพสต์ไม่มี metric อายุ 6: พลาดรอบ 1,2 (รอบ 3 ยังไม่ปิด)', v_s1 = '1,2', v_s1);
  select coalesce(string_agg(read_round::text, ',' order by read_round), '-') into v_s1 from analytics.v_content_post_missed_window where post_id = v_pb;
  v_log := v_log || pg_temp.vb('N3f', 'โพสต์ที่มีแถว metric แต่ว่างทั้ง 5 ช่อง ไม่นับเป็น "อ่านแล้ว": พลาดรอบ 1,2,3 (trap #13 · เหมือน H3 ของคิว)', v_s1 = '1,2,3', v_s1);
  select count(*) into v_n from analytics.v_content_post_missed_window where post_id in (v_pc, v_pd);
  v_log := v_log || pg_temp.vb('N3g', 'โพสต์ deleted และโพสต์อายุ 1 วัน ไม่มีแถว "พลาดรอบ"', v_n = 0, 'พบ ' || v_n);
  select * into r from analytics.v_content_post_missed_window where post_id = v_pa and read_round = 2;
  v_log := v_log || pg_temp.vb('N3h', 'คอลัมน์: window 3..4 · closed_on = posted_date + 4 · age_days_today = วันไทย − posted_date · platform/post_url ตรงโพสต์',
    r.window_lo = 3 and r.window_hi = 4 and r.window_closed_on = r.posted_date_th + 4 and r.age_days_today = v_today - r.posted_date_th and r.platform = 'tiktok' and r.post_url like 'https://%' and r.shop_id = v_shopB);
  select count(*) into v_n from analytics.v_content_post_missed_window where shop_id = v_shopB and post_id = v_p5;
  v_log := v_log || pg_temp.vb('N3i', 'โพสต์อายุ 20 มีแถว metric แต่อายุ 19/20 (นอกทุกหน้าต่าง) ⇒ พลาด 3 รอบ', v_n = 3, 'พบ ' || v_n);

  ----------------------------------------------------------------------------
  -- N6: v_content_hook_type_rollup (ร้าน C) — 3 ชิ้นแล้ว 4 ชิ้นที่มี T+7 · verdict ตรงกับ library · ไม่มีโฮสต์
  ----------------------------------------------------------------------------
  for v_i in 1 .. 4 loop
    v_step := pg_temp.mk_produced(v_shopC);
    select id into v_hookA from analytics.content_hook where step_id = v_step and label = 'A';
    v_ext1 := pg_temp.ext();
    perform analytics.content_piece_post(v_shopC, v_step, 'tiktok', v_ext1, pg_temp.url(v_ext1), now() - make_interval(days => 11 - v_i), 'owner', v_hookA, null, null, null);
    select id, posted_date_th into v_id, v_day from analytics.content_post where step_id = v_step;
    perform pg_temp.mkmet(v_id, v_day + 7, 1000, 100, null, 30 + v_i, null, false);
    v_posts := v_posts || v_id;
    if v_i = 3 then
      select * into r from analytics.v_content_hook_type_rollup where shop_id = v_shopC and hook_type = 'question';
      select string_agg(distinct l.type_verdict, ',') into v_s1 from analytics.v_content_hook_library l where l.shop_id = v_shopC and l.hook_type = 'question';
      v_log := v_log || pg_temp.vb('N6a', '3 ชิ้นที่มี T+7: posts_n 3 · pieces_n 3 · measured_pieces_n 3 · verdict ยังสรุปไม่ได้ · detail (3/4) · library type_verdict เดียวกัน',
        r.posts_n = 3 and r.pieces_n = 3 and r.measured_pieces_n = 3 and r.measured_posts_n = 3 and r.verdict = 'ยังสรุปไม่ได้' and r.verdict_detail = 'ยังสรุปไม่ได้ (3/4)' and v_s1 = r.verdict,
        concat_ws('|', r.posts_n, r.pieces_n, r.measured_pieces_n, r.verdict, r.verdict_detail, v_s1));
    end if;
  end loop;
  select * into r from analytics.v_content_hook_type_rollup where shop_id = v_shopC and hook_type = 'question';
  select string_agg(distinct l.type_verdict, ',') into v_s1 from analytics.v_content_hook_library l where l.shop_id = v_shopC and l.hook_type = 'question';
  v_log := v_log || pg_temp.vb('N6b', '4 ชิ้นที่มี T+7: verdict สรุปได้ · detail (4 ชิ้น) · library type_verdict ตรงกัน · median_save_rate .0325 (คำนวณมือจาก .031-.034)',
    r.measured_pieces_n = 4 and r.verdict = 'สรุปได้' and r.verdict_detail = 'สรุปได้ (4 ชิ้น)' and v_s1 = 'สรุปได้' and r.median_save_rate = 0.0325 and r.last_measured_on is not null,
    concat_ws('|', r.measured_pieces_n, r.verdict, v_s1, r.median_save_rate));
  v_log := v_log || pg_temp.vb('N6c', 'hook B (fact) ไม่ได้ใช้โพสต์ ⇒ ไม่มีแถว fact ในร้าน C · ผลรวมเท่ากับจำนวนโพสต์ที่ผูก hook (4)',
    not exists (select 1 from analytics.v_content_hook_type_rollup where shop_id = v_shopC and hook_type = 'fact')
    and (select coalesce(sum(posts_n), 0) from analytics.v_content_hook_type_rollup where shop_id = v_shopC) = 4);
  -- pieces_n นับ distinct ชิ้น: ผูกโพสต์ที่ 2 ของชิ้นเดียวกัน (ig_fb_post) ไม่ทำให้จำนวนชิ้นเพิ่ม — ใช้ชิ้น short_clip ที่มี 1 โพสต์ ⇒ ตรวจที่ posts_n = pieces_n
  v_log := v_log || pg_temp.vb('N6d', 'posts_n = pieces_n = 4 (ชิ้นละ 1 โพสต์) · count(distinct step_id) ไม่ใช่ count(*) ของ metric', r.posts_n = 4 and r.pieces_n = 4);
  -- เจ้าของยืนยันป้าย 1 โพสต์ ⇒ ป้ายนับใน rollup (effective_label ชนะป้ายคำนวณ) + signal ติดกลุ่มลูกค้าของชิ้น
  v_j := analytics.content_post_verdict_confirm(v_shopC, v_posts[array_length(v_posts, 1)], 'above', 'verify บทเรียนชิ้นงาน', 'owner');
  select * into r from analytics.v_content_hook_type_rollup where shop_id = v_shopC and hook_type = 'question';
  v_log := v_log || pg_temp.vb('N6e', 'หลังเจ้าของยืนยัน above 1 โพสต์: labeled_n = 4 (ทุกโพสต์มี effective_label) · above_n ≥ 1 · above+normal+below = labeled_n',
    r.labeled_n = 4 and r.above_n >= 1 and r.above_n + r.normal_n + r.below_n = r.labeled_n, concat_ws('|', r.labeled_n, r.above_n, r.normal_n, r.below_n));
  select customer_group into v_s1 from analytics.content_signal where id = (v_j ->> 'signal_id')::uuid;
  v_log := v_log || pg_temp.vb('N6f', 'signal จากบทเรียนของชิ้นที่ผูก step: customer_group = กลุ่มของชิ้น (jewelry_925)', v_s1 = 'jewelry_925', coalesce(v_s1, 'null'));
  select * into r from analytics.v_content_post_result where post_id = v_posts[array_length(v_posts, 1)];
  v_log := v_log || pg_temp.vb('N6g', 'v_content_post_result ของโพสต์ที่ผูกชิ้น: hook_type question · hook_label A · hook_origin ours · piece_kind short_clip · customer_group jewelry_925 · มี campaign_id',
    r.hook_type = 'question' and r.hook_label = 'A' and r.hook_origin = 'ours' and r.piece_kind = 'short_clip' and r.customer_group = 'jewelry_925' and r.campaign_id is not null and r.step_title like 'verify-0161%');
  -- โพสต์ที่ 2 ของชิ้นเดียวกัน (ผูกตรงโดย postgres + GUC ของ RPC — จำลองชิ้น ig_fb_post ที่มี 2 โพสต์) ⇒ posts_n เพิ่ม แต่ pieces_n ต้องไม่เพิ่ม (distinct step)
  select step_id, hook_id into v_step, v_hookA from analytics.content_post where id = v_posts[8];
  v_id := pg_temp.mkpost(v_shopC, 9);
  select posted_date_th into v_day from analytics.content_post where id = v_id;
  perform pg_temp.mkmet(v_id, v_day + 7, 1000, 100, null, 33, null, false);
  perform set_config('c2.piece_rpc', '1', true);
  update analytics.content_post set step_id = v_step, hook_id = v_hookA where id = v_id;
  perform set_config('c2.piece_rpc', '', true);
  select * into r from analytics.v_content_hook_type_rollup where shop_id = v_shopC and hook_type = 'question';
  v_log := v_log || pg_temp.vb('N6j', 'ชิ้นเดียวมี 2 โพสต์: posts_n 5 · measured_posts_n 5 · pieces_n 4 · measured_pieces_n 4 (นับ distinct ชิ้น ไม่ใช่โพสต์) · verdict ยังสรุปได้',
    r.posts_n = 5 and r.measured_posts_n = 5 and r.pieces_n = 4 and r.measured_pieces_n = 4 and r.verdict = 'สรุปได้', concat_ws('|', r.posts_n, r.measured_posts_n, r.pieces_n, r.measured_pieces_n, r.verdict));
  select string_agg(distinct l.type_verdict, ',') into v_s1 from analytics.v_content_hook_library l where l.shop_id = v_shopC and l.hook_type = 'question';
  v_log := v_log || pg_temp.vb('N6k', 'library นับชิ้นเท่า rollup เมื่อชิ้นมี 2 โพสต์ (type_n_pieces = 4 · verdict ตรงกัน)',
    (select max(l.type_n_pieces) = 4 from analytics.v_content_hook_library l where l.shop_id = v_shopC and l.hook_type = 'question') and v_s1 = r.verdict, v_s1);
  select string_agg(r3.shop_id || '/' || r3.hook_type, ', ') into v_bad
    from analytics.v_content_hook_type_rollup r3
   where exists (select 1 from analytics.v_content_hook_library l where l.shop_id = r3.shop_id and l.hook_type = r3.hook_type and l.type_verdict is distinct from r3.verdict);
  v_log := v_log || pg_temp.vb('N6h', 'ทุกแถวของ rollup (ทุกร้าน): verdict ตรงกับ type_verdict ของ v_content_hook_library', v_bad is null, coalesce(v_bad, '-'));
  v_log := v_log || pg_temp.vl('N6i', 'ต้องไม่พัง: rollup / result / missed ของข้อมูลจริง select ได้ ไม่ error (ร้านจริงวันนี้ hook_id ว่างทุกโพสต์ = rollup อาจ 0 แถว)',
    pg_temp.vro('service_role', format('select (select count(*) from analytics.v_content_hook_type_rollup where shop_id = %L) + (select count(*) from analytics.v_content_post_result where shop_id = %L) + (select count(*) from analytics.v_content_post_missed_window where shop_id = %L)', v_shop, v_shop, v_shop)));

  ----------------------------------------------------------------------------
  -- O: metric ออเดอร์ — CHECK + helper รับ 'orders' · ค่าผิดยังถูกปฏิเสธ · view นับถูกตามช่องทาง/affinity/ตะกร้าผสม
  ----------------------------------------------------------------------------
  v_log := v_log || pg_temp.vb('O1', 'helper รับ metric_code orders + ค่าเดิมทั้ง 5 ยังรับ · ค่าแปลกไม่รับ · key อื่นของ helper ไม่ขยับ',
    analytics.content_piece_enum_ok_('metric_code', 'orders') and analytics.content_piece_enum_ok_('metric_code', 'save_rate')
    and analytics.content_piece_enum_ok_('metric_code', 'share_rate') and analytics.content_piece_enum_ok_('metric_code', 'peak_viewers')
    and analytics.content_piece_enum_ok_('metric_code', 'line_reply_count') and analytics.content_piece_enum_ok_('metric_code', 'none')
    and not analytics.content_piece_enum_ok_('metric_code', 'order') and not analytics.content_piece_enum_ok_('metric_code', 'Orders')
    and not analytics.content_piece_enum_ok_('metric_code', null) and analytics.content_piece_enum_ok_('customer_group', 'silver_bar')
    and not analytics.content_piece_enum_ok_('customer_group', 'orders') and analytics.content_piece_enum_ok_('piece_kind', 'line_message')
    and not analytics.content_piece_enum_ok_('nope', 'orders'));
  v_step := analytics.content_piece_create(v_shopB, 'verify-0161 orders ' || substr(gen_random_uuid()::text, 1, 8), 'line_message', 'line_oa', 'silver_bar', 'owner', v_today + 5);
  v_log := v_log || pg_temp.vl('O2', 'content_piece_set_plan ตั้ง metric_code orders + baseline/threshold ได้ (owner) — ใช้จริงผ่าน RPC ของ 0159',
    pg_temp.vok(format('select analytics.content_piece_set_plan(%L::uuid,%L::uuid,%L::jsonb,%L)', v_shopB, v_step,
      '{"hypothesis": "verify ส่งฟรีแล้วมีออเดอร์ LINE เงินแท่ง", "metric_code": "orders", "baseline_value": 0.5, "pass_threshold": 6, "pass_op": ">="}', 'owner')));
  v_log := v_log || pg_temp.vb('O2b', 'ชิ้นนั้นมี metric_code = orders จริงในแถว step', (select metric_code = 'orders' from analytics.campaign_step where id = v_step));
  v_log := v_log || pg_temp.vl('O3', 'metric_code ค่าแปลก (order) ยังถูกปฏิเสธ 22023', pg_temp.vx(
    format('select analytics.content_piece_set_plan(%L::uuid,%L::uuid,%L::jsonb,%L)', v_shopB, v_step, '{"metric_code": "order"}', 'owner'), array['22023']));
  v_log := v_log || pg_temp.vb('O3b', 'CHECK ของ campaign_step รับ orders และไม่รับ order',
    pg_get_constraintdef((select c.oid from pg_constraint c where c.conrelid = 'analytics.campaign_step'::regclass and c.conname = 'campaign_step_metric_code_check')) ~ '''orders''::text'
    and pg_get_constraintdef((select c.oid from pg_constraint c where c.conrelid = 'analytics.campaign_step'::regclass and c.conname = 'campaign_step_metric_code_check')) !~ '''order''::text');

  select product_id into v_prod_bar from analytics.v_product_affinity where affinity_group = 'bar' limit 1;
  select product_id into v_prod_jw from analytics.v_product_affinity where affinity_group = 'jewelry' limit 1;
  select product_id into v_prod_nt from analytics.v_product_affinity where affinity_group = 'neutral' limit 1;
  select id into v_ch_line from analytics.dim_channel where code = 'line_oa';
  select id into v_ch_tt from analytics.dim_channel where code = 'tiktok';
  if v_prod_bar is null or v_prod_jw is null or v_prod_nt is null or v_ch_line is null or v_ch_tt is null then
    v_log := v_log || E'[SKIP] O4-O7 ไม่มีสินค้า bar/jewelry/neutral หรือช่องทาง line_oa/tiktok ใน DB — สร้าง fixture ออเดอร์ไม่ได้\n';
  else
    v_day := v_today - 2;
    perform pg_temp.mkord(v_shopX, v_ch_line, v_day, array[v_prod_bar]);                        -- A: bar
    perform pg_temp.mkord(v_shopX, v_ch_line, v_day, array[v_prod_jw]);                         -- B: jewelry
    perform pg_temp.mkord(v_shopX, v_ch_line, v_day, array[v_prod_bar, v_prod_jw]);             -- C: ตะกร้าผสม (นับทั้ง bar และ jewelry)
    perform pg_temp.mkord(v_shopX, v_ch_line, v_day, array[v_prod_nt]);                         -- D: neutral ล้วน (นับเฉพาะ all)
    perform pg_temp.mkord(v_shopX, v_ch_line, v_day, '{}'::uuid[]);                             -- E: ไม่มี line item (นับเฉพาะ all)
    perform pg_temp.mkord(v_shopX, v_ch_tt, v_day, array[v_prod_jw, v_prod_jw, v_prod_jw]);     -- F: tiktok · jewelry 3 line (นับ 1 ออเดอร์ — ไม่นับตามจำนวน line)
    perform pg_temp.mkord(v_shopX, v_ch_line, v_day + 1, array[v_prod_bar]);                    -- G: อีกวัน
    select jsonb_object_agg(order_date || '/' || channel_code || '/' || affinity, orders_n) into v_j
      from analytics.v_content_order_daily where shop_id = v_shopX;
    v_log := v_log || pg_temp.vb('O4', 'view ออเดอร์ร้าน X: line_oa all=5 bar=2 jewelry=2 · tiktok all=1 jewelry=1 (3 line = 1 ออเดอร์) · วันถัดไป line_oa all=1 bar=1 · ไม่มีแถว tiktok/bar',
      v_j = jsonb_build_object(v_day || '/line_oa/all', 5, v_day || '/line_oa/bar', 2, v_day || '/line_oa/jewelry', 2, v_day || '/tiktok/all', 1, v_day || '/tiktok/jewelry', 1,
                               (v_day + 1) || '/line_oa/all', 1, (v_day + 1) || '/line_oa/bar', 1), v_j::text);
    select coalesce(sum(orders_n), 0) into v_n from analytics.v_content_order_daily where shop_id = v_shopX and affinity = 'all';
    v_log := v_log || pg_temp.vb('O5', 'sum(all) = จำนวนออเดอร์ที่สร้าง (7) — ไม่นับตามจำนวน line item', v_n = 7 and (select count(*) from analytics.fact_order where shop_id = v_shopX) = 7, 'พบ ' || v_n);
    select coalesce(sum(orders_n), 0) into v_n from analytics.v_content_order_daily
     where shop_id = v_shopX and channel_code = 'line_oa' and affinity = 'bar' and order_date between v_day and v_day + 3;
    v_log := v_log || pg_temp.vb('O6', 'ตัวอย่างใช้จริง (แบบแคมเปญ 10.10): ออเดอร์ LINE เงินแท่งในช่วง 4 วัน = 3 (A, C, G)', v_n = 3, 'พบ ' || v_n);
    v_log := v_log || pg_temp.vb('O6b', 'ร้านอื่นไม่ปนกัน: ร้าน B/C ไม่มีออเดอร์ fixture ในผล (view ไม่กรองร้านเอง แต่ shop_id ตรงของแต่ละแถว)',
      not exists (select 1 from analytics.v_content_order_daily where shop_id in (v_shopB, v_shopC)));
  end if;
  -- ข้อมูลจริง: นับครบทุกออเดอร์ · bar/jewelry ไม่เกิน all ในทุกกลุ่ม
  select (select coalesce(sum(orders_n), 0) from analytics.v_content_order_daily where shop_id = v_shop and affinity = 'all'),
         (select count(*) from analytics.fact_order where shop_id = v_shop) into v_n, v_n2;
  v_log := v_log || pg_temp.vb('O7', 'ข้อมูลจริง: sum(orders_n) ของ affinity all = count(fact_order) ของร้าน (ไม่หายไม่ซ้ำตอน join item/channel)', v_n = v_n2, v_n || ' vs ' || v_n2);
  select count(*) into v_n from (
    select a.shop_id, a.order_date, a.channel_code, a.orders_n as all_n,
           coalesce((select b.orders_n from analytics.v_content_order_daily b where b.shop_id = a.shop_id and b.order_date = a.order_date and b.channel_code = a.channel_code and b.affinity = 'bar'), 0) as bar_n,
           coalesce((select j.orders_n from analytics.v_content_order_daily j where j.shop_id = a.shop_id and j.order_date = a.order_date and j.channel_code = a.channel_code and j.affinity = 'jewelry'), 0) as jw_n
      from analytics.v_content_order_daily a where a.shop_id = v_shop and a.affinity = 'all') x
   where x.bar_n > x.all_n or x.jw_n > x.all_n;
  v_log := v_log || pg_temp.vb('O8', 'ข้อมูลจริง: ไม่มีกลุ่ม (วัน×ช่องทาง) ที่ bar หรือ jewelry มากกว่า all', v_n = 0, 'ผิด ' || v_n);
  v_log := v_log || pg_temp.vl('O9', 'ต้องไม่พัง: service_role อ่าน view ออเดอร์ได้ (สิทธิ์ตารางต้นทาง fact_order/item/product ครบ)', pg_temp.vro('service_role', 'select count(*) from analytics.v_content_order_daily'));
  v_log := v_log || pg_temp.vl('O9b', 'ต้องไม่พัง: service_role อ่าน view ใหม่ที่เหลืออีก 3 ตัวได้', pg_temp.vro('service_role',
    'select (select count(*) from analytics.v_content_post_missed_window) + (select count(*) from analytics.v_content_post_result) + (select count(*) from analytics.v_content_hook_type_rollup)'));

  ----------------------------------------------------------------------------
  -- P1: ข้อมูลจริงห้ามขยับ — แคมเปญ 10.10 (step a74aa1f1…) ที่เพิ่งบันทึก
  ----------------------------------------------------------------------------
  select * into r from analytics.campaign_step where id = 'a74aa1f1-4dbf-45d0-8457-9db3b6ae89e4';
  if r.id is null then
    v_log := v_log || E'[SKIP] P1 ไม่พบ step 10.10 (a74aa1f1…) — ใน DB นี้ (เช่น replay) ไม่มีข้อมูลจริงให้เทียบ\n';
  else
    v_log := v_log || pg_temp.vb('P1', 'step 10.10: ยัง posted · metric_code none · line_oa · silver_bar (ไม่ถูกแตะโดย drop/add CHECK หรือ helper ใหม่)',
      r.piece_status = 'posted' and r.metric_code = 'none' and r.channel = 'line_oa' and r.customer_group = 'silver_bar', concat_ws('|', r.piece_status, r.metric_code, r.channel, r.customer_group));
  end if;

  ----------------------------------------------------------------------------
  -- Y23: role authenticated (แม้ได้ usage สคีมา) เรียก RPC/helper/อ่าน view/ตารางของ 0161 ไม่ได้ — 42501 (trap #18.5)
  ----------------------------------------------------------------------------
  execute 'grant usage on schema analytics to authenticated';
  v_n := 0; v_n2 := 0; v_bad := null;
  for r in
    select p.proname, p.pronargs from pg_proc p
     where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
       and p.proname in ('content_post_metric_regression_', 'content_post_metric_amend', 'content_post_verdict_confirm')
     order by p.proname
  loop
    v_n := v_n + 1;
    begin
      execute 'set local role authenticated';
      execute format('select analytics.%I(%s)', r.proname, repeat('null,', r.pronargs - 1) || 'null');
      v_bad := coalesce(v_bad || ', ', '') || r.proname || ':ผ่าน';
    exception when others then
      if sqlstate = '42501' then v_n2 := v_n2 + 1; else v_bad := coalesce(v_bad || ', ', '') || r.proname || ':' || sqlstate; end if;
    end;
    execute 'reset role';
  end loop;
  for r in select unnest(array['v_content_post_missed_window', 'v_content_post_result', 'v_content_hook_type_rollup', 'v_content_order_daily', 'content_post_metric_amend_log']) as vn loop
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
  v_log := v_log || pg_temp.vb('Y23a', 'authenticated เรียก RPC 2 + helper 1 + อ่าน view 4 + ตาราง amend_log 1 → 42501 ครบ 8', v_n = 8 and v_n2 = 8 and v_bad is null, format('ทดสอบ %s · 42501 %s · ผิดปกติ: %s', v_n, v_n2, coalesce(v_bad, '-')));
  v_log := v_log || pg_temp.vb('Y23b', 'สิทธิ์ usage ของ authenticated บนสคีมากลับสู่เดิม (false) หลังทดสอบ', not has_schema_privilege('authenticated', 'analytics', 'usage'));
  v_log := v_log || pg_temp.vb('Y23c', 'anon ไม่มี usage และเรียก RPC ไม่ได้', not has_schema_privilege('anon', 'analytics', 'usage')
    and not has_function_privilege('anon', 'analytics.content_post_metric_amend(uuid,uuid,date,jsonb,text,text)', 'execute')
    and not has_function_privilege('anon', 'analytics.content_post_verdict_confirm(uuid,uuid,text,text,text,text)', 'execute'));

  ----------------------------------------------------------------------------
  -- Y24: helper เท่ากับ is_regression ของ "ทุกแถว" (ข้อมูลจริง + fixture ที่มาจาก upsert/amend/insert ตรง) — D22
  ----------------------------------------------------------------------------
  select string_agg(left(m.post_id::text, 8) || '@' || m.captured_on, ', ') into v_bad
    from analytics.content_post_metric m
   where analytics.content_post_metric_regression_(m.post_id, m.captured_on, m.view_count, m.like_count, m.comment_count, m.save_count, m.share_count)
         is distinct from m.is_regression;
  v_log := v_log || pg_temp.vb('Y24a', 'helper = is_regression ของทุกแถวในตาราง (จริง + fixture) — ไม่ตรง 0 แถว', v_bad is null, coalesce(v_bad, '-'));
  select count(*), count(*) filter (where analytics.content_post_metric_regression_(m.post_id, m.captured_on, m.view_count, m.like_count, m.comment_count, m.save_count, m.share_count) is not distinct from m.is_regression)
    into v_n, v_n2
    from analytics.content_post_metric m where m.shop_id = v_shop;
  v_log := v_log || pg_temp.vb('Y24b', 'เฉพาะแถวจริงของร้านจริง: helper ตรง is_regression ทุกแถว (' || v_n || ' แถว)', v_n = v_n2, v_n2 || '/' || v_n);

  ----------------------------------------------------------------------------
  -- N1/N2/N17/N18: ข้อมูลเดิมไม่ขยับ · view เดิมใช้ได้ · ไม่มี \r · ไม่มี current_date
  ----------------------------------------------------------------------------
  select count(*) into v_n from analytics.content_post_metric_amend_log where shop_id = v_shop;
  if v_n = 0 then
    v_log := v_log || pg_temp.vb('N1a', 'ร้านจริงยังไม่เคยแก้ยอด (amend_log ว่าง) ⇒ amended_cols = {} ทุกแถวจริง',
      not exists (select 1 from analytics.content_post_metric where shop_id = v_shop and cardinality(amended_cols) > 0));
    v_log := v_log || pg_temp.vb('N1b', 'ร้านจริงยังไม่มีผลที่เจ้าของยืนยัน ⇒ result_* เป็น null ทุกโพสต์จริง',
      not exists (select 1 from analytics.content_post where shop_id = v_shop and (result_label_override is not null or result_confirmed_at is not null or result_lesson is not null)));
  else
    v_log := v_log || E'[SKIP] N1a/b ร้านจริงมี amend_log แล้ว (ใช้งานจริงหลัง apply) — ตรวจ "ว่างทุกแถว" ไม่ได้ · ด่านท้ายไฟล์ migration เทียบ md5 ตอน apply ครอบไว้แล้ว\n';
  end if;
  v_log := v_log || pg_temp.vb('N1c', 'ข้อมูลจริง content_post_metric ยัง source manual/backfill/tiktok_api เดิม ไม่มี source แปลก', not exists (select 1 from analytics.content_post_metric where shop_id = v_shop and source not in ('manual', 'tiktok_api', 'backfill')));
  v_n := 0; v_bad := null;
  for r in select unnest(array['v_content_post_t7', 'v_content_entry_queue', 'v_content_hook_library', 'v_content_inbox_counts', 'v_content_piece', 'v_campaign_board', 'v_recommendation_acceptance', 'v_live_log_recent']) as vn loop
    v_n := v_n + 1;
    begin
      execute format('select count(*) from analytics.%I', r.vn);
    exception when others then
      v_bad := coalesce(v_bad || ', ', '') || r.vn || ':' || sqlstate;
    end;
  end loop;
  v_log := v_log || pg_temp.vb('N2a', 'view เดิม 8 ตัว select ได้ไม่ error (t7 · entry_queue · hook_library · inbox_counts · piece · campaign_board · recommendation_acceptance · live_log_recent)', v_bad is null and v_n = 8, coalesce(v_bad, 'ทดสอบ ' || v_n));
  v_log := v_log || pg_temp.vb('N2b', 'pin md5(viewdef) ของ 3 view ที่ 0161 พึ่ง ไม่เปลี่ยน (แก้แล้วต้องมาอัปเดตค่านี้ + ตรวจ result/missed/rollup)',
    md5(pg_get_viewdef('analytics.v_content_post_t7'::regclass)) = '37b356db6186b1f8823ef4418950d32d'
    and md5(pg_get_viewdef('analytics.v_content_entry_queue'::regclass)) = '7735f48a4565102109813874564d262a'
    and md5(pg_get_viewdef('analytics.v_content_hook_library'::regclass)) = 'd3f056daa656526235b66b9f0136fa49',
    md5(pg_get_viewdef('analytics.v_content_post_t7'::regclass)) || ' ' || md5(pg_get_viewdef('analytics.v_content_entry_queue'::regclass)) || ' ' || md5(pg_get_viewdef('analytics.v_content_hook_library'::regclass)));
  select count(*) into v_n from analytics.v_content_entry_queue;
  v_log := v_log || pg_temp.vb('N2c', 'คิวกรอกยอดเดิม (v_content_entry_queue) ยังคืนแถวตามปกติ (≥ 0 ไม่ error) และคอลัมน์ครบ 10', (select count(*) from information_schema.columns where table_schema = 'analytics' and table_name = 'v_content_entry_queue') = 10, 'แถว ' || v_n);

  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p where p.pronamespace = 'analytics'::regnamespace
     and p.proname in ('content_post_metric_regression_', 'content_post_metric_guard', 'content_post_metric_amend_log_append_only',
                       'content_post_result_guard', 'content_post_metric_amend', 'content_post_verdict_confirm', 'content_piece_enum_ok_')
     and pg_get_functiondef(p.oid) ~ E'\r';
  v_log := v_log || pg_temp.vb('N17a', 'body ของฟังก์ชัน 0161 ไม่มี \r (LF ล้วน — ไม่เพี้ยนเพราะ CRLF ตอน replay)', v_bad is null, coalesce(v_bad, '-'));
  select string_agg(x.proname || '=' || x.n, ', ') into v_bad
    from (select p.proname, count(*) n from pg_proc p where p.pronamespace = 'analytics'::regnamespace
           and p.proname in ('content_post_metric_regression_', 'content_post_metric_guard', 'content_post_metric_amend_log_append_only',
                             'content_post_result_guard', 'content_post_metric_amend', 'content_post_verdict_confirm', 'content_piece_enum_ok_')
           group by p.proname having count(*) <> 1) x;
  v_log := v_log || pg_temp.vb('N17b', 'pg_proc ต่อชื่อ = 1 ทั้ง 7 ชื่อ (trap #1)', v_bad is null, coalesce(v_bad, '-'));

  select string_agg(c.relname, ', ') into v_bad from pg_class c
   where c.relnamespace = 'analytics'::regnamespace and c.relname in ('v_content_post_missed_window', 'v_content_post_result', 'v_content_hook_type_rollup', 'v_content_order_daily')
     and pg_get_viewdef(c.oid) ~* 'current_date';
  v_log := v_log || pg_temp.vb('N18a', 'view ใหม่ไม่มี current_date', v_bad is null, coalesce(v_bad, '-'));
  select string_agg(p.proname, ', ') into v_bad from pg_proc p where p.pronamespace = 'analytics'::regnamespace
     and p.proname in ('content_post_metric_regression_', 'content_post_metric_guard', 'content_post_metric_amend', 'content_post_verdict_confirm')
     and pg_get_functiondef(p.oid) ~* 'current_date';
  v_log := v_log || pg_temp.vb('N18b', 'ฟังก์ชันใหม่ไม่มี current_date', v_bad is null, coalesce(v_bad, '-'));
  v_log := v_log || pg_temp.vb('N18c', 'Asia/Bangkok ปรากฏใน view missed_window + RPC amend + RPC verdict_confirm',
    pg_get_viewdef('analytics.v_content_post_missed_window'::regclass) ~ 'Asia/Bangkok'
    and pg_get_functiondef('analytics.content_post_metric_amend(uuid,uuid,date,jsonb,text,text)'::regprocedure) ~ 'Asia/Bangkok'
    and pg_get_functiondef('analytics.content_post_verdict_confirm(uuid,uuid,text,text,text,text)'::regprocedure) ~ 'Asia/Bangkok');

  ----------------------------------------------------------------------------
  -- ที่ไม่ครอบในไฟล์นี้ (บอกตรงๆ)
  ----------------------------------------------------------------------------
  v_log := v_log || E'[SKIP] N10-N13/Y13-Y22 + v_campaign_summary / v_recommendation_inbox / weekly summary = ของ 0162 (ยังไม่เขียน)\n';
  v_log := v_log || E'[SKIP] N9/N15 (grep โค้ดแอป · กดหน้าเดิม) = ส่วน backend-dev grep + QA — ไฟล์นี้ตรวจฝั่ง DB เท่านั้น\n';
  v_log := v_log || E'[SKIP] การชนกันจริงของ 2 คำสั่งพร้อมกัน (amend/confirm แข่ง — ล็อก for update ของโพสต์/แถว metric) = ต้องใช้ 2 connection · do-block ทรานแซกชันเดียวจำลองไม่ได้\n';
  v_log := v_log || E'[SKIP] เวลาคร่อม 00:00-07:00 ไทยจริง — ตรวจแบบ static (Asia/Bangkok ใน definition + ไม่มี current_date) เท่านั้น\n';
  v_log := v_log || E'[SKIP] verify-0148 ส่วน T-series เต็มชุด — ไม่มีไฟล์นี้ใน scripts/verify · N4a-g ครอบโหมดหลักของ upsert แทน (ครั้งแรก/ซ้ำวัน/regression/tiktok_api) + pin md5 prosrc\n';
  v_log := v_log || E'[SKIP] ผู้ถือ service key ที่ SET ROLE เป็น postgres/ฟังก์ชัน definer เองได้ = ผ่านทุกด่านตาราง (D18 — ด่านใช้ current_user อย่างเดียว ปิดเมื่อ A2)\n';

  exception when others then
    v_log := v_log || format(E'[FAIL] ABORT verify หยุดกลางทาง sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;
  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_ok   := (length(v_log) - length(replace(v_log, '[OK]', ''))) / 4;
  v_log := v_log || format(E'\n=== สรุป: [OK] %s · [FAIL] %s — raise ด้านล่างบังคับ ROLLBACK ทั้งหมด ===\n', v_ok, v_fail);
  raise exception '%', v_log;
end;
$verify0161$;
