-- scripts/verify-0140.sql
--
-- ชุดทดสอบของ supabase/migrations/0140_oem_cost_calc_extract.sql (แยกชั้น
-- "ต้นทุน" analytics.oem_cost_calc ออกจากชั้น "ราคาขาย" ของ
-- analytics.oem_price_calc)
--
-- ⚠️ ต่างจาก verify script อื่นในรีโป (เช่น verify-0139.sql) ตรงที่ไฟล์นี้
-- เป็น POST-APPLY ONLY — ไม่มี Part 0 ที่ลอก DDL มา apply ซ้ำเพื่อ dry-run
-- ก่อน apply จริง เหตุผล: ด่านความปลอดภัยหลักของ 0140 (golden replay เทียบ
-- oem_price_calc ใหม่ vs oem_price_calc_legacy ทุกแถวจริง + 24 เคสสังเคราะห์
-- แล้ว raise exception ให้ทั้ง migration rollback ถ้าไม่เท่า) อยู่ *ใน*
-- ไฟล์ 0140 เองแล้ว สมบูรณ์ในตัว — การก็อปมาซ้ำในไฟล์นี้จะเสี่ยง "สอง
-- ไฟล์ไม่ตรงกัน" (drift) มากกว่าจะได้ความปลอดภัยเพิ่ม ไฟล์นี้จึงมีหน้าที่เดียว
-- คือ **ตรวจ state หลัง apply จริงว่าตรงกับที่ตั้งใจ** (ไม่เชื่อว่า golden
-- replay ใน 0140 ที่ผ่านแล้วคือหลักฐานพอ — ตาม skill 3j-migration-traps ข้อ
-- 12: "dry-run/ตรวจซ้ำเสมอ อย่าเชื่อว่า review ตาเปล่า/รอบก่อนหน้าครบแล้ว")
--
-- ไฟล์นี้ **ไม่มีการเขียนข้อมูลเลยสักคำสั่ง** (oem_cost_calc/oem_price_calc
-- เป็น `stable`, อ่านอย่างเดียว) จึงไม่ต้องมี do-block+raise เพื่อบังคับ
-- rollback แบบ skill ข้อ 11 (ไม่มี state ให้ต้องถอย) — ยังคงห่อด้วย do-block
-- เดียวแล้ว raise exception ตอนจบเพื่อความสม่ำเสมอกับ verify script อื่นใน
-- ทีม (ผลลัพธ์ทั้งหมดออกทาง error message เดียว อ่านง่าย ไม่มีทางพลาด) —
-- ปลอดภัยที่จะรันซ้ำได้ทุกเมื่อหลัง apply (idempotent โดยธรรมชาติ)
--
-- สมมติฐาน: 0140 apply สำเร็จแล้วจริงบน DB เป้าหมาย (ผ่าน golden replay
-- ของตัวมันเองแล้ว) — ถ้ายังไม่ apply ไฟล์นี้จะ fail ตั้งแต่ Part 1
-- (โครงสร้างยังไม่ตรง)
--
-- โครงสร้างไฟล์:
--   Part 1 — โครงสร้าง: มี oem_cost_calc/oem_price_calc อย่างละ 1 ตัวเป๊ะ
--            (ไม่มี overload) + oem_price_calc_legacy ถูก drop ไปแล้วจริง
--   Part 2 — grant: oem_cost_calc = service_role เท่านั้น · oem_price_calc
--            = authenticated + service_role (เท่าเดิมจาก 0083) · ทั้งคู่
--            ไม่มี anon
--   Part 3 — silver999 (เงินแท่ง) ไม่ถูกแตะ: oem_price_calc(bar input) ยังได้
--            รูปทรงเดิม (breakdown.bar.*, formula_version=4) · oem_cost_calc
--            ปฏิเสธ metal=silver999 เสมอ (ไม่ใช่ของชั้นนี้)
--   Part 4 — smoke test งานผลิต (silver/gold/brass): _raw ไม่หลุดออกจาก
--            oem_price_calc, missing[]/is_complete รูปทรงถูกต้อง,
--            formula_version=3
--   Part 5 — metal_price_thb_per_gram override: price_source='caller' +
--            ข้าม lookup จริง + NaN/0/silver999 ต้อง raise
--   Part 6 — object ข้างเคียงที่ห้ามแตะยังอยู่ครบ: oem_quote_save,
--            oem_quote_renegotiate, oem_receipt_issue/void,
--            oem_quote_set_billing, ตาราง oem_rate_def/oem_cost_rate/
--            oem_setting

do $$
declare
  v_log text := E'\n=== verify 0140 (oem_cost_calc extract, post-apply) ===\n';
  v_fail_count int := 0;

  v_count int;
  v_synth_shop uuid := gen_random_uuid();
  v_item_kind_val text;
  v_polish_tier_val text;
  v_bar_input jsonb;
  v_bar_result jsonb;
  v_prod_input jsonb;
  v_prod_result jsonb;
  v_override_input jsonb;
  v_override_result jsonb;
  v_should_have_raised boolean;
begin
  -- ========================================================================
  -- Part 1 — โครงสร้าง
  -- ========================================================================
  select count(*) into v_count from pg_proc
    where pronamespace = 'analytics'::regnamespace and proname = 'oem_price_calc';
  if v_count = 1 then
    v_log := v_log || 'P1a OK: analytics.oem_price_calc มี 1 ตัวเป๊ะ (ไม่มี overload)' || E'\n';
  else
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format('P1a FAIL: พบ analytics.oem_price_calc %s ตัว (คาดหวัง 1)', v_count) || E'\n';
  end if;

  select count(*) into v_count from pg_proc
    where pronamespace = 'analytics'::regnamespace and proname = 'oem_cost_calc';
  if v_count = 1 then
    v_log := v_log || 'P1b OK: analytics.oem_cost_calc มี 1 ตัวเป๊ะ (ไม่มี overload)' || E'\n';
  else
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format('P1b FAIL: พบ analytics.oem_cost_calc %s ตัว (คาดหวัง 1)', v_count) || E'\n';
  end if;

  select count(*) into v_count from pg_proc
    where pronamespace = 'analytics'::regnamespace and proname = 'oem_price_calc_legacy';
  if v_count = 0 then
    v_log := v_log || 'P1c OK: oem_price_calc_legacy ถูก drop ไปแล้ว (golden replay ของ 0140 ผ่านและ commit สำเร็จ)' || E'\n';
  else
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format('P1c FAIL: oem_price_calc_legacy ยังค้างอยู่ %s ตัว — แปลว่า 0140 ยัง apply ไม่สำเร็จ/ไม่สมบูรณ์', v_count) || E'\n';
  end if;

  -- ========================================================================
  -- Part 2 — grant
  -- ========================================================================
  if has_function_privilege('anon', 'analytics.oem_cost_calc(uuid,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'analytics.oem_cost_calc(uuid,jsonb)', 'execute') then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || 'P2a FAIL: oem_cost_calc execute หลุดถึง anon/authenticated' || E'\n';
  else
    v_log := v_log || 'P2a OK: oem_cost_calc ไม่เปิดให้ anon/authenticated' || E'\n';
  end if;

  if has_function_privilege('service_role', 'analytics.oem_cost_calc(uuid,jsonb)', 'execute') then
    v_log := v_log || 'P2b OK: oem_cost_calc เปิดให้ service_role' || E'\n';
  else
    v_fail_count := v_fail_count + 1;
    v_log := v_log || 'P2b FAIL: oem_cost_calc ไม่มี grant ให้ service_role เลย — ใช้งานไม่ได้แม้แต่จาก server' || E'\n';
  end if;

  if has_function_privilege('anon', 'analytics.oem_price_calc(uuid,jsonb)', 'execute') then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || 'P2c FAIL: oem_price_calc execute หลุดถึง anon' || E'\n';
  else
    v_log := v_log || 'P2c OK: oem_price_calc ไม่เปิดให้ anon' || E'\n';
  end if;

  if has_function_privilege('authenticated', 'analytics.oem_price_calc(uuid,jsonb)', 'execute')
     and has_function_privilege('service_role', 'analytics.oem_price_calc(uuid,jsonb)', 'execute') then
    v_log := v_log || 'P2d OK: oem_price_calc เปิดให้ authenticated + service_role (เท่าเดิมจาก 0083)' || E'\n';
  else
    v_fail_count := v_fail_count + 1;
    v_log := v_log || 'P2d FAIL: oem_price_calc grant ไม่ครบ authenticated/service_role (trap #2 — grant หายหลัง replace)' || E'\n';
  end if;

  -- ========================================================================
  -- Part 3 — silver999 (เงินแท่ง) ไม่ถูกแตะ
  -- ========================================================================
  v_bar_input := jsonb_build_object('metal', 'silver999', 'bar_size', '1_baht', 'qty', 1);
  begin
    v_bar_result := analytics.oem_price_calc(v_synth_shop, v_bar_input);
    if v_bar_result ? 'breakdown'
       and (v_bar_result -> 'breakdown') ? 'bar'
       and (v_bar_result ->> 'formula_version') = '4' then
      v_log := v_log || 'P3a OK: oem_price_calc(metal=silver999) ยังคืนรูปทรงเดิม (breakdown.bar, formula_version=4)' || E'\n';
    else
      v_fail_count := v_fail_count + 1;
      v_log := v_log || format('P3a FAIL: oem_price_calc(metal=silver999) รูปทรงเปลี่ยน — result=%s', v_bar_result) || E'\n';
    end if;
  exception when others then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format('P3a FAIL: oem_price_calc(metal=silver999) raise ไม่ควร raise — %s', sqlerrm) || E'\n';
  end;

  v_should_have_raised := true;
  begin
    perform analytics.oem_cost_calc(v_synth_shop, v_bar_input);
    v_should_have_raised := false;
  exception when others then
    if sqlerrm like '%silver999%' then
      v_log := v_log || 'P3b OK: oem_cost_calc(metal=silver999) ปฏิเสธถูกต้อง (ไม่ใช่ของชั้นนี้)' || E'\n';
    else
      v_fail_count := v_fail_count + 1;
      v_log := v_log || format('P3b FAIL: oem_cost_calc(metal=silver999) raise ข้อความผิดที่คาด — %s', sqlerrm) || E'\n';
    end if;
  end;
  if not v_should_have_raised then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || 'P3b FAIL: oem_cost_calc(metal=silver999) ควร raise แต่ไม่ raise' || E'\n';
  end if;

  -- ========================================================================
  -- Part 4 — smoke test งานผลิต (silver/gold/brass) — shop สุ่มใหม่ ไม่มี
  -- rate ให้อ่าน ก็ยังต้องได้รูปทรง jsonb ที่ถูกต้อง (is_complete=false,
  -- missing[] ไม่ว่าง, ไม่มี _raw หลุด)
  -- ========================================================================
  v_item_kind_val := 'แหวน';
  v_polish_tier_val := 'เรียบ';
  v_prod_input := jsonb_build_object(
    'metal', 'silver', 'item_kind', v_item_kind_val, 'polish_tier', v_polish_tier_val,
    'qty', 5, 'weight_g', 3.5, 'is_new_design', false, 'purity', null,
    'plating_type', null, 'gem_tier', null, 'gem_count', 0,
    'as_of_date', null, 'margin_pct', null
  );
  begin
    v_prod_result := analytics.oem_price_calc(v_synth_shop, v_prod_input);
    if v_prod_result ? '_raw' then
      v_fail_count := v_fail_count + 1;
      v_log := v_log || 'P4a FAIL: _raw หลุดออกไปใน output ของ oem_price_calc (ห้ามเด็ดขาด)' || E'\n';
    else
      v_log := v_log || 'P4a OK: ไม่มี _raw หลุดใน oem_price_calc output' || E'\n';
    end if;

    if v_prod_result ? 'is_complete' and v_prod_result ? 'missing'
       and jsonb_typeof(v_prod_result -> 'missing') = 'array'
       and (v_prod_result ->> 'formula_version') = '3' then
      v_log := v_log || 'P4b OK: รูปทรง is_complete/missing[]/formula_version=3 ถูกต้อง' || E'\n';
    else
      v_fail_count := v_fail_count + 1;
      v_log := v_log || format('P4b FAIL: รูปทรง output ผิดที่คาด — result=%s', v_prod_result) || E'\n';
    end if;

    if jsonb_array_length(v_prod_result -> 'missing') > 0 then
      v_log := v_log || 'P4c OK: shop สุ่มใหม่ไม่มี rate เลย -> missing[] ไม่ว่างตามคาด (พิสูจน์ว่า control-flow ไหลถึง oem_cost_calc จริง)' || E'\n';
    else
      v_fail_count := v_fail_count + 1;
      v_log := v_log || 'P4c FAIL: shop สุ่มใหม่ไม่ควรมี rate เลย แต่ missing[] ว่าง — เป็นไปไม่ได้เว้นแต่ logic เปลี่ยน' || E'\n';
    end if;
  exception when others then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format('P4 FAIL: oem_price_calc(silver, production) raise ไม่ควร raise สำหรับ input ที่ถูกต้อง — %s', sqlerrm) || E'\n';
  end;

  -- ตรง oem_cost_calc เองก็ต้องไม่มี _raw หลุดเป็นคีย์ระดับบนซ้อนอีกชั้น (คีย์
  -- _raw ของ oem_cost_calc เองมีได้ — นี่คือ contract ของมัน แต่ oem_price_calc
  -- ต้องไม่ copy มันออกไปตรงๆ ซึ่งเช็คแล้วใน P4a)
  begin
    v_prod_result := analytics.oem_cost_calc(v_synth_shop, v_prod_input);
    if v_prod_result ? '_raw' and v_prod_result ? 'missing' and v_prod_result ? 'price_source' then
      v_log := v_log || 'P4d OK: oem_cost_calc เองคืน _raw/missing/price_source ตาม contract' || E'\n';
    else
      v_fail_count := v_fail_count + 1;
      v_log := v_log || format('P4d FAIL: oem_cost_calc output ไม่ตรง contract — result=%s', v_prod_result) || E'\n';
    end if;
  exception when others then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format('P4d FAIL: oem_cost_calc(silver, production) raise ไม่ควร raise — %s', sqlerrm) || E'\n';
  end;

  -- ========================================================================
  -- Part 5 — metal_price_thb_per_gram override
  -- ========================================================================
  v_override_input := v_prod_input || jsonb_build_object('metal_price_thb_per_gram', 88.8);
  begin
    v_override_result := analytics.oem_cost_calc(v_synth_shop, v_override_input);
    if (v_override_result -> '_raw' ->> 'price_used')::numeric = 88.8
       and v_override_result ->> 'price_source' = 'caller'
       and not exists (select 1 from jsonb_array_elements(v_override_result -> 'missing') e where e ->> 'rate_key' = 'metal_price') then
      v_log := v_log || 'P5a OK: metal_price_thb_per_gram override ใช้ค่าตรง + price_source=caller + ข้าม lookup' || E'\n';
    else
      v_fail_count := v_fail_count + 1;
      v_log := v_log || format('P5a FAIL: override ไม่ทำงานตามคาด — result=%s', v_override_result) || E'\n';
    end if;
  exception when others then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format('P5a FAIL: override input ที่ถูกต้อง raise ไม่ควร raise — %s', sqlerrm) || E'\n';
  end;

  v_should_have_raised := true;
  begin
    perform analytics.oem_cost_calc(v_synth_shop, v_prod_input || jsonb_build_object('metal_price_thb_per_gram', 'NaN'));
    v_should_have_raised := false;
  exception when others then
    if sqlerrm like '%metal_price_thb_per_gram%' then
      v_log := v_log || 'P5b OK: metal_price_thb_per_gram=NaN ถูกปฏิเสธ (not(between) จับ NaN ตาม skill ข้อ 4)' || E'\n';
    else
      v_fail_count := v_fail_count + 1;
      v_log := v_log || format('P5b FAIL: NaN override raise ข้อความผิดที่คาด — %s', sqlerrm) || E'\n';
    end if;
  end;
  if not v_should_have_raised then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || 'P5b FAIL: metal_price_thb_per_gram=NaN ควร raise แต่ไม่ raise' || E'\n';
  end if;

  v_should_have_raised := true;
  begin
    perform analytics.oem_cost_calc(v_synth_shop, v_prod_input || jsonb_build_object('metal_price_thb_per_gram', -5));
    v_should_have_raised := false;
  exception when others then
    if sqlerrm like '%metal_price_thb_per_gram%' then
      v_log := v_log || 'P5c OK: metal_price_thb_per_gram ติดลบถูกปฏิเสธ' || E'\n';
    else
      v_fail_count := v_fail_count + 1;
      v_log := v_log || format('P5c FAIL: ค่าติดลบ raise ข้อความผิดที่คาด — %s', sqlerrm) || E'\n';
    end if;
  end;
  if not v_should_have_raised then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || 'P5c FAIL: metal_price_thb_per_gram ติดลบ ควร raise แต่ไม่ raise' || E'\n';
  end if;

  -- ไม่ส่งคีย์นี้เลย = พฤติกรรมเดิม (lookup ตามปกติ, ไม่ raise, price_source
  -- ต้องไม่ใช่ 'caller')
  begin
    v_override_result := analytics.oem_cost_calc(v_synth_shop, v_prod_input);
    if v_override_result ->> 'price_source' is distinct from 'caller' then
      v_log := v_log || 'P5d OK: ไม่ส่ง metal_price_thb_per_gram -> price_source ไม่ใช่ caller (lookup ปกติ)' || E'\n';
    else
      v_fail_count := v_fail_count + 1;
      v_log := v_log || 'P5d FAIL: ไม่ส่ง override แต่ price_source กลับเป็น caller' || E'\n';
    end if;
  exception when others then
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format('P5d FAIL: input ปกติ (ไม่มี override) ไม่ควร raise — %s', sqlerrm) || E'\n';
  end;

  -- ========================================================================
  -- Part 6 — object ข้างเคียงที่ห้ามแตะยังอยู่ครบ
  -- ========================================================================
  if to_regprocedure('analytics.oem_quote_save(uuid, jsonb, uuid, text, text, text, text, numeric, text)') is not null then
    v_log := v_log || 'P6a OK: analytics.oem_quote_save ยังอยู่ signature เดิม' || E'\n';
  else
    v_fail_count := v_fail_count + 1;
    v_log := v_log || 'P6a FAIL: analytics.oem_quote_save signature เดิมหายไป' || E'\n';
  end if;

  if to_regprocedure('analytics.oem_quote_renegotiate(uuid, uuid, numeric, text)') is not null then
    v_log := v_log || 'P6b OK: analytics.oem_quote_renegotiate ยังอยู่ signature เดิม' || E'\n';
  else
    v_fail_count := v_fail_count + 1;
    v_log := v_log || 'P6b FAIL: analytics.oem_quote_renegotiate signature เดิมหายไป' || E'\n';
  end if;

  select count(*) into v_count from pg_proc
    where pronamespace = 'analytics'::regnamespace and proname in ('oem_receipt_issue', 'oem_receipt_void', 'oem_quote_set_billing');
  if v_count >= 3 then
    v_log := v_log || 'P6c OK: oem_receipt_issue / oem_receipt_void / oem_quote_set_billing ยังอยู่ครบ' || E'\n';
  else
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format('P6c FAIL: พบฟังก์ชันกลุ่ม receipt/billing แค่ %s ตัว (คาดหวังอย่างน้อย 3)', v_count) || E'\n';
  end if;

  select count(*) into v_count from information_schema.tables
    where table_schema = 'analytics' and table_name in ('oem_rate_def', 'oem_cost_rate', 'oem_setting');
  if v_count = 3 then
    v_log := v_log || 'P6d OK: ตาราง oem_rate_def / oem_cost_rate / oem_setting ยังอยู่ครบ (ไม่ถูกแตะ)' || E'\n';
  else
    v_fail_count := v_fail_count + 1;
    v_log := v_log || format('P6d FAIL: พบตารางกลุ่ม rate/setting แค่ %s ตัว (คาดหวัง 3)', v_count) || E'\n';
  end if;

  -- ========================================================================
  -- สรุปผล
  -- ========================================================================
  v_log := v_log || E'\n=== สรุป: ' || case when v_fail_count = 0 then 'PASS ทั้งหมด' else format('มี %s เคส FAIL', v_fail_count) end || E' ===\n';
  raise exception '%', v_log;
end $$;
