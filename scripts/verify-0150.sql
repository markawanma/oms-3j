-- scripts/verify-0150.sql
-- ทดสอบ 0150_step_content_type_rpc.sql — do-block + raise exception บังคับ
-- rollback เสมอ (3j-migration-traps #11) ห้ามรันแยกเป็น script ที่ COMMIT.
--
-- วิธีรัน: ต่อไฟล์ 0150_step_content_type_rpc.sql + ไฟล์นี้เข้าด้วยกันแล้วรัน
-- ผ่าน node scripts/run-sql.mjs (ซ้อม, rollback อัตโนมัติทั้งคู่อยู่แล้ว) — หรือ
-- หลัง apply 0150 จริงแล้ว: node scripts/run-sql.mjs scripts/verify-0150.sql
--
-- ใช้ step จริงบนตาราง analytics.campaign_step (มี 55 แถว ทั้งหมดอยู่ shop
-- a7c850ee-6776-4c3e-ba72-ba9e8caba2b7 เดียว — ยืนยันด้วย query สด 25 ก.ย. 69)
-- ไม่สร้าง fixture step ใหม่ (3j-migration-traps #17) — เคส "step ของร้านอื่น"
-- (T6) ใช้ step จริงตัวนี้คู่กับ p_shop_id ปลอมแทน เพราะ prod มีร้านเดียวจริงๆ
-- ตอนนี้ ไม่มีร้านที่สองให้หยิบ.
--
-- อ่านผลจาก NOTICE — บรรทัดรูปแบบ "ชื่อเทสต์: PASS/FAIL" ทุกข้อ
-- นับ FAIL ด้วย: grep -o ': FAIL' (ไม่ grep คำว่า FAIL เฉยๆ)

do $verify0150$
declare
  v_log text := E'\n=== verify-0150 (campaign_step_set_content_type) ===\n';

  -- ชนิดแยกตามความหมายเสมอ (3j-migration-traps #16)
  v_sig_count        int;
  v_sig_args         text;
  v_defaults_count   int;

  v_real_step_id     uuid;
  v_real_shop_id     uuid;
  v_orig_code        text;

  v_code             text;
  v_read_code        text;
  v_ts_now           timestamptz;
  v_ts_baseline      timestamptz;
  -- 🔴 now() คืนเวลา "เริ่มทรานแซกชัน" ไม่ใช่เวลาต่อ statement — ทุกครั้งที่
  -- เรียก set_updated_at() ภายในทรานแซกชันทดสอบเดียวกันนี้ จะได้ค่าเดียวกันเป๊ะ
  -- เสมอ (ไม่ใช่ไล่เพิ่มทีละรอบแบบที่คิดไว้ตอนแรก) ⇒ พิสูจน์ "ขยับทุกครั้ง" ด้วย
  -- การเทียบว่าทุกรอบตรงกับ now() ของทรานแซกชันนี้เป๊ะ (v_tx_now) แทนการไล่เทียบ
  -- ตัวก่อนหน้า แล้วพิสูจน์แยกว่า v_tx_now ต่างจาก v_ts_baseline (ค่าประวัติศาสตร์
  -- จริงก่อนทดสอบ) เพื่อยืนยันว่ามันไม่ได้ค้างที่ค่าเดิม
  v_tx_now           timestamptz;
  v_all_match_tx_now boolean := true;
  v_code_mismatch    boolean := false;

  v_reject_ok        boolean;
  v_sqlstate_got     text;

  v_after_bad_call_code text;

  v_priv_anon         boolean;
  v_priv_authenticated boolean;
  v_priv_service_role boolean;

  v_campaign_step_count int;
  v_content_type_count  int;
  v_board_rows          int;
  v_board_cols           text;
begin
  -- crm_require_owner_admin short-circuit เฉพาะ auth.role()='service_role' —
  -- connection ผ่าน run-sql.mjs ไม่มี JWT claim นี้โดยปริยาย ต้องตั้งเองในทรานแซกชัน
  -- นี้เท่านั้น (`true` = หมดอายุพร้อม transaction, 3j-migration-traps #11)
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- --------------------------------------------------------------------
  -- T1 — signature เดียว ไม่เกิด overload + ไม่มี default พารามิเตอร์เลย
  -- --------------------------------------------------------------------
  select count(*), string_agg(pg_get_function_identity_arguments(oid), '; '), sum(pronargdefaults)
  into v_sig_count, v_sig_args, v_defaults_count
  from pg_proc
  where pronamespace = 'analytics'::regnamespace and proname = 'campaign_step_set_content_type';

  if v_sig_count = 1 and v_sig_args = 'p_shop_id uuid, p_step_id uuid, p_content_type_code text' and v_defaults_count = 0 then
    v_log := v_log || 'T1 (signature เดียว, args ตรง, ไม่มี default): PASS' || E'\n';
  else
    v_log := v_log || format('T1: FAIL — count=%s args=%s defaults=%s', v_sig_count, v_sig_args, v_defaults_count) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- หยิบ step จริงบน prod (ตัวแรกตาม id) — ไม่ใช่ fixture (trap #17)
  -- --------------------------------------------------------------------
  select cs.id, cs.shop_id, cs.content_type_code, cs.updated_at
  into v_real_step_id, v_real_shop_id, v_orig_code, v_ts_baseline
  from analytics.campaign_step cs
  order by cs.id
  limit 1;

  if v_real_step_id is null then
    v_log := v_log || 'SETUP: FAIL — ไม่พบ campaign_step แม้แต่แถวเดียวบน prod ทดสอบต่อไม่ได้' || E'\n';
    raise exception '%', v_log;
  end if;

  -- --------------------------------------------------------------------
  -- T2 — ตั้งค่าได้ครบทั้ง 5 code (อ่านจาก content_type จริง ไม่ hardcode)
  -- อ่านกลับมาตรงทุกตัว + T5 พ่วงในลูปเดียวกัน: updated_at ต้องขยับทุกครั้งที่
  -- เรียก (ดูคอมเมนต์ v_tx_now ด้านบนเรื่อง now() ระดับทรานแซกชัน)
  -- --------------------------------------------------------------------
  select now() into v_tx_now;

  for v_code in select code from analytics.content_type order by code loop
    perform analytics.campaign_step_set_content_type(v_real_shop_id, v_real_step_id, v_code);

    select cs.content_type_code, cs.updated_at into v_read_code, v_ts_now
    from analytics.campaign_step cs where cs.id = v_real_step_id;

    if v_read_code is distinct from v_code then
      v_code_mismatch := true;
    end if;

    if v_ts_now is distinct from v_tx_now then
      v_all_match_tx_now := false;
    end if;
  end loop;

  if not v_code_mismatch then
    v_log := v_log || 'T2 (ตั้งค่าครบทั้ง 5 code จาก content_type จริง อ่านกลับมาตรงทุกตัว): PASS' || E'\n';
  else
    v_log := v_log || 'T2: FAIL — มีอย่างน้อย 1 code ที่อ่านกลับมาไม่ตรงกับที่ตั้ง' || E'\n';
  end if;

  if v_all_match_tx_now and v_tx_now is distinct from v_ts_baseline then
    v_log := v_log || 'T5 (updated_at ขยับทุกครั้งที่เรียก RPC — เทียบเท่า now() ทุกรอบ และต่างจากค่าประวัติศาสตร์เดิม, ไม่ได้ปิด trigger): PASS' || E'\n';
  else
    v_log := v_log || format('T5: FAIL — all_match_tx_now=%s tx_now=%s baseline=%s', v_all_match_tx_now, v_tx_now, v_ts_baseline) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T4 — ส่ง null ⇒ ค่าถูกล้างเป็น null จริง (ก่อนหน้านี้ตั้งค่าไว้แล้วจากลูป T2
  -- ⇒ ถ้าเป็นแบบ null-preserving แบบ content_post_upsert เคสนี้จะ FAIL ทันที)
  -- --------------------------------------------------------------------
  perform analytics.campaign_step_set_content_type(v_real_shop_id, v_real_step_id, null);

  select cs.content_type_code into v_read_code from analytics.campaign_step cs where cs.id = v_real_step_id;

  if v_read_code is null then
    v_log := v_log || 'T4 (ส่ง null ⇒ content_type_code ถูกล้างเป็น null จริง ไม่ใช่คงค่าเดิม): PASS' || E'\n';
  else
    v_log := v_log || format('T4: FAIL — ได้ %s แทนที่จะเป็น null', v_read_code) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T3 — code ที่ไม่มีใน content_type ⇒ ถูกปฏิเสธด้วย 22023 (raise ชัดเจน
  -- ไม่ใช่ FK violation ดิบ 23503) + state ไม่ขยับ (ยังเป็น null จาก T4)
  -- --------------------------------------------------------------------
  v_reject_ok := false;
  begin
    perform analytics.campaign_step_set_content_type(v_real_shop_id, v_real_step_id, '__not_a_real_code__');
  exception when others then
    v_reject_ok := true;
    get stacked diagnostics v_sqlstate_got = returned_sqlstate;
  end;

  select cs.content_type_code into v_after_bad_call_code from analytics.campaign_step cs where cs.id = v_real_step_id;

  if v_reject_ok and v_sqlstate_got = '22023' and v_after_bad_call_code is null then
    v_log := v_log || 'T3 (code ไม่ถูกต้องถูกปฏิเสธด้วย SQLSTATE 22023 ตามที่เลือก, state ไม่ขยับ): PASS' || E'\n';
  else
    v_log := v_log || format('T3: FAIL — reject=%s sqlstate=%s state_after=%s', v_reject_ok, coalesce(v_sqlstate_got, '(none)'), coalesce(v_after_bad_call_code, '(null)')) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T6a — p_step_id ของ shop อื่น ⇒ ถูกปฏิเสธ (step จริงมีอยู่ แต่ p_shop_id
  -- ที่อ้างไม่ตรงเจ้าของจริง — สร้าง shop ปลอมไม่ได้เพราะ prod มีร้านเดียว จึง
  -- พิสูจน์ด้วยการสลับ p_shop_id เป็นค่าที่ไม่ใช่เจ้าของจริงแทน)
  -- --------------------------------------------------------------------
  v_reject_ok := false;
  begin
    perform analytics.campaign_step_set_content_type(gen_random_uuid(), v_real_step_id, 'craft');
  exception when others then
    v_reject_ok := true;
  end;

  select cs.content_type_code into v_after_bad_call_code from analytics.campaign_step cs where cs.id = v_real_step_id;

  if v_reject_ok and v_after_bad_call_code is null then
    v_log := v_log || 'T6a (step จริงแต่ p_shop_id ไม่ตรงเจ้าของ ⇒ ถูกปฏิเสธ, state ไม่ขยับ): PASS' || E'\n';
  else
    v_log := v_log || format('T6a: FAIL — reject=%s state_after=%s', v_reject_ok, coalesce(v_after_bad_call_code, '(null)')) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T6b — p_step_id ที่ไม่มีอยู่จริง (shop ถูกต้อง) ⇒ ถูกปฏิเสธเช่นกัน
  -- --------------------------------------------------------------------
  v_reject_ok := false;
  begin
    perform analytics.campaign_step_set_content_type(v_real_shop_id, gen_random_uuid(), 'craft');
  exception when others then
    v_reject_ok := true;
  end;

  if v_reject_ok then
    v_log := v_log || 'T6b (step_id ไม่มีอยู่จริง ⇒ ถูกปฏิเสธ): PASS' || E'\n';
  else
    v_log := v_log || 'T6b: FAIL — step_id ปลอมกลับไม่ถูกปฏิเสธ' || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- ห้ามพัง — crm_require_owner_admin ยังทำงานอยู่: p_shop_id เป็น null ต้อง
  -- raise ตั้งแต่ก่อนแตะอะไรเลย (ไม่ใช่ NPE/error แปลกๆ)
  -- --------------------------------------------------------------------
  v_reject_ok := false;
  begin
    perform analytics.campaign_step_set_content_type(null, v_real_step_id, 'craft');
  exception when others then
    v_reject_ok := true;
  end;

  if v_reject_ok then
    v_log := v_log || 'T_null_shop (p_shop_id null ⇒ ปฏิเสธตั้งแต่ต้น): PASS' || E'\n';
  else
    v_log := v_log || 'T_null_shop: FAIL — p_shop_id null กลับไม่ถูกปฏิเสธ' || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T7 — grant model: มีแค่ service_role ที่ execute ได้ (3j-migration-traps #18)
  -- --------------------------------------------------------------------
  select has_function_privilege('anon', 'analytics.campaign_step_set_content_type(uuid,uuid,text)', 'execute') into v_priv_anon;
  select has_function_privilege('authenticated', 'analytics.campaign_step_set_content_type(uuid,uuid,text)', 'execute') into v_priv_authenticated;
  select has_function_privilege('service_role', 'analytics.campaign_step_set_content_type(uuid,uuid,text)', 'execute') into v_priv_service_role;

  if v_priv_anon is false and v_priv_authenticated is false and v_priv_service_role is true then
    v_log := v_log || 'T7 (has_function_privilege: anon/authenticated=false, service_role=true): PASS' || E'\n';
  else
    v_log := v_log || format('T7: FAIL — anon=%s authenticated=%s service_role=%s', v_priv_anon, v_priv_authenticated, v_priv_service_role) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T8 — ของเดิมไม่พัง: campaign_step 55 แถว · content_type 5 · v_campaign_board
  -- 55 แถว 36 คอลัมน์ (view นี้ไม่ถูกแตะใน 0150 เลย แต่ทดสอบไว้กันของกลางพัง)
  -- --------------------------------------------------------------------
  select count(*) into v_campaign_step_count from analytics.campaign_step;
  select count(*) into v_content_type_count from analytics.content_type;
  select count(*) into v_board_rows from analytics.v_campaign_board;

  select count(*) into v_sig_count -- reuse int var: จำนวนคอลัมน์รวม
  from information_schema.columns
  where table_schema = 'analytics' and table_name = 'v_campaign_board';

  if v_campaign_step_count = 55 and v_content_type_count = 5 and v_board_rows = 55 and v_sig_count = 36 then
    v_log := v_log || 'T8 (ของเดิมไม่พัง: campaign_step=55, content_type=5, v_campaign_board=55 แถว/36 คอลัมน์): PASS' || E'\n';
  else
    v_log := v_log || format('T8: FAIL — campaign_step=%s content_type=%s board_rows=%s board_cols=%s',
      v_campaign_step_count, v_content_type_count, v_board_rows, v_sig_count) || E'\n';
  end if;

  raise exception '%', v_log;  -- บังคับ rollback ทั้งก้อน (3j-migration-traps #11) — DB ไม่ขยับจริง
end;
$verify0150$;
