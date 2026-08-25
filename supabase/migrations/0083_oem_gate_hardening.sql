-- 0083_oem_gate_hardening.sql
-- security review รอบสุดท้ายก่อนปล่อย OEM quote v2 เจอ 3 ช่องที่ยังปิดไม่สนิท
-- ทุกจุดยืนยันแล้วว่าเป็นของจริง ไม่ใช่ทฤษฎี — ไฟล์นี้ปิดทั้ง 3 โดยไม่แตะ
-- signature ของฟังก์ชันไหนเลยสักตัว (plain replace ทั้งหมด)
--
-- ============ 1. ขายต่ำกว่าต้นทุนตัวเองยังออกใบได้ ถ้าพิมพ์เหตุผลอะไรก็ได้ ====
-- หลัง 0079 เปลี่ยนต้นทุนเงินแท่งมาเป็นราคารับซื้อคืนจริง ด่าน hard floor
-- "รวมทั้งใบ" ทำงานเฉพาะเมื่อ p_discount_thb > 0 (ตั้งใจ — กันไม่ให้บล็อกแท่ง
-- 1 กก. ที่ margin จริง 8.4% < hard floor 15% ทั้งที่ไม่ได้ลดราคาสักบาท) เหลือ
-- ด่าน note-tier เป็นด่านเดียวที่ยังทำงานตอนไม่มีส่วนลด — แต่ด่านนั้นปลดล็อก
-- ได้ด้วยการใส่ approval_note ที่ไม่ว่าง (พิมพ์ "ok" ก็ผ่าน) ผลคือถ้าฟีดราคา
-- เพี้ยน (สลับคอลัมน์ / ตลาดพลิกข้ามคืน) จนราคาขาย "ต่ำกว่า" ราคารับซื้อคืน
-- ระบบยอมออกใบขายขาดทุนจริงได้ ขอแค่มีข้อความในช่อง note
--
-- แก้ 2 ชั้น:
--   (a) เติมด่านใหม่ที่ "ไม่ผูกกับส่วนลด ไม่ปลดล็อกด้วยเหตุผล" ใน
--       oem_quote_save (เช็ค v_margin_actual_blended — margin ที่คำนวณจาก
--       ราคา/ต้นทุนจริงต่อชิ้น "ก่อน" หักส่วนลดเลย) และ oem_quote_renegotiate
--       (เช็ค v_old.margin_actual_pct — renegotiate ไม่รีคำนวณราคาต่อชิ้นใหม่
--       เลย มีแต่เปลี่ยนส่วนลด item set เดิมถูกคัดลอกมาตรงๆ ค่าที่บันทึกไว้ตอน
--       save/renegotiate ครั้งก่อนจึงเป็นค่าเทียบเท่ากันเป๊ะ ไม่ต้องคำนวณซ้ำ)
--       ติดลบ = ปฏิเสธเสมอ ไม่มีทางลัดทั้งคู่ — ยืนยันแล้วว่าไม่กระทบใบแท่ง
--       1 กก. (margin จริง 8.4% เป็นบวก) และไม่กระทบงานผลิตปกติ (v_m ถูกบังคับ
--       ให้อยู่ใน [0,1) ที่ oem_price_calc มาแล้ว margin_actual ของรายการที่
--       คำนวณสำเร็จจึง >= 0 เสมอ ไม่มีทางติดลบเว้นแต่ฟีดราคาเพี้ยนจริง)
--   (b) constraint ต้นทาง silver_price_daily — กันฟีดเพี้ยนตั้งแต่เขียนเข้า
--       DB เลย (kilo_sell_vat >= kilo_buy) ไม่ต้องรอให้ไหลไปถึง oem_price_calc
--       ก่อน raise notice รายแถวถ้ามีข้อมูลเก่าละเมิดอยู่จริง (ไม่ auto-fix
--       ให้เหมือน 0079 §1 clamp bar_margin_pct — เพราะนี่คือราคาที่กรอกจริง
--       ไม่ใช่ตัวเลขคุมเงินที่มี fallback ปลอดภัยให้ถอยกลับ ต้องให้คนตรวจเอง)
--
-- ============ 2. NaN หลุดผ่าน validation ของ oem_price_calc (ฟิลด์ที่ 0079
--    ปิดไม่ครบ) ============
-- 0079 ปิด NaN ให้ engrave_image_thb/engrave_text_thb ด้วย not(x >= 0 and
-- x <= เพดาน) แล้ว (Postgres ถือว่า NaN มากกว่าทุกค่ารวม infinity เช็คแบบ
-- "<= 0"/"< 0" เดี่ยวๆ จึงไหลผ่านไปเงียบๆ — not(between) จับ NaN/Infinity ให้
-- ฟรีเพราะเทียบกับ NaN คืน false เสมอ) แต่ฟิลด์พี่น้องในฟังก์ชันเดียวกันยังใช้
-- แพทเทิร์นเดิม — ไล่ทั้งฟังก์ชันรอบนี้เจอ 3 ตัวที่มีช่อง (qty เป็น int ไม่ใช่
-- numeric ปลอดภัยอยู่แล้วเพราะ 'NaN'::int cast พังตั้งแต่ต้นทาง ไม่ใช่ช่องโหว่ ·
-- margin_pct เช็ค "v_m >= 1" อยู่แล้วซึ่งบังเอิญจับ NaN ได้ฟรี เพราะ NaN >= 1
-- เป็น true — ไม่แก้เพราะไม่มีช่อง):
--   - weight_g: เดิม "<= 0" เดี่ยวๆ ไม่มีเพดานบน → เปลี่ยนเป็น range check
--   - gem_count: เดิมไม่มี range check เลย มีแค่ "> 0 and gem_tier is null"
--     (ไม่ใช่การ validate ขนาดค่า แค่บังคับต้องมี tier ถ้าค่า > 0) → เติม
--     range check ก่อนใช้ค่านี้ต่อ
--   - purity: เดิมไม่มี range check เลยสำหรับค่าที่ client ส่งมาตรงๆ (มีแค่
--     "is null → error" สำหรับทองเท่านั้น) → เติม range check ให้ทุกโลหะ
--
-- ============ 3. ต่อราคาสืบทอด vat_mode='breakdown' ข้ามด่านจดทะเบียน VAT ====
-- oem_quote_renegotiate insert vat_mode = v_old.vat_mode ตรงๆ ไม่ผ่านด่าน
-- seller_vat_registered (ด่านนั้นอยู่ใน oem_quote_set_vat_mode เท่านั้น — ดู
-- 0082 §4) ถ้าร้านยกเลิกสถานะจด VAT หลังออกใบแม่เป็น breakdown ไว้แล้ว มีคน
-- มาต่อราคาใบนั้น ใบลูกจะเกิดใหม่เป็น breakdown ทั้งที่ seller_vat_registered
-- เป็น false อยู่ในขณะนั้น — แก้ด้วยการ clamp ตอน insert: ถ้า
-- seller_vat_registered เป็น false (หรือไม่มีแถว oem_setting เลย) บังคับ
-- vat_mode ของใบใหม่เป็น 'included' เสมอ ไม่ว่าใบแม่จะเป็นอะไร
--
-- อ่านคู่กับ 0079 (oem_price_calc/oem_quote_save ฐาน + engrave NaN guard
-- ต้นแบบ, seller_vat_registered), 0072/0074 (silver_price_daily), 0081
-- (oem_quote_save ฉบับล่าสุดก่อนไฟล์นี้), 0082 (oem_quote_renegotiate ฉบับ
-- ล่าสุดก่อนไฟล์นี้ + oem_quote_set_vat_mode ต้นแบบด่าน seller_vat_registered)
-- ============================================================================

-- ============================================================================
-- 0. silver_price_daily — constraint ต้นทาง (§1b): ราคาขาย 1 กก. ต้องไม่ต่ำกว่า
--    ราคารับซื้อคืน 1 กก. — raise notice รายแถวก่อนตั้ง constraint จริง (ตาม
--    แบบ 0079 §1) กันไม่ให้ migration ตายเงียบถ้ามีข้อมูลเก่าละเมิดอยู่จริง
-- ============================================================================

do $$
declare
  v_row record;
  v_bad_count int := 0;
begin
  for v_row in
    select shop_id, as_of_date, kilo_sell_vat, kilo_buy
    from analytics.silver_price_daily
    where kilo_sell_vat is not null and kilo_buy is not null and kilo_sell_vat < kilo_buy
  loop
    v_bad_count := v_bad_count + 1;
    raise notice '0083: silver_price_daily shop_id=% as_of_date=% ละเมิด (kilo_sell_vat % < kilo_buy %) — ราคาขาย 1 กก. ต่ำกว่าราคารับซื้อคืน 1 กก. ตรวจว่าสลับคอลัมน์หรือฟีดเพี้ยนจริงก่อน',
      v_row.shop_id, v_row.as_of_date, v_row.kilo_sell_vat, v_row.kilo_buy;
  end loop;

  if v_bad_count > 0 then
    raise notice '0083: พบ % แถวละเมิด silver_price_bar_above_buyback — ALTER TABLE ถัดไปจะ error จนกว่าจะแก้ราคาที่ผิดออกก่อน (ไม่ auto-fix ให้ เพราะเป็นราคาที่กรอกจริง ไม่ใช่ตัวเลขคุมเงินที่มี fallback ปลอดภัย)', v_bad_count;
  else
    raise notice '0083: ตรวจ silver_price_daily ทุกแถวแล้ว ไม่มีแถวละเมิด kilo_sell_vat >= kilo_buy';
  end if;
end $$;

alter table analytics.silver_price_daily drop constraint if exists silver_price_bar_above_buyback;
alter table analytics.silver_price_daily add constraint silver_price_bar_above_buyback
  check (kilo_sell_vat is null or kilo_buy is null or kilo_sell_vat >= kilo_buy);

comment on constraint silver_price_bar_above_buyback on analytics.silver_price_daily is
  '0083: ราคาขาย 1 กก. (kilo_sell_vat) ต้องไม่ต่ำกว่าราคารับซื้อคืน 1 กก. (kilo_buy) — กันฟีดเพี้ยน (สลับคอลัมน์/ตลาดพลิกข้ามคืน) ตั้งแต่เขียนเข้า DB ก่อนที่ oem_price_calc จะเอาไปคำนวณต้นทุนแท่งต่อ (ดู oem_quote_save/renegotiate §0083 สำหรับด่านชั้นสองที่จับ margin ติดลบระดับใบด้วย) หมายเหตุ: ครอบคลุมเฉพาะขนาด 1 กก. เท่านั้น ขนาดต่อบาท (0.5/1/3/5/10 บาท) ไม่มี constraint ระดับแถวแบบนี้เพราะ buy_per_baht เป็นเรตต่อหน่วยที่ต้องคูณด้วยขนาดก่อนเทียบ ไม่ใช่คอลัมน์ absolute — ด่าน margin ติดลบระดับใบใน oem_quote_save/renegotiate ยังคุ้มครองขนาดเหล่านี้อยู่ (คิดจากต้นทุนที่คำนวณจริง ไม่ใช่จากคอลัมน์ตรงๆ)';

-- ============================================================================
-- 1. oem_price_calc — signature เดิมเป๊ะ (uuid, jsonb) = plain replace · เติม
--    range check กัน NaN/Infinity ให้ weight_g/gem_count/purity (§2) เท่านั้น
--    ทุกอย่างอื่น (branch silver999 ทั้งก้อน, branch งานผลิตที่เหลือ, engrave
--    guard ของ 0079) คงเดิมเป๊ะ ไม่แตะ
-- ============================================================================

create or replace function analytics.oem_price_calc(p_shop_id uuid, p_input jsonb)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_metal         text;
  v_item_kind     text;
  v_polish_tier   text;
  v_plating_type  text;
  v_gem_tier      text;
  v_gem_count     numeric;
  v_qty           int;
  v_weight_g      numeric;
  v_purity        numeric;
  v_is_new_design boolean;
  v_as_of         date;
  v_m             numeric;
  v_set analytics.oem_setting%rowtype;
  v_missing jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_r_cast numeric; v_r_polish numeric; v_r_plate numeric; v_r_total numeric;
  v_q_run  numeric;
  v_price_used numeric; v_price_source text;
  v_sprue numeric; v_recovery numeric; v_polish_loss numeric; v_loss_eff numeric; v_metal_per_piece numeric;
  v_labor_dt numeric; v_labor_hrs numeric; v_hr numeric;
  v_wax_pph numeric; v_wax_mat numeric; c_wax numeric; c_wax_minutes numeric;
  v_cut_min numeric; c_cut numeric; c_cut_minutes numeric;
  v_polish_ppd numeric; c_polish numeric; c_polish_minutes numeric;
  v_qc_ppd numeric; c_qc numeric; c_qc_minutes numeric;
  v_gem_sph numeric; v_gem_price numeric; c_gem numeric; c_gem_minutes numeric;
  v_pack numeric; c_pack numeric;
  v_gold_alloy numeric; c_gold_alloy numeric;
  v_labor_sum numeric; v_labor_per_piece numeric;
  v_labor_steps jsonb := '[]'::jsonb;
  v_flask_cap numeric; v_flask_cost numeric; v_flask_count int; v_flask_total numeric;
  v_plate_cap numeric; v_plate_cost numeric; v_plate_count int; v_plate_total numeric;
  v_batch_per_piece numeric; v_batch_lines jsonb := '[]'::jsonb;
  v_cad numeric; v_print3d numeric; v_mold numeric;
  v_nre_cost numeric := 0; v_nre_price numeric := 0;
  v_cost_piece numeric; v_price_piece numeric; v_quote_total numeric; v_pieces_subtotal numeric;
  v_margin_actual numeric; v_is_complete boolean;
  v_moq numeric; v_qty_pass boolean;
  v_jobvalue_min numeric; v_jobvalue_pass boolean;
  v_metalweight_applies boolean := false; v_metalweight_pass boolean;
  v_gold_lot numeric; v_total_gold_g numeric;
  v_margin_state text;
  -- ---- silver999 (bar) only ----
  v_bkk_today       date;
  v_bar_size        text;
  v_bar_col         text;
  v_bar_price       numeric;
  v_bar_margin_pct  numeric;
  v_bar_engrave_image numeric;
  v_bar_engrave_text  numeric;
  v_bar_sheet_time    text;
  v_bar_captured_at   timestamptz;
  v_bar_source        text;
  -- ---- 0079: buyback-based cost ----
  v_bar_buy_per_baht numeric;
  v_bar_kilo_buy     numeric;
  v_bar_buyback      numeric;
  v_bar_metal_cost   numeric;
  v_bar_cost_basis   text;
begin
  if p_shop_id is null then
    raise exception 'oem_price_calc: p_shop_id is required';
  end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'oem_price_calc: p_input must be a json object';
  end if;

  v_metal := p_input->>'metal';
  if v_metal is null or v_metal not in ('silver', 'gold', 'brass', 'silver999') then
    raise exception 'oem_price_calc: p_input.metal must be silver/gold/brass/silver999';
  end if;

  -- ==========================================================================
  -- silver999 (เงินแท่ง) — แยกออกทั้งก้อนก่อนถึง validation ของงานผลิต แล้ว
  -- return ทันที ราคามาจาก silver_price_daily ของวันนี้ (BKK) เท่านั้น ห้าม
  -- คูณข้ามขนาด/จากราคาต่อกรัม (ราคาไม่ linear ~6%) · 0079: ต้นทุนอนุมานจาก
  -- ราคารับซื้อคืนจริงของขนาดนั้น (ฐานหลัก) ถอย fallback ไป bar_margin_pct
  -- เฉพาะแถวที่ไม่มีราคารับซื้อคืน (มักเป็นแถวกรอกมือ) · floors.margin.value
  -- ต้องเป็น null (จุดชี้ขาดของ design — ใส่ค่าจริงจะโดนบังคับ approval note
  -- ทุกใบทั้งที่ไม่ได้ลดสักบาท)
  -- ==========================================================================
  if v_metal = 'silver999' then
    v_warnings := jsonb_build_array('ราคาเงินแท่งยืนเฉพาะวันนี้เท่านั้น');

    v_bar_size := nullif(btrim(p_input->>'bar_size'), '');
    if v_bar_size is null or v_bar_size not in ('0_5_baht', '1_baht', '3_baht', '5_baht', '10_baht', '1_kg') then
      raise exception 'oem_price_calc: p_input.bar_size must be one of 0_5_baht/1_baht/3_baht/5_baht/10_baht/1_kg for metal=silver999';
    end if;
    v_qty := nullif(p_input->>'qty', '')::int;
    if v_qty is null or v_qty <= 0 then
      raise exception 'oem_price_calc: p_input.qty must be > 0';
    end if;
    v_bar_engrave_image := nullif(p_input->>'engrave_image_thb', '')::numeric;
    -- 0079: range check แทน "< 0" — Postgres ถือว่า NaN มากกว่าทุกค่า (แม้แต่
    -- infinity) จึงไหลผ่าน "< 0" ไปได้เงียบๆ แล้วพังเลขคำนวณทั้งใบ · not(between)
    -- จับ NaN/Infinity ให้ฟรี เพราะเทียบกับ NaN คืน false เสมอ ทำให้ not() เป็น true
    if v_bar_engrave_image is not null
       and not (v_bar_engrave_image >= 0 and v_bar_engrave_image <= 1000000) then
      raise exception 'oem_price_calc: p_input.engrave_image_thb must be a finite number between 0 and 1,000,000';
    end if;
    v_bar_engrave_text := nullif(p_input->>'engrave_text_thb', '')::numeric;
    if v_bar_engrave_text is not null
       and not (v_bar_engrave_text >= 0 and v_bar_engrave_text <= 1000000) then
      raise exception 'oem_price_calc: p_input.engrave_text_thb must be a finite number between 0 and 1,000,000';
    end if;

    select * into v_set from analytics.oem_setting where shop_id = p_shop_id;
    if v_set.shop_id is null then
      v_set.margin_target_pct := 0.30; v_set.margin_discount_cap_pct := 0.25;
      v_set.margin_floor_pct := 0.20; v_set.margin_hard_floor_pct := 0.15;
      v_set.nre_max_share_pct := 0.25; v_set.min_job_value_thb := 8000;
      v_set.bar_margin_pct := 0.19;
    end if;
    v_bar_margin_pct := coalesce(v_set.bar_margin_pct, 0.19);

    -- "วันนี้" = timezone ไทย เสมอ ไม่ใช่ current_date (UTC) — DB เป็น UTC
    -- ก่อน 07:00 ไทยจะเหลื่อมวัน · server lookup วันนี้เอง ไม่ใช้ p_input.as_of_date
    -- ของ client (กัน client ปักวันเก่า)
    v_bkk_today := (now() at time zone 'Asia/Bangkok')::date;

    v_bar_col := case v_bar_size
      when '0_5_baht' then 'bar_0_5_baht'
      when '1_baht'   then 'bar_1_baht'
      when '3_baht'   then 'bar_3_baht'
      when '5_baht'   then 'bar_5_baht'
      when '10_baht'  then 'bar_10_baht'
      when '1_kg'     then 'kilo_sell_vat'
    end;

    -- lookup แบบ `=` เท่านั้น (ไม่มี fallback ราคาเมื่อวาน) · 1 กก. ใช้
    -- kilo_sell_vat ตามมติ (ทั้งใบ VAT-inclusive) ห้าม sell_per_baht (null
    -- เมื่อ source=feed ตั้งแต่ 0074) และห้ามคูณข้ามขนาด · 0079: ดึง
    -- buy_per_baht/kilo_buy มาด้วยในคิวรีเดียว (ไม่ query ซ้ำ) — ใช้เป็นฐาน
    -- ต้นทุนแทน bar_margin_pct ห้ามใส่ 2 ค่านี้ลง jsonb ที่ return เด็ดขาด
    -- (ราคารับซื้อคืน ห้ามหลุดถึงลูกค้า)
    select sheet_time, captured_at, source, buy_per_baht, kilo_buy,
      case v_bar_size
        when '0_5_baht' then bar_0_5_baht
        when '1_baht'   then bar_1_baht
        when '3_baht'   then bar_3_baht
        when '5_baht'   then bar_5_baht
        when '10_baht'  then bar_10_baht
        when '1_kg'     then kilo_sell_vat
      end
      into v_bar_sheet_time, v_bar_captured_at, v_bar_source, v_bar_buy_per_baht, v_bar_kilo_buy, v_bar_price
      from analytics.silver_price_daily
      where shop_id = p_shop_id and as_of_date = v_bkk_today;

    if v_bar_price is null then
      -- ไม่ใช่ oem_rate_def rate_key จริง (oem_missing_item join แล้วไม่เจอแถว
      -- จะได้ null กลับมา) จึงประกอบ missing item เองตรงนี้ ไม่เรียก helper
      v_missing := v_missing || jsonb_build_array(jsonb_build_object(
        'rate_key', 'silver_bar_price',
        'scope', v_bar_size,
        'question_th', 'ยังไม่มีราคาเงินแท่งของวันนี้ (สคริปต์ดึง 09/13/20 น. หรือกรอกผ่าน silver_price_set)',
        'priority', 'P0'
      ));
    end if;

    v_is_complete := (v_bar_price is not null);

    if v_is_complete then
      -- 0079: ต้นทุนเนื้อแท่ง = ราคารับซื้อคืนจริงของขนาดนี้ ในแถวเดียวกัน
      -- (ไม่ใช่คูณข้ามขนาดจาก per-baht เพราะ premium ไม่ linear) — ถ้าแถวนี้
      -- กรอกมือและไม่มีราคารับซื้อคืน จะ null ผ่านมาเฉยๆ (ไม่ error) แล้วถอยไป
      -- fallback ข้างล่าง
      v_bar_buyback := case v_bar_size
        when '0_5_baht' then v_bar_buy_per_baht * 0.5
        when '1_baht'   then v_bar_buy_per_baht * 1
        when '3_baht'   then v_bar_buy_per_baht * 3
        when '5_baht'   then v_bar_buy_per_baht * 5
        when '10_baht'  then v_bar_buy_per_baht * 10
        when '1_kg'     then v_bar_kilo_buy
      end;
    end if;

    if v_is_complete then
      -- price_per_piece = ราคาต่อขนาดจาก feed + engrave (ห้ามคูณจากต่อกรัม/บาท)
      v_price_piece := v_bar_price + coalesce(v_bar_engrave_image, 0) + coalesce(v_bar_engrave_text, 0);

      if v_bar_buyback is not null then
        -- ฐานหลัก: ต้นทุนเนื้อแท่ง = ราคารับซื้อคืนของขนาดนี้วันนี้ (ของจริง)
        v_bar_metal_cost := v_bar_buyback;
        v_bar_cost_basis := 'buyback';
      else
        -- fallback: แถวนี้ไม่มีราคารับซื้อคืน (มักเป็นแถวกรอกมือ) ถอยไปใช้
        -- bar_margin_pct แบบเดิม + เตือนว่าเป็นค่าประมาณไม่ใช่ของจริง
        v_bar_metal_cost := v_bar_price * (1 - v_bar_margin_pct);
        v_bar_cost_basis := 'assumed_margin';
        v_warnings := v_warnings || to_jsonb(
          ('ไม่มีราคารับซื้อคืนของขนาด ' || v_bar_size || ' ในฟีดวันนี้ (แถวนี้น่าจะกรอกมือ) ' ||
           'ใช้ต้นทุนประมาณจาก margin ที่ตั้งไว้ (' || round(v_bar_margin_pct * 100, 1)::text || '%) แทน — ' ||
           'ไม่แม่นเท่าราคารับซื้อคืนจริง')::text
        );
      end if;

      -- ค่ายิงเลเซอร์เป็น pass-through: ต้นทุน = ราคาที่กรอก ไม่ทำกำไรจากมัน
      -- ทำให้ margin ทั้งก้อนมาจากเนื้อแท่งล้วน ไม่ถูกค่าเลเซอร์เจือจาง (ต่างจาก
      -- สูตรเดิมที่คูณ margin ทับ price_piece ทั้งก้อนรวม engrave ไปด้วย)
      v_cost_piece := v_bar_metal_cost + coalesce(v_bar_engrave_image, 0) + coalesce(v_bar_engrave_text, 0);
      v_pieces_subtotal := round(v_qty * v_price_piece, 2);
      v_quote_total := v_pieces_subtotal; -- ไม่มี NRE สำหรับเงินแท่ง
      v_margin_actual := case when v_price_piece <> 0 then round((v_price_piece - v_cost_piece) / v_price_piece, 4) end;
    else
      v_price_piece := null; v_cost_piece := null;
      v_pieces_subtotal := null; v_quote_total := null; v_margin_actual := null;
    end if;

    return jsonb_build_object(
      'is_complete', v_is_complete,
      'missing', v_missing,
      'breakdown', jsonb_build_object(
        'q_run', null,
        'reject_pct_total', null,
        'margin_pct_used', null,
        'metal', jsonb_build_object('per_piece', null, 'price_used', null, 'price_source', 'silver_price_daily'),
        'labor', jsonb_build_object('per_piece', 0, 'steps', '[]'::jsonb),
        'batch', jsonb_build_object('per_piece', 0, 'lines', '[]'::jsonb),
        'nre', jsonb_build_object('cad', null, 'print3d', null, 'mold', null, 'cost', 0, 'price', 0),
        'bar', jsonb_build_object(
          'size', v_bar_size,
          'price_column', v_bar_col,
          'bar_price_per_piece', v_bar_price,
          'engrave_image_thb', v_bar_engrave_image,
          'engrave_text_thb', v_bar_engrave_text,
          'margin_pct_embedded', v_bar_margin_pct,
          -- 0079: ฐานต้นทุนที่ใช้จริงรอบนี้ — 'buyback' = ราคารับซื้อคืนจริง
          -- จากฟีด (แม่น) · 'assumed_margin' = fallback จาก bar_margin_pct
          -- (ประมาณ) · null เมื่อ is_complete=false (ยังไม่มีราคาให้คำนวณ)
          'cost_basis', v_bar_cost_basis,
          'as_of_date', case when v_bar_price is not null then v_bkk_today else null end,
          'sheet_time', v_bar_sheet_time,
          'captured_at', v_bar_captured_at,
          'source', v_bar_source
          -- ห้ามเด็ดขาด: kilo_buy / buy_per_baht (ราคารับซื้อคืน) — ก้อนนี้ถูก
          -- copy ลง rate_snapshot ของ header ด้วย ห้ามหลุดถึงลูกค้า
        ),
        'cost_piece', round(v_cost_piece, 4),
        'price_per_piece', round(v_price_piece, 4),
        'quote_total', v_quote_total,
        'margin_actual_pct', v_margin_actual
      ),
      'floors', jsonb_build_object(
        'qty', jsonb_build_object('pass', true, 'moq', null, 'actual', v_qty),
        'job_value', jsonb_build_object('pass', true, 'min', 0),
        'metal_weight', jsonb_build_object('pass', true, 'applies', false),
        -- value = null จงใจ: margin เงินแท่งไม่ใช่ตัวที่ "เลือกคิด" ใส่ค่าจริง
        -- จะโดนด่าน note-tier (floor 20%) บังคับใส่เหตุผลทุกใบ (phantom note)
        -- 0079: blended = margin_actual_pct จริง (ไม่ใช่ bar_margin_pct ลอยๆ
        -- เหมือนเดิม) ใช้รายงาน/ตัดสิน note-tier ที่ระดับใบรวมได้แม่นขึ้น
        -- (ดู oem_quote_save/renegotiate)
        'margin', jsonb_build_object(
          'state', null, 'value', null, 'blended', v_margin_actual, 'target', v_set.margin_target_pct
        ),
        'price_fresh', jsonb_build_object(
          'pass', (v_bar_price is not null),
          'as_of_date', case when v_bar_price is not null then v_bkk_today else null end,
          'today_bkk', v_bkk_today
        )
      ),
      'warnings', v_warnings,
      'formula_version', 4
    );
  end if;

  -- ==========================================================================
  -- งานผลิตเดิม (silver/gold/brass) — 0083: เติม range check กัน NaN/Infinity
  -- ให้ weight_g/gem_count/purity เท่านั้น (ดูหัวไฟล์ §2) ทุกอย่างอื่นคงเดิม
  -- จาก 0066 ไม่แตะ
  -- ==========================================================================
  v_item_kind := nullif(btrim(p_input->>'item_kind'), '');
  if v_item_kind is null then
    raise exception 'oem_price_calc: p_input.item_kind is required';
  end if;
  v_polish_tier := nullif(btrim(p_input->>'polish_tier'), '');
  if v_polish_tier is null then
    raise exception 'oem_price_calc: p_input.polish_tier is required';
  end if;
  v_qty := nullif(p_input->>'qty', '')::int;
  if v_qty is null or v_qty <= 0 then
    raise exception 'oem_price_calc: p_input.qty must be > 0';
  end if;
  v_weight_g := nullif(p_input->>'weight_g', '')::numeric;
  -- 0083: range check แทน "<= 0" เดี่ยวๆ — เหตุผลเดียวกับ engrave_*_thb ของ
  -- 0079 (NaN <= 0 เป็น false เพราะ Postgres ถือว่า NaN มากกว่าทุกค่า จึงไหล
  -- ผ่าน "<= 0" ไปเงียบๆ) not(between) จับ NaN/Infinity ให้ฟรี
  if v_weight_g is null or not (v_weight_g > 0 and v_weight_g <= 100000) then
    raise exception 'oem_price_calc: p_input.weight_g must be a finite number > 0 and <= 100,000';
  end if;
  v_is_new_design := coalesce((p_input->>'is_new_design')::boolean, true);
  v_as_of := coalesce((p_input->>'as_of_date')::date, current_date);
  v_plating_type := nullif(btrim(p_input->>'plating_type'), '');
  v_gem_tier := nullif(btrim(p_input->>'gem_tier'), '');
  v_gem_count := coalesce(nullif(p_input->>'gem_count', '')::numeric, 0);
  -- 0083: เดิมไม่มี range check เลย มีแค่ "> 0 and gem_tier is null" ซึ่งไม่ใช่
  -- การ validate ขนาดค่า (ไม่กันติดลบ/NaN/Infinity แม้แต่น้อย เข้าเงื่อนไขนี้
  -- เฉพาะตอน gem_tier ไม่ถูกส่งมาเท่านั้น) เติม range check ก่อนใช้ค่านี้ต่อ
  if not (v_gem_count >= 0 and v_gem_count <= 1000) then
    raise exception 'oem_price_calc: p_input.gem_count must be a finite number between 0 and 1000';
  end if;
  if v_gem_count > 0 and v_gem_tier is null then
    raise exception 'oem_price_calc: p_input.gem_count > 0 requires p_input.gem_tier';
  end if;

  v_purity := nullif(p_input->>'purity', '')::numeric;
  if v_purity is null then
    v_purity := case v_metal when 'silver' then 0.925 when 'brass' then 1.0 else null end;
  end if;
  if v_metal = 'gold' and v_purity is null then
    raise exception 'oem_price_calc: p_input.purity is required for gold (no safe default across K)';
  end if;
  -- 0083: เดิมไม่มี range check เลยสำหรับค่าที่ client ส่งมาตรงๆ (มีแค่ "is
  -- null → error" สำหรับทองเท่านั้น) — purity เป็นสัดส่วนเนื้อโลหะ ต้องอยู่ใน
  -- ช่วง (0, 1] เสมอไม่ว่าโลหะไหน (ค่า default ของ silver/brass อยู่ในช่วงนี้
  -- อยู่แล้ว ไม่กระทบ)
  if v_purity is not null and not (v_purity > 0 and v_purity <= 1) then
    raise exception 'oem_price_calc: p_input.purity must be a finite number > 0 and <= 1';
  end if;

  select * into v_set from analytics.oem_setting where shop_id = p_shop_id;
  if v_set.shop_id is null then
    v_set.margin_target_pct := 0.30; v_set.margin_discount_cap_pct := 0.25;
    v_set.margin_floor_pct := 0.20; v_set.margin_hard_floor_pct := 0.15;
    v_set.nre_max_share_pct := 0.25; v_set.min_job_value_thb := 8000;
  end if;

  v_m := nullif(p_input->>'margin_pct', '')::numeric;
  if v_m is null then v_m := v_set.margin_target_pct; end if;
  if v_m < 0 or v_m >= 1 then
    raise exception 'oem_price_calc: p_input.margin_pct must be in [0,1)';
  end if;

  v_r_cast := analytics.oem_rate_value(p_shop_id, 'reject_rate_cast_pct', '-', v_as_of);
  v_r_polish := analytics.oem_rate_value(p_shop_id, 'reject_rate_polish_pct', '-', v_as_of);
  if v_r_cast is null then v_missing := v_missing || analytics.oem_missing_item('reject_rate_cast_pct', '-'); end if;
  if v_r_polish is null then v_missing := v_missing || analytics.oem_missing_item('reject_rate_polish_pct', '-'); end if;
  if v_plating_type is not null then
    v_r_plate := analytics.oem_rate_value(p_shop_id, 'reject_rate_plate_pct', '-', v_as_of);
    if v_r_plate is null then v_missing := v_missing || analytics.oem_missing_item('reject_rate_plate_pct', '-'); end if;
  else
    v_r_plate := 0;
  end if;
  v_r_total := 1 - (1 - coalesce(v_r_cast, 0)) * (1 - coalesce(v_r_polish, 0)) * (1 - coalesce(v_r_plate, 0));

  v_q_run := ceiling(v_qty::numeric / (1 - v_r_total));

  select price_thb_per_gram, source into v_price_used, v_price_source
    from analytics.oem_metal_price
    where shop_id = p_shop_id and metal = v_metal and as_of_date <= v_as_of
    order by as_of_date desc limit 1;
  if v_price_used is null and v_metal = 'silver' then
    select silver_spot_thb_per_gram into v_price_used
      from analytics.shop_setting where shop_id = p_shop_id;
    if v_price_used is not null then v_price_source := 'shop_setting.silver_spot_thb_per_gram (fallback)'; end if;
  end if;
  if v_price_used is null then
    v_missing := v_missing || jsonb_build_object(
      'rate_key', 'metal_price', 'scope', v_metal,
      'question_th', 'ราคา' || v_metal || ' ต่อกรัม ณ วันที่คำนวณ ยังไม่ได้ตั้งค่า (บันทึกผ่าน saveMetalPrice)',
      'priority', 'P0');
  end if;

  v_sprue := analytics.oem_rate_value(p_shop_id, 'sprue_loss_pct', v_metal, v_as_of);
  v_recovery := analytics.oem_rate_value(p_shop_id, 'recovery_rate_pct', v_metal, v_as_of);
  v_polish_loss := analytics.oem_rate_value(p_shop_id, 'polish_loss_pct', v_metal, v_as_of);
  if v_sprue is null then v_missing := v_missing || analytics.oem_missing_item('sprue_loss_pct', v_metal); end if;
  if v_recovery is null then v_missing := v_missing || analytics.oem_missing_item('recovery_rate_pct', v_metal); end if;
  if v_polish_loss is null then v_missing := v_missing || analytics.oem_missing_item('polish_loss_pct', v_metal); end if;

  v_loss_eff := coalesce(v_sprue, 0) * (1 - coalesce(v_recovery, 0)) + coalesce(v_polish_loss, 0);

  v_metal_per_piece := v_weight_g * v_purity * coalesce(v_price_used, 0) * (1 + v_loss_eff)
                        * (1 / (1 - v_r_total * (1 - coalesce(v_recovery, 0))));

  v_labor_dt := analytics.oem_rate_value(p_shop_id, 'labor_thb_per_day', 'ฉีดเทียน', v_as_of);
  v_labor_hrs := analytics.oem_rate_value(p_shop_id, 'work_hours_per_day', 'ฉีดเทียน', v_as_of);
  if v_labor_dt is null then v_missing := v_missing || analytics.oem_missing_item('labor_thb_per_day', 'ฉีดเทียน'); end if;
  if v_labor_hrs is null then v_missing := v_missing || analytics.oem_missing_item('work_hours_per_day', 'ฉีดเทียน'); end if;
  v_wax_pph := analytics.oem_rate_value(p_shop_id, 'wax_inject_pieces_per_hour', '-', v_as_of);
  v_wax_mat := analytics.oem_rate_value(p_shop_id, 'wax_material_thb_per_piece', '-', v_as_of);
  if v_wax_pph is null then v_missing := v_missing || analytics.oem_missing_item('wax_inject_pieces_per_hour', '-'); end if;
  if v_wax_mat is null then v_missing := v_missing || analytics.oem_missing_item('wax_material_thb_per_piece', '-'); end if;
  v_hr := case when v_labor_dt is not null and v_labor_hrs is not null and v_labor_hrs <> 0
               then v_labor_dt / v_labor_hrs end;
  c_wax_minutes := case when v_wax_pph is not null and v_wax_pph <> 0 then round(60 / v_wax_pph, 2) end;
  c_wax := coalesce(case when v_hr is not null and v_wax_pph is not null and v_wax_pph <> 0
                         then v_hr / v_wax_pph end, 0) + coalesce(v_wax_mat, 0);
  v_labor_steps := v_labor_steps || jsonb_build_object('key', 'wax_inject', 'minutes', c_wax_minutes, 'thb', round(c_wax, 4));

  v_labor_dt := analytics.oem_rate_value(p_shop_id, 'labor_thb_per_day', 'หล่อ', v_as_of);
  v_labor_hrs := analytics.oem_rate_value(p_shop_id, 'work_hours_per_day', 'หล่อ', v_as_of);
  if v_labor_dt is null then v_missing := v_missing || analytics.oem_missing_item('labor_thb_per_day', 'หล่อ'); end if;
  if v_labor_hrs is null then v_missing := v_missing || analytics.oem_missing_item('work_hours_per_day', 'หล่อ'); end if;
  v_cut_min := analytics.oem_rate_value(p_shop_id, 'cut_sprue_minutes_per_piece', '-', v_as_of);
  if v_cut_min is null then v_missing := v_missing || analytics.oem_missing_item('cut_sprue_minutes_per_piece', '-'); end if;
  v_hr := case when v_labor_dt is not null and v_labor_hrs is not null and v_labor_hrs <> 0
               then v_labor_dt / v_labor_hrs end;
  c_cut := coalesce(case when v_hr is not null and v_cut_min is not null then (v_hr / 60) * v_cut_min end, 0);
  c_cut_minutes := v_cut_min;
  v_labor_steps := v_labor_steps || jsonb_build_object('key', 'cut_sprue', 'minutes', c_cut_minutes, 'thb', round(c_cut, 4));

  v_labor_dt := analytics.oem_rate_value(p_shop_id, 'labor_thb_per_day', 'ขัด', v_as_of);
  v_labor_hrs := analytics.oem_rate_value(p_shop_id, 'work_hours_per_day', 'ขัด', v_as_of);
  if v_labor_dt is null then v_missing := v_missing || analytics.oem_missing_item('labor_thb_per_day', 'ขัด'); end if;
  if v_labor_hrs is null then v_missing := v_missing || analytics.oem_missing_item('work_hours_per_day', 'ขัด'); end if;
  v_polish_ppd := analytics.oem_rate_value(p_shop_id, 'polish_pieces_per_day', v_polish_tier, v_as_of);
  if v_polish_ppd is null then v_missing := v_missing || analytics.oem_missing_item('polish_pieces_per_day', v_polish_tier); end if;
  v_hr := case when v_labor_dt is not null and v_labor_hrs is not null and v_labor_hrs <> 0
               then v_labor_dt / v_labor_hrs end;
  c_polish_minutes := case when v_polish_ppd is not null and v_labor_hrs is not null and v_polish_ppd <> 0
                            then round((v_labor_hrs * 60) / v_polish_ppd, 2) end;
  c_polish := coalesce(case when v_hr is not null and v_polish_ppd is not null and v_labor_hrs is not null and v_labor_hrs <> 0
                            then v_hr / (v_polish_ppd / v_labor_hrs) end, 0);
  v_labor_steps := v_labor_steps || jsonb_build_object('key', 'polish', 'minutes', c_polish_minutes, 'thb', round(c_polish, 4));

  if v_gem_tier is not null then
    v_labor_dt := analytics.oem_rate_value(p_shop_id, 'labor_thb_per_day', 'ฝังพลอย', v_as_of);
    v_labor_hrs := analytics.oem_rate_value(p_shop_id, 'work_hours_per_day', 'ฝังพลอย', v_as_of);
    if v_labor_dt is null then v_missing := v_missing || analytics.oem_missing_item('labor_thb_per_day', 'ฝังพลอย'); end if;
    if v_labor_hrs is null then v_missing := v_missing || analytics.oem_missing_item('work_hours_per_day', 'ฝังพลอย'); end if;
    v_gem_sph := analytics.oem_rate_value(p_shop_id, 'gem_setting_seeds_per_hour', v_gem_tier, v_as_of);
    v_gem_price := analytics.oem_rate_value(p_shop_id, 'gem_price_thb_per_seed', v_gem_tier, v_as_of);
    if v_gem_sph is null then v_missing := v_missing || analytics.oem_missing_item('gem_setting_seeds_per_hour', v_gem_tier); end if;
    if v_gem_price is null then v_missing := v_missing || analytics.oem_missing_item('gem_price_thb_per_seed', v_gem_tier); end if;
    v_hr := case when v_labor_dt is not null and v_labor_hrs is not null and v_labor_hrs <> 0
                 then v_labor_dt / v_labor_hrs end;
    c_gem_minutes := case when v_gem_sph is not null and v_gem_sph <> 0 then round((60 / v_gem_sph) * v_gem_count, 2) end;
    c_gem := coalesce(case when v_hr is not null and v_gem_sph is not null and v_gem_sph <> 0
                           then (v_hr / v_gem_sph) * v_gem_count end, 0)
             + coalesce(v_gem_price, 0) * v_gem_count;
    v_labor_steps := v_labor_steps || jsonb_build_object('key', 'gem_setting', 'minutes', c_gem_minutes, 'thb', round(c_gem, 4));
  else
    c_gem := 0;
  end if;

  v_labor_dt := analytics.oem_rate_value(p_shop_id, 'labor_thb_per_day', 'QC', v_as_of);
  v_labor_hrs := analytics.oem_rate_value(p_shop_id, 'work_hours_per_day', 'QC', v_as_of);
  if v_labor_dt is null then v_missing := v_missing || analytics.oem_missing_item('labor_thb_per_day', 'QC'); end if;
  if v_labor_hrs is null then v_missing := v_missing || analytics.oem_missing_item('work_hours_per_day', 'QC'); end if;
  v_qc_ppd := analytics.oem_rate_value(p_shop_id, 'qc_pieces_per_day', '-', v_as_of);
  if v_qc_ppd is null then v_missing := v_missing || analytics.oem_missing_item('qc_pieces_per_day', '-'); end if;
  v_hr := case when v_labor_dt is not null and v_labor_hrs is not null and v_labor_hrs <> 0
               then v_labor_dt / v_labor_hrs end;
  c_qc_minutes := case when v_qc_ppd is not null and v_labor_hrs is not null and v_qc_ppd <> 0
                        then round((v_labor_hrs * 60) / v_qc_ppd, 2) end;
  c_qc := coalesce(case when v_hr is not null and v_qc_ppd is not null and v_labor_hrs is not null and v_labor_hrs <> 0
                        then v_hr / (v_qc_ppd / v_labor_hrs) end, 0);
  v_labor_steps := v_labor_steps || jsonb_build_object('key', 'qc', 'minutes', c_qc_minutes, 'thb', round(c_qc, 4));

  v_pack := analytics.oem_rate_value(p_shop_id, 'pack_cost_thb_per_piece', '-', v_as_of);
  if v_pack is null then v_missing := v_missing || analytics.oem_missing_item('pack_cost_thb_per_piece', '-'); end if;
  c_pack := coalesce(v_pack, 0);
  v_labor_steps := v_labor_steps || jsonb_build_object('key', 'pack', 'minutes', null, 'thb', round(c_pack, 4));

  if v_metal = 'gold' then
    v_gold_alloy := analytics.oem_rate_value(p_shop_id, 'gold_alloy_cost_thb_per_piece', '-', v_as_of);
    if v_gold_alloy is null then v_missing := v_missing || analytics.oem_missing_item('gold_alloy_cost_thb_per_piece', '-'); end if;
    c_gold_alloy := coalesce(v_gold_alloy, 0);
    v_labor_steps := v_labor_steps || jsonb_build_object('key', 'gold_alloy', 'minutes', null, 'thb', round(c_gold_alloy, 4));
  else
    c_gold_alloy := 0;
  end if;

  v_labor_sum := c_wax + c_cut + c_polish + c_gem + c_qc + c_pack + c_gold_alloy;
  v_labor_per_piece := v_labor_sum / (1 - v_r_total);

  v_flask_cap := analytics.oem_rate_value(p_shop_id, 'flask_capacity_pieces', v_item_kind, v_as_of);
  v_flask_cost := analytics.oem_rate_value(p_shop_id, 'flask_cost_thb', '-', v_as_of);
  if v_flask_cap is null then v_missing := v_missing || analytics.oem_missing_item('flask_capacity_pieces', v_item_kind); end if;
  if v_flask_cost is null then v_missing := v_missing || analytics.oem_missing_item('flask_cost_thb', '-'); end if;
  v_flask_count := case when v_flask_cap is not null and v_flask_cap > 0 then ceiling(v_q_run / v_flask_cap)::int end;
  v_flask_total := case when v_flask_count is not null and v_flask_cost is not null then v_flask_count * v_flask_cost end;
  v_batch_lines := v_batch_lines || jsonb_build_object(
    'key', 'flask', 'capacity', v_flask_cap, 'count', v_flask_count, 'cost', v_flask_total);

  if v_plating_type is not null then
    v_plate_cap := analytics.oem_rate_value(p_shop_id, 'plating_pieces_per_batch', v_plating_type, v_as_of);
    v_plate_cost := analytics.oem_rate_value(p_shop_id, 'plating_cost_per_batch', v_plating_type, v_as_of);
    if v_plate_cap is null then v_missing := v_missing || analytics.oem_missing_item('plating_pieces_per_batch', v_plating_type); end if;
    if v_plate_cost is null then v_missing := v_missing || analytics.oem_missing_item('plating_cost_per_batch', v_plating_type); end if;
    v_plate_count := case when v_plate_cap is not null and v_plate_cap > 0 then ceiling(v_q_run / v_plate_cap)::int end;
    v_plate_total := case when v_plate_count is not null and v_plate_cost is not null then v_plate_count * v_plate_cost end;
    v_batch_lines := v_batch_lines || jsonb_build_object(
      'key', 'plating', 'capacity', v_plate_cap, 'count', v_plate_count, 'cost', v_plate_total);
  else
    v_plate_total := 0; v_plate_count := 0;
  end if;

  v_batch_per_piece := (coalesce(v_flask_total, 0) + coalesce(v_plate_total, 0)) / v_qty;

  if v_is_new_design then
    v_cad := analytics.oem_rate_value(p_shop_id, 'cad_fee_thb', '-', v_as_of);
    v_print3d := analytics.oem_rate_value(p_shop_id, 'print3d_cost_thb', '-', v_as_of);
    v_mold := analytics.oem_rate_value(p_shop_id, 'rubber_mold_cost_thb', '-', v_as_of);
    if v_cad is null then v_missing := v_missing || analytics.oem_missing_item('cad_fee_thb', '-'); end if;
    if v_print3d is null then v_missing := v_missing || analytics.oem_missing_item('print3d_cost_thb', '-'); end if;
    if v_mold is null then v_missing := v_missing || analytics.oem_missing_item('rubber_mold_cost_thb', '-'); end if;
    v_nre_cost := coalesce(v_cad, 0) + coalesce(v_print3d, 0) + coalesce(v_mold, 0);
    v_nre_price := case when v_nre_cost > 0 then round(v_nre_cost / (1 - v_m), 2) else 0 end;
  else
    v_cad := 0; v_print3d := 0; v_mold := 0; v_nre_cost := 0; v_nre_price := 0;
  end if;

  v_cost_piece := coalesce(v_metal_per_piece, 0) + coalesce(v_labor_per_piece, 0) + coalesce(v_batch_per_piece, 0);
  if v_metal = 'gold' then
    v_price_piece := coalesce(v_metal_per_piece, 0)
                      + (coalesce(v_labor_per_piece, 0) + coalesce(v_batch_per_piece, 0)) / (1 - v_m);
    v_warnings := v_warnings || to_jsonb('งานทองเป็น pass-through: มาร์จิ้นคิดเฉพาะค่ากำเหน็จ ไม่คิดทับเนื้อทอง — margin รวมทั้งงานจึงต่ำกว่ามาก และเป็นตัวเลขที่ถูกต้อง ไม่ได้ใช้ตัดสิน floor'::text);
  else
    v_price_piece := v_cost_piece / (1 - v_m);
  end if;

  v_moq := analytics.oem_rate_value(p_shop_id, 'moq_pieces', v_metal, v_as_of);
  if v_moq is null then v_missing := v_missing || analytics.oem_missing_item('moq_pieces', v_metal); end if;
  v_qty_pass := case when v_moq is not null then v_qty >= v_moq end;

  if v_metal = 'gold' then
    v_metalweight_applies := true;
    v_gold_lot := analytics.oem_rate_value(p_shop_id, 'gold_min_purchase_lot_g', '-', v_as_of);
    if v_gold_lot is null then v_missing := v_missing || analytics.oem_missing_item('gold_min_purchase_lot_g', '-'); end if;
    v_total_gold_g := v_qty * v_weight_g;
    v_metalweight_pass := case when v_gold_lot is not null then v_total_gold_g >= v_gold_lot end;
  else
    v_metalweight_applies := false;
    v_metalweight_pass := true;
  end if;

  v_is_complete := (jsonb_array_length(v_missing) = 0);

  if v_is_complete then
    v_pieces_subtotal := round(v_qty * v_price_piece, 2);
    v_quote_total := round(v_nre_price + v_pieces_subtotal, 2);
    v_margin_actual := case when v_price_piece <> 0 then round((v_price_piece - v_cost_piece) / v_price_piece, 4) end;
  else
    v_pieces_subtotal := null; v_quote_total := null; v_margin_actual := null;
  end if;

  v_jobvalue_min := greatest(
    coalesce(v_set.min_job_value_thb, 8000),
    case when v_nre_cost > 0 then v_nre_cost / v_set.nre_max_share_pct else 0 end
  );
  v_jobvalue_pass := case when v_quote_total is not null then v_quote_total >= v_jobvalue_min end;

  v_margin_state := case
    when v_m < v_set.margin_hard_floor_pct then 'hard_floor_breach'
    when v_m < v_set.margin_floor_pct then 'needs_approval_note'
    when v_m < v_set.margin_discount_cap_pct then 'discount_zone'
    else 'ok'
  end;
  if v_margin_state <> 'ok' then
    v_warnings := v_warnings || to_jsonb(('margin ที่คิด ' || round(v_m * 100, 1)::text || '% อยู่ในโซน ' || v_margin_state)::text);
  end if;

  return jsonb_build_object(
    'is_complete', v_is_complete,
    'missing', v_missing,
    'breakdown', jsonb_build_object(
      'q_run', v_q_run,
      'reject_pct_total', round(v_r_total, 4),
      'margin_pct_used', v_m,
      'metal', jsonb_build_object(
        'per_piece', round(v_metal_per_piece, 4),
        'loss_basis', 'effective',
        'gross_loss_pct', v_sprue,
        'polish_loss_pct', v_polish_loss,
        'effective_loss_pct', round(v_loss_eff, 4),
        'metal_loss_multiplier', round(1 + v_loss_eff, 4),
        'price_used', v_price_used,
        'price_source', v_price_source
      ),
      'labor', jsonb_build_object('per_piece', round(v_labor_per_piece, 4), 'steps', v_labor_steps),
      'batch', jsonb_build_object('per_piece', round(v_batch_per_piece, 4), 'lines', v_batch_lines),
      'nre', jsonb_build_object('cad', v_cad, 'print3d', v_print3d, 'mold', v_mold, 'cost', v_nre_cost, 'price', v_nre_price),
      'cost_piece', round(v_cost_piece, 4),
      'price_per_piece', round(v_price_piece, 4),
      'quote_total', v_quote_total,
      'margin_actual_pct', v_margin_actual
    ),
    'floors', jsonb_build_object(
      'qty', jsonb_build_object('pass', v_qty_pass, 'moq', v_moq, 'actual', v_qty),
      'job_value', jsonb_build_object('pass', v_jobvalue_pass, 'min', v_jobvalue_min),
      'metal_weight', jsonb_build_object('pass', v_metalweight_pass, 'applies', v_metalweight_applies),
      'margin', jsonb_build_object(
        'state', v_margin_state,
        'value', v_m,
        'blended', v_margin_actual,
        'target', v_set.margin_target_pct
      )
    ),
    'warnings', v_warnings,
    'formula_version', 3
  );
end;
$$;

revoke execute on function analytics.oem_price_calc(uuid, jsonb) from public, anon, authenticated;
grant execute on function analytics.oem_price_calc(uuid, jsonb) to authenticated, service_role;

-- ============================================================================
-- 2. oem_quote_save — arg list เดิม 9 ตัวเป๊ะ = plain replace · เติมด่านเดียว
--    (§1a): margin รวมทั้งใบ "ก่อน" หักส่วนลด (v_margin_actual_blended) ติดลบ
--    = ปฏิเสธเสมอ ไม่ผูกกับ p_discount_thb ไม่ปลดล็อกด้วย p_approval_note —
--    วางไว้ก่อนด่าน hard floor "รวมทั้งใบ" เดิม (ที่ requires discount > 0)
--    เพราะเป็นด่านที่เด็ดขาดกว่า (ไม่มีเงื่อนไขอะไรปลดล็อกได้เลย) ทุกอย่างอื่น
--    (logic/comment ของ 0081 เดิมทั้งหมด รวม deposit_mode/deposit_input) คงเดิม
--    เป๊ะ ไม่แตะ
-- ============================================================================

create or replace function analytics.oem_quote_save(p_shop_id uuid, p_items jsonb, p_quote_id uuid DEFAULT NULL::uuid, p_status text DEFAULT 'draft'::text, p_approval_note text DEFAULT NULL::text, p_customer_name text DEFAULT NULL::text, p_customer_contact text DEFAULT NULL::text, p_discount_thb numeric DEFAULT 0, p_discount_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $function$
declare
  v_set analytics.oem_setting%rowtype;
  v_quote_id uuid := p_quote_id;
  v_is_new boolean := (p_quote_id is null);
  v_current_status text;
  v_quote_no text;
  v_i int;
  v_item jsonb;
  v_seq int;
  v_item_input jsonb;
  v_item_calc jsonb;
  v_item_product_id uuid;
  v_item_sku text;
  v_item_name text;
  v_item_metal text;
  v_item_qty int;
  v_item_cost_piece numeric;
  v_item_price_piece numeric;
  v_item_total numeric;
  v_item_nre_cost numeric;
  v_item_nre_price numeric;
  v_item_q_run int;
  v_item_flask_count int;
  v_item_plate_count int;
  v_item_margin_charged numeric;
  v_item_metal_per_piece numeric;
  v_item_is_complete boolean;
  v_item_qty_pass boolean;
  v_item_metalweight_pass boolean;
  v_item_valid_days int;
  v_calc_agg jsonb := '[]'::jsonb;
  v_is_complete_all boolean := true;
  v_qty_pass_all boolean := true;
  v_metalweight_pass_all boolean := true;
  v_nre_cost_sum numeric := 0;
  v_nre_price_sum numeric := 0;
  v_pieces_subtotal_sum numeric := 0;
  v_flask_count_sum int := 0;
  v_plate_count_sum int := 0;
  v_qrun_sum int := 0;
  v_price_ex_gold_sum numeric := 0;
  v_cost_ex_gold_sum numeric := 0;
  v_price_total_all numeric := 0;
  v_cost_total_all numeric := 0;
  v_min_margin_charged numeric;
  v_min_margin_seq int;
  -- 0079-fix: "มี item ที่ระบบตรวจ margin รายชิ้นไม่ได้อยู่ในใบไหม" — ตัวแทนที่
  -- ถูกของ "ด่านรวมทั้งใบเป็นด่านเดียวที่เหลือสำหรับรายการนั้น" ไม่ใช่
  -- "v_min_margin_charged is null" (ซึ่งแปลว่า "ไม่มี item งานผลิตเลย" — เติม
  -- item งานผลิตชิ้นเล็ก margin สูงเข้าไปก็ปลดล็อกด่านทั้งใบได้ทันที) อิงจาก
  -- margin_charged is null ของแต่ละ item ไม่อิงจาก metal='silver999' ตรงๆ
  -- เพื่อคุ้มครองสินค้าประเภทอื่นที่ตรวจ margin รายชิ้นไม่ได้ในอนาคตอัตโนมัติ
  v_has_ungated_item boolean := false;
  v_valid_days int;
  v_quote_total_sum numeric;
  v_grand_total numeric;
  v_margin_after_discount numeric;
  v_margin_actual_blended numeric;
  v_jobvalue_min numeric;
  v_approved_by uuid;
  -- ---- silver999 (bar) ----
  v_bkk_today date;
  v_has_bar_item boolean := false;
  v_production_total_sum numeric := 0;
  -- ---- 0079: note-tier message (แยกตามสาเหตุจริง — LOW-6) ----
  v_note_tier_msg text;
begin
  if p_shop_id is null then
    raise exception 'oem_quote_save: p_shop_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'oem_quote_save: p_items must be a non-empty json array';
  end if;
  -- H3: เพดานจำนวนรายการ กัน request เดียวถือ lock ยาวจน connection pool ตัน
  if jsonb_array_length(p_items) > 50 then
    raise exception 'oem_quote_save: 1 ใบเสนอราคารับได้สูงสุด 50 รายการ (ส่งมา % รายการ)', jsonb_array_length(p_items)
      using errcode = '22023';
  end if;
  if p_status not in ('draft', 'quoted') then
    raise exception 'oem_quote_save: p_status must be draft or quoted';
  end if;
  if p_discount_thb is null or p_discount_thb < 0 then
    raise exception 'oem_quote_save: p_discount_thb must be >= 0';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  -- timezone ไทย เสมอ — DB เป็น UTC ก่อน 07:00 ไทยจะเหลื่อมวัน
  v_bkk_today := (now() at time zone 'Asia/Bangkok')::date;

  select * into v_set from analytics.oem_setting where shop_id = p_shop_id;
  if v_set.shop_id is null then
    v_set.margin_target_pct := 0.30; v_set.margin_discount_cap_pct := 0.25;
    v_set.margin_floor_pct := 0.20; v_set.margin_hard_floor_pct := 0.15;
    v_set.nre_max_share_pct := 0.25; v_set.min_job_value_thb := 8000;
    v_set.quote_valid_days_silver := 30; v_set.quote_valid_days_gold := 7; v_set.quote_valid_days_brass := 45;
    v_set.bar_margin_pct := 0.19;
    -- 0081: seed ให้ครบเหมือนค่าอื่นในบล็อกนี้ ไม่งั้นร้านที่ยังไม่เคยตั้งค่า
    -- อะไรเลย (แถว oem_setting ยังไม่ถูกสร้าง) จะได้ deposit_input เป็น null
    -- ทั้งที่ deposit_mode ถูกตั้งเป็น 'pct' ไปแล้วข้างล่าง — ชน check constraint
    v_set.deposit_default_pct := 0.50;
  end if;

  if not v_is_new then
    select status into v_current_status
      from analytics.oem_quote where id = v_quote_id and shop_id = p_shop_id for update;
    if not found then
      raise exception 'oem_quote_save: quote % not found for this shop', v_quote_id;
    end if;
    if v_current_status <> 'draft' then
      raise exception 'oem_quote_save: แก้ใบเสนอราคาได้เฉพาะสถานะ draft เท่านั้น (ใบนี้สถานะ %) — ใบที่ออกแล้วให้ใช้ oem_quote_renegotiate', v_current_status
        using errcode = '22023';
    end if;
    delete from analytics.oem_quote_item where quote_id = v_quote_id;
  else
    for v_i in 1..5 loop
      v_quote_no := analytics.oem_quote_next_no(p_shop_id);
      v_quote_id := gen_random_uuid();
      begin
        insert into analytics.oem_quote (
          id, shop_id, quote_no, root_quote_id, customer_name, customer_contact,
          rate_snapshot, status, deposit_mode, deposit_input, created_by, updated_by
        ) values (
          v_quote_id, p_shop_id, v_quote_no, v_quote_id, p_customer_name, p_customer_contact,
          -- 0081: ใบใหม่ตั้งมัดจำเริ่มต้นจาก oem_setting.deposit_default_pct
          -- อัตโนมัติ (ปกติ 50% ไม่ต้องกรอกซ้ำทุกใบ ตามที่เจ้าของสั่ง) — ทำ
          -- เฉพาะ branch สร้างแถวใหม่นี้เท่านั้น ไม่มีทางไปทับใบเก่าที่ผู้ใช้
          -- เคยตั้งเอง (ดู final update ท้ายฟังก์ชัน — ไม่มี deposit_mode/
          -- deposit_input อยู่ใน SET clause นั้นเลย ไม่ว่าจะสร้างใหม่หรือแก้เก่า)
          '[]'::jsonb, 'draft', 'pct', v_set.deposit_default_pct, auth.uid(), auth.uid()
        );
        exit;
      exception when unique_violation then
        if v_i = 5 then
          raise exception 'oem_quote_save: ออกเลขที่ใบเสนอราคาไม่สำเร็จ ลองใหม่อีกครั้ง';
        end if;
      end;
    end loop;
  end if;

  for v_item, v_seq in
    select elem, ord::int from jsonb_array_elements(p_items) with ordinality as t(elem, ord)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'oem_quote_save: p_items[%] must be a json object', v_seq;
    end if;
    v_item_input := v_item->'input';
    if v_item_input is null or jsonb_typeof(v_item_input) <> 'object' then
      raise exception 'oem_quote_save: p_items[%].input is required and must be a json object', v_seq;
    end if;

    v_item_product_id := nullif(v_item->>'product_id', '')::uuid;
    if v_item_product_id is not null and not exists (
      select 1 from public.product where id = v_item_product_id and shop_id = p_shop_id
    ) then
      raise exception 'oem_quote_save: p_items[%].product_id ไม่ใช่สินค้าของร้านนี้', v_seq;
    end if;
    -- H3: ตัดความยาวข้อความที่รับจาก client ก่อนเก็บ (เป็น snapshot ไม่ใช่ free text)
    v_item_sku := left(nullif(btrim(v_item->>'sku_snapshot'), ''), 64);
    v_item_name := left(nullif(btrim(v_item->>'product_name_snapshot'), ''), 200);

    v_item_calc := analytics.oem_price_calc(p_shop_id, v_item_input);
    v_calc_agg := v_calc_agg || jsonb_build_array(jsonb_build_object('seq', v_seq, 'calc', v_item_calc));

    v_item_metal := v_item_input->>'metal';
    if v_item_metal = 'silver999' then
      v_has_bar_item := true;
    end if;
    v_item_qty := nullif(v_item_input->>'qty', '')::int;
    if v_item_qty is null or v_item_qty <= 0 then
      raise exception 'oem_quote_save: p_items[%].input.qty must be > 0', v_seq;
    end if;

    v_item_cost_piece := nullif(v_item_calc->'breakdown'->>'cost_piece', '')::numeric;
    v_item_price_piece := nullif(v_item_calc->'breakdown'->>'price_per_piece', '')::numeric;
    v_item_nre_cost := nullif(v_item_calc->'breakdown'->'nre'->>'cost', '')::numeric;
    v_item_nre_price := nullif(v_item_calc->'breakdown'->'nre'->>'price', '')::numeric;
    v_item_metal_per_piece := nullif(v_item_calc->'breakdown'->'metal'->>'per_piece', '')::numeric;
    v_item_margin_charged := nullif(v_item_calc->'floors'->'margin'->>'value', '')::numeric;
    v_item_q_run := nullif(v_item_calc->'breakdown'->>'q_run', '')::int;
    v_item_is_complete := (v_item_calc->>'is_complete')::boolean;
    v_item_qty_pass := (v_item_calc->'floors'->'qty'->>'pass')::boolean;
    v_item_metalweight_pass := coalesce((v_item_calc->'floors'->'metal_weight'->>'pass')::boolean, true);

    select (l->>'count')::int into v_item_flask_count
      from jsonb_array_elements(coalesce(v_item_calc->'breakdown'->'batch'->'lines', '[]'::jsonb)) l
      where l->>'key' = 'flask';
    select (l->>'count')::int into v_item_plate_count
      from jsonb_array_elements(coalesce(v_item_calc->'breakdown'->'batch'->'lines', '[]'::jsonb)) l
      where l->>'key' = 'plating';

    v_item_total := case
      when v_item_calc->'breakdown'->>'quote_total' is not null
      then (v_item_calc->'breakdown'->>'quote_total')::numeric - coalesce(v_item_nre_price, 0)
    end;

    insert into analytics.oem_quote_item (
      shop_id, quote_id, seq, product_id, sku_snapshot, product_name_snapshot,
      input, calc, qty, cost_piece, price_per_piece, item_total,
      q_run, flask_count, plating_batch_count, margin_charged_pct
    ) values (
      p_shop_id, v_quote_id, v_seq, v_item_product_id, v_item_sku, v_item_name,
      v_item_input, v_item_calc, v_item_qty, v_item_cost_piece, v_item_price_piece, v_item_total,
      v_item_q_run, v_item_flask_count, v_item_plate_count, v_item_margin_charged
    );

    v_is_complete_all := v_is_complete_all and coalesce(v_item_is_complete, false);
    v_qty_pass_all := v_qty_pass_all and coalesce(v_item_qty_pass, false);
    v_metalweight_pass_all := v_metalweight_pass_all and v_item_metalweight_pass;
    v_nre_cost_sum := v_nre_cost_sum + coalesce(v_item_nre_cost, 0);
    v_nre_price_sum := v_nre_price_sum + coalesce(v_item_nre_price, 0);
    v_pieces_subtotal_sum := v_pieces_subtotal_sum + coalesce(v_item_total, 0);
    v_flask_count_sum := v_flask_count_sum + coalesce(v_item_flask_count, 0);
    v_plate_count_sum := v_plate_count_sum + coalesce(v_item_plate_count, 0);
    v_qrun_sum := v_qrun_sum + coalesce(v_item_q_run, 0);

    v_price_total_all := v_price_total_all + coalesce(v_item_price_piece, 0) * v_item_qty;
    v_cost_total_all := v_cost_total_all + coalesce(v_item_cost_piece, 0) * v_item_qty;

    -- ทองเป็น pass-through: ตัดเนื้อทองออกทั้งฝั่งราคาและฝั่งต้นทุน
    if v_item_metal = 'gold' then
      v_price_ex_gold_sum := v_price_ex_gold_sum + coalesce(v_item_total, 0)
                              - coalesce(v_item_metal_per_piece, 0) * v_item_qty;
      v_cost_ex_gold_sum := v_cost_ex_gold_sum + coalesce(v_item_cost_piece, 0) * v_item_qty
                             - coalesce(v_item_metal_per_piece, 0) * v_item_qty;
    else
      -- silver999 (เงินแท่ง) เข้า branch นี้ด้วย cost_piece จริงที่อนุมานมาแล้ว
      -- (ไม่ใช่ null) — margin รวมจึงไม่พองปลอม ไม่ต้องแก้อะไรเพิ่ม
      v_price_ex_gold_sum := v_price_ex_gold_sum + coalesce(v_item_total, 0);
      v_cost_ex_gold_sum := v_cost_ex_gold_sum + coalesce(v_item_cost_piece, 0) * v_item_qty;
    end if;

    -- ด่านมูลค่างานขั้นต่ำ (production-only): นับเฉพาะรายการที่ไม่ใช่เงินแท่ง
    if v_item_metal <> 'silver999' then
      v_production_total_sum := v_production_total_sum + coalesce(v_item_total, 0);
    end if;

    if v_item_margin_charged is not null
       and (v_min_margin_charged is null or v_item_margin_charged < v_min_margin_charged) then
      v_min_margin_charged := v_item_margin_charged;
      v_min_margin_seq := v_seq;
    end if;
    -- 0079-fix: item นี้ระบบตรวจ margin รายชิ้นไม่ได้ (floors.margin.value เป็น
    -- null — ปัจจุบันมีแค่ silver999 แต่เช็คจากค่า ไม่เช็คจาก metal ตรงๆ) ด่าน
    -- รวมทั้งใบคือด่านเดียวที่เหลือสำหรับ item นี้ ต้องทำงานเสมอไม่ว่าใบจะมี
    -- item งานผลิต margin สูงมาช่วยดันค่าเฉลี่ยหรือไม่ก็ตาม
    if v_item_margin_charged is null then
      v_has_ungated_item := true;
    end if;

    v_item_valid_days := case v_item_metal
      when 'gold' then coalesce(v_set.quote_valid_days_gold, 7)
      when 'brass' then coalesce(v_set.quote_valid_days_brass, 45)
      -- เงินแท่ง: ยืนราคาวันเดียว (ราคาเว็บเปลี่ยนได้ทุกวัน ไม่ใช่ตามรอบยืนราคางานผลิต)
      when 'silver999' then 0
      else coalesce(v_set.quote_valid_days_silver, 30)
    end;
    -- ยืนราคาตามโลหะที่ผันผวนสุดในใบ (ทอง/แท่งสั้นสุด) ไม่ใช่ตามรายการสุดท้าย
    v_valid_days := case when v_valid_days is null then v_item_valid_days else least(v_valid_days, v_item_valid_days) end;
  end loop;

  v_quote_total_sum := v_pieces_subtotal_sum + v_nre_price_sum;
  -- ด่านมูลค่างานขั้นต่ำ (production-only): รวม NRE เข้าไปด้วย (ก่อนหักส่วนลด)
  v_production_total_sum := v_production_total_sum + v_nre_price_sum;

  -- C1: กันตัวหารของสูตร margin ไม่ให้ <= 0 ตั้งแต่ต้นทาง
  -- ส่วนลด >= มูลค่างานส่วนที่คิดกำไรได้ = ปฏิเสธ ไม่ใช่ปล่อยให้อัตราส่วนพลิกเครื่องหมาย
  if p_discount_thb > 0 and p_discount_thb >= v_price_ex_gold_sum then
    raise exception 'oem_quote_save: ส่วนลด % บาท มากกว่าหรือเท่ากับมูลค่างานส่วนที่คิดกำไรได้ (% บาท) — เป็นไปไม่ได้ ไม่มีทางลัด',
      p_discount_thb, round(v_price_ex_gold_sum, 2)
      using errcode = '22023';
  end if;
  if p_discount_thb > v_quote_total_sum then
    raise exception 'oem_quote_save: ส่วนลด % บาท มากกว่ายอดรวมทั้งใบ (% บาท)',
      p_discount_thb, round(v_quote_total_sum, 2)
      using errcode = '22023';
  end if;

  v_grand_total := v_quote_total_sum - p_discount_thb;
  v_margin_actual_blended := case when v_price_total_all <> 0
    then round((v_price_total_all - v_cost_total_all) / v_price_total_all, 4) end;
  v_margin_after_discount := case when (v_price_ex_gold_sum - p_discount_thb) > 0
    then round(((v_price_ex_gold_sum - p_discount_thb) - v_cost_ex_gold_sum) / (v_price_ex_gold_sum - p_discount_thb), 4) end;

  if p_status = 'quoted' then
    if not v_is_complete_all then
      raise exception 'oem_quote_save: มีบางรายการยังกรอกข้อมูลไม่ครบ ออกใบเสนอราคาไม่ได้ — บันทึกเป็น draft ก่อนได้' using errcode = '22023';
    end if;
    if not v_qty_pass_all or not v_metalweight_pass_all then
      raise exception 'oem_quote_save: มีบางรายการไม่ผ่านเกณฑ์ floor (จำนวนชิ้น/น้ำหนักโลหะ) ออกใบเสนอราคาไม่ได้' using errcode = '22023';
    end if;

    v_jobvalue_min := greatest(
      coalesce(v_set.min_job_value_thb, 8000),
      case when v_nre_cost_sum > 0 then v_nre_cost_sum / coalesce(v_set.nre_max_share_pct, 0.25) else 0 end
    );
    -- มี item เงินแท่ง -> ด่านนี้ดูเฉพาะมูลค่างานผลิต (ก่อนหักส่วนลด) ข้ามถ้า = 0
    -- (ใบแท่งล้วน) · ไม่มี item เงินแท่ง -> พฤติกรรมเดิมเป๊ะ (gate v_grand_total)
    if v_has_bar_item then
      if v_production_total_sum > 0 and v_production_total_sum < v_jobvalue_min then
        raise exception 'oem_quote_save: มูลค่างานส่วนที่เป็นงานผลิต (% บาท) ต่ำกว่าเกณฑ์ขั้นต่ำ % บาท ออกใบเสนอราคาไม่ได้ (ใบเงินแท่งล้วนไม่ติดด่านนี้)',
          v_production_total_sum, v_jobvalue_min using errcode = '22023';
      end if;
    else
      if v_grand_total < v_jobvalue_min then
        raise exception 'oem_quote_save: มูลค่างานรวม (%) ต่ำกว่าเกณฑ์ขั้นต่ำ % บาท ออกใบเสนอราคาไม่ได้',
          v_grand_total, v_jobvalue_min using errcode = '22023';
      end if;
    end if;

    -- hard floor ระดับรายชิ้น (v_min_margin_charged) — ด่านที่คุ้มครองงานผลิต
    -- ไม่แตะ ไม่มีเงื่อนไข (bar items ไม่เข้าเงื่อนไขนี้อยู่แล้ว เพราะ
    -- floors.margin.value ของแท่งเป็น null เสมอ v_item_margin_charged จึงเป็น
    -- null ไม่ทำให้ v_min_margin_charged ขยับ)
    if v_min_margin_charged is not null and v_min_margin_charged < v_set.margin_hard_floor_pct then
      raise exception 'oem_quote_save: รายการที่ % — margin ที่คิด % ต่ำกว่า hard floor % — ไม่มีทางลัด ต้องปรับราคาหรือปฏิเสธงาน',
        v_min_margin_seq, round(v_min_margin_charged * 100, 1)::text || '%', round(v_set.margin_hard_floor_pct * 100, 1)::text || '%'
        using errcode = '22023';
    end if;

    -- 0083: hard floor เด็ดขาด (§1a) — margin รวมทั้งใบ "ก่อน" หักส่วนลด
    -- (v_margin_actual_blended คิดจากราคา/ต้นทุนจริงต่อชิ้นทุกรายการที่คำนวณ
    -- ได้จาก oem_price_calc ตรงๆ ไม่ผ่านส่วนลดเลย) ติดลบ = ปฏิเสธเสมอ ไม่ผูก
    -- กับ p_discount_thb (ต่างจาก hard floor รวมทั้งใบด้านล่างที่ requires
    -- p_discount_thb > 0) ไม่มีทางปลดล็อกด้วย p_approval_note เลย — ด่านนี้จับ
    -- เฉพาะ "ฟีดราคาเพี้ยนจนราคาขายต่ำกว่าต้นทุน/ราคารับซื้อคืนของร้านเอง"
    -- (เช่น silver_price_daily สลับคอลัมน์ หรือตลาดพลิกข้ามคืน) ไม่ใช่
    -- "ส่วนลดกัดกำไร" ที่ด่านถัดไปดูแลอยู่แล้ว — คนละปัญหา คนละด่าน ไม่มีทาง
    -- ลัดทั้งคู่ ยืนยันแล้วว่าไม่กระทบใบแท่ง 1 กก. (margin จริง 8.4% เป็นบวก)
    -- และไม่กระทบงานผลิตปกติ (v_m ถูกบังคับให้อยู่ใน [0,1) ที่ oem_price_calc
    -- มาแล้ว margin_actual ของรายการที่คำนวณสำเร็จจึง >= 0 เสมอ)
    if v_margin_actual_blended is not null and v_margin_actual_blended < 0 then
      raise exception 'oem_quote_save: ใบนี้ margin รวมติดลบ (%) — ราคาขายต่ำกว่าต้นทุน/ราคารับซื้อคืนของร้านเอง ไม่มีทางลัด ตรวจราคาฟีดก่อน',
        round(v_margin_actual_blended * 100, 1)::text || '%'
        using errcode = '22023';
    end if;

    -- 0079: hard floor "รวมทั้งใบ" — เติม p_discount_thb > 0 ด่านนี้มีไว้กัน
    -- "ส่วนลดกัดกำไร" ไม่ได้มีไว้กันราคาที่ร้านประกาศเอง (ไม่มีส่วนลด = ไม่มี
    -- อะไรให้กันตรงนี้) ไม่งั้นใบแท่ง 1 กก. (margin จริง 8.4% < hard floor 15%
    -- ตั้งแต่ §2) จะถูกปฏิเสธทั้งที่ไม่ได้ลดราคาสักบาท — ยังคง "คำนวณไม่ได้ =
    -- ตก" (ไม่ใช่ "คำนวณไม่ได้ = ข้าม gate") เมื่อมีส่วนลดจริง
    if p_discount_thb > 0
       and (v_margin_after_discount is null or v_margin_after_discount < v_set.margin_hard_floor_pct) then
      raise exception 'oem_quote_save: ส่วนลด % บาท ทำให้ margin รวมหลังหักส่วนลด % ต่ำกว่า hard floor % — ไม่มีทางลัด ต้องลดส่วนลดหรือปฏิเสธงาน',
        p_discount_thb,
        coalesce(round(v_margin_after_discount * 100, 1)::text || '%', 'คำนวณไม่ได้'),
        round(v_set.margin_hard_floor_pct * 100, 1)::text || '%'
        using errcode = '22023';
    end if;

    -- 0079-fix (แก้จากรอบแรก): note-tier clause แรก (margin รายตัว) ไม่มี
    -- เงื่อนไขเหมือนเดิม (ไม่แตะ) · clause ที่สอง (margin รวมหลังส่วนลด) เดิม
    -- ใช้ "or v_min_margin_charged is null" ซึ่งแปลว่า "ไม่มี item งานผลิตเลย"
    -- — ตัวแทนที่ผิด เพราะเติม item งานผลิตชิ้นเล็ก margin สูงเข้าไปก็ปลดล็อก
    -- ด่านทั้งใบได้ทันที (v_min_margin_charged จะไม่ null อีกต่อไป) แก้เป็น
    -- "or v_has_ungated_item" (ตั้งจริงระหว่าง loop ข้างบน เมื่อ item ไหนก็ตาม
    -- ตรวจ margin รายชิ้นไม่ได้ — ไม่อิงจาก metal='silver999' ตรงๆ เพื่อ
    -- คุ้มครองสินค้าประเภทอื่นที่ตรวจ margin รายชิ้นไม่ได้ในอนาคตอัตโนมัติ)
    -- ด่านรวมทั้งใบเป็นด่านเดียวที่เหลือสำหรับ item แบบนี้ ต้องทำงานเสมอไม่ว่า
    -- ใบจะมี item งานผลิต margin สูงมาช่วยดันค่าเฉลี่ยหรือไม่ก็ตาม · LOW-6:
    -- ข้อความต้องไม่โทษ "ส่วนลด" เมื่อ clause ไฟจากเหตุผลอื่น
    if ((v_min_margin_charged is not null and v_min_margin_charged < v_set.margin_floor_pct)
        or ((p_discount_thb > 0 or v_has_ungated_item) and v_margin_after_discount < v_set.margin_floor_pct))
       and (p_approval_note is null or btrim(p_approval_note) = '') then
      if v_min_margin_charged is not null and v_min_margin_charged < v_set.margin_floor_pct then
        v_note_tier_msg := format('รายการที่ %s — margin ที่คิด %s%% ต่ำกว่า floor %s%% — ต้องใส่เหตุผลก่อนออกใบเสนอราคา',
          v_min_margin_seq, round(v_min_margin_charged * 100, 1), round(v_set.margin_floor_pct * 100, 1));
      elsif p_discount_thb > 0 then
        v_note_tier_msg := format('ส่วนลด %s บาท ทำให้ margin รวมหลังหักส่วนลด %s ต่ำกว่า floor %s%% — ต้องใส่เหตุผลก่อนออกใบเสนอราคา',
          p_discount_thb, coalesce(round(v_margin_after_discount * 100, 1)::text || '%', 'คำนวณไม่ได้'), round(v_set.margin_floor_pct * 100, 1));
      else
        v_note_tier_msg := format('ใบนี้มีรายการที่ระบบตรวจ margin รายชิ้นไม่ได้อยู่ด้วย (เช่น เงินแท่ง) ทำให้ margin รวม %s ต่ำกว่า floor %s%% — ต้องใส่เหตุผลก่อนออกใบเสนอราคา แม้ไม่ได้ลดราคาก็ตาม',
          coalesce(round(v_margin_after_discount * 100, 1)::text || '%', 'คำนวณไม่ได้'), round(v_set.margin_floor_pct * 100, 1));
      end if;
      raise exception 'oem_quote_save: %', v_note_tier_msg using errcode = '22023';
    end if;
  end if;

  v_approved_by := case when p_approval_note is not null and btrim(p_approval_note) <> '' then auth.uid() else null end;

  update analytics.oem_quote set
    input = null,
    calc = null,
    rate_snapshot = jsonb_build_object('formula_version', 2, 'items', v_calc_agg),
    customer_name = coalesce(p_customer_name, customer_name),
    customer_contact = coalesce(p_customer_contact, customer_contact),
    cost_piece = null,
    price_per_piece = null,
    nre_cost = v_nre_cost_sum,
    nre_price = v_nre_price_sum,
    pieces_subtotal = v_pieces_subtotal_sum,
    quote_total = v_quote_total_sum,
    margin_actual_pct = v_margin_actual_blended,
    margin_charged_pct = v_min_margin_charged,
    q_run = v_qrun_sum,
    flask_count = v_flask_count_sum,
    plating_batch_count = v_plate_count_sum,
    status = p_status,
    discount_thb = p_discount_thb,
    discount_reason = p_discount_reason,
    grand_total = v_grand_total,
    margin_after_discount_pct = v_margin_after_discount,
    approval_note = coalesce(p_approval_note, approval_note),
    approved_by = coalesce(v_approved_by, approved_by),
    -- timezone ไทย: กัน 00:00–07:00 ไทยของวันถัดไปที่ current_date (UTC) ยัง
    -- เป็นเมื่อวาน แล้วใบเงินแท่ง (ยืน 0 วัน) ดูเหมือนยังไม่หมดอายุ
    quote_valid_until = case when p_status = 'quoted' then v_bkk_today + v_valid_days else quote_valid_until end,
    updated_by = auth.uid(), updated_at = now()
    -- 0081: deposit_mode/deposit_input ตั้งใจไม่อยู่ใน SET clause นี้เลย —
    -- ทั้งใบใหม่ (ตั้งไปแล้วตอน insert ข้างบน) และใบเก่าที่แก้ (ต้องคงของเดิม
    -- ที่ผู้ใช้เคยตั้งเองไว้ ห้ามทับ) ต่างก็ไม่ต้องการให้ update statement นี้
    -- แตะคอลัมน์นี้
  where id = v_quote_id and shop_id = p_shop_id;

  return v_quote_id;
end;
$function$;

revoke execute on function analytics.oem_quote_save(uuid, jsonb, uuid, text, text, text, text, numeric, text) from public, anon;
grant execute on function analytics.oem_quote_save(uuid, jsonb, uuid, text, text, text, text, numeric, text) to authenticated, service_role;

-- ============================================================================
-- 3. oem_quote_renegotiate — arg list เดิม 4 ตัวเป๊ะ = plain replace · เติม 2
--    จุด:
--      (§1a) hard floor เด็ดขาด — v_old.margin_actual_pct ติดลบ = ปฏิเสธเสมอ
--            ไม่ผูกกับ p_new_discount_thb ไม่ปลดล็อกด้วย p_reason (renegotiate
--            ไม่รีคำนวณราคา/ต้นทุนต่อชิ้นใหม่เลย มีแต่เปลี่ยนส่วนลด item set
--            เดิมถูกคัดลอกมาตรงๆ — v_old.margin_actual_pct ที่บันทึกไว้ตอน
--            save/renegotiate ครั้งก่อนจึงเป็นค่าเทียบเท่า v_margin_actual_blended
--            ของ save เป๊ะ ไม่ต้องคำนวณซ้ำจาก items)
--      (§3)  vat_mode สืบทอด clamp — ถ้าร้านไม่ได้จด VAT ตอนนี้ (หรือไม่มีแถว
--            oem_setting เลย) ห้ามให้ใบใหม่เกิดเป็น 'breakdown' ไม่ว่าใบแม่จะ
--            เป็นอะไร (ด่าน seller_vat_registered เดิมอยู่ใน
--            oem_quote_set_vat_mode เท่านั้น ไม่ครอบคลุม insert ตรงๆ ของ
--            ฟังก์ชันนี้)
--    ทุกอย่างอื่น (logic/comment ของ 0082 เดิมทั้งหมด รวม vat_rate สืบทอด) คง
--    เดิมเป๊ะ ไม่แตะ
-- ============================================================================

create or replace function analytics.oem_quote_renegotiate(p_shop_id uuid, p_quote_id uuid, p_new_discount_thb numeric, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $function$
declare
  v_old analytics.oem_quote%rowtype;
  v_set analytics.oem_setting%rowtype;
  v_new_id uuid;
  v_new_no text;
  v_i int;
  v_price_ex_gold_sum numeric := 0;
  v_cost_ex_gold_sum numeric := 0;
  v_margin_after numeric;
  v_valid_days int;
  v_row record;
  v_new_grand_total numeric;
  v_jobvalue_min numeric;
  v_has_items boolean := false;
  -- ---- silver999 (bar) ----
  v_bkk_today date;
  v_has_bar_item boolean := false;
  v_production_total_sum numeric := 0;
  -- 0079-fix: เหมือน v_has_ungated_item ใน oem_quote_save — true เมื่อ item
  -- ใดก็ตามใน loop มี margin_charged_pct เป็น null (ตรวจ margin รายชิ้นไม่ได้)
  v_has_ungated_item boolean := false;
  -- ---- 0081: มัดจำที่ใบใหม่จะสืบทอด (ก่อน clamp/เคลียร์) ----
  v_new_deposit_mode text;
  v_new_deposit_input numeric;
  -- ---- 0083: vat_mode ที่ใบใหม่จะสืบทอด (ก่อน clamp กันร้านที่เลิกจด VAT) ----
  v_new_vat_mode text;
begin
  if p_shop_id is null or p_quote_id is null then
    raise exception 'oem_quote_renegotiate: p_shop_id and p_quote_id are required';
  end if;
  if p_new_discount_thb is null or p_new_discount_thb < 0 then
    raise exception 'oem_quote_renegotiate: p_new_discount_thb must be >= 0';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  -- timezone ไทย เสมอ — ใช้เช็คหมดอายุและตั้ง valid_until ของใบใหม่
  v_bkk_today := (now() at time zone 'Asia/Bangkok')::date;

  select * into v_old from analytics.oem_quote where id = p_quote_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'oem_quote_renegotiate: quote % not found for this shop', p_quote_id;
  end if;
  if v_old.status <> 'quoted' then
    raise exception 'oem_quote_renegotiate: ต่อรองราคาได้เฉพาะใบสถานะ quoted เท่านั้น (ใบนี้สถานะ %)', v_old.status
      using errcode = '22023';
  end if;
  if v_old.quote_valid_until is null or v_old.quote_valid_until < v_bkk_today then
    raise exception 'oem_quote_renegotiate: ใบเสนอราคาหมดอายุแล้ว ต่อรองราคาไม่ได้ — ออกใบใหม่แทน' using errcode = '22023';
  end if;

  select * into v_set from analytics.oem_setting where shop_id = p_shop_id;
  if v_set.shop_id is null then
    -- LOW: fallback ต้อง seed ให้ครบทุกค่าที่ฟังก์ชันนี้อ่าน ไม่งั้น gate หายเงียบ
    v_set.margin_floor_pct := 0.20; v_set.margin_hard_floor_pct := 0.15;
    v_set.nre_max_share_pct := 0.25; v_set.min_job_value_thb := 8000;
    v_set.quote_valid_days_silver := 30; v_set.quote_valid_days_gold := 7; v_set.quote_valid_days_brass := 45;
    v_set.bar_margin_pct := 0.19;
  end if;

  -- 0083: hard floor เด็ดขาด (§1a) — margin รวมทั้งใบ "ก่อน" หักส่วนลด ติดลบ =
  -- ปฏิเสธเสมอ (เหมือน oem_quote_save §0083 แต่ renegotiate ไม่รีคำนวณ
  -- price_piece/cost_piece ต่อชิ้นใหม่เลย มีแต่เปลี่ยนส่วนลด item set เดิมทั้ง
  -- ชุดถูกคัดลอกมาตรงๆ ทีหลัง (ดู insert oem_quote_item ท้ายฟังก์ชัน) —
  -- v_old.margin_actual_pct ที่บันทึกไว้ตอน save/renegotiate ครั้งก่อนจึงเป็น
  -- ค่าเทียบเท่า v_margin_actual_blended ของ oem_quote_save เป๊ะ ไม่ต้องคำนวณ
  -- ซ้ำจาก items) ไม่ผูกกับ p_new_discount_thb ไม่ปลดล็อกด้วย p_reason —
  -- ยืนยันแล้วว่าไม่กระทบใบแท่ง 1 กก. (margin จริง 8.4%) และไม่กระทบงานผลิต
  -- ปกติ — เช็คได้ทันทีตรงนี้เลย ไม่ต้องรอ loop items ด้านล่าง
  if v_old.margin_actual_pct is not null and v_old.margin_actual_pct < 0 then
    raise exception 'oem_quote_renegotiate: ใบนี้ margin รวมติดลบ (%) — ราคาขายต่ำกว่าต้นทุน/ราคารับซื้อคืนของร้านเอง ไม่มีทางลัด ตรวจราคาฟีดตอนออกใบเดิมก่อน',
      round(v_old.margin_actual_pct * 100, 1)::text || '%'
      using errcode = '22023';
  end if;

  for v_row in select * from analytics.oem_quote_item where quote_id = v_old.id order by seq loop
    v_has_items := true;
    if (v_row.input->>'metal') = 'silver999' then
      v_has_bar_item := true;
    end if;
    if (v_row.input->>'metal') = 'gold' then
      v_price_ex_gold_sum := v_price_ex_gold_sum + coalesce(v_row.item_total, 0)
                              - coalesce((v_row.calc->'breakdown'->'metal'->>'per_piece')::numeric, 0) * v_row.qty;
      v_cost_ex_gold_sum := v_cost_ex_gold_sum + coalesce(v_row.cost_piece, 0) * v_row.qty
                             - coalesce((v_row.calc->'breakdown'->'metal'->>'per_piece')::numeric, 0) * v_row.qty;
    else
      v_price_ex_gold_sum := v_price_ex_gold_sum + coalesce(v_row.item_total, 0);
      v_cost_ex_gold_sum := v_cost_ex_gold_sum + coalesce(v_row.cost_piece, 0) * v_row.qty;
    end if;

    -- ด่านมูลค่างานขั้นต่ำ (production-only): คิดจาก items จริงในลูปนี้ ห้ามใช้
    -- v_old.quote_total (รวมมูลค่าแท่งด้วย)
    if (v_row.input->>'metal') <> 'silver999' then
      v_production_total_sum := v_production_total_sum + coalesce(v_row.item_total, 0);
    end if;

    -- 0079-fix: item นี้ระบบตรวจ margin รายชิ้นไม่ได้ (บันทึกไว้ตอน save เป็น
    -- margin_charged_pct = null) — เช็คจากค่า ไม่เช็คจาก metal ตรงๆ
    if v_row.margin_charged_pct is null then
      v_has_ungated_item := true;
    end if;

    v_valid_days := least(
      coalesce(v_valid_days, 9999),
      case (v_row.input->>'metal')
        when 'gold' then coalesce(v_set.quote_valid_days_gold, 7)
        when 'brass' then coalesce(v_set.quote_valid_days_brass, 45)
        when 'silver999' then 0
        else coalesce(v_set.quote_valid_days_silver, 30)
      end
    );
  end loop;
  -- LOW: ใช้ตัวแปรของตัวเอง ไม่พึ่ง found หลัง loop (found = ผลของคำสั่งสุดท้าย)
  if not v_has_items then
    raise exception 'oem_quote_renegotiate: ใบ % ไม่มีรายการ ต่อราคาไม่ได้', p_quote_id using errcode = '22023';
  end if;
  v_production_total_sum := v_production_total_sum + coalesce(v_old.nre_price, 0);

  -- C1: guard เดียวกับ save
  if p_new_discount_thb > 0 and p_new_discount_thb >= v_price_ex_gold_sum then
    raise exception 'oem_quote_renegotiate: ส่วนลดใหม่ % บาท มากกว่าหรือเท่ากับมูลค่างานส่วนที่คิดกำไรได้ (% บาท) — ไม่มีทางลัด',
      p_new_discount_thb, round(v_price_ex_gold_sum, 2)
      using errcode = '22023';
  end if;

  -- H1: ด่านมูลค่างานขั้นต่ำ — มี item เงินแท่ง -> ดูเฉพาะมูลค่างานผลิต (ก่อนหัก
  -- ส่วนลด) ข้ามถ้า = 0 (ใบแท่งล้วน) · ไม่มี item เงินแท่ง -> พฤติกรรมเดิมเป๊ะ
  v_new_grand_total := coalesce(v_old.quote_total, 0) - p_new_discount_thb;
  v_jobvalue_min := greatest(
    coalesce(v_set.min_job_value_thb, 8000),
    case when coalesce(v_old.nre_cost, 0) > 0
         then v_old.nre_cost / coalesce(v_set.nre_max_share_pct, 0.25) else 0 end
  );
  if v_has_bar_item then
    if v_production_total_sum > 0 and v_production_total_sum < v_jobvalue_min then
      raise exception 'oem_quote_renegotiate: มูลค่างานส่วนที่เป็นงานผลิต (% บาท) ต่ำกว่าเกณฑ์ขั้นต่ำ % บาท — ต่อราคาไม่ได้ (ใบเงินแท่งล้วนไม่ติดด่านนี้)',
        v_production_total_sum, v_jobvalue_min using errcode = '22023';
    end if;
  else
    if v_new_grand_total < v_jobvalue_min then
      raise exception 'oem_quote_renegotiate: ส่วนลดใหม่ทำให้มูลค่างานรวม (%) ต่ำกว่าเกณฑ์ขั้นต่ำ % บาท — ต่อราคาไม่ได้',
        v_new_grand_total, v_jobvalue_min
        using errcode = '22023';
    end if;
  end if;

  v_margin_after := case when (v_price_ex_gold_sum - p_new_discount_thb) > 0
    then round(((v_price_ex_gold_sum - p_new_discount_thb) - v_cost_ex_gold_sum) / (v_price_ex_gold_sum - p_new_discount_thb), 4) end;

  -- 0079: เติม p_new_discount_thb > 0 เหตุผลเดียวกับ save — ด่านนี้กันส่วนลด
  -- กัดกำไร ไม่ใช่กันราคาที่ร้านประกาศเอง (ใบแท่ง 1 กก. margin จริง 8.4% ต่ำ
  -- กว่า hard floor 15% ได้แม้ p_new_discount_thb = 0 ถ้าไม่กันจะปฏิเสธการ
  -- ต่อราคาที่ไม่มีส่วนลดเลย)
  if p_new_discount_thb > 0
     and (v_margin_after is null or v_margin_after < v_set.margin_hard_floor_pct) then
    raise exception 'oem_quote_renegotiate: ส่วนลดใหม่ % บาท ทำให้ margin % ต่ำกว่า hard floor % — ไม่มีทางลัด',
      p_new_discount_thb,
      coalesce(round(v_margin_after * 100, 1)::text || '%', 'คำนวณไม่ได้'),
      round(v_set.margin_hard_floor_pct * 100, 1)::text || '%'
      using errcode = '22023';
  end if;

  -- 0079-fix (แก้จากรอบแรก): note-tier — เดิมใช้ "v_old.margin_charged_pct is
  -- null" (= "ใบเดิมไม่มี item งานผลิตเลย") เป็นตัวแทนที่ผิดเหมือน §3: เติม
  -- item งานผลิตชิ้นเล็ก margin สูงเข้าไปตอน save ก็ทำให้ v_old.margin_charged_pct
  -- ไม่ null แล้วปลดล็อกด่านทั้งใบตอน renegotiate ได้ทันที ทั้งที่มูลค่าส่วน
  -- ใหญ่ยังเป็นแท่ง margin บางเท่าเดิม — แก้เป็น v_has_ungated_item (ตั้งจริง
  -- ระหว่าง loop items ด้านบน จาก v_row.margin_charged_pct รายตัว ไม่ใช่ค่า
  -- MIN รวมทั้งใบ) ด่านรวมทั้งใบเป็นด่านเดียวที่เหลือสำหรับ item แบบนี้ ต้อง
  -- ทำงานเสมอไม่ว่าใบจะมี item งานผลิต margin สูงมาช่วยดันค่าเฉลี่ยหรือไม่ก็ตาม
  -- · LOW-6: ข้อความต้องไม่โทษ "ส่วนลด" เมื่อ clause ไฟจากเหตุผลอื่น
  if (p_new_discount_thb > 0 or v_has_ungated_item)
     and v_margin_after < v_set.margin_floor_pct
     and (p_reason is null or btrim(p_reason) = '') then
    if p_new_discount_thb > 0 then
      raise exception 'oem_quote_renegotiate: ส่วนลดใหม่ % บาท ทำให้ margin รวม % ต่ำกว่า floor % — ต้องระบุเหตุผล',
        p_new_discount_thb, coalesce(round(v_margin_after * 100, 1)::text || '%', 'คำนวณไม่ได้'),
        round(v_set.margin_floor_pct * 100, 1)::text || '%'
        using errcode = '22023';
    else
      raise exception 'oem_quote_renegotiate: ใบนี้มีรายการที่ระบบตรวจ margin รายชิ้นไม่ได้อยู่ด้วย (เช่น เงินแท่ง) ทำให้ margin รวม % ต่ำกว่า floor % — ต้องระบุเหตุผล แม้ไม่ได้ลดราคาก็ตาม',
        coalesce(round(v_margin_after * 100, 1)::text || '%', 'คำนวณไม่ได้'), round(v_set.margin_floor_pct * 100, 1)::text || '%'
        using errcode = '22023';
    end if;
  end if;

  -- 0081: ใบใหม่สืบทอดเงื่อนไขมัดจำจากใบแม่ (v_old) เสมอ — เงื่อนไขที่ตกลงกัน
  -- ไว้ไม่ควรหายตอนต่อราคา ยกเว้นโหมด thb ที่ยอดมัดจำเดิม "มากกว่า" grand_total
  -- ใหม่ ต้อง clamp ลงมาเท่ากับ grand_total ใหม่ (ดูคอมเมนต์หัวฟังก์ชันสำหรับ
  -- ผลข้างเคียงที่ตั้งใจปล่อยให้เห็น + เคสขอบ grand_total ใหม่ <= 0)
  v_new_deposit_mode := v_old.deposit_mode;
  v_new_deposit_input := v_old.deposit_input;
  if v_new_deposit_mode = 'thb' and v_new_deposit_input is not null then
    if v_new_grand_total <= 0 then
      v_new_deposit_mode := null;
      v_new_deposit_input := null;
    elsif v_new_deposit_input > v_new_grand_total then
      v_new_deposit_input := v_new_grand_total;
    end if;
  end if;

  -- 0083 (§3): ใบใหม่สืบทอด vat_mode จากใบแม่เหมือนเดิม (0075) แต่ต้อง clamp
  -- ก่อน insert — ถ้าร้านไม่ได้จด VAT ตอนนี้ (v_set.seller_vat_registered
  -- false หรือไม่มีแถว oem_setting เลย → coalesce เป็น false) ห้ามให้ใบใหม่
  -- เกิดเป็น 'breakdown' ไม่ว่าใบแม่จะเป็นอะไรก็ตาม — เคสจริง: ร้านเคยจด VAT
  -- ตอนออกใบแม่เป็น breakdown แล้วยกเลิกสถานะจด VAT ก่อนมีคนมาต่อราคาใบนั้น
  -- ด่าน seller_vat_registered เดิม (0082 §4) อยู่ใน oem_quote_set_vat_mode
  -- เท่านั้น ไม่ครอบคลุม insert ตรงๆ ของฟังก์ชันนี้ ต้อง clamp เองตรงนี้
  v_new_vat_mode := v_old.vat_mode;
  if v_new_vat_mode = 'breakdown' and not coalesce(v_set.seller_vat_registered, false) then
    v_new_vat_mode := 'included';
  end if;

  for v_i in 1..5 loop
    v_new_no := analytics.oem_quote_next_no(p_shop_id);
    v_new_id := gen_random_uuid();
    begin
      insert into analytics.oem_quote (
        id, shop_id, quote_no, customer_name, customer_contact, input, calc, rate_snapshot,
        cost_piece, price_per_piece, nre_cost, nre_price, pieces_subtotal, quote_total,
        margin_actual_pct, margin_charged_pct, q_run, flask_count, plating_batch_count,
        status, discount_thb, discount_reason, grand_total, margin_after_discount_pct,
        parent_quote_id, root_quote_id, customer_id, vat_mode, vat_rate,
        deposit_mode, deposit_input,
        quote_valid_until, created_by, updated_by
      ) values (
        v_new_id, v_old.shop_id, v_new_no, v_old.customer_name, v_old.customer_contact, null, null, v_old.rate_snapshot,
        v_old.cost_piece, v_old.price_per_piece, v_old.nre_cost, v_old.nre_price, v_old.pieces_subtotal, v_old.quote_total,
        v_old.margin_actual_pct, v_old.margin_charged_pct, v_old.q_run, v_old.flask_count, v_old.plating_batch_count,
        'quoted', p_new_discount_thb, p_reason, v_new_grand_total, v_margin_after,
        v_old.id, coalesce(v_old.root_quote_id, v_old.id), v_old.customer_id, v_new_vat_mode, v_old.vat_rate,
        v_new_deposit_mode, v_new_deposit_input,
        v_bkk_today + coalesce(v_valid_days, v_set.quote_valid_days_silver, 30), auth.uid(), auth.uid()
      );
      exit;
    exception when unique_violation then
      if v_i = 5 then
        raise exception 'oem_quote_renegotiate: ออกเลขที่ใบใหม่ไม่สำเร็จ ลองใหม่อีกครั้ง';
      end if;
    end;
  end loop;

  insert into analytics.oem_quote_item (
    shop_id, quote_id, seq, product_id, sku_snapshot, product_name_snapshot,
    input, calc, qty, cost_piece, price_per_piece, item_total,
    q_run, flask_count, plating_batch_count, margin_charged_pct
  )
  select
    shop_id, v_new_id, seq, product_id, sku_snapshot, product_name_snapshot,
    input, calc, qty, cost_piece, price_per_piece, item_total,
    q_run, flask_count, plating_batch_count, margin_charged_pct
  from analytics.oem_quote_item
  where quote_id = v_old.id
  order by seq;

  update analytics.oem_quote set status = 'superseded', updated_by = auth.uid(), updated_at = now()
  where id = v_old.id;

  return v_new_id;
end;
$function$;

revoke execute on function analytics.oem_quote_renegotiate(uuid, uuid, numeric, text) from public, anon;
grant execute on function analytics.oem_quote_renegotiate(uuid, uuid, numeric, text) to authenticated, service_role;

notify pgrst, 'reload schema';
