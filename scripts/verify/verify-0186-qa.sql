-- scripts/verify/verify-0186-qa.sql — ชุดทดสอบเสริมของ QA (R2-D2) สำหรับ migration 0186 (💰 PM-A ใบผลิตเลือกโลหะ)
-- เติมช่องที่ verify-0186.sql ไม่ครอบ: ใบเงินแบบเดิมเดินจนปิด+เข้าสต็อก (เรียก item_set 5 named args เดิม) · override เงินในใบ + ราคาเปลี่ยนระหว่างเปิดหน้า ·
--   ใบทองเต็มวงจร (ราคาสมาคม → รายการทอง 75% → ใบงาน profile ทอง → done ด้วยราคาวันนี้ → lot) · รายการไม่มี SKU → sku_required → ลบ → done ได้ ·
--   ทางตัน (รายการไม่มี SKU + ใบงานที่ยกเลิกแล้ว) · trigger ราคาเงินจากชีตยังเขียน oem_metal_price ได้ภายใต้ CHECK ใหม่ · input แปลกๆ · จอช่างไม่อ้างราคา/น้ำหนักเป้า
-- self-rolling-back: ทุกเคสอยู่ใน sub-block ที่ raise แล้วถอย · จบด้วย raise exception พร้อมรายงาน (exit 1 = ปกติ — อ่าน [FAIL]/[INFO] จาก message)
-- ข้อมูลทดสอบ: ร้านสังเคราะห์ 'ZZ TEST qa-0186' (insert public.shop ตามแพทเทิร์น verify-0144 — ข้อยกเว้นที่ไม่ผ่าน RPC) · อย่างอื่นผ่าน RPC ของระบบ
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0186-qa.sql
-- dry-run ก่อน apply: ต่อ 0186 + ไฟล์นี้ (ไฟล์ LF จาก git blob — ข้อ 20) แล้วรันโดยไม่ใส่ --commit
-- [INFO] = รายงานข้อเท็จจริงที่รู้ ไม่นับเป็นผ่าน/ไม่ผ่าน
-- qa-adhoc.sql (R2-D2) — ต่อท้าย 0186.sql ใน dry-run เดียว · self-rolling-back (ปิดด้วย raise exception) · ข้อมูลผ่าน RPC ของระบบ (ร้านสังเคราะห์ ZZQA ตามแพทเทิร์น verify-0144)
set local statement_timeout = '20min';

create function pg_temp.chk(p_id text, p_desc text, p_ok boolean) returns text language sql as $c$
  select format('[%s] %s  %s', case when coalesce(p_ok, false) then 'OK' else 'FAIL' end, p_id, p_desc) || E'\n' $c$;
create function pg_temp.q(p_sql text) returns jsonb language plpgsql as $c$
declare v jsonb; v_msg text; v_state text; v_hint text;
begin
  execute p_sql into v;
  return coalesce(v, '{}'::jsonb);
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
  return jsonb_build_object('_err', v_msg, '_state', v_state, '_hint', v_hint);
end; $c$;
create function pg_temp.hint(r jsonb) returns text language sql as $c$ select coalesce(r ->> '_state', 'OK') || '|' || coalesce(r ->> '_hint', '') $c$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $c$
declare v_state text; v_hint text;
begin execute p_sql; return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
  return v_state || '|' || coalesce(v_hint, '');
end; $c$;

do $qa$
declare
  v text := E'\n=== QA ad-hoc 0186 (R2-D2) ===\n';
  v_shop uuid := gen_random_uuid();
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_rate_d date := (now() at time zone 'Asia/Bangkok')::date - 1;
  v_act uuid := '00000000-0000-0000-0000-0000000000a1';
  p_spot uuid; p_fix uuid; p_fix2 uuid; p_bar uuid;
  o uuid; o2 uuid; i1 uuid; i2 uuid; i3 uuid;
  r jsonb; r2 jsonb; pv jsonb; dn jsonb; j jsonb;
  v_n int; v_n2 int; v_num numeric; v_exp numeric;
  v_md5a text; v_md5b text; v_gold numeric; v_def text; v_bad text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- ---------- setup ----------
  insert into public.shop (id, name) values (v_shop, 'ZZ TEST qa-0186');
  insert into analytics.oem_cost_rate (shop_id, rate_key, scope, effective_from, value) values
    (v_shop, 'reject_rate_cast_pct', '-', v_rate_d, 0.02), (v_shop, 'reject_rate_polish_pct', '-', v_rate_d, 0.01),
    (v_shop, 'labor_thb_per_day', 'ฉีดเทียน', v_rate_d, 500), (v_shop, 'work_hours_per_day', 'ฉีดเทียน', v_rate_d, 8),
    (v_shop, 'wax_inject_pieces_per_hour', '-', v_rate_d, 20), (v_shop, 'wax_material_thb_per_piece', '-', v_rate_d, 5),
    (v_shop, 'labor_thb_per_day', 'หล่อ', v_rate_d, 600), (v_shop, 'work_hours_per_day', 'หล่อ', v_rate_d, 8),
    (v_shop, 'cut_sprue_minutes_per_piece', '-', v_rate_d, 2),
    (v_shop, 'labor_thb_per_day', 'ขัด', v_rate_d, 550), (v_shop, 'work_hours_per_day', 'ขัด', v_rate_d, 8),
    (v_shop, 'polish_pieces_per_day', 'เรียบ', v_rate_d, 40),
    (v_shop, 'labor_thb_per_day', 'QC', v_rate_d, 500), (v_shop, 'work_hours_per_day', 'QC', v_rate_d, 8),
    (v_shop, 'qc_pieces_per_day', '-', v_rate_d, 100), (v_shop, 'pack_cost_thb_per_piece', '-', v_rate_d, 5),
    (v_shop, 'flask_capacity_pieces', 'แหวน', v_rate_d, 20), (v_shop, 'flask_cost_thb', '-', v_rate_d, 150),
    (v_shop, 'sprue_loss_pct', 'silver', v_rate_d, 0.05), (v_shop, 'recovery_rate_pct', 'silver', v_rate_d, 0.9),
    (v_shop, 'polish_loss_pct', 'silver', v_rate_d, 0.02),
    (v_shop, 'cad_fee_thb', '-', v_rate_d, 2000), (v_shop, 'print3d_cost_thb', '-', v_rate_d, 150), (v_shop, 'rubber_mold_cost_thb', '-', v_rate_d, 300),
    (v_shop, 'sprue_loss_pct', 'gold', v_rate_d, 0.05), (v_shop, 'recovery_rate_pct', 'gold', v_rate_d, 0.95), (v_shop, 'polish_loss_pct', 'gold', v_rate_d, 0.02),
    (v_shop, 'gold_alloy_cost_thb_per_piece', '-', v_rate_d, 40);
  p_spot := analytics.product_upsert(v_shop, 'QA-SPOT', 'spot 10g .925', null, 'spot', null, 10, 0.925, 20, 300, null, null, null, true);
  p_fix  := analytics.product_upsert(v_shop, 'QA-FIX',  'fixed 88',      null, 'fixed', 88, null, null, null, 150, null, null, null, true);
  p_fix2 := analytics.product_upsert(v_shop, 'QA-FIX2', 'fixed 50',      null, 'fixed', 50, null, null, null, null, null, null, null, true);
  p_bar  := analytics.product_upsert(v_shop, 'QA-BAR',  'spot แท่ง .999', null, 'spot', null, 152.44, 0.999, null, null, null, null, null, true);
  perform analytics.oem_metal_price_set(v_shop, 'silver', 72, v_today, 'manual');
  perform analytics.job_stage_def_ensure(v_shop);
  perform analytics.job_record_profile_ensure(v_shop);

  -- ============ QA-1 ใบเงินแบบเดิมเดินจนปิด + เข้าสต็อก (เรียก item_set ด้วย 5 named args เดิมเป๊ะ) ============
  begin
    r := pg_temp.q(format('select analytics.production_order_save(%L, null, %L, null)', v_shop, 'qa1'));
    o := (r ->> 'id')::uuid;
    i1 := (pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>%L, p_qty_planned=>10, p_is_new_design=>null)', v_shop, o, p_spot)) ->> 'id')::uuid;
    i2 := (pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>%L, p_qty_planned=>4, p_is_new_design=>null)', v_shop, o, p_fix)) ->> 'id')::uuid;
    v := v || pg_temp.chk('Q1a', 'item_set 5 arg เดิม: แถว spot = silver/0.925/10.000 (product) · แถว fixed = silver/0.925/ไม่มีน้ำหนัก',
      exists (select 1 from analytics.production_order_item x where x.id = i1 and x.metal = 'silver' and x.purity = 0.925 and x.weight_g = 10 and x.weight_source = 'product')
      and exists (select 1 from analytics.production_order_item x where x.id = i2 and x.metal = 'silver' and x.purity = 0.925 and x.weight_g is null and x.weight_source is null));
    pv := pg_temp.q(format('select analytics.production_order_preview(%L, %L, null)', v_shop, o));
    v_exp := round(10 * 72 * 0.925 + 20, 2);
    v := v || pg_temp.chk('Q1b', format('preview: spot_price=72 · metal_prices={silver:72} · missing=[] · unit_cost spot=%s fixed=88', v_exp),
      (pv ->> 'spot_price_thb_per_gram')::numeric = 72 and pv -> 'metal_prices' = '{"silver": 72}'::jsonb and pv -> 'missing_prices' = '[]'::jsonb
      and (jsonb_path_query_first(pv, '$.items[*] ? (@.sku == "QA-SPOT")') ->> 'unit_cost')::numeric = v_exp
      and (jsonb_path_query_first(pv, '$.items[*] ? (@.sku == "QA-FIX")') ->> 'unit_cost')::numeric = 88);
    -- ผู้ใช้เก่าส่งตัวเลขเปล่า (รูปเดิมก่อน 0186) ต้องถูกปฏิเสธ ไม่ใช่ข้าม M1 เงียบๆ · ไม่ส่งเลยก็ต้องตก
    v := v || pg_temp.chk('Q1c', 'ส่ง p_expected เป็นตัวเลขเปล่า 72 (รูปเดิม) → ปฏิเสธ 22023 expected_prices_invalid · ไม่ส่ง (null) ใบที่ใช้ราคา → expected_prices_required · ส่ง {} → expected_prices_required',
      pg_temp.hint(pg_temp.q(format('select analytics.production_order_done(%L, %L, null, to_jsonb(72::numeric), null)', v_shop, o))) = '22023|expected_prices_invalid'
      and pg_temp.hint(pg_temp.q(format('select analytics.production_order_done(%L, %L, null, null, null)', v_shop, o))) = '22023|expected_prices_required'
      and pg_temp.hint(pg_temp.q(format('select analytics.production_order_done(%L, %L, null, %L::jsonb, null)', v_shop, o, '{}'))) = '22023|expected_prices_required');
    select count(*) into v_n from analytics.stock_lot where production_order_item_id in (i1, i2);
    v := v || pg_temp.chk('Q1d', 'ปฏิเสธทั้ง 3 ครั้งแล้ว stock/lot ไม่ขยับ (lot=0 · ใบยัง open)', v_n = 0 and (select status from analytics.production_order where id = o) = 'open');
    dn := pg_temp.q(format('select analytics.production_order_done(%L, %L, null, %L::jsonb, null)', v_shop, o, '{"silver": 72}'));
    v := v || pg_temp.chk('Q1e', 'done {silver:72}: status=done · already_done=false · ' || coalesce(dn ->> '_err', 'ok'), dn ->> 'status' = 'done' and dn ->> 'already_done' = 'false');
    v := v || pg_temp.chk('Q1f', format('lot ต้นทุน spot=%s fixed=88 · qty_in 10/4 · stock on_hand 10/4 · ledger key po:<item> ครบ 2', v_exp),
      (select unit_cost from analytics.stock_lot where production_order_item_id = i1) = v_exp
      and (select unit_cost from analytics.stock_lot where production_order_item_id = i2) = 88
      and (select qty_on_hand from public.central_stock where product_id = p_spot) = 10 and (select qty_on_hand from public.central_stock where product_id = p_fix) = 4
      and (select count(*) from public.stock_ledger where idempotency_key like 'po:' || i1 || ':%' or idempotency_key like 'po:' || i2 || ':%') = 2);
    v := v || pg_temp.chk('Q1g', 'item stamp: metal=silver purity .925 · cost_type/unit_cost เดิม (prev_cost_type) · qty_done',
      exists (select 1 from analytics.production_order_item x where x.id = i1 and x.metal = 'silver' and x.purity = 0.925 and x.weight_g = 10 and x.unit_cost = v_exp and x.qty_done = 10 and x.prev_cost_type = 'spot')
      and exists (select 1 from analytics.production_order_item x where x.id = i2 and x.metal = 'silver' and x.unit_cost = 88 and x.qty_done = 4 and x.prev_cost_type = 'fixed'));
    dn := pg_temp.q(format('select analytics.production_order_done(%L, %L, null, %L::jsonb, null)', v_shop, o, '{"silver": 72}'));
    select count(*) into v_n from public.stock_ledger where idempotency_key like 'po:' || i1 || ':%' or idempotency_key like 'po:' || i2 || ':%';
    select count(*) into v_n2 from analytics.stock_lot where production_order_item_id in (i1, i2);
    v := v || pg_temp.chk('Q1h', 'กด done ซ้ำ: already_done=true · ledger ยัง 2 · lot ยัง 2 (ไม่เข้าสต็อกซ้ำ)', dn ->> 'already_done' = 'true' and v_n = 2 and v_n2 = 2);
    v := v || pg_temp.chk('Q1i', 'catalog_audit_log 2 แถว (edit) · product.cost_type/unit_cost ของ SKU ไม่ถูกเขียนกลับ (D1)',
      (select count(*) from analytics.catalog_audit_log where shop_id = v_shop and product_id in (p_spot, p_fix)) >= 2
      and (select cost_type from public.product where id = p_spot) = 'spot' and (select unit_cost from public.product where id = p_fix) = 88);
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q1-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- ============ QA-2 override เงินในใบ (legacy) + ราคาเปลี่ยนระหว่างเปิดหน้า ============
  begin
    r := pg_temp.q(format('select analytics.production_order_save(%L, null, %L, 80)', v_shop, 'qa2'));
    o := (r ->> 'id')::uuid;
    i1 := (pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>%L, p_qty_planned=>3, p_is_new_design=>null)', v_shop, o, p_spot)) ->> 'id')::uuid;
    pv := pg_temp.q(format('select analytics.production_order_preview(%L, %L, null)', v_shop, o));
    v := v || pg_temp.chk('Q2a', 'preview ใช้ override 80 (ไม่ใช่ราคาวันนี้ 72): spot_price=80 · metal_prices={silver:80}', (pv ->> 'spot_price_thb_per_gram')::numeric = 80 and pv -> 'metal_prices' = '{"silver": 80}'::jsonb);
    v := v || pg_temp.chk('Q2b', 'done ส่ง {silver:72} (ราคาตลาด ไม่ใช่ override ที่หน้าจอเห็น) → metal_price_changed',
      pg_temp.hint(pg_temp.q(format('select analytics.production_order_done(%L, %L, null, %L::jsonb, null)', v_shop, o, '{"silver": 72}'))) = '22023|metal_price_changed');
    v := v || pg_temp.chk('Q2c', 'done ส่ง {silver:80.0001} ผ่าน (ขอบ ±0.0001) · 80.0002 ตก',
      pg_temp.hint(pg_temp.q(format('select analytics.production_order_done(%L, %L, null, %L::jsonb, null)', v_shop, o, '{"silver": 80.0002}'))) = '22023|metal_price_changed');
    dn := pg_temp.q(format('select analytics.production_order_done(%L, %L, null, %L::jsonb, null)', v_shop, o, '{"silver": 80.0001}'));
    v := v || pg_temp.chk('Q2d', format('done ผ่านที่ 80.0001 · unit_cost=round(10×80×.925+20)=%s (ใช้ราคา resolve ของ DB ไม่ใช่ที่ client ส่ง)', round(10 * 80 * 0.925 + 20, 2)),
      dn ->> 'status' = 'done' and (select unit_cost from analytics.stock_lot where production_order_item_id = i1) = round(10 * 80 * 0.925 + 20, 2));
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q2-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- ============ QA-3 ใบทองเต็มวงจร ============
  begin
    -- 3.1 ตั้งราคาสมาคม 41,250 บาทละ → server คืน 2804.1271
    r := pg_temp.q(format('select analytics.oem_metal_price_set_input(%L, %L, 41250, %L)', v_shop, 'gold', 'assoc965_sell_per_baht'));
    v_gold := (r ->> 'price_thb_per_gram')::numeric;
    v := v || pg_temp.chk('Q3a', 'ตั้งราคาสมาคม 41,250 → ' || coalesce(v_gold::text, r ->> '_err') || ' บาท/กรัม · as_of=วันนี้ไทย · เก็บ input_value/unit',
      v_gold = round(41250 / (15.244 * 0.965), 4) and (r ->> 'as_of_date')::date = v_today
      and exists (select 1 from analytics.oem_metal_price m where m.shop_id = v_shop and m.metal = 'gold' and m.as_of_date = v_today and m.input_value = 41250 and m.input_unit = 'assoc965_sell_per_baht' and m.price_thb_per_gram = v_gold));
    -- 3.2 รายการทอง 75% 3.2 กรัม บน SKU spot (ต้นทุนตามโลหะ)
    r := pg_temp.q(format('select analytics.production_order_save(%L, null, %L, null)', v_shop, 'qa3'));
    o := (r ->> 'id')::uuid;
    r := pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>%L, p_qty_planned=>12, p_metal=>%L, p_purity=>0.75, p_weight_g=>3.2, p_weight_source=>%L)', v_shop, o, p_spot, 'gold', 'input'));
    i1 := (r ->> 'id')::uuid;
    v := v || pg_temp.chk('Q3b', 'item_set ทอง 75% 3.2g (source input) บน SKU เงิน: เก็บ gold/0.75/3.2/input · ' || coalesce(r ->> '_err', 'ok'),
      exists (select 1 from analytics.production_order_item x where x.id = i1 and x.metal = 'gold' and x.purity = 0.75 and x.weight_g = 3.2 and x.weight_source = 'input'));
    -- 3.3 ใบงาน profile ทอง
    j := pg_temp.q(format('select analytics.job_create_from_production_item(p_shop_id=>%L, p_production_order_item_id=>%L, p_stage_codes=>%L::text[], p_actor=>%L, p_profile_id=>null)', v_shop, i1, '{wax_inject,wax_tree,invest_burnout,cast,cut_sprue,finish,buff,qc,pack}', v_act));
    v := v || pg_temp.chk('Q3c', 'ใบงานจากรายการทอง: job.metal=gold · แบบ ทอง% · target_piece_g 3.2 · ' || coalesce(j ->> 'profile_name', j ->> '_err'),
      j ->> 'metal' = 'gold' and (j ->> 'profile_name') like 'ทอง%'
      and exists (select 1 from analytics.job x where x.id = (j ->> 'job_id')::uuid and x.metal = 'gold' and x.target_piece_g = 3.2 and x.require_final_weight));
    -- 3.4 preview/done
    pv := pg_temp.q(format('select analytics.production_order_preview(%L, %L, null)', v_shop, o));
    v_exp := round(3.2 * v_gold * 0.75 + 20, 2);
    v := v || pg_temp.chk('Q3d', format('preview: metal_prices={gold:%s} · spot_price=null (ไม่มีเงิน) · unit_cost=round(3.2×ราคา×0.75+ค่าแรง)=%s', v_gold, v_exp),
      (pv -> 'metal_prices' ->> 'gold')::numeric = v_gold and pv -> 'spot_price_thb_per_gram' = 'null'::jsonb
      and (jsonb_path_query_first(pv, '$.items[*] ? (@.sku == "QA-SPOT")') ->> 'unit_cost')::numeric = v_exp);
    v := v || pg_temp.chk('Q3e', 'done ส่งราคาทองผิด +500 → metal_price_changed · ส่ง {silver:72} (ผิดโลหะ) → expected_prices_required (ไม่มี key gold) · ส่ง gold+silver (เกิน) → expected_prices_extra',
      pg_temp.hint(pg_temp.q(format('select analytics.production_order_done(%L, %L, null, %L::jsonb, null)', v_shop, o, jsonb_build_object('gold', v_gold + 500)))) = '22023|metal_price_changed'
      and pg_temp.hint(pg_temp.q(format('select analytics.production_order_done(%L, %L, null, %L::jsonb, null)', v_shop, o, '{"silver": 72}'))) = '22023|expected_prices_required'
      and pg_temp.hint(pg_temp.q(format('select analytics.production_order_done(%L, %L, null, %L::jsonb, null)', v_shop, o, jsonb_build_object('gold', v_gold, 'silver', 72)))) = '22023|expected_prices_extra');
    dn := pg_temp.q(format('select analytics.production_order_done(%L, %L, null, %L::jsonb, null)', v_shop, o, jsonb_build_object('gold', v_gold)));
    v := v || pg_temp.chk('Q3f', 'done ด้วยราคาทองวันนี้ (ใบที่ยังมีใบงานเปิดอยู่) · ' || coalesce(dn ->> '_err', coalesce(dn ->> 'status', '?')), dn ->> 'status' = 'done');
    if dn ->> 'status' = 'done' then
      v := v || pg_temp.chk('Q3g', format('lot ต้นทุน=%s qty 12 · item stamp gold/.75/3.2/input · metal_prices ใน response = {gold}', v_exp),
        (select unit_cost from analytics.stock_lot where production_order_item_id = i1) = v_exp
        and (select qty_in from analytics.stock_lot where production_order_item_id = i1) = 12
        and exists (select 1 from analytics.production_order_item x where x.id = i1 and x.metal = 'gold' and x.purity = 0.75 and x.weight_g = 3.2 and x.weight_source = 'input')
        and dn -> 'metal_prices' = jsonb_build_object('gold', v_gold));
    end if;
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q3-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- ============ QA-4 รายการไม่มี SKU → done ติด sku_required → ลบรายการ → done ได้ ============
  begin
    r := pg_temp.q(format('select analytics.production_order_save(%L, null, %L, null)', v_shop, 'qa4'));
    o := (r ->> 'id')::uuid;
    i1 := (pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>%L, p_qty_planned=>5)', v_shop, o, p_fix)) ->> 'id')::uuid;
    r := pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>null, p_qty_planned=>2, p_pending_product_label=>%L, p_metal=>%L)', v_shop, o, 'ลายใบไม้ 🌿 QA', 'silver'));
    i2 := (r ->> 'id')::uuid;
    v := v || pg_temp.chk('Q4a', 'เพิ่มรายการไม่มี SKU ชื่อไทย+อีโมจิ ได้ · ' || coalesce(r ->> '_err', 'ok'), i2 is not null and (r ->> 'pending_product_label') = 'ลายใบไม้ 🌿 QA');
    v := v || pg_temp.chk('Q4b', 'preview ตก sku_required · done ตก sku_required · stock/lot ไม่ขยับ',
      pg_temp.hint(pg_temp.q(format('select analytics.production_order_preview(%L, %L, null)', v_shop, o))) = '22023|sku_required'
      and pg_temp.hint(pg_temp.q(format('select analytics.production_order_done(%L, %L, null, %L::jsonb, null)', v_shop, o, '{}'))) = '22023|sku_required'
      and (select count(*) from analytics.stock_lot where production_order_item_id in (i1, i2)) = 0
      and coalesce((select qty_on_hand from public.central_stock where product_id = p_fix), 0) = 0);
    v := v || pg_temp.chk('Q4c', 'ลบรายการไม่มี SKU ด้วย id → ผ่าน · ลบซ้ำ → item_not_found',
      pg_temp.err(format('select analytics.production_order_item_remove_by_id(%L, %L, %L)', v_shop, o, i2)) = 'OK'
      and pg_temp.err(format('select analytics.production_order_item_remove_by_id(%L, %L, %L)', v_shop, o, i2)) = '22023|item_not_found');
    dn := pg_temp.q(format('select analytics.production_order_done(%L, %L, null, %L::jsonb, null)', v_shop, o, '{}'));
    v := v || pg_temp.chk('Q4d', 'หลังลบ done ได้ (ใบ fixed ล้วน ส่ง {}) · lot 5 ชิ้นต้นทุน 88 · ' || coalesce(dn ->> '_err', coalesce(dn ->> 'status', '?')),
      dn ->> 'status' = 'done' and (select unit_cost from analytics.stock_lot where production_order_item_id = i1) = 88);
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q4-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- ============ QA-5 ทางตัน: รายการไม่มี SKU + ใบงาน (ยกเลิกแล้ว) ============
  begin
    r := pg_temp.q(format('select analytics.production_order_save(%L, null, %L, null)', v_shop, 'qa5'));
    o := (r ->> 'id')::uuid;
    i1 := (pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>%L, p_qty_planned=>5)', v_shop, o, p_fix)) ->> 'id')::uuid;
    i2 := (pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>null, p_qty_planned=>2, p_pending_product_label=>%L, p_metal=>%L)', v_shop, o, 'งานใหม่ QA5', 'silver')) ->> 'id')::uuid;
    j := pg_temp.q(format('select analytics.job_create_from_production_item(p_shop_id=>%L, p_production_order_item_id=>%L, p_stage_codes=>%L::text[], p_actor=>%L, p_profile_id=>null)', v_shop, i2, '{wax_inject,wax_tree,invest_burnout,cast,cut_sprue,finish,buff,qc,pack}', v_act));
    v := v || pg_temp.chk('Q5a', 'สร้างใบงานจากรายการไม่มี SKU ได้ · ' || coalesce(j ->> '_err', coalesce(j ->> 'job_no', '?')), (j ->> 'job_id') is not null);
    r := pg_temp.q(format('select analytics.production_order_item_remove_by_id(%L, %L, %L)', v_shop, o, i2));
    raise notice 'Q5b remove (มีใบงานเปิด) = %', pg_temp.hint(r);
    v := v || pg_temp.chk('Q5b', 'ลบรายการที่มีใบงานเปิดอยู่ ตก job_exists (ตั้งใจ)', pg_temp.hint(r) = '22023|job_exists');
    r2 := pg_temp.q(format('select analytics.job_cancel(%L, %L, %L, %L)', v_shop, (j ->> 'job_id')::uuid, 'qa5 ยกเลิก', v_act));
    v := v || pg_temp.chk('Q5c', 'ยกเลิกใบงานได้ · ' || coalesce(r2 ->> '_err', 'ok'), r2 ->> '_err' is null);
    r := pg_temp.q(format('select analytics.production_order_item_remove_by_id(%L, %L, %L)', v_shop, o, i2));
    v := v || pg_temp.chk('Q5d', '[ข้อจำกัดที่รู้ — ล็อกพฤติกรรมปัจจุบัน] รายการไม่มี SKU ที่เคยมีใบงาน (แม้ยกเลิกแล้ว) ลบไม่ได้ (job_exists) · ยังไม่มี RPC ผูก SKU (W1) ⇒ ใบผลิตนั้นปิดไม่ได้ ต้องยกเลิกทั้งใบ · ได้ ' || pg_temp.hint(r), pg_temp.hint(r) = '22023|job_exists');
    v := v || pg_temp.chk('Q5e', 'ใบผลิตที่ค้างรายการไม่มี SKU ยกเลิกทั้งใบได้ (ทางออกเดียว)', pg_temp.err(format('select analytics.production_order_cancel(%L, %L, %L)', v_shop, o, 'qa5 ยกเลิกทั้งใบ')) = 'OK');
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q5-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- ============ QA-6 ผู้เขียนราคาโลหะเดิม (sheet/shop_setting) ยังทำงานภายใต้ CHECK ใหม่ ============
  begin
    v_n := (select count(*) from analytics.oem_metal_price where metal = 'silver' and (input_value is not null or input_unit is not null));
    -- trigger ราคาเงินจากชีต (AFTER INSERT on silver_price_history) — ยิงผ่านการ insert จริงของร้านสังเคราะห์ (ย้อนหลัง 3 วัน ไม่ชน manual วันนี้)
    r := pg_temp.q(format('insert into analytics.silver_price_history (shop_id, captured_at, sheet_row_hash, kilo_sell) values (%L, now() - interval ''3 days'', %L, 63000) returning to_jsonb(silver_price_history)', v_shop, 'qa0186'));
    v := v || pg_temp.chk('Q6a', 'trigger sheet→oem_metal_price (silver_price_history insert) รันได้ภายใต้ CHECK ใหม่ · ' || coalesce(r ->> '_err', 'ok'), r ->> '_err' is null
      and exists (select 1 from analytics.oem_metal_price m where m.shop_id = v_shop and m.metal = 'silver' and m.source = 'sheet' and m.price_thb_per_gram = 63 and m.input_value is null and m.input_unit is null));
    r := pg_temp.q(format('select to_jsonb(analytics.shop_setting_upsert(%L, 70, null, null))', v_shop));
    v := v || pg_temp.chk('Q6b', 'shop_setting_upsert (เขียน oem_metal_price เงิน) รันได้ · ' || coalesce(r ->> '_err', left(r::text, 80)), r ->> '_err' is null);
    v := v || pg_temp.chk('Q6c', 'แถวเงินทุกแถวไม่มี input_value/input_unit (ค่าใหม่เฉพาะทอง/ทองเหลือง)', (select count(*) from analytics.oem_metal_price where metal = 'silver' and (input_value is not null or input_unit is not null)) = 0);
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q6-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- ============ QA-7 ป้อนค่าแปลกๆ (input pollution) ที่ verify ไม่ได้ครอบ ============
  begin
    r := pg_temp.q(format('select analytics.production_order_save(%L, null, %L, null)', v_shop, 'qa7'));
    o := (r ->> 'id')::uuid;
    r := pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>null, p_qty_planned=>1, p_pending_product_label=>%L, p_metal=>%L)', v_shop, o, '🌿🌿', 'silver'));
    v := v || pg_temp.chk('Q7a', 'ชื่อแบบเป็นอีโมจิล้วน ถูกปฏิเสธด้วย 22023 (ข้อความไทยที่ผู้ใช้อ่านได้ ไม่ใช่ 23514 ดิบ) · ได้ ' || pg_temp.hint(r) || ' ' || coalesce(left(r ->> '_err', 80), ''), pg_temp.hint(r) like '22023|%');
    r := pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>null, p_qty_planned=>1, p_pending_product_label=>%L, p_metal=>%L)', v_shop, o, repeat('ก', 201), 'silver'));
    v := v || pg_temp.chk('Q7b', 'ชื่อแบบ 201 ตัว → ปฏิเสธ 22023 (ไม่ใช่ error ดิบ) · ได้ ' || pg_temp.hint(r), pg_temp.hint(r) like '22023|%');
    r := pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>null, p_qty_planned=>1, p_pending_product_label=>%L, p_metal=>%L)', v_shop, o, 'Abc', 'silver'));
    r2 := pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>null, p_qty_planned=>9, p_pending_product_label=>%L, p_metal=>%L)', v_shop, o, 'aBC', 'silver'));
    v := v || pg_temp.chk('Q7c', 'ชื่อซ้ำต่างตัวพิมพ์ (Abc/aBC) = รายการเดียวกัน (แก้ qty เป็น 9 ไม่สร้างซ้ำ)', (r ->> 'id') = (r2 ->> 'id') and (r2 ->> 'qty_planned')::int = 9);
    v := v || pg_temp.chk('Q7d', 'qty 0 / -1 / 100001 / NaN ตก (ทุกกรณีเป็น 22023 หรือ cast error ก่อนถึง DB)',
      pg_temp.hint(pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>%L, p_qty_planned=>0)', v_shop, o, p_fix))) like '22023|%'
      and pg_temp.hint(pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>%L, p_qty_planned=>-1)', v_shop, o, p_fix))) like '22023|%'
      and pg_temp.hint(pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>%L, p_qty_planned=>100001)', v_shop, o, p_fix))) like '22023|%');
    -- เปลี่ยนโลหะเงิน→ทอง บน item เดิมโดยไม่ส่งเนื้อ = ปฏิเสธ (ไม่เก็บทองเนื้อ 0.925 ที่ค้างจากเงิน)
    r := pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>%L, p_qty_planned=>3)', v_shop, o, p_spot));
    r2 := pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>%L, p_qty_planned=>3, p_metal=>%L)', v_shop, o, p_spot, 'gold'));
    v := v || pg_temp.chk('Q7e', 'เปลี่ยน silver→gold โดยไม่ส่งเนื้อ ตก gold_purity_required (เนื้อเงิน 0.925 ไม่ติดไปเป็นเนื้อทอง) · แถวเดิมไม่ถูกแก้', pg_temp.hint(r2) = '22023|gold_purity_required'
      and exists (select 1 from analytics.production_order_item x where x.id = (r ->> 'id')::uuid and x.metal = 'silver' and x.purity = 0.925));
    r2 := pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>%L, p_qty_planned=>3, p_metal=>%L, p_purity=>0.75)', v_shop, o, p_spot, 'gold'));
    v := v || pg_temp.chk('Q7f', 'เปลี่ยน silver→gold พร้อมเนื้อ 0.75: น้ำหนักที่ลอกมาจาก SKU (10g · product) ถูกล้าง (ห้ามกลายเป็นน้ำหนักทอง)', (r2 ->> 'weight_g') is null and (r2 ->> 'metal') = 'gold');
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q7-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- ============ QA-8 จอช่าง: ฟังก์ชัน job_worker_* ไม่อ้างราคา/ต้นทุน/น้ำหนักเป้าทอง ============
  begin
    select string_agg(p.oid::regprocedure::text, ', ') into v_bad
      from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname like 'job_worker%'
       and pg_get_functiondef(p.oid) ~* '(target_piece_g|unit_cost|cost_calc|oem_metal_price|price_thb|production_metal_price)';
    v := v || pg_temp.chk('Q8a', 'ไม่มี job_worker_* ที่อ้าง target_piece_g/unit_cost/cost_calc/ราคาโลหะ ' || coalesce(v_bad, ''), v_bad is null);
    select string_agg(c.relname, ', ') into v_bad from pg_class c
      where c.relnamespace = 'analytics'::regnamespace and c.relkind = 'v' and c.relname like 'v_worker%'
        and pg_get_viewdef(c.oid) ~* '(target_piece_g|unit_cost|cost_calc|price_thb)';
    v := v || pg_temp.chk('Q8b', 'ไม่มีวิวฝั่งช่าง (v_worker*) ที่อ้างฟิลด์ราคา/ต้นทุน/น้ำหนักเป้า ' || coalesce(v_bad, ''), v_bad is null);
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q8-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;


  -- ============ QA-9 [INFO] SKU ในแคตตาล็อกที่อยู่นอก CHECK ของรายการ (ข้อมูลจริงวันนี้ไม่มี — 0/293 SKU) ============
  begin
    declare p1 uuid; p2 uuid; p3 uuid; o9 uuid; r9 jsonb;
    begin
      p1 := analytics.product_upsert(v_shop, 'QA9-W15000', 'w15000', null, 'spot', null, 15000, 0.925, 20, 300, null, null, null, true);
      p2 := analytics.product_upsert(v_shop, 'QA9-P030', 'p030', null, 'spot', null, 10, 0.30, 20, 300, null, null, null, true);
      p3 := analytics.product_upsert(v_shop, 'QA9-W3DEC', 'w3dec', null, 'spot', null, 10.12345, 0.925, 20, 300, null, null, null, true);
      o9 := (analytics.production_order_save(v_shop, null, 'qa9', null) ->> 'id')::uuid;
      r9 := pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>%L, p_qty_planned=>1)', v_shop, o9, p1));
      v := v || format('[INFO] Q9a  SKU น้ำหนัก 15,000 g (catalog รับ) → item_set = %s (คาด 23514 ดิบจาก weight_ck แทนข้อความไทย)', pg_temp.hint(r9)) || E'
';
      r9 := pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>%L, p_qty_planned=>1)', v_shop, o9, p2));
      v := v || format('[INFO] Q9b  SKU เนื้อ 0.30 (catalog รับ) → item_set = %s (คาด 23514 ดิบจาก purity_ck)', pg_temp.hint(r9)) || E'
';
      r9 := pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>%L, p_qty_planned=>1)', v_shop, o9, p3));
      v := v || format('[INFO] Q9c  SKU น้ำหนัก 10.12345 g → item เก็บ weight_g = %s (ปัด 3 ตำแหน่งเงียบๆ · ต้นทุน spot ต่างจากสูตรเดิมที่ใช้ค่าเต็ม)', r9 ->> 'weight_g') || E'
';
      raise exception 'rb_qa';
    exception when others then
      if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q9-crash', sqlstate || ' ' || sqlerrm, false); end if;
    end;
  end;

  v := v || format('--- สรุป: OK %s · FAIL %s ---',
    (length(v) - length(replace(v, '[OK]', ''))) / 4, (length(v) - length(replace(v, '[FAIL]', ''))) / 6);
  raise exception '%', v;
end $qa$;
