-- scripts/verify/verify-0177.sql
-- ตรวจ supabase/migrations/0177_job_plan_rate_unit_fix.sql (แก้หน่วย % ของ rate ก้านต้น/อัตราเสียที่ 0175 หาร 100 ซ้ำ · S5 target_source · N11 · สูตรแผนโลหะที่เดียว)
-- self-rolling-back (3j-migration-traps ข้อ 11) · ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน · ข้อมูลทดสอบสร้างผ่าน RPC เท่านั้น (ใบเสนอราคา = โคลนจากรายการจริงในทรานแซกชันที่ถอยกลับ)
-- รอบแรก = ของจริง · รอบถัดไป = mutant 11 จุด (ทุกตัวต้องล้ม ไม่งั้น MX FAIL) · ปิดท้ายตรวจ state ไม่ขยับ
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0177.sql
-- dry-run ก่อน apply: cat supabase/migrations/0177_job_plan_rate_unit_fix.sql scripts/verify/verify-0177.sql > <tmp>.sql แล้วรันไม่ใส่ --commit
-- ทางแก้ใบเดิม (migration §5) ทดสอบแยก: cat scripts/verify/verify-0177-fixpath-pre.sql supabase/migrations/0177_job_plan_rate_unit_fix.sql scripts/verify/verify-0177-fixpath-post.sql
--
-- สูตรที่ใช้ (ระบุตามบรีฟ): oem_cost_rate เก็บ pct เป็นสัดส่วน 0..1 (เช่น cast 0.03 = 3%) · oem_cost_calc ใช้ตรง
--   จำนวนเผื่อแนะนำ = ceil(qty / ((1 - cast) * (1 - polish) * (1 - plate ถ้ามีชุบ)))   (ไม่ชุบ: สั่ง 30 + 0.03/0.02 -> ceil(31.56) = 32 · ชุบ 0.02 -> ceil(32.20) = 33)
--   แผนโลหะ = round(qty_planned * target * (1 + sprue_fraction), 3)   (sprue 0.05: 30 x 4.000 x 1.05 = 126.000)
--   ค่าที่ UI เห็น (หน่วย %): reject_basis.cast_pct = cast * 100 (3) · basis.sprue_loss_pct = sprue * 100 (5)
--   บั๊กเดิมของ 0175 (ใช้ตรวจว่าเทสต์แยกแยะได้): ไม่คูณ 100 -> สั่ง 30 ได้ 31 · แผน 30 x 4 x 1.0005 = 120.060 · cast_pct = 0.03
--
-- ============ ตารางแมป "ข้อในบรีฟ -> เทสต์ที่ครอบ" ============
--  ค่าจริงจาก DB: suggest สั่ง 30 ได้ ceil(สูตร) (ไม่ชุบ/ชุบ)  -> A0 (rate จริงเป็นสัดส่วน 0..<1) · A1 A2 (live) · F1 (fixture 0.03/0.02/0.02 -> 32 / 33 แน่นอน)
--  แผน = qty x target x 1.05 · basis.sprue_loss_pct = 5          -> A3 A4 (live) · F2 F3 (fixture: 126.000 · 134.400)
--  UI payload reject_basis.cast_pct = 3 (polish 2 · plate 2/null) -> A1 A2 F1
--  ฟังก์ชันที่ใช้ต่อ: job_qty_planned_set / job_plan_set (override) ไม่ชน plan_drift · ผลถูกหน่วย  -> A5 A6 A7
--  rate ไม่สมเหตุผลหลังคูณ 100: cast >= 1 (100%) / 1.5 / NaN / ติดลบ = ไม่มี rate · sprue > 5.0 / NaN = ไม่มี rate · sprue = 5.0 ผ่าน (ขอบ) -> F4 F4b F4c F5
--  S5 job_plan_set ไม่ทับ target_source เมื่อ target เท่าเดิม     -> S5a S5b (quote) · S5c S5d S5e (เปลี่ยน/ล้างแล้วตั้งใหม่ = input) · S5f (product)
--  N11 เหตุผลแผนเอง null/ว่าง/ล่องหน/จุด/emoji -> plan_reason_required เท่าเดิม · เหตุผลจริงผ่าน -> N11a N11b N11c
--  สูตรที่เดียว: compute เรียก job_plan_formula · ไม่มีสูตรซ้ำในฟังก์ชันไหน -> M2 · golden สูตร/assert/guard ไม่เปลี่ยน -> G1 G2
--  อ่าน rate ทางเดียว (job_rate_pct) · ไม่มีฟังก์ชัน job_* อ่าน oem_rate_value ตรง -> M1 M2
--  สิทธิ์ (ไม่ใช่แค่ has_function_privilege): authenticated/anon 42501 · helper ไม่มีใครรันได้ แม้ service_role -> M4
--  overload / 1 signature -> M3 · ใบที่ไม่ cancelled บนระบบจริงผ่าน job_plan_basis_assert ทุกใบ -> M5
--  ฟังก์ชันอื่นไม่ถูกแตะ (md5 ทุกตัวในสคีมา) · updated_at ใบเดิม/ใบ cancelled ไม่ขยับ -> assert ท้ายไฟล์ migration §7 + K0 (state ก่อน/หลัง) + G2 (pin md5)
--  mutant 11 จุด: MU-1..MU-11 (suggest อ่าน rate ไม่คูณ ×2 · compute ไม่คูณ · helper ผิด · S5 กลับเดิม · formula ผิด · guard < 100 ผ่อน · ช่วง sprue ผ่อน · N11 hint · helper ถูก grant · compute ไม่เรียก formula)
--
--  ❌ ไม่มีเทสต์ครอบใน verify นี้ (บอกตรงๆ):
--    - ทางแก้ใบเดิม (migration §5): บนระบบจริงไม่มีใบเข้าเงื่อนไข (มีแต่ JB-0026/27 ที่ cancelled — ปล่อยไว้) จึงไม่ได้ยิงจริง · ทดสอบด้วยชุด verify-0177-fixpath-pre/post (สร้างใบผิดหน่วยด้วย 0175 เดิมก่อน migration แล้วเช็คหลังแก้)
--    - ใบ done / ขั้นหล่อรับแล้วที่แผนผิดหน่วย ในชุด fixpath ครอบเฉพาะใบ open (ปิดงานต้องเดินครบทุกขั้น) — โค้ดแก้ไม่แยกสถานะ (ปิด trigger แล้วแก้ทุกใบที่ไม่ cancelled)
--    - pre-check md5 ของ migration + รัน migration ซ้ำ -> ครอบด้วยการรัน migration 2 รอบในทรานแซกชันเดียว (scratch) ตอนเขียน ไม่ได้อยู่ในไฟล์นี้
--    - race หลาย connection (job_plan_set พร้อมช่างรับขั้นหล่อ) = ไม่เปลี่ยนจาก 0175 (job_office_begin for update)
--    - UI/แสดงผลหน่วย % ฝั่ง TS = ไม่มี (frontend) · TS ที่ทดสอบด้วยค่า mock หน่วยเก่า (ถ้ามี) ต้องไล่เอง

create function pg_temp.chk(p_id text, p_desc text, p_ok boolean) returns text
 language sql as $c$
  select format('[%s] %s  %s', case when coalesce(p_ok, false) then 'OK' else 'FAIL' end, p_id, p_desc) || E'\n'
$c$;

-- รัน SQL ที่คืน jsonb · error -> {_err,_state,_hint}
create function pg_temp.q(p_sql text) returns jsonb
 language plpgsql as $c$
declare
  v jsonb; v_msg text; v_state text; v_hint text;
begin
  execute p_sql into v;
  return coalesce(v, '{}'::jsonb);
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
  return jsonb_build_object('_err', v_msg, '_state', v_state, '_hint', v_hint);
end;
$c$;

create function pg_temp.std() returns text[] language sql as $c$
  select array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'polish', 'qc', 'pack'] $c$;

create function pg_temp.as_role(p_role text, p_sql text) returns text
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
  return 'ERR:' || v_state || ':' || v_msg;
end;
$c$;

-- โคลนดีล OEM (ใบเสนอราคา 1 ใบ + รายการเดียว) จากรายการแม่แบบจริง · p_extra = ฟิลด์เพิ่มใน input (เช่น weight_g เป็นที่มาของ target_source = quote)
create function pg_temp.clone_deal(p_tpl_item uuid, p_metal text, p_qty int, p_extra jsonb default '{}'::jsonb) returns jsonb
 language plpgsql as $c$
declare
  v_q   uuid := gen_random_uuid();
  v_i   uuid := gen_random_uuid();
  v_item  analytics.oem_quote_item;
  v_quote analytics.oem_quote;
  v_input jsonb;
begin
  select * into v_item from analytics.oem_quote_item where id = p_tpl_item;
  select * into v_quote from analytics.oem_quote where id = v_item.quote_id;
  v_input := (v_item.input - 'weight_g') || jsonb_build_object('metal', p_metal, 'is_new_design', false) || p_extra;
  insert into analytics.oem_quote
    select (jsonb_populate_record(null::analytics.oem_quote,
      to_jsonb(v_quote) || jsonb_build_object('id', v_q, 'quote_no', 'V177-' || substr(v_q::text, 1, 8), 'status', 'won',
        'root_quote_id', v_q, 'parent_quote_id', null))).*;
  insert into analytics.oem_quote_item
    select (jsonb_populate_record(null::analytics.oem_quote_item,
      to_jsonb(v_item) || jsonb_build_object('id', v_i, 'quote_id', v_q, 'seq', 1, 'input', v_input, 'qty', p_qty))).*;
  return jsonb_build_object('quote_id', v_q, 'item_id', v_i);
end;
$c$;

create function pg_temp.jc(p_shop uuid, p_item uuid, p_plan_qty int default null, p_target text default null,
                           p_ov text default null, p_reason text default null, p_codes text[] default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_create_from_quote_item(p_shop_id=>%L, p_quote_item_id=>%L, p_stage_codes=>%L::text[],
      p_start_gate_note=>%L, p_design_label=>%L, p_actor=>%L, p_qty_planned=>%L, p_target_piece_g=>%L::numeric,
      p_metal_plan_override_g=>%L::numeric, p_metal_plan_reason=>%L)',
      p_shop, p_item, coalesce(p_codes, pg_temp.std()), 'verify: เริ่มผลิตก่อนมัดจำ', 'v177-ชื่อเรียกภายใน',
      '00000000-0000-0000-0000-0000000000a1'::uuid, p_plan_qty, p_target, p_ov, p_reason)) $c$;

-- โคลนดีล + สร้างใบงาน -> {job_id, ..., item_id}
create function pg_temp.mkj(p_shop uuid, p_tpl uuid, p_metal text, p_qty int, p_plan_qty int default null, p_target text default null,
                            p_ov text default null, p_reason text default null, p_extra jsonb default '{}'::jsonb) returns jsonb
 language plpgsql as $c$
declare d jsonb;
begin
  d := pg_temp.clone_deal(p_tpl, p_metal, p_qty, p_extra);
  return d || pg_temp.jc(p_shop, (d ->> 'item_id')::uuid, p_plan_qty, p_target, p_ov, p_reason);
end;
$c$;

create function pg_temp.ps(p_shop uuid, p_item uuid, p_qty int default null, p_target text default null, p_codes text[] default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_plan_suggest(p_shop_id=>%L, p_source_kind=>%L, p_item_id=>%L, p_qty_planned=>%L, p_target_piece_g=>%L::numeric, p_stage_codes=>%L::text[])',
    p_shop, 'oem', p_item, p_qty, p_target, p_codes)) $c$;

create function pg_temp.pset(p_shop uuid, p_job uuid, p_target text, p_ov text default null, p_reason text default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_plan_set(p_shop_id=>%L, p_job_id=>%L, p_target_piece_g=>%L::numeric, p_override_g=>%L::numeric, p_override_reason=>%L, p_actor=>%L)',
    p_shop, p_job, p_target, p_ov, p_reason, '00000000-0000-0000-0000-0000000000a1'::uuid)) $c$;

create function pg_temp.qset(p_shop uuid, p_job uuid, p_qty int) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_qty_planned_set(p_shop_id=>%L, p_job_id=>%L, p_qty_planned=>%L, p_actor=>%L)',
    p_shop, p_job, p_qty, '00000000-0000-0000-0000-0000000000a1'::uuid)) $c$;

-- job_plan_basis_assert ผ่านไหม (void -> true/false)
create function pg_temp.assert_ok(p_job uuid) returns boolean
 language plpgsql as $c$
declare j analytics.job;
begin
  select * into j from analytics.job where id = p_job;
  perform analytics.job_plan_basis_assert(j);
  return true;
exception when others then
  return false;
end;
$c$;

-- ตั้ง rate ทดสอบ (วันนี้ของไทย = แถวล่าสุดที่ใช้) — ถอยกลับพร้อม section
create function pg_temp.setrate(p_shop uuid, p_key text, p_scope text, p_val numeric) returns void
 language sql as $c$
  insert into analytics.oem_cost_rate (shop_id, rate_key, scope, effective_from, value, note)
  values (p_shop, p_key, p_scope, analytics.job_today(), p_val, 'v177 fixture')
  on conflict (shop_id, rate_key, scope, effective_from) do update set value = excluded.value $c$;

-- ============================================================================
-- Section A — rate จริงบน DB (สัดส่วน 0..1) · ผลต้องตรงสูตรของบรีฟ (คำนวณจาก oem_rate_value ตรง ไม่ผ่าน job_rate_pct)
-- ============================================================================
create function pg_temp.sa(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  v_today date := analytics.job_today();
  d jsonb; r jsonb; r2 jsonb; r3 jsonb; v_item uuid; v_job uuid; v_j analytics.job;
  v_rc numeric; v_rp numeric; v_rpl numeric; v_sp numeric;
  v_exp int; v_exp_pl int; v_old int; v_plan numeric; v_e text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_rc := analytics.oem_rate_value(p_shop, 'reject_rate_cast_pct', '-', v_today);
  v_rp := analytics.oem_rate_value(p_shop, 'reject_rate_polish_pct', '-', v_today);
  v_rpl := analytics.oem_rate_value(p_shop, 'reject_rate_plate_pct', '-', v_today);
  v_sp := analytics.oem_rate_value(p_shop, 'sprue_loss_pct', 'silver', v_today);
  v_log := v_log || pg_temp.chk('A0', format('rate จริงอยู่ในรูปสัดส่วน 0..<1 ทุกตัว (ฐานของการแก้): cast %s polish %s plate %s sprue[silver] %s', v_rc, v_rp, v_rpl, v_sp),
    v_rc >= 0 and v_rc < 1 and v_rp >= 0 and v_rp < 1 and v_rpl >= 0 and v_rpl < 1 and v_sp >= 0 and v_sp < 1);
  if not (v_rc is not null and v_rp is not null and v_rpl is not null and v_sp is not null) then
    return v_log || '[FAIL] A0x  ไม่มี rate จริงครบ — ข้าม section A' || E'\n';
  end if;

  d := pg_temp.clone_deal(p_tpl, 'silver', 30);
  v_item := (d ->> 'item_id')::uuid;
  v_exp := ceil(30 / ((1 - v_rc) * (1 - v_rp)))::int;
  v_exp_pl := ceil(30 / ((1 - v_rc) * (1 - v_rp) * (1 - v_rpl)))::int;
  v_old := ceil(30 / ((1 - v_rc / 100) * (1 - v_rp / 100)))::int;  -- ค่าที่บั๊ก 0175 ให้

  r := pg_temp.ps(p_shop, v_item, null, null, pg_temp.std());
  v_log := v_log || pg_temp.chk('A1', format('suggest สั่ง 30 (ไม่ชุบ) = ceil(30/((1-cast)(1-polish))) = %s (ไม่ใช่ค่าบั๊กเดิม %s) · reject_basis.cast_pct = %s (หน่วย %%) polish_pct = %s plate_pct = null has_plating = false',
      v_exp, v_old, v_rc * 100, v_rp * 100),
    (r ->> 'qty_planned_suggest')::int = v_exp and (v_exp <> v_old or v_rc = 0)
    and (r ->> 'buffer_qty')::int = v_exp - 30 and (r ->> 'qty_planned_eff')::int = v_exp
    and (r #>> '{reject_basis,cast_pct}')::numeric = v_rc * 100 and (r #>> '{reject_basis,polish_pct}')::numeric = v_rp * 100
    and jsonb_typeof(r #> '{reject_basis,plate_pct}') = 'null' and (r #>> '{reject_basis,has_plating}') = 'false'
    and r -> 'missing' = '[]'::jsonb);

  r2 := pg_temp.ps(p_shop, v_item, null, null, pg_temp.std() || array['plating']);
  v_log := v_log || pg_temp.chk('A2', format('suggest สั่ง 30 (ชุบ) = ceil(30/((1-cast)(1-polish)(1-plate))) = %s · plate_pct = %s', v_exp_pl, v_rpl * 100),
    (r2 ->> 'qty_planned_suggest')::int = v_exp_pl and (r2 #>> '{reject_basis,plate_pct}')::numeric = v_rpl * 100
    and (r2 #>> '{reject_basis,has_plating}') = 'true' and (r2 #>> '{reject_basis,cast_pct}')::numeric = v_rc * 100);

  r3 := pg_temp.ps(p_shop, v_item, null, '4.000', pg_temp.std());
  v_plan := round(v_exp * 4.000 * (1 + v_sp), 3);
  v_log := v_log || pg_temp.chk('A3', format('suggest + target 4.000: แผน = round(%s x 4.000 x (1+%s), 3) = %s · basis.sprue_loss_pct = %s (หน่วย %%) · formula เดิม', v_exp, v_sp, v_plan, v_sp * 100),
    (r3 ->> 'metal_plan_g')::numeric = v_plan and (r3 #>> '{metal_plan_basis,sprue_loss_pct}')::numeric = v_sp * 100
    and (r3 #>> '{metal_plan_basis,computed_g}')::numeric = v_plan
    and (r3 #>> '{metal_plan_basis,formula}') = 'qty_planned*target_piece_g*(1+sprue_loss_pct/100)');

  d := pg_temp.mkj(p_shop, p_tpl, 'silver', 30, 30, '4.000');
  v_job := (d ->> 'job_id')::uuid;
  select * into v_j from analytics.job where id = v_job;
  v_plan := round(30 * 4.000 * (1 + v_sp), 3);
  v_log := v_log || pg_temp.chk('A4', format('สร้างใบงาน qty 30 target 4.000: metal_plan_g = %s · basis.sprue_loss_pct = %s · computed_g = %s · job_plan_basis_assert ผ่าน', v_plan, v_sp * 100, v_plan),
    v_job is not null and v_j.metal_plan_g = v_plan and (v_j.metal_plan_basis ->> 'sprue_loss_pct')::numeric = v_sp * 100
    and (v_j.metal_plan_basis ->> 'computed_g')::numeric = v_plan and (d ->> 'metal_plan_g')::numeric = v_plan
    and pg_temp.assert_ok(v_job));

  r := pg_temp.qset(p_shop, v_job, 40);
  select * into v_j from analytics.job where id = v_job;
  v_plan := round(40 * 4.000 * (1 + v_sp), 3);
  v_log := v_log || pg_temp.chk('A5', format('ต้องไม่พัง: job_qty_planned_set 40 (UPDATE ผ่าน job_guard/plan_drift) -> แผน = %s · basis ตรง', v_plan),
    not (r ? '_err') and v_j.qty_planned = 40 and v_j.metal_plan_g = v_plan and (v_j.metal_plan_basis ->> 'computed_g')::numeric = v_plan
    and (v_j.metal_plan_basis ->> 'sprue_loss_pct')::numeric = v_sp * 100);

  r := pg_temp.pset(p_shop, v_job, '3.000');
  select * into v_j from analytics.job where id = v_job;
  v_plan := round(40 * 3.000 * (1 + v_sp), 3);
  v_log := v_log || pg_temp.chk('A6', format('job_plan_set target 3.000 -> แผน = %s · target_source = input', v_plan),
    not (r ? '_err') and v_j.metal_plan_g = v_plan and (v_j.metal_plan_basis ->> 'target_source') = 'input');

  r := pg_temp.pset(p_shop, v_job, '3.000', '200.000', 'verify กำหนดเอง');
  select * into v_j from analytics.job where id = v_job;
  v_log := v_log || pg_temp.chk('A7', 'job_plan_set override 200 + เหตุผล -> แผน = 200 · override_g = 200 · computed_g ยังตามสูตรหน่วยถูก',
    not (r ? '_err') and v_j.metal_plan_g = 200 and (v_j.metal_plan_basis ->> 'override_g')::numeric = 200
    and (v_j.metal_plan_basis ->> 'computed_g')::numeric = round(40 * 3.000 * (1 + v_sp), 3));
  return v_log;
end;
$s$;

-- ============================================================================
-- Section F — rate fixture (cast 0.03 · polish 0.02 · plate 0.02 · sprue เงิน 0.05) -> เลขสัมบูรณ์ตามบรีฟ + ขอบเขต rate ไม่สมเหตุผล
-- ============================================================================
create function pg_temp.sf(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  d jsonb; r jsonb; r2 jsonb; v_item uuid; v_j analytics.job; v_bad text; k text; v_e text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform pg_temp.setrate(p_shop, 'reject_rate_cast_pct', '-', 0.03);
  perform pg_temp.setrate(p_shop, 'reject_rate_polish_pct', '-', 0.02);
  perform pg_temp.setrate(p_shop, 'reject_rate_plate_pct', '-', 0.02);
  perform pg_temp.setrate(p_shop, 'sprue_loss_pct', 'silver', 0.05);
  d := pg_temp.clone_deal(p_tpl, 'silver', 30);
  v_item := (d ->> 'item_id')::uuid;

  r := pg_temp.ps(p_shop, v_item, null, null, pg_temp.std());
  r2 := pg_temp.ps(p_shop, v_item, null, null, pg_temp.std() || array['plating']);
  v_log := v_log || pg_temp.chk('F1', 'สั่ง 30 + cast 0.03 / polish 0.02: ไม่ชุบ = 32 · ชุบ (plate 0.02) = 33 · UI payload cast_pct = 3 · polish_pct = 2 · plate_pct = 2 (ชุบ) / null (ไม่ชุบ)',
    (r ->> 'qty_planned_suggest')::int = 32 and (r ->> 'buffer_qty')::int = 2 and (r #>> '{reject_basis,cast_pct}')::numeric = 3 and (r #>> '{reject_basis,polish_pct}')::numeric = 2
    and jsonb_typeof(r #> '{reject_basis,plate_pct}') = 'null'
    and (r2 ->> 'qty_planned_suggest')::int = 33 and (r2 #>> '{reject_basis,plate_pct}')::numeric = 2 and (r2 #>> '{reject_basis,cast_pct}')::numeric = 3);

  d := pg_temp.mkj(p_shop, p_tpl, 'silver', 30, 30, '4.000');
  select * into v_j from analytics.job where id = (d ->> 'job_id')::uuid;
  v_log := v_log || pg_temp.chk('F2', 'ใบงาน 30 x 4.000 + sprue 0.05: metal_plan_g = 126.000 (= qty x target x 1.05) · basis.sprue_loss_pct = 5 · computed_g = 126.000 (ไม่ใช่ 120.060 ของบั๊กเดิม)',
    v_j.metal_plan_g = 126.000 and (v_j.metal_plan_basis ->> 'sprue_loss_pct')::numeric = 5 and (v_j.metal_plan_basis ->> 'computed_g')::numeric = 126.000);

  r := pg_temp.ps(p_shop, v_item, null, '4.000', pg_temp.std());
  v_log := v_log || pg_temp.chk('F3', 'suggest ไม่ส่ง qty (ใช้ที่แนะนำ 32) + target 4.000: แผน = 32 x 4 x 1.05 = 134.400 · basis.sprue_loss_pct = 5',
    (r ->> 'qty_planned_eff')::int = 32 and (r ->> 'metal_plan_g')::numeric = 134.400 and (r #>> '{metal_plan_basis,sprue_loss_pct}')::numeric = 5);

  -- F4 rate reject ไม่สมเหตุผลหลังคูณ 100 (cast >= 100% · ติดลบไม่มีใน numeric check แต่ NaN มี) = ไม่มี rate · suggest = null + missing (ไม่หารศูนย์/ติดลบ)
  v_bad := '';
  foreach k in array array['1.0000', '1.5000', '100.0000', 'NaN'] loop
    perform pg_temp.setrate(p_shop, 'reject_rate_cast_pct', '-', k::numeric);
    r := pg_temp.ps(p_shop, v_item, null, null, pg_temp.std());
    if not (jsonb_typeof(r -> 'qty_planned_suggest') = 'null' and r -> 'missing' @> '["reject_rate_cast_pct[-]"]'::jsonb and jsonb_typeof(r #> '{reject_basis,cast_pct}') = 'null') then
      v_bad := v_bad || ' cast=' || k;
    end if;
  end loop;
  perform pg_temp.setrate(p_shop, 'reject_rate_cast_pct', '-', 0.03);
  v_log := v_log || pg_temp.chk('F4', 'cast = 1.0 (=100%) / 1.5 / 100 / NaN: suggest = jsonb null + missing ระบุ cast + cast_pct = null (ไม่หารศูนย์/ติดลบ) ' || v_bad, v_bad = '');

  v_bad := '';
  foreach k in array array['1.0000', 'NaN'] loop
    perform pg_temp.setrate(p_shop, 'reject_rate_polish_pct', '-', k::numeric);
    r := pg_temp.ps(p_shop, v_item, null, null, pg_temp.std());
    if not (jsonb_typeof(r -> 'qty_planned_suggest') = 'null' and r -> 'missing' @> '["reject_rate_polish_pct[-]"]'::jsonb) then v_bad := v_bad || ' polish=' || k; end if;
    perform pg_temp.setrate(p_shop, 'reject_rate_polish_pct', '-', 0.02);
    perform pg_temp.setrate(p_shop, 'reject_rate_plate_pct', '-', k::numeric);
    r := pg_temp.ps(p_shop, v_item, null, null, pg_temp.std() || array['plating']);
    if not (jsonb_typeof(r -> 'qty_planned_suggest') = 'null' and r -> 'missing' @> '["reject_rate_plate_pct[-]"]'::jsonb) then v_bad := v_bad || ' plate=' || k; end if;
    perform pg_temp.setrate(p_shop, 'reject_rate_plate_pct', '-', 0.02);
  end loop;
  v_log := v_log || pg_temp.chk('F4b', 'polish / plate = 1.0 (100%) หรือ NaN: ไม่มี rate -> suggest null + missing ตรงตัว ' || v_bad, v_bad = '');

  perform pg_temp.setrate(p_shop, 'reject_rate_cast_pct', '-', 0.9900);
  r := pg_temp.ps(p_shop, v_item, null, null, pg_temp.std());
  v_log := v_log || pg_temp.chk('F4c', 'ต้องไม่พัง: cast = 0.99 (99% — ยังสมเหตุผล) -> suggest = ceil(30/(0.01 x 0.98)) = 3062 · cast_pct = 99',
    (r ->> 'qty_planned_suggest')::int = 3062 and (r #>> '{reject_basis,cast_pct}')::numeric = 99);
  perform pg_temp.setrate(p_shop, 'reject_rate_cast_pct', '-', 0.03);

  -- F5 sprue: ขอบ 500% ผ่าน (5.0) · เกิน (5.0001 / 6 / NaN) = ไม่มี rate (ไม่ใช่ error · ไม่ใช่ plan ใหญ่ผิดๆ) · ไม่มี row = missing
  v_bad := '';
  perform pg_temp.setrate(p_shop, 'sprue_loss_pct', 'silver', 5.0000);
  r := pg_temp.q(format('select analytics.job_plan_compute(%L, %L, 30, 4.000, null, null, %L)', p_shop, 'silver', 'input'));
  if not ((r ->> 'metal_plan_g')::numeric = 720.000 and (r #>> '{basis,sprue_loss_pct}')::numeric = 500) then v_bad := v_bad || ' ขอบ5.0'; end if;
  foreach k in array array['5.0001', '6.0000', 'NaN'] loop
    perform pg_temp.setrate(p_shop, 'sprue_loss_pct', 'silver', k::numeric);
    r := pg_temp.q(format('select analytics.job_plan_compute(%L, %L, 30, 4.000, null, null, %L)', p_shop, 'silver', 'input'));
    if not (jsonb_typeof(r -> 'metal_plan_g') = 'null' and r #> '{basis,missing}' = '["sprue_loss_pct[silver]"]'::jsonb and jsonb_typeof(r #> '{basis,sprue_loss_pct}') = 'null'
            and jsonb_typeof(r #> '{basis,computed_g}') = 'null') then
      v_bad := v_bad || ' sprue=' || k;
    end if;
  end loop;
  perform pg_temp.setrate(p_shop, 'sprue_loss_pct', 'silver', 0.05);
  delete from analytics.oem_cost_rate where shop_id = p_shop and rate_key = 'sprue_loss_pct' and scope = 'silver';
  r := pg_temp.q(format('select analytics.job_plan_compute(%L, %L, 30, 4.000, null, null, %L)', p_shop, 'silver', 'input'));
  if not (jsonb_typeof(r -> 'metal_plan_g') = 'null' and r #> '{basis,missing}' = '["sprue_loss_pct[silver]"]'::jsonb) then v_bad := v_bad || ' ไม่มีrow'; end if;
  v_log := v_log || pg_temp.chk('F5', 'sprue 5.0 (500%) ผ่าน = 720.000 · 5.0001 / 6 / NaN / ไม่มี row = ไม่มี rate: metal_plan_g jsonb null + missing[sprue_loss_pct[silver]] (ไม่ใช่ 0 ไม่ใช่ error) ' || v_bad, v_bad = '');
  return v_log;
end;
$s$;

-- ============================================================================
-- Section S — S5: job_plan_set ไม่ทับ target_source เมื่อ target เท่าเดิม
-- ============================================================================
create function pg_temp.ss(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  d jsonb; r jsonb; v_job uuid; v_j analytics.job; v_prod uuid; v_po jsonb; v_poi uuid; v_pj jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform pg_temp.setrate(p_shop, 'sprue_loss_pct', 'silver', 0.05);
  -- ใบที่ target มาจากใบเสนอราคา (input.weight_g = 4.000 · ไม่ส่ง target ตอนสร้าง) = target_source quote
  d := pg_temp.mkj(p_shop, p_tpl, 'silver', 30, 30, null, null, null, '{"weight_g": 4.000}'::jsonb);
  v_job := (d ->> 'job_id')::uuid;
  select * into v_j from analytics.job where id = v_job;
  if not (v_j.target_piece_g = 4.000 and (v_j.metal_plan_basis ->> 'target_source') = 'quote') then
    return pg_temp.chk('S5-0', 'fixture: ใบจากใบเสนอราคา target 4.000 ที่มา quote ' || coalesce(d::text, 'null'), false);
  end if;

  r := pg_temp.pset(p_shop, v_job, '4.000', '200.000', 'verify กำหนดเองโลหะ');
  select * into v_j from analytics.job where id = v_job;
  v_log := v_log || pg_temp.chk('S5a', 'target เท่าเดิม (4.000) + override: target_source ยัง quote (ไม่ถูกทับเป็น input) · override_g = 200',
    not (r ? '_err') and (v_j.metal_plan_basis ->> 'target_source') = 'quote' and v_j.metal_plan_g = 200);

  r := pg_temp.pset(p_shop, v_job, '4.000');
  select * into v_j from analytics.job where id = v_job;
  v_log := v_log || pg_temp.chk('S5b', 'target เท่าเดิม ล้าง override: target_source ยัง quote · override_g = null · แผน = 30 x 4 x 1.05 = 126.000',
    not (r ? '_err') and (v_j.metal_plan_basis ->> 'target_source') = 'quote' and jsonb_typeof(v_j.metal_plan_basis -> 'override_g') = 'null' and v_j.metal_plan_g = 126.000);

  r := pg_temp.pset(p_shop, v_job, '5.000');
  select * into v_j from analytics.job where id = v_job;
  v_log := v_log || pg_temp.chk('S5c', 'เปลี่ยน target เป็น 5.000: target_source = input · แผน = 30 x 5 x 1.05 = 157.500',
    not (r ? '_err') and (v_j.metal_plan_basis ->> 'target_source') = 'input' and v_j.metal_plan_g = 157.500);

  r := pg_temp.pset(p_shop, v_job, '5.000', '160.000', 'verify กำหนดเองรอบสอง');
  select * into v_j from analytics.job where id = v_job;
  v_log := v_log || pg_temp.chk('S5d', 'target เท่าเดิม (5.000 ที่มา input) + override: ยัง input (ไม่กลายเป็นค่าอื่น/null)',
    not (r ? '_err') and (v_j.metal_plan_basis ->> 'target_source') = 'input' and v_j.metal_plan_g = 160);

  r := pg_temp.pset(p_shop, v_job, null);
  select * into v_j from analytics.job where id = v_job;
  v_log := v_log || pg_temp.chk('S5e1', 'ล้างแผน (target null): target/แผน/basis เป็น null',
    not (r ? '_err') and v_j.target_piece_g is null and v_j.metal_plan_g is null and v_j.metal_plan_basis is null);
  r := pg_temp.pset(p_shop, v_job, '4.000');
  select * into v_j from analytics.job where id = v_job;
  v_log := v_log || pg_temp.chk('S5e', 'ตั้ง target 4.000 ใหม่หลังล้าง (target เปลี่ยนจาก null): target_source = input (ไม่กลับเป็น quote จากอดีต)',
    not (r ? '_err') and (v_j.metal_plan_basis ->> 'target_source') = 'input' and v_j.metal_plan_g = 126.000);

  -- S5f: ใบผลิตเข้าสต็อก — target จากสินค้า (product) ต้องคงเมื่อ target เท่าเดิม
  select p.id into v_prod from public.product p
   where p.shop_id = p_shop and p.is_active and p.sku !~* '^live' and p.cost_type in ('fixed', 'spot') and p.silver_weight_g > 0 and p.silver_weight_g <= 10000 and p.silver_weight_g = round(p.silver_weight_g, 3)
   order by p.sku limit 1;
  if v_prod is null then
    v_log := v_log || '[SKIP] S5f  ไม่มีสินค้า silver_weight_g ใช้เป็น target (ไม่ครอบที่มา product)' || E'\n';
  else
    update analytics.production_order_counter set last_no = greatest(last_no, (select coalesce(max(seq), 0) from analytics.production_order where shop_id = p_shop)) where shop_id = p_shop;
    v_po := analytics.production_order_save(p_shop_id => p_shop, p_note => 'verify0177');
    perform analytics.production_order_item_set(p_shop, (v_po ->> 'id')::uuid, v_prod, 10);
    select id into v_poi from analytics.production_order_item where production_order_id = (v_po ->> 'id')::uuid;
    v_pj := pg_temp.q(format('select analytics.job_create_from_production_item(p_shop_id=>%L, p_production_order_item_id=>%L, p_stage_codes=>%L::text[], p_actor=>%L, p_qty_planned=>%L)',
             p_shop, v_poi, pg_temp.std(), '00000000-0000-0000-0000-0000000000a1'::uuid, 10));
    select * into v_j from analytics.job where id = (v_pj ->> 'job_id')::uuid;
    if (v_j.metal_plan_basis ->> 'target_source') is distinct from 'product' then
      v_log := v_log || pg_temp.chk('S5f-0', 'fixture ใบผลิต: target_source = product ' || coalesce(v_pj::text, 'null'), false);
    else
      r := pg_temp.pset(p_shop, v_j.id, v_j.target_piece_g::text, (v_j.metal_plan_g + 1)::text, 'verify กำหนดเองใบผลิต');
      select * into v_j from analytics.job where id = v_j.id;
      v_log := v_log || pg_temp.chk('S5f', 'ใบผลิต (target จากสินค้า) + target เท่าเดิม + override: target_source ยัง product',
        not (r ? '_err') and (v_j.metal_plan_basis ->> 'target_source') = 'product');
    end if;
  end if;
  return v_log;
end;
$s$;

-- ============================================================================
-- Section N — N11: เหตุผลแผนที่กำหนดเอง (ลบ pre-check ซ้ำ) ผลต้องเท่าเดิมทุกอินพุต
-- ============================================================================
create function pg_temp.sn(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  r jsonb; v_bad text := ''; k text; i int;
  c_bad constant text[] := array[null, '', '   ', E'\t', E' ', E'　', '.', '👍', E'​', E'⠀', E'ก\nข'];
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform pg_temp.setrate(p_shop, 'sprue_loss_pct', 'silver', 0.05);
  for i in 1 .. cardinality(c_bad) loop
    r := pg_temp.q(format('select analytics.job_plan_compute(%L, %L, 10, 4.000, 50.000, %L, %L)', p_shop, 'silver', c_bad[i], 'input'));
    if not ((r ->> '_hint') = 'plan_reason_required' and (r ->> '_state') = '22023') then
      v_bad := v_bad || format(' [%s]=%s/%s', i, r ->> '_state', r ->> '_hint');
    end if;
  end loop;
  v_log := v_log || pg_temp.chk('N11a', 'override โดยเหตุผล null / ว่าง / ช่องว่าง / tab / NBSP / ช่องว่างกว้าง / "." / emoji / zero-width / U+2800 / ขึ้นบรรทัด: 22023 hint plan_reason_required ทุกแบบ ' || v_bad, v_bad = '');

  r := pg_temp.q(format('select analytics.job_plan_compute(%L, %L, 10, 4.000, 50.000, %L, %L)', p_shop, 'silver', '  เหตุผลทดสอบจริง  ', 'input'));
  v_log := v_log || pg_temp.chk('N11b', 'ต้องไม่พัง: เหตุผลจริง (มีช่องว่างหัวท้าย) ผ่าน · basis.override_reason ถูก trim · แผน = 50',
    not (r ? '_err') and (r #>> '{basis,override_reason}') = 'เหตุผลทดสอบจริง' and (r ->> 'metal_plan_g')::numeric = 50
    and (r #>> '{basis,computed_g}')::numeric = round(10 * 4.000 * 1.05, 3));

  r := pg_temp.q(format('select analytics.job_plan_compute(%L, %L, 10, 4.000, null, %L, %L)', p_shop, 'silver', 'มีเหตุผลแต่ไม่มี override', 'input'));
  v_log := v_log || pg_temp.chk('N11c', 'เหตุผลโดยไม่มี override ยังตก plan_override_missing (เดิม) · ไม่มี override ไม่มีเหตุผลผ่านปกติ',
    (r ->> '_hint') = 'plan_override_missing'
    and (pg_temp.q(format('select analytics.job_plan_compute(%L, %L, 10, 4.000, null, null, %L)', p_shop, 'silver', 'input')) ->> 'metal_plan_g')::numeric = 42.000);
  return v_log;
end;
$s$;

-- ============================================================================
-- Section M — คุณสมบัติของ migration: ทางอ่าน rate เดียว · สูตรที่เดียว · overload · สิทธิ์ (พฤติกรรมจริง) · golden · ใบจริง
-- ============================================================================
create function pg_temp.sm(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  v_today date := analytics.job_today();
  v_bad text := ''; k text; v_n int; v_x text; v_def text; r record;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  -- M1 job_rate_pct = oem_rate_value x 100 ทุก key · key ไม่มี/null = null
  for k in select unnest(array['reject_rate_cast_pct', 'reject_rate_polish_pct', 'reject_rate_plate_pct']) loop
    if analytics.job_rate_pct(p_shop, k, '-', v_today) is distinct from analytics.oem_rate_value(p_shop, k, '-', v_today) * 100 then v_bad := v_bad || ' ' || k; end if;
  end loop;
  if analytics.job_rate_pct(p_shop, 'sprue_loss_pct', 'silver', v_today) is distinct from analytics.oem_rate_value(p_shop, 'sprue_loss_pct', 'silver', v_today) * 100 then v_bad := v_bad || ' sprue'; end if;
  perform pg_temp.setrate(p_shop, 'reject_rate_cast_pct', '-', 0.03);
  if analytics.job_rate_pct(p_shop, 'reject_rate_cast_pct', '-', v_today) <> 3 then v_bad := v_bad || ' cast0.03!=3'; end if;
  if analytics.job_rate_pct(p_shop, 'ไม่มี_key_นี้', '-', v_today) is not null or analytics.job_rate_pct(null, 'reject_rate_cast_pct', '-', v_today) is not null then v_bad := v_bad || ' null'; end if;
  v_log := v_log || pg_temp.chk('M1', 'job_rate_pct = oem_rate_value x 100 (ทุก key ที่ใบงานใช้ · cast 0.03 = 3) · key ไม่มี/shop null = null ' || v_bad, v_bad = '');

  -- M2 ทางอ่าน rate เดียว + สูตรที่เดียว
  select string_agg(p.oid::regprocedure::text, ', ') into v_x from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.proname like 'job\_%' and p.proname <> 'job_rate_pct' and pg_get_functiondef(p.oid) ilike '%oem_rate_value%';
  v_log := v_log || pg_temp.chk('M2a', 'ไม่มีฟังก์ชัน job_* ตัวไหน (นอก job_rate_pct) อ่าน oem_rate_value ตรง ' || coalesce(v_x, ''), v_x is null);
  select string_agg(p.proname, ', ') into v_x from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.proname in ('job_plan_compute', 'job_plan_suggest') and pg_get_functiondef(p.oid) not ilike '%job_rate_pct(%';
  v_log := v_log || pg_temp.chk('M2b', 'job_plan_compute และ job_plan_suggest อ่าน rate ผ่าน job_rate_pct ทั้งคู่ ' || coalesce(v_x, ''), v_x is null);
  select string_agg(p.oid::regprocedure::text, ', ') into v_x from pg_proc p
   where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f' and p.proname <> 'job_plan_formula'
     and (pg_get_functiondef(p.oid) like '%p_qty_planned * p_target_piece_g%' or pg_get_functiondef(p.oid) like '%qty_planned * target_piece_g * (1 +%' or pg_get_functiondef(p.oid) like '%qty_planned * new.target_piece_g%');
  v_log := v_log || pg_temp.chk('M2c', 'สูตรแผนโลหะ (qty x target x (1+sprue)) อยู่ใน job_plan_formula ที่เดียว — ไม่มีฟังก์ชันอื่นเขียนสูตรเอง ' || coalesce(v_x, ''), v_x is null);
  select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'job_plan_compute';
  v_log := v_log || pg_temp.chk('M2d', 'job_plan_compute เรียก job_plan_formula · ไม่มี pre-check nullif(btrim) ซ้ำ (N11)',
    v_def like '%analytics.job_plan_formula(%' and v_def not like '%nullif(btrim(coalesce(p_override_reason%');

  -- M3 overload
  select string_agg(proname || '=' || n, ', ') into v_x from (
    select proname, count(*) n from pg_proc where pronamespace = 'analytics'::regnamespace
      and proname in ('job_plan_compute', 'job_plan_suggest', 'job_plan_set', 'job_rate_pct', 'job_plan_formula', 'job_plan_basis_assert') group by proname having count(*) <> 1) z;
  select count(*) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and proname in ('job_plan_compute', 'job_plan_suggest', 'job_plan_set', 'job_rate_pct', 'job_plan_formula', 'job_plan_basis_assert');
  v_log := v_log || pg_temp.chk('M3', 'ฟังก์ชันที่แตะ/เกี่ยว 6 ตัว มี signature เดียวทุกตัว (ไม่เกิด overload จาก replace) ' || coalesce(v_x, ''), v_x is null and v_n = 6);

  -- M4 สิทธิ์: acl + พฤติกรรมจริง
  v_log := v_log || pg_temp.chk('M4a', 'acl: job_plan_suggest/job_plan_set = service_role เท่านั้น · job_rate_pct/job_plan_compute (ภายใน) ไม่มีใครรันได้ (anon/authenticated/service_role)',
    has_function_privilege('service_role', 'analytics.job_plan_suggest(uuid,text,uuid,integer,numeric,text[])', 'execute')
    and has_function_privilege('service_role', 'analytics.job_plan_set(uuid,uuid,numeric,numeric,text,uuid)', 'execute')
    and not has_function_privilege('anon', 'analytics.job_plan_suggest(uuid,text,uuid,integer,numeric,text[])', 'execute')
    and not has_function_privilege('authenticated', 'analytics.job_plan_suggest(uuid,text,uuid,integer,numeric,text[])', 'execute')
    and not has_function_privilege('anon', 'analytics.job_plan_set(uuid,uuid,numeric,numeric,text,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'analytics.job_plan_set(uuid,uuid,numeric,numeric,text,uuid)', 'execute')
    and not has_function_privilege('anon', 'analytics.job_rate_pct(uuid,text,text,date)', 'execute')
    and not has_function_privilege('authenticated', 'analytics.job_rate_pct(uuid,text,text,date)', 'execute')
    and not has_function_privilege('service_role', 'analytics.job_rate_pct(uuid,text,text,date)', 'execute')
    and not has_function_privilege('service_role', 'analytics.job_plan_compute(uuid,text,integer,numeric,numeric,text,text)', 'execute'));
  execute 'grant usage on schema analytics to authenticated';  -- จำลองวันที่กำแพงชั้นนอกหลุด (ถอยกลับพร้อม section)
  v_bad := '';
  foreach k in array array[
    'select analytics.job_plan_suggest(null::uuid, null::text, null::uuid)',
    'select analytics.job_plan_set(null::uuid, null::uuid, null::numeric)',
    'select analytics.job_rate_pct(null::uuid, null::text, null::text, null::date)',
    'select analytics.job_plan_compute(null::uuid, null::text, null::int, null::numeric, null::numeric, null::text)'] loop
    v_x := pg_temp.as_role('authenticated', k);
    if v_x not like 'ERR:42501:%' then v_bad := v_bad || ' authenticated:' || left(k, 40) || '=' || left(v_x, 40); end if;
  end loop;
  v_x := pg_temp.as_role('service_role', 'select analytics.job_rate_pct(null::uuid, null::text, null::text, null::date)');
  if v_x not like 'ERR:42501:%' then v_bad := v_bad || ' service_role:job_rate_pct=' || left(v_x, 40); end if;
  v_x := pg_temp.as_role('service_role', 'select analytics.job_plan_suggest(null::uuid, null::text, null::uuid)');
  if v_x not like 'ERR:22023:%' then v_bad := v_bad || ' service_role:suggest(ต้องถึง body 22023)=' || left(v_x, 50); end if;
  v_log := v_log || pg_temp.chk('M4b', 'พฤติกรรมจริง: authenticated เรียก suggest/set/helper/compute = 42501 · service_role เรียก helper = 42501 · service_role เรียก suggest ถึง body (22023 ไม่ใช่ 42501) ' || v_bad, v_bad = '');

  -- G golden: สูตร/assert/guard ที่ 0177 ห้ามแตะ — ผลเท่าเดิม + md5 ล็อกที่ฉบับ 0176 (ถ้า migration ถัดไปแก้ ให้อัปเดตค่าพร้อมเหตุผล)
  v_log := v_log || pg_temp.chk('G1', 'golden สูตร: job_plan_formula(10, 4.000, 5) = 42.000 · (10, 4.000, 0) = 40.000 · (3, 2.500, 2.5) = 7.688 (หาร 100 คงเดิม)',
    analytics.job_plan_formula(10, 4.000, 5) = 42.000 and analytics.job_plan_formula(10, 4.000, 0) = 40.000 and analytics.job_plan_formula(3, 2.500, 2.5) = 7.688);
  v_log := v_log || pg_temp.chk('G2', 'golden md5: job_plan_formula / job_plan_basis_assert / job_guard ไม่ถูกแตะ (ฉบับ 0176)',
    (select md5(pg_get_functiondef(oid)) from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'job_plan_formula') = 'b0ef6123a60c846efca08f9353685583'
    and (select md5(pg_get_functiondef(oid)) from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'job_plan_basis_assert') = '120a4cd8a81b7e9f61e054e44505a1e1'
    and (select md5(pg_get_functiondef(oid)) from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'job_guard') = 'f12fffe81780e44d01c3f7d58350eafb');

  -- M5 ใบจริงที่ไม่ cancelled และมีแผน: ผ่าน job_plan_basis_assert ทุกใบ (basis ยังตรงตัวเลข) · รายงานจำนวน
  v_bad := ''; v_n := 0;
  for r in select * from analytics.job where status <> 'cancelled' and metal_plan_basis is not null loop
    v_n := v_n + 1;
    if not pg_temp.assert_ok(r.id) then v_bad := v_bad || ' ' || r.job_no; end if;
  end loop;
  v_log := v_log || pg_temp.chk('M5', format('ใบจริงที่ไม่ cancelled และมีแผนโลหะ %s ใบ: basis ตรงตัวเลขทุกใบ (job_plan_basis_assert ผ่าน) ', v_n) || v_bad, v_bad = '');
  return v_log;
end;
$s$;

create function pg_temp.run_sec(p_fn text, p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare v text; v_ctx text;
begin
  begin
    execute format('select pg_temp.%I(%L, %L)', p_fn, p_shop, p_tpl) into v;
    raise exception 'SEC_DONE';
  exception when others then
    if sqlerrm <> 'SEC_DONE' then
      get stacked diagnostics v_ctx = pg_exception_context;
      v := coalesce(v, '') || format(E'[FAIL] %s  section ล้มด้วย exception: %s\n   %s\n', p_fn, sqlerrm, left(v_ctx, 400));
    end if;
  end;
  return coalesce(v, '');
end;
$c$;

-- ลายนิ้วมือ state: นับแถว + md5 ตารางที่ suite แตะ (ต้องเท่าเดิมหลังรันทั้งหมด)
create function pg_temp.snap_d() returns text
 language plpgsql as $c$
declare v text := ''; r record; n text;
begin
  for r in select unnest(array['job', 'job_stage', 'job_event', 'job_token', 'job_counter', 'oem_cost_rate', 'oem_quote', 'oem_quote_item', 'oem_receipt', 'oem_doc_counter',
                               'production_order', 'production_order_item', 'production_order_counter', 'stock_lot', 'stock_lot_ledger']) as t loop
    if to_regclass('analytics.' || r.t) is not null then
      execute format('select count(*)::text || ''/'' || coalesce(md5(string_agg(x::text, ''|'' order by x::text)), '''') from analytics.%I x', r.t) into n;
      v := v || r.t || '=' || n || chr(10);
    end if;
  end loop;
  return v;
end;
$c$;
create function pg_temp.snap() returns text language sql as $c$ select md5(pg_temp.snap_d()) $c$;

-- แก้ฟังก์ชันจริงด้วยการแทนข้อความใน pg_get_functiondef (ต้องเปลี่ยนจริง ไม่งั้น raise) — ใช้ใน subtransaction ที่ถอยกลับ
create function pg_temp.mutate(p_name text, p_from text, p_to text) returns void
 language plpgsql as $c$
declare v_oid oid; v_def text; v_new text;
begin
  select p.oid into strict v_oid from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  v_new := replace(v_def, p_from, p_to);
  if v_new = v_def then
    raise exception 'MUTANT_NOT_APPLIED: % ไม่พบข้อความ [%]', p_name, p_from;
  end if;
  execute v_new;
end;
$c$;

create function pg_temp.run_all(p_shop uuid, p_tpl uuid) returns text
 language sql as $c$
  select pg_temp.run_sec('sa', p_shop, p_tpl) || pg_temp.run_sec('sf', p_shop, p_tpl) || pg_temp.run_sec('ss', p_shop, p_tpl)
      || pg_temp.run_sec('sn', p_shop, p_tpl) || pg_temp.run_sec('sm', p_shop, p_tpl)
$c$;

-- label ของเคส -> section ที่รันเคสนั้น (mutant รันเฉพาะ section ที่ expect อยู่)
create function pg_temp.sec_of(p_label text) returns text language sql as $c$
  select case
    when p_label like 'A%' then 'sa'
    when p_label like 'F%' then 'sf'
    when p_label like 'S5%' then 'ss'
    when p_label like 'N11%' then 'sn'
    else 'sm' end $c$;
create function pg_temp.run_for(p_expect jsonb, p_shop uuid, p_tpl uuid) returns text language plpgsql as $c$
declare v text := ''; s text;
begin
  for s in select distinct pg_temp.sec_of(e) from jsonb_array_elements_text(p_expect) e order by 1 loop
    v := v || pg_temp.run_sec(s, p_shop, p_tpl);
  end loop;
  return v;
end;
$c$;

do $v177$
declare
  v_shop uuid; v_tpl uuid;
  v_log text := ''; v_s text; v_fail int; v_snap0 text; v_d0 text;
  v_m record; v_killed int := 0; v_total int; v_survived text := ''; v_cnt int; v_id text; v_hit int; v_skip int; v_ok_cnt int;
  v_mutants jsonb := jsonb_build_array(
    jsonb_build_object('id', 'MU-1', 'what', 'suggest อ่าน cast rate ตรง ไม่คูณ 100 (บั๊กเดิม: สั่ง 30 ได้ 31 · cast_pct = 0.03)', 'fn', 'job_plan_suggest',
      'from', 'v_rc := analytics.job_rate_pct(p_shop_id, ''reject_rate_cast_pct''', 'to', 'v_rc := analytics.oem_rate_value(p_shop_id, ''reject_rate_cast_pct''', 'expect', jsonb_build_array('A1', 'F1')),
    jsonb_build_object('id', 'MU-2', 'what', 'suggest อ่าน plate rate ตรง ไม่คูณ 100 (ชุบเพี้ยน)', 'fn', 'job_plan_suggest',
      'from', 'v_rpl := case when v_has_pl then analytics.job_rate_pct(', 'to', 'v_rpl := case when v_has_pl then analytics.oem_rate_value(', 'expect', jsonb_build_array('A2', 'F1')),
    jsonb_build_object('id', 'MU-3', 'what', 'compute อ่าน sprue ตรง ไม่คูณ 100 (บั๊กเดิม: แผน 120.060 · sprue_loss_pct = 0.05)', 'fn', 'job_plan_compute',
      'from', 'v_sprue := analytics.job_rate_pct(', 'to', 'v_sprue := analytics.oem_rate_value(', 'expect', jsonb_build_array('A3', 'A4', 'F2')),
    jsonb_build_object('id', 'MU-4', 'what', 'job_rate_pct ไม่คูณ 100 (helper ที่เดียวพัง — ทุกจุดอ่านพังพร้อมกัน)', 'fn', 'job_rate_pct',
      'from', 'p_as_of) * 100', 'to', 'p_as_of) * 1', 'expect', jsonb_build_array('M1', 'F1', 'F2')),
    jsonb_build_object('id', 'MU-5', 'what', 'S5 กลับเดิม: job_plan_set ประทับ input ทุกครั้ง', 'fn', 'job_plan_set',
      'from', 'then v_job.metal_plan_basis ->> ''target_source''', 'to', 'then ''input''', 'expect', jsonb_build_array('S5a', 'S5b')),
    jsonb_build_object('id', 'MU-6', 'what', 'job_plan_formula หารผิด (/1000) — compute+guard ใช้ร่วมกัน ผลผิดทั้งคู่', 'fn', 'job_plan_formula',
      'from', '(1 + p_sprue_pct / 100)', 'to', '(1 + p_sprue_pct / 1000)', 'expect', jsonb_build_array('A4', 'F2', 'G1')),
    jsonb_build_object('id', 'MU-7', 'what', 'suggest ผ่อน guard cast < 100 เป็น < 100000 (rate 150% ถูกใช้ -> ตัวหารติดลบ)', 'fn', 'job_plan_suggest',
      'from', 'v_rc is null or not (v_rc >= 0 and v_rc < 100)', 'to', 'v_rc is null or not (v_rc >= 0 and v_rc < 100000)', 'expect', jsonb_build_array('F4')),
    jsonb_build_object('id', 'MU-8', 'what', 'compute ผ่อนช่วง sprue <= 500 เป็น <= 50000 (sprue 600% ถูกใช้)', 'fn', 'job_plan_compute',
      'from', 'not (v_sprue >= 0 and v_sprue <= 500)', 'to', 'not (v_sprue >= 0 and v_sprue <= 50000)', 'expect', jsonb_build_array('F5')),
    jsonb_build_object('id', 'MU-9', 'what', 'N11: exception เหตุผลแผนเองเปลี่ยน hint (plan_reason_required หาย)', 'fn', 'job_plan_compute',
      'from', 'raise exception ''%'', sqlerrm using errcode = ''22023'', hint = ''plan_reason_required'';', 'to', 'raise exception ''%'', sqlerrm using errcode = ''22023'', hint = ''plan_override_invalid'';', 'expect', jsonb_build_array('N11a')),
    jsonb_build_object('id', 'MU-10', 'what', 'helper job_rate_pct ถูก grant ให้ service_role (ควรเป็นภายใน)', 'ddl',
      'grant execute on function analytics.job_rate_pct(uuid, text, text, date) to service_role', 'expect', jsonb_build_array('M4a', 'M4b')),
    jsonb_build_object('id', 'MU-11', 'what', 'compute เขียนสูตรเองซ้ำ ไม่เรียก job_plan_formula (สูตร 2 ที่กลับมา)', 'fn', 'job_plan_compute',
      'from', 'v_computed := analytics.job_plan_formula(p_qty_planned, p_target_piece_g, v_sprue);', 'to', 'v_computed := round(p_qty_planned * p_target_piece_g * (1 + v_sprue / 100), 3);', 'expect', jsonb_build_array('M2c', 'M2d'))
  );
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select id into v_shop from public.shop order by created_at limit 1;
  select i.id into v_tpl from analytics.oem_quote_item i join analytics.oem_quote q on q.id = i.quote_id
   where i.shop_id = v_shop and i.input ->> 'metal' = 'silver' and q.quote_no not like 'V17%' order by q.created_at, i.seq limit 1;
  if v_tpl is null then
    v_log := v_log || '[FAIL] S0  ไม่มี oem_quote_item เงินจริงให้ใช้เป็นแม่แบบโคลน — ชุดทดสอบรันต่อไม่ได้' || E'\n';
    raise exception E'%', v_log;
  end if;

  create temp table _v177_orig on commit drop as
    select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h
      from pg_proc p where p.pronamespace = 'analytics'::regnamespace and (p.proname like 'job\_%' or p.proname like 'worker\_%');

  v_snap0 := pg_temp.snap(); v_d0 := pg_temp.snap_d();
  v_s := pg_temp.run_all(v_shop, v_tpl);
  v_log := v_log || v_s;
  v_log := v_log || pg_temp.chk('K0', 'หลังรัน: แถวตารางใบงาน/ใบเสนอราคา/rate/ใบผลิต/สต็อก (นับ + md5) เท่าเดิมเป๊ะ — ทุก section ถอยกลับ', pg_temp.snap() = v_snap0);
  v_ok_cnt := (length(v_s) - length(replace(v_s, '[OK]', ''))) / 4;

  v_total := jsonb_array_length(v_mutants);
  for v_m in select value as m from jsonb_array_elements(v_mutants) loop
    v_id := v_m.m ->> 'id';
    v_s := '';
    begin
      if v_m.m ? 'ddl' then
        execute v_m.m ->> 'ddl';
      else
        perform pg_temp.mutate(v_m.m ->> 'fn', v_m.m ->> 'from', v_m.m ->> 'to');
      end if;
      v_s := pg_temp.run_for(v_m.m -> 'expect', v_shop, v_tpl);
      raise exception 'MUTANT_DONE';
    exception when others then
      if sqlerrm <> 'MUTANT_DONE' then
        v_log := v_log || format(E'[FAIL] %s  ใช้ mutant ไม่ได้: %s\n', v_id, sqlerrm);
        v_s := 'ERR';
      end if;
    end;
    v_hit := 0;
    for v_cnt in 0 .. jsonb_array_length(v_m.m -> 'expect') - 1 loop
      if position('[FAIL] ' || (v_m.m -> 'expect' ->> v_cnt) || ' ' in v_s) > 0 then
        v_hit := v_hit + 1;
      end if;
    end loop;
    if v_hit >= 1 then
      v_killed := v_killed + 1;
      v_log := v_log || format(E'[OK] %s  mutant ถูกจับ (%s): ล้ม %s จาก %s\n', v_id, v_m.m ->> 'what', v_hit, v_m.m -> 'expect');
    else
      v_survived := v_survived || v_id || ' ';
      v_log := v_log || format(E'[FAIL] %s  mutant รอด (%s) — ไม่มี %s ล้มเลย\n', v_id, v_m.m ->> 'what', v_m.m -> 'expect');
    end if;
  end loop;
  v_log := v_log || pg_temp.chk('MX', format('mutant %s จุด ถูกจับ %s · รอด: %s', v_total, v_killed, coalesce(nullif(v_survived, ''), '(ไม่มี)')), v_killed = v_total);

  select count(*) into v_cnt from _v177_orig o where md5(pg_get_functiondef(to_regprocedure(o.sig))) = o.h;
  v_log := v_log || pg_temp.chk('MY', format('หลังรัน mutant: md5 definition ของฟังก์ชัน job_*/worker_* ทั้ง %s ตัวเท่าเดิม · trigger ใบงานเปิดครบ · grant ของ helper ไม่เปลี่ยน', (select count(*) from _v177_orig)),
    v_cnt = (select count(*) from _v177_orig)
    and not exists (select 1 from pg_trigger t where t.tgrelid in ('analytics.job'::regclass, 'analytics.job_stage'::regclass, 'analytics.job_event'::regclass) and not t.tgisinternal and t.tgenabled <> 'O')
    and not has_function_privilege('service_role', 'analytics.job_rate_pct(uuid,text,text,date)', 'execute'));
  v_s := pg_temp.run_all(v_shop, v_tpl);
  v_fail := (length(v_s) - length(replace(v_s, '[FAIL]', ''))) / 6;
  v_log := v_log || pg_temp.chk('MZ', 'หลังคืนของเดิม: ชุดเทสต์หลักรันซ้ำ FAIL ' || v_fail, v_fail = 0);
  if v_fail > 0 then
    v_log := v_log || (select string_agg('    (รันซ้ำ) ' || l, E'\n') from unnest(string_to_array(v_s, E'\n')) l where l like '[FAIL]%') || E'\n';
  end if;
  v_log := v_log || pg_temp.chk('K0c', 'state ไม่ขยับหลังรัน mutant ทั้งหมด' || coalesce((select ' ขยับ: ' || string_agg(split_part(a, '=', 1), ',') from unnest(string_to_array(v_d0, chr(10))) a
    where a <> '' and not (a = any (string_to_array(pg_temp.snap_d(), chr(10))))), ''), pg_temp.snap() = v_snap0);

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_skip := (length(v_log) - length(replace(v_log, '[SKIP]', ''))) / 6;
  v_log := v_log || format(E'\n=== สรุป: [OK] ~%s · [FAIL] ทั้งไฟล์ = %s · [SKIP] = %s %s ===\n', v_ok_cnt, v_fail, v_skip, case when v_fail = 0 then '(ผ่าน)' else '(ไม่ผ่าน)' end);
  raise exception E'%', v_log;
end $v177$;
