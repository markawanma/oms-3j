-- scripts/verify/verify-0188.sql
-- ตรวจ supabase/migrations/0188_w1_followups.sql (W1 ตามหลัง 0187: close_gate ข้อความ old.po_no · shop_intake_token_status คืน issued_at/revoked_at · job_worker_open ล็อกต่อ (ร้าน, SKU) + ข้อความ name_invalid กลาง)
-- self-rolling-back (3j-migration-traps ข้อ 11): ทุกเคสอยู่ในทรานแซกชันเดียว จบด้วย `raise exception` เสมอ ⇒ ถอยทั้งก้อน · อ่านผลจาก error message · exit 1 คือผลที่คาด · [FAIL] >= 1 = ไม่ผ่าน
-- ต้องมี 0187 อยู่ใน DB แล้ว (apply แล้ว) · dry-run: ต่อ 0188 + ไฟล์นี้ · หลัง apply 0188: รันไฟล์นี้เดี่ยวๆ ได้
-- ข้อมูลทดสอบ: ร้านสังเคราะห์ ZZ TEST verify-0188 (insert public.shop ตรง ตามแพทเทิร์น verify-0187/0186 — ข้อยกเว้นเดียวที่ไม่ผ่าน RPC) · SKU/ช่าง/QR ร้าน/ใบผลิต/ผูก SKU/ack/done สร้างผ่าน RPC ของระบบทั้งหมด
-- 🔴 ไม่แตะตัวนับเอกสารภาษี · production_order_done ต้อง md5 เดิม (G3)
--
-- ตารางเคส → เรื่อง (4 เรื่องของ 0188)
--   1 close_gate ใช้ old.po_no      : A1 A2 (ผ่าน production_order_done: sku_required/ack_required มีเลขใบ) · A4 A5 (UPDATE ตรง = ข้อความของ trigger เอง: ack_required/sku_required มีเลขใบ) · A3 A6 (ต้องไม่พัง: ครบเงื่อนไข ผ่านด่าน) · mutant MA MB
--   2 token status revoked_at       : B1 (active → revoked_at null) · B2 (เพิกถอน → issued/revoked ของใบนั้น) · B3 (หลายใบ → ใบล่าสุด) · B4 (ไม่เคยออก → null ทั้งคู่) · B5 (ไม่มี hash/คีย์ต้องห้าม · ร้านอื่นไม่รั่ว) · B6 (null/anon/authenticated/service_role) · mutant MC MD ME
--   3 advisory lock ต่อ (ร้าน, SKU)  : C1 (ถือล็อก SKU + idem) · C2 (SKU เดิมคนละ key = job_exists) · C3 (key เดิม = ใบเดิม) · C4 (ไม่มี SKU ไม่ล็อก SKU) · C5 (ตกที่ validate ไม่ถือล็อก) · C6 (คนละ SKU เปิดได้) · C7 (ลำดับล็อก idem → SKU ในนิยาม) · mutant MF
--   4 name_invalid ข้อความกลาง       : D1 (< >) · D2 (ยาว 201 ข้อความเดียวกัน) · D3 (ต้องไม่พัง: 200 พอดีผ่าน) · mutant MG
--   สัญญา migration                 : G1 (1 แถวต่อชื่อ · signature) · G2 (สิทธิ์) · G3 (done md5) · MY (นิยาม+สิทธิ์ทุกฟังก์ชันเท่าเดิมหลัง mutant) · K0 (ไม่ทิ้งรอย)
-- ไม่มีเทสต์ครอบ (บอกตรงๆ): การแข่งกันจริงของ 2 connection (race) — do-block เป็น connection เดียว พิสูจน์ได้แค่ว่า "ล็อกถูกถือ + ลำดับถูก + ด่านเดิมยังทำงาน" (C1 C2 C7 + mutant MF) ไม่ใช่การรอกันข้าม session · ต้องลอง 2 หน้าจอพร้อมกันตอน UAT

set local statement_timeout = '30min';

create temp table _v188_fx (k text primary key, id uuid not null) on commit drop;
create temp table _v188_kv (k text primary key, v text not null) on commit drop;

create function pg_temp.chk(p_id text, p_desc text, p_ok boolean) returns text
 language sql as $c$
  select format('[%s] %s  %s', case when coalesce(p_ok, false) then 'OK' else 'FAIL' end, p_id, p_desc) || E'\n'
$c$;
create function pg_temp.fx(p_k text) returns uuid language sql as $c$ select id from _v188_fx where k = p_k $c$;
create function pg_temp.setfx(p_k text, p_id uuid) returns void language sql as $c$
  insert into _v188_fx (k, id) values (p_k, p_id) on conflict (k) do update set id = excluded.id $c$;
create function pg_temp.kv(p_k text) returns text language sql as $c$ select v from _v188_kv where k = p_k $c$;
create function pg_temp.setkv(p_k text, p_v text) returns void language sql as $c$
  insert into _v188_kv (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $c$;
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
create function pg_temp.po(p_shop uuid, p_note text default 'verify0188') returns uuid
 language sql as $c$ select (analytics.production_order_save(p_shop, null, p_note, null) ->> 'id')::uuid $c$;
-- ใบผลิตออฟฟิศ + รายการ + ใบงาน (สร้างผ่าน RPC ออฟฟิศเดิม) · คืน {po, item, job}
create function pg_temp.office_job(p_shop uuid, p_product uuid) returns jsonb
 language plpgsql as $c$
declare o uuid; r jsonb; j jsonb;
begin
  o := pg_temp.po(p_shop, 'office-v188');
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
-- A. setup (ร้านสังเคราะห์ ZZ188 A/B — insert public.shop ตรงตามแพทเทิร์น verify-0144/0186: ข้อยกเว้นที่ไม่ผ่าน RPC · บอกตรงๆ) · ที่เหลือผ่าน RPC ของระบบ
-- ============================================================================
create function pg_temp.g_setup() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  p uuid; r jsonb; w uuid; j jsonb; s jsonb;
begin
  insert into public.shop (id, name) values (a, 'ZZ TEST verify-0188 A'), (b, 'ZZ TEST verify-0188 B');
  perform pg_temp.setfx('A', a); perform pg_temp.setfx('B', b);
  perform analytics.job_stage_def_ensure(a); perform analytics.job_record_profile_ensure(a);
  perform analytics.job_stage_def_ensure(b); perform analytics.job_record_profile_ensure(b);
  -- SKU ร้าน A
  p := analytics.product_upsert(a, 'ZZ188-FIXA', 'แหวนทดสอบ A', null, 'fixed', 88, null, null, null, 150, null, null, null, true); perform pg_temp.setfx('fixa', p);
  p := analytics.product_upsert(a, 'ZZ188-FIXB', 'แหวนทดสอบ B', null, 'fixed', 50, null, null, null, null, null, null, null, true); perform pg_temp.setfx('fixb', p);
  p := analytics.product_upsert(a, 'ZZ188-SPOT', 'spot 10g .925', null, 'spot', null, 10, 0.925, 20, 300, null, null, null, true); perform pg_temp.setfx('spot', p);
  p := analytics.product_upsert(a, 'ZZ188-W35', 'เงินมีน้ำหนัก 3.5', null, 'fixed', 60, 3.5, 0.925, null, null, null, null, null, true); perform pg_temp.setfx('w35', p);
  p := analytics.product_upsert(a, 'ZZ188-JT', 'ใบงานตั้งต้น (ออฟฟิศ)', null, 'fixed', 40, null, null, null, null, null, null, null, true); perform pg_temp.setfx('jt', p);
  p := analytics.product_upsert(a, 'ZZ188-FIXC', 'แหวนทดสอบ C', null, 'fixed', 55, null, null, null, null, null, null, null, true); perform pg_temp.setfx('fixc', p);
  p := analytics.product_upsert(a, 'live188', 'live sku', null, 'fixed', 10, null, null, null, null, null, null, null, true); perform pg_temp.setfx('live', p);
  p := analytics.product_upsert(a, 'ZZ188-OFF', 'ปิดใช้งาน', null, 'fixed', 10, null, null, null, null, null, null, null, false); perform pg_temp.setfx('off', p);
  p := analytics.product_upsert(b, 'ZZ188-BSKU', 'SKU ร้าน B', null, 'fixed', 70, null, null, null, null, null, null, null, true); perform pg_temp.setfx('bsku', p);
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
-- เปิดใบแบบไม่มี SKU (เงิน) แล้วคืน {po_no, job_no, po, item, job}
create function pg_temp.open_label(p_label text default 'แหวนทดสอบไม่มีรหัส', p_extra jsonb default '{}'::jsonb, p_sess text default null) returns jsonb
 language plpgsql as $c$
declare r jsonb;
begin
  r := pg_temp.opn(coalesce(p_sess, pg_temp.kv('sM')), jsonb_build_object('label', p_label, 'metal', 'silver', 'qty', 2) || p_extra);
  if r ->> 'ok' is distinct from 'true' then raise exception 'open_label ล้ม: %', r::text; end if;
  return r || jsonb_build_object('po', (pg_temp.por(r ->> 'order_no') ->> 'id'), 'item', (pg_temp.itr(r ->> 'order_no') ->> 'id'), 'job', (pg_temp.jr(r ->> 'job_no') ->> 'id'));
end;
$c$;

create function pg_temp.snap() returns text
 language plpgsql as $c$
declare v text := ''; t text; n text;
begin
  foreach t in array array['analytics.job', 'analytics.job_stage', 'analytics.job_event', 'analytics.job_token', 'analytics.worker', 'analytics.worker_audit', 'analytics.worker_session', 'analytics.worker_rate_limit',
    'analytics.job_counter', 'analytics.production_order', 'analytics.production_order_item', 'analytics.production_order_counter', 'analytics.shop_intake_token', 'analytics.stock_lot', 'public.central_stock', 'public.product', 'public.shop'] loop
    if to_regclass(t) is not null then
      execute format('select count(*)::text || ''/'' || coalesce(md5(string_agg(x::text, ''|'' order by x::text)), '''') from %s x', t) into n;
      v := v || t || '=' || n || ';';
    end if;
  end loop;
  return md5(v);
end;
$c$;



-- ============================================================================
-- helper เฉพาะ 0188
-- ============================================================================
-- advisory lock ทั้งหมด (granted) ที่ session นี้ถืออยู่ — ใช้นับส่วนต่างก่อน/หลังเรียก RPC (ล็อก xact ถืออยู่จนจบทรานแซกชัน/ซับบล็อกที่สำเร็จ)
create function pg_temp.nlocks() returns int language sql as $c$
  select count(*)::int from pg_locks l where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted $c$;
-- session นี้ถือ advisory lock (bigint key = hashtextextended(p_key, 0)) อยู่หรือไม่ — pg_locks แยก bigint เป็น classid (32 บิตบน) / objid (32 บิตล่าง)
create function pg_temp.holds_lock(p_key text) returns boolean language sql as $c$
  select exists (select 1 from pg_locks l
                  where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted and l.objsubid = 1
                    and l.classid::bigint = ((hashtextextended(p_key, 0) >> 32) & 4294967295)
                    and l.objid::bigint = (hashtextextended(p_key, 0) & 4294967295)) $c$;

-- ============================================================================
-- กลุ่มเคส 0188 (ใช้ฟิกซ์เจอร์ g_setup ชุดเดียวกับ verify-0187 — ร้านสังเคราะห์ ZZ TEST · ทุกอย่างผ่าน RPC ของระบบ · ทุกกลุ่มถอยกลับด้วย raise 'rb_188')
-- ============================================================================
create function pg_temp.g_188() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); b uuid := pg_temp.fx('B');
  sM text := pg_temp.kv('sM'); sM2 text := pg_temp.kv('sM2');
  fixa uuid := pg_temp.fx('fixa'); fixb uuid := pg_temp.fx('fixb'); fixc uuid := pg_temp.fx('fixc');
  o jsonb; d jsonb; r jsonb; r2 jsonb; st jsonb; t1 jsonb; t2 jsonb; po uuid; no text; ik text; n0 int; n1 int;
  c uuid := gen_random_uuid(); ia timestamptz; ra timestamptz; ia1 timestamptz; def text; p_idem int; p_prod int; msg text;
begin
  -- A. close gate: ข้อความต้องมีเลขใบจริง (old.po_no) ไม่ใช่ <NULL> (QA BUG-3) — ทั้ง sku_required และ ack_required · ผ่านทาง production_order_done จริง
  begin
    o := pg_temp.open_label('แหวน A188'); po := (o ->> 'po')::uuid; no := o ->> 'order_no';
    d := pg_temp.dn(a, po);
    v := v || pg_temp.chk('A1', 'ปิดผ่าน production_order_done ก่อนผูก SKU → sku_required (ข้อความของ done เอง) · มีเลขใบ ' || no || ' ไม่ใช่ NULL · ได้: ' || coalesce(d ->> '_err', '-'),
      pg_temp.hint(d) = '22023|sku_required' and position(no in d ->> '_err') > 0 and position('NULL' in upper(d ->> '_err')) = 0);
    perform pg_temp.bind(a, (o ->> 'item')::uuid, fixb);
    d := pg_temp.dn(a, po);
    v := v || pg_temp.chk('A2', 'ผูก SKU แล้วแต่ยังไม่รับทราบ → ack_required · ข้อความมีเลขใบ ' || no || ' ไม่ใช่ NULL · ได้: ' || coalesce(d ->> '_err', '-'),
      pg_temp.hint(d) = '22023|ack_required' and position(no in d ->> '_err') > 0 and position('NULL' in upper(d ->> '_err')) = 0);
    perform pg_temp.ack(a, po);
    d := pg_temp.dn(a, po);
    v := v || pg_temp.chk('A3', 'ต้องไม่พัง: รับทราบ + ผูก SKU ครบ → done สำเร็จ (ด่านปล่อย)', d ->> 'status' = 'done' and (select status from analytics.production_order where id = po) = 'done');
    raise exception 'rb_188';
  exception when others then
    if sqlerrm <> 'rb_188' then v := v || pg_temp.chk('A-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  -- A'. ทางตรง (UPDATE status = done ไม่ผ่าน production_order_done) = ด่านของ trigger เองทั้งสองข้อความ — sku_required ของ trigger ยิงได้เมื่อรับทราบแล้วแต่ยังไม่ผูก SKU
  begin
    o := pg_temp.open_label('แหวน A188 ทางตรง'); po := (o ->> 'po')::uuid; no := o ->> 'order_no';
    d := pg_temp.q(format('update analytics.production_order set status = ''done'', done_at = now() where id = %L returning jsonb_build_object(''id'', id)', po));
    v := v || pg_temp.chk('A4', 'UPDATE ตรงก่อนรับทราบ → ack_required จาก trigger · ข้อความมีเลขใบ ' || no || ' ไม่ใช่ NULL · ได้: ' || coalesce(d ->> '_err', '-'),
      pg_temp.hint(d) = '22023|ack_required' and position(no in d ->> '_err') > 0 and position('NULL' in upper(d ->> '_err')) = 0);
    perform pg_temp.ack(a, po);
    d := pg_temp.q(format('update analytics.production_order set status = ''done'', done_at = now() where id = %L returning jsonb_build_object(''id'', id)', po));
    v := v || pg_temp.chk('A5', 'UPDATE ตรงหลังรับทราบแต่ยังไม่ผูก SKU → sku_required จาก trigger · ข้อความมีเลขใบ ' || no || ' ไม่ใช่ NULL · ได้: ' || coalesce(d ->> '_err', '-'),
      pg_temp.hint(d) = '22023|sku_required' and position(no in d ->> '_err') > 0 and position('NULL' in upper(d ->> '_err')) = 0);
    perform pg_temp.bind(a, (o ->> 'item')::uuid, fixb);
    d := pg_temp.q(format('update analytics.production_order set status = ''done'', done_at = now() where id = %L returning jsonb_build_object(''id'', id)', po));
    v := v || pg_temp.chk('A6', 'ต้องไม่พัง: UPDATE ตรงหลังรับทราบ + ผูก SKU ครบ → ผ่านด่าน (status = done)', d ->> 'id' is not null and (select status from analytics.production_order where id = po) = 'done');
    raise exception 'rb_188';
  exception when others then
    if sqlerrm <> 'rb_188' then v := v || pg_temp.chk('A4-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- B. shop_intake_token_status: คืน issued_at/revoked_at ของใบล่าสุดเมื่อไม่มีใบ active (QA BUG-2)
  begin
    st := analytics.shop_intake_token_status(a);
    select issued_at into ia from analytics.shop_intake_token where shop_id = a and revoked_at is null;
    v := v || pg_temp.chk('B1', 'มีใบ active: active=true · issued_at = ของใบนั้น · revoked_at = null (key อยู่ครบ)',
      st ->> 'active' = 'true' and (st ->> 'issued_at')::timestamptz = ia and st ? 'revoked_at' and st -> 'revoked_at' = 'null'::jsonb);
    perform analytics.shop_intake_token_revoke(a, pg_temp.act());
    st := analytics.shop_intake_token_status(a);
    select revoked_at into ra from analytics.shop_intake_token where shop_id = a order by issued_at desc, id limit 1;
    v := v || pg_temp.chk('B2', 'เพิกถอนแล้ว (ไม่มี active): active=false · issued_at = ของใบนั้น · revoked_at = เวลาเพิกถอนจริง (แยกจาก "ไม่เคยออก" ได้)',
      st ->> 'active' = 'false' and (st ->> 'issued_at')::timestamptz = ia and ra is not null and (st ->> 'revoked_at')::timestamptz = ra);
    t1 := analytics.shop_intake_token_issue(a, pg_temp.act());
    t2 := analytics.shop_intake_token_issue(a, pg_temp.act());   -- ออกซ้ำ = เพิกถอนใบที่ 1 (reissue)
    perform analytics.shop_intake_token_revoke(a, pg_temp.act());
    st := analytics.shop_intake_token_status(a);
    select issued_at, revoked_at into ia, ra from analytics.shop_intake_token where token_hash = analytics.job_sha256_hex(t2 ->> 'token');
    select issued_at into ia1 from analytics.shop_intake_token where token_hash = analytics.job_sha256_hex(t1 ->> 'token');
    v := v || pg_temp.chk('B3', 'มีหลายใบที่เคยออก (ถูกเพิกถอนหมด): คืนของใบ "ล่าสุด" (ใบที่ 2) — ไม่ใช่ใบเก่ากว่า',
      ia > ia1 and (st ->> 'issued_at')::timestamptz = ia and (st ->> 'revoked_at')::timestamptz = ra and ra is not null);
    insert into public.shop (id, name) values (c, 'ZZ TEST verify-0188 C (ไม่เคยออก QR)');
    st := analytics.shop_intake_token_status(c);
    v := v || pg_temp.chk('B4', 'ร้านที่ไม่เคยออก QR: active=false · issued_at = null · revoked_at = null (หน้าจอแยกจาก "ถูกเพิกถอน" ได้)',
      st ->> 'active' = 'false' and st ? 'issued_at' and st ? 'revoked_at' and st -> 'issued_at' = 'null'::jsonb and st -> 'revoked_at' = 'null'::jsonb);
    v := v || pg_temp.chk('B5', 'ผลสถานะไม่มี token/hash/คีย์ต้องห้าม · เพิกถอนร้าน A ไม่กระทบสถานะร้าน B (ยัง active)',
      pg_temp.badkeys(st) = '' and pg_temp.badkeys(analytics.shop_intake_token_status(a)) = '' and not (analytics.shop_intake_token_status(a) ? 'token') and not (analytics.shop_intake_token_status(a) ? 'token_hash')
      and analytics.shop_intake_token_status(b) ->> 'active' = 'true' and analytics.shop_intake_token_status(b) -> 'revoked_at' = 'null'::jsonb);
    v := v || pg_temp.chk('B6', 'argument ว่าง → 22023 · anon/authenticated เรียกไม่ได้ (42501) · service_role เรียกได้',
      pg_temp.err('select analytics.shop_intake_token_status(null)') like '22023%'
      and pg_temp.asrole('anon', format('select analytics.shop_intake_token_status(%L)', a)) = '42501'
      and pg_temp.asrole('authenticated', format('select analytics.shop_intake_token_status(%L)', a)) = '42501'
      and pg_temp.asrole('service_role', format('select analytics.shop_intake_token_status(%L)', a)) = 'OK');
    raise exception 'rb_188';
  exception when others then
    if sqlerrm <> 'rb_188' then v := v || pg_temp.chk('B-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- C. job_worker_open: advisory lock ต่อ (ร้าน, SKU) ก่อนเช็ค job_exists (QA race) · ลำดับล็อกคงที่ idem → SKU
  begin
    ik := pg_temp.ik(); n0 := pg_temp.nlocks();
    r := pg_temp.opn(sM, jsonb_build_object('product', fixb, 'qty', 2, 'idem', ik));
    n1 := pg_temp.nlocks();
    v := v || pg_temp.chk('C1', 'เปิดแบบมี SKU สำเร็จ: ถือ lock ต่อ (ร้าน, SKU) + lock idem = 2 ตัวใหม่ · ' || coalesce(r ->> 'code', 'ok') || ' · delta=' || (n1 - n0),
      r ->> 'ok' = 'true' and n1 - n0 = 2 and pg_temp.holds_lock('intake:product:' || a::text || ':' || fixb::text) and pg_temp.holds_lock('intake:' || a::text || ':' || ik));
    r2 := pg_temp.opn(sM2, jsonb_build_object('product', fixb, 'qty', 2));
    v := v || pg_temp.chk('C2', 'ผู้จัดการอีกคน เปิด SKU เดิมคนละ idem key = job_exists + เลขใบเดิม (ด่านเดิมทำงานหลังล็อก) · ไม่เกิดใบที่สอง',
      r2 ->> 'ok' = 'false' and r2 ->> 'code' = 'job_exists' and r2 ->> 'job_no' = r ->> 'job_no'
      and (select count(*) from analytics.job where shop_id = a and product_id = fixb and parent_job_id is null) = 1);
    r2 := pg_temp.opn(sM, jsonb_build_object('product', fixb, 'qty', 2, 'idem', ik));
    v := v || pg_temp.chk('C3', 'กดซ้ำ key เดิม = ใบเดิม (already) ไม่ชน job_exists (idem มาก่อน)', r2 ->> 'ok' = 'true' and r2 ->> 'already' = 'true' and r2 ->> 'job_no' = r ->> 'job_no');
    raise exception 'rb_188';
  exception when others then
    if sqlerrm <> 'rb_188' then v := v || pg_temp.chk('C-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    n0 := pg_temp.nlocks();
    r := pg_temp.opn(sM, jsonb_build_object('label', 'แหวนไม่มีรหัส C188', 'metal', 'silver'));
    n1 := pg_temp.nlocks();
    v := v || pg_temp.chk('C4', 'ต้องไม่พัง: เปิดแบบไม่มี SKU ใช้ได้ตามเดิม · ถือแค่ lock idem (ไม่มี product_id ให้ล็อก) · delta=' || (n1 - n0), r ->> 'ok' = 'true' and n1 - n0 = 1);
    n0 := pg_temp.nlocks();
    r2 := pg_temp.opn(sM, jsonb_build_object('product', pg_temp.fx('off'), 'qty', 1));
    n1 := pg_temp.nlocks();
    v := v || pg_temp.chk('C5', 'SKU ปิดใช้ → sku_invalid ก่อนถึงด่านล็อก (ไม่ถือล็อกใดเลย — คำขอที่ตกไม่เก็บล็อกค้าง) · delta=' || (n1 - n0), r2 ->> 'code' = 'sku_invalid' and n1 - n0 = 0);
    raise exception 'rb_188';
  exception when others then
    if sqlerrm <> 'rb_188' then v := v || pg_temp.chk('C4-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    r := pg_temp.opn(sM, jsonb_build_object('product', fixa, 'qty', 1));
    r2 := pg_temp.opn(sM2, jsonb_build_object('product', fixc, 'qty', 1));
    v := v || pg_temp.chk('C6', 'ต้องไม่พัง: คนละ SKU เปิดได้ทั้งคู่ (ล็อกต่อ SKU ไม่ใช่ทั้งร้าน) · ใบคนละเลข', r ->> 'ok' = 'true' and r2 ->> 'ok' = 'true' and r ->> 'job_no' <> r2 ->> 'job_no');
    def := pg_get_functiondef('analytics.job_worker_open(text,text,text,uuid,text,text,numeric,numeric,integer,integer,date,boolean,text,text,text)'::regprocedure);
    p_idem := position('hashtextextended(''intake:'' || v_shop::text || '':'' || p_idem_key' in def);
    p_prod := position('hashtextextended(''intake:product:'' || v_shop::text' in def);
    v := v || pg_temp.chk('C7', 'ลำดับล็อกคงที่ในนิยาม: idem key มาก่อน SKU เสมอ (กัน deadlock) · SKU lock อยู่ก่อนเช็ค job_exists',
      p_idem > 0 and p_prod > p_idem and p_prod < position('hint = ''job_exists''' in def));
    raise exception 'rb_188';
  exception when others then
    if sqlerrm <> 'rb_188' then v := v || pg_temp.chk('C6-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- D. ข้อความ name_invalid ไม่ระบุตัวเลขความยาว (UI จำกัดต่างจาก DB) · ชื่อ 200 ตัวอักษรยังผ่าน (ต้องไม่พัง)
  begin
    r := pg_temp.opn(sM, jsonb_build_object('label', '<b>x</b>', 'metal', 'silver'));
    msg := r ->> 'message';
    v := v || pg_temp.chk('D1', 'name_invalid (มี < >): code เดิม · ข้อความไม่มีตัวเลขเลย · ได้: ' || coalesce(msg, '-'), r ->> 'code' = 'name_invalid' and msg !~ '[0-9]' and msg like 'ชื่อแบบไม่ถูกต้อง%');
    r2 := pg_temp.opn(sM, jsonb_build_object('label', repeat('ก', 201), 'metal', 'silver'));
    v := v || pg_temp.chk('D2', 'name_invalid (ยาว 201): code เดิม · ข้อความเดียวกัน ไม่มีตัวเลข', r2 ->> 'code' = 'name_invalid' and r2 ->> 'message' = msg);
    r2 := pg_temp.opn(sM, jsonb_build_object('label', repeat('ก', 200), 'metal', 'silver'));
    v := v || pg_temp.chk('D3', 'ต้องไม่พัง: ชื่อยาว 200 พอดีผ่าน (ขอบเพดานไม่เปลี่ยน — เปลี่ยนแค่ข้อความ)', r2 ->> 'ok' = 'true');
    raise exception 'rb_188';
  exception when others then
    if sqlerrm <> 'rb_188' then v := v || pg_temp.chk('D-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  return v;
end;
$c$;

-- ============================================================================
-- M. mutant: ย้อน/ลบด่านทีละตัวแล้วเทสต์ต้องล้มจริง (id ที่คาด) — ไม่ล้ม = เทสต์ไม่ได้ป้องกันด่านนั้น
-- ============================================================================
create function pg_temp.g_188_mut() returns text
 language plpgsql as $c$
declare
  v text := ''; s text; k int; muts jsonb; m jsonb; hit int; i text; killed int := 0; total int;
  sigo text := 'analytics.job_worker_open(text,text,text,uuid,text,text,numeric,numeric,integer,integer,date,boolean,text,text,text)';
begin
  muts := jsonb_build_array(
    jsonb_build_object('id', 'MA', 'what', 'close gate: ข้อความ ack_required กลับไปใช้ new.po_no (NULL)', 'sig', 'analytics.production_order_close_gate()',
      'from', 'old.po_no using errcode = ''22023'', hint = ''ack_required''', 'to', 'new.po_no using errcode = ''22023'', hint = ''ack_required''', 'expect', jsonb_build_array('A2', 'A4')),
    jsonb_build_object('id', 'MB', 'what', 'close gate: ข้อความ sku_required กลับไปใช้ new.po_no (NULL)', 'sig', 'analytics.production_order_close_gate()',
      'from', 'old.po_no using errcode = ''22023'', hint = ''sku_required''', 'to', 'new.po_no using errcode = ''22023'', hint = ''sku_required''', 'expect', jsonb_build_array('A5')),
    jsonb_build_object('id', 'MC', 'what', 'status: ไม่มีใบ active แล้วไม่คืน issued_at/revoked_at (กลับเป็น null)', 'sig', 'analytics.shop_intake_token_status(uuid)',
      'from', 'return jsonb_build_object(''active'', false, ''issued_at'', v_row.issued_at, ''revoked_at'', v_row.revoked_at);', 'to', 'return jsonb_build_object(''active'', false, ''issued_at'', null, ''revoked_at'', null);', 'expect', jsonb_build_array('B2', 'B3')),
    jsonb_build_object('id', 'MD', 'what', 'status: เลือกใบ "เก่าสุด" แทนใบล่าสุด', 'sig', 'analytics.shop_intake_token_status(uuid)',
      'from', 'order by issued_at desc, id limit 1', 'to', 'order by issued_at asc, id limit 1', 'expect', jsonb_build_array('B3')),
    jsonb_build_object('id', 'ME', 'what', 'status: ใบ active ไม่คืน key revoked_at', 'sig', 'analytics.shop_intake_token_status(uuid)',
      'from', 'return jsonb_build_object(''active'', true, ''issued_at'', v_row.issued_at, ''revoked_at'', null);', 'to', 'return jsonb_build_object(''active'', true, ''issued_at'', v_row.issued_at);', 'expect', jsonb_build_array('B1')),
    jsonb_build_object('id', 'MF', 'what', 'job_worker_open: ไม่ล็อกต่อ (ร้าน, SKU) (แทนด้วย abs — ไม่ล็อกอะไร)', 'sig', sigo,
      'from', 'pg_advisory_xact_lock(hashtextextended(''intake:product:''', 'to', 'abs(hashtextextended(''intake:product:''', 'expect', jsonb_build_array('C1')),
    jsonb_build_object('id', 'MG', 'what', 'job_worker_open: name_invalid กลับไประบุ 200 ตัวอักษร', 'sig', sigo,
      'from', 'และต้องไม่ยาวเกินกำหนด', 'to', 'และยาวไม่เกิน 200 ตัวอักษร', 'expect', jsonb_build_array('D1')));
  total := jsonb_array_length(muts);
  for k in 0 .. total - 1 loop
    m := muts -> k; s := '';
    begin
      perform pg_temp.mutate(m ->> 'sig', m ->> 'from', m ->> 'to');
      s := pg_temp.g_188();
      raise exception 'MX_ROLLBACK';
    exception when others then
      if sqlerrm <> 'MX_ROLLBACK' then s := s || '[FAIL] MX-crash-' || (m ->> 'id') || '  ' || sqlerrm || E'\n'; end if;
    end;
    hit := 0;
    for i in select jsonb_array_elements_text(m -> 'expect') loop
      if position('[FAIL] ' || i || ' ' in s) > 0 then hit := hit + 1; end if;
    end loop;
    if hit = jsonb_array_length(m -> 'expect') then
      killed := killed + 1; v := v || format('[OK] %s  mutant ถูกจับ (%s/%s id): %s', m ->> 'id', hit, jsonb_array_length(m -> 'expect'), m ->> 'what') || E'\n';
    else
      v := v || format('[FAIL] %s  mutant รอด (จับได้ %s/%s id ที่คาด): %s', m ->> 'id', hit, jsonb_array_length(m -> 'expect'), m ->> 'what') || E'\n';
    end if;
  end loop;
  v := v || pg_temp.chk('MX', format('mutant ถูกจับครบ %s/%s', killed, total), killed = total);
  return v;
end;
$c$;

-- ============================================================================
-- runner
-- ============================================================================
do $v188$
declare
  v_msg text := E'\n=== verify 0188 ===\n';
  v_snap0 text; v_hit int; v_fail int; v_ok int; v_skip int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  create temp table _v188_orig on commit drop as
    select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h, p.proacl::text as acl
      from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.prokind in ('f', 'p');
  v_snap0 := pg_temp.snap();
  begin
    v_msg := v_msg || pg_temp.g_setup();
    -- G: สัญญาของ migration — 1 แถวต่อชื่อ · signature เดิม · สิทธิ์ · done ไม่ถูกแตะ
    v_msg := v_msg || pg_temp.chk('G1', 'ฟังก์ชันที่แก้ 3 ตัว: 1 แถวต่อชื่อ (ไม่มี overload ซ้อน) · signature เดิม',
      (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace and proname in ('production_order_close_gate', 'shop_intake_token_status', 'job_worker_open')) = 3
      and to_regprocedure('analytics.shop_intake_token_status(uuid)') is not null
      and to_regprocedure('analytics.production_order_close_gate()') is not null
      and to_regprocedure('analytics.job_worker_open(text,text,text,uuid,text,text,numeric,numeric,integer,integer,date,boolean,text,text,text)') is not null);
    v_msg := v_msg || pg_temp.chk('G2', 'สิทธิ์: status/open เปิดแค่ service_role (anon/authenticated/public ไม่ได้) · close_gate ไม่เปิดใครเลย (trigger function)',
      has_function_privilege('service_role', 'analytics.shop_intake_token_status(uuid)', 'execute')
      and has_function_privilege('service_role', 'analytics.job_worker_open(text,text,text,uuid,text,text,numeric,numeric,integer,integer,date,boolean,text,text,text)', 'execute')
      and not has_function_privilege('anon', 'analytics.shop_intake_token_status(uuid)', 'execute') and not has_function_privilege('authenticated', 'analytics.shop_intake_token_status(uuid)', 'execute')
      and not has_function_privilege('anon', 'analytics.job_worker_open(text,text,text,uuid,text,text,numeric,numeric,integer,integer,date,boolean,text,text,text)', 'execute')
      and not has_function_privilege('authenticated', 'analytics.job_worker_open(text,text,text,uuid,text,text,numeric,numeric,integer,integer,date,boolean,text,text,text)', 'execute')
      and not has_function_privilege('service_role', 'analytics.production_order_close_gate()', 'execute') and not has_function_privilege('anon', 'analytics.production_order_close_gate()', 'execute')
      and not has_function_privilege('authenticated', 'analytics.production_order_close_gate()', 'execute'));
    v_msg := v_msg || pg_temp.chk('G3', 'production_order_done (ฟังก์ชัน 💰) ไม่ถูกแตะ: md5 ตรงค่าที่ล็อกไว้ใน 0187', pg_temp.done_md5() = pg_temp.done_md5_before());
    v_msg := v_msg || pg_temp.g_188();
    v_msg := v_msg || pg_temp.g_188_mut();
    select count(*) into v_hit from _v188_orig o join pg_proc p on p.pronamespace = 'analytics'::regnamespace and p.prokind in ('f', 'p') and p.oid::regprocedure::text = o.sig
     where md5(pg_get_functiondef(p.oid)) = o.h and p.proacl::text is not distinct from o.acl;
    v_msg := v_msg || pg_temp.chk('MY', format('หลัง mutant: md5 นิยาม + สิทธิ์ของฟังก์ชันทุกตัวในสคีมา analytics (%s ตัว) เท่าเดิมเป๊ะ', (select count(*) from _v188_orig)),
      v_hit = (select count(*) from _v188_orig) and (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace and prokind in ('f', 'p')) = (select count(*) from _v188_orig));
    raise exception 'V188_ROLLBACK';
  exception when others then
    if sqlerrm <> 'V188_ROLLBACK' then v_msg := v_msg || format('[FAIL] S1-crash  ชุดหลัก raise นอกกลุ่ม: %s %s', sqlstate, sqlerrm) || E'\n'; end if;
  end;
  v_msg := v_msg || pg_temp.chk('K0', 'ชุดทดสอบไม่ทิ้งรอย: snapshot (job/ใบผลิต/รายการ/QR ร้าน/ช่าง/session/ตัวนับ/lot/สต็อก/product/shop) เท่าเดิมหลังถอยกลับ', pg_temp.snap() = v_snap0);
  v_fail := (length(v_msg) - length(replace(v_msg, '[FAIL]', ''))) / length('[FAIL]');
  v_skip := (length(v_msg) - length(replace(v_msg, '[SKIP]', ''))) / length('[SKIP]');
  v_ok := (length(v_msg) - length(replace(v_msg, '[OK]', ''))) / length('[OK]');
  v_msg := v_msg || format(E'\n--- สรุป: OK %s · FAIL %s · SKIP %s ---', v_ok, v_fail, v_skip);
  raise exception '%', v_msg;
end;
$v188$;
