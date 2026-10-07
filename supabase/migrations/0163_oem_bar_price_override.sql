-- 0163_oem_bar_price_override.sql
--
-- ทำไม: งาน bid/special ต้องเสนอราคาเงินแท่งล่วงหน้า — บางทีบวกเผื่อราคาเงินขึ้น บางทีให้ราคาพิเศษ
-- แต่ช่องส่วนลดเดิมลดได้อย่างเดียว และราคาแท่งผูกกับราคาเว็บ "วันนี้" เท่านั้น (ยืน 0 วัน)
-- เจ้าของสั่ง (7 ต.ค. 69) · design: docs/3j-jewelry/analytics/design-oem-bar-price-override.md
--
-- มติ: (1) ราคาพิเศษต่ำกว่าราคาเว็บได้ แต่ห้ามต่ำกว่าทุน (ทุนแท่ง = ราคารับซื้อคืน 0079/0134) ไม่มีปุ่มปลดล็อก
--      (2) ใบที่มีราคาพิเศษ กรอกวันยืนราคาเองไม่เกิน 30 วัน (3) หน้าพิมพ์แสดงเป็นราคาต่อแท่งตามปกติ
--
-- ไม่มี DDL: oem_quote_item.input/calc เป็น jsonb snapshot · oem_quote.quote_valid_until มีแล้ว ·
-- ใบเสร็จอ่าน grand_total จากแถว quote ไม่อ่านราคาเว็บซ้ำ · renegotiate copy items verbatim
--
-- แก้ 3 ฟังก์ชัน (ต้นฉบับ = ฉบับ live บน DB ซึ่งตรงกับไฟล์ 0140 / 0083 / 0085 ทุกตัวอักษร — เทียบแล้ว
-- ก่อนเขียนไฟล์นี้ · ไฟล์นี้สร้างจาก body ของไฟล์เดิมด้วยการแทนที่เฉพาะจุด ไม่ได้พิมพ์ใหม่):
--   1. oem_price_calc       branch silver999: input ใหม่ bar_price_override_thb / _reason
--   2. oem_quote_save       signature ใหม่ +p_bar_valid_until date default null (drop 9-arg เดิม)
--   3. oem_quote_renegotiate ใบที่มีราคาพิเศษสืบทอดวันยืนราคาเดิม
--
-- สัญญา input (เงินแท่ง เท่านั้น):
--   bar_price_override_thb     numeric, optional · ต่อแท่ง ไม่รวม engrave · VAT-inclusive (ความหมายเดียวกับราคาเว็บ)
--   bar_price_override_reason  text, บังคับคู่กับ override · trim แล้วห้ามว่าง · ตัด 200 ตัวอักษร
--   ค่า null / '' / เว้นวรรคล้วน = ไม่มี override (ผลเท่า legacy เป๊ะ — golden replay ครอบแล้ว)
--
-- ด่าน (ตกที่ไหน):
--   override <= 0 / NaN / Infinity / > 1,000,000 / ทศนิยม > 2 ตำแหน่ง / > 2x ราคาเว็บ  -> oem_price_calc raise 22023
--   ไม่มีเหตุผล / เหตุผลลอยไม่มี override                                           -> oem_price_calc raise 22023
--   ไม่มีราคาเว็บวันนี้                                                              -> is_complete=false (ด่านเดิม price_fresh)
--   ไม่มีราคารับซื้อคืนวันนี้ (มี override)                                          -> is_complete=false + missing silver_bar_buyback
--   override < ราคารับซื้อคืน (floors.bar_price.pass=false)                          -> preview ได้ · oem_quote_save quoted raise
--   เท่ากับทุนพอดี -> ผ่าน (มติตามตัวอักษร "ห้ามต่ำกว่าทุน" · Tech Lead เคาะ §9.1)
--   วันยืนราคา: ย้อนหลัง / > วันนี้+30 (เวลาไทย) -> save raise · ส่งวันแต่ไม่มี override -> raise ·
--               quoted + มี override + ไม่ส่งวัน -> raise · draft ไม่ส่งวันได้ (ตรวจตอน quoted)
--   ใบ quoted แล้วแก้ -> ด่านเดิมของ save (0083)
--
-- snapshot ใน oem_quote_item.calc (key ใหม่ emit "เฉพาะเมื่อมี override" ⇒ ไม่มี override ได้ jsonb เดิมทุก byte):
--   breakdown.bar.bar_price_per_piece = ราคาที่คิดจริง (override ถ้าผ่านด่าน) — คง key เดิม print/สรุปอ่านช่องเดิม
--   breakdown.bar.web_price_per_piece = ราคาเว็บวันนั้น · breakdown.bar.override = {thb, reason}
--   floors.bar_price = {applies:true, pass:bool|null}
--   ใบ: rate_snapshot.bar_valid_until_requested (เฉพาะใบที่มี override — draft เปิดกลับมาอ่านวันจากที่นี่)
--
-- วันยืนราคาของใบ = least() ของทุก item (เดิม): ราคาพิเศษ -> วันที่กรอก · เงินแท่งราคาเว็บ -> 0 (วันนี้) ·
-- งานผลิต -> ตามโลหะ ⇒ ใบผสมราคาพิเศษ + แท่งราคาเว็บ ได้อายุ = วันนี้ (UI เตือน · Tech Lead เคาะ §9.5)
--
-- 🔴 ที่ตั้งใจไม่ทำ: ไม่แตะต้นทุน/margin สูตรเดิม (override ไม่แตะฝั่งทุน) · floors.margin.value ของแท่งคง null ·
-- ไม่แตะ current_date (UTC) ตรงอื่นของ branch งานผลิต · ไม่มี DDL
--
-- 🔴 Grants (ข้อ 18): ทั้ง 3 ฟังก์ชัน service_role เท่านั้น — revoke จาก public, anon, authenticated ครบสามชื่อ
-- (ฉบับเดิมของ save/renegotiate ถูก revoke จาก authenticated ไปแล้วโดย 0147 · ฟังก์ชันที่ create ใหม่ต้องทำซ้ำ)
--
-- 🔴 ความเข้ากันได้กับ app บน production ก่อน merge UI: app เก่าเรียก oem_quote_save ด้วย 9 named params ผ่าน
-- PostgREST — 10-arg ที่ตัวสุดท้ายมี default ยังจับคู่ได้ (golden replay ท้ายไฟล์ยิง 9 named args ตรงๆ พิสูจน์ว่า resolve ได้
-- โดยไม่เขียนข้อมูล) · app เก่าไม่ส่ง bar_price_override_* ⇒ calc ผลเท่าเดิม
--
-- Golden replay (ท้ายไฟล์ — ไม่เท่า legacy แม้เคสเดียว = raise = ทั้ง migration rollback):
--   เงินแท่ง 6 ขนาด x engrave image {null,0,150} x text {null,0,150} x qty {1,7} x 3 รูปแบบ key
--   (ไม่ส่ง / null / ค่าว่างเว้นวรรค) x 6 สถานะร้าน (ร้านจริงตามที่เป็น · ไม่มี oem_setting · ร้านไม่มีแถวราคา ·
--   ราคาชุดทดสอบ+ราคารับซื้อคืน · ไม่มีราคารับซื้อคืน (fallback assumed_margin) · บางขนาดไม่มีราคา)
--   + ทุกแถวจริงใน oem_quote_item (รวม silver999 ทุกแถว) + งานผลิต silver/gold/brass 24 เคส
--   สถานะร้านที่ปรับ (ลบ oem_setting / แก้แถวราคาวันนี้) ทำใน sub-block ที่ raise marker แล้วกลืน ⇒ ถอยกลับเสมอ
--   ราคาชุดทดสอบเป็นตัวเลขสมมติ ไม่ใช่ราคา/ทุนจริงของร้าน
--
-- 🔴 APPLIED แล้ว 7 ต.ค. 69 version 20261007115504 — ห้าม apply ซ้ำ · ชุดทดสอบ scripts/verify/verify-0163.sql (OK 99 / FAIL 0)

-- ============================================================================
-- 1. oem_price_calc — rename ของเดิมเป็น _legacy (ใช้ใน golden replay ข้างล่าง) แล้วสร้างใหม่
--    signature เดิมเป๊ะ (uuid, jsonb) · แก้เฉพาะ branch silver999 · ต้นทุน/margin สูตรเดิมทุกบรรทัด
-- ============================================================================
drop function if exists analytics.oem_price_calc_legacy(uuid, jsonb);
alter function analytics.oem_price_calc(uuid, jsonb) rename to oem_price_calc_legacy;

create or replace function analytics.oem_price_calc(p_shop_id uuid, p_input jsonb)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_metal         text;
  v_qty           int;
  v_weight_g      numeric;
  v_as_of         date;
  v_m             numeric;
  v_set analytics.oem_setting%rowtype;
  v_missing jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_r_total  numeric;
  v_q_run  numeric;
  v_price_used numeric; v_price_source text;
  v_sprue numeric; v_polish_loss numeric; v_loss_eff numeric; v_metal_per_piece numeric;
  v_labor_per_piece numeric;
  v_labor_steps jsonb := '[]'::jsonb;
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
  v_cost_result jsonb;
  v_raw jsonb;
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
  v_bar_buy_per_baht numeric;
  v_bar_kilo_buy     numeric;
  v_bar_buyback      numeric;
  v_bar_metal_cost   numeric;
  v_bar_cost_basis   text;
  -- 0163: ราคาพิเศษเงินแท่ง (override)
  v_ovr               numeric;
  v_ovr_reason        text;
  v_bar_price_charged numeric;
  v_bar_floor_pass    boolean;
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
  --
  -- 0140: บล็อกนี้ copy มาจาก 0083 คำต่อคำ ไม่แตะแม้แต่บรรทัดเดียว (ดูหัวไฟล์)
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

    -- 0163: ราคาพิเศษต่อแท่ง (ไม่รวม engrave · VAT-inclusive เหมือนราคาเว็บ) — ผู้ขายกรอกเอง
    -- ใช้กับงาน bid/ล็อกราคาล่วงหน้า · เหตุผลบังคับคู่กัน (ไม่มีเหตุผล = ไม่มี override)
    -- ค่าว่าง/null/เว้นวรรคล้วน = ไม่มี override (พฤติกรรมเดิมเป๊ะ — golden replay พิสูจน์แล้ว)
    v_ovr := nullif(btrim(p_input->>'bar_price_override_thb'), '')::numeric;
    v_ovr_reason := left(nullif(btrim(p_input->>'bar_price_override_reason', E' \t\r\n\u00a0\u200b'), ''), 200);
    if v_ovr is not null then
      -- not(between) ฆ่า NaN/Infinity ให้ฟรี (3j-migration-traps ข้อ 4)
      if not (v_ovr > 0 and v_ovr <= 1000000) then
        raise exception 'oem_price_calc: p_input.bar_price_override_thb must be a finite number > 0 and <= 1,000,000'
          using errcode = '22023';
      end if;
      -- เงินต้องไม่เกิน 2 ตำแหน่ง ไม่งั้นราคาต่อแท่งกับยอดรวมที่ปัดแล้วจะบวกกันไม่ลง
      if v_ovr <> round(v_ovr, 2) then
        raise exception 'oem_price_calc: p_input.bar_price_override_thb ต้องไม่เกิน 2 ตำแหน่งทศนิยม'
          using errcode = '22023';
      end if;
      if v_ovr_reason is null then
        raise exception 'oem_price_calc: ราคาพิเศษต้องระบุเหตุผล (p_input.bar_price_override_reason)'
          using errcode = '22023';
      end if;
      v_warnings := jsonb_build_array('ราคาพิเศษ — ยืนราคาตามวันที่กรอกในใบ (ไม่เกิน 30 วัน)');
    elsif v_ovr_reason is not null then
      raise exception 'oem_price_calc: มีเหตุผลราคาพิเศษแต่ไม่มีราคาพิเศษ (p_input.bar_price_override_thb)'
        using errcode = '22023';
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

    -- 0163: ราคาที่คิดจริง = ราคาเว็บวันนี้ เว้นแต่มี override ที่ผ่านด่านครบ
    -- ไม่มีราคาเว็บวันนี้ = ออกใบไม่ได้แม้มี override (is_complete เดิม) · ไม่มีราคารับซื้อคืน
    -- วันนี้ = ตัดสิน "ต่ำกว่าทุน" ไม่ได้ ⇒ ไม่ครบ (ไม่ใช้ทุนประมาณมาตัดสินราคาพิเศษ)
    v_bar_price_charged := v_bar_price;
    if v_ovr is not null and v_bar_price is not null then
      if v_ovr > v_bar_price * 2 then
        raise exception 'oem_price_calc: ราคาพิเศษสูงกว่า 2 เท่าของราคาเว็บวันนี้ — ตรวจว่าพิมพ์เลขเกินหรือไม่'
          using errcode = '22023';
      end if;
      if v_bar_buyback is null then
        v_is_complete := false;
        v_missing := v_missing || jsonb_build_array(jsonb_build_object(
          'rate_key', 'silver_bar_buyback',
          'scope', v_bar_size,
          'question_th', 'ยังไม่มีราคารับซื้อคืนของขนาดนี้วันนี้ — ตัดสินว่าราคาพิเศษต่ำกว่าทุนหรือไม่ไม่ได้ (กรอกผ่าน silver_price_set)',
          'priority', 'P0'
        ));
      else
        v_bar_price_charged := v_ovr;
        v_bar_floor_pass := (v_ovr >= v_bar_buyback);
      end if;
    end if;

    if v_is_complete then
      -- price_per_piece = ราคาต่อขนาดจาก feed + engrave (ห้ามคูณจากต่อกรัม/บาท)
      v_price_piece := v_bar_price_charged + coalesce(v_bar_engrave_image, 0) + coalesce(v_bar_engrave_text, 0);

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
          'bar_price_per_piece', v_bar_price_charged,
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
        )
        -- 0163: key ใหม่ emit เฉพาะเมื่อมี override ⇒ ไม่มี override ได้ jsonb เดิมทุก byte
        -- (bar_price_per_piece ด้านบนคือราคาที่คิดจริง · ราคาเว็บเก็บแยกที่นี่ — ห้ามใส่ buyback)
        || case when v_ovr is not null then jsonb_build_object(
             'web_price_per_piece', v_bar_price,
             'override', jsonb_build_object('thb', v_ovr, 'reason', v_ovr_reason)
           ) else '{}'::jsonb end,
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
      )
      -- 0163: pass=false ⇒ ราคาพิเศษต่ำกว่าทุน (preview ได้ · oem_quote_save ปฏิเสธตอน quoted) ·
      -- pass=null ⇒ ตัดสินไม่ได้ (ไม่มีราคาเว็บ/ราคารับซื้อคืนวันนี้ — is_complete=false อยู่แล้ว)
      || case when v_ovr is not null then jsonb_build_object(
           'bar_price', jsonb_build_object('applies', true, 'pass', v_bar_floor_pass)
         ) else '{}'::jsonb end,
      'warnings', v_warnings,
      'formula_version', 4
    );
  end if;

  -- ==========================================================================
  -- งานผลิต (silver/gold/brass) — 0140: ชั้นต้นทุนย้ายไป
  -- analytics.oem_cost_calc แล้ว (validate input -> rate lookup ->
  -- metal/labor/batch/nre_cost -> missing[]) เหลือเฉพาะชั้นราคาที่นี่ ไม่มี
  -- อะไรเปลี่ยนพฤติกรรม รอบนี้แค่ตัดที่รอยต่อ (ดูหัวไฟล์ 0140 + golden
  -- replay ท้ายไฟล์)
  -- ==========================================================================
  v_cost_result := analytics.oem_cost_calc(p_shop_id, p_input);
  v_raw := v_cost_result->'_raw';

  v_missing      := coalesce(v_cost_result->'missing', '[]'::jsonb);
  v_price_source := v_cost_result->>'price_source';
  v_labor_steps  := coalesce(v_cost_result->'labor_steps', '[]'::jsonb);
  v_batch_lines  := coalesce(v_cost_result->'batch_lines', '[]'::jsonb);

  v_as_of           := (v_raw->>'as_of_date')::date;
  v_qty             := (v_raw->>'qty')::int;
  v_weight_g        := (v_raw->>'weight_g')::numeric;
  v_q_run           := (v_raw->>'q_run')::numeric;
  v_r_total         := (v_raw->>'reject_pct_total')::numeric;
  v_price_used      := (v_raw->>'price_used')::numeric;
  v_sprue           := (v_raw->>'gross_loss_pct')::numeric;
  v_polish_loss     := (v_raw->>'polish_loss_pct')::numeric;
  v_loss_eff        := (v_raw->>'effective_loss_pct')::numeric;
  v_metal_per_piece := (v_raw->>'metal_per_piece')::numeric;
  v_labor_per_piece := (v_raw->>'labor_per_piece')::numeric;
  v_batch_per_piece := (v_raw->>'batch_per_piece')::numeric;
  v_cad             := (v_raw->>'cad')::numeric;
  v_print3d         := (v_raw->>'print3d')::numeric;
  v_mold            := (v_raw->>'mold')::numeric;
  v_nre_cost        := (v_raw->>'nre_cost')::numeric;
  v_cost_piece      := (v_raw->>'cost_piece')::numeric;

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

  if v_metal = 'gold' then
    v_price_piece := coalesce(v_metal_per_piece, 0)
                      + (coalesce(v_labor_per_piece, 0) + coalesce(v_batch_per_piece, 0)) / (1 - v_m);
    v_warnings := v_warnings || to_jsonb('งานทองเป็น pass-through: มาร์จิ้นคิดเฉพาะค่ากำเหน็จ ไม่คิดทับเนื้อทอง — margin รวมทั้งงานจึงต่ำกว่ามาก และเป็นตัวเลขที่ถูกต้อง ไม่ได้ใช้ตัดสิน floor'::text);
  else
    v_price_piece := v_cost_piece / (1 - v_m);
  end if;

  v_nre_price := case when v_nre_cost > 0 then round(v_nre_cost / (1 - v_m), 2) else 0 end;

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
grant execute on function analytics.oem_price_calc(uuid, jsonb) to service_role;

-- ============================================================================
-- 2. oem_quote_save — เพิ่ม p_bar_valid_until date default null (10-arg)
--    🔴 drop 9-arg เดิมก่อน (ข้อ 1 — create or replace ที่เปลี่ยน arg list = overload ตัวใหม่)
--    app เก่าที่ส่ง 9 named params ยังเรียกได้: PostgREST จับคู่ตามชื่อพารามิเตอร์ ตัวที่ 10 มี default
-- ============================================================================
drop function if exists analytics.oem_quote_save(uuid, jsonb, uuid, text, text, text, text, numeric, text);

create or replace function analytics.oem_quote_save(p_shop_id uuid, p_items jsonb, p_quote_id uuid DEFAULT NULL::uuid, p_status text DEFAULT 'draft'::text, p_approval_note text DEFAULT NULL::text, p_customer_name text DEFAULT NULL::text, p_customer_contact text DEFAULT NULL::text, p_discount_thb numeric DEFAULT 0, p_discount_reason text DEFAULT NULL::text, p_bar_valid_until date DEFAULT NULL::date)
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
  -- ---- 0163: ราคาพิเศษเงินแท่ง ----
  v_has_override boolean := false;
  v_bar_below_cost_seq int;
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
    -- 0163: jsonb_typeof ไม่ใช่ is not null (ข้อ 13 — JSON null หน้าตาเหมือนว่าง)
    if jsonb_typeof(v_item_calc->'breakdown'->'bar'->'override') = 'object' then
      v_has_override := true;
      -- is false (ไม่ใช่ = false): pass=null (ตัดสินไม่ได้) ไม่ใช่เคสนี้ — is_complete ดักอยู่แล้ว
      if (v_item_calc->'floors'->'bar_price'->>'pass')::boolean is false
         and v_bar_below_cost_seq is null then
        v_bar_below_cost_seq := v_seq;
      end if;
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
      -- 0163: มีราคาพิเศษ = ยืนตามวันที่ผู้ขายกรอก (p_bar_valid_until ผ่านด่านช่วงวันหลัง loop)
      -- coalesce 0: draft ที่ยังไม่กรอกวัน — quote_valid_until ไม่ถูกเขียนตอน draft อยู่แล้ว
      -- แต่ห้ามส่ง null เข้า least() (least ข้าม null เงียบๆ ⇒ ใบผสมได้อายุจากงานผลิตแทน)
      when 'silver999' then case
        when jsonb_typeof(v_item_calc->'breakdown'->'bar'->'override') = 'object'
          then coalesce(p_bar_valid_until - v_bkk_today, 0)
        else 0 end
      else coalesce(v_set.quote_valid_days_silver, 30)
    end;
    -- ยืนราคาตามโลหะที่ผันผวนสุดในใบ (ทอง/แท่งสั้นสุด) ไม่ใช่ตามรายการสุดท้าย
    v_valid_days := case when v_valid_days is null then v_item_valid_days else least(v_valid_days, v_item_valid_days) end;
  end loop;

  -- 0163: ด่านวันยืนราคาของราคาพิเศษ — ตรวจทุกครั้งที่ save (draft ด้วย) กันค่าเน่าค้างในร่าง
  -- ส่งวันโดยไม่มีราคาพิเศษ = ปฏิเสธ (กันค่าลอยที่ไม่มีใครใช้แต่ดูเหมือนมีผล)
  if p_bar_valid_until is not null then
    if not v_has_override then
      raise exception 'oem_quote_save: ส่งวันยืนราคาเงินแท่ง (p_bar_valid_until) แต่ใบนี้ไม่มีรายการราคาพิเศษ'
        using errcode = '22023';
    end if;
    if p_bar_valid_until < v_bkk_today or p_bar_valid_until > v_bkk_today + 30 then
      raise exception 'oem_quote_save: วันยืนราคาเงินแท่งต้องอยู่ระหว่างวันนี้ถึงอีก 30 วัน'
        using errcode = '22023';
    end if;
  end if;

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

    -- 0163: ราคาพิเศษต่ำกว่าทุน (ราคารับซื้อคืน) = ปฏิเสธรายชิ้น ไม่มีทางลัด/ไม่ปลดด้วยเหตุผล
    -- ต้องเป็นด่านรายชิ้น — ใบผสมงานผลิต margin สูงจะกลบให้ margin รวมมองไม่เห็นรายการนี้
    -- ข้อความไม่ใส่ตัวเลขทุน (ราคารับซื้อคืนห้ามหลุด) — หน้า admin ดูขั้นต่ำเองจาก preview
    if v_bar_below_cost_seq is not null then
      raise exception 'oem_quote_save: รายการที่ % — ราคาพิเศษต่ำกว่าทุน ออกใบเสนอราคาไม่ได้ ไม่มีทางลัด ต้องปรับราคาขึ้น', v_bar_below_cost_seq
        using errcode = '22023';
    end if;
    if v_has_override and p_bar_valid_until is null then
      raise exception 'oem_quote_save: ใบที่มีราคาพิเศษต้องกรอกวันยืนราคา (ไม่เกิน 30 วัน) ก่อนออกใบเสนอราคา'
        using errcode = '22023';
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
    -- 0163: เก็บวันที่ผู้ขายขอ เฉพาะใบที่มีราคาพิเศษ (draft ยังไม่มี quote_valid_until — เปิดร่างกลับมาอ่านจากที่นี่)
    rate_snapshot = jsonb_build_object('formula_version', 2, 'items', v_calc_agg)
      || case when v_has_override
           then jsonb_build_object('bar_valid_until_requested', p_bar_valid_until)
           else '{}'::jsonb end,
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

revoke execute on function analytics.oem_quote_save(uuid, jsonb, uuid, text, text, text, text, numeric, text, date) from public, anon, authenticated;
grant execute on function analytics.oem_quote_save(uuid, jsonb, uuid, text, text, text, text, numeric, text, date) to service_role;

-- ============================================================================
-- 3. oem_quote_renegotiate — signature เดิม (create or replace ตรงๆ ปลอดภัย)
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

  -- 0085 §1: ผ่อนด่านสถานะ — เดิมรับเฉพาะ quoted เพิ่ม won เข้ามา (เจ้าของสั่ง
  -- ให้ต่อราคาใบที่รับมัดจำแล้วได้ ดูหัวไฟล์) lost/rejected/superseded/draft
  -- ยังปฏิเสธเหมือนเดิมทุกประการ
  if v_old.status not in ('quoted', 'won') then
    raise exception 'oem_quote_renegotiate: ต่อรองราคาได้เฉพาะใบสถานะ quoted หรือ won เท่านั้น (ใบนี้สถานะ %)', v_old.status
      using errcode = '22023';
  end if;
  -- 0085 §2: ด่านวันหมดอายุ — ผูกมัดร้านกับลูกค้า "ก่อน" ตกลง เมื่อ won แล้ว
  -- (รับเงิน/ปิดดีลแล้ว) หน้าที่นี้จบ ข้ามด่านนี้เฉพาะ won เท่านั้น — quoted ยัง
  -- เช็คเหมือนเดิมทุกประการ ไม่ผ่อน (ดูเหตุผลเต็มที่หัวไฟล์)
  if v_old.status = 'quoted'
     and (v_old.quote_valid_until is null or v_old.quote_valid_until < v_bkk_today) then
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
        -- 0163: ใบที่มีราคาพิเศษสืบทอดวันยืนราคาเดิม (ใบ quoted ผ่านด่านหมดอายุข้างบนมาแล้ว ·
        -- ใบ won ที่วันเดิมผ่านไปแล้ว greatest ให้ 0 = ยืนวันนี้ ไม่ย้อนหลัง) · ไม่มี = 0 เหมือนเดิม
        when 'silver999' then case
          when jsonb_typeof(v_row.calc->'breakdown'->'bar'->'override') = 'object'
            then greatest(v_old.quote_valid_until - v_bkk_today, 0)
          else 0 end
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
        -- 0085 §3: ใบลูกสืบทอดสถานะจากใบแม่ตรงๆ (v_old.status การันตีแล้วว่า
        -- เป็น 'quoted' หรือ 'won' อย่างใดอย่างหนึ่งจากด่านต้นฟังก์ชัน) —
        -- ไม่ใช่ literal 'quoted' เหมือนเดิม ดูเหตุผลเต็มที่หัวไฟล์
        v_old.status, p_new_discount_thb, p_reason, v_new_grand_total, v_margin_after,
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

revoke execute on function analytics.oem_quote_renegotiate(uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function analytics.oem_quote_renegotiate(uuid, uuid, numeric, text) to service_role;

-- ============================================================================
-- 4. Golden replay — oem_price_calc ใหม่ ต้องให้ jsonb เท่า oem_price_calc_legacy เป๊ะ
--    (jsonb = เทียบตามค่า ไม่สนลำดับ key) เมื่อ "ไม่มี override" ทุกรูปแบบ
-- ============================================================================
create function pg_temp.gr163_cmp(p_shop uuid, p_input jsonb) returns text
 language plpgsql as $h$
declare
  v_new jsonb;
  v_legacy jsonb;
begin
  begin
    v_new := analytics.oem_price_calc(p_shop, p_input);
  exception when others then
    v_new := jsonb_build_object('__error', sqlerrm);
  end;
  begin
    v_legacy := analytics.oem_price_calc_legacy(p_shop, p_input);
  exception when others then
    v_legacy := jsonb_build_object('__error', sqlerrm);
  end;
  if v_new ? '_raw' then
    return format('MISMATCH (_raw leaked) shop=%s input=%s', p_shop, p_input);
  end if;
  if v_new is distinct from v_legacy then
    return format(E'MISMATCH shop=%s input=%s\n    new:    %s\n    legacy: %s', p_shop, p_input, v_new, v_legacy);
  end if;
  return case when v_new->>'is_complete' = 'true' then 'OK:complete' else 'OK:incomplete' end;
end;
$h$;

do $gr163$
declare
  v_cnt int;
  v_fn text;
  v_res text;
  v_real_shop uuid;
  v_shop uuid;
  v_variant int;
  v_size text;
  v_img numeric;
  v_txt numeric;
  v_qty int;
  v_form int;
  v_input jsonb;
  v_row record;
  v_n_cmp int := 0;
  v_n_mismatch int := 0;
  v_n_complete int := 0;
  v_n_real int := 0;
  v_n_synth int := 0;
  v_detail text := '';
  -- ชุดงานผลิตสังเคราะห์ (ลอกแนวจาก 0140 Part B)
  v_synth_shop uuid;
  v_polish_tier_val text;
  v_item_kind_val text;
  v_gem_tier_val text;
  v_plating_type_val text;
  v_metal_s text;
  v_gem_flag boolean;
  v_plate_flag boolean;
  v_newdesign_flag boolean;
  v_caught text;
  v_sigs text[] := array[
    'analytics.oem_price_calc(uuid,jsonb)',
    'analytics.oem_quote_save(uuid,jsonb,uuid,text,text,text,text,numeric,text,date)',
    'analytics.oem_quote_renegotiate(uuid,uuid,numeric,text)'
  ];
  v_names text[] := array['oem_price_calc', 'oem_quote_save', 'oem_quote_renegotiate'];
  v_i int;
begin
  -- ---- 0. static guard: ฟังก์ชันละ 1 แถว ไม่มี overload ค้าง (ข้อ 1) ----
  foreach v_fn in array v_names loop
    select count(*) into v_cnt from pg_proc
      where pronamespace = 'analytics'::regnamespace and proname = v_fn;
    if v_cnt <> 1 then
      raise exception 'GOLDEN REPLAY FAILED: expected exactly 1 analytics.%, found % (overload?)', v_fn, v_cnt;
    end if;
  end loop;
  select count(*) into v_cnt from pg_proc
    where pronamespace = 'analytics'::regnamespace and proname = 'oem_price_calc_legacy';
  if v_cnt <> 1 then
    raise exception 'GOLDEN REPLAY FAILED: expected exactly 1 oem_price_calc_legacy before drop, found %', v_cnt;
  end if;

  -- ---- 0b. grants: service_role เท่านั้น (ข้อ 2 + 18) ----
  for v_i in 1..array_length(v_sigs, 1) loop
    if has_function_privilege('anon', v_sigs[v_i], 'execute')
       or has_function_privilege('authenticated', v_sigs[v_i], 'execute') then
      raise exception 'GOLDEN REPLAY FAILED: % execute leaked to anon/authenticated/PUBLIC', v_sigs[v_i];
    end if;
    if not has_function_privilege('service_role', v_sigs[v_i], 'execute') then
      raise exception 'GOLDEN REPLAY FAILED: % missing service_role execute', v_sigs[v_i];
    end if;
  end loop;

  -- ---- 0c. app เก่า (9 named params) ต้อง resolve ได้ — p_items ว่าง ⇒ ตกที่ด่านแรกก่อนแตะข้อมูลใดๆ ----
  v_caught := null;
  begin
    perform analytics.oem_quote_save(
      p_shop_id => gen_random_uuid(), p_items => '[]'::jsonb, p_quote_id => null, p_status => 'draft',
      p_approval_note => null, p_customer_name => null, p_customer_contact => null,
      p_discount_thb => 0, p_discount_reason => null);
  exception when others then
    v_caught := sqlerrm;
  end;
  if v_caught is null or v_caught not like '%p_items must be a non-empty json array%' then
    raise exception 'GOLDEN REPLAY FAILED: 9-named-args call of oem_quote_save did not resolve to the expected guard (got: %)', coalesce(v_caught, '(no error)');
  end if;

  select coalesce(
           (select shop_id from analytics.silver_price_daily order by as_of_date desc limit 1),
           (select id from public.shop order by id limit 1))
    into v_real_shop;

  -- ==========================================================================
  -- Part A — เงินแท่ง: 6 สถานะร้าน x matrix · สถานะที่ปรับอยู่ใน sub-block ที่ถอยกลับเสมอ
  -- ==========================================================================
  for v_variant in 1..6 loop
    v_shop := v_real_shop;
    if v_real_shop is null and v_variant <> 3 then
      continue; -- DB ว่างไม่มีร้านเลย (rebuild ใหม่): ข้ามสถานะที่ต้องมีร้านจริง
    end if;
    begin
      if v_variant = 2 then
        delete from analytics.oem_setting where shop_id = v_real_shop;
      elsif v_variant = 3 then
        v_shop := gen_random_uuid();
      elsif v_variant in (4, 5, 6) then
        -- ตัวเลขชุดทดสอบสมมติ (ไม่ใช่ราคา/ทุนจริง) — วางทับแถว "วันนี้ (เวลาไทย)" ในทรานแซกชันย่อยนี้เท่านั้น
        insert into analytics.silver_price_daily (
          shop_id, as_of_date, sheet_time, sell_per_baht, buy_per_baht,
          bar_0_5_baht, bar_1_baht, bar_3_baht, bar_5_baht, bar_10_baht,
          kilo_sell, kilo_sell_vat, kilo_buy, source, captured_at
        ) values (
          v_real_shop, (now() at time zone 'Asia/Bangkok')::date, 'fixture', null,
          case when v_variant = 5 then null else 750 end,
          500, 1000, case when v_variant = 6 then null else 3000 end, 5000, 10000,
          null, case when v_variant = 6 then null else 100000 end,
          case when v_variant = 5 then null else 75000 end,
          'manual', now()
        )
        on conflict (shop_id, as_of_date) do update set
          sheet_time = excluded.sheet_time, sell_per_baht = excluded.sell_per_baht,
          buy_per_baht = excluded.buy_per_baht, bar_0_5_baht = excluded.bar_0_5_baht,
          bar_1_baht = excluded.bar_1_baht, bar_3_baht = excluded.bar_3_baht,
          bar_5_baht = excluded.bar_5_baht, bar_10_baht = excluded.bar_10_baht,
          kilo_sell = excluded.kilo_sell, kilo_sell_vat = excluded.kilo_sell_vat,
          kilo_buy = excluded.kilo_buy, source = excluded.source;
      end if;

      foreach v_size in array array['0_5_baht', '1_baht', '3_baht', '5_baht', '10_baht', '1_kg'] loop
        foreach v_img in array array[null, 0, 150]::numeric[] loop
          foreach v_txt in array array[null, 0, 150]::numeric[] loop
            foreach v_qty in array array[1, 7] loop
              for v_form in 0..2 loop
                v_input := jsonb_build_object(
                  'metal', 'silver999', 'bar_size', v_size, 'qty', v_qty,
                  'engrave_image_thb', v_img, 'engrave_text_thb', v_txt, 'as_of_date', null);
                if v_form = 1 then
                  v_input := v_input || jsonb_build_object('bar_price_override_thb', null, 'bar_price_override_reason', null);
                elsif v_form = 2 then
                  v_input := v_input || jsonb_build_object('bar_price_override_thb', '', 'bar_price_override_reason', E'  \t ');
                end if;
                v_res := pg_temp.gr163_cmp(v_shop, v_input);
                v_n_cmp := v_n_cmp + 1;
                if v_res = 'OK:complete' then
                  v_n_complete := v_n_complete + 1;
                elsif v_res not like 'OK:%' then
                  v_n_mismatch := v_n_mismatch + 1;
                  if v_n_mismatch <= 5 then
                    v_detail := v_detail || E'\n  [variant ' || v_variant || '] ' || v_res;
                  end if;
                end if;
              end loop;
            end loop;
          end loop;
        end loop;
      end loop;

      -- ทุกแถวจริงใน oem_quote_item (silver999 + งานผลิต) — ใน variant 1 (ร้านตามจริง) เท่านั้น
      if v_variant = 1 then
        for v_row in select id, shop_id, input from analytics.oem_quote_item loop
          v_n_real := v_n_real + 1;
          v_res := pg_temp.gr163_cmp(v_row.shop_id, v_row.input);
          v_n_cmp := v_n_cmp + 1;
          if v_res not like 'OK:%' then
            v_n_mismatch := v_n_mismatch + 1;
            if v_n_mismatch <= 5 then
              v_detail := v_detail || E'\n  [real item ' || v_row.id || '] ' || v_res;
            end if;
          end if;
        end loop;
      end if;

      raise exception 'gr163 rollback marker' using errcode = 'P0163';
    exception when sqlstate 'P0163' then
      null; -- ถอยสถานะร้านที่ปรับไว้กลับ — ตัวแปร/ตัวนับของ plpgsql ไม่ถูกถอย
    end;
  end loop;

  -- ==========================================================================
  -- Part B — งานผลิต silver/gold/brass 24 เคส (branch ที่ไม่ได้แก้ — พิสูจน์ว่าไม่ขยับ)
  -- ==========================================================================
  select shop_id into v_synth_shop
    from analytics.oem_cost_rate
    group by shop_id
    order by count(distinct rate_key) desc
    limit 1;
  if v_synth_shop is null then
    v_synth_shop := gen_random_uuid();
  end if;
  select scope into v_polish_tier_val from analytics.oem_cost_rate
    where shop_id = v_synth_shop and rate_key = 'polish_pieces_per_day' limit 1;
  select scope into v_item_kind_val from analytics.oem_cost_rate
    where shop_id = v_synth_shop and rate_key = 'flask_capacity_pieces' limit 1;
  select scope into v_gem_tier_val from analytics.oem_cost_rate
    where shop_id = v_synth_shop and rate_key = 'gem_setting_seeds_per_hour' limit 1;
  select scope into v_plating_type_val from analytics.oem_cost_rate
    where shop_id = v_synth_shop and rate_key = 'plating_pieces_per_batch' limit 1;
  v_polish_tier_val := coalesce(v_polish_tier_val, 'เรียบ');
  v_item_kind_val := coalesce(v_item_kind_val, 'แหวน');
  v_gem_tier_val := coalesce(v_gem_tier_val, 'เล็ก');
  v_plating_type_val := coalesce(v_plating_type_val, 'ทอง');

  foreach v_metal_s in array array['silver', 'gold', 'brass'] loop
    foreach v_gem_flag in array array[false, true] loop
      foreach v_plate_flag in array array[false, true] loop
        foreach v_newdesign_flag in array array[false, true] loop
          v_input := jsonb_build_object(
            'metal', v_metal_s, 'item_kind', v_item_kind_val, 'polish_tier', v_polish_tier_val,
            'qty', 5, 'weight_g', 3.5, 'is_new_design', v_newdesign_flag,
            'purity', case when v_metal_s = 'gold' then 0.965 else null end,
            'plating_type', case when v_plate_flag then v_plating_type_val else null end,
            'gem_tier', case when v_gem_flag then v_gem_tier_val else null end,
            'gem_count', case when v_gem_flag then 2 else 0 end,
            'as_of_date', null, 'margin_pct', null);
          v_n_synth := v_n_synth + 1;
          v_res := pg_temp.gr163_cmp(v_synth_shop, v_input);
          v_n_cmp := v_n_cmp + 1;
          if v_res not like 'OK:%' then
            v_n_mismatch := v_n_mismatch + 1;
            if v_n_mismatch <= 5 then
              v_detail := v_detail || E'\n  [synthetic production] ' || v_res;
            end if;
          end if;
        end loop;
      end loop;
    end loop;
  end loop;

  if v_n_mismatch > 0 then
    raise exception 'GOLDEN REPLAY FAILED: % / % cases mismatched legacy (showing up to 5).%',
      v_n_mismatch, v_n_cmp, v_detail;
  end if;
  -- ถ้าทั้ง replay ไม่มีเคส "ราคาครบ" เลย = ไม่ได้พิสูจน์สูตรราคา (พิสูจน์ได้แค่ทางไม่ครบ)
  if v_real_shop is not null and v_n_complete = 0 then
    raise exception 'GOLDEN REPLAY FAILED: no complete silver999 case was replayed (proves nothing)';
  end if;

  raise notice 'GOLDEN REPLAY OK: % comparisons identical to legacy (silver999 matrix x 6 shop states: % complete; % real oem_quote_item rows; % synthetic production cases); grants + 1-row-per-function + 9-named-args call verified. Dropping oem_price_calc_legacy next.',
    v_n_cmp, v_n_complete, v_n_real, v_n_synth;
end $gr163$;

-- ถึงบรรทัดนี้ได้ก็ต่อเมื่อ do-block ไม่ raise (ถ้า raise ทั้ง transaction abort = rollback ทั้ง migration)
drop function pg_temp.gr163_cmp(uuid, jsonb);
drop function if exists analytics.oem_price_calc_legacy(uuid, jsonb);

-- ให้ PostgREST เห็น signature ใหม่ของ oem_quote_save (10-arg) ทันทีหลัง commit
notify pgrst, 'reload schema';
