-- scripts/verify-0149.sql
-- ทดสอบ 0149_content_metric_views.sql — do-block + raise exception บังคับ
-- rollback เสมอ (3j-migration-traps #11) ห้ามรันแยกเป็น script ที่ COMMIT.
--
-- 🔴 0149 ต้องพึ่ง analytics.content_post/content_post_metric จาก 0148 — ซ้อมโดย
-- ต่อ 3 ไฟล์เรียงกัน (0148 DDL + 0149 DDL + verify นี้) แล้วรันทีเดียว:
--   cat supabase/migrations/0148_content_post.sql supabase/migrations/0149_content_metric_views.sql scripts/verify-0149.sql > _combo.sql
--   node scripts/run-sql.mjs _combo.sql   (ค่าตั้งต้น ROLLBACK เสมอ)
--
-- ใช้ shop จริง (a7c850ee-6776-4c3e-ba72-ba9e8caba2b7) เหตุผลเดียวกับ verify-0148.
-- ทั้งทรานแซกชัน rollback ท้ายสุดเสมอ ไม่มีอะไรถูกเขียนทับถาวร.
--
-- อายุ (age_days) ของโพสต์ทดสอบผูกกับ "วันนี้ตามเวลาไทย" ที่คำนวณสดตอนรัน
-- (v_today_th) ไม่ hardcode วันที่ — ทำให้สคริปต์นี้รันได้ถูกต้องไม่ว่าจะรันวันไหน.
--
-- 🔴 รอบ 2 (23 ก.ย. 69) — เพิ่มตามรายงาน security-auditor:
--   M3 — สถานะกลางของ v_content_post_t7 (อายุ 5-9 ยังไม่มี snapshot)
--   M4 — v_content_entry_queue เปลี่ยนจากวันเป๊ะเป็นหน้าต่างอายุ (1-2/3-4/5-9)
--   H3 (ชั้นอ่าน) — แถว metric ที่ไม่มีตัวเลขจริงเลย (backfill/seed ตรง) ต้องไม่
--     เตะโพสต์ออกจากคิว
--
-- อ่านผลจาก NOTICE — บรรทัดรูปแบบ "ชื่อเทสต์: PASS/FAIL" ทุกข้อ
-- นับ FAIL ด้วย: grep -o ': FAIL' (ไม่ grep คำว่า FAIL เฉยๆ)

do $verify0149$
declare
  v_log text := E'\n=== verify-0149 (content_metric_views) ===\n';

  v_shop uuid := 'a7c850ee-6776-4c3e-ba72-ba9e8caba2b7'::uuid;
  v_today_th date;

  v_post_a uuid; -- อายุ 3 วัน (ยังไม่ถึง T+7) มี snapshot age=3 อยู่ — ต้องไม่โผล่ค่านั้นแทน
  v_post_b uuid; -- age=5 กับ age=9 เท่ากันจาก 7 (tie) — ต้องเลือก age=9 (มากกว่า)
  v_post_c uuid; -- age=5 กับ age=8 — ไม่เท่ากัน ต้องเลือก age=8 (ใกล้ 7 กว่า)
  v_post_d uuid; -- อายุ 20 วัน ไม่มี snapshot ใน [5,9] เลย (มีแต่ age=12 นอกช่วง) — หน้าต่างปิดแล้วจริง
  v_post_e uuid; -- 🔴 M3: อายุ 6 วัน (อยู่ใน [5,9], หน้าต่างยังไม่ปิด) ไม่มี snapshot เลย
  v_post_f uuid; -- age=7 พอดี, save_count=null ⇒ save_rate ต้อง null (ไม่ error/ไม่ 0)
  v_post_g uuid; -- age=7 พอดี, view_count=0 ⇒ save_rate/share_rate ต้อง null (กันหารศูนย์)

  v_post_h uuid; -- age วันนี้=1 (หน้าต่าง 1-2), active, ยังไม่มี metric ⇒ ต้องอยู่ในคิว round=1
  v_post_i uuid; -- age วันนี้=3 (หน้าต่าง 3-4), active, มี metric ของวันนี้แล้ว ⇒ ต้องไม่อยู่ในคิว
  v_post_j uuid; -- age วันนี้=7 (หน้าต่าง 5-9), status=deleted ⇒ ต้องไม่อยู่ในคิว
  v_post_k uuid; -- age วันนี้=15 (เกินทุกหน้าต่าง) ⇒ ต้องไม่อยู่ในคิว (หน้าต่างปิดแล้ว)
  v_post_m uuid; -- 🔴 M4: age วันนี้=2 แต่มี metric จริงที่ age=1 (วันก่อนในหน้าต่างเดียวกัน 1-2)
                 -- ⇒ ต้อง "ไม่" อยู่ในคิว (นับว่าอ่านแล้วในหน้าต่างนี้ ไม่ใช่แค่วันนี้)
  v_post_n uuid; -- 🔴 H3 (ชั้นอ่าน): age วันนี้=1, มีแถว metric ของวันนี้แต่ "ว่างทั้ง 5 ช่อง"
                 -- (seed ตรง bypass RPC) ⇒ ต้องยัง "อยู่" ในคิว (แถวว่างไม่นับว่าอ่านแล้ว)

  v_row record;
  v_count int;

  v_tbl text;
  v_role text;
  v_priv text;
  v_priv_leak_count int := 0;
  v_public_acl_count int;
  v_su_authenticated boolean;
  v_su_anon boolean;
  v_su_service_role boolean;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_today_th := (now() at time zone 'Asia/Bangkok')::date;

  -- ========================================================================
  -- setup: content_post ผ่าน RPC (posted_at ปักเที่ยงวันไทยของวันที่คำนวณ กัน
  -- ปัญหาขอบเที่ยงคืน) + content_post_metric แทรกตรง (bypass RPC) สำหรับ
  -- snapshot ประวัติที่ RPC ทำเองไม่ได้ (RPC ผูกกับ "วันนี้" เสมอ)
  -- ========================================================================
  v_post_a := analytics.content_post_upsert(v_shop, 'tiktok', '__test149_a', 'https://tiktok.com/a',
    ((v_today_th - 3) + time '12:00') at time zone 'Asia/Bangkok');
  v_post_b := analytics.content_post_upsert(v_shop, 'tiktok', '__test149_b', 'https://tiktok.com/b',
    ((v_today_th - 20) + time '12:00') at time zone 'Asia/Bangkok');
  v_post_c := analytics.content_post_upsert(v_shop, 'tiktok', '__test149_c', 'https://tiktok.com/c',
    ((v_today_th - 20) + time '12:00') at time zone 'Asia/Bangkok');
  v_post_d := analytics.content_post_upsert(v_shop, 'tiktok', '__test149_d', 'https://tiktok.com/d',
    ((v_today_th - 20) + time '12:00') at time zone 'Asia/Bangkok');
  v_post_e := analytics.content_post_upsert(v_shop, 'tiktok', '__test149_e', 'https://tiktok.com/e',
    ((v_today_th - 6) + time '12:00') at time zone 'Asia/Bangkok');
  v_post_f := analytics.content_post_upsert(v_shop, 'tiktok', '__test149_f', 'https://tiktok.com/f',
    ((v_today_th - 20) + time '12:00') at time zone 'Asia/Bangkok');
  v_post_g := analytics.content_post_upsert(v_shop, 'tiktok', '__test149_g', 'https://tiktok.com/g',
    ((v_today_th - 20) + time '12:00') at time zone 'Asia/Bangkok');

  v_post_h := analytics.content_post_upsert(v_shop, 'tiktok', '__test149_h', 'https://tiktok.com/h',
    ((v_today_th - 1) + time '12:00') at time zone 'Asia/Bangkok');
  v_post_i := analytics.content_post_upsert(v_shop, 'tiktok', '__test149_i', 'https://tiktok.com/i',
    ((v_today_th - 3) + time '12:00') at time zone 'Asia/Bangkok');
  v_post_j := analytics.content_post_upsert(v_shop, 'tiktok', '__test149_j', 'https://tiktok.com/j',
    ((v_today_th - 7) + time '12:00') at time zone 'Asia/Bangkok');
  v_post_k := analytics.content_post_upsert(v_shop, 'tiktok', '__test149_k', 'https://tiktok.com/k',
    ((v_today_th - 15) + time '12:00') at time zone 'Asia/Bangkok');
  v_post_m := analytics.content_post_upsert(v_shop, 'tiktok', '__test149_m', 'https://tiktok.com/m',
    ((v_today_th - 2) + time '12:00') at time zone 'Asia/Bangkok');
  v_post_n := analytics.content_post_upsert(v_shop, 'tiktok', '__test149_n', 'https://tiktok.com/n',
    ((v_today_th - 1) + time '12:00') at time zone 'Asia/Bangkok');

  -- post A: snapshot ที่ age=3 (ยังไม่ถึงช่วง [5,9]) — ต้องไม่ถูกเอามาแทนค่า t7
  insert into analytics.content_post_metric (shop_id, post_id, captured_on, age_days, view_count, source)
  values (v_shop, v_post_a, v_today_th, 3, 999, 'backfill');

  -- post B: age=5 และ age=9 (ระยะเท่ากันจาก 7) — tie-break ต้องเลือก age=9
  insert into analytics.content_post_metric (shop_id, post_id, captured_on, age_days, view_count, source)
  values
    (v_shop, v_post_b, v_today_th - 15, 5, 5000, 'backfill'),
    (v_shop, v_post_b, v_today_th - 11, 9, 9000, 'backfill');

  -- post C: age=5 และ age=8 (ไม่เท่ากัน) — ต้องเลือก age=8 (ใกล้ 7 กว่า)
  insert into analytics.content_post_metric (shop_id, post_id, captured_on, age_days, view_count, source)
  values
    (v_shop, v_post_c, v_today_th - 15, 5, 5555, 'backfill'),
    (v_shop, v_post_c, v_today_th - 12, 8, 8888, 'backfill');

  -- post D: อายุ 20 วัน มีแค่ age=12 (นอกช่วง [5,9]) — หน้าต่างปิดแล้วจริง
  insert into analytics.content_post_metric (shop_id, post_id, captured_on, age_days, view_count, source)
  values (v_shop, v_post_d, v_today_th - 8, 12, 12000, 'backfill');

  -- post E: อายุ 6 วัน (อยู่ใน [5,9]) ไม่มี snapshot เลย — หน้าต่างยังไม่ปิด (M3)

  -- post F: age=7 พอดี, save_count=null explicit ⇒ save_rate ต้อง null
  insert into analytics.content_post_metric (shop_id, post_id, captured_on, age_days, view_count, save_count, share_count, source)
  values (v_shop, v_post_f, v_today_th - 13, 7, 1000, null, 50, 'backfill');

  -- post G: age=7 พอดี, view_count=0 ⇒ save_rate/share_rate ต้อง null (กันหารศูนย์)
  insert into analytics.content_post_metric (shop_id, post_id, captured_on, age_days, view_count, save_count, share_count, source)
  values (v_shop, v_post_g, v_today_th - 13, 7, 0, 10, 5, 'backfill');

  -- post I: มี metric ของ "วันนี้" แล้ว (age=3, หน้าต่าง 3-4) ⇒ ต้องหายจากคิว
  perform analytics.content_post_metric_upsert(v_shop, v_post_i, 100, 1, 0, 0, 0, 'manual');

  -- post J: ตั้งสถานะเป็น deleted ⇒ ต้องไม่อยู่ในคิวแม้ age=7 ตรง
  perform analytics.content_post_set_status(v_shop, v_post_j, 'deleted');

  -- 🔴 M4: post M อายุวันนี้=2 (หน้าต่าง 1-2) แต่มี metric จริงที่ age=1 (เมื่อวาน,
  -- ยังอยู่ในหน้าต่างเดียวกัน 1-2) ⇒ ถือว่า "อ่านแล้ว" ในหน้าต่างนี้ ไม่ต้องรอวันนี้
  insert into analytics.content_post_metric (shop_id, post_id, captured_on, age_days, view_count, source)
  values (v_shop, v_post_m, v_today_th - 1, 1, 777, 'manual');

  -- 🔴 H3 (ชั้นอ่าน): post N อายุวันนี้=1 มีแถว metric ของวันนี้แต่ว่างทั้ง 5 ช่อง
  -- (seed ตรง bypass RPC — RPC เองปฏิเสธแถวว่างไปแล้วที่ 0148 แต่ตารางยังรับ raw
  -- insert ได้เพราะ CHECK ไม่ได้บังคับ "ต้องมีอย่างน้อย 1 ค่า" ไว้)
  insert into analytics.content_post_metric (shop_id, post_id, captured_on, age_days, source)
  values (v_shop, v_post_n, v_today_th, 1, 'backfill');

  -- --------------------------------------------------------------------
  -- T1 — post A (อายุ 3 วัน): ค่าทุกตัวใน t7 ต้อง null + เหตุผล 'ยังไม่ถึง 7 วัน'
  -- (ไม่ใช่เอา snapshot age=3 ที่มีอยู่จริงมาแทนเงียบๆ)
  -- --------------------------------------------------------------------
  select * into v_row from analytics.v_content_post_t7 where post_id = v_post_a;

  if v_row.t7_view_count is null and v_row.t7_age_days is null
     and v_row.t7_unavailable_reason = 'ยังไม่ถึง 7 วัน' then
    v_log := v_log || 'T1 (โพสต์อายุ 3 วัน — t7 ทุกค่า null, ไม่เอา snapshot age=3 มาแทน, เหตุผล=''ยังไม่ถึง 7 วัน''): PASS' || E'\n';
  else
    v_log := v_log || format('T1: FAIL — t7_view_count=%s t7_age_days=%s reason=%s',
      v_row.t7_view_count, v_row.t7_age_days, v_row.t7_unavailable_reason) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T2 — post B: age=5 (5000) กับ age=9 (9000) ระยะเท่ากันจาก 7 ⇒ เลือก age=9 (มากกว่า)
  -- --------------------------------------------------------------------
  select * into v_row from analytics.v_content_post_t7 where post_id = v_post_b;

  if v_row.t7_age_days = 9 and v_row.t7_view_count = 9000 and v_row.t7_unavailable_reason is null then
    v_log := v_log || 'T2 (tie-break age=5 vs age=9 ระยะเท่ากัน ⇒ เลือก age=9 ค่ามากกว่า): PASS' || E'\n';
  else
    v_log := v_log || format('T2: FAIL — t7_age_days=%s t7_view_count=%s', v_row.t7_age_days, v_row.t7_view_count) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T3 — post C: age=5 (5555) กับ age=8 (8888) ไม่เท่ากัน ⇒ เลือก age=8 (ใกล้ 7 กว่า)
  -- --------------------------------------------------------------------
  select * into v_row from analytics.v_content_post_t7 where post_id = v_post_c;

  if v_row.t7_age_days = 8 and v_row.t7_view_count = 8888 then
    v_log := v_log || 'T3 (age=5 vs age=8 ไม่เท่ากัน ⇒ เลือก age=8 ใกล้ 7 กว่าจริง): PASS' || E'\n';
  else
    v_log := v_log || format('T3: FAIL — t7_age_days=%s t7_view_count=%s', v_row.t7_age_days, v_row.t7_view_count) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T4 — post D: อายุ 20 วัน (เกิน 9 แน่นอน, หน้าต่างปิดแล้วจริง) แต่ไม่มี
  -- snapshot ใน [5,9] เลย (มีแต่ age=12 นอกช่วง) ⇒ null + เหตุผล 'ไม่มีข้อมูลช่วง T+7'
  -- --------------------------------------------------------------------
  select * into v_row from analytics.v_content_post_t7 where post_id = v_post_d;

  if v_row.t7_view_count is null and v_row.t7_unavailable_reason = 'ไม่มีข้อมูลช่วง T+7' then
    v_log := v_log || 'T4 (อายุ 20 วัน หน้าต่างปิดแล้วจริง ไม่มี snapshot ใน [5,9] เลย (มีแต่ age=12 นอกช่วง) ⇒ null + เหตุผล=''ไม่มีข้อมูลช่วง T+7''): PASS' || E'\n';
  else
    v_log := v_log || format('T4: FAIL — t7_view_count=%s reason=%s', v_row.t7_view_count, v_row.t7_unavailable_reason) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T5 🔴 M3 — post E: อายุ 6 วัน (อยู่ใน [5,9], หน้าต่างยังไม่ปิด) ไม่มี snapshot
  -- เลย ⇒ ต้องได้สถานะกลาง 'อยู่ในช่วง T+7 ยังเก็บทัน แต่ยังไม่ได้กรอก' ไม่ใช่
  -- 'ไม่มีข้อมูลช่วง T+7' (ซึ่งควรสงวนไว้เฉพาะหน้าต่างที่ปิดแล้วจริง)
  -- --------------------------------------------------------------------
  select * into v_row from analytics.v_content_post_t7 where post_id = v_post_e;

  if v_row.t7_view_count is null and v_row.t7_unavailable_reason = 'อยู่ในช่วง T+7 ยังเก็บทัน แต่ยังไม่ได้กรอก' then
    v_log := v_log || 'T5 (post_e อายุ 6 วัน ไม่มี snapshot แต่หน้าต่าง [5,9] ยังไม่ปิด ⇒ เหตุผล=''อยู่ในช่วง T+7 ยังเก็บทัน แต่ยังไม่ได้กรอก'' ไม่ใช่ตัดสินเร็วเกิน): PASS' || E'\n';
  else
    v_log := v_log || format('T5: FAIL — t7_view_count=%s reason=%s', v_row.t7_view_count, v_row.t7_unavailable_reason) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T6 — post F: age=7 พอดี, save_count=null ⇒ save_rate ต้อง null (ไม่ error,
  -- ไม่ใช่ 0) ส่วน share_rate คำนวณได้ปกติ (50/1000=0.05)
  -- --------------------------------------------------------------------
  select * into v_row from analytics.v_content_post_t7 where post_id = v_post_f;

  if v_row.save_rate is null and v_row.share_rate = 0.05 then
    v_log := v_log || 'T6 (save_count=null ⇒ save_rate=null (ไม่ใช่ 0, ไม่ error), share_rate=0.05 คำนวณได้ปกติ): PASS' || E'\n';
  else
    v_log := v_log || format('T6: FAIL — save_rate=%s share_rate=%s', v_row.save_rate, v_row.share_rate) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T7 — post G: view_count=0 ⇒ save_rate/share_rate ต้อง null ทั้งคู่ (กันหารศูนย์
  -- ไม่ error, ไม่ใช่ 0 หรือ infinity)
  -- --------------------------------------------------------------------
  select * into v_row from analytics.v_content_post_t7 where post_id = v_post_g;

  if v_row.save_rate is null and v_row.share_rate is null then
    v_log := v_log || 'T7 (view_count=0 ⇒ save_rate/share_rate=null ทั้งคู่ ไม่ error หารศูนย์): PASS' || E'\n';
  else
    v_log := v_log || format('T7: FAIL — save_rate=%s share_rate=%s', v_row.save_rate, v_row.share_rate) || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T8 — v_content_entry_queue: post H (age=1, หน้าต่าง 1-2, active, ยังไม่มี
  -- metric เลย) ต้องอยู่ในคิว read_round=1
  -- --------------------------------------------------------------------
  select * into v_row from analytics.v_content_entry_queue where post_id = v_post_h;

  if v_row.post_id = v_post_h and v_row.read_round = 1 then
    v_log := v_log || 'T8 (post_h age=1 (หน้าต่าง 1-2) ยังไม่มี metric ⇒ อยู่ในคิว read_round=1): PASS' || E'\n';
  else
    v_log := v_log || 'T8: FAIL — post_h ไม่อยู่ในคิว หรือ read_round ผิด' || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T9 🔴 — post I (age=3, หน้าต่าง 3-4, active, มี metric วันนี้แล้วจาก setup)
  -- ⇒ ต้องหายจากคิว
  -- --------------------------------------------------------------------
  select count(*) into v_count from analytics.v_content_entry_queue where post_id = v_post_i;

  if v_count = 0 then
    v_log := v_log || 'T9 (post_i age=3 แต่มี metric ของวันนี้แล้ว ⇒ หายจากคิวทันที): PASS' || E'\n';
  else
    v_log := v_log || 'T9: FAIL — post_i ยังอยู่ในคิวทั้งที่อ่านวันนี้ไปแล้ว' || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T10 🔴 — post J (age=7 ตรงหน้าต่าง 5-9 แต่ status=deleted) ⇒ ต้องไม่อยู่ในคิว
  -- --------------------------------------------------------------------
  select count(*) into v_count from analytics.v_content_entry_queue where post_id = v_post_j;

  if v_count = 0 then
    v_log := v_log || 'T10 (post_j age=7 ตรงหน้าต่างแต่ status=deleted ⇒ ไม่อยู่ในคิว): PASS' || E'\n';
  else
    v_log := v_log || 'T10: FAIL — post_j (deleted) หลุดเข้าคิว' || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T11 — post K (age=15, เกินทุกหน้าต่าง) ⇒ ต้องไม่อยู่ในคิว (หน้าต่างปิดแล้ว
  -- ไม่ค้างถาวร แต่ก็ไม่หลุดเข้าคิวผิดๆ เช่นกัน — ไม่พังฝั่งตรงข้าม)
  -- --------------------------------------------------------------------
  select count(*) into v_count from analytics.v_content_entry_queue where post_id = v_post_k;

  if v_count = 0 then
    v_log := v_log || 'T11 (post_k age=15 เกินทุกหน้าต่างแล้ว ⇒ ไม่อยู่ในคิว, หน้าต่างปิดตัวเองจริง): PASS' || E'\n';
  else
    v_log := v_log || 'T11: FAIL — post_k (age=15) หลุดเข้าคิวทั้งที่หน้าต่างปิดหมดแล้ว' || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T12 🔴 M4 — post M: อายุวันนี้=2 (หน้าต่าง 1-2) แต่มี metric จริงที่ age=1
  -- (เมื่อวาน, หน้าต่างเดียวกัน) ⇒ ถือว่าอ่านแล้วในหน้าต่างนี้ ไม่ต้องรออีกวันเป๊ะ
  -- (นี่คือจุดที่ M4 ต่างจาก "วันเป๊ะ" เดิม — พลาดวันแรกยังจับคืนได้ในหน้าต่างเดียวกัน)
  -- --------------------------------------------------------------------
  select count(*) into v_count from analytics.v_content_entry_queue where post_id = v_post_m;

  if v_count = 0 then
    v_log := v_log || 'T12 (post_m age วันนี้=2 แต่มีตัวเลขจริงที่ age=1 ในหน้าต่างเดียวกัน (1-2) ⇒ ไม่อยู่ในคิว — M4 หน้าต่างทำงานถูกต้อง): PASS' || E'\n';
  else
    v_log := v_log || 'T12: FAIL — post_m หลุดเข้าคิวทั้งที่มีตัวเลขจริงในหน้าต่างเดียวกันแล้ว' || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T13 🔴 H3 (ชั้นอ่าน) — post N: มีแถว metric ของวันนี้แต่ว่างทั้ง 5 ช่อง
  -- (backfill/seed ตรง) ⇒ ต้อง "ยังอยู่" ในคิว (แถวว่างไม่นับว่าอ่านแล้ว — สกิลข้อ
  -- 13: "มีแถวไหม" กับ "มีตัวเลขไหม" คนละคำถาม)
  -- --------------------------------------------------------------------
  select * into v_row from analytics.v_content_entry_queue where post_id = v_post_n;

  if v_row.post_id = v_post_n and v_row.read_round = 1 then
    v_log := v_log || 'T13 (post_n มีแถว metric วันนี้แต่ว่างทั้ง 5 ช่อง ⇒ ยังอยู่ในคิว — แถวว่างไม่นับว่าอ่านแล้ว, H3 ชั้นอ่าน): PASS' || E'\n';
  else
    v_log := v_log || 'T13: FAIL — post_n หลุดออกจากคิวทั้งที่แถว metric ว่างเปล่า ไม่มีตัวเลขจริง' || E'\n';
  end if;

  -- --------------------------------------------------------------------
  -- T_grant — anon/authenticated ไม่มีสิทธิ์ select บน 2 view ใหม่, service_role มี,
  -- ไม่มี PUBLIC ใน relacl, schema usage ยังล็อกอยู่ (ย้ำซ้ำจาก 0148 เพื่อความชัวร์
  -- เฉพาะ object ของไฟล์นี้)
  -- --------------------------------------------------------------------
  foreach v_tbl in array array['v_content_post_t7', 'v_content_entry_queue'] loop
    foreach v_role in array array['anon', 'authenticated'] loop
      foreach v_priv in array array['select', 'insert', 'update', 'delete'] loop
        if has_table_privilege(v_role, 'analytics.' || v_tbl, v_priv) then
          v_priv_leak_count := v_priv_leak_count + 1;
        end if;
      end loop;
    end loop;
  end loop;

  if not has_table_privilege('service_role', 'analytics.v_content_post_t7', 'select')
     or not has_table_privilege('service_role', 'analytics.v_content_entry_queue', 'select') then
    v_priv_leak_count := v_priv_leak_count + 1000;
  end if;

  select count(*) into v_public_acl_count
  from pg_class c
  cross join lateral aclexplode(c.relacl) a
  where c.relnamespace = 'analytics'::regnamespace
    and c.relname in ('v_content_post_t7', 'v_content_entry_queue')
    and a.grantee = 0;

  select has_schema_privilege('authenticated', 'analytics', 'usage') into v_su_authenticated;
  select has_schema_privilege('anon', 'analytics', 'usage') into v_su_anon;
  select has_schema_privilege('service_role', 'analytics', 'usage') into v_su_service_role;

  if v_priv_leak_count = 0 and v_public_acl_count = 0
     and v_su_authenticated is false and v_su_anon is false and v_su_service_role is true then
    v_log := v_log || 'T_grant (anon/authenticated ไม่มี select บน 2 view ใหม่เลย, service_role มี, ไม่มี PUBLIC ใน relacl, schema usage ยังปิดสำหรับ anon/authenticated): PASS' || E'\n';
  else
    v_log := v_log || format('T_grant: FAIL — priv_leak=%s public_acl=%s authenticated_usage=%s anon_usage=%s',
      v_priv_leak_count, v_public_acl_count, v_su_authenticated, v_su_anon) || E'\n';
  end if;

  raise exception '%', v_log;  -- บังคับ rollback ทั้งก้อน (3j-migration-traps #11) — DB ไม่ขยับจริง
end;
$verify0149$;
