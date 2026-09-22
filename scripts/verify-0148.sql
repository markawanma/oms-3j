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
-- อ่านผลจาก NOTICE — บรรทัดรูปแบบ "ชื่อเทสต์: PASS/FAIL" ทุกข้อ
-- นับ FAIL ด้วย: grep -o ': FAIL' (ไม่ grep คำว่า FAIL เฉยๆ)

do $verify0148$
declare
  v_log text := E'\n=== verify-0148 (content_post) ===\n';

  v_shop uuid := 'a7c850ee-6776-4c3e-ba72-ba9e8caba2b7'::uuid;
  v_real_artifact uuid;
  v_post_id uuid;
  v_post2_id uuid;
  v_future_post uuid;
  v_metric_id uuid;

  v_count int;
  v_row record;

  v_view_count bigint;
  v_save_count bigint;
  v_is_regression boolean;
  v_captured_on_count int;
  v_posted_date_th date;

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

  v_running_max_final bigint;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

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

  -- --------------------------------------------------------------------
  -- T2 — content_post_upsert: insert ใหม่ + อ่านค่ากลับตรง (รวม artifact_id จริง)
  -- --------------------------------------------------------------------
  v_post_id := analytics.content_post_upsert(
    v_shop, 'tiktok', '__test_ext_1', 'https://www.tiktok.com/@3jjewelry/video/1',
    '2026-09-20 14:00:00+07'::timestamptz, 'craft', v_real_artifact, 'แคปชั่นทดสอบ'
  );

  select artifact_id, content_type_code, caption_snapshot, posted_date_th, post_url
  into v_row
  from analytics.content_post where id = v_post_id;

  if v_row.artifact_id = v_real_artifact and v_row.content_type_code = 'craft'
     and v_row.caption_snapshot = 'แคปชั่นทดสอบ' and v_row.posted_date_th = '2026-09-20'::date then
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
    '2026-09-20 14:05:00+07'::timestamptz, null, null, null
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
    perform analytics.content_post_upsert(v_shop, 'youtube', '__test_ext_bad', 'https://x.com', now());
    v_log := v_log || 'T4: FAIL — platform="youtube" ควรถูกปฏิเสธแต่ผ่าน' || E'\n';
  exception when others then
    v_log := v_log || 'T4 (platform นอก enum ("youtube") ถูกปฏิเสธ): PASS' || E'\n';
  end;

  -- --------------------------------------------------------------------
  -- T5 — post_url ยาวเกิน 500 ตัวอักษรถูกปฏิเสธ
  -- --------------------------------------------------------------------
  begin
    perform analytics.content_post_upsert(v_shop, 'tiktok', '__test_ext_longurl',
      'https://x.com/' || repeat('a', 500), now());
    v_log := v_log || 'T5: FAIL — post_url ยาวเกิน 500 ตัวอักษร ควรถูกปฏิเสธแต่ผ่าน' || E'\n';
  exception when others then
    v_log := v_log || 'T5 (post_url ยาวเกิน 500 ตัวอักษรถูกปฏิเสธ): PASS' || E'\n';
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
  -- T7 🔴 — posted_date_th เขตเวลาไทย: 01:00 น. เวลาไทย 20 ก.ย. 69 ⇒ UTC ยังเป็น
  -- 19 ก.ย. 69 (18:00) — posted_date_th ต้องได้ 20 ก.ย. (วันไทย) ไม่ใช่ 19 (วัน UTC)
  -- (3j-migration-traps #6)
  -- --------------------------------------------------------------------
  v_post2_id := analytics.content_post_upsert(
    v_shop, 'facebook', '__test_ext_tz', 'https://fb.example/post', '2026-09-20 01:00:00+07'::timestamptz
  );
  select posted_date_th into v_posted_date_th from analytics.content_post where id = v_post2_id;

  if v_posted_date_th = '2026-09-20'::date
     and ('2026-09-20 01:00:00+07'::timestamptz at time zone 'utc')::date = '2026-09-19'::date then
    v_log := v_log || 'T7 (posted_date_th=20 ก.ย. ตามเวลาไทย แม้ UTC ยังเป็น 19 ก.ย. — เขตเวลาไทยถูกต้อง): PASS' || E'\n';
  else
    v_log := v_log || format('T7: FAIL — posted_date_th=%s', v_posted_date_th) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T8 — content_post_metric_upsert: save_count กรอกได้/อ่านกลับตรง (ตัวเลขจริง
  -- จากคลิปล่าสุด @3jjewelry: view=134 like=8 comment=2 save=1 share=0)
  -- ใช้โพสต์ T2 (posted_date_th=20 ก.ย. 69, อดีตแน่นอน ⇒ age_days >= 0)
  -- --------------------------------------------------------------------
  v_metric_id := analytics.content_post_metric_upsert(v_shop, v_post_id, 134, 8, 2, 1, 0, 'manual');

  select view_count, save_count, is_regression into v_view_count, v_save_count, v_is_regression
  from analytics.content_post_metric where id = v_metric_id;

  if v_view_count = 134 and v_save_count = 1 and v_is_regression = false then
    v_log := v_log || 'T8 (content_post_metric_upsert: save_count=1 กรอกได้ อ่านกลับตรง, is_regression=false รอบแรก): PASS' || E'\n';
  else
    v_log := v_log || format('T8: FAIL — view=%s save=%s regression=%s', v_view_count, v_save_count, v_is_regression) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T9 — upsert ซ้ำวันเดียวกัน 3 ครั้ง ⇒ 1 แถว ค่าเป็นของครั้งล่าสุด
  -- --------------------------------------------------------------------
  perform analytics.content_post_metric_upsert(v_shop, v_post_id, 150, 9, 2, 1, 0, 'manual');
  perform analytics.content_post_metric_upsert(v_shop, v_post_id, 200, 10, 3, 2, 1, 'manual');

  select count(*) into v_captured_on_count
  from analytics.content_post_metric where post_id = v_post_id and captured_on = (now() at time zone 'Asia/Bangkok')::date;

  select view_count, save_count into v_view_count, v_save_count
  from analytics.content_post_metric where post_id = v_post_id and captured_on = (now() at time zone 'Asia/Bangkok')::date;

  if v_captured_on_count = 1 and v_view_count = 200 and v_save_count = 2 then
    v_log := v_log || 'T9 (upsert ซ้ำวันเดียวกัน 3 ครั้ง ⇒ 1 แถว, ค่าเป็นของครั้งล่าสุด view=200/save=2): PASS' || E'\n';
  else
    v_log := v_log || format('T9: FAIL — จำนวนแถว=%s view=%s save=%s', v_captured_on_count, v_view_count, v_save_count) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T10 🔴 — age_days ติดลบ (โพสต์อนาคต) ⇒ raise ไม่ใช่เก็บ (บรีฟข้อ 6)
  -- --------------------------------------------------------------------
  v_future_post := analytics.content_post_upsert(
    v_shop, 'instagram', '__test_ext_future', 'https://ig.example/future',
    (now() at time zone 'Asia/Bangkok') + interval '5 days'
  );
  begin
    perform analytics.content_post_metric_upsert(v_shop, v_future_post, 10, 1, 0, 0, 0, 'manual');
    v_log := v_log || 'T10: FAIL — โพสต์อนาคต (age_days ติดลบ) ควร raise แต่ผ่าน' || E'\n';
  exception when others then
    v_log := v_log || 'T10 (โพสต์อนาคต ⇒ age_days ติดลบ ⇒ content_post_metric_upsert raise exception): PASS' || E'\n';
  end;

  -- --------------------------------------------------------------------
  -- T11 🔴 — ส่งค่าต่ำกว่าเดิม (วันเดียวกัน) ⇒ เก็บค่าดิบตามที่ส่ง + is_regression=true
  -- (ต่อจาก T9: view สูงสุดวันนี้ก่อนหน้า=200 → ส่ง 120 ต้องเก็บ 120 จริง + flag true)
  -- --------------------------------------------------------------------
  perform analytics.content_post_metric_upsert(v_shop, v_post_id, 120, 5, 1, 0, 0, 'manual');

  select view_count, is_regression into v_view_count, v_is_regression
  from analytics.content_post_metric where post_id = v_post_id and captured_on = (now() at time zone 'Asia/Bangkok')::date;

  if v_view_count = 120 and v_is_regression = true then
    v_log := v_log || 'T11 (ส่งค่าต่ำกว่าค่าสูงสุดก่อนหน้า ⇒ เก็บค่าดิบ 120 ตามที่ส่งจริง (ไม่ clamp) + is_regression=true): PASS' || E'\n';
  else
    v_log := v_log || format('T11: FAIL — view=%s regression=%s', v_view_count, v_is_regression) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T12 🔴 — running max ในชั้นอ่านไม่ถอยหลัง แม้มีแถว regression จริงในข้อมูลดิบ
  -- (seed ประวัติข้ามวันตรงๆ ผ่าน insert เพื่อจำลอง age_days ที่ RPC ทำเองไม่ได้
  -- เพราะ RPC ผูกกับ "วันนี้" เสมอ — แทรกที่ age_days อื่นของโพสต์เดียวกับ T8-T11)
  -- --------------------------------------------------------------------
  insert into analytics.content_post_metric (shop_id, post_id, captured_on, age_days, view_count, source)
  values
    (v_shop, v_post_id, (now() at time zone 'Asia/Bangkok')::date - 2,
     ((now() at time zone 'Asia/Bangkok')::date - 2) - '2026-09-20'::date, 1000, 'backfill'),
    (v_shop, v_post_id, (now() at time zone 'Asia/Bangkok')::date - 1,
     ((now() at time zone 'Asia/Bangkok')::date - 1) - '2026-09-20'::date, 1200, 'backfill');

  -- running max ตามสูตรที่บรีฟให้ (คอมเมนต์ content_post_metric.is_regression, 0148):
  -- ordered by age_days, ต้องไม่ถอยหลังแม้แถวล่าสุด (T11, view=120) ต่ำกว่า 1200 มาก —
  -- อ่าน running_max ของแถวที่ age_days มากที่สุด (rn=1 จาก row_number order by age_days desc)
  select running_max into v_running_max_final
  from (
    select
      max(view_count) over (partition by post_id order by age_days rows between unbounded preceding and current row) as running_max,
      row_number() over (partition by post_id order by age_days desc) as rn
    from analytics.content_post_metric
    where post_id = v_post_id
  ) x
  where rn = 1;

  if v_running_max_final = 1200 then
    v_log := v_log || 'T12 (running max ที่แถวล่าสุด (age มากสุด) = 1200 ไม่ถอยหลัง แม้ raw ล่าสุด=120): PASS' || E'\n';
  else
    v_log := v_log || format('T12: FAIL — running max ที่แถวล่าสุด = %s (คาด 1200)', v_running_max_final) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T13 — คอลัมน์นับที่ไม่ส่งมา (null) ยังคงเป็น null จริง ไม่ error ไม่กลายเป็น 0
  -- (โพสต์ T7/tz ยังไม่เคยมี metric มาก่อน ⇒ insert แรกที่บาง field เป็น null)
  -- --------------------------------------------------------------------
  perform analytics.content_post_metric_upsert(v_shop, v_post2_id, 500, null, null, null, null, 'tiktok_api');

  if (select like_count from analytics.content_post_metric where post_id = v_post2_id) is null
     and (select save_count from analytics.content_post_metric where post_id = v_post2_id) is null
     and (select share_count from analytics.content_post_metric where post_id = v_post2_id) is null then
    v_log := v_log || 'T13 (like_count/save_count/share_count ที่ไม่ส่งมา (source=tiktok_api) เป็น null จริง ไม่ error ไม่กลายเป็น 0): PASS' || E'\n';
  else
    v_log := v_log || 'T13: FAIL — like_count/save_count/share_count ไม่เป็น null ตามที่คาด' || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- ห้ามพัง — content_post_set_status ไม่ลบ metric เก่า
  -- --------------------------------------------------------------------
  perform analytics.content_post_set_status(v_shop, v_post_id, 'deleted');

  select count(*) into v_count from analytics.content_post_metric where post_id = v_post_id;
  select status into v_row from analytics.content_post where id = v_post_id;

  -- แถวของ v_post_id ใน content_post_metric: T8/T9/T11 upsert เดียวกัน = 1 แถว
  -- (วันนี้) + T12 seed 2 แถว (เมื่อวาน/วานซืน) = 3
  if v_row.status = 'deleted' and v_count = 3 then
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
  -- T_no_overload — RPC ทั้ง 3 ตัว มี signature เดียว ไม่เกิด overload (#1/#13)
  -- --------------------------------------------------------------------
  select count(*) into v_fn_sig_count from pg_proc
  where pronamespace = 'analytics'::regnamespace
    and proname in ('content_post_upsert', 'content_post_metric_upsert', 'content_post_set_status')
  group by proname
  having count(*) > 1;

  if v_fn_sig_count is null then
    v_log := v_log || 'T_no_overload (content_post_upsert/content_post_metric_upsert/content_post_set_status: signature เดียวทุกตัว ไม่มี overload): PASS' || E'\n';
  else
    v_log := v_log || format('T_no_overload: FAIL — พบ proname ที่มีมากกว่า 1 signature (%s ตัว)', v_fn_sig_count) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T_old_data — ของเดิมไม่พัง (บรีฟข้อ 14)
  -- --------------------------------------------------------------------
  select count(*) into v_sa_count from analytics.step_artifact;
  select count(*) into v_cs_count from analytics.campaign_step;
  select count(*) into v_ct_count from analytics.content_type;
  select count(*) into v_vcb_count from analytics.v_campaign_board;

  if v_sa_count = 65 and v_cs_count = 55 and v_ct_count = 5 and v_vcb_count = 55 then
    v_log := v_log || 'T_old_data (step_artifact=65, campaign_step=55, content_type=5, v_campaign_board=55 เท่าเดิมเป๊ะ): PASS' || E'\n';
  else
    v_log := v_log || format('T_old_data: FAIL — step_artifact=%s campaign_step=%s content_type=%s v_campaign_board=%s',
      v_sa_count, v_cs_count, v_ct_count, v_vcb_count) || E'\n';
  end if;

  raise exception '%', v_log;  -- บังคับ rollback ทั้งก้อน (3j-migration-traps #11) — DB ไม่ขยับจริง
end;
$verify0148$;
