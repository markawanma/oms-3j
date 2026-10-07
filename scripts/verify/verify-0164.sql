-- scripts/verify/verify-0164.sql
-- ตรวจ supabase/migrations/0164_oem_quote_set_customer.sql หลัง apply (หรือต่อท้ายไฟล์ 0164 ใน dry-run เดียว)
-- self-rolling-back do-block (3j-migration-traps ข้อ 11): แตะตัวนับเลขที่ใบเสนอราคา (oem_quote_save) ⇒ ทุกเคสเก็บผลลง v_log แล้ว
-- raise exception ปิดท้ายเสมอ ⇒ ทั้งทรานแซกชัน rollback · ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0164.sql
-- dry-run ก่อน apply: cat supabase/migrations/0164_*.sql scripts/verify/verify-0164.sql > tmp.sql แล้วรันไม่ใส่ --commit
-- ⚠️ ก่อน/หลังรัน: count(*) oem_quote / oem_quote_item + oem_doc_counter.last_no + md5 ของ oem_quote ทั้งตาราง ต้องเท่ากัน
--
-- ============ ตารางแมป "เคส → assertion" ============
--  ห้ามผ่าน: ใบ lost / rejected / superseded → B1-B3 (+ แถวไม่ขยับ B4) · ร้านอื่น (ใบร้าน A ส่ง shop B) → B5 ·
--           ไม่มีใบ → B6 · p_shop/p_quote null → B7 · ยาว 201 → B8 · ขึ้นบรรทัดใหม่/tab/control → B9a-c ·
--           bidi RLO/zero-width/BOM → B10a-d · ชื่อว่างแต่ contact ผิด → B11 (ปฏิเสธทั้งคู่ ไม่เขียนครึ่งเดียว)
--           authenticated / anon → 42501 (หลัง grant usage on schema กลับเข้าไป) → R1-R2
--  แตะแค่ 2 คอลัมน์: md5 ทั้งแถว oem_quote (ยกเว้น customer_name/customer_contact/updated_by/updated_at) + md5 items +
--           ตัวนับเอกสาร ก่อน/หลัง เท่าเดิม ทุกสถานะที่แก้ได้ → M1-M4
--  ต้องไม่พัง: quoted แก้ได้จริง · draft · won · expired · ล้างเป็น null · trim · 200 ตัวอักษรพอดี · ภาษาไทย/ตัวอักษรผสม ·
--           oem_quote_save draft หลัง set_customer ยังทำงานเหมือนเดิม (coalesce เก็บค่าเดิมเมื่อส่ง null · ส่งค่าใหม่ทับได้) ·
--           v_oem_quote (ที่หน้าพิมพ์อ่าน) เห็นค่าใหม่ → P1
--  ⚠️ ที่เทสต์ครอบไม่ได้: PostgREST จริง (probe แยก) · หน้าพิมพ์จริง (vitest ครอบ fallback ที่ฝั่ง TS)

create function pg_temp.chk(p_id text, p_desc text, p_ok boolean) returns text
 language sql as $c$
  select format('[%s] %s  %s', case when coalesce(p_ok, false) then 'OK' else 'FAIL' end, p_id, p_desc) || E'\n'
$c$;

create function pg_temp.t_set(p_shop uuid, p_quote uuid, p_name text, p_contact text) returns text
 language plpgsql as $c$
declare v_state text;
begin
  perform analytics.oem_quote_set_customer(p_shop, p_quote, p_name, p_contact);
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  return 'ERR:' || v_state || ':' || sqlerrm;
end;
$c$;

-- md5 ทั้งแถว oem_quote ยกเว้น 4 คอลัมน์ที่ RPC ตั้งใจแตะ
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

do $v164$
declare
  v_log text := E'\n=== verify 0164 (oem_quote_set_customer) ===\n';
  v_shop uuid;
  v_shopB uuid;
  v_q uuid;
  v_qd uuid;
  v_qs text;
  v_r text;
  v_row analytics.oem_quote%rowtype;
  v_before text;
  v_after text;
  v_items_before text;
  v_items_after text;
  v_ctr_before text;
  v_ctr_after text;
  v_cnt int;
  v_st text;
  v_ok boolean;
  v_role text;
  v_state text;
  v_msg text;
  v_fail int;
  v_item jsonb := jsonb_build_array(jsonb_build_object('input',
    jsonb_build_object('metal', 'silver999', 'bar_size', '1_baht', 'qty', 1)));
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  select count(*) into v_cnt from public.shop;
  if v_cnt <> 1 then
    raise exception 'verify-0164 หยุด: public.shop มี % ร้าน (ไฟล์นี้ออกแบบสำหรับร้านเดียว)', v_cnt;
  end if;
  select id into v_shop from public.shop;
  insert into public.shop (name) values ('verify-0164 shop B') returning id into v_shopB;

  -- ราคาแท่งวันนี้ต้องมีถึงจะ save quoted ได้ — วางแถว fixture ในทรานแซกชันนี้ (ถอยกลับ)
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
  select count(*) into v_cnt from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'oem_quote_set_customer';
  v_log := v_log || pg_temp.chk('S1', format('oem_quote_set_customer = 1 แถวใน pg_proc (ไม่มี overload) ได้ %s', v_cnt), v_cnt = 1);
  select count(*) into v_cnt
    from pg_proc p cross join lateral aclexplode(p.proacl) a
    where p.proname = 'oem_quote_set_customer' and p.pronamespace = 'analytics'::regnamespace and a.privilege_type = 'EXECUTE'
      and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  v_log := v_log || pg_temp.chk('S2', format('ไม่มี PUBLIC/anon/authenticated EXECUTE (พบ %s)', v_cnt), v_cnt = 0);
  v_log := v_log || pg_temp.chk('S3', 'service_role มี EXECUTE', has_function_privilege('service_role', 'analytics.oem_quote_set_customer(uuid,uuid,text,text,uuid)', 'execute'));
  select count(*) into v_cnt from pg_trigger where tgrelid = 'analytics.oem_quote'::regclass and not tgisinternal;
  v_log := v_log || pg_temp.chk('S4', format('oem_quote ยังไม่มี trigger (สมมติฐานของ 0164 ว่าไม่มี immutable guard ให้ยกเว้น) พบ %s', v_cnt), v_cnt = 0);

  -- ========================================================================
  -- ตั้งต้น: ใบ quoted (ว่างทั้งคู่ = เคส OEM-2610-003) + draft
  -- ========================================================================
  v_q := analytics.oem_quote_save(p_shop_id => v_shop, p_items => v_item, p_quote_id => null, p_status => 'quoted',
           p_approval_note => 'verify-note', p_customer_name => null, p_customer_contact => null,
           p_discount_thb => 0, p_discount_reason => null);
  v_qd := analytics.oem_quote_save(p_shop_id => v_shop, p_items => v_item, p_quote_id => null, p_status => 'draft',
           p_approval_note => null, p_customer_name => 'ร่างเดิม', p_customer_contact => 'LINE เดิม',
           p_discount_thb => 0, p_discount_reason => null);
  select * into v_row from analytics.oem_quote where id = v_q;
  v_log := v_log || pg_temp.chk('0', 'ตั้งต้น: ใบ quoted ว่างทั้งคู่ (เหมือน OEM-2610-003)', v_row.status = 'quoted' and v_row.customer_name is null and v_row.customer_contact is null);

  -- ========================================================================
  -- ต้องไม่พัง: quoted แก้ได้จริง + แตะแค่ 2 คอลัมน์ (M1)
  -- ========================================================================
  v_before := pg_temp.row_md5(v_q); v_items_before := pg_temp.items_md5(v_q); v_ctr_before := pg_temp.counter_sig();
  v_r := pg_temp.t_set(v_shop, v_q, '  บริษัท ทดสอบ จำกัด  ', '  LINE: @test  ');
  select * into v_row from analytics.oem_quote where id = v_q;
  v_after := pg_temp.row_md5(v_q); v_items_after := pg_temp.items_md5(v_q); v_ctr_after := pg_temp.counter_sig();
  v_log := v_log || pg_temp.chk('Q1', format('ใบ quoted เติมชื่อ+ช่องทางได้ (trim แล้ว) : %s', left(v_r, 80)),
    v_r = 'OK' and v_row.customer_name = 'บริษัท ทดสอบ จำกัด' and v_row.customer_contact = 'LINE: @test' and v_row.status = 'quoted');
  v_log := v_log || pg_temp.chk('M1', 'แตะแค่ 2 คอลัมน์: md5 ทั้งแถว (ยกเว้น customer_name/contact/updated_by/updated_at) เท่าเดิม · items เท่าเดิม · ตัวนับเอกสารเท่าเดิม',
    v_before = v_after and v_items_before = v_items_after and v_ctr_before = v_ctr_after);
  v_log := v_log || pg_temp.chk('M1b', 'updated_at ถูกตั้งเป็นเวลาทรานแซกชันนี้ (ข้อ 22: now() คงที่ — เทียบกับ now() ไม่ใช่ "ใหม่กว่าเดิม")', v_row.updated_at = now());

  -- แก้ซ้ำ (ใบ quoted ที่มีค่าแล้ว) + ล้างเป็น null
  v_r := pg_temp.t_set(v_shop, v_q, 'ชื่อใหม่ Co., Ltd.', null);
  select * into v_row from analytics.oem_quote where id = v_q;
  v_log := v_log || pg_temp.chk('Q2', 'แก้ซ้ำได้ · ส่ง contact null = ล้างเป็น null (ไม่ใช่คงค่าเดิม)', v_r = 'OK' and v_row.customer_name = 'ชื่อใหม่ Co., Ltd.' and v_row.customer_contact is null);
  v_r := pg_temp.t_set(v_shop, v_q, '   ', '');
  select * into v_row from analytics.oem_quote where id = v_q;
  v_log := v_log || pg_temp.chk('Q3', 'ส่งว่าง/เว้นวรรคล้วนทั้งคู่ = ล้างเป็น null ทั้งคู่', v_r = 'OK' and v_row.customer_name is null and v_row.customer_contact is null);

  -- ขอบความยาว 200 พอดี ผ่าน
  v_r := pg_temp.t_set(v_shop, v_q, repeat('ก', 200), repeat('x', 200));
  select * into v_row from analytics.oem_quote where id = v_q;
  v_log := v_log || pg_temp.chk('Q4', '200 ตัวอักษรพอดีทั้งสองช่อง ผ่าน', v_r = 'OK' and length(v_row.customer_name) = 200 and length(v_row.customer_contact) = 200);
  v_r := pg_temp.t_set(v_shop, v_q, 'ลูกค้า 山田 José O''Brien "ABC" & Co. <x>', '081-234-5678 / line:@a_b');
  v_log := v_log || pg_temp.chk('Q5', 'ตัวอักษรผสม (ไทย/จีน/สำเนียง/อัญประกาศ/เครื่องหมาย) ผ่าน — ไม่กรองเกินจำเป็น', v_r = 'OK');

  -- draft / won / expired
  v_r := pg_temp.t_set(v_shop, v_qd, 'ร่างแก้แล้ว', 'โทร 0800000000');
  select * into v_row from analytics.oem_quote where id = v_qd;
  v_log := v_log || pg_temp.chk('Q6', 'ใบ draft แก้ได้', v_r = 'OK' and v_row.customer_name = 'ร่างแก้แล้ว' and v_row.status = 'draft');
  foreach v_st in array array['won', 'expired'] loop
    update analytics.oem_quote set status = v_st where id = v_q;
    v_before := pg_temp.row_md5(v_q);
    v_r := pg_temp.t_set(v_shop, v_q, 'แก้ตอน ' || v_st, 'c');
    select * into v_row from analytics.oem_quote where id = v_q;
    v_log := v_log || pg_temp.chk('Q7/' || v_st, format('ใบสถานะ %s แก้ได้ · สถานะไม่ขยับ · แถวอื่นไม่ขยับ', v_st),
      v_r = 'OK' and v_row.customer_name = 'แก้ตอน ' || v_st and v_row.status = v_st and pg_temp.row_md5(v_q) = v_before);
  end loop;
  update analytics.oem_quote set status = 'quoted' where id = v_q;

  -- ========================================================================
  -- B: ห้ามผ่าน
  -- ========================================================================
  update analytics.oem_quote set customer_name = 'ก่อนปิด', customer_contact = 'c0' where id = v_q;
  foreach v_st in array array['lost', 'rejected', 'superseded'] loop
    update analytics.oem_quote set status = v_st where id = v_q;
    v_before := pg_temp.row_md5(v_q);
    v_r := pg_temp.t_set(v_shop, v_q, 'แอบแก้', 'แอบแก้');
    select * into v_row from analytics.oem_quote where id = v_q;
    v_log := v_log || pg_temp.chk('B/' || v_st, format('ใบ %s → raise 22023 · ชื่อเดิมไม่ขยับ (%s)', v_st, left(v_r, 70)),
      v_r like 'ERR:22023:%ปิด/ยกเลิก%' and v_row.customer_name = 'ก่อนปิด' and v_row.customer_contact = 'c0' and pg_temp.row_md5(v_q) = v_before);
  end loop;
  update analytics.oem_quote set status = 'quoted' where id = v_q;

  v_r := pg_temp.t_set(v_shopB, v_q, 'ข้ามร้าน', 'x');
  select * into v_row from analytics.oem_quote where id = v_q;
  v_log := v_log || pg_temp.chk('B5', 'ใบร้าน A เรียกด้วย shop B → not found · ชื่อไม่ขยับ', v_r like 'ERR:%not found for this shop%' and v_row.customer_name = 'ก่อนปิด');
  v_r := pg_temp.t_set(v_shop, gen_random_uuid(), 'x', 'x');
  v_log := v_log || pg_temp.chk('B6', 'ไม่มีใบนี้ → not found', v_r like 'ERR:%not found for this shop%');
  v_r := pg_temp.t_set(null, v_q, 'x', 'x');
  v_log := v_log || pg_temp.chk('B7a', 'p_shop_id null → raise', v_r like 'ERR:%are required%');
  v_r := pg_temp.t_set(v_shop, null, 'x', 'x');
  v_log := v_log || pg_temp.chk('B7b', 'p_quote_id null → raise', v_r like 'ERR:%are required%');

  v_r := pg_temp.t_set(v_shop, v_q, repeat('ก', 201), 'x');
  v_log := v_log || pg_temp.chk('B8a', '201 ตัวอักษร (ชื่อ) → raise 22023', v_r like 'ERR:22023:%ยาวเกินไป%');
  v_r := pg_temp.t_set(v_shop, v_q, 'x', repeat('ก', 201));
  v_log := v_log || pg_temp.chk('B8b', '201 ตัวอักษร (ช่องทางติดต่อ) → raise 22023', v_r like 'ERR:22023:%ยาวเกินไป%');

  v_r := pg_temp.t_set(v_shop, v_q, E'บรรทัด1\nบรรทัด2', 'x');
  v_log := v_log || pg_temp.chk('B9a', 'ชื่อมี newline → raise 22023', v_r like 'ERR:22023:%');
  v_r := pg_temp.t_set(v_shop, v_q, 'x', E'a\tb');
  v_log := v_log || pg_temp.chk('B9b', 'ช่องทางติดต่อมี tab → raise 22023', v_r like 'ERR:22023:%');
  v_r := pg_temp.t_set(v_shop, v_q, E'ab\x01cd', 'x');
  v_log := v_log || pg_temp.chk('B9c', 'ชื่อมี control char (0x01) → raise 22023', v_r like 'ERR:22023:%');
  v_r := pg_temp.t_set(v_shop, v_q, E'a\tb', 'x');
  v_log := v_log || pg_temp.chk('B9d', 'ชื่อมี tab กลางข้อความ → raise', v_r like 'ERR:22023:%');

  v_r := pg_temp.t_set(v_shop, v_q, E'ชื่อ\u202Eปลอม', 'x');
  v_log := v_log || pg_temp.chk('B10a', 'ชื่อมี RLO (U+202E) → raise 22023', v_r like 'ERR:22023:%');
  v_r := pg_temp.t_set(v_shop, v_q, E'ชื่อ\u200Bลับ', 'x');
  v_log := v_log || pg_temp.chk('B10b', 'ชื่อมี zero-width space (U+200B) → raise 22023', v_r like 'ERR:22023:%');
  v_r := pg_temp.t_set(v_shop, v_q, 'x', E'\uFEFFline');
  v_log := v_log || pg_temp.chk('B10c', 'ช่องทางติดต่อมี BOM (U+FEFF) → raise 22023', v_r like 'ERR:22023:%');
  v_r := pg_temp.t_set(v_shop, v_q, 'x', E'a\u2066b');
  v_log := v_log || pg_temp.chk('B10d', 'ช่องทางติดต่อมี isolate (U+2066) → raise 22023', v_r like 'ERR:22023:%');

  select * into v_row from analytics.oem_quote where id = v_q;
  v_before := pg_temp.row_md5(v_q);
  v_r := pg_temp.t_set(v_shop, v_q, 'ชื่อดี', E'ผิด\nอีก');
  select * into v_row from analytics.oem_quote where id = v_q;
  v_log := v_log || pg_temp.chk('B11', 'ชื่อดีแต่ช่องทางผิด → ปฏิเสธทั้งคู่ ชื่อไม่ถูกเขียนครึ่งเดียว', v_r like 'ERR:22023:%' and v_row.customer_name = 'ก่อนปิด');

  -- ========================================================================
  -- M: ทุกเคสปฏิเสธข้างบนไม่ทำให้แถว/ตัวนับขยับ (ตรวจรวม)
  -- ========================================================================
  v_log := v_log || pg_temp.chk('M2', 'หลังเคสปฏิเสธทั้งหมด: ชื่อ/ช่องทางยังเป็นค่าตั้งต้น และแถวอื่นไม่ขยับ',
    v_row.customer_name = 'ก่อนปิด' and v_row.customer_contact = 'c0' and pg_temp.row_md5(v_q) = v_before);

  -- ========================================================================
  -- P: oem_quote_save บน draft ยังทำงานเหมือนเดิม + view ที่หน้าพิมพ์อ่านเห็นค่าใหม่
  -- ========================================================================
  v_r := pg_temp.t_set(v_shop, v_qd, 'ชื่อจาก set_customer', 'ติดต่อจาก set_customer');
  perform analytics.oem_quote_save(p_shop_id => v_shop, p_items => v_item, p_quote_id => v_qd, p_status => 'draft',
           p_approval_note => null, p_customer_name => null, p_customer_contact => null, p_discount_thb => 0, p_discount_reason => null);
  select * into v_row from analytics.oem_quote where id = v_qd;
  v_log := v_log || pg_temp.chk('P1', 'oem_quote_save draft ส่งชื่อ null → คงค่าที่ set_customer ตั้ง (coalesce เดิม ไม่เปลี่ยน)',
    v_row.customer_name = 'ชื่อจาก set_customer' and v_row.customer_contact = 'ติดต่อจาก set_customer');
  perform analytics.oem_quote_save(p_shop_id => v_shop, p_items => v_item, p_quote_id => v_qd, p_status => 'draft',
           p_approval_note => null, p_customer_name => 'ชื่อจาก save', p_customer_contact => null, p_discount_thb => 0, p_discount_reason => null);
  select * into v_row from analytics.oem_quote where id = v_qd;
  v_log := v_log || pg_temp.chk('P2', 'oem_quote_save draft ส่งชื่อใหม่ → ทับได้เหมือนเดิม · contact null คงเดิม', v_row.customer_name = 'ชื่อจาก save' and v_row.customer_contact = 'ติดต่อจาก set_customer');
  perform analytics.oem_quote_set_customer(v_shop, v_q, 'ชื่อบนใบพิมพ์', 'ช่องทางบนใบพิมพ์');
  v_log := v_log || pg_temp.chk('P3', 'v_oem_quote (view ที่หน้าพิมพ์/รายละเอียดอ่าน) เห็นค่าใหม่ของใบ quoted',
    exists (select 1 from analytics.v_oem_quote where id = v_q and customer_name = 'ชื่อบนใบพิมพ์' and customer_contact = 'ช่องทางบนใบพิมพ์'));

  -- ========================================================================
  -- R: authenticated / anon → 42501 (จำลองวันที่กำแพงชั้นนอกหลุด · พารามิเตอร์ null ล้วน — Postgres เช็ค EXECUTE ก่อน body)
  -- ========================================================================
  grant usage on schema analytics to authenticated;
  grant usage on schema analytics to anon;
  foreach v_role in array array['authenticated', 'anon'] loop
    v_state := null; v_msg := null;
    execute format('set local role %I', v_role);
    begin
      perform analytics.oem_quote_set_customer(null::uuid, null::uuid, null::text, null::text);
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      v_msg := sqlerrm;
    end;
    reset role;
    v_log := v_log || pg_temp.chk('R/' || v_role, format('%s เรียก → 42501 permission denied for function (ได้ %s: %s)', v_role, coalesce(v_state, '(เรียกผ่าน!)'), left(coalesce(v_msg, ''), 60)),
      v_state = '42501' and v_msg ilike '%permission denied for function%');
  end loop;
  revoke usage on schema analytics from authenticated;
  revoke usage on schema analytics from anon;

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_log := v_log || format(E'\n--- สรุป: OK %s · FAIL %s ---\n', (length(v_log) - length(replace(v_log, '[OK]', ''))) / 4, v_fail);
  raise exception '%', v_log;
end
$v164$;
