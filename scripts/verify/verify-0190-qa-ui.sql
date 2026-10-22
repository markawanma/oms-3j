-- scripts/verify/verify-0190-qa-ui.sql — QA G1a UI (R2-D2 · 22 ต.ค. 69): payload ที่ UI ส่ง (draftRowsToInputs -> toWireGemLines · useGemFail force · JobGemsEditDialog reason · SkuGemBomDialog · GemAddItemDialog · GemPriceDialog)
-- ยิงเข้า RPC 0190 จริง + จับผลลัพธ์จริงเป็น fixture ให้ lib/jobs/gems.db-contract.qa.test.ts (บรรทัด [INFO] CONTRACT_*)
-- self-rolling-back · ต้องมี 0190 อยู่ใน DB แล้ว · รัน: node scripts/run-sql.mjs scripts/verify/verify-0190-qa-ui.sql (ห้าม --commit) · ไฟล์ LF (3j-migration-traps ข้อ 20)
-- ป้ายผล: [OK] ผ่าน · [FAIL] พัง · [BUG-OPEN] ช่องที่รู้แล้ว (UI4a/UI4b: DB รวมแถวซ้ำหลัง resolve เงียบๆ — จอจับไม่ได้และไม่แจ้ง mergedRows) · [INFO] ข้อมูลประกอบ
-- ท่อนก่อน "QA UI-G1a" = prelude เดียวกับ verify-0190-qa.sql (helper + g_setup ร้านสังเคราะห์ ZZ TEST ยืมสมาชิกจริงใน tx นี้เท่านั้น)
-- scripts/verify/verify-0190-qa.sql
-- QA ad-hoc ของ migration 0190 (G1a พลอย) — R2-D2 · 22 ต.ค. 69 · เสริม verify-0190.sql (ไม่ซ้ำกับมัน: ครบวงจร SKU→ใบ→ขั้นฝัง→แก้→resolve · ใบเดิม · ส่วนย่อย · W1/OEM จริง/ทอง · รวมชื่อหลังใบเปิด · ชื่อคล้าย false-positive ·
--   input ผิดรูป 89 เคส · fuzz ลำดับ operation 400 ครั้ง + invariant · ประสิทธิภาพที่แคตตาล็อกใหญ่ · staff/ไม่ใช่สมาชิก)
-- วิธีรัน (dry-run เท่านั้น — ห้าม --commit): ต่อไฟล์ supabase/migrations/0190_gems_g1a.sql + ไฟล์นี้ (LF — ข้อ 20) เป็นไฟล์เดียว แล้ว  node scripts/run-sql.mjs <ไฟล์รวม>
--   หลัง apply 0190 แล้ว: รันไฟล์นี้เดี่ยวๆ ได้ (ต้องมี 0172-0189)
-- ใช้ helper + setup (g_setup · ร้านสังเคราะห์ ZZ TEST verify-0190 A/B ยืมสมาชิกจริง) เดียวกับ verify-0190.sql — ข้อยกเว้นเดียวที่ไม่ผ่าน RPC: insert public.shop/shop_member + fixture ปริมาณมากของ q_perf (ร้านสังเคราะห์ B) · q_oem_real สร้างใบจาก OEM quote item จริงแล้วถอยกลับ
-- ป้ายผล: [OK] ผ่าน · [FAIL] พัง (ต้องแก้) · [BUG-OPEN] ข้อบกพร่อง/หนี้ที่รู้แล้วและยังไม่แก้ (กลับเป็น [OK] เองเมื่อแก้) · [INFO] ข้อมูลประกอบ
-- BUG-OPEN ณ 22 ต.ค. 69 (หลังรอบแก้ตาม security/QA/review): เหลือข้อเดียว — P9 (ตัวดักชื่อคล้ายเป็น O(ชื่อใหม่ × ชนิดทั้งแคตตาล็อก) ด้วย plpgsql — 30 ชื่อ × 2,000 ชนิด ≈ 24 วินาที · หนี้ที่รู้ ยังไม่แก้)
--   ที่เคยเป็น BUG-OPEN และแก้แล้ว (เปลี่ยนเป็น [OK] เอง): M5 (แก้ใบหลังรวมชื่อ → ฉลาก snapshot คงเดิม) · N1/N2 (รวมชื่อไม่ล้มเมื่ออีกฝั่งปิดใช้งาน) · NC1 (เลขล้วนทุกระบบเลขตก — ตอนนี้ด่านคือ "ต้องมีตัวอักษรจริง ([[:alpha:]]) ≥ 1 ตัว")
-- parity ของ norm/similar กับ lib/jobs/shop-gems.ts: ตรงกัน 735 คู่ (P*) + กวาดทุกจุดรหัส U+0001-1FFFF เทียบ DB จริงใน shop-gems.qa.test.ts — TS ตัดเฉพาะ \p{P} เหมือน DB (สัญลักษณ์ \p{S} อยู่ใน norm ทั้งสองฝั่ง) · ต่างเฉพาะวรรคตอนใหม่ของ Unicode 16 ~14 ตัวที่ DB รุ่นนี้ยังไม่รู้

set local statement_timeout = '30min';

create temp table _v190_fx (k text primary key, id uuid not null) on commit drop;
create temp table _v190_kv (k text primary key, v text not null) on commit drop;

create function pg_temp.chk(p_id text, p_desc text, p_ok boolean) returns text
 language sql as $c$
  select format('[%s] %s  %s', case when coalesce(p_ok, false) then 'OK' else 'FAIL' end, p_id, p_desc) || E'\n'
$c$;
create function pg_temp.skip(p_id text, p_desc text) returns text language sql as $c$ select format('[SKIP] %s  %s', p_id, p_desc) || E'\n' $c$;
create function pg_temp.fx(p_k text) returns uuid language sql as $c$ select id from _v190_fx where k = p_k $c$;
create function pg_temp.setfx(p_k text, p_id uuid) returns void language sql as $c$
  insert into _v190_fx (k, id) values (p_k, p_id) on conflict (k) do update set id = excluded.id $c$;
create function pg_temp.kv(p_k text) returns text language sql as $c$ select v from _v190_kv where k = p_k $c$;
create function pg_temp.setkv(p_k text, p_v text) returns void language sql as $c$
  insert into _v190_kv (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $c$;
-- ผู้ทำรายการ: owner (สมาชิก owner ของร้าน A) · ผู้ใช้ที่ไม่ใช่สมาชิก · admin · staff (สมาชิกระดับ staff ของร้าน A)
create function pg_temp.own() returns uuid language sql as $c$ select pg_temp.fx('u_owner') $c$;
create function pg_temp.adm() returns uuid language sql as $c$ select pg_temp.fx('u_admin') $c$;
create function pg_temp.stf() returns uuid language sql as $c$ select pg_temp.fx('u_staff') $c$;
create function pg_temp.nom() returns uuid language sql as $c$ select '00000000-0000-0000-0000-0000000000a1'::uuid $c$;
-- รัน SQL ที่คืน jsonb: สำเร็จ = ค่าที่คืน · ล้ม = {_err,_state,_hint,_detail}
create function pg_temp.q(p_sql text) returns jsonb
 language plpgsql as $c$
declare v jsonb; v_msg text; v_state text; v_hint text; v_detail text;
begin
  execute p_sql into v;
  return coalesce(v, '{}'::jsonb);
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint, v_detail = pg_exception_detail;
  return jsonb_build_object('_err', v_msg, '_state', v_state, '_hint', v_hint, '_detail', v_detail);
end;
$c$;
-- รัน SQL เดี่ยว: สำเร็จ = 'OK' · ล้ม = 'sqlstate|hint'
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
create function pg_temp.hint(r jsonb) returns text language sql as $c$ select coalesce(r ->> '_state', 'OK') || '|' || coalesce(r ->> '_hint', '') $c$;
-- detail ของแถวพลอย {row, field, code}
create function pg_temp.dtl(r jsonb) returns jsonb language plpgsql as $c$
begin
  return (r ->> '_detail')::jsonb;
exception when others then
  return null;
end;
$c$;
create function pg_temp.asrole(p_role text, p_sql text) returns text
 language plpgsql as $c$
declare v_state text;
begin
  execute format('set local role %I', p_role);
  execute p_sql;
  reset role;
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  reset role;
  return v_state;
end;
$c$;
-- แทนที่ข้อความในนิยามฟังก์ชันแล้ว execute (mutant) — ไม่เจอข้อความ = raise (กัน mutant ที่ไม่ได้ mutate จริง)
create function pg_temp.mutate(p_sig text, p_from text, p_to text) returns void
 language plpgsql as $c$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef(p_sig::regprocedure);
  v_new := replace(v_def, p_from, p_to);
  if v_new = v_def then raise exception 'MUTANT_NOT_APPLIED: % : %', p_sig, left(p_from, 80); end if;
  execute v_new;
end;
$c$;
-- key ทุกระดับของ jsonb (ตรวจว่าผลฝั่งช่าง/ฟอร์มไม่มี key เงิน/ต้นทุน)
create function pg_temp.keys_deep(j jsonb) returns setof text
 language plpgsql as $c$
declare r record; e jsonb;
begin
  if jsonb_typeof(j) = 'object' then
    for r in select key, value from jsonb_each(j) loop
      return next r.key;
      return query select * from pg_temp.keys_deep(r.value);
    end loop;
  elsif jsonb_typeof(j) = 'array' then
    for e in select value from jsonb_array_elements(j) loop
      return query select * from pg_temp.keys_deep(e);
    end loop;
  end if;
end;
$c$;
create function pg_temp.badkeys(j jsonb) returns text
 language sql as $c$
  select coalesce(string_agg(distinct k, ','), '') from pg_temp.keys_deep(j) k where k ~* '(cost|price|thb|margin|unit_cost|customer|profit|buyer|client|quote_?no|po_?no|invoice|receipt|deposit|paid|grand_?total|subtotal|vat|tax_?id|phone|email|address|nre_|baht|supplier|tier)' $c$;
-- ตัวเลขราคาทดสอบ (เลขแปลก — ต้องไม่โผล่ที่ไหนนอกทาง RPC ราคา)
create function pg_temp.px() returns text language sql as $c$ select '7391.2468' $c$;
create function pg_temp.std() returns text language sql as $c$ select '{wax_inject,wax_tree,invest_burnout,cast,cut_sprue,finish,buff,qc,pack}' $c$;
create function pg_temp.stdg() returns text language sql as $c$ select '{wax_inject,wax_tree,invest_burnout,cast,cut_sprue,finish,buff,gem_set,qc,pack}' $c$;

-- ============================================================================
-- helper ตัวช่วย
-- ============================================================================
-- ภาพรวมตารางพลอยของร้าน (ใช้เทียบว่า "ไม่มีอะไรเกิด" หลังคำขอที่ถูกปฏิเสธ) — ไม่รวมราคา
create function pg_temp.gsnap(p_shop uuid) returns text
 language sql as $c$
  select md5(coalesce((select string_agg(t::text, '|' order by t.id) from analytics.gem_type t where t.shop_id = p_shop), '')
          || '#' || coalesce((select string_agg(s::text, '|' order by s.id) from analytics.gem_shape s where s.shop_id = p_shop), '')
          || '#' || coalesce((select string_agg(i::text, '|' order by i.id) from analytics.gem_item i where i.shop_id = p_shop), '')
          || '#' || coalesce((select string_agg(b::text, '|' order by b.id) from analytics.job_gem_bom b where b.shop_id = p_shop), '')
          || '#' || coalesce((select string_agg(b::text, '|' order by b.id) from analytics.product_gem_bom b where b.shop_id = p_shop), '')
          || '#' || coalesce((select string_agg(e::text, '|' order by e.id) from analytics.job_event e where e.shop_id = p_shop and e.event_type = 'bom_change'), '')) $c$;
create function pg_temp.n_type(p_shop uuid) returns int language sql as $c$ select count(*)::int from analytics.gem_type where shop_id = p_shop $c$;
create function pg_temp.n_shape(p_shop uuid) returns int language sql as $c$ select count(*)::int from analytics.gem_shape where shop_id = p_shop $c$;
create function pg_temp.n_item(p_shop uuid) returns int language sql as $c$ select count(*)::int from analytics.gem_item where shop_id = p_shop $c$;
create function pg_temp.n_bom(p_job uuid) returns int language sql as $c$ select count(*)::int from analytics.job_gem_bom where job_id = p_job $c$;
create function pg_temp.n_ev(p_job uuid) returns int language sql as $c$ select count(*)::int from analytics.job_event where job_id = p_job and event_type = 'bom_change' $c$;
create function pg_temp.shp(p_shop uuid, p_name text) returns uuid language sql as $c$ select id from analytics.gem_shape where shop_id = p_shop and name = p_name $c$;
create function pg_temp.typ(p_shop uuid, p_name text) returns uuid language sql as $c$ select id from analytics.gem_type where shop_id = p_shop and name = p_name $c$;
-- ข้อความที่ผู้ใช้เห็นต้องไม่มีเลขราคา
-- แม่แบบของ SKU เป็นแถวรูปแบบ gem_item_id (ส่งกลับเข้า product_gem_bom_set ได้ตรงๆ)
create function pg_temp.tpl_lines(p_shop uuid, p_product uuid) returns jsonb language sql as $c$
  select coalesce(jsonb_agg(jsonb_build_object('gem_item_id', b.gem_item_id, 'qty_per_piece', b.qty_per_piece, 'position', b.position_note) order by b.line_seq), '[]'::jsonb)
    from analytics.product_gem_bom b where b.product_id = p_product and b.shop_id = p_shop $c$;
-- สแกนทุกราคา ≥ 1,000 ที่ตั้งไว้ในตารางราคา (7391.2468 · 9999.9999 · ... — เลขแปลกที่ไม่ซ้ำกับค่าอื่น) ว่าโผล่ในผลลัพธ์ไหม (ไม่ใช่แค่ราคาปัจจุบัน — กันรั่วราคาอื่นของรายการเดียวกัน เช่น max/ล่าสุด)
create function pg_temp.has_px(j jsonb) returns boolean language sql as $c$
  select exists (select 1 from analytics.gem_item_price p where p.price_thb_per_unit >= 1000 and position(trim_scale(p.price_thb_per_unit)::text in coalesce(j::text, '')) > 0) $c$;

-- เรียก RPC (named args) — p คือ jsonb ของพารามิเตอร์
create function pg_temp.bset(p_shop uuid, p_job uuid, p_lines jsonb, p_actor uuid default null, p_reason text default null, p_force boolean default false) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_gem_bom_set(p_shop_id=>%L, p_job_id=>%L, p_gem_lines=>%L::jsonb, p_actor=>%L, p_reason=>%L, p_force=>%L)', p_shop, p_job, p_lines, coalesce(p_actor, pg_temp.nom()), p_reason, p_force)) $c$;
create function pg_temp.tset(p_shop uuid, p_product uuid, p_lines jsonb, p_actor uuid default null, p_force boolean default false) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.product_gem_bom_set(p_shop_id=>%L, p_product_id=>%L, p_gem_lines=>%L::jsonb, p_actor=>%L, p_force=>%L)', p_shop, p_product, p_lines, coalesce(p_actor, pg_temp.own()), p_force)) $c$;
create function pg_temp.icreate(p_shop uuid, p_line jsonb, p_force boolean default false, p_actor uuid default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.gem_item_create(%L, %L, %L::jsonb, %L)', p_shop, coalesce(p_actor, pg_temp.own()), p_line, p_force)) $c$;
create function pg_temp.price(p_shop uuid, p_item uuid, p_price text, p_eff text default null, p_actor uuid default null, p_sup text default null, p_note text default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.gem_price_set(%L, %L, %L, %L::numeric, %L::date, %L, %L)', p_shop, coalesce(p_actor, pg_temp.own()), p_item, p_price, p_eff, p_sup, p_note)) $c$;
create function pg_temp.clist(p_shop uuid, p_actor uuid default null, p_all boolean default false) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_catalog_list(%L, %L, %L)', p_shop, coalesce(p_actor, pg_temp.own()), p_all)) $c$;
create function pg_temp.olist(p_shop uuid) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_options_list(%L)', p_shop)) $c$;
create function pg_temp.mprev(p_shop uuid, p_kind text, p_from uuid, p_into uuid, p_actor uuid default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_merge_preview(%L, %L, %L, %L, %L)', p_shop, coalesce(p_actor, pg_temp.own()), p_kind, p_from, p_into)) $c$;
create function pg_temp.mrg(p_shop uuid, p_kind text, p_from uuid, p_into uuid, p_actor uuid default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_merge(%L, %L, %L, %L, %L)', p_shop, coalesce(p_actor, pg_temp.own()), p_kind, p_from, p_into)) $c$;
create function pg_temp.ccreate(p_shop uuid, p_kind text, p_name text, p_hl boolean default null, p_force boolean default false, p_actor uuid default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_catalog_create(%L, %L, %L, %L, %L, %L)', p_shop, coalesce(p_actor, pg_temp.own()), p_kind, p_name, p_hl, p_force)) $c$;
create function pg_temp.ren(p_shop uuid, p_kind text, p_id uuid, p_name text, p_force boolean default false, p_actor uuid default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_catalog_rename(%L, %L, %L, %L, %L, %L)', p_shop, coalesce(p_actor, pg_temp.own()), p_kind, p_id, p_name, p_force)) $c$;
create function pg_temp.sact(p_shop uuid, p_kind text, p_id uuid, p_active boolean, p_actor uuid default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_catalog_set_active(%L, %L, %L, %L, %L)', p_shop, coalesce(p_actor, pg_temp.own()), p_kind, p_id, p_active)) $c$;
create function pg_temp.rmv(p_shop uuid, p_kind text, p_id uuid, p_actor uuid default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_catalog_remove(%L, %L, %L, %L)', p_shop, coalesce(p_actor, pg_temp.own()), p_kind, p_id)) $c$;
create function pg_temp.hl(p_shop uuid, p_id uuid, p_hl boolean, p_actor uuid default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_shape_set_has_length(%L, %L, %L, %L)', p_shop, coalesce(p_actor, pg_temp.own()), p_id, p_hl)) $c$;

-- ใบผลิต + รายการ + ใบงาน (ผ่าน RPC ออฟฟิศเดิม · p_codes = text[] literal) · คืน {po, item, job, job_no, res}
create function pg_temp.po(p_shop uuid, p_note text default 'verify0190') returns uuid
 language sql as $c$ select (analytics.production_order_save(p_shop, null, p_note, null) ->> 'id')::uuid $c$;
create function pg_temp.iset(p_shop uuid, p_order uuid, p_product uuid, p_qty int, p_label text default null, p_metal text default null, p_purity numeric default null, p_weight numeric default null, p_wsrc text default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>%L, p_qty_planned=>%L, p_pending_product_label=>%L, p_metal=>%L, p_purity=>%L, p_weight_g=>%L, p_weight_source=>%L)',
    p_shop, p_order, p_product, p_qty, p_label, p_metal, p_purity, p_weight, p_wsrc)) $c$;
-- p_gem: null = ไม่ส่งอาร์กิวเมนต์ (ค่าเริ่ม = คัดลอกแม่แบบถ้ามีขั้นฝัง) · jsonb ใดๆ = ส่งไป ('[]' = ไม่มีพลอย)
create function pg_temp.mkjob(p_shop uuid, p_product uuid, p_codes text default null, p_gem jsonb default null, p_force boolean default false, p_qty int default 3) returns jsonb
 language plpgsql as $c$
declare o uuid; r jsonb; j jsonb;
begin
  o := pg_temp.po(p_shop, 'v190');
  r := pg_temp.iset(p_shop, o, p_product, p_qty);
  if r ? '_err' then return jsonb_build_object('err', r ->> '_err', 'stage', 'item'); end if;
  j := pg_temp.q(format('select analytics.job_create_from_production_item(p_shop_id=>%L, p_production_order_item_id=>%L, p_stage_codes=>%L::text[], p_actor=>%L%s)',
    p_shop, r ->> 'id', coalesce(p_codes, pg_temp.std()), pg_temp.nom(),
    case when p_gem is null then '' else format(', p_gem_lines=>%L::jsonb, p_gem_force=>%L', p_gem, p_force) end));
  return jsonb_build_object('po', o, 'item', r ->> 'id', 'job', j ->> 'job_id', 'job_no', j ->> 'job_no', 'res', j, 'err', j ->> '_err', 'hint', j ->> '_hint', 'state', j ->> '_state', 'detail', j ->> '_detail');
end;
$c$;
-- ช่างรับ/ส่งขั้นถัดไปของใบ (ผ่าน RPC ออฟฟิศเดิม) · p_send = true ส่งต่อด้วย · คืน stage_code ที่ทำ
create function pg_temp.step(p_shop uuid, p_job uuid, p_send boolean) returns text
 language plpgsql as $c$
declare sq int; cd text; r jsonb;
begin
  select s.seq, s.stage_code into sq, cd from analytics.job_stage s where s.job_id = p_job and s.status = 'pending' order by s.seq limit 1;
  if sq is null then return null; end if;
  r := pg_temp.q(format('select analytics.job_office_receive(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_occurred_on=>%L, p_weight_in_g=>null, p_assignee_name=>%L, p_actor=>%L)', p_shop, p_job, sq, analytics.job_today(), 'x', pg_temp.nom()));
  if r ? '_err' then
    r := pg_temp.q(format('select analytics.job_office_receive(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_occurred_on=>%L, p_weight_in_g=>%L, p_assignee_name=>%L, p_actor=>%L)', p_shop, p_job, sq, analytics.job_today(), 50, 'x', pg_temp.nom()));
  end if;
  if r ? '_err' then raise exception 'step receive % ล้ม: %', cd, r::text; end if;
  if p_send then
    r := pg_temp.q(format('select analytics.job_office_send(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_occurred_on=>%L, p_weight_out_g=>null, p_qty_scrap=>0, p_actor=>%L)', p_shop, p_job, sq, analytics.job_today(), pg_temp.nom()));
    if r ? '_err' then
      r := pg_temp.q(format('select analytics.job_office_send(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_occurred_on=>%L, p_weight_out_g=>%L, p_qty_scrap=>0, p_actor=>%L)', p_shop, p_job, sq, analytics.job_today(), 49, pg_temp.nom()));
    end if;
    if r ? '_err' then raise exception 'step send % ล้ม: %', cd, r::text; end if;
  end if;
  return cd;
end;
$c$;
create function pg_temp.walk_to(p_shop uuid, p_job uuid, p_code text) returns void
 language plpgsql as $c$
declare cd text; n int := 0;
begin
  -- ส่งทุกขั้นก่อนหน้า p_code ให้เสร็จ แล้วหยุดก่อนขั้น p_code (ไม่รับ)
  loop
    select s.stage_code into cd from analytics.job_stage s where s.job_id = p_job and s.status = 'pending' order by s.seq limit 1;
    exit when cd is null or cd = p_code;
    perform pg_temp.step(p_shop, p_job, true);
    n := n + 1;
    if n > 20 then raise exception 'walk_to วนเกิน'; end if;
  end loop;
end;
$c$;
create function pg_temp.w_res(p_tokh text, p_sesh text default null, p_ip text default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.job_worker_resolve(%L, %L, %L)', p_tokh, p_sesh, p_ip)) $c$;
create function pg_temp.login(p_tokh text, p_worker uuid, p_pin text) returns jsonb
 language plpgsql as $c$
declare r jsonb;
begin
  r := pg_temp.q(format('select analytics.worker_pin_verify(%L, %L, %L, %L, %L)', p_tokh, p_worker, p_pin, 'verify-ua/1.0', null));
  if (r ->> 'ok') = 'true' then
    r := r || jsonb_build_object('session_hash', analytics.job_sha256_hex(r ->> 'session_token'));
  end if;
  return r;
end;
$c$;
create function pg_temp.wu(p_shop uuid, p_name text, p_pin text, p_codes text default '{qc}', p_open boolean default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.worker_upsert(p_shop_id=>%L, p_id=>null, p_display_name=>%L, p_stage_codes=>%L::text[], p_pin=>%L, p_actor=>%L, p_can_open_job=>%L, p_can_external=>null)',
    p_shop, p_name, p_codes, p_pin, pg_temp.nom(), p_open)) $c$;

-- ============================================================================
-- A. setup (ร้านสังเคราะห์ ZZ190 A/B — insert public.shop + shop_member ตรง: ข้อยกเว้นที่ไม่ผ่าน RPC · บอกตรงๆ) · ที่เหลือผ่าน RPC ของระบบ
-- ============================================================================
create function pg_temp.g_setup() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  u1 uuid; u2 uuid; u3 uuid;
  p uuid; r jsonb; j jsonb; w uuid;
begin
  insert into public.shop (id, name) values (a, 'ZZ TEST verify-0190 A'), (b, 'ZZ TEST verify-0190 B');
  perform pg_temp.setfx('A', a); perform pg_temp.setfx('B', b);
  -- ยืม auth user จริง (FK shop_member.user_id → auth.users): owner 2 คน (ต่างกัน) + admin 1 คน — เป็นสมาชิกร้านสังเคราะห์ในทรานแซกชันนี้เท่านั้น
  select m.user_id into u1 from public.shop_member m where m.role = 'owner' order by m.user_id limit 1;
  select m.user_id into u2 from public.shop_member m where m.role = 'owner' order by m.user_id desc limit 1;
  select m.user_id into u3 from public.shop_member m where m.role = 'admin' order by m.user_id limit 1;
  if u1 is null or u2 is null or u3 is null or u1 = u2 then
    raise exception 'setup: ต้องมี owner 2 คน (ต่างกัน) + admin 1 คน ใน shop_member จริงเพื่อยืมเป็นผู้ทำรายการ';
  end if;
  insert into public.shop_member (shop_id, user_id, role) values (a, u1, 'owner'), (a, u3, 'admin'), (a, u2, 'staff'), (b, u2, 'owner');
  perform pg_temp.setfx('u_owner', u1); perform pg_temp.setfx('u_admin', u3); perform pg_temp.setfx('u_staff', u2);
  perform analytics.gem_shape_ensure(a);  -- เหมือนจอเปิดรายการพลอย (gem_options_list) ครั้งแรก = seed รูปทรง 12
  perform analytics.job_stage_def_ensure(a); perform analytics.job_record_profile_ensure(a);
  perform analytics.job_stage_def_ensure(b); perform analytics.job_record_profile_ensure(b);
  -- SKU ร้าน A (แม่แบบพลอยกับ SKU ที่ไม่มีแม่แบบ) · ร้าน B
  p := analytics.product_upsert(a, 'ZZ190-A1', 'แหวนทดสอบ A1', null, 'fixed', 88, null, null, null, 150, null, null, null, true); perform pg_temp.setfx('pA1', p);
  p := analytics.product_upsert(a, 'ZZ190-A2', 'แหวนทดสอบ A2', null, 'fixed', 50, null, null, null, null, null, null, null, true); perform pg_temp.setfx('pA2', p);
  p := analytics.product_upsert(a, 'ZZ190-A3', 'แหวนไม่มีแม่แบบ A3', null, 'fixed', 55, null, null, null, null, null, null, null, true); perform pg_temp.setfx('pA3', p);
  p := analytics.product_upsert(a, 'ZZ190-A4', 'แหวนทดสอบ A4', null, 'fixed', 60, null, null, null, null, null, null, null, true); perform pg_temp.setfx('pA4', p);
  p := analytics.product_upsert(a, 'ZZ190-W0', 'แหวนหน้างาน W0 (ไม่มีแม่แบบ)', null, 'fixed', 40, null, null, null, null, null, null, null, true); perform pg_temp.setfx('pW0', p);
  p := analytics.product_upsert(a, 'ZZ190-W1', 'แหวนหน้างาน W1 (มีแม่แบบ)', null, 'fixed', 40, null, null, null, null, null, null, null, true); perform pg_temp.setfx('pW1', p);
  p := analytics.product_upsert(b, 'ZZ190-B1', 'SKU ร้าน B', null, 'fixed', 70, null, null, null, null, null, null, null, true); perform pg_temp.setfx('pB1', p);
  -- ของฝั่งร้าน B (ชนิด/รายการ) — ใช้ทดสอบ "ร้านอื่น"
  r := pg_temp.ccreate(b, 'type', 'ทับทิมบี', null, false, u2);
  if r ? '_err' then raise exception 'setup: สร้างชนิดร้าน B ไม่ได้ %', r::text; end if;
  perform pg_temp.setfx('tB', (r ->> 'id')::uuid);
  perform pg_temp.setfx('sB', pg_temp.shp(b, 'กลม'));
  r := pg_temp.icreate(b, jsonb_build_object('type_id', pg_temp.fx('tB'), 'shape_id', pg_temp.fx('sB'), 'size_a', 3), false, u2);
  if r ? '_err' then raise exception 'setup: สร้างรายการร้าน B ไม่ได้ %', r::text; end if;
  perform pg_temp.setfx('iB', (r -> 'item' ->> 'gem_item_id')::uuid);
  -- ใบงานตั้งต้น J1 (มีขั้นฝัง ไม่มีพลอย) + QR ใบงาน + ช่างฝัง (ใช้ทดสอบ resolve หน้าช่าง)
  j := pg_temp.mkjob(a, pg_temp.fx('pA1'), pg_temp.stdg());
  if j ->> 'job' is null then raise exception 'setup: สร้างใบงานตั้งต้นไม่ได้ %', j::text; end if;
  perform pg_temp.setfx('J1', (j ->> 'job')::uuid); perform pg_temp.setkv('J1_no', j ->> 'job_no');
  r := analytics.job_token_issue(a, pg_temp.fx('J1'), null, pg_temp.nom());
  perform pg_temp.setkv('tokh_J1', analytics.job_sha256_hex(r ->> 'token'));
  r := pg_temp.wu(a, 'ZZ-W ช่างฝัง', '2468', '{gem_set,qc}', null);
  perform pg_temp.setfx('wW', (r ->> 'id')::uuid);
  r := pg_temp.login(pg_temp.kv('tokh_J1'), pg_temp.fx('wW'), '2468');
  perform pg_temp.setkv('sW', r ->> 'session_hash');
  v := v || pg_temp.chk('S0', 'setup: ร้าน A/B · สมาชิก owner/admin/staff · SKU 4+1 · ใบงานตั้งต้น J1 (มีขั้น gem_set ไม่มีพลอย) · QR ใบงาน + ช่างฝัง login',
    pg_temp.kv('sW') is not null and pg_temp.kv('tokh_J1') is not null and pg_temp.fx('J1') is not null);
  return v;
end;
$c$;

create function pg_temp.opn(p_tokh text, p_sess text, p jsonb) returns jsonb
 language plpgsql as $c$
begin
  -- ถังจำกัดอัตรานับทุกครั้งที่เรียก — ล้างก่อน (fixture: DELETE ตรง — ยกเว้นเดียวที่ไม่ผ่าน RPC เหมือน verify-0189)
  delete from analytics.worker_rate_limit where key like 'wo:%' or key like 'sio:%' or key like 'ipw:%';
  return pg_temp.q(format('select analytics.job_worker_open(p_token_hash=>%L, p_session_hash=>%L, p_idem_key=>%L, p_product_id=>%L, p_pending_label=>%L, p_metal=>%L, p_qty_order=>%L, p_user_agent=>%L, p_ip_hash=>null)',
    p_tokh, p_sess, 'ik' || replace(gen_random_uuid()::text, '-', ''), p ->> 'product', p ->> 'label', p ->> 'metal', coalesce(p ->> 'qty', '2'), 'verify-ua/1.0'));
end;
$c$;


-- เคสที่รู้ว่าเป็นข้อบกพร่อง/หนี้ที่ยังเปิดอยู่ (QA 22 ต.ค. 69): ตอนนี้พิมพ์ [BUG-OPEN] · ถ้าแก้แล้วจะกลับเป็น [OK] เอง · ไม่นับเป็น FAIL
create function pg_temp.known(p_id text, p_desc text, p_ok boolean, p_detail text default '') returns text
 language sql as $c$
  select case when coalesce(p_ok, false) then format('[OK] %s  %s  (แก้แล้ว)', p_id, p_desc) else format('[BUG-OPEN] %s  %s  ⟶ %s', p_id, p_desc, left(coalesce(p_detail, '(null)'), 500)) end || E'
' $c$;

-- ============================================================================
-- R2-D2 (qa-tester) ad-hoc QA ของ 0190 — ชุด 1: ครบวงจร · หน้าต่างแก้ · resolve/A5 · ราคาไม่รั่ว · ใบเดิม · ส่วนย่อย · W1 · OEM จริง · ทอง
-- รันต่อท้าย: migration 0190 + prelude (helper + g_setup ของ verify-0190) · จบด้วย raise exception เสมอ (ROLLBACK)
-- ============================================================================
create function pg_temp.chkv(p_id text, p_desc text, p_ok boolean, p_detail text default '') returns text
 language sql as $c$
  select pg_temp.chk(p_id, p_desc || case when coalesce(p_ok, false) then '' else '  ⟶ ' || left(coalesce(p_detail, '(null)'), 600) end, p_ok) $c$;

-- แถวพลอยปัจจุบันของใบ (รูปแบบ gem_item_id) · p_delta บวกจำนวนของแถวแรก
create function pg_temp.cur(p_job uuid, p_delta int default 0) returns jsonb
 language sql as $c$
  select coalesce(jsonb_agg(jsonb_build_object('gem_item_id', g.gem_item_id, 'qty_per_piece', g.qty_per_piece + case when g.line_seq = 1 then p_delta else 0 end, 'position', g.position_note) order by g.line_seq), '[]'::jsonb)
    from analytics.job_gem_bom g where g.job_id = p_job $c$;

create function pg_temp.codes_of(p_si jsonb) returns text
 language sql as $c$
  select '{' || coalesce(string_agg(e, ',' order by o), '') || '}' from jsonb_array_elements_text(p_si -> 'suggested_stage_codes') with ordinality as t(e, o) $c$;

create function pg_temp.pcreate(p_shop uuid, p_item uuid, p_codes text, p_gem jsonb default null, p_force boolean default false, p_extra text default '') returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_create_from_production_item(p_shop_id=>%L, p_production_order_item_id=>%L, p_stage_codes=>%L::text[], p_actor=>%L%s%s)',
    p_shop, p_item, p_codes, pg_temp.nom(), case when p_gem is null then '' else format(', p_gem_lines=>%L::jsonb, p_gem_force=>%L', p_gem, p_force) end, p_extra)) $c$;

-- ============================================================================

-- QA UI-G1a (R2-D2): payload ที่ UI ส่ง (draftRowsToInputs -> toWireGemLines) ยิงเข้า RPC 0190 จริง · เทียบสัญญาของผลลัพธ์กับ mapper TS
-- ============================================================================
create function pg_temp.info(p_id text, p_txt text) returns text language sql as $c$ select format('[INFO] %s|%s', p_id, p_txt) || E'\n' $c$;
create function pg_temp.pkj(p_job uuid) returns jsonb language sql as $c$
  select coalesce(jsonb_agg(jsonb_build_object('gem_item_id', g.gem_item_id, 'qty_per_piece', g.qty_per_piece) || case when g.position_note is null then '{}'::jsonb else jsonb_build_object('position', g.position_note) end order by g.line_seq), '[]'::jsonb)
    from analytics.job_gem_bom g where g.job_id = p_job $c$;

create function pg_temp.q_ui1() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); own uuid := pg_temp.own();
  egg uuid := pg_temp.shp(a, 'ไข่'); rnd uuid := pg_temp.shp(a, 'กลม');
  j jsonb; jid uuid; r jsonb; r2 jsonb; g jsonb; t_gom uuid; t_cz uuid; n0 int; x uuid; lines jsonb; d jsonb; tok jsonb; tokh text; lg jsonb; sess text;
begin
  -- UI1: payload เหมือน draftRowsToInputs (size เป็น JSON number · position มีเฉพาะเมื่อไม่ null · ไม่มี type_id เมื่อพิมพ์ชื่อใหม่) ผ่านตอนสร้างใบ
  j := pg_temp.mkjob(a, pg_temp.fx('pA3'), pg_temp.stdg(),
    format('[{"qty_per_piece":2,"size_a":4,"size_b":6,"new_type_name":"ZZUI โกเมน","shape_id":"%s","position":"บ่าซ้าย-ขวา"},{"qty_per_piece":30,"size_a":1.5,"new_type_name":"ZZUI CZ","shape_id":"%s"}]', egg, rnd)::jsonb, false, 35);
  jid := nullif(j ->> 'job', '')::uuid;
  v := v || pg_temp.chkv('UI1', 'สร้างใบพร้อมพลอย 2 แถว (ชนิดใหม่พิมพ์เอง) payload ของ UI -> job_create_from_production_item ผ่าน · gem_lines=2 · gem_summary.created_types=2', jid is not null and (j -> 'res' ->> 'gem_lines') = '2'
    and jsonb_array_length(j -> 'res' -> 'gem_summary' -> 'created_types') = 2, j::text);
  g := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, jid));
  v := v || pg_temp.chkv('UI1b', 'job_gem_bom_get: รวม = ต่อชิ้น x 35 (70 / 1050 ตรงกับตัวคูณที่จอแสดง) · ฉลาก DB = ตัวอย่างฝั่งจอ (ZZUI โกเมน · ไข่ · 4×6 มม. / ZZUI CZ · กลม · 1.5 มม.)',
    (g -> 'lines' -> 0 ->> 'qty_total') = '70' and (g -> 'lines' -> 1 ->> 'qty_total') = '1050' and (g -> 'lines' -> 0 ->> 'label') = 'ZZUI โกเมน · ไข่ · 4×6 มม.' and (g -> 'lines' -> 1 ->> 'label') = 'ZZUI CZ · กลม · 1.5 มม.', g::text);
  v := v || pg_temp.info('CONTRACT_job_gem_bom_get', g::text);
  v := v || pg_temp.info('CONTRACT_create_res', (j -> 'res')::text);
  t_gom := pg_temp.typ(a, 'ZZUI โกเมน'); t_cz := pg_temp.typ(a, 'ZZUI CZ');

  -- UI2: ส่งแถวเดิมกลับเป็น gem_item_id (position มีเฉพาะที่ไม่ null) = ไม่เปลี่ยนอะไร (changed=false) · ฉลาก snapshot คงเดิม
  r := pg_temp.bset(a, jid, pg_temp.pkj(jid), own);
  v := v || pg_temp.chkv('UI2', 'ส่งแถวเดิมกลับ (gem_item_id) -> ผ่านและ changed=false (ไม่เขียน event ซ้ำ)', r ->> '_err' is null and r ->> 'changed' = 'false', r::text);
  -- UI2b: unlockRow: ผู้ใช้กด "เปลี่ยนรายการ" แล้วไม่แก้ค่า -> ส่ง type_id/shape_id/size เดิม -> resolve เป็นรายการเดิม changed=false
  r := pg_temp.bset(a, jid, format('[{"type_id":"%s","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":2,"position":"บ่าซ้าย-ขวา"},{"type_id":"%s","shape_id":"%s","size_a":1.5,"qty_per_piece":30}]', t_gom, egg, t_cz, rnd)::jsonb, own);
  v := v || pg_temp.chkv('UI2b', 'unlockRow ไม่แก้ค่า -> payload แบบ type/shape/size resolve เป็นรายการเดิม changed=false', r ->> '_err' is null and r ->> 'changed' = 'false', r::text);
  -- UI2c: กรอกขนาดกลับด้าน 6x4 (UI เรียงให้เป็น 4x6 ก่อนส่ง · ถ้าหลุดไป DB ต้องสลับให้เอง)
  r := pg_temp.bset(a, jid, format('[{"type_id":"%s","shape_id":"%s","size_a":6,"size_b":4,"qty_per_piece":2,"position":"บ่าซ้าย-ขวา"},{"type_id":"%s","shape_id":"%s","size_a":1.5,"qty_per_piece":30}]', t_gom, egg, t_cz, rnd)::jsonb, own);
  v := v || pg_temp.chkv('UI2c', 'ขนาดกลับด้าน 6x4 ส่งตรง -> DB สลับเป็น 4x6 ให้ (ตรงรายการเดิม changed=false)', r ->> '_err' is null and r ->> 'changed' = 'false', r::text);

  -- UI3: ตัวดักชื่อคล้ายตอนบันทึกใบ (ไม่ส่ง force) -> 22023|gem_similar + detail {similar:[{kind,name,rows,matches}]} ไม่เขียนอะไร
  n0 := pg_temp.n_type(a);
  lines := pg_temp.pkj(jid) || format('[{"qty_per_piece":1,"size_a":2,"new_type_name":"ZZUI โกเมนต์","shape_id":"%s"}]', rnd)::jsonb;
  r := pg_temp.bset(a, jid, lines, own);
  d := pg_temp.dtl(r);
  v := v || pg_temp.chkv('UI3', 'ชื่อคล้าย (ZZUI โกเมนต์ ~ ZZUI โกเมน) ไม่ส่ง force -> 22023|gem_similar · detail.similar[0] = type · rows=[3] · matches มี ZZUI โกเมน · ไม่สร้างชนิด',
    pg_temp.hint(r) = '22023|gem_similar' and d -> 'similar' -> 0 ->> 'kind' = 'type' and d -> 'similar' -> 0 -> 'rows' = '[3]'::jsonb and (d -> 'similar' -> 0 -> 'matches' -> 0 ->> 'name') = 'ZZUI โกเมน' and pg_temp.n_type(a) = n0, r::text);
  v := v || pg_temp.info('CONTRACT_similar_err', r::text);
  -- UI3b: ผู้ใช้เลือก "ใช้ตัวที่มี" -> applySimilarChoice แก้แถวเป็น type_id เดิม -> บันทึกผ่าน ไม่สร้างชนิดใหม่
  r := pg_temp.bset(a, jid, pg_temp.pkj(jid) || format('[{"qty_per_piece":1,"size_a":2,"type_id":"%s","shape_id":"%s"}]', t_gom, rnd)::jsonb, own);
  v := v || pg_temp.chkv('UI3b', 'ใช้ตัวที่มี (type_id เดิม) -> บันทึกผ่าน · ไม่เพิ่มชนิด', r ->> '_err' is null and r ->> 'changed' = 'true' and pg_temp.n_type(a) = n0, r::text);
  -- UI3c: ผู้ใช้เลือก "เพิ่มใหม่จริงๆ" (force) -> สร้างชนิดใหม่
  r := pg_temp.bset(a, jid, pg_temp.pkj(jid) || format('[{"qty_per_piece":1,"size_a":3,"new_type_name":"ZZUI โกเมนต์","shape_id":"%s"}]', rnd)::jsonb, own, null, true);
  v := v || pg_temp.chkv('UI3c', 'force=true -> สร้าง ZZUI โกเมนต์ เป็นชนิดใหม่ (ชนิด +1)', r ->> '_err' is null and pg_temp.n_type(a) = n0 + 1, r::text);
  -- UI3d: force เป็นแบบ "ครั้งเดียวทั้งคำขอ" — ชนิดคล้ายตัวที่ 2 ในคำขอเดียวกันถูกสร้างเงียบโดยไม่ถูกถาม (จอส่ง force ค้างทั้งฟอร์ม)
  r := pg_temp.bset(a, jid, pg_temp.pkj(jid) || format('[{"qty_per_piece":1,"size_a":3.5,"new_type_name":"ZZUI ซีแซด","shape_id":"%s"}]', rnd)::jsonb, own, null, true);
  v := v || pg_temp.info('UI3d', 'force ค้างแล้วพิมพ์ชื่อใหม่ที่ไม่คล้ายใคร -> ' || coalesce(r ->> '_err', 'ผ่าน changed=' || (r ->> 'changed')));

  -- UI4: แถวที่ DB ถือว่าซ้ำหลัง resolve แต่ UI จับไม่ได้ (rowDupKey ต่างกัน)
  --  (a) แถว gem_item_id + แถวพิมพ์ type/shape/size เดียวกัน
  x := (select gem_item_id from analytics.job_gem_bom where job_id = jid order by line_seq limit 1);
  r := pg_temp.bset(a, jid, format('[{"gem_item_id":"%s","qty_per_piece":1},{"type_id":"%s","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":2}]', x, t_gom, egg)::jsonb, own);
  v := v || pg_temp.known('UI4a', 'แถว gem_item_id + แถว type/shape/size เดียวกัน (UI ไม่จับว่าซ้ำ) -> DB ไม่รวมเงียบ (error หรือมีบอก)', r ->> '_err' is not null, r::text);
  v := v || pg_temp.info('UI4a_detail', coalesce(r ->> '_err', 'merged_rows=' || coalesce((r -> 'summary' -> 'merged_rows')::text, 'null') || ' count=' || coalesce(r ->> 'count', '?')));
  --  (b) ชื่อใหม่พิมพ์ตัวเล็ก (zzui โกเมน) กับแถวที่เลือกชนิดเดิม
  r := pg_temp.bset(a, jid, format('[{"new_type_name":"zzui โกเมน","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":2},{"type_id":"%s","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":3}]', egg, t_gom, egg)::jsonb, own);
  v := v || pg_temp.known('UI4b', 'แถวพิมพ์ชื่อใหม่ที่ norm ตรงชนิดเดิม + แถวเลือกชนิดเดิมขนาดเดียวกัน (UI ไม่จับว่าซ้ำ) -> DB ไม่รวมเงียบ', r ->> '_err' is not null, r::text);
  v := v || pg_temp.info('UI4b_detail', coalesce(r ->> '_err', 'merged_rows=' || coalesce((r -> 'summary' -> 'merged_rows')::text, 'null') || ' reused=' || coalesce((r -> 'summary' -> 'reused')::text, 'null') || ' count=' || coalesce(r ->> 'count', '?')));

  -- UI5: ค่านอกกรอบที่ UI ปล่อยให้ผ่านด่านจอ (parseGemQty / parseGemSize) -> DB ตอบอย่างไร
  r := pg_temp.bset(a, jid, format('[{"type_id":"%s","shape_id":"%s","size_a":100,"qty_per_piece":1000}]', t_cz, rnd)::jsonb, own);
  v := v || pg_temp.chkv('UI5a', 'ขอบ size=100 qty=1000 ผ่าน (ตรง GEM_LIMITS)', r ->> '_err' is null, r::text);
  r := pg_temp.bset(a, jid, format('[{"type_id":"%s","shape_id":"%s","size_a":100.01,"qty_per_piece":1}]', t_cz, rnd)::jsonb, own);
  v := v || pg_temp.chkv('UI5b', 'size 100.01 -> ปฏิเสธ size_invalid ที่แถว 1 field size_a', pg_temp.hint(r) = '22023|size_invalid' and pg_temp.dtl(r) ->> 'row' = '1', r::text);
  r := pg_temp.bset(a, jid, format('[{"type_id":"%s","shape_id":"%s","size_a":1.005,"qty_per_piece":1}]', t_cz, rnd)::jsonb, own);
  v := v || pg_temp.chkv('UI5c', 'size ทศนิยม 3 ตำแหน่ง -> ไม่ปัดเงียบ (size_invalid)', pg_temp.hint(r) = '22023|size_invalid', r::text);
  r := pg_temp.bset(a, jid, format('[{"type_id":"%s","shape_id":"%s","size_a":2,"qty_per_piece":1001}]', t_cz, rnd)::jsonb, own);
  v := v || pg_temp.chkv('UI5d', 'qty 1001 -> qty_invalid', pg_temp.hint(r) = '22023|qty_invalid', r::text);
  r := pg_temp.bset(a, jid, format('[{"type_id":"%s","shape_id":"%s","size_a":2,"size_b":3,"qty_per_piece":1}]', t_cz, rnd)::jsonb, own);
  v := v || pg_temp.chkv('UI5e', 'รูปทรง 1 ค่า (กลม) ส่ง size_b -> size_b_unexpected', pg_temp.hint(r) = '22023|size_b_unexpected', r::text);
  r := pg_temp.bset(a, jid, format('[{"type_id":"%s","shape_id":"%s","size_a":2,"qty_per_piece":1}]', t_cz, egg)::jsonb, own);
  v := v || pg_temp.chkv('UI5f', 'รูปทรง 2 ค่า (ไข่) ไม่ส่ง size_b -> size_b_required', pg_temp.hint(r) = '22023|size_b_required', r::text);
  r := pg_temp.bset(a, jid, format('[{"type_id":"%s","shape_id":"%s","size_a":2,"qty_per_piece":1,"position":"%s"}]', t_cz, rnd, repeat('ก', 41))::jsonb, own);
  v := v || pg_temp.chkv('UI5g', 'ตำแหน่ง 41 ตัวอักษร -> position_invalid (UI จำกัด 40)', pg_temp.hint(r) = '22023|position_invalid', r::text);
  r := pg_temp.bset(a, jid, format('[{"type_id":"%s","shape_id":"%s","size_a":2,"qty_per_piece":1,"position":"<b>x</b>"}]', t_cz, rnd)::jsonb, own);
  v := v || pg_temp.chkv('UI5h', 'ตำแหน่งมี < > -> position_invalid', pg_temp.hint(r) = '22023|position_invalid', r::text);
  -- ครบ 30 แถว / 31 แถว (UI ไม่มีเพดานแถวฝั่งจอ — ส่งไปแล้ว DB/wire ตีกลับ)
  lines := (select jsonb_agg(jsonb_build_object('type_id', t_cz, 'shape_id', rnd, 'size_a', 1 + i * 0.25, 'qty_per_piece', 1)) from generate_series(1, 30) i);
  r := pg_temp.bset(a, jid, lines, own);
  v := v || pg_temp.chkv('UI5i', '30 แถวผ่าน', r ->> '_err' is null and r ->> 'count' = '30', r::text);
  lines := (select jsonb_agg(jsonb_build_object('type_id', t_cz, 'shape_id', rnd, 'size_a', 1 + i * 0.25, 'qty_per_piece', 1)) from generate_series(1, 31) i);
  r := pg_temp.bset(a, jid, lines, own);
  v := v || pg_temp.chkv('UI5j', '31 แถว -> too_many_lines', pg_temp.hint(r) = '22023|too_many_lines', r::text);
  -- กลับเป็นพลอยชุดเล็กเพื่อทดสอบต่อ
  r := pg_temp.bset(a, jid, format('[{"type_id":"%s","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":2,"position":"บ่าซ้าย-ขวา"},{"type_id":"%s","shape_id":"%s","size_a":1.5,"qty_per_piece":30}]', t_gom, egg, t_cz, rnd)::jsonb, own);
  v := v || pg_temp.chkv('UI5k', 'กลับเป็นชุดเล็ก 2 แถว', r ->> '_err' is null and r ->> 'count' = '2', r::text);
  perform pg_temp.setfx('uiJob', jid);
  return v;
end;
$c$;

create function pg_temp.q_ui2() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); own uuid := pg_temp.own();
  egg uuid := pg_temp.shp(a, 'ไข่'); rnd uuid := pg_temp.shp(a, 'กลม');
  jid uuid := pg_temp.fx('uiJob'); t_gom uuid := pg_temp.typ(a, 'ZZUI โกเมน'); t_cz uuid := pg_temp.typ(a, 'ZZUI CZ');
  j jsonb; r jsonb; reasons text[]; rs text; res text; g jsonb; w jsonb; tk jsonb; tokh text; lg jsonb; sess text; cur jsonb; ins jsonb;
begin
  -- ใบใหม่ที่ยังไม่มีขั้นใดรับ -> window free_before_start · แล้วเดินถึงขั้นฝังแล้วรับ -> reason_required
  j := pg_temp.mkjob(a, pg_temp.fx('pA3'), pg_temp.stdg(), format('[{"type_id":"%s","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":2},{"type_id":"%s","shape_id":"%s","size_a":1.5,"qty_per_piece":30}]', t_gom, egg, t_cz, rnd)::jsonb, false, 10);
  jid := (j ->> 'job')::uuid;
  perform pg_temp.walk_to(a, jid, 'gem_set');
  res := pg_temp.step(a, jid, false);
  v := v || pg_temp.chkv('UI6a', 'เดินถึงขั้นฝังและรับ gem_set', res = 'gem_set', coalesce(res, '(null)'));
  g := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, jid));
  v := v || pg_temp.chkv('UI6b', 'job_gem_bom_get window=reason_required (จอใช้ตัดสินว่าต้องมีช่องเหตุผล)', g ->> 'window' = 'reason_required', g::text);
  -- ตารางเหตุผล: JS oemNotePresent (lib/oem/display.ts) ต้องตรงกับ DB (ส่งทีละค่า · แก้ qty +1 ทุกครั้งเพื่อให้มีการเปลี่ยนจริง)
  reasons := array['👍', '.', chr(10240), '0', 'ก', 'ok', chr(8203) || 'x', '…', 'a' || chr(65039), '   ', '', chr(133) || '1', repeat('ก', 300), repeat('ก', 301), 'เติมพลอยเพิ่ม 1 เม็ด', '---', 'ครับ!', '12', '๑'];
  foreach rs in array reasons loop
    cur := pg_temp.cur(jid, 1);
    r := pg_temp.bset(a, jid, cur, own, rs);
    v := v || pg_temp.info('RS', left(rs, 12) || '|' || length(rs) || '|' || pg_temp.hint(r) || '|' || (select string_agg(to_hex(ascii(ch)), ',') from regexp_split_to_table(left(rs, 4), '') ch));
  end loop;
  -- UI6c: ไม่ส่งเหตุผล (null) ไม่ใช่ '' -> reason_required (UI ส่ง null เมื่อว่าง)
  r := pg_temp.bset(a, jid, pg_temp.cur(jid, 1), own, null);
  v := v || pg_temp.chkv('UI6c', 'reason null หลังขั้นฝังรับ -> reason_required', pg_temp.hint(r) = '22023|reason_required', r::text);

  -- history/สรุปแถวที่จอใช้ (mapJobGems)
  g := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, jid));
  v := v || pg_temp.chkv('UI6d', 'job_gem_bom_get: history มีแถว reason + before/after (จอโชว์ประวัติ) · ไม่มี key ราคา', jsonb_array_length(g -> 'history') >= 1 and pg_temp.badkeys(g) = '' and not pg_temp.has_px(g), left(g::text, 600));
  v := v || pg_temp.info('CONTRACT_job_gem_bom_get_after_edit', g::text);

  -- หน้าช่าง: resolve ด้วย PIN -> gems/gems_state (WorkerGem {label,qty_per_piece,qty_total,position}) ไม่มีราคา
  tk := analytics.job_token_issue(a, jid, null, pg_temp.nom());
  tokh := analytics.job_sha256_hex(tk ->> 'token');
  lg := pg_temp.login(tokh, pg_temp.fx('wW'), '2468');
  sess := lg ->> 'session_hash';
  w := pg_temp.w_res(tokh, sess);
  v := v || pg_temp.chkv('UI7a', 'job_worker_resolve (ช่างฝัง ระบุตัวแล้ว): gems_state=specified · gems 2 แถว · ไม่มีราคา', w -> 'job' ->> 'gems_state' = 'specified' and jsonb_array_length(w -> 'job' -> 'gems') = 2 and pg_temp.badkeys(w -> 'job' -> 'gems') = '' and not pg_temp.has_px(w), left(w::text, 700));
  v := v || pg_temp.info('CONTRACT_worker_gems', coalesce((w -> 'job' -> 'gems')::text, 'null') || ' state=' || coalesce(w -> 'job' ->> 'gems_state', 'null') || ' actionStage=' || coalesce((w -> 'action_stage')::text, 'null'));
  v := v || pg_temp.info('CONTRACT_worker_resolve', w::text);
  w := pg_temp.w_res(tokh);
  v := v || pg_temp.chkv('UI7b', 'ก่อน PIN: ไม่มี gems/gems_state ใน job', not (w -> 'job' ? 'gems') and not (w -> 'job' ? 'gems_state'), left(w::text, 400));

  -- ใบที่มีขั้นฝังแต่ไม่มีพลอย: gems_state=unspecified (หน้าช่างเตือน) · ใบ J1 ของ setup
  tk := analytics.job_token_issue(a, pg_temp.fx('J1'), null, pg_temp.nom());
  tokh := analytics.job_sha256_hex(tk ->> 'token');
  lg := pg_temp.login(tokh, pg_temp.fx('wW'), '2468');
  w := pg_temp.w_res(tokh, lg ->> 'session_hash');
  v := v || pg_temp.chkv('UI7c', 'ใบ J1 (มีขั้นฝัง ไม่มีพลอย): gems_state=unspecified · gems=[]', w -> 'job' ->> 'gems_state' = 'unspecified' and jsonb_array_length(coalesce(w -> 'job' -> 'gems', '[]'::jsonb)) = 0, left(w::text, 500));
  perform pg_temp.setfx('uiJob2', jid);
  return v;
end;
$c$;

create function pg_temp.q_ui3() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); own uuid := pg_temp.own(); stf uuid := pg_temp.stf();
  egg uuid := pg_temp.shp(a, 'ไข่'); rnd uuid := pg_temp.shp(a, 'กลม');
  t_gom uuid := pg_temp.typ(a, 'ZZUI โกเมน'); t_cz uuid := pg_temp.typ(a, 'ZZUI CZ'); jid uuid := pg_temp.fx('uiJob');
  r jsonb; r2 jsonb; d jsonb; n0 int; it uuid; tpl jsonb; p uuid := pg_temp.fx('pA4'); cat jsonb; ol jsonb; hist jsonb; mp jsonb; sh_new uuid; ty_new uuid; o2 uuid; itj jsonb; pl jsonb;
begin
  -- gem_item_create (GemAddItemDialog): UI ส่ง line ไม่มี qty_per_piece
  r := pg_temp.icreate(a, format('{"type_id":"%s","shape_id":"%s","size_a":3}', t_gom, rnd)::jsonb, false, own);
  v := v || pg_temp.chkv('UI8a', 'gem_item_create type/shape/size (ไม่มี qty) -> created=true · ไม่มีราคา', r ->> '_err' is null and (r ->> 'created') = 'true' and not pg_temp.has_px(r), r::text);
  it := (r -> 'item' ->> 'gem_item_id')::uuid;
  r := pg_temp.icreate(a, format('{"type_id":"%s","shape_id":"%s","size_a":3}', t_gom, rnd)::jsonb, false, own);
  v := v || pg_temp.chkv('UI8b', 'สร้างซ้ำ -> created=false (ใช้ตัวเดิม ไม่ error)', r ->> '_err' is null and (r ->> 'created') = 'false', r::text);
  r := pg_temp.icreate(a, format('{"type_id":"%s","shape_id":"%s","size_a":2}', t_gom, egg)::jsonb, false, own);
  v := v || pg_temp.chkv('UI8c', 'รูปทรง 2 ค่าไม่ส่ง size_b -> size_b_required ที่ row 1 field size_b', pg_temp.hint(r) = '22023|size_b_required' and pg_temp.dtl(r) ->> 'row' = '1' and pg_temp.dtl(r) ->> 'field' = 'size_b', r::text);
  n0 := pg_temp.n_shape(a);
  r := pg_temp.icreate(a, format('{"type_id":"%s","new_shape":{"name":"ZZUI ทรงใบไม้","has_length":true},"size_a":3,"size_b":5}', t_cz)::jsonb, false, own);
  v := v || pg_temp.chkv('UI8d', 'รูปทรงใหม่ has_length=true พร้อมขนาด 2 ค่า -> เข้าแคตตาล็อกและสร้างรายการ', r ->> '_err' is null and pg_temp.n_shape(a) = n0 + 1 and (r -> 'item' ->> 'label') = 'ZZUI CZ · ZZUI ทรงใบไม้ · 3×5 มม.', r::text);
  r := pg_temp.icreate(a, format('{"type_id":"%s","new_shape":{"name":"ZZUI ทรงใบไมม","has_length":true},"size_a":3,"size_b":5}', t_cz)::jsonb, false, own);
  d := pg_temp.dtl(r);
  v := v || pg_temp.chkv('UI8e', 'รูปทรงใหม่ชื่อคล้าย (ZZUI ทรงใบไมม ~ ZZUI ทรงใบไม้) -> gem_similar kind=shape rows=[1]', pg_temp.hint(r) = '22023|gem_similar' and d -> 'similar' -> 0 ->> 'kind' = 'shape', r::text);

  -- rename (GemRenameDialog): เปลี่ยนตัวพิมพ์เล็กใหญ่ของชื่อตัวเอง · ชื่อซ้ำ norm กับตัวอื่น · ชื่อคล้าย
  r := pg_temp.ren(a, 'type', t_cz, 'ZZUI cz', false, own);
  v := v || pg_temp.known('UI9a', 'rename เปลี่ยนตัวพิมพ์ของชื่อตัวเอง (ZZUI CZ -> ZZUI cz) ต้องทำได้ (จอไม่กันเพราะ c.value !== target.name)', r ->> '_err' is null, r::text);
  r := pg_temp.ren(a, 'type', t_cz, 'ZZUI โกเมน', false, own);
  v := v || pg_temp.chkv('UI9b', 'rename ไปซ้ำชื่ออื่น -> name_exists (+ id/name ของที่ชน)', pg_temp.hint(r) = '22023|name_exists', r::text);
  r := pg_temp.ren(a, 'type', t_cz, 'ZZUI โกเมนน', false, own);
  d := pg_temp.dtl(r);
  v := v || pg_temp.chkv('UI9c', 'rename ไปชื่อคล้าย -> gem_similar (similar[0].matches) · force=true ผ่าน', pg_temp.hint(r) = '22023|gem_similar' and (pg_temp.ren(a, 'type', t_cz, 'ZZUI โกเมนน', true, own) ->> '_err') is null, r::text);
  v := v || pg_temp.info('CONTRACT_rename_similar_err', r::text);

  -- merge preview/commit (GemMergeDialog) + ผูกกับแม่แบบ SKU
  ty_new := pg_temp.typ(a, 'ZZUI โกเมนต์');
  r := pg_temp.tset(a, p, format('[{"type_id":"%s","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":2,"position":"หัวแหวน"}]', ty_new, egg)::jsonb, own);
  v := v || pg_temp.chkv('UI10a', 'ตั้งแม่แบบ SKU ผ่าน product_gem_bom_set (payload type/shape/size) · changed=true', r ->> '_err' is null and r ->> 'changed' = 'true', r::text);
  mp := pg_temp.mprev(a, 'type', ty_new, t_gom, own);
  v := v || pg_temp.chkv('UI10b', 'gem_merge_preview: มี key ที่ mapGemMergePlan อ่าน (items_moved items_collapsed prices_not_moved template_* jobs_*)',
    mp ? 'items_moved' and mp ? 'items_collapsed' and mp ? 'prices_not_moved' and mp ? 'collapsed_missing_price_on_target' and mp ? 'template_lines_repointed' and mp ? 'template_lines_summed' and mp ? 'template_qty_overflow' and mp ? 'template_products' and mp ? 'jobs_open_using' and mp ? 'jobs_using_total', mp::text);
  v := v || pg_temp.info('CONTRACT_merge_preview', mp::text);
  r := pg_temp.mrg(a, 'type', ty_new, t_gom, own);
  v := v || pg_temp.chkv('UI10c', 'gem_merge A->B ผ่าน', r ->> '_err' is null, r::text);
  -- แม่แบบตามไป · ใบเก่า (snapshot) ไม่เปลี่ยน
  tpl := pg_temp.q(format('select analytics.product_gem_bom_get(%L, %L)', a, p));
  v := v || pg_temp.chkv('UI10d', 'product_gem_bom_get หลังรวมชื่อ: แถวแม่แบบตามไปที่ ZZUI โกเมน (label ใหม่) · ไม่มีราคา', (tpl -> 'lines' -> 0 ->> 'label') like 'ZZUI โกเมน · ไข่ · 4×6%' and not pg_temp.has_px(tpl) and pg_temp.badkeys(tpl) = '', tpl::text);
  v := v || pg_temp.info('CONTRACT_product_gem_bom_get', tpl::text);
  o2 := pg_temp.po(a, 'ui-plan'); itj := pg_temp.iset(a, o2, p, 7);
  pl := pg_temp.q(format('select analytics.job_plan_suggest(%L, %L, %L)', a, 'production', itj ->> 'id'));
  v := v || pg_temp.chkv('UI10f', 'job_plan_suggest.gem_bom: 1 แถว (แม่แบบหลังรวมชื่อ) มี label/qty_per_piece/qty_total/position ที่ mapGemBomLine อ่าน · ไม่มีราคา', jsonb_array_length(pl -> 'gem_bom') = 1 and (pl -> 'gem_bom' -> 0) ? 'label' and (pl -> 'gem_bom' -> 0) ? 'qty_total' and pg_temp.badkeys(pl -> 'gem_bom') = '' and not pg_temp.has_px(pl), (pl -> 'gem_bom')::text);
  v := v || pg_temp.info('CONTRACT_plan_gem_bom', (pl -> 'gem_bom')::text);
  -- ลบชื่อที่ถูกรวมแล้วที่ยังมีการอ้างอิง (merged_refs) -> gem_in_use + usage ที่จออ่าน
  r := pg_temp.rmv(a, 'type', ty_new, own);
  v := v || pg_temp.info('UI10e', 'ลบชนิดที่ถูกรวมแล้ว -> ' || coalesce(pg_temp.hint(r), '?') || ' ' || coalesce(r ->> '_detail', ''));

  -- ตั้งเป็นแม่แบบจากใบ (SKU ของใบ pA3 · jid ไม่มี product) -> no_product ; ใบที่มี SKU pA3 -> ผ่าน
  r := pg_temp.q(format('select analytics.product_gem_bom_from_job(%L, %L, %L)', a, jid, own));
  v := v || pg_temp.info('UI11a', 'from_job ' || coalesce(pg_temp.hint(r), '?') || ' ' || left(coalesce(r::text, ''), 200));
  -- ล้างแม่แบบ ([]) แล้วดึงอีกครั้ง
  r := pg_temp.tset(a, p, '[]'::jsonb, own);
  v := v || pg_temp.chkv('UI11b', 'ล้างแม่แบบ ([]) -> ผ่าน changed=true count=0', r ->> '_err' is null and r ->> 'count' = '0', r::text);

  -- ราคา: แคตตาล็อกต้องมีราคาเฉพาะ gem_catalog_list/price_history · staff ถูกปฏิเสธที่ DB · options ไม่มีราคา
  r := pg_temp.price(a, it, '7391.2468', null, own, 'ผู้ขาย ZZ', null);
  v := v || pg_temp.chkv('UI12a', 'gem_price_set ราคา 4 ทศนิยม (7391.2468) ผ่าน', r ->> '_err' is null, r::text);
  r := pg_temp.price(a, it, '7000', null, own, null, null);
  v := v || pg_temp.chkv('UI12b', 'ตั้งราคาทับวันเดิมไม่มี note -> note_required (จอบังคับ note ก่อนกด: overwrite=true)', pg_temp.hint(r) = '22023|note_required', r::text);
  r := pg_temp.price(a, it, '7000', null, own, null, 'พิมพ์ผิดตัวเลข');
  v := v || pg_temp.chkv('UI12c', 'ทับวันเดิมพร้อม note -> ผ่าน replaced=true', r ->> '_err' is null and r ->> 'replaced' = 'true', r::text);
  r := pg_temp.price(a, it, '5', (current_date - 3)::text, own, null, null);
  v := v || pg_temp.chkv('UI12d', 'ราคาย้อนหลังไม่มี note -> note_required (จอ: backdated=date<todayBkk)', pg_temp.hint(r) = '22023|note_required', r::text);
  cat := pg_temp.clist(a, own, true);
  v := v || pg_temp.chkv('UI12e', 'gem_catalog_list (owner) มีราคา price/price_effective_from/has_price ที่ mapGemCatalog อ่าน', (cat -> 'items' -> 0) ? 'price' and (cat -> 'items' -> 0) ? 'has_price' and (cat -> 'items' -> 0) ? 'price_effective_from' and (cat -> 'items' -> 0) ? 'used_jobs_total' and (cat -> 'items' -> 0) ? 'used_templates', left(cat::text, 400));
  v := v || pg_temp.info('CONTRACT_catalog_item', (cat -> 'items' -> 0)::text);
  v := v || pg_temp.info('CONTRACT_catalog_type', (cat -> 'types' -> 0)::text);
  v := v || pg_temp.info('CONTRACT_catalog_shape', (cat -> 'shapes' -> 0)::text);
  r := pg_temp.clist(a, stf, true);
  v := v || pg_temp.chkv('UI12f', 'gem_catalog_list โดย staff -> ปฏิเสธ (กันราคารั่วที่ DB แม้ action ถูกเรียกตรง)', r ? '_err', r::text);
  r := pg_temp.q(format('select analytics.gem_price_history(%L, %L, %L)', a, stf, it));
  v := v || pg_temp.chkv('UI12g', 'gem_price_history โดย staff -> ปฏิเสธ', r ? '_err', r::text);
  ol := pg_temp.olist(a);
  v := v || pg_temp.chkv('UI12h', 'gem_options_list (ทุกบทบาทใช้ในฟอร์ม): ไม่มี key ราคา/ผู้ขาย และไม่มีเลขราคาโผล่', pg_temp.badkeys(ol) = '' and not pg_temp.has_px(ol), left(ol::text, 300));
  hist := pg_temp.q(format('select analytics.gem_price_history(%L, %L, %L)', a, own, it));
  v := v || pg_temp.chkv('UI12i', 'gem_price_history (owner): rows[] + audit[] ที่ mapGemPriceHistory อ่าน · audit มี old_price/new_price/action', jsonb_array_length(hist -> 'rows') >= 1 and jsonb_array_length(hist -> 'audit') >= 2 and (hist -> 'audit' -> 0) ? 'new_price' and (hist -> 'audit' -> 0) ? 'old_price', left(hist::text, 500));
  v := v || pg_temp.info('CONTRACT_price_history', hist::text);
  v := v || pg_temp.info('CONTRACT_options_list', ol::text);
  return v;
end;
$c$;

create function pg_temp.q_ui4() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); own uuid := pg_temp.own();
  egg uuid := pg_temp.shp(a, 'ไข่'); rnd uuid := pg_temp.shp(a, 'กลม');
  t_gom uuid := pg_temp.typ(a, 'ZZUI โกเมน'); t_cz uuid := pg_temp.typ(a, 'ZZUI cz');
  j jsonb; jid uuid; r jsonb; si jsonb; so jsonb; a1 jsonb; g jsonb; p3 uuid := pg_temp.fx('pA2'); pl jsonb; o uuid; it jsonb; px uuid;
begin
  -- ใบเดิม (ไม่เคยแตะส่วนพลอย): ไม่ส่ง p_gem_lines + ไม่มีขั้นฝัง + SKU ไม่มีแม่แบบ -> ไม่มีพลอย · state not_needed
  j := pg_temp.mkjob(a, p3, pg_temp.std(), null, false, 5);
  jid := (j ->> 'job')::uuid;
  g := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, jid));
  v := v || pg_temp.chkv('UI13a', 'สร้างใบโดยไม่แตะพลอย (ไม่ส่ง p_gem_lines · ไม่มีขั้นฝัง) -> ไม่มีพลอย state=not_needed (A5/หน้าช่าง/การ์ด = เดิม)', g ->> 'state' = 'not_needed' and jsonb_array_length(g -> 'lines') = 0, g::text);
  -- ติ๊กขั้นฝังแต่ไม่ส่งพลอย (SKU ไม่มีแม่แบบ) -> state=unspecified (หน้าช่างเตือน ไม่บล็อก)
  j := pg_temp.mkjob(a, p3, pg_temp.stdg(), null, false, 5);
  g := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, (j ->> 'job')::uuid));
  v := v || pg_temp.chkv('UI13b', 'ติ๊กขั้นฝังแต่ไม่ส่งพลอย -> state=unspecified', g ->> 'state' = 'unspecified', g::text);
  -- ส่ง [] (ผู้ใช้ล้างทั้งหมด) กับขั้นฝัง -> ใบสร้างได้ · state=unspecified
  j := pg_temp.mkjob(a, p3, pg_temp.stdg(), '[]'::jsonb, false, 5);
  v := v || pg_temp.chkv('UI13c', 'ส่ง gem_lines=[] พร้อมขั้นฝัง -> สร้างได้ (ไม่บล็อก)', (j ->> 'job') is not null, j::text);
  -- มีพลอยแต่ไม่ติ๊กขั้นฝัง -> สร้างได้ พลอยเก็บไว้ (จอเตือน) · A5 จะแสดงตาราง
  j := pg_temp.mkjob(a, p3, pg_temp.std(), format('[{"type_id":"%s","shape_id":"%s","size_a":2,"qty_per_piece":4}]', t_gom, rnd)::jsonb, false, 5);
  jid := (j ->> 'job')::uuid;
  g := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, jid));
  v := v || pg_temp.chkv('UI13d', 'มีพลอยแต่ไม่ติ๊กขั้นฝัง -> สร้างได้ · lines=1 · state=specified · gem_stage=none (การ์ดแสดงตาราง)', jid is not null and jsonb_array_length(g -> 'lines') = 1 and g ->> 'state' = 'specified' and g ->> 'gem_stage' = 'none', g::text);
  v := v || pg_temp.info('UI13d_state', g ->> 'state' || ' stage=' || (g ->> 'gem_stage'));
  -- ใบไม่มี SKU (OEM/ใบผลิตพิมพ์ชื่อเอง) ส่ง qty ว่าง/สลับ: payload ที่ตกชนิดข้อมูล -> wire ตีกลับที่ฝั่ง app (ไม่ถึง DB) เทสต์ฝั่ง TS
  return v;
end;
$c$;

-- ============================================================================
do $qa$
declare
  v_msg text := E'\n=== verify-0190-qa-ui (R2-D2) ===\n'; fn text; res text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    v_msg := v_msg || pg_temp.g_setup();
    foreach fn in array array['q_ui1', 'q_ui2', 'q_ui3', 'q_ui4'] loop
      begin
        execute format('select pg_temp.%I()', fn) into res;
        v_msg := v_msg || coalesce(res, '');
      exception when others then
        v_msg := v_msg || format('[FAIL] CRASH  %s ล้ม: %s %s', fn, sqlstate, sqlerrm) || E'\n';
      end;
    end loop;
    raise exception 'QA_ROLLBACK';
  exception when others then
    if sqlerrm <> 'QA_ROLLBACK' then v_msg := v_msg || format('[FAIL] CRASH-setup  %s %s', sqlstate, sqlerrm) || E'\n'; end if;
  end;
  raise exception '%', v_msg || format(E'\n--- สรุป: OK %s · FAIL %s · BUG-OPEN %s · INFO %s ---',
    (length(v_msg) - length(replace(v_msg, '[OK]', ''))) / 4, (length(v_msg) - length(replace(v_msg, '[FAIL]', ''))) / 6,
    (length(v_msg) - length(replace(v_msg, '[BUG-OPEN]', ''))) / 10, (length(v_msg) - length(replace(v_msg, '[INFO]', ''))) / 6);
end;
$qa$;
