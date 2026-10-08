-- 0168_oem_soft_qty_floors.sql
--
-- ทำไม: เจ้าของทดสอบจริง (8 ต.ค. 69) — งานผลิตทอง 3 ชิ้นออกใบไม่ได้ เพราะด่าน "จำนวน (MOQ)" กับ "น้ำหนักทองรวม (ล็อตซื้อทองขั้นต่ำ)"
-- ล็อกที่ oem_quote_save ("ไม่ผ่านเกณฑ์ floor ... ออกใบเสนอราคาไม่ได้")
-- มติเจ้าของ: ด่าน MOQ + ล็อตโลหะ ทุกวัสดุ (silver/gold/brass) เปลี่ยนจาก "ห้ามออกใบ" เป็น "ออกใบได้เมื่อมีเหตุผลอนุมัติ (approval_note)"
--   - quoted + floor qty หรือ metal_weight ไม่ผ่าน + ไม่มี approval_note (หลังลบอักขระล่องหน + trim ว่าง) → 22023 ข้อความไทยชัด
--   - มี note → ผ่าน และ note ถูกเก็บลง approval_note / approved_by (เหมือนด่าน note-tier)
--   - draft ไม่ติดด่านนี้ (เหมือนเดิม — ด่านทั้งก้อนอยู่ใต้ p_status = 'quoted')
-- ไม่แตะ: oem_price_calc (floors ยังรายงาน pass=false ให้ UI เตือน ⇒ ไม่ต้อง golden replay) · is_complete · min_job_value · margin รวมติดลบ ·
--   hard floor หลังส่วนลด · ราคาพิเศษเงินแท่งต่ำกว่าทุน · F1/F2 ของ 0167 (ตรรกะ)
-- oem_quote_renegotiate: ไม่มีด่าน qty/metal_weight (คัดลอก item เดิมโดยไม่คำนวณ floors ใหม่) ⇒ ไม่มีด่านใหม่ — ใบที่ออกได้ผ่านด่านนี้ด้วย note มาแล้ว
--
-- ⚠️ เจอระหว่างทำ verify (แก้ในไฟล์นี้ ไม่ใช่ขอบเขตเดิม): ด่าน F2 ของ 0167 trim approval_note/เหตุผลแค่ space/tab/CR/LF/NBSP ⇒ note ที่เป็น U+3000
--   (ideographic space) หรือช่องว่างกว้างล้วนรอดเป็น "มี note" · แก้เป็นชุดเดียวกับ oem_customer_text_clean (ตัวแปร v_note_ws) ทั้งด่านใหม่และ F2 ของ save
--   + renegotiate (ตรรกะ F2 เท่าเดิมทุกประการ แก้แค่ชุด trim) · ด่าน note-tier เดิม (btrim(p_approval_note) = '' ตั้งแต่ 0079) ยังใช้ trim แบบเดิม = หนี้ที่บันทึกไว้
-- signature เดิมทุกตัว → create or replace ตรงๆ ไม่เกิด overload · re-grant service_role เท่านั้น (ข้อ 2 + 18)
-- 🔴 APPLIED แล้ว 8 ต.ค. 69 version 20261008120005 — ห้าม apply ซ้ำ · verify-0168 OK 29 + mutant 7/7 / FAIL 0
-- ลอกจาก 0167 (ฉบับล่าสุด) แก้เฉพาะบล็อกที่ทำเครื่องหมาย "0168" · ชุดทดสอบ scripts/verify/verify-0168.sql · ไฟล์เป็น LF (ข้อ 20)

-- ============================================================================
-- 1. oem_quote_save — ด่านเหตุผลอนุมัติของ MOQ/ล็อตโลหะ + ชุด trim ของ F2
-- ============================================================================
create or replace function analytics.oem_quote_save(p_shop_id uuid, p_items jsonb, p_quote_id uuid DEFAULT NULL::uuid, p_status text DEFAULT 'draft'::text, p_approval_note text DEFAULT NULL::text, p_customer_name text DEFAULT NULL::text, p_customer_contact text DEFAULT NULL::text, p_discount_thb numeric DEFAULT 0, p_discount_reason text DEFAULT NULL::text, p_bar_valid_until date DEFAULT NULL::date, p_actor_id uuid DEFAULT NULL::uuid)
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
  -- ---- 0166: รายการสินค้า (metal='product') ----
  v_has_product_item boolean := false;
  -- ---- 0167 F1/F2 ----
  v_production_net numeric;
  v_has_manual_cost boolean := false;
  v_manual_price_sum numeric := 0;
  v_manual_cost_sum numeric := 0;
  v_manual_loss_sum numeric := 0;
  -- 0168: ชุดช่องว่างที่ trim ออกจาก approval_note ของด่านเหตุผลอนุมัติ (เดิม 0167 F2 trim แค่ space/tab/CR/LF/NBSP — note ที่เป็น ideographic space
  -- (U+3000) หรือช่องว่างกว้างล้วนจึงรอดเป็น "มี note") · ชุดเดียวกับ oem_customer_text_clean
  v_note_ws text := E' \t\r\n' || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8239) || chr(8287) || chr(12288);
  -- ---- 0165 ----
  v_actor uuid;
  v_cust_name text;
  v_cust_contact text;
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
  -- 0165 M2: ผู้บันทึก — แอปเรียกผ่าน service client ⇒ auth.uid() เป็น null เสมอ (created_by/updated_by/approved_by
  -- ว่างทุกใบ) · p_actor_id มาจาก session ฝั่ง server ของแอป (ห้ามรับจาก client) · ไม่เจอใน auth.users ⇒ null
  -- (ไม่ล้มทั้งการบันทึกด้วย FK เพราะ id ปลอม/ผู้ใช้ถูกลบ — ดีกว่าบังคับให้ออกใบไม่ได้) · null = พฤติกรรมเดิม
  v_actor := coalesce(auth.uid(), (select u.id from auth.users u where u.id = p_actor_id));
  -- 0165 M3/L1: ชื่อ/ช่องทางติดต่อลูกค้าผ่านด่านเดียวกับ oem_quote_set_customer (ยาว/control/bidi/ล่องหน → 22023)
  -- ชื่อนี้พิมพ์บนใบเสนอราคาที่ส่งลูกค้า · null/ว่าง = null ⇒ coalesce ข้างล่างคงค่าเดิม (เหมือนเดิม)
  v_cust_name := analytics.oem_customer_text_clean(p_customer_name, 'ชื่อลูกค้า');
  v_cust_contact := analytics.oem_customer_text_clean(p_customer_contact, 'ช่องทางติดต่อ');
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
          v_quote_id, p_shop_id, v_quote_no, v_quote_id, v_cust_name, v_cust_contact,
          -- 0081: ใบใหม่ตั้งมัดจำเริ่มต้นจาก oem_setting.deposit_default_pct
          -- อัตโนมัติ (ปกติ 50% ไม่ต้องกรอกซ้ำทุกใบ ตามที่เจ้าของสั่ง) — ทำ
          -- เฉพาะ branch สร้างแถวใหม่นี้เท่านั้น ไม่มีทางไปทับใบเก่าที่ผู้ใช้
          -- เคยตั้งเอง (ดู final update ท้ายฟังก์ชัน — ไม่มี deposit_mode/
          -- deposit_input อยู่ใน SET clause นั้นเลย ไม่ว่าจะสร้างใหม่หรือแก้เก่า)
          '[]'::jsonb, 'draft', 'pct', v_set.deposit_default_pct, v_actor, v_actor
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
    -- 0166: รายการสินค้า — product_id ใน input (ที่ oem_price_calc ใช้ตัดสิน) ต้องตรงกับ product_id ของรายการ
    -- (กัน client ส่งสองค่าไม่ตรงกันแล้วไปผูก snapshot ผิดตัว) · sku/ชื่อ ทับด้วย snapshot จาก calc เสมอ
    -- (ไม่เชื่อ sku_snapshot/product_name_snapshot ที่ client ส่ง) · calc รับรองรูปแบบ uuid ของ input แล้ว (raise ก่อนถึงตรงนี้)
    if v_item_metal = 'product' then
      v_has_product_item := true;
      if nullif(btrim(v_item_input->>'product_id'), '')::uuid is distinct from v_item_product_id then
        raise exception 'oem_quote_save: p_items[%] product_id ใน input ไม่ตรงกับ product_id ของรายการ', v_seq
          using errcode = '22023';
      end if;
      v_item_sku := left(nullif(btrim(v_item_calc->'breakdown'->'product'->>'sku'), ''), 64);
      v_item_name := left(nullif(btrim(v_item_calc->'breakdown'->'product'->>'name'), ''), 200);
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
    -- 0167 F2: รายการสินค้าที่ทุน "กรอกเอง" (cost_source='manual') — ไม่มีหลักฐานต้นทุนในแคตตาล็อก ใช้ตรวจ/บังคับเหตุผลตอน quoted
    if v_item_metal = 'product' and v_item_calc->'breakdown'->'product'->>'cost_source' = 'manual' then
      v_has_manual_cost := true;
      v_manual_price_sum := v_manual_price_sum + coalesce(v_item_price_piece, 0) * v_item_qty;
      v_manual_cost_sum := v_manual_cost_sum + coalesce(v_item_cost_piece, 0) * v_item_qty;
      -- เฉพาะ "ส่วนขาดทุน" ของรายการ manual (กำไรที่ผู้กรอกอ้างเองไม่นับเป็นหลักฐานว่าใบนี้ไม่ขาดทุน)
      v_manual_loss_sum := v_manual_loss_sum + least((coalesce(v_item_price_piece, 0) - coalesce(v_item_cost_piece, 0)) * v_item_qty, 0);
    end if;

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
    -- 0166 มติ 5: รายการสินค้าไม่นับเป็น "มูลค่างานผลิต" (ไม่ติดด่านมูลค่าขั้นต่ำ)
    if v_item_metal not in ('silver999', 'product') then
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
    -- 0166 มติ 5: รายการสินค้า margin รายชิ้นเป็น null โดยออกแบบ (ไม่มีด่านทุนรายชิ้น) ≠ "ตรวจไม่ได้" — ต้องไม่ปลุก note-tier
    -- (ด่านรวมทั้งใบที่ยังอยู่: blended < 0 และ hard floor หลังส่วนลด · ส่วนลด > 0 ยังเข้า note-tier ตามปกติ)
    if v_item_margin_charged is null and v_item_metal is distinct from 'product' then
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
      -- 0166: รายการสินค้ายืนราคาตามรอบเงิน (ปกติ 30 วัน) · ใบผสมกับเงินแท่งราคาเว็บยังได้ 0 วันจาก least() ด้านล่าง
      when 'product' then coalesce(v_set.quote_valid_days_silver, 30)
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
    -- 0168 (มติเจ้าของ 8 ต.ค. 69): MOQ (จำนวนชิ้น) และล็อตโลหะขั้นต่ำ (น้ำหนักทองรวม) ของงานผลิตทุกวัสดุ เปลี่ยนจาก "ห้ามออกใบ" เป็น
    -- "ออกใบได้เมื่อมีเหตุผลอนุมัติ (approval_note)" — floors ใน oem_price_calc ยังรายงาน pass=false ตามเดิมให้ UI เตือน ·
    -- note ต้องไม่ว่างหลังลบอักขระล่องหน + trim (เกณฑ์เดียวกับด่าน F2 ของ 0167) · เหตุผลถูกเก็บลง approval_note/approved_by เหมือนด่าน note-tier
    -- ด่านอื่นไม่แตะ: is_complete · min_job_value · margin รวมติดลบ · hard floor · ราคาพิเศษเงินแท่งต่ำกว่าทุน · F1/F2
    if (not v_qty_pass_all or not v_metalweight_pass_all)
       and nullif(btrim(analytics.oem_text_strip_invisible(p_approval_note), v_note_ws), '') is null then
      raise exception 'oem_quote_save: ต่ำกว่า MOQ/ล็อตโลหะขั้นต่ำ (จำนวนชิ้นหรือน้ำหนักโลหะรวมของบางรายการต่ำกว่าเกณฑ์) — ต้องใส่เหตุผลอนุมัติก่อนออกใบเสนอราคา'
        using errcode = '22023';
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
    -- 0166: ใบที่มีรายการสินค้าด้วยก็ใช้ด่านแบบเดียวกัน (ดูเฉพาะส่วนงานผลิต · สินค้าล้วน = ข้าม)
    if v_has_bar_item or v_has_product_item then
      -- 0167 F1: ใบที่มีรายการสินค้า — ยอดงานผลิต "หลังหักส่วนลดทั้งใบ" (ถือว่าส่วนลดหักจากงานผลิตก่อน) ต้อง >= เกณฑ์
      -- (ก่อนแก้ เติมสินค้า 0.01 บาทเข้าไปใบเดียวก็ข้ามด่านมูลค่าขั้นต่ำของงานผลิตได้แม้ลดจนต่ำกว่าเกณฑ์) · ใบแท่ง + งานผลิตที่ไม่มีสินค้า
      -- "ไม่เปลี่ยน" (ช่องเดียวกันของใบผสมแท่งมีมาตั้งแต่ 0079 — เป็นหนี้ที่บันทึกไว้ ยังไม่แก้เพราะเปลี่ยนพฤติกรรมเดิม)
      v_production_net := v_production_total_sum - case when v_has_product_item then p_discount_thb else 0 end;
      if v_production_total_sum > 0 and v_production_net < v_jobvalue_min then
        raise exception 'oem_quote_save: มูลค่างานส่วนที่เป็นงานผลิต% (% บาท) ต่ำกว่าเกณฑ์ขั้นต่ำ % บาท ออกใบเสนอราคาไม่ได้ (ใบเงินแท่ง/สินค้าล้วนไม่ติดด่านนี้)',
          case when v_has_product_item and p_discount_thb > 0 then 'หลังหักส่วนลดทั้งใบ' else '' end,
          v_production_net, v_jobvalue_min using errcode = '22023';
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

    -- 0167 F2: รายการสินค้าที่ทุนกรอกเอง นับเข้าด่านได้ แต่ต้องมี approval_note เมื่อ (ก) ใบมีส่วนลด > 0 หรือ (ข) ถ้านับรายการทุน manual
    -- เฉพาะส่วนขาดทุน (ไม่นับกำไรที่ผู้กรอกอ้างเอง) แล้วใบขาดทุน (ราคา - ทุน < 0 เทียบเป็นจำนวนเงิน ไม่ใช่อัตราส่วน) แต่รวมแล้วผ่านด่าน margin รวมติดลบ
    -- = กำไรที่กรอกเองกลบรายการขาดทุน · note ที่มีแต่อักขระล่องหน/ช่องว่าง = ไม่มี note
    if v_has_manual_cost
       and (p_discount_thb > 0
            or ((v_price_total_all - v_manual_price_sum) - (v_cost_total_all - v_manual_cost_sum) + v_manual_loss_sum) < 0)
       and nullif(btrim(analytics.oem_text_strip_invisible(p_approval_note), v_note_ws), '') is null then
      raise exception 'oem_quote_save: ใบนี้มีรายการสินค้าที่กรอกทุนเอง (ไม่มีหลักฐานต้นทุนในแคตตาล็อก) และ% — ต้องใส่เหตุผลก่อนออกใบเสนอราคา',
        case when p_discount_thb > 0 then 'มีส่วนลด' else 'ถ้าไม่นับรายการนั้นส่วนที่เหลือของใบขาดทุน' end
        using errcode = '22023';
    end if;
  end if;

  v_approved_by := case when p_approval_note is not null and btrim(p_approval_note) <> '' then v_actor else null end;

  update analytics.oem_quote set
    input = null,
    calc = null,
    -- 0163: เก็บวันที่ผู้ขายขอ เฉพาะใบที่มีราคาพิเศษ (draft ยังไม่มี quote_valid_until — เปิดร่างกลับมาอ่านจากที่นี่)
    rate_snapshot = jsonb_build_object('formula_version', 2, 'items', v_calc_agg)
      || case when v_has_override
           then jsonb_build_object('bar_valid_until_requested', p_bar_valid_until)
           else '{}'::jsonb end,
    customer_name = coalesce(v_cust_name, customer_name),
    customer_contact = coalesce(v_cust_contact, customer_contact),
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
    updated_by = v_actor, updated_at = now()
    -- 0081: deposit_mode/deposit_input ตั้งใจไม่อยู่ใน SET clause นี้เลย —
    -- ทั้งใบใหม่ (ตั้งไปแล้วตอน insert ข้างบน) และใบเก่าที่แก้ (ต้องคงของเดิม
    -- ที่ผู้ใช้เคยตั้งเองไว้ ห้ามทับ) ต่างก็ไม่ต้องการให้ update statement นี้
    -- แตะคอลัมน์นี้
  where id = v_quote_id and shop_id = p_shop_id;

  return v_quote_id;
end;
$function$;

revoke execute on function analytics.oem_quote_save(uuid, jsonb, uuid, text, text, text, text, numeric, text, date, uuid) from public, anon, authenticated;
grant execute on function analytics.oem_quote_save(uuid, jsonb, uuid, text, text, text, text, numeric, text, date, uuid) to service_role;

-- ============================================================================
-- 2. oem_quote_renegotiate — แก้เฉพาะชุด trim ของ F2 (ตรรกะเท่าเดิม)
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
  -- ---- 0166: รายการสินค้า (metal='product') ----
  v_has_product_item boolean := false;
  -- ---- 0167 F1/F2 ----
  v_production_net numeric;
  v_has_manual_cost boolean := false;
  v_price_all numeric := 0;
  v_cost_all numeric := 0;
  v_manual_price_sum numeric := 0;
  v_manual_cost_sum numeric := 0;
  v_manual_loss_sum numeric := 0;
  -- 0168: ชุดช่องว่างที่ trim ออกจากเหตุผลของด่าน F2 (เดิม 0167 trim แค่ space/tab/CR/LF/NBSP) · ชุดเดียวกับ oem_customer_text_clean
  v_note_ws text := E' \t\r\n' || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8239) || chr(8287) || chr(12288);
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
    if (v_row.input->>'metal') = 'product' then
      v_has_product_item := true;
    end if;
    -- 0167 F2: รวมราคา/ทุนทั้งใบ และเฉพาะรายการสินค้าที่ทุน manual (อ่าน cost_source จาก snapshot ใน calc ที่เก็บไว้)
    v_price_all := v_price_all + coalesce(v_row.item_total, 0);
    v_cost_all := v_cost_all + coalesce(v_row.cost_piece, 0) * v_row.qty;
    if (v_row.input->>'metal') = 'product' and v_row.calc->'breakdown'->'product'->>'cost_source' = 'manual' then
      v_has_manual_cost := true;
      v_manual_price_sum := v_manual_price_sum + coalesce(v_row.item_total, 0);
      v_manual_cost_sum := v_manual_cost_sum + coalesce(v_row.cost_piece, 0) * v_row.qty;
      v_manual_loss_sum := v_manual_loss_sum + least(coalesce(v_row.item_total, 0) - coalesce(v_row.cost_piece, 0) * v_row.qty, 0);
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
    -- 0166 มติ 5: รายการสินค้าไม่นับเป็นมูลค่างานผลิต (เหมือน oem_quote_save)
    if (v_row.input->>'metal') not in ('silver999', 'product') then
      v_production_total_sum := v_production_total_sum + coalesce(v_row.item_total, 0);
    end if;

    -- 0079-fix: item นี้ระบบตรวจ margin รายชิ้นไม่ได้ (บันทึกไว้ตอน save เป็น
    -- margin_charged_pct = null) — เช็คจากค่า ไม่เช็คจาก metal ตรงๆ
    -- 0166 มติ 5: รายการสินค้า margin_charged_pct เป็น null โดยออกแบบ ≠ "ตรวจไม่ได้" (เหมือน oem_quote_save)
    if v_row.margin_charged_pct is null and (v_row.input->>'metal') is distinct from 'product' then
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
  if v_has_bar_item or v_has_product_item then
    -- 0167 F1: เหมือน oem_quote_save — ใบที่มีรายการสินค้า ยอดงานผลิตหลังหักส่วนลดใหม่ต้อง >= เกณฑ์ (ใบแท่ง + งานผลิตที่ไม่มีสินค้า ไม่เปลี่ยน)
    v_production_net := v_production_total_sum - case when v_has_product_item then p_new_discount_thb else 0 end;
    if v_production_total_sum > 0 and v_production_net < v_jobvalue_min then
      raise exception 'oem_quote_renegotiate: มูลค่างานส่วนที่เป็นงานผลิต% (% บาท) ต่ำกว่าเกณฑ์ขั้นต่ำ % บาท — ต่อราคาไม่ได้ (ใบเงินแท่ง/สินค้าล้วนไม่ติดด่านนี้)',
        case when v_has_product_item and p_new_discount_thb > 0 then 'หลังหักส่วนลดทั้งใบ' else '' end,
        v_production_net, v_jobvalue_min using errcode = '22023';
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

  -- 0167 F2: เหมือน oem_quote_save — รายการสินค้าทุน manual + (ส่วนลดใหม่ > 0 หรือ ตัด manual ออกแล้วส่วนที่เหลือขาดทุน) ต้องมีเหตุผล (p_reason)
  if v_has_manual_cost
     and (p_new_discount_thb > 0
          or ((v_price_all - v_manual_price_sum) - (v_cost_all - v_manual_cost_sum) + v_manual_loss_sum) < 0)
     and nullif(btrim(analytics.oem_text_strip_invisible(p_reason), v_note_ws), '') is null then
    raise exception 'oem_quote_renegotiate: ใบนี้มีรายการสินค้าที่กรอกทุนเอง (ไม่มีหลักฐานต้นทุนในแคตตาล็อก) และ% — ต้องระบุเหตุผล',
      case when p_new_discount_thb > 0 then 'มีส่วนลด' else 'ถ้าไม่นับรายการนั้นส่วนที่เหลือของใบขาดทุน' end
      using errcode = '22023';
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

-- ตรวจท้ายไฟล์: ฟังก์ชันละ 1 แถว (ไม่มี overload) และไม่เปิด execute ให้ anon/authenticated/PUBLIC — ล้มทั้ง migration ถ้าไม่ตรง
do $chk168$
declare v_cnt int; v_leak int; v_fn text;
begin
  foreach v_fn in array array['oem_quote_save', 'oem_quote_renegotiate'] loop
    select count(*) into v_cnt from pg_proc where pronamespace = 'analytics'::regnamespace and proname = v_fn;
    if v_cnt <> 1 then
      raise exception '0168 FAILED: expected exactly 1 analytics.%, found % (overload?)', v_fn, v_cnt;
    end if;
    select count(*) into v_leak from pg_proc p
      where p.pronamespace = 'analytics'::regnamespace and p.proname = v_fn
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
             or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0));
    if v_leak <> 0 then
      raise exception '0168 FAILED: % execute leaked to anon/authenticated/PUBLIC', v_fn;
    end if;
  end loop;
end $chk168$;

notify pgrst, 'reload schema';
