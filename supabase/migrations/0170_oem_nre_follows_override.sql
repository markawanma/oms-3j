-- 0170_oem_nre_follows_override.sql
--
-- ทำไม: มติเจ้าของ 9 ต.ค. 69 — ค่า NRE (CAD/ปริ้น 3D/ก้อนยาง) ของรายการงานผลิตที่ "พิมพ์ราคาต่อชิ้นทับ" ใช้ margin เดียวกับราคาที่พิมพ์ — ตามทั้งขึ้นและลง
-- (0169 คง NRE ไว้ที่ margin % ในช่อง ⇒ ลดราคาต่อชิ้นแล้วค่าออกแบบยังบวก margin เต็ม)
--   - margin ที่ใช้ = v_m_eff ของ 0169 (เงิน/ทองเหลือง 1 - ทุน/ราคา · ทอง pass-through 1 - (แรง+batch)/(ราคา - เนื้อทอง))
--   - nre_price = max( round(nre_cost / (1 - margin), 2), ceil(nre_cost สองตำแหน่ง) ) ⇒ ไม่ต่ำกว่าทุน NRE เสมอ
--   - margin <= 0 / NULL / NaN (ราคา <= ทุน — ถูกปฏิเสธตอน quoted อยู่แล้ว แต่ draft/preview เกิดได้) ⇒ nre_price = ทุน NRE (+ warning)
--   - margin > 0.95 ⇒ clamp ที่ 0.95 (เพดานกัน 1/(1-m) ระเบิด · ระบบรับ margin % ช่องปกติได้ถึง < 1 แต่ NRE ของ override จำกัดที่ 95%) + warning
--   - snapshot: breakdown.production_override.nre_margin_used (เฉพาะเมื่อมี override · null เมื่อไม่มี NRE หรือคำนวณไม่ครบ) · breakdown.nre.price = ค่าที่คิดใหม่
--   - ไม่มี override ⇒ jsonb เดิมทุก byte (golden replay strict) · มี override ⇒ ต่างจาก 0169 เฉพาะ nre.price · quote_total · floors.job_value.pass · warnings ·
--     nre_margin_used (golden replay ตรวจ invariants ทุกเคส)
-- ไม่ต้องแก้ oem_quote_save / oem_quote_renegotiate: ด่านที่ใช้ nre_price (min_job_value — ยอดงานผลิตรวม NRE · grand_total) อ่านจาก calc ของรายการอยู่แล้ว ·
--   margin รวม/hard floor ไม่นับ NRE (item_total ตัด NRE ออก) ⇒ ไม่เพิ่มด่าน (verify-0170 ล็อก)
-- ฟังก์ชันที่แตะ: oem_price_calc เท่านั้น (signature เดิม → rename→legacy + create → replay → drop · re-grant service_role เท่านั้น ข้อ 2 + 18)
-- 🔴 APPLIED แล้ว 9 ต.ค. 69 (เวลาไทย) version 20261008191238 — ห้าม apply ซ้ำ · golden replay 3758 เคส · verify-0170 OK 15 + mutant 8/8 / FAIL 0
-- ลอกจาก 0169 (ฉบับล่าสุด) แก้เฉพาะบล็อกที่ทำเครื่องหมาย "0170" · ชุดทดสอบ scripts/verify/verify-0170.sql · ไฟล์เป็น LF (ข้อ 20)

-- ============================================================================
-- 1. oem_price_calc — rename ของเดิม (ฉบับ 0169 บน DB) เป็น _legacy สำหรับ golden replay
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
  -- 0166: product (รายการสินค้า/บริการ)
  v_prod_id           uuid;
  v_prod_sku          text;
  v_prod_name         text;
  v_prod_category     text;
  v_prod_cost_type    text;
  v_prod_cost_src     text;
  v_prod_list         numeric;
  v_prod_price        numeric;
  v_prod_cost         numeric;
  v_prod_reason       text;
  v_prod_below        boolean;
  v_prod_txt          text;
  -- 0169: ราคาต่อชิ้นพิมพ์ทับของงานผลิต (silver/gold/brass)
  v_po                numeric;
  v_po_reason         text;
  v_po_txt            text;
  v_formula_price     numeric;
  v_m_eff             numeric;
  v_pvc_pass          boolean;
  v_m_nre             numeric; -- 0170: margin ที่ใช้คิด NRE ของรายการที่พิมพ์ราคาทับ
begin
  if p_shop_id is null then
    raise exception 'oem_price_calc: p_shop_id is required';
  end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'oem_price_calc: p_input must be a json object';
  end if;

  v_metal := p_input->>'metal';
  if v_metal is null or v_metal not in ('silver', 'gold', 'brass', 'silver999', 'product') then
    raise exception 'oem_price_calc: p_input.metal must be silver/gold/brass/silver999/product';
  end if;
  -- 0169: key ราคาพิมพ์ทับใช้ได้กับงานผลิตเท่านั้น — เงินแท่ง (ราคาพิเศษมีของตัวเอง 0163) และสินค้า (ราคาต่อชิ้นกรอกอยู่แล้ว) ส่งมา = ปฏิเสธ
  -- (ค่าว่าง/null = ไม่ส่ง · พฤติกรรมเดิมเป๊ะ — golden replay พิสูจน์)
  if v_metal in ('silver999', 'product')
     and (nullif(btrim(p_input->>'unit_price_override_thb'), '') is not null
          or nullif(btrim(p_input->>'price_override_reason'), '') is not null) then
    raise exception 'oem_price_calc: ราคาที่พิมพ์ทับ (unit_price_override_thb) ใช้ได้กับงานผลิต เงิน/ทอง/ทองเหลือง เท่านั้น'
      using errcode = '22023';
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
    -- 0165 L2: ลบอักขระล่องหน/bidi/zero-width ออกก่อน trim (เหตุผลที่มีแต่ U+2060/U+FEFF/U+202E ล้วนเคยผ่านด่าน "ห้ามว่าง"
    -- แล้วโผล่เป็นช่องว่างบนจอ admin) · ว่างหลังลบ = ไม่มีเหตุผล = raise ข้างล่าง · helper ตัวเดียวกับด่านชื่อลูกค้า
    v_ovr_reason := left(nullif(btrim(analytics.oem_text_strip_invisible(p_input->>'bar_price_override_reason'),
      E' \t\r\n\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000'), ''), 200);
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
  -- 0166: product (รายการสินค้า/บริการ) — แยกออกทั้งก้อนแล้ว return เหมือน silver999 · ไม่แตะบล็อกเงินแท่งและงานผลิต
  -- สองโหมดแยกด้วย product_id มี/ไม่มี:
  --   catalog (มี product_id): ชื่อ/SKU/ทุน/ราคาแคตตาล็อก อ่านจาก analytics.v_dim_product ของร้านนี้เท่านั้น (ไม่เชื่อ client)
  --     ส่ง unit_cost_thb มาด้วย = ปฏิเสธ (กันทับทุนแคตตาล็อก) · ราคาต่ำกว่า list_price ต้องมี price_reason
  --   manual (ไม่มี product_id): ต้องมี product_name + unit_cost_thb (ทุนบังคับ — เช่น กล่องสั่งทำ ค่าส่ง)
  -- floors.margin.value = null จงใจ (ไม่มีด่านทุนรายชิ้น) · ด่านรวมทั้งใบ (blended < 0 / hard floor หลังส่วนลด) อยู่ที่ oem_quote_save
  -- ทุกด่านรูปร่างข้างล่างใช้ "is null or not (between)" — ค่าที่ parse ไม่ได้/NaN/Infinity ตกเสมอ ไม่ใช่ผ่าน (3j-migration-traps ข้อ 4/13)
  -- ==========================================================================
  if v_metal = 'product' then
    v_is_complete := true;
    v_bkk_today := (now() at time zone 'Asia/Bangkok')::date;

    begin
      v_qty := nullif(btrim(p_input->>'qty'), '')::int;
    exception when others then
      v_qty := null;
    end;
    -- เพดาน 100,000: ราคา <= 1,000,000 x จำนวน ต้องไม่ล้น numeric(14,2) ของ quote_total/item_total
    if v_qty is null or not (v_qty > 0 and v_qty <= 100000) then
      raise exception 'oem_price_calc: p_input.qty ต้องเป็นจำนวนเต็ม 1 ถึง 100,000 (รายการสินค้า)'
        using errcode = '22023';
    end if;

    v_prod_txt := nullif(btrim(p_input->>'product_id'), '');
    if v_prod_txt is not null then
      begin
        v_prod_id := v_prod_txt::uuid;
      exception when others then
        raise exception 'oem_price_calc: p_input.product_id ไม่ใช่รหัสสินค้าที่ถูกต้อง' using errcode = '22023';
      end;
    end if;

    v_prod_txt := nullif(btrim(p_input->>'unit_price_thb'), '');
    if v_prod_txt is null then
      raise exception 'oem_price_calc: ต้องระบุราคาต่อชิ้น (p_input.unit_price_thb)' using errcode = '22023';
    end if;
    begin
      v_prod_price := v_prod_txt::numeric;
    exception when others then
      v_prod_price := null;
    end;
    if v_prod_price is null or not (v_prod_price > 0 and v_prod_price <= 1000000) then
      raise exception 'oem_price_calc: p_input.unit_price_thb ต้องเป็นตัวเลข > 0 และไม่เกิน 1,000,000' using errcode = '22023';
    end if;
    -- เงินต้องไม่เกิน 2 ตำแหน่ง ไม่งั้นราคาต่อชิ้นกับยอดรวมที่ปัดแล้วจะบวกกันไม่ลง
    if v_prod_price <> round(v_prod_price, 2) then
      raise exception 'oem_price_calc: p_input.unit_price_thb ต้องไม่เกิน 2 ตำแหน่งทศนิยม' using errcode = '22023';
    end if;

    -- เหตุผลราคา: ลบอักขระล่องหน/bidi ก่อน trim (เหมือนเหตุผลราคาพิเศษเงินแท่ง 0165 L2) — ว่างหลังลบ = ไม่มีเหตุผล
    v_prod_reason := left(nullif(btrim(analytics.oem_text_strip_invisible(p_input->>'price_reason'),
      E' \t\r\n\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000'), ''), 200);

    v_prod_txt := nullif(btrim(p_input->>'unit_cost_thb'), '');

    if v_prod_id is not null then
      -- ---------- catalog ----------
      if v_prod_txt is not null then
        raise exception 'oem_price_calc: สินค้าจากแคตตาล็อกห้ามส่งทุนมาเอง (p_input.unit_cost_thb) — ทุนอ่านจากแคตตาล็อก'
          using errcode = '22023';
      end if;

      select dp.sku, dp.name, dp.category, dp.cost_type, dp.list_price, dp.effective_unit_cost
        into v_prod_sku, v_prod_name, v_prod_category, v_prod_cost_type, v_prod_list, v_prod_cost
        from analytics.v_dim_product dp
        where dp.product_id = v_prod_id and dp.shop_id = p_shop_id;
      if not found then
        raise exception 'oem_price_calc: ไม่พบสินค้านี้ในแคตตาล็อกของร้านนี้' using errcode = '22023';
      end if;

      v_prod_cost_src := 'catalog';
      -- 0167 F4: ชื่อจากแคตตาล็อกลบอักขระล่องหน/bidi ก่อนเก็บ snapshot (ชื่อนี้พิมพ์บนใบลูกค้า — ชื่อ manual ผ่าน oem_customer_text_clean อยู่แล้ว
      -- แต่ชื่อใน catalog ไม่เคยผ่านด่านนี้) · ว่างหลังลบ → ใช้ SKU แทน
      v_prod_name := left(coalesce(nullif(btrim(analytics.oem_text_strip_invisible(v_prod_name)), ''), v_prod_sku), 200);

      -- ทุนแคตตาล็อก 0/null/NaN/ไม่สมเหตุผล = ไม่ครบ (ออกใบ quoted ไม่ได้) — ไม่ใช้ 0 เป็นทุน
      if v_prod_cost is null or not (v_prod_cost > 0 and v_prod_cost <= 1000000) then
        v_prod_cost := null;
        v_is_complete := false;
        v_missing := v_missing || jsonb_build_array(jsonb_build_object(
          'rate_key', 'catalog_unit_cost',
          'scope', v_prod_sku,
          'question_th', 'สินค้านี้ในแคตตาล็อกยังไม่มีต้นทุน — ตั้งต้นทุนในหน้า SKU ก่อน (หรือเลือกเป็นรายการไม่มี SKU แล้วกรอกทุนเอง)',
          'priority', 'P0'
        ));
      end if;

      -- ราคาแคตตาล็อกอ่านจาก DB เท่านั้น · between ฆ่า NaN · ไม่มี/ไม่สมเหตุผล = เทียบไม่ได้ (below = null + เตือน)
      if v_prod_list is not null and v_prod_list between 0.01 and 100000000 then
        v_prod_below := (v_prod_price < v_prod_list);
        if v_prod_below and v_prod_reason is null then
          raise exception 'oem_price_calc: ราคาต่ำกว่าราคาแคตตาล็อก ต้องระบุเหตุผล (p_input.price_reason)'
            using errcode = '22023';
        end if;
      else
        v_prod_list := null;
        v_prod_below := null;
        v_warnings := v_warnings || to_jsonb('สินค้านี้ไม่มีราคาแคตตาล็อก — ระบบเทียบราคาต่ำกว่าแคตตาล็อกให้ไม่ได้'::text);
      end if;
      v_warnings := v_warnings || to_jsonb('ต้นทุนจากแคตตาล็อกเป็นค่าประมาณ — กำไรของรายการนี้เป็น estimate'::text);
    else
      -- ---------- manual (ไม่มี SKU) ----------
      v_prod_cost_src := 'manual';
      v_prod_name := analytics.oem_customer_text_clean(p_input->>'product_name', 'ชื่อรายการ');
      if v_prod_name is null then
        raise exception 'oem_price_calc: รายการที่ไม่มี SKU ต้องระบุชื่อรายการ (p_input.product_name)' using errcode = '22023';
      end if;
      -- 0167 F3: รายการ "ไม่มี SKU" ที่ชื่อตรงเป๊ะ (lower + btrim, หลังลบอักขระล่องหน) กับ sku หรือชื่อสินค้าในแคตตาล็อกของร้าน = ปฏิเสธ —
      -- ไม่งั้นพิมพ์ชื่อสินค้าจริงเป็นรายการ manual แล้วกรอกราคา/ทุนเองหลบทั้งด่านเหตุผล "ต่ำกว่าแคตตาล็อก" และทุนแคตตาล็อก
      if exists (
        select 1 from public.product pr
        where pr.shop_id = p_shop_id
          and (lower(btrim(pr.sku)) = lower(v_prod_name)
               or lower(btrim(analytics.oem_text_strip_invisible(pr.name))) = lower(v_prod_name))
      ) then
        raise exception 'oem_price_calc: ชื่อรายการนี้ตรงกับสินค้าในแคตตาล็อก — เลือกจากแคตตาล็อกแทน' using errcode = '22023';
      end if;
      if v_prod_txt is null then
        raise exception 'oem_price_calc: รายการที่ไม่มี SKU ต้องระบุทุนต่อชิ้น (p_input.unit_cost_thb)' using errcode = '22023';
      end if;
      begin
        v_prod_cost := v_prod_txt::numeric;
      exception when others then
        v_prod_cost := null;
      end;
      if v_prod_cost is null or not (v_prod_cost > 0 and v_prod_cost <= 1000000) then
        raise exception 'oem_price_calc: p_input.unit_cost_thb ต้องเป็นตัวเลข > 0 และไม่เกิน 1,000,000' using errcode = '22023';
      end if;
      if v_prod_cost <> round(v_prod_cost, 2) then
        raise exception 'oem_price_calc: p_input.unit_cost_thb ต้องไม่เกิน 2 ตำแหน่งทศนิยม' using errcode = '22023';
      end if;
    end if;

    -- ทุนสูงกว่าราคา = เตือนอย่างเดียว (ไม่มีด่านทุนรายชิ้น) · ด่านจริงคือ margin รวมทั้งใบติดลบ ที่ oem_quote_save
    if v_prod_cost is not null and v_prod_cost > v_prod_price then
      v_warnings := v_warnings || to_jsonb('ทุนต่อชิ้นสูงกว่าราคาขาย — รายการนี้ขาดทุน (ถ้ากำไรรวมทั้งใบติดลบจะออกใบไม่ได้)'::text);
    end if;

    select * into v_set from analytics.oem_setting where shop_id = p_shop_id;
    if v_set.shop_id is null then
      v_set.margin_target_pct := 0.30; v_set.margin_discount_cap_pct := 0.25;
      v_set.margin_floor_pct := 0.20; v_set.margin_hard_floor_pct := 0.15;
      v_set.nre_max_share_pct := 0.25; v_set.min_job_value_thb := 8000;
    end if;

    if v_is_complete then
      v_price_piece := v_prod_price;
      v_cost_piece := v_prod_cost;
      v_pieces_subtotal := round(v_qty * v_price_piece, 2);
      v_quote_total := v_pieces_subtotal; -- ไม่มี NRE
      v_margin_actual := round((v_price_piece - v_cost_piece) / v_price_piece, 4);
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
        'metal', jsonb_build_object('per_piece', null, 'price_used', null, 'price_source', null),
        'labor', jsonb_build_object('per_piece', 0, 'steps', '[]'::jsonb),
        'batch', jsonb_build_object('per_piece', 0, 'lines', '[]'::jsonb),
        'nre', jsonb_build_object('cad', null, 'print3d', null, 'mold', null, 'cost', 0, 'price', 0),
        -- snapshot ของรายการ: แก้ catalog ทีหลังแล้วใบที่ save แล้วไม่ขยับ (ห้ามหลุดหน้าพิมพ์ — PrintableQuote ไม่มี field เหล่านี้)
        'product', jsonb_build_object(
          'product_id', v_prod_id,
          'sku', v_prod_sku,
          'name', v_prod_name,
          'category', v_prod_category,
          'cost_source', v_prod_cost_src,
          'cost_basis', case when v_prod_cost_src = 'catalog' then v_prod_cost_type else 'manual' end,
          'catalog_list_price', v_prod_list,
          'unit_price_thb', v_prod_price,
          'below_catalog', v_prod_below,
          'price_reason', v_prod_reason
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
        -- value = null จงใจ: ไม่มีด่านทุนรายชิ้นสำหรับรายการสินค้า (มติเจ้าของ 8 ต.ค. 69) ·
        -- oem_quote_save แยก "ไม่มีด่านรายชิ้นเพราะเป็นสินค้า" ออกจาก "ตรวจไม่ได้" ด้วย metal (มติ 5)
        'margin', jsonb_build_object(
          'state', null, 'value', null, 'blended', v_margin_actual, 'target', v_set.margin_target_pct
        ),
        'price_fresh', jsonb_build_object('pass', true, 'as_of_date', null, 'today_bkk', v_bkk_today)
      ),
      'warnings', v_warnings,
      'formula_version', 5
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
  v_m_eff := v_m; -- margin ที่ใช้ตัดสิน floor/แสดงผล — งานผลิตปกติ = v_m (เท่าเดิม) · มีราคาพิมพ์ทับ = margin ที่ได้จากราคานั้น (ข้างล่าง)

  -- 0169: ราคาต่อชิ้นพิมพ์ทับ (optional) — ต้นทุนยังคิดจากสูตรงานผลิตเหมือนเดิม ผู้ใช้พิมพ์ราคาต่อชิ้นทับแทนราคาที่ได้จาก margin %
  -- ต่ำกว่า margin floor = ด่านอ่อน (oem_quote_save บังคับ approval_note) · ต่ำกว่าทุนต่อชิ้น = ด่านแข็ง ไม่มีทางปลด (oem_quote_save)
  -- ตรวจรูปร่างด้วย not(between) ฆ่า NaN/Infinity (ข้อ 4) · ทศนิยม <= 2 · เหตุผลบังคับเมื่อมีราคา (whitelist oem_note_present) · เหตุผลลอย = 22023
  v_po_txt := nullif(btrim(p_input->>'unit_price_override_thb'), '');
  v_po_reason := left(nullif(btrim(analytics.oem_text_strip_invisible(p_input->>'price_override_reason'), chr(32) || chr(9) || chr(10) || chr(13)), ''), 200);
  if v_po_txt is not null then
    begin
      v_po := v_po_txt::numeric;
    exception when others then
      v_po := null;
    end;
    if v_po is null or not (v_po > 0 and v_po <= 1000000) then
      raise exception 'oem_price_calc: p_input.unit_price_override_thb ต้องเป็นตัวเลข > 0 และไม่เกิน 1,000,000' using errcode = '22023';
    end if;
    if v_po <> round(v_po, 2) then
      raise exception 'oem_price_calc: p_input.unit_price_override_thb ต้องไม่เกิน 2 ตำแหน่งทศนิยม' using errcode = '22023';
    end if;
    if not analytics.oem_note_present(v_po_reason) then
      raise exception 'oem_price_calc: ราคาที่พิมพ์ทับต้องระบุเหตุผล (p_input.price_override_reason)' using errcode = '22023';
    end if;
  elsif v_po_reason is not null then
    raise exception 'oem_price_calc: มีเหตุผลราคาที่พิมพ์ทับแต่ไม่มีราคา (p_input.unit_price_override_thb)' using errcode = '22023';
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

  -- 0169: ใช้ราคาที่พิมพ์ทับ (เฉพาะเมื่อคำนวณครบ) · price_per_piece = ราคาที่พิมพ์ = ราคาต่อชิ้นรวมทุกอย่างที่ระบบแสดงอยู่แล้ว
  -- NRE คงคิดจาก margin % เดิม (ทับเฉพาะราคาต่อชิ้น) · margin ที่ใช้ตัดสิน (v_m_eff) = margin ที่ได้จากราคานั้น:
  --   เงิน/ทองเหลือง: 1 - ทุนต่อชิ้น/ราคา · ทอง (pass-through): margin คิดเฉพาะค่ากำเหน็จ ⇒ 1 - (แรง+batch)/(ราคา - เนื้อทอง)
  --   (ความหมายเดียวกับ v_m ในสูตรเดิมที่ราคา = เนื้อทอง + (แรง+batch)/(1 - v_m)) · ราคา <= เนื้อทอง ⇒ -1
  -- price_vs_cost: ราคาที่พิมพ์ >= ทุนต่อชิ้น (cost_piece รวมเนื้อโลหะ) — ไม่ผ่าน = oem_quote_save ปฏิเสธเสมอ
  if v_po is not null and v_is_complete then
    v_formula_price := v_price_piece;
    v_price_piece := v_po;
    v_pvc_pass := (v_po >= v_cost_piece);
    if v_metal = 'gold' then
      v_m_eff := round(case when v_po - coalesce(v_metal_per_piece, 0) > 0
                            then 1 - (coalesce(v_labor_per_piece, 0) + coalesce(v_batch_per_piece, 0)) / (v_po - coalesce(v_metal_per_piece, 0))
                            else -1 end, 4);
    else
      v_m_eff := round(1 - v_cost_piece / v_po, 4);
    end if;
    v_warnings := v_warnings || to_jsonb('ราคาต่อชิ้นถูกพิมพ์ทับ — margin ที่แสดงคือ margin ของราคาที่พิมพ์ ต่ำกว่า floor ต้องมีเหตุผลอนุมัติ ต่ำกว่าทุนออกใบไม่ได้'::text);

    -- 0170 (มติเจ้าของ 9 ต.ค. 69): ค่า NRE (CAD/ปริ้น 3D/ก้อนยาง) ของรายการนี้ใช้ margin เดียวกับราคาที่พิมพ์ — ตามทั้งขึ้นและลง
    -- (เดิม 0169 คิด NRE จาก margin % ในช่อง ทำให้ราคาต่อชิ้นลดแต่ NRE ยังบวก margin เต็ม)
    --   margin ที่ใช้ = v_m_eff (นิยามเดียวกับด่าน margin: เงิน/ทองเหลือง 1 - ทุน/ราคา · ทอง 1 - (แรง+batch)/(ราคา - เนื้อทอง))
    --   v_m_eff <= 0 / NULL / NaN (ราคาที่พิมพ์ <= ทุน — ถูกปฏิเสธตอน quoted อยู่แล้ว แต่ draft/preview เกิดได้): NRE = ทุน NRE (ไม่ต่ำกว่าทุน NRE)
    --   v_m_eff > 0.95 (ใกล้ 1 → 1/(1-m) ระเบิด): clamp ที่ 0.95 แล้วเตือน · เทียบด้วย "= NaN" และช่วง ไม่ใช้ "<= 0" เดี่ยวๆ (NaN > ทุกค่าใน Postgres — ข้อ 4)
    --   ผลลัพธ์ปัดสองตำแหน่ง และไม่ต่ำกว่า ceil(ทุน NRE) สองตำแหน่งเสมอ · ไม่มี NRE (nre_cost = 0) → ไม่แตะ (NRE = 0 เหมือนเดิม)
    if v_nre_cost > 0 then
      if v_m_eff is null or v_m_eff = 'NaN'::numeric or v_m_eff <= 0 then
        v_m_nre := 0;
        v_warnings := v_warnings || to_jsonb('ราคาที่พิมพ์ไม่เกินทุน — ค่าออกแบบ (NRE) เก็บเท่าทุน NRE ไม่บวก margin'::text);
      elsif v_m_eff > 0.95 then
        v_m_nre := 0.95;
        v_warnings := v_warnings || to_jsonb('margin ของราคาที่พิมพ์สูงเกิน 95% — ค่าออกแบบ (NRE) คิดที่ margin 95% (เพดาน)'::text);
      else
        v_m_nre := v_m_eff;
      end if;
      v_nre_price := greatest(round(v_nre_cost / (1 - v_m_nre), 2), ceil(v_nre_cost * 100) / 100);
    end if;
  end if;

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

  if v_po is not null and v_is_complete then
    -- 0169: ราคาที่พิมพ์ — ต่ำกว่าทุน = hard_floor_breach (ออกใบไม่ได้) · ต่ำกว่า floor แต่ไม่ต่ำกว่าทุน = needs_approval_note (ด่านอ่อน)
    v_margin_state := case
      when not v_pvc_pass then 'hard_floor_breach'
      when v_m_eff < v_set.margin_floor_pct then 'needs_approval_note'
      when v_m_eff < v_set.margin_discount_cap_pct then 'discount_zone'
      else 'ok'
    end;
  else
    v_margin_state := case
      when v_m < v_set.margin_hard_floor_pct then 'hard_floor_breach'
      when v_m < v_set.margin_floor_pct then 'needs_approval_note'
      when v_m < v_set.margin_discount_cap_pct then 'discount_zone'
      else 'ok'
    end;
  end if;
  if v_margin_state <> 'ok' then
    v_warnings := v_warnings || to_jsonb(('margin ที่คิด ' || round(v_m_eff * 100, 1)::text || '% อยู่ในโซน ' || v_margin_state)::text);
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
    )
    -- 0169: key ใหม่ emit เฉพาะเมื่อมีราคาพิมพ์ทับ ⇒ ไม่มี override ได้ jsonb เดิมทุก byte (golden replay) · หน้า admin เท่านั้น — ห้ามเข้า PrintableQuote
    || case when v_po is not null then jsonb_build_object(
         'production_override', jsonb_build_object('thb', v_po, 'reason', v_po_reason, 'formula_price_per_piece', round(v_formula_price, 4), 'nre_margin_used', v_m_nre)
       ) else '{}'::jsonb end,
    'floors', jsonb_build_object(
      'qty', jsonb_build_object('pass', v_qty_pass, 'moq', v_moq, 'actual', v_qty),
      'job_value', jsonb_build_object('pass', v_jobvalue_pass, 'min', v_jobvalue_min),
      'metal_weight', jsonb_build_object('pass', v_metalweight_pass, 'applies', v_metalweight_applies),
      'margin', jsonb_build_object(
        'state', v_margin_state,
        'value', v_m_eff,
        'blended', v_margin_actual,
        'target', v_set.margin_target_pct
      )
    )
    -- 0169: pass=false ⇒ ราคาที่พิมพ์ต่ำกว่าทุนต่อชิ้น (oem_quote_save ปฏิเสธ quoted) · pass=null ⇒ ตัดสินไม่ได้ (คำนวณไม่ครบ — is_complete=false อยู่แล้ว)
    || case when v_po is not null then jsonb_build_object(
         'price_vs_cost', jsonb_build_object('applies', true, 'pass', v_pvc_pass)
       ) else '{}'::jsonb end,
    'warnings', v_warnings,
    'formula_version', 3
  );
end;
$$;

revoke execute on function analytics.oem_price_calc(uuid, jsonb) from public, anon, authenticated;
grant execute on function analytics.oem_price_calc(uuid, jsonb) to service_role;

-- ============================================================================
-- 2. Golden replay — ไม่มี override ต้องเท่า oem_price_calc_legacy (ฉบับ 0169) เป๊ะ · มี override ต่างเฉพาะ NRE (+ invariants)
-- ============================================================================
create function pg_temp.gr170_cmp(p_shop uuid, p_input jsonb) returns text
 language plpgsql as $h$
declare
  v_new jsonb;
  v_legacy jsonb;
  v_n2 jsonb;
  v_l2 jsonb;
  v_exp numeric;
  v_nrecost numeric;
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
  -- 0170: แถวที่มี production_override — ต้อง "ต่างเฉพาะ" ค่าที่เกี่ยวกับ NRE (nre.price · quote_total · job_value.pass · warnings · nre_margin_used)
  -- ส่วนอื่นเท่า legacy ทุก byte · และ invariants: NRE ไม่ต่ำกว่าทุน NRE · quote_total = NRE + ปัด(จำนวน x ราคาที่พิมพ์) · ไม่มี NRE = เท่า legacy
  if jsonb_typeof(v_new->'breakdown'->'production_override') = 'object' then
    v_n2 := v_new #- '{breakdown,nre,price}' #- '{breakdown,quote_total}' #- '{breakdown,production_override,nre_margin_used}' #- '{floors,job_value,pass}' #- '{warnings}';
    v_l2 := v_legacy #- '{breakdown,nre,price}' #- '{breakdown,quote_total}' #- '{breakdown,production_override,nre_margin_used}' #- '{floors,job_value,pass}' #- '{warnings}';
    if v_n2 is distinct from v_l2 then
      return format(E'MISMATCH (override row differs beyond NRE) shop=%s input=%s\n    new:    %s\n    legacy: %s', p_shop, p_input, v_new, v_legacy);
    end if;
    if (v_new->>'is_complete')::boolean then
      v_nrecost := (v_new->'breakdown'->'nre'->>'cost')::numeric;
      if v_nrecost > 0 then
        v_exp := round((v_new->'breakdown'->'nre'->>'price')::numeric
                       + round((v_new->'floors'->'qty'->>'actual')::numeric * (v_new->'breakdown'->'production_override'->>'thb')::numeric, 2), 2);
        if (v_new->'breakdown'->'nre'->>'price')::numeric < v_nrecost or v_exp <> (v_new->'breakdown'->>'quote_total')::numeric then
          return format(E'MISMATCH (NRE invariant) shop=%s input=%s\n    new: %s', p_shop, p_input, v_new);
        end if;
        return 'OK:override-nre';
      end if;
      if (v_new->'breakdown'->'nre'->>'price') is distinct from (v_legacy->'breakdown'->'nre'->>'price')
         or (v_new->'breakdown'->>'quote_total') is distinct from (v_legacy->'breakdown'->>'quote_total') then
        return format(E'MISMATCH (no-NRE override row must equal legacy) shop=%s input=%s', p_shop, p_input);
      end if;
    end if;
    return 'OK:override';
  end if;
  if v_new is distinct from v_legacy then
    return format(E'MISMATCH shop=%s input=%s\n    new:    %s\n    legacy: %s', p_shop, p_input, v_new, v_legacy);
  end if;
  return case when v_new->>'is_complete' = 'true' then 'OK:complete' else 'OK:incomplete' end;
end;
$h$;

do $gr170$
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
  v_pa uuid; v_pb uuid; v_pc uuid; v_pr text; v_pq int; v_pmode int; v_prsn text; v_pin jsonb;
  v_pform int; v_pqty int; v_n_ovr int := 0;
  v_ec jsonb; v_epf numeric; v_ecs numeric; v_eprices numeric[]; v_ep numeric; v_n_nre int := 0; v_n_ovrnre int := 0;
  v_n_prod int := 0; v_n_real_prod int := 0;
  v_sigs text[] := array[
    'analytics.oem_price_calc(uuid,jsonb)',
    'analytics.oem_quote_save(uuid,jsonb,uuid,text,text,text,text,numeric,text,date,uuid)',
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

  -- ---- 0d. แอปบน prod ปัจจุบัน: save 10 named params (ไม่มี p_actor_id) · save 11 named params · set_customer 4 named params ----
  -- ทุกแบบต้อง resolve ไปที่ฟังก์ชันใหม่ (ตกที่ด่านแรกก่อนแตะข้อมูล ไม่ใช่ "function does not exist"/ambiguous)
  v_caught := null;
  begin
    perform analytics.oem_quote_save(
      p_shop_id => gen_random_uuid(), p_items => '[]'::jsonb, p_quote_id => null, p_status => 'draft',
      p_approval_note => null, p_customer_name => null, p_customer_contact => null,
      p_discount_thb => 0, p_discount_reason => null, p_bar_valid_until => null);
  exception when others then
    v_caught := sqlerrm;
  end;
  if v_caught is null or v_caught not like '%p_items must be a non-empty json array%' then
    raise exception 'GOLDEN REPLAY FAILED: 10-named-args call of oem_quote_save did not resolve to the expected guard (got: %)', coalesce(v_caught, '(no error)');
  end if;
  v_caught := null;
  begin
    perform analytics.oem_quote_save(
      p_shop_id => gen_random_uuid(), p_items => '[]'::jsonb, p_quote_id => null, p_status => 'draft',
      p_approval_note => null, p_customer_name => null, p_customer_contact => null,
      p_discount_thb => 0, p_discount_reason => null, p_bar_valid_until => null, p_actor_id => gen_random_uuid());
  exception when others then
    v_caught := sqlerrm;
  end;
  if v_caught is null or v_caught not like '%p_items must be a non-empty json array%' then
    raise exception 'GOLDEN REPLAY FAILED: 11-named-args call of oem_quote_save did not resolve to the expected guard (got: %)', coalesce(v_caught, '(no error)');
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
              for v_form in 0..4 loop
                v_input := jsonb_build_object(
                  'metal', 'silver999', 'bar_size', v_size, 'qty', v_qty,
                  'engrave_image_thb', v_img, 'engrave_text_thb', v_txt, 'as_of_date', null);
                if v_form = 1 then
                  v_input := v_input || jsonb_build_object('bar_price_override_thb', null, 'bar_price_override_reason', null);
                elsif v_form = 2 then
                  v_input := v_input || jsonb_build_object('bar_price_override_thb', '', 'bar_price_override_reason', E'  \t ');
                elsif v_form = 3 then
                  -- ราคาพิเศษ + เหตุผลปกติ (ไทย/อังกฤษ/มีช่องว่างหัวท้าย/อีโมจิ) — ผลต้องเท่า legacy เป๊ะ (ทั้ง raise/ไม่ครบ/ต่ำกว่าทุน)
                  v_input := v_input || jsonb_build_object('bar_price_override_thb', 500, 'bar_price_override_reason', E'  bid ทดสอบ A  ');
                elsif v_form = 4 then
                  v_input := v_input || jsonb_build_object('bar_price_override_thb', 1500.5, 'bar_price_override_reason', 'ล็อกราคาล่วงหน้า Co., Ltd. 👨\u200D👩\u200D👧');
                end if;
                v_res := pg_temp.gr170_cmp(v_shop, v_input);
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
        for v_row in select id, shop_id, input from analytics.oem_quote_item where input->>'metal' is distinct from 'product' loop
          v_n_real := v_n_real + 1;
          v_res := pg_temp.gr170_cmp(v_row.shop_id, v_row.input);
          v_n_cmp := v_n_cmp + 1;
          if v_res not like 'OK:%' then
            v_n_mismatch := v_n_mismatch + 1;
            if v_n_mismatch <= 5 then
              v_detail := v_detail || E'\n  [real item ' || v_row.id || '] ' || v_res;
            end if;
          end if;
        end loop;
      end if;

      raise exception 'gr170 rollback marker' using errcode = 'P0165';
    exception when sqlstate 'P0165' then
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
          v_res := pg_temp.gr170_cmp(v_synth_shop, v_input);
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

  -- ==========================================================================
  -- Part C — รายการสินค้า metal='product' (legacy = ฉบับ 0166): ผลต้องเท่ากันทุกเคสที่ไม่เข้า F3/F4
  -- (ชื่อ manual ตรงแคตตาล็อก / ชื่อแคตตาล็อกมีอักขระล่องหน — พฤติกรรมใหม่ที่ตั้งใจ ล็อกใน verify-0167 แทน) · แถวจริงที่เป็น product
  -- ไม่เข้า Part A (อาจต่างเพราะ F3) — นับแยกท้ายไฟล์
  -- ==========================================================================
  -- Part D — งานผลิต silver/gold/brass: key ราคาพิมพ์ทับในรูปแบบที่ "ไม่ใช่ override" (ไม่ส่ง / null / ว่าง / ช่องว่าง) ต้องให้ jsonb เท่า legacy (ฉบับ 0169) เป๊ะ
  foreach v_metal_s in array array['silver', 'gold', 'brass'] loop
    foreach v_pqty in array array[1, 5, 50] loop
      for v_pform in 1..4 loop
        v_input := jsonb_build_object(
          'metal', v_metal_s, 'item_kind', v_item_kind_val, 'polish_tier', v_polish_tier_val,
          'qty', v_pqty, 'weight_g', 3.5, 'is_new_design', true,
          'purity', case when v_metal_s = 'gold' then 0.965 else null end,
          'plating_type', null, 'gem_tier', null, 'gem_count', 0, 'as_of_date', null, 'margin_pct', null);
        v_input := v_input || case v_pform
          when 2 then jsonb_build_object('unit_price_override_thb', null, 'price_override_reason', null)
          when 3 then jsonb_build_object('unit_price_override_thb', '', 'price_override_reason', '')
          when 4 then jsonb_build_object('unit_price_override_thb', '  ', 'price_override_reason', '  ')
          else '{}'::jsonb end;
        v_n_ovr := v_n_ovr + 1;
        v_res := pg_temp.gr170_cmp(v_synth_shop, v_input);
        v_n_cmp := v_n_cmp + 1;
        if v_res not like 'OK:%' then
          v_n_mismatch := v_n_mismatch + 1;
          if v_n_mismatch <= 5 then
            v_detail := v_detail || E'\n  [production override-key forms] ' || v_res;
          end if;
        end if;
      end loop;
    end loop;
  end loop;

  -- Part E — งานผลิตที่พิมพ์ราคาทับ (silver/gold/brass x แบบใหม่(มี NRE)/แบบเดิม x จำนวน x ราคาที่พิมพ์ 5 ระดับ รวมต่ำกว่าทุน):
  -- legacy (0169) ต่างจากใหม่เฉพาะ NRE และ key nre_margin_used — gr170_cmp ตรวจ invariants ให้ทุกเคส
  foreach v_metal_s in array array['silver', 'gold', 'brass'] loop
    foreach v_newdesign_flag in array array[true, false] loop
      foreach v_pqty in array array[5, 50] loop
        v_input := jsonb_build_object(
          'metal', v_metal_s, 'item_kind', v_item_kind_val, 'polish_tier', v_polish_tier_val,
          'qty', v_pqty, 'weight_g', 3.5, 'is_new_design', v_newdesign_flag,
          'purity', case when v_metal_s = 'gold' then 0.965 else null end,
          'plating_type', null, 'gem_tier', null, 'gem_count', 0, 'as_of_date', null, 'margin_pct', null);
        v_ec := analytics.oem_price_calc(v_synth_shop, v_input);
        if (v_ec->>'is_complete')::boolean then
          v_epf := (v_ec->'breakdown'->>'price_per_piece')::numeric;
          v_ecs := (v_ec->'breakdown'->>'cost_piece')::numeric;
          v_eprices := array[round(v_epf * 1.5, 2), round(v_epf, 2), round(v_epf * 0.9, 2),
                             round(ceil((v_ecs + 0.01) * 100) / 100, 2), round(floor(v_ecs * 0.95 * 100) / 100, 2)];
          foreach v_ep in array v_eprices loop
            if v_ep > 0 then
              v_n_nre := v_n_nre + 1;
              v_res := pg_temp.gr170_cmp(v_synth_shop, v_input || jsonb_build_object('unit_price_override_thb', v_ep, 'price_override_reason', 'gr170'));
              v_n_cmp := v_n_cmp + 1;
              if v_res = 'OK:override-nre' then v_n_ovrnre := v_n_ovrnre + 1; end if;
              if v_res not like 'OK:%' then
                v_n_mismatch := v_n_mismatch + 1;
                if v_n_mismatch <= 5 then
                  v_detail := v_detail || E'\n  [production override x NRE] ' || v_res;
                end if;
              end if;
            end if;
          end loop;
        end if;
      end loop;
    end loop;
  end loop;
  if v_synth_shop is not null and exists (select 1 from analytics.oem_cost_rate where shop_id = v_synth_shop) and v_n_ovrnre = 0 then
    raise exception 'GOLDEN REPLAY FAILED: no override case with NRE > 0 was replayed (proves nothing)';
  end if;

  select count(*) into v_n_real_prod from analytics.oem_quote_item where input->>'metal' = 'product';
  if v_real_shop is not null then
    begin
      insert into public.product (shop_id, sku, name, unit_cost, list_price, category, cost_type)
        values (v_real_shop, 'GR167-A', 'gr170 สินค้า A', 600, 1000, 'ทดสอบ', 'fixed') returning id into v_pa;
      insert into public.product (shop_id, sku, name, unit_cost, list_price, category, cost_type)
        values (v_real_shop, 'GR167-B', 'gr170 สินค้า B', 0, 500, 'ทดสอบ', 'fixed') returning id into v_pb;
      insert into public.product (shop_id, sku, name, unit_cost, list_price, category, cost_type)
        values (v_real_shop, 'GR167-C', 'gr170 สินค้า C', 100, null, 'ทดสอบ', 'fixed') returning id into v_pc;
      foreach v_pr in array array['1', '500', '999.99', '1000', '1500', '0', 'NaN', '1.005', ''] loop
        foreach v_pq in array array[1, 3, 0] loop
          foreach v_prsn in array array['', 'เหตุผลทดสอบ'] loop
            for v_pmode in 1..7 loop
              v_pin := jsonb_build_object('metal', 'product', 'qty', v_pq);
              if v_pr <> '' then v_pin := v_pin || jsonb_build_object('unit_price_thb', v_pr); end if;
              if v_prsn <> '' then v_pin := v_pin || jsonb_build_object('price_reason', v_prsn); end if;
              v_pin := v_pin || case v_pmode
                when 1 then jsonb_build_object('product_id', v_pa)
                when 2 then jsonb_build_object('product_id', v_pb)
                when 3 then jsonb_build_object('product_id', v_pc)
                when 4 then jsonb_build_object('product_name', 'gr170-ชื่อไม่ซ้ำแคตตาล็อก', 'unit_cost_thb', 60)
                when 5 then jsonb_build_object('unit_cost_thb', 60)
                when 6 then jsonb_build_object('product_name', 'gr170-ชื่อไม่ซ้ำแคตตาล็อก')
                else jsonb_build_object('product_id', v_pa, 'unit_cost_thb', 5)
              end;
              v_n_prod := v_n_prod + 1;
              v_res := pg_temp.gr170_cmp(v_real_shop, v_pin);
              v_n_cmp := v_n_cmp + 1;
              if v_res not like 'OK:%' then
                v_n_mismatch := v_n_mismatch + 1;
                if v_n_mismatch <= 5 then
                  v_detail := v_detail || E'\n  [product matrix] ' || v_res;
                end if;
              end if;
            end loop;
          end loop;
        end loop;
      end loop;
      raise exception 'gr170 rollback marker' using errcode = 'P0167';
    exception when sqlstate 'P0167' then
      null;
    end;
  end if;

  if v_n_mismatch > 0 then
    raise exception 'GOLDEN REPLAY FAILED: % / % cases mismatched legacy (showing up to 5).%',
      v_n_mismatch, v_n_cmp, v_detail;
  end if;
  -- ถ้าทั้ง replay ไม่มีเคส "ราคาครบ" เลย = ไม่ได้พิสูจน์สูตรราคา (พิสูจน์ได้แค่ทางไม่ครบ)
  if v_real_shop is not null and v_n_complete = 0 then
    raise exception 'GOLDEN REPLAY FAILED: no complete silver999 case was replayed (proves nothing)';
  end if;

  raise notice 'GOLDEN REPLAY OK: % comparisons vs legacy (silver999 matrix x 6 shop states: % complete; % real oem_quote_item rows (non-product; % real product rows skipped); % synthetic production cases; % product matrix cases; % override-key-form cases; % production-override cases (% with NRE > 0, differ from legacy only in NRE + invariants checked)); grants + 1-row-per-function + 9/10/11-named-args save verified. Dropping oem_price_calc_legacy next.',
    v_n_cmp, v_n_complete, v_n_real, v_n_real_prod, v_n_synth, v_n_prod, v_n_ovr, v_n_nre, v_n_ovrnre;
end $gr170$;

-- ถึงบรรทัดนี้ได้ก็ต่อเมื่อ do-block ไม่ raise (ถ้า raise ทั้ง transaction abort = rollback ทั้ง migration)
drop function pg_temp.gr170_cmp(uuid, jsonb);
drop function if exists analytics.oem_price_calc_legacy(uuid, jsonb);

notify pgrst, 'reload schema';
