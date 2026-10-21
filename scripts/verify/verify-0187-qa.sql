-- scripts/verify/verify-0187-qa.sql
-- QA เสริมของ 0187 (R2-D2 · 21 ต.ค. 69) — ช่องที่ verify-0187 ไม่ครอบ: ใบงานแยกส่วน(L1)+ผูก SKU · A5/ชื่อแบบไม่เปลี่ยน · ใบผลิต/ใบงานออฟฟิศเดิม · ออฟฟิศแก้/ยกเลิกใบ shopfloor · input ขอบ (ไทย/emoji/ล่องหน/idem/ค้นหา)
--   · น้ำหนักทอง 7.771 ต้องไม่โผล่ในทุก RPC ฝั่งช่าง · hub 52 ผู้จัดการ · ล็อก PIN จากคนแปลกหน้า (DoS) · ถังจำกัดอัตราถูกเผาโดยคนไม่มี session · IDOR ข้ามร้านฝั่งออฟฟิศ · mutant 4 ตัวของเทสต์นี้เอง
-- self-rolling-back: ทุกกลุ่มอยู่ในซับบล็อกที่ raise rb_qa · จบด้วย raise exception เสมอ · อ่านผลจาก error message · [FAIL] >= 1 = ไม่ผ่าน · บรรทัด "INFO" = บันทึกพฤติกรรม (ไม่ได้บอกว่าผิด)
-- ใช้ helper/ฟิกซ์เจอร์ชุดเดียวกับ verify-0187.sql (ร้านสังเคราะห์ ZZ TEST · ผ่าน RPC ของระบบ) · ไม่แตะตัวนับเอกสารภาษี
-- dry-run ก่อน apply: ต่อไฟล์ migration 0187 + ไฟล์นี้ (LF) เป็นไฟล์เดียว แล้วรันไม่ใส่ --commit · หลัง apply: รันไฟล์นี้ตรงๆ ได้
-- ผลที่ได้ตอนเขียน (dry-run 0187 ยังไม่ apply): OK 82 · FAIL 0 (รวม S0 + INFO 8 บรรทัด)
set local statement_timeout = '30min';

create temp table _v187_fx (k text primary key, id uuid not null) on commit drop;
create temp table _v187_kv (k text primary key, v text not null) on commit drop;

create function pg_temp.chk(p_id text, p_desc text, p_ok boolean) returns text
 language sql as $c$
  select format('[%s] %s  %s', case when coalesce(p_ok, false) then 'OK' else 'FAIL' end, p_id, p_desc) || E'\n'
$c$;
create function pg_temp.fx(p_k text) returns uuid language sql as $c$ select id from _v187_fx where k = p_k $c$;
create function pg_temp.setfx(p_k text, p_id uuid) returns void language sql as $c$
  insert into _v187_fx (k, id) values (p_k, p_id) on conflict (k) do update set id = excluded.id $c$;
create function pg_temp.kv(p_k text) returns text language sql as $c$ select v from _v187_kv where k = p_k $c$;
create function pg_temp.setkv(p_k text, p_v text) returns void language sql as $c$
  insert into _v187_kv (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $c$;
create function pg_temp.act() returns uuid language sql as $c$ select '00000000-0000-0000-0000-0000000000a1'::uuid $c$;
create function pg_temp.std() returns text language sql as $c$ select '{wax_inject,wax_tree,invest_burnout,cast,cut_sprue,finish,buff,qc,pack}' $c$;
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
  select coalesce(string_agg(distinct k, ','), '') from pg_temp.keys_deep(j) k where k ~* '(cost|price|thb|margin|unit_cost|customer|target_piece_g|profit|buyer|client|quote_?no|po_?no|invoice|receipt|deposit|paid|grand_?total|subtotal|vat|tax_?id|phone|email|address|nre_|baht)' $c$;
create function pg_temp.ik() returns text language sql as $c$ select 'ik' || replace(gen_random_uuid()::text, '-', '') $c$;
create function pg_temp.ctr(p_shop uuid) returns text language sql as $c$
  select coalesce((select last_no from analytics.job_counter where shop_id = p_shop), 0) || '/' || coalesce((select last_no from analytics.production_order_counter where shop_id = p_shop), 0) $c$;
create function pg_temp.n_po(p_shop uuid) returns int language sql as $c$ select count(*)::int from analytics.production_order where shop_id = p_shop $c$;
create function pg_temp.n_job(p_shop uuid) returns int language sql as $c$ select count(*)::int from analytics.job where shop_id = p_shop $c$;
create function pg_temp.n_tok(p_shop uuid) returns int language sql as $c$ select count(*)::int from analytics.job_token where shop_id = p_shop $c$;
create function pg_temp.n_ev(p_shop uuid) returns int language sql as $c$ select count(*)::int from analytics.job_event where shop_id = p_shop $c$;
-- ภาพรวมสถานะของร้าน (ใช้เทียบว่า "ไม่มีอะไรเกิด")
create function pg_temp.shop_state(p_shop uuid) returns text language sql as $c$
  select pg_temp.n_po(p_shop) || '/' || pg_temp.n_job(p_shop) || '/' || pg_temp.n_tok(p_shop) || '/' || pg_temp.n_ev(p_shop) || '/' || pg_temp.ctr(p_shop)
         || '/' || (select count(*) from analytics.production_order_item where shop_id = p_shop) $c$;

create function pg_temp.th() returns text language sql as $c$ select pg_temp.kv('tokh_a') $c$;
-- เปิดใบผ่าน RPC (พารามิเตอร์เป็น jsonb: idem product label metal purity weight qty planned due newd note ip)
create function pg_temp.opn(p_sess text, p jsonb, p_tokh text default null) returns jsonb
 language plpgsql as $c$
begin
  -- ถังจำกัดอัตราต่อช่าง/ต่อ token นับทุกครั้งที่เรียก (รวมครั้งที่พารามิเตอร์ผิด — ตั้งใจ) ⇒ เคสที่วนยิงพารามิเตอร์ผิดหลายครั้งต้องล้างถังก่อน (fixture: DELETE ตรง — ยกเว้นที่บอกตรงๆ) · เคส rate limit ส่ง rl=1 เพื่อไม่ล้าง
  if coalesce(p ->> 'rl', '0') <> '1' then
    delete from analytics.worker_rate_limit where key like 'wo:%' or key like 'sio:%';
  end if;
  return pg_temp.q(format('select analytics.job_worker_open(p_token_hash=>%L, p_session_hash=>%L, p_idem_key=>%L, p_product_id=>%L, p_pending_label=>%L, p_metal=>%L, p_purity=>%L, p_weight_g=>%L, p_qty_order=>%L, p_qty_planned=>%L, p_due_date=>%L, p_is_new_design=>%L, p_note=>%L, p_user_agent=>%L, p_ip_hash=>%L)',
    coalesce(p_tokh, pg_temp.th()), p_sess, coalesce(p ->> 'idem', pg_temp.ik()), p ->> 'product', p ->> 'label', p ->> 'metal', p ->> 'purity', p ->> 'weight',
    coalesce(p ->> 'qty', '2'), p ->> 'planned', p ->> 'due', p ->> 'newd', p ->> 'note', 'verify-ua/1.0', p ->> 'ip'));
end;
$c$;
create function pg_temp.srch(p_sess text, p_q text, p_tokh text default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_product_search(%L, %L, %L, null)', coalesce(p_tokh, pg_temp.th()), p_sess, p_q)) $c$;
create function pg_temp.hub(p_sess text, p_tokh text default null, p_ip text default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.shop_intake_resolve(%L, %L, %L)', coalesce(p_tokh, pg_temp.th()), p_sess, p_ip)) $c$;
create function pg_temp.pin_in(p_worker uuid, p_pin text, p_tokh text default null, p_ip text default null) returns jsonb
 language plpgsql as $c$
declare r jsonb;
begin
  r := pg_temp.q(format('select analytics.worker_pin_verify_intake(%L, %L, %L, %L, %L)', coalesce(p_tokh, pg_temp.th()), p_worker, p_pin, 'verify-ua/1.0', p_ip));
  if (r ->> 'ok') = 'true' then r := r || jsonb_build_object('session_hash', analytics.job_sha256_hex(r ->> 'session_token')); end if;
  return r;
end;
$c$;
create function pg_temp.pin_job(p_tokh text, p_worker uuid, p_pin text, p_ip text default null) returns jsonb
 language plpgsql as $c$
declare r jsonb;
begin
  r := pg_temp.q(format('select analytics.worker_pin_verify(%L, %L, %L, %L, %L)', p_tokh, p_worker, p_pin, 'verify-ua/1.0', p_ip));
  if (r ->> 'ok') = 'true' then r := r || jsonb_build_object('session_hash', analytics.job_sha256_hex(r ->> 'session_token')); end if;
  return r;
end;
$c$;
create function pg_temp.wu(p_shop uuid, p_name text, p_pin text, p_id uuid default null, p_codes text default '{qc}', p_open boolean default null, p_ext boolean default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.worker_upsert(p_shop_id=>%L, p_id=>%L, p_display_name=>%L, p_stage_codes=>%L::text[], p_pin=>%L, p_actor=>%L, p_can_open_job=>%L, p_can_external=>%L)',
    p_shop, p_id, p_name, p_codes, p_pin, pg_temp.act(), p_open, p_ext)) $c$;
create function pg_temp.iset(p_shop uuid, p_order uuid, p_product uuid, p_qty int, p_label text default null, p_metal text default null, p_purity numeric default null, p_weight numeric default null, p_wsrc text default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.production_order_item_set(p_shop_id=>%L, p_production_order_id=>%L, p_product_id=>%L, p_qty_planned=>%L, p_pending_product_label=>%L, p_metal=>%L, p_purity=>%L, p_weight_g=>%L, p_weight_source=>%L)',
    p_shop, p_order, p_product, p_qty, p_label, p_metal, p_purity, p_weight, p_wsrc)) $c$;
create function pg_temp.po(p_shop uuid, p_note text default 'verify0187') returns uuid
 language sql as $c$ select (analytics.production_order_save(p_shop, null, p_note, null) ->> 'id')::uuid $c$;
-- ใบผลิตออฟฟิศ + รายการ + ใบงาน (สร้างผ่าน RPC ออฟฟิศเดิม) · คืน {po, item, job}
create function pg_temp.office_job(p_shop uuid, p_product uuid) returns jsonb
 language plpgsql as $c$
declare o uuid; r jsonb; j jsonb;
begin
  o := pg_temp.po(p_shop, 'office-v187');
  r := pg_temp.iset(p_shop, o, p_product, 1);
  j := pg_temp.q(format('select analytics.job_create_from_production_item(p_shop_id=>%L, p_production_order_item_id=>%L, p_stage_codes=>%L::text[], p_actor=>%L)',
    p_shop, r ->> 'id', pg_temp.std(), pg_temp.act()));
  return jsonb_build_object('po', o, 'item', r ->> 'id', 'job', j ->> 'job_id', 'job_no', j ->> 'job_no', 'err', j -> '_err');
end;
$c$;
create function pg_temp.sku_of(p_prod uuid) returns text language sql as $c$ select sku from public.product where id = p_prod $c$;
create function pg_temp.dn(p_shop uuid, p_order uuid) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.production_order_done(%L, %L, null, %L, null)', p_shop, p_order, '{}'::jsonb)) $c$;
create function pg_temp.bind(p_shop uuid, p_item uuid, p_prod uuid) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.production_order_item_bind_product(%L, %L, %L, %L)', p_shop, p_item, p_prod, pg_temp.act())) $c$;
create function pg_temp.ack(p_shop uuid, p_po uuid) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.production_order_acknowledge(%L, %L, %L)', p_shop, p_po, pg_temp.act())) $c$;
create function pg_temp.po_of(p_job_no text, p_shop uuid) returns uuid language sql as $c$
  select i.production_order_id from analytics.job j join analytics.production_order_item i on i.id = j.production_order_item_id where j.job_no = p_job_no and j.shop_id = p_shop $c$;
create function pg_temp.item_of(p_job_no text, p_shop uuid) returns uuid language sql as $c$
  select j.production_order_item_id from analytics.job j where j.job_no = p_job_no and j.shop_id = p_shop $c$;

-- ============================================================================
-- A. setup (ร้านสังเคราะห์ ZZ187 A/B — insert public.shop ตรงตามแพทเทิร์น verify-0144/0186: ข้อยกเว้นที่ไม่ผ่าน RPC · บอกตรงๆ) · ที่เหลือผ่าน RPC ของระบบ
-- ============================================================================
create function pg_temp.g_setup() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  p uuid; r jsonb; w uuid; j jsonb; s jsonb;
begin
  insert into public.shop (id, name) values (a, 'ZZ TEST verify-0187 A'), (b, 'ZZ TEST verify-0187 B');
  perform pg_temp.setfx('A', a); perform pg_temp.setfx('B', b);
  perform analytics.job_stage_def_ensure(a); perform analytics.job_record_profile_ensure(a);
  perform analytics.job_stage_def_ensure(b); perform analytics.job_record_profile_ensure(b);
  -- SKU ร้าน A
  p := analytics.product_upsert(a, 'ZZ187-FIXA', 'แหวนทดสอบ A', null, 'fixed', 88, null, null, null, 150, null, null, null, true); perform pg_temp.setfx('fixa', p);
  p := analytics.product_upsert(a, 'ZZ187-FIXB', 'แหวนทดสอบ B', null, 'fixed', 50, null, null, null, null, null, null, null, true); perform pg_temp.setfx('fixb', p);
  p := analytics.product_upsert(a, 'ZZ187-SPOT', 'spot 10g .925', null, 'spot', null, 10, 0.925, 20, 300, null, null, null, true); perform pg_temp.setfx('spot', p);
  p := analytics.product_upsert(a, 'ZZ187-W35', 'เงินมีน้ำหนัก 3.5', null, 'fixed', 60, 3.5, 0.925, null, null, null, null, null, true); perform pg_temp.setfx('w35', p);
  p := analytics.product_upsert(a, 'ZZ187-JT', 'ใบงานตั้งต้น (ออฟฟิศ)', null, 'fixed', 40, null, null, null, null, null, null, null, true); perform pg_temp.setfx('jt', p);
  p := analytics.product_upsert(a, 'ZZ187-FIXC', 'แหวนทดสอบ C', null, 'fixed', 55, null, null, null, null, null, null, null, true); perform pg_temp.setfx('fixc', p);
  p := analytics.product_upsert(a, 'live187', 'live sku', null, 'fixed', 10, null, null, null, null, null, null, null, true); perform pg_temp.setfx('live', p);
  p := analytics.product_upsert(a, 'ZZ187-OFF', 'ปิดใช้งาน', null, 'fixed', 10, null, null, null, null, null, null, null, false); perform pg_temp.setfx('off', p);
  p := analytics.product_upsert(b, 'ZZ187-BSKU', 'SKU ร้าน B', null, 'fixed', 70, null, null, null, null, null, null, null, true); perform pg_temp.setfx('bsku', p);
  -- ช่างร้าน A: M/M2 = ผู้จัดการ · N = ช่างทั่วไป · X = ผู้จัดการที่ถูกปิดใช้ภายหลัง · ร้าน B: MB
  r := pg_temp.wu(a, 'ZZ-M ผู้จัดการ', '2468', null, '{qc}', true, false);  perform pg_temp.setfx('wM', (r ->> 'id')::uuid);
  r := pg_temp.wu(a, 'ZZ-M2 ผู้จัดการสอง', '1357', null, '{qc,pack}', true, false); perform pg_temp.setfx('wM2', (r ->> 'id')::uuid);
  r := pg_temp.wu(a, 'ZZ-N ช่างทั่วไป', '8642', null, '{qc}', null, null); perform pg_temp.setfx('wN', (r ->> 'id')::uuid);
  r := pg_temp.wu(a, 'ZZ-X ผู้จัดการปิดใช้', '1111', null, '{qc}', true, false); perform pg_temp.setfx('wX', (r ->> 'id')::uuid);
  r := pg_temp.wu(b, 'ZZ-MB ผู้จัดการร้านอื่น', '3690', null, '{qc}', true, false); perform pg_temp.setfx('wMB', (r ->> 'id')::uuid);
  perform analytics.worker_set_active(a, pg_temp.fx('wX'), false, pg_temp.act());
  -- QR ร้าน A/B (คืนค่าดิบครั้งเดียว — เก็บแค่ hash ในชุดนี้)
  r := analytics.shop_intake_token_issue(a, pg_temp.act()); perform pg_temp.setkv('tok_a', r ->> 'token'); perform pg_temp.setkv('tokh_a', analytics.job_sha256_hex(r ->> 'token'));
  r := analytics.shop_intake_token_issue(b, pg_temp.act()); perform pg_temp.setkv('tok_b', r ->> 'token'); perform pg_temp.setkv('tokh_b', analytics.job_sha256_hex(r ->> 'token'));
  -- ใบงานตั้งต้นของออฟฟิศ (ผ่าน RPC ออฟฟิศเดิม) + QR ใบงาน — ใช้เป็นทาง /w/<token> เดิมในการเทียบ
  j := pg_temp.office_job(a, pg_temp.fx('jt'));
  if j ->> 'job' is null then raise exception 'setup: สร้างใบงานออฟฟิศไม่ได้ %', j::text; end if;
  perform pg_temp.setfx('jt_job', (j ->> 'job')::uuid); perform pg_temp.setfx('jt_po', (j ->> 'po')::uuid);
  r := analytics.job_token_issue(a, (j ->> 'job')::uuid, null, pg_temp.act());
  perform pg_temp.setkv('jobtok_a', r ->> 'token'); perform pg_temp.setkv('jobtokh_a', analytics.job_sha256_hex(r ->> 'token'));
  -- session: M/M2/MB ล็อกอินที่ QR ร้าน · N ล็อกอินที่ QR ใบงาน (N ไม่มีสิทธิ์เปิด — ใช้ทดสอบ "can_open_job=false")
  s := pg_temp.pin_in(pg_temp.fx('wM'), '2468');   perform pg_temp.setkv('sM', s ->> 'session_hash');
  s := pg_temp.pin_in(pg_temp.fx('wM2'), '1357');  perform pg_temp.setkv('sM2', s ->> 'session_hash');
  s := pg_temp.pin_in(pg_temp.fx('wMB'), '3690', pg_temp.kv('tokh_b')); perform pg_temp.setkv('sMB', s ->> 'session_hash');
  s := pg_temp.pin_job(pg_temp.kv('jobtokh_a'), pg_temp.fx('wN'), '8642'); perform pg_temp.setkv('sN', s ->> 'session_hash');
  v := v || pg_temp.chk('S0', 'setup: ร้าน A/B · SKU · ช่าง M/M2/N/X/MB · QR ร้าน A/B · ใบงานออฟฟิศตั้งต้น + QR ใบงาน · session M/M2/MB (ทางร้าน) + N (ทางใบงาน) ครบ',
    pg_temp.kv('sM') is not null and pg_temp.kv('sM2') is not null and pg_temp.kv('sMB') is not null and pg_temp.kv('sN') is not null and pg_temp.kv('jobtokh_a') is not null);
  return v;
end;
$c$;


create function pg_temp.jr(p_job_no text) returns jsonb language sql as $c$
  select to_jsonb(j) from analytics.job j where j.shop_id = pg_temp.fx('A') and j.job_no = p_job_no $c$;
create function pg_temp.por(p_po_no text) returns jsonb language sql as $c$
  select to_jsonb(p) from analytics.production_order p where p.shop_id = pg_temp.fx('A') and p.po_no = p_po_no $c$;
create function pg_temp.itr(p_po_no text) returns jsonb language sql as $c$
  select to_jsonb(i) from analytics.production_order_item i join analytics.production_order p on p.id = i.production_order_id where p.shop_id = pg_temp.fx('A') and p.po_no = p_po_no order by i.created_at limit 1 $c$;
create function pg_temp.today() returns date language sql as $c$ select analytics.job_today() $c$;

create function pg_temp.stock(p_product uuid) returns int
 language sql as $c$ select coalesce((select qty_on_hand from public.central_stock where product_id = p_product), 0) $c$;
create function pg_temp.lots(p_order uuid) returns int
 language sql as $c$ select count(*)::int from analytics.stock_lot l where l.production_order_item_id in (select i.id from analytics.production_order_item i where i.production_order_id = p_order) $c$;
create function pg_temp.done_md5() returns text
 language sql as $c$ select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = 'production_order_done' $c$;
-- md5 ของ production_order_done ที่ลอกจาก DB สดก่อนเขียน 0187 (20 ต.ค. 69) — ต้องไม่เปลี่ยนแม้ไบต์เดียว (ฟังก์ชัน 💰)
create function pg_temp.done_md5_before() returns text language sql as $c$ select '56cc6d4c97fa1e3feca56012bcf190f3'::text $c$;


-- ============================================================================
-- QA ad-hoc (R2-D2 21 ต.ค. 69) — ช่องที่ verify-0187 ไม่ครอบ · ทุกกลุ่มอยู่ในซับบล็อกที่ raise rb_qa เสมอ (ถอยกลับ)
-- ============================================================================
create function pg_temp.sp_ctx() returns text language sql as $c$ select 'ok' $c$;

-- ----- QA-A: ใบงานแยกส่วน (L1) แล้วผูก SKU · A5/ชื่อแบบไม่เปลี่ยน -----
create function pg_temp.qa_split_bind() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); sess text := pg_temp.kv('sM'); r jsonb; j jsonb; jb_id uuid; item uuid; po uuid; sq int;
  rc jsonb; s1 jsonb; s2 jsonb; c1 uuid; c2 uuid; cj jsonb; b jsonb; lbl text := 'แหวนแยกส่วน QA'; kids int; n_bound int; n_null int; s3 jsonb; c3 uuid; cx jsonb;
  lc jsonb; labels_ok boolean; sku text := 'ZZ187-FIXC'; ev int; x_err text; hold_n int; tr jsonb; dn jsonb; ak jsonb;
begin
  begin
    r := pg_temp.opn(sess, jsonb_build_object('label', lbl, 'metal', 'silver', 'qty', 6));
    if r ->> 'ok' <> 'true' then raise exception 'open ล้ม: %', r::text; end if;
    j := pg_temp.jr(r ->> 'job_no'); jb_id := (j ->> 'id')::uuid; item := (pg_temp.itr(r ->> 'order_no') ->> 'id')::uuid; po := (pg_temp.por(r ->> 'order_no') ->> 'id')::uuid;
    select min(s.seq) into sq from analytics.job_stage s where s.job_id = jb_id;
    rc := pg_temp.q(format('select analytics.job_office_receive(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_occurred_on=>%L, p_assignee_name=>%L, p_qty_received=>%L, p_actor=>%L)',
      a, jb_id, sq, analytics.job_today(), 'qa', 6, pg_temp.act()));
    if rc ? '_err' then raise exception 'receive ล้ม: %', rc::text; end if;
    s1 := pg_temp.q(format('select analytics.job_lot_split(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_qty=>%L, p_qty_scrap=>0, p_scrap_reason=>null, p_qty_hold=>%L, p_actor=>%L, p_weight_move_g=>null)',
      a, jb_id, sq, 2, 6, pg_temp.act()));
    if s1 ? '_err' then raise exception 'split1 ล้ม: %', s1::text; end if;
    s2 := pg_temp.q(format('select analytics.job_lot_split(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_qty=>%L, p_qty_scrap=>0, p_scrap_reason=>null, p_qty_hold=>%L, p_actor=>%L, p_weight_move_g=>null)',
      a, jb_id, sq, 1, 4, pg_temp.act()));
    if s2 ? '_err' then raise exception 'split2 ล้ม: %', s2::text; end if;
    select count(*) into kids from analytics.job where parent_job_id = jb_id;
    c1 := (s1 ->> 'lot_job_id')::uuid; c2 := (s2 ->> 'lot_job_id')::uuid;
    if c1 is null or c2 is null then select id into c1 from analytics.job where parent_job_id = jb_id and qty_planned = 2; select id into c2 from analytics.job where parent_job_id = jb_id and qty_planned = 1; end if;
    v := v || pg_temp.chk('QA-A1', format('เปิดจาก hub ไม่มี SKU -> รับ -> แยก 2 ส่วน: ส่วนย่อย %s · product_id ว่างทั้งแม่และส่วน', kids),
      kids = 2 and (select count(*) from analytics.job where (id = jb_id or parent_job_id = jb_id) and product_id is null) = 3);
    -- ยกเลิกส่วนที่สอง (คืนให้ผู้ถือเดิม) ก่อนผูก
    lc := pg_temp.q(format('select analytics.job_lot_cancel(p_shop_id=>%L, p_lot_job_id=>%L, p_reason=>%L, p_disposition=>%L, p_scrap_reason=>null, p_actor=>%L, p_scrap_weight_g=>null)', a, c2, 'qa', 'return_to_parent', pg_temp.act()));
    v := v || pg_temp.chk('QA-A2', 'ยกเลิกส่วนที่ 2 (return_to_parent) สำเร็จ ก่อนผูก SKU: ' || coalesce(lc ->> '_err', 'ok'), not (lc ? '_err'));
    b := pg_temp.bind(a, item, pg_temp.fx('fixc'));
    v := v || pg_temp.chk('QA-A3', format('ผูก SKU: ok · jobs_updated=%s (คาด 2 = แม่ + ส่วนที่ไม่ยกเลิก)', b ->> 'jobs_updated'), b ->> 'ok' = 'true' and (b ->> 'jobs_updated')::int = 2);
    select count(*) filter (where product_id = pg_temp.fx('fixc') and sku_snapshot = sku), count(*) filter (where product_id is null)
      into n_bound, n_null from analytics.job where id = jb_id or parent_job_id = jb_id;
    v := v || pg_temp.chk('QA-A4', format('แม่+ส่วนที่ 1 ได้ SKU (%s) · ส่วนที่ยกเลิก product_id ยังว่าง (%s) — ตามดีไซน์', n_bound, n_null), n_bound = 2 and n_null = 1 and (select status from analytics.job where id = c2) = 'cancelled' and (select product_id from analytics.job where id = c2) is null);
    select bool_and(design_label = lbl) into labels_ok from analytics.job where id = jb_id or parent_job_id = jb_id;
    v := v || pg_temp.chk('QA-A5', 'ชื่อแบบ (design_label) ของแม่/ส่วนทุกใบยังเป็นชื่อเดิมที่ช่างพิมพ์ ไม่ถูกทับด้วยชื่อ SKU', coalesce(labels_ok, false));
    -- A5 = ข้อมูลที่พิมพ์ได้จาก job: sku_snapshot + design_label (lib/jobs/print.ts) → ตรวจที่ตาราง/ view ตรงๆ
    select count(*) into ev from analytics.job_event where job_id in (jb_id, c1) and event_type = 'edit' and payload ->> 'field' = 'sku' and payload ->> 'after' = sku;
    v := v || pg_temp.chk('QA-A6', format('event edit field=sku บนแม่+ส่วนที่ 1 = %s ใบ (คาด 2) · ส่วนที่ยกเลิกไม่มี event · รายละเอียด: %s', ev,
      (select string_agg(case when e.job_id = jb_id then 'แม่' when e.job_id = c1 then 'ส่วน1' when e.job_id = c2 then 'ส่วน2(ยกเลิก)' else 'อื่น' end || ':' || e.event_type || ':' || coalesce(e.payload ->> 'field', '-'), ' | ')
         from analytics.job_event e where e.job_id in (jb_id, c1, c2) and e.event_type in ('edit', 'intake_open', 'ack'))), ev = 2 and not exists (select 1 from analytics.job_event where job_id = c2 and event_type = 'edit'));
    -- ต้นไม้ยังผ่านด่านหลังผูก + split ต่อหลังผูก ส่วนใหม่ต้องได้ SKU เดียวกับแม่ (ไม่ใช่ null)
    x_err := pg_temp.err(format('select analytics.job_tree_assert(%L)', jb_id));
    v := v || pg_temp.chk('QA-A7', 'job_tree_assert ต้นไม้หลังผูก SKU ผ่าน: ' || x_err, x_err = 'OK');
    select s.qty_in - s.qty_scrap - s.qty_split_out into hold_n from analytics.job_stage s where s.job_id = jb_id and s.seq = sq;
    s3 := pg_temp.q(format('select analytics.job_lot_split(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_qty=>%L, p_qty_scrap=>0, p_scrap_reason=>null, p_qty_hold=>%L, p_actor=>%L, p_weight_move_g=>null)',
      a, jb_id, sq, 1, hold_n, pg_temp.act()));
    select id into c3 from analytics.job where parent_job_id = jb_id and id not in (c1, c2);
    v := v || pg_temp.chk('QA-A8', 'แยกส่วนเพิ่มหลังผูก SKU: ส่วนใหม่ได้ product_id/sku_snapshot ตามแม่ (ไม่ใช่ null): ' || coalesce(s3 ->> '_err', 'ok') || ' · sku=' || coalesce((select sku_snapshot from analytics.job where id = c3), 'NULL'),
      not (s3 ? '_err') and (select sku_snapshot from analytics.job where id = c3) = sku and (select product_id from analytics.job where id = c3) = pg_temp.fx('fixc'));
    -- ปิดใบผลิตหลังผูก: ต้องรับทราบก่อน (shopfloor) → ack → done ไม่ล้มเพราะใบงานยังเดินอยู่ (done ไม่ตรวจใบงานเอง)
    dn := pg_temp.dn(a, po);
    v := v || pg_temp.chk('QA-A9', 'ผูกแล้วแต่ยังไม่ ack → done = ack_required (มีส่วนย่อยเดินอยู่ ไม่เปลี่ยนผล): ' || pg_temp.hint(dn), pg_temp.hint(dn) = '22023|ack_required');
    ak := pg_temp.ack(a, po);
    dn := pg_temp.dn(a, po);
    v := v || pg_temp.chk('QA-A10', 'ack แล้ว done ใบผลิต (ใบงานแยกส่วนยัง open อยู่ — ด่านเดิมไม่ตรวจใบงาน): ' || coalesce(dn ->> 'status', pg_temp.hint(dn)) || ' · lot=' || pg_temp.lots(po), ak ->> 'ok' = 'true' and dn ->> 'status' = 'done' and pg_temp.lots(po) = 1);
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('QA-A-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  return v;
end;
$c$;

-- ----- QA-B: ใบผลิตออฟฟิศเดิม · ฟอร์มสร้างใบงานออฟฟิศ · ออฟฟิศแก้/ยกเลิกใบ shopfloor · idem หลังยกเลิก -----
create function pg_temp.qa_office() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); o uuid; r jsonb; r2 jsonb; d jsonb; ak jsonb; j jsonb; st0 int; sess text := pg_temp.kv('sM'); w jsonb; it uuid; po2 uuid; tk jsonb;
  hub jsonb; po_no text; before_row analytics.production_order%rowtype; after_row analytics.production_order%rowtype; item_lbl uuid; sv jsonb; cn jsonb; rp jsonb; ik text := pg_temp.ik();
  jb jsonb; jid uuid; ack2 jsonb;
begin
  -- B1 ใบผลิตออฟฟิศเดิม เปิด -> ปิด · ไม่ติด ack
  begin
    st0 := pg_temp.stock(pg_temp.fx('fixa'));
    o := pg_temp.po(a, 'qa-office-B1');
    r := pg_temp.iset(a, o, pg_temp.fx('fixa'), 2);
    d := pg_temp.dn(a, o);
    v := v || pg_temp.chk('QA-B1a', 'ใบผลิตออฟฟิศ (opened_via default) เปิด -> done สำเร็จ ไม่ต้อง ack: ' || coalesce(d ->> 'status', pg_temp.hint(d)), d ->> 'status' = 'done');
    select * into after_row from analytics.production_order where id = o;
    v := v || pg_temp.chk('QA-B1b', 'opened_via=office · opened_by_worker_id ว่าง · acknowledged_at ว่าง · สต็อก +2', after_row.opened_via = 'office' and after_row.opened_by_worker_id is null and after_row.acknowledged_at is null and pg_temp.stock(pg_temp.fx('fixa')) = st0 + 2);
    ak := pg_temp.ack(a, o);
    v := v || pg_temp.chk('QA-B1c', 'ack ใบออฟฟิศ -> ปฏิเสธ not_shopfloor: ' || pg_temp.hint(ak), pg_temp.hint(ak) = '22023|not_shopfloor');
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('QA-B1-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  -- B2 ใบออฟฟิศมีรายการไม่มี SKU (0186) -> done ตก sku_required -> ผูก SKU -> done ผ่านโดยไม่ ack
  begin
    o := pg_temp.po(a, 'qa-office-B2');
    r := pg_temp.iset(a, o, pg_temp.fx('fixb'), 1);
    r2 := pg_temp.iset(a, o, null, 2, 'แบบรอผูก QA', 'silver');
    d := pg_temp.dn(a, o);
    v := v || pg_temp.chk('QA-B2a', 'ใบออฟฟิศมีรายการไม่มี SKU: done = sku_required ตามเดิม (0186): ' || pg_temp.hint(d), pg_temp.hint(d) = '22023|sku_required');
    ak := pg_temp.bind(a, (r2 ->> 'id')::uuid, pg_temp.fx('fixc'));
    v := v || pg_temp.chk('QA-B2b', 'ผูก SKU ให้รายการในใบออฟฟิศ: ok (ไม่มีใบงาน jobs_updated=0): ' || coalesce(ak ->> '_err', ak ->> 'jobs_updated'), ak ->> 'ok' = 'true' and (ak ->> 'jobs_updated')::int = 0);
    d := pg_temp.dn(a, o);
    v := v || pg_temp.chk('QA-B2c', 'หลังผูก: done สำเร็จโดยไม่ต้อง ack (ใบ office): ' || coalesce(d ->> 'status', pg_temp.hint(d)), d ->> 'status' = 'done');
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('QA-B2-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  -- B3 ฟอร์มสร้างใบงานออฟฟิศ (wrapper เดิม) ใส่ arg ครบ · ผู้รับผิดชอบ = actor ไม่ใช่ช่าง
  begin
    o := pg_temp.po(a, 'qa-office-B3');
    r := pg_temp.iset(a, o, pg_temp.fx('fixa'), 3);
    j := pg_temp.q(format('select analytics.job_create_from_production_item(p_shop_id=>%L, p_production_order_item_id=>%L, p_stage_codes=>%L::text[], p_due_date=>%L, p_design_label=>%L, p_note=>%L, p_actor=>%L, p_qty_planned=>%L)',
      a, r ->> 'id', pg_temp.std(), analytics.job_today() + 5, 'แบบกำหนดเอง QA 💍', 'หมายเหตุ QA', pg_temp.act(), 5));
    jid := (j ->> 'job_id')::uuid;
    v := v || pg_temp.chk('QA-B3a', 'wrapper ออฟฟิศ: สร้างใบงานสำเร็จ · เผื่อ planned 5 จากสั่ง 3: ' || coalesce(j ->> '_err', j ->> 'job_no'), jid is not null);
    select to_jsonb(x) into jb from analytics.job x where x.id = jid;
    v := v || pg_temp.chk('QA-B3b', 'created_by = actor · opened_by_worker_id ว่าง · qty_order 3 / planned 5 · ชื่อแบบ/due ตามที่ส่ง',
      (jb ->> 'created_by')::uuid = pg_temp.act() and jb -> 'opened_by_worker_id' = 'null'::jsonb and (jb ->> 'qty_order')::int = 3 and (jb ->> 'qty_planned')::int = 5 and jb ->> 'design_label' = 'แบบกำหนดเอง QA 💍' and (jb ->> 'due_date')::date = analytics.job_today() + 5);
    tk := analytics.job_token_issue(a, jid, null, pg_temp.act());
    v := v || pg_temp.chk('QA-B3c', 'QR ใบงานออฟฟิศ: issued_by=actor · issued_by_worker_id ว่าง · token 43 ตัว',
      length(tk ->> 'token') = 43 and (select issued_by from analytics.job_token where job_id = jid order by issued_at desc limit 1) = pg_temp.act() and (select issued_by_worker_id from analytics.job_token where job_id = jid order by issued_at desc limit 1) is null);
    j := pg_temp.q(format('select analytics.job_create_from_production_item(p_shop_id=>%L, p_production_order_item_id=>%L, p_stage_codes=>%L::text[], p_actor=>%L)', a, r ->> 'id', pg_temp.std(), pg_temp.act()));
    v := v || pg_temp.chk('QA-B3d', 'สร้างซ้ำบนรายการเดิม -> job_exists: ' || pg_temp.hint(j), pg_temp.hint(j) = '22023|job_exists');
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('QA-B3-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  -- B4 ออฟฟิศแก้ใบที่ผู้จัดการเปิด (note · เพิ่มรายการ · ยกเลิก) ต้องไม่หลุดล็อก opened_via/ผู้เปิด/ack
  begin
    r := pg_temp.opn(sess, jsonb_build_object('label', 'ใบ shopfloor ให้ออฟฟิศแก้ QA', 'metal', 'silver', 'qty', 2, 'idem', ik));
    po_no := r ->> 'order_no'; o := (pg_temp.por(po_no) ->> 'id')::uuid;
    select * into before_row from analytics.production_order where id = o;
    sv := pg_temp.q(format('select analytics.production_order_save(%L, %L, %L, null)', a, o, 'ออฟฟิศแก้หมายเหตุ'));
    select * into after_row from analytics.production_order where id = o;
    v := v || pg_temp.chk('QA-B4a', 'production_order_save แก้ note ของใบ shopfloor: ' || coalesce(sv ->> '_err', 'ok') || ' · opened_via/ผู้เปิด/idem/ack ไม่เปลี่ยน',
      not (sv ? '_err') and after_row.note = 'ออฟฟิศแก้หมายเหตุ' and after_row.opened_via = before_row.opened_via and after_row.opened_by_worker_id is not distinct from before_row.opened_by_worker_id
      and after_row.intake_idem_key is not distinct from before_row.intake_idem_key and after_row.acknowledged_at is null);
    r2 := pg_temp.iset(a, o, pg_temp.fx('fixb'), 1);
    v := v || pg_temp.chk('QA-B4b', 'ออฟฟิศเพิ่มรายการ SKU ใบ shopfloor (ใบมี 2 รายการ): ' || coalesce(r2 ->> '_err', 'ok'), not (r2 ? '_err'));
    d := pg_temp.dn(a, o);
    v := v || pg_temp.chk('QA-B4c', 'ยังไม่ ack: done ตก ack_required (ใบมีรายการไม่มี SKU ด้วย — ด่านไหนตกก่อนก็ต้องไม่ผ่าน): ' || pg_temp.hint(d), pg_temp.hint(d) in ('22023|ack_required', '22023|sku_required'));
    -- ยกเลิกใบ shopfloor ที่ยังไม่ ack (ด่านปิดต้องไม่บล็อกการยกเลิก)
    cn := pg_temp.q(format('select analytics.production_order_cancel(%L, %L, %L)', a, o, 'qa ยกเลิก'));
    v := v || pg_temp.chk('QA-B4d', 'ยกเลิกใบ shopfloor ที่ยังไม่ ack = ผ่าน (ด่านปิดคุม open->done เท่านั้น): ' || coalesce(cn ->> '_err', cn ->> 'status', 'ok'), not (cn ? '_err') and (select status from analytics.production_order where id = o) = 'cancelled');
    ack2 := pg_temp.ack(a, o);
    v := v || pg_temp.chk('QA-B4e', 'ack ใบที่ยกเลิกแล้ว -> order_not_open: ' || pg_temp.hint(ack2), pg_temp.hint(ack2) = '22023|order_not_open');
    -- idem: กดซ้ำหลังใบถูกยกเลิก = ได้ "already" ของใบเดิม (บันทึกพฤติกรรม — ไม่ได้ผิด/ถูก)
    rp := pg_temp.opn(sess, jsonb_build_object('label', 'ใบ shopfloor ให้ออฟฟิศแก้ QA', 'metal', 'silver', 'qty', 2, 'idem', ik));
    v := v || pg_temp.chk('QA-B4f', 'INFO idem เดิมหลังยกเลิกใบ: already=' || coalesce(rp ->> 'already', rp::text) || ' job_no=' || coalesce(rp ->> 'job_no', '-') || ' (ไม่มี token · ไม่เปิดใบใหม่)', rp ->> 'already' = 'true' and not (rp ? 'token'));
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('QA-B4-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  return v;
end;
$c$;

-- ----- QA-C: input ขอบ (ไทย/emoji/ยาว/ล่องหน/idem/ค้นหา) + ไม่มีเงินใน response -----
create function pg_temp.qa_input() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); sess text := pg_temp.kv('sM'); r jsonb; r2 jsonb; l200 text := repeat('ก', 200); l201 text := repeat('ก', 201); allr jsonb := '[]'::jsonb; n int;
  ik1 text; res jsonb; code text; lbls text[]; x text; badk text; p uuid;
begin
  begin
    -- C1 ความยาวชื่อแบบ 200/201 (ตัวอักษรไทย) · emoji · ช่องว่างหลายแบบ
    r := pg_temp.opn(sess, jsonb_build_object('label', l200, 'metal', 'silver')); allr := allr || r;
    r2 := pg_temp.opn(sess, jsonb_build_object('label', l201, 'metal', 'silver')); allr := allr || r2;
    v := v || pg_temp.chk('QA-C1', format('ชื่อแบบ 200 ตัวอักษรไทยผ่าน (%s) · 201 = name_invalid (%s)', coalesce(r ->> 'ok', r::text), coalesce(r2 ->> 'code', r2::text)), r ->> 'ok' = 'true' and r2 ->> 'code' = 'name_invalid');
    r := pg_temp.opn(sess, jsonb_build_object('label', '💍แหวนเงิน💎 ทดสอบ', 'metal', 'silver')); allr := allr || r;
    v := v || pg_temp.chk('QA-C2', 'ชื่อแบบมี emoji + ไทย ผ่านและเก็บตรงตัว: ' || coalesce(r ->> 'design_label', r::text), r ->> 'ok' = 'true' and r ->> 'design_label' = '💍แหวนเงิน💎 ทดสอบ');
    lbls := array[E'　', E' ', E'​', E' 　 ', E'ก​ข', E'ก‮ข', E'ก\tข', E'ก\nข', E'<b>x</b>', E'﻿'];
    n := 0; code := '';
    foreach x in array lbls loop
      r := pg_temp.opn(sess, jsonb_build_object('label', x, 'metal', 'silver')); allr := allr || r;
      if r ->> 'ok' = 'true' then n := n + 1; code := code || format(' [ผ่าน: %s]', encode(convert_to(x, 'UTF8'), 'hex')); end if;
    end loop;
    v := v || pg_temp.chk('QA-C3', 'ชื่อแบบอักขระแปลก (ideographic space · NBSP · ZWSP · ZWSP กลางคำ · RLO · tab · newline · <b> · BOM) ถูกปฏิเสธทั้งหมด — ผ่านเข้ามา ' || n || ' ตัว' || code, n = 0);
    -- C4 idem key รูปแบบ
    n := 0; code := '';
    foreach x in array array['abc', repeat('a', 15), repeat('a', 65), repeat('a', 16) || ' ', repeat('ก', 20), repeat('a', 20) || E'\n', repeat('a', 20) || '!'] loop
      r := pg_temp.opn(sess, jsonb_build_object('label', 'idem ผิดรูป', 'metal', 'silver', 'idem', x)); allr := allr || r;
      if r ->> 'code' is distinct from 'idem_invalid' then n := n + 1; code := code || ' [' || left(x, 10) || ' -> ' || coalesce(r ->> 'code', 'ok') || ']'; end if;
    end loop;
    v := v || pg_temp.chk('QA-C4', 'idem key ผิดรูป (3 ตัว · 15 · 65 · ท้ายเว้นวรรค · ไทย · ท้าย \n · !) = idem_invalid ทั้งหมด — หลุด ' || n || code, n = 0);
    r := pg_temp.opn(sess, jsonb_build_object('label', 'idem 16', 'metal', 'silver', 'idem', repeat('b', 16))); allr := allr || r;
    r2 := pg_temp.opn(sess, jsonb_build_object('label', 'idem 64', 'metal', 'silver', 'idem', repeat('c', 64))); allr := allr || r2;
    v := v || pg_temp.chk('QA-C5', 'idem ขอบ 16 และ 64 ตัวผ่าน', r ->> 'ok' = 'true' and r2 ->> 'ok' = 'true');
    -- C6 idem เดิม ข้อมูลต่าง = ได้ใบเดิม (qty เดิม ไม่ใช่ qty ใหม่ · ไม่สร้างใบใหม่)
    ik1 := pg_temp.ik();
    r := pg_temp.opn(sess, jsonb_build_object('label', 'idem payload A', 'metal', 'silver', 'qty', 2, 'idem', ik1)); allr := allr || r;
    n := pg_temp.n_po(a);
    r2 := pg_temp.opn(sess, jsonb_build_object('label', 'payload B ต่างกัน', 'metal', 'gold', 'purity', 0.75, 'qty', 9, 'idem', ik1)); allr := allr || r2;
    v := v || pg_temp.chk('QA-C6', format('INFO idem เดิม payload ต่าง: คืนใบเดิม already=%s qty_order=%s metal=%s (ไม่สร้างใบใหม่ PO ก่อน/หลัง %s/%s) · ไม่ตรวจว่า payload ตรงกัน', r2 ->> 'already', r2 ->> 'qty_order', r2 ->> 'metal', n, pg_temp.n_po(a)),
      r2 ->> 'already' = 'true' and (r2 ->> 'qty_order')::int = 2 and r2 ->> 'metal' = 'silver' and pg_temp.n_po(a) = n);
    -- C7 ค้นหา: wildcard / ความยาว / ว่าง / ไทย / emoji / live*
    p := analytics.product_upsert(a, 'LIVERING-01', 'แหวนชื่อขึ้นต้นด้วย live', null, 'fixed', 10, null, null, null, null, null, null, null, true);
    p := analytics.product_upsert(a, 'ZZ187-LIVEX', 'แหวนมี live ตรงกลาง', null, 'fixed', 10, null, null, null, null, null, null, null, true);
    res := pg_temp.srch(sess, '%'); allr := allr || res;
    v := v || pg_temp.chk('QA-C7a', 'ค้น "%" = ไม่ดึงทั้งแคตตาล็อก (escape LIKE): ' || jsonb_array_length(res -> 'items') || ' แถว', res ->> 'ok' = 'true' and jsonb_array_length(res -> 'items') = 0);
    res := pg_temp.srch(sess, '_'); allr := allr || res;
    v := v || pg_temp.chk('QA-C7b', 'ค้น "_" = ไม่ใช่ any-char: ' || jsonb_array_length(res -> 'items') || ' แถว', res ->> 'ok' = 'true' and jsonb_array_length(res -> 'items') = 0);
    res := pg_temp.srch(sess, 'ZZ187-F'); allr := allr || res;
    v := v || pg_temp.chk('QA-C7c', 'ค้น prefix ZZ187-F: เรียง prefix ก่อน · ไม่มี live/off · ได้ ' || jsonb_array_length(res -> 'items'), jsonb_array_length(res -> 'items') >= 3
      and not exists (select 1 from jsonb_array_elements(res -> 'items') e where e ->> 'sku' ~* '^live' or e ->> 'sku' = 'ZZ187-OFF'));
    res := pg_temp.srch(sess, 'live'); allr := allr || res;
    v := v || pg_temp.chk('QA-C7d', 'ค้น "live": ไม่คืน SKU ที่ขึ้นต้น live (รวม LIVERING-01) แต่คืน ZZ187-LIVEX (live กลางรหัส): ' || (select string_agg(e ->> 'sku', ',') from jsonb_array_elements(res -> 'items') e),
      exists (select 1 from jsonb_array_elements(res -> 'items') e where e ->> 'sku' = 'ZZ187-LIVEX') and not exists (select 1 from jsonb_array_elements(res -> 'items') e where e ->> 'sku' ~* '^live'));
    r := pg_temp.opn(sess, jsonb_build_object('product', p)); allr := allr || r;
    v := v || pg_temp.chk('QA-C7e', 'เปิดใบด้วย SKU ZZ187-LIVEX (ไม่ขึ้นต้น live) ผ่าน: ' || coalesce(r ->> 'ok', r::text), r ->> 'ok' = 'true');
    res := pg_temp.srch(sess, repeat('ก', 60)); allr := allr || res;
    r2 := pg_temp.srch(sess, repeat('ก', 61)); allr := allr || r2;
    v := v || pg_temp.chk('QA-C7f', 'ค้นยาว 60 ผ่าน · 61 = q_invalid', res ->> 'ok' = 'true' and r2 ->> 'code' = 'q_invalid');
    res := pg_temp.srch(sess, '   '); allr := allr || res;
    v := v || pg_temp.chk('QA-C7g', 'ค้นว่าง/ช่องว่างล้วน = ผลว่าง ไม่ error', res ->> 'ok' = 'true' and jsonb_array_length(res -> 'items') = 0);
    res := pg_temp.srch(sess, 'แหวนทดสอบ'); allr := allr || res;
    v := v || pg_temp.chk('QA-C7h', 'ค้นชื่อไทยบางส่วน ได้ผล ≥ 3 แถว: ' || jsonb_array_length(res -> 'items'), jsonb_array_length(res -> 'items') >= 3);
    res := pg_temp.srch(sess, '💍'); allr := allr || res;
    v := v || pg_temp.chk('QA-C7i', 'ค้นด้วย emoji = ผลว่าง ไม่ error: ' || coalesce(res ->> '_err', res ->> 'code', 'ok'), res ->> 'ok' = 'true' and jsonb_array_length(res -> 'items') = 0);
    res := pg_temp.srch(sess, E'x\\y'); allr := allr || res;
    v := v || pg_temp.chk('QA-C7j', 'ค้นมี backslash = ไม่ error (escape): ' || coalesce(res ->> '_err', 'ok'), res ->> 'ok' = 'true');
    res := pg_temp.srch(sess, 'ZZ187-FIXA'); allr := allr || res;
    badk := pg_temp.badkeys(res);
    v := v || pg_temp.chk('QA-C7k', 'ผลค้นสินค้า: key ทุกตัวไม่มี cost/price/make_spec/thb · keys ที่เจอที่ต้องห้าม="' || badk || '"', badk = '' and not (res::text ~* 'cost_type|make_spec|unit_cost|list_price'));
    -- C8 ตัวเลขขอบ
    r := pg_temp.opn(sess, jsonb_build_object('label', 'น้ำหนัก 0.0005', 'metal', 'silver', 'weight', 0.0005)); allr := allr || r;
    r2 := pg_temp.opn(sess, jsonb_build_object('label', 'น้ำหนัก 10000.001', 'metal', 'silver', 'weight', 10000.001)); allr := allr || r2;
    v := v || pg_temp.chk('QA-C8a', 'น้ำหนัก 0.0005 (4 ทศนิยม) และ 10000.001 = weight_invalid', r ->> 'code' = 'weight_invalid' and r2 ->> 'code' = 'weight_invalid');
    r := pg_temp.opn(sess, jsonb_build_object('label', 'น้ำหนัก 10000', 'metal', 'silver', 'weight', 10000)); allr := allr || r;
    r2 := pg_temp.opn(sess, jsonb_build_object('label', 'น้ำหนัก 0.001', 'metal', 'silver', 'weight', 0.001)); allr := allr || r2;
    v := v || pg_temp.chk('QA-C8b', 'น้ำหนักขอบ 10000 และ 0.001 ผ่าน', r ->> 'ok' = 'true' and r2 ->> 'ok' = 'true');
    r := pg_temp.opn(sess, jsonb_build_object('label', 'ทอง 37.49', 'metal', 'gold', 'purity', 0.37499)); allr := allr || r;
    r2 := pg_temp.opn(sess, jsonb_build_object('label', 'ทอง 37.5', 'metal', 'gold', 'purity', 0.375)); allr := allr || r2;
    v := v || pg_temp.chk('QA-C8c', 'เนื้อทอง 0.37499 = purity_invalid · 0.375 ผ่าน', r ->> 'code' = 'purity_invalid' and r2 ->> 'ok' = 'true');
    r := pg_temp.opn(sess, jsonb_build_object('label', 'ทอง 100', 'metal', 'gold', 'purity', 1)); allr := allr || r;
    r2 := pg_temp.opn(sess, jsonb_build_object('label', 'ทอง 100.01', 'metal', 'gold', 'purity', 1.0001)); allr := allr || r2;
    v := v || pg_temp.chk('QA-C8d', 'เนื้อทอง 1.0 ผ่าน · 1.0001 = purity_invalid', r ->> 'ok' = 'true' and r2 ->> 'code' = 'purity_invalid');
    r := pg_temp.opn(sess, jsonb_build_object('label', 'หมายเหตุ 500', 'metal', 'silver', 'note', repeat('ก', 500))); allr := allr || r;
    r2 := pg_temp.opn(sess, jsonb_build_object('label', 'หมายเหตุ 501', 'metal', 'silver', 'note', repeat('ก', 501))); allr := allr || r2;
    v := v || pg_temp.chk('QA-C9', 'หมายเหตุ 500 ผ่าน · 501 = note_invalid', r ->> 'ok' = 'true' and r2 ->> 'code' = 'note_invalid');
    res := pg_temp.srch(sess, 'ZZ187-W35'); allr := allr || res;
    r2 := pg_temp.srch(sess, 'ZZ187-SPOT'); allr := allr || r2;
    v := v || pg_temp.chk('QA-C11a', 'prefill: SKU เงินมีน้ำหนัก 3.5 -> silver/0.925/3.5 · SKU สปอต -> metal_known=true · SKU fixed ไม่ระบุโลหะ -> metal_known=false · (หมายเหตุ: แคตตาล็อกตอนนี้สร้าง SKU ทอง/ทองเหลืองไม่ได้ — make_spec รับ silver เท่านั้น จึงทดสอบ "น้ำหนักทองไม่ถึงช่าง" ผ่านทาง SKU ไม่ได้)',
      res -> 'items' -> 0 -> 'prefill' ->> 'metal' = 'silver' and (res -> 'items' -> 0 -> 'prefill' ->> 'weight_g')::numeric = 3.5 and (res -> 'items' -> 0 -> 'prefill' ->> 'purity')::numeric = 0.925
      and r2 -> 'items' -> 0 -> 'prefill' ->> 'metal_known' = 'true'
      and (pg_temp.srch(sess, 'ZZ187-FIXB') -> 'items' -> 0 -> 'prefill' ->> 'metal_known') = 'false');
    -- C10 ทุก response ตลอดกลุ่ม ไม่มี key เงิน/ต้นทุน และไม่มีค่า token/hash หลุดในผลที่ไม่ใช่ตอนสำเร็จ
    badk := pg_temp.badkeys(allr);
    v := v || pg_temp.chk('QA-C10', format('ไม่มีเงินใน response: ตรวจ %s ผลลัพธ์ (hub/ค้น/เปิดใบ สำเร็จ+ล้ม) · key ต้องห้ามที่เจอ="%s"', jsonb_array_length(allr), badk), badk = '');
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('QA-C-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  return v;
end;
$c$;

-- ----- QA-D: น้ำหนักทอง (N1) ผ่านทุก RPC ฝั่งช่างของใบทองที่ผู้จัดการเปิด · ค่า 7.771 ต้องไม่โผล่ที่ไหนเลย -----
create function pg_temp.qa_gold_n1() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); sess text := pg_temp.kv('sM'); r jsonb; jtokh text; w jsonb; s jsonb; wid uuid; res jsonb; allr jsonb := '[]'::jsonb; sq int; jb_id uuid; rc jsonb; sd jsonb; hub jsonb; sr jsonb;
begin
  begin
    r := pg_temp.opn(sess, jsonb_build_object('label', 'ทอง N1 QA', 'metal', 'gold', 'purity', 0.9, 'weight', 7.771, 'qty', 2)); allr := allr || r;
    if r ->> 'ok' <> 'true' then raise exception 'open ทองล้ม %', r::text; end if;
    jtokh := analytics.job_sha256_hex(r ->> 'token');
    jb_id := (pg_temp.jr(r ->> 'job_no') ->> 'id')::uuid;
    v := v || pg_temp.chk('QA-D1', 'ผลตอนเปิดใบทอง ไม่มี 7.771 และไม่มี key weight/purity/target', position('7.771' in r::text) = 0 and not (r ? 'weight_g') and not (r ? 'target_piece_g') and not (r ? 'purity'));
    -- ช่างขั้นแรก: สร้างช่าง wax_inject แล้วล็อกอินด้วย QR ใบงาน
    w := pg_temp.wu(a, 'ZZ-WI ช่างฉีดแว๊กซ์', '5791', null, '{wax_inject,wax_tree}', null, null); wid := (w ->> 'id')::uuid;
    s := pg_temp.pin_job(jtokh, wid, '5791');
    allr := allr || s;
    res := pg_temp.q(format('select analytics.job_worker_resolve(%L, %L, null)', jtokh, s ->> 'session_hash')); allr := allr || res;
    v := v || pg_temp.chk('QA-D2', 'job_worker_resolve (ช่างทั่วไป) ของใบทอง: ไม่มี 7.771 · ไม่มี target_piece/purity/weight_g key', position('7.771' in res::text) = 0 and res::text !~* 'target_piece|"purity"|"weight_g"');
    select min(seq) into sq from analytics.job_stage where job_id = jb_id;
    rc := pg_temp.q(format('select analytics.job_worker_receive(p_token_hash=>%L, p_session_hash=>%L, p_expected_seq=>%L, p_weight_in_g=>%L)', jtokh, s ->> 'session_hash', sq, 7.5)); allr := allr || rc;
    v := v || pg_temp.chk('QA-D3', 'job_worker_receive ของใบทอง: ไม่มี 7.771 ในผล (' || coalesce(rc ->> '_err', 'ok') || ')', position('7.771' in rc::text) = 0 and rc::text !~* 'target_piece');
    res := pg_temp.q(format('select analytics.job_worker_resolve(%L, %L, null)', jtokh, s ->> 'session_hash')); allr := allr || res;
    v := v || pg_temp.chk('QA-D4', 'resolve หลังรับ (กำลังถือ): ไม่มี 7.771', position('7.771' in res::text) = 0 and res::text !~* 'target_piece');
    sd := pg_temp.q(format('select analytics.job_worker_send(p_token_hash=>%L, p_session_hash=>%L, p_expected_seq=>%L, p_weight_out_g=>%L)', jtokh, s ->> 'session_hash', sq, 7.4)); allr := allr || sd;
    v := v || pg_temp.chk('QA-D5', 'job_worker_send ของใบทอง (นน.ออก 7.4 ต่ำกว่าที่รับ): ไม่มี 7.771 ในผล (' || coalesce(sd ->> '_err', sd ->> 'code', 'ok') || ')', position('7.771' in sd::text) = 0 and sd::text !~* 'target_piece');
    res := pg_temp.q(format('select analytics.job_worker_resolve(%L, %L, null)', jtokh, s ->> 'session_hash')); allr := allr || res;
    v := v || pg_temp.chk('QA-D6', 'resolve หลังส่ง: ไม่มี 7.771', position('7.771' in res::text) = 0);
    -- session ผู้จัดการจาก QR ร้านใช้ resolve ใบเดียวกัน (P7) — ก็ต้องไม่เห็นน้ำหนักทอง
    res := pg_temp.q(format('select analytics.job_worker_resolve(%L, %L, null)', jtokh, sess)); allr := allr || res;
    v := v || pg_temp.chk('QA-D7', 'resolve ด้วย session ผู้จัดการ (QR ร้าน) ของใบทองที่ตัวเองเปิด: ไม่มี 7.771 (ผู้จัดการพิมพ์เองแต่หน้าช่างต้องไม่แสดงกลับ)', position('7.771' in res::text) = 0);
    v := v || pg_temp.chk('QA-D8', 'ทุกผลฝั่งช่างตลอดวงจร (' || jsonb_array_length(allr) || ' ผล) ไม่มี 7.771 และ key ต้องห้าม="' || pg_temp.badkeys(allr) || '"', position('7.771' in allr::text) = 0 and pg_temp.badkeys(allr) = '');
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('QA-D-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  return v;
end;
$c$;

-- ----- QA-E: ทะเบียนช่าง + หน้าเลือกชื่อ -----
create function pg_temp.qa_registry() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); d uuid := gen_random_uuid(); r jsonb; r2 jsonb; hub jsonb; n int; names text; i int; tk jsonb; tkh text; wl jsonb; e uuid := gen_random_uuid(); tke jsonb; wid uuid; seen boolean; w_n jsonb; p jsonb;
begin
  -- E1 worker_upsert แบบเดิม (6 arg ตำแหน่ง ไม่ส่ง flag) บนผู้จัดการ -> flag เดิมต้องอยู่
  begin
    r := pg_temp.q(format('select analytics.worker_upsert(%L, %L, %L, %L::text[], null, %L)', a, pg_temp.fx('wM'), 'ZZ-M ผู้จัดการ', '{qc}', pg_temp.act()));
    v := v || pg_temp.chk('QA-E1', 'worker_upsert 6 arg แบบเดิมบนผู้จัดการ: ok · can_open_job ยัง true (ไม่ถูกรีเซ็ต) · audit ไม่มี key can_open_job: ' || coalesce(r ->> '_err', 'ok'),
      not (r ? '_err') and (select can_open_job from analytics.worker where id = pg_temp.fx('wM')) and r ->> 'can_open_job' = 'true'
      and not exists (select 1 from analytics.worker_audit where worker_id = pg_temp.fx('wM') and action = 'update' and detail ? 'can_open_job'));
    -- เพิ่มช่างใหม่แบบเดิม -> can_open_job=false
    r := pg_temp.q(format('select analytics.worker_upsert(%L, null, %L, %L::text[], null, %L)', a, 'ZZ-OLDSTYLE', '{pack}', pg_temp.act()));
    v := v || pg_temp.chk('QA-E2', 'เพิ่มช่างใหม่แบบเดิม (ไม่ส่ง flag): can_open_job=false · can_external=false · ได้ PIN สุ่ม', r ->> 'can_open_job' = 'false' and r ->> 'can_external' = 'false' and (r ->> 'pin') ~ '^[0-9]{4}$');
    -- ผู้จัดการไม่มีขั้นที่ทำ -> ปฏิเสธ (Q11 ไม่ผ่อน)
    r := pg_temp.q(format('select analytics.worker_upsert(%L, null, %L, %L::text[], null, %L, true, false)', a, 'ZZ-MGR-NOSTAGE', '{}', pg_temp.act()));
    v := v || pg_temp.chk('QA-E3', 'ผู้จัดการ (can_open_job=true) ไม่เลือกขั้นเลย = ปฏิเสธ (Q11 ไม่ผ่อน) และไม่มีแถวหลงเหลือ: ' || pg_temp.hint(r),
      (r ? '_err') and not exists (select 1 from analytics.worker where shop_id = a and display_name = 'ZZ-MGR-NOSTAGE'));
    -- ชื่อซ้ำ + flag
    r := pg_temp.q(format('select analytics.worker_upsert(%L, null, %L, %L::text[], null, %L, true, false)', a, 'ZZ-M ผู้จัดการ', '{qc}', pg_temp.act()));
    v := v || pg_temp.chk('QA-E4', 'ชื่อผู้จัดการซ้ำ = worker_name_taken: ' || pg_temp.hint(r), pg_temp.hint(r) = '22023|worker_name_taken');
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('QA-E-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  -- E5 hub resolve: ร้านไม่มีผู้จัดการเลย -> workers [] ; มีผู้จัดการ 52 คน -> คืน 50
  begin
    insert into public.shop (id, name) values (d, 'ZZ TEST qa 0187 D'), (e, 'ZZ TEST qa 0187 E');
    perform analytics.job_stage_def_ensure(d); perform analytics.job_record_profile_ensure(d);
    perform analytics.job_stage_def_ensure(e); perform analytics.job_record_profile_ensure(e);
    tke := analytics.shop_intake_token_issue(e, pg_temp.act());
    hub := pg_temp.hub(null, analytics.job_sha256_hex(tke ->> 'token'));
    perform pg_temp.wu(e, 'ZZ-E-ช่างทั่วไป', '8642', null, '{qc}', null, null);
    hub := pg_temp.hub(null, analytics.job_sha256_hex(tke ->> 'token'));
    v := v || pg_temp.chk('QA-E5', 'hub ร้านไม่มีผู้จัดการเลย (มีช่างทั่วไป 1 คน): state=identify · workers=[] (ไม่โชว์ช่างทั่วไป) ไม่ error', hub ->> 'state' = 'identify' and jsonb_array_length(hub -> 'workers') = 0);
    tk := analytics.shop_intake_token_issue(d, pg_temp.act()); tkh := analytics.job_sha256_hex(tk ->> 'token');
    for i in 1..52 loop
      r := pg_temp.wu(d, 'ZZ-D-' || lpad(i::text, 2, '0'), null, null, '{qc}', true, false);
      if i = 52 then wid := (r ->> 'id')::uuid; p := r; end if;
    end loop;
    hub := pg_temp.hub(null, tkh);
    n := jsonb_array_length(hub -> 'workers');
    select exists (select 1 from jsonb_array_elements(hub -> 'workers') x where (x ->> 'id')::uuid = wid) into seen;
    v := v || pg_temp.chk('QA-E6', format('INFO hub ร้านมีผู้จัดการ 52 คน: คืน %s คน · ผู้จัดการคนที่ 52 โผล่ในรายชื่อ=%s (limit 50 เงียบๆ — ผู้จัดการคน 51+ เลือกชื่อไม่ได้)', n, seen), n = 50 and not seen);
    -- ผู้จัดการคนที่ 52 (ไม่ถูกแสดง) ใส่ PIN ตรงๆ ที่ QR ร้านได้
    r2 := pg_temp.pin_in(wid, p ->> 'pin', tkh);
    v := v || pg_temp.chk('QA-E7', 'ผู้จัดการคน 52 (ไม่ถูกแสดงบนจอ) ยังล็อกอินผ่าน API ได้ — ไม่ใช่ช่องโหว่ (ระบุ id เอง) แต่ UI เลือกไม่ได้: ' || coalesce(r2 ->> 'ok', r2 ->> 'code'), r2 ->> 'ok' = 'true');
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('QA-E5-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  return v;
end;
$c$;

-- ----- QA-F: ใครสแกน QR ร้านก็ล็อกผู้จัดการได้ (DoS) · IDOR ข้ามร้าน -----
create function pg_temp.qa_abuse() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); b uuid := pg_temp.fx('B'); r jsonb; i int; ip text; locked1 text; locked2 text; legit jsonb; hub jsonb; n_ip int := 0; po_b uuid; it_b jsonb; it_a jsonb; o_a uuid; x jsonb; ak jsonb;
  last_code text;
begin
  begin
    -- F1 ผู้โจมตีไม่มีข้อมูลรับรองใดๆ: เห็นรายชื่อผู้จัดการจาก hub (id+ชื่อ) แล้วยิง PIN ผิด · 5 ครั้งแรก/คน = ล็อก 15 นาที (ยิงจาก IP ต่างกัน)
    hub := pg_temp.hub(null);
    for i in 1..5 loop
      ip := analytics.job_sha256_hex('attacker-' || i);
      r := pg_temp.pin_in(pg_temp.fx('wM'), '0000', null, ip); last_code := r ->> 'code';
    end loop;
    locked1 := last_code;
    for i in 6..10 loop
      ip := analytics.job_sha256_hex('attacker-' || i);
      r := pg_temp.pin_in(pg_temp.fx('wM2'), '0000', null, ip); last_code := r ->> 'code';
    end loop;
    locked2 := last_code;
    legit := pg_temp.pin_in(pg_temp.fx('wM'), '2468');
    v := v || pg_temp.chk('QA-F1', format('INFO DoS รอบ 1: ไม่มีข้อมูลรับรอง ยิง PIN ผิด 5 ครั้ง/คน (รวม 10 request) -> ผู้จัดการทั้งร้านถูกล็อก 15 นาที (%s/%s) · ผู้จัดการตัวจริงใส่ PIN ถูกก็เข้าไม่ได้: %s', locked1, locked2, legit ->> 'code'),
      locked1 = 'locked' and locked2 = 'locked' and legit ->> 'code' = 'locked');
    -- จำลองรอจนล็อกหมด (fixture: ปลด locked_until) แล้วยิงต่ออีก 10 ครั้ง/คน -> ครบ 15 ในหน้าต่าง 24 ชม. = ล็อกถาวรต้องให้ออฟฟิศปลด
    update analytics.worker set locked_until = null where id in (pg_temp.fx('wM'), pg_temp.fx('wM2'));
    for i in 11..14 loop
      r := pg_temp.pin_in(pg_temp.fx('wM'), '0000', null, analytics.job_sha256_hex('attacker-' || i));
      r := pg_temp.pin_in(pg_temp.fx('wM2'), '0000', null, analytics.job_sha256_hex('attacker-' || i));
    end loop;
    update analytics.worker set locked_until = null where id in (pg_temp.fx('wM'), pg_temp.fx('wM2'));
    r := pg_temp.pin_in(pg_temp.fx('wM'), '0000', null, analytics.job_sha256_hex('attacker-x'));
    r := pg_temp.pin_in(pg_temp.fx('wM2'), '0000', null, analytics.job_sha256_hex('attacker-x'));
    update analytics.worker set locked_until = null where id in (pg_temp.fx('wM'), pg_temp.fx('wM2'));
    for i in 1..6 loop
      r := pg_temp.pin_in(pg_temp.fx('wM'), '0000', null, analytics.job_sha256_hex('attacker-y' || i));
      r := pg_temp.pin_in(pg_temp.fx('wM2'), '0000', null, analytics.job_sha256_hex('attacker-y' || i));
      update analytics.worker set locked_until = null where id in (pg_temp.fx('wM'), pg_temp.fx('wM2')) and locked_until <> 'infinity';
    end loop;
    legit := pg_temp.pin_in(pg_temp.fx('wM'), '2468');
    v := v || pg_temp.chk('QA-F1b', format('INFO DoS รอบ 2 (จำลองรอ): ยิงผิดสะสม >= 15/คน ใน 24 ชม. -> ผู้จัดการ locked_office ถาวร: PIN ถูกก็เข้าไม่ได้ = %s · ใช้ request รวม ~ %s ต่อคน · ไม่มีด่านต่อ IP/ต่อ token ที่หยุดได้ (ต่อ IP 100/10 นาที · ต่อ token 60/10 นาที ห่างไกล)', legit ->> 'code', 15),
      legit ->> 'code' = 'locked_office');
    -- session ที่ออกก่อนถูกล็อกยังใช้ได้ (ไม่ถูกเตะ)
    r := pg_temp.hub(pg_temp.kv('sM'));
    v := v || pg_temp.chk('QA-F2', 'session เดิมของผู้จัดการที่ถูกล็อกทีหลัง ยังใช้ hub ได้ (ล็อกกันเฉพาะ PIN ใหม่): ' || coalesce(r ->> 'state', r ->> 'code'), r ->> 'state' = 'ready');
    -- F3 IDOR ข้ามร้านผ่านฝั่งออฟฟิศ (ack/bind/label_set ใช้ id ร้านอื่น)
    po_b := pg_temp.po(b, 'qa-B-order');
    it_b := pg_temp.iset(b, po_b, null, 1, 'ชื่อแบบร้าน B', 'silver');
    o_a := pg_temp.po(a, 'qa-A-order');
    it_a := pg_temp.iset(a, o_a, null, 1, 'ชื่อแบบร้าน A', 'silver');
    x := pg_temp.ack(a, po_b);
    v := v || pg_temp.chk('QA-F3a', 'ack ใบผลิตของร้าน B โดยส่ง shop A = order_not_found (ไม่รั่วว่ามีจริง): ' || pg_temp.hint(x), pg_temp.hint(x) = '22023|order_not_found');
    x := pg_temp.bind(a, (it_b ->> 'id')::uuid, pg_temp.fx('fixa'));
    v := v || pg_temp.chk('QA-F3b', 'bind รายการของร้าน B ด้วย shop A = item_not_found: ' || pg_temp.hint(x), pg_temp.hint(x) = '22023|item_not_found');
    x := pg_temp.bind(a, (it_a ->> 'id')::uuid, pg_temp.fx('bsku'));
    v := v || pg_temp.chk('QA-F3c', 'bind รายการร้าน A ด้วย SKU ของร้าน B = sku_not_found: ' || pg_temp.hint(x), pg_temp.hint(x) = '22023|sku_not_found');
    x := pg_temp.q(format('select analytics.production_order_item_label_set(%L, %L, %L, %L)', a, it_b ->> 'id', 'แก้ข้ามร้าน', pg_temp.act()));
    v := v || pg_temp.chk('QA-F3d', 'label_set รายการร้าน B ด้วย shop A = item_not_found: ' || pg_temp.hint(x), pg_temp.hint(x) = '22023|item_not_found');
    x := pg_temp.q(format('select analytics.production_order_item_label_set(%L, %L, %L, %L)', a, it_a ->> 'id', repeat('ก', 201), pg_temp.act()));
    v := v || pg_temp.chk('QA-F3e', 'label_set ชื่อ 201 ตัว = ปฏิเสธ: ' || pg_temp.hint(x), x ? '_err');
    x := pg_temp.q(format('select analytics.production_order_item_label_set(%L, %L, %L, %L)', a, it_a ->> 'id', E'  ชื่อ   ใหม่  ', pg_temp.act()));
    v := v || pg_temp.chk('QA-F3f', 'label_set ยุบช่องว่าง/trim: "' || coalesce(x ->> 'pending_product_label', x::text) || '"', x ->> 'pending_product_label' = 'ชื่อ ใหม่');
    raise exception 'rb_qa';
  exception when others then
    if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('QA-F-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  return v;
end;
$c$;

-- ----- QA-MU: mutant ของเทสต์ที่ฉันเขียนเอง (พิสูจน์ว่าไม่ vacuous) — ทำลายด่านทีละตัวแล้ว rerun กลุ่มที่เกี่ยวต้อง FAIL ตาม id ที่ระบุ -----
create function pg_temp.qa_mut() returns text
 language plpgsql as $c$
declare v text := ''; out text; hit boolean;
begin
  begin
    perform pg_temp.mutate('analytics.production_order_close_gate()', 'new.opened_via = ''shopfloor'' and new.acknowledged_at is null', 'false');
    out := pg_temp.qa_split_bind();
    v := v || pg_temp.chk('QA-MU1', 'mutant: close gate ไม่เช็ค ack -> QA-A9 ต้อง FAIL: ' || (position('[FAIL] QA-A9' in out) > 0)::text, position('[FAIL] QA-A9' in out) > 0);
    raise exception 'rb_qa';
  exception when others then if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('QA-MU1-crash', sqlstate || ' ' || sqlerrm, false); end if; end;
  begin
    perform pg_temp.mutate('analytics.production_order_item_bind_product(uuid,uuid,uuid,uuid)', 'and status <> ''cancelled'' and product_id is null', 'and status <> ''cancelled'' and product_id is null and parent_job_id is null');
    out := pg_temp.qa_split_bind();
    v := v || pg_temp.chk('QA-MU2', 'mutant: bind ไม่อัปเดตส่วนย่อย -> QA-A3/A4 ต้อง FAIL', position('[FAIL] QA-A3' in out) > 0 and position('[FAIL] QA-A4' in out) > 0);
    raise exception 'rb_qa';
  exception when others then if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('QA-MU2-crash', sqlstate || ' ' || sqlerrm, false); end if; end;
  begin
    perform pg_temp.mutate('analytics.job_worker_open(text,text,text,uuid,text,text,numeric,numeric,integer,integer,date,boolean,text,text,text)', '''ชื่อแบบ'', 200)', '''ชื่อแบบ'', 2000)');
    out := pg_temp.qa_input();
    v := v || pg_temp.chk('QA-MU3', 'mutant: เพดานชื่อแบบ 200 -> 2000 -> QA-C1 ต้อง FAIL', position('[FAIL] QA-C1' in out) > 0);
    raise exception 'rb_qa';
  exception when others then if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('QA-MU3-crash', sqlstate || ' ' || sqlerrm, false); end if; end;
  begin
    perform pg_temp.mutate('analytics.shop_intake_resolve(text,text,text)', 'and w.can_open_job
', '
');
    out := pg_temp.qa_registry();
    v := v || pg_temp.chk('QA-MU5', 'mutant: hub โชว์ช่างทุกคน -> QA-E5 ต้อง FAIL', position('[FAIL] QA-E5' in out) > 0);
    raise exception 'rb_qa';
  exception when others then if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('QA-MU5-crash', sqlstate || ' ' || sqlerrm, false); end if; end;
  return v;
end;
$c$;

create function pg_temp.qa_dos() returns text
 language plpgsql as $c$
declare
  v text := ''; i int; r jsonb; fake_sess text; legit jsonb; last_code text; n_before int;
begin
  begin
    -- G1: คนแปลกหน้าถือ QR ร้าน (ติดผนัง) ยิง open ด้วย session ปลอมรูปแบบถูก 25 ครั้ง -> ถังต่อ token (sio: 20/10 นาที) เต็ม ผู้จัดการตัวจริงเปิดใบไม่ได้
    for i in 1..25 loop
      fake_sess := analytics.job_sha256_hex('fake-session-' || i);
      r := pg_temp.opn(fake_sess, jsonb_build_object('label', 'x', 'metal', 'silver', 'rl', '1')); last_code := r ->> 'code';
    end loop;
    legit := pg_temp.opn(pg_temp.kv('sM'), jsonb_build_object('label', 'ผู้จัดการตัวจริง', 'metal', 'silver', 'rl', '1'));
    v := v || pg_temp.chk('QA-G1', format('INFO DoS ถัง open: ไม่มี session จริง ยิง 25 ครั้ง (ครั้งสุดท้าย=%s) -> ผู้จัดการตัวจริง (session ถูก) เปิดใบได้ไหม: ok=%s code=%s (rate_limited = ถูกบล็อก ≤10 นาที ยิงซ้ำได้ไม่จำกัด)', last_code, legit ->> 'ok', legit ->> 'code'),
      last_code = 'rate_limited' and legit ->> 'code' = 'rate_limited');
    raise exception 'rb_qa';
  exception when others then if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('QA-G1-crash', sqlstate || ' ' || sqlerrm, false); end if; end;
  begin
    -- G2: hub 120/10 นาที ต่อ token (ไม่มี session ก็นับ) -> เกิน = ผู้จัดการตัวจริงเปิดหน้า hub ไม่ได้
    for i in 1..125 loop
      r := pg_temp.hub(null); last_code := r ->> 'code';
    end loop;
    legit := pg_temp.hub(pg_temp.kv('sM'));
    v := v || pg_temp.chk('QA-G2', format('INFO DoS ถัง hub: ยิง resolve 125 ครั้งไม่ต้องมี session (สุดท้าย=%s) -> ผู้จัดการตัวจริงโหลด hub: code=%s', last_code, legit ->> 'code'), last_code = 'rate_limited' and legit ->> 'code' = 'rate_limited');
    raise exception 'rb_qa';
  exception when others then if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('QA-G2-crash', sqlstate || ' ' || sqlerrm, false); end if; end;
  begin
    -- G3: ถังค้นสินค้า 240/10 นาที: ใช้ session จริงของช่างทั่วไปไม่ได้ (ต้อง can_open) แต่ session ปลอมก็นับ -> ผู้จัดการค้นไม่ได้
    for i in 1..245 loop
      r := pg_temp.srch(analytics.job_sha256_hex('fs' || i), 'x'); last_code := r ->> 'code';
    end loop;
    legit := pg_temp.srch(pg_temp.kv('sM'), 'ZZ187');
    v := v || pg_temp.chk('QA-G3', format('INFO DoS ถังค้น: 245 ครั้งด้วย session ปลอม (สุดท้าย=%s) -> ผู้จัดการค้นสินค้า: code=%s', last_code, legit ->> 'code'), last_code = 'rate_limited' and legit ->> 'code' = 'rate_limited');
    raise exception 'rb_qa';
  exception when others then if sqlerrm <> 'rb_qa' then v := v || pg_temp.chk('QA-G3-crash', sqlstate || ' ' || sqlerrm, false); end if; end;
  return v;
end;
$c$;

do $qa$
declare
  v_msg text := E'\n=== QA ad-hoc 0187 ===\n'; v_part text; v_out text; v_fail int; v_ok int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    v_msg := v_msg || pg_temp.g_setup();
    foreach v_part in array array['qa_split_bind', 'qa_office', 'qa_input', 'qa_gold_n1', 'qa_registry', 'qa_abuse', 'qa_dos', 'qa_mut'] loop
      begin
        execute format('select pg_temp.%I()', v_part) into v_out;
        v_msg := v_msg || v_out;
      exception when others then
        v_msg := v_msg || format('[FAIL] %s-fatal  %s %s', v_part, sqlstate, sqlerrm) || E'\n';
      end;
    end loop;
    raise exception 'QA_ROLLBACK';
  exception when others then
    if sqlerrm <> 'QA_ROLLBACK' then v_msg := v_msg || format('[FAIL] S1-crash  %s %s', sqlstate, sqlerrm) || E'\n'; end if;
  end;
  v_fail := (length(v_msg) - length(replace(v_msg, '[FAIL]', ''))) / length('[FAIL]');
  v_ok := (length(v_msg) - length(replace(v_msg, '[OK]', ''))) / length('[OK]');
  v_msg := v_msg || format(E'\n--- สรุป QA: OK %s · FAIL %s ---', v_ok, v_fail);
  raise exception '%', v_msg;
end;
$qa$;
