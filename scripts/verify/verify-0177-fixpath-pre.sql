-- scripts/verify/verify-0177-fixpath-pre.sql — ส่วน "ก่อน migration" ของชุดทดสอบทางแก้ใบเดิม (0177 §5)
-- ทำไมแยก: บนระบบจริงไม่มีใบที่ไม่ cancelled และมีแผนผิดหน่วย (ตรวจ 15 ต.ค.: มีแต่ JB-0026/27 ที่ cancelled) ⇒ โค้ดแก้ใบเดิมใน migration ไม่ถูกยิง
--   ชุดนี้สร้างใบที่ "แผนผิดหน่วยแบบ 0175" ด้วยฟังก์ชันฉบับ 0175 ที่ยังอยู่บน DB (ก่อน replace) แล้วให้ migration 0177 รันทับในทรานแซกชันเดียวกัน แล้วตรวจใน -post
-- รัน (dry-run เท่านั้น ถอยกลับเสมอ — ห้าม --commit):
--   cat scripts/verify/verify-0177-fixpath-pre.sql supabase/migrations/0177_job_plan_rate_unit_fix.sql scripts/verify/verify-0177-fixpath-post.sql > <tmp>.sql
--   node scripts/run-sql.mjs <tmp>.sql
-- 🔴 ใช้ได้เฉพาะตอน DB ยังเป็นฉบับ 0175/0176 (ก่อน apply 0177) — หลัง apply แล้ว pre-check ของ migration จะข้ามการแก้ใบเดิม (first_run = false) และชุดนี้จะล้มโดยตั้งใจที่ FX0
-- ข้อมูลทดสอบสร้างผ่าน RPC เท่านั้น (ใบเสนอราคา = โคลนจากรายการจริง) · ตัวนับเลขที่ใบงานเดินในทรานแซกชันที่ถอยกลับ

create function pg_temp.chk(p_id text, p_desc text, p_ok boolean) returns text
 language sql as $c$
  select format('[%s] %s  %s', case when coalesce(p_ok, false) then 'OK' else 'FAIL' end, p_id, p_desc) || E'\n'
$c$;

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

create function pg_temp.clone_deal(p_tpl_item uuid, p_metal text, p_qty int) returns jsonb
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
  v_input := (v_item.input - 'weight_g') || jsonb_build_object('metal', p_metal, 'is_new_design', false);
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

create function pg_temp.mkj(p_shop uuid, p_tpl uuid, p_metal text, p_qty int, p_target text, p_ov text default null, p_reason text default null) returns jsonb
 language plpgsql as $c$
declare d jsonb;
begin
  d := pg_temp.clone_deal(p_tpl, p_metal, p_qty);
  return d || pg_temp.q(format('select analytics.job_create_from_quote_item(p_shop_id=>%L, p_quote_item_id=>%L, p_stage_codes=>%L::text[],
      p_start_gate_note=>%L, p_design_label=>%L, p_actor=>%L, p_qty_planned=>%L, p_target_piece_g=>%L::numeric,
      p_metal_plan_override_g=>%L::numeric, p_metal_plan_reason=>%L)',
      p_shop, d ->> 'item_id', pg_temp.std(), 'verify: เริ่มผลิตก่อนมัดจำ', 'v177-fx', '00000000-0000-0000-0000-0000000000a1'::uuid, p_qty, p_target, p_ov, p_reason));
end;
$c$;

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

-- ใบที่สร้างไว้ + ค่าก่อน migration (ใช้เทียบใน -post)
create temp table _fx (k text primary key, job_id uuid not null, sprue0 numeric, plan0 numeric, upd0 timestamptz, status0 text) on commit drop;
create temp table _fx_gold_rates on commit drop as select * from analytics.oem_cost_rate where false;

do $pre$
declare
  v_shop uuid; v_tpl uuid; d jsonb; v_log text := '';
  v_sp numeric;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select id into v_shop from public.shop order by created_at limit 1;
  select i.id into v_tpl from analytics.oem_quote_item i join analytics.oem_quote q on q.id = i.quote_id
   where i.shop_id = v_shop and i.input ->> 'metal' = 'silver' and q.quote_no not like 'V17%' order by q.created_at, i.seq limit 1;
  if v_tpl is null then raise exception 'FX: ไม่มี oem_quote_item เงินจริงให้โคลน'; end if;
  v_sp := analytics.oem_rate_value(v_shop, 'sprue_loss_pct', 'silver', analytics.job_today());
  if v_sp is null then raise exception 'FX: ไม่มี rate sprue เงิน — เตรียม fixture ไม่ได้'; end if;

  -- a) เปิด · ไม่ override  b) กำหนดแผนเอง (override)  c) cancelled  d) ไม่มี rate ก้านต้น (basis sprue null)
  d := pg_temp.mkj(v_shop, v_tpl, 'silver', 30, '4.000');
  insert into _fx select 'a', (d ->> 'job_id')::uuid, (basis ->> 'sprue_loss_pct')::numeric, metal_plan_g, updated_at, status from (select metal_plan_basis as basis, metal_plan_g, updated_at, status from analytics.job where id = (d ->> 'job_id')::uuid) z;
  d := pg_temp.mkj(v_shop, v_tpl, 'silver', 30, '4.000', '200.000', 'verify กำหนดเองโลหะ');
  insert into _fx select 'b', (d ->> 'job_id')::uuid, (basis ->> 'sprue_loss_pct')::numeric, metal_plan_g, updated_at, status from (select metal_plan_basis as basis, metal_plan_g, updated_at, status from analytics.job where id = (d ->> 'job_id')::uuid) z;
  d := pg_temp.mkj(v_shop, v_tpl, 'silver', 30, '4.000');
  perform analytics.job_cancel(v_shop, (d ->> 'job_id')::uuid, 'verify ยกเลิก', '00000000-0000-0000-0000-0000000000a1'::uuid);
  insert into _fx select 'c', (d ->> 'job_id')::uuid, (basis ->> 'sprue_loss_pct')::numeric, metal_plan_g, updated_at, status from (select metal_plan_basis as basis, metal_plan_g, updated_at, status from analytics.job where id = (d ->> 'job_id')::uuid) z;
  -- d) ทอง: เอา rate ก้านต้นทองออกชั่วคราว (เก็บไว้คืนด้านล่าง) แล้วสร้างใบ
  insert into _fx_gold_rates select * from analytics.oem_cost_rate where shop_id = v_shop and rate_key = 'sprue_loss_pct' and scope = 'gold';
  delete from analytics.oem_cost_rate where shop_id = v_shop and rate_key = 'sprue_loss_pct' and scope = 'gold';
  d := pg_temp.mkj(v_shop, v_tpl, 'gold', 30, '4.000');
  insert into _fx select 'd', (d ->> 'job_id')::uuid, (basis ->> 'sprue_loss_pct')::numeric, metal_plan_g, updated_at, status from (select metal_plan_basis as basis, metal_plan_g, updated_at, status from analytics.job where id = (d ->> 'job_id')::uuid) z;
  insert into analytics.oem_cost_rate select * from _fx_gold_rates;

  v_log := v_log || pg_temp.chk('FX0', format('ก่อน migration: ใบ a/b/c มีแผนผิดหน่วยแบบ 0175 (sprue_loss_pct = %s ไม่ใช่ %s) · a plan = %s · d ไม่มี rate (sprue null) · มี 4 ใบ',
      v_sp, v_sp * 100, (select plan0 from _fx where k = 'a')),
    (select count(*) from _fx) = 4
    and (select sprue0 from _fx where k = 'a') = v_sp and (select sprue0 from _fx where k = 'b') = v_sp and (select sprue0 from _fx where k = 'c') = v_sp
    and (select plan0 from _fx where k = 'a') = round(30 * 4.000 * (1 + v_sp / 100), 3) and (select plan0 from _fx where k = 'b') = 200
    and (select sprue0 from _fx where k = 'd') is null and (select plan0 from _fx where k = 'd') is null
    and (select status0 from _fx where k = 'c') = 'cancelled' and (select status0 from _fx where k = 'a') <> 'cancelled');
  create temp table _fx_log (l text) on commit drop;
  insert into _fx_log values (v_log);
end;
$pre$;
