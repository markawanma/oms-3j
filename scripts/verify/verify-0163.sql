-- scripts/verify/verify-0163.sql
-- ตรวจ supabase/migrations/0163_oem_bar_price_override.sql หลัง apply (หรือต่อท้ายไฟล์ 0163 ใน dry-run เดียว)
-- self-rolling-back do-block ตาม 3j-migration-traps ข้อ 11: ทุกเคสเก็บผลลง v_log แล้ว raise exception ปิดท้ายเสมอ ⇒ ทั้งทรานแซกชัน
-- rollback (แตะตัวนับเลขที่ใบเสนอราคา + แถวราคาวันนี้ — ถอยหมด) · ผลทดสอบออกทาง error message · DB ไม่ขยับไม่ว่า PASS หรือ FAIL
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0163.sql
-- dry-run ก่อน apply: cat supabase/migrations/0163_*.sql scripts/verify/verify-0163.sql > tmp.sql แล้วรันโดยไม่ใส่ --commit
-- ผล: run-sql พิมพ์ "ล้มเหลว" พร้อม message = v_log · [FAIL] >= 1 = ไม่ผ่าน · [SKIP] = พิสูจน์ไม่ได้ในไฟล์นี้
-- ⚠️ ก่อน/หลังรันตรวจด้วยมือ (ข้อ 11): count(*) ของ oem_quote / oem_quote_item / silver_price_daily / oem_setting + oem_doc_counter.last_no เท่ากัน
--
-- ตัวเลขราคาในไฟล์นี้เป็น fixture สมมติ (วางทับแถวราคา "วันนี้" ในทรานแซกชันที่ถอยกลับ) ไม่ใช่ราคา/ทุนจริง
-- fixture: ราคาเว็บ 1_baht = 1000 · ราคารับซื้อคืน/บาท = 750 (ทุน 1_baht = 750)
--
-- ============ ตารางแมป "เคสในบรีฟ → assertion" ============
--  1 override < buyback → save quoted raise + preview floors.bar_price.pass=false ไม่ raise   → V3a-e · C4a-c
--  2 override <=0 / NaN / Infinity / >1,000,000 / >2x เว็บ → calc 22023                        → C6a-j (+ ทศนิยม>2 ตำแหน่ง · ขอบ 2x = ผ่าน)
--  3 ไม่มีเหตุผล / ช่องว่าง / เหตุผลไม่มี override → raise                                      → C7a-i
--  4 ไม่มีราคาวันนี้ + override → incomplete → quoted raise (+ ไม่มี buyback)                   → C8a-f · V4a-b
--  5 วัน >+30 / ย้อนหลัง / null ตอน quoted / ส่งวันไม่มี override → raise                       → V5a-j
--  6 ใบ quoted แล้วเรียก save แก้ → raise (ด่านเดิม)                                             → V6
--  7 authenticated / anon เรียก 3 ฟังก์ชัน → 42501 (หลัง grant usage on schema กลับเข้าไป)       → R1-R6
--  ต้องไม่พัง: golden replay legacy (อยู่ใน migration — ไม่มีไฟล์ legacy ให้เทียบหลัง drop) → C1a-g (ไม่มี override ผลเดิม · key ใหม่ไม่โผล่)
--             override = เว็บ x 1.1 quoted ผ่าน → V7 · = buyback พอดี ผ่าน → V8a-b · ใบผสม → V10a-d · renegotiate สืบทอดวัน → V14a-d
--             9 args (ไม่ส่ง p_bar_valid_until) ยัง save ได้ → V9a-c · flow ร่าง→ออกใบ (rehydrate) → V11 · ถอด override จากร่าง → V12
--  ⚠️ ที่เทสต์ครอบไม่ได้: ยิงผ่าน PostgREST จริง (พิสูจน์แยกด้วย probe หลัง apply) · UI (ครอบด้วย vitest)

create function pg_temp.chk(p_id text, p_desc text, p_ok boolean) returns text
 language sql as $c$
  select format('[%s] %s  %s', case when coalesce(p_ok, false) then 'OK' else 'FAIL' end, p_id, p_desc) || E'\n'
$c$;

create function pg_temp.bar_item(p_size text, p_qty int, p_ovr text default null, p_reason text default null, p_engrave numeric default null) returns jsonb
 language sql as $c$
  select jsonb_build_object('input',
    jsonb_build_object('metal', 'silver999', 'bar_size', p_size, 'qty', p_qty)
    || case when p_engrave is not null then jsonb_build_object('engrave_image_thb', p_engrave) else '{}'::jsonb end
    || case when p_ovr is not null then jsonb_build_object('bar_price_override_thb', p_ovr::numeric) else '{}'::jsonb end
    || case when p_reason is not null then jsonb_build_object('bar_price_override_reason', p_reason) else '{}'::jsonb end)
$c$;

-- ovr เป็น text เพื่อส่ง 'NaN'/'Infinity' ได้ (ต้องเป็น JSON string — jsonb number ไม่รับ NaN)
create function pg_temp.bar_input(p_size text, p_qty int, p_ovr text, p_reason text) returns jsonb
 language sql as $c$
  select jsonb_build_object('metal', 'silver999', 'bar_size', p_size, 'qty', p_qty)
    || case when p_ovr is not null then jsonb_build_object('bar_price_override_thb', p_ovr) else '{}'::jsonb end
    || case when p_reason is not null then jsonb_build_object('bar_price_override_reason', p_reason) else '{}'::jsonb end
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

create function pg_temp.t_save(p_shop uuid, p_items jsonb, p_status text, p_bar_date date,
                               p_note text default 'verify-note', p_discount numeric default 0, p_quote uuid default null) returns text
 language plpgsql as $c$
declare v_state text; v_id uuid;
begin
  v_id := analytics.oem_quote_save(
    p_shop_id => p_shop, p_items => p_items, p_quote_id => p_quote, p_status => p_status,
    p_approval_note => p_note, p_customer_name => 'verify0163', p_customer_contact => null,
    p_discount_thb => p_discount, p_discount_reason => null, p_bar_valid_until => p_bar_date);
  return 'OK:' || v_id::text;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  return 'ERR:' || v_state || ':' || sqlerrm;
end;
$c$;

do $v163$
declare
  v_log text := E'\n=== verify 0163 (ราคาพิเศษเงินแท่ง) ===\n';
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_shop uuid;
  v_r text;
  v_r2 text;
  v_c jsonb;
  v_c0 jsonb;
  v_q uuid;
  v_q2 uuid;
  v_row analytics.oem_quote%rowtype;
  v_cnt int;
  v_size text;
  v_sizes text[] := array['0_5_baht', '1_baht', '3_baht', '5_baht', '10_baht', '1_kg'];
  v_col numeric;
  v_val text;
  v_vals text[];
  v_silver_days int;
  v_prod_input jsonb;
  v_prod_item jsonb;
  v_state text;
  v_msg text;
  v_role text;
  v_fn text;
  v_fail int;
  v_ok_all boolean;
  v_snap_before text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- ร้าน: ร้านเดียวในระบบ (ไฟล์นี้หยุดถ้ามีมากกว่า 1)
  select count(*) into v_cnt from public.shop;
  if v_cnt <> 1 then
    raise exception 'verify-0163 หยุด: public.shop มี % ร้าน (ไฟล์นี้ออกแบบสำหรับร้านเดียว)', v_cnt;
  end if;
  select id into v_shop from public.shop;
  select coalesce(quote_valid_days_silver, 30) into v_silver_days from analytics.oem_setting where shop_id = v_shop;
  v_silver_days := coalesce(v_silver_days, 30);

  -- fixture: วางทับแถวราคา "วันนี้" (ถอยกลับตอนท้าย)
  insert into analytics.silver_price_daily (
    shop_id, as_of_date, sheet_time, sell_per_baht, buy_per_baht,
    bar_0_5_baht, bar_1_baht, bar_3_baht, bar_5_baht, bar_10_baht,
    kilo_sell, kilo_sell_vat, kilo_buy, source, captured_at
  ) values (
    v_shop, v_today, 'fixture', null, 750, 500, 1000, 3000, 5000, 10000, null, 100000, 75000, 'manual', now()
  ) on conflict (shop_id, as_of_date) do update set
    sheet_time = excluded.sheet_time, sell_per_baht = excluded.sell_per_baht, buy_per_baht = excluded.buy_per_baht,
    bar_0_5_baht = excluded.bar_0_5_baht, bar_1_baht = excluded.bar_1_baht, bar_3_baht = excluded.bar_3_baht,
    bar_5_baht = excluded.bar_5_baht, bar_10_baht = excluded.bar_10_baht, kilo_sell = excluded.kilo_sell,
    kilo_sell_vat = excluded.kilo_sell_vat, kilo_buy = excluded.kilo_buy, source = excluded.source;

  -- ========================================================================
  -- S: โครงสร้าง / สิทธิ์
  -- ========================================================================
  select count(*) into v_cnt from pg_proc where pronamespace = 'analytics'::regnamespace
    and proname in ('oem_price_calc', 'oem_quote_save', 'oem_quote_renegotiate');
  v_log := v_log || pg_temp.chk('S1', format('3 ฟังก์ชัน = 3 แถวใน pg_proc (ไม่มี overload) ได้ %s', v_cnt), v_cnt = 3);
  select count(*) into v_cnt from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'oem_price_calc_legacy';
  v_log := v_log || pg_temp.chk('S2', 'oem_price_calc_legacy ถูก drop แล้ว', v_cnt = 0);
  select count(*) into v_cnt from pg_proc where pronamespace = 'analytics'::regnamespace
    and proname = 'oem_quote_save' and pronargs = 10 and pronargdefaults >= 1
    and 'p_bar_valid_until' = any (proargnames);
  v_log := v_log || pg_temp.chk('S3', 'oem_quote_save เป็น 10-arg มี p_bar_valid_until + default', v_cnt = 1);
  select count(*) into v_cnt
    from pg_proc p cross join lateral aclexplode(p.proacl) a
    where p.pronamespace = 'analytics'::regnamespace
      and p.proname in ('oem_price_calc', 'oem_quote_save', 'oem_quote_renegotiate')
      and a.privilege_type = 'EXECUTE'
      and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole);
  v_log := v_log || pg_temp.chk('S4', format('ไม่มี PUBLIC/anon/authenticated EXECUTE บน 3 ฟังก์ชัน (พบ %s)', v_cnt), v_cnt = 0);
  select count(*) into v_cnt
    from pg_proc p cross join lateral aclexplode(p.proacl) a
    where p.pronamespace = 'analytics'::regnamespace
      and p.proname in ('oem_price_calc', 'oem_quote_save', 'oem_quote_renegotiate')
      and a.privilege_type = 'EXECUTE' and a.grantee = 'service_role'::regrole;
  v_log := v_log || pg_temp.chk('S5', format('service_role มี EXECUTE ครบ 3 ฟังก์ชัน (พบ %s)', v_cnt), v_cnt = 3);

  -- ========================================================================
  -- C1: ไม่มี override = ผลเดิม (key ใหม่ไม่โผล่) — ทุกขนาด
  -- ========================================================================
  v_ok_all := true;
  foreach v_size in array v_sizes loop
    v_c := analytics.oem_price_calc(v_shop, pg_temp.bar_input(v_size, 3, null, null));
    select case v_size when '0_5_baht' then bar_0_5_baht when '1_baht' then bar_1_baht when '3_baht' then bar_3_baht
                       when '5_baht' then bar_5_baht when '10_baht' then bar_10_baht when '1_kg' then kilo_sell_vat end
      into v_col from analytics.silver_price_daily where shop_id = v_shop and as_of_date = v_today;
    if not ((v_c->'breakdown'->'bar'->>'bar_price_per_piece')::numeric = v_col
            and not (v_c->'breakdown'->'bar' ? 'override')
            and not (v_c->'breakdown'->'bar' ? 'web_price_per_piece')
            and not (v_c->'floors' ? 'bar_price')
            and (v_c->>'is_complete')::boolean
            and v_c->'warnings' = jsonb_build_array('ราคาเงินแท่งยืนเฉพาะวันนี้เท่านั้น')
            and (v_c->'breakdown'->>'quote_total')::numeric = round(3 * v_col, 2)) then
      v_ok_all := false;
      v_log := v_log || format('   (ขนาด %s ไม่ตรง: %s)', v_size, v_c) || E'\n';
    end if;
  end loop;
  v_log := v_log || pg_temp.chk('C1a', 'ไม่มี override ทั้ง 6 ขนาด: ราคา=ราคาเว็บ · ไม่มี key override/web_price/bar_price · warning เดิม · quote_total = qty x ราคา', v_ok_all);

  v_c0 := analytics.oem_price_calc(v_shop, pg_temp.bar_input('1_baht', 2, null, null));
  v_log := v_log || pg_temp.chk('C1b', 'ทุน = ราคารับซื้อคืน (750) cost_basis=buyback · floors.margin.value = null (ไม่แตะ)',
    (v_c0->'breakdown'->>'cost_piece')::numeric = 750 and v_c0->'breakdown'->'bar'->>'cost_basis' = 'buyback'
    and jsonb_typeof(v_c0->'floors'->'margin'->'value') = 'null');

  -- key ว่าง/null/เว้นวรรค = ไม่มี override (เท่ากับไม่ส่ง)
  v_ok_all := true;
  foreach v_val in array array['null', 'blank', 'spaces'] loop
    v_c := analytics.oem_price_calc(v_shop,
      pg_temp.bar_input('1_baht', 2, null, null)
      || case v_val when 'null' then jsonb_build_object('bar_price_override_thb', null, 'bar_price_override_reason', null)
                    when 'blank' then jsonb_build_object('bar_price_override_thb', '', 'bar_price_override_reason', '')
                    else jsonb_build_object('bar_price_override_thb', ' ', 'bar_price_override_reason', E'  \t ') end);
    if v_c is distinct from v_c0 then v_ok_all := false; end if;
  end loop;
  v_log := v_log || pg_temp.chk('C1c', 'key override เป็น null / "" / เว้นวรรค = ผลเท่ากับไม่ส่ง key (jsonb =)', v_ok_all);

  -- งานผลิต: key override ที่หลงมา (UI ผิด) ถูกเมิน — ผลเท่าไม่ส่ง
  if (select count(*) from analytics.oem_quote_item where input->>'metal' = 'silver') > 0 then
    select input into v_prod_input from analytics.oem_quote_item where input->>'metal' = 'silver' order by created_at limit 1;
    v_log := v_log || pg_temp.chk('C1d', 'งานผลิต silver ที่มี key override หลงมา: ผลเท่าไม่มี key (เมิน) · ไม่มี key ใหม่โผล่',
      analytics.oem_price_calc(v_shop, v_prod_input || jsonb_build_object('bar_price_override_thb', 1, 'bar_price_override_reason', 'x'))
        = analytics.oem_price_calc(v_shop, v_prod_input)
      and not (analytics.oem_price_calc(v_shop, v_prod_input) ? 'bar'));
  else
    v_log := v_log || '[SKIP] C1d ไม่มีงานผลิต silver จริงใน DB ให้ยิง' || E'\n';
  end if;

  -- ========================================================================
  -- C2-C5: override ปกติ (preview)
  -- ========================================================================
  v_c := analytics.oem_price_calc(v_shop, pg_temp.bar_input('1_baht', 2, '1100', 'bid ล็อกราคา'));
  v_log := v_log || pg_temp.chk('C2a', 'override = เว็บ x 1.1 (บวกเผื่อ): complete · ราคาที่คิด=1100 · เว็บ=1000 · override={thb,reason}',
    (v_c->>'is_complete')::boolean
    and (v_c->'breakdown'->'bar'->>'bar_price_per_piece')::numeric = 1100
    and (v_c->'breakdown'->'bar'->>'web_price_per_piece')::numeric = 1000
    and (v_c->'breakdown'->'bar'->'override'->>'thb')::numeric = 1100
    and v_c->'breakdown'->'bar'->'override'->>'reason' = 'bid ล็อกราคา');
  v_log := v_log || pg_temp.chk('C2b', 'floors.bar_price = {applies:true, pass:true} · warning ราคาพิเศษ (ไม่ใช่ "ยืนเฉพาะวันนี้")',
    (v_c->'floors'->'bar_price'->>'applies')::boolean and (v_c->'floors'->'bar_price'->>'pass')::boolean
    and v_c->'warnings' = jsonb_build_array('ราคาพิเศษ — ยืนราคาตามวันที่กรอกในใบ (ไม่เกิน 30 วัน)'));
  v_log := v_log || pg_temp.chk('C2c', 'ฝั่งทุนไม่ขยับ: cost_piece = 750 เท่าไม่มี override · price_per_piece=1100 · quote_total = 2 x 1100',
    (v_c->'breakdown'->>'cost_piece')::numeric = 750 and (v_c->'breakdown'->>'price_per_piece')::numeric = 1100
    and (v_c->'breakdown'->>'quote_total')::numeric = 2200 and jsonb_typeof(v_c->'floors'->'margin'->'value') = 'null');
  v_log := v_log || pg_temp.chk('C2d', 'ไม่มีราคารับซื้อคืนหลุดใน calc (ไม่มี key buy/kilo_buy) และ override ไม่ใช่ JSON null',
    v_c::text !~ 'kilo_buy|buy_per_baht' and jsonb_typeof(v_c->'breakdown'->'bar'->'override') = 'object');

  v_c := analytics.oem_price_calc(v_shop, pg_temp.bar_input('1_baht', 2, '1100', 'bid') || jsonb_build_object('engrave_image_thb', 150, 'engrave_text_thb', 50));
  v_log := v_log || pg_temp.chk('C3', 'override + engrave: ราคา/ชิ้น = 1100+150+50 · ทุน = 750+150+50 (engrave pass-through)',
    (v_c->'breakdown'->>'price_per_piece')::numeric = 1300 and (v_c->'breakdown'->>'cost_piece')::numeric = 950);

  v_c := analytics.oem_price_calc(v_shop, pg_temp.bar_input('1_baht', 2, '700', 'ต่ำกว่าทุน'));
  v_log := v_log || pg_temp.chk('C4a', 'override < buyback (700 < 750): preview ไม่ raise · floors.bar_price.pass = false · is_complete = true',
    (v_c->'floors'->'bar_price'->>'pass')::boolean is false and (v_c->>'is_complete')::boolean);
  v_c := analytics.oem_price_calc(v_shop, pg_temp.bar_input('1_baht', 2, '749.99', 'ต่ำกว่าทุน 1 สตางค์'));
  v_log := v_log || pg_temp.chk('C4b', 'ขอบล่าง: 749.99 (ต่ำกว่าทุน 0.01) → pass=false', (v_c->'floors'->'bar_price'->>'pass')::boolean is false);
  v_c := analytics.oem_price_calc(v_shop, pg_temp.bar_input('1_baht', 2, '0.01', 'ต่ำสุด'));
  v_log := v_log || pg_temp.chk('C4c', 'ราคา 0.01 (ต่ำสุดที่รับ) preview ได้ pass=false ไม่ raise', (v_c->'floors'->'bar_price'->>'pass')::boolean is false);

  v_c := analytics.oem_price_calc(v_shop, pg_temp.bar_input('1_baht', 2, '750', 'เท่าทุน'));
  v_log := v_log || pg_temp.chk('C5', 'override = buyback พอดี (750) → pass=true (ไม่ต่ำกว่าทุน)', (v_c->'floors'->'bar_price'->>'pass')::boolean);

  -- ========================================================================
  -- C6: ค่า override ที่ห้ามผ่าน → 22023
  -- ========================================================================
  v_vals := array['0', '-5', 'NaN', 'Infinity', '-Infinity', '1000001', '2000.01', '1000.005', '1e7'];
  foreach v_val in array v_vals loop
    v_r := pg_temp.t_calc(v_shop, pg_temp.bar_input('1_baht', 1, v_val, 'เหตุผล'));
    v_log := v_log || pg_temp.chk('C6/' || v_val, format('override=%s → raise 22023 (%s)', v_val, left(v_r, 70)), v_r like 'ERR:22023:%');
  end loop;
  v_r := pg_temp.t_calc(v_shop, pg_temp.bar_input('1_baht', 1, 'abc', 'เหตุผล'));
  v_log := v_log || pg_temp.chk('C6/abc', 'override="abc" → raise (ไม่ใช่ตัวเลข)', v_r like 'ERR:%');
  -- ต้องไม่พัง: ขอบบน 2x ราคาเว็บพอดี ผ่าน
  v_r := pg_temp.t_calc(v_shop, pg_temp.bar_input('1_baht', 1, '2000', 'ขอบ 2 เท่า'));
  v_log := v_log || pg_temp.chk('C6/2x', 'override = 2x ราคาเว็บพอดี (2000) → ผ่าน (ไม่ raise)', v_r = 'OK');
  v_r := pg_temp.t_calc(v_shop, pg_temp.bar_input('1_baht', 1, '1234.56', 'สองตำแหน่ง'));
  v_log := v_log || pg_temp.chk('C6/2dp', 'override ทศนิยม 2 ตำแหน่ง (1234.56) → ผ่าน', v_r = 'OK');

  -- ========================================================================
  -- C7: เหตุผล
  -- ========================================================================
  v_r := pg_temp.t_calc(v_shop, pg_temp.bar_input('1_baht', 1, '1100', null));
  v_log := v_log || pg_temp.chk('C7a', 'override ไม่ส่งเหตุผล → raise 22023', v_r like 'ERR:22023:%');
  v_r := pg_temp.t_calc(v_shop, pg_temp.bar_input('1_baht', 1, '1100', null) || jsonb_build_object('bar_price_override_reason', null));
  v_log := v_log || pg_temp.chk('C7b', 'เหตุผล JSON null → raise 22023', v_r like 'ERR:22023:%');
  v_r := pg_temp.t_calc(v_shop, pg_temp.bar_input('1_baht', 1, '1100', ''));
  v_log := v_log || pg_temp.chk('C7c', 'เหตุผล "" → raise 22023', v_r like 'ERR:22023:%');
  v_r := pg_temp.t_calc(v_shop, pg_temp.bar_input('1_baht', 1, '1100', E'   \t \n '));
  v_log := v_log || pg_temp.chk('C7d', 'เหตุผลเว้นวรรค/tab/newline ล้วน → raise 22023', v_r like 'ERR:22023:%');
  v_r := pg_temp.t_calc(v_shop, pg_temp.bar_input('1_baht', 1, '1100', E' ​ '));
  v_log := v_log || pg_temp.chk('C7e', 'เหตุผล nbsp/zero-width ล้วน → raise 22023', v_r like 'ERR:22023:%');
  v_r := pg_temp.t_calc(v_shop, pg_temp.bar_input('1_baht', 1, null, 'เหตุผลลอย'));
  v_log := v_log || pg_temp.chk('C7f', 'มีเหตุผลแต่ไม่มี override → raise 22023', v_r like 'ERR:22023:%');
  v_r := pg_temp.t_calc(v_shop, pg_temp.bar_input('1_baht', 1, '', 'เหตุผลลอย'));
  v_log := v_log || pg_temp.chk('C7g', 'มีเหตุผลแต่ override = "" → raise 22023', v_r like 'ERR:22023:%');
  v_c := analytics.oem_price_calc(v_shop, pg_temp.bar_input('1_baht', 1, '1100', repeat('ก', 250)));
  v_log := v_log || pg_temp.chk('C7h', 'เหตุผล 250 ตัวอักษร → ตัดเหลือ 200 ใน snapshot',
    length(v_c->'breakdown'->'bar'->'override'->>'reason') = 200);
  v_c := analytics.oem_price_calc(v_shop, pg_temp.bar_input('1_baht', 1, '1100', E'  bid งาน A \n'));
  v_log := v_log || pg_temp.chk('C7i', 'เหตุผลถูก trim ก่อนเก็บ', v_c->'breakdown'->'bar'->'override'->>'reason' = 'bid งาน A');

  -- ========================================================================
  -- C8: ไม่มีราคาวันนี้ / ไม่มี buyback (แก้แถวราคาใน sub-block ที่ถอยกลับ)
  -- ========================================================================
  begin
    delete from analytics.silver_price_daily where shop_id = v_shop and as_of_date = v_today;
    v_r := pg_temp.t_calc(v_shop, pg_temp.bar_input('1_baht', 1, '1100', 'ไม่มีราคาเว็บ'));
    v_c := analytics.oem_price_calc(v_shop, pg_temp.bar_input('1_baht', 1, '1100', 'ไม่มีราคาเว็บ'));
    v_log := v_log || pg_temp.chk('C8a', 'ไม่มีราคาเว็บวันนี้ + override: ไม่ raise · is_complete=false · missing=silver_bar_price',
      v_r = 'OK' and not (v_c->>'is_complete')::boolean and v_c->'missing' @> '[{"rate_key":"silver_bar_price"}]'::jsonb);
    v_log := v_log || pg_temp.chk('C8b', 'ไม่มีราคาเว็บ: override ยังอยู่ใน snapshot (draft เห็น) · pass=null (ตัดสินไม่ได้) · ไม่มี price_per_piece',
      jsonb_typeof(v_c->'breakdown'->'bar'->'override') = 'object'
      and jsonb_typeof(v_c->'floors'->'bar_price'->'pass') = 'null'
      and jsonb_typeof(v_c->'breakdown'->'bar'->'bar_price_per_piece') = 'null');
    v_r := pg_temp.t_calc(v_shop, pg_temp.bar_input('1_baht', 1, '999999', 'ไม่มีราคาเว็บ ค่ามากก็ไม่ติด 2x'));
    v_log := v_log || pg_temp.chk('C8c', 'ไม่มีราคาเว็บ: เพดาน 2x ไม่ทำงาน (ไม่มีอะไรให้เทียบ) แต่ยังเป็น incomplete', v_r = 'OK');
    v_r := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 1, '1100', 'ไม่มีราคาเว็บ')), 'quoted', v_today + 5);
    v_log := v_log || pg_temp.chk('V4a', 'quoted + ไม่มีราคาเว็บวันนี้ + override → raise "ยังกรอกข้อมูลไม่ครบ"', v_r like 'ERR:22023:%ยังกรอกข้อมูลไม่ครบ%');
    v_r := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 1, '1100', 'ไม่มีราคาเว็บ')), 'draft', v_today + 5);
    v_log := v_log || pg_temp.chk('V4c', 'draft + ไม่มีราคาเว็บ + override บันทึกได้ (ตรวจตอน quoted)', v_r like 'OK:%');
    raise exception 'v163 rollback marker' using errcode = 'P0163';
  exception when sqlstate 'P0163' then null;
  end;

  begin
    update analytics.silver_price_daily set buy_per_baht = null, kilo_buy = null where shop_id = v_shop and as_of_date = v_today;
    v_c := analytics.oem_price_calc(v_shop, pg_temp.bar_input('1_baht', 1, '1100', 'ไม่มี buyback'));
    v_log := v_log || pg_temp.chk('C8d', 'ไม่มีราคารับซื้อคืนวันนี้ + override → is_complete=false + missing=silver_bar_buyback (ไม่ใช้ทุนประมาณตัดสิน)',
      not (v_c->>'is_complete')::boolean and v_c->'missing' @> '[{"rate_key":"silver_bar_buyback"}]'::jsonb
      and jsonb_typeof(v_c->'floors'->'bar_price'->'pass') = 'null');
    v_c := analytics.oem_price_calc(v_shop, pg_temp.bar_input('1_baht', 1, null, null));
    v_log := v_log || pg_temp.chk('C8e', 'ต้องไม่พัง: แถวเดียวกันที่ไม่มี override ยัง complete (fallback assumed_margin เดิม)',
      (v_c->>'is_complete')::boolean and v_c->'breakdown'->'bar'->>'cost_basis' = 'assumed_margin');
    v_r := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 1, '1100', 'ไม่มี buyback')), 'quoted', v_today + 5);
    v_log := v_log || pg_temp.chk('V4b', 'quoted + ไม่มี buyback + override → raise "ยังกรอกข้อมูลไม่ครบ"', v_r like 'ERR:22023:%ยังกรอกข้อมูลไม่ครบ%');
    v_r := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 1, null, null)), 'quoted', null);
    v_log := v_log || pg_temp.chk('C8f', 'ต้องไม่พัง: quoted แท่งราคาเว็บไม่มี override ในแถวไม่มี buyback ยังออกได้ (พฤติกรรมเดิม)', v_r like 'OK:%');
    raise exception 'v163 rollback marker' using errcode = 'P0163';
  exception when sqlstate 'P0163' then null;
  end;

  -- ========================================================================
  -- V3: override < ทุน → save quoted raise (ด่านใหม่ — ข้อความต้องเป็นของด่านใหม่ ไม่ใช่ blended<0)
  -- ========================================================================
  foreach v_val in array array['700', '749.99', '0.01'] loop
    v_r := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 2, v_val, 'ต่ำกว่าทุน')), 'quoted', v_today + 5);
    v_log := v_log || pg_temp.chk('V3/' || v_val, format('quoted override=%s < ทุน 750 → raise ต่ำกว่าทุน (แม้ใส่ approval_note) : %s', v_val, left(v_r, 90)),
      v_r like 'ERR:22023:%ราคาพิเศษต่ำกว่าทุน%');
  end loop;
  v_r := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 2, '700', 'ต่ำกว่าทุน')), 'quoted', v_today + 5, null, 0);
  v_log := v_log || pg_temp.chk('V3d', 'ไม่มี approval_note ก็ตกที่ด่านต่ำกว่าทุนเหมือนกัน (ปลดด้วยเหตุผลไม่ได้)', v_r like 'ERR:22023:%ราคาพิเศษต่ำกว่าทุน%');
  v_log := v_log || pg_temp.chk('V3e', 'ข้อความ raise ไม่มีตัวเลขราคารับซื้อคืน (750)', v_r !~ '750');
  v_r := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 2, '700', 'ต่ำกว่าทุน')), 'draft', null);
  v_log := v_log || pg_temp.chk('V3f', 'draft ราคาต่ำกว่าทุนบันทึกได้ (ด่านอยู่ตอน quoted)', v_r like 'OK:%');

  -- ========================================================================
  -- V5: วันยืนราคา
  -- ========================================================================
  v_r := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 1, '1100', 'bid')), 'quoted', v_today + 31);
  v_log := v_log || pg_temp.chk('V5a', 'quoted วัน = วันนี้+31 → raise', v_r like 'ERR:22023:%วันยืนราคา%');
  v_r := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 1, '1100', 'bid')), 'quoted', v_today - 1);
  v_log := v_log || pg_temp.chk('V5b', 'quoted วันย้อนหลัง (เมื่อวาน เวลาไทย) → raise', v_r like 'ERR:22023:%วันยืนราคา%');
  v_r := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 1, '1100', 'bid')), 'quoted', null);
  v_log := v_log || pg_temp.chk('V5c', 'quoted + มี override + วัน null → raise', v_r like 'ERR:22023:%ต้องกรอกวันยืนราคา%');
  v_r := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 1, null, null)), 'quoted', v_today + 5);
  v_log := v_log || pg_temp.chk('V5d', 'quoted ส่งวันแต่ไม่มี override → raise', v_r like 'ERR:22023:%ไม่มีรายการราคาพิเศษ%');
  v_r := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 1, null, null)), 'draft', v_today + 5);
  v_log := v_log || pg_temp.chk('V5e', 'draft ส่งวันแต่ไม่มี override → raise (ตรวจทุกครั้งที่ save)', v_r like 'ERR:22023:%ไม่มีรายการราคาพิเศษ%');
  v_r := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 1, '1100', 'bid')), 'draft', v_today - 1);
  v_log := v_log || pg_temp.chk('V5f', 'draft วันย้อนหลัง → raise', v_r like 'ERR:22023:%วันยืนราคา%');
  v_r := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 1, '1100', 'bid')), 'draft', v_today + 31);
  v_log := v_log || pg_temp.chk('V5g', 'draft วัน +31 → raise', v_r like 'ERR:22023:%วันยืนราคา%');
  v_r := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 1, '1100', 'bid')), 'quoted', 'infinity'::date);
  v_log := v_log || pg_temp.chk('V5h', 'quoted วัน infinity → raise', v_r like 'ERR:%');
  v_r := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 1, '1100', 'bid')), 'quoted', v_today + 30);
  v_log := v_log || pg_temp.chk('V5i', 'ต้องไม่พัง: quoted วัน = วันนี้+30 พอดี ผ่าน', v_r like 'OK:%');
  if v_r like 'OK:%' then
    select * into v_row from analytics.oem_quote where id = substr(v_r, 4)::uuid;
    v_log := v_log || pg_temp.chk('V5i2', 'quote_valid_until = วันนี้+30', v_row.quote_valid_until = v_today + 30);
  end if;
  v_r := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 1, '1100', 'bid')), 'quoted', v_today);
  v_log := v_log || pg_temp.chk('V5j', 'ต้องไม่พัง: quoted วัน = วันนี้ ผ่าน', v_r like 'OK:%');
  if v_r like 'OK:%' then
    select * into v_row from analytics.oem_quote where id = substr(v_r, 4)::uuid;
    v_log := v_log || pg_temp.chk('V5j2', 'quote_valid_until = วันนี้', v_row.quote_valid_until = v_today);
  end if;

  -- ========================================================================
  -- V1/V2/V11/V12: ร่าง
  -- ========================================================================
  v_r := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 2, '1100', 'bid')), 'draft', null);
  v_log := v_log || pg_temp.chk('V1a', 'draft มี override ยังไม่กรอกวัน → บันทึกได้', v_r like 'OK:%');
  if v_r like 'OK:%' then
    v_q := substr(v_r, 4)::uuid;
    select * into v_row from analytics.oem_quote where id = v_q;
    v_log := v_log || pg_temp.chk('V1b', 'draft: rate_snapshot.bar_valid_until_requested = JSON null · status draft · quote_valid_until ไม่ถูกตั้ง',
      v_row.status = 'draft' and v_row.rate_snapshot ? 'bar_valid_until_requested'
      and jsonb_typeof(v_row.rate_snapshot->'bar_valid_until_requested') = 'null' and v_row.quote_valid_until is null);
    v_log := v_log || pg_temp.chk('V1c', 'item.input เก็บ override keys ครบ (เปิดร่างกลับมา rehydrate ได้) + calc.override ตรง',
      (select (i.input->>'bar_price_override_thb')::numeric = 1100 and i.input->>'bar_price_override_reason' = 'bid'
              and (i.calc->'breakdown'->'bar'->'override'->>'thb')::numeric = 1100
         from analytics.oem_quote_item i where i.quote_id = v_q));

    -- V11: flow จริงของ UI — ร่างแล้วกด "ออกใบ" ด้วย p_quote_id เดิม + วัน
    v_r2 := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 2, '1100', 'bid')), 'quoted', v_today + 12, 'verify-note', 0, v_q);
    v_log := v_log || pg_temp.chk('V11a', 'ร่าง (override) → ออกใบด้วย p_quote_id เดิม + วัน → ผ่าน', v_r2 = 'OK:' || v_q::text);
    select * into v_row from analytics.oem_quote where id = v_q;
    v_log := v_log || pg_temp.chk('V11b', 'ใบที่ออก: quoted · quote_valid_until = +12 · snapshot วันที่ขอ = +12 · grand_total = 2 x 1100',
      v_row.status = 'quoted' and v_row.quote_valid_until = v_today + 12
      and (v_row.rate_snapshot->>'bar_valid_until_requested')::date = v_today + 12 and v_row.grand_total = 2200);
    -- V6: ใบ quoted แล้วแก้ ห้าม
    v_r := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 2, '1100', 'bid')), 'quoted', v_today + 12, 'verify-note', 0, v_q);
    v_log := v_log || pg_temp.chk('V6', 'ใบ quoted แล้วเรียก save แก้ → raise (ด่านเดิม draft เท่านั้น)', v_r like 'ERR:22023:%เฉพาะสถานะ draft%');
  end if;

  -- V12: ร่างที่มี override แล้วถอด override ออก (วันต้องหายตาม)
  v_r := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 2, '1100', 'bid')), 'draft', v_today + 3);
  if v_r like 'OK:%' then
    v_q2 := substr(v_r, 4)::uuid;
    v_r2 := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 2, null, null)), 'draft', null, null, 0, v_q2);
    select * into v_row from analytics.oem_quote where id = v_q2;
    v_log := v_log || pg_temp.chk('V12', 'ร่างถอด override + ไม่ส่งวัน → บันทึกได้ · rate_snapshot ไม่มี bar_valid_until_requested',
      v_r2 = 'OK:' || v_q2::text and not (v_row.rate_snapshot ? 'bar_valid_until_requested'));
  else
    v_log := v_log || pg_temp.chk('V12', 'สร้างร่างตั้งต้นไม่สำเร็จ: ' || v_r, false);
  end if;

  -- ========================================================================
  -- V7/V8: ต้องไม่พัง — override บวกเผื่อ · เท่าทุนพอดี
  -- ========================================================================
  v_r := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 2, '1100', 'บวกเผื่อราคาเงินขึ้น')), 'quoted', v_today + 10, null);
  v_log := v_log || pg_temp.chk('V7a', 'override = เว็บ x 1.1 quoted ผ่านโดยไม่ต้องมี approval_note', v_r like 'OK:%');
  if v_r like 'OK:%' then
    v_q := substr(v_r, 4)::uuid;
    select * into v_row from analytics.oem_quote where id = v_q;
    v_log := v_log || pg_temp.chk('V7b', 'quoted · quote_valid_until = +10 · grand_total = 2200 · margin รวม = (1100-750)/1100',
      v_row.status = 'quoted' and v_row.quote_valid_until = v_today + 10 and v_row.grand_total = 2200
      and v_row.margin_actual_pct = round((1100 - 750) / 1100.0, 4));
    v_log := v_log || pg_temp.chk('V7c', 'snapshot ใบ: bar_valid_until_requested = +10 · ราคาที่คิด 1100 / ราคาเว็บ 1000 ใน calc ของ item',
      (v_row.rate_snapshot->>'bar_valid_until_requested')::date = v_today + 10
      and (select (i.calc->'breakdown'->'bar'->>'bar_price_per_piece')::numeric = 1100
              and (i.calc->'breakdown'->'bar'->>'web_price_per_piece')::numeric = 1000
              and i.cost_piece = 750 and i.price_per_piece = 1100
           from analytics.oem_quote_item i where i.quote_id = v_q));

    -- V14: renegotiate ใบ override
    v_q2 := analytics.oem_quote_renegotiate(v_shop, v_q, 0, 'verify');
    select * into v_row from analytics.oem_quote where id = v_q2;
    v_log := v_log || pg_temp.chk('V14a', 'renegotiate ใบ override: ใบใหม่สืบทอดวันยืนราคาเดิม (+10) · สถานะ quoted',
      v_row.quote_valid_until = v_today + 10 and v_row.status = 'quoted');
    v_log := v_log || pg_temp.chk('V14b', 'ใบใหม่ copy calc/override ครบ + snapshot วันที่ขอยังอยู่ · ใบเดิม superseded',
      (select (i.calc->'breakdown'->'bar'->'override'->>'thb')::numeric = 1100 from analytics.oem_quote_item i where i.quote_id = v_q2)
      and (v_row.rate_snapshot->>'bar_valid_until_requested')::date = v_today + 10
      and (select status from analytics.oem_quote where id = v_q) = 'superseded');
  end if;

  v_r := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 2, '750', 'ขายเท่าทุน')), 'quoted', v_today + 10);
  v_log := v_log || pg_temp.chk('V8a', 'override = buyback พอดี (750) ผ่านด่านต่ำกว่าทุน → quoted สำเร็จ (มี approval_note ตามด่าน note-tier เดิม)', v_r like 'OK:%');
  v_r := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 2, '750', 'ขายเท่าทุน')), 'quoted', v_today + 10, null);
  v_log := v_log || pg_temp.chk('V8b', 'เท่าทุนแต่ไม่มี approval_note → ตกที่ note-tier เดิม (ไม่ใช่ด่านต่ำกว่าทุน) = ขอบอยู่ถูกที่',
    v_r like 'ERR:22023:%ต้องใส่เหตุผล%' and v_r not like '%ต่ำกว่าทุน ออกใบ%');

  -- ========================================================================
  -- V9: ไม่ส่ง p_bar_valid_until (9 args) · ไม่มี override = พฤติกรรมเดิม ทุกโหมดที่มีจริง
  -- ========================================================================
  v_q := analytics.oem_quote_save(
    p_shop_id => v_shop, p_items => jsonb_build_array(pg_temp.bar_item('3_baht', 1, null, null)), p_quote_id => null,
    p_status => 'quoted', p_approval_note => 'verify-note', p_customer_name => 'verify0163', p_customer_contact => null,
    p_discount_thb => 0, p_discount_reason => null);
  select * into v_row from analytics.oem_quote where id = v_q;
  v_log := v_log || pg_temp.chk('V9a', '9 named args (แบบ app เก่า) แท่งราคาเว็บ quoted → สำเร็จ · valid_until = วันนี้ (ยืน 0 วัน)',
    v_row.status = 'quoted' and v_row.quote_valid_until = v_today);
  v_log := v_log || pg_temp.chk('V9b', 'ไม่มี override: rate_snapshot ไม่มี key bar_valid_until_requested · calc ไม่มี override',
    not (v_row.rate_snapshot ? 'bar_valid_until_requested')
    and not exists (select 1 from analytics.oem_quote_item i where i.quote_id = v_q and i.calc->'breakdown'->'bar' ? 'override'));

  if v_prod_input is not null then
    v_prod_item := jsonb_build_object('input', v_prod_input);
    v_r := pg_temp.t_save(v_shop, jsonb_build_array(v_prod_item), 'quoted', null);
    v_log := v_log || pg_temp.chk('V9c', 'งานผลิต silver ล้วน (ข้อมูลจริง) quoted → สำเร็จ · valid_until = วันนี้ + ' || v_silver_days, v_r like 'OK:%');
    if v_r like 'OK:%' then
      select * into v_row from analytics.oem_quote where id = substr(v_r, 4)::uuid;
      v_log := v_log || pg_temp.chk('V9d', 'ใบงานผลิตล้วน: quote_valid_until = วันนี้ + ' || v_silver_days || ' · ไม่มี key ใหม่ใน snapshot',
        v_row.quote_valid_until = v_today + v_silver_days and not (v_row.rate_snapshot ? 'bar_valid_until_requested'));
    end if;
    v_r := pg_temp.t_save(v_shop, jsonb_build_array(v_prod_item), 'draft', v_today + 5);
    v_log := v_log || pg_temp.chk('V9e', 'งานผลิตล้วน + ส่งวันยืนราคา → raise (ไม่มี override)', v_r like 'ERR:22023:%ไม่มีรายการราคาพิเศษ%');

    -- ====================================================================
    -- V10: ใบผสมงานผลิต + แท่ง
    -- ====================================================================
    v_r := pg_temp.t_save(v_shop, jsonb_build_array(v_prod_item, pg_temp.bar_item('1_baht', 2, '1100', 'bid')), 'quoted', v_today + 10);
    if v_r like 'OK:%' then
      select * into v_row from analytics.oem_quote where id = substr(v_r, 4)::uuid;
      v_log := v_log || pg_temp.chk('V10a', format('ใบผสม (silver %s วัน) + แท่ง override +10 → valid_until = least = +%s', v_silver_days, least(v_silver_days, 10)),
        v_row.quote_valid_until = v_today + least(v_silver_days, 10));
    else
      v_log := v_log || pg_temp.chk('V10a', 'ใบผสม + override +10 ควรสำเร็จ: ' || left(v_r, 150), false);
    end if;
    v_r := pg_temp.t_save(v_shop, jsonb_build_array(v_prod_item, pg_temp.bar_item('1_baht', 2, '1100', 'bid')), 'quoted', v_today + 30);
    if v_r like 'OK:%' then
      select * into v_row from analytics.oem_quote where id = substr(v_r, 4)::uuid;
      v_log := v_log || pg_temp.chk('V10b', format('ใบผสม + แท่ง override +30 → least ฝั่งงานผลิตชนะ = +%s', least(v_silver_days, 30)),
        v_row.quote_valid_until = v_today + least(v_silver_days, 30));
    else
      v_log := v_log || pg_temp.chk('V10b', 'ใบผสม + override +30 ควรสำเร็จ: ' || left(v_r, 150), false);
    end if;
    v_r := pg_temp.t_save(v_shop, jsonb_build_array(v_prod_item, pg_temp.bar_item('1_baht', 2, '1100', 'bid'), pg_temp.bar_item('3_baht', 1, null, null)), 'quoted', v_today + 10);
    if v_r like 'OK:%' then
      select * into v_row from analytics.oem_quote where id = substr(v_r, 4)::uuid;
      v_log := v_log || pg_temp.chk('V10c', 'ใบผสม override + แท่งราคาเว็บ (ไม่มี override) → อายุ = วันนี้ (least กับ 0) · UI เตือน', v_row.quote_valid_until = v_today);
    else
      v_log := v_log || pg_temp.chk('V10c', 'ใบผสม override + แท่งเว็บควรสำเร็จ: ' || left(v_r, 150), false);
    end if;
    -- 🔴 ด่านรายชิ้นต้องไม่ถูก margin งานผลิตกลบ
    v_r := pg_temp.t_save(v_shop, jsonb_build_array(v_prod_item, pg_temp.bar_item('1_baht', 1, '700', 'ต่ำกว่าทุน')), 'quoted', v_today + 10);
    v_log := v_log || pg_temp.chk('V10d', 'ใบผสมงานผลิต margin สูง + แท่ง override < ทุน → ยัง raise (ด่านรายชิ้น ไม่ถูก blended กลบ)',
      v_r like 'ERR:22023:%ราคาพิเศษต่ำกว่าทุน%');
    -- ใบผสม + draft ไม่ส่งวัน
    v_r := pg_temp.t_save(v_shop, jsonb_build_array(v_prod_item, pg_temp.bar_item('1_baht', 2, '1100', 'bid')), 'draft', null);
    v_log := v_log || pg_temp.chk('V10e', 'ใบผสม draft + override ไม่ส่งวัน → บันทึกได้', v_r like 'OK:%');
  else
    v_log := v_log || '[SKIP] V9c-e / V10a-e ไม่มีงานผลิต silver จริงใน DB ให้ผสม' || E'\n';
  end if;

  -- V13: แท่ง 2 รายการ — รายการเดียวมี override
  v_r := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 1, '1100', 'bid'), pg_temp.bar_item('3_baht', 1, null, null)), 'quoted', v_today + 20);
  if v_r like 'OK:%' then
    select * into v_row from analytics.oem_quote where id = substr(v_r, 4)::uuid;
    v_log := v_log || pg_temp.chk('V13', 'แท่ง override + แท่งราคาเว็บในใบเดียว → อายุ = วันนี้ · grand_total = 1100 + 3000',
      v_row.quote_valid_until = v_today and v_row.grand_total = 4100);
  else
    v_log := v_log || pg_temp.chk('V13', 'ควรสำเร็จ: ' || left(v_r, 150), false);
  end if;

  -- V14c: renegotiate ใบแท่งราคาเว็บ (ไม่มี override) = พฤติกรรมเดิม (ยืนวันนี้)
  select id into v_q from analytics.oem_quote where customer_name = 'verify0163' and status = 'quoted'
    and not exists (select 1 from analytics.oem_quote_item i where i.quote_id = oem_quote.id and i.calc->'breakdown'->'bar' ? 'override')
    and exists (select 1 from analytics.oem_quote_item i where i.quote_id = oem_quote.id and i.input->>'metal' = 'silver999')
    and not exists (select 1 from analytics.oem_quote_item i where i.quote_id = oem_quote.id and i.input->>'metal' <> 'silver999')
  order by created_at limit 1;
  if v_q is not null then
    v_q2 := analytics.oem_quote_renegotiate(v_shop, v_q, 0, 'verify');
    select * into v_row from analytics.oem_quote where id = v_q2;
    v_log := v_log || pg_temp.chk('V14c', 'renegotiate ใบแท่งราคาเว็บ (ไม่มี override) → valid_until = วันนี้ เหมือนเดิม', v_row.quote_valid_until = v_today);
  end if;
  -- V14d: ใบ override ที่วันยืนราคา = วันนี้ → renegotiate ได้ ใบใหม่ = วันนี้ (greatest ไม่ติดลบ)
  v_r := pg_temp.t_save(v_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 1, '1100', 'bid')), 'quoted', v_today);
  if v_r like 'OK:%' then
    v_q2 := analytics.oem_quote_renegotiate(v_shop, substr(v_r, 4)::uuid, 0, 'verify');
    select * into v_row from analytics.oem_quote where id = v_q2;
    v_log := v_log || pg_temp.chk('V14d', 'renegotiate ใบ override ที่ยืนถึงวันนี้ → ใบใหม่ valid_until = วันนี้', v_row.quote_valid_until = v_today);
  end if;

  -- ========================================================================
  -- R: authenticated / anon เรียก 3 ฟังก์ชัน → 42501
  --    จำลองวันที่กำแพงชั้นนอกหลุด: grant usage on schema กลับเข้าไป (rollback ตอนท้าย) · พารามิเตอร์ null ล้วน
  --    ⇒ Postgres เช็ค EXECUTE ก่อน body รัน ไม่มีทางแตะข้อมูล (ข้อ 18.5)
  -- ========================================================================
  grant usage on schema analytics to authenticated;
  grant usage on schema analytics to anon;
  foreach v_role in array array['authenticated', 'anon'] loop
    foreach v_fn in array array['calc', 'save', 'reneg'] loop
      v_state := null; v_msg := null;
      execute format('set local role %I', v_role);
      begin
        if v_fn = 'calc' then
          perform analytics.oem_price_calc(null::uuid, null::jsonb);
        elsif v_fn = 'save' then
          perform analytics.oem_quote_save(null::uuid, null::jsonb, null::uuid, null::text, null::text, null::text, null::text, null::numeric, null::text, null::date);
        else
          perform analytics.oem_quote_renegotiate(null::uuid, null::uuid, null::numeric, null::text);
        end if;
      exception when others then
        get stacked diagnostics v_state = returned_sqlstate;
        v_msg := sqlerrm;
      end;
      reset role;
      v_log := v_log || pg_temp.chk('R/' || v_role || '/' || v_fn,
        format('%s เรียก %s → 42501 permission denied for function (ได้ %s: %s)', v_role, v_fn, coalesce(v_state, '(เรียกผ่าน!)'), left(coalesce(v_msg, ''), 60)),
        v_state = '42501' and v_msg ilike '%permission denied for function%');
    end loop;
  end loop;
  revoke usage on schema analytics from authenticated;
  revoke usage on schema analytics from anon;

  -- ========================================================================
  -- สรุป + บังคับ rollback ทั้งก้อน
  -- ========================================================================
  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_log := v_log || format(E'\n--- สรุป: OK %s · FAIL %s · SKIP %s ---\n',
    (length(v_log) - length(replace(v_log, '[OK]', ''))) / 4, v_fail,
    (length(v_log) - length(replace(v_log, '[SKIP]', ''))) / 6);
  raise exception '%', v_log;
end
$v163$;
