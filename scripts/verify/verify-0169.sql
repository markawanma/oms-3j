-- scripts/verify/verify-0169.sql
-- ตรวจ supabase/migrations/0169_oem_production_price_override.sql หลัง apply (หรือต่อท้ายไฟล์ 0169 ใน dry-run เดียว)
-- self-rolling-back (3j-migration-traps ข้อ 11): แตะตัวนับเลขที่ใบเสนอราคา ⇒ ทุกเคสเก็บผลลง log แล้ว raise exception ปิดท้ายเสมอ ⇒ rollback ทั้งก้อน
-- ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน · [SKIP] = พิสูจน์ไม่ได้ (ไม่มี oem_quote_item งานผลิตจริงให้ใช้เป็น fixture)
-- โครงเดียวกับ verify-0166..0168: ชุดเทสต์ pg_temp.suite69() รันใน subtransaction ที่ถอยกลับเอง · รอบแรก = ของจริง ต้อง FAIL 0 · รอบถัดไป = mutant
-- ตัวเลขทุน/ราคาสูตรคำนวณจาก oem_price_calc ตอนรัน (ใช้ rates จริงของร้าน) — ไม่เขียนค่าจริงลงไฟล์
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0169.sql
-- dry-run ก่อน apply: cat supabase/migrations/0169_*.sql scripts/verify/verify-0169.sql > tmp.sql แล้วรันไม่ใส่ --commit
--
-- ============ ตารางแมป "มติ/ข้อบรีฟ → เทสต์" ============
--  A. ราคาต่อชิ้นพิมพ์ทับของงานผลิต
--   ห้ามผ่าน  override < ทุนต่อชิ้น: S1a (มี note ก็ไม่ผ่าน · ไม่มีตัวเลขทุนในข้อความ) S1b (ใบผสม) S1d (ทอง) · O1e/O1f (calc รายงาน pass=false)
--             override ต่ำกว่า floor ไม่มี note: S2a S2d · เหตุผลไม่มี/ล่องหน/ลอย: O2c O2d O2e · override บนเงินแท่ง/สินค้า: O2f ·
--             NaN/Inf/ทศนิยม>2/<=0/>1,000,000: O2a · รายการที่ไม่มี override ด่านแข็งเดิม (hard floor/note-tier): S4a S4b S4c
--   ต้องไม่พัง override สูงกว่าราคาสูตร/เท่าราคาสูตร ไม่ต้อง note: O1a O1c O1d S3a-c · override ต่ำกว่า floor มี note: S2b S2d (gates={override_below_floor}) ·
--             เท่าทุนผ่าน: S2e · draft ต่ำกว่าทุนบันทึกได้: S1c · ไม่มี override = jsonb เดิม: O1h (+ golden replay ใน migration) · NRE: O1b (0170 เปลี่ยนให้ตาม margin ของราคาที่พิมพ์ — ดู verify-0170) ·
--             ทองใช้ความหมาย margin เดียวกับราคาสูตร: O1d · เงินแท่งส่ง key ว่าง: O2g
--  B. security 0168
--   M1+L1 oem_note_present whitelist: N0a (NEL/C0/U+2800/VS16/tag/./👍/ช่องว่าง/ล่องหนล้วน = false) N0b N0c · ทุกด่านอ่อน (MOQ N1a · note-tier N1b · F2 N1c · override N1d)
--         ไม่ผ่านด้วย note เหล่านั้น + R2a (renegotiate F2) · ผ่านด้วย note จริง N2a-d
--   L2    oem_note_valid: N0d N0e · L2a (bidi/control/C1/ล่องหน/ยาว>500 → 22023 แม้ไม่มีด่านอ่อน) · L2b (500 ตัว/อีโมจิ ZWJ/หลายบรรทัดผ่าน) · R2b (เหตุผลต่อราคา)
--   M2    approval_gates: S2b S4d S5a (หลายด่านครบ) S5b S5c · draft = null S5d · ไม่อยู่ใน rate_snapshot S2b · ไม่อยู่ใน v_oem_quote Z5
--   L3    renegotiate คัดลอก note/gates: R1 R2c
--   role  anon/authenticated ยิง helper ใหม่ → 42501: A1 · Z3 Z4 (ACL ทั้ง 5 ฟังก์ชัน)
--  mutant 13 จุด (MO1-MO13 · รวมสลับ oem_note_present เป็น "[^ ]" และสลับ MOQ gate เป็น btrim) ต้องล้มจริง
--  verify-0163/0165/0166/0167/0168 รันซ้ำต้องผ่าน (รายงานแยก)
--  ⚠️ ที่เทสต์ครอบไม่ได้: PostgREST จริง (probe แยกหลัง apply) · หน้าจอ/หน้าพิมพ์ (vitest + QA) · NEL ผ่าน L2 ไม่ได้ (C1 control) จึงตรวจ NEL ที่ระดับ helper (N0a) ด้วย

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
-- helper เฉพาะ 0169
-- ============================================================================
create function pg_temp.pj(p_prod jsonb, p_metal text, p_qty int, p_margin numeric default 0.5) returns jsonb
 language sql as $c$
  select pg_temp.pit(
    p_prod || jsonb_build_object('metal', p_metal, 'qty', p_qty, 'margin_pct', p_margin)
           || case when p_metal = 'gold' then jsonb_build_object('purity', 0.965) else '{}'::jsonb end,
    null)
$c$;

-- รายการงานผลิตที่พิมพ์ราคาต่อชิ้นทับ (p_price เป็น text เพื่อส่ง NaN/Infinity ได้ · null = ไม่ส่ง key)
create function pg_temp.pjo(p_prod jsonb, p_metal text, p_qty int, p_price text, p_reason text default null, p_margin numeric default 0.5) returns jsonb
 language sql as $c$
  select jsonb_build_object('input',
    (pg_temp.pj(p_prod, p_metal, p_qty, p_margin))->'input'
    || case when p_price is not null then jsonb_build_object('unit_price_override_thb', pg_temp.num(p_price)) else '{}'::jsonb end
    || case when p_reason is not null then jsonb_build_object('price_override_reason', p_reason) else '{}'::jsonb end)
$c$;

-- ============================================================================
-- ชุดเทสต์ 0169 — fixture อยู่ใน subtransaction ที่ถอยกลับเสมอ (เรียกซ้ำได้สำหรับ mutant)
-- ใช้ rates จริงของร้าน (ตัวเลขทุน/ราคาไม่ถูกเขียนลงไฟล์ — คำนวณจาก calc ตอนรัน) · fixture อื่นเป็นค่าสมมติ
-- ============================================================================
create function pg_temp.suite69(p_shop uuid, p_prod jsonb, p_today date) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  v_r text; v_r2 text; v_r3 text;
  v_c jsonb; v_c0 jsonb; v_cg0 jsonb;
  v_q uuid; v_row record;
  v_cost numeric; v_pf numeric; v_t numeric;
  v_costg numeric; v_pfg numeric;
  v_p_hi text; v_p_eq text; v_p_18 text; v_p_05 text; v_p_cost text; v_p_low text; v_pg_eq text; v_pg_low text;
  v_bad text; v_val text; v_n text; v_gate int;
  v_items jsonb; v_disc numeric;
  v_pa uuid;
  v_ca jsonb;
  v_gates text[];
begin
  begin
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

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
      margin_target_pct = 0.30, margin_floor_pct = 0.20, margin_hard_floor_pct = 0.15, min_job_value_thb = 1
      where shop_id = p_shop;
    insert into public.product (shop_id, sku, name, unit_cost, list_price, category, cost_type)
      values (p_shop, 'V169-A', 'สินค้าทดสอบ A169', 600, 1000, 'ทดสอบ', 'fixed') returning id into v_pa;
    v_ca := pg_temp.pit(pg_temp.pin(v_pa, 1, '1000', null, null, null), v_pa);

    -- ---- helper oem_note_present / oem_note_valid (M1 L1 L2) ----
    v_bad := '';
    foreach v_val in array array[chr(133), chr(1), chr(7), chr(10240), chr(65039), chr(917601), '.', '..', '!!!', chr(128077), '   ', '', chr(8288) || chr(65279), chr(160), chr(12288), '-', '_', '*'] loop
      if analytics.oem_note_present(v_val) then v_bad := v_bad || '[' || ascii(v_val)::text || ']'; end if;
    end loop;
    v_log := v_log || pg_temp.chk('N0a', 'oem_note_present = false: NEL(U+0085) · C0 · U+2800 · VS16 · tag · "." · "!!!" · 👍 · ช่องว่าง/NBSP/U+3000 · ล่องหนล้วน · เครื่องหมายล้วน ' || v_bad, v_bad = '');
    v_bad := '';
    foreach v_val in array array['ลูกค้าประจำ', 'approved by owner', '123', 'ok', 'ก', 'ๆ', 'ก่', 'a.', '  อนุมัติ  ', 'ok ' || chr(128104) || chr(8205) || chr(128105) || chr(8205) || chr(128103), 'บรรทัด1' || chr(10) || 'บรรทัด2'] loop
      if not analytics.oem_note_present(v_val) then v_bad := v_bad || '[' || left(v_val, 6) || ']'; end if;
    end loop;
    v_log := v_log || pg_temp.chk('N0b', 'oem_note_present = true: ไทย · อังกฤษ · เลข · อีโมจิ ZWJ + ข้อความ · หลายบรรทัด ' || v_bad, v_bad = '');
    v_log := v_log || pg_temp.chk('N0c', 'oem_note_present(null) = false', analytics.oem_note_present(null) is false);
    v_bad := '';
    foreach v_val in array array[chr(8238) || 'abc', chr(7) || 'x', chr(133) || 'x', repeat('ก', 501), chr(8203) || 'x', 'ok' || chr(8205), chr(8296) || 'x'] loop
      if analytics.oem_note_valid(v_val) then v_bad := v_bad || '[' || ascii(left(v_val, 1))::text || ']'; end if;
    end loop;
    v_log := v_log || pg_temp.chk('N0d', 'oem_note_valid = false: bidi · control · C1 · ยาว 501 · ZWSP · ZWJ ท้ายข้อความ · isolate ' || v_bad, v_bad = '');
    v_bad := '';
    foreach v_val in array array['ok', repeat('ก', 500), 'ok ' || chr(128104) || chr(8205) || chr(128105) || chr(8205) || chr(128103), 'a' || chr(9) || 'b' || chr(10) || 'c' || chr(13) || 'd', 'เหตุผลปกติ 123'] loop
      if not analytics.oem_note_valid(v_val) then v_bad := v_bad || '[' || left(v_val, 6) || ']'; end if;
    end loop;
    v_log := v_log || pg_temp.chk('N0e', 'oem_note_valid = true: ข้อความปกติ · 500 ตัวพอดี · อีโมจิ ZWJ · tab/LF/CR · null ' || v_bad, v_bad = '' and analytics.oem_note_valid(null));

    if p_prod is null then
      v_log := v_log || '[SKIP] ส่วนงานผลิต: ไม่มี oem_quote_item งานผลิตจริงให้ใช้เป็น fixture' || E'\n';
      raise exception 'suite69 rollback marker' using errcode = 'P0169';
    end if;

    -- ---- ตัวเลขอ้างอิงจาก calc (ไม่เขียนค่าจริงลงไฟล์) ----
    v_c0 := pg_temp.calc_or_null(p_shop, (pg_temp.pj(p_prod, 'silver', 50))->'input');
    v_cost := (v_c0->'breakdown'->>'cost_piece')::numeric;
    v_pf := (v_c0->'breakdown'->>'price_per_piece')::numeric;
    v_cg0 := pg_temp.calc_or_null(p_shop, (pg_temp.pj(p_prod, 'gold', 50))->'input');
    v_costg := (v_cg0->'breakdown'->>'cost_piece')::numeric;
    v_pfg := (v_cg0->'breakdown'->>'price_per_piece')::numeric;
    if v_c0 is null or not (v_c0->>'is_complete')::boolean or v_cg0 is null or not (v_cg0->>'is_complete')::boolean then
      v_log := v_log || '[SKIP] ส่วนงานผลิต: fixture เงิน/ทอง 50 ชิ้นคำนวณไม่ครบวันนี้' || E'\n';
      raise exception 'suite69 rollback marker' using errcode = 'P0169';
    end if;
    v_p_hi := round(ceil(v_pf * 1.2 * 100) / 100, 2)::text;
    v_p_eq := round(v_pf, 2)::text;
    v_p_18 := round(ceil(v_cost / 0.82 * 100) / 100, 2)::text;
    v_p_05 := round(ceil(v_cost / 0.95 * 100) / 100, 2)::text;
    v_p_cost := round(ceil((v_cost + 0.01) * 100) / 100, 2)::text;
    v_p_low := round(floor(v_cost * 0.9 * 100) / 100, 2)::text;
    v_pg_eq := round(v_pfg, 2)::text;
    v_pg_low := round(floor(v_costg * 0.9 * 100) / 100, 2)::text;

    -- ========================================================================
    -- O: calc — ราคาต่อชิ้นพิมพ์ทับ
    -- ========================================================================
    v_c := pg_temp.calc_or_null(p_shop, (pg_temp.pjo(p_prod, 'silver', 50, v_p_hi, 'ลูกค้าประจำ ขอราคานี้'))->'input');
    v_log := v_log || pg_temp.chk('O1a', 'override สูงกว่าราคาสูตร: price_per_piece = ราคาที่พิมพ์ · production_override {thb, reason, formula_price_per_piece} · price_vs_cost.pass=true · state ok',
      v_c is not null and (v_c->'breakdown'->>'price_per_piece')::numeric = v_p_hi::numeric
      and (v_c->'breakdown'->'production_override'->>'thb')::numeric = v_p_hi::numeric
      and v_c->'breakdown'->'production_override'->>'reason' = 'ลูกค้าประจำ ขอราคานี้'
      and (v_c->'breakdown'->'production_override'->>'formula_price_per_piece')::numeric = v_pf
      and (v_c->'floors'->'price_vs_cost'->>'pass')::boolean and (v_c->'floors'->'price_vs_cost'->>'applies')::boolean
      and v_c->'floors'->'margin'->>'state' = 'ok');
    v_log := v_log || pg_temp.chk('O1b', 'ยอดรวม = NRE (ตั้งแต่ 0170 ตาม margin ของราคาที่พิมพ์ — ไม่ต่ำกว่าทุน NRE · รายละเอียดล็อกใน verify-0170) + ปัดสองตำแหน่ง(จำนวน x ราคาที่พิมพ์) · margin_actual คิดจากราคาที่พิมพ์ · cost_piece เท่าสูตร',
      (v_c->'breakdown'->>'quote_total')::numeric = (v_c->'breakdown'->'nre'->>'price')::numeric + round(50 * v_p_hi::numeric, 2)
      and (v_c->'breakdown'->'nre'->>'price')::numeric >= (v_c->'breakdown'->'nre'->>'cost')::numeric
      and (v_c->'breakdown'->>'cost_piece')::numeric = v_cost
      and (v_c->'breakdown'->>'margin_actual_pct')::numeric = round((v_p_hi::numeric - v_cost) / v_p_hi::numeric, 4));
    v_c := pg_temp.calc_or_null(p_shop, (pg_temp.pjo(p_prod, 'silver', 50, v_p_eq, 'เท่าราคาสูตร'))->'input');
    v_log := v_log || pg_temp.chk('O1c', 'override = ราคาสูตร (ปัด 2 ตำแหน่ง): margin ที่ตัดสิน ≈ margin % ที่ใช้คิด (0.5) — ความหมายเท่ากับราคาสูตร',
      v_c is not null and abs((v_c->'floors'->'margin'->>'value')::numeric - 0.5) < 0.005);
    v_c := pg_temp.calc_or_null(p_shop, (pg_temp.pjo(p_prod, 'gold', 50, v_pg_eq, 'เท่าราคาสูตร'))->'input');
    v_log := v_log || pg_temp.chk('O1d', 'ทอง (pass-through) override = ราคาสูตร: margin ที่ตัดสิน ≈ 0.5 (margin คิดเฉพาะค่ากำเหน็จ ไม่ทับเนื้อทอง = ความหมายเดียวกับราคาต่อชิ้นที่ระบบแสดง)',
      v_c is not null and abs((v_c->'floors'->'margin'->>'value')::numeric - 0.5) < 0.01);
    v_c := pg_temp.calc_or_null(p_shop, (pg_temp.pjo(p_prod, 'silver', 50, v_p_low, 'ทดสอบต่ำกว่าทุน'))->'input');
    v_log := v_log || pg_temp.chk('O1e', 'override ต่ำกว่าทุนต่อชิ้น: price_vs_cost.pass=false · state hard_floor_breach (calc ยังคำนวณให้ดู · ออกใบไม่ได้ที่ save)',
      v_c is not null and not (v_c->'floors'->'price_vs_cost'->>'pass')::boolean and v_c->'floors'->'margin'->>'state' = 'hard_floor_breach');
    v_c := pg_temp.calc_or_null(p_shop, (pg_temp.pjo(p_prod, 'gold', 50, v_pg_low, 'ทดสอบต่ำกว่าทุน'))->'input');
    v_log := v_log || pg_temp.chk('O1f', 'ทอง override ต่ำกว่าทุนต่อชิ้น (cost_piece รวมเนื้อทอง): pass=false', v_c is not null and not (v_c->'floors'->'price_vs_cost'->>'pass')::boolean);
    v_c := pg_temp.calc_or_null(p_shop, (pg_temp.pjo(p_prod, 'silver', 50, v_p_18, 'ลดให้ลูกค้า'))->'input');
    v_log := v_log || pg_temp.chk('O1g', 'override margin ~18% (ต่ำกว่า floor 20% สูงกว่าทุน): state needs_approval_note · price_vs_cost pass',
      v_c is not null and v_c->'floors'->'margin'->>'state' = 'needs_approval_note' and (v_c->'floors'->'price_vs_cost'->>'pass')::boolean);
    v_c := pg_temp.calc_or_null(p_shop, (pg_temp.pj(p_prod, 'silver', 50))->'input');
    v_log := v_log || pg_temp.chk('O1h', 'ไม่มี override: ไม่มี key production_override / price_vs_cost เลย (jsonb เดิม) · margin.value = margin % ที่ใช้คิด',
      v_c is not null and not (v_c->'breakdown' ? 'production_override') and not (v_c->'floors' ? 'price_vs_cost') and (v_c->'floors'->'margin'->>'value')::numeric = 0.5);

    -- รูปร่างที่ห้ามผ่าน
    v_bad := '';
    foreach v_val in array array['0', '-1', 'NaN', 'Infinity', '-Infinity', '1000000.01', '1.005', 'abc', '1e7'] loop
      v_r := pg_temp.t_calc(p_shop, (pg_temp.pjo(p_prod, 'silver', 50, v_val, 'เหตุผลทดสอบ'))->'input');
      if v_r not like 'ERR:22023:%' then v_bad := v_bad || '[' || v_val || ']=' || left(v_r, 30) || ' '; end if;
    end loop;
    v_log := v_log || pg_temp.chk('O2a', 'override 0 / ติดลบ / NaN / Infinity / >1,000,000 / ทศนิยม 3 ตำแหน่ง / ไม่ใช่เลข → 22023 ทุกค่า ' || v_bad, v_bad = '');
    v_r := pg_temp.t_calc(p_shop, (pg_temp.pjo(p_prod, 'silver', 50, (floor(v_pf * 3 * 100) / 100)::text, 'เหตุผลทดสอบ'))->'input');
    v_log := v_log || pg_temp.chk('O2b', 'ต้องไม่พัง: override = 3 เท่าของราคาสูตร (ขอบเพดาน 0171: floor 2 ตำแหน่ง) ผ่านด่านรูปร่าง — เดิมทดสอบ 1,000,000 ซึ่ง 0171 ปฏิเสธเพราะเกิน 3 เท่า', v_r = 'OK');
    v_bad := '';
    foreach v_val in array array[chr(133), chr(1), chr(10240), chr(65039), chr(917601), '.', chr(128077), '   ', chr(8288) || chr(65279), '!!!'] loop
      v_r := pg_temp.t_calc(p_shop, (pg_temp.pjo(p_prod, 'silver', 50, v_p_hi, v_val))->'input');
      if v_r not like 'ERR:22023:%' then v_bad := v_bad || '[' || ascii(left(v_val, 1))::text || ']=' || left(v_r, 30) || ' '; end if;
    end loop;
    v_log := v_log || pg_temp.chk('O2c', 'override + เหตุผลเป็น NEL / C0 / U+2800 / VS16 / tag / "." / 👍 / ช่องว่าง / ล่องหนล้วน → 22023 (whitelist) ' || v_bad, v_bad = '');
    v_r := pg_temp.t_calc(p_shop, (pg_temp.pj(p_prod, 'silver', 50))->'input' || jsonb_build_object('unit_price_override_thb', v_p_hi::numeric));
    v_log := v_log || pg_temp.chk('O2d', 'override ไม่มีเหตุผลเลย → 22023', v_r like 'ERR:22023:%เหตุผล%');
    v_r := pg_temp.t_calc(p_shop, (pg_temp.pj(p_prod, 'silver', 50))->'input' || jsonb_build_object('price_override_reason', 'เหตุผลลอย'));
    v_log := v_log || pg_temp.chk('O2e', 'เหตุผลลอย (ไม่มีราคาที่พิมพ์) → 22023', v_r like 'ERR:22023:%มีเหตุผล%ไม่มีราคา%');
    v_r := pg_temp.t_calc(p_shop, jsonb_build_object('metal', 'silver999', 'bar_size', '1_baht', 'qty', 1, 'unit_price_override_thb', 900, 'price_override_reason', 'x'));
    v_r2 := pg_temp.t_calc(p_shop, jsonb_build_object('metal', 'product', 'qty', 1, 'unit_price_thb', 10, 'unit_cost_thb', 1, 'product_name', 'ทดสอบ169', 'unit_price_override_thb', 9));
    v_log := v_log || pg_temp.chk('O2f', 'override บนเงินแท่ง / สินค้า → 22023 (ใช้ได้กับงานผลิตเท่านั้น)', v_r like 'ERR:22023:%งานผลิต%' and v_r2 like 'ERR:22023:%งานผลิต%');
    v_r := pg_temp.t_calc(p_shop, jsonb_build_object('metal', 'silver999', 'bar_size', '1_baht', 'qty', 1, 'unit_price_override_thb', null, 'price_override_reason', ''));
    v_log := v_log || pg_temp.chk('O2g', 'ต้องไม่พัง: เงินแท่งที่ส่ง key เป็น null / ว่าง ผ่านเหมือนเดิม', v_r = 'OK');

    -- ========================================================================
    -- S: save — ต่ำกว่าทุน (แข็ง) · ต่ำกว่า floor (ด่านอ่อน) · ด่านเดิมของรายการที่ไม่มี override
    -- ========================================================================
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjo(p_prod, 'silver', 50, v_p_low, 'ทดสอบต่ำกว่าทุน')), 'quoted', 'อนุมัติโดยเจ้าของ');
    v_log := v_log || pg_temp.chk('S1a', 'override ต่ำกว่าทุนต่อชิ้น quoted แม้มี note → 22023 "ราคาที่พิมพ์ต่ำกว่าทุนต่อชิ้น ออกใบไม่ได้" · ข้อความไม่มีตัวเลขทุน',
      v_r like 'ERR:22023:%ราคาที่พิมพ์ต่ำกว่าทุนต่อชิ้น ออกใบไม่ได้%' and position(round(v_cost, 2)::text in v_r) = 0 and position(round(v_cost, 0)::text || '.' in v_r) = 0);
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'silver', 50), pg_temp.pjo(p_prod, 'silver', 50, v_p_low, 'ทดสอบต่ำกว่าทุน')), 'quoted', 'อนุมัติโดยเจ้าของ');
    v_log := v_log || pg_temp.chk('S1b', 'ใบผสม: รายการปกติ + รายการ override ต่ำกว่าทุน (margin รวมยังบวก) → 22023 รายชิ้น ไม่ถูกกลบด้วยรายการอื่น', v_r like 'ERR:22023:%ราคาที่พิมพ์ต่ำกว่าทุนต่อชิ้น%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjo(p_prod, 'silver', 50, v_p_low, 'ทดสอบต่ำกว่าทุน')), 'draft', null);
    v_log := v_log || pg_temp.chk('S1c', 'ต้องไม่พัง: ต่ำกว่าทุนบันทึกเป็น draft ได้ (calc คืน pass=false ให้เตือน)', v_r like 'OK:%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjo(p_prod, 'gold', 50, v_pg_low, 'ทดสอบต่ำกว่าทุน')), 'quoted', 'อนุมัติโดยเจ้าของ');
    v_log := v_log || pg_temp.chk('S1d', 'ทอง override ต่ำกว่าทุนต่อชิ้น quoted → 22023', v_r like 'ERR:22023:%ราคาที่พิมพ์ต่ำกว่าทุนต่อชิ้น%');

    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjo(p_prod, 'silver', 50, v_p_18, 'ลดให้ลูกค้า')), 'quoted', null);
    v_log := v_log || pg_temp.chk('S2a', 'override ต่ำกว่า floor (margin ~18%) ไม่มี approval_note → 22023 "ราคาที่พิมพ์ทำให้ margin ต่ำกว่า floor — ต้องใส่เหตุผลอนุมัติ"', v_r like 'ERR:22023:%ราคาที่พิมพ์ทำให้ margin ต่ำกว่า floor%ต้องใส่เหตุผลอนุมัติ%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjo(p_prod, 'silver', 50, v_p_18, 'ลดให้ลูกค้า')), 'quoted', 'อนุมัติโดยเจ้าของ');
    v_q := pg_temp.qid(v_r);
    select * into v_row from analytics.oem_quote where id = v_q;
    v_log := v_log || pg_temp.chk('S2b', 'ต้องไม่พัง: ใบเดียวกันมี note → ออกใบได้ · เก็บ approval_note · approval_gates = {override_below_floor} · rate_snapshot ไม่มี approval_gates',
      v_r like 'OK:%' and v_row.approval_note = 'อนุมัติโดยเจ้าของ' and v_row.approval_gates = array['override_below_floor']::text[]
      and position('approval_gates' in v_row.rate_snapshot::text) = 0);
    select (i.calc->'breakdown'->'production_override'->>'reason') = 'ลดให้ลูกค้า' and i.price_per_piece = v_p_18::numeric and i.margin_charged_pct < 0.2
      into v_bad from analytics.oem_quote_item i where i.quote_id = v_q and i.seq = 1;
    v_log := v_log || pg_temp.chk('S2c', 'item ที่เก็บ: price_per_piece = ราคาที่พิมพ์ · snapshot override/เหตุผลอยู่ใน calc · margin_charged_pct = margin ของราคานั้น', v_bad::boolean);
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjo(p_prod, 'silver', 50, v_p_05, 'ปิดดีลใหญ่')), 'quoted', null);
    v_r2 := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjo(p_prod, 'silver', 50, v_p_05, 'ปิดดีลใหญ่')), 'quoted', 'อนุมัติโดยเจ้าของ');
    v_log := v_log || pg_temp.chk('S2d', 'override margin ~5% (ต่ำกว่า hard floor ของสูตร แต่สูงกว่าทุน): ไม่มี note → 22023 · มี note → ผ่าน (ด่านอ่อน — ต่างจากราคาจากสูตรที่ hard floor แข็ง)',
      v_r like 'ERR:22023:%margin ต่ำกว่า floor%' and v_r2 like 'OK:%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjo(p_prod, 'silver', 50, v_p_cost, 'ขายเท่าทุน')), 'quoted', 'อนุมัติโดยเจ้าของ');
    v_log := v_log || pg_temp.chk('S2e', 'override เท่าทุน (>= ทุน เล็กน้อย) มี note → ผ่าน (ขอบ: ต่ำกว่าทุนเท่านั้นที่แข็ง)', v_r like 'OK:%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjo(p_prod, 'silver', 50, v_p_hi, 'ลูกค้าประจำ ขอราคานี้')), 'quoted', null);
    v_q := pg_temp.qid(v_r);
    v_log := v_log || pg_temp.chk('S3a', 'ต้องไม่พัง: override สูงกว่าราคาสูตร ไม่ต้องมี note · approval_gates = null · approved_by ว่าง',
      v_r like 'OK:%' and (select approval_gates is null and approval_note is null from analytics.oem_quote where id = v_q));
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjo(p_prod, 'silver', 50, v_p_eq, 'เท่าราคาสูตร')), 'quoted', null);
    v_log := v_log || pg_temp.chk('S3b', 'ต้องไม่พัง: override = ราคาสูตร ไม่ต้องมี note', v_r like 'OK:%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjo(p_prod, 'gold', 50, v_pg_eq, 'เท่าราคาสูตร')), 'quoted', null);
    v_log := v_log || pg_temp.chk('S3c', 'ต้องไม่พัง: ทอง override = ราคาสูตร ไม่ต้องมี note', v_r like 'OK:%');

    -- ด่านรายชิ้นเดิมของราคาที่มาจากสูตร "ยังแข็ง" (ไม่ผ่อนเพราะมี override ในใบ)
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'silver', 50, 0.10)), 'quoted', 'อนุมัติโดยเจ้าของ');
    v_log := v_log || pg_temp.chk('S4a', 'งานผลิตที่ไม่มี override margin 10% (< hard floor) แม้มี note → 22023 hard floor ยังแข็งเหมือนเดิม', v_r like 'ERR:22023:%hard floor%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjo(p_prod, 'silver', 50, v_p_hi, 'ลูกค้าประจำ ขอราคานี้'), pg_temp.pj(p_prod, 'silver', 50, 0.10)), 'quoted', 'อนุมัติโดยเจ้าของ');
    v_log := v_log || pg_temp.chk('S4b', 'ใบผสม override ราคาสูง + รายการจากสูตร margin 10% → 22023 hard floor (override ไม่ช่วยผ่อนรายการอื่น)', v_r like 'ERR:22023:%hard floor%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'silver', 50, 0.18)), 'quoted', null);
    v_r2 := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'silver', 50, 0.18)), 'quoted', 'ลูกค้าประจำ');
    v_log := v_log || pg_temp.chk('S4c', 'ต้องไม่พัง: รายการจากสูตร margin 18% ไม่มี note → 22023 note-tier เดิม · มี note → ผ่าน', v_r like 'ERR:22023:%ต้องใส่เหตุผล%' and v_r2 like 'OK:%');
    select approval_gates into v_gates from analytics.oem_quote where id = pg_temp.qid(v_r2);
    v_log := v_log || pg_temp.chk('S4d', 'approval_gates ของใบ S4c = {margin_note_tier}', v_gates = array['margin_note_tier']::text[]);

    -- ทุกด่านที่ติด แสดงครบ (gates ทั้งชุด)
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjo(p_prod, 'silver', 50, v_p_18, 'ลดให้ลูกค้า'), pg_temp.pj(p_prod, 'silver', 3), pg_temp.pj(p_prod, 'silver', 50, 0.18)), 'quoted', 'อนุมัติโดยเจ้าของ');
    select approval_gates into v_gates from analytics.oem_quote where id = pg_temp.qid(v_r);
    v_log := v_log || pg_temp.chk('S5a', 'ใบที่ติดหลายด่านอ่อนพร้อมกัน (MOQ + override ต่ำกว่า floor + note-tier) → approval_gates ครบทุกตัว',
      v_r like 'OK:%' and v_gates @> array['moq', 'override_below_floor', 'margin_note_tier']::text[] and cardinality(v_gates) = 3);
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'gold', 3)), 'quoted', 'อนุมัติโดยเจ้าของ');
    select approval_gates into v_gates from analytics.oem_quote where id = pg_temp.qid(v_r);
    v_log := v_log || pg_temp.chk('S5b', 'ทอง 3 ชิ้น (MOQ + ล็อตทอง) → approval_gates = {metal_lot, moq}', v_gates @> array['moq', 'metal_lot']::text[] and cardinality(v_gates) = 2);
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'silver', 50), pg_temp.pit(pg_temp.pin(null, 1, '1000', '0.01', 'svc-big169', null), null)), 'quoted', 'อนุมัติโดยเจ้าของ', 100);
    select approval_gates into v_gates from analytics.oem_quote where id = pg_temp.qid(v_r);
    v_log := v_log || pg_temp.chk('S5c', 'ทุน manual + ส่วนลด (F2) → approval_gates มี manual_cost', v_r like 'OK:%' and v_gates @> array['manual_cost']::text[]);
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjo(p_prod, 'silver', 50, v_p_18, 'ลดให้ลูกค้า')), 'draft', 'อนุมัติโดยเจ้าของ');
    v_log := v_log || pg_temp.chk('S5d', 'draft ไม่เก็บ approval_gates (null) — เก็บเฉพาะใบ quoted', (select approval_gates is null from analytics.oem_quote where id = pg_temp.qid(v_r)));

    -- ========================================================================
    -- N: note ที่ไม่ผ่าน whitelist — ทุกด่านอ่อน (MOQ · note-tier · F2 · override ต่ำกว่า floor)
    -- ========================================================================
    for v_gate in 1..4 loop
      v_items := case v_gate
        when 1 then jsonb_build_array(pg_temp.pj(p_prod, 'silver', 3))
        when 2 then jsonb_build_array(pg_temp.pj(p_prod, 'silver', 50, 0.18))
        when 3 then jsonb_build_array(pg_temp.pj(p_prod, 'silver', 50), pg_temp.pit(pg_temp.pin(null, 1, '1000', '0.01', 'svc-big169', null), null))
        else jsonb_build_array(pg_temp.pjo(p_prod, 'silver', 50, v_p_18, 'ลดให้ลูกค้า')) end;
      v_disc := case when v_gate = 3 then 100 else 0 end;
      v_bad := '';
      foreach v_val in array array[chr(133), chr(1), chr(10240), chr(65039), chr(917601), '.', chr(128077), '   ', chr(8288) || chr(65279), '!!!', chr(8238) || 'x', repeat('ก', 501)] loop
        v_r := pg_temp.t_save(p_shop, v_items, 'quoted', v_val, v_disc);
        if v_r like 'OK:%' then v_bad := v_bad || '[' || ascii(left(v_val, 1))::text || ']'; end if;
      end loop;
      v_log := v_log || pg_temp.chk('N1' || (array['a', 'b', 'c', 'd'])[v_gate],
        'ด่านอ่อน ' || (array['MOQ', 'note-tier margin', 'ทุน manual + ส่วนลด (F2)', 'override ต่ำกว่า floor'])[v_gate] ||
        ': note เป็น NEL / C0 / U+2800 / VS16 / tag / "." / 👍 / ช่องว่าง / ล่องหน / "!!!" / bidi / ยาว 501 → ไม่ผ่านทุกตัว ' || v_bad, v_bad = '');
      v_r := pg_temp.t_save(p_shop, v_items, 'quoted', 'อนุมัติโดยเจ้าของ', v_disc);
      v_r2 := pg_temp.t_save(p_shop, v_items, 'quoted', '123', v_disc);
      v_r3 := pg_temp.t_save(p_shop, v_items, 'quoted', 'approved by owner ' || chr(128077), v_disc);
      v_log := v_log || pg_temp.chk('N2' || (array['a', 'b', 'c', 'd'])[v_gate],
        'ต้องไม่พัง: note ไทยปกติ / เลขล้วน / อังกฤษ+อีโมจิ ผ่านด่านอ่อนเดียวกัน', v_r like 'OK:%' and v_r2 like 'OK:%' and v_r3 like 'OK:%');
    end loop;

    -- L2: note ที่เก็บ — ตรวจแม้ไม่มีด่านอ่อน (ใบปกติ)
    v_bad := '';
    foreach v_val in array array[chr(8238) || 'ok', chr(7) || 'ok', chr(133) || 'ok', repeat('ก', 501), chr(8203) || 'ok', 'ok' || chr(8296)] loop
      v_r := pg_temp.t_save(p_shop, jsonb_build_array(v_ca), 'quoted', v_val);
      if v_r not like 'ERR:22023:%' then v_bad := v_bad || '[' || ascii(left(v_val, 1))::text || ']'; end if;
    end loop;
    v_log := v_log || pg_temp.chk('L2a', 'approval_note มี bidi / control / C1 / ล่องหน / ยาว 501 → 22023 แม้ใบนี้ไม่ต้องใช้ note ' || v_bad, v_bad = '');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(v_ca), 'quoted', repeat('ก', 500));
    v_r2 := pg_temp.t_save(p_shop, jsonb_build_array(v_ca), 'quoted', 'ok ' || chr(128104) || chr(8205) || chr(128105) || chr(8205) || chr(128103));
    v_r3 := pg_temp.t_save(p_shop, jsonb_build_array(v_ca), 'quoted', 'บรรทัด1' || chr(10) || 'บรรทัด2');
    v_log := v_log || pg_temp.chk('L2b', 'ต้องไม่พัง: 500 ตัวพอดี · อีโมจิครอบครัว (ZWJ) · หลายบรรทัด ผ่าน', v_r like 'OK:%' and v_r2 like 'OK:%' and v_r3 like 'OK:%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(v_ca), 'quoted', null);
    v_log := v_log || pg_temp.chk('L2c', 'ต้องไม่พัง: ใบปกติไม่มี note ผ่านเหมือนเดิม', v_r like 'OK:%');

    -- ========================================================================
    -- R: renegotiate — คัดลอก note/approved_by/gates (L3) · whitelist · L2
    -- ========================================================================
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'silver', 3)), 'quoted', 'อนุมัติโดยเจ้าของ');
    v_q := pg_temp.qid(v_r);
    v_r2 := pg_temp.t_reneg(p_shop, v_q, 0, null);
    select * into v_row from analytics.oem_quote where id = pg_temp.qid(v_r2);
    v_log := v_log || pg_temp.chk('R1', 'ต่อรองใบที่ออกด้วย note (MOQ): ใบลูกได้ approval_note เดิม + approval_gates {moq} (เดิมหายตอนต่อราคา)',
      v_r2 like 'OK:%' and v_row.approval_note = 'อนุมัติโดยเจ้าของ' and v_row.approval_gates = array['moq']::text[]);
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'silver', 50), pg_temp.pit(pg_temp.pin(null, 1, '1000', '0.01', 'svc-big169', null), null)), 'quoted', null, 0);
    v_q := pg_temp.qid(v_r);
    v_t := (pg_temp.calc_or_null(p_shop, (pg_temp.pj(p_prod, 'silver', 50))->'input')->'breakdown'->>'quote_total')::numeric;
    v_bad := '';
    foreach v_val in array array[chr(10240), '.', chr(128077), '   ', chr(65039), chr(917601)] loop
      v_r2 := pg_temp.t_reneg(p_shop, v_q, round(v_t * 0.1, 2), v_val);
      if v_r2 like 'OK:%' then v_bad := v_bad || '[' || ascii(left(v_val, 1))::text || ']'; end if;
    end loop;
    v_log := v_log || pg_temp.chk('R2a', 'ต่อรองใบที่มีทุน manual + ส่วนลดใหม่: เหตุผลเป็น U+2800 / "." / 👍 / ช่องว่าง / VS16 / tag → 22023 (F2 ใช้ whitelist) ' || v_bad, v_bad = '');
    v_r2 := pg_temp.t_reneg(p_shop, v_q, round(v_t * 0.1, 2), chr(7) || 'x');
    v_log := v_log || pg_temp.chk('R2b', 'เหตุผลต่อราคามี control char → 22023 (L2)', v_r2 like 'ERR:22023:%อักขระควบคุม%');
    v_r2 := pg_temp.t_reneg(p_shop, v_q, round(v_t * 0.1, 2), 'ต่อรองกับลูกค้า');
    select * into v_row from analytics.oem_quote where id = pg_temp.qid(v_r2);
    v_log := v_log || pg_temp.chk('R2c', 'เหตุผลจริง → ผ่าน · approval_gates ของใบลูกมี manual_cost (ด่านอ่อนที่ใช้ตอนต่อราคา)', v_r2 like 'OK:%' and v_row.approval_gates = array['manual_cost']::text[]);

    raise exception 'suite69 rollback marker' using errcode = 'P0169';
  exception
    when sqlstate 'P0169' then null;
    when others then
      v_log := v_log || format(E'[FAIL] ABORT ชุดเทสต์ล้มกลางทาง sqlstate=%s msg=%s\n', sqlstate, left(sqlerrm, 300));
  end;
  return v_log;
end;
$s$;

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

do $v169$
declare
  v_log text := E'\n=== verify 0169 (ราคาต่อชิ้นพิมพ์ทับของงานผลิต + แก้ตาม security 0168) ===\n';
  v_shop uuid;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_prod_input jsonb;
  v_s text;
  v_cnt int;
  v_fail int;
  v_ok int;
  v_m record;
  v_id text;
  v_killed int := 0;
  v_total int := 0;
  v_survived text := '';
  v_orig record;
  v_role text;
  v_fn text;
  v_res text;
  v_sav text := 'analytics.oem_quote_save(uuid,jsonb,uuid,text,text,text,text,numeric,text,date,uuid)';
  v_ren text := 'analytics.oem_quote_renegotiate(uuid,uuid,numeric,text)';
  v_calc text := 'analytics.oem_price_calc(uuid,jsonb)';
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select count(*) into v_cnt from public.shop;
  if v_cnt <> 1 then
    raise exception 'verify-0169 หยุด: public.shop มี % ร้าน (ไฟล์นี้ออกแบบสำหรับร้านเดียว)', v_cnt;
  end if;
  select id into v_shop from public.shop;
  select input into v_prod_input from analytics.oem_quote_item where input->>'metal' = 'silver' order by created_at limit 1;

  -- Z: โครงสร้าง / สิทธิ์
  select count(*) into v_cnt from pg_proc where pronamespace = 'analytics'::regnamespace
    and proname in ('oem_price_calc', 'oem_quote_save', 'oem_quote_renegotiate', 'oem_note_present', 'oem_note_valid');
  v_log := v_log || pg_temp.chk('Z1', format('5 ฟังก์ชัน = 5 แถวใน pg_proc (ไม่มี overload) ได้ %s', v_cnt), v_cnt = 5);
  select count(*) into v_cnt from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'oem_price_calc_legacy';
  v_log := v_log || pg_temp.chk('Z2', 'ไม่มี oem_price_calc_legacy ค้าง', v_cnt = 0);
  select count(*) into v_cnt from pg_proc p
    where p.pronamespace = 'analytics'::regnamespace and p.proname in ('oem_price_calc', 'oem_quote_save', 'oem_quote_renegotiate', 'oem_note_present', 'oem_note_valid')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
           or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0));
  v_log := v_log || pg_temp.chk('Z3', 'ไม่มี execute ให้ anon / authenticated / PUBLIC ทั้ง 5 ฟังก์ชัน', v_cnt = 0);
  select count(*) into v_cnt from pg_proc p
    where p.pronamespace = 'analytics'::regnamespace and p.proname in ('oem_note_present', 'oem_note_valid') and has_function_privilege('service_role', p.oid, 'execute');
  v_log := v_log || pg_temp.chk('Z4', 'service_role execute helper ใหม่ได้ทั้ง 2 ตัว', v_cnt = 2);
  v_log := v_log || pg_temp.chk('Z5', 'คอลัมน์ analytics.oem_quote.approval_gates (text[]) มีอยู่ · ไม่อยู่ใน v_oem_quote (ไม่เข้า view ที่หน้าพิมพ์อ่าน)',
    exists (select 1 from information_schema.columns where table_schema = 'analytics' and table_name = 'oem_quote' and column_name = 'approval_gates' and udt_name = '_text')
    and not exists (select 1 from information_schema.columns where table_schema = 'analytics' and table_name = 'v_oem_quote' and column_name = 'approval_gates'));

  -- A: role อื่นยิง helper/ฟังก์ชัน (จำลองกำแพงชั้นนอกหลุด)
  grant usage on schema analytics to authenticated;
  grant usage on schema analytics to anon;
  v_cnt := 0;
  foreach v_role in array array['authenticated', 'anon'] loop
    foreach v_fn in array array['oem_note_present', 'oem_note_valid'] loop
      begin
        execute format('set local role %I', v_role);
        begin
          if v_fn = 'oem_note_present' then perform analytics.oem_note_present('x'); else perform analytics.oem_note_valid('x'); end if;
          v_cnt := v_cnt + 1;
        exception when insufficient_privilege then
          null;
        when others then
          v_cnt := v_cnt + 1;
        end;
        reset role;
      exception when others then
        reset role;
        v_cnt := v_cnt + 1;
      end;
    end loop;
  end loop;
  revoke usage on schema analytics from authenticated;
  revoke usage on schema analytics from anon;
  v_log := v_log || pg_temp.chk('A1', 'authenticated / anon เรียก oem_note_present / oem_note_valid → 42501 ทุกคู่ (4 คู่) · รั่ว = ' || v_cnt, v_cnt = 0);

  create temp table _v169_orig on commit drop as
    select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def, md5(pg_get_functiondef(p.oid)) as h
    from pg_proc p where p.pronamespace = 'analytics'::regnamespace
      and p.proname in ('oem_price_calc', 'oem_quote_save', 'oem_quote_renegotiate', 'oem_note_present', 'oem_note_valid');

  v_s := pg_temp.suite69(v_shop, v_prod_input, v_today);
  v_log := v_log || v_s;
  v_fail := (length(v_s) - length(replace(v_s, '[FAIL]', ''))) / 6;
  v_ok := (length(v_s) - length(replace(v_s, '[OK]', ''))) / 4;
  v_log := v_log || format(E'--- ชุดเทสต์หลัก: OK %s / FAIL %s\n', v_ok, v_fail);

  -- mutant: แก้ฟังก์ชันจริงทีละจุด · ชุดเทสต์ต้องล้มที่ id ที่ระบุ
  for v_m in
    select * from (values
      ('MO1', 'analytics.oem_price_calc(uuid,jsonb)', 'v_pvc_pass := (v_po >= v_cost_piece);', 'v_pvc_pass := true;', array['O1e', 'O1f']),
      ('MO2', 'analytics.oem_quote_save(uuid,jsonb,uuid,text,text,text,text,numeric,text,date,uuid)',
        'if v_ovr_below_cost_seq is not null then', 'if false and v_ovr_below_cost_seq is not null then', array['S1a', 'S1b', 'S1d']),
      ('MO3', 'analytics.oem_quote_save(uuid,jsonb,uuid,text,text,text,text,numeric,text,date,uuid)',
        'if v_gate_override and not analytics.oem_note_present(p_approval_note) then', 'if false and v_gate_override and not analytics.oem_note_present(p_approval_note) then', array['S2a', 'S2d', 'N1d']),
      ('MO4', 'analytics.oem_quote_save(uuid,jsonb,uuid,text,text,text,text,numeric,text,date,uuid)',
        E'and not analytics.oem_note_present(p_approval_note) then\n      raise exception ''oem_quote_save: ต่ำกว่า MOQ',
        E'and (p_approval_note is null or btrim(p_approval_note) = '''') then\n      raise exception ''oem_quote_save: ต่ำกว่า MOQ', array['N1a']),
      ('MO5', 'analytics.oem_note_present(text)', '~ ''[[:alnum:]]''', '~ ''[^ ]''', array['N0a', 'N1a', 'N1b']),
      ('MO6', 'analytics.oem_quote_save(uuid,jsonb,uuid,text,text,text,text,numeric,text,date,uuid)',
        'case when v_gate_override then ''override_below_floor'' end', 'null', array['S2b', 'S5a']),
      ('MO7', 'analytics.oem_quote_renegotiate(uuid,uuid,numeric,text)',
        'v_old.approval_note, v_old.approved_by, case when cardinality(v_gates) > 0', 'null, null, case when cardinality(v_gates) > 0', array['R1']),
      ('MO8', 'analytics.oem_quote_save(uuid,jsonb,uuid,text,text,text,text,numeric,text,date,uuid)',
        'if not analytics.oem_note_valid(p_approval_note) then', 'if false and not analytics.oem_note_valid(p_approval_note) then', array['L2a', 'N1a']),
      ('MO9', 'analytics.oem_quote_save(uuid,jsonb,uuid,text,text,text,text,numeric,text,date,uuid)',
        'if v_item_margin_charged is not null and not v_item_prod_ovr', 'if v_item_margin_charged is not null', array['S2d']),
      ('MO10', 'analytics.oem_price_calc(uuid,jsonb)',
        E'if v_metal in (''silver999'', ''product'')\n     and', E'if false and v_metal in (''silver999'', ''product'')\n     and', array['O2f']),
      ('MO11', 'analytics.oem_price_calc(uuid,jsonb)',
        'if not analytics.oem_note_present(v_po_reason) then', 'if false and not analytics.oem_note_present(v_po_reason) then', array['O2d', 'O2c']),
      ('MO12', 'analytics.oem_quote_renegotiate(uuid,uuid,numeric,text)',
        'if v_gate_manual and not analytics.oem_note_present(p_reason) then', 'if v_gate_manual and (p_reason is null or btrim(p_reason) = '''') then', array['R2a']),
      ('MO13', 'analytics.oem_note_valid(text)', 'length(p_val) <= 500', 'length(p_val) <= 5000', array['N0d', 'L2a'])
    ) as t(id, sig, f, t, ids)
  loop
    v_total := v_total + 1;
    perform pg_temp.mutate(v_m.sig, v_m.f, v_m.t);
    v_s := pg_temp.suite69(v_shop, v_prod_input, v_today);
    for v_orig in select def from _v169_orig where sig = to_regprocedure(v_m.sig)::text loop
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
  v_log := v_log || pg_temp.chk('MX', format('mutant %s จุด ถูกจับ %s · รอด: %s', v_total, v_killed, coalesce(nullif(v_survived, ''), '(ไม่มี)')), v_killed = v_total);

  select count(*) into v_cnt from _v169_orig o where md5(pg_get_functiondef(to_regprocedure(o.sig))) = o.h;
  v_log := v_log || pg_temp.chk('MY', 'หลังคืนของเดิม: md5 definition ทั้ง 5 ฟังก์ชันเท่าเดิม', v_cnt = 5);
  v_s := pg_temp.suite69(v_shop, v_prod_input, v_today);
  v_fail := (length(v_s) - length(replace(v_s, '[FAIL]', ''))) / 6;
  v_log := v_log || pg_temp.chk('MZ', 'หลังคืนของเดิม: ชุดเทสต์หลักรันซ้ำ FAIL ' || v_fail, v_fail = 0);

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_log := v_log || format(E'\n=== สรุป: [FAIL] ทั้งไฟล์ = %s %s ===\n', v_fail, case when v_fail = 0 then '(ผ่าน)' else '(ไม่ผ่าน)' end);
  raise exception '%', v_log;
end $v169$;
