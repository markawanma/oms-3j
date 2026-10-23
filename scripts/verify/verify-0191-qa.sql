-- scripts/verify/verify-0191-qa.sql — QA R2-D2 (23 ต.ค. 69) · W3 (0191): เคสนอก verify-0191 ที่ QA คิดเพิ่ม
-- ใช้ helper/fixture ของ verify-0191 (คัดลอกส่วนหัว) · self-rolling-back: ทุกเคสถอยกลับในกลุ่มของตัวเอง + จบด้วย raise exception (exit 1 = ผลที่คาด) · [FAIL] >= 1 = ไม่ผ่าน · [INFO] = ผลสังเกต ไม่ใช่ผ่าน/ไม่ผ่าน
-- dry-run ก่อน apply: ต่อ 0191_gems_w3.sql + ไฟล์นี้ (LF) เป็นไฟล์เดียวแล้วรันไม่ใส่ --commit · หลัง apply: รันไฟล์นี้เดี่ยวๆ ได้
-- ครอบ: Q1 ครบวงจร (catalog → เปิดใบ template → hub → get → แก้ → ช่างฝังเห็นใน resolve → ช่างรับขั้นแรก → ล็อก → ออฟฟิศเห็น/แก้ต่อ) · Q2 ใบที่แบ่งส่วนแล้ว · Q3/Q4 แม่แบบที่ชนิดปิดใช้/ถูกรวม ·
--   Q5 แถวซ้ำ/ชื่อซ้ำในคำขอเดียว (รวม 600+600) · Q6 force normalize + key เดิมหลังล้ม · Q8 ชื่อแปลก (emoji/ZWSP/RTL/ยาว 40-41) · Q9 ล้างเหลือ 0 · Q10 ออฟฟิศเห็นชื่อใหม่/คนที่ 2 ใช้ตัวเดิม ·
--   Q11 none แล้วเพิ่มทีหลัง · Q12 JSON null/สตริงแปลก · Q13 ชื่อซ้ำต่าง whitespace/ตัวพิมพ์/ความกว้าง · Q14 ตัวเลขสุดขั้ว 28 แบบ · Q15 4.10=4.1 · Q16 gem_set ตัวเลขสุดขั้ว · Q22 ใบจริง 41 ใบ · Q24 ไม่ส่งคำตอบ
-- ข้อยกเว้นที่ไม่ผ่าน RPC (บอกตรงๆ): เหมือน verify-0191 (insert public.shop/shop_member สังเคราะห์ในทรานแซกชันเดียว · ยืม auth user จริง) — ถอยทั้งก้อน
create temp table _v191_fx (k text primary key, id uuid not null) on commit drop;
create temp table _v191_kv (k text primary key, v text not null) on commit drop;

create function pg_temp.chk(p_id text, p_desc text, p_ok boolean) returns text
 language sql as $c$
  select format('[%s] %s  %s', case when coalesce(p_ok, false) then 'OK' else 'FAIL' end, p_id, p_desc) || E'\n'
$c$;
create function pg_temp.fx(p_k text) returns uuid language sql as $c$ select id from _v191_fx where k = p_k $c$;
create function pg_temp.setfx(p_k text, p_id uuid) returns void language sql as $c$
  insert into _v191_fx (k, id) values (p_k, p_id) on conflict (k) do update set id = excluded.id $c$;
create function pg_temp.kv(p_k text) returns text language sql as $c$ select v from _v191_kv where k = p_k $c$;
create function pg_temp.setkv(p_k text, p_v text) returns void language sql as $c$
  insert into _v191_kv (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $c$;
-- เก็บ id จากผล RPC ของ fixture — ผลไม่มี id (ล้ม) = หยุดพร้อมบอกผลดิบ (ไม่ให้ null ไหลต่อเงียบๆ)
create function pg_temp.sfx(p_k text, r jsonb) returns void language plpgsql as $c$
begin
  if r ->> 'id' is null then raise exception 'setup % ล้ม: %', p_k, r::text; end if;
  perform pg_temp.setfx(p_k, (r ->> 'id')::uuid);
end;
$c$;
create function pg_temp.own() returns uuid language sql as $c$ select pg_temp.fx('u_owner') $c$;
-- ผู้ทำรายการฝั่งออฟฟิศของร้านนั้น (owner ที่ยืมมาเป็นสมาชิกร้านสังเคราะห์) — แคตตาล็อก/ราคาตรวจว่า actor เป็นสมาชิก owner/admin ของ "ร้านนั้น"
create function pg_temp.afor(p_shop uuid) returns uuid language sql as $c$
  select m.user_id from public.shop_member m where m.shop_id = p_shop and m.role = 'owner' order by m.user_id limit 1 $c$;
create function pg_temp.act() returns uuid language sql as $c$ select '00000000-0000-0000-0000-0000000000a1'::uuid $c$;
create function pg_temp.std() returns text language sql as $c$ select '{wax_inject,wax_tree,invest_burnout,cast,cut_sprue,finish,buff,qc,pack}' $c$;
create function pg_temp.stdg() returns text language sql as $c$ select '{wax_inject,wax_tree,invest_burnout,cast,cut_sprue,finish,buff,gem_set,qc,pack}' $c$;
-- ราคาทดสอบ (เลขแปลก — ต้องไม่โผล่ที่ไหนนอกทาง RPC ราคา)
create function pg_temp.px() returns text language sql as $c$ select '7391.2468' $c$;
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
-- key ทุกระดับของ jsonb (ตรวจว่าผลฝั่งช่างไม่มี key เงิน/ต้นทุน/ลูกค้า)
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
  select coalesce(string_agg(distinct k, ','), '') from pg_temp.keys_deep(j) k where k ~* '(cost|price|thb|margin|unit_cost|customer|profit|buyer|client|quote_?no|po_?no|invoice|receipt|deposit|paid|grand_?total|subtotal|vat|tax_?id|phone|email|address|nre_|baht|supplier|tier|target_piece_g|breakage|created_by|worker_id)' $c$;
-- สแกนทุกราคา ≥ 1,000 ที่ตั้งไว้ในตารางราคา/audit ว่าโผล่ในผลลัพธ์ไหม (ไม่ใช่แค่ราคาปัจจุบัน)
create function pg_temp.has_px(j jsonb) returns boolean language sql as $c$
  select exists (select 1 from analytics.gem_item_price p where p.price_thb_per_unit >= 1000 and position(trim_scale(p.price_thb_per_unit)::text in coalesce(j::text, '')) > 0)
      or exists (select 1 from analytics.gem_item_price_audit a where a.new_price >= 1000 and position(trim_scale(a.new_price)::text in coalesce(j::text, '')) > 0) $c$;
create function pg_temp.ik() returns text language sql as $c$ select 'ik' || replace(gen_random_uuid()::text, '-', '') $c$;
create function pg_temp.th() returns text language sql as $c$ select pg_temp.kv('tokh_a') $c$;

-- ภาพรวมสถานะของร้าน (ใช้เทียบว่า "ไม่มีอะไรเกิด") — รวมตารางพลอย (ไม่รวมราคา)
create function pg_temp.ctr(p_shop uuid) returns text language sql as $c$
  select coalesce((select last_no from analytics.job_counter where shop_id = p_shop), 0) || '/' || coalesce((select last_no from analytics.production_order_counter where shop_id = p_shop), 0) $c$;
create function pg_temp.shop_state(p_shop uuid) returns text language sql as $c$
  select (select count(*) from analytics.production_order where shop_id = p_shop) || '/' || (select count(*) from analytics.job where shop_id = p_shop)
         || '/' || (select count(*) from analytics.job_token where shop_id = p_shop) || '/' || (select count(*) from analytics.job_event where shop_id = p_shop)
         || '/' || pg_temp.ctr(p_shop) || '/' || (select count(*) from analytics.production_order_item where shop_id = p_shop) $c$;
create function pg_temp.gsnap(p_shop uuid) returns text
 language sql as $c$
  select md5(coalesce((select string_agg(t::text, '|' order by t.id) from analytics.gem_type t where t.shop_id = p_shop), '')
          || '#' || coalesce((select string_agg(s::text, '|' order by s.id) from analytics.gem_shape s where s.shop_id = p_shop), '')
          || '#' || coalesce((select string_agg(i::text, '|' order by i.id) from analytics.gem_item i where i.shop_id = p_shop), '')
          || '#' || coalesce((select string_agg(b::text, '|' order by b.id) from analytics.job_gem_bom b where b.shop_id = p_shop), '')
          || '#' || coalesce((select string_agg(b::text, '|' order by b.id) from analytics.product_gem_bom b where b.shop_id = p_shop), '')) $c$;
create function pg_temp.allst(p_shop uuid) returns text language sql as $c$ select pg_temp.shop_state(p_shop) || '#' || pg_temp.gsnap(p_shop) $c$;
create function pg_temp.n_type(p_shop uuid) returns int language sql as $c$ select count(*)::int from analytics.gem_type where shop_id = p_shop $c$;
create function pg_temp.n_shape(p_shop uuid) returns int language sql as $c$ select count(*)::int from analytics.gem_shape where shop_id = p_shop $c$;
create function pg_temp.n_item(p_shop uuid) returns int language sql as $c$ select count(*)::int from analytics.gem_item where shop_id = p_shop $c$;
create function pg_temp.n_bom(p_job uuid) returns int language sql as $c$ select count(*)::int from analytics.job_gem_bom where job_id = p_job $c$;
create function pg_temp.n_bev(p_job uuid) returns int language sql as $c$ select count(*)::int from analytics.job_event where job_id = p_job and event_type = 'bom_change' $c$;
create function pg_temp.n_price() returns bigint language sql as $c$ select (select count(*) from analytics.gem_item_price) + (select count(*) from analytics.gem_item_price_audit) $c$;
create function pg_temp.bomhash(p_job uuid) returns text language sql as $c$
  select coalesce(md5(string_agg(b::text, '|' order by b.line_seq)), 'none') from analytics.job_gem_bom b where b.job_id = p_job $c$;
create function pg_temp.has_stage(p_job uuid) returns boolean language sql as $c$ select exists (select 1 from analytics.job_stage s where s.job_id = p_job and s.stage_code = 'gem_set') $c$;
create function pg_temp.typ(p_shop uuid, p_name text) returns uuid language sql as $c$ select id from analytics.gem_type where shop_id = p_shop and name = p_name $c$;
create function pg_temp.shp(p_shop uuid, p_name text) returns uuid language sql as $c$ select id from analytics.gem_shape where shop_id = p_shop and name = p_name $c$;
create function pg_temp.jid(p_shop uuid, p_job_no text) returns uuid language sql as $c$ select id from analytics.job where shop_id = p_shop and job_no = p_job_no $c$;

-- ============================================================================
-- helper เรียก RPC ฝั่งออฟฟิศ (ใช้สร้าง fixture)
-- ============================================================================
create function pg_temp.wu(p_shop uuid, p_name text, p_pin text, p_id uuid default null, p_codes text default '{qc}', p_open boolean default null, p_ext boolean default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.worker_upsert(p_shop_id=>%L, p_id=>%L, p_display_name=>%L, p_stage_codes=>%L::text[], p_pin=>%L, p_actor=>%L, p_can_open_job=>%L, p_can_external=>%L)',
    p_shop, p_id, p_name, p_codes, p_pin, pg_temp.act(), p_open, p_ext)) $c$;
create function pg_temp.po(p_shop uuid, p_note text default 'verify0191') returns uuid
 language sql as $c$ select (analytics.production_order_save(p_shop, null, p_note, null) ->> 'id')::uuid $c$;
create function pg_temp.iset(p_shop uuid, p_order uuid, p_product uuid, p_qty int) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>%L, p_qty_planned=>%L)', p_shop, p_order, p_product, p_qty)) $c$;
-- ใบผลิตออฟฟิศ + รายการ + ใบงาน (ผ่าน RPC ออฟฟิศเดิม) · p_codes = text[] literal
create function pg_temp.office_job(p_shop uuid, p_product uuid, p_codes text default null) returns jsonb
 language plpgsql as $c$
declare o uuid; r jsonb; j jsonb;
begin
  o := pg_temp.po(p_shop, 'office-v191');
  r := pg_temp.iset(p_shop, o, p_product, 3);
  j := pg_temp.q(format('select analytics.job_create_from_production_item(p_shop_id=>%L, p_production_order_item_id=>%L, p_stage_codes=>%L::text[], p_actor=>%L)',
    p_shop, r ->> 'id', coalesce(p_codes, pg_temp.stdg()), pg_temp.act()));
  return jsonb_build_object('po', o, 'item', r ->> 'id', 'job', j ->> 'job_id', 'job_no', j ->> 'job_no', 'err', j -> '_err', 'res', j);
end;
$c$;
create function pg_temp.icreate(p_shop uuid, p_line jsonb, p_force boolean default false) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_item_create(%L, %L, %L::jsonb, %L)', p_shop, pg_temp.afor(p_shop), p_line, p_force)) $c$;
create function pg_temp.ccreate(p_shop uuid, p_kind text, p_name text, p_hl boolean default null, p_force boolean default false) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_catalog_create(%L, %L, %L, %L, %L, %L)', p_shop, pg_temp.afor(p_shop), p_kind, p_name, p_hl, p_force)) $c$;
create function pg_temp.price(p_shop uuid, p_item uuid, p_price text) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_price_set(%L, %L, %L, %L::numeric, null, null, null)', p_shop, pg_temp.afor(p_shop), p_item, p_price)) $c$;
create function pg_temp.sact(p_shop uuid, p_kind text, p_id uuid, p_active boolean) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_catalog_set_active(%L, %L, %L, %L, %L)', p_shop, pg_temp.afor(p_shop), p_kind, p_id, p_active)) $c$;
create function pg_temp.mrg(p_shop uuid, p_kind text, p_from uuid, p_into uuid) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.gem_merge(%L, %L, %L, %L, %L)', p_shop, pg_temp.afor(p_shop), p_kind, p_from, p_into)) $c$;
create function pg_temp.tset(p_shop uuid, p_product uuid, p_lines jsonb) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.product_gem_bom_set(p_shop_id=>%L, p_product_id=>%L, p_gem_lines=>%L::jsonb, p_actor=>%L, p_force=>false)', p_shop, p_product, p_lines, pg_temp.afor(p_shop))) $c$;
create function pg_temp.oset(p_shop uuid, p_job uuid, p_lines jsonb, p_reason text default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.job_gem_bom_set(p_shop_id=>%L, p_job_id=>%L, p_gem_lines=>%L::jsonb, p_actor=>%L, p_reason=>%L, p_force=>false)', p_shop, p_job, p_lines, pg_temp.act(), p_reason)) $c$;
-- ช่างรับขั้นแรกของใบ (ผ่าน RPC ออฟฟิศเดิม) — ลองไม่ใส่น้ำหนักก่อน ไม่ผ่านค่อยใส่
create function pg_temp.rcv(p_shop uuid, p_job uuid) returns jsonb
 language plpgsql as $c$
declare r jsonb; sq int;
begin
  select min(s.seq) into sq from analytics.job_stage s where s.job_id = p_job and s.status = 'pending';
  r := pg_temp.q(format('select analytics.job_office_receive(%L, %L, %L, %L, null, null, ''x'', ''job_page'', %L)', p_shop, p_job, sq, analytics.job_today(), pg_temp.act()));
  if r ? '_err' or r ->> 'ok' = 'false' then
    r := pg_temp.q(format('select analytics.job_office_receive(%L, %L, %L, %L, %L::numeric, null, ''x'', ''job_page'', %L)', p_shop, p_job, sq, analytics.job_today(), 5, pg_temp.act()));
  end if;
  return r;
end;
$c$;
create function pg_temp.received(p_job uuid) returns boolean
 language sql as $c$ select exists (select 1 from analytics.job_stage s where s.job_id = p_job and s.status in ('received', 'sent')) $c$;
-- จำลอง session หมดอายุ (ปิด trigger ผู้ใช้ชั่วคราวเพราะ CHECK ต้อง issued_at < expires_at) / ช่างถูกปิดใช้โดย "session ยังไม่ถูกเพิกถอน" (worker_set_active เพิกถอน session ให้เอง จึงใช้ UPDATE ตรง — พิสูจน์ว่าด่านเช็ค is_active สดเอง)
create function pg_temp.expire_session(p_hash text) returns void language plpgsql as $c$
begin
  alter table analytics.worker_session disable trigger user;
  update analytics.worker_session set issued_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' where session_hash = p_hash;
  alter table analytics.worker_session enable trigger user;
end;
$c$;
create function pg_temp.deact_raw(p_worker uuid) returns void language plpgsql as $c$
begin
  alter table analytics.worker disable trigger user;
  update analytics.worker set is_active = false where id = p_worker;
  alter table analytics.worker enable trigger user;
end;
$c$;
create function pg_temp.dn(p_shop uuid, p_order uuid) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.production_order_done(%L, %L, null, %L, null)', p_shop, p_order, '{}'::jsonb)) $c$;
create function pg_temp.bind(p_shop uuid, p_item uuid, p_prod uuid) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.production_order_item_bind_product(%L, %L, %L, %L)', p_shop, p_item, p_prod, pg_temp.act())) $c$;
create function pg_temp.ack(p_shop uuid, p_po uuid) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.production_order_acknowledge(%L, %L, %L)', p_shop, p_po, pg_temp.act())) $c$;

-- ============================================================================
-- helper เรียก RPC ฝั่งช่าง (หน้างาน)
-- ============================================================================
create function pg_temp.rlclear(p jsonb) returns void language plpgsql as $c$
begin
  if coalesce(p ->> 'rl', '0') <> '1' then delete from analytics.worker_rate_limit; end if;
end;
$c$;
-- เปิดใบ: p = {idem product label metal purity weight qty planned due newd note ip gl(jsonb) ga gf(jsonb) rl}
create function pg_temp.opn(p_sess text, p jsonb, p_tokh text default null) returns jsonb
 language plpgsql as $c$
begin
  perform pg_temp.rlclear(p);
  return pg_temp.q(format('select analytics.job_worker_open(p_token_hash=>%L, p_session_hash=>%L, p_idem_key=>%L, p_product_id=>%L, p_pending_label=>%L, p_metal=>%L, p_purity=>%L, p_weight_g=>%L, p_qty_order=>%L, p_qty_planned=>%L, p_due_date=>%L, p_is_new_design=>%L, p_note=>%L, p_user_agent=>%L, p_ip_hash=>%L, p_gem_lines=>%L::jsonb, p_gem_answer=>%L, p_gem_force=>%L::jsonb)',
    coalesce(p_tokh, pg_temp.th()), p_sess, coalesce(p ->> 'idem', pg_temp.ik()), p ->> 'product', p ->> 'label', p ->> 'metal', p ->> 'purity', p ->> 'weight',
    coalesce(p ->> 'qty', '2'), p ->> 'planned', p ->> 'due', p ->> 'newd', p ->> 'note', 'verify-ua/1.0', p ->> 'ip', p -> 'gl', p ->> 'ga', p -> 'gf'));
end;
$c$;
-- เปิดใบแบบไม่มี SKU (เงิน) ที่ต้องสำเร็จ → คืนผล + {job, po}
create function pg_temp.go(p_sess text, p jsonb default '{}'::jsonb) returns jsonb
 language plpgsql as $c$
declare r jsonb;
begin
  r := pg_temp.opn(p_sess, case when p ? 'product' then p else jsonb_build_object('label', 'แหวน W3', 'metal', 'silver') || p end);
  if r ->> 'ok' is distinct from 'true' then raise exception 'go ล้ม: %', r::text; end if;
  return r || jsonb_build_object('job', pg_temp.jid(pg_temp.fx('A'), r ->> 'job_no'));
end;
$c$;
create function pg_temp.gst(p_sess text, p_job uuid, p_lines jsonb, p_rev text, p jsonb default '{}'::jsonb, p_tokh text default null) returns jsonb
 language plpgsql as $c$
begin
  perform pg_temp.rlclear(p);
  return pg_temp.q(format('select analytics.job_worker_gem_set(%L, %L, %L, %L::jsonb, %L, %L::jsonb, %L)', coalesce(p_tokh, pg_temp.th()), p_sess, p_job, p_lines, p_rev, p -> 'gf', p ->> 'ip'));
end;
$c$;
create function pg_temp.ggt(p_sess text, p_job uuid, p jsonb default '{}'::jsonb, p_tokh text default null) returns jsonb
 language plpgsql as $c$
begin
  perform pg_temp.rlclear(p);
  return pg_temp.q(format('select analytics.job_worker_gem_get(%L, %L, %L, %L)', coalesce(p_tokh, pg_temp.th()), p_sess, p_job, p ->> 'ip'));
end;
$c$;
create function pg_temp.gct(p_sess text, p_product uuid default null, p jsonb default '{}'::jsonb, p_tokh text default null) returns jsonb
 language plpgsql as $c$
begin
  perform pg_temp.rlclear(p);
  return pg_temp.q(format('select analytics.job_worker_gem_catalog(%L, %L, %L, %L)', coalesce(p_tokh, pg_temp.th()), p_sess, p ->> 'ip', p_product));
end;
$c$;
create function pg_temp.pmy(p_sess text, p jsonb default '{}'::jsonb, p_tokh text default null) returns jsonb
 language plpgsql as $c$
begin
  perform pg_temp.rlclear(p);
  return pg_temp.q(format('select analytics.job_worker_my_intake_list(%L, %L, %L)', coalesce(p_tokh, pg_temp.th()), p_sess, p ->> 'ip'));
end;
$c$;
create function pg_temp.pin_in(p_worker uuid, p_pin text, p_tokh text default null) returns jsonb
 language plpgsql as $c$
declare r jsonb;
begin
  r := pg_temp.q(format('select analytics.worker_pin_verify_intake(%L, %L, %L, %L, null)', coalesce(p_tokh, pg_temp.th()), p_worker, p_pin, 'verify-ua/1.0'));
  if (r ->> 'ok') = 'true' then r := r || jsonb_build_object('session_hash', analytics.job_sha256_hex(r ->> 'session_token')); end if;
  return r;
end;
$c$;
create function pg_temp.pin_job(p_tokh text, p_worker uuid, p_pin text) returns jsonb
 language plpgsql as $c$
declare r jsonb;
begin
  r := pg_temp.q(format('select analytics.worker_pin_verify(%L, %L, %L, %L, null)', p_tokh, p_worker, p_pin, 'verify-ua/1.0'));
  if (r ->> 'ok') = 'true' then r := r || jsonb_build_object('session_hash', analytics.job_sha256_hex(r ->> 'session_token')); end if;
  return r;
end;
$c$;
-- แถวพลอย (jsonb ตัดค่า null ออก): ชนิด+รูปทรง+ขนาด+จำนวน+ตำแหน่ง
create function pg_temp.gl(p_type uuid, p_shape uuid, p_a numeric, p_b numeric, p_qty int, p_pos text default null) returns jsonb
 language sql as $c$
  select jsonb_strip_nulls(jsonb_build_object('type_id', p_type, 'shape_id', p_shape, 'size_a', p_a, 'size_b', p_b, 'qty_per_piece', p_qty, 'position', p_pos)) $c$;
-- 2 แถวมาตรฐาน: โกเมน·ไข่·4×6 ×2 (ล้อมรอบ) + CZ·กลม·1.5 ×30
create function pg_temp.std2() returns jsonb language sql as $c$
  select jsonb_build_array(pg_temp.gl(pg_temp.fx('tG'), pg_temp.fx('sOval'), 4, 6, 2, 'ล้อมรอบ'), pg_temp.gl(pg_temp.fx('tC'), pg_temp.fx('sRound'), 1.5, null, 30)) $c$;
-- แถวที่พิมพ์ "ชนิดใหม่" n ชื่อ (ชื่อห่างกันไกล ไม่ชนตัวดักชื่อคล้าย) — p_off แยกชุดชื่อ · p_shapes = ใช้รูปทรงใหม่แทนชนิดใหม่ n ชื่อ
create function pg_temp.newnames(p_n int, p_off int, p_shapes boolean default false) returns jsonb language sql as $c$
  select jsonb_agg(case when p_shapes
    then jsonb_build_object('type_id', pg_temp.fx('tC'), 'new_shape', jsonb_build_object('name', 'S' || translate(md5(i::text || ':' || p_off::text), '0123456789', 'ghijklmnop'), 'has_length', false), 'size_a', 3, 'qty_per_piece', 1)
    else jsonb_build_object('new_type_name', 'N' || translate(md5(i::text || ':' || p_off::text), '0123456789', 'ghijklmnop'), 'shape_id', pg_temp.fx('sRound'), 'size_a', 3, 'qty_per_piece', 1) end)
    from generate_series(1, p_n) i $c$;
-- ชุดเคสแถวผิด → คืนรายการเคสที่ "ไม่ตรงคาด" (ว่าง = ตรงคาดทุกเคส) · p_call = 'open' | 'set' · เคส = {id, lines, code, row, field}
create function pg_temp.run_bad(p_call text, p_sess text, p_job uuid, p_rev text, p_cases jsonb) returns text
 language plpgsql as $c$
declare c jsonb; r jsonb; bad text := '';
begin
  for c in select value from jsonb_array_elements(p_cases) loop
    if p_call = 'open' then
      r := pg_temp.opn(p_sess, jsonb_build_object('label', 'แหวนผิด', 'metal', 'silver', 'ga', 'has', 'gl', c -> 'lines'));
    else
      r := pg_temp.gst(p_sess, p_job, c -> 'lines', p_rev);
    end if;
    if not (r ->> 'ok' = 'false' and r ->> 'code' = 'gem_line_invalid' and r ->> 'gem_code' = c ->> 'code'
            and (c ->> 'row' is null or r ->> 'gem_row' = c ->> 'row') and (c ->> 'field' is null or r ->> 'gem_field' = c ->> 'field')) then
      bad := bad || (c ->> 'id') || '=' || left(r::text, 120) || ' ; ';
    end if;
  end loop;
  return bad;
end;
$c$;

-- ============================================================================
-- A. setup (ร้านสังเคราะห์ ZZ191 A/B — insert public.shop + shop_member ตรง: ข้อยกเว้นที่ไม่ผ่าน RPC · บอกตรงๆ) · ที่เหลือผ่าน RPC ของระบบ
-- ============================================================================
create function pg_temp.g_setup() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  u1 uuid; u2 uuid;
  p uuid; r jsonb; j jsonb; s jsonb; it uuid;
begin
  insert into public.shop (id, name) values (a, 'ZZ TEST verify-0191 A'), (b, 'ZZ TEST verify-0191 B');
  perform pg_temp.setfx('A', a); perform pg_temp.setfx('B', b);
  -- ยืม auth user จริง (FK shop_member.user_id → auth.users) เป็น owner ของร้านสังเคราะห์ในทรานแซกชันนี้เท่านั้น (ผู้ตั้งราคา/แม่แบบ/แคตตาล็อกฝั่งออฟฟิศ)
  select m.user_id into u1 from public.shop_member m where m.role = 'owner' order by m.user_id limit 1;
  select m.user_id into u2 from public.shop_member m where m.role = 'owner' order by m.user_id desc limit 1;
  if u1 is null or u2 is null then
    raise exception 'setup: ต้องมี owner ใน shop_member จริงเพื่อยืมเป็นผู้ทำรายการ';
  end if;
  insert into public.shop_member (shop_id, user_id, role) values (a, u1, 'owner'), (b, u2, 'owner');
  perform pg_temp.setfx('u_owner', u1);
  perform analytics.job_stage_def_ensure(a); perform analytics.job_record_profile_ensure(a);
  perform analytics.job_stage_def_ensure(b); perform analytics.job_record_profile_ensure(b);
  perform analytics.gem_shape_ensure(a); perform analytics.gem_shape_ensure(b);
  -- SKU ร้าน A: pT มีแม่แบบพลอย · pN/pN2 ไม่มีแม่แบบ · ปิดใช้งาน · live* · ร้าน B
  p := analytics.product_upsert(a, 'ZZ191-T', 'แหวนมีแม่แบบพลอย', null, 'fixed', 88, null, null, null, 150, null, null, null, true); perform pg_temp.setfx('pT', p);
  p := analytics.product_upsert(a, 'ZZ191-N', 'แหวนไม่มีแม่แบบ N', null, 'fixed', 55, null, null, null, null, null, null, null, true); perform pg_temp.setfx('pN', p);
  p := analytics.product_upsert(a, 'ZZ191-N2', 'แหวนไม่มีแม่แบบ N2', null, 'fixed', 50, null, null, null, null, null, null, null, true); perform pg_temp.setfx('pN2', p);
  p := analytics.product_upsert(a, 'ZZ191-FIXB', 'แหวนสำหรับผูก SKU', null, 'fixed', 50, null, null, null, null, null, null, null, true); perform pg_temp.setfx('fixb', p);
  p := analytics.product_upsert(a, 'ZZ191-OFF', 'ปิดใช้งาน', null, 'fixed', 10, null, null, null, null, null, null, null, false); perform pg_temp.setfx('pOFF', p);
  p := analytics.product_upsert(a, 'live191', 'live sku', null, 'fixed', 10, null, null, null, null, null, null, null, true); perform pg_temp.setfx('pLIVE', p);
  p := analytics.product_upsert(b, 'ZZ191-B', 'SKU ร้าน B', null, 'fixed', 70, null, null, null, null, null, null, null, true); perform pg_temp.setfx('pB', p);
  -- ช่างร้าน A: wM/wM2 = ผู้จัดการ · wN = ช่างฝังทั่วไป (ไม่ใช่ผู้จัดการ) · ร้าน B: wMB
  r := pg_temp.wu(a, 'ZZ-M ผู้จัดการ', '2468', null, '{qc}', true, false);  perform pg_temp.sfx('wM', r);
  r := pg_temp.wu(a, 'ZZ-M2 ผู้จัดการสอง', '1357', null, '{qc,pack}', true, false); perform pg_temp.sfx('wM2', r);
  r := pg_temp.wu(a, 'ZZ-N ช่างฝัง', '8642', null, '{gem_set,qc}', null, null); perform pg_temp.sfx('wN', r);
  r := pg_temp.wu(b, 'ZZ-MB ผู้จัดการร้านอื่น', '3690', null, '{qc}', true, false); perform pg_temp.sfx('wMB', r);
  -- QR ร้าน A/B
  r := analytics.shop_intake_token_issue(a, pg_temp.act()); perform pg_temp.setkv('tokh_a', analytics.job_sha256_hex(r ->> 'token'));
  r := analytics.shop_intake_token_issue(b, pg_temp.act()); perform pg_temp.setkv('tokh_b', analytics.job_sha256_hex(r ->> 'token'));
  -- แคตตาล็อกพลอย (ผ่าน RPC ออฟฟิศ): ชนิด/รายการ/ราคา/แม่แบบ
  r := pg_temp.ccreate(a, 'type', 'โกเมน'); perform pg_temp.sfx('tG', r);
  r := pg_temp.ccreate(a, 'type', 'CZ'); perform pg_temp.sfx('tC', r);
  r := pg_temp.ccreate(a, 'type', 'Garnet'); perform pg_temp.sfx('tGa', r);
  r := pg_temp.ccreate(a, 'type', 'Amethyst'); perform pg_temp.sfx('tAm', r);
  r := pg_temp.ccreate(a, 'type', 'Opal'); perform pg_temp.sfx('tM1', r);
  r := pg_temp.ccreate(a, 'type', 'Zircon'); perform pg_temp.sfx('tM2', r);
  r := pg_temp.ccreate(a, 'type', 'Quartz'); perform pg_temp.sfx('tIn', r);
  r := pg_temp.ccreate(a, 'shape', 'Briolette', true); perform pg_temp.sfx('sBr', r);
  r := pg_temp.ccreate(b, 'type', 'ทับทิมบี'); perform pg_temp.sfx('tB', r);
  perform pg_temp.setfx('sOval', pg_temp.shp(a, 'ไข่')); perform pg_temp.setfx('sRound', pg_temp.shp(a, 'กลม')); perform pg_temp.setfx('sHeart', pg_temp.shp(a, 'หัวใจ'));
  perform pg_temp.setfx('sRoundB', pg_temp.shp(b, 'กลม'));
  r := pg_temp.icreate(a, jsonb_build_object('type_id', pg_temp.fx('tG'), 'shape_id', pg_temp.fx('sOval'), 'size_a', 4, 'size_b', 6, 'qty_per_piece', 1)); perform pg_temp.setfx('iG1', (r -> 'item' ->> 'gem_item_id')::uuid);
  r := pg_temp.icreate(a, jsonb_build_object('type_id', pg_temp.fx('tC'), 'shape_id', pg_temp.fx('sRound'), 'size_a', 1.5, 'qty_per_piece', 1)); perform pg_temp.setfx('iC1', (r -> 'item' ->> 'gem_item_id')::uuid);
  r := pg_temp.icreate(b, jsonb_build_object('type_id', pg_temp.fx('tB'), 'shape_id', pg_temp.fx('sRoundB'), 'size_a', 3, 'qty_per_piece', 1)); perform pg_temp.setfx('iB', (r -> 'item' ->> 'gem_item_id')::uuid);
  if pg_temp.fx('iG1') is null or pg_temp.fx('iC1') is null or pg_temp.fx('iB') is null then raise exception 'setup: สร้างรายการพลอยไม่ได้'; end if;
  perform pg_temp.price(a, pg_temp.fx('iG1'), pg_temp.px());
  perform pg_temp.price(a, pg_temp.fx('iC1'), '9999.9999');
  perform pg_temp.price(b, pg_temp.fx('iB'), '1234.5678');
  -- แม่แบบ SKU pT = [โกเมน·ไข่·4×6 ×2 ล้อมรอบ] + [CZ·กลม·1.5 ×30]
  r := pg_temp.tset(a, pg_temp.fx('pT'), jsonb_build_array(jsonb_build_object('gem_item_id', pg_temp.fx('iG1'), 'qty_per_piece', 2, 'position', 'ล้อมรอบ'), jsonb_build_object('gem_item_id', pg_temp.fx('iC1'), 'qty_per_piece', 30)));
  if r ? '_err' then raise exception 'setup: ตั้งแม่แบบ SKU ไม่ได้ %', r::text; end if;
  -- ใบงานออฟฟิศ (มีขั้นฝัง · ไม่มีพลอย) + QR ใบงาน — ใบออฟฟิศ (เป้าหมายต้องห้าม) + ทางล็อกอินของช่าง wN
  j := pg_temp.office_job(a, pg_temp.fx('pN2'));
  if j ->> 'job' is null then raise exception 'setup: สร้างใบงานออฟฟิศไม่ได้ %', j::text; end if;
  perform pg_temp.setfx('jOff', (j ->> 'job')::uuid);
  r := analytics.job_token_issue(a, pg_temp.fx('jOff'), null, pg_temp.act());
  perform pg_temp.setkv('jobtokh_a', analytics.job_sha256_hex(r ->> 'token'));
  -- session: M/M2/MB ล็อกอินที่ QR ร้าน · N ล็อกอินที่ QR ใบงาน (ไม่มีสิทธิ์เปิดใบ)
  s := pg_temp.pin_in(pg_temp.fx('wM'), '2468');  perform pg_temp.setkv('sM', s ->> 'session_hash');
  s := pg_temp.pin_in(pg_temp.fx('wM2'), '1357'); perform pg_temp.setkv('sM2', s ->> 'session_hash');
  s := pg_temp.pin_in(pg_temp.fx('wMB'), '3690', pg_temp.kv('tokh_b')); perform pg_temp.setkv('sMB', s ->> 'session_hash');
  s := pg_temp.pin_job(pg_temp.kv('jobtokh_a'), pg_temp.fx('wN'), '8642'); perform pg_temp.setkv('sN', s ->> 'session_hash');
  v := v || pg_temp.chk('S0', 'setup: ร้าน A/B · SKU 6+1 · ช่าง M/M2/N/MB · QR ร้าน · ชนิด/รูปทรง/รายการ + ราคาเลขแปลก + แม่แบบ pT (2 แถว) · ใบงานออฟฟิศ · session M/M2/MB/N ครบ',
    pg_temp.kv('sM') is not null and pg_temp.kv('sM2') is not null and pg_temp.kv('sMB') is not null and pg_temp.kv('sN') is not null
    and (select count(*) from analytics.product_gem_bom where product_id = pg_temp.fx('pT')) = 2 and pg_temp.n_price() >= 3);
  return v;
end;
$c$;


create function pg_temp.info(p_id text, p_txt text) returns text language sql as $c$ select format('[INFO] %s  %s', p_id, left(p_txt, 700)) || E'
' $c$;
create function pg_temp.sha(p text) returns text language sql as $c$ select analytics.job_sha256_hex(p) $c$;

create function pg_temp.g_qa1() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A');
  sM text := pg_temp.kv('sM'); sM2 text := pg_temp.kv('sM2'); sN text := pg_temp.kv('sN');
  wM uuid := pg_temp.fx('wM'); wM2 uuid := pg_temp.fx('wM2'); wN uuid := pg_temp.fx('wN');
  tG uuid := pg_temp.fx('tG'); tC uuid := pg_temp.fx('tC'); tGa uuid := pg_temp.fx('tGa'); tAm uuid := pg_temp.fx('tAm');
  sOval uuid := pg_temp.fx('sOval'); sRound uuid := pg_temp.fx('sRound'); sHeart uuid := pg_temp.fx('sHeart');
  iG1 uuid := pg_temp.fx('iG1'); iC1 uuid := pg_temp.fx('iC1');
  pT uuid := pg_temp.fx('pT'); pN uuid := pg_temp.fx('pN'); pN2 uuid := pg_temp.fx('pN2'); pT2 uuid; pT3 uuid;
  o jsonb; o2 jsonb; r jsonb; c jsonb; c2 jsonb; g jsonb; g2 jsonb; s jsonb; s2 jsonb; l jsonb; res jsonb; off jsonb; j uuid; j2 uuid;
  tokh text; sess text; ik text; sq int; n0 int; n1 int; child jsonb; txt text; e jsonb; nm text;
begin
  -- Q1: ครบวงจร hub → เปิดใบ SKU มีแม่แบบ ('template') → รายการของฉัน → W-10 get/แก้ → ช่างฝังเห็นใน resolve → ช่างขั้นแรกรับ → แก้ต่อไม่ได้ → ออฟฟิศเห็น
  begin
    c := pg_temp.gct(sM, pT);
    c2 := pg_temp.gct(sM, pN);
    v := v || pg_temp.chk('Q1a', 'catalog SKU มีแม่แบบ → has_template + template 2 แถว (ไม่มีราคา) · SKU ไม่มีแม่แบบ → false',
      c ->> 'ok' = 'true' and c ->> 'has_template' = 'true' and jsonb_array_length(c -> 'template') = 2 and not pg_temp.has_px(c) and c2 ->> 'has_template' = 'false' and jsonb_array_length(c2 -> 'template') = 0);
    o := pg_temp.go(sM, jsonb_build_object('product', pT, 'qty', 4, 'ga', 'template')); j := (o ->> 'job')::uuid;
    v := v || pg_temp.chk('Q1b', 'เปิดใบ SKU มีแม่แบบ ด้วย answer=template → ok · gem.count 2 · total (2+30)x4=128 · state specified · มีขั้นฝัง',
      o ->> 'ok' = 'true' and (o #>> '{gem,count}')::int = 2 and (o #>> '{gem,total}')::int = 128 and o #>> '{gem,state}' = 'specified' and pg_temp.has_stage(j));
    l := pg_temp.pmy(sM);
    e := (select x from jsonb_array_elements(l -> 'jobs') x where x ->> 'job_id' = j::text);
    v := v || pg_temp.chk('Q1c', 'hub "ใบที่ฉันเปิด": เห็นใบ · gem_state specified · gem_count 2 · gem_pieces 128 · gem_editable true',
      e is not null and e ->> 'gem_state' = 'specified' and (e ->> 'gem_count')::int = 2 and (e ->> 'gem_pieces')::int = 128 and e ->> 'gem_editable' = 'true');
    g := pg_temp.ggt(sM, j);
    v := v || pg_temp.chk('Q1d', 'W-10 get: ok · editable · 2 แถว · rev', g ->> 'ok' = 'true' and g ->> 'editable' = 'true' and jsonb_array_length(g -> 'lines') = 2 and g ->> 'rev' ~ '^[0-9a-f]{32}$' and g ->> 'has_gem_stage' = 'true');
    s := pg_temp.gst(sM, j, jsonb_build_array(
        jsonb_build_object('gem_item_id', g #>> '{lines,0,gem_item_id}', 'qty_per_piece', 3, 'position', 'ล้อมรอบ'),
        jsonb_build_object('type_id', tC, 'shape_id', sRound, 'size_a', 2, 'qty_per_piece', 10)), g ->> 'rev');
    v := v || pg_temp.chk('Q1e', 'W-10 แก้ (คงโกเมน เปลี่ยน 2→3 · ลบ CZ 1.5 · เพิ่ม CZ 2 มม. x10) → ok changed · count 2 · state specified · rev ใหม่ ≠ เดิม',
      s ->> 'ok' = 'true' and s ->> 'changed' = 'true' and (s ->> 'count')::int = 2 and s ->> 'state' = 'specified' and s ->> 'rev' <> g ->> 'rev' and not pg_temp.has_px(s));
    tokh := pg_temp.sha(o ->> 'token');
    r := pg_temp.pin_job(tokh, wN, '8642'); sess := r ->> 'session_hash';
    res := pg_temp.q(format('select analytics.job_worker_resolve(%L, %L, null)', tokh, sess));
    v := v || pg_temp.chk('Q1f', 'ช่างฝังเห็นพลอย "หลังแก้" ใน resolve: CZ · กลม · 2 มม. มี · 1.5 มม. หาย · ไม่มีราคา',
      res ->> 'ok' = 'true' and position('CZ · กลม · 2 มม.' in res::text) > 0 and position('CZ · กลม · 1.5 มม.' in res::text) = 0 and not pg_temp.has_px(res));
    r := pg_temp.rcv(a, j);
    v := v || pg_temp.chk('Q1g', 'ช่างขั้นแรกรับ (office_receive) สำเร็จ', pg_temp.received(j));
    s2 := pg_temp.gst(sM, j, g -> 'lines', s ->> 'rev');
    v := v || pg_temp.chk('Q1h', 'แก้ต่อหลังช่างรับ → job_locked (ไม่เขียน)', s2 ->> 'ok' = 'false' and s2 ->> 'code' = 'job_locked');
    g2 := pg_temp.ggt(sM, j);
    v := v || pg_temp.chk('Q1i', 'get หลังล็อก: ยังอ่านได้ 2 แถว · editable false · lock_code job_locked', g2 ->> 'ok' = 'true' and g2 ->> 'editable' = 'false' and g2 ->> 'lock_code' = 'job_locked' and jsonb_array_length(g2 -> 'lines') = 2);
    off := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, j));
    v := v || pg_temp.chk('Q1j', 'ออฟฟิศ job_gem_bom_get เห็นพลอยใบนี้: 2 แถว · window office_free · via shopfloor · history ≥ 2 (create + free_before_start)',
      jsonb_array_length(off -> 'lines') = 2 and off ->> 'window' = 'office_free' and not exists (select 1 from jsonb_array_elements(off -> 'lines') x where x ->> 'via' <> 'shopfloor')
      and jsonb_array_length(off -> 'history') >= 2 and off ->> 'state' = 'specified');
    raise notice 'QA_FIXTURE_GBG %', off::text;
    -- ออฟฟิศแก้ต่อได้ (ไม่พังเพราะผู้จัดการเคยแก้)
    s := pg_temp.oset(a, j, jsonb_build_array(jsonb_build_object('gem_item_id', off #>> '{lines,0,gem_item_id}', 'qty_per_piece', 5)), null);
    v := v || pg_temp.chk('Q1k', 'ออฟฟิศแก้พลอยต่อหลังช่างรับ (phase office_free · ไม่ต้องเหตุผล) → ok · ' || left(s::text, 80), s ->> 'ok' = 'true' or (s ? 'lines') or (s ? 'changed'));
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q1-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- Q3: แม่แบบ SKU ที่ชนิดถูกปิดใช้/รวมชื่อ — catalog แสดงอะไร · template answer ผ่านไหม
  begin
    pT2 := analytics.product_upsert(a, 'ZZ191-T2', 'แหวนแม่แบบ T2', null, 'fixed', 80, null, null, null, 150, null, null, null, true);
    r := pg_temp.icreate(a, jsonb_build_object('type_id', tAm, 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1));
    r := pg_temp.tset(a, pT2, jsonb_build_array(jsonb_build_object('gem_item_id', (r -> 'item' ->> 'gem_item_id')::uuid, 'qty_per_piece', 2), jsonb_build_object('gem_item_id', iC1, 'qty_per_piece', 5)));
    if r ? '_err' then raise exception 'setup T2: %', r::text; end if;
    r := pg_temp.sact(a, 'type', tAm, false);
    v := v || pg_temp.info('Q3-deact', left(r::text, 160));
    c := pg_temp.gct(sM, pT2);
    v := v || pg_temp.info('Q3-catalog', 'has_template=' || (c ->> 'has_template') || ' template_rows=' || coalesce(jsonb_array_length(c -> 'template')::text, 'null') || ' ' || left((c -> 'template')::text, 300));
    o := pg_temp.opn(sM, jsonb_build_object('product', pT2, 'ga', 'template', 'qty', 2));
    v := v || pg_temp.info('Q3-open-template', left(o::text, 400));
    -- ความสอดคล้อง: ถ้า catalog บอก has_template=false/แสดงน้อยกว่าแม่แบบจริง แต่ open template ผ่าน = จอกับ DB ไม่ตรงกัน
    v := v || pg_temp.chk('Q3x', 'ความสอดคล้อง catalog กับ open(template): จำนวนแถวแม่แบบที่แสดง = จำนวนแถวที่ได้ถ้า open สำเร็จ (หรือ open ปฏิเสธชัดเจน)',
      (o ->> 'ok' = 'false') or (o #>> '{gem,count}')::int = coalesce(jsonb_array_length(c -> 'template'), 0));
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q3-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- Q4: แม่แบบที่ชนิดถูกรวม (merge) ไปตัวอื่น
  begin
    pT3 := analytics.product_upsert(a, 'ZZ191-T3', 'แหวนแม่แบบ T3', null, 'fixed', 80, null, null, null, 150, null, null, null, true);
    r := pg_temp.icreate(a, jsonb_build_object('type_id', tAm, 'shape_id', sOval, 'size_a', 5, 'size_b', 7, 'qty_per_piece', 1));
    r := pg_temp.tset(a, pT3, jsonb_build_array(jsonb_build_object('gem_item_id', (r -> 'item' ->> 'gem_item_id')::uuid, 'qty_per_piece', 2)));
    if r ? '_err' then raise exception 'setup T3: %', r::text; end if;
    r := pg_temp.mrg(a, 'type', tAm, tGa);
    v := v || pg_temp.info('Q4-merge', left(r::text, 160));
    c := pg_temp.gct(sM, pT3);
    o := pg_temp.opn(sM, jsonb_build_object('product', pT3, 'ga', 'template', 'qty', 2));
    v := v || pg_temp.info('Q4-catalog', left((c -> 'template')::text, 300));
    v := v || pg_temp.info('Q4-open', left(o::text, 300));
    j := pg_temp.jid(a, o ->> 'job_no');
    v := v || pg_temp.chk('Q4a', 'แม่แบบที่ชนิดถูกรวม: catalog แสดงชื่อปลายทาง (Garnet) และ open(template) ได้ฉลากชื่อปลายทาง หรือปฏิเสธชัด',
      (o ->> 'ok' = 'false') or ((select string_agg(g3.gem_label, ',') from analytics.job_gem_bom g3 where g3.job_id = j) like 'Garnet%' and position('Garnet' in c::text) > 0));
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q4-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- Q5: แถวซ้ำ/ชื่อซ้ำในคำขอเดียว
  begin
    n0 := pg_temp.n_type(a);
    o := pg_temp.opn(sM, jsonb_build_object('label', 'แหวน Q5a', 'metal', 'silver', 'ga', 'has', 'gl', jsonb_build_array(
        jsonb_build_object('new_type_name', 'ทับทิมใหม่ซ้ำ', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1),
        jsonb_build_object('new_type_name', 'ทับทิมใหม่ซ้ำ', 'shape_id', sOval, 'size_a', 4, 'size_b', 6, 'qty_per_piece', 2))));
    v := v || pg_temp.chk('Q5a', 'ชื่อใหม่เดียวกัน 2 แถว (รูปทรงต่างกัน) → สร้างชนิดเดียว (+1) · 2 รายการ · ' || left(o::text, 120),
      o ->> 'ok' = 'true' and pg_temp.n_type(a) = n0 + 1 and (o #>> '{gem,count}')::int = 2 and jsonb_array_length(o #> '{gem,created_types}') = 1);
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q5a-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    o := pg_temp.opn(sM, jsonb_build_object('label', 'แหวน Q5b', 'metal', 'silver', 'ga', 'has', 'gl', jsonb_build_array(
        pg_temp.gl(tC, sRound, 1.5, null, 600), pg_temp.gl(tC, sRound, 1.5, null, 600))));
    v := v || pg_temp.info('Q5b-merge600x2', left(o::text, 300));
    if o ->> 'ok' = 'true' then
      v := v || pg_temp.chk('Q5b', 'รวมแถวซ้ำ 600+600 = 1200 > 1000: ต้องไม่ได้ qty เกิน 1000 ใน BOM',
        coalesce((select max(g4.qty_per_piece) from analytics.job_gem_bom g4 where g4.job_id = pg_temp.jid(a, o ->> 'job_no')), 0) <= 1000);
    else
      v := v || pg_temp.chk('Q5b', 'รวมแถวซ้ำ 600+600 = 1200 > 1000 → ปฏิเสธ (ok=false)', o ->> 'ok' = 'false');
    end if;
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q5b-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    o := pg_temp.opn(sM, jsonb_build_object('label', 'แหวน Q5c', 'metal', 'silver', 'ga', 'has', 'gl', jsonb_build_array(pg_temp.gl(tC, sRound, 1.5, null, 3, 'ก'), pg_temp.gl(tC, sRound, 1.5, null, 4, 'ก'))));
    v := v || pg_temp.chk('Q5c', 'แถวซ้ำ (ตำแหน่งเดียวกัน) → รวมเป็น 1 แถว qty 7 · merged_rows [[1,2]] · ' || left(o::text, 100),
      o ->> 'ok' = 'true' and (o #>> '{gem,count}')::int = 1 and o #> '{gem,merged_rows}' = '[[1,2]]'::jsonb
      and (select g5.qty_per_piece from analytics.job_gem_bom g5 where g5.job_id = pg_temp.jid(a, o ->> 'job_no')) = 7);
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q5c-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- Q6: force ปรับ normalize: ตัวพิมพ์/ช่องว่างเกิน ต่างจากที่พิมพ์ = ยังตรง · force ด้วยชื่อที่ "มีอยู่" แทนชื่อที่พิมพ์
  begin
    o := pg_temp.opn(sM, jsonb_build_object('label', 'แหวน Q6', 'metal', 'silver', 'ga', 'has', 'gl', jsonb_build_array(jsonb_build_object('new_type_name', 'Garnett', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1))));
    v := v || pg_temp.info('Q6-ask', left(o::text, 300));
    ik := pg_temp.ik();
    o := pg_temp.opn(sM, jsonb_build_object('idem', ik, 'label', 'แหวน Q6', 'metal', 'silver', 'ga', 'has', 'gl', jsonb_build_array(jsonb_build_object('new_type_name', 'Garnett', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1)),
        'gf', jsonb_build_array(jsonb_build_object('kind', 'type', 'name', 'Garnet'))));
    v := v || pg_temp.chk('Q6a', 'force ด้วยชื่อที่ "มีอยู่" (Garnet) แทนชื่อที่พิมพ์ (Garnett) → ยังถามต่อ (gem_similar) — ผู้เรียกต้องส่งชื่อที่พิมพ์ · ' || left(o::text, 100), o ->> 'code' = 'gem_similar');
    o := pg_temp.opn(sM, jsonb_build_object('idem', ik, 'label', 'แหวน Q6', 'metal', 'silver', 'ga', 'has', 'gl', jsonb_build_array(jsonb_build_object('new_type_name', 'Garnett', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1)),
        'gf', jsonb_build_array(jsonb_build_object('kind', 'type', 'name', '  GARNETT '))));
    v := v || pg_temp.chk('Q6b', 'ลอง key เดิม (ที่เคยล้ม gem_similar) + force ชื่อที่พิมพ์ต่างตัวพิมพ์/ช่องว่าง → ok (key ไม่ถูกเผาโดยครั้งที่ล้ม) · ' || left(o::text, 100), o ->> 'ok' = 'true' and o ->> 'already' = 'false');
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q6-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- Q8: ชื่อพลอยแปลกๆ
  begin
    foreach nm in array array[E'\U0001F48E', E'\U0001F48E\U0001F48E', E'ทับ​ทิม', E'ทับทิม‮', 'บลู โทแพซ', 'ทับทิมสยาม', repeat('ก', 40), repeat('ก', 41), 'Ruby/Spinel', 'ทับทิม (พม่า)', E'ทับทิม พม่า'] loop
      o := pg_temp.opn(sM, jsonb_build_object('label', 'แหวน Q8', 'metal', 'silver', 'ga', 'has', 'gl', jsonb_build_array(jsonb_build_object('new_type_name', nm, 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1)), 'rl', '0'));
      v := v || pg_temp.info('Q8 name=' || nm || ' len=' || char_length(nm), coalesce(o ->> 'code', 'OK') || ' gem_code=' || coalesce(o ->> 'gem_code', '-') || ' ' || coalesce(o ->> 'message', ''));
    end loop;
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q8-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- Q9: 'has' แล้วเปลี่ยนใจเป็น "ไม่มีพลอย" ทางมือถือ — ทำได้ไหม (ระบบไม่ลบขั้นฝังเอง · ล้างเหลือ 0 = unspecified ค้าง)
  begin
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน Q9', 'qty', 2, 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    g := pg_temp.ggt(sM, j);
    s := pg_temp.gst(sM, j, '[]'::jsonb, g ->> 'rev');
    g2 := pg_temp.ggt(sM, j);
    l := pg_temp.pmy(sM);
    e := (select x from jsonb_array_elements(l -> 'jobs') x where x ->> 'job_id' = j::text);
    v := v || pg_temp.chk('Q9', 'ล้างพลอย → ok count 0 state unspecified · ขั้นฝังยังอยู่ (has_gem_stage true) · hub gem_state unspecified (⚑ amber) — ทางมือถือกลับเป็น "ไม่มีพลอย" ไม่ได้ ต้องให้ออฟฟิศถอดขั้น',
      s ->> 'ok' = 'true' and (s ->> 'count')::int = 0 and s ->> 'state' = 'unspecified' and g2 ->> 'has_gem_stage' = 'true' and e ->> 'gem_state' = 'unspecified' and pg_temp.has_stage(j));
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q9-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- Q10: ชื่อใหม่จากมือถือ → ออฟฟิศเห็น (gem_catalog_list) · คนถัดไปเห็นใน catalog/ดรอปดาวน์ · ผู้จัดการคนที่ 2 พิมพ์ชื่อเดียวกัน = ใช้ตัวเดิม (ไม่ซ้ำ)
  begin
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน Q10', 'qty', 2, 'ga', 'has', 'gl', jsonb_build_array(jsonb_build_object('new_type_name', 'บุษราคัมคิว', 'new_shape', jsonb_build_object('name', 'ทรงใบมะกอก', 'has_length', true), 'size_a', 6, 'size_b', 3, 'qty_per_piece', 2))));
    off := pg_temp.q(format('select analytics.gem_catalog_list(%L, %L, false)', a, pg_temp.afor(a)));
    v := v || pg_temp.chk('Q10a', 'ออฟฟิศ gem_catalog_list เห็นชนิด/รูปทรง/รายการที่ผู้จัดการสร้าง · ราคา null (ยังไม่ตั้ง) · ' || coalesce(off ->> '_err', ''),
      position('บุษราคัมคิว' in off::text) > 0 and position('ทรงใบมะกอก' in off::text) > 0 and not (off ? '_err'));
    c := pg_temp.gct(sM2, null);
    v := v || pg_temp.chk('Q10b', 'ผู้จัดการอีกคน (M2) เห็นชื่อใหม่ใน catalog (types/shapes) + ขนาดที่เคยใช้ (chip)',
      position('บุษราคัมคิว' in (c -> 'types')::text) > 0 and position('ทรงใบมะกอก' in (c -> 'shapes')::text) > 0 and jsonb_array_length(c -> 'sizes') >= 1);
    n0 := pg_temp.n_type(a);
    o2 := pg_temp.go(sM2, jsonb_build_object('label', 'แหวน Q10b', 'qty', 2, 'ga', 'has', 'gl', jsonb_build_array(jsonb_build_object('new_type_name', 'บุษราคัมคิว', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1))));
    v := v || pg_temp.chk('Q10c', 'M2 พิมพ์ชื่อที่ M สร้างไว้ → ใช้ตัวเดิม (ไม่ซ้ำ n_type เท่าเดิม) · reused/ไม่ถูกถามว่าคล้าย · ' || left((o2 #> '{gem}')::text, 120),
      pg_temp.n_type(a) = n0 and o2 ->> 'ok' = 'true');
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q10-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- Q11: ใบ none ที่เปิดแล้ว → ใส่พลอยภายหลังไม่ได้ (no_gem_stage) และไม่มีราคา/key ต้องห้ามในทุกผลของ QA
  begin
    o := pg_temp.go(sM, jsonb_build_object('product', pT, 'qty', 2, 'ga', 'none')); j := (o ->> 'job')::uuid;
    g := pg_temp.ggt(sM, j);
    s := pg_temp.gst(sM, j, pg_temp.std2(), g ->> 'rev');
    v := v || pg_temp.chk('Q11', 'SKU มีแม่แบบ + none → ไม่มีขั้นฝัง · แก้พลอยทีหลัง = no_gem_stage · hub gem_state not_needed',
      not pg_temp.has_stage(j) and s ->> 'code' = 'no_gem_stage' and g ->> 'editable' = 'false' and g ->> 'lock_code' = 'no_gem_stage'
      and (select x ->> 'gem_state' from jsonb_array_elements(pg_temp.pmy(sM) -> 'jobs') x where x ->> 'job_id' = j::text) = 'not_needed');
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q11-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- Q12: p_gem_lines/force เป็น JSON null (ไม่ใช่ SQL null) · scalar แปลกๆ
  begin
    o := pg_temp.q(format('select analytics.job_worker_open(p_token_hash=>%L, p_session_hash=>%L, p_idem_key=>%L, p_pending_label=>%L, p_metal=>%L, p_qty_order=>2, p_gem_lines=>%L::jsonb, p_gem_answer=>%L)', pg_temp.th(), sM, pg_temp.ik(), 'แหวน Q12', 'silver', 'null', 'none'));
    v := v || pg_temp.chk('Q12a', 'none + p_gem_lines = JSON null → ปฏิเสธ gem_args_invalid (ไม่ผ่านเงียบ) · ' || left(o::text, 80), o ->> 'code' = 'gem_args_invalid');
    o := pg_temp.q(format('select analytics.job_worker_open(p_token_hash=>%L, p_session_hash=>%L, p_idem_key=>%L, p_pending_label=>%L, p_metal=>%L, p_qty_order=>2, p_gem_lines=>%L::jsonb, p_gem_answer=>%L, p_gem_force=>%L::jsonb)', pg_temp.th(), sM, pg_temp.ik(), 'แหวน Q12', 'silver', pg_temp.std2(), 'has', 'null'));
    v := v || pg_temp.chk('Q12b', 'has + p_gem_force = JSON null → gem_force_invalid · ' || left(o::text, 80), o ->> 'code' = 'gem_force_invalid');
    o := pg_temp.q(format('select analytics.job_worker_open(p_token_hash=>%L, p_session_hash=>%L, p_idem_key=>%L, p_pending_label=>%L, p_metal=>%L, p_qty_order=>2, p_gem_lines=>%L::jsonb, p_gem_answer=>%L)', pg_temp.th(), sM, pg_temp.ik(), 'แหวน Q12', 'silver', '"abc"', 'has'));
    v := v || pg_temp.chk('Q12c', 'has + lines เป็นสตริง JSON → gem_lines_required · ' || left(o::text, 80), o ->> 'code' = 'gem_lines_required');
    o := pg_temp.q(format('select analytics.job_worker_open(p_token_hash=>%L, p_session_hash=>%L, p_idem_key=>%L, p_pending_label=>%L, p_metal=>%L, p_qty_order=>2, p_gem_answer=>%L)', pg_temp.th(), sM, pg_temp.ik(), 'แหวน Q12', 'silver', ''));
    v := v || pg_temp.chk('Q12d', 'answer เป็นสตริงว่าง → gem_answer_invalid · ' || left(o::text, 80), o ->> 'code' = 'gem_answer_invalid');
    o := pg_temp.q(format('select analytics.job_worker_open(p_token_hash=>%L, p_session_hash=>%L, p_idem_key=>%L, p_pending_label=>%L, p_metal=>%L, p_qty_order=>2, p_gem_answer=>%L)', pg_temp.th(), sM, pg_temp.ik(), 'แหวน Q12', 'silver', 'HAS'));
    v := v || pg_temp.chk('Q12e', 'answer ตัวพิมพ์ใหญ่ (HAS) → gem_answer_invalid · ' || left(o::text, 80), o ->> 'code' = 'gem_answer_invalid');
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q12-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  return v;
end;
$c$;


create function pg_temp.g_qa2() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A');
  sM text := pg_temp.kv('sM'); sM2 text := pg_temp.kv('sM2');
  wM uuid := pg_temp.fx('wM');
  tC uuid := pg_temp.fx('tC'); sRound uuid := pg_temp.fx('sRound'); sOval uuid := pg_temp.fx('sOval');
  pT uuid := pg_temp.fx('pT'); pN uuid := pg_temp.fx('pN');
  o jsonb; o2 jsonb; r jsonb; g jsonb; g2 jsonb; s jsonb; l jsonb; child jsonb; j uuid; j2 uuid; sq int; n0 int; nm text; rec record; txt text; cnt int;
begin
  -- Q2 (retry): ใบที่แบ่งส่วนแล้ว
  begin
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน Q2', 'qty', 10, 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    r := pg_temp.rcv(a, j);
    select min(s2x.seq) into sq from analytics.job_stage s2x where s2x.job_id = j and s2x.status = 'received';
    child := pg_temp.q(format('select analytics.job_lot_split(%L, %L, %L, 4, 0, null, 10, %L, null)', a, j, sq, pg_temp.act()));
    v := v || pg_temp.info('Q2-split', coalesce(child ->> '_err', left(child::text, 200)) || ' seq=' || coalesce(sq::text, 'null'));
    select id into j2 from analytics.job where parent_job_id = j order by created_at limit 1;
    if j2 is null then
      v := v || pg_temp.chk('Q2-setup', 'แบ่งส่วนไม่สำเร็จ (setup) — ' || coalesce(child ->> '_err', child::text), false);
    else
      g := pg_temp.ggt(sM, j);
      v := v || pg_temp.chk('Q2a', 'parent หลังแบ่งส่วน: get อ่านได้ 2 แถว · editable false · lock job_locked', g ->> 'ok' = 'true' and jsonb_array_length(g -> 'lines') = 2 and g ->> 'editable' = 'false' and g ->> 'lock_code' = 'job_locked');
      s := pg_temp.gst(sM, j, g -> 'lines', g ->> 'rev');
      v := v || pg_temp.chk('Q2b', 'parent หลังแบ่งส่วน: set → job_locked', s ->> 'code' = 'job_locked');
      s := pg_temp.gst(sM, j2, '[]'::jsonb, 'empty');
      g2 := pg_temp.ggt(sM, j2);
      v := v || pg_temp.chk('Q2c', 'child: set + get → order_not_found ทั้งคู่ · BOM parent ไม่ขยับ (2) · child ไม่มี BOM', s ->> 'code' = 'order_not_found' and g2 ->> 'code' = 'order_not_found' and pg_temp.n_bom(j) = 2 and pg_temp.n_bom(j2) = 0);
      l := pg_temp.pmy(sM);
      v := v || pg_temp.chk('Q2d', 'hub: เห็น parent · ไม่เห็น child · gem_editable false · gem_count 2',
        exists (select 1 from jsonb_array_elements(l -> 'jobs') x where x ->> 'job_id' = j::text and x ->> 'gem_editable' = 'false' and (x ->> 'gem_count')::int = 2)
        and not exists (select 1 from jsonb_array_elements(l -> 'jobs') x where x ->> 'job_id' = j2::text));
      r := pg_temp.q(format('select analytics.job_gem_bom_get(%L, %L)', a, j2));
      v := v || pg_temp.chk('Q2e', 'ออฟฟิศ job_gem_bom_get(child) → พลอยของแม่ 2 แถว (ใช้ใน A5 ของส่วนย่อย) · ' || coalesce(r ->> '_err', ''), jsonb_array_length(r -> 'lines') = 2 and (r #>> '{job,id}') = j::text);
    end if;
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q2-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- Q13: ชื่อซ้ำที่ "หน้าตาเหมือน" แต่ byte ต่าง
  begin
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน Q13', 'ga', 'has', 'gl', jsonb_build_array(jsonb_build_object('new_type_name', 'ทับทิม พม่า', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1))));
    foreach nm in array array[E'ทับทิม พม่า', 'ทับทิม  พม่า', 'ทับทิมพม่า', 'ทับทิม พม่า ', 'cz', 'CZ ', 'C Z', E'ＣＺ', 'Ｃｚ', 'c.z.', E'ทับทิม พม่า', E'ทับทิม　พม่า'] loop
      n0 := pg_temp.n_type(a);
      o2 := pg_temp.opn(sM, jsonb_build_object('label', 'แหวน Q13b', 'metal', 'silver', 'ga', 'has', 'gl', jsonb_build_array(jsonb_build_object('new_type_name', nm, 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1)), 'rl', '0'));
      v := v || pg_temp.info('Q13 typed=' || nm, coalesce(o2 ->> 'code', 'OK') || ' types_added=' || (pg_temp.n_type(a) - n0) || ' ' || coalesce(left((o2 #> '{similar}')::text, 120), left((o2 #> '{gem,reused}')::text, 120), ''));
      if o2 ->> 'ok' = 'true' and pg_temp.n_type(a) - n0 = 1 and nm in (E'ทับทิม พม่า', 'ทับทิม  พม่า', 'ทับทิม พม่า ', 'cz', 'CZ ', E'ทับทิม พม่า', E'ทับทิม　พม่า') then
        v := v || pg_temp.chk('Q13x ' || nm, 'ชื่อซ้ำหลังตัด/ยุบ whitespace หรือตัวพิมพ์ต้องไม่ถูกสร้างเป็นชนิดใหม่ซ้ำ (typed=' || nm || ')', false);
      end if;
    end loop;
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q13-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- Q22: ใบจริงใน DB — helper ใหม่ไม่ raise กับข้อมูลจริงทุกแบบ
  begin
    cnt := 0; txt := '';
    for rec in select j3.id, j3.status from analytics.job j3 loop
      begin
        r := analytics.job_worker_gem_block(rec.id);
        cnt := cnt + 1;
        txt := txt || coalesce(r ->> 'code', 'free') || ',';
        perform analytics.job_gem_rev(rec.id);
      exception when others then
        v := v || pg_temp.chk('Q22-' || rec.id::text, 'job_worker_gem_block raise กับใบจริง: ' || sqlerrm, false);
      end;
    end loop;
    v := v || pg_temp.chk('Q22', 'job_worker_gem_block + job_gem_rev รันกับใบจริงทุกใบ (' || cnt || ' ใบ) ไม่ raise · ผล: ' || left(txt, 160), cnt = (select count(*) from analytics.job));
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q22-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- Q24: client ไม่ส่งคำตอบ (null) กับ SKU ไม่มีแม่แบบ → ผ่านโดยไม่ถูกถาม (ข้อจำกัดที่บันทึกไว้)
  begin
    o := pg_temp.opn(sM, jsonb_build_object('product', pN, 'qty', 2));
    v := v || pg_temp.info('Q24', 'null answer + SKU ไม่มีแม่แบบ → ok=' || coalesce(o ->> 'ok', '?') || ' stage=' || pg_temp.has_stage(pg_temp.jid(a, o ->> 'job_no'))::text);
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q24-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  return v;
end;
$c$;


create function pg_temp.g_qa3() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A');
  sM text := pg_temp.kv('sM');
  tC uuid := pg_temp.fx('tC'); sRound uuid := pg_temp.fx('sRound');
  o jsonb; g jsonb; s jsonb; j uuid; q text; n0 int; ik text; raw text;
  rec record;
begin
  -- Q14: ตัวเลขสุดขั้วในแถวพลอย (เปิดใบ) — ต้องได้ gem_line_invalid ที่แถว/ช่อง ไม่ใช่ error ระบบ (22003/22P02 หลุดเป็นข้อความกลาง) · ไม่มี PO ค้าง
  for rec in select * from (values
    ('q_1e21',   '{"type_id":"T","shape_id":"S","size_a":3,"qty_per_piece":1e21}', 'qty_invalid'),
    ('q_1e10',   '{"type_id":"T","shape_id":"S","size_a":3,"qty_per_piece":10000000000}', 'qty_invalid'),
    ('q_int_max','{"type_id":"T","shape_id":"S","size_a":3,"qty_per_piece":2147483648}', 'qty_invalid'),
    ('q_2.0',    '{"type_id":"T","shape_id":"S","size_a":3,"qty_per_piece":2.0}', 'OK'),
    ('q_1e2',    '{"type_id":"T","shape_id":"S","size_a":3,"qty_per_piece":1e2}', 'OK'),
    ('q_str5',   '{"type_id":"T","shape_id":"S","size_a":3,"qty_per_piece":"5"}', '?'),
    ('q_bool',   '{"type_id":"T","shape_id":"S","size_a":3,"qty_per_piece":true}', 'qty_invalid'),
    ('q_null',   '{"type_id":"T","shape_id":"S","size_a":3,"qty_per_piece":null}', 'qty_invalid'),
    ('q_arr',    '{"type_id":"T","shape_id":"S","size_a":3,"qty_per_piece":[1]}', 'qty_invalid'),
    ('s_1e30',   '{"type_id":"T","shape_id":"S","size_a":1e30,"qty_per_piece":1}', 'size_invalid'),
    ('s_1e-30',  '{"type_id":"T","shape_id":"S","size_a":1e-30,"qty_per_piece":1}', 'size_invalid'),
    ('s_0.001',  '{"type_id":"T","shape_id":"S","size_a":0.001,"qty_per_piece":1}', 'size_invalid'),
    ('s_100',    '{"type_id":"T","shape_id":"S","size_a":100,"qty_per_piece":1}', 'OK'),
    ('s_100.001','{"type_id":"T","shape_id":"S","size_a":100.001,"qty_per_piece":1}', 'size_invalid'),
    ('s_99.995', '{"type_id":"T","shape_id":"S","size_a":99.995,"qty_per_piece":1}', 'size_invalid'),
    ('s_str',    '{"type_id":"T","shape_id":"S","size_a":"3.5","qty_per_piece":1}', '?'),
    ('s_strcomma','{"type_id":"T","shape_id":"S","size_a":"3,5","qty_per_piece":1}', 'size_invalid'),
    ('s_bool',   '{"type_id":"T","shape_id":"S","size_a":true,"qty_per_piece":1}', 'size_invalid'),
    ('s_obj',    '{"type_id":"T","shape_id":"S","size_a":{"a":1},"qty_per_piece":1}', 'size_invalid'),
    ('pos_num',  '{"type_id":"T","shape_id":"S","size_a":3,"qty_per_piece":1,"position":5}', 'position_invalid'),
    ('tid_num',  '{"type_id":5,"shape_id":"S","size_a":3,"qty_per_piece":1}', '?'),
    ('tid_obj',  '{"type_id":{"x":1},"shape_id":"S","size_a":3,"qty_per_piece":1}', '?'),
    ('newshape_str', '{"type_id":"T","new_shape":"กลม","size_a":3,"qty_per_piece":1}', '?'),
    ('newshape_noname', '{"type_id":"T","new_shape":{"has_length":false},"size_a":3,"qty_per_piece":1}', '?'),
    ('both_type', '{"type_id":"T","new_type_name":"ใหม่ทดสอบ","shape_id":"S","size_a":3,"qty_per_piece":1}', '?'),
    ('both_item', '{"gem_item_id":"I","type_id":"T","shape_id":"S","size_a":3,"qty_per_piece":1}', '?'),
    ('no_type',  '{"shape_id":"S","size_a":3,"qty_per_piece":1}', 'type_required')
  ) as t(id, line, expect) loop
    begin
      raw := replace(replace(replace(rec.line, '"T"', '"' || tC::text || '"'), '"S"', '"' || sRound::text || '"'), '"I"', '"' || pg_temp.fx('iC1')::text || '"');
      n0 := (select count(*) from analytics.production_order where shop_id = a);
      o := pg_temp.opn(sM, jsonb_build_object('label', 'แหวน Q14', 'metal', 'silver', 'ga', 'has', 'gl', jsonb_build_array(raw::jsonb), 'rl', '0'));
      if o ? '_err' then
        v := v || pg_temp.chk('Q14 ' || rec.id, 'error ระบบหลุด (ไม่ใช่ gem_line_invalid): ' || (o ->> '_state') || ' ' || left(o ->> '_err', 120), false);
      else
        v := v || pg_temp.info('Q14 ' || rec.id, 'ok=' || coalesce(o ->> 'ok', '?') || ' code=' || coalesce(o ->> 'code', '-') || ' gem_code=' || coalesce(o ->> 'gem_code', '-') || ' field=' || coalesce(o ->> 'gem_field', '-') || ' expect=' || rec.expect);
        if rec.expect = 'OK' and o ->> 'ok' <> 'true' then v := v || pg_temp.chk('Q14e ' || rec.id, 'ควรผ่าน: ' || left(o::text, 150), false); end if;
        if rec.expect not in ('OK', '?') and (o ->> 'ok' = 'true' or o ->> 'gem_code' is distinct from rec.expect) then v := v || pg_temp.chk('Q14e ' || rec.id, 'ควรปฏิเสธ ' || rec.expect || ' ได้ ' || left(o::text, 150), false); end if;
        if o ->> 'ok' = 'false' and (select count(*) from analytics.production_order where shop_id = a) <> n0 then v := v || pg_temp.chk('Q14p ' || rec.id, 'ปฏิเสธแล้วแต่มี PO ค้าง', false); end if;
      end if;
      raise exception 'rb_qa';
    exception when others then
      if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q14-crash ' || rec.id, sqlstate || ' ' || sqlerrm, false); end if;
    end;
  end loop;

  -- Q15: ขนาดทศนิยมที่เท่ากัน (4.10 vs 4.1) → รวมเป็นแถวเดียว ไม่สร้างรายการซ้ำ
  begin
    o := pg_temp.opn(sM, jsonb_build_object('label', 'แหวน Q15', 'metal', 'silver', 'ga', 'has', 'gl', jsonb_build_array(
      jsonb_build_object('type_id', tC, 'shape_id', sRound, 'size_a', 4.10, 'qty_per_piece', 2), jsonb_build_object('type_id', tC, 'shape_id', sRound, 'size_a', 4.1, 'qty_per_piece', 3))));
    v := v || pg_temp.chk('Q15', 'size 4.10 กับ 4.1 = รายการเดียว รวมแถว (count 1 · merged_rows [[1,2]]) · ' || left(o::text, 120), o ->> 'ok' = 'true' and (o #>> '{gem,count}')::int = 1 and o #> '{gem,merged_rows}' = '[[1,2]]'::jsonb);
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q15-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- Q16: gem_set ด้วยตัวเลขสุดขั้ว (ผ่าน get → rev) — ไม่ใช่ error ระบบ
  begin
    o := pg_temp.go(sM, jsonb_build_object('label', 'แหวน Q16', 'qty', 2, 'ga', 'has', 'gl', pg_temp.std2())); j := (o ->> 'job')::uuid;
    g := pg_temp.ggt(sM, j);
    foreach q in array array['1e21', '2147483648', '1e2', '2.0'] loop
      s := pg_temp.gst(sM, j, jsonb_build_array(format('{"type_id":"%s","shape_id":"%s","size_a":3,"qty_per_piece":%s}', tC, sRound, q)::jsonb), g ->> 'rev');
      v := v || pg_temp.info('Q16 qty=' || q, 'ok=' || coalesce(s ->> 'ok', '?') || ' code=' || coalesce(s ->> 'code', '-') || ' gem_code=' || coalesce(s ->> 'gem_code', '-') || coalesce(' ERR ' || (s ->> '_state') || ' ' || left(s ->> '_err', 80), ''));
      if s ? '_err' then v := v || pg_temp.chk('Q16 ' || q, 'gem_set error ระบบหลุด: ' || (s ->> '_state'), false); end if;
    end loop;
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('Q16-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  return v;
end;
$c$;


do $qa$
declare v_msg text := E'
=== verify 0191 QA ===
'; v_fail int; v_ok int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    v_msg := v_msg || pg_temp.g_setup();
    v_msg := v_msg || pg_temp.g_qa1();
    v_msg := v_msg || pg_temp.g_qa2();
    v_msg := v_msg || pg_temp.g_qa3();
    raise exception 'QA_ROLLBACK';
  exception when others then
    if sqlerrm <> 'QA_ROLLBACK' then v_msg := v_msg || format('[FAIL] QA-crash  %s %s', sqlstate, sqlerrm) || E'
'; end if;
  end;
  v_fail := (length(v_msg) - length(replace(v_msg, '[FAIL]', ''))) / length('[FAIL]');
  v_ok := (length(v_msg) - length(replace(v_msg, '[OK]', ''))) / length('[OK]');
  v_msg := v_msg || format(E'
--- สรุป QA: OK %s · FAIL %s ---', v_ok, v_fail);
  raise exception '%', v_msg;
end;
$qa$;
