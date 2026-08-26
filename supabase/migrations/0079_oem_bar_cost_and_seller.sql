-- 0079_oem_bar_cost_and_seller.sql
-- แก้ 2 ปัญหาจากรีวิวจริงของเจ้าของ + ย้ายข้อมูลร้านเข้า DB
--
-- ============ ปัญหาหลัก — bar_margin_pct ไม่ตรงของจริง และเป็นคันโยกอันตราย ============
-- ยิง query เช็คของจริง 25 ส.ค. แล้ว สมมติฐานเดิม "margin 19% เท่ากันทุกขนาด"
-- ผิด — แท่ง 1 กก. ส่วนต่างจริงแค่ 8.4% (ขาย 78,966 รวม VAT / รับซื้อคืน
-- 72,300) ไม่ใช่ 19% ตามที่ 0078 สมมติไว้ ต้นทุนอนุมานเดิม (63,962) ต่ำกว่า
-- มูลค่าเนื้อเงินที่ร้านรับซื้อคืนเอง (72,300) แปลว่าระบบเชื่อว่ามีกำไรให้ลด
-- 19% ทั้งที่จริงมีไม่ถึงครึ่ง — ถ้าเจ้าของลดราคาแท่ง 1 กก. 10% ระบบจะอนุมัติ
-- ผ่านทั้งที่ขาดทุน
--
-- security ยังทดสอบยืนยันด้วยว่า bar_margin_pct เป็นคันโยกที่ตั้งเป็น 0.90
-- ผ่าน UI ได้ แล้วปลดอาวุธด่านส่วนลดทั้งชุด (ยิงเข้าจริง: ตั้ง 0.90 →
-- ต้นทุนอนุมานเหลือ 7,896 → ลดได้ถึง 69,675 บาทโดยไม่ต้องใส่เหตุผล)
--
-- แก้ (branch silver999 ของ oem_price_calc): เลิกอนุมานต้นทุนจาก
-- bar_margin_pct เป็นฐานหลัก เปลี่ยนไปใช้ราคารับซื้อคืนจริงจากแถวฟีดวันเดียวกัน
-- (buy_per_baht × น้ำหนักขนาด / kilo_buy) แทน — bar_margin_pct เหลือบทบาทแค่
-- fallback (มีเฉพาะแถวกรอกมือที่ไม่มีราคารับซื้อคืน) + ใส่ warning บอกว่ากำลัง
-- ใช้ค่าประมาณ + เติม constraint ชั้นสอง (bar_margin_pct <= margin_target_pct)
-- กันตั้งเพี้ยนแบบ 0.90 อีก
--
-- ผลพวงที่ต้องแก้คู่กัน: พอต้นทุนมาจากราคารับซื้อคืนจริง แท่ง 1 กก. จะได้
-- margin 8.4% < hard floor 15% ของระบบ → ด่าน hard floor/note-tier "รวมทั้งใบ"
-- (ที่ไม่มีเงื่อนไขมาตั้งแต่ 0078) จะปฏิเสธใบแท่ง 1 กก. ทั้งที่ไม่ได้ลดราคาสัก
-- บาท — เติมเงื่อนไข p_discount_thb > 0 ให้ด่านรวมทั้งใบเท่านั้น (มีไว้กัน
-- "ส่วนลดกัดกำไร" ไม่ได้มีไว้กันราคาที่ร้านประกาศเอง) ส่วนด่าน hard floor/floor
-- ระดับรายชิ้น (v_min_margin_charged, คุ้มครองงานผลิต) "ไม่แตะ" ตามที่สั่ง —
-- ดู oem_quote_save/oem_quote_renegotiate ด้านล่าง (§3-4)
--
-- ⚠️ รอบรีวิวแรกของ note-tier ผ่อนด่านโดยใช้เงื่อนไข "v_min_margin_charged is
-- null" (= "ใบนี้ไม่มี item งานผลิตเลย") ซึ่งเป็นช่องโหว่จริง: เติม item
-- งานผลิตชิ้นเล็ก margin สูงเข้าไปใบเดียวก็ปลดล็อกใบแท่งมูลค่าหลักหมื่นให้ไม่
-- ต้องมี approval note ได้ทันที — พบระหว่างรีวิวและแก้ในไฟล์นี้แล้วก่อนส่งมอบ
-- (ไม่ปล่อยผ่านไปเป็น 0080) เปลี่ยนมาใช้ v_has_ungated_item ที่ตั้งจริงระหว่าง
-- loop items จาก "margin_charged เป็น null รายตัว" แทน — ดู comment ละเอียดที่
-- §3/§4 ตรง note-tier
--
-- ============ H (Postgres NaN gap) — engrave_*_thb เช็คแค่ "< 0" ไม่ดัก NaN ============
-- Postgres ถือว่า 'NaN'::numeric มากกว่าทุกค่ารวมทั้ง infinity จึงไหลผ่าน
-- "< 0" ไปได้เงียบๆ แล้วไปพังเลขคำนวณต่อ (NaN บวก/คูณอะไรก็ NaN, ผลคือ
-- cost_piece/price_piece กลายเป็น NaN ทั้งใบ) แก้เป็น range check
-- (>= 0 and <= 1,000,000) — not(between) จับ NaN ให้ฟรีเพราะเทียบกับ NaN
-- คืน false เสมอ ทำให้ not() เป็น true
--
-- ============ ย้ายข้อมูลร้านเข้า DB ============
-- lib/oem/sellerProfile.ts เดิมเป็นไฟล์โค้ด เจ้าของกรอกเองไม่ได้ ต้องรอ dev
-- แก้ทุกครั้ง — เพิ่มคอลัมน์ seller_* ใน oem_setting (ร้านเดียว 1 แถวอยู่แล้ว)
-- + ขยาย oem_setting_upsert ให้เซฟจบใน RPC เดียว (ของเดิมฝั่งแอปเขียน 2 ครั้ง
-- แยก transaction กันได้ = เซฟครึ่งเดียวได้แต่หน้าจอบอกว่าล้มเหลว) + view
-- v_oem_seller ใหม่ให้ฝั่งแอปอ่านตอน render หน้าพิมพ์ (ดูเหตุผลที่แยก view
-- ไม่ append v_oem_quote ที่ §7)
--
-- อ่านคู่กับ 0078 (bar quote), 0076 (gates), 0072/0074 (silver_price_daily),
-- 0061 (oem_setting + oem_setting_upsert เดิม)

-- ============================================================================
-- 1. bar_margin_pct — comment ใหม่ให้ตรงบทบาท (fallback เท่านั้น) + constraint
--    ชั้นสอง กันตั้งค่าให้สูงกว่า margin_target_pct (คันโยกปลดอาวุธด่านส่วนลด
--    ที่ security ยิงเข้าจริงด้วย 0.90) — clamp ข้อมูลเก่าก่อนตั้ง constraint
--    เผื่อมีค่าที่หลุดผ่านมาจากการทดสอบ ไม่งั้น migration จะพังที่ constraint
--    โดยไม่รู้ว่าห้องไหนเพี้ยน
-- ============================================================================

-- raise notice ทีละแถวก่อน update จริง — เห็นชัดตอนรัน migration ว่ามีค่าเพี้ยน
-- ค้างอยู่จริงไหม (ไม่ใช่แค่นับจำนวน) ตาม shop_id + ค่าเก่า/ค่าใหม่
do $$
declare
  v_row record;
  v_clamped_count int := 0;
begin
  for v_row in
    select shop_id, bar_margin_pct as old_value, margin_target_pct as new_value
    from analytics.oem_setting
    where bar_margin_pct > margin_target_pct
  loop
    v_clamped_count := v_clamped_count + 1;
    raise notice '0079: clamp oem_setting.bar_margin_pct shop_id=% % -> % (เกิน margin_target_pct)',
      v_row.shop_id, v_row.old_value, v_row.new_value;
  end loop;

  if v_clamped_count > 0 then
    update analytics.oem_setting
      set bar_margin_pct = margin_target_pct, updated_at = now()
      where bar_margin_pct > margin_target_pct;
    raise notice '0079: clamp bar_margin_pct รวม % แถว (มีค่าเพี้ยนค้างอยู่จริง — ตรวจว่ามาจากไหน เช่น การทดสอบตั้ง 0.90 ที่ security ยิงเข้าจริง)', v_clamped_count;
  else
    raise notice '0079: ตรวจ oem_setting.bar_margin_pct ทุกแถวแล้ว ไม่มีค่าเกิน margin_target_pct (ไม่ต้อง clamp)';
  end if;
end $$;

comment on column analytics.oem_setting.bar_margin_pct is
  '0079: FALLBACK เท่านั้น — ใช้อนุมานต้นทุนเงินแท่งเฉพาะแถว silver_price_daily ที่ไม่มีราคารับซื้อคืน (buy_per_baht/kilo_buy เป็น null มักเป็นแถวกรอกมือ) ฐานหลักตอนนี้คือราคารับซื้อคืนจริงจากฟีด (ดู oem_price_calc branch silver999) ไม่รับค่านี้จาก client เด็ดขาด — ถ้ารับจาก client จะปลอมค่าเพื่อเลี่ยง gate ได้ (ยืนยันแล้วว่ายิงเข้าจริงตอน 0.90)';

alter table analytics.oem_setting drop constraint if exists oem_setting_bar_margin_le_target;
alter table analytics.oem_setting add constraint oem_setting_bar_margin_le_target
  check (bar_margin_pct <= margin_target_pct);

-- ============================================================================
-- 2. oem_price_calc — branch silver999: ต้นทุนเนื้อแท่งจากราคารับซื้อคืนจริง
--    (แทน bar_margin_pct) + engrave NaN/Infinity guard · signature เดิมเป๊ะ
--    (uuid, jsonb) = plain replace ไม่ต้อง drop · branch งานผลิตเดิม
--    (silver/gold/brass) ไม่ถูกแตะแม้แต่บรรทัดเดียว
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
  -- งานผลิตเดิม (silver/gold/brass) — ไม่แตะแม้แต่บรรทัดเดียวจาก 0066
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
  if v_weight_g is null or v_weight_g <= 0 then
    raise exception 'oem_price_calc: p_input.weight_g must be > 0';
  end if;
  v_is_new_design := coalesce((p_input->>'is_new_design')::boolean, true);
  v_as_of := coalesce((p_input->>'as_of_date')::date, current_date);
  v_plating_type := nullif(btrim(p_input->>'plating_type'), '');
  v_gem_tier := nullif(btrim(p_input->>'gem_tier'), '');
  v_gem_count := coalesce(nullif(p_input->>'gem_count', '')::numeric, 0);
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
-- 3. oem_quote_save — arg list เดิม 9 ตัวเป๊ะ (ฐาน = 0078) แก้เฉพาะด่าน
--    "รวมทั้งใบ" 2 จุด ตามผลพวงของ §2 (ไม่แตะด่านรายชิ้น v_min_margin_charged
--    เลยสักบรรทัด):
--      (a) hard floor aggregate: เติม p_discount_thb > 0 — ด่านนี้มีไว้กัน
--          "ส่วนลดกัดกำไร" ไม่ได้มีไว้กันราคาที่ร้านประกาศเอง (ไม่มีส่วนลด =
--          ไม่มีอะไรให้กันตรงนี้) ไม่งั้นใบแท่ง 1 กก. (margin จริง 8.4% <
--          hard floor 15%) จะถูกปฏิเสธทั้งที่ไม่ได้ลดราคาสักบาท
--      (b) note-tier aggregate sub-condition: จาก "p_discount_thb > 0" เป็น
--          "(p_discount_thb > 0 or v_has_ungated_item)" — v_has_ungated_item
--          ตั้งจริงระหว่าง loop items เมื่อเจอ item ที่ floors.margin.value
--          เป็น null (ระบบตรวจ margin รายชิ้นไม่ได้ ปัจจุบันมีแค่ silver999
--          แต่เช็คจากค่า ไม่ใช่ metal='silver999' ตรงๆ) ด่านรวมทั้งใบเป็นด่าน
--          เดียวที่เหลือสำหรับ item แบบนี้ ต้องทำงานเสมอไม่ว่าใบจะมี item
--          งานผลิต margin สูงมาช่วยดันค่าเฉลี่ยหรือไม่ก็ตาม
--
--          ⚠️ เดิมเคยใช้ "v_min_margin_charged is null" (= "ไม่มี item
--          งานผลิตเลย") แทน — เป็นตัวแทนที่ผิด: เติม item งานผลิตชิ้นเล็ก
--          margin สูงเข้าไปก็ปลดล็อกด่านทั้งใบได้ทันที (v_min_margin_charged
--          ไม่ null อีกต่อไป ทั้งที่มูลค่าส่วนใหญ่ของใบยังเป็นแท่ง margin บาง
--          เท่าเดิม) — พบระหว่างรีวิว แก้เป็น v_has_ungated_item ก่อน apply จริง
--    LOW-6: ข้อความ error/note-tier ต้องไม่โทษ "ส่วนลด" เมื่อ clause ไฟจาก
--    เหตุผลอื่น (มี item ที่ตรวจ margin รายชิ้นไม่ได้) — แยกข้อความตามสาเหตุจริง
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
          rate_snapshot, status, created_by, updated_by
        ) values (
          v_quote_id, p_shop_id, v_quote_no, v_quote_id, p_customer_name, p_customer_contact,
          '[]'::jsonb, 'draft', auth.uid(), auth.uid()
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
  where id = v_quote_id and shop_id = p_shop_id;

  return v_quote_id;
end;
$function$;

revoke execute on function analytics.oem_quote_save(uuid, jsonb, uuid, text, text, text, text, numeric, text) from public, anon;
grant execute on function analytics.oem_quote_save(uuid, jsonb, uuid, text, text, text, text, numeric, text) to authenticated, service_role;

-- ============================================================================
-- 4. oem_quote_renegotiate — arg list เดิม 4 ตัวเป๊ะ (ฐาน = 0078) ชุดเดียวกัน
--    กับ §3: เติม p_new_discount_thb > 0 ให้ hard floor aggregate + เติม
--    "or v_has_ungated_item" ให้ note-tier aggregate — ฟังก์ชันนี้ loop
--    oem_quote_item ของใบเดิมอยู่แล้ว (เพื่อคำนวณ v_price_ex_gold_sum) จึง
--    ตั้ง v_has_ungated_item := true ระหว่าง loop นั้นทันทีที่เจอ item ที่
--    v_row.margin_charged_pct is null (ระบบตรวจ margin รายชิ้นไม่ได้ตอน save
--    — เช็คจากค่าที่บันทึกไว้จริง ไม่ใช่ metal='silver999' ตรงๆ) เหมือน §3
--    ทุกประการ (ไม่ใช้ v_old.margin_charged_pct ซึ่งเป็นค่า MIN รวมทั้งใบ —
--    เจอปัญหาเดียวกับ v_min_margin_charged is null ใน §3: เติม item margin
--    สูงเข้าไปก็ทำให้ v_old.margin_charged_pct ไม่ null ปลดล็อกด่านไปด้วย)
--    ฟังก์ชันนี้ไม่มี item-level hard floor gate อยู่แล้ว (ไม่มีอะไรให้
--    "ไม่แตะ" ตรงนั้น)
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

  for v_i in 1..5 loop
    v_new_no := analytics.oem_quote_next_no(p_shop_id);
    v_new_id := gen_random_uuid();
    begin
      insert into analytics.oem_quote (
        id, shop_id, quote_no, customer_name, customer_contact, input, calc, rate_snapshot,
        cost_piece, price_per_piece, nre_cost, nre_price, pieces_subtotal, quote_total,
        margin_actual_pct, margin_charged_pct, q_run, flask_count, plating_batch_count,
        status, discount_thb, discount_reason, grand_total, margin_after_discount_pct,
        parent_quote_id, root_quote_id, customer_id, vat_mode,
        quote_valid_until, created_by, updated_by
      ) values (
        v_new_id, v_old.shop_id, v_new_no, v_old.customer_name, v_old.customer_contact, null, null, v_old.rate_snapshot,
        v_old.cost_piece, v_old.price_per_piece, v_old.nre_cost, v_old.nre_price, v_old.pieces_subtotal, v_old.quote_total,
        v_old.margin_actual_pct, v_old.margin_charged_pct, v_old.q_run, v_old.flask_count, v_old.plating_batch_count,
        'quoted', p_new_discount_thb, p_reason, v_new_grand_total, v_margin_after,
        v_old.id, coalesce(v_old.root_quote_id, v_old.id), v_old.customer_id, v_old.vat_mode,
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

-- ============================================================================
-- 5. seller_* — ข้อมูลร้าน (ผู้ออกใบเสนอราคา) ย้ายจาก lib/oem/sellerProfile.ts
--    เข้า oem_setting (ร้านเดียว 1 แถวอยู่แล้ว ไม่ต้องสร้างตารางใหม่) — เจ้าของ
--    กรอกผ่านหน้าจอได้เองแทนที่จะรอ dev แก้ไฟล์โค้ดทุกครั้ง
-- ============================================================================

alter table analytics.oem_setting
  add column if not exists seller_legal_name text,
  add column if not exists seller_display_name text,
  add column if not exists seller_branch_label text,
  add column if not exists seller_address_lines jsonb,
  add column if not exists seller_tax_id text,
  add column if not exists seller_vat_registered boolean not null default false,
  add column if not exists seller_phone text,
  add column if not exists seller_line text,
  add column if not exists seller_email text,
  add column if not exists seller_website text,
  add column if not exists seller_terms jsonb;

alter table analytics.oem_setting drop constraint if exists oem_setting_seller_tax_id_check;
alter table analytics.oem_setting add constraint oem_setting_seller_tax_id_check
  check (seller_tax_id is null or seller_tax_id ~ '^[0-9]{13}$');

alter table analytics.oem_setting drop constraint if exists oem_setting_seller_address_lines_array_check;
alter table analytics.oem_setting add constraint oem_setting_seller_address_lines_array_check
  check (seller_address_lines is null or jsonb_typeof(seller_address_lines) = 'array');

alter table analytics.oem_setting drop constraint if exists oem_setting_seller_terms_array_check;
alter table analytics.oem_setting add constraint oem_setting_seller_terms_array_check
  check (seller_terms is null or jsonb_typeof(seller_terms) = 'array');

comment on column analytics.oem_setting.seller_legal_name is
  'ชื่อนิติบุคคล/ร้านตามทะเบียนที่ใช้ออกบิล — 0079: ย้ายจาก lib/oem/sellerProfile.ts ให้เจ้าของกรอกผ่านหน้าจอได้เอง';
comment on column analytics.oem_setting.seller_display_name is
  'ชื่อที่ลูกค้ารู้จัก ใช้เป็นหัวกระดาษใบเสนอราคาถ้าต่างจากชื่อจดทะเบียน (seller_legal_name) — null ได้ ฝั่งแอป fallback เองว่าจะโชว์อะไร';
comment on column analytics.oem_setting.seller_branch_label is
  'สำนักงานใหญ่ / สาขาที่ ... — พิมพ์ใต้ที่อยู่ตามแบบใบกำกับภาษีไทย';
comment on column analytics.oem_setting.seller_address_lines is
  'ที่อยู่จดทะเบียน แยกเป็นบรรทัด (jsonb array ของ string) ปิดท้ายด้วยรหัสไปรษณีย์';
comment on column analytics.oem_setting.seller_tax_id is
  'เลขประจำตัวผู้เสียภาษี 13 หลัก';
comment on column analytics.oem_setting.seller_vat_registered is
  'จด VAT แล้วหรือยัง — false ห้ามพิมพ์ "ราคารวม VAT แล้ว" บนเอกสาร (ผิดกฎหมาย)';
comment on column analytics.oem_setting.seller_terms is
  'เงื่อนไขมาตรฐานพิมพ์ท้ายใบเสนอราคา (jsonb array ของ string บรรทัดละข้อ)';

-- ============================================================================
-- 6. oem_setting_upsert — ขยายให้รับ p_bar_margin_pct + seller_* ทั้งชุด จบใน
--    RPC เดียว (ของเดิมฝั่งแอปเขียน 2 ครั้งแยก transaction กัน = เซฟครึ่งเดียว
--    ได้แต่หน้าจอบอกว่าล้มเหลว) · ทุกพารามิเตอร์ใหม่ default null = ไม่ส่งมา
--    = ไม่แก้ (coalesce กับค่าเดิม)
--
--    ⚠️ กับดัก overload: เปลี่ยน arg list = สร้างฟังก์ชันใหม่ ไม่ใช่แทนที่ —
--    ต้อง drop signature เดิมก่อน (10 พารามิเตอร์: uuid, numeric x6, int x3)
--    แล้ว re-grant ใหม่หลัง create (grant ไม่ติดมาเองข้าม signature)
-- ============================================================================

drop function if exists analytics.oem_setting_upsert(uuid, numeric, numeric, numeric, numeric, numeric, numeric, int, int, int);

create or replace function analytics.oem_setting_upsert(
  p_shop_id uuid,
  p_margin_target_pct numeric default null,
  p_margin_discount_cap_pct numeric default null,
  p_margin_floor_pct numeric default null,
  p_margin_hard_floor_pct numeric default null,
  p_nre_max_share_pct numeric default null,
  p_min_job_value_thb numeric default null,
  p_quote_valid_days_silver int default null,
  p_quote_valid_days_gold int default null,
  p_quote_valid_days_brass int default null,
  p_bar_margin_pct numeric default null,
  p_seller_legal_name text default null,
  p_seller_display_name text default null,
  p_seller_branch_label text default null,
  p_seller_address_lines jsonb default null,
  p_seller_tax_id text default null,
  p_seller_vat_registered boolean default null,
  p_seller_phone text default null,
  p_seller_line text default null,
  p_seller_email text default null,
  p_seller_website text default null,
  p_seller_terms jsonb default null
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
begin
  if p_shop_id is null then
    raise exception 'oem_setting_upsert: p_shop_id is required';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  -- validate ที่ RPC ก่อนแม้ตารางมี check constraint อยู่แล้ว (ชั้นสอง) —
  -- error message ภาษาไทยชัดกว่า constraint violation ดิบๆ ที่ฝั่งแอปต้อง
  -- มาแกะ SQLSTATE เอง
  if p_seller_tax_id is not null and p_seller_tax_id !~ '^[0-9]{13}$' then
    raise exception 'oem_setting_upsert: p_seller_tax_id ต้องเป็นตัวเลข 13 หลัก' using errcode = '22023';
  end if;
  if p_seller_address_lines is not null and jsonb_typeof(p_seller_address_lines) <> 'array' then
    raise exception 'oem_setting_upsert: p_seller_address_lines ต้องเป็น json array' using errcode = '22023';
  end if;
  if p_seller_terms is not null and jsonb_typeof(p_seller_terms) <> 'array' then
    raise exception 'oem_setting_upsert: p_seller_terms ต้องเป็น json array' using errcode = '22023';
  end if;

  insert into analytics.oem_setting as os (
    shop_id, margin_target_pct, margin_discount_cap_pct, margin_floor_pct, margin_hard_floor_pct,
    nre_max_share_pct, min_job_value_thb, quote_valid_days_silver, quote_valid_days_gold, quote_valid_days_brass,
    bar_margin_pct,
    seller_legal_name, seller_display_name, seller_branch_label, seller_address_lines, seller_tax_id, seller_vat_registered,
    seller_phone, seller_line, seller_email, seller_website, seller_terms,
    updated_by, updated_at
  ) values (
    p_shop_id,
    coalesce(p_margin_target_pct, 0.30), coalesce(p_margin_discount_cap_pct, 0.25),
    coalesce(p_margin_floor_pct, 0.20), coalesce(p_margin_hard_floor_pct, 0.15),
    coalesce(p_nre_max_share_pct, 0.25), coalesce(p_min_job_value_thb, 8000),
    coalesce(p_quote_valid_days_silver, 30), coalesce(p_quote_valid_days_gold, 7), coalesce(p_quote_valid_days_brass, 45),
    coalesce(p_bar_margin_pct, 0.19),
    p_seller_legal_name, p_seller_display_name, p_seller_branch_label, p_seller_address_lines, p_seller_tax_id,
    coalesce(p_seller_vat_registered, false),
    p_seller_phone, p_seller_line, p_seller_email, p_seller_website, p_seller_terms,
    auth.uid(), now()
  )
  on conflict (shop_id) do update set
    margin_target_pct       = coalesce(p_margin_target_pct, os.margin_target_pct),
    margin_discount_cap_pct = coalesce(p_margin_discount_cap_pct, os.margin_discount_cap_pct),
    margin_floor_pct        = coalesce(p_margin_floor_pct, os.margin_floor_pct),
    margin_hard_floor_pct   = coalesce(p_margin_hard_floor_pct, os.margin_hard_floor_pct),
    nre_max_share_pct       = coalesce(p_nre_max_share_pct, os.nre_max_share_pct),
    min_job_value_thb       = coalesce(p_min_job_value_thb, os.min_job_value_thb),
    quote_valid_days_silver = coalesce(p_quote_valid_days_silver, os.quote_valid_days_silver),
    quote_valid_days_gold   = coalesce(p_quote_valid_days_gold, os.quote_valid_days_gold),
    quote_valid_days_brass  = coalesce(p_quote_valid_days_brass, os.quote_valid_days_brass),
    bar_margin_pct           = coalesce(p_bar_margin_pct, os.bar_margin_pct),
    seller_legal_name        = coalesce(p_seller_legal_name, os.seller_legal_name),
    seller_display_name      = coalesce(p_seller_display_name, os.seller_display_name),
    seller_branch_label      = coalesce(p_seller_branch_label, os.seller_branch_label),
    seller_address_lines     = coalesce(p_seller_address_lines, os.seller_address_lines),
    seller_tax_id            = coalesce(p_seller_tax_id, os.seller_tax_id),
    seller_vat_registered    = coalesce(p_seller_vat_registered, os.seller_vat_registered),
    seller_phone             = coalesce(p_seller_phone, os.seller_phone),
    seller_line              = coalesce(p_seller_line, os.seller_line),
    seller_email             = coalesce(p_seller_email, os.seller_email),
    seller_website           = coalesce(p_seller_website, os.seller_website),
    seller_terms             = coalesce(p_seller_terms, os.seller_terms),
    updated_by = auth.uid(), updated_at = now();
end;
$$;

revoke execute on function analytics.oem_setting_upsert(uuid, numeric, numeric, numeric, numeric, numeric, numeric, int, int, int, numeric, text, text, text, jsonb, text, boolean, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function analytics.oem_setting_upsert(uuid, numeric, numeric, numeric, numeric, numeric, numeric, int, int, int, numeric, text, text, text, jsonb, text, boolean, text, text, text, text, jsonb) to authenticated, service_role;

-- ============================================================================
-- 7. v_oem_seller — view แยกต่างหาก ไม่ append เข้า v_oem_quote โดยตั้งใจ:
--      1) seller_* เป็นข้อมูลระดับร้าน (1 แถวต่อ shop_id) ไม่ใช่ระดับใบเสนอ
--         ราคา — join ซ้ำเข้าทุกแถวของ v_oem_quote คือค่าเดียวกันซ้ำทุกแถว
--         ไม่มีประโยชน์อะไรเพิ่ม
--      2) หน้าพิมพ์ใบเสนอราคาอ่านข้อมูลร้าน "ครั้งเดียวต่อการ render" ไม่ใช่
--         ต่อแถวใบเสนอราคา — query แยกตรงกับ use case แอปมากกว่า
--      3) กันความเสี่ยง 42P16 (แทรกคอลัมน์กลาง v_oem_quote ต้องต่อท้ายเป๊ะ)
--         ไปเลย ไม่ต้องพึ่งความระวังของคนแก้ในอนาคต
--    RLS: security_invoker = true — พึ่ง tenant_isolation_select ของ
--    oem_setting เอง (shop_member เท่านั้นที่อ่านได้ เหมือน v_oem_quote)
-- ============================================================================

create or replace view analytics.v_oem_seller
  with (security_invoker = true) as
select
  shop_id,
  seller_legal_name,
  seller_display_name,
  seller_branch_label,
  seller_address_lines,
  seller_tax_id,
  seller_vat_registered,
  seller_phone,
  seller_line,
  seller_email,
  seller_website,
  seller_terms
from analytics.oem_setting;

comment on view analytics.v_oem_seller is
  'ข้อมูลร้าน (ผู้ออกใบเสนอราคา) 1 แถวต่อ shop_id — แทนที่ lib/oem/sellerProfile.ts ฝั่งแอปอ่านค่านี้ตอน render หน้าพิมพ์ใบเสนอราคา (0079)';

grant select on analytics.v_oem_seller to authenticated, service_role;

notify pgrst, 'reload schema';
