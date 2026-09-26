-- scripts/verify-0151.sql
-- ทดสอบ 0151_content_post_update_type.sql — do-block + raise exception บังคับ
-- rollback เสมอ (3j-migration-traps #11) ห้ามรันแยกเป็น script ที่ COMMIT.
--
-- วิธีรัน: ต่อไฟล์ 0151_content_post_update_type.sql + ไฟล์นี้เข้าด้วยกันแล้ว
-- รันผ่าน node scripts/run-sql.mjs (ซ้อม, rollback อัตโนมัติทั้งคู่อยู่แล้ว) —
-- หรือหลัง apply 0151 จริงแล้ว: node scripts/run-sql.mjs scripts/verify-0151.sql
--
-- 🔴 เขียนจาก worktree นี้โดยไม่มี MCP/DB access ให้ query สดก่อนเขียน (ต่างจาก
-- verify-0150.sql ที่ยืนยัน step จริงบน prod ได้ก่อนเขียน) — ใช้ fixture
-- content_post ที่สร้าง+ลบเองในทรานแซกชันเดียวกัน (insert ตรง ไม่ผ่าน
-- content_post_upsert เพราะกำลังทดสอบฟังก์ชันอื่น ไม่ต้องพึ่งมัน) แทนการหยิบ
-- แถวจริง — เหตุผล: content_post เป็นตารางที่เพิ่งเปิดใช้จริงจาก 0148 (P2)
-- เมื่อวันก่อน อาจมี 0 แถวจริงบน prod ตอนนี้ก็ได้ (เจ้าของยังไม่เริ่มวางลิงก์) —
-- ไม่มีทางรู้จากในนี้ ⇒ ต้องพึ่ง fixture เพื่อให้ทดสอบได้แน่นอนไม่ว่าตารางจะมี
-- ข้อมูลจริงอยู่แล้วกี่แถว ทุกอย่างอยู่ใน 1 ทรานแซกชัน + raise ปิดท้าย ⇒ ไม่มี
-- แถวปลอมหลุดค้างจริงไม่ว่าจะรันกี่ครั้ง
--
-- shop_id ที่ใช้: ดึงจริงจาก public.shop (order by id limit 1) ณ เวลารัน ไม่
-- hardcode ค่าจากไฟล์อื่น (เช่น verify-0150.sql's a7c850ee-...) เพราะไม่มีทาง
-- ยืนยันจากในนี้ว่าค่านั้นยังถูกอยู่ตอนไฟล์นี้ถูกรันจริง — content_post.shop_id
-- มี FK ไป public.shop เข้มงวด (0148) การ insert fixture ต้องใช้ shop จริงเท่านั้น
--
-- อ่านผลจาก NOTICE — บรรทัดรูปแบบ "ชื่อเทสต์: PASS/FAIL" ทุกข้อ
-- นับ FAIL ด้วย: grep -o ': FAIL' (ไม่ grep คำว่า FAIL เฉยๆ)

do $verify0151$
declare
  v_log text := E'\n=== verify-0151 (content_post_update_type) ===\n';

  -- ชนิดแยกตามความหมายเสมอ (3j-migration-traps #16)
  v_sig_count        int;
  v_sig_args         text;
  v_defaults_count   int;

  v_real_shop_id     uuid;
  v_other_shop_id    uuid;
  v_fixture_post_id  uuid;
  v_fixture_metric_id uuid;

  v_code             text;
  v_read_code        text;
  v_ts_now           timestamptz;
  v_ts_baseline      timestamptz;
  v_tx_now           timestamptz;
  v_all_match_tx_now boolean := true;
  v_code_mismatch    boolean := false;
  v_loop_rounds      int := 0;

  v_reject_ok        boolean;
  v_sqlstate_got     text;
  v_after_bad_call_code text;

  -- T9 — status ไม่ใช่ active
  v_t9_reject_ok     boolean;
  v_t9_state_after   text;

  v_priv_anon          boolean;
  v_priv_authenticated boolean;
  v_priv_service_role  boolean;

  v_trigger_count    int;

  -- ห้ามพัง — metric ของ fixture ต้องไม่ถูกแตะเลย (ฟังก์ชันนี้ไม่ควรไปยุ่งกับ
  -- content_post_metric เลย) เทียบ md5 ของทุกคอลัมน์ที่นับได้ก่อน/หลัง
  v_metric_md5_before text;
  v_metric_md5_after  text;

  -- ห้ามพัง — count รวมของตารางต้องขยับตามจำนวน fixture ที่เราสร้างเองเท่านั้น
  v_content_post_count_before int;
  v_content_post_count_after  int;
  v_metric_count_before       int;
  v_metric_count_after        int;
begin
  -- crm_require_owner_admin short-circuit เฉพาะ auth.role()='service_role' —
  -- connection ผ่าน run-sql.mjs ไม่มี JWT claim นี้โดยปริยาย ต้องตั้งเองใน
  -- ทรานแซกชันนี้เท่านั้น (`true` = หมดอายุพร้อม transaction)
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- --------------------------------------------------------------------
  -- T1 — signature เดียว ไม่เกิด overload + args ตรง + ไม่มี default เลย
  -- --------------------------------------------------------------------
  select count(*), string_agg(pg_get_function_identity_arguments(oid), '; '), sum(pronargdefaults)
  into v_sig_count, v_sig_args, v_defaults_count
  from pg_proc
  where pronamespace = 'analytics'::regnamespace and proname = 'content_post_update_type';

  if v_sig_count = 1 and v_sig_args = 'p_shop_id uuid, p_post_id uuid, p_content_type_code text' and v_defaults_count = 0 then
    v_log := v_log || 'T1 (signature เดียว, args ตรง, ไม่มี default): PASS' || E'\n';
  else
    v_log := v_log || format('T1: FAIL — count=%s args=%s defaults=%s', v_sig_count, v_sig_args, v_defaults_count) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T_trigger — ยืนยัน trg_content_post_updated_at ยังอยู่ (3j-migration-traps
  -- #19: ต้อง query pg_trigger ก่อนเขียน UPDATE — เอกสารไว้ที่นี่ว่าทำแล้ว)
  -- --------------------------------------------------------------------
  select count(*) into v_trigger_count
  from pg_trigger
  where tgrelid = 'analytics.content_post'::regclass and not tgisinternal;

  if v_trigger_count >= 1 then
    v_log := v_log || format('T_trigger (analytics.content_post มี trigger BEFORE UPDATE อยู่จริง, count=%s — ยอมรับว่า updated_at ขยับทุกครั้งที่เรียกโดยตั้งใจ, ดูคอมเมนต์หัวไฟล์ข้อ 4): PASS', v_trigger_count) || E'\n';
  else
    v_log := v_log || 'T_trigger: FAIL — ไม่พบ trigger บน analytics.content_post เลย (คาดว่ามี trg_content_post_updated_at จาก 0148)' || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- Setup — หา shop จริง (FK บังคับ) + สร้าง fixture content_post 1 แถว +
  -- fixture content_post_metric 1 แถว (พิสูจน์ "ห้ามพัง" metric ท้ายสคริปต์)
  -- --------------------------------------------------------------------
  select count(*) into v_content_post_count_before from analytics.content_post;
  select count(*) into v_metric_count_before from analytics.content_post_metric;

  select id into v_real_shop_id from public.shop order by id limit 1;

  if v_real_shop_id is null then
    v_log := v_log || 'SETUP: FAIL — ไม่พบ public.shop แม้แต่แถวเดียว ทดสอบต่อไม่ได้ (content_post.shop_id มี FK บังคับ)' || E'\n';
    raise exception '%', v_log;
  end if;

  -- shop ปลอมสำหรับเคส "post จริงแต่ shop ไม่ตรง" (T6a) — ไม่ insert จริง
  -- ใช้เป็นแค่พารามิเตอร์เรียก RPC เท่านั้น ไม่ต้องมี FK
  v_other_shop_id := gen_random_uuid();

  insert into analytics.content_post (
    shop_id, platform, external_id, post_url, posted_at, posted_date_th, content_type_code, status
  ) values (
    v_real_shop_id, 'tiktok',
    'https://www.tiktok.com/@__verify0151_test__/video/900000000000000001',
    'https://www.tiktok.com/@__verify0151_test__/video/900000000000000001',
    now() - interval '1 day', ((now() - interval '1 day') at time zone 'Asia/Bangkok')::date,
    null, 'active'
  )
  returning id, updated_at into v_fixture_post_id, v_ts_baseline;

  insert into analytics.content_post_metric (
    shop_id, post_id, captured_on, age_days, view_count, like_count, source, sources
  ) values (
    v_real_shop_id, v_fixture_post_id, (now() at time zone 'Asia/Bangkok')::date, 1, 12345, 67, 'manual', array['manual']
  )
  returning id into v_fixture_metric_id;

  select md5(
    coalesce(view_count::text, '') || '|' || coalesce(like_count::text, '') || '|' ||
    coalesce(comment_count::text, '') || '|' || coalesce(save_count::text, '') || '|' ||
    coalesce(share_count::text, '') || '|' || source || '|' || array_to_string(sources, ',')
  )
  into v_metric_md5_before
  from analytics.content_post_metric where id = v_fixture_metric_id;

  -- --------------------------------------------------------------------
  -- T2 + T5 — ตั้งค่าได้ครบทุก code จาก content_type จริง (ไม่ hardcode)
  -- อ่านกลับมาตรงทุกตัว + updated_at ขยับทุกครั้งที่เรียก (เทียบ now() ของ
  -- ทรานแซกชันนี้เอง — now() คงที่ทั้งทรานแซกชัน, 3j-migration-traps #22)
  -- --------------------------------------------------------------------
  select now() into v_tx_now;

  for v_code in select code from analytics.content_type order by code loop
    v_loop_rounds := v_loop_rounds + 1;

    perform analytics.content_post_update_type(v_real_shop_id, v_fixture_post_id, v_code);

    select cp.content_type_code, cp.updated_at into v_read_code, v_ts_now
    from analytics.content_post cp where cp.id = v_fixture_post_id;

    if v_read_code is distinct from v_code then
      v_code_mismatch := true;
    end if;

    if v_ts_now is distinct from v_tx_now then
      v_all_match_tx_now := false;
    end if;
  end loop;

  if v_loop_rounds >= 5 and not v_code_mismatch then
    v_log := v_log || format('T2 (ตั้งค่าครบทุก code จาก content_type จริง อ่านกลับมาตรงทุกตัว, rounds=%s): PASS', v_loop_rounds) || E'\n';
  else
    v_log := v_log || format('T2: FAIL — rounds=%s (ต้อง >= 5) mismatch=%s', v_loop_rounds, v_code_mismatch) || E'\n';
  end if;

  -- 🔴 ของเดิมมี clause "v_tx_now is distinct from v_ts_baseline" ต่อท้าย ซึ่ง
  -- เป็นจริงไม่ได้เลยโดยโครงสร้าง: fixture ถูก INSERT ในทรานแซกชันนี้ ⇒ updated_at
  -- ตอนเกิด = now() = v_tx_now อยู่แล้ว (trap #22) และจะ "ดันให้เป็นอดีตก่อน"
  -- ก็ไม่ได้ เพราะ trg_content_post_updated_at (BEFORE UPDATE, ยืนยันที่ T_trigger)
  -- เขียนทับเป็น now() ทุกครั้ง ⇒ T5 FAIL เสมอ ทั้งที่ฟังก์ชันถูก (ลองมาแล้ว 26 ก.ย. 69)
  -- สิ่งที่พิสูจน์ได้จริงในทรานแซกชันเดียวคือ "updated_at หลังเรียก = now() ทุกรอบ"
  -- เท่านั้น — ส่วน "ขยับจากค่าเดิมจริงไหม" ต้องทดสอบข้ามทรานแซกชัน ซึ่งขัดกับกฎ
  -- do-block+rollback (traps #11) ⇒ ยอมรับว่าไม่ครอบ และเขียนไว้ตรงนี้ว่าไม่ครอบ
  if v_loop_rounds >= 5 and v_all_match_tx_now then
    v_log := v_log || format('T5 (updated_at หลังเรียก RPC = now() ของทรานแซกชันนี้ทุกรอบ, rounds=%s — ไม่ครอบ "ขยับจากค่าเดิม" ดูเหตุผลเหนือ if): PASS', v_loop_rounds) || E'\n';
  else
    v_log := v_log || format('T5: FAIL — rounds=%s (ต้อง >= 5) all_match_tx_now=%s tx_now=%s baseline=%s', v_loop_rounds, v_all_match_tx_now, v_tx_now, v_ts_baseline) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T4 — p_content_type_code = null ⇒ ต้อง raise (ห้าม null ไปเลย, ต่างจาก
  -- 0150 ที่ null=ล้างค่า) — state ต้องไม่ขยับจาก code ล่าสุดที่ตั้งไว้ในลูป T2
  -- --------------------------------------------------------------------
  select cp.content_type_code into v_read_code from analytics.content_post cp where cp.id = v_fixture_post_id;

  v_reject_ok := false;
  begin
    perform analytics.content_post_update_type(v_real_shop_id, v_fixture_post_id, null);
  exception when others then
    v_reject_ok := true;
    get stacked diagnostics v_sqlstate_got = returned_sqlstate;
  end;

  select cp.content_type_code into v_after_bad_call_code from analytics.content_post cp where cp.id = v_fixture_post_id;

  if v_reject_ok and v_sqlstate_got = '22023' and v_after_bad_call_code = v_read_code then
    v_log := v_log || 'T4 (p_content_type_code=null ถูกปฏิเสธด้วย 22023, ไม่ล้างค่า, ไม่ขยับจากค่าล่าสุด): PASS' || E'\n';
  else
    v_log := v_log || format('T4: FAIL — reject=%s sqlstate=%s before=%s after=%s', v_reject_ok, coalesce(v_sqlstate_got, '(none)'), coalesce(v_read_code, '(null)'), coalesce(v_after_bad_call_code, '(null)')) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T3 — code ที่ไม่มีใน content_type ⇒ ถูกปฏิเสธด้วย 22023, state ไม่ขยับ
  -- --------------------------------------------------------------------
  v_reject_ok := false;
  v_sqlstate_got := null;
  begin
    perform analytics.content_post_update_type(v_real_shop_id, v_fixture_post_id, '__not_a_real_code__');
  exception when others then
    v_reject_ok := true;
    get stacked diagnostics v_sqlstate_got = returned_sqlstate;
  end;

  select cp.content_type_code into v_after_bad_call_code from analytics.content_post cp where cp.id = v_fixture_post_id;

  if v_reject_ok and v_sqlstate_got = '22023' and v_after_bad_call_code = v_read_code then
    v_log := v_log || 'T3 (content_type_code ไม่มีจริง ถูกปฏิเสธด้วย 22023, state ไม่ขยับ): PASS' || E'\n';
  else
    v_log := v_log || format('T3: FAIL — reject=%s sqlstate=%s after=%s (คาด %s)', v_reject_ok, coalesce(v_sqlstate_got, '(none)'), coalesce(v_after_bad_call_code, '(null)'), coalesce(v_read_code, '(null)')) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T6a — post จริงแต่ p_shop_id ไม่ตรงเจ้าของจริง ⇒ ถูกปฏิเสธ, state ไม่ขยับ
  -- (พิสูจน์ shop_id อยู่ใน WHERE ของ select...for update จริง — กับดัก 0150 L2)
  -- --------------------------------------------------------------------
  v_reject_ok := false;
  begin
    perform analytics.content_post_update_type(v_other_shop_id, v_fixture_post_id, 'craft');
  exception when others then
    v_reject_ok := true;
  end;

  select cp.content_type_code into v_after_bad_call_code from analytics.content_post cp where cp.id = v_fixture_post_id;

  if v_reject_ok and v_after_bad_call_code = v_read_code then
    v_log := v_log || 'T6a (post จริงแต่ p_shop_id ไม่ตรงเจ้าของ ⇒ ถูกปฏิเสธ, state ไม่ขยับ): PASS' || E'\n';
  else
    v_log := v_log || format('T6a: FAIL — reject=%s after=%s (คาด %s)', v_reject_ok, coalesce(v_after_bad_call_code, '(null)'), coalesce(v_read_code, '(null)')) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T6b — p_post_id ที่ไม่มีอยู่จริง (shop ถูกต้อง) ⇒ ถูกปฏิเสธเช่นกัน
  -- --------------------------------------------------------------------
  v_reject_ok := false;
  begin
    perform analytics.content_post_update_type(v_real_shop_id, gen_random_uuid(), 'craft');
  exception when others then
    v_reject_ok := true;
  end;

  if v_reject_ok then
    v_log := v_log || 'T6b (post_id ไม่มีอยู่จริง ⇒ ถูกปฏิเสธ): PASS' || E'\n';
  else
    v_log := v_log || 'T6b: FAIL — post_id ปลอมกลับไม่ถูกปฏิเสธ' || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- ห้ามพัง — crm_require_owner_admin ยังทำงานอยู่: p_shop_id/p_post_id เป็น
  -- null ต้อง raise ตั้งแต่ก่อนแตะอะไรเลย
  -- --------------------------------------------------------------------
  v_reject_ok := false;
  begin
    perform analytics.content_post_update_type(null, v_fixture_post_id, 'craft');
  exception when others then
    v_reject_ok := true;
  end;
  if v_reject_ok then
    v_log := v_log || 'T_null_shop (p_shop_id null ⇒ ปฏิเสธตั้งแต่ต้น): PASS' || E'\n';
  else
    v_log := v_log || 'T_null_shop: FAIL — p_shop_id null กลับไม่ถูกปฏิเสธ' || E'\n';
  end if;

  v_reject_ok := false;
  begin
    perform analytics.content_post_update_type(v_real_shop_id, null, 'craft');
  exception when others then
    v_reject_ok := true;
  end;
  if v_reject_ok then
    v_log := v_log || 'T_null_post (p_post_id null ⇒ ปฏิเสธตั้งแต่ต้น): PASS' || E'\n';
  else
    v_log := v_log || 'T_null_post: FAIL — p_post_id null กลับไม่ถูกปฏิเสธ' || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T9 — โพสต์สถานะไม่ใช่ active (deleted) ⇒ แก้ประเภทไม่ได้ (บรีฟข้อบังคับ
  -- "โพสต์ต้อง status='active'") — คืนสถานะกลับก่อนไปต่อ (วินัยเดียวกับ
  -- 0150's T_L1 แม้ท้ายสคริปต์ rollback อยู่แล้วก็ตาม)
  -- --------------------------------------------------------------------
  update analytics.content_post set status = 'deleted' where id = v_fixture_post_id;

  v_t9_reject_ok := false;
  begin
    perform analytics.content_post_update_type(v_real_shop_id, v_fixture_post_id, 'craft');
  exception when others then
    v_t9_reject_ok := true;
  end;

  select cp.content_type_code into v_t9_state_after from analytics.content_post cp where cp.id = v_fixture_post_id;

  update analytics.content_post set status = 'active' where id = v_fixture_post_id;  -- คืนสถานะก่อนไปต่อ

  if v_t9_reject_ok and v_t9_state_after = v_read_code then
    v_log := v_log || 'T9 (โพสต์สถานะ deleted ⇒ แก้ประเภทถูกปฏิเสธ, state ไม่ขยับ): PASS' || E'\n';
  else
    v_log := v_log || format('T9: FAIL — reject=%s state_after=%s (คาด %s)', v_t9_reject_ok, coalesce(v_t9_state_after, '(null)'), coalesce(v_read_code, '(null)')) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T7 — grant model: มีแค่ service_role ที่ execute ได้ (3j-migration-traps #18)
  -- --------------------------------------------------------------------
  select has_function_privilege('anon', 'analytics.content_post_update_type(uuid,uuid,text)', 'execute') into v_priv_anon;
  select has_function_privilege('authenticated', 'analytics.content_post_update_type(uuid,uuid,text)', 'execute') into v_priv_authenticated;
  select has_function_privilege('service_role', 'analytics.content_post_update_type(uuid,uuid,text)', 'execute') into v_priv_service_role;

  if v_priv_anon is false and v_priv_authenticated is false and v_priv_service_role is true then
    v_log := v_log || 'T7 (has_function_privilege: anon/authenticated=false, service_role=true): PASS' || E'\n';
  else
    v_log := v_log || format('T7: FAIL — anon=%s authenticated=%s service_role=%s', v_priv_anon, v_priv_authenticated, v_priv_service_role) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- ห้ามพัง — ฟังก์ชันนี้ไม่แตะ content_post_metric เลย (ไม่ cascade, ไม่มี
  -- trigger ข้ามตาราง) เทียบ md5 ของ fixture metric ก่อน/หลังการเรียกทั้งหมด
  -- ข้างบน (รวม T2's 5+ รอบ, T9's toggle สถานะ ฯลฯ)
  -- --------------------------------------------------------------------
  select md5(
    coalesce(view_count::text, '') || '|' || coalesce(like_count::text, '') || '|' ||
    coalesce(comment_count::text, '') || '|' || coalesce(save_count::text, '') || '|' ||
    coalesce(share_count::text, '') || '|' || source || '|' || array_to_string(sources, ',')
  )
  into v_metric_md5_after
  from analytics.content_post_metric where id = v_fixture_metric_id;

  select count(*) into v_content_post_count_after from analytics.content_post;
  select count(*) into v_metric_count_after from analytics.content_post_metric;

  if v_metric_md5_after = v_metric_md5_before
     and v_content_post_count_after = v_content_post_count_before + 1  -- +1 = fixture ตัวเดียวที่เราสร้าง
     and v_metric_count_after = v_metric_count_before + 1 then
    v_log := v_log || 'T_metric_untouched (content_post_metric ของ fixture ไม่ถูกแตะเลยตลอดการทดสอบ, count เปลี่ยนแค่ตาม fixture ที่สร้างเอง): PASS' || E'\n';
  else
    v_log := v_log || format('T_metric_untouched: FAIL — metric_md5 before=%s after=%s · content_post count before=%s after=%s · metric count before=%s after=%s',
      v_metric_md5_before, v_metric_md5_after, v_content_post_count_before, v_content_post_count_after, v_metric_count_before, v_metric_count_after) || E'\n';
  end if;

  raise exception '%', v_log;  -- บังคับ rollback ทั้งก้อน (3j-migration-traps #11) — fixture ที่สร้างไว้ไม่ค้างจริง
end;
$verify0151$;
