-- scripts/verify/verify-0189-qa-ui.sql — QA W2-UI (R2-D2 · 21 ต.ค. 69): payload ที่ UI ส่ง (lib/jobs/shop-photo-server.ts · useShopPhotos.ts) ยิงเข้า RPC 0189 จริง
-- self-rolling-back (3j-migration-traps ข้อ 11) · exit 1 = ผลที่คาด (อ่านผลจาก error message) · [FAIL] >= 1 = ไม่ผ่าน · ไฟล์ LF (ข้อ 20)
-- dry-run: ต่อ supabase/migrations/0189_shop_photos_w2.sql (แปลงเป็น LF) + ไฟล์นี้ แล้ว `node scripts/run-sql.mjs <ไฟล์รวม>` โดยไม่ใส่ --commit · หลัง apply 0189 แล้วรันไฟล์นี้เดี่ยวๆ ได้
-- ส่วน helper/setup (ก่อน "QA W2-UI:" ด้านล่าง) = ท่อนเดียวกับ scripts/verify/verify-0189.sql (บรรทัด set local statement_timeout … helper 0189) — คัดมาเพื่อให้ไฟล์นี้รันเดี่ยวได้
-- เคสที่ครอบ: UI1-4 begin+add (idemKey uuid 36 ตัว · clientPhotoKey · bytes ขอบ 2 MB · already · สลับรูปหลัก · เพดาน 3) · UI5 ★ ทาง idemKey/jobId · UI6 list (key ที่ TS อ่าน) · UI7 ลบ/ลบซ้ำ/key ที่ลบแล้ว ·
--   UI8 my_intake_list · UI9 ข้ามคน · UI10 ล็อกเมื่อช่างรับ · UI11 reissue (idem · already · token_cap · rate_limited · TOKEN_RE) · UI12 ตารางเหตุผลลบของออฟฟิศ ([INFO] RS|… ใช้เทียบ lib/jobs/photo-reason.db-parity.test.ts)
-- ไม่ครอบ: storage จริง (bucket) · race 2 connection · Exif — ดู verify-0189.sql + vitest
set local statement_timeout = '30min';

create temp table _v189_fx (k text primary key, id uuid not null) on commit drop;
create temp table _v189_kv (k text primary key, v text not null) on commit drop;

create function pg_temp.chk(p_id text, p_desc text, p_ok boolean) returns text
 language sql as $c$
  select format('[%s] %s  %s', case when coalesce(p_ok, false) then 'OK' else 'FAIL' end, p_id, p_desc) || E'\n'
$c$;
create function pg_temp.fx(p_k text) returns uuid language sql as $c$ select id from _v189_fx where k = p_k $c$;
create function pg_temp.setfx(p_k text, p_id uuid) returns void language sql as $c$
  insert into _v189_fx (k, id) values (p_k, p_id) on conflict (k) do update set id = excluded.id $c$;
create function pg_temp.kv(p_k text) returns text language sql as $c$ select v from _v189_kv where k = p_k $c$;
create function pg_temp.setkv(p_k text, p_v text) returns void language sql as $c$
  insert into _v189_kv (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $c$;
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
create function pg_temp.po(p_shop uuid, p_note text default 'verify0189') returns uuid
 language sql as $c$ select (analytics.production_order_save(p_shop, null, p_note, null) ->> 'id')::uuid $c$;
-- ใบผลิตออฟฟิศ + รายการ + ใบงาน (สร้างผ่าน RPC ออฟฟิศเดิม) · คืน {po, item, job}
create function pg_temp.office_job(p_shop uuid, p_product uuid) returns jsonb
 language plpgsql as $c$
declare o uuid; r jsonb; j jsonb;
begin
  o := pg_temp.po(p_shop, 'office-v189');
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
-- A. setup (ร้านสังเคราะห์ ZZ189 A/B — insert public.shop ตรงตามแพทเทิร์น verify-0144/0186: ข้อยกเว้นที่ไม่ผ่าน RPC · บอกตรงๆ) · ที่เหลือผ่าน RPC ของระบบ
-- ============================================================================
create function pg_temp.g_setup() returns text
 language plpgsql as $c$
declare
  v text := '';
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  p uuid; r jsonb; w uuid; j jsonb; s jsonb;
begin
  insert into public.shop (id, name) values (a, 'ZZ TEST verify-0189 A'), (b, 'ZZ TEST verify-0189 B');
  perform pg_temp.setfx('A', a); perform pg_temp.setfx('B', b);
  perform analytics.job_stage_def_ensure(a); perform analytics.job_record_profile_ensure(a);
  perform analytics.job_stage_def_ensure(b); perform analytics.job_record_profile_ensure(b);
  -- SKU ร้าน A
  p := analytics.product_upsert(a, 'ZZ189-FIXA', 'แหวนทดสอบ A', null, 'fixed', 88, null, null, null, 150, null, null, null, true); perform pg_temp.setfx('fixa', p);
  p := analytics.product_upsert(a, 'ZZ189-FIXB', 'แหวนทดสอบ B', null, 'fixed', 50, null, null, null, null, null, null, null, true); perform pg_temp.setfx('fixb', p);
  p := analytics.product_upsert(a, 'ZZ189-SPOT', 'spot 10g .925', null, 'spot', null, 10, 0.925, 20, 300, null, null, null, true); perform pg_temp.setfx('spot', p);
  p := analytics.product_upsert(a, 'ZZ189-W35', 'เงินมีน้ำหนัก 3.5', null, 'fixed', 60, 3.5, 0.925, null, null, null, null, null, true); perform pg_temp.setfx('w35', p);
  p := analytics.product_upsert(a, 'ZZ189-JT', 'ใบงานตั้งต้น (ออฟฟิศ)', null, 'fixed', 40, null, null, null, null, null, null, null, true); perform pg_temp.setfx('jt', p);
  p := analytics.product_upsert(a, 'ZZ189-FIXC', 'แหวนทดสอบ C', null, 'fixed', 55, null, null, null, null, null, null, null, true); perform pg_temp.setfx('fixc', p);
  p := analytics.product_upsert(a, 'live189', 'live sku', null, 'fixed', 10, null, null, null, null, null, null, null, true); perform pg_temp.setfx('live', p);
  p := analytics.product_upsert(a, 'ZZ189-OFF', 'ปิดใช้งาน', null, 'fixed', 10, null, null, null, null, null, null, null, false); perform pg_temp.setfx('off', p);
  p := analytics.product_upsert(b, 'ZZ189-BSKU', 'SKU ร้าน B', null, 'fixed', 70, null, null, null, null, null, null, null, true); perform pg_temp.setfx('bsku', p);
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
  foreach t in array array['analytics.job', 'analytics.job_photo', 'analytics.job_stage', 'analytics.job_event', 'analytics.job_token', 'analytics.worker', 'analytics.worker_audit', 'analytics.worker_session', 'analytics.worker_rate_limit',
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

-- ============================================================================
-- helper เฉพาะ 0189
-- ============================================================================
create function pg_temp.pmd(p_shop uuid, p_job uuid, p_id uuid) returns text language sql as $c$ select p_shop::text || '/' || p_job::text || '/' || p_id::text || '_md.jpg' $c$;
create function pg_temp.psm(p_shop uuid, p_job uuid, p_id uuid) returns text language sql as $c$ select p_shop::text || '/' || p_job::text || '/' || p_id::text || '_sm.jpg' $c$;
create function pg_temp.nph(p_job uuid) returns int language sql as $c$ select count(*)::int from analytics.job_photo where job_id = p_job and deleted_at is null $c$;
create function pg_temp.nph_all(p_shop uuid) returns int language sql as $c$ select count(*)::int from analytics.job_photo where shop_id = p_shop $c$;
-- ล้างถังจำกัดอัตราก่อนทุกครั้งที่เรียก (เคสที่วัด rate limit ส่ง rl=1 เพื่อไม่ให้ล้าง)
create function pg_temp.rlclear(p jsonb) returns void language plpgsql as $c$
begin
  -- ล้างถังจำกัดอัตรา "ยกเว้นร่องรอย idempotency ของออก QR (ri:)" — เคส idem ของ token_reissue ต้องมีร่องรอยข้ามคำเรียก
  if coalesce(p ->> 'rl', '0') <> '1' then delete from analytics.worker_rate_limit where key not like 'ri:%'; end if;
end;
$c$;
-- p: {job: uuid อ้างใบด้วย job_id · ip · rl}
create function pg_temp.pb(p_sess text, p_idem text, p jsonb default '{}'::jsonb, p_tokh text default null) returns jsonb
 language plpgsql as $c$
begin
  perform pg_temp.rlclear(p);
  return pg_temp.q(format('select analytics.job_worker_photo_begin(%L, %L, %L, %L, %L, %L)', coalesce(p_tokh, pg_temp.th()), p_sess, p_idem, p ->> 'ip', p ->> 'job', p ->> 'key'));
end;
$c$;
-- p: {md · sm · bytes · w · h · prim · job · ip · rl}
create function pg_temp.pa(p_sess text, p_idem text, p_pid uuid, p_shop uuid, p_job uuid, p jsonb default '{}'::jsonb, p_tokh text default null) returns jsonb
 language plpgsql as $c$
begin
  perform pg_temp.rlclear(p);
  return pg_temp.q(format('select analytics.job_worker_photo_add(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L)',
    coalesce(p_tokh, pg_temp.th()), p_sess, p_idem, p_pid, coalesce(p ->> 'md', pg_temp.pmd(p_shop, p_job, p_pid)), coalesce(p ->> 'sm', pg_temp.psm(p_shop, p_job, p_pid)),
    coalesce(p ->> 'bytes', '1000'), coalesce(p ->> 'w', '1200'), coalesce(p ->> 'h', '800'), coalesce(p ->> 'prim', 'false'), 'verify-ua/1.0', p ->> 'ip', p ->> 'job', p ->> 'key'));
end;
$c$;
create function pg_temp.prm(p_sess text, p_pid uuid, p jsonb default '{}'::jsonb, p_tokh text default null) returns jsonb
 language plpgsql as $c$
begin
  perform pg_temp.rlclear(p);
  return pg_temp.q(format('select analytics.job_worker_photo_remove(%L, %L, %L, %L, %L)', coalesce(p_tokh, pg_temp.th()), p_sess, p_pid, 'verify-ua/1.0', p ->> 'ip'));
end;
$c$;
create function pg_temp.pls(p_sess text, p_idem text, p jsonb default '{}'::jsonb, p_tokh text default null) returns jsonb
 language plpgsql as $c$
begin
  perform pg_temp.rlclear(p);
  return pg_temp.q(format('select analytics.job_worker_photo_list(%L, %L, %L, %L, %L)', coalesce(p_tokh, pg_temp.th()), p_sess, p_idem, p ->> 'ip', p ->> 'job'));
end;
$c$;
create function pg_temp.pmy(p_sess text, p jsonb default '{}'::jsonb, p_tokh text default null) returns jsonb
 language plpgsql as $c$
begin
  perform pg_temp.rlclear(p);
  return pg_temp.q(format('select analytics.job_worker_my_intake_list(%L, %L, %L)', coalesce(p_tokh, pg_temp.th()), p_sess, p ->> 'ip'));
end;
$c$;
-- ตั้งรูปหลัก: p = {idem | job · ip · rl}
create function pg_temp.psp(p_sess text, p_photo uuid, p jsonb default '{}'::jsonb, p_tokh text default null) returns jsonb
 language plpgsql as $c$
begin
  perform pg_temp.rlclear(p);
  return pg_temp.q(format('select analytics.job_worker_photo_set_primary(%L, %L, %L, %L, %L, %L)', coalesce(p_tokh, pg_temp.th()), p_sess, p_photo, p ->> 'ip', p ->> 'idem', p ->> 'job'));
end;
$c$;
-- ออฟฟิศลบรูป (RPC เดิม job_photo_remove)
create function pg_temp.offrm(p_shop uuid, p_photo uuid, p_reason text) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.job_photo_remove(%L, %L, %L, %L)', p_shop, p_photo, p_reason, pg_temp.act())) $c$;
create function pg_temp.trs(p_sess text, p_job uuid, p jsonb default '{}'::jsonb, p_tokh text default null) returns jsonb
 language plpgsql as $c$
begin
  perform pg_temp.rlclear(p);
  return pg_temp.q(format('select analytics.job_worker_token_reissue(%L, %L, %L, %L, %L)', coalesce(p_tokh, pg_temp.th()), p_sess, p_job, p ->> 'ip', p ->> 'idem'));
end;
$c$;
-- เปิดใบแบบไม่มี SKU ด้วย idem ที่กำหนด (ช่าง = session ที่ส่งมา) → {job, po, item, job_no, token, ...}
create function pg_temp.open_ik(p_idem text, p_sess text default null, p_label text default 'แหวน W2') returns jsonb
 language sql as $c$ select pg_temp.open_label(p_label, jsonb_build_object('idem', p_idem), p_sess) $c$;
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
-- รูปออฟฟิศ (RPC ออฟฟิศเดิม job_photo_add)
create function pg_temp.offadd(p_shop uuid, p_job uuid, p_id uuid) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_photo_add(p_shop_id=>%L, p_job_id=>%L, p_kind=>''reference'', p_source=>''office'', p_storage_path=>%L, p_variant_sm_path=>%L, p_bytes=>1000, p_width=>1200, p_height=>800, p_actor=>%L)',
    p_shop, p_job, pg_temp.pmd(p_shop, p_job, p_id), pg_temp.psm(p_shop, p_job, p_id), pg_temp.act())) $c$;
create function pg_temp.ev(p_job uuid, p_type text) returns setof analytics.job_event
 language sql as $c$ select * from analytics.job_event where job_id = p_job and event_type = p_type order by recorded_at, id $c$;


-- ============================================================================
-- QA W2-UI: payload ที่ UI ส่ง (lib/jobs/shop-photo-server.ts + useShopPhotos.ts) ยิงเข้า RPC จริง · ทุกเคส rb_ui rollback
-- ============================================================================
-- put = begin + add ตามลำดับที่ shop-photo-server.uploadIntakePhoto ทำ (photo_id จาก begin · md/sm path ประกอบจาก uuid ของ DB · bytes = md+sm)
create function pg_temp.put(p_sess text, p_idem text, p_job uuid, p_key uuid, p_prim boolean, p_bytes int default 2097152) returns jsonb
 language plpgsql as $c$
declare b jsonb; r jsonb; pid uuid; a uuid := pg_temp.fx('A');
begin
  if p_idem is not null then
    b := pg_temp.pq_begin(p_sess, p_idem, null, p_key);
  else
    b := pg_temp.pq_begin(p_sess, null, p_job, p_key);
  end if;
  if b ->> 'ok' is distinct from 'true' then return jsonb_build_object('stage', 'begin', 'r', b); end if;
  if (b ->> 'already') = 'true' then return jsonb_build_object('stage', 'begin-already', 'r', b); end if;
  pid := (b ->> 'photo_id')::uuid;
  r := pg_temp.pq_add(p_sess, p_idem, p_job, pid, a, (b ->> 'job_id')::uuid, p_key, p_prim, p_bytes);
  return jsonb_build_object('stage', 'add', 'r', r, 'pid', pid, 'job', b ->> 'job_id');
end;
$c$;
-- เหมือน PostgREST: ส่งทั้ง p_idem_key และ p_job_id เสมอ (อีกตัว null) · p_client_key ส่งเฉพาะเมื่อมี
create function pg_temp.pq_begin(p_sess text, p_idem text, p_job uuid, p_key uuid) returns jsonb
 language plpgsql as $c$
begin
  delete from analytics.worker_rate_limit where key not like 'ri:%';
  if p_key is null then
    return pg_temp.q(format('select analytics.job_worker_photo_begin(p_token_hash=>%L, p_session_hash=>%L, p_ip_hash=>null, p_idem_key=>%L, p_job_id=>%L)', pg_temp.th(), p_sess, p_idem, p_job));
  end if;
  return pg_temp.q(format('select analytics.job_worker_photo_begin(p_token_hash=>%L, p_session_hash=>%L, p_ip_hash=>null, p_idem_key=>%L, p_job_id=>%L, p_client_key=>%L)', pg_temp.th(), p_sess, p_idem, p_job, p_key));
end;
$c$;
create function pg_temp.pq_add(p_sess text, p_idem text, p_jobref uuid, p_pid uuid, p_shop uuid, p_job uuid, p_key uuid, p_prim boolean, p_bytes int) returns jsonb
 language plpgsql as $c$
begin
  delete from analytics.worker_rate_limit where key not like 'ri:%';
  return pg_temp.q(format('select analytics.job_worker_photo_add(p_token_hash=>%L, p_session_hash=>%L, p_ip_hash=>null, p_idem_key=>%L, p_job_id=>%L, p_photo_id=>%L, p_storage_path=>%L, p_variant_sm_path=>%L, p_bytes=>%L, p_width=>%L, p_height=>%L, p_is_primary=>%L, p_user_agent=>%L%s)',
    pg_temp.th(), p_sess, p_idem, p_jobref, p_pid, pg_temp.pmd(p_shop, p_job, p_pid), pg_temp.psm(p_shop, p_job, p_pid), p_bytes, 1200, 900, p_prim, 'ua',
    case when p_key is null then '' else format(', p_client_key=>%L', p_key) end));
end;
$c$;
create function pg_temp.pq_sp(p_sess text, p_photo uuid, p_idem text, p_job uuid) returns jsonb
 language plpgsql as $c$
begin
  delete from analytics.worker_rate_limit where key not like 'ri:%';
  return pg_temp.q(format('select analytics.job_worker_photo_set_primary(p_token_hash=>%L, p_session_hash=>%L, p_photo_id=>%L, p_ip_hash=>null, p_idem_key=>%L, p_job_id=>%L)', pg_temp.th(), p_sess, p_photo, p_idem, p_job));
end;
$c$;
create function pg_temp.pq_list(p_sess text, p_idem text, p_job uuid) returns jsonb
 language plpgsql as $c$
begin
  delete from analytics.worker_rate_limit where key not like 'ri:%';
  return pg_temp.q(format('select analytics.job_worker_photo_list(p_token_hash=>%L, p_session_hash=>%L, p_ip_hash=>null, p_idem_key=>%L, p_job_id=>%L)', pg_temp.th(), p_sess, p_idem, p_job));
end;
$c$;
create function pg_temp.pq_rm(p_sess text, p_photo uuid) returns jsonb
 language plpgsql as $c$
begin
  delete from analytics.worker_rate_limit where key not like 'ri:%';
  return pg_temp.q(format('select analytics.job_worker_photo_remove(p_token_hash=>%L, p_session_hash=>%L, p_photo_id=>%L, p_user_agent=>%L, p_ip_hash=>null)', pg_temp.th(), p_sess, p_photo, 'ua'));
end;
$c$;
-- reissue: TS ใส่ p_idem_key เฉพาะเมื่อเป็น string
create function pg_temp.pq_rs(p_sess text, p_job uuid, p_idem text) returns jsonb
 language plpgsql as $c$
begin
  -- ไม่ล้างถังก่อน (วัด rate limit ด้วย) — ผู้เรียกล้างเองเมื่อต้องการ
  if p_idem is null then
    return pg_temp.q(format('select analytics.job_worker_token_reissue(p_token_hash=>%L, p_session_hash=>%L, p_job_id=>%L, p_ip_hash=>null)', pg_temp.th(), p_sess, p_job));
  end if;
  return pg_temp.q(format('select analytics.job_worker_token_reissue(p_token_hash=>%L, p_session_hash=>%L, p_job_id=>%L, p_ip_hash=>null, p_idem_key=>%L)', pg_temp.th(), p_sess, p_job, p_idem));
end;
$c$;
create function pg_temp.nprim(p_job uuid) returns int language sql as $c$ select count(*)::int from analytics.job_photo where job_id = p_job and is_primary and deleted_at is null $c$;

create function pg_temp.g_ui() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A');
  sM text := pg_temp.kv('sM'); sM2 text := pg_temp.kv('sM2');
  ik text; ik2 text; o jsonb; j uuid; j2 uuid; r jsonb; r2 jsonb; l jsonb; m jsonb; x jsonb;
  k1 uuid := gen_random_uuid(); k2 uuid := gen_random_uuid(); k3 uuid := gen_random_uuid(); k4 uuid := gen_random_uuid(); k5 uuid := gen_random_uuid();
  p1 uuid; p2 uuid; p3 uuid; p5 uuid; ri1 text; ri2 text; ri3 text; n int; ok_cnt int; last jsonb; reasons jsonb; rs text; res text; tok text; bad text;
begin
  -- ===== UI1-UI4: อัปโหลดทีละรูปตาม flow W-8 (idemKey = idem key ที่ใช้เปิดใบ · uuid 36 ตัวแบบ newIdemKey) =====
  begin
    ik := gen_random_uuid()::text; o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    r := pg_temp.put(sM, ik, null, k1, true, 2097152);
    p1 := (r ->> 'pid')::uuid;
    v := v || pg_temp.chk('UI1', 'idemKey = uuid 36 ตัว (ตรง newIdemKey) · begin+add รูปแรก prim=true bytes=2097152 (ขอบเพดาน md1MB+sm1MB) → ok · is_primary true · count 1 · max 3 · ' || coalesce(r::text, ''),
      r ->> 'stage' = 'add' and (r -> 'r' ->> 'ok') = 'true' and (r -> 'r' ->> 'is_primary') = 'true' and (r -> 'r' ->> 'count') = '1' and (r -> 'r' ->> 'max') = '3');
    -- UI2: คำขอหลุดกลางทางแล้ว "ลองใหม่" ด้วย clientPhotoKey เดิม
    r := pg_temp.pq_begin(sM, ik, null, k1);
    v := v || pg_temp.chk('UI2a', 'ลองใหม่ด้วย clientPhotoKey เดิม: begin → ok already=true photo_id เดิม · ไม่สร้างแถวใหม่', r ->> 'ok' = 'true' and r ->> 'already' = 'true' and (r ->> 'photo_id')::uuid = p1 and pg_temp.nph(j) = 1);
    r := pg_temp.pq_add(sM, ik, null, gen_random_uuid(), a, j, k1, true, 1000);
    v := v || pg_temp.chk('UI2b', 'add ซ้ำด้วย key เดิม (photo_id ใหม่จาก begin รอบสอง ไม่ตรง) → already=true photo_id เดิม is_primary true · ไม่เกิดแถว', r ->> 'ok' = 'true' and r ->> 'already' = 'true' and (r ->> 'photo_id')::uuid = p1 and r ->> 'is_primary' = 'true' and pg_temp.nph(j) = 1);
    -- UI3: รูปที่ 2 (prim=false) · รูปที่ 3 prim=true → สลับหลัก (ผู้จัดการเปลี่ยน ★ ก่อนส่งรูปที่ 3)
    r := pg_temp.put(sM, ik, null, k2, false); p2 := (r ->> 'pid')::uuid;
    v := v || pg_temp.chk('UI3a', 'รูปที่ 2 prim=false → is_primary false · count 2', (r -> 'r' ->> 'ok') = 'true' and (r -> 'r' ->> 'is_primary') = 'false' and (r -> 'r' ->> 'count') = '2' and pg_temp.nprim(j) = 1);
    r := pg_temp.put(sM, ik, null, k3, true); p3 := (r ->> 'pid')::uuid;
    v := v || pg_temp.chk('UI3b', 'รูปที่ 3 prim=true (ผู้จัดการย้าย ★ มาที่รูปนี้) → สลับหลักที่ DB: รูป 3 หลัก · รูป 1 ไม่หลัก · หลักพอดี 1', (r -> 'r' ->> 'ok') = 'true' and (r -> 'r' ->> 'is_primary') = 'true'
      and (select is_primary from analytics.job_photo where id = p3) and not (select is_primary from analytics.job_photo where id = p1) and pg_temp.nprim(j) = 1);
    r := pg_temp.pq_begin(sM, ik, null, k4);
    v := v || pg_temp.chk('UI4', 'รูปที่ 4 → begin ปฏิเสธ photo_cap_shopfloor (UI: photoErrorView = failCap · retryable false)', r ->> 'ok' = 'false' and r ->> 'code' = 'photo_cap_shopfloor');
    -- UI5: ★ หลังส่ง — ทาง W-8 (idemKey) และ W-10 (jobId)
    r := pg_temp.pq_sp(sM, p1, ik, null);
    v := v || pg_temp.chk('UI5a', 'set_primary ทาง idemKey (W-8): ok changed true · หลักพอดี 1 = รูป 1', r ->> 'ok' = 'true' and r ->> 'changed' = 'true' and (select is_primary from analytics.job_photo where id = p1) and pg_temp.nprim(j) = 1);
    r := pg_temp.pq_sp(sM, p1, ik, null);
    v := v || pg_temp.chk('UI5b', 'set_primary ซ้ำ รูปที่เป็นหลักอยู่ → ok changed false (UI ไม่ error)', r ->> 'ok' = 'true' and r ->> 'changed' = 'false');
    r := pg_temp.pq_sp(sM, p2, null, j);
    v := v || pg_temp.chk('UI5c', 'set_primary ทาง jobId (W-10): idem null + job uuid → ok changed true', r ->> 'ok' = 'true' and r ->> 'changed' = 'true' and (select is_primary from analytics.job_photo where id = p2) and pg_temp.nprim(j) = 1);
    r := pg_temp.pq_sp(sM, p2, ik, j);
    v := v || pg_temp.chk('UI5d', 'ส่ง idem+job พร้อมกัน → idem_invalid (UI action photoRef กันไว้ก่อน)', r ->> 'code' = 'idem_invalid');
    -- UI6: list ทาง jobId (W-10)
    l := pg_temp.pq_list(sM, null, j);
    v := v || pg_temp.chk('UI6a', 'list ทาง jobId: ok · locked false · count 3 · max 3 · 3 รูป mine ทุกรูป · key ตรงที่ TS อ่าน (id/sm_path/md_path/is_primary/mine)', l ->> 'ok' = 'true' and (l ->> 'locked') = 'false' and (l ->> 'count') = '3' and (l ->> 'max') = '3' and jsonb_array_length(l -> 'photos') = 3
      and not exists (select 1 from jsonb_array_elements(l -> 'photos') e where (e ->> 'mine') is distinct from 'true' or e ->> 'sm_path' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_sm\.jpg$' or e ->> 'md_path' !~ '_md\.jpg$' or (e ->> 'id') !~ '^[0-9a-f-]{36}$'));
    v := v || pg_temp.chk('UI6b', 'list: รูปหลักมาก่อน (TS ไม่เรียงใหม่) · หลัก = รูป 2', (l -> 'photos' -> 0 ->> 'id')::uuid = p2 and (l -> 'photos' -> 0 ->> 'is_primary') = 'true');
    l := pg_temp.pq_list(sM, ik, null);
    v := v || pg_temp.chk('UI6c', 'list ทาง idemKey ได้ผลเดียวกับทาง jobId (3 รูป)', l ->> 'ok' = 'true' and jsonb_array_length(l -> 'photos') = 3);
    -- UI7: ลบรูปหลัก → promoted · ลบซ้ำ → already_deleted (TS แปลงเป็น ok) · key เดิมของรูปที่ลบ → photo_key_used
    r := pg_temp.pq_rm(sM, p2);
    v := v || pg_temp.chk('UI7a', 'ลบรูปหลัก: ok · promoted_photo_id เป็นรูปที่เหลือ · หลักพอดี 1 · key ที่ TS อ่าน (storage_path/variant_sm_path/promoted_photo_id)', r ->> 'ok' = 'true' and (r ->> 'promoted_photo_id')::uuid in (p1, p3) and pg_temp.nprim(j) = 1 and r ? 'storage_path' and r ? 'variant_sm_path'
      and (select is_primary from analytics.job_photo where id = (r ->> 'promoted_photo_id')::uuid));
    r := pg_temp.pq_rm(sM, p2);
    v := v || pg_temp.chk('UI7b', 'ลบซ้ำ → code already_deleted (removeIntakePhoto แปลงเป็น ok already)', r ->> 'ok' = 'false' and r ->> 'code' = 'already_deleted');
    r := pg_temp.pq_begin(sM, ik, null, k2);
    v := v || pg_temp.chk('UI7c', 'key เดิมของรูปที่ลบแล้ว → photo_key_used (UI: failKeyUsed ไม่ให้ลองใหม่)', r ->> 'ok' = 'false' and r ->> 'code' = 'photo_key_used');
    r := pg_temp.put(sM, ik, null, k5, false); p5 := (r ->> 'pid')::uuid;
    v := v || pg_temp.chk('UI7d', 'หลังลบ 1 รูป เพิ่มรูปใหม่ด้วย key ใหม่ได้ (เพดานนับเฉพาะที่ active) · count 3', (r -> 'r' ->> 'ok') = 'true' and (r -> 'r' ->> 'count') = '3');
    -- UI8: my_intake_list
    m := pg_temp.pmy(sM);
    x := (select e from jsonb_array_elements(m -> 'jobs') e where (e ->> 'job_id')::uuid = j);
    v := v || pg_temp.chk('UI8a', 'my_intake_list: ok · open_allowed true · max_photos 3 · มีใบนี้ · key ที่ TS อ่านครบ (job_id/order_no/job_no/design_label/metal/qty/created_at/status/photos_count/my_photos_count/editable)',
      m ->> 'ok' = 'true' and (m ->> 'open_allowed') = 'true' and (m ->> 'max_photos') = '3' and x is not null
      and x ? 'order_no' and x ? 'job_no' and x ? 'design_label' and x ? 'metal' and x ? 'qty' and x ? 'created_at' and x ? 'status' and x ? 'photos_count' and x ? 'my_photos_count' and x ? 'editable');
    v := v || pg_temp.chk('UI8b', 'my_intake_list รูปแบบค่า: job_no ~ ^JB-\d+$ · qty เป็นจำนวนเต็ม ≥ 1 · my_photos_count 3 · editable true · design_label ตรงที่ตั้ง', (x ->> 'job_no') ~ '^JB-\d{1,8}$' and (x ->> 'qty') ~ '^\d+$' and (x ->> 'my_photos_count') = '3' and (x ->> 'editable') = 'true' and (x ->> 'design_label') = 'แหวน W2');
    bad := pg_temp.badkeys(m);
    v := v || pg_temp.chk('UI8c', 'my_intake_list ไม่มี key เงิน/ต้นทุน/น้ำหนักทอง/ลูกค้า · bad=[' || bad || ']', bad = '');
    m := pg_temp.pmy(sM2);
    v := v || pg_temp.chk('UI8d', 'ผู้จัดการอีกคน (sM2) ไม่เห็นใบของ sM', not exists (select 1 from jsonb_array_elements(m -> 'jobs') e where (e ->> 'job_id')::uuid = j));
    -- UI9: คนอื่นยิงใบ/รูปของ sM
    r := pg_temp.pq_list(sM2, null, j); r2 := pg_temp.pq_rm(sM2, p1);
    v := v || pg_temp.chk('UI9', 'sM2 ยิง list ด้วย jobId ของ sM → order_not_found (UI: not_owner lock) · ลบรูปของ sM → photo_not_found · รูปยังอยู่ครบ', r ->> 'code' = 'order_not_found' and r2 ->> 'code' = 'photo_not_found' and pg_temp.nph(j) = 3);
    -- UI10: ช่างรับงาน = ล็อก
    r := pg_temp.rcv(a, j);
    v := v || pg_temp.chk('UI10pre', 'ช่างรับขั้นแรก (RPC ออฟฟิศ) received=' || pg_temp.received(j)::text, pg_temp.received(j));
    l := pg_temp.pq_list(sM, null, j);
    v := v || pg_temp.chk('UI10a', 'list หลังล็อก: locked true · lock_code job_locked (TS lockKindOf → locked) · รูปยังเห็นครบ', (l ->> 'locked') = 'true' and l ->> 'lock_code' = 'job_locked' and jsonb_array_length(l -> 'photos') = 3);
    v := v || pg_temp.chk('UI10b', 'หลังล็อก: begin/set_primary/remove = job_locked ทั้งหมด (UI lockAll → "ไม่ได้ส่ง — ช่างรับงานแล้ว")',
      (pg_temp.pq_begin(sM, null, j, gen_random_uuid()) ->> 'code') = 'job_locked' and (pg_temp.pq_sp(sM, p1, null, j) ->> 'code') = 'job_locked' and (pg_temp.pq_rm(sM, p1) ->> 'code') = 'job_locked');
    m := pg_temp.pmy(sM); x := (select e from jsonb_array_elements(m -> 'jobs') e where (e ->> 'job_id')::uuid = j);
    v := v || pg_temp.chk('UI10c', 'my_intake_list: ใบที่ล็อก editable=false ยังอยู่ในรายการ (การ์ด "ช่างรับงานแล้ว" แตะได้)', x is not null and (x ->> 'editable') = 'false');
    -- UI11: reissue (W-10 · ปุ่ม "ออก QR ใหม่") หลังช่างรับงานแล้ว + idem
    delete from analytics.worker_rate_limit;
    ri1 := gen_random_uuid()::text; ri2 := gen_random_uuid()::text; ri3 := gen_random_uuid()::text;
    r := pg_temp.pq_rs(sM, j, ri1);
    tok := r ->> 'token';
    v := v || pg_temp.chk('UI11a', 'reissue idemKey=uuid · ใบที่ช่างรับแล้ว → ok already=false · token ตรง TOKEN_RE (16–64 [A-Za-z0-9_-]) · print_no จำนวนเต็ม 1..1000 · job_no ~ ^JB-\d{1,8}$ · job_id ส่งกลับ',
      r ->> 'ok' = 'true' and (r ->> 'already') = 'false' and tok ~ '^[A-Za-z0-9_-]{16,64}$' and (r ->> 'print_no') ~ '^\d{1,4}$' and (r ->> 'print_no')::int between 1 and 1000 and (r ->> 'job_no') ~ '^JB-\d{1,8}$');
    r := pg_temp.pq_rs(sM, j, ri1);
    v := v || pg_temp.chk('UI11b', 'reissue ซ้ำด้วย idemKey เดิม (หน้าต่าง 10 นาที) → already=true ไม่มี token · ไม่กินโควตา', r ->> 'ok' = 'true' and (r ->> 'already') = 'true' and not (r ? 'token') and (select count(*) from analytics.job_token where job_id = j) = 2);
    r := pg_temp.pq_rs(sM, j, ri2);
    v := v || pg_temp.chk('UI11c', 'reissue ด้วย key ใหม่ (หลัง already) → ออกใบใหม่ได้ (UI: กดออกใหม่อีกครั้ง) · print_no เพิ่ม', r ->> 'ok' = 'true' and (r ->> 'already') = 'false' and (r ->> 'token') ~ '^[A-Za-z0-9_-]{16,64}$' and (r ->> 'token') <> tok);
    select count(*) into n from analytics.job_token where job_id = j and revoked_at is null;
    v := v || pg_temp.chk('UI11d', 'QR เดิมไม่ถูกเพิกถอน (ใช้งานอยู่ ' || n || ' ใบ = เดิม 1 + reissue 2)', n = 3);
    -- ไล่จนเต็ม 5
    ok_cnt := 0;
    for i in 1..6 loop
      delete from analytics.worker_rate_limit where key not like 'ri:%';
      r := pg_temp.pq_rs(sM, j, gen_random_uuid()::text);
      exit when r ->> 'ok' is distinct from 'true';
      ok_cnt := ok_cnt + 1;
    end loop;
    v := v || pg_temp.chk('UI11e', 'เพดาน 5 ใบ: ออกเพิ่มได้อีก 2 ใบ แล้ว token_cap · UI reissueErrorView final=true · ได้ ' || ok_cnt || ' / code=' || coalesce(r ->> 'code', '-'), ok_cnt = 2 and r ->> 'code' = 'token_cap');
    -- rate limit: กดรัวด้วยใบอื่นที่ยังไม่เต็ม
    ik2 := gen_random_uuid()::text; o := pg_temp.open_ik(ik2); j2 := (o ->> 'job')::uuid;
    delete from analytics.worker_rate_limit;
    ok_cnt := 0; last := null;
    for i in 1..14 loop
      last := pg_temp.pq_rs(sM, j2, ri3);   -- key เดิมกดรัว
      if last ->> 'ok' = 'true' then ok_cnt := ok_cnt + 1; end if;
    end loop;
    v := v || pg_temp.chk('UI11f', 'กด reissue key เดิมรัว 14 ครั้ง: ครั้งแรก ok + already · ต่อจากนั้นถึงเพดาน rate limit → rate_limited (UI "ส่งถี่เกินไป") · ok ' || ok_cnt || ' · สุดท้าย code=' || coalesce(last ->> 'code', 'ok'), ok_cnt between 1 and 10 and last ->> 'code' = 'rate_limited');
    -- reissue ใบคนอื่น/ idem สั้น
    delete from analytics.worker_rate_limit;
    v := v || pg_temp.chk('UI11g', 'reissue: ใบของ sM โดย sM2 → order_not_found · idemKey สั้น (<16) → idem_invalid',
      (pg_temp.pq_rs(sM2, j2, null) ->> 'code') = 'order_not_found' and (pg_temp.pq_rs(sM, j2, 'short') ->> 'code') = 'idem_invalid');
    raise exception 'rb_ui';
  exception when others then
    if sqlerrm <> 'rb_ui' then v := v || pg_temp.chk('UI-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- ===== UI12: เหตุผลลบของออฟฟิศ (job_photo_remove) — ผลจริงของ DB ต่อเหตุผลแต่ละแบบ (INFO: ใช้สร้างตารางเทียบกับ photoReasonIssue) =====
  begin
    ik := gen_random_uuid()::text; o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    reasons := jsonb_build_array(null, '', ' ', '  ', 'ก', ' ก ', 'ab', 'a b', '..', '--', '👍👍', 'ก่', E'่่', '12', '1.', 'ไม่ชัด', 'ภาพไม่ชัด', E'ก​', E'​​', E'⠀⠀', E'ก️', E'a\u0085b', E'ab\ncd', 'ก ', 'ก' || E' ', E'　　');
    for i in 0..jsonb_array_length(reasons) - 1 loop
      r := pg_temp.put(sM, ik, null, gen_random_uuid(), false);
      p1 := (r ->> 'pid')::uuid;
      if p1 is null then v := v || '[FAIL] UI12-setup ' || r::text || E'\n'; exit; end if;
      rs := case when jsonb_typeof(reasons -> i) = 'null' then null else reasons ->> i end;
      x := pg_temp.offrm(a, p1, rs);
      res := case when x ->> 'ok' = 'true' then 'OK' else coalesce(x ->> 'code', nullif(x ->> '_hint', ''), x ->> '_state' || ':' || (x ->> '_err')) end;
      v := v || format('[INFO] RS|%s|%s|%s', i, coalesce(encode(convert_to(rs, 'UTF8'), 'hex'), 'NULL'), res) || E'\n';
      -- ล้มเหลว = รูปยังอยู่ · สำเร็จ = ลบแล้ว (ตั้งใจ)
      if res <> 'OK' and not exists (select 1 from analytics.job_photo where id = p1 and deleted_at is null) then v := v || '[FAIL] UI12-ghost รูปหายทั้งที่ ปฏิเสธ ' || i || E'\n'; end if;
      if res <> 'OK' then perform pg_temp.pq_rm(sM, p1); end if;
    end loop;
    raise exception 'rb_ui';
  exception when others then
    if sqlerrm <> 'rb_ui' then v := v || pg_temp.chk('UI12-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  return v;
end;
$c$;

do $vui$
declare
  v_msg text := E'\n=== QA W2-UI payload vs RPC ===\n';
  v_fail int; v_ok int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    v_msg := v_msg || pg_temp.g_setup();
    v_msg := v_msg || pg_temp.g_ui();
    raise exception 'VUI_ROLLBACK';
  exception when others then
    if sqlerrm <> 'VUI_ROLLBACK' then v_msg := v_msg || format('[FAIL] S1-crash  %s %s', sqlstate, sqlerrm) || E'\n'; end if;
  end;
  v_fail := (length(v_msg) - length(replace(v_msg, '[FAIL]', ''))) / length('[FAIL]');
  v_ok := (length(v_msg) - length(replace(v_msg, '[OK]', ''))) / length('[OK]');
  v_msg := v_msg || format(E'\n--- สรุป: OK %s · FAIL %s ---', v_ok, v_fail);
  raise exception '%', v_msg;
end;
$vui$;
