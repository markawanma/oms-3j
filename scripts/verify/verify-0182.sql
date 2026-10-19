-- scripts/verify/verify-0182.sql
-- ตรวจ supabase/migrations/0182_job_photos.sql (รูปสินค้าบนใบงาน ฝั่ง DB) ตาม design-job-photos.md §2 · §6.1 · §9 + มติเจ้าของ §10.1 (19 ต.ค. 69)
-- self-rolling-back (3j-migration-traps ข้อ 11) · ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน · ข้อมูลทดสอบสร้างผ่าน RPC ใน do-block ที่ถอยกลับทุก section
--   (ข้อยกเว้นที่บอกตรงๆ: ใบเสนอราคา OEM = โคลนจากรายการจริงด้วย INSERT ในทรานแซกชันที่ถอย (แบบเดียวกับ verify-0172..0181) · แถวรูปแคตตาล็อกปลอมใน public.product_image + object ปลอม 1 แถวใน storage.objects ·
--    เคสห้ามผ่านของ trigger/CHECK/budget ใช้ INSERT/UPDATE/DELETE/TRUNCATE ตรงตาม design §9 ข้อ 9 · ผูก SKU กับใบด้วย UPDATE ตรง (ปิด trg_job_guard ชั่วคราว) — ทุกอย่างถอยกลับ ไม่มีไฟล์จริงใน Storage)
-- รอบแรก = ของจริง · รอบถัดไป = mutant (ทุกตัวต้องล้ม ไม่งั้น MX FAIL) · ปิดท้ายตรวจ state ไม่ขยับ (นับ+md5 ทุกตาราง รวมตัวนับเลขใบงาน · job_photo · product_image · จำนวน object ใน bucket)
-- 🔴 ไฟล์นี้ต้องรันหลัง Tech Lead ส่งข้อความ "รันได้" เท่านั้น (ล็อกตาราง job ช่วง mutant — QA อาจกำลังกดบน DB จริง)
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0182.sql
-- dry-run ก่อน apply: cat supabase/migrations/0182_job_photos.sql scripts/verify/verify-0182.sql > <tmp>.sql แล้วรันไม่ใส่ --commit  (รันเป็น background — หลายนาที)
--
-- ============ ตารางแมป "ข้อในบรีฟ PH-A -> เทสต์ที่ครอบ" ============
--  ห้ามผ่าน 1  ไฟล์ไม่ใช่ JPEG จริง (svg/html/png/pdf ปลอมนามสกุล · Content-Type ปลอม)
--              -> DB: H9a (bucket จำกัด image/jpeg 1 MB private) · B2a (path นามสกุล .svg/.png ถูกปฏิเสธ) · ❌ ไม่มีเทสต์ DB ที่ยัดไฟล์จริงเข้า Storage (DB ไม่เห็น bytes) — ด่านจริงอยู่ที่ action: lib/images/server.test.ts (looksLikeJpeg) + lib/actions/job-photos.test.ts
--  ห้ามผ่าน 2  เกิน 1 MB (variant) · 0 byte                          -> B1a B1b B1c C3b · TS: job-photos.test.ts (bytes ก่อน upload) · MU-9
--  ห้ามผ่าน 3  Exif/GPS ค้าง                                           -> ❌ ไม่มีเทสต์ DB (DB ไม่เห็น bytes ของไฟล์) — lib/images/server.test.ts (findExifApp1 bytes สังเคราะห์) + job-photos.test.ts (action ปฏิเสธก่อน upload) · QA ยิงไฟล์ GPS จริงเข้า action
--  ห้ามผ่าน 4  เกินเพดานรูปต่อใบ (5 reference · 20 รวม) · budget ร้าน 250 MB
--              -> C1a C1b C1c C1d C2a C2b C2c C2d C3a C3b C3c C3d C3e · MU-3 MU-4 MU-5 MU-6 MU-36 ·
--                 ❌ race 2 connection (2 อัปโหลดพร้อมกันตอนมี 4) ไม่มีเทสต์ — do-block ทรานแซกชันเดียวจำลองไม่ได้ · ครอบด้วย pattern advisory lock เหมือน 0104/0105 + อ่านโค้ด
--  ห้ามผ่าน 5  path ที่ client ส่งมาไม่ตรงรูปแบบ/ข้ามใบ/ข้ามร้าน/ซ้ำ    -> B2a (13 แบบ) B2b B2c B2d D4a · MU-7 MU-8 · TS: action ไม่รับ path จาก FormData (job-photos.test.ts)
--  ห้ามผ่าน 6  ช่างที่ยังไม่ใส่ PIN ได้รูป/URL                          -> F3 (ไม่มี key photos · ไม่มี path ในทั้ง response) F9 (ใบปิด) · MU-25 · TS: worker-server.test.ts (ไม่ sign ถ้าไม่มี viewer) + worker-view.test.ts (allowlist photos)
--  ห้ามผ่าน 7  URL ถาวร/public                                         -> H9a (bucket private · ไม่มี storage policy) H9b · ❌ TTL 15 นาทีของ signed URL = ฝั่ง TS (lib/images/signing.test.ts) ไม่มีเทสต์ DB
--  ห้ามผ่าน 8  ส่วนย่อยมีรูปของตัวเอง (ต้องใช้รูปใบแม่)                    -> B3b B6b D5 D5b E8 F8 · MU-1 MU-2
--  ห้ามผ่าน 9  log error ทั้งก้อน (PII)                                -> ❌ ไม่มีเทสต์ DB — TS: job-photos.test.ts (console.error ถูกดัก: ไม่มี path/URL/error ทั้งก้อน) + ใช้ logJobFailure/safeLogShape เดิม
--  เพิ่มจาก design §9.1: rank 6-8 (kind stage/shopfloor/worker ผ่านทางออฟฟิศ) -> B4a B4b · MU-11 MU-12 · rank 7 (product_image_id ข้ามร้าน/ข้าม SKU) -> B4c E5 · MU-13 ·
--              rank 9 (is_primary ซ้ำ/แก้ฟิลด์ตัวตน/DELETE/TRUNCATE) -> D1 D2 D3a D3b D6 D7 D8 · MU-20 MU-21 MU-22 MU-24 MU-37 MU-38 MU-40 ·
--              rank 10 (ลบซ้ำ/ตั้งหลัก-เรียงรูปที่ลบแล้ว/reorder ชุดผิด) -> B6a B6b B7a B7b · MU-18 MU-45 MU-47 · rank 11 (caption ล่องหน/bidi/ยาว) -> B5a B5b D6 · MU-14 ·
--              rank 12 (anon/authenticated เรียก RPC/อ่านตาราง/อ่าน bucket) -> H1 H2 H5 H7 H8a H8b H8c H9a H9b · MU-31 MU-32 MU-33 MU-34 MU-35 · rank 13 (RSC payload หน้า /w/) -> F4a F4c · MU-28 · ❌ ยิงหน้า /w/ จริง grep RSC = ไม่มี (TS: worker-view.test.ts)
--  ต้องไม่พัง  ใบไม่มีรูป = หน้าช่าง/พิมพ์/บอร์ดเดิมเป๊ะ                   -> F1 F2 F3 F10 (golden: resolve ใหม่ตัด photos = ฉบับเดิมเป๊ะ ทั้งใบทดสอบและใบจริงบน DB ทุกใบ) A5 · ❌ พิมพ์/บอร์ด = ฝั่ง TS (print.test.ts · allowlist test เดิมปรับเฉพาะ key ใหม่)
--  ต้องไม่พัง  L1 ทุก flow (รับ/ส่งต่อ/ส่วนย่อย/ชี้แจง)                    -> F8 (QR ใบย่อยเปิดใบแม่ได้) F10 · mklot ใช้ split จริง · ❌ ไม่มีเทสต์ครอบ flow L1 ทั้งชุด — ต้องรัน verify-0181 ซ้ำหลัง apply (MY: md5 ฟังก์ชันอื่นทุกตัวเท่าเดิม พิสูจน์ว่า 0182 ไม่แตะ)
--  ต้องไม่พัง  ใบปิดแล้วแก้รูปได้ (มติ)                                  -> A7a-A7e (cancelled) A8a-A8c (done) · MU: ไม่มี (ไม่มีด่านให้ถอด — พิสูจน์ด้วยผลผ่าน)
--  ต้องไม่พัง  catalog รูปเดิมใช้ได้ · ห้ามเขียนกลับ catalog               -> E6 (product_image ทั้งตาราง + object product-images เท่าเดิม) E7 (ลบรูปแคตตาล็อกที่ใบอ้างอยู่ได้) D8 · MU-23 MU-41 · TS: lib/catalog/image-*.test.ts (ย้ายไป lib/images/ — ผ่านที่ path ใหม่)
--  กติกาเหล็ก  ตัวนับใบงานไม่ขยับ · ฟังก์ชันอื่นไม่ถูกแตะ · trigger เปิดครบ  -> K0 K0c MY (+ post-check ใน migration §8) · H3 H6
--  กติกาเหล็ก  Storage object ที่ทดสอบต้องลบให้หมด                      -> ไม่มีไฟล์จริงถูกสร้าง (ทดสอบชั้น DB เท่านั้น) · object ปลอม 1 แถวใน H9b อยู่ในทรานแซกชันที่ถอย · K0 นับ object ใน job-photos/product-images ก่อน-หลัง
--  e2e         อัปโหลดจริง → sign URL → ช่างเห็น/ลบ object จริงจาก bucket = ❌ ไม่มี (ต้องใช้ Supabase Storage จริง) — เป็นหน้าที่ QA หลัง PH-B/PH-C
--
--  ❌ ไม่มีเทสต์ครอบ (บอกตรงๆ):
--    - race หลาย connection (เพดาน/budget/หลักซ้ำ) — ดู ห้ามผ่าน 4
--    - PostgREST จริง (named args) / server action / หน้า /w/ จริง / Storage จริง = ไม่มี (vitest ฝั่ง lib/ ครอบ contract ของ action และ allowlist)
--    - mutant ของ trigger เฉพาะชั้นใดชั้นหนึ่งของด่านที่ซ้อนกัน (RPC + trigger/CHECK) — ถอดทั้งสองชั้นพร้อมกันในแต่ละ mutant (ด่านซ้อน ถอดชั้นเดียวไม่ทำให้เคสล้มโดยตั้งใจ)
--    - ❌ ไม่มี mutant: job_photo_path_ck/job_photo_primary_ck/job_photo_who_ck/job_photo_deleted_ck แยกตัว (เป็น CHECK ซ้อนกับ RPC/guard) — ครอบด้วยเคส D4a D4b ที่ยิงตรง
set local statement_timeout = '45min';

-- ===== helper จาก verify-0181 (ลอกตรง) =====
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
create function pg_temp.x(p_sql text) returns text
 language plpgsql as $c$
declare v_msg text; v_state text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  return 'ERR:' || v_state || ':' || v_msg;
end;
$c$;
create function pg_temp.std() returns text[] language sql as $c$
  select array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'polish', 'qc', 'pack'] $c$;
create function pg_temp.o_recv(p_shop uuid, p_job uuid, p_seq int, p_on date, p_w numeric default null,
                               p_worker uuid default null, p_name text default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_office_receive(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_occurred_on=>%L,
      p_weight_in_g=>%L, p_worker_id=>%L, p_assignee_name=>%L, p_actor=>%L)',
      p_shop, p_job, p_seq, p_on, p_w, p_worker, p_name, '00000000-0000-0000-0000-0000000000a1'::uuid)) $c$;
create function pg_temp.o_send(p_shop uuid, p_job uuid, p_seq int, p_on date, p_w numeric default null, p_scrap int default 0,
                               p_reason text default null, p_added numeric default 0, p_note text default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_office_send(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_occurred_on=>%L,
      p_weight_out_g=>%L, p_qty_scrap=>%L, p_scrap_reason=>%L, p_metal_added_g=>%L, p_weight_note=>%L, p_actor=>%L)',
      p_shop, p_job, p_seq, p_on, p_w, p_scrap, p_reason, p_added, p_note, '00000000-0000-0000-0000-0000000000a1'::uuid)) $c$;
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
create function pg_temp.tok(p_shop uuid, p_job uuid, p_revoke boolean default true) returns jsonb
 language plpgsql as $c$
declare r jsonb;
begin
  r := pg_temp.q(format('select analytics.job_token_issue(%L, %L, %L, %L)', p_shop, p_job, p_revoke, '00000000-0000-0000-0000-0000000000a1'::uuid));
  if r ? 'token' then
    r := r || jsonb_build_object('hash', analytics.job_sha256_hex(r ->> 'token'));
  end if;
  return r;
end;
$c$;
create function pg_temp.clone_deal(p_tpl_item uuid, p_metal text, p_qty int, p_root uuid default null, p_status text default 'won',
                                   p_cust text default null, p_new_design boolean default null, p_seq int default 1) returns jsonb
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
  v_input := v_item.input || jsonb_build_object('metal', p_metal)
             || case when p_new_design is null then '{}'::jsonb else jsonb_build_object('is_new_design', p_new_design) end;
  insert into analytics.oem_quote
    select (jsonb_populate_record(null::analytics.oem_quote,
      to_jsonb(v_quote) || jsonb_build_object('id', v_q, 'quote_no', 'V172-' || substr(v_q::text, 1, 8), 'status', p_status,
        'root_quote_id', coalesce(p_root, v_q), 'parent_quote_id', null,
        'customer_name', coalesce(p_cust, v_quote.customer_name)))).*;
  insert into analytics.oem_quote_item
    select (jsonb_populate_record(null::analytics.oem_quote_item,
      to_jsonb(v_item) || jsonb_build_object('id', v_i, 'quote_id', v_q, 'seq', p_seq, 'input', v_input, 'qty', p_qty))).*;
  return jsonb_build_object('quote_id', v_q, 'item_id', v_i, 'quote_no', 'V172-' || substr(v_q::text, 1, 8));
end;
$c$;
create function pg_temp.jid(r jsonb) returns uuid language sql as $c$ select (r ->> 'job_id')::uuid $c$;
create function pg_temp.sv(p_job uuid, p_seq int, p_col text) returns text language plpgsql as $c$
declare v text;
begin
  execute format('select %I::text from analytics.job_stage where job_id = %L and seq = %s', p_col, p_job, p_seq) into v;
  return v;
end;
$c$;
create function pg_temp.as_role(p_role text, p_sql text) returns text
 language plpgsql as $c$
declare v_msg text; v_state text;
begin
  execute format('set local role %I', p_role);
  execute p_sql;
  reset role;
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  reset role;
  return 'ERR:' || v_state || ':' || v_msg;
end;
$c$;
create function pg_temp.wu(p_shop uuid, p_name text, p_codes text, p_pin text default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.worker_upsert(p_shop_id=>%L, p_display_name=>%L, p_stage_codes=>%L::text[], p_pin=>%L, p_actor=>%L)',
    p_shop, p_name, '{' || coalesce(nullif(p_codes, ''), 'cad,print3d,mold,wax_inject,wax_tree,invest_burnout,cast,cut_sprue,polish,gem_set,plating,qc,pack') || '}', p_pin, '00000000-0000-0000-0000-0000000000a1'::uuid)) $c$;
create function pg_temp.newtok(p_shop uuid, p_job uuid) returns text language sql as $c$ select pg_temp.tok(p_shop, p_job) ->> 'hash' $c$;
create function pg_temp.wid(p_shop uuid, p_name text, p_pin text) returns uuid language sql as $c$ select (pg_temp.wu(p_shop, p_name, '', p_pin) ->> 'id')::uuid $c$;
create function pg_temp.mutate(p_name text, p_from text, p_to text) returns void
 language plpgsql as $c$
declare v_oid oid; v_def text; v_new text;
begin
  select p.oid into strict v_oid from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  v_new := replace(v_def, p_from, p_to);
  if v_new = v_def then
    raise exception 'MUTANT_NOT_APPLIED: % ไม่พบข้อความ [%]', p_name, p_from;
  end if;
  execute v_new;
end;
$c$;
create function pg_temp.rej(r jsonb, p_hint text) returns boolean language sql as $c$
  select coalesce(r ? '_err' and r ->> '_state' = '22023' and (p_hint is null or r ->> '_hint' = p_hint), false) $c$;
create function pg_temp.pid(p_shop uuid, p_kind text) returns uuid language sql as $c$
  select id from analytics.job_record_profile where shop_id = p_shop
     and case p_kind when 'def' then is_default when 'gold' then is_default_gold when 'none' then name like 'ไม่ชั่ง%' end limit 1 $c$;
create function pg_temp.pu(p_shop uuid, p_id uuid, p_name text, p_note text, p_stages text, p_active boolean default null,
                           p_seq int default null, p_fw boolean default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_record_profile_upsert(p_shop_id=>%L, p_id=>%L, p_name=>%L, p_note=>%L, p_stages=>%L::jsonb, p_is_active=>%L, p_seq=>%L, p_require_final_weight=>%L, p_actor=>%L)',
    p_shop, p_id, p_name, p_note, p_stages, p_active, p_seq, p_fw, '00000000-0000-0000-0000-0000000000a1'::uuid)) $c$;
create function pg_temp.jcp(p_shop uuid, p_item uuid, p_codes text[], p_profile uuid) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_create_from_quote_item(p_shop_id=>%L, p_quote_item_id=>%L, p_stage_codes=>%L::text[], p_start_gate_note=>%L, p_design_label=>%L, p_actor=>%L, p_profile_id=>%L)',
    p_shop, p_item, coalesce(p_codes, pg_temp.std()), 'verify: เริ่มผลิตก่อนมัดจำ', 'v176-ชื่อเรียกภายใน', '00000000-0000-0000-0000-0000000000a1'::uuid, p_profile)) $c$;
create function pg_temp.mkp(p_shop uuid, p_tpl uuid, p_metal text, p_profile uuid default null, p_codes text[] default null, p_qty int default 10) returns jsonb
 language plpgsql as $c$
declare d jsonb;
begin
  d := pg_temp.clone_deal(p_tpl, p_metal, p_qty, null, 'won', null, false);
  return d || pg_temp.jcp(p_shop, (d ->> 'item_id')::uuid, p_codes, p_profile);
end;
$c$;
create function pg_temp.rw(p_shop uuid, p_job uuid, p_w numeric, p_to int default 8) returns jsonb language plpgsql as $c$
declare s int; r jsonb; v_st text; v_today date := analytics.job_today();
begin
  for s in 1 .. p_to loop
    select status into v_st from analytics.job_stage where job_id = p_job and seq = s;
    if v_st = 'pending' then
      r := pg_temp.o_recv(p_shop, p_job, s, v_today, p_w, null, 'verify');
      if r ? '_err' then return r || jsonb_build_object('_at', s, '_op', 'recv'); end if;
      v_st := 'received';
    end if;
    if v_st = 'received' then
      r := pg_temp.o_send(p_shop, p_job, s, v_today, p_w);
      if r ? '_err' then return r || jsonb_build_object('_at', s, '_op', 'send'); end if;
    end if;
  end loop;
  return jsonb_build_object('ok', true);
end;
$c$;
create function pg_temp.act() returns uuid language sql as $c$ select '00000000-0000-0000-0000-0000000000a1'::uuid $c$;
create function pg_temp.o_recv2(p_shop uuid, p_job uuid, p_seq int, p_qty int default null, p_worker uuid default null, p_name text default 'verify') returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_office_receive(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_occurred_on=>%L, p_worker_id=>%L, p_assignee_name=>%L, p_qty_received=>%L, p_actor=>%L)',
    p_shop, p_job, p_seq, analytics.job_today(), p_worker, p_name, p_qty, pg_temp.act())) $c$;
create function pg_temp.o_split_raw(p_shop uuid, p_job uuid, p_seq int, p_qty int, p_scrap int, p_reason text, p_hold int, p_wmove numeric) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_lot_split(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_qty=>%L, p_qty_scrap=>%L, p_scrap_reason=>%L, p_qty_hold=>%L, p_actor=>%L, p_weight_move_g=>%L)',
    p_shop, p_job, p_seq, p_qty, p_scrap, p_reason, p_hold, pg_temp.act(), p_wmove)) $c$;
create function pg_temp.o_split(p_shop uuid, p_job uuid, p_seq int, p_qty int, p_scrap int default 0, p_reason text default null, p_hold int default null, p_wmove numeric default null) returns jsonb
 language sql as $c$
  select pg_temp.o_split_raw(p_shop, p_job, p_seq, p_qty, p_scrap, p_reason,
    coalesce(p_hold, (select s.qty_in - s.qty_scrap - s.qty_split_out from analytics.job_stage s where s.job_id = p_job and s.seq = p_seq)), p_wmove) $c$;
create function pg_temp.o_done(p_shop uuid, p_job uuid, p_good int, p_scrap int, p_w numeric default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_done(p_shop_id=>%L, p_job_id=>%L, p_qty_good=>%L, p_qty_scrap=>%L, p_weight_final_g=>%L, p_actor=>%L)', p_shop, p_job, p_good, p_scrap, p_w, pg_temp.act())) $c$;
create function pg_temp.o_cancel(p_shop uuid, p_job uuid, p_reason text default 'verify') returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_cancel(p_shop_id=>%L, p_job_id=>%L, p_reason=>%L, p_actor=>%L)', p_shop, p_job, p_reason, pg_temp.act())) $c$;
create function pg_temp.o_tissue(p_shop uuid, p_job uuid, p_revoke boolean default null, p_purpose text default 'traveler', p_lot uuid default null) returns jsonb
 language plpgsql as $c$
declare r jsonb;
begin
  r := pg_temp.q(format('select analytics.job_token_issue(p_shop_id=>%L, p_job_id=>%L, p_revoke_previous=>%L, p_actor=>%L, p_purpose=>%L, p_lot_job_id=>%L)',
    p_shop, p_job, p_revoke, pg_temp.act(), p_purpose, p_lot));
  if r ? 'token' then r := r || jsonb_build_object('hash', analytics.job_sha256_hex(r ->> 'token')); end if;
  return r;
end $c$;
create function pg_temp.fx(p_shop uuid, p_tpl uuid, p_prof uuid, p_qty int default 100, p_to int default 3, p_metal text default 'silver', p_w numeric default null) returns jsonb
 language plpgsql as $c$
declare d jsonb; j uuid; rr jsonb;
begin
  d := pg_temp.mkp(p_shop, p_tpl, p_metal, p_prof, null, p_qty);
  j := pg_temp.jid(d);
  if j is null then
    raise exception 'fx: สร้างใบไม่ได้ %', d::text;
  end if;
  rr := pg_temp.rw(p_shop, j, p_w, p_to);
  if rr ? '_err' then
    raise exception 'fx: เดินขั้นไม่ได้ %', rr::text;
  end if;
  return d || jsonb_build_object('tokh', pg_temp.newtok(p_shop, j));
end $c$;
create function pg_temp.lot(r jsonb) returns uuid language sql as $c$ select (r ->> 'lot_job_id')::uuid $c$;
create function pg_temp.sid(p_job uuid, p_seq int) returns uuid language sql as $c$ select id from analytics.job_stage where job_id = p_job and seq = p_seq $c$;
create function pg_temp.sess(p_tokh text, p_worker uuid, p_pin text) returns text
 language sql as $c$ select pg_temp.login(p_tokh, p_worker, p_pin) ->> 'session_hash' $c$;
create function pg_temp.snap() returns text
 language plpgsql as $c$
declare v text := ''; r record; n text;
begin
  for r in select unnest(array['job', 'job_stage', 'job_event', 'job_token', 'worker', 'worker_audit', 'worker_session', 'worker_rate_limit', 'job_counter', 'job_stage_def', 'job_record_profile', 'job_record_profile_stage',
                               'oem_quote', 'oem_quote_item', 'oem_receipt', 'oem_doc_counter', 'oem_quote_audit', 'production_order', 'production_order_item', 'production_order_counter',
                               'stock_lot', 'stock_lot_ledger']) as t loop
    if to_regclass('analytics.' || r.t) is not null then
      execute format('select count(*)::text || ''/'' || coalesce(md5(string_agg(x::text, ''|'' order by x::text)), '''') from analytics.%I x', r.t) into n;
      v := v || r.t || '=' || n || ';';
    end if;
  end loop;
  for r in select unnest(array['shop', 'product', 'central_stock', 'catalog_audit_log']) as t loop
    if to_regclass('public.' || r.t) is not null then
      execute format('select count(*)::text || ''/'' || coalesce(md5(string_agg(x::text, ''|'' order by x::text)), '''') from public.%I x', r.t) into n;
      v := v || 'public.' || r.t || '=' || n || ';';
    end if;
  end loop;
  return md5(v);
end;
$c$;
create function pg_temp.snap_d() returns text
 language plpgsql as $c$
declare v text := ''; r record; n text;
begin
  for r in select unnest(array['job', 'job_stage', 'job_event', 'job_token', 'worker', 'worker_audit', 'worker_session', 'worker_rate_limit', 'job_counter', 'job_stage_def', 'job_record_profile', 'job_record_profile_stage',
                               'oem_quote', 'oem_quote_item', 'oem_receipt', 'oem_doc_counter', 'oem_quote_audit', 'production_order', 'production_order_item', 'production_order_counter', 'stock_lot', 'stock_lot_ledger']) as t loop
    if to_regclass('analytics.' || r.t) is not null then
      execute format('select count(*)::text || ''/'' || coalesce(md5(string_agg(x::text, ''|'' order by x::text)), '''') from analytics.%I x', r.t) into n;
      v := v || r.t || '=' || n || E'
';
    end if;
  end loop;
  return v;
end;
$c$;

-- ฉบับเดิม (0181) ของ job_worker_resolve = def จาก DB สด ก่อน apply 0182 · ใช้เทียบ golden ว่าใบไม่มีรูปได้ผลเดิมเป๊ะ
CREATE OR REPLACE FUNCTION pg_temp.resolve_legacy(p_token_hash text, p_session_hash text DEFAULT NULL::text, p_ip_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $leg$
declare
  v_a        jsonb;
  v_job      analytics.job%rowtype;
  v_worker   uuid;
  v_wcodes   text[];
  v_hold     analytics.job_stage%rowtype;
  v_pend     analytics.job_stage%rowtype;
  v_prev     analytics.job_stage%rowtype;
  v_action   text := 'none';
  v_seq      int;
  v_code     text;
  v_name     text;
  v_need_w   boolean := false;
  v_prev_w   numeric := null;
  v_holder   text := null;
  v_paid     numeric;
  v_stages   jsonb;
  v_workers  jsonb := '[]'::jsonb;
  v_started  boolean;
  v_sq       boolean;
  v_sw       boolean;
  v_multi    boolean;
  v_open_disc boolean;
  v_any_active boolean;
  v_can_ext  boolean := false;
  v_parts    jsonb := '[]'::jsonb;
  v_acts     jsonb := '[]'::jsonb;
  v_has_send boolean := false;
  p          analytics.job%rowtype;
  ph         analytics.job_stage%rowtype;
  pp         analytics.job_stage%rowtype;
  pv         analytics.job_stage%rowtype;
  v_lbl      text;
  v_fname    text;
  v_days     int;
  v_cancel   boolean;
  dr         record;
begin
  -- 0181
  v_a := analytics.job_worker_auth(p_token_hash, p_session_hash, p_ip_hash, false, false, 'none');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  select * into v_job from analytics.job where id = (v_a ->> 'job_id')::uuid;
  v_worker := nullif(v_a ->> 'worker_id', '')::uuid;

  select * into v_hold from analytics.job_stage where job_id = v_job.id and status = 'received' limit 1;
  select * into v_pend from analytics.job_stage where job_id = v_job.id and status = 'pending' order by seq limit 1;
  select exists (select 1 from analytics.job_stage where job_id = v_job.id and status in ('received', 'sent')) into v_started;
  if v_hold.id is not null then
    select coalesce(w.display_name, v_hold.assignee_name) into v_holder from (select 1) x left join analytics.worker w on w.id = v_hold.worker_id;
  end if;

  -- ต้นไม้: มีส่วนย่อย (ไม่ยกเลิก) หรือมีส่วนต่างรอชี้แจง = หลายส่วน · ใบเดี่ยวทั่วไปทั้งหมดเป็น false ⇒ ทางเดิมทุกบรรทัด
  select exists (select 1 from analytics.job_discrepancy d2 where d2.root_job_id = v_job.id and d2.status = 'open'
                    and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = d2.id)) into v_open_disc;
  select (v_open_disc or exists (select 1 from analytics.job c where c.parent_job_id = v_job.id and c.status <> 'cancelled')) into v_multi;
  select exists (select 1 from analytics.job j join analytics.job_stage s on s.job_id = j.id
                  where (j.id = v_job.id or j.parent_job_id = v_job.id) and j.status not in ('done', 'cancelled') and s.status in ('received', 'pending')) into v_any_active;

  if not (v_any_active or v_open_disc) then
    -- QA 5: ทุกขั้นส่งต่อ/ข้ามครบแล้วแต่ออฟฟิศยังไม่ปิดงาน — ไม่ใช่ "ให้ระบุตัว"
    v_action := 'all_done';
  elsif v_worker is null then
    v_action := 'identify';
    -- รายชื่อช่างที่ทำงานของต้นไม้นี้ได้ (ขั้นที่ถือค้าง/ขั้นที่รอรับของทุกส่วน + ผู้ส่งที่มีส่วนต่างรอชี้แจง) — เฉพาะ id + ชื่อ
    select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'display_name', w.display_name) order by w.display_name), '[]'::jsonb)
      into v_workers
      from analytics.worker w
     where w.shop_id = v_job.shop_id and w.is_active
       and (cardinality(w.stage_codes) = 0
            or exists (select 1 from analytics.job j join analytics.job_stage s on s.job_id = j.id
                        where (j.id = v_job.id or j.parent_job_id = v_job.id) and j.status not in ('done', 'cancelled')
                          and s.stage_code = any (w.stage_codes)
                          and (s.status = 'received'
                               or (s.status = 'pending' and s.seq = (select min(s2.seq) from analytics.job_stage s2 where s2.job_id = j.id and s2.status = 'pending'))))
            or exists (select 1 from analytics.job_discrepancy d3 join analytics.job_stage fs on fs.id = d3.from_stage_id
                        where d3.root_job_id = v_job.id and d3.status = 'open'
                          and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = d3.id)
                          and (fs.worker_id = w.id or w.can_external)));
  else
    select w.stage_codes, w.can_external into v_wcodes, v_can_ext from analytics.worker w where w.id = v_worker;
    if v_hold.id is not null and v_hold.worker_id = v_worker then
      v_action := 'send'; v_seq := v_hold.seq; v_code := v_hold.stage_code; v_need_w := v_hold.weigh_required;
    elsif v_pend.id is not null then
      v_seq := v_pend.seq; v_code := v_pend.stage_code; v_need_w := v_pend.weigh_required;
      if v_job.status = 'on_hold' then
        v_action := 'on_hold';
      elsif not analytics.job_worker_can_do(v_wcodes, v_pend.stage_code) then
        v_action := 'not_your_stage';
      elsif v_hold.id is not null and ((v_job.metal = 'gold' and v_job.profile_id is null) or v_hold.weigh_required or v_hold.qty_split_out > 0) then
        -- QA N1: ขั้นก่อนบังคับชั่ง (หรือใบทองเดิม) ยังไม่ส่งต่อ -> บอกตั้งแต่ resolve ไม่ใช่ให้กดแล้วไป fail · 0181: ขั้นก่อนที่แยกส่วนออกไปแล้วปิดอัตโนมัติไม่ได้ = ผู้ถือต้องส่งส่วนที่เหลือก่อน
        v_action := 'prev_not_sent';
      else
        v_action := 'receive';
        -- 0176 (D6): ด่านมัดจำใช้ helper เดียวกับ job_core_receive
        if analytics.job_deposit_blocked(v_job) then
          v_action := 'awaiting_deposit';
        end if;
        select * into v_prev from analytics.job_stage
         where job_id = v_job.id and seq < v_pend.seq and status <> 'skipped' order by seq desc limit 1;
        -- N1: งานทองไม่ส่งน้ำหนักขั้นก่อนให้ผู้รับ (ชั่งแบบไม่รู้คำตอบ) · เงิน/ทองเหลืองส่งตามเดิม
        v_prev_w := case when v_job.metal = 'gold' then null else v_prev.weight_out_g end;
      end if;
    elsif v_hold.id is not null then
      v_action := 'held_by_other'; v_seq := v_hold.seq; v_code := v_hold.stage_code;
    end if;

    -- 0181: parts[] + my_actions[] ทั้งต้นไม้ (เฉพาะช่างที่ระบุตัวแล้ว)
    for p in select j.* from analytics.job j where (j.id = v_job.id or j.parent_job_id = v_job.id) and j.status <> 'cancelled' order by j.lot_seq loop
      v_lbl := v_job.job_no || case when p.parent_job_id is null then '' else ' · ส่วนที่ ' || p.lot_seq end;
      select * into ph from analytics.job_stage where job_id = p.id and status = 'received' limit 1;
      select * into pp from analytics.job_stage where job_id = p.id and status = 'pending' order by seq limit 1;
      select d4.name_th into v_fname from analytics.job_stage_def d4 where d4.shop_id = p.shop_id and d4.code = coalesce(ph.stage_code, pp.stage_code);
      v_days := analytics.job_today() - coalesce(ph.received_on, (select max(s3.sent_on) from analytics.job_stage s3 where s3.job_id = p.id), analytics.job_bkk_date(p.created_at));
      v_cancel := p.parent_job_id is not null and analytics.job_lot_return_blocker(p.id) is null
                  and exists (select 1 from analytics.job_stage s4 join analytics.job_stage ms on ms.id = s4.split_from_stage_id
                               join analytics.job_event e on e.job_id = ms.job_id and e.event_type = 'split' and e.payload ->> 'lot_job_id' = p.id::text
                              where s4.job_id = p.id and e.worker_id = v_worker and ms.worker_id = v_worker);
      v_parts := v_parts || jsonb_build_object(
        'lot_job_id', p.id, 'label', v_lbl, 'lot_seq', p.lot_seq, 'status', p.status, 'qty_planned', p.qty_planned,
        'qty_live', analytics.job_live_qty(p.id), 'stage_code', coalesce(ph.stage_code, pp.stage_code), 'stage_name', v_fname,
        'holder_name', case when ph.id is null then null else (select coalesce(w2.display_name, ph.assignee_name) from (select 1) x2 left join analytics.worker w2 on w2.id = ph.worker_id) end,
        'days', v_days, 'is_mine', ph.id is not null and ph.worker_id = v_worker, 'can_cancel_split', v_cancel);
      if p.status = 'done' then
        continue;
      end if;
      if ph.id is not null and ph.worker_id = v_worker then
        v_has_send := true;
        v_acts := v_acts || jsonb_build_object('lot_job_id', p.id, 'label', v_lbl, 'action', 'send', 'stage_seq', ph.seq, 'stage_code', ph.stage_code,
          'stage_name', (select d5.name_th from analytics.job_stage_def d5 where d5.shop_id = p.shop_id and d5.code = ph.stage_code),
          'weight_required', ph.weigh_required, 'scrap_qty_ask', ph.scrap_qty_ask, 'scrap_weight_ask', ph.scrap_weight_ask,
          'qty_hold', ph.qty_in - ph.qty_scrap - ph.qty_split_out, 'qty_expected', null, 'discrepancy_id', null, 'qty', null);
      end if;
      if pp.id is not null and p.status <> 'on_hold'
         and analytics.job_worker_can_do(v_wcodes, pp.stage_code)
         and not (ph.id is not null and (ph.worker_id = v_worker or (p.metal = 'gold' and p.profile_id is null) or ph.weigh_required or ph.qty_split_out > 0))
         and not analytics.job_deposit_blocked(p) then
        select * into pv from analytics.job_stage where job_id = p.id and seq < pp.seq and status <> 'skipped' order by seq desc limit 1;
        v_acts := v_acts || jsonb_build_object('lot_job_id', p.id, 'label', v_lbl, 'action', 'receive', 'stage_seq', pp.seq, 'stage_code', pp.stage_code,
          'stage_name', (select d6.name_th from analytics.job_stage_def d6 where d6.shop_id = p.shop_id and d6.code = pp.stage_code),
          'weight_required', pp.weigh_required, 'scrap_qty_ask', pp.scrap_qty_ask, 'scrap_weight_ask', pp.scrap_weight_ask,
          'qty_hold', null,
          'qty_expected', case when pv.id is null then p.qty_planned
                               else (case when pv.status = 'received' then pv.qty_in else pv.qty_out end) - analytics.job_disc_active_qty(pv.id, pp.id) end,
          'discrepancy_id', null, 'qty', null);
      end if;
      for dr in select dd.id, dd.qty, (dd.weight_gap_g is not null and p.metal = 'gold') as office_only, fs.seq as f_seq, fs.stage_code as f_code
                 from analytics.job_discrepancy dd join analytics.job_stage fs on fs.id = dd.from_stage_id
                where dd.job_id = p.id and dd.status = 'open' and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = dd.id)
                  and (fs.worker_id = v_worker or v_can_ext)
                order by dd.created_at loop
        v_acts := v_acts || jsonb_build_object('lot_job_id', p.id, 'label', v_lbl, 'action', 'explain', 'stage_seq', dr.f_seq, 'stage_code', dr.f_code,
          'stage_name', (select d7.name_th from analytics.job_stage_def d7 where d7.shop_id = p.shop_id and d7.code = dr.f_code),
          'weight_required', false, 'scrap_qty_ask', false, 'scrap_weight_ask', false,
          'qty_hold', null, 'qty_expected', null, 'discrepancy_id', dr.id, 'qty', dr.qty, 'office_only', dr.office_only);
      end loop;
    end loop;
  end if;

  -- 0176: flag ถามของเสียของขั้นที่ action ชี้ (flag = ถาม ไม่ใช่ด่าน DB)
  if v_seq is not null then
    select s.scrap_qty_ask, s.scrap_weight_ask into v_sq, v_sw from analytics.job_stage s where s.job_id = v_job.id and s.seq = v_seq;
  end if;

  select d.name_th into v_name from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = v_code;

  select coalesce(jsonb_agg(
           jsonb_build_object('seq', s.seq, 'code', s.stage_code, 'name', d.name_th, 'status', s.status)
           || case when v_worker is not null then
                jsonb_build_object('received_on', s.received_on, 'sent_on', s.sent_on,
                                   'worker_name', coalesce(w.display_name, s.assignee_name), 'auto_closed', s.auto_closed)
              else '{}'::jsonb end
           order by s.seq), '[]'::jsonb)
    into v_stages
    from analytics.job_stage s
    join analytics.job_stage_def d on d.shop_id = s.shop_id and d.code = s.stage_code
    left join analytics.worker w on w.id = s.worker_id
   where s.job_id = v_job.id;

  return jsonb_build_object(
    'ok', true,
    'job', case when v_worker is null
             then jsonb_build_object('job_no', v_job.job_no, 'status', v_job.status, 'stages', v_stages, 'has_profile', v_job.profile_id is not null)
             else jsonb_build_object('job_no', v_job.job_no, 'status', v_job.status, 'design_label', v_job.design_label,
                                     'sku', v_job.sku_snapshot, 'metal', v_job.metal, 'qty_planned', v_job.qty_planned,
                                     'due_date', v_job.due_date, 'stages', v_stages,
                                     'profile_name', v_job.profile_name, 'has_profile', v_job.profile_id is not null) end,
    'viewer', case when v_worker is null then null
              else jsonb_build_object('worker_id', v_worker, 'display_name', v_a ->> 'worker_name') end,
    'session_expired', (v_a ->> 'session_expired')::boolean,
    'next_action', case when v_multi and v_worker is not null then 'multi' else v_action end,
    'action_stage', case when v_seq is null or (v_multi and v_worker is not null) then null
                      else jsonb_build_object('seq', v_seq, 'code', v_code, 'name', v_name, 'weight_required', v_need_w,
                                           'scrap_qty_ask', coalesce(v_sq, true), 'scrap_weight_ask', coalesce(v_sw, false)) end,
    'prev_weight_out_g', case when v_multi and v_worker is not null then null else v_prev_w end,
    -- L1: ชื่อผู้ถือเห็นได้เฉพาะช่างที่ระบุตัวแล้ว
    'held_by', case when v_worker is null then null else v_holder end,
    'workers', v_workers,
    'scrap_reasons', case when (v_action = 'send' and not v_multi) or (v_multi and v_has_send)
                          then to_jsonb(array['porosity', 'broken', 'wrong_design', 'missing', 'other']) else '[]'::jsonb end,
    'parts', case when v_worker is null then null else v_parts end,
    'my_actions', case when v_worker is null then null else v_acts end
  );
end;
$leg$;

-- ============================================================================
-- helper เฉพาะ 0182 — ทุกตัวที่เรียก RPC คืน jsonb {ok:true,...} หรือ {_err,_state,_hint} (pg_temp.q) · ตัวแถว/สถานะคืนค่าตรง
-- ============================================================================
create function pg_temp.pmd(p_shop uuid, p_job uuid, p_id uuid) returns text language sql as $c$ select p_shop::text || '/' || p_job::text || '/' || p_id::text || '_md.jpg' $c$;
create function pg_temp.psm(p_shop uuid, p_job uuid, p_id uuid) returns text language sql as $c$ select p_shop::text || '/' || p_job::text || '/' || p_id::text || '_sm.jpg' $c$;

-- เพิ่มรูป (ค่าเริ่ม: office · reference · 1000 bytes · id สุ่มใหม่ — path สร้างจาก id เสมอ)
create function pg_temp.padd(p_shop uuid, p_job uuid, p_id uuid default gen_random_uuid(), p_bytes int default 1000, p_caption text default null,
                             p_source text default 'office', p_pimg uuid default null, p_kind text default 'reference', p_w int default 1200, p_h int default 800) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_photo_add(p_shop_id=>%L, p_job_id=>%L, p_kind=>%L, p_source=>%L, p_storage_path=>%L, p_variant_sm_path=>%L, p_bytes=>%L, p_width=>%L, p_height=>%L, p_caption=>%L, p_product_image_id=>%L, p_actor=>%L)',
    p_shop, p_job, p_kind, p_source, pg_temp.pmd(p_shop, p_job, p_id), pg_temp.psm(p_shop, p_job, p_id), p_bytes, p_w, p_h, p_caption, p_pimg, pg_temp.act())) $c$;
-- path ตามที่ให้ (เคสห้ามผ่านของ path)
create function pg_temp.padd_raw(p_shop uuid, p_job uuid, p_md text, p_sm text) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_photo_add(p_shop_id=>%L, p_job_id=>%L, p_kind=>%L, p_source=>%L, p_storage_path=>%L, p_variant_sm_path=>%L, p_bytes=>%L, p_actor=>%L)',
    p_shop, p_job, 'reference', 'office', p_md, p_sm, 1000, pg_temp.act())) $c$;
create function pg_temp.prem(p_shop uuid, p_photo uuid, p_reason text default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.job_photo_remove(p_shop_id=>%L, p_photo_id=>%L, p_reason=>%L, p_actor=>%L)', p_shop, p_photo, p_reason, pg_temp.act())) $c$;
create function pg_temp.pprim(p_shop uuid, p_photo uuid) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.job_photo_set_primary(p_shop_id=>%L, p_photo_id=>%L, p_actor=>%L)', p_shop, p_photo, pg_temp.act())) $c$;
create function pg_temp.pord(p_shop uuid, p_job uuid, p_ids uuid[]) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.job_photo_reorder(p_shop_id=>%L, p_job_id=>%L, p_ids=>%L::uuid[], p_actor=>%L)', p_shop, p_job, p_ids, pg_temp.act())) $c$;
create function pg_temp.psrc(p_shop uuid, p_job uuid) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.job_photo_catalog_source(p_shop_id=>%L, p_job_id=>%L)', p_shop, p_job)) $c$;

-- รูป active ของใบ / รูปหลัก / รายการ id ตามลำดับแสดง / จำนวน event
create function pg_temp.nph(p_job uuid) returns int language sql as $c$ select count(*)::int from analytics.job_photo where job_id = p_job and deleted_at is null $c$;
create function pg_temp.nprim(p_job uuid) returns int language sql as $c$ select count(*)::int from analytics.job_photo where job_id = p_job and deleted_at is null and is_primary $c$;
create function pg_temp.prim(p_job uuid) returns uuid language sql as $c$ select id from analytics.job_photo where job_id = p_job and deleted_at is null and is_primary $c$;
create function pg_temp.order_of(p_job uuid) returns uuid[] language sql as $c$
  select coalesce(array_agg(id order by sort_order, created_at, id), '{}') from analytics.job_photo where job_id = p_job and deleted_at is null $c$;
create function pg_temp.nev(p_job uuid, p_type text) returns int language sql as $c$ select count(*)::int from analytics.job_event where job_id = p_job and event_type = p_type $c$;
create function pg_temp.ph(p_id uuid, p_col text) returns text language plpgsql as $c$
declare v text;
begin
  execute format('select %I::text from analytics.job_photo where id = %L', p_col, p_id) into v;
  return v;
end $c$;

-- ใบงานใหม่ (silver · แบบ "ไม่ชั่ง" · ยังไม่เริ่ม) — โคลนดีลจริงในทรานแซกชันที่ถอย
create function pg_temp.mkj(p_shop uuid, p_tpl uuid, p_qty int default 10) returns uuid
 language plpgsql as $c$
declare d jsonb;
begin
  d := pg_temp.mkp(p_shop, p_tpl, 'silver', pg_temp.pid(p_shop, 'none'), null, p_qty);
  if pg_temp.jid(d) is null then
    raise exception 'mkj: สร้างใบไม่ได้ %', d::text;
  end if;
  return pg_temp.jid(d);
end $c$;
-- ใบงานที่ตอนนี้ขั้น 4 ถูกถือ + แยกส่วนย่อย 4 ชิ้น -> {job, lot, tokh}
create function pg_temp.mklot(p_shop uuid, p_tpl uuid) returns jsonb
 language plpgsql as $c$
declare d jsonb; j uuid; r jsonb; r2 jsonb;
begin
  d := pg_temp.fx(p_shop, p_tpl, pg_temp.pid(p_shop, 'none'), 10, 3);
  j := pg_temp.jid(d);
  r := pg_temp.o_recv2(p_shop, j, 4);
  if r ? '_err' then raise exception 'mklot: รับขั้น 4 ไม่ได้ %', r::text; end if;
  r2 := pg_temp.o_split(p_shop, j, 4, 4);
  if r2 ? '_err' then raise exception 'mklot: แยกส่วนไม่ได้ %', r2::text; end if;
  return jsonb_build_object('job', j, 'lot', pg_temp.lot(r2), 'tokh', d ->> 'tokh');
end $c$;
-- ผูก SKU จริงที่ยังไม่มีรูปแคตตาล็อกกับใบ (ปิด job_guard ชั่วคราวในทรานแซกชันที่ถอย) -> product_id
create function pg_temp.mkprod(p_shop uuid, p_job uuid) returns uuid
 language plpgsql as $c$
declare v_p uuid;
begin
  select p.id into v_p from public.product p
   where p.shop_id = p_shop and not exists (select 1 from public.product_image i where i.product_id = p.id) order by p.id limit 1;
  if v_p is null then
    raise exception 'mkprod: ไม่มี SKU ที่ไม่มีรูปแคตตาล็อกให้ใช้ทดสอบ';
  end if;
  execute 'alter table analytics.job disable trigger trg_job_guard';
  update analytics.job set product_id = v_p where id = p_job;
  execute 'alter table analytics.job enable trigger trg_job_guard';
  return v_p;
end $c$;
-- รูปแคตตาล็อกปลอมของ SKU (แถวใน public.product_image เท่านั้น — ไม่มีไฟล์ใน Storage · ถอยกลับพร้อมทรานแซกชัน)
create function pg_temp.mkpi(p_shop uuid, p_prod uuid, p_sort int, p_id uuid default gen_random_uuid()) returns uuid
 language plpgsql as $c$
begin
  insert into public.product_image (id, shop_id, product_id, storage_path, variant_sm_path, sort_order, width, height, bytes)
  values (p_id, p_shop, p_prod, 'verify0182/' || p_id::text || '_md.jpg', 'verify0182/' || p_id::text || '_sm.jpg', p_sort, 1200, 800, 5000);
  return p_id;
end $c$;
-- INSERT ตรงของแถว stage (เคสเพดาน/budget เท่านั้น — RPC ไม่เปิดทางสร้าง) · ผ่าน trigger guard+cap เหมือนทุกทาง
create function pg_temp.dins(p_shop uuid, p_job uuid, p_stage uuid, p_worker uuid, p_bytes int) returns uuid
 language plpgsql as $c$
declare v_id uuid := gen_random_uuid();
begin
  insert into analytics.job_photo (id, shop_id, job_id, kind, job_stage_id, source, storage_path, variant_sm_path, bytes, worker_id)
  values (v_id, p_shop, p_job, 'stage', p_stage, 'shopfloor', pg_temp.pmd(p_shop, p_job, v_id), pg_temp.psm(p_shop, p_job, v_id), p_bytes, p_worker);
  return v_id;
end $c$;

-- ผลของ resolve ตัด job.photos ออก (เทียบกับฉบับเดิม)
create function pg_temp.strip_photos(r jsonb) returns jsonb
 language sql as $c$ select case when r ? 'job' and jsonb_typeof(r -> 'job') = 'object' then jsonb_set(r, '{job}', (r -> 'job') - 'photos') else r end $c$;
create function pg_temp.w_old(p_tokh text, p_sesh text default null, p_ip text default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select pg_temp.resolve_legacy(%L, %L, %L)', p_tokh, p_sesh, p_ip)) $c$;
create function pg_temp.keys(r jsonb) returns text language sql as $c$ select coalesce((select string_agg(k, ',' order by k) from jsonb_object_keys(r) k), '') $c$;

-- ภาพรวมสถานะที่ห้ามขยับหลังรัน (ใช้ snap เดิมของ 0181 + ตารางรูป + product_image + จำนวน object ใน bucket)
create function pg_temp.snapx_d() returns text
 language plpgsql as $c$
declare v text := pg_temp.snap_d(); n text;
begin
  select count(*)::text || '/' || coalesce(md5(string_agg(x::text, '|' order by x.id)), '') into n from analytics.job_photo x;
  v := v || 'job_photo=' || n || chr(10);
  select count(*)::text || '/' || coalesce(md5(string_agg(x::text, '|' order by x.id)), '') into n from public.product_image x;
  v := v || 'product_image=' || n || chr(10);
  select count(*)::text into n from storage.objects where bucket_id in ('job-photos', 'product-images');
  v := v || 'objects=' || n || chr(10);
  select count(*)::text || '/' || coalesce(md5(string_agg(x::text, '|' order by x.id)), '') into n from storage.buckets x;
  v := v || 'buckets=' || n || chr(10);
  select count(*)::text || '/' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '') into n from analytics.job_counter x;
  v := v || 'job_counter=' || n || chr(10);
  return v;
end $c$;
create function pg_temp.snapx() returns text language sql as $c$ select md5(pg_temp.snapx_d()) $c$;
-- ชื่อตารางที่ขยับเทียบกับ snapshot ก่อนหน้า
create function pg_temp.moved(p_before text) returns text language sql as $c$
  select coalesce((select string_agg(split_part(a, '=', 1), ',') from unnest(string_to_array(p_before, chr(10))) a
                    where a <> '' and not (a = any (string_to_array(pg_temp.snapx_d(), chr(10))))), '') $c$;

-- เหมือน pg_temp.x แต่แนบ hint (ตรวจว่าข้อความ/hint มาจากด่านไหน)
create function pg_temp.x2(p_sql text) returns text
 language plpgsql as $c$
declare v_msg text; v_state text; v_hint text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
  return 'ERR:' || v_state || ':' || coalesce(v_hint, '') || ':' || v_msg;
end $c$;

-- ============================================================================
-- Section A — เส้นทางปกติ: เพิ่มรูป · รูปหลักอัตโนมัติ · caption · event · ใบปิดแล้วแก้รูปได้ (มติ Q1)
-- ============================================================================
create function pg_temp.sa(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  j uuid; j0 uuid; jd uuid; d jsonb;
  r jsonb; r2 jsonb;
  id1 uuid := gen_random_uuid(); id2 uuid := gen_random_uuid(); id3 uuid := gen_random_uuid(); id4 uuid := gen_random_uuid();
  v_ev jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  j := pg_temp.mkj(p_shop, p_tpl);
  j0 := pg_temp.mkj(p_shop, p_tpl);

  r := pg_temp.padd(p_shop, j, id1, 1000, '  ด้านข้าง ');
  v_log := v_log || pg_temp.chk('A1', 'รูปแรกของใบ: ok · เป็นรูปหลักอัตโนมัติ · photo_id = uuid ใน path',
    (r ->> 'ok') = 'true' and (r ->> 'is_primary') = 'true' and (r ->> 'photo_id') = id1::text);
  v_log := v_log || pg_temp.chk('A2', 'แถวถูกเก็บ: ร้าน/ใบ/ชนิด reference/ที่มา office · bytes 1000 · sort 0 · caption ตัดช่องว่างแล้ว · ผู้อัปโหลด = actor · path ตายตัว · ยังไม่ลบ',
    (select p.shop_id = p_shop and p.job_id = j and p.kind = 'reference' and p.source = 'office' and p.bytes = 1000 and p.sort_order = 0 and p.is_primary
            and p.caption = 'ด้านข้าง' and p.uploaded_by = pg_temp.act() and p.worker_id is null and p.product_image_id is null
            and p.storage_path = pg_temp.pmd(p_shop, j, id1) and p.variant_sm_path = pg_temp.psm(p_shop, j, id1)
            and p.width = 1200 and p.height = 800 and p.deleted_at is null and p.job_stage_id is null
       from analytics.job_photo p where p.id = id1));
  select e.payload into v_ev from analytics.job_event e where e.job_id = j and e.event_type = 'photo_add';
  v_log := v_log || pg_temp.chk('A3', 'event photo_add 1 แถว · payload มีเฉพาะ photo_id/kind/source/bytes/product_image_id/is_primary · ไม่มี path/ชื่อไฟล์ · actor = ผู้ทำรายการ · ช่อง job_page',
    pg_temp.nev(j, 'photo_add') = 1 and pg_temp.keys(v_ev) = 'bytes,is_primary,kind,photo_id,product_image_id,source'
    and v_ev::text !~ '_md|_sm|jpg|storage' and (v_ev ->> 'photo_id') = id1::text
    and exists (select 1 from analytics.job_event e where e.job_id = j and e.event_type = 'photo_add' and e.actor = pg_temp.act() and e.channel = 'job_page' and e.worker_id is null));
  r2 := pg_temp.padd(p_shop, j, id2, 2000);
  v_log := v_log || pg_temp.chk('A4', 'รูปที่สอง: ไม่เป็นรูปหลัก · sort 1 · รูปหลักยังเป็นรูปแรก · มีรูปหลักพอดี 1',
    (r2 ->> 'ok') = 'true' and (r2 ->> 'is_primary') = 'false' and pg_temp.ph(id2, 'sort_order') = '1'
    and pg_temp.prim(j) = id1 and pg_temp.nprim(j) = 1);
  v_log := v_log || pg_temp.chk('A5', 'ใบที่ไม่มีรูป: 0 รูป · ไม่มีรูปหลัก (เทียบ A1-A4 ว่าไม่ปนข้ามใบ)', pg_temp.nph(j0) = 0 and pg_temp.nprim(j0) = 0);

  -- ลบเหลือ 0 แล้วเพิ่มใหม่ = เป็นรูปหลัก · sort_order ต่อจาก max ของรูปที่ยังไม่ลบ
  r := pg_temp.prem(p_shop, id2);
  r := pg_temp.prem(p_shop, id1);
  r2 := pg_temp.padd(p_shop, j, id3);
  v_log := v_log || pg_temp.chk('A6', 'ลบหมดแล้วเพิ่มใหม่: เป็นรูปหลัก · sort 0 (ไม่นับแถวที่ลบ) · active 1',
    (r2 ->> 'is_primary') = 'true' and pg_temp.ph(id3, 'sort_order') = '0' and pg_temp.nph(j) = 1);

  -- ใบ cancelled: เพิ่ม/ตั้งหลัก/เรียง/ลบ ได้ (มติเจ้าของ 19 ต.ค. — ทับ design §5)
  r := pg_temp.o_cancel(p_shop, j);
  v_log := v_log || pg_temp.chk('A7a', 'fixture: ใบถูกยกเลิก (ปิดแล้ว)', (r ->> 'ok') = 'true' and (select status from analytics.job where id = j) = 'cancelled');
  r := pg_temp.padd(p_shop, j, id4, 1500, 'หลังยกเลิก');
  v_log := v_log || pg_temp.chk('A7b', 'ใบ cancelled: เพิ่มรูปได้ (ไม่ใช่ job_closed) · ไม่ใช่รูปหลักเพราะมีหลักแล้ว', (r ->> 'ok') = 'true' and (r ->> 'is_primary') = 'false');
  r := pg_temp.pprim(p_shop, id4);
  v_log := v_log || pg_temp.chk('A7c', 'ใบ cancelled: ตั้งรูปหลักได้ · หลักเปลี่ยนเป็นรูปใหม่ · มีหลักพอดี 1', (r ->> 'ok') = 'true' and pg_temp.prim(j) = id4 and pg_temp.nprim(j) = 1);
  r := pg_temp.pord(p_shop, j, array[id3, id4]);
  v_log := v_log || pg_temp.chk('A7d', 'ใบ cancelled: เรียงรูปได้ · ลำดับตามที่ส่ง', (r ->> 'ok') = 'true' and pg_temp.order_of(j) = array[id3, id4]);
  r := pg_temp.prem(p_shop, id3, 'ลบหลังยกเลิก');
  v_log := v_log || pg_temp.chk('A7e', 'ใบ cancelled: ลบรูปได้ · เก็บ audit ใคร/เหตุผล · ไฟล์ที่ต้องลบถูกส่งกลับ',
    (r ->> 'ok') = 'true' and (r ->> 'storage_path') = pg_temp.pmd(p_shop, j, id3) and (r ->> 'variant_sm_path') = pg_temp.psm(p_shop, j, id3)
    and pg_temp.ph(id3, 'deleted_by') = pg_temp.act()::text and pg_temp.ph(id3, 'delete_reason') = 'ลบหลังยกเลิก');

  -- ใบ done: ทำครบทุกขั้นแล้วปิดงาน → แก้รูปได้เช่นกัน
  d := pg_temp.fx(p_shop, p_tpl, pg_temp.pid(p_shop, 'none'), 10, 8);
  jd := pg_temp.jid(d);
  r := pg_temp.o_done(p_shop, jd, 10, 0);
  v_log := v_log || pg_temp.chk('A8a', 'fixture: ใบปิดงานแล้ว (done)', (r ->> 'ok') = 'true' and (select status from analytics.job where id = jd) = 'done');
  r := pg_temp.padd(p_shop, jd);
  v_log := v_log || pg_temp.chk('A8b', 'ใบ done: เพิ่มรูปได้ · เป็นรูปหลัก (ใบยังไม่มีรูป)', (r ->> 'ok') = 'true' and (r ->> 'is_primary') = 'true');
  r2 := pg_temp.prem(p_shop, (r ->> 'photo_id')::uuid);
  v_log := v_log || pg_temp.chk('A8c', 'ใบ done: ลบรูปได้', (r2 ->> 'ok') = 'true' and pg_temp.nph(jd) = 0);
  return v_log;
end;
$s$;

-- ============================================================================
-- Section B — เคสห้ามผ่านที่ด่าน RPC (path · ขนาด · caption · ใบ · ที่มา · ลำดับ · ลบซ้ำ)
-- ============================================================================
create function pg_temp.sb(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  j uuid; j2 uuid; lt jsonb; lot uuid;
  r jsonb; n0 int; i int;
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid(); q1 uuid := gen_random_uuid(); dd uuid := gen_random_uuid();
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid(); uq uuid := gen_random_uuid(); ud uuid := gen_random_uuid();
  x uuid := gen_random_uuid(); oj uuid := gen_random_uuid(); osh uuid := gen_random_uuid();
  v_ids uuid[]; v_order uuid[]; v_ok boolean; v_cases text[];
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  j := pg_temp.mkj(p_shop, p_tpl);
  j2 := pg_temp.mkj(p_shop, p_tpl);

  -- B1 ขนาดไฟล์ (bytes ของ md · ขอบเขต 1..1048576 · int จึงไม่มี NaN/Infinity)
  n0 := pg_temp.nph(j);
  v_ok := true;
  foreach i in array array[0, -1, 1048577, 2147483647] loop
    v_ok := v_ok and pg_temp.rej(pg_temp.padd(p_shop, j, gen_random_uuid(), i), 'photo_bytes_invalid');
  end loop;
  v_ok := v_ok and pg_temp.rej(pg_temp.padd(p_shop, j, gen_random_uuid(), null), 'photo_bytes_invalid');
  v_log := v_log || pg_temp.chk('B1a', 'bytes = 0 / -1 / 1 MB+1 / int สูงสุด / null → 22023 photo_bytes_invalid · ไม่เกิดแถว', v_ok and pg_temp.nph(j) = n0);
  r := pg_temp.padd(p_shop, j, gen_random_uuid(), 1);
  v_log := v_log || pg_temp.chk('B1b', 'ต้องไม่พัง: ขอบล่าง 1 byte ผ่าน', (r ->> 'ok') = 'true');
  r := pg_temp.padd(p_shop, j, gen_random_uuid(), 1048576);
  v_log := v_log || pg_temp.chk('B1c', 'ต้องไม่พัง: ขอบบน 1,048,576 bytes (1 MB เป๊ะ) ผ่าน', (r ->> 'ok') = 'true');
  n0 := pg_temp.nph(j);
  v_ok := pg_temp.rej(pg_temp.padd(p_shop, j, gen_random_uuid(), 1000, null, 'office', null, 'reference', 0, 800), 'photo_dims_invalid')
      and pg_temp.rej(pg_temp.padd(p_shop, j, gen_random_uuid(), 1000, null, 'office', null, 'reference', 1200, -5), 'photo_dims_invalid')
      and pg_temp.rej(pg_temp.padd(p_shop, j, gen_random_uuid(), 1000, null, 'office', null, 'reference', 100001, 800), 'photo_dims_invalid');
  v_log := v_log || pg_temp.chk('B1d', 'กว้าง/สูง = 0 / ติดลบ / 100001 → photo_dims_invalid · ไม่เกิดแถว', v_ok and pg_temp.nph(j) = n0);

  -- B2 path ที่ไม่ตรงรูปแบบ/ข้ามใบ/ข้ามร้าน (client ไม่เคยส่ง path เอง — แต่ RPC ต้องไม่เชื่อ)
  n0 := pg_temp.nph(j);
  v_cases := array[]::text[];
  -- (md, sm) ที่ต้องถูกปฏิเสธทั้งหมด ·  shop/job ที่ถูกต้อง = p_shop/j
  for r in select value from jsonb_array_elements(jsonb_build_array(
      jsonb_build_object('n', 'a ใบอื่น', 'md', p_shop || '/' || oj || '/' || x || '_md.jpg', 'sm', p_shop || '/' || oj || '/' || x || '_sm.jpg'),
      jsonb_build_object('n', 'b ร้านอื่น', 'md', osh || '/' || j || '/' || x || '_md.jpg', 'sm', osh || '/' || j || '/' || x || '_sm.jpg'),
      jsonb_build_object('n', 'c uuid พิมพ์ใหญ่', 'md', p_shop || '/' || j || '/' || upper(x::text) || '_md.jpg', 'sm', p_shop || '/' || j || '/' || upper(x::text) || '_sm.jpg'),
      jsonb_build_object('n', 'd ไม่มี suffix', 'md', p_shop || '/' || j || '/' || x || '.jpg', 'sm', p_shop || '/' || j || '/' || x || '_sm.jpg'),
      jsonb_build_object('n', 'e traversal', 'md', p_shop || '/' || j || '/../' || x || '_md.jpg', 'sm', p_shop || '/' || j || '/../' || x || '_sm.jpg'),
      jsonb_build_object('n', 'f segment เกิน', 'md', p_shop || '/' || j || '/a/' || x || '_md.jpg', 'sm', p_shop || '/' || j || '/a/' || x || '_sm.jpg'),
      jsonb_build_object('n', 'g sm คนละ uuid', 'md', p_shop || '/' || j || '/' || x || '_md.jpg', 'sm', p_shop || '/' || j || '/' || oj || '_sm.jpg'),
      jsonb_build_object('n', 'h sm = md', 'md', p_shop || '/' || j || '/' || x || '_md.jpg', 'sm', p_shop || '/' || j || '/' || x || '_md.jpg'),
      jsonb_build_object('n', 'i sm นามสกุลผิด', 'md', p_shop || '/' || j || '/' || x || '_md.jpg', 'sm', p_shop || '/' || j || '/' || x || '_sm.png'),
      jsonb_build_object('n', 'j md นามสกุลผิด (svg)', 'md', p_shop || '/' || j || '/' || x || '_md.svg', 'sm', p_shop || '/' || j || '/' || x || '_sm.jpg'),
      jsonb_build_object('n', 'k ชื่อไฟล์เดิมของ client', 'md', p_shop || '/' || j || '/photo.jpg_md.jpg', 'sm', p_shop || '/' || j || '/photo.jpg_sm.jpg'),
      jsonb_build_object('n', 'l ขึ้นบรรทัดใหม่ท้าย', 'md', p_shop || '/' || j || '/' || x || E'_md.jpg\n', 'sm', p_shop || '/' || j || '/' || x || '_sm.jpg'),
      jsonb_build_object('n', 'm ว่าง', 'md', '', 'sm', ''))) loop
    if not pg_temp.rej(pg_temp.padd_raw(p_shop, j, r ->> 'md', r ->> 'sm'), 'photo_path_invalid') then
      v_cases := v_cases || (r ->> 'n');
    end if;
  end loop;
  v_log := v_log || pg_temp.chk('B2a', 'path ผิด 13 แบบ (ใบ/ร้านอื่น · พิมพ์ใหญ่ · ไม่มี suffix · traversal · segment เกิน · sm ไม่ตรง · นามสกุลผิด · ชื่อเดิม · \n · ว่าง) → photo_path_invalid ทุกข้อ ไม่เกิดแถว'
    || coalesce(' ล้ม: ' || array_to_string(v_cases, ','), ''), cardinality(v_cases) = 0 and pg_temp.nph(j) = n0);
  v_log := v_log || pg_temp.chk('B2b', 'path null (md หรือ sm) → photo_path_invalid',
    pg_temp.rej(pg_temp.q(format('select analytics.job_photo_add(%L, %L, ''reference'', ''office'', null, %L, 1000, null, null, null, null, %L)', p_shop, j, pg_temp.psm(p_shop, j, x), pg_temp.act())), 'photo_path_invalid')
    and pg_temp.rej(pg_temp.q(format('select analytics.job_photo_add(%L, %L, ''reference'', ''office'', %L, null, 1000, null, null, null, null, %L)', p_shop, j, pg_temp.pmd(p_shop, j, x), pg_temp.act())), 'photo_path_invalid'));
  -- ข้ามใบ: รูปจริงของใบ j2 เอา path ไปลงทะเบียนที่ใบ j
  r := pg_temp.padd(p_shop, j2, p1);
  v_log := v_log || pg_temp.chk('B2c', 'ข้ามใบ: นำ path ของรูปใบ j2 ไปลงทะเบียนกับใบ j → photo_path_invalid · รูปของ j2 ยังอยู่ครบ 1',
    pg_temp.rej(pg_temp.padd_raw(p_shop, j, pg_temp.pmd(p_shop, j2, p1), pg_temp.psm(p_shop, j2, p1)), 'photo_path_invalid') and pg_temp.nph(j2) = 1);
  r := pg_temp.padd(p_shop, j, p2);
  v_log := v_log || pg_temp.chk('B2d', 'path ซ้ำ: ลงทะเบียน id เดิมซ้ำ → 22023 photo_path_dup · ไม่เกิดแถวเพิ่ม',
    (r ->> 'ok') = 'true' and pg_temp.rej(pg_temp.padd(p_shop, j, p2), 'photo_path_dup') and (select count(*) from analytics.job_photo where id = p2) = 1);

  -- B3 ใบ/ร้าน
  v_log := v_log || pg_temp.chk('B3a', 'ใบไม่มีอยู่จริง / ร้านไม่ตรงกับใบ → job_not_found · null → 22023',
    pg_temp.rej(pg_temp.padd(p_shop, gen_random_uuid()), 'job_not_found') and pg_temp.rej(pg_temp.padd(gen_random_uuid(), j), 'job_not_found')
    and pg_temp.rej(pg_temp.padd(p_shop, null), null) and pg_temp.rej(pg_temp.padd(null, j), null));
  lt := pg_temp.mklot(p_shop, p_tpl);
  lot := (lt ->> 'lot')::uuid;
  n0 := (select count(*)::int from analytics.job_photo where job_id = lot);
  v_log := v_log || pg_temp.chk('B3b', 'ส่วนย่อย (parent_job_id ไม่ว่าง): เพิ่มรูป → lot_no_photo · ไม่เกิดแถว · ใบแม่ของมันยังเพิ่มได้',
    (select parent_job_id is not null from analytics.job where id = lot)
    and pg_temp.rej(pg_temp.padd(p_shop, lot), 'lot_no_photo') and (select count(*) from analytics.job_photo where job_id = lot) = n0
    and (pg_temp.padd(p_shop, (lt ->> 'job')::uuid) ->> 'ok') = 'true');

  -- B4 ชนิด/ที่มา
  n0 := pg_temp.nph(j);
  v_log := v_log || pg_temp.chk('B4a', 'kind = stage → photo_not_yet (ประตูปิดจน W2b) · kind อื่น/null → photo_kind_invalid',
    pg_temp.rej(pg_temp.padd(p_shop, j, gen_random_uuid(), 1000, null, 'office', null, 'stage'), 'photo_not_yet')
    and pg_temp.rej(pg_temp.padd(p_shop, j, gen_random_uuid(), 1000, null, 'office', null, 'other'), 'photo_kind_invalid')
    and pg_temp.rej(pg_temp.padd(p_shop, j, gen_random_uuid(), 1000, null, 'office', null, null), 'photo_kind_invalid') and pg_temp.nph(j) = n0);
  v_log := v_log || pg_temp.chk('B4b', 'source = shopfloor (ไม่มี worker ผ่านทางนี้) / ค่าอื่น / null → photo_source_invalid',
    pg_temp.rej(pg_temp.padd(p_shop, j, gen_random_uuid(), 1000, null, 'shopfloor'), 'photo_source_invalid')
    and pg_temp.rej(pg_temp.padd(p_shop, j, gen_random_uuid(), 1000, null, 'x'), 'photo_source_invalid')
    and pg_temp.rej(pg_temp.padd(p_shop, j, gen_random_uuid(), 1000, null, null), 'photo_source_invalid') and pg_temp.nph(j) = n0);
  v_log := v_log || pg_temp.chk('B4c', 'source = product แต่ไม่ส่ง/ส่ง product_image_id มั่ว · source = office แต่อ้างรูปแคตตาล็อก → photo_product_mismatch',
    pg_temp.rej(pg_temp.padd(p_shop, j, gen_random_uuid(), 1000, null, 'product', null), 'photo_product_mismatch')
    and pg_temp.rej(pg_temp.padd(p_shop, j, gen_random_uuid(), 1000, null, 'product', gen_random_uuid()), 'photo_product_mismatch')
    and pg_temp.rej(pg_temp.padd(p_shop, j, gen_random_uuid(), 1000, null, 'office', gen_random_uuid()), 'photo_product_mismatch') and pg_temp.nph(j) = n0);

  -- B5 caption: ล่องหน/bidi/ขึ้นบรรทัด/tab กลางข้อความ/ยาวเกิน → caption_invalid · ขอบ 60 ตัวผ่าน
  v_cases := array[]::text[];
  for i in 1 .. 5 loop
    if not pg_temp.rej(pg_temp.padd(p_shop, j, gen_random_uuid(), 1000,
         case i when 1 then E'a​b' when 2 then E'‮txt' when 3 then E'ab\ncd' when 4 then repeat('ก', 61) else E'a\tb' end), 'caption_invalid') then
      v_cases := v_cases || i::text;
    end if;
  end loop;
  v_log := v_log || pg_temp.chk('B5a', 'caption: ZWSP · RLO (bidi) · ขึ้นบรรทัดใหม่ · 61 ตัวอักษร · tab กลางข้อความ → caption_invalid ทุกข้อ ไม่เกิดแถว' || coalesce(' ล้ม: ' || array_to_string(v_cases, ','), ''),
    cardinality(v_cases) = 0 and pg_temp.nph(j) = n0);
  r := pg_temp.padd(p_shop, j, gen_random_uuid(), 1000, repeat('ก', 60));
  v_log := v_log || pg_temp.chk('B5b', 'ต้องไม่พัง: caption 60 ตัวพอดี ผ่าน · caption ว่าง/ช่องว่างล้วน = ไม่มี caption (null) ไม่ใช่ error',
    (r ->> 'ok') = 'true' and (pg_temp.ph((r ->> 'photo_id')::uuid, 'caption') = repeat('ก', 60))
    and pg_temp.ph((pg_temp.padd(p_shop, j, gen_random_uuid(), 1000, '   ') ->> 'photo_id')::uuid, 'caption') is null);

  -- B6 เรียงรูป: ชุด id ต้องเท่ากับรูป active เป๊ะ
  j := pg_temp.mkj(p_shop, p_tpl);
  r := pg_temp.padd(p_shop, j, u1); r := pg_temp.padd(p_shop, j, u2); r := pg_temp.padd(p_shop, j, u3);
  r := pg_temp.padd(p_shop, j, ud); r := pg_temp.prem(p_shop, ud);
  r := pg_temp.padd(p_shop, j2, uq);
  v_order := pg_temp.order_of(j);
  v_ok := true; v_cases := array[]::text[];
  for i in 1 .. 9 loop
    r := pg_temp.pord(p_shop, j, case i
        when 1 then array[u1, u2]                       -- ขาด
        when 2 then array[u1, u1, u2, u3]               -- ซ้ำ
        when 3 then array[u1, u2, u3, uq]               -- มีของใบอื่น
        when 4 then array[u1, u2, u3, ud]               -- มีรูปที่ลบแล้ว
        when 5 then array[]::uuid[]                     -- ว่าง
        when 6 then null::uuid[]                        -- null ทั้งก้อน
        when 7 then array[u1, u2, u3, null]::uuid[]     -- มี null
        when 8 then array(select gen_random_uuid() from generate_series(1, 21))  -- เกิน 20
        else array[u1, u2, gen_random_uuid()] end);     -- ของมั่ว
    if not pg_temp.rej(r, 'photo_set_mismatch') then v_cases := v_cases || i::text; end if;
  end loop;
  v_log := v_log || pg_temp.chk('B6a', 'reorder ชุด id ผิด 9 แบบ (ขาด · ซ้ำ · ของใบอื่น · รูปที่ลบแล้ว · ว่าง · null · element null · >20 · มั่ว) → photo_set_mismatch · ลำดับเดิมไม่ขยับ' || coalesce(' ล้ม: ' || array_to_string(v_cases, ','), ''),
    cardinality(v_cases) = 0 and pg_temp.order_of(j) = v_order);
  v_log := v_log || pg_temp.chk('B6b', 'reorder ใบอื่น/ส่วนย่อย: ใช้ id ของ j กับใบ j2 → photo_set_mismatch · ส่วนย่อย → lot_no_photo',
    pg_temp.rej(pg_temp.pord(p_shop, j2, array[u1, u2, u3]), 'photo_set_mismatch') and pg_temp.rej(pg_temp.pord(p_shop, lot, array[u1]), 'lot_no_photo'));
  r := pg_temp.pord(p_shop, j, array[u3, u1, u2]);
  v_log := v_log || pg_temp.chk('B6c', 'ต้องไม่พัง: reorder ชุดครบถูกต้อง ผ่าน · ลำดับตามที่ส่ง · รูปหลักยังเป็นเดิม', (r ->> 'ok') = 'true' and pg_temp.order_of(j) = array[u3, u1, u2] and pg_temp.prim(j) = u1);

  -- B7 ลบ/ตั้งหลักซ้ำหรือผิดที่
  r := pg_temp.prem(p_shop, u3);
  v_log := v_log || pg_temp.chk('B7a', 'ลบซ้ำ → already_deleted (ไม่ no-op เงียบ) · ตั้งหลักรูปที่ลบแล้ว → already_deleted · รูปไม่มี/ร้านไม่ตรง → photo_not_found',
    pg_temp.rej(pg_temp.prem(p_shop, u3), 'already_deleted') and pg_temp.rej(pg_temp.pprim(p_shop, u3), 'already_deleted')
    and pg_temp.rej(pg_temp.prem(p_shop, gen_random_uuid()), 'photo_not_found') and pg_temp.rej(pg_temp.pprim(p_shop, gen_random_uuid()), 'photo_not_found')
    and pg_temp.rej(pg_temp.prem(gen_random_uuid(), u1), 'photo_not_found') and pg_temp.rej(pg_temp.pprim(gen_random_uuid(), u1), 'photo_not_found')
    and pg_temp.nph(j) = 2);
  v_log := v_log || pg_temp.chk('B7b', 'เหตุผลลบมีอักขระล่องหน/ยาวเกิน 300 → 22023 · รูปไม่ถูกลบ',
    pg_temp.rej(pg_temp.prem(p_shop, u1, E'a​b'), null) and pg_temp.rej(pg_temp.prem(p_shop, u1, repeat('ก', 301)), null) and pg_temp.nph(j) = 2);
  return v_log;
end;
$s$;

-- ============================================================================
-- Section C — เพดานรูปต่อใบ (5 reference · 20 รวม) และ budget ร้าน (250 MB) — บังคับที่ trigger
-- ============================================================================
create function pg_temp.sc(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  j uuid; j2 uuid; j3 uuid; w uuid; st uuid;
  r jsonb; i int; ids uuid[];
  v_used bigint; v_left bigint; v_n int; v_x text;
  v_limit constant bigint := 250::bigint * 1024 * 1024;
  rj record;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  j := pg_temp.mkj(p_shop, p_tpl);
  j2 := pg_temp.mkj(p_shop, p_tpl);
  ids := array[]::uuid[];
  for i in 1 .. 5 loop
    r := pg_temp.padd(p_shop, j);
    ids := ids || (r ->> 'photo_id')::uuid;
  end loop;
  v_log := v_log || pg_temp.chk('C1a', 'ต้องไม่พัง: รูป reference รูปที่ 5 ผ่าน (เพดาน = 5)', pg_temp.nph(j) = 5 and (r ->> 'ok') = 'true');
  r := pg_temp.padd(p_shop, j);
  v_log := v_log || pg_temp.chk('C1b', 'รูป reference รูปที่ 6 → P0001 photo_cap_ref · ไม่เกิดแถว',
    (r ->> '_state') = 'P0001' and (r ->> '_hint') = 'photo_cap_ref' and pg_temp.nph(j) = 5);
  r := pg_temp.padd(p_shop, j2);
  v_log := v_log || pg_temp.chk('C1c', 'เพดานนับต่อใบ: ใบอื่นยังเพิ่มได้ตามปกติ', (r ->> 'ok') = 'true');
  r := pg_temp.prem(p_shop, ids[5]);
  r := pg_temp.padd(p_shop, j);
  v_log := v_log || pg_temp.chk('C1d', 'เพดานนับเฉพาะรูปที่ยังไม่ลบ: ลบ 1 แล้วเพิ่มได้อีก 1 · ครบ 5 อีกครั้ง', (r ->> 'ok') = 'true' and pg_temp.nph(j) = 5);

  -- เพดานรวม 20: reference 3 + stage 16 (INSERT ตรง — RPC ยังไม่เปิดทางสร้างรูปต่อขั้น) = 19 → reference #4 = 20 ผ่าน · #5 → P0002
  w := pg_temp.wid(p_shop, 'vfy-ช่างรูป-C', '4829');
  j3 := pg_temp.mkj(p_shop, p_tpl);
  st := pg_temp.sid(j3, 1);
  for i in 1 .. 3 loop r := pg_temp.padd(p_shop, j3); end loop;
  for i in 1 .. 16 loop v_x := pg_temp.dins(p_shop, j3, st, w, 1000)::text; end loop;
  v_log := v_log || pg_temp.chk('C2a', 'fixture: ใบมี 19 รูป (reference 3 + stage 16)', pg_temp.nph(j3) = 19);
  r := pg_temp.padd(p_shop, j3);
  v_log := v_log || pg_temp.chk('C2b', 'ต้องไม่พัง: รูปที่ 20 (รวม) ผ่าน', (r ->> 'ok') = 'true' and pg_temp.nph(j3) = 20);
  r := pg_temp.padd(p_shop, j3);
  v_log := v_log || pg_temp.chk('C2c', 'รูปที่ 21 (รวม) ทั้งที่ reference เพิ่ง 4 → P0002 photo_cap_total · ไม่เกิดแถว',
    (r ->> '_state') = 'P0002' and (r ->> '_hint') = 'photo_cap_total' and pg_temp.nph(j3) = 20);
  v_log := v_log || pg_temp.chk('C2d', 'INSERT ตรงของแถว stage รูปที่ 21 ก็ถูกด่านเดียวกันตัด (service key เลี่ยงไม่ได้)',
    pg_temp.x(format('select pg_temp.dins(%L, %L, %L, %L, 1000)', p_shop, j3, st, w)) like 'ERR:P0002:%');

  -- budget ร้าน 250 MB: เติมด้วยแถว stage ขนาด 1 MB กระจายไปหลายใบ (ถอยกลับทั้งหมด) จนเหลือที่ว่างพอดี 1 MB
  select coalesce(sum(bytes), 0) into v_used from analytics.job_photo where shop_id = p_shop and deleted_at is null;
  v_left := v_limit - v_used;
  for rj in select jj.id as job_id, (select s.id from analytics.job_stage s where s.job_id = jj.id order by s.seq limit 1) as stage_id
              from analytics.job jj where jj.shop_id = p_shop and jj.parent_job_id is null and jj.id not in (j, j2, j3) order by jj.id loop
    exit when v_left <= 1048576;
    for i in 1 .. 15 loop
      exit when v_left <= 1048576;
      if v_left > 2 * 1048576 then
        v_x := pg_temp.dins(p_shop, rj.job_id, rj.stage_id, w, 1048576)::text;
        v_left := v_left - 1048576;
      else
        v_x := pg_temp.dins(p_shop, rj.job_id, rj.stage_id, w, (v_left - 1048576)::int)::text;
        v_left := 1048576;
      end if;
    end loop;
  end loop;
  select coalesce(sum(bytes), 0) into v_used from analytics.job_photo where shop_id = p_shop and deleted_at is null;
  v_log := v_log || pg_temp.chk('C3a', 'fixture: ที่ว่างเหลือพอดี 1 MB (1,048,576 bytes) ก่อนชนเพดาน 250 MB', v_limit - v_used = 1048576);
  r := pg_temp.padd(p_shop, j2, gen_random_uuid(), 1048577);
  v_log := v_log || pg_temp.chk('C3b', 'ขนาดเกิน 1 MB ถูกด่านขนาดตัดก่อน (ไม่ใช่ budget) — photo_bytes_invalid', pg_temp.rej(r, 'photo_bytes_invalid'));
  r := pg_temp.padd(p_shop, j2, gen_random_uuid(), 1048576);
  v_log := v_log || pg_temp.chk('C3c', 'ต้องไม่พัง: เติมเต็ม 250 MB พอดี (รวม = เพดาน) ยังผ่าน · ไม่ใช่ "มากกว่า"', (r ->> 'ok') = 'true');
  r := pg_temp.padd(p_shop, j2, gen_random_uuid(), 1);
  v_log := v_log || pg_temp.chk('C3d', 'เกินเพดาน 1 byte → P0003 photo_budget · ไม่เกิดแถว',
    (r ->> '_state') = 'P0003' and (r ->> '_hint') = 'photo_budget' and (select coalesce(sum(bytes), 0) from analytics.job_photo where shop_id = p_shop and deleted_at is null) = v_limit);
  r := pg_temp.prem(p_shop, (select p.id from analytics.job_photo p where p.job_id = j2 and p.bytes = 1048576 and p.deleted_at is null limit 1));
  r := pg_temp.padd(p_shop, j2, gen_random_uuid(), 1000);
  v_log := v_log || pg_temp.chk('C3e', 'ต้องไม่พัง: ลบรูปแล้วพื้นที่คืน (budget นับเฉพาะรูปที่ยังไม่ลบ) — เพิ่มได้อีก', (r ->> 'ok') = 'true');
  return v_log;
end;
$s$;

-- ============================================================================
-- Section D — เขียนตารางตรง (service key / owner) ต้องไม่ข้าม RPC: guard · CHECK · unique · truncate
-- ============================================================================
create function pg_temp.sd(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  j uuid; lt jsonb; lot uuid; w uuid;
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid();
  r jsonb; v_x text; v_col text; v_bad text := ''; v_new uuid := gen_random_uuid();
  v_pn uuid := gen_random_uuid(); v_t text; v_n int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  j := pg_temp.mkj(p_shop, p_tpl);
  r := pg_temp.padd(p_shop, j, p1); r := pg_temp.padd(p_shop, j, p2, 2000, 'ป้าย'); r := pg_temp.padd(p_shop, j, p3);
  r := pg_temp.prem(p_shop, p3, 'ลบแล้ว');
  w := pg_temp.wid(p_shop, 'vfy-ช่างรูป-D', '4829');

  v_log := v_log || pg_temp.chk('D1', 'รูปหลัก 2 แถวต่อใบ: UPDATE is_primary = true ใส่รูปที่ 2 ทั้งที่มีหลักอยู่ → 23505 (partial unique) · ยังมีหลักพอดี 1',
    pg_temp.x(format('update analytics.job_photo set is_primary = true where id = %L', p2)) like 'ERR:23505:%' and pg_temp.nprim(j) = 1);
  -- ฟิลด์ตัวตน/ไฟล์แก้ไม่ได้ (guard 42501) — ทดสอบทีละคอลัมน์
  for v_col in select unnest(array['bytes = 999', 'width = 10', 'height = 10', 'kind = ''stage''', 'source = ''product''',
        'storage_path = ''x/y''', 'variant_sm_path = ''x/y''', 'job_id = gen_random_uuid()', 'shop_id = gen_random_uuid()',
        'uploaded_by = gen_random_uuid()', 'created_at = now() - interval ''1 day''', 'id = gen_random_uuid()', 'worker_id = ' || quote_literal(w)]) loop
    v_x := pg_temp.x(format('update analytics.job_photo set %s where id = %L', v_col, p2));
    if v_x not like 'ERR:42501:%' then v_bad := v_bad || v_col || ' → ' || left(v_x, 40) || ' ; '; end if;
  end loop;
  v_log := v_log || pg_temp.chk('D2', 'UPDATE ฟิลด์ตัวตน/ไฟล์ 13 คอลัมน์ (bytes · width · height · kind · source · path ×2 · job_id · shop_id · uploaded_by · created_at · id · worker_id) → 42501 ทุกตัว ' || v_bad, v_bad = '');
  -- ต้องคำนวณแยกก่อน: TRUNCATE ในนิพจน์เดียวกับ subselect ที่เปิดตารางอยู่ = 55006 (ใช้งานอยู่ใน session) ไม่ใช่ 42501 ของ trigger
  v_x := pg_temp.x(format('delete from analytics.job_photo where id = %L', p2));
  v_t := pg_temp.x('truncate analytics.job_photo');
  v_n := (select count(*)::int from analytics.job_photo where job_id = j);
  v_log := v_log || pg_temp.chk('D3a', 'DELETE แถว → 42501 (แถวคือหลักฐาน) · TRUNCATE → 42501 · แถวยังอยู่ครบ', v_x like 'ERR:42501:%' and v_t like 'ERR:42501:%' and v_n = 3);
  v_log := v_log || pg_temp.chk('D3b', 'DELETE แถวที่ soft-delete แล้ว → 42501 เช่นกัน', pg_temp.x(format('delete from analytics.job_photo where id = %L', p3)) like 'ERR:42501:%');

  -- INSERT ตรง
  v_log := v_log || pg_temp.chk('D4a', 'INSERT ตรง path ไม่ตรง id/ร้าน/ใบ (CHECK job_photo_path_ck) → 23514',
    pg_temp.x(format('insert into analytics.job_photo (id, shop_id, job_id, kind, source, storage_path, variant_sm_path, bytes, uploaded_by) values (%L, %L, %L, ''reference'', ''office'', %L, %L, 1000, %L)',
      v_new, p_shop, j, p_shop || '/' || j || '/' || p1 || '_md.jpg', pg_temp.psm(p_shop, j, v_new), pg_temp.act())) like 'ERR:23514:%'
    and pg_temp.x(format('insert into analytics.job_photo (id, shop_id, job_id, kind, source, storage_path, variant_sm_path, bytes, uploaded_by) values (%L, %L, %L, ''reference'', ''office'', %L, %L, 1000, %L)',
      v_new, p_shop, j, 'anything/else_md.jpg', 'anything/else_sm.jpg', pg_temp.act())) like 'ERR:23514:%');
  v_log := v_log || pg_temp.chk('D4b', 'INSERT ตรง: source office ไม่มี uploaded_by · shopfloor ไม่มี worker · bytes 0 · kind stage ไม่มี job_stage_id → 23514',
    pg_temp.x(format('insert into analytics.job_photo (id, shop_id, job_id, kind, source, storage_path, variant_sm_path, bytes) values (%L, %L, %L, ''reference'', ''office'', %L, %L, 1000)',
      v_new, p_shop, j, pg_temp.pmd(p_shop, j, v_new), pg_temp.psm(p_shop, j, v_new))) like 'ERR:23514:%'
    and pg_temp.x(format('insert into analytics.job_photo (id, shop_id, job_id, kind, source, storage_path, variant_sm_path, bytes, uploaded_by) values (%L, %L, %L, ''reference'', ''shopfloor'', %L, %L, 1000, %L)',
      v_new, p_shop, j, pg_temp.pmd(p_shop, j, v_new), pg_temp.psm(p_shop, j, v_new), pg_temp.act())) like 'ERR:23514:%'
    and pg_temp.x(format('insert into analytics.job_photo (id, shop_id, job_id, kind, source, storage_path, variant_sm_path, bytes, uploaded_by) values (%L, %L, %L, ''reference'', ''office'', %L, %L, 0, %L)',
      v_new, p_shop, j, pg_temp.pmd(p_shop, j, v_new), pg_temp.psm(p_shop, j, v_new), pg_temp.act())) like 'ERR:23514:%'
    and pg_temp.x(format('insert into analytics.job_photo (id, shop_id, job_id, kind, source, storage_path, variant_sm_path, bytes, uploaded_by) values (%L, %L, %L, ''stage'', ''office'', %L, %L, 1000, %L)',
      v_new, p_shop, j, pg_temp.pmd(p_shop, j, v_new), pg_temp.psm(p_shop, j, v_new), pg_temp.act())) like 'ERR:23514:%');
  v_log := v_log || pg_temp.chk('D4c', 'INSERT ตรงเป็นรูปหลักซ้ำ (ใบมีหลักอยู่แล้ว) → 23505 · INSERT ตรงทั้งที่ตั้ง deleted_at → already_deleted',
    pg_temp.x(format('insert into analytics.job_photo (id, shop_id, job_id, kind, source, storage_path, variant_sm_path, bytes, uploaded_by, is_primary) values (%L, %L, %L, ''reference'', ''office'', %L, %L, 1000, %L, true)',
      v_new, p_shop, j, pg_temp.pmd(p_shop, j, v_new), pg_temp.psm(p_shop, j, v_new), pg_temp.act())) like 'ERR:23505:%'
    and pg_temp.x(format('insert into analytics.job_photo (id, shop_id, job_id, kind, source, storage_path, variant_sm_path, bytes, uploaded_by, deleted_at, deleted_by) values (%L, %L, %L, ''reference'', ''office'', %L, %L, 1000, %L, now(), %L)',
      v_new, p_shop, j, pg_temp.pmd(p_shop, j, v_new), pg_temp.psm(p_shop, j, v_new), pg_temp.act(), pg_temp.act())) like 'ERR:22023:%');
  lt := pg_temp.mklot(p_shop, p_tpl);
  lot := (lt ->> 'lot')::uuid;
  v_log := v_log || pg_temp.chk('D5', 'INSERT ตรงเข้าส่วนย่อย → 22023 lot_no_photo · ใบของร้านอื่น (shop_id ไม่ตรงใบ) → 22023 job_not_found',
    pg_temp.x(format('insert into analytics.job_photo (id, shop_id, job_id, kind, source, storage_path, variant_sm_path, bytes, uploaded_by) values (%L, %L, %L, ''reference'', ''office'', %L, %L, 1000, %L)',
      v_new, p_shop, lot, pg_temp.pmd(p_shop, lot, v_new), pg_temp.psm(p_shop, lot, v_new), pg_temp.act())) like 'ERR:22023:%'
    and pg_temp.x(format('insert into analytics.job_photo (id, shop_id, job_id, kind, source, storage_path, variant_sm_path, bytes, uploaded_by) values (%L, %L, %L, ''reference'', ''office'', %L, %L, 1000, %L)',
      v_new, gen_random_uuid(), j, pg_temp.pmd(p_shop, j, v_new), pg_temp.psm(p_shop, j, v_new), pg_temp.act())) like 'ERR:22023:%'
    and (select count(*) from analytics.job_photo where job_id = lot) = 0);
  v_log := v_log || pg_temp.chk('D5b', 'ข้อความ lot_no_photo มาจาก trigger (hint) ไม่ใช่แค่ CHECK',
    coalesce((select e like '%lot_no_photo%' from (select pg_temp.x2(format('insert into analytics.job_photo (id, shop_id, job_id, kind, source, storage_path, variant_sm_path, bytes, uploaded_by) values (%L, %L, %L, ''reference'', ''office'', %L, %L, 1000, %L)',
      v_pn, p_shop, lot, pg_temp.pmd(p_shop, lot, v_pn), pg_temp.psm(p_shop, lot, v_pn), pg_temp.act())) as e) t), false));

  -- caption/เหตุผลที่ลบ แก้ตรงต้องผ่านรูปแบบ · แถวที่ลบแล้วแก้ไม่ได้ · product_image_id เปลี่ยนเป็นค่าอื่นไม่ได้
  v_log := v_log || pg_temp.chk('D6', 'UPDATE caption เป็น "" / ZWSP / ขึ้นบรรทัดใหม่ / ช่องว่างหัวท้าย → ปฏิเสธ · caption ปกติผ่าน',
    pg_temp.x(format('update analytics.job_photo set caption = '''' where id = %L', p2)) like 'ERR:%'
    and pg_temp.x(format('update analytics.job_photo set caption = %L where id = %L', E'a​b', p2)) like 'ERR:%'
    and pg_temp.x(format('update analytics.job_photo set caption = %L where id = %L', E'a\nb', p2)) like 'ERR:%'
    and pg_temp.x(format('update analytics.job_photo set caption = %L where id = %L', ' x ', p2)) like 'ERR:%'
    and pg_temp.x(format('update analytics.job_photo set caption = %L where id = %L', 'ใหม่', p2)) = 'OK' and pg_temp.ph(p2, 'caption') = 'ใหม่');
  v_log := v_log || pg_temp.chk('D7', 'แถวที่ลบแล้ว (soft delete): แก้ caption / ตั้ง is_primary / ล้างการลบ → already_deleted ทั้งหมด',
    pg_temp.x(format('update analytics.job_photo set caption = ''x'' where id = %L', p3)) like 'ERR:22023:%'
    and pg_temp.x(format('update analytics.job_photo set deleted_at = null, deleted_by = null where id = %L', p3)) like 'ERR:22023:%'
    and pg_temp.x(format('update analytics.job_photo set sort_order = 9 where id = %L', p3)) like 'ERR:22023:%'
    and pg_temp.ph(p3, 'deleted_at') is not null);
  v_log := v_log || pg_temp.chk('D8', 'product_image_id: เปลี่ยนเป็น uuid อื่นไม่ได้ (42501) · ตั้งเป็น null ได้ (เส้นทางของ FK on delete set null)',
    pg_temp.x(format('update analytics.job_photo set product_image_id = gen_random_uuid() where id = %L', p2)) like 'ERR:%'
    and pg_temp.x(format('update analytics.job_photo set product_image_id = null where id = %L', p2)) = 'OK');
  return v_log;
end;
$s$;

-- ============================================================================
-- Section E — ดึงรูปจากแคตตาล็อก (copy ไม่ใช่ link) · ห้ามเขียนกลับ catalog · ลบรูปแคตตาล็อกต้องไม่พัง
-- ============================================================================
create function pg_temp.se(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  j uuid; j2 uuid; j3 uuid; lt jsonb; lot uuid;
  prod uuid; prod2 uuid; prod3 uuid;
  pi1 uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffff'; pi2 uuid := '00000000-0000-4000-8000-000000000001'; pi_o uuid;
  r jsonb; r2 jsonb; ph1 uuid; v_pi0 text; v_obj0 bigint; v_x text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  j := pg_temp.mkj(p_shop, p_tpl);
  j2 := pg_temp.mkj(p_shop, p_tpl);
  j3 := pg_temp.mkj(p_shop, p_tpl);

  r := pg_temp.psrc(p_shop, j);
  v_log := v_log || pg_temp.chk('E1', 'ใบที่ไม่ผูก SKU (product_id null) → found false · reason no_product (ไม่ใช่ error)',
    (r ->> 'ok') = 'true' and (r ->> 'found') = 'false' and (r ->> 'reason') = 'no_product' and (select product_id is null from analytics.job where id = j));
  prod := pg_temp.mkprod(p_shop, j);
  r := pg_temp.psrc(p_shop, j);
  v_log := v_log || pg_temp.chk('E2', 'SKU ที่ไม่มีรูปแคตตาล็อก → found false · reason no_catalog_image', (r ->> 'found') = 'false' and (r ->> 'reason') = 'no_catalog_image');

  -- รูปแคตตาล็อก 2 รูป: ลำดับตาม sort_order (ไม่ใช่ id) — pi1 มี id มากสุดแต่ sort_order 0 · pi2 id น้อยสุดแต่ sort_order 1
  perform pg_temp.mkpi(p_shop, prod, 0, pi1);
  perform pg_temp.mkpi(p_shop, prod, 1, pi2);
  prod2 := (select p.id from public.product p where p.shop_id = p_shop and p.id <> prod and not exists (select 1 from public.product_image i where i.product_id = p.id) order by p.id limit 1);
  pi_o := pg_temp.mkpi(p_shop, prod2, 0);
  select count(*)::text || '/' || coalesce(md5(string_agg(x::text, '|' order by x.id)), '') into v_pi0 from public.product_image x;
  select count(*) into v_obj0 from storage.objects where bucket_id = 'product-images';
  r := pg_temp.psrc(p_shop, j);
  v_log := v_log || pg_temp.chk('E3', 'ได้รูปหลักของ SKU ตาม (sort_order, created_at, id): product_image_id = รูป sort_order 0 · path/bytes/ขนาดตรงแถวจริง',
    (r ->> 'found') = 'true' and (r ->> 'product_image_id') = pi1::text and (r ->> 'md_path') = 'verify0182/' || pi1 || '_md.jpg'
    and (r ->> 'sm_path') = 'verify0182/' || pi1 || '_sm.jpg' and (r ->> 'bytes') = '5000' and (r ->> 'width') = '1200' and (r ->> 'height') = '800');

  r := pg_temp.padd(p_shop, j, gen_random_uuid(), 5000, null, 'product', pi1);
  ph1 := (r ->> 'photo_id')::uuid;
  v_log := v_log || pg_temp.chk('E4a', 'เพิ่มรูป source product + product_image_id ถูกต้อง → ok · เป็นรูปหลัก · แถวเก็บ provenance',
    (r ->> 'ok') = 'true' and (r ->> 'is_primary') = 'true' and pg_temp.ph(ph1, 'source') = 'product' and pg_temp.ph(ph1, 'product_image_id') = pi1::text);
  v_log := v_log || pg_temp.chk('E4b', 'ดึงรูปเดิมซ้ำเข้าใบเดิม (2 แท็บ/กดซ้ำ) → photo_catalog_dup · รูปอื่นของ SKU เดียวกันดึงได้',
    pg_temp.rej(pg_temp.padd(p_shop, j, gen_random_uuid(), 5000, null, 'product', pi1), 'photo_catalog_dup')
    and (pg_temp.padd(p_shop, j, gen_random_uuid(), 5000, null, 'product', pi2) ->> 'ok') = 'true' and pg_temp.nph(j) = 2);
  -- รูปของ SKU อื่น: ผูกใบ j2 กับ SKU ตัวที่สาม (ไม่ใช่ prod/prod2) — ใบที่ product_id เป็น null จะตกที่ด่านอื่นก่อนถึงด่านเทียบ SKU
  prod3 := pg_temp.mkprod(p_shop, j2);
  v_log := v_log || pg_temp.chk('E5', 'รูปแคตตาล็อกของ SKU อื่น (ไม่ใช่ SKU ของใบ) → photo_product_mismatch · ใบที่ไม่ผูก SKU ก็ใช้อ้างรูปแคตตาล็อกไม่ได้',
    pg_temp.rej(pg_temp.padd(p_shop, j2, gen_random_uuid(), 5000, null, 'product', pi_o), 'photo_product_mismatch')
    and pg_temp.rej(pg_temp.padd(p_shop, j3, gen_random_uuid(), 5000, null, 'product', pi1), 'photo_product_mismatch')
    and pg_temp.nph(j2) = 0 and pg_temp.nph(j3) = 0);

  -- ห้ามเขียนกลับ catalog: product_image ทั้งตาราง + object ใน product-images เท่าเดิมหลัง catalog_source / add(product) / remove
  r := pg_temp.prem(p_shop, ph1);
  select count(*)::text || '/' || coalesce(md5(string_agg(x::text, '|' order by x.id)), '') into v_x from public.product_image x;
  v_log := v_log || pg_temp.chk('E6', 'ห้ามเขียนกลับ catalog: product_image ทั้งตาราง (นับ+md5) และจำนวน object ใน bucket product-images เท่าเดิมหลัง source/add/remove',
    v_x = v_pi0 and (select count(*) from storage.objects where bucket_id = 'product-images') = v_obj0);

  -- ลบรูปแคตตาล็อกที่ถูก copy ไปแล้ว (ทางเดียวกับ deleteProductImage) ต้องไม่ติดด่านของรูปใบงาน · รูปใบงานยังอยู่ · provenance เป็น null
  v_x := pg_temp.x(format('delete from public.product_image where id = %L', pi2));
  v_log := v_log || pg_temp.chk('E7', 'ต้องไม่พัง: ลบรูปแคตตาล็อก (ที่ใบงานอ้างอยู่) สำเร็จ · แถว job_photo ยังอยู่ · product_image_id เป็น null · ไฟล์/แถวอื่นไม่ขยับ',
    v_x = 'OK' and (select count(*) from analytics.job_photo where job_id = j) = 2 and (select count(*) from analytics.job_photo where job_id = j and source = 'product' and product_image_id is null and deleted_at is null) = 1
    and (select count(*) from public.product_image where id = pi2) = 0);

  -- ส่วนย่อย
  lt := pg_temp.mklot(p_shop, p_tpl);
  lot := (lt ->> 'lot')::uuid;
  v_log := v_log || pg_temp.chk('E8', 'ส่วนย่อยเรียก catalog_source → lot_no_photo · ใบ/ร้านไม่ตรง → job_not_found',
    pg_temp.rej(pg_temp.psrc(p_shop, lot), 'lot_no_photo') and pg_temp.rej(pg_temp.psrc(p_shop, gen_random_uuid()), 'job_not_found') and pg_temp.rej(pg_temp.psrc(gen_random_uuid(), j), 'job_not_found'));
  return v_log;
end;
$s$;

-- ============================================================================
-- Section F — หน้าช่าง job_worker_resolve: รูปหลัง PIN เท่านั้น · allowlist · ไม่รั่วข้ามใบ · ใบไม่มีรูป = ฉบับเดิมเป๊ะ (golden)
-- ============================================================================
create function pg_temp.sf(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  d jsonb; dB jsonb; lt jsonb; j uuid; jB uuid; lot uuid; th text; thB text; thL text; wA uuid; sa text; saB text; saL text;
  r jsonb; r2 jsonb; id1 uuid := gen_random_uuid(); id2 uuid := gen_random_uuid(); idB uuid := gen_random_uuid(); idL uuid := gen_random_uuid();
  v_bad text := ''; rj record; v_n int := 0; v_nv int := 0; sh text; ph jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  wA := pg_temp.wid(p_shop, 'vfy-ช่างรูป-F', '4829');
  d := pg_temp.fx(p_shop, p_tpl, pg_temp.pid(p_shop, 'none'), 10, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh';
  sa := pg_temp.sess(th, wA, '4829');

  r := pg_temp.w_res(th);
  v_log := v_log || pg_temp.chk('F1', 'ใบไม่มีรูป ก่อน PIN: resolve = ฉบับเดิมเป๊ะ (ทั้งก้อน) · ไม่มี key photos',
    (r ->> 'ok') = 'true' and not (r -> 'job' ? 'photos') and r = pg_temp.w_old(th));
  r := pg_temp.w_res(th, sa);
  v_log := v_log || pg_temp.chk('F2', 'ใบไม่มีรูป หลัง PIN: resolve = ฉบับเดิมเป๊ะ · ไม่มี key photos (ไม่ใช่ photos: [])',
    (r ->> 'ok') = 'true' and (r #>> '{viewer,worker_id}') = wA::text and not (r -> 'job' ? 'photos') and r = pg_temp.w_old(th, sa));

  r := pg_temp.padd(p_shop, j, id1, 1000, 'ด้านข้าง');
  r := pg_temp.padd(p_shop, j, id2, 2000, null);
  r := pg_temp.w_res(th);
  v_log := v_log || pg_temp.chk('F3', 'ช่างยังไม่ใส่ PIN: ไม่เห็นรูป — ไม่มี key photos · ทั้งก้อนไม่มี path/uuid ของรูป/นามสกุล jpg · เท่าฉบับเดิมเป๊ะ',
    (r ->> 'ok') = 'true' and not (r -> 'job' ? 'photos') and r::text !~ (id1::text || '|' || id2::text || '|jpg|_md|_sm|md_path|sm_path') and r = pg_temp.w_old(th));
  r := pg_temp.w_res(th, sa);
  ph := r #> '{job,photos}';
  v_log := v_log || pg_temp.chk('F4a', 'หลัง PIN: job.photos = 2 รูป · รูปหลักมาก่อน · key ตรง allowlist ของ RPC {id, sm_path, md_path, is_primary, caption} เท่านั้น',
    jsonb_typeof(ph) = 'array' and jsonb_array_length(ph) = 2 and (ph #>> '{0,id}') = id1::text and (ph #>> '{0,is_primary}') = 'true' and (ph #>> '{1,is_primary}') = 'false'
    and pg_temp.keys(ph -> 0) = 'caption,id,is_primary,md_path,sm_path' and pg_temp.keys(ph -> 1) = 'caption,id,is_primary,md_path,sm_path'
    and (ph #>> '{0,caption}') = 'ด้านข้าง' and (ph #> '{1,caption}') = 'null'::jsonb);
  v_log := v_log || pg_temp.chk('F4b', 'path ที่ส่งให้ server ช่างเซ็น = path ของรูปใบนี้เท่านั้น (md/sm ตรงรูปแบบ <shop>/<job>/<id>)',
    (ph #>> '{0,md_path}') = pg_temp.pmd(p_shop, j, id1) and (ph #>> '{0,sm_path}') = pg_temp.psm(p_shop, j, id1)
    and (ph #>> '{1,md_path}') = pg_temp.pmd(p_shop, j, id2) and (ph #>> '{1,sm_path}') = pg_temp.psm(p_shop, j, id2));
  v_log := v_log || pg_temp.chk('F4c', 'ทั้ง response ไม่มี storage_path / product_image_id / uploaded_by / deleted* / bytes / source · ส่วนที่เหลือ (ตัด photos) = ฉบับเดิมเป๊ะ',
    r::text !~ 'storage_path|product_image_id|uploaded_by|deleted|bytes|"source"|variant_sm' and pg_temp.strip_photos(r) = pg_temp.w_old(th, sa));
  r := pg_temp.pprim(p_shop, id2);
  r := pg_temp.w_res(th, sa);
  v_log := v_log || pg_temp.chk('F5', 'ตั้ง id2 เป็นรูปหลัก → resolve เรียง id2 ก่อน (is_primary desc, sort_order)', (r #>> '{job,photos,0,id}') = id2::text and (r #>> '{job,photos,1,id}') = id1::text);
  r2 := pg_temp.prem(p_shop, id2);
  r := pg_temp.w_res(th, sa);
  v_log := v_log || pg_temp.chk('F6', 'ลบ id2 แล้ว: ช่างไม่เห็น id2 (ไม่นับรูปที่ลบ) · id1 ถูกเลื่อนเป็นหลัก · เหลือ 1 รูป · response ไม่มี id2',
    jsonb_array_length(r #> '{job,photos}') = 1 and (r #>> '{job,photos,0,id}') = id1::text and (r #>> '{job,photos,0,is_primary}') = 'true' and r::text !~ id2::text);

  -- รูปของใบอื่นไม่รั่ว (สองใบ สองรูป)
  dB := pg_temp.fx(p_shop, p_tpl, pg_temp.pid(p_shop, 'none'), 10, 3);
  jB := pg_temp.jid(dB); thB := dB ->> 'tokh';
  r := pg_temp.padd(p_shop, jB, idB);
  saB := pg_temp.sess(thB, wA, '4829');
  r := pg_temp.w_res(th, sa);
  r2 := pg_temp.w_res(thB, saB);
  v_log := v_log || pg_temp.chk('F7', 'ไม่รั่วข้ามใบ: ใบ A เห็นเฉพาะ id1 (ไม่มี idB) · ใบ B เห็นเฉพาะ idB (ไม่มี id1)',
    jsonb_array_length(r #> '{job,photos}') = 1 and r::text !~ idB::text and jsonb_array_length(r2 #> '{job,photos}') = 1 and (r2 #>> '{job,photos,0,id}') = idB::text and r2::text !~ id1::text);

  -- ส่วนย่อย: QR ใบย่อยชี้ใบแม่ → เห็นรูปของแม่ (ส่วนย่อยไม่มีรูปของตัวเอง)
  lt := pg_temp.mklot(p_shop, p_tpl);
  lot := (lt ->> 'lot')::uuid;
  r := pg_temp.padd(p_shop, (lt ->> 'job')::uuid, idL, 3000, 'แม่');
  r2 := pg_temp.o_tissue(p_shop, (lt ->> 'job')::uuid, null, 'sublot', lot);
  thL := r2 ->> 'hash';
  saL := pg_temp.sess(thL, wA, '4829');
  r := pg_temp.w_res(thL, saL);
  v_log := v_log || pg_temp.chk('F8', 'QR ใบย่อย (sublot) เปิดใบแม่: ช่างเห็นรูปของใบแม่ (id เดียวกัน) · ส่วนย่อยไม่มีแถวรูปของตัวเอง',
    thL is not null and saL is not null and (r ->> 'ok') = 'true' and (r #>> '{job,photos,0,id}') = idL::text and (select count(*) from analytics.job_photo where job_id = lot) = 0);

  -- ใบปิด (ยกเลิก) → ช่างได้ job_closed ไม่ได้รูป
  r2 := pg_temp.o_cancel(p_shop, jB);
  r := pg_temp.w_res(thB, saB);
  v_log := v_log || pg_temp.chk('F9', 'ใบถูกยกเลิก: resolve → ok false (ปิดแล้ว) ไม่มี photos · response ไม่มี id/path ของรูป · เท่าฉบับเดิมเป๊ะ',
    (r ->> 'ok') = 'false' and not (r ? 'job') and r::text !~ (idB::text || '|jpg|_md') and r = pg_temp.w_old(thB, saB));

  -- golden: ใบทุกใบบน prod (token ใดก็ได้ รวมที่เพิกถอน/ใบปิด) ผลใหม่ตัด photos = ฉบับเดิมเป๊ะ ทั้งไม่ระบุตัวและช่างที่ระบุตัวแล้ว (ใบเปิด)
  for rj in select jj.id as job_id, (select k.token_hash from analytics.job_token k where k.job_id = jj.id order by k.issued_at desc limit 1) as th
              from analytics.job jj where jj.shop_id = p_shop and jj.parent_job_id is null and jj.id not in (j, jB, (lt ->> 'job')::uuid) loop
    continue when rj.th is null;
    v_n := v_n + 1;
    if pg_temp.strip_photos(pg_temp.w_res(rj.th)) is distinct from pg_temp.w_old(rj.th) then v_bad := v_bad || rj.job_id::text || ' ; '; end if;
    sh := pg_temp.sess(rj.th, wA, '4829');
    if sh is not null then
      v_nv := v_nv + 1;
      if pg_temp.strip_photos(pg_temp.w_res(rj.th, sh)) is distinct from pg_temp.w_old(rj.th, sh) then v_bad := v_bad || rj.job_id::text || '(viewer) ; '; end if;
    end if;
  end loop;
  v_log := v_log || pg_temp.chk('F10', format('golden: ใบจริงบน DB %s ใบที่มี token (ผู้ดูทั่วไป) + %s ใบที่ช่างระบุตัวได้: resolve ใหม่ตัด photos = ฉบับเดิมเป๊ะทุกใบ · ไม่ตรง: %s', v_n, v_nv, coalesce(nullif(v_bad, ''), '(ไม่มี)')),
    v_bad = '');
  return v_log;
end;
$s$;

-- ============================================================================
-- Section G — พฤติกรรมรูปหลัก/ลบ/เรียง + audit (event) — ลบรูปหลักเลื่อนตัวถัดไป · ตั้งหลัก/เรียงไม่เขียน event
-- ============================================================================
create function pg_temp.sg(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  j uuid; r jsonb;
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid(); d uuid := gen_random_uuid();
  e uuid := gen_random_uuid(); f uuid := gen_random_uuid(); g uuid := gen_random_uuid();
  n_ev int; v_ev jsonb; v_row analytics.job_photo%rowtype;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  j := pg_temp.mkj(p_shop, p_tpl);
  r := pg_temp.padd(p_shop, j, a); r := pg_temp.padd(p_shop, j, b); r := pg_temp.padd(p_shop, j, c);

  r := pg_temp.prem(p_shop, a, '  ถ่ายผิดรุ่น  ');
  select * into v_row from analytics.job_photo where id = a;
  v_log := v_log || pg_temp.chk('G1', 'ลบรูปหลัก: soft delete (แถวอยู่ · deleted_at/by/เหตุผลตัดช่องว่าง · ไม่เป็นหลัก) · เลื่อนรูปถัดไปตาม sort_order (b) เป็นหลัก · คืน promoted_photo_id',
    (r ->> 'ok') = 'true' and (r ->> 'promoted_photo_id') = b::text and v_row.deleted_at is not null and v_row.deleted_by = pg_temp.act() and v_row.delete_reason = 'ถ่ายผิดรุ่น'
    and not v_row.is_primary and pg_temp.prim(j) = b and pg_temp.nprim(j) = 1);
  r := pg_temp.prem(p_shop, c);
  v_log := v_log || pg_temp.chk('G2', 'ลบรูปที่ไม่ใช่หลัก: รูปหลักไม่เปลี่ยน · promoted_photo_id = null · reason ไม่ส่ง = null',
    (r ->> 'ok') = 'true' and (r -> 'promoted_photo_id') = 'null'::jsonb and pg_temp.prim(j) = b and pg_temp.ph(c, 'delete_reason') is null);
  r := pg_temp.prem(p_shop, b);
  v_log := v_log || pg_temp.chk('G3a', 'ลบรูปสุดท้าย: ไม่มีรูป active · ไม่มีรูปหลัก (promoted null)', pg_temp.nph(j) = 0 and pg_temp.nprim(j) = 0 and (r -> 'promoted_photo_id') = 'null'::jsonb);
  r := pg_temp.padd(p_shop, j, d);
  v_log := v_log || pg_temp.chk('G3b', 'เพิ่มรูปหลังลบหมด: เป็นรูปหลัก · sort 0', (r ->> 'is_primary') = 'true' and pg_temp.ph(d, 'sort_order') = '0');

  -- ตั้งหลัก / เรียง: เก็บ invariant "หลักพอดี 1" · ไม่เขียน event (design §5)
  r := pg_temp.padd(p_shop, j, e); r := pg_temp.padd(p_shop, j, f);
  n_ev := (select count(*)::int from analytics.job_event where job_id = j);
  r := pg_temp.pprim(p_shop, d);
  v_log := v_log || pg_temp.chk('G4a', 'ตั้งรูปที่เป็นหลักอยู่แล้ว = ok ไม่เปลี่ยนอะไร (ไม่ใช่ error)', (r ->> 'ok') = 'true' and pg_temp.prim(j) = d and pg_temp.nprim(j) = 1);
  r := pg_temp.pprim(p_shop, f);
  v_log := v_log || pg_temp.chk('G4b', 'ตั้ง f เป็นหลัก: หลักเดิม (d) ถูกล้าง · หลักพอดี 1 · ลำดับแสดงไม่เปลี่ยน',
    (r ->> 'ok') = 'true' and pg_temp.prim(j) = f and pg_temp.nprim(j) = 1 and pg_temp.order_of(j) = array[d, e, f]);
  r := pg_temp.pord(p_shop, j, array[f, e, d]);
  v_log := v_log || pg_temp.chk('G5a', 'reorder: sort_order = index (0,1,2) · รูปหลักไม่เปลี่ยนตามลำดับ',
    (r ->> 'ok') = 'true' and pg_temp.order_of(j) = array[f, e, d] and pg_temp.ph(f, 'sort_order') = '0' and pg_temp.ph(e, 'sort_order') = '1' and pg_temp.ph(d, 'sort_order') = '2' and pg_temp.prim(j) = f);
  r := pg_temp.pord(p_shop, j, array[e, d, f]);
  v_log := v_log || pg_temp.chk('G5b', 'reorder ย้ายรูปหลักไปท้าย: ยังเป็นรูปหลัก (ลำดับกับรูปหลักเป็นคนละเรื่อง — ใบ A5 ไม่เปลี่ยนรูปโดยไม่ตั้งใจ)',
    pg_temp.prim(j) = f and pg_temp.order_of(j) = array[e, d, f]);
  v_log := v_log || pg_temp.chk('G6a', 'ตั้งหลัก/เรียง ไม่เขียน job_event (จำนวน event ไม่ขยับ) — ตาม design §5',
    (select count(*)::int from analytics.job_event where job_id = j) = n_ev);
  -- ลบรูปหลักหลัง reorder: เลื่อน "ตามลำดับแสดง (sort_order)" ไม่ใช่ตามเวลาสร้าง/ id — ลำดับ e, d, f · ลบ f (หลัก) → e ขึ้นหลัก (e ถูกสร้างหลัง d)
  r := pg_temp.prem(p_shop, f);
  v_log := v_log || pg_temp.chk('G6b', 'ลบรูปหลักหลัง reorder: เลื่อนตัวแรกตาม sort_order (e) ไม่ใช่ตามเวลาสร้าง (d สร้างก่อน e)', (r ->> 'promoted_photo_id') = e::text and pg_temp.prim(j) = e);
  r := pg_temp.padd(p_shop, j, g);
  v_log := v_log || pg_temp.chk('G6c', 'รูปใหม่หลัง reorder/ลบ: sort_order = max(sort_order ของรูป active)+1',
    pg_temp.ph(g, 'sort_order') = (select (max(p.sort_order) filter (where p.id <> g) + 1)::text from analytics.job_photo p where p.job_id = j and p.deleted_at is null));

  -- event การลบ/เพิ่ม
  select ev.payload into v_ev from analytics.job_event ev where ev.job_id = j and ev.event_type = 'photo_remove' order by ev.recorded_at desc limit 1;
  v_log := v_log || pg_temp.chk('G7', 'event photo_remove: payload มีเฉพาะ photo_id + reason · ไม่มี path · actor = ผู้ทำรายการ · ช่อง job_page · จำนวน = จำนวนรูปที่ลบ (4)',
    pg_temp.keys(v_ev) = 'photo_id,reason' and v_ev::text !~ '_md|_sm|jpg|storage' and pg_temp.nev(j, 'photo_remove') = 4
    and not exists (select 1 from analytics.job_event ev where ev.job_id = j and ev.event_type = 'photo_remove' and (ev.actor is distinct from pg_temp.act() or ev.channel <> 'job_page')));
  v_log := v_log || pg_temp.chk('G8', 'event photo_add 1 ต่อรูปที่เพิ่มสำเร็จ (7) · แถวรูปทั้งหมด 7 (รวมที่ลบ 4 — soft delete)',
    pg_temp.nev(j, 'photo_add') = 7 and (select count(*) from analytics.job_photo where job_id = j) = 7 and pg_temp.nph(j) = 3);
  return v_log;
end;
$s$;

-- ============================================================================
-- Section H — สิทธิ์: anon/authenticated/PUBLIC ห้ามแตะ RPC/ตาราง/bucket · service_role อ่านตารางอย่างเดียว · ไม่มี overload · bucket private
-- ============================================================================
create function pg_temp.cnt_as(p_role text, p_sql text) returns text
 language plpgsql as $c$
declare v_n text; v_msg text; v_state text;
begin
  execute format('set local role %I', p_role);
  execute p_sql into v_n;
  reset role;
  return v_n;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  reset role;
  return 'ERR:' || v_state;
end;
$c$;

create function pg_temp.sh(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  v_sigs constant text[] := array[
    'analytics.job_photo_add(uuid,uuid,text,text,text,text,integer,integer,integer,text,uuid,uuid)', 'analytics.job_photo_remove(uuid,uuid,text,uuid)',
    'analytics.job_photo_set_primary(uuid,uuid,uuid)', 'analytics.job_photo_reorder(uuid,uuid,uuid[],uuid)', 'analytics.job_photo_catalog_source(uuid,uuid)',
    'analytics.job_worker_resolve(text,text,text)'];
  v_trg constant text[] := array['analytics.job_photo_guard()', 'analytics.job_photo_enforce_cap()'];
  s text; v_bad text := ''; v_x text; r text; j uuid; v_ev text;
  v_calls constant text[] := array[
    'select analytics.job_photo_add(null::uuid, null::uuid, null::text, null::text, null::text, null::text, null::int)',
    'select analytics.job_photo_remove(null::uuid, null::uuid)', 'select analytics.job_photo_set_primary(null::uuid, null::uuid)',
    'select analytics.job_photo_reorder(null::uuid, null::uuid, null::uuid[])', 'select analytics.job_photo_catalog_source(null::uuid, null::uuid)',
    'select analytics.job_worker_resolve(null::text)'];
  v_old text[] := array['create', 'stage_receive', 'stage_send', 'stage_skip', 'stage_reopen', 'weigh', 'scrap', 'batch_join', 'batch_leave', 'due_set', 'hold', 'resume',
    'photo_add', 'note', 'done', 'cancel', 'token_issue', 'token_revoke', 'plan_change', 'surplus_set', 'profile_set', 'split', 'split_cancel', 'discrepancy', 'discrepancy_resolve'];
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  for s in select unnest(v_sigs || v_trg) loop
    if has_function_privilege('anon', s, 'execute') or has_function_privilege('authenticated', s, 'execute')
       or exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a where p.oid = s::regprocedure and a.privilege_type = 'EXECUTE' and a.grantee = 0) then
      v_bad := v_bad || s || ' ; ';
    end if;
  end loop;
  v_log := v_log || pg_temp.chk('H1', 'anon/authenticated/PUBLIC ไม่ถือ EXECUTE บนฟังก์ชันใหม่ 7 ตัว + job_worker_resolve (ทั้ง 3 ชื่อ — ข้อ 18.1) ' || v_bad, v_bad = '');
  v_bad := '';
  for s in select unnest(v_sigs) loop
    if not has_function_privilege('service_role', s, 'execute') then v_bad := v_bad || s || ' ; '; end if;
  end loop;
  for s in select unnest(v_trg) loop
    if has_function_privilege('service_role', s, 'execute') then v_bad := v_bad || s || ' (trigger fn ไม่ควรเรียกตรงได้) ; '; end if;
  end loop;
  v_log := v_log || pg_temp.chk('H2', 'service_role เรียก RPC 6 ตัวได้ · trigger function 2 ตัวเรียกตรงไม่ได้ ' || v_bad, v_bad = '');
  v_log := v_log || pg_temp.chk('H3', 'ไม่มี overload: ทุกชื่อ job_photo_* และ job_worker_resolve มี 1 signature ใน pg_proc',
    (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace and proname like 'job\_photo\_%') = 7
    and (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'job_worker_resolve') = 1
    and not exists (select 1 from pg_proc where pronamespace = 'analytics'::regnamespace and proname like 'job\_photo\_%' group by proname having count(*) > 1));
  v_log := v_log || pg_temp.chk('H4', 'search_path ถูกปักในฟังก์ชัน definer ทั้ง 5 ตัว + resolve (กัน search_path hijack)',
    (select count(*) from pg_proc p where p.oid = any (array[to_regprocedure(v_sigs[1]), to_regprocedure(v_sigs[2]), to_regprocedure(v_sigs[3]), to_regprocedure(v_sigs[4]), to_regprocedure(v_sigs[5]), to_regprocedure(v_sigs[6])])
        and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) = 6);

  -- ตาราง: ไม่มีสิทธิ์ anon/authenticated · service_role อ่านอย่างเดียว · RLS เปิดไม่มี policy · trigger ครบ 3 เปิดอยู่
  v_log := v_log || pg_temp.chk('H5', 'job_photo: anon/authenticated ไม่มีสิทธิ์ใดเลย · service_role select อย่างเดียว (ไม่มี insert/update/delete/truncate) · RLS เปิด · ไม่มี policy',
    not has_table_privilege('anon', 'analytics.job_photo', 'select, insert, update, delete, truncate, references, trigger')
    and not has_table_privilege('authenticated', 'analytics.job_photo', 'select, insert, update, delete, truncate, references, trigger')
    and has_table_privilege('service_role', 'analytics.job_photo', 'select')
    and not has_table_privilege('service_role', 'analytics.job_photo', 'insert, update, delete, truncate')
    and (select relrowsecurity from pg_class where oid = 'analytics.job_photo'::regclass)
    and not exists (select 1 from pg_policy where polrelid = 'analytics.job_photo'::regclass));
  v_log := v_log || pg_temp.chk('H6', 'trigger บน job_photo: guard + cap + deny truncate เปิดอยู่ครบ 3 (เปิด = tgenabled O/A)',
    (select count(*) from pg_trigger t where t.tgrelid = 'analytics.job_photo'::regclass and not t.tgisinternal and t.tgenabled in ('O', 'A')) = 3
    and exists (select 1 from pg_trigger t where t.tgrelid = 'analytics.job_photo'::regclass and t.tgname = 'trg_job_photo_deny_truncate'));
  v_log := v_log || pg_temp.chk('H7', 'ไม่มีฟังก์ชันใดในสคีมา analytics ที่ PUBLIC/anon/authenticated ถือ EXECUTE (เหมือน scripts/check-analytics-grants.sql) · anon/authenticated ไม่มี USAGE สคีมา',
    not exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a where p.pronamespace = 'analytics'::regnamespace and a.privilege_type = 'EXECUTE'
                  and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole))
    and not has_schema_privilege('anon', 'analytics', 'usage') and not has_schema_privilege('authenticated', 'analytics', 'usage'));

  -- 18.5: จำลองวันที่กำแพงสคีมาหลุด (grant usage กลับเข้าไป) แล้วยิงจริง — ต้องตกที่ 42501
  execute 'grant usage on schema analytics to authenticated, anon';
  v_bad := '';
  foreach s in array v_calls loop
    v_x := pg_temp.as_role('authenticated', s);
    if v_x not like 'ERR:42501:%' then v_bad := v_bad || 'authenticated: ' || s || ' → ' || left(v_x, 50) || ' ; '; end if;
    v_x := pg_temp.as_role('anon', s);
    if v_x not like 'ERR:42501:%' then v_bad := v_bad || 'anon: ' || s || ' → ' || left(v_x, 50) || ' ; '; end if;
  end loop;
  v_log := v_log || pg_temp.chk('H8a', 'สคีมาหลุดสมมติ: authenticated/anon ยิง RPC 6 ตัวจริง (ส่ง null ทุกพารามิเตอร์) → 42501 permission denied ทุกตัว ' || v_bad, v_bad = '');
  v_bad := '';
  foreach s in array array['select count(*) from analytics.job_photo', 'insert into analytics.job_photo (id) values (gen_random_uuid())', 'update analytics.job_photo set sort_order = 0', 'delete from analytics.job_photo', 'truncate analytics.job_photo'] loop
    v_x := pg_temp.as_role('authenticated', s);
    if v_x not like 'ERR:42501:%' then v_bad := v_bad || 'authenticated: ' || left(s, 30) || ' → ' || left(v_x, 40) || ' ; '; end if;
    v_x := pg_temp.as_role('anon', s);
    if v_x not like 'ERR:42501:%' then v_bad := v_bad || 'anon: ' || left(s, 30) || ' → ' || left(v_x, 40) || ' ; '; end if;
  end loop;
  v_log := v_log || pg_temp.chk('H8b', 'สคีมาหลุดสมมติ: authenticated/anon อ่าน/เขียน/ลบ/truncate ตาราง job_photo → 42501 ทุกคำสั่ง ' || v_bad, v_bad = '');
  v_bad := '';
  foreach s in array array['insert into analytics.job_photo (id) values (gen_random_uuid())', 'update analytics.job_photo set sort_order = 0', 'delete from analytics.job_photo', 'truncate analytics.job_photo'] loop
    v_x := pg_temp.as_role('service_role', s);
    if v_x not like 'ERR:42501:%' then v_bad := v_bad || left(s, 30) || ' → ' || left(v_x, 40) || ' ; '; end if;
  end loop;
  v_log := v_log || pg_temp.chk('H8c', 'service_role เขียน job_photo ตรงไม่ได้ (insert/update/delete/truncate → 42501) · อ่านได้ — เขียนผ่าน RPC definer เท่านั้น ' || v_bad,
    v_bad = '' and pg_temp.as_role('service_role', 'select count(*) from analytics.job_photo') = 'OK');

  -- bucket + storage: private · 1 MB · jpeg · ไม่มี policy · anon/authenticated อ่าน object ใน bucket ไม่ได้ (ใส่ object ปลอมแถวเดียวแล้วถอยกลับ)
  v_log := v_log || pg_temp.chk('H9a', 'bucket job-photos: private · จำกัด 1,048,576 bytes · image/jpeg เท่านั้น · ไม่มี storage policy ใดอ้าง job-photos · product-images ยัง private เช่นเดิม',
    exists (select 1 from storage.buckets b where b.id = 'job-photos' and b.public = false and b.file_size_limit = 1048576 and b.allowed_mime_types = array['image/jpeg'])
    and not exists (select 1 from pg_policies p where p.schemaname = 'storage' and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%job-photos%')
    and exists (select 1 from storage.buckets b where b.id = 'product-images' and b.public = false));
  v_x := pg_temp.as_role('service_role', 'insert into storage.objects (bucket_id, name) values (''job-photos'', ''verify0182/' || gen_random_uuid()::text || '_md.jpg'')');
  if v_x = 'OK' then
    v_x := pg_temp.cnt_as('authenticated', 'select count(*) from storage.objects where bucket_id = ''job-photos''');
    r := pg_temp.cnt_as('anon', 'select count(*) from storage.objects where bucket_id = ''job-photos''');
    v_log := v_log || pg_temp.chk('H9b', 'มี object จริง 1 แถวใน job-photos: authenticated/anon นับได้ 0 หรือถูกปฏิเสธ (ไม่เห็น object)',
      (v_x = '0' or v_x like 'ERR:%') and (r = '0' or r like 'ERR:%') and pg_temp.cnt_as('service_role', 'select count(*) from storage.objects where bucket_id = ''job-photos''') = '1');
    perform pg_temp.as_role('service_role', 'delete from storage.objects where bucket_id = ''job-photos'' and name like ''verify0182/%''');
  else
    v_log := v_log || '[SKIP] H9b  ใส่ object ปลอมใน storage.objects ไม่ได้ (' || left(v_x, 60) || ') — ทดสอบการอ่าน object จริงด้วยสิทธิ์ anon/authenticated ไม่ได้ในชั้นนี้' || E'\n';
  end if;

  -- job_event CHECK: ค่าเดิมครบทุกตัว (ไม่หลุดตอนลอกรายการ) + photo_remove
  v_x := (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'analytics.job_event'::regclass and c.conname = 'job_event_event_type_ck');
  v_log := v_log || pg_temp.chk('H10', 'job_event_event_type_ck: ชนิดเดิมของ 0181 ครบทั้ง 25 + photo_remove (ไม่มีชนิดหลุดตอนลอกรายการ)',
    not exists (select 1 from unnest(v_old) o where position('''' || o || '''::text' in v_x) = 0) and position('''photo_remove''::text' in v_x) > 0);
  return v_log;
end;
$s$;


-- ============================================================================
-- ตัวรัน section: แต่ละ section ล้มด้วย exception ไม่ทำให้ทั้งชุดตาย · ทุก section ถอยกลับ (raise) — ข้อมูลทดสอบไม่ค้าง
-- ============================================================================
create function pg_temp.run_sec(p_fn text, p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $c$
declare v text; v_ctx text;
begin
  begin
    execute format('select pg_temp.%I(%L, %L)', p_fn, p_shop, p_tpl) into v;
    raise exception 'SEC_DONE';
  exception when others then
    if sqlerrm <> 'SEC_DONE' then
      get stacked diagnostics v_ctx = pg_exception_context;
      v := coalesce(v, '') || format(E'[FAIL] %s  section ล้มด้วย exception: %s\n   %s\n', p_fn, sqlerrm, left(v_ctx, 600));
    end if;
  end;
  return coalesce(v, '');
end;
$c$;
-- label ของเคส -> section ที่รันเคสนั้น (A→sa … H→sh · mutant รันเฉพาะ section ที่ expect อยู่)
create function pg_temp.sec_of(p_label text) returns text language sql as $c$ select 's' || lower(left(p_label, 1)) $c$;
create function pg_temp.run_for(p_expect jsonb, p_shop uuid, p_tpl uuid) returns text language plpgsql as $c$
declare v text := ''; s text;
begin
  for s in select distinct pg_temp.sec_of(e) from jsonb_array_elements_text(p_expect) e order by 1 loop
    v := v || pg_temp.run_sec(s, p_shop, p_tpl);
  end loop;
  return v;
end;
$c$;
create function pg_temp.run_all(p_shop uuid, p_tpl uuid) returns text
 language sql as $c$
  select pg_temp.run_sec('sa', p_shop, p_tpl) || pg_temp.run_sec('sb', p_shop, p_tpl) || pg_temp.run_sec('sc', p_shop, p_tpl) || pg_temp.run_sec('sd', p_shop, p_tpl)
      || pg_temp.run_sec('se', p_shop, p_tpl) || pg_temp.run_sec('sf', p_shop, p_tpl) || pg_temp.run_sec('sg', p_shop, p_tpl) || pg_temp.run_sec('sh', p_shop, p_tpl)
$c$;

do $v182$
declare
  v_shop uuid; v_tpl uuid;
  v_log text := ''; v_s text; v_fail int; v_skip int; v_snap0 text; v_d0 text;
  v_mutants jsonb := jsonb_build_array(
    jsonb_build_object('id', $m$MU-1$m$, 'what', $m$ด่านส่วนย่อยของ RPC เพิ่มรูป + trigger guard ถูกถอดพร้อมกัน (เพิ่มรูปเข้าส่วนย่อยได้)$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_add$m$, 'from', $m$if v_job.parent_job_id is not null then$m$, 'to', $m$if false then$m$), jsonb_build_object('fn', $m$job_photo_guard$m$, 'from', $m$if v_parent is not null then$m$, 'to', $m$if false then$m$)), 'expect', jsonb_build_array($m$B3b$m$, $m$D5$m$)),
    jsonb_build_object('id', $m$MU-2$m$, 'what', $m$reorder ไม่เช็คส่วนย่อย$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_reorder$m$, 'from', $m$if v_job.parent_job_id is not null then$m$, 'to', $m$if false then$m$)), 'expect', jsonb_build_array($m$B6b$m$)),
    jsonb_build_object('id', $m$MU-3$m$, 'what', $m$เพดาน reference 5 -> 500$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_enforce_cap$m$, 'from', $m$v_ref >= 5$m$, 'to', $m$v_ref >= 500$m$)), 'expect', jsonb_build_array($m$C1b$m$)),
    jsonb_build_object('id', $m$MU-4$m$, 'what', $m$เพดานรวม 20 -> 2000$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_enforce_cap$m$, 'from', $m$v_all >= 20$m$, 'to', $m$v_all >= 2000$m$)), 'expect', jsonb_build_array($m$C2c$m$, $m$C2d$m$)),
    jsonb_build_object('id', $m$MU-5$m$, 'what', $m$budget ร้าน 250 MB -> 2500 MB$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_enforce_cap$m$, 'from', $m$250 * 1024 * 1024$m$, 'to', $m$2500 * 1024 * 1024$m$)), 'expect', jsonb_build_array($m$C3d$m$)),
    jsonb_build_object('id', $m$MU-6$m$, 'what', $m$budget นับรูปที่ลบแล้วด้วย (พื้นที่ไม่คืน)$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_enforce_cap$m$, 'from', $m$p.shop_id = new.shop_id and p.deleted_at is null$m$, 'to', $m$p.shop_id = new.shop_id$m$)), 'expect', jsonb_build_array($m$C3c$m$, $m$C3d$m$, $m$C3e$m$)),
    jsonb_build_object('id', $m$MU-7$m$, 'what', $m$path: ไม่ผูก prefix ร้าน/ใบ + ไม่เทียบ sm + CHECK path ถูกถอด (ข้ามใบ/ข้ามร้านได้)$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_add$m$, 'from', $m$('^' || v_prefix || '[0-9a-f]{8}$m$, 'to', $m$('^[0-9a-f/-]{74}[0-9a-f]{8}$m$), jsonb_build_object('fn', $m$job_photo_add$m$, 'from', $m$if p_variant_sm_path <> v_prefix || v_id::text || '_sm.jpg' then$m$, 'to', $m$if false then$m$), jsonb_build_object('ddl', $m$alter table analytics.job_photo drop constraint job_photo_path_ck$m$)), 'expect', jsonb_build_array($m$B2a$m$, $m$B2c$m$)),
    jsonb_build_object('id', $m$MU-8$m$, 'what', $m$path: ไม่เทียบ sm กับ md + CHECK path ถูกถอด (sm คนละ uuid / sm = md / นามสกุลผิดผ่าน)$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_add$m$, 'from', $m$if p_variant_sm_path <> v_prefix || v_id::text || '_sm.jpg' then$m$, 'to', $m$if false then$m$), jsonb_build_object('ddl', $m$alter table analytics.job_photo drop constraint job_photo_path_ck$m$)), 'expect', jsonb_build_array($m$B2a$m$)),
    jsonb_build_object('id', $m$MU-9$m$, 'what', $m$ไม่เช็คขนาด bytes ที่ RPC (เหลือแต่ CHECK ตาราง)$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_add$m$, 'from', $m$if p_bytes is null or not (p_bytes between 1 and 1048576) then$m$, 'to', $m$if false then$m$)), 'expect', jsonb_build_array($m$B1a$m$)),
    jsonb_build_object('id', $m$MU-10$m$, 'what', $m$ไม่เช็คกว้าง/สูง$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_add$m$, 'from', $m$if (p_width is not null and not (p_width between 1 and 100000)) or (p_height is not null and not (p_height between 1 and 100000)) then$m$, 'to', $m$if false then$m$)), 'expect', jsonb_build_array($m$B1d$m$)),
    jsonb_build_object('id', $m$MU-11$m$, 'what', $m$ไม่เช็ค source (shopfloor/ค่ามั่วผ่านไปถึง CHECK)$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_add$m$, 'from', $m$if p_source is null or p_source not in ('office', 'product') then$m$, 'to', $m$if false then$m$)), 'expect', jsonb_build_array($m$B4b$m$)),
    jsonb_build_object('id', $m$MU-12$m$, 'what', $m$ประตู kind = stage เปิด$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_add$m$, 'from', $m$if p_kind = 'stage' then$m$, 'to', $m$if false then$m$)), 'expect', jsonb_build_array($m$B4a$m$)),
    jsonb_build_object('id', $m$MU-13$m$, 'what', $m$ไม่เช็คว่ารูปแคตตาล็อกเป็นของ SKU เดียวกับใบ$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_add$m$, 'from', $m$ and pi.product_id = v_job.product_id$m$, 'to', $m$$m$)), 'expect', jsonb_build_array($m$E5$m$)),
    jsonb_build_object('id', $m$MU-14$m$, 'what', $m$caption: ไม่ผ่าน job_text_clean ทั้ง RPC และ trigger$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_add$m$, 'from', $m$v_caption := analytics.job_text_clean(p_caption, 'ป้ายรูป', 60, false);$m$, 'to', $m$v_caption := p_caption;$m$), jsonb_build_object('fn', $m$job_photo_guard$m$, 'from', $m$if new.caption is not null and analytics.job_text_clean($m$, 'to', $m$if false and analytics.job_text_clean($m$)), 'expect', jsonb_build_array($m$B5a$m$)),
    jsonb_build_object('id', $m$MU-15$m$, 'what', $m$รูปแรกไม่ถูกตั้งเป็นรูปหลักอัตโนมัติ$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_add$m$, 'from', $m$v_primary := not exists ($m$, 'to', $m$v_primary := false and not exists ($m$)), 'expect', jsonb_build_array($m$A1$m$)),
    jsonb_build_object('id', $m$MU-16$m$, 'what', $m$ลบรูปหลักแล้วไม่เลื่อนตัวถัดไป$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_remove$m$, 'from', $m$if v_ph.is_primary then$m$, 'to', $m$if false then$m$)), 'expect', jsonb_build_array($m$G1$m$)),
    jsonb_build_object('id', $m$MU-17$m$, 'what', $m$ลบรูปเขียน event ผิดชนิด (note)$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_remove$m$, 'from', $m$'photo_remove', analytics.job_today()$m$, 'to', $m$'note', analytics.job_today()$m$)), 'expect', jsonb_build_array($m$G7$m$)),
    jsonb_build_object('id', $m$MU-18$m$, 'what', $m$reorder ไม่เทียบชุด id กับรูป active$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_reorder$m$, 'from', $m$or v_have is distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(p_ids) as x)$m$, 'to', $m$$m$)), 'expect', jsonb_build_array($m$B6a$m$)),
    jsonb_build_object('id', $m$MU-19$m$, 'what', $m$ตั้งรูปหลักไม่ล้างตัวเก่า$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_set_primary$m$, 'from', $m$update analytics.job_photo set is_primary = false where job_id = v_job_id and is_primary and deleted_at is null;$m$, 'to', $m$$m$)), 'expect', jsonb_build_array($m$G4b$m$, $m$A7c$m$)),
    jsonb_build_object('id', $m$MU-20$m$, 'what', $m$trigger guard ปล่อย DELETE$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_guard$m$, 'from', $m$if tg_op = 'DELETE' then
    raise exception$m$, 'to', $m$if tg_op = 'DELETE' then
    return old;
    raise exception$m$)), 'expect', jsonb_build_array($m$D3a$m$)),
    jsonb_build_object('id', $m$MU-21$m$, 'what', $m$trigger guard ไม่กันการแก้ bytes$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_guard$m$, 'from', $m$old.storage_path, old.variant_sm_path, old.bytes$m$, 'to', $m$old.storage_path, old.variant_sm_path, new.bytes$m$)), 'expect', jsonb_build_array($m$D2$m$)),
    jsonb_build_object('id', $m$MU-22$m$, 'what', $m$trigger guard ไม่กันการแก้ storage_path$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_guard$m$, 'from', $m$old.source, old.storage_path$m$, 'to', $m$old.source, new.storage_path$m$)), 'expect', jsonb_build_array($m$D2$m$)),
    jsonb_build_object('id', $m$MU-23$m$, 'what', $m$trigger guard ไม่ยอมให้ FK set null (ลบรูปแคตตาล็อกที่ใบอ้างอยู่ไม่ได้)$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_guard$m$, 'from', $m$if new.product_image_id is distinct from old.product_image_id and new.product_image_id is not null then$m$, 'to', $m$if new.product_image_id is distinct from old.product_image_id then$m$)), 'expect', jsonb_build_array($m$E7$m$, $m$D8$m$)),
    jsonb_build_object('id', $m$MU-24$m$, 'what', $m$trigger guard ไม่กันการแก้แถวที่ลบแล้ว$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_guard$m$, 'from', $m$if old.deleted_at is not null then$m$, 'to', $m$if false then$m$)), 'expect', jsonb_build_array($m$D7$m$)),
    jsonb_build_object('id', $m$MU-25$m$, 'what', $m$resolve ปล่อยรูปก่อนใส่ PIN$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_worker_resolve$m$, 'from', $m$if v_worker is not null then
    select jsonb_agg($m$, 'to', $m$if true then
    select jsonb_agg($m$), jsonb_build_object('fn', $m$job_worker_resolve$m$, 'from', $m$'has_profile', v_job.profile_id is not null)
             else$m$, 'to', $m$'has_profile', v_job.profile_id is not null) || case when v_photos is null then '{}'::jsonb else jsonb_build_object('photos', v_photos) end
             else$m$)), 'expect', jsonb_build_array($m$F3$m$)),
    jsonb_build_object('id', $m$MU-26$m$, 'what', $m$resolve รวมรูปที่ลบแล้ว$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_worker_resolve$m$, 'from', $m$ and phx.deleted_at is null$m$, 'to', $m$$m$)), 'expect', jsonb_build_array($m$F6$m$)),
    jsonb_build_object('id', $m$MU-27$m$, 'what', $m$resolve ดึงรูปทั้งร้าน (ไม่จำกัดใบ)$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_worker_resolve$m$, 'from', $m$phx.job_id = coalesce(v_job.parent_job_id, v_job.id)$m$, 'to', $m$phx.shop_id = v_job.shop_id$m$)), 'expect', jsonb_build_array($m$F7$m$)),
    jsonb_build_object('id', $m$MU-28$m$, 'what', $m$resolve ส่ง storage_path/uploaded_by ออกไปด้วย$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_worker_resolve$m$, 'from', $m$'caption', phx.caption)$m$, 'to', $m$'caption', phx.caption, 'storage_path', phx.storage_path, 'uploaded_by', phx.uploaded_by)$m$)), 'expect', jsonb_build_array($m$F4a$m$, $m$F4c$m$)),
    jsonb_build_object('id', $m$MU-29$m$, 'what', $m$ตั้งรูปหลักรูปที่ลบแล้วผ่าน (ถอด RPC + guard)$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_set_primary$m$, 'from', $m$if v_ph.deleted_at is not null then$m$, 'to', $m$if false then$m$), jsonb_build_object('fn', $m$job_photo_guard$m$, 'from', $m$if old.deleted_at is not null then$m$, 'to', $m$if false then$m$)), 'expect', jsonb_build_array($m$B7a$m$)),
    jsonb_build_object('id', $m$MU-30$m$, 'what', $m$resolve เรียงรูปผิด (sort_order มาก่อน ไม่ใช่รูปหลัก)$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_worker_resolve$m$, 'from', $m$order by phx.is_primary desc, phx.sort_order$m$, 'to', $m$order by phx.sort_order desc$m$)), 'expect', jsonb_build_array($m$F4a$m$)),
    jsonb_build_object('id', $m$MU-31$m$, 'what', $m$grant execute job_photo_add ให้ authenticated$m$, 'steps', jsonb_build_array(jsonb_build_object('ddl', $m$grant execute on function analytics.job_photo_add(uuid,uuid,text,text,text,text,integer,integer,integer,text,uuid,uuid) to authenticated$m$)), 'expect', jsonb_build_array($m$H1$m$, $m$H8a$m$)),
    jsonb_build_object('id', $m$MU-32$m$, 'what', $m$grant execute job_photo_remove ให้ PUBLIC$m$, 'steps', jsonb_build_array(jsonb_build_object('ddl', $m$grant execute on function analytics.job_photo_remove(uuid,uuid,text,uuid) to public$m$)), 'expect', jsonb_build_array($m$H1$m$)),
    jsonb_build_object('id', $m$MU-33$m$, 'what', $m$grant select ตาราง job_photo ให้ authenticated$m$, 'steps', jsonb_build_array(jsonb_build_object('ddl', $m$grant select on analytics.job_photo to authenticated$m$)), 'expect', jsonb_build_array($m$H5$m$, $m$H8b$m$)),
    jsonb_build_object('id', $m$MU-34$m$, 'what', $m$grant insert/update/delete ตาราง job_photo ให้ service_role$m$, 'steps', jsonb_build_array(jsonb_build_object('ddl', $m$grant insert, update, delete on analytics.job_photo to service_role$m$)), 'expect', jsonb_build_array($m$H5$m$, $m$H8c$m$)),
    jsonb_build_object('id', $m$MU-35$m$, 'what', $m$ปิด RLS ของ job_photo$m$, 'steps', jsonb_build_array(jsonb_build_object('ddl', $m$alter table analytics.job_photo disable row level security$m$)), 'expect', jsonb_build_array($m$H5$m$)),
    jsonb_build_object('id', $m$MU-36$m$, 'what', $m$ปิด trigger เพดาน/budget$m$, 'steps', jsonb_build_array(jsonb_build_object('ddl', $m$alter table analytics.job_photo disable trigger trg_job_photo_20_cap$m$)), 'expect', jsonb_build_array($m$C1b$m$, $m$C2c$m$)),
    jsonb_build_object('id', $m$MU-37$m$, 'what', $m$ถอด trigger deny truncate$m$, 'steps', jsonb_build_array(jsonb_build_object('ddl', $m$drop trigger trg_job_photo_deny_truncate on analytics.job_photo$m$)), 'expect', jsonb_build_array($m$D3a$m$, $m$H6$m$)),
    jsonb_build_object('id', $m$MU-38$m$, 'what', $m$ปิด trigger guard$m$, 'steps', jsonb_build_array(jsonb_build_object('ddl', $m$alter table analytics.job_photo disable trigger trg_job_photo_10_guard$m$)), 'expect', jsonb_build_array($m$D2$m$, $m$D3a$m$)),
    jsonb_build_object('id', $m$MU-39$m$, 'what', $m$ถอด unique กันดึงรูปแคตตาล็อกซ้ำ$m$, 'steps', jsonb_build_array(jsonb_build_object('ddl', $m$drop index analytics.job_photo_product_image_uq$m$)), 'expect', jsonb_build_array($m$E4b$m$)),
    jsonb_build_object('id', $m$MU-40$m$, 'what', $m$ถอด unique รูปหลักต่อใบ$m$, 'steps', jsonb_build_array(jsonb_build_object('ddl', $m$drop index analytics.job_photo_one_primary_uq$m$)), 'expect', jsonb_build_array($m$D1$m$)),
    jsonb_build_object('id', $m$MU-41$m$, 'what', $m$catalog_source เลือกรูปด้วย id ไม่ใช่ sort_order$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_catalog_source$m$, 'from', $m$order by pi.sort_order, pi.created_at, pi.id limit 1$m$, 'to', $m$order by pi.id limit 1$m$)), 'expect', jsonb_build_array($m$E3$m$)),
    jsonb_build_object('id', $m$MU-42$m$, 'what', $m$catalog_source ไม่เช็คส่วนย่อย$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_catalog_source$m$, 'from', $m$if v_job.parent_job_id is not null then$m$, 'to', $m$if false then$m$)), 'expect', jsonb_build_array($m$E8$m$)),
    jsonb_build_object('id', $m$MU-43$m$, 'what', $m$เพิ่มรูปเขียน event ผิดชนิด (note)$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_add$m$, 'from', $m$'photo_add', analytics.job_today()$m$, 'to', $m$'note', analytics.job_today()$m$)), 'expect', jsonb_build_array($m$A3$m$)),
    jsonb_build_object('id', $m$MU-44$m$, 'what', $m$ดึงรูปแคตตาล็อกซ้ำตอบ photo_path_dup แทน photo_catalog_dup$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_add$m$, 'from', $m$if v_con = 'job_photo_product_image_uq' then$m$, 'to', $m$if false then$m$)), 'expect', jsonb_build_array($m$E4b$m$)),
    jsonb_build_object('id', $m$MU-45$m$, 'what', $m$ลบรูปซ้ำผ่านเงียบ (ถอด RPC + guard)$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_remove$m$, 'from', $m$if v_ph.deleted_at is not null then$m$, 'to', $m$if false then$m$), jsonb_build_object('fn', $m$job_photo_guard$m$, 'from', $m$if old.deleted_at is not null then$m$, 'to', $m$if false then$m$)), 'expect', jsonb_build_array($m$B7a$m$)),
    jsonb_build_object('id', $m$MU-46$m$, 'what', $m$รูปที่อัปโหลดเองอ้าง product_image_id ได้$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_add$m$, 'from', $m$elsif p_product_image_id is not null then$m$, 'to', $m$elsif false then$m$)), 'expect', jsonb_build_array($m$B4c$m$)),
    jsonb_build_object('id', $m$MU-47$m$, 'what', $m$ลบรูปไม่เช็คร้านของรูป (เชื่อ p_photo_id อย่างเดียว)$m$, 'steps', jsonb_build_array(jsonb_build_object('fn', $m$job_photo_remove$m$, 'from', $m$where ph.id = p_photo_id and ph.shop_id = p_shop_id;$m$, 'to', $m$where ph.id = p_photo_id;$m$)), 'expect', jsonb_build_array($m$B7a$m$))
  );
  v_m record; v_st record; v_id text; v_total int; v_killed int := 0; v_survived text := ''; v_hit int; v_cnt int; v_ok_cnt int; v_i int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select id into v_shop from public.shop order by created_at limit 1;
  select i.id into v_tpl from analytics.oem_quote_item i join analytics.oem_quote q on q.id = i.quote_id
   where i.shop_id = v_shop and i.input ->> 'metal' = 'silver' and q.quote_no not like 'V17%' order by q.created_at, i.seq limit 1;
  if v_tpl is null then
    v_log := v_log || '[FAIL] S0  ไม่มี oem_quote_item เงินจริงให้ใช้เป็นแม่แบบโคลน — ชุดทดสอบรันต่อไม่ได้' || E'\n';
    raise exception E'%', v_log;
  end if;

  create temp table _v182_orig on commit drop as
    select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h
      from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f';

  v_snap0 := pg_temp.snapx(); v_d0 := pg_temp.snapx_d();
  v_s := pg_temp.run_all(v_shop, v_tpl);
  v_log := v_log || v_s;
  v_log := v_log || pg_temp.chk('K0', 'หลังรัน: แถวตารางใบงาน/ช่าง/ตัวนับเลขใบงาน + job_photo + product_image + จำนวน object ใน bucket (นับ + md5) เท่าก่อนรัน — ข้อมูลทดสอบไม่ค้าง' || coalesce(nullif(' ขยับ: ' || pg_temp.moved(v_d0), ' ขยับ: '), ''), pg_temp.snapx() = v_snap0);
  v_ok_cnt := (length(v_s) - length(replace(v_s, '[OK]', ''))) / 4;

  v_total := jsonb_array_length(v_mutants);
  for v_m in select value as m from jsonb_array_elements(v_mutants) loop
    v_id := v_m.m ->> 'id';
    v_s := '';
    begin
      for v_st in select value as st from jsonb_array_elements(v_m.m -> 'steps') loop
        if v_st.st ? 'ddl' then
          execute v_st.st ->> 'ddl';
        else
          perform pg_temp.mutate(v_st.st ->> 'fn', v_st.st ->> 'from', v_st.st ->> 'to');
        end if;
      end loop;
      v_s := pg_temp.run_for(v_m.m -> 'expect', v_shop, v_tpl);
      raise exception 'MUTANT_DONE';
    exception when others then
      if sqlerrm <> 'MUTANT_DONE' then
        v_log := v_log || format(E'[FAIL] %s  ใช้ mutant ไม่ได้: %s\n', v_id, sqlerrm);
        v_s := 'ERR';
      end if;
    end;
    v_hit := 0;
    for v_i in 0 .. jsonb_array_length(v_m.m -> 'expect') - 1 loop
      -- ถูกจับเมื่อเคสที่คาดไว้ล้ม — หรือ section ที่รันเคสนั้นล้มด้วย exception ทั้งก้อน (mutant ทำให้ระบบพังเสียงดัง = ถูกจับเช่นกัน)
      if position('[FAIL] ' || (v_m.m -> 'expect' ->> v_i) || ' ' in v_s) > 0
         or position('[FAIL] ' || pg_temp.sec_of(v_m.m -> 'expect' ->> v_i) || '  section ล้ม' in v_s) > 0 then
        v_hit := v_hit + 1;
      end if;
    end loop;
    if v_hit >= 1 then
      v_killed := v_killed + 1;
      v_log := v_log || format(E'[OK] %s  mutant ถูกจับ (%s): ล้ม %s จาก %s\n', v_id, v_m.m ->> 'what', v_hit, v_m.m -> 'expect');
    else
      v_survived := v_survived || v_id || ' ';
      v_log := v_log || format(E'[FAIL] %s  mutant รอด (%s) — ไม่มี %s ล้มเลย\n', v_id, v_m.m ->> 'what', v_m.m -> 'expect');
    end if;
  end loop;
  v_log := v_log || pg_temp.chk('MX', format('mutant %s จุด ถูกจับ %s · รอด: %s', v_total, v_killed, coalesce(nullif(v_survived, ''), '(ไม่มี)')), v_killed = v_total);

  select count(*) into v_cnt from _v182_orig o where md5(pg_get_functiondef(to_regprocedure(o.sig))) = o.h;
  v_log := v_log || pg_temp.chk('MY', format('หลังรัน mutant: md5 definition ของฟังก์ชันทุกตัวในสคีมา analytics (%s ตัว รวม job_*/oem_*/production_*/stock_* ที่ 0182 ไม่แตะ) เท่าก่อน mutant · trigger เปิดครบ · สิทธิ์เดิมกลับมา', (select count(*) from _v182_orig)),
    v_cnt = (select count(*) from _v182_orig)
    and (select count(*) from pg_trigger t where t.tgrelid = 'analytics.job_photo'::regclass and not t.tgisinternal and t.tgenabled in ('O', 'A')) = 3
    and not exists (select 1 from pg_trigger t where t.tgrelid in ('analytics.job'::regclass, 'analytics.job_stage'::regclass, 'analytics.job_event'::regclass, 'analytics.job_token'::regclass, 'analytics.worker'::regclass,
                                                                  'analytics.job_discrepancy'::regclass, 'analytics.job_photo'::regclass) and not t.tgisinternal and t.tgenabled not in ('O', 'A'))
    and has_function_privilege('service_role', 'analytics.job_photo_add(uuid,uuid,text,text,text,text,integer,integer,integer,text,uuid,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'analytics.job_photo_add(uuid,uuid,text,text,text,text,integer,integer,integer,text,uuid,uuid)', 'execute')
    and not has_table_privilege('authenticated', 'analytics.job_photo', 'select')
    and not has_table_privilege('service_role', 'analytics.job_photo', 'insert'));
  v_s := pg_temp.run_all(v_shop, v_tpl);
  v_fail := (length(v_s) - length(replace(v_s, '[FAIL]', ''))) / 6;
  v_log := v_log || pg_temp.chk('MZ', 'หลังคืนของเดิม: ชุดเทสต์หลักรันซ้ำ FAIL ' || v_fail, v_fail = 0);
  if v_fail > 0 then
    v_log := v_log || (select string_agg('    (รันซ้ำ) ' || l, E'\n') from unnest(string_to_array(v_s, E'\n')) l where l like '[FAIL]%') || E'\n';
  end if;
  v_log := v_log || pg_temp.chk('K0c', 'state ไม่ขยับหลังรัน mutant ทั้งหมด + รันซ้ำ' || coalesce(nullif(' ขยับ: ' || pg_temp.moved(v_d0), ' ขยับ: '), ''), pg_temp.snapx() = v_snap0);

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_skip := (length(v_log) - length(replace(v_log, '[SKIP]', ''))) / 6;
  v_log := v_log || format(E'\n=== สรุป: [OK] ~%s (ก่อน mutant) · [FAIL] ทั้งไฟล์ = %s · [SKIP] = %s %s ===\n', v_ok_cnt, v_fail, v_skip, case when v_fail = 0 then '(ผ่าน)' else '(ไม่ผ่าน)' end);
  raise exception E'%', v_log;
end;
$v182$;
