-- scripts/verify/verify-0167.sql
-- ตรวจ supabase/migrations/0167_oem_product_item_hardening.sql หลัง apply (หรือต่อท้ายไฟล์ 0167 ใน dry-run เดียว)
-- self-rolling-back (3j-migration-traps ข้อ 11): แตะตัวนับเลขที่ใบเสนอราคา ⇒ ทุกเคสเก็บผลลง log แล้ว raise exception ปิดท้ายเสมอ ⇒ rollback ทั้งก้อน
-- ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน · [SKIP] = พิสูจน์ไม่ได้ (ไม่มีข้อมูลงานผลิตจริงเป็น fixture)
-- โครงเดียวกับ verify-0166: ชุดเทสต์ pg_temp.suite67() รันใน subtransaction ที่ถอยกลับเอง · รอบแรก = ของจริง ต้อง FAIL 0 · รอบถัดไป = mutant
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0167.sql
-- dry-run ก่อน apply: cat supabase/migrations/0167_*.sql scripts/verify/verify-0167.sql > tmp.sql แล้วรันไม่ใส่ --commit
--
-- ============ ตารางแมป "ข้อ → เทสต์" ============
--  F1 งานผลิตหลังหักส่วนลดของใบที่มีสินค้า >= min_job_value:
--      ห้ามผ่าน  P1b (save, manual 0.01) · P1g (ต่ำกว่า 1 สตางค์) · P2b (renegotiate)
--      ต้องไม่พัง P1a/P2a baseline งานผลิตล้วน · P1b2 ไม่มีส่วนลด · P1c/P2c ใบผสม catalog ลดเล็กน้อย · P1d สินค้าล้วนมีส่วนลด · P1f ขอบ = min ·
--                 P1e ใบแท่ง+งานผลิตไม่มีสินค้า "ไม่เปลี่ยน" (หนี้ 0079) · P2d ต่อรอง ส่วนลด 0
--  F2 ทุน manual ต้องมี note เมื่อ (ก) ส่วนลด>0 หรือ (ข) นับ manual เฉพาะส่วนขาดทุนแล้วใบขาดทุน:
--      ห้ามผ่าน  P3a (save+ส่วนลด ไม่มี note) · P3g (manual ล้วน+ส่วนลด) · P3f (note ล่องหนล้วน) · P3e (renegotiate) ·
--                 P4b (ขาดทุน manual + กลบ manual ไม่มี note) · P4c (ขาดทุน catalog + กลบ manual) · P4e (renegotiate กรณี ข) · P4a baseline blended<0
--      ต้องไม่พัง P3b/P3g/P4b/P4c/P4e "ที่มี note" ผ่าน · P3c ไม่มีส่วนลด · P3d catalog+ส่วนลด · P3h ต่อรอง 0 · P4d manual ขาดทุนเล็ก+ส่วนที่เหลือบวก · P4f manual ล้วนไม่มีส่วนลด
--  F3 ชื่อรายการไม่มี SKU ซ้ำ sku/name แคตตาล็อก: ห้ามผ่าน P5a P5b (ตัวพิมพ์/เว้นวรรค/sku) P5c (ชื่อแคตตาล็อกมีอักขระล่องหน) P5f (save) ·
--      ต้องไม่พัง P5d (ค่าส่ง/กล่อง/ตรงบางส่วน) P5e (เลือกจากแคตตาล็อก)
--  F4 ชื่อแคตตาล็อกลบ bidi/ล่องหน ก่อน snapshot: P7c P7d (ล่องหนล้วน→SKU) P7e (ที่เก็บในใบ) · ต้องไม่พัง P7f ชื่อไทยปกติไม่ถูกแก้
--  F5/ discount_reason บนหน้าพิมพ์ = ฝั่ง TypeScript (vitest) · golden replay oem_price_calc = ใน migration (3661 เคส)
--  mutant 10 จุด (MA1-MA10) ต้องล้มจริง · verify-0163/0165/0166 รันซ้ำต้องผ่าน (รายงานแยก)
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
-- ชุดเทสต์ 0167 — fixture อยู่ใน subtransaction ที่ถอยกลับเสมอ (เรียกซ้ำได้สำหรับ mutant) · ตัวเลขเป็นค่าสมมติของชุดทดสอบ
-- ============================================================================
create function pg_temp.suite67(p_shop uuid, p_prod jsonb, p_today date) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  v_pa uuid; v_px uuid; v_pz uuid; v_pw uuid; v_py uuid;
  v_r text; v_r2 text; v_r3 text;
  v_c jsonb; v_t numeric; v_d numeric;
  v_q uuid; v_q2 uuid;
  v_row record;
  v_pi jsonb; v_mi jsonb; v_ca jsonb; v_bigm jsonb; v_lossm jsonb; v_coverm jsonb;
  v_ok boolean;
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
      values (p_shop, 'V167-A', 'สินค้าทดสอบ A167', 600, 1000, 'ทดสอบ', 'fixed') returning id into v_pa;
    insert into public.product (shop_id, sku, name, unit_cost, list_price, category, cost_type)
      values (p_shop, 'V167-X', 'probe X167', 600, 1000, 'ทดสอบ', 'fixed') returning id into v_px;
    insert into public.product (shop_id, sku, name, unit_cost, list_price, category, cost_type)
      values (p_shop, 'V167-Z', 'ab' || chr(8203) || 'cd', 600, 1000, 'ทดสอบ', 'fixed') returning id into v_pz;
    insert into public.product (shop_id, sku, name, unit_cost, list_price, category, cost_type)
      values (p_shop, 'V167-W', chr(8203) || chr(8238), 600, 1000, 'ทดสอบ', 'fixed') returning id into v_pw;
    insert into public.product (shop_id, sku, name, unit_cost, list_price, category, cost_type)
      values (p_shop, 'V167-Y', 'name' || chr(8238) || 'rev' || chr(8203), 600, 1000, 'ทดสอบ', 'fixed') returning id into v_py;

    v_mi := pg_temp.pit(pg_temp.pin(null, 1, '0.01', '0.01', 'svc-ทดสอบ167', null), null);          -- manual 0.01 / ทุน 0.01
    v_bigm := pg_temp.pit(pg_temp.pin(null, 1, '1000', '0.01', 'svc-big167', null), null);           -- manual กำไรสูง (ราคา 1000 ทุน 0.01)
    v_lossm := pg_temp.pit(pg_temp.pin(null, 1, '100', '1000', 'svc-loss167', null), null);          -- manual ขาดทุน
    v_coverm := pg_temp.pit(pg_temp.pin(null, 1, '1000', '0.01', 'svc-cover167', null), null);       -- manual กลบ
    v_ca := pg_temp.pit(pg_temp.pin(v_pa, 1, '1000', null, null, null), v_pa);                       -- catalog list 1000 ทุน 600

    -- ========================================================================
    -- F1/F2 ฝั่งงานผลิต (ต้องมีงานผลิตจริงเป็น fixture)
    -- ========================================================================
    if p_prod is not null then
      v_pi := pg_temp.pit(p_prod || jsonb_build_object('margin_pct', 0.5), null);
      v_c := pg_temp.calc_or_null(p_shop, p_prod || jsonb_build_object('margin_pct', 0.5));
      v_t := (v_c->'breakdown'->>'quote_total')::numeric;
    end if;
    if p_prod is null or v_c is null or v_t is null or v_t <= 0 or not (v_c->>'is_complete')::boolean then
      v_log := v_log || '[SKIP] F1/F2(งานผลิต) ไม่มี oem_quote_item งานผลิตจริงที่คำนวณครบวันนี้ให้ใช้เป็น fixture' || E'\n';
    else
      -- ---------------- F1 (save) ----------------
      update analytics.oem_setting set min_job_value_thb = round(v_t * 0.9) where shop_id = p_shop;
      v_d := round(v_t * 0.2, 2);
      v_r := pg_temp.t_save(p_shop, jsonb_build_array(v_pi), 'quoted', 'n', v_d);
      v_log := v_log || pg_temp.chk('P1a', 'baseline: งานผลิตล้วน ลด 20% จนต่ำกว่า min → 22023 "มูลค่างานรวม" (ด่านเดิม)', v_r like 'ERR:22023:%มูลค่างานรวม%');
      v_r := pg_temp.t_save(p_shop, jsonb_build_array(v_pi, v_mi), 'quoted', 'n', v_d);
      v_log := v_log || pg_temp.chk('P1b', 'งานผลิต + สินค้า manual 0.01 บาท ลด 20% จนงานผลิตหลังลดต่ำกว่า min → 22023 "งานผลิตหลังหักส่วนลดทั้งใบ" (ปิดช่องเติมสินค้าหลบ)',
        v_r like 'ERR:22023:%ส่วนที่เป็นงานผลิตหลังหักส่วนลดทั้งใบ%');
      v_r := pg_temp.t_save(p_shop, jsonb_build_array(v_pi, v_mi), 'quoted', null, 0);
      v_log := v_log || pg_temp.chk('P1b2', 'ต้องไม่พัง: ใบเดียวกันไม่มีส่วนลด (งานผลิตเต็ม >= min) ไม่ต้องมี note ผ่าน (manual ทุน=ราคา ไม่มีกำไรที่อ้าง)', v_r like 'OK:%');
      v_r := pg_temp.t_save(p_shop, jsonb_build_array(v_pi, v_ca), 'quoted', null, round(v_t * 0.05, 2));
      v_log := v_log || pg_temp.chk('P1c', 'ต้องไม่พัง: ใบผสมงานผลิต + สินค้า catalog ลด 5% งานผลิตหลังลด (95%) ยัง >= min (90%) ผ่าน', v_r like 'OK:%');
      v_r := pg_temp.t_save(p_shop, jsonb_build_array(v_ca), 'quoted', null, 100);
      v_log := v_log || pg_temp.chk('P1d', 'ต้องไม่พัง: สินค้าล้วนมีส่วนลด ผ่าน (ไม่ติด min_job_value)', v_r like 'OK:%');
      v_r := pg_temp.t_save(p_shop, jsonb_build_array(v_pi, pg_temp.bar_item('1_baht', 1)), 'quoted', 'n', v_d);
      v_log := v_log || pg_temp.chk('P1e', 'ต้องไม่พัง (หนี้ที่บันทึกไว้): ใบแท่ง + งานผลิต ไม่มีสินค้า ลด 20% ยังผ่านเหมือนเดิม — ไม่เปลี่ยนพฤติกรรม 0079', v_r like 'OK:%');
      -- ขอบ: net = min พอดี ผ่าน (เทียบ <)
      v_d := round(v_t * 0.1, 2);
      update analytics.oem_setting set min_job_value_thb = v_t - v_d where shop_id = p_shop;
      v_r := pg_temp.t_save(p_shop, jsonb_build_array(v_pi, v_ca), 'quoted', null, v_d);
      v_log := v_log || pg_temp.chk('P1f', 'ขอบ: งานผลิตหลังลด = min พอดี ผ่าน', v_r like 'OK:%');
      update analytics.oem_setting set min_job_value_thb = v_t - v_d + 0.01 where shop_id = p_shop;
      v_r := pg_temp.t_save(p_shop, jsonb_build_array(v_pi, v_ca), 'quoted', null, v_d);
      v_log := v_log || pg_temp.chk('P1g', 'ขอบ: ต่ำกว่า min 1 สตางค์ → 22023', v_r like 'ERR:22023:%ส่วนที่เป็นงานผลิตหลังหักส่วนลดทั้งใบ%');

      -- ---------------- F1 (renegotiate) ----------------
      update analytics.oem_setting set min_job_value_thb = 1 where shop_id = p_shop;
      v_d := round(v_t * 0.2, 2);
      v_r := pg_temp.t_save(p_shop, jsonb_build_array(v_pi), 'quoted', null, 0);
      v_q := pg_temp.qid(v_r);
      update analytics.oem_setting set min_job_value_thb = round(v_t * 0.9) where shop_id = p_shop;
      v_r2 := pg_temp.t_reneg(p_shop, v_q, v_d, 'r');
      v_log := v_log || pg_temp.chk('P2a', 'baseline: ต่อรองงานผลิตล้วนลด 20% จนต่ำกว่า min → 22023 "มูลค่างานรวม"', v_r2 like 'ERR:22023:%มูลค่างานรวม%');
      update analytics.oem_setting set min_job_value_thb = 1 where shop_id = p_shop;
      v_r := pg_temp.t_save(p_shop, jsonb_build_array(v_pi, v_mi), 'quoted', null, 0);
      v_q := pg_temp.qid(v_r);
      v_q2 := null;
      update analytics.oem_setting set min_job_value_thb = round(v_t * 0.9) where shop_id = p_shop;
      v_r2 := pg_temp.t_reneg(p_shop, v_q, v_d, 'r');
      v_log := v_log || pg_temp.chk('P2b', 'ต่อรองใบผสม (งานผลิต + manual 0.01) ลด 20% → 22023 "งานผลิตหลังหักส่วนลดทั้งใบ" (renegotiate ปิดช่องเดียวกับ save)',
        v_r2 like 'ERR:22023:%ส่วนที่เป็นงานผลิตหลังหักส่วนลดทั้งใบ%');
      v_r3 := pg_temp.t_reneg(p_shop, v_q, 0, null);
      v_log := v_log || pg_temp.chk('P2d', 'ต้องไม่พัง: ต่อรองใบผสมเดิมด้วยส่วนลด 0 (งานผลิตเต็ม >= min) ไม่ต้องมีเหตุผล ผ่าน', v_r3 like 'OK:%');
      update analytics.oem_setting set min_job_value_thb = 1 where shop_id = p_shop;
      v_r := pg_temp.t_save(p_shop, jsonb_build_array(v_pi, v_ca), 'quoted', null, 0);
      v_q := pg_temp.qid(v_r);
      update analytics.oem_setting set min_job_value_thb = round(v_t * 0.9) where shop_id = p_shop;
      v_r2 := pg_temp.t_reneg(p_shop, v_q, round(v_t * 0.05, 2), null);
      v_log := v_log || pg_temp.chk('P2c', 'ต้องไม่พัง: ต่อรองใบผสมสินค้า catalog ลด 5% งานผลิตหลังลดยัง >= min ผ่าน', v_r2 like 'OK:%');
      update analytics.oem_setting set min_job_value_thb = 1 where shop_id = p_shop;

      -- ---------------- F2 (ก) ส่วนลด + ทุน manual ----------------
      v_d := round(v_t * 0.1, 2);
      v_r := pg_temp.t_save(p_shop, jsonb_build_array(v_pi, v_bigm), 'quoted', null, v_d);
      v_log := v_log || pg_temp.chk('P3a', 'งานผลิต + สินค้า manual (ทุนกรอกเอง) + ส่วนลด > 0 ไม่มี note → 22023 ต้องใส่เหตุผล', v_r like 'ERR:22023:%กรอกทุนเอง%มีส่วนลด%');
      v_r := pg_temp.t_save(p_shop, jsonb_build_array(v_pi, v_bigm), 'quoted', 'ลูกค้าประจำ', v_d);
      v_log := v_log || pg_temp.chk('P3b', 'ต้องไม่พัง: ใบเดียวกันที่มี note ผ่าน (และเก็บ approval_note ไว้)', v_r like 'OK:%'
        and (select approval_note = 'ลูกค้าประจำ' from analytics.oem_quote where id = pg_temp.qid(v_r)));
      v_r := pg_temp.t_save(p_shop, jsonb_build_array(v_pi, v_bigm), 'quoted', null, 0);
      v_log := v_log || pg_temp.chk('P3c', 'ต้องไม่พัง: ไม่มีส่วนลด ไม่ต้องมี note ผ่าน', v_r like 'OK:%');
      v_r := pg_temp.t_save(p_shop, jsonb_build_array(v_pi, v_ca), 'quoted', null, v_d);
      v_log := v_log || pg_temp.chk('P3d', 'ต้องไม่พัง: สินค้า catalog (ทุนมีหลักฐาน) + ส่วนลด ไม่ต้องมี note ผ่าน', v_r like 'OK:%');
      v_r := pg_temp.t_save(p_shop, jsonb_build_array(v_pi, v_bigm), 'quoted', chr(8288) || chr(65279) || ' ', v_d);
      v_log := v_log || pg_temp.chk('P3f', 'note ที่มีแต่อักขระล่องหน/ช่องว่าง = ไม่มี note → 22023', v_r like 'ERR:22023:%กรอกทุนเอง%');
      -- renegotiate
      v_r := pg_temp.t_save(p_shop, jsonb_build_array(v_pi, v_bigm), 'quoted', null, 0);
      v_q := pg_temp.qid(v_r);
      v_r2 := pg_temp.t_reneg(p_shop, v_q, v_d, null);
      v_r3 := pg_temp.t_reneg(p_shop, v_q, v_d, 'ต่อรองกับลูกค้า');
      v_log := v_log || pg_temp.chk('P3e', 'ต่อรองใบที่มี manual ลด > 0: ไม่มีเหตุผล → 22023 · มีเหตุผล → ผ่าน',
        v_r2 like 'ERR:22023:%กรอกทุนเอง%' and v_r3 like 'OK:%');
      v_r := pg_temp.t_save(p_shop, jsonb_build_array(v_pi, v_bigm), 'quoted', null, 0);
      v_r2 := pg_temp.t_reneg(p_shop, pg_temp.qid(v_r), 0, null);
      v_log := v_log || pg_temp.chk('P3h', 'ต้องไม่พัง: ต่อรองด้วยส่วนลด 0 (ใบเดิมไม่ขาดทุน) ไม่ต้องมีเหตุผล', v_r2 like 'OK:%');
    end if;

    -- ========================================================================
    -- F2 (ข) กำไรที่กรอกเองกลบรายการขาดทุน (ไม่ต้องใช้งานผลิต)
    -- ========================================================================
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(v_lossm), 'quoted', 'n', 0);
    v_log := v_log || pg_temp.chk('P4a', 'baseline: สินค้าขาดทุนอย่างเดียว → 22023 margin รวมติดลบ (ด่านเดิม ไม่ปลดด้วย note)', v_r like 'ERR:22023:%margin รวมติดลบ%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(v_lossm, v_coverm), 'quoted', null, 0);
    v_r2 := pg_temp.t_save(p_shop, jsonb_build_array(v_lossm, v_coverm), 'quoted', 'ลูกค้าตกลงแล้ว', 0);
    v_log := v_log || pg_temp.chk('P4b', 'รายการขาดทุน (manual) + รายการกลบ (manual ทุน 0.01) รวมแล้วบวก: ไม่มี note → 22023 · มี note → ผ่าน',
      v_r like 'ERR:22023:%กรอกทุนเอง%ส่วนที่เหลือ%' and v_r2 like 'OK:%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(v_pa, 1, '100', null, null, 'ลด'), v_pa), v_coverm), 'quoted', null, 0);
    v_r2 := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(v_pa, 1, '100', null, null, 'ลด'), v_pa), v_coverm), 'quoted', 'n', 0);
    v_log := v_log || pg_temp.chk('P4c', 'รายการขาดทุนจากแคตตาล็อก + manual กลบ: ไม่มี note → 22023 · มี note → ผ่าน', v_r like 'ERR:22023:%กรอกทุนเอง%' and v_r2 like 'OK:%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(null, 1, '100', '150', 'ขาดทุนเล็ก167', null), null), pg_temp.bar_item('1_baht', 2)), 'quoted', null, 0);
    v_log := v_log || pg_temp.chk('P4d', 'ต้องไม่พัง: manual ขาดทุนเล็กน้อย + แท่งที่ส่วนที่เหลือบวกชัด → ผ่านโดยไม่ต้องมี note', v_r like 'OK:%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(v_lossm, v_coverm), 'quoted', 'ลูกค้าตกลงแล้ว', 0);
    v_q := pg_temp.qid(v_r);
    v_r2 := pg_temp.t_reneg(p_shop, v_q, 0, null);
    v_r3 := pg_temp.t_reneg(p_shop, v_q, 0, 'ยืนยันตามเดิม');
    v_log := v_log || pg_temp.chk('P4e', 'ต่อรอง (ส่วนลด 0) ใบที่กำไร manual กลบรายการขาดทุน: ไม่มีเหตุผล → 22023 · มีเหตุผล → ผ่าน', v_r2 like 'ERR:22023:%กรอกทุนเอง%' and v_r3 like 'OK:%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(null, 1, '1000', '600', 'manual-only167', null), null)), 'quoted', null, 100);
    v_r2 := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(null, 1, '1000', '600', 'manual-only167', null), null)), 'quoted', 'เหตุผล', 100);
    v_log := v_log || pg_temp.chk('P3g', 'สินค้า manual ล้วน + ส่วนลด > 0: ไม่มี note → 22023 · มี note → ผ่าน', v_r like 'ERR:22023:%กรอกทุนเอง%' and v_r2 like 'OK:%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(null, 1, '1000', '600', 'manual-only167', null), null)), 'quoted', null, 0);
    v_log := v_log || pg_temp.chk('P4f', 'ต้องไม่พัง: สินค้า manual ล้วนไม่มีส่วนลด ไม่ต้องมี note ผ่าน (มติ 5 ยังอยู่)', v_r like 'OK:%');

    -- ========================================================================
    -- F3 ชื่อรายการไม่มี SKU ซ้ำแคตตาล็อก
    -- ========================================================================
    v_r := pg_temp.t_calc(p_shop, pg_temp.pin(null, 1, '100', '60', 'probe X167', null));
    v_log := v_log || pg_temp.chk('P5a', 'ไม่มี SKU ชื่อ = ชื่อสินค้าในแคตตาล็อกเป๊ะ → 22023 "ตรงกับสินค้าในแคตตาล็อก"', v_r like 'ERR:22023:%ตรงกับสินค้าในแคตตาล็อก%');
    v_r := pg_temp.t_calc(p_shop, pg_temp.pin(null, 1, '100', '60', 'v167-x', null));
    v_r2 := pg_temp.t_calc(p_shop, pg_temp.pin(null, 1, '100', '60', '  PROBE x167  ', null));
    v_log := v_log || pg_temp.chk('P5b', 'ชื่อ = SKU (ตัวพิมพ์เล็ก) และชื่อสินค้าที่เว้นวรรค/ตัวพิมพ์ต่าง → 22023 ทั้งคู่', v_r like 'ERR:22023:%ตรงกับสินค้า%' and v_r2 like 'ERR:22023:%ตรงกับสินค้า%');
    v_r := pg_temp.t_calc(p_shop, pg_temp.pin(null, 1, '100', '60', 'abcd', null));
    v_log := v_log || pg_temp.chk('P5c', 'ชื่อในแคตตาล็อกมีอักขระล่องหนคั่นกลาง (ab+ZWSP+cd) · พิมพ์ abcd → 22023 (เทียบหลังลบอักขระล่องหน)', v_r like 'ERR:22023:%ตรงกับสินค้า%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(null, 1, '100', '60', 'probe X167', null), null)), 'quoted', null, 0);
    v_log := v_log || pg_temp.chk('P5f', 'ทางบันทึก (save) ก็ตกด่านเดียวกัน → 22023', v_r like 'ERR:22023:%ตรงกับสินค้า%');
    v_r := pg_temp.t_calc(p_shop, pg_temp.pin(null, 1, '100', '60', 'กล่องสั่งทำ167', null));
    v_r2 := pg_temp.t_calc(p_shop, pg_temp.pin(null, 1, '100', '60', 'ค่าส่ง167', null));
    v_r3 := pg_temp.t_calc(p_shop, pg_temp.pin(null, 1, '100', '60', 'probe', null));
    v_log := v_log || pg_temp.chk('P5d', 'ต้องไม่พัง: ค่าส่ง / กล่องสั่งทำ ที่ชื่อไม่ซ้ำแคตตาล็อก และชื่อที่ตรงแค่บางส่วน ("probe") ผ่าน', v_r = 'OK' and v_r2 = 'OK' and v_r3 = 'OK');
    v_r := pg_temp.t_calc(p_shop, pg_temp.pin(v_px, 1, '1000', null, null, null));
    v_log := v_log || pg_temp.chk('P5e', 'ต้องไม่พัง: เลือกสินค้าเดียวกันจากแคตตาล็อก (มี product_id) ผ่านตามปกติ', v_r = 'OK');

    -- ========================================================================
    -- F4 ชื่อจากแคตตาล็อกลบอักขระล่องหน/bidi ก่อน snapshot
    -- ========================================================================
    v_c := pg_temp.calc_or_null(p_shop, pg_temp.pin(v_py, 1, '1000', null, null, null));
    v_log := v_log || pg_temp.chk('P7c', 'ชื่อแคตตาล็อกมี U+202E / ZWSP → snapshot ใน calc = "namerev" (ไม่มี bidi/ล่องหน)',
      v_c is not null and v_c->'breakdown'->'product'->>'name' = 'namerev');
    v_c := pg_temp.calc_or_null(p_shop, pg_temp.pin(v_pw, 1, '1000', null, null, null));
    v_log := v_log || pg_temp.chk('P7d', 'ชื่อแคตตาล็อกเป็นอักขระล่องหนล้วน → ใช้ SKU แทน (ไม่ใช่ชื่อว่างบนใบ)', v_c is not null and v_c->'breakdown'->'product'->>'name' = 'V167-W');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pit(pg_temp.pin(v_py, 1, '1000', null, null, null), v_py, 'FAKE', 'ชื่อปลอม')), 'draft');
    select * into v_row from analytics.oem_quote_item where quote_id = pg_temp.qid(v_r) and seq = 1;
    v_log := v_log || pg_temp.chk('P7e', 'ใบที่บันทึก: product_name_snapshot = "namerev" · sku_snapshot = V167-Y', v_row.product_name_snapshot = 'namerev' and v_row.sku_snapshot = 'V167-Y');
    v_log := v_log || pg_temp.chk('P7f', 'ต้องไม่พัง: ชื่อแคตตาล็อกปกติ (ไทย) ไม่ถูกแก้ — snapshot = "สินค้าทดสอบ A167"',
      pg_temp.calc_or_null(p_shop, pg_temp.pin(v_pa, 1, '1000', null, null, null))->'breakdown'->'product'->>'name' = 'สินค้าทดสอบ A167');

    raise exception 'suite67 rollback marker' using errcode = 'P0167';
  exception
    when sqlstate 'P0167' then null;
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

do $v167$
declare
  v_log text := E'\n=== verify 0167 (hardening รายการสินค้า OEM) ===\n';
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
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select count(*) into v_cnt from public.shop;
  if v_cnt <> 1 then
    raise exception 'verify-0167 หยุด: public.shop มี % ร้าน (ไฟล์นี้ออกแบบสำหรับร้านเดียว)', v_cnt;
  end if;
  select id into v_shop from public.shop;
  select input into v_prod_input from analytics.oem_quote_item where input->>'metal' = 'silver' order by created_at limit 1;

  select count(*) into v_cnt from pg_proc where pronamespace = 'analytics'::regnamespace
    and proname in ('oem_price_calc', 'oem_quote_save', 'oem_quote_renegotiate');
  v_log := v_log || pg_temp.chk('Z1', format('3 ฟังก์ชัน = 3 แถวใน pg_proc (ไม่มี overload) ได้ %s', v_cnt), v_cnt = 3);
  select count(*) into v_cnt from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'oem_price_calc_legacy';
  v_log := v_log || pg_temp.chk('Z2', 'ไม่มี oem_price_calc_legacy ค้าง', v_cnt = 0);
  select count(*) into v_cnt from pg_proc p
    where p.pronamespace = 'analytics'::regnamespace and p.proname in ('oem_price_calc', 'oem_quote_save', 'oem_quote_renegotiate')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
           or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0));
  v_log := v_log || pg_temp.chk('Z3', 'ไม่มี execute ให้ anon / authenticated / PUBLIC ทั้ง 3 ฟังก์ชัน', v_cnt = 0);

  create temp table _v167_orig on commit drop as
    select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def, md5(pg_get_functiondef(p.oid)) as h
    from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname in ('oem_price_calc', 'oem_quote_save', 'oem_quote_renegotiate');

  v_s := pg_temp.suite67(v_shop, v_prod_input, v_today);
  v_log := v_log || v_s;
  v_fail := (length(v_s) - length(replace(v_s, '[FAIL]', ''))) / 6;
  v_ok := (length(v_s) - length(replace(v_s, '[OK]', ''))) / 4;
  v_log := v_log || format(E'--- ชุดเทสต์หลัก: OK %s / FAIL %s\n', v_ok, v_fail);

  -- mutant: แก้ฟังก์ชันจริงทีละจุด · ชุดเทสต์ต้องล้มที่ id ที่ระบุ
  for v_m in
    select * from (values
      ('MA1', 'analytics.oem_quote_save(uuid,jsonb,uuid,text,text,text,text,numeric,text,date,uuid)',
        'v_production_net := v_production_total_sum - case when v_has_product_item then p_discount_thb else 0 end;',
        'v_production_net := v_production_total_sum;', array['P1b', 'P1g']),
      ('MA2', 'analytics.oem_quote_renegotiate(uuid,uuid,numeric,text)',
        'v_production_net := v_production_total_sum - case when v_has_product_item then p_new_discount_thb else 0 end;',
        'v_production_net := v_production_total_sum;', array['P2b']),
      ('MA3', 'analytics.oem_quote_save(uuid,jsonb,uuid,text,text,text,text,numeric,text,date,uuid)',
        E'and (p_discount_thb > 0\n            or ((v_price_total_all',
        E'and (false\n            or ((v_price_total_all', array['P3a', 'P3g']),
      ('MA4', 'analytics.oem_quote_save(uuid,jsonb,uuid,text,text,text,text,numeric,text,date,uuid)',
        '(v_cost_total_all - v_manual_cost_sum) + v_manual_loss_sum) < 0)',
        '(v_cost_total_all - v_manual_cost_sum) + v_manual_loss_sum) < -1000000000000)', array['P4b', 'P4c']),
      ('MA5', 'analytics.oem_quote_renegotiate(uuid,uuid,numeric,text)',
        E'  if v_has_manual_cost\n     and (p_new_discount_thb > 0',
        E'  if false\n     and (p_new_discount_thb > 0', array['P3e']),
      ('MA6', 'analytics.oem_price_calc(uuid,jsonb)',
        E'      if exists (\n        select 1 from public.product pr',
        E'      if false and exists (\n        select 1 from public.product pr', array['P5a', 'P5b', 'P5f']),
      ('MA7', 'analytics.oem_price_calc(uuid,jsonb)',
        'nullif(btrim(analytics.oem_text_strip_invisible(v_prod_name)), '''')',
        'nullif(btrim(v_prod_name), '''')', array['P7c', 'P7e']),
      ('MA8', 'analytics.oem_quote_save(uuid,jsonb,uuid,text,text,text,text,numeric,text,date,uuid)',
        E'nullif(btrim(analytics.oem_text_strip_invisible(p_approval_note), v_note_ws), '''') is null then\n      raise exception ''oem_quote_save: ใบนี้มีรายการสินค้า',
        E'nullif(btrim(p_approval_note), '''') is null then\n      raise exception ''oem_quote_save: ใบนี้มีรายการสินค้า', array['P3f']),
      ('MA9', 'analytics.oem_quote_renegotiate(uuid,uuid,numeric,text)',
        '(v_cost_all - v_manual_cost_sum) + v_manual_loss_sum) < 0)',
        '(v_cost_all - v_manual_cost_sum) + v_manual_loss_sum) < -1000000000000)', array['P4e']),
      ('MA10', 'analytics.oem_price_calc(uuid,jsonb)',
        'or lower(btrim(analytics.oem_text_strip_invisible(pr.name))) = lower(v_prod_name)',
        'or lower(btrim(pr.name)) = lower(v_prod_name)', array['P5c'])
    ) as t(id, sig, f, t, ids)
  loop
    v_total := v_total + 1;
    perform pg_temp.mutate(v_m.sig, v_m.f, v_m.t);
    v_s := pg_temp.suite67(v_shop, v_prod_input, v_today);
    for v_orig in select def from _v167_orig where sig = to_regprocedure(v_m.sig)::text loop
      execute v_orig.def;
    end loop;
    v_cnt := 0;
    foreach v_id in array v_m.ids loop
      if position('[FAIL] ' || v_id || ' ' in v_s) > 0 then
        v_cnt := v_cnt + 1;
      end if;
    end loop;
    -- mutant ที่ต้องมีงานผลิตจริงเป็น fixture: ถ้า SKIP ไม่นับว่ารอด
    if v_cnt >= 1 then
      v_killed := v_killed + 1;
      v_log := v_log || format(E'[OK] %s  mutant ถูกจับ: ล้มที่ %s จาก %s\n', v_m.id, v_cnt, array_to_string(v_m.ids, ','));
    else
      v_survived := v_survived || v_m.id || ' ';
      v_log := v_log || format(E'[FAIL] %s  mutant รอด — ไม่มี id ใน %s ล้มเลย\n', v_m.id, array_to_string(v_m.ids, ','));
    end if;
  end loop;
  v_log := v_log || pg_temp.chk('MX', format('mutant %s จุด ถูกจับ %s · รอด: %s', v_total, v_killed, coalesce(nullif(v_survived, ''), '(ไม่มี)')), v_killed = v_total);

  select count(*) into v_cnt from _v167_orig o where md5(pg_get_functiondef(to_regprocedure(o.sig))) = o.h;
  v_log := v_log || pg_temp.chk('MY', 'หลังคืนของเดิม: md5 definition ทั้ง 3 ฟังก์ชันเท่าเดิม', v_cnt = 3);
  v_s := pg_temp.suite67(v_shop, v_prod_input, v_today);
  v_fail := (length(v_s) - length(replace(v_s, '[FAIL]', ''))) / 6;
  v_log := v_log || pg_temp.chk('MZ', 'หลังคืนของเดิม: ชุดเทสต์หลักรันซ้ำ FAIL ' || v_fail, v_fail = 0);

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_log := v_log || format(E'\n=== สรุป: [FAIL] ทั้งไฟล์ = %s %s ===\n', v_fail, case when v_fail = 0 then '(ผ่าน)' else '(ไม่ผ่าน)' end);
  raise exception '%', v_log;
end $v167$;
