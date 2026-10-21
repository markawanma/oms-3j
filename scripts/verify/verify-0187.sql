-- scripts/verify/verify-0187.sql
-- ตรวจ supabase/migrations/0187_shop_intake_w1.sql (W1: ผู้จัดการเปิดใบผลิต+ใบงานจากมือถือด้วย QR ร้าน + PIN · ack · ผูก SKU ทีหลัง · ด่านปิดใบ · ช่องสาธารณะที่ "สร้างข้อมูล" → security บังคับก่อน merge)
-- self-rolling-back (3j-migration-traps ข้อ 11): ทุกเคสอยู่ในทรานแซกชันเดียว จบด้วย `raise exception` เสมอ ⇒ ถอยทั้งก้อน · อ่านผลจาก error message · exit 1 คือผลที่คาด · [FAIL] >= 1 = ไม่ผ่าน · [SKIP] ไม่นับเป็นผ่าน
-- ข้อมูลทดสอบ: ร้านสังเคราะห์ ZZ TEST verify-0187 A/B (insert public.shop ตรง ตามแพทเทิร์น verify-0144/0186 — ข้อยกเว้นที่ไม่ผ่าน RPC) · SKU/ช่าง/QR ร้าน/ใบผลิต/ใบงาน/ผูก SKU/ack/done สร้างผ่าน RPC ของระบบทั้งหมด
-- ข้อยกเว้นที่บอกตรงๆ (ทั้งหมดอยู่ในทรานแซกชัน/ซับบล็อกที่ถอยกลับ): (1) จัดสถานะ fixture ด้วย UPDATE/INSERT/DELETE ตรง — เวลา session หมดอายุ · ปิดช่างโดยไม่เพิกถอน session · ถอดแบบการบันทึกค่าเริ่ม · เติมถังจำกัดอัตราให้เต็ม · ล้างถัง wo:/sio: ระหว่างเคสที่วนยิงพารามิเตอร์ผิด · ปลด locked_until ระหว่างไต่บันไดล็อก (now() คงที่ในทรานแซกชันเดียว)
--   (2) `set local session_replication_role = replica` เฉพาะซับบล็อก B6b เพื่อจัดสถานะใบงาน done แล้วเปิดกลับ origin ก่อนทดสอบ (ไม่มีทางสร้างใบงาน done ผ่าน RPC โดยไม่เดินครบ 9 ขั้น) · (3) ส่วน E อ่าน + แก้-แล้วถอยกลับ บนข้อมูลจริงของร้านจริง · โคลนใบเสนอราคา OEM จริง (แพทเทิร์น verify-0185) เพื่อได้ใบงาน OEM
-- 🔴 ไม่แตะตัวนับเอกสารภาษี (ไม่มีใบเสร็จ/ใบกำกับ) · ตัวนับใบผลิต/ใบงานที่เดินจากการทดสอบถอยกลับพร้อมทรานแซกชัน (K0 ตรวจว่าของจริงไม่ขยับ)
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0187.sql
-- dry-run ก่อน apply: ต่อไฟล์ migration 0187 + ไฟล์นี้ (ไฟล์ LF — ข้อ 20) เป็นไฟล์เดียว แล้วรันไม่ใส่ --commit  (ไฟล์นี้อย่างเดียวรันก่อน apply ไม่ได้ — ฟังก์ชัน/ตารางใหม่ยังไม่มี)
--
-- ============ ตารางแมป "ข้อในบรีฟ -> เทสต์ที่ครอบ" (เคสห้ามผ่าน + ต้องไม่พัง ตามบรีฟ 20 ต.ค.) ============
--  ❌ ห้ามผ่าน
--   token ร้านปลอม · เพิกถอน                                                       -> T1a-T1c (ปลอม/ผิดรูป) · T3a-T3c (เพิกถอน + ข้อความเดียวกับปลอม) · MU1
--   ไม่มี session / หมด / ช่าง inactive / session ร้านอื่น                          -> O2a-O2c · T6a-T6d · H4a-H4c · MU2 (ไม่ใช่ด่านนี้) · ด่าน shop_intake_auth
--   can_open_job=false เรียก open/search                                           -> O1a-O1c (รวมถอนสิทธิ์ระหว่างมี session) · MU2
--   SKU ร้านอื่น/inactive/^live                                                    -> O3a-O3b (open + search) · MU11 (search)
--   qty ≤0 / >100000 / planned<order                                               -> O4a-O4b
--   due ย้อน / เกิน 2 ปี                                                             -> O4c (เมื่อวาน · +731) · O4d-O4e (ขอบ +730 · วันนี้ผ่าน) · C5a-C5b (วันไทย)
--   ชื่อ/หมายเหตุ control/bidi                                                      -> O5a-O5b · B7c (label_set) · OK5f (ค้น)
--   ทองไม่มีเนื้อ / เนื้อ<37.5                                                       -> O6a-O6b (+NaN/Infinity/ทศนิยม) · O6e (SKU override ทองไม่มีเนื้อ)
--   idem ซ้ำ = ใบเดียว ไม่ออก token ใหม่                                             -> O9a-O9b · MU9 (conflict)
--   idem ช่างอื่น = ปฏิเสธ                                                           -> O9c · O9d (รูปแบบ key)
--   SKU มีใบงาน open → job_exists + rollback ทั้งก้อน (ตัวนับสองตัวไม่ขยับ)          -> O7a-O7d (+ O6e/O8a/O8c = ด่านที่ตกหลังสร้าง PO แล้ว ต้องถอยทั้งก้อน) · MU16
--   ทองไม่มีแบบทอง → no_gold_profile                                                -> O8a-O8c
--   rate limit เกิน → ก่อนแตะข้อมูล                                                  -> O10a (ต่อช่าง) · O10b (ต่อ token · ก่อนตรวจพารามิเตอร์) · O10c (ต่อ IP) · P6a-P6c · H5 · MU15 MU17
--   done ใบ shopfloor ไม่ ack → ack_required                                        -> Y5 (ผ่าน production_order_done) · K4a (UPDATE ตรง) · MU4
--   ack ซ้ำ / ใบ office                                                             -> K1b-K1c · K2a-K2c (แก้/ถอนตรง) · K3g (CHECK) · MU12 MU13
--   UPDATE ตรงคอลัมน์ intake/ack/opened_by                                          -> K2a-K2c · K3a-K3c (origin_locked) · B5i-B5k (job.created_by/opened_by) · C3a-C3b (job_token) · MU3 MU13 MU14
--   created_by และ opened_by_worker_id ว่างทั้งคู่                                   -> C1d-C1f (นิยาม CHECK + job_create_insert) · B5k · C1a-C1c/C1g-C1h (QR: issued_by/issued_by_worker_id)
--   token ร้าน active ตัวที่ 2                                                       -> T4c-T4d (partial unique 23505)
--   response ฝั่งช่างไม่มี key cost|price|thb|margin|unit_cost|customer|target_piece_g -> OK1h · OK3b-OK3c (ทอง 5.5 g ไม่ปรากฏ) · OK5b · P1c · H1b · T4f (badkeys ทุกผลลัพธ์ฝั่งช่าง)
--   anon/authenticated execute                                                     -> T7a-T7d (has_function_privilege + จำลอง schema หลุดแล้วยิง 42501) · C6a-C6e (ตาราง/คอลัมน์)
--   overload 1 แถว/ชื่อ                                                              -> C4a-C4c (+ signature เดิมถูก drop) · migration §10 (ตรวจก่อน commit)
--   bind: SKU ซ้ำในใบ/inactive/^live/ผูกแล้ว/ใบไม่ open/effective metal เปลี่ยนเงียบ    -> B2a-B2f · B1d · B3a-B3e (effective ไม่เปลี่ยน · เตือน metal_known) · B4a-B4b (trigger ล็อกโลหะ — แถว metal ว่าง) · B5a-B5h (ช่องแคบของ job_guard) · MU7 MU8
--  ✅ ต้องไม่พัง
--   ใบผลิตที่ออฟฟิศเปิด (opened_via default 'office') ไม่ติด ack/sku                  -> K5a (done ผ่านโดยไม่ ack) · E1a · E4b (ใบผลิตจริง open → done ผ่านด่านใหม่) · K4d-K4e (ใบ office ที่มีรายการไม่มี SKU ติด sku_required ตามเดิม 0186)
--   production_order_done md5 เท่าเดิม                                              -> C7 · Y7c · K5b · migration §11 (ล้ม = ไม่ apply)
--   ฟอร์มสร้างใบงานออฟฟิศเดิม                                                        -> R2a-R2e · R3a-R3c (wrapper job_create_from_production_item/job_token_issue) · E7a-E7b (OEM job_create_from_quote_item → job_create_insert 21 arg เดิมบนข้อมูลจริง)
--   /w/<token> เดิมทุกเคส (PIN ผิด/lock/budget)                                      -> P2d · P4a (บันไดเดียวกันสองทาง) · P5a · R4a-R4d · P6c · P7a
--   session จาก hub ใช้สแกนใบงานได้และกลับกัน                                        -> P7a-P7c
--   worker_upsert แบบเดิม (ไม่ส่ง flag) = พฤติกรรมเดิม                                -> R1a-R1g · E6a-E6b (ช่างจริง)
--   ครบวงจร hub → PIN → เปิดไม่มี SKU ทอง 75% → ใบงาน profile ทอง → ack → bind SKU → done → lot -> Y1-Y8
--   ช่วง 00:00–07:00 ไทย                                                           -> C5a-C5b (ไม่มี current_date/now()::date · ใช้ job_today = วันไทย) · O4c-O4e  [ดู "ไม่มีเทสต์ครอบ" ข้อ 2]
--  🧪 mutant ≥ 3 -> MU1-MU18 (ลบ/ย้อนด่านทีละตัวแล้วเทสต์ต้องล้มจริง) · MX (ถูกจับครบ) · MY (นิยาม+สิทธิ์ทุกฟังก์ชัน analytics เท่าเดิมหลัง mutant) · K0 (state ไม่ขยับ)
--  🔁 ยิงของใหม่ใส่ข้อมูลเก่าทุกสถานะที่มีจริง (ข้อ 17) -> E1-E7 (ใบงานจริงทุกสถานะ · QR จริง · ใบผลิตจริง · ช่างจริง · รายการจริง · OEM จริง)
--
--  ❌ ไม่มีเทสต์ครอบ (บอกตรงๆ):
--    1. race จริงหลาย connection (เปิดใบ key เดียวกันพร้อมกัน · ออก QR ร้านพร้อมกัน · ack พร้อมกัน) — do-block ทรานแซกชันเดียวจำลองไม่ได้ · กันด้วย advisory lock ต่อ idem key + partial unique + ล็อกแถวตัวนับ (ตรวจได้แค่โครงสร้าง: T4c-T4d, O9a)
--    2. ช่วง 00:00–07:00 ไทยที่ UTC เหลื่อมวัน — now() คงที่ตามเวลารันจริง ตั้งเวลาไม่ได้ · ตรวจแค่ว่าไม่มี current_date/now()::date และใช้ job_today() (C5) · เคสที่ "เมื่อวานไทย" ต้องตก (O4c) จะจับบั๊ก UTC ได้จริงเมื่อรันช่วงนั้น
--    3. ชั้น TS (server action · cookie · มติ UI) = vitest ฝั่ง lib/ (job-worker.test.ts · exempt-path.worker.test.ts ฯลฯ) ไม่ใช่ไฟล์นี้ · ไม่มีการยิงหน้า /w/s/ จริง (UI ยังไม่ทำ)
--    4. ใบงานที่แยกส่วน (parts) แล้วผูก SKU — เคส bind อัปเดตทุกส่วนที่ไม่ยกเลิก (production_order_item_id เดียวกัน) ไม่ได้ยิงกับใบที่มีส่วนย่อยจริง (B6a-B6b ครอบแม่ + done + cancelled เท่านั้น)
--    5. soft-remove รายการไม่มี SKU (R2 ข้อสุดท้าย) — ไม่ได้ทำ (ต้องแตะเส้นต้นทุน done/preview/view = หยุดตามบรีฟ) · job_worker_open_cancel (ก4) ไม่ได้ทำ — ไม่มีเทสต์เพราะไม่มีโค้ด
--    6. ชีตราคาสมาคม/ต้นทุนทอง (💰 ส่วนของ PM-A) ไม่ทดสอบซ้ำ — ใช้ SKU fixed ในวงจร Y เพื่อไม่ต้องมีราคาทองวันนี้ (verify-0186 ครอบ) · ที่นี่พิสูจน์เฉพาะว่า md5 ของ done เท่าเดิมและด่านใหม่อยู่ที่ trigger
--    7. ข้อความ U+2800 (Braille blank) กลางชื่อแบบ ผ่าน oem_note_valid ของ DB (พฤติกรรมเดิมของ helper กลาง) — ชั้น TS parseLabel/INVISIBLE_RE จับก่อนถึง DB (lib/jobs/input.test.ts) · ไม่แก้ helper กลางในงานนี้

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


-- ============================================================================
-- T. QR ร้าน (token): ปลอม/เพิกถอน/ออกใหม่/hash เท่านั้น/guard/ข้ามร้าน/สิทธิ์ anon-authenticated
-- ============================================================================
create function pg_temp.g_tok() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); b uuid := pg_temp.fx('B'); r jsonb; r2 jsonb; r3 jsonb; r4 jsonb;
  fake text := analytics.job_sha256_hex('fake-' || gen_random_uuid()::text);
  sM text := pg_temp.kv('sM'); sMB text := pg_temp.kv('sMB'); n int; s text; raw text; sig text;
  c_rpc constant text[] := array[
    'select analytics.shop_intake_resolve(null)', 'select analytics.worker_pin_verify_intake(null, null, null)', 'select analytics.job_product_search(null, null, null)',
    'select analytics.job_worker_open(null, null, null)', 'select analytics.shop_intake_token_issue(null)', 'select analytics.shop_intake_token_revoke(null)',
    'select analytics.shop_intake_token_status(null)', 'select analytics.production_order_acknowledge(null, null)', 'select analytics.production_order_item_bind_product(null, null, null)',
    'select analytics.production_order_item_label_set(null, null, null)', 'select analytics.worker_upsert(null)', 'select analytics.worker_pin_verify(null, null, null)',
    'select analytics.job_token_issue(null, null)', 'select analytics.job_create_from_production_item(null, null, null)'];
  c_internal constant text[] := array[
    'select analytics.shop_intake_auth(null, null, null, false, ''hub'')', 'select analytics.worker_pin_verify_core(null, null, null, null, null, null, false)',
    'select analytics.job_token_issue_core(null, null, null, null, null, null)', 'select analytics.production_order_close_gate()'];
begin
  -- T1 token ร้านปลอม (hash รูปแบบถูกแต่ไม่มีในตาราง) → ทุกทางตอบ invalid_token · ไม่มีอะไรเกิด
  begin
    s := pg_temp.shop_state(a);
    r := pg_temp.hub(null, fake); r2 := pg_temp.pin_in(pg_temp.fx('wM'), '2468', fake); r3 := pg_temp.srch(sM, 'x', fake);
    r4 := pg_temp.opn(sM, jsonb_build_object('product', pg_temp.fx('fixa')), fake);
    v := v || pg_temp.chk('T1a', 'token ร้านปลอม: hub/PIN/ค้น/เปิดใบ ตอบ invalid_token ทุกทาง (ด่าน shop_intake_auth)',
      r ->> 'code' = 'invalid_token' and r2 ->> 'code' = 'invalid_token' and r3 ->> 'code' = 'invalid_token' and r4 ->> 'code' = 'invalid_token');
    v := v || pg_temp.chk('T1b', 'token ร้านปลอม: ไม่มีรายชื่อช่าง/ข้อมูลใดๆ หลุด (ไม่มี key workers/state) · ไม่มี PO/ใบงาน/QR เกิด', not (r ? 'workers') and not (r ? 'state') and pg_temp.shop_state(a) = s);
    foreach sig in array array[null, '', 'abc', repeat('A', 64), repeat('a', 63), repeat('a', 65), repeat('g', 64)] loop
      if (pg_temp.q(format('select analytics.shop_intake_resolve(%L, null, null)', sig)) ->> 'code') is distinct from 'invalid_token' then raise exception 'T1c malformed % ผ่าน', sig; end if;
    end loop;
    v := v || pg_temp.chk('T1c', 'hash ผิดรูป (null · ว่าง · สั้น · ยาว · ตัวพิมพ์ใหญ่ · ไม่ใช่ hex) = invalid_token ทั้งหมด', true);
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('T1-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- T2/T3 เพิกถอน: ใช้ไม่ได้ทุกทาง · ข้อความเดียวกับ "ปลอม" (ไม่บอกว่า token เคยมีจริง)
  begin
    r := pg_temp.hub(null, fake);
    perform analytics.shop_intake_token_revoke(a, pg_temp.act());
    s := pg_temp.shop_state(a);
    r2 := pg_temp.hub(null); r3 := pg_temp.pin_in(pg_temp.fx('wM'), '2468'); r4 := pg_temp.opn(sM, jsonb_build_object('product', pg_temp.fx('fixa')));
    v := v || pg_temp.chk('T3a', 'QR ร้านถูกเพิกถอน: hub/PIN/เปิดใบ = invalid_token · ไม่มีใบเกิด (แม้ session ช่างยังไม่หมดอายุ)',
      r2 ->> 'code' = 'invalid_token' and r3 ->> 'code' = 'invalid_token' and r4 ->> 'code' = 'invalid_token' and pg_temp.shop_state(a) = s);
    v := v || pg_temp.chk('T3b', 'ข้อความ "เพิกถอน" = ข้อความ "ปลอม" เป๊ะ (ผู้สแกนแยกไม่ออกว่าเคยมีจริงไหม)', r2 ->> 'message' = r ->> 'message' and r2 ->> 'code' = r ->> 'code');
    r := analytics.shop_intake_token_status(a);
    v := v || pg_temp.chk('T3c', 'status หลังเพิกถอน: active=false', r ->> 'active' = 'false');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('T3-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- T4 ออกใหม่ = เพิกถอนตัวเก่าในตัว · active ได้ 1 ใบ · ค่าดิบคืนครั้งเดียว (DB เก็บ hash)
  begin
    r := analytics.shop_intake_token_issue(a, pg_temp.act());
    raw := r ->> 'token';
    v := v || pg_temp.chk('T4a', 'ออกใหม่: คืน token ดิบ 43 ตัว base64url · revoked_previous = 1', raw ~ '^[A-Za-z0-9_-]{43}$' and (r ->> 'revoked_previous')::int = 1);
    v := v || pg_temp.chk('T4b', 'QR เก่า (ก่อนออกใหม่) ใช้ไม่ได้ · QR ใหม่ใช้ได้', pg_temp.hub(null) ->> 'code' = 'invalid_token' and pg_temp.hub(null, analytics.job_sha256_hex(raw)) ->> 'state' = 'identify');
    select count(*) into n from analytics.shop_intake_token where shop_id = a and revoked_at is null;
    v := v || pg_temp.chk('T4c', 'active ต่อร้าน = 1 ใบ', n = 1);
    v := v || pg_temp.chk('T4d', 'INSERT ตรง token active ใบที่ 2 ของร้านเดียว → ชน partial unique (23505)',
      pg_temp.err(format('insert into analytics.shop_intake_token (shop_id, token_hash, issued_by) values (%L, %L, %L)', a, repeat('b', 64), pg_temp.act())) like '23505%');
    select count(*) into n from analytics.shop_intake_token where token_hash = raw;
    v := v || pg_temp.chk('T4e', 'DB ไม่มีค่าดิบของ token (ตาราง hash เท่านั้น) · มี hash ตรงของค่าดิบ 1 แถว', n = 0 and (select count(*) from analytics.shop_intake_token where token_hash = analytics.job_sha256_hex(raw)) = 1);
    v := v || pg_temp.chk('T4f', 'ผลของ status ไม่มี token/hash', not (analytics.shop_intake_token_status(a) ? 'token') and pg_temp.badkeys(analytics.shop_intake_token_status(a)) = '');
    v := v || pg_temp.chk('T4g', 'service_role อ่านคอลัมน์ token_hash ไม่ได้ (ไม่ grant · 42501)', pg_temp.asrole('service_role', 'select token_hash from analytics.shop_intake_token limit 1') = '42501');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('T4-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- T5 guard ของตาราง token ร้าน: แก้ได้เฉพาะเพิกถอน
  begin
    v := v || pg_temp.chk('T5a', 'UPDATE token_hash ตรง → ปฏิเสธ', pg_temp.err(format('update analytics.shop_intake_token set token_hash = %L where shop_id = %L and revoked_at is null', repeat('c', 64), a)) like '22023%');
    v := v || pg_temp.chk('T5b', 'DELETE ตรง → ปฏิเสธ', pg_temp.err(format('delete from analytics.shop_intake_token where shop_id = %L', a)) like '22023%');
    v := v || pg_temp.chk('T5c', 'TRUNCATE → ปฏิเสธ', pg_temp.err('truncate analytics.shop_intake_token') <> 'OK');
    perform analytics.shop_intake_token_revoke(a, pg_temp.act());
    v := v || pg_temp.chk('T5d', 'ฟื้น token ที่เพิกถอนแล้ว (revoked_at = null) → ปฏิเสธ', pg_temp.err(format('update analytics.shop_intake_token set revoked_at = null, revoke_reason = null where shop_id = %L', a)) like '22023%');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('T5-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- T6 ข้ามร้าน: session ของร้าน A ใช้กับ QR ร้าน B ไม่ได้ (และกลับกัน) · QR ร้าน B ไม่เห็นช่างร้าน A
  begin
    r := pg_temp.opn(sM, jsonb_build_object('label', 'ข้ามร้าน', 'metal', 'silver'), pg_temp.kv('tokh_b'));
    v := v || pg_temp.chk('T6a', 'session ช่างร้าน A + QR ร้าน B → เปิดใบไม่ได้ (session_required) · ไม่มีใบเกิดที่ร้านไหน', r ->> 'code' = 'session_required' and pg_temp.n_po(a) = 1 and pg_temp.n_po(b) = 0);
    r := pg_temp.hub(sM, pg_temp.kv('tokh_b'));
    v := v || pg_temp.chk('T6b', 'hub ร้าน B + session ร้าน A → state identify (ไม่ ready) · รายชื่อมีเฉพาะช่างร้าน B', r ->> 'state' = 'identify' and jsonb_array_length(r -> 'workers') = 1 and (r -> 'workers' -> 0 ->> 'id')::uuid = pg_temp.fx('wMB'));
    r := pg_temp.opn(sMB, jsonb_build_object('label', 'ข้ามร้าน', 'metal', 'silver'));
    v := v || pg_temp.chk('T6c', 'session ร้าน B + QR ร้าน A → session_required', r ->> 'code' = 'session_required');
    r := pg_temp.pin_in(pg_temp.fx('wMB'), '3690');
    v := v || pg_temp.chk('T6d', 'ช่างร้าน B ใส่ PIN ถูกที่ QR ร้าน A → bad_credentials (ไม่ออก session ข้ามร้าน)', r ->> 'code' = 'bad_credentials');
    r := pg_temp.srch(sM, 'ZZ187-BSKU');
    v := v || pg_temp.chk('T6e', 'ค้นสินค้าที่ QR ร้าน A ไม่เจอ SKU ของร้าน B', jsonb_array_length(r -> 'items') = 0);
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('T6-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- T7 กำแพงสิทธิ์: anon/authenticated/public เรียก RPC ใหม่/ที่แก้ไม่ได้ · service_role เรียก core ภายในไม่ได้ · จำลองวันที่กำแพงชั้นนอกหลุด (ข้อ 18.5)
  begin
    s := '';
    for sig in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname in
        ('shop_intake_resolve', 'worker_pin_verify_intake', 'job_product_search', 'job_worker_open', 'shop_intake_token_issue', 'shop_intake_token_revoke', 'shop_intake_token_status',
         'production_order_acknowledge', 'production_order_item_bind_product', 'production_order_item_label_set', 'worker_upsert', 'worker_pin_verify', 'job_token_issue',
         'job_create_from_production_item', 'shop_intake_auth', 'worker_pin_verify_core', 'job_token_issue_core', 'job_create_from_production_item_core', 'job_create_insert', 'production_order_close_gate', 'shop_intake_token_guard')
    loop
      if has_function_privilege('anon', sig, 'execute') or has_function_privilege('authenticated', sig, 'execute') or has_function_privilege('public'::name, sig, 'execute') is true then s := s || sig || ' '; end if;
    end loop;
    v := v || pg_temp.chk('T7a', 'has_function_privilege: anon/authenticated ไม่มี execute ทุกตัว · หลุด: ' || coalesce(nullif(s, ''), 'ไม่มี'), s = '');
    s := '';
    for sig in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname in
        ('shop_intake_auth', 'worker_pin_verify_core', 'job_token_issue_core', 'job_create_from_production_item_core', 'job_create_insert', 'production_order_close_gate', 'shop_intake_token_guard')
    loop
      if has_function_privilege('service_role', sig, 'execute') then s := s || sig || ' '; end if;
    end loop;
    v := v || pg_temp.chk('T7b', 'core/helper/trigger (shop_intake_auth · *_core · job_create_insert · close_gate) service_role เรียกตรงไม่ได้ (owner เท่านั้น) · หลุด: ' || coalesce(nullif(s, ''), 'ไม่มี'), s = '');
    execute 'grant usage on schema analytics to authenticated';
    execute 'grant usage on schema analytics to anon';
    s := '';
    foreach sig in array c_rpc loop
      if pg_temp.asrole('authenticated', sig) <> '42501' or pg_temp.asrole('anon', sig) <> '42501' then s := s || sig || ' '; end if;
    end loop;
    v := v || pg_temp.chk('T7c', 'จำลองกำแพง schema หลุด (grant usage ให้ authenticated/anon): ยิงทุก RPC → 42501 ก่อนเข้า body · หลุด: ' || coalesce(nullif(s, ''), 'ไม่มี'), s = '');
    s := '';
    foreach sig in array c_internal loop
      if pg_temp.asrole('service_role', sig) <> '42501' then s := s || sig || ' '; end if;
    end loop;
    v := v || pg_temp.chk('T7d', 'service_role ยิง core ภายใน/trigger function ตรง → 42501 · หลุด: ' || coalesce(nullif(s, ''), 'ไม่มี'), s = '');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('T7-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  return v;
end;
$c$;

-- ============================================================================
-- P. PIN ทางร้าน: นโยบายล็อกเดียวกับ QR ใบงาน (บันไดผิด 5/10/15) · can_open_job · ไม่มีงบผิด/วัน/token · rate limit · ทางเดิมไม่เปลี่ยน
-- ============================================================================
create function pg_temp.g_pin() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); b uuid := pg_temp.fx('B'); w uuid; r jsonb; r2 jsonb; i int; n int; s1 text; s2 text; s text; idx int;
  tokh text := pg_temp.kv('tokh_a'); jobh text := pg_temp.kv('jobtokh_a'); day_ts timestamptz;
begin
  -- P1 ถูก → session · ใช้ที่ hub ได้
  begin
    r := pg_temp.pin_in(pg_temp.fx('wM'), '2468');
    v := v || pg_temp.chk('P1a', 'ผู้จัดการใส่ PIN ถูกที่ QR ร้าน → ok + session_token + ชื่อ', r ->> 'ok' = 'true' and (r ->> 'session_token') ~ '^[A-Za-z0-9_-]{43}$' and r -> 'worker' ->> 'display_name' = 'ZZ-M ผู้จัดการ');
    r2 := pg_temp.hub(r ->> 'session_hash');
    v := v || pg_temp.chk('P1b', 'session ที่ได้ใช้ที่ hub: state=ready · open_allowed=true', r2 ->> 'state' = 'ready' and r2 ->> 'open_allowed' = 'true' and r2 -> 'worker' ->> 'display_name' = 'ZZ-M ผู้จัดการ');
    v := v || pg_temp.chk('P1c', 'ผล PIN/hub ไม่มี key เงิน/ต้นทุน/ลูกค้า', pg_temp.badkeys(r) = '' and pg_temp.badkeys(r2) = '');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('P1-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- P2 ผิด: attempts_left นับถอยหลัง · ไม่มี token_budget_left (ไม่มีงบผิด/วัน/token ที่ QR ร้าน)
  begin
    r := pg_temp.pin_in(pg_temp.fx('wM'), '0000');
    v := v || pg_temp.chk('P2a', 'PIN ผิดครั้งแรก: bad_credentials · attempts_left=4 · attempts_until_office=14', r ->> 'code' = 'bad_credentials' and (r ->> 'attempts_left')::int = 4 and (r ->> 'attempts_until_office')::int = 14);
    v := v || pg_temp.chk('P2b', 'ไม่มี token_budget_left ในผลทางร้าน (ไม่ใช้งบผิด 20/วัน/token)', not (r ? 'token_budget_left'));
    select count(*) into n from analytics.worker_rate_limit where key like 'pf:%' and key = 'pf:' || left(tokh, 32);
    v := v || pg_temp.chk('P2c', 'ไม่มีแถวงบ pf: ของ QR ร้านในตารางจำกัดอัตรา · มีถัง sip: ของ QR ร้าน', n = 0 and exists (select 1 from analytics.worker_rate_limit where key = 'sip:' || left(tokh, 32)));
    r2 := pg_temp.pin_job(jobh, pg_temp.fx('wM2'), '0000');
    v := v || pg_temp.chk('P2d', 'ทาง QR ใบงานเดิม: ผิดครั้งแรกยังมี token_budget_left=19 · attempts_left=4 (พฤติกรรมเดิมไม่เปลี่ยน)', r2 ->> 'code' = 'bad_credentials' and (r2 ->> 'token_budget_left')::int = 19 and (r2 ->> 'attempts_left')::int = 4);
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('P2-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- P3 ช่างที่ไม่มี can_open_job / ปิดใช้ / ร้านอื่น / ไม่มีตัวตน = bad_credentials เหมือนใส่ผิด · ไม่นับครั้งผิด · ไม่ออก session
  begin
    s := '';
    for i in 1..6 loop r := pg_temp.pin_in(pg_temp.fx('wN'), '8642'); s := s || coalesce(r ->> 'code', 'ok') || ','; end loop;
    select failed_attempts into n from analytics.worker where id = pg_temp.fx('wN');
    v := v || pg_temp.chk('P3a', 'ช่างทั่วไป (ไม่มี can_open_job) ใส่ PIN ถูก 6 ครั้งที่ QR ร้าน → bad_credentials ทุกครั้ง · ไม่นับครั้งผิด (failed_attempts=0) · ไม่ล็อก', s = repeat('bad_credentials,', 6) and n = 0);
    v := v || pg_temp.chk('P3b', 'ไม่มี session เกิดให้ช่างทั่วไปจากทาง QR ร้าน (session เดียวคือที่ล็อกอินที่ QR ใบงานตอน setup)', (select count(*) from analytics.worker_session where worker_id = pg_temp.fx('wN')) = 1);
    r := pg_temp.pin_in(pg_temp.fx('wX'), '1111');
    v := v || pg_temp.chk('P3c', 'ผู้จัดการที่ถูกปิดใช้ ใส่ PIN ถูก → bad_credentials', r ->> 'code' = 'bad_credentials');
    r := pg_temp.pin_in(pg_temp.fx('wMB'), '3690');
    v := v || pg_temp.chk('P3d', 'ช่างร้านอื่น → bad_credentials', r ->> 'code' = 'bad_credentials');
    r := pg_temp.pin_in(gen_random_uuid(), '2468'); r2 := pg_temp.pin_in(null, '2468');
    v := v || pg_temp.chk('P3e', 'worker id สุ่ม/null → bad_credentials', r ->> 'code' = 'bad_credentials' and r2 ->> 'code' = 'bad_credentials');
    r := pg_temp.pin_in(pg_temp.fx('wM'), '24');   r2 := pg_temp.pin_in(pg_temp.fx('wM'), null);
    v := v || pg_temp.chk('P3f', 'PIN ผิดรูป/null ไม่ผ่าน (bad_credentials) · ไม่เพิ่มตัวนับ', r ->> 'code' = 'bad_credentials' and r2 ->> 'code' = 'bad_credentials' and (select failed_attempts from analytics.worker where id = pg_temp.fx('wM')) = 0);
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('P3-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- P4 บันไดล็อกเดียวสองทาง: ผิด 5 = 15 นาที · 10 = 1 ชม. · 15 = ถาวร (ผู้จัดการที่ QR ร้าน vs ผู้จัดการอีกคนที่ QR ใบงาน — ลำดับผลต้องเท่ากันเป๊ะ)
  begin
    s1 := ''; s2 := '';
    for i in 1..15 loop
      r := pg_temp.pin_in(pg_temp.fx('wM'), '0000');
      r2 := pg_temp.pin_job(jobh, pg_temp.fx('wM2'), '0000');
      s1 := s1 || (r ->> 'code') || coalesce(':' || (r ->> 'retry_after_seconds'), '') || coalesce('/' || (r ->> 'attempts_left'), '') || ' ';
      s2 := s2 || (r2 ->> 'code') || coalesce(':' || (r2 ->> 'retry_after_seconds'), '') || coalesce('/' || (r2 ->> 'attempts_left'), '') || ' ';
      -- จำลองเวลาผ่านไปหลังล็อกชั่วคราว (fixture: UPDATE ตรง — ยกเว้นที่บอกตรงๆ) เพื่อไต่ต่อถึงครั้งที่ 10/15 ในทรานแซกชันเดียว (now() คงที่)
      -- (ตั้งแต่ครั้งที่ 5 ทุกครั้งที่ผิดจะล็อกใหม่ — ปลดทุกครั้งยกเว้นหลังครั้งที่ 15 ที่ต้องคงล็อกถาวรไว้ตรวจ)
      if i >= 5 and i < 15 then update analytics.worker set locked_until = null where id in (pg_temp.fx('wM'), pg_temp.fx('wM2')); end if;
    end loop;
    v := v || pg_temp.chk('P4a', 'ลำดับผล 15 ครั้งผิด: ทาง QR ร้าน = ทาง QR ใบงาน (code/retry/attempts_left) — นโยบายล็อกเดียว (core ร่วม): ' || s1, s1 = s2);
    v := v || pg_temp.chk('P4b', 'ครั้งที่ 5 = locked 900 วิ · ครั้งที่ 10 = locked 3600 วิ · ครั้งที่ 15 = locked_office',
      s1 like '%locked:900%' and s1 like '%locked:3600%' and split_part(s1, ' ', 15) = 'locked_office' and split_part(s1, ' ', 5) = 'locked:900' and split_part(s1, ' ', 10) = 'locked:3600');
    r := pg_temp.pin_in(pg_temp.fx('wM'), '2468');
    v := v || pg_temp.chk('P4c', 'ล็อกถาวรแล้ว ใส่ PIN ถูกก็ยังเข้าไม่ได้ (locked_office) · ไม่มี session ใหม่', r ->> 'code' = 'locked_office' and not (r ? 'session_token'));
    perform analytics.worker_unlock(a, pg_temp.fx('wM'), pg_temp.act());
    r := pg_temp.pin_in(pg_temp.fx('wM'), '2468');
    v := v || pg_temp.chk('P4d', 'worker_unlock (ออฟฟิศ) แล้วเข้าได้ — ปลดล็อกเดิมใช้กับทางร้านด้วย', r ->> 'ok' = 'true');
    select count(*) into n from analytics.worker_rate_limit where key = 'pf:' || left(tokh, 32);
    v := v || pg_temp.chk('P4e', 'ผิด 15 ครั้งที่ QR ร้าน ไม่ทำให้ token ร้านติดงบ pf: (งบ 20/วัน เป็นของ QR ใบงานเท่านั้น) · QR ใบงานมีแถวงบ pf: 1 แถว',
      n = 0 and (select count(*) from analytics.worker_rate_limit where key = 'pf:' || left(jobh, 32)) = 1);
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('P4-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- P5 ทางเดิม /w/<token>: งบผิด/วัน/token ยังทำงาน (เต็มแล้วใส่ถูกก็เข้าไม่ได้) · ล็อกต่อช่างยังตรงเดิม
  begin
    day_ts := date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';
    insert into analytics.worker_rate_limit (key, window_start, hits) values ('pf:' || left(jobh, 32), day_ts, 20)
      on conflict (key, window_start) do update set hits = 20;   -- fixture: จำลองใช้งบครบ 20 (UPDATE/INSERT ตรง — ยกเว้นที่บอกตรงๆ)
    r := pg_temp.pin_job(jobh, pg_temp.fx('wM2'), '1357');
    v := v || pg_temp.chk('P5a', 'QR ใบงาน: งบผิดเต็ม 20 → token_budget_exhausted แม้ใส่ PIN ถูก (ทางเดิมไม่เปลี่ยน)', r ->> 'code' = 'token_budget_exhausted');
    r := pg_temp.pin_in(pg_temp.fx('wM2'), '1357');
    v := v || pg_temp.chk('P5b', 'แต่ QR ร้าน ไม่ติดงบนี้ — ช่างคนเดียวกันเข้าทางร้านได้ตามปกติ', r ->> 'ok' = 'true');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('P5-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- P6 rate limit: sip: ต่อ token (60/10 นาที) · ipp: ต่อ IP (100/10 นาที ใช้ถังเดียวกับ QR ใบงาน)
  begin
    idx := 0;
    for i in 1..75 loop
      r := pg_temp.pin_in(gen_random_uuid(), '2468');
      if r ->> 'code' = 'rate_limited' then idx := i; exit; end if;
    end loop;
    -- setup ใช้ถัง sip: ไปแล้ว 2 ครั้ง (M, M2) ในหน้าต่างเดียวกัน ⇒ ครั้งที่ 59 โดน
    v := v || pg_temp.chk('P6a', 'PIN ต่อ token เกิน 60/10 นาที → rate_limited (โดนที่ครั้งที่ ' || idx || ' · คาด 59 เพราะ setup ใช้ไป 2)', idx = 59);
    idx := 0;
    for i in 1..110 loop
      r := pg_temp.pin_in(gen_random_uuid(), '2468', analytics.job_sha256_hex('fake-p6'), analytics.job_sha256_hex('ip-v187'));
      if r ->> 'code' = 'rate_limited' then idx := i; exit; end if;
    end loop;
    v := v || pg_temp.chk('P6b', 'PIN ต่อ IP เกิน 100/10 นาที → rate_limited ที่ครั้งที่ ' || idx || ' (คาด 101) · ด่าน IP มาก่อนเช็ค token (ไม่ต้องมี token จริง)', idx = 101);
    r := pg_temp.pin_in(pg_temp.fx('wM'), '2468', null, analytics.job_sha256_hex('ip-v187'));
    v := v || pg_temp.chk('P6c', 'ถัง ipp: เป็นถังเดียวกับทาง QR ใบงาน: IP เดิมที่เกินแล้ว ยิงทาง worker_pin_verify (QR ใบงาน) ก็ rate_limited', pg_temp.pin_job(jobh, pg_temp.fx('wM2'), '1357', analytics.job_sha256_hex('ip-v187')) ->> 'code' = 'rate_limited');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('P6-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- P7 session ใช้ร่วมสองทาง: ล็อกอินที่ QR ร้านแล้วสแกนใบงานได้ · ล็อกอินที่ QR ใบงานแล้วใช้ที่ hub ได้
  begin
    r := pg_temp.pin_in(pg_temp.fx('wM'), '2468');
    r2 := pg_temp.q(format('select analytics.job_worker_resolve(%L, %L, null)', jobh, r ->> 'session_hash'));
    v := v || pg_temp.chk('P7a', 'session จาก hub ใช้กับ job_worker_resolve (QR ใบงาน) ได้: ระบุตัวช่างแล้ว (มี viewer · ไม่ใช่ identify)', (r2 ? 'viewer') and r2 ->> 'next_action' is distinct from 'identify');
    r := pg_temp.pin_job(jobh, pg_temp.fx('wM'), '2468');
    r2 := pg_temp.hub(r ->> 'session_hash');
    v := v || pg_temp.chk('P7b', 'session จาก QR ใบงานใช้ที่ hub ได้ (ready + open_allowed)', r2 ->> 'state' = 'ready' and r2 ->> 'open_allowed' = 'true');
    r2 := pg_temp.opn(r ->> 'session_hash', jsonb_build_object('label', 'เปิดด้วย session จากใบงาน', 'metal', 'silver'));
    v := v || pg_temp.chk('P7c', 'เปิดใบด้วย session ที่ได้จาก QR ใบงานได้ (ผู้จัดการที่ล็อกอินทางใดก็ได้)', r2 ->> 'ok' = 'true');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('P7-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  return v;
end;
$c$;

-- ============================================================================
-- H. hub (shop_intake_resolve)
-- ============================================================================
create function pg_temp.g_hub() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); r jsonb; r2 jsonb; i int; idx int; s text; n int;
  sM text := pg_temp.kv('sM'); sN text := pg_temp.kv('sN');
begin
  -- H1 ไม่มี session: รายชื่อ = เฉพาะช่าง active ที่ can_open_job ของร้านนี้ (มติ Q8) · id + ชื่อเท่านั้น
  begin
    r := pg_temp.hub(null);
    select string_agg(x ->> 'display_name', ',' order by (x ->> 'display_name') collate "C") into s from jsonb_array_elements(r -> 'workers') x;
    v := v || pg_temp.chk('H1a', 'ไม่มี session: state=identify · รายชื่อ = ZZ-M, ZZ-M2 เท่านั้น (ไม่มีช่างทั่วไป · ไม่มีคนปิดใช้ · ไม่มีช่างร้านอื่น) — ได้: ' || coalesce(s, 'null'),
      r ->> 'state' = 'identify' and s = 'ZZ-M ผู้จัดการ,ZZ-M2 ผู้จัดการสอง');
    select string_agg(distinct k, ',' order by k) into s from jsonb_array_elements(r -> 'workers') x, jsonb_object_keys(x) k;
    v := v || pg_temp.chk('H1b', 'แต่ละคนมี key เฉพาะ id + display_name (ไม่มีขั้นที่ทำ/สิทธิ์/PIN/สถานะล็อก)', s = 'display_name,id' and pg_temp.badkeys(r) = '');
    v := v || pg_temp.chk('H1c', 'profile_ready + gold_profile_ready = true (ร้านทดสอบ seed แบบการบันทึกแล้ว)', (r ->> 'profile_ready')::boolean and (r ->> 'gold_profile_ready')::boolean);
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('H1-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- H2 session: ผู้จัดการ = open_allowed · ช่างทั่วไป (session จาก QR ใบงาน) = ready แต่ open_allowed=false
  begin
    r := pg_temp.hub(sM); r2 := pg_temp.hub(sN);
    v := v || pg_temp.chk('H2a', 'ผู้จัดการมี session → ready + open_allowed=true · ไม่มีรายชื่อช่างในผล (ไม่เปิดเผยซ้ำ)', r ->> 'state' = 'ready' and r ->> 'open_allowed' = 'true' and not (r ? 'workers'));
    v := v || pg_temp.chk('H2b', 'ช่างทั่วไป (session จาก QR ใบงาน) ที่ hub → ready แต่ open_allowed=false', r2 ->> 'state' = 'ready' and r2 ->> 'open_allowed' = 'false');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('H2-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- H3 profile_ready/gold_profile_ready ตามสถานะจริง
  begin
    update analytics.job_record_profile set is_default_gold = false where shop_id = a and is_default_gold;   -- fixture: ปิดแบบทองค่าเริ่ม (UPDATE ตรง — ยกเว้นที่บอกตรงๆ)
    r := pg_temp.hub(null);
    v := v || pg_temp.chk('H3a', 'ไม่มีแบบทองค่าเริ่ม: gold_profile_ready=false · profile_ready ยัง true', (r ->> 'profile_ready')::boolean and not (r ->> 'gold_profile_ready')::boolean);
    update analytics.job_record_profile set is_default = false where shop_id = a and is_default;
    r := pg_temp.hub(null);
    v := v || pg_temp.chk('H3b', 'ไม่มีแบบค่าเริ่มเลย: ทั้งสองเป็น false', not (r ->> 'profile_ready')::boolean and not (r ->> 'gold_profile_ready')::boolean);
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('H3-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- H4 session หมด/ถูกเพิกถอน/ช่างปิดใช้ → กลับไป identify (session_expired=true) และไม่มีชื่อผู้นั้นในรายชื่อเมื่อถูกปิดใช้
  begin
    perform analytics.job_worker_logout(sM);
    r := pg_temp.hub(sM);
    v := v || pg_temp.chk('H4a', 'session ถูกเพิกถอน (logout): hub → identify + session_expired=true', r ->> 'state' = 'identify' and (r ->> 'session_expired')::boolean);
    r2 := pg_temp.opn(sM, jsonb_build_object('label', 'x', 'metal', 'silver'));
    v := v || pg_temp.chk('H4b', 'session ที่ถูกเพิกถอนเปิดใบไม่ได้ (session_required)', r2 ->> 'code' = 'session_required');
    perform analytics.worker_set_active(a, pg_temp.fx('wM2'), false, pg_temp.act());
    r := pg_temp.hub(pg_temp.kv('sM2'));
    v := v || pg_temp.chk('H4c', 'ช่างถูกปิดใช้ → session หลุดทันที: hub = identify · รายชื่อไม่มีคนนั้น', r ->> 'state' = 'identify' and not exists (select 1 from jsonb_array_elements(r -> 'workers') x where x ->> 'display_name' like 'ZZ-M2%'));
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('H4-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- H5 rate limit hub: siv: 120/10 นาที
  begin
    idx := 0;
    for i in 1..130 loop
      r := pg_temp.hub(null);
      if r ->> 'code' = 'rate_limited' then idx := i; exit; end if;
    end loop;
    v := v || pg_temp.chk('H5', 'hub เกิน 120/10 นาที ต่อ token → rate_limited (โดนที่ครั้งที่ ' || idx || ' · คาด 121)', idx = 121);
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('H5-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  return v;
end;
$c$;


-- ============================================================================
-- O. เปิดใบ (job_worker_open) + ค้นสินค้า
-- ============================================================================
create function pg_temp.jr(p_job_no text) returns jsonb language sql as $c$
  select to_jsonb(j) from analytics.job j where j.shop_id = pg_temp.fx('A') and j.job_no = p_job_no $c$;
create function pg_temp.por(p_po_no text) returns jsonb language sql as $c$
  select to_jsonb(p) from analytics.production_order p where p.shop_id = pg_temp.fx('A') and p.po_no = p_po_no $c$;
create function pg_temp.itr(p_po_no text) returns jsonb language sql as $c$
  select to_jsonb(i) from analytics.production_order_item i join analytics.production_order p on p.id = i.production_order_id where p.shop_id = pg_temp.fx('A') and p.po_no = p_po_no order by i.created_at limit 1 $c$;
create function pg_temp.today() returns date language sql as $c$ select analytics.job_today() $c$;

create function pg_temp.g_open() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); b uuid := pg_temp.fx('B'); s0 text; r jsonb; r2 jsonb; r3 jsonb; i int; n int; s text; x text;
  sM text := pg_temp.kv('sM'); sM2 text := pg_temp.kv('sM2'); sN text := pg_temp.kv('sN');
  fixa uuid := pg_temp.fx('fixa'); w uuid; j jsonb; it jsonb; po jsonb; tk text; k text; ok boolean;
  c_bad_label constant text[] := array[E'a\tb', E'a\nb', 'a' || chr(8238) || 'b', 'a' || chr(8203) || 'b', '<b>x</b>', 'x > y', '   ', '...', '👍', repeat('ก', 201)];
  c_bad_note constant text[] := array[E'x\ny', E'x\ty', 'a' || chr(8238) || 'b', 'a' || chr(8203) || 'b', repeat('ก', 501)];
  c_bad_purity constant text[] := array['0.37', '0.3749', '1.01', 'NaN', 'Infinity', '0.37501', '-0.5', '0'];
  c_bad_weight constant text[] := array['0', '-1', '10000.001', 'NaN', 'Infinity', '1.2345', '-0.001'];
begin
  -- O1 สิทธิ์: ช่างทั่วไป (can_open_job=false) เปิด/ค้นไม่ได้ · ออฟฟิศถอนสิทธิ์ผู้จัดการระหว่างที่ session ยังอยู่ = เปิดไม่ได้ทันที (ตรวจสดจาก DB) · คืนสิทธิ์ = เปิดได้
  begin
    s0 := pg_temp.shop_state(a);
    r := pg_temp.opn(sN, jsonb_build_object('product', fixa)); r2 := pg_temp.srch(sN, 'ZZ187');
    v := v || pg_temp.chk('O1a', 'can_open_job=false (ช่างทั่วไปที่มี session จริง): เปิดใบ = not_allowed · ค้นสินค้า = not_allowed · ไม่มีอะไรเกิด', r ->> 'code' = 'not_allowed' and r2 ->> 'code' = 'not_allowed' and pg_temp.shop_state(a) = s0);
    r := pg_temp.wu(a, 'ZZ-M ผู้จัดการ', null, pg_temp.fx('wM'), '{qc}', false, null);
    r2 := pg_temp.opn(sM, jsonb_build_object('product', fixa)); r3 := pg_temp.srch(sM, 'ZZ187');
    v := v || pg_temp.chk('O1b', 'ถอนสิทธิ์ผู้จัดการ (worker_upsert can_open_job=false) ขณะ session ยังไม่หมด: เปิด/ค้นไม่ได้ทันที', (r ->> 'can_open_job') = 'false' and r2 ->> 'code' = 'not_allowed' and r3 ->> 'code' = 'not_allowed' and pg_temp.shop_state(a) = s0);
    r := pg_temp.wu(a, 'ZZ-M ผู้จัดการ', null, pg_temp.fx('wM'), '{qc}', true, null);
    r2 := pg_temp.opn(sM, jsonb_build_object('product', fixa));
    v := v || pg_temp.chk('O1c', 'คืนสิทธิ์แล้วเปิดได้ (session เดิม)', r2 ->> 'ok' = 'true');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('O1-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- O2 session: ไม่มี/สุ่ม/เพิกถอน/หมดอายุ/ช่างปิดใช้ (แม้ session ยังไม่ถูกเพิกถอน) = session_required · ไม่มีอะไรเกิด
  begin
    s0 := pg_temp.shop_state(a);
    r := pg_temp.opn(null, jsonb_build_object('product', fixa));
    r2 := pg_temp.opn(analytics.job_sha256_hex('random-session'), jsonb_build_object('product', fixa));
    r3 := pg_temp.srch(null, 'x');
    v := v || pg_temp.chk('O2a', 'ไม่มี session / session สุ่ม → session_required ทั้งเปิดและค้น', r ->> 'code' = 'session_required' and r2 ->> 'code' = 'session_required' and r3 ->> 'code' = 'session_required' and pg_temp.shop_state(a) = s0);
    update analytics.worker_session set issued_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' where session_hash = sM;   -- fixture: จำลองหมดอายุ (UPDATE ตรง — ยกเว้นที่บอกตรงๆ)
    r := pg_temp.opn(sM, jsonb_build_object('product', fixa));
    v := v || pg_temp.chk('O2b', 'session หมดอายุ → session_required', r ->> 'code' = 'session_required' and pg_temp.shop_state(a) = s0);
    update analytics.worker set is_active = false where id = pg_temp.fx('wM2');   -- fixture: ปิดช่างโดยไม่เพิกถอน session (พิสูจน์ว่า DB เช็ค is_active สดเอง)
    r := pg_temp.opn(sM2, jsonb_build_object('product', fixa));
    v := v || pg_temp.chk('O2c', 'ช่างถูกปิดใช้ (session ยัง active ในตาราง) → session_required', r ->> 'code' = 'session_required' and pg_temp.shop_state(a) = s0);
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('O2-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- O3 SKU ที่เลือกไม่ได้: ร้านอื่น · ปิดใช้ · live* · ไม่มีจริง = sku_invalid (ข้อความเดียว) · ไม่มี PO เกิด
  begin
    s0 := pg_temp.shop_state(a); s := '';
    foreach k in array array['bsku', 'off', 'live'] loop
      r := pg_temp.opn(sM, jsonb_build_object('product', pg_temp.fx(k)));
      s := s || coalesce(r ->> 'code', 'ok') || ',';
    end loop;
    r := pg_temp.opn(sM, jsonb_build_object('product', gen_random_uuid()));
    v := v || pg_temp.chk('O3a', 'SKU ร้านอื่น/ปิดใช้/live*/ไม่มีจริง → sku_invalid ทุกกรณี · ไม่มี PO/ใบงาน/QR เกิด', s = 'sku_invalid,sku_invalid,sku_invalid,' and r ->> 'code' = 'sku_invalid' and pg_temp.shop_state(a) = s0);
    r := pg_temp.srch(sM, 'live187'); r2 := pg_temp.srch(sM, 'ZZ187-OFF');
    v := v || pg_temp.chk('O3b', 'ค้นสินค้าไม่เจอ SKU live* และ SKU ปิดใช้', jsonb_array_length(r -> 'items') = 0 and jsonb_array_length(r2 -> 'items') = 0);
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('O3-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- O4 จำนวน/กำหนดเสร็จ
  begin
    s0 := pg_temp.shop_state(a); s := '';
    foreach k in array array['0', '-1', '100001'] loop
      r := pg_temp.opn(sM, jsonb_build_object('product', fixa, 'qty', k));
      s := s || coalesce(r ->> 'code', 'ok') || ',';
    end loop;
    v := v || pg_temp.chk('O4a', 'จำนวนสั่ง ≤0 / >100000 → qty_invalid', s = 'qty_invalid,qty_invalid,qty_invalid,' and pg_temp.shop_state(a) = s0);
    r := pg_temp.opn(sM, jsonb_build_object('product', fixa, 'qty', 5, 'planned', 4)); r2 := pg_temp.opn(sM, jsonb_build_object('product', fixa, 'qty', 5, 'planned', 100001));
    v := v || pg_temp.chk('O4b', 'จำนวนเริ่มผลิต (เผื่อ) < จำนวนสั่ง หรือ > 100000 → qty_invalid', r ->> 'code' = 'qty_invalid' and r2 ->> 'code' = 'qty_invalid' and pg_temp.shop_state(a) = s0);
    r := pg_temp.opn(sM, jsonb_build_object('product', fixa, 'due', (pg_temp.today() - 1)::text)); r2 := pg_temp.opn(sM, jsonb_build_object('product', fixa, 'due', (pg_temp.today() + 731)::text));
    v := v || pg_temp.chk('O4c', 'กำหนดเสร็จย้อนหลัง (เมื่อวานตามวันไทย) / เกิน 2 ปี (วันนี้+731) → due_invalid', r ->> 'code' = 'due_invalid' and r2 ->> 'code' = 'due_invalid' and pg_temp.shop_state(a) = s0);
    r := pg_temp.opn(sM, jsonb_build_object('product', fixa, 'due', (pg_temp.today() + 730)::text));
    v := v || pg_temp.chk('O4d', 'ขอบ: วันนี้+730 ผ่าน (ต้องไม่พัง)', r ->> 'ok' = 'true' and (r ->> 'due_date')::date = pg_temp.today() + 730);
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('O4-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    r := pg_temp.opn(sM, jsonb_build_object('product', fixa, 'due', pg_temp.today()::text, 'qty', 1));
    v := v || pg_temp.chk('O4e', 'ขอบ: กำหนดเสร็จ = วันนี้ (ตามวันไทย) + จำนวน 1 ผ่าน', r ->> 'ok' = 'true' and (r ->> 'qty_order')::int = 1 and (r ->> 'due_date')::date = pg_temp.today());
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('O4e-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- O5 ชื่อแบบ/หมายเหตุ: control · bidi · ล่องหน · < > · ว่าง · ไม่มีตัวอักษรจริง · ยาวเกิน
  begin
    s0 := pg_temp.shop_state(a); s := '';
    foreach x in array c_bad_label loop
      r := pg_temp.opn(sM, jsonb_build_object('label', x, 'metal', 'silver'));
      if r ->> 'code' is distinct from 'name_invalid' then s := s || '[' || left(replace(x, E'\n', '\n'), 12) || ':' || coalesce(r ->> 'code', 'ok') || '] '; end if;
    end loop;
    v := v || pg_temp.chk('O5a', 'ชื่อแบบ (control · tab · ขึ้นบรรทัด · bidi · ล่องหน · < > · ว่าง · "..." · อีโมจิล้วน · ยาว 201) → name_invalid ทุกข้อ · หลุด: ' || coalesce(nullif(s, ''), 'ไม่มี') || ' · ไม่มีอะไรเกิด', s = '' and pg_temp.shop_state(a) = s0);
    s := '';
    foreach x in array c_bad_note loop
      r := pg_temp.opn(sM, jsonb_build_object('label', 'แหวนทดสอบหมายเหตุ', 'metal', 'silver', 'note', x));
      if r ->> 'code' is distinct from 'note_invalid' then s := s || '[' || left(replace(x, E'\n', '\n'), 12) || ':' || coalesce(r ->> 'code', 'ok') || '] '; end if;
    end loop;
    v := v || pg_temp.chk('O5b', 'หมายเหตุ (ขึ้นบรรทัด · tab · bidi · ล่องหน · ยาว 501) → note_invalid · หลุด: ' || coalesce(nullif(s, ''), 'ไม่มี') || ' · ไม่มีอะไรเกิด', s = '' and pg_temp.shop_state(a) = s0);
    r := pg_temp.opn(sM, jsonb_build_object('label', '  แหวน   ลาย  ใบไม้  ', 'metal', 'silver'));
    v := v || pg_temp.chk('O5c', 'ต้องไม่พัง: ชื่อไทยปกติ (ช่องว่างหัวท้าย/ซ้อนถูกยุบเป็นช่องเดียว) ผ่าน → "แหวน ลาย ใบไม้"', r ->> 'ok' = 'true' and r ->> 'design_label' = 'แหวน ลาย ใบไม้');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('O5-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- O6 โลหะ/เนื้อ/น้ำหนัก (สินค้าใหม่ไม่มี SKU + SKU ที่ override)
  begin
    s0 := pg_temp.shop_state(a);
    r := pg_temp.opn(sM, jsonb_build_object('label', 'ทองไม่มีเนื้อ', 'metal', 'gold'));
    v := v || pg_temp.chk('O6a', 'ทองไม่ใส่เนื้อ (สินค้าใหม่) → gold_purity_required · ไม่มีอะไรเกิด', r ->> 'code' = 'gold_purity_required' and pg_temp.shop_state(a) = s0);
    s := '';
    foreach x in array c_bad_purity loop
      r := pg_temp.opn(sM, jsonb_build_object('label', 'เนื้อผิด', 'metal', 'gold', 'purity', x));
      if r ->> 'code' is distinct from 'purity_invalid' then s := s || '[' || x || ':' || coalesce(r ->> 'code', 'ok') || '] '; end if;
    end loop;
    v := v || pg_temp.chk('O6b', 'เนื้อทอง <37.50% · >100% · NaN · Infinity · ทศนิยมเกิน 4 · ลบ · 0 → purity_invalid · หลุด: ' || coalesce(nullif(s, ''), 'ไม่มี') || ' · ไม่มีอะไรเกิด', s = '' and pg_temp.shop_state(a) = s0);
    r := pg_temp.opn(sM, jsonb_build_object('label', 'โลหะแปลก', 'metal', 'platinum')); r2 := pg_temp.opn(sM, jsonb_build_object('label', 'ไม่เลือกโลหะ'));
    v := v || pg_temp.chk('O6c', 'โลหะนอกชุด → metal_invalid · สินค้าใหม่ไม่เลือกโลหะ → metal_required', r ->> 'code' = 'metal_invalid' and r2 ->> 'code' = 'metal_required' and pg_temp.shop_state(a) = s0);
    s := '';
    foreach x in array c_bad_weight loop
      r := pg_temp.opn(sM, jsonb_build_object('label', 'น้ำหนักผิด', 'metal', 'silver', 'weight', x));
      if r ->> 'code' is distinct from 'weight_invalid' then s := s || '[' || x || ':' || coalesce(r ->> 'code', 'ok') || '] '; end if;
    end loop;
    v := v || pg_temp.chk('O6d', 'น้ำหนัก ≤0 · >10000 · NaN · Infinity · ทศนิยมเกิน 3 · ลบ → weight_invalid · หลุด: ' || coalesce(nullif(s, ''), 'ไม่มี') || ' · ไม่มีอะไรเกิด', s = '' and pg_temp.shop_state(a) = s0);
    -- ด่านที่ตกหลังสร้างใบผลิตไปแล้ว (item_set/core) ต้องถอยทั้งก้อน: ตัวนับทั้งสอง + PO/รายการ/ใบงาน/QR/event ไม่ขยับ
    r := pg_temp.opn(sM, jsonb_build_object('label', 'ทองเหลืองเนื้อผิด', 'metal', 'brass', 'purity', 0.9));
    r2 := pg_temp.opn(sM, jsonb_build_object('product', fixa, 'metal', 'gold'));
    v := v || pg_temp.chk('O6e', 'ถอยทั้งก้อน: ทองเหลืองส่งเนื้อ ≠ 100 (ตกหลังสร้าง PO แล้ว) + SKU override เป็นทองไม่มีเนื้อ → ปฏิเสธ · ตัวนับใบผลิต/ใบงาน PO/รายการ/ใบงาน/QR/event ไม่ขยับเลย (' || pg_temp.shop_state(a) || ' = ' || s0 || ')',
      r ->> 'code' = 'purity_invalid' and r2 ->> 'code' = 'gold_purity_required' and pg_temp.shop_state(a) = s0);
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('O6-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- O7 SKU มีใบงานเปิดอยู่แล้ว = บล็อก (job_exists + เลขใบ) · ใบเดิมยกเลิกแล้วเปิดใหม่ได้ · ใบที่ออฟฟิศเปิดไว้ก็นับ
  begin
    r := pg_temp.opn(sM, jsonb_build_object('product', fixa));
    s0 := pg_temp.shop_state(a);
    r2 := pg_temp.opn(sM, jsonb_build_object('product', fixa));
    v := v || pg_temp.chk('O7a', 'SKU เดียวกันมีใบงานเปิดอยู่ → job_exists + เลขใบเดิม · ถอยทั้งก้อน (ไม่เหลือ PO เปล่า · ตัวนับไม่ขยับ)', r ->> 'ok' = 'true' and r2 ->> 'code' = 'job_exists' and r2 ->> 'job_no' = r ->> 'job_no' and pg_temp.shop_state(a) = s0);
    r3 := pg_temp.opn(sM2, jsonb_build_object('product', fixa));
    v := v || pg_temp.chk('O7b', 'ผู้จัดการอีกคนเปิด SKU เดียวกัน → job_exists เช่นกัน', r3 ->> 'code' = 'job_exists');
    perform analytics.job_cancel(a, (pg_temp.jr(r ->> 'job_no') ->> 'id')::uuid, 'verify ยกเลิกเพื่อเปิดใหม่', pg_temp.act());
    r3 := pg_temp.opn(sM, jsonb_build_object('product', fixa));
    v := v || pg_temp.chk('O7c', 'ต้องไม่พัง: ใบเดิมยกเลิกแล้ว → เปิด SKU เดียวกันใหม่ได้', r3 ->> 'ok' = 'true' and r3 ->> 'job_no' <> r ->> 'job_no');
    j := pg_temp.office_job(a, pg_temp.fx('fixb'));
    r3 := pg_temp.opn(sM, jsonb_build_object('product', pg_temp.fx('fixb')));
    v := v || pg_temp.chk('O7d', 'SKU ที่ออฟฟิศเปิดใบงานไว้แล้ว (ใบ ' || (j ->> 'job_no') || ') ผู้จัดการเปิดซ้ำไม่ได้ → job_exists', r3 ->> 'code' = 'job_exists' and r3 ->> 'job_no' = j ->> 'job_no');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('O7-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- O8 แบบการบันทึก: ทองไม่มีแบบทอง → no_gold_profile (ไม่ fallback แบบเงิน) · ไม่มีแบบค่าเริ่มเลย → no_default_profile · ถอยทั้งก้อน
  begin
    s0 := pg_temp.shop_state(a);
    update analytics.job_record_profile set is_default_gold = false where shop_id = a and is_default_gold;   -- fixture (UPDATE ตรง — ยกเว้นที่บอกตรงๆ)
    r := pg_temp.opn(sM, jsonb_build_object('label', 'ทองไม่มีแบบทอง', 'metal', 'gold', 'purity', 0.75));
    v := v || pg_temp.chk('O8a', 'ทองแต่ไม่มีแบบทองค่าเริ่ม → no_gold_profile · ถอยทั้งก้อน (PO เกิดแล้วตกที่ job_create_insert → ไม่เหลือ · ตัวนับไม่ขยับ)', r ->> 'code' = 'no_gold_profile' and pg_temp.shop_state(a) = s0);
    r := pg_temp.opn(sM, jsonb_build_object('label', 'เงินยังเปิดได้', 'metal', 'silver'));
    v := v || pg_temp.chk('O8b', 'ต้องไม่พัง: ใบเงินยังได้แบบ default เมื่อไม่มีแบบทอง', r ->> 'ok' = 'true');
    update analytics.job_record_profile set is_default = false where shop_id = a and is_default;
    s0 := pg_temp.shop_state(a);
    r := pg_temp.opn(sM, jsonb_build_object('label', 'ไม่มีแบบเลย', 'metal', 'silver'));
    v := v || pg_temp.chk('O8c', 'ไม่มีแบบค่าเริ่มเลย → no_default_profile · ถอยทั้งก้อน', r ->> 'code' = 'no_default_profile' and pg_temp.shop_state(a) = s0);
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('O8-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- O9 idem: กดซ้ำ = ใบเดียว ไม่ออก token ใหม่ · key ของช่างอื่น = ปฏิเสธ · รูปแบบ key
  begin
    k := pg_temp.ik();
    r := pg_temp.opn(sM, jsonb_build_object('idem', k, 'label', 'กดซ้ำ', 'metal', 'silver'));
    s0 := pg_temp.shop_state(a);
    r2 := pg_temp.opn(sM, jsonb_build_object('idem', k, 'label', 'กดซ้ำ', 'metal', 'silver'));
    v := v || pg_temp.chk('O9a', 'key เดิมจากช่างเดิม → already=true · เลขใบ/เลขใบผลิตเดิม · ไม่มี token ในผล (ไม่ออก QR ซ้ำ) · PO/ใบงาน/QR/event/ตัวนับไม่ขยับ',
      r ->> 'already' = 'false' and r2 ->> 'ok' = 'true' and r2 ->> 'already' = 'true' and r2 ->> 'job_no' = r ->> 'job_no' and r2 ->> 'order_no' = r ->> 'order_no' and not (r2 ? 'token') and pg_temp.shop_state(a) = s0);
    select count(*) into n from analytics.production_order where shop_id = a and intake_idem_key = k;
    v := v || pg_temp.chk('O9b', 'ใบผลิตที่ถือ key นี้มีใบเดียว · QR ใบงาน active ของใบนี้ = 1', n = 1 and (select count(*) from analytics.job_token t join analytics.job j on j.id = t.job_id where j.job_no = r ->> 'job_no' and j.shop_id = a and t.revoked_at is null) = 1);
    r3 := pg_temp.opn(sM2, jsonb_build_object('idem', k, 'label', 'กดซ้ำ', 'metal', 'silver'));
    v := v || pg_temp.chk('O9c', 'key เดียวกันจากช่างอื่น → idem_conflict · ไม่ใช่ใบเดิม · ไม่มีอะไรเกิด', r3 ->> 'code' = 'idem_conflict' and not (r3 ? 'job_no') and pg_temp.shop_state(a) = s0);
    s := '';
    foreach x in array array['short', 'has space in the key 1234567890', repeat('k', 65), 'bad/char/in/key/12345678', 'ก' || repeat('k', 20)] loop
      r3 := pg_temp.opn(sM, jsonb_build_object('idem', x, 'label', 'คีย์ผิด', 'metal', 'silver'));
      if r3 ->> 'code' is distinct from 'idem_invalid' then s := s || '[' || left(x, 10) || ':' || coalesce(r3 ->> 'code', 'ok') || '] '; end if;
    end loop;
    v := v || pg_temp.chk('O9d', 'idem key รูปแบบผิด (สั้น · ช่องว่าง · ยาว 65 · อักขระต้องห้าม · ไทย) → idem_invalid · หลุด: ' || coalesce(nullif(s, ''), 'ไม่มี'), s = '' and pg_temp.shop_state(a) = s0);
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('O9-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- O10 rate limit: ก่อนแตะข้อมูล และก่อนตรวจพารามิเตอร์ · wo: ต่อช่าง 10 · sio: ต่อ token 20 · ipw: ต่อ IP 300
  begin
    s0 := pg_temp.shop_state(a); s := '';
    for i in 1..10 loop
      r := pg_temp.opn(sM, jsonb_build_object('product', fixa, 'qty', '0', 'rl', '1'));
      s := s || coalesce(r ->> 'code', 'ok') || ',';
    end loop;
    r := pg_temp.opn(sM, jsonb_build_object('product', fixa, 'rl', '1'));
    v := v || pg_temp.chk('O10a', 'ต่อช่าง: 10 ครั้งแรก (ผิดพารามิเตอร์) ยังตอบ qty_invalid · ครั้งที่ 11 (พารามิเตอร์ถูก) → rate_limited · ไม่มีใบเกิด', s = repeat('qty_invalid,', 10) and r ->> 'code' = 'rate_limited' and pg_temp.shop_state(a) = s0);
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('O10a-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    s0 := pg_temp.shop_state(a);
    insert into analytics.worker_rate_limit (key, window_start, hits)
    values ('sio:' || left(pg_temp.th(), 32), to_timestamp(floor(extract(epoch from now()) / 600) * 600), 20)
    on conflict (key, window_start) do update set hits = 20;   -- fixture: จำลองถังต่อ token เต็ม 20 (INSERT ตรง — ยกเว้นที่บอกตรงๆ)
    r := pg_temp.opn(sM, jsonb_build_object('product', gen_random_uuid(), 'rl', '1'));
    v := v || pg_temp.chk('O10b', 'ต่อ token เต็ม 20: ตอบ rate_limited ก่อนตรวจ SKU (SKU ปลอมก็ไม่ถึง sku_invalid) · ถังต่อช่าง wo: ไม่ถูกนับ (ด่าน token มาก่อน) · ไม่มีใบเกิด',
      r ->> 'code' = 'rate_limited' and not exists (select 1 from analytics.worker_rate_limit where key = 'wo:' || pg_temp.fx('wM')::text) and pg_temp.shop_state(a) = s0);
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('O10b-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    s0 := pg_temp.shop_state(a);
    insert into analytics.worker_rate_limit (key, window_start, hits)
    values ('ipw:' || left(analytics.job_sha256_hex('ip-open-v187'), 32), to_timestamp(floor(extract(epoch from now()) / 600) * 600), 300)
    on conflict (key, window_start) do update set hits = 300;   -- fixture: ถังต่อ IP เต็ม 300
    r := pg_temp.opn(sM, jsonb_build_object('product', fixa, 'ip', analytics.job_sha256_hex('ip-open-v187'), 'rl', '1'));
    r2 := pg_temp.opn(sM, jsonb_build_object('product', fixa));
    v := v || pg_temp.chk('O10c', 'ต่อ IP เต็ม 300 → rate_limited · IP อื่น/ไม่มี IP ยังเปิดได้ (ต้องไม่พัง)', r ->> 'code' = 'rate_limited' and r2 ->> 'ok' = 'true');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('O10c-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  return v;
end;
$c$;

-- ============================================================================
-- O2. เปิดใบสำเร็จ: ตรวจทุกแถวที่เกิด + ผลฝั่งช่างไม่มีเงิน/ต้นทุน/น้ำหนักทอง
-- ============================================================================
create function pg_temp.g_open_ok() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); r jsonb; r2 jsonb; j jsonb; it jsonb; po jsonb; tkr analytics.job_token%rowtype; n int; s text; k text;
  sM text := pg_temp.kv('sM'); fixa uuid := pg_temp.fx('fixa'); gold_prof uuid; def_prof uuid; w jsonb; ev text;
begin
  select id into gold_prof from analytics.job_record_profile where shop_id = a and is_default_gold;
  select id into def_prof from analytics.job_record_profile where shop_id = a and is_default;

  -- OK1 มี SKU (เงิน fixed) ค่าเริ่มทั้งหมด
  begin
    k := pg_temp.ik();
    r := pg_temp.opn(sM, jsonb_build_object('idem', k, 'product', fixa, 'qty', 3));
    j := pg_temp.jr(r ->> 'job_no'); po := pg_temp.por(r ->> 'order_no'); it := pg_temp.itr(r ->> 'order_no');
    v := v || pg_temp.chk('OK1a', 'ผลสำเร็จ: ok · already=false · token 43 ตัว · sku=ZZ187-FIXA · sku_pending=false · metal=silver · qty 3/3 · ชื่อแบบ = ชื่อสินค้า',
      r ->> 'ok' = 'true' and r ->> 'already' = 'false' and (r ->> 'token') ~ '^[A-Za-z0-9_-]{43}$' and r ->> 'sku' = 'ZZ187-FIXA' and r ->> 'sku_pending' = 'false' and r ->> 'metal' = 'silver'
      and (r ->> 'qty_order')::int = 3 and (r ->> 'qty_planned')::int = 3 and r ->> 'design_label' = 'แหวนทดสอบ A');
    v := v || pg_temp.chk('OK1b', 'ใบผลิต: opened_via=shopfloor · ผู้เปิด=M · idem key · created_by ว่าง · ยังไม่รับทราบ · สถานะ open',
      po ->> 'opened_via' = 'shopfloor' and (po ->> 'opened_by_worker_id')::uuid = pg_temp.fx('wM') and po ->> 'intake_idem_key' = k and po -> 'created_by' = 'null'::jsonb and po -> 'acknowledged_at' = 'null'::jsonb and po ->> 'status' = 'open');
    v := v || pg_temp.chk('OK1c', 'รายการใบผลิต: SKU ถูก · ไม่มีชื่อแบบรอ · จำนวน 3 · เงิน เนื้อ 0.925 (ค่าเริ่ม) น้ำหนักว่าง',
      (it ->> 'product_id')::uuid = fixa and it -> 'pending_product_label' = 'null'::jsonb and (it ->> 'qty_planned')::int = 3 and it ->> 'metal' = 'silver' and (it ->> 'purity')::numeric = 0.925 and it -> 'weight_g' = 'null'::jsonb);
    v := v || pg_temp.chk('OK1d', 'ใบงาน: created_by ว่าง · opened_by_worker_id=M · product/sku ตรง · metal silver · qty_order 3 = planned 3 · status open · แบบ = แบบค่าเริ่ม (' || coalesce(j ->> 'profile_name', '-') || ')',
      j -> 'created_by' = 'null'::jsonb and (j ->> 'opened_by_worker_id')::uuid = pg_temp.fx('wM') and (j ->> 'product_id')::uuid = fixa and j ->> 'sku_snapshot' = 'ZZ187-FIXA' and j ->> 'metal' = 'silver'
      and (j ->> 'qty_order')::int = 3 and (j ->> 'qty_planned')::int = 3 and j ->> 'status' = 'open' and (j ->> 'profile_id')::uuid = def_prof);
    select * into tkr from analytics.job_token where job_id = (j ->> 'id')::uuid;
    v := v || pg_temp.chk('OK1e', 'QR ใบงาน: 1 ใบ · issued_by ว่าง · issued_by_worker_id=M · purpose=traveler · hash = sha256 ของค่าที่คืน · ยังไม่ถูกเพิกถอน',
      (select count(*) from analytics.job_token where job_id = (j ->> 'id')::uuid) = 1 and tkr.issued_by is null and tkr.issued_by_worker_id = pg_temp.fx('wM') and tkr.purpose = 'traveler'
      and tkr.token_hash = analytics.job_sha256_hex(r ->> 'token') and tkr.revoked_at is null);
    select string_agg(event_type || ':' || channel || ':' || (worker_id is not null)::text || ':' || (actor is null)::text, ' ' order by recorded_at, event_type) into ev from analytics.job_event where job_id = (j ->> 'id')::uuid;
    v := v || pg_temp.chk('OK1f', 'event: create / token_issue / intake_open ทาง worker_qr โดยช่าง (ไม่มี actor) — ได้: ' || coalesce(ev, '-'),
      ev like '%create:worker_qr:true:true%' and ev like '%token_issue:worker_qr:true:true%' and ev like '%intake_open:worker_qr:true:true%' and (select count(*) from analytics.job_event where job_id = (j ->> 'id')::uuid) = 3);
    v := v || pg_temp.chk('OK1g', 'ขั้นของใบงาน = 9 ขั้นมาตรฐาน (ไม่ใช่แบบใหม่ → ไม่มี cad/print3d/mold)', (select count(*) from analytics.job_stage where job_id = (j ->> 'id')::uuid) = 9 and not exists (select 1 from analytics.job_stage where job_id = (j ->> 'id')::uuid and stage_code in ('cad', 'print3d', 'mold')));
    v := v || pg_temp.chk('OK1h', 'ผลฝั่งช่างไม่มี key ต้องห้าม (cost|price|thb|margin|unit_cost|customer|target_piece_g) และไม่มี weight_g/purity', pg_temp.badkeys(r) = '' and not (r ? 'weight_g') and not (r ? 'purity'));
    r2 := pg_temp.q(format('select analytics.job_worker_resolve(%L, %L, null)', analytics.job_sha256_hex(r ->> 'token'), sM));
    v := v || pg_temp.chk('OK1i', 'QR ใบงานที่ได้ใช้เปิดหน้าช่างได้ (resolve ok · เลขใบตรง) · session ผู้จัดการระบุตัวได้', r2 -> 'job' ->> 'job_no' = r ->> 'job_no' and (r2 ? 'viewer'));
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('OK1-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- OK2 ไม่มี SKU · เงิน ไม่ใส่เนื้อ/น้ำหนัก (เนื้อ 92.50 ค่าเริ่ม)
  begin
    r := pg_temp.opn(sM, jsonb_build_object('label', 'แหวนลายใบไม้ (ยังไม่มีรหัส)', 'metal', 'silver', 'qty', 30));
    j := pg_temp.jr(r ->> 'job_no'); it := pg_temp.itr(r ->> 'order_no');
    v := v || pg_temp.chk('OK2a', 'ไม่มี SKU: sku=null · sku_pending=true · ชื่อแบบ = ที่พิมพ์ · ใบงาน product_id/sku_snapshot ว่าง', r ->> 'ok' = 'true' and r -> 'sku' = 'null'::jsonb and r ->> 'sku_pending' = 'true' and r ->> 'design_label' = 'แหวนลายใบไม้ (ยังไม่มีรหัส)' and j -> 'product_id' = 'null'::jsonb and j -> 'sku_snapshot' = 'null'::jsonb);
    v := v || pg_temp.chk('OK2b', 'รายการ: product_id ว่าง · pending_product_label ตรง · เงิน เนื้อ 0.925 (92.50 ค่าเริ่ม) · น้ำหนักว่าง · แบบ default (ไม่ใช่แบบทอง)', it -> 'product_id' = 'null'::jsonb and it ->> 'pending_product_label' = 'แหวนลายใบไม้ (ยังไม่มีรหัส)' and it ->> 'metal' = 'silver'
      and (it ->> 'purity')::numeric = 0.925 and it -> 'weight_g' = 'null'::jsonb and (j ->> 'profile_id')::uuid = def_prof);
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('OK2-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- OK3 ไม่มี SKU · ทอง 75% + น้ำหนัก 5.5 → ใบงาน profile ทอง · น้ำหนักทองไม่โชว์ช่าง (N1)
  begin
    r := pg_temp.opn(sM, jsonb_build_object('label', 'แหวนทอง 75% ไม่มีรหัส', 'metal', 'gold', 'purity', 0.75, 'weight', 5.5, 'qty', 3));
    j := pg_temp.jr(r ->> 'job_no'); it := pg_temp.itr(r ->> 'order_no');
    v := v || pg_temp.chk('OK3a', 'ทอง: ใบงาน metal=gold · แบบการบันทึก = แบบทองค่าเริ่ม (ชั่งทุกขั้น) · รายการเนื้อ 0.75 น้ำหนัก 5.5 (source input)',
      r ->> 'ok' = 'true' and j ->> 'metal' = 'gold' and (j ->> 'profile_id')::uuid = gold_prof and (it ->> 'purity')::numeric = 0.75 and (it ->> 'weight_g')::numeric = 5.5 and it ->> 'weight_source' = 'input');
    v := v || pg_temp.chk('OK3b', 'ผลตอนเปิดไม่มีน้ำหนัก/เนื้อ/ราคา (N1): ไม่มี key weight_g/purity/target_piece_g และข้อความทั้งก้อนไม่มี "5.5"', not (r ? 'weight_g') and not (r ? 'purity') and pg_temp.badkeys(r) = '' and position('5.5' in r::text) = 0);
    r2 := pg_temp.q(format('select analytics.job_worker_resolve(%L, %L, null)', analytics.job_sha256_hex(r ->> 'token'), sM));
    v := v || pg_temp.chk('OK3c', 'หน้าช่างของใบทอง (job_worker_resolve): ไม่มี key target_piece_g · ไม่มีข้อความ "5.5" · ไม่มี key เงิน/ต้นทุน', pg_temp.badkeys(r2) = '' and position('5.5' in r2::text) = 0 and r2 -> 'job' ->> 'job_no' = r ->> 'job_no');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('OK3-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- OK4 ทองเหลือง (เนื้อล็อก 100) · SKU override โลหะ · ขอบจำนวน · เผื่อ/กำหนด/แบบใหม่/หมายเหตุ/น้ำหนักเงิน
  begin
    r := pg_temp.opn(sM, jsonb_build_object('label', 'ทองเหลืองไม่ใส่เนื้อ', 'metal', 'brass'));
    it := pg_temp.itr(r ->> 'order_no');
    v := v || pg_temp.chk('OK4a', 'ทองเหลืองไม่ส่งเนื้อ → ล็อก 1.0000 (100%)', r ->> 'ok' = 'true' and (it ->> 'purity')::numeric = 1 and it ->> 'metal' = 'brass');
    r := pg_temp.opn(sM, jsonb_build_object('product', fixa, 'metal', 'brass'));
    it := pg_temp.itr(r ->> 'order_no');
    v := v || pg_temp.chk('OK4b', 'SKU เงิน + override โลหะเป็นทองเหลือง: รายการ metal=brass เนื้อ 1.0 · ใบงาน metal=brass', r ->> 'ok' = 'true' and it ->> 'metal' = 'brass' and (it ->> 'purity')::numeric = 1 and r ->> 'metal' = 'brass');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('OK4-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    r := pg_temp.opn(sM, jsonb_build_object('label', 'งานเต็มรูปแบบ', 'metal', 'silver', 'purity', 0.999, 'weight', 2.5, 'qty', 10, 'planned', 12, 'due', (pg_temp.today() + 5)::text, 'newd', 'true', 'note', 'ลูกค้ารอ ขอด่วน'));
    j := pg_temp.jr(r ->> 'job_no'); it := pg_temp.itr(r ->> 'order_no'); po := pg_temp.por(r ->> 'order_no');
    v := v || pg_temp.chk('OK4c', 'เผื่อ: จำนวนสั่ง 10 · เริ่มผลิต 12 (job) · รายการใบผลิต qty 10 · กำหนด วันนี้+5 · หมายเหตุ ลงใบงาน+ใบผลิต · เนื้อเงิน 0.999 (แก้ค่าเริ่มได้) น้ำหนัก 2.5 (input)',
      (j ->> 'qty_order')::int = 10 and (j ->> 'qty_planned')::int = 12 and (it ->> 'qty_planned')::int = 10 and (j ->> 'due_date')::date = pg_temp.today() + 5 and j ->> 'note' = 'ลูกค้ารอ ขอด่วน' and po ->> 'note' = 'ลูกค้ารอ ขอด่วน'
      and (it ->> 'purity')::numeric = 0.999 and (it ->> 'weight_g')::numeric = 2.5 and it ->> 'weight_source' = 'input' and (r ->> 'qty_planned')::int = 12);
    v := v || pg_temp.chk('OK4d', 'แบบใหม่: ใบงานมีขั้น cad/print3d/mold เพิ่ม (12 ขั้น) · is_new_design ที่รายการ = true', (select count(*) from analytics.job_stage where job_id = (j ->> 'id')::uuid) = 12 and (it ->> 'is_new_design')::boolean);
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('OK4d-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- OK5 ค้นสินค้า: ได้เฉพาะคอลัมน์ที่กำหนด · prefill ถูก · escape ตัวแทน LIKE · จำกัดจำนวน · ไม่มีเงิน/ต้นทุน
  begin
    r := pg_temp.srch(sM, 'ZZ187-SPOT');
    s := (r -> 'items' -> 0)::text;
    v := v || pg_temp.chk('OK5a', 'ค้น "ZZ187-SPOT": เจอ 1 · key = id,sku,name,image_path,prefill · prefill = metal/purity/weight_g/metal_known (spot → metal_known=true เงิน .925 น้ำหนัก 10)',
      jsonb_array_length(r -> 'items') = 1 and (select string_agg(kk, ',' order by kk) from jsonb_object_keys(r -> 'items' -> 0) kk) = 'id,image_path,name,prefill,sku'
      and (select string_agg(kk, ',' order by kk) from jsonb_object_keys(r -> 'items' -> 0 -> 'prefill') kk) = 'metal,metal_known,purity,weight_g'
      and r -> 'items' -> 0 -> 'prefill' ->> 'metal_known' = 'true' and r -> 'items' -> 0 -> 'prefill' ->> 'metal' = 'silver' and (r -> 'items' -> 0 -> 'prefill' ->> 'weight_g')::numeric = 10);
    v := v || pg_temp.chk('OK5b', 'ผลค้นไม่มี key เงิน/ต้นทุน/ชนิดต้นทุน/make_spec (cost|price|thb|margin|unit_cost|customer|target_piece_g|cost_type)', pg_temp.badkeys(r) = '' and s !~ 'cost_type|list_price|labor|make_spec');
    r := pg_temp.srch(sM, 'ZZ187-FIXA');
    v := v || pg_temp.chk('OK5c', 'SKU fixed ไม่ระบุโลหะ: prefill metal=silver (ค่าเริ่ม) · metal_known=false (ข้อความกลาง ไม่เตือนสีเหลือง) · น้ำหนักว่าง', r -> 'items' -> 0 -> 'prefill' ->> 'metal_known' = 'false' and r -> 'items' -> 0 -> 'prefill' ->> 'metal' = 'silver' and r -> 'items' -> 0 -> 'prefill' -> 'weight_g' = 'null'::jsonb);
    r := pg_temp.srch(sM, '%'); r2 := pg_temp.srch(sM, '_');
    v := v || pg_temp.chk('OK5d', 'พิมพ์ % หรือ _ ไม่กลายเป็นตัวแทน LIKE (ไม่ดึงทั้งแคตตาล็อก): ไม่เจอ SKU ที่ไม่มีอักขระนั้น', jsonb_array_length(r -> 'items') = 0 and jsonb_array_length(r2 -> 'items') = 0);
    r := pg_temp.srch(sM, 'ZZ187'); r2 := pg_temp.srch(sM, repeat('x', 61));
    v := v || pg_temp.chk('OK5e', 'ค้น "ZZ187" เจอเฉพาะ SKU ที่ active และไม่ใช่ live (≥ 5) · คำค้นยาว 61 → q_invalid · ว่าง → ผลว่าง', jsonb_array_length(r -> 'items') >= 5 and r2 ->> 'code' = 'q_invalid' and jsonb_array_length(pg_temp.srch(sM, '  ') -> 'items') = 0);
    v := v || pg_temp.chk('OK5f', 'คำค้น control/bidi/<> → q_invalid', pg_temp.srch(sM, E'a\nb') ->> 'code' = 'q_invalid' and pg_temp.srch(sM, 'a' || chr(8238)) ->> 'code' = 'q_invalid' and pg_temp.srch(sM, '<b>') ->> 'code' = 'q_invalid');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('OK5-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  return v;
end;
$c$;


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

-- ============================================================================
-- Y. ครบวงจร: hub → PIN → เปิดไม่มี SKU ทอง 75% → ใบงาน profile ทอง → (ปิดก่อนผูก SKU = ตก) → ผูก SKU → (ปิดก่อนรับทราบ = ตก) → ack → done → lot
-- ============================================================================
create function pg_temp.g_cycle() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); r jsonb; r2 jsonb; d jsonb; b jsonb; ak jsonb; sess text; po uuid; item uuid; job uuid; j jsonb; it jsonb; pw jsonb; st0 int; gold_prof uuid;
  fixb uuid := pg_temp.fx('fixb'); n int; c numeric; ev text;
begin
  select id into gold_prof from analytics.job_record_profile where shop_id = a and is_default_gold;
  begin
    r := pg_temp.pin_in(pg_temp.fx('wM'), '2468'); sess := r ->> 'session_hash';
    r2 := pg_temp.hub(sess);
    v := v || pg_temp.chk('Y1', 'hub → PIN → hub: state=ready · open_allowed=true', r ->> 'ok' = 'true' and r2 ->> 'state' = 'ready' and r2 ->> 'open_allowed' = 'true' and (r2 ->> 'gold_profile_ready')::boolean);
    r := pg_temp.opn(sess, jsonb_build_object('label', 'แหวนทอง 75% วงจรเต็ม', 'metal', 'gold', 'purity', 0.75, 'weight', 5.5, 'qty', 3));
    j := pg_temp.jr(r ->> 'job_no'); po := (pg_temp.por(r ->> 'order_no') ->> 'id')::uuid; item := (pg_temp.itr(r ->> 'order_no') ->> 'id')::uuid; job := (j ->> 'id')::uuid;
    v := v || pg_temp.chk('Y2', 'เปิดไม่มี SKU ทอง 75%: ใบงาน metal=gold · แบบทองค่าเริ่ม · SKU ว่าง · ชื่อแบบตามที่พิมพ์', r ->> 'ok' = 'true' and j ->> 'metal' = 'gold' and (j ->> 'profile_id')::uuid = gold_prof and j -> 'product_id' = 'null'::jsonb and j ->> 'design_label' = 'แหวนทอง 75% วงจรเต็ม');
    -- ปิดก่อนผูก SKU: done ตก sku_required (ด่านเดิมของ 0186) · ไม่มีอะไรเข้าสต็อก
    st0 := pg_temp.stock(fixb);
    d := pg_temp.dn(a, po);
    v := v || pg_temp.chk('Y3', 'ปิดใบ (production_order_done) ก่อนผูก SKU → sku_required · ไม่มี lot · สต็อกไม่ขยับ', pg_temp.hint(d) = '22023|sku_required' and pg_temp.lots(po) = 0 and pg_temp.stock(fixb) = st0 and (select status from analytics.production_order where id = po) = 'open');
    -- ผูก SKU (fixed ต้นทุนแคตตาล็อก 50 — ผู้จัดการไม่เคยเห็นตัวเลขนี้)
    b := pg_temp.bind(a, item, fixb);
    v := v || pg_temp.chk('Y4a', 'ผูก SKU สำเร็จ: ok · jobs_updated=1 · ไม่เตือนโลหะ (SKU fixed ไม่ระบุโลหะ = ข้อความกลาง)', b ->> 'ok' = 'true' and (b ->> 'jobs_updated')::int = 1 and b ->> 'metal_mismatch' = 'false' and b ->> 'sku' = 'ZZ187-FIXB');
    j := pg_temp.jr(r ->> 'job_no'); it := pg_temp.itr(r ->> 'order_no');
    v := v || pg_temp.chk('Y4b', 'ผูกแล้ว: ใบงาน product_id/sku_snapshot ตรง · ชื่อแบบของใบงานไม่เปลี่ยน · รายการ product_id ตรง ชื่อรอหาย · โลหะ/เนื้อ/น้ำหนักที่กรอกไว้ไม่ถูกทับ (gold · 0.75 · 5.5 input)',
      (j ->> 'product_id')::uuid = fixb and j ->> 'sku_snapshot' = 'ZZ187-FIXB' and j ->> 'design_label' = 'แหวนทอง 75% วงจรเต็ม' and (it ->> 'product_id')::uuid = fixb and it -> 'pending_product_label' = 'null'::jsonb
      and it ->> 'metal' = 'gold' and (it ->> 'purity')::numeric = 0.75 and (it ->> 'weight_g')::numeric = 5.5 and it ->> 'weight_source' = 'input');
    select string_agg(payload ->> 'field' || '=' || coalesce(payload ->> 'after', '-'), ' ') into ev from analytics.job_event where job_id = job and event_type = 'edit';
    v := v || pg_temp.chk('Y4c', 'event edit บนใบงาน: field=sku after=ZZ187-FIXB (มีประวัติ) — ได้: ' || coalesce(ev, '-'), ev = 'sku=ZZ187-FIXB');
    -- ปิดก่อนรับทราบ
    d := pg_temp.dn(a, po);
    v := v || pg_temp.chk('Y5', 'ผูก SKU แล้วแต่ออฟฟิศยังไม่รับทราบ: done ตก ack_required (trigger) · ไม่มี lot · สต็อกไม่ขยับ · ใบยัง open', pg_temp.hint(d) = '22023|ack_required' and pg_temp.lots(po) = 0 and pg_temp.stock(fixb) = st0 and (select status from analytics.production_order where id = po) = 'open');
    ak := pg_temp.ack(a, po);
    v := v || pg_temp.chk('Y6', 'รับทราบ: ok · บันทึกลงประวัติใบงาน 1 ใบ', ak ->> 'ok' = 'true' and (ak ->> 'jobs_logged')::int = 1 and exists (select 1 from analytics.job_event where job_id = job and event_type = 'ack'));
    d := pg_temp.dn(a, po);
    pw := pg_temp.por(r ->> 'order_no');
    v := v || pg_temp.chk('Y7a', 'ครบเงื่อนไข: done สำเร็จ (status=done) · lot 1 · สต็อก +3', d ->> 'status' = 'done' and pg_temp.lots(po) = 1 and pg_temp.stock(fixb) = st0 + 3);
    select l.unit_cost into c from analytics.stock_lot l join analytics.production_order_item i on i.id = l.production_order_item_id where i.production_order_id = po limit 1;
    v := v || pg_temp.chk('Y7b', 'ต้นทุน lot = ต้นทุนแคตตาล็อกของ SKU ที่ผูก (50) — เส้นต้นทุนไม่ถูกแตะ (ใบทองที่ผูก SKU fixed)', c = 50);
    v := v || pg_temp.chk('Y7c', 'production_order_done ไม่เปลี่ยน (md5 เท่าที่ลอกจาก DB สดก่อนเขียน 0187)', pg_temp.done_md5() = pg_temp.done_md5_before());
    d := pg_temp.dn(a, po);
    v := v || pg_temp.chk('Y8', 'done ซ้ำ → already_done · lot/สต็อกไม่เพิ่ม', d ->> 'already_done' = 'true' and pg_temp.lots(po) = 1 and pg_temp.stock(fixb) = st0 + 3);
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('Y-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  return v;
end;
$c$;

-- ============================================================================
-- K. รับทราบ (ack) + ด่านปิดใบ (close gate) + ที่มาของใบล็อก
-- ============================================================================
create function pg_temp.g_ack() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); b uuid := pg_temp.fx('B'); r jsonb; r2 jsonb; o jsonb; po uuid; item uuid; job uuid; s text; n int; off_po uuid; off_item uuid; j jsonb; o2 uuid; r3 jsonb;
  fixa uuid := pg_temp.fx('fixa'); fixc uuid := pg_temp.fx('fixc'); st0 int;
begin
  -- K1 ack: ครั้งเดียว · ใบออฟฟิศ/ร้านอื่น/ใบที่ยกเลิก = ปฏิเสธ
  begin
    o := pg_temp.open_label(); po := (o ->> 'po')::uuid; job := (o ->> 'job')::uuid;
    r := pg_temp.ack(a, po);
    v := v || pg_temp.chk('K1a', 'ack ใบจากหน้างาน: ok · acknowledged_at/by ตั้งแล้ว · event ack 1 รายการบนใบงาน',
      r ->> 'ok' = 'true' and (select acknowledged_at is not null and acknowledged_by = pg_temp.act() from analytics.production_order where id = po) and (select count(*) from analytics.job_event where job_id = job and event_type = 'ack') = 1);
    r2 := pg_temp.ack(a, po);
    v := v || pg_temp.chk('K1b', 'ack ซ้ำ → already_acknowledged · ค่าเดิมไม่ถูกทับ · ไม่มี event ซ้ำ', pg_temp.hint(r2) = '22023|already_acknowledged' and (select acknowledged_at from analytics.production_order where id = po) = (r ->> 'acknowledged_at')::timestamptz and (select count(*) from analytics.job_event where job_id = job and event_type = 'ack') = 1);
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('K1-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    r := pg_temp.ack(a, pg_temp.fx('jt_po'));
    v := v || pg_temp.chk('K1c', 'ack ใบที่ออฟฟิศเปิด → not_shopfloor', pg_temp.hint(r) = '22023|not_shopfloor' and (select acknowledged_at is null from analytics.production_order where id = pg_temp.fx('jt_po')));
    o := pg_temp.open_label(); po := (o ->> 'po')::uuid;
    r := pg_temp.ack(b, po);
    v := v || pg_temp.chk('K1d', 'ack ใบของร้าน A โดยส่ง shop B → order_not_found (ไม่ข้ามร้าน)', pg_temp.hint(r) = '22023|order_not_found' and (select acknowledged_at is null from analytics.production_order where id = po));
    perform analytics.production_order_cancel(a, po, 'verify');
    r := pg_temp.ack(a, po);
    v := v || pg_temp.chk('K1e', 'ack ใบที่ยกเลิกแล้ว → order_not_open', pg_temp.hint(r) = '22023|order_not_open');
    v := v || pg_temp.chk('K1f', 'argument ว่าง → 22023', pg_temp.q('select analytics.production_order_acknowledge(null, null)') ->> '_state' = '22023');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('K1b-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- K2 UPDATE ตรงคอลัมน์ ack: ตั้ง/แก้/ถอนนอก RPC = ปฏิเสธ (write-once) · GUC ต้องชี้ใบนี้
  begin
    o := pg_temp.open_label(); po := (o ->> 'po')::uuid;
    v := v || pg_temp.chk('K2a', 'ตั้ง ack ตรงโดยไม่ผ่าน RPC (ไม่มี GUC) → ack_locked', pg_temp.err(format('update analytics.production_order set acknowledged_at = now(), acknowledged_by = %L where id = %L', pg_temp.act(), po)) = '22023|ack_locked');
    perform set_config('analytics.po_ack', gen_random_uuid()::text, true);
    v := v || pg_temp.chk('K2b', 'GUC ชี้ใบอื่น → ack_locked', pg_temp.err(format('update analytics.production_order set acknowledged_at = now(), acknowledged_by = %L where id = %L', pg_temp.act(), po)) = '22023|ack_locked');
    perform set_config('analytics.po_ack', '', true);
    perform pg_temp.ack(a, po);
    s := '';
    perform set_config('analytics.po_ack', po::text, true);
    s := pg_temp.err(format('update analytics.production_order set acknowledged_by = %L where id = %L', gen_random_uuid(), po)) || ' ' || pg_temp.err(format('update analytics.production_order set acknowledged_at = null, acknowledged_by = null where id = %L', po))
         || ' ' || pg_temp.err(format('update analytics.production_order set acknowledged_at = now() + interval ''1 day'' where id = %L', po));
    v := v || pg_temp.chk('K2c', 'รับทราบแล้ว: แก้ผู้รับทราบ / ถอน / เลื่อนเวลา แม้ GUC ตรงใบนี้ → ack_locked ทั้งหมด (write-once) — ได้: ' || s, s = '22023|ack_locked 22023|ack_locked 22023|ack_locked');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('K2-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- K3 ที่มาของใบล็อก + CHECK
  begin
    o := pg_temp.open_label(); po := (o ->> 'po')::uuid;
    v := v || pg_temp.chk('K3a', 'แก้ opened_via (shopfloor→office เพื่อหลบด่านรับทราบ) → origin_locked', pg_temp.err(format('update analytics.production_order set opened_via = ''office'' where id = %L', po)) = '22023|origin_locked');
    v := v || pg_temp.chk('K3b', 'แก้ผู้เปิด/ idem key → origin_locked', pg_temp.err(format('update analytics.production_order set opened_by_worker_id = %L where id = %L', pg_temp.fx('wM2'), po)) = '22023|origin_locked'
      and pg_temp.err(format('update analytics.production_order set intake_idem_key = %L where id = %L', pg_temp.ik(), po)) = '22023|origin_locked');
    v := v || pg_temp.chk('K3c', 'ใบออฟฟิศแก้เป็น shopfloor → origin_locked', pg_temp.err(format('update analytics.production_order set opened_via = ''shopfloor'' where id = %L', pg_temp.fx('jt_po'))) = '22023|origin_locked');
    v := v || pg_temp.chk('K3d', 'INSERT ตรง shopfloor ไม่มีผู้เปิด → CHECK 23514', pg_temp.err(format('insert into analytics.production_order (shop_id, seq, opened_via, intake_idem_key) values (%L, 900001, ''shopfloor'', %L)', a, pg_temp.ik())) like '23514%');
    v := v || pg_temp.chk('K3e', 'INSERT ตรง office มี idem key → CHECK 23514 · shopfloor ไม่มี idem key → CHECK 23514',
      pg_temp.err(format('insert into analytics.production_order (shop_id, seq, intake_idem_key) values (%L, 900002, %L)', a, pg_temp.ik())) like '23514%'
      and pg_temp.err(format('insert into analytics.production_order (shop_id, seq, opened_via, opened_by_worker_id) values (%L, 900003, ''shopfloor'', %L)', a, pg_temp.fx('wM'))) like '23514%');
    v := v || pg_temp.chk('K3f', 'idem key รูปแบบผิดที่ตาราง (สั้น/มีช่องว่าง) → CHECK 23514', pg_temp.err(format('insert into analytics.production_order (shop_id, seq, opened_via, opened_by_worker_id, intake_idem_key) values (%L, 900004, ''shopfloor'', %L, ''short'')', a, pg_temp.fx('wM'))) like '23514%');
    perform set_config('analytics.po_ack', pg_temp.fx('jt_po')::text, true);
    v := v || pg_temp.chk('K3g', 'ตั้ง ack บนใบออฟฟิศ (แม้ผ่าน trigger ด้วย GUC) → CHECK 23514 (รับทราบได้เฉพาะใบหน้างาน)', pg_temp.err(format('update analytics.production_order set acknowledged_at = now(), acknowledged_by = %L where id = %L', pg_temp.act(), pg_temp.fx('jt_po'))) like '23514%');
    v := v || pg_temp.chk('K3h', 'idem key ซ้ำในร้านเดียว (ชน unique 23505) → ปฏิเสธ', pg_temp.err(format('insert into analytics.production_order (shop_id, seq, opened_via, opened_by_worker_id, intake_idem_key) values (%L, 900005, ''shopfloor'', %L, %L)', a, pg_temp.fx('wM'), (select intake_idem_key from analytics.production_order where id = po))) like '23505%');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('K3-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- K4 ด่านปิดใบ (trigger): shopfloor ไม่ ack = ack_required · รายการไม่มี SKU = sku_required (ทุกที่มา) · ใบออฟฟิศไม่ติด ack
  begin
    o := pg_temp.open_label(); po := (o ->> 'po')::uuid;
    v := v || pg_temp.chk('K4a', 'UPDATE สถานะเป็น done ตรงบนใบหน้างานที่ยังไม่ ack → ack_required', pg_temp.err(format('update analytics.production_order set status = ''done'', done_at = now() where id = %L', po)) = '22023|ack_required');
    perform pg_temp.ack(a, po);
    v := v || pg_temp.chk('K4b', 'ack แล้วแต่ยังมีรายการไม่มี SKU → sku_required (ชั้นซ้ำของ done)', pg_temp.err(format('update analytics.production_order set status = ''done'', done_at = now() where id = %L', po)) = '22023|sku_required');
    perform pg_temp.bind(a, (o ->> 'item')::uuid, fixa);
    v := v || pg_temp.chk('K4c', 'ack + ผูก SKU ครบ → trigger ปล่อย (done ตรงผ่าน)', pg_temp.err(format('update analytics.production_order set status = ''done'', done_at = now() where id = %L', po)) = 'OK');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('K4-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    off_po := pg_temp.po(a, 'office-gate'); r := pg_temp.iset(a, off_po, null, 1, 'ออฟฟิศไม่มี SKU', 'silver');
    v := v || pg_temp.chk('K4d', 'ใบออฟฟิศที่มีรายการไม่มี SKU: UPDATE เป็น done ตรง → sku_required (ด่านไม่ผูกกับที่มา)', pg_temp.err(format('update analytics.production_order set status = ''done'', done_at = now() where id = %L', off_po)) = '22023|sku_required');
    v := v || pg_temp.chk('K4e', 'ใบออฟฟิศผ่าน production_order_done: sku_required (ด่านเดิม 0186) ก่อนเข้าเส้นต้นทุน', pg_temp.hint(pg_temp.dn(a, off_po)) = '22023|sku_required');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('K4d-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  -- K5 ต้องไม่พัง: ใบที่ออฟฟิศเปิด (opened_via default 'office') ปิดผ่าน production_order_done ได้โดยไม่ ack/ไม่ผูกอะไร · ยกเลิกใบหน้างานที่ยังไม่ ack ได้
  begin
    st0 := pg_temp.stock(fixa);
    off_po := pg_temp.po(a, 'office-ok'); perform pg_temp.iset(a, off_po, fixa, 4); perform pg_temp.iset(a, off_po, fixc, 2);
    r := pg_temp.dn(a, off_po);
    v := v || pg_temp.chk('K5a', 'ใบออฟฟิศ (office · ไม่เคยถูก ack): production_order_done สำเร็จเหมือนเดิม · lot 2 · สต็อก +4', r ->> 'status' = 'done' and pg_temp.lots(off_po) = 2 and pg_temp.stock(fixa) = st0 + 4 and (select opened_via from analytics.production_order where id = off_po) = 'office');
    v := v || pg_temp.chk('K5b', 'production_order_done md5 เท่าเดิม', pg_temp.done_md5() = pg_temp.done_md5_before());
    o := pg_temp.open_label();
    r := pg_temp.q(format('select analytics.production_order_cancel(%L, %L, %L)', a, (o ->> 'po')::uuid, 'verify'));
    v := v || pg_temp.chk('K5c', 'ยกเลิกใบหน้างานที่ยังไม่ ack ได้ (ด่านอยู่ที่ done เท่านั้น)', r ->> 'status' = 'cancelled');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('K5-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  return v;
end;
$c$;


-- ============================================================================
-- B. ผูก SKU ทีหลัง + แก้ชื่อแบบก่อนผูก + guard ของใบงาน/รายการ
-- ============================================================================
create function pg_temp.g_bind() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); b uuid := pg_temp.fx('B'); r jsonb; r2 jsonb; o jsonb; po uuid; item uuid; job uuid; j jsonb; it jsonb; s text; n int; ev text; x text; o2 jsonb;
  fixa uuid := pg_temp.fx('fixa'); fixb uuid := pg_temp.fx('fixb'); fixc uuid := pg_temp.fx('fixc'); spot uuid := pg_temp.fx('spot'); w35 uuid := pg_temp.fx('w35');
  st text; eff record; wm uuid := pg_temp.fx('wM'); wm2 uuid := pg_temp.fx('wM2'); jb uuid;
begin
  -- B1 ผูกสำเร็จ (SKU fixed): รายการ + ใบงาน (แม่) อัปเดต · ชื่อแบบใบงานไม่เปลี่ยน · event edit · ไม่ทับโลหะ/เนื้อ/น้ำหนักที่กรอก
  begin
    o := pg_temp.open_label('แหวนไม่มีรหัส B1', jsonb_build_object('metal', 'gold', 'purity', 0.9, 'weight', 4.25));
    po := (o ->> 'po')::uuid; item := (o ->> 'item')::uuid; job := (o ->> 'job')::uuid;
    r := pg_temp.bind(a, item, fixb);
    j := pg_temp.jr(o ->> 'job_no'); it := pg_temp.itr(o ->> 'order_no');
    v := v || pg_temp.chk('B1a', 'ผูกสำเร็จ: ok · jobs_updated=1 · sku/name ตรง · คืนชื่อแบบเดิม (UX R2) = แหวนไม่มีรหัส B1', r ->> 'ok' = 'true' and (r ->> 'jobs_updated')::int = 1 and r ->> 'sku' = 'ZZ187-FIXB' and r ->> 'pending_product_label_before' = 'แหวนไม่มีรหัส B1');
    v := v || pg_temp.chk('B1b', 'รายการ: product_id ตรง · ชื่อรอเป็น null · gold/0.9/4.25 (input) ไม่ถูกทับ · ใบงาน product_id/sku ตรง · design_label เดิม · ชื่อ SKU ไม่รั่วลง label',
      (it ->> 'product_id')::uuid = fixb and it -> 'pending_product_label' = 'null'::jsonb and it ->> 'metal' = 'gold' and (it ->> 'purity')::numeric = 0.9 and (it ->> 'weight_g')::numeric = 4.25 and it ->> 'weight_source' = 'input'
      and (j ->> 'product_id')::uuid = fixb and j ->> 'sku_snapshot' = 'ZZ187-FIXB' and j ->> 'design_label' = 'แหวนไม่มีรหัส B1');
    select string_agg(payload::text, ' ') into ev from analytics.job_event where job_id = job and event_type = 'edit';
    v := v || pg_temp.chk('B1c', 'event edit 1 รายการ: field=sku · before=null · after=ZZ187-FIXB · label_before · actor=ออฟฟิศ', (select count(*) from analytics.job_event where job_id = job and event_type = 'edit') = 1
      and ev like '%"field": "sku"%' and ev like '%"after": "ZZ187-FIXB"%' and ev like '%"before": null%' and ev like '%แหวนไม่มีรหัส B1%' and (select actor from analytics.job_event where job_id = job and event_type = 'edit') = pg_temp.act());
    r2 := pg_temp.bind(a, item, fixc);
    v := v || pg_temp.chk('B1d', 'ผูกแล้วแก้ไม่ได้: ผูกซ้ำ (แม้ SKU เดิม/อื่น) → already_bound · ค่าเดิมคงอยู่', pg_temp.hint(r2) = '22023|already_bound' and pg_temp.hint(pg_temp.bind(a, item, fixb)) = '22023|already_bound' and (pg_temp.itr(o ->> 'order_no') ->> 'product_id')::uuid = fixb);
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('B1-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- B2 ห้ามผ่าน: SKU ซ้ำในใบ · ปิดใช้ · live* · ร้านอื่น · ไม่มีจริง · รายการต่างร้าน · ใบไม่ open · อาร์กิวเมนต์ว่าง — ทุกข้อ "ไม่มีอะไรขยับ"
  begin
    o := pg_temp.open_label('แหวนไม่มีรหัส B2'); po := (o ->> 'po')::uuid; item := (o ->> 'item')::uuid;
    perform pg_temp.iset(a, po, fixb, 1);                 -- รายการอื่นในใบเดียวกันถือ SKU fixb อยู่แล้ว
    st := pg_temp.shop_state(a);
    v := v || pg_temp.chk('B2a', 'SKU ซ้ำกับรายการอื่นในใบเดียวกัน → sku_duplicate', pg_temp.hint(pg_temp.bind(a, item, fixb)) = '22023|sku_duplicate');
    v := v || pg_temp.chk('B2b', 'SKU ปิดใช้ → sku_inactive · live* → sku_live', pg_temp.hint(pg_temp.bind(a, item, pg_temp.fx('off'))) = '22023|sku_inactive' and pg_temp.hint(pg_temp.bind(a, item, pg_temp.fx('live'))) = '22023|sku_live');
    v := v || pg_temp.chk('B2c', 'SKU ร้านอื่น / ไม่มีจริง → sku_not_found', pg_temp.hint(pg_temp.bind(a, item, pg_temp.fx('bsku'))) = '22023|sku_not_found' and pg_temp.hint(pg_temp.bind(a, item, gen_random_uuid())) = '22023|sku_not_found');
    v := v || pg_temp.chk('B2d', 'รายการของร้าน A แต่ส่ง shop B → item_not_found · รายการสุ่ม → item_not_found · อาร์กิวเมนต์ว่าง → 22023',
      pg_temp.hint(pg_temp.bind(b, item, pg_temp.fx('bsku'))) = '22023|item_not_found' and pg_temp.hint(pg_temp.bind(a, gen_random_uuid(), fixa)) = '22023|item_not_found'
      and pg_temp.q('select analytics.production_order_item_bind_product(null, null, null)') ->> '_state' = '22023');
    v := v || pg_temp.chk('B2e', 'ทุกข้อที่ถูกปฏิเสธ: รายการยังไม่มี SKU · ใบงานยังไม่มี SKU · state ไม่ขยับ', (pg_temp.itr(o ->> 'order_no') -> 'product_id') = 'null'::jsonb and (pg_temp.jr(o ->> 'job_no') -> 'product_id') = 'null'::jsonb and pg_temp.shop_state(a) = st);
    perform analytics.production_order_cancel(a, po, 'verify');
    v := v || pg_temp.chk('B2f', 'ใบผลิตไม่ open (ยกเลิกแล้ว) → order_not_open', pg_temp.hint(pg_temp.bind(a, item, fixa)) = '22023|order_not_open');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('B2-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- B3 ค่าที่มีผล (effective) ไม่เปลี่ยนเงียบๆ · เตือนโลหะเมื่อ SKU ระบุโลหะชัดแต่ต่างจากรายการ · ประทับน้ำหนักเงินแบบเปิดเผย
  begin
    o := pg_temp.open_label('ทองไม่มีรหัส B3', jsonb_build_object('metal', 'gold', 'purity', 0.75, 'weight', 5.5));
    item := (o ->> 'item')::uuid;
    r := pg_temp.bind(a, item, spot);
    it := pg_temp.itr(o ->> 'order_no');
    select s2.metal, s2.purity, s2.weight_g, s2.weight_source into eff from analytics.production_item_spec(jsonb_populate_record(null::analytics.production_order_item, it), (select p from public.product p where p.id = spot)) s2;
    v := v || pg_temp.chk('B3a', 'รายการทอง ผูก SKU spot-เงิน (metal_known): ok + metal_mismatch=true (item gold · sku silver) — เตือน ไม่บล็อก', r ->> 'ok' = 'true' and r ->> 'metal_mismatch' = 'true' and r ->> 'item_metal' = 'gold' and r ->> 'sku_metal' = 'silver' and r ->> 'sku_metal_known' = 'true');
    v := v || pg_temp.chk('B3b', 'ค่าที่มีผลหลังผูก (production_item_spec) = ก่อนผูก: gold · 0.75 · 5.5 input — SKU ไม่ทับ · น้ำหนัก 10 g ของ SKU เงินไม่รั่วมาเป็นน้ำหนักทอง · weight_filled=false',
      eff.metal = 'gold' and eff.purity = 0.75 and eff.weight_g = 5.5 and eff.weight_source = 'input' and r ->> 'weight_filled' = 'false');
    o := pg_temp.open_label('เงินไม่มีน้ำหนัก B3'); item := (o ->> 'item')::uuid;
    r := pg_temp.bind(a, item, w35);
    it := pg_temp.itr(o ->> 'order_no');
    v := v || pg_temp.chk('B3c', 'เงินน้ำหนักว่าง + SKU มีน้ำหนักเงิน 3.5: ประทับ 3.5 (source=product) ลงรายการอย่างเปิดเผย · weight_filled=true — ไม่ปล่อยให้ค่าที่มีผลเปลี่ยนเงียบๆ', (it ->> 'weight_g')::numeric = 3.5 and it ->> 'weight_source' = 'product' and r ->> 'weight_filled' = 'true' and (it ->> 'purity')::numeric = 0.925);
    o := pg_temp.open_label('เงินน้ำหนักกรอกเอง B3', jsonb_build_object('weight', 2.0)); item := (o ->> 'item')::uuid;
    r := pg_temp.bind(a, item, w35);
    it := pg_temp.itr(o ->> 'order_no');
    v := v || pg_temp.chk('B3d', 'เงินที่กรอกน้ำหนัก 2.0 ไว้แล้ว: ผูก SKU น้ำหนัก 3.5 ไม่ทับ (2.0 input) · weight_filled=false', (it ->> 'weight_g')::numeric = 2.0 and it ->> 'weight_source' = 'input' and r ->> 'weight_filled' = 'false');
    o := pg_temp.open_label('ทองเหลืองไม่มีน้ำหนัก B3', jsonb_build_object('metal', 'brass')); item := (o ->> 'item')::uuid;
    r := pg_temp.bind(a, item, w35);
    it := pg_temp.itr(o ->> 'order_no');
    v := v || pg_temp.chk('B3e', 'ทองเหลืองน้ำหนักว่าง + SKU เงินมีน้ำหนัก: ไม่ประทับ (น้ำหนัก SKU ใช้เฉพาะเงิน) · เนื้อ 1.0 คงเดิม', it -> 'weight_g' = 'null'::jsonb and (it ->> 'purity')::numeric = 1 and r ->> 'weight_filled' = 'false' and it ->> 'metal' = 'brass');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('B3-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- B4 🔴 trigger ล็อกโลหะ (security): แถวเก่าที่ metal ว่าง + มีใบงานเดิน → เปลี่ยน product_id ไปหา SKU ที่โลหะที่มีผลต่างต้องถูกปฏิเสธ (เดิมหลุดเพราะเช็คเฉพาะตอน metal เปลี่ยน)
  begin
    j := pg_temp.office_job(a, fixa);
    item := (j ->> 'item')::uuid; job := (j ->> 'job')::uuid;
    update analytics.production_order_item set metal = null where id = item;          -- fixture: แถวแบบเดิมก่อน 0186 (metal ว่าง — effective ยัง silver จาก SKU fixed) · UPDATE ตรง
    update public.product set make_spec = jsonb_build_object('metal', 'gold') where id = fixc;   -- fixture: ทำให้ SKU C ระบุโลหะเป็นทอง (UPDATE ตรง)
    s := pg_temp.err(format('update analytics.production_order_item set product_id = %L where id = %L', fixc, item));
    v := v || pg_temp.chk('B4a', 'แถวเก่า metal ว่าง + ใบงานเดินอยู่: UPDATE product_id → SKU ที่โลหะมีผลเป็นทอง ถูกปฏิเสธ (metal_locked) — ไม่เปลี่ยนโลหะเงียบๆ · ได้: ' || s, s = '22023|metal_locked');
    perform analytics.job_cancel(a, job, 'verify', pg_temp.act());
    s := pg_temp.err(format('update analytics.production_order_item set product_id = %L where id = %L', fixc, item));
    v := v || pg_temp.chk('B4b', 'ต้องไม่พัง: ยกเลิกใบงานแล้วเปลี่ยน product_id ได้ (ไม่มีใบงานล็อกโลหะ)', s = 'OK');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('B4-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- B5 job_guard: ช่องแคบเฉพาะ null→SKU ผ่าน RPC · ทางอื่นทุกทางปฏิเสธ · created_by/opened_by_worker_id เปลี่ยนไม่ได้ (ระวัง "<>" กับ null)
  begin
    o := pg_temp.open_label('แหวนไม่มีรหัส B5'); item := (o ->> 'item')::uuid; job := (o ->> 'job')::uuid;
    s := pg_temp.err(format('update analytics.job set product_id = %L, sku_snapshot = ''ZZ187-FIXB'' where id = %L', fixb, job));
    v := v || pg_temp.chk('B5a', 'UPDATE product_id/sku_snapshot บนใบที่ SKU ว่าง โดยไม่ผ่าน RPC (ไม่มี GUC) → ปฏิเสธ · ได้: ' || s, s like '22023%');
    perform set_config('analytics.job_bind_item', item::text, true);
    s := pg_temp.err(format('update analytics.job set product_id = %L, sku_snapshot = ''ZZ187-FIXB'' where id = %L', fixb, job));
    v := v || pg_temp.chk('B5b', 'มี GUC ชี้รายการถูกแต่รายการใบผลิตยังไม่ผูก SKU นั้น → ปฏิเสธ', s like '22023%');
    update analytics.production_order_item set product_id = fixb, pending_product_label = null where id = item;   -- fixture: ผูกรายการตรง (ให้ทดสอบด่านฝั่งใบงานโดยเฉพาะ)
    s := pg_temp.err(format('update analytics.job set product_id = %L, sku_snapshot = ''ZZ187-FIXB'' where id = %L', fixc, job));
    v := v || pg_temp.chk('B5c', 'GUC ถูก รายการผูก fixb แล้ว แต่ใบงานจะผูก fixc (ไม่ตรงรายการ) → ปฏิเสธ', s like '22023%');
    s := pg_temp.err(format('update analytics.job set product_id = %L, sku_snapshot = ''WRONG-SKU'' where id = %L', fixb, job));
    v := v || pg_temp.chk('B5d', 'sku_snapshot ไม่ตรงรหัสของ SKU → ปฏิเสธ', s like '22023%');
    s := pg_temp.err(format('update analytics.job set sku_snapshot = ''ZZ187-FIXB'' where id = %L', job));
    v := v || pg_temp.chk('B5e', 'แก้ sku_snapshot อย่างเดียว (product_id ยังว่าง) → ปฏิเสธ', s like '22023%');
    perform set_config('analytics.job_bind_item', gen_random_uuid()::text, true);
    s := pg_temp.err(format('update analytics.job set product_id = %L, sku_snapshot = ''ZZ187-FIXB'' where id = %L', fixb, job));
    v := v || pg_temp.chk('B5f', 'GUC ชี้รายการอื่น → ปฏิเสธ', s like '22023%');
    perform set_config('analytics.job_bind_item', item::text, true);
    s := pg_temp.err(format('update analytics.job set product_id = %L, sku_snapshot = ''ZZ187-FIXB'' where id = %L', fixb, job));
    v := v || pg_temp.chk('B5g', 'เงื่อนไขครบ (GUC ถูก + รายการผูกแล้ว + รหัสตรง) → ผ่าน (นี่คือทางเดียวที่ RPC ใช้)', s = 'OK');
    s := pg_temp.err(format('update analytics.job set product_id = %L, sku_snapshot = ''ZZ187-FIXC'' where id = %L', fixc, job));
    v := v || pg_temp.chk('B5h', 'ผูกแล้ว (product_id ไม่ว่าง) เปลี่ยนอีกไม่ได้ แม้ GUC ถูก → ปฏิเสธ', s like '22023%');
    perform set_config('analytics.job_bind_item', '', true);
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('B5-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    o := pg_temp.open_label('แหวนไม่มีรหัส B5b'); job := (o ->> 'job')::uuid;
    s := pg_temp.err(format('update analytics.job set created_by = %L where id = %L', pg_temp.act(), job));
    v := v || pg_temp.chk('B5i', '🔴 ใบที่ช่างเปิด (created_by ว่าง): แก้ created_by จาก null เป็นออฟฟิศ → ปฏิเสธ (guard ใช้ is distinct from ไม่ใช่ <> ซึ่งกับ null ไม่เคยเป็นจริง) · ได้: ' || s, s like '22023%');
    s := pg_temp.err(format('update analytics.job set opened_by_worker_id = %L where id = %L', wm2, job));
    v := v || pg_temp.chk('B5j', 'เปลี่ยนผู้เปิดใบเป็นช่างอื่น → ปฏิเสธ', s like '22023%');
    s := pg_temp.err(format('update analytics.job set opened_by_worker_id = null where id = %L', job));
    v := v || pg_temp.chk('B5k', 'ถอนผู้เปิดใบ (ทั้ง created_by และ opened_by_worker_id ว่าง) → ปฏิเสธ', s <> 'OK');
    s := pg_temp.err(format('update analytics.job set note = note where id = %L', job));
    v := v || pg_temp.chk('B5l', 'ต้องไม่พัง: UPDATE ปกติที่ไม่แตะคอลัมน์ตั้งต้น (note = note) ผ่านบนใบที่ช่างเปิด', s = 'OK');
    j := pg_temp.office_job(a, pg_temp.fx('fixb'));
    s := pg_temp.err(format('update analytics.job set created_by = %L where id = %L', gen_random_uuid(), (j ->> 'job')::uuid));
    v := v || pg_temp.chk('B5m', 'ใบที่ออฟฟิศเปิด: แก้ created_by ยังถูกห้ามเหมือนเดิม', s like '22023%');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('B5i-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- B6 ใบงานที่ยกเลิก (ไม่ถูกเติม SKU) · ใบงานที่ปิดแล้วแต่ใบผลิตยังเปิดรอ SKU (ถูกเติม — ช่องแคบ)
  begin
    o := pg_temp.open_label('แหวนไม่มีรหัส B6'); item := (o ->> 'item')::uuid; job := (o ->> 'job')::uuid;
    perform analytics.job_cancel(a, job, 'verify', pg_temp.act());
    r := pg_temp.bind(a, item, fixb);
    v := v || pg_temp.chk('B6a', 'ใบงานยกเลิกแล้ว: ผูก SKU ที่รายการสำเร็จ แต่ไม่แตะใบงานที่ยกเลิก (jobs_updated=0 · ใบงานยังไม่มี SKU)', r ->> 'ok' = 'true' and (r ->> 'jobs_updated')::int = 0 and (pg_temp.jr(o ->> 'job_no') -> 'product_id') = 'null'::jsonb and (pg_temp.itr(o ->> 'order_no') ->> 'product_id')::uuid = fixb);
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('B6a-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  begin
    o := pg_temp.open_label('แหวนไม่มีรหัส B6 ปิดแล้ว'); item := (o ->> 'item')::uuid; job := (o ->> 'job')::uuid;
    -- fixture: จัดสถานะ "ใบงาน done" โดยปิด trigger ชั่วคราว (session_replication_role=replica — เฉพาะบล็อกนี้ ในทรานแซกชันที่ถอยกลับ) แล้วเปิดกลับ origin ก่อนทดสอบ
    jb := job;
    set local session_replication_role = replica;
    update analytics.job_stage set status = 'skipped', skip_reason = 'fixture verify-0187' where job_id = jb;
    update analytics.job set status = 'done', done_at = now(), qty_good = 2, qty_scrap = 0 where id = jb;
    set local session_replication_role = origin;
    r := pg_temp.bind(a, item, fixb);
    j := pg_temp.jr(o ->> 'job_no');
    v := v || pg_temp.chk('B6b', 'ใบงาน done แล้วแต่ใบผลิตยัง open (รอ SKU): ผูก SKU ได้ — ใบงานได้ product_id/sku_snapshot · คอลัมน์อื่นเท่าเดิม (status done · qty_good 2)',
      r ->> 'ok' = 'true' and (r ->> 'jobs_updated')::int = 1 and (j ->> 'product_id')::uuid = fixb and j ->> 'sku_snapshot' = 'ZZ187-FIXB' and j ->> 'status' = 'done' and (j ->> 'qty_good')::int = 2);
    s := pg_temp.err(format('update analytics.job set qty_good = 1 where id = %L', job));
    v := v || pg_temp.chk('B6c', 'ใบงาน done: แก้คอลัมน์อื่น (qty_good) ยังถูกห้ามเหมือนเดิม', s like '22023%');
    raise exception 'rb_187';
  exception when others then
    set local session_replication_role = origin;
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('B6b-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- B7 แก้ชื่อแบบก่อนผูก (R2)
  begin
    o := pg_temp.open_label('แหวนชื่อเดิม B7'); po := (o ->> 'po')::uuid; item := (o ->> 'item')::uuid; job := (o ->> 'job')::uuid;
    o2 := pg_temp.open_label('แหวนอีกรายการ B7');   -- คนละใบผลิต (ไม่ชนชื่อ)
    r := pg_temp.q(format('select analytics.production_order_item_label_set(%L, %L, %L, %L)', a, item, '  แหวน   ชื่อใหม่  B7 ', pg_temp.act()));
    v := v || pg_temp.chk('B7a', 'แก้ชื่อแบบ: ok · ช่องว่างหัวท้าย/ซ้อนถูกยุบ = "แหวน ชื่อใหม่ B7" · ใบงานไม่เปลี่ยน design_label', r ->> 'pending_product_label' = 'แหวน ชื่อใหม่ B7' and (pg_temp.itr(o ->> 'order_no') ->> 'pending_product_label') = 'แหวน ชื่อใหม่ B7' and (pg_temp.jr(o ->> 'job_no') ->> 'design_label') = 'แหวนชื่อเดิม B7');
    perform pg_temp.iset(a, po, null, 1, 'ชื่อรายการที่สอง B7', 'silver');
    r := pg_temp.q(format('select analytics.production_order_item_label_set(%L, %L, %L, %L)', a, item, 'ชื่อรายการที่สอง B7', pg_temp.act()));
    r2 := pg_temp.q(format('select analytics.production_order_item_label_set(%L, %L, %L, %L)', a, item, 'ชื่อรายการที่สอง b7', pg_temp.act()));
    v := v || pg_temp.chk('B7b', 'ชื่อซ้ำรายการอื่นในใบเดียว (ตัวพิมพ์เล็ก/ใหญ่ไม่ต่าง) → label_duplicate', pg_temp.hint(r) = '22023|label_duplicate' and pg_temp.hint(r2) = '22023|label_duplicate');
    s := '';
    foreach x in array array[E'a\tb', E'a\nb', 'a' || chr(8238) || 'b', 'a' || chr(8203) || 'b', '<b>', '   ', '...', repeat('ก', 201)] loop
      r := pg_temp.q(format('select analytics.production_order_item_label_set(%L, %L, %L, %L)', a, item, x, pg_temp.act()));
      if r ->> '_state' is distinct from '22023' then s := s || '[' || left(replace(x, E'\n', '\n'), 8) || '] '; end if;
    end loop;
    v := v || pg_temp.chk('B7c', 'ชื่อแบบ control/bidi/ล่องหน/<>/ว่าง/ไม่มีตัวอักษรจริง/ยาวเกิน → 22023 · หลุด: ' || coalesce(nullif(s, ''), 'ไม่มี'), s = '' and (pg_temp.itr(o ->> 'order_no') ->> 'pending_product_label') = 'แหวน ชื่อใหม่ B7');
    perform pg_temp.bind(a, item, fixb);
    r := pg_temp.q(format('select analytics.production_order_item_label_set(%L, %L, %L, %L)', a, item, 'หลังผูก', pg_temp.act()));
    v := v || pg_temp.chk('B7d', 'รายการที่ผูก SKU แล้วแก้ชื่อแบบไม่ได้ → already_bound', pg_temp.hint(r) = '22023|already_bound');
    r := pg_temp.q(format('select analytics.production_order_item_label_set(%L, %L, %L, %L)', b, (o2 ->> 'item')::uuid, 'ข้ามร้าน', pg_temp.act()));
    v := v || pg_temp.chk('B7e', 'ส่ง shop B กับรายการของร้าน A → item_not_found', pg_temp.hint(r) = '22023|item_not_found');
    perform analytics.production_order_cancel(a, (o2 ->> 'po')::uuid, 'verify');
    r := pg_temp.q(format('select analytics.production_order_item_label_set(%L, %L, %L, %L)', a, (o2 ->> 'item')::uuid, 'ใบยกเลิกแล้ว', pg_temp.act()));
    v := v || pg_temp.chk('B7f', 'ใบผลิตไม่ open → order_not_open', pg_temp.hint(r) = '22023|order_not_open');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('B7-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  return v;
end;
$c$;


-- ============================================================================
-- C. constraint / guard / ACL / overload / view (static + ยิงตรง)
-- ============================================================================
create function pg_temp.g_con() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); b uuid := pg_temp.fx('B'); r jsonb; r2 jsonb; s text; n int; o jsonb; tk uuid; jb uuid := pg_temp.fx('jt_job'); sig text; x text;
  c_names constant text[] := array['worker_upsert', 'worker_pin_verify', 'worker_pin_verify_core', 'worker_pin_verify_intake', 'job_create_insert', 'job_create_from_production_item', 'job_create_from_production_item_core',
    'job_token_issue', 'job_token_issue_core', 'job_guard', 'job_token_guard', 'production_order_deny_mutation', 'production_order_item_deny_mutation', 'shop_intake_token_guard', 'shop_intake_token_issue',
    'shop_intake_token_revoke', 'shop_intake_token_status', 'shop_intake_auth', 'shop_intake_resolve', 'job_product_search', 'job_worker_open', 'production_order_acknowledge', 'production_order_close_gate',
    'production_order_item_bind_product', 'production_order_item_label_set'];
  c_rpc constant text[] := array['worker_upsert', 'worker_pin_verify', 'worker_pin_verify_intake', 'job_create_from_production_item', 'job_token_issue', 'shop_intake_token_issue', 'shop_intake_token_revoke',
    'shop_intake_token_status', 'shop_intake_resolve', 'job_product_search', 'job_worker_open', 'production_order_acknowledge', 'production_order_item_bind_product', 'production_order_item_label_set'];
begin
  -- C1 CHECK ผู้ออก QR: ไม่มีผู้ออกเลย / มีทั้งสอง → 23514 · มีฝ่ายเดียว → ผ่าน · CHECK ผู้เปิดใบงาน (ตรวจนิยาม + ชั้นฟังก์ชัน)
  begin
    s := pg_temp.err(format('insert into analytics.job_token (shop_id, job_id, token_hash, print_no, issued_by, issued_by_worker_id, purpose) values (%L, %L, %L, 91, null, null, ''traveler'')', a, jb, repeat('d', 64)));
    v := v || pg_temp.chk('C1a', 'INSERT job_token ไม่มีผู้ออกเลย (issued_by และ issued_by_worker_id ว่าง) → CHECK 23514 · ได้: ' || s, s like '23514%');
    s := pg_temp.err(format('insert into analytics.job_token (shop_id, job_id, token_hash, print_no, issued_by, issued_by_worker_id, purpose) values (%L, %L, %L, 92, %L, %L, ''traveler'')', a, jb, repeat('e', 64), pg_temp.act(), pg_temp.fx('wM')));
    v := v || pg_temp.chk('C1b', 'INSERT job_token มีผู้ออกทั้งออฟฟิศและช่าง → CHECK 23514', s like '23514%');
    s := pg_temp.err(format('insert into analytics.job_token (shop_id, job_id, token_hash, print_no, issued_by, issued_by_worker_id, purpose) values (%L, %L, %L, 93, null, %L, ''traveler'')', a, jb, repeat('f', 64), pg_temp.fx('wM')));
    v := v || pg_temp.chk('C1c', 'ต้องไม่พัง: ช่างฝ่ายเดียว (issued_by ว่าง) ผ่าน', s = 'OK');
    select pg_get_constraintdef(oid) into s from pg_constraint where conrelid = 'analytics.job'::regclass and conname = 'job_who_opened_ck';
    v := v || pg_temp.chk('C1d', 'job_who_opened_ck: num_nonnulls(created_by, opened_by_worker_id) >= 1 — ทั้งสองว่างไม่ได้ (นิยามตรง) · created_by ว่างได้ (NOT NULL ถูกถอด)',
      s like '%num_nonnulls(created_by, opened_by_worker_id) >= 1%' and (select not attnotnull from pg_attribute where attrelid = 'analytics.job'::regclass and attname = 'created_by'));
    s := pg_temp.err('select analytics.job_create_insert(null::uuid, null::text, null::uuid, null::uuid, null::int, null::uuid, null::uuid, null::text, null::text, null::text, null::int, null::date, null::text, null::text, null::text[], null::boolean, null::uuid, null::int, null::numeric, null::jsonb, null::uuid, null::uuid)');
    v := v || pg_temp.chk('C1e', 'job_create_insert ไม่มีทั้ง p_actor และ p_worker_id → actor_required (ก่อนแตะข้อมูล)', s = '22023|actor_required');
    s := pg_temp.err(format('select analytics.job_create_insert(%L::uuid, null::text, null::uuid, null::uuid, null::int, null::uuid, null::uuid, null::text, null::text, null::text, null::int, null::date, null::text, null::text, null::text[], null::boolean, %L::uuid, null::int, null::numeric, null::jsonb, null::uuid, %L::uuid)', a, pg_temp.act(), pg_temp.fx('wM')));
    v := v || pg_temp.chk('C1f', 'job_create_insert มีทั้งสองฝ่าย → actor_required', s = '22023|actor_required');
    s := pg_temp.err(format('select analytics.job_token_issue_core((select j from analytics.job j where j.id = %L), false, null, null, ''traveler'', null)', jb));
    v := v || pg_temp.chk('C1g', 'job_token_issue_core ไม่มีผู้ออก → actor_required', s = '22023|actor_required');
    s := pg_temp.err(format('select analytics.job_token_issue_core((select j from analytics.job j where j.id = %L), false, %L, %L, ''traveler'', null)', jb, pg_temp.act(), pg_temp.fx('wM')));
    v := v || pg_temp.chk('C1h', 'job_token_issue_core มีทั้งสองฝ่าย → actor_required', s = '22023|actor_required');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('C1-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- C2 job_event: ชนิดใหม่ผ่าน · ชนิดแปลกตก
  begin
    s := '';
    foreach x in array array['intake_open', 'ack', 'edit'] loop
      s := s || pg_temp.err(format('select analytics.job_event_write(%L, null, %L, analytics.job_today(), %L, null, ''job_page'', null, ''{}''::jsonb)', jb, x, pg_temp.act())) || ' ';
    end loop;
    v := v || pg_temp.chk('C2a', 'job_event รับ intake_open / ack / edit — ได้: ' || s, s = 'OK OK OK ');
    v := v || pg_temp.chk('C2b', 'job_event ชนิดแปลก → CHECK 23514', pg_temp.err(format('select analytics.job_event_write(%L, null, ''bogus'', analytics.job_today(), %L, null, ''job_page'', null, ''{}''::jsonb)', jb, pg_temp.act())) like '23514%');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('C2-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- C3 job_token_guard: QR ที่ช่างออก แก้ผู้ออกไม่ได้ (null → ค่า ผ่าน <> ไม่ได้) · เพิกถอนยังได้
  begin
    o := pg_temp.open_label('แหวน C3'); tk := (select t.id from analytics.job_token t where t.job_id = (o ->> 'job')::uuid);
    s := pg_temp.err(format('update analytics.job_token set issued_by = %L where id = %L', pg_temp.act(), tk));
    v := v || pg_temp.chk('C3a', '🔴 QR ที่ช่างออก (issued_by ว่าง): แก้ issued_by เป็นออฟฟิศ → ปฏิเสธ (is distinct from) · ได้: ' || s, s like '22023%');
    s := pg_temp.err(format('update analytics.job_token set issued_by_worker_id = %L where id = %L', pg_temp.fx('wM2'), tk));
    v := v || pg_temp.chk('C3b', 'เปลี่ยนช่างผู้ออก → ปฏิเสธ', s like '22023%');
    s := pg_temp.err(format('update analytics.job_token set revoked_at = clock_timestamp(), revoke_reason = ''verify'' where id = %L', tk));
    v := v || pg_temp.chk('C3c', 'ต้องไม่พัง: เพิกถอน QR ใบนี้ได้ตามปกติ', s = 'OK');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('C3-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- C4 overload / signature / search_path / SECURITY DEFINER
  begin
    s := '';
    foreach x in array c_names loop
      select count(*) into n from pg_proc where pronamespace = 'analytics'::regnamespace and proname = x;
      if n <> 1 then s := s || x || '=' || n || ' '; end if;
    end loop;
    v := v || pg_temp.chk('C4a', 'ทุกชื่อที่ไฟล์นี้สร้าง/แก้มี 1 แถวใน pg_proc (ไม่มี overload) · ผิด: ' || coalesce(nullif(s, ''), 'ไม่มี'), s = '');
    v := v || pg_temp.chk('C4b', 'signature เดิมถูก drop: worker_upsert 6 arg · job_create_insert 21 arg = ไม่มี', to_regprocedure('analytics.worker_upsert(uuid,uuid,text,text[],text,uuid)') is null
      and to_regprocedure('analytics.job_create_insert(uuid,text,uuid,uuid,integer,uuid,uuid,text,text,text,integer,date,text,text,text[],boolean,uuid,integer,numeric,jsonb,uuid)') is null);
    v := v || pg_temp.chk('C4c', 'signature ใหม่: worker_upsert มี p_can_open_job/p_can_external · job_create_insert ลงท้าย p_worker_id',
      (select pg_get_function_identity_arguments(oid) from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'worker_upsert') like '%p_can_open_job boolean, p_can_external boolean'
      and (select pg_get_function_identity_arguments(oid) from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'job_create_insert') like '%p_profile_id uuid, p_worker_id uuid');
    s := '';
    foreach x in array c_names loop
      if exists (select 1 from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = x and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')) then s := s || x || ' '; end if;
    end loop;
    v := v || pg_temp.chk('C4d', 'ทุกฟังก์ชันที่ไฟล์นี้สร้าง/แก้ pin search_path · ขาด: ' || coalesce(nullif(s, ''), 'ไม่มี'), s = '');
    s := '';
    foreach x in array c_rpc loop
      if not (select prosecdef from pg_proc where pronamespace = 'analytics'::regnamespace and proname = x) then s := s || x || ' '; end if;
    end loop;
    foreach x in array array['shop_intake_auth', 'worker_pin_verify_core', 'job_token_issue_core', 'job_create_from_production_item_core', 'job_create_insert'] loop
      if (select prosecdef from pg_proc where pronamespace = 'analytics'::regnamespace and proname = x) then s := s || x || '(definer) '; end if;
    end loop;
    v := v || pg_temp.chk('C4e', 'RPC ทุกตัว SECURITY DEFINER · core/helper ไม่เป็น definer (ใช้สิทธิ์ผู้เรียก = owner เท่านั้นเรียกได้) · ผิด: ' || coalesce(nullif(s, ''), 'ไม่มี'), s = '');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('C4-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- C5 เวลา/วัน: ไม่มี current_date ในฟังก์ชันที่ไฟล์นี้แตะ (วันทางธุรกิจ = เวลาไทยผ่าน job_today เท่านั้น — ช่วง 00:00–07:00 ไทย UTC เหลื่อมวัน)
  begin
    s := '';
    foreach x in array c_names loop
      if exists (select 1 from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = x and (pg_get_functiondef(p.oid) ~* 'current_date|current_timestamp::date|now\(\)::date')) then s := s || x || ' '; end if;
    end loop;
    v := v || pg_temp.chk('C5a', 'ไม่มี current_date / now()::date ในฟังก์ชันที่ไฟล์นี้แตะ · เจอ: ' || coalesce(nullif(s, ''), 'ไม่มี'), s = '');
    v := v || pg_temp.chk('C5b', 'job_worker_open ตรวจกำหนดเสร็จด้วย job_today() (วันไทย) · job_today = วันที่ Asia/Bangkok ของ now()', (select pg_get_functiondef(oid) from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'job_worker_open') like '%job_today()%'
      and analytics.job_today() = (now() at time zone 'Asia/Bangkok')::date);
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('C5-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- C6 สิทธิ์ตาราง/คอลัมน์ + view
  begin
    v := v || pg_temp.chk('C6a', 'shop_intake_token: service_role อ่านได้เฉพาะคอลัมน์ที่ grant (id/shop_id/issued_at/issued_by/revoked_at/revoke_reason) — token_hash ไม่ได้ · anon/authenticated ไม่มีสิทธิ์อะไรเลย',
      not has_column_privilege('service_role', 'analytics.shop_intake_token', 'token_hash', 'select') and has_column_privilege('service_role', 'analytics.shop_intake_token', 'issued_at', 'select')
      and not has_table_privilege('service_role', 'analytics.shop_intake_token', 'insert') and not has_table_privilege('service_role', 'analytics.shop_intake_token', 'update') and not has_table_privilege('service_role', 'analytics.shop_intake_token', 'delete')
      and not has_table_privilege('anon', 'analytics.shop_intake_token', 'select') and not has_table_privilege('authenticated', 'analytics.shop_intake_token', 'select'));
    v := v || pg_temp.chk('C6b', 'RLS เปิดที่ shop_intake_token (ไม่มี policy)', (select relrowsecurity from pg_class where oid = 'analytics.shop_intake_token'::regclass) and not exists (select 1 from pg_policies where schemaname = 'analytics' and tablename = 'shop_intake_token'));
    v := v || pg_temp.chk('C6c', 'worker.can_open_job: service_role อ่านได้ · pin_hash ยังอ่านไม่ได้ (column grant เดิมไม่ถูกเปิดกว้าง)', has_column_privilege('service_role', 'analytics.worker', 'can_open_job', 'select') and not has_column_privilege('service_role', 'analytics.worker', 'pin_hash', 'select')
      and not has_column_privilege('service_role', 'analytics.job_token', 'token_hash', 'select') and has_column_privilege('service_role', 'analytics.job_token', 'issued_by_worker_id', 'select'));
    select string_agg(column_name, ',' order by ordinal_position) into s from information_schema.columns where table_schema = 'analytics' and table_name = 'v_production_order';
    v := v || pg_temp.chk('C6d', 'v_production_order: 15 คอลัมน์เดิมเป็น prefix ลำดับเดิม + ต่อท้าย opened_via/opened_by_worker_id/opened_by_worker_name/acknowledged_at/acknowledged_by/unbound_item_count · security_invoker คงอยู่',
      s = 'id,shop_id,po_no,status,note,spot_override_thb_per_gram,done_at,cancelled_at,cancel_reason,created_by,created_at,updated_at,item_count,qty_planned_total,qty_done_total,opened_via,opened_by_worker_id,opened_by_worker_name,acknowledged_at,acknowledged_by,unbound_item_count'
      and (select reloptions::text from pg_class where oid = 'analytics.v_production_order'::regclass) like '%security_invoker=true%');
    v := v || pg_temp.chk('C6e', 'v_production_order: service_role อ่านได้ · anon/authenticated ไม่ได้ · จำนวนแถว = ตาราง', has_table_privilege('service_role', 'analytics.v_production_order', 'select') and not has_table_privilege('anon', 'analytics.v_production_order', 'select')
      and not has_table_privilege('authenticated', 'analytics.v_production_order', 'select') and (select count(*) from analytics.v_production_order) = (select count(*) from analytics.production_order));
    o := pg_temp.open_label('แหวน C6'); r := (select to_jsonb(vx) from analytics.v_production_order vx where vx.po_no = o ->> 'order_no' and vx.shop_id = a);
    v := v || pg_temp.chk('C6f', 'view แสดงใบหน้างาน: opened_via=shopfloor · ชื่อผู้เปิด · ยังไม่รับทราบ · unbound_item_count=1', r ->> 'opened_via' = 'shopfloor' and r ->> 'opened_by_worker_name' = 'ZZ-M ผู้จัดการ' and r -> 'acknowledged_at' = 'null'::jsonb and (r ->> 'unbound_item_count')::int = 1);
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('C6-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- C7 ฟังก์ชัน 💰 ไม่ถูกแตะ
  v := v || pg_temp.chk('C7', 'production_order_done md5 = ที่ลอกจาก DB สดก่อนเขียน 0187 (ด่านปิดใบอยู่ใน trigger ไม่ใช่ในฟังก์ชัน)', pg_temp.done_md5() = pg_temp.done_md5_before());
  return v;
end;
$c$;

-- ============================================================================
-- R. ต้องไม่พัง: worker_upsert แบบเดิม · ใบงาน/QR ที่ออฟฟิศเปิด · /w/<token> เดิม · wrapper ออฟฟิศ
-- ============================================================================
create function pg_temp.g_reg() returns text
 language plpgsql as $c$
declare
  v text := ''; a uuid := pg_temp.fx('A'); r jsonb; r2 jsonb; w uuid; s text; n int; j jsonb; o jsonb; jobh text := pg_temp.kv('jobtokh_a'); sN text := pg_temp.kv('sN'); sM text := pg_temp.kv('sM'); ev text; tk text;
  jb uuid := pg_temp.fx('jt_job');
begin
  -- R1 worker_upsert
  begin
    r := pg_temp.q(format('select analytics.worker_upsert(p_shop_id=>%L, p_display_name=>%L, p_stage_codes=>%L::text[], p_pin=>%L, p_actor=>%L)', a, 'ZZ-R1 แบบเดิม', '{qc}', '5791', pg_temp.act()));
    w := (r ->> 'id')::uuid;
    v := v || pg_temp.chk('R1a', 'เรียกแบบเดิม (ไม่ส่ง flag): เพิ่มช่างสำเร็จ · can_open_job=false · can_external=false', w is not null and r ->> 'can_open_job' = 'false' and r ->> 'can_external' = 'false' and (select not can_open_job and not can_external from analytics.worker where id = w));
    select detail::text into s from analytics.worker_audit where worker_id = w and action = 'create';
    v := v || pg_temp.chk('R1b', 'audit ของการเพิ่มแบบเดิมไม่มี key flag (รูปเดิมเป๊ะ)', s not like '%can_open_job%' and s not like '%can_external%');
    r := pg_temp.wu(a, 'ZZ-R1 แบบเดิม', null, w, '{qc,pack}', true, null);
    v := v || pg_temp.chk('R1c', 'ส่ง can_open_job=true: ตั้งแล้ว · can_external ไม่แตะ · audit update มี flag', (select can_open_job and not can_external from analytics.worker where id = w) and exists (select 1 from analytics.worker_audit where worker_id = w and action = 'update' and (detail ->> 'can_open_job') = 'true'));
    r := pg_temp.q(format('select analytics.worker_upsert(p_shop_id=>%L, p_id=>%L, p_display_name=>%L, p_stage_codes=>%L::text[], p_actor=>%L)', a, w, 'ZZ-R1 แบบเดิม', '{qc}', pg_temp.act()));
    v := v || pg_temp.chk('R1d', 'แก้แบบเดิม (ไม่ส่ง flag) ไม่ล้าง flag ที่ตั้งไว้ (can_open_job ยัง true)', (select can_open_job from analytics.worker where id = w) and r ->> 'can_open_job' = 'true');
    r := pg_temp.wu(a, 'ZZ-R1 แบบเดิม', null, w, '{qc}', false, true);
    v := v || pg_temp.chk('R1e', 'ตั้ง can_open_job=false + can_external=true ในครั้งเดียว ได้ทั้งคู่', (select not can_open_job and can_external from analytics.worker where id = w));
    r := pg_temp.wu(a, 'ZZ-R1 stages', '5792', null, '{}', true, null);
    v := v || pg_temp.chk('R1f', 'stages_required คงเดิม: ผู้จัดการ (can_open_job) ต้องเลือกขั้นที่ทำอย่างน้อย 1 · ไม่เกิดช่างจากทางที่ปฏิเสธ', pg_temp.hint(r) = '22023|stages_required' and not exists (select 1 from analytics.worker where display_name = 'ZZ-R1 stages'));
    r := pg_temp.q(format('select analytics.worker_upsert(p_shop_id=>%L, p_id=>%L, p_display_name=>%L, p_stage_codes=>%L::text[], p_pin=>%L, p_actor=>%L)', a, w, 'ZZ-R1 แบบเดิม', '{qc}', '1234', pg_temp.act()));
    v := v || pg_temp.chk('R1g', 'แก้ช่างเดิมไม่รับ PIN (use_pin_set) คงเดิม', pg_temp.hint(r) = '22023|use_pin_set');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('R1-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- R2 ใบงาน/QR ที่ออฟฟิศเปิด (ผ่าน wrapper เดิม) ได้ผลเท่าเดิม: created_by = ผู้ทำ · opened_by_worker_id ว่าง · QR issued_by = ผู้ทำ · event ทาง job_page
  begin
    select string_agg(event_type || ':' || channel || ':' || (worker_id is null)::text || ':' || (actor is not null)::text, ' ' order by recorded_at, event_type) into ev from analytics.job_event where job_id = jb;
    v := v || pg_temp.chk('R2a', 'ใบงานออฟฟิศตั้งต้น (setup): created_by=ผู้ทำ · opened_by_worker_id ว่าง · event ทาง job_page โดยผู้ทำ (ไม่มีช่าง) — ได้: ' || coalesce(ev, '-'),
      (select created_by = pg_temp.act() and opened_by_worker_id is null from analytics.job where id = jb) and ev like '%create:job_page:true:true%' and ev like '%token_issue:job_page:true:true%');
    v := v || pg_temp.chk('R2b', 'QR ใบงานออฟฟิศ: issued_by=ผู้ทำ · issued_by_worker_id ว่าง', (select t.issued_by = pg_temp.act() and t.issued_by_worker_id is null from analytics.job_token t where t.job_id = jb and t.revoked_at is null limit 1));
    r := analytics.job_token_issue(a, jb, null, pg_temp.act());
    v := v || pg_temp.chk('R2c', 'พิมพ์ซ้ำ (job_token_issue ไม่ส่ง revoke) = เพิกถอนของเก่า 1 ใบ (ค่าเริ่มเดิมของ traveler) · QR เก่าใช้ไม่ได้ · QR ใหม่ใช้ได้', (r ->> 'revoked_previous')::int = 1
      and (pg_temp.q(format('select analytics.job_worker_resolve(%L, null, null)', jobh)) ->> 'code') = 'invalid_token' and (pg_temp.q(format('select analytics.job_worker_resolve(%L, null, null)', analytics.job_sha256_hex(r ->> 'token'))) ->> 'next_action') = 'identify');
    r := analytics.job_token_issue(a, jb, false, pg_temp.act());
    v := v || pg_temp.chk('R2d', 'ส่ง revoke=false ชัดเจน = ไม่เพิกถอน (ค่าที่ส่งชนะ) · active ที่ใช้งาน = 2', (r ->> 'revoked_previous')::int = 0 and (select count(*) from analytics.job_token where job_id = jb and revoked_at is null) = 2);
    r := pg_temp.q(format('select analytics.job_token_issue(%L, %L, null, %L, ''bogus'', null)', a, jb, pg_temp.act()));
    v := v || pg_temp.chk('R2e', 'ชนิด QR นอกชุด → purpose_invalid (ด่านเดิมก่อนตรวจสิทธิ์)', pg_temp.hint(r) = '22023|purpose_invalid');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('R2-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- R3 wrapper สร้างใบงานจากรายการใบผลิต (ทางออฟฟิศเดิม): ซ้ำ = job_exists · ไม่ส่งผู้ทำ = actor_required · อาร์กิวเมนต์ว่าง = 22023 · ออฟฟิศสร้างใบงานเดียวกับที่ช่างเปิดไม่ได้ซ้อน
  begin
    o := pg_temp.open_label('แหวน R3');
    r := pg_temp.q(format('select analytics.job_create_from_production_item(p_shop_id=>%L, p_production_order_item_id=>%L, p_stage_codes=>%L::text[], p_actor=>%L)', a, (o ->> 'item')::uuid, pg_temp.std(), pg_temp.act()));
    v := v || pg_temp.chk('R3a', 'ออฟฟิศสร้างใบงานซ้ำบนรายการที่ช่างเปิดไปแล้ว → job_exists (เลขใบเดิม) · ไม่เกิดใบที่สอง', pg_temp.hint(r) = '22023|job_exists' and r ->> '_err' like '%' || (o ->> 'job_no') || '%' and (select count(*) from analytics.job where production_order_item_id = (o ->> 'item')::uuid) = 1);
    r := pg_temp.q(format('select analytics.job_create_from_production_item(p_shop_id=>%L, p_production_order_item_id=>%L, p_stage_codes=>%L::text[])', a, (pg_temp.office_job(a, pg_temp.fx('fixa')) ->> 'item')::uuid, pg_temp.std()));
    v := v || pg_temp.chk('R3b', 'ไม่ส่ง p_actor (และไม่มี auth.uid) → actor_required (ด่านเดิม)', pg_temp.hint(r) = '22023|actor_required');
    v := v || pg_temp.chk('R3c', 'อาร์กิวเมนต์ว่าง → 22023', pg_temp.q('select analytics.job_create_from_production_item(null, null, null)') ->> '_state' = '22023');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('R3-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;

  -- R4 /w/<token> เดิม: identify list ตามขั้น · PIN ถูก/ผิด · session ใช้สแกนได้
  begin
    r := pg_temp.q(format('select analytics.job_worker_resolve(%L, null, null)', jobh));
    v := v || pg_temp.chk('R4a', 'resolve ไม่มี session: next_action=identify · รายชื่อช่างตามขั้นของใบ (ทางเดิม — ไม่ใช่รายชื่อผู้จัดการของ QR ร้าน)', r ->> 'next_action' = 'identify' and jsonb_typeof(r -> 'workers') = 'array' and not exists (select 1 from jsonb_array_elements(r -> 'workers') x where x ->> 'display_name' like 'ZZ-M%'));
    r := pg_temp.q(format('select analytics.job_worker_resolve(%L, %L, null)', jobh, sN));
    v := v || pg_temp.chk('R4b', 'resolve ด้วย session ช่างทั่วไป (ล็อกอินที่ QR ใบงาน): ระบุตัวได้ (viewer)', r ? 'viewer');
    r := pg_temp.pin_job(jobh, pg_temp.fx('wN'), '8642');
    v := v || pg_temp.chk('R4c', 'worker_pin_verify (ผ่าน core) ใส่ถูก → ok + session (รูปผลเดิม: session_token/expires_at/worker)', r ->> 'ok' = 'true' and (r ? 'expires_at') and r -> 'worker' ->> 'display_name' like 'ZZ-N%');
    r := pg_temp.pin_job(jobh, pg_temp.fx('wN'), '0000');
    v := v || pg_temp.chk('R4d', 'ใส่ผิด → bad_credentials + attempts_left + token_budget_left (รูปผลเดิม)', r ->> 'code' = 'bad_credentials' and r ? 'attempts_left' and r ? 'token_budget_left' and r ? 'attempts_until_office');
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('R4-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  return v;
end;
$c$;

-- ============================================================================
-- E. ของจริงบน prod (ข้อ 17): ยิงฟังก์ชัน/ด่านใหม่ใส่ข้อมูลเก่าทุกสถานะที่มีจริง — อ่าน/แก้ในทรานแซกชันที่ถอยกลับเท่านั้น
-- ============================================================================
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
  v_input := v_item.input || jsonb_build_object('metal', p_metal, 'is_new_design', false);
  insert into analytics.oem_quote
    select (jsonb_populate_record(null::analytics.oem_quote,
      to_jsonb(v_quote) || jsonb_build_object('id', v_q, 'quote_no', 'V187-' || substr(v_q::text, 1, 8), 'status', 'won',
        'root_quote_id', v_q, 'parent_quote_id', null))).*;
  insert into analytics.oem_quote_item
    select (jsonb_populate_record(null::analytics.oem_quote_item,
      to_jsonb(v_item) || jsonb_build_object('id', v_i, 'quote_id', v_q, 'seq', 1, 'input', v_input, 'qty', p_qty))).*;
  return jsonb_build_object('quote_id', v_q, 'item_id', v_i);
end;
$c$;
create function pg_temp.g_real() returns text
 language plpgsql as $c$
declare
  v text := ''; real_shop uuid; r record; s text; n int; bad text; st text; tpl uuid; d jsonb; j jsonb; tok jsonb; cnt int; w record; res jsonb; first_po uuid;
  c_status constant text[] := array['open', 'in_progress', 'on_hold', 'done', 'cancelled'];
begin
  select id into real_shop from public.shop where name !~ '^ZZ TEST' order by created_at limit 1;
  if real_shop is null then return pg_temp.chk('E0', 'ไม่มีร้านจริงให้ตรวจ', false); end if;
  -- E1 ข้อมูลเดิมไม่ถูกแตะ (static)
  v := v || pg_temp.chk('E1a', 'ใบผลิตจริงทุกใบ = office · ไม่มีใครรับทราบ · ไม่มี idem key · ไม่มีผู้เปิดที่เป็นช่าง', not exists (select 1 from analytics.production_order where shop_id = real_shop and (opened_via <> 'office' or acknowledged_at is not null or intake_idem_key is not null or opened_by_worker_id is not null)));
  v := v || pg_temp.chk('E1b', 'ใบงานจริงทุกใบมี created_by (ไม่มี opened_by_worker_id) · QR จริงทุกใบมี issued_by (ไม่มี issued_by_worker_id) · ไม่มีช่างจริงถือ can_open_job · ไม่มี QR ร้านของร้านจริง',
    not exists (select 1 from analytics.job where shop_id = real_shop and (created_by is null or opened_by_worker_id is not null)) and not exists (select 1 from analytics.job_token where shop_id = real_shop and (issued_by is null or issued_by_worker_id is not null))
    and not exists (select 1 from analytics.worker where shop_id = real_shop and can_open_job) and not exists (select 1 from analytics.shop_intake_token where shop_id = real_shop));
  v := v || pg_temp.chk('E1c', 'v_production_order ของร้านจริง: จำนวนแถว = ตาราง · opened_via ไม่ว่างทุกแถว', (select count(*) from analytics.v_production_order where shop_id = real_shop) = (select count(*) from analytics.production_order where shop_id = real_shop)
    and not exists (select 1 from analytics.v_production_order where shop_id = real_shop and opened_via is null));
  -- E2 job_guard ใหม่: UPDATE ที่ไม่แตะคอลัมน์ตั้งต้นบนใบงานจริงทุกสถานะ ต้องผ่านเหมือนเดิม (ยกเว้น cancelled ที่เดิมก็ห้ามอยู่แล้ว)
  bad := ''; cnt := 0;
  foreach st in array c_status loop
    for r in select id, job_no from analytics.job where shop_id = real_shop and status = st order by created_at limit 3 loop
      cnt := cnt + 1;
      s := pg_temp.err(format('update analytics.job set note = note where id = %L', r.id));
      if (st = 'cancelled') <> (s <> 'OK') then bad := bad || st || ':' || r.job_no || '=' || s || ' '; end if;
    end loop;
  end loop;
  v := v || pg_temp.chk('E2a', 'ใบงานจริง ' || cnt || ' ใบ (open/in_progress/on_hold/done ผ่าน · cancelled ถูกห้ามเหมือนเดิม): ผลไม่ต่างจากเดิม · ผิด: ' || coalesce(nullif(bad, ''), 'ไม่มี'), bad = '');
  raise notice 'E2 ตรวจใบงานจริง % ใบ', cnt;
  -- E3 job_token_guard: no-op update บน QR จริงที่ยังไม่เพิกถอน ผ่าน
  bad := ''; cnt := 0;
  for r in select id from analytics.job_token where shop_id = real_shop and revoked_at is null order by issued_at limit 5 loop
    cnt := cnt + 1;
    s := pg_temp.err(format('update analytics.job_token set print_no = print_no where id = %L', r.id));
    if s <> 'OK' then bad := bad || s || ' '; end if;
  end loop;
  v := v || pg_temp.chk('E3', 'QR ใบงานจริงที่ยัง active ' || cnt || ' ใบ: UPDATE ที่ไม่แก้อะไรผ่าน (guard ใหม่ไม่ทำให้ใบเดิมพัง) · ผิด: ' || coalesce(nullif(bad, ''), 'ไม่มี'), bad = '');
  -- E4 production_order_deny_mutation / close gate บนใบผลิตจริง
  bad := ''; cnt := 0;
  for r in select id, po_no from analytics.production_order where shop_id = real_shop and status = 'open' order by created_at limit 3 loop
    cnt := cnt + 1;
    s := pg_temp.err(format('update analytics.production_order set note = note where id = %L', r.id));
    if s <> 'OK' then bad := bad || r.po_no || ':' || s || ' '; end if;
  end loop;
  v := v || pg_temp.chk('E4a', 'ใบผลิตจริงที่ open ' || cnt || ' ใบ: UPDATE ที่ไม่แก้อะไรผ่าน · ผิด: ' || coalesce(nullif(bad, ''), 'ไม่มี'), bad = '');
  bad := ''; cnt := 0;
  for r in select p.id, p.po_no from analytics.production_order p where p.shop_id = real_shop and p.status = 'open'
             and not exists (select 1 from analytics.production_order_item i where i.production_order_id = p.id and i.product_id is null) order by p.created_at limit 3 loop
    cnt := cnt + 1;
    s := pg_temp.err(format('update analytics.production_order set status = ''done'', done_at = now() where id = %L', r.id));
    if s <> 'OK' then bad := bad || r.po_no || ':' || s || ' '; end if;
  end loop;
  v := v || pg_temp.chk('E4b', 'close gate กับใบผลิตจริงที่ open + รายการมี SKU ครบ (' || cnt || ' ใบ): เปลี่ยนเป็น done ผ่านด่านใหม่ (ใบออฟฟิศไม่ติด ack) · ผิด: ' || coalesce(nullif(bad, ''), 'ไม่มี'), bad = '');
  -- E5 RPC ใหม่ยิงใส่ใบผลิต/รายการจริงทุกสถานะ: ack = not_shopfloor · bind = already_bound/order_not_open · ไม่มีอะไรเปลี่ยน
  bad := ''; cnt := 0; st := pg_temp.shop_state(real_shop);
  for r in select id, po_no, status from analytics.production_order where shop_id = real_shop order by created_at desc limit 8 loop
    cnt := cnt + 1;
    res := pg_temp.ack(real_shop, r.id);
    if pg_temp.hint(res) <> '22023|not_shopfloor' then bad := bad || r.po_no || ':' || pg_temp.hint(res) || ' '; end if;
  end loop;
  v := v || pg_temp.chk('E5a', 'production_order_acknowledge ยิงใบผลิตจริง ' || cnt || ' ใบ (ทุกสถานะ) → not_shopfloor ทั้งหมด · ผิด: ' || coalesce(nullif(bad, ''), 'ไม่มี'), bad = '' and cnt > 0);
  bad := ''; cnt := 0;
  for r in select i.id, p.po_no, p.status from analytics.production_order_item i join analytics.production_order p on p.id = i.production_order_id
            where i.shop_id = real_shop order by i.created_at desc limit 8 loop
    cnt := cnt + 1;
    res := pg_temp.bind(real_shop, r.id, (select id from public.product where shop_id = real_shop and is_active and sku !~* '^live' limit 1));
    if pg_temp.hint(res) not in ('22023|already_bound', '22023|order_not_open') then bad := bad || r.po_no || ':' || pg_temp.hint(res) || ' '; end if;
  end loop;
  v := v || pg_temp.chk('E5b', 'production_order_item_bind_product ยิงรายการจริง ' || cnt || ' รายการ → already_bound / order_not_open เท่านั้น · ผิด: ' || coalesce(nullif(bad, ''), 'ไม่มี'), bad = '' and cnt > 0);
  v := v || pg_temp.chk('E5c', 'ไม่มีรายการจริงที่ไม่มี SKU (ก่อน W1 ไม่มีทางเกิด) · state ร้านจริงไม่ขยับจากการยิง RPC ใหม่', not exists (select 1 from analytics.production_order_item where shop_id = real_shop and product_id is null) and pg_temp.shop_state(real_shop) = st);
  -- E6 worker_upsert บนช่างจริง (ไม่ส่ง flag = ไม่แตะ · ส่ง = ตั้งได้) ในทรานแซกชันที่ถอยกลับ
  begin
    select * into w from analytics.worker where shop_id = real_shop order by created_at limit 1;
    if w.id is null then
      v := v || '[SKIP] E6  ไม่มีช่างจริงให้ตรวจ  ← ไม่นับเป็นผ่าน' || E'\n';
    else
      res := pg_temp.q(format('select analytics.worker_upsert(p_shop_id=>%L, p_id=>%L, p_display_name=>%L, p_stage_codes=>%L::text[], p_actor=>%L)', real_shop, w.id, w.display_name, w.stage_codes, pg_temp.act()));
      v := v || pg_temp.chk('E6a', 'worker_upsert แบบเดิมบนช่างจริง: ผ่าน · flag ไม่ถูกแตะ (can_open_job=false · can_external เท่าเดิม)', res ->> 'id' = w.id::text and (select not can_open_job and can_external = w.can_external from analytics.worker where id = w.id));
      res := pg_temp.q(format('select analytics.worker_upsert(p_shop_id=>%L, p_id=>%L, p_display_name=>%L, p_stage_codes=>%L::text[], p_actor=>%L, p_can_open_job=>true)', real_shop, w.id, w.display_name, w.stage_codes, pg_temp.act()));
      v := v || pg_temp.chk('E6b', 'ส่ง can_open_job=true บนช่างจริง: ตั้งได้ (ถอยกลับหลังทดสอบ)', (select can_open_job from analytics.worker where id = w.id));
    end if;
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('E6-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  -- E7 ใบงาน OEM (job_create_from_quote_item → job_create_insert 21 arg ตำแหน่งเดิม → ฟังก์ชันใหม่ที่มี p_worker_id ค่าเริ่ม null) · ไม่ใช่เส้นทางที่ replace แต่ใช้ฟังก์ชันที่ replace
  begin
    select i.id into tpl from analytics.oem_quote_item i join analytics.oem_quote q on q.id = i.quote_id
     where i.shop_id = real_shop and i.input ->> 'metal' = 'silver' and q.quote_no !~ '^V1[0-9]{2}-' order by q.created_at, i.seq limit 1;
    if tpl is null then
      v := v || '[SKIP] E7  ไม่มี oem_quote_item เงินจริงให้โคลน  ← ไม่นับเป็นผ่าน' || E'\n';
    else
      d := pg_temp.clone_deal(tpl, 'silver', 10);
      j := pg_temp.q(format('select analytics.job_create_from_quote_item(p_shop_id=>%L, p_quote_item_id=>%L, p_stage_codes=>%L::text[], p_start_gate_note=>%L, p_design_label=>%L, p_actor=>%L)',
        real_shop, d ->> 'item_id', pg_temp.std(), 'verify: เริ่มผลิตก่อนมัดจำ', 'v187-ชื่อเรียกภายใน', pg_temp.act()));
      v := v || pg_temp.chk('E7a', 'ฟอร์มสร้างใบงานจาก OEM (ทางเดิม): สำเร็จ · created_by=ผู้ทำ · opened_by_worker_id ว่าง', j ->> 'job_id' is not null and (select created_by = pg_temp.act() and opened_by_worker_id is null from analytics.job where id = (j ->> 'job_id')::uuid));
      tok := pg_temp.q(format('select analytics.job_token_issue(%L, %L, true, %L)', real_shop, j ->> 'job_id', pg_temp.act()));
      v := v || pg_temp.chk('E7b', 'ออก QR ใบ OEM ผ่าน wrapper เดิม: ok · issued_by=ผู้ทำ · hash ตรง', tok ? 'token' and (select t.issued_by = pg_temp.act() and t.issued_by_worker_id is null and t.token_hash = analytics.job_sha256_hex(tok ->> 'token') from analytics.job_token t where t.job_id = (j ->> 'job_id')::uuid));
    end if;
    raise exception 'rb_187';
  exception when others then
    if sqlerrm <> 'rb_187' then v := v || pg_temp.chk('E7-crash', sqlstate || ' ' || sqlerrm, false); end if;
  end;
  return v;
end;
$c$;


-- ============================================================================
-- M. mutant: ลบ/ย้อนด่านทีละตัวแล้วเทสต์ต้องล้มจริง (id ที่คาด) — ถ้าไม่ล้มเลย = เทสต์ไม่ได้ป้องกันด่านนั้น
-- ============================================================================
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

create function pg_temp.g_mut() returns text
 language plpgsql as $c$
declare
  v text := ''; muts jsonb; m jsonb; k int; total int; s text; o text; g text; i text; mid text; hit int; killed int := 0; survived text := '';
begin
  muts := jsonb_build_array(
    jsonb_build_object('id', 'MU1', 'what', 'shop_intake_auth: ไม่เช็ค QR ร้านที่ถูกเพิกถอน', 'sig', 'analytics.shop_intake_auth(text,text,text,boolean,text)', 'from', 'if v_tok.revoked_at is not null then', 'to', 'if false then', 'groups', jsonb_build_array('g_tok'), 'expect', jsonb_build_array('T3a', 'T3b')),
    jsonb_build_object('id', 'MU2', 'what', 'job_worker_open: ไม่เช็ค can_open_job', 'sig', 'analytics.job_worker_open(text,text,text,uuid,text,text,numeric,numeric,integer,integer,date,boolean,text,text,text)', 'from', 'if not (v_a ->> ''can_open'')::boolean then', 'to', 'if false then', 'groups', jsonb_build_array('g_open'), 'expect', jsonb_build_array('O1a', 'O1b')),
    jsonb_build_object('id', 'MU3', 'what', 'job_guard: created_by กลับไปใช้ <> (null หลุด)', 'sig', 'analytics.job_guard()', 'from', 'or new.created_by is distinct from old.created_by or new.opened_by_worker_id is distinct from old.opened_by_worker_id then', 'to', 'or new.created_by <> old.created_by then', 'groups', jsonb_build_array('g_bind'), 'expect', jsonb_build_array('B5i', 'B5j', 'B5k')),
    jsonb_build_object('id', 'MU4', 'what', 'close gate: ไม่เช็ค ack', 'sig', 'analytics.production_order_close_gate()', 'from', 'if new.opened_via = ''shopfloor'' and new.acknowledged_at is null then', 'to', 'if false then', 'groups', jsonb_build_array('g_ack', 'g_cycle'), 'expect', jsonb_build_array('K4a', 'Y5')),
    jsonb_build_object('id', 'MU5', 'what', 'worker_pin_verify_core: ไม่เช็ค can_open_job ที่ QR ร้าน', 'sig', 'analytics.worker_pin_verify_core(uuid,uuid,text,text,text,text,boolean)', 'from', 'if p_require_open and not v_w.can_open_job then', 'to', 'if false then', 'groups', jsonb_build_array('g_pin'), 'expect', jsonb_build_array('P3a', 'P3b')),
    jsonb_build_object('id', 'MU6', 'what', 'worker_pin_verify_intake: ใช้งบผิด 20/วัน/token ของ QR ใบงานกับ QR ร้าน', 'sig', 'analytics.worker_pin_verify_intake(text,uuid,text,text,text)', 'from', 'p_ip_hash, null, true);', 'to', 'p_ip_hash, ''pf:'' || left(p_token_hash, 32), true);', 'groups', jsonb_build_array('g_pin'), 'expect', jsonb_build_array('P2b', 'P4e', 'P5b')),
    jsonb_build_object('id', 'MU7', 'what', 'job_guard: ช่องผูก SKU ไม่ตรวจ GUC (ใครก็แก้ product_id ที่ว่างได้ถ้ารายการตรง)', 'sig', 'analytics.job_guard()', 'from', 'current_setting(''analytics.job_bind_item'', true) is not distinct from old.production_order_item_id::text', 'to', 'true', 'groups', jsonb_build_array('g_bind'), 'expect', jsonb_build_array('B5a', 'B5f')),
    jsonb_build_object('id', 'MU8', 'what', 'production_order_item_deny_mutation: ไม่เทียบโลหะที่มีผลตอน product_id เปลี่ยน', 'sig', 'analytics.production_order_item_deny_mutation()', 'from', '(new.metal is distinct from old.metal or new.product_id is distinct from old.product_id)', 'to', 'new.metal is distinct from old.metal', 'groups', jsonb_build_array('g_bind'), 'expect', jsonb_build_array('B4a')),
    jsonb_build_object('id', 'MU9', 'what', 'job_worker_open: idem key ของช่างอื่นไม่ถูกปฏิเสธ', 'sig', 'analytics.job_worker_open(text,text,text,uuid,text,text,numeric,numeric,integer,integer,date,boolean,text,text,text)', 'from', 'if v_po.opened_by_worker_id is distinct from v_wid then', 'to', 'if false then', 'groups', jsonb_build_array('g_open'), 'expect', jsonb_build_array('O9c')),
    jsonb_build_object('id', 'MU10', 'what', 'shop_intake_resolve: โชว์ช่างทุกคนที่ active (ไม่กรอง can_open_job)', 'sig', 'analytics.shop_intake_resolve(text,text,text)', 'from', 'where w.shop_id = v_shop and w.is_active and w.can_open_job', 'to', 'where w.shop_id = v_shop and w.is_active', 'groups', jsonb_build_array('g_hub'), 'expect', jsonb_build_array('H1a')),
    jsonb_build_object('id', 'MU11', 'what', 'job_product_search: ไม่ตัด SKU live*', 'sig', 'analytics.job_product_search(text,text,text,text)', 'from', 'and p.sku !~* ''^live''', 'to', '', 'groups', jsonb_build_array('g_open'), 'expect', jsonb_build_array('O3b')),
    jsonb_build_object('id', 'MU12', 'what', 'production_order_acknowledge: ไม่กัน ack ซ้ำ (ด่านที่ trigger ยังตกแต่ hint ต่าง)', 'sig', 'analytics.production_order_acknowledge(uuid,uuid,uuid)', 'from', 'if v_po.acknowledged_at is not null then', 'to', 'if false then', 'groups', jsonb_build_array('g_ack'), 'expect', jsonb_build_array('K1b')),
    jsonb_build_object('id', 'MU13', 'what', 'production_order_deny_mutation: ไม่ล็อก ack (ตั้ง/แก้/ถอนตรงได้)', 'sig', 'analytics.production_order_deny_mutation()', 'from', 'raise exception ''production_order: การรับทราบตั้งได้ครั้งเดียวผ่านปุ่มรับทราบเท่านั้น (แก้/ถอนไม่ได้)'' using errcode = ''22023'', hint = ''ack_locked'';', 'to', 'null;', 'groups', jsonb_build_array('g_ack'), 'expect', jsonb_build_array('K2a', 'K2c')),
    jsonb_build_object('id', 'MU14', 'what', 'job_token_guard: issued_by กลับไปใช้ <> (null หลุด)', 'sig', 'analytics.job_token_guard()', 'from', 'or new.issued_by is distinct from old.issued_by or new.issued_by_worker_id is distinct from old.issued_by_worker_id', 'to', 'or new.issued_by <> old.issued_by', 'groups', jsonb_build_array('g_con'), 'expect', jsonb_build_array('C3a', 'C3b')),
    jsonb_build_object('id', 'MU15', 'what', 'shop_intake_auth: เพดานเปิดใบต่อ token 20 → 2000', 'sig', 'analytics.shop_intake_auth(text,text,text,boolean,text)', 'from', 'else 20 end;', 'to', 'else 2000 end;', 'groups', jsonb_build_array('g_open'), 'expect', jsonb_build_array('O10b')),
    jsonb_build_object('id', 'MU16', 'what', 'job_worker_open: ไม่บล็อก SKU ที่มีใบงานเปิดอยู่', 'sig', 'analytics.job_worker_open(text,text,text,uuid,text,text,numeric,numeric,integer,integer,date,boolean,text,text,text)', 'from', 'if v_dup_no is not null then', 'to', 'if false then', 'groups', jsonb_build_array('g_open'), 'expect', jsonb_build_array('O7a', 'O7b')),
    jsonb_build_object('id', 'MU17', 'what', 'job_worker_open: ไม่จำกัดอัตราต่อช่าง', 'sig', 'analytics.job_worker_open(text,text,text,uuid,text,text,numeric,numeric,integer,integer,date,boolean,text,text,text)', 'from', 'if not analytics.job_rate_limit_hit(''wo:'' || v_wid::text, 10) then', 'to', 'if false then', 'groups', jsonb_build_array('g_open'), 'expect', jsonb_build_array('O10a')),
    jsonb_build_object('id', 'MU18', 'what', 'worker_pin_verify_core: ล็อก 15 นาทีเลื่อนไปครั้งที่ 6 (บันไดเพี้ยน)', 'sig', 'analytics.worker_pin_verify_core(uuid,uuid,text,text,text,text,boolean)', 'from', 'when v_att = 5 then now() + interval ''15 minutes''', 'to', 'when v_att = 6 then now() + interval ''15 minutes''', 'groups', jsonb_build_array('g_pin'), 'expect', jsonb_build_array('P4a', 'P4b'))
  );
  total := jsonb_array_length(muts);
  for k in 0 .. total - 1 loop
    m := muts -> k; s := ''; mid := m ->> 'id';
    begin
      perform pg_temp.mutate(m ->> 'sig', m ->> 'from', m ->> 'to');
      for g in select jsonb_array_elements_text(m -> 'groups') loop
        begin
          execute format('select pg_temp.%I()', g) into o;
          s := s || coalesce(o, '');
        exception when others then
          s := s || format('[FAIL] %s-fatal  %s', g, sqlerrm) || E'\n';
        end;
      end loop;
      raise exception 'MX_ROLLBACK';
    exception when others then
      if sqlerrm <> 'MX_ROLLBACK' then s := s || '[FAIL] MX-crash-' || mid || '  ' || sqlerrm || E'\n'; end if;
    end;
    hit := 0;
    for i in select jsonb_array_elements_text(m -> 'expect') loop
      if position('[FAIL] ' || i || ' ' in s) > 0 or position('[FAIL] ' || i || '-crash ' in s) > 0 then hit := hit + 1; end if;
    end loop;
    if hit > 0 then
      killed := killed + 1;
      v := v || format('[OK] %s  mutant ถูกจับ (%s จาก %s id ที่คาดล้ม): %s', mid, hit, jsonb_array_length(m -> 'expect'), left(m ->> 'what', 150)) || E'\n';
    else
      survived := survived || mid || ' ';
      v := v || format('[FAIL] %s  mutant รอด (ไม่มี id ที่คาด %s ล้มเลย): %s', mid, m -> 'expect', left(m ->> 'what', 150)) || E'\n';
    end if;
  end loop;
  v := v || pg_temp.chk('MX', format('mutant ถูกจับครบ %s/%s ตัว %s', killed, total, case when survived = '' then '' else 'รอด: ' || survived end), killed = total);
  return v;
end;
$c$;


-- ============================================================================
-- runner
-- ============================================================================
do $v187$
declare
  v_msg text := E'\n=== verify 0187 ===\n';
  v_part text;
  v_out text;
  v_snap0 text;
  v_hit int;
  v_fail int; v_ok int; v_skip int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  create temp table _v187_orig on commit drop as
    select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h, p.proacl::text as acl
      from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.prokind in ('f', 'p');
  v_snap0 := pg_temp.snap();
  begin
    v_msg := v_msg || pg_temp.g_setup();
    foreach v_part in array array['g_tok', 'g_pin', 'g_hub', 'g_open', 'g_open_ok', 'g_cycle', 'g_ack', 'g_bind', 'g_con', 'g_reg', 'g_real', 'g_mut'] loop
      begin
        execute format('select pg_temp.%I()', v_part) into v_out;
        v_msg := v_msg || v_out;
      exception when others then
        v_msg := v_msg || format('[FAIL] %s-fatal  กลุ่มล้มทั้งกลุ่ม: %s %s', v_part, sqlstate, sqlerrm) || E'\n';
      end;
    end loop;
    -- MY: หลัง mutant ทั้งหมด (ถอยกลับรายตัวแล้ว) นิยาม + สิทธิ์ของฟังก์ชันทุกตัวในสคีมา analytics เท่าเดิมเป๊ะ (รวมของที่สร้างใหม่ในไฟล์ migration)
    select count(*) into v_hit from _v187_orig o join pg_proc p on p.pronamespace = 'analytics'::regnamespace and p.prokind in ('f', 'p') and p.oid::regprocedure::text = o.sig
     where md5(pg_get_functiondef(p.oid)) = o.h and p.proacl::text is not distinct from o.acl;
    v_msg := v_msg || pg_temp.chk('MY', format('หลัง mutant: md5 นิยาม + สิทธิ์ของฟังก์ชันทุกตัวในสคีมา analytics (%s ตัว) เท่าเดิมเป๊ะ', (select count(*) from _v187_orig)),
      v_hit = (select count(*) from _v187_orig) and (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace and prokind in ('f', 'p')) = (select count(*) from _v187_orig));
    raise exception 'V187_ROLLBACK';
  exception when others then
    if sqlerrm <> 'V187_ROLLBACK' then v_msg := v_msg || format('[FAIL] S1-crash  ชุดหลัก raise นอกกลุ่ม: %s %s', sqlstate, sqlerrm) || E'\n'; end if;
  end;
  v_msg := v_msg || pg_temp.chk('K0', 'ชุดทดสอบไม่ทิ้งรอย: snapshot (job/stage/event/token/worker/audit/session/rate-limit/ตัวนับ/ใบผลิต/รายการ/QR ร้าน/lot/สต็อก/product/shop) เท่าเดิมหลังถอยกลับ', pg_temp.snap() = v_snap0);
  v_fail := (length(v_msg) - length(replace(v_msg, '[FAIL]', ''))) / length('[FAIL]');
  v_skip := (length(v_msg) - length(replace(v_msg, '[SKIP]', ''))) / length('[SKIP]');
  v_ok := (length(v_msg) - length(replace(v_msg, '[OK]', ''))) / length('[OK]');
  v_msg := v_msg || format(E'\n--- สรุป: OK %s · FAIL %s · SKIP %s ---', v_ok, v_fail, v_skip);
  raise exception '%', v_msg;
end;
$v187$;

