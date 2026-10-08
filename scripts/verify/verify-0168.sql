-- scripts/verify/verify-0168.sql
-- ตรวจ supabase/migrations/0168_oem_soft_qty_floors.sql หลัง apply (หรือต่อท้ายไฟล์ 0168 ใน dry-run เดียว)
-- self-rolling-back (3j-migration-traps ข้อ 11): แตะตัวนับเลขที่ใบเสนอราคา ⇒ ทุกเคสเก็บผลลง log แล้ว raise exception ปิดท้ายเสมอ ⇒ rollback ทั้งก้อน
-- ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน · [SKIP] = พิสูจน์ไม่ได้ (ไม่มีข้อมูลงานผลิตจริงเป็น fixture)
-- โครงเดียวกับ verify-0166/0167: ชุดเทสต์ pg_temp.suite68() รันใน subtransaction ที่ถอยกลับเอง · รอบแรก = ของจริง ต้อง FAIL 0 · รอบถัดไป = mutant
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0168.sql
-- dry-run ก่อน apply: cat supabase/migrations/0168_*.sql scripts/verify/verify-0168.sql > tmp.sql แล้วรันไม่ใส่ --commit
--
-- ============ ตารางแมป "มติเจ้าของ → เทสต์" ============
--  MOQ/ล็อตโลหะ (ทุกวัสดุ) ออกใบได้เมื่อมี approval_note (strip ล่องหน + trim ไม่ว่าง):
--   ห้ามผ่าน  Q1a ทอง 3 ชิ้น (MOQ+ล็อตไม่ผ่าน) ไม่มี note · Q1b note ล่องหน/bidi ล้วน · Q1c note ช่องว่างล้วนทุกชนิด ·
--              Q2a เงิน 3 · Q2b ทองเหลือง 3 · Q2c ทอง 10 (MOQ อย่างเดียว) · Q2d ทอง 20 x 0.1g (ล็อตอย่างเดียว) · Q3 ใบผสมทอง+สินค้า ไม่มี note
--   ต้องไม่พัง Q4a/Q4b ทอง 3 มี note ออกใบได้และเก็บ approval_note · Q4c เงิน/ทองเหลือง/ล็อตทอง มี note · Q4d draft ไม่ติดด่าน · Q4e ร่าง→ออกใบ ·
--              Q5a/Q5b ผ่าน MOQ ไม่ต้องมี note ไม่มี approved_by · Q7 ใบแท่ง/สินค้าเหมือนเดิม · Q3 ใบผสมมี note ผ่าน
--   renegotiate: ไม่มีด่าน qty/ล็อต (copy item เดิม ไม่คำนวณ floors ใหม่) ⇒ ไม่ต้องแก้ · Q8a ต่อรองใบที่ออกด้วย note ผ่าน · Q8b draft เรียกต่อรองไม่ได้ (ไม่มีทางอ้อมได้ใบ quoted ที่ไม่มี note)
--  ด่านอื่นห้ามแตะ (แม้มี note): Q6a is_complete · Q6b hard floor รายชิ้น · Q6c min_job_value · Q6d margin รวมติดลบ · Q6e ราคาพิเศษเงินแท่งต่ำกว่าทุน · Q6f F1 · Q6g F2
--  fixture: Q0/Q0b ยืนยันว่าเคสที่ใช้ floor "ไม่ผ่านจริง" ตามที่ oem_price_calc รายงาน (floors ยัง pass=false ตามเดิม — calc ไม่ถูกแตะ)
--  mutant 6 จุด (MQ1-MQ6) ต้องล้มจริง · verify-0163/0165/0166/0167 รันซ้ำต้องผ่าน (รายงานแยก) · approval_note ไม่พิมพ์บนใบลูกค้า = vitest (printableQuote.test.ts)
--  ⚠️ ที่เทสต์ครอบไม่ได้: PostgREST จริง (probe แยกหลัง apply) · หน้าจอ (vitest + QA)

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
-- ชุดเทสต์ 0168 — fixture อยู่ใน subtransaction ที่ถอยกลับเสมอ (เรียกซ้ำได้สำหรับ mutant) · ใช้ rates จริงของร้านเพื่อให้ floor qty/ล็อตทองไม่ผ่านจริง
-- (MOQ/เกณฑ์ล็อตทองมาจาก oem_cost_rate จริง — ชุดนี้ไม่เขียนตัวเลขเกณฑ์ลงไฟล์ แต่ยืนยันก่อนว่าเคสนั้น "ไม่ผ่านจริง" ผ่าน calc) · ตัวเลข fixture อื่นสมมติ
-- ============================================================================
create function pg_temp.pj(p_prod jsonb, p_metal text, p_qty int, p_weight numeric default null, p_margin numeric default 0.5) returns jsonb
 language sql as $c$
  select pg_temp.pit(
    p_prod || jsonb_build_object('metal', p_metal, 'qty', p_qty, 'margin_pct', p_margin)
           || case when p_metal = 'gold' then jsonb_build_object('purity', 0.965) else '{}'::jsonb end
           || case when p_weight is not null then jsonb_build_object('weight_g', p_weight) else '{}'::jsonb end,
    null)
$c$;

create function pg_temp.suite68(p_shop uuid, p_prod jsonb, p_today date) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  v_r text; v_r2 text; v_r3 text;
  v_q uuid;
  v_pa uuid; v_pb uuid;
  v_ca jsonb;
  v_c jsonb;
  v_row record;
  v_bad text; v_k text;
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
      values (p_shop, 'V168-A', 'สินค้าทดสอบ A168', 600, 1000, 'ทดสอบ', 'fixed') returning id into v_pa;
    insert into public.product (shop_id, sku, name, unit_cost, list_price, category, cost_type)
      values (p_shop, 'V168-B', 'สินค้าทดสอบ B168', 0, 500, 'ทดสอบ', 'fixed') returning id into v_pb;
    v_ca := pg_temp.pit(pg_temp.pin(v_pa, 1, '1000', null, null, null), v_pa);

    -- ไม่มีงานผลิตจริงให้ใช้เป็น fixture = พิสูจน์ไม่ได้
    if p_prod is null then
      v_log := v_log || '[SKIP] ทั้งชุด: ไม่มี oem_quote_item งานผลิตจริงให้ใช้เป็น fixture' || E'\n';
      raise exception 'suite68 rollback marker' using errcode = 'P0168';
    end if;

    -- ---- ยืนยันก่อนว่าเคสที่ใช้ "ไม่ผ่านจริง" ตามที่ calc รายงาน (floors ยัง pass=false ตามเดิม — oem_price_calc ไม่ถูกแตะ) ----
    v_bad := '';
    for v_k, v_c in
      select t.k, analytics.oem_price_calc(p_shop, (pg_temp.pj(p_prod, t.m, t.q, t.w))->'input') from (values
        ('gold_q3', 'gold', 3, null::numeric), ('silver_q3', 'silver', 3, null), ('brass_q3', 'brass', 3, null),
        ('gold_q10', 'gold', 10, null), ('gold_w01', 'gold', 20, 0.1)
      ) as t(k, m, q, w)
    loop
      if not (v_c->>'is_complete')::boolean
         or ((v_c->'floors'->'qty'->>'pass')::boolean and (v_c->'floors'->'metal_weight'->>'pass')::boolean) then
        v_bad := v_bad || v_k || ' ';
      end if;
    end loop;
    v_log := v_log || pg_temp.chk('Q0', 'fixture: ทอง 3 / เงิน 3 / ทองเหลือง 3 / ทอง 10 (qty ไม่ผ่าน) / ทอง 20 x 0.1g (ล็อตไม่ผ่าน) คำนวณครบและ floor ไม่ผ่านจริง ' || v_bad, v_bad = '');
    v_c := analytics.oem_price_calc(p_shop, (pg_temp.pj(p_prod, 'gold', 20, 0.1))->'input');
    v_log := v_log || pg_temp.chk('Q0b', 'ทอง 20 ชิ้น x 0.1g: qty ผ่านแต่ล็อตทองไม่ผ่าน (เคส "ล็อตอย่างเดียว")',
      (v_c->'floors'->'qty'->>'pass')::boolean and not (v_c->'floors'->'metal_weight'->>'pass')::boolean);

    -- ========================================================================
    -- ห้ามผ่าน — ไม่มี approval_note
    -- ========================================================================
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'gold', 3)), 'quoted', null);
    v_log := v_log || pg_temp.chk('Q1a', 'ทอง 3 ชิ้น (ต่ำกว่า MOQ + ล็อตทอง) ไม่มี note → 22023 "ต่ำกว่า MOQ/ล็อตโลหะขั้นต่ำ — ต้องใส่เหตุผลอนุมัติ"',
      v_r like 'ERR:22023:%ต่ำกว่า MOQ/ล็อตโลหะขั้นต่ำ%ต้องใส่เหตุผลอนุมัติ%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'gold', 3)), 'quoted', chr(10240) || ' ' || chr(65039));
    v_log := v_log || pg_temp.chk('Q1b', 'note ที่ไม่มีตัวอักษร/ตัวเลขจริง (U+2800 / VS16 / ช่องว่าง) = ไม่มี note → 22023 (whitelist oem_note_present ตั้งแต่ 0169 · bidi/ล่องหนจริงตกที่ L2 ของ verify-0169)', v_r like 'ERR:22023:%ต่ำกว่า MOQ/ล็อตโลหะขั้นต่ำ%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'gold', 3)), 'quoted', E'  \t ' || chr(160) || chr(12288));
    v_log := v_log || pg_temp.chk('Q1c', 'note เป็นช่องว่างล้วนทุกชนิด (รวม NBSP/ideographic) → 22023', v_r like 'ERR:22023:%ต่ำกว่า MOQ/ล็อตโลหะขั้นต่ำ%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'silver', 3)), 'quoted', null);
    v_log := v_log || pg_temp.chk('Q2a', 'เงิน 3 ชิ้น ต่ำกว่า MOQ ไม่มี note → 22023', v_r like 'ERR:22023:%ต่ำกว่า MOQ/ล็อตโลหะขั้นต่ำ%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'brass', 3)), 'quoted', null);
    v_log := v_log || pg_temp.chk('Q2b', 'ทองเหลือง 3 ชิ้น ต่ำกว่า MOQ ไม่มี note → 22023', v_r like 'ERR:22023:%ต่ำกว่า MOQ/ล็อตโลหะขั้นต่ำ%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'gold', 10)), 'quoted', null);
    v_log := v_log || pg_temp.chk('Q2c', 'ทอง 10 ชิ้น (MOQ ไม่ผ่าน ล็อตทองผ่าน) ไม่มี note → 22023', v_r like 'ERR:22023:%ต่ำกว่า MOQ/ล็อตโลหะขั้นต่ำ%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'gold', 20, 0.1)), 'quoted', null);
    v_log := v_log || pg_temp.chk('Q2d', 'ทอง 20 ชิ้น x 0.1g (MOQ ผ่าน ล็อตทองไม่ผ่านอย่างเดียว) ไม่มี note → 22023', v_r like 'ERR:22023:%ต่ำกว่า MOQ/ล็อตโลหะขั้นต่ำ%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'gold', 3), v_ca), 'quoted', null);
    v_r2 := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'gold', 3), v_ca), 'quoted', 'ลูกค้าสั่งน้อยแต่ขอทำ');
    v_log := v_log || pg_temp.chk('Q3', 'ใบผสมทอง 3 ชิ้น + สินค้า catalog: ไม่มี note → 22023 (สินค้าไม่ช่วยให้ผ่าน) · มี note → ผ่าน',
      v_r like 'ERR:22023:%ต่ำกว่า MOQ/ล็อตโลหะขั้นต่ำ%' and v_r2 like 'OK:%');

    -- ========================================================================
    -- ต้องไม่พัง — มี note ออกใบได้
    -- ========================================================================
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'gold', 3)), 'quoted', 'อนุมัติโดยเจ้าของ: ลูกค้าประจำ ขอสั่งจำนวนน้อย');
    v_log := v_log || pg_temp.chk('Q4a', 'ทอง 3 ชิ้น มี note → ออกใบ quoted ได้', v_r like 'OK:%');
    select * into v_row from analytics.oem_quote where id = pg_temp.qid(v_r);
    v_log := v_log || pg_temp.chk('Q4b', 'ใบ Q4a: status quoted · เก็บ approval_note ตามที่ใส่ · มีวันหมดอายุ',
      v_row.status = 'quoted' and v_row.approval_note = 'อนุมัติโดยเจ้าของ: ลูกค้าประจำ ขอสั่งจำนวนน้อย' and v_row.quote_valid_until is not null);
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'silver', 3)), 'quoted', 'อนุมัติ');
    v_r2 := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'brass', 3)), 'quoted', 'อนุมัติ');
    v_r3 := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'gold', 20, 0.1)), 'quoted', 'อนุมัติ');
    v_log := v_log || pg_temp.chk('Q4c', 'เงิน 3 / ทองเหลือง 3 / ทอง 20 x 0.1g มี note ออกใบได้', v_r like 'OK:%' and v_r2 like 'OK:%' and v_r3 like 'OK:%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'gold', 3)), 'draft', null);
    v_log := v_log || pg_temp.chk('Q4d', 'ทอง 3 ชิ้น บันทึกเป็น draft โดยไม่มี note ได้ (ด่านอยู่ที่ตอน quoted เท่านั้น เหมือนเดิม)', v_r like 'OK:%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'gold', 3)), 'draft', null);
    v_r2 := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'gold', 3)), 'quoted', 'อนุมัติ', 0, pg_temp.qid(v_r));
    v_log := v_log || pg_temp.chk('Q4e', 'flow ร่าง → ออกใบ (แก้ใบเดิม) พร้อม note ผ่าน', v_r2 like 'OK:%');

    -- ใบที่ผ่าน MOQ ไม่ต้องมี note
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'silver', 50)), 'quoted', null);
    v_r2 := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'gold', 50)), 'quoted', null);
    v_r3 := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'brass', 100)), 'quoted', null);
    v_log := v_log || pg_temp.chk('Q5a', 'ต้องไม่พัง: เงิน 50 / ทอง 50 / ทองเหลือง 100 (ผ่าน MOQ + ล็อต) ไม่มี note ออกใบได้', v_r like 'OK:%' and v_r2 like 'OK:%' and v_r3 like 'OK:%');
    select * into v_row from analytics.oem_quote where id = pg_temp.qid(v_r);
    v_log := v_log || pg_temp.chk('Q5b', 'ใบ Q5a: ไม่มี approval_note / approved_by (ไม่ได้ถูกบังคับ)', v_row.approval_note is null and v_row.approved_by is null);

    -- ========================================================================
    -- ด่านอื่นไม่ถูกผ่อน (แม้มี note)
    -- ========================================================================
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'gold', 3), pg_temp.pit(pg_temp.pin(v_pb, 1, '500', null, null, null), v_pb)), 'quoted', 'อนุมัติ');
    v_log := v_log || pg_temp.chk('Q6a', 'is_complete: มีสินค้าทุน catalog = 0 ในใบ → 22023 "ยังกรอกข้อมูลไม่ครบ" แม้มี note', v_r like 'ERR:22023:%ยังกรอกข้อมูลไม่ครบ%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'gold', 3, null, 0.10)), 'quoted', 'อนุมัติ');
    v_log := v_log || pg_temp.chk('Q6b', 'hard floor รายชิ้น: ทอง 3 ชิ้น margin 10% แม้มี note → 22023 hard floor', v_r like 'ERR:22023:%hard floor%');
    update analytics.oem_setting set min_job_value_thb = 100000000 where shop_id = p_shop;
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'silver', 3)), 'quoted', 'อนุมัติ');
    v_log := v_log || pg_temp.chk('Q6c', 'min_job_value: เกณฑ์สูง งานผลิต 3 ชิ้นมี note ก็ยังตก → 22023 "มูลค่างานรวม"', v_r like 'ERR:22023:%มูลค่างานรวม%');
    update analytics.oem_setting set min_job_value_thb = 1 where shop_id = p_shop;
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'gold', 3), pg_temp.pit(pg_temp.pin(null, 1, '1', '1000000', 'ขาดทุนหนัก168', null), null)), 'quoted', 'อนุมัติ');
    v_log := v_log || pg_temp.chk('Q6d', 'margin รวมติดลบ: แม้มี note ก็ตก → 22023', v_r like 'ERR:22023:%margin รวมติดลบ%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'gold', 3), pg_temp.bar_item('1_baht', 1, '700', 'ทดสอบต่ำกว่าทุน')), 'quoted', 'อนุมัติ', 0, null, p_today + 5);
    v_log := v_log || pg_temp.chk('Q6e', 'ราคาพิเศษเงินแท่งต่ำกว่าทุน: แม้มี note ก็ตก → 22023 "ต่ำกว่าทุน"', v_r like 'ERR:22023:%ต่ำกว่าทุน%');
    v_c := pg_temp.calc_or_null(p_shop, (pg_temp.pj(p_prod, 'silver', 50))->'input');
    update analytics.oem_setting set min_job_value_thb = round((v_c->'breakdown'->>'quote_total')::numeric * 0.9) where shop_id = p_shop;
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'silver', 50), pg_temp.pit(pg_temp.pin(null, 1, '0.01', '0.01', 'svc168', null), null)), 'quoted', 'อนุมัติ',
      round((v_c->'breakdown'->>'quote_total')::numeric * 0.2, 2));
    v_log := v_log || pg_temp.chk('Q6f', 'F1 ของ 0167: งานผลิตผ่าน MOQ + สินค้า manual 0.01 ลดจนงานผลิตหลังลดต่ำกว่า min แม้มี note → 22023 ยังอยู่',
      v_r like 'ERR:22023:%หลังหักส่วนลดทั้งใบ%');
    update analytics.oem_setting set min_job_value_thb = 1 where shop_id = p_shop;
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'silver', 50), pg_temp.pit(pg_temp.pin(null, 1, '1000', '0.01', 'svc-big168', null), null)), 'quoted', null,
      round((v_c->'breakdown'->>'quote_total')::numeric * 0.1, 2));
    v_log := v_log || pg_temp.chk('Q6g', 'F2 ของ 0167: ผ่าน MOQ + สินค้าทุน manual + ส่วนลด ไม่มี note → 22023 ยังอยู่ (ข้อความ "กรอกทุนเอง")', v_r like 'ERR:22023:%กรอกทุนเอง%');

    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'silver', 50), pg_temp.pit(pg_temp.pin(null, 1, '1000', '0.01', 'svc-big168', null), null)), 'quoted',
      chr(12288) || chr(8195) || chr(160), round((v_c->'breakdown'->>'quote_total')::numeric * 0.1, 2));
    v_log := v_log || pg_temp.chk('Q1d', 'ชุด trim เดียวกับ customer_text_clean: note เป็น ideographic space / em space / NBSP ล้วน ก็ไม่นับเป็น note (F2 ของ 0167 ที่เคย trim แคบกว่า) → 22023', v_r like 'ERR:22023:%กรอกทุนเอง%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'silver', 50), pg_temp.pit(pg_temp.pin(null, 1, '1000', '0.01', 'svc-big168', null), null)), 'quoted', null, 0);
    v_q := pg_temp.qid(v_r);
    v_r2 := pg_temp.t_reneg(p_shop, v_q, round((v_c->'breakdown'->>'quote_total')::numeric * 0.1, 2), chr(12288));
    v_r3 := pg_temp.t_reneg(p_shop, v_q, round((v_c->'breakdown'->>'quote_total')::numeric * 0.1, 2), 'ต่อรองกับลูกค้า');
    v_log := v_log || pg_temp.chk('Q9', 'renegotiate F2: เหตุผลเป็นช่องว่างกว้างล้วน → 22023 · มีเหตุผลจริง → ผ่าน', v_r2 like 'ERR:22023:%กรอกทุนเอง%' and v_r3 like 'OK:%');

    -- ใบแท่ง / สินค้า เหมือนเดิม
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.bar_item('1_baht', 2)), 'quoted', null);
    v_r2 := pg_temp.t_save(p_shop, jsonb_build_array(v_ca), 'quoted', null);
    v_log := v_log || pg_temp.chk('Q7', 'ต้องไม่พัง: ใบแท่งล้วน / ใบสินค้าล้วน ไม่ต้องมี note ออกใบได้เหมือนเดิม', v_r like 'OK:%' and v_r2 like 'OK:%');

    -- ========================================================================
    -- renegotiate (ไม่มีด่าน qty/ล็อต — ใบที่ออกได้ต้องผ่านด่านนี้ด้วย note มาแล้ว)
    -- ========================================================================
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'gold', 3)), 'quoted', 'อนุมัติ');
    v_q := pg_temp.qid(v_r);
    v_r2 := pg_temp.t_reneg(p_shop, v_q, 0, null);
    v_log := v_log || pg_temp.chk('Q8a', 'ต่อรองใบทอง 3 ชิ้นที่ออกด้วย note (ส่วนลด 0) ผ่าน · ใบเดิม superseded · item copy ครบ',
      v_r2 like 'OK:%' and (select status from analytics.oem_quote where id = v_q) = 'superseded'
      and (select count(*) from analytics.oem_quote_item where quote_id = pg_temp.qid(v_r2)) = 1);
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pj(p_prod, 'gold', 3, null, 0.5)), 'draft', null);
    v_log := v_log || pg_temp.chk('Q8b', 'ไม่มีทางได้ใบ quoted ของทอง 3 ชิ้นโดยไม่มี note: draft แล้วเรียก renegotiate → ปฏิเสธ (ต้องเป็น quoted/won)',
      pg_temp.t_reneg(p_shop, pg_temp.qid(v_r), 0, null) like 'ERR:22023:%quoted หรือ won%');

    raise exception 'suite68 rollback marker' using errcode = 'P0168';
  exception
    when sqlstate 'P0168' then null;
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

do $v168$
declare
  v_log text := E'\n=== verify 0168 (MOQ/ล็อตโลหะ: ออกใบได้เมื่อมีเหตุผลอนุมัติ) ===\n';
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
  v_sig text := 'analytics.oem_quote_save(uuid,jsonb,uuid,text,text,text,text,numeric,text,date,uuid)';
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select count(*) into v_cnt from public.shop;
  if v_cnt <> 1 then
    raise exception 'verify-0168 หยุด: public.shop มี % ร้าน (ไฟล์นี้ออกแบบสำหรับร้านเดียว)', v_cnt;
  end if;
  select id into v_shop from public.shop;
  select input into v_prod_input from analytics.oem_quote_item where input->>'metal' = 'silver' order by created_at limit 1;

  select count(*) into v_cnt from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'oem_quote_save';
  v_log := v_log || pg_temp.chk('Z1', format('oem_quote_save = 1 แถวใน pg_proc (ไม่มี overload) ได้ %s', v_cnt), v_cnt = 1);
  select count(*) into v_cnt from pg_proc p
    where p.pronamespace = 'analytics'::regnamespace and p.proname = 'oem_quote_save'
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
           or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0));
  v_log := v_log || pg_temp.chk('Z2', 'ไม่มี execute ให้ anon / authenticated / PUBLIC', v_cnt = 0);

  create temp table _v168_orig on commit drop as
    select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def, md5(pg_get_functiondef(p.oid)) as h
    from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'oem_quote_save';

  v_s := pg_temp.suite68(v_shop, v_prod_input, v_today);
  v_log := v_log || v_s;
  v_fail := (length(v_s) - length(replace(v_s, '[FAIL]', ''))) / 6;
  v_ok := (length(v_s) - length(replace(v_s, '[OK]', ''))) / 4;
  v_log := v_log || format(E'--- ชุดเทสต์หลัก: OK %s / FAIL %s\n', v_ok, v_fail);

  for v_m in
    select * from (values
      ('MQ1', 'if (not v_qty_pass_all or not v_metalweight_pass_all)', 'if false and (not v_qty_pass_all or not v_metalweight_pass_all)', array['Q1a', 'Q2a']),
      ('MQ2', E'and not analytics.oem_note_present(p_approval_note) then\n      raise exception ''oem_quote_save: ต่ำกว่า MOQ',
              E'and (p_approval_note is null or btrim(p_approval_note) = '''') then\n      raise exception ''oem_quote_save: ต่ำกว่า MOQ', array['Q1b', 'Q1c']),
      ('MQ3', 'or not v_metalweight_pass_all)', 'or false)', array['Q2d']),
      ('MQ4', 'if (not v_qty_pass_all or', 'if (false or', array['Q2a', 'Q2b', 'Q2c']),
      ('MQ5', E'and not analytics.oem_note_present(p_approval_note) then\n      raise exception ''oem_quote_save: ต่ำกว่า MOQ',
              E'and true then\n      raise exception ''oem_quote_save: ต่ำกว่า MOQ', array['Q4a', 'Q4c']),
      ('MQ6', E'and not analytics.oem_note_present(p_approval_note) then\n      raise exception ''oem_quote_save: ต่ำกว่า MOQ',
              E'and analytics.oem_note_present(p_approval_note) then\n      raise exception ''oem_quote_save: ต่ำกว่า MOQ', array['Q1a', 'Q4a'])
    ) as t(id, f, t, ids)
  loop
    v_total := v_total + 1;
    perform pg_temp.mutate(v_sig, v_m.f, v_m.t);
    v_s := pg_temp.suite68(v_shop, v_prod_input, v_today);
    for v_orig in select def from _v168_orig where sig = to_regprocedure(v_sig)::text loop
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

  select count(*) into v_cnt from _v168_orig o where md5(pg_get_functiondef(to_regprocedure(o.sig))) = o.h;
  v_log := v_log || pg_temp.chk('MY', 'หลังคืนของเดิม: md5 definition เท่าเดิม', v_cnt = 1);
  v_s := pg_temp.suite68(v_shop, v_prod_input, v_today);
  v_fail := (length(v_s) - length(replace(v_s, '[FAIL]', ''))) / 6;
  v_log := v_log || pg_temp.chk('MZ', 'หลังคืนของเดิม: ชุดเทสต์หลักรันซ้ำ FAIL ' || v_fail, v_fail = 0);

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_log := v_log || format(E'\n=== สรุป: [FAIL] ทั้งไฟล์ = %s %s ===\n', v_fail, case when v_fail = 0 then '(ผ่าน)' else '(ไม่ผ่าน)' end);
  raise exception '%', v_log;
end $v168$;
