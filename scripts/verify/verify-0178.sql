-- scripts/verify/verify-0178.sql
-- ตรวจ supabase/migrations/0178_job_scrap_guard_name_check.sql (M1: ช่างส่งเศษที่ขั้นไม่ถาม = scrap_weight_not_asked · เศษเกินส่วนที่หาย = scrap_over · L1: ชื่อแบบกันอักขระล่องหน/bidi ที่ชั้น CHECK + upsert hint name_invalid)
-- self-rolling-back (3j-migration-traps ข้อ 11) · ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน · ข้อมูลทดสอบสร้างผ่าน RPC เท่านั้น (ใบเสนอราคา = โคลนจากรายการจริงในทรานแซกชันที่ถอยกลับ)
-- รอบแรก = ของจริง · รอบถัดไป = mutant 16 จุด (ทุกตัวต้องล้ม ไม่งั้น MX FAIL) · ปิดท้ายตรวจ state ไม่ขยับ
-- 🔴 ไฟล์นี้ต้องรันหลัง Tech Lead ส่งข้อความ "รันได้" เท่านั้น (ล็อกตาราง job นาน — QA กำลังไล่กดบน DB จริง)
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0178.sql
-- dry-run ก่อน apply: cat supabase/migrations/0178_job_scrap_guard_name_check.sql scripts/verify/verify-0178.sql > <tmp>.sql แล้วรันไม่ใส่ --commit
--
-- ============ ตารางแมป "ข้อในบรีฟ -> เทสต์ที่ครอบ" ============
--  M1 ช่างส่งเศษที่ขั้นที่ scrap_weight_ask = false -> scrap_weight_not_asked           -> W2a (ใบเงินแบบใหม่) · W2c (เศษ 0 ก็ปฏิเสธ) · W5a (ทอง — ตัวอย่างโจมตี in 9.9/out 8.9/เศษ 1.0) · MU-1
--  ขั้นที่ถามเศษ ช่างส่งเศษได้                                                        -> W1 (พอดีส่วนที่หาย loss 0) · W8 (ทอง)
--  ออฟฟิศส่งเศษขั้นที่ไม่ถามได้ตามเดิม                                                -> O0 · O4 · O5 · MU-2
--  ใบเดิม (profile_id null): ช่างส่งเศษไม่ได้ (ตัดสินใจ) · ส่งปกติได้                  -> W4a · W4b · MU-3
--  ปฏิเสธแล้วขั้นไม่ขยับ/ไม่มี event · กดซ้ำหลังส่งสำเร็จ = already                     -> W2b · W7 · W2d
--  ลำดับด่าน: ช่างที่ไม่ใช่ผู้ถือได้ not_holder ไม่ใช่ error เศษ                       -> W6 · MU-11
--  ข้อความไม่มีตัวเลขน้ำหนัก (N1 ทอง)                                                  -> W2a W5a (not_asked) · W7 W8 O2 (scrap_over) · MU-8 MU-9
--  M1 scrap_over: เศษ > in + added - out (ทุกช่องทาง)                                  -> W7 · W8 · O2 (ขอบ 0.901) · O3a (รวมเติมโลหะ) · MU-4
--  เศษพอดีส่วนที่หาย = ผ่าน (loss = 0)                                                  -> W1 · O1 · O3b · O8 · MU-5 MU-6
--  ข้ามด่านเมื่อไม่มี weight_in / weight_out                                           -> O4 · O5 (fixture กันเคสว่างเปล่า) · MU-7
--  ด่านเดิมไม่ถูกบัง (weight_over มาก่อน) · เศษชิ้น (qty) ไม่เกี่ยว                      -> O7 · O8 · MU-10
--  golden: รับ/ส่งปกติ (ไม่ส่งเศษน้ำหนัก) เท่าฉบับ 0172 ทุกฟิลด์                         -> G1 (ออฟฟิศ 12 กรณี) · G2 (ช่าง 12 กรณี + not_holder) — เทียบกับ def 0172 จริง (pg_temp.core_legacy)
--  L1 ชื่อมี U+200B / U+202E -> ปฏิเสธ (upsert hint name_invalid)                      -> L1a · L1b (+FEFF/U+2066) · L1d (ว่าง/ขึ้นบรรทัด/tab/ยาว 61) · MU-14
--  < > คง hint เดิม text_invalid · ไม่ส่งชื่อ = name_required                           -> L1c · L1d2 · MU-15
--  CHECK ชั้นตาราง (เขียนตรงข้าม RPC): job_record_profile.name / job.profile_name       -> L1g · L1h · M4 · MU-12 MU-13
--  ชื่อปกติ/ไทย/อีโมจิธรรมดา -> ผ่าน (ต้องไม่พัง)                                       -> L1e (upsert + INSERT ตรง) · L1h (ชื่อปกติบน job)
--  แถวเดิม (seed 3 แบบ + ใบที่มี profile) ผ่าน CHECK ใหม่ · constraint validated        -> L1j + assert ใน migration §0 (หยุดถ้ามีแถวไม่ผ่าน)
--  สิทธิ์ (พฤติกรรมจริง ข้อ 18.5) · overload · wrapper ยังเรียก core                     -> M1 · M2a · M2b · M3 · MU-16
--  ฟังก์ชันอื่นไม่ถูกแตะ · updated_at ไม่ขยับ · state ไม่ขยับหลังรัน                    -> assert ท้ายไฟล์ migration §5 (md5 ทุกฟังก์ชันในสคีมา) · MY · K0 · K0c
--  mutant 16 จุด: MU-1..MU-16
--
--  ❌ ไม่มีเทสต์ครอบใน verify นี้ (บอกตรงๆ):
--    - race หลาย connection (ช่างสองคนส่งขั้นเดียวกันพร้อมกัน) = ไม่เปลี่ยนจาก 0172 (for update ผ่าน job_office_begin/ unique) — ต้อง 2 connection ซึ่ง do-block จำลองไม่ได้
--    - pre-check md5 ต้นไฟล์ migration + รัน migration ซ้ำ (idempotent) = ครอบด้วย dry-run ครั้งเดียว (md5 ฉบับ 0178 คำนวณออฟไลน์ ต้องยืนยันตอน dry-run: ถ้า md5 ของ job_core_send บน DB ไม่ใช่ทั้ง LF/CRLF ที่ฝังไว้ จะหยุดพร้อมข้อความบอก md5 จริง)
--    - PostgREST จริง (named args) · server action ฝั่ง TS (messages.ts map code ใหม่) = ไม่มี (vitest ฝั่ง lib/jobs)
--    - ตัวอักษรล่องหนชนิดอื่นนอกชุด oem_text_strip_invisible (เช่น U+2800 · U+00AD · U+200A) = ไม่ได้ทดสอบ — พึ่งชุดเดียวกับ note ทุกช่อง (0169/0172) · ทดสอบแค่ U+200B U+202E U+FEFF U+2066
--    - ชื่อที่มี LF/CR/tab เขียนตรงด้วย service_role ผ่าน CHECK (oem_note_valid อนุญาต) = หนี้เล็กที่จดไว้หัว migration ข้อ (6) · ทางเข้า RPC ปฏิเสธ (L1d)
--    - เศษ > ส่วนที่หาย บนข้อมูลเดิม (loss ติดลบที่บันทึกไปก่อน 0178) = ไม่แก้ข้อมูล · H1 รายงานจำนวนเท่านั้น
--    - UI/แสดงข้อความ ฝั่ง TS = ไม่มี (frontend)

-- ===== helper จาก verify-0176 (ลอกตรง) =====
create function pg_temp.chk(p_id text, p_desc text, p_ok boolean) returns text
 language sql as $c$
  select format('[%s] %s  %s', case when coalesce(p_ok, false) then 'OK' else 'FAIL' end, p_id, p_desc) || E'\n'
$c$;

-- รัน SQL ที่คืน jsonb · error -> {_err,_state,_hint} (ไม่ปล่อยให้ทั้งชุดตายกลางทาง)
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

-- รัน statement ที่ไม่คืนค่า · คืน 'OK' หรือ 'ERR:<sqlstate>:<msg>'
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
create function pg_temp.code(r jsonb) returns text language sql as $c$ select coalesce(r ->> 'code', r ->> '_hint', r ->> '_state') $c$;

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
create function pg_temp.w_recv(p_tokh text, p_sesh text, p_seq int, p_w numeric default null, p_ip text default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.job_worker_receive(%L, %L, %L, %L, %L, %L)', p_tokh, p_sesh, p_seq, p_w, 'verify-ua/1.0', p_ip)) $c$;

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

-- ออก token ให้ใบงาน -> {token, hash, print_no}
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
-- โคลนดีล + สร้างใบงาน (p_profile null = ค่าเริ่มตามโลหะ)
create function pg_temp.mkp(p_shop uuid, p_tpl uuid, p_metal text, p_profile uuid default null, p_codes text[] default null, p_qty int default 10) returns jsonb
 language plpgsql as $c$
declare d jsonb;
begin
  d := pg_temp.clone_deal(p_tpl, p_metal, p_qty, null, 'won', null, false);
  return d || pg_temp.jcp(p_shop, (d ->> 'item_id')::uuid, p_codes, p_profile);
end;
$c$;

create function pg_temp.leg(p_job uuid) returns void language plpgsql as $c$
declare v_metal text;
begin
  select metal into v_metal from analytics.job where id = p_job;
  execute 'alter table analytics.job disable trigger trg_job_guard';
  update analytics.job set profile_id = null, profile_name = null, require_final_weight = false, weigh_required = v_metal in ('gold', 'silver') where id = p_job;
  execute 'alter table analytics.job enable trigger trg_job_guard';
  update analytics.job_stage s
     set weigh_required = case v_metal when 'gold' then d.metal_present when 'silver' then d.weigh_default else false end,
         scrap_qty_ask = true, scrap_weight_ask = false
    from analytics.job_stage_def d where s.job_id = p_job and d.shop_id = s.shop_id and d.code = s.stage_code;
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

create function pg_temp.xr(p_sql text) returns text
 language plpgsql as $c$
declare v_msg text; v_state text;
begin
  execute p_sql;
  raise exception 'XR_PASSED';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  if v_msg = 'XR_PASSED' then return 'OK'; end if;
  return 'ERR:' || v_state || ':' || v_msg;
end;
$c$;

-- ===== ฉบับเดิมของ job_core_send (def 0172:1036 ลอกตรง ไม่แก้) เปลี่ยนชื่อเป็น pg_temp.core_legacy — ใช้เทียบ golden (G1/G2) =====
create function pg_temp.core_legacy(
  p_job_id         uuid,
  p_expected_seq   int,
  p_occurred_on    date,
  p_weight_out     numeric,
  p_qty_scrap      int,
  p_scrap_reason   text,
  p_metal_added    numeric,
  p_weight_note    text,
  p_scrap_weight   numeric,
  p_worker_id      uuid,
  p_channel        text,
  p_actor          uuid,
  p_device_hint    text,
  p_enforce_holder boolean
)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_job    analytics.job%rowtype;
  v_s      analytics.job_stage%rowtype;
  v_s2     analytics.job_stage%rowtype;
  v_today  date := analytics.job_today();
  v_scrap  int := coalesce(p_qty_scrap, 0);
  v_added  numeric := coalesce(p_metal_added, 0);
  v_reason text := null;
  v_note   text := null;
  v_name   text;
  v_def    text;
  v_next   record;
  v_codes  constant text[] := array['porosity', 'broken', 'wrong_design', 'missing', 'other'];
begin
  select * into v_job from analytics.job where id = p_job_id;
  if not found then
    return analytics.job_fail('job_not_found', 'ไม่พบใบงาน');
  end if;
  if v_job.status in ('done', 'cancelled') then
    return analytics.job_fail('job_closed', 'ใบงานนี้ปิดแล้ว ส่งต่อไม่ได้');
  end if;
  if p_expected_seq is null then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;
  select * into v_s from analytics.job_stage where job_id = p_job_id and seq = p_expected_seq;
  if not found or v_s.status = 'skipped' then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;
  if v_s.status = 'sent' then
    return analytics.job_fail('already_sent', 'ขั้นนี้ส่งต่อไปแล้ว');
  end if;
  if v_s.status = 'pending' then
    return analytics.job_fail('not_received', 'ขั้นนี้ยังไม่ได้รับงาน ส่งต่อไม่ได้');
  end if;

  -- ช่างส่งต่อได้เฉพาะขั้นที่ตัวเองรับ (design §3 ข้อ 18) · ออฟฟิศไม่ถูกจำกัด
  if p_enforce_holder and v_s.worker_id is distinct from p_worker_id then
    select coalesce(w.display_name, v_s.assignee_name, 'ผู้ถืออื่น') into v_name
      from (select 1) x left join analytics.worker w on w.id = v_s.worker_id;
    return analytics.job_fail('not_holder', format('งานนี้อยู่กับ %s ไม่ใช่คุณ', v_name), jsonb_build_object('by', v_name));
  end if;

  if p_occurred_on is null
     or p_occurred_on > v_today
     or (p_channel = 'worker_qr' and p_occurred_on <> v_today)
     or p_occurred_on < v_today - 14 then
    return analytics.job_fail('date_invalid', 'วันที่ส่งต่อต้องไม่ใช่อนาคตและย้อนหลังได้ไม่เกิน 14 วัน (ช่างสแกนผ่าน QR ใช้วันนี้เท่านั้น)');
  end if;
  if p_occurred_on < v_s.received_on then
    return analytics.job_fail('date_invalid', 'วันที่ส่งต่อต้องไม่ก่อนวันที่รับงานของขั้นนี้');
  end if;

  -- จำนวน: เข้า = ออก + เสีย · ของหายต้องเป็นเสียเหตุผล missing (ไม่มีช่อง "หายเฉยๆ")
  if v_scrap < 0 or v_scrap > v_s.qty_in then
    return analytics.job_fail('qty_invalid', format('จำนวนของเสียต้องอยู่ระหว่าง 0 ถึง %s ชิ้น', v_s.qty_in));
  end if;
  if v_scrap > 0 then
    v_reason := nullif(btrim(p_scrap_reason), '');
    if v_reason is null or not (
         v_reason = any (v_codes)
         or (analytics.oem_note_present(v_reason) and analytics.oem_note_valid(v_reason) and length(v_reason) <= 200 and v_reason !~ '[\r\n\t]')
       ) then
      return analytics.job_fail('reason_required', 'ของเสียต้องระบุเหตุผล (รูพรุน/หัก/ผิดแบบ/หาย/อื่นๆ)');
    end if;
  elsif nullif(btrim(p_scrap_reason), '') is not null then
    return analytics.job_fail('reason_unexpected', 'ไม่มีของเสีย จึงไม่ต้องระบุเหตุผลของเสีย');
  end if;

  -- น้ำหนัก
  if not analytics.job_weight_ok(p_weight_out) then
    return analytics.job_fail('weight_invalid', 'น้ำหนักออกต้องมากกว่า 0 และไม่เกิน 100,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)');
  end if;
  if not analytics.job_weight_ok(v_added, true) or not analytics.job_weight_ok(p_scrap_weight) then
    return analytics.job_fail('weight_invalid', 'น้ำหนักเติมโลหะ/เศษที่เก็บได้ไม่ถูกต้อง (ทศนิยมไม่เกิน 3 ตำแหน่ง ไม่เกิน 100,000 กรัม)');
  end if;
  if v_s.weigh_required and p_weight_out is null then
    return analytics.job_fail('weight_required', 'ขั้นนี้ต้องชั่งน้ำหนักออกก่อนส่งต่อ');
  end if;
  if v_added > 0 then
    begin
      v_note := analytics.job_text_clean(p_weight_note, 'หมายเหตุเติมโลหะ', 200, true);
    exception when others then
      return analytics.job_fail('note_required', 'เติมโลหะต้องระบุหมายเหตุ');
    end;
  elsif nullif(btrim(p_weight_note), '') is not null then
    begin
      v_note := analytics.job_text_clean(p_weight_note, 'หมายเหตุน้ำหนัก', 200, false);
    exception when others then
      return analytics.job_fail('note_invalid', 'หมายเหตุน้ำหนักมีอักขระที่ไม่อนุญาตหรือยาวเกิน 200 ตัวอักษร');
    end;
  end if;
  if p_weight_out is not null and v_s.weight_in_g is not null and p_weight_out > v_s.weight_in_g + v_added then
    return analytics.job_fail('weight_over',
      format('น้ำหนักออกมากกว่าน้ำหนักเข้า %s g — ถ้าเติมโลหะให้ระบุเติมโลหะพร้อมหมายเหตุ',
             trim_scale(p_weight_out - v_s.weight_in_g - v_added)::text));
  end if;

  update analytics.job_stage
     set status = 'sent', sent_on = p_occurred_on, qty_out = qty_in - v_scrap, qty_scrap = v_scrap, scrap_reason = v_reason,
         weight_out_g = p_weight_out, metal_added_g = v_added, weight_note = v_note, scrap_weight_g = p_scrap_weight
   where id = v_s.id
   returning * into v_s2;

  perform analytics.job_event_write(p_job_id, v_s.id, 'stage_send', p_occurred_on, p_actor, p_worker_id, p_channel, p_device_hint,
    jsonb_build_object('stage_code', v_s.stage_code, 'auto_closed', false,
                       'before', analytics.job_stage_state(v_s), 'after', analytics.job_stage_state(v_s2)));

  select s.seq, s.stage_code, d.name_th into v_next
    from analytics.job_stage s
    join analytics.job_stage_def d on d.shop_id = s.shop_id and d.code = s.stage_code
   where s.job_id = p_job_id and s.status = 'pending' order by s.seq limit 1;
  select d.name_th into v_def from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = v_s.stage_code;

  return jsonb_build_object('ok', true, 'action', 'send', 'job_no', v_job.job_no, 'stage_seq', v_s.seq, 'stage_code', v_s.stage_code,
                            'stage_name', v_def, 'sent_on', p_occurred_on, 'qty_out', v_s2.qty_out, 'qty_scrap', v_s2.qty_scrap,
                            'weight_out_g', v_s2.weight_out_g,
                            'next_stage', case when v_next.stage_code is null then null
                                          else jsonb_build_object('seq', v_next.seq, 'code', v_next.stage_code, 'name', v_next.name_th) end);
end;
$f$;

-- ============================================================================
-- helper เฉพาะ 0178
-- ============================================================================
-- ออฟฟิศส่งต่อ (ส่งเศษน้ำหนักได้) -> jsonb {ok:true,...} หรือ {_err,_state,_hint}
create function pg_temp.o_send2(p_shop uuid, p_job uuid, p_seq int, p_on date, p_w numeric default null, p_scrap_w numeric default null,
                                p_qty int default 0, p_reason text default null, p_added numeric default 0, p_note text default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_office_send(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_occurred_on=>%L,
      p_weight_out_g=>%L, p_qty_scrap=>%L, p_scrap_reason=>%L, p_metal_added_g=>%L, p_weight_note=>%L, p_scrap_weight_g=>%L, p_actor=>%L)',
      p_shop, p_job, p_seq, p_on, p_w, p_qty, p_reason, p_added, p_note, p_scrap_w, '00000000-0000-0000-0000-0000000000a1'::uuid)) $c$;

-- ช่างส่งต่อ (ส่งเศษน้ำหนักได้) -> jsonb {ok:false,code,message} หรือ {ok:true,...}
create function pg_temp.w_send2(p_tokh text, p_sesh text, p_seq int, p_w numeric default null, p_scrap_w numeric default null,
                                p_qty int default 0, p_reason text default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_worker_send(p_token_hash=>%L, p_session_hash=>%L, p_expected_seq=>%L, p_weight_out_g=>%L,
      p_qty_scrap=>%L, p_scrap_reason=>%L, p_scrap_weight_g=>%L)', p_tokh, p_sesh, p_seq, p_w, p_qty, p_reason, p_scrap_w)) $c$;

create function pg_temp.sess(p_tokh text, p_worker uuid, p_pin text) returns text
 language sql as $c$ select pg_temp.login(p_tokh, p_worker, p_pin) ->> 'session_hash' $c$;

-- loss_g ของขั้น (v_job_stage_loss = in + added - out - scrap) -> numeric หรือ null
create function pg_temp.loss(p_job uuid, p_seq int) returns numeric
 language sql as $c$
  select l.loss_g from analytics.v_job_stage_loss l join analytics.job_stage s on s.id = l.job_stage_id where s.job_id = p_job and s.seq = p_seq $c$;

create function pg_temp.nev(p_job uuid) returns int language sql as $c$ select count(*)::int from analytics.job_event where job_id = p_job $c$;

-- ข้อความที่ช่างเห็น/ออฟฟิศเห็นจากด่านใหม่ต้องไม่มีตัวเลข (N1 ทอง)
create function pg_temp.nodigit(r jsonb) returns boolean
 language sql as $c$ select coalesce(coalesce(r ->> 'message', r ->> '_err') !~ '[0-9]', false) $c$;

-- แบบ "ชั่งหล่อ+ตัดต้น": cast = ชั่ง+ถามชิ้นเสีย (ไม่ถามเศษ) · cut_sprue = ชั่ง+ถามเศษ · wax_inject = ถามชิ้นเสียอย่างเดียว (ไม่ชั่ง)
create function pg_temp.mkprof(p_shop uuid, p_name text default 'v178-ชั่งหล่อ+ตัดต้น') returns uuid
 language sql as $c$
  select (pg_temp.pu(p_shop, null, p_name, null,
    '[{"stage_code":"cast","weigh":true,"scrap_qty":true},{"stage_code":"cut_sprue","weigh":true,"scrap_weight":true},{"stage_code":"wax_inject","scrap_qty":true}]') ->> 'id')::uuid $c$;

-- ============================================================================
-- Section W — ช่องทางช่าง (worker_qr): ส่งเศษที่ขั้นที่ไม่ถาม = ปฏิเสธ · scrap_over · ใบเดิม · ทอง (ตัวอย่างโจมตีของ security) · ลำดับด่าน
-- ============================================================================
create function pg_temp.sw(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  v_today date := analytics.job_today();
  pw uuid; w uuid; w2 uuid;
  j uuid; th text; sh text; sh2 text;
  r jsonb; r2 jsonb; r3 jsonb; r4 jsonb;
  n0 int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pw := pg_temp.mkprof(p_shop);
  w := pg_temp.wid(p_shop, 'v178-ช่าง A', '4829');
  w2 := pg_temp.wid(p_shop, 'v178-ช่าง B', '7351');

  -- ขั้น cut_sprue (ถามเศษ): เศษ 0.5 > ส่วนที่หาย 0.4 = scrap_over · เศษ 0.4 พอดี = ผ่าน loss 0
  j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver', pw));
  perform pg_temp.rw(p_shop, j, 9.9, 4);
  th := pg_temp.newtok(p_shop, j); sh := pg_temp.sess(th, w, '4829');
  r := pg_temp.w_recv(th, sh, 5, 9.900);
  v_log := v_log || pg_temp.chk('W0', 'fixture: ช่างรับขั้น cut_sprue (seq 5) ได้ · ขั้นนี้ scrap_weight_ask = true · weight_in = 9.900',
    (r ->> 'ok') = 'true' and pg_temp.sv(j, 5, 'scrap_weight_ask') = 'true' and pg_temp.sv(j, 5, 'status') = 'received' and pg_temp.sv(j, 5, 'weight_in_g')::numeric = 9.9);
  n0 := pg_temp.nev(j);
  r := pg_temp.w_send2(th, sh, 5, 9.5, 0.5);
  v_log := v_log || pg_temp.chk('W7', 'ช่าง: เศษ 0.5 > ส่วนที่หาย (9.900 - 9.500 = 0.400) = scrap_over · ข้อความไม่มีตัวเลข · ขั้นยัง received · ไม่เขียนเศษ/event',
    (r ->> 'ok') = 'false' and (r ->> 'code') = 'scrap_over' and pg_temp.nodigit(r)
    and pg_temp.sv(j, 5, 'status') = 'received' and pg_temp.sv(j, 5, 'scrap_weight_g') is null and pg_temp.sv(j, 5, 'weight_out_g') is null and pg_temp.nev(j) = n0);
  r := pg_temp.w_send2(th, sh, 5, 9.5, 0.400);
  v_log := v_log || pg_temp.chk('W1', 'ต้องไม่พัง: ช่างส่งเศษ 0.400 ที่ขั้นที่ถามเศษ (พอดีส่วนที่หาย) = ผ่าน · เก็บเศษ 0.400 · loss_g = 0 (ไม่ติดลบ)',
    (r ->> 'ok') = 'true' and pg_temp.sv(j, 5, 'status') = 'sent' and pg_temp.sv(j, 5, 'scrap_weight_g')::numeric = 0.4 and pg_temp.loss(j, 5) = 0);

  -- ขั้น cast (ไม่ถามเศษ) ใบเงินแบบใหม่: ส่งเศษ = scrap_weight_not_asked (ช่างอีกคน = not_holder ก่อน) · retry หลังส่งสำเร็จ = already (ไม่ใช่ error เศษ)
  j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver', pw));
  perform pg_temp.rw(p_shop, j, 9.9, 3);
  th := pg_temp.newtok(p_shop, j); sh := pg_temp.sess(th, w, '4829'); sh2 := pg_temp.sess(th, w2, '7351');
  r := pg_temp.w_recv(th, sh, 4, 9.900);
  v_log := v_log || pg_temp.chk('W0b', 'fixture: ช่าง A รับ cast (seq 4) · scrap_weight_ask = false', (r ->> 'ok') = 'true' and pg_temp.sv(j, 4, 'scrap_weight_ask') = 'false' and pg_temp.sv(j, 4, 'weigh_required') = 'true');
  n0 := pg_temp.nev(j);
  r2 := pg_temp.w_send2(th, sh2, 4, 9.0, 0.5);
  v_log := v_log || pg_temp.chk('W6', 'ลำดับด่าน: ช่าง B (ไม่ใช่ผู้ถือ) ส่งพร้อมเศษที่ขั้นไม่ถาม = not_holder (ไม่ใช่ error เรื่องเศษ)', (r2 ->> 'code') = 'not_holder');
  r := pg_temp.w_send2(th, sh, 4, 9.0, 0.5);
  v_log := v_log || pg_temp.chk('W2a', 'ช่าง A ส่งเศษ 0.5 ที่ขั้น cast (ไม่ถามเศษ) = scrap_weight_not_asked · ข้อความไม่มีตัวเลข',
    (r ->> 'ok') = 'false' and (r ->> 'code') = 'scrap_weight_not_asked' and pg_temp.nodigit(r));
  r3 := pg_temp.w_send2(th, sh, 4, 9.0, 0);
  v_log := v_log || pg_temp.chk('W2c', 'เศษ 0 (ไม่ใช่ null) ที่ขั้นไม่ถามเศษ = scrap_weight_not_asked เช่นกัน (ตรวจ "ส่งมา" ไม่ใช่ "มีค่า")', (r3 ->> 'code') = 'scrap_weight_not_asked');
  v_log := v_log || pg_temp.chk('W2b', 'ถูกปฏิเสธแล้วขั้นไม่ขยับ: status received · weight_out/scrap_weight_g ว่าง · ไม่มี event เพิ่ม',
    pg_temp.sv(j, 4, 'status') = 'received' and pg_temp.sv(j, 4, 'weight_out_g') is null and pg_temp.sv(j, 4, 'scrap_weight_g') is null and pg_temp.nev(j) = n0);
  r := pg_temp.w_send2(th, sh, 4, 9.0, null);
  v_log := v_log || pg_temp.chk('W2e', 'ต้องไม่พัง: ส่งปกติ (ไม่ส่งเศษ) หลังถูกปฏิเสธ = ผ่าน · weight_out 9.000 · เศษ null · loss_g = 0.900 (ส่วนที่หายเห็นเต็ม — ไม่ถูกกลบด้วยเศษ)',
    (r ->> 'ok') = 'true' and pg_temp.sv(j, 4, 'weight_out_g')::numeric = 9.0 and pg_temp.sv(j, 4, 'scrap_weight_g') is null and pg_temp.loss(j, 4) = 0.9);
  r := pg_temp.w_send2(th, sh, 4, 9.0, 0.5);
  v_log := v_log || pg_temp.chk('W2d', 'กดซ้ำหลังส่งสำเร็จ (payload มีเศษ) = already (ok) ไม่ใช่ scrap_weight_not_asked · เศษไม่ถูกเขียนย้อน',
    (r ->> 'ok') = 'true' and (r ->> 'already') = 'true' and pg_temp.sv(j, 4, 'scrap_weight_g') is null);

  -- ใบเดิม (profile_id null · ทุกขั้น scrap_weight_ask = false): ช่างส่งเศษไม่ได้ · ส่งปกติได้เหมือนเดิม
  j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver', pw));
  perform pg_temp.leg(j);
  perform pg_temp.rw(p_shop, j, 9.9, 3);
  th := pg_temp.newtok(p_shop, j); sh := pg_temp.sess(th, w, '4829');
  r := pg_temp.w_recv(th, sh, 4, 9.900);
  r2 := pg_temp.w_send2(th, sh, 4, 9.0, 0.2);
  v_log := v_log || pg_temp.chk('W4a', 'ใบเดิม (profile_id null · ทุกขั้นไม่ถามเศษ): ช่างส่งเศษ = scrap_weight_not_asked (ตัดสิน: ไม่ยกเว้นใบเดิม — UI ใบเดิมไม่เคยส่งเศษ)',
    (r ->> 'ok') = 'true' and pg_temp.sv(j, 4, 'scrap_weight_ask') = 'false' and (select profile_id is null from analytics.job where id = j)
    and (r2 ->> 'code') = 'scrap_weight_not_asked' and pg_temp.sv(j, 4, 'status') = 'received');
  r := pg_temp.w_send2(th, sh, 4, 9.0, null);
  v_log := v_log || pg_temp.chk('W4b', 'ต้องไม่พัง: ใบเดิม ช่างส่งปกติ (ไม่ส่งเศษ) = ผ่านเหมือนเดิม', (r ->> 'ok') = 'true' and pg_temp.sv(j, 4, 'status') = 'sent');

  -- ทอง: ตัวอย่างโจมตีของ security — in 9.900 · out 8.900 · เศษ 1.000 ที่ขั้นที่ไม่ถามเศษ (ก่อนแก้: ทองหาย 1 g แต่ loss = 0 ไม่มีธง)
  j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'gold', pw));
  perform pg_temp.rw(p_shop, j, 9.9, 3);
  th := pg_temp.newtok(p_shop, j); sh := pg_temp.sess(th, w, '4829');
  r := pg_temp.w_recv(th, sh, 4, 9.900);
  r2 := pg_temp.w_send2(th, sh, 4, 8.9, 1.0);
  v_log := v_log || pg_temp.chk('W5a', 'ทอง: out 8.900 + เศษ 1.000 ที่ขั้น cast (ไม่ถามเศษ) = scrap_weight_not_asked · ข้อความไม่มีตัวเลข (N1) · ขั้นไม่ขยับ',
    (r ->> 'ok') = 'true' and (r2 ->> 'ok') = 'false' and (r2 ->> 'code') = 'scrap_weight_not_asked' and pg_temp.nodigit(r2)
    and pg_temp.sv(j, 4, 'status') = 'received' and pg_temp.sv(j, 4, 'scrap_weight_g') is null);
  r := pg_temp.w_send2(th, sh, 4, 8.9, null);
  v_log := v_log || pg_temp.chk('W5b', 'ทอง: ส่งปกติ out 8.900 = ผ่าน · loss_g = 1.000 (ทองที่หายเห็นเต็ม — เป็นธงได้)', (r ->> 'ok') = 'true' and pg_temp.loss(j, 4) = 1.0);
  -- ทอง ขั้น cut_sprue (ถามเศษ): เศษ 0.95 > ส่วนที่หาย 0.9 = scrap_over (ข้อความไม่มีตัวเลข) · 0.9 พอดี = ผ่าน
  r := pg_temp.w_recv(th, sh, 5, 8.900);
  r2 := pg_temp.w_send2(th, sh, 5, 8.0, 0.95);
  r3 := pg_temp.w_send2(th, sh, 5, 8.0, 0.9);
  v_log := v_log || pg_temp.chk('W8', 'ทอง ขั้นถามเศษ: เศษ 0.950 > ส่วนที่หาย 0.900 = scrap_over · ข้อความไม่มีตัวเลข · เศษ 0.900 พอดี = ผ่าน loss 0',
    (r ->> 'ok') = 'true' and (r2 ->> 'code') = 'scrap_over' and pg_temp.nodigit(r2)
    and (r3 ->> 'ok') = 'true' and pg_temp.loss(j, 5) = 0);
  return v_log;
end;
$s$;

-- ============================================================================
-- Section O — ออฟฟิศ (job_page): ส่งเศษได้ทุกขั้น · scrap_over · เงื่อนไข null · weight_over มาก่อน
-- ============================================================================
create function pg_temp.so(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  v_today date := analytics.job_today();
  pw uuid; j uuid; r jsonb; r2 jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pw := pg_temp.mkprof(p_shop);

  -- O0 ออฟฟิศส่งเศษที่ขั้นที่ไม่ถามเศษ (cast) = ผ่านตามเดิม
  j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver', pw));
  perform pg_temp.rw(p_shop, j, 9.9, 3);
  perform pg_temp.o_recv(p_shop, j, 4, v_today, 9.9, null, 'verify');
  r := pg_temp.o_send2(p_shop, j, 4, v_today, 9.0, 0.5);
  v_log := v_log || pg_temp.chk('O0', 'ต้องไม่พัง: ออฟฟิศส่งเศษ 0.5 ที่ขั้น cast (ไม่ถามเศษ) = ผ่าน · เก็บเศษ · loss_g = 0.400',
    (r ->> 'ok') = 'true' and pg_temp.sv(j, 4, 'scrap_weight_ask') = 'false' and pg_temp.sv(j, 4, 'scrap_weight_g')::numeric = 0.5 and pg_temp.loss(j, 4) = 0.4);

  -- O2/O1 ขอบ: เศษ 0.901 > ส่วนที่หาย 0.900 = scrap_over (22023 hint scrap_over · ไม่มีตัวเลขในข้อความ) · 0.900 พอดี = ผ่าน loss 0
  j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver', pw));
  perform pg_temp.rw(p_shop, j, 9.9, 4);
  perform pg_temp.o_recv(p_shop, j, 5, v_today, 9.9, null, 'verify');
  r := pg_temp.o_send2(p_shop, j, 5, v_today, 9.0, 0.901);
  v_log := v_log || pg_temp.chk('O2', 'ออฟฟิศ: เศษ 0.901 > ส่วนที่หาย 0.900 = 22023 hint scrap_over · ข้อความไม่มีตัวเลข · ขั้นไม่ขยับ',
    pg_temp.rej(r, 'scrap_over') and pg_temp.nodigit(r) and pg_temp.sv(j, 5, 'status') = 'received' and pg_temp.sv(j, 5, 'scrap_weight_g') is null);
  r := pg_temp.o_send2(p_shop, j, 5, v_today, 9.0, 0.900);
  v_log := v_log || pg_temp.chk('O1', 'ต้องไม่พัง: เศษ 0.900 = ส่วนที่หายพอดี = ผ่าน · loss_g = 0 (ไม่ติดลบ)', (r ->> 'ok') = 'true' and pg_temp.loss(j, 5) = 0);

  -- O3 รวมเติมโลหะ: ส่วนที่หาย = in + added - out = 9.900 + 0.500 - 9.000 = 1.400
  j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver', pw));
  perform pg_temp.rw(p_shop, j, 9.9, 4);
  perform pg_temp.o_recv(p_shop, j, 5, v_today, 9.9, null, 'verify');
  r := pg_temp.o_send2(p_shop, j, 5, v_today, 9.0, 1.401, 0, null, 0.5, 'verify เติมโลหะ');
  v_log := v_log || pg_temp.chk('O3a', 'เติมโลหะ 0.500: เศษ 1.401 > 1.400 = scrap_over (ต้องนับ metal_added เข้าส่วนที่หาย)', pg_temp.rej(r, 'scrap_over'));
  r := pg_temp.o_send2(p_shop, j, 5, v_today, 9.0, 1.400, 0, null, 0.5, 'verify เติมโลหะ');
  v_log := v_log || pg_temp.chk('O3b', 'ต้องไม่พัง: เติมโลหะ 0.500 เศษ 1.400 พอดี = ผ่าน · loss_g = 0', (r ->> 'ok') = 'true' and pg_temp.loss(j, 5) = 0);

  -- O4 ไม่มี weight_in (ไม่ชั่งเข้า) → ข้ามด่าน (view ไม่คำนวณ loss) · O5 ไม่มี weight_out → ข้าม
  j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver', pw));
  perform pg_temp.o_recv(p_shop, j, 1, v_today, null, null, 'verify');
  r := pg_temp.o_send2(p_shop, j, 1, v_today, 9.0, 5.0);
  v_log := v_log || pg_temp.chk('O4', 'ไม่มี weight_in: เศษ 5.000 > out 9.000 ก็ไม่ตรวจ scrap_over (ผ่าน · เก็บเศษ · loss ไม่ถูกคำนวณ)',
    pg_temp.sv(j, 1, 'weight_in_g') is null and (r ->> 'ok') = 'true' and pg_temp.sv(j, 1, 'scrap_weight_g')::numeric = 5.0 and pg_temp.loss(j, 1) is null);
  j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver', pw));
  perform pg_temp.o_recv(p_shop, j, 1, v_today, 9.9, null, 'verify');
  r := pg_temp.o_send2(p_shop, j, 1, v_today, null, 5.0);
  v_log := v_log || pg_temp.chk('O5', 'ไม่มี weight_out (ขั้นไม่บังคับชั่ง): เศษ 5.000 ก็ไม่ตรวจ scrap_over (ผ่าน) · fixture: weight_in ถูกเก็บจริง (ไม่ใช่เคสซ้ำกับ O4)',
    pg_temp.sv(j, 1, 'weight_in_g') is not null and pg_temp.sv(j, 1, 'weight_out_g') is null and (r ->> 'ok') = 'true' and pg_temp.sv(j, 1, 'scrap_weight_g')::numeric = 5.0);

  -- O7 weight_over มาก่อน scrap_over (ด่านเดิมไม่ถูกบัง) · O8 เศษชิ้น (qty) ไม่เกี่ยวกับเศษน้ำหนัก
  j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver', pw));
  perform pg_temp.rw(p_shop, j, 9.9, 4);
  perform pg_temp.o_recv(p_shop, j, 5, v_today, 9.9, null, 'verify');
  r := pg_temp.o_send2(p_shop, j, 5, v_today, 10.5, 0.1);
  v_log := v_log || pg_temp.chk('O7', 'out 10.500 > in 9.900 พร้อมเศษ = weight_over (ด่านเดิมมาก่อน ไม่ถูกบังด้วย scrap_over)', pg_temp.rej(r, 'weight_over'));
  r := pg_temp.o_send2(p_shop, j, 5, v_today, 9.0, 0.9, 1, 'broken');
  v_log := v_log || pg_temp.chk('O8', 'ต้องไม่พัง: เศษชิ้น 1 (broken) + เศษน้ำหนัก 0.900 พอดี = ผ่าน · qty_scrap 1 · qty_out 9',
    (r ->> 'ok') = 'true' and pg_temp.sv(j, 5, 'qty_scrap') = '1' and pg_temp.sv(j, 5, 'qty_out') = '9' and pg_temp.loss(j, 5) = 0);
  return v_log;
end;
$s$;

-- ============================================================================
-- Section G — golden: ส่งปกติ (ไม่ส่งเศษน้ำหนัก) ต้องเท่าฉบับ 0172 ทุกข้อความ/ทุกฟิลด์ (เทียบ job_core_send ใหม่ vs ฉบับเดิม pg_temp.core_legacy ในทรานแซกชันย่อยที่ถอยกลับ)
-- ============================================================================
create function pg_temp.diffcase(p_job uuid, p_seq int, p_c jsonb, p_worker uuid, p_channel text, p_enforce boolean) returns text
 language plpgsql as $s$
declare
  v_new jsonb; v_old jsonb; v_rn jsonb; v_ro jsonb;
  v_today date := analytics.job_today();
begin
  begin
    v_new := analytics.job_core_send(p_job, p_seq, v_today, (p_c ->> 'out')::numeric, (p_c ->> 'qty')::int, p_c ->> 'reason',
                                     (p_c ->> 'added')::numeric, p_c ->> 'note', null, p_worker, p_channel, '00000000-0000-0000-0000-0000000000a1'::uuid, null, p_enforce);
    select to_jsonb(s) into v_rn from analytics.job_stage s where s.job_id = p_job and s.seq = p_seq;
    raise exception 'DIFF_ROLLBACK';
  exception when others then
    if sqlerrm <> 'DIFF_ROLLBACK' then v_new := jsonb_build_object('_exc', sqlerrm); end if;
  end;
  begin
    v_old := pg_temp.core_legacy(p_job, p_seq, v_today, (p_c ->> 'out')::numeric, (p_c ->> 'qty')::int, p_c ->> 'reason',
                                 (p_c ->> 'added')::numeric, p_c ->> 'note', null, p_worker, p_channel, '00000000-0000-0000-0000-0000000000a1'::uuid, null, p_enforce);
    select to_jsonb(s) into v_ro from analytics.job_stage s where s.job_id = p_job and s.seq = p_seq;
    raise exception 'DIFF_ROLLBACK';
  exception when others then
    if sqlerrm <> 'DIFF_ROLLBACK' then v_old := jsonb_build_object('_exc', sqlerrm); end if;
  end;
  if v_new is null or v_old is null or v_new is distinct from v_old or v_rn is distinct from v_ro then
    return coalesce(p_c::text, '-') || ' => ใหม่ ' || left(coalesce(v_new::text, '-'), 120) || ' | เดิม ' || left(coalesce(v_old::text, '-'), 120) || '; ';
  end if;
  return '';
end;
$s$;

create function pg_temp.sg(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  v_today date := analytics.job_today();
  pw uuid; w uuid; j uuid; th text; sh text; r jsonb; v_bad text := ''; v_c jsonb; v_n int := 0;
  v_cases constant jsonb := jsonb_build_array(
    jsonb_build_object('out', 9.5, 'qty', 0, 'reason', null, 'added', 0, 'note', null),
    jsonb_build_object('out', 9.9, 'qty', 0, 'reason', null, 'added', 0, 'note', null),
    jsonb_build_object('out', 9.0, 'qty', 2, 'reason', 'broken', 'added', 0, 'note', null),
    jsonb_build_object('out', 9.0, 'qty', 2, 'reason', null, 'added', 0, 'note', null),
    jsonb_build_object('out', 9.0, 'qty', 0, 'reason', 'broken', 'added', 0, 'note', null),
    jsonb_build_object('out', 10.5, 'qty', 0, 'reason', null, 'added', 0, 'note', null),
    jsonb_build_object('out', 0, 'qty', 0, 'reason', null, 'added', 0, 'note', null),
    jsonb_build_object('out', null, 'qty', 0, 'reason', null, 'added', 0, 'note', null),
    jsonb_build_object('out', 10.1, 'qty', 0, 'reason', null, 'added', 0.3, 'note', 'verify เติมโลหะ'),
    jsonb_build_object('out', 10.1, 'qty', 0, 'reason', null, 'added', 0.3, 'note', null),
    jsonb_build_object('out', 9.5, 'qty', 11, 'reason', 'broken', 'added', 0, 'note', null),
    jsonb_build_object('out', 9.5, 'qty', 0, 'reason', null, 'added', 0, 'note', 'หมายเหตุน้ำหนักทั่วไป'));
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pw := pg_temp.mkprof(p_shop);
  w := pg_temp.wid(p_shop, 'v178-ช่าง A', '4829');

  -- G1 ออฟฟิศ (job_page): ขั้น cut_sprue ที่ office รับ · 12 กรณี (ปกติ/ของเสีย/เหตุผล/น้ำหนักเกิน/ศูนย์/ว่าง/เติมโลหะ/หมายเหตุ) ส่งเศษ = null
  j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver', pw));
  perform pg_temp.rw(p_shop, j, 9.9, 4);
  perform pg_temp.o_recv(p_shop, j, 5, v_today, 9.9, null, 'verify');
  for v_c in select value from jsonb_array_elements(v_cases) loop
    v_n := v_n + 1;
    v_bad := v_bad || pg_temp.diffcase(j, 5, v_c, null, 'job_page', false);
  end loop;
  v_log := v_log || pg_temp.chk('G1', format('golden ออฟฟิศ: job_core_send ใหม่ = ฉบับ 0172 ทุกกรณี (%s กรณี · ผลคืน + แถวขั้นหลังเขียน เท่ากันเป๊ะ เมื่อไม่ส่งเศษน้ำหนัก) ', v_n) || v_bad, v_bad = '');

  -- G2 ช่าง (worker_qr): ขั้น cast ที่ช่าง A ถืออยู่ · กรณีเดียวกัน + ช่างอีกคน/วันไม่ใช่วันนี้ไม่เกี่ยว (ใช้ id ช่างจริง · enforce_holder)
  j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver', pw));
  perform pg_temp.rw(p_shop, j, 9.9, 3);
  th := pg_temp.newtok(p_shop, j); sh := pg_temp.sess(th, w, '4829');
  r := pg_temp.w_recv(th, sh, 4, 9.900);
  v_bad := ''; v_n := 0;
  for v_c in select value from jsonb_array_elements(v_cases) loop
    v_n := v_n + 1;
    v_bad := v_bad || pg_temp.diffcase(j, 4, v_c, w, 'worker_qr', true);
  end loop;
  v_bad := v_bad || pg_temp.diffcase(j, 4, jsonb_build_object('out', 9.0, 'qty', 0, 'reason', null, 'added', 0, 'note', null), gen_random_uuid(), 'worker_qr', true);
  v_log := v_log || pg_temp.chk('G2', format('golden ช่าง: job_core_send ใหม่ = ฉบับ 0172 ทุกกรณี (%s กรณี + ผู้ไม่ใช่ผู้ถือ = not_holder เท่าเดิม)', v_n) || ' ' || coalesce((r ->> 'ok'), '-') || ' ' || v_bad,
    (r ->> 'ok') = 'true' and v_bad = '');
  return v_log;
end;
$s$;

-- ============================================================================
-- Section L — ชื่อแบบการบันทึก: upsert hint name_invalid · CHECK ชั้นตาราง (เขียนตรงข้าม RPC) · แถวเดิมผ่าน
-- ============================================================================
create function pg_temp.sl(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  r jsonb; v_id uuid; v_bad text; v_el text; x text; j uuid; pw uuid; v_prof0 int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform analytics.job_record_profile_ensure(p_shop);
  select count(*) into v_prof0 from analytics.job_record_profile where shop_id = p_shop;

  -- L1a-d upsert ปฏิเสธ + hint
  r := pg_temp.pu(p_shop, null, 'v178' || chr(8203) || 'x', null, null);
  v_log := v_log || pg_temp.chk('L1a', 'upsert ชื่อมี U+200B (zero-width space) = 22023 hint name_invalid', pg_temp.rej(r, 'name_invalid'));
  v_bad := '';
  foreach v_el in array array[chr(8238), chr(65279), chr(8294)] loop
    r := pg_temp.pu(p_shop, null, 'v178' || v_el || 'x', null, null);
    if not pg_temp.rej(r, 'name_invalid') then v_bad := v_bad || encode(convert_to(v_el, 'UTF8'), 'hex') || '→' || coalesce(r::text, '-') || '; '; end if;
  end loop;
  v_log := v_log || pg_temp.chk('L1b', 'upsert ชื่อมี U+202E (bidi override) / U+FEFF / U+2066 = name_invalid ทุกแบบ ' || left(v_bad, 200), v_bad = '');
  r := pg_temp.pu(p_shop, null, 'v178<b>x', null, null);
  v_log := v_log || pg_temp.chk('L1c', 'ต้องไม่เปลี่ยน: ชื่อมี < > ยังได้ hint เดิม text_invalid (TS map อยู่แล้ว)', pg_temp.rej(r, 'text_invalid'));
  v_bad := '';
  foreach v_el in array array['', '   ', 'v178' || chr(10) || 'x', 'v178' || chr(9) || 'x', repeat('ก', 61)] loop
    r := pg_temp.pu(p_shop, null, v_el, null, null);
    if not pg_temp.rej(r, 'name_invalid') then v_bad := v_bad || encode(convert_to(v_el, 'UTF8'), 'hex') || '→' || left(coalesce(r::text, '-'), 80) || '; '; end if;
  end loop;
  v_log := v_log || pg_temp.chk('L1d', 'upsert ชื่อว่าง / ช่องว่างล้วน / ขึ้นบรรทัดใหม่ / tab / ยาว 61 = name_invalid (เดิมไม่มี hint) ' || left(v_bad, 200), v_bad = '');
  v_log := v_log || pg_temp.chk('L1d2', 'ไม่ส่งชื่อตอนสร้าง = name_required (hint เดิมไม่เปลี่ยน)', pg_temp.rej(pg_temp.pu(p_shop, null, null, null, null), 'name_required'));

  -- L1e ต้องไม่พัง: ชื่อปกติ (ไทย / อังกฤษ+เลข / อีโมจิธรรมดา) ผ่านทั้ง upsert และ CHECK ตรง
  v_bad := '';
  foreach v_el in array array['v178-ทองชั่งสุทธิ', 'v178 ENG name 01', 'v178 ✨🔥 แบบพิเศษ', 'v178-ก ข ค (ทดสอบ) – แบบ #1'] loop
    r := pg_temp.pu(p_shop, null, v_el, null, null);
    if (r ->> 'id') is null then v_bad := v_bad || v_el || '→' || left(coalesce(r::text, '-'), 100) || '; '; end if;
    x := pg_temp.xr(format('insert into analytics.job_record_profile (shop_id, name) values (%L, %L)', p_shop, v_el || ' direct'));
    if x <> 'OK' then v_bad := v_bad || 'direct:' || v_el || '→' || x || '; '; end if;
  end loop;
  v_log := v_log || pg_temp.chk('L1e', 'ต้องไม่พัง: ชื่อไทย/อังกฤษ+เลข/อีโมจิธรรมดา/วงเล็บ/ขีด ผ่านทั้ง upsert และ INSERT ตรง (CHECK ใหม่) ' || left(v_bad, 240), v_bad = '');

  -- L1f แก้ชื่อแบบเดิมเป็นชื่อไม่ผ่าน = name_invalid · ชื่อเดิมไม่ขยับ
  r := pg_temp.pu(p_shop, null, 'v178-ชื่อเดิม', null, null);
  v_id := (r ->> 'id')::uuid;
  r := pg_temp.pu(p_shop, v_id, 'v178-ชื่อใหม่' || chr(8203), null, null);
  v_log := v_log || pg_temp.chk('L1f', 'upsert แก้ชื่อแบบเดิมเป็นชื่อมี U+200B = name_invalid · ชื่อเดิมไม่ขยับ',
    pg_temp.rej(r, 'name_invalid') and (select name from analytics.job_record_profile where id = v_id) = 'v178-ชื่อเดิม');

  -- L1g CHECK ชั้นตาราง: เขียนตรงข้าม RPC (service_role/postgres) — ชื่อล่องหน/bidi/< >/ยาว 61/ช่องว่างหัว ต้อง 23514
  v_bad := '';
  foreach v_el in array array['v178' || chr(8203) || 'y', 'v178' || chr(8238) || 'y', 'v178' || chr(65279) || 'y', 'v178<y', repeat('ข', 61), ' v178y'] loop
    x := pg_temp.xr(format('insert into analytics.job_record_profile (shop_id, name) values (%L, %L)', p_shop, v_el));
    if x not like 'ERR:23514:%' then v_bad := v_bad || encode(convert_to(v_el, 'UTF8'), 'hex') || '→' || left(x, 60) || '; '; end if;
  end loop;
  x := pg_temp.xr(format('update analytics.job_record_profile set name = %L where id = %L', 'v178' || chr(8203) || 'z', v_id));
  if x not like 'ERR:23514:%' then v_bad := v_bad || 'UPDATE→' || left(x, 60) || '; '; end if;
  v_log := v_log || pg_temp.chk('L1g', 'INSERT/UPDATE ตรง job_record_profile.name มี U+200B/U+202E/U+FEFF/< /ยาว 61/ช่องว่างหัว = 23514 ทุกแบบ ' || left(v_bad, 240), v_bad = '');

  -- L1h job.profile_name (snapshot) — ใบที่มี profile · ปิด trg_job_guard ชั่วคราวเพื่อให้ถึง CHECK (ใน tx ที่ถอยกลับ)
  pw := pg_temp.mkprof(p_shop, 'v178-แบบใบ');
  j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver', pw));
  execute 'alter table analytics.job disable trigger trg_job_guard';
  v_bad := '';
  foreach v_el in array array['v178' || chr(8203) || 'z', 'v178' || chr(8238) || 'z'] loop
    x := pg_temp.xr(format('update analytics.job set profile_name = %L where id = %L', v_el, j));
    if x not like 'ERR:23514:%' then v_bad := v_bad || encode(convert_to(v_el, 'UTF8'), 'hex') || '→' || left(x, 60) || '; '; end if;
  end loop;
  x := pg_temp.xr(format('update analytics.job set profile_name = %L where id = %L', 'v178 ชื่อ ✨ ปกติ', j));
  if x <> 'OK' then v_bad := v_bad || 'ชื่อปกติ→' || left(x, 60) || '; '; end if;
  execute 'alter table analytics.job enable trigger trg_job_guard';
  v_log := v_log || pg_temp.chk('L1h', 'job.profile_name: U+200B/U+202E = 23514 · ชื่อปกติ (ไทย+อีโมจิ) ผ่าน (ต้องไม่พัง) ' || left(v_bad, 240), v_bad = '');

  -- L1j แถวเดิมบนระบบจริงผ่าน oem_note_valid ทั้งหมด (seed 3 แบบ + ใบที่มี profile) · constraint validated (ไม่ใช่ NOT VALID)
  v_log := v_log || pg_temp.chk('L1j', 'แถวเดิม: job_record_profile.name ทุกแถว + job.profile_name ทุกแถวที่ไม่ null ผ่าน oem_note_valid · constraint 2 ตัว validated · ร้านนี้มีแบบเดิม (seed) >= 3 แบบก่อนสร้างเพิ่ม',
    not exists (select 1 from analytics.job_record_profile where not analytics.oem_note_valid(name))
    and not exists (select 1 from analytics.job where profile_name is not null and not analytics.oem_note_valid(profile_name))
    and (select count(*) from pg_constraint where conname in ('jrp_name_ck', 'job_profile_pair_ck') and convalidated) = 2
    and v_prof0 >= 3);
  return v_log;
end;
$s$;

-- ============================================================================
-- Section M — โครงสร้าง: overload · สิทธิ์ (พฤติกรรมจริง) · constraint · wrapper ช่าง/ออฟฟิศยังเรียก core · ข้อมูลเดิม (แจ้ง)
-- ============================================================================
create function pg_temp.sm(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  v_x text; v_bad text; k text; v_n int; v_over int;
  c_core constant text := 'analytics.job_core_send(uuid,int,date,numeric,int,text,numeric,text,numeric,uuid,text,uuid,text,boolean)';
  c_ups constant text := 'analytics.job_record_profile_upsert(uuid,uuid,text,text,jsonb,boolean,int,boolean,uuid)';
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select string_agg(proname || '=' || n, ', ') into v_x from (
    select proname, count(*) n from pg_proc where pronamespace = 'analytics'::regnamespace
      and proname in ('job_core_send', 'job_record_profile_upsert', 'job_worker_send', 'job_office_send') group by proname having count(*) <> 1) z;
  select count(*) into v_n from pg_proc where pronamespace = 'analytics'::regnamespace and proname in ('job_core_send', 'job_record_profile_upsert', 'job_worker_send', 'job_office_send');
  v_log := v_log || pg_temp.chk('M1', 'ฟังก์ชันที่เกี่ยว 4 ตัว (core/upsert/worker_send/office_send) มี signature เดียวทุกตัว (ไม่เกิด overload) ' || coalesce(v_x, ''), v_x is null and v_n = 4);

  v_log := v_log || pg_temp.chk('M2a', 'acl: job_core_send ไม่มีใครรันได้ (anon/authenticated/service_role) · job_record_profile_upsert = service_role เท่านั้น',
    not has_function_privilege('anon', c_core, 'execute') and not has_function_privilege('authenticated', c_core, 'execute') and not has_function_privilege('service_role', c_core, 'execute')
    and has_function_privilege('service_role', c_ups, 'execute') and not has_function_privilege('anon', c_ups, 'execute') and not has_function_privilege('authenticated', c_ups, 'execute'));
  execute 'grant usage on schema analytics to authenticated';  -- จำลองวันที่กำแพงชั้นนอกหลุด (ถอยกลับพร้อม section)
  v_bad := '';
  foreach k in array array[
    'select analytics.job_core_send(null::uuid, null::int, null::date, null::numeric, null::int, null::text, null::numeric, null::text, null::numeric, null::uuid, null::text, null::uuid, null::text, null::boolean)',
    'select analytics.job_record_profile_upsert(null::uuid)'] loop
    v_x := pg_temp.as_role('authenticated', k);
    if v_x not like 'ERR:42501:%' then v_bad := v_bad || ' authenticated:' || left(k, 40) || '=' || left(v_x, 40); end if;
  end loop;
  v_x := pg_temp.as_role('service_role', 'select analytics.job_core_send(null::uuid, null::int, null::date, null::numeric, null::int, null::text, null::numeric, null::text, null::numeric, null::uuid, null::text, null::uuid, null::text, null::boolean)');
  if v_x not like 'ERR:42501:%' then v_bad := v_bad || ' service_role:core=' || left(v_x, 40); end if;
  v_x := pg_temp.as_role('service_role', 'select analytics.job_record_profile_upsert(null::uuid)');
  if v_x not like 'ERR:22023:%' then v_bad := v_bad || ' service_role:upsert(ต้องถึง body 22023)=' || left(v_x, 50); end if;
  v_log := v_log || pg_temp.chk('M2b', 'พฤติกรรมจริง: authenticated เรียก core/upsert = 42501 · service_role เรียก core = 42501 (ภายใน) · service_role เรียก upsert ถึง body (22023) ' || v_bad, v_bad = '');

  select count(*) into v_n from pg_constraint c where c.conrelid = 'analytics.job_record_profile'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%btrim(name)%';
  v_log := v_log || pg_temp.chk('M4', 'CHECK: job_record_profile มีตัวตรวจชื่อ 1 ตัว (jrp_name_ck ไม่ซ้ำกับของเก่า) มี oem_note_valid · job_profile_pair_ck มี oem_note_valid(profile_name) · ยังกัน < > และยาว 60',
    v_n = 1
    and exists (select 1 from pg_constraint c where c.conrelid = 'analytics.job_record_profile'::regclass and c.conname = 'jrp_name_ck'
                  and pg_get_constraintdef(c.oid) like '%oem_note_valid(name)%' and pg_get_constraintdef(c.oid) like '%<>%' and pg_get_constraintdef(c.oid) like '%60%')
    and exists (select 1 from pg_constraint c where c.conrelid = 'analytics.job'::regclass and c.conname = 'job_profile_pair_ck'
                  and pg_get_constraintdef(c.oid) like '%oem_note_valid(profile_name)%' and pg_get_constraintdef(c.oid) like '%<>%' and pg_get_constraintdef(c.oid) like '%60%'));

  v_log := v_log || pg_temp.chk('M3', 'wrapper ช่าง (job_worker_send) และออฟฟิศ (job_office_send) ยังเรียก job_core_send ตัวเดียวกัน · ช่องช่างส่งช่อง worker_qr เท่านั้น',
    pg_get_functiondef('analytics.job_worker_send(text,text,int,numeric,int,text,numeric,text,numeric,text,text)'::regprocedure) like '%job_core_send(%''worker_qr''%'
    and pg_get_functiondef('analytics.job_office_send(uuid,uuid,int,date,numeric,int,text,numeric,text,numeric,text,uuid)'::regprocedure) like '%job_core_send(%'
    and pg_get_functiondef('analytics.job_office_send(uuid,uuid,int,date,numeric,int,text,numeric,text,numeric,text,uuid)'::regprocedure) like '%job_page%daily_sheet%');

  -- แจ้งอย่างเดียว: ขั้นที่ส่งไปแล้วซึ่งเศษมากกว่าส่วนที่หาย (ก่อน 0178 ส่งแบบนี้ได้)
  select count(*) into v_over from analytics.job_stage s
   where s.weight_in_g is not null and s.weight_out_g is not null and s.scrap_weight_g is not null and s.scrap_weight_g > s.weight_in_g + s.metal_added_g - s.weight_out_g;
  v_log := v_log || case when v_over = 0 then pg_temp.chk('H1', 'ข้อมูลเดิม: ไม่มีขั้นที่ scrap > ส่วนที่หาย (ไม่มีเคสจริงที่ด่าน scrap_over จะขัดกับข้อมูลที่ออฟฟิศบันทึกไว้)', true)
                         else format(E'[SKIP] H1  ข้อมูลเดิม: พบ %s ขั้นที่ scrap_weight_g > ส่วนที่หาย (loss ติดลบ) — ไม่ใช่ความล้มเหลวของ migration แต่ต้องรายงาน Tech Lead\n', v_over) end;
  return v_log;
end;
$s$;

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
      v := coalesce(v, '') || format(E'[FAIL] %s  section ล้มด้วย exception: %s\n   %s\n', p_fn, sqlerrm, left(v_ctx, 400));
    end if;
  end;
  return coalesce(v, '');
end;
$c$;

create function pg_temp.run_all(p_shop uuid, p_tpl uuid) returns text
 language sql as $c$
  select pg_temp.run_sec('sw', p_shop, p_tpl) || pg_temp.run_sec('so', p_shop, p_tpl) || pg_temp.run_sec('sg', p_shop, p_tpl)
      || pg_temp.run_sec('sl', p_shop, p_tpl) || pg_temp.run_sec('sm', p_shop, p_tpl)
$c$;

-- label ของเคส -> section ที่รันเคสนั้น (mutant รันเฉพาะ section ที่ expect อยู่)
create function pg_temp.sec_of(p_label text) returns text language sql as $c$
  select case
    when p_label like 'W%' then 'sw'
    when p_label like 'O%' then 'so'
    when p_label like 'G%' then 'sg'
    when p_label like 'L%' then 'sl'
    else 'sm' end $c$;
create function pg_temp.run_for(p_expect jsonb, p_shop uuid, p_tpl uuid) returns text language plpgsql as $c$
declare v text := ''; s text;
begin
  for s in select distinct pg_temp.sec_of(e) from jsonb_array_elements_text(p_expect) e order by 1 loop
    v := v || pg_temp.run_sec(s, p_shop, p_tpl);
  end loop;
  return v;
end;
$c$;

do $v178$
declare
  v_shop uuid; v_tpl uuid;
  v_log text := ''; v_s text; v_fail int; v_snap0 text; v_d0 text;
  v_m record; v_killed int := 0; v_total int; v_survived text := ''; v_cnt int; v_id text; v_hit int; v_skip int; v_ok_cnt int;
  c_core constant text := 'analytics.job_core_send(uuid, int, date, numeric, int, text, numeric, text, numeric, uuid, text, uuid, text, boolean)';
  c_gate constant text := 'if p_channel = ''worker_qr'' and p_scrap_weight is not null and not v_s.scrap_weight_ask then';
  v_mutants jsonb := jsonb_build_array(
    jsonb_build_object('id', 'MU-1', 'what', 'ถอดด่าน scrap_weight_not_asked (ช่างส่งเศษที่ขั้นไม่ถามได้ — ช่องที่ security เจอ)', 'fn', 'job_core_send',
      'from', c_gate, 'to', 'if false then', 'expect', jsonb_build_array('W2a', 'W2c', 'W4a', 'W5a')),
    jsonb_build_object('id', 'MU-2', 'what', 'ด่าน not_asked ใช้กับออฟฟิศด้วย (ออฟฟิศส่งเศษขั้นไม่ถามไม่ได้ — ผิดข้อกำหนด)', 'fn', 'job_core_send',
      'from', c_gate, 'to', 'if p_scrap_weight is not null and not v_s.scrap_weight_ask then', 'expect', jsonb_build_array('O0', 'O4', 'O5')),
    jsonb_build_object('id', 'MU-3', 'what', 'ใบเดิม (profile_id null) ได้ยกเว้นจากด่าน not_asked', 'fn', 'job_core_send',
      'from', 'and not v_s.scrap_weight_ask then', 'to', 'and not v_s.scrap_weight_ask and v_job.profile_id is not null then', 'expect', jsonb_build_array('W4a')),
    jsonb_build_object('id', 'MU-4', 'what', 'ถอดด่าน scrap_over (เศษเกินส่วนที่หาย → loss ติดลบ)', 'fn', 'job_core_send',
      'from', 'p_scrap_weight > v_room then', 'to', 'p_scrap_weight > v_room + 1000000 then', 'expect', jsonb_build_array('W7', 'W8', 'O2', 'O3a')),
    jsonb_build_object('id', 'MU-5', 'what', 'scrap_over ใช้ >= (เศษพอดีส่วนที่หายถูกปฏิเสธ)', 'fn', 'job_core_send',
      'from', 'p_scrap_weight > v_room then', 'to', 'p_scrap_weight >= v_room then', 'expect', jsonb_build_array('W1', 'O1', 'O3b', 'O8')),
    jsonb_build_object('id', 'MU-6', 'what', 'scrap_over ไม่นับ metal_added (เติมโลหะแล้วเศษถูกปฏิเสธเกิน)', 'fn', 'job_core_send',
      'from', 'v_s.weight_in_g + v_added - p_weight_out end', 'to', 'v_s.weight_in_g - p_weight_out end', 'expect', jsonb_build_array('O3b')),
    jsonb_build_object('id', 'MU-7', 'what', 'scrap_over ถือ null เป็น 0 (ไม่มี weight_in/out แล้วถูกปฏิเสธ)', 'fn', 'job_core_send',
      'from', 'case when p_weight_out is not null and v_s.weight_in_g is not null then v_s.weight_in_g + v_added - p_weight_out end',
      'to', 'coalesce(v_s.weight_in_g, 0) + v_added - coalesce(p_weight_out, 0)', 'expect', jsonb_build_array('O4', 'O5')),
    jsonb_build_object('id', 'MU-8', 'what', 'ข้อความ scrap_over มีตัวเลขน้ำหนัก (N1 ทอง)', 'fn', 'job_core_send',
      'from', '''น้ำหนักเศษมากกว่าส่วนที่หายไป — ชั่งใหม่''', 'to', '''น้ำหนักเศษมากกว่าส่วนที่หายไป '' || v_room::text', 'expect', jsonb_build_array('W7', 'W8', 'O2')),
    jsonb_build_object('id', 'MU-9', 'what', 'ข้อความ not_asked มีตัวเลขน้ำหนักที่ช่างส่งมา', 'fn', 'job_core_send',
      'from', '''ขั้นนี้ไม่ได้บันทึกเศษโลหะ — โหลดหน้าใหม่''', 'to', '''ขั้นนี้ไม่ได้บันทึกเศษโลหะ '' || p_scrap_weight::text', 'expect', jsonb_build_array('W2a', 'W5a')),
    jsonb_build_object('id', 'MU-10', 'what', 'ถอดด่าน weight_over (ด่านเดิมหาย — golden/O7 ต้องจับ)', 'fn', 'job_core_send',
      'from', 'if p_weight_out is not null and v_s.weight_in_g is not null and p_weight_out > v_s.weight_in_g + v_added then', 'to', 'if false then', 'expect', jsonb_build_array('G1', 'G2', 'O7')),
    jsonb_build_object('id', 'MU-11', 'what', 'ด่าน not_asked อยู่ก่อนด่านผู้ถือ (ช่างที่ไม่ใช่ผู้ถือได้ error เรื่องเศษ) — ย้ายเงื่อนไขไปก่อนตรวจ not_holder', 'fn', 'job_core_send',
      'from', 'if p_enforce_holder and v_s.worker_id is distinct from p_worker_id then',
      'to', 'if p_channel = ''worker_qr'' and p_scrap_weight is not null and not v_s.scrap_weight_ask then return analytics.job_fail(''scrap_weight_not_asked'', ''x''); end if;
  if p_enforce_holder and v_s.worker_id is distinct from p_worker_id then', 'expect', jsonb_build_array('W6')),
    jsonb_build_object('id', 'MU-12', 'what', 'CHECK ชื่อแบบกลับเป็นของเดิม (ไม่มี oem_note_valid)', 'ddl',
      'alter table analytics.job_record_profile drop constraint jrp_name_ck; alter table analytics.job_record_profile add constraint jrp_name_ck check (name = btrim(name) and length(name) between 1 and 60 and name !~ ''[<>]'')',
      'expect', jsonb_build_array('L1g', 'M4')),
    jsonb_build_object('id', 'MU-13', 'what', 'CHECK job.profile_name กลับเป็นของเดิม (ไม่มี oem_note_valid)', 'ddl',
      'alter table analytics.job drop constraint job_profile_pair_ck; alter table analytics.job add constraint job_profile_pair_ck check ((profile_id is null) = (profile_name is null) and (profile_name is null or (length(profile_name) between 1 and 60 and profile_name !~ ''[<>]'')))',
      'expect', jsonb_build_array('L1h', 'M4')),
    jsonb_build_object('id', 'MU-14', 'what', 'upsert hint ชื่อไม่ผ่านกลับเป็น text_invalid (name_invalid หาย)', 'fn', 'job_record_profile_upsert',
      'from', 'hint = coalesce(nullif(v_hint, ''''), ''name_invalid'')', 'to', 'hint = coalesce(nullif(v_hint, ''''), ''text_invalid'')', 'expect', jsonb_build_array('L1a', 'L1b', 'L1d')),
    jsonb_build_object('id', 'MU-15', 'what', 'upsert ทับ hint text_invalid ของ < > ด้วย name_invalid (เปลี่ยนสัญญาเดิม)', 'fn', 'job_record_profile_upsert',
      'from', 'hint = coalesce(nullif(v_hint, ''''), ''name_invalid'')', 'to', 'hint = ''name_invalid''', 'expect', jsonb_build_array('L1c')),
    jsonb_build_object('id', 'MU-16', 'what', 'job_core_send ถูก grant ให้ service_role (ควรเป็นภายใน)', 'ddl',
      'grant execute on function ' || c_core || ' to service_role', 'expect', jsonb_build_array('M2a', 'M2b'))
  );
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select id into v_shop from public.shop order by created_at limit 1;
  select i.id into v_tpl from analytics.oem_quote_item i join analytics.oem_quote q on q.id = i.quote_id
   where i.shop_id = v_shop and i.input ->> 'metal' = 'silver' and q.quote_no not like 'V17%' order by q.created_at, i.seq limit 1;
  if v_tpl is null then
    v_log := v_log || '[FAIL] S0  ไม่มี oem_quote_item เงินจริงให้ใช้เป็นแม่แบบโคลน — ชุดทดสอบรันต่อไม่ได้' || E'\n';
    raise exception E'%', v_log;
  end if;

  create temp table _v178_orig on commit drop as
    select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h
      from pg_proc p where p.pronamespace = 'analytics'::regnamespace and (p.proname like 'job\_%' or p.proname like 'worker\_%');

  v_snap0 := pg_temp.snap(); v_d0 := pg_temp.snap_d();
  v_s := pg_temp.run_all(v_shop, v_tpl);
  v_log := v_log || v_s;
  v_log := v_log || pg_temp.chk('K0', 'หลังรัน: แถวตารางใบงาน/ช่าง/ตัวนับ/แบบการบันทึก + ตาราง OEM/ผลิต/สต็อก (นับ + md5) เท่าเดิมเป๊ะ — ทุก section ถอยกลับ', pg_temp.snap() = v_snap0);
  v_ok_cnt := (length(v_s) - length(replace(v_s, '[OK]', ''))) / 4;

  v_total := jsonb_array_length(v_mutants);
  for v_m in select value as m from jsonb_array_elements(v_mutants) loop
    v_id := v_m.m ->> 'id';
    v_s := '';
    begin
      if v_m.m ? 'ddl' then
        execute v_m.m ->> 'ddl';
      else
        perform pg_temp.mutate(v_m.m ->> 'fn', v_m.m ->> 'from', v_m.m ->> 'to');
      end if;
      v_s := pg_temp.run_for(v_m.m -> 'expect', v_shop, v_tpl);
      raise exception 'MUTANT_DONE';
    exception when others then
      if sqlerrm <> 'MUTANT_DONE' then
        v_log := v_log || format(E'[FAIL] %s  ใช้ mutant ไม่ได้: %s\n', v_id, sqlerrm);
        v_s := 'ERR';
      end if;
    end;
    v_hit := 0;
    for v_cnt in 0 .. jsonb_array_length(v_m.m -> 'expect') - 1 loop
      if position('[FAIL] ' || (v_m.m -> 'expect' ->> v_cnt) || ' ' in v_s) > 0 then
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

  select count(*) into v_cnt from _v178_orig o where md5(pg_get_functiondef(to_regprocedure(o.sig))) = o.h;
  v_log := v_log || pg_temp.chk('MY', format('หลังรัน mutant: md5 definition ของฟังก์ชัน job_*/worker_* ทั้ง %s ตัวเท่าเดิม · trigger ใบงาน/แบบเปิดครบ · constraint ชื่อ 2 ตัวกลับมา validated · grant core ไม่เปลี่ยน', (select count(*) from _v178_orig)),
    v_cnt = (select count(*) from _v178_orig)
    and not exists (select 1 from pg_trigger t where t.tgrelid in ('analytics.job'::regclass, 'analytics.job_stage'::regclass, 'analytics.job_event'::regclass,
                                                                  'analytics.job_record_profile'::regclass, 'analytics.job_record_profile_stage'::regclass) and not t.tgisinternal and t.tgenabled <> 'O')
    and (select count(*) from pg_constraint where conname in ('jrp_name_ck', 'job_profile_pair_ck') and convalidated and pg_get_constraintdef(oid) like '%oem_note_valid%') = 2
    and not has_function_privilege('service_role', c_core, 'execute'));
  v_s := pg_temp.run_all(v_shop, v_tpl);
  v_fail := (length(v_s) - length(replace(v_s, '[FAIL]', ''))) / 6;
  v_log := v_log || pg_temp.chk('MZ', 'หลังคืนของเดิม: ชุดเทสต์หลักรันซ้ำ FAIL ' || v_fail, v_fail = 0);
  if v_fail > 0 then
    v_log := v_log || (select string_agg('    (รันซ้ำ) ' || l, E'\n') from unnest(string_to_array(v_s, E'\n')) l where l like '[FAIL]%') || E'\n';
  end if;
  v_log := v_log || pg_temp.chk('K0c', 'state ไม่ขยับหลังรัน mutant ทั้งหมด' || coalesce((select ' ขยับ: ' || string_agg(split_part(a, '=', 1), ',') from unnest(string_to_array(v_d0, chr(10))) a
    where a <> '' and not (a = any (string_to_array(pg_temp.snap_d(), chr(10))))), ''), pg_temp.snap() = v_snap0);

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_skip := (length(v_log) - length(replace(v_log, '[SKIP]', ''))) / 6;
  v_log := v_log || format(E'\n=== สรุป: [OK] ~%s · [FAIL] ทั้งไฟล์ = %s · [SKIP] = %s %s ===\n', v_ok_cnt, v_fail, v_skip, case when v_fail = 0 then '(ผ่าน)' else '(ไม่ผ่าน)' end);
  raise exception E'%', v_log;
end;
$v178$;
