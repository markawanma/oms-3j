-- scripts/verify/verify-0170.sql
-- ตรวจ supabase/migrations/0170_oem_nre_follows_override.sql หลัง apply (หรือต่อท้ายไฟล์ 0170 ใน dry-run เดียว)
-- self-rolling-back (3j-migration-traps ข้อ 11): แตะตัวนับเลขที่ใบเสนอราคา ⇒ ทุกเคสเก็บผลลง log แล้ว raise exception ปิดท้ายเสมอ ⇒ rollback ทั้งก้อน
-- ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน · [SKIP] = พิสูจน์ไม่ได้ (ไม่มี oem_quote_item งานผลิตจริงให้ใช้เป็น fixture / วัสดุนั้นไม่มี NRE)
-- โครงเดียวกับ verify-0166..0169: ชุดเทสต์ pg_temp.suite70() รันใน subtransaction ที่ถอยกลับเอง · รอบแรก = ของจริง ต้อง FAIL 0 · รอบถัดไป = mutant
-- ตัวเลขทุน/NRE/ราคาคำนวณจาก oem_price_calc ตอนรัน (ใช้ rates จริงของร้าน) — ไม่เขียนค่าจริงลงไฟล์ · ทุก if ใช้ coalesce(..., true) = ค่า null นับเป็นตก ไม่ใช่ผ่าน (ข้อ 13)
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0170.sql
-- dry-run ก่อน apply: cat supabase/migrations/0170_*.sql scripts/verify/verify-0170.sql > tmp.sql แล้วรันไม่ใส่ --commit
--
-- ============ ตารางแมป "มติ/ข้อบรีฟ → เทสต์" ============
--  NRE ของรายการที่พิมพ์ราคาทับใช้ margin ของราคาที่พิมพ์ (ตามทั้งขึ้นและลง) — ทุกวัสดุ silver/gold/brass (วนต่อวัสดุ):
--   ต้องไม่พัง  N1 ไม่มี override = เท่าเดิม · N2 ต่ำกว่าสูตร NRE ลดตาม (>= ทุน NRE) · N3 สูงกว่าสูตร NRE ขึ้นตาม · N4 เท่าสูตร ≈ NRE สูตร ·
--               N5 เท่าทุน+0.01 ≈ ทุน NRE · N8 แบบเดิมของร้าน (ไม่มี NRE) = 0 เหมือนเดิม · N0 NaN/Inf/0/ติดลบ/เกินเพดาน ยังถูกปฏิเสธ
--   ห้ามผ่าน    N9 NRE ต่ำกว่าทุน NRE ทุกกรณี · N6 ต่ำกว่าทุน (preview) NRE = ทุน NRE margin 0 + warning · N7 margin > 95% clamp 0.95 + warning
--   gate        S1 save: header nre_price/nre_cost/quote_total ถูก · S2 min_job_value ใช้ยอดรวม NRE ใหม่ · M1 ใบผสม NRE ต่อรายการ + header = ผลรวม ·
--               R1 renegotiate คัดลอก NRE เท่าเดิม · R2 ด่านสถานะเดิม
--   ไม่เพิ่มด่านใน save/renegotiate: ด่านที่ใช้ nre_price อ่านจาก calc รายการอยู่แล้ว (S1 S2 M1 R1 ล็อก)
--  golden replay = ใน migration (3,758 เคส: ไม่มี override เท่า legacy · override ต่างเฉพาะ NRE + invariants)
--  mutant 8 จุด (MN1-MN8: ถอด floor ทุน NRE · ใช้ margin % เดิม · ถอด clamp · ถอด snapshot · ปิดการคิดใหม่ · เปลี่ยนเพดาน ...) ต้องล้มจริง
--  verify-0163/0165/0166/0167/0168/0169 รันซ้ำต้องผ่าน (O1b ของ 0169 ปรับ: NRE ไม่เท่าสูตรอีกต่อไป)
--  ⚠️ ที่เทสต์ครอบไม่ได้: PostgREST จริง (probe แยกหลัง apply) · หน้าจอ/หน้าพิมพ์ (vitest + QA)

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
-- helper เฉพาะ 0170
-- ============================================================================
-- รายการงานผลิต (margin_pct 0.5 · แบบใหม่ = มี NRE) · p_price text เพื่อรองรับค่าแปลก · null = ไม่พิมพ์ทับ
create function pg_temp.pjn(p_prod jsonb, p_metal text, p_qty int, p_price text, p_newdesign boolean default true) returns jsonb
 language sql as $c$
  select jsonb_build_object('input',
    p_prod || jsonb_build_object('metal', p_metal, 'qty', p_qty, 'margin_pct', 0.5, 'is_new_design', p_newdesign)
           || case when p_metal = 'gold' then jsonb_build_object('purity', 0.965) else '{}'::jsonb end
           || case when p_price is not null then jsonb_build_object('unit_price_override_thb', pg_temp.num(p_price), 'price_override_reason', 'ทดสอบ NRE ตามราคา') else '{}'::jsonb end)
$c$;

-- ============================================================================
-- ชุดเทสต์ 0170 — fixture อยู่ใน subtransaction ที่ถอยกลับเสมอ (เรียกซ้ำได้สำหรับ mutant)
-- ตัวเลขทุน/NRE/ราคาคำนวณจาก oem_price_calc ตอนรัน (rates จริงของร้าน) — ไม่เขียนค่าจริงลงไฟล์
-- ============================================================================
create function pg_temp.suite70(p_shop uuid, p_prod jsonb, p_today date) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  v_metal text; v_qty int;
  v_c0 jsonb; v_c jsonb;
  v_ncost numeric; v_nf numeric; v_pf numeric; v_cost numeric; v_np numeric; v_m numeric; v_exp numeric;
  v_p text;
  v_bad1 text := ''; v_bad2 text := ''; v_bad3 text := ''; v_bad4 text := ''; v_bad5 text := ''; v_bad6 text := '';
  v_bad7 text := ''; v_bad8 text := ''; v_bad9 text := ''; v_bad0 text := '';
  v_skip text := '';
  v_r text; v_r2 text; v_q uuid; v_row record; v_row2 record;
  v_tnew numeric; v_tf numeric; v_jmin numeric; v_share numeric; v_mid numeric;
  v_nprice1 numeric; v_nprice2 numeric; v_sum numeric;
begin
  begin
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    update analytics.oem_setting set
      margin_target_pct = 0.30, margin_floor_pct = 0.20, margin_hard_floor_pct = 0.15, min_job_value_thb = 1
      where shop_id = p_shop;

    if p_prod is null then
      v_log := v_log || '[SKIP] ทั้งชุด: ไม่มี oem_quote_item งานผลิตจริงให้ใช้เป็น fixture' || E'\n';
      raise exception 'suite70 rollback marker' using errcode = 'P0170';
    end if;

    -- ========================================================================
    -- ต่อวัสดุ: เงิน / ทอง / ทองเหลือง
    -- ========================================================================
    foreach v_metal in array array['silver', 'gold', 'brass'] loop
      v_qty := case v_metal when 'brass' then 100 else 50 end;
      v_c0 := pg_temp.calc_or_null(p_shop, (pg_temp.pjn(p_prod, v_metal, v_qty, null))->'input');
      if v_c0 is null or not (v_c0->>'is_complete')::boolean then
        v_skip := v_skip || v_metal || '(ไม่ครบ) ';
        continue;
      end if;
      v_ncost := (v_c0->'breakdown'->'nre'->>'cost')::numeric;
      v_nf := (v_c0->'breakdown'->'nre'->>'price')::numeric;
      v_pf := (v_c0->'breakdown'->>'price_per_piece')::numeric;
      v_cost := (v_c0->'breakdown'->>'cost_piece')::numeric;
      if v_ncost is null or v_ncost <= 0 then
        v_skip := v_skip || v_metal || '(ไม่มี NRE) ';
        continue;
      end if;

      -- N1: ไม่มี override = สูตรเดิม (NRE = ทุน NRE / (1 - margin %)) · ไม่มี key production_override
      if v_nf <> round(v_ncost / (1 - 0.5), 2) or v_c0->'breakdown' ? 'production_override' then v_bad1 := v_bad1 || v_metal || ' '; end if;

      -- N2: override ระหว่างทุนกับราคาสูตร (ทองเป็น pass-through: margin คิดเฉพาะค่ากำเหน็จ จึงอ้างจากส่วนต่างราคาสูตร-ทุน ไม่ใช่ % ของทุนรวมเนื้อทอง)
      -- → NRE ลดตาม margin ใหม่ · >= ทุน NRE · < NRE สูตร · margin ที่ใช้ = margin ของราคาที่พิมพ์ · quote_total เป๊ะ
      v_p := round(ceil((v_cost + 0.4 * (v_pf - v_cost)) * 100) / 100, 2)::text;
      v_c := pg_temp.calc_or_null(p_shop, (pg_temp.pjn(p_prod, v_metal, v_qty, v_p))->'input');
      v_np := (v_c->'breakdown'->'nre'->>'price')::numeric;
      v_m := (v_c->'breakdown'->'production_override'->>'nre_margin_used')::numeric;
      v_exp := greatest(round(v_ncost / (1 - v_m), 2), ceil(v_ncost * 100) / 100);
      if coalesce(v_c is null or v_np <> v_exp or v_np < v_ncost or v_np >= v_nf
         or abs(v_m - (v_c->'floors'->'margin'->>'value')::numeric) > 0.00001
         or (v_c->'breakdown'->>'quote_total')::numeric <> round(v_np + round(v_qty * v_p::numeric, 2), 2)
         or (v_c->'breakdown'->'nre'->>'cost')::numeric <> v_ncost, true) then
        v_bad2 := v_bad2 || v_metal || ' ';
      end if;
      if v_np < v_ncost then v_bad9 := v_bad9 || v_metal || ' '; end if;

      -- N3: override สูงกว่าราคาสูตร → NRE ขึ้นตาม
      v_p := round(ceil(v_pf * 1.5 * 100) / 100, 2)::text;
      v_c := pg_temp.calc_or_null(p_shop, (pg_temp.pjn(p_prod, v_metal, v_qty, v_p))->'input');
      v_np := (v_c->'breakdown'->'nre'->>'price')::numeric;
      v_m := (v_c->'breakdown'->'production_override'->>'nre_margin_used')::numeric;
      v_exp := greatest(round(v_ncost / (1 - v_m), 2), ceil(v_ncost * 100) / 100);
      if coalesce(v_c is null or v_np <> v_exp or v_np <= v_nf
         or (v_c->'breakdown'->>'quote_total')::numeric <> round(v_np + round(v_qty * v_p::numeric, 2), 2), true) then
        v_bad3 := v_bad3 || v_metal || ' ';
      end if;
      if v_np < v_ncost then v_bad9 := v_bad9 || v_metal || ' '; end if;

      -- N4: override = ราคาสูตร (ปัด 2 ตำแหน่ง) → NRE ≈ NRE สูตร
      v_p := round(v_pf, 2)::text;
      v_c := pg_temp.calc_or_null(p_shop, (pg_temp.pjn(p_prod, v_metal, v_qty, v_p))->'input');
      v_np := (v_c->'breakdown'->'nre'->>'price')::numeric;
      if coalesce(v_c is null or abs(v_np - v_nf) > v_ncost * 0.03 + 0.01, true) then v_bad4 := v_bad4 || v_metal || ' '; end if;

      -- N5: override เท่าทุนต่อชิ้น + 0.01 (ใกล้ margin 0) → NRE ≈ ทุน NRE (ไม่บวก margin) · ไม่ต่ำกว่าทุน
      v_p := round(ceil((v_cost + 0.01) * 100) / 100, 2)::text;
      v_c := pg_temp.calc_or_null(p_shop, (pg_temp.pjn(p_prod, v_metal, v_qty, v_p))->'input');
      v_np := (v_c->'breakdown'->'nre'->>'price')::numeric;
      if coalesce(v_c is null or v_np < v_ncost or v_np > v_ncost * 1.05 + 0.01 or not (v_c->'floors'->'price_vs_cost'->>'pass')::boolean, true) then
        v_bad5 := v_bad5 || v_metal || ' ';
      end if;
      if v_np < v_ncost then v_bad9 := v_bad9 || v_metal || ' '; end if;

      -- N6: override ต่ำกว่าทุน (preview/draft) → NRE = ทุน NRE (ceil 2 ตำแหน่ง) · margin ที่ใช้ 0 · price_vs_cost=false · มี warning
      v_p := round(floor(v_cost * 0.9 * 100) / 100, 2)::text;
      v_c := pg_temp.calc_or_null(p_shop, (pg_temp.pjn(p_prod, v_metal, v_qty, v_p))->'input');
      v_np := (v_c->'breakdown'->'nre'->>'price')::numeric;
      if coalesce(v_c is null or v_np <> ceil(v_ncost * 100) / 100 or (v_c->'breakdown'->'production_override'->>'nre_margin_used')::numeric <> 0
         or (v_c->'floors'->'price_vs_cost'->>'pass')::boolean or jsonb_array_length(v_c->'warnings') < 1, true) then
        v_bad6 := v_bad6 || v_metal || ' ';
      end if;
      if v_np < v_ncost then v_bad9 := v_bad9 || v_metal || ' '; end if;

      -- N7: override สูงสุด (1,000,000) → margin ของราคา > 95% → clamp ที่ 0.95 + warning
      v_c := pg_temp.calc_or_null(p_shop, (pg_temp.pjn(p_prod, v_metal, v_qty, '1000000'))->'input');
      v_np := (v_c->'breakdown'->'nre'->>'price')::numeric;
      if coalesce(v_c is null or (v_c->'breakdown'->'production_override'->>'nre_margin_used')::numeric <> 0.95
         or v_np <> greatest(round(v_ncost / 0.05, 2), ceil(v_ncost * 100) / 100)
         or not exists (select 1 from jsonb_array_elements_text(v_c->'warnings') w where w like '%เพดาน%'), true) then
        v_bad7 := v_bad7 || v_metal || ' ';
      end if;

      -- N8: แบบเดิมของร้าน (ไม่มี NRE) + override → NRE 0 เหมือนเดิม · nre_margin_used = null · quote_total = ปัด(จำนวน x ราคา)
      v_p := round(ceil(v_pf * 1.2 * 100) / 100, 2)::text;
      v_c := pg_temp.calc_or_null(p_shop, (pg_temp.pjn(p_prod, v_metal, v_qty, v_p, false))->'input');
      if coalesce(v_c is null or (v_c->'breakdown'->'nre'->>'price')::numeric <> 0 or (v_c->'breakdown'->'nre'->>'cost')::numeric <> 0
         or (v_c->'breakdown'->'production_override'->'nre_margin_used') <> 'null'::jsonb
         or (v_c->'breakdown'->>'quote_total')::numeric <> round(v_qty * v_p::numeric, 2), true) then
        v_bad8 := v_bad8 || v_metal || ' ';
      end if;

      -- N0: ราคาที่พิมพ์ชนิดแปลก (ผ่านด่านรูปร่างของ 0169 ก่อน) — NaN / Infinity / 0 ยังถูกปฏิเสธ ไม่ถึงสูตร NRE
      foreach v_r in array array['NaN', 'Infinity', '0', '-5', '1000000.01'] loop
        if pg_temp.t_calc(p_shop, (pg_temp.pjn(p_prod, v_metal, v_qty, v_r))->'input') not like 'ERR:22023:%' then v_bad0 := v_bad0 || v_metal || '[' || v_r || '] '; end if;
      end loop;
    end loop;

    if v_skip <> '' then
      v_log := v_log || '[SKIP] บางวัสดุไม่มีข้อมูลพอ: ' || v_skip || E'\n';
    end if;
    v_log := v_log || pg_temp.chk('N1', 'ไม่มี override: NRE = ทุน NRE / (1 - margin %) เท่าเดิม · ไม่มี key production_override (เงิน/ทอง/ทองเหลือง) ' || v_bad1, v_bad1 = '');
    v_log := v_log || pg_temp.chk('N2', 'override ระหว่างทุนกับราคาสูตร: NRE ลดตาม margin ของราคาที่พิมพ์ · ไม่ต่ำกว่าทุน NRE · ต่ำกว่า NRE สูตร · nre_margin_used = margin ของราคา · quote_total = NRE + ปัด(จำนวน x ราคา) ' || v_bad2, v_bad2 = '');
    v_log := v_log || pg_temp.chk('N3', 'override สูงกว่าราคาสูตร: NRE ขึ้นตาม (> NRE สูตร) · quote_total เป๊ะ ' || v_bad3, v_bad3 = '');
    v_log := v_log || pg_temp.chk('N4', 'override = ราคาสูตร: NRE ≈ NRE สูตร (ต่างไม่เกินปัดเศษของราคา 2 ตำแหน่ง) ' || v_bad4, v_bad4 = '');
    v_log := v_log || pg_temp.chk('N5', 'override เท่าทุนต่อชิ้น + 0.01: NRE ≈ ทุน NRE ไม่ต่ำกว่าทุน · price_vs_cost ผ่าน ' || v_bad5, v_bad5 = '');
    v_log := v_log || pg_temp.chk('N6', 'override ต่ำกว่าทุน (preview): NRE = ทุน NRE (ไม่ต่ำกว่า) · nre_margin_used = 0 · price_vs_cost=false · มี warning ' || v_bad6, v_bad6 = '');
    v_log := v_log || pg_temp.chk('N7', 'override สูงสุด 1,000,000: margin > 95% → clamp ที่ 0.95 + warning "เพดาน" (กัน 1/(1-m) ระเบิด) ' || v_bad7, v_bad7 = '');
    v_log := v_log || pg_temp.chk('N8', 'แบบเดิมของร้าน (ไม่มี NRE) + override: NRE 0 เหมือนเดิม · nre_margin_used = null · quote_total = ปัด(จำนวน x ราคา) ' || v_bad8, v_bad8 = '');
    v_log := v_log || pg_temp.chk('N9', 'ห้ามผ่าน: NRE ต่ำกว่าทุน NRE ทุกกรณี (N2 N3 N5 N6) ' || v_bad9, v_bad9 = '');
    v_log := v_log || pg_temp.chk('N0', 'ต้องไม่พัง: ราคาที่พิมพ์ NaN / Infinity / 0 / ติดลบ / > 1,000,000 ยังถูกปฏิเสธ 22023 ก่อนถึงสูตร NRE ' || v_bad0, v_bad0 = '');

    -- ========================================================================
    -- save / renegotiate — ด่านที่ใช้ nre_price ใช้ค่าใหม่ถูกต้อง (ไม่เพิ่มด่าน)
    -- ========================================================================
    v_c0 := pg_temp.calc_or_null(p_shop, (pg_temp.pjn(p_prod, 'silver', 50, null))->'input');
    if v_c0 is null or not (v_c0->>'is_complete')::boolean or (v_c0->'breakdown'->'nre'->>'cost')::numeric <= 0 then
      v_log := v_log || '[SKIP] ส่วน save/renegotiate: งานผลิตเงิน 50 ชิ้นไม่ครบ/ไม่มี NRE' || E'\n';
      raise exception 'suite70 rollback marker' using errcode = 'P0170';
    end if;
    v_ncost := (v_c0->'breakdown'->'nre'->>'cost')::numeric;
    v_cost := (v_c0->'breakdown'->>'cost_piece')::numeric;
    v_pf := (v_c0->'breakdown'->>'price_per_piece')::numeric;
    v_tf := (v_c0->'breakdown'->>'quote_total')::numeric;
    v_p := round(ceil(v_cost / 0.82 * 100) / 100, 2)::text;
    v_tnew := (pg_temp.calc_or_null(p_shop, (pg_temp.pjn(p_prod, 'silver', 50, v_p))->'input')->'breakdown'->>'quote_total')::numeric;

    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjn(p_prod, 'silver', 50, v_p)), 'quoted', 'อนุมัติโดยเจ้าของ');
    v_q := pg_temp.qid(v_r);
    select * into v_row from analytics.oem_quote where id = v_q;
    select (i.calc->'breakdown'->'nre'->>'price')::numeric as np, (i.calc->'breakdown'->'nre'->>'cost')::numeric as nc into v_row2
      from analytics.oem_quote_item i where i.quote_id = v_q and i.seq = 1;
    v_log := v_log || pg_temp.chk('S1', 'save quoted (override ต่ำกว่าสูตร + note): header nre_price = NRE ใหม่ของรายการ · nre_cost = ทุน NRE เดิม · quote_total = NRE + pieces_subtotal = grand_total = ยอดที่คำนวณ',
      v_r like 'OK:%' and v_row.nre_price = v_row2.np and v_row.nre_cost = v_row2.nc and v_row.nre_cost = v_ncost
      and v_row.quote_total = v_row.nre_price + v_row.pieces_subtotal and v_row.grand_total = v_row.quote_total and v_row.quote_total = v_tnew);

    -- min_job_value ใช้ NRE ใหม่: ยอดงานผลิต (รวม NRE) ของ override ต่ำกว่า สร้างเกณฑ์ระหว่างสองยอด
    v_mid := ceil((v_tnew + v_tf) / 2);
    select nre_max_share_pct into v_share from analytics.oem_setting where shop_id = p_shop;
    v_jmin := greatest(v_mid, v_ncost / coalesce(v_share, 0.25));
    if v_tnew < v_jmin and v_jmin <= v_tf then
      update analytics.oem_setting set min_job_value_thb = v_mid where shop_id = p_shop;
      v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjn(p_prod, 'silver', 50, v_p)), 'quoted', 'อนุมัติโดยเจ้าของ');
      v_r2 := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjn(p_prod, 'silver', 50, null)), 'quoted', null);
      v_log := v_log || pg_temp.chk('S2', 'min_job_value ใช้ยอดที่รวม NRE ใหม่: เกณฑ์ระหว่างยอด override กับยอดสูตร → override ตก 22023 "มูลค่างานรวม" · สูตรเดิมผ่าน',
        v_r like 'ERR:22023:%มูลค่างานรวม%' and v_r2 like 'OK:%');
      update analytics.oem_setting set min_job_value_thb = 1 where shop_id = p_shop;
    else
      v_log := v_log || '[SKIP] S2: ยอด override/สูตรกับเกณฑ์ขั้นต่ำของร้านไม่เปิดช่องให้แยกกันได้' || E'\n';
    end if;

    -- ใบผสม: NRE รายการ override ลดตาม · รายการสูตรไม่ขยับ · header = ผลรวม
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjn(p_prod, 'silver', 50, v_p), pg_temp.pjn(p_prod, 'silver', 50, null)), 'quoted', 'อนุมัติโดยเจ้าของ');
    v_q := pg_temp.qid(v_r);
    select (i.calc->'breakdown'->'nre'->>'price')::numeric into v_nprice1 from analytics.oem_quote_item i where i.quote_id = v_q and i.seq = 1;
    select (i.calc->'breakdown'->'nre'->>'price')::numeric into v_nprice2 from analytics.oem_quote_item i where i.quote_id = v_q and i.seq = 2;
    select nre_price into v_sum from analytics.oem_quote where id = v_q;
    v_log := v_log || pg_temp.chk('M1', 'ใบผสม override + สูตร: NRE รายการแรกลดตามราคาที่พิมพ์ (< ทุน NRE x2) · รายการที่สองเท่าสูตรเดิม · header nre_price = ผลรวม',
      v_r like 'OK:%' and v_nprice1 < v_nprice2 and v_nprice1 >= v_ncost and v_nprice2 = round(v_ncost / 0.5, 2) and v_sum = v_nprice1 + v_nprice2);

    -- renegotiate: คัดลอก item + header ตรงๆ (NRE เท่าเดิม ไม่คิดใหม่)
    v_r := pg_temp.t_save(p_shop, jsonb_build_array(pg_temp.pjn(p_prod, 'silver', 50, v_p)), 'quoted', 'อนุมัติโดยเจ้าของ');
    v_q := pg_temp.qid(v_r);
    v_r2 := pg_temp.t_reneg(p_shop, v_q, 0, null);
    select * into v_row from analytics.oem_quote where id = v_q;
    select * into v_row2 from analytics.oem_quote where id = pg_temp.qid(v_r2);
    v_log := v_log || pg_temp.chk('R1', 'ต่อรอง (ส่วนลด 0) ใบที่มี override: ใบลูก nre_price / quote_total / nre_cost เท่าใบเดิมเป๊ะ · item copy ครบ',
      v_r2 like 'OK:%' and v_row2.nre_price = v_row.nre_price and v_row2.quote_total = v_row.quote_total and v_row2.nre_cost = v_row.nre_cost
      and (select count(*) from analytics.oem_quote_item where quote_id = v_row2.id) = 1);
    v_r2 := pg_temp.t_reneg(p_shop, v_q, 0, null);
    v_log := v_log || pg_temp.chk('R2', 'ต้องไม่พัง: ใบเดิม (superseded แล้ว) ต่อรองซ้ำไม่ได้ — ด่านสถานะเดิม', v_r2 like 'ERR:22023:%quoted หรือ won%');

    raise exception 'suite70 rollback marker' using errcode = 'P0170';
  exception
    when sqlstate 'P0170' then null;
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

do $v170$
declare
  v_log text := E'\n=== verify 0170 (NRE ตาม margin ของราคาที่พิมพ์ทับ) ===\n';
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
  v_calc text := 'analytics.oem_price_calc(uuid,jsonb)';
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select count(*) into v_cnt from public.shop;
  if v_cnt <> 1 then
    raise exception 'verify-0170 หยุด: public.shop มี % ร้าน (ไฟล์นี้ออกแบบสำหรับร้านเดียว)', v_cnt;
  end if;
  select id into v_shop from public.shop;
  select input into v_prod_input from analytics.oem_quote_item where input->>'metal' = 'silver' order by created_at limit 1;

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
    where p.pronamespace = 'analytics'::regnamespace and p.proname = 'oem_price_calc' and has_function_privilege('service_role', p.oid, 'execute');
  v_log := v_log || pg_temp.chk('Z4', 'service_role execute oem_price_calc ได้', v_cnt = 1);

  create temp table _v170_orig on commit drop as
    select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def, md5(pg_get_functiondef(p.oid)) as h
    from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'oem_price_calc';

  v_s := pg_temp.suite70(v_shop, v_prod_input, v_today);
  v_log := v_log || v_s;
  v_fail := (length(v_s) - length(replace(v_s, '[FAIL]', ''))) / 6;
  v_ok := (length(v_s) - length(replace(v_s, '[OK]', ''))) / 4;
  v_log := v_log || format(E'--- ชุดเทสต์หลัก: OK %s / FAIL %s\n', v_ok, v_fail);

  for v_m in
    select * from (values
      ('MN1', 'v_m_nre := 0;', 'v_m_nre := v_m_eff;', array['N6']),
      ('MN2', 'v_nre_price := greatest(round(v_nre_cost / (1 - v_m_nre), 2)', 'v_nre_price := greatest(round(v_nre_cost / (1 - v_m), 2)', array['N2', 'N3']),
      ('MN3', 'elsif v_m_eff > 0.95 then', 'elsif false then', array['N7']),
      ('MN4', '''nre_margin_used'', v_m_nre)', '''nre_margin_used'', null)', array['N2', 'N3', 'N6', 'N7']),
      ('MN5', E'if v_nre_cost > 0 then\n      if v_m_eff is null', E'if v_nre_cost > 1000000000000 then\n      if v_m_eff is null', array['N2', 'N3']),
      ('MN6', E'v_m_eff <= 0 then\n        v_m_nre := 0;', E'v_m_eff < -1000 then\n        v_m_nre := 0;', array['N6']),
      ('MN7', E'elsif v_m_eff > 0.95 then\n        v_m_nre := 0.95;', E'elsif v_m_eff > 0.5 then\n        v_m_nre := 0.5;', array['N3', 'N7']),
      ('MN8', 'v_m_eff = ''NaN''::numeric or v_m_eff <= 0', 'v_m_eff = ''NaN''::numeric or false', array['N6'])
    ) as t(id, f, t, ids)
  loop
    v_total := v_total + 1;
    perform pg_temp.mutate(v_calc, v_m.f, v_m.t);
    v_s := pg_temp.suite70(v_shop, v_prod_input, v_today);
    for v_orig in select def from _v170_orig where sig = to_regprocedure(v_calc)::text loop
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

  select count(*) into v_cnt from _v170_orig o where md5(pg_get_functiondef(to_regprocedure(o.sig))) = o.h;
  v_log := v_log || pg_temp.chk('MY', 'หลังคืนของเดิม: md5 definition ของ oem_price_calc เท่าเดิม', v_cnt = 1);
  v_s := pg_temp.suite70(v_shop, v_prod_input, v_today);
  v_fail := (length(v_s) - length(replace(v_s, '[FAIL]', ''))) / 6;
  v_log := v_log || pg_temp.chk('MZ', 'หลังคืนของเดิม: ชุดเทสต์หลักรันซ้ำ FAIL ' || v_fail, v_fail = 0);

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_log := v_log || format(E'\n=== สรุป: [FAIL] ทั้งไฟล์ = %s %s ===\n', v_fail, case when v_fail = 0 then '(ผ่าน)' else '(ไม่ผ่าน)' end);
  raise exception '%', v_log;
end $v170$;
