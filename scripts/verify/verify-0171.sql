-- scripts/verify/verify-0171.sql
-- ตรวจ supabase/migrations/0171_oem_quote_cost_today.sql หลัง apply (หรือต่อท้ายไฟล์ 0171 ใน dry-run เดียว)
-- self-rolling-back (3j-migration-traps ข้อ 11): แตะตัวนับเลขที่ใบเสนอราคา ⇒ ทุกเคสเก็บผลลง log แล้ว raise exception ปิดท้ายเสมอ ⇒ rollback ทั้งก้อน
-- ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน · [SKIP] = พิสูจน์ไม่ได้ (ไม่มี oem_quote_item งานผลิตจริงให้ใช้เป็น fixture)
-- โครงเดียวกับ verify-0166..0170: ชุดเทสต์ pg_temp.suite71() รันใน subtransaction ที่ถอยกลับเอง · รอบแรก = ของจริง ต้อง FAIL 0 · รอบถัดไป = mutant
-- ตัวเลขทุน/ราคาคำนวณจาก oem_price_calc ตอนรัน (rates จริงของร้าน) — ไม่เขียนค่าจริงลงไฟล์ · ทุก if ใช้ coalesce(..., true) = null นับเป็นตก (ข้อ 13)
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0171.sql
-- dry-run ก่อน apply: cat supabase/migrations/0171_*.sql scripts/verify/verify-0171.sql > tmp.sql แล้วรันไม่ใส่ --commit
--
-- ============ ตารางแมป "ข้อ security/มติ → เทสต์" ============
--  H1 as_of_date: ห้ามผ่าน H1a (เมื่อวาน/พรุ่งนี้/1999/2099/วันราคาโลหะเก่าสุด/ขยะ/infinity ทุกวัสดุ) H1d (โจมตีจริง: ย้อนวัน + พิมพ์ทับต่ำกว่าทุนวันนี้ → ตก 2 ทางเหมือนกัน)
--     ต้องไม่พัง H1b (วันนี้/ว่าง/null = ไม่ส่ง) H1c (พิมพ์ทับปกติใช้ต้นทุนวันนี้) H1e (เงินแท่งไม่มีช่อง) H1f (สินค้าไม่มีช่อง) H1g (oem_cost_calc ของใบผลิตไม่ถูกแตะ)
--  M1 metal_price_thb_per_gram: M1 (ตัวเลข/สตริง → 22023 · null = ไม่ส่ง)
--  M2 gate override_below_hard_floor (คงเดิมตามมติ): M2a (margin~10% ไม่มี note ตก · มี note ผ่าน · gates ครบ) M2b (~18% ไม่มี hard) M2c (เท่าทุนผ่าน) M2d (ต่ำกว่าทุนตกแม้มี note)
--     M2e (ราคาจากสูตรยังแข็ง) M2f (renegotiate สืบทอด gates)
--  M3 renegotiate ไม่ยืดอายุ: M3a (quoted) M3b (ควบคุม: ไม่มี override = เดิม) M3c (won ทั้งวันยังไม่ผ่าน/ผ่านแล้ว)
--  L1 เหตุผลพิมพ์ทับ: L1 (control/tag/ZWSP/bidi/501 → 22023) L1b (300 ตัวผ่าน ตัด 200)
--  L2 ชุดล่องหนใหม่: L2a-L2f (strip · valid · whitelist · smuggle · ธงปกติผ่าน · ธง tag sequence ถูกบล็อก = หนี้ที่บันทึก · ชื่อรายการ)
--  L3 เพดาน 3 เท่า: L3a (floor(3x) ผ่าน · เกิน → 22023 · ทุกวัสดุ)
--  p_discount_reason: DR · golden replay = ใน migration (3,779 เคส)
--  mutant 11 จุด (MH1-MH12 ยกเว้น MH2) ต้องล้มจริง · verify-0163..0170 รันซ้ำต้องผ่าน (O2b ของ 0169 · N7 ของ 0170 ปรับตามเพดาน 3 เท่า)
--  ⚠️ ที่เทสต์ครอบไม่ได้: PostgREST จริง (probe แยกหลัง apply) · UI (vitest + QA) · UTC/BKK เหลื่อมวันจริง (ทดสอบได้เฉพาะตอนรันช่วง 00:00-07:00 ไทย — golden replay ส่งวันนี้ BKK ให้ legacy เพื่อเทียบได้ทุกเวลา)

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
-- helper เฉพาะ 0171
-- ============================================================================
-- รายการงานผลิต (แบบเดิมของร้าน = ไม่มี NRE · margin_pct 0.5) · p_price/p_reason null = ไม่พิมพ์ทับ · p_extra = key เพิ่ม (as_of_date, metal_price...)
create function pg_temp.pjx(p_prod jsonb, p_metal text, p_qty int, p_price text default null, p_reason text default null,
                            p_extra jsonb default '{}'::jsonb, p_margin numeric default 0.5) returns jsonb
 language sql as $c$
  select jsonb_build_object('input',
    (p_prod - 'as_of_date') || jsonb_build_object('metal', p_metal, 'qty', p_qty, 'margin_pct', p_margin, 'is_new_design', false)
           || case when p_metal = 'gold' then jsonb_build_object('purity', 0.965) else '{}'::jsonb end
           || case when p_price is not null then jsonb_build_object('unit_price_override_thb', pg_temp.num(p_price)) else '{}'::jsonb end
           || case when p_reason is not null then jsonb_build_object('price_override_reason', p_reason) else '{}'::jsonb end
           || p_extra)
$c$;

-- ============================================================================
-- ชุดเทสต์ 0171 — fixture อยู่ใน subtransaction ที่ถอยกลับเสมอ (เรียกซ้ำได้สำหรับ mutant)
-- ตัวเลขทุน/ราคาคำนวณจาก oem_price_calc ตอนรัน (rates จริงของร้าน) — ไม่เขียนค่าจริงลงไฟล์ · if ทุกตัวใช้ coalesce(..., true) = null นับเป็นตก (ข้อ 13)
-- ============================================================================
create function pg_temp.suite71(p_shop uuid, p_prod jsonb, p_today date) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  v_metal text; v_qty int;
  v_c jsonb; v_c0 jsonb; v_c2 jsonb;
  v_pf numeric; v_cost numeric; v_p text; v_p2 text;
  v_bad1 text := ''; v_bad2 text := ''; v_bad3 text := ''; v_bad4 text := ''; v_bad5 text := ''; v_bad6 text := ''; v_bad7 text := '';
  v_r text; v_r2 text; v_r3 text; v_q uuid; v_row record; v_row2 record;
  v_val text; v_d date; v_dstr text; v_cnt int; v_gates text[]; v_days int;
  v_id uuid; v_state text;
  v_oldest date;
begin
  begin
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    update analytics.oem_setting set
      margin_target_pct = 0.30, margin_floor_pct = 0.20, margin_hard_floor_pct = 0.15, min_job_value_thb = 1
      where shop_id = p_shop;
    select coalesce(quote_valid_days_silver, 30) into v_days from analytics.oem_setting where shop_id = p_shop;
    v_days := coalesce(v_days, 30);

    -- ========================================================================
    -- L2: ชุดอักขระล่องหนเพิ่ม (ไม่ต้องใช้งานผลิต)
    -- ========================================================================
    v_bad1 := '';
    foreach v_cnt in array array[x'180B'::int, x'180C'::int, x'180D'::int, x'180F'::int, x'FFF9'::int, x'FFFA'::int, x'FFFB'::int,
                                  x'1D173'::int, x'1D174'::int, x'1D17A'::int, x'E0000'::int, x'E0041'::int, x'E007F'::int, x'E0020'::int] loop
      if analytics.oem_text_strip_invisible('a' || chr(v_cnt) || 'b') <> 'ab'
         or analytics.oem_note_valid('a' || chr(v_cnt) || 'b')
         or analytics.oem_note_present(' ' || chr(v_cnt) || ' ') then
        v_bad1 := v_bad1 || to_hex(v_cnt) || ' ';
      end if;
    end loop;
    v_log := v_log || pg_temp.chk('L2a', 'อักขระล่องหนใหม่ U+180B/C/D/F · FFF9-FFFB · 1D173-1D17A · Tag block E0000-E007F: strip ลบ · oem_note_valid = false · note ล้วนไม่ผ่าน whitelist ' || v_bad1, v_bad1 = '');
    -- ข้อความ ASCII ซ่อนใน tag char (ASCII smuggling): "a" + tag(xyz)
    v_val := 'a' || chr(917504 + ascii('x')) || chr(917504 + ascii('y')) || chr(917504 + ascii('z'));
    v_log := v_log || pg_temp.chk('L2b', 'note "a" + tag characters ที่สะกด xyz → strip เหลือ "a" · oem_note_valid=false (ข้อความซ่อนถูกปฏิเสธก่อนเก็บ)',
      analytics.oem_text_strip_invisible(v_val) = 'a' and not analytics.oem_note_valid(v_val));
    v_bad2 := '';
    foreach v_val in array array[chr(8203) || 'x', chr(8238) || 'x', chr(8288) || 'x', chr(65279) || 'x', chr(173) || 'x', chr(12644) || 'x'] loop
      if analytics.oem_note_valid(v_val) then v_bad2 := v_bad2 || to_hex(ascii(v_val)) || ' '; end if;
    end loop;
    v_log := v_log || pg_temp.chk('L2c', 'ต้องไม่พัง (ชุดเดิมยังบล็อก): ZWSP · RLO · U+2060 · BOM · SHY · Hangul filler ' || v_bad2, v_bad2 = '');
    v_bad3 := '';
    foreach v_val in array array['ธงชาติไทย ' || chr(127481) || chr(127469), 'ธงดำ ' || chr(127988), 'ครอบครัว ' || chr(128104) || chr(8205) || chr(128105) || chr(8205) || chr(128103),
                                  'ปกติ 123 abc', 'หลายบรรทัด' || chr(10) || 'ต่อ', chr(10084) || chr(65039) || ' หัวใจ'] loop
      if not analytics.oem_note_valid(v_val) then v_bad3 := v_bad3 || left(v_val, 6) || ' '; end if;
    end loop;
    v_log := v_log || pg_temp.chk('L2d', 'ต้องไม่พัง: ธงประเทศ (regional indicators) · ธงดำ · อีโมจิครอบครัว (ZWJ) · ไทย/อังกฤษ/เลข/หลายบรรทัด · หัวใจ+VS16 ยังผ่าน ' || v_bad3, v_bad3 = '');
    v_log := v_log || pg_temp.chk('L2e', 'หนี้ที่รู้ตัว (บล็อกทั้งช่วง Tag): ธงอังกฤษแบบ tag sequence (ธงดำ + tag + cancel) ถูกปฏิเสธ — บันทึกไว้ใน design ไม่ใช่บั๊ก',
      not analytics.oem_note_valid(chr(127988) || chr(917607) || chr(917602) || chr(917605) || chr(917614) || chr(917607) || chr(917631)));
    v_r := pg_temp.t_calc(p_shop, pg_temp.pin(null, 1, '100', '60', 'ชื่อ' || chr(917601) || 'ลับ', null));
    v_log := v_log || pg_temp.chk('L2f', 'ชื่อรายการ (oem_customer_text_clean) ที่มี tag char → 22023', v_r like 'ERR:22023:%');

    -- ========================================================================
    -- p_discount_reason ของ oem_quote_save ผ่าน oem_note_valid
    -- ========================================================================
    v_bad4 := '';
    foreach v_val in array array[chr(8238) || 'x', chr(7) || 'x', chr(917601) || 'x', repeat('ก', 501)] loop
      begin
        v_id := analytics.oem_quote_save(p_shop_id => p_shop,
          p_items => jsonb_build_array(pg_temp.pit(pg_temp.pin(null, 1, '100', '60', 'ค่าส่ง171', null), null)),
          p_status => 'draft', p_discount_thb => 10, p_discount_reason => v_val);
        v_bad4 := v_bad4 || '[' || to_hex(ascii(v_val)) || ']';
      exception when others then
        get stacked diagnostics v_state = returned_sqlstate;
        if v_state <> '22023' then v_bad4 := v_bad4 || '[' || to_hex(ascii(v_val)) || ':' || v_state || ']'; end if;
      end;
    end loop;
    begin
      v_id := analytics.oem_quote_save(p_shop_id => p_shop,
        p_items => jsonb_build_array(pg_temp.pit(pg_temp.pin(null, 1, '100', '60', 'ค่าส่ง171', null), null)),
        p_status => 'draft', p_discount_thb => 10, p_discount_reason => 'ลูกค้าประจำ ' || chr(127481) || chr(127469));
    exception when others then
      v_bad4 := v_bad4 || '[normal rejected: ' || sqlerrm || ']';
    end;
    v_log := v_log || pg_temp.chk('DR', 'p_discount_reason มี bidi / control / tag / ยาว 501 → 22023 · เหตุผลปกติ (ไทย + ธง) ผ่าน ' || v_bad4, v_bad4 = '');

    -- ========================================================================
    -- ส่วนที่ต้องมีงานผลิตจริงเป็น fixture
    -- ========================================================================
    if p_prod is null then
      v_log := v_log || '[SKIP] ส่วนงานผลิต: ไม่มี oem_quote_item งานผลิตจริงให้ใช้เป็น fixture' || E'\n';
      raise exception 'suite71 rollback marker' using errcode = 'P0171';
    end if;

    select min(as_of_date) into v_oldest from analytics.oem_metal_price where shop_id = p_shop;

    foreach v_metal in array array['silver', 'gold', 'brass'] loop
      v_qty := case v_metal when 'brass' then 100 else 50 end;
      v_c0 := pg_temp.calc_or_null(p_shop, (pg_temp.pjx(p_prod, v_metal, v_qty))->'input');
      if v_c0 is null or not (v_c0->>'is_complete')::boolean then
        v_log := v_log || '[SKIP] ' || v_metal || ': fixture คำนวณไม่ครบวันนี้' || E'\n';
        continue;
      end if;
      v_pf := (v_c0->'breakdown'->>'price_per_piece')::numeric;
      v_cost := (v_c0->'breakdown'->>'cost_piece')::numeric;

      -- H1a: as_of_date ที่ไม่ใช่วันนี้ (BKK) → 22023 ทุกค่า (เมื่อวาน · พรุ่งนี้ · เก่ามาก · อนาคตไกล · ราคาโลหะเก่าสุดในระบบ · ขยะ · infinity)
      foreach v_dstr in array array[(p_today - 1)::text, (p_today + 1)::text, '1999-12-31', '2099-01-01', coalesce(v_oldest::text, '2020-01-01'), 'abc', 'infinity'] loop
        v_r := pg_temp.t_calc(p_shop, (pg_temp.pjx(p_prod, v_metal, v_qty, null, null, jsonb_build_object('as_of_date', v_dstr)))->'input');
        if coalesce(v_r not like 'ERR:22023:%as_of_date%', true) then v_bad1 := v_bad1 || v_metal || '[' || v_dstr || ']=' || left(v_r, 40) || ' '; end if;
      end loop;

      -- H1b: as_of_date = วันนี้ / null / ว่าง / ช่องว่าง → ผลเท่าไม่ส่ง key เป๊ะ (jsonb)
      foreach v_dstr in array array[p_today::text, '', '  '] loop
        v_c2 := pg_temp.calc_or_null(p_shop, (pg_temp.pjx(p_prod, v_metal, v_qty, null, null, jsonb_build_object('as_of_date', v_dstr)))->'input');
        if coalesce(v_c2 is distinct from v_c0, true) then v_bad2 := v_bad2 || v_metal || '[' || v_dstr || '] '; end if;
      end loop;
      v_c2 := pg_temp.calc_or_null(p_shop, (pg_temp.pjx(p_prod, v_metal, v_qty, null, null, jsonb_build_object('as_of_date', null)))->'input');
      if coalesce(v_c2 is distinct from v_c0, true) then v_bad2 := v_bad2 || v_metal || '[json null] '; end if;

      -- M1: metal_price_thb_per_gram → 22023 · null/ว่างผ่านเท่าไม่ส่ง
      v_r := pg_temp.t_calc(p_shop, (pg_temp.pjx(p_prod, v_metal, v_qty, null, null, jsonb_build_object('metal_price_thb_per_gram', 0.01)))->'input');
      v_r2 := pg_temp.t_calc(p_shop, (pg_temp.pjx(p_prod, v_metal, v_qty, null, null, jsonb_build_object('metal_price_thb_per_gram', '123')))->'input');
      v_c2 := pg_temp.calc_or_null(p_shop, (pg_temp.pjx(p_prod, v_metal, v_qty, null, null, jsonb_build_object('metal_price_thb_per_gram', null)))->'input');
      if coalesce(v_r not like 'ERR:22023:%ห้ามส่งราคาโลหะเอง%' or v_r2 not like 'ERR:22023:%ห้ามส่งราคาโลหะเอง%' or v_c2 is distinct from v_c0, true) then
        v_bad3 := v_bad3 || v_metal || ' ';
      end if;

      -- L3: เพดาน 3 เท่าของราคาจากสูตร — เท่ากับ floor(3x ราคาสูตร) ผ่าน · เกิน 1 สตางค์ขึ้นไป → 22023
      v_p := (floor(3 * v_pf * 100) / 100)::text;
      v_p2 := (ceil(3 * v_pf * 100) / 100 + 0.01)::text;
      v_r := pg_temp.t_calc(p_shop, (pg_temp.pjx(p_prod, v_metal, v_qty, v_p, 'ลูกค้าพิเศษ'))->'input');
      v_r2 := pg_temp.t_calc(p_shop, (pg_temp.pjx(p_prod, v_metal, v_qty, v_p2, 'ลูกค้าพิเศษ'))->'input');
      if coalesce(v_r <> 'OK' or v_r2 not like 'ERR:22023:%สูงกว่า 3 เท่าของราคาจากสูตร%', true) then v_bad4 := v_bad4 || v_metal || '[' || left(v_r, 30) || '|' || left(v_r2, 30) || '] '; end if;

      -- L1: เหตุผลราคาที่พิมพ์มี control / tag / ZWSP / bidi / ยาว 501 → 22023 · 300 ตัว (ยาวเกิน 200 แต่ ≤ 500) ผ่านและถูกตัดเหลือ 200
      foreach v_val in array array['ok' || chr(7), 'ok' || chr(917569) || chr(917570), 'ok' || chr(8203), chr(8238) || 'ok', repeat('ก', 501)] loop
        v_r := pg_temp.t_calc(p_shop, (pg_temp.pjx(p_prod, v_metal, v_qty, round(v_pf * 1.1, 2)::text, v_val))->'input');
        if coalesce(v_r not like 'ERR:22023:%', true) then v_bad5 := v_bad5 || v_metal || '[' || to_hex(ascii(right(v_val, 1))) || '] '; end if;
      end loop;
      v_c2 := pg_temp.calc_or_null(p_shop, (pg_temp.pjx(p_prod, v_metal, v_qty, round(v_pf * 1.1, 2)::text, repeat('ก', 300)))->'input');
      if coalesce(length(v_c2->'breakdown'->'production_override'->>'reason') <> 200, true) then v_bad6 := v_bad6 || v_metal || ' '; end if;

      -- ต้องไม่พัง: พิมพ์ทับปกติ (สูงกว่าสูตรเล็กน้อย) ผ่านและใช้ต้นทุนของวันนี้
      v_c2 := pg_temp.calc_or_null(p_shop, (pg_temp.pjx(p_prod, v_metal, v_qty, round(v_pf * 1.1, 2)::text, 'ลูกค้าประจำ'))->'input');
      if coalesce((v_c2->'breakdown'->>'cost_piece')::numeric <> v_cost or not (v_c2->'floors'->'price_vs_cost'->>'pass')::boolean, true) then v_bad7 := v_bad7 || v_metal || ' '; end if;
    end loop;

    v_log := v_log || pg_temp.chk('H1a', 'as_of_date เมื่อวาน / พรุ่งนี้ / 1999 / 2099 / วันราคาโลหะเก่าสุด / ขยะ / infinity → 22023 "as_of_date" (เงิน ทอง ทองเหลือง) ' || v_bad1, v_bad1 = '');
    v_log := v_log || pg_temp.chk('H1b', 'ต้องไม่พัง: as_of_date = วันนี้ (BKK) / ว่าง / ช่องว่าง / JSON null → ผล calc เท่าไม่ส่ง key เป๊ะ ' || v_bad2, v_bad2 = '');
    v_log := v_log || pg_temp.chk('M1', 'metal_price_thb_per_gram (ตัวเลข/สตริง) → 22023 "ห้ามส่งราคาโลหะเอง" · null → เท่าไม่ส่ง ' || v_bad3, v_bad3 = '');
    v_log := v_log || pg_temp.chk('L3a', 'เพดาน 3 เท่า: floor(3x ราคาสูตร) ผ่าน (ขอบ) · เกินขึ้นไป → 22023 "สูงกว่า 3 เท่าของราคาจากสูตร" ' || v_bad4, v_bad4 = '');
    v_log := v_log || pg_temp.chk('L1', 'price_override_reason มี control / tag / ZWSP / bidi / ยาว 501 → 22023 ' || v_bad5, v_bad5 = '');
    v_log := v_log || pg_temp.chk('L1b', 'ต้องไม่พัง: เหตุผล 300 ตัวผ่าน และเก็บ snapshot ตัดเหลือ 200 ' || v_bad6, v_bad6 = '');
    v_log := v_log || pg_temp.chk('H1c', 'ต้องไม่พัง: พิมพ์ทับสูงกว่าสูตร 10% ผ่าน · cost_piece = ทุนของวันนี้ · price_vs_cost ผ่าน ' || v_bad7, v_bad7 = '');

    -- ========================================================================
    -- H1: การโจมตีจริง (a2/a3 ของ security) — ย้อนวัน + พิมพ์ทับต่ำกว่าทุนวันนี้
    -- ========================================================================
    v_c0 := pg_temp.calc_or_null(p_shop, (pg_temp.pjx(p_prod, 'silver', 50))->'input');
    v_cost := (v_c0->'breakdown'->>'cost_piece')::numeric;
    v_p := round(ceil(v_cost * 0.9 * 100) / 100, 2)::text;   -- ต่ำกว่าทุนวันนี้ 10%
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjx(p_prod, 'silver', 50, v_p, 'ทดสอบ', jsonb_build_object('as_of_date', coalesce(v_oldest::text, (p_today - 30)::text)))), 'quoted', 'อนุมัติโดยเจ้าของ');
    v_r2 := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjx(p_prod, 'silver', 50, v_p, 'ทดสอบ')), 'quoted', 'อนุมัติโดยเจ้าของ');
    v_log := v_log || pg_temp.chk('H1d', 'โจมตี: ย้อน as_of_date + พิมพ์ทับต่ำกว่าทุนวันนี้ quoted → 22023 "as_of_date" · ไม่ย้อนก็ตก "ต่ำกว่าทุน" (ทางเดียวกัน = ไม่มีช่องเหลือ)',
      v_r like 'ERR:22023:%as_of_date%' and v_r2 like 'ERR:22023:%ต่ำกว่าทุน%');

    -- เงินแท่ง / สินค้า: ไม่มีช่อง as_of_date เดียวกัน — ส่งค่าเก่าแล้วผลเท่าไม่ส่ง
    v_c := pg_temp.calc_or_null(p_shop, jsonb_build_object('metal', 'silver999', 'bar_size', '1_baht', 'qty', 1));
    v_c2 := pg_temp.calc_or_null(p_shop, jsonb_build_object('metal', 'silver999', 'bar_size', '1_baht', 'qty', 1, 'as_of_date', '1999-12-31'));
    v_log := v_log || pg_temp.chk('H1e', 'เงินแท่ง: as_of_date เก่า (ข้อมูลแสดงผลของ client) ไม่เปลี่ยนผล calc — เท่าไม่ส่ง (ไม่มีช่องย้อนวัน)', v_c is not null and v_c2 is not distinct from v_c);
    v_c := pg_temp.calc_or_null(p_shop, (pg_temp.pin(null, 1, '100', '60', 'ค่าส่ง171', null)));
    v_c2 := pg_temp.calc_or_null(p_shop, (pg_temp.pin(null, 1, '100', '60', 'ค่าส่ง171', null)) || jsonb_build_object('as_of_date', '1999-12-31'));
    v_log := v_log || pg_temp.chk('H1f', 'สินค้า (manual): as_of_date เก่าไม่เปลี่ยนผล calc (สินค้าไม่อ่าน as_of_date)', v_c is not null and v_c2 is not distinct from v_c);

    -- ใบผลิต: oem_cost_calc ไม่ถูกแตะ — ยังรับ as_of_date + ราคาโลหะที่กรอกเอง (production order path)
    v_c := analytics.oem_cost_calc(p_shop, (pg_temp.pjx(p_prod, 'silver', 50))->'input');
    v_c2 := analytics.oem_cost_calc(p_shop, (pg_temp.pjx(p_prod, 'silver', 50, null, null, jsonb_build_object('as_of_date', (p_today - 1)::text, 'metal_price_thb_per_gram', 0.5)))->'input');
    v_log := v_log || pg_temp.chk('H1g', 'ใบผลิต: oem_cost_calc ยังรับ as_of_date ย้อนหลัง + metal_price_thb_per_gram (ไม่ raise · ต้นทุนเปลี่ยนตามราคาโลหะที่กรอก) — 0171 ไม่แตะฟังก์ชันนี้',
      v_c2 is not null and (v_c2->'_raw'->>'cost_piece')::numeric is distinct from (v_c->'_raw'->>'cost_piece')::numeric);

    -- ========================================================================
    -- M2: gate override_below_hard_floor (มติ: คงเดิม) — ต่ำกว่า hard floor ออกได้เมื่อมี note · เท่าทุนได้ · ต่ำกว่าทุนห้าม
    -- ========================================================================
    v_p := round(ceil(v_cost / 0.90 * 100) / 100, 2)::text;      -- margin ~10% (< hard floor 15%)
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjx(p_prod, 'silver', 50, v_p, 'ปิดดีลใหญ่')), 'quoted', null);
    v_r2 := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjx(p_prod, 'silver', 50, v_p, 'ปิดดีลใหญ่')), 'quoted', 'อนุมัติโดยเจ้าของ');
    select approval_gates into v_gates from analytics.oem_quote where id = pg_temp.qid(v_r2);
    v_log := v_log || pg_temp.chk('M2a', 'พิมพ์ทับ margin ~10% (ต่ำกว่า hard floor 15% สูงกว่าทุน): ไม่มี note → 22023 · มี note → ผ่าน · approval_gates = {override_below_floor, override_below_hard_floor}',
      v_r like 'ERR:22023:%' and v_r2 like 'OK:%' and v_gates @> array['override_below_floor', 'override_below_hard_floor']::text[] and cardinality(v_gates) = 2);
    v_p := round(ceil(v_cost / 0.82 * 100) / 100, 2)::text;      -- margin ~18% (ระหว่าง hard กับ floor)
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjx(p_prod, 'silver', 50, v_p, 'ลดให้ลูกค้า')), 'quoted', 'อนุมัติโดยเจ้าของ');
    select approval_gates into v_gates from analytics.oem_quote where id = pg_temp.qid(v_r);
    v_log := v_log || pg_temp.chk('M2b', 'พิมพ์ทับ margin ~18% (สูงกว่า hard floor ต่ำกว่า floor): gates = {override_below_floor} เท่านั้น — ไม่มี override_below_hard_floor', v_r like 'OK:%' and v_gates = array['override_below_floor']::text[]);
    v_p := round(ceil((v_cost + 0.01) * 100) / 100, 2)::text;    -- เท่าทุน + 0.01 (ขายเท่าทุนได้)
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjx(p_prod, 'silver', 50, v_p, 'ขายเท่าทุน')), 'quoted', 'อนุมัติโดยเจ้าของ');
    select approval_gates into v_gates from analytics.oem_quote where id = pg_temp.qid(v_r);
    v_log := v_log || pg_temp.chk('M2c', 'พิมพ์ทับเท่าทุน (+0.01) มี note → ผ่าน (มติ: ขายเท่าทุนได้) · gates มี override_below_hard_floor', v_r like 'OK:%' and v_gates @> array['override_below_hard_floor']::text[]);
    v_p := round(floor(v_cost * 0.99 * 100) / 100, 2)::text;     -- ต่ำกว่าทุน
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjx(p_prod, 'silver', 50, v_p, 'ต่ำกว่าทุน')), 'quoted', 'อนุมัติโดยเจ้าของ');
    v_log := v_log || pg_temp.chk('M2d', 'พิมพ์ทับต่ำกว่าทุน แม้มี note → 22023 (แข็งเสมอ)', v_r like 'ERR:22023:%ต่ำกว่าทุนต่อชิ้น%');
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjx(p_prod, 'silver', 50, null, null, '{}'::jsonb, 0.10)), 'quoted', 'อนุมัติโดยเจ้าของ');
    v_log := v_log || pg_temp.chk('M2e', 'ด่านรายชิ้นแข็งเฉพาะราคาจากสูตร: งานผลิตไม่มี override margin 10% แม้มี note → 22023 hard floor', v_r like 'ERR:22023:%hard floor%');
    v_p := round(ceil(v_cost / 0.90 * 100) / 100, 2)::text;
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjx(p_prod, 'silver', 50, v_p, 'ปิดดีลใหญ่')), 'quoted', 'อนุมัติโดยเจ้าของ');
    v_q := pg_temp.qid(v_r);
    v_r2 := pg_temp.t_reneg(p_shop, v_q, 0, null);
    select approval_gates into v_gates from analytics.oem_quote where id = pg_temp.qid(v_r2);
    v_log := v_log || pg_temp.chk('M2f', 'renegotiate สืบทอด gates ของใบแม่ครบ (รวม override_below_hard_floor)', v_r2 like 'OK:%' and v_gates @> array['override_below_floor', 'override_below_hard_floor']::text[]);

    -- ========================================================================
    -- M3: renegotiate ใบที่มีรายการพิมพ์ทับ ไม่ยืดอายุเกินใบแม่
    -- ========================================================================
    v_c0 := pg_temp.calc_or_null(p_shop, (pg_temp.pjx(p_prod, 'silver', 50))->'input');
    v_p := round((v_c0->'breakdown'->>'price_per_piece')::numeric * 1.1, 2)::text;
    -- quoted: ใบแม่เหลืออีก 3 วัน → ใบลูกไม่เกิน +3 (ไม่ใช่ +อายุเต็ม)
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjx(p_prod, 'silver', 50, v_p, 'ลูกค้าประจำ')), 'quoted', null);
    v_q := pg_temp.qid(v_r);
    update analytics.oem_quote set quote_valid_until = p_today + 3 where id = v_q;
    v_r2 := pg_temp.t_reneg(p_shop, v_q, 0, null);
    select quote_valid_until into v_d from analytics.oem_quote where id = pg_temp.qid(v_r2);
    v_log := v_log || pg_temp.chk('M3a', 'ต่อราคาใบ quoted ที่มีรายการพิมพ์ทับ (ใบแม่เหลือ 3 วัน): ใบลูก quote_valid_until = วันของใบแม่ ไม่ยืดเป็น +' || v_days, v_r2 like 'OK:%' and v_d = p_today + 3);
    -- ควบคุม: ไม่มีรายการพิมพ์ทับ → พฤติกรรมเดิม (ยืดเป็นอายุเต็มของวัสดุ)
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjx(p_prod, 'silver', 50)), 'quoted', null);
    v_q := pg_temp.qid(v_r);
    update analytics.oem_quote set quote_valid_until = p_today + 3 where id = v_q;
    v_r2 := pg_temp.t_reneg(p_shop, v_q, 0, null);
    select quote_valid_until into v_d from analytics.oem_quote where id = pg_temp.qid(v_r2);
    v_log := v_log || pg_temp.chk('M3b', 'ต้องไม่พัง: ใบที่ไม่มีรายการพิมพ์ทับ ต่อราคาแล้วอายุเท่าเดิม (+' || v_days || ' วันนับจากวันนี้ ตามพฤติกรรมเดิม)', v_r2 like 'OK:%' and v_d = p_today + v_days);
    -- won: ใบแม่ won วันเดิมยังไม่ผ่าน → ไม่เกินวันเดิม · วันเดิมผ่านไปแล้ว → ไม่เกินวันนี้ (ไม่ย้อนหลัง ไม่ยืด)
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjx(p_prod, 'silver', 50, v_p, 'ลูกค้าประจำ')), 'quoted', null);
    v_q := pg_temp.qid(v_r);
    update analytics.oem_quote set status = 'won', quote_valid_until = p_today + 3 where id = v_q;
    v_r2 := pg_temp.t_reneg(p_shop, v_q, 0, null);
    select quote_valid_until, status into v_row from analytics.oem_quote where id = pg_temp.qid(v_r2);
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjx(p_prod, 'silver', 50, v_p, 'ลูกค้าประจำ')), 'quoted', null);
    v_q := pg_temp.qid(v_r);
    update analytics.oem_quote set status = 'won', quote_valid_until = p_today - 5 where id = v_q;
    v_r3 := pg_temp.t_reneg(p_shop, v_q, 0, null);
    select quote_valid_until, status into v_row2 from analytics.oem_quote where id = pg_temp.qid(v_r3);
    v_log := v_log || pg_temp.chk('M3c', 'ใบแม่ won: วันเดิม +3 → ใบลูก +3 (ไม่ยืด) · วันเดิมผ่านไปแล้ว (-5) → ใบลูก = วันนี้ (ไม่ย้อนหลัง) · สถานะ won สืบทอด',
      v_r2 like 'OK:%' and v_row.quote_valid_until = p_today + 3 and v_row.status = 'won'
      and v_r3 like 'OK:%' and v_row2.quote_valid_until = p_today and v_row2.status = 'won');

    raise exception 'suite71 rollback marker' using errcode = 'P0171';
  exception
    when sqlstate 'P0171' then null;
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

do $v171$
declare
  v_log text := E'\n=== verify 0171 (ต้นทุนใบเสนอราคา = วันนี้เสมอ + แก้ตาม security 0169/0170) ===\n';
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
  v_sav text := 'analytics.oem_quote_save(uuid,jsonb,uuid,text,text,text,text,numeric,text,date,uuid)';
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select count(*) into v_cnt from public.shop;
  if v_cnt <> 1 then
    raise exception 'verify-0171 หยุด: public.shop มี % ร้าน (ไฟล์นี้ออกแบบสำหรับร้านเดียว)', v_cnt;
  end if;
  select id into v_shop from public.shop;
  select input into v_prod_input from analytics.oem_quote_item where input->>'metal' = 'silver' order by created_at limit 1;

  select count(*) into v_cnt from pg_proc where pronamespace = 'analytics'::regnamespace
    and proname in ('oem_price_calc', 'oem_quote_save', 'oem_quote_renegotiate', 'oem_note_present', 'oem_note_valid', 'oem_text_strip_invisible');
  v_log := v_log || pg_temp.chk('Z1', format('6 ฟังก์ชัน = 6 แถวใน pg_proc (ไม่มี overload) ได้ %s', v_cnt), v_cnt = 6);
  select count(*) into v_cnt from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'oem_price_calc_legacy';
  v_log := v_log || pg_temp.chk('Z2', 'ไม่มี oem_price_calc_legacy ค้าง', v_cnt = 0);
  select count(*) into v_cnt from pg_proc p
    where p.pronamespace = 'analytics'::regnamespace
      and p.proname in ('oem_price_calc', 'oem_quote_save', 'oem_quote_renegotiate', 'oem_note_present', 'oem_note_valid', 'oem_text_strip_invisible', 'oem_cost_calc')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
           or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0));
  v_log := v_log || pg_temp.chk('Z3', 'ไม่มี execute ให้ anon / authenticated / PUBLIC (รวม oem_cost_calc ที่ไม่ได้แตะ)', v_cnt = 0);

  create temp table _v171_orig on commit drop as
    select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def, md5(pg_get_functiondef(p.oid)) as h
    from pg_proc p where p.pronamespace = 'analytics'::regnamespace
      and p.proname in ('oem_price_calc', 'oem_quote_save', 'oem_quote_renegotiate', 'oem_text_strip_invisible');

  v_s := pg_temp.suite71(v_shop, v_prod_input, v_today);
  v_log := v_log || v_s;
  v_fail := (length(v_s) - length(replace(v_s, '[FAIL]', ''))) / 6;
  v_ok := (length(v_s) - length(replace(v_s, '[OK]', ''))) / 4;
  v_log := v_log || format(E'--- ชุดเทสต์หลัก: OK %s / FAIL %s\n', v_ok, v_fail);

  for v_m in
    select * from (values
      ('MH1', 'analytics.oem_price_calc(uuid,jsonb)', 'if v_asof_in is distinct from v_today_bkk then', 'if false then', array['H1a', 'H1d']),
      ('MH3', 'analytics.oem_price_calc(uuid,jsonb)',
        'if nullif(btrim(p_input->>''metal_price_thb_per_gram''), '''') is not null then',
        'if false and nullif(btrim(p_input->>''metal_price_thb_per_gram''), '''') is not null then', array['M1']),
      ('MH4', 'analytics.oem_price_calc(uuid,jsonb)', 'if v_po > 3 * v_formula_price then', 'if false then', array['L3a']),
      ('MH5', 'analytics.oem_price_calc(uuid,jsonb)',
        'if not analytics.oem_note_valid(p_input->>''price_override_reason'') then', 'if false then', array['L1']),
      ('MH6', v_sav, 'case when v_gate_hard then ''override_below_hard_floor'' end', 'null', array['M2a', 'M2c', 'M2f']),
      ('MH7', 'analytics.oem_quote_renegotiate(uuid,uuid,numeric,text)',
        'if v_has_prod_ovr and v_old.quote_valid_until is not null then', 'if false then', array['M3a', 'M3c']),
      ('MH8', 'analytics.oem_text_strip_invisible(text)',
        chr(92) || 'U000E0000-' || chr(92) || 'U000E007F', '', array['L2a', 'L2b']),
      ('MH9', v_sav, 'if not analytics.oem_note_valid(p_discount_reason) then', 'if false then', array['DR']),
      ('MH10', 'analytics.oem_price_calc(uuid,jsonb)', 'if v_po > 3 * v_formula_price then', 'if v_po > 2 * v_formula_price then', array['L3a', 'H1c']),
      ('MH11', 'analytics.oem_text_strip_invisible(text)',
        chr(92) || 'uFFF9-' || chr(92) || 'uFFFB', '', array['L2a']),
      ('MH12', 'analytics.oem_text_strip_invisible(text)',
        chr(92) || 'u180B-' || chr(92) || 'u180F', chr(92) || 'u180E', array['L2a'])
    ) as t(id, sig, f, t, ids)
  loop
    v_total := v_total + 1;
    perform pg_temp.mutate(v_m.sig, v_m.f, v_m.t);
    v_s := pg_temp.suite71(v_shop, v_prod_input, v_today);
    for v_orig in select def from _v171_orig where sig = to_regprocedure(v_m.sig)::text loop
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

  select count(*) into v_cnt from _v171_orig o where md5(pg_get_functiondef(to_regprocedure(o.sig))) = o.h;
  v_log := v_log || pg_temp.chk('MY', 'หลังคืนของเดิม: md5 definition ทั้ง 4 ฟังก์ชันเท่าเดิม', v_cnt = 4);
  v_s := pg_temp.suite71(v_shop, v_prod_input, v_today);
  v_fail := (length(v_s) - length(replace(v_s, '[FAIL]', ''))) / 6;
  v_log := v_log || pg_temp.chk('MZ', 'หลังคืนของเดิม: ชุดเทสต์หลักรันซ้ำ FAIL ' || v_fail, v_fail = 0);

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_log := v_log || format(E'\n=== สรุป: [FAIL] ทั้งไฟล์ = %s %s ===\n', v_fail, case when v_fail = 0 then '(ผ่าน)' else '(ไม่ผ่าน)' end);
  raise exception '%', v_log;
end $v171$;
