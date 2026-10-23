-- scripts/verify/verify-0191-qa-fixtures.sql — QA R2-D2 (23 ต.ค. 69) · ดึง payload จริงของ RPC หน้างานพลอย (0191) ออกมาเป็น NOTICE 'FX|ชื่อ|json' → ใช้สร้าง lib/jobs/gems-w3.db-contract.qa.fixtures.ts
-- self-rolling-back (ร้านสังเคราะห์ในทรานแซกชันที่ถอยเสมอ) · dry-run: ต่อ 0191_gems_w3.sql + ไฟล์นี้ (LF) แล้วรันไม่ใส่ --commit
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


create function pg_temp.fxo(p_name text, p jsonb) returns void language plpgsql as $c$
begin
  raise notice 'FX|%|%', p_name, p::text;
end;
$c$;
create function pg_temp.g_qa() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A');
  sM text := pg_temp.kv('sM');
  tC uuid := pg_temp.fx('tC'); tG uuid := pg_temp.fx('tG'); sRound uuid := pg_temp.fx('sRound'); sOval uuid := pg_temp.fx('sOval');
  pT uuid := pg_temp.fx('pT'); pN uuid := pg_temp.fx('pN');
  o jsonb; g jsonb; s jsonb; j uuid; r jsonb; ik text;
begin
  perform pg_temp.fxo('catalog_template', pg_temp.gct(sM, pT));
  perform pg_temp.fxo('catalog_notemplate', pg_temp.gct(sM, pN));
  ik := pg_temp.ik();
  o := pg_temp.opn(sM, jsonb_build_object('idem', ik, 'label', 'แหวน FX', 'metal', 'silver', 'qty', 3, 'planned', 4, 'ga', 'has', 'gl', jsonb_build_array(
        jsonb_build_object('new_type_name', 'บุษราคัมเอฟเอ็กซ์', 'new_shape', jsonb_build_object('name', 'ทรงใบมะกอกเอฟเอ็กซ์', 'has_length', true), 'size_a', 6, 'size_b', 3, 'qty_per_piece', 2, 'position', 'ล้อมรอบ'),
        pg_temp.gl(tC, sRound, 1.5, null, 30),
        pg_temp.gl(tC, sRound, 1.50, null, 5))));
  perform pg_temp.fxo('open_has', o);
  perform pg_temp.fxo('open_replay', pg_temp.opn(sM, jsonb_build_object('idem', ik, 'label', 'แหวน FX', 'metal', 'silver', 'qty', 3, 'ga', 'none', 'rl', '1')));
  j := pg_temp.jid(a, o ->> 'job_no');
  g := pg_temp.ggt(sM, j);
  perform pg_temp.fxo('get_open', g);
  s := pg_temp.gst(sM, j, jsonb_build_array(
        jsonb_build_object('gem_item_id', g #>> '{lines,0,gem_item_id}', 'qty_per_piece', 3, 'position', 'ล้อมรอบ'),
        jsonb_build_object('new_type_name', 'ทับทิมเอฟเอ็กซ์', 'shape_id', sRound, 'size_a', 2, 'qty_per_piece', 10),
        jsonb_build_object('new_type_name', 'Garnett', 'shape_id', sRound, 'size_a', 2, 'qty_per_piece', 10)), g ->> 'rev');
  perform pg_temp.fxo('set_similar', s);
  s := pg_temp.gst(sM, j, jsonb_build_array(
        jsonb_build_object('gem_item_id', g #>> '{lines,0,gem_item_id}', 'qty_per_piece', 3, 'position', 'ล้อมรอบ'),
        jsonb_build_object('new_type_name', 'ทับทิมเอฟเอ็กซ์', 'shape_id', sRound, 'size_a', 2, 'qty_per_piece', 10),
        jsonb_build_object('new_type_name', 'cz', 'shape_id', sRound, 'size_a', 2, 'qty_per_piece', 1)), g ->> 'rev');
  perform pg_temp.fxo('set_ok', s);
  perform pg_temp.fxo('set_bad_row', pg_temp.gst(sM, j, jsonb_build_array(pg_temp.gl(tC, sRound, 1.5, null, 1), pg_temp.gl(tC, sRound, 0, null, 1)), s ->> 'rev'));
  perform pg_temp.fxo('set_conflict', pg_temp.gst(sM, j, '[]'::jsonb, g ->> 'rev'));
  perform pg_temp.fxo('my_list', pg_temp.pmy(sM));
  o := pg_temp.opn(sM, jsonb_build_object('product', pT, 'qty', 2, 'ga', 'template'));
  perform pg_temp.fxo('open_template', o);
  perform pg_temp.fxo('open_none', pg_temp.opn(sM, jsonb_build_object('label', 'แหวน FX2', 'metal', 'silver', 'qty', 2, 'ga', 'none')));
  perform pg_temp.fxo('open_similar', pg_temp.opn(sM, jsonb_build_object('label', 'แหวน FX3', 'metal', 'silver', 'qty', 2, 'ga', 'has', 'gl', jsonb_build_array(jsonb_build_object('new_type_name', 'Garnett', 'shape_id', sRound, 'size_a', 3, 'qty_per_piece', 1)))));
  perform pg_temp.fxo('open_bad_row', pg_temp.opn(sM, jsonb_build_object('label', 'แหวน FX4', 'metal', 'silver', 'qty', 2, 'ga', 'has', 'gl', jsonb_build_array(pg_temp.gl(tC, sRound, 1.5, null, 1), pg_temp.gl(tC, sRound, 1.5, null, 0)))));
  perform pg_temp.fxo('open_template_required', pg_temp.opn(sM, jsonb_build_object('product', pN, 'qty', 2, 'ga', 'template')));
  perform pg_temp.fxo('open_noanswer_nostage', pg_temp.opn(sM, jsonb_build_object('label', 'แหวน FX5', 'metal', 'silver', 'qty', 2)));
  perform pg_temp.fxo('no_session', pg_temp.gct(null, null));
  return v;
end;
$c$;

do $qa$
declare v_msg text := E'\n=== QA W3 fixtures ===\n';
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    v_msg := v_msg || pg_temp.g_setup();
    v_msg := v_msg || pg_temp.g_qa();
    raise exception 'QA_ROLLBACK';
  exception when others then
    if sqlerrm <> 'QA_ROLLBACK' then v_msg := v_msg || format('[FAIL] QA-crash  %s %s', sqlstate, sqlerrm) || E'\n'; end if;
  end;
  raise exception '%', v_msg;
end;
$qa$;
