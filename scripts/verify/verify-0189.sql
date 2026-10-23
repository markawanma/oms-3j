-- scripts/verify/verify-0189.sql
-- ตรวจ supabase/migrations/0189_shop_photos_w2.sql (W2: ผู้จัดการแนบรูปสั่งงานจากหน้างาน · QR ร้าน + PIN · ≤ 3 รูป/ใบ · เพิ่ม/ลบของตัวเองได้จนช่างเริ่มรับงาน · รายการ "ใบที่ฉันเปิด" · อ้างใบด้วย job_id)
-- self-rolling-back (3j-migration-traps ข้อ 11): ทุกเคสอยู่ในทรานแซกชันเดียว จบด้วย `raise exception` เสมอ ⇒ ถอยทั้งก้อน · อ่านผลจาก error message · exit 1 คือผลที่คาด · [FAIL] >= 1 = ไม่ผ่าน
-- ต้องมี 0182 + 0187 + 0188 อยู่ใน DB แล้ว · dry-run: ต่อ 0189 + ไฟล์นี้ (ไฟล์ LF — ข้อ 20) แล้วรันไม่ใส่ --commit · หลัง apply: รันไฟล์นี้เดี่ยวๆ ได้
-- ข้อมูลทดสอบ: ร้านสังเคราะห์ ZZ TEST verify-0189 (insert public.shop ตรง ตามแพทเทิร์น verify-0188 — ข้อยกเว้นเดียวที่ไม่ผ่าน RPC) · ช่าง/QR ร้าน/ใบผลิต/ใบงาน/รูปออฟฟิศ สร้างผ่าน RPC ของระบบทั้งหมด
-- 🔴 ไม่แตะตัวนับเอกสารภาษี · production_order_done ต้อง md5 เดิม (G3) · storage (bucket) ทดสอบใน SQL ไม่ได้ → ครอบด้วย vitest lib/actions/job-worker.photos.test.ts (mock storage)
--
-- ============ ตารางแมป "ข้อในบรีฟ → เทสต์ที่ครอบ" ============
--  เคสห้ามผ่าน (ด่านที่ตก = RPC begin/add/remove ที่ DB · ไม่มี object เกิดใน bucket = ด่านที่ action (TS): begin ก่อน upload เสมอ)
--   idem key ช่างคนอื่น                      -> B1 B2 B2c · mutant MU2          · TS: "begin ปฏิเสธ → ไม่ upload" (order_not_found)
--   ใบที่ช่างรับงานแล้ว                      -> B4 B4b B4c B4d (begin/add/remove/list) · mutant MU3        · TS: job_locked
--   ใบ cancelled (ใบ/ใบผลิต)                 -> B5 B5b · mutant MU11            · TS: job_cancelled
--   ใบออฟฟิศ (opened_via=office)              -> B3 (idem null ไม่ใช่เป้าหมาย · job_id ของใบออฟฟิศ) G3 · mutant MU2 · UPDATE ผูก idem ให้ใบออฟฟิศ -> B3b (CHECK ของ 0187)
--   token ร้าน revoked                        -> B6 · mutant MU9
--   session หมดอายุ/เพิกถอน(ออกจากระบบ)/ข้ามร้าน/ไม่มี/ช่างถูกปิดใช้ -> B7b (หมดอายุ expires_at) · B7 (เพิกถอน) · B7c (null/hash ผิดรูป · token ผิดรูป) · B7d (is_active=false) · B7e (ข้ามร้าน) · mutant MU8 MU10 MU27 (expires_at) MU28 (is_active)
--   โควตาหน้างาน M1 (security 21 ต.ค.)        -> M1a M1a2 (พื้นที่รวมต่อร้านที่ add + ขอบ) M1b (begin ปฏิเสธเมื่อเต็ม) M1c (ลบคืนพื้นที่) M1e (กำแพง guard ตรง) M1f (ร้านอื่นไม่โดน) · M1d1 M1d M1d2 M1d3 (ต่อช่าง/24 ชม. · นับรวมที่ลบ · หน้าต่างเวลา) · mutant MU22-MU26
--  set_primary หลังส่ง -> SP1 SP2 SP3 SP3b (รูปคนละใบ) SP4 (primary_locked) SP5 (ไม่มีหลัก) SP6 (ช่างรับแล้ว) SP7 (cancelled) SP8 (ถอนสิทธิ์/QR revoked) SP10 (รูปออฟฟิศ) · mutant MU31-MU33
--  clientPhotoKey (idempotency อัปโหลด) -> CK1-CK8 · mutant MU34 MU35 · token_reissue idem -> RI1-RI8 (ไม่เก็บ raw token) · mutant MU36-MU38
--  ออฟฟิศลบรูป shopfloor ต้องมีเหตุผล (job_photo_remove) -> RR1 RR2 RR3 (ต้องไม่พัง: รูปออฟฟิศไม่บังคับ) · mutant MU39 MU40 · ❌ ไม่มีเทสต์ SQL: การดักข้อความ/UI ฝั่งออฟฟิศ (TS: job-photos.test.ts)
--   L1 ล็อกก่อนนับเพดาน (ลำดับล็อกในนิยาม) -> L1 · mutant MU29 · L2 นับเฉพาะ kind=reference -> L2 · mutant MU30
--   can_open_job=false หลังเปิดใบ              -> B8 B8c (ช่างทั่วไป) · mutant MU6 · list ว่าง H8
--   path ไม่ตรง photo_id/ใบ/ร้าน               -> B9 (8 แบบ) B9b · mutant MU5 · (กำแพงที่สามคือ CHECK job_photo_path_ck: B9c)
--   photo_id ซ้ำ                              -> B10
--   bytes > 2 MB / 0 / ติดลบ · dims ผิด         -> B11 B12 · ขอบ B12b (ต้องไม่พัง)
--   รูปที่ 4 จากหน้างาน                       -> A6a A6b A6c (guard ที่ DB) · mutant MU4a MU4b
--   reference รวมที่ 6                         -> B13 B13b
--   ไฟล์ Exif GPS ยิงตรง action                -> ❌ ไม่มีเทสต์ SQL (DB ไม่เห็น bytes) — TS: "Exif GPS ยิงตรง → object ที่เก็บไม่มี APP1" (job-worker.photos.test.ts)
--   ลบรูปของคนอื่น/รูปออฟฟิศ                   -> B14 B14b · mutant MU1
--   rate limit เกิน → ก่อนแตะ storage          -> C1 C2 C3 (ก่อนแตะข้อมูล) · mutant MU12 MU13 · TS: rate_limited → ไม่ upload
--   response ไม่มี key เงิน                    -> D1 H11 · TS: intakeClean
--   anon/authenticated execute · overload      -> E1 E2 E3 E4 E5 (18.5) · MY
--  token_reissue (ออก QR ใหม่) -> T1 T1b T2 T2b T3 (ใบคนอื่น/ออฟฟิศ/ข้ามร้าน/null) T4 (ต้องไม่พัง: ช่างรับแล้วออกได้) T5a T5b (ใบปิด/ยกเลิก) T6 (ถอนสิทธิ์) T6b (QR ร้าน revoked) T7 (rate limit) · เกิน 5 = T2 · mutant MU17 MU18 MU19 MU20 MU21
--  my_intake_list: ไม่คืนใบของคนอื่น/ใบออฟฟิศ  -> H1 H3 · mutant MU14 · editable=false เมื่อช่างรับ H4 · mutant MU15 · ถอน can_open_job แล้วว่าง H8 · mutant MU16
-- ต้องไม่พัง: ระบบรูปออฟฟิศเดิม (job_photo_add/remove/set_primary/reorder ทำงานเหมือนเดิม + ลบรูปหน้างานโดยออฟฟิศได้) -> F1 F2 F3 F4 F5 · verify-0182/0187/0188 ต้องรันผ่านต่อ (รันแยก) · md5 production_order_done -> G3 ·
--             หน้าช่างเห็นรูปหน้างานเป็นรูปหลัก (job_worker_resolve หลัง PIN) -> R1 R2 (ก่อน PIN ไม่มีรูป) · รัน flow เดิมครบหลังชุดนี้ -> K0
-- ไม่มีเทสต์ครอบ (บอกตรงๆ):
--   · การแข่งกันจริงของ 2 connection (add พร้อมช่างรับงาน · 2 มือถืออัปโหลดรูปที่ 3 พร้อมกัน) — do-block เป็น connection เดียว · ล็อกแถวใบ (for update) พิสูจน์ได้แค่ว่าอยู่ในนิยาม (R3) + กำแพง guard (A6c)
--   · storage จริง (object ไม่เกิดเมื่อ DB ปฏิเสธ · ลบ object หลัง remove · ตัด Exif) — vitest + mock · ไม่ได้ยิง bucket จริง · ต้องลอง UAT 1 รอบ (ถ่ายรูป iPhone → ดูไม่มีพิกัดใน object ที่เก็บ)
--   · A5 พิมพ์ใบ (primaryPhotoMdUrl) — โค้ด TS เดิมของ 0182 อ่านทุก source · ไม่ได้ยิงหน้าพิมพ์ใน SQL

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
-- กลุ่มเคส 0189 (ใช้ฟิกซ์เจอร์ g_setup ชุดเดียวกับ verify-0187/0188 — ร้านสังเคราะห์ ZZ TEST · ทุกอย่างผ่าน RPC ของระบบ · ทุกกลุ่มถอยกลับด้วย raise 'rb_189')
-- ============================================================================
create function pg_temp.g_189() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); b uuid := pg_temp.fx('B');
  sM text := pg_temp.kv('sM'); sM2 text := pg_temp.kv('sM2'); sMB text := pg_temp.kv('sMB'); sN text := pg_temp.kv('sN');
  wM uuid := pg_temp.fx('wM'); wM2 uuid := pg_temp.fx('wM2'); wN uuid := pg_temp.fx('wN');
  tokb text := pg_temp.kv('tokh_b');
  o jsonb; o2 jsonb; oo jsonb; r jsonb; r2 jsonb; r3 jsonb; l jsonb; rc jsonb;
  j uuid; j2 uuid; ik text; ik2 text; p1 uuid; p2 uuid; p3 uuid; p4 uuid; pid uuid; q1 uuid;
  n0 int; n1 int; st text; t text; ev analytics.job_event; s text; def text; k int; bad text; stg uuid; sid uuid; ck uuid; ck2 uuid; kk text; kc text;
begin
  -- A. ใช้งานปกติ + เพดาน 3 รูป/ใบ
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    r := pg_temp.pb(sM, ik); p1 := (r ->> 'photo_id')::uuid;
    v := v || pg_temp.chk('A1', 'begin ok: job_id/shop_id ตรงของจริง · photo_id เป็น uuid · count 0 · max 3 · ไม่มี key เงิน',
      r ->> 'ok' = 'true' and (r ->> 'job_id')::uuid = j and (r ->> 'shop_id')::uuid = a and (r ->> 'photo_id') ~ '^[0-9a-f-]{36}$' and (r ->> 'count')::int = 0 and (r ->> 'max')::int = 3 and pg_temp.badkeys(r) = '');
    r2 := pg_temp.pa(sM, ik, p1, a, j);
    v := v || pg_temp.chk('A2', 'add ok: รูปแรกเป็นรูปหลักอัตโนมัติ · source shopfloor · worker_id = ผู้จัดการ · uploaded_by null · kind reference · bytes 1000',
      r2 ->> 'ok' = 'true' and (r2 ->> 'is_primary')::boolean
      and exists (select 1 from analytics.job_photo x where x.id = p1 and x.job_id = j and x.shop_id = a and x.source = 'shopfloor' and x.worker_id = wM and x.uploaded_by is null and x.kind = 'reference' and x.is_primary and x.bytes = 1000));
    select * into ev from pg_temp.ev(j, 'photo_add') limit 1;
    v := v || pg_temp.chk('A3', 'event photo_add: actor null · worker = ผู้จัดการ · ช่อง worker_qr · payload มีเฉพาะ id/ชนิด/ที่มา/bytes/is_primary (ไม่มี path)',
      ev.id is not null and ev.actor is null and ev.worker_id = wM and ev.channel = 'worker_qr'
      and (select string_agg(k2, ',' order by k2) from jsonb_object_keys(ev.payload) k2) = 'bytes,is_primary,kind,photo_id,source' and position('jpg' in ev.payload::text) = 0);
    r := pg_temp.pb(sM, ik); p2 := (r ->> 'photo_id')::uuid; r2 := pg_temp.pa(sM, ik, p2, a, j);
    v := v || pg_temp.chk('A4', 'รูปที่ 2 ok · ไม่ใช่หลัก (มีหลักแล้ว) · count 2', r2 ->> 'ok' = 'true' and not (r2 ->> 'is_primary')::boolean and (r2 ->> 'count')::int = 2);
    r := pg_temp.pb(sM, ik); p3 := (r ->> 'photo_id')::uuid; r2 := pg_temp.pa(sM, ik, p3, a, j, jsonb_build_object('prim', 'true'));
    v := v || pg_temp.chk('A5', 'รูปที่ 3 ขอเป็นหลัก (หลักเดิมเป็นของหน้างาน) → สลับ · หลักมีตัวเดียว = รูปที่ 3',
      r2 ->> 'ok' = 'true' and (r2 ->> 'is_primary')::boolean and (select count(*) from analytics.job_photo x where x.job_id = j and x.is_primary and x.deleted_at is null) = 1
      and (select x.id from analytics.job_photo x where x.job_id = j and x.is_primary and x.deleted_at is null) = p3);
    r := pg_temp.pb(sM, ik);
    v := v || pg_temp.chk('A6a', 'รูปที่ 4: begin → photo_cap_shopfloor', r ->> 'code' = 'photo_cap_shopfloor');
    n0 := pg_temp.nph(j);
    r2 := pg_temp.pa(sM, ik, gen_random_uuid(), a, j);
    v := v || pg_temp.chk('A6b', 'รูปที่ 4: add → photo_cap_shopfloor · ไม่มีแถวเพิ่ม', r2 ->> 'code' = 'photo_cap_shopfloor' and pg_temp.nph(j) = n0);
    p4 := gen_random_uuid();
    perform set_config('analytics.shop_photo_id', p4::text, true);
    st := pg_temp.err(format('insert into analytics.job_photo (id, shop_id, job_id, kind, source, storage_path, variant_sm_path, bytes, worker_id) values (%L, %L, %L, ''reference'', ''shopfloor'', %L, %L, 1000, %L)',
      p4, a, j, pg_temp.pmd(a, j, p4), pg_temp.psm(a, j, p4), wM));
    perform set_config('analytics.shop_photo_id', '', true);
    v := v || pg_temp.chk('A6c', 'INSERT ตรงรูปที่ 4 (GUC ถูก) → guard P0001 photo_cap_shopfloor (กำแพงที่ DB ชั้นสอง) · ได้: ' || st, st = 'P0001|photo_cap_shopfloor');
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('A-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid; p4 := gen_random_uuid();
    st := pg_temp.err(format('insert into analytics.job_photo (id, shop_id, job_id, kind, source, storage_path, variant_sm_path, bytes, worker_id) values (%L, %L, %L, ''reference'', ''shopfloor'', %L, %L, 1000, %L)',
      p4, a, j, pg_temp.pmd(a, j, p4), pg_temp.psm(a, j, p4), wM));
    v := v || pg_temp.chk('A6d', 'INSERT ตรง shopfloor reference + worker โดยไม่ผ่าน RPC (ไม่มี GUC) → 42501 shopfloor_rpc_only · ได้: ' || st, st = '42501|shopfloor_rpc_only');
    perform set_config('analytics.shop_photo_id', gen_random_uuid()::text, true);
    st := pg_temp.err(format('insert into analytics.job_photo (id, shop_id, job_id, kind, source, storage_path, variant_sm_path, bytes, worker_id) values (%L, %L, %L, ''reference'', ''shopfloor'', %L, %L, 1000, %L)',
      p4, a, j, pg_temp.pmd(a, j, p4), pg_temp.psm(a, j, p4), wM));
    perform set_config('analytics.shop_photo_id', '', true);
    v := v || pg_temp.chk('A6e', 'GUC เป็น id อื่น → 42501 (ผูกกับ id ของแถว ไม่ใช่ธงลอย) · ได้: ' || st, st = '42501|shopfloor_rpc_only');
    st := pg_temp.err(format('insert into analytics.job_photo (id, shop_id, job_id, kind, source, storage_path, variant_sm_path, bytes, worker_id) values (%L, %L, %L, ''reference'', ''shopfloor'', %L, %L, 1000, null)',
      p4, a, j, pg_temp.pmd(a, j, p4), pg_temp.psm(a, j, p4)));
    v := v || pg_temp.chk('A6f', 'ต้องไม่พัง: shopfloor ไม่มี worker ตกที่ CHECK เหมือน 0182 (23514 ไม่ใช่ guard ใหม่ชิงตก) · ได้: ' || st, st like '23514%');
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('A6d-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  -- A7. ขอเป็นหลักแต่หลักเดิมเป็นของออฟฟิศ → ไม่ล้ม
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid; p1 := gen_random_uuid(); r := pg_temp.offadd(a, j, p1);
    r := pg_temp.pb(sM, ik); p2 := (r ->> 'photo_id')::uuid; r2 := pg_temp.pa(sM, ik, p2, a, j, jsonb_build_object('prim', 'true'));
    v := v || pg_temp.chk('A7', 'ขอเป็นหลักแต่หลักเดิมเป็นของออฟฟิศ → ok แต่ is_primary false · รูปหลักยังเป็นรูปออฟฟิศ', r2 ->> 'ok' = 'true' and not (r2 ->> 'is_primary')::boolean
      and (select x.id from analytics.job_photo x where x.job_id = j and x.is_primary and x.deleted_at is null) = p1);
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('A7-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- B. ห้ามผ่าน: idem ช่างอื่น · ใบออฟฟิศ
  begin
    ik := pg_temp.ik(); ik2 := pg_temp.ik();
    o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid; o2 := pg_temp.open_ik(ik2, sM2); j2 := (o2 ->> 'job')::uuid;
    n0 := pg_temp.nph_all(a);
    r := pg_temp.pb(sM, ik2); r2 := pg_temp.pa(sM, ik2, gen_random_uuid(), a, j2);
    v := v || pg_temp.chk('B1', 'idem key ของช่างคนอื่น (M ใช้ key ของ M2) → order_not_found ทั้ง begin/add · ไม่มีแถวเกิด', r ->> 'code' = 'order_not_found' and r2 ->> 'code' = 'order_not_found' and pg_temp.nph_all(a) = n0);
    r2 := pg_temp.pb(sM, pg_temp.ik());
    v := v || pg_temp.chk('B2', 'idem key ไม่มีจริง → order_not_found · ข้อความเดียวกับของคนอื่น (ไม่บอกว่ามีจริงไหม)', r2 ->> 'code' = 'order_not_found' and r2 ->> 'message' = r ->> 'message');
    v := v || pg_temp.chk('B2b', 'idem รูปแบบผิด (สั้น) → idem_invalid', (pg_temp.pb(sM, 'short') ->> 'code') = 'idem_invalid');
    v := v || pg_temp.chk('B2c', 'ย้อนกลับ: M2 ใช้ key ของ M → order_not_found', (pg_temp.pb(sM2, ik) ->> 'code') = 'order_not_found');
    oo := pg_temp.office_job(a, pg_temp.fx('fixa'));
    r := pg_temp.pb(sM, null, jsonb_build_object('job', oo ->> 'job'));
    r2 := pg_temp.pa(sM, null, gen_random_uuid(), a, (oo ->> 'job')::uuid, jsonb_build_object('job', oo ->> 'job'));
    v := v || pg_temp.chk('B3', 'ใบออฟฟิศ (opened_via=office): อ้างด้วย job_id → order_not_found ทั้ง begin/add · ไม่มีรูปเกิดบนใบออฟฟิศ · ' || coalesce(oo ->> 'err', ''),
      (oo ->> 'job') is not null and r ->> 'code' = 'order_not_found' and r2 ->> 'code' = 'order_not_found' and pg_temp.nph((oo ->> 'job')::uuid) = 0);
    st := pg_temp.err(format('update analytics.production_order set intake_idem_key = %L where id = %L', pg_temp.ik(), oo ->> 'po'));
    v := v || pg_temp.chk('B3b', 'ผูก idem key ให้ใบผลิตออฟฟิศไม่ได้ (UPDATE ตรง ถูกปฏิเสธ) — ใบออฟฟิศจึงเป็นเป้าหมายของทางนี้ไม่ได้ · ได้: ' || st, st <> 'OK');
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('B-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- B4. ช่างเริ่มรับงาน = ล็อก
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    r := pg_temp.pb(sM, ik); p1 := (r ->> 'photo_id')::uuid; r2 := pg_temp.pa(sM, ik, p1, a, j);
    rc := pg_temp.rcv(a, j);
    v := v || pg_temp.chk('B4pre', 'จำลองช่างรับงาน (RPC ออฟฟิศ job_office_receive): มีขั้น received/sent · ' || coalesce(rc ->> '_err', rc ->> 'code', 'ok'), pg_temp.received(j));
    n0 := pg_temp.nph_all(a);
    r := pg_temp.pb(sM, ik); r2 := pg_temp.pa(sM, ik, gen_random_uuid(), a, j); r3 := pg_temp.prm(sM, p1);
    v := v || pg_temp.chk('B4', 'มีขั้นถูกรับ → begin/add/remove ล้วน job_locked · ไม่มีแถวเปลี่ยน · รูปเดิมยัง active',
      r ->> 'code' = 'job_locked' and r2 ->> 'code' = 'job_locked' and r3 ->> 'code' = 'job_locked' and pg_temp.nph_all(a) = n0 and pg_temp.nph(j) = 1);
    l := pg_temp.pls(sM, ik);
    v := v || pg_temp.chk('B4b', 'list ตอนล็อก: locked true · lock_code job_locked · ยังเห็นรูป', l ->> 'ok' = 'true' and (l ->> 'locked')::boolean and l ->> 'lock_code' = 'job_locked' and jsonb_array_length(l -> 'photos') = 1);
    v := v || pg_temp.chk('B4c', 'อ้างด้วย job_id ก็ล็อกเหมือนกัน (begin)', (pg_temp.pb(sM, null, jsonb_build_object('job', j)) ->> 'code') = 'job_locked');
    r := pg_temp.pmy(sM);
    v := v || pg_temp.chk('B4d', 'รายการใบของฉัน: ใบนี้ editable = false (ยังอยู่ในรายการ)', exists (select 1 from jsonb_array_elements(r -> 'jobs') e where (e ->> 'job_id')::uuid = j and (e ->> 'editable')::boolean = false));
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('B4-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- B5. ใบ cancelled
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    r := pg_temp.pb(sM, ik); p1 := (r ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p1, a, j);
    perform analytics.job_cancel(a, j, 'verify W2 B5', pg_temp.act());
    n0 := pg_temp.nph_all(a);
    r := pg_temp.pb(sM, ik); r2 := pg_temp.pa(sM, ik, gen_random_uuid(), a, j); r3 := pg_temp.prm(sM, p1);
    v := v || pg_temp.chk('B5', 'ใบ cancelled → begin/add/remove ล้วน job_cancelled · ไม่มีแถวเปลี่ยน',
      r ->> 'code' = 'job_cancelled' and r2 ->> 'code' = 'job_cancelled' and r3 ->> 'code' = 'job_cancelled' and pg_temp.nph_all(a) = n0);
    v := v || pg_temp.chk('B5b', 'ใบ cancelled หายจากรายการใบของฉัน', not exists (select 1 from jsonb_array_elements(pg_temp.pmy(sM) -> 'jobs') e where (e ->> 'job_id')::uuid = j));
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('B5-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- B6-B8. token / session / สิทธิ์
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    r := pg_temp.pb(sM, ik); p1 := (r ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p1, a, j);
    perform analytics.shop_intake_token_revoke(a, pg_temp.act());
    n0 := pg_temp.nph_all(a);
    st := coalesce(pg_temp.pb(sM, ik) ->> 'code', '-') || ',' || coalesce(pg_temp.pa(sM, ik, gen_random_uuid(), a, j) ->> 'code', '-') || ',' || coalesce(pg_temp.prm(sM, p1) ->> 'code', '-') || ','
       || coalesce(pg_temp.pls(sM, ik) ->> 'code', '-') || ',' || coalesce(pg_temp.pmy(sM) ->> 'code', '-');
    v := v || pg_temp.chk('B6', 'token ร้าน revoked → invalid_token ทั้ง 5 RPC · ไม่มีแถวเปลี่ยน · ได้: ' || st, st = 'invalid_token,invalid_token,invalid_token,invalid_token,invalid_token' and pg_temp.nph_all(a) = n0);
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('B6-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    r := pg_temp.pb(sM, ik); p1 := (r ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p1, a, j);
    v := v || pg_temp.chk('B7c', 'ไม่มี session (null) / hash ผิดรูป → session_required · token null/ผิดรูป → invalid_token',
      (pg_temp.pb(null, ik) ->> 'code') = 'session_required' and (pg_temp.pb('xyz', ik) ->> 'code') = 'session_required'
      and (pg_temp.pb(sM, ik, '{}'::jsonb, 'abc') ->> 'code') = 'invalid_token' and (pg_temp.q(format('select analytics.job_worker_photo_begin(null, %L, %L, null, null)', sM, ik)) ->> 'code') = 'invalid_token');
    v := v || pg_temp.chk('B7e', 'session ร้าน B ใช้กับ QR ร้าน A → session_required · QR ร้าน B + key ของร้าน A → order_not_found (ข้ามร้านไม่ได้)',
      (pg_temp.pb(sMB, ik) ->> 'code') = 'session_required' and (pg_temp.pb(sMB, ik, '{}'::jsonb, tokb) ->> 'code') = 'order_not_found');
    perform analytics.job_worker_logout(sM);
    n0 := pg_temp.nph_all(a);
    st := coalesce(pg_temp.pb(sM, ik) ->> 'code', '-') || ',' || coalesce(pg_temp.pa(sM, ik, gen_random_uuid(), a, j) ->> 'code', '-') || ',' || coalesce(pg_temp.prm(sM, p1) ->> 'code', '-');
    v := v || pg_temp.chk('B7', 'session ถูกเพิกถอน (ออกจากระบบ) → session_required ทั้ง begin/add/remove · ไม่มีแถวเปลี่ยน · ได้: ' || st, st = 'session_required,session_required,session_required' and pg_temp.nph_all(a) = n0);
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('B7-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    r := pg_temp.pb(sM, ik); p1 := (r ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p1, a, j);
    r := pg_temp.wu(a, 'ZZ-M ผู้จัดการ', null, wM, '{qc}', false, null);
    v := v || pg_temp.chk('B8pre', 'ถอน can_open_job ของ M ผ่าน worker_upsert สำเร็จ · ' || coalesce(r ->> '_err', 'ok'), r ->> 'can_open_job' = 'false');
    n0 := pg_temp.nph_all(a);
    st := coalesce(pg_temp.pb(sM, ik) ->> 'code', '-') || ',' || coalesce(pg_temp.pa(sM, ik, gen_random_uuid(), a, j) ->> 'code', '-') || ',' || coalesce(pg_temp.prm(sM, p1) ->> 'code', '-');
    v := v || pg_temp.chk('B8', 'can_open_job=false หลังเปิดใบ → not_allowed ทั้ง begin/add/remove · ไม่มีแถวเปลี่ยน · ได้: ' || st, st = 'not_allowed,not_allowed,not_allowed' and pg_temp.nph_all(a) = n0);
    r := pg_temp.wu(a, 'ZZ-M ผู้จัดการ', null, wM, '{qc}', true, null);
    v := v || pg_temp.chk('B8b', 'ต้องไม่พัง: คืนสิทธิ์ → begin ใช้ได้อีก', (pg_temp.pb(sM, ik) ->> 'ok') = 'true');
    v := v || pg_temp.chk('B8c', 'ช่างทั่วไป (N · ไม่มี can_open_job) ที่มี session จริง → not_allowed', (pg_temp.pb(sN, ik) ->> 'code') = 'not_allowed' and (pg_temp.pb(sN, ik) ->> 'ok') is distinct from 'true');
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('B8-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- B9-B13. path / photo_id / bytes / dims / เพดาน reference
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid; o2 := pg_temp.open_ik(pg_temp.ik(), sM2); j2 := (o2 ->> 'job')::uuid;
    pid := gen_random_uuid(); n0 := pg_temp.nph_all(a); st := '';
    st := st || coalesce(pg_temp.pa(sM, ik, pid, a, j, jsonb_build_object('md', pg_temp.pmd(a, j, gen_random_uuid()))) ->> 'code', '-') || ',';
    st := st || coalesce(pg_temp.pa(sM, ik, pid, a, j, jsonb_build_object('sm', pg_temp.psm(a, j, gen_random_uuid()))) ->> 'code', '-') || ',';
    st := st || coalesce(pg_temp.pa(sM, ik, pid, a, j, jsonb_build_object('md', pg_temp.pmd(b, j, pid), 'sm', pg_temp.psm(b, j, pid))) ->> 'code', '-') || ',';
    st := st || coalesce(pg_temp.pa(sM, ik, pid, a, j, jsonb_build_object('md', pg_temp.pmd(a, j2, pid), 'sm', pg_temp.psm(a, j2, pid))) ->> 'code', '-') || ',';
    st := st || coalesce(pg_temp.pa(sM, ik, pid, a, j, jsonb_build_object('md', upper(pg_temp.pmd(a, j, pid)), 'sm', upper(pg_temp.psm(a, j, pid)))) ->> 'code', '-') || ',';
    st := st || coalesce(pg_temp.pa(sM, ik, pid, a, j, jsonb_build_object('md', pg_temp.pmd(a, j, pid) || '.svg')) ->> 'code', '-') || ',';
    st := st || coalesce(pg_temp.pa(sM, ik, pid, a, j, jsonb_build_object('md', '../' || pg_temp.pmd(a, j, pid))) ->> 'code', '-') || ',';
    st := st || coalesce(pg_temp.pa(sM, ik, pid, a, j, jsonb_build_object('md', pg_temp.psm(a, j, pid), 'sm', pg_temp.pmd(a, j, pid))) ->> 'code', '-') || ',';
    v := v || pg_temp.chk('B9', 'path ไม่ตรง photo_id/ใบ/ร้าน (8 แบบ: md คนละ id · sm คนละ id · ร้านอื่น · ใบอื่น · ตัวใหญ่ · .svg · ../ · สลับ md/sm) → photo_path_invalid ทุกแบบ · ไม่มีแถวเกิด · ได้: ' || st,
      st = repeat('photo_path_invalid,', 8) and pg_temp.nph_all(a) = n0);
    v := v || pg_temp.chk('B9b', 'photo_id null → photo_path_invalid', (pg_temp.q(format('select analytics.job_worker_photo_add(%L, %L, %L, null, ''a'', ''b'', 1000)', pg_temp.th(), sM, ik)) ->> 'code') = 'photo_path_invalid');
    perform set_config('analytics.shop_photo_id', pid::text, true);
    st := pg_temp.err(format('insert into analytics.job_photo (id, shop_id, job_id, kind, source, storage_path, variant_sm_path, bytes, worker_id) values (%L, %L, %L, ''reference'', ''shopfloor'', %L, %L, 1000, %L)',
      pid, a, j, pg_temp.pmd(a, j, gen_random_uuid()), pg_temp.psm(a, j, pid), wM));
    perform set_config('analytics.shop_photo_id', '', true);
    v := v || pg_temp.chk('B9c', 'กำแพงสุดท้าย: INSERT ตรงที่ path ไม่ตรง id (GUC ถูก) → CHECK job_photo_path_ck 23514 · ได้: ' || st, st like '23514%');
    r := pg_temp.pa(sM, ik, pid, a, j); r2 := pg_temp.pa(sM, ik, pid, a, j);
    v := v || pg_temp.chk('B10', 'photo_id ซ้ำ → photo_path_dup · ไม่มีแถวเพิ่ม (add แรก ok)', r ->> 'ok' = 'true' and r2 ->> 'code' = 'photo_path_dup' and pg_temp.nph(j) = 1);
    update analytics.job_photo set deleted_at = now(), deleted_by = wM, is_primary = false where id = pid;
    st := '';
    foreach t in array array['0', '-1', '2097153', '99999999999'] loop
      st := st || coalesce(pg_temp.pa(sM, ik, gen_random_uuid(), a, j, jsonb_build_object('bytes', t)) ->> 'code', '-') || ',';
    end loop;
    v := v || pg_temp.chk('B11', 'bytes 0 / -1 / 2097153 / เกินช่วง int → ปฏิเสธทุกค่า (ไม่มีแถวเกิด) · ได้: ' || st, (st = repeat('photo_bytes_invalid,', 3) || '-,' or st = repeat('photo_bytes_invalid,', 4)) and pg_temp.nph(j) = 0);
    st := '';
    for k in 1 .. 4 loop
      st := st || coalesce(pg_temp.pa(sM, ik, gen_random_uuid(), a, j, jsonb_build_object('w', (array['0', '1', '100001', '1'])[k], 'h', (array['1', '0', '1', '100001'])[k])) ->> 'code', '-') || ',';
    end loop;
    v := v || pg_temp.chk('B12', 'width/height 0 หรือ > 100000 → photo_dims_invalid ทุกคู่ · ได้: ' || st, st = repeat('photo_dims_invalid,', 4) and pg_temp.nph(j) = 0);
    pid := gen_random_uuid();
    r := pg_temp.pa(sM, ik, pid, a, j, jsonb_build_object('bytes', '2097152'));
    v := v || pg_temp.chk('B12b', 'ต้องไม่พัง: bytes = 2097152 พอดี ผ่าน', r ->> 'ok' = 'true');
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('B9-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    r := pg_temp.pb(sM, ik); p1 := (r ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p1, a, j);
    for k in 1 .. 4 loop perform pg_temp.offadd(a, j, gen_random_uuid()); end loop;
    n1 := (select count(*)::int from analytics.job_photo x where x.job_id = j and x.kind = 'reference' and x.deleted_at is null);
    r := pg_temp.pb(sM, ik); r2 := pg_temp.pa(sM, ik, gen_random_uuid(), a, j);
    v := v || pg_temp.chk('B13', 'reference รวม ' || n1 || ' (ครบ 5: หน้างาน 1 + ออฟฟิศ 4) → shopfloor รูปถัดไป photo_cap_ref ทั้ง begin/add', n1 = 5 and r ->> 'code' = 'photo_cap_ref' and r2 ->> 'code' = 'photo_cap_ref');
    perform pg_temp.q(format('select analytics.job_photo_remove(%L, %L, %L, %L)', a, (select x.id from analytics.job_photo x where x.job_id = j and x.source = 'office' and not x.is_primary and x.deleted_at is null limit 1), 'verify', pg_temp.act()));
    r := pg_temp.pb(sM, ik); r2 := pg_temp.pa(sM, ik, (r ->> 'photo_id')::uuid, a, j);
    v := v || pg_temp.chk('B13b', 'ต้องไม่พัง: ออฟฟิศลบรูป 1 → reference 4 → เพิ่มได้', r2 ->> 'ok' = 'true');
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('B13-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- B14. ลบรูปของคนอื่น/ของออฟฟิศ
  begin
    ik := pg_temp.ik(); ik2 := pg_temp.ik();
    o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid; o2 := pg_temp.open_ik(ik2, sM2); j2 := (o2 ->> 'job')::uuid;
    r := pg_temp.pb(sM, ik); p1 := (r ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p1, a, j);
    p2 := gen_random_uuid(); perform pg_temp.offadd(a, j, p2);
    r := pg_temp.prm(sM2, p1); r2 := pg_temp.prm(sM, p2); r3 := pg_temp.prm(sM, gen_random_uuid());
    v := v || pg_temp.chk('B14', 'ลบรูปของคนอื่น / รูปออฟฟิศ / ไม่มีจริง → photo_not_found ข้อความเดียวกัน · รูปไม่ถูกแตะ',
      r ->> 'code' = 'photo_not_found' and r2 ->> 'code' = 'photo_not_found' and r3 ->> 'code' = 'photo_not_found' and r2 ->> 'message' = r ->> 'message'
      and (select count(*) from analytics.job_photo x where x.id in (p1, p2) and x.deleted_at is null) = 2);
    v := v || pg_temp.chk('B14b', 'ข้ามร้าน: session + QR ร้าน B ลบรูปร้าน A → photo_not_found', (pg_temp.prm(sMB, p1, '{}'::jsonb, tokb) ->> 'code') = 'photo_not_found');
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('B14-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- B15. ลบสำเร็จ · เลื่อนหลัก · event · ลบซ้ำ · ลบแล้วเพิ่มได้
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    r := pg_temp.pb(sM, ik); p1 := (r ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p1, a, j);
    r := pg_temp.pb(sM, ik); p2 := (r ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p2, a, j);
    r := pg_temp.prm(sM, p1);
    select * into ev from pg_temp.ev(j, 'photo_remove') limit 1;
    v := v || pg_temp.chk('B15', 'ลบรูปหลักของตัวเอง: ok · คืน path md/sm · soft delete (deleted_by = ช่าง) · เลื่อนรูปถัดไปเป็นหลัก · event photo_remove actor null worker M ไม่มี path',
      r ->> 'ok' = 'true' and r ->> 'storage_path' = pg_temp.pmd(a, j, p1) and r ->> 'variant_sm_path' = pg_temp.psm(a, j, p1) and (r ->> 'promoted_photo_id')::uuid = p2
      and exists (select 1 from analytics.job_photo x where x.id = p1 and x.deleted_at is not null and x.deleted_by = wM and not x.is_primary)
      and (select x.id from analytics.job_photo x where x.job_id = j and x.is_primary and x.deleted_at is null) = p2
      and ev.actor is null and ev.worker_id = wM and ev.channel = 'worker_qr' and position('jpg' in ev.payload::text) = 0);
    v := v || pg_temp.chk('B15b', 'ลบซ้ำ → already_deleted', (pg_temp.prm(sM, p1) ->> 'code') = 'already_deleted');
    r := pg_temp.pb(sM, ik);
    v := v || pg_temp.chk('B15c', 'ต้องไม่พัง: ลบแล้ว count ลด (1) → begin ok', r ->> 'ok' = 'true' and (r ->> 'count')::int = 1);
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('B15-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- C. rate limit (ก่อนแตะข้อมูล)
  begin
    ik := pg_temp.ik(); ik2 := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid; o2 := pg_temp.open_ik(ik2, sM2); j2 := (o2 ->> 'job')::uuid;
    r := pg_temp.pb(sM, ik); p1 := (r ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p1, a, j);
    delete from analytics.worker_rate_limit;
    s := repeat('c', 64);
    insert into analytics.worker_rate_limit (key, window_start, hits) values ('ipw:' || left(s, 32), to_timestamp(floor(extract(epoch from now()) / 600) * 600), 300);
    n0 := pg_temp.nph_all(a);
    r := pg_temp.pb(sM, ik, jsonb_build_object('ip', s, 'rl', '1'));
    v := v || pg_temp.chk('C1', 'ถัง ip เต็ม (300) → rate_limited ก่อนตรวจ token/ใบ · ถังต่อช่าง wp ไม่ถูกนับ · ไม่มีแถวเปลี่ยน',
      r ->> 'code' = 'rate_limited' and not exists (select 1 from analytics.worker_rate_limit where key = 'wp:' || wM::text) and pg_temp.nph_all(a) = n0);
    delete from analytics.worker_rate_limit;
    for k in 1 .. 31 loop r := pg_temp.pb(sM, ik, jsonb_build_object('rl', '1')); end loop;
    v := v || pg_temp.chk('C2', 'ถังต่อช่าง 30/10 นาที: ครั้งที่ 31 → rate_limited', r ->> 'code' = 'rate_limited');
    r2 := pg_temp.pa(sM, ik, gen_random_uuid(), a, j, jsonb_build_object('rl', '1')); r3 := pg_temp.prm(sM, p1, jsonb_build_object('rl', '1'));
    v := v || pg_temp.chk('C3', 'add/remove ใช้ถังเดียวกัน → rate_limited ก่อนแตะข้อมูล · รูปไม่ถูกลบ', r2 ->> 'code' = 'rate_limited' and r3 ->> 'code' = 'rate_limited'
      and exists (select 1 from analytics.job_photo x where x.id = p1 and x.deleted_at is null) and pg_temp.nph(j) = 1);
    r := pg_temp.pb(sM2, ik2, jsonb_build_object('rl', '1'));
    v := v || pg_temp.chk('C3b', 'คนอื่น (M2) ไม่โดนถังของ M', r ->> 'code' is distinct from 'rate_limited' and r ->> 'ok' = 'true');
    delete from analytics.worker_rate_limit;
    for k in 1 .. 35 loop r := pg_temp.pb(sN, ik, jsonb_build_object('rl', '1')); end loop;
    v := v || pg_temp.chk('C3c', 'คนไม่มีสิทธิ์ (N) ยิงรัวไม่เผาถังของใคร: ไม่มีคีย์ wp ของ N · ผลยังเป็น not_allowed', r ->> 'code' = 'not_allowed' and not exists (select 1 from analytics.worker_rate_limit where key = 'wp:' || wN::text));
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('C-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- D. response ไม่มี key เงิน/ต้นทุน/ลูกค้า
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    r := pg_temp.pb(sM, ik); p1 := (r ->> 'photo_id')::uuid; r2 := pg_temp.pa(sM, ik, p1, a, j); r3 := pg_temp.pls(sM, ik); l := pg_temp.prm(sM, p1);
    bad := pg_temp.badkeys(r) || pg_temp.badkeys(r2) || pg_temp.badkeys(r3) || pg_temp.badkeys(l) || pg_temp.badkeys(pg_temp.pb(sM, pg_temp.ik())) || pg_temp.badkeys(pg_temp.pmy(sM));
    v := v || pg_temp.chk('D1', 'response ทุกแบบ (begin/add/list/remove/ล้ม/ใบของฉัน) ไม่มี key เงิน/ต้นทุน/ลูกค้า/เลขเอกสาร · ได้: ' || bad, bad = '');
    v := v || pg_temp.chk('D1b', 'begin/add ไม่ส่ง path ออก (ไม่มี key *path*) · add ไม่มี token', not (r::text ~ 'path') and not (r2::text ~ '(path|token)'));
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('D-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- F. ระบบรูปออฟฟิศเดิมต้องไม่พัง + ออฟฟิศลบรูปหน้างานได้ (OfficeAck)
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    r := pg_temp.pb(sM, ik); p1 := (r ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p1, a, j);
    p2 := gen_random_uuid(); r := pg_temp.offadd(a, j, p2);
    v := v || pg_temp.chk('F1', 'ต้องไม่พัง: ออฟฟิศเพิ่มรูป (job_photo_add) ได้เหมือนเดิม · ไม่ใช่รูปหลัก (หลักเป็นของหน้างาน) · source office', r ->> 'ok' = 'true' and not (r ->> 'is_primary')::boolean
      and exists (select 1 from analytics.job_photo x where x.id = p2 and x.source = 'office' and x.uploaded_by is not null and x.worker_id is null));
    r := pg_temp.q(format('select analytics.job_photo_add(p_shop_id=>%L, p_job_id=>%L, p_kind=>''reference'', p_source=>''shopfloor'', p_storage_path=>%L, p_variant_sm_path=>%L, p_bytes=>1000, p_actor=>%L)',
      a, j, pg_temp.pmd(a, j, gen_random_uuid()), pg_temp.psm(a, j, gen_random_uuid()), pg_temp.act()));
    v := v || pg_temp.chk('F2', 'ออฟฟิศยิง source = shopfloor ผ่าน job_photo_add ยังถูกปฏิเสธ photo_source_invalid (ประตูเดิมไม่เปิด) · ได้: ' || pg_temp.hint(r), pg_temp.hint(r) = '22023|photo_source_invalid');
    r := pg_temp.q(format('select analytics.job_photo_set_primary(%L, %L, %L)', a, p2, pg_temp.act()));
    v := v || pg_temp.chk('F3', 'ออฟฟิศตั้งรูปของตัวเองเป็นหลักทับรูปหน้างานได้ (set_primary เดิม) · หลักมีตัวเดียว', r ->> 'ok' = 'true' and (select x.id from analytics.job_photo x where x.job_id = j and x.is_primary and x.deleted_at is null) = p2);
    r := pg_temp.q(format('select analytics.job_photo_reorder(%L, %L, %L::uuid[], %L)', a, j, (select array_agg(x.id order by x.created_at desc, x.id) from analytics.job_photo x where x.job_id = j and x.deleted_at is null), pg_temp.act()));
    v := v || pg_temp.chk('F4', 'ออฟฟิศเรียงรูปที่รวมรูปหน้างานด้วยได้ (reorder เดิม)', r ->> 'ok' = 'true' and (r ->> 'count')::int = 2);
    r := pg_temp.q(format('select analytics.job_photo_remove(%L, %L, %L, %L)', a, p1, 'ซ้ำกับรูปของออฟฟิศ', pg_temp.act()));
    select * into ev from pg_temp.ev(j, 'photo_remove') where actor is not null limit 1;
    v := v || pg_temp.chk('F5', 'ออฟฟิศลบรูปหน้างานพร้อมเหตุผลได้ด้วย RPC เดิม · deleted_by = ผู้ใช้ออฟฟิศ · event actor = ออฟฟิศ · คืน path ให้ลบ object', r ->> 'ok' = 'true' and r ->> 'storage_path' = pg_temp.pmd(a, j, p1)
      and exists (select 1 from analytics.job_photo x where x.id = p1 and x.deleted_at is not null and x.deleted_by = pg_temp.act() and x.delete_reason = 'ซ้ำกับรูปของออฟฟิศ') and ev.actor = pg_temp.act() and ev.worker_id is null);
    v := v || pg_temp.chk('F6', 'ผู้จัดการลบรูปที่ออฟฟิศลบไปแล้ว → already_deleted (ไม่ error)', (pg_temp.prm(sM, p1) ->> 'code') = 'already_deleted');
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('F-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- G. อ้างใบด้วย job_id + H. รายการใบที่ฉันเปิด
  begin
    ik := pg_temp.ik(); ik2 := pg_temp.ik();
    o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid; o2 := pg_temp.open_ik(ik2, sM2); j2 := (o2 ->> 'job')::uuid;
    r := pg_temp.pb(sM, null, jsonb_build_object('job', j)); p1 := (r ->> 'photo_id')::uuid;
    v := v || pg_temp.chk('G1', 'begin ด้วย job_id ของใบตัวเอง → ok (ไม่ต้องมี idem key)', r ->> 'ok' = 'true' and (r ->> 'job_id')::uuid = j);
    r2 := pg_temp.pa(sM, null, p1, a, j, jsonb_build_object('job', j));
    v := v || pg_temp.chk('G2', 'add ด้วย job_id → ok · แถว source shopfloor worker M', r2 ->> 'ok' = 'true' and exists (select 1 from analytics.job_photo x where x.id = p1 and x.worker_id = wM and x.source = 'shopfloor'));
    n0 := pg_temp.nph_all(a);
    st := coalesce(pg_temp.pb(sM2, null, jsonb_build_object('job', j)) ->> 'code', '-') || ',' || coalesce(pg_temp.pa(sM2, null, gen_random_uuid(), a, j, jsonb_build_object('job', j)) ->> 'code', '-') || ','
       || coalesce(pg_temp.pb(sM, null, jsonb_build_object('job', gen_random_uuid())) ->> 'code', '-') || ',' || coalesce(pg_temp.pb(sMB, null, jsonb_build_object('job', j), tokb) ->> 'code', '-');
    v := v || pg_temp.chk('G3', 'job_id ของคนอื่น / ไม่มีจริง / ข้ามร้าน → order_not_found (ไม่ใช่แค่รู้ uuid) · ไม่มีแถวเกิด · ได้: ' || st, st = 'order_not_found,order_not_found,order_not_found,order_not_found' and pg_temp.nph_all(a) = n0);
    v := v || pg_temp.chk('G4', 'ส่ง idem + job_id พร้อมกัน หรือไม่ส่งสักทาง → idem_invalid',
      (pg_temp.pb(sM, ik, jsonb_build_object('job', j)) ->> 'code') = 'idem_invalid' and (pg_temp.pb(sM, null) ->> 'code') = 'idem_invalid');
    l := pg_temp.pls(sM, null, jsonb_build_object('job', j));
    v := v || pg_temp.chk('G6', 'photo_list ด้วย job_id ใช้ได้ · เห็น 1 รูป · mine = true', l ->> 'ok' = 'true' and (l ->> 'count')::int = 1 and (l -> 'photos' -> 0 ->> 'mine')::boolean);
    -- H. รายการใบของฉัน
    r := pg_temp.pmy(sM);
    v := v || pg_temp.chk('H1', 'รายการของ M: มีใบของ M · ไม่มีใบของ M2 · ไม่มีใบออฟฟิศ (jt_job)',
      r ->> 'ok' = 'true' and exists (select 1 from jsonb_array_elements(r -> 'jobs') e where (e ->> 'job_id')::uuid = j)
      and not exists (select 1 from jsonb_array_elements(r -> 'jobs') e where (e ->> 'job_id')::uuid in (j2, pg_temp.fx('jt_job'))));
    select e into o from jsonb_array_elements(r -> 'jobs') e where (e ->> 'job_id')::uuid = j;
    v := v || pg_temp.chk('H2', 'แถวมีเฉพาะ field ที่ระบุ (ไม่มีเงิน/น้ำหนัก · ไม่นับ gem_* ที่ 0191 เพิ่ม — ตรวจใน verify-0191 L1e) · photos_count 1 · my_photos_count 1 · editable true · status open',
      (select string_agg(k2, ',' order by k2) from jsonb_object_keys(o - 'gem_state' - 'gem_count' - 'gem_pieces' - 'gem_editable') k2) = 'created_at,design_label,editable,job_id,job_no,metal,my_photos_count,order_no,photos_count,qty,status'
      and (o ->> 'photos_count')::int = 1 and (o ->> 'my_photos_count')::int = 1 and (o ->> 'editable')::boolean and o ->> 'status' = 'open');
    r2 := pg_temp.pmy(sM2);
    v := v || pg_temp.chk('H3', 'รายการของ M2: ไม่เห็นใบของ M · เห็นใบของตัวเอง', not exists (select 1 from jsonb_array_elements(r2 -> 'jobs') e where (e ->> 'job_id')::uuid = j) and exists (select 1 from jsonb_array_elements(r2 -> 'jobs') e where (e ->> 'job_id')::uuid = j2));
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('G-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    perform pg_temp.rcv(a, j);
    r := pg_temp.pmy(sM);
    v := v || pg_temp.chk('H4', 'ช่างรับขั้นแล้ว → editable false (ยังอยู่ในรายการ) · received = ' || pg_temp.received(j)::text,
      pg_temp.received(j) and exists (select 1 from jsonb_array_elements(r -> 'jobs') e where (e ->> 'job_id')::uuid = j and (e ->> 'editable')::boolean = false));
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('H4-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    perform analytics.job_cancel(a, j, 'verify W2 H5', pg_temp.act());
    v := v || pg_temp.chk('H5', 'ใบ cancelled → หายจากรายการ', not exists (select 1 from jsonb_array_elements(pg_temp.pmy(sM) -> 'jobs') e where (e ->> 'job_id')::uuid = j));
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('H5-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    alter table analytics.job disable trigger user;
    update analytics.job set created_at = now() - interval '15 days' where id = j;
    v := v || pg_temp.chk('H6', 'เก่ากว่า 14 วัน → ไม่อยู่ในรายการ', not exists (select 1 from jsonb_array_elements(pg_temp.pmy(sM) -> 'jobs') e where (e ->> 'job_id')::uuid = j));
    update analytics.job set created_at = now() - interval '13 days' where id = j;
    alter table analytics.job enable trigger user;
    v := v || pg_temp.chk('H6b', 'ต้องไม่พัง: 13 วัน ยังอยู่ในรายการ', exists (select 1 from jsonb_array_elements(pg_temp.pmy(sM) -> 'jobs') e where (e ->> 'job_id')::uuid = j));
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('H6-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    for k in 1 .. 21 loop perform pg_temp.open_ik(pg_temp.ik(), sM, 'แหวนเยอะ ' || k); end loop;
    r := pg_temp.pmy(sM);
    v := v || pg_temp.chk('H7', 'เกิน 20 ใบ → คืนไม่เกิน 20 (21 ใบที่เปิด)', jsonb_array_length(r -> 'jobs') = 20);
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('H7-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    r := pg_temp.wu(a, 'ZZ-M ผู้จัดการ', null, wM, '{qc}', false, null);
    r := pg_temp.pmy(sM);
    v := v || pg_temp.chk('H8', 'ถอน can_open_job → รายการว่าง (ok true · open_allowed false) ไม่ใช่ error', r ->> 'ok' = 'true' and r ->> 'open_allowed' = 'false' and jsonb_array_length(r -> 'jobs') = 0);
    v := v || pg_temp.chk('H8b', 'ถอนสิทธิ์แล้ว begin ด้วย job_id → not_allowed', (pg_temp.pb(sM, null, jsonb_build_object('job', j)) ->> 'code') = 'not_allowed');
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('H8-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    perform analytics.shop_intake_token_revoke(a, pg_temp.act());
    v := v || pg_temp.chk('H9', 'QR ร้าน revoked → list invalid_token', (pg_temp.pmy(sM) ->> 'code') = 'invalid_token');
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('H9-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    -- H10 (แก้: ของเดิมวางต่อจากการเพิกถอน QR ร้านในบล็อกเดียวกัน — token ถูกตรวจก่อน session จึงได้ invalid_token ไม่ใช่ session_required · verify เขียนผิด ไม่ใช่ RPC ผิด)
    -- session ร้าน B ใช้กับ QR ร้าน A (QR ยัง active) → session_required · ใช้กับ QR ร้าน B ของตัวเอง → ต้องได้ ok (ต้องไม่พัง)
    v := v || pg_temp.chk('H10', 'session ร้านอื่น (MB) ใช้กับ QR ร้าน A → session_required · ใช้กับ QR ร้าน B ของตัวเอง → ok · ผลไม่มีใบของร้าน A',
      (pg_temp.pmy(sMB) ->> 'code') = 'session_required' and (pg_temp.pmy(sMB, '{}'::jsonb, tokb) ->> 'ok') = 'true'
      and jsonb_array_length(pg_temp.pmy(sMB, '{}'::jsonb, tokb) -> 'jobs') = 0);
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('H10-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    r := pg_temp.pmy(sN);
    v := v || pg_temp.chk('H10b', 'ช่างทั่วไป (N · ไม่มี can_open_job) → รายการว่าง open_allowed false', r ->> 'ok' = 'true' and r ->> 'open_allowed' = 'false' and jsonb_array_length(r -> 'jobs') = 0);
    v := v || pg_temp.chk('H11', 'ผล list ไม่มี key เงิน/ต้นทุน/น้ำหนัก/ลูกค้า', pg_temp.badkeys(pg_temp.pmy(sM)) = '' and not (pg_temp.pmy(sM)::text ~* 'weight|target_piece|cost|price'));
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('H10b-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- B7b/B7d (L3): session หมดอายุจริง (expires_at) · ช่างถูกปิดใช้ (is_active=false โดยที่ session ยังไม่ถูกเพิกถอน — worker_set_active เพิกถอน session ให้เอง จึงใช้ UPDATE ตรงเพื่อพิสูจน์ว่า helper เช็ค is_active สดเอง)
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    r := pg_temp.pb(sM, ik); p1 := (r ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p1, a, j);
    alter table analytics.worker_session disable trigger user;
    update analytics.worker_session set issued_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' where session_hash = sM;
    alter table analytics.worker_session enable trigger user;
    n0 := pg_temp.nph_all(a);
    st := coalesce(pg_temp.pb(sM, ik) ->> 'code', '-') || ',' || coalesce(pg_temp.pa(sM, ik, gen_random_uuid(), a, j) ->> 'code', '-') || ',' || coalesce(pg_temp.prm(sM, p1) ->> 'code', '-') || ',' || coalesce(pg_temp.pls(sM, ik) ->> 'code', '-');
    v := v || pg_temp.chk('B7b', 'session หมดอายุ (expires_at < now) → session_required ทั้ง begin/add/remove/list · ไม่มีแถวเปลี่ยน · ได้: ' || st, st = repeat('session_required,', 3) || 'session_required' and pg_temp.nph_all(a) = n0);
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('B7b-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    r := pg_temp.pb(sM, ik); p1 := (r ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p1, a, j);
    alter table analytics.worker disable trigger user;
    update analytics.worker set is_active = false where id = wM;
    alter table analytics.worker enable trigger user;
    n0 := pg_temp.nph_all(a);
    st := coalesce(pg_temp.pb(sM, ik) ->> 'code', '-') || ',' || coalesce(pg_temp.pa(sM, ik, gen_random_uuid(), a, j) ->> 'code', '-') || ',' || coalesce(pg_temp.prm(sM, p1) ->> 'code', '-') || ',' || coalesce(pg_temp.pmy(sM) ->> 'code', '-');
    v := v || pg_temp.chk('B7d', 'ช่างถูกปิดใช้ (is_active=false · session ยังไม่ถูกเพิกถอน) → session_required ทุก RPC · ไม่มีแถวเปลี่ยน · ได้: ' || st, st = repeat('session_required,', 3) || 'session_required' and pg_temp.nph_all(a) = n0);
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('B7d-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- M1 โควตาหน้างาน (security 21 ต.ค.): พื้นที่รวมต่อร้าน · ต่อช่าง/24 ชม. (นับรวมที่ลบแล้ว) · L1 ล็อกก่อนนับ · L2 นับเฉพาะ kind=reference
  --   ค่าจริง 80 MB / 60 รูป ตั้งทดสอบโดย replace ฟังก์ชันค่ากำหนดชั่วคราวในทรานแซกชัน (ถอยกลับทุกบล็อก) — ร้านทดสอบสร้างใหม่ ผลรวมเริ่มที่ 0
  begin
    perform pg_temp.mutate('analytics.job_shopfloor_photo_quota()', '80 * 1024 * 1024', '2500');
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid; ik2 := pg_temp.ik(); o2 := pg_temp.open_ik(ik2, sM2); j2 := (o2 ->> 'job')::uuid;
    p1 := (pg_temp.pb(sM, ik) ->> 'photo_id')::uuid; r2 := pg_temp.pa(sM, ik, p1, a, j, jsonb_build_object('bytes', '1000'));
    p2 := (pg_temp.pb(sM, ik) ->> 'photo_id')::uuid; r3 := pg_temp.pa(sM, ik, p2, a, j, jsonb_build_object('bytes', '1000'));
    p3 := (pg_temp.pb(sM, ik) ->> 'photo_id')::uuid; l := pg_temp.pa(sM, ik, p3, a, j, jsonb_build_object('bytes', '1000'));
    v := v || pg_temp.chk('M1a', 'พื้นที่รวมรูปหน้างานต่อร้าน (ตั้ง 2500): 1000 + 1000 ok · 1000 ที่สามเกินขีด → photo_budget_shopfloor · ไม่มีแถวเพิ่ม · ได้: ' || coalesce(l ->> 'code', '-'),
      r2 ->> 'ok' = 'true' and r3 ->> 'ok' = 'true' and l ->> 'code' = 'photo_budget_shopfloor' and pg_temp.nph(j) = 2);
    r := pg_temp.pa(sM, ik, p3, a, j, jsonb_build_object('bytes', '500'));
    v := v || pg_temp.chk('M1a2', 'ขอบ: รวมพอดีขีด (1000+1000+500 = 2500) ผ่าน (ไม่เกิน)', r ->> 'ok' = 'true');
    r2 := pg_temp.pb(sM2, ik2);
    v := v || pg_temp.chk('M1b', 'ร้านเต็ม (รวม >= ขีด) → begin ปฏิเสธ photo_budget_shopfloor ก่อนแตะ bucket (ใบอื่น ช่างอื่นในร้านเดียวกัน)', r2 ->> 'code' = 'photo_budget_shopfloor');
    perform pg_temp.prm(sM, p1);
    v := v || pg_temp.chk('M1c', 'ลบรูปคืนพื้นที่ (นับเฉพาะที่ยังไม่ลบ): ลบ 1000 แล้ว begin ใบอื่นผ่าน', (pg_temp.pb(sM2, ik2) ->> 'ok') = 'true');
    p4 := gen_random_uuid();
    perform set_config('analytics.shop_photo_id', p4::text, true);
    st := pg_temp.err(format('insert into analytics.job_photo (id, shop_id, job_id, kind, source, storage_path, variant_sm_path, bytes, worker_id) values (%L, %L, %L, ''reference'', ''shopfloor'', %L, %L, 2500, %L)',
      p4, a, j2, pg_temp.pmd(a, j2, p4), pg_temp.psm(a, j2, p4), wM2));
    perform set_config('analytics.shop_photo_id', '', true);
    v := v || pg_temp.chk('M1e', 'กำแพง guard: INSERT ตรง (GUC ถูก) ที่ทำให้พื้นที่เกินขีด → P0003 photo_budget_shopfloor · ได้: ' || st, st = 'P0003|photo_budget_shopfloor');
    s := pg_temp.ik();
    r := pg_temp.opn(sMB, jsonb_build_object('idem', s, 'label', 'แหวนร้านบี', 'metal', 'silver', 'qty', 2), tokb);
    v := v || pg_temp.chk('M1f', 'ต้องไม่พัง: ร้านอื่น (B) ไม่โดนพื้นที่ที่ร้าน A เต็ม (บัญชีแยกตามร้าน) · เปิดใบร้าน B ok แล้ว begin ok · ' || coalesce(r ->> 'code', 'ok'),
      r ->> 'ok' = 'true' and (pg_temp.pb(sMB, s, '{}'::jsonb, tokb) ->> 'ok') = 'true');
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('M1-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    perform pg_temp.mutate('analytics.job_shopfloor_photo_quota()', '''worker_24h_max'', 60', '''worker_24h_max'', 2');
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    p1 := (pg_temp.pb(sM, ik) ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p1, a, j);
    p2 := (pg_temp.pb(sM, ik) ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p2, a, j);
    r := pg_temp.pb(sM, ik); r2 := pg_temp.pa(sM, ik, gen_random_uuid(), a, j);
    v := v || pg_temp.chk('M1d1', 'ต่อช่าง ≤ 2 รูป/24 ชม. (ตั้งทดสอบ): รูปที่ 3 → begin ปฏิเสธ photo_daily_cap', r ->> 'code' = 'photo_daily_cap');
    v := v || pg_temp.chk('M1d', 'add ตรง (ข้าม begin) → photo_daily_cap ที่ guard · ไม่มีแถวเพิ่ม', r2 ->> 'code' = 'photo_daily_cap' and pg_temp.nph(j) = 2);
    perform pg_temp.prm(sM, p1); perform pg_temp.prm(sM, p2);
    r2 := pg_temp.pa(sM, ik, gen_random_uuid(), a, j);
    v := v || pg_temp.chk('M1d2', 'กันวน add/remove: ลบทั้งสองรูปแล้ว ยังนับรวมที่ลบ → add → photo_daily_cap · begin ก็ปฏิเสธ', r2 ->> 'code' = 'photo_daily_cap' and (pg_temp.pb(sM, ik) ->> 'code') = 'photo_daily_cap');
    alter table analytics.job_photo disable trigger user;
    update analytics.job_photo set created_at = now() - interval '25 hours' where id = p1;
    alter table analytics.job_photo enable trigger user;
    r2 := pg_temp.pa(sM, ik, gen_random_uuid(), a, j);
    v := v || pg_temp.chk('M1d3', 'ต้องไม่พัง: รูปที่เก่ากว่า 24 ชม. ไม่นับ (เหลือ 1 ในหน้าต่าง) → add ผ่าน', r2 ->> 'ok' = 'true');
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('M1d-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    stg := (select x.id from analytics.job_stage x where x.job_id = j order by x.seq limit 1); sid := gen_random_uuid();
    insert into analytics.job_photo (id, shop_id, job_id, kind, job_stage_id, source, storage_path, variant_sm_path, bytes, worker_id)
    values (sid, a, j, 'stage', stg, 'shopfloor', pg_temp.pmd(a, j, sid), pg_temp.psm(a, j, sid), 1000, wM);
    n1 := 0;
    for k in 1 .. 3 loop
      r := pg_temp.pb(sM, ik);
      if r ->> 'ok' = 'true' and (pg_temp.pa(sM, ik, (r ->> 'photo_id')::uuid, a, j) ->> 'ok') = 'true' then n1 := n1 + 1; end if;
    end loop;
    v := v || pg_temp.chk('L2', 'รูป kind=stage ของ shopfloor 1 รูปไม่กินเพดาน 3 ของรูปสั่งงาน: เพิ่ม reference ได้ 3 รูป · รูปที่ 4 ปฏิเสธ (begin) · มี ' || n1 || ' รูป',
      n1 = 3 and (pg_temp.pb(sM, ik) ->> 'code') = 'photo_cap_shopfloor');
    def := pg_get_functiondef('analytics.job_photo_guard()'::regprocedure);
    v := v || pg_temp.chk('L1', 'guard ล็อกต่อใบ (seed 2) ก่อนนับเพดาน 3 · ลำดับล็อกใบ(2) → ร้าน(3) → ช่าง(4) ในนิยาม',
      position('hashtextextended(new.job_id::text, 2)' in def) > 0
      and position('hashtextextended(new.job_id::text, 2)' in def) < position('p.kind = ''reference'' and p.deleted_at is null) >= 3' in def)
      and position('hashtextextended(new.shop_id::text, 3)' in def) > position('hashtextextended(new.job_id::text, 2)' in def)
      and position('hashtextextended(new.worker_id::text, 4)' in def) > position('hashtextextended(new.shop_id::text, 3)' in def));
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('L2-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- SP. ตั้งรูปหลักหลังส่งแล้ว (job_worker_photo_set_primary)
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    p1 := (pg_temp.pb(sM, ik) ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p1, a, j);
    p2 := (pg_temp.pb(sM, ik) ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p2, a, j);
    r := pg_temp.psp(sM, p2, jsonb_build_object('idem', ik));
    select * into ev from pg_temp.ev(j, 'photo_primary') limit 1;
    v := v || pg_temp.chk('SP1', 'ตั้งรูปที่ 2 เป็นหลัก (หลักเดิมเป็นของหน้างาน) → ok changed true · หลักมีตัวเดียว = รูปที่ 2 · event photo_primary actor null worker M ช่อง worker_qr · previous = รูปที่ 1',
      r ->> 'ok' = 'true' and (r ->> 'changed')::boolean and (select count(*) from analytics.job_photo x where x.job_id = j and x.is_primary and x.deleted_at is null) = 1
      and (select x.id from analytics.job_photo x where x.job_id = j and x.is_primary and x.deleted_at is null) = p2
      and ev.actor is null and ev.worker_id = wM and ev.channel = 'worker_qr' and (ev.payload ->> 'previous_photo_id')::uuid = p1);
    n0 := (select count(*)::int from pg_temp.ev(j, 'photo_primary'));
    r2 := pg_temp.psp(sM, p2, jsonb_build_object('job', j));
    v := v || pg_temp.chk('SP2', 'เป็นหลักอยู่แล้ว → ok changed false · ไม่มี event เพิ่ม · อ้างด้วย job_id ได้', r2 ->> 'ok' = 'true' and not (r2 ->> 'changed')::boolean and (select count(*)::int from pg_temp.ev(j, 'photo_primary')) = n0);
    st := coalesce(pg_temp.psp(sM2, p1, jsonb_build_object('idem', ik)) ->> 'code', '-') || ',' || coalesce(pg_temp.psp(sM2, p1, jsonb_build_object('job', j)) ->> 'code', '-') || ','
       || coalesce(pg_temp.psp(sM, p1, jsonb_build_object('idem', ik, 'job', j)) ->> 'code', '-') || ',' || coalesce(pg_temp.psp(sM, p1) ->> 'code', '-') || ','
       || coalesce(pg_temp.psp(sM, gen_random_uuid(), jsonb_build_object('idem', ik)) ->> 'code', '-') || ',' || coalesce(pg_temp.psp(sM, null, jsonb_build_object('idem', ik)) ->> 'code', '-');
    v := v || pg_temp.chk('SP3', 'ช่างอื่น (ใช้ idem/job ของ M) · ส่ง ref ทั้งสอง/ไม่ส่ง · รูปไม่มีจริง · photo null → ปฏิเสธ · หลักไม่ขยับ · ได้: ' || st,
      st = 'order_not_found,order_not_found,idem_invalid,idem_invalid,photo_not_found,photo_not_found' and (select x.id from analytics.job_photo x where x.job_id = j and x.is_primary and x.deleted_at is null) = p2);
    o2 := pg_temp.open_ik(pg_temp.ik()); j2 := (o2 ->> 'job')::uuid; ik2 := pg_temp.ik();
    v := v || pg_temp.chk('SP3b', 'รูปของใบ A แต่ ref ชี้ใบ B (ของตัวเองทั้งคู่) → photo_not_found', (pg_temp.psp(sM, p1, jsonb_build_object('job', j2)) ->> 'code') = 'photo_not_found');
    p3 := gen_random_uuid(); perform pg_temp.offadd(a, j, p3);
    v := v || pg_temp.chk('SP10', 'ตั้ง "รูปออฟฟิศ" ในใบตัวเองเป็นหลัก → photo_not_found (ตั้งได้เฉพาะรูปหน้างานของตัวเอง)', (pg_temp.psp(sM, p3, jsonb_build_object('idem', ik)) ->> 'code') = 'photo_not_found');
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('SP-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    -- หลักปัจจุบันเป็นของออฟฟิศ → primary_locked · ไม่มีรูปหลักเลย → ตั้งได้
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid; p3 := gen_random_uuid(); perform pg_temp.offadd(a, j, p3);
    p1 := (pg_temp.pb(sM, ik) ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p1, a, j);
    r := pg_temp.psp(sM, p1, jsonb_build_object('idem', ik));
    v := v || pg_temp.chk('SP4', 'หลักปัจจุบันเป็นของออฟฟิศ → primary_locked · หลักยังเป็นรูปออฟฟิศ (มติ A7) · ได้: ' || coalesce(r ->> 'code', '-'),
      r ->> 'code' = 'primary_locked' and (select x.id from analytics.job_photo x where x.job_id = j and x.is_primary and x.deleted_at is null) = p3);
    update analytics.job_photo set is_primary = false where job_id = j and is_primary;
    r := pg_temp.psp(sM, p1, jsonb_build_object('idem', ik));
    v := v || pg_temp.chk('SP5', 'ใบไม่มีรูปหลักเลย → ตั้งได้ (changed true)', r ->> 'ok' = 'true' and (r ->> 'changed')::boolean and (select x.id from analytics.job_photo x where x.job_id = j and x.is_primary and x.deleted_at is null) = p1);
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('SP4-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    p1 := (pg_temp.pb(sM, ik) ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p1, a, j);
    p2 := (pg_temp.pb(sM, ik) ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p2, a, j);
    perform pg_temp.rcv(a, j);
    v := v || pg_temp.chk('SP6', 'ช่างรับงานแล้ว → job_locked · หลักไม่ขยับ · received = ' || pg_temp.received(j)::text,
      pg_temp.received(j) and (pg_temp.psp(sM, p2, jsonb_build_object('idem', ik)) ->> 'code') = 'job_locked' and (select x.id from analytics.job_photo x where x.job_id = j and x.is_primary and x.deleted_at is null) = p1);
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('SP6-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    p1 := (pg_temp.pb(sM, ik) ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p1, a, j);
    p2 := (pg_temp.pb(sM, ik) ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p2, a, j);
    perform analytics.job_cancel(a, j, 'verify W2 SP7', pg_temp.act());
    v := v || pg_temp.chk('SP7', 'ใบ cancelled → job_cancelled', (pg_temp.psp(sM, p2, jsonb_build_object('idem', ik)) ->> 'code') = 'job_cancelled');
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('SP7-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    p1 := (pg_temp.pb(sM, ik) ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p1, a, j);
    p2 := (pg_temp.pb(sM, ik) ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p2, a, j);
    perform pg_temp.wu(a, 'ZZ-M ผู้จัดการ', null, wM, '{qc}', false, null);
    st := coalesce(pg_temp.psp(sM, p2, jsonb_build_object('idem', ik)) ->> 'code', '-');
    perform pg_temp.wu(a, 'ZZ-M ผู้จัดการ', null, wM, '{qc}', true, null);
    perform analytics.shop_intake_token_revoke(a, pg_temp.act());
    v := v || pg_temp.chk('SP8', 'ถอน can_open_job → not_allowed · QR ร้าน revoked → invalid_token · หลักไม่ขยับ · ได้: ' || st,
      st = 'not_allowed' and (pg_temp.psp(sM, p2, jsonb_build_object('idem', ik)) ->> 'code') = 'invalid_token' and (select x.id from analytics.job_photo x where x.job_id = j and x.is_primary and x.deleted_at is null) = p1);
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('SP8-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- CK. clientPhotoKey (idempotency ของอัปโหลด)
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid; ck := gen_random_uuid();
    r := pg_temp.pb(sM, ik, jsonb_build_object('key', ck)); p1 := (r ->> 'photo_id')::uuid;
    r2 := pg_temp.pa(sM, ik, p1, a, j, jsonb_build_object('key', ck));
    v := v || pg_temp.chk('CK1', 'begin + add พร้อม key → ok (ไม่ใช่ already) · แถวเก็บ client_key', r ->> 'ok' = 'true' and r ->> 'already' is null and r2 ->> 'ok' = 'true' and r2 ->> 'already' is null
      and (select x.client_key from analytics.job_photo x where x.id = p1) = ck);
    r := pg_temp.pb(sM, ik, jsonb_build_object('key', ck));
    v := v || pg_temp.chk('CK2', 'begin ซ้ำ key เดิม → already:true photo_id เดิม (ไม่ออก id ใหม่) · ไม่เกิดแถว', r ->> 'ok' = 'true' and (r ->> 'already')::boolean and (r ->> 'photo_id')::uuid = p1 and pg_temp.nph(j) = 1);
    p4 := gen_random_uuid();
    r2 := pg_temp.pa(sM, ik, p4, a, j, jsonb_build_object('key', ck));
    v := v || pg_temp.chk('CK3', 'add ซ้ำ key เดิม (photo id/path ใหม่) → already:true คืนรูปเดิม · ไม่ INSERT ซ้ำ · ไม่มีแถว id ใหม่', r2 ->> 'ok' = 'true' and (r2 ->> 'already')::boolean and (r2 ->> 'photo_id')::uuid = p1
      and pg_temp.nph(j) = 1 and not exists (select 1 from analytics.job_photo x where x.id = p4));
    p2 := (pg_temp.pb(sM, ik) ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p2, a, j);
    p3 := (pg_temp.pb(sM, ik) ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p3, a, j);
    v := v || pg_temp.chk('CK4', 'ใบครบ 3 รูปแล้ว: begin key เดิม → already (ไม่ติดเพดาน) · key ใหม่ → photo_cap_shopfloor',
      (pg_temp.pb(sM, ik, jsonb_build_object('key', ck)) ->> 'already') = 'true' and (pg_temp.pb(sM, ik, jsonb_build_object('key', gen_random_uuid())) ->> 'code') = 'photo_cap_shopfloor');
    perform pg_temp.prm(sM, p1);
    v := v || pg_temp.chk('CK5', 'รูปที่ลบแล้วใช้ key เดิมซ้ำ → photo_key_used ทั้ง begin และ add · ไม่คืนชีพรูป',
      (pg_temp.pb(sM, ik, jsonb_build_object('key', ck)) ->> 'code') = 'photo_key_used' and (pg_temp.pa(sM, ik, gen_random_uuid(), a, j, jsonb_build_object('key', ck)) ->> 'code') = 'photo_key_used'
      and exists (select 1 from analytics.job_photo x where x.id = p1 and x.deleted_at is not null));
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('CK-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid; ik2 := pg_temp.ik(); o2 := pg_temp.open_ik(ik2); j2 := (o2 ->> 'job')::uuid; ck2 := gen_random_uuid();
    r := pg_temp.pb(sM, ik, jsonb_build_object('key', ck2)); perform pg_temp.pa(sM, ik, (r ->> 'photo_id')::uuid, a, j, jsonb_build_object('key', ck2));
    v := v || pg_temp.chk('CK6', 'key เดียวกันใช้กับอีกใบของช่างเดียวกัน → photo_key_used ทั้ง begin และ add',
      (pg_temp.pb(sM, ik2, jsonb_build_object('key', ck2)) ->> 'code') = 'photo_key_used' and (pg_temp.pa(sM, ik2, gen_random_uuid(), a, j2, jsonb_build_object('key', ck2)) ->> 'code') = 'photo_key_used');
    ik2 := pg_temp.ik(); o2 := pg_temp.open_ik(ik2, sM2); j2 := (o2 ->> 'job')::uuid;
    r2 := pg_temp.pb(sM2, ik2, jsonb_build_object('key', ck2));
    v := v || pg_temp.chk('CK7', 'ต้องไม่พัง: ช่างอื่น (M2) ใช้ key เดียวกันได้ (unique ต่อช่าง) → ok ใหม่', r2 ->> 'ok' = 'true' and r2 ->> 'already' is null
      and (pg_temp.pa(sM2, ik2, (r2 ->> 'photo_id')::uuid, a, j2, jsonb_build_object('key', ck2)) ->> 'ok') = 'true');
    st := pg_temp.err(format('update analytics.job_photo set client_key = %L where job_id = %L and client_key is not null', gen_random_uuid(), j));
    v := v || pg_temp.chk('CK8', 'client_key แก้ภายหลังไม่ได้ (guard) → 42501 · ได้: ' || st, st like '42501%');
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('CK6-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- RI. idempotency ของ "ออก QR ใหม่" (ไม่เก็บ raw token)
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid; kk := pg_temp.ik(); kc := pg_temp.ik();
    n0 := (select count(*)::int from analytics.job_token x where x.job_id = j);
    r := pg_temp.trs(sM, j, jsonb_build_object('idem', kk)); r2 := pg_temp.trs(sM, j, jsonb_build_object('idem', kk));
    v := v || pg_temp.chk('RI1', 'key เดิมซ้ำ → already:true ไม่มี token ดิบ · ไม่ออกใหม่ (token +1 เท่านั้น) · ครั้งแรก already:false มี token',
      r ->> 'ok' = 'true' and not (r ->> 'already')::boolean and length(r ->> 'token') = 43 and r2 ->> 'ok' = 'true' and (r2 ->> 'already')::boolean and not (r2 ? 'token')
      and (select count(*)::int from analytics.job_token x where x.job_id = j) = n0 + 1);
    r := pg_temp.trs(sM, j, jsonb_build_object('idem', pg_temp.ik()));
    v := v || pg_temp.chk('RI2', 'key ใหม่ → ออกใหม่ (token +2)', r ->> 'ok' = 'true' and not (r ->> 'already')::boolean and (select count(*)::int from analytics.job_token x where x.job_id = j) = n0 + 2);
    r := pg_temp.trs(sM, j); r2 := pg_temp.trs(sM, j);
    v := v || pg_temp.chk('RI3', 'ต้องไม่พัง: ไม่ส่ง key = พฤติกรรมเดิม ออกทุกครั้ง (token +4) · already:false ทั้งคู่', not (r ->> 'already')::boolean and not (r2 ->> 'already')::boolean and (select count(*)::int from analytics.job_token x where x.job_id = j) = n0 + 4);
    v := v || pg_temp.chk('RI4', 'idem รูปแบบผิด → idem_invalid', (pg_temp.trs(sM, j, jsonb_build_object('idem', 'short')) ->> 'code') = 'idem_invalid');
    r := pg_temp.trs(sM, j, jsonb_build_object('idem', kc));
    v := v || pg_temp.chk('RI5', 'ติดเพดาน 5 (token_cap) ไม่เผา key: ไม่มีร่องรอยของ key นี้ใน worker_rate_limit (ลองซ้ำหลังเพิกถอนได้) · ได้: ' || coalesce(r ->> 'code', 'ok'),
      r ->> 'code' = 'token_cap' and not exists (select 1 from analytics.worker_rate_limit w where w.key = 'ri:' || wM::text || ':' || left(analytics.job_sha256_hex(kc || ':' || j::text), 24)));
    o2 := pg_temp.open_ik(pg_temp.ik()); j2 := (o2 ->> 'job')::uuid;
    r2 := pg_temp.trs(sM, j2, jsonb_build_object('idem', kk));
    v := v || pg_temp.chk('RI6', 'key เดียวกันแต่คนละใบ → ออกได้ (key ผูกกับใบ)', r2 ->> 'ok' = 'true' and not (r2 ->> 'already')::boolean);
    v := v || pg_temp.chk('RI8', 'ร่องรอยไม่มีค่าดิบ: key ใน worker_rate_limit ไม่มี idem key ดิบและไม่มี token', not exists (select 1 from analytics.worker_rate_limit w where w.key like 'ri:%' and (w.key like '%' || kk || '%' or w.key like '%' || (r ->> 'token') || '%')));
    update analytics.worker_rate_limit set window_start = window_start - interval '25 minutes' where key like 'ri:%';
    n1 := (select count(*)::int from analytics.job_token x where x.job_id = j2);
    r2 := pg_temp.trs(sM, j2, jsonb_build_object('idem', kk));
    v := v || pg_temp.chk('RI7', 'key เก่ากว่า 20 นาที → ออกใหม่ได้ (หน้าต่างหมด) · token +1', r2 ->> 'ok' = 'true' and not (r2 ->> 'already')::boolean and (select count(*)::int from analytics.job_token x where x.job_id = j2) = n1 + 1);
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('RI-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- RR. ออฟฟิศลบรูป source=shopfloor ต้องมีเหตุผล (job_photo_remove)
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    p1 := (pg_temp.pb(sM, ik) ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p1, a, j);
    p3 := gen_random_uuid(); perform pg_temp.offadd(a, j, p3);
    st := '';
    foreach t in array array['', '   ', 'x', '..', '—'] loop
      st := st || pg_temp.hint(pg_temp.offrm(a, p1, t)) || ',';
    end loop;
    st := st || pg_temp.hint(pg_temp.q(format('select analytics.job_photo_remove(%L, %L, null, %L)', a, p1, pg_temp.act()))) || ',';
    v := v || pg_temp.chk('RR1', 'ออฟฟิศลบรูป shopfloor: เหตุผล ว่าง/ช่องว่าง/1 ตัว/สัญลักษณ์ล้วน/null → 22023 reason_required ทุกแบบ · รูปยัง active · ได้: ' || st,
      st = repeat('22023|reason_required,', 6) and exists (select 1 from analytics.job_photo x where x.id = p1 and x.deleted_at is null));
    r := pg_temp.offrm(a, p1, 'ซ้ำกับรูปของออฟฟิศ');
    select * into ev from pg_temp.ev(j, 'photo_remove') where actor is not null limit 1;
    v := v || pg_temp.chk('RR2', 'มีเหตุผลที่มีตัวอักษรจริง → ลบได้ · คืน path ให้ลบ object · delete_reason เก็บ · event actor = ออฟฟิศ', r ->> 'ok' = 'true' and r ->> 'storage_path' = pg_temp.pmd(a, j, p1)
      and exists (select 1 from analytics.job_photo x where x.id = p1 and x.deleted_at is not null and x.delete_reason = 'ซ้ำกับรูปของออฟฟิศ') and ev.actor = pg_temp.act());
    r2 := pg_temp.q(format('select analytics.job_photo_remove(%L, %L, null, %L)', a, p3, pg_temp.act()));
    v := v || pg_temp.chk('RR3', 'ต้องไม่พัง: รูปออฟฟิศลบโดยไม่ระบุเหตุผลได้เหมือนเดิม (พฤติกรรมเดิมเป๊ะ)', r2 ->> 'ok' = 'true');
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('RR-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- T. ออก QR ใหม่ของใบที่ฉันเปิด (job_worker_token_reissue)
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid; o2 := pg_temp.open_ik(pg_temp.ik(), sM2); j2 := (o2 ->> 'job')::uuid;
    r := pg_temp.trs(sM, j);
    n0 := (select count(*)::int from analytics.job_token x where x.job_id = j and x.revoked_at is null);
    select * into ev from pg_temp.ev(j, 'token_issue') order by recorded_at desc, id desc limit 1;
    v := v || pg_temp.chk('T1', 'reissue ok: token ดิบ 43 ตัว · print_no >= 2 (ใบแรกมาจากตอนเปิดใบ) · แถว job_token issued_by_worker_id = M issued_by null · event token_issue actor null worker M ช่อง worker_qr · ได้: ' || coalesce(r ->> '_err', r ->> 'code', 'ok'),
      r ->> 'ok' = 'true' and length(r ->> 'token') = 43 and (r ->> 'print_no')::int >= 2 and r ->> 'job_no' = o ->> 'job_no'
      and exists (select 1 from analytics.job_token x where x.job_id = j and x.token_hash = analytics.job_sha256_hex(r ->> 'token') and x.issued_by_worker_id = wM and x.issued_by is null and x.revoked_at is null)
      and ev.actor is null and ev.worker_id = wM and ev.channel = 'worker_qr');
    v := v || pg_temp.chk('T1b', 'ไม่เพิกถอน QR เดิม: QR ใบแรก (ตอนเปิดใบ) ยังใช้ได้ · จำนวนที่ใช้อยู่ = 2',
      n0 = 2 and (pg_temp.q(format('select analytics.job_worker_resolve(%L, null, null)', analytics.job_sha256_hex(o ->> 'token'))) ->> 'next_action') = 'identify');
    v := v || pg_temp.chk('T2b', 'ผลมีเฉพาะ ok/already/token/print_no/job_no/job_id · ไม่มี key เงิน/ต้นทุน', (select string_agg(k2, ',' order by k2) from jsonb_object_keys(r) k2) = 'already,job_id,job_no,ok,print_no,token' and pg_temp.badkeys(r - 'token') = '');
    for k in 1 .. 3 loop r := pg_temp.trs(sM, j); end loop;
    n1 := (select count(*)::int from analytics.job_token x where x.job_id = j and x.revoked_at is null);
    r2 := pg_temp.trs(sM, j);
    v := v || pg_temp.chk('T2', 'ครบ 5 ใบที่ใช้อยู่ → ใบที่ 6 token_cap · ไม่มี token เพิ่ม (ใช้อยู่ ' || n1 || ')', n1 = 5 and r2 ->> 'code' = 'token_cap' and (select count(*) from analytics.job_token x where x.job_id = j and x.revoked_at is null) = 5);
    n0 := (select count(*)::int from analytics.job_token);
    st := coalesce(pg_temp.trs(sM, j2) ->> 'code', '-') || ',' || coalesce(pg_temp.trs(sM, (pg_temp.fx('jt_job'))) ->> 'code', '-') || ',' || coalesce(pg_temp.trs(sM, gen_random_uuid()) ->> 'code', '-') || ','
       || coalesce(pg_temp.trs(sM, null) ->> 'code', '-') || ',' || coalesce(pg_temp.trs(sMB, j, '{}'::jsonb, tokb) ->> 'code', '-') || ',' || coalesce(pg_temp.trs(sM2, j) ->> 'code', '-');
    v := v || pg_temp.chk('T3', 'ใบคนอื่น / ใบออฟฟิศ / ไม่มีจริง / null / ข้ามร้าน → order_not_found ทุกแบบ · ไม่มี token เกิด · ได้: ' || st, st = repeat('order_not_found,', 5) || 'order_not_found' and (select count(*)::int from analytics.job_token) = n0);
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('T-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    perform pg_temp.rcv(a, j);
    r := pg_temp.trs(sM, j);
    v := v || pg_temp.chk('T4', 'ต้องไม่พัง: ช่างรับงานแล้ว (editable=false) ยังออก QR ใหม่ได้ · received = ' || pg_temp.received(j)::text, pg_temp.received(j) and r ->> 'ok' = 'true');
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('T4-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    perform analytics.job_cancel(a, j, 'verify W2 T5', pg_temp.act());
    v := v || pg_temp.chk('T5b', 'ใบ cancelled → job_cancelled · ไม่ออก token', (pg_temp.trs(sM, j) ->> 'code') = 'job_cancelled');
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('T5-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    perform pg_temp.ack(a, (o ->> 'po')::uuid);
    perform pg_temp.bind(a, (o ->> 'item')::uuid, pg_temp.fx('fixb'));
    r := pg_temp.dn(a, (o ->> 'po')::uuid);
    v := v || pg_temp.chk('T5pre', 'ปิดใบผลิตผ่าน production_order_done สำเร็จ (ผูก SKU + รับทราบแล้ว) · ' || coalesce(r ->> '_err', coalesce(r ->> 'status', '?')), r ->> 'status' = 'done');
    v := v || pg_temp.chk('T5a', 'ใบผลิต done (ใบปิดแล้ว) → job_closed · ไม่ออก token', (pg_temp.trs(sM, j) ->> 'code') in ('job_closed'));
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('T5a-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    perform pg_temp.wu(a, 'ZZ-M ผู้จัดการ', null, wM, '{qc}', false, null);
    n0 := (select count(*)::int from analytics.job_token);
    v := v || pg_temp.chk('T6', 'ถอน can_open_job → not_allowed · ไม่มี token เกิด', (pg_temp.trs(sM, j) ->> 'code') = 'not_allowed' and (select count(*)::int from analytics.job_token) = n0);
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('T6-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    perform analytics.shop_intake_token_revoke(a, pg_temp.act());
    v := v || pg_temp.chk('T6b', 'QR ร้าน revoked → invalid_token', (pg_temp.trs(sM, j) ->> 'code') = 'invalid_token');
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('T6b-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    delete from analytics.worker_rate_limit;
    for k in 1 .. 11 loop r := pg_temp.trs(sM, j, jsonb_build_object('rl', '1')); end loop;
    v := v || pg_temp.chk('T7', 'ถังออก QR ต่อช่าง 10/10 นาที: ครั้งที่ 11 → rate_limited (ก่อนแตะข้อมูล)', r ->> 'code' = 'rate_limited');
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('T7-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- R. หน้าช่าง (QR ใบงาน) เห็นรูปหน้างานหลัง PIN เท่านั้น · ล็อกแถวใบอยู่ในนิยาม
  begin
    ik := pg_temp.ik(); o := pg_temp.open_ik(ik); j := (o ->> 'job')::uuid;
    r := pg_temp.pb(sM, ik); p1 := (r ->> 'photo_id')::uuid; perform pg_temp.pa(sM, ik, p1, a, j);
    s := analytics.job_sha256_hex(o ->> 'token');
    r := pg_temp.q(format('select analytics.job_worker_resolve(%L, %L, null)', s, sM));
    v := v || pg_temp.chk('R1', 'หน้าช่างหลัง PIN (job_worker_resolve): รูปจากหน้างานอยู่ใน job.photos เป็นรูปหลัก (is_primary) · มี id/sm_path/md_path/is_primary/caption เท่านั้น',
      exists (select 1 from jsonb_array_elements(r -> 'job' -> 'photos') e where (e ->> 'id')::uuid = p1 and (e ->> 'is_primary')::boolean)
      and (select string_agg(k2, ',' order by k2) from jsonb_array_elements(r -> 'job' -> 'photos') e, jsonb_object_keys(e) k2 where (e ->> 'id')::uuid = p1) = 'caption,id,is_primary,md_path,sm_path');
    r2 := pg_temp.q(format('select analytics.job_worker_resolve(%L, null, null)', s));
    v := v || pg_temp.chk('R2', 'ก่อนใส่ PIN (ไม่มี session) ไม่มีรูปใดใน payload (มติ security เดิม)', position(p1::text in r2::text) = 0 and not (r2 -> 'job' ? 'photos'));
    def := pg_get_functiondef('analytics.job_worker_photo_add(text,text,text,uuid,text,text,integer,integer,integer,boolean,text,text,uuid,uuid)'::regprocedure);
    v := v || pg_temp.chk('R3', 'นิยาม add: ล็อกแถวใบ (for update) ก่อนเช็คสถานะ (job_worker_photo_block) ก่อน INSERT',
      position('for update' in def) > 0 and position('job_worker_photo_block' in def) > position('for update' in def) and position('insert into analytics.job_photo' in def) > position('job_worker_photo_block' in def));
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('R-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  return v;
end;
$c$;

-- ============================================================================
-- E. สิทธิ์ · overload (ไม่ต้องมีข้อมูล)
-- ============================================================================
create function pg_temp.g_189_perm() returns text
 language plpgsql as $c$
declare
  v text := ''; st text; sg text; s text;
  c_rpc constant text[] := array[
    'analytics.job_worker_photo_begin(text,text,text,text,uuid,uuid)',
    'analytics.job_worker_photo_add(text,text,text,uuid,text,text,integer,integer,integer,boolean,text,text,uuid,uuid)',
    'analytics.job_worker_photo_remove(text,text,uuid,text,text)',
    'analytics.job_worker_photo_list(text,text,text,text,uuid)',
    'analytics.job_worker_my_intake_list(text,text,text)',
    'analytics.job_worker_token_reissue(text,text,uuid,text,text)',
    'analytics.job_worker_photo_set_primary(text,text,uuid,text,text,uuid)'];
  c_int constant text[] := array[
    'analytics.shop_intake_photo_auth(text,text,text,text)', 'analytics.job_worker_photo_job(uuid,uuid,text,uuid)', 'analytics.job_worker_photo_block(uuid)', 'analytics.job_photo_guard()', 'analytics.job_shopfloor_photo_quota()'];
  c_names constant text[] := array['job_worker_photo_begin', 'job_worker_photo_add', 'job_worker_photo_remove', 'job_worker_photo_list', 'job_worker_my_intake_list', 'job_worker_token_reissue', 'job_worker_photo_set_primary', 'shop_intake_photo_auth', 'job_worker_photo_job', 'job_worker_photo_block', 'job_photo_guard', 'job_shopfloor_photo_quota'];
begin
  v := v || pg_temp.chk('E1', 'ฟังก์ชันของ 0189: 1 signature ต่อชื่อ (12 ชื่อ · ไม่มี overload) · signature ตรงที่ประกาศ',
    (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace and proname = any (c_names)) = 12
    and (select bool_and(to_regprocedure(x) is not null) from unnest(c_rpc || c_int) x));
  v := v || pg_temp.chk('E2', 'anon/authenticated ไม่มี EXECUTE ทั้ง 9 ตัว (has_function_privilege)',
    not exists (select 1 from unnest(c_rpc || c_int) x where has_function_privilege('anon', x, 'execute') or has_function_privilege('authenticated', x, 'execute')));
  v := v || pg_temp.chk('E3', 'service_role: RPC 7 ตัว execute ได้ · helper 3 ตัว + guard ไม่ได้ (ไม่เปิดให้ใคร)',
    (select bool_and(has_function_privilege('service_role', x, 'execute')) from unnest(c_rpc) x) and not exists (select 1 from unnest(c_int) x where has_function_privilege('service_role', x, 'execute')));
  v := v || pg_temp.chk('E4', 'proacl ทั้งสคีมา analytics: ไม่มี PUBLIC/anon/authenticated ถือ EXECUTE ฟังก์ชันใดเลย (aclexplode)',
    not exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a where p.pronamespace = 'analytics'::regnamespace and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole)));
  -- 18.5: จำลองวันที่กำแพงชั้นนอกหลุด (grant usage สคีมากลับ) แล้วยิงจริงในฐานะ authenticated → ต้องตกที่ 42501 ก่อนเข้า body
  begin
    execute 'grant usage on schema analytics to authenticated';
    st := '';
    foreach s in array array[
      'select analytics.job_worker_photo_begin(null, null, null, null, null)',
      'select analytics.job_worker_photo_add(null, null, null, null, null, null, null)',
      'select analytics.job_worker_photo_remove(null, null, null, null, null)',
      'select analytics.job_worker_photo_list(null, null, null, null, null)',
      'select analytics.job_worker_my_intake_list(null, null, null)',
      'select analytics.job_worker_token_reissue(null, null, null)',
      'select analytics.job_worker_photo_set_primary(null, null, null)'] loop
      st := st || pg_temp.asrole('authenticated', s) || ',';
    end loop;
    execute 'revoke usage on schema analytics from authenticated';
    v := v || pg_temp.chk('E5', 'authenticated ยิง RPC ทั้ง 7 (args null) แม้สคีมาเปิด → 42501 ทุกตัว · ได้: ' || st, st = repeat('42501,', 7));
    raise exception 'rb_189';
  exception when others then
    if sqlerrm <> 'rb_189' then v := v || pg_temp.chk('E5-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  v := v || pg_temp.chk('E6', 'job_photo มี trigger เปิดอยู่ 3 ตัวเท่าเดิม (guard + cap + deny truncate) · RLS เปิดไม่มี policy',
    (select count(*) from pg_trigger t where t.tgrelid = 'analytics.job_photo'::regclass and not t.tgisinternal and t.tgenabled in ('O', 'A')) = 3
    and (select c.relrowsecurity from pg_class c where c.oid = 'analytics.job_photo'::regclass) and not exists (select 1 from pg_policy where polrelid = 'analytics.job_photo'::regclass));
  v := v || pg_temp.chk('E7', 'bucket job-photos ยัง private · 1 MB · image/jpeg · ไม่มี storage policy (0189 ไม่แตะ bucket)',
    exists (select 1 from storage.buckets b where b.id = 'job-photos' and b.public = false and b.file_size_limit = 1048576 and b.allowed_mime_types = array['image/jpeg'])
    and not exists (select 1 from pg_policies p where p.schemaname = 'storage' and p.tablename in ('objects', 'buckets') and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%job-photos%'));
  return v;
end;
$c$;

-- ============================================================================
-- M. mutant: ถอด/ย้อนด่านทีละตัวแล้วเทสต์ต้องล้มจริง (id ที่คาด) — ไม่ล้ม = เทสต์ไม่ได้ป้องกันด่านนั้น
-- ============================================================================
create function pg_temp.g_189_mut() returns text
 language plpgsql as $c$
declare
  v text := ''; s text; k int; muts jsonb; m jsonb; st jsonb; hit int; i text; killed int := 0; total int;
  sg_begin constant text := 'analytics.job_worker_photo_begin(text,text,text,text,uuid,uuid)';
  sg_add constant text := 'analytics.job_worker_photo_add(text,text,text,uuid,text,text,integer,integer,integer,boolean,text,text,uuid,uuid)';
  sg_rm constant text := 'analytics.job_worker_photo_remove(text,text,uuid,text,text)';
  sg_job constant text := 'analytics.job_worker_photo_job(uuid,uuid,text,uuid)';
  sg_blk constant text := 'analytics.job_worker_photo_block(uuid)';
  sg_auth constant text := 'analytics.shop_intake_photo_auth(text,text,text,text)';
  sg_guard constant text := 'analytics.job_photo_guard()';
  sg_my constant text := 'analytics.job_worker_my_intake_list(text,text,text)';
  sg_sp constant text := 'analytics.job_worker_photo_set_primary(text,text,uuid,text,text,uuid)';
  sg_orm constant text := 'analytics.job_photo_remove(uuid,uuid,text,uuid)';
  sg_rei constant text := 'analytics.job_worker_token_reissue(text,text,uuid,text,text)';
begin
  muts := jsonb_build_array(
    jsonb_build_object('id', 'MU1', 'what', 'remove ไม่เช็คเจ้าของรูป (worker_id) → ลบรูปของคนอื่นได้', 'steps', jsonb_build_array(jsonb_build_array(sg_rm, 'and ph.worker_id = v_wid and ph.source = ''shopfloor''', 'and ph.source = ''shopfloor''')), 'expect', jsonb_build_array('B14')),
    jsonb_build_object('id', 'MU2', 'what', 'lookup ใบไม่ผูก opened_by_worker_id → ใช้ key/job_id ของช่างอื่นได้', 'steps', jsonb_build_array(jsonb_build_array(sg_job, 'and po.opened_by_worker_id = p_worker_id', '')), 'expect', jsonb_build_array('B1', 'G3')),
    -- ล็อกมี 2 ชั้นที่ตั้งใจ: (ก) ขั้น received/sent (ข) job.status in_progress/done — บน DB จริง job_core_receive ตั้ง job เป็น in_progress ตอนรับขั้น ⇒ ถอดชั้น (ก) ชั้นเดียวเป็น mutant "เทียบเท่า" (ชั้น ข จับแทน · ผลยังเป็น job_locked)
    -- (PGlite ที่จำลอง job ไม่เปลี่ยนสถานะ จึงเห็นชั้น ก ชั้นเดียว) → mutant ที่มีความหมายต้องถอดทั้งสองชั้น: ใบที่ช่างรับแล้วต้องตกที่ job_not_open (ไม่ใช่ job_locked) = B4 ล้ม
    jsonb_build_object('id', 'MU3', 'what', 'ไม่นับขั้น received/sent และ job in_progress/done เป็นล็อก (ถอดทั้งสองชั้น)', 'steps', jsonb_build_array(jsonb_build_array(sg_blk, 's.status in (''received'', ''sent'')', 's.status in (''zz'')'), jsonb_build_array(sg_blk, 'v_job.status in (''in_progress'', ''done'')', 'v_job.status in (''zz'')')), 'expect', jsonb_build_array('B4')),
    jsonb_build_object('id', 'MU4a', 'what', 'begin ไม่เช็คเพดานหน้างาน 3', 'steps', jsonb_build_array(jsonb_build_array(sg_begin, 'if v_sf >= 3 then', 'if false then')), 'expect', jsonb_build_array('A6a')),
    jsonb_build_object('id', 'MU4b', 'what', 'add + guard ไม่เช็คเพดานหน้างาน 3 (ถอดทั้งสองชั้น) → รูปที่ 4 เข้าได้', 'steps', jsonb_build_array(jsonb_build_array(sg_guard, ') >= 3 then', ') >= 99 then'), jsonb_build_array(sg_add, 'if v_sf >= 3 then', 'if v_sf >= 99 then')), 'expect', jsonb_build_array('A6b')),
    jsonb_build_object('id', 'MU5', 'what', 'add ไม่เช็ค path md ตรง photo_id (เหลือ CHECK ของตาราง)', 'steps', jsonb_build_array(jsonb_build_array(sg_add, 'if p_storage_path is distinct from v_prefix || ''_md.jpg''', 'if false and p_storage_path is distinct from v_prefix || ''_md.jpg''')), 'expect', jsonb_build_array('B9')),
    jsonb_build_object('id', 'MU6', 'what', 'ไม่ตรวจ can_open_job', 'steps', jsonb_build_array(jsonb_build_array(sg_auth, 'if p_bucket <> ''list'' and not v_w.can_open_job then', 'if false then')), 'expect', jsonb_build_array('B8c')),
    jsonb_build_object('id', 'MU7', 'what', 'guard ไม่บังคับ GUC (INSERT shopfloor ตรงได้)', 'steps', jsonb_build_array(jsonb_build_array(sg_guard, 'if current_setting(''analytics.shop_photo_id'', true) is distinct from new.id::text then', 'if false then')), 'expect', jsonb_build_array('A6d', 'A6e')),
    jsonb_build_object('id', 'MU8', 'what', 'session ที่ถูกเพิกถอนยังใช้ได้', 'steps', jsonb_build_array(jsonb_build_array(sg_auth, 's.revoked_at is null', 'true')), 'expect', jsonb_build_array('B7')),
    jsonb_build_object('id', 'MU9', 'what', 'token ที่ถูกเพิกถอนยังใช้ได้', 'steps', jsonb_build_array(jsonb_build_array(sg_auth, 'if not found or v_tok.revoked_at is not null then', 'if not found then')), 'expect', jsonb_build_array('B6')),
    jsonb_build_object('id', 'MU10', 'what', 'session ข้ามร้าน (ไม่เทียบร้านของ token)', 'steps', jsonb_build_array(jsonb_build_array(sg_auth, 'and w.is_active and w.shop_id = v_tok.shop_id', 'and w.is_active')), 'expect', jsonb_build_array('B7e')),
    jsonb_build_object('id', 'MU11', 'what', 'ด่านใบ cancelled ถอด', 'steps', jsonb_build_array(jsonb_build_array(sg_blk, 'if v_job.status = ''cancelled'' or v_po = ''cancelled'' then', 'if false then')), 'expect', jsonb_build_array('B5')),
    jsonb_build_object('id', 'MU12', 'what', 'rate limit ต่อช่างถูกถอด', 'steps', jsonb_build_array(jsonb_build_array(sg_auth, 'if not analytics.job_rate_limit_hit(case p_bucket when ''write'' then ''wp:''', 'if false and not analytics.job_rate_limit_hit(case p_bucket when ''write'' then ''wp:''')), 'expect', jsonb_build_array('C2')),
    jsonb_build_object('id', 'MU13', 'what', 'ด่านถังต่อ IP ถูกถอด', 'steps', jsonb_build_array(jsonb_build_array(sg_auth, 'if not analytics.job_rate_limit_hit(case p_bucket when ''write'' then ''ipw:''', 'if false and not analytics.job_rate_limit_hit(case p_bucket when ''write'' then ''ipw:''')), 'expect', jsonb_build_array('C1')),
    jsonb_build_object('id', 'MU14', 'what', 'my list ไม่เช็คเจ้าของใบ → เห็นใบของคนอื่น', 'steps', jsonb_build_array(jsonb_build_array(sg_my, 'po.opened_by_worker_id = v_wid and po.opened_via = ''shopfloor''', 'po.opened_via = ''shopfloor''')), 'expect', jsonb_build_array('H3')),
    jsonb_build_object('id', 'MU15', 'what', 'my list บอก editable=true เสมอ', 'steps', jsonb_build_array(jsonb_build_array(sg_my, '''editable'', analytics.job_worker_photo_block(j.id) is null', '''editable'', true')), 'expect', jsonb_build_array('H4')),
    jsonb_build_object('id', 'MU16', 'what', 'my list ไม่เช็ค can_open (ถอนสิทธิ์แล้วยังเห็น)', 'steps', jsonb_build_array(jsonb_build_array(sg_my, 'if not (v_a ->> ''can_open'')::boolean then', 'if false then')), 'expect', jsonb_build_array('H8')),
    jsonb_build_object('id', 'MU17', 'what', 'reissue ไม่เช็คใบปิด (ใบผลิต done)', 'steps', jsonb_build_array(jsonb_build_array(sg_rei, 'if v_job.status = ''done'' or v_po is distinct from ''open'' then', 'if false then')), 'expect', jsonb_build_array('T5a')),
    jsonb_build_object('id', 'MU18', 'what', 'reissue เพิกถอน QR เดิม (revoke_previous = true)', 'steps', jsonb_build_array(jsonb_build_array(sg_rei, 'job_token_issue_core(v_job, false, null, v_wid', 'job_token_issue_core(v_job, true, null, v_wid')), 'expect', jsonb_build_array('T1b')),
    jsonb_build_object('id', 'MU19', 'what', 'reissue ไม่มีถังออก QR ต่อช่าง', 'steps', jsonb_build_array(jsonb_build_array(sg_rei, 'if not analytics.job_rate_limit_hit(''wt:'' || v_wid::text, 10) then', 'if false then')), 'expect', jsonb_build_array('T7')),
    jsonb_build_object('id', 'MU20', 'what', 'reissue ใช้ job_id ของคนอื่นได้ (ถอนเงื่อนไขเจ้าของที่ helper)', 'steps', jsonb_build_array(jsonb_build_array(sg_job, 'and po.opened_by_worker_id = p_worker_id', '')), 'expect', jsonb_build_array('T3')),
    jsonb_build_object('id', 'MU21', 'what', 'reissue ไม่เช็คใบ cancelled', 'steps', jsonb_build_array(jsonb_build_array(sg_rei, 'if v_job.status = ''cancelled'' or v_po = ''cancelled'' then', 'if false then')), 'expect', jsonb_build_array('T5b')),
    jsonb_build_object('id', 'MU22', 'what', 'guard ไม่บังคับพื้นที่รวมหน้างานต่อร้าน', 'steps', jsonb_build_array(jsonb_build_array(sg_guard, '> (analytics.job_shopfloor_photo_quota() ->> ''shop_bytes_max'')::bigint', '> 9000000000000')), 'expect', jsonb_build_array('M1a', 'M1e')),
    jsonb_build_object('id', 'MU23', 'what', 'guard ไม่บังคับเพดานต่อช่าง/24 ชม.', 'steps', jsonb_build_array(jsonb_build_array(sg_guard, '>= (analytics.job_shopfloor_photo_quota() ->> ''worker_24h_max'')::int', '>= 100000')), 'expect', jsonb_build_array('M1d', 'M1d2')),
    jsonb_build_object('id', 'MU24', 'what', 'เพดานต่อช่างนับเฉพาะรูปที่ยังไม่ลบ (วน add/remove ได้)', 'steps', jsonb_build_array(jsonb_build_array(sg_guard, 'p.source = ''shopfloor'' and p.created_at > now()', 'p.source = ''shopfloor'' and p.deleted_at is null and p.created_at > now()')), 'expect', jsonb_build_array('M1d2')),
    jsonb_build_object('id', 'MU25', 'what', 'begin ไม่เช็คพื้นที่เต็มก่อนแตะ bucket', 'steps', jsonb_build_array(jsonb_build_array(sg_begin, 'if v_bytes >= (analytics.job_shopfloor_photo_quota() ->> ''shop_bytes_max'')::bigint then', 'if false then')), 'expect', jsonb_build_array('M1b')),
    jsonb_build_object('id', 'MU26', 'what', 'begin ไม่เช็คเพดานต่อช่าง/24 ชม.', 'steps', jsonb_build_array(jsonb_build_array(sg_begin, 'if v_day >= (analytics.job_shopfloor_photo_quota() ->> ''worker_24h_max'')::int then', 'if false then')), 'expect', jsonb_build_array('M1d1')),
    jsonb_build_object('id', 'MU27', 'what', 'session หมดอายุแล้วยังใช้ได้ (ไม่เช็ค expires_at)', 'steps', jsonb_build_array(jsonb_build_array(sg_auth, 's.expires_at > now()', 'true')), 'expect', jsonb_build_array('B7b')),
    jsonb_build_object('id', 'MU28', 'what', 'ช่างที่ถูกปิดใช้ยังใช้ session ได้ (ไม่เช็ค is_active)', 'steps', jsonb_build_array(jsonb_build_array(sg_auth, 'and w.is_active and w.shop_id = v_tok.shop_id', 'and w.shop_id = v_tok.shop_id')), 'expect', jsonb_build_array('B7d')),
    jsonb_build_object('id', 'MU29', 'what', 'guard ไม่ล็อกต่อใบก่อนนับเพดาน (L1)', 'steps', jsonb_build_array(jsonb_build_array(sg_guard, 'perform pg_advisory_xact_lock(hashtextextended(new.job_id::text, 2));', 'perform 1;')), 'expect', jsonb_build_array('L1')),
    jsonb_build_object('id', 'MU30', 'what', 'guard นับเพดาน 3 รวม kind stage (L2)', 'steps', jsonb_build_array(jsonb_build_array(sg_guard, 'p.source = ''shopfloor'' and p.kind = ''reference'' and p.deleted_at is null) >= 3', 'p.source = ''shopfloor'' and p.deleted_at is null) >= 3')), 'expect', jsonb_build_array('L2')),
    jsonb_build_object('id', 'MU31', 'what', 'set_primary ตั้งรูปที่ไม่ใช่ของหน้างานของตัวเอง (ถอนเงื่อนไขเจ้าของ+ที่มา)', 'steps', jsonb_build_array(jsonb_build_array(sg_sp, 'and ph.worker_id = v_wid and ph.source = ''shopfloor''', '')), 'expect', jsonb_build_array('SP10')),
    jsonb_build_object('id', 'MU32', 'what', 'set_primary ล้มรูปหลักที่ออฟฟิศตั้งไว้ (ถอด primary_locked)', 'steps', jsonb_build_array(jsonb_build_array(sg_sp, 'if v_prim_id is not null and v_prim_src <> ''shopfloor'' then', 'if false then')), 'expect', jsonb_build_array('SP4')),
    jsonb_build_object('id', 'MU33', 'what', 'set_primary ไม่เช็คล็อกใบ (ช่างรับงานแล้ว)', 'steps', jsonb_build_array(jsonb_build_array(sg_sp, 'v_block := analytics.job_worker_photo_block(v_job_id);', 'v_block := null;')), 'expect', jsonb_build_array('SP6')),
    jsonb_build_object('id', 'MU34', 'what', 'begin ไม่สนใจ clientPhotoKey (ไม่คืนรูปเดิม)', 'steps', jsonb_build_array(jsonb_build_array(sg_begin, 'if p_client_key is not null then', 'if false then')), 'expect', jsonb_build_array('CK2', 'CK4')),
    jsonb_build_object('id', 'MU35', 'what', 'add ไม่สนใจ clientPhotoKey (INSERT ซ้ำ)', 'steps', jsonb_build_array(jsonb_build_array(sg_add, 'if p_client_key is not null then', 'if false then')), 'expect', jsonb_build_array('CK3')),
    jsonb_build_object('id', 'MU36', 'what', 'reissue ไม่ dedupe ตาม idem key', 'steps', jsonb_build_array(jsonb_build_array(sg_rei, 'r.window_start >= v_win - interval ''10 minutes'') then', 'r.window_start >= v_win - interval ''10 minutes'') and false then')), 'expect', jsonb_build_array('RI1')),
    jsonb_build_object('id', 'MU37', 'what', 'reissue ไม่บันทึกร่องรอยหลังออกสำเร็จ (key ไม่ถูกจำ)', 'steps', jsonb_build_array(jsonb_build_array(sg_rei, 'insert into analytics.worker_rate_limit (key, window_start, hits) values (v_rk, v_win, 1) on conflict (key, window_start) do nothing;', 'perform 1;')), 'expect', jsonb_build_array('RI1')),
    jsonb_build_object('id', 'MU38', 'what', 'reissue key ไม่ผูกกับใบ (key เดียวกันคนละใบถูกถือว่าซ้ำ)', 'steps', jsonb_build_array(jsonb_build_array(sg_rei, 'p_idem_key || '':'' || v_job_id::text', 'p_idem_key')), 'expect', jsonb_build_array('RI6')),
    jsonb_build_object('id', 'MU39', 'what', 'ออฟฟิศลบรูป shopfloor โดยไม่ต้องมีเหตุผล', 'steps', jsonb_build_array(jsonb_build_array(sg_orm, 'if v_ph.source = ''shopfloor'' and (v_reason is null or length(v_reason) < 2 or not analytics.oem_note_present(v_reason)) then', 'if false then')), 'expect', jsonb_build_array('RR1')),
    jsonb_build_object('id', 'MU40', 'what', 'เหตุผลเป็นสัญลักษณ์ล้วนผ่าน (ถอด oem_note_present)', 'steps', jsonb_build_array(jsonb_build_array(sg_orm, 'or not analytics.oem_note_present(v_reason)', '')), 'expect', jsonb_build_array('RR1')));
  total := jsonb_array_length(muts);
  for k in 0 .. total - 1 loop
    m := muts -> k; s := '';
    begin
      for st in select value from jsonb_array_elements(m -> 'steps') loop
        perform pg_temp.mutate(st ->> 0, st ->> 1, st ->> 2);
      end loop;
      s := pg_temp.g_189();
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
do $v189$
declare
  v_msg text := E'\n=== verify 0189 ===\n';
  v_snap0 text; v_hit int; v_fail int; v_ok int; v_skip int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  create temp table _v189_orig on commit drop as
    select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h, p.proacl::text as acl
      from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.prokind in ('f', 'p');
  v_snap0 := pg_temp.snap();
  begin
    v_msg := v_msg || pg_temp.g_setup();
    v_msg := v_msg || pg_temp.chk('G3', 'production_order_done (ฟังก์ชัน 💰) ไม่ถูกแตะ: md5 ตรงค่าที่ล็อกไว้ใน 0187', pg_temp.done_md5() = pg_temp.done_md5_before());
    v_msg := v_msg || pg_temp.g_189_perm();
    v_msg := v_msg || pg_temp.g_189();
    v_msg := v_msg || pg_temp.g_189_mut();
    select count(*) into v_hit from _v189_orig o join pg_proc p on p.pronamespace = 'analytics'::regnamespace and p.prokind in ('f', 'p') and p.oid::regprocedure::text = o.sig
     where md5(pg_get_functiondef(p.oid)) = o.h and p.proacl::text is not distinct from o.acl;
    v_msg := v_msg || pg_temp.chk('MY', format('หลัง mutant: md5 นิยาม + สิทธิ์ของฟังก์ชันทุกตัวในสคีมา analytics (%s ตัว) เท่าเดิมเป๊ะ', (select count(*) from _v189_orig)),
      v_hit = (select count(*) from _v189_orig) and (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace and prokind in ('f', 'p')) = (select count(*) from _v189_orig));
    raise exception 'V189_ROLLBACK';
  exception when others then
    if sqlerrm <> 'V189_ROLLBACK' then v_msg := v_msg || format('[FAIL] S1-crash  ชุดหลัก raise นอกกลุ่ม: %s %s', sqlstate, sqlerrm) || E'\n'; end if;
  end;
  v_msg := v_msg || pg_temp.chk('K0', 'ชุดทดสอบไม่ทิ้งรอย: snapshot (job/ใบผลิต/รูป/QR ร้าน/ช่าง/session/ตัวนับ/lot/สต็อก/product/shop) เท่าเดิมหลังถอยกลับ', pg_temp.snap() = v_snap0);
  v_fail := (length(v_msg) - length(replace(v_msg, '[FAIL]', ''))) / length('[FAIL]');
  v_skip := (length(v_msg) - length(replace(v_msg, '[SKIP]', ''))) / length('[SKIP]');
  v_ok := (length(v_msg) - length(replace(v_msg, '[OK]', ''))) / length('[OK]');
  v_msg := v_msg || format(E'\n--- สรุป: OK %s · FAIL %s · SKIP %s ---', v_ok, v_fail, v_skip);
  raise exception '%', v_msg;
end;
$v189$;
