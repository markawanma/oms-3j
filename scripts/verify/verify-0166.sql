-- scripts/verify/verify-0166.sql
-- ตรวจ supabase/migrations/0166_oem_product_item.sql หลัง apply (หรือต่อท้ายไฟล์ 0166 ใน dry-run เดียว)
-- self-rolling-back (3j-migration-traps ข้อ 11): แตะตัวนับเลขที่ใบเสนอราคา/ใบเสร็จ ⇒ ทุกเคสเก็บผลลง log แล้ว raise exception ปิดท้ายเสมอ ⇒ rollback ทั้งก้อน
-- ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน · [SKIP] = พิสูจน์ไม่ได้ (ไม่มีข้อมูลจริงให้ใช้เป็น fixture)
-- โครง: ชุดเทสต์อยู่ใน pg_temp.suite() (ทุกครั้งที่เรียกทำใน subtransaction ที่ถอยกลับเอง) ⇒ รันซ้ำได้ — รอบแรก = ของจริง ต้อง FAIL 0
--       รอบถัดไป = "mutant": แก้ฟังก์ชันจริงทีละจุด (pg_get_functiondef + replace) แล้วชุดเทสต์ต้องล้มที่ id ที่ระบุ — พิสูจน์ว่าเทสต์จับจริง
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0166.sql
-- dry-run ก่อน apply: cat supabase/migrations/0166_*.sql scripts/verify/verify-0166.sql > tmp.sql แล้วรันไม่ใส่ --commit
-- ⚠️ ก่อน/หลังรัน: count(*) oem_quote / oem_quote_item / product + oem_doc_counter + md5 oem_quote ทั้งตาราง ต้องเท่ากัน
--
-- ============ ตารางแมป "ข้อ design → เทสต์" (design-oem-product-item.md) ============
--  มติ 1  เลือก SKU ดึงราคาแคตตาล็อก · แก้ราคาได้ · ต่ำกว่า list ต้องมีเหตุผล · ไม่มีด่านทุนรายชิ้น · ด่าน blended<0 ยังอยู่
--         → C1a-g (ต่ำกว่า/เท่า/สูงกว่า list · เหตุผลล่องหน/ว่าง) · S4a-c (ทุน>ราคารายชิ้นผ่านเมื่อรวมบวก · รวมติดลบตก) · S5a-d (ด่านส่วนลดเดิม)
--  มติ 2  แก้ราคาในใบ = เฉพาะใบนั้น ห้ามเขียนกลับ catalog → S3a-b (catalog ไม่ถูกแก้โดย save · แก้ catalog ทีหลัง snapshot ไม่ขยับ)
--  มติ 3  ไม่มี SKU: ชื่อ + ราคา + ทุน (ทุนบังคับ) → C2a-h
--  มติ 4  หน้าพิมพ์ไม่หลุดทุน/เหตุผล/ราคาแคตตาล็อก → ฝั่ง DB ไม่มี (ชั้น type boundary: vitest lib/oem/printableQuote.test.ts) · ที่นี่เฉพาะ
--         "ข้อมูลอยู่ใน calc snapshot เท่านั้น ไม่รั่วไปคอลัมน์ที่หน้าพิมพ์อ่าน" → S2c
--  มติ 5  สินค้าไม่นับ min_job_value · ไม่ปลุก note-tier → N1 N2 N4 + ใบผสมงานผลิตยังติดด่านเดิม → N8a-c N9a-d · ใบผสมแท่งยังติด note-tier → N11
--  §1     input rules: product_id/ชื่อ/ราคา/ทุน/เหตุผล → C1-C5 · ราคา/ทุน ≤0 NaN Inf >1,000,000 ทศนิยม>2 → C4a-d
--  §2     calc branch: SKU ร้านอื่น/ไม่มี/ผิดรูป → C5a-c · ทุน catalog 0/null/spot-ไม่มีน้ำหนัก → incomplete → C6a-d · golden replay = ใน migration (3283+ เคส)
--         + key ใหม่ไม่กระทบ metal เดิม → C7a-b · metal แปลกยังปฏิเสธ → C8
--  §3     save: input.product_id ≠ item → S1a-d · sku/ชื่อปลอมถูกทับ → S2a-b · อายุใบ 30 วัน / ใบผสมแท่งราคาเว็บ 0 วัน / ผสมงานผลิต → N5 N6 N7
--         renegotiate (เบี่ยงจาก design: แก้ 2 จุดให้ตรงมติ 5) → R1-R6 · receipt_issue → X1
--  §4     อายุใบ = quote_valid_days_silver → N5 · §5 หน้าพิมพ์ → vitest
--  §7     เคสห้ามผ่าน "role อื่นยิง RPC" → A1-A4 (authenticated/anon 42501 หลังจำลองกำแพงชั้นนอกหลุด · ผู้ใช้ที่ไม่ใช่ owner/admin ตกที่ crm_require_owner_admin)
--  ต้องไม่พัง: ปัดเศษ item_total รวมกลับยอดเต็มเป๊ะ (ยอดคี่) → S6 · structure (3 ฟังก์ชัน 1 แถว ไม่มี legacy ค้าง ACL) → Z1-Z3
--  mutant (13 จุด ต้องล้มจริง): MC1-MC5 (calc) · MS1-MS6 (save) · MR1-MR2 (renegotiate) → ส่วนท้ายของ log
--  ⚠️ ที่เทสต์ครอบไม่ได้: PostgREST จริง (probe แยกหลัง apply) · หน้าพิมพ์/หน้าจอ (vitest + QA) · race ของตัวนับเลข (ต้อง 2 connection)

create function pg_temp.chk(p_id text, p_desc text, p_ok boolean) returns text
 language sql as $c$
  select format('[%s] %s  %s', case when coalesce(p_ok, false) then 'OK' else 'FAIL' end, p_id, p_desc) || E'\n'
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

create function pg_temp.calc_or_null(p_shop uuid, p_input jsonb) returns jsonb
 language plpgsql as $c$
begin
  return analytics.oem_price_calc(p_shop, p_input);
exception when others then
  return null;
end;
$c$;

create function pg_temp.t_save(p_shop uuid, p_items jsonb, p_status text, p_note text default 'verify-note',
                               p_discount numeric default 0, p_quote uuid default null, p_bar_date date default null) returns text
 language plpgsql as $c$
declare v_state text; v_id uuid;
begin
  v_id := analytics.oem_quote_save(
    p_shop_id => p_shop, p_items => p_items, p_quote_id => p_quote, p_status => p_status,
    p_approval_note => p_note, p_customer_name => 'verify0166', p_customer_contact => null,
    p_discount_thb => p_discount, p_discount_reason => null, p_bar_valid_until => p_bar_date);
  return 'OK:' || v_id::text;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  return 'ERR:' || v_state || ':' || sqlerrm;
end;
$c$;

create function pg_temp.t_reneg(p_shop uuid, p_quote uuid, p_discount numeric, p_reason text) returns text
 language plpgsql as $c$
declare v_state text; v_id uuid;
begin
  v_id := analytics.oem_quote_renegotiate(p_shop, p_quote, p_discount, p_reason);
  return 'OK:' || v_id::text;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  return 'ERR:' || v_state || ':' || sqlerrm;
end;
$c$;

-- ตัวเลขที่ส่งเป็น JSON number ถ้าเป็นเลขปกติ · ไม่งั้นส่งเป็น JSON string (NaN/Infinity/abc ต้องส่งเป็น string ได้)
create function pg_temp.num(p text) returns jsonb
 language plpgsql immutable as $c$
begin
  if p ~ '^-?[0-9]+(\.[0-9]+)?$' then
    return to_jsonb(p::numeric);
  end if;
  return to_jsonb(p);
end;
$c$;

-- input ของรายการสินค้า — key ที่เป็น null ไม่ถูกใส่ (เหมือนฟอร์มจริงที่ไม่ส่งช่องว่าง)
create function pg_temp.pin(p_pid uuid, p_qty int, p_price text, p_cost text, p_name text, p_reason text) returns jsonb
 language sql as $c$
  select jsonb_build_object('metal', 'product', 'qty', p_qty)
    || case when p_pid is not null then jsonb_build_object('product_id', p_pid::text) else '{}'::jsonb end
    || case when p_price is not null then jsonb_build_object('unit_price_thb', pg_temp.num(p_price)) else '{}'::jsonb end
    || case when p_cost is not null then jsonb_build_object('unit_cost_thb', pg_temp.num(p_cost)) else '{}'::jsonb end
    || case when p_name is not null then jsonb_build_object('product_name', p_name) else '{}'::jsonb end
    || case when p_reason is not null then jsonb_build_object('price_reason', p_reason) else '{}'::jsonb end
$c$;

-- item ของ oem_quote_save: product_id/sku/ชื่อ ระดับ item (ส่งค่าปลอมได้เพื่อเทสต์)
create function pg_temp.pit(p_input jsonb, p_pid uuid, p_sku text default null, p_name text default null) returns jsonb
 language sql as $c$
  select jsonb_build_object('input', p_input)
    || case when p_pid is not null then jsonb_build_object('product_id', p_pid::text) else '{}'::jsonb end
    || case when p_sku is not null then jsonb_build_object('sku_snapshot', p_sku) else '{}'::jsonb end
    || case when p_name is not null then jsonb_build_object('product_name_snapshot', p_name) else '{}'::jsonb end
$c$;

create function pg_temp.bar_item(p_size text, p_qty int, p_ovr text default null, p_reason text default null) returns jsonb
 language sql as $c$
  select jsonb_build_object('input',
    jsonb_build_object('metal', 'silver999', 'bar_size', p_size, 'qty', p_qty)
    || case when p_ovr is not null then jsonb_build_object('bar_price_override_thb', p_ovr::numeric) else '{}'::jsonb end
    || case when p_reason is not null then jsonb_build_object('bar_price_override_reason', p_reason) else '{}'::jsonb end)
$c$;

create function pg_temp.qid(p_res text) returns uuid
 language sql immutable as $c$ select case when p_res like 'OK:%' then substr(p_res, 4)::uuid end $c$;

-- ============================================================================
-- ชุดเทสต์หลัก — fixture ทั้งหมดอยู่ใน subtransaction ที่ถอยกลับเสมอ (เรียกซ้ำได้สำหรับ mutant)
-- ตัวเลขใน fixture เป็นค่าสมมติของชุดทดสอบ ไม่ใช่ราคา/ทุนจริง
-- ============================================================================
create function pg_temp.suite(p_shop uuid, p_prod_input jsonb, p_today date, p_silver_days int) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  v_pa uuid; v_pb uuid; v_pc uuid; v_pd uuid; v_pe uuid; v_pf uuid;
  v_r text; v_r2 text; v_r3 text;
  v_c jsonb; v_c2 jsonb;
  v_q uuid; v_q2 uuid; v_q3 uuid;
  v_row record; v_row2 record;
  v_md text; v_md2 text;
  v_bad text; v_val text; v_i int;
  v_prod_total numeric;
  v_prod_days int;
  v_claims text;
  v_cnt int;
begin
  begin
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

    -- ---- fixture: ราคาแท่งวันนี้ · เกณฑ์ใบ · สินค้า ----
    insert into analytics.silver_price_daily (
      shop_id, as_of_date, sheet_time, sell_per_baht, buy_per_baht,
      bar_0_5_baht, bar_1_baht, bar_3_baht, bar_5_baht, bar_10_baht,
      kilo_sell, kilo_sell_vat, kilo_buy, source, captured_at
    ) values (
      p_shop, p_today, 'fixture', null, 750, 500, 1000, 3000, 5000, 10000, null, 100000, 75000, 'manual', now()
    ) on conflict (shop_id, as_of_date) do update set
      sheet_time = excluded.sheet_time, sell_per_baht = excluded.sell_per_baht, buy_per_baht = excluded.buy_per_baht,
      bar_0_5_baht = excluded.bar_0_5_baht, bar_1_baht = excluded.bar_1_baht, bar_3_baht = excluded.bar_3_baht,
      bar_5_baht = excluded.bar_5_baht, bar_10_baht = excluded.bar_10_baht, kilo_sell = excluded.kilo_sell,
      kilo_sell_vat = excluded.kilo_sell_vat, kilo_buy = excluded.kilo_buy, source = excluded.source;

    update analytics.oem_setting set
      margin_target_pct = 0.30, margin_floor_pct = 0.20, margin_hard_floor_pct = 0.15, min_job_value_thb = 8000
      where shop_id = p_shop;

    -- A: list 1000 / ทุน 600 · B: ทุน 0 · C: ไม่มี list · D: โหมด spot ไม่มีน้ำหนัก (ทุนคำนวณได้ 0.00) · E: ทุน null · F: list 180 / ทุน 150
    insert into public.product (shop_id, sku, name, unit_cost, list_price, category, cost_type)
      values (p_shop, 'V166-A', 'สินค้าทดสอบ A', 600, 1000, 'ทดสอบ', 'fixed') returning id into v_pa;
    insert into public.product (shop_id, sku, name, unit_cost, list_price, category, cost_type)
      values (p_shop, 'V166-B', 'สินค้าทดสอบ B', 0, 500, 'ทดสอบ', 'fixed') returning id into v_pb;
    insert into public.product (shop_id, sku, name, unit_cost, list_price, category, cost_type)
      values (p_shop, 'V166-C', 'สินค้าทดสอบ C', 100, null, 'ทดสอบ', 'fixed') returning id into v_pc;
    insert into public.product (shop_id, sku, name, unit_cost, list_price, category, cost_type)
      values (p_shop, 'V166-D', 'สินค้าทดสอบ D', null, 300, 'ทดสอบ', 'spot') returning id into v_pd;
    insert into public.product (shop_id, sku, name, unit_cost, list_price, category, cost_type)
      values (p_shop, 'V166-E', 'สินค้าทดสอบ E', null, 400, 'ทดสอบ', 'fixed') returning id into v_pe;
    insert into public.product (shop_id, sku, name, unit_cost, list_price, category, cost_type)
      values (p_shop, 'V166-F', 'สินค้าทดสอบ F', 150, 180, 'ทดสอบ', 'fixed') returning id into v_pf;

    -- ========================================================================
    -- C1: SKU ต่ำกว่า/เท่า/สูงกว่า list_price (มติ 1)
    -- ========================================================================
    v_r := pg_temp.t_calc(p_shop, pg_temp.pin(v_pa, 1, '999', null, null, null));
    v_log := v_log || pg_temp.chk('C1a', 'มี SKU ราคาต่ำกว่า list_price ไม่มีเหตุผล → 22023', v_r like 'ERR:22023:%เหตุผล%');
    v_c := pg_temp.calc_or_null(p_shop, pg_temp.pin(v_pa, 1, '999', null, null, 'ลูกค้าประจำ'));
    v_log := v_log || pg_temp.chk('C1b', 'ต่ำกว่า list + มีเหตุผล → ผ่าน · snapshot: below_catalog=true · เหตุผล · list · cost_source=catalog · ทุน=cost_piece',
      v_c is not null and (v_c->'breakdown'->'product'->>'below_catalog')::boolean
      and v_c->'breakdown'->'product'->>'price_reason' = 'ลูกค้าประจำ'
      and (v_c->'breakdown'->'product'->>'catalog_list_price')::numeric = 1000
      and v_c->'breakdown'->'product'->>'cost_source' = 'catalog'
      and (v_c->'breakdown'->>'cost_piece')::numeric = 600 and (v_c->'breakdown'->>'price_per_piece')::numeric = 999
      and v_c->'breakdown'->'product'->>'sku' = 'V166-A' and v_c->'breakdown'->'product'->>'name' = 'สินค้าทดสอบ A');
    v_r := pg_temp.t_calc(p_shop, pg_temp.pin(v_pa, 1, '999', null, null, chr(8288) || chr(65279)));
    v_log := v_log || pg_temp.chk('C1c', 'เหตุผลมีแต่อักขระล่องหน (U+2060 U+FEFF) = ไม่มีเหตุผล → 22023', v_r like 'ERR:22023:%เหตุผล%');
    v_r := pg_temp.t_calc(p_shop, pg_temp.pin(v_pa, 1, '999', null, null, E'  \t  '));
    v_log := v_log || pg_temp.chk('C1d', 'เหตุผลเว้นวรรคล้วน → 22023', v_r like 'ERR:22023:%เหตุผล%');
    v_c := pg_temp.calc_or_null(p_shop, pg_temp.pin(v_pa, 1, '1000', null, null, null));
    v_log := v_log || pg_temp.chk('C1e', 'ราคา = list_price พอดี ไม่ต้องมีเหตุผล · below_catalog=false',
      v_c is not null and (v_c->'breakdown'->'product'->>'below_catalog')::boolean is false and (v_c->>'is_complete')::boolean);
    v_c := pg_temp.calc_or_null(p_shop, pg_temp.pin(v_pa, 1, '1500', null, null, null));
    v_log := v_log || pg_temp.chk('C1f', 'ราคาสูงกว่า list_price ผ่าน ไม่ต้องมีเหตุผล', v_c is not null and (v_c->'breakdown'->'product'->>'below_catalog')::boolean is false);
    v_c := pg_temp.calc_or_null(p_shop, pg_temp.pin(v_pc, 1, '50', null, null, null));
    v_log := v_log || pg_temp.chk('C1g', 'SKU ไม่มี list_price: ราคาไหนก็ไม่ต้องมีเหตุผล · below_catalog = null + warning (เทียบไม่ได้ ไม่ใช่ผ่านเงียบ)',
      v_c is not null and v_c->'breakdown'->'product'->'below_catalog' = 'null'::jsonb
      and jsonb_array_length(v_c->'warnings') >= 1 and (v_c->>'is_complete')::boolean);

    -- ========================================================================
    -- C2: ไม่มี SKU (มติ 3) — ชื่อ + ทุนบังคับ
    -- ========================================================================
    v_r := pg_temp.t_calc(p_shop, pg_temp.pin(null, 1, '100', '60', null, null));
    v_log := v_log || pg_temp.chk('C2a', 'ไม่มี SKU ไม่มีชื่อ → 22023', v_r like 'ERR:22023:%ชื่อ%');
    v_r := pg_temp.t_calc(p_shop, pg_temp.pin(null, 1, '100', '60', ' ' || chr(160) || chr(12288), null));
    v_log := v_log || pg_temp.chk('C2b', 'ชื่อเป็นช่องว่างล้วนทุกชนิด (NBSP/ideographic) → 22023', v_r like 'ERR:22023:%ชื่อ%');
    v_r := pg_temp.t_calc(p_shop, pg_temp.pin(null, 1, '100', '60', E'a\nb', null));
    v_log := v_log || pg_temp.chk('C2c', 'ชื่อมีขึ้นบรรทัดใหม่ → 22023', v_r like 'ERR:22023:%');
    v_r := pg_temp.t_calc(p_shop, pg_temp.pin(null, 1, '100', '60', chr(8238) || 'x', null));
    v_log := v_log || pg_temp.chk('C2d', 'ชื่อมี bidi override (U+202E) → 22023', v_r like 'ERR:22023:%');
    v_r := pg_temp.t_calc(p_shop, pg_temp.pin(null, 1, '100', null, 'กล่องสั่งทำ', null));
    v_log := v_log || pg_temp.chk('C2e', 'ไม่มี SKU ไม่มีทุน → 22023', v_r like 'ERR:22023:%ทุน%');
    v_r := pg_temp.t_calc(p_shop, pg_temp.pin(null, 1, '100', '60', repeat('ก', 201), null));
    v_r2 := pg_temp.t_calc(p_shop, pg_temp.pin(null, 1, '100', '60', repeat('ก', 200), null));
    v_log := v_log || pg_temp.chk('C2f', 'ชื่อยาว 201 → 22023 · ยาว 200 พอดีผ่าน', v_r like 'ERR:22023:%' and v_r2 = 'OK');
    v_c := pg_temp.calc_or_null(p_shop, pg_temp.pin(null, 3, '100.50', '60.25', '  กล่องสั่งทำ  ', null));
    v_log := v_log || pg_temp.chk('C2g', 'manual ผ่าน: complete · sku=null · ชื่อ trim · cost_source=manual · cost_piece/price_per_piece/quote_total ตรง · ไม่มี list/below',
      v_c is not null and (v_c->>'is_complete')::boolean
      and v_c->'breakdown'->'product'->'sku' = 'null'::jsonb and v_c->'breakdown'->'product'->>'name' = 'กล่องสั่งทำ'
      and v_c->'breakdown'->'product'->>'cost_source' = 'manual'
      and (v_c->'breakdown'->>'cost_piece')::numeric = 60.25 and (v_c->'breakdown'->>'price_per_piece')::numeric = 100.50
      and (v_c->'breakdown'->>'quote_total')::numeric = 301.50
      and v_c->'breakdown'->'product'->'catalog_list_price' = 'null'::jsonb and v_c->'breakdown'->'product'->'below_catalog' = 'null'::jsonb);
    v_log := v_log || pg_temp.chk('C2h', 'floors: margin.value = null (ไม่มีด่านทุนรายชิ้น) · job_value/qty ผ่าน · margin_actual = (100.50-60.25)/100.50',
      v_c is not null and v_c->'floors'->'margin'->'value' = 'null'::jsonb
      and (v_c->'floors'->'job_value'->>'pass')::boolean and (v_c->'floors'->'qty'->>'pass')::boolean
      and (v_c->'breakdown'->>'margin_actual_pct')::numeric = round((100.50 - 60.25) / 100.50, 4));

    -- ========================================================================
    -- C3: มี SKU แล้วห้ามส่งทุน (กันทับทุน catalog)
    -- ========================================================================
    v_r := pg_temp.t_calc(p_shop, pg_temp.pin(v_pa, 1, '1000', '1', null, null));
    v_log := v_log || pg_temp.chk('C3a', 'มี SKU + ส่ง unit_cost_thb=1 → 22023', v_r like 'ERR:22023:%ทุน%');
    v_r := pg_temp.t_calc(p_shop, pg_temp.pin(v_pa, 1, '1000', '0', null, null));
    v_log := v_log || pg_temp.chk('C3b', 'มี SKU + ส่ง unit_cost_thb=0 → 22023 (0 ก็คือ "ส่งมา")', v_r like 'ERR:22023:%ทุน%');
    v_r := pg_temp.t_calc(p_shop, pg_temp.pin(v_pa, 1, '1000', null, null, null) || jsonb_build_object('unit_cost_thb', null));
    v_r2 := pg_temp.t_calc(p_shop, pg_temp.pin(v_pa, 1, '1000', null, null, null) || jsonb_build_object('unit_cost_thb', '', 'product_name', 'ชื่อที่ถูกเมิน'));
    v_log := v_log || pg_temp.chk('C3c', 'ต้องไม่พัง: มี SKU + unit_cost_thb เป็น JSON null / ว่าง (ฟอร์มส่งช่องว่าง) ผ่าน · ชื่อที่ส่งมาถูกเมิน',
      v_r = 'OK' and v_r2 = 'OK'
      and pg_temp.calc_or_null(p_shop, pg_temp.pin(v_pa, 1, '1000', null, null, null) || jsonb_build_object('product_name', 'ชื่อที่ถูกเมิน'))->'breakdown'->'product'->>'name' = 'สินค้าทดสอบ A');

    -- ========================================================================
    -- C4: รูปร่างตัวเลข (ข้อ 4 NaN/Infinity · ทศนิยม · เพดาน)
    -- ========================================================================
    v_bad := '';
    foreach v_val in array array['0', '-1', 'NaN', 'Infinity', '-Infinity', '1000000.01', '1.005', 'abc', '1e7', ''] loop
      v_r := pg_temp.t_calc(p_shop, pg_temp.pin(null, 1, v_val, '5', 'ทดสอบ', null));
      if v_r not like 'ERR:22023:%' then v_bad := v_bad || '[' || v_val || ']=' || left(v_r, 40) || ' '; end if;
    end loop;
    v_log := v_log || pg_temp.chk('C4a', 'ราคาต่อชิ้น 0 / ติดลบ / NaN / Infinity / >1,000,000 / ทศนิยม 3 ตำแหน่ง / ไม่ใช่เลข / ว่าง → 22023 ทุกค่า ' || v_bad, v_bad = '');
    v_bad := '';
    foreach v_val in array array['0', '-5', 'NaN', 'Infinity', '1000000.01', '2.345', 'x'] loop
      v_r := pg_temp.t_calc(p_shop, pg_temp.pin(null, 1, '100', v_val, 'ทดสอบ', null));
      if v_r not like 'ERR:22023:%' then v_bad := v_bad || '[' || v_val || ']=' || left(v_r, 40) || ' '; end if;
    end loop;
    v_log := v_log || pg_temp.chk('C4b', 'ทุน manual 0 / ติดลบ / NaN / Infinity / >1,000,000 / ทศนิยม 3 ตำแหน่ง / ไม่ใช่เลข → 22023 ทุกค่า ' || v_bad, v_bad = '');
    v_bad := '';
    foreach v_val in array array['0', '-1', '100001', '2.5', 'abc'] loop
      v_r := pg_temp.t_calc(p_shop, pg_temp.pin(null, 1, '100', '60', 'ทดสอบ', null) || jsonb_build_object('qty', pg_temp.num(v_val)));
      if v_r not like 'ERR:22023:%' then v_bad := v_bad || '[' || v_val || ']=' || left(v_r, 40) || ' '; end if;
    end loop;
    v_log := v_log || pg_temp.chk('C4c', 'qty 0 / ติดลบ / 100001 / ทศนิยม / ไม่ใช่เลข → 22023 ทุกค่า ' || v_bad, v_bad = '');
    v_r := pg_temp.t_calc(p_shop, pg_temp.pin(null, 100000, '1000000', '999999.99', 'ทดสอบ', null));
    v_r2 := pg_temp.t_calc(p_shop, pg_temp.pin(null, 1, '0.01', '0.01', 'ทดสอบ', null));
    v_log := v_log || pg_temp.chk('C4d', 'ต้องไม่พัง: ขอบบน (ราคา 1,000,000 x 100000 ชิ้น) และขอบล่าง (0.01) ผ่าน', v_r = 'OK' and v_r2 = 'OK');

    -- ========================================================================
    -- C5: SKU ร้านอื่น / ไม่มี / ผิดรูป
    -- ========================================================================
    v_r := pg_temp.t_calc(gen_random_uuid(), pg_temp.pin(v_pa, 1, '1000', null, null, null));
    v_log := v_log || pg_temp.chk('C5a', 'SKU ของร้านนี้แต่เรียกในนามร้านอื่น → 22023 (ไม่เห็นสินค้าข้ามร้าน)', v_r like 'ERR:22023:%แคตตาล็อก%');
    v_r := pg_temp.t_calc(p_shop, pg_temp.pin(gen_random_uuid(), 1, '1000', null, null, null));
    v_log := v_log || pg_temp.chk('C5b', 'product_id ไม่มีอยู่จริง → 22023', v_r like 'ERR:22023:%แคตตาล็อก%');
    v_r := pg_temp.t_calc(p_shop, pg_temp.pin(null, 1, '1000', null, null, null) || jsonb_build_object('product_id', 'not-a-uuid'));
    v_log := v_log || pg_temp.chk('C5c', 'product_id ไม่ใช่ uuid → 22023 (ไม่ใช่ 22P02 หลุด)', v_r like 'ERR:22023:%');

    -- ========================================================================
    -- C6: ทุน catalog 0 / null / spot-ไม่มีน้ำหนัก → incomplete (ข้อ 13: ด่านที่ตาบอดต่อค่าที่หน้าตาเหมือนว่าง)
    -- ========================================================================
    v_bad := '';
    foreach v_val in array array['B', 'D', 'E'] loop
      v_c := pg_temp.calc_or_null(p_shop, pg_temp.pin(case v_val when 'B' then v_pb when 'D' then v_pd else v_pe end, 1, '1000', null, null, null));
      if v_c is null or (v_c->>'is_complete')::boolean is not false
         or v_c->'missing'->0->>'rate_key' is distinct from 'catalog_unit_cost'
         or v_c->'breakdown'->'cost_piece' <> 'null'::jsonb or v_c->'breakdown'->'quote_total' <> 'null'::jsonb then
        v_bad := v_bad || v_val || ' ';
      end if;
    end loop;
    v_log := v_log || pg_temp.chk('C6a', 'ทุน catalog = 0.00 (B) / spot ไม่มีน้ำหนัก = 0.00 (D) / null (E) → is_complete=false + missing catalog_unit_cost + ไม่ใช้ 0 เป็นทุน ' || v_bad, v_bad = '');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(v_pb, 1, '1000', null, null, null), v_pb)), 'quoted');
    v_log := v_log || pg_temp.chk('C6b', 'ใบที่มีสินค้าทุน 0 บันทึกเป็น quoted ไม่ได้ → 22023', v_r like 'ERR:22023:%ยังกรอกข้อมูลไม่ครบ%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(v_pb, 1, '1000', null, null, null), v_pb)), 'draft');
    v_log := v_log || pg_temp.chk('C6c', 'ต้องไม่พัง: แต่บันทึกเป็น draft ได้ (รอใส่ทุนทีหลัง)', v_r like 'OK:%');

    -- ========================================================================
    -- C7/C8: metal เดิมไม่กระทบ
    -- ========================================================================
    v_c := pg_temp.calc_or_null(p_shop, jsonb_build_object('metal', 'silver999', 'bar_size', '1_baht', 'qty', 2));
    v_c2 := pg_temp.calc_or_null(p_shop, jsonb_build_object('metal', 'silver999', 'bar_size', '1_baht', 'qty', 2,
      'product_id', v_pa::text, 'unit_price_thb', 5, 'unit_cost_thb', 1, 'price_reason', 'x', 'product_name', 'x'));
    v_log := v_log || pg_temp.chk('C7a', 'เงินแท่ง + key ของสินค้าปนมา → ผลเท่าไม่มี key (ถูกเมินทั้งหมด) · ไม่มี breakdown.product',
      v_c is not null and v_c = v_c2 and not (v_c->'breakdown' ? 'product'));
    if p_prod_input is not null then
      v_c := pg_temp.calc_or_null(p_shop, p_prod_input);
      v_c2 := pg_temp.calc_or_null(p_shop, p_prod_input || jsonb_build_object('product_id', v_pa::text, 'unit_price_thb', 5, 'unit_cost_thb', 1, 'price_reason', 'x'));
      v_log := v_log || pg_temp.chk('C7b', 'งานผลิต (ข้อมูลจริง) + key ของสินค้าปนมา → ผลเท่าไม่มี key · formula_version ยัง 3',
        v_c is not null and v_c = v_c2 and (v_c->>'formula_version')::int = 3 and not (v_c->'breakdown' ? 'product'));
    else
      v_log := v_log || '[SKIP] C7b ไม่มี oem_quote_item งานผลิตจริงให้ใช้เป็น fixture' || E'\n';
    end if;
    v_r := pg_temp.t_calc(p_shop, jsonb_build_object('metal', 'platinum', 'qty', 1));
    v_log := v_log || pg_temp.chk('C8', 'metal แปลกยังปฏิเสธ (รายการ metal ที่รับได้มี product เพิ่มเท่านั้น)', v_r like 'ERR:%metal must be%product%');

    -- ========================================================================
    -- S1: input.product_id ต้องตรง item.product_id
    -- ========================================================================
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(v_pa, 1, '1000', null, null, null), v_pf)), 'draft');
    v_log := v_log || pg_temp.chk('S1a', 'input.product_id = A แต่ item.product_id = F (สินค้าของร้านนี้ทั้งคู่) → 22023', v_r like 'ERR:22023:%ไม่ตรงกับ product_id%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(v_pa, 1, '1000', null, null, null), null)), 'draft');
    v_log := v_log || pg_temp.chk('S1b', 'input มี product_id แต่ item ไม่มี → 22023', v_r like 'ERR:22023:%ไม่ตรงกับ product_id%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(null, 1, '100', '60', 'กล่อง', null), v_pa)), 'draft');
    v_log := v_log || pg_temp.chk('S1c', 'item มี product_id แต่ input ไม่มี (manual) → 22023', v_r like 'ERR:22023:%ไม่ตรงกับ product_id%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(v_pa, 1, '1000', null, null, null), v_pa)), 'draft');
    v_r2 := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(null, 1, '100', '60', 'กล่อง', null), null)), 'draft');
    v_log := v_log || pg_temp.chk('S1d', 'ต้องไม่พัง: ตรงกัน (catalog) และ ไม่มีทั้งคู่ (manual) ผ่าน', v_r like 'OK:%' and v_r2 like 'OK:%');

    -- ========================================================================
    -- S2: sku/ชื่อปลอมจาก client ถูกทับด้วย snapshot จาก calc
    -- ========================================================================
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(v_pa, 1, '1000', null, null, null), v_pa, 'FAKE-SKU', 'ชื่อปลอม')), 'draft');
    v_q := pg_temp.qid(v_r);
    select * into v_row from analytics.oem_quote_item where quote_id = v_q and seq = 1;
    v_log := v_log || pg_temp.chk('S2a', 'catalog: client ส่ง sku/ชื่อปลอม → ที่เก็บ = sku/ชื่อจาก catalog (V166-A / สินค้าทดสอบ A)',
      v_row.sku_snapshot = 'V166-A' and v_row.product_name_snapshot = 'สินค้าทดสอบ A' and v_row.product_id = v_pa);
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(null, 1, '100', '60', 'กล่องสั่งทำ', null), null, 'FAKE-SKU', 'ชื่อปลอม')), 'draft');
    v_q := pg_temp.qid(v_r);
    select * into v_row from analytics.oem_quote_item where quote_id = v_q and seq = 1;
    v_log := v_log || pg_temp.chk('S2b', 'manual: client ส่ง sku/ชื่อปลอม → sku เป็น null · ชื่อ = ชื่อใน input ที่ผ่านด่านแล้ว',
      v_row.sku_snapshot is null and v_row.product_name_snapshot = 'กล่องสั่งทำ' and v_row.product_id is null);
    v_log := v_log || pg_temp.chk('S2c', 'ทุน/เหตุผล/ราคาแคตตาล็อกอยู่ใน calc snapshot เท่านั้น — คอลัมน์ที่หน้าพิมพ์อ่านมีแค่ qty/price_per_piece/item_total/ชื่อ/sku (cost_piece เป็นของ admin เดิม)',
      v_row.price_per_piece = 100 and v_row.cost_piece = 60 and v_row.item_total = 100
      and v_row.calc->'breakdown'->'product' ? 'price_reason');

    -- ========================================================================
    -- S3: ห้ามเขียนกลับ catalog · แก้ catalog ทีหลัง snapshot ไม่ขยับ
    -- ========================================================================
    select md5(unit_cost::text || '|' || list_price::text || '|' || name || '|' || sku) into v_md from public.product where id = v_pa;
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(v_pa, 2, '900', null, null, 'ลดให้ลูกค้าเก่า'), v_pa)), 'quoted');
    v_q := pg_temp.qid(v_r);
    select md5(unit_cost::text || '|' || list_price::text || '|' || name || '|' || sku) into v_md2 from public.product where id = v_pa;
    v_log := v_log || pg_temp.chk('S3a', 'บันทึกใบที่แก้ราคาต่อชิ้น → ราคา/ทุน/ชื่อ ใน catalog ไม่ขยับ (ห้ามเขียนกลับ)', v_q is not null and v_md = v_md2);
    select md5(to_jsonb(i)::text) into v_md from analytics.oem_quote_item i where quote_id = v_q and seq = 1;
    update public.product set name = 'ชื่อใหม่หลังแก้', list_price = 2000, unit_cost = 700 where id = v_pa;
    select md5(to_jsonb(i)::text) into v_md2 from analytics.oem_quote_item i where quote_id = v_q and seq = 1;
    v_c := pg_temp.calc_or_null(p_shop, pg_temp.pin(v_pa, 2, '900', null, null, 'ลดให้ลูกค้าเก่า'));
    v_log := v_log || pg_temp.chk('S3b', 'แก้ catalog (ชื่อ/list/ทุน) หลัง save → แถว item ของใบเดิมเท่าเดิมทั้งแถว · แต่ calc ใหม่เห็นค่าใหม่ (พิสูจน์ว่า catalog เปลี่ยนจริง)',
      v_md = v_md2 and v_c is not null and (v_c->'breakdown'->>'cost_piece')::numeric = 700
      and (select i.cost_piece = 600 and i.product_name_snapshot = 'สินค้าทดสอบ A' from analytics.oem_quote_item i where i.quote_id = v_q and i.seq = 1));
    update public.product set name = 'สินค้าทดสอบ A', list_price = 1000, unit_cost = 600 where id = v_pa;

    -- ========================================================================
    -- S4: ไม่มีด่านทุนรายชิ้น · ด่านรวม blended < 0 ยังอยู่
    -- ========================================================================
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(null, 1, '100', '150', 'ขาดทุนล้วน', null), null)), 'draft');
    v_log := v_log || pg_temp.chk('S4a', 'ทุน > ราคา (ใบสินค้าล้วน) บันทึก draft ได้ (calc แค่เตือน)', v_r like 'OK:%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(null, 1, '100', '150', 'ขาดทุนล้วน', null), null)), 'quoted');
    v_log := v_log || pg_temp.chk('S4b', 'ใบรวม margin ติดลบ (สินค้าล้วน ทุน > ราคา) quoted → 22023 ด่าน blended<0 เดิม · ไม่ปลดด้วย approval_note',
      v_r like 'ERR:22023:%margin รวมติดลบ%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(
      pg_temp.pit(pg_temp.pin(null, 1, '100', '150', 'รายการขาดทุน', null), null),
      pg_temp.bar_item('1_baht', 2)), 'quoted');
    v_log := v_log || pg_temp.chk('S4c', 'ต้องไม่พัง: รายการสินค้าขาดทุนรายชิ้นแต่ใบรวมบวก (ผสมแท่ง) quoted ผ่าน — ไม่มีด่านทุนรายชิ้นตามมติ 1', v_r like 'OK:%');

    -- ========================================================================
    -- S5: ด่านส่วนลดเดิมไม่ถูกแตะ (P_A ราคา 1000 ทุน 600 x 10 = 10,000)
    -- ========================================================================
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(v_pa, 10, '1000', null, null, null), v_pa)), 'quoted', null, 5000);
    v_log := v_log || pg_temp.chk('S5a', 'ส่วนลดจนกำไรรวมติดลบ → 22023 hard floor หลังส่วนลด', v_r like 'ERR:22023:%hard floor%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(v_pa, 10, '1000', null, null, null), v_pa)), 'quoted', 'verify-note', 3000);
    v_log := v_log || pg_temp.chk('S5b', 'ส่วนลดจน margin 14.3% < hard floor 15% → 22023 แม้มี approval_note (ไม่มีทางลัด)', v_r like 'ERR:22023:%hard floor%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(v_pa, 10, '1000', null, null, null), v_pa)), 'quoted', null, 2800);
    v_r2 := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(v_pa, 10, '1000', null, null, null), v_pa)), 'quoted', 'ลูกค้าสั่งเยอะ', 2800);
    v_log := v_log || pg_temp.chk('S5c', 'margin หลังส่วนลด 16.7% (ระหว่าง hard 15% กับ floor 20%): ไม่มีเหตุผล → 22023 note-tier · มีเหตุผล → ผ่าน',
      v_r like 'ERR:22023:%ต้องใส่เหตุผล%' and v_r2 like 'OK:%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(v_pa, 10, '1000', null, null, null), v_pa)), 'quoted', null, 2000);
    v_log := v_log || pg_temp.chk('S5d', 'ต้องไม่พัง: ส่วนลดที่ margin ยัง 25% ผ่านโดยไม่ต้องมีเหตุผล', v_r like 'OK:%');

    -- ========================================================================
    -- S6: ปัดเศษ — ผลรวม item_total = quote_total เป๊ะ ยอดคี่
    -- ========================================================================
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(
      pg_temp.pit(pg_temp.pin(null, 3, '33.33', '20.01', 'ยอดคี่หนึ่ง', null), null),
      pg_temp.pit(pg_temp.pin(null, 7, '0.01', '0.01', 'ยอดคี่สอง', null), null),
      pg_temp.pit(pg_temp.pin(v_pf, 13, '179.99', null, null, 'ลดเศษ'), v_pf)), 'quoted');
    v_q := pg_temp.qid(v_r);
    select * into v_row from analytics.oem_quote where id = v_q;
    v_log := v_log || pg_temp.chk('S6', 'หลายรายการยอดคี่: quote_total = grand_total = ผลรวม item_total เป๊ะ (99.99 + 0.07 + 2339.87)',
      v_q is not null and v_row.quote_total = (select sum(item_total) from analytics.oem_quote_item where quote_id = v_q)
      and v_row.grand_total = v_row.quote_total and v_row.quote_total = 99.99 + 0.07 + 2339.87);

    -- ========================================================================
    -- N: มติ 5 + ต้องไม่พัง
    -- ========================================================================
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(v_pa, 2, '900', null, null, 'โปรลูกค้า'), v_pa)), 'quoted', null);
    v_log := v_log || pg_temp.chk('N1', 'ใบสินค้าล้วนมูลค่า 1,800 (ต่ำกว่า min_job_value 8,000) quoted ผ่าน — ไม่นับเป็นงานผลิต', v_r like 'OK:%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(null, 1, '100', '82', 'margin สิบแปด', null), null)), 'quoted', null);
    v_log := v_log || pg_temp.chk('N2', 'ใบสินค้าล้วน margin 18% (< floor 20%) ไม่มี approval_note quoted ผ่าน — ไม่ปลุก note-tier', v_r like 'OK:%');
    if v_r like 'OK:%' then
      select * into v_row from analytics.oem_quote where id = pg_temp.qid(v_r);
      v_log := v_log || pg_temp.chk('N3', 'ใบ N2: approval_note/approved_by ว่าง · margin_charged_pct = null · margin รวมถูก (18%)',
        v_row.approval_note is null and v_row.approved_by is null and v_row.margin_charged_pct is null and v_row.margin_actual_pct = 0.18);
    end if;
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(null, 1, '100', '90', 'margin สิบ', null), null)), 'quoted', null);
    v_log := v_log || pg_temp.chk('N4', 'ใบสินค้าล้วน margin 10% (ต่ำกว่า hard floor 15%) quoted ผ่าน — hard floor รายชิ้นไม่ใช้กับสินค้า (มติ 1)', v_r like 'OK:%');

    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(v_pa, 2, '900', null, null, 'โปรลูกค้า'), v_pa)), 'quoted', null);
    select * into v_row from analytics.oem_quote where id = pg_temp.qid(v_r);
    v_log := v_log || pg_temp.chk('N5', 'ใบสินค้าล้วน quoted: quote_valid_until = วันนี้ + quote_valid_days_silver (' || p_silver_days || ')',
      v_row.quote_valid_until = p_today + p_silver_days);
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(v_pa, 2, '900', null, null, 'โปรลูกค้า'), v_pa), pg_temp.bar_item('1_baht', 1)), 'quoted', 'verify-note');
    select * into v_row from analytics.oem_quote where id = pg_temp.qid(v_r);
    v_log := v_log || pg_temp.chk('N6', 'ใบผสมสินค้า + เงินแท่งราคาเว็บ: ยืนราคา 0 วัน (quote_valid_until = วันนี้) — least() ไม่ถูกสินค้าลากยาว',
      v_r like 'OK:%' and v_row.quote_valid_until = p_today);

    if p_prod_input is not null then
      v_c := pg_temp.calc_or_null(p_shop, p_prod_input || jsonb_build_object('margin_pct', 0.35));
      v_prod_total := (v_c->'breakdown'->>'quote_total')::numeric;
      if v_c is null or v_prod_total is null or v_prod_total <= 0 or not (v_c->>'is_complete')::boolean then
        v_log := v_log || '[SKIP] N7-N9/R3 งานผลิตจริงที่ใช้เป็น fixture คำนวณไม่ครบวันนี้' || E'\n';
      else
        -- N7: ใบผสมสินค้า + งานผลิต (เกณฑ์ต่ำสุดเพื่อให้ส่วนงานผลิตผ่าน)
        update analytics.oem_setting set min_job_value_thb = 1 where shop_id = p_shop;
        v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(p_prod_input || jsonb_build_object('margin_pct', 0.35), null)), 'quoted', null);
        select quote_valid_until - p_today into v_prod_days from analytics.oem_quote where id = pg_temp.qid(v_r);
        v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(p_prod_input || jsonb_build_object('margin_pct', 0.35), null),
          pg_temp.pit(pg_temp.pin(v_pa, 2, '900', null, null, 'โปรลูกค้า'), v_pa)), 'quoted', null);
        select * into v_row from analytics.oem_quote where id = pg_temp.qid(v_r);
        v_log := v_log || pg_temp.chk('N7', 'ใบผสมสินค้า + งานผลิต (margin งานผลิต 35%) quoted ผ่าน · อายุใบ = least(งานผลิต ' || coalesce(v_prod_days::text, '?') || ', สินค้า ' || p_silver_days || ')',
          v_r like 'OK:%' and v_row.quote_valid_until - p_today = least(v_prod_days, p_silver_days));

        -- N8: ส่วนงานผลิตต่ำกว่า min → ตก แม้สินค้ามูลค่ามหาศาล (สินค้าไม่นับเป็นมูลค่างานผลิต)
        update analytics.oem_setting set min_job_value_thb = ceil(v_prod_total * 100) + 1000 where shop_id = p_shop;
        v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(p_prod_input || jsonb_build_object('margin_pct', 0.35), null),
          pg_temp.pit(pg_temp.pin(v_pa, 10000, '1000', null, null, null), v_pa)), 'quoted', null);
        v_log := v_log || pg_temp.chk('N8a', 'ใบผสม: งานผลิตต่ำกว่า min_job_value แม้สินค้ามูลค่า 10 ล้าน → 22023 "ส่วนที่เป็นงานผลิต" (ด่านเดิมของส่วนงานผลิตยังอยู่)',
          v_r like 'ERR:22023:%ส่วนที่เป็นงานผลิต%');
        v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(p_prod_input || jsonb_build_object('margin_pct', 0.35), null)), 'quoted', null);
        v_log := v_log || pg_temp.chk('N8b', 'baseline: งานผลิตล้วนเกณฑ์เดียวกัน → 22023 "มูลค่างานรวม" (ยืนยันว่าเกณฑ์ที่ตั้งทำงานจริง)', v_r like 'ERR:22023:%มูลค่างานรวม%');
        v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(v_pa, 10000, '1000', null, null, null), v_pa)), 'quoted', null);
        v_log := v_log || pg_temp.chk('N8c', 'ต้องไม่พัง: เกณฑ์เดียวกัน ใบสินค้าล้วนผ่าน', v_r like 'OK:%');

        -- N9: margin งานผลิตในใบผสม
        update analytics.oem_setting set min_job_value_thb = 1 where shop_id = p_shop;
        v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(p_prod_input || jsonb_build_object('margin_pct', 0.10), null),
          pg_temp.pit(pg_temp.pin(v_pa, 10000, '1000', null, null, null), v_pa)), 'quoted', 'verify-note');
        v_log := v_log || pg_temp.chk('N9a', 'ใบผสม: งานผลิต margin 10% (< hard floor) → 22023 แม้สินค้า margin สูงมาก (hard floor รายชิ้นของงานผลิตไม่ผ่อน)',
          v_r like 'ERR:22023:%hard floor%');
        v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(p_prod_input || jsonb_build_object('margin_pct', 0.18), null),
          pg_temp.pit(pg_temp.pin(v_pa, 10000, '1000', null, null, null), v_pa)), 'quoted', null);
        v_log := v_log || pg_temp.chk('N9b', 'ใบผสม: งานผลิต margin 18% (< floor) ไม่มีเหตุผล → 22023 note-tier ของส่วนงานผลิต', v_r like 'ERR:22023:%ต้องใส่เหตุผล%');
        v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(p_prod_input || jsonb_build_object('margin_pct', 0.18), null),
          pg_temp.pit(pg_temp.pin(v_pa, 10000, '1000', null, null, null), v_pa)), 'quoted', 'ลูกค้าประจำ');
        v_log := v_log || pg_temp.chk('N9c', 'ใบผสม: งานผลิต margin 18% + มีเหตุผล → ผ่าน', v_r like 'OK:%');
        v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(p_prod_input || jsonb_build_object('margin_pct', 0.18), null)), 'quoted', null);
        v_log := v_log || pg_temp.chk('N9d', 'baseline: งานผลิต margin 18% ล้วน ไม่มีเหตุผล → 22023 (ด่านเดิมทำงาน ไม่ได้ถูกผ่อนเพราะมีสินค้าในระบบ)', v_r like 'ERR:22023:%ต้องใส่เหตุผล%');

        -- R3: renegotiate ใบผสม — ส่วนงานผลิตต้องติด min เมื่อเกณฑ์สูงขึ้นทีหลัง
        v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(p_prod_input || jsonb_build_object('margin_pct', 0.35), null),
          pg_temp.pit(pg_temp.pin(v_pa, 10, '1000', null, null, null), v_pa)), 'quoted', null);
        v_q := pg_temp.qid(v_r);
        v_r2 := pg_temp.t_reneg(p_shop, v_q, 0, null);
        v_log := v_log || pg_temp.chk('R3a', 'ต่อรองใบผสมสินค้า + งานผลิต (ส่วนลด 0) ผ่าน → ใบใหม่ copy ครบ 2 รายการ',
          v_r2 like 'OK:%' and (select count(*) from analytics.oem_quote_item where quote_id = pg_temp.qid(v_r2)) = 2);
        update analytics.oem_setting set min_job_value_thb = ceil(v_prod_total * 100) + 1000 where shop_id = p_shop;
        v_r3 := pg_temp.t_reneg(p_shop, pg_temp.qid(v_r2), 0, null);
        v_log := v_log || pg_temp.chk('R3b', 'เกณฑ์ขั้นต่ำสูงขึ้นทีหลัง → ต่อรองใบผสมตกที่ "ส่วนที่เป็นงานผลิต" (สินค้าไม่ช่วยผ่าน)', v_r3 like 'ERR:22023:%ส่วนที่เป็นงานผลิต%');
        update analytics.oem_setting set min_job_value_thb = 8000 where shop_id = p_shop;
      end if;
    else
      v_log := v_log || '[SKIP] N7-N9/R3 ไม่มี oem_quote_item งานผลิตจริงให้ใช้เป็น fixture' || E'\n';
    end if;

    -- N11: ใบแท่งที่ margin ต่ำ (override 800 vs ทุน 750 = 6.25%) ยังติด note-tier — ไม่ใช่ product จึงไม่ถูกผ่อน
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 1, '800', 'ทดสอบ')), 'quoted', null, 0, null, p_today + 5);
    v_log := v_log || pg_temp.chk('N11', 'ต้องไม่พัง: ใบเงินแท่ง (margin รวม 6.25% < floor) ไม่มีเหตุผล → 22023 note-tier เดิมยังทำงาน', v_r like 'ERR:22023:%ต้องใส่เหตุผล%');

    -- ========================================================================
    -- R: renegotiate ใบสินค้าล้วน (เบี่ยงจาก design ให้ตรงมติ 5)
    -- ========================================================================
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(null, 1, '100', '82', 'margin สิบแปด', null), null)), 'quoted', null);
    v_q := pg_temp.qid(v_r);
    v_r2 := pg_temp.t_reneg(p_shop, v_q, 0, null);
    v_log := v_log || pg_temp.chk('R1', 'ต่อรองใบสินค้าล้วนมูลค่า 100 margin 18% ส่วนลด 0 ไม่มีเหตุผล → ผ่าน (ไม่ติด min_job_value ไม่ติด note-tier เพราะมีสินค้า)', v_r2 like 'OK:%');
    select * into v_row from analytics.oem_quote where id = pg_temp.qid(v_r2);
    v_log := v_log || pg_temp.chk('R2', 'ใบใหม่จากต่อรอง: quoted · valid_until = วันนี้ + ' || p_silver_days || ' · ใบเดิม superseded · item snapshot copy (sku null ชื่อเดิม)',
      v_row.status = 'quoted' and v_row.quote_valid_until = p_today + p_silver_days
      and (select status from analytics.oem_quote where id = v_q) = 'superseded'
      and (select product_name_snapshot = 'margin สิบแปด' and sku_snapshot is null from analytics.oem_quote_item where quote_id = v_row.id and seq = 1));
    -- ใบ A: 900 x 2 (ทุน 1200): ส่วนลดที่ margin เหลือ 17.2% ต้องมีเหตุผล · ที่ต่ำกว่า hard floor ห้ามเด็ดขาด · ที่ >= floor ผ่านเลย
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(v_pa, 2, '900', null, null, 'โปรลูกค้า'), v_pa)), 'quoted', null);
    v_q := pg_temp.qid(v_r);
    v_r2 := pg_temp.t_reneg(p_shop, v_q, 350, null);
    v_r3 := pg_temp.t_reneg(p_shop, v_q, 350, 'ต่อรองกับลูกค้า');
    v_log := v_log || pg_temp.chk('R4', 'ต่อรองส่วนลด 350 (margin 17.2% < floor): ไม่มีเหตุผล → 22023 · มีเหตุผล → ผ่าน (note-tier ของส่วนลดยังทำงาน)',
      v_r2 like 'ERR:22023:%ต้องระบุเหตุผล%' and v_r3 like 'OK:%');
    v_q := pg_temp.qid(v_r);
    v_r2 := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(v_pa, 2, '900', null, null, 'โปรลูกค้า'), v_pa)), 'quoted', null);
    v_r3 := pg_temp.t_reneg(p_shop, pg_temp.qid(v_r2), 400, 'เหตุผลครบแล้ว');
    v_log := v_log || pg_temp.chk('R5', 'ต่อรองส่วนลด 400 (margin 14.3% < hard floor) → 22023 แม้มีเหตุผล (ไม่มีทางลัด)', v_r3 like 'ERR:22023:%hard floor%');
    v_r3 := pg_temp.t_reneg(p_shop, pg_temp.qid(v_r2), 100, null);
    v_log := v_log || pg_temp.chk('R6', 'ต้องไม่พัง: ต่อรองส่วนลด 100 (margin 29%) ผ่านโดยไม่ต้องมีเหตุผล', v_r3 like 'OK:%');

    -- ========================================================================
    -- X1: ใบเสร็จจากใบสินค้า (receipt_issue ไม่อ่านรายการ — snapshot จากหัวใบ)
    -- ========================================================================
    update analytics.oem_setting set seller_vat_registered = true, seller_legal_name = 'ร้านทดสอบ verify0166',
      seller_tax_id = '0000000000000', seller_address_lines = '["ที่อยู่ทดสอบ"]'::jsonb where shop_id = p_shop;
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(v_pa, 2, '900', null, null, 'โปรลูกค้า'), v_pa)), 'quoted', null);
    v_q := pg_temp.qid(v_r);
    begin
      perform analytics.oem_quote_set_billing(p_shop, v_q, jsonb_build_object('legal_name', 'ลูกค้าทดสอบ verify0166'));
      v_q2 := analytics.oem_receipt_issue(p_shop, v_q, 100, (now() at time zone 'Asia/Bangkok')::date, 'deposit', 'transfer', null, null, null);
      select * into v_row from analytics.oem_receipt where id = v_q2;
      v_log := v_log || pg_temp.chk('X1', 'ออกใบเสร็จ (มัดจำ 100) จากใบสินค้าล้วนสำเร็จ · grand_total_snapshot = grand_total ของใบ (1,800) · balance = 1,700',
        v_row.grand_total_snapshot = 1800 and v_row.balance_after_thb = 1700);
    exception when others then
      v_log := v_log || pg_temp.chk('X1', 'ออกใบเสร็จจากใบสินค้าล้วน: ' || sqlstate || ' ' || left(sqlerrm, 200), false);
    end;

    raise exception 'suite rollback marker' using errcode = 'P0166';
  exception
    when sqlstate 'P0166' then null;
    when others then
      v_log := v_log || format(E'[FAIL] ABORT ชุดเทสต์ล้มกลางทาง sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;
  return v_log;
end;
$s$;

-- ============================================================================
-- mutant: แก้ฟังก์ชันจริง (ในทรานแซกชันนี้) ด้วย replace บน pg_get_functiondef แล้วต้องมีเทสต์ล้ม
-- ============================================================================
create function pg_temp.mutate(p_sig text, p_from text, p_to text) returns void
 language plpgsql as $c$
declare v_def text; v_n int;
begin
  v_def := pg_get_functiondef(p_sig::regprocedure);
  v_n := (length(v_def) - length(replace(v_def, p_from, ''))) / length(p_from);
  if v_n <> 1 then
    raise exception 'mutant pattern matched % times (ต้องพอดี 1): %', v_n, left(p_from, 80);
  end if;
  execute replace(v_def, p_from, p_to);
end;
$c$;

do $v166$
declare
  v_log text := E'\n=== verify 0166 (รายการสินค้า/ราคากำหนดเอง) ===\n';
  v_shop uuid;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_silver_days int;
  v_prod_input jsonb;
  v_s text;
  v_cnt int;
  v_fail int;
  v_ok int;
  v_m record;
  v_id text;
  v_killed int := 0;
  v_survived text := '';
  v_role text;
  v_fn text;
  v_state text;
  v_sig text;
  v_pa uuid;
  v_r text;
  v_orig record;
  v_h_before text;
  v_h_after text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  select count(*) into v_cnt from public.shop;
  if v_cnt <> 1 then
    raise exception 'verify-0166 หยุด: public.shop มี % ร้าน (ไฟล์นี้ออกแบบสำหรับร้านเดียว)', v_cnt;
  end if;
  select id into v_shop from public.shop;
  select coalesce(quote_valid_days_silver, 30) into v_silver_days from analytics.oem_setting where shop_id = v_shop;
  v_silver_days := coalesce(v_silver_days, 30);
  select input into v_prod_input from analytics.oem_quote_item where input->>'metal' = 'silver' order by created_at limit 1;

  -- ========================================================================
  -- Z: โครงสร้าง / สิทธิ์
  -- ========================================================================
  select count(*) into v_cnt from pg_proc where pronamespace = 'analytics'::regnamespace
    and proname in ('oem_price_calc', 'oem_quote_save', 'oem_quote_renegotiate');
  v_log := v_log || pg_temp.chk('Z1', format('3 ฟังก์ชัน = 3 แถวใน pg_proc (ไม่มี overload) ได้ %s', v_cnt), v_cnt = 3);
  select count(*) into v_cnt from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'oem_price_calc_legacy';
  v_log := v_log || pg_temp.chk('Z2', 'ไม่มี oem_price_calc_legacy ค้าง (ถูก drop หลัง golden replay)', v_cnt = 0);
  select count(*) into v_cnt from pg_proc p
    where p.pronamespace = 'analytics'::regnamespace and p.proname in ('oem_price_calc', 'oem_quote_save', 'oem_quote_renegotiate')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
           or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0))
      ;
  v_log := v_log || pg_temp.chk('Z3a', 'ไม่มี execute ให้ anon / authenticated / PUBLIC ทั้ง 3 ฟังก์ชัน', v_cnt = 0);
  select count(*) into v_cnt from pg_proc p
    where p.pronamespace = 'analytics'::regnamespace and p.proname in ('oem_price_calc', 'oem_quote_save', 'oem_quote_renegotiate')
      and has_function_privilege('service_role', p.oid, 'execute');
  v_log := v_log || pg_temp.chk('Z3b', 'service_role execute ได้ทั้ง 3 ฟังก์ชัน', v_cnt = 3);

  -- เก็บ definition เดิมไว้คืนหลัง mutant
  create temp table _v166_orig on commit drop as
    select p.oid::regprocedure::text as sig, p.proname, pg_get_functiondef(p.oid) as def, md5(pg_get_functiondef(p.oid)) as h
    from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname in ('oem_price_calc', 'oem_quote_save', 'oem_quote_renegotiate');

  -- ========================================================================
  -- รอบจริง — ต้อง FAIL 0
  -- ========================================================================
  v_s := pg_temp.suite(v_shop, v_prod_input, v_today, v_silver_days);
  v_log := v_log || v_s;
  v_fail := (length(v_s) - length(replace(v_s, '[FAIL]', ''))) / 6;
  v_ok := (length(v_s) - length(replace(v_s, '[OK]', ''))) / 4;
  v_log := v_log || format(E'--- ชุดเทสต์หลัก: OK %s / FAIL %s\n', v_ok, v_fail);

  -- ========================================================================
  -- A: role อื่นยิง RPC
  -- ========================================================================
  -- A1: จำลองวันที่กำแพงชั้นนอกหลุด (grant usage on schema กลับเข้าไป · rollback ตอนท้าย) · พารามิเตอร์ null ล้วน
  --     Postgres เช็ค EXECUTE ก่อน body รัน ⇒ ไม่แตะข้อมูล
  grant usage on schema analytics to authenticated;
  grant usage on schema analytics to anon;
  v_fail := 0;
  foreach v_role in array array['authenticated', 'anon'] loop
    foreach v_fn in array array['oem_price_calc', 'oem_quote_save', 'oem_quote_renegotiate'] loop
      begin
        execute format('set local role %I', v_role);
        begin
          if v_fn = 'oem_price_calc' then
            perform analytics.oem_price_calc(null::uuid, null::jsonb);
          elsif v_fn = 'oem_quote_save' then
            perform analytics.oem_quote_save(null::uuid, null::jsonb, null::uuid, null::text, null::text, null::text, null::text, null::numeric, null::text, null::date, null::uuid);
          else
            perform analytics.oem_quote_renegotiate(null::uuid, null::uuid, null::numeric, null::text);
          end if;
          v_fail := v_fail + 1; -- เรียกได้ = รั่ว
        exception when insufficient_privilege then
          null;
        when others then
          v_fail := v_fail + 1; -- เข้า body ได้ (error อื่น) = execute ไม่ถูกปิด
        end;
        reset role;
      exception when others then
        reset role;
        v_fail := v_fail + 1;
      end;
    end loop;
  end loop;
  revoke usage on schema analytics from authenticated;
  revoke usage on schema analytics from anon;
  v_log := v_log || pg_temp.chk('A1', 'authenticated / anon เรียก 3 ฟังก์ชัน → 42501 ทุกคู่ (6 คู่) แม้กำแพงชั้นนอกหลุด · เรียกผ่าน/เข้า body = ' || v_fail, v_fail = 0);

  -- A2: ผู้ใช้ที่ไม่ใช่ owner/admin ของร้านเรียก (ผ่านกำแพง grant ได้ เช่น service key รั่ว) → ตกที่ crm_require_owner_admin ในตัวฟังก์ชัน
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', gen_random_uuid()), true);
  begin
    v_r := null;
    perform analytics.oem_quote_save(v_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(null, 1, '100', '60', 'x', null), null)), null, 'draft');
    v_r := 'ผ่านทั้งที่ไม่ใช่ owner/admin';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_r := 'ERR:' || v_state;
  end;
  v_log := v_log || pg_temp.chk('A2', 'ผู้ใช้ที่ไม่ใช่ owner/admin เรียก oem_quote_save → ถูกปฏิเสธ (' || coalesce(v_r, '?') || ') ไม่เขียนแถว',
    v_r like 'ERR:%');
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- ========================================================================
  -- Mutant — แก้ฟังก์ชันจริงทีละจุด · ชุดเทสต์ต้องล้มที่ id ที่ระบุ · คืนของเดิมทุกครั้ง
  -- ========================================================================
  for v_m in
    select * from (values
      ('MC1', 'analytics.oem_price_calc(uuid,jsonb)',
        E'      if v_prod_txt is not null then\n        raise exception ''oem_price_calc: สินค้าจากแคตตาล็อก',
        E'      if false then\n        raise exception ''oem_price_calc: สินค้าจากแคตตาล็อก',
        array['C3a', 'C3b']),
      ('MC2', 'analytics.oem_price_calc(uuid,jsonb)',
        'if v_prod_below and v_prod_reason is null then', 'if false then',
        array['C1a', 'C1c', 'C1d']),
      ('MC3', 'analytics.oem_price_calc(uuid,jsonb)',
        E'not (v_prod_cost > 0 and v_prod_cost <= 1000000) then\n        v_prod_cost := null;',
        E'not (v_prod_cost > 0 and v_prod_cost <= 1000000) and false then\n        v_prod_cost := null;',
        array['C6a']),
      ('MC4', 'analytics.oem_price_calc(uuid,jsonb)',
        ' and dp.shop_id = p_shop_id;', ';',
        array['C5a']),
      ('MC5', 'analytics.oem_price_calc(uuid,jsonb)',
        'if v_prod_price <> round(v_prod_price, 2) then', 'if false then',
        array['C4a']),
      ('MS1', 'analytics.oem_quote_save(uuid,jsonb,uuid,text,text,text,text,numeric,text,date,uuid)',
        'is distinct from v_item_product_id then',
        E'is distinct from nullif(btrim(v_item_input->>''product_id''), '''')::uuid then',
        array['S1a', 'S1b', 'S1c']),
      ('MS2', 'analytics.oem_quote_save(uuid,jsonb,uuid,text,text,text,text,numeric,text,date,uuid)',
        E'      v_item_name := left(nullif(btrim(v_item_calc->''breakdown''->''product''->>''name''), ''''), 200);',
        E'      v_item_name := v_item_name;',
        array['S2a', 'S2b']),
      ('MS3', 'analytics.oem_quote_save(uuid,jsonb,uuid,text,text,text,text,numeric,text,date,uuid)',
        E' and v_item_metal is distinct from ''product'' then\n      v_has_ungated_item := true;',
        E' then\n      v_has_ungated_item := true;',
        array['N2', 'N3']),
      ('MS4', 'analytics.oem_quote_save(uuid,jsonb,uuid,text,text,text,text,numeric,text,date,uuid)',
        E'if v_item_metal not in (''silver999'', ''product'') then',
        E'if v_item_metal <> ''silver999'' then',
        array['N1']),
      ('MS5', 'analytics.oem_quote_save(uuid,jsonb,uuid,text,text,text,text,numeric,text,date,uuid)',
        'if v_has_bar_item or v_has_product_item then', 'if v_has_bar_item then',
        array['N1']),
      ('MS6', 'analytics.oem_quote_save(uuid,jsonb,uuid,text,text,text,text,numeric,text,date,uuid)',
        'when ''product'' then coalesce(v_set.quote_valid_days_silver, 30)', 'when ''product'' then 0',
        array['N5']),
      ('MR1', 'analytics.oem_quote_renegotiate(uuid,uuid,numeric,text)',
        'if v_has_bar_item or v_has_product_item then', 'if v_has_bar_item then',
        array['R1']),
      ('MR2', 'analytics.oem_quote_renegotiate(uuid,uuid,numeric,text)',
        E' and (v_row.input->>''metal'') is distinct from ''product'' then',
        ' then',
        array['R1'])
    ) as t(id, sig, f, t, ids)
  loop
    perform pg_temp.mutate(v_m.sig, v_m.f, v_m.t);
    v_s := pg_temp.suite(v_shop, v_prod_input, v_today, v_silver_days);
    -- คืนของเดิม (create or replace คง ACL เดิม)
    for v_orig in select def from _v166_orig where sig = to_regprocedure(v_m.sig)::text loop
      execute v_orig.def;
    end loop;
    v_cnt := 0;
    foreach v_id in array v_m.ids loop
      if position('[FAIL] ' || v_id || ' ' in v_s) > 0 then
        v_cnt := v_cnt + 1;
      end if;
    end loop;
    if v_cnt >= 1 then
      v_killed := v_killed + 1;
      v_log := v_log || format(E'[OK] %s  mutant ถูกจับ: ล้มที่ %s จาก %s\n', v_m.id, v_cnt, array_to_string(v_m.ids, ','));
    else
      v_survived := v_survived || v_m.id || ' ';
      v_log := v_log || format(E'[FAIL] %s  mutant รอด — ไม่มี id ใน %s ล้มเลย\n', v_m.id, array_to_string(v_m.ids, ','));
    end if;
  end loop;
  v_log := v_log || pg_temp.chk('MX', format('mutant 13 จุด ถูกจับ %s / 13 · รอด: %s', v_killed, coalesce(nullif(v_survived, ''), '(ไม่มี)')), v_killed = 13);

  -- หลัง mutant: definition ทุกตัวกลับเป็นของเดิมเป๊ะ (md5) แล้วรันชุดเทสต์อีกรอบ ต้องเขียวเหมือนเดิม
  select count(*) into v_cnt from _v166_orig o
    where md5(pg_get_functiondef(to_regprocedure(o.sig))) = o.h;
  v_log := v_log || pg_temp.chk('MY', 'หลังคืนของเดิม: md5 definition ทั้ง 3 ฟังก์ชันเท่าเดิม', v_cnt = 3);
  v_s := pg_temp.suite(v_shop, v_prod_input, v_today, v_silver_days);
  v_fail := (length(v_s) - length(replace(v_s, '[FAIL]', ''))) / 6;
  v_log := v_log || pg_temp.chk('MZ', 'หลังคืนของเดิม: ชุดเทสต์หลักรันซ้ำ FAIL ' || v_fail, v_fail = 0);

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_log := v_log || format(E'\n=== สรุป: [FAIL] ทั้งไฟล์ = %s %s ===\n', v_fail, case when v_fail = 0 then '(ผ่าน)' else '(ไม่ผ่าน)' end);

  -- rollback ทั้งก้อน + รายงานผล
  raise exception '%', v_log;
end $v166$;
