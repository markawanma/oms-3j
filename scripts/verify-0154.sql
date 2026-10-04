-- scripts/verify-0154.sql
-- ทดสอบ 0154_gem_quiz.sql — do-block + raise exception บังคับ rollback เสมอ
-- (3j-migration-traps #11) ห้ามรันแยกเป็น script ที่ COMMIT.
--
-- วิธีรัน: หลัง apply 0154 จริงแล้ว — node scripts/run-sql.mjs scripts/verify-0154.sql
-- (ซ้อม, rollback อัตโนมัติอยู่แล้วไม่ว่าจะใส่ --commit หรือไม่ เพราะไฟล์นี้ raise
-- exception ท้ายสุดเสมอ)
--
-- ✅ รันจริงแล้ว 4 ต.ค. 69 (Tech Lead, ผ่าน scripts/run-sql.mjs) — 24/24 PASS
-- หลังแก้ 2 จุดที่เจอจากการรันจริง ไม่ใช่แค่อ่านโค้ด:
--   1. เรียก gem_quiz_submit(v_real_shop_id, 1, ...) ด้วย integer literal เปล่า
--      พัง 42883 (function ... does not exist) เพราะ int4->int2 เป็นแค่
--      assignment cast ใน Postgres ไม่ใช่ implicit cast ที่ใช้ตอน resolve
--      function call ได้ — ต้อง "1::smallint" ทุกจุดที่เรียก
--   2. T2c เจอจริงว่า service_role มี INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/
--      TRIGGER บนทั้ง gem_quiz_response และ gem_quiz_stone (ALTER DEFAULT
--      PRIVILEGES ระดับ schema analytics จาก migration ก่อนหน้า แจกมาอัตโนมัติ
--      — ตรงกับที่ design doc §3.2 เตือนไว้ล่วงหน้า) แก้ด้วย
--      0155_gem_quiz_grant_fix.sql (revoke ส่วนเกิน เหลือ SELECT อย่างเดียว)
--      — ของเดิม count(*) ไม่กรอง grantee='postgres' (เจ้าของตาราง มีสิทธิ์
--      เต็มโดยธรรมชาติ ไม่ใช่ role ที่ client ไหนใช้) ก็ต้องแก้ assertion ด้วย
--
-- ไม่สร้าง fixture shop ใหม่ (3j-migration-traps #17) — ใช้ shop จริงตัวแรกบน DB
-- (เหมือน verify-0150) เพราะ prod มีร้านเดียวจริงๆ ตอนนี้
--
-- อ่านผลจาก NOTICE — บรรทัดรูปแบบ "ชื่อเทสต์: PASS/FAIL" ทุกข้อ
-- นับ FAIL ด้วย: grep -o ': FAIL' (ไม่ grep คำว่า FAIL เฉยๆ)

do $verify0154$
declare
  v_log text := E'\n=== verify-0154 (gem_quiz_submit / gem_quiz_stats) ===\n';

  v_real_shop_id uuid;
  v_other_shop_id uuid := gen_random_uuid(); -- ไม่มีจริง ใช้ทดสอบ "ไม่พบร้าน"

  -- ชนิดแยกตามความหมายเสมอ (3j-migration-traps #16)
  v_sig_count_submit int;
  v_sig_count_stats  int;
  v_defaults_submit  int;
  v_defaults_stats   int;

  v_before_count int;
  v_after_count int;

  v_reject_ok boolean;
  v_sqlstate_got text;

  v_priv_anon boolean;
  v_priv_authenticated boolean;
  v_priv_service_role boolean;

  v_stone_total int;
  v_stone_g1 int;
  v_stone_g2 int;

  v_stats jsonb;
  v_i int;

  v_breaker_tripped boolean := false;
  v_breaker_sqlstate text;

  v_table_insert_grant_count int;
  v_table_select_grant_count int;
begin
  -- crm_require_owner_admin short-circuit เฉพาะ auth.role()='service_role' —
  -- connection ผ่าน run-sql.mjs ไม่มี JWT claim นี้โดยปริยาย ต้องตั้งเองในทรานแซกชัน
  -- นี้เท่านั้น (`true` = หมดอายุพร้อม transaction, 3j-migration-traps #11)
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  select id into v_real_shop_id from public.shop order by id limit 1;
  if v_real_shop_id is null then
    v_log := v_log || 'SETUP: FAIL — ไม่พบ public.shop แม้แต่แถวเดียว ทดสอบต่อไม่ได้' || E'\n';
    raise exception '%', v_log;
  end if;

  -- --------------------------------------------------------------------
  -- T1 — signature เดียว ไม่เกิด overload + ไม่มี default พารามิเตอร์
  -- --------------------------------------------------------------------
  select count(*), sum(pronargdefaults) into v_sig_count_submit, v_defaults_submit
  from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'gem_quiz_submit';
  select count(*), sum(pronargdefaults) into v_sig_count_stats, v_defaults_stats
  from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'gem_quiz_stats';

  if v_sig_count_submit = 1 and coalesce(v_defaults_submit, 0) = 0
     and v_sig_count_stats = 1 and coalesce(v_defaults_stats, 0) = 0 then
    v_log := v_log || 'T1 (signature เดียวทั้งคู่ ไม่มี default param): PASS' || E'\n';
  else
    v_log := v_log || format('T1: FAIL — submit count=%s defaults=%s / stats count=%s defaults=%s',
      v_sig_count_submit, v_defaults_submit, v_sig_count_stats, v_defaults_stats) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T2 — grant model (3j-migration-traps #18): anon/authenticated=false,
  -- service_role=true สำหรับทั้งสอง RPC
  -- --------------------------------------------------------------------
  select has_function_privilege('anon', 'analytics.gem_quiz_submit(uuid,smallint,text,text[],jsonb,text[],boolean)', 'execute'),
         has_function_privilege('authenticated', 'analytics.gem_quiz_submit(uuid,smallint,text,text[],jsonb,text[],boolean)', 'execute'),
         has_function_privilege('service_role', 'analytics.gem_quiz_submit(uuid,smallint,text,text[],jsonb,text[],boolean)', 'execute')
  into v_priv_anon, v_priv_authenticated, v_priv_service_role;

  if v_priv_anon is false and v_priv_authenticated is false and v_priv_service_role is true then
    v_log := v_log || 'T2a (grant gem_quiz_submit: anon/authenticated=false, service_role=true): PASS' || E'\n';
  else
    v_log := v_log || format('T2a: FAIL — anon=%s authenticated=%s service_role=%s', v_priv_anon, v_priv_authenticated, v_priv_service_role) || E'\n';
  end if;

  select has_function_privilege('anon', 'analytics.gem_quiz_stats(uuid,date,date,boolean)', 'execute'),
         has_function_privilege('authenticated', 'analytics.gem_quiz_stats(uuid,date,date,boolean)', 'execute'),
         has_function_privilege('service_role', 'analytics.gem_quiz_stats(uuid,date,date,boolean)', 'execute')
  into v_priv_anon, v_priv_authenticated, v_priv_service_role;

  if v_priv_anon is false and v_priv_authenticated is false and v_priv_service_role is true then
    v_log := v_log || 'T2b (grant gem_quiz_stats: anon/authenticated=false, service_role=true): PASS' || E'\n';
  else
    v_log := v_log || format('T2b: FAIL — anon=%s authenticated=%s service_role=%s', v_priv_anon, v_priv_authenticated, v_priv_service_role) || E'\n';
  end if;

  -- T2c — gem_quiz_response: ไม่มี INSERT grant ให้ role ใดเลยนอกจากเจ้าของ
  -- ตาราง (postgres เอง มีสิทธิ์เต็มเสมอโดยธรรมชาติของ Postgres — ไม่ใช่ role
  -- ที่ client ไหนใช้ได้ จึงไม่นับเป็นช่องเขียนที่สอง), service_role
  -- ได้ SELECT อย่างเดียว (design §3.2 คำเตือน "implementer")
  select count(*) into v_table_insert_grant_count
  from information_schema.role_table_grants
  where table_schema = 'analytics' and table_name = 'gem_quiz_response'
    and privilege_type = 'INSERT' and grantee <> 'postgres';
  select count(*) into v_table_select_grant_count
  from information_schema.role_table_grants
  where table_schema = 'analytics' and table_name = 'gem_quiz_response'
    and privilege_type = 'SELECT' and grantee = 'service_role';

  if v_table_insert_grant_count = 0 and v_table_select_grant_count = 1 then
    v_log := v_log || 'T2c (gem_quiz_response: ไม่มี INSERT grant เลย, service_role มี SELECT): PASS' || E'\n';
  else
    v_log := v_log || format('T2c: FAIL — insert_grants=%s select_grant_service_role=%s', v_table_insert_grant_count, v_table_select_grant_count) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T3 — seed 12 แถว ครบ 2 กลุ่มราคาตาม design §3.1
  -- --------------------------------------------------------------------
  select count(*) into v_stone_total from analytics.gem_quiz_stone;
  select count(*) into v_stone_g1 from analytics.gem_quiz_stone where price_group = 1;
  select count(*) into v_stone_g2 from analytics.gem_quiz_stone where price_group = 2;

  if v_stone_total = 12 and v_stone_g1 = 5 and v_stone_g2 = 7 then
    v_log := v_log || 'T3 (seed 12 แถว: group1=5, group2=7): PASS' || E'\n';
  else
    v_log := v_log || format('T3: FAIL — total=%s g1=%s g2=%s', v_stone_total, v_stone_g1, v_stone_g2) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T4 — happy path: insert ผ่านได้จริง, respondents ใน stats ขยับ +1
  -- --------------------------------------------------------------------
  select count(*) into v_before_count from analytics.gem_quiz_response where shop_id = v_real_shop_id;

  perform analytics.gem_quiz_submit(
    v_real_shop_id, 1::smallint, 'card',
    array['blue_topaz', 'amethyst']::text[],
    '{"q_intent": "opt_a"}'::jsonb,
    array['pearl']::text[],
    false
  );

  select count(*) into v_after_count from analytics.gem_quiz_response where shop_id = v_real_shop_id;

  if v_after_count = v_before_count + 1 then
    v_log := v_log || 'T4 (happy path insert ผ่าน, respondents +1): PASS' || E'\n';
  else
    v_log := v_log || format('T4: FAIL — before=%s after=%s', v_before_count, v_after_count) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T5 — เคสที่ต้องถูกปฏิเสธ (R-6/R-7 ระดับ DB — route handler ควรกรองได้
  -- ก่อนถึงตรงนี้แล้ว แต่ RPC ต้องปฏิเสธเองด้วย ไม่เชื่อ caller)
  -- --------------------------------------------------------------------

  -- T5a: liked มีรหัสที่ไม่มีจริง
  v_reject_ok := false;
  begin
    perform analytics.gem_quiz_submit(v_real_shop_id, 1::smallint, 'card', array['not_a_real_stone']::text[], '{}'::jsonb, array['pearl']::text[], false);
  exception when others then
    v_reject_ok := true; get stacked diagnostics v_sqlstate_got = returned_sqlstate;
  end;
  if v_reject_ok and v_sqlstate_got = '22023' then
    v_log := v_log || 'T5a (liked รหัสไม่มีจริง ⇒ 22023): PASS' || E'\n';
  else
    v_log := v_log || format('T5a: FAIL — reject=%s sqlstate=%s', v_reject_ok, coalesce(v_sqlstate_got, '(none)')) || E'\n';
  end if;

  -- T5b: liked ซ้ำ
  v_reject_ok := false;
  begin
    perform analytics.gem_quiz_submit(v_real_shop_id, 1::smallint, 'card', array['pearl', 'pearl']::text[], '{}'::jsonb, array['pearl']::text[], false);
  exception when others then v_reject_ok := true; end;
  if v_reject_ok then v_log := v_log || 'T5b (liked ซ้ำ ⇒ ปฏิเสธ): PASS' || E'\n';
  else v_log := v_log || 'T5b: FAIL — liked ซ้ำกลับไม่ถูกปฏิเสธ' || E'\n'; end if;

  -- T5c: liked เกิน 3 (ชน CHECK ของตาราง — คนละ errcode จาก RPC validation
  -- โดยตรง แต่ก็ต้อง raise และ state ต้องไม่ขยับเหมือนกัน)
  v_reject_ok := false;
  begin
    perform analytics.gem_quiz_submit(v_real_shop_id, 1::smallint, 'card', array['pearl','nil','ruby','sapphire']::text[], '{}'::jsonb, array['pearl']::text[], false);
  exception when others then v_reject_ok := true; end;
  if v_reject_ok then v_log := v_log || 'T5c (liked เกิน 3 ⇒ ปฏิเสธ): PASS' || E'\n';
  else v_log := v_log || 'T5c: FAIL — liked เกิน 3 กลับไม่ถูกปฏิเสธ' || E'\n'; end if;

  -- T5d: answers key ไม่ตรง regex (มีตัวพิมพ์ใหญ่)
  v_reject_ok := false;
  begin
    perform analytics.gem_quiz_submit(v_real_shop_id, 1::smallint, 'card', array[]::text[], '{"Bad-Key": "opt_a"}'::jsonb, array['pearl']::text[], false);
  exception when others then v_reject_ok := true; get stacked diagnostics v_sqlstate_got = returned_sqlstate; end;
  if v_reject_ok and v_sqlstate_got = '22023' then
    v_log := v_log || 'T5d (answers key ผิด regex ⇒ 22023): PASS' || E'\n';
  else
    v_log := v_log || format('T5d: FAIL — reject=%s sqlstate=%s', v_reject_ok, coalesce(v_sqlstate_got, '(none)')) || E'\n';
  end if;

  -- T5e: answers value เป็นข้อความไทย (หลุด regex ภาษาไทย/ช่องว่าง) — ด่านกัน
  -- ข้อความอิสระที่สำคัญที่สุดของไฟล์นี้
  v_reject_ok := false;
  begin
    perform analytics.gem_quiz_submit(v_real_shop_id, 1::smallint, 'card', array[]::text[], '{"q_intent": "อยากได้ความรัก"}'::jsonb, array['pearl']::text[], false);
  exception when others then v_reject_ok := true; end;
  if v_reject_ok then v_log := v_log || 'T5e (answers value เป็นข้อความไทย ⇒ ปฏิเสธ): PASS' || E'\n';
  else v_log := v_log || 'T5e: FAIL — ข้อความไทยหลุดผ่านเข้า DB ได้!' || E'\n'; end if;

  -- T5f: answers value เป็น JSON number ไม่ใช่ string
  v_reject_ok := false;
  begin
    perform analytics.gem_quiz_submit(v_real_shop_id, 1::smallint, 'card', array[]::text[], '{"q_intent": 123}'::jsonb, array['pearl']::text[], false);
  exception when others then v_reject_ok := true; end;
  if v_reject_ok then v_log := v_log || 'T5f (answers value เป็น number ไม่ใช่ string ⇒ ปฏิเสธ): PASS' || E'\n';
  else v_log := v_log || 'T5f: FAIL — number value หลุดผ่าน' || E'\n'; end if;

  -- T5g: answers เป็น JSON array ไม่ใช่ object (trap #13: ต้องเช็ค jsonb_typeof)
  v_reject_ok := false;
  begin
    perform analytics.gem_quiz_submit(v_real_shop_id, 1::smallint, 'card', array[]::text[], '["a","b"]'::jsonb, array['pearl']::text[], false);
  exception when others then v_reject_ok := true; end;
  if v_reject_ok then v_log := v_log || 'T5g (answers เป็น array ไม่ใช่ object ⇒ ปฏิเสธ): PASS' || E'\n';
  else v_log := v_log || 'T5g: FAIL — JSON array หลุดผ่าน' || E'\n'; end if;

  -- T5h: recommended ว่าง (0 ตัว)
  v_reject_ok := false;
  begin
    perform analytics.gem_quiz_submit(v_real_shop_id, 1::smallint, 'card', array[]::text[], '{}'::jsonb, array[]::text[], false);
  exception when others then v_reject_ok := true; end;
  if v_reject_ok then v_log := v_log || 'T5h (recommended ว่าง 0 ตัว ⇒ ปฏิเสธ): PASS' || E'\n';
  else v_log := v_log || 'T5h: FAIL — recommended ว่างกลับไม่ถูกปฏิเสธ' || E'\n'; end if;

  -- T5i: src ไม่อยู่ใน whitelist
  v_reject_ok := false;
  begin
    perform analytics.gem_quiz_submit(v_real_shop_id, 1::smallint, 'totally_bogus', array[]::text[], '{}'::jsonb, array['pearl']::text[], false);
  exception when others then v_reject_ok := true; end;
  if v_reject_ok then v_log := v_log || 'T5i (src ไม่อยู่ใน whitelist ⇒ ปฏิเสธ): PASS' || E'\n';
  else v_log := v_log || 'T5i: FAIL — src แปลกหลุดผ่าน' || E'\n'; end if;

  -- T5j: quiz_version เกินช่วง
  v_reject_ok := false;
  begin
    perform analytics.gem_quiz_submit(v_real_shop_id, 999::smallint, 'card', array[]::text[], '{}'::jsonb, array['pearl']::text[], false);
  exception when others then v_reject_ok := true; end;
  if v_reject_ok then v_log := v_log || 'T5j (quiz_version เกินช่วง ⇒ ปฏิเสธ): PASS' || E'\n';
  else v_log := v_log || 'T5j: FAIL — quiz_version 999 หลุดผ่าน' || E'\n'; end if;

  -- --------------------------------------------------------------------
  -- T6 — ห้ามพัง: "ยังไม่มีในใจ" (liked ว่าง) ต้องผ่านได้ (B1)
  -- --------------------------------------------------------------------
  v_reject_ok := false;
  begin
    perform analytics.gem_quiz_submit(v_real_shop_id, 1::smallint, 'direct', array[]::text[], '{}'::jsonb, array['garnet']::text[], false);
  exception when others then v_reject_ok := true; end;
  if not v_reject_ok then v_log := v_log || 'T6 (liked ว่าง = "ยังไม่มีในใจ" ⇒ ผ่าน ไม่ถูกปฏิเสธ): PASS' || E'\n';
  else v_log := v_log || 'T6: FAIL — liked ว่างกลับถูกปฏิเสธ (B1 พัง)' || E'\n'; end if;

  -- --------------------------------------------------------------------
  -- T7 — circuit breaker: ยิงจน cap (100) แล้วตัวที่ 101 ต้องโดน P0001
  -- now() คงที่ทั้งทรานแซกชัน (3j-migration-traps #22) ⇒ ทุกแถวที่ insert ใน
  -- บล็อกนี้ได้ created_at เดียวกัน อยู่ในหน้าต่าง 10 นาทีแน่นอน 100% ไม่มี flaky
  -- --------------------------------------------------------------------
  for v_i in 1..100 loop
    begin
      perform analytics.gem_quiz_submit(v_real_shop_id, 1::smallint, 'direct', array[]::text[], '{}'::jsonb, array['garnet']::text[], true);
    exception when others then
      -- ถ้าหลุด cap ก่อนครบ 100 รอบ (เช่นมีแถวเก่าในหน้าต่าง 10 นาทีจริงบน
      -- prod อยู่แล้ว) ให้หยุดลูปแล้วรายงานแทน ไม่ปล่อยให้ error ทำบล็อกทั้ง
      -- ก้อนพังก่อนถึง T8
      v_breaker_tripped := true;
      get stacked diagnostics v_breaker_sqlstate = returned_sqlstate;
      exit;
    end;
  end loop;

  if not v_breaker_tripped then
    -- ยังไม่เกิน cap หลัง 100 รอบ (คาดหวัง ถ้า prod ไม่มีแถวค้างในหน้าต่าง
    -- นี้มาก่อน) ⇒ ยิงอีก 1 ครั้งต้องโดน P0001
    begin
      perform analytics.gem_quiz_submit(v_real_shop_id, 1::smallint, 'direct', array[]::text[], '{}'::jsonb, array['garnet']::text[], true);
      v_log := v_log || 'T7: FAIL — ยิงเกิน cap แล้วไม่ถูกปฏิเสธเลย' || E'\n';
    exception when others then
      get stacked diagnostics v_breaker_sqlstate = returned_sqlstate;
      if v_breaker_sqlstate = 'P0001' then
        v_log := v_log || 'T7 (circuit breaker: เกิน cap ⇒ P0001): PASS' || E'\n';
      else
        v_log := v_log || format('T7: FAIL — ถูกปฏิเสธด้วย sqlstate=%s (คาด P0001)', v_breaker_sqlstate) || E'\n';
      end if;
    end;
  else
    if v_breaker_sqlstate = 'P0001' then
      v_log := v_log || 'T7 (circuit breaker: เกิน cap ก่อนครบ 100 รอบ เพราะมีแถวค้างอยู่แล้ว ⇒ P0001): PASS' || E'\n';
    else
      v_log := v_log || format('T7: FAIL — breaker trip ด้วย sqlstate=%s (คาด P0001)', v_breaker_sqlstate) || E'\n';
    end if;
  end if;

  -- --------------------------------------------------------------------
  -- T8 — gem_quiz_stats: ด่าน owner/admin ทำงาน + shape ตรงตาม §3.4
  -- --------------------------------------------------------------------

  -- T8a: เรียกโดยไม่มี service_role claim ⇒ ต้องถูกปฏิเสธ (จำลองด้วยการล้าง
  -- claim ชั่วคราวในทรานแซกชันนี้แล้วตั้งกลับ)
  perform set_config('request.jwt.claims', '{}', true);
  v_reject_ok := false;
  begin
    perform analytics.gem_quiz_stats(v_real_shop_id, current_date - 30, current_date, false);
  exception when others then v_reject_ok := true; end;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  if v_reject_ok then v_log := v_log || 'T8a (ไม่ใช่ service_role/owner ⇒ gem_quiz_stats ปฏิเสธ): PASS' || E'\n';
  else v_log := v_log || 'T8a: FAIL — เรียกได้โดยไม่มีสิทธิ์' || E'\n'; end if;

  -- T8b: shape ของ jsonb ที่คืนมา (service_role ผ่านด่านแล้ว)
  v_stats := analytics.gem_quiz_stats(v_real_shop_id, current_date - 30, current_date, true);

  if v_stats ? 'respondents' and v_stats ? 'by_src' and v_stats ? 'liked'
     and v_stats ? 'liked_none' and v_stats ? 'recommended' and v_stats ? 'agreement'
     and v_stats ? 'crosstab' and v_stats ? 'daily' and v_stats ? 'by_src_liked'
     and (v_stats -> 'by_src') ? 'card' and (v_stats -> 'by_src') ? 'share'
     and (v_stats -> 'by_src') ? 'live' and (v_stats -> 'by_src') ? 'direct'
     and jsonb_typeof(v_stats -> 'respondents') = 'number'
     and (v_stats ->> 'respondents')::int >= 1 then
    v_log := v_log || format('T8b (gem_quiz_stats คืน shape ครบ 9 key, by_src ครบ 4 ค่า, respondents=%s): PASS', v_stats ->> 'respondents') || E'\n';
  else
    v_log := v_log || format('T8b: FAIL — stats=%s', v_stats) || E'\n';
  end if;

  -- T8c: p_from > p_to ⇒ ปฏิเสธ
  v_reject_ok := false;
  begin
    perform analytics.gem_quiz_stats(v_real_shop_id, current_date, current_date - 1, true);
  exception when others then v_reject_ok := true; end;
  if v_reject_ok then v_log := v_log || 'T8c (p_from > p_to ⇒ ปฏิเสธ): PASS' || E'\n';
  else v_log := v_log || 'T8c: FAIL — ช่วงวันที่กลับหัวหลุดผ่าน' || E'\n'; end if;

  -- T8d: ช่วงเกิน 366 วัน ⇒ ปฏิเสธ
  v_reject_ok := false;
  begin
    perform analytics.gem_quiz_stats(v_real_shop_id, current_date - 400, current_date, true);
  exception when others then v_reject_ok := true; end;
  if v_reject_ok then v_log := v_log || 'T8d (ช่วงวันที่เกิน 366 วัน ⇒ ปฏิเสธ): PASS' || E'\n';
  else v_log := v_log || 'T8d: FAIL — ช่วงวันที่ยาวเกินหลุดผ่าน' || E'\n'; end if;

  -- --------------------------------------------------------------------
  -- T9 — ห้ามพัง: shop_id ที่ไม่มีจริง ⇒ gem_quiz_stats ต้องปฏิเสธด้วย (ไม่มี
  -- shop_member แถวไหนตรง p_shop_id ปลอม ⇒ crm_require_owner_admin ปฏิเสธ)
  -- ต่างจาก T8a ที่ทดสอบเรื่อง role ไม่ใช่เรื่อง shop
  -- --------------------------------------------------------------------
  v_reject_ok := false;
  begin
    perform set_config('request.jwt.claims', '{}', true);
    perform analytics.gem_quiz_stats(v_other_shop_id, current_date - 30, current_date, true);
  exception when others then v_reject_ok := true; end;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  if v_reject_ok then v_log := v_log || 'T9 (shop_id ปลอม + ไม่ใช่ service_role ⇒ ปฏิเสธ): PASS' || E'\n';
  else v_log := v_log || 'T9: FAIL — shop_id ปลอมหลุดผ่าน' || E'\n'; end if;

  raise exception '%', v_log;  -- บังคับ rollback ทั้งก้อน (3j-migration-traps #11) — DB ไม่ขยับจริง
end;
$verify0154$;
