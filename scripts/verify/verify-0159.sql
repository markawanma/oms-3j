-- scripts/verify/verify-0159.sql
-- ตรวจ supabase/migrations/0159_content_piece_workflow.sql หลัง apply (หรือต่อท้ายไฟล์ migration ใน dry-run เดียวกัน)
-- self-rolling-back do-block ตาม 3j-migration-traps #11: ทุกเคสเก็บผลลง v_log แล้ว raise exception ปิดท้ายเสมอ ⇒ ทั้งทรานแซกชัน
-- rollback · ผลทดสอบออกทาง error message · DB ไม่ขยับ ไม่ว่า PASS หรือ FAIL (ยิงใส่ข้อมูลจริงบน prod ได้ — แต่ rollback หมด)
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0159.sql
-- dry-run ก่อน apply: ต่อไฟล์ migration + ไฟล์นี้เป็นไฟล์ชั่วคราวแล้วรันแบบไม่ใส่ --commit
--   (cat supabase/migrations/0159_*.sql scripts/verify/verify-0159.sql > tmp.sql)
-- ผล: run-sql พิมพ์ "🔴 ล้มเหลว" พร้อม message = v_log (ช่องทางรายงานผลปกติ) · มี [FAIL] ≥ 1 = ไม่ผ่าน · [SKIP] = พิสูจน์ไม่ได้ในไฟล์นี้
--
-- ⚠️ ก่อน/หลังรันตรวจด้วยมือ (trap #11): count(*) ของ campaign_step / step_artifact / content_piece_event / content_confirm_item /
-- content_hook / content_signal ต้องเท่ากันทั้งก่อนและหลัง (ไฟล์นี้ไม่เคย COMMIT)
--
-- ============ ตารางแมป "เคสในสเปก §12.9/§12.10 → assertion" (id ใน log = X/K เดียวกับสเปก · ตัวอักษรต่อท้าย = ข้อย่อย) ============
--  X1  actor ai → approved                      → X1  (42501)            | K1  md5 step/status/updated_at เท่าเดิม → ด่านท้าย migration + K1 (คอลัมน์ใหม่ null)
--  X2  approve ไม่มีแถว risk_owner               → X2                    | K2  step_artifact md5 → ด่านท้าย migration (ไม่มี baseline ในไฟล์นี้ = [SKIP] + พิมพ์ md5)
--  X3  brand_rule blocked                       → X3                    | K3  v_campaign_board def/36 คอลัมน์/select ได้ → K3 + ด่านท้าย (QA smoke หน้าเว็บ = ไม่มี ดู QA)
--  X4  confirm item ค้าง                         → X4                    | K4  RPC เดิม × step ก่อน ต.ค. ทุกโหมด (ไม่มี artifact/หลาย artifact/template) → K4a-K4d
--  X5  ชั้น 2 (marker ในข้อความ)                  → X5 (+ mutant M4)      | K5  toggle shot/reschedule/content_type/delete บน step ใน workflow → K5a-K5d
--  X6  LINE ไม่มี line_audience                  → X6                    | K6  ai_draft บน drafting/in_review → K6a-K6d
--  X7  piece_kind null                          → X7 (ข้อมูลจริง teaser) | K7  campaign_create_task ยังสร้าง step นอก workflow → K7
--  X8  produced จาก in_review                   → X8                    | K8  capture + trigger mirror → K8a-K8d
--  X9  posted โดยไม่ผ่าน content_piece_post      → X9                    | K9  content_hook_upsert/CHECK ผ่อน → K9a-K9b (+ verify-0158 ต้องรันซ้ำ)
--  X10 ส่งกลับไม่มีเหตุผล                         → X10                   | K10 ฟังก์ชันเดิม md5 → ด่านท้าย migration + K10 (live_session_upsert/content_post_upsert/set_status/update_type)
--  X11 ai ย้อนจาก approved                       → X11                   | K11 content_post 10 แถว step_id/hook_id null + คิวยอด → K11 + ด่านท้าย
--  X12 ย้อน 2 ขั้น                                → X12                   | K12 flow เต็ม (pick→…→posted→unpost) → K12a-K12z (ขั้น posted ใช้ helper content_piece_transition_ เพราะ content_piece_post = 0160)
--  X13 planned โดย anchor null                   → X13                   | K13 flow LINE → K13 (v_line_quota_28d = 0160)
--  X14 planned ขาดเกณฑ์                           → X14                   | K14 ig_fb_post 2 แพลตฟอร์ม → 0160
--  X15 hook ติดประเภทไม่ครบ (R19)                 → X15 (ข้อมูลจริง)       | K15 ส่งกลับ + marker ใหม่ → K15
--  X16 hold/cancel/resume/ปัจจุบัน/review_seconds/banana → X16a-X16f        | K16 hold/resume → K16
--  X17 advance ใส่ step นอก workflow 3 โหมดจริง    → X17a-X17c             | K17 cancel→restore → K17
--  X18 shop/step ไม่มี                            → X18                   | K18 idea + board (calendar view = 0160) → K18
--  X19 ai create + p_date                       → X19                   | K19 resolve บนชิ้นจริง (marker หลาย key) → K19
--  X20 create: kind↔channel/ข้ามร้าน/แคมเปญหลาย step → X20a-X20c            | K20 รันซ้ำ 2 รอบ/grants script/LF → นอกไฟล์นี้ (ดู QA ในรายงาน) + K20 (\r ในไฟล์ = ตรวจนอก)
--  X21 pick picked/rejected                     → X21a-X21b              | K21 วันไทย ไม่มี current_date → K21
--  X22 set_plan typo/NaN/อนาคต/segment            → X22a-X22d             | K22 overload 1 signature → K22
--  X23 set_plan บน approved/drafting/ai          → X23a-X23c             | Q8  ยกเลิกแล้วสัญญาณกลับ new (7 ต.ค.)  → Q8a-Q8f
--  X24 gate: risk โดย ai/ไม่มี question/approved/array/javascript → X24a-X24e
--  X25 resolve: ai/marker/ตอบแล้ว/removed/ว่าง      → X25a-X25e
--  X26 set_artifact_status('approved') เดิม       → X26 (+ mutant M5)
--  X27 set_artifact_content บน approved           → X27
--  X28 UPDATE/INSERT ตรง piece_status/status      → X28a-X28c (+ mutant M5b)
--  X29 campaign_delete_step บน approved          → X29
--  X30 update/delete/truncate event             → X30a-X30c
--  X31 content_piece_post …  X32 link/unlink  X33 defer          → "0160" (ไม่ครอบในไฟล์นี้)
--  X34 reference_upsert                          → X34a-X34d
--  X35 ลบ signal ที่มี hook ถอดโครงอ้างอิง          → X35
--  X36 CHECK reference/derived                  → X36a-X36b
--  X37 เรียกจาก role authenticated               → X37 (ทุกฟังก์ชันใหม่)
--  X38 backfill seed เปลี่ยน                      → X38a-X38d (ด่าน scope) + proof ใน dry-run: fixture artifact ตัวที่ 2 + migration → raise
--  X39 can_approve ตรง RPC (13 ชิ้นจริง + fixture) → X39a-X39c
--
-- ถ้ามีร้านมากกว่า 1 ร้านใน public.shop ไฟล์นี้หยุด · ร้านที่ 2 สร้างเองในทรานแซกชัน

-- ---------- helper (temp function — หายพร้อมทรานแซกชัน) ----------

-- รัน SQL ที่ "ควรถูกปฏิเสธ" — OK เมื่อ sqlstate อยู่ใน p_expect (และข้อความมี p_like ถ้าระบุ)
create or replace function pg_temp.vx(p_sql text, p_expect text[], p_like text default null) returns text
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
    if p_like is not null and position(p_like in v_msg) = 0 then
      return 'FAIL sqlstate ถูก (' || v_state || ') แต่ข้อความไม่มี "' || p_like || '" → ' || left(v_msg, 200);
    end if;
    return 'OK ' || v_state || coalesce(' detail=' || nullif(v_detail, ''), '') || ' msg=' || left(v_msg, 90);
  end if;
  return 'FAIL sqlstate=' || v_state || ' msg=' || left(v_msg, 160);
end $vx$;

-- รัน SQL ที่ "ควรสำเร็จ"
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

-- สร้างชิ้นงานทดสอบ: ผ่าน RPC จริงทั้งหมด (create → drafting → [hook A/B + เนื้อหา] → in_review)
-- p_stage: 'planned' | 'in_review' · p_marker = ใส่ [ต้องยืนยัน] 2 key (key แรกมี " และ \ เพื่อทดสอบ escape ของ jsonb · ซ้ำในข้อความ)
create or replace function pg_temp.mk_step(p_shop uuid, p_kind text, p_channel text, p_marker boolean default false,
                                           p_stage text default 'in_review') returns uuid
 language plpgsql as $mk$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_s     uuid;
  v_a     uuid;
  v_m1    text := case when p_marker then ' [ต้องยืนยัน: ราคา "925" วันนี้ \ เท่าไร]' else '' end;
  v_m2    text := case when p_marker then ' [ต้องยืนยัน: มีสต็อกไหม]' else '' end;
begin
  v_s := analytics.content_piece_create(p_shop, 'verify-0159 ' || substr(gen_random_uuid()::text, 1, 8), p_kind, p_channel,
                                        'jewelry_925', 'owner', v_today + 5);
  if p_stage = 'planned' then
    return v_s;
  end if;
  perform analytics.content_piece_advance(p_shop, v_s, 'drafting', 'owner');
  select a.id into v_a from analytics.step_artifact a where a.step_id = v_s;
  if p_kind in ('short_clip', 'live_cut') then
    perform analytics.content_hook_upsert(p_shop, v_s, 'A', 'verify hook A', 'question', null, 'owner', null);
    perform analytics.content_hook_upsert(p_shop, v_s, 'B', 'verify hook B', 'fact', null, 'owner', null);
    perform analytics.campaign_set_artifact_content(v_a, 'verify body' || v_m1,
      jsonb_build_object('segments', jsonb_build_array(jsonb_build_object('role', 'hook')),
                         'shots', jsonb_build_array(jsonb_build_object('id', 's1', 'desc', 'ถ่ายหน้าโต๊ะ' || v_m1),
                                                    jsonb_build_object('id', 's2', 'desc', 'ใกล้ๆ' || v_m2 || v_m2))));
  else
    perform analytics.campaign_set_artifact_content(v_a, 'verify body' || v_m1 || v_m2, null);
  end if;
  perform analytics.content_piece_advance(p_shop, v_s, 'in_review', 'owner');
  return v_s;
end $mk$;

-- ทำให้อนุมัติได้: 3 ด่านผ่าน (owner) + ตอบ [ต้องยืนยัน] ทุกรายการ
create or replace function pg_temp.approve_ready(p_shop uuid, p_step uuid) returns void
 language plpgsql as $ar$
declare r record;
begin
  perform analytics.content_gate_record(p_shop, p_step, 'fact_check', 'passed', 'owner',
    jsonb_build_object('sources', jsonb_build_array('https://example.com/a')));
  perform analytics.content_gate_record(p_shop, p_step, 'brand_rule', 'passed', 'owner');
  perform analytics.content_gate_record(p_shop, p_step, 'risk_owner', 'passed', 'owner');
  for r in select i.id from analytics.content_confirm_item i
            where i.step_id = p_step and i.resolved_at is null and i.removed_at is null order by i.created_at, i.id loop
    perform analytics.content_confirm_resolve(p_shop, r.id, 'คำตอบ "ทดสอบ" \ — ไทย', 'owner');
  end loop;
end $ar$;

create or replace function pg_temp.mk_approved(p_shop uuid, p_kind text, p_channel text, p_marker boolean default true) returns uuid
 language plpgsql as $ma$
declare v_s uuid;
begin
  v_s := pg_temp.mk_step(p_shop, p_kind, p_channel, p_marker);
  perform pg_temp.approve_ready(p_shop, v_s);
  perform analytics.content_piece_advance(p_shop, v_s, 'approved', 'owner', null, 45);
  return v_s;
end $ma$;

-- สถานะ/projection ของ step (สั้นๆ ใช้เทียบ)
create or replace function pg_temp.st(p_step uuid) returns text
 language sql as $st$
  select piece_status || '/' || status || coalesce('/hold=' || hold_reason, '') from analytics.campaign_step where id = p_step
$st$;

create or replace function pg_temp.art_st(p_step uuid) returns text
 language sql as $as$
  select coalesce(string_agg(status, ',' order by created_at, id), '') from analytics.step_artifact where step_id = p_step
$as$;

-- ตัวสร้าง SQL สั้นๆ สำหรับ vx/vok
create or replace function pg_temp.q_adv(p_shop uuid, p_step uuid, p_to text, p_role text, p_reason text default null, p_secs int default null)
 returns text language sql as $q$
  select format('select analytics.content_piece_advance(%L::uuid,%L::uuid,%L,%L,%L,%L::int)', p_shop, p_step, p_to, p_role, p_reason, p_secs)
$q$;

create or replace function pg_temp.q_plan(p_shop uuid, p_step uuid, p_set jsonb, p_role text)
 returns text language sql as $q$
  select format('select analytics.content_piece_set_plan(%L::uuid,%L::uuid,%L::jsonb,%L)', p_shop, p_step, p_set::text, p_role)
$q$;

create or replace function pg_temp.q_gate(p_shop uuid, p_step uuid, p_kind text, p_status text, p_role text, p_detail jsonb default null)
 returns text language sql as $q$
  select format('select analytics.content_gate_record(%L::uuid,%L::uuid,%L,%L,%L,%L::jsonb)', p_shop, p_step, p_kind, p_status, p_role, p_detail::text)
$q$;

-- "ต้องไม่พัง": OK เมื่อสำเร็จ หรือพังด้วยเหตุอื่นที่ไม่ใช่ guard ของ workflow ใหม่ (55000) — ใช้กับ RPC เดิมบน step ก่อน workflow
create or replace function pg_temp.vn5(p_sql text) returns text
 language plpgsql as $vn$
begin
  execute p_sql;
  return 'OK';
exception when others then
  if sqlstate = '55000' then
    return 'FAIL ถูก guard ของ workflow ใหม่บล็อก (55000) msg=' || left(sqlerrm, 120);
  end if;
  return 'OK (ตกด้วยกติกาเดิมของ RPC นั้น ไม่ใช่ guard: ' || sqlstate || ' ' || left(sqlerrm, 60) || ')';
end $vn$;

do $verify0159$
declare
  v_log       text := E'\n=== verify-0159 ===\n';
  v_today     date := (now() at time zone 'Asia/Bangkok')::date;
  v_shop      uuid;
  v_shop2     uuid;
  v_camp2     uuid;
  v_sig       uuid;
  v_sig2      uuid;
  v_sig3      uuid;
  v_s1        uuid;
  v_s2        uuid;
  v_s3        uuid;
  v_s4        uuid;
  v_s5        uuid;
  v_a1        uuid;
  v_hA        uuid;
  v_hB        uuid;
  v_post      uuid;
  v_item      uuid;
  v_id        uuid;
  v_id2       uuid;
  v_camp      uuid;
  v_j         jsonb;
  v_r         text;
  v_n         bigint;
  v_n2        bigint;
  v_bad       text;
  v_txt       text;
  v_txt2      text;
  v_ev        record;
  v_a2        uuid;
  v_p1        uuid;
  v_p2        uuid;
  v_p3        uuid;
  v_sa        uuid;
  v_sc        uuid;
  v_state     text;
  v_b         boolean;
  v_cnt_ok    int;
  v_cnt_same  int;
  v_cnt_unres int;
  v_cnt_all   int;
  v_q         text;
  v_h1        uuid;
  v_h2        uuid;
  v_post2     uuid;
  r           record;
  r2          record;
  v_fail      int;
  v_ok        int;
begin
  -- บล็อกในสุด: ถ้ามีข้อผิดพลาดที่ไม่ได้ดักไว้ (เช่น mutant ทำให้ state เพี้ยน) log ที่สะสมมายังต้องออก ไม่หายไปกับ exception
  begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);

  select count(*) into v_n from public.shop;
  if v_n <> 1 then
    raise exception 'verify-0159: ต้องมีร้านเดียวใน public.shop (พบ %) — ทดสอบไม่ได้', v_n;
  end if;
  select id into v_shop from public.shop;
  insert into public.shop (name) values ('verify-0159 shop B') returning id into v_shop2;
  insert into analytics.campaign (shop_id, name, campaign_type, trigger_kind, status, anchor_date)
    values (v_shop2, 'verify-0159 campaign ร้าน B', 'content_task', 'manual', 'scheduled', v_today) returning id into v_camp2;

  ----------------------------------------------------------------------------
  -- A. โครงสร้าง / สิทธิ์ / overload (K1 K3 K21 K22 + trap #18)
  ----------------------------------------------------------------------------
  v_log := v_log || pg_temp.vb('A1', 'RLS เปิดทั้ง 2 ตารางใหม่',
    (select count(*) from pg_class where relnamespace = 'analytics'::regnamespace
        and relname in ('content_piece_event', 'content_confirm_item') and relrowsecurity) = 2);

  select string_agg(c.relname || ':' || case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ', ') into v_bad
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.relnamespace = 'analytics'::regnamespace and c.relname in ('content_piece_event', 'content_confirm_item', 'v_content_piece')
     and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  v_log := v_log || pg_temp.vb('A2', 'ไม่มี PUBLIC/anon/authenticated ถือสิทธิ์บนตาราง/view ใหม่', v_bad is null, coalesce(v_bad, ''));

  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.pronamespace = 'analytics'::regnamespace
     and p.proname ~ '^(content_piece_|content_gate_|content_confirm_|content_signal_pick$|content_signal_delete_guard$|content_hook_reference_|content_hook_link_|content_hook_mirror_|content_marker_|content_regex_)'
     and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  v_log := v_log || pg_temp.vb('A3', 'ไม่มี PUBLIC/anon/authenticated ถือ EXECUTE บนฟังก์ชันของ 0159', v_bad is null, coalesce(v_bad, ''));
  v_log := v_log || pg_temp.vb('A3b', 'service_role มี EXECUTE ครบทุกฟังก์ชันของ 0159',
    (select bool_and(has_function_privilege('service_role', p.oid, 'execute')) from pg_proc p
      where p.pronamespace = 'analytics'::regnamespace
        and p.proname ~ '^(content_piece_|content_gate_|content_confirm_|content_signal_pick$|content_signal_delete_guard$|content_hook_reference_|content_hook_link_|content_hook_mirror_|content_marker_|content_regex_)'));

  select string_agg(proname || '=' || n, ', ') into v_bad from (
    select proname, count(*) n from pg_proc where pronamespace = 'analytics'::regnamespace
       and proname ~ '^(content_piece_|content_gate_|content_confirm_|content_signal_pick$|content_signal_delete_guard$|content_hook_reference_|content_hook_link_|content_hook_mirror_|content_marker_|content_regex_)'
     group by proname having count(*) > 1) x;
  v_log := v_log || pg_temp.vb('K22', 'ทุกฟังก์ชันใหม่มี signature เดียวต่อชื่อ (trap #1)', v_bad is null, coalesce(v_bad, ''));

  v_txt := pg_get_viewdef('analytics.v_content_piece'::regclass);
  v_log := v_log || pg_temp.vb('K21', 'v_content_piece ใช้วันไทย: มี Asia/Bangkok ไม่มี current_date (trap #6)',
    v_txt ~ 'Asia/Bangkok' and v_txt !~* 'current_date', '');
  v_log := v_log || pg_temp.vb('K21b', 'ไม่มี current_date ในฟังก์ชันใหม่ที่คิดวัน (create/set_plan/advance)',
    (select bool_and(pg_get_functiondef(p.oid) !~* 'current_date') from pg_proc p
      where p.pronamespace = 'analytics'::regnamespace and p.proname ~ '^(content_piece_|content_gate_|content_confirm_)'));

  -- K3: v_campaign_board 36 คอลัมน์ลำดับเดิม · select ได้ทุกแถว · ไม่มีคอลัมน์ของ workflow ใหม่
  select count(*) into v_n from information_schema.columns where table_schema = 'analytics' and table_name = 'v_campaign_board';
  select count(*) into v_n2 from analytics.v_campaign_board;
  v_log := v_log || pg_temp.vb('K3a', 'v_campaign_board 36 คอลัมน์ · select ได้ครบทุก step (นับเท่า campaign_step)',
    v_n = 36 and v_n2 = (select count(*) from analytics.campaign_step), format('cols=%s rows=%s', v_n, v_n2));
  v_log := v_log || pg_temp.vb('K3b', 'v_campaign_board ไม่มี piece_status (ไม่ต่อคอลัมน์ใหม่เข้า view เดิม)',
    pg_get_viewdef('analytics.v_campaign_board'::regclass) !~ 'piece_');

  -- K1: step ที่ยังไม่อยู่ใน workflow: ทุกคอลัมน์ใหม่ null (ด่านท้าย migration ตรวจแล้วซ้ำที่นี่) + md5 พิมพ์ไว้เทียบมือ
  select count(*) into v_n from analytics.campaign_step s
   where s.piece_status is null
     and (s.hold_reason is not null or s.piece_kind is not null or s.hypothesis is not null or s.metric_code is not null
          or s.drafted_by_ai is not null or s.line_audience is not null or s.footage_status is not null or s.expected_host_id is not null);
  v_log := v_log || pg_temp.vb('K1', 'step ที่ piece_status ว่าง ทุกคอลัมน์ใหม่เป็น null', v_n = 0, v_n::text);
  select 'campaign_step n=' || count(*) || ' distinct_updated_at=' || count(distinct updated_at) || ' md5=' ||
         md5(coalesce(string_agg(concat_ws('|', id, status, updated_at), E'\n' order by id), ''))
    into v_txt from analytics.campaign_step;
  v_log := v_log || E'[SKIP] K1/K2 เทียบกับก่อน apply ทำที่ด่านท้าย migration (snapshot GUC) — ไฟล์นี้ไม่มี baseline · ปัจจุบัน ' || v_txt || E'\n';
  select 'step_artifact n=' || count(*) || ' md5=' ||
         md5(coalesce(string_agg(concat_ws('|', id, step_id, status, content_body, clip_brief::text, updated_at), E'\n' order by id), ''))
    into v_txt from analytics.step_artifact;
  v_log := v_log || E'[SKIP] K2 ' || v_txt || E'\n';

  -- K11: โพสต์เดิม (ก่อน 1 ต.ค.) ไม่มี step_id/hook_id/artifact_id
  select count(*) into v_n from analytics.content_post
   where posted_date_th < date '2026-10-01' and (step_id is not null or hook_id is not null or artifact_id is not null);
  v_log := v_log || pg_temp.vb('K11', 'content_post ก่อน 1 ต.ค.: step_id/hook_id/artifact_id เป็น null ทุกแถว (ไม่ backfill)', v_n = 0, v_n::text);

  ----------------------------------------------------------------------------
  -- K12 / K18 / X13 X14 X19-X23: flow คลิป ตั้งแต่หยิบสัญญาณจนอนุมัติ (RPC จริงทุกขั้น)
  ----------------------------------------------------------------------------
  v_sig := analytics.content_signal_capture(v_shop, 'craft_moment', 'verify-0159 สัญญาณช่างขัดแหวน', 'owner');
  v_s1 := analytics.content_signal_pick(v_shop, v_sig, 'verify-0159 flow คลิป', 'short_clip', 'tiktok', 'jewelry_925', 'owner');
  v_log := v_log || pg_temp.vb('K12a', 'pick: สัญญาณ picked + picked_step_id ชี้ step ใหม่ · ล้าง review_on/reason',
    (select s.status = 'picked' and s.picked_step_id = v_s1 and s.review_on is null and s.status_reason is null
       from analytics.content_signal s where s.id = v_sig));
  v_log := v_log || pg_temp.vb('K12b', 'pick สร้าง idea: piece/status = idea/todo · artifact short_form_clip 1 ตัว (todo) · line_audience null',
    pg_temp.st(v_s1) = 'idea/todo'
    and (select count(*) = 1 and bool_and(artifact_type = 'short_form_clip' and status = 'todo') from analytics.step_artifact where step_id = v_s1)
    and (select line_audience is null from analytics.campaign_step where id = v_s1), pg_temp.st(v_s1));
  v_log := v_log || pg_temp.vb('K18a', 'R18: idea = wrapper campaign anchor null ⇒ v_campaign_board 1 แถว resolved_start/days_until null · v_content_piece 1 แถว',
    (select c.anchor_date is null from analytics.campaign c join analytics.campaign_step s on s.campaign_id = c.id where s.id = v_s1)
    and (select count(*) = 1 and bool_and(resolved_start is null and days_until is null) from analytics.v_campaign_board where step_id = v_s1)
    and (select count(*) from analytics.v_content_piece where step_id = v_s1) = 1);
  v_log := v_log || pg_temp.vb('K18b', 'บอร์ดเดิม select ทุกแถวได้ขณะมี idea (R18 query ตรวจหลัง apply)',
    (select count(*) from analytics.v_campaign_board where resolved_start is null) >= 1
    and (select count(*) from analytics.v_campaign_board) = (select count(*) from analytics.campaign_step));
  v_log := v_log || pg_temp.vb('K12c', 'event create (payload.signal_id) + view.source_signal_id ชี้สัญญาณ',
    (select count(*) from analytics.content_piece_event where step_id = v_s1 and event_kind = 'create' and payload ->> 'signal_id' = v_sig::text) = 1
    and (select source_signal_id from analytics.v_content_piece where step_id = v_s1) = v_sig);

  -- X21: หยิบซ้ำ / ไม่ใช้
  begin
    perform analytics.content_signal_pick(v_shop, v_sig, 'ซ้ำ', 'short_clip', 'tiktok', 'jewelry_925', 'owner');
    v_r := 'FAIL ผ่านทั้งที่ควรปฏิเสธ';
  exception when others then
    get stacked diagnostics v_txt = pg_exception_detail;
    v_r := case when sqlstate = '55000' and v_txt = v_s1::text then 'OK 55000 detail=picked_step_id' else 'FAIL sqlstate=' || sqlstate || ' detail=' || coalesce(v_txt, '') end;
  end;
  v_log := v_log || pg_temp.vl('X21a', 'pick สัญญาณที่ picked แล้ว → 55000 + picked_step_id ใน detail', v_r);
  v_sig2 := analytics.content_signal_capture(v_shop, 'craft_moment', 'verify-0159 สัญญาณไม่ใช้', 'owner');
  perform analytics.content_signal_set_status(v_shop, v_sig2, 'rejected', 'ทดสอบ', null, 'owner');
  v_log := v_log || pg_temp.vl('X21b', 'pick สัญญาณ rejected → 55000',
    pg_temp.vx(format('select analytics.content_signal_pick(%L::uuid,%L::uuid,''x'',''short_clip'',''tiktok'',''jewelry_925'',''owner'')', v_shop, v_sig2), array['55000'], 'ไม่ใช้'));

  -- X19 / X20: create
  v_log := v_log || pg_temp.vl('X19', 'AI สร้างชิ้นพร้อม p_date → 22023 (วางปฏิทินเองไม่ได้)',
    pg_temp.vx(format('select analytics.content_piece_create(%L::uuid,''x'',''short_clip'',''tiktok'',''jewelry_925'',''ai'',%L::date)', v_shop, v_today + 3), array['22023'], 'วางปฏิทิน'));
  v_log := v_log || pg_temp.vl('X20a', 'create short_clip + channel line_oa → 22023 (kind↔channel)',
    pg_temp.vx(format('select analytics.content_piece_create(%L::uuid,''x'',''short_clip'',''line_oa'',''jewelry_925'',''owner'')', v_shop), array['22023'], 'ใช้กับช่องทาง'));
  v_log := v_log || pg_temp.vl('X20b', 'create ใส่ campaign ของร้านอื่น → 22023',
    pg_temp.vx(format('select analytics.content_piece_create(%L::uuid,''x'',''short_clip'',''tiktok'',''jewelry_925'',''owner'',%L::date,null,%L::uuid)', v_shop, v_today + 3, v_camp2), array['22023'], 'ไม่พบแคมเปญ'));
  select s.campaign_id into v_camp from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id
   where c.anchor_date is not null and c.shop_id = v_shop group by s.campaign_id having count(*) > 1 limit 1;
  v_log := v_log || pg_temp.vl('X20c', 'create ใส่แคมเปญหลาย step ที่มี anchor แต่ p_date null → 22023',
    pg_temp.vx(format('select analytics.content_piece_create(%L::uuid,''x'',''short_clip'',''tiktok'',''jewelry_925'',''owner'',null,null,%L::uuid)', v_shop, v_camp), array['22023'], 'ต้องระบุวัน'));

  -- X13 / X14 / X22 / X23c: idea → planned
  v_log := v_log || pg_temp.vl('X13', 'advance planned จาก idea ที่ anchor_date null → 55000',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_s1, 'planned', 'owner'), array['55000'], 'ยังไม่ได้ตั้งวัน'));
  v_log := v_log || pg_temp.vl('X23c', 'AI set_plan บนชิ้น planned/นอก idea → 42501 (idea ก็ตั้ง date ไม่ได้)',
    pg_temp.vx(pg_temp.q_plan(v_shop, v_s1, jsonb_build_object('date', (v_today + 3)::text), 'ai'), array['42501']));
  v_log := v_log || pg_temp.vl('K12d', 'AI เสนอสมมติฐานบน idea ได้ (hypothesis/metric/baseline ฯลฯ)',
    pg_temp.vok(pg_temp.q_plan(v_shop, v_s1, jsonb_build_object('hypothesis', 'verify: เปิดด้วยคำถามได้ save สูงกว่า', 'metric_code', 'save_rate'), 'ai')));
  v_log := v_log || pg_temp.vl('X22a', 'set_plan key พิมพ์ผิด (hypotesis) → 22023',
    pg_temp.vx(pg_temp.q_plan(v_shop, v_s1, jsonb_build_object('hypotesis', 'x'), 'owner'), array['22023'], 'ไม่รู้จัก'));
  v_log := v_log || pg_temp.vl('X22b', 'set_plan baseline_value "NaN" → 22023 (trap #4)',
    pg_temp.vx(pg_temp.q_plan(v_shop, v_s1, jsonb_build_object('baseline_value', 'NaN'), 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('X22b2', 'set_plan pass_threshold "Infinity" / ตัวเลขเกินเพดาน → 22023',
    pg_temp.vx(pg_temp.q_plan(v_shop, v_s1, jsonb_build_object('pass_threshold', 'Infinity'), 'owner'), array['22023'])
    || pg_temp.vx(pg_temp.q_plan(v_shop, v_s1, jsonb_build_object('baseline_value', 1e13), 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('X22c', 'set_plan baseline_as_of พรุ่งนี้ → 22023 (วันไทย)',
    pg_temp.vx(pg_temp.q_plan(v_shop, v_s1, jsonb_build_object('baseline_as_of', (v_today + 1)::text), 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('X22d', 'set_plan line_audience บนชิ้นที่ไม่ใช่ line_message → 22023',
    pg_temp.vx(pg_temp.q_plan(v_shop, v_s1, jsonb_build_object('line_audience', 'all'), 'owner'), array['22023'], 'line_message'));
  -- ตั้งวัน + สมมติฐานครบยกเว้นเกณฑ์ → X14
  perform analytics.content_piece_set_plan(v_shop, v_s1,
    jsonb_build_object('date', (v_today + 3)::text, 'hypothesis', 'verify: เปิดด้วยคำถามได้ save สูงกว่า', 'metric_code', 'save_rate',
                       'baseline_value', 0, 'baseline_as_of', v_today::text, 'time_slot', 'before_live', 'start_time', '20:30'), 'owner');
  v_log := v_log || pg_temp.vl('X14', 'advance planned ที่ metric=save_rate แต่ pass_threshold/pass_op ว่าง → 55000 (baseline_value=0 ต้องผ่านด่าน — trap #13)',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_s1, 'planned', 'owner'), array['55000'], 'เกณฑ์ผ่าน'));
  v_log := v_log || pg_temp.vb('X14b', 'ข้อความ X14 ไม่ฟ้อง baseline_value (ค่า 0 คือค่าจริง ไม่ใช่ว่าง)',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_s1, 'planned', 'owner'), array['55000'], 'pass_threshold') like 'OK%'
    and pg_temp.vx(pg_temp.q_adv(v_shop, v_s1, 'planned', 'owner'), array['55000'], 'baseline_value') like 'FAIL%');
  v_j := analytics.content_piece_set_plan(v_shop, v_s1,
    jsonb_build_object('pass_threshold', 0.01, 'pass_op', '>=', 'baseline_spread', 0.005), 'owner');
  v_log := v_log || pg_temp.vb('K12e', 'set_plan คืน changed + resolved_start = วันที่ตั้ง · event plan บันทึก diff from→to',
    (v_j ->> 'resolved_start')::date = v_today + 3 and v_j -> 'changed' @> '["pass_op","pass_threshold"]'::jsonb
    and (select count(*) from analytics.content_piece_event where step_id = v_s1 and event_kind = 'plan'
          and payload -> 'changed' -> 'pass_threshold' ->> 'to' = '0.01') = 1, v_j::text);
  v_log := v_log || pg_temp.vb('K12f', 'v_content_piece: threshold_too_narrow = true (|0.01-0| ≥ spread 0.005 ⇒ false) · days_until = 3 วันไทย',
    (select threshold_too_narrow is false and days_until = 3 from analytics.v_content_piece where step_id = v_s1));
  perform analytics.content_piece_advance(v_shop, v_s1, 'planned', 'owner');
  v_log := v_log || pg_temp.vb('K12g', 'idea → planned: projection scheduled', pg_temp.st(v_s1) = 'planned/scheduled', pg_temp.st(v_s1));

  -- planned → drafting (system) · hook · ai draft
  perform analytics.content_piece_advance(v_shop, v_s1, 'drafting', 'system');
  v_log := v_log || pg_temp.vb('K12h', 'planned → drafting โดย system: projection active', pg_temp.st(v_s1) = 'drafting/active', pg_temp.st(v_s1));
  v_log := v_log || pg_temp.vl('X23a', 'set_plan date บนชิ้น drafting → 55000 (ใช้ content_piece_defer)',
    pg_temp.vx(pg_temp.q_plan(v_shop, v_s1, jsonb_build_object('date', (v_today + 4)::text), 'owner'), array['55000'], 'defer'));
  v_log := v_log || pg_temp.vl('X12', 'advance idea จาก drafting (ย้อน 2 ขั้น) → 55000',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_s1, 'idea', 'owner'), array['55000'], '1 ขั้น'));
  v_log := v_log || pg_temp.vl('X11a', 'AI ย้อน drafting → planned → 42501',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_s1, 'planned', 'ai'), array['42501']));
  select a.id into v_a1 from analytics.step_artifact a where a.step_id = v_s1;
  v_hA := analytics.content_hook_upsert(v_shop, v_s1, 'A', 'verify ai hook A', 'question', null, 'ai', null);
  v_log := v_log || pg_temp.vl('X15a', 'advance in_review คลิปที่ hook ติดประเภทแค่ 1 ประเภท (และไม่มี shot list) → 55000 บอกจำนวนประเภท',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_s1, 'in_review', 'ai'), array['55000'], 'ประเภทต่างกันอย่างน้อย 2'));
  v_hB := analytics.content_hook_upsert(v_shop, v_s1, 'B', 'verify ai hook B', 'fact', null, 'ai', null);
  v_log := v_log || pg_temp.vl('X15b', 'hook ครบ 2 ประเภทแต่ artifact ไม่มี shots → 55000 (shot list)',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_s1, 'in_review', 'ai'), array['55000'], 'shot list'));
  perform analytics.campaign_ai_draft_artifact(v_a1, 'verify ai body',
    jsonb_build_object('segments', jsonb_build_array(jsonb_build_object('role', 'hook')),
      'shots', jsonb_build_array(jsonb_build_object('id', 's1', 'desc', 'เปิดคำถาม [ต้องยืนยัน: ราคา "925" วันนี้ \ เท่าไร]'),
                                 jsonb_build_object('id', 's2', 'desc', 'โชว์ตรา [ต้องยืนยัน: มีสต็อกไหม] อีกครั้ง [ต้องยืนยัน: มีสต็อกไหม]'))),
    'verify-model');
  v_log := v_log || pg_temp.vb('K6a', 'campaign_ai_draft_artifact บน step drafting: เขียนได้ (artifact todo → draft_pending_review ผ่าน trigger R4)',
    pg_temp.art_st(v_s1) = 'draft_pending_review', pg_temp.art_st(v_s1));
  v_log := v_log || pg_temp.vb('K6b', 'ร่างใหม่ → trigger extract รายการ [ต้องยืนยัน] เอง (2 key — ซ้ำในชิ้นเดียวนับ 1)',
    (select count(*) from analytics.content_confirm_item where step_id = v_s1 and resolved_at is null and removed_at is null) = 2);
  perform analytics.content_piece_advance(v_shop, v_s1, 'in_review', 'ai');
  v_log := v_log || pg_temp.vb('K12i', 'drafting → in_review โดย ai: projection active · drafted_by_ai = true · artifact ยัง draft_pending_review',
    pg_temp.st(v_s1) = 'in_review/active' and (select drafted_by_ai from analytics.campaign_step where id = v_s1) is true
    and pg_temp.art_st(v_s1) = 'draft_pending_review', pg_temp.st(v_s1) || ' ' || pg_temp.art_st(v_s1));

  -- ด่านอนุมัติ ตามลำดับ
  v_log := v_log || pg_temp.vl('X1', 'AI advance approved → 42501 (content_actor_assert ต่อ p_to)',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_s1, 'approved', 'ai'), array['42501']));
  v_log := v_log || pg_temp.vl('X11b', 'AI ส่งกลับ in_review → drafting (reason ครบ) → 42501',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_s1, 'drafting', 'ai', 'ไม่ผ่านเกณฑ์'), array['42501']));
  v_log := v_log || pg_temp.vl('X10', 'owner ส่งกลับ in_review → drafting โดยไม่มีเหตุผล → 22023',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_s1, 'drafting', 'owner'), array['22023']));
  v_log := v_log || pg_temp.vl('X8', 'advance produced จาก in_review (ข้ามอนุมัติ) → 55000',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_s1, 'produced', 'owner'), array['55000'], 'ทีละขั้น'));
  v_log := v_log || pg_temp.vl('X8b', 'advance posted จาก in_review → 55000',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_s1, 'posted', 'owner'), array['55000']));
  v_log := v_log || pg_temp.vl('X2a', 'approve ตอนไม่มีผลตรวจสักด่าน → 55000 ระบุ risk_owner ไม่มีผล',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_s1, 'approved', 'owner'), array['55000'], 'risk_owner ยังไม่มีผลตรวจ'));
  v_log := v_log || pg_temp.vl('X24a', 'AI ตั้ง risk_owner = passed → 42501',
    pg_temp.vx(pg_temp.q_gate(v_shop, v_s1, 'risk_owner', 'passed', 'ai'), array['42501'], 'เจ้าของตอบ'));
  v_log := v_log || pg_temp.vl('X24a2', 'AI ตั้ง fact_check = na → 42501 (ตัดสินใจ G)',
    pg_temp.vx(pg_temp.q_gate(v_shop, v_s1, 'fact_check', 'na', 'ai'), array['42501']));
  v_log := v_log || pg_temp.vl('X24b', 'AI ตั้ง risk_owner pending โดยไม่มี detail.question → 22023',
    pg_temp.vx(pg_temp.q_gate(v_shop, v_s1, 'risk_owner', 'pending', 'ai'), array['22023'], 'question'));
  v_log := v_log || pg_temp.vl('X24d', 'p_detail เป็น array / jsonb null → 22023',
    pg_temp.vx(pg_temp.q_gate(v_shop, v_s1, 'fact_check', 'passed', 'owner', '[1]'::jsonb), array['22023'], 'object')
    || pg_temp.vx(pg_temp.q_gate(v_shop, v_s1, 'fact_check', 'passed', 'owner', 'null'::jsonb), array['22023'], 'object'));
  v_log := v_log || pg_temp.vl('X24e', 'detail.sources มี javascript:/data: หรือ user@ → 22023',
    pg_temp.vx(pg_temp.q_gate(v_shop, v_s1, 'fact_check', 'passed', 'owner', jsonb_build_object('sources', jsonb_build_array('javascript:alert(1)'))), array['22023'], 'ลิงก์')
    || pg_temp.vx(pg_temp.q_gate(v_shop, v_s1, 'fact_check', 'passed', 'owner', jsonb_build_object('sources', jsonb_build_array('https://good.com@evil.com/x'))), array['22023'], 'ลิงก์'));
  v_log := v_log || pg_temp.vl('X24f', 'detail key นอกรายการของด่าน → 22023',
    pg_temp.vx(pg_temp.q_gate(v_shop, v_s1, 'brand_rule', 'passed', 'owner', jsonb_build_object('question', 'x')), array['22023'], 'ไม่รับ key'));
  v_log := v_log || pg_temp.vl('K12j', 'AI ตั้ง risk_owner pending + question ได้ · AI ตั้ง fact_check passed ได้ · brand passed (owner)',
    pg_temp.vok(pg_temp.q_gate(v_shop, v_s1, 'risk_owner', 'pending', 'ai', jsonb_build_object('question', 'ขอยืนยันราคาอ้างอิงวันนี้ไหม?')))
    || pg_temp.vok(pg_temp.q_gate(v_shop, v_s1, 'fact_check', 'passed', 'ai', jsonb_build_object('sources', jsonb_build_array('https://example.com/ref'), 'flagged', jsonb_build_array('  ข้อความ' || E'​' || 'ซ่อน  '))))
    || pg_temp.vok(pg_temp.q_gate(v_shop, v_s1, 'brand_rule', 'passed', 'owner', jsonb_build_object('rules_hit', jsonb_build_array('no_roi_claim')))));
  v_log := v_log || pg_temp.vb('K12k', 'detail ถูก clean ก่อนเก็บ (ZWSP/ช่องว่างซ้ำ ตัดแล้ว) · checked_by_role บันทึกตามผู้ตั้ง',
    (select detail -> 'flagged' ->> 0 = 'ข้อความซ่อน' and checked_by_role = 'ai' from analytics.step_gate where step_id = v_s1 and gate_kind = 'fact_check'));
  v_log := v_log || pg_temp.vl('X4', 'approve ตอน [ต้องยืนยัน] ค้าง (และ risk_owner ยัง pending) → 55000 ระบุรายการค้าง',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_s1, 'approved', 'owner'), array['55000'], 'ยืนยัน'));
  v_log := v_log || pg_temp.vb('X39a', 'can_approve (view) = false ตรงกับ RPC ที่ตกตอนนี้',
    (select can_approve is false from analytics.v_content_piece where step_id = v_s1));

  -- X25: resolve
  select i.id into v_item from analytics.content_confirm_item i where i.step_id = v_s1 and i.resolved_at is null and i.question like 'ราคา%' limit 1;
  v_log := v_log || pg_temp.vl('X25a', 'AI ตอบ [ต้องยืนยัน] → 42501',
    pg_temp.vx(format('select analytics.content_confirm_resolve(%L::uuid,%L::uuid,''ตอบ'',''ai'')', v_shop, v_item), array['42501']));
  v_log := v_log || pg_temp.vl('X25b', 'คำตอบมี [ต้องยืนยัน → 22023',
    pg_temp.vx(format('select analytics.content_confirm_resolve(%L::uuid,%L::uuid,%L,''owner'')', v_shop, v_item, 'ยังไม่แน่ใจ [ต้องยืนยัน: x]'), array['22023']));
  v_log := v_log || pg_temp.vl('X25c', 'คำตอบว่าง / ZWSP ล้วน / whitespace ล้วน → 22023',
    pg_temp.vx(format('select analytics.content_confirm_resolve(%L::uuid,%L::uuid,%L,''owner'')', v_shop, v_item, E'​​'), array['22023'])
    || pg_temp.vx(format('select analytics.content_confirm_resolve(%L::uuid,%L::uuid,%L,''owner'')', v_shop, v_item, E' \t\n '), array['22023']));
  v_j := analytics.content_confirm_resolve(v_shop, v_item, 'ตอบ "ทดสอบ" \ — ไทย', 'owner');
  v_log := v_log || pg_temp.vb('K12l', 'resolve: แทนข้อความจริง (≥1 เอกสาร) · เหลือค้าง 1 · clip_brief ยังผ่าน assert_clip_brief_valid · human_edited',
    (v_j ->> 'replaced_in_artifacts')::int >= 1 and (v_j ->> 'remaining_pending')::int = 1
    and (select human_edited from analytics.step_artifact where id = v_a1)
    and (select position('ตอบ "ทดสอบ" \ — ไทย' in clip_brief #>> '{shots,0,desc}') > 0 from analytics.step_artifact where id = v_a1)
    and (select position('[ต้องยืนยัน: มีสต็อกไหม]' in clip_brief #>> '{shots,1,desc}') > 0 from analytics.step_artifact where id = v_a1), v_j::text);
  v_log := v_log || pg_temp.vl('X25d', 'resolve รายการที่ตอบแล้ว → 55000',
    pg_temp.vx(format('select analytics.content_confirm_resolve(%L::uuid,%L::uuid,''อีกที'',''owner'')', v_shop, v_item), array['55000'], 'ตอบไปแล้ว'));
  select i.id into v_item from analytics.content_confirm_item i where i.step_id = v_s1 and i.resolved_at is null and i.removed_at is null limit 1;
  v_j := analytics.content_confirm_resolve(v_shop, v_item, 'มีสต็อก 3 ชิ้น', 'owner');
  v_log := v_log || pg_temp.vb('K12m', 'resolve รายการสุดท้าย (marker ซ้ำ 2 ตำแหน่งแทนครบ) → ไม่มี marker ในข้อความ · remaining 0',
    (v_j ->> 'remaining_pending')::int = 0
    and not (select analytics.content_marker_present(clip_brief::text) or analytics.content_marker_present(content_body) from analytics.step_artifact where id = v_a1)
    and (select clip_brief #>> '{shots,1,desc}' = 'โชว์ตรา มีสต็อก 3 ชิ้น อีกครั้ง มีสต็อก 3 ชิ้น' from analytics.step_artifact where id = v_a1), v_j::text);
  -- ตอบ marker ไม่ล้างผลตรวจ (คำตอบเจ้าของ ≠ เนื้อหาใหม่จาก AI)
  v_log := v_log || pg_temp.vb('K12n', 'resolve ไม่ล้างผลตรวจ fact/brand (GUC) · risk_owner ยัง pending',
    (select count(*) from analytics.step_gate where step_id = v_s1 and gate_kind in ('fact_check', 'brand_rule') and status = 'passed') = 2
    and (select status from analytics.step_gate where step_id = v_s1 and gate_kind = 'risk_owner') = 'pending');
  v_log := v_log || pg_temp.vl('X2b', 'ทุกด่านผ่านยกเว้น risk_owner pending (ai ถามค้าง) → approve 55000 ระบุ risk_owner',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_s1, 'approved', 'owner'), array['55000'], 'risk_owner ยังไม่ผ่าน'));
  perform analytics.content_gate_record(v_shop, v_s1, 'brand_rule', 'blocked', 'owner', null, 'ติดคำต้องห้าม');
  perform analytics.content_gate_record(v_shop, v_s1, 'risk_owner', 'passed', 'owner', jsonb_build_object('answer', 'เจ้าของตอบแล้ว'));
  v_log := v_log || pg_temp.vl('X3', 'ผลตรวจครบแต่ brand_rule = blocked → approve 55000 ระบุ brand_rule',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_s1, 'approved', 'owner'), array['55000'], 'brand_rule ยังไม่ผ่าน'));
  v_log := v_log || pg_temp.vb('K16a', 'ด่านที่ blocked ทำให้บอร์ดเก่าเห็น step = blocked (effective_status) — ตั้งใจ',
    (select effective_status from analytics.v_campaign_board where step_id = v_s1) = 'blocked');
  perform analytics.content_gate_record(v_shop, v_s1, 'brand_rule', 'passed', 'owner');
  v_log := v_log || pg_temp.vb('X39b', 'can_approve (view) = true ก่อนอนุมัติ และ approve_blockers ว่าง',
    (select can_approve from analytics.v_content_piece where step_id = v_s1)
    and cardinality(analytics.content_piece_approve_blockers(v_s1)) = 0);

  ----------------------------------------------------------------------------
  -- X5 (ชั้น 2 ของ approve โดยตัดชั้น 1 ออก) · stale-gate (K6c) · อนุมัติ · เส้นทางเดิมที่ต้องถูกปิด (X26-X29)
  ----------------------------------------------------------------------------
  -- เพิ่ม marker ใหม่ผ่านเส้นทางเดิม (campaign_set_artifact_content บน step in_review = ทำได้) → ผลตรวจ fact/brand ตกเป็น pending
  perform analytics.campaign_set_artifact_content(v_a1, null,
    jsonb_build_object('segments', jsonb_build_array(jsonb_build_object('role', 'hook')),
      'shots', jsonb_build_array(jsonb_build_object('id', 's1', 'desc', 'เปิดคำถาม [ต้องยืนยัน: สีอะไรดี]'),
                                 jsonb_build_object('id', 's2', 'desc', 'โชว์ตรา'))));
  v_log := v_log || pg_temp.vb('K6c', 'เนื้อหาเปลี่ยนจริงตอน in_review → fact/brand ตกเป็น pending (+ หมายเหตุ) · risk_owner คงค่า (K6)',
    (select count(*) from analytics.step_gate where step_id = v_s1 and gate_kind in ('fact_check', 'brand_rule') and status = 'pending' and note like '%เนื้อหาเปลี่ยน%') = 2
    and (select status from analytics.step_gate where step_id = v_s1 and gate_kind = 'risk_owner') = 'passed'
    and (select count(*) from analytics.content_piece_event where step_id = v_s1 and event_kind = 'gate' and payload ->> 'reset' = 'true') = 1);
  v_log := v_log || pg_temp.vb('K6d', 'extract รันเอง: marker ใหม่ได้รายการค้าง 1 (สีอะไรดี)',
    (select count(*) from analytics.content_confirm_item where step_id = v_s1 and resolved_at is null and removed_at is null and question = 'สีอะไรดี') = 1);
  perform analytics.content_gate_record(v_shop, v_s1, 'fact_check', 'passed', 'owner');
  perform analytics.content_gate_record(v_shop, v_s1, 'brand_rule', 'passed', 'owner');
  -- จำลอง "extract ไม่เคยรัน" โดยถอดรายการออก → เหลือเฉพาะชั้น 2 (ข้อความจริง) ที่ต้องกัน
  update analytics.content_confirm_item set removed_at = now() where step_id = v_s1 and resolved_at is null and removed_at is null;
  v_log := v_log || pg_temp.vl('X5', 'รายการ [ต้องยืนยัน] ว่าง/ถอดแล้ว แต่ marker ยังอยู่ในข้อความ → approve 55000 (ชั้น 2 · ข้อบล็อกมีข้อเดียว)',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_s1, 'approved', 'owner'), array['55000'], 'ค้างอยู่ในข้อความ')
    || case when cardinality(analytics.content_piece_approve_blockers(v_s1)) = 1 then 'OK มีข้อบล็อกข้อเดียว' else 'FAIL ข้อบล็อกไม่ใช่ 1 ข้อ' end);
  v_log := v_log || pg_temp.vb('X39c', 'can_approve (view) = false สอดคล้อง RPC ที่ตกด้วยชั้น 2',
    (select can_approve is false and confirm_marker_in_text and confirm_pending = 0 from analytics.v_content_piece where step_id = v_s1));
  perform analytics.campaign_set_artifact_content(v_a1, null,
    jsonb_build_object('segments', jsonb_build_array(jsonb_build_object('role', 'hook')),
      'shots', jsonb_build_array(jsonb_build_object('id', 's1', 'desc', 'เปิดคำถาม'), jsonb_build_object('id', 's2', 'desc', 'โชว์ตรา'))));
  perform analytics.content_gate_record(v_shop, v_s1, 'fact_check', 'passed', 'owner');
  perform analytics.content_gate_record(v_shop, v_s1, 'brand_rule', 'passed', 'owner');
  v_log := v_log || pg_temp.vb('X39d', 'ลบ marker ออกจากข้อความ + ผ่านด่านครบ → can_approve = true ตรง approve_blockers ว่าง',
    (select can_approve from analytics.v_content_piece where step_id = v_s1));

  perform analytics.content_piece_advance(v_shop, v_s1, 'approved', 'owner', null, 45);
  v_log := v_log || pg_temp.vb('K12o', 'in_review → approved: projection active · artifact approved + reviewed_at · event มี review_seconds=45 + snapshot 3 ด่าน',
    pg_temp.st(v_s1) = 'approved/active' and pg_temp.art_st(v_s1) = 'approved'
    and (select reviewed_at is not null from analytics.step_artifact where id = v_a1)
    and (select review_seconds = 45 and payload -> 'gates' ?& array['fact_check', 'brand_rule', 'risk_owner']
           from analytics.content_piece_event where step_id = v_s1 and to_status = 'approved' order by seq desc limit 1)
    and (select approved_by_role = 'owner' and approved_at is not null from analytics.v_content_piece where step_id = v_s1), pg_temp.st(v_s1));

  v_log := v_log || pg_temp.vl('X27', 'campaign_set_artifact_content เปลี่ยนเนื้อหาบน step approved → 55000 (R4 ข้อ 1)',
    pg_temp.vx(format('select analytics.campaign_set_artifact_content(%L::uuid, %L)', v_a1, 'แก้หลังอนุมัติ'), array['55000'], 'ห้ามแก้เนื้อหา'));
  v_log := v_log || pg_temp.vl('X26b', 'campaign_set_artifact_status บน step approved → draft/done ทุกค่า = 55000',
    pg_temp.vx(format('select analytics.campaign_set_artifact_status(%L::uuid, ''draft'')', v_a1), array['55000'])
    || pg_temp.vx(format('select analytics.campaign_set_artifact_status(%L::uuid, ''done'')', v_a1), array['55000']));
  v_log := v_log || pg_temp.vl('X29', 'campaign_delete_step บน step approved → 55000 (ยกเลิกแทน)',
    pg_temp.vx(format('select analytics.campaign_delete_step(%L::uuid)', v_s1), array['55000'], 'ยกเลิก'));
  v_log := v_log || pg_temp.vl('X28b', 'UPDATE campaign_step set status=done (service_role/postgres ตรง) บน step ที่มี piece_status → 55000',
    pg_temp.vx(format('update analytics.campaign_step set status = ''done'' where id = %L::uuid', v_s1), array['55000'], 'projection'));
  v_log := v_log || pg_temp.vl('X28a', 'UPDATE campaign_step set piece_status=approved ตรง บนชิ้น (planned→approved ข้ามด่าน) → 55000',
    pg_temp.vx(format('update analytics.campaign_step set piece_status = ''posted'' where id = %L::uuid', v_s1), array['55000'], 'RPC'));
  v_log := v_log || pg_temp.vl('X28d', 'UPDATE piece_status ตรงบน step นอก workflow (เสกเข้า workflow โดยไม่ผ่าน RPC) → 55000',
    pg_temp.vx(format('update analytics.campaign_step set piece_status = ''planned'' where id = (select s.id from analytics.campaign_step s where s.piece_status is null limit 1)'), array['55000'], 'RPC'));
  v_log := v_log || pg_temp.vl('X28e', 'UPDATE hold_reason ตรง → 55000',
    pg_temp.vx(format('update analytics.campaign_step set hold_reason = ''x'' where id = %L::uuid', v_s1), array['55000']));
  v_log := v_log || pg_temp.vl('X28c', 'INSERT campaign_step ที่ส่ง piece_status มาตรง (เสกชิ้น approved) → 55000',
    pg_temp.vx(format('insert into analytics.campaign_step (campaign_id, shop_id, seq, step_kind, offset_start_days, piece_status) select campaign_id, shop_id, 99, ''content_task'', 0, ''approved'' from analytics.campaign_step where id = %L::uuid', v_s1), array['55000'], 'content_piece_create'));
  v_log := v_log || pg_temp.vl('X30a', 'UPDATE content_piece_event → 42501 (append-only)',
    pg_temp.vx(format('update analytics.content_piece_event set reason = ''x'' where step_id = %L::uuid', v_s1), array['42501']));
  v_log := v_log || pg_temp.vl('X30b', 'DELETE content_piece_event ตรง (step ยังอยู่) → 42501',
    pg_temp.vx(format('delete from analytics.content_piece_event where step_id = %L::uuid', v_s1), array['42501']));
  v_log := v_log || pg_temp.vl('X30c', 'TRUNCATE content_piece_event → 42501',
    pg_temp.vx('truncate analytics.content_piece_event', array['42501']));
  v_log := v_log || pg_temp.vl('X23a2', 'set_plan hypothesis บนชิ้น approved → 55000 (ส่งกลับก่อน) · แต่ footage/shoot ตั้งได้',
    pg_temp.vx(pg_temp.q_plan(v_shop, v_s1, jsonb_build_object('hypothesis', 'แก้หลังอนุมัติ'), 'owner'), array['55000'], 'ส่งกลับ')
    || pg_temp.vok(pg_temp.q_plan(v_shop, v_s1, jsonb_build_object('footage_status', 'needs_shoot', 'shoot_location', 'product_table', 'shoot_minutes_est', 20, 'footage_url', 'https://drive.example.com/f/1'), 'owner')));
  v_log := v_log || pg_temp.vl('X24c', 'gate_record บน step approved → 55000 (ส่งกลับก่อน)',
    pg_temp.vx(pg_temp.q_gate(v_shop, v_s1, 'fact_check', 'pending', 'owner'), array['55000'], 'ส่งกลับ'));
  -- K5: ติ๊ก shot บน step approved ต้องทำได้ ไม่ใช่การแก้เนื้อหา · ไม่ล้างผลตรวจ
  v_txt := (select analytics.content_piece_brief_norm(clip_brief)::text from analytics.step_artifact where id = v_a1);
  v_r := pg_temp.vok(format('select analytics.campaign_toggle_clip_shot(%L::uuid, ''s1'', true)', v_a1));
  v_log := v_log || pg_temp.vl('K5a', 'campaign_toggle_clip_shot บน step approved ทำงาน (ติ๊ก shot ≠ แก้เนื้อหา) · ไม่เปลี่ยนสถานะ/ผลตรวจ',
    case when v_r <> 'OK' then v_r
         when (select (clip_brief #>> '{shots,0,done}')::boolean from analytics.step_artifact where id = v_a1)
              and v_txt = (select analytics.content_piece_brief_norm(clip_brief)::text from analytics.step_artifact where id = v_a1)
              and pg_temp.st(v_s1) = 'approved/active'
              and (select count(*) from analytics.step_gate where step_id = v_s1 and status = 'passed') = 3
         then 'OK' else 'FAIL ติ๊ก shot กระทบสถานะ/ผลตรวจ/เนื้อหา: ' || pg_temp.st(v_s1) end);

  -- X9 + ข้าม produced (H) + produced + posted ผ่าน helper (content_piece_post = 0160)
  v_log := v_log || pg_temp.vl('X9a', 'advance posted จาก approved โดย footage_status=needs_shoot (ยังไม่ถ่าย) → 55000',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_s1, 'posted', 'owner'), array['55000'], 'ภาพ'));
  perform analytics.content_piece_advance(v_shop, v_s1, 'produced', 'owner');
  v_log := v_log || pg_temp.vb('K12p', 'approved → produced: projection active · footage_status needs_shoot → shot',
    pg_temp.st(v_s1) = 'produced/active' and (select footage_status from analytics.campaign_step where id = v_s1) = 'shot', pg_temp.st(v_s1));
  v_log := v_log || pg_temp.vl('X9', 'advance posted บน short_clip (ไม่ผ่าน content_piece_post · p_post_id null) → 55000',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_s1, 'posted', 'owner'), array['55000'], 'content_piece_post'));
  v_post := analytics.content_post_upsert(v_shop, 'tiktok', 'verify-0159-ext-1', 'https://www.tiktok.com/@verify/video/1',
                                          now() - interval '1 day', null, v_a1, 'verify');
  v_log := v_log || pg_temp.vl('K12q', 'helper posted ด้วยโพสต์ที่ยังไม่ผูก step (หรือผูก step อื่น) → 55000',
    pg_temp.vx(format('select analytics.content_piece_transition_(%L::uuid,%L::uuid,''posted'',''owner'',null,null,%L::uuid)', v_shop, v_s1, v_post), array['55000'], 'ผูกกับชิ้นงานนี้'));
  update analytics.content_post set step_id = v_s1, hook_id = v_hA where id = v_post;
  v_log := v_log || pg_temp.vl('K12q2', 'helper: p_post_id ใช้กับ p_to ≠ posted → 22023',
    pg_temp.vx(format('select analytics.content_piece_transition_(%L::uuid,%L::uuid,''produced'',''owner'',null,null,%L::uuid)', v_shop, v_s1, v_post), array['22023']));
  v_j := analytics.content_piece_transition_(v_shop, v_s1, 'posted', 'owner', null, null, v_post);
  v_log := v_log || pg_temp.vb('K12r', 'produced → posted (helper + โพสต์ผูกแล้ว): projection done · artifact done · event post (payload.post_id)',
    pg_temp.st(v_s1) = 'posted/done' and pg_temp.art_st(v_s1) = 'done'
    and (select count(*) from analytics.content_piece_event where step_id = v_s1 and event_kind = 'post' and payload ->> 'post_id' = v_post::text) = 1, v_j::text);
  v_log := v_log || pg_temp.vb('K12s', 'v_content_piece: effective_piece_status = measuring (โพสต์เมื่อวานวันไทย) · posts 1 รายการ · posted_on ตรง content_post.posted_date_th',
    (select effective_piece_status = 'measuring' and jsonb_array_length(posts) = 1 and posted_on = (select posted_date_th from analytics.content_post where id = v_post)
       and t7_captured is null from analytics.v_content_piece where step_id = v_s1));
  v_log := v_log || pg_temp.vl('X16a', 'cancelled จาก posted → 55000',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_s1, 'cancelled', 'owner', 'ทดสอบ'), array['55000'], 'โพสต์แล้ว'));
  v_log := v_log || pg_temp.vl('X29b', 'campaign_delete_step บน step posted → 55000',
    pg_temp.vx(format('select analytics.campaign_delete_step(%L::uuid)', v_s1), array['55000']));
  v_log := v_log || pg_temp.vl('K12t', 'unpost ขณะโพสต์ยัง active → 55000 (ต้องลบ/ปลดโพสต์ก่อน) · unpost ไป approved (ข้าม produced) → 55000',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_s1, 'produced', 'owner', 'ย้อนทดสอบ'), array['55000'], 'โพสต์')
    || pg_temp.vx(pg_temp.q_adv(v_shop, v_s1, 'approved', 'owner', 'ย้อนทดสอบ'), array['55000'], 'ได้เฉพาะไป produced'));
  perform analytics.content_post_set_status(v_shop, v_post, 'deleted');
  v_log := v_log || pg_temp.vl('K12u', 'unpost โดยไม่มีเหตุผล → 22023',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_s1, 'produced', 'owner'), array['22023']));
  perform analytics.content_piece_advance(v_shop, v_s1, 'produced', 'owner', 'โพสต์ถูกลบ ย้อนกลับมาแก้');
  v_log := v_log || pg_temp.vb('K12v', 'posted → produced (หลังลบโพสต์): projection active · artifact done → approved · event unpost',
    pg_temp.st(v_s1) = 'produced/active' and pg_temp.art_st(v_s1) = 'approved'
    and (select count(*) from analytics.content_piece_event where step_id = v_s1 and event_kind = 'unpost' and reason like '%ย้อนกลับ%') = 1, pg_temp.st(v_s1));
  v_log := v_log || pg_temp.vl('X18', 'advance ใส่ shop ต่างร้าน / step ที่ไม่มี → 22023 (ไม่ lock ข้ามร้าน)',
    pg_temp.vx(pg_temp.q_adv(v_shop2, v_s1, 'in_review', 'owner'), array['22023'], 'ไม่พบชิ้นงาน')
    || pg_temp.vx(pg_temp.q_adv(v_shop, gen_random_uuid(), 'in_review', 'owner'), array['22023'], 'ไม่พบชิ้นงาน'));

  ----------------------------------------------------------------------------
  -- X26 · K16 hold/resume · X16 · K15 ส่งกลับ · K17 cancel/restore (ชิ้นที่ 2 ผ่าน RPC จริง)
  ----------------------------------------------------------------------------
  v_s2 := pg_temp.mk_step(v_shop, 'short_clip', 'tiktok', true);
  select a.id into v_a2 from analytics.step_artifact a where a.step_id = v_s2;
  v_log := v_log || pg_temp.vb('K12w', 'mk_step ผ่าน RPC: in_review/active · [ต้องยืนยัน] ค้าง 3 รายการ (ในเนื้อหา/ใน brief ที่ escape แล้ว/สต็อก)',
    pg_temp.st(v_s2) = 'in_review/active'
    and (select count(*) from analytics.content_confirm_item where step_id = v_s2 and resolved_at is null and removed_at is null) = 3, pg_temp.st(v_s2));
  v_log := v_log || pg_temp.vl('X26', 'campaign_set_artifact_status(approved/done/blocked) บน artifact ของ step ที่ in_review → 55000 (ข้าม 3 ด่านไม่ได้)',
    pg_temp.vx(format('select analytics.campaign_set_artifact_status(%L::uuid, ''approved'')', v_a2), array['55000'], 'workflow ใหม่')
    || pg_temp.vx(format('select analytics.campaign_set_artifact_status(%L::uuid, ''done'')', v_a2), array['55000'])
    || pg_temp.vx(format('select analytics.campaign_set_artifact_status(%L::uuid, ''blocked'')', v_a2), array['55000']));
  v_log := v_log || pg_temp.vl('K6e', 'status ขยับภายใน todo/draft/draft_pending_review ผ่านเส้นทางเดิมยังได้ (ตัดสินใจ A) · อนุมัติไม่ได้',
    pg_temp.vok(format('select analytics.campaign_set_artifact_status(%L::uuid, ''draft_pending_review'')', v_a2)));
  v_log := v_log || pg_temp.vb('X26c', 'ข้อผิดพลาดที่แอปเดิมเห็นเป็น 55000 (ไม่ใช่ 22023 ที่ marketing.ts แปลเป็นข้อความ silver_bar)',
    pg_temp.vx(format('select analytics.campaign_set_artifact_status(%L::uuid, ''approved'')', v_a2), array['22023']) like 'FAIL%');

  -- hold / resume
  v_log := v_log || pg_temp.vl('X16b', 'hold โดยไม่มีเหตุผล → 22023', pg_temp.vx(pg_temp.q_adv(v_shop, v_s2, 'hold', 'owner'), array['22023']));
  perform analytics.content_piece_advance(v_shop, v_s2, 'hold', 'owner', 'รอถ่ายภาพเพิ่ม');
  v_log := v_log || pg_temp.vb('K16a2', 'hold: piece ยัง in_review · status=blocked + blocked_reason · board effective_status=blocked · view on_hold',
    pg_temp.st(v_s2) = 'in_review/blocked/hold=รอถ่ายภาพเพิ่ม'
    and (select step_blocked_reason from analytics.v_campaign_board where step_id = v_s2) = 'รอถ่ายภาพเพิ่ม'
    and (select effective_status from analytics.v_campaign_board where step_id = v_s2) = 'blocked'
    and (select effective_piece_status from analytics.v_content_piece where step_id = v_s2) = 'on_hold', pg_temp.st(v_s2));
  v_log := v_log || pg_temp.vl('X16c', 'อนุมัติ/ย้อนขณะ hold → 55000 (กด resume ก่อน) · hold ซ้ำ → 55000',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_s2, 'approved', 'owner'), array['55000'], 'resume')
    || pg_temp.vx(pg_temp.q_adv(v_shop, v_s2, 'hold', 'owner', 'ซ้ำ'), array['55000'], 'resume')
    || pg_temp.vx(pg_temp.q_adv(v_shop, v_s2, 'drafting', 'owner', 'ย้อน'), array['55000'], 'resume'));
  perform analytics.content_piece_advance(v_shop, v_s2, 'resume', 'owner');
  v_log := v_log || pg_temp.vb('K16b', 'resume: กลับ in_review/active · hold_reason/blocked_reason ว่าง', pg_temp.st(v_s2) = 'in_review/active'
    and (select blocked_reason is null from analytics.campaign_step where id = v_s2), pg_temp.st(v_s2));
  v_log := v_log || pg_temp.vl('X16d', 'resume ชิ้นที่ไม่ได้ hold → 55000 · p_to = สถานะปัจจุบัน → 55000 · p_to=banana → 22023 · p_review_seconds กับ p_to≠approved → 22023',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_s2, 'resume', 'owner'), array['55000'], 'ไม่ได้รอเงื่อนไข')
    || pg_temp.vx(pg_temp.q_adv(v_shop, v_s2, 'in_review', 'owner'), array['55000'], 'อยู่สถานะ')
    || pg_temp.vx(pg_temp.q_adv(v_shop, v_s2, 'banana', 'owner'), array['22023'])
    || pg_temp.vx(pg_temp.q_adv(v_shop, v_s2, 'drafting', 'owner', 'ย้อนทดสอบ', 30), array['22023'], 'p_review_seconds')
    || pg_temp.vx(pg_temp.q_adv(v_shop, v_s2, 'approved', 'owner', null, -1), array['22023'])
    || pg_temp.vx(pg_temp.q_adv(v_shop, v_s2, 'cancelled', 'owner'), array['22023']));

  -- K15: ส่งกลับ → แก้เนื้อหาผ่านเส้นทางเดิม → extract
  select i.id into v_item from analytics.content_confirm_item i where i.step_id = v_s2 and i.question = 'มีสต็อกไหม';
  perform analytics.content_piece_advance(v_shop, v_s2, 'drafting', 'owner', 'ส่งกลับให้แก้ราคา');
  v_log := v_log || pg_temp.vb('K15a', 'in_review → drafting (reason): projection active', pg_temp.st(v_s2) = 'drafting/active', pg_temp.st(v_s2));
  perform analytics.campaign_set_artifact_content(v_a2, 'verify body [ต้องยืนยัน: มีสต็อกไหม] และ [ต้องยืนยัน: สีอะไร]',
    jsonb_build_object('segments', jsonb_build_array(jsonb_build_object('role', 'hook')),
      'shots', jsonb_build_array(jsonb_build_object('id', 's1', 'desc', 'ถ่ายหน้าโต๊ะ'), jsonb_build_object('id', 's2', 'desc', 'ใกล้ๆ'))));
  v_log := v_log || pg_temp.vb('K15b', 'แก้เนื้อหาตอน drafting: รายการเดิมที่ยังอยู่ไม่ถูก reset (id เดิม ยังค้าง) · รายการใหม่เข้ามา · ที่หายไป removed_at',
    (select resolved_at is null and removed_at is null from analytics.content_confirm_item where id = v_item)
    and (select count(*) from analytics.content_confirm_item where step_id = v_s2 and question = 'สีอะไร' and resolved_at is null and removed_at is null) = 1
    and (select count(*) from analytics.content_confirm_item where step_id = v_s2 and question like 'ราคา%' and removed_at is not null and resolved_at is null) = 2
    and (select count(*) from analytics.content_confirm_item where step_id = v_s2 and resolved_at is null and removed_at is null) = 2);
  perform analytics.content_piece_advance(v_shop, v_s2, 'in_review', 'owner');

  -- K17: cancel → restore
  v_log := v_log || pg_temp.vl('K17a', 'restore ชิ้นที่ไม่ได้ยกเลิก → 55000', pg_temp.vx(pg_temp.q_adv(v_shop, v_s2, 'restore', 'owner', 'ทดสอบ'), array['55000'], 'ไม่ได้ถูกยกเลิก'));
  perform analytics.content_piece_advance(v_shop, v_s2, 'cancelled', 'owner', 'เจ้าของยกเลิกชิ้นนี้');
  v_log := v_log || pg_temp.vb('K17b', 'cancel: piece cancelled · status=blocked · blocked_reason = "ยกเลิก: …" · board effective blocked',
    pg_temp.st(v_s2) = 'cancelled/blocked'
    and (select blocked_reason = 'ยกเลิก: เจ้าของยกเลิกชิ้นนี้' from analytics.campaign_step where id = v_s2)
    and (select effective_piece_status from analytics.v_content_piece where step_id = v_s2) = 'cancelled', pg_temp.st(v_s2));
  v_log := v_log || pg_temp.vl('K17c', 'จาก cancelled ไปสถานะอื่นยกเว้น restore → 55000 · cancel ซ้ำ → 55000 · restore ไม่มีเหตุผล → 22023',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_s2, 'in_review', 'owner'), array['55000'], 'restore')
    || pg_temp.vx(pg_temp.q_adv(v_shop, v_s2, 'cancelled', 'owner', 'ซ้ำ'), array['55000'])
    || pg_temp.vx(pg_temp.q_adv(v_shop, v_s2, 'restore', 'owner'), array['22023']));
  perform analytics.content_piece_advance(v_shop, v_s2, 'restore', 'owner', 'ยกเลิกผิด');
  v_log := v_log || pg_temp.vb('K17d', 'restore: กลับ in_review (จาก event cancel) · projection active · artifact กลับ draft (ร่างโดยคน)',
    pg_temp.st(v_s2) = 'in_review/active' and pg_temp.art_st(v_s2) = 'draft'
    and (select blocked_reason is null from analytics.campaign_step where id = v_s2), pg_temp.st(v_s2) || ' ' || pg_temp.art_st(v_s2));
  v_log := v_log || pg_temp.vb('K17e', 'ลำดับ event (ไม่นับ confirm/gate) เรียงด้วย seq: create,advance,advance,hold,resume,revert,advance,cancel,restore',
    (select string_agg(event_kind, ',' order by seq) from analytics.content_piece_event where step_id = v_s2 and event_kind not in ('confirm', 'gate'))
      = 'create,advance,advance,hold,resume,revert,advance,cancel,restore',
    (select string_agg(event_kind, ',' order by seq) from analytics.content_piece_event where step_id = v_s2));

  ----------------------------------------------------------------------------
  -- Q8 (มติเจ้าของ 7 ต.ค.): ยกเลิกชิ้น → สัญญาณต้นทางกลับ new
  ----------------------------------------------------------------------------
  v_sa := analytics.content_signal_capture(v_shop, 'craft_moment', 'verify-0159 Q8 สัญญาณ A', 'owner');
  v_p1 := analytics.content_signal_pick(v_shop, v_sa, 'verify-0159 Q8 P1', 'short_clip', 'tiktok', 'jewelry_925', 'owner');
  perform analytics.content_piece_advance(v_shop, v_p1, 'cancelled', 'owner', 'ไม่ทำแล้ว');
  v_log := v_log || pg_temp.vb('Q8a', 'ยกเลิกชิ้นที่หยิบจากสัญญาณ → สัญญาณกลับ status=new · ล้าง picked_step_id · event cancel เก็บ signal_ids',
    (select status = 'new' and picked_step_id is null and status_reason is null and review_on is null from analytics.content_signal where id = v_sa)
    and (select payload -> 'signal_ids' @> to_jsonb(array[v_sa::text]) from analytics.content_piece_event where step_id = v_p1 and event_kind = 'cancel'));
  v_p2 := analytics.content_signal_pick(v_shop, v_sa, 'verify-0159 Q8 P2', 'short_clip', 'tiktok', 'jewelry_925', 'owner');
  v_log := v_log || pg_temp.vb('Q8b', 'สัญญาณที่กลับเป็น new หยิบซ้ำได้ → picked ชี้ชิ้นใหม่',
    (select status = 'picked' and picked_step_id = v_p2 from analytics.content_signal where id = v_sa));
  perform analytics.content_piece_advance(v_shop, v_p1, 'restore', 'owner', 'กู้คืนทดสอบ');
  v_log := v_log || pg_temp.vb('Q8c', 'restore ชิ้นเก่าขณะสัญญาณถูกหยิบไปชิ้นใหม่แล้ว → กู้ได้ แต่ไม่ผูกสัญญาณซ้ำ (สัญญาณ 1 ตัวไม่ผูก 2 ชิ้น)',
    pg_temp.st(v_p1) = 'idea/todo'
    and (select status = 'picked' and picked_step_id = v_p2 from analytics.content_signal where id = v_sa)
    and (select payload -> 'signal_rebound' = '[]'::jsonb from analytics.content_piece_event where step_id = v_p1 and event_kind = 'restore' order by seq desc limit 1)
    and (select count(*) from analytics.content_signal where picked_step_id in (v_p1, v_p2) and id = v_sa) = 1);
  perform analytics.content_piece_advance(v_shop, v_p1, 'cancelled', 'owner', 'ยกเลิกอีกรอบ');
  v_log := v_log || pg_temp.vb('Q8d', 'ยกเลิกชิ้นที่สัญญาณถูกหยิบไปชิ้นอื่นแล้ว (picked_step_id ≠ ชิ้นนี้) → สัญญาณไม่ถูกรีเซ็ต · payload.signal_ids ว่าง',
    (select status = 'picked' and picked_step_id = v_p2 from analytics.content_signal where id = v_sa)
    and (select payload -> 'signal_ids' = '[]'::jsonb from analytics.content_piece_event where step_id = v_p1 and event_kind = 'cancel' order by seq desc limit 1));
  v_sc := analytics.content_signal_capture(v_shop, 'craft_moment', 'verify-0159 Q8 สัญญาณ C', 'owner');
  v_p3 := analytics.content_signal_pick(v_shop, v_sc, 'verify-0159 Q8 P3', 'short_clip', 'tiktok', 'jewelry_925', 'owner');
  perform analytics.content_piece_advance(v_shop, v_p3, 'cancelled', 'owner', 'ยกเลิก P3');
  perform analytics.content_piece_advance(v_shop, v_p3, 'restore', 'owner', 'กู้ P3');
  v_log := v_log || pg_temp.vb('Q8e', 'restore ขณะสัญญาณยังว่าง (new/ไม่ผูก) → ผูกสัญญาณเดิมกลับเป็น picked · ยกเลิกซ้ำรีเซ็ตได้อีก',
    (select status = 'picked' and picked_step_id = v_p3 from analytics.content_signal where id = v_sc)
    and (select payload -> 'signal_rebound' @> to_jsonb(array[v_sc::text]) from analytics.content_piece_event where step_id = v_p3 and event_kind = 'restore'));
  perform analytics.content_piece_advance(v_shop, v_p3, 'cancelled', 'owner', 'ยกเลิก P3 อีกรอบ');
  v_log := v_log || pg_temp.vb('Q8e2', 'ยกเลิกรอบสองหลังกู้: สัญญาณกลับ new อีกครั้ง',
    (select status = 'new' and picked_step_id is null from analytics.content_signal where id = v_sc));
  v_s5 := pg_temp.mk_step(v_shop, 'ig_fb_post', 'facebook', false, 'planned');
  v_r := pg_temp.vok(pg_temp.q_adv(v_shop, v_s5, 'cancelled', 'owner', 'ไม่มีสัญญาณ'));
  v_log := v_log || pg_temp.vl('Q8f', 'ยกเลิกชิ้นที่ไม่มีสัญญาณต้นทางไม่พัง (payload.signal_ids ว่าง)',
    case when v_r <> 'OK' then v_r
         when (select payload -> 'signal_ids' = '[]'::jsonb from analytics.content_piece_event where step_id = v_s5 and event_kind = 'cancel') then 'OK'
         else 'FAIL payload' end);
  v_sig3 := analytics.content_signal_capture(v_shop, 'craft_moment', 'verify-0159 Q8 สัญญาณ D (ไม่ใช้หลังหยิบ)', 'owner');
  v_p3 := analytics.content_signal_pick(v_shop, v_sig3, 'verify-0159 Q8 P4', 'short_clip', 'tiktok', 'jewelry_925', 'owner');
  perform analytics.content_signal_set_status(v_shop, v_sig3, 'rejected', 'ทดสอบ', null, 'owner', true);
  perform analytics.content_piece_advance(v_shop, v_p3, 'cancelled', 'owner', 'ยกเลิก P4');
  v_log := v_log || pg_temp.vb('Q8g', 'สัญญาณที่เจ้าของตั้ง "ไม่ใช้" ไปแล้ว (แม้ picked_step_id ค้าง) ไม่ถูกรีเซ็ตเป็น new โดยการยกเลิกชิ้น',
    (select status = 'rejected' from analytics.content_signal where id = v_sig3));

  ----------------------------------------------------------------------------
  -- K13 (LINE ไม่มี URL) · X6 · X7 · K7
  ----------------------------------------------------------------------------
  v_s3 := pg_temp.mk_step(v_shop, 'line_message', 'line_oa', false);
  v_log := v_log || pg_temp.vb('K13a', 'create line_message ตั้ง line_audience = all อัตโนมัติ (ค่าเริ่มต้นตามมติ)',
    (select line_audience = 'all' and piece_kind = 'line_message' from analytics.campaign_step where id = v_s3));
  perform pg_temp.approve_ready(v_shop, v_s3);
  perform analytics.content_piece_advance(v_shop, v_s3, 'approved', 'owner', null, 30);
  v_log := v_log || pg_temp.vl('K13b', 'LINE: advance posted โดย p_post_id → 22023 (ไม่มีลิงก์) · approved → posted ตรงได้ (ไม่ต้อง produced)',
    pg_temp.vx(format('select analytics.content_piece_transition_(%L::uuid,%L::uuid,''posted'',''owner'',null,null,gen_random_uuid())', v_shop, v_s3), array['22023'], 'ไม่มีลิงก์')
    || pg_temp.vok(pg_temp.q_adv(v_shop, v_s3, 'posted', 'owner')));
  v_log := v_log || pg_temp.vb('K13c', 'LINE โพสต์แล้ว: posted/done · ไม่สร้าง content_post · effective = posted ถาวร · posted_on = วันไทยของ event',
    pg_temp.st(v_s3) = 'posted/done' and (select count(*) from analytics.content_post where step_id = v_s3) = 0
    and (select effective_piece_status = 'posted' and posted_on = v_today and jsonb_array_length(posts) = 0 from analytics.v_content_piece where step_id = v_s3), pg_temp.st(v_s3));
  v_r := pg_temp.vx(pg_temp.q_adv(v_shop, v_s3, 'produced', 'owner', 'ย้อนทดสอบ'), array['55000'], 'approved');
  v_txt := pg_temp.vok(pg_temp.q_adv(v_shop, v_s3, 'approved', 'owner', 'ย้อนทดสอบ'));
  v_log := v_log || pg_temp.vl('K13d', 'LINE unpost: ไป produced → 55000 (ไม่เคยผ่าน) · ไป approved + reason ได้ · artifact done → approved',
    case when v_r not like 'OK%' then v_r when v_txt <> 'OK' then v_txt
         when pg_temp.st(v_s3) = 'approved/active' and pg_temp.art_st(v_s3) = 'approved' then 'OK' else 'FAIL ' || pg_temp.st(v_s3) end);
  -- X6: LINE ไม่ได้เลือกผู้รับ (เหมือน backfill ea749965…)
  v_s4 := pg_temp.mk_step(v_shop, 'line_message', 'line_oa', false);
  perform analytics.content_piece_set_plan(v_shop, v_s4, jsonb_build_object('line_audience', null), 'owner');
  perform pg_temp.approve_ready(v_shop, v_s4);
  v_log := v_log || pg_temp.vl('X6', 'approve ชิ้น line_message ที่ line_audience ว่าง → 55000 (ผู้รับ)',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_s4, 'approved', 'owner'), array['55000'], 'ผู้รับ'));
  v_log := v_log || pg_temp.vl('X22e', 'line_audience=segment ต้องมี audience_segment ของชิ้น + เหตุผล: ชิ้นที่ audience_segment ว่าง → 22023 · มีกลุ่มแต่ไม่มีเหตุผล → 22023',
    pg_temp.vx(pg_temp.q_plan(v_shop, v_s4, jsonb_build_object('line_audience', 'segment', 'line_audience_reason', 'ส่วนลดเฉพาะกลุ่ม'), 'owner'), array['22023'], 'audience_segment'));
  update analytics.campaign_step set audience_segment = 'champion' where id = v_s4;
  v_log := v_log || pg_temp.vl('X22f', 'มี audience_segment แล้วแต่ไม่ส่งเหตุผล → 22023 · ส่งเหตุผล → ผ่าน (Q7: เฉพาะกลุ่ม = audience_segment เดิม)',
    pg_temp.vx(pg_temp.q_plan(v_shop, v_s4, jsonb_build_object('line_audience', 'segment'), 'owner'), array['22023'], 'เหตุผล')
    || pg_temp.vok(pg_temp.q_plan(v_shop, v_s4, jsonb_build_object('line_audience', 'segment', 'line_audience_reason', 'ส่วนลดเฉพาะกลุ่ม'), 'owner')));
  v_log := v_log || pg_temp.vb('X6b', 'ข้อบล็อกของชิ้น LINE ที่ยังไม่ได้เลือกผู้รับ (ข้อมูลจริง ea749965…) มีข้อความ "ผู้รับ"',
    (select count(*) = 0 or bool_and(array_to_string(analytics.content_piece_approve_blockers(s.id), ' ') like '%ผู้รับ%')
       from analytics.campaign_step s where s.id::text like 'ea749965%' and s.line_audience is null));
  -- X7: piece_kind null (backfill teaser_image/parcel_card) → อนุมัติไม่ได้ (ข้อมูลจริง)
  select s.id into v_id from analytics.campaign_step s where s.piece_status = 'planned' and s.piece_kind is null order by s.id limit 1;
  if v_id is null then
    v_log := v_log || E'[SKIP] X7 ไม่พบชิ้น planned ที่ piece_kind ว่างในข้อมูลจริง\n';
  else
    perform analytics.content_piece_advance(v_shop, v_id, 'drafting', 'owner');
    perform analytics.campaign_set_artifact_content((select a.id from analytics.step_artifact a where a.step_id = v_id limit 1), 'ข้อความทดสอบ X7');
    perform analytics.content_piece_advance(v_shop, v_id, 'in_review', 'owner');
    perform pg_temp.approve_ready(v_shop, v_id);
    v_log := v_log || pg_temp.vl('X7', 'approve ชิ้นจริงที่ piece_kind ว่าง (backfill teaser_image/parcel_card) ทั้งที่ 3 ด่านผ่านแล้ว → 55000',
      pg_temp.vx(pg_temp.q_adv(v_shop, v_id, 'approved', 'owner'), array['55000'], 'piece_kind'));
  end if;
  -- K7: เส้นทางเดิม campaign_create_task ยังสร้าง step นอก workflow
  v_id := analytics.campaign_create_task(v_shop, 'verify-0159 task เส้นทางเดิม', v_today + 2, 'fb_post');
  v_log := v_log || pg_temp.vb('K7', 'campaign_create_task: step piece_status null · ไม่โผล่ v_content_piece · โผล่ v_campaign_board · X17 advance → 22023',
    (select piece_status is null from analytics.campaign_step where id = v_id)
    and (select count(*) from analytics.v_content_piece where step_id = v_id) = 0
    and (select count(*) from analytics.v_campaign_board where step_id = v_id) = 1
    and pg_temp.vx(pg_temp.q_adv(v_shop, v_id, 'drafting', 'owner'), array['22023'], 'นอก workflow') like 'OK%');

  ----------------------------------------------------------------------------
  -- D8 ทาง (ข): hook reference · trigger mirror · X34 X35 X36 · K8 K9
  ----------------------------------------------------------------------------
  v_sig := analytics.content_signal_capture(v_shop, 'reference_clip', 'verify-0159 คลิปอ้างอิง', 'owner',
             p_url => 'https://www.tiktok.com/@verifyref/video/7770001', p_hook_text => 'hook ของเขา A', p_hook_type => 'question',
             p_platform => 'tiktok');
  select h.id into v_h1 from analytics.content_hook h where h.source_signal_id = v_sig;
  v_log := v_log || pg_temp.vb('K8a', 'capture reference_clip ที่มี hook_text → signal 1 แถว + hook origin=reference 1 แถว (ผูก signal · ไม่ผูก step/label · human · ประเภท question)',
    (select count(*) = 1 and bool_and(origin = 'reference' and step_id is null and label is null and generated_by = 'human'
                                      and hook_type = 'question' and text = 'hook ของเขา A') from analytics.content_hook where source_signal_id = v_sig));
  begin
    perform analytics.content_signal_capture(v_shop, 'reference_clip', 'ซ้ำ', 'owner',
              p_url => 'https://www.tiktok.com/@verifyref/video/7770001', p_hook_text => 'hook ซ้ำ');
    v_r := 'FAIL ผ่านทั้งที่ควรปฏิเสธ';
  exception when others then
    v_r := case when sqlstate = '23505' then 'OK 23505' else 'FAIL sqlstate=' || sqlstate end;
  end;
  v_log := v_log || pg_temp.vl('K8b', 'capture ซ้ำ url → 23505 และไม่มี hook เพิ่ม (11.2 ข้อ 8)',
    v_r || case when (select count(*) from analytics.content_hook where source_signal_id = v_sig) = 1 then '' else ' FAIL hook เพิ่ม' end);
  v_sig2 := analytics.content_signal_capture(v_shop, 'trend', 'verify-0159 เทรนด์', 'ai_radar', p_radar_date => v_today, p_actor_role => 'ai');
  v_log := v_log || pg_temp.vb('K8c', 'capture kind trend ที่ hook_text ว่าง → ไม่มี hook',
    (select count(*) from analytics.content_hook where source_signal_id = v_sig2) = 0);
  v_sig3 := analytics.content_signal_capture(v_shop, 'reference_clip', 'verify-0159 คลิป AI', 'ai_radar', p_actor_role => 'ai',
              p_url => 'https://www.tiktok.com/@verifyai/video/7770002', p_hook_text => 'hook AI จับมา');
  v_log := v_log || pg_temp.vb('K8d', 'capture โดย AI → hook reference generated_by = ai (R25) · ประเภทว่างได้ (reference)',
    (select count(*) = 1 and bool_and(generated_by = 'ai' and hook_type is null) from analytics.content_hook where source_signal_id = v_sig3));
  v_log := v_log || pg_temp.vl('K8e', 'content_signal_set_status ทุกค่ายังทำงาน · v_content_signal select ได้',
    pg_temp.vok(format('select analytics.content_signal_set_status(%L::uuid,%L::uuid,''deferred'',''รอ'',%L::date,''owner'')', v_shop, v_sig3, v_today + 3))
    || pg_temp.vok(format('select analytics.content_signal_set_status(%L::uuid,%L::uuid,''rejected'',''ไม่ใช้'',null,''owner'')', v_shop, v_sig3))
    || pg_temp.vok(format('select analytics.content_signal_set_status(%L::uuid,%L::uuid,''new'',null,null,''owner'')', v_shop, v_sig3))
    || pg_temp.vok(format('select count(*) from analytics.v_content_signal where id = %L::uuid', v_sig)));

  v_log := v_log || pg_temp.vl('X34a', 'reference_upsert บนสัญญาณ kind trend → 22023',
    pg_temp.vx(format('select analytics.content_hook_reference_upsert(%L::uuid,%L::uuid,''x'',null,''owner'')', v_shop, v_sig2), array['22023'], 'คลิปอ้างอิง'));
  v_id := analytics.content_signal_capture(v_shop2, 'reference_clip', 'verify-0159 ร้าน B', 'owner',
            p_url => 'https://www.tiktok.com/@shopb/video/1', p_hook_text => 'hook ร้าน B');
  v_log := v_log || pg_temp.vl('X34b', 'reference_upsert ใช้สัญญาณของร้านอื่น → 22023 (ไม่พบในร้านนี้)',
    pg_temp.vx(format('select analytics.content_hook_reference_upsert(%L::uuid,%L::uuid,''x'',null,''owner'')', v_shop, v_id), array['22023'], 'ไม่พบสัญญาณ'));
  v_log := v_log || pg_temp.vl('X34c', 'AI แก้ hook ที่ generated_by=human → 42501',
    pg_temp.vx(format('select analytics.content_hook_reference_upsert(%L::uuid,%L::uuid,''แก้โดย ai'',''fact'',''ai'',%L::uuid)', v_shop, v_sig, v_h1), array['42501']));
  begin
    perform analytics.content_hook_reference_upsert(v_shop, v_sig, 'HOOK ของเขา a', 'fact', 'owner');
    v_r := 'FAIL ผ่านทั้งที่ควรปฏิเสธ';
  exception when others then
    get stacked diagnostics v_txt = pg_exception_detail;
    v_r := case when sqlstate = '23505' and v_txt = v_h1::text then 'OK 23505 detail=id เดิม (ไม่สนตัวพิมพ์)' else 'FAIL sqlstate=' || sqlstate || ' detail=' || coalesce(v_txt, '') end;
  end;
  v_log := v_log || pg_temp.vl('X34d', 'reference_upsert ข้อความซ้ำ (signal, lower(text)) → 23505 + id เดิม', v_r);
  v_h2 := analytics.content_hook_reference_upsert(v_shop, v_sig, 'hook ของเขา B (คนละมุม)', null, 'owner');
  perform analytics.content_hook_reference_upsert(v_shop, v_sig, 'hook ของเขา B (คนละมุม)', 'fact', 'owner', v_h2);
  v_log := v_log || pg_temp.vb('K8f', 'คลิปเดียวมี hook ได้หลายตัว (ข้อ 2 ของเจ้าของ) · เพิ่มแบบไม่มีประเภทแล้วติดประเภททีหลังได้',
    (select count(*) = 2 and count(*) filter (where hook_type = 'fact' and generated_by = 'human') = 1 from analytics.content_hook where source_signal_id = v_sig and origin = 'reference'));

  -- ถอดโครงเป็น hook ของเรา: v_hA (ours · ai) ← v_h1 (reference)
  v_log := v_log || pg_temp.vl('X36c', 'link_reference ชี้ไปที่ hook ours (ไม่ใช่ reference) → 22023',
    pg_temp.vx(format('select analytics.content_hook_link_reference(%L::uuid,%L::uuid,%L::uuid,''owner'')', v_shop, v_hA, v_hA), array['22023'], 'reference'));
  select h.id into v_id from analytics.content_hook h where h.step_id = v_s2 and h.label = 'A';
  v_log := v_log || pg_temp.vl('X36d', 'AI link hook ours ที่คนเขียน (human) → 42501',
    pg_temp.vx(format('select analytics.content_hook_link_reference(%L::uuid,%L::uuid,%L::uuid,''ai'')', v_shop, v_id, v_h1), array['42501']));
  perform analytics.content_hook_link_reference(v_shop, v_hA, v_h1, 'owner');
  v_log := v_log || pg_temp.vb('K8g', 'link_reference: derived_from_hook_id = hook ของเขา · source_signal_id = คลิปนั้น (เส้นทางย้อน)',
    (select derived_from_hook_id = v_h1 and source_signal_id = v_sig from analytics.content_hook where id = v_hA)
    and (select (h ->> 'derived_from_hook_id')::uuid = v_h1 from analytics.v_content_piece p, jsonb_array_elements(p.hooks) h
          where p.step_id = v_s1 and (h ->> 'id')::uuid = v_hA));
  v_log := v_log || pg_temp.vl('X36a', 'INSERT hook origin=reference โดย source_signal_id null → 23514',
    pg_temp.vx(format('insert into analytics.content_hook (shop_id, text, hook_type, origin, generated_by) values (%L::uuid, ''x'', ''question'', ''reference'', ''human'')', v_shop), array['23514']));
  v_log := v_log || pg_temp.vl('X36b', 'ตั้ง derived_from_hook_id บนแถว reference → 23514 (มีได้เฉพาะ ours)',
    pg_temp.vx(format('update analytics.content_hook set derived_from_hook_id = %L::uuid where id = %L::uuid', v_hA, v_h2), array['23514']));
  v_log := v_log || pg_temp.vl('X35', 'ลบสัญญาณที่มี hook ของเราถอดโครงจากคลิปนั้น → 55000',
    pg_temp.vx(format('delete from analytics.content_signal where id = %L::uuid', v_sig), array['55000'], 'ถอดโครง'));
  v_log := v_log || pg_temp.vl('X34e', 'reference_delete: AI → 42501 · owner บน hook ที่ถูกอ้างอิง → 55000',
    pg_temp.vx(format('select analytics.content_hook_reference_delete(%L::uuid,%L::uuid,''ai'')', v_shop, v_h2), array['42501'])
    || pg_temp.vx(format('select analytics.content_hook_reference_delete(%L::uuid,%L::uuid,''owner'')', v_shop, v_h1), array['55000'], 'ปลดความเชื่อม'));
  v_log := v_log || pg_temp.vl('X34f', 'reference_delete hook ที่ไม่มีใครอ้าง (owner) → ลบได้',
    pg_temp.vok(format('select analytics.content_hook_reference_delete(%L::uuid,%L::uuid,''owner'')', v_shop, v_h2)));
  delete from analytics.content_signal where id = v_sig3;
  v_log := v_log || pg_temp.vb('K8h', 'ลบสัญญาณที่ไม่มีใครถอดโครง → hook reference ของมันถูกลบตาม (FK set null ไม่ชน CHECK)',
    (select count(*) from analytics.content_hook where source_signal_id = v_sig3) = 0
    and not exists (select 1 from analytics.content_signal where id = v_sig3));
  v_log := v_log || pg_temp.vl('K9a', 'content_hook_upsert (0158) ยังบังคับ hook_type: null → 22023 (CHECK ที่ผ่อนไม่ทำให้ ours รับ null)',
    pg_temp.vx(format('select analytics.content_hook_upsert(%L::uuid,%L::uuid,null,''x'',null,null,''owner'',null)', v_shop, v_s2), array['22023'], 'hook_type'));
  v_log := v_log || pg_temp.vl('K9b', 'INSERT hook ours ที่ hook_type null (ไม่ใช่ legacy) ตรง → 23514',
    pg_temp.vx(format('insert into analytics.content_hook (shop_id, text, hook_type, origin, step_id, generated_by) values (%L::uuid, ''x'', null, ''ours'', %L::uuid, ''human'')', v_shop, v_s2), array['23514']));
  v_log := v_log || pg_temp.vl('K9c', 'content_hook_upsert ปกติ (hook ours ตัวที่ 3 ไม่มีป้าย) ยังทำงาน',
    pg_temp.vok(format('select analytics.content_hook_upsert(%L::uuid,%L::uuid,null,''ตัวที่ 3'',''story'',null,''owner'',null)', v_shop, v_s2)));

  -- K10: ฟังก์ชันเดิมนอก 0159 ยังเรียกได้ (md5 ทั้งชุดตรวจที่ด่านท้าย migration)
  v_post2 := analytics.content_post_upsert(v_shop, 'facebook', 'verify-0159-ext-2', 'https://www.facebook.com/verify/posts/2',
                                           now() - interval '2 days', null, null, null);
  v_log := v_log || pg_temp.vl('K10', 'live_session_upsert v2 · content_post_upsert · content_post_update_type · content_post_set_status ยังเรียกได้',
    pg_temp.vok(format('select analytics.live_session_upsert(%L::uuid, %L::date, ''20:00''::time, ''23:00''::time, 12, ''verify'', ''admin_ui'')', v_shop, v_today - 25))
    || pg_temp.vok(format('select analytics.content_post_update_type(%L::uuid,%L::uuid,''knowledge'')', v_shop, v_post2))
    || pg_temp.vok(format('select analytics.content_post_set_status(%L::uuid,%L::uuid,''deleted'')', v_shop, v_post2)));
  v_log := v_log || E'[SKIP] K10b md5 ของฟังก์ชันเดิม (รวม 0158) เทียบก่อน/หลัง apply = ด่านท้าย migration (snapshot c2.snap_funcs) · ปัจจุบัน content_post_upsert md5='
    || md5(pg_get_functiondef('analytics.content_post_upsert(uuid,text,text,text,timestamptz,text,uuid,text)'::regprocedure)) || E'\n';

  ----------------------------------------------------------------------------
  -- X17 / K4: RPC ใหม่และเก่า ยิงใส่ step ก่อน ต.ค. ทุกโหมดที่มีจริงบน prod (trap #17) — ไม่ใช่ fixture
  ----------------------------------------------------------------------------
  select s.id into v_id from analytics.campaign_step s
   where s.piece_status is null and not exists (select 1 from analytics.step_artifact a where a.step_id = s.id) order by s.id limit 1;
  select s.id into v_p1 from analytics.campaign_step s where s.piece_status is null
   order by (select count(*) from analytics.step_artifact a where a.step_id = s.id) desc, s.id limit 1;
  select s.id into v_p2 from analytics.campaign_step s
   where s.piece_status is null and exists (select 1 from analytics.step_gate g where g.step_id = s.id and g.status = 'pending') order by s.id limit 1;
  select count(*) into v_n from analytics.step_artifact a where a.step_id = v_p1;
  v_log := v_log || pg_temp.vb('K4z', 'พบ step ก่อน workflow ครบ 3 โหมดจริง (ไม่มี artifact / หลาย artifact / มี gate ค้าง)',
    v_id is not null and v_p1 is not null and v_p2 is not null and v_n >= 2, format('no_artifact=%s multi(%s artifacts)=%s gate=%s', left(v_id::text, 8), v_n, left(v_p1::text, 8), left(v_p2::text, 8)));
  v_log := v_log || pg_temp.vl('X17a', 'RPC ใหม่ทุกตัวใส่ step ก่อน workflow (ไม่มี artifact) → 22023 "นอก workflow" (ไม่พัง/ไม่เงียบ)',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_id, 'drafting', 'owner'), array['22023'], 'นอก workflow')
    || pg_temp.vx(pg_temp.q_plan(v_shop, v_id, jsonb_build_object('hypothesis', 'x'), 'owner'), array['22023'], 'นอก workflow')
    || pg_temp.vx(pg_temp.q_gate(v_shop, v_id, 'fact_check', 'passed', 'owner'), array['22023'], 'นอก workflow')
    || pg_temp.vx(format('select analytics.content_confirm_extract(%L::uuid,%L::uuid)', v_shop, v_id), array['22023'], 'นอก workflow'));
  v_log := v_log || pg_temp.vl('X17b', 'RPC ใหม่ใส่ step หลาย artifact (template) → 22023',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_p1, 'in_review', 'owner'), array['22023'], 'นอก workflow')
    || pg_temp.vx(pg_temp.q_plan(v_shop, v_p1, jsonb_build_object('date', (v_today + 3)::text), 'owner'), array['22023'], 'นอก workflow'));
  v_log := v_log || pg_temp.vl('X17c', 'RPC ใหม่ใส่ step ที่มี gate โปรโมค้าง → 22023 · gate_record ไม่แตะ gate โปรโมเดิม',
    pg_temp.vx(pg_temp.q_adv(v_shop, v_p2, 'planned', 'owner'), array['22023'], 'นอก workflow')
    || pg_temp.vx(pg_temp.q_gate(v_shop, v_p2, 'coo_stock_check', 'passed', 'owner'), array['22023'], 'ด่านต้องเป็น'));
  -- K4: RPC เดิมทำงานเหมือนเดิมบน step ก่อน workflow (trigger R4 ปล่อยเมื่อ piece_status null)
  select string_agg(res, ' ') into v_txt from (
    select pg_temp.vn5(format('select analytics.campaign_set_artifact_content(%L::uuid, %L)', a.id, 'verify legacy K4')) as res
      from analytics.step_artifact a where a.step_id = v_p1
    union all
    select pg_temp.vn5(format('select analytics.campaign_set_artifact_status(%L::uuid, ''approved'')', a.id))
      from analytics.step_artifact a where a.step_id = v_p1
    union all
    select pg_temp.vn5(format('select analytics.campaign_ai_draft_artifact(%L::uuid, ''x'', null, ''m'')', a.id))
      from analytics.step_artifact a where a.step_id = v_p1) t;
  v_log := v_log || pg_temp.vl('K4a', 'set_artifact_content / set_artifact_status(approved) / ai_draft บนทุก artifact ของ step หลาย artifact ก่อน workflow → ไม่ถูก guard บล็อก',
    case when v_txt like '%FAIL%' then 'FAIL ' || v_txt else 'OK' end);
  v_log := v_log || pg_temp.vb('K4a2', 'สถานะ artifact เดิมของ step ก่อน workflow ขยับได้ถึง approved ผ่านเส้นทางเดิม (พฤติกรรมเดิมไม่ถูกเปลี่ยน)',
    exists (select 1 from analytics.step_artifact where step_id = v_p1 and status = 'approved'), pg_temp.art_st(v_p1));
  select string_agg(res, ' ') into v_txt from (
    select pg_temp.vn5(format('select analytics.campaign_reschedule_step(%L::uuid, %L::date)', v_id,
             (select c.anchor_date + s.offset_start_days from analytics.campaign_step s join analytics.campaign c on c.id = s.campaign_id where s.id = v_id))) as res
    union all
    (select pg_temp.vn5(format('select analytics.campaign_pass_gate(%L::uuid, %L)', g.step_id, g.gate_kind))
      from analytics.step_gate g where g.step_id = v_p2 and g.status = 'pending' order by g.gate_kind limit 1)) t;
  v_log := v_log || pg_temp.vl('K4b', 'campaign_reschedule_step (step ไม่มี artifact) · campaign_pass_gate (step gate ค้าง) ก่อน workflow → ไม่ถูก guard บล็อก',
    case when v_txt like '%FAIL%' then 'FAIL ' || v_txt else 'OK ' || v_txt end);
  v_log := v_log || pg_temp.vb('K4c', 'campaign_pass_gate ผ่านจริง (gate เดิมของโปรโมเปลี่ยนเป็น passed)',
    exists (select 1 from analytics.step_gate where step_id = v_p2 and status = 'passed'));

  ----------------------------------------------------------------------------
  -- K5 / K6 / K17 / K19 / X15 / X39: ชิ้นจริง 26 ชิ้นหลัง backfill (rollback ทั้งหมด)
  ----------------------------------------------------------------------------
  select count(*) into v_n from analytics.v_content_piece p
   where p.piece_status = 'in_review' and p.drafted_by_ai and p.created_at < now() - interval '1 minute';
  v_log := v_log || pg_temp.vb('K1b', 'ชิ้นจริงหลัง backfill: in_review+drafted_by_ai ≥ 1 (ใช้เป็นข้อมูลทดสอบ)', v_n >= 1, v_n::text);

  -- X15 (R19): ชิ้นจริงที่ hook ติดประเภทไม่ครบ ส่งกลับแล้ว advance ใหม่ต้องตกพร้อมบอก "ยังไม่ติดประเภท n ตัว"
  select h.step_id into v_p1 from analytics.content_hook h
   where h.origin = 'ours' and h.label is not null
     and h.step_id in (select step_id from analytics.v_content_piece where piece_status = 'in_review' and drafted_by_ai)
   group by h.step_id having count(distinct h.hook_type) filter (where h.hook_type is not null) < 2 order by h.step_id limit 1;
  if v_p1 is null then
    v_log := v_log || E'[SKIP] X15 (ข้อมูลจริง) ไม่พบชิ้น in_review ที่ hook ติดประเภท < 2\n';
  else
    perform analytics.content_piece_advance(v_shop, v_p1, 'drafting', 'owner', 'ส่งกลับทดสอบ R19');
    v_log := v_log || pg_temp.vl('X15', 'ชิ้นจริงที่ hook ติดประเภทไม่ครบ (legacy hook_type null): ส่งกลับแล้ว advance in_review ใหม่ → 55000 + ข้อความบอก "ยังไม่ติดประเภท"',
      pg_temp.vx(pg_temp.q_adv(v_shop, v_p1, 'in_review', 'owner'), array['55000'], 'ยังไม่ติดประเภท'));
  end if;

  -- K6 (ข้อมูลจริง): ai_draft บน in_review → ผลตรวจ fact/brand ตกเป็น pending · risk_owner คงค่า
  select p.step_id into v_p1 from analytics.v_content_piece p
   where p.piece_status = 'in_review' and p.drafted_by_ai and p.confirm_pending > 0 and p.step_id is distinct from v_p1 order by p.step_id limit 1;
  select a.id into v_id from analytics.step_artifact a where a.step_id = v_p1 limit 1;
  perform analytics.content_gate_record(v_shop, v_p1, 'fact_check', 'passed', 'owner');
  perform analytics.content_gate_record(v_shop, v_p1, 'brand_rule', 'passed', 'owner');
  perform analytics.content_gate_record(v_shop, v_p1, 'risk_owner', 'passed', 'owner');
  perform analytics.campaign_ai_draft_artifact(v_id, null,
    jsonb_set((select clip_brief from analytics.step_artifact where id = v_id), '{shots,0,desc}', to_jsonb('ปรับข้อความทดสอบ K6'::text)), 'verify-model');
  v_log := v_log || pg_temp.vb('K6f', 'ai_draft บนชิ้นจริง in_review: เขียนได้ · fact/brand ตกเป็น pending · risk_owner ยัง passed · extract รันเอง (ยังมีรายการ)',
    (select count(*) from analytics.step_gate where step_id = v_p1 and gate_kind in ('fact_check', 'brand_rule') and status = 'pending') = 2
    and (select status from analytics.step_gate where step_id = v_p1 and gate_kind = 'risk_owner') = 'passed'
    and (select clip_brief #>> '{shots,0,desc}' from analytics.step_artifact where id = v_id) = 'ปรับข้อความทดสอบ K6', pg_temp.st(v_p1));

  -- K17 (ข้อมูลจริง AI): cancel → restore → artifact กลับ draft_pending_review ตาม drafted_by_ai
  perform analytics.content_piece_advance(v_shop, v_p1, 'cancelled', 'owner', 'ยกเลิกทดสอบชิ้นจริง');
  perform analytics.content_piece_advance(v_shop, v_p1, 'restore', 'owner', 'กู้คืนทดสอบชิ้นจริง');
  v_log := v_log || pg_temp.vb('K17f', 'ชิ้นจริง AI: cancel → restore กลับ in_review/active · artifact = draft_pending_review (drafted_by_ai)',
    pg_temp.st(v_p1) = 'in_review/active' and pg_temp.art_st(v_p1) = 'draft_pending_review', pg_temp.st(v_p1) || ' ' || pg_temp.art_st(v_p1));

  -- K19: resolve บนชิ้นจริงที่มี marker หลาย key
  select i.step_id into v_p2 from analytics.content_confirm_item i
   where i.resolved_at is null and i.removed_at is null
     and i.step_id in (select step_id from analytics.v_content_piece where piece_status = 'in_review')
   group by i.step_id order by count(*) desc, i.step_id limit 1;
  select count(*) into v_cnt_all from analytics.content_confirm_item where step_id = v_p2 and resolved_at is null and removed_at is null;
  select i.id, i.question into v_item, v_q from analytics.content_confirm_item i
   where i.step_id = v_p2 and i.resolved_at is null and i.removed_at is null order by i.question limit 1;
  v_j := analytics.content_confirm_resolve(v_shop, v_item, 'ตอบจริง "ทดสอบ" \ — ไทย 925', 'owner');
  for r2 in select a.clip_brief from analytics.step_artifact a where a.step_id = v_p2 and a.clip_brief is not null loop
    perform analytics.assert_clip_brief_valid(r2.clip_brief);   -- ผิดรูป = raise ทั้งไฟล์ (นับเป็นล้ม)
  end loop;
  select string_agg(a.id::text, ',') into v_txt from analytics.step_artifact a where a.step_id = v_p2
     and (v_q = any (analytics.content_marker_questions(a.clip_brief::text)) or v_q = any (analytics.content_marker_questions(a.content_body)));
  v_log := v_log || pg_temp.vb('K19', 'resolve 1 key บนชิ้นจริง: ทุกตำแหน่งของ key นั้นถูกแทน · key อื่นยังค้าง · clip_brief ยังถูกรูป · human_edited',
    v_txt is null and (v_j ->> 'remaining_pending')::int = v_cnt_all - 1 and v_cnt_all >= 1
    and (select count(*) from analytics.step_artifact a where a.step_id = v_p2 and a.human_edited) >= 1
    and (select count(*) from analytics.step_artifact a where a.step_id = v_p2 and position('ตอบจริง "ทดสอบ" \ — ไทย 925' in coalesce(a.clip_brief::text, '') || coalesce(a.content_body, '')) > 0
          or position('ตอบจริง \"ทดสอบ\" \\ — ไทย 925' in coalesce(a.clip_brief::text, '')) > 0) >= 1,
    format('keys_before=%s %s', v_cnt_all, v_j::text));

  -- X39 (ข้อมูลจริง 13 ชิ้น): can_approve ตรงกับผลของ RPC อนุมัติ ทั้งสถานะปัจจุบัน และหลังตอบ/ผ่านด่านครบ
  v_cnt_all := 0; v_cnt_same := 0; v_cnt_ok := 0; v_cnt_unres := 0;
  for r in select p.step_id, p.can_approve from analytics.v_content_piece p where p.piece_status = 'in_review' and p.drafted_by_ai order by p.step_id loop
    v_cnt_all := v_cnt_all + 1;
    -- (ก) ตามสภาพปัจจุบัน
    v_b := null;
    begin
      perform analytics.content_piece_advance(v_shop, r.step_id, 'approved', 'owner');
      v_b := true;
      raise exception using errcode = 'P0001', message = '__rollback__';
    exception when others then
      if sqlerrm <> '__rollback__' then v_b := false; end if;
    end;
    if v_b is not distinct from r.can_approve then v_cnt_same := v_cnt_same + 1; end if;
    -- (ข) ตอบทุกรายการ + ผ่านด่านครบ แล้วเทียบอีกรอบ
    begin
      perform pg_temp.approve_ready(v_shop, r.step_id);
    exception when others then
      v_cnt_unres := v_cnt_unres + 1;
      v_b := null;
    end;
    if (select count(*) from analytics.step_gate g where g.step_id = r.step_id and g.status = 'passed') = 3 then
      select can_approve into v_b from analytics.v_content_piece where step_id = r.step_id;
      begin
        perform analytics.content_piece_advance(v_shop, r.step_id, 'approved', 'owner');
        if v_b then v_cnt_ok := v_cnt_ok + 1; end if;
        raise exception using errcode = 'P0001', message = '__rollback__';
      exception when others then
        if sqlerrm <> '__rollback__' and v_b then v_cnt_unres := v_cnt_unres + 1; end if;
      end;
    end if;
  end loop;
  v_log := v_log || pg_temp.vb('X39e', 'ชิ้นจริง in_review ทุกชิ้น: can_approve (view) ตรงกับผล RPC อนุมัติตามสภาพปัจจุบัน',
    v_cnt_all >= 1 and v_cnt_same = v_cnt_all, format('ชิ้น=%s ตรงกัน=%s', v_cnt_all, v_cnt_same));
  v_log := v_log || pg_temp.vb('X39f', 'หลังตอบทุกรายการ+ผ่านด่านครบ (ใน subtransaction): ชิ้นที่ can_approve=true อนุมัติผ่านจริงทุกชิ้น · ไม่มีชิ้นที่ตอบไม่ได้',
    v_cnt_unres = 0 and v_cnt_ok = v_cnt_all, format('อนุมัติได้จริง=%s จาก %s · ตอบ/อนุมัติไม่สำเร็จ=%s', v_cnt_ok, v_cnt_all, v_cnt_unres));

  -- K5 (ข้อมูลจริง): reschedule / content_type / delete บนชิ้นใน workflow ทำงานเหมือนเดิม
  select s.id into v_p1 from analytics.campaign_step s where s.piece_status = 'planned' and s.origin = 'manual' order by s.id limit 1;
  select s.id into v_p2 from analytics.campaign_step s where s.piece_status = 'planned' and s.origin = 'manual' and s.id <> v_p1 order by s.id limit 1;
  if v_p1 is null or v_p2 is null then
    v_log := v_log || E'[SKIP] K5b-d ไม่พบชิ้น planned ที่ origin=manual 2 ชิ้น\n';
  else
    v_txt := pg_temp.vn5(format('select analytics.campaign_reschedule_step(%L::uuid, %L::date)', v_p1, v_today + 40))
          || pg_temp.vok(format('select analytics.campaign_step_set_content_type(%L::uuid,%L::uuid,''knowledge'')', v_shop, v_p1));
    v_log := v_log || pg_temp.vb('K5b', 'campaign_reschedule_step + campaign_step_set_content_type บนชิ้น planned ทำงาน · piece_status/status ไม่ขยับ (backfill คง status todo ตามสเปก) · ไม่มี event defer (หนี้ D11)',
      v_txt not like '%FAIL%' and pg_temp.st(v_p1) = 'planned/todo'
      and (select count(*) from analytics.content_piece_event where step_id = v_p1 and event_kind = 'defer') = 0
      and (select content_type_code from analytics.campaign_step where id = v_p1) = 'knowledge', v_txt);
    select count(*) into v_n from analytics.content_piece_event where step_id = v_p2;
    v_r := pg_temp.vok(format('select analytics.campaign_delete_step(%L::uuid)', v_p2));
    v_log := v_log || pg_temp.vb('K5c', 'campaign_delete_step บนชิ้น planned (origin manual) ทำงาน — event append-only ไม่ขวาง (cascade จากการลบ step) · artifact/confirm ถูกลบตาม',
      v_r = 'OK' and v_n >= 1
      and not exists (select 1 from analytics.campaign_step where id = v_p2)
      and (select count(*) from analytics.content_piece_event where step_id = v_p2) = 0
      and (select count(*) from analytics.step_artifact where step_id = v_p2) = 0, v_r || ' events_before=' || v_n);
  end if;

  ----------------------------------------------------------------------------
  -- X37: เรียกฟังก์ชันใหม่ทุกตัวจาก role authenticated (หลังจำลองกำแพงชั้นนอกหลุด — 3j-migration-traps 18.5)
  ----------------------------------------------------------------------------
  execute 'grant usage on schema analytics to authenticated';
  v_cnt_all := 0; v_cnt_ok := 0; v_bad := null;
  for r in
    select p.proname, (select string_agg('null::' || format_type(t, null), ', ' order by o) from unnest(p.proargtypes::oid[]) with ordinality as u(t, o)) as args
      from pg_proc p
     where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f'
       and p.proname ~ '^(content_piece_|content_gate_|content_confirm_|content_signal_pick$|content_signal_delete_guard$|content_hook_reference_|content_hook_link_|content_hook_mirror_|content_marker_|content_regex_)'
     order by p.proname
  loop
    v_cnt_all := v_cnt_all + 1;
    begin
      execute 'set local role authenticated';
      execute format('select analytics.%I(%s)', r.proname, coalesce(r.args, ''));
      v_bad := coalesce(v_bad || ', ', '') || r.proname || ':ผ่าน';
    exception when others then
      if sqlstate = '42501' then v_cnt_ok := v_cnt_ok + 1; else v_bad := coalesce(v_bad || ', ', '') || r.proname || ':' || sqlstate; end if;
    end;
    execute 'reset role';
  end loop;
  execute 'revoke usage on schema analytics from authenticated';
  v_log := v_log || pg_temp.vb('X37', 'role authenticated (แม้ได้ usage สคีมา) เรียกฟังก์ชันของ 0159 ทุกตัว → 42501 permission denied', v_cnt_all >= 30 and v_cnt_ok = v_cnt_all,
    format('ทดสอบ %s ตัว · 42501 %s ตัว · ผิดปกติ: %s', v_cnt_all, v_cnt_ok, coalesce(v_bad, '-')));
  v_log := v_log || pg_temp.vb('X37b', 'สิทธิ์ usage ของ authenticated บนสคีมากลับสู่เดิม (false) หลังทดสอบ', not has_schema_privilege('authenticated', 'analytics', 'usage'));

  ----------------------------------------------------------------------------
  -- X38: ด่าน "seed เปลี่ยน" ของ backfill (scope function · ตัวเดียวกับที่ do-block ใน migration ใช้ raise)
  ----------------------------------------------------------------------------
  -- เก็บ step ที่เส้นทางเดิมสร้างไว้ก่อนหน้า (K7) ออกก่อน ไม่งั้นนับเป็น candidate
  perform analytics.campaign_delete_step(s.id) from analytics.campaign_step s where s.title like 'verify-0159 task%' and s.piece_status is null;
  v_j := analytics.content_piece_backfill_scope_(26);
  v_log := v_log || pg_temp.vb('X38a', 'ไม่มี candidate (backfill ทำไปแล้ว) → n=0 · ไม่มี problem (รันซ้ำข้ามเงียบ)',
    (v_j ->> 'n')::int = 0 and jsonb_typeof(v_j -> 'problem') = 'null', v_j::text);
  v_id := analytics.campaign_create_task(v_shop, 'verify-0159 X38 task ต.ค.', greatest(date '2026-10-01', v_today), 'fb_post');
  v_j := analytics.content_piece_backfill_scope_(26);
  v_log := v_log || pg_temp.vb('X38b', 'step ต.ค. ใหม่ที่ piece_status ว่าง 1 แถว (จำนวนไม่ใช่ 26) → scope คืน problem "พบ 1 step (คาด 26)" ⇒ migration จะ raise',
    (v_j ->> 'n')::int = 1 and (v_j ->> 'problem') like '%พบ 1 step (คาด 26)%', v_j::text);
  v_j := analytics.content_piece_backfill_scope_(1);
  v_log := v_log || pg_temp.vb('X38c', 'จำนวนตรง + artifact 1 ตัว todo → ไม่มี problem (ทางผ่าน)', jsonb_typeof(v_j -> 'problem') = 'null', v_j::text);
  insert into analytics.step_artifact (step_id, shop_id, artifact_type, owner_role, status)
    values (v_id, v_shop, 'teaser_image', 'owner', 'todo');
  v_j := analytics.content_piece_backfill_scope_(1);
  v_log := v_log || pg_temp.vb('X38d', 'เพิ่ม artifact ตัวที่ 2 ให้ step ต.ค. → problem "artifact ไม่ใช่ 1 ตัว" ⇒ migration จะ raise ไม่ UPDATE',
    (v_j ->> 'problem') like '%ไม่ใช่ 1 ตัว%', v_j::text);
  delete from analytics.step_artifact where step_id = v_id and artifact_type = 'teaser_image';
  update analytics.step_artifact set status = 'approved' where step_id = v_id;
  v_j := analytics.content_piece_backfill_scope_(1);
  v_log := v_log || pg_temp.vb('X38e', 'artifact สถานะ approved (นอก todo/draft_pending_review) → problem "สถานะนอกขอบเขต"',
    (v_j ->> 'problem') like '%สถานะนอกขอบเขต%', v_j::text);

  ----------------------------------------------------------------------------
  -- ที่ไม่ครอบในไฟล์นี้ (บอกตรงๆ)
  ----------------------------------------------------------------------------
  v_log := v_log || E'[SKIP] X31 X32 X33 / K14 / K13 (v_line_quota_28d) / v_content_piece_calendar (K18 ส่วนปฏิทิน) = ของ 0160 (content_piece_post · link/unlink · defer · views)\n';
  v_log := v_log || E'[SKIP] K20 รัน migration ซ้ำ 2 รอบ + check-analytics-grants.sql + ไฟล์ LF (\\r = 0) = ตรวจนอกไฟล์นี้ (ดูรายงานส่งมอบ)\n';
  v_log := v_log || E'[SKIP] K3 ส่วน QA smoke หน้าเว็บ /marketing/copilot /marketing/calendar = ไม่มี (ต้องกดจริง — scope L ของ QA)\n';
  v_log := v_log || E'[SKIP] X30 เรียกจาก role service_role จริง (ที่นี่รันเป็น postgres) — trigger ยิงทุก role ตัดสินที่ตาราง ไม่ใช่ผู้เรียก · R20 (ตั้ง GUC c2.piece_rpc เองข้าม trigger ได้) ไม่ใช่เคสที่กัน\n';

  exception when others then
    v_log := v_log || format(E'[FAIL] ABORT verify หยุดกลางทาง sqlstate=%s msg=%s
', sqlstate, left(sqlerrm, 300));
  end;
  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_ok   := (length(v_log) - length(replace(v_log, '[OK]', ''))) / 4;
  v_log := v_log || format(E'\n=== สรุป: [OK] %s · [FAIL] %s — raise ด้านล่างบังคับ ROLLBACK ทั้งหมด ===\n', v_ok, v_fail);
  raise exception '%', v_log;
end;
$verify0159$;
