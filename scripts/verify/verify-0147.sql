-- scripts/verify-0147.sql
--
-- ชุดทดสอบของ supabase/migrations/0147_revoke_legacy_grants.sql — ถอน
-- execute grant ที่ค้างจากยุคก่อน 0123 บน 7 ฟังก์ชันในสคีมา analytics
-- (2 trigger function ไม่ secdef, 1 security-invoker jsonb reader, 1 stable
-- jsonb reader, 3 security-definer เขียนข้อมูล)
--
-- ตาม skill 3j-migration-traps ข้อ 11: do-block เดียว จบด้วย
-- `raise exception` เสมอ ⇒ ทั้ง transaction rollback ไม่ว่าผลจะผ่าน/ไม่ผ่าน
-- — อ่านผลจาก error message นี้ 🔴 สำคัญเป็นพิเศษในไฟล์นี้: Part 2 ต้อง
-- insert แถว probe ลง analytics.crm_audit_log ซึ่ง**ลบทิ้งเองไม่ได้**
-- (trigger append-only บล็อก DELETE โดยตั้งใจ) ⇒ raise exception คือทาง
-- ทำความสะอาดทางเดียว ทุก path ในไฟล์นี้จบที่ raise exception เดียวกันท้าย
-- บล็อก ไม่มี path ไหนออกจากบล็อกโดยไม่ raise
--
-- 🔴 ห้ามใครห่อ do-block นี้ด้วย outer `exception when others` เด็ดขาด —
-- นั่นคือเงื่อนไขเดียวที่จะทำลายการรับประกัน rollback ข้างบน (แถว probe จะ
-- ค้างถาวรบน DB จริงโดยลบออกไม่ได้) inner handler ที่มีอยู่ทุกตัวเก็บผลลง
-- v_log แล้ววิ่งต่อ ไม่มีตัวไหนกลืน exception ของทั้งบล็อก
--
-- Part 0 ติดตั้ง DDL ของ 0147 (ลอกจากไฟล์ migration คำต่อคำ ไม่มีการ
-- CREATE FUNCTION ใดๆ ในไฟล์นั้น จึงไม่ต้องห่อด้วย EXECUTE/dollar-quote ชั้น
-- ใน — เป็น revoke/grant statement ล้วนๆ) ในทรานแซกชันนี้เอง ⇒ ใช้เป็นทั้ง
-- dry-run (ก่อน apply จริง) และ post-apply verify (รันซ้ำหลัง apply)
-- พร้อมพิสูจน์ idempotency ด้วยการติดตั้งซ้ำรอบสองภายในบล็อกเดียวกัน
-- (0e/0f) แล้วเทียบ ACL ว่าเหมือนเดิมเป๊ะ
--
-- 🔴 สองโหมดนี้ให้ตัวเลขต่างกัน และ Part 0c ต้องรับได้ทั้งคู่: ก่อน apply
-- ACL ของ 7 ฟังก์ชันจะ "ขยับ" ทั้ง 7 ตัว แต่หลัง apply แล้วมันขยับไม่ได้อีก
-- (สะอาดอยู่แล้ว) ⇒ 0. ถ้าเขียนด่านเป็น `= 7` ตายตัว การรัน verify หลัง
-- apply จะ FAIL แบบหลอกๆ แล้วคนจะถูกสอนให้มองข้าม FAIL ซึ่งแพงกว่าบั๊กเดิม
-- จึงนับ v_pre_dirty (จำนวนตัวที่ "ยังสกปรก" ก่อนแตะอะไร) แล้วเทียบกับมัน
-- โดยบังคับ v_pre_dirty in (0, 7) — ค่าครึ่งๆ กลางๆ แปลว่ามีคน grant กลับมา
-- บางตัว ซึ่ง **ต้อง FAIL จริง** ห้ามปล่อยผ่าน
--
-- 🔴 หมายเหตุ dollar-quote (3j-migration-traps ข้อ 15): บล็อกเดียวในไฟล์นี้
-- ใช้ tag เฉพาะ v147 ไม่ใช่ tag ว่าง ⇒ ลำดับดอลลาร์คู่ในคอมเมนต์หรือข้อความ
-- ข้างในปิดบล็อกไม่ได้ ไม่ต้องมีข้อกำหนดเพิ่มเติมใดๆ กับเนื้อไฟล์
--
-- 🔴 บรีฟตั้งต้นสั่งให้ insert probe row ของ crm_audit_log ด้วย
-- action='zz147_probe' — ของจริงชนะบรีฟ: analytics.crm_audit_log มี CHECK
-- constraint (0021 -> 0023 -> 0116) จำกัด action ให้เป็นค่าที่กำหนดไว้
-- ล่วงหน้าเท่านั้น ('zz147_probe' ไม่อยู่ในนั้น จะโดน 23514 check_violation
-- ก่อนถึง trigger เลย ทำให้พิสูจน์อะไรไม่ได้) ⇒ ใช้ action='note_add' แทน
-- (ค่าที่อนุญาตมาตั้งแต่ 0021 ไม่เคยถูกถอดออกจาก whitelist ในทุก migration
-- ที่แก้ constraint นี้ต่อมา) แล้วทำเครื่องหมาย probe ผ่าน entity_type =
-- 'zz147_probe' แทน (คอลัมน์ text ธรรมดา ไม่มี CHECK คุม)
--
-- โครงสร้างไฟล์:
--   Part 0  — snapshot ACL ของทุกฟังก์ชันใน analytics + overload count ของ
--             7 ฟังก์ชันเป้าหมาย ก่อนแตะอะไร (0a) -> ติดตั้ง DDL 0147 ครั้ง
--             ที่ 1 (0b) -> ตรวจว่ามีแค่ 7 ฟังก์ชันเป้าหมายเท่านั้นที่ ACL
--             ขยับ ฟังก์ชันอื่นในสคีมาไม่ขยับแม้ตัวเดียว (0c, เคสห้ามผ่าน
--             #5) -> ตรวจ anon/authenticated/service_role/PUBLIC-ใน-ACL/
--             overload ของ 7 ฟังก์ชันเป้าหมายครบ (0d, เคสห้ามผ่าน #1-#4,#6)
--             -> ติดตั้ง DDL 0147 ซ้ำรอบสอง พิสูจน์ idempotent (0e) ->
--             เทียบ ACL ของ 7 ฟังก์ชันเป้าหมายหลังรอบสองต้องเหมือนรอบแรก
--             เป๊ะ (0f)
--   Part 1  — setup: shop สังเคราะห์ (ZZ147) + นับแถวตั้งต้นของ
--             crm_audit_log/crm_feature_flag (ใช้เทียบใน Part 5)
--   Part 2  — เคสห้ามผ่าน #7: crm_audit_log_append_only ยังทำงานจริงหลัง
--             revoke — revoke execute จาก service_role ชั่วคราว (role ที่
--             ไม่มี grant execute จริงๆ ต่างจากรันเป็น postgres เฉยๆ) ->
--             set local role service_role -> insert probe -> update ต้อง
--             raise ด้วยข้อความ "is append-only" ของฟังก์ชันเอง (ไม่ใช่
--             permission-denied ของระบบ) -> delete ต้อง raise เช่นกัน ->
--             reset role + grant คืน
--   Part 3  — เคสห้ามผ่าน #8: crm_feature_flag_touch ยังทำงานจริงหลัง
--             revoke — เทคนิคเดียวกับ Part 2 แต่ probe บังคับ updated_at
--             เป็นอดีต (now() - 1 วัน) ก่อน แล้ว update ต้องเห็น updated_at
--             ขยับมาเป็น now() ของทรานแซกชันจริง (ไม่ใช่แค่ "ไม่ null" —
--             กันเคส now() ในทรานแซกชันเดียวกันบังเอิญเท่าเดิม)
--   Part 4c — 🔴 เคสห้ามผ่าน #11 (เคสที่มีค่าที่สุดในไฟล์): จำลองว่ากำแพง
--             ชั้นนอกหลุด — grant usage on schema analytics ให้ authenticated
--             กลับเข้าไปจริงในทรานแซกชันนี้ แล้วพิสูจน์ว่ากำแพงชั้นที่สองที่
--             0147 วางไว้ยังกันได้ (ต้องตกที่ 42501 permission denied for
--             function) ไม่ใช่แค่ "อ่าน ACL แล้วเชื่อ" ตาม 3j-migration-traps
--             ข้อ 17 ในรูปแบบสิทธิ์: ของใหม่ต้องเจอของเก่า
--   Part 4  — เคสห้ามผ่าน #9: crm_overview_summary + oem_price_calc ยังเรียก
--             ได้ปกติในฐานะ service_role หลัง revoke — FAIL เฉพาะกรณี
--             permission-denied ระดับฟังก์ชัน/สคีมาเท่านั้น (error ทางธุรกิจ
--             ถือว่าผ่าน เพราะแปลว่าเข้าถึงตัวฟังก์ชันได้แล้ว) product_upsert/
--             shop_setting_upsert/oem_metal_price_set ไม่ยิงจริง (เขียน
--             ข้อมูล) — ใช้ has_function_privilege ใน Part 0d/0f แทนตามที่
--             บรีฟสั่ง
--   Part 5  — เคสไม่พัง #10: จำนวนแถวใน crm_audit_log/crm_feature_flag
--             เท่าเดิม+1 (เฉพาะแถว probe ที่รู้ตัวว่าใส่ไป) ไม่มีอะไรหายไป
--             หรือโผล่มาเกิน
--   Part 6  — เคสห้ามผ่าน #3 ซ้ำท้ายสุด: หลัง Part 2/3 ถอน+คืน grant
--             service_role ของ 2 trigger function ชั่วคราวไปแล้ว ยืนยันอีก
--             รอบว่า service_role มี execute ครบทั้ง 7 ตัวจริง (พิสูจน์ว่า
--             การคืน grant ใน Part 2/3 ได้ผลจริง ไม่ใช่แค่ไม่ error)

do $v147$
declare
  v_log text := E'\n=== verify 0147 (revoke legacy execute grants, 7 functions) ===\n';

  -- ----- ชื่อ/signature ของ 7 ฟังก์ชันเป้าหมาย (ลำดับเดียวกันทุก array) -----
  v_fn_sig text[] := array[
    'analytics.crm_audit_log_append_only()',
    'analytics.crm_feature_flag_touch()',
    'analytics.crm_overview_summary(uuid,date,date,text)',
    'analytics.oem_price_calc(uuid,jsonb)',
    'analytics.oem_metal_price_set(uuid,text,numeric,date,text)',
    'analytics.product_upsert(uuid,text,text,text,text,numeric,numeric,numeric,numeric,numeric,text,text,text,boolean)',
    'analytics.shop_setting_upsert(uuid,numeric,numeric,numeric)'
  ];
  v_fn_label text[] := array[
    'crm_audit_log_append_only', 'crm_feature_flag_touch', 'crm_overview_summary',
    'oem_price_calc', 'oem_metal_price_set', 'product_upsert', 'shop_setting_upsert'
  ];
  -- oid ของ 7 ตัว resolve ครั้งเดียวตอนต้น แล้วใช้แยกกลุ่ม "เป้าหมาย vs อื่น"
  -- ใน Part 0c — แยกด้วย oid ไม่ใช่ชื่อ เพราะชื่อจะจัดกลุ่มผิดทันทีถ้ามีวันที่
  -- เกิด overload ชื่อซ้ำ (ตอนนี้ยังไม่มี Part 0a/0d เช็คไว้แล้ว แต่ไม่ควรพึ่ง)
  v_fn_oid oid[];

  -- Part 0 scratch
  v_i               int;
  v_oid             oid;
  v_overload_before int[];      -- ต่อ index เดียวกับ v_fn_label
  v_overload_after  int;
  v_acl_after1      text[];     -- ACL ของ 7 ฟังก์ชัน หลังติดตั้ง DDL รอบ 1
  v_acl_after2      text;       -- ACL ของฟังก์ชันเดียว หลังติดตั้ง DDL รอบ 2 (scratch วนลูป)
  v_acl_scratch     text;       -- scratch อ่าน proacl ก่อนเก็บเข้า array (SELECT INTO ไม่รับ array element ตรงๆ)
  v_priv_anon       boolean;
  v_priv_auth       boolean;
  v_priv_svc        boolean;
  v_public_left     int;
  v_snapshot_total_before int;
  v_snapshot_total_after  int;
  v_changed_other   int;  -- จำนวนฟังก์ชัน "อื่น" (ไม่ใช่ 7 เป้าหมาย) ที่ ACL ขยับ — ต้อง 0
  v_target_changed  int;  -- จำนวนฟังก์ชันเป้าหมายที่ ACL ขยับจริงหลังรอบ 1
  v_pre_dirty       int;  -- จำนวนใน 7 ที่ "ยังสกปรก" ก่อนแตะอะไร (7=ก่อน apply, 0=หลัง apply) — ดูหัวไฟล์
  v_rerun_raised    boolean;
  v_rerun_msg       text;

  -- Part 1 setup
  v_shop uuid := gen_random_uuid();
  v_audit_count_before int;
  v_flag_count_before  int;
  v_audit_count_after  int;
  v_flag_count_after   int;

  -- Part 2/3 (trigger probe)
  v_probe_audit_id     uuid;
  v_flag_updated_before timestamptz;
  v_flag_updated_after  timestamptz;
  v_caught boolean;
  v_msg    text;   -- ข้อความ exception (แยกจาก v_code ที่เป็น sqlstate)
  v_code   text;   -- sqlstate ของ exception ล่าสุด
begin
  -----------------------------------------------------------------------
  -- Part 0a: snapshot ACL ของทุกฟังก์ชันใน analytics + overload count ของ
  -- 7 ฟังก์ชันเป้าหมาย ก่อนแตะอะไรเลย
  -----------------------------------------------------------------------
  create temp table zz147_acl_snapshot (
    oid oid primary key,
    proname text not null,
    acl text
  ) on commit drop;

  insert into zz147_acl_snapshot (oid, proname, acl)
  select oid, proname, proacl::text
  from pg_proc
  where pronamespace = 'analytics'::regnamespace;

  select count(*) into v_snapshot_total_before from zz147_acl_snapshot;

  v_overload_before := array_fill(0, array[7]);
  v_acl_after1      := array_fill(null::text, array[7]);
  v_fn_oid          := array_fill(null::oid, array[7]);
  for v_i in 1..7 loop
    v_overload_before[v_i] := (
      select count(*) from pg_proc
      where pronamespace = 'analytics'::regnamespace and proname = v_fn_label[v_i]
    );
    -- ::regprocedure จะ error ทันทีถ้า signature ไม่มีอยู่จริง = ด่านซ้อนอีกชั้น
    v_fn_oid[v_i] := v_fn_sig[v_i]::regprocedure;
  end loop;

  -- 🔴 นับว่าตอนเริ่มมีกี่ตัวใน 7 ที่ยังเปิดให้ anon/authenticated จริง
  -- (has_function_privilege จับสิทธิ์ที่มาทาง PUBLIC ด้วย ⇒ ครอบทั้งทาง A
  --  และทาง B ที่หัวไฟล์ 0147 อธิบายไว้) — ใช้เป็นค่าคาดหวังของ Part 0c
  --  แทนเลข 7 ตายตัว เพื่อให้รัน verify ได้ทั้งก่อนและหลัง apply
  select count(*) into v_pre_dirty
  from unnest(v_fn_oid) t(o)
  where has_function_privilege('anon', t.o, 'execute')
     or has_function_privilege('authenticated', t.o, 'execute');

  v_log := v_log || format('[Part 0a] snapshot ก่อนแตะอะไร: %s ฟังก์ชันในสคีมา analytics, overload ของ 7 ฟังก์ชันเป้าหมาย = %s (คาดทุกตัว = 1), ตัวที่ยังเปิดให้ anon/auth อยู่ = %s (7 = รันก่อน apply · 0 = รันหลัง apply แล้ว ทั้งคู่ถูกต้อง): %s' || E'\n',
    v_snapshot_total_before, v_overload_before, v_pre_dirty,
    case when v_overload_before = array_fill(1, array[7]) and v_pre_dirty in (0, 7)
      then 'OK'
      when v_overload_before <> array_fill(1, array[7])
      then 'FAIL — สมมติฐานเริ่มต้นผิด มี overload อยู่แล้วก่อน apply'
      else format('FAIL — สถานะครึ่งๆ กลางๆ (%s/7 ยังเปิดอยู่) แปลว่ามีคน grant กลับมาบางตัว ต้องสอบก่อน', v_pre_dirty) end);

  -----------------------------------------------------------------------
  -- Part 0b: ติดตั้ง DDL ของ 0147 รอบที่ 1 — ลอกจากไฟล์ migration คำต่อคำ
  -----------------------------------------------------------------------
  revoke execute on function analytics.crm_audit_log_append_only() from public, anon, authenticated;
  grant execute on function analytics.crm_audit_log_append_only() to service_role;

  revoke execute on function analytics.crm_feature_flag_touch() from public, anon, authenticated;
  grant execute on function analytics.crm_feature_flag_touch() to service_role;

  revoke execute on function analytics.crm_overview_summary(uuid, date, date, text) from public, anon, authenticated;
  grant execute on function analytics.crm_overview_summary(uuid, date, date, text) to service_role;

  revoke execute on function analytics.oem_price_calc(uuid, jsonb) from public, anon, authenticated;
  grant execute on function analytics.oem_price_calc(uuid, jsonb) to service_role;

  revoke execute on function analytics.oem_metal_price_set(uuid, text, numeric, date, text) from public, anon, authenticated;
  grant execute on function analytics.oem_metal_price_set(uuid, text, numeric, date, text) to service_role;

  revoke execute on function analytics.product_upsert(uuid, text, text, text, text, numeric, numeric, numeric, numeric, numeric, text, text, text, boolean) from public, anon, authenticated;
  grant execute on function analytics.product_upsert(uuid, text, text, text, text, numeric, numeric, numeric, numeric, numeric, text, text, text, boolean) to service_role;

  revoke execute on function analytics.shop_setting_upsert(uuid, numeric, numeric, numeric) from public, anon, authenticated;
  grant execute on function analytics.shop_setting_upsert(uuid, numeric, numeric, numeric) to service_role;

  v_log := v_log || '[Part 0b] ติดตั้ง DDL 0147 รอบที่ 1 (7 x revoke+grant): OK (no error)' || E'\n';

  -----------------------------------------------------------------------
  -- Part 0c: 🔴 เคสห้ามผ่าน #5 — ฟังก์ชันอื่นในสคีมา analytics ไม่ขยับแม้
  -- แถวเดียว (กัน "revoke เหวี่ยงแห") + เคสเสริม: 7 ฟังก์ชันเป้าหมาย ACL
  -- ต้องขยับจริงทุกตัว (พิสูจน์ว่า DDL ยิงโดนจริง ไม่ใช่ signature พิมพ์ผิด
  -- แล้ว no-op เงียบๆ)
  -----------------------------------------------------------------------
  select count(*) into v_changed_other
  from zz147_acl_snapshot s
  join pg_proc p on p.oid = s.oid
  where coalesce(p.proacl::text, '') <> coalesce(s.acl, '')
    and s.oid <> all (v_fn_oid);

  select count(*) into v_target_changed
  from zz147_acl_snapshot s
  join pg_proc p on p.oid = s.oid
  where coalesce(p.proacl::text, '') <> coalesce(s.acl, '')
    and s.oid = any (v_fn_oid);

  select count(*) into v_snapshot_total_after from pg_proc where pronamespace = 'analytics'::regnamespace;

  v_log := v_log || format('[Part 0c] 🔴 หลัง apply รอบ 1: ฟังก์ชัน "อื่น" ที่ ACL ขยับ=%s (คาด 0 — เคสห้ามผ่าน #5), ฟังก์ชันเป้าหมายที่ ACL ขยับจริง=%s (คาด %s = จำนวนที่สกปรกก่อนเริ่ม), จำนวนฟังก์ชันทั้งสคีมา %s -> %s (คาดเท่าเดิม ไม่มีการ drop/create แอบแฝง): %s' || E'\n',
    v_changed_other, v_target_changed, v_pre_dirty, v_snapshot_total_before, v_snapshot_total_after,
    case when v_changed_other = 0 and v_target_changed = v_pre_dirty and v_pre_dirty in (0, 7)
      and v_snapshot_total_before = v_snapshot_total_after
    then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 0d: เคสห้ามผ่าน #1-#4, #6 — ต่อฟังก์ชันเป้าหมายทั้ง 7 ตัว
  -----------------------------------------------------------------------
  for v_i in 1..7 loop
    v_oid := v_fn_sig[v_i]::regprocedure;

    select has_function_privilege('anon', v_oid, 'execute') into v_priv_anon;
    select has_function_privilege('authenticated', v_oid, 'execute') into v_priv_auth;
    select has_function_privilege('service_role', v_oid, 'execute') into v_priv_svc;
    select count(*) into v_public_left from pg_proc p, aclexplode(p.proacl) a where p.oid = v_oid and a.grantee = 0;
    select count(*) into v_overload_after from pg_proc where pronamespace = 'analytics'::regnamespace and proname = v_fn_label[v_i];
    select proacl::text into v_acl_scratch from pg_proc where oid = v_oid;
    v_acl_after1[v_i] := v_acl_scratch;

    v_log := v_log || format('[Part 0d-%s] %s :: anon=%s(คาด f) auth=%s(คาด f) svc=%s(คาด t) public_left=%s(คาด 0) overload=%s->%s(คาดเท่าเดิม): %s' || E'\n',
      v_i, v_fn_label[v_i], v_priv_anon, v_priv_auth, v_priv_svc, v_public_left,
      v_overload_before[v_i], v_overload_after,
      case when v_priv_anon = false and v_priv_auth = false and v_priv_svc = true
        and v_public_left = 0 and v_overload_after = v_overload_before[v_i]
      then 'OK' else 'FAIL' end);
  end loop;

  -----------------------------------------------------------------------
  -- Part 0e: ติดตั้ง DDL ของ 0147 ซ้ำรอบที่ 2 ในทรานแซกชันเดียวกัน —
  -- พิสูจน์ idempotency (ต้องไม่ error)
  -----------------------------------------------------------------------
  -- ไม่ copy-paste ข้อความจาก Part 0b ซ้ำอีก 20 บรรทัด: 0b ที่ลอกจาก
  -- migration คำต่อคำมีเหตุผล (เป็น dry-run ของข้อความจริง) แต่ 0e ไม่มี —
  -- และ copy-paste จะ drift ได้เงียบๆ (ถ้าวันหลังมีคนแก้ signature แล้ว
  -- อัปเดตแค่ 0b, Part 0f จะยัง PASS ทั้งที่ idempotency ของคำสั่งใหม่ไม่เคย
  -- ถูกทดสอบ) ⇒ ประกอบคำสั่งจาก v_fn_sig ซึ่งเป็นแหล่งความจริงเดียวในไฟล์นี้
  v_rerun_raised := false;
  v_rerun_msg := null;
  begin
    for v_i in 1..7 loop
      execute format('revoke execute on function %s from public, anon, authenticated', v_fn_sig[v_i]);
      execute format('grant execute on function %s to service_role', v_fn_sig[v_i]);
    end loop;
  exception when others then
    v_rerun_raised := true;
    v_rerun_msg := sqlerrm;
  end;

  v_log := v_log || format('[Part 0e] ติดตั้ง DDL 0147 รอบที่ 2 ในทรานแซกชันเดียวกัน: raise=%s (คาด false) message="%s": %s' || E'\n',
    v_rerun_raised, coalesce(v_rerun_msg, '(none)'),
    case when not v_rerun_raised then 'OK' else 'FAIL — ไม่ idempotent' end);

  -----------------------------------------------------------------------
  -- Part 0f: ACL ของ 7 ฟังก์ชันเป้าหมายหลังรอบ 2 ต้องเหมือนรอบ 1 เป๊ะ
  -----------------------------------------------------------------------
  for v_i in 1..7 loop
    v_oid := v_fn_sig[v_i]::regprocedure;
    select proacl::text into v_acl_after2 from pg_proc where oid = v_oid;

    v_log := v_log || format('[Part 0f-%s] %s :: ACL หลังรอบ 2 เหมือนรอบ 1 เป๊ะ ("%s" = "%s"): %s' || E'\n',
      v_i, v_fn_label[v_i], v_acl_after1[v_i], v_acl_after2,
      case when v_acl_after2 = v_acl_after1[v_i] then 'OK' else 'FAIL' end);
  end loop;

  -----------------------------------------------------------------------
  -- Part 1: setup shop สังเคราะห์ (ZZ147) + baseline row count ของ 2 ตาราง
  -- ที่จะถูกแตะใน Part 2/3 (ใช้เทียบใน Part 5)
  -----------------------------------------------------------------------
  insert into public.shop (id, name) values (v_shop, 'ZZ TEST verify-0147');

  select count(*) into v_audit_count_before from analytics.crm_audit_log;
  select count(*) into v_flag_count_before from analytics.crm_feature_flag;

  v_log := v_log || format('[Part 1] setup shop สังเคราะห์ 1 ร้าน (ZZ147), baseline: crm_audit_log=%s แถว, crm_feature_flag=%s แถว: OK' || E'\n',
    v_audit_count_before, v_flag_count_before);

  -----------------------------------------------------------------------
  -- Part 2 (เคสห้ามผ่าน #7): crm_audit_log_append_only ยังทำงานจริงหลัง
  -- revoke — revoke execute จาก service_role ชั่วคราว (role ที่ไม่มี grant
  -- execute จริงๆ ต่างจากรันเป็น postgres เฉยๆ ซึ่งพิสูจน์อะไรไม่ได้) แล้ว
  -- ยิง insert/update/delete ในฐานะ service_role จริง
  -----------------------------------------------------------------------
  revoke execute on function analytics.crm_audit_log_append_only() from service_role;
  select has_function_privilege('service_role', 'analytics.crm_audit_log_append_only()', 'execute') into v_priv_svc;
  v_log := v_log || format('[Part 2a] ถอน execute ของ crm_audit_log_append_only จาก service_role ชั่วคราว: %s (คาด false): %s' || E'\n',
    v_priv_svc, case when v_priv_svc = false then 'OK' else 'FAIL — revoke ไม่ติด' end);

  set local role service_role;

  -- action='note_add' (ค่าที่ CHECK constraint อนุญาต) + entity_type='zz147_probe' (ตัวทำเครื่องหมาย probe จริง — ดูหัวไฟล์)
  insert into analytics.crm_audit_log (shop_id, actor, action, entity_type, entity_id, before, after)
  values (v_shop, null, 'note_add', 'zz147_probe', null, null, null)
  returning id into v_probe_audit_id;

  v_caught := false; v_msg := null; v_code := null;
  begin
    update analytics.crm_audit_log set entity_type = 'zz147_probe_updated' where id = v_probe_audit_id;
  exception when others then
    v_caught := true; v_msg := sqlerrm; get stacked diagnostics v_code = returned_sqlstate;
  end;
  v_log := v_log || format('[Part 2b] 🔴 UPDATE แถว probe ในฐานะ service_role ที่ไม่มี execute grant บน trigger function เอง: raise=%s code=%s message="%s" (ต้อง raise จริงด้วยข้อความ "is append-only" ของฟังก์ชันเอง — ถ้าเป็น permission-denied ของระบบแทน แปลว่า Postgres เช็ค EXECUTE ตอน fire จริง ซึ่งขัดกับที่หัวไฟล์ 0147 อ้างไว้): %s' || E'\n',
    v_caught, coalesce(v_code, '(none)'), coalesce(v_msg, '(none)'),
    case when v_caught and v_msg ilike '%is append-only%' then 'OK' else 'FAIL' end);

  v_caught := false; v_msg := null; v_code := null;
  begin
    delete from analytics.crm_audit_log where id = v_probe_audit_id;
  exception when others then
    v_caught := true; v_msg := sqlerrm; get stacked diagnostics v_code = returned_sqlstate;
  end;
  v_log := v_log || format('[Part 2c] 🔴 DELETE แถว probe เช่นกัน: raise=%s code=%s message="%s": %s' || E'\n',
    v_caught, coalesce(v_code, '(none)'), coalesce(v_msg, '(none)'),
    case when v_caught and v_msg ilike '%is append-only%' then 'OK' else 'FAIL' end);

  reset role;
  grant execute on function analytics.crm_audit_log_append_only() to service_role;

  -----------------------------------------------------------------------
  -- Part 3 (เคสห้ามผ่าน #8): crm_feature_flag_touch ยังทำงานจริงหลัง
  -- revoke — เทคนิคเดียวกับ Part 2 แต่บังคับ updated_at ให้เป็นอดีตก่อน
  -- (กันกับดัก now() เท่าเดิมในทรานแซกชันเดียวกัน — ดูหัวไฟล์)
  -----------------------------------------------------------------------
  revoke execute on function analytics.crm_feature_flag_touch() from service_role;
  select has_function_privilege('service_role', 'analytics.crm_feature_flag_touch()', 'execute') into v_priv_svc;
  v_log := v_log || format('[Part 3a] ถอน execute ของ crm_feature_flag_touch จาก service_role ชั่วคราว: %s (คาด false): %s' || E'\n',
    v_priv_svc, case when v_priv_svc = false then 'OK' else 'FAIL — revoke ไม่ติด' end);

  set local role service_role;

  insert into analytics.crm_feature_flag (shop_id, flag, enabled, updated_at)
  values (v_shop, 'zz147_probe', false, now() - interval '1 day')
  returning updated_at into v_flag_updated_before;

  v_caught := false; v_msg := null; v_code := null;
  begin
    update analytics.crm_feature_flag set enabled = not enabled
      where shop_id = v_shop and flag = 'zz147_probe'
      returning updated_at into v_flag_updated_after;
  exception when others then
    v_caught := true; v_msg := sqlerrm; get stacked diagnostics v_code = returned_sqlstate;
  end;

  reset role;
  grant execute on function analytics.crm_feature_flag_touch() to service_role;

  v_log := v_log || format('[Part 3b] 🔴 UPDATE flag probe ในฐานะ service_role ที่ไม่มี execute grant บน trigger function เอง: raise=%s code=%s message="%s" (ต้องไม่ raise เลย) updated_at เดิม(บังคับอดีต)=%s ใหม่=%s (ต้องขยับมาเป็น now() ของทรานแซกชันจริง ไม่ใช่แค่ "ไม่ null" — ต้องต่างจากค่าเดิมและใหม่กว่า): %s' || E'\n',
    v_caught, coalesce(v_code, '(none)'), coalesce(v_msg, '(none)'),
    v_flag_updated_before, v_flag_updated_after,
    case when not v_caught and v_flag_updated_after is not null
      and v_flag_updated_after <> v_flag_updated_before
      and v_flag_updated_after > v_flag_updated_before
    then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 4 (เคสห้ามผ่าน #9): ฟังก์ชันอ่านที่แอปเรียกจริงผ่าน service role
  -- ยังเรียกได้ปกติหลัง revoke — FAIL เฉพาะกรณี permission-denied ระดับ
  -- ฟังก์ชัน/สคีมาเท่านั้น (error ทางธุรกิจถือว่าผ่าน เพราะแปลว่าเข้าถึงตัว
  -- ฟังก์ชันได้แล้ว) — แยกด้วยข้อความ ไม่ใช่แค่ sqlstate เพราะ
  -- crm_audit_log_append_only เองก็ raise ด้วย errcode 42501 เหมือนกัน แต่
  -- เป็นข้อความทางธุรกิจ ไม่ใช่ permission error ของระบบ (ดู Part 2)
  --
  -- product_upsert / shop_setting_upsert / oem_metal_price_set (เขียนข้อมูล)
  -- ไม่ยิงจริงตามที่บรีฟสั่ง — พิสูจน์ด้วย has_function_privilege ใน Part
  -- 0d/0f แทน
  -----------------------------------------------------------------------
  set local role service_role;

  v_caught := false; v_msg := null;
  begin
    perform analytics.crm_overview_summary(v_shop, null, null, null);
  exception when others then
    v_caught := true; v_msg := sqlerrm;
  end;
  v_log := v_log || format('[Part 4a] crm_overview_summary ในฐานะ service_role หลัง revoke: raise=%s message="%s": %s' || E'\n',
    v_caught, coalesce(v_msg, '(none — เรียกสำเร็จ)'),
    case when not v_caught or v_msg not ilike '%permission denied%'
    then 'OK' else 'FAIL — permission ถูก revoke เกิน' end);

  v_caught := false; v_msg := null;
  begin
    perform analytics.oem_price_calc(v_shop, jsonb_build_object('metal', 'silver999', 'bar_size', '1_baht', 'qty', 1));
  exception when others then
    v_caught := true; v_msg := sqlerrm;
  end;
  v_log := v_log || format('[Part 4b] oem_price_calc ในฐานะ service_role หลัง revoke: raise=%s message="%s" (error ทางธุรกิจ เช่น ไม่มีราคาเงินของวันนี้สำหรับ shop สังเคราะห์ ถือว่าผ่าน — เข้าถึงตัวฟังก์ชันได้แล้ว): %s' || E'\n',
    v_caught, coalesce(v_msg, '(none — เรียกสำเร็จ)'),
    case when not v_caught or v_msg not ilike '%permission denied%'
    then 'OK' else 'FAIL — permission ถูก revoke เกิน' end);

  reset role;

  -----------------------------------------------------------------------
  -- Part 4c (เคสห้ามผ่าน #11) 🔴 เคสที่มีค่าที่สุดในไฟล์นี้:
  -- จำลองสถานการณ์ที่ 0147 มีไว้เพื่อป้องกันโดยตรง — "วันที่กำแพงชั้นนอกหลุด"
  -- grant usage on schema analytics ให้ authenticated กลับเข้าไปจริง แล้ว
  -- พิสูจน์ว่ากำแพงชั้นที่สองยังกันได้ ไม่ใช่แค่อ่าน ACL แล้วเชื่อ (Part 0d
  -- อ่าน ACL อย่างเดียว ซึ่งไม่ได้พิสูจน์พฤติกรรมจริง)
  --
  -- ปลอดภัยเพราะ: (ก) grant/revoke คู่นี้อยู่ในทรานแซกชันที่ raise ปิดท้าย
  -- เสมอ ⇒ rollback ทั้งคู่ (ข) พารามิเตอร์ null ล้วนไม่มีทางเขียนอะไรลง DB
  -- เพราะ Postgres เช็ค EXECUTE privilege **ก่อน** body รัน ⇒ ตกที่ด่าน
  -- permission เสมอ ไม่เคยเข้าไปถึงเนื้อฟังก์ชัน (ตรงกับข้อห้าม "ห้ามยิง RPC
  -- ที่เขียนข้อมูลจริง")
  -----------------------------------------------------------------------
  grant usage on schema analytics to authenticated;
  set local role authenticated;

  v_caught := false; v_msg := null; v_code := null;
  begin
    perform analytics.crm_overview_summary(v_shop, null, null, null);
  exception when others then
    v_caught := true; v_msg := sqlerrm; get stacked diagnostics v_code = returned_sqlstate;
  end;

  reset role;

  v_log := v_log || format('[Part 4c-1] 🔴 authenticated เรียก crm_overview_summary หลัง grant usage on schema กลับเข้าไป: raise=%s code=%s message="%s" (ต้อง 42501 + "permission denied for function" — ถ้าเรียกผ่าน แปลว่า 0147 ไม่ได้กันอะไรเลย): %s' || E'\n',
    v_caught, coalesce(v_code, '(none)'), coalesce(v_msg, '(none — เรียกผ่าน!)'),
    case when v_caught and v_code = '42501' and v_msg ilike '%permission denied for function%'
    then 'OK' else 'FAIL — กำแพงชั้นที่สองไม่ทำงาน' end);

  set local role authenticated;

  v_caught := false; v_msg := null; v_code := null;
  begin
    perform analytics.product_upsert(
      null::uuid, null::text, null::text, null::text, null::text,
      null::numeric, null::numeric, null::numeric, null::numeric, null::numeric,
      null::text, null::text, null::text, null::boolean);
  exception when others then
    v_caught := true; v_msg := sqlerrm; get stacked diagnostics v_code = returned_sqlstate;
  end;

  reset role;
  revoke usage on schema analytics from authenticated;

  v_log := v_log || format('[Part 4c-2] 🔴 authenticated เรียก product_upsert (SECURITY DEFINER เขียนแคตตาล็อก) หลัง grant usage on schema กลับเข้าไป: raise=%s code=%s message="%s" (ต้อง 42501 + "permission denied for function"): %s' || E'\n',
    v_caught, coalesce(v_code, '(none)'), coalesce(v_msg, '(none — เรียกผ่าน!)'),
    case when v_caught and v_code = '42501' and v_msg ilike '%permission denied for function%'
    then 'OK' else 'FAIL — กำแพงชั้นที่สองไม่ทำงาน' end);

  -- ยืนยันว่าคืนสถานะกำแพงชั้นนอกแล้วจริง (ไม่ได้เชื่อว่า revoke ข้างบนติด)
  v_log := v_log || format('[Part 4c-3] คืนสถานะ: has_schema_privilege(authenticated, analytics, usage) = %s (คาด false): %s' || E'\n',
    has_schema_privilege('authenticated', 'analytics', 'usage'),
    case when has_schema_privilege('authenticated', 'analytics', 'usage') = false
    then 'OK' else 'FAIL — usage ค้าง (ยังปลอดภัยเพราะ rollback แต่แปลว่าเทสต์เขียนผิด)' end);

  -----------------------------------------------------------------------
  -- Part 5 (เคสไม่พัง #10): จำนวนแถวใน crm_audit_log/crm_feature_flag
  -- เท่าเดิม+1 ตารางละ 1 แถว (เฉพาะ probe ที่รู้ตัวว่าใส่ไปใน Part 2/3 —
  -- audit_log: insert 1 สำเร็จ, update/delete ถูกบล็อกไม่ทำให้จำนวนแถวขยับ;
  -- feature_flag: insert 1 สำเร็จ, update แก้ enabled/updated_at ไม่เพิ่ม
  -- จำนวนแถว)
  -----------------------------------------------------------------------
  select count(*) into v_audit_count_after from analytics.crm_audit_log;
  select count(*) into v_flag_count_after from analytics.crm_feature_flag;

  v_log := v_log || format('[Part 5] แถวก่อน/หลัง: crm_audit_log %s -> %s (คาด +1 จาก probe) · crm_feature_flag %s -> %s (คาด +1 จาก probe): %s' || E'\n',
    v_audit_count_before, v_audit_count_after, v_flag_count_before, v_flag_count_after,
    case when v_audit_count_after = v_audit_count_before + 1 and v_flag_count_after = v_flag_count_before + 1 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 6: เคสห้ามผ่าน #3 ซ้ำท้ายสุด — หลัง Part 2/3 ถอน+คืน grant
  -- service_role ของ 2 trigger function ชั่วคราวไปแล้ว ยืนยันอีกรอบว่า
  -- service_role มี execute ครบทั้ง 7 ตัวจริง (พิสูจน์ว่าการคืน grant ใน
  -- Part 2/3 ได้ผลจริง ไม่ใช่แค่ไม่ error ตอน grant)
  -----------------------------------------------------------------------
  for v_i in 1..7 loop
    v_oid := v_fn_sig[v_i]::regprocedure;
    select has_function_privilege('service_role', v_oid, 'execute') into v_priv_svc;
    v_log := v_log || format('[Part 6-%s] %s :: service_role execute หลังคืน grant ครบทุกจุดแล้ว = %s (คาด true): %s' || E'\n',
      v_i, v_fn_label[v_i], v_priv_svc, case when v_priv_svc = true then 'OK' else 'FAIL — grant คืนไม่ครบ' end);
  end loop;

  v_log := v_log || E'\n=== ALL CHECKS LOGGED ABOVE — ตรวจทุกบรรทัดหา FAIL (transaction จะ rollback เสมอ) ===\n';
  raise exception '%', v_log;
end $v147$;
