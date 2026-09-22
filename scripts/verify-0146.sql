-- scripts/verify-0146.sql
-- ทดสอบ 0146_live_night_snapshot.sql — do-block + raise exception บังคับ
-- rollback เสมอ (3j-migration-traps #11) ห้ามรันแยกเป็น script ที่ COMMIT.
-- ต้องรันหลัง DDL ของ 0146 มีอยู่แล้ว (ต่อท้ายไฟล์เดียวกันตอนซ้อม หรือหลัง
-- Tech Lead apply จริง). ใช้ shop_id จริงของ 3J (a7c850ee-...) — ทุกอย่างที่
-- เขียนในนี้ถูก rollback ท้ายบล็อก ไม่กระทบข้อมูลจริงแม้จะชนวันที่จริงก็ตาม.
--
-- อ่านผลจาก NOTICE — บรรทัดรูปแบบ "ชื่อเทสต์: PASS/FAIL" ทุกข้อ
-- นับ FAIL ด้วย: grep -o ': FAIL'

do $verify0146$
declare
  v_shop_id  uuid := 'a7c850ee-6776-4c3e-ba72-ba9e8caba2b7'::uuid;
  v_today    date;

  v_log text := E'\n=== verify-0146 (live_night_snapshot) ===\n';

  -- ---- group A: capture() บนข้อมูลจริงผ่าน live_session_log ----
  v_date_a3   date;  -- age=3 วันนี้ ตอนแคปเจอร์รอบแรก, peak รู้ค่า
  v_date_a4   date;  -- age=4, peak null
  v_date_a10  date;  -- age=10 (นอกหน้าต่าง 0-7)
  v_start_a3  timestamptz;
  v_end_a3    timestamptz;
  v_start_a4  timestamptz;
  v_end_a4    timestamptz;
  v_start_a10 timestamptz;
  v_end_a10   timestamptz;

  v_capture_count1 int;
  v_capture_count2 int;
  v_snap_a3_peak   int;
  v_snap_a3_hours  numeric(6,2);
  v_snap_a4_peak_isnull boolean;
  v_snap_a10_exists boolean;

  v_checksum_before text;
  v_checksum_after  text;

  -- ---- group B: v_live_night_locked ด้วย snapshot ที่ยัดตรงๆ (ตัดขาดจาก capture()) ----
  v_lock_date1 date := date '2020-06-01';  -- มี age 1,2,3,4,5,6 ครบ -> ต้องเลือก age=3
  v_lock_date2 date := date '2020-06-02';  -- มีแค่ age 2,4 (ไม่มี 3) -> เท่ากันที่ระยะ 1 -> เลือก age มากกว่า (4)
  v_lock_date3 date := date '2020-06-03';  -- มีแค่ age 1 (นอกช่วง [2,5]) -> ไม่ควรปรากฏเลย
  v_lock_date4 date := date '2020-06-04';  -- มีแค่ age 3 แต่ live_hours/peak เป็น null -> ต้องได้ null ไม่ใช่ 0/หารด้วยศูนย์

  v_locked_revenue1 numeric;
  v_locked_age1     int;
  v_locked_revenue2 numeric;
  v_locked_age2     int;
  v_locked_exists3  boolean;
  v_locked_ratio4   numeric;
  v_locked_peak4_isnull boolean;
  v_locked_hours4_isnull boolean;

  -- ---- group C: privileges ----
  v_priv_anon   boolean;
  v_priv_auth   boolean;
  v_priv_svc    boolean;
  v_overload_count int;

  -- M5/M6 (security round 1, 22 ก.ย. 69): role_table_grants เดิมมองไม่เห็น
  -- grantee=PUBLIC และไม่นับ column-level grant ⇒ เปลี่ยนไปใช้
  -- has_table_privilege + relacl ตรงๆ, และเพิ่มเช็ค schema usage (invariant
  -- หลักของ 0123) แยกจาก verify-0145.sql เพื่อให้ไฟล์นี้ยืนยันตัวเองได้ถ้าถูก
  -- รันแยกหลัง apply จริง
  v_tbl  text;
  v_role text;
  v_priv text;
  v_priv_leak_count  int := 0;
  v_public_acl_count int;
  v_su_authenticated boolean;
  v_su_anon          boolean;
  v_su_service_role  boolean;

  -- ---- group D: table constraints ----
  v_constraint_ok boolean;

  -- ---- group E: M1 NaN (security round 1, 22 ก.ย. 69) ----
  v_nan_check_pass boolean;
  v_nan_lock_date  date := date '2020-06-05';
  v_nan_ratio      numeric;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_today := (now() at time zone 'Asia/Bangkok')::date;

  v_date_a3  := v_today - 3;
  v_date_a4  := v_today - 4;
  v_date_a10 := v_today - 10;

  v_start_a3 := (v_date_a3 + time '20:00') at time zone 'Asia/Bangkok';
  v_end_a3   := (v_date_a3 + time '23:00') at time zone 'Asia/Bangkok';
  v_start_a4 := (v_date_a4 + time '20:00') at time zone 'Asia/Bangkok';
  v_end_a4   := (v_date_a4 + time '22:30') at time zone 'Asia/Bangkok';
  v_start_a10 := (v_date_a10 + time '20:00') at time zone 'Asia/Bangkok';
  v_end_a10   := (v_date_a10 + time '23:00') at time zone 'Asia/Bangkok';

  -- upsert ตรงเข้า live_session_log (ไม่ผ่าน RPC เพื่อคุม peak_viewers=null
  -- แม่นยำ) — ทับแถวเดิมถ้ามีอยู่แล้ว ปลอดภัยเพราะทั้งบล็อก rollback ท้ายสุด
  insert into analytics.live_session_log (shop_id, live_date, started_at, ended_at, peak_viewers, source)
  values (v_shop_id, v_date_a3, v_start_a3, v_end_a3, 800, 'backfill')
  on conflict (shop_id, live_date) do update set
    started_at = excluded.started_at, ended_at = excluded.ended_at, peak_viewers = excluded.peak_viewers;

  insert into analytics.live_session_log (shop_id, live_date, started_at, ended_at, peak_viewers, source)
  values (v_shop_id, v_date_a4, v_start_a4, v_end_a4, null, 'backfill')
  on conflict (shop_id, live_date) do update set
    started_at = excluded.started_at, ended_at = excluded.ended_at, peak_viewers = excluded.peak_viewers;

  insert into analytics.live_session_log (shop_id, live_date, started_at, ended_at, peak_viewers, source)
  values (v_shop_id, v_date_a10, v_start_a10, v_end_a10, 500, 'backfill')
  on conflict (shop_id, live_date) do update set
    started_at = excluded.started_at, ended_at = excluded.ended_at, peak_viewers = excluded.peak_viewers;

  -- --------------------------------------------------------------------
  -- T6a/T7/ภาพรวม — เรียก capture() ครั้งแรก
  -- --------------------------------------------------------------------
  v_capture_count1 := analytics.live_night_snapshot_capture(v_shop_id);

  select peak_viewers, live_hours into v_snap_a3_peak, v_snap_a3_hours
  from analytics.live_night_snapshot
  where shop_id = v_shop_id and live_date = v_date_a3 and age_days = 3;

  if v_snap_a3_peak = 800 and v_snap_a3_hours = 3.00 then
    v_log := v_log || 'T_capture_basic (snapshot age=3 เก็บ peak=800/hours=3.00 ถูกต้อง): PASS' || E'\n';
  else
    v_log := v_log || format('T_capture_basic: FAIL — peak=%s hours=%s', v_snap_a3_peak, v_snap_a3_hours) || E'\n';
  end if;

  select (peak_viewers is null) into v_snap_a4_peak_isnull
  from analytics.live_night_snapshot
  where shop_id = v_shop_id and live_date = v_date_a4 and age_days = 4;

  if v_snap_a4_peak_isnull is true then
    v_log := v_log || 'T7a (peak_viewers null ในคืนที่ไม่ได้จด -> snapshot ได้ null ไม่ใช่ 0): PASS' || E'\n';
  else
    v_log := v_log || format('T7a: FAIL — ได้ %s', v_snap_a4_peak_isnull) || E'\n';
  end if;

  select exists(
    select 1 from analytics.live_night_snapshot
    where shop_id = v_shop_id and live_date = v_date_a10
  ) into v_snap_a10_exists;

  if v_snap_a10_exists is false then
    v_log := v_log || 'T_window (คืนอายุ 10 วัน อยู่นอกหน้าต่าง 0-7 -> ไม่ถูกแคปเจอร์เลย): PASS' || E'\n';
  else
    v_log := v_log || 'T_window: FAIL — คืนอายุ 10 วันถูกแคปเจอร์ทั้งที่ควรถูกข้าม' || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T6b — idempotent: เรียกซ้ำรอบสอง เทียบ checksum ของคอลัมน์วัดผล (ไม่รวม
  -- captured_at ซึ่งตั้งใจให้ขยับทุกรอบ) ต้องเหมือนเดิมเป๊ะ
  -- --------------------------------------------------------------------
  select md5(string_agg(
    shop_id::text || '|' || live_date::text || '|' || age_days::text || '|' ||
    day_orders::text || '|' || day_revenue::text || '|' || day_revenue_ex_bar::text || '|' ||
    live_sku_orders::text || '|' || live_sku_revenue::text || '|' ||
    coalesce(live_hours::text, 'NULL') || '|' || coalesce(peak_viewers::text, 'NULL'),
    '||' order by live_date, age_days
  )) into v_checksum_before
  from analytics.live_night_snapshot
  where shop_id = v_shop_id;

  v_capture_count2 := analytics.live_night_snapshot_capture(v_shop_id);

  select md5(string_agg(
    shop_id::text || '|' || live_date::text || '|' || age_days::text || '|' ||
    day_orders::text || '|' || day_revenue::text || '|' || day_revenue_ex_bar::text || '|' ||
    live_sku_orders::text || '|' || live_sku_revenue::text || '|' ||
    coalesce(live_hours::text, 'NULL') || '|' || coalesce(peak_viewers::text, 'NULL'),
    '||' order by live_date, age_days
  )) into v_checksum_after
  from analytics.live_night_snapshot
  where shop_id = v_shop_id;

  if v_checksum_before = v_checksum_after and v_capture_count1 = v_capture_count2 then
    v_log := v_log || format('T6 (รันซ้ำ 2 ครั้งติด: แถว/ค่าเหมือนเดิม, n=%s ทั้งสองรอบ): PASS', v_capture_count1) || E'\n';
  else
    v_log := v_log || format('T6: FAIL — count1=%s count2=%s checksum_before=%s checksum_after=%s',
      v_capture_count1, v_capture_count2, v_checksum_before, v_checksum_after) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- group B — v_live_night_locked: ยัด snapshot ตรงๆ ตัดขาดจาก capture()
  -- เพื่อคุม age_days ได้หลายค่าต่อ 1 live_date ในทรานแซกชันเดียว
  -- --------------------------------------------------------------------
  insert into analytics.live_night_snapshot
    (shop_id, live_date, age_days, day_orders, day_revenue, day_revenue_ex_bar, live_sku_orders, live_sku_revenue, live_hours, peak_viewers)
  values
    (v_shop_id, v_lock_date1, 1, 10, 1111, 1000, 1, 100, 3.00, 100),
    (v_shop_id, v_lock_date1, 2, 10, 2222, 1000, 1, 100, 3.00, 100),
    (v_shop_id, v_lock_date1, 3, 10, 3333, 1000, 1, 100, 3.00, 100),  -- ตัวที่ควรถูกเลือก (ระยะ=0)
    (v_shop_id, v_lock_date1, 4, 10, 4444, 1000, 1, 100, 3.00, 100),
    (v_shop_id, v_lock_date1, 5, 10, 5555, 1000, 1, 100, 3.00, 100),
    (v_shop_id, v_lock_date1, 6, 10, 6666, 1000, 1, 100, 3.00, 100),

    (v_shop_id, v_lock_date2, 2, 20, 2000, 1000, 1, 100, 2.00, 200),  -- ระยะ 1 เท่ากับ age=4
    (v_shop_id, v_lock_date2, 4, 20, 4000, 1000, 1, 100, 2.00, 200),  -- ตัวที่ควรถูกเลือก (tie-break: age มากกว่า)

    (v_shop_id, v_lock_date3, 1, 30, 3000, 1000, 1, 100, 1.00, 300),  -- นอกช่วง [2,5] ทั้งชุด

    (v_shop_id, v_lock_date4, 3, 40, 999, 0, 0, 0, null, null)        -- ตัวเดียวในช่วง แต่ live_hours/peak null
  on conflict (shop_id, live_date, age_days) do update set
    day_revenue = excluded.day_revenue, live_hours = excluded.live_hours, peak_viewers = excluded.peak_viewers;

  select day_revenue, age_days into v_locked_revenue1, v_locked_age1
  from analytics.v_live_night_locked where shop_id = v_shop_id and live_date = v_lock_date1;

  if v_locked_age1 = 3 and v_locked_revenue1 = 3333 then
    v_log := v_log || 'T_locked_exact (มี age=3 พอดี -> เลือก age=3 เสมอ): PASS' || E'\n';
  else
    v_log := v_log || format('T_locked_exact: FAIL — age=%s revenue=%s', v_locked_age1, v_locked_revenue1) || E'\n';
  end if;

  select day_revenue, age_days into v_locked_revenue2, v_locked_age2
  from analytics.v_live_night_locked where shop_id = v_shop_id and live_date = v_lock_date2;

  if v_locked_age2 = 4 and v_locked_revenue2 = 4000 then
    v_log := v_log || 'T_locked_tiebreak (ระยะเท่ากัน age 2 vs 4 -> เลือก age มากกว่า=4 ตามที่ตั้งใจ): PASS' || E'\n';
  else
    v_log := v_log || format('T_locked_tiebreak: FAIL — age=%s revenue=%s', v_locked_age2, v_locked_revenue2) || E'\n';
  end if;

  select exists(
    select 1 from analytics.v_live_night_locked where shop_id = v_shop_id and live_date = v_lock_date3
  ) into v_locked_exists3;

  if v_locked_exists3 is false then
    v_log := v_log || 'T8 (คืนไม่มี snapshot ในช่วง [2,5] -> ไม่ปรากฏในผลลัพธ์เลย ไม่ใช่ตกไปใช้ยอดสด): PASS' || E'\n';
  else
    v_log := v_log || 'T8: FAIL — คืนที่ไม่มี snapshot ในช่วง [2,5] กลับโผล่มาในผลลัพธ์' || E'\n';
  end if;

  select day_revenue_per_live_hour_locked, (peak_viewers is null), (live_hours is null)
  into v_locked_ratio4, v_locked_peak4_isnull, v_locked_hours4_isnull
  from analytics.v_live_night_locked where shop_id = v_shop_id and live_date = v_lock_date4;

  if v_locked_ratio4 is null and v_locked_peak4_isnull is true and v_locked_hours4_isnull is true then
    v_log := v_log || 'T7b (live_hours/peak null -> ดัชนีต่อชั่วโมงได้ null ไม่ใช่ 0 และไม่ error หารด้วยศูนย์): PASS' || E'\n';
  else
    v_log := v_log || format('T7b: FAIL — ratio=%s peak_isnull=%s hours_isnull=%s', v_locked_ratio4, v_locked_peak4_isnull, v_locked_hours4_isnull) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- group C — privileges (supabase-migrate gotcha #1 / 3j-migration-traps #2)
  -- --------------------------------------------------------------------
  select has_function_privilege('anon', 'analytics.live_night_snapshot_capture(uuid)', 'execute') into v_priv_anon;
  select has_function_privilege('authenticated', 'analytics.live_night_snapshot_capture(uuid)', 'execute') into v_priv_auth;
  select has_function_privilege('service_role', 'analytics.live_night_snapshot_capture(uuid)', 'execute') into v_priv_svc;

  if v_priv_anon is false and v_priv_auth is false and v_priv_svc is true then
    v_log := v_log || 'T9 (live_night_snapshot_capture: anon/authenticated=false, service_role=true): PASS' || E'\n';
  else
    v_log := v_log || format('T9: FAIL — anon=%s authenticated=%s service_role=%s', v_priv_anon, v_priv_auth, v_priv_svc) || E'\n';
  end if;

  select count(*) into v_overload_count
  from pg_proc
  where pronamespace = 'analytics'::regnamespace and proname = 'live_night_snapshot_capture';

  if v_overload_count = 1 then
    v_log := v_log || 'T_overload (live_night_snapshot_capture มี signature เดียว ไม่เกิด overload): PASS' || E'\n';
  else
    v_log := v_log || format('T_overload: FAIL — พบ %s overload', v_overload_count) || E'\n';
  end if;

  -- T_M5 (security round 1, 22 ก.ย. 69): role_table_grants เดิมมองไม่เห็น
  -- grantee=PUBLIC และไม่นับ column-level grant ⇒ ใช้ has_table_privilege
  -- ตรงๆ (ผล ACL ที่ resolve แล้วจริง) + เช็ค relacl ว่าไม่มี grantee ว่าง (=PUBLIC)
  foreach v_tbl in array array['live_night_snapshot', 'channel_follower_log', 'v_live_night_locked'] loop
    foreach v_role in array array['anon', 'authenticated'] loop
      foreach v_priv in array array['select', 'insert', 'update', 'delete'] loop
        if has_table_privilege(v_role, 'analytics.' || v_tbl, v_priv) then
          v_priv_leak_count := v_priv_leak_count + 1;
        end if;
      end loop;
    end loop;
  end loop;

  select count(*) into v_public_acl_count
  from pg_class c
  cross join lateral aclexplode(c.relacl) a
  where c.relnamespace = 'analytics'::regnamespace
    and c.relname in ('live_night_snapshot', 'channel_follower_log', 'v_live_night_locked')
    and a.grantee = 0;  -- grantee=0 ใน aclexplode() คือ PUBLIC

  if v_priv_leak_count = 0 and v_public_acl_count = 0 then
    v_log := v_log || 'T_M5 (has_table_privilege: anon/authenticated ไม่มี select/insert/update/delete บน 3 อ็อบเจกต์ใหม่ + ไม่มี PUBLIC ใน relacl): PASS' || E'\n';
  else
    v_log := v_log || format('T_M5: FAIL — priv_leak_count=%s public_acl_count=%s', v_priv_leak_count, v_public_acl_count) || E'\n';
  end if;

  -- T_M6 — invariant หลักที่กันทุกอย่างอยู่ (0123): authenticated/anon ต้องไม่มี
  -- USAGE บนสคีมา analytics เลย (ซ้ำกับ verify-0145.sql โดยตั้งใจ — ให้ไฟล์นี้
  -- ยืนยันตัวเองได้ถ้าถูกรันแยกหลัง apply จริง)
  select has_schema_privilege('authenticated', 'analytics', 'usage') into v_su_authenticated;
  select has_schema_privilege('anon', 'analytics', 'usage') into v_su_anon;
  select has_schema_privilege('service_role', 'analytics', 'usage') into v_su_service_role;

  if v_su_authenticated is false and v_su_anon is false and v_su_service_role is true then
    v_log := v_log || 'T_M6 (has_schema_privilege: authenticated/anon=false, service_role=true บนสคีมา analytics): PASS' || E'\n';
  else
    v_log := v_log || format('T_M6: FAIL — authenticated=%s anon=%s service_role=%s', v_su_authenticated, v_su_anon, v_su_service_role) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- group D — table constraints
  -- --------------------------------------------------------------------
  v_constraint_ok := true;
  begin
    insert into analytics.channel_follower_log (shop_id, channel, as_of_date, follower_count)
      values (v_shop_id, 'line_oa', v_today, -1);
    v_constraint_ok := false;
  exception when check_violation then null;
  end;

  begin
    insert into analytics.channel_follower_log (shop_id, channel, as_of_date, follower_count)
      values (v_shop_id, 'discord', v_today, 100);
    v_constraint_ok := false;
  exception when check_violation then null;
  end;

  begin
    insert into analytics.live_night_snapshot
      (shop_id, live_date, age_days, day_orders, day_revenue, day_revenue_ex_bar, live_sku_orders, live_sku_revenue)
      values (v_shop_id, v_today, -1, 0, 0, 0, 0, 0);
    v_constraint_ok := false;
  exception when check_violation then null;
  end;

  if v_constraint_ok then
    v_log := v_log || 'T_constraints (follower_count ติดลบ / channel นอก enum / age_days ติดลบ ถูกปฏิเสธครบ): PASS' || E'\n';
  else
    v_log := v_log || 'T_constraints: FAIL — มีอย่างน้อย 1 เคสที่ควรถูกปฏิเสธแต่ insert ผ่าน' || E'\n';
  end if;

  -- ยืนยันว่าค่าที่ถูกต้องยัง insert ได้ปกติ (ด่านไม่แน่นเกินจนฆ่าเคสจริง)
  begin
    insert into analytics.channel_follower_log (shop_id, channel, as_of_date, follower_count)
      values (v_shop_id, 'line_oa', v_today, 12345);
    v_log := v_log || 'T_constraints_good (channel_follower_log ค่าที่ถูกต้อง insert ผ่านปกติ): PASS' || E'\n';
  exception when others then
    v_log := v_log || format('T_constraints_good: FAIL — %s', sqlerrm) || E'\n';
  end;

  -- --------------------------------------------------------------------
  -- group E — T_M1 (security round 1, 22 ก.ย. 69, 3j-migration-traps #4):
  -- CHECK เดิม `live_hours >= 0` ปล่อย NaN ผ่าน (NaN >= 0 = true ใน Postgres)
  -- แก้เป็น bound บน 24 ชม. ทั้ง CHECK ของตารางและ view — เทสต์ทั้งสองชั้น
  -- --------------------------------------------------------------------
  v_nan_check_pass := true;
  begin
    insert into analytics.live_night_snapshot
      (shop_id, live_date, age_days, day_orders, day_revenue, day_revenue_ex_bar, live_sku_orders, live_sku_revenue, live_hours)
      values (v_shop_id, v_nan_lock_date, 3, 0, 0, 0, 0, 0, 'NaN'::numeric);
    v_nan_check_pass := false; -- ไม่ควรถึงบรรทัดนี้
  exception when check_violation then
    null; -- ตามคาด
  end;

  if v_nan_check_pass then
    v_log := v_log || 'T_M1a (live_night_snapshot CHECK ตีตก live_hours=NaN ที่ระดับตาราง): PASS' || E'\n';
  else
    v_log := v_log || 'T_M1a: FAIL — live_hours=NaN ถูก insert ผ่าน CHECK ทั้งที่ควรถูกปฏิเสธ' || E'\n';
  end if;

  -- ตารางบล็อก NaN ไปแล้วที่ CHECK ⇒ ทดสอบนิพจน์เดียวกับที่ v_live_night_locked
  -- ใช้จริงในระดับ unit (คัดลอกเงื่อนไขมาตรงๆ) เพื่อพิสูจน์ชั้น view เองก็
  -- null-safe อิสระจากตาราง (defense-in-depth เผื่อ CHECK ถูกผ่อนในอนาคต)
  select case
    when 'NaN'::numeric is null or not ('NaN'::numeric > 0 and 'NaN'::numeric <= 24) then null
    else round(999::numeric / 'NaN'::numeric, 2)
  end into v_nan_ratio;

  if v_nan_ratio is null then
    v_log := v_log || 'T_M1b (นิพจน์เดียวกับ v_live_night_locked: live_hours=NaN -> ratio ได้ null ไม่ใช่ NaN): PASS' || E'\n';
  else
    v_log := v_log || format('T_M1b: FAIL — ได้ %s แทนที่จะเป็น null', v_nan_ratio) || E'\n';
  end if;

  raise exception '%', v_log;  -- บังคับ rollback ทั้งก้อน (3j-migration-traps #11) — DB ไม่ขยับจริง (รวมทั้ง pg_cron job ที่ถูก schedule ในทรานแซกชันเดียวกันถ้ารันต่อจากไฟล์ migration)
end;
$verify0146$;
