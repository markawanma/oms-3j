-- scripts/verify/verify-0165.sql
-- ตรวจ supabase/migrations/0165_oem_override_hardening.sql หลัง apply (หรือต่อท้ายไฟล์ 0165 ใน dry-run เดียว)
-- self-rolling-back do-block (3j-migration-traps ข้อ 11): แตะตัวนับเลขที่ใบเสนอราคา (oem_quote_save) + ตาราง audit ⇒ ทุกเคสเก็บผลลง v_log
-- แล้ว raise exception ปิดท้ายเสมอ ⇒ ทั้งทรานแซกชัน rollback · ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน · [SKIP] = พิสูจน์ไม่ได้
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0165.sql
-- dry-run ก่อน apply: cat supabase/migrations/0165_*.sql scripts/verify/verify-0165.sql > tmp.sql แล้วรันไม่ใส่ --commit
-- ⚠️ ก่อน/หลังรัน: count(*) oem_quote / oem_quote_item / oem_quote_audit + oem_doc_counter + md5 oem_quote ทั้งตาราง ต้องเท่ากัน
--
-- ============ ตารางแมป "เคสในบรีฟ → assertion" ============
--  ห้ามผ่าน (ด่าน = analytics.oem_customer_text_clean ผ่าน oem_quote_save และ oem_quote_set_customer ทั้งคู่):
--     ชื่อมี U+202E / U+061C / U+2028 / U+E0100 / C1(U+0085) + ชุดเต็ม 40 code point → H1 (save · ทุกตัว) · H2 (set_customer · ทุกตัว)
--     ช่องทางติดต่อมีอักขระล่องหน (ทั้งสองทาง) → H3 · ZWJ ติดอักษร/ต้นท้าย → H4 · ยาว 201 → H5
--     เหตุผลราคาพิเศษ U+2060 ล้วน / U+FEFF ล้วน / RLO ล้วน / ผสมล้วน → L2a-d (calc ปฏิเสธ 22023 + save ปฏิเสธ)
--     authenticated / anon เรียก 5 ฟังก์ชัน → 42501 · audit แก้/ลบ/ล้างไม่ได้ (postgres → trigger 42501 · service_role → permission denied) → A5-A9
--     ⚠️ "client ส่ง actor ปลอม" = ชั้น server action (vitest lib/actions/oem-hardening.test.ts) — ฝั่ง DB ที่ครอบได้คือ p_actor_id ที่ไม่มีใน
--        auth.users ต้องไม่ถูกเขียนลง updated_by (→ M2e)
--  ต้องไม่พัง: ชื่อไทย/อังกฤษ/อีโมจิ ZWJ ครอบครัว/VS16/ธงรุ้ง ผ่านทั้งสองทาง → H6 · NBSP/ช่องว่างกว้างล้วน = null (ไม่ใช่ชื่อล่องหน) → H7 ·
--     200 พอดีผ่าน → H8 · updated_by/created_by/approved_by ไม่ null เมื่อส่ง p_actor_id (save + set_customer) → M2a-d ·
--     เรียกแบบไม่ส่ง p_actor_id (9/10 args, set_customer 4 args) ยังใช้ได้ = พฤติกรรมเดิม null → M2f-h ·
--     set_customer แตะแค่ 2 คอลัมน์ + updated_* (md5 แถว/items/ตัวนับเดิม) → M3 · audit เก็บค่าเก่า→ใหม่ · ไม่เปลี่ยน = ไม่เพิ่มแถว → A1-A4
--     golden replay oem_price_calc เท่า legacy (อยู่ใน migration — legacy ถูก drop แล้วหลัง apply) + ที่นี่: เหตุผลปกติ/ว่าง/ไม่มี override ผลเดิม → L2e-h
--  ⚠️ ที่เทสต์ครอบไม่ได้: PostgREST จริง (probe แยกหลัง apply) · session จริงของ server action (vitest ครอบด้วย mock)

create function pg_temp.chk(p_id text, p_desc text, p_ok boolean) returns text
 language sql as $c$
  select format('[%s] %s  %s', case when coalesce(p_ok, false) then 'OK' else 'FAIL' end, p_id, p_desc) || E'\n'
$c$;

create function pg_temp.t_set(p_shop uuid, p_quote uuid, p_name text, p_contact text, p_actor uuid default null) returns text
 language plpgsql as $c$
declare v_state text;
begin
  perform analytics.oem_quote_set_customer(p_shop, p_quote, p_name, p_contact, p_actor);
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  return 'ERR:' || v_state || ':' || sqlerrm;
end;
$c$;

create function pg_temp.t_save(p_shop uuid, p_items jsonb, p_status text, p_name text, p_contact text,
                               p_actor uuid default null, p_quote uuid default null, p_bar_date date default null) returns text
 language plpgsql as $c$
declare v_state text; v_id uuid;
begin
  v_id := analytics.oem_quote_save(
    p_shop_id => p_shop, p_items => p_items, p_quote_id => p_quote, p_status => p_status,
    p_approval_note => 'verify-note', p_customer_name => p_name, p_customer_contact => p_contact,
    p_discount_thb => 0, p_discount_reason => null, p_bar_valid_until => p_bar_date, p_actor_id => p_actor);
  return 'OK:' || v_id::text;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  return 'ERR:' || v_state || ':' || sqlerrm;
end;
$c$;

create function pg_temp.t_calc(p_shop uuid, p_input jsonb) returns text
 language plpgsql as $c$
declare v_state text;
begin
  perform analytics.oem_price_calc(p_shop, p_input);
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  return 'ERR:' || v_state || ':' || sqlerrm;
end;
$c$;

create function pg_temp.bar_item(p_ovr text default null, p_reason text default null) returns jsonb
 language sql as $c$
  select jsonb_build_object('input',
    jsonb_build_object('metal', 'silver999', 'bar_size', '1_baht', 'qty', 1)
    || case when p_ovr is not null then jsonb_build_object('bar_price_override_thb', p_ovr::numeric) else '{}'::jsonb end
    || case when p_reason is not null then jsonb_build_object('bar_price_override_reason', p_reason) else '{}'::jsonb end)
$c$;

create function pg_temp.bar_input(p_ovr text, p_reason text) returns jsonb
 language sql as $c$
  select jsonb_build_object('metal', 'silver999', 'bar_size', '1_baht', 'qty', 1)
    || case when p_ovr is not null then jsonb_build_object('bar_price_override_thb', p_ovr) else '{}'::jsonb end
    || case when p_reason is not null then jsonb_build_object('bar_price_override_reason', p_reason) else '{}'::jsonb end
$c$;

create function pg_temp.row_md5(p_quote uuid) returns text
 language sql as $c$
  select md5((to_jsonb(q) - 'customer_name' - 'customer_contact' - 'updated_by' - 'updated_at')::text)
  from analytics.oem_quote q where q.id = p_quote
$c$;

create function pg_temp.items_md5(p_quote uuid) returns text
 language sql as $c$
  select coalesce(md5(string_agg(to_jsonb(i)::text, '|' order by i.seq)), 'none')
  from analytics.oem_quote_item i where i.quote_id = p_quote
$c$;

create function pg_temp.counter_sig() returns text
 language sql as $c$
  select coalesce(string_agg(to_jsonb(c)::text, '|' order by to_jsonb(c)::text), 'none') from analytics.oem_doc_counter c
$c$;

do $v165$
declare
  v_log text := E'\n=== verify 0165 (oem override hardening) ===\n';
  v_shop uuid;
  v_actor uuid;
  v_fake uuid := gen_random_uuid();
  v_q uuid;
  v_qd uuid;
  v_r text;
  v_r2 text;
  v_row analytics.oem_quote%rowtype;
  v_cnt int;
  v_cnt2 int;
  v_i int;
  v_bad int;
  v_bad2 int;
  v_ch text;
  v_cp int;
  v_before text;
  v_after text;
  v_items_before text;
  v_items_after text;
  v_ctr_before text;
  v_ctr_after text;
  v_c jsonb;
  v_role text;
  v_fn text;
  v_state text;
  v_msg text;
  v_fail int;
  v_audit analytics.oem_quote_audit%rowtype;
  v_name text;
  v_names text[];
  -- ชุด code point ที่ต้องถูกปฏิเสธ — ตรงกับตารางใน lib/oem/display-customer-text.test.ts
  v_reject int[] := array[
    x'00AD'::int, x'034F'::int, x'061C'::int, x'115F'::int, x'1160'::int, x'17B4'::int, x'17B5'::int, x'180E'::int,
    x'200B'::int, x'200C'::int, x'200E'::int, x'200F'::int, x'2028'::int, x'2029'::int, x'202A'::int, x'202B'::int,
    x'202C'::int, x'202D'::int, x'202E'::int, x'2060'::int, x'2062'::int, x'2066'::int, x'2067'::int, x'2068'::int,
    x'2069'::int, x'206A'::int, x'206F'::int, x'3164'::int, x'FEFF'::int, x'FFA0'::int, x'1BCA0'::int, x'1BCA3'::int,
    x'E0100'::int, x'E01EF'::int, x'0085'::int, x'009F'::int, x'007F'::int, x'0001'::int, x'000A'::int, x'0009'::int
  ];
  v_zwj text := chr(x'200D'::int);
  v_family text;
  v_item jsonb := jsonb_build_array(jsonb_build_object('input',
    jsonb_build_object('metal', 'silver999', 'bar_size', '1_baht', 'qty', 1)));
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_family := chr(x'1F468'::int) || v_zwj || chr(x'1F469'::int) || v_zwj || chr(x'1F467'::int);

  select count(*) into v_cnt from public.shop;
  if v_cnt <> 1 then
    raise exception 'verify-0165 หยุด: public.shop มี % ร้าน (ไฟล์นี้ออกแบบสำหรับร้านเดียว)', v_cnt;
  end if;
  select id into v_shop from public.shop;
  select id into v_actor from auth.users order by created_at limit 1;

  -- ราคาแท่งวันนี้ (fixture สมมติ ถอยกลับตอนท้าย)
  insert into analytics.silver_price_daily (
    shop_id, as_of_date, sheet_time, sell_per_baht, buy_per_baht,
    bar_0_5_baht, bar_1_baht, bar_3_baht, bar_5_baht, bar_10_baht, kilo_sell, kilo_sell_vat, kilo_buy, source, captured_at
  ) values (
    v_shop, (now() at time zone 'Asia/Bangkok')::date, 'fixture', null, 750, 500, 1000, 3000, 5000, 10000, null, 100000, 75000, 'manual', now()
  ) on conflict (shop_id, as_of_date) do update set
    buy_per_baht = excluded.buy_per_baht, bar_0_5_baht = excluded.bar_0_5_baht, bar_1_baht = excluded.bar_1_baht,
    bar_3_baht = excluded.bar_3_baht, bar_5_baht = excluded.bar_5_baht, bar_10_baht = excluded.bar_10_baht,
    kilo_sell_vat = excluded.kilo_sell_vat, kilo_buy = excluded.kilo_buy, source = excluded.source;

  -- ========================================================================
  -- S: โครงสร้าง / สิทธิ์
  -- ========================================================================
  select count(*) into v_cnt from pg_proc where pronamespace = 'analytics'::regnamespace
    and proname in ('oem_price_calc', 'oem_quote_save', 'oem_quote_set_customer', 'oem_text_strip_invisible', 'oem_customer_text_clean');
  v_log := v_log || pg_temp.chk('S1', format('5 ฟังก์ชัน = 5 แถวใน pg_proc (ไม่มี overload) ได้ %s', v_cnt), v_cnt = 5);
  select count(*) into v_cnt from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'oem_price_calc_legacy';
  v_log := v_log || pg_temp.chk('S2', 'oem_price_calc_legacy ถูก drop แล้ว', v_cnt = 0);
  select count(*) into v_cnt from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'oem_quote_save'
    and pronargs = 11 and 'p_actor_id' = any (proargnames) and 'p_bar_valid_until' = any (proargnames);
  select count(*) into v_cnt2 from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'oem_quote_set_customer'
    and pronargs = 5 and 'p_actor_id' = any (proargnames);
  v_log := v_log || pg_temp.chk('S3', 'oem_quote_save 11-arg (p_bar_valid_until + p_actor_id) · oem_quote_set_customer 5-arg (p_actor_id)', v_cnt = 1 and v_cnt2 = 1);
  select count(*) into v_cnt
    from pg_proc p cross join lateral aclexplode(p.proacl) a
    where p.pronamespace = 'analytics'::regnamespace
      and p.proname in ('oem_price_calc', 'oem_quote_save', 'oem_quote_set_customer', 'oem_text_strip_invisible', 'oem_customer_text_clean', 'oem_quote_audit_append_only')
      and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  v_log := v_log || pg_temp.chk('S4', format('ไม่มี PUBLIC/anon/authenticated EXECUTE บนฟังก์ชันที่แตะ (พบ %s)', v_cnt), v_cnt = 0);
  select count(*) into v_cnt
    from pg_proc p cross join lateral aclexplode(p.proacl) a
    where p.pronamespace = 'analytics'::regnamespace
      and p.proname in ('oem_price_calc', 'oem_quote_save', 'oem_quote_set_customer', 'oem_text_strip_invisible', 'oem_customer_text_clean')
      and a.privilege_type = 'EXECUTE' and a.grantee = 'service_role'::regrole;
  v_log := v_log || pg_temp.chk('S5', format('service_role มี EXECUTE ครบ 5 ฟังก์ชัน (พบ %s)', v_cnt), v_cnt = 5);

  -- ========================================================================
  -- H1/H2: ชุด code point ที่ห้ามผ่าน — ทั้ง oem_quote_save (ชื่อ) และ oem_quote_set_customer (ชื่อ)
  -- ========================================================================
  v_q := analytics.oem_quote_save(p_shop_id => v_shop, p_items => v_item, p_quote_id => null, p_status => 'quoted',
           p_approval_note => 'verify-note', p_customer_name => 'ตั้งต้น', p_customer_contact => 'c0',
           p_discount_thb => 0, p_discount_reason => null);
  v_bad := 0; v_bad2 := 0; v_names := array[]::text[];
  foreach v_cp in array v_reject loop
    v_ch := chr(v_cp);
    v_r := pg_temp.t_save(v_shop, v_item, 'draft', 'a' || v_ch || 'b', null);
    v_r2 := pg_temp.t_set(v_shop, v_q, 'a' || v_ch || 'b', null);
    if v_r not like 'ERR:22023:%' then v_bad := v_bad + 1; v_names := v_names || ('save U+' || to_hex(v_cp)); end if;
    if v_r2 not like 'ERR:22023:%' then v_bad2 := v_bad2 + 1; v_names := v_names || ('set_customer U+' || to_hex(v_cp)); end if;
  end loop;
  v_log := v_log || pg_temp.chk('H1', format('oem_quote_save: ชื่อมีอักขระล่องหน/bidi/control ทั้ง %s code point → 22023 ทุกตัว (หลุด %s %s)', array_length(v_reject, 1), v_bad, v_names), v_bad = 0);
  v_log := v_log || pg_temp.chk('H2', format('oem_quote_set_customer: เช่นเดียวกัน (หลุด %s)', v_bad2), v_bad2 = 0);
  -- ตัวเด่นที่บรีฟระบุ แยกให้อ่านง่ายใน log
  v_log := v_log || pg_temp.chk('H1b', 'U+202E / U+061C / U+2028 / U+E0100 / C1 ผ่าน save ไม่ได้ (รายตัว)',
    pg_temp.t_save(v_shop, v_item, 'draft', 'a' || chr(x'202E'::int), null) like 'ERR:22023:%'
    and pg_temp.t_save(v_shop, v_item, 'draft', 'a' || chr(x'061C'::int), null) like 'ERR:22023:%'
    and pg_temp.t_save(v_shop, v_item, 'draft', 'a' || chr(x'2028'::int), null) like 'ERR:22023:%'
    and pg_temp.t_save(v_shop, v_item, 'draft', 'a' || chr(x'E0100'::int), null) like 'ERR:22023:%'
    and pg_temp.t_save(v_shop, v_item, 'draft', 'a' || chr(x'0085'::int), null) like 'ERR:22023:%');
  select * into v_row from analytics.oem_quote where id = v_q;
  v_log := v_log || pg_temp.chk('H1c', 'หลังปฏิเสธทั้งหมด ชื่อ/ช่องทางของใบตั้งต้นยังเป็นค่าเดิม', v_row.customer_name = 'ตั้งต้น' and v_row.customer_contact = 'c0');
  select count(*) into v_cnt from analytics.oem_quote where customer_name like 'a%b' and customer_name <> 'ตั้งต้น';
  v_log := v_log || pg_temp.chk('H1d', 'ไม่มีใบที่ชื่อ a?b หลุดเข้าตาราง (ปฏิเสธแล้ว rollback ทั้งใบ)', v_cnt = 0);

  -- H3: ช่องทางติดต่อ
  v_bad := 0; v_bad2 := 0;
  foreach v_cp in array v_reject loop
    v_ch := chr(v_cp);
    if pg_temp.t_save(v_shop, v_item, 'draft', null, 'x' || v_ch || 'y') not like 'ERR:22023:%' then v_bad := v_bad + 1; end if;
    if pg_temp.t_set(v_shop, v_q, null, 'x' || v_ch || 'y') not like 'ERR:22023:%' then v_bad2 := v_bad2 + 1; end if;
  end loop;
  v_log := v_log || pg_temp.chk('H3', format('ช่องทางติดต่อ: ทุก code point → 22023 ทั้ง save (หลุด %s) และ set_customer (หลุด %s)', v_bad, v_bad2), v_bad = 0 and v_bad2 = 0);

  -- H4: ZWJ
  v_log := v_log || pg_temp.chk('H4a', 'ZWJ ติดอักษรไทย (ก ZWJ ข) ปฏิเสธทั้งสองทาง',
    pg_temp.t_save(v_shop, v_item, 'draft', 'ก' || v_zwj || 'ข', null) like 'ERR:22023:%'
    and pg_temp.t_set(v_shop, v_q, 'ก' || v_zwj || 'ข', null) like 'ERR:22023:%');
  v_log := v_log || pg_temp.chk('H4b', 'ZWJ ต้นข้อความ / ท้ายข้อความ / ติดอีโมจิด้านเดียว ปฏิเสธ',
    pg_temp.t_set(v_shop, v_q, v_zwj || chr(x'1F469'::int), null) like 'ERR:22023:%'
    and pg_temp.t_set(v_shop, v_q, chr(x'1F469'::int) || v_zwj, null) like 'ERR:22023:%'
    and pg_temp.t_set(v_shop, v_q, chr(x'1F469'::int) || v_zwj || 'ก', null) like 'ERR:22023:%');
  v_r := pg_temp.t_set(v_shop, v_q, repeat('ก', 201), null);
  v_log := v_log || pg_temp.chk('H5', '201 ตัวอักษร → 22023 ยาวเกินไป', v_r like 'ERR:22023:%ยาวเกินไป%');

  -- ========================================================================
  -- H6-H8: ต้องไม่พัง
  -- ========================================================================
  v_bad := 0;
  foreach v_name in array array[
    'บริษัท ทดสอบ จำกัด', 'ABC Trading Co., Ltd.', 'ครอบครัว ' || v_family,
    'รัก ' || chr(x'2764'::int) || chr(x'FE0F'::int) || ' ร้าน',
    chr(x'1F3F3'::int) || chr(x'FE0F'::int) || v_zwj || chr(x'1F308'::int),
    chr(x'1F3C3'::int) || v_zwj || chr(x'2640'::int) || chr(x'FE0F'::int),
    'José O''Brien "ABC" & Co.', '山田商店', 'ร้านนี้ผู้ใหญ่ ก๊าซ ไม้เอก ให้ ใจ'] loop
    if pg_temp.t_save(v_shop, v_item, 'draft', v_name, null) not like 'OK:%' then v_bad := v_bad + 1; end if;
    if pg_temp.t_set(v_shop, v_q, v_name, null) <> 'OK' then v_bad := v_bad + 1; end if;
  end loop;
  v_log := v_log || pg_temp.chk('H6', format('ชื่อไทย/อังกฤษ/จีน/อีโมจิ ZWJ ครอบครัว/ธงรุ้ง/อาชีพ/VS16/อัญประกาศ ผ่านทั้ง save และ set_customer (หลุดปฏิเสธ %s)', v_bad), v_bad = 0);
  perform pg_temp.t_set(v_shop, v_q, 'ครอบครัว ' || v_family, null);
  select * into v_row from analytics.oem_quote where id = v_q;
  v_log := v_log || pg_temp.chk('H6b', 'ZWJ ครบตามที่ส่ง (ค่าที่เก็บไม่ถูกตัด)', v_row.customer_name = 'ครอบครัว ' || v_family);

  perform pg_temp.t_set(v_shop, v_q, E'\u00A0\u3000 ', E'\u2003');
  select * into v_row from analytics.oem_quote where id = v_q;
  v_log := v_log || pg_temp.chk('H7', 'NBSP/ideographic/em-space ล้วน = null (ล้างค่า ไม่ใช่ "ชื่อล่องหน")', v_row.customer_name is null and v_row.customer_contact is null);
  v_r := pg_temp.t_set(v_shop, v_q, repeat('ก', 200), repeat('x', 200));
  v_log := v_log || pg_temp.chk('H8', '200 ตัวอักษรพอดีผ่าน', v_r = 'OK');
  v_r := pg_temp.t_save(v_shop, v_item, 'draft', null, null);
  v_log := v_log || pg_temp.chk('H9', 'save ไม่ส่งชื่อ (null) ยังทำงานเหมือนเดิม', v_r like 'OK:%');
  -- save draft ซ้ำบนใบเดิม ส่ง null = คงค่าเดิม (coalesce) · ส่งค่าใหม่ = ทับ
  v_qd := substr(v_r, 4)::uuid;
  perform pg_temp.t_set(v_shop, v_qd, 'ชื่อจาก set', 'ติดต่อจาก set');
  v_r := pg_temp.t_save(v_shop, v_item, 'draft', null, null, null, v_qd);
  select * into v_row from analytics.oem_quote where id = v_qd;
  v_log := v_log || pg_temp.chk('H10', 'save draft ส่ง null → คงค่าที่ set_customer ตั้ง (coalesce เดิม)', v_r like 'OK:%' and v_row.customer_name = 'ชื่อจาก set' and v_row.customer_contact = 'ติดต่อจาก set');
  v_r := pg_temp.t_save(v_shop, v_item, 'draft', '  ชื่อจาก save  ', null, null, v_qd);
  select * into v_row from analytics.oem_quote where id = v_qd;
  v_log := v_log || pg_temp.chk('H11', 'save draft ส่งชื่อใหม่ (มีช่องว่างหัวท้าย) → ทับและ trim แล้ว · contact null คงเดิม', v_row.customer_name = 'ชื่อจาก save' and v_row.customer_contact = 'ติดต่อจาก set');

  -- ========================================================================
  -- L2: เหตุผลราคาพิเศษ
  -- ========================================================================
  v_log := v_log || pg_temp.chk('L2a', 'เหตุผล U+2060 ล้วน → calc ปฏิเสธ 22023', pg_temp.t_calc(v_shop, pg_temp.bar_input('1100', chr(x'2060'::int) || chr(x'2060'::int))) like 'ERR:22023:%');
  v_log := v_log || pg_temp.chk('L2b', 'เหตุผล U+FEFF ล้วน → calc ปฏิเสธ 22023', pg_temp.t_calc(v_shop, pg_temp.bar_input('1100', chr(x'FEFF'::int))) like 'ERR:22023:%');
  v_log := v_log || pg_temp.chk('L2c', 'เหตุผล RLO ล้วน / zero-width + เว้นวรรค → calc ปฏิเสธ 22023',
    pg_temp.t_calc(v_shop, pg_temp.bar_input('1100', chr(x'202E'::int))) like 'ERR:22023:%'
    and pg_temp.t_calc(v_shop, pg_temp.bar_input('1100', ' ' || chr(x'200B'::int) || ' ' || chr(x'200C'::int))) like 'ERR:22023:%');
  v_r := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1100', chr(x'2060'::int))), 'draft', null, null);
  v_r2 := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1100', chr(x'FEFF'::int))), 'quoted', null, null, null, null, (now() at time zone 'Asia/Bangkok')::date + 5);
  v_log := v_log || pg_temp.chk('L2d', 'save (draft และ quoted) ด้วยเหตุผลล่องหนล้วน → ปฏิเสธ (ไม่มีใบหลุดเข้าตาราง)', v_r like 'ERR:22023:%' and v_r2 like 'ERR:22023:%');
  v_c := analytics.oem_price_calc(v_shop, pg_temp.bar_input('1100', 'bid' || chr(x'202E'::int) || ' ลูกค้า' || chr(x'2060'::int) || ' A'));
  v_log := v_log || pg_temp.chk('L2e', 'เหตุผลปกติที่ฝังอักขระล่องหน → เก็บแบบถูกลบแล้ว ("bid ลูกค้า A") ไม่ raise',
    v_c->'breakdown'->'bar'->'override'->>'reason' = 'bid ลูกค้า A');
  v_c := analytics.oem_price_calc(v_shop, pg_temp.bar_input('1100', 'งานครอบครัว ' || v_family));
  v_log := v_log || pg_temp.chk('L2f', 'เหตุผลมีอีโมจิ ZWJ ครอบครัว → ZWJ ที่คั่นจริงอยู่ครบ', v_c->'breakdown'->'bar'->'override'->>'reason' = 'งานครอบครัว ' || v_family);
  v_c := analytics.oem_price_calc(v_shop, pg_temp.bar_input('1100', E'  bid ทดสอบ A \u00A0'));
  v_log := v_log || pg_temp.chk('L2g', 'เหตุผลปกติที่มีช่องว่าง/NBSP หัวท้าย → trim ตามเดิม', v_c->'breakdown'->'bar'->'override'->>'reason' = 'bid ทดสอบ A');
  v_log := v_log || pg_temp.chk('L2h', 'ไม่มี override ผลเดิม (ไม่มี key override) · override ปกติ complete + floors.bar_price pass',
    not (analytics.oem_price_calc(v_shop, pg_temp.bar_input(null, null))->'breakdown'->'bar' ? 'override')
    and (v_c->>'is_complete')::boolean and (v_c->'floors'->'bar_price'->>'pass')::boolean);
  v_log := v_log || pg_temp.chk('L2i', 'เหตุผลลอย (ไม่มี override) ยัง raise เหมือน 0163',
    pg_temp.t_calc(v_shop, pg_temp.bar_input(null, 'ลอย')) like 'ERR:22023:%');
  v_log := v_log || pg_temp.chk('L2j', 'เหตุผลล่องหนล้วนแต่ไม่มี override = ไม่มีเหตุผลลอย → ผ่านเหมือนไม่ส่ง (ต้องไม่พัง)',
    pg_temp.t_calc(v_shop, pg_temp.bar_input(null, chr(x'2060'::int))) = 'OK');

  -- ========================================================================
  -- M2: ผู้บันทึก
  -- ========================================================================
  if v_actor is null then
    v_log := v_log || '[SKIP] M2a-e ไม่มีผู้ใช้ใน auth.users ให้ใช้เป็น actor' || E'\n';
  else
    v_r := pg_temp.t_save(v_shop, v_item, 'quoted', 'ผู้บันทึก', null, v_actor);
    v_q := substr(v_r, 4)::uuid;
    select * into v_row from analytics.oem_quote where id = v_q;
    v_log := v_log || pg_temp.chk('M2a', 'save ใบใหม่ + p_actor_id → created_by = updated_by = actor · approved_by = actor (มี approval_note)',
      v_r like 'OK:%' and v_row.created_by = v_actor and v_row.updated_by = v_actor and v_row.approved_by = v_actor);
    v_r := pg_temp.t_save(v_shop, v_item, 'draft', 'ร่าง', null, v_actor);
    v_qd := substr(v_r, 4)::uuid;
    v_r := pg_temp.t_save(v_shop, v_item, 'draft', 'ร่างแก้', null, v_actor, v_qd);
    select * into v_row from analytics.oem_quote where id = v_qd;
    v_log := v_log || pg_temp.chk('M2b', 'save draft ซ้ำ + p_actor_id → updated_by = actor', v_r like 'OK:%' and v_row.updated_by = v_actor);

    -- set_customer ผ่าน actor + audit
    select count(*) into v_cnt from analytics.oem_quote_audit where quote_id = v_q;
    v_before := pg_temp.row_md5(v_q); v_items_before := pg_temp.items_md5(v_q); v_ctr_before := pg_temp.counter_sig();
    update analytics.oem_quote set updated_by = null where id = v_q;
    v_r := pg_temp.t_set(v_shop, v_q, 'ชื่อใหม่', 'ติดต่อใหม่', v_actor);
    select * into v_row from analytics.oem_quote where id = v_q;
    v_after := pg_temp.row_md5(v_q); v_items_after := pg_temp.items_md5(v_q); v_ctr_after := pg_temp.counter_sig();
    v_log := v_log || pg_temp.chk('M2c', 'set_customer + p_actor_id → updated_by = actor (หลังตั้ง null ก่อน เพื่อพิสูจน์ว่าเขียนจริง)', v_r = 'OK' and v_row.updated_by = v_actor);
    v_log := v_log || pg_temp.chk('M3', 'set_customer แตะแค่ customer_name/contact/updated_* : md5 แถว (ยกเว้น 4 คอลัมน์) · items · ตัวนับเอกสาร เท่าเดิม',
      v_before = v_after and v_items_before = v_items_after and v_ctr_before = v_ctr_after);
    select * into v_audit from analytics.oem_quote_audit where quote_id = v_q and after->>'customer_name' = 'ชื่อใหม่';
    select count(*) into v_cnt2 from analytics.oem_quote_audit where quote_id = v_q;
    v_log := v_log || pg_temp.chk('A1', 'แก้ที่ค่าเปลี่ยน → audit เพิ่ม 1 แถว: actor · action customer_edit · before=ค่าเก่า after=ค่าใหม่',
      v_cnt2 = v_cnt + 1 and v_audit.actor = v_actor and v_audit.action = 'customer_edit' and v_audit.shop_id = v_shop
      and v_audit.before->>'customer_name' = 'ผู้บันทึก' and v_audit.after->>'customer_name' = 'ชื่อใหม่'
      and v_audit.after->>'customer_contact' = 'ติดต่อใหม่' and jsonb_typeof(v_audit.before->'customer_contact') = 'null');
    v_r := pg_temp.t_set(v_shop, v_q, 'ชื่อใหม่', 'ติดต่อใหม่', v_actor);
    select count(*) into v_cnt from analytics.oem_quote_audit where quote_id = v_q;
    v_log := v_log || pg_temp.chk('A2', 'ส่งค่าเดิมซ้ำ (ไม่เปลี่ยน) → ไม่เพิ่มแถว audit', v_r = 'OK' and v_cnt = v_cnt2);
    v_r := pg_temp.t_set(v_shop, v_q, E'a\u202Eb', 'x', v_actor);
    select count(*) into v_cnt from analytics.oem_quote_audit where quote_id = v_q;
    v_log := v_log || pg_temp.chk('A3', 'แก้ไม่ผ่านด่าน → ไม่มีแถว audit เพิ่ม', v_r like 'ERR:22023:%' and v_cnt = v_cnt2);
    v_r := pg_temp.t_set(v_shop, v_q, null, null, v_actor);
    select * into v_audit from analytics.oem_quote_audit where quote_id = v_q and after->>'customer_name' is null;
    v_log := v_log || pg_temp.chk('A4', 'ล้างเป็น null → audit เก็บ after = null ทั้งคู่ (JSON null) และ before = ค่าก่อนหน้า',
      v_r = 'OK' and jsonb_typeof(v_audit.after->'customer_name') = 'null' and v_audit.before->>'customer_name' = 'ชื่อใหม่');
  end if;

  -- M2e: actor ที่ไม่มีใน auth.users (id ปลอม/ผู้ใช้ถูกลบ) → ไม่ล้ม และไม่เขียนค่าปลอมลง updated_by/created_by
  v_r := pg_temp.t_save(v_shop, v_item, 'draft', 'actor ปลอม', null, v_fake);
  if v_r like 'OK:%' then
    select * into v_row from analytics.oem_quote where id = substr(v_r, 4)::uuid;
    v_log := v_log || pg_temp.chk('M2e', 'p_actor_id ที่ไม่มีใน auth.users → บันทึกได้ แต่ created_by/updated_by = null (ไม่เขียน id ปลอม ไม่ชน FK)', v_row.created_by is null and v_row.updated_by is null);
  else
    v_log := v_log || pg_temp.chk('M2e', 'actor ปลอมทำให้ save ล้ม: ' || left(v_r, 120), false);
  end if;
  -- M2f-h: เรียกแบบเดิม (ไม่ส่ง p_actor_id) ใช้ได้ = พฤติกรรมเดิม (null)
  v_q := analytics.oem_quote_save(
    p_shop_id => v_shop, p_items => v_item, p_quote_id => null, p_status => 'quoted', p_approval_note => 'verify-note',
    p_customer_name => 'แบบ 9 args', p_customer_contact => null, p_discount_thb => 0, p_discount_reason => null);
  select * into v_row from analytics.oem_quote where id = v_q;
  v_log := v_log || pg_temp.chk('M2f', 'เรียก 9 named args (แอปเก่า) สำเร็จ · updated_by = null เหมือนเดิม · ชื่อถูกเก็บ', v_row.customer_name = 'แบบ 9 args' and v_row.updated_by is null);
  v_qd := analytics.oem_quote_save(
    p_shop_id => v_shop, p_items => v_item, p_quote_id => null, p_status => 'draft', p_approval_note => null,
    p_customer_name => null, p_customer_contact => null, p_discount_thb => 0, p_discount_reason => null, p_bar_valid_until => null);
  v_log := v_log || pg_temp.chk('M2g', 'เรียก 10 named args (แอปบน prod ปัจจุบัน — มี p_bar_valid_until ไม่มี p_actor_id) สำเร็จ', v_qd is not null);
  perform analytics.oem_quote_set_customer(p_shop_id => v_shop, p_quote_id => v_q, p_customer_name => 'แบบ 4 args', p_customer_contact => 'c');
  select * into v_row from analytics.oem_quote where id = v_q;
  select * into v_audit from analytics.oem_quote_audit where quote_id = v_q and after->>'customer_name' = 'แบบ 4 args';
  v_log := v_log || pg_temp.chk('M2h', 'set_customer 4 named args (แอปบน prod ปัจจุบัน) สำเร็จ · updated_by = null · audit actor = null',
    v_row.customer_name = 'แบบ 4 args' and v_row.updated_by is null and v_audit.actor is null and v_audit.after->>'customer_name' = 'แบบ 4 args');

  -- ========================================================================
  -- A: audit append-only + สิทธิ์
  -- ========================================================================
  select count(*) into v_cnt from pg_trigger where tgrelid = 'analytics.oem_quote_audit'::regclass and not tgisinternal;
  v_log := v_log || pg_temp.chk('A5', format('oem_quote_audit มี trigger append-only 2 ตัว (row update/delete + truncate) พบ %s', v_cnt), v_cnt = 2);
  v_log := v_log || pg_temp.chk('A5b', 'RLS เปิดบน oem_quote_audit', (select relrowsecurity from pg_class where oid = 'analytics.oem_quote_audit'::regclass));
  select * into v_audit from analytics.oem_quote_audit limit 1;
  -- postgres (เจ้าของ) ก็แก้ไม่ได้: trigger
  v_state := null; begin update analytics.oem_quote_audit set action = 'customer_edit' where id = v_audit.id; exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  v_log := v_log || pg_temp.chk('A6a', 'UPDATE (เจ้าของตาราง) → 42501 จาก trigger', v_state = '42501');
  v_state := null; begin delete from analytics.oem_quote_audit where id = v_audit.id; exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  v_log := v_log || pg_temp.chk('A6b', 'DELETE (เจ้าของตาราง) → 42501 จาก trigger', v_state = '42501');
  v_state := null; begin truncate analytics.oem_quote_audit; exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  v_log := v_log || pg_temp.chk('A6c', 'TRUNCATE (เจ้าของตาราง) → 42501 จาก trigger', v_state = '42501');
  -- service_role: ไม่มีสิทธิ์ update/delete/truncate เลย (ชั้นที่สอง) แต่ select/insert ได้
  v_log := v_log || pg_temp.chk('A7', 'service_role: มี select+insert · ไม่มี update/delete/truncate',
    has_table_privilege('service_role', 'analytics.oem_quote_audit', 'select') and has_table_privilege('service_role', 'analytics.oem_quote_audit', 'insert')
    and not has_table_privilege('service_role', 'analytics.oem_quote_audit', 'update') and not has_table_privilege('service_role', 'analytics.oem_quote_audit', 'delete')
    and not has_table_privilege('service_role', 'analytics.oem_quote_audit', 'truncate'));
  foreach v_role in array array['service_role'] loop
    v_state := null; execute format('set local role %I', v_role);
    begin update analytics.oem_quote_audit set action = 'customer_edit' where id = v_audit.id; exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
    reset role;
    v_log := v_log || pg_temp.chk('A8a', 'service_role UPDATE → 42501 permission denied', v_state = '42501');
    v_state := null; execute format('set local role %I', v_role);
    begin delete from analytics.oem_quote_audit where id = v_audit.id; exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
    reset role;
    v_log := v_log || pg_temp.chk('A8b', 'service_role DELETE → 42501 permission denied', v_state = '42501');
    v_state := null; execute format('set local role %I', v_role);
    begin truncate analytics.oem_quote_audit; exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
    reset role;
    v_log := v_log || pg_temp.chk('A8c', 'service_role TRUNCATE → 42501 permission denied', v_state = '42501');
  end loop;
  grant usage on schema analytics to authenticated;
  grant usage on schema analytics to anon;
  foreach v_role in array array['authenticated', 'anon'] loop
    v_state := null; execute format('set local role %I', v_role);
    begin perform count(*) from analytics.oem_quote_audit; exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
    reset role;
    v_log := v_log || pg_temp.chk('A9/' || v_role, format('%s อ่าน oem_quote_audit → 42501', v_role), v_state = '42501');
  end loop;

  -- ========================================================================
  -- R: authenticated / anon เรียก 5 ฟังก์ชัน → 42501 (พารามิเตอร์ null ล้วน — Postgres เช็ค EXECUTE ก่อน body)
  -- ========================================================================
  foreach v_role in array array['authenticated', 'anon'] loop
    foreach v_fn in array array['calc', 'save', 'setcust', 'strip', 'clean'] loop
      v_state := null; v_msg := null;
      execute format('set local role %I', v_role);
      begin
        if v_fn = 'calc' then perform analytics.oem_price_calc(null::uuid, null::jsonb);
        elsif v_fn = 'save' then
          perform analytics.oem_quote_save(null::uuid, null::jsonb, null::uuid, null::text, null::text, null::text, null::text, null::numeric, null::text, null::date, null::uuid);
        elsif v_fn = 'setcust' then perform analytics.oem_quote_set_customer(null::uuid, null::uuid, null::text, null::text, null::uuid);
        elsif v_fn = 'strip' then perform analytics.oem_text_strip_invisible(null::text);
        else perform analytics.oem_customer_text_clean(null::text, null::text);
        end if;
      exception when others then
        get stacked diagnostics v_state = returned_sqlstate;
        v_msg := sqlerrm;
      end;
      reset role;
      v_log := v_log || pg_temp.chk('R/' || v_role || '/' || v_fn, format('%s เรียก %s → 42501 permission denied for function (ได้ %s)', v_role, v_fn, coalesce(v_state, '(เรียกผ่าน!)')),
        v_state = '42501' and v_msg ilike '%permission denied for function%');
    end loop;
  end loop;
  revoke usage on schema analytics from authenticated;
  revoke usage on schema analytics from anon;

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_log := v_log || format(E'\n--- สรุป: OK %s · FAIL %s · SKIP %s ---\n',
    (length(v_log) - length(replace(v_log, '[OK]', ''))) / 4, v_fail, (length(v_log) - length(replace(v_log, '[SKIP]', ''))) / 6);
  raise exception '%', v_log;
end
$v165$;
