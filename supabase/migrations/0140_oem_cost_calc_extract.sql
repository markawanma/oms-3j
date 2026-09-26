-- 0140_oem_cost_calc_extract.sql
--
-- ทำไม: เจ้าของเปิดหน้าใบผลิตแล้วงง ("ไม่มีให้กรอกจำนวนกรัม หรือว่าผลิตแบบมี
-- พลอยไหม แบบเรียบ/กลาง/ยาก เลย ต้นทุนจะคำนวณยังไง") — ของจริงคือใบผลิต
-- (analytics.production_cost_calc, 0131) ใช้แค่ น้ำหนัก x ราคาเงิน x ความ
-- บริสุทธิ์ + ค่าแรงก้อนเดียว ส่วนความรู้เรื่องระดับงาน/พลอย/ชุบ/ของเสีย
-- (34 ตัวแปร กรอกครบแล้ว) อยู่ในเครื่องคิด OEM (analytics.oem_price_calc,
-- 0062 -> ... -> 0083) ทั้งหมด เจ้าของสั่ง: "เอาผลิต OEM มาวางสำหรับผลิตเอง
-- แต่ไม่คิด Margin ไม่ต้องคำนวณ floor"
--
-- รอบนี้ทำแค่แยกชั้น "ต้นทุน" ออกจากชั้น "ราคาขาย" ของ oem_price_calc ให้ใบ
-- ผลิตของตัวเองเรียกใช้เฉพาะครึ่งต้นทุนได้ในอนาคต — ยังไม่มีใครเรียกใช้
-- analytics.oem_cost_calc ตัวใหม่นี้จริงในรอบนี้
--
-- ที่ตั้งใจไม่ทำรอบนี้ (สั่งไว้ชัดเจน เขียนกำกับไว้กันสับสน):
--   - ไม่มี caller ใหม่เรียก oem_cost_calc (analytics.product.make_spec /
--     production_cost_calc โหมดที่ 3 = รอบถัดไป)
--   - ไม่แก้ current_date (UTC, skill 3j-migration-traps ข้อ 6) ใน
--     oem_price_calc — แก้แล้ว golden replay ท้ายไฟล์นี้จะไม่เท่า (as_of_date
--     ผูกกับวันจริงที่รัน migration) เป็นหนี้แยกที่รู้ตัว ไม่ใช่ของ 0140
--   - ไม่แตะ v_dim_product / transform_pending_order_lines / stock_lot
--   - ไม่แตะ analytics.oem_quote_save / oem_quote_renegotiate /
--     oem_receipt_* / analytics.oem_rate_def / oem_cost_rate / oem_setting
--   - ไม่แตะ branch silver999 (เงินแท่ง) ของ oem_price_calc แม้แต่บรรทัด
--     เดียว — ราคาเงินแท่งไม่ linear ตามน้ำหนัก มีสูตรของตัวเอง (ดู
--     oem-quote-invariants ข้อ 4) copy มาจาก 0083 คำต่อคำ ไม่แก้ไขอะไรเลย
--     oem_cost_calc เองก็ปฏิเสธ metal='silver999' explicit (กัน caller ใน
--     อนาคตเรียกผิดทาง แทนที่จะปล่อยให้มันเงียบๆ คำนวณผิด)
--
-- แนวคิดการแยก (ยืนยันจาก architect แล้ว — ใช้ได้เลย): ใน oem_price_calc เดิม
-- (0083 บรรทัด ~615) cost_piece = metal_per_piece + labor_per_piece +
-- batch_per_piece และ margin (v_m) ไม่แตะ 3 ก้อนนี้เลย ใช้แค่ตอนคิด
-- price_piece / nre_price / floors ชั้นต้นทุนแยกอยู่แล้วในเชิงตรรกะ งานนี้
-- แค่ "ตัดที่รอยต่อ": ย้าย validate input -> อ่าน rate -> คำนวณ
-- metal/labor/batch/nre_cost -> missing[] ออกมาเป็น analytics.oem_cost_calc
-- แล้วให้ oem_price_calc เรียกใช้แทนของที่เคยคำนวณเองในบรรทัดเดียวกัน
--
-- oem_cost_calc คืนตัวเลขที่ยังไม่ปัดเศษไว้ใต้คีย์ `_raw` (jsonb เก็บ numeric
-- เต็มความละเอียด) — oem_price_calc ดึงมา round(...,N) ที่จุดเดิมทุกจุดเป๊ะ
-- (เหมือน 0083 ก่อนแยก) แล้ว "ห้าม _raw หลุดออกไปใน output เด็ดขาด" —
-- oem_price_calc ประกอบ jsonb ขาออกทีละ field จากตัวแปร local เท่านั้น ไม่
-- เคย spread ก้อน _raw หรือผลลัพธ์ดิบของ oem_cost_calc ออกไปตรงๆ (แพทเทิร์น
-- เดียวกับ oem-quote-invariants ข้อ 1 "ประกอบทีละ field ห้าม spread" — ที่นี่
-- คือกัน _raw แทนกันต้นทุนหลุดถึงลูกค้า)
--
-- input ใหม่ (optional เฉพาะ oem_cost_calc): metal_price_thb_per_gram — ถ้า
-- ส่งมา ข้าม lookup analytics.oem_metal_price (as_of_date<=) และ fallback
-- shop_setting ทั้งหมด ใช้ค่าที่ส่งมาตรงๆ + price_source='caller' — เหตุผล:
-- ใบผลิตของตัวเอง "ห้ามพึ่งราคาเก่า/fallback เด็ดขาด" (0131 §M1: caller ต้อง
-- ส่งราคาที่หน้าจอเพิ่งอ่านมาสดๆ มาด้วยเสมอ ไม่งั้น reject) ด่านนี้บังคับที่
-- ตัวฟังก์ชันเอง (validate ช่วงค่า + กัน NaN/Infinity แบบ not(between) ตาม
-- skill 3j-migration-traps ข้อ 4) ไม่ใช่พึ่งวินัยของ caller — ไม่ส่งคีย์นี้มา
-- = พฤติกรรมเดิมทุกประการ (lookup ปกติ) ของเดิมที่ไม่เคยส่งคีย์นี้เลย
-- (toCalcInputPayload ใน lib/actions/oem.ts) จึงไม่กระทบ flow ปัจจุบันแม้แต่
-- น้อย
--
-- Grants: oem_cost_calc เป็นของภายในล้วน (ไม่มี UI เรียกตรง) -> service_role
-- เท่านั้น แคบกว่า oem_price_calc (authenticated + service_role) ตามที่สั่ง
-- — เช็คโค้ดจริงแล้วว่า lib/actions/oem.ts ทุก action (รวม calcPrice ที่เรียก
-- oem_price_calc ตรง) ใช้ getServiceClient() (SUPABASE_SERVICE_ROLE_KEY)
-- ล้วน ไม่มี client แบบ authenticated/RLS เรียก RPC นี้จาก UI เลยสักจุด ดังนั้น
-- เวลา oem_price_calc (ซึ่งรันเป็น service_role อยู่แล้วตอนถูกเรียกจริง) เรียก
-- oem_cost_calc ต่อภายใน (ทั้งคู่ security invoker ไม่มีตัวไหน definer — ตาม
-- คำเตือนเดิมใน 0065 "DO NOT change oem_price_calc to SECURITY DEFINER")
-- การเรียกภายในนั้นก็ยังรันเป็น service_role เหมือนกัน จึงไม่พัง /oem/quote
-- แม้ grant จะแคบกว่า — grant ที่ authenticated ยังมีต่อ oem_price_calc เอง
-- (defense-in-depth เดิม ไม่ใช่ทางที่ใช้งานจริง) คงไว้เท่าเดิมไม่ต่างจาก 0083
--
-- Signature เดิมเป๊ะของ oem_price_calc(uuid, jsonb) — ไม่ drop function ไม่
-- เปลี่ยน arg list สักตัว (create or replace ตรงๆ ปลอดภัยตาม skill
-- 3j-migration-traps ข้อ 1) oem_cost_calc เป็นฟังก์ชันใหม่ล้วน ไม่มี overload
-- ชนอยู่แล้ว
--
-- ============================================================================
-- Golden replay (หัวใจของไฟล์นี้ — ดู do-block ท้ายไฟล์):
--   rename oem_price_calc เดิม -> oem_price_calc_legacy
--   -> create oem_cost_calc + oem_price_calc ตัวใหม่ (เรียก oem_cost_calc)
--   -> replay ทุกแถวจริงใน analytics.oem_quote_item.input ที่ metal <>
--      'silver999' เทียบ oem_price_calc(ใหม่) vs oem_price_calc_legacy(เดิม)
--      ต้องได้ jsonb เท่ากันเป๊ะทุกแถว (jsonb `=` เทียบตามค่า ไม่สนลำดับคีย์
--      — Postgres normalize object key order ตั้งแต่ parse แล้ว)
--   -> + ชุดสังเคราะห์ 24 เคส (3 โลหะ silver/gold/brass x มีพลอย/ไม่มี x
--      มีชุบ/ไม่มี x new_design/ไม่ — ครอบ gold pass-through ตามที่สั่ง เพราะ
--      ถ้า prod ไม่มีใบ jewelry จริงเลย (มีแต่ใบแท่งเงิน) ชุดสังเคราะห์คือ
--      หลักฐานเดียว) เทียบด้วยวิธีเดียวกัน
--   -> ไม่เท่าแม้แถวเดียว (หรือ error ไม่ตรงกัน) = raise exception ทันที ->
--      ทั้ง migration (รวม rename/create ข้างบนทั้งหมด) rollback ไม่ commit
--      อะไรเลย ตาม skill 3j-migration-traps ข้อ 11
--   -> เท่ากันหมด + เช็ค grant/overload ผ่านหมด -> drop
--      oem_price_calc_legacy ปิดท้าย แล้ว raise notice สรุปจำนวนแถว/เคสที่
--      เทียบผ่าน (ดูข้อความ notice หลัง apply เพื่อรู้ว่าหลักฐานมาจากใบจริง
--      กี่ใบ/สังเคราะห์กี่เคส — ณ เวลาที่เขียนไฟล์นี้ยังไม่ทราบว่า prod มีใบ
--      jewelry จริงกี่ใบ ใบจริงที่ยืนยันแล้วมีแค่ใบแท่งเงิน RT-2608-016)
-- ============================================================================

-- ============================================================================
-- 1. analytics.oem_cost_calc — ชั้นต้นทุนล้วน ย้ายออกมาจาก oem_price_calc
--    ของ 0083 (บรรทัด 382-615 ของไฟล์นั้น) คำต่อคำ ไม่เปลี่ยน logic เลยสักจุด
--    นอกจาก (a) เติม metal_price_thb_per_gram override ตามที่สั่ง (b) เติม
--    metal guard ปฏิเสธ silver999 explicit (ของเดิมไม่เคยรันมาถึงส่วนนี้อยู่
--    แล้วเพราะ oem_price_calc คัดสาขา silver999 ออกไปตั้งแต่ก่อนเรียก แต่
--    ฟังก์ชันนี้อาจถูกเรียกตรงในอนาคต ต้องป้องกันตัวเอง ไม่พึ่ง caller)
-- ============================================================================
create or replace function analytics.oem_cost_calc(p_shop_id uuid, p_input jsonb)
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
  v_missing jsonb := '[]'::jsonb;
  v_r_cast numeric; v_r_polish numeric; v_r_plate numeric; v_r_total numeric;
  v_q_run  numeric;
  v_price_used numeric; v_price_source text;
  v_metal_price_override numeric;
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
  v_nre_cost numeric := 0;
  v_cost_piece numeric;
  v_is_complete boolean;
begin
  if p_shop_id is null then
    raise exception 'oem_price_calc: p_shop_id is required';
  end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'oem_price_calc: p_input must be a json object';
  end if;

  v_metal := p_input->>'metal';
  -- 0140: silver999 (เงินแท่ง) ไม่ใช่ของชั้นนี้ — สูตรไม่ linear ตามน้ำหนัก
  -- อยู่ใน oem_price_calc branch ของตัวเองทั้งก้อน (ห้ามแตะ) ปฏิเสธที่นี่
  -- explicit กัน future caller (production_cost_calc โหมด 3) เรียกผิดทาง
  if v_metal is null or v_metal not in ('silver', 'gold', 'brass') then
    raise exception 'oem_cost_calc: p_input.metal must be silver/gold/brass (silver999 bars are priced in oem_price_calc, not this cost layer)';
  end if;

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
  -- not(between) จับ NaN/Infinity ให้ฟรี (skill 3j-migration-traps ข้อ 4) —
  -- ย้ายมาจาก oem_price_calc คำต่อคำ
  if v_weight_g is null or not (v_weight_g > 0 and v_weight_g <= 100000) then
    raise exception 'oem_price_calc: p_input.weight_g must be a finite number > 0 and <= 100,000';
  end if;
  v_is_new_design := coalesce((p_input->>'is_new_design')::boolean, true);
  v_as_of := coalesce((p_input->>'as_of_date')::date, current_date);
  v_plating_type := nullif(btrim(p_input->>'plating_type'), '');
  v_gem_tier := nullif(btrim(p_input->>'gem_tier'), '');
  v_gem_count := coalesce(nullif(p_input->>'gem_count', '')::numeric, 0);
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
  if v_purity is not null and not (v_purity > 0 and v_purity <= 1) then
    raise exception 'oem_price_calc: p_input.purity must be a finite number > 0 and <= 1';
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

  -- 0140: metal_price_thb_per_gram override — ใบผลิตของตัวเองส่งราคาที่
  -- หน้าจอเพิ่งอ่านมาสดๆ มาตรงนี้ ข้าม lookup/fallback ทั้งหมด (0131 §M1:
  -- ห้ามพึ่งราคาเก่า) ไม่ส่งคีย์นี้มา = พฤติกรรมเดิมทุกประการ (lookup
  -- as_of_date<= แล้ว fallback shop_setting.silver_spot_thb_per_gram เฉพาะ
  -- silver — โค้ดในบล็อก else ด้านล่างคือของเดิมจาก 0083 ไม่แก้ไข)
  v_metal_price_override := nullif(p_input->>'metal_price_thb_per_gram', '')::numeric;
  if v_metal_price_override is not null then
    if not (v_metal_price_override > 0 and v_metal_price_override <= 1000000) then
      raise exception 'oem_cost_calc: p_input.metal_price_thb_per_gram must be a finite number > 0 and <= 1,000,000';
    end if;
    v_price_used := v_metal_price_override;
    v_price_source := 'caller';
  else
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
  else
    v_cad := 0; v_print3d := 0; v_mold := 0; v_nre_cost := 0;
  end if;

  -- 0140: cost_piece เดิม (0083 บรรทัด 615) — margin ไม่แตะ 3 ก้อนนี้เลย นี่
  -- คือขอบเขตของชั้นต้นทุนทั้งหมด nre_price (margin-dependent) อยู่ชั้นราคา
  -- ไม่ใช่ที่นี่
  v_cost_piece := coalesce(v_metal_per_piece, 0) + coalesce(v_labor_per_piece, 0) + coalesce(v_batch_per_piece, 0);

  v_is_complete := (jsonb_array_length(v_missing) = 0);

  return jsonb_build_object(
    'is_complete', v_is_complete,
    'missing', v_missing,
    'price_source', v_price_source,
    'labor_steps', v_labor_steps,
    'batch_lines', v_batch_lines,
    '_raw', jsonb_build_object(
      'as_of_date', v_as_of,
      'qty', v_qty,
      'weight_g', v_weight_g,
      'q_run', v_q_run,
      'reject_pct_total', v_r_total,
      'price_used', v_price_used,
      'gross_loss_pct', v_sprue,
      'polish_loss_pct', v_polish_loss,
      'effective_loss_pct', v_loss_eff,
      'metal_per_piece', v_metal_per_piece,
      'labor_per_piece', v_labor_per_piece,
      'batch_per_piece', v_batch_per_piece,
      'cad', v_cad,
      'print3d', v_print3d,
      'mold', v_mold,
      'nre_cost', v_nre_cost,
      'cost_piece', v_cost_piece
    )
  );
end;
$$;

revoke execute on function analytics.oem_cost_calc(uuid, jsonb) from public, anon, authenticated;
grant execute on function analytics.oem_cost_calc(uuid, jsonb) to service_role;

-- ============================================================================
-- 2. oem_price_calc — rename ของเดิมไปเป็น _legacy ชั่วคราว (ใช้ใน golden
--    replay ด้านล่าง) แล้วสร้างของใหม่ signature เดิมเป๊ะ (uuid, jsonb) —
--    branch silver999 copy มาจาก 0083 คำต่อคำ ไม่แตะแม้แต่บรรทัดเดียว ส่วน
--    branch งานผลิต (silver/gold/brass) เหลือเฉพาะชั้นราคา: margin,
--    nre_price, floors (qty/job_value/metal_weight/margin), warnings,
--    ประกอบ jsonb คืนค่า — เรียก oem_cost_calc แทนคำนวณเอง
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
grant execute on function analytics.oem_price_calc(uuid, jsonb) to authenticated, service_role;

-- ============================================================================
-- 3. Golden replay — ยืนยันว่า oem_price_calc ตัวใหม่ให้ jsonb เท่ากับ
--    oem_price_calc_legacy เป๊ะทุกแถวจริง + ชุดสังเคราะห์ 24 เคส ก่อนจะยอม
--    drop ของเก่า ไม่เท่าแม้แถวเดียว = raise exception = ทั้ง migration
--    rollback (ตาม skill 3j-migration-traps ข้อ 11)
-- ============================================================================
do $$
declare
  v_overload_count int;

  -- Part A: replay ทุกแถวจริง
  v_row record;
  v_new jsonb;
  v_legacy jsonb;
  v_n_real int := 0;
  v_n_real_mismatch int := 0;
  v_real_detail text := '';

  -- Part B: ชุดสังเคราะห์
  v_synth_shop uuid;
  v_polish_tier_val text;
  v_item_kind_val text;
  v_gem_tier_val text;
  v_plating_type_val text;
  v_metal_s text;
  v_gem_flag boolean;
  v_plate_flag boolean;
  v_newdesign_flag boolean;
  v_case_no int := 0;
  v_n_synth int := 0;
  v_n_synth_mismatch int := 0;
  v_synth_detail text := '';
  v_input jsonb;

  -- Part C: metal_price_thb_per_gram override (ฟีเจอร์ใหม่ — ไม่มี legacy
  -- ให้เทียบ ทดสอบพฤติกรรมตรงแทน)
  v_override_input jsonb;
  v_should_have_raised boolean;
begin
  -- ---- 0. static guard: ห้ามมี overload ค้าง (skill 3j-migration-traps ข้อ 1) ----
  select count(*) into v_overload_count from pg_proc
    where pronamespace = 'analytics'::regnamespace and proname = 'oem_price_calc';
  if v_overload_count <> 1 then
    raise exception 'GOLDEN REPLAY FAILED: expected exactly 1 analytics.oem_price_calc, found % (overload?)', v_overload_count;
  end if;
  select count(*) into v_overload_count from pg_proc
    where pronamespace = 'analytics'::regnamespace and proname = 'oem_cost_calc';
  if v_overload_count <> 1 then
    raise exception 'GOLDEN REPLAY FAILED: expected exactly 1 analytics.oem_cost_calc, found % (overload?)', v_overload_count;
  end if;

  -- ---- 0b. static guard: grant ตรงตามที่ตั้งใจ (skill ข้อ 2 + ข้อห้าม #6) ----
  if has_function_privilege('anon', 'analytics.oem_cost_calc(uuid,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'analytics.oem_cost_calc(uuid,jsonb)', 'execute') then
    raise exception 'GOLDEN REPLAY FAILED: oem_cost_calc execute privilege leaked to anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'analytics.oem_cost_calc(uuid,jsonb)', 'execute') then
    raise exception 'GOLDEN REPLAY FAILED: oem_cost_calc missing service_role execute grant';
  end if;
  if has_function_privilege('anon', 'analytics.oem_price_calc(uuid,jsonb)', 'execute') then
    raise exception 'GOLDEN REPLAY FAILED: oem_price_calc execute privilege leaked to anon';
  end if;
  -- ⚠️ SUPERSEDED BY 0147 (22 ก.ย. 69) — ด่านนี้ล้าสมัยแล้ว ห้ามลอกไปใช้กับฟังก์ชันใหม่
  -- 0147 ถอน execute ของ authenticated บน oem_price_calc ออก (พร้อมอีก 6 ตัว) เพราะ grant
  -- นั้นไม่ใช่ defense-in-depth อย่างที่หัวไฟล์นี้บรรทัด 66-68 เข้าใจ — anon/authenticated
  -- ไม่มี USAGE บนสคีมา analytics มาตั้งแต่ 0123 จึงเรียกไม่ได้อยู่แล้ว มันเพิ่มแต่พื้นผิว
  -- 🔴 ผลตามมา: ถ้า replay ไฟล์นี้ซ้ำ "หลัง" 0147 ด่านข้างล่างจะ raise ทันทีและชี้ผิดทาง
  --    (ข้อความบอกว่า "lost its grant after replace" ทั้งที่เป็นการถอนโดยตั้งใจ)
  --    ตอน rebuild DB จากศูนย์ ให้ข้ามด่านนี้ แล้วยืนยันปลายทางด้วย
  --    node scripts/run-sql.mjs scripts/check-analytics-grants.sql แทน
  --    (ดู 3j-migration-traps ข้อ 18 · ไฟล์นี้ apply ไปแล้ว จึงแก้ได้แค่คอมเมนต์ ไม่แตะตรรกะ)
  if not has_function_privilege('authenticated', 'analytics.oem_price_calc(uuid,jsonb)', 'execute') then
    raise exception 'GOLDEN REPLAY FAILED: oem_price_calc lost its authenticated execute grant after replace (trap #2)';
  end if;
  if not has_function_privilege('service_role', 'analytics.oem_price_calc(uuid,jsonb)', 'execute') then
    raise exception 'GOLDEN REPLAY FAILED: oem_price_calc lost its service_role execute grant after replace (trap #2)';
  end if;

  -- ==========================================================================
  -- Part A — replay ทุกแถวจริงใน analytics.oem_quote_item.input ที่
  -- metal <> 'silver999' (ตามที่สั่ง — ไม่แตะ analytics.oem_quote.input ของ
  -- v1 pre-0075 แม้จะยังมีคอลัมน์นั้นเหลืออยู่ก็ตาม)
  -- ==========================================================================
  for v_row in
    select id, shop_id, input
    from analytics.oem_quote_item
    where input ->> 'metal' is distinct from 'silver999'
  loop
    v_n_real := v_n_real + 1;

    begin
      v_new := analytics.oem_price_calc(v_row.shop_id, v_row.input);
    exception when others then
      v_new := jsonb_build_object('__error', sqlerrm);
    end;
    if v_new ? '_raw' then
      raise exception 'GOLDEN REPLAY FAILED: _raw leaked into oem_price_calc output for real row id=%', v_row.id;
    end if;

    begin
      v_legacy := analytics.oem_price_calc_legacy(v_row.shop_id, v_row.input);
    exception when others then
      v_legacy := jsonb_build_object('__error', sqlerrm);
    end;

    if v_new is distinct from v_legacy then
      v_n_real_mismatch := v_n_real_mismatch + 1;
      if v_n_real_mismatch <= 5 then
        v_real_detail := v_real_detail || format(E'\n  real row id=%s shop_id=%s\n    new:    %s\n    legacy: %s',
          v_row.id, v_row.shop_id, v_new, v_legacy);
      end if;
    end if;
  end loop;

  -- ==========================================================================
  -- Part B — ชุดสังเคราะห์ 24 เคส: 3 โลหะ x มีพลอย/ไม่ x มีชุบ/ไม่ x
  -- new_design/ไม่ ครอบ gold (pass-through) ด้วยตามที่สั่ง เพราะถ้า prod ไม่มี
  -- ใบ jewelry เลย (มีแต่ใบเงินแท่ง) ชุดนี้คือหลักฐานเดียว
  --
  -- เลือก shop สังเคราะห์แบบ dynamic (ไม่เดา/hardcode shop_id หรือ scope
  -- label ใดๆ — ทุกค่าอ่านจากสิ่งที่กรอกจริงใน DB เท่านั้น): ใช้ shop_id ที่มี
  -- oem_cost_rate ครบ rate_key มากที่สุด (heuristic "ร้านที่กรอกครบสุด") ถ้า
  -- ไม่มีเลยสักร้าน fallback เป็น shop_id สุ่มใหม่ (เคสนี้ยังมีประโยชน์: ทดสอบ
  -- ว่า control-flow/สูตรย้ายมาถูกจุดหรือไม่ แม้ตัวเลขจะเป็น 0 ทั้งหมดเพราะ
  -- ไม่มี rate ให้อ่าน)
  -- ==========================================================================
  select shop_id into v_synth_shop
    from analytics.oem_cost_rate
    group by shop_id
    order by count(distinct rate_key) desc
    limit 1;
  if v_synth_shop is null then
    v_synth_shop := gen_random_uuid();
  end if;

  -- scope ที่ร้านนี้กรอกจริง (ถ้ามี) — fallback เป็นค่า seed มาตรฐานจาก 0061
  -- oem_rate_scope_option (taxonomy จริงใน DB ไม่ใช่ค่าที่เดาขึ้นเอง) เฉพาะถ้า
  -- ร้านที่เลือกไม่เคยกรอก scope นั้น
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
          v_case_no := v_case_no + 1;
          v_input := jsonb_build_object(
            'metal', v_metal_s,
            'item_kind', v_item_kind_val,
            'polish_tier', v_polish_tier_val,
            'qty', 5,
            'weight_g', 3.5,
            'is_new_design', v_newdesign_flag,
            'purity', case when v_metal_s = 'gold' then 0.965 else null end,
            'plating_type', case when v_plate_flag then v_plating_type_val else null end,
            'gem_tier', case when v_gem_flag then v_gem_tier_val else null end,
            'gem_count', case when v_gem_flag then 2 else 0 end,
            'as_of_date', null,
            'margin_pct', null
          );

          v_n_synth := v_n_synth + 1;

          begin
            v_new := analytics.oem_price_calc(v_synth_shop, v_input);
          exception when others then
            v_new := jsonb_build_object('__error', sqlerrm);
          end;
          if v_new ? '_raw' then
            raise exception 'GOLDEN REPLAY FAILED: _raw leaked into oem_price_calc output for synthetic case #% (metal=%, gem=%, plate=%, new_design=%)',
              v_case_no, v_metal_s, v_gem_flag, v_plate_flag, v_newdesign_flag;
          end if;

          begin
            v_legacy := analytics.oem_price_calc_legacy(v_synth_shop, v_input);
          exception when others then
            v_legacy := jsonb_build_object('__error', sqlerrm);
          end;

          if v_new is distinct from v_legacy then
            v_n_synth_mismatch := v_n_synth_mismatch + 1;
            if v_n_synth_mismatch <= 5 then
              v_synth_detail := v_synth_detail || format(E'\n  synthetic case #%s metal=%s gem=%s plate=%s new_design=%s\n    new:    %s\n    legacy: %s',
                v_case_no, v_metal_s, v_gem_flag, v_plate_flag, v_newdesign_flag, v_new, v_legacy);
            end if;
          end if;
        end loop;
      end loop;
    end loop;
  end loop;

  if (v_n_real_mismatch + v_n_synth_mismatch) > 0 then
    raise exception 'GOLDEN REPLAY FAILED: % / % real oem_quote_item rows mismatched, % / % synthetic cases mismatched (showing up to 5 each).%',
      v_n_real_mismatch, v_n_real, v_n_synth_mismatch, v_n_synth, (v_real_detail || v_synth_detail);
  end if;

  -- ==========================================================================
  -- Part C — metal_price_thb_per_gram override (ฟีเจอร์ใหม่ล้วน ไม่มี legacy
  -- ให้เทียบ — ทดสอบพฤติกรรมของ oem_cost_calc ตรง)
  -- ==========================================================================
  v_override_input := jsonb_build_object(
    'metal', 'silver', 'item_kind', v_item_kind_val, 'polish_tier', v_polish_tier_val,
    'qty', 5, 'weight_g', 3.5, 'is_new_design', false, 'purity', null,
    'plating_type', null, 'gem_tier', null, 'gem_count', 0,
    'as_of_date', null, 'metal_price_thb_per_gram', 77.5
  );
  v_new := analytics.oem_cost_calc(v_synth_shop, v_override_input);
  if (v_new -> '_raw' ->> 'price_used')::numeric is distinct from 77.5::numeric then
    raise exception 'GOLDEN REPLAY FAILED: metal_price_thb_per_gram override not honored (_raw.price_used=%)', v_new -> '_raw' ->> 'price_used';
  end if;
  if v_new ->> 'price_source' is distinct from 'caller' then
    raise exception 'GOLDEN REPLAY FAILED: metal_price_thb_per_gram override did not set price_source=caller (got %)', v_new ->> 'price_source';
  end if;
  if exists (select 1 from jsonb_array_elements(v_new -> 'missing') e where e ->> 'rate_key' = 'metal_price') then
    raise exception 'GOLDEN REPLAY FAILED: metal_price_thb_per_gram override still produced a metal_price missing entry (lookup not skipped)';
  end if;

  -- NaN หลุด validation ไหม (skill 3j-migration-traps ข้อ 4) — ต้อง raise
  v_should_have_raised := true;
  begin
    perform analytics.oem_cost_calc(v_synth_shop, v_override_input || jsonb_build_object('metal_price_thb_per_gram', 'NaN'));
    v_should_have_raised := false;
  exception when others then
    if sqlerrm not like '%metal_price_thb_per_gram%' then
      raise exception 'GOLDEN REPLAY FAILED: NaN override raised an unexpected error: %', sqlerrm;
    end if;
  end;
  if not v_should_have_raised then
    raise exception 'GOLDEN REPLAY FAILED: metal_price_thb_per_gram=NaN should have raised but did not';
  end if;

  -- ค่า <= 0 ต้อง raise (ห้ามพึ่งวินัยของ caller — บังคับที่ตัวฟังก์ชัน)
  v_should_have_raised := true;
  begin
    perform analytics.oem_cost_calc(v_synth_shop, v_override_input || jsonb_build_object('metal_price_thb_per_gram', 0));
    v_should_have_raised := false;
  exception when others then
    if sqlerrm not like '%metal_price_thb_per_gram%' then
      raise exception 'GOLDEN REPLAY FAILED: zero override raised an unexpected error: %', sqlerrm;
    end if;
  end;
  if not v_should_have_raised then
    raise exception 'GOLDEN REPLAY FAILED: metal_price_thb_per_gram=0 should have raised but did not';
  end if;

  -- silver999 ต้องถูก oem_cost_calc ปฏิเสธเสมอ (ไม่ใช่ของชั้นนี้)
  v_should_have_raised := true;
  begin
    perform analytics.oem_cost_calc(v_synth_shop, jsonb_build_object('metal', 'silver999', 'bar_size', '1_baht', 'qty', 1));
    v_should_have_raised := false;
  exception when others then
    if sqlerrm not like '%silver999%' then
      raise exception 'GOLDEN REPLAY FAILED: oem_cost_calc(metal=silver999) raised an unexpected error: %', sqlerrm;
    end if;
  end;
  if not v_should_have_raised then
    raise exception 'GOLDEN REPLAY FAILED: oem_cost_calc(metal=silver999) should have raised but did not';
  end if;

  -- ==========================================================================
  -- ทุกอย่างผ่าน — ปิดท้ายด้วย notice สรุปหลักฐาน (อ่านตรงนี้หลัง apply เพื่อ
  -- รู้ว่าครอบคลุมจากใบจริงกี่ใบ/สังเคราะห์กี่เคส) แล้วให้สเตตเมนต์ถัดไป
  -- (นอก do-block) drop oem_price_calc_legacy ทิ้ง
  -- ==========================================================================
  raise notice 'GOLDEN REPLAY OK: % real oem_quote_item rows (metal<>silver999) replayed identical to legacy; % synthetic cases (silver/gold/brass x gem x plating x new_design, synthetic shop_id=%) replayed identical; metal_price_thb_per_gram override + NaN/zero/silver999 guards verified; grants + overload counts verified. Dropping oem_price_calc_legacy next.',
    v_n_real, v_n_synth, v_synth_shop;
end $$;

-- ถึงบรรทัดนี้ได้ก็ต่อเมื่อ do-block ด้านบนไม่ raise (ทุกอย่างเท่ากันหมด) —
-- ถ้า raise ทั้ง transaction abort ไปแล้ว statement นี้ไม่มีทางรันถึง (ยังคง
-- อยู่ในสถานะ transaction aborted ของ Postgres) ทั้ง migration จึง rollback
-- สนิท ไม่ commit อะไรเลยตามที่สั่ง
drop function if exists analytics.oem_price_calc_legacy(uuid, jsonb);
