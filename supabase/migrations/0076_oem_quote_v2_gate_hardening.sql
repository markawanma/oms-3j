-- 0076_oem_quote_v2_gate_hardening.sql
--
-- แก้ช่องโหว่ที่ security review เจอใน 0075
-- applied เป็น 3 ก้อน (0076_oem_quote_v2_gate_hardening / 0076b_oem_discount_sign_guard
-- / 0076c_oem_renegotiate_hardening) แต่ละก้อน idempotent — รันไฟล์นี้รวดเดียว
-- บนฐานข้อมูลใหม่ได้ผลเท่ากัน · ตัวฟังก์ชันด้านล่างดึงจาก DB จริงหลัง apply
-- เพื่อกันไฟล์กับ DB ไม่ตรงกัน
--
-- ============ C1 — สูตร margin หลังหักส่วนลดพลิกเครื่องหมาย ============
-- เดิม: (price_ex_gold - discount - cost) / (price_ex_gold - discount)
-- ตัวหารติดลบได้ พอทั้งเศษและส่วนติดลบ อัตราส่วนกลับเป็น "บวกใหญ่" แล้ววิ่ง
-- ผ่านทุก gate ที่เขียนว่า < hard_floor — ยิ่งลดเยอะ margin ยิ่งดูดี
-- และ DB จะบันทึกตัวเลข margin ปลอมลงคอลัมน์รายงานด้วย
--
-- ⚠️ ทดสอบเองแล้ว: **ยิงไม่เข้าในสภาพปัจจุบัน** — ด่านมูลค่างานขั้นต่ำดักไว้
-- ก่อนทุกเคสที่ลองได้ (เงิน: grand_total ติดลบก่อนถึงสูตร · ทอง: ตั้งราคาทอง
-- ไม่ได้เพราะ oem_metal_price ยังว่าง) จึงเป็นบั๊กแฝง ไม่ใช่ช่องที่เปิดอยู่
-- จริงวันนี้ — แต่ต้องแก้ตอนนี้ เพราะเงื่อนไขที่ปลดล็อกมันทั้งสองทาง
-- (กรอกค่าแบบจนเกิน min_job_value / เปิดราคาทอง) อยู่ในแผนอยู่แล้ว
--
-- แก้: ปฏิเสธตั้งแต่ต้นถ้าส่วนลด >= มูลค่างานส่วนที่คิดกำไรได้ (ตัวหารจึงเป็น
-- บวกเสมอ) + เปลี่ยน gate จาก "is not null and <" เป็น "is null or <"
-- (คำนวณไม่ได้ = ตก ไม่ใช่ผ่าน) + CHECK grand_total >= 0 เป็นแนวรับที่สอง
--
-- ============ H2 — ปลุกใบที่ถูกแทนที่กลับมาเป็นใบชนะ ============
-- **ยืนยันว่ายิงเข้าจริง ทดสอบแล้ว** guard เดิมคุมแค่ won/lost ส่วน
-- expired/rejected ไม่ตรวจสถานะปัจจุบันเลย: superseded -> expired -> won
-- ผ่านทั้งสาย ผลคือมีใบชนะ 2 ใบในสายเดียวกัน ยอดถูกนับซ้ำ และประวัติว่า
-- ใบไหนคือใบที่ลูกค้ารับจริงพังทั้งสาย
-- แก้: transition table ครบทุกสถานะ + for update กัน lost-update
--
-- ============ H1 — renegotiate ไม่มีด่านมูลค่างานขั้นต่ำ ============
-- save มี แต่ renegotiate ไม่มี ทั้งที่เขียน grand_total ตรงๆ — งานที่ค่าแบบ
-- (NRE) หนักจึงลดจนค่าแบบกินสัดส่วนงานเกิน 25% ที่ 0062 ตั้งใจกันได้
-- แก้: ยก gate เดียวกับ save มาใส่ + seed fallback setting ให้ครบ
--
-- ============ H3 — p_items ไม่มีเพดานความยาว ============
-- ส่ง 10,000 รายการ = คำนวณ 10,000 รอบใน transaction เดียว ถือ lock ยาว
-- connection pool ตันได้ด้วย request เดียว
-- แก้: เพดาน 50 รายการ + ตัดความยาว sku_snapshot/product_name_snapshot
--
-- ============ LOW ที่แก้ไปด้วย ============
-- coalesce(nre_max_share_pct, 0.25) — ถ้าเป็น null เกณฑ์ NRE หายเงียบ
-- ใช้ตัวแปร v_has_items แทน "if not found" หลัง loop ให้เจตนาชัด
--
-- ============ ที่ยังไม่ทำ (บันทึกเป็นหนี้) ============
-- M1 oem_quote_item เปิด select ให้ shop_member ทุก role เห็น calc = โครงสร้าง
--    ต้นทุนทั้งก้อน — ต้องปิดก่อน Auth A2 ลง ไม่งั้นพนักงานคนแรกที่ได้สิทธิ์
--    อ่านต้นทุนงาน OEM ได้ทันที (ตาราง oem_quote เดิมจาก 0062 มีปัญหาเดียวกัน)
-- M2 margin_discount_cap_pct เป็น setting ที่แก้ได้ในหน้าจอแต่ไม่มีใครอ่าน —
--    ต้องให้เจ้าของเคาะว่าจะบังคับใช้หรือลบทิ้ง อย่าปล่อยคาไว้
-- M3 console.error ที่ setQuoteBilling log error object ทั้งก้อน อาจพา tax_id
--    ที่อยู่ ลง server log
-- M4 p_customer.address ไม่ validate ชนิด/ขนาด

-- ---------------------------------------------------------------------------
-- 1) แนวรับที่สอง: ยอดสุทธิติดลบไม่ได้ (ถ้า guard ในฟังก์ชันหลุด DB ยังกันไว้)
-- ---------------------------------------------------------------------------
alter table analytics.oem_quote drop constraint if exists oem_quote_grand_total_nonneg;
alter table analytics.oem_quote add constraint oem_quote_grand_total_nonneg
  check (grand_total is null or grand_total >= 0);

-- ---------------------------------------------------------------------------
-- 2) oem_quote_save — C1 (ส่วนลดพลิกเครื่องหมาย) + H3 (เพดาน 50 รายการ)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION analytics.oem_quote_save(p_shop_id uuid, p_items jsonb, p_quote_id uuid DEFAULT NULL::uuid, p_status text DEFAULT 'draft'::text, p_approval_note text DEFAULT NULL::text, p_customer_name text DEFAULT NULL::text, p_customer_contact text DEFAULT NULL::text, p_discount_thb numeric DEFAULT 0, p_discount_reason text DEFAULT NULL::text)
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
  v_valid_days int;
  v_quote_total_sum numeric;
  v_grand_total numeric;
  v_margin_after_discount numeric;
  v_margin_actual_blended numeric;
  v_jobvalue_min numeric;
  v_approved_by uuid;
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

  select * into v_set from analytics.oem_setting where shop_id = p_shop_id;
  if v_set.shop_id is null then
    v_set.margin_target_pct := 0.30; v_set.margin_discount_cap_pct := 0.25;
    v_set.margin_floor_pct := 0.20; v_set.margin_hard_floor_pct := 0.15;
    v_set.nre_max_share_pct := 0.25; v_set.min_job_value_thb := 8000;
    v_set.quote_valid_days_silver := 30; v_set.quote_valid_days_gold := 7; v_set.quote_valid_days_brass := 45;
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
      v_price_ex_gold_sum := v_price_ex_gold_sum + coalesce(v_item_total, 0);
      v_cost_ex_gold_sum := v_cost_ex_gold_sum + coalesce(v_item_cost_piece, 0) * v_item_qty;
    end if;

    if v_item_margin_charged is not null
       and (v_min_margin_charged is null or v_item_margin_charged < v_min_margin_charged) then
      v_min_margin_charged := v_item_margin_charged;
      v_min_margin_seq := v_seq;
    end if;

    v_item_valid_days := case v_item_metal
      when 'gold' then coalesce(v_set.quote_valid_days_gold, 7)
      when 'brass' then coalesce(v_set.quote_valid_days_brass, 45)
      else coalesce(v_set.quote_valid_days_silver, 30)
    end;
    -- ยืนราคาตามโลหะที่ผันผวนสุดในใบ (ทองสั้นสุด) ไม่ใช่ตามรายการสุดท้าย
    v_valid_days := case when v_valid_days is null then v_item_valid_days else least(v_valid_days, v_item_valid_days) end;
  end loop;

  v_quote_total_sum := v_pieces_subtotal_sum + v_nre_price_sum;

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
    if v_grand_total < v_jobvalue_min then
      raise exception 'oem_quote_save: มูลค่างานรวม (%) ต่ำกว่าเกณฑ์ขั้นต่ำ % บาท ออกใบเสนอราคาไม่ได้',
        v_grand_total, v_jobvalue_min using errcode = '22023';
    end if;

    if v_min_margin_charged is not null and v_min_margin_charged < v_set.margin_hard_floor_pct then
      raise exception 'oem_quote_save: รายการที่ % — margin ที่คิด % ต่ำกว่า hard floor % — ไม่มีทางลัด ต้องปรับราคาหรือปฏิเสธงาน',
        v_min_margin_seq, round(v_min_margin_charged * 100, 1)::text || '%', round(v_set.margin_hard_floor_pct * 100, 1)::text || '%'
        using errcode = '22023';
    end if;
    -- C1: "คำนวณไม่ได้ = ตก" ไม่ใช่ "คำนวณไม่ได้ = ข้าม gate"
    if v_margin_after_discount is null or v_margin_after_discount < v_set.margin_hard_floor_pct then
      raise exception 'oem_quote_save: ส่วนลด % บาท ทำให้ margin รวมหลังหักส่วนลด % ต่ำกว่า hard floor % — ไม่มีทางลัด ต้องลดส่วนลดหรือปฏิเสธงาน',
        p_discount_thb,
        coalesce(round(v_margin_after_discount * 100, 1)::text || '%', 'คำนวณไม่ได้'),
        round(v_set.margin_hard_floor_pct * 100, 1)::text || '%'
        using errcode = '22023';
    end if;
    if ((v_min_margin_charged is not null and v_min_margin_charged < v_set.margin_floor_pct)
        or v_margin_after_discount < v_set.margin_floor_pct)
       and (p_approval_note is null or btrim(p_approval_note) = '') then
      raise exception 'oem_quote_save: margin ต่ำกว่า floor (จากรายการ หรือจากส่วนลด) — ต้องใส่เหตุผลก่อนออกใบเสนอราคา' using errcode = '22023';
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
    quote_valid_until = case when p_status = 'quoted' then current_date + v_valid_days else quote_valid_until end,
    updated_by = auth.uid(), updated_at = now()
  where id = v_quote_id and shop_id = p_shop_id;

  return v_quote_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3) oem_quote_renegotiate — H1 (ด่านมูลค่างานขั้นต่ำ) + C1 (ส่วนลดพลิก)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION analytics.oem_quote_renegotiate(p_shop_id uuid, p_quote_id uuid, p_new_discount_thb numeric, p_reason text)
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
begin
  if p_shop_id is null or p_quote_id is null then
    raise exception 'oem_quote_renegotiate: p_shop_id and p_quote_id are required';
  end if;
  if p_new_discount_thb is null or p_new_discount_thb < 0 then
    raise exception 'oem_quote_renegotiate: p_new_discount_thb must be >= 0';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  select * into v_old from analytics.oem_quote where id = p_quote_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'oem_quote_renegotiate: quote % not found for this shop', p_quote_id;
  end if;
  if v_old.status <> 'quoted' then
    raise exception 'oem_quote_renegotiate: ต่อรองราคาได้เฉพาะใบสถานะ quoted เท่านั้น (ใบนี้สถานะ %)', v_old.status
      using errcode = '22023';
  end if;
  if v_old.quote_valid_until is null or v_old.quote_valid_until < current_date then
    raise exception 'oem_quote_renegotiate: ใบเสนอราคาหมดอายุแล้ว ต่อรองราคาไม่ได้ — ออกใบใหม่แทน' using errcode = '22023';
  end if;

  select * into v_set from analytics.oem_setting where shop_id = p_shop_id;
  if v_set.shop_id is null then
    -- LOW: fallback ต้อง seed ให้ครบทุกค่าที่ฟังก์ชันนี้อ่าน ไม่งั้น gate หายเงียบ
    v_set.margin_floor_pct := 0.20; v_set.margin_hard_floor_pct := 0.15;
    v_set.nre_max_share_pct := 0.25; v_set.min_job_value_thb := 8000;
    v_set.quote_valid_days_silver := 30; v_set.quote_valid_days_gold := 7; v_set.quote_valid_days_brass := 45;
  end if;

  for v_row in select * from analytics.oem_quote_item where quote_id = v_old.id order by seq loop
    v_has_items := true;
    if (v_row.input->>'metal') = 'gold' then
      v_price_ex_gold_sum := v_price_ex_gold_sum + coalesce(v_row.item_total, 0)
                              - coalesce((v_row.calc->'breakdown'->'metal'->>'per_piece')::numeric, 0) * v_row.qty;
      v_cost_ex_gold_sum := v_cost_ex_gold_sum + coalesce(v_row.cost_piece, 0) * v_row.qty
                             - coalesce((v_row.calc->'breakdown'->'metal'->>'per_piece')::numeric, 0) * v_row.qty;
    else
      v_price_ex_gold_sum := v_price_ex_gold_sum + coalesce(v_row.item_total, 0);
      v_cost_ex_gold_sum := v_cost_ex_gold_sum + coalesce(v_row.cost_piece, 0) * v_row.qty;
    end if;

    v_valid_days := least(
      coalesce(v_valid_days, 9999),
      case (v_row.input->>'metal')
        when 'gold' then coalesce(v_set.quote_valid_days_gold, 7)
        when 'brass' then coalesce(v_set.quote_valid_days_brass, 45)
        else coalesce(v_set.quote_valid_days_silver, 30)
      end
    );
  end loop;
  -- LOW: ใช้ตัวแปรของตัวเอง ไม่พึ่ง found หลัง loop (found = ผลของคำสั่งสุดท้าย)
  if not v_has_items then
    raise exception 'oem_quote_renegotiate: ใบ % ไม่มีรายการ ต่อราคาไม่ได้', p_quote_id using errcode = '22023';
  end if;

  -- C1: guard เดียวกับ save
  if p_new_discount_thb > 0 and p_new_discount_thb >= v_price_ex_gold_sum then
    raise exception 'oem_quote_renegotiate: ส่วนลดใหม่ % บาท มากกว่าหรือเท่ากับมูลค่างานส่วนที่คิดกำไรได้ (% บาท) — ไม่มีทางลัด',
      p_new_discount_thb, round(v_price_ex_gold_sum, 2)
      using errcode = '22023';
  end if;

  -- H1: ด่านมูลค่างานขั้นต่ำ (เดิมมีแค่ใน save) — คุมสัดส่วนค่าแบบ (NRE) ต่องานด้วย
  v_new_grand_total := coalesce(v_old.quote_total, 0) - p_new_discount_thb;
  v_jobvalue_min := greatest(
    coalesce(v_set.min_job_value_thb, 8000),
    case when coalesce(v_old.nre_cost, 0) > 0
         then v_old.nre_cost / coalesce(v_set.nre_max_share_pct, 0.25) else 0 end
  );
  if v_new_grand_total < v_jobvalue_min then
    raise exception 'oem_quote_renegotiate: ส่วนลดใหม่ทำให้มูลค่างานรวม (%) ต่ำกว่าเกณฑ์ขั้นต่ำ % บาท — ต่อราคาไม่ได้',
      v_new_grand_total, v_jobvalue_min
      using errcode = '22023';
  end if;

  v_margin_after := case when (v_price_ex_gold_sum - p_new_discount_thb) > 0
    then round(((v_price_ex_gold_sum - p_new_discount_thb) - v_cost_ex_gold_sum) / (v_price_ex_gold_sum - p_new_discount_thb), 4) end;

  if v_margin_after is null or v_margin_after < v_set.margin_hard_floor_pct then
    raise exception 'oem_quote_renegotiate: ส่วนลดใหม่ % บาท ทำให้ margin % ต่ำกว่า hard floor % — ไม่มีทางลัด',
      p_new_discount_thb,
      coalesce(round(v_margin_after * 100, 1)::text || '%', 'คำนวณไม่ได้'),
      round(v_set.margin_hard_floor_pct * 100, 1)::text || '%'
      using errcode = '22023';
  end if;
  if v_margin_after < v_set.margin_floor_pct and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'oem_quote_renegotiate: ส่วนลดใหม่ทำให้ margin ต่ำกว่า floor — ต้องระบุเหตุผล' using errcode = '22023';
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
        current_date + coalesce(v_valid_days, v_set.quote_valid_days_silver, 30), auth.uid(), auth.uid()
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

-- ---------------------------------------------------------------------------
-- 4) oem_quote_set_status — H2: transition table ครบ + for update
--    เดิมคุมแค่ won/lost ทำให้ superseded -> expired -> won ผ่านทั้งสาย
--    (ทดสอบแล้วยิงเข้าจริง ได้ใบชนะ 2 ใบในสายเดียว)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION analytics.oem_quote_set_status(p_shop_id uuid, p_quote_id uuid, p_status text, p_lost_reason text DEFAULT NULL::text, p_lost_to text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $function$
declare
  v_current text;
begin
  if p_shop_id is null or p_quote_id is null or p_status is null then
    raise exception 'oem_quote_set_status: p_shop_id, p_quote_id and p_status are required';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  if p_status not in ('won', 'lost', 'rejected', 'expired') then
    raise exception 'oem_quote_set_status: สถานะ % เปลี่ยนตรงๆ ไม่ได้ — quoted/draft ออกผ่าน oem_quote_save, superseded เกิดจาก oem_quote_renegotiate เท่านั้น', p_status
      using errcode = '22023';
  end if;

  -- for update: กันสอง request ยิงพร้อมกันแล้วอ่านสถานะเดิมทั้งคู่
  select status into v_current
    from analytics.oem_quote
   where id = p_quote_id and shop_id = p_shop_id
   for update;
  if v_current is null then
    raise exception 'oem_quote_set_status: quote % not found for this shop', p_quote_id;
  end if;

  if v_current = 'superseded' then
    raise exception 'oem_quote_set_status: ใบนี้ถูกแทนที่ด้วยใบต่อราคาใหม่แล้ว เปลี่ยนสถานะไม่ได้ — ไปจัดการที่ใบใหม่แทน'
      using errcode = '22023';
  end if;
  if v_current in ('won', 'lost', 'rejected') then
    raise exception 'oem_quote_set_status: ใบนี้ปิดงานไปแล้ว (สถานะ %) เปลี่ยนซ้ำไม่ได้', v_current
      using errcode = '22023';
  end if;
  if p_status in ('won', 'lost') and v_current not in ('quoted', 'expired') then
    raise exception 'oem_quote_set_status: ใบนี้ยังไม่เคยออกเป็นใบเสนอราคา (สถานะ %) ปิดงานไม่ได้', v_current
      using errcode = '22023';
  end if;
  if p_status = 'expired' and v_current <> 'quoted' then
    raise exception 'oem_quote_set_status: ทำให้หมดอายุได้เฉพาะใบที่ออกแล้ว (สถานะ %)', v_current
      using errcode = '22023';
  end if;
  if p_status = 'rejected' and v_current not in ('draft', 'quoted', 'expired') then
    raise exception 'oem_quote_set_status: ปฏิเสธได้เฉพาะใบที่ยังไม่ปิด (สถานะ %)', v_current
      using errcode = '22023';
  end if;

  if p_status = 'lost' and (p_lost_reason is null or btrim(p_lost_reason) = '') then
    raise exception 'oem_quote_set_status: ปฏิเสธ/แพ้งานต้องระบุเหตุผล' using errcode = '22023';
  end if;

  update analytics.oem_quote set
    status = p_status,
    lost_reason = case when p_status = 'lost' then p_lost_reason else lost_reason end,
    lost_to = case when p_status = 'lost' then p_lost_to else lost_to end,
    updated_by = auth.uid(), updated_at = now()
  where id = p_quote_id and shop_id = p_shop_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5) grants — CREATE OR REPLACE ไม่คืนสิทธิ์เดิมให้อัตโนมัติ ต้องตั้งซ้ำ
-- ---------------------------------------------------------------------------
revoke execute on function analytics.oem_quote_save(uuid, jsonb, uuid, text, text, text, text, numeric, text) from public, anon;
grant execute on function analytics.oem_quote_save(uuid, jsonb, uuid, text, text, text, text, numeric, text) to authenticated, service_role;
revoke execute on function analytics.oem_quote_renegotiate(uuid, uuid, numeric, text) from public, anon;
grant execute on function analytics.oem_quote_renegotiate(uuid, uuid, numeric, text) to authenticated, service_role;
revoke execute on function analytics.oem_quote_set_status(uuid, uuid, text, text, text) from public, anon;
grant execute on function analytics.oem_quote_set_status(uuid, uuid, text, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
