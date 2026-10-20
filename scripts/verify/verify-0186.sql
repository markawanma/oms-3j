-- scripts/verify/verify-0186.sql
-- ตรวจ supabase/migrations/0186_production_item_metal.sql (PM-A: รายการในใบผลิตเลือกโลหะ/เนื้อ/น้ำหนัก + รายการไม่มี SKU + ราคาทอง/ทองเหลืองต่อโลหะ · 💰)
-- self-rolling-back (3j-migration-traps ข้อ 11): ทุกเคสอยู่ในทรานแซกชันเดียว จบด้วย `raise exception` เสมอ ⇒ ถอยทั้งก้อน · อ่านผลจาก error message · exit 1 คือผลที่คาด ·
--   [FAIL] >= 1 = ไม่ผ่าน · [SKIP] ไม่นับเป็นผ่าน (บอกเหตุผล)
-- ข้อมูลทดสอบ: ร้านสังเคราะห์ ZZ186 (insert public.shop + oem_cost_rate ตามแพทเทิร์น verify-0144 — ข้อยกเว้นที่ไม่ผ่าน RPC · บอกตรงๆ) · SKU/ใบผลิต/รายการ/ราคาโลหะ/ใบงานสร้างผ่าน RPC ของระบบ ·
--   ข้อยกเว้นอื่นที่บอกตรงๆ: ลบแถวราคาทองของวันนี้/ปิดแบบทองด้วย DELETE/UPDATE ตรงใน sub-block ที่ถอยกลับ (จัดสถานะ "ไม่มีราคาวันนี้"/"ไม่มีแบบทอง") · ส่วน R อ่าน (ไม่เขียน) ข้อมูลจริงของร้านจริง ·
--   golden replay "ใบผลิต open จริงทุกใบ เดิม vs ใหม่" ฝังอยู่ใน migration §16 (ล้ม = ไม่ apply) — ไม่ซ้ำที่นี่ (ฟังก์ชันเดิมถูก drop ท้าย migration แล้ว)
-- 🔴 ไม่แตะตัวนับเอกสารภาษี (ไม่มีใบเสร็จ/ใบกำกับ) · ตัวนับใบผลิต/ใบงานที่เดินจากการทดสอบถอยกลับพร้อมทรานแซกชัน (ตรวจใน R3 ว่าของจริงไม่ขยับ)
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0186.sql
-- dry-run ก่อน apply: ต่อไฟล์ migration + ไฟล์นี้ (ไฟล์ LF — จาก git blob ไม่ใช่ working tree CRLF: ข้อ 20) แล้วรันไม่ใส่ --commit
--
-- ============ ตารางแมป "ข้อในบรีฟ 20 ต.ค. -> เทสต์ที่ครอบ" ============
--  ✅ ช่วงราคา sanity ทอง 100% 2,000–8,000 บาท/กรัม · ขอบ 4 จุด (2000/8000 ผ่าน · 1999.99/8000.01 ตก)       -> G1a-G1h (RPC ต่อกรัม) · G9a (CHECK ตาราง ตรงไม่ผ่าน RPC)
--  ✅ ช่วงทองเหลือง 100–1,000 บาท/กก. (DB 0.10–1.00 บาท/กรัม) ขอบ 4 จุด                                    -> G2a-G2e (ต่อกรัม: 0.10/1.00 ผ่าน · 0.0999/1.0001 ตก) · G4a-G4d (บาท/กก.: 100/1000 ผ่าน · 99.99/1000.01 ตก)
--  ✅ ราคาสมาคมขายออก ÷15.244 ÷0.965 + server คืนค่าที่เก็บ + input_value/input_unit (R4)                      -> G3a-G3k (ขอบ 2 ฝั่ง + 41,250 ฯลฯ — เวกเตอร์เดียวกับ lib/oem/metal-price.test.ts) · G6
--  ✅ ทองเหลือง บาท/กก. ÷1,000 · เนื้อล็อก 100                                                              -> G4 · I5a-I5c
--  ✅ นอกช่วง = ปฏิเสธ (RPC ต่อกรัม · RPC กรอกหน่วยหน้างาน · CHECK ตาราง) · NaN/0/ลบ/ทศนิยมเกิน/หน่วยไม่ตรงโลหะ    -> G1 G2 G3 G4 G5 G9
--  ✅ purity <0.375 / >1 / NaN / Infinity · weight ≤0 / >10000 / NaN · metal นอก 3 ค่า · source นอกชุด/คู่ขาด      -> I1a-I1f · I2a-I2h · I3a-I3e
--  ✅ ทองไม่มี purity (ตอน set และตอน done/preview ผ่าน helper)                                             -> I4a-I4d · F2c
--  ✅ ไม่มีทั้ง SKU และชื่อ · มีทั้งคู่ · ชื่อซ้ำในใบเดียว (ไม่สร้างซ้ำ) · ชื่อ < > / ว่าง / ล่องหน / ยาว        -> I6a-I6j · I8a-I8e
--  ✅ done/preview ใบที่มี item ไม่มี SKU -> sku_required (ก่อนเข้าเส้นต้นทุน · สต็อกไม่ขยับ)                  -> D1a-D1e
--  ✅ ปิดใบทองวันที่ไม่มีราคา -> raise ไม่ fallback (มีแถว 25 ส.ค. เก่าอยู่) · preview คืน missing_prices (R3)      -> D2a-D2g
--  ✅ M1 ต่อโลหะ: key ขาด/ราคาต่าง/key เกิน/ไม่ใช่ object/ค่าไม่ใช่ number · ใบ fixed ล้วน {} หรือ null ผ่าน       -> D3a-D3i · D5a-D5c
--  ✅ spot_override ของใบใช้กับเงินเท่านั้น (ใบผสมเงิน+ทอง) · override ทองส่งไม่ได้                          -> D4a-D4c · G10c
--  ✅ ต้นทุนถูก: spot ทอง/ทองเหลือง = weight×price×purity+labor · spec ทอง = oem_cost_calc อิสระ · rate ทองว่าง = ไม่ครบ -> D6a-D6e · D7a-D7c
--  ✅ weight ว่างใน spot/spec -> ปฏิเสธ (ด่านเดิมย้ายที่) · fixed ไม่ต้องมีน้ำหนัก (ต้องไม่พัง)                 -> D8a-D8c
--  ✅ ทองไม่มีแบบทอง -> no_gold_profile (ไม่ fallback เงียบ) · ใบเงินยังได้แบบ default                         -> J3a-J3d
--  ✅ ใบงานจากรายการทอง/ไม่มี SKU: job.metal จากรายการ · target_piece_g/source · แบบทอง · design_label = ชื่อแบบ  -> J1a-J1f · J2a-J2d
--  ✅ N1 น้ำหนักงานทองไม่โชว์ช่าง: ไม่มีฟังก์ชัน job_worker_* อ้าง target_piece_g                              -> J4a
--  ✅ product ไม่ถูกเขียนกลับ (md5 คอลัมน์ catalog + จำนวนแถว · ชื่อแบบไม่เข้า catalog) · ของจริงไม่ขยับ        -> D9a-D9c · R3
--  ✅ ใบเงินที่ออฟฟิศเปิดแบบเดิม (เรียก 4/5 arg เดิม) ได้ผลเท่าเดิม · ไม่ส่งค่าใหม่ = ค่าที่ helper คืน · แถวเดิม metal null ผ่าน preview/done ครบ 3 โหมด -> D10a-D10e · I9a-I9e · D11a-D11d
--  ✅ เปลี่ยนโลหะเมื่อมีใบงาน = ปฏิเสธ (RPC + trigger ตรง) · ยกเลิกใบงานแล้วเปลี่ยนได้ · แก้น้ำหนักได้ไม่แตะ job   -> I10a-I10g
--  ✅ UPDATE/DELETE ตรงบนใบ done/cancelled · overload = 1 แถว · anon/authenticated execute ไม่ได้ (จำลองกำแพงหลุด) -> F9a-F9c · S1-S4
--  ✅ prefill metal_known (spot/spec = true · fixed ไม่มี make_spec = false) · view left join + security_invoker + 17 คอลัมน์เดิม -> F1a-F1d · F4a-F4e
--  ✅ mutant ≥ 3 (ลบด่านแล้วเคสต้องล้มจริง)                                                                  -> M1-M7
--
--  ❌ ไม่มีเทสต์ครอบ (บอกตรงๆ):
--    - M-b ของ done (cost_type ถูกพลิกกลางฟังก์ชันภายใต้ READ COMMITTED) และ race หลาย connection (done×done, item_set×done) — ต้อง 2 connection พร้อมกัน do-block ทรานแซกชันเดียวจำลองไม่ได้
--    - ด่านทองรับ/ส่งงานน้ำหนักต่าง > 0.05 g ของช่าง (0175/0176) ไม่ทดสอบซ้ำ — ต้องตั้งช่าง/PIN/session ทั้งชุด · ที่นี่พิสูจน์เฉพาะต้นทางของกฎ: job.metal='gold' + แบบทอง (ชั่งทุกขั้นที่มีโลหะ + ชั่งสุทธิ) ซึ่ง 0175/0176 ผูกกฎกับ job.metal (verify-0175/0176 ทดสอบกฎนั้นเอง)
--    - ฝั่ง TS/หน้าจอ (ProductionItemCard ฯลฯ = PM-B) และ preview==server golden ของ TS — อยู่ใน lib/oem/metal-price.test.ts (เวกเตอร์เดียวกับ G3/G4) ไม่ใช่ไฟล์นี้
--    - golden replay เดิม-vs-ใหม่ รันซ้ำที่นี่ไม่ได้ (ฟังก์ชันเดิมถูก drop แล้ว) — พิสูจน์ที่ migration §16 ตอน apply · ที่นี่ใช้สูตรอิสระ (round(weight×price×purity+labor,2) / oem_cost_calc ตรง) แทน
--    - ปุ่ม/หน้า /oem/rates (MetalPriceSection) ยังเรียก oem_metal_price_set ต่อกรัมเดิม (PM-B ค่อยต่อ set_input) — ตอนนี้มีด่านช่วงใหม่คุ้มอยู่แล้ว
set local statement_timeout = '30min';

create temp table _v186_fx (k text primary key, id uuid not null) on commit drop;
create temp table _v186_snap (k text primary key, v text not null) on commit drop;

create function pg_temp.chk(p_id text, p_desc text, p_ok boolean) returns text
 language sql as $c$
  select format('[%s] %s  %s', case when coalesce(p_ok, false) then 'OK' else 'FAIL' end, p_id, p_desc) || E'\n'
$c$;
create function pg_temp.skip(p_id text, p_why text) returns text
 language sql as $c$ select format('[SKIP] %s  %s  ← ไม่นับเป็นผ่าน', p_id, p_why) || E'\n' $c$;
create function pg_temp.fx(p_k text) returns uuid language sql as $c$ select id from _v186_fx where k = p_k $c$;
create function pg_temp.setfx(p_k text, p_id uuid) returns void language sql as $c$
  insert into _v186_fx (k, id) values (p_k, p_id) on conflict (k) do update set id = excluded.id
$c$;
-- รัน SQL เดี่ยวใน sub-block: สำเร็จ = 'OK' · ล้ม = 'sqlstate|hint'
create function pg_temp.err(p_sql text) returns text
 language plpgsql as $c$
declare v_state text; v_hint text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
  return v_state || '|' || coalesce(v_hint, '');
end;
$c$;
-- รัน SQL ที่คืน jsonb: สำเร็จ = ค่าที่คืน · ล้ม = {_err,_state,_hint}
create function pg_temp.q(p_sql text) returns jsonb
 language plpgsql as $c$
declare v jsonb; v_msg text; v_state text; v_hint text;
begin
  execute p_sql into v;
  return coalesce(v, '{}'::jsonb);
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
  return jsonb_build_object('_err', v_msg, '_state', v_state, '_hint', v_hint);
end;
$c$;
create function pg_temp.hint(r jsonb) returns text language sql as $c$ select coalesce(r ->> '_state', 'OK') || '|' || coalesce(r ->> '_hint', '') $c$;
create function pg_temp.asrole(p_role text, p_sql text) returns text
 language plpgsql as $c$
declare v_msg text; v_state text;
begin
  execute format('set local role %I', p_role);
  execute p_sql;
  reset role;
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  reset role;
  return v_state;
end;
$c$;
create function pg_temp.iset(p_shop uuid, p_order uuid, p_product uuid, p_qty int, p_label text default null, p_metal text default null,
                              p_purity numeric default null, p_weight numeric default null, p_wsrc text default null, p_clear boolean default false) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>%L, p_qty_planned=>%L, p_pending_product_label=>%L, p_metal=>%L, p_purity=>%L, p_weight_g=>%L, p_weight_source=>%L, p_clear_weight=>%L)',
    p_shop, p_order, p_product, p_qty, p_label, p_metal, p_purity, p_weight, p_wsrc, p_clear))
$c$;
create function pg_temp.po(p_shop uuid, p_note text default 'verify0186', p_override numeric default null) returns uuid
 language sql as $c$ select (analytics.production_order_save(p_shop, null, p_note, p_override) ->> 'id')::uuid $c$;
create function pg_temp.pv(p_shop uuid, p_order uuid, p_items jsonb default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.production_order_preview(%L, %L, %L)', p_shop, p_order, p_items)) $c$;
create function pg_temp.dn(p_shop uuid, p_order uuid, p_items jsonb, p_exp jsonb) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.production_order_done(%L, %L, %L, %L, null)', p_shop, p_order, p_items, p_exp)) $c$;
create function pg_temp.pitem(p_prev jsonb, p_sku text) returns jsonb
 language sql as $c$ select jsonb_path_query_first(p_prev, '$.items[*] ? (@.sku == $s)', jsonb_build_object('s', p_sku)) $c$;
create function pg_temp.lots(p_order uuid) returns int
 language sql as $c$ select count(*)::int from analytics.stock_lot l where l.production_order_item_id in (select i.id from analytics.production_order_item i where i.production_order_id = p_order) $c$;
create function pg_temp.lot_cost(p_order uuid, p_product uuid) returns numeric
 language sql as $c$ select l.unit_cost from analytics.stock_lot l join analytics.production_order_item i on i.id = l.production_order_item_id where i.production_order_id = p_order and l.product_id = p_product $c$;
create function pg_temp.stock(p_product uuid) returns int
 language sql as $c$ select coalesce((select qty_on_hand from public.central_stock where product_id = p_product), 0) $c$;
create function pg_temp.item_id(p_order uuid, p_product uuid) returns uuid
 language sql as $c$ select id from analytics.production_order_item where production_order_id = p_order and product_id = p_product $c$;
create function pg_temp.std() returns text language sql as $c$ select '{wax_inject,wax_tree,invest_burnout,cast,cut_sprue,finish,buff,qc,pack}' $c$;
create function pg_temp.mkjob(p_shop uuid, p_item uuid, p_profile uuid default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_create_from_production_item(p_shop_id=>%L, p_production_order_item_id=>%L, p_stage_codes=>%L::text[], p_actor=>%L, p_profile_id=>%L)',
    p_shop, p_item, pg_temp.std(), '00000000-0000-0000-0000-0000000000a1'::uuid, p_profile))
$c$;
-- แทนที่ข้อความในนิยามฟังก์ชันแล้ว execute (mutant) — ไม่เจอข้อความ = raise (กัน mutant ที่ไม่ได้ mutate จริง)
create function pg_temp.mutate(p_sig text, p_from text, p_to text) returns void
 language plpgsql as $c$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef(p_sig::regprocedure);
  v_new := replace(v_def, p_from, p_to);
  if v_new = v_def then raise exception 'mutate: ไม่พบข้อความเป้าหมายใน % : %', p_sig, left(p_from, 80); end if;
  execute v_new;
end;
$c$;
-- แถวสินค้าทั้งก้อนของร้านสังเคราะห์เฉพาะคอลัมน์ catalog (ไม่รวม track_stock* / updated_at ที่ done เขียนตามเดิม)
create function pg_temp.catalog_md5(p_shop uuid) returns text
 language sql as $c$
  select coalesce(md5(string_agg(concat_ws('|', p.id, p.sku, p.name, p.cost_type, p.unit_cost, p.silver_weight_g, p.silver_purity, p.make_spec::text, p.labor_cost, p.list_price, p.is_active, p.category), ';' order by p.id)), '')
    from public.product p where p.shop_id = p_shop
$c$;

-- ============================================================================
-- A. setup
-- ============================================================================
create function pg_temp.g_setup() returns text
 language plpgsql as $c$
declare
  v text := '';
  v_shop uuid := gen_random_uuid();
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_rate_d date := (now() at time zone 'Asia/Bangkok')::date - 1;
  p uuid;
begin
  insert into public.shop (id, name) values (v_shop, 'ZZ TEST verify-0186');
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
    -- ทอง/ทองเหลือง (scope ของโลหะ) — ค่าทดสอบ ไม่ใช่ค่าจริงของร้าน
    (v_shop, 'sprue_loss_pct', 'gold', v_rate_d, 0.05), (v_shop, 'recovery_rate_pct', 'gold', v_rate_d, 0.95), (v_shop, 'polish_loss_pct', 'gold', v_rate_d, 0.02),
    (v_shop, 'gold_alloy_cost_thb_per_piece', '-', v_rate_d, 40),
    (v_shop, 'sprue_loss_pct', 'brass', v_rate_d, 0.05), (v_shop, 'recovery_rate_pct', 'brass', v_rate_d, 0.9), (v_shop, 'polish_loss_pct', 'brass', v_rate_d, 0.02);

  perform pg_temp.setfx('shop', v_shop);
  p := analytics.product_upsert(v_shop, 'ZZ186-FIXA',  'fixed A',           null, 'fixed', 88, null, null, null, 150, null, null, null, true); perform pg_temp.setfx('fixa', p);
  p := analytics.product_upsert(v_shop, 'ZZ186-FIXB',  'fixed B',           null, 'fixed', 50, null, null, null, null, null, null, null, true); perform pg_temp.setfx('fixb', p);
  p := analytics.product_upsert(v_shop, 'ZZ186-NOCOST', 'fixed ไม่มีต้นทุน', null, 'fixed', null, null, null, null, null, null, null, null, true); perform pg_temp.setfx('fixnc', p);
  p := analytics.product_upsert(v_shop, 'ZZ186-SPOT',  'spot 10g .925',     null, 'spot', null, 10, 0.925, 20, 300, null, null, null, true); perform pg_temp.setfx('spot', p);
  p := analytics.product_upsert(v_shop, 'ZZ186-BAR',   'spot แท่ง .999',    null, 'spot', null, 152.44, 0.999, null, null, null, null, null, true); perform pg_temp.setfx('bar', p);
  p := analytics.product_upsert(v_shop, 'ZZ186-SPEC',  'spec เงิน',         null, 'fixed', null, 3.5, 0.925, null, null, null, null, null, true);
  perform analytics.product_make_spec_set(v_shop, p, jsonb_build_object('metal', 'silver', 'item_kind', 'แหวน', 'polish_tier', 'เรียบ')); perform pg_temp.setfx('spec', p);
  p := analytics.product_upsert(v_shop, 'live186', 'live sku', null, 'fixed', 10, null, null, null, null, null, null, null, true); perform pg_temp.setfx('live', p);
  p := analytics.product_upsert(v_shop, 'ZZ186-OFF', 'ปิดใช้งาน', null, 'fixed', 10, null, null, null, null, null, null, null, false); perform pg_temp.setfx('off', p);

  -- ราคาเงินวันนี้ (RPC ต่อกรัมเดิม) · ราคาทอง/ทองเหลืองเก่า 25 ส.ค. (ไม่ใช่วันนี้ — เคส "มีแถวเก่าแต่ไม่มีของวันนี้")
  perform analytics.oem_metal_price_set(v_shop, 'silver', 72, v_today, 'manual');
  perform analytics.oem_metal_price_set(v_shop, 'gold', 4736, date '2026-08-25', 'manual');
  perform analytics.oem_metal_price_set(v_shop, 'brass', 1, date '2026-08-25', 'manual');
  v := v || pg_temp.chk('A0', 'setup: ร้าน ZZ186 + rate + SKU 8 ตัว (fixed/spot/spec/live/ปิด) + ราคาเงินวันนี้ + ราคาทอง/ทองเหลืองเก่า 25 ส.ค. (ไม่ใช่วันนี้)', true);

  -- ราคาทอง/ทองเหลืองของวันนี้ให้กลุ่มที่ต้องใช้ (ผ่าน RPC หน่วยหน้างาน: 41,250 บาทละ และ 350 บาท/กก.) — กลุ่ม D2 ลบทิ้งเองใน sub-block เมื่อต้องการสถานะ "ไม่มีราคาวันนี้"
  perform analytics.oem_metal_price_set_input(v_shop, 'gold', 41250, 'assoc965_sell_per_baht');
  perform analytics.oem_metal_price_set_input(v_shop, 'brass', 350, 'thb_per_kg');
  -- snapshot ของจริง (ร้านอื่นทั้งหมด) ไว้เทียบท้ายไฟล์ (R3)
  insert into _v186_snap (k, v) values
    ('real_product', (select coalesce(md5(string_agg(pr::text, '|' order by pr.id)), '') from public.product pr where pr.shop_id <> v_shop)),
    ('real_dim', (select coalesce(md5(string_agg(d.product_id::text || ':' || coalesce(d.effective_unit_cost::text, 'NULL'), ',' order by d.product_id)), '') from analytics.v_dim_product d where d.shop_id <> v_shop)),
    ('real_po', (select coalesce(md5(string_agg(po.id::text || ':' || po.status, ',' order by po.id)), '') from analytics.production_order po where po.shop_id <> v_shop)),
    ('real_poi', (select coalesce(md5(string_agg(to_jsonb(i)::text, '|' order by i.id)), '') from analytics.production_order_item i where i.shop_id <> v_shop)),
    ('real_lot', (select count(*)::text from analytics.stock_lot l where l.shop_id <> v_shop)),
    ('real_job', (select coalesce(md5(string_agg(j::text, '|' order by j.id)), '') from analytics.job j where j.shop_id <> v_shop)),
    ('real_price', (select coalesce(md5(string_agg(m::text, '|' order by m.metal, m.as_of_date)), '') from analytics.oem_metal_price m where m.shop_id <> v_shop));
  return v;
end;
$c$;

-- ============================================================================
-- G. ช่วงราคา + ตัวแปลง + RPC กรอกหน่วยหน้างาน
-- ============================================================================
create function pg_temp.g_price() returns text
 language plpgsql as $c$
declare
  v text := '';
  v_shop uuid := pg_temp.fx('shop');
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  r jsonb; r2 jsonb;
  v_num numeric; v_num2 numeric; v_text text; v_gold numeric; v_brass numeric;
begin
  begin
    -- G1 ทองต่อกรัม 100% ขอบ 4 จุด (เจ้าของเคาะ 2,000–8,000)
    v := v || pg_temp.chk('G1a', 'ทองต่อกรัม 2000 ผ่าน (ขอบล่าง)', pg_temp.err(format('select analytics.oem_metal_price_set(%L, %L, 2000, date %L, %L)', v_shop, 'gold', '2026-07-01', 'manual')) = 'OK');
    v := v || pg_temp.chk('G1b', 'ทองต่อกรัม 8000 ผ่าน (ขอบบน)', pg_temp.err(format('select analytics.oem_metal_price_set(%L, %L, 8000, date %L, %L)', v_shop, 'gold', '2026-07-02', 'manual')) = 'OK');
    v := v || pg_temp.chk('G1c', 'ทองต่อกรัม 1999.99 ตก (22023 metal_price_range)', pg_temp.err(format('select analytics.oem_metal_price_set(%L, %L, 1999.99, date %L, %L)', v_shop, 'gold', '2026-07-03', 'manual')) = '22023|metal_price_range');
    v := v || pg_temp.chk('G1d', 'ทองต่อกรัม 8000.01 ตก', pg_temp.err(format('select analytics.oem_metal_price_set(%L, %L, 8000.01, date %L, %L)', v_shop, 'gold', '2026-07-04', 'manual')) = '22023|metal_price_range');
    v := v || pg_temp.chk('G1e', 'ทอง "ต่อบาท" หลุดมาเป็นต่อกรัม (41250) ตก — บั๊กหน่วย ×15 แบบเงิน 17 ก.ย.', pg_temp.err(format('select analytics.oem_metal_price_set(%L, %L, 41250, date %L, %L)', v_shop, 'gold', '2026-07-05', 'manual')) = '22023|metal_price_range');
    v := v || pg_temp.chk('G1f', 'ทอง NaN ตก (not-between — ข้อ 4)', pg_temp.err(format('select analytics.oem_metal_price_set(%L, %L, %L::numeric, date %L, %L)', v_shop, 'gold', 'NaN', '2026-07-06', 'manual')) <> 'OK');
    v := v || pg_temp.chk('G1g', 'ทอง Infinity ตก', pg_temp.err(format('select analytics.oem_metal_price_set(%L, %L, %L::numeric, date %L, %L)', v_shop, 'gold', 'Infinity', '2026-07-07', 'manual')) <> 'OK');
    v := v || pg_temp.chk('G1h', 'ทอง 0 / ติดลบ ตก', pg_temp.err(format('select analytics.oem_metal_price_set(%L, %L, 0, date %L, %L)', v_shop, 'gold', '2026-07-08', 'manual')) <> 'OK'
                             and pg_temp.err(format('select analytics.oem_metal_price_set(%L, %L, -5, date %L, %L)', v_shop, 'gold', '2026-07-09', 'manual')) <> 'OK');

    -- G2 ทองเหลืองต่อกรัม (DB เก็บ 0.10–1.00 = 100–1,000 บาท/กก.)
    v := v || pg_temp.chk('G2a', 'ทองเหลืองต่อกรัม 0.10 ผ่าน (= 100 บาท/กก.)', pg_temp.err(format('select analytics.oem_metal_price_set(%L, %L, 0.10, date %L, %L)', v_shop, 'brass', '2026-07-01', 'manual')) = 'OK');
    v := v || pg_temp.chk('G2b', 'ทองเหลืองต่อกรัม 1.00 ผ่าน (= 1,000 บาท/กก.)', pg_temp.err(format('select analytics.oem_metal_price_set(%L, %L, 1.00, date %L, %L)', v_shop, 'brass', '2026-07-02', 'manual')) = 'OK');
    v := v || pg_temp.chk('G2c', 'ทองเหลืองต่อกรัม 0.0999 ตก', pg_temp.err(format('select analytics.oem_metal_price_set(%L, %L, 0.0999, date %L, %L)', v_shop, 'brass', '2026-07-03', 'manual')) = '22023|metal_price_range');
    v := v || pg_temp.chk('G2d', 'ทองเหลืองต่อกรัม 1.0001 ตก', pg_temp.err(format('select analytics.oem_metal_price_set(%L, %L, 1.0001, date %L, %L)', v_shop, 'brass', '2026-07-04', 'manual')) = '22023|metal_price_range');
    v := v || pg_temp.chk('G2e', 'ทองเหลือง "บาท/กก." หลุดมาเป็นต่อกรัม (350) ตก — ×1,000', pg_temp.err(format('select analytics.oem_metal_price_set(%L, %L, 350, date %L, %L)', v_shop, 'brass', '2026-07-05', 'manual')) = '22023|metal_price_range');
    v := v || pg_temp.chk('G2f', 'เงินยังช่วงเดิม 5–500: 5 และ 500 ผ่าน · 4.99 และ 500.01 ตก (ต้องไม่พัง)',
      pg_temp.err(format('select analytics.oem_metal_price_set(%L, %L, 5, date %L, %L)', v_shop, 'silver', '2026-07-01', 'manual')) = 'OK'
      and pg_temp.err(format('select analytics.oem_metal_price_set(%L, %L, 500, date %L, %L)', v_shop, 'silver', '2026-07-02', 'manual')) = 'OK'
      and pg_temp.err(format('select analytics.oem_metal_price_set(%L, %L, 4.99, date %L, %L)', v_shop, 'silver', '2026-07-03', 'manual')) <> 'OK'
      and pg_temp.err(format('select analytics.oem_metal_price_set(%L, %L, 500.01, date %L, %L)', v_shop, 'silver', '2026-07-04', 'manual')) <> 'OK');

    -- G3 กรอก "ราคาสมาคม ทองคำแท่ง 96.5% ขายออก บาทละ" → ÷15.244 ÷0.965 (DB ตัดสิน) · เวกเตอร์เดียวกับ lib/oem/metal-price.test.ts
    r := pg_temp.q(format('select analytics.oem_metal_price_set_input(%L, %L, 29420.92, %L)', v_shop, 'gold', 'assoc965_sell_per_baht'));
    v := v || pg_temp.chk('G3a', 'ขอบล่าง 29,420.92 บาทละ → 2000.0000 บาท/กรัม ผ่าน · คืนค่าที่เก็บ: ' || coalesce(r ->> 'price_thb_per_gram', r ->> '_err'), (r ->> 'price_thb_per_gram')::numeric = 2000.0000);
    r := pg_temp.q(format('select analytics.oem_metal_price_set_input(%L, %L, 117683.68, %L)', v_shop, 'gold', 'assoc965_sell_per_baht'));
    v := v || pg_temp.chk('G3b', 'ขอบบน 117,683.68 บาทละ → 8000.0000 ผ่าน: ' || coalesce(r ->> 'price_thb_per_gram', r ->> '_err'), (r ->> 'price_thb_per_gram')::numeric = 8000.0000);
    v := v || pg_temp.chk('G3c', '29,420.91 ตก (→ 1999.9993 ต่ำกว่า 2000)', pg_temp.q(format('select analytics.oem_metal_price_set_input(%L, %L, 29420.91, %L)', v_shop, 'gold', 'assoc965_sell_per_baht')) ->> '_hint' = 'metal_price_range');
    v := v || pg_temp.chk('G3d', '117,683.69 ตก (→ 8000.0007 สูงกว่า 8000)', pg_temp.q(format('select analytics.oem_metal_price_set_input(%L, %L, 117683.69, %L)', v_shop, 'gold', 'assoc965_sell_per_baht')) ->> '_hint' = 'metal_price_range');
    v := v || pg_temp.chk('G3e', '29,420.00 ตก (→ 1999.9375) · 117,684.00 ตก (→ 8000.0218)',
      pg_temp.q(format('select analytics.oem_metal_price_set_input(%L, %L, 29420.00, %L)', v_shop, 'gold', 'assoc965_sell_per_baht')) ->> '_hint' = 'metal_price_range'
      and pg_temp.q(format('select analytics.oem_metal_price_set_input(%L, %L, 117684.00, %L)', v_shop, 'gold', 'assoc965_sell_per_baht')) ->> '_hint' = 'metal_price_range');
    r := pg_temp.q(format('select analytics.oem_metal_price_set_input(%L, %L, 41250, %L)', v_shop, 'gold', 'assoc965_sell_per_baht'));
    v := v || pg_temp.chk('G3f', 'ราคากลางช่วง 41,250 บาทละ → 2804.1271 (เวกเตอร์ BigInt ของ TS) · คืน ' || coalesce(r ->> 'price_thb_per_gram', r ->> '_err'), (r ->> 'price_thb_per_gram')::numeric = 2804.1271);
    v := v || pg_temp.chk('G3g', 'เวกเตอร์ 30,000→2039.3652 · 50,000→3398.9420 · 100,000→6797.8840 (ตรง TS)',
      round(30000::numeric / (15.244 * 0.965), 4) = 2039.3652 and round(50000::numeric / (15.244 * 0.965), 4) = 3398.9420 and round(100000::numeric / (15.244 * 0.965), 4) = 6797.8840);
    v := v || pg_temp.chk('G3h', 'NaN / 0 / ติดลบ / ทศนิยม 3 ตำแหน่ง ตก (ราคาที่กรอก)',
      pg_temp.q(format('select analytics.oem_metal_price_set_input(%L, %L, %L::numeric, %L)', v_shop, 'gold', 'NaN', 'assoc965_sell_per_baht')) ->> '_state' = '22023'
      and pg_temp.q(format('select analytics.oem_metal_price_set_input(%L, %L, 0, %L)', v_shop, 'gold', 'assoc965_sell_per_baht')) ->> '_state' = '22023'
      and pg_temp.q(format('select analytics.oem_metal_price_set_input(%L, %L, -41250, %L)', v_shop, 'gold', 'assoc965_sell_per_baht')) ->> '_state' = '22023'
      and pg_temp.q(format('select analytics.oem_metal_price_set_input(%L, %L, 41250.123, %L)', v_shop, 'gold', 'assoc965_sell_per_baht')) ->> '_state' = '22023');
    r2 := pg_temp.q(format('select analytics.oem_metal_price_set_input(%L, %L, 41250, %L)', v_shop, 'gold', 'assoc965_sell_per_baht'));
    select m.price_thb_per_gram, m.input_value, m.input_unit into v_num, v_num2, v_text
      from analytics.oem_metal_price m where m.shop_id = v_shop and m.metal = 'gold' and m.as_of_date = v_today;
    v := v || pg_temp.chk('G3i', 'ค่าที่ server คืน = ค่าที่เก็บในตารางเป๊ะ (ราคา/ค่าที่กรอก/หน่วย/วันนี้ไทย) · upsert ซ้ำวันเดียวกันทับค่าเดิม (1 แถว)',
      v_num = (r2 ->> 'price_thb_per_gram')::numeric and v_num2 = 41250 and v_text = 'assoc965_sell_per_baht' and (r2 ->> 'as_of_date')::date = v_today
      and (select count(*) from analytics.oem_metal_price where shop_id = v_shop and metal = 'gold' and as_of_date = v_today) = 1);
    v := v || pg_temp.chk('G3j', 'กรอกได้เฉพาะ "วันนี้" — RPC ไม่มี p_as_of ให้ย้อนวัน (signature 4 arg)',
      (select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'oem_metal_price_set_input' and pronamespace = 'analytics'::regnamespace) = 'p_shop_id uuid, p_metal text, p_input_value numeric, p_input_unit text');
    v := v || pg_temp.chk('G3k', 'ราคาทองวันนี้ที่กรอกแล้ว: input_value/input_unit เก็บคู่กับค่าต่อกรัม (R4)', exists (select 1 from analytics.oem_metal_price where shop_id = v_shop and metal = 'gold' and as_of_date = v_today and input_value is not null and input_unit is not null));
    v_gold := (r2 ->> 'price_thb_per_gram')::numeric;

    -- G4 ทองเหลือง บาท/กก. ÷1,000
    r := pg_temp.q(format('select analytics.oem_metal_price_set_input(%L, %L, 100, %L)', v_shop, 'brass', 'thb_per_kg'));
    v := v || pg_temp.chk('G4a', 'ทองเหลือง 100 บาท/กก. → 0.1000 ผ่าน (ขอบล่าง)', (r ->> 'price_thb_per_gram')::numeric = 0.1000);
    r := pg_temp.q(format('select analytics.oem_metal_price_set_input(%L, %L, 1000, %L)', v_shop, 'brass', 'thb_per_kg'));
    v := v || pg_temp.chk('G4b', 'ทองเหลือง 1,000 บาท/กก. → 1.0000 ผ่าน (ขอบบน)', (r ->> 'price_thb_per_gram')::numeric = 1.0000);
    v := v || pg_temp.chk('G4c', '99.99 บาท/กก. ตก (ปัด 4 ตำแหน่งแล้วจะกลายเป็น 0.1000 — ต้องเช็คก่อนปัด)', pg_temp.q(format('select analytics.oem_metal_price_set_input(%L, %L, 99.99, %L)', v_shop, 'brass', 'thb_per_kg')) ->> '_hint' = 'metal_price_range');
    v := v || pg_temp.chk('G4d', '1,000.01 บาท/กก. ตก (ปัดแล้วกลายเป็น 1.0000 — ต้องเช็คก่อนปัด)', pg_temp.q(format('select analytics.oem_metal_price_set_input(%L, %L, 1000.01, %L)', v_shop, 'brass', 'thb_per_kg')) ->> '_hint' = 'metal_price_range');
    r := pg_temp.q(format('select analytics.oem_metal_price_set_input(%L, %L, 350.55, %L)', v_shop, 'brass', 'thb_per_kg'));
    v := v || pg_temp.chk('G4e', '350.55 บาท/กก. → เก็บ 0.3506 (ปัดครึ่งขึ้นที่ 4 ตำแหน่ง · คืนค่าที่เก็บ) + input_value 350.55 เก็บคู่', (r ->> 'price_thb_per_gram')::numeric = 0.3506 and (r ->> 'input_value')::numeric = 350.55);
    r := pg_temp.q(format('select analytics.oem_metal_price_set_input(%L, %L, 350, %L)', v_shop, 'brass', 'thb_per_kg'));
    v_brass := (r ->> 'price_thb_per_gram')::numeric;
    v := v || pg_temp.chk('G4f', '350 บาท/กก. → 0.3500 (ราคาทองเหลืองวันนี้ของชุดทดสอบ)', v_brass = 0.3500);

    -- G5 หน่วยไม่ตรงโลหะ
    v := v || pg_temp.chk('G5a', 'ทอง + หน่วย thb_per_kg ตก', pg_temp.q(format('select analytics.oem_metal_price_set_input(%L, %L, 41250, %L)', v_shop, 'gold', 'thb_per_kg')) ->> '_hint' = 'metal_price_unit_invalid');
    v := v || pg_temp.chk('G5b', 'ทองเหลือง + หน่วยราคาสมาคม ตก', pg_temp.q(format('select analytics.oem_metal_price_set_input(%L, %L, 350, %L)', v_shop, 'brass', 'assoc965_sell_per_baht')) ->> '_hint' = 'metal_price_unit_invalid');
    v := v || pg_temp.chk('G5c', 'เงินกรอกด้วยหน่วยหน้างานไม่ได้ (ใช้ราคาต่อกรัมเดิม)', pg_temp.q(format('select analytics.oem_metal_price_set_input(%L, %L, 72, %L)', v_shop, 'silver', 'thb_per_kg')) ->> '_hint' = 'metal_price_unit_invalid');
    v := v || pg_temp.chk('G5d', 'โลหะนอก 3 ค่า / หน่วยว่าง ตก', pg_temp.err(format('select analytics.oem_metal_price_set_input(%L, %L, 1, %L)', v_shop, 'platinum', 'thb_per_kg')) <> 'OK'
                            and pg_temp.err(format('select analytics.oem_metal_price_set_input(%L, %L, 1, null)', v_shop, 'gold')) <> 'OK');

    -- G6 RPC ต่อกรัมตรงล้างคู่ input_* (ไม่ให้ค้างข้างราคาใหม่) · แล้วคืนราคากรอกหน้างานเป็นของวันนี้
    perform analytics.oem_metal_price_set(v_shop, 'gold', 3000, v_today, 'manual');
    v := v || pg_temp.chk('G6', 'oem_metal_price_set ต่อกรัมตรงทับแถววันนี้ → input_value/input_unit ถูกล้างเป็น null (ไม่ค้างค่า 41,250 ของเดิม)',
      exists (select 1 from analytics.oem_metal_price where shop_id = v_shop and metal = 'gold' and as_of_date = v_today and price_thb_per_gram = 3000 and input_value is null and input_unit is null));
    perform analytics.oem_metal_price_set_input(v_shop, 'gold', 41250, 'assoc965_sell_per_baht');
    perform analytics.oem_metal_price_set_input(v_shop, 'brass', 350, 'thb_per_kg');

    -- G9 CHECK ตาราง (ทางที่ไม่ผ่าน RPC — เช่น insert ตรงด้วย service role)
    v := v || pg_temp.chk('G9a', 'insert ตรงแถวทองนอกช่วง (9000) ตก 23514 (oem_metal_price_range_ck)', pg_temp.err(format('insert into analytics.oem_metal_price (shop_id, metal, as_of_date, price_thb_per_gram) values (%L, %L, date %L, 9000)', v_shop, 'gold', '2026-06-01')) like '23514|%');
    v := v || pg_temp.chk('G9b', 'insert ตรงแถวทองเหลืองนอกช่วง (350 ต่อกรัม) ตก 23514', pg_temp.err(format('insert into analytics.oem_metal_price (shop_id, metal, as_of_date, price_thb_per_gram) values (%L, %L, date %L, 350)', v_shop, 'brass', '2026-06-01')) like '23514|%');
    v := v || pg_temp.chk('G9c', 'insert ตรงที่มี input_value แต่ไม่มี input_unit / หน่วยไม่ตรงโลหะ ตก 23514 (oem_metal_price_input_ck)',
      pg_temp.err(format('insert into analytics.oem_metal_price (shop_id, metal, as_of_date, price_thb_per_gram, input_value) values (%L, %L, date %L, 3000, 41250)', v_shop, 'gold', '2026-06-02')) like '23514|%'
      and pg_temp.err(format('insert into analytics.oem_metal_price (shop_id, metal, as_of_date, price_thb_per_gram, input_value, input_unit) values (%L, %L, date %L, 3000, 41250, %L)', v_shop, 'gold', '2026-06-03', 'thb_per_kg')) like '23514|%');
    v := v || pg_temp.chk('G9d', 'เงินตรงๆ ไม่ติด CHECK ช่วงทอง (silver 72 ผ่านตามเดิม — แถวเงินเดิมของ prod ไม่ถูกตีตก)', pg_temp.err(format('insert into analytics.oem_metal_price (shop_id, metal, as_of_date, price_thb_per_gram) values (%L, %L, date %L, 72)', v_shop, 'silver', '2026-06-04')) = 'OK');

    -- G10 resolve ต่อโลหะ
    v := v || pg_temp.chk('G10a', 'resolve เงิน: override ใบ 66 → 66 · ไม่มี override → ราคาวันนี้ 72 · override 4.99 ตก (5–500 เดิม)',
      analytics.production_metal_price_resolve(v_shop, 'silver', 66) = 66 and analytics.production_metal_price_resolve(v_shop, 'silver', null) = 72
      and pg_temp.err(format('select analytics.production_metal_price_resolve(%L, %L, 4.99)', v_shop, 'silver')) like '22023|%');
    v := v || pg_temp.chk('G10b', 'production_spot_resolve (wrapper เดิม) = ผลเดียวกับ resolve เงิน ทั้ง override/ไม่มี override',
      analytics.production_spot_resolve(v_shop, 66) = 66 and analytics.production_spot_resolve(v_shop, null) = 72);
    v := v || pg_temp.chk('G10c', 'resolve ทอง: ส่ง override ตก (ไม่มีราคาเฉพาะใบ — มติ Q3/Q6) · ได้ราคาวันนี้ที่กรอก (2804.1271)',
      pg_temp.err(format('select analytics.production_metal_price_resolve(%L, %L, 3000)', v_shop, 'gold')) = '22023|override_not_supported'
      and analytics.production_metal_price_resolve(v_shop, 'gold', null) = v_gold);
    v := v || pg_temp.chk('G10d', 'resolve ทองเหลือง วันนี้ = 0.3500', analytics.production_metal_price_resolve(v_shop, 'brass', null) = 0.3500);
  exception when others then
    v := v || pg_temp.chk('G-crash', 'กลุ่ม G raise: ' || sqlstate || ' ' || sqlerrm, false);
  end;
  return v;
end;
$c$;

-- ============================================================================
-- I. production_order_item_set — validate ทุกช่อง + ค่าเริ่ม + ชื่อแบบ
-- ============================================================================
create function pg_temp.g_item() returns text
 language plpgsql as $c$
declare
  v text := '';
  v_shop uuid := pg_temp.fx('shop');
  p_fixa uuid := pg_temp.fx('fixa'); p_fixb uuid := pg_temp.fx('fixb'); p_spot uuid := pg_temp.fx('spot'); p_bar uuid := pg_temp.fx('bar');
  p_live uuid := pg_temp.fx('live'); p_off uuid := pg_temp.fx('off');
  o uuid; o2 uuid; o3 uuid; r jsonb; r2 jsonb; r3 jsonb;
begin
  begin
    o := pg_temp.po(v_shop, 'I tests');
    -- I1 purity
    v := v || pg_temp.chk('I1a', 'purity 0.374 ตก (ขั้นต่ำ 0.375)', pg_temp.hint(pg_temp.iset(v_shop, o, p_fixa, 1, null, 'gold', 0.374)) = '22023|purity_invalid');
    v := v || pg_temp.chk('I1b', 'purity 1.0001 ตก', pg_temp.hint(pg_temp.iset(v_shop, o, p_fixa, 1, null, 'gold', 1.0001)) like '22023|%');
    v := v || pg_temp.chk('I1c', 'purity NaN ตก', pg_temp.hint(pg_temp.iset(v_shop, o, p_fixa, 1, null, 'gold', 'NaN'::numeric)) like '22023|%');
    v := v || pg_temp.chk('I1d', 'purity Infinity ตก', pg_temp.hint(pg_temp.iset(v_shop, o, p_fixa, 1, null, 'gold', 'Infinity'::numeric)) like '22023|%');
    v := v || pg_temp.chk('I1e', 'purity ทศนิยม 5 ตำแหน่ง (0.37501) ตก — ไม่ปัดเงียบ', pg_temp.hint(pg_temp.iset(v_shop, o, p_fixa, 1, null, 'gold', 0.37501)) = '22023|purity_invalid');
    v := v || pg_temp.chk('I1f', 'ไม่มีรายการเกิดจากเคสที่ตก (I1a-I1e)', (select count(*) from analytics.production_order_item where production_order_id = o) = 0);
    -- I2 weight
    v := v || pg_temp.chk('I2a', 'weight 0 ตก', pg_temp.hint(pg_temp.iset(v_shop, o, p_fixa, 1, null, null, null, 0, 'input')) = '22023|weight_invalid');
    v := v || pg_temp.chk('I2b', 'weight ติดลบ ตก', pg_temp.hint(pg_temp.iset(v_shop, o, p_fixa, 1, null, null, null, -1, 'input')) = '22023|weight_invalid');
    v := v || pg_temp.chk('I2c', 'weight 10000.001 ตก', pg_temp.hint(pg_temp.iset(v_shop, o, p_fixa, 1, null, null, null, 10000.001, 'input')) = '22023|weight_invalid');
    v := v || pg_temp.chk('I2d', 'weight 99999 ตก', pg_temp.hint(pg_temp.iset(v_shop, o, p_fixa, 1, null, null, null, 99999, 'input')) = '22023|weight_invalid');
    v := v || pg_temp.chk('I2e', 'weight NaN ตก', pg_temp.hint(pg_temp.iset(v_shop, o, p_fixa, 1, null, null, null, 'NaN'::numeric, 'input')) like '22023|%');
    v := v || pg_temp.chk('I2f', 'weight 3.2001 (ทศนิยมเกิน 3) ตก — ไม่ปัดเงียบ', pg_temp.hint(pg_temp.iset(v_shop, o, p_fixa, 1, null, null, null, 3.2001, 'input')) = '22023|weight_invalid');
    r := pg_temp.iset(v_shop, o, p_fixb, 1, null, null, null, 10000, 'input');
    v := v || pg_temp.chk('I2g', 'ขอบ: weight 10000 ผ่าน (ต้องไม่พัง)', (r ->> 'weight_g')::numeric = 10000);
    r := pg_temp.iset(v_shop, o, p_fixb, 1, null, null, null, 0.001, 'input');
    v := v || pg_temp.chk('I2h', 'ขอบ: weight 0.001 ผ่าน (แก้รายการเดิมของ I2g)', (r ->> 'weight_g')::numeric = 0.001);
    perform analytics.production_order_item_remove(v_shop, o, p_fixb);
    -- I3 metal/source
    v := v || pg_temp.chk('I3a', 'metal "platinum" ตก', pg_temp.hint(pg_temp.iset(v_shop, o, p_fixa, 1, null, 'platinum')) = '22023|metal_invalid');
    v := v || pg_temp.chk('I3b', 'weight_source "typed" ตก', pg_temp.hint(pg_temp.iset(v_shop, o, p_fixa, 1, null, null, null, 3, 'typed')) = '22023|weight_source_invalid');
    v := v || pg_temp.chk('I3c', 'มี weight ไม่มี source ตก', pg_temp.hint(pg_temp.iset(v_shop, o, p_fixa, 1, null, null, null, 3, null)) = '22023|weight_source_invalid');
    v := v || pg_temp.chk('I3d', 'มี source ไม่มี weight ตก', pg_temp.hint(pg_temp.iset(v_shop, o, p_fixa, 1, null, null, null, null, 'input')) = '22023|weight_source_invalid');
    v := v || pg_temp.chk('I3e', 'weight_source=product แต่น้ำหนักไม่ตรง SKU (fixa ไม่มีน้ำหนักเงิน) ตก — ไม่ให้ป้ายเท็จ', pg_temp.hint(pg_temp.iset(v_shop, o, p_fixa, 1, null, null, null, 3, 'product')) = '22023|weight_source_invalid');
    -- I4 ทองไม่มี purity
    v := v || pg_temp.chk('I4a', 'ทอง ไม่ส่ง purity (แถวใหม่) ตก gold_purity_required — ไม่มี default', pg_temp.hint(pg_temp.iset(v_shop, o, p_fixa, 1, null, 'gold')) = '22023|gold_purity_required');
    v := v || pg_temp.chk('I4b', 'ทอง purity 0.374 ตก · 0.375 ผ่าน (ขั้นต่ำ 37.50%)', pg_temp.hint(pg_temp.iset(v_shop, o, p_fixa, 1, null, 'gold', 0.374)) like '22023|%' and (pg_temp.iset(v_shop, o, p_fixa, 1, null, 'gold', 0.375) ->> 'purity')::numeric = 0.375);
    r := pg_temp.iset(v_shop, o, p_fixa, 2, null, 'gold', 0.9, 3.2, 'input');
    v := v || pg_temp.chk('I4c', 'ทอง purity 0.9 น้ำหนัก 3.2 (input) บนใบเดียวกัน = แก้รายการเดิม ไม่ซ้ำ · เก็บค่าที่ส่ง', (r ->> 'metal') = 'gold' and (r ->> 'purity')::numeric = 0.9 and (r ->> 'weight_g')::numeric = 3.2 and (r ->> 'weight_source') = 'input'
      and (select count(*) from analytics.production_order_item where production_order_id = o and product_id = p_fixa) = 1);
    v := v || pg_temp.chk('I4d', 'CHECK ตรง: update ให้ทองไม่มี purity ตก 23514 (production_order_item_gold_purity_ck)', pg_temp.err(format('update analytics.production_order_item set purity = null where production_order_id = %L and product_id = %L', o, p_fixa)) like '23514|%');
    -- I5 ทองเหลืองเนื้อล็อก 100
    r := pg_temp.iset(v_shop, o, p_fixb, 1, null, 'brass');
    v := v || pg_temp.chk('I5a', 'ทองเหลืองไม่ส่ง purity → เก็บ 1.0 (ล็อก 100%)', (r ->> 'metal') = 'brass' and (r ->> 'purity')::numeric = 1);
    v := v || pg_temp.chk('I5b', 'ทองเหลือง purity 0.925 ตก brass_purity_locked (แถวใหม่ในใบอื่น)', pg_temp.hint(pg_temp.iset(v_shop, pg_temp.po(v_shop, 'I5b'), p_fixb, 1, null, 'brass', 0.925)) = '22023|brass_purity_locked');
    v := v || pg_temp.chk('I5c', 'ทองเหลือง: แก้รายการเดิมด้วย purity 0.9 ตก · CHECK ตรง purity<>1 ตก 23514',
      pg_temp.hint(pg_temp.iset(v_shop, o, p_fixb, 1, null, null, 0.9)) = '22023|brass_purity_locked'
      and pg_temp.err(format('update analytics.production_order_item set purity = 0.9 where production_order_id = %L and product_id = %L', o, p_fixb)) like '23514|%');
    perform analytics.production_order_item_remove(v_shop, o, p_fixb);
    perform analytics.production_order_item_remove(v_shop, o, p_fixa);

    -- I6 ชื่อแบบ (รายการไม่มี SKU)
    v := v || pg_temp.chk('I6a', 'ไม่มีทั้ง SKU และชื่อแบบ ตก sku_or_label', pg_temp.hint(pg_temp.iset(v_shop, o, null, 1, null, 'silver')) = '22023|sku_or_label');
    v := v || pg_temp.chk('I6b', 'มีทั้ง SKU และชื่อแบบ ตก sku_or_label', pg_temp.hint(pg_temp.iset(v_shop, o, p_fixa, 1, 'แหวนทดลอง', 'silver')) = '22023|sku_or_label');
    v := v || pg_temp.chk('I6c', 'ชื่อแบบช่องว่างล้วน ตก', pg_temp.hint(pg_temp.iset(v_shop, o, null, 1, '   ', 'silver')) like '22023|%');
    v := v || pg_temp.chk('I6d', 'ชื่อแบบมี < หรือ > ตก', pg_temp.hint(pg_temp.iset(v_shop, o, null, 1, 'แหวน<script>', 'silver')) like '22023|%' and pg_temp.hint(pg_temp.iset(v_shop, o, null, 1, 'a>b', 'silver')) like '22023|%');
    v := v || pg_temp.chk('I6e', 'ชื่อแบบมีขึ้นบรรทัดใหม่/ตัวล่องหน (ZWSP) ตก', pg_temp.hint(pg_temp.iset(v_shop, o, null, 1, E'แหวน\nสอง', 'silver')) like '22023|%' and pg_temp.hint(pg_temp.iset(v_shop, o, null, 1, E'แหวน​สอง', 'silver')) like '22023|%');
    v := v || pg_temp.chk('I6f', 'ชื่อแบบ 201 ตัวอักษร ตก · 200 ตัวผ่าน', pg_temp.hint(pg_temp.iset(v_shop, o, null, 1, repeat('ก', 201), 'silver')) like '22023|%' and (pg_temp.iset(v_shop, o, null, 1, repeat('ข', 200), 'silver') ->> 'pending_product_label') = repeat('ข', 200));
    r := pg_temp.iset(v_shop, o, null, 4, 'แหวนทดลองลายใบไม้', 'silver');
    v := v || pg_temp.chk('I6g', 'รายการไม่มี SKU สร้างได้: product_id null · เก็บชื่อแบบ · เงิน 0.925 (ค่าเริ่ม) · qty 4', (r ->> 'product_id') is null and (r ->> 'pending_product_label') = 'แหวนทดลองลายใบไม้' and (r ->> 'metal') = 'silver' and (r ->> 'purity')::numeric = 0.925 and (r ->> 'qty_planned')::int = 4);
    r2 := pg_temp.iset(v_shop, o, null, 9, 'แหวนทดลองลายใบไม้', 'silver');
    v := v || pg_temp.chk('I6h', 'ชื่อแบบเดิมซ้ำในใบเดียว = แก้รายการเดิม ไม่สร้างซ้ำ · id เดิม · qty 9', (r2 ->> 'id') = (r ->> 'id') and (r2 ->> 'qty_planned')::int = 9
      and (select count(*) from analytics.production_order_item where production_order_id = o and pending_product_label = 'แหวนทดลองลายใบไม้') = 1);
    r3 := pg_temp.iset(v_shop, pg_temp.po(v_shop, 'I6i'), null, 1, 'แหวนทดลองลายใบไม้', 'silver');
    v := v || pg_temp.chk('I6i', 'ชื่อแบบเดียวกันในใบอื่น = รายการของใบนั้น (unique เฉพาะในใบเดียว)', (r3 ->> 'id') is not null and (r3 ->> 'id') <> (r ->> 'id'));
    v := v || pg_temp.chk('I6j', 'รายการไม่มี SKU ไม่ระบุโลหะ ตก metal_required (ไม่เดา)', pg_temp.hint(pg_temp.iset(v_shop, o, null, 1, 'ไม่ระบุโลหะ', null)) = '22023|metal_required');
    v := v || pg_temp.chk('I6k', 'ชื่อแบบตัวพิมพ์ต่าง (ภาษาละติน) ในใบเดียว = รายการเดิม (lower)', (pg_temp.iset(v_shop, o, null, 1, 'Ring Test', 'silver') ->> 'id') = (pg_temp.iset(v_shop, o, null, 2, 'RING TEST', 'silver') ->> 'id'));
    -- I8 CHECK ตรง
    v := v || pg_temp.chk('I8a', 'CHECK ตรง: แถวที่มีทั้ง product_id และชื่อแบบ ตก 23514', pg_temp.err(format('insert into analytics.production_order_item (production_order_id, product_id, pending_product_label, qty_planned, metal, purity) values (%L, %L, %L, 1, %L, 0.925)', o, p_fixa, 'x', 'silver')) like '23514|%');
    v := v || pg_temp.chk('I8b', 'CHECK ตรง: แถวที่ไม่มีทั้งสอง ตก 23514', pg_temp.err(format('insert into analytics.production_order_item (production_order_id, qty_planned, metal, purity) values (%L, 1, %L, 0.925)', o, 'silver')) like '23514|%');
    v := v || pg_temp.chk('I8c', 'CHECK ตรง: ชื่อแบบซ้ำ (ตัวพิมพ์ต่าง) ในใบเดียวตก 23505 (unique index)', pg_temp.err(format('insert into analytics.production_order_item (production_order_id, pending_product_label, qty_planned, metal, purity) values (%L, %L, 1, %L, 0.925)', o, 'แหวนทดลองลายใบไม้', 'silver')) like '23505|%');
    v := v || pg_temp.chk('I8d', 'CHECK ตรง: รายการไม่มี SKU ไม่มีโลหะ ตก 23514 (production_order_item_pending_metal_ck)', pg_temp.err(format('insert into analytics.production_order_item (production_order_id, pending_product_label, qty_planned) values (%L, %L, 1)', o, 'ไม่มีโลหะ')) like '23514|%');
    perform analytics.production_order_item_remove_by_id(v_shop, o, (r ->> 'id')::uuid);
    v := v || pg_temp.chk('I8e', 'ลบรายการไม่มี SKU ด้วย id ได้ (production_order_item_remove เดิมลบด้วย product_id ไม่ได้)', not exists (select 1 from analytics.production_order_item where id = (r ->> 'id')::uuid));

    -- I9 ไม่ส่งค่าใหม่ = ค่าที่ helper คืน (ใบเงินที่ออฟฟิศเปิดแบบเดิม · 4/5 arg เดิม)
    o2 := pg_temp.po(v_shop, 'I9');
    r := pg_temp.q(format('select analytics.production_order_item_set(%L, %L, %L, 5)', v_shop, o2, p_fixa));
    v := v || pg_temp.chk('I9a', 'เรียกแบบเดิม 4 arg กับ SKU fixed → เงิน · เนื้อ 0.925 (ไม่มีเนื้อใน SKU) · น้ำหนัก null · ไม่พัง', (r ->> 'metal') = 'silver' and (r ->> 'purity')::numeric = 0.925 and (r ->> 'weight_g') is null and (r ->> 'weight_source') is null and (r ->> 'qty_planned')::int = 5);
    r := pg_temp.q(format('select analytics.production_order_item_set(%L, %L, %L, 3, false)', v_shop, o2, p_bar));
    v := v || pg_temp.chk('I9b', 'เรียกแบบเดิม 5 arg กับ SKU spot แท่ง → เงิน · เนื้อ 0.999 · น้ำหนัก 152.440 ที่มา product', (r ->> 'metal') = 'silver' and (r ->> 'purity')::numeric = 0.999 and (r ->> 'weight_g')::numeric = 152.44 and (r ->> 'weight_source') = 'product');
    r := pg_temp.q(format('select analytics.production_order_item_set(%L, %L, %L, 7)', v_shop, o2, p_spot));
    v := v || pg_temp.chk('I9c', 'SKU spot 10g .925 → เงิน · 0.925 · 10 · product', (r ->> 'purity')::numeric = 0.925 and (r ->> 'weight_g')::numeric = 10 and (r ->> 'weight_source') = 'product');
    r := pg_temp.q(format('select analytics.production_order_item_set(%L, %L, %L, 7, true)', v_shop, o2, p_spot));
    v := v || pg_temp.chk('I9d', 'แก้ qty/แบบใหม่ซ้ำ (ไม่ส่งโลหะ/เนื้อ/น้ำหนัก) → ค่า 3 ตัวคงเดิม (null = ไม่แตะ) · is_new_design ตามที่ส่ง', (r ->> 'weight_g')::numeric = 10 and (r ->> 'purity')::numeric = 0.925 and (r ->> 'metal') = 'silver' and (r ->> 'is_new_design') = 'true');
    r := pg_temp.q(format('select analytics.production_order_item_set(%L, %L, %L, 8)', v_shop, o2, p_spot));
    v := v || pg_temp.chk('I9e', 'แก้ qty อย่างเดียวซ้ำ (ไม่ส่ง is_new_design) → is_new_design ยังเป็น true (ไม่ถูกรีเซ็ต · แพทเทิร์น 0144) · SKU live*/ปิดใช้งานใส่ไม่ได้ (ด่านเดิม)',
      (r ->> 'is_new_design') = 'true' and pg_temp.hint(pg_temp.q(format('select analytics.production_order_item_set(%L, %L, %L, 1)', v_shop, o2, p_live))) like '22023|%'
      and pg_temp.hint(pg_temp.q(format('select analytics.production_order_item_set(%L, %L, %L, 1)', v_shop, o2, p_off))) like '22023|%');

    -- I11 เปลี่ยนโลหะ/ล้างค่า (ยังไม่มีใบงาน)
    o2 := pg_temp.po(v_shop, 'I11');
    perform pg_temp.iset(v_shop, o2, p_spot, 2);   -- เงิน .925 น้ำหนัก 10 (จาก SKU)
    r := pg_temp.iset(v_shop, o2, p_spot, 2, null, 'gold', 0.9);
    v := v || pg_temp.chk('I11a', 'เปลี่ยนเงิน→ทอง ส่ง purity 0.9: น้ำหนักที่มาจาก SKU (เงินเท่านั้น) ถูกล้าง · ไม่ติดไปเป็นน้ำหนักทอง', (r ->> 'metal') = 'gold' and (r ->> 'purity')::numeric = 0.9 and (r ->> 'weight_g') is null and (r ->> 'weight_source') is null);
    o3 := pg_temp.po(v_shop, 'I11b');
    perform pg_temp.iset(v_shop, o3, p_spot, 2);
    v := v || pg_temp.chk('I11b', 'เปลี่ยนเงิน→ทองแต่ไม่ส่ง purity ตก gold_purity_required (ไม่คงเนื้อเงิน 0.925 มาเป็นเนื้อทอง) · รายการเดิมยังเป็นเงิน',
      pg_temp.hint(pg_temp.iset(v_shop, o3, p_spot, 2, null, 'gold')) = '22023|gold_purity_required'
      and (select metal from analytics.production_order_item where production_order_id = o3 and product_id = p_spot) = 'silver');
    r := pg_temp.iset(v_shop, o2, p_spot, 2, null, 'brass');
    v := v || pg_temp.chk('I11b2', 'เปลี่ยนทอง→ทองเหลือง (ไม่ส่ง purity): เนื้อล็อก 1.0', (r ->> 'metal') = 'brass' and (r ->> 'purity')::numeric = 1);
    r := pg_temp.iset(v_shop, o2, p_spot, 2, null, 'silver');
    v := v || pg_temp.chk('I11c', 'ทองเหลือง→เงิน (ไม่ส่ง purity): เนื้อรีเซ็ตเป็นค่าเริ่มของเงินตาม SKU (0.925) ไม่ใช่ 1.0 ของทองเหลือง', (r ->> 'metal') = 'silver' and (r ->> 'purity')::numeric = 0.925);
    r := pg_temp.iset(v_shop, o2, p_spot, 2, null, null, null, 4.5, 'input');
    r2 := pg_temp.iset(v_shop, o2, p_spot, 2, null, 'gold', 0.75);
    v := v || pg_temp.chk('I11d', 'น้ำหนักที่พิมพ์เอง (input) คงไว้เมื่อเปลี่ยนโลหะ (เฉพาะน้ำหนักที่มาจาก SKU เท่านั้นที่ล้าง)', (r2 ->> 'weight_g')::numeric = 4.5 and (r2 ->> 'weight_source') = 'input');
    r := pg_temp.iset(v_shop, o2, p_spot, 2, null, null, null, null, null, true);
    v := v || pg_temp.chk('I11e', 'p_clear_weight ล้างน้ำหนัก+ที่มาได้ · ส่งน้ำหนักพร้อมสั่งล้างตก', (r ->> 'weight_g') is null and (r ->> 'weight_source') is null
      and pg_temp.hint(pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>%L, p_qty_planned=>2, p_weight_g=>3, p_weight_source=>%L, p_clear_weight=>true)', v_shop, o2, p_spot, 'input'))) = '22023|weight_invalid');
  exception when others then
    v := v || pg_temp.chk('I-crash', 'กลุ่ม I raise: ' || sqlstate || ' ' || sqlerrm, false);
  end;
  return v;
end;
$c$;

-- ============================================================================
-- D. preview / done — ต่อโลหะ · sku_required · ไม่ fallback ราคา · M1 · override · ต้นทุน · น้ำหนัก · ยิงของใหม่ใส่ของเก่า
-- ============================================================================
create function pg_temp.g_done() returns text
 language plpgsql as $c$
declare
  v text := '';
  v_shop uuid := pg_temp.fx('shop');
  p_fixa uuid := pg_temp.fx('fixa'); p_fixb uuid := pg_temp.fx('fixb'); p_spot uuid := pg_temp.fx('spot'); p_bar uuid := pg_temp.fx('bar'); p_spec uuid := pg_temp.fx('spec');
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_gold numeric := analytics.production_metal_price_resolve(pg_temp.fx('shop'), 'gold', null);
  v_brass numeric := analytics.production_metal_price_resolve(pg_temp.fx('shop'), 'brass', null);
  o uuid; o2 uuid; o3 uuid; i1 uuid; r jsonb; r2 jsonb; r3 jsonb; it jsonb;
  v_md5a text; v_md5b text; v_n int; v_num numeric; v_num2 numeric;
  v_spec jsonb; v_raw jsonb; v_exp_unit numeric;
begin
  -- D1 รายการไม่มี SKU: preview/done ปฏิเสธ sku_required ก่อนเข้าเส้นต้นทุน (สต็อก/lot ไม่ขยับ)
  begin
    o := pg_temp.po(v_shop, 'D1');
    i1 := (pg_temp.iset(v_shop, o, null, 2, 'D1 ไม่มี SKU', 'silver') ->> 'id')::uuid;
    perform pg_temp.iset(v_shop, o, p_fixa, 3);
    v := v || pg_temp.chk('D1a', 'preview ใบที่มีรายการไม่มี SKU ตก sku_required', pg_temp.hint(pg_temp.pv(v_shop, o)) = '22023|sku_required');
    v := v || pg_temp.chk('D1b', 'done ใบที่มีรายการไม่มี SKU ตก sku_required (แม้อีกรายการมี SKU ครบ)', pg_temp.hint(pg_temp.dn(v_shop, o, null, null)) = '22023|sku_required');
    v := v || pg_temp.chk('D1c', 'ตกแล้วไม่มี lot · สต็อก fixa ไม่ขยับ (0) · ใบยัง open', pg_temp.lots(o) = 0 and pg_temp.stock(p_fixa) = 0 and (select status from analytics.production_order where id = o) = 'open');
    o2 := pg_temp.po(v_shop, 'D1d');
    perform pg_temp.iset(v_shop, o2, null, 1, 'D1d เดี่ยว', 'gold', 0.9);
    v := v || pg_temp.chk('D1d', 'ใบที่มีแต่รายการไม่มี SKU: done/preview ตก sku_required (ไม่ใช่ "ใบว่าง")', pg_temp.hint(pg_temp.dn(v_shop, o2, null, null)) = '22023|sku_required' and pg_temp.hint(pg_temp.pv(v_shop, o2)) = '22023|sku_required');
    perform analytics.production_order_item_remove_by_id(v_shop, o, i1);
    r := pg_temp.pv(v_shop, o);
    r2 := pg_temp.dn(v_shop, o, null, null);
    v := v || pg_temp.chk('D1e', 'ลบรายการไม่มี SKU ออกแล้ว preview/done ผ่าน (ใบเงิน fixed ล้วน ไม่ต้องส่งราคา) · lot 1 · ต้นทุน 88 · สต็อก 3 (ต้องไม่พัง)',
      r ? 'items' and r2 ->> 'status' = 'done' and pg_temp.lots(o) = 1 and pg_temp.lot_cost(o, p_fixa) = 88 and pg_temp.stock(p_fixa) = 3);
    raise exception 'rb_186';
  exception when others then
    if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('D1-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- D2 ไม่มีราคาทองของวันนี้ (เหลือแถว 25 ส.ค. เก่า + แถวย้อนหลังจากกลุ่ม G) → ห้าม fallback · preview คืน missing_prices (R3)
  begin
    delete from analytics.oem_metal_price where shop_id = v_shop and metal = 'gold' and as_of_date = v_today;
    o := pg_temp.po(v_shop, 'D2');
    perform pg_temp.iset(v_shop, o, p_spot, 5, null, 'gold', 0.9, 3.2, 'input');   -- ทองบน SKU spot = ต้องใช้ราคาทอง
    perform pg_temp.iset(v_shop, o, p_bar, 2);                                       -- เงินแท่ง spot
    perform pg_temp.iset(v_shop, o, p_fixa, 1, null, 'gold', 0.9);                   -- ทองบน SKU fixed = ไม่ใช้ราคาทอง (ต้นทุนเดิมจากแคตตาล็อก)
    r := pg_temp.pv(v_shop, o);
    v := v || pg_temp.chk('D2a', 'preview ไม่ raise · missing_prices = ["gold"] · metal_prices มีแต่เงิน (ไม่มี key gold) · spot_price = 72', (r -> 'missing_prices') = '["gold"]'::jsonb and jsonb_exists(r -> 'metal_prices', 'silver') and not jsonb_exists(r -> 'metal_prices', 'gold') and (r ->> 'spot_price_thb_per_gram')::numeric = 72);
    v := v || pg_temp.chk('D2b', 'ทอง spot: price_missing=true ไม่มีต้นทุน (ไม่เดา) · เงินแท่งคิดได้ round(152.44×72×0.999,2) · ทอง fixed ต้นทุน 88',
      (pg_temp.pitem(r, 'ZZ186-SPOT') ->> 'price_missing') = 'true' and (pg_temp.pitem(r, 'ZZ186-SPOT') -> 'unit_cost') = 'null'::jsonb
      and (pg_temp.pitem(r, 'ZZ186-BAR') ->> 'unit_cost')::numeric = round(152.44 * 72 * 0.999, 2) and (pg_temp.pitem(r, 'ZZ186-FIXA') ->> 'unit_cost')::numeric = 88);
    v := v || pg_temp.chk('D2c', 'done ปิดใบทองวันที่ไม่มีราคา ตก metal_price_missing — ไม่ fallback ไปแถว 25 ส.ค. (4736) · ไม่มี lot · สต็อกไม่ขยับ',
      pg_temp.hint(pg_temp.dn(v_shop, o, null, jsonb_build_object('silver', 72, 'gold', 4736))) = '22023|metal_price_missing' and pg_temp.lots(o) = 0 and pg_temp.stock(p_bar) = 0);
    v := v || pg_temp.chk('D2d', 'done ที่ไม่ส่งราคาทองมาเลย ก็ตก metal_price_missing เช่นกัน (resolve มาก่อนเทียบ M1)', pg_temp.hint(pg_temp.dn(v_shop, o, null, jsonb_build_object('silver', 72))) = '22023|metal_price_missing');
    o2 := pg_temp.po(v_shop, 'D2e');
    perform pg_temp.iset(v_shop, o2, p_spot, 5, null, 'gold', 0.9, 3.2, 'input');
    v := v || pg_temp.chk('D2e', 'ใบทองล้วนไม่มีราคาวันนี้ done ตก · preview ไม่มี key เงิน (ไม่ resolve เงิน) · spot_price null', pg_temp.hint(pg_temp.dn(v_shop, o2, null, '{}'::jsonb)) = '22023|metal_price_missing'
      and (pg_temp.pv(v_shop, o2) -> 'metal_prices') = '{}'::jsonb and (pg_temp.pv(v_shop, o2) -> 'spot_price_thb_per_gram') = 'null'::jsonb);
    o3 := pg_temp.po(v_shop, 'D2f');
    perform pg_temp.iset(v_shop, o3, p_fixa, 2, null, 'gold', 0.9);
    r2 := pg_temp.dn(v_shop, o3, null, null);
    v := v || pg_temp.chk('D2f', 'ใบทองบน SKU fixed (ไม่ใช้ราคาทอง) ปิดได้แม้ไม่มีราคาทอง — ต้นทุนเดิมจากแคตตาล็อก 88 · stamp metal=gold (ต้องไม่พัง)', r2 ->> 'status' = 'done' and pg_temp.lot_cost(o3, p_fixa) = 88
      and (select metal from analytics.production_order_item where production_order_id = o3) = 'gold');
    perform analytics.oem_metal_price_set_input(v_shop, 'gold', 41250, 'assoc965_sell_per_baht');
    r := pg_temp.pv(v_shop, o);
    v := v || pg_temp.chk('D2g', 'กรอกราคาทองวันนี้แล้ว preview หาย missing_prices · ทอง spot คิดต้นทุนได้', (r -> 'missing_prices') = '[]'::jsonb and (pg_temp.pitem(r, 'ZZ186-SPOT') ->> 'unit_cost')::numeric = round(3.2 * v_gold * 0.9 + 20, 2));
    raise exception 'rb_186';
  exception when others then
    if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('D2-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- D3 M1 fail-closed ต่อโลหะ (ใบผสม เงิน + ทอง) · D9 product ไม่ถูกเขียนกลับ
  begin
    v_md5a := pg_temp.catalog_md5(v_shop);
    o := pg_temp.po(v_shop, 'D3');
    perform pg_temp.iset(v_shop, o, p_spot, 5, null, 'gold', 0.9, 3.2, 'input');
    perform pg_temp.iset(v_shop, o, p_bar, 2);
    perform pg_temp.iset(v_shop, o, null, 1, 'D3 ชื่อแบบไม่เข้าแคตตาล็อก', 'silver');
    r := pg_temp.pv(v_shop, o);
    v := v || pg_temp.chk('D3pre', 'ใบที่มีรายการไม่มี SKU ตก sku_required (ต้องถอดก่อนเทียบราคา)', pg_temp.hint(r) = '22023|sku_required');
    perform analytics.production_order_item_remove_by_id(v_shop, o, (select id from analytics.production_order_item where production_order_id = o and product_id is null));
    r := pg_temp.pv(v_shop, o);
    v := v || pg_temp.chk('D3a', 'preview ใบผสม: metal_prices = {silver:72, gold:2804.1271} · missing_prices ว่าง · spot_price = 72',
      (r -> 'metal_prices' ->> 'silver')::numeric = 72 and (r -> 'metal_prices' ->> 'gold')::numeric = v_gold and (r -> 'missing_prices') = '[]'::jsonb and (r ->> 'spot_price_thb_per_gram')::numeric = 72 and v_gold = 2804.1271);
    v := v || pg_temp.chk('D3b', 'done ไม่ส่งราคา (null) ตก expected_prices_required', pg_temp.hint(pg_temp.dn(v_shop, o, null, null)) = '22023|expected_prices_required');
    v := v || pg_temp.chk('D3c', 'done ส่งเฉพาะเงิน (ขาดทอง) ตก expected_prices_required', pg_temp.hint(pg_temp.dn(v_shop, o, null, jsonb_build_object('silver', 72))) = '22023|expected_prices_required');
    v := v || pg_temp.chk('D3d', 'done ส่งเฉพาะทอง (ขาดเงิน) ตก expected_prices_required', pg_temp.hint(pg_temp.dn(v_shop, o, null, jsonb_build_object('gold', v_gold))) = '22023|expected_prices_required');
    v := v || pg_temp.chk('D3e', 'done ราคาทองต่าง 0.01 ตก metal_price_changed · ราคาเงินต่าง 0.0002 ตก (เกิน 0.0001)',
      pg_temp.hint(pg_temp.dn(v_shop, o, null, jsonb_build_object('silver', 72, 'gold', v_gold + 0.01))) = '22023|metal_price_changed'
      and pg_temp.hint(pg_temp.dn(v_shop, o, null, jsonb_build_object('silver', 72.0002, 'gold', v_gold))) = '22023|metal_price_changed');
    v := v || pg_temp.chk('D3f', 'done ราคาเป็นสตริง JSON ("72") ตก expected_prices_required (ไม่ใช่ number)', pg_temp.hint(pg_temp.dn(v_shop, o, null, jsonb_build_object('silver', '72', 'gold', v_gold::text))) = '22023|expected_prices_required');
    v := v || pg_temp.chk('D3g', 'done มี key เกิน (brass) ตก expected_prices_extra', pg_temp.hint(pg_temp.dn(v_shop, o, null, jsonb_build_object('silver', 72, 'gold', v_gold, 'brass', 0.35))) = '22023|expected_prices_extra');
    v := v || pg_temp.chk('D3h', 'done ส่ง array แทน object ตก expected_prices_invalid', pg_temp.hint(pg_temp.dn(v_shop, o, null, '[72]'::jsonb)) = '22023|expected_prices_invalid');
    v := v || pg_temp.chk('D3i', 'ตกทุกเคส D3b-D3h แล้วไม่มี lot · ใบยัง open · สต็อกไม่ขยับ', pg_temp.lots(o) = 0 and (select status from analytics.production_order where id = o) = 'open' and pg_temp.stock(p_bar) = 0 and pg_temp.stock(p_spot) = 0);
    r2 := pg_temp.dn(v_shop, o, null, jsonb_build_object('silver', 72.00005, 'gold', v_gold));
    v := v || pg_temp.chk('D3j', 'done ส่งราคาถูกต้อง (เงินต่างในเกณฑ์ 0.00005 ≤ 0.0001) ผ่าน · done · lot 2 · ต้นทุนทอง = round(3.2×G×0.9+20,2) · เงินแท่ง = round(152.44×72×0.999,2)',
      r2 ->> 'status' = 'done' and pg_temp.lots(o) = 2 and pg_temp.lot_cost(o, p_spot) = round(3.2 * v_gold * 0.9 + 20, 2) and pg_temp.lot_cost(o, p_bar) = round(152.44 * 72 * 0.999, 2)
      and (r2 -> 'metal_prices' ->> 'gold')::numeric = v_gold);
    r3 := pg_temp.dn(v_shop, o, null, null);
    v := v || pg_temp.chk('D3k', 'done ซ้ำ → already_done ไม่สร้าง lot ซ้ำ ไม่ต้องส่งราคา', (r3 ->> 'already_done') = 'true' and pg_temp.lots(o) = 2);
    v := v || pg_temp.chk('D3l', 'stamp snapshot ลงรายการ: ทอง (gold · 0.9000 · 3.200 · input) · เงินแท่ง (silver · 0.9990 · 152.440 · product)',
      exists (select 1 from analytics.production_order_item i where i.production_order_id = o and i.product_id = p_spot and i.metal = 'gold' and i.purity = 0.9 and i.weight_g = 3.2 and i.weight_source = 'input')
      and exists (select 1 from analytics.production_order_item i where i.production_order_id = o and i.product_id = p_bar and i.metal = 'silver' and i.purity = 0.999 and i.weight_g = 152.44 and i.weight_source = 'product'));
    v_md5b := pg_temp.catalog_md5(v_shop);
    v := v || pg_temp.chk('D9a', 'product ไม่ถูกเขียนกลับ: md5 คอลัมน์ catalog (ชื่อ/ต้นทุน/น้ำหนักเงิน/เนื้อเงิน/make_spec/labor/ราคา) ก่อน-หลัง item_set+preview+done เท่าเดิมเป๊ะ', v_md5a = v_md5b and v_md5a <> '');
    v := v || pg_temp.chk('D9b', 'ชื่อแบบของรายการไม่มี SKU ไม่เข้า catalog (ไม่มี product ที่ name/sku = ชื่อแบบ)', not exists (select 1 from public.product where shop_id = v_shop and (name like 'D3 ชื่อแบบ%' or sku like 'D3 ชื่อแบบ%')));
    v := v || pg_temp.chk('D9c', 'done เขียน product แค่ track_stock/track_stock_since ตามเดิม (spot/bar เปิด track_stock)', (select count(*) from public.product where shop_id = v_shop and track_stock) = 2);
    raise exception 'rb_186';
  exception when others then
    if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('D3-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- D4 override ของใบ = เงินเท่านั้น (ใบผสมเงิน+ทอง)
  begin
    o := pg_temp.po(v_shop, 'D4', 66.5);
    perform pg_temp.iset(v_shop, o, p_bar, 2);
    perform pg_temp.iset(v_shop, o, p_spot, 5, null, 'gold', 0.9, 3.2, 'input');
    r := pg_temp.pv(v_shop, o);
    v := v || pg_temp.chk('D4a', 'ใบผสม override 66.5: เงินใช้ 66.5 · ทองใช้ราคาทองวันนี้ ไม่ใช่ 66.5 · spot_price = 66.5', (r -> 'metal_prices' ->> 'silver')::numeric = 66.5 and (r -> 'metal_prices' ->> 'gold')::numeric = v_gold and (r ->> 'spot_price_thb_per_gram')::numeric = 66.5);
    v := v || pg_temp.chk('D4b', 'done ส่งราคาเงินตลาด 72 (ไม่ใช่ override ที่ใบใช้จริง 66.5) ตก metal_price_changed', pg_temp.hint(pg_temp.dn(v_shop, o, null, jsonb_build_object('silver', 72, 'gold', v_gold))) = '22023|metal_price_changed');
    r2 := pg_temp.dn(v_shop, o, null, jsonb_build_object('silver', 66.5, 'gold', v_gold));
    v := v || pg_temp.chk('D4c', 'done ด้วยราคาที่ใบใช้จริง: เงินแท่ง = round(152.44×66.5×0.999,2) (override) · ทอง = round(3.2×G×0.9+20,2) (ไม่ใช้ override)', r2 ->> 'status' = 'done' and pg_temp.lot_cost(o, p_bar) = round(152.44 * 66.5 * 0.999, 2) and pg_temp.lot_cost(o, p_spot) = round(3.2 * v_gold * 0.9 + 20, 2));
    o2 := pg_temp.po(v_shop, 'D4d', 66.5);
    perform pg_temp.iset(v_shop, o2, p_spot, 5, null, 'gold', 0.9, 3.2, 'input');
    r := pg_temp.pv(v_shop, o2);
    v := v || pg_temp.chk('D4d', 'ใบทองล้วนที่ตั้ง override เงินไว้: ไม่ resolve เงิน (metal_prices มีแต่ทอง · spot_price null) · done ผ่านด้วย {gold}', not jsonb_exists(r -> 'metal_prices', 'silver') and (r -> 'spot_price_thb_per_gram') = 'null'::jsonb
      and (pg_temp.dn(v_shop, o2, null, jsonb_build_object('gold', v_gold)) ->> 'status') = 'done');
    raise exception 'rb_186';
  exception when others then
    if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('D4-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- D5 ใบ fixed ล้วน: ส่ง null หรือ {} ผ่าน · ส่งราคาเกินตก
  begin
    o := pg_temp.po(v_shop, 'D5a'); perform pg_temp.iset(v_shop, o, p_fixa, 2); perform pg_temp.iset(v_shop, o, p_fixb, 3);
    v := v || pg_temp.chk('D5a', 'ใบ fixed ล้วน done ด้วย {silver:72} (key เกิน) ตก expected_prices_extra', pg_temp.hint(pg_temp.dn(v_shop, o, null, jsonb_build_object('silver', 72))) = '22023|expected_prices_extra' and pg_temp.lots(o) = 0);
    r := pg_temp.dn(v_shop, o, null, '{}'::jsonb);
    v := v || pg_temp.chk('D5b', 'ใบ fixed ล้วน done ด้วย {} ผ่าน · ต้นทุน 88 / 50', r ->> 'status' = 'done' and pg_temp.lot_cost(o, p_fixa) = 88 and pg_temp.lot_cost(o, p_fixb) = 50);
    o2 := pg_temp.po(v_shop, 'D5c'); perform pg_temp.iset(v_shop, o2, p_fixa, 2);
    r := pg_temp.dn(v_shop, o2, null, null);
    v := v || pg_temp.chk('D5c', 'ใบ fixed ล้วน done ด้วย null ผ่าน (พฤติกรรมเดิม)', r ->> 'status' = 'done' and pg_temp.lot_cost(o2, p_fixa) = 88);
    raise exception 'rb_186';
  exception when others then
    if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('D5-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- D6 ต้นทุนถูก: ทองเหลือง spot · ทอง fixed ต้นทุนเดิม · เงิน spot แบบเดิม · stamp
  begin
    o := pg_temp.po(v_shop, 'D6');
    perform pg_temp.iset(v_shop, o, p_spot, 4, null, 'brass', null, 5, 'input');
    perform pg_temp.iset(v_shop, o, p_fixa, 3, null, 'gold', 0.75);
    perform pg_temp.iset(v_shop, o, p_fixb, 2);
    r := pg_temp.pv(v_shop, o);
    v := v || pg_temp.chk('D6a', 'ทองเหลือง spot (5 g/ชิ้น เนื้อ 1.0) preview = round(5×0.35×1.0+20,2) = 21.75 · ใช้ราคาทองเหลืองของวันนี้', (pg_temp.pitem(r, 'ZZ186-SPOT') ->> 'unit_cost')::numeric = round(5 * v_brass * 1.0 + 20, 2) and round(5 * v_brass * 1.0 + 20, 2) = 21.75
      and (r -> 'metal_prices' ->> 'brass')::numeric = v_brass);
    v := v || pg_temp.chk('D6b', 'ทองบน SKU fixed: ต้นทุนไม่เปลี่ยนตามโลหะ = 88 (เจ้าของยอมรับ — มติ Q4)', (pg_temp.pitem(r, 'ZZ186-FIXA') ->> 'unit_cost')::numeric = 88 and (pg_temp.pitem(r, 'ZZ186-FIXA') ->> 'metal') = 'gold');
    r2 := pg_temp.dn(v_shop, o, null, jsonb_build_object('brass', v_brass));
    v := v || pg_temp.chk('D6c', 'done ใบทองเหลือง+ทอง fixed+เงิน fixed: lot ต้นทุน 21.75 / 88 / 50 · metal_prices ที่ใช้ = {brass}', r2 ->> 'status' = 'done' and pg_temp.lot_cost(o, p_spot) = 21.75 and pg_temp.lot_cost(o, p_fixa) = 88 and pg_temp.lot_cost(o, p_fixb) = 50
      and (r2 -> 'metal_prices') = jsonb_build_object('brass', v_brass));
    v := v || pg_temp.chk('D6d', 'stamp ทุกรายการ: ทองเหลือง (brass · 1.0000 · 5.000 · input) · ทอง fixed (gold · 0.7500 · น้ำหนักว่าง) · เงิน fixed (silver · 0.9250 · ว่าง) · cost_calc ของ spot/fixed ไม่ใช่ object (เป็น JSON null — ข้อ 13)',
      exists (select 1 from analytics.production_order_item i where i.production_order_id = o and i.product_id = p_spot and i.metal = 'brass' and i.purity = 1 and i.weight_g = 5 and i.weight_source = 'input' and jsonb_typeof(i.cost_calc) is distinct from 'object')
      and exists (select 1 from analytics.production_order_item i where i.production_order_id = o and i.product_id = p_fixa and i.metal = 'gold' and i.purity = 0.75 and i.weight_g is null and i.weight_source is null)
      and exists (select 1 from analytics.production_order_item i where i.production_order_id = o and i.product_id = p_fixb and i.metal = 'silver' and i.purity = 0.925 and i.weight_g is null));
    o2 := pg_temp.po(v_shop, 'D6e');
    perform pg_temp.iset(v_shop, o2, p_spot, 3);
    r := pg_temp.dn(v_shop, o2, null, jsonb_build_object('silver', 72));
    v := v || pg_temp.chk('D6e', 'เงิน spot แบบเดิม (ไม่ส่งโลหะ/เนื้อ/น้ำหนัก): lot = round(10×72×0.925+20,2) = 686.00 เท่าฉบับเดิม', r ->> 'status' = 'done' and pg_temp.lot_cost(o2, p_spot) = round(10 * 72 * 0.925 + 20, 2) and round(10 * 72 * 0.925 + 20, 2) = 686.00);
    raise exception 'rb_186';
  exception when others then
    if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('D6-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- D7 spec (oem_cost_calc) ทุกโลหะ — เทียบสูตรอิสระเรียก oem_cost_calc ตรง
  begin
    -- เงิน: ค่าเริ่มจากสเปค/SKU (3.5 g · 0.925 · is_new_design false)
    o := pg_temp.po(v_shop, 'D7');
    r := pg_temp.iset(v_shop, o, p_spec, 5);
    v := v || pg_temp.chk('D7pre', 'spec SKU ใส่ใบ: โลหะ = silver (make_spec) · เนื้อ 0.925 · น้ำหนัก 3.5 จาก SKU (product)', (r ->> 'metal') = 'silver' and (r ->> 'purity')::numeric = 0.925 and (r ->> 'weight_g')::numeric = 3.5 and (r ->> 'weight_source') = 'product');
    select s.make_spec into v_spec from public.product s where s.id = p_spec;
    v_raw := analytics.oem_cost_calc(v_shop, v_spec || jsonb_build_object('metal', 'silver', 'qty', 5, 'weight_g', 3.5, 'purity', 0.925, 'is_new_design', false, 'metal_price_thb_per_gram', 72, 'as_of_date', v_today)) -> '_raw';
    v_exp_unit := round((v_raw ->> 'cost_piece')::numeric + coalesce((v_raw ->> 'nre_cost')::numeric, 0) / 5, 2);
    r := pg_temp.pv(v_shop, o);
    v := v || pg_temp.chk('D7a', 'spec เงิน: unit_cost = ผลสูตรอิสระ oem_cost_calc ตรง (' || v_exp_unit || ') · cost_calc.metal = silver',
      (pg_temp.pitem(r, 'ZZ186-SPEC') ->> 'unit_cost')::numeric = v_exp_unit and (pg_temp.pitem(r, 'ZZ186-SPEC') -> 'cost_calc' ->> 'metal') = 'silver' and (pg_temp.pitem(r, 'ZZ186-SPEC') -> 'cost_calc' ->> 'is_complete') = 'true');
    -- ทอง: โลหะของรายการทับ make_spec (เนื้อ 0.9 · 3.2 g · ราคาทอง G)
    r2 := pg_temp.iset(v_shop, o, p_spec, 5, null, 'gold', 0.9, 3.2, 'input');
    v_raw := analytics.oem_cost_calc(v_shop, v_spec || jsonb_build_object('metal', 'gold', 'qty', 5, 'weight_g', 3.2, 'purity', 0.9, 'is_new_design', false, 'metal_price_thb_per_gram', v_gold, 'as_of_date', v_today)) -> '_raw';
    v_exp_unit := round((v_raw ->> 'cost_piece')::numeric + coalesce((v_raw ->> 'nre_cost')::numeric, 0) / 5, 2);
    r := pg_temp.pv(v_shop, o);
    v := v || pg_temp.chk('D7b', 'spec ทอง (โลหะรายการทับ make_spec เงิน): unit_cost = oem_cost_calc อิสระ metal=gold (' || v_exp_unit || ') · cost_calc.metal=gold purity=0.9 · ใช้ราคาทอง ไม่ใช่เงิน',
      (pg_temp.pitem(r, 'ZZ186-SPEC') ->> 'unit_cost')::numeric = v_exp_unit and (pg_temp.pitem(r, 'ZZ186-SPEC') -> 'cost_calc' ->> 'metal') = 'gold'
      and (pg_temp.pitem(r, 'ZZ186-SPEC') -> 'cost_calc' ->> 'purity')::numeric = 0.9 and (pg_temp.pitem(r, 'ZZ186-SPEC') -> 'cost_calc' ->> 'metal_price_thb_per_gram')::numeric = v_gold
      and (r -> 'metal_prices') = jsonb_build_object('gold', v_gold));
    r3 := pg_temp.dn(v_shop, o, null, jsonb_build_object('gold', v_gold));
    v := v || pg_temp.chk('D7c', 'done spec ทอง: lot = ค่าเดียวกับ preview · snapshot cost_calc ลงรายการ (metal=gold)', r3 ->> 'status' = 'done' and pg_temp.lot_cost(o, p_spec) = v_exp_unit
      and (select cost_calc ->> 'metal' from analytics.production_order_item where production_order_id = o) = 'gold');
    raise exception 'rb_186';
  exception when others then
    if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('D7-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    -- rate ทอง (scope gold) ว่าง → is_complete=false → raise พร้อม missing (case 10)
    delete from analytics.oem_cost_rate where shop_id = v_shop and rate_key = 'sprue_loss_pct' and scope = 'gold';
    o := pg_temp.po(v_shop, 'D7d');
    perform pg_temp.iset(v_shop, o, p_spec, 5, null, 'gold', 0.9, 3.2, 'input');
    r := pg_temp.pv(v_shop, o);
    v := v || pg_temp.chk('D7d', 'spec ทองแต่ rate sprue_loss_pct[gold] ว่าง: preview/done ตก 22023 "คำนวณต้นทุนไม่ครบ" ไม่ปล่อยต้นทุนไม่ครบ · ไม่มี lot',
      r ->> '_state' = '22023' and (r ->> '_err') like '%คำนวณต้นทุนไม่ครบ%' and pg_temp.dn(v_shop, o, null, jsonb_build_object('gold', v_gold)) ->> '_state' = '22023' and pg_temp.lots(o) = 0);
    raise exception 'rb_186';
  exception when others then
    if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('D7d-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- D8 น้ำหนักว่างใน spot/spec ต้องปฏิเสธ · fixed ไม่ต้องมีน้ำหนัก
  begin
    o := pg_temp.po(v_shop, 'D8a');
    r := pg_temp.iset(v_shop, o, p_spot, 2, null, 'gold', 0.9);
    v := v || pg_temp.chk('D8pre', 'ทองบน SKU spot ไม่ส่งน้ำหนัก: น้ำหนัก SKU (เงิน 10 g) ไม่ติดมาเป็นน้ำหนักทอง', (r ->> 'weight_g') is null);
    v := v || pg_temp.chk('D8a', 'spot ทอง ไม่มีน้ำหนัก: preview/done ตก weight_required (ด่านเดิม "น้ำหนักเงิน" ย้ายมาเช็คค่า effective)', pg_temp.hint(pg_temp.pv(v_shop, o)) = '22023|weight_required'
      and pg_temp.hint(pg_temp.dn(v_shop, o, null, jsonb_build_object('gold', v_gold))) = '22023|weight_required' and pg_temp.lots(o) = 0);
    o2 := pg_temp.po(v_shop, 'D8b');
    perform pg_temp.iset(v_shop, o2, p_spec, 5, null, 'brass');
    v := v || pg_temp.chk('D8b', 'spec ทองเหลืองไม่มีน้ำหนัก (SKU 3.5 g เป็นของเงิน): ตก weight_required', pg_temp.hint(pg_temp.pv(v_shop, o2)) = '22023|weight_required');
    o3 := pg_temp.po(v_shop, 'D8c');
    perform pg_temp.iset(v_shop, o3, p_fixb, 2, null, 'gold', 0.9);
    v := v || pg_temp.chk('D8c', 'fixed ทองไม่มีน้ำหนัก preview ผ่าน (fixed ไม่ใช้น้ำหนัก — ต้องไม่พัง) · ต้นทุน 50', (pg_temp.pitem(pg_temp.pv(v_shop, o3), 'ZZ186-FIXB') ->> 'unit_cost')::numeric = 50);
    raise exception 'rb_186';
  exception when others then
    if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('D8-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- D10 ใบเงินที่ออฟฟิศเปิดแบบเดิม (เรียก item_set แบบ 4/5 arg เดิมทั้งหมด) ได้เลขเดิมตามสูตรเดิม
  begin
    o := pg_temp.po(v_shop, 'D10');
    perform analytics.production_order_item_set(v_shop, o, p_fixa, 4);
    perform analytics.production_order_item_set(v_shop, o, p_spot, 3, false);
    perform analytics.production_order_item_set(v_shop, o, p_bar, 2);
    r := pg_temp.pv(v_shop, o);
    v := v || pg_temp.chk('D10a', 'preview ใบเงินแบบเดิม: metal_prices = {silver:72} และ spot_price = 72 (ความหมายเดิม) · missing_prices ว่าง', (r -> 'metal_prices') = '{"silver": 72.0000}'::jsonb or (r -> 'metal_prices' ->> 'silver')::numeric = 72);
    r2 := pg_temp.dn(v_shop, o, null, jsonb_build_object('silver', 72));
    v := v || pg_temp.chk('D10b', 'done ใบเงินแบบเดิม {silver:72} ผ่าน', r2 ->> 'status' = 'done');
    v := v || pg_temp.chk('D10c', 'ต้นทุนตามสูตรเดิมของ v_dim_product: fixed 88 · spot .925 = round(10×72×0.925+20,2)=686.00 · แท่ง .999 = round(152.44×72×0.999,2)',
      pg_temp.lot_cost(o, p_fixa) = 88 and pg_temp.lot_cost(o, p_spot) = round(10 * 72 * 0.925 + 20, 2) and pg_temp.lot_cost(o, p_bar) = round(152.44 * 72 * 0.999, 2));
    v := v || pg_temp.chk('D10d', 'สต็อกเข้าตามจำนวน 4/3/2 · lot 3 แถว', pg_temp.stock(p_fixa) = 4 and pg_temp.stock(p_spot) = 3 and pg_temp.stock(p_bar) = 2 and pg_temp.lots(o) = 3);
    v := v || pg_temp.chk('D10e', 'done ซ้ำ → already_done · สต็อก/lot ไม่เพิ่ม', (pg_temp.dn(v_shop, o, null, null) ->> 'already_done') = 'true' and pg_temp.stock(p_fixa) = 4 and pg_temp.lots(o) = 3);
    raise exception 'rb_186';
  exception when others then
    if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('D10-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- D11 แถวเดิม (ทุกคอลัมน์ใหม่ null — เหมือนใบก่อน 0186) ผ่าน preview/done ครบ 3 โหมด ได้เลขเดียวกับแถวที่ stamp แล้ว
  begin
    o := pg_temp.po(v_shop, 'D11');
    perform pg_temp.iset(v_shop, o, p_fixa, 4);
    perform pg_temp.iset(v_shop, o, p_spot, 3);
    perform pg_temp.iset(v_shop, o, p_spec, 5);
    r := pg_temp.pv(v_shop, o);                               -- รอบที่ 1: แถวที่ item_set stamp ค่าแล้ว
    update analytics.production_order_item set metal = null, purity = null, weight_g = null, weight_source = null where production_order_id = o;
    r2 := pg_temp.pv(v_shop, o);                              -- รอบที่ 2: แถวแบบเดิมทุกคอลัมน์ใหม่ = null
    v := v || pg_temp.chk('D11a', 'แถวเดิม (metal/purity/weight/source = null) preview ได้ผลเท่าแถวที่ stamp ทุก key ที่ตัวเลขเกี่ยวข้อง (unit_cost 3 โหมด · cost_calc ทั้งก้อน)',
      (select bool_and((a -> 'unit_cost') = (b -> 'unit_cost') and (a -> 'cost_calc') = (b -> 'cost_calc') and (a -> 'metal') = (b -> 'metal') and (a -> 'purity') = (b -> 'purity') and (a -> 'weight_g') = (b -> 'weight_g'))
         from jsonb_array_elements(r -> 'items') a join jsonb_array_elements(r2 -> 'items') b on a ->> 'item_id' = b ->> 'item_id') and jsonb_array_length(r2 -> 'items') = 3);
    r3 := pg_temp.dn(v_shop, o, null, jsonb_build_object('silver', 72));
    v := v || pg_temp.chk('D11b', 'done แถวเดิม 3 โหมดผ่าน · fixed 88 · spot 686.00 · spec = ค่า preview', r3 ->> 'status' = 'done' and pg_temp.lot_cost(o, p_fixa) = 88 and pg_temp.lot_cost(o, p_spot) = 686.00
      and pg_temp.lot_cost(o, p_spec) = (pg_temp.pitem(r2, 'ZZ186-SPEC') ->> 'unit_cost')::numeric);
    v := v || pg_temp.chk('D11c', 'done stamp แถวเดิมให้ครบ: fixed (silver · 0.925 · ว่าง) · spot (silver · 0.925 · 10 · product) · spec (silver · 0.925 · 3.5 · product)',
      exists (select 1 from analytics.production_order_item i where i.production_order_id = o and i.product_id = p_fixa and i.metal = 'silver' and i.purity = 0.925 and i.weight_g is null)
      and exists (select 1 from analytics.production_order_item i where i.production_order_id = o and i.product_id = p_spot and i.metal = 'silver' and i.purity = 0.925 and i.weight_g = 10 and i.weight_source = 'product')
      and exists (select 1 from analytics.production_order_item i where i.production_order_id = o and i.product_id = p_spec and i.metal = 'silver' and i.purity = 0.925 and i.weight_g = 3.5 and i.weight_source = 'product'));
    v := v || pg_temp.chk('D11d', 'ใบที่ stamp แล้วอ่านซ้ำ (done ซ้ำ) ได้ค่าเดิม ไม่ถูกคิดใหม่', (pg_temp.dn(v_shop, o, null, null) ->> 'already_done') = 'true' and pg_temp.lot_cost(o, p_spot) = 686.00);
    raise exception 'rb_186';
  exception when others then
    if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('D11-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  return v;
end;
$c$;

-- ============================================================================
-- J. ใบงานจากรายการใบผลิต (ทอง/ทองเหลือง/ไม่มี SKU) · แบบทอง · ล็อกโลหะเมื่อมีใบงาน (I10) · N1
-- ============================================================================
create function pg_temp.g_job() returns text
 language plpgsql as $c$
declare
  v text := '';
  v_shop uuid := pg_temp.fx('shop');
  p_fixa uuid := pg_temp.fx('fixa'); p_fixb uuid := pg_temp.fx('fixb'); p_spot uuid := pg_temp.fx('spot'); p_bar uuid := pg_temp.fx('bar');
  o uuid; o2 uuid; o3 uuid; i1 uuid; i2 uuid; i3 uuid; r jsonb; r2 jsonb; r3 jsonb; si jsonb; j jsonb; v_job uuid; v_job_no text;
  v_n int; v_prof uuid; v_act uuid := '00000000-0000-0000-0000-0000000000a1';
begin
  perform analytics.job_stage_def_ensure(v_shop);
  perform analytics.job_record_profile_ensure(v_shop);

  -- J1 ใบงานจากรายการทอง (SKU fixed) / เงินแบบเดิม / ทองเหลือง
  begin
    o := pg_temp.po(v_shop, 'J1');
    i1 := (pg_temp.iset(v_shop, o, p_fixa, 10, null, 'gold', 0.9, 3.2, 'input') ->> 'id')::uuid;
    i2 := (pg_temp.iset(v_shop, o, p_bar, 3) ->> 'id')::uuid;
    i3 := (pg_temp.iset(v_shop, o, p_fixb, 6, null, 'brass') ->> 'id')::uuid;
    si := pg_temp.q(format('select analytics.job_source_info(%L, %L, %L)', v_shop, 'production', i1));
    v := v || pg_temp.chk('J1a', 'job_source_info รายการทอง: metal=gold · purity 0.9 · target_piece_g 3.2 ที่มา input · sku_pending=false',
      (si ->> 'metal') = 'gold' and (si ->> 'purity')::numeric = 0.9 and (si ->> 'target_piece_g')::numeric = 3.2 and (si ->> 'target_piece_g_source') = 'input' and (si ->> 'sku_pending') = 'false');
    j := pg_temp.mkjob(v_shop, i1);
    v := v || pg_temp.chk('J1b', 'สร้างใบงานจากรายการทอง (ไม่ส่งแบบ): metal=gold · แบบ "ทอง…" (ชั่งทุกขั้นที่มีโลหะ) · gold_unguarded=false · has_weigh=true · ' || coalesce(j ->> 'profile_name', j ->> '_err'),
      (j ->> 'metal') = 'gold' and (j ->> 'profile_name') like 'ทอง%' and (j ->> 'gold_unguarded') = 'false' and (j ->> 'has_weigh') = 'true');
    v_job := (j ->> 'job_id')::uuid;
    v := v || pg_temp.chk('J1c', 'แถวใบงาน: metal=gold (จากรายการ ไม่ใช่ SKU) · target_piece_g 3.2 · แผนโลหะมีที่มา input · sku_snapshot = SKU · design_label = ชื่อ SKU',
      exists (select 1 from analytics.job x where x.id = v_job and x.metal = 'gold' and x.target_piece_g = 3.2 and (x.metal_plan_basis ->> 'target_source') = 'input' and x.sku_snapshot = 'ZZ186-FIXA' and x.design_label = 'fixed A'));
    v := v || pg_temp.chk('J1d', 'ใบทอง: ทุกขั้นที่ metal_present ต้องชั่ง (กฎทอง 0175/0176 ผูกกับ job.metal) · ต้องชั่งสุทธิตอนปิด',
      (select bool_and(s.weigh_required) from analytics.job_stage s join analytics.job_stage_def d on d.shop_id = s.shop_id and d.code = s.stage_code where s.job_id = v_job and d.metal_present)
      and (select require_final_weight from analytics.job where id = v_job));
    j := pg_temp.mkjob(v_shop, i2);
    v := v || pg_temp.chk('J1e', 'ใบงานจากเงินแท่ง (แบบเดิม): metal=silver · target 152.440 ที่มา product (เดิม: silver_weight_g ของ SKU) · ไม่ใช่แบบทอง',
      (j ->> 'metal') = 'silver' and (j ->> 'profile_name') not like 'ทอง%'
      and exists (select 1 from analytics.job x where x.id = (j ->> 'job_id')::uuid and x.target_piece_g = 152.44 and (x.metal_plan_basis ->> 'target_source') = 'product'));
    j := pg_temp.mkjob(v_shop, i3);
    v := v || pg_temp.chk('J1f', 'ใบงานจากรายการทองเหลือง: metal=brass (เดิมจะได้ silver เพราะ SKU fixed) · ไม่มีน้ำหนักเป้า (ไม่เดาจากน้ำหนักเงินของ SKU)',
      (j ->> 'metal') = 'brass' and exists (select 1 from analytics.job x where x.id = (j ->> 'job_id')::uuid and x.target_piece_g is null));
    raise exception 'rb_186';
  exception when others then
    if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('J1-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- J2 รายการไม่มี SKU → ใบงาน (product_id null · sku null · design_label = ชื่อแบบ)
  begin
    o := pg_temp.po(v_shop, 'J2');
    i1 := (pg_temp.iset(v_shop, o, null, 6, 'งานใหม่ J2 เงิน', 'silver') ->> 'id')::uuid;
    i2 := (pg_temp.iset(v_shop, o, null, 2, 'งานใหม่ J2 ทอง', 'gold', 0.9, 2.5, 'input') ->> 'id')::uuid;
    si := pg_temp.q(format('select analytics.job_source_info(%L, %L, %L)', v_shop, 'production', i1));
    v := v || pg_temp.chk('J2a', 'job_source_info รายการไม่มี SKU: sku_pending=true · design_label = ชื่อแบบ · sku/product_id null · metal=silver · purity 0.925', (si ->> 'sku_pending') = 'true' and (si ->> 'design_label') = 'งานใหม่ J2 เงิน' and (si -> 'sku') = 'null'::jsonb and (si -> 'product_id') = 'null'::jsonb and (si ->> 'metal') = 'silver');
    j := pg_temp.mkjob(v_shop, i1);
    v := v || pg_temp.chk('J2b', 'สร้างใบงานจากรายการไม่มี SKU ได้: แถวใบงาน product_id null · sku_snapshot null · design_label = ชื่อแบบ · metal=silver',
      (j ->> 'job_id') is not null and exists (select 1 from analytics.job x where x.id = (j ->> 'job_id')::uuid and x.product_id is null and x.sku_snapshot is null and x.design_label = 'งานใหม่ J2 เงิน' and x.metal = 'silver'));
    j := pg_temp.mkjob(v_shop, i2);
    v := v || pg_temp.chk('J2c', 'รายการไม่มี SKU โลหะทอง → ใบงาน metal=gold แบบทอง · target 2.5 (input)', (j ->> 'metal') = 'gold' and (j ->> 'profile_name') like 'ทอง%'
      and exists (select 1 from analytics.job x where x.id = (j ->> 'job_id')::uuid and x.target_piece_g = 2.5));
    v := v || pg_temp.chk('J2d', 'รายการยังไม่ผูก SKU หลังมีใบงาน (ไม่ถูกเขียนเป็น SKU) · view แสดงแถว (left join)', exists (select 1 from analytics.production_order_item x where x.id = i1 and x.product_id is null and x.pending_product_label = 'งานใหม่ J2 เงิน')
      and exists (select 1 from analytics.v_production_order_item w where w.id = i1 and w.product_id is null and w.pending_product_label = 'งานใหม่ J2 เงิน'));
    raise exception 'rb_186';
  exception when others then
    if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('J2-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- J3 ปิดช่อง fallback เงียบ: ทองไม่มีแบบทองค่าเริ่ม → no_gold_profile
  begin
    update analytics.job_record_profile set is_default_gold = false where shop_id = v_shop and is_default_gold;
    o := pg_temp.po(v_shop, 'J3');
    i1 := (pg_temp.iset(v_shop, o, p_fixa, 5, null, 'gold', 0.9, 3.2, 'input') ->> 'id')::uuid;
    i2 := (pg_temp.iset(v_shop, o, p_bar, 2) ->> 'id')::uuid;
    j := pg_temp.mkjob(v_shop, i1);
    v := v || pg_temp.chk('J3a', 'ไม่มีแบบทองค่าเริ่ม: สร้างใบงานทองโดยไม่ส่งแบบ ตก no_gold_profile — ไม่ fallback ไปแบบ default ของเงินเงียบๆ · ไม่มีใบงานเกิด', pg_temp.hint(j) = '22023|no_gold_profile'
      and not exists (select 1 from analytics.job where production_order_item_id = i1));
    select p.id into v_prof from analytics.job_record_profile p where p.shop_id = v_shop and p.is_active and not p.is_default limit 1;
    j := pg_temp.mkjob(v_shop, i1, v_prof);
    v := v || pg_temp.chk('J3b', 'ส่งแบบที่เลือกเองมาชัดเจน (explicit) ผ่านตามเดิม — ด่านนี้ปิดเฉพาะ fallback เงียบ', (j ->> 'job_id') is not null and (j ->> 'metal') = 'gold');
    j := pg_temp.mkjob(v_shop, i2);
    v := v || pg_temp.chk('J3c', 'ใบเงินไม่ได้รับผลกระทบ (ต้องไม่พัง): ได้แบบ default ปกติ · metal=silver', (j ->> 'job_id') is not null and (j ->> 'metal') = 'silver' and (j ->> 'profile_name') like 'แบบ 1%');
    raise exception 'rb_186';
  exception when others then
    if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('J3-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    -- (แบบทองที่ "ปิดใช้งานทั้งที่ยังเป็นค่าเริ่ม" เกิดไม่ได้ — trigger เดิมกัน จึงไม่มีเทสต์สถานะนั้น) รายการไม่มี SKU ที่เป็นทองก็ต้องตกเหมือนกัน
    update analytics.job_record_profile set is_default_gold = false where shop_id = v_shop and is_default_gold;
    o := pg_temp.po(v_shop, 'J3d');
    i1 := (pg_temp.iset(v_shop, o, null, 5, 'J3d ทองไม่มี SKU', 'gold', 0.9, 3.2, 'input') ->> 'id')::uuid;
    v := v || pg_temp.chk('J3d', 'รายการไม่มี SKU โลหะทอง + ไม่มีแบบทองค่าเริ่ม: ตก no_gold_profile เหมือนกัน (ด่านอยู่ที่ job_create_insert ที่เดียว — ทั้งทางใบผลิตและทางอื่น)', pg_temp.hint(pg_temp.mkjob(v_shop, i1)) = '22023|no_gold_profile');
    raise exception 'rb_186';
  exception when others then
    if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('J3d-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- I10 ล็อกโลหะเมื่อมีใบงาน (RPC + trigger ตรง) · แก้น้ำหนัก/เนื้อได้ · ยกเลิกใบงานแล้วเปลี่ยนได้ · ลบรายการที่มีใบงานไม่ได้
  begin
    o := pg_temp.po(v_shop, 'I10');
    i1 := (pg_temp.iset(v_shop, o, p_fixa, 10, null, 'gold', 0.9, 3.2, 'input') ->> 'id')::uuid;
    j := pg_temp.mkjob(v_shop, i1);
    v_job := (j ->> 'job_id')::uuid;
    select job_no into v_job_no from analytics.job where id = v_job;
    r := pg_temp.iset(v_shop, o, p_fixa, 10, null, 'silver');
    v := v || pg_temp.chk('I10a', 'เปลี่ยนโลหะรายการที่มีใบงาน (gold→silver) ตก metal_locked · ข้อความบอกเลขใบงาน ' || coalesce(v_job_no, '?'), pg_temp.hint(r) = '22023|metal_locked' and (r ->> '_err') like '%' || v_job_no || '%');
    v := v || pg_temp.chk('I10b', 'UPDATE ตรงบน metal ของรายการที่มีใบงาน ตก metal_locked (trigger — ทางอื่นนอก RPC)', pg_temp.err(format('update analytics.production_order_item set metal = %L, purity = 0.925 where id = %L', 'silver', i1)) = '22023|metal_locked');
    r := pg_temp.iset(v_shop, o, p_fixa, 10, null, null, 0.75, 4.0, 'input');
    v := v || pg_temp.chk('I10c', 'แก้เนื้อ/น้ำหนักหลังมีใบงาน = อนุญาต · ไม่เขียนทับ target_piece_g ของใบงาน (ยัง 3.2)', (r ->> 'purity')::numeric = 0.75 and (r ->> 'weight_g')::numeric = 4.0
      and (select target_piece_g from analytics.job where id = v_job) = 3.2);
    r := pg_temp.iset(v_shop, o, p_fixa, 10, null, 'gold');
    v := v || pg_temp.chk('I10d', 'ส่งโลหะเดิม (gold) ซ้ำ ไม่ใช่การเปลี่ยน ผ่าน (ต้องไม่พัง)', (r ->> 'metal') = 'gold');
    v := v || pg_temp.chk('I10e', 'ลบรายการที่มีใบงาน (remove_by_id) ตก job_exists บอกเลขใบงาน', pg_temp.q(format('select analytics.production_order_item_remove_by_id(%L, %L, %L)', v_shop, o, i1)) ->> '_hint' = 'job_exists');
    -- แถวเดิม (metal null = โลหะที่ SKU ให้) + ใบงานเดิน: stamp ค่า effective (null→silver) ไม่ใช่การเปลี่ยน · เปลี่ยนจริงตก
    i2 := (pg_temp.iset(v_shop, o, p_bar, 3) ->> 'id')::uuid;
    update analytics.production_order_item set metal = null, purity = null, weight_g = null, weight_source = null where id = i2;
    j := pg_temp.mkjob(v_shop, i2);
    v := v || pg_temp.chk('I10f', 'แถวเดิม (null) + ใบงานเดิน: UPDATE stamp metal=silver ผ่าน (effective เท่าเดิม) · UPDATE เป็น gold ตก metal_locked',
      (j ->> 'metal') = 'silver'
      and pg_temp.err(format('update analytics.production_order_item set metal = %L, purity = 0.999, weight_g = 152.44, weight_source = %L where id = %L', 'silver', 'product', i2)) = 'OK'
      and pg_temp.err(format('update analytics.production_order_item set metal = %L, purity = 0.9 where id = %L', 'gold', i2)) = '22023|metal_locked');
    r2 := pg_temp.q(format('select analytics.job_cancel(%L, %L, %L, %L)', v_shop, v_job, 'verify ยกเลิก', v_act));
    r := pg_temp.iset(v_shop, o, p_fixa, 10, null, 'silver');
    v := v || pg_temp.chk('I10g', 'ยกเลิกใบงานแล้ว เปลี่ยนโลหะได้ (gold→silver · เนื้อรีเซ็ต 0.925)', (r2 ->> '_err') is null and (r ->> 'metal') = 'silver' and (r ->> 'purity')::numeric = 0.925);
    raise exception 'rb_186';
  exception when others then
    if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('I10-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- J4 N1: น้ำหนักงานทองไม่โชว์ช่าง — ฝั่งช่าง (job_worker_*) ต้องไม่อ้าง target_piece_g เลย (กฎเดิม · ทดสอบว่า 0186 ไม่ทำให้รั่ว)
  select count(*) into v_n from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname like 'job\_worker%' and p.prosrc ilike '%target_piece_g%';
  v := v || pg_temp.chk('J4a', 'N1: ไม่มีฟังก์ชัน job_worker_* ที่อ้าง target_piece_g (น้ำหนักเป้าของทอง ไม่ไหลไปจอช่าง) — พบ ' || v_n || ' ตัว', v_n = 0);
  select count(*) into v_n from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname like 'job\_worker%' and p.prosrc ilike '%production_order_item%' and p.prosrc ilike '%weight_g%';
  v := v || pg_temp.chk('J4b', 'N1: ฟังก์ชัน job_worker_* ไม่อ่านน้ำหนักจากรายการใบผลิต (weight_g) — พบ ' || v_n || ' ตัว', v_n = 0);
  return v;
end;
$c$;

-- ============================================================================
-- F. prefill · helper · view · trigger ใบ done/cancelled · remove_by_id
-- ============================================================================
create function pg_temp.g_misc() returns text
 language plpgsql as $c$
declare
  v text := '';
  v_shop uuid := pg_temp.fx('shop');
  p_fixa uuid := pg_temp.fx('fixa'); p_fixb uuid := pg_temp.fx('fixb'); p_spot uuid := pg_temp.fx('spot'); p_bar uuid := pg_temp.fx('bar'); p_spec uuid := pg_temp.fx('spec');
  o uuid; o2 uuid; i1 uuid; i2 uuid; i3 uuid; r jsonb; r2 jsonb; w jsonb; v_row record; v_n int;
  v_prod public.product;
  v_cols text;
begin
  -- F1 prefill (metal_known)
  r := pg_temp.q(format('select analytics.production_item_prefill(%L, %L)', v_shop, p_spot));
  v := v || pg_temp.chk('F1a', 'prefill SKU spot 10g: metal=silver · 0.925 · 10 g (product) · metal_known=true (โหมด spot = ราคาเงิน)', (r ->> 'metal') = 'silver' and (r ->> 'purity')::numeric = 0.925 and (r ->> 'weight_g')::numeric = 10 and (r ->> 'weight_source') = 'product' and (r ->> 'metal_known') = 'true');
  r := pg_temp.q(format('select analytics.production_item_prefill(%L, %L)', v_shop, p_fixa));
  v := v || pg_temp.chk('F1b', 'prefill SKU fixed ไม่มี make_spec: metal_known=false (ไม่เตือนผิด — UX P1) · ค่าเริ่ม เงิน 0.925 น้ำหนัก null (ไม่เดา)', (r ->> 'metal_known') = 'false' and (r ->> 'metal') = 'silver' and (r ->> 'purity')::numeric = 0.925 and (r -> 'weight_g') = 'null'::jsonb);
  r := pg_temp.q(format('select analytics.production_item_prefill(%L, %L)', v_shop, p_spec));
  v := v || pg_temp.chk('F1c', 'prefill SKU spec: metal_known=true (make_spec.metal) · silver · 3.5 g', (r ->> 'metal_known') = 'true' and (r ->> 'metal') = 'silver' and (r ->> 'weight_g')::numeric = 3.5);
  r := pg_temp.q(format('select analytics.production_item_prefill(%L, %L)', v_shop, p_bar));
  v := v || pg_temp.chk('F1d', 'prefill เงินแท่ง: 0.999 · 152.44 g · metal_known=true', (r ->> 'purity')::numeric = 0.999 and (r ->> 'weight_g')::numeric = 152.44 and (r ->> 'metal_known') = 'true');
  v := v || pg_temp.chk('F1e', 'prefill SKU ของร้านอื่น/ไม่มี ตก 22023', pg_temp.q(format('select analytics.production_item_prefill(%L, %L)', v_shop, gen_random_uuid())) ->> '_state' = '22023');

  -- F2 helper
  select s.metal into v_row from analytics.production_item_spec(null::analytics.production_order_item, null::public.product, true) s;
  v := v || pg_temp.chk('F2a', 'helper strict: ไม่มีทั้งรายการและ SKU ตก metal_unsupported · lenient คืน metal null ไม่ raise',
    pg_temp.err('select * from analytics.production_item_spec(null::analytics.production_order_item, null::public.product)') = '22023|metal_unsupported' and v_row.metal is null);
  select * into v_prod from public.product p where p.id = p_spot;
  select * into v_row from analytics.production_item_spec(json_populate_record(null::analytics.production_order_item, '{"metal":"gold","purity":0.9}'::json), v_prod) s;
  v := v || pg_temp.chk('F2b', 'helper: ทองบน SKU ที่มีน้ำหนักเงิน 10 g → weight null (silver_weight_g ใช้เฉพาะเงิน) · เนื้อ 0.9 ตามรายการ', v_row.metal = 'gold' and v_row.purity = 0.9 and v_row.weight_g is null and v_row.weight_source is null);
  v := v || pg_temp.chk('F2c', 'helper: ทองไม่มี purity ตก gold_purity_required (ผ่าน helper = ทั้ง preview/done/job_source_info) · lenient คืน purity null',
    pg_temp.err(format('select * from analytics.production_item_spec(json_populate_record(null::analytics.production_order_item, %L::json), null::public.product)', '{"metal":"gold"}')) = '22023|gold_purity_required'
    and (select s.purity from analytics.production_item_spec(json_populate_record(null::analytics.production_order_item, '{"metal":"gold"}'::json), null::public.product, true) s) is null);
  select * into v_row from analytics.production_item_spec(json_populate_record(null::analytics.production_order_item, '{"metal":"brass"}'::json), null::public.product) s;
  v := v || pg_temp.chk('F2d', 'helper: ทองเหลืองไม่ระบุเนื้อ = 1.0', v_row.metal = 'brass' and v_row.purity = 1.0);
  select * into v_row from analytics.production_item_spec(json_populate_record(null::analytics.production_order_item, '{"metal":"silver","weight_g":2.5,"weight_source":"input"}'::json), v_prod) s;
  v := v || pg_temp.chk('F2e', 'helper: น้ำหนักของรายการ (2.5 input) ชนะน้ำหนักของ SKU (10 product)', v_row.weight_g = 2.5 and v_row.weight_source = 'input' and v_row.purity = 0.925);

  -- F4 view
  v := v || pg_temp.chk('F4a', 'v_production_order_item ยัง security_invoker (create or replace ไม่ทำหาย) + 17 คอลัมน์เดิมคงลำดับ',
    exists (select 1 from pg_class c where c.oid = 'analytics.v_production_order_item'::regclass and 'security_invoker=true' = any (c.reloptions))
    and (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'analytics' and table_name = 'v_production_order_item' and ordinal_position <= 17)
        = 'id,shop_id,production_order_id,po_no,order_status,product_id,sku,product_name,current_cost_type,current_unit_cost,qty_planned,qty_done,stamped_unit_cost,prev_cost_type,prev_unit_cost,created_at,updated_at');
  o := pg_temp.po(v_shop, 'F4');
  i1 := (pg_temp.iset(v_shop, o, null, 3, 'F4 ไม่มี SKU', 'gold', 0.9, 2, 'input') ->> 'id')::uuid;
  i2 := (pg_temp.iset(v_shop, o, p_spot, 2) ->> 'id')::uuid;
  i3 := (pg_temp.iset(v_shop, o, p_fixa, 1, null, 'gold', 0.75) ->> 'id')::uuid;
  select * into v_row from analytics.v_production_order_item where id = i1;
  v := v || pg_temp.chk('F4b', 'view แสดงรายการไม่มี SKU (left join): product_id/sku null · pending_product_label · metal gold · effective เท่าที่เก็บ · sku_metal_known=false',
    v_row.id is not null and v_row.product_id is null and v_row.sku is null and v_row.pending_product_label = 'F4 ไม่มี SKU' and v_row.metal = 'gold' and v_row.effective_metal = 'gold' and v_row.effective_purity = 0.9 and v_row.effective_weight_g = 2 and v_row.sku_metal_known = false);
  select * into v_row from analytics.v_production_order_item where id = i2;
  v := v || pg_temp.chk('F4c', 'view แถว spot: effective_* = ค่าที่เก็บ · sku_* = ค่าเริ่มของ SKU (silver · 0.925 · 10) · sku_metal_known=true', v_row.effective_metal = 'silver' and v_row.effective_weight_g = 10 and v_row.sku_metal = 'silver' and v_row.sku_purity = 0.925 and v_row.sku_weight_g = 10 and v_row.sku_metal_known = true);
  select * into v_row from analytics.v_production_order_item where id = i3;
  v := v || pg_temp.chk('F4d', 'view แถวทองบน SKU fixed: effective gold 0.75 · sku_* ยังเป็นค่าเริ่มของ SKU (silver 0.925) — UI ติดป้าย "แก้ในใบนี้" ได้จากส่วนต่าง', v_row.effective_metal = 'gold' and v_row.effective_purity = 0.75 and v_row.sku_metal = 'silver' and v_row.sku_purity = 0.925 and v_row.sku_metal_known = false);
  update analytics.production_order_item set metal = null, purity = null, weight_g = null, weight_source = null where id = i2;
  select * into v_row from analytics.v_production_order_item where id = i2;
  v := v || pg_temp.chk('F4e', 'view แถวเดิม (คอลัมน์ใหม่ null): effective = ค่าที่ helper คืน (silver · 0.925 · 10 · product) — UI แสดงแถวเดิมได้เหมือนเดิม', v_row.metal is null and v_row.effective_metal = 'silver' and v_row.effective_purity = 0.925 and v_row.effective_weight_g = 10 and v_row.effective_weight_source = 'product');
  v := v || pg_temp.chk('F4f', 'v_production_order นับรายการไม่มี SKU ด้วย (item_count = 3)', (select item_count from analytics.v_production_order where id = o) = 3);

  -- F9 done/cancelled: UPDATE/DELETE/item_set/remove_by_id ตรงไม่ได้ (trigger เดิมครอบคอลัมน์ใหม่โดยอัตโนมัติ)
  begin
    o := pg_temp.po(v_shop, 'F9');
    i1 := (pg_temp.iset(v_shop, o, p_fixa, 2) ->> 'id')::uuid;
    perform pg_temp.dn(v_shop, o, null, null);
    v := v || pg_temp.chk('F9a', 'ใบ done: UPDATE ตรงบน metal/purity/weight_g/weight_source ตก 22023 (trigger เดิม) · DELETE ตรงตก',
      pg_temp.err(format('update analytics.production_order_item set metal = %L, purity = 0.9 where id = %L', 'gold', i1)) like '22023|%'
      and pg_temp.err(format('update analytics.production_order_item set weight_g = 5, weight_source = %L where id = %L', 'input', i1)) like '22023|%'
      and pg_temp.err(format('delete from analytics.production_order_item where id = %L', i1)) like '22023|%');
    v := v || pg_temp.chk('F9b', 'ใบ done: item_set (ทุกแบบ) / remove_by_id ตก 22023', pg_temp.hint(pg_temp.iset(v_shop, o, p_fixa, 5, null, 'gold', 0.9)) like '22023|%'
      and pg_temp.hint(pg_temp.iset(v_shop, o, null, 1, 'หลังปิด', 'silver')) like '22023|%'
      and pg_temp.q(format('select analytics.production_order_item_remove_by_id(%L, %L, %L)', v_shop, o, i1)) ->> '_state' = '22023');
    o2 := pg_temp.po(v_shop, 'F9c');
    i2 := (pg_temp.iset(v_shop, o2, p_fixb, 2) ->> 'id')::uuid;
    perform analytics.production_order_cancel(v_shop, o2, 'verify');
    v := v || pg_temp.chk('F9c', 'ใบ cancelled: item_set / UPDATE ตรง / remove_by_id ตก 22023', pg_temp.hint(pg_temp.iset(v_shop, o2, p_fixb, 5, null, 'gold', 0.9)) like '22023|%'
      and pg_temp.err(format('update analytics.production_order_item set metal = %L, purity = 0.9 where id = %L', 'gold', i2)) like '22023|%'
      and pg_temp.q(format('select analytics.production_order_item_remove_by_id(%L, %L, %L)', v_shop, o2, i2)) ->> '_state' = '22023');
    raise exception 'rb_186';
  exception when others then
    if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('F9-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- F10 remove_by_id: ใบไม่ตรง → item_not_found · ลบปกติได้
  o := pg_temp.po(v_shop, 'F10a');
  o2 := pg_temp.po(v_shop, 'F10b');
  i1 := (pg_temp.iset(v_shop, o, p_fixa, 2) ->> 'id')::uuid;
  v := v || pg_temp.chk('F10a', 'remove_by_id ด้วย id ของอีกใบ ตก item_not_found (ไม่ลบข้ามใบ)', pg_temp.q(format('select analytics.production_order_item_remove_by_id(%L, %L, %L)', v_shop, o2, i1)) ->> '_hint' = 'item_not_found'
    and exists (select 1 from analytics.production_order_item where id = i1));
  perform analytics.production_order_item_remove_by_id(v_shop, o, i1);
  v := v || pg_temp.chk('F10b', 'remove_by_id ปกติ: ลบได้', not exists (select 1 from analytics.production_order_item where id = i1));
  v := v || pg_temp.chk('F10c', 'production_order_item_remove เดิม (ด้วย product_id) ยังทำงานตามเดิม (ต้องไม่พัง)',
    (pg_temp.iset(v_shop, o, p_fixa, 2) ->> 'id') is not null and pg_temp.err(format('select analytics.production_order_item_remove(%L, %L, %L)', v_shop, o, p_fixa)) = 'OK' and not exists (select 1 from analytics.production_order_item where production_order_id = o));
  return v;
end;
$c$;

-- ============================================================================
-- S. สิทธิ์/overload (ข้อ 18) — รวมจำลอง "กำแพงชั้นนอกหลุด" (ข้อ 18.5)
-- ============================================================================
create function pg_temp.g_sec() returns text
 language plpgsql as $c$
declare
  v text := '';
  v_names text[] := array['production_order_item_set', 'production_order_preview', 'production_order_done', 'job_source_info', 'job_create_insert', 'oem_metal_price_set',
    'production_spot_resolve', 'production_metal_price_resolve', 'production_item_spec', 'production_item_prefill', 'production_order_item_remove_by_id',
    'oem_metal_price_set_input', 'oem_metal_price_range_ok', 'oem_metal_price_convert', 'production_metal_price_today', 'production_cost_calc'];
  n text; v_n int; v_bad text; r record; v_res text;
begin
  -- S1 overload = 1 แถว/ชื่อ · ไม่มี legacy ค้าง
  select string_agg(x.proname || '=' || x.c, ', ') into v_bad
    from (select p.proname, count(*)::text as c from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = any (v_names) group by p.proname having count(*) <> 1) x;
  v := v || pg_temp.chk('S1a', 'ทุกฟังก์ชันที่แตะมี signature เดียว (ไม่เกิด overload) — ผิดปกติ: ' || coalesce(v_bad, 'ไม่มี'), v_bad is null and (select count(distinct p.proname) from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = any (v_names)) = array_length(v_names, 1));
  select count(*) into v_n from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname like '%legacy186';
  v := v || pg_temp.chk('S1b', 'ไม่มีฟังก์ชัน *_legacy186 ค้าง (golden drop แล้ว)', v_n = 0);
  v := v || pg_temp.chk('S1c', 'production_order_done เหลือ signature เดียวที่รับ p_expected_metal_prices (ไม่มีตัว p_expected_spot เดิมค้าง)',
    (select count(*) from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'production_order_done' and pg_get_function_arguments(p.oid) like '%p_expected_metal_prices jsonb%') = 1
    and (select count(*) from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'production_order_done' and pg_get_function_arguments(p.oid) like '%p_expected_spot%') = 0);

  -- S2 ทุกฟังก์ชันในสคีมา analytics: anon/authenticated/PUBLIC ห้าม execute (เทียบ scripts/check-analytics-grants.sql ย่อ — รวมของเก่าด้วย ไม่ผูกรายชื่อ)
  select string_agg(distinct p.oid::regprocedure::text, ' · ') into v_bad
    from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.pronamespace = 'analytics'::regnamespace and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated')));
  v := v || pg_temp.chk('S2a', 'กวาดทั้งสคีมา analytics ด้วย aclexplode: ไม่มีฟังก์ชันไหนเปิด execute ให้ PUBLIC/anon/authenticated — ผิดปกติ: ' || coalesce(left(v_bad, 600), 'ไม่มี'), v_bad is null);
  v := v || pg_temp.chk('S2b', 'service_role execute ได้ครบตัวที่ app เรียก (11 ตัว)',
    (select count(*) from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname in ('production_order_item_set', 'production_order_preview', 'production_order_done', 'oem_metal_price_set', 'production_spot_resolve',
       'production_metal_price_resolve', 'production_item_prefill', 'production_order_item_remove_by_id', 'oem_metal_price_set_input', 'production_cost_calc', 'production_item_spec') and has_function_privilege('service_role', p.oid, 'execute')) = 11);
  v := v || pg_temp.chk('S2c', 'ตัวช่วยภายใน (job_source_info · job_create_insert · convert · today) ไม่เปิดให้ service_role/anon/authenticated (postgres เท่านั้น เหมือนก่อนไฟล์นี้)',
    not exists (select 1 from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname in ('job_source_info', 'job_create_insert', 'oem_metal_price_convert', 'production_metal_price_today')
                  and (has_function_privilege('service_role', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))));

  -- S3 จำลองกำแพงหลุด: เปิด usage สคีมาให้ authenticated แล้วยิงทุกฟังก์ชันที่แตะ (arg ว่างทั้งหมด) ต้องตกที่ 42501 ก่อนเข้าตัวฟังก์ชัน
  begin
    execute 'grant usage on schema analytics to authenticated';
    v_bad := '';
    for r in select * from (values
        ('oem_metal_price_set_input', 'null, null, null, null'), ('production_metal_price_resolve', 'null, null, null'), ('production_item_prefill', 'null, null'),
        ('production_order_item_remove_by_id', 'null, null, null'), ('production_order_item_set', 'null, null, null, null, null, null, null, null, null, null, null'),
        ('production_order_preview', 'null, null, null'), ('production_order_done', 'null, null, null, null, null'), ('production_cost_calc', 'null, null, null, null, null, null, null, null'),
        ('oem_metal_price_set', 'null, null, null, null, null'), ('production_spot_resolve', 'null, null'),
        ('production_item_spec', 'null::analytics.production_order_item, null::public.product, null'), ('job_source_info', 'null, null, null'),
        ('job_create_insert', 'null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null'),
        ('oem_metal_price_range_ok', 'null, null'), ('oem_metal_price_convert', 'null, null, null'), ('production_metal_price_today', 'null, null')) as t(fn, args)
    loop
      v_res := pg_temp.asrole('authenticated', format('select analytics.%I(%s)', r.fn, r.args));
      if v_res <> '42501' then v_bad := v_bad || r.fn || '=' || v_res || ' '; end if;
    end loop;
    v := v || pg_temp.chk('S3a', 'authenticated (สมมติกำแพงสคีมาหลุด) ยิงทั้ง 16 ฟังก์ชันด้วย arg ว่าง ตก 42501 permission denied ทุกตัว — ผิดปกติ: ' || coalesce(nullif(v_bad, ''), 'ไม่มี'), v_bad = '');
    v_bad := '';
    execute 'revoke usage on schema analytics from authenticated';
    for r in select * from (values ('oem_metal_price_set_input', 'null, null, null, null'), ('production_order_item_set', 'null, null, null, null, null, null, null, null, null, null, null'),
        ('production_order_done', 'null, null, null, null, null'), ('production_item_prefill', 'null, null')) as t(fn, args)
    loop
      v_res := pg_temp.asrole('anon', format('select analytics.%I(%s)', r.fn, r.args));
      if v_res not in ('42501') then v_bad := v_bad || r.fn || '=' || v_res || ' '; end if;
    end loop;
    v := v || pg_temp.chk('S3b', 'anon (ไม่มี usage สคีมา) ยิงฟังก์ชันหลักตก 42501 — ผิดปกติ: ' || coalesce(nullif(v_bad, ''), 'ไม่มี'), v_bad = '');
    raise exception 'rb_186';
  exception when others then
    if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('S3-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  v := v || pg_temp.chk('S4', 'ตาราง production_order_item / oem_metal_price: anon/authenticated ไม่มีสิทธิ์ select (คงเดิม)',
    not has_table_privilege('anon', 'analytics.production_order_item', 'select') and not has_table_privilege('authenticated', 'analytics.production_order_item', 'select')
    and not has_table_privilege('anon', 'analytics.oem_metal_price', 'select') and not has_table_privilege('authenticated', 'analytics.oem_metal_price', 'select'));
  return v;
end;
$c$;

-- ============================================================================
-- R. ข้อมูลจริง (อ่านอย่างเดียว) — ของจริงไม่ขยับ · ทอง/ทองเหลือง 25 ส.ค. · SKU spot จริง
-- ============================================================================
create function pg_temp.g_real() returns text
 language plpgsql as $c$
declare
  v text := '';
  v_shop uuid := pg_temp.fx('shop');
  v_a text; v_b text; v_n int; v_n2 int; v_txt text;
begin
  select count(*) into v_n from analytics.production_order_item i where i.shop_id <> v_shop;
  select count(*) into v_n2 from analytics.v_production_order_item w where w.shop_id <> v_shop;
  v := v || pg_temp.chk('R1', 'v_production_order_item (left join ใหม่) ไม่ทำแถวจริงหาย: ' || v_n2 || ' แถว = production_order_item จริง ' || v_n || ' แถว', v_n = v_n2 and v_n > 0);
  select count(*) into v_n from analytics.production_order_item i where i.shop_id <> v_shop and (i.product_id is null or i.metal is not null or i.purity is not null or i.weight_g is not null or i.weight_source is not null or i.pending_product_label is not null);
  v := v || pg_temp.chk('R2', 'ข้อมูลจริงทุกแถว: product_id ครบ · คอลัมน์ใหม่ null หมด (ไม่ backfill/ไม่ UPDATE แถวเดิม — ข้อ 19) — ผิดปกติ ' || v_n || ' แถว', v_n = 0);
  -- R3 ของจริงไม่ขยับตลอดการทดสอบทั้งชุด (เทียบ snapshot ต้นไฟล์)
  select string_agg(k, ',') into v_txt from (
    select s.k from _v186_snap s where s.v is distinct from case s.k
      when 'real_product' then (select coalesce(md5(string_agg(pr::text, '|' order by pr.id)), '') from public.product pr where pr.shop_id <> v_shop)
      when 'real_dim' then (select coalesce(md5(string_agg(d.product_id::text || ':' || coalesce(d.effective_unit_cost::text, 'NULL'), ',' order by d.product_id)), '') from analytics.v_dim_product d where d.shop_id <> v_shop)
      when 'real_po' then (select coalesce(md5(string_agg(po.id::text || ':' || po.status, ',' order by po.id)), '') from analytics.production_order po where po.shop_id <> v_shop)
      when 'real_poi' then (select coalesce(md5(string_agg(to_jsonb(i)::text, '|' order by i.id)), '') from analytics.production_order_item i where i.shop_id <> v_shop)
      when 'real_lot' then (select count(*)::text from analytics.stock_lot l where l.shop_id <> v_shop)
      when 'real_job' then (select coalesce(md5(string_agg(j::text, '|' order by j.id)), '') from analytics.job j where j.shop_id <> v_shop)
      when 'real_price' then (select coalesce(md5(string_agg(m::text, '|' order by m.metal, m.as_of_date)), '') from analytics.oem_metal_price m where m.shop_id <> v_shop) end) x;
  v := v || pg_temp.chk('R3', 'ของจริงไม่ขยับแม้แถวเดียวตลอดชุดทดสอบ: product · v_dim_product(effective_unit_cost) · สถานะใบผลิต · รายการใบผลิต · lot · ใบงาน · ราคาโลหะ — ที่ขยับ: ' || coalesce(v_txt, 'ไม่มี'), v_txt is null);
  -- R4 แถวทอง/ทองเหลืองเดิมของจริง (25 ส.ค.) — รายงานค่า + อยู่ในช่วงใหม่ไหม (R5 ของบรีฟ — SELECT อย่างเดียว ไม่แก้ข้อมูล)
  select string_agg(m.metal || ' ' || m.as_of_date || ' = ' || m.price_thb_per_gram || ' บาท/กรัม' || case m.metal when 'brass' then ' (= ' || (m.price_thb_per_gram * 1000) || ' บาท/กก.)' else '' end
           || ' → ' || case when analytics.oem_metal_price_range_ok(m.metal, m.price_thb_per_gram) then 'อยู่ในช่วง' else 'นอกช่วง' end, E'\n      ' order by m.metal, m.as_of_date), count(*)
    into v_txt, v_n from analytics.oem_metal_price m where m.shop_id <> v_shop and m.metal in ('gold', 'brass');
  v := v || pg_temp.chk('R4', 'แถวราคาทอง/ทองเหลืองเดิมของจริง ' || v_n || ' แถว ทุกแถวอยู่ในช่วงที่เจ้าของเคาะ:' || E'\n      ' || coalesce(v_txt, '-'),
    not exists (select 1 from analytics.oem_metal_price m where m.shop_id <> v_shop and m.metal in ('gold', 'brass') and not analytics.oem_metal_price_range_ok(m.metal, m.price_thb_per_gram)));
  -- R5 SKU spot จริงทุกตัว: prefill metal_known=true · เงิน · เนื้อ/น้ำหนักจาก SKU
  select count(*), count(*) filter (where (analytics.production_item_prefill(p.shop_id, p.id) ->> 'metal_known') = 'true' and (analytics.production_item_prefill(p.shop_id, p.id) ->> 'metal') = 'silver'
                                            and (analytics.production_item_prefill(p.shop_id, p.id) ->> 'weight_g')::numeric = p.silver_weight_g)
    into v_n, v_n2 from public.product p where p.shop_id <> v_shop and p.is_active and p.cost_type = 'spot' and p.sku !~* '^live';
  v := v || pg_temp.chk('R5', 'SKU spot จริง ' || v_n || ' ตัว: prefill = silver · น้ำหนัก = silver_weight_g ของ SKU · metal_known=true ครบ (' || v_n2 || '/' || v_n || ')', v_n > 0 and v_n = v_n2);
  -- R6 รายการใบผลิตจริงผ่าน view: effective ทุกแถว = เงิน (ใบเดิมเงินทั้งหมด) · แถว spot มีน้ำหนัก effective
  select count(*), count(*) filter (where w.effective_metal = 'silver'), count(*) filter (where w.current_cost_type = 'spot' and w.effective_weight_g > 0)
    into v_n, v_n2, v_txt from analytics.v_production_order_item w where w.shop_id <> v_shop;
  v := v || pg_temp.chk('R6', 'รายการใบผลิตจริง ' || v_n || ' แถว: effective_metal=silver ' || v_n2 || ' แถว (ใบเดิมเงินล้วน) · แถว spot ที่มีน้ำหนัก effective ' || v_txt, v_n = v_n2 and v_n > 0);
  return v;
end;
$c$;

-- ============================================================================
-- M. mutant — ลบด่านทีละตัวแล้วเคสต้องล้มจริง (พิสูจน์ว่าเทสต์มีฟัน · ข้อ 17) · ทุก mutant อยู่ใน sub-block ที่ถอยกลับ
-- ============================================================================
create function pg_temp.g_mut() returns text
 language plpgsql as $c$
declare
  v text := '';
  v_shop uuid := pg_temp.fx('shop');
  p_fixa uuid := pg_temp.fx('fixa'); p_spot uuid := pg_temp.fx('spot'); p_bar uuid := pg_temp.fx('bar');
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_gold numeric := analytics.production_metal_price_resolve(pg_temp.fx('shop'), 'gold', null);
  o uuid; i1 uuid; r jsonb; si jsonb; v_res text;
begin
  -- M1 ลบด่านช่วงราคา (range_ok รับทุกค่า) → ทอง 1999.99 เข้าได้ = G1c ต้องล้ม
  begin
    perform pg_temp.mutate('analytics.oem_metal_price_range_ok(text,numeric)', 'select p_price is not null and case p_metal', 'select true or case p_metal');
    v_res := pg_temp.err(format('select analytics.oem_metal_price_set(%L, %L, 1999.99, date %L, %L)', v_shop, 'gold', '2026-05-01', 'manual'));
    v := v || pg_temp.chk('M1', 'mutant: ถอดด่านช่วงราคา → ทอง 1999.99 ผ่านเข้าตาราง (ผล ' || v_res || ') = เทสต์ G1c ล้มจริง', v_res = 'OK');
    raise exception 'rb_186';
  exception when others then if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('M1-crash', sqlstate || ' ' || sqlerrm, false); end if; end;

  -- M2 helper ไม่อ่านโลหะของรายการ (กลับไปอ่านจาก SKU) → ใบงานจากรายการทองได้ silver
  begin
    o := pg_temp.po(v_shop, 'M2');
    i1 := (pg_temp.iset(v_shop, o, p_fixa, 4, null, 'gold', 0.9, 3.2, 'input') ->> 'id')::uuid;
    perform pg_temp.mutate('analytics.production_item_spec(analytics.production_order_item,public.product,boolean)', 'coalesce(p_poi.metal, p_p.make_spec', 'coalesce(p_p.make_spec');
    si := pg_temp.q(format('select analytics.job_source_info(%L, %L, %L)', v_shop, 'production', i1));
    v := v || pg_temp.chk('M2', 'mutant: helper ไม่อ่าน metal ของรายการ → job_source_info รายการทองได้ metal=' || coalesce(si ->> 'metal', si ->> '_err') || ' (ไม่ใช่ gold) = เทสต์ J1a ล้มจริง', (si ->> 'metal') is distinct from 'gold');
    raise exception 'rb_186';
  exception when others then if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('M2-crash', sqlstate || ' ' || sqlerrm, false); end if; end;

  -- M3 ราคาของ "วันนี้" ถอยไปหยิบแถวเก่า (<=) → ปิดใบทองวันที่ไม่มีราคาได้ = D2c ต้องล้ม
  begin
    delete from analytics.oem_metal_price where shop_id = v_shop and metal = 'gold' and as_of_date = v_today;
    o := pg_temp.po(v_shop, 'M3');
    perform pg_temp.iset(v_shop, o, p_spot, 5, null, 'gold', 0.9, 3.2, 'input');
    perform pg_temp.mutate('analytics.production_metal_price_today(uuid,text)', 'as_of_date = (now()', 'as_of_date <= (now()');
    r := pg_temp.pv(v_shop, o);
    v_res := coalesce(pg_temp.dn(v_shop, o, null, r -> 'metal_prices') ->> 'status', 'ตก');
    v := v || pg_temp.chk('M3', 'mutant: ราคาวันนี้ fallback แถวเก่า → ใบทองปิดได้ทั้งที่ไม่มีราคาวันนี้ (ผล ' || v_res || ') = เทสต์ D2c ล้มจริง', v_res = 'done');
    raise exception 'rb_186';
  exception when others then if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('M3-crash', sqlstate || ' ' || sqlerrm, false); end if; end;

  -- M4 ถอด trigger ล็อกโลหะ → UPDATE ตรงบนรายการที่มีใบงานผ่าน = I10b ต้องล้ม
  begin
    perform analytics.job_stage_def_ensure(v_shop);
    perform analytics.job_record_profile_ensure(v_shop);
    o := pg_temp.po(v_shop, 'M4');
    i1 := (pg_temp.iset(v_shop, o, p_fixa, 4, null, 'gold', 0.9, 3.2, 'input') ->> 'id')::uuid;
    r := pg_temp.mkjob(v_shop, i1);
    perform pg_temp.mutate('analytics.production_order_item_deny_mutation()', 'if v_new_eff is distinct from v_old_eff then', 'if false then');
    v_res := pg_temp.err(format('update analytics.production_order_item set metal = %L, purity = 0.925 where id = %L', 'silver', i1));
    v := v || pg_temp.chk('M4', 'mutant: ถอดด่านล็อกโลหะใน trigger → เปลี่ยนโลหะรายการที่มีใบงานได้ (ผล ' || v_res || ') = เทสต์ I10b ล้มจริง', v_res = 'OK' and (r ->> 'job_id') is not null);
    raise exception 'rb_186';
  exception when others then if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('M4-crash', sqlstate || ' ' || sqlerrm, false); end if; end;

  -- M5 ค่าคงที่ 0.965 ผิด (0.96) → 29,420.92 ไม่ได้ 2000.0000 = G3a ต้องล้ม
  begin
    perform pg_temp.mutate('analytics.oem_metal_price_convert(text,numeric,text)', ':= 0.965;', ':= 0.96;');
    r := pg_temp.q(format('select analytics.oem_metal_price_set_input(%L, %L, 29420.92, %L)', v_shop, 'gold', 'assoc965_sell_per_baht'));
    v := v || pg_temp.chk('M5', 'mutant: ค่าคงที่เนื้อ 0.96 → 29,420.92 บาทละ ได้ ' || coalesce(r ->> 'price_thb_per_gram', r ->> '_err') || ' (ไม่ใช่ 2000.0000) = เทสต์ G3a ล้มจริง', (r ->> 'price_thb_per_gram')::numeric is distinct from 2000.0000);
    raise exception 'rb_186';
  exception when others then if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('M5-crash', sqlstate || ' ' || sqlerrm, false); end if; end;

  -- M6 ถอดด่าน sku_required ของ done → ใบที่มีรายการไม่มี SKU ไม่ตกที่ด่านนี้อีก (ไปตกกลางทางด้วยข้อความอื่น) = D1b ต้องล้ม
  begin
    o := pg_temp.po(v_shop, 'M6');
    perform pg_temp.iset(v_shop, o, null, 2, 'M6 ไม่มี SKU', 'silver');
    perform pg_temp.iset(v_shop, o, p_fixa, 3);
    perform pg_temp.mutate('analytics.production_order_done(uuid,uuid,jsonb,jsonb,uuid)', 'and i.product_id is null) then', 'and i.product_id is null and false) then');
    r := pg_temp.dn(v_shop, o, null, null);
    v := v || pg_temp.chk('M6', 'mutant: ถอด sku_required ของ done → ผล ' || pg_temp.hint(r) || ' (ไม่ใช่ sku_required) = เทสต์ D1b ล้มจริง', pg_temp.hint(r) <> '22023|sku_required');
    raise exception 'rb_186';
  exception when others then if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('M6-crash', sqlstate || ' ' || sqlerrm, false); end if; end;

  -- M7 ถอดการเทียบราคา M1 ของ done → ส่งราคาทองผิดแล้วปิดได้ = D3e ต้องล้ม
  begin
    o := pg_temp.po(v_shop, 'M7');
    perform pg_temp.iset(v_shop, o, p_spot, 5, null, 'gold', 0.9, 3.2, 'input');
    perform pg_temp.mutate('analytics.production_order_done(uuid,uuid,jsonb,jsonb,uuid)',
      'if not (abs((v_prices ->> v_metal)::numeric - (p_expected_metal_prices ->> v_metal)::numeric) <= 0.0001) then', 'if false then');
    r := pg_temp.dn(v_shop, o, null, jsonb_build_object('gold', v_gold + 500));
    v := v || pg_temp.chk('M7', 'mutant: ถอด M1 เทียบราคา → ส่งราคาทองผิด +500 แล้วปิดได้ (ผล ' || coalesce(r ->> 'status', pg_temp.hint(r)) || ') = เทสต์ D3e ล้มจริง', (r ->> 'status') = 'done');
    raise exception 'rb_186';
  exception when others then if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('M7-crash', sqlstate || ' ' || sqlerrm, false); end if; end;

  -- M8 helper เอาน้ำหนักเงินของ SKU ไปใช้กับทอง → D8a ต้องล้ม (ทอง spot ไม่มีน้ำหนักแล้วไม่ตก)
  begin
    o := pg_temp.po(v_shop, 'M8');
    perform pg_temp.iset(v_shop, o, p_spot, 2, null, 'gold', 0.9);
    perform pg_temp.mutate('analytics.production_item_spec(analytics.production_order_item,public.product,boolean)', 'case when v_metal = ''silver'' and p_p.silver_weight_g > 0', 'case when p_p.silver_weight_g > 0');
    r := pg_temp.pv(v_shop, o);
    v := v || pg_temp.chk('M8', 'mutant: น้ำหนักเงินของ SKU ติดไปเป็นน้ำหนักทอง → preview ทองไม่ตก weight_required อีก (ผล ' || pg_temp.hint(r) || ') = เทสต์ D8a ล้มจริง', pg_temp.hint(r) <> '22023|weight_required');
    raise exception 'rb_186';
  exception when others then if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('M8-crash', sqlstate || ' ' || sqlerrm, false); end if; end;

  -- M9 CHECK ไม่ใช่แค่ฟังก์ชัน: ถอด constraint ช่วงราคาของตาราง → insert ตรงทองนอกช่วงผ่าน = G9a ต้องล้ม
  begin
    execute 'alter table analytics.oem_metal_price drop constraint oem_metal_price_range_ck';
    v_res := pg_temp.err(format('insert into analytics.oem_metal_price (shop_id, metal, as_of_date, price_thb_per_gram) values (%L, %L, date %L, 9000)', v_shop, 'gold', '2026-05-02'));
    v := v || pg_temp.chk('M9', 'mutant: ถอด CHECK ช่วงราคาของตาราง → insert ตรงทอง 9000 ผ่าน (ผล ' || v_res || ') = เทสต์ G9a ล้มจริง', v_res = 'OK');
    raise exception 'rb_186';
  exception when others then if sqlerrm <> 'rb_186' then v := v || pg_temp.chk('M9-crash', sqlstate || ' ' || sqlerrm, false); end if; end;
  return v;
end;
$c$;

-- ============================================================================
-- runner
-- ============================================================================
do $v186$
declare
  v_msg text := E'\n=== verify 0186 ===\n';
  v_part text;
  v_out text;
  v_fail int; v_ok int; v_skip int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_msg := v_msg || pg_temp.g_setup();
  foreach v_part in array array['g_price', 'g_item', 'g_done', 'g_job', 'g_misc', 'g_sec', 'g_real', 'g_mut'] loop
    begin
      execute format('select pg_temp.%I()', v_part) into v_out;
      v_msg := v_msg || v_out;
    exception when others then
      v_msg := v_msg || format('[FAIL] %s-fatal  กลุ่มล้มทั้งกลุ่ม: %s %s', v_part, sqlstate, sqlerrm) || E'\n';
    end;
  end loop;
  v_fail := (length(v_msg) - length(replace(v_msg, '[FAIL]', ''))) / length('[FAIL]');
  v_skip := (length(v_msg) - length(replace(v_msg, '[SKIP]', ''))) / length('[SKIP]');
  v_ok := (length(v_msg) - length(replace(v_msg, '[OK]', ''))) / length('[OK]');
  v_msg := v_msg || format('--- สรุป: OK %s · FAIL %s · SKIP %s ---', v_ok, v_fail, v_skip);
  raise exception '%', v_msg;
end;
$v186$;
