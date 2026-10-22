-- scripts/verify/verify-0190-qa.sql
-- QA ad-hoc ของ migration 0190 (G1a พลอย) — R2-D2 · 22 ต.ค. 69 · เสริม verify-0190.sql (ไม่ซ้ำกับมัน: ครบวงจร SKU→ใบ→ขั้นฝัง→แก้→resolve · ใบเดิม · ส่วนย่อย · W1/OEM จริง/ทอง · รวมชื่อหลังใบเปิด · ชื่อคล้าย false-positive ·
--   input ผิดรูป 89 เคส · fuzz ลำดับ operation 400 ครั้ง + invariant · ประสิทธิภาพที่แคตตาล็อกใหญ่ · staff/ไม่ใช่สมาชิก)
-- วิธีรัน (dry-run เท่านั้น — ห้าม --commit): ต่อไฟล์ supabase/migrations/0190_gems_g1a.sql + ไฟล์นี้ (LF — ข้อ 20) เป็นไฟล์เดียว แล้ว  node scripts/run-sql.mjs <ไฟล์รวม>
--   หลัง apply 0190 แล้ว: รันไฟล์นี้เดี่ยวๆ ได้ (ต้องมี 0172-0189)
-- ใช้ helper + setup (g_setup · ร้านสังเคราะห์ ZZ TEST verify-0190 A/B ยืมสมาชิกจริง) เดียวกับ verify-0190.sql — ข้อยกเว้นเดียวที่ไม่ผ่าน RPC: insert public.shop/shop_member + fixture ปริมาณมากของ q_perf (ร้านสังเคราะห์ B) · q_oem_real สร้างใบจาก OEM quote item จริงแล้วถอยกลับ
-- ป้ายผล: [OK] ผ่าน · [FAIL] พัง (ต้องแก้) · [BUG-OPEN] ข้อบกพร่อง/หนี้ที่รู้แล้วและยังไม่แก้ (กลับเป็น [OK] เองเมื่อแก้) · [INFO] ข้อมูลประกอบ
-- BUG-OPEN ณ 22 ต.ค. 69: M5 (แก้ใบหลังรวมชื่อ → ฉลาก snapshot ของแถวที่ไม่ได้แก้ถูกเขียนทับด้วยชื่อปลายทาง) · N1/N2 (รวมชนิดที่มีรายการใช้รูปทรงที่ "ปิดใช้งาน" / รวมรูปทรงที่มีรายการของชนิดที่ "ปิดใช้งาน" = gem_ref_inactive ล้มทั้งการรวม) ·
--   NC1 (ชื่อที่เป็นเลขไทย/อารบิก-อินดิกล้วน "๑๒" "١٢" ผ่าน gem_name_ok) · P9 (ตัวดักชื่อคล้ายเป็น O(ชื่อใหม่ × ชนิดทั้งแคตตาล็อก) ด้วย plpgsql — 30 ชื่อ × 2,000 ชนิด ≈ 24 วินาที)
-- parity ของ norm/similar กับ lib/jobs/shop-gems.ts: ตัวอักษร/ไทย/ละติน/ช่องว่าง/วรรคตอน (P*) ตรงกัน 735 คู่ · ต่างเฉพาะหมวดสัญลักษณ์ (p{S}: $ + < = > ^ ` | ~ © ® ° ± × ÷ อีโมจิ ฯลฯ ~7.6k code point — TS ตัดทิ้ง DB เก็บ) → ดู shop-gems.qa.test.ts

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
-- E. ครบวงจร: แม่แบบ SKU (ชนิดใหม่พิมพ์เอง) → ใบงานจาก SKU → ขั้นฝัง + BOM คัดลอก → qty_total → แก้ก่อน/หลังขั้นฝังรับ → resolve → ราคาไม่รั่ว
-- ============================================================================
create function pg_temp.q_cycle() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); oval uuid := pg_temp.shp(a, 'ไข่'); p uuid := pg_temp.fx('pA2');
  r jsonb; r2 jsonb; o uuid; it jsonb; si jsonb; pl jsonb; j jsonb; jid uuid; cd text; g jsonb; n0 int; ln jsonb; tk jsonb; tokh text; sess text; w jsonb; wr jsonb;
  qp int; ok boolean; i1 uuid; i2 uuid; badk text;
begin
  n0 := pg_temp.n_type(a);
  r := pg_temp.tset(a, p, format('[{"new_type_name":"ZZQA ทับทิม","shape_id":"%s","size_a":5,"size_b":3,"qty_per_piece":2,"position":"หัวแหวน"},{"new_type_name":"ZZQA ซิทริน","new_shape":{"name":"ZZQA ทรงดาว","has_length":false},"size_a":1.5,"qty_per_piece":10}]', oval)::jsonb);
  v := v || pg_temp.chkv('E1', 'ตั้งแม่แบบ SKU โดยพิมพ์ชนิดใหม่เอง 2 ชนิด + รูปทรงใหม่ 1 รูปทรง → เข้าแคตตาล็อกเอง (ไม่รอยืนยัน) · ฉลาก DB ประกอบ/สลับขนาด 5×3→3×5 · audit log 1 แถว',
    r ->> '_err' is null and pg_temp.n_type(a) = n0 + 2 and r ->> 'changed' = 'true' and jsonb_array_length(r -> 'lines') = 2
    and (r -> 'lines' -> 0 ->> 'label') = 'ZZQA ทับทิม · ไข่ · 3×5 มม.' and (r -> 'lines' -> 1 ->> 'label') = 'ZZQA ซิทริน · ZZQA ทรงดาว · 1.5 มม.'
    and exists (select 1 from analytics.catalog_audit_log where product_id = p and action = 'edit' and (after -> 'gem_bom') is not null), r::text);
  select i.id into i1 from analytics.gem_item i join analytics.gem_type t on t.id = i.gem_type_id where t.name = 'ZZQA ทับทิม' and t.shop_id = a;
  select i.id into i2 from analytics.gem_item i join analytics.gem_type t on t.id = i.gem_type_id where t.name = 'ZZQA ซิทริน' and t.shop_id = a;

  -- ตั้งราคาเลขแปลก (ต้นทุน) ให้ทั้ง 2 รายการ ก่อนไล่ตรวจทุกพื้นผิวที่ staff/ช่างเห็นได้
  r := pg_temp.price(a, i1, '7391.2468', null, pg_temp.own(), 'ผู้ขายทดสอบ', 'หมายเหตุทดสอบ');
  r2 := pg_temp.price(a, i2, '9999.9999', null, pg_temp.own());
  v := v || pg_temp.chkv('E1p', 'ตั้งราคา 7391.2468 / 9999.9999 ผ่าน RPC ราคา (owner) สำเร็จ', r ->> '_err' is null and r2 ->> '_err' is null, r::text || r2::text);

  o := pg_temp.po(a, 'qa-cycle'); it := pg_temp.iset(a, o, p, 7);
  si := pg_temp.q(format('select analytics.job_source_info(%L, %L, %L)', a, 'production', it ->> 'id'));
  v := v || pg_temp.chkv('E2', 'job_source_info: SKU ที่มีแม่แบบ → suggested_stage_codes มี gem_set · gem_template_count=2 · ไม่มี key ราคา',
    (si -> 'suggested_stage_codes') ? 'gem_set' and si ->> 'gem_template_count' = '2' and pg_temp.badkeys(si - 'deposit_missing') = '' and not pg_temp.has_px(si), si::text);
  pl := pg_temp.q(format('select analytics.job_plan_suggest(%L, %L, %L)', a, 'production', it ->> 'id'));
  qp := (pl ->> 'qty_planned_eff')::int;
  v := v || pg_temp.chkv('E3', 'job_plan_suggest: gem_bom 2 แถว · qty_total = ต่อชิ้น × qty_planned_eff · ไม่มีราคา/ผู้ขาย',
    jsonb_array_length(pl -> 'gem_bom') = 2 and (pl -> 'gem_bom' -> 0 ->> 'qty_total')::bigint = 2 * qp and (pl -> 'gem_bom' -> 1 ->> 'qty_total')::bigint = 10 * qp
    and pg_temp.badkeys(pl -> 'gem_bom') = '' and not pg_temp.has_px(pl), pl::text);

  j := pg_temp.pcreate(a, (it ->> 'id')::uuid, pg_temp.codes_of(si));
  jid := nullif(j ->> 'job_id', '')::uuid;
  v := v || pg_temp.chkv('E4', 'สร้างใบงานจาก SKU (ไม่ส่ง p_gem_lines) → ได้ขั้น gem_set + BOM คัดลอกจากแม่แบบ 2 แถว (source=product) · gem_source=template · ผลไม่มีราคา',
    jid is not null and j ->> 'gem_source' = 'template' and (j ->> 'gem_lines') = '2' and 'gem_set' = any (select jsonb_array_elements_text(j -> 'stage_codes'))
    and pg_temp.n_bom(jid) = 2 and (select count(*) from analytics.job_gem_bom where job_id = jid and source = 'product') = 2 and not pg_temp.has_px(j), j::text);
  g := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, jid));
  select qty_planned into qp from analytics.job where id = jid;
  v := v || pg_temp.chkv('E5', 'qty_total ของทุกแถวใน job_gem_bom_get = ต่อชิ้น × qty_planned ของใบ (' || qp || ') · window=free_before_start · state=specified · ไม่มีราคา',
    (select bool_and((l ->> 'qty_total')::bigint = (l ->> 'qty_per_piece')::int * qp::bigint) from jsonb_array_elements(g -> 'lines') l)
    and g ->> 'window' = 'free_before_start' and g ->> 'state' = 'specified' and not pg_temp.has_px(g) and pg_temp.badkeys(g -> 'lines') = '', g::text);

  -- แก้ก่อนขั้นอื่นรับ: ไม่ต้องเหตุผล
  r := pg_temp.bset(a, jid, pg_temp.cur(jid, 1), pg_temp.own());
  v := v || pg_temp.chkv('E6', 'แก้พลอยก่อนมีขั้นใดถูกรับ → ผ่านโดยไม่ต้องเหตุผล · window=free_before_start · changed',
    r ->> '_err' is null and r ->> 'window' = 'free_before_start' and r ->> 'changed' = 'true', r::text);
  -- ขั้นแรกรับ (ยังไม่ถึงขั้นฝัง) → office_free
  cd := pg_temp.step(a, jid, true);
  r := pg_temp.bset(a, jid, pg_temp.cur(jid, 1), pg_temp.own());
  v := v || pg_temp.chkv('E7', 'ขั้นแรกรับแล้ว แต่ขั้นฝังยังไม่รับ → window=office_free · แก้ได้ไม่ต้องเหตุผล', cd is not null and r ->> '_err' is null and r ->> 'window' = 'office_free', r::text);
  -- เดินจนถึงขั้นฝัง แล้วให้ช่างรับขั้นฝัง
  perform pg_temp.walk_to(a, jid, 'gem_set');
  cd := pg_temp.step(a, jid, false);
  v := v || pg_temp.chkv('E8a', 'ช่างรับขั้นฝัง gem_set', cd = 'gem_set', coalesce(cd, '(null)'));
  r := pg_temp.bset(a, jid, pg_temp.cur(jid, 1), pg_temp.own());
  v := v || pg_temp.chkv('E8b', 'หลังขั้นฝังรับ แก้โดยไม่มีเหตุผล → reason_required', pg_temp.hint(r) = '22023|reason_required', r::text);
  r := pg_temp.bset(a, jid, pg_temp.cur(jid, 1), pg_temp.own(), 'เจ้าของสั่งเพิ่มพลอย 1 เม็ด');
  v := v || pg_temp.chkv('E8c', 'หลังขั้นฝังรับ + เหตุผลจริง → ผ่าน · window=reason_required · event มี reason + phase', r ->> '_err' is null and r ->> 'window' = 'reason_required'
    and exists (select 1 from analytics.job_event where job_id = jid and event_type = 'bom_change' and payload ->> 'phase' = 'reason_required' and payload ->> 'reason' = 'เจ้าของสั่งเพิ่มพลอย 1 เม็ด'), r::text);
  r := pg_temp.bset(a, jid, pg_temp.cur(jid, 0), pg_temp.own(), repeat('ก', 301));
  v := v || pg_temp.chkv('E8d', 'เหตุผลยาว 301 → reason_invalid', pg_temp.hint(r) = '22023|reason_invalid', r::text);
  -- ลบพลอยทั้งชุดหลังขั้นฝังรับ ([]) ต้องมีเหตุผลเช่นกัน
  r := pg_temp.bset(a, jid, '[]'::jsonb, pg_temp.own());
  v := v || pg_temp.chkv('E8e', 'ล้างพลอยทั้งชุด ([]) หลังขั้นฝังรับ โดยไม่มีเหตุผล → reason_required (ห้ามลบเงียบ)', pg_temp.hint(r) = '22023|reason_required' and pg_temp.n_bom(jid) = 2, r::text);

  -- resolve หน้าช่าง: ก่อน PIN ไม่มี gems · หลัง PIN มี gems (ไม่มีราคา) · token ของใบนี้
  tk := analytics.job_token_issue(a, jid, null, pg_temp.nom());
  tokh := analytics.job_sha256_hex(tk ->> 'token');
  w := pg_temp.w_res(tokh);
  v := v || pg_temp.chkv('E9a', 'resolve ก่อนระบุตัว (ก่อน PIN): ไม่มี key gems/gems_state', w ->> 'ok' = 'true' and not (w -> 'job' ? 'gems') and not (w -> 'job' ? 'gems_state') and not pg_temp.has_px(w), w::text);
  r := pg_temp.login(tokh, pg_temp.fx('wW'), '2468');
  sess := r ->> 'session_hash';
  w := pg_temp.w_res(tokh, sess);
  select qty_planned into qp from analytics.job where id = jid;
  v := v || pg_temp.chkv('E9b', 'resolve หลัง PIN: job.gems 2 แถว · key เฉพาะ label/qty_per_piece/qty_total/position · qty_total = ต่อชิ้น × qty_planned · gems_state=specified · ไม่มีราคา 7391.2468/9999.9999',
    w ->> 'ok' = 'true' and w -> 'job' ->> 'gems_state' = 'specified' and jsonb_array_length(w -> 'job' -> 'gems') = 2
    and (select bool_and((select array_agg(k order by k) from jsonb_object_keys(e) k) = array['label', 'position', 'qty_per_piece', 'qty_total']) from jsonb_array_elements(w -> 'job' -> 'gems') e)
    and (select bool_and((e ->> 'qty_total')::bigint = (e ->> 'qty_per_piece')::int * qp::bigint) from jsonb_array_elements(w -> 'job' -> 'gems') e)
    and not pg_temp.has_px(w) and pg_temp.badkeys(w -> 'job' -> 'gems') = '', w::text);

  -- ไล่ทุกพื้นผิวที่ staff/ช่าง/ใบพิมพ์เห็นได้ ว่าไม่มีเลขราคาที่ตั้งไว้
  badk := '';
  r := pg_temp.q(format('select analytics.gem_options_list(%L)', a));
  if pg_temp.has_px(r) or pg_temp.badkeys(r) <> '' then badk := badk || 'gem_options_list;'; end if;
  r := pg_temp.q(format('select analytics.product_gem_bom_get(%L, %L)', a, p));
  if pg_temp.has_px(r) or pg_temp.badkeys(r) <> '' then badk := badk || 'product_gem_bom_get;'; end if;
  r := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, jid));
  if pg_temp.has_px(r) then badk := badk || 'job_gem_bom_get;'; end if;
  r := pg_temp.q(format('select analytics.gem_merge_preview(%L, %L, %L, %L, %L)', a, pg_temp.own(), 'type', (select gem_type_id from analytics.gem_item where id = i1), (select gem_type_id from analytics.gem_item where id = i2)));
  if pg_temp.has_px(r) then badk := badk || 'gem_merge_preview;'; end if;
  if exists (select 1 from analytics.job_event e where e.shop_id = a and pg_temp.has_px(to_jsonb(e))) then badk := badk || 'job_event;'; end if;
  if exists (select 1 from analytics.catalog_audit_log l where l.shop_id = a and pg_temp.has_px(to_jsonb(l))) then badk := badk || 'catalog_audit_log;'; end if;
  if exists (select 1 from analytics.gem_catalog_event e where e.shop_id = a and pg_temp.has_px(to_jsonb(e))) then badk := badk || 'gem_catalog_event;'; end if;
  if exists (select 1 from analytics.job_gem_bom e where e.shop_id = a and pg_temp.has_px(to_jsonb(e))) then badk := badk || 'job_gem_bom;'; end if;
  if exists (select 1 from analytics.product_gem_bom e where e.shop_id = a and pg_temp.has_px(to_jsonb(e))) then badk := badk || 'product_gem_bom;'; end if;
  if exists (select 1 from analytics.v_job_gem_requirement e where e.shop_id = a and pg_temp.has_px(to_jsonb(e))) then badk := badk || 'v_job_gem_requirement;'; end if;
  if exists (select 1 from analytics.v_product_gem_bom e where e.shop_id = a and pg_temp.has_px(to_jsonb(e))) then badk := badk || 'v_product_gem_bom;'; end if;
  v := v || pg_temp.chkv('E10', 'ราคา 7391.2468/9999.9999 ไม่โผล่ในผลของ options/แม่แบบ/ใบ/merge-preview/event/audit/catalog_event/ตาราง BOM/view ใดเลย', badk = '', badk);
  r := pg_temp.price(a, i1, '7391.2468', null, pg_temp.stf());
  v := v || pg_temp.chkv('E10b', 'ราคายังอ่านได้ทาง RPC ราคาโดย owner (เทสต์รั่วมีความหมาย) · staff ตั้งราคา = ปฏิเสธ 42501',
    (pg_temp.clist(a) -> 'items' -> 0) is not null and exists (select 1 from jsonb_array_elements(pg_temp.clist(a) -> 'items') e where e ->> 'price' = '7391.2468') and pg_temp.hint(r) like '42501|%', r::text);

  -- ใบพิมพ์ A5: TS อ่าน job_gem_bom ตรง (gems-server.ts) — ตรวจ select แบบเดียวกัน (service_role) ว่าได้เฉพาะ 4 ฟิลด์ที่ไม่มีราคา
  v := v || pg_temp.chkv('E11', 'A5: แถวจาก job_gem_bom (gem_label · qty_per_piece · position_note · line_seq) ครบ 2 แถว · ไม่มีเลขราคา',
    (select count(*) from analytics.job_gem_bom where job_id = jid) = 2 and not exists (select 1 from analytics.job_gem_bom b where pg_temp.has_px(jsonb_build_object('l', b.gem_label, 'p', b.position_note))), '');
  return v;
end;
$c$;

-- ============================================================================
-- F. ใบเดิม (ไม่มี BOM) · ใบมีขั้นฝังแต่ไม่มีพลอย · ใบไม่มีขั้นฝัง · ใบ OEM ในร้านจริงไม่พัง
-- ============================================================================
create function pg_temp.q_old() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); p3 uuid := pg_temp.fx('pA3');
  j jsonb; jid uuid; jid2 uuid; w jsonb; tk jsonb; tokh text; sess text; codes text[]; g jsonb; keys text[];
begin
  -- SKU ไม่มีแม่แบบ + ขั้นมาตรฐาน (ไม่มีขั้นฝัง) = ใบแบบเดิม
  j := pg_temp.mkjob(a, p3, null, null);
  jid := nullif(j ->> 'job', '')::uuid;
  select array_agg(stage_code order by seq) into codes from analytics.job_stage where job_id = jid;
  v := v || pg_temp.chkv('F1', 'ใบเดิม (SKU ไม่มีแม่แบบ · ขั้นมาตรฐาน): stage = 9 ขั้นมาตรฐานเดิม · ไม่มี BOM · gem_source=none · gem_lines=0',
    jid is not null and codes = string_to_array(trim(both '{}' from pg_temp.std()), ',') and pg_temp.n_bom(jid) = 0 and (j -> 'res' ->> 'gem_source') = 'none' and (j -> 'res' ->> 'gem_lines') = '0', j::text);
  tk := analytics.job_token_issue(a, jid, null, pg_temp.nom());
  tokh := analytics.job_sha256_hex(tk ->> 'token');
  perform pg_temp.login(tokh, pg_temp.fx('wW'), '2468');
  sess := (pg_temp.login(tokh, pg_temp.fx('wW'), '2468')) ->> 'session_hash';
  w := pg_temp.w_res(tokh, sess);
  select array_agg(k order by k) into keys from jsonb_object_keys(w -> 'job') k;
  v := v || pg_temp.chkv('F2', 'resolve หลัง PIN ของใบไม่มีขั้นฝัง+ไม่มีพลอย: ไม่มี key gems/gems_state · key ของ job = ชุดเดิม (ไม่มี photos เพราะไม่มีรูป)',
    w ->> 'ok' = 'true' and not (w -> 'job' ? 'gems') and not (w -> 'job' ? 'gems_state')
    and keys = array['design_label', 'due_date', 'has_profile', 'job_no', 'metal', 'profile_name', 'qty_planned', 'sku', 'stages', 'status'], coalesce(array_to_string(keys, ','), '(null)'));
  g := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, jid));
  v := v || pg_temp.chkv('F3', 'job_gem_bom_get ของใบเดิมไม่มีขั้นฝัง: state=not_needed · gem_stage=none · lines=[] · template=null/ว่าง', g ->> 'state' = 'not_needed' and g ->> 'gem_stage' = 'none' and jsonb_array_length(g -> 'lines') = 0, g::text);

  -- SKU ไม่มีแม่แบบ + มีขั้นฝัง (ออฟฟิศติ๊กเอง) ไม่ส่ง gem → ไม่มี BOM · state=unspecified · ช่างเห็น gems_state=unspecified gems=[]
  j := pg_temp.mkjob(a, p3, pg_temp.stdg(), null);
  jid2 := nullif(j ->> 'job', '')::uuid;
  tk := analytics.job_token_issue(a, jid2, null, pg_temp.nom());
  tokh := analytics.job_sha256_hex(tk ->> 'token');
  sess := (pg_temp.login(tokh, pg_temp.fx('wW'), '2468')) ->> 'session_hash';
  w := pg_temp.w_res(tokh, sess);
  g := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, jid2));
  v := v || pg_temp.chkv('F4', 'ใบมีขั้นฝังแต่ไม่มีพลอย/แม่แบบ: ไม่มี BOM · office state=unspecified · ช่าง gems_state=unspecified gems=[] (จอเตือน)',
    pg_temp.n_bom(jid2) = 0 and g ->> 'state' = 'unspecified' and w -> 'job' ->> 'gems_state' = 'unspecified' and jsonb_array_length(w -> 'job' -> 'gems') = 0, w::text || g::text);

  -- ระบบไม่เพิ่มขั้นฝังให้ใบเดิม: แม่แบบถูกตั้งทีหลัง → ใบที่เปิดไปแล้วไม่เปลี่ยน stage/BOM
  perform pg_temp.tset(a, p3, format('[{"new_type_name":"ZZQA ใบเดิม","shape_id":"%s","size_a":2,"qty_per_piece":1}]', pg_temp.shp(a, 'กลม'))::jsonb);
  select array_agg(stage_code order by seq) into codes from analytics.job_stage where job_id = jid;
  v := v || pg_temp.chkv('F5', 'ตั้งแม่แบบให้ SKU ทีหลัง → ใบที่เปิดแล้วไม่เปลี่ยน: stage 9 ขั้นเดิม · BOM ว่าง (ระบบไม่เพิ่มขั้นฝัง/ไม่คัดลอกย้อนหลัง)',
    codes = string_to_array(trim(both '{}' from pg_temp.std()), ',') and pg_temp.n_bom(jid) = 0 and pg_temp.n_bom(jid2) = 0, coalesce(array_to_string(codes, ','), ''));
  -- ใบใหม่ที่ออฟฟิศไม่ติ๊กขั้นฝัง แต่ SKU มีแม่แบบ → ไม่คัดลอก (ไม่มีขั้นฝัง)
  j := pg_temp.mkjob(a, p3, null, null);
  v := v || pg_temp.chkv('F6', 'SKU มีแม่แบบ แต่ออฟฟิศไม่ติ๊กขั้นฝัง → ไม่คัดลอกแม่แบบ · ไม่มีขั้นฝัง (ออฟฟิศเป็นคนตัดสินขั้นตอน)',
    pg_temp.n_bom((j ->> 'job')::uuid) = 0 and not exists (select 1 from analytics.job_stage where job_id = (j ->> 'job')::uuid and stage_code = 'gem_set'), j::text);
  -- ติ๊กขั้นฝัง + ส่ง [] (ไม่มีพลอย) ทั้งที่ SKU มีแม่แบบ → ไม่คัดลอก
  j := pg_temp.mkjob(a, p3, pg_temp.stdg(), '[]'::jsonb);
  v := v || pg_temp.chkv('F7', 'SKU มีแม่แบบ + ขั้นฝัง + p_gem_lines=[] → ไม่คัดลอก (ระบุว่าไม่มีพลอย) · gem_source=none_explicit', pg_temp.n_bom((j ->> 'job')::uuid) = 0 and (j -> 'res' ->> 'gem_source') = 'none_explicit', j::text);
  return v;
end;
$c$;

-- ============================================================================
-- G. ส่วนย่อย (lot): BOM อยู่ที่ใบแม่เท่านั้น — verify-0190 ไม่มี fixture ข้อนี้ (ประกาศเองว่าไม่มีเทสต์)
-- ============================================================================
create function pg_temp.q_lot() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); oval uuid := pg_temp.shp(a, 'ไข่'); p uuid := pg_temp.fx('pA4');
  j jsonb; jid uuid; r jsonb; lot uuid; cd text; g jsonb; w jsonb; tk jsonb; tokh text; sess text; qp int;
begin
  j := pg_temp.mkjob(a, p, pg_temp.stdg(), format('[{"new_type_name":"ZZQA ล็อต","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":2}]', oval)::jsonb, false, 10);
  jid := nullif(j ->> 'job', '')::uuid;
  cd := pg_temp.step(a, jid, false);   -- รับขั้นแรก (ต้องถือของก่อนแบ่ง)
  r := pg_temp.q(format('select analytics.job_lot_split(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>1, p_qty=>4, p_qty_hold=>10, p_actor=>%L)', a, jid, pg_temp.nom()));
  lot := coalesce(nullif(r ->> 'lot_job_id', '')::uuid, nullif(r ->> 'job_id', '')::uuid, (select id from analytics.job where parent_job_id = jid limit 1));
  v := v || pg_temp.chkv('G0', 'แบ่งส่วนย่อยจากใบที่มีพลอย (fixture)', lot is not null, r::text);
  if lot is null then return v; end if;
  r := pg_temp.bset(a, lot, '[]'::jsonb, pg_temp.own());
  v := v || pg_temp.chkv('G1', 'แก้พลอยที่ส่วนย่อยผ่าน RPC → lot_no_gems', pg_temp.hint(r) = '22023|lot_no_gems', r::text);
  v := v || pg_temp.chkv('G2', 'INSERT job_gem_bom ตรงที่ส่วนย่อย → ปฏิเสธ lot_no_gems (กำแพงที่ตาราง)',
    pg_temp.err(format('insert into analytics.job_gem_bom (shop_id, job_id, line_seq, gem_item_id, gem_label, qty_per_piece, source) select %L, %L, 9, gem_item_id, gem_label, 1, %L from analytics.job_gem_bom where job_id = %L limit 1', a, lot, 'manual', jid)) = '22023|lot_no_gems', '');
  r := pg_temp.q(format('select analytics.product_gem_bom_from_job(%L, %L, %L)', a, lot, pg_temp.own()));
  v := v || pg_temp.chkv('G3', 'ตั้งแม่แบบจากส่วนย่อย → lot_no_gems', pg_temp.hint(r) = '22023|lot_no_gems', r::text);
  g := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, lot));
  select qty_planned into qp from analytics.job where id = jid;
  v := v || pg_temp.chkv('G4', 'job_gem_bom_get ของส่วนย่อย → คืนพลอยของใบแม่ (1 แถว) · job.id = ใบแม่ · qty_total = ต่อชิ้น × qty_planned ของใบแม่',
    g -> 'job' ->> 'id' = jid::text and jsonb_array_length(g -> 'lines') = 1 and (g -> 'lines' -> 0 ->> 'qty_total')::bigint = 2 * qp::bigint, g::text);
  -- แก้พลอยที่ใบแม่หลังแบ่งส่วน: window คิดทั้งต้นไม้
  r := pg_temp.bset(a, jid, pg_temp.cur(jid, 1), pg_temp.own());
  v := v || pg_temp.chkv('G5', 'แก้พลอยที่ใบแม่หลังแบ่งส่วน (ขั้นแรกถืออยู่) → window=office_free ผ่าน · ไม่แตะส่วนย่อย', r ->> '_err' is null and r ->> 'window' = 'office_free' and not exists (select 1 from analytics.job_gem_bom where job_id = lot), r::text);
  tk := analytics.job_token_issue(a, jid, null, pg_temp.nom());
  tokh := analytics.job_sha256_hex(tk ->> 'token');
  sess := (pg_temp.login(tokh, pg_temp.fx('wW'), '2468')) ->> 'session_hash';
  w := pg_temp.w_res(tokh, sess);
  v := v || pg_temp.chkv('G6', 'resolve ใบแม่ที่แบ่งส่วนแล้ว: มี job.gems 1 แถว · qty_total ตามใบแม่ · ok', w ->> 'ok' = 'true' and jsonb_array_length(w -> 'job' -> 'gems') = 1 and (w -> 'job' -> 'gems' -> 0 ->> 'qty_total')::bigint = (3 * qp)::bigint, w::text);
  return v;
end;
$c$;

-- ============================================================================
-- H. W1 (job_worker_open) + OEM จริง + ทอง (0186) — ไม่พัง
-- ============================================================================
create function pg_temp.q_wopen() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); tk jsonb; tokh text; w uuid; s jsonb; sess text; r jsonb; jid uuid; codes text[]; p uuid;
  oval uuid := pg_temp.shp(a, 'ไข่'); n int;
begin
  p := analytics.product_upsert(a, 'ZZ190-Q1', 'แหวน W1 QA', null, 'fixed', 40, null, null, null, null, null, null, null, true);
  tk := analytics.shop_intake_token_issue(a, pg_temp.nom());
  tokh := analytics.job_sha256_hex(tk ->> 'token');
  r := pg_temp.wu(a, 'ZZ-M ผู้จัดการ QA', '1357', '{qc}', true);
  w := (r ->> 'id')::uuid;
  s := pg_temp.q(format('select analytics.worker_pin_verify_intake(%L, %L, %L, %L, %L)', tokh, w, '1357', 'verify-ua/1.0', null));
  sess := analytics.job_sha256_hex(s ->> 'session_token');
  -- SKU ที่มีแม่แบบที่ใช้รายการ "ปิดใช้งาน" แล้ว → W1 ต้องไม่พัง (แม่แบบเก่ายังอ้างรายการที่ปิดได้)
  r := pg_temp.tset(a, p, format('[{"new_type_name":"ZZQA ปิดภายหลัง","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":3}]', oval)::jsonb);
  perform pg_temp.sact(a, 'type', (select id from analytics.gem_type where shop_id = a and name = 'ZZQA ปิดภายหลัง'), false);
  r := pg_temp.opn(tokh, sess, jsonb_build_object('product', p));
  jid := (select j.id from analytics.job j where j.shop_id = a and j.job_no = r ->> 'job_no');
  select array_agg(stage_code order by seq) into codes from analytics.job_stage where job_id = jid;
  v := v || pg_temp.chkv('H1', 'W1 เปิดใบ SKU ที่แม่แบบอ้างชนิดที่ถูกปิดใช้งาน → เปิดสำเร็จ · ได้ขั้นฝัง + BOM คัดลอก 1 แถว (ปิด = ซ่อนจาก dropdown ไม่ใช่ทำให้ใบพัง)',
    r ->> 'ok' = 'true' and 'gem_set' = any (codes) and pg_temp.n_bom(jid) = 1, r::text);
  -- สร้างใบจากออฟฟิศกับแม่แบบเดียวกัน (ชนิดปิดแล้ว) → ไม่พังเช่นกัน
  r := pg_temp.mkjob(a, p, pg_temp.stdg(), null);
  v := v || pg_temp.chkv('H2', 'ออฟฟิศสร้างใบจาก SKU ที่แม่แบบอ้างชนิดปิดใช้งาน → สำเร็จ · BOM 1 แถว', (r ->> 'job') is not null and pg_temp.n_bom((r ->> 'job')::uuid) = 1, r::text);
  -- แต่ถ้า "พิมพ์" รายการที่ปิดใช้งานเข้ามาใหม่ในใบ (ไม่ใช่คัดลอกแม่แบบ) = ต้องปฏิเสธ gem_inactive
  r := pg_temp.mkjob(a, pg_temp.fx('pA3'), pg_temp.stdg(), format('[{"type_id":"%s","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":1}]', (select id from analytics.gem_type where shop_id = a and name = 'ZZQA ปิดภายหลัง'), oval)::jsonb);
  v := v || pg_temp.chkv('H3', 'เลือกชนิดที่ปิดใช้งานแล้วในใบใหม่ → ปฏิเสธ gem_inactive · ไม่เกิดใบ', coalesce(r ->> 'hint', '') = 'gem_inactive' and (r ->> 'job') is null, r::text);
  return v;
end;
$c$;

create function pg_temp.q_oem_real() returns text
 language plpgsql as $c$
declare
  v text := ''; rs uuid; it record; si jsonb; codes text; r jsonb; n int := 0; ok boolean := true; detail text := ''; jid uuid; stg text; sg text; r2 jsonb;
begin
  select pr.shop_id into rs from public.product pr where pr.shop_id not in (pg_temp.fx('A'), pg_temp.fx('B')) group by pr.shop_id order by count(*) desc limit 1;
  for it in select i.id from analytics.oem_quote_item i where i.shop_id = rs order by i.created_at desc loop
    begin
      si := analytics.job_source_info(rs, 'oem', it.id);
    exception when others then
      continue;
    end;
    if si -> 'existing_job' = 'null'::jsonb then
      n := n + 1;
      codes := pg_temp.codes_of(si);
      r := pg_temp.q(format('select analytics.job_create_from_quote_item(p_shop_id=>%L, p_quote_item_id=>%L, p_stage_codes=>%L::text[], p_start_gate_note=>%L, p_design_label=>%L, p_actor=>%L)',
        rs, it.id, codes, 'QA เริ่มก่อนมัดจำ', 'ZZ QA 0190', pg_temp.nom()));
      jid := nullif(r ->> 'job_id', '')::uuid;
      select string_agg(stage_code, ',' order by seq) into stg from analytics.job_stage where job_id = jid;
      sg := trim(both '{}' from codes);
      if jid is null or stg is distinct from sg or (r ->> 'gem_source') <> 'none' or pg_temp.n_bom(jid) <> 0 then
        ok := false; detail := detail || format('[%s: stg=%s want=%s r=%s]', it.id, stg, sg, left(r::text, 200));
      end if;
      exit when n >= 4;
    end if;
  end loop;
  if n = 0 then
    v := v || pg_temp.skip('H4', 'ไม่มี OEM quote item eligible ในร้านจริง');
  else
    v := v || pg_temp.chkv('H4', format('ใบ OEM จาก quote item จริง %s รายการ (ไม่ส่ง p_gem_lines): สร้างได้ · ขั้นตรงกับที่ job_source_info เสนอ · ไม่มี BOM · gem_source=none (ไม่พัง)', n), ok, detail);
  end if;
  return v;
end;
$c$;

create function pg_temp.q_gold() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); oval uuid := pg_temp.shp(a, 'ไข่'); p uuid := pg_temp.fx('pA4'); o uuid; it jsonb; si jsonb; r jsonb; jid uuid; gp int;
begin
  select count(*) into gp from analytics.job_record_profile where shop_id = a and is_active and is_default_gold;
  o := pg_temp.po(a, 'qa-gold');
  it := pg_temp.iset(a, o, p, 5, null, 'gold', 0.75, 3.2, 'input');
  if it ? '_err' then
    v := v || pg_temp.skip('I1', 'สร้างรายการใบผลิตทองไม่ได้ในร้านสังเคราะห์: ' || left(it::text, 200));
    return v;
  end if;
  si := pg_temp.q(format('select analytics.job_source_info(%L, %L, %L)', a, 'production', it ->> 'id'));
  v := v || pg_temp.chkv('I1', 'ใบผลิตทอง: job_source_info metal=gold · ผ่านตัวใหม่ (ไม่มี key ราคา)', si ->> 'metal' = 'gold' and pg_temp.badkeys(si - 'deposit_missing') = '', si::text);
  r := pg_temp.pcreate(a, (it ->> 'id')::uuid, pg_temp.stdg(), format('[{"new_type_name":"ZZQA ทอง","shape_id":"%s","size_a":3,"size_b":4,"qty_per_piece":1}]', oval)::jsonb, true);
  jid := nullif(r ->> 'job_id', '')::uuid;
  if jid is null and r ->> '_hint' = 'no_gold_profile' then
    v := v || pg_temp.skip('I2', 'ร้านสังเคราะห์ไม่มีแบบทองค่าเริ่ม (no_gold_profile — พฤติกรรม 0186 เดิม ไม่เกี่ยว 0190) · ข้อนี้ครอบด้วย verify-0186 (ผ่าน 252 / R2 FAIL จากข้อมูลจริง PO-0035)');
  else
    v := v || pg_temp.chkv('I2', 'ใบทอง + พลอย: สร้างสำเร็จ · BOM 1 แถว · ผลไม่มี key น้ำหนัก/ราคา gem', jid is not null and pg_temp.n_bom(jid) = 1, r::text);
  end if;
  return v;
end;
$c$;

-- ============================================================================
-- รัน
-- ============================================================================

-- ============================================================================
-- R2-D2 (qa-tester) ad-hoc QA ของ 0190 — ชุด 2: รวมชื่อ · ตัวดักชื่อคล้าย (false positive) · input ผิดรูป · fuzz ลำดับ operation + invariant · ประสิทธิภาพ
-- ============================================================================
create function pg_temp.info(p_id text, p_desc text) returns text language sql as $c$ select format('[INFO] %s  %s', p_id, p_desc) || E'\n' $c$;
create function pg_temp.hx(p text) returns text language sql immutable as $c$ select encode(convert_to(p, 'UTF8'), 'hex') $c$;
create function pg_temp.bomhash(p_shop uuid) returns text language sql as $c$
  select coalesce(md5(string_agg(g.job_id::text || ':' || g.gem_item_id::text || ':' || g.gem_label || ':' || g.qty_per_piece || ':' || coalesce(g.position_note, '') || ':' || g.line_seq, '|' order by g.id)), '') from analytics.job_gem_bom g where g.shop_id = p_shop $c$;

-- ============================================================================
-- M. รวมชื่อ A→B: ใบเก่าชื่อเดิม · แม่แบบตามไป · ราคา A ไม่ย้าย · พฤติกรรมตอนแก้ใบหลังรวม · รวมไม่ได้เมื่อมีของปิดใช้งาน
-- ============================================================================
create function pg_temp.q_merge() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); oval uuid := pg_temp.shp(a, 'ไข่'); rnd uuid := pg_temp.shp(a, 'กลม'); pz uuid := pg_temp.fx('pA3'); p4 uuid := pg_temp.fx('pA4');
  tA uuid; tB uuid; tC uuid; tD uuid; sCl uuid; s1 uuid; s2 uuid; iA1 uuid; iA2 uuid; iB1 uuid; r jsonb; r2 jsonb; j jsonb; jid uuid; h0 text; g jsonb; prev jsonb; ln jsonb; tpl jsonb; lbl text; n_ev0 int;
begin
  tA := (pg_temp.ccreate(a, 'type', 'ZZQM เอ', null, true) ->> 'id')::uuid;
  tB := (pg_temp.ccreate(a, 'type', 'ZZQM บีหมี', null, true) ->> 'id')::uuid;
  iA1 := (pg_temp.icreate(a, jsonb_build_object('type_id', tA, 'shape_id', oval, 'size_a', 4, 'size_b', 6), true) -> 'item' ->> 'gem_item_id')::uuid;
  iA2 := (pg_temp.icreate(a, jsonb_build_object('type_id', tA, 'shape_id', rnd, 'size_a', 3), true) -> 'item' ->> 'gem_item_id')::uuid;
  iB1 := (pg_temp.icreate(a, jsonb_build_object('type_id', tB, 'shape_id', oval, 'size_a', 4, 'size_b', 6), true) -> 'item' ->> 'gem_item_id')::uuid;
  perform pg_temp.price(a, iA1, '7391.2468');
  perform pg_temp.price(a, iB1, '2222.2222');
  j := pg_temp.mkjob(a, p4, pg_temp.stdg(), jsonb_build_array(jsonb_build_object('gem_item_id', iA1, 'qty_per_piece', 2, 'position', 'ซ้าย'), jsonb_build_object('gem_item_id', iA2, 'qty_per_piece', 3)));
  jid := nullif(j ->> 'job', '')::uuid;
  v := v || pg_temp.chkv('M0', 'fixture: ชนิด A/B · รายการ A1(ไข่4×6) A2(กลม3) B1(ไข่4×6 ชนกับ A1) · ใบ 2 แถว · ราคา A1/B1', jid is not null and iA1 is not null and iB1 is not null and pg_temp.n_bom(jid) = 2, j::text);
  tpl := pg_temp.tset(a, pz, jsonb_build_array(jsonb_build_object('gem_item_id', iA1, 'qty_per_piece', 1), jsonb_build_object('gem_item_id', iB1, 'qty_per_piece', 4)));
  h0 := pg_temp.bomhash(a);
  prev := pg_temp.mprev(a, 'type', tA, tB);
  v := v || pg_temp.chkv('M1', 'preview รวมชนิด A→B: ย้าย 1 (A2) · ชนกัน 1 (A1→B1) · ราคาที่ไม่ย้าย 1 · แม่แบบรวมจำนวน 1 · ใบเปิดที่ใช้ 1 · snapshot ไม่เปลี่ยน',
    prev ->> 'items_moved' = '1' and prev ->> 'items_collapsed' = '1' and prev ->> 'prices_not_moved' = '1' and prev ->> 'template_lines_summed' = '1' and prev ->> 'jobs_open_using' = '1' and prev ->> 'snapshots_unchanged' = 'true', prev::text);
  r := pg_temp.mrg(a, 'type', tA, tB);
  v := v || pg_temp.chkv('M2', 'รวมชนิด A→B สำเร็จ · A ถูกปิด+ชี้ B · A1 ชี้ B1 (ปิด) · A2 ย้ายไปอยู่ใต้ B',
    r ->> '_err' is null and (select merged_into = tB and not is_active from analytics.gem_type where id = tA) and (select merged_into = iB1 and not is_active from analytics.gem_item where id = iA1)
    and (select gem_type_id = tB and merged_into is null from analytics.gem_item where id = iA2), r::text);
  v := v || pg_temp.chkv('M2b', 'snapshot ใบเดิม (gem_label · gem_item_id · จำนวน) ไม่ขยับ (md5 ทุกแถว job_gem_bom เท่าเดิม) · ฉลากยังเป็น "ZZQM เอ · ไข่ · 4×6 มม."',
    pg_temp.bomhash(a) = h0 and exists (select 1 from analytics.job_gem_bom where job_id = jid and gem_label = 'ZZQM เอ · ไข่ · 4×6 มม.'), '');
  v := v || pg_temp.chkv('M2c', 'ราคาของ A1 อยู่กับ A1 (ไม่ย้าย) · ราคา B1 ยัง 2222.2222 · แคตตาล็อก B1 has_price ไม่เปลี่ยน',
    (select count(*) from analytics.gem_item_price where gem_item_id = iA1) = 1 and exists (select 1 from jsonb_array_elements(pg_temp.clist(a) -> 'items') e where e ->> 'gem_item_id' = iB1::text and e ->> 'price' = '2222.2222'), '');
  tpl := pg_temp.q(format('select analytics.product_gem_bom_get(%L, %L)', a, pz));
  v := v || pg_temp.chkv('M2d', 'แม่แบบ SKU ตามไป: 2 แถว (A1,B1) → รวมเป็น 1 แถวที่ B1 จำนวน 1+4=5', jsonb_array_length(tpl -> 'lines') = 1 and (tpl -> 'lines' -> 0 ->> 'gem_item_id') = iB1::text and (tpl -> 'lines' -> 0 ->> 'qty_per_piece') = '5', tpl::text);
  select count(*) into n_ev0 from analytics.job_event where job_id = jid and event_type = 'bom_change';
  v := v || pg_temp.chkv('M2e', 'view v_job_gem_requirement รวมกลุ่มตาม canonical (B1 · ชื่อชนิด "ZZQM บีหมี") แต่ gem_label ยังเป็น snapshot เดิม',
    exists (select 1 from analytics.v_job_gem_requirement q where q.job_id = jid and q.canonical_item_id = iB1 and q.type_name = 'ZZQM บีหมี' and q.gem_label = 'ZZQM เอ · ไข่ · 4×6 มม.'), '');
  -- พิมพ์ชื่อเก่า (A) ซ้ำหลังรวม → ไปใช้ B ตัวปลายทางเงียบๆ (ใบที่ค้างระหว่างรวมไม่ล้ม)
  r2 := pg_temp.bset(a, jid, jsonb_build_array(jsonb_build_object('new_type_name', 'ZZQM เอ', 'shape_id', oval, 'size_a', 4, 'size_b', 6, 'qty_per_piece', 2)), pg_temp.own());
  v := v || pg_temp.chkv('M3', 'พิมพ์ชื่อชนิดเก่า "ZZQM เอ" (ถูกรวมแล้ว) หลังรวม → resolve ไป B · ไม่สร้างชนิดใหม่ · ฉลากใหม่ใช้ชื่อ B',
    r2 ->> '_err' is null and (r2 -> 'lines' -> 0 ->> 'label') = 'ZZQM บีหมี · ไข่ · 4×6 มม.' and (select count(*) from analytics.gem_type where shop_id = a and name_norm = 'zzqmเอ') = 1, r2::text);
  -- ★ ตรวจพฤติกรรมแก้ใบหลังรวม: ส่งแถวเดิมกลับเข้าไปทั้งชุด (จำนวนเท่าเดิม) โดยอ้าง gem_item_id ของ snapshot (ที่ถูกรวมแล้ว) — ฉลากเดิมของแถวที่ "ไม่ได้แก้" ต้องไม่เปลี่ยน
  j := pg_temp.mkjob(a, p4, pg_temp.stdg(), jsonb_build_array(jsonb_build_object('gem_item_id', iA2, 'qty_per_piece', 2)));  -- ใบใหม่ที่ใช้ A2 (ย้ายใต้ B แล้ว — ยังไม่ถูกรวมเป็นรายการอื่น)
  v := v || pg_temp.chk('M3pre', 'fixture: ใบใหม่ใช้ A2', (j ->> 'job') is not null);
  -- สร้างใบ "ก่อนรวม" อีกใบเพื่อทดสอบ: ใช้ชนิด C ที่รวมในขั้นถัดไป
  tC := (pg_temp.ccreate(a, 'type', 'ZZQM ซี', null, true) ->> 'id')::uuid;
  tD := (pg_temp.ccreate(a, 'type', 'ZZQM ดี', null, true) ->> 'id')::uuid;
  j := pg_temp.mkjob(a, p4, pg_temp.stdg(), jsonb_build_array(
        jsonb_build_object('type_id', tC, 'shape_id', oval, 'size_a', 3, 'size_b', 5, 'qty_per_piece', 2),
        jsonb_build_object('type_id', tD, 'shape_id', rnd, 'size_a', 2, 'qty_per_piece', 7)));
  jid := nullif(j ->> 'job', '')::uuid;
  perform pg_temp.icreate(a, jsonb_build_object('type_id', tD, 'shape_id', oval, 'size_a', 3, 'size_b', 5), true);   -- D มีรายการที่ชน C
  r := pg_temp.mrg(a, 'type', tC, tD);   -- C → D : แถวแรกของใบชนกับของ D (ไข่ 3×5)
  v := v || pg_temp.chkv('M4a', 'รวม C→D (รายการไข่3×5 ชนกัน) สำเร็จ', r ->> '_err' is null, r::text);
  g := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, jid));
  v := v || pg_temp.chkv('M4b', 'getter หลังรวม: label snapshot ยัง "ZZQM ซี · ไข่ · 3×5 มม." · canonical ชี้รายการของ D (คนละ id กับ snapshot)',
    (g -> 'lines' -> 0 ->> 'label') = 'ZZQM ซี · ไข่ · 3×5 มม.' and (g -> 'lines' -> 0 ->> 'canonical_item_id') <> (g -> 'lines' -> 0 ->> 'gem_item_id'), g::text);
  -- แก้เฉพาะจำนวนของแถว 2 (D·กลม) — ส่งแถว 1 กลับด้วย gem_item_id เดิม (ตามที่จอจะส่งจาก getter)
  ln := (select jsonb_agg(jsonb_build_object('gem_item_id', l ->> 'gem_item_id', 'qty_per_piece', case when (l ->> 'qty_per_piece')::int = 7 then 8 else (l ->> 'qty_per_piece')::int end) order by o)
           from jsonb_array_elements(g -> 'lines') with ordinality t(l, o));
  r2 := pg_temp.bset(a, jid, ln, pg_temp.own());
  select gem_label into lbl from analytics.job_gem_bom where job_id = jid and line_seq = 1;
  v := v || pg_temp.known('M5', '★ แก้จำนวนแถว 2 เพียงแถวเดียวหลังรวมชื่อ (ส่งแถว 1 กลับด้วย id เดิม) → ฉลาก snapshot ของแถว 1 ที่ไม่ได้แก้ต้องยังเป็น "ZZQM ซี · ไข่ · 3×5 มม." (ไม่ถูกเขียนทับด้วยชื่อใหม่)',
    r2 ->> '_err' is null and lbl = 'ZZQM ซี · ไข่ · 3×5 มม.', coalesce(lbl, '(null)') || ' · ' || left(r2::text, 300));

  -- ★ รวมไม่ได้เพราะมีของ "ปิดใช้งาน" ที่ไม่เกี่ยว: รูปทรงที่ปิดใช้งานแล้ว / ชนิดที่ปิดใช้งานแล้ว
  tC := (pg_temp.ccreate(a, 'type', 'ZZQN แกมม่า', null, true) ->> 'id')::uuid;
  tD := (pg_temp.ccreate(a, 'type', 'ZZQN เดลต้า', null, true) ->> 'id')::uuid;
  sCl := (pg_temp.ccreate(a, 'shape', 'ZZQN ทรงปิดภายหลัง', false, true) ->> 'id')::uuid;
  perform pg_temp.icreate(a, jsonb_build_object('type_id', tC, 'shape_id', sCl, 'size_a', 2), true);
  perform pg_temp.sact(a, 'shape', sCl, false);   -- ปิดรูปทรง (ซ่อนจาก dropdown — การทำงานปกติของออฟฟิศ)
  r := pg_temp.mrg(a, 'type', tC, tD);
  v := v || pg_temp.known('N1', '★ รวมชนิด C→D ที่ C มีรายการใช้ "รูปทรงที่ปิดใช้งานแล้ว" → ควรรวมได้ (ปิด = ซ่อนจาก dropdown ไม่ใช่ล็อกการดูแลแคตตาล็อก)', r ->> '_err' is null, pg_temp.hint(r));
  tC := (pg_temp.ccreate(a, 'type', 'ZZQN ซิกม่า', null, true) ->> 'id')::uuid;
  s1 := (pg_temp.ccreate(a, 'shape', 'ZZQN ทรงหนึ่ง', false, true) ->> 'id')::uuid;
  s2 := (pg_temp.ccreate(a, 'shape', 'ZZQN ทรงสอง', false, true) ->> 'id')::uuid;
  perform pg_temp.icreate(a, jsonb_build_object('type_id', tC, 'shape_id', s1, 'size_a', 2), true);
  perform pg_temp.sact(a, 'type', tC, false);   -- ปิดชนิด C
  r := pg_temp.mrg(a, 'shape', s1, s2);
  v := v || pg_temp.known('N2', '★ รวมรูปทรง S1→S2 ที่ S1 มีรายการของ "ชนิดที่ปิดใช้งานแล้ว" → ควรรวมได้', r ->> '_err' is null, pg_temp.hint(r));
  -- รวมชนิดที่ปิดใช้งานเอง (จาก = ปิด) · ปลายทางปิด = ปฏิเสธ (ตั้งใจ)
  tC := (pg_temp.ccreate(a, 'type', 'ZZQN ลัมดา', null, true) ->> 'id')::uuid;
  tD := (pg_temp.ccreate(a, 'type', 'ZZQN มิว', null, true) ->> 'id')::uuid;
  perform pg_temp.icreate(a, jsonb_build_object('type_id', tC, 'shape_id', rnd, 'size_a', 5), true);
  perform pg_temp.sact(a, 'type', tC, false);
  r := pg_temp.mrg(a, 'type', tC, tD);
  v := v || pg_temp.chkv('N3', 'รวมชนิดที่ "ตัวเองปิดใช้งาน" เข้าตัวที่เปิดอยู่ (กรณีเก็บกวาดชื่อเก่า) → ต้องรวมได้ (รายการของ C ย้ายไป D)', r ->> '_err' is null, pg_temp.hint(r));
  return v;
end;
$c$;

-- ============================================================================
-- N. ตัวดักชื่อคล้าย: ชุดเคสแบบ "ผ่านเส้นทางจริง" (บันทึกพลอยในใบ) + สแกน false-positive จากชื่อพลอยจริงที่เจ้าของยก + parity dump
-- ============================================================================
create function pg_temp.q_names() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); oval uuid := pg_temp.shp(a, 'ไข่'); rnd uuid := pg_temp.shp(a, 'กลม'); j uuid := pg_temp.fx('J1');
  r jsonb; d jsonb; s0 text; names text[]; i int; k int; flagged text := ''; n_f int := 0; cp int; kept text := ''; ch text; res text;
  tc record; strp text := '';
begin
  -- N-A: ผ่านเส้นทางบันทึกใบจริง: ชนิดมี "โกเมน" แล้วพิมพ์ชื่อต่างๆ
  r := pg_temp.bset(a, j, format('[{"new_type_name":"โกเมน","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":1}]', oval)::jsonb, pg_temp.own());
  v := v || pg_temp.chkv('NA0', 'fixture: ชนิด "โกเมน" เข้าแคตตาล็อก', r ->> '_err' is null, r::text);
  for tc in select * from (values
    ('NA1', 'โกเมนต์', 'warn'), ('NA2', 'โกเมน ', 'same'), ('NA3', 'โกเมน.', 'same'), ('NA4', 'โก เมน', 'same'), ('NA5', 'ทับทิม', 'free'), ('NA6', 'ไพลิน', 'free'), ('NA7', 'CZ', 'free'), ('NA8', 'โกเมนสีแดง', 'free')
  ) as t(id, nm, ex) loop
    s0 := pg_temp.gsnap(a);
    r := pg_temp.bset(a, j, format('[{"new_type_name":%s,"shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":1}]', to_jsonb(tc.nm)::text, oval)::jsonb, pg_temp.own());
    res := case when pg_temp.hint(r) = '22023|gem_similar' then 'warn' when r ->> '_err' is null and (r -> 'summary' -> 'created_types') <> '[]'::jsonb then 'created'
                when r ->> '_err' is null then 'same' else pg_temp.hint(r) end;
    v := v || pg_temp.chkv(tc.id, format('พิมพ์ชนิด %L ขณะมี "โกเมน": ต้อง %s', tc.nm, tc.ex),
      (tc.ex = 'warn' and res = 'warn' and pg_temp.gsnap(a) = s0) or (tc.ex = 'same' and res = 'same') or (tc.ex = 'free' and res = 'created'), res || ' ' || left(r::text, 200));
  end loop;

  -- N-B: ชื่อรูปทรงเริ่มต้น 12 แบบ เทียบกันเอง + ชื่อพลอยจริงที่ใช้ในร้านเครื่องประดับ — ไล่คู่ที่ตัวดักบอกว่า "คล้าย" (ดูด้วยตาว่าเป็นเตือนมั่วไหม)
  names := array['CZ','โกเมน','ซิทริน','อเมทิสต์','เพอริดอท','ทับทิม','ไพลิน','บุษ','Blue Topaz','White Topaz','Pink Topaz','Swiss Blue Topaz','London Blue Topaz','มรกต','ทัวร์มาลีน','ทัวร์มาลิน','เพทาย','บุษราคัม','โอปอล','มุกดา','สปิเนล','ไพลินสีฟ้า','ไพลินสีชมพู',
                 'Garnet','Citrine','Amethyst','Peridot','Ruby','Sapphire','Emerald','Opal','Topaz','Pink Sapphire','Blue Sapphire','Yellow Sapphire','Moonstone','Sunstone','Rhodolite','Iolite','Tanzanite','Aquamarine','Morganite','Zircon','Onyx','Jade','Turquoise','Lapis','Pearl',
                 'โรโดไลต์','ไอโอไลต์','แทนซาไนต์','อความารีน','มอร์แกไนต์','เซอร์คอน','โอนิกซ์','หยก','เทอร์ควอยซ์','ลาพิส','มุก','เพชร','เพชรสังเคราะห์','เพชรรัสเซีย','โมอิส','โมซาไนต์'];
  for i in 1..array_length(names, 1) loop
    for k in i + 1..array_length(names, 1) loop
      if analytics.gem_name_similar(names[i], names[k]) then
        n_f := n_f + 1; flagged := flagged || names[i] || ' ~ ' || names[k] || ' ; ';
      end if;
    end loop;
  end loop;
  v := v || pg_temp.info('NB1', format('ชื่อพลอยจริง %s ชื่อ (%s คู่) → ตัวดักบอก "คล้าย" %s คู่: %s', array_length(names, 1), array_length(names, 1) * (array_length(names, 1) - 1) / 2, n_f, left(flagged, 900)));
  names := array(select name from analytics.gem_shape where shop_id = a and is_seed order by name);
  flagged := ''; n_f := 0;
  for i in 1..array_length(names, 1) loop
    for k in i + 1..array_length(names, 1) loop
      if analytics.gem_name_similar(names[i], names[k]) then n_f := n_f + 1; flagged := flagged || names[i] || ' ~ ' || names[k] || ' ; '; end if;
    end loop;
  end loop;
  v := v || pg_temp.info('NB2', format('รูปทรง seed 12 แบบเทียบกันเอง: คล้ายกัน %s คู่: %s', n_f, flagged));
  -- ตัวเลขต่างกันหลักเดียวแต่เป็นคนละของ (เตือนมั่ว)
  v := v || pg_temp.info('NB3', format('เลข/ขนาดในชื่อ: "6 เหลี่ยม"~"8 เหลี่ยม"=%s · "5 เหลี่ยม"~"6 เหลี่ยม"=%s · "Zircon 2"~"Zircon 3"=%s · "925"~"999"(สั้น≤3)=%s · "ไพลิน 1"~"ไพลิน 2"=%s',
    analytics.gem_name_similar('6 เหลี่ยม', '8 เหลี่ยม'), analytics.gem_name_similar('5 เหลี่ยม', '6 เหลี่ยม'), analytics.gem_name_similar('Zircon 2', 'Zircon 3'), analytics.gem_name_similar('925', '999'), analytics.gem_name_similar('ไพลิน 1', 'ไพลิน 2')));

  -- N-C: gem_name_ok บนชื่อที่แปลก (ไม่ assert — ดูผล) + ตัวเลขล้วนต่างระบบเลข
  v := v || pg_temp.known('NC1', 'ตัวเลขล้วนต่างระบบเลข ต้องไม่ถูกใช้เป็นชื่อ: "12"(ASCII) · "１２"(เต็มความกว้าง) · "²³" · "๑๒"(เลขไทย) · "١٢"(อารบิก-อินดิก)',
    not analytics.gem_name_ok('12') and not analytics.gem_name_ok('１２') and not analytics.gem_name_ok('²³') and not analytics.gem_name_ok('๑๒') and not analytics.gem_name_ok('١٢'),
    format('12=%s ・１２=%s ・²³=%s ・๑๒=%s ・١٢=%s', analytics.gem_name_ok('12'), analytics.gem_name_ok('１２'), analytics.gem_name_ok('²³'), analytics.gem_name_ok('๑๒'), analytics.gem_name_ok('١٢')));
  v := v || pg_temp.info('NC2', format('gem_name_ok: "่้"(วรรณยุกต์ล้วน)=%s · "ๆๆ"=%s · "ฯฯ"=%s · "null"=%s · "O''Neil"=%s · "A&B"=%s · "x\\y"=%s · "😀A"=%s · "ก็"=%s · "Ａ１"(เต็มความกว้าง)=%s · "①②"=%s · "a·b"=%s',
    analytics.gem_name_ok('่้'), analytics.gem_name_ok('ๆๆ'), analytics.gem_name_ok('ฯฯ'), analytics.gem_name_ok('null'), analytics.gem_name_ok('O''Neil'), analytics.gem_name_ok('A&B'), analytics.gem_name_ok('x\y'), analytics.gem_name_ok('😀A'), analytics.gem_name_ok('ก็'), analytics.gem_name_ok('Ａ１'), analytics.gem_name_ok('①②'), analytics.gem_name_ok('a·b')));

  return v;
end;
$c$;

-- ============================================================================
-- Q. input ผิดรูปผ่านเส้นทางจริง: ทุกกรณีต้อง "รับ" หรือ "ปฏิเสธด้วย 22023" เท่านั้น (ห้ามเกิด error อื่น เช่น 22P02/XX000/23xxx) + ไม่เขียนเมื่อปฏิเสธ
-- ============================================================================
create function pg_temp.q_input() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); b uuid := pg_temp.fx('B'); j uuid := pg_temp.fx('J1'); oval uuid := pg_temp.shp(a, 'ไข่'); rnd uuid := pg_temp.shp(a, 'กลม');
  t uuid; tB uuid := pg_temp.fx('tB'); iB uuid := pg_temp.fx('iB'); r jsonb; s0 text; tc record; bad text := ''; n_ok int := 0; n_rej int := 0; n_other text := ''; txt text; st text;
  base text;
begin
  t := (pg_temp.ccreate(a, 'type', 'ZZQI ฐาน', null, true) ->> 'id')::uuid;
  -- (id, ชิ้นแถว JSON ที่ใช้ $T/$R/$O/$TB/$IB แทนค่า, คาด ok|rej|any)
  for tc in select * from (values
    ('q0', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":0}', 'rej'),
    ('q1', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":1.5}', 'rej'),
    ('q2', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":"1.5"}', 'rej'),
    ('q3', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":1001}', 'rej'),
    ('q4', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":1000}', 'ok'),
    ('q5', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":"1000"}', 'ok'),
    ('q6', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":"abc"}', 'rej'),
    ('q7', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":null}', 'rej'),
    ('q8', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":true}', 'rej'),
    ('q9', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":[1]}', 'rej'),
    ('q10', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":-1}', 'rej'),
    ('q11', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":"-1"}', 'rej'),
    ('q12', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":"１０"}', 'rej'),
    ('q13', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":"1e2"}', 'rej'),
    ('q14', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":1e2}', 'ok'),
    ('q15', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":2147483648}', 'rej'),
    ('q16', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":1e400}', 'rej'),
    ('q17', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":" 3"}', 'rej'),
    ('q18', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":{"a":1}}', 'rej'),
    ('q19', '{"type_id":"$T","shape_id":"$R","size_a":2}', 'rej'),
    ('s0', '{"type_id":"$T","shape_id":"$R","size_a":0,"qty_per_piece":1}', 'rej'),
    ('s1', '{"type_id":"$T","shape_id":"$R","size_a":-3,"qty_per_piece":1}', 'rej'),
    ('s2', '{"type_id":"$T","shape_id":"$R","size_a":100,"qty_per_piece":1}', 'ok'),
    ('s3', '{"type_id":"$T","shape_id":"$R","size_a":100.01,"qty_per_piece":1}', 'rej'),
    ('s4', '{"type_id":"$T","shape_id":"$R","size_a":"3,5","qty_per_piece":1}', 'rej'),
    ('s5', '{"type_id":"$T","shape_id":"$R","size_a":"3.5","qty_per_piece":1}', 'ok'),
    ('s6', '{"type_id":"$T","shape_id":"$R","size_a":" 3","qty_per_piece":1}', 'rej'),
    ('s7', '{"type_id":"$T","shape_id":"$R","size_a":"0x10","qty_per_piece":1}', 'rej'),
    ('s8', '{"type_id":"$T","shape_id":"$R","size_a":"NaN","qty_per_piece":1}', 'rej'),
    ('s9', '{"type_id":"$T","shape_id":"$R","size_a":"Infinity","qty_per_piece":1}', 'rej'),
    ('s10', '{"type_id":"$T","shape_id":"$R","size_a":"1e1","qty_per_piece":1}', 'rej'),
    ('s11', '{"type_id":"$T","shape_id":"$R","size_a":0.001,"qty_per_piece":1}', 'rej'),
    ('s12', '{"type_id":"$T","shape_id":"$R","size_a":0.01,"qty_per_piece":1}', 'ok'),
    ('s13', '{"type_id":"$T","shape_id":"$R","size_a":"٣","qty_per_piece":1}', 'rej'),
    ('s14', '{"type_id":"$T","shape_id":"$R","size_a":null,"qty_per_piece":1}', 'rej'),
    ('s15', '{"type_id":"$T","shape_id":"$R","size_a":1e999,"qty_per_piece":1}', 'rej'),
    ('s16', '{"type_id":"$T","shape_id":"$R","size_a":99.995,"qty_per_piece":1}', 'rej'),
    ('s17', '{"type_id":"$T","shape_id":"$R","size_a":".5","qty_per_piece":1}', 'rej'),
    ('s18', '{"type_id":"$T","shape_id":"$R","size_a":"3.","qty_per_piece":1}', 'rej'),
    ('s19', '{"type_id":"$T","shape_id":"$R","size_a":1e-2,"qty_per_piece":1}', 'ok'),
    ('s20', '{"type_id":"$T","shape_id":"$R","size_a":[2],"qty_per_piece":1}', 'rej'),
    ('s21', '{"type_id":"$T","shape_id":"$R","size_a":2,"size_b":3,"qty_per_piece":1}', 'rej'),
    ('s22', '{"type_id":"$T","shape_id":"$O","size_a":2,"qty_per_piece":1}', 'rej'),
    ('s23', '{"type_id":"$T","shape_id":"$O","size_a":2,"size_b":0,"qty_per_piece":1}', 'rej'),
    ('s24', '{"type_id":"$T","shape_id":"$O","size_a":2,"size_b":"x","qty_per_piece":1}', 'rej'),
    ('s25', '{"type_id":"$T","shape_id":"$O","size_a":6,"size_b":4,"qty_per_piece":1}', 'ok'),
    ('t0', '{"type_id":"not-a-uuid","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'rej'),
    ('t1', '{"type_id":12345,"shape_id":"$R","size_a":2,"qty_per_piece":1}', 'rej'),
    ('t2', '{"type_id":"$TB","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'rej'),
    ('t3', '{"type_id":"00000000-0000-0000-0000-000000000000","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'rej'),
    ('t4', '{"type_id":"$T","new_type_name":"ZZQI อื่น","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'rej'),
    ('t5', '{"shape_id":"$R","size_a":2,"qty_per_piece":1}', 'rej'),
    ('t6', '{"type_id":"$T","shape_id":"$R","new_shape":{"name":"ZZQI ทรง","has_length":false},"size_a":2,"qty_per_piece":1}', 'rej'),
    ('t7', '{"type_id":"$T","new_shape":{"name":"ZZQI ทรงเอ","has_length":"false"},"size_a":2,"qty_per_piece":1}', 'rej'),
    ('t8', '{"type_id":"$T","new_shape":{"name":"ZZQI ทรงเอ","has_length":false,"price":5},"size_a":2,"qty_per_piece":1}', 'rej'),
    ('t9', '{"type_id":"$T","new_shape":{"has_length":false},"size_a":2,"qty_per_piece":1}', 'rej'),
    ('t10', '{"type_id":"$T","new_shape":null,"shape_id":null,"size_a":2,"qty_per_piece":1}', 'rej'),
    ('t11', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":1,"price":123}', 'rej'),
    ('t12', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":1,"unit_cost":1}', 'rej'),
    ('t13', '{"gem_item_id":"$IB","qty_per_piece":1}', 'rej'),
    ('t14', '{"gem_item_id":"11111111-1111-1111-1111-111111111111","qty_per_piece":1}', 'rej'),
    ('t15', '{"gem_item_id":"x","qty_per_piece":1}', 'rej'),
    ('t16', '{"gem_item_id":7,"qty_per_piece":1}', 'rej'),
    ('t17', '{"gem_item_id":null,"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'ok'),
    ('t18', '{"type_id":null,"new_type_name":"ZZQI ใหม่18","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'ok'),
    ('n0', '{"new_type_name":"ก","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'rej'),
    ('n1', '{"new_type_name":"  ","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'rej'),
    ('n2', '{"new_type_name":123,"shape_id":"$R","size_a":2,"qty_per_piece":1}', 'rej'),
    ('n3', '{"new_type_name":["a"],"shape_id":"$R","size_a":2,"qty_per_piece":1}', 'rej'),
    ('n4', '{"new_type_name":"x'' OR ''1''=''1","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'any'),
    ('n5', '{"new_type_name":"\"; drop table analytics.gem_type; --","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'any'),
    ('n6', '{"new_type_name":"%s %1$s $$ \\\\ {{x}}","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'any'),
    ('n7', '{"new_type_name":"ZZQI 😀","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'any'),
    ('n8', '{"new_type_name":"ก่ก่","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'any'),
    ('n9', '{"new_type_name":"ZZQI ‮RTL","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'rej'),
    ('n10', '{"new_type_name":"ZZQI\u0009แท็บ","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'rej'),
    ('n11', '{"new_type_name":"ZZQI\u000aขึ้นบรรทัด","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'rej'),
    ('n12', '{"new_type_name":"<b>ZZ</b>","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'rej'),
    ('n13', '{"new_type_name":"ZZQI&lt;x","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'any'),
    ('n14', '{"new_type_name":"ZZQI NBSP นี้","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'ok'),
    ('n15', '{"new_type_name":"ZZQI ทับทิม ทับทิม ทับทิม ทับทิม ทับทิม ทับทิม","shape_id":"$R","size_a":2,"qty_per_piece":1}', 'rej'),
    ('p0', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":1,"position":"ก"}', 'ok'),
    ('p1', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":1,"position":"<b>"}', 'rej'),
    ('p2', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":1,"position":"a\u000ab"}', 'rej'),
    ('p3', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":1,"position":"   "}', 'any'),
    ('p4', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":1,"position":5}', 'rej'),
    ('p5', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":1,"position":null}', 'ok'),
    ('p6', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":1,"position":"😀"}', 'any'),
    ('p7', '{"type_id":"$T","shape_id":"$R","size_a":2,"qty_per_piece":1,"position":""}', 'any')
  ) as t(id, line, ex) loop
    base := replace(replace(replace(replace(replace(tc.line, '$TB', tB::text), '$IB', iB::text), '$T', t::text), '$R', rnd::text), '$O', oval::text);
    s0 := pg_temp.gsnap(a);
    r := pg_temp.bset(a, j, ('[' || base || ']')::jsonb, pg_temp.own());
    st := coalesce(r ->> '_state', 'OK');
    if tc.id = 'n14' then
      r := pg_temp.bset(a, j, ('[' || replace(base, 'NBSP', chr(160)) || ']')::jsonb, pg_temp.own());
      st := coalesce(r ->> '_state', 'OK');
    end if;
    if st = 'OK' then n_ok := n_ok + 1; elsif st = '22023' then n_rej := n_rej + 1; else n_other := n_other || tc.id || '=' || st || '(' || left(coalesce(r ->> '_err', ''), 80) || '); '; end if;
    if tc.ex = 'ok' and st <> 'OK' then bad := bad || tc.id || ':ควรผ่านแต่' || st || '/' || coalesce(r ->> '_hint', '') || '; ';
    elsif tc.ex = 'rej' and st = 'OK' then bad := bad || tc.id || ':ควรปฏิเสธแต่ผ่าน; ';
    elsif tc.ex = 'rej' and st <> '22023' then bad := bad || tc.id || ':ปฏิเสธด้วย ' || st || ' (ไม่ใช่ 22023); ';
    end if;
    if st <> 'OK' and pg_temp.gsnap(a) <> s0 then bad := bad || tc.id || ':ปฏิเสธแล้วยังเขียนข้อมูล; '; end if;
    if tc.ex = 'any' then v := v || pg_temp.info('IN-' || tc.id, format('%s → %s%s', left(tc.line, 70), st, case when st = 'OK' then '' else '/' || coalesce(r ->> '_hint', '') end)); end if;
  end loop;
  v := v || pg_temp.chkv('Q1', format('input ผิดรูป %s เคส: ผ่าน %s · ปฏิเสธ 22023 %s · ที่คาดผิด/เขียนทั้งที่ปฏิเสธ = ไม่มี', n_ok + n_rej + length(n_other) - length(replace(n_other, ';', '')), n_ok, n_rej), bad = '', bad);
  v := v || pg_temp.chkv('Q2', 'ไม่มี SQLSTATE อื่นนอกจาก 22023 (เช่น 22P02/22003/XX000/23505) หลุดจากการรับ input ใดเลย', n_other = '', n_other);
  -- โครงสร้างคำขอ
  s0 := pg_temp.gsnap(a);
  bad := '';
  for tc in select * from (values ('L0', 'null'), ('L1', '{}'), ('L2', '"x"'), ('L3', '5'), ('L4', '[1,2]'), ('L5', '[null]'), ('L6', '[[]]'), ('L7', '["a"]'), ('L8', '[true]')) as t(id, js) loop
    r := pg_temp.q(format('select analytics.job_gem_bom_set(p_shop_id=>%L, p_job_id=>%L, p_gem_lines=>%L::jsonb, p_actor=>%L)', a, j, tc.js, pg_temp.own()));
    if coalesce(r ->> '_state', 'OK') not in ('22023') then bad := bad || tc.id || ':' || coalesce(r ->> '_state', 'OK'); end if;
  end loop;
  v := v || pg_temp.chkv('Q3', 'โครงสร้างคำขอผิด (null · {} · "x" · 5 · [1,2] · [null] · [[]] · ["a"] · [true]) → 22023 ทุกกรณี ไม่เขียนอะไร', bad = '' and pg_temp.gsnap(a) = s0, bad);
  -- 30 / 31 แถว
  declare l30 jsonb; l31 jsonb; begin
    select jsonb_agg(jsonb_build_object('type_id', t, 'shape_id', rnd, 'size_a', kk + 0.5, 'qty_per_piece', 1)) into l30 from generate_series(1, 30) as g(kk);
    select jsonb_agg(jsonb_build_object('type_id', t, 'shape_id', rnd, 'size_a', kk + 0.5, 'qty_per_piece', 1)) into l31 from generate_series(1, 31) as g(kk);
    r := pg_temp.bset(a, j, l30, pg_temp.own());
    v := v || pg_temp.chkv('Q4a', '30 แถว (ขนาดไม่ซ้ำ) → ผ่านทั้งหมด · BOM 30 แถว', r ->> '_err' is null and pg_temp.n_bom(j) = 30, left(r::text, 300));
    s0 := pg_temp.gsnap(a);
    r := pg_temp.bset(a, j, l31, pg_temp.own());
    v := v || pg_temp.chkv('Q4b', '31 แถว → too_many_lines ไม่เขียนอะไร', pg_temp.hint(r) = '22023|too_many_lines' and pg_temp.gsnap(a) = s0, left(r::text, 300));
    select jsonb_agg(jsonb_build_object('type_id', t, 'shape_id', rnd, 'size_a', 2.5, 'qty_per_piece', 1)) into l31 from generate_series(1, 31) as g(kk);
    r := pg_temp.bset(a, j, l31, pg_temp.own());
    v := v || pg_temp.chkv('Q4c', '31 แถวซ้ำกันหมด (รวมแล้วเหลือ 1) → ยังปฏิเสธ (เพดานนับแถวที่ส่งมา — ตั้งใจ)', pg_temp.hint(r) = '22023|too_many_lines', left(r::text, 200));
    -- 30 แถวชื่อใหม่ทั้งหมด (สร้างชนิด 30 ชนิดในคำขอเดียว) ไม่พัง
    select jsonb_agg(jsonb_build_object('new_type_name', 'ZZQI ชนิดชุด' || chr(3585 + kk), 'shape_id', rnd, 'size_a', 1.5, 'qty_per_piece', 1)) into l30 from generate_series(1, 30) as g(kk);
    r := pg_temp.bset(a, j, l30, pg_temp.own(), null, true);
    v := v || pg_temp.chkv('Q4d', '30 แถวพิมพ์ชนิดใหม่ทั้งหมดในคำขอเดียว (force) → ผ่าน · ชนิดใหม่ 30', r ->> '_err' is null and jsonb_array_length(r -> 'summary' -> 'created_types') = 30, left(r::text, 300));
  end;
  return v;
end;
$c$;

-- ============================================================================
-- F. fuzz ลำดับ operation แคตตาล็อก (สร้าง/รวม/ปิด/ลบ/เปลี่ยนชื่อ/ราคา/แม่แบบ/BOM) 400 ครั้ง · ตรวจ invariant หลังทุกครั้ง · SQLSTATE นอกกรอบ = บั๊ก
-- ============================================================================
create function pg_temp.fz_inv(a uuid) returns text
 language plpgsql as $c$
declare v text := '';
begin
  if exists (select 1 from analytics.gem_item i join analytics.gem_type t on t.id = i.gem_type_id where i.shop_id = a and i.merged_into is null and t.merged_into is not null) then v := v || 'I1a:รายการตัวจริงใต้ชนิดที่ถูกรวม;'; end if;
  if exists (select 1 from analytics.gem_item i join analytics.gem_shape s on s.id = i.gem_shape_id where i.shop_id = a and i.merged_into is null and s.merged_into is not null) then v := v || 'I1b:รายการตัวจริงใต้รูปทรงที่ถูกรวม;'; end if;
  if exists (select 1 from analytics.gem_type x join analytics.gem_type y on y.id = x.merged_into where x.shop_id = a and y.merged_into is not null) then v := v || 'I2a:ห่วงโซ่ชนิดเกิน 1 ชั้น;'; end if;
  if exists (select 1 from analytics.gem_shape x join analytics.gem_shape y on y.id = x.merged_into where x.shop_id = a and y.merged_into is not null) then v := v || 'I2b:ห่วงโซ่รูปทรงเกิน 1 ชั้น;'; end if;
  if exists (select 1 from analytics.gem_item x join analytics.gem_item y on y.id = x.merged_into where x.shop_id = a and y.merged_into is not null) then v := v || 'I2c:ห่วงโซ่รายการเกิน 1 ชั้น;'; end if;
  if exists (select 1 from analytics.product_gem_bom b join analytics.gem_item i on i.id = b.gem_item_id where b.shop_id = a and i.merged_into is not null) then v := v || 'I3:แม่แบบอ้างรายการที่ถูกรวม;'; end if;
  if exists (select 1 from analytics.gem_item i join analytics.gem_shape s on s.id = i.gem_shape_id where i.shop_id = a and s.has_length is distinct from (i.size_b is not null)) then v := v || 'I5:ขนาดไม่ตรง has_length;'; end if;
  if exists (select 1 from analytics.gem_item i where i.shop_id = a and i.merged_into is null and analytics.gem_item_canonical(i.id) <> i.id) then v := v || 'I8:canonical ของตัวจริงไม่ใช่ตัวเอง;'; end if;
  if exists (select 1 from analytics.gem_item i where i.shop_id = a and i.merged_into is not null and (analytics.gem_item_canonical(i.id) = i.id or (select merged_into from analytics.gem_item z where z.id = analytics.gem_item_canonical(i.id)) is not null)) then v := v || 'I8b:canonical ของตัวที่ถูกรวมไม่จบที่ตัวจริง;'; end if;
  if exists (select 1 from analytics.gem_item i join analytics.gem_item j2 on j2.id = i.merged_into
              where i.shop_id = a and (j2.gem_type_id, j2.gem_shape_id, j2.size_a, coalesce(j2.size_b, 0)) is not distinct from (i.gem_type_id, i.gem_shape_id, i.size_a, coalesce(i.size_b, 0))) then v := v || 'I9:ตัวที่ถูกรวมชี้ตัวที่สเปกเดียวกันเป๊ะ (ซ้ำสเปก);'; end if;
  return v;
end;
$c$;

create function pg_temp.q_fuzz() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); j uuid := pg_temp.fx('J1'); pz uuid[] := array[pg_temp.fx('pA3'), pg_temp.fx('pA4'), pg_temp.fx('pW0')];
  pool text[] := array['โกเมน','โกเมนต์','CZ','cz','C Z','ซิทริน','ซิทริน2','อเมทิสต์','อเมทิส','ไพลิน','ไพลินน์','ทับทิม','บุษ','เพอริดอท','เพริดอท','Blue Topaz','Blue  Topaz','บลูโทแพซ','มรกต','เพชรรัสเซีย','ZZ ทดสอบ 1','ZZ ทดสอบ 2','ZZ ทดสอบ 3','ZZ ทดสอบ 4'];
  spool text[] := array['กลมๆ','ทรงกลม','ไข่ใหญ่','หัวใจ','ทรงหัวใจ','ใบไม้','ทรงใบไม้','ดาว','ทรงดาว','ทรงฟักทอง','สี่เหลี่ยมคางหมู','ZZ shape A','ZZ shape B'];
  op int; n_ops int := 400; i int; kind text; nm text; r jsonb; st text; h text; ids uuid[]; x uuid; y uuid; sz numeric; hl boolean; inv text; first_bad text := ''; bad_states text := ''; ok_n int := 0; rej_n int := 0;
  opc int[] := array_fill(0, array[14]); h_before text; lines jsonb; cnt int; k int; sample text := '';
begin
  perform setseed(0.4242);
  for i in 1..n_ops loop
    op := 1 + floor(random() * 13)::int;
    h_before := pg_temp.bomhash(a);
    r := null;
    if op = 1 then
      r := pg_temp.ccreate(a, 'type', pool[1 + floor(random() * array_length(pool, 1))::int], null, random() < 0.7);
    elsif op = 2 then
      r := pg_temp.ccreate(a, 'shape', spool[1 + floor(random() * array_length(spool, 1))::int], random() < 0.5, random() < 0.7);
    elsif op = 3 or op = 4 then
      -- สร้างรายการ: ชนิด/รูปทรงสุ่มจากทุกสถานะ (รวมที่ถูกรวม/ปิด) · ขนาดสุ่มตาม has_length
      select id into x from analytics.gem_type where shop_id = a order by random() limit 1;
      select id, has_length into y, hl from analytics.gem_shape where shop_id = a order by random() limit 1;
      if x is not null and y is not null then
        sz := (array[1, 1.5, 2, 2.5, 3, 4, 5, 6])[1 + floor(random() * 8)::int];
        r := pg_temp.icreate(a, jsonb_build_object('type_id', x, 'shape_id', y, 'size_a', sz) || case when hl then jsonb_build_object('size_b', sz + (array[0, 1, 2])[1 + floor(random() * 3)::int]) else '{}'::jsonb end, true);
      end if;
    elsif op = 5 then
      select id into x from analytics.gem_type where shop_id = a order by random() limit 1;
      select id into y from analytics.gem_type where shop_id = a order by random() limit 1;
      if x is not null then r := pg_temp.mrg(a, 'type', x, y); end if;
    elsif op = 6 then
      select id into x from analytics.gem_shape where shop_id = a order by random() limit 1;
      select id into y from analytics.gem_shape where shop_id = a order by random() limit 1;
      if x is not null then r := pg_temp.mrg(a, 'shape', x, y); end if;
    elsif op = 7 then
      kind := (array['type', 'shape', 'item'])[1 + floor(random() * 3)::int];
      execute format('select id from analytics.%s where shop_id = $1 order by random() limit 1', case kind when 'type' then 'gem_type' when 'shape' then 'gem_shape' else 'gem_item' end) into x using a;
      if x is not null then r := pg_temp.sact(a, kind, x, random() < 0.5); end if;
    elsif op = 8 then
      select id into x from analytics.gem_type where shop_id = a order by random() limit 1;
      if x is not null then r := pg_temp.ren(a, 'type', x, pool[1 + floor(random() * array_length(pool, 1))::int] || case when random() < 0.3 then ' ' || i else '' end, true); end if;
    elsif op = 9 then
      select id into x from analytics.gem_item where shop_id = a order by random() limit 1;
      if x is not null then r := pg_temp.price(a, x, (1 + floor(random() * 5000))::text || '.' || lpad(floor(random() * 10000)::text, 4, '0')); end if;
    elsif op = 10 then
      select array_agg(id) into ids from (select id from analytics.gem_item where shop_id = a order by random() limit 1 + floor(random() * 3)::int) q;
      if ids is not null then
        lines := (select jsonb_agg(jsonb_build_object('gem_item_id', e, 'qty_per_piece', 1 + floor(random() * 5)::int)) from unnest(ids) e);
        r := pg_temp.tset(a, pz[1 + floor(random() * 3)::int], lines);
      end if;
    elsif op = 11 then
      select array_agg(id) into ids from (select id from analytics.gem_item where shop_id = a order by random() limit 1 + floor(random() * 3)::int) q;
      if ids is not null then
        lines := (select jsonb_agg(jsonb_build_object('gem_item_id', e, 'qty_per_piece', 1 + floor(random() * 5)::int)) from unnest(ids) e);
        r := pg_temp.bset(a, j, lines, pg_temp.own());
      end if;
    elsif op = 12 then
      kind := (array['type', 'shape', 'item'])[1 + floor(random() * 3)::int];
      execute format('select id from analytics.%s where shop_id = $1 order by random() limit 1', case kind when 'type' then 'gem_type' when 'shape' then 'gem_shape' else 'gem_item' end) into x using a;
      if x is not null then r := pg_temp.rmv(a, kind, x); end if;
    else
      -- พิมพ์ชื่อใหม่ในใบ (get-or-create) — ชนิดสุ่มจาก pool + รูปทรงสุ่ม
      select id, has_length into y, hl from analytics.gem_shape where shop_id = a and is_active and merged_into is null order by random() limit 1;
      if y is not null then
        r := pg_temp.bset(a, j, jsonb_build_array(jsonb_build_object('new_type_name', pool[1 + floor(random() * array_length(pool, 1))::int], 'shape_id', y, 'size_a', 2, 'qty_per_piece', 1) || case when hl then jsonb_build_object('size_b', 3) else '{}'::jsonb end), pg_temp.own(), null, random() < 0.5);
      end if;
    end if;
    opc[op] := opc[op] + 1;
    if r is not null then
      st := coalesce(r ->> '_state', 'OK');
      if st = 'OK' then ok_n := ok_n + 1; elsif st in ('22023', '42501') then rej_n := rej_n + 1;
      else bad_states := bad_states || format('#%s op%s=%s(%s %s); ', i, op, st, left(coalesce(r ->> '_err', ''), 60), coalesce(r ->> '_hint', '')); end if;
    end if;
    -- BOM snapshot เปลี่ยนได้เฉพาะ op 11 (แก้ใบ) เท่านั้น
    if op <> 11 and op <> 13 and pg_temp.bomhash(a) <> h_before then first_bad := first_bad || format('#%s op%s:snapshot job_gem_bom ขยับ; ', i, op); end if;
    inv := pg_temp.fz_inv(a);
    if inv <> '' and length(first_bad) < 600 then first_bad := first_bad || format('#%s op%s:%s ', i, op, inv); end if;
  end loop;
  v := v || pg_temp.chkv('Z1', format('fuzz %s operation (ผ่าน %s · ปฏิเสธ 22023/42501 %s) · SQLSTATE นอกกรอบ (23505 unique · 23503 FK · 40001 · XX000 ฯลฯ) = ไม่มี', n_ops, ok_n, rej_n), bad_states = '', bad_states);
  v := v || pg_temp.chkv('Z2', 'invariant ตลอด 400 operation: ไม่มีรายการตัวจริงใต้ชนิด/รูปทรงที่ถูกรวม · ห่วงโซ่รวม ≤ 1 ชั้น · แม่แบบไม่อ้างรายการที่ถูกรวม · ขนาดตรง has_length · snapshot ใบไม่ขยับจาก op อื่น · canonical จบที่ตัวจริง', first_bad = '', first_bad);
  select count(*) into cnt from analytics.gem_type where shop_id = a; k := cnt;
  v := v || pg_temp.info('Z3', format('สถานะหลัง fuzz: ชนิด %s (รวมแล้ว %s) · รูปทรง %s (รวมแล้ว %s) · รายการ %s (รวมแล้ว %s) · op ที่รัน %s', cnt, (select count(*) from analytics.gem_type where shop_id = a and merged_into is not null),
    (select count(*) from analytics.gem_shape where shop_id = a), (select count(*) from analytics.gem_shape where shop_id = a and merged_into is not null),
    (select count(*) from analytics.gem_item where shop_id = a), (select count(*) from analytics.gem_item where shop_id = a and merged_into is not null), opc::text));
  -- หลัง fuzz: ทุก RPC อ่านต้องไม่ล้ม (ข้อมูลสภาพซับซ้อน)
  r := pg_temp.clist(a, null, true);
  v := v || pg_temp.chkv('Z4a', 'gem_catalog_list (รวมที่ปิด/รวมแล้ว) ไม่ล้มหลัง fuzz', r ->> '_err' is null and jsonb_typeof(r -> 'items') = 'array', left(r::text, 300));
  r := pg_temp.olist(a);
  v := v || pg_temp.chkv('Z4b', 'gem_options_list ไม่ล้ม · ไม่มีรายการที่ถูกรวม/ปิด/ชนิดถูกรวมโผล่ใน dropdown', r ->> '_err' is null
    and not exists (select 1 from jsonb_array_elements(r -> 'items') e join analytics.gem_item i on i.id = (e ->> 'gem_item_id')::uuid where not analytics.gem_item_live(i.id))
    and not exists (select 1 from jsonb_array_elements(r -> 'types') e join analytics.gem_type t on t.id = (e ->> 'id')::uuid where t.merged_into is not null or not t.is_active), left(r::text, 300));
  r := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, j));
  v := v || pg_temp.chkv('Z4c', 'job_gem_bom_get ไม่ล้มหลัง fuzz', r ->> '_err' is null, left(r::text, 300));
  return v;
end;
$c$;

-- ============================================================================
-- P. ประสิทธิภาพ: ตัวดักชื่อคล้ายกับแคตตาล็อกใหญ่ (ชนิด 2,000) · gem_catalog_list/gem_options_list ที่ 2,000 รายการ
-- ============================================================================
create function pg_temp.q_perf() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('B'); u uuid := pg_temp.fx('u_staff'); rnd uuid; n int; lo int := 0; salt int := 0;
  t0 timestamptz; msS numeric; msC numeric; ms3 numeric; ms4 numeric; ms1 numeric; r jsonb; lines jsonb; sizes int[] := array[300, 2000]; allok boolean := true;
begin
  perform analytics.gem_shape_ensure(a);
  select id into rnd from analytics.gem_shape where shop_id = a and name = 'กลม';
  foreach n in array sizes loop
    insert into analytics.gem_type (shop_id, name, created_by)
      select a, 'ZZP' || substr(md5('t' || kk), 1, 9), u from generate_series(lo + 1, n) as g(kk);
    insert into analytics.gem_item (shop_id, gem_type_id, gem_shape_id, size_a, created_by)
      select a, t.id, rnd, 3, u from analytics.gem_type t where t.shop_id = a and t.name like 'ZZP%' and not exists (select 1 from analytics.gem_item i where i.gem_type_id = t.id);
    lo := n; salt := salt + 1;
    -- (S) 30 ชื่อ "คล้าย" ชื่อที่มี (แก้ตัวท้าย) → ตัวดักไล่เทียบทั้งแคตตาล็อกแล้วปฏิเสธ gem_similar (ไม่เขียน) = ต้นทุนของการสแกนล้วนๆ
    select jsonb_agg(jsonb_build_object('new_type_name', left(t.name, length(t.name) - 1) || 'z', 'shape_id', rnd, 'size_a', 2, 'qty_per_piece', 1)) into lines
      from (select name from analytics.gem_type where shop_id = a and name like 'ZZP%' order by name limit 30) t;
    t0 := clock_timestamp();
    r := pg_temp.q(format('select analytics.gem_lines_prepare(%L, %L::jsonb, false, %L, null)', a, lines, u));
    msS := extract(epoch from clock_timestamp() - t0) * 1000;
    v := v || case when pg_temp.hint(r) = '22023|gem_similar' then '' else pg_temp.chk('P' || n || 'x', 'ชุดชื่อคล้ายต้องถูกดักด้วย gem_similar แต่ได้ ' || pg_temp.hint(r), false) end;
    -- 1 ชื่อ
    t0 := clock_timestamp();
    r := pg_temp.q(format('select analytics.gem_lines_prepare(%L, %L::jsonb, false, %L, null)', a, jsonb_build_array(lines -> 0), u));
    ms1 := extract(epoch from clock_timestamp() - t0) * 1000;
    -- (C) 30 ชื่อใหม่ไม่คล้ายใคร (สร้างจริง 30 ชนิด + 30 รายการ) = สแกน + เขียน
    select jsonb_agg(jsonb_build_object('new_type_name', 'ZZQ' || substr(md5('n' || salt || kk), 1, 9), 'shape_id', rnd, 'size_a', 2, 'qty_per_piece', 1)) into lines from generate_series(1, 30) as g(kk);
    t0 := clock_timestamp();
    r := pg_temp.q(format('select analytics.gem_lines_prepare(%L, %L::jsonb, false, %L, null)', a, lines, u));
    msC := extract(epoch from clock_timestamp() - t0) * 1000;
    v := v || case when r ->> '_err' is null and jsonb_array_length(r -> 'summary' -> 'created_types') = 30 then '' else pg_temp.chk('P' || n || 'y', 'สร้าง 30 ชนิดใหม่ในคำขอเดียวต้องสำเร็จ: ' || left(r::text, 200), false) end;
    t0 := clock_timestamp();
    r := pg_temp.clist(a, u, false);
    ms3 := extract(epoch from clock_timestamp() - t0) * 1000;
    t0 := clock_timestamp();
    r := pg_temp.q(format('select analytics.gem_options_list(%L)', a));
    ms4 := extract(epoch from clock_timestamp() - t0) * 1000;
    v := v || pg_temp.info('P' || n, format('ชนิด ≈%s · รายการ ≈%s: ตัวดักคล้าย 1 ชื่อ %s ms · สแกน 30 ชื่อ (ปฏิเสธ gem_similar ไม่เขียน) %s ms · สร้าง 30 ชนิดใหม่ + 30 รายการ (สแกน+เขียน) %s ms · gem_catalog_list %s ms · gem_options_list %s ms', n, n, round(ms1), round(msS), round(msC), round(ms3), round(ms4)));
    if n = 2000 then allok := msS < 8000 and msC < 8000 and ms3 < 3000 and ms4 < 3000; end if;
  end loop;
  v := v || pg_temp.known('P9', 'แคตตาล็อก 2,000 ชนิด: สแกน/สร้าง 30 ชื่อ < 8 วินาที · catalog_list/options_list < 3 วินาที', allok, '');
  return v;
end;
$c$;

-- ============================================================================
-- รัน
-- ============================================================================

create function pg_temp.q_extra() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); j uuid := pg_temp.fx('J1'); oval uuid := pg_temp.shp(a, 'ไข่'); r jsonb; s0 text; tk jsonb; tokh text; w uuid; s jsonb; sess text; p uuid; jid uuid; ik text; r1 jsonb; r2 jsonb; n_jobs int; n_bom int;
  t uuid;
begin
  -- T1: รูปทรงใหม่ชื่อเดียวกัน 2 แถวในคำขอเดียว แต่ has_length ขัดกัน → ต้องปฏิเสธแบบ 22023 ไม่เขียนครึ่งๆ กลางๆ
  t := (pg_temp.ccreate(a, 'type', 'ZZQX ฐาน', null, true) ->> 'id')::uuid;
  s0 := pg_temp.gsnap(a);
  r := pg_temp.bset(a, j, jsonb_build_array(
        jsonb_build_object('type_id', t, 'new_shape', jsonb_build_object('name', 'ZZQX ทรงขัด', 'has_length', false), 'size_a', 2, 'qty_per_piece', 1),
        jsonb_build_object('type_id', t, 'new_shape', jsonb_build_object('name', 'ZZQX ทรงขัด', 'has_length', true), 'size_a', 2, 'size_b', 3, 'qty_per_piece', 1)), pg_temp.own());
  v := v || pg_temp.chkv('X1', 'รูปทรงใหม่ชื่อเดียวกัน 2 แถวแต่ has_length ขัดกัน (false/true) ในคำขอเดียว → ปฏิเสธ 22023 (ไม่ใช่ error อื่น) · ไม่เขียนอะไร',
    r ->> '_state' = '22023' and pg_temp.gsnap(a) = s0, r::text);
  -- T2: W1 idem — ส่งคำขอเปิดใบเดิมซ้ำด้วย idem key เดียวกัน (มือถือส่งซ้ำ/กดซ้ำ) → ได้ใบเดิม ไม่ซ้ำ ไม่คัดลอกพลอยซ้ำ
  p := analytics.product_upsert(a, 'ZZ190-X1', 'แหวน idem QA', null, 'fixed', 40, null, null, null, null, null, null, null, true);
  perform pg_temp.tset(a, p, format('[{"new_type_name":"ZZQX idem","shape_id":"%s","size_a":4,"size_b":6,"qty_per_piece":2}]', oval)::jsonb);
  tk := analytics.shop_intake_token_issue(a, pg_temp.nom());
  tokh := analytics.job_sha256_hex(tk ->> 'token');
  r := pg_temp.wu(a, 'ZZ-M2 ผู้จัดการ QA', '1357', '{qc}', true);
  w := (r ->> 'id')::uuid;
  s := pg_temp.q(format('select analytics.worker_pin_verify_intake(%L, %L, %L, %L, %L)', tokh, w, '1357', 'verify-ua/1.0', null));
  sess := analytics.job_sha256_hex(s ->> 'session_token');
  ik := 'ik' || replace(gen_random_uuid()::text, '-', '');
  delete from analytics.worker_rate_limit where key like 'wo:%' or key like 'sio:%' or key like 'ipw:%';
  r1 := pg_temp.q(format('select analytics.job_worker_open(p_token_hash=>%L, p_session_hash=>%L, p_idem_key=>%L, p_product_id=>%L, p_pending_label=>null, p_metal=>null, p_qty_order=>%L, p_user_agent=>%L, p_ip_hash=>null)', tokh, sess, ik, p, '2', 'verify-ua/1.0'));
  delete from analytics.worker_rate_limit where key like 'wo:%' or key like 'sio:%' or key like 'ipw:%';
  r2 := pg_temp.q(format('select analytics.job_worker_open(p_token_hash=>%L, p_session_hash=>%L, p_idem_key=>%L, p_product_id=>%L, p_pending_label=>null, p_metal=>null, p_qty_order=>%L, p_user_agent=>%L, p_ip_hash=>null)', tokh, sess, ik, p, '2', 'verify-ua/1.0'));
  select count(*) into n_jobs from analytics.job where shop_id = a and product_id = p;
  select count(*) into n_bom from analytics.job_gem_bom b join analytics.job jj on jj.id = b.job_id where jj.product_id = p;
  v := v || pg_temp.chkv('X2', 'W1 เปิดใบ SKU มีแม่แบบ ซ้ำด้วย idem key เดิม → ใบเดียว · เลขใบเดิม · BOM ไม่คัดลอกซ้ำ (1 แถว)',
    r1 ->> 'ok' = 'true' and r2 ->> 'ok' = 'true' and r1 ->> 'job_no' = r2 ->> 'job_no' and n_jobs = 1 and n_bom = 1, r1::text || ' / ' || r2::text || ' jobs=' || n_jobs || ' bom=' || n_bom);
  -- T3: staff (member role staff) เรียก RPC แคตตาล็อก/ราคาทุกตัวที่ตรวจ actor → ปฏิเสธ · ไม่ใช่สมาชิกเลย → ปฏิเสธ
  v := v || pg_temp.chkv('X3', 'ผู้ใช้ staff/ไม่ใช่สมาชิก เรียก gem_catalog_list · gem_price_history · gem_price_set · gem_catalog_create · gem_merge → 42501 ทุกตัว',
    (select bool_and(pg_temp.err(x.sql) like '42501|%') from (values
      (format('select analytics.gem_catalog_list(%L, %L, false)', a, pg_temp.stf())),
      (format('select analytics.gem_catalog_list(%L, %L, false)', a, pg_temp.nom())),
      (format('select analytics.gem_price_history(%L, %L, %L)', a, pg_temp.stf(), (select id from analytics.gem_item where shop_id = a limit 1))),
      (format('select analytics.gem_catalog_create(%L, %L, %L, %L, null, true)', a, pg_temp.stf(), 'type', 'ZZ ห้าม')),
      (format('select analytics.gem_merge(%L, %L, %L, %L, %L)', a, pg_temp.nom(), 'type', gen_random_uuid(), gen_random_uuid()))
    ) as x(sql)), '');
  return v;
end;
$c$;



-- ============================================================================
-- รัน (ต้องมี 0190 อยู่ใน DB แล้ว หรือต่อท้าย migration 0190 ในไฟล์เดียวกันแบบ dry-run) · จบด้วย raise exception เสมอ = ROLLBACK ทั้งก้อน
-- ============================================================================
do $qa$
declare
  v_msg text := E'
=== verify-0190-qa ===
'; fn text; res text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    v_msg := v_msg || pg_temp.g_setup();
    foreach fn in array array['q_cycle', 'q_old', 'q_lot', 'q_wopen', 'q_oem_real', 'q_gold', 'q_merge', 'q_names', 'q_input', 'q_fuzz', 'q_perf', 'q_extra'] loop
      begin
        execute format('select pg_temp.%I()', fn) into res;
        v_msg := v_msg || coalesce(res, '');
      exception when others then
        v_msg := v_msg || format('[FAIL] CRASH  %s ล้ม: %s %s', fn, sqlstate, sqlerrm) || E'
';
      end;
    end loop;
    raise exception 'QA_ROLLBACK';
  exception when others then
    if sqlerrm <> 'QA_ROLLBACK' then v_msg := v_msg || format('[FAIL] CRASH-setup  %s %s', sqlstate, sqlerrm) || E'
'; end if;
  end;
  raise exception '%', v_msg || format(E'
--- สรุป: OK %s · FAIL %s · BUG-OPEN %s · SKIP %s ---',
    (length(v_msg) - length(replace(v_msg, '[OK]', ''))) / 4, (length(v_msg) - length(replace(v_msg, '[FAIL]', ''))) / 6,
    (length(v_msg) - length(replace(v_msg, '[BUG-OPEN]', ''))) / 10, (length(v_msg) - length(replace(v_msg, '[SKIP]', ''))) / 6);
end;
$qa$;
