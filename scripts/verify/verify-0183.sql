-- scripts/verify/verify-0183.sql
-- ตรวจ supabase/migrations/0183_job_discrepancy_arrive.sql (ส่วนต่างรอชี้แจง ทางที่ 3 "ได้รับเพิ่มแล้ว" · มติเจ้าของ 20 ต.ค. 69)
-- self-rolling-back (3j-migration-traps ข้อ 11) · ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน · ข้อมูลทดสอบสร้างผ่าน RPC ของระบบเองทั้งหมด
--   (ข้อยกเว้นที่บอกตรงๆ: ใบเสนอราคา OEM = โคลนจากรายการจริงด้วย INSERT ในทรานแซกชันที่ถอยกลับ · section E/B เลี่ยง guard ด้วย disable trigger / UPDATE ตรงเพื่อทดสอบว่า drift จับได้ — ในทรานแซกชันที่ถอยกลับเช่นกัน)
-- รอบแรก = ของจริง · รอบถัดไป = mutant (ทุกตัวต้องล้ม ไม่งั้น MX FAIL) · ปิดท้ายตรวจ md5 ฟังก์ชันทุกตัวเท่าเดิม + รันชุดหลักซ้ำ + state ไม่ขยับ
-- 🔴 ไฟล์นี้ต้องรันหลัง Tech Lead ส่งข้อความ "รันได้" เท่านั้น (สร้างใบงานทดสอบหลายสิบใบในทรานแซกชัน — ล็อกตาราง job นานช่วงรัน)
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0183.sql
-- dry-run ก่อน apply: ต่อไฟล์ migration + ไฟล์นี้จาก git blob (ไม่ใช่ working tree CRLF) แล้วรันไม่ใส่ --commit
--
-- ============ ตารางแมป "ข้อในบรีฟ 20 ต.ค. -> เทสต์ที่ครอบ" ============
--  RPC ช่าง job_worker_discrepancy_arrive — ผู้มีสิทธิ์ = ช่างที่เป็นผู้รับของขั้นที่รับขาดเท่านั้น          -> A1 A2a B2 C1a · MU (ผู้รับ/resolve)
--  RPC ออฟฟิศ job_discrepancy_arrive — กรอกแทน เลือกผู้ถือ/วันรับ · ไม่เลือกผู้ถือ = ผู้รับเดิม             -> A7a A7b B7a B7b B8 B3b · MU (ผู้ถือ/วัน/ร้าน)
--  1 ≤ qty ≤ ส่วนต่างที่ยัง open                                                                          -> B1 · MU
--  ได้ไม่ครบ → ที่เหลือยัง open (แยกแถว · ผลรวม/ประวัติชัด: void แถวเดิม + arrived + open ที่เหลือ)         -> A2a A2b A3 E5 · ครบ → resolved kind arrived -> A3 B4b
--  ชิ้นที่มาถึง → ส่วนใหม่ (ส่วนย่อยของใบแม่) ที่ขั้นรับขาด received ผู้ถือ = คนกด/ที่ออฟฟิศเลือก            -> A2c A7a A7b A6 (ที่ขั้นแพ็ก)
--  ขั้นก่อนหน้าของส่วนใหม่ = skipped split_inherit · ส่วนใหม่เดินต่อตามปกติ                                  -> A2c A6 A4a
--  ผลรวมต้นไม้ = เริ่มผลิตเสมอ · v_job_tree_drift ว่าง · ปิด full ได้เมื่อส่วนต่างไม่ open                  -> A2e A3 A5a A5b E0 E5 · C3 (แยกส่วนเดิม)
--  ทอง: ขั้นที่รับตั้งชั่ง → ต้องชั่งชิ้นที่มาถึง · เพดาน ≤ (ส่งออกขั้นก่อน − รับเข้าเดิม) + 0.05 g          -> D0 D1 D2a D2b D3a D3b D4 D6b · MU
--  บันทึก gap (แถวที่เหลือ + event) · ไม่แสดงน้ำหนักให้ช่าง (N1: response/action/ข้อความ)                    -> D3a D5 D2a D1 (nodigit/keys)
--  [security H1] ด่านน้ำหนักสองทิศ (หนักเกิน/ปิดทั้งก้อนเบาเกิน = arrive_heavy รหัสเดียว) · ไม่มีน้ำหนักอ้างอิง = ช่างไม่ได้ · ตัวนับต่อขั้น · ออฟฟิศเบาเกินผ่าน+residual_g · แถว arrived เก็บน้ำหนัก (ธง excess)  -> D9a D9a2 D9b D9c D9d D3a D4 · MU (7 ตัว)
--  [security M1] job_done_ck เป็น <= ไม่เรียกฟังก์ชัน (ความเท่ากันเป๊ะที่ job_done + drift)  -> F6 A5a A5b · MU (DDL)
--  [security M2] เพดานสำรองหักน้ำหนักที่ arrive ไปแล้ว  -> D10 · MU
--  [security L2] arrive_mismatch ยังไม่นับใน tree_handoff_mismatch_count — ไม่มี (หนี้ · ต้อง replace v_job_board) · L3/L4 ตามรายงาน security
--  ส่วนต่างทองที่ L-2 ล็อก → ช่างกด arrive ได้ แต่ต้องผ่านด่านน้ำหนัก                                        -> D6a D6b
--  เงิน/ทองขั้นไม่ชั่ง: นับจำนวนอย่างเดียว · ส่งน้ำหนักมา = weight_unexpected                                -> B6 D7 · MU
--  event ใหม่ discrepancy_arrive (+create/skip/receive ของส่วนใหม่ · v_job_stage_from_events ไม่ drift)       -> A2d D3a A7a F6 F8
--  ห้ามแก้ตรรกะ resolve/void เดิม · ใบที่ไม่มีส่วนต่าง = เดิมเป๊ะ                                           -> C1b C1c C1d · C2a C2b C2c (golden เทียบฉบับก่อน 0183) · C3
--  job_worker_resolve คืน action arrive ให้ผู้รับ (my_actions) · ผู้อื่น/ก่อน PIN ไม่เห็น                   -> A1 D5 C2c C1a · MU
--  ❌ ห้ามผ่าน: qty 0/ติดลบ/เกิน open · ช่างไม่ใช่ผู้รับ · ส่วนต่างใบอื่น/ร้านอื่น · resolved/void แล้ว         -> B1 B2 B3a B3b B4a B4b C1b C1c C1d
--     ทองไม่ชั่ง/ชั่งเกิน/ชั่งไม่ผ่าน 3 ครั้ง · ใบ done/cancelled/on_hold · กดซ้ำ/CAS · วัน/ผู้ถือผิด        -> D1 D2a D2b D3b D6b · B9a B9b · B4b B5 · B7a B7b B8 · B10 (ขั้นผู้รับถูกย้อน → ต้อง void)
--  ด่านกันเขียนตรง (security): arrived เกิดทางเดียว · void/UPDATE แถว arrived ไม่ได้ · flag ล้างหลังใช้      -> C4a C4b C4c C4d C4e
--     ส่วนจาก arrive ย้อนขั้น/ผูกใหม่/ผูกข้ามใบไม่ได้ · ตรวจจับข้อมูลเพี้ยน (drift) 4 แบบ                    -> C4f C4g C4h · E1 E2 E3 E4
--  สิทธิ์ (migration-traps ข้อ 2/7/18): service_role เท่านั้น · 4 ชื่อ · ไม่มี overload · search_path       -> F1 F2 F3 F4 F5 F6 F7 · MY (md5 ทุกฟังก์ชัน)
--  กติกาเหล็ก: state ไม่ขยับ (ตัวนับเลขใบงาน/ทุกตาราง) · ฟังก์ชันอื่นไม่ถูกแตะ                                  -> K0 K0c MY MZ
--  mutant: ดูรายการท้ายไฟล์ (MU-1..) · MX ต้องจับครบ
--
--  ❌ ไม่มีเทสต์ครอบ (บอกตรงๆ):
--    - race หลาย connection (2 มือถือกดพร้อมกัน) — do-block ทรานแซกชันเดียวจำลองไม่ได้ · ครอบด้วยการล็อกแถวแม่ (job_worker_auth/job_office_begin) + CAS p_expected_open + ด่าน already_resolved (B4b B5 ครอบเคสกดซ้ำแบบเรียงลำดับ)
--    - ฝั่ง TS/PostgREST/หน้า /w/ จริง = ไม่มี (vitest ฝั่ง lib/ ครอบ signature + allowlist) · UI ปิดใบ (ต้องหัก qty_discrepancy_arrived) = ไม่มี
--    - วันรับของช่างผ่าน QR ที่ถูกปฏิเสธ (ช่างไม่มีพารามิเตอร์วัน = วันนี้เสมอ ด่านวันของช่องช่างไม่มีทางถูกยิงจากภายนอก) — ไม่มีเทสต์
--    - ผู้ถือที่ออฟฟิศเลือกเป็นช่างของ "ร้านอื่น" (who_invalid ด้านร้าน) — มีร้านเดียวบน DB นี้ · ครอบเฉพาะช่างไม่มีอยู่/ปิดใช้งาน (B8)
--    - รายงานน้ำหนักระดับต้นไม้ (v_job_board.tree_*) ยังไม่รู้จัก arrive — เป็นหนี้ที่บันทึกในหัว migration (ไม่มีเทสต์)
--    - view ที่เปลี่ยน (v_job_tree / v_job_tree_drift) ครอบด้วย mutant แบบแก้ definition ของ view ใน subtransaction (MU ชนิด view) ไม่ใช่การอ่านโค้ด
--    - ส่วนจาก arrive "คืนชิ้น" ไม่ได้ (A4b ยืนยันว่าปฏิเสธ not_lot) — เป็นข้อจำกัดโดยออกแบบ ไม่ใช่บั๊ก
--
-- ชุดนี้ยาวเกินเพดาน statement_timeout ปริยายของ pooler (เคยถูกตัดที่ 57014 ตอนรัน verify-0181) — ตั้งเพดานเฉพาะทรานแซกชันนี้
set local statement_timeout = '45min';

-- ===== helper (ลอกตรงจาก verify-0181 + เฉพาะ 0183) =====
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
create function pg_temp.ws(p_tokh text, p_sesh text, p_seq int, p_lot uuid default null, p_qty_send int default null, p_hold int default null,
                           p_scrap int default 0, p_reason text default null, p_wout numeric default null, p_added numeric default null,
                           p_scrap_w numeric default null, p_note text default null, p_wmove numeric default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_worker_send(p_token_hash=>%L, p_session_hash=>%L, p_expected_seq=>%L, p_lot_job_id=>%L, p_qty_send=>%L, p_qty_hold=>%L,
      p_qty_scrap=>%L, p_scrap_reason=>%L, p_weight_out_g=>%L, p_metal_added_g=>%L, p_scrap_weight_g=>%L, p_weight_note=>%L, p_weight_move_g=>%L, p_user_agent=>%L)',
    p_tokh, p_sesh, p_seq, p_lot, p_qty_send, p_hold, p_scrap, p_reason, p_wout, p_added, p_scrap_w, p_note, p_wmove, 'verify-ua/1.0')) $c$;
create function pg_temp.wr(p_tokh text, p_sesh text, p_seq int, p_lot uuid default null, p_qty int default null, p_w numeric default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_worker_receive(p_token_hash=>%L, p_session_hash=>%L, p_expected_seq=>%L, p_lot_job_id=>%L, p_qty_received=>%L, p_weight_in_g=>%L, p_user_agent=>%L)',
    p_tokh, p_sesh, p_seq, p_lot, p_qty, p_w, 'verify-ua/1.0')) $c$;
create function pg_temp.wd(p_tokh text, p_sesh text, p_disc uuid, p_kind text, p_reason text) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_worker_discrepancy_resolve(p_token_hash=>%L, p_session_hash=>%L, p_discrepancy_id=>%L, p_kind=>%L, p_reason=>%L, p_user_agent=>%L)',
    p_tokh, p_sesh, p_disc, p_kind, p_reason, 'verify-ua/1.0')) $c$;
create function pg_temp.wc(p_tokh text, p_sesh text, p_lot uuid, p_reason text default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_worker_lot_cancel(p_token_hash=>%L, p_session_hash=>%L, p_lot_job_id=>%L, p_reason=>%L, p_user_agent=>%L)',
    p_tokh, p_sesh, p_lot, p_reason, 'verify-ua/1.0')) $c$;
create function pg_temp.jv(p_job uuid, p_col text) returns text language plpgsql as $c$
declare v text;
begin
  execute format('select %I::text from analytics.job where id = %L', p_col, p_job) into v;
  return v;
end $c$;
create function pg_temp.dcount(p_root uuid) returns int language sql as $c$ select count(*)::int from analytics.v_job_tree_drift where root_job_id = p_root $c$;
create function pg_temp.sumok(p_root uuid) returns boolean language sql as $c$ select coalesce((select sum_check from analytics.v_job_tree_summary where root_job_id = p_root), false) $c$;
create function pg_temp.disc_of(p_job uuid) returns uuid language sql as $c$
  select d.id from analytics.job_discrepancy d where d.job_id = p_job and d.status = 'open' and not exists (select 1 from analytics.job_discrepancy v where v.void_of_id = d.id) order by d.created_at limit 1 $c$;
create function pg_temp.sdrift(p_root uuid) returns int language sql as $c$
  select count(*)::int from analytics.v_job_stage_from_events e join analytics.job j on j.id = e.job_id
   where (j.id = p_root or j.parent_job_id = p_root) and e.drift $c$;
create function pg_temp.d_status(p_disc uuid) returns text language sql as $c$ select status from analytics.job_discrepancy where id = p_disc $c$;
create function pg_temp.nlots(p_root uuid) returns int language sql as $c$ select count(*)::int from analytics.job where parent_job_id = p_root $c$;
create function pg_temp.held_code(p_job uuid) returns text language sql as $c$ select stage_code from analytics.job_stage where job_id = p_job and status = 'received' limit 1 $c$;
create function pg_temp.nodigit(r jsonb) returns boolean
 language sql as $c$ select coalesce(coalesce(r ->> 'message', r ->> '_err') !~ '[0-9]', false) $c$;
create function pg_temp.keys_of(p_j jsonb) returns text[] language plpgsql as $c$
declare r record; v text[] := '{}'; e jsonb;
begin
  if jsonb_typeof(p_j) = 'object' then
    for r in select key, value from jsonb_each(p_j) loop
      v := v || r.key || pg_temp.keys_of(r.value);
    end loop;
  elsif jsonb_typeof(p_j) = 'array' then
    for e in select value from jsonb_array_elements(p_j) loop v := v || pg_temp.keys_of(e); end loop;
  end if;
  return v;
end $c$;
create function pg_temp.clean_keys(p_j jsonb) returns boolean language sql as $c$
  select not exists (select 1 from unnest(pg_temp.keys_of(p_j)) k where k ~* '(cost|price|thb|margin|customer|quote_no|baht|amount|token|hash)') $c$;
create function pg_temp.mkprof(p_shop uuid, p_name text default 'v178-ชั่งหล่อ+ตัดต้น') returns uuid
 language sql as $c$
  select (pg_temp.pu(p_shop, null, p_name, null,
    '[{"stage_code":"cast","weigh":true,"scrap_qty":true},{"stage_code":"cut_sprue","weigh":true,"scrap_weight":true},{"stage_code":"wax_inject","scrap_qty":true}]') ->> 'id')::uuid $c$;
create function pg_temp.o_reopen(p_shop uuid, p_job uuid, p_reason text default 'verify') returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_stage_reopen(p_shop_id=>%L, p_job_id=>%L, p_reason=>%L, p_actor=>%L)', p_shop, p_job, p_reason, pg_temp.act())) $c$;
create function pg_temp.o_trevoke(p_shop uuid, p_job uuid, p_no int default null, p_reason text default 'verify') returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_token_revoke(p_shop_id=>%L, p_job_id=>%L, p_reason=>%L, p_actor=>%L, p_print_no=>%L)', p_shop, p_job, p_reason, pg_temp.act(), p_no)) $c$;
create function pg_temp.o_dres(p_shop uuid, p_disc uuid, p_kind text, p_reason text) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_discrepancy_resolve(p_shop_id=>%L, p_discrepancy_id=>%L, p_kind=>%L, p_reason=>%L, p_actor=>%L)', p_shop, p_disc, p_kind, p_reason, pg_temp.act())) $c$;
create function pg_temp.o_dvoid(p_shop uuid, p_disc uuid, p_reason text) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_discrepancy_void(p_shop_id=>%L, p_discrepancy_id=>%L, p_reason=>%L, p_actor=>%L)', p_shop, p_disc, p_reason, pg_temp.act())) $c$;
create function pg_temp.o_lcancel(p_shop uuid, p_lot uuid, p_reason text, p_disp text, p_sreason text default null, p_sw numeric default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_lot_cancel(p_shop_id=>%L, p_lot_job_id=>%L, p_reason=>%L, p_disposition=>%L, p_scrap_reason=>%L, p_actor=>%L, p_scrap_weight_g=>%L)',
    p_shop, p_lot, p_reason, p_disp, p_sreason, pg_temp.act(), p_sw)) $c$;
create function pg_temp.o_recv3(p_shop uuid, p_job uuid, p_seq int, p_qty int, p_w numeric, p_worker uuid default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_office_receive(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_occurred_on=>%L, p_worker_id=>%L, p_assignee_name=>%L, p_qty_received=>%L, p_weight_in_g=>%L, p_actor=>%L)',
    p_shop, p_job, p_seq, analytics.job_today(), p_worker, 'verify', p_qty, p_w, pg_temp.act())) $c$;

-- ============================================================================
-- helper เฉพาะ 0183
-- ============================================================================
-- ช่างกด "ได้รับเพิ่มแล้ว" / ออฟฟิศกรอกแทน (คืน jsonb {ok..} หรือ {_err,_state,_hint} / ผลของ RPC ช่างที่คืน {ok:false,code,message} ตรงๆ)
create function pg_temp.wa(p_tokh text, p_sesh text, p_disc uuid, p_qty int, p_w numeric default null, p_exp int default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_worker_discrepancy_arrive(p_token_hash=>%L, p_session_hash=>%L, p_discrepancy_id=>%L, p_qty=>%L, p_weight_g=>%L, p_expected_open=>%L, p_user_agent=>%L)',
    p_tokh, p_sesh, p_disc, p_qty, p_w, p_exp, 'verify-ua/1.0')) $c$;
create function pg_temp.oa(p_shop uuid, p_disc uuid, p_qty int, p_w numeric default null, p_on date default null, p_worker uuid default null, p_exp int default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_discrepancy_arrive(p_shop_id=>%L, p_discrepancy_id=>%L, p_qty=>%L, p_weight_g=>%L, p_received_on=>%L, p_worker_id=>%L, p_actor=>%L, p_expected_open=>%L)',
    p_shop, p_disc, p_qty, p_w, p_on, p_worker, pg_temp.act(), p_exp)) $c$;

-- ใบ OEM 8 ขั้นมาตรฐาน: ขั้น 1..p_to ส่งแล้ว (ออฟฟิศเดิน · น้ำหนัก p_w ทุกขั้น) → ช่างรับ (qc,pack · PIN 2468) รับขั้น p_to+1 ได้ p_got จาก p_qty (ทอง: ชั่ง p_rw) → ส่วนต่าง open (p_qty − p_got) ที่ขั้นช่างรับ
-- p_prof null: เงิน = แบบ "ไม่ชั่ง" · ทอง = แบบทองปริยาย · ช่างรับใช้ซ้ำได้ในส่วนเดียวกัน (ชื่อไม่ซ้ำต่อร้าน)
-- -> {job, tokh, wc (ผู้รับ), sc (session ผู้รับ), disc}
create function pg_temp.mkdisc(p_shop uuid, p_tpl uuid, p_qty int, p_got int, p_to int default 6, p_prof uuid default null, p_metal text default 'silver', p_w numeric default null, p_rw numeric default null) returns jsonb
 language plpgsql as $c$
declare d jsonb; j uuid; th text; wc_ uuid; sc_ text; r jsonb;
begin
  d := pg_temp.fx(p_shop, p_tpl, coalesce(p_prof, pg_temp.pid(p_shop, case when p_metal = 'gold' then 'gold' else 'none' end)), p_qty, p_to, p_metal, p_w);
  j := pg_temp.jid(d); th := d ->> 'tokh';
  select w.id into wc_ from analytics.worker w where w.shop_id = p_shop and lower(w.display_name) = lower('vfy-ช่างรับ');
  if wc_ is null then
    wc_ := (pg_temp.wu(p_shop, 'vfy-ช่างรับ', 'qc,pack', '2468') ->> 'id')::uuid;
  end if;
  sc_ := pg_temp.sess(th, wc_, '2468');
  r := pg_temp.wr(th, sc_, p_to + 1, null, p_got, p_rw);
  if (r ->> 'ok') is distinct from 'true' then
    raise exception 'mkdisc: รับไม่ได้ %', r::text;
  end if;
  return jsonb_build_object('job', j, 'tokh', th, 'wc', wc_, 'sc', sc_, 'disc', pg_temp.disc_of(j));
end $c$;

-- แถวส่วนต่างทั้งหมดของคู่ขั้น (ทุกสถานะ) เรียงตามสร้าง: 'open:2,void:2,resolved/arrived:1,open:1'
create function pg_temp.drows(p_job uuid) returns text
 language sql as $c$
  select coalesce(string_agg(d.status || coalesce('/' || d.resolved_kind, '') || ':' || d.qty, ',' order by d.created_at, d.id), '') from analytics.job_discrepancy d where d.job_id = p_job $c$;
create function pg_temp.nev(p_job uuid, p_type text) returns int language sql as $c$ select count(*)::int from analytics.job_event where job_id = p_job and event_type = p_type $c$;
-- stage ของใบ: 'seq:status,...'
create function pg_temp.sts(p_job uuid) returns text
 language sql as $c$ select string_agg(seq || ':' || status, ',' order by seq) from analytics.job_stage where job_id = p_job $c$;
create function pg_temp.keys(r jsonb) returns text language sql as $c$ select coalesce((select string_agg(k, ',' order by k) from jsonb_object_keys(r) k), '') $c$;
-- ยอดสรุปต้นไม้
create function pg_temp.summ(p_root uuid, p_col text) returns text language plpgsql as $c$
declare v text;
begin
  execute format('select %I::text from analytics.v_job_tree_summary where root_job_id = %L', p_col, p_root) into v;
  return v;
end $c$;
-- ข้อความเหมือน pg_temp.x แต่แนบ hint
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
-- mutant ของ view (def จาก pg_get_viewdef — view security_invoker ทั้งหมดของต้นไม้)
create function pg_temp.mutate_view(p_name text, p_from text, p_to text) returns void
 language plpgsql as $c$
declare v_def text; v_new text;
begin
  v_def := pg_get_viewdef(('analytics.' || p_name)::regclass);
  v_new := replace(v_def, p_from, p_to);
  if v_new = v_def then
    raise exception 'MUTANT_NOT_APPLIED: view % ไม่พบข้อความ [%]', p_name, p_from;
  end if;
  execute 'create or replace view analytics.' || p_name || ' with (security_invoker = true) as ' || v_new;
end $c$;
-- ผลของ resolve ตัดแอ็กชัน arrive ออก (เทียบกับฉบับเดิม) · ฉบับเดิมของ job_worker_resolve (def สดก่อน 0183) เป็น pg_temp.resolve_legacy
create function pg_temp.w_old(p_tokh text, p_sesh text default null, p_ip text default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select pg_temp.resolve_legacy(%L, %L, %L)', p_tokh, p_sesh, p_ip)) $c$;

-- สถานะที่ห้ามขยับหลังรัน (snap เดิมของ 0181 + ตารางส่วนต่าง + รูป + ตัวนับ)
create function pg_temp.snapx_d() returns text
 language plpgsql as $c$
declare v text := pg_temp.snap_d(); n text;
begin
  select count(*)::text || '/' || coalesce(md5(string_agg(x::text, '|' order by x.id)), '') into n from analytics.job_discrepancy x;
  v := v || 'job_discrepancy=' || n || chr(10);
  select count(*)::text || '/' || coalesce(md5(string_agg(x::text, '|' order by x.id)), '') into n from analytics.job_photo x;
  v := v || 'job_photo=' || n || chr(10);
  select count(*)::text || '/' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '') into n from analytics.job_counter x;
  v := v || 'job_counter=' || n || chr(10);
  return v;
end $c$;
create function pg_temp.snapx() returns text language sql as $c$ select md5(pg_temp.snapx_d()) $c$;
create function pg_temp.moved(p_before text) returns text language sql as $c$
  select coalesce((select string_agg(split_part(a, '=', 1), ',') from unnest(string_to_array(p_before, chr(10))) a
                    where a <> '' and not (a = any (string_to_array(pg_temp.snapx_d(), chr(10))))), '') $c$;

-- ผลของ resolve มี action arrive ใน my_actions หรือไม่
create function pg_temp.has_arr(r jsonb) returns boolean language sql as $c$
  select case when jsonb_typeof(r -> 'my_actions') = 'array' then exists (select 1 from jsonb_array_elements(r -> 'my_actions') a where a ->> 'action' = 'arrive') else false end $c$;
-- action arrive ตัวแรกของผลลัพธ์ (jsonb | null)
create function pg_temp.arr_act(r jsonb) returns jsonb language sql as $c$
  select case when jsonb_typeof(r -> 'my_actions') = 'array' then (select a from jsonb_array_elements(r -> 'my_actions') a where a ->> 'action' = 'arrive' limit 1) end $c$;
-- ผลของ resolve ตัด action arrive ออกจาก my_actions (เทียบกับฉบับเดิม)
create function pg_temp.strip_arr(r jsonb) returns jsonb language sql as $c$
  select case when jsonb_typeof(r -> 'my_actions') = 'array'
              then jsonb_set(r, '{my_actions}', coalesce((select jsonb_agg(a order by o) from jsonb_array_elements(r -> 'my_actions') with ordinality t(a, o) where a ->> 'action' <> 'arrive'), '[]'::jsonb))
              else r end $c$;
-- ช่างรับมาตรฐานของชุดนี้ (qc,pack · PIN 2468): ใช้ซ้ำได้ในส่วนเดียวกัน
create function pg_temp.wcv(p_shop uuid) returns uuid language plpgsql as $c$
declare v uuid;
begin
  select w.id into v from analytics.worker w where w.shop_id = p_shop and lower(w.display_name) = lower('vfy-ช่างรับ');
  if v is null then v := (pg_temp.wu(p_shop, 'vfy-ช่างรับ', 'qc,pack', '2468') ->> 'id')::uuid; end if;
  return v;
end $c$;

-- ===== job_worker_resolve ฉบับก่อน 0183 (def สดจาก DB · md5 168bb2be…) — ไว้เทียบ golden =====
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
  v_photos   jsonb := null;
begin
  -- 0181 + 0182 (รูปอ้างอิงของใบ — เฉพาะช่างที่ระบุตัวแล้ว)
  v_a := analytics.job_worker_auth(p_token_hash, p_session_hash, p_ip_hash, false, false, 'none');
  if not (v_a ->> 'ok')::boolean then
    return v_a;
  end if;
  select * into v_job from analytics.job where id = (v_a ->> 'job_id')::uuid;
  v_worker := nullif(v_a ->> 'worker_id', '')::uuid;

  -- 0182: รูปอ้างอิงของใบแม่ (token ออกให้ใบแม่เท่านั้น — coalesce กันกรณี token ผูกส่วนย่อย) · เฉพาะหลังระบุตัว (ก่อน PIN ไม่มี key) · ไม่ลบแล้วเท่านั้น
  -- ไม่มีรูป ⇒ jsonb_agg = null ⇒ ไม่มี key photos ⇒ ผลเดิมเป๊ะ · path ถูก server ของช่าง sign แล้วทิ้ง (ไม่ถึงเบราว์เซอร์)
  if v_worker is not null then
    select jsonb_agg(jsonb_build_object('id', phx.id, 'sm_path', phx.variant_sm_path, 'md_path', phx.storage_path, 'is_primary', phx.is_primary, 'caption', phx.caption)
                     order by phx.is_primary desc, phx.sort_order, phx.created_at, phx.id)
      into v_photos
      from analytics.job_photo phx
     where phx.job_id = coalesce(v_job.parent_job_id, v_job.id) and phx.deleted_at is null and phx.kind = 'reference';
  end if;

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
                                     'profile_name', v_job.profile_name, 'has_profile', v_job.profile_id is not null)
                                     || case when v_photos is null then '{}'::jsonb else jsonb_build_object('photos', v_photos) end end,
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
-- Section A — เส้นทางปกติ: ช่างผู้รับกด "ได้รับเพิ่มแล้ว" (บางส่วน → ครบ) · ส่วนใหม่เดินต่อ · ปิดใบเดิม · ที่ขั้น QC/แพ็ก · ออฟฟิศกรอกแทน
-- ============================================================================
create function pg_temp.sa(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  m jsonb; j uuid; th text; wC uuid; sC text; wA uuid; sA text; wB uuid; sB text; dd uuid; dd2 uuid;
  r jsonb; r2 jsonb; r3 jsonb; l1 uuid; l2 uuid; arr uuid; v_today date := analytics.job_today(); v_pay jsonb;
  m2 jsonb; j2 uuid; th2 text; sC2 text; dp uuid; lp uuid; m3 jsonb; j3 uuid; dq uuid; lq uuid; dq2 uuid;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  -- ===== fixture: ชุบ/ขัดส่ง 50 → QC (ช่าง C) รับ 48 → ส่วนต่าง 2 · ส่วนหลักส่ง QC แล้วไปรับที่แพ็กแล้ว (เคส JB-0018) =====
  m := pg_temp.mkdisc(p_shop, p_tpl, 50, 48);
  j := (m ->> 'job')::uuid; th := m ->> 'tokh'; wC := (m ->> 'wc')::uuid; sC := m ->> 'sc'; dd := (m ->> 'disc')::uuid;
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829'); sA := pg_temp.sess(th, wA, '4829');
  wB := pg_temp.wid(p_shop, 'vfy-ช่าง B', '7351'); sB := pg_temp.sess(th, wB, '7351');
  r := pg_temp.ws(th, sC, 7);
  r2 := pg_temp.wr(th, sC, 8);
  v_log := v_log || pg_temp.chk('A0', 'fixture (JB-0018): ส่วนต่าง open 2 ชิ้น (ขั้น 6→7 ผู้รับ = ช่าง C รับ 48 จาก 50) · ขั้น QC ส่งไปแล้ว (qty_out 48) · แพ็กถูกรับแล้ว — ใช้ void ไม่ได้ (ขั้นผู้รับส่งต่อไปแล้ว)',
    dd is not null and (r ->> 'ok') = 'true' and (r2 ->> 'ok') = 'true' and pg_temp.drows(j) = 'open:2' and pg_temp.sv(j, 7, 'status') = 'sent' and pg_temp.sv(j, 7, 'qty_in') = '48'
    and pg_temp.sv(j, 8, 'status') = 'received' and pg_temp.rej(pg_temp.o_dvoid(p_shop, dd, 'ลองยกเลิก'), 'stage_not_pending') and pg_temp.dcount(j) = 0);

  r := pg_temp.w_res(th, sC); r2 := pg_temp.w_res(th, sA); r3 := pg_temp.w_res(th, sB);
  v_log := v_log || pg_temp.chk('A1', 'resolve: ผู้รับขั้น QC (ช่าง C) มี action arrive พร้อม discrepancy_id/qty 2/stage qc/weight_required false · ช่างอื่น (A,B) และก่อน PIN ไม่มี arrive · key ใหม่ไม่มีตัวเลขน้ำหนัก/ราคา',
    exists (select 1 from jsonb_array_elements(r -> 'my_actions') a where a ->> 'action' = 'arrive' and (a ->> 'discrepancy_id')::uuid = dd and (a ->> 'qty') = '2' and a ->> 'stage_code' = 'qc'
              and (a ->> 'weight_required') = 'false' and (a ->> 'office_only') = 'false')
    and not pg_temp.has_arr(r2) and not pg_temp.has_arr(r3) and not pg_temp.has_arr(pg_temp.w_res(th, null)) and pg_temp.clean_keys(r));

  -- ===== ได้รับเพิ่มบางส่วน 1 จาก 2 =====
  r := pg_temp.wa(th, sC, dd, 1, null, 2);
  l1 := pg_temp.lot(r);
  v_log := v_log || pg_temp.chk('A2a', 'ช่าง C กด "ได้รับเพิ่มแล้ว" 1 ชิ้น (expected_open 2) → ok · action arrive · qty 1 · เหลือ 1 · ส่วนที่ 1 · label "<เลขใบ> · ส่วนที่ 1" · คืน id แถว open ที่เหลือ',
    (r ->> 'ok') = 'true' and r ->> 'action' = 'arrive' and (r ->> 'qty') = '1' and (r ->> 'qty_remaining') = '1' and (r ->> 'lot_seq') = '1' and l1 is not null
    and (r ->> 'label') = (select job_no || ' · ส่วนที่ 1' from analytics.job where id = j) and (r ->> 'discrepancy_id')::uuid = pg_temp.disc_of(j) and (r ->> 'stage_code') = 'qc' and pg_temp.clean_keys(r));
  arr := (r ->> 'arrived_id')::uuid;
  v_log := v_log || pg_temp.chk('A2b', 'แถวส่วนต่าง: เดิม (2) ถูก void · แถว arrived 1 (resolved · ช่าง C) · แถว open 1 ที่เหลือ — ผลรวมที่ยังนับ = 2 เท่าเดิม · แถวเดิมไม่ถูกแก้ (ยังเป็น open qty 2 + มี void ชี้)',
    pg_temp.drows(j) = 'open:2,void:2,resolved/arrived:1,open:1' and pg_temp.disc_of(j) <> dd
    and (select count(*) from analytics.job_discrepancy v where v.void_of_id = dd) = 1 and pg_temp.d_status(dd) = 'open'
    and analytics.job_disc_active_qty(pg_temp.sid(j, 6), pg_temp.sid(j, 7)) = 2
    and (select resolved_kind = 'arrived' and resolved_by_worker = wC and qty = 1 and resolved_reason = 'ได้รับเพิ่มแล้ว' and weight_gap_g is null and from_stage_id = pg_temp.sid(j, 6) and to_stage_id = pg_temp.sid(j, 7)
           from analytics.job_discrepancy where id = arr));
  v_log := v_log || pg_temp.chk('A2c', 'ส่วนใหม่: ส่วนย่อยของใบแม่ · lot_seq 1 · qty_planned = qty_order = 1 · in_progress · ขั้น 1-6 skipped split_inherit · QC received (ผู้ถือ = ช่าง C · วันนี้ · qty_in 1 · ไม่มีน้ำหนัก · ผูก arrive_discrepancy_id) · แพ็ก pending',
    (select l.parent_job_id = j and l.lot_seq = 1 and l.qty_planned = 1 and l.qty_order = 1 and l.status = 'in_progress' and l.metal = m.metal and l.profile_id is not distinct from m.profile_id
            and l.oem_quote_item_id is not distinct from m.oem_quote_item_id and l.due_date is not distinct from m.due_date
       from analytics.job l, analytics.job m where l.id = l1 and m.id = j)
    and pg_temp.sts(l1) = '1:skipped,2:skipped,3:skipped,4:skipped,5:skipped,6:skipped,7:received,8:pending'
    and (select count(*) from analytics.job_stage where job_id = l1 and status = 'skipped' and skip_reason = 'split_inherit') = 6
    and pg_temp.sv(l1, 7, 'worker_id') = wC::text and pg_temp.sv(l1, 7, 'received_on') = v_today::text and pg_temp.sv(l1, 7, 'qty_in') = '1' and pg_temp.sv(l1, 7, 'weight_in_g') is null
    and pg_temp.sv(l1, 7, 'arrive_discrepancy_id') = arr::text and pg_temp.sv(l1, 7, 'split_from_stage_id') is null);
  v_log := v_log || pg_temp.chk('A2d', 'ใบเดิมไม่ขยับ: ขั้น 7 ยัง sent qty_in 48 · แพ็กยัง received · event: ใบเดิมมี discrepancy_arrive 1 (qty 1 · ชี้ส่วนใหม่ · ไม่มีน้ำหนัก) · ส่วนใหม่มี create(arrive_lot) + skip×6 + receive · v_job_stage_from_events ตรง',
    pg_temp.sv(j, 7, 'status') = 'sent' and pg_temp.sv(j, 7, 'qty_in') = '48' and pg_temp.sv(j, 8, 'status') = 'received' and pg_temp.nev(j, 'discrepancy_arrive') = 1
    and (select (payload ->> 'qty') = '1' and (payload ->> 'lot_job_id') = l1::text and (payload ->> 'arrived_id') = arr::text and (payload ->> 'weight_g') is null and channel = 'worker_qr' and worker_id = wC
          from analytics.job_event where job_id = j and event_type = 'discrepancy_arrive')
    and (select count(*) from analytics.job_event where job_id = l1 and event_type = 'create' and payload ->> 'kind' = 'arrive_lot') = 1
    and pg_temp.nev(l1, 'stage_skip') = 6 and pg_temp.nev(l1, 'stage_receive') = 1 and pg_temp.sdrift(j) = 0);
  v_log := v_log || pg_temp.chk('A2e', 'ต้นไม้ถูกต้อง: drift ว่าง · sum_check จริง · ส่วนรอชี้แจง 1 · live รวม 49 (ใบเดิม 48 + ส่วนใหม่ 1) + รอ 1 = 50 · ส่วนที่ resolved ไม่นับ arrived (0) · v_job_tree ใบเดิม qty_discrepancy_arrived 1',
    pg_temp.dcount(j) = 0 and pg_temp.sumok(j) and pg_temp.summ(j, 'qty_pending_explanation') = '1' and pg_temp.summ(j, 'qty_live_total') = '49' and pg_temp.summ(j, 'qty_discrepancy_resolved') = '0'
    and pg_temp.summ(j, 'parts_count') = '2' and pg_temp.summ(j, 'lots_open') = '1'
    and (select qty_discrepancy_arrived = 1 and qty_discrepancy_resolved = 0 and qty_discrepancy_open = 1 from analytics.v_job_tree where job_id = j)
    and (select qty_pending_explanation from analytics.v_job_board where id = j) = 1);

  -- ===== ได้รับเพิ่มส่วนที่เหลือ (ครบ) =====
  dd2 := pg_temp.disc_of(j);
  r := pg_temp.wa(th, sC, dd2, 1, null, 1);
  l2 := pg_temp.lot(r);
  v_log := v_log || pg_temp.chk('A3', 'ได้รับครบส่วนที่เหลือ → ok · qty_remaining 0 · ไม่มีแถว open · ส่วนที่ 2 · live รวม 50 · รอชี้แจง 0 · drift ว่าง · sum_check จริง · จำนวนส่วน 3',
    (r ->> 'ok') = 'true' and (r ->> 'qty_remaining') = '0' and (r -> 'discrepancy_id') = 'null'::jsonb and (r ->> 'lot_seq') = '2' and pg_temp.disc_of(j) is null
    and pg_temp.drows(j) = 'open:2,void:2,resolved/arrived:1,open:1,void:1,resolved/arrived:1'
    and pg_temp.summ(j, 'qty_live_total') = '50' and pg_temp.summ(j, 'qty_pending_explanation') = '0' and pg_temp.summ(j, 'parts_count') = '3'
    and pg_temp.dcount(j) = 0 and pg_temp.sumok(j) and pg_temp.sdrift(j) = 0 and analytics.job_arrived_qty(j) = 2);

  -- ===== ส่วนใหม่เดินต่อตามปกติ + ยกเลิกส่วนที่ 2 (คืนชิ้นไม่ได้ — ไม่มีขั้นแม่ที่ถืออยู่ · ของเสียได้) =====
  r := pg_temp.ws(th, sC, 7, l1);
  r2 := pg_temp.wr(th, sC, 8, l1);
  r3 := pg_temp.ws(th, sC, 8, l1);
  v_log := v_log || pg_temp.chk('A4a', 'ส่วนที่ 1 เดินต่อ: ช่าง C ส่ง QC → รับแพ็ก → ส่งแพ็ก ได้ทั้งหมด · ออฟฟิศปิดส่วน (ดี 1) ได้ · ส่วนปิด · drift ว่าง',
    (r ->> 'ok') = 'true' and (r2 ->> 'ok') = 'true' and (r3 ->> 'ok') = 'true' and (pg_temp.o_done(p_shop, l1, 1, 0) ->> 'ok') = 'true' and pg_temp.jv(l1, 'status') = 'done' and pg_temp.dcount(j) = 0 and pg_temp.sdrift(j) = 0);
  r := pg_temp.o_lcancel(p_shop, l2, 'ทดสอบ', 'return_to_parent');
  r2 := pg_temp.wc(th, sC, l2);
  r3 := pg_temp.o_lcancel(p_shop, l2, 'ของเสียจริง', 'scrap', 'broken');
  v_log := v_log || pg_temp.chk('A4b', 'ส่วนที่ 2 (มาจาก arrive): ยกเลิกแบบคืนชิ้น → ปฏิเสธ not_lot (ทั้งออฟฟิศและช่าง) · ยกเลิกเป็นของเสียได้ (cancel_scrap_qty 1 · event ฝั่งแม่เขียนที่ใบแม่ ไม่ผูกขั้น) · ต้นไม้ยังตรง'
,
    pg_temp.rej(r, 'not_lot') and (r2 ->> 'code') = 'not_lot' and (r3 ->> 'ok') = 'true' and pg_temp.jv(l2, 'status') = 'cancelled' and pg_temp.jv(l2, 'cancel_scrap_qty') = '1'
    and (select count(*) from analytics.job_event where job_id = j and event_type = 'split_cancel' and job_stage_id is null and payload ->> 'arrive_lot' = 'true' and payload ->> 'disposition' = 'scrap') = 1
    and pg_temp.dcount(j) = 0 and pg_temp.sumok(j) and pg_temp.sdrift(j) = 0);

  -- ===== ปิดใบเดิม: ดี + เสีย + แยกออก + arrived = เริ่มผลิต =====
  r := pg_temp.ws(th, sC, 8);
  v_log := v_log || pg_temp.chk('A5a', 'ใบเดิม done: ดี 48 + เสีย 2 (+ arrived 2 = 52 ≠ 50) → qty_mismatch · ดี 49 + เสีย 0 (+2 = 51) → qty_mismatch · ดี 48 + เสีย 0 (+ arrived 2 = 50) → ok',
    pg_temp.rej(pg_temp.o_done(p_shop, j, 48, 2), 'qty_mismatch') and pg_temp.rej(pg_temp.o_done(p_shop, j, 49, 0), 'qty_mismatch') and pg_temp.jv(j, 'status') <> 'done'
    and (pg_temp.o_done(p_shop, j, 48, 0) ->> 'ok') = 'true' and pg_temp.jv(j, 'status') = 'done');
  v_log := v_log || pg_temp.chk('A5b', 'หลังปิด: identity ใบเดิม = 0 (นับ arrived) · drift ว่าง · sum_check จริง (48 + ส่วนที่ 1 ดี 1 + ส่วนที่ 2 เสีย 1 = 50) · job_arrived_qty 2',
    analytics.job_identity_gap(j) = 0 and pg_temp.dcount(j) = 0 and pg_temp.sumok(j) and analytics.job_arrived_qty(j) = 2 and pg_temp.sdrift(j) = 0
    and pg_temp.summ(j, 'qty_done_good') = '49' and pg_temp.summ(j, 'qty_scrap_total') = '1');

  -- ===== arrive ที่ขั้นแพ็ก (T = pack · ขั้นก่อนหน้า QC ต้อง skip split_inherit ได้ — กฎ "ข้าม QC/แพ็กไม่ได้" ยกเว้นส่วนที่มี arrive) =====
  m2 := pg_temp.mkdisc(p_shop, p_tpl, 50, 48, 7);
  j2 := (m2 ->> 'job')::uuid; th2 := m2 ->> 'tokh'; sC2 := m2 ->> 'sc'; dp := (m2 ->> 'disc')::uuid;
  r := pg_temp.wa(th2, sC2, dp, 2, null, 2);
  lp := pg_temp.lot(r);
  v_log := v_log || pg_temp.chk('A6', 'ส่วนต่างที่ขั้นแพ็ก (QC ส่ง 50 แพ็กรับ 48): ได้รับเพิ่มครบ 2 → ส่วนใหม่ที่ขั้นแพ็ก received · ขั้น 1-7 (รวม QC) skipped split_inherit · drift ว่าง · live รวม 50',
    (r ->> 'ok') = 'true' and (r ->> 'stage_code') = 'pack' and pg_temp.sts(lp) = '1:skipped,2:skipped,3:skipped,4:skipped,5:skipped,6:skipped,7:skipped,8:received'
    and pg_temp.sv(lp, 8, 'qty_in') = '2' and pg_temp.dcount(j2) = 0 and pg_temp.sumok(j2) and pg_temp.summ(j2, 'qty_live_total') = '50' and pg_temp.sdrift(j2) = 0);

  -- ===== ออฟฟิศกรอกแทน: เลือกผู้ถือ / ไม่เลือก = ผู้รับเดิม · วันย้อนหลังได้ =====
  m3 := pg_temp.mkdisc(p_shop, p_tpl, 50, 47);
  j3 := (m3 ->> 'job')::uuid; dq := (m3 ->> 'disc')::uuid;
  r := pg_temp.oa(p_shop, dq, 1, null, v_today, wB);
  lq := pg_temp.lot(r);
  v_log := v_log || pg_temp.chk('A7a', 'ออฟฟิศกรอกแทน 1 จาก 3: เลือกผู้ถือ = ช่าง B · วันรับ = วันนี้ · ผู้ถือส่วนใหม่ = B (ไม่ใช่ผู้รับเดิม) · event ช่อง job_page actor ออฟฟิศ · เหลือ 2',
    (r ->> 'ok') = 'true' and (r ->> 'qty_remaining') = '2' and pg_temp.sv(lq, 7, 'worker_id') = wB::text and pg_temp.sv(lq, 7, 'received_on') = v_today::text
    and (select channel = 'job_page' and actor = pg_temp.act() and worker_id is null from analytics.job_event where job_id = j3 and event_type = 'discrepancy_arrive')
    and pg_temp.dcount(j3) = 0 and pg_temp.sumok(j3));
  dq2 := pg_temp.disc_of(j3);
  r := pg_temp.oa(p_shop, dq2, 2);
  v_log := v_log || pg_temp.chk('A7b', 'ออฟฟิศไม่เลือกผู้ถือ → ผู้ถือส่วนใหม่ = ผู้รับเดิมของขั้น (ช่าง C) · วันนี้ · ครบ 2 · ไม่มีแถว open ค้าง',
    (r ->> 'ok') = 'true' and pg_temp.sv(pg_temp.lot(r), 7, 'worker_id') = (m3 ->> 'wc') and pg_temp.sv(pg_temp.lot(r), 7, 'received_on') = v_today::text
    and pg_temp.disc_of(j3) is null and pg_temp.dcount(j3) = 0 and pg_temp.sumok(j3));
  return v_log;
end;
$s$;

-- ============================================================================
-- Section B — เคสห้ามผ่าน (qty · ผู้รับ · ใบ/ร้านอื่น · ชี้แจงแล้ว · กดซ้ำ/CAS · น้ำหนักเงิน · วัน · ผู้ถือ · ใบปิด) — ไม่มีส่วนใหม่/แถว/event เกิด
-- ============================================================================
create function pg_temp.sb(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  m jsonb; j uuid; th text; wC uuid; sC text; wA uuid; sA text; dd uuid; r jsonb; rr jsonb; n0 int; v_rows text; v_ev int; v_snap text;
  m2 jsonb; j2 uuid; th2 text; sC2 text; d2 uuid; v_today date := analytics.job_today(); l1 uuid; dwho uuid; w_off uuid;
  v_ok boolean; i int; v_x text; core_r jsonb; lt jsonb; r3 jsonb; r4 jsonb; v_n1 int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  m := pg_temp.mkdisc(p_shop, p_tpl, 50, 47);
  j := (m ->> 'job')::uuid; th := m ->> 'tokh'; wC := (m ->> 'wc')::uuid; sC := m ->> 'sc'; dd := (m ->> 'disc')::uuid;
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829'); sA := pg_temp.sess(th, wA, '4829');
  n0 := pg_temp.nlots(j); v_rows := pg_temp.drows(j); v_ev := (select count(*)::int from analytics.job_event where job_id = j);

  -- B1 จำนวน
  v_ok := true;
  foreach i in array array[0, -1, 4, 100000] loop
    r := pg_temp.wa(th, sC, dd, i);
    v_ok := v_ok and (r ->> 'code') = 'qty_invalid';
    r := pg_temp.oa(p_shop, dd, i);
    v_ok := v_ok and pg_temp.rej(r, 'qty_invalid');
  end loop;
  r := pg_temp.wa(th, sC, dd, null);
  v_log := v_log || pg_temp.chk('B1', 'จำนวน 0 / −1 / 4 (เกิน open 3) / 100000 / null → qty_invalid ทั้งช่างและออฟฟิศ · ไม่เกิดส่วน/แถว/event',
    v_ok and (r ->> 'code') = 'qty_invalid' and pg_temp.nlots(j) = n0 and pg_temp.drows(j) = v_rows and (select count(*)::int from analytics.job_event where job_id = j) = v_ev);

  -- B2 ผู้รับ
  r := pg_temp.wa(th, sA, dd, 1);
  v_log := v_log || pg_temp.chk('B2', 'ช่างที่ไม่ใช่ผู้รับของขั้นนั้น (A) กด arrive → not_receiver · ไม่เกิดอะไร · ผู้รับ (C) ผ่านด่านนี้',
    (r ->> 'code') = 'not_receiver' and pg_temp.nlots(j) = n0 and pg_temp.drows(j) = v_rows and (select count(*)::int from analytics.job_event where job_id = j) = v_ev);

  -- B3 ส่วนต่างของใบอื่น / ไม่มี / ร้านอื่น
  m2 := pg_temp.mkdisc(p_shop, p_tpl, 20, 18);
  j2 := (m2 ->> 'job')::uuid; th2 := m2 ->> 'tokh'; sC2 := m2 ->> 'sc'; d2 := (m2 ->> 'disc')::uuid;
  v_log := v_log || pg_temp.chk('B3a', 'ช่างใช้ token ของใบ A ส่ง discrepancy ของใบ B (ข้ามใบ) → invalid_part · id สุ่ม/null → invalid_part · ไม่เกิดอะไรทั้งสองใบ',
    (pg_temp.wa(th, sC, d2, 1) ->> 'code') = 'invalid_part' and (pg_temp.wa(th, sC, gen_random_uuid(), 1) ->> 'code') = 'invalid_part' and (pg_temp.wa(th, sC, null, 1) ->> 'code') = 'invalid_part'
    and pg_temp.nlots(j2) = 0 and pg_temp.drows(j2) = 'open:2' and pg_temp.drows(j) = v_rows);
  v_log := v_log || pg_temp.chk('B3b', 'ออฟฟิศ: ร้านไม่ตรง/ไม่มีแถว/null → discrepancy_not_found (22023) · token ใบ B กับ discrepancy ของใบ A → invalid_part',
    pg_temp.rej(pg_temp.oa(gen_random_uuid(), dd, 1), 'discrepancy_not_found') and pg_temp.rej(pg_temp.oa(p_shop, gen_random_uuid(), 1), 'discrepancy_not_found') and pg_temp.rej(pg_temp.oa(p_shop, null, 1), 'discrepancy_not_found')
    and (pg_temp.wa(th2, sC2, dd, 1) ->> 'code') = 'invalid_part' and pg_temp.nlots(j) = n0);

  -- B4 ชี้แจงแล้ว (scrap/lost) · void แล้ว · arrive ครบแล้ว กดซ้ำ
  r := pg_temp.o_dres(p_shop, d2, 'lost', 'missing');
  v_log := v_log || pg_temp.chk('B4a', 'ส่วนต่างที่ชี้แจงเป็นหาย/เสียแล้ว กด arrive (ช่าง/ออฟฟิศ) → already_resolved · ไม่เกิดส่วน',
    (r ->> 'ok') = 'true' and (pg_temp.wa(th2, sC2, d2, 1) ->> 'code') = 'already_resolved' and pg_temp.rej(pg_temp.oa(p_shop, d2, 1), 'already_resolved') and pg_temp.nlots(j2) = 0);
  r := pg_temp.wa(th, sC, dd, 3, null, 3);
  v_log := v_log || pg_temp.chk('B4b', 'arrive ครบ 3 แล้วกดซ้ำ (2 มือถือ/กด 2 ครั้ง) → already_resolved (แถวเดิมถูก void) · ไม่สร้างส่วนที่ 2 · ส่วนมี 1 เท่านั้น',
    (r ->> 'ok') = 'true' and (pg_temp.wa(th, sC, dd, 3, null, 3) ->> 'code') = 'already_resolved' and pg_temp.rej(pg_temp.oa(p_shop, dd, 3), 'already_resolved') and pg_temp.nlots(j) = n0 + 1);

  -- B5 CAS: expected_open ไม่ตรง (กดซ้ำ arrive บางส่วนด้วยหน้าจอเก่า)
  m2 := pg_temp.mkdisc(p_shop, p_tpl, 20, 17);
  j2 := (m2 ->> 'job')::uuid; th2 := m2 ->> 'tokh'; sC2 := m2 ->> 'sc'; d2 := (m2 ->> 'disc')::uuid;
  r := pg_temp.wa(th2, sC2, d2, 1, null, 3);
  rr := pg_temp.wa(th2, sC2, d2, 1, null, 3);
  v_log := v_log || pg_temp.chk('B5', 'arrive 1 จาก 3 (expected_open 3) ok → กดซ้ำด้วยหน้าจอเดิม (expected_open 3 แต่เหลือ 2 · และ d2 ถูก void แล้ว) → ไม่สร้างส่วนที่ 2 · ใช้ id แถวใหม่ + expected 2 ผ่าน · expected ผิดเมื่อ id ถูก = stage_changed',
    (r ->> 'ok') = 'true' and (rr ->> 'code') in ('already_resolved', 'stage_changed') and pg_temp.nlots(j2) = 1
    and (pg_temp.wa(th2, sC2, pg_temp.disc_of(j2), 1, null, 3) ->> 'code') = 'stage_changed' and pg_temp.nlots(j2) = 1
    and (pg_temp.wa(th2, sC2, pg_temp.disc_of(j2), 1, null, 2) ->> 'ok') = 'true' and pg_temp.nlots(j2) = 2 and pg_temp.dcount(j2) = 0);

  -- B6 น้ำหนัก (เงิน/ขั้นไม่ชั่ง): ส่งน้ำหนักมา = weight_unexpected
  m2 := pg_temp.mkdisc(p_shop, p_tpl, 20, 18);
  j2 := (m2 ->> 'job')::uuid; th2 := m2 ->> 'tokh'; sC2 := m2 ->> 'sc'; d2 := (m2 ->> 'disc')::uuid;
  v_log := v_log || pg_temp.chk('B6', 'เงิน/ขั้นไม่ชั่ง: ส่งน้ำหนัก (ช่าง/ออฟฟิศ) → weight_unexpected · ข้อความไม่มีตัวเลข · ไม่เกิดส่วน · นับจำนวนอย่างเดียวผ่าน',
    (pg_temp.wa(th2, sC2, d2, 1, 5.5) ->> 'code') = 'weight_unexpected' and pg_temp.nodigit(pg_temp.wa(th2, sC2, d2, 1, 5.5)) and pg_temp.rej(pg_temp.oa(p_shop, d2, 1, 5.5), 'weight_unexpected')
    and pg_temp.nlots(j2) = 0 and pg_temp.drows(j2) = 'open:2' and (pg_temp.wa(th2, sC2, d2, 1) ->> 'ok') = 'true');

  -- B7 วันที่ (ออฟฟิศ): ย้อนวันที่ขั้นต้นทางส่งไปก่อน เพื่อทดสอบแต่ละด่านแยกกัน (ไม่ให้ด่านหนึ่งบังอีกด่าน) · ด้านที่ผ่านทดสอบด้วย
  m2 := pg_temp.mkdisc(p_shop, p_tpl, 20, 18);
  j2 := (m2 ->> 'job')::uuid; d2 := (m2 ->> 'disc')::uuid;
  execute 'alter table analytics.job_stage disable trigger trg_job_stage_guard';
  update analytics.job_stage set received_on = v_today - 20, sent_on = v_today - 20 where id = pg_temp.sid(j2, 6);
  execute 'alter table analytics.job_stage enable trigger trg_job_stage_guard';
  r := pg_temp.oa(p_shop, d2, 1, null, v_today + 1);
  rr := pg_temp.oa(p_shop, d2, 1, null, v_today - 15);
  v_n1 := pg_temp.nlots(j2);
  r3 := pg_temp.oa(p_shop, d2, 1, null, v_today - 14);
  v_log := v_log || pg_temp.chk('B7a', 'วันรับของออฟฟิศ (ขั้นต้นทางส่งเมื่อ 20 วันก่อน): พรุ่งนี้ = date_invalid · ย้อน 15 วัน (เกินเพดาน 14 วัน) = date_invalid · ไม่เกิดส่วน · ย้อน 14 วันพอดี = ok (ขอบ) ผู้ถือส่วนใหม่รับวันนั้น · ช่างผ่าน QR ไม่มีพารามิเตอร์วัน = วันนี้เสมอ',
    pg_temp.rej(r, 'date_invalid') and pg_temp.rej(rr, 'date_invalid') and v_n1 = 0
    and (r3 ->> 'ok') = 'true' and pg_temp.sv(pg_temp.lot(r3), 7, 'received_on') = (v_today - 14)::text);
  m2 := pg_temp.mkdisc(p_shop, p_tpl, 20, 18);
  j2 := (m2 ->> 'job')::uuid; d2 := (m2 ->> 'disc')::uuid;
  execute 'alter table analytics.job_stage disable trigger trg_job_stage_guard';
  update analytics.job_stage set received_on = v_today - 5, sent_on = v_today - 5 where id = pg_temp.sid(j2, 6);
  execute 'alter table analytics.job_stage enable trigger trg_job_stage_guard';
  r := pg_temp.oa(p_shop, d2, 1, null, v_today - 6);
  v_n1 := pg_temp.nlots(j2);
  r3 := pg_temp.oa(p_shop, d2, 1, null, v_today - 5);
  r4 := pg_temp.oa(p_shop, pg_temp.disc_of(j2), 1, null, v_today);
  v_log := v_log || pg_temp.chk('B7b', 'วันรับก่อนวันที่ขั้นต้นทางส่ง (ส่งเมื่อ 5 วันก่อน · รับ 6 วันก่อน) = date_invalid · ไม่เกิดส่วน · รับวันเดียวกับที่ส่ง (ย้อน 5 วัน) = ok (ขอบ) · วันนี้ = ok',
    pg_temp.rej(r, 'date_invalid') and v_n1 = 0 and (r3 ->> 'ok') = 'true' and (r4 ->> 'ok') = 'true' and pg_temp.nlots(j2) = 2);

  -- B8 ผู้ถือที่ออฟฟิศเลือก: ไม่มีช่าง/ช่างปิดใช้งาน
  m2 := pg_temp.mkdisc(p_shop, p_tpl, 20, 18);
  j2 := (m2 ->> 'job')::uuid; d2 := (m2 ->> 'disc')::uuid;
  w_off := pg_temp.wid(p_shop, 'vfy-ช่างปิด', '1357');
  perform pg_temp.q(format('select analytics.worker_set_active(p_shop_id=>%L, p_worker_id=>%L, p_active=>false, p_actor=>%L)', p_shop, w_off, pg_temp.act()));
  v_log := v_log || pg_temp.chk('B8', 'ออฟฟิศเลือกผู้ถือเป็นช่างที่ไม่มีอยู่/ช่างที่ปิดใช้งาน → who_invalid · ไม่เกิดส่วน',
    pg_temp.rej(pg_temp.oa(p_shop, d2, 1, null, null, gen_random_uuid()), 'who_invalid') and pg_temp.rej(pg_temp.oa(p_shop, d2, 1, null, null, w_off), 'who_invalid')
    and pg_temp.nlots(j2) = 0 and pg_temp.drows(j2) = 'open:2');

  -- B9 ใบปิด/พัก: เรียก core ตรง (RPC ภายนอกถูกด่านชั้นนอกตัดก่อน — ตรวจด่านของ core เอง) · ยกเลิกใบแล้วช่าง/ออฟฟิศกด
  m2 := pg_temp.mkdisc(p_shop, p_tpl, 20, 18);
  j2 := (m2 ->> 'job')::uuid; th2 := m2 ->> 'tokh'; sC2 := m2 ->> 'sc'; d2 := (m2 ->> 'disc')::uuid;
  perform pg_temp.o_cancel(p_shop, j2);
  core_r := pg_temp.q(format('select analytics.job_discrepancy_arrive_core(%L, 1, null, null, null, null, %L, ''worker_qr'', null, null, true)', d2, m2 ->> 'wc'));
  v_log := v_log || pg_temp.chk('B9a', 'ใบที่ยกเลิกแล้ว: core ตอบ job_closed · ช่าง (token ถูกเพิกถอน → ถูกด่านชั้นนอก) · ออฟฟิศ → job_closed · ไม่เกิดส่วน',
    (core_r ->> 'code') = 'job_closed' and (pg_temp.wa(th2, sC2, d2, 1) ->> 'ok') = 'false' and pg_temp.rej(pg_temp.oa(p_shop, d2, 1), 'job_closed') and pg_temp.nlots(j2) = 0);
  m2 := pg_temp.mkdisc(p_shop, p_tpl, 20, 18);
  j2 := (m2 ->> 'job')::uuid; d2 := (m2 ->> 'disc')::uuid;
  execute 'alter table analytics.job disable trigger trg_job_guard';
  update analytics.job set status = 'on_hold' where id = j2;
  execute 'alter table analytics.job enable trigger trg_job_guard';
  core_r := pg_temp.q(format('select analytics.job_discrepancy_arrive_core(%L, 1, null, null, null, null, %L, ''worker_qr'', null, null, true)', d2, m2 ->> 'wc'));
  v_log := v_log || pg_temp.chk('B9b', 'ใบถูกพัก: core ตอบ job_on_hold · ไม่เกิดส่วน', (core_r ->> 'code') = 'job_on_hold' and pg_temp.nlots(j2) = 0);

  -- B10 ขั้นผู้รับถูกย้อนเป็นยังไม่รับ (ใช้ void แทน) → stage_changed
  m2 := pg_temp.mkdisc(p_shop, p_tpl, 20, 18);
  j2 := (m2 ->> 'job')::uuid; d2 := (m2 ->> 'disc')::uuid;
  perform pg_temp.o_reopen(p_shop, j2, 'ย้อนขั้นผู้รับเพื่อ void');
  core_r := pg_temp.q(format('select analytics.job_discrepancy_arrive_core(%L, 1, null, null, null, null, %L, ''worker_qr'', null, null, true)', d2, m2 ->> 'wc'));
  v_log := v_log || pg_temp.chk('B10', 'ออฟฟิศย้อนขั้นผู้รับเป็นยังไม่รับแล้ว arrive → stage_changed (ทางนั้นต้อง void) · void เดิมยังใช้ได้ · ไม่เกิดส่วน',
    pg_temp.sv(j2, 7, 'status') = 'pending' and (core_r ->> 'code') = 'stage_changed' and pg_temp.rej(pg_temp.oa(p_shop, d2, 1), 'stage_changed')
    and (pg_temp.o_dvoid(p_shop, d2, 'ของไม่ได้หาย') ->> 'ok') = 'true' and pg_temp.nlots(j2) = 0);
  return v_log;
end;
$s$;

-- ============================================================================
-- Section C — ต้องไม่พัง: resolve เสียหาย/หาย · void · golden resolve เทียบฉบับเดิม · แยกส่วนเดิม · ด่านกันเขียนตรง (guard) · ล้างค่า flag
-- ============================================================================
create function pg_temp.sc(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  m jsonb; j uuid; th text; wC uuid; sC text; dd uuid; r jsonb; r2 jsonb; r3 jsonb; l1 uuid; arr uuid; rem uuid;
  wS uuid; sS text; d jsonb; pn uuid; pw uuid; pg_ uuid; wA uuid; sA text; wB uuid; sB text; ls uuid;
  v_n int; v_mm int; v_cnt int; v_job record; v_tok text; v_ses text; v_leg jsonb; v_new jsonb; i int; v_today date := analytics.job_today();
  v_rows text; v_ok boolean; dj uuid; m2 jsonb; j2 uuid; dd2 uuid; v_rows2 text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pn := pg_temp.pid(p_shop, 'none'); pw := pg_temp.mkprof(p_shop, 'vfy-ชั่งหล่อ+ตัดต้น'); pg_ := pg_temp.pid(p_shop, 'gold');
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829'); wB := pg_temp.wid(p_shop, 'vfy-ช่าง B', '7351');

  -- ===== C1 ผู้ส่ง (ช่าง) ชี้แจง หาย/เสีย ยังทำงาน · ผู้รับเห็น arrive ผู้ส่งไม่เห็น =====
  wS := (pg_temp.wu(p_shop, 'vfy-ช่างส่ง', 'polish', '1122') ->> 'id')::uuid;
  wC := pg_temp.wcv(p_shop);
  d := pg_temp.fx(p_shop, p_tpl, pn, 20, 5);
  j := pg_temp.jid(d); th := d ->> 'tokh';
  sS := pg_temp.sess(th, wS, '1122'); sC := pg_temp.sess(th, wC, '2468');
  r := pg_temp.wr(th, sS, 6); r2 := pg_temp.ws(th, sS, 6); r3 := pg_temp.wr(th, sC, 7, null, 17);
  dd := pg_temp.disc_of(j);
  v_log := v_log || pg_temp.chk('C1a', 'fixture: ช่างส่ง (ขัด) ส่ง 20 → ผู้รับ QC รับ 17 → ส่วนต่าง 3 · ผู้ส่งเห็น action explain (เดิม) ไม่เห็น arrive · ผู้รับเห็น arrive ไม่เห็น explain',
    (r ->> 'ok') = 'true' and (r2 ->> 'ok') = 'true' and (r3 ->> 'ok') = 'true' and dd is not null
    and exists (select 1 from jsonb_array_elements(pg_temp.w_res(th, sS) -> 'my_actions') a where a ->> 'action' = 'explain' and (a ->> 'discrepancy_id')::uuid = dd)
    and not pg_temp.has_arr(pg_temp.w_res(th, sS)) and pg_temp.has_arr(pg_temp.w_res(th, sC))
    and not exists (select 1 from jsonb_array_elements(pg_temp.w_res(th, sC) -> 'my_actions') a where a ->> 'action' = 'explain'));
  r := pg_temp.wd(th, sS, dd, 'lost', 'missing');
  v_log := v_log || pg_temp.chk('C1b', 'ต้องไม่พัง: ผู้ส่งชี้แจง "หาย" ได้ (เส้นเดิม) · แถว resolved/lost 3 · ผู้รับกด arrive ต่อ = already_resolved · ไม่เกิดส่วน · action arrive หายไปจากผู้รับ · ต้นไม้ไม่ drift',
    (r ->> 'ok') = 'true' and pg_temp.drows(j) = 'resolved/lost:3' and (pg_temp.wa(th, sC, dd, 1) ->> 'code') = 'already_resolved' and pg_temp.rej(pg_temp.oa(p_shop, dd, 1), 'already_resolved')
    and pg_temp.nlots(j) = 0 and not pg_temp.has_arr(pg_temp.w_res(th, sC)) and pg_temp.dcount(j) = 0 and pg_temp.sumok(j));

  -- ===== C1c ออฟฟิศชี้แจง "เสีย" → เดินจนปิดใบ (ดี 17 + เสีย 3 = 20) — golden เส้นเดิม =====
  m := pg_temp.mkdisc(p_shop, p_tpl, 20, 17);
  j := (m ->> 'job')::uuid; th := m ->> 'tokh'; sC := m ->> 'sc'; dd := (m ->> 'disc')::uuid;
  r := pg_temp.o_dres(p_shop, dd, 'scrap', 'porosity');
  r2 := pg_temp.ws(th, sC, 7); r3 := pg_temp.wr(th, sC, 8);
  perform pg_temp.ws(th, sC, 8);
  v_log := v_log || pg_temp.chk('C1c', 'ต้องไม่พัง: ออฟฟิศชี้แจง "เสีย" ได้ · arrive หลังนั้น = already_resolved · เดินครบ · ปิดใบ ดี 17 + เสีย 3 = 20 ผ่าน (ไม่มี arrived) · identity 0 · ต้นไม้ไม่ drift',
    (r ->> 'ok') = 'true' and pg_temp.drows(j) = 'resolved/scrap:3' and pg_temp.rej(pg_temp.oa(p_shop, dd, 1), 'already_resolved')
    and (r2 ->> 'ok') = 'true' and (r3 ->> 'ok') = 'true'
    and pg_temp.rej(pg_temp.o_done(p_shop, j, 17, 2), 'qty_mismatch') and (pg_temp.o_done(p_shop, j, 17, 3) ->> 'ok') = 'true'
    and analytics.job_identity_gap(j) = 0 and analytics.job_arrived_qty(j) = 0 and pg_temp.dcount(j) = 0 and pg_temp.sumok(j));

  -- ===== C1d void (ย้อนขั้นผู้รับก่อน) ยังทำงาน · arrive ที่แถวที่ถูก void = already_resolved =====
  m := pg_temp.mkdisc(p_shop, p_tpl, 20, 17);
  j := (m ->> 'job')::uuid; th := m ->> 'tokh'; wC := (m ->> 'wc')::uuid; sC := m ->> 'sc'; dd := (m ->> 'disc')::uuid;
  r := pg_temp.o_reopen(p_shop, j, 'ย้อนเพื่อ void');
  r2 := pg_temp.o_dvoid(p_shop, dd, 'นับผิด');
  v_log := v_log || pg_temp.chk('C1d', 'ต้องไม่พัง: ย้อนขั้นผู้รับ → void ส่วนต่าง ok (เส้นเดิม) · arrive แถวที่ถูก void = already_resolved · ไม่เกิดส่วน · รับใหม่ครบ 20 ได้ · ไม่มีส่วนต่าง · ต้นไม้ไม่ drift',
    (r ->> 'ok') = 'true' and (r2 ->> 'ok') = 'true' and pg_temp.disc_of(j) is null and (pg_temp.wa(th, sC, dd, 1) ->> 'code') = 'already_resolved' and pg_temp.rej(pg_temp.oa(p_shop, dd, 1), 'already_resolved')
    and pg_temp.nlots(j) = 0 and (pg_temp.o_recv3(p_shop, j, 7, 20, null, wC) ->> 'ok') = 'true' and pg_temp.dcount(j) = 0 and pg_temp.sumok(j));

  -- ===== C2 golden resolve: ใบที่ไม่มีส่วนต่าง = ฉบับเดิมเป๊ะ ทุก key (รวม parts/my_actions) · ใบมีส่วนต่าง = เดิม + action arrive ของผู้รับเท่านั้น =====
  v_mm := 0; v_cnt := 0;
  for v_job in select id from analytics.job where status in ('open', 'in_progress') and parent_job_id is null order by created_at loop
    v_tok := (pg_temp.o_tissue(p_shop, v_job.id, false) ->> 'hash');
    if v_tok is null then continue; end if;
    v_ses := pg_temp.sess(v_tok, wA, '4829');
    v_leg := pg_temp.w_old(v_tok, null, null);
    v_new := pg_temp.w_res(v_tok, null);
    v_cnt := v_cnt + 1; if pg_temp.strip_arr(v_new) is distinct from v_leg then v_mm := v_mm + 1; end if;
    v_leg := pg_temp.w_old(v_tok, v_ses, null);
    v_new := pg_temp.w_res(v_tok, v_ses);
    v_cnt := v_cnt + 1; if pg_temp.strip_arr(v_new) is distinct from v_leg then v_mm := v_mm + 1; end if;
  end loop;
  v_log := v_log || pg_temp.chk('C2a', format('golden resolve บนใบจริงที่ยังเปิด: %s คู่ (ก่อน/หลัง PIN) ผลฉบับ 0183 (ตัด arrive ถ้ามี) = ฉบับเดิมเป๊ะทุก key รวม parts/my_actions · ไม่ตรง %s', v_cnt, v_mm), v_mm = 0);
  v_mm := 0; v_cnt := 0;
  foreach d in array array[
      pg_temp.fx(p_shop, p_tpl, pn, 10, 0), pg_temp.fx(p_shop, p_tpl, pn, 10, 3), pg_temp.fx(p_shop, p_tpl, pw, 10, 3, 'silver', 9.9),
      pg_temp.fx(p_shop, p_tpl, pg_, 10, 3, 'gold', 9.9), pg_temp.fx(p_shop, p_tpl, pn, 10, 8)] loop
    j := pg_temp.jid(d); th := d ->> 'tokh';
    sA := pg_temp.sess(th, wA, '4829'); sB := pg_temp.sess(th, wB, '7351');
    for i in 1 .. 2 loop
      if i = 2 and (select status from analytics.job_stage where job_id = j and seq = 4) = 'pending' then
        perform pg_temp.wr(th, sA, 4, null, null, case when (select weigh_required from analytics.job_stage where job_id = j and seq = 4) then 9.9 end);
      end if;
      foreach v_ses in array array[null, sA, sB] loop
        v_leg := pg_temp.w_old(th, v_ses, null);
        v_new := pg_temp.w_res(th, v_ses);
        v_cnt := v_cnt + 1; if v_new is distinct from v_leg then v_mm := v_mm + 1; end if;
      end loop;
    end loop;
  end loop;
  v_log := v_log || pg_temp.chk('C2b', format('golden resolve บนใบใหม่ 5 แบบ (ยังไม่เริ่ม · กลางทาง · ชั่งเงิน · ทอง · ครบรอปิด) × ผู้ดู 3 × 2 สถานะ = %s คู่ ไม่ตัดอะไรเลย (รวม parts/my_actions) เท่าฉบับเดิมเป๊ะ · ไม่ตรง %s', v_cnt, v_mm), v_mm = 0 and v_cnt = 30);
  -- ใบมีส่วนต่าง: ผู้ส่ง/คนนอก = เท่าเดิมทุก key · ผู้รับ = เดิม + arrive (ตัดออกแล้วเท่าเดิม) · ผู้ดูก่อน PIN เท่าเดิม
  m := pg_temp.mkdisc(p_shop, p_tpl, 20, 17);
  j := (m ->> 'job')::uuid; th := m ->> 'tokh'; wC := (m ->> 'wc')::uuid; sC := m ->> 'sc';
  sA := pg_temp.sess(th, wA, '4829');
  v_ok := true;
  foreach v_ses in array array[null, sA, sC] loop
    v_ok := v_ok and pg_temp.strip_arr(pg_temp.w_res(th, v_ses)) is not distinct from pg_temp.w_old(th, v_ses, null);
  end loop;
  v_log := v_log || pg_temp.chk('C2c', 'ใบมีส่วนต่างเปิด: ผู้ดู 3 แบบ (ก่อน PIN · ช่างนอก · ผู้รับ) ผลฉบับ 0183 ตัด arrive แล้ว = ฉบับเดิมเป๊ะ · ช่างนอก/ก่อน PIN ไม่ถูกตัดอะไรเลย (ไม่มี arrive อยู่แล้ว) · ผู้รับมี arrive 1 รายการ (ต่างจากเดิมที่ arrive อย่างเดียว)',
    v_ok and pg_temp.w_res(th, sA) is not distinct from pg_temp.w_old(th, sA, null) and pg_temp.w_res(th, null) is not distinct from pg_temp.w_old(th, null, null)
    and pg_temp.w_res(th, sC) is distinct from pg_temp.w_old(th, sC, null) and pg_temp.has_arr(pg_temp.w_res(th, sC))
    and (select count(*) from jsonb_array_elements(pg_temp.w_res(th, sC) -> 'my_actions') a where a ->> 'action' = 'arrive') = 1);

  -- ===== C3 แยกส่วนเดิม (ไม่มีส่วนต่าง): แยก → ส่วนเดินจนปิด → แม่ส่งที่เหลือ → ปิดแม่ ดี 7 + แยก 3 = 10 · เหมือนเดิม =====
  d := pg_temp.fx(p_shop, p_tpl, pn, 10, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh';
  r := pg_temp.o_recv(p_shop, j, 4, v_today, null, null, 'verify');
  r2 := pg_temp.o_split(p_shop, j, 4, 3, 0, null, 10);
  l1 := pg_temp.lot(r2);
  r3 := pg_temp.rw(p_shop, l1, null, 8);
  v_ok := (r3 ->> 'ok') = 'true' and (pg_temp.o_done(p_shop, l1, 3, 0) ->> 'ok') = 'true';
  r3 := pg_temp.rw(p_shop, j, null, 8);
  v_log := v_log || pg_temp.chk('C3', 'ต้องไม่พัง: แยกส่วนเดิม (ไม่มีส่วนต่าง) → ส่วน 3 ชิ้นเดินจนปิด → แม่ส่งที่เหลือ 7 → ปิดแม่ ดี 7 + แยก 3 = 10 · qty_mismatch ถ้าไม่รวมแยก · job_arrived_qty 0 · identity 0 · drift ว่าง',
    (r ->> 'ok') = 'true' and (r2 ->> 'ok') = 'true' and v_ok and (r3 ->> 'ok') = 'true' and pg_temp.rej(pg_temp.o_done(p_shop, j, 7, 3), 'qty_mismatch')
    and (pg_temp.o_done(p_shop, j, 7, 0) ->> 'ok') = 'true' and analytics.job_arrived_qty(j) = 0 and analytics.job_identity_gap(j) = 0 and pg_temp.dcount(j) = 0 and pg_temp.sumok(j)
    and pg_temp.nev(j, 'discrepancy_arrive') = 0);

  -- ===== C3b ยกเลิกส่วนที่แยกตามปกติ (golden): event ฝั่งแม่ผูกขั้นที่แยก · payload มี before/after · ไม่มี key arrive_lot · คืนชิ้นกลับขั้นแม่ =====
  d := pg_temp.fx(p_shop, p_tpl, pn, 10, 3);
  j := pg_temp.jid(d);
  r := pg_temp.o_recv(p_shop, j, 4, v_today, null, null, 'verify');
  r2 := pg_temp.o_split(p_shop, j, 4, 3, 0, null, 10);
  l1 := pg_temp.lot(r2);
  r3 := pg_temp.o_lcancel(p_shop, l1, 'ยกเลิกเทส', 'return_to_parent');
  v_log := v_log || pg_temp.chk('C3b', 'ต้องไม่พัง: ยกเลิกส่วนที่แยกตามปกติ (คืนชิ้น) ok · event split_cancel ฝั่งแม่ผูกขั้นที่แยก · payload before/after ไม่ null · ไม่มี key arrive_lot · split_out ขั้นแม่กลับ 0 · ต้นไม้ไม่ drift',
    (r2 ->> 'ok') = 'true' and (r3 ->> 'ok') = 'true'
    and exists (select 1 from analytics.job_event e where e.job_id = j and e.event_type = 'split_cancel' and e.job_stage_id = pg_temp.sid(j, 4)
                  and (e.payload -> 'before') is not null and jsonb_typeof(e.payload -> 'before') = 'object' and jsonb_typeof(e.payload -> 'after') = 'object' and not (e.payload ? 'arrive_lot'))
    and pg_temp.sv(j, 4, 'qty_split_out') = '0' and pg_temp.dcount(j) = 0 and pg_temp.sumok(j));

  -- ===== C4 ด่านกันเขียนตรง (guard): arrived เกิดทางเดียว · void/UPDATE แถว arrived ไม่ได้ · flag ล้างหลังใช้ · ส่วนจาก arrive ย้อน/ผูกใหม่ไม่ได้ =====
  m := pg_temp.mkdisc(p_shop, p_tpl, 50, 47);
  j := (m ->> 'job')::uuid; th := m ->> 'tokh'; wC := (m ->> 'wc')::uuid; sC := m ->> 'sc'; dd := (m ->> 'disc')::uuid;
  r := pg_temp.wa(th, sC, dd, 1, null, 3);
  arr := (r ->> 'arrived_id')::uuid; rem := (r ->> 'discrepancy_id')::uuid; l1 := pg_temp.lot(r);
  ls := pg_temp.sid(l1, 7);
  v_rows := pg_temp.drows(j);
  v_log := v_log || pg_temp.chk('C4a', 'UPDATE ตรงแถว open ที่เหลือ → resolved/arrived (ไม่ผ่านเส้น arrive) = ปฏิเสธ arrived_no_update · แถวไม่ขยับ',
    pg_temp.x2(format('update analytics.job_discrepancy set status = ''resolved'', resolved_kind = ''arrived'', resolved_reason = ''x'', resolved_at = now() where id = %L', rem)) like 'ERR:22023:arrived_no_update:%'
    and pg_temp.drows(j) = v_rows and pg_temp.d_status(rem) = 'open');
  -- C4b ใช้ใบแยก: arrive แล้วย้อนขั้นผู้รับของใบเดิมเป็นยังไม่รับ (ด่านขั้นผู้รับไม่บังด่าน "void แถว arrived ไม่ได้")
  m2 := pg_temp.mkdisc(p_shop, p_tpl, 50, 47);
  j2 := (m2 ->> 'job')::uuid;
  r2 := pg_temp.wa(m2 ->> 'tokh', m2 ->> 'sc', (m2 ->> 'disc')::uuid, 1, null, 3);
  r3 := pg_temp.o_reopen(p_shop, j2, 'ย้อนเพื่อทดสอบ void');
  v_rows2 := pg_temp.drows(j2);
  v_log := v_log || pg_temp.chk('C4b', 'void แถว arrived (ขั้นผู้รับใบเดิมถูกย้อนเป็น pending แล้ว): ออฟฟิศกด void = ปฏิเสธ arrived_no_void · INSERT void ตรง = arrived_no_void · ไม่เกิดแถว void ใหม่ · ชิ้นอยู่ที่ส่วนใหม่',
    (r2 ->> 'ok') = 'true' and (r3 ->> 'ok') = 'true' and pg_temp.sv(j2, 7, 'status') = 'pending'
    and pg_temp.rej(pg_temp.o_dvoid(p_shop, (r2 ->> 'arrived_id')::uuid, 'ลองยกเลิก'), 'arrived_no_void')
    and pg_temp.x2(format('insert into analytics.job_discrepancy (shop_id, root_job_id, job_id, from_stage_id, to_stage_id, qty, status, void_of_id, void_reason) select shop_id, root_job_id, job_id, from_stage_id, to_stage_id, qty, ''void'', id, ''x'' from analytics.job_discrepancy where id = %L', (r2 ->> 'arrived_id')::uuid)) like 'ERR:22023:arrived_no_void:%'
    and pg_temp.drows(j2) = v_rows2 and pg_temp.nlots(j2) = 1);
  -- C4c ใช้ใบแยก: ย้อนขั้นผู้รับเป็นยังไม่รับก่อน (ด่าน "ขั้นผู้รับต้องยังไม่รับ" จะไม่บังด่าน arrived) เพื่อทดสอบด่านกฎ "arrived เกิดทางเดียว" โดยตรง
  m2 := pg_temp.mkdisc(p_shop, p_tpl, 50, 47);
  j2 := (m2 ->> 'job')::uuid; dd2 := (m2 ->> 'disc')::uuid;
  perform pg_temp.o_reopen(p_shop, j2, 'ย้อนเพื่อทดสอบ');
  v_log := v_log || pg_temp.chk('C4c', 'INSERT แถว resolved/arrived ตรง (ไม่ผ่านเส้น arrive · flag ปิด · ขั้นผู้รับ pending) = ปฏิเสธ (arrived สร้างได้ทางเดียว) · ไม่เกิดแถว',
    pg_temp.x2(format('insert into analytics.job_discrepancy (shop_id, root_job_id, job_id, from_stage_id, to_stage_id, qty, status, resolved_kind, resolved_reason, resolved_at) select shop_id, root_job_id, job_id, from_stage_id, to_stage_id, 1, ''resolved'', ''arrived'', ''x'', now() from analytics.job_discrepancy where id = %L', dd2)) like 'ERR:22023:%'
    and pg_temp.drows(j2) = 'open:3');
  v_log := v_log || pg_temp.chk('C4d', 'flag app.job_arrive ล้างหลัง arrive สำเร็จ (off) · INSERT แถว open ตรงขณะขั้นผู้รับ received (ไม่ผ่านเส้น arrive) = ปฏิเสธ · ไม่เกิดแถว',
    coalesce(nullif(current_setting('app.job_arrive', true), ''), 'off') = 'off'
    and pg_temp.x2(format('insert into analytics.job_discrepancy (shop_id, root_job_id, job_id, from_stage_id, to_stage_id, qty, status) select shop_id, root_job_id, job_id, from_stage_id, to_stage_id, 1, ''open'' from analytics.job_discrepancy where id = %L', rem)) like 'ERR:22023:%'
    and pg_temp.drows(j) = v_rows);
  -- flag ล้างหลัง arrive ที่ถูกปฏิเสธ (ด่านน้ำหนัก/จำนวน) ด้วย
  perform pg_temp.wa(th, sC, rem, 99);
  v_log := v_log || pg_temp.chk('C4e', 'flag ล้างหลัง arrive ที่ถูกปฏิเสธ (qty เกิน) ด้วย · แถวไม่ขยับ',
    coalesce(nullif(current_setting('app.job_arrive', true), ''), 'off') = 'off' and pg_temp.drows(j) = v_rows);
  v_log := v_log || pg_temp.chk('C4f', 'ส่วนที่เกิดจาก arrive: ย้อนขั้นรับขาด (received → pending) = ปฏิเสธ has_split · ขั้นยัง received · ผูก arrive ยังอยู่',
    pg_temp.rej(pg_temp.o_reopen(p_shop, l1, 'ลองย้อน'), 'has_split') and pg_temp.sv(l1, 7, 'status') = 'received' and pg_temp.sv(l1, 7, 'arrive_discrepancy_id') = arr::text);
  v_log := v_log || pg_temp.chk('C4g', 'UPDATE ตรง job_stage.arrive_discrepancy_id ของส่วน (→ null · → แถวอื่น) = ปฏิเสธ · ค่าคงเดิม · ต้นไม้ไม่ drift',
    pg_temp.x2(format('update analytics.job_stage set arrive_discrepancy_id = null where id = %L', ls)) like 'ERR:22023:%'
    and pg_temp.x2(format('update analytics.job_stage set arrive_discrepancy_id = %L where id = %L', rem, ls)) like 'ERR:%'
    and pg_temp.sv(l1, 7, 'arrive_discrepancy_id') = arr::text and pg_temp.dcount(j) = 0);
  v_log := v_log || pg_temp.chk('C4h', 'ผูก arrive_discrepancy_id ตรงกับขั้นของใบอื่น (ใบแม่เอง ไม่ใช่ส่วน) = ปฏิเสธ · ขั้นที่ผูกพร้อม split_from = ปฏิเสธ (CHECK)',
    pg_temp.x2(format('update analytics.job_stage set arrive_discrepancy_id = %L where id = %L', arr, pg_temp.sid(j, 3))) like 'ERR:%'
    and pg_temp.x2(format('update analytics.job_stage set split_from_stage_id = %L where id = %L', pg_temp.sid(j, 7), ls)) like 'ERR:%'
    and pg_temp.sv(j, 3, 'arrive_discrepancy_id') is null and pg_temp.dcount(j) = 0);
  return v_log;
end;
$s$;

-- ============================================================================
-- Section D — ทอง: ด่านน้ำหนักของชิ้นที่มาถึง (≤ ส่วนที่ขาด + 0.05 g) · ไม่เปิดเผยน้ำหนักให้ช่าง (N1) · L-2 ล็อก · ขั้นไม่ชั่ง · ส่วนใหม่เดินต่อ
-- ============================================================================
create function pg_temp.sd(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  m jsonb; j uuid; th text; wC uuid; sC text; dd uuid; r jsonb; r2 jsonb; r3 jsonb; r4 jsonb; r5 jsonb; l1 uuid; l2 uuid; rem uuid; a jsonb;
  m4 jsonb; j4 uuid; th4 text; sC4 text; dd4 uuid; pq uuid; r6 jsonb;
  m2 jsonb; j2 uuid; th2 text; sC2 text; dd2 uuid; d jsonb; wB uuid; sB text; pg_ uuid; pw uuid; v_n int; v_rows text; i int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pg_ := pg_temp.pid(p_shop, 'gold'); pw := pg_temp.mkprof(p_shop, 'vfy-ชั่งหล่อ+ตัดต้น');
  wB := pg_temp.wid(p_shop, 'vfy-ช่าง B', '7351');

  -- ===== fixture A: ทองแบบชั่งทุกขั้น: ส่ง 10 ชิ้น 10.000 g → QC (ช่างรับ) รับ 8 ชิ้น ชั่ง 8.000 g → ส่วนต่าง 2 ชิ้น gap −2.000 =====
  m := pg_temp.mkdisc(p_shop, p_tpl, 10, 8, 6, null, 'gold', 10.0, 8.0);
  j := (m ->> 'job')::uuid; th := m ->> 'tokh'; wC := (m ->> 'wc')::uuid; sC := m ->> 'sc'; dd := (m ->> 'disc')::uuid;
  v_rows := pg_temp.drows(j);
  v_log := v_log || pg_temp.chk('D0', 'fixture ทอง: ขั้นรับขาด weigh_required · weight_in 8.000 · ส่วนต่างเปิด 2 ชิ้น gap −2.000 weight_sent 10.000 qty_sent 10 · ผู้รับเห็น arrive (weight_required true)',
    pg_temp.sv(j, 7, 'weigh_required') = 'true' and pg_temp.sv(j, 7, 'weight_in_g') = '8.000' and v_rows = 'open:2'
    and (select weight_gap_g = -2 and weight_sent_g = 10 and qty_sent = 10 from analytics.job_discrepancy where id = dd)
    and coalesce((pg_temp.arr_act(pg_temp.w_res(th, sC)) ->> 'weight_required') = 'true', false));
  v_log := v_log || pg_temp.chk('D1', 'ทอง: ไม่ส่งน้ำหนัก = arrive_weight_required (ข้อความไม่มีตัวเลข) · น้ำหนัก 0 / −1 / 100001 / 1.2345 = weight_invalid · ออฟฟิศไม่ส่งน้ำหนักก็ปฏิเสธเหมือนกัน · ไม่เกิดส่วน/แถว/event mismatch',
    (pg_temp.wa(th, sC, dd, 1, null) ->> 'code') = 'arrive_weight_required' and pg_temp.nodigit(pg_temp.wa(th, sC, dd, 1, null)) and pg_temp.rej(pg_temp.oa(p_shop, dd, 1, null), 'arrive_weight_required')
    and (pg_temp.wa(th, sC, dd, 1, 0) ->> 'code') = 'weight_invalid' and (pg_temp.wa(th, sC, dd, 1, -1) ->> 'code') = 'weight_invalid'
    and (pg_temp.wa(th, sC, dd, 1, 100001) ->> 'code') = 'weight_invalid' and (pg_temp.wa(th, sC, dd, 1, 1.2345) ->> 'code') = 'weight_invalid'
    and pg_temp.rej(pg_temp.oa(p_shop, dd, 1, 0), 'weight_invalid')
    and pg_temp.nlots(j) = 0 and pg_temp.drows(j) = v_rows and pg_temp.nev(j, 'weigh') = 0);
  -- หนักเกินส่วนที่ขาด (ขาด 2.000 g · เพดาน 2.05 g): 2.06 / 5 = arrive_heavy · ครั้งที่ 3 = office_required · ครั้งที่ 4 ชั่งถูกก็ล็อก · ออฟฟิศไม่ถูกล็อก
  r := pg_temp.wa(th, sC, dd, 1, 2.06); r2 := pg_temp.wa(th, sC, dd, 1, 5); r3 := pg_temp.wa(th, sC, dd, 1, 2.2); r4 := pg_temp.wa(th, sC, dd, 1, 1.0);
  select count(*) into v_n from analytics.job_event e where e.job_id = j and e.event_type = 'weigh' and e.payload ->> 'kind' = 'arrive_mismatch';
  v_log := v_log || pg_temp.chk('D2a', 'ช่างชั่งหนักเกิน (2.06 / 5 g) = arrive_heavy ข้อความ+key ไม่มีน้ำหนัก/ส่วนที่ขาด · ครั้งที่ 3 (2.2) = office_required · ครั้งที่ 4 ชั่งถูก (1.0) ก็ = office_required (ล็อก) · event mismatch 3 รายการ · ไม่เกิดส่วน/แถว',
    (r ->> 'code') = 'arrive_heavy' and (r2 ->> 'code') = 'arrive_heavy' and pg_temp.nodigit(r) and pg_temp.nodigit(r2) and pg_temp.keys(r) !~ 'weight|missing|gap'
    and (r3 ->> 'code') = 'office_required' and pg_temp.nodigit(r3) and (r4 ->> 'code') = 'office_required' and v_n = 3
    and pg_temp.nlots(j) = 0 and pg_temp.drows(j) = v_rows);
  r := pg_temp.oa(p_shop, dd, 1, 2.06);
  r2 := pg_temp.oa(p_shop, dd, 1, 1.0, null, wB, 2);
  l1 := pg_temp.lot(r2);
  v_log := v_log || pg_temp.chk('D2b', 'ออฟฟิศไม่ถูกล็อก 3 ครั้งของช่าง: หนักเกินยังปฏิเสธ (arrive_heavy) · ชั่งถูก 1.0 + เลือกผู้ถือ B + expected_open 2 = ok · ส่วนใหม่ weight_in 1.000 · ผู้ถือ B',
    pg_temp.rej(r, 'arrive_heavy') and (r2 ->> 'ok') = 'true' and pg_temp.sv(l1, 7, 'weight_in_g') = '1.000' and pg_temp.sv(l1, 7, 'worker_id') = wB::text and pg_temp.dcount(j) = 0 and pg_temp.sumok(j));

  -- ===== fixture B: เส้นปกติของทอง + ขอบเพดาน =====
  m2 := pg_temp.mkdisc(p_shop, p_tpl, 10, 8, 6, null, 'gold', 10.0, 8.0);
  j2 := (m2 ->> 'job')::uuid; th2 := m2 ->> 'tokh'; sC2 := m2 ->> 'sc'; dd2 := (m2 ->> 'disc')::uuid;
  r := pg_temp.wa(th2, sC2, dd2, 1, 1.0, 2);
  l1 := pg_temp.lot(r); rem := (r ->> 'discrepancy_id')::uuid;
  v_log := v_log || pg_temp.chk('D3a', 'ทอง arrive 1 จาก 2 ชั่ง 1.000 g = ok · ส่วนใหม่ weight_in 1.000 weight_start 1.000 weigh_required · แถว arrived เก็บน้ำหนักเชิงบัญชี (gap −1.000 = 0 − สัดส่วนชิ้นที่มาถึง · excess 0) · ธง tree_weight_gap_excess_g ของใบ = 0 (ไม่หาย ไม่เกิน) · แถว open ที่เหลือ gap −1.000 (= −2 + 1) weight_sent 10.000 qty_sent 10 · event เก็บ weight_g 1.0 + gap_after −1.0 · response ช่างไม่มีน้ำหนัก/gap/missing · ไม่ drift',
    (r ->> 'ok') = 'true' and pg_temp.sv(l1, 7, 'weight_in_g') = '1.000' and pg_temp.jv(l1, 'weight_start_g') = '1.000' and pg_temp.jv(l1, 'weigh_required') = 'true'
    and (select weight_gap_g = -1 and weight_sent_g = 10 and qty_sent = 10 from analytics.job_discrepancy where id = (r ->> 'arrived_id')::uuid)
    and (select tree_weight_gap_excess_g = 0 from analytics.v_job_board where id = j2)
    and (select weight_gap_g = -1 and weight_sent_g = 10 and qty_sent = 10 and qty = 1 from analytics.job_discrepancy where id = rem)
    and exists (select 1 from analytics.job_event where job_id = j2 and event_type = 'discrepancy_arrive' and (payload ->> 'weight_g')::numeric = 1.0 and (payload ->> 'gap_after_g')::numeric = -1.0)
    and pg_temp.keys(r) !~ 'weight|missing|gap' and pg_temp.clean_keys(r) and pg_temp.dcount(j2) = 0 and pg_temp.sumok(j2));
  r2 := pg_temp.wa(th2, sC2, rem, 1, 1.06, 1);
  r3 := pg_temp.wa(th2, sC2, rem, 1, 1.05, 1);
  l2 := pg_temp.lot(r3);
  v_log := v_log || pg_temp.chk('D3b', 'ขอบเพดาน (ขาดเหลือ 1.000 g): 1.06 = arrive_heavy (เกิน 1.05) · 1.05 พอดี = ok (≤ ส่วนที่ขาด + 0.05) · ครบแล้ว: ไม่มีแถว open · ส่วนที่ 2 weight_in 1.050 · gap ไม่คงเหลือ · ต้นไม้ไม่ drift',
    (r2 ->> 'code') = 'arrive_heavy' and (r3 ->> 'ok') = 'true'
    and pg_temp.disc_of(j2) is null and pg_temp.nlots(j2) = 2 and pg_temp.sv(l2, 7, 'weight_in_g') = '1.050'
    and pg_temp.dcount(j2) = 0 and pg_temp.sumok(j2));
  -- ช่างได้รับเพิ่ม "บางส่วน" ชั่งเบากว่าส่วนที่ขาดได้ (ของที่เหลือยังค้างให้ตามต่อ) — ปิดทั้งก้อนแต่เบากว่า = ไม่ตรง (D9a)
  m2 := pg_temp.mkdisc(p_shop, p_tpl, 10, 8, 6, null, 'gold', 10.0, 8.0);
  j2 := (m2 ->> 'job')::uuid;
  r := pg_temp.wa(m2 ->> 'tokh', m2 ->> 'sc', (m2 ->> 'disc')::uuid, 1, 0.3, 2);
  v_log := v_log || pg_temp.chk('D4', 'ต้องไม่พัง: ทอง ช่าง arrive "บางส่วน" 1 จาก 2 ชั่งเบากว่าส่วนที่ขาด (0.3 < 2.0) = ok · ส่วนใหม่ weight_in 0.300 · แถวเหลือ gap −1.700 (ยังเห็นว่าขาดอีก 1.7 g) · ธง excess ของใบ = −0.700 (ขาดสุทธิ 1.7 g − สัดส่วนของ 1 ชิ้นที่ยังไม่มา 1.0 g · ไม่ถูกลบ) · ต้นไม้ไม่ drift',
    (r ->> 'ok') = 'true' and pg_temp.sv(pg_temp.lot(r), 7, 'weight_in_g') = '0.300' and (select weight_gap_g = -1.7 from analytics.job_discrepancy where id = (r ->> 'discrepancy_id')::uuid)
    and (select tree_weight_gap_excess_g = -0.7 from analytics.v_job_board where id = j2) and pg_temp.dcount(j2) = 0 and pg_temp.sumok(j2));

  -- ===== D5 N1: action arrive ของผู้รับ ไม่มีน้ำหนัก/ส่วนที่ขาด · key ตรงชุดที่กำหนด =====
  m2 := pg_temp.mkdisc(p_shop, p_tpl, 10, 8, 6, null, 'gold', 10.0, 8.0);
  th2 := m2 ->> 'tokh'; sC2 := m2 ->> 'sc';
  r := pg_temp.w_res(th2, sC2);
  a := pg_temp.arr_act(r);
  v_log := v_log || pg_temp.chk('D5', 'action arrive ของผู้รับ (ทอง): key ตรงชุด (ไม่มี weight_g/gap/missing) · weight_required true · qty 2 · ทั้ง response ไม่มี key ต้นทุน/ราคา/ลูกค้า · ผู้ดูอื่นไม่เห็น',
    (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(a) k) = 'action,discrepancy_id,label,lot_job_id,office_only,qty,qty_expected,qty_hold,scrap_qty_ask,scrap_weight_ask,stage_code,stage_name,stage_seq,weight_required'
    and (a ->> 'weight_required') = 'true' and (a ->> 'qty') = '2' and pg_temp.clean_keys(r) and pg_temp.keys(a) !~ 'gap|missing|weight_g'
    and not pg_temp.has_arr(pg_temp.w_res(th2, pg_temp.sess(th2, wB, '7351'))));

  -- ===== D6 L-2: ช่างรับไม่ครบชั่งไม่ผ่าน 3 ครั้งถูกล็อก → ออฟฟิศรับแทน → ส่วนต่างทองที่ล็อก ช่างกด arrive ได้ แต่ต้องผ่านด่านน้ำหนัก =====
  d := pg_temp.fx(p_shop, p_tpl, pg_, 10, 6, 'gold', 10.0);
  j2 := pg_temp.jid(d); th2 := d ->> 'tokh'; sB := pg_temp.sess(th2, wB, '7351');
  r := pg_temp.wr(th2, sB, 7, null, 8, 10.2); r2 := pg_temp.wr(th2, sB, 7, null, 8, 10.3); r3 := pg_temp.wr(th2, sB, 7, null, 8, 10.4); r4 := pg_temp.wr(th2, sB, 7, null, 8, 8);
  r5 := pg_temp.o_recv3(p_shop, j2, 7, 8, 8.0, wB);
  dd2 := pg_temp.disc_of(j2);
  v_log := v_log || pg_temp.chk('D6a', 'fixture L-2: ชั่งหนักเกิน 3 ครั้ง = ล็อก (ครั้งที่ 3 และชั่งถูกครั้งที่ 4 = office_required) · ออฟฟิศรับแทน 8 ชิ้น 8.000 g (ผู้ถือ B) = ok · ส่วนต่างเปิด 2 ชิ้น gap −2.000',
    (r ->> 'code') = 'handoff_mismatch' and (r2 ->> 'code') = 'handoff_mismatch' and (r3 ->> 'code') = 'office_required' and (r4 ->> 'code') = 'office_required' and (r5 ->> 'ok') = 'true'
    and dd2 is not null and (select weight_gap_g = -2 from analytics.job_discrepancy where id = dd2));
  r := pg_temp.wa(th2, sB, dd2, 2, null, 2);
  r2 := pg_temp.wa(th2, sB, dd2, 2, 2.5, 2);
  r3 := pg_temp.wa(th2, sB, dd2, 2, 2.0, 2);
  v_log := v_log || pg_temp.chk('D6b', 'ส่วนต่างทองที่ล็อก L-2: ผู้รับ (B) กด arrive ได้ แต่ต้องผ่านด่านน้ำหนัก: ไม่ชั่ง = arrive_weight_required · 2.5 (เกิน 2.05) = arrive_heavy · 2.0 = ok · ไม่เกิดส่วนในสองครั้งแรก · ต้นไม้ไม่ drift',
    (r ->> 'code') = 'arrive_weight_required' and (r2 ->> 'code') = 'arrive_heavy' and (r3 ->> 'ok') = 'true' and pg_temp.nlots(j2) = 1 and pg_temp.disc_of(j2) is null
    and pg_temp.sv(pg_temp.lot(r3), 7, 'weight_in_g') = '2.000' and pg_temp.dcount(j2) = 0 and pg_temp.sumok(j2));

  -- ===== D7 ทอง + แบบการบันทึกที่ขั้นรับขาดไม่ชั่ง: นับจำนวนอย่างเดียว · ส่งน้ำหนักมา = weight_unexpected =====
  d := pg_temp.fx(p_shop, p_tpl, pw, 10, 3, 'gold');
  j2 := pg_temp.jid(d); th2 := d ->> 'tokh';
  for i in 4 .. 5 loop
    perform pg_temp.o_recv(p_shop, j2, i, analytics.job_today(), 9.9, null, 'verify');
    perform pg_temp.o_send(p_shop, j2, i, analytics.job_today(), 9.9);
  end loop;
  perform pg_temp.o_recv(p_shop, j2, 6, analytics.job_today(), null, null, 'verify');
  perform pg_temp.o_send(p_shop, j2, 6, analytics.job_today());
  wC := pg_temp.wcv(p_shop); sC2 := pg_temp.sess(th2, wC, '2468');
  r := pg_temp.wr(th2, sC2, 7, null, 8);
  dd2 := pg_temp.disc_of(j2);
  r2 := pg_temp.wa(th2, sC2, dd2, 1, 1.0);
  r3 := pg_temp.oa(p_shop, dd2, 1, 1.0);
  r4 := pg_temp.wa(th2, sC2, dd2, 1, null);
  v_log := v_log || pg_temp.chk('D7', 'ทอง ขั้นรับขาดไม่ชั่ง (แบบชั่งเฉพาะหล่อ/ตัดต้น): ส่วนต่างเปิด 1 ชิ้นไม่มี gap · action arrive weight_required false · ส่งน้ำหนัก (ช่าง/ออฟฟิศ) = weight_unexpected · นับจำนวนอย่างเดียว = ok · ส่วนใหม่ไม่มีน้ำหนัก · ไม่เกิด event mismatch',
    (r ->> 'ok') = 'true' and dd2 is not null and pg_temp.sv(j2, 7, 'weigh_required') = 'false' and (select weight_gap_g is null from analytics.job_discrepancy where id = dd2)
    and coalesce((pg_temp.arr_act(pg_temp.w_res(th2, sC2)) ->> 'weight_required') = 'false', false)
    and (r2 ->> 'code') = 'weight_unexpected' and pg_temp.rej(r3, 'weight_unexpected') and pg_temp.nlots(j2) = 1
    and (r4 ->> 'ok') = 'true' and pg_temp.sv(pg_temp.lot(r4), 7, 'weight_in_g') is null
    and pg_temp.nev(j2, 'weigh') = 0 and pg_temp.dcount(j2) = 0 and pg_temp.sumok(j2));

  -- ===== D8 ส่วนใหม่ของทองเดินต่อได้ (ชั่งส่งต่อ/รับถัดไป/ปิดส่วน) · ปิดใบเดิมที่ทองได้ =====
  m2 := pg_temp.mkdisc(p_shop, p_tpl, 10, 8, 6, null, 'gold', 10.0, 8.0);
  j2 := (m2 ->> 'job')::uuid; th2 := m2 ->> 'tokh'; sC2 := m2 ->> 'sc'; dd2 := (m2 ->> 'disc')::uuid;
  r := pg_temp.wa(th2, sC2, dd2, 2, 2.0, 2);
  l1 := pg_temp.lot(r);
  r2 := pg_temp.ws(th2, sC2, 7, l1, null, null, 0, null, 2.0);
  r3 := pg_temp.wr(th2, sC2, 8, l1, null, 2.0);
  r4 := pg_temp.ws(th2, sC2, 8, l1, null, null, 0, null, 2.0);
  v_log := v_log || pg_temp.chk('D8', 'ส่วนใหม่ทอง (2 ชิ้น 2.000 g): ส่งต่อที่ขั้นรับขาดพร้อมน้ำหนัก 2.0 · รับแพ็ก · ส่งแพ็ก · ปิดส่วน (ดี 2 น้ำหนัก 2.0) = ok · ต้นไม้ไม่ drift',
    (r ->> 'ok') = 'true' and (r2 ->> 'ok') = 'true' and (r3 ->> 'ok') = 'true' and (r4 ->> 'ok') = 'true'
    and (pg_temp.o_done(p_shop, l1, 2, 0, 2.0) ->> 'ok') = 'true' and pg_temp.jv(l1, 'status') = 'done' and pg_temp.dcount(j2) = 0 and pg_temp.sdrift(j2) = 0);

  -- ===== D9 (security H1): ด่านน้ำหนักสองทิศ · ปิดทั้งก้อนเบาเกิน · ไม่มีน้ำหนักอ้างอิง · ตัวนับต่อขั้น · residual_g =====
  -- D9a ช่างปิดทั้งก้อน (2 จาก 2 · ขาด 2.000 g): เบากว่า 0.3 / 1.94 = arrive_heavy (รหัสเดียวกับหนักเกิน · ข้อความเหมือนกันทุกตัวอักษร) · 1.95 พอดี = ok (ขอบ) · บันทึกทิศใน event (ออฟฟิศเห็น)
  m4 := pg_temp.mkdisc(p_shop, p_tpl, 10, 8, 6, null, 'gold', 10.0, 8.0);
  j4 := (m4 ->> 'job')::uuid; th4 := m4 ->> 'tokh'; sC4 := m4 ->> 'sc'; dd4 := (m4 ->> 'disc')::uuid;
  r := pg_temp.wa(th4, sC4, dd4, 2, 0.3, 2);
  r2 := pg_temp.wa(th4, sC4, dd4, 2, 1.94, 2);
  r3 := pg_temp.wa(th4, sC4, dd4, 2, 2.06, 2);
  r4 := pg_temp.wa(th4, sC4, dd4, 2, 1.95, 2);
  v_log := v_log || pg_temp.chk('D9a', 'ช่างปิดทั้งก้อนเบากว่าส่วนที่ขาด (0.3 / 1.94 ขาด 2.0) = arrive_heavy · หนักเกิน (2.06) = รหัสและข้อความเดียวกันเป๊ะ (กัน binary search) · 1.95 พอดี = ok · event mismatch 3 รายการ บอกทิศ under/over (ออฟฟิศเห็น ช่างไม่เห็น)',
    (r ->> 'code') = 'arrive_heavy' and (r2 ->> 'code') = 'arrive_heavy' and (r3 ->> 'code') = 'office_required' and (r4 ->> 'code') = 'office_required'
    and (select count(*) from analytics.job_event e where e.job_id = j4 and e.payload ->> 'kind' = 'arrive_mismatch' and e.payload ->> 'direction' = 'under') = 2
    and (select count(*) from analytics.job_event e where e.job_id = j4 and e.payload ->> 'kind' = 'arrive_mismatch' and e.payload ->> 'direction' = 'over') = 1
    and pg_temp.nlots(j4) = 0);
  -- (ทดสอบด้านที่ต้องผ่านแยกฟิกซ์เจอร์ ไม่ให้ตัวนับ 3 ครั้งล็อก)
  m4 := pg_temp.mkdisc(p_shop, p_tpl, 10, 8, 6, null, 'gold', 10.0, 8.0);
  j4 := (m4 ->> 'job')::uuid; th4 := m4 ->> 'tokh'; sC4 := m4 ->> 'sc'; dd4 := (m4 ->> 'disc')::uuid;
  r := pg_temp.wa(th4, sC4, dd4, 2, 1.94, 2);
  r2 := pg_temp.wa(th4, sC4, dd4, 2, 2.06, 2);
  r3 := pg_temp.wa(th4, sC4, dd4, 2, 1.95, 2);
  v_log := v_log || pg_temp.chk('D9a2', 'ช่างปิดทั้งก้อน: 1.94 (เบา) และ 2.06 (หนัก) ข้อความเหมือนกันเป๊ะ ไม่มีตัวเลข · 1.95 พอดี (ขอบล่าง) = ok · ต้นไม้ไม่ drift · excess ของใบ = −0.050 (ขาดจริงหลังหักที่เจอ — ธงยังเห็น)',
    (r ->> 'code') = 'arrive_heavy' and (r2 ->> 'code') = 'arrive_heavy' and (r ->> 'message') = (r2 ->> 'message') and pg_temp.nodigit(r) and pg_temp.nodigit(r2)
    and (r3 ->> 'ok') = 'true' and pg_temp.dcount(j4) = 0 and pg_temp.sumok(j4)
    and (select tree_weight_gap_excess_g = -0.05 from analytics.v_job_board where id = j4));
  -- D9b ออฟฟิศปิดทั้งก้อนเบาเกิน = ผ่านได้ + residual_g ใน event + ธง excess ของใบ −1.700 (ทองหายสุทธิ ไม่ถูกลบ) · ออฟฟิศหนักเกิน = ยังปฏิเสธ
  m4 := pg_temp.mkdisc(p_shop, p_tpl, 10, 8, 6, null, 'gold', 10.0, 8.0);
  j4 := (m4 ->> 'job')::uuid; dd4 := (m4 ->> 'disc')::uuid;
  r := pg_temp.oa(p_shop, dd4, 2, 2.06);
  r2 := pg_temp.oa(p_shop, dd4, 2, 0.3, null, null, 2);
  v_log := v_log || pg_temp.chk('D9b', 'ออฟฟิศปิดทั้งก้อน: หนักเกิน (2.06) = ปฏิเสธ arrive_heavy · เบากว่า (0.3) = ok · event discrepancy_arrive มี residual_g 1.700 · แถว arrived เก็บ gap −3.700 (excess −1.700) · ธง tree_weight_gap_excess_g = −1.700 (ทองหาย 1.7 g ยังเห็น) · ไม่มีแถว open ค้าง · ต้นไม้ไม่ drift',
    pg_temp.rej(r, 'arrive_heavy') and (r2 ->> 'ok') = 'true'
    and exists (select 1 from analytics.job_event where job_id = j4 and event_type = 'discrepancy_arrive' and (payload ->> 'residual_g')::numeric = 1.7 and (payload ->> 'weight_g')::numeric = 0.3)
    and (select weight_gap_g = -3.7 and weight_sent_g = 10 and qty_sent = 10 from analytics.job_discrepancy where id = (r2 ->> 'arrived_id')::uuid)
    and (select tree_weight_gap_excess_g = -1.7 from analytics.v_job_board where id = j4)
    and pg_temp.disc_of(j4) is null and pg_temp.dcount(j4) = 0 and pg_temp.sumok(j4));
  -- D9c ไม่มีน้ำหนักอ้างอิง (ทอง · ขั้นที่รับขาดตั้งชั่ง · ขั้นก่อนไม่ชั่ง): ช่างทำไม่ได้ office_required + action arrive ตั้ง office_only · ออฟฟิศผ่านได้ (ไม่มีเพดาน/ไม่มี residual_g)
  pq := (pg_temp.pu(p_shop, null, 'vfy-ชั่งเฉพาะ QC', null, '[{"stage_code":"qc","weigh":true}]') ->> 'id')::uuid;
  d := pg_temp.fx(p_shop, p_tpl, pq, 10, 6, 'gold');
  j4 := pg_temp.jid(d); th4 := d ->> 'tokh';
  wC := pg_temp.wcv(p_shop); sC4 := pg_temp.sess(th4, wC, '2468');
  r6 := pg_temp.wr(th4, sC4, 7, null, 8, 8.0);
  dd4 := pg_temp.disc_of(j4);
  r := pg_temp.wa(th4, sC4, dd4, 1, 1.0, 2);
  r2 := pg_temp.oa(p_shop, dd4, 1, 99.0, null, null, 2);
  v_log := v_log || pg_temp.chk('D9c', 'ไม่มีน้ำหนักอ้างอิง: ผู้รับรับ 8 จาก 10 ได้ (ขั้นก่อนไม่ชั่ง) · action arrive ตั้ง office_only · ช่างกด arrive = office_required (ข้อความไม่มีตัวเลข) · ออฟฟิศกรอกได้ (ไม่มีเพดานให้เทียบ) · residual_g ว่าง · ไม่เกิดส่วนจากฝั่งช่าง',
    (r6 ->> 'ok') = 'true' and dd4 is not null and (select weight_gap_g is null from analytics.job_discrepancy where id = dd4)
    and coalesce((pg_temp.arr_act(pg_temp.w_res(th4, sC4)) ->> 'office_only') = 'true', false)
    and (r ->> 'code') = 'office_required' and pg_temp.nodigit(r) and (r2 ->> 'ok') = 'true'
    and exists (select 1 from analytics.job_event where job_id = j4 and event_type = 'discrepancy_arrive' and payload ? 'residual_g' and (payload -> 'residual_g') = 'null'::jsonb)
    and pg_temp.nlots(j4) = 1);
  -- D9d ตัวนับ 3 ครั้งนับต่อขั้น (ไม่ใช่ต่อแถวส่วนต่าง): ชั่งไม่ตรง 2 ครั้ง → arrive บางส่วนที่ถูกต้อง (สร้างแถวส่วนต่างใหม่) → ไม่ตรงอีก 1 ครั้ง = ครั้งที่ 3 ของขั้น = office_required · แล้วชั่งถูกก็ล็อก
  m4 := pg_temp.mkdisc(p_shop, p_tpl, 10, 8, 6, null, 'gold', 10.0, 8.0);
  j4 := (m4 ->> 'job')::uuid; th4 := m4 ->> 'tokh'; sC4 := m4 ->> 'sc'; dd4 := (m4 ->> 'disc')::uuid;
  r := pg_temp.wa(th4, sC4, dd4, 1, 2.06, 2);
  r2 := pg_temp.wa(th4, sC4, dd4, 1, 5.0, 2);
  r3 := pg_temp.wa(th4, sC4, dd4, 1, 1.0, 2);
  rem := (r3 ->> 'discrepancy_id')::uuid;
  r4 := pg_temp.wa(th4, sC4, rem, 1, 5.0, 1);
  r5 := pg_temp.wa(th4, sC4, rem, 1, 1.0, 1);
  v_log := v_log || pg_temp.chk('D9d', 'ตัวนับต่อขั้น: ไม่ตรง 2 ครั้ง (arrive_heavy) → arrive บางส่วนที่ถูก 1.0 = ok (แถวส่วนต่างใหม่) → ไม่ตรงอีกครั้งบนแถวใหม่ = office_required (ครั้งที่ 3 ของขั้น) → ชั่งถูก 1.0 ก็ล็อก (office_required) · ไม่เกินส่วนที่ 1',
    (r ->> 'code') = 'arrive_heavy' and (r2 ->> 'code') = 'arrive_heavy' and (r3 ->> 'ok') = 'true' and rem is not null and rem <> dd4
    and (r4 ->> 'code') = 'office_required' and (r5 ->> 'code') = 'office_required' and pg_temp.nlots(j4) = 1);

  -- ===== D10 (security M2): เพดานสำรอง (ไม่มี gap บนแถว แต่ทั้งสองขั้นมีน้ำหนัก) หักน้ำหนักที่ arrive ไปแล้วของคู่ขั้น =====
  m4 := pg_temp.mkdisc(p_shop, p_tpl, 10, 8, 6, null, 'gold', 10.0, 8.0);
  j4 := (m4 ->> 'job')::uuid; th4 := m4 ->> 'tokh'; sC4 := m4 ->> 'sc'; dd4 := (m4 ->> 'disc')::uuid;
  r := pg_temp.wa(th4, sC4, dd4, 1, 1.0, 2);
  rem := (r ->> 'discrepancy_id')::uuid;
  execute 'alter table analytics.job_discrepancy disable trigger trg_job_discrepancy_guard';
  update analytics.job_discrepancy set weight_gap_g = null, weight_sent_g = null, qty_sent = null where id = rem;
  execute 'alter table analytics.job_discrepancy enable trigger trg_job_discrepancy_guard';
  r2 := pg_temp.wa(th4, sC4, rem, 1, 1.06, 1);
  r3 := pg_temp.wa(th4, sC4, rem, 1, 1.05, 1);
  v_log := v_log || pg_temp.chk('D10', 'เพดานสำรอง (แถวไม่มี gap · ส่งออก 10 − รับเข้า 8 = ขาด 2.0 หักที่ arrive แล้ว 1.0 = เหลือ 1.0): 1.06 = arrive_heavy · 1.05 = ok (ถ้าไม่หักที่ arrive ไปแล้ว เพดาน 2.05 จะปล่อย 1.06 ผ่าน)',
    (r ->> 'ok') = 'true' and (r2 ->> 'code') = 'arrive_heavy' and (r3 ->> 'ok') = 'true' and pg_temp.nlots(j4) = 2);
  return v_log;
end;
$s$;

-- ============================================================================
-- Section E — ตรวจจับข้อมูลเพี้ยน (drift): จงใจเลี่ยง guard แก้ตรง → v_job_tree_drift ต้องเห็น · job_tree_assert ถอยทั้งก้อน · คืนค่าแล้วสะอาด
-- ============================================================================
create function pg_temp.se(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  m jsonb; j uuid; th text; sC text; dd uuid; r jsonb; l1 uuid; arr uuid; rem uuid; ls uuid;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  m := pg_temp.mkdisc(p_shop, p_tpl, 50, 47);
  j := (m ->> 'job')::uuid; th := m ->> 'tokh'; sC := m ->> 'sc'; dd := (m ->> 'disc')::uuid;
  r := pg_temp.wa(th, sC, dd, 2, null, 3);
  l1 := pg_temp.lot(r); arr := (r ->> 'arrived_id')::uuid; rem := (r ->> 'discrepancy_id')::uuid; ls := pg_temp.sid(l1, 7);
  v_log := v_log || pg_temp.chk('E0', 'baseline: arrive 2 จาก 3 → drift ว่าง · sum_check จริง · job_tree_assert ผ่าน (ไม่ raise) · live 49 + ... รวม = 50',
    pg_temp.dcount(j) = 0 and pg_temp.sumok(j) and pg_temp.x(format('select analytics.job_tree_assert(%L)', j)) = 'OK' and pg_temp.summ(j, 'qty_live_total') = '49');

  -- E1 จำนวนของส่วนใหม่ไม่ตรงกับ arrived (2 → 1)
  execute 'alter table analytics.job disable trigger trg_job_guard';
  update analytics.job set qty_planned = 1, qty_order = 1 where id = l1;
  execute 'alter table analytics.job enable trigger trg_job_guard';
  v_log := v_log || pg_temp.chk('E1', 'แก้จำนวนส่วนใหม่ตรง (2→1 เลี่ยง guard) → drift มี arrive_link + tree_sum · job_tree_assert ถอยทั้งก้อน (tree_sum_mismatch)',
    exists (select 1 from analytics.v_job_tree_drift where root_job_id = j and check_code = 'arrive_link')
    and exists (select 1 from analytics.v_job_tree_drift where root_job_id = j and check_code = 'tree_sum')
    and pg_temp.q(format('select analytics.job_tree_assert(%L)', j)) ->> '_hint' = 'tree_sum_mismatch');
  execute 'alter table analytics.job disable trigger trg_job_guard';
  update analytics.job set qty_planned = 2, qty_order = 2 where id = l1;
  execute 'alter table analytics.job enable trigger trg_job_guard';

  -- E2 ตัดสายผูก (arrive_discrepancy_id → null)
  execute 'alter table analytics.job_stage disable trigger trg_job_stage_guard';
  update analytics.job_stage set arrive_discrepancy_id = null where id = ls;
  execute 'alter table analytics.job_stage enable trigger trg_job_stage_guard';
  v_log := v_log || pg_temp.chk('E2', 'ตัดสายผูกของส่วนใหม่ตรง (arrive_discrepancy_id → null) → drift มี lot_split_stage (ส่วนไม่มีขั้นแยก/รับขาด) + arrive_link (Σ ส่วนใหม่ ≠ arrived)',
    exists (select 1 from analytics.v_job_tree_drift where root_job_id = j and check_code = 'lot_split_stage')
    and exists (select 1 from analytics.v_job_tree_drift where root_job_id = j and check_code = 'arrive_link'));
  execute 'alter table analytics.job_stage disable trigger trg_job_stage_guard';
  update analytics.job_stage set arrive_discrepancy_id = arr where id = ls;
  execute 'alter table analytics.job_stage enable trigger trg_job_stage_guard';

  -- E3 จำนวนของแถว arrived ถูกแก้ตรง (2 → 3)
  execute 'alter table analytics.job_discrepancy disable trigger trg_job_discrepancy_guard';
  update analytics.job_discrepancy set qty = 3 where id = arr;
  execute 'alter table analytics.job_discrepancy enable trigger trg_job_discrepancy_guard';
  v_log := v_log || pg_temp.chk('E3', 'แก้จำนวนแถว arrived ตรง (2→3) → drift มี arrive_link · tree_sum',
    exists (select 1 from analytics.v_job_tree_drift where root_job_id = j and check_code = 'arrive_link')
    and exists (select 1 from analytics.v_job_tree_drift where root_job_id = j and check_code = 'tree_sum'));
  execute 'alter table analytics.job_discrepancy disable trigger trg_job_discrepancy_guard';
  update analytics.job_discrepancy set qty = 2 where id = arr;
  execute 'alter table analytics.job_discrepancy enable trigger trg_job_discrepancy_guard';

  -- E4 ส่วนใหม่ถูกยกเลิกแบบคืนชิ้นตรง (status cancelled · cancel_scrap_qty null) ทั้งที่คืนไม่ได้
  execute 'alter table analytics.job disable trigger trg_job_guard';
  update analytics.job set status = 'cancelled', cancelled_at = now(), cancel_reason = 'verify' where id = l1;
  execute 'alter table analytics.job enable trigger trg_job_guard';
  v_log := v_log || pg_temp.chk('E4', 'ยกเลิกส่วนจาก arrive แบบคืนชิ้นตรง (ไม่มีขั้นแม่รับคืน) → drift มี arrive_link (ชิ้นหายจากต้นไม้) · tree_sum',
    exists (select 1 from analytics.v_job_tree_drift where root_job_id = j and check_code = 'arrive_link')
    and exists (select 1 from analytics.v_job_tree_drift where root_job_id = j and check_code = 'tree_sum'));
  execute 'alter table analytics.job disable trigger trg_job_guard';
  update analytics.job set status = 'in_progress', cancelled_at = null, cancel_reason = null where id = l1;
  execute 'alter table analytics.job enable trigger trg_job_guard';
  v_log := v_log || pg_temp.chk('E5', 'คืนค่าทุกอย่างแล้ว: drift ว่าง · sum_check จริง · job_tree_assert ผ่าน · ใบ/ขั้น/แถวส่วนต่างกลับเท่าเดิม',
    pg_temp.dcount(j) = 0 and pg_temp.sumok(j) and pg_temp.x(format('select analytics.job_tree_assert(%L)', j)) = 'OK'
    and pg_temp.jv(l1, 'qty_planned') = '2' and pg_temp.jv(l1, 'status') = 'in_progress' and pg_temp.sv(l1, 7, 'arrive_discrepancy_id') = arr::text
    and (select qty = 2 from analytics.job_discrepancy where id = arr) and pg_temp.drows(j) = 'open:3,void:3,resolved/arrived:2,open:1');
  return v_log;
end;
$s$;

-- ============================================================================
-- Section F — สิทธิ์/โครงสร้าง: service_role เท่านั้น · anon/authenticated ปิด (4 ชื่อ) · ไม่มี overload · search_path ล็อก · constraint/index ครบ
-- ============================================================================
create function pg_temp.sf(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  c_off constant text := 'analytics.job_discrepancy_arrive(uuid, uuid, integer, numeric, date, uuid, uuid, integer)';
  c_wrk constant text := 'analytics.job_worker_discrepancy_arrive(text, text, uuid, integer, numeric, integer, text, text)';
  c_core constant text := 'analytics.job_discrepancy_arrive_core(uuid, integer, numeric, date, uuid, integer, uuid, text, uuid, text, boolean)';
  v_names constant text[] := array['job_arrived_qty', 'job_discrepancy_arrive_core', 'job_discrepancy_arrive', 'job_worker_discrepancy_arrive', 'job_identity_gap', 'job_done', 'job_stage_guard', 'job_discrepancy_guard', 'job_worker_resolve'];
  v_sql text; v_bad text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_log := v_log || pg_temp.chk('F1', 'RPC ใหม่: service_role execute ได้ (ออฟฟิศ + ช่าง + job_arrived_qty) · core ภายในไม่มีใครเรียกได้ (service_role/authenticated/anon ปิด) · guard ไม่มีใครเรียกได้',
    has_function_privilege('service_role', c_off, 'execute') and has_function_privilege('service_role', c_wrk, 'execute')
    and has_function_privilege('service_role', 'analytics.job_arrived_qty(uuid)', 'execute')
    and not has_function_privilege('service_role', c_core, 'execute') and not has_function_privilege('authenticated', c_core, 'execute') and not has_function_privilege('anon', c_core, 'execute')
    and not has_function_privilege('service_role', 'analytics.job_discrepancy_guard()', 'execute') and not has_function_privilege('authenticated', 'analytics.job_discrepancy_guard()', 'execute')
    and not has_function_privilege('service_role', 'analytics.job_stage_guard()', 'execute'));
  select string_agg(p.oid::regprocedure::text || ' → ' || coalesce(g.rolname, 'PUBLIC'), ', ') into v_bad
    from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    left join pg_roles g on g.oid = a.grantee
   where p.pronamespace = 'analytics'::regnamespace and p.proname = any (v_names) and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or g.rolname in ('anon', 'authenticated'));
  v_log := v_log || pg_temp.chk('F2', 'ทั้ง 9 ฟังก์ชันที่ 0183 แตะ: ไม่มี PUBLIC/anon/authenticated ถือ EXECUTE (ตรวจจาก ACL ตรง ไม่ใช่แค่ has_function_privilege) · ' || coalesce(v_bad, '(ไม่พบ)'), v_bad is null);
  v_log := v_log || pg_temp.chk('F3', 'authenticated / anon เรียก RPC ใหม่ผ่าน PostgREST role = permission denied (42501) ทั้งออฟฟิศและช่าง',
    pg_temp.as_role('authenticated', format('select analytics.job_discrepancy_arrive(%L, %L, 1)', p_shop, gen_random_uuid())) like 'ERR:42501:%'
    and pg_temp.as_role('anon', format('select analytics.job_discrepancy_arrive(%L, %L, 1)', p_shop, gen_random_uuid())) like 'ERR:42501:%'
    and pg_temp.as_role('authenticated', format('select analytics.job_worker_discrepancy_arrive(%L, %L, %L, 1)', 'x', 'y', gen_random_uuid())) like 'ERR:42501:%'
    and pg_temp.as_role('anon', format('select analytics.job_worker_discrepancy_arrive(%L, %L, %L, 1)', 'x', 'y', gen_random_uuid())) like 'ERR:42501:%');
  v_log := v_log || pg_temp.chk('F4', 'ไม่มี overload: แต่ละชื่อ 1 แถวใน pg_proc (9 ชื่อ) · ฟังก์ชันที่ replace มีเครื่องหมาย 0183 ใน definition ครบ',
    (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace and proname = any (v_names)) = cardinality(v_names)
    and not exists (select 1 from pg_proc where pronamespace = 'analytics'::regnamespace and proname = any (v_names) and position('0183' in pg_get_functiondef(oid)) = 0
                    and proname <> 'job_arrived_qty'));
  v_log := v_log || pg_temp.chk('F5', 'search_path ล็อกทุกตัว (proconfig) · RPC ออฟฟิศ/ช่าง/job_done/job_worker_resolve = security definer · core = invoker (เรียกผ่าน RPC เท่านั้น)',
    not exists (select 1 from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = any (v_names) and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'))
    and (select bool_and(prosecdef) from pg_proc where pronamespace = 'analytics'::regnamespace and proname in ('job_discrepancy_arrive', 'job_worker_discrepancy_arrive', 'job_done', 'job_worker_resolve'))
    and not (select prosecdef from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'job_discrepancy_arrive_core'));
  v_log := v_log || pg_temp.chk('F6', 'โครงสร้าง: job_done_ck เป็น <= qty_planned ไม่เรียกฟังก์ชัน (M1) · jd_kind_ck มี arrived · job_event_event_type_ck มี discrepancy_arrive + photo_* (ไม่หลุดของ 0182) · uq_job_stage_arrive · js_arrive_fk · js_arrive_split_ck · trigger ส่วนต่างเปิด 2 ตัว',
    exists (select 1 from pg_constraint where conrelid = 'analytics.job'::regclass and conname = 'job_done_ck' and pg_get_constraintdef(oid) like '%<= qty_planned%' and pg_get_constraintdef(oid) not like '%job_arrived_qty%')
    and exists (select 1 from pg_constraint where conrelid = 'analytics.job_discrepancy'::regclass and conname = 'jd_kind_ck' and pg_get_constraintdef(oid) like '%arrived%')
    and exists (select 1 from pg_constraint where conrelid = 'analytics.job_event'::regclass and conname = 'job_event_event_type_ck' and pg_get_constraintdef(oid) like '%discrepancy_arrive%'
                and pg_get_constraintdef(oid) like '%photo_add%' and pg_get_constraintdef(oid) like '%photo_reorder%' and pg_get_constraintdef(oid) like '%split_cancel%')
    and exists (select 1 from pg_indexes where schemaname = 'analytics' and indexname = 'uq_job_stage_arrive')
    and exists (select 1 from pg_constraint where conrelid = 'analytics.job_stage'::regclass and conname = 'js_arrive_fk')
    and exists (select 1 from pg_constraint where conrelid = 'analytics.job_stage'::regclass and conname = 'js_arrive_split_ck')
    and (select count(*) from pg_trigger t where t.tgrelid = 'analytics.job_discrepancy'::regclass and not t.tgisinternal and t.tgenabled in ('O', 'A')) = 2);
  v_log := v_log || pg_temp.chk('F7', 'ตาราง/view: anon + authenticated ไม่มีสิทธิ์ใดๆ บน job_discrepancy / v_job_tree / v_job_tree_drift / v_job_tree_summary (ไม่เปิดช่องใหม่)',
    not exists (select 1 from unnest(array['analytics.job_discrepancy', 'analytics.v_job_tree', 'analytics.v_job_tree_drift', 'analytics.v_job_tree_summary']) t
                 cross join unnest(array['anon', 'authenticated']) r
                 cross join unnest(array['select', 'insert', 'update', 'delete']) pv
                where has_table_privilege(r, t, pv)));
  v_log := v_log || pg_temp.chk('F8', 'flag app.job_arrive ไม่ค้างเปิดในการเชื่อมต่อนี้ · event ใหม่ไม่มีใน payload คีย์ต้นทุน/ราคา/ลูกค้า (ตรวจชุดที่เกิดจาก fixture ล่าสุด)',
    coalesce(nullif(current_setting('app.job_arrive', true), ''), 'off') = 'off'
    and not exists (select 1 from analytics.job_event e where e.event_type = 'discrepancy_arrive' and exists (select 1 from unnest(pg_temp.keys_of(e.payload)) k where k ~* '(cost|price|thb|margin|customer|quote_no|baht|amount|token|hash)')));
  return v_log;
end;
$s$;

-- ============================================================================
-- ตัวรันหลัก: section ทั้งหมด → state ไม่ขยับ → mutant → คืนของเดิม → section ซ้ำ → state ไม่ขยับ
-- ============================================================================
create function pg_temp.sec_of(p_label text) returns text language sql as $c$
  select case
    when p_label ~ '^A' then 'sa'
    when p_label ~ '^B' then 'sb'
    when p_label ~ '^C' then 'sc'
    when p_label ~ '^D' then 'sd'
    when p_label ~ '^E' then 'se'
    when p_label ~ '^F' then 'sf'
    else 'sa' end $c$;
-- แต่ละ section ล้มด้วย exception ไม่ทำให้ทั้งชุดตาย · ทุก section ถอยกลับ (raise) — ข้อมูลทดสอบไม่ค้างถาวร
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
  select pg_temp.run_sec('sa', p_shop, p_tpl) || pg_temp.run_sec('sb', p_shop, p_tpl) || pg_temp.run_sec('sc', p_shop, p_tpl)
      || pg_temp.run_sec('sd', p_shop, p_tpl) || pg_temp.run_sec('se', p_shop, p_tpl) || pg_temp.run_sec('sf', p_shop, p_tpl)
$c$;

do $v183$
declare
  v_shop uuid; v_tpl uuid;
  v_log text := ''; v_s text; v_fail int; v_snap0 text; v_d0 text;
  v_m record; v_killed int := 0; v_total int; v_survived text := ''; v_cnt int; v_id text; v_hit int; v_ok_cnt int; v_k int;
  c_core constant text := 'analytics.job_discrepancy_arrive_core(uuid, integer, numeric, date, uuid, integer, uuid, text, uuid, text, boolean)';
  c_wrk constant text := 'analytics.job_worker_discrepancy_arrive(text, text, uuid, integer, numeric, integer, text, text)';
  v_mutants jsonb := jsonb_build_array(
    jsonb_build_object('id', 'MU-1', 'what', 'core: ถอดเพดานจำนวน (arrive เกินส่วนต่างที่ค้าง)', 'fn', 'job_discrepancy_arrive_core', 'from', 'p_qty > v_d.qty then', 'to', 'p_qty > v_d.qty + 100000 then', 'expect', jsonb_build_array('B1')),
    jsonb_build_object('id', 'MU-2', 'what', 'core: arrive 0 ชิ้นผ่าน (ถอดขอบล่าง)', 'fn', 'job_discrepancy_arrive_core', 'from', 'or p_qty < 1 or', 'to', 'or p_qty < 0 or', 'expect', jsonb_build_array('B1')),
    jsonb_build_object('id', 'MU-3', 'what', 'core: ช่างที่ไม่ใช่ผู้รับกดได้ (ถอดด่านผู้รับ)', 'fn', 'job_discrepancy_arrive_core', 'from', 'if p_enforce_receiver and v_ts', 'to', 'if false and v_ts', 'expect', jsonb_build_array('B2')),
    jsonb_build_object('id', 'MU-4', 'what', 'core: ถอด CAS expected_open (กดซ้ำด้วยหน้าจอเก่า)', 'fn', 'job_discrepancy_arrive_core', 'from', 'if p_expected_open is not null and p_expected_open <> v_d.qty then', 'to', 'if false then', 'expect', jsonb_build_array('B5')),
    jsonb_build_object('id', 'MU-5', 'what', 'core: ส่วนต่างที่ชี้แจงแล้ว (resolved) ยัง arrive ได้', 'fn', 'job_discrepancy_arrive_core', 'from', 'v_d.status <> ''open'' or exists', 'to', 'exists', 'expect', jsonb_build_array('B4a', 'C1b', 'C1c')),
    jsonb_build_object('id', 'MU-6', 'what', 'core: แถวที่ถูก void แล้วยัง arrive ได้ (กดซ้ำ/2 มือถือ)', 'fn', 'job_discrepancy_arrive_core', 'from', 'or exists (select 1 from analytics.job_discrepancy v where v.void_of_id = v_d.id) then', 'to', 'then', 'expect', jsonb_build_array('B4b', 'C1d')),
    jsonb_build_object('id', 'MU-7', 'what', 'core: ใบ done/cancelled ยัง arrive ได้', 'fn', 'job_discrepancy_arrive_core', 'from', 'if v_root.status in (''done'', ''cancelled'') or v_src.status in (''done'', ''cancelled'') then', 'to', 'if false then', 'expect', jsonb_build_array('B9a')),
    jsonb_build_object('id', 'MU-8', 'what', 'core: ใบถูกพักยัง arrive ได้', 'fn', 'job_discrepancy_arrive_core', 'from', 'if v_root.status = ''on_hold'' or v_src.status = ''on_hold'' then', 'to', 'if false then', 'expect', jsonb_build_array('B9b')),
    jsonb_build_object('id', 'MU-9', 'what', 'core: ขั้นผู้รับถูกย้อนเป็นยังไม่รับแล้วยัง arrive ได้', 'fn', 'job_discrepancy_arrive_core', 'from', 'if v_fs.status <> ''sent'' or v_ts.status not in (''received'', ''sent'') then', 'to', 'if false then', 'expect', jsonb_build_array('B10')),
    jsonb_build_object('id', 'MU-10', 'what', 'core: ทองที่ขั้นชั่งไม่ถือเป็นต้องชั่ง', 'fn', 'job_discrepancy_arrive_core', 'from', 'v_gold_w := v_root.metal = ''gold'' and v_ts.weigh_required;', 'to', 'v_gold_w := false;', 'expect', jsonb_build_array('D1', 'D3a')),
    jsonb_build_object('id', 'MU-11', 'what', 'core: ทองไม่ชั่งก็ arrive ได้ (ถอด arrive_weight_required)', 'fn', 'job_discrepancy_arrive_core', 'from', 'if p_weight is null then', 'to', 'if false then', 'expect', jsonb_build_array('D1')),
    jsonb_build_object('id', 'MU-12', 'what', 'core: ถอดเพดานน้ำหนัก (หนักเกินส่วนที่ขาดผ่าน)', 'fn', 'job_discrepancy_arrive_core', 'from', 'p_weight > v_missing + 0.05', 'to', 'p_weight > v_missing + 1000', 'expect', jsonb_build_array('D2a', 'D3b')),
    jsonb_build_object('id', 'MU-13', 'what', 'core: เพดานน้ำหนักหลวม (+0.5 g แทน +0.05 g)', 'fn', 'job_discrepancy_arrive_core', 'from', 'p_weight > v_missing + 0.05', 'to', 'p_weight > v_missing + 0.5', 'expect', jsonb_build_array('D3b', 'D2a')),
    jsonb_build_object('id', 'MU-14', 'what', 'core: เงิน/ขั้นไม่ชั่งส่งน้ำหนักมาแล้วผ่าน (ถอด weight_unexpected)', 'fn', 'job_discrepancy_arrive_core', 'from', 'elsif p_weight is not null then', 'to', 'elsif false then', 'expect', jsonb_build_array('B6', 'D7')),
    jsonb_build_object('id', 'MU-15', 'what', 'core: ถอดการล็อกครั้งที่ 3 ของช่าง (ไล่เดาน้ำหนักต่อได้)', 'fn', 'job_discrepancy_arrive_core', 'from', 'if p_channel = ''worker_qr'' and v_n_mm >= 3 then', 'to', 'if false then', 'expect', jsonb_build_array('D2a')),
    jsonb_build_object('id', 'MU-16', 'what', 'core: ล็อกหลัง 3 ครั้งไม่มีผลกับครั้งที่ 4 ที่ชั่งถูก', 'fn', 'job_discrepancy_arrive_core', 'from', 'having count(*) >= 3) then', 'to', 'having count(*) >= 3000) then', 'expect', jsonb_build_array('D2a')),
    jsonb_build_object('id', 'MU-17', 'what', 'core: ออฟฟิศกรอกวันรับเป็นอนาคตได้', 'fn', 'job_discrepancy_arrive_core', 'from', 'or v_on > v_today or', 'to', 'or false or', 'expect', jsonb_build_array('B7a')),
    jsonb_build_object('id', 'MU-18', 'what', 'core: ออฟฟิศย้อนวันรับเกิน 14 วันได้', 'fn', 'job_discrepancy_arrive_core', 'from', 'or v_on < v_today - 14 or', 'to', 'or false or', 'expect', jsonb_build_array('B7a')),
    jsonb_build_object('id', 'MU-19', 'what', 'core: วันรับก่อนวันที่ขั้นต้นทางส่งได้', 'fn', 'job_discrepancy_arrive_core', 'from', 'or v_on < v_fs.sent_on then', 'to', 'then', 'expect', jsonb_build_array('B7b')),
    jsonb_build_object('id', 'MU-20', 'what', 'core: ผู้ถือที่ออฟฟิศเลือกไม่ถูกใช้ (ใช้ผู้รับเดิมเสมอ)', 'fn', 'job_discrepancy_arrive_core', 'from', 'coalesce(p_holder_worker, case when p_channel = ''worker_qr''', 'to', 'coalesce(null::uuid, case when p_channel = ''worker_qr''', 'expect', jsonb_build_array('A7a', 'D2b')),
    jsonb_build_object('id', 'MU-21', 'what', 'core: เลือกช่างที่ปิดใช้งานเป็นผู้ถือได้', 'fn', 'job_discrepancy_arrive_core', 'from', 'and w.is_active;', 'to', ';', 'expect', jsonb_build_array('B8')),
    jsonb_build_object('id', 'MU-22', 'what', 'core: arrive บางส่วนไม่สร้างแถว open ที่เหลือ (ชิ้นหายจากบัญชี)', 'fn', 'job_discrepancy_arrive_core', 'from', 'if v_rem_qty > 0 then', 'to', 'if false then', 'expect', jsonb_build_array('A2b', 'A3', 'A2e')),
    jsonb_build_object('id', 'MU-23', 'what', 'core: gap ที่เหลือไม่หักน้ำหนักที่มาถึง', 'fn', 'job_discrepancy_arrive_core', 'from', 'then v_d.weight_gap_g + v_w_eff end;', 'to', 'then v_d.weight_gap_g end;', 'expect', jsonb_build_array('D3a', 'D3b')),
    jsonb_build_object('id', 'MU-24', 'what', 'H1: ช่างปิดทั้งก้อนเบากว่าส่วนที่ขาดเกิน 0.05 ผ่าน (ธงทองหายถูกลบเงียบ)', 'fn', 'job_discrepancy_arrive_core', 'from', '(p_channel = ''worker_qr'' and p_qty = v_d.qty and p_weight < v_missing - 0.05)', 'to', 'false', 'expect', jsonb_build_array('D9a', 'D9a2')),
    jsonb_build_object('id', 'MU-25', 'what', 'H1: ออฟฟิศก็ถูกด่านเบาเกินด้วย (ควรผ่านได้ + บันทึก residual)', 'fn', 'job_discrepancy_arrive_core', 'from', '(p_channel = ''worker_qr'' and p_qty = v_d.qty and p_weight < v_missing - 0.05)', 'to', '(p_qty = v_d.qty and p_weight < v_missing - 0.05)', 'expect', jsonb_build_array('D9b')),
    jsonb_build_object('id', 'MU-26', 'what', 'H1: ไม่มีน้ำหนักอ้างอิง ช่างผ่านได้ (ชั่งอะไรก็ได้)', 'fn', 'job_discrepancy_arrive_core', 'from', 'if v_missing is null and p_channel = ''worker_qr'' then', 'to', 'if false then', 'expect', jsonb_build_array('D9c')),
    jsonb_build_object('id', 'MU-27', 'what', 'H1: ไม่บันทึก residual_g ของออฟฟิศ', 'fn', 'job_discrepancy_arrive_core', 'from', '''residual_g'', case when v_gold_w and v_missing is not null then round(v_missing - p_weight, 3) end', 'to', '''residual_g'', null', 'expect', jsonb_build_array('D9b')),
    jsonb_build_object('id', 'MU-28', 'what', 'H1: ตัวนับ 3 ครั้งนับตามแถวส่วนต่าง (arrive บางส่วนรีเซ็ตตัวนับ — ไล่เดาต่อได้)', 'fn', 'job_discrepancy_arrive_core', 'from', 'e.job_stage_id = v_ts.id', 'to', 'e.payload ->> ''discrepancy_id'' = v_d.id::text', 'expect', jsonb_build_array('D9d')),
    jsonb_build_object('id', 'MU-29', 'what', 'H1: แถว arrived ไม่เก็บน้ำหนัก (ธง excess ของใบถูกลบด้วยการกด arrive)', 'fn', 'job_discrepancy_arrive_core', 'from', 'p_actor_worker, p_actor, v_arr_gap, case when v_arr_gap is not null then v_d.weight_sent_g end, case when v_arr_gap is not null then v_d.qty_sent end)', 'to', 'p_actor_worker, p_actor, null, null, null)', 'expect', jsonb_build_array('D3a', 'D9b')),
    jsonb_build_object('id', 'MU-30', 'what', 'M2: เพดานสำรองไม่หักน้ำหนักที่ arrive ไปแล้ว', 'fn', 'job_discrepancy_arrive_core', 'from', '(v_fs.weight_out_g - v_ts.weight_in_g) - v_found end;', 'to', '(v_fs.weight_out_g - v_ts.weight_in_g) end;', 'expect', jsonb_build_array('D10')),
    jsonb_build_object('id', 'MU-31', 'what', 'H1: resolve ไม่ตั้ง office_only เมื่อไม่มีน้ำหนักอ้างอิง', 'fn', 'job_worker_resolve', 'from', '(p.metal = ''gold'' and ts.weigh_required and dd.weight_gap_g is null and not (fs3.weight_out_g is not null and ts.weight_in_g is not null)) as ref_missing', 'to', 'false as ref_missing', 'expect', jsonb_build_array('D9c')),
    jsonb_build_object('id', 'MU-32', 'what', 'core: ส่วนใหม่ไม่เก็บน้ำหนักรับเข้า', 'fn', 'job_discrepancy_arrive_core', 'from', 'weight_in_g = case when v_gold_w then p_weight end', 'to', 'weight_in_g = null', 'expect', jsonb_build_array('D3a', 'D2b')),
    jsonb_build_object('id', 'MU-33', 'what', 'core: ขั้นที่รับขาดของส่วนใหม่ถูกข้ามด้วย (รับขาดไม่ได้ received)', 'fn', 'job_discrepancy_arrive_core', 'from', 'if r.seq < v_ts.seq then', 'to', 'if r.seq <= v_ts.seq then', 'expect', jsonb_build_array('A2c')),
    jsonb_build_object('id', 'MU-34', 'what', 'core: ส่วนใหม่ไม่ผูกส่วนต่าง (arrive_discrepancy_id ว่าง)', 'fn', 'job_discrepancy_arrive_core', 'from', 'case when r.id = v_ts.id then v_arr end', 'to', 'case when r.id = v_ts.id then null end', 'expect', jsonb_build_array('A2c')),
    jsonb_build_object('id', 'MU-35', 'what', 'core: จำนวนที่วางแผนของส่วนใหม่เกิน arrive 1 ชิ้น', 'fn', 'job_discrepancy_arrive_core', 'from', 'v_root.metal, p_qty, p_qty, v_weigh,', 'to', 'v_root.metal, p_qty + 1, p_qty, v_weigh,', 'expect', jsonb_build_array('A2c', 'A2e')),
    jsonb_build_object('id', 'MU-36', 'what', 'core: ไม่บันทึก event discrepancy_arrive (ใช้ note)', 'fn', 'job_discrepancy_arrive_core', 'from', '''discrepancy_arrive'', v_on', 'to', '''note'', v_on', 'expect', jsonb_build_array('A2d')),
    jsonb_build_object('id', 'MU-37', 'what', 'worker RPC: ช่างชี้ส่วนต่างของใบอื่นได้ (ถอดตรวจใบแม่ของ token)', 'fn', 'job_worker_discrepancy_arrive', 'from', 'or not exists (select 1 from analytics.job_discrepancy d where d.id = p_discrepancy_id and d.root_job_id = v_root) then', 'to', 'then', 'expect', jsonb_build_array('B3a')),
    jsonb_build_object('id', 'MU-38', 'what', 'office RPC: ส่วนต่างของร้านอื่นผ่าน (ถอดตรวจ shop)', 'fn', 'job_discrepancy_arrive', 'from', 'where id = p_discrepancy_id and shop_id = p_shop_id;', 'to', 'where id = p_discrepancy_id;', 'expect', jsonb_build_array('B3b')),
    jsonb_build_object('id', 'MU-39', 'what', 'job_done: ปิดใบที่มี arrived ไม่นับ arrived (ดี+เสีย ≠ เริ่มผลิต)', 'fn', 'job_done', 'from', 'p_qty_good + p_qty_scrap + v_job.qty_split_out + analytics.job_arrived_qty(p_job_id) <> v_job.qty_planned', 'to', 'p_qty_good + p_qty_scrap + v_job.qty_split_out <> v_job.qty_planned', 'expect', jsonb_build_array('A5a')),
    jsonb_build_object('id', 'MU-40', 'what', 'job_identity_gap: ใบ done ไม่นับ arrived (drift ค้างหลังปิด)', 'fn', 'job_identity_gap', 'from', 'j.qty_split_out + analytics.job_arrived_qty(j.id))', 'to', 'j.qty_split_out)', 'expect', jsonb_build_array('A5b')),
    jsonb_build_object('id', 'MU-41', 'what', 'resolve: ทุกช่างเห็น action arrive (ถอดผู้รับ/สถานะ)', 'fn', 'job_worker_resolve', 'from', 'and ts.worker_id = v_worker and ts.status in (''received'', ''sent'')', 'to', 'and true', 'expect', jsonb_build_array('A1')),
    jsonb_build_object('id', 'MU-42', 'what', 'resolve: action arrive ไม่บอกว่าต้องชั่ง (ทอง)', 'fn', 'job_worker_resolve', 'from', '(p.metal = ''gold'' and ts.weigh_required) as w_req', 'to', 'false as w_req', 'expect', jsonb_build_array('D5', 'D0')),
    jsonb_build_object('id', 'MU-43', 'what', 'core: flag app.job_arrive ไม่ล้างหลังใช้ (เปิดค้างทั้งทรานแซกชัน)', 'fn', 'job_discrepancy_arrive_core', 'from', 'perform set_config(''app.job_arrive'', ''off'', true);', 'to', '', 'expect', jsonb_build_array('C4c', 'C4d')),
    jsonb_build_object('id', 'MU-44', 'what', 'guard: เขียนแถว open ตอนขั้นผู้รับ received ได้โดยไม่ผ่านเส้น arrive', 'fn', 'job_discrepancy_guard', 'from', '(v_arr and v_t.status in (''received'', ''sent''))', 'to', '(v_t.status in (''received'', ''sent''))', 'expect', jsonb_build_array('C4d')),
    jsonb_build_object('id', 'MU-45', 'what', 'guard: UPDATE แถว open → arrived ตรงได้', 'fn', 'job_discrepancy_guard', 'from', 'if new.resolved_kind = ''arrived'' then', 'to', 'if false then', 'expect', jsonb_build_array('C4a')),
    jsonb_build_object('id', 'MU-46', 'what', 'guard: void แถว arrived ได้', 'fn', 'job_discrepancy_guard', 'from', 'if v_o.resolved_kind = ''arrived'' then', 'to', 'if false then', 'expect', jsonb_build_array('C4b')),
    jsonb_build_object('id', 'MU-47', 'what', 'guard: INSERT แถว arrived ตรงได้โดยไม่ผ่านเส้น arrive', 'fn', 'job_discrepancy_guard', 'from', 'elsif new.status = ''resolved'' and v_arr and new.resolved_kind = ''arrived'' then', 'to', 'elsif new.status = ''resolved'' and new.resolved_kind = ''arrived'' then', 'expect', jsonb_build_array('C4c')),
    jsonb_build_object('id', 'MU-48', 'what', 'stage guard: UPDATE arrive_discrepancy_id ของขั้นได้', 'fn', 'job_stage_guard', 'from', 'or new.arrive_discrepancy_id is distinct from old.arrive_discrepancy_id then', 'to', 'then', 'expect', jsonb_build_array('C4g')),
    jsonb_build_object('id', 'MU-49', 'what', 'stage guard: ย้อนขั้นรับขาดของส่วนจาก arrive ได้', 'fn', 'job_stage_guard', 'from', 'old.split_from_stage_id is not null or old.arrive_discrepancy_id is not null', 'to', 'old.split_from_stage_id is not null', 'expect', jsonb_build_array('C4f')),
    jsonb_build_object('id', 'MU-50', 'what', 'stage guard: ส่วนจาก arrive ที่ขั้นแพ็กข้าม QC ไม่ได้', 'fn', 'job_stage_guard', 'from', 'x.seq > new.seq and (x.split_from_stage_id is not null or x.arrive_discrepancy_id is not null)', 'to', 'x.seq > new.seq and (x.split_from_stage_id is not null)', 'expect', jsonb_build_array('A6')),
    jsonb_build_object('id', 'MU-51', 'what', 'lot_cancel_core: event ฝั่งแม่ของส่วนจาก arrive ผูกใบแม่ไม่ได้ (กลับไปใช้ขั้นแยกเสมอ → ล้ม)', 'fn', 'job_lot_cancel_core', 'from', 'coalesce(v_ms.job_id, v_l.parent_job_id)', 'to', 'v_ms.job_id', 'expect', jsonb_build_array('A4b')),
    jsonb_build_object('id', 'MU-52', 'what', 'lot_cancel_core: ส่วนที่แยกตามปกติไม่เก็บ before ของขั้นแม่', 'fn', 'job_lot_cancel_core', 'from', '''before'', case when v_ms.id is not null then analytics.job_stage_state(v_ms) end,', 'to', '''before'', null,', 'expect', jsonb_build_array('C3b')),
    jsonb_build_object('id', 'MU-53', 'what', 'v_job_tree: นับ arrived ซ้ำเป็น ''ชี้แจงแล้ว'' ที่ระดับต้นไม้ (นับสองรอบ)', 'view', 'v_job_tree', 'from', '(dq.resolved_kind IS DISTINCT FROM ''arrived''::text)', 'to', 'true', 'expect', jsonb_build_array('A2e', 'A3')),
    jsonb_build_object('id', 'MU-54', 'what', 'drift tree_sum: ไม่บวก arrived (ต้นไม้ที่ถูกต้องถูกแจ้ง drift)', 'view', 'v_job_tree_drift', 'from', '(ad.resolved_kind = ''arrived''::text)', 'to', '(false)', 'expect', jsonb_build_array('A2e', 'A3')),
    jsonb_build_object('id', 'MU-55', 'what', 'drift arrive_link: ถอดการตรวจ arrived ↔ ส่วนใหม่', 'view', 'v_job_tree_drift', 'from', '(d.resolved_kind = ''arrived''::text)', 'to', '(false)', 'expect', jsonb_build_array('E1', 'E2', 'E3', 'E4')),
    jsonb_build_object('id', 'MU-56', 'what', 'drift lot_split_stage: ไม่นับขั้น arrive เป็นขั้นแยก', 'view', 'v_job_tree_drift', 'from', '((s.split_from_stage_id IS NOT NULL) OR (s.arrive_discrepancy_id IS NOT NULL))', 'to', '(s.split_from_stage_id IS NOT NULL)', 'expect', jsonb_build_array('A2e', 'E0')),
    jsonb_build_object('id', 'MU-57', 'what', 'job_done_ck: ถอดการนับ arrived (ปิดใบที่มีส่วนได้รับเพิ่มไม่ได้ — constraint ชนสมการ)', 'ddl', 'alter table analytics.job drop constraint job_done_ck; alter table analytics.job add constraint job_done_ck check (status <> ''done'' or (done_at is not null and qty_good is not null and qty_scrap is not null and (qty_good + qty_scrap + qty_split_out) = qty_planned and (metal <> ''gold'' or not weigh_required or weight_final_g is not null) and (not require_final_weight or weight_final_g is not null)))', 'expect', jsonb_build_array('A5a')),
    jsonb_build_object('id', 'MU-58', 'what', 'สิทธิ์: เปิด RPC ช่างให้ authenticated', 'ddl', 'grant execute on function analytics.job_worker_discrepancy_arrive(text, text, uuid, integer, numeric, integer, text, text) to authenticated', 'expect', jsonb_build_array('F2', 'F3')),
    jsonb_build_object('id', 'MU-59', 'what', 'สิทธิ์: เปิด RPC ออฟฟิศให้ anon', 'ddl', 'grant execute on function analytics.job_discrepancy_arrive(uuid, uuid, integer, numeric, date, uuid, uuid, integer) to anon', 'expect', jsonb_build_array('F2', 'F3')),
    jsonb_build_object('id', 'MU-60', 'what', 'สิทธิ์: เปิด core ภายในให้ service_role', 'ddl', 'grant execute on function analytics.job_discrepancy_arrive_core(uuid, integer, numeric, date, uuid, integer, uuid, text, uuid, text, boolean) to service_role', 'expect', jsonb_build_array('F1')),
    jsonb_build_object('id', 'MU-61', 'what', 'โครงสร้าง: ถอด unique ของ arrive_discrepancy_id (ส่วนใหม่ซ้ำต่อส่วนต่างเดียว)', 'ddl', 'drop index analytics.uq_job_stage_arrive', 'expect', jsonb_build_array('F6'))
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

  create temp table _v183_orig on commit drop as
    select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h
      from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.prokind = 'f';

  v_snap0 := pg_temp.snapx(); v_d0 := pg_temp.snapx_d();
  v_s := pg_temp.run_all(v_shop, v_tpl);
  v_log := v_log || v_s;
  v_log := v_log || pg_temp.chk('K0', 'หลังรัน: แถวตารางใบงาน/ช่าง/ตัวนับ/ส่วนต่าง/รูป/แบบการบันทึก + ตาราง OEM/ผลิต/สต็อก (นับ + md5) เท่าเดิมเป๊ะ — ทุก section ถอยกลับ (ตัวนับเลขใบงานไม่ขยับถาวร)' || coalesce((select ' ขยับ: ' || pg_temp.moved(v_d0) where pg_temp.moved(v_d0) <> ''), ''), pg_temp.snapx() = v_snap0);
  v_ok_cnt := (length(v_s) - length(replace(v_s, '[OK]', ''))) / 4;

  v_total := jsonb_array_length(v_mutants);
  for v_m in select value as m from jsonb_array_elements(v_mutants) loop
    v_id := v_m.m ->> 'id';
    v_s := '';
    begin
      if v_m.m ? 'ddl' then
        execute v_m.m ->> 'ddl';
      elsif v_m.m ? 'view' then
        perform pg_temp.mutate_view(v_m.m ->> 'view', v_m.m ->> 'from', v_m.m ->> 'to');
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
    for v_k in 0 .. jsonb_array_length(v_m.m -> 'expect') - 1 loop
      -- ถูกจับเมื่อเคสที่คาดไว้ล้ม — หรือ section ที่รันเคสนั้นล้มด้วย exception ทั้งก้อน (mutant ทำให้ระบบพังจนทดสอบต่อไม่ได้ = จับได้เหมือนกัน)
      if position('[FAIL] ' || (v_m.m -> 'expect' ->> v_k) || ' ' in v_s) > 0
         or position('[FAIL] ' || pg_temp.sec_of(v_m.m -> 'expect' ->> v_k) || '  section ล้ม' in v_s) > 0 then
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

  select count(*) into v_cnt from _v183_orig o where md5(pg_get_functiondef(to_regprocedure(o.sig))) = o.h;
  v_log := v_log || pg_temp.chk('MY', format('หลังรัน mutant: md5 definition ของฟังก์ชันทุกตัวในสคีมา analytics (%s ตัว) เท่าเดิมเป๊ะ · trigger ตารางใบงาน/ส่วนต่างเปิดครบ · สิทธิ์ core/RPC เท่าเดิม', (select count(*) from _v183_orig)),
    v_cnt = (select count(*) from _v183_orig)
    and not exists (select 1 from pg_trigger t where t.tgrelid in ('analytics.job'::regclass, 'analytics.job_stage'::regclass, 'analytics.job_event'::regclass, 'analytics.job_token'::regclass,
                                                                  'analytics.worker'::regclass, 'analytics.job_discrepancy'::regclass) and not t.tgisinternal and t.tgenabled not in ('O', 'A'))
    and not has_function_privilege('service_role', c_core, 'execute') and not has_function_privilege('authenticated', c_wrk, 'execute')
    and exists (select 1 from pg_indexes where schemaname = 'analytics' and indexname = 'uq_job_stage_arrive'));
  v_s := pg_temp.run_all(v_shop, v_tpl);
  v_fail := (length(v_s) - length(replace(v_s, '[FAIL]', ''))) / 6;
  v_log := v_log || pg_temp.chk('MZ', 'หลังคืนของเดิม: ชุดเทสต์หลักรันซ้ำ FAIL ' || v_fail, v_fail = 0);
  if v_fail > 0 then
    v_log := v_log || (select string_agg('    (รันซ้ำ) ' || l, E'\n') from unnest(string_to_array(v_s, E'\n')) l where l like '[FAIL]%') || E'\n';
  end if;
  v_log := v_log || pg_temp.chk('K0c', 'state ไม่ขยับหลังรัน mutant ทั้งหมด' || coalesce((select ' ขยับ: ' || pg_temp.moved(v_d0) where pg_temp.moved(v_d0) <> ''), ''), pg_temp.snapx() = v_snap0);

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_log := v_log || format(E'\n=== สรุป: [OK] ~%s (ก่อน mutant) · mutant %s จุด · [FAIL] ทั้งไฟล์ = %s %s ===\n', v_ok_cnt, v_total, v_fail, case when v_fail = 0 then '(ผ่าน)' else '(ไม่ผ่าน)' end);
  raise exception E'%', v_log;
end;
$v183$;
