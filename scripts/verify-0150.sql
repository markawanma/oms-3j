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
--
-- ============================================================================
-- 🔴 แก้รอบ security review (25 ก.ย. 69) — เดิม "10 PASS / 0 FAIL" แต่หลุด 3 จุด:
--
-- M1 — T2/T5 เดิมตั้ง flag เริ่มต้นเป็นค่าที่แปลว่าผ่าน (v_code_mismatch=false,
--    v_all_match_tx_now=true) แล้วให้ลูปเป็นตัวเดียวที่พลิก ⇒ ถ้า content_type
--    ว่างจะ PASS โดยไม่เรียกฟังก์ชันเลยสักครั้ง (เคสเดียวกับ `having count(*)>1`
--    — 3j-migration-traps #10). แก้ด้วย v_loop_rounds นับรอบจริง assert >= 5.
--
-- M2 — T8 เดิมนับแค่จำนวนแถว (ซึ่งขยับไม่ได้อยู่แล้วเพราะ 0150 ไม่ insert/delete)
--    = "ผ่านแน่นอนโดยไม่มีความหมาย" (3j-migration-traps #17) ไม่ได้พิสูจน์ว่า
--    แถวอื่นนอกเหนือ step เป้าหมายไม่โดน UPDATE ไปด้วย (3j-migration-traps #19)
--    ⇒ เพิ่ม md5(string_agg(updated_at)) + count(distinct updated_at) ของ 54
--    แถวที่ไม่ใช่เป้าหมาย เทียบก่อน/หลังภายในทรานแซกชันทดสอบเดียวกัน (ไม่ hardcode
--    เพราะ 0150 เองไม่ได้ backfill อะไร — baseline จับได้สดในทรานแซกชันนี้).
--
-- M3 — T8 เดิมเช็คแค่ count(*)=36 คอลัมน์ (ผ่านได้แม้ชื่อ/ชนิดเปลี่ยน) และ reuse
--    ตัวแปร v_sig_count ที่ T1 ใช้ไปแล้ว (ผิด 3j-migration-traps #16) ⇒ เปลี่ยนเป็น
--    md5 ของ "ordinal:name:type" ทั้ง 36 คอลัมน์ ใช้ตัวแปรใหม่แยกต่างหาก ค่าที่
--    ต้องได้ยืนยันแล้วด้วย query สด (รูปแบบ ordinal_position::text||':'||
--    column_name||':'||data_type คั่นด้วย ',' เรียง ordinal_position):
--    cd5f48a41bf46e5e077411c4360a4b19 (ก่อน=หลัง apply เพราะ 0150 ไม่แตะ view นี้)
--
-- L1 (Tech Lead ชี้ขาด) — เพิ่ม T_L1: code ที่ is_active=false ต้องถูกปฏิเสธ
--    (เดิมไม่มีเทสต์คลุมเคสนี้เลยทั้งที่โค้ดมี `and is_active` แล้ว)
--
-- L2 — โค้ดแก้แล้ว (shop_id เข้า WHERE ของ select...for update ตรงๆ) ตรวจ
--    functional ผ่าน T6a (shop ไม่ตรง ⇒ ปฏิเสธ) อยู่แล้ว — ส่วน "timing probe"
--    (แถวถูกล็อกอยู่ vs ไม่มีอยู่จริง ตอบเวลาต่างกัน) เป็นพฤติกรรมข้าม-connection
--    ไม่มีเครื่องมือจำลอง 2 connection พร้อมกันในสคริปต์เดียวนี้ ⇒ ไม่มีเทสต์คลุม
--    ส่วนนี้โดยตรง (บอกตรงๆ ตามกติกาใหม่ ไม่แสร้งว่าครอบแล้ว).
-- ============================================================================

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
  -- M1 (security 25 ก.ย. 69): flag เริ่มต้น "ผ่าน" อันตรายถ้าลูปไม่วนสักรอบ —
  -- นับรอบจริงแล้ว assert >= 5 แยกต่างหาก ไม่พึ่ง flag อย่างเดียว
  v_loop_rounds      int := 0;

  v_reject_ok        boolean;
  v_sqlstate_got     text;

  v_after_bad_call_code text;

  -- L1 — code ที่ is_active=false ต้องถูกปฏิเสธ
  v_l1_test_code     text;
  v_l1_reject_ok     boolean;
  v_l1_state_after   text;

  v_priv_anon         boolean;
  v_priv_authenticated boolean;
  v_priv_service_role boolean;

  v_campaign_step_count int;
  v_content_type_count  int;
  v_board_rows          int;

  -- M3 — md5 ของ ordinal:name:type ทั้ง 36 คอลัมน์ (แทนนับจำนวนเฉยๆ) ตัวแปรแยก
  -- จาก v_sig_count ของ T1 โดยเจตนา (3j-migration-traps #16: ห้ามใช้ตัวแปรซ้ำ
  -- ข้ามความหมาย)
  v_board_col_total     int;
  v_board_col_md5       text;
  v_board_col_md5_expect text := 'cd5f48a41bf46e5e077411c4360a4b19';  -- ยืนยันด้วย query สด 25 ก.ย. 69 (ก่อน=หลัง apply)

  -- M2 — md5/distinct ของ updated_at ในแถวที่ไม่ใช่ step เป้าหมาย (อีก 54 แถว)
  -- จับก่อน/หลังภายในทรานแซกชันทดสอบเดียวกัน (0150 ไม่ backfill อะไร ⇒ ไม่ต้อง
  -- hardcode ค่าประวัติศาสตร์แบบ 0145)
  v_other_md5_before      text;
  v_other_md5_after       text;
  v_other_distinct_before int;
  v_other_distinct_after  int;
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

  -- M2 baseline — จับ md5/distinct ของ updated_at ในแถวอื่นทั้งหมด (ไม่ใช่
  -- v_real_step_id) "ก่อน" เรียก RPC ครั้งแรก เทียบกับหลังจบทุกเทสต์ที่ T8
  select md5(string_agg(updated_at::text, '|' order by id)), count(distinct updated_at)
  into v_other_md5_before, v_other_distinct_before
  from analytics.campaign_step
  where id <> v_real_step_id;

  -- --------------------------------------------------------------------
  -- T2 — ตั้งค่าได้ครบทั้ง 5 code (อ่านจาก content_type จริง ไม่ hardcode)
  -- อ่านกลับมาตรงทุกตัว + T5 พ่วงในลูปเดียวกัน: updated_at ต้องขยับทุกครั้งที่
  -- เรียก (ดูคอมเมนต์ v_tx_now ด้านบนเรื่อง now() ระดับทรานแซกชัน) + M1: ห้าม
  -- PASS เพราะลูปไม่วน ต้องนับรอบจริง
  -- --------------------------------------------------------------------
  select now() into v_tx_now;

  for v_code in select code from analytics.content_type order by code loop
    v_loop_rounds := v_loop_rounds + 1;

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

  if v_loop_rounds >= 5 and not v_code_mismatch then
    v_log := v_log || format('T2 (ตั้งค่าครบทั้ง 5 code จาก content_type จริง อ่านกลับมาตรงทุกตัว, rounds=%s): PASS', v_loop_rounds) || E'\n';
  else
    v_log := v_log || format('T2: FAIL — rounds=%s (ต้อง >= 5) mismatch=%s', v_loop_rounds, v_code_mismatch) || E'\n';
  end if;

  if v_loop_rounds >= 5 and v_all_match_tx_now and v_tx_now is distinct from v_ts_baseline then
    v_log := v_log || format('T5 (updated_at ขยับทุกครั้งที่เรียก RPC — เทียบเท่า now() ทุกรอบ และต่างจากค่าประวัติศาสตร์เดิม, ไม่ได้ปิด trigger, rounds=%s): PASS', v_loop_rounds) || E'\n';
  else
    v_log := v_log || format('T5: FAIL — rounds=%s (ต้อง >= 5) all_match_tx_now=%s tx_now=%s baseline=%s', v_loop_rounds, v_all_match_tx_now, v_tx_now, v_ts_baseline) || E'\n';
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
  -- T_L1 (Tech Lead ชี้ขาด, 25 ก.ย. 69) — code ที่ is_active=false ต้องถูก
  -- ปฏิเสธ. ปิด is_active ของ code จริง 1 ตัวชั่วคราวในทรานแซกชันนี้ (rollback
  -- ท้ายสคริปต์อยู่แล้ว ไม่ทิ้งร่องรอยจริง — เหมือนแพตเทิร์น T_M8 ของ verify-0145)
  -- --------------------------------------------------------------------
  select code into v_l1_test_code from analytics.content_type where is_active order by code limit 1;

  if v_l1_test_code is null then
    v_log := v_log || 'T_L1: FAIL — ไม่มี content_type ที่ is_active=true เหลือให้ทดสอบ' || E'\n';
  else
    update analytics.content_type set is_active = false where code = v_l1_test_code;

    v_l1_reject_ok := false;
    begin
      perform analytics.campaign_step_set_content_type(v_real_shop_id, v_real_step_id, v_l1_test_code);
    exception when others then
      v_l1_reject_ok := true;
    end;

    select cs.content_type_code into v_l1_state_after from analytics.campaign_step cs where cs.id = v_real_step_id;

    -- คืนค่า is_active กลับก่อนเทียบผล (ไม่ให้ค้างเป็น false ระหว่างเทสต์ถัดไป
    -- ที่อาจอ่าน content_type — แม้ท้ายสคริปต์ rollback อยู่แล้วก็ตาม เป็นวินัย
    -- เดียวกับ 0145 T_M8 ที่ไม่ปล่อยให้ state ผิดค้างเกินจุดที่จำเป็น)
    update analytics.content_type set is_active = true where code = v_l1_test_code;

    if v_l1_reject_ok and v_l1_state_after is distinct from v_l1_test_code then
      v_log := v_log || format('T_L1 (code ''%s'' ที่ is_active=false ถูกปฏิเสธ, ไม่ถูกเขียนลง step): PASS', v_l1_test_code) || E'\n';
    else
      v_log := v_log || format('T_L1: FAIL — code=%s reject=%s state_after=%s', v_l1_test_code, v_l1_reject_ok, coalesce(v_l1_state_after, '(null)')) || E'\n';
    end if;
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
  -- 55 แถว 36 คอลัมน์ ชื่อ/ลำดับ/ชนิดเท่าเดิมเป๊ะ (M3) · แถวอื่นนอกเหนือ step
  -- เป้าหมายไม่โดน UPDATE ไปด้วย (M2, 3j-migration-traps #19)
  -- --------------------------------------------------------------------
  select count(*) into v_campaign_step_count from analytics.campaign_step;
  select count(*) into v_content_type_count from analytics.content_type;
  select count(*) into v_board_rows from analytics.v_campaign_board;

  -- M3 — md5 ของ ordinal:name:type ทั้ง 36 คอลัมน์ (ไม่ reuse ตัวแปร T1)
  select count(*) into v_board_col_total
  from information_schema.columns
  where table_schema = 'analytics' and table_name = 'v_campaign_board';

  select md5(string_agg(ordinal_position::text || ':' || column_name || ':' || data_type, ',' order by ordinal_position))
  into v_board_col_md5
  from information_schema.columns
  where table_schema = 'analytics' and table_name = 'v_campaign_board';

  -- M2 — แถวอื่น (54 แถว) ต้องไม่ขยับเลยตลอดการทดสอบทั้งหมดข้างบน
  select md5(string_agg(updated_at::text, '|' order by id)), count(distinct updated_at)
  into v_other_md5_after, v_other_distinct_after
  from analytics.campaign_step
  where id <> v_real_step_id;

  if v_campaign_step_count = 55
     and v_content_type_count = 5
     and v_board_rows = 55
     and v_board_col_total = 36
     and v_board_col_md5 = v_board_col_md5_expect
     and v_other_md5_after = v_other_md5_before
     and v_other_distinct_after = v_other_distinct_before then
    v_log := v_log || format(
      'T8 (ของเดิมไม่พัง: campaign_step=%s, content_type=%s, v_campaign_board=%s แถว/%s คอลัมน์ md5 ตรง, แถวอื่น 54 แถว updated_at ไม่ขยับ md5+distinct ตรง): PASS',
      v_campaign_step_count, v_content_type_count, v_board_rows, v_board_col_total) || E'\n';
  else
    v_log := v_log || format(
      'T8: FAIL — campaign_step=%s content_type=%s board_rows=%s board_col_total=%s board_col_md5=%s(คาด %s) other_md5_before=%s other_md5_after=%s other_distinct_before=%s other_distinct_after=%s',
      v_campaign_step_count, v_content_type_count, v_board_rows, v_board_col_total, v_board_col_md5, v_board_col_md5_expect,
      v_other_md5_before, v_other_md5_after, v_other_distinct_before, v_other_distinct_after) || E'\n';
  end if;

  raise exception '%', v_log;  -- บังคับ rollback ทั้งก้อน (3j-migration-traps #11) — DB ไม่ขยับจริง
end;
$verify0150$;
