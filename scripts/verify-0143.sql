-- scripts/verify-0143.sql
--
-- ชุดทดสอบของ supabase/migrations/0143_spec_cost_read_path.sql (เปิดฝั่งอ่าน
-- ต้นทุนของโหมด cost_type='spec' — เติม branch 'spec' ให้ analytics.
-- v_dim_product.unit_cost/effective_unit_cost/margin_pct)
--
-- ตาม skill 3j-migration-traps ข้อ 11: do dollar-quote ... dollar-quote block เดียว จบด้วย
-- `raise exception` เสมอ ⇒ ทั้ง transaction rollback ไม่ว่าผลจะผ่าน/ไม่ผ่าน —
-- อ่านผลจาก error message นี้. ใช้เป็นทั้ง dry-run (Part 0 ติดตั้ง DDL ของ 0143
-- ทับของเดิมในทรานแซกชันนี้เอง — สมมติว่า 0131-0142 apply ไปแล้วจริงบน DB
-- เป้าหมาย ไม่ต้องลอก DDL ของไฟล์เหล่านั้นมาซ้ำ) และ post-apply verify (รันซ้ำ
-- หลัง apply จริงผ่าน MCP apply_migration — Part 0 idempotent: create or
-- replace view รันซ้ำได้ปลอดภัย)
--
-- 💰 แตะต้นทุน/สต็อก — shop/SKU/ใบผลิตสังเคราะห์ทั้งหมด (prefix ZZ143) สร้างใน
-- ทรานแซกชันนี้เอง ไม่แตะของจริงเลย ยกเว้น Part 0 ที่ "อ่าน" (ไม่เขียน)
-- v_dim_product ของ SKU จริงเพื่อพิสูจน์ว่า fixed/spot ไม่ขยับแม้แถวเดียว
--
-- โครงสร้างไฟล์:
--   Part 0  — snapshot ของจริงก่อนแตะอะไร (คอลัมน์ของ view + effective_unit_
--             cost/margin_pct ของ SKU จริงที่เป็น fixed/spot) → apply 0143 DDL
--             verbatim → snapshot ซ้ำ → เทียบเป๊ะ (เคสห้ามผ่าน #1/#2/#8)
--   Part 1  — setup: shop สังเคราะห์ + rate 24 คู่ (ให้ is_complete=true) +
--             ราคาเงินวันนี้ + SKU fixed/spot ควบคุม (regression)
--   Part 2  — T1: spec ที่ยังไม่เคยผลิต → null (เคสห้ามผ่าน #9)
--   Part 3  — T2: spec ผลิตแล้ว ไม่ติ๊กแบบใหม่ (nre=0) → effective_unit_cost
--             เท่ากับ unit_cost เต็มของรอบ (เคสห้ามผ่าน #10 เวอร์ชันสเปค)
--   Part 4  — T3: spec ผลิตแล้ว ติ๊กแบบใหม่ (nre>0) → หัก NRE ออกจริง +
--             stock_lot.unit_cost ของรอบนั้นยังเต็มรวม NRE ไม่ถูกแตะ (เคสห้าม
--             ผ่าน #4 และ #7)
--   Part 5  — T4: มี 2 รอบ done (ราคาเงินคนละราคา แยกรอบด้วย spot override
--             ต่อใบ) → ต้องได้ค่าของรอบที่ done_at ใหม่กว่า ไม่ใช่รอบเก่า
--             (เคสห้ามผ่าน #6)
--   Part 6  — T5: รอบ 'open' (ยังไม่ done) ต้องไม่ถูกนับเป็น "รอบล่าสุด" —
--             ยังเป็น null จนกว่าจะมีรอบ done จริง (เคสห้ามผ่าน #5a)
--   Part 7  — T6: รอบ 'cancelled' ต้องไม่ถูกนับเช่นกัน (เคสห้ามผ่าน #5b)
--   Part 8  — T7: SKU เคยผลิตตอนยังเป็นโหมด fixed มาก่อน (cost_calc เป็น
--             null) แล้วค่อยถูกพลิกเป็น spec — ต้องไม่หยิบรอบ fixed เก่ามาใช้
--             (พิสูจน์ตัวกรอง cost_calc is not null ที่ Tech Lead ตัดสินใจ
--             เพิ่มเอง — ดูหัวไฟล์ migration)
--   Part 9  — T8: product.unit_cost ค้างเป็นเลขเก่า (999.99) ตอนเป็น spec —
--             ต้องไม่ถูกอ่านเลย ทั้งก่อนและหลังมีรอบผลิตจริง (เคสห้ามผ่าน #3)
--   Part 10 — T9: margin_pct ของ SKU spec คำนวณจากเลขต้นทุนตัวเดียวกับที่
--             แสดงในคอลัมน์ unit_cost/effective_unit_cost (เคสห้ามผ่าน #2)
--   Part 11 — T10: regression control ด้วย SKU fixed/spot สังเคราะห์ — สูตร
--             เดิมยังให้ผลเดิมทุกประการ (คู่กับ Part 0 ที่เช็คของจริง)
--   Part 12 — T11: transform_pending_order_lines ทำงาน end-to-end ครบ 3 แบบ
--             ในแบตช์เดียว (fixed=actual ปกติ, spec ไม่เคยผลิต=estimated,
--             spec ผลิตแล้ว=actual คำนวณจากต้นทุนหัก NRE) — ลอก T1 จาก
--             verify-0136.sql + ต่อยอดจาก verify-0142.sql Part 7
--   Part 13 — T12: transform_pending_order_lines ไม่ถูกแตะ — ไม่มี overload,
--             grant ครบ, ยังมี advisory lock เดิม (ลอก T4-T6 จาก
--             verify-0136.sql)
--   Part 14 — T13: ใบผลิตผสม 3 โหมด (fixed+spot+spec) เดียวกัน preview+done
--             ผ่านครบทุกขั้น (เคสห้ามผ่าน #13)
--   Part 15 — T14: grant ของ view เอง (anon/authenticated=false, service_
--             role=true) + มี view เดียวไม่ซ้ำ (เคสห้ามผ่าน #8)

do $$
declare
  v_log text := E'\n=== verify 0143 (spec cost read path: v_dim_product branch spec) ===\n';

  -- Part 0
  v_cols_before text;
  v_cols_after  text;
  v_real_before text;
  v_real_after  text;
  v_real_spec_count int;

  -- Part 1 setup
  v_shop uuid := gen_random_uuid();
  v_rate_date date := (now() at time zone 'Asia/Bangkok')::date - 1;
  v_spot_price numeric := 72;
  v_ch uuid;

  v_p_fixed_ctrl uuid; -- regression control: fixed
  v_p_spot_ctrl  uuid; -- regression control: spot

  v_p_never       uuid; -- T1: spec, never produced
  v_p_no_nre      uuid; -- T2: spec, produced, is_new_design=false
  v_p_with_nre    uuid; -- T3: spec, produced, is_new_design=true
  v_p_multi       uuid; -- T4: spec, 2 done rounds, different spot override
  v_p_open        uuid; -- T5: spec, has an open round only, then a done round
  v_p_cancel      uuid; -- T6: spec, has a cancelled round only
  v_p_stale_round uuid; -- T7: produced under fixed mode first, converted to spec after, never produced again
  v_p_stale_value uuid; -- T8: product.unit_cost = 999.99 stale value while spec

  v_res     jsonb;
  v_order_id uuid;
  v_item_res jsonb;
  v_item_id  uuid;
  v_item_a_id uuid;
  v_item_b_id uuid;
  v_order_a  uuid;
  v_order_b  uuid;

  v_view_cost     numeric;
  v_view_margin   numeric;
  v_poi_unit_cost numeric;
  v_poi_nre       numeric;
  v_expected      numeric;
  v_lot_unit_cost numeric;

  v_cost_a numeric;
  v_cost_b numeric;
  v_view_after_b numeric;

  v_ch2 uuid;
  v_batch uuid := gen_random_uuid();
  v_fo1 uuid; v_fo2 uuid; v_fo3 uuid;
  v_r record;
  v_cogs1 numeric; v_cogs2 numeric; v_cogs3 numeric;
  v_status1 text; v_status2 text; v_status3 text;

  v_def text;
  v_overload_count int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -----------------------------------------------------------------------
  -- Part 0: snapshot ของจริงก่อนแตะอะไรเลย
  -----------------------------------------------------------------------
  select string_agg(ordinal_position::text || ':' || column_name || ':' || data_type, ',' order by ordinal_position)
    into v_cols_before
  from information_schema.columns
  where table_schema = 'analytics' and table_name = 'v_dim_product';

  select string_agg(
      product_id::text || ':' ||
      coalesce(unit_cost::text, 'NULL') || ':' ||
      coalesce(effective_unit_cost::text, 'NULL') || ':' ||
      coalesce(margin_pct::text, 'NULL'),
      ',' order by product_id
    )
    into v_real_before
  from analytics.v_dim_product
  where cost_type in ('fixed', 'spot');

  select count(*) into v_real_spec_count from analytics.v_dim_product where cost_type = 'spec';

  -- Part 0 (DDL): apply 0143 verbatim — plain CREATE OR REPLACE VIEW ไม่มี
  -- dollar-quoted body ให้ชนกับ dollar-quote ของ do block นี้ จึงไม่ต้อง EXECUTE
  create or replace view analytics.v_dim_product
    with (security_invoker = true) as
  select
    p.id as product_id,
    p.shop_id,
    p.sku,
    p.name,
    (case p.cost_type
      when 'spot' then round(coalesce(p.silver_weight_g, 0) * coalesce(s.silver_spot_thb_per_gram, 0)
                              * coalesce(p.silver_purity, 0.925) + coalesce(p.labor_cost, 0), 2)
      when 'spec' then spec_lot.unit_cost_less_nre
      else p.unit_cost
    end)::numeric(12, 2) as unit_cost,
    p.is_active,
    p.category,
    p.created_at,
    p.updated_at,
    p.cost_type,
    p.silver_weight_g,
    coalesce(p.silver_purity, 0.925) as silver_purity,
    p.labor_cost,
    p.list_price,
    p.unit_cost as manual_unit_cost,
    (case p.cost_type
      when 'spot' then round(coalesce(p.silver_weight_g, 0) * coalesce(s.silver_spot_thb_per_gram, 0)
                              * coalesce(p.silver_purity, 0.925) + coalesce(p.labor_cost, 0), 2)
      when 'spec' then spec_lot.unit_cost_less_nre
      else p.unit_cost
    end)::numeric(12, 2) as effective_unit_cost,
    case
      when p.list_price is not null and p.list_price > 0 then
        round((p.list_price - (case p.cost_type
          when 'spot' then round(coalesce(p.silver_weight_g, 0) * coalesce(s.silver_spot_thb_per_gram, 0)
                                  * coalesce(p.silver_purity, 0.925) + coalesce(p.labor_cost, 0), 2)
          when 'spec' then spec_lot.unit_cost_less_nre
          else p.unit_cost end)) / p.list_price, 4)
      else null
    end as margin_pct,
    coalesce(lot.qty_remaining_total, 0) as lot_qty_on_hand,
    lot.cost_avg_remaining as lot_cost_avg,
    coalesce(lot.lot_count, 0) as lot_count
  from public.product p
  left join analytics.shop_setting s on s.shop_id = p.shop_id
  left join (
    select
      product_id,
      sum(qty_remaining) as qty_remaining_total,
      round(sum(unit_cost * qty_remaining) / sum(qty_remaining), 2) as cost_avg_remaining,
      count(*) as lot_count
    from analytics.stock_lot
    where qty_remaining > 0
    group by product_id
  ) lot on lot.product_id = p.id
  left join lateral (
    select poi.unit_cost - coalesce((poi.cost_calc ->> 'nre_per_piece')::numeric, 0)
      as unit_cost_less_nre
    from analytics.production_order_item poi
    join analytics.production_order po on po.id = poi.production_order_id
    where poi.product_id = p.id
      and po.status = 'done'
      and jsonb_typeof(poi.cost_calc) = 'object'   -- 0143 fix: cost_calc ของรอบ
    -- โหมด fixed/spot เป็น JSON null (jsonb_typeof='null') ไม่ใช่ SQL NULL
    -- ⇒ "is not null" ตาบอด ปล่อยรอบโหมดเก่าหลุดมาเป็นต้นทุนสเปค (เจอจากรอบซ้อม T7b)
    order by po.done_at desc nulls last, poi.updated_at desc, poi.id desc
    limit 1
  ) spec_lot on true;

  v_log := v_log || '[Part 0a] apply 0143 DDL verbatim (create or replace view): OK (no error)' || E'\n';

  select string_agg(ordinal_position::text || ':' || column_name || ':' || data_type, ',' order by ordinal_position)
    into v_cols_after
  from information_schema.columns
  where table_schema = 'analytics' and table_name = 'v_dim_product';

  v_log := v_log || format('[Part 0b] 🔴 คอลัมน์ v_dim_product ก่อน/หลัง เหมือนเดิมเป๊ะ (ชื่อ/ลำดับ/ชนิด, เคสห้ามผ่าน #8): %s' || E'\n',
    case when v_cols_before = v_cols_after then 'OK' else 'FAIL: ' || v_cols_before || ' <> ' || v_cols_after end);

  select string_agg(
      product_id::text || ':' ||
      coalesce(unit_cost::text, 'NULL') || ':' ||
      coalesce(effective_unit_cost::text, 'NULL') || ':' ||
      coalesce(margin_pct::text, 'NULL'),
      ',' order by product_id
    )
    into v_real_after
  from analytics.v_dim_product
  where cost_type in ('fixed', 'spot');

  v_log := v_log || format('[Part 0c] 🔴 SKU จริงทั้งหมดที่เป็น fixed/spot (unit_cost/effective_unit_cost/margin_pct) ไม่ขยับแม้แถวเดียว (เคสห้ามผ่าน #1, #2) — SKU spec ของจริงวันนี้ (คาด 0 ตาม 0142 header) = %s ตัว: %s' || E'\n',
    v_real_spec_count,
    case when v_real_before = v_real_after then 'OK' else 'FAIL — เปลี่ยนแล้ว ดูรายละเอียด: ' || v_real_before || ' VS ' || v_real_after end);

  v_log := v_log || format('[Part 0d] grant ของ view ยังเป็น anon=false authenticated=false service_role=true (0123/0124, ไม่ต้อง grant ใหม่หลัง create-or-replace-view): %s' || E'\n',
    case when has_table_privilege('anon', 'analytics.v_dim_product', 'select') = false
          and has_table_privilege('authenticated', 'analytics.v_dim_product', 'select') = false
          and has_table_privilege('service_role', 'analytics.v_dim_product', 'select') = true
         then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 1: setup shop/SKU/rate สังเคราะห์ (prefix ZZ143)
  -----------------------------------------------------------------------
  insert into public.shop (id, name) values (v_shop, 'ZZ TEST verify-0143');

  select id into v_ch from analytics.dim_channel where code = 'tiktok';
  if v_ch is null then
    raise exception 'verify-0143 setup: analytics.dim_channel ไม่มีแถว tiktok';
  end if;

  v_p_fixed_ctrl := analytics.product_upsert(v_shop, 'ZZ143-FIXED', 'regression fixed', null, 'fixed', 88, null, null, null, 150, null, null, null, true);
  v_p_spot_ctrl  := analytics.product_upsert(v_shop, 'ZZ143-SPOT',  'regression spot',  null, 'spot', null, 10, 0.925, 20, 300, null, null, null, true);

  perform analytics.oem_metal_price_set(v_shop, 'silver', v_spot_price, (now() at time zone 'Asia/Bangkok')::date, 'manual');

  -- rate 24 คู่ (เหมือน verify-0141/0142's Part 2) ให้ item_kind='แหวน'/
  -- polish_tier='เรียบ' silver ไม่มีพลอย/ไม่มีชุบ is_complete=true ได้จริง
  insert into analytics.oem_cost_rate (shop_id, rate_key, scope, effective_from, value) values
    (v_shop, 'reject_rate_cast_pct', '-', v_rate_date, 0.02),
    (v_shop, 'reject_rate_polish_pct', '-', v_rate_date, 0.01),
    (v_shop, 'labor_thb_per_day', 'ฉีดเทียน', v_rate_date, 500),
    (v_shop, 'work_hours_per_day', 'ฉีดเทียน', v_rate_date, 8),
    (v_shop, 'wax_inject_pieces_per_hour', '-', v_rate_date, 20),
    (v_shop, 'wax_material_thb_per_piece', '-', v_rate_date, 5),
    (v_shop, 'labor_thb_per_day', 'หล่อ', v_rate_date, 600),
    (v_shop, 'work_hours_per_day', 'หล่อ', v_rate_date, 8),
    (v_shop, 'cut_sprue_minutes_per_piece', '-', v_rate_date, 2),
    (v_shop, 'labor_thb_per_day', 'ขัด', v_rate_date, 550),
    (v_shop, 'work_hours_per_day', 'ขัด', v_rate_date, 8),
    (v_shop, 'polish_pieces_per_day', 'เรียบ', v_rate_date, 40),
    (v_shop, 'labor_thb_per_day', 'QC', v_rate_date, 500),
    (v_shop, 'work_hours_per_day', 'QC', v_rate_date, 8),
    (v_shop, 'qc_pieces_per_day', '-', v_rate_date, 100),
    (v_shop, 'pack_cost_thb_per_piece', '-', v_rate_date, 5),
    (v_shop, 'flask_capacity_pieces', 'แหวน', v_rate_date, 20),
    (v_shop, 'flask_cost_thb', '-', v_rate_date, 150),
    (v_shop, 'sprue_loss_pct', 'silver', v_rate_date, 0.05),
    (v_shop, 'recovery_rate_pct', 'silver', v_rate_date, 0.9),
    (v_shop, 'polish_loss_pct', 'silver', v_rate_date, 0.02),
    (v_shop, 'cad_fee_thb', '-', v_rate_date, 2000),
    (v_shop, 'print3d_cost_thb', '-', v_rate_date, 150),
    (v_shop, 'rubber_mold_cost_thb', '-', v_rate_date, 300);

  v_log := v_log || '[Part 1] setup 1 shop + 2 SKU control (fixed/spot) + 24 rate + ราคาเงินวันนี้: OK' || E'\n';

  -----------------------------------------------------------------------
  -- Part 2 (T1): spec ที่ยังไม่เคยผลิต → null (เคสห้ามผ่าน #9 — ไม่พัง)
  -----------------------------------------------------------------------
  v_p_never := analytics.product_upsert(v_shop, 'ZZ143-NEVER', 'spec ไม่เคยผลิต', null, 'fixed', null, 3.5, 0.925, null, 400, null, null, null, true);
  perform analytics.product_make_spec_set(v_shop, v_p_never, jsonb_build_object('metal', 'silver', 'item_kind', 'แหวน', 'polish_tier', 'เรียบ'));

  select unit_cost, margin_pct into v_view_cost, v_view_margin from analytics.v_dim_product where product_id = v_p_never;
  v_log := v_log || format('[T1] spec ยังไม่เคยผลิต: unit_cost=%s (คาด NULL) margin_pct=%s (คาด NULL): %s' || E'\n',
    v_view_cost, v_view_margin,
    case when v_view_cost is null and v_view_margin is null then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 3 (T2): spec ผลิตแล้ว ไม่ติ๊กแบบใหม่ (nre=0) → effective_unit_cost
  -- เท่ากับ unit_cost เต็มของรอบ (nre_per_piece=0 หักแล้วไม่เปลี่ยนอะไร)
  -----------------------------------------------------------------------
  v_p_no_nre := analytics.product_upsert(v_shop, 'ZZ143-NONRE', 'spec ผลิตแล้ว ไม่ติ๊กแบบใหม่', null, 'fixed', null, 3.5, 0.925, null, null, null, null, null, true);
  perform analytics.product_make_spec_set(v_shop, v_p_no_nre, jsonb_build_object('metal', 'silver', 'item_kind', 'แหวน', 'polish_tier', 'เรียบ'));

  v_res := analytics.production_order_save(v_shop, null, 'T2 no-nre', null);
  v_order_id := (v_res ->> 'id')::uuid;
  v_item_res := analytics.production_order_item_set(v_shop, v_order_id, v_p_no_nre, 5);
  -- is_new_design ปล่อย default false (ยังไม่มี RPC toggle สาธารณะตาม 0141)
  perform analytics.production_order_done(v_shop, v_order_id, null, v_spot_price, null);

  select unit_cost, coalesce((cost_calc ->> 'nre_per_piece')::numeric, 0)
    into v_poi_unit_cost, v_poi_nre
    from analytics.production_order_item where production_order_id = v_order_id and product_id = v_p_no_nre;
  select effective_unit_cost into v_view_cost from analytics.v_dim_product where product_id = v_p_no_nre;

  v_log := v_log || format('[T2] spec ผลิตแล้ว ไม่ติ๊กแบบใหม่: poi.unit_cost=%s nre_per_piece=%s (คาด 0) view.effective_unit_cost=%s (คาด เท่ากับ poi.unit_cost): %s' || E'\n',
    v_poi_unit_cost, v_poi_nre, v_view_cost,
    case when v_poi_nre = 0 and v_view_cost = v_poi_unit_cost then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 4 (T3): spec ผลิตแล้ว ติ๊กแบบใหม่ (nre>0) → หัก NRE ออกจริง (เคสห้าม
  -- ผ่าน #4) + stock_lot.unit_cost ของรอบนั้นยังเต็มรวม NRE ไม่ถูกแตะ (#7)
  -----------------------------------------------------------------------
  v_p_with_nre := analytics.product_upsert(v_shop, 'ZZ143-WITHNRE', 'spec ผลิตแล้ว ติ๊กแบบใหม่', null, 'fixed', null, 3.5, 0.925, null, null, null, null, null, true);
  perform analytics.product_make_spec_set(v_shop, v_p_with_nre, jsonb_build_object('metal', 'silver', 'item_kind', 'แหวน', 'polish_tier', 'เรียบ'));

  v_res := analytics.production_order_save(v_shop, null, 'T3 with-nre', null);
  v_order_id := (v_res ->> 'id')::uuid;
  v_item_res := analytics.production_order_item_set(v_shop, v_order_id, v_p_with_nre, 5);
  v_item_id := (v_item_res ->> 'id')::uuid;
  update analytics.production_order_item set is_new_design = true where id = v_item_id; -- ใบยัง open — ผ่าน deny_mutation ได้
  perform analytics.production_order_done(v_shop, v_order_id, null, v_spot_price, null);

  select unit_cost, coalesce((cost_calc ->> 'nre_per_piece')::numeric, 0)
    into v_poi_unit_cost, v_poi_nre
    from analytics.production_order_item where id = v_item_id;
  select effective_unit_cost into v_view_cost from analytics.v_dim_product where product_id = v_p_with_nre;
  select unit_cost into v_lot_unit_cost from analytics.stock_lot where production_order_item_id = v_item_id;

  v_expected := v_poi_unit_cost - v_poi_nre;
  v_log := v_log || format('[T3a] spec ผลิตแล้ว ติ๊กแบบใหม่: poi.unit_cost=%s nre_per_piece=%s (คาด > 0) view.effective_unit_cost=%s (คาด %s = poi.unit_cost - nre_per_piece, ต้อง != poi.unit_cost เต็ม): %s' || E'\n',
    v_poi_unit_cost, v_poi_nre, v_view_cost, v_expected,
    case when v_poi_nre > 0 and v_view_cost = v_expected and v_view_cost <> v_poi_unit_cost then 'OK' else 'FAIL' end);

  v_log := v_log || format('[T3b] 🔴 stock_lot.unit_cost ของรอบนี้ยังเต็มรวม NRE เหมือนเดิม (เคสห้ามผ่าน #7): stock_lot.unit_cost=%s (คาด = poi.unit_cost เต็ม = %s, ไม่ใช่เลขที่หัก NRE แล้ว): %s' || E'\n',
    v_lot_unit_cost, v_poi_unit_cost,
    case when v_lot_unit_cost = v_poi_unit_cost then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 5 (T4): มี 2 รอบ done — แยกด้วย spot override ต่อใบ (คนละราคาเงิน
  -- ชัดเจน) รอบเก่าถูก backdate done_at/updated_at ย้อนหลัง (ภายใน
  -- ทรานแซกชันเดียวกัน now() คงที่ตลอด transaction ⇒ ต้อง backdate เอง ไม่งั้น
  -- ทดสอบ "เลือกรอบผิด" ไม่ได้จริง) ⇒ ต้องได้ค่าของรอบใหม่กว่าเท่านั้น (เคสห้าม
  -- ผ่าน #6) — ปลด/คืน trigger deny_mutation ชั่วคราวเพื่อ backdate เท่านั้น
  -- (ทั้ง transaction นี้ rollback อยู่แล้วจาก raise exception ท้ายไฟล์)
  -----------------------------------------------------------------------
  v_p_multi := analytics.product_upsert(v_shop, 'ZZ143-MULTI', 'spec หลายรอบ', null, 'fixed', null, 3.5, 0.925, null, null, null, null, null, true);
  perform analytics.product_make_spec_set(v_shop, v_p_multi, jsonb_build_object('metal', 'silver', 'item_kind', 'แหวน', 'polish_tier', 'เรียบ'));

  -- รอบ A (เก่ากว่า, override 50 บาท/กรัม)
  v_res := analytics.production_order_save(v_shop, null, 'T4 round A (older, spot 50)', 50);
  v_order_a := (v_res ->> 'id')::uuid;
  v_item_res := analytics.production_order_item_set(v_shop, v_order_a, v_p_multi, 5);
  v_item_a_id := (v_item_res ->> 'id')::uuid;
  perform analytics.production_order_done(v_shop, v_order_a, null, 50, null);

  alter table analytics.production_order disable trigger trg_production_order_deny_mutation;
  update analytics.production_order set done_at = now() - interval '2 days' where id = v_order_a;
  alter table analytics.production_order enable trigger trg_production_order_deny_mutation;

  alter table analytics.production_order_item disable trigger trg_production_order_item_deny_mutation;
  update analytics.production_order_item set updated_at = now() - interval '2 days' where id = v_item_a_id;
  alter table analytics.production_order_item enable trigger trg_production_order_item_deny_mutation;

  select unit_cost into v_cost_a from analytics.production_order_item where id = v_item_a_id;

  -- รอบ B (ใหม่กว่า — ไม่ backdate, override 90 บาท/กรัม)
  v_res := analytics.production_order_save(v_shop, null, 'T4 round B (newer, spot 90)', 90);
  v_order_b := (v_res ->> 'id')::uuid;
  v_item_res := analytics.production_order_item_set(v_shop, v_order_b, v_p_multi, 5);
  v_item_b_id := (v_item_res ->> 'id')::uuid;
  perform analytics.production_order_done(v_shop, v_order_b, null, 90, null);

  select unit_cost into v_cost_b from analytics.production_order_item where id = v_item_b_id;
  select effective_unit_cost into v_view_after_b from analytics.v_dim_product where product_id = v_p_multi;

  v_log := v_log || format('[T4] หลายรอบ done: cost รอบ A (เก่า, spot 50)=%s, cost รอบ B (ใหม่, spot 90)=%s (ต้องต่างกันชัดเจน), view.effective_unit_cost=%s (คาด = รอบ B = %s ไม่ใช่รอบ A): %s' || E'\n',
    v_cost_a, v_cost_b, v_view_after_b, v_cost_b,
    case when v_cost_a <> v_cost_b and v_view_after_b = v_cost_b and v_view_after_b <> v_cost_a then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 6 (T5): รอบ 'open' ต้องไม่ถูกนับเป็นรอบล่าสุด (เคสห้ามผ่าน #5a)
  -----------------------------------------------------------------------
  v_p_open := analytics.product_upsert(v_shop, 'ZZ143-OPEN', 'spec มีแค่รอบ open', null, 'fixed', null, 3.5, 0.925, null, null, null, null, null, true);
  perform analytics.product_make_spec_set(v_shop, v_p_open, jsonb_build_object('metal', 'silver', 'item_kind', 'แหวน', 'polish_tier', 'เรียบ'));

  v_res := analytics.production_order_save(v_shop, null, 'T5 open only', null);
  v_order_id := (v_res ->> 'id')::uuid;
  perform analytics.production_order_item_set(v_shop, v_order_id, v_p_open, 5);
  -- ไม่เรียก production_order_done — ใบยังเป็น open

  select effective_unit_cost into v_view_cost from analytics.v_dim_product where product_id = v_p_open;
  v_log := v_log || format('[T5a] มีแค่รอบ open (ไม่ done): effective_unit_cost=%s (คาด NULL): %s' || E'\n',
    v_view_cost, case when v_view_cost is null then 'OK' else 'FAIL' end);

  -- ปิดรอบเป็น done จริง แล้วต้องเห็นค่าไม่ null (พิสูจน์ว่ารอบ open ที่ค้าง
  -- อยู่ก่อนหน้าไม่ได้บล็อก/ปนกับรอบ done ที่มาทีหลัง)
  perform analytics.production_order_done(v_shop, v_order_id, null, v_spot_price, null);
  select effective_unit_cost into v_view_cost from analytics.v_dim_product where product_id = v_p_open;
  v_log := v_log || format('[T5b] ปิดรอบเป็น done แล้ว: effective_unit_cost=%s (คาด ไม่ null): %s' || E'\n',
    v_view_cost, case when v_view_cost is not null then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 7 (T6): รอบ 'cancelled' ต้องไม่ถูกนับ (เคสห้ามผ่าน #5b)
  -----------------------------------------------------------------------
  v_p_cancel := analytics.product_upsert(v_shop, 'ZZ143-CANCEL', 'spec มีแค่รอบ cancelled', null, 'fixed', null, 3.5, 0.925, null, null, null, null, null, true);
  perform analytics.product_make_spec_set(v_shop, v_p_cancel, jsonb_build_object('metal', 'silver', 'item_kind', 'แหวน', 'polish_tier', 'เรียบ'));

  v_res := analytics.production_order_save(v_shop, null, 'T6 cancelled', null);
  v_order_id := (v_res ->> 'id')::uuid;
  perform analytics.production_order_item_set(v_shop, v_order_id, v_p_cancel, 5);
  perform analytics.production_order_cancel(v_shop, v_order_id, 'ทดสอบ verify-0143');

  select effective_unit_cost into v_view_cost from analytics.v_dim_product where product_id = v_p_cancel;
  v_log := v_log || format('[T6] มีแค่รอบ cancelled: effective_unit_cost=%s (คาด NULL): %s' || E'\n',
    v_view_cost, case when v_view_cost is null then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 8 (T7): 🔴 พิสูจน์ตัวกรอง `poi.cost_calc is not null` ที่ Tech Lead
  -- ตัดสินใจเพิ่มเอง — SKU เคยถูกผลิต "ตอนยังเป็นโหมด fixed" (cost_calc เป็น
  -- null เพราะ fixed ไม่เคยเขียน cost_calc) แล้วค่อยพลิกเป็น spec ทีหลัง โดย
  -- ยังไม่เคยมีรอบผลิตภายใต้โหมด spec เลยสักรอบ — ต้องได้ NULL ไม่ใช่เลขจาก
  -- รอบ fixed เก่า (ซึ่งไม่ตรงกับความหมาย "ต้นทุนตามสเปคปัจจุบัน")
  -----------------------------------------------------------------------
  v_p_stale_round := analytics.product_upsert(v_shop, 'ZZ143-STALEROUND', 'เคยผลิตตอนเป็น fixed', null, 'fixed', 77, null, null, null, null, null, null, null, true);

  v_res := analytics.production_order_save(v_shop, null, 'T7 produced while fixed', null);
  v_order_id := (v_res ->> 'id')::uuid;
  perform analytics.production_order_item_set(v_shop, v_order_id, v_p_stale_round, 4);
  perform analytics.production_order_done(v_shop, v_order_id, null, null, null); -- fixed ไม่ต้องใช้ราคาเงิน

  -- ตอนนี้ยังเป็น fixed — ต้องเห็นต้นทุนปกติก่อน (sanity)
  select effective_unit_cost into v_view_cost from analytics.v_dim_product where product_id = v_p_stale_round;
  v_log := v_log || format('[T7a] sanity: ตอนยังเป็น fixed หลังผลิตแล้ว effective_unit_cost=%s (คาด 77): %s' || E'\n',
    v_view_cost, case when v_view_cost = 77 then 'OK' else 'FAIL' end);

  -- พลิกเป็น spec (ยังไม่เคยผลิตภายใต้ spec เลยสักรอบ)
  perform analytics.product_make_spec_set(v_shop, v_p_stale_round, jsonb_build_object('metal', 'silver', 'item_kind', 'แหวน', 'polish_tier', 'เรียบ'));
  perform analytics.product_upsert(v_shop, 'ZZ143-STALEROUND', 'เคยผลิตตอนเป็น fixed', null, 'spec', 77, 3.5, 0.925, null, null, null, null, null, true);

  select effective_unit_cost into v_view_cost from analytics.v_dim_product where product_id = v_p_stale_round;
  v_log := v_log || format('[T7b] 🔴 พลิกเป็น spec แล้ว (ยังไม่เคยผลิตภายใต้ spec): effective_unit_cost=%s (คาด NULL — ต้องไม่หยิบรอบ fixed เก่าที่ cost_calc เป็น null มาใช้): %s' || E'\n',
    v_view_cost, case when v_view_cost is null then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 9 (T8): product.unit_cost ค้างเป็นเลขเก่า (999.99) ตอนเป็น spec —
  -- ต้องไม่ถูกอ่านเลย ทั้งก่อนและหลังมีรอบผลิตจริง (เคสห้ามผ่าน #3)
  -----------------------------------------------------------------------
  v_p_stale_value := analytics.product_upsert(v_shop, 'ZZ143-STALEVALUE', 'unit_cost ค้างเลขเก่า', null, 'fixed', 999.99, null, null, null, null, null, null, null, true);
  perform analytics.product_make_spec_set(v_shop, v_p_stale_value, jsonb_build_object('metal', 'silver', 'item_kind', 'แหวน', 'polish_tier', 'เรียบ'));
  -- คง p_unit_cost=999.99 ไว้โดยตั้งใจ (จำลองเลขทุนเก่าที่ค้างอยู่ในคอลัมน์ —
  -- product_make_spec_set ไม่แตะคอลัมน์ unit_cost เลย ดังนั้นค่าเดิมยังอยู่)
  perform analytics.product_upsert(v_shop, 'ZZ143-STALEVALUE', 'unit_cost ค้างเลขเก่า', null, 'spec', 999.99, 3.5, 0.925, null, null, null, null, null, true);

  select effective_unit_cost, manual_unit_cost into v_view_cost, v_expected from analytics.v_dim_product where product_id = v_p_stale_value;
  v_log := v_log || format('[T8a] ยังไม่เคยผลิต: manual_unit_cost (ดิบจาก p.unit_cost)=%s (คาด 999.99, คอลัมน์นี้แสดงค่าดิบตามปกติไม่เปลี่ยนพฤติกรรม) แต่ effective_unit_cost=%s (คาด NULL — ห้ามหยิบ 999.99 มาใช้): %s' || E'\n',
    v_expected, v_view_cost,
    case when v_expected = 999.99 and v_view_cost is null then 'OK' else 'FAIL' end);

  v_res := analytics.production_order_save(v_shop, null, 'T8 real spec round', null);
  v_order_id := (v_res ->> 'id')::uuid;
  perform analytics.production_order_item_set(v_shop, v_order_id, v_p_stale_value, 5);
  perform analytics.production_order_done(v_shop, v_order_id, null, v_spot_price, null);

  select effective_unit_cost into v_view_cost from analytics.v_dim_product where product_id = v_p_stale_value;
  v_log := v_log || format('[T8b] ผลิตจริงแล้ว: effective_unit_cost=%s (คาด != 999.99 และ != NULL — ต้องเป็นเลขจากรอบผลิตจริง): %s' || E'\n',
    v_view_cost,
    case when v_view_cost is not null and v_view_cost <> 999.99 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 10 (T9): margin_pct ของ SKU spec คำนวณจากเลขต้นทุนตัวเดียวกับที่
  -- แสดงในคอลัมน์ unit_cost/effective_unit_cost (เคสห้ามผ่าน #2)
  -----------------------------------------------------------------------
  perform analytics.product_upsert(v_shop, 'ZZ143-NONRE', 'spec ผลิตแล้ว ไม่ติ๊กแบบใหม่', null, 'spec', null, 3.5, 0.925, null, 1000, null, null, null, true);

  select unit_cost, effective_unit_cost, margin_pct into v_poi_unit_cost, v_view_cost, v_view_margin
    from analytics.v_dim_product where product_id = v_p_no_nre;
  v_expected := round((1000 - v_view_cost) / 1000, 4);

  v_log := v_log || format('[T9] margin_pct ของ spec: unit_cost=%s effective_unit_cost=%s (ต้องเท่ากัน) margin_pct=%s (คาด %s = (1000-effective_unit_cost)/1000): %s' || E'\n',
    v_poi_unit_cost, v_view_cost, v_view_margin, v_expected,
    case when v_poi_unit_cost = v_view_cost and v_view_margin = v_expected then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 11 (T10): regression control — SKU fixed/spot สังเคราะห์ สูตรเดิม
  -- ยังให้ผลเดิมทุกประการ (คู่กับ Part 0 ที่เช็คของจริง)
  -----------------------------------------------------------------------
  select unit_cost, effective_unit_cost, margin_pct into v_view_cost, v_poi_unit_cost, v_view_margin
    from analytics.v_dim_product where product_id = v_p_fixed_ctrl;
  v_log := v_log || format('[T10a] fixed control: unit_cost=%s effective_unit_cost=%s (คาดทั้งคู่ 88) margin_pct=%s (คาด %s = (150-88)/150): %s' || E'\n',
    v_view_cost, v_poi_unit_cost, v_view_margin, round((150 - 88::numeric) / 150, 4),
    case when v_view_cost = 88 and v_poi_unit_cost = 88 and v_view_margin = round((150 - 88::numeric) / 150, 4) then 'OK' else 'FAIL' end);

  -- spot: weight=10 purity=0.925 labor=20 spot_price=72 (ดังที่ตั้งไว้ Part 1)
  v_expected := round(10 * v_spot_price * 0.925 + 20, 2);
  select unit_cost, effective_unit_cost, margin_pct into v_view_cost, v_poi_unit_cost, v_view_margin
    from analytics.v_dim_product where product_id = v_p_spot_ctrl;
  v_log := v_log || format('[T10b] spot control: unit_cost=%s effective_unit_cost=%s (คาดทั้งคู่ %s = 10*72*0.925+20) margin_pct=%s (คาด %s): %s' || E'\n',
    v_view_cost, v_poi_unit_cost, v_expected, v_view_margin, round((300 - v_expected) / 300, 4),
    case when v_view_cost = v_expected and v_poi_unit_cost = v_expected and v_view_margin = round((300 - v_expected) / 300, 4) then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 12 (T11): transform_pending_order_lines end-to-end ครบ 3 แบบใน
  -- แบตช์เดียว — ลอก T1 จาก verify-0136.sql + ต่อยอดจาก verify-0142.sql Part 7
  -----------------------------------------------------------------------
  select id into v_ch2 from analytics.dim_channel where code = 'tiktok';

  insert into analytics.stg_import_batch (id, shop_id, source_type, file_hash)
    values (v_batch, v_shop, 'excel_line_item_report', 'zz143-test-hash');

  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
    values (v_shop, 'ZZ143-O1', v_ch2, (now() at time zone 'Asia/Bangkok')::date, 200) returning id into v_fo1;
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
    values (v_shop, 'ZZ143-O2', v_ch2, (now() at time zone 'Asia/Bangkok')::date, 500) returning id into v_fo2;
  insert into analytics.fact_order (shop_id, source_order_no, channel_id, order_date, revenue)
    values (v_shop, 'ZZ143-O3', v_ch2, (now() at time zone 'Asia/Bangkok')::date, 800) returning id into v_fo3;

  -- O1: SKU fixed ปกติ (regression)
  insert into analytics.stg_order_line_import (shop_id, batch_id, source_order_no, line_no, sku_raw, product_name_raw, qty, unit_price, import_status, raw)
    values (v_shop, v_batch, 'ZZ143-O1', 1, 'ZZ143-FIXED', 'regression fixed', 2, 100, 'pending', '{}'::jsonb);
  -- O2: SKU spec ที่ยังไม่เคยผลิต (v_p_never — ต้องยัง estimated ตาม 0142)
  insert into analytics.stg_order_line_import (shop_id, batch_id, source_order_no, line_no, sku_raw, product_name_raw, qty, unit_price, import_status, raw)
    values (v_shop, v_batch, 'ZZ143-O2', 1, 'ZZ143-NEVER', 'spec ไม่เคยผลิต', 1, 500, 'pending', '{}'::jsonb);
  -- O3: SKU spec ที่ผลิตแล้ว (v_p_no_nre — ต้องกลับเป็น actual แล้ว)
  insert into analytics.stg_order_line_import (shop_id, batch_id, source_order_no, line_no, sku_raw, product_name_raw, qty, unit_price, import_status, raw)
    values (v_shop, v_batch, 'ZZ143-O3', 1, 'ZZ143-NONRE', 'spec ผลิตแล้ว', 3, 800, 'pending', '{}'::jsonb);

  select * into v_r from analytics.transform_pending_order_lines(v_shop, v_batch);
  v_log := v_log || format('[T11a] transform ครบ 3 บรรทัด: transformed=%s (คาด 3) errored=%s (คาด 0): %s' || E'\n',
    v_r.transformed_count, v_r.errored_count,
    case when v_r.transformed_count = 3 and v_r.errored_count = 0 then 'OK' else 'FAIL' end);

  select cogs, profit_status::text into v_cogs1, v_status1 from analytics.fact_order where id = v_fo1;
  v_log := v_log || format('[T11b] O1 (fixed ปกติ): cogs=%s (คาด 176 = 2*88) profit_status=%s (คาด actual): %s' || E'\n',
    v_cogs1, v_status1,
    case when v_cogs1 = 176 and v_status1 = 'actual' then 'OK' else 'FAIL' end);

  select cogs, profit_status::text into v_cogs2, v_status2 from analytics.fact_order where id = v_fo2;
  v_log := v_log || format('[T11c] O2 (spec ไม่เคยผลิต): cogs=%s (คาด 0) profit_status=%s (คาด estimated — พฤติกรรมเดิมจาก 0142 ไม่เปลี่ยน): %s' || E'\n',
    v_cogs2, v_status2,
    case when v_cogs2 = 0 and v_status2 = 'estimated' then 'OK' else 'FAIL' end);

  select effective_unit_cost into v_view_cost from analytics.v_dim_product where product_id = v_p_no_nre;
  select cogs, profit_status::text into v_cogs3, v_status3 from analytics.fact_order where id = v_fo3;
  v_log := v_log || format('[T11d] 🔴 O3 (spec ผลิตแล้ว): cogs=%s (คาด %s = 3 x effective_unit_cost) profit_status=%s (คาด actual — กลับจาก estimated เป็น actual เองโดยไม่ต้องแก้ transform_pending_order_lines): %s' || E'\n',
    v_cogs3, round(3 * v_view_cost, 2), v_status3,
    case when v_cogs3 = round(3 * v_view_cost, 2) and v_status3 = 'actual' then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 13 (T12): transform_pending_order_lines ไม่ถูกแตะเลย — ไม่มี
  -- overload, grant ครบ, ยังมี advisory lock เดิม (ลอก T4-T6 จาก
  -- verify-0136.sql)
  -----------------------------------------------------------------------
  select pg_get_functiondef('analytics.transform_pending_order_lines(uuid,uuid)'::regprocedure) into v_def;
  v_log := v_log || format('[T12a] transform_pending_order_lines ยังมี advisory lock key เดิม (0136/0142 ไม่ถูกแตะรอบนี้): %s' || E'\n',
    case when v_def like '%pg_advisory_xact_lock%' and v_def like '%analytics.fact_order:%' then 'OK' else 'FAIL' end);

  select count(*) into v_overload_count from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'transform_pending_order_lines';
  v_log := v_log || format('[T12b] ไม่มี overload ค้าง (signature ไม่เปลี่ยน): %s ตัว (คาด 1): %s' || E'\n',
    v_overload_count, case when v_overload_count = 1 then 'OK' else 'FAIL' end);

  v_log := v_log || format('[T12c] grant transform_pending_order_lines: anon=%s auth=%s svc=%s (คาด f/f/t): %s' || E'\n',
    has_function_privilege('anon', 'analytics.transform_pending_order_lines(uuid,uuid)', 'execute'),
    has_function_privilege('authenticated', 'analytics.transform_pending_order_lines(uuid,uuid)', 'execute'),
    has_function_privilege('service_role', 'analytics.transform_pending_order_lines(uuid,uuid)', 'execute'),
    case when has_function_privilege('anon', 'analytics.transform_pending_order_lines(uuid,uuid)', 'execute') = false
          and has_function_privilege('authenticated', 'analytics.transform_pending_order_lines(uuid,uuid)', 'execute') = false
          and has_function_privilege('service_role', 'analytics.transform_pending_order_lines(uuid,uuid)', 'execute') = true
         then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 14 (T13): ใบผลิตผสม 3 โหมด (fixed+spot+spec) เดียวกัน preview+done
  -- ผ่านครบทุกขั้น (เคสห้ามผ่าน #13)
  -----------------------------------------------------------------------
  v_res := analytics.production_order_save(v_shop, null, 'T13 mixed modes', null);
  v_order_id := (v_res ->> 'id')::uuid;
  perform analytics.production_order_item_set(v_shop, v_order_id, v_p_fixed_ctrl, 2);
  perform analytics.production_order_item_set(v_shop, v_order_id, v_p_spot_ctrl, 3);
  perform analytics.production_order_item_set(v_shop, v_order_id, v_p_no_nre, 1); -- spec, ผลิตซ้ำ (SKU นี้เคยผลิตแล้วใน Part 3)

  v_res := analytics.production_order_preview(v_shop, v_order_id);
  v_log := v_log || format('[T13a] preview ใบผสม 3 โหมด: มี spot_price_thb_per_gram=%s (คาดไม่ null เพราะมี spot/spec ในใบ) items=%s แถว (คาด 3): %s' || E'\n',
    v_res ->> 'spot_price_thb_per_gram', jsonb_array_length(v_res -> 'items'),
    case when v_res ->> 'spot_price_thb_per_gram' is not null and jsonb_array_length(v_res -> 'items') = 3 then 'OK' else 'FAIL' end);

  v_res := analytics.production_order_done(v_shop, v_order_id, null, v_spot_price, null);
  v_log := v_log || format('[T13b] done ใบผสม 3 โหมดสำเร็จ: status=%s items=%s แถว (คาด done/3): %s' || E'\n',
    v_res ->> 'status', jsonb_array_length(v_res -> 'items'),
    case when v_res ->> 'status' = 'done' and jsonb_array_length(v_res -> 'items') = 3 then 'OK' else 'FAIL' end);

  -----------------------------------------------------------------------
  -- Part 15 (T14): view เดียวไม่ซ้ำ + grant ครบ (สรุปซ้ำแบบ static เผื่อ
  -- Part 0 ถูกอ่านข้าม)
  -----------------------------------------------------------------------
  v_log := v_log || format('[T14] v_dim_product นิยามเดียวไม่ซ้ำใน pg_views: %s แถว (คาด 1): %s' || E'\n',
    (select count(*) from pg_views where schemaname = 'analytics' and viewname = 'v_dim_product'),
    case when (select count(*) from pg_views where schemaname = 'analytics' and viewname = 'v_dim_product') = 1 then 'OK' else 'FAIL' end);

  v_log := v_log || E'\n=== ALL CHECKS LOGGED ABOVE — ตรวจทุกบรรทัดหา FAIL (transaction จะ rollback เสมอ) ===\n';
  raise exception '%', v_log;
end $$;
