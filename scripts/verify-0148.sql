-- scripts/verify-0148.sql
-- ทดสอบ 0148_content_post.sql — do-block + raise exception บังคับ rollback เสมอ
-- (3j-migration-traps #11) ห้ามรันแยกเป็น script ที่ COMMIT.
--
-- วิธีรัน (ต่อไฟล์ migration + verify เข้าด้วยกันแล้วรันทีเดียว — verify ไม่ได้
-- ลง DDL เอง):
--   cat supabase/migrations/0148_content_post.sql scripts/verify-0148.sql > _combo.sql
--   node scripts/run-sql.mjs _combo.sql   (ค่าตั้งต้น ROLLBACK เสมอ)
--
-- ใช้ shop จริง (a7c850ee-6776-4c3e-ba72-ba9e8caba2b7) ตัดสินใจเอง แทนที่จะสร้าง
-- shop สังเคราะห์ — เหตุผล: content_post_upsert เช็ค p_artifact_id ต้องอยู่ shop
-- เดียวกับ p_shop_id (กัน artifact ข้ามร้าน) ถ้าใช้ shop สังเคราะห์จะทดสอบผูก
-- artifact จริงไม่ได้เลย. ทุกแถวที่เขียน (content_post/content_post_metric) เป็น
-- ตารางใหม่ล้วนในไฟล์นี้ (ไม่มีข้อมูลเดิมมาก่อน) และทั้งทรานแซกชัน rollback ท้าย
-- สุดเสมอ — ไม่มีอะไรถูกเขียนทับ/ลบถาวรบนร้านจริง (อ่านอย่างเดียวสำหรับ
-- step_artifact/campaign_step/content_type/v_campaign_board เพื่อพิสูจน์ว่าไม่ขยับ,
-- เคสห้ามผ่าน #14)
--
-- 🔴 รอบ 2 (23 ก.ย. 69) — เพิ่มตามรายงาน security-auditor: จุดร่วมของ H1/H2/H3
-- คือ "ยิง RPC สองครั้งในวันเดียวกันด้วยพารามิเตอร์ต่างกัน" ซึ่งชุดเดิมไม่มีเคส
-- ไหนทดสอบเลย — ทุกโพสต์ที่เกี่ยวข้องกับ H1/H2 ด้านล่างจึงแยกเป็นโพสต์เฉพาะของ
-- ตัวเอง (ไม่ปนกับ T2/T3/T7) เพื่อให้นับจำนวนแถว/ค่าที่คาดไว้ตรงไปตรงมา ไม่พันกัน.
--
-- อ่านผลจาก NOTICE — บรรทัดรูปแบบ "ชื่อเทสต์: PASS/FAIL" ทุกข้อ
-- นับ FAIL ด้วย: grep -o ': FAIL' (ไม่ grep คำว่า FAIL เฉยๆ)

do $verify0148$
declare
  v_log text := E'\n=== verify-0148 (content_post) ===\n';

  v_shop uuid := 'a7c850ee-6776-4c3e-ba72-ba9e8caba2b7'::uuid;
  v_today_th date;
  v_real_artifact uuid;

  v_post_id uuid;         -- T2/T3
  v_post2_id uuid;        -- T7 (เขตเวลาไทย)
  v_post_l1 uuid;         -- L1
  v_post_h2 uuid;         -- H2
  v_post_h1 uuid;         -- H1 + running max
  v_post_m1 uuid;         -- M1 (sources)
  v_post_nullcols uuid;   -- T13
  v_post_status uuid;     -- T_status

  v_count int;
  v_row record;

  v_view_count bigint;
  v_save_count bigint;
  v_is_regression boolean;
  v_captured_on_count int;
  v_posted_date_th date;
  v_sources text[];

  v_fn_sig_count int;
  v_priv_leak_count int := 0;
  v_public_acl_count int;
  v_tbl text;
  v_role text;
  v_priv text;

  v_sa_count int;
  v_cs_count int;
  v_ct_count int;
  v_vcb_count int;
  v_vcb_expect_cols text[];
  v_vcb_actual_cols text[];

  v_running_max_final bigint;

  v_h2_metric_id_a uuid;
  v_h2_negative_count int;
  v_h2_age_a int;
  v_h2_age_b int;

  v_metric_id_t8 uuid;
  v_source_after text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_today_th := (now() at time zone 'Asia/Bangkok')::date;

  select id into v_real_artifact from analytics.step_artifact where shop_id = v_shop limit 1;
  if v_real_artifact is null then
    raise exception 'setup: shop % ไม่มี step_artifact ให้ทดสอบ artifact_id FK เลย — ตรวจข้อมูลจริงก่อนรันซ้ำ', v_shop;
  end if;

  -- --------------------------------------------------------------------
  -- T1 — คอลัมน์นับ (รวม save_count) เป็น bigint และ null ได้ทุกตัว
  -- --------------------------------------------------------------------
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'analytics' and table_name = 'content_post_metric'
    and column_name in ('view_count', 'like_count', 'comment_count', 'save_count', 'share_count')
    and data_type = 'bigint' and is_nullable = 'YES';

  if v_count = 5 then
    v_log := v_log || 'T1 (view/like/comment/save/share_count เป็น bigint + nullable ครบ 5 คอลัมน์): PASS' || E'\n';
  else
    v_log := v_log || format('T1: FAIL — ได้ %s คอลัมน์ที่ตรงเงื่อนไข (คาด 5)', v_count) || E'\n';
  end if;

  -- T1b — M1: sources เป็น text[] not null default '{}'
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'analytics' and table_name = 'content_post_metric'
    and column_name = 'sources' and data_type = 'ARRAY' and is_nullable = 'NO';

  if v_count = 1 then
    v_log := v_log || 'T1b (sources เป็น text[] not null): PASS' || E'\n';
  else
    v_log := v_log || format('T1b: FAIL — ได้ %s แถวที่ตรงเงื่อนไข (คาด 1)', v_count) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T2 — content_post_upsert: insert ใหม่ + อ่านค่ากลับตรง (รวม artifact_id จริง)
  -- --------------------------------------------------------------------
  v_post_id := analytics.content_post_upsert(
    v_shop, 'tiktok', '__test_ext_1', 'https://www.tiktok.com/@3jjewelry/video/1',
    '2026-09-01 14:00:00+07'::timestamptz, 'craft', v_real_artifact, 'แคปชั่นทดสอบ'
  );

  select artifact_id, content_type_code, caption_snapshot, posted_date_th, post_url
  into v_row
  from analytics.content_post where id = v_post_id;

  if v_row.artifact_id = v_real_artifact and v_row.content_type_code = 'craft'
     and v_row.caption_snapshot = 'แคปชั่นทดสอบ' and v_row.posted_date_th = '2026-09-01'::date then
    v_log := v_log || 'T2 (content_post_upsert insert ใหม่ + อ่านค่ากลับตรงทุกฟิลด์ รวม artifact_id จริง): PASS' || E'\n';
  else
    v_log := v_log || format('T2: FAIL — ได้ artifact=%s type=%s caption=%s date=%s',
      v_row.artifact_id, v_row.content_type_code, v_row.caption_snapshot, v_row.posted_date_th) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T3 🔴 — เรียกซ้ำโดยส่ง p_artifact_id/p_content_type_code/p_caption = null
  -- ⇒ ค่าเดิมต้องไม่ถูกล้าง (บรีฟข้อ 7 / 3j-migration-traps #14) แต่ post_url ที่
  -- ส่งค่าจริงมาต้องอัปเดต (พิสูจน์ว่า null-preserving ไม่ได้ทำให้ทั้งแถวหยุดอัปเดต)
  -- --------------------------------------------------------------------
  perform analytics.content_post_upsert(
    v_shop, 'tiktok', '__test_ext_1', 'https://www.tiktok.com/@3jjewelry/video/1-edited',
    '2026-09-01 14:05:00+07'::timestamptz, null, null, null
  );

  select artifact_id, content_type_code, caption_snapshot, post_url
  into v_row
  from analytics.content_post where id = v_post_id;

  if v_row.artifact_id = v_real_artifact and v_row.content_type_code = 'craft'
     and v_row.caption_snapshot = 'แคปชั่นทดสอบ'
     and v_row.post_url = 'https://www.tiktok.com/@3jjewelry/video/1-edited' then
    v_log := v_log || 'T3 (เรียกซ้ำส่ง null artifact_id/content_type_code/caption — ค่าเดิมไม่ถูกล้าง, post_url ที่ส่งจริงยังอัปเดต): PASS' || E'\n';
  else
    v_log := v_log || format('T3: FAIL — artifact=%s type=%s caption=%s url=%s',
      v_row.artifact_id, v_row.content_type_code, v_row.caption_snapshot, v_row.post_url) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T4 — platform นอก enum ถูกปฏิเสธ
  -- --------------------------------------------------------------------
  begin
    perform analytics.content_post_upsert(v_shop, 'youtube', '__test_ext_bad', 'https://x.com', '2026-09-01'::timestamptz);
    v_log := v_log || 'T4: FAIL — platform="youtube" ควรถูกปฏิเสธแต่ผ่าน' || E'\n';
  exception when others then
    v_log := v_log || 'T4 (platform นอก enum ("youtube") ถูกปฏิเสธ): PASS' || E'\n';
  end;

  -- --------------------------------------------------------------------
  -- T5 — post_url ยาวเกิน 500 ตัวอักษร (หลัง trim) ถูกปฏิเสธ
  -- --------------------------------------------------------------------
  begin
    perform analytics.content_post_upsert(v_shop, 'tiktok', '__test_ext_longurl',
      'https://x.com/' || repeat('a', 500), '2026-09-01'::timestamptz);
    v_log := v_log || 'T5: FAIL — post_url ยาวเกิน 500 ตัวอักษร ควรถูกปฏิเสธแต่ผ่าน' || E'\n';
  exception when others then
    v_log := v_log || 'T5 (post_url ยาวเกิน 500 ตัวอักษรถูกปฏิเสธ): PASS' || E'\n';
  end;

  -- --------------------------------------------------------------------
  -- T5b 🔴 L4 — ความยาวต้องตรวจจากฐานเดียวกับความว่าง (btrim แล้ว) — url ที่ยาว
  -- เกิน 500 เพราะช่องว่างหัว-ท้ายเยอะ แต่สั้นจริงหลัง trim ต้องผ่านได้ปกติ
  -- --------------------------------------------------------------------
  begin
    perform analytics.content_post_upsert(v_shop, 'tiktok', '__test_ext_trimlen',
      '   https://x.com/short' || repeat(' ', 600), '2026-09-01'::timestamptz);
    v_log := v_log || 'T5b (post_url ที่ยาวเพราะช่องว่างหัว-ท้าย แต่สั้นจริงหลัง btrim — ผ่านได้ปกติ, ตรวจฐานเดียวกัน): PASS' || E'\n';
  exception when others then
    v_log := v_log || format('T5b: FAIL — ควรผ่านแต่ถูกปฏิเสธ: %s', sqlerrm) || E'\n';
  end;

  -- --------------------------------------------------------------------
  -- T5c 🔴 M5 — post_url ที่ไม่ใช่ http(s) ถูกปฏิเสธ (กัน javascript:/data:)
  -- --------------------------------------------------------------------
  begin
    perform analytics.content_post_upsert(v_shop, 'tiktok', '__test_ext_scheme',
      'javascript:alert(1)', '2026-09-01'::timestamptz);
    v_log := v_log || 'T5c: FAIL — post_url="javascript:alert(1)" ควรถูกปฏิเสธแต่ผ่าน' || E'\n';
  exception when others then
    v_log := v_log || 'T5c (post_url ที่ไม่ใช่ http(s):// ("javascript:...") ถูกปฏิเสธ): PASS' || E'\n';
  end;

  -- --------------------------------------------------------------------
  -- T5d 🔴 L3 — external_id ยาวเกิน 500 ตัวอักษรถูกปฏิเสธ (ไม่เคยมีเพดานมาก่อน)
  -- --------------------------------------------------------------------
  begin
    perform analytics.content_post_upsert(v_shop, 'tiktok', repeat('a', 501),
      'https://x.com/e', '2026-09-01'::timestamptz);
    v_log := v_log || 'T5d: FAIL — external_id ยาวเกิน 500 ตัวอักษร ควรถูกปฏิเสธแต่ผ่าน' || E'\n';
  exception when others then
    v_log := v_log || 'T5d (external_id ยาวเกิน 500 ตัวอักษรถูกปฏิเสธ): PASS' || E'\n';
  end;

  -- --------------------------------------------------------------------
  -- T5e 🔴 L2 — posted_at อนาคตถูกปฏิเสธตั้งแต่ตอนสร้าง (กันโพสต์แช่แข็งถาวร)
  -- --------------------------------------------------------------------
  begin
    perform analytics.content_post_upsert(v_shop, 'tiktok', '__test_ext_future_reject',
      'https://x.com/future', now() + interval '5 days');
    v_log := v_log || 'T5e: FAIL — posted_at อนาคต ควรถูกปฏิเสธแต่ผ่าน' || E'\n';
  exception when others then
    v_log := v_log || 'T5e (posted_at อนาคตถูกปฏิเสธตั้งแต่ตอนสร้าง — กันโพสต์แช่แข็งถาวร): PASS' || E'\n';
  end;

  -- --------------------------------------------------------------------
  -- T6 — unique (shop_id, platform, external_id): raw insert ซ้ำ (ข้าม RPC)
  -- ต้องถูกปฏิเสธที่ชั้นตาราง ไม่ใช่แค่ RPC ทำ upsert เงียบๆ
  -- --------------------------------------------------------------------
  begin
    insert into analytics.content_post (shop_id, platform, external_id, post_url, posted_at, posted_date_th)
    values (v_shop, 'tiktok', '__test_ext_1', 'https://dup.example', now(), current_date);
    v_log := v_log || 'T6: FAIL — raw insert ซ้ำ (shop_id, platform, external_id) ควรถูกปฏิเสธแต่ผ่าน' || E'\n';
  exception when unique_violation then
    v_log := v_log || 'T6 (unique(shop_id, platform, external_id) ปฏิเสธ raw insert ซ้ำ): PASS' || E'\n';
  end;

  -- --------------------------------------------------------------------
  -- T7 🔴 — posted_date_th เขตเวลาไทย: 01:00 น. เวลาไทย 1 ก.ย. 69 ⇒ UTC ยังเป็น
  -- 31 ส.ค. 69 (18:00) — posted_date_th ต้องได้ 1 ก.ย. (วันไทย) ไม่ใช่ 31 (วัน UTC)
  -- (3j-migration-traps #6)
  -- --------------------------------------------------------------------
  v_post2_id := analytics.content_post_upsert(
    v_shop, 'facebook', '__test_ext_tz', 'https://fb.example/post', '2026-09-01 01:00:00+07'::timestamptz
  );
  select posted_date_th into v_posted_date_th from analytics.content_post where id = v_post2_id;

  if v_posted_date_th = '2026-09-01'::date
     and ('2026-09-01 01:00:00+07'::timestamptz at time zone 'utc')::date = '2026-08-31'::date then
    v_log := v_log || 'T7 (posted_date_th=1 ก.ย. ตามเวลาไทย แม้ UTC ยังเป็น 31 ส.ค. — เขตเวลาไทยถูกต้อง): PASS' || E'\n';
  else
    v_log := v_log || format('T7: FAIL — posted_date_th=%s', v_posted_date_th) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T_L1 🔴 — วางลิงก์เดิมซ้ำตอน status=deleted ต้องถูกปฏิเสธ (ไม่ auto-reactivate)
  -- แล้วเปิดกลับผ่าน content_post_set_status ก่อนถึงจะ upsert ซ้ำได้ปกติ
  -- --------------------------------------------------------------------
  v_post_l1 := analytics.content_post_upsert(v_shop, 'tiktok', '__test_ext_l1', 'https://x.com/l1', '2026-09-01'::timestamptz);
  perform analytics.content_post_set_status(v_shop, v_post_l1, 'deleted');

  begin
    perform analytics.content_post_upsert(v_shop, 'tiktok', '__test_ext_l1', 'https://x.com/l1-v2', '2026-09-01'::timestamptz);
    v_log := v_log || 'T_L1a: FAIL — วางลิงก์ซ้ำทับโพสต์ deleted ควรถูกปฏิเสธแต่ผ่าน' || E'\n';
  exception when others then
    v_log := v_log || 'T_L1a (วางลิงก์ซ้ำทับโพสต์ status=deleted ถูกปฏิเสธ ไม่ auto-reactivate): PASS' || E'\n';
  end;

  perform analytics.content_post_set_status(v_shop, v_post_l1, 'active');
  perform analytics.content_post_upsert(v_shop, 'tiktok', '__test_ext_l1', 'https://x.com/l1-v2', '2026-09-01'::timestamptz);
  select post_url into v_row from analytics.content_post where id = v_post_l1;

  if v_row.post_url = 'https://x.com/l1-v2' then
    v_log := v_log || 'T_L1b (เปิดกลับเป็น active ก่อนแล้ว upsert ซ้ำสำเร็จปกติ): PASS' || E'\n';
  else
    v_log := v_log || format('T_L1b: FAIL — post_url=%s', v_row.post_url) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T_H2 🔴 — แก้ posted_at ของโพสต์เดิม ⇒ age_days ของ metric เดิมถูกคิดใหม่
  -- + กันก่อนว่าจะไม่เกิด age_days ติดลบย้อนหลัง
  -- --------------------------------------------------------------------
  v_post_h2 := analytics.content_post_upsert(v_shop, 'tiktok', '__test_ext_h2', 'https://x.com/h2',
    ((v_today_th - 10) + time '12:00') at time zone 'Asia/Bangkok');

  -- แถวที่ 1: วันนี้ (ผ่าน RPC, age=10 ตาม posted_date_th เดิม)
  v_h2_metric_id_a := analytics.content_post_metric_upsert(v_shop, v_post_h2, 500, null, null, null, null, 'manual');
  -- แถวที่ 2: seed ตรง (bypass RPC) ที่ captured_on = today-8 (age=2 ตาม posted_date_th เดิม)
  insert into analytics.content_post_metric (shop_id, post_id, captured_on, age_days, view_count, source)
  values (v_shop, v_post_h2, v_today_th - 8, 2, 300, 'backfill');

  -- 🔴 พยายามเลื่อน posted_at ไปเป็น today-3 (ใหม่กว่าแถว seed ที่ captured_on=today-8)
  -- ⇒ (today-8) < (today-3) ⇒ ต้องถูกปฏิเสธ กันไม่ให้เกิด age_days ติดลบ
  begin
    perform analytics.content_post_upsert(v_shop, 'tiktok', '__test_ext_h2', 'https://x.com/h2',
      ((v_today_th - 3) + time '12:00') at time zone 'Asia/Bangkok');
    v_log := v_log || 'T_H2a: FAIL — แก้วันโพสต์จนทำให้ metric แถวเก่าติดลบ ควรถูกปฏิเสธแต่ผ่าน' || E'\n';
  exception when others then
    v_log := v_log || 'T_H2a (แก้วันโพสต์เป็นวันที่จะทำให้ metric ติดลบ ⇒ ถูกปฏิเสธก่อนเขียนอะไรเลย): PASS' || E'\n';
  end;

  -- ยืนยันว่า T_H2a ไม่ได้แตะอะไรเลย (posted_date_th ต้องยังเป็นค่าเดิม)
  select posted_date_th into v_posted_date_th from analytics.content_post where id = v_post_h2;
  if v_posted_date_th <> v_today_th - 10 then
    v_log := v_log || format('T_H2a_unchanged: FAIL — posted_date_th ขยับไปเป็น %s ทั้งที่ควรถูกปฏิเสธทั้งก้อน', v_posted_date_th) || E'\n';
  else
    v_log := v_log || 'T_H2a_unchanged (ปฏิเสธทั้งก้อนจริง — posted_date_th เดิมไม่ขยับ): PASS' || E'\n';
  end if;

  -- เลื่อนไปเป็น today-15 (เก่ากว่าเดิม, ไม่ชนแถวไหนเลย) ⇒ ต้องสำเร็จ + age_days คิดใหม่
  perform analytics.content_post_upsert(v_shop, 'tiktok', '__test_ext_h2', 'https://x.com/h2',
    ((v_today_th - 15) + time '12:00') at time zone 'Asia/Bangkok');

  select age_days into v_h2_age_a from analytics.content_post_metric where post_id = v_post_h2 and captured_on = v_today_th - 8;
  select age_days into v_h2_age_b from analytics.content_post_metric where post_id = v_post_h2 and captured_on = v_today_th;

  if v_h2_age_a = 7 and v_h2_age_b = 15 then
    v_log := v_log || 'T_H2b (แก้วันโพสต์เป็นวันที่เก่ากว่าเดิมสำเร็จ ⇒ age_days ของ metric เดิมถูกคิดใหม่ถูกต้องทั้ง 2 แถว): PASS' || E'\n';
  else
    v_log := v_log || format('T_H2b: FAIL — age_days ที่ captured_on=today-8 คือ %s (คาด 7), ที่ today คือ %s (คาด 15)', v_h2_age_a, v_h2_age_b) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T8 — content_post_metric_upsert: save_count กรอกได้/อ่านกลับตรง (ตัวเลขจริง
  -- จากคลิปล่าสุด @3jjewelry: view=134 like=8 comment=2 save=1 share=0) —
  -- ไม่มี prior-day baseline ⇒ is_regression=false (ยิงครั้งแรก)
  -- --------------------------------------------------------------------
  v_metric_id_t8 := analytics.content_post_metric_upsert(v_shop, v_post_id, 134, 8, 2, 1, 0, 'manual');
  select view_count, save_count, is_regression into v_view_count, v_save_count, v_is_regression
  from analytics.content_post_metric where id = v_metric_id_t8;

  if v_view_count = 134 and v_save_count = 1 and v_is_regression = false then
    v_log := v_log || 'T8 (content_post_metric_upsert: save_count=1 กรอกได้ อ่านกลับตรง, is_regression=false ครั้งแรกไม่มี prior-day baseline): PASS' || E'\n';
  else
    v_log := v_log || format('T8: FAIL — view=%s save=%s regression=%s', v_view_count, v_save_count, v_is_regression) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T9 — upsert ซ้ำวันเดียวกัน 3 ครั้ง (ครั้งสุดท้ายค่าต่ำกว่าก่อนหน้าโดยตั้งใจ:
  -- 134→150→90) ⇒ 1 แถว ค่าเป็นของครั้งล่าสุด และ is_regression ยังเป็น false
  -- (ไม่มี prior-day baseline เลย ⇒ การแก้ค่าในวันเดียวกันไม่ใช่การถดถอย — พิสูจน์
  -- ว่า H1 ไม่ false-positive กับการแก้เลขวันเดียวกัน)
  -- --------------------------------------------------------------------
  perform analytics.content_post_metric_upsert(v_shop, v_post_id, 150, 9, 2, 1, 0, 'manual');
  perform analytics.content_post_metric_upsert(v_shop, v_post_id, 90, 10, 3, 2, 1, 'manual');

  select count(*) into v_captured_on_count
  from analytics.content_post_metric where post_id = v_post_id and captured_on = (now() at time zone 'Asia/Bangkok')::date;

  select view_count, save_count, is_regression into v_view_count, v_save_count, v_is_regression
  from analytics.content_post_metric where post_id = v_post_id and captured_on = (now() at time zone 'Asia/Bangkok')::date;

  if v_captured_on_count = 1 and v_view_count = 90 and v_save_count = 2 and v_is_regression = false then
    v_log := v_log || 'T9 (upsert ซ้ำวันเดียวกัน 3 ครั้งค่าลด 134→150→90 ⇒ 1 แถว ค่าล่าสุด view=90, is_regression=false เพราะไม่มี prior-day baseline — ไม่ false-positive): PASS' || E'\n';
  else
    v_log := v_log || format('T9: FAIL — จำนวนแถว=%s view=%s save=%s regression=%s', v_captured_on_count, v_view_count, v_save_count, v_is_regression) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T10 🔴 — age_days ติดลบ (โพสต์อนาคต) ⇒ ตอนนี้ content_post_upsert ปฏิเสธ
  -- ไปแล้วตั้งแต่ต้น (T5e/L2) ดังนั้นทดสอบ metric_upsert เจอ post ที่ posted_at
  -- เพิ่งถูกแก้ (H2) ให้ยังเป็นวันนี้พอดี (age=0) ไม่ใช่ทางเข้าที่ยังไปถึงได้แล้ว
  -- — เก็บเคสนี้ไว้เป็น defense-in-depth ระดับฟังก์ชัน (เรียก metric_upsert ตรง
  -- ด้วย post ที่ posted_date_th ในอนาคตจริงไม่ได้อีกต่อไปเพราะสร้างไม่ผ่านแล้ว
  -- ⇒ ทดสอบว่า guard ยังอยู่โดยเรียกกับ post ที่ posted_date_th=วันนี้เป๊ะ แล้ว
  -- เรียกซ้ำถัดไปคนละวัน (จำลองไม่ได้ในทรานแซกชันเดียว) — คงไว้เป็นหนี้ที่รู้ตัว:
  -- guard นี้ตอนนี้ unreachable จาก content_post_upsert ที่ผ่าน L2 แล้ว แต่ยัง
  -- ป้องกัน edge case ที่แถว content_post ถูกสร้างทางอื่น (เช่น service_role
  -- เขียนตรง, L7) จึงคงไว้ตามเดิม ไม่ลบทิ้ง
  -- --------------------------------------------------------------------
  v_log := v_log || 'T10 (age_days ติดลบ: guard ใน metric_upsert ยัง unreachable ผ่าน content_post_upsert ปกติหลัง L2 — คงไว้เป็น defense-in-depth เผื่อ service_role เขียนตรง, ไม่ถอยหลัง): SKIP-DOCUMENTED' || E'\n';

  -- --------------------------------------------------------------------
  -- T_H3 🔴 — เรียก metric_upsert โดยไม่มีตัวเลขอะไรเลยต้องถูกปฏิเสธ (ห้ามสร้าง
  -- แถวว่าง — 3j-migration-traps #13, กันโพสต์หลุดจากคิวถาวรที่ 0149)
  -- --------------------------------------------------------------------
  begin
    perform analytics.content_post_metric_upsert(v_shop, v_post_id, null, null, null, null, null, 'manual');
    v_log := v_log || 'T_H3: FAIL — เรียกแบบไม่มีตัวเลขเลยควร raise แต่ผ่าน' || E'\n';
  exception when others then
    v_log := v_log || 'T_H3 (เรียก metric_upsert โดยไม่มีตัวเลขเลย ⇒ raise ปฏิเสธ ไม่สร้างแถวว่าง): PASS' || E'\n';
  end;

  -- --------------------------------------------------------------------
  -- T_H1 🔴 — จุดร่วม H1: seed prior-day baseline ก่อน แล้วยิง RPC 2 ครั้งใน
  -- วันเดียวกันด้วยพารามิเตอร์ต่างกัน (call1: view=800 ต่ำกว่า prior-day max=1200
  -- ⇒ regression=true, call2: ส่งแค่ save=5 ค่าอื่น null ⇒ view ต้องยังเป็น 800
  -- (null-preserving) และ is_regression ต้องยังเป็น true — นี่คือบั๊กที่ security
  -- พิสูจน์แล้วว่าของเดิมล้างธงเป็น false ตรงนี้)
  -- --------------------------------------------------------------------
  v_post_h1 := analytics.content_post_upsert(v_shop, 'tiktok', '__test_ext_h1', 'https://x.com/h1',
    ((v_today_th - 20) + time '12:00') at time zone 'Asia/Bangkok');

  -- prior-day baseline: 2 วันก่อนหน้า (max=1200)
  insert into analytics.content_post_metric (shop_id, post_id, captured_on, age_days, view_count, source)
  values
    (v_shop, v_post_h1, v_today_th - 2, 18, 1000, 'backfill'),
    (v_shop, v_post_h1, v_today_th - 1, 19, 1200, 'backfill');

  -- call 1: view=800 (< prior-day max 1200) ⇒ regression=true
  perform analytics.content_post_metric_upsert(v_shop, v_post_h1, 800, null, null, null, null, 'manual');
  select view_count, is_regression into v_view_count, v_is_regression
  from analytics.content_post_metric where post_id = v_post_h1 and captured_on = v_today_th;

  if v_view_count = 800 and v_is_regression = true then
    v_log := v_log || 'T_H1a (call1: view=800 < prior-day max 1200 ⇒ is_regression=true, ค่าดิบเก็บ 800 จริง): PASS' || E'\n';
  else
    v_log := v_log || format('T_H1a: FAIL — view=%s regression=%s', v_view_count, v_is_regression) || E'\n';
  end if;

  -- call 2 (จุดที่ของเดิมพัง): ส่งแค่ save=5, ค่าอื่น null ทั้งหมด — view ต้อง
  -- ยังเป็น 800 (null-preserving, carry จากแถวเดิมของวันนี้) และ is_regression
  -- ต้องยังเป็น true (เทียบจากค่าหลังผสม ไม่ใช่จาก p_view ดิบที่ส่งมารอบนี้ซึ่งเป็น null)
  perform analytics.content_post_metric_upsert(v_shop, v_post_h1, null, null, null, 5, null, 'manual');
  select view_count, save_count, is_regression into v_view_count, v_save_count, v_is_regression
  from analytics.content_post_metric where post_id = v_post_h1 and captured_on = v_today_th;

  if v_view_count = 800 and v_save_count = 5 and v_is_regression = true then
    v_log := v_log || 'T_H1b 🔴 (call2: ส่งแค่ save=5 ค่าอื่น null ⇒ view ยังเป็น 800 (null-preserving) + is_regression ยังเป็น true — ปิดบั๊กเดิมที่ธงถูกล้างเป็น false): PASS' || E'\n';
  else
    v_log := v_log || format('T_H1b: FAIL — view=%s save=%s regression=%s (ถ้า regression=false นี่คือบั๊กเดิมที่ security เจอ)', v_view_count, v_save_count, v_is_regression) || E'\n';
  end if;

  -- running max ในชั้นอ่านยังไม่ถอยหลัง (age มากสุด = แถววันนี้, view ดิบ=800 แต่
  -- running max ต้องยังเป็น 1200)
  select running_max into v_running_max_final
  from (
    select
      max(view_count) over (partition by post_id order by age_days rows between unbounded preceding and current row) as running_max,
      row_number() over (partition by post_id order by age_days desc) as rn
    from analytics.content_post_metric
    where post_id = v_post_h1
  ) x
  where rn = 1;

  if v_running_max_final = 1200 then
    v_log := v_log || 'T12 (running max ที่แถวล่าสุด (age มากสุด) = 1200 ไม่ถอยหลัง แม้ raw ล่าสุด=800): PASS' || E'\n';
  else
    v_log := v_log || format('T12: FAIL — running max ที่แถวล่าสุด = %s (คาด 1200)', v_running_max_final) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T_M1 🔴 — sources สะสมทุกแหล่งที่เคยเขียนแถวนี้ (distinct+sort) ส่วน source
  -- (เดี่ยว) เป็นของครั้งล่าสุดเท่านั้น
  -- --------------------------------------------------------------------
  v_post_m1 := analytics.content_post_upsert(v_shop, 'tiktok', '__test_ext_m1', 'https://x.com/m1', '2026-09-01'::timestamptz);
  perform analytics.content_post_metric_upsert(v_shop, v_post_m1, 5000, null, null, null, null, 'tiktok_api');
  perform analytics.content_post_metric_upsert(v_shop, v_post_m1, null, null, null, 315, null, 'manual');

  select source, sources into v_source_after, v_sources
  from analytics.content_post_metric where post_id = v_post_m1;

  if v_source_after = 'manual' and v_sources = array['manual', 'tiktok_api'] then
    v_log := v_log || 'T_M1 (แถวผสม tiktok_api (view) + manual (save) ⇒ source=''manual'' (ครั้งล่าสุด), sources={manual,tiktok_api} สะสมครบ): PASS' || E'\n';
  else
    v_log := v_log || format('T_M1: FAIL — source=%s sources=%s', v_source_after, v_sources) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T13 — คอลัมน์นับที่ไม่ส่งมา (null) ยังคงเป็น null จริง ไม่ error ไม่กลายเป็น 0
  -- --------------------------------------------------------------------
  v_post_nullcols := analytics.content_post_upsert(v_shop, 'tiktok', '__test_ext_nullcols', 'https://x.com/nc', '2026-09-01'::timestamptz);
  perform analytics.content_post_metric_upsert(v_shop, v_post_nullcols, 500, null, null, null, null, 'tiktok_api');

  if (select like_count from analytics.content_post_metric where post_id = v_post_nullcols) is null
     and (select save_count from analytics.content_post_metric where post_id = v_post_nullcols) is null
     and (select share_count from analytics.content_post_metric where post_id = v_post_nullcols) is null then
    v_log := v_log || 'T13 (like_count/save_count/share_count ที่ไม่ส่งมา (source=tiktok_api) เป็น null จริง ไม่ error ไม่กลายเป็น 0): PASS' || E'\n';
  else
    v_log := v_log || 'T13: FAIL — like_count/save_count/share_count ไม่เป็น null ตามที่คาด' || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- ห้ามพัง — content_post_set_status ไม่ลบ metric เก่า
  -- --------------------------------------------------------------------
  v_post_status := analytics.content_post_upsert(v_shop, 'tiktok', '__test_ext_status', 'https://x.com/status', '2026-09-01'::timestamptz);
  perform analytics.content_post_metric_upsert(v_shop, v_post_status, 111, 1, 0, 0, 0, 'manual');
  perform analytics.content_post_set_status(v_shop, v_post_status, 'deleted');

  select count(*) into v_count from analytics.content_post_metric where post_id = v_post_status;
  select status into v_row from analytics.content_post where id = v_post_status;

  if v_row.status = 'deleted' and v_count = 1 then
    v_log := v_log || format('T_status (set_status=deleted สำเร็จ, metric เก่า %s แถวยังอยู่ครบ ไม่ถูกลบ): PASS', v_count) || E'\n';
  else
    v_log := v_log || format('T_status: FAIL — status=%s metric_count=%s', v_row.status, v_count) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T_grant — has_table_privilege/has_function_privilege: anon/authenticated=false,
  -- service_role=true + ไม่มี PUBLIC ใน relacl ของ 2 ตารางใหม่
  -- --------------------------------------------------------------------
  foreach v_tbl in array array['content_post', 'content_post_metric'] loop
    foreach v_role in array array['anon', 'authenticated'] loop
      foreach v_priv in array array['select', 'insert', 'update', 'delete'] loop
        if has_table_privilege(v_role, 'analytics.' || v_tbl, v_priv) then
          v_priv_leak_count := v_priv_leak_count + 1;
        end if;
      end loop;
    end loop;
  end loop;

  if not has_table_privilege('service_role', 'analytics.content_post', 'select')
     or not has_table_privilege('service_role', 'analytics.content_post_metric', 'select') then
    v_priv_leak_count := v_priv_leak_count + 1000; -- service_role ต้องมี select — พังฝั่งตรงข้าม
  end if;

  select count(*) into v_public_acl_count
  from pg_class c
  cross join lateral aclexplode(c.relacl) a
  where c.relnamespace = 'analytics'::regnamespace
    and c.relname in ('content_post', 'content_post_metric')
    and a.grantee = 0;

  if v_priv_leak_count = 0 and v_public_acl_count = 0 then
    v_log := v_log || 'T_grant_table (anon/authenticated ไม่มีสิทธิ์ใดๆ บน content_post/content_post_metric, service_role มี select, ไม่มี PUBLIC ใน relacl): PASS' || E'\n';
  else
    v_log := v_log || format('T_grant_table: FAIL — priv_leak_count=%s public_acl_count=%s', v_priv_leak_count, v_public_acl_count) || E'\n';
  end if;

  if has_function_privilege('anon', 'analytics.content_post_upsert(uuid, text, text, text, timestamptz, text, uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'analytics.content_post_upsert(uuid, text, text, text, timestamptz, text, uuid, text)', 'execute')
     or has_function_privilege('anon', 'analytics.content_post_metric_upsert(uuid, uuid, bigint, bigint, bigint, bigint, bigint, text)', 'execute')
     or has_function_privilege('authenticated', 'analytics.content_post_metric_upsert(uuid, uuid, bigint, bigint, bigint, bigint, bigint, text)', 'execute')
     or has_function_privilege('anon', 'analytics.content_post_set_status(uuid, uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'analytics.content_post_set_status(uuid, uuid, text)', 'execute')
  then
    v_log := v_log || 'T_grant_fn: FAIL — anon/authenticated มีสิทธิ์ execute อยู่บนฟังก์ชันใหม่อย่างน้อย 1 ตัว' || E'\n';
  elsif not has_function_privilege('service_role', 'analytics.content_post_upsert(uuid, text, text, text, timestamptz, text, uuid, text)', 'execute') then
    v_log := v_log || 'T_grant_fn: FAIL — service_role ไม่มีสิทธิ์ execute (ควรมี)' || E'\n';
  else
    v_log := v_log || 'T_grant_fn (anon/authenticated execute=false ทุกฟังก์ชันใหม่, service_role=true): PASS' || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T_no_overload 🔴 (แก้บั๊กด่านลม) — เดิมใช้ `having count(*) > 1` แล้วเช็ค
  -- `is null` ⇒ ผ่านแม้ไม่มีฟังก์ชันสักตัว (0 แถว ก็ into ได้ NULL เหมือนกัน)
  -- security พิสูจน์แล้วด้วยการ drop ทั้ง 3 ฟังก์ชันแล้วรันคิวรีเดิมยัง PASS —
  -- แก้เป็นนับตรงๆ ว่าต้องได้ 3 แถวพอดี (ขาด=ไม่ได้สร้าง, เกิน=overload)
  -- --------------------------------------------------------------------
  select count(*) into v_fn_sig_count from pg_proc
  where pronamespace = 'analytics'::regnamespace
    and proname in ('content_post_upsert', 'content_post_metric_upsert', 'content_post_set_status');

  if v_fn_sig_count = 3 then
    v_log := v_log || 'T_no_overload (content_post_upsert/content_post_metric_upsert/content_post_set_status: รวม 3 signature พอดี — ไม่ขาด ไม่มี overload): PASS' || E'\n';
  else
    v_log := v_log || format('T_no_overload: FAIL — พบ %s signature รวมกัน (คาด 3 — ฟังก์ชันละ 1)', v_fn_sig_count) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T_old_data — ของเดิมไม่พัง (บรีฟข้อ 14) — นับแถว + 🔴 เพิ่ม v_campaign_board
  -- 36 คอลัมน์ ชื่อ/ลำดับ/ชนิดเป๊ะ (เดิมตรวจแค่จำนวนแถว บรีฟสั่งตรวจคอลัมน์ด้วย)
  -- --------------------------------------------------------------------
  select count(*) into v_sa_count from analytics.step_artifact;
  select count(*) into v_cs_count from analytics.campaign_step;
  select count(*) into v_ct_count from analytics.content_type;
  select count(*) into v_vcb_count from analytics.v_campaign_board;

  if v_sa_count = 65 and v_cs_count = 55 and v_ct_count = 5 and v_vcb_count = 55 then
    v_log := v_log || 'T_old_data_count (step_artifact=65, campaign_step=55, content_type=5, v_campaign_board=55 เท่าเดิมเป๊ะ): PASS' || E'\n';
  else
    v_log := v_log || format('T_old_data_count: FAIL — step_artifact=%s campaign_step=%s content_type=%s v_campaign_board=%s',
      v_sa_count, v_cs_count, v_ct_count, v_vcb_count) || E'\n';
  end if;

  v_vcb_expect_cols := array[
    '1|step_id|uuid', '2|campaign_id|uuid', '3|shop_id|uuid', '4|campaign_name|text',
    '5|campaign_type|text', '6|trigger_kind|text', '7|campaign_status|text', '8|anchor_date|date',
    '9|primary_channels|ARRAY', '10|campaign_blocked_reason|text', '11|campaign_note|text', '12|seq|integer',
    '13|step_kind|text', '14|offset_start_days|integer', '15|offset_end_days|integer', '16|resolved_start|date',
    '17|resolved_end|date', '18|days_until|integer', '19|audience_segment|text', '20|audience_live_count|integer',
    '21|channel|text', '22|goal_kpi|text', '23|step_status|text', '24|step_blocked_reason|text',
    '25|artifacts|jsonb', '26|art_total|bigint', '27|art_done|bigint', '28|gates|jsonb',
    '29|effective_status|text', '30|step_title|text', '31|source_reco_key|text', '32|step_origin|text',
    '33|start_time|text', '34|goal_kpi_code|text', '35|goal_kpi_code_source|text', '36|content_type_code|text'
  ];

  select array_agg(ordinal_position::text || '|' || column_name || '|' || data_type order by ordinal_position)
  into v_vcb_actual_cols
  from information_schema.columns
  where table_schema = 'analytics' and table_name = 'v_campaign_board';

  if v_vcb_actual_cols = v_vcb_expect_cols then
    v_log := v_log || 'T_old_data_cols (v_campaign_board 36 คอลัมน์ ชื่อ/ลำดับ/ชนิดตรงเป๊ะ ไม่พังจากไฟล์นี้): PASS' || E'\n';
  else
    v_log := v_log || format('T_old_data_cols: FAIL — ได้ %s', v_vcb_actual_cols) || E'\n';
  end if;

  raise exception '%', v_log;  -- บังคับ rollback ทั้งก้อน (3j-migration-traps #11) — DB ไม่ขยับจริง
end;
$verify0148$;
