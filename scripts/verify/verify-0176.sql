-- ⚠ PARTIALLY SUPERSEDED BY 0186 (20 ต.ค. 69): job_profile_default_for(ทอง) ไม่ fallback ไปแบบค่าเริ่มทั่วไปอีกแล้ว (security M1) —
--   P2d (ล้างค่าเริ่มทอง → "ทองใช้ค่าเริ่มทั่วไป") และ MU-11 คาดผลเดิม จะ FAIL ถ้ารันซ้ำหลัง 0186 · ผลใหม่ตรวจที่ verify-0186.sql กลุ่ม X (X1a-X1h)
-- scripts/verify/verify-0176.sql
-- ตรวจ supabase/migrations/0176_job_record_profile.sql (แบบการบันทึก: ชั่ง/ชิ้นเสีย/น้ำหนักเศษต่อขั้น · ค่าเริ่มทั่วไป+ทอง · require_final_weight · ใบเดิม profile_id null) หลัง apply
-- (หรือต่อท้ายไฟล์ 0176 ใน dry-run ก่อน apply) · self-rolling-back (3j-migration-traps ข้อ 11) · ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน
-- รอบแรก = ของจริง · รอบถัดไป = mutant 25 จุด (ทุกตัวต้องล้ม ไม่งั้น MX FAIL) · ปิดท้ายตรวจ state ไม่ขยับ
-- 🔴 ไม่ commit อะไร · ข้อมูลทดสอบสร้างผ่าน RPC เท่านั้น (ใบเสนอราคา = โคลนจากรายการจริงในทรานแซกชันที่ถอยกลับ) · JB-0018 + token จริง อ่านอย่างเดียว
-- ใบ "เดิมก่อน 0176" จำลองด้วยการสร้างใบผ่าน RPC แล้วปิด trg_job_guard ชั่วคราวใน subtransaction เพื่อตั้ง profile_id null + flag แบบ J1 (pg_temp.leg)
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0176.sql
-- dry-run ก่อน apply: cat supabase/migrations/0176_job_record_profile.sql scripts/verify/verify-0176.sql > <tmp>.sql แล้วรันไม่ใส่ --commit
--
-- ============ ตารางแมป "ข้อในบรีฟ / spec §6 -> เทสต์" ============
--  seed (แบบ 1 · ไม่ชั่ง · ทอง) + default กลาง/ทอง          -> A0a-A0e
--  P1 upsert ชื่อ/stages/seq ผิด                            -> P1a (ชื่อ 7 แบบ) · P1b (ซ้ำ/ไม่ส่งชื่อ) · P1c (stages ผิด 21 แบบ) · P1d · P1e (ไม่มีแถวค้าง) · ต้องไม่พัง P1f-P1h
--  P2 ปิด/ตั้ง default/ลบ/เขียนตรง                          -> P2a-P2d (RPC) · P2e (default ซ้ำ) · P2f (DELETE/TRUNCATE) · P2g (ตั้ง/ปิดตรง) · P2h (ล้าง default กลาง = ผิด · deferred) · P2i P2j (stage ตรง) · MU-14..17
--  ต้องไม่พัง: แก้/ปิด/สลับ default ไม่ขยับใบที่ใช้อยู่      -> P2k (md5 job+job_stage) · P2l (ใบใหม่ได้แบบใหม่) · สลับ A→B→A มี default 1 ตัวตลอด P2c
--  P3 สร้างใบ: ไม่มี default / แบบมั่ว-ปิด / INSERT ตรง      -> P3a P3b P3c · ต้องไม่พัง B1a-B1g (เงิน/ทอง/ทองเหลือง/ไม่ชั่ง/ไม่มี cast/ใบผลิต)
--  P4 job_profile_set หลังเริ่ม/ปิด/ร้านอื่น/แบบมั่ว           -> P4a P4b P4c P4d (L1: ย้อนขั้นจน pending แล้วเปลี่ยนแบบ) · ต้องไม่พัง B2a B2b B2c (flag กลับเท่าเดิม · event 2 แถว · ใบเดิมเปลี่ยนได้)
--  P5 UPDATE ตรง flag/profile/weigh_required × สถานะ        -> P5a (stage × 3 คอลัมน์ × sent/pending-ที่เริ่มแล้ว/received) · P5b (weigh_drift) · P5c P5d (job × คอลัมน์) · MU-2..4
--  P6 ขั้นชั่ง รับ/ส่งไม่ใส่น้ำหนัก · prev_not_sent · auto_close  -> P6a P6b P6d (ทุกโลหะ รวมทองเหลือง) · ต้องไม่พัง P6c P6e (ไม่ชั่ง ปิดอัตโนมัติได้ รวมทอง)
--  P7 ทอง + แบบชั่ง: handoff ±0.05 · N1 · ปิดงาน               -> P7a-P7c · ทอง+แบบ 1 (ไม่ชั่งบางขั้น) P7d-P7f (ไม่เทียบ handoff · gold_unguarded · ปิดไม่บังคับสุทธิ)
--  แบบ "ไม่ชั่ง" ทุกโลหะ รับ/ส่ง/ปิดได้ไม่ใส่น้ำหนัก             -> P8a P8b
--  require_final_weight (ทุกโลหะ + CHECK ตาราง)              -> P8c P7f P7g (M1 ทองที่มีขั้นชั่งต้องมีน้ำหนักสุทธิ รวมแบบ 1/ล้างค่าเริ่มทอง) · MU-8 MU-9 MU-18
--  ของเสียเป็น flag ไม่ใช่ด่าน                                 -> P8d
--  golden ใบเดิม vs legacy (def 0175 ของ job_core_receive)    -> G1 (เงิน auto-close) · G2 (เงิน 5 ก้าว weight_required/prev_not_sent/gap) · G3 G3b (ทองเดิม prev_not_sent/trigger) · G4 (ทอง handoff + event) · G5 (ปิดงานทอง/เงินเดิม)
--  P9 overload / CHECK / trigger / view prefix               -> P9a P9b P9c
--  P10/N1 resolve ทอง ไม่มี prev/in_g/แผนโลหะ                 -> D5a D5b · D3a (prev_not_sent ทองเดิม vs ทองไม่ชั่ง) · D3b · D4 (D6 helper มัดจำ)
--  จอช่าง flag ของเสีย + has_profile/profile_name              -> D1 D2a D2b D2c D2d (ใบเดิม scrap_qty_ask=true scrap_weight_ask=false)
--  ใบจริง JB-0018 (อ่านอย่างเดียว) + token จริง                -> D6a D6b D6c D6d
--  P12 สิทธิ์ 18.5 (anon/authenticated 42501 · helper ไม่มี role) · ช่างไม่มี arg profile -> P12a P12b P12c
--  P11 ไม่มีราคา/ต้นทุน                                        -> P11
--  md5 ฟังก์ชันอื่นไม่ขยับ · updated_at/flag ใบเดิมไม่ขยับ        -> assert ท้ายไฟล์ migration (md5 ทุกฟังก์ชัน + updated_at + flag md5 + ทุกร้านมีค่าเริ่ม) · MY (หลังรัน mutant)
--  S6 (review 0175) job_guard แยก helper job_plan_basis_assert/job_plan_formula -> golden GB1-GB6 (ยกจาก B1-B6 ของ verify-0175: ผลต้องเท่าเดิมทุกข้อความ) + GF (สูตร) · MU-21..25
--  mutant 25 จุด: MU-1..MU-25 (guard ×4 · stage_guard ×2 · core_receive ×2 · job_done ×2 · create/default_for ×2 · resolve ×2 · DDL ×5 · apply · set_default)
--
--  ❌ ไม่มีเทสต์ครอบ (บอกตรงๆ):
--    - race หลาย connection: job_profile_set พร้อมช่างรับขั้นแรก (ต้อง 2 connection) → กันด้วย for update ใน job_office_begin + uq_job_stage_one_received + trigger ตรวจ received/sent ตอน UPDATE
--    - constraint trigger ค่าเริ่มกลางตอน COMMIT จริง: ทดสอบด้วย set constraints all immediate (ในทรานแซกชันทดสอบที่ถอยกลับ) เท่านั้น
--    - PostgREST จริง (named args · PGRST202/203 หลัง drop signature) → ครอบด้วย vitest (lib/actions) + P9a (1 signature ต่อชื่อ)
--    - ช่วง 00:00-07:00 ไทย → B2b ตรวจ occurred_on = job_today() (ฟังก์ชันของ J1) แต่ไม่ได้จำลองนาฬิกา
--    - JB-0018 ใบจริง "รับ/ส่ง/ปิดได้หลัง 0176" ยิงจริงไม่ได้ (ปิดงานเปลี่ยนสถานะถาวร/ออก token) → ครอบด้วยใบ fixture รูปเดียวกัน (leg) + golden G1-G5 + อ่านอย่างเดียว D6a-D6d
--    - pre-check md5 ของ migration + รัน migration ซ้ำ (idempotent) → ครอบด้วย dry-run ครั้งเดียว ไม่ได้ยิง apply 2 รอบ
--    - pre-check ต้นไฟล์ migration (L3 autocommit ล้มก่อน DDL · L4 ล็อก md5 ฉบับ 0175/0176 ของ 9 ฟังก์ชัน) = ไม่มีเทสต์ใน verify (ทดสอบ pre-check ต้อง apply จริงหรือรันนอก tx) — ครอบด้วย dry-run ที่ผ่านด่านนี้ + md5 ฉบับ 0176 คำนวณจาก dry-run ตัวเอง
--    - UI/ใบพิมพ์/หน้าช่าง ฝั่ง TS = ไม่มี (frontend + vitest)
--    - trigger truncate: TRUNCATE ถูกปฏิเสธด้วย FK อยู่แล้ว (ตารางมีใบอ้าง) จึงแยกไม่ได้ว่า trigger หรือ FK เป็นตัวกัน (P2f ตรวจแค่ ERR)

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

create function pg_temp.h(p_val text) returns text language sql as $c$ select analytics.job_sha256_hex(p_val) $c$;
create function pg_temp.jcq(p_shop uuid, p_item uuid, p_codes text[], p_due date, p_gate text, p_label text, p_note text, p_actor uuid) returns jsonb
 language sql as $c$
  select analytics.job_create_from_quote_item(p_shop, p_item, p_codes, p_due, p_gate, coalesce(p_label, 'v172-ชื่อเรียกภายใน'), p_note, p_actor) $c$;
-- ตัวนับใบผลิตบน DB จริงเคยเพี้ยน (counter < max seq) — fixture ซ่อมในทรานแซกชันของ section เอง (ถอยกลับทุกครั้ง)
create function pg_temp.po_save(p_shop_id uuid, p_note text) returns jsonb language plpgsql as $c$
begin
  update analytics.production_order_counter set last_no = greatest(last_no, (select coalesce(max(seq), 0) from analytics.production_order where shop_id = p_shop_id)) where shop_id = p_shop_id;
  return analytics.production_order_save(p_shop_id => p_shop_id, p_note => p_note);
end;
$c$;
create function pg_temp.std() returns text[] language sql as $c$
  select array['wax_inject', 'wax_tree', 'invest_burnout', 'cast', 'cut_sprue', 'polish', 'qc', 'pack'] $c$;
create function pg_temp.code(r jsonb) returns text language sql as $c$ select coalesce(r ->> 'code', r ->> '_hint', r ->> '_state') $c$;
create function pg_temp.st(p_job uuid) returns text language sql as $c$
  select string_agg(s.seq || ':' || left(s.status, 3) || case when s.auto_closed then '*' else '' end, ',' order by s.seq)
    from analytics.job_stage s where s.job_id = p_job $c$;

-- ยิง RPC ออฟฟิศ (named args · actor คงที่) -> jsonb หรือ {_err,...}
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

-- ยิง RPC ฝั่งช่าง
create function pg_temp.w_res(p_tokh text, p_sesh text default null, p_ip text default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.job_worker_resolve(%L, %L, %L)', p_tokh, p_sesh, p_ip)) $c$;
create function pg_temp.w_recv(p_tokh text, p_sesh text, p_seq int, p_w numeric default null, p_ip text default null) returns jsonb
 language sql as $c$ select pg_temp.q(format('select analytics.job_worker_receive(%L, %L, %L, %L, %L, %L)', p_tokh, p_sesh, p_seq, p_w, 'verify-ua/1.0', p_ip)) $c$;
create function pg_temp.w_send(p_tokh text, p_sesh text, p_seq int, p_w numeric default null, p_scrap int default 0, p_reason text default null,
                               p_added numeric default 0, p_note text default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_worker_send(p_token_hash=>%L, p_session_hash=>%L, p_expected_seq=>%L, p_weight_out_g=>%L,
      p_qty_scrap=>%L, p_scrap_reason=>%L, p_metal_added_g=>%L, p_weight_note=>%L)', p_tokh, p_sesh, p_seq, p_w, p_scrap, p_reason, p_added, p_note)) $c$;

-- login: คืน {ok, session_hash, raw} หรือผล fail ของ worker_pin_verify
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

-- โคลนดีล OEM (ใบเสนอราคา 1 ใบ + รายการเดียว) จากรายการแม่แบบจริง เพื่อสร้าง fixture ทอง/ทองเหลือง/ดีลที่ยังไม่มีมัดจำ/ดีลต่ออายุ
-- คืน {quote_id, item_id, quote_no} · root ใหม่ = ไม่มีใบเสร็จเลย (paid = 0)
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

-- สร้างใบงาน OEM ใหม่จากโคลนดีล -> {job_id, job_no, item_id, quote_id, quote_no} หรือ {_err..}
create function pg_temp.mkjob(p_shop uuid, p_tpl uuid, p_metal text, p_qty int default 10, p_codes text[] default null,
                              p_gate text default 'verify: เริ่มผลิตก่อนมัดจำ', p_cust text default null,
                              p_root uuid default null, p_new_design boolean default null) returns jsonb
 language plpgsql as $c$
declare
  d jsonb; r jsonb;
begin
  d := pg_temp.clone_deal(p_tpl, p_metal, p_qty, p_root, 'won', p_cust, p_new_design);
  r := pg_temp.q(format('select pg_temp.jcq(%L, %L, %L::text[], null, %L, null, null, %L)',
        p_shop, d ->> 'item_id', coalesce(p_codes, pg_temp.std()), p_gate, '00000000-0000-0000-0000-0000000000a1'::uuid));
  return d || r;
end;
$c$;


-- helper: เดินขั้น p_from..p_to ของใบงานด้วย RPC ออฟฟิศ (รับ 9.900 g / ส่ง 9.900 g (รับเท่าที่ขั้นก่อนส่ง — ทองต่างเกิน 0.05 g ถูกปฏิเสธตั้งแต่ 0173) ทุกขั้น · ไม่มีของเสีย) · หยุดที่ error แรก
create function pg_temp.o_run(p_shop uuid, p_job uuid, p_from int, p_to int, p_on date) returns jsonb
 language plpgsql as $c$
declare
  s int; r jsonb; v_st text;
begin
  for s in p_from .. p_to loop
    select status into v_st from analytics.job_stage where job_id = p_job and seq = s;
    if v_st = 'pending' then
      r := pg_temp.o_recv(p_shop, p_job, s, p_on, 9.900, null, 'verify');
      if r ? '_err' then return r || jsonb_build_object('_at', s); end if;
      v_st := 'received';
    end if;
    if v_st = 'received' then
      r := pg_temp.o_send(p_shop, p_job, s, p_on, 9.900);
      if r ? '_err' then return r || jsonb_build_object('_at', s); end if;
    end if;
  end loop;
  return jsonb_build_object('ok', true);
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

-- ============================================================================
-- Section C — token (#16) · ช่าง/PIN/session (#17) · ช่างทำขั้นผิด/พร้อมกัน (#18) · ด่านมัดจำตอนรับ (#13) · rate limit · ข้ามร้าน (#7)

-- ใบงานผลิตเข้าสต็อก (production source) สำหรับทดสอบโดยไม่แตะใบเสนอราคาเลย · ใบผลิต/สินค้าสร้างในทรานแซกชันของ section (ถอยกลับ)
create function pg_temp.mkpjob(p_shop uuid, p_qty int default 10) returns jsonb
 language plpgsql as $c$
declare v_prod uuid; v_po jsonb; v_poi uuid;
begin
  select p.id into v_prod from public.product p where p.shop_id = p_shop and p.is_active and p.sku !~* '^live' and p.cost_type in ('fixed', 'spot') order by p.sku limit 1;
  v_po := pg_temp.po_save(p_shop, 'verify0173');
  perform analytics.production_order_item_set(p_shop, (v_po ->> 'id')::uuid, v_prod, p_qty);
  select id into v_poi from analytics.production_order_item where production_order_id = (v_po ->> 'id')::uuid;
  return pg_temp.q(format('select analytics.job_create_from_production_item(%L, %L, %L::text[], null, null, null, %L)', p_shop, v_poi, pg_temp.std(), '00000000-0000-0000-0000-0000000000a1'::uuid))
         || jsonb_build_object('po_no', v_po ->> 'po_no');
end;
$c$;

create function pg_temp.newtok(p_shop uuid, p_job uuid) returns text language sql as $c$ select pg_temp.tok(p_shop, p_job) ->> 'hash' $c$;
create function pg_temp.wid(p_shop uuid, p_name text, p_pin text) returns uuid language sql as $c$ select (pg_temp.wu(p_shop, p_name, '', p_pin) ->> 'id')::uuid $c$;

-- ============================================================================
-- Section P — H1 (PIN ล็อกสะสม) · M2 (unlock) · L1 · L4 · ข้อสังเกต QA (PIN/ชื่อ/ข้าม QC)

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


-- ลายนิ้วมือ state: นับแถวทุกตารางใบงาน + ตัวนับ + ตาราง OEM/ผลิต/สต็อกที่ suite แตะทางอ้อม (ต้องเท่าเดิมหลัง rollback)
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

-- แก้ฟังก์ชันจริงด้วยการแทนข้อความใน pg_get_functiondef (ต้องเปลี่ยนจริง ไม่งั้น raise) — ใช้ใน subtransaction ที่ถอยกลับเองเท่านั้น
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
create function pg_temp.jc(p_shop uuid, p_item uuid, p_plan_qty int default null, p_target text default null,
                           p_ov text default null, p_reason text default null, p_codes text[] default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_create_from_quote_item(p_shop_id=>%L, p_quote_item_id=>%L, p_stage_codes=>%L::text[],
      p_start_gate_note=>%L, p_design_label=>%L, p_actor=>%L, p_qty_planned=>%L, p_target_piece_g=>%L::numeric,
      p_metal_plan_override_g=>%L::numeric, p_metal_plan_reason=>%L)',
      p_shop, p_item, coalesce(p_codes, pg_temp.std()), 'verify: เริ่มผลิตก่อนมัดจำ', 'v175-ชื่อเรียกภายใน',
      '00000000-0000-0000-0000-0000000000a1'::uuid, p_plan_qty, p_target, p_ov, p_reason)) $c$;

-- โคลนดีล + สร้างใบงาน (arg ใหม่) -> {job_id, ..., item_id}
create function pg_temp.mkj2(p_shop uuid, p_tpl uuid, p_metal text, p_qty int, p_plan_qty int default null, p_target text default null,
                             p_ov text default null, p_reason text default null) returns jsonb
 language plpgsql as $c$
declare d jsonb;
begin
  d := pg_temp.clone_deal(p_tpl, p_metal, p_qty, null, 'won', null, false);
  return d || pg_temp.jc(p_shop, (d ->> 'item_id')::uuid, p_plan_qty, p_target, p_ov, p_reason);
end;
$c$;

-- ใบงานผลิตเข้าสต็อก (qty สั่ง / qty เริ่มผลิต แยกกัน) — ใบผลิต+รายการสร้างผ่าน RPC ในทรานแซกชัน
create function pg_temp.mkpj2(p_shop uuid, p_qty int, p_plan_qty int default null) returns jsonb
 language plpgsql as $c$
declare v_prod uuid; v_po jsonb; v_poi uuid;
begin
  select p.id into v_prod from public.product p where p.shop_id = p_shop and p.is_active and p.sku !~* '^live' and p.cost_type in ('fixed', 'spot') order by p.sku limit 1;
  v_po := pg_temp.po_save(p_shop, 'verify0175');
  perform analytics.production_order_item_set(p_shop, (v_po ->> 'id')::uuid, v_prod, p_qty);
  select id into v_poi from analytics.production_order_item where production_order_id = (v_po ->> 'id')::uuid;
  return pg_temp.q(format('select analytics.job_create_from_production_item(p_shop_id=>%L, p_production_order_item_id=>%L, p_stage_codes=>%L::text[], p_actor=>%L, p_qty_planned=>%L)',
           p_shop, v_poi, pg_temp.std(), '00000000-0000-0000-0000-0000000000a1'::uuid, p_plan_qty));
end;
$c$;

-- เดินครบ 8 ขั้นมาตรฐาน (รับ/ส่ง 9.900 g) แล้วปิดงานด้วย job_done · คืนผล job_done
create function pg_temp.o_done(p_shop uuid, p_job uuid, p_good int, p_scrap int, p_disp text default null, p_snote text default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_done(p_shop_id=>%L, p_job_id=>%L, p_qty_good=>%L, p_qty_scrap=>%L, p_surplus_disposition=>%L, p_surplus_note=>%L, p_actor=>%L)',
    p_shop, p_job, p_good, p_scrap, p_disp, p_snote, '00000000-0000-0000-0000-0000000000a1'::uuid)) $c$;

create function pg_temp.o_surplus(p_shop uuid, p_job uuid, p_disp text, p_snote text default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_surplus_set(p_shop_id=>%L, p_job_id=>%L, p_disposition=>%L, p_note=>%L, p_actor=>%L)',
    p_shop, p_job, p_disp, p_snote, '00000000-0000-0000-0000-0000000000a1'::uuid)) $c$;

-- โคลนแถว job ด้วยค่าที่ override (ข้ามคอลัมน์ generated) -> 'OK' หรือ 'ERR:state:msg' · ใช้ทดสอบ INSERT ตรง (guard/CHECK) — แถวถอยกลับใน subtransaction ของ pg_temp.x
create function pg_temp.clone_job(p_src uuid, p_over jsonb) returns text
 language plpgsql as $c$
declare v_cols text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
    from pg_attribute a where a.attrelid = 'analytics.job'::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
  return pg_temp.x(format('insert into analytics.job (%1$s) select %1$s from jsonb_populate_record(null::analytics.job, (select to_jsonb(j) || ''{"status":"open","weight_start_g":null,"current_stage_code":null}''::jsonb from analytics.job j where j.id = %2$L) || %3$L::jsonb)',
    v_cols, p_src, p_over::text));
end;
$c$;

-- ข้อความ error ของ pg_temp.x เฉพาะส่วนข้อความ
create function pg_temp.xm(p_x text) returns text language sql as $c$ select coalesce(substring(p_x from '^ERR:[0-9A-Z]+:(.*)$'), p_x) $c$;
create function pg_temp.xs(p_x text) returns text language sql as $c$ select coalesce(substring(p_x from '^ERR:([0-9A-Z]+):'), 'OK') $c$;

-- def ของ job_core_receive ฉบับ 0175 (ก่อน 0176) ในชื่อ _legacy — golden: ใบเดิม (profile_id null) ต้องได้ผลเท่าฉบับใหม่ทุกสถานการณ์
create function pg_temp.mk_legacy() returns void language plpgsql as $mk$
begin
  execute $lgx$
create or replace function analytics.job_core_receive_legacy(
  p_job_id        uuid,
  p_expected_seq  int,
  p_occurred_on   date,
  p_weight_in     numeric,
  p_worker_id     uuid,
  p_assignee      text,
  p_channel       text,
  p_actor         uuid,
  p_device_hint   text,
  p_enforce_scope boolean
)
 returns jsonb
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $f$
declare
  v_job     analytics.job%rowtype;
  v_t       analytics.job_stage%rowtype;
  v_t2      analytics.job_stage%rowtype;
  v_p       analytics.job_stage%rowtype;
  v_p2      analytics.job_stage%rowtype;
  v_today   date := analytics.job_today();
  v_codes   text[];
  v_name    text;
  v_def     text;
  v_auto    text := null;
  v_gap     numeric := null;
begin
  select * into v_job from analytics.job where id = p_job_id;
  if not found then
    return analytics.job_fail('job_not_found', 'ไม่พบใบงาน');
  end if;
  if v_job.status in ('done', 'cancelled') then
    return analytics.job_fail('job_closed', 'ใบงานนี้ปิดแล้ว รับงานไม่ได้');
  end if;
  if v_job.status = 'on_hold' then
    return analytics.job_fail('job_on_hold', 'ใบงานนี้ถูกพักไว้ รับงานไม่ได้ — แจ้งออฟฟิศ');
  end if;
  if p_expected_seq is null then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;

  select * into v_t from analytics.job_stage where job_id = p_job_id and seq = p_expected_seq;
  if not found then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;
  if v_t.status = 'received' then
    select coalesce(w.display_name, v_t.assignee_name, 'ผู้รับก่อนหน้า') into v_name
      from (select 1) x left join analytics.worker w on w.id = v_t.worker_id;
    return analytics.job_fail('already_received', format('ขั้นนี้ถูกรับไปแล้วโดย %s', v_name), jsonb_build_object('by', v_name));
  end if;
  if v_t.status <> 'pending' then
    return analytics.job_fail('stage_changed', 'ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่');
  end if;
  if exists (select 1 from analytics.job_stage s where s.job_id = p_job_id and s.seq < v_t.seq and s.status = 'pending') then
    return analytics.job_fail('out_of_order', 'รับงานข้ามลำดับไม่ได้ — ขั้นก่อนหน้ายังไม่มีใครรับหรือข้าม');
  end if;

  -- วันที่: ช่างผ่าน QR = วันนี้เสมอ · ออฟฟิศย้อนได้ <= 14 วัน ไม่อนาคต (design §3 ข้อ 9 · มติ Q3)
  if p_occurred_on is null
     or p_occurred_on > v_today
     or (p_channel = 'worker_qr' and p_occurred_on <> v_today)
     or p_occurred_on < v_today - 14 then
    return analytics.job_fail('date_invalid', 'วันที่รับงานต้องไม่ใช่อนาคตและย้อนหลังได้ไม่เกิน 14 วัน (ช่างสแกนผ่าน QR ใช้วันนี้เท่านั้น)');
  end if;

  if p_worker_id is null and p_assignee is null then
    return analytics.job_fail('who_required', 'ต้องระบุผู้รับงาน');
  end if;
  if p_enforce_scope and p_worker_id is not null then
    select w.stage_codes into v_codes from analytics.worker w where w.id = p_worker_id;
    if not analytics.job_worker_can_do(v_codes, v_t.stage_code) then
      select d.name_th into v_def from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = v_t.stage_code;
      return analytics.job_fail('stage_not_allowed', format('งานนี้อยู่ขั้น "%s" ซึ่งคุณไม่ได้รับผิดชอบ', coalesce(v_def, v_t.stage_code)));
    end if;
  end if;

  if not analytics.job_weight_ok(p_weight_in) then
    return analytics.job_fail('weight_invalid', 'น้ำหนักเข้าต้องมากกว่า 0 และไม่เกิน 100,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)');
  end if;
  if v_t.weigh_required and p_weight_in is null then
    return analytics.job_fail('weight_required', 'ขั้นนี้ต้องชั่งน้ำหนักก่อนรับงาน');
  end if;

  -- ด่านมัดจำ (design §3 ข้อ 13 · มติ Q4): รับขั้นแรกของงาน OEM ที่ดีลยังไม่มีเงินเข้าเลย ต้องมีเหตุผลที่ออฟฟิศบันทึกไว้
  if analytics.job_deposit_blocked(v_job) then
    return analytics.job_fail('awaiting_deposit', 'รอมัดจำ — ดีลนี้ยังไม่มีเงินเข้า แจ้งออฟฟิศให้บันทึกเหตุผลก่อนเริ่มงาน');
  end if;

  -- ขั้นก่อนหน้า (ข้ามขั้นที่ skipped): ถ้ายังถือค้าง = ปิดอัตโนมัติ (ยกเว้นทอง) — ยืนยันฝ่ายเดียว (design §5.1 ข้อ 4)
  select * into v_p from analytics.job_stage s
   where s.job_id = p_job_id and s.seq < v_t.seq and s.status <> 'skipped' order by s.seq desc limit 1;
  if found then
    if v_p.status = 'received' then
      if v_job.metal = 'gold' then
        return analytics.job_fail('prev_not_sent', 'งานทอง: ขั้นก่อนหน้ายังไม่ได้กดส่งต่อ — ผู้ถือต้องกดส่งต่อพร้อมน้ำหนักออกก่อน');
      end if;
      -- QA 6: ขั้นก่อนหน้าบังคับชั่ง (เงิน: หล่อ/ตัดต้น/ขัด) และยังไม่มีน้ำหนักออก = ห้ามปิดอัตโนมัติ (ไม่งั้นรายงานน้ำหนักหายมีรูเงียบๆ)
      if v_p.weigh_required then
        return analytics.job_fail('prev_not_sent', 'ขั้นก่อนหน้าต้องชั่งน้ำหนักออกก่อน — ให้ผู้ถือกดส่งต่อพร้อมน้ำหนัก หรือแจ้งออฟฟิศกรอกแทน');
      end if;
      if p_occurred_on < v_p.received_on then
        return analytics.job_fail('date_invalid', 'วันรับต้องไม่ก่อนวันที่ขั้นก่อนหน้ารับงาน');
      end if;
      update analytics.job_stage
         set status = 'sent', sent_on = p_occurred_on, qty_out = qty_in, auto_closed = true
       where id = v_p.id
       returning * into v_p2;
      perform analytics.job_event_write(p_job_id, v_p.id, 'stage_send', p_occurred_on, p_actor, p_worker_id, p_channel, p_device_hint,
        jsonb_build_object('stage_code', v_p.stage_code, 'auto_closed', true, 'closed_by_receive_of', v_t.stage_code,
                           'before', analytics.job_stage_state(v_p), 'after', analytics.job_stage_state(v_p2)));
      v_auto := v_p.stage_code;
      v_p := v_p2;
    elsif v_p.status <> 'sent' then
      return analytics.job_fail('out_of_order', 'รับงานข้ามลำดับไม่ได้ — ขั้นก่อนหน้ายังไม่เสร็จ');
    end if;
    if p_occurred_on < v_p.sent_on then
      return analytics.job_fail('date_invalid', 'วันรับต้องไม่ก่อนวันที่ขั้นก่อนหน้าส่งต่อ');
    end if;
  end if;

  -- M1: น้ำหนักที่รับ vs น้ำหนักที่ขั้นก่อนหน้าส่งออก · ทอง ต่างเกิน 0.05 g = ปฏิเสธ (ต้องชั่งใหม่/ให้ออฟฟิศย้อนขั้นก่อนแก้) ·
  -- เงิน/ทองเหลือง ไม่บล็อก แต่เก็บส่วนต่างไว้ใน event + v_job_stage_loss.handoff_gap_g
  -- N4: เทียบเฉพาะเมื่อทั้งขั้นก่อนและขั้นนี้บังคับชั่ง (เทียน/ปูนไม่ถูกเทียบกับหล่อ)
  if v_p.id is not null and v_p.status = 'sent' and v_p.weight_out_g is not null and p_weight_in is not null
     and v_t.weigh_required and v_p.weigh_required then
    v_gap := p_weight_in - v_p.weight_out_g;
    if v_job.metal = 'gold' and abs(v_gap) > 0.05 then
      -- N1: ผู้รับต้องชั่งแบบไม่รู้คำตอบ — ข้อความ/ผลลัพธ์ไม่บอกขนาดส่วนต่างหรือน้ำหนักขั้นก่อน · แต่บันทึก event ทุกครั้งที่ไม่ตรงให้ออฟฟิศเห็น
      -- (event_type 'weigh' ที่ 0172 ประกาศไว้แต่ยังไม่ใช้ · payload.kind = handoff_mismatch · คนเรียกฝั่งออฟฟิศ raise ทำให้ event นี้ถอยกลับ ซึ่งยอมรับได้: ออฟฟิศเห็น error ตรงๆ)
      perform analytics.job_event_write(p_job_id, v_t.id, 'weigh', p_occurred_on, p_actor, p_worker_id, p_channel, p_device_hint,
        jsonb_build_object('kind', 'handoff_mismatch', 'stage_code', v_t.stage_code, 'weight_in_g', p_weight_in,
                           'prev_weight_out_g', v_p.weight_out_g, 'gap_g', v_gap));
      return analytics.job_fail('handoff_mismatch', 'น้ำหนักที่รับไม่ตรงกับที่ขั้นก่อนส่งมา — ชั่งใหม่ ถ้ายังไม่ตรงให้แจ้งออฟฟิศ');
    end if;
  end if;

  update analytics.job_stage
     set status = 'received', received_on = p_occurred_on, worker_id = p_worker_id, assignee_name = p_assignee,
         qty_in = case when v_p.id is not null then v_p.qty_out else v_job.qty_planned end,
         weight_in_g = p_weight_in
   where id = v_t.id
   returning * into v_t2;

  if v_job.weight_start_g is null and p_weight_in is not null and v_t.weigh_required then
    update analytics.job set weight_start_g = p_weight_in where id = p_job_id;
  end if;

  perform analytics.job_event_write(p_job_id, v_t.id, 'stage_receive', p_occurred_on, p_actor, p_worker_id, p_channel, p_device_hint,
    jsonb_build_object('stage_code', v_t.stage_code,
                       'auto_closed_prev', v_auto, 'handoff_gap_g', v_gap,
                       'before', analytics.job_stage_state(v_t), 'after', analytics.job_stage_state(v_t2)));

  select d.name_th into v_def from analytics.job_stage_def d where d.shop_id = v_job.shop_id and d.code = v_t.stage_code;
  return jsonb_build_object('ok', true, 'action', 'receive', 'job_no', v_job.job_no, 'stage_seq', v_t.seq, 'stage_code', v_t.stage_code,
                            'stage_name', v_def, 'received_on', p_occurred_on, 'qty_in', v_t2.qty_in, 'weight_in_g', v_t2.weight_in_g,
                            'prev_auto_closed', v_auto is not null,
                            'handoff_gap_g', case when v_job.metal = 'gold' then null else v_gap end);
end;
$f$;
  $lgx$;
end;
$mk$;

-- ============================================================================
-- helper ของ verify-0176 (ต่อจากชุดแม่แบบ 0175)
-- ============================================================================
-- error ตระกูล 22023 + hint ตรงตามที่ frontend map (p_hint null = ไม่เช็ค hint)
create function pg_temp.rej(r jsonb, p_hint text) returns boolean language sql as $c$
  select coalesce(r ? '_err' and r ->> '_state' = '22023' and (p_hint is null or r ->> '_hint' = p_hint), false) $c$;
-- id ของแบบที่ seed: def = ค่าเริ่มทั่วไป · gold = ค่าเริ่มทอง · none = "ไม่ชั่ง"
create function pg_temp.pid(p_shop uuid, p_kind text) returns uuid language sql as $c$
  select id from analytics.job_record_profile where shop_id = p_shop
     and case p_kind when 'def' then is_default when 'gold' then is_default_gold when 'none' then name like 'ไม่ชั่ง%' end limit 1 $c$;
create function pg_temp.pu(p_shop uuid, p_id uuid, p_name text, p_note text, p_stages text, p_active boolean default null,
                           p_seq int default null, p_fw boolean default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_record_profile_upsert(p_shop_id=>%L, p_id=>%L, p_name=>%L, p_note=>%L, p_stages=>%L::jsonb, p_is_active=>%L, p_seq=>%L, p_require_final_weight=>%L, p_actor=>%L)',
    p_shop, p_id, p_name, p_note, p_stages, p_active, p_seq, p_fw, '00000000-0000-0000-0000-0000000000a1'::uuid)) $c$;
create function pg_temp.sdf(p_shop uuid, p_id uuid, p_scope text default 'general') returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_record_profile_set_default(p_shop_id=>%L, p_id=>%L, p_scope=>%L, p_actor=>%L)',
    p_shop, p_id, p_scope, '00000000-0000-0000-0000-0000000000a1'::uuid)) $c$;
create function pg_temp.pset(p_shop uuid, p_job uuid, p_profile uuid) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_profile_set(p_shop_id=>%L, p_job_id=>%L, p_profile_id=>%L, p_actor=>%L)',
    p_shop, p_job, p_profile, '00000000-0000-0000-0000-0000000000a1'::uuid)) $c$;
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
-- flag ต่อขั้น: W = ชั่ง · Q = ถามชิ้นเสีย · S = ถามน้ำหนักเศษ
create function pg_temp.flg(p_job uuid) returns text language sql as $c$
  select string_agg(s.stage_code || ':' || case when s.weigh_required then 'W' else '' end || case when s.scrap_qty_ask then 'Q' else '' end
                    || case when s.scrap_weight_ask then 'S' else '' end, ',' order by s.seq)
    from analytics.job_stage s where s.job_id = p_job $c$;
create function pg_temp.jhash(p_job uuid) returns text language sql as $c$
  select md5(coalesce((select to_jsonb(j)::text from analytics.job j where j.id = p_job), '') ||
             coalesce((select string_agg(to_jsonb(s)::text, '|' order by s.seq) from analytics.job_stage s where s.job_id = p_job), '')) $c$;
-- แปลงใบที่เพิ่งสร้างให้เป็น "ใบเดิมก่อน 0176" (profile_id null · flag ตามกติกา J1: ทอง=metal_present · เงิน=weigh_default · ทองเหลือง=ไม่ชั่ง · ถามชิ้นเสียทุกขั้น)
-- ใช้ได้เฉพาะในทรานแซกชันที่ถอยกลับ (ปิด trg_job_guard ชั่วคราวเพื่อจำลองแถวที่เกิดก่อนมี profile)
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
-- เดินขั้น 1..8 ด้วย RPC ออฟฟิศ (p_w null = ไม่ใส่น้ำหนักเลย) · หยุดที่ error แรก
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
-- ปิดงาน (ดี 10 เสีย 0 · ใบ fixture มี qty 10)
create function pg_temp.fin(p_shop uuid, p_job uuid, p_wf numeric default null) returns jsonb language sql as $c$
  select pg_temp.q(format('select analytics.job_done(p_shop_id=>%L, p_job_id=>%L, p_qty_good=>10, p_qty_scrap=>0, p_weight_final_g=>%L, p_actor=>%L)',
    p_shop, p_job, p_wf, '00000000-0000-0000-0000-0000000000a1'::uuid)) $c$;
create function pg_temp.seqof(p_job uuid, p_code text) returns int language sql as $c$ select seq from analytics.job_stage where job_id = p_job and stage_code = p_code $c$;
create function pg_temp.core(p_fn text, p_job uuid, p_seq int, p_w numeric, p_worker uuid, p_name text, p_enforce boolean) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.%I(%L::uuid, %L::int, %L::date, %L::numeric, %L::uuid, %L::text, %L::text, %L::uuid, null::text, %L::boolean)',
    p_fn, p_job, p_seq, analytics.job_today(), p_w, p_worker, p_name, 'job_page', '00000000-0000-0000-0000-0000000000a1'::uuid, p_enforce)) $c$;
-- รายละเอียด snap ต่อตาราง (ใช้ชี้ว่าตารางไหนขยับเมื่อ K0c ล้ม)
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
-- เหมือน x แต่ถอยกลับเสมอ (ทั้งสำเร็จและล้ม) — ใช้กับการเขียนตรงที่ mutant อาจปล่อยผ่าน จะได้ไม่ทิ้งผลข้างเคียงให้เทสต์ถัดไป
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

-- ============================================================================
-- Section A — seed · upsert (P1) · ค่าเริ่ม/ปิด/ลบ (P2) · เขียนตรงข้าม RPC · แก้แบบไม่กระทบใบที่ใช้อยู่
-- ============================================================================
create function pg_temp.sa(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  v_act constant uuid := '00000000-0000-0000-0000-0000000000a1';
  p1 uuid; pn uuid; pgd uuid; pa uuid; pb uuid; pc uuid; pi uuid;
  r jsonb; r2 jsonb; r3 jsonb; x text; x2 text; n0 int; n1 int; v_ok boolean; v_why text; v_el text; j uuid; h0 text; h1 text;
  v_stages101 text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  p1 := pg_temp.pid(p_shop, 'def'); pgd := pg_temp.pid(p_shop, 'gold'); pn := pg_temp.pid(p_shop, 'none');

  -- A0 seed: แบบ 1 = ค่าเริ่ม (cast ชั่ง+ชิ้นเสีย) · ไม่ชั่ง = ไม่มีแถวขั้น · ทอง = ค่าเริ่มทอง ชั่งทุกขั้น metal_present + ชิ้นเสียทุกขั้น + บังคับน้ำหนักสุทธิ (= กติกาทอง J1)
  v_log := v_log || pg_temp.chk('A0a', 'seed: มีแบบ 1 (ค่าเริ่ม) · ไม่ชั่ง · ทอง (ค่าเริ่มทอง) · ไม่มี seed แบบ 2 · แบบ 1/ไม่ชั่ง require_final_weight=false',
    p1 is not null and pn is not null and pgd is not null and p1 <> pgd
    and not (select require_final_weight from analytics.job_record_profile where id = p1)
    and not (select require_final_weight from analytics.job_record_profile where id = pn)
    and (select require_final_weight from analytics.job_record_profile where id = pgd));
  v_log := v_log || pg_temp.chk('A0b', 'seed แบบ 1: แถวขั้นเดียว cast weigh+scrap_qty (ไม่มี scrap_weight) · "ไม่ชั่ง" ไม่มีแถวขั้นเลย',
    (select count(*) from analytics.job_record_profile_stage where profile_id = p1) = 1
    and exists (select 1 from analytics.job_record_profile_stage where profile_id = p1 and stage_code = 'cast' and weigh and scrap_qty and not scrap_weight)
    and (select count(*) from analytics.job_record_profile_stage where profile_id = pn) = 0);
  v_log := v_log || pg_temp.chk('A0c', 'seed ทอง: ทุกขั้นของทะเบียน (13) weigh = def.metal_present · ถามชิ้นเสียทุกขั้น · ไม่ถามน้ำหนักเศษ (= J1 ทอง)',
    (select count(*) from analytics.job_record_profile_stage where profile_id = pgd) = (select count(*) from analytics.job_stage_def where shop_id = p_shop)
    and not exists (select 1 from analytics.job_record_profile_stage s join analytics.job_stage_def d on d.shop_id = s.shop_id and d.code = s.stage_code
                     where s.profile_id = pgd and (s.weigh is distinct from d.metal_present or not s.scrap_qty or s.scrap_weight)));
  v_log := v_log || pg_temp.chk('A0d', 'ค่าเริ่มตามโลหะ: ทอง → แบบทอง · เงิน/ทองเหลือง/ไม่ระบุ → แบบ 1',
    analytics.job_profile_default_for(p_shop, 'gold') = pgd and analytics.job_profile_default_for(p_shop, 'silver') = p1
    and analytics.job_profile_default_for(p_shop, 'brass') = p1 and analytics.job_profile_default_for(p_shop, null) = p1);
  r := pg_temp.q(format('select analytics.job_record_profile_list(%L)', p_shop));
  v_log := v_log || pg_temp.chk('A0e', 'job_record_profile_list: profiles ≥ 3 · default_profile_id/default_gold_profile_id ตรง · stage_defs 13 + metal_present · ทุกแบบมี jobs_open',
    jsonb_array_length(r -> 'profiles') >= 3 and (r ->> 'default_profile_id')::uuid = p1 and (r ->> 'default_gold_profile_id')::uuid = pgd
    and jsonb_array_length(r -> 'stage_defs') = 13 and (r -> 'stage_defs' -> 6 ->> 'metal_present') = 'true'
    and not exists (select 1 from jsonb_array_elements(r -> 'profiles') e where not (e ? 'jobs_open')));

  -- P1 upsert ที่ห้ามผ่าน — ทุกเคสต้องถูกปฏิเสธ 22023 พร้อม hint · แถวไม่เพิ่ม
  select count(*) into n0 from analytics.job_record_profile where shop_id = p_shop;
  v_ok := true; v_why := '';
  for v_el in select unnest(array[
      -- ชื่อ: ว่าง · ช่องว่างล้วน · ล่องหน (zero-width / NBSP) · < > · ยาว 61
      '|name_x', E'   |name_x', E'​|name_x', E' 　|name_x', '<script>alert(1)</script>|name_x', repeat('ก', 61) || '|name_x',
      'v176<b>x|name_x']) loop
    r := pg_temp.pu(p_shop, null, split_part(v_el, '|', 1), null, null);
    if not pg_temp.rej(r, null) then v_ok := false; v_why := v_why || encode(convert_to(split_part(v_el, '|', 1), 'UTF8'), 'hex') || '→' || coalesce(r::text, '-') || '; '; end if;
  end loop;
  v_log := v_log || pg_temp.chk('P1a', 'upsert ชื่อว่าง/ช่องว่าง/ล่องหน/<script>/< >/ยาว 61 ถูกปฏิเสธ 22023 ทุกแบบ ' || left(v_why, 240), v_ok);
  r := pg_temp.pu(p_shop, null, 'v176-dup-test', null, null);
  r2 := pg_temp.pu(p_shop, null, 'V176-DUP-TEST', null, null);
  v_log := v_log || pg_temp.chk('P1b', 'ชื่อซ้ำต่าง case (V176-DUP-TEST vs v176-dup-test) = name_dup · ชื่อซ้ำกับแบบ seed ก็ซ้ำ · ไม่ส่งชื่อตอนสร้าง = name_required',
    (r ->> 'id') is not null and pg_temp.rej(r2, 'name_dup')
    and pg_temp.rej(pg_temp.pu(p_shop, null, (select name from analytics.job_record_profile where id = p1), null, null), 'name_dup')
    and pg_temp.rej(pg_temp.pu(p_shop, null, null, null, null), 'name_required'));
  pa := (r ->> 'id')::uuid;
  v_stages101 := (select jsonb_agg(jsonb_build_object('stage_code', 'cast', 'weigh', true))::text from generate_series(1, 101));
  v_ok := true; v_why := '';
  for v_el in select unnest(array[
      '{}|stage_invalid', 'null|stage_invalid', '"cast"|stage_invalid', '5|stage_invalid',
      '[1]|stage_invalid', '["cast"]|stage_invalid', '[null]|stage_invalid',
      '[{"stage_code":"zzz_none","weigh":true}]|stage_invalid', '[{"stage_code":null,"weigh":true}]|stage_invalid', '[{"stage_code":5}]|stage_invalid', '[{"weigh":true}]|stage_invalid',
      '[{"stage_code":"cast","weigh":"true"}]|stage_invalid', '[{"stage_code":"cast","weigh":1}]|stage_invalid', '[{"stage_code":"cast","scrap_qty":null}]|stage_invalid',
      '[{"stage_code":"cast","weigh":true,"evil":1}]|stage_invalid',
      '[{"stage_code":"cast","weigh":true},{"stage_code":"cast","scrap_qty":true}]|stage_dup',
      '[{"stage_code":"cad","weigh":true}]|flag_not_applicable', '[{"stage_code":"wax_inject","weigh":true}]|flag_not_applicable',
      '[{"stage_code":"mold","scrap_weight":true}]|flag_not_applicable', '[{"stage_code":"print3d","weigh":true,"scrap_qty":true}]|flag_not_applicable']) loop
    r := pg_temp.pu(p_shop, pa, null, null, split_part(v_el, '|', 1));
    if not pg_temp.rej(r, split_part(v_el, '|', 2)) then v_ok := false; v_why := v_why || split_part(v_el, '|', 1) || '→' || coalesce(r ->> '_hint', r::text) || '; '; end if;
  end loop;
  r := pg_temp.pu(p_shop, pa, null, null, v_stages101);
  if not pg_temp.rej(r, 'stage_invalid') then v_ok := false; v_why := v_why || '101-รายการ→' || coalesce(r ->> '_hint', '-') || '; '; end if;
  v_log := v_log || pg_temp.chk('P1c', 'upsert p_stages ที่ห้ามผ่าน 21 แบบ (ไม่ใช่ array/JSON null/ไม่ใช่ object/ไม่มี code/flag เป็น string-ตัวเลข-null/key แปลก/ซ้ำ/ขั้นไม่มี/>100/ชั่ง-เศษบนขั้นไม่มีโลหะ) ตก hint ที่ตั้งใจ ' || left(v_why, 300), v_ok);
  r := pg_temp.pu(p_shop, pa, null, null, null, null, 0);
  r2 := pg_temp.pu(p_shop, pa, null, null, null, null, 10001);
  v_log := v_log || pg_temp.chk('P1d', 'seq 0 / 10001 = seq_invalid · แบบที่ไม่มีจริง / ของร้านอื่น (uuid มั่ว) = profile_not_found · ไม่มี actor... (ผ่าน p_actor ปกติ)',
    pg_temp.rej(r, 'seq_invalid') and pg_temp.rej(r2, 'seq_invalid') and pg_temp.rej(pg_temp.pu(p_shop, gen_random_uuid(), 'x', null, null), 'profile_not_found')
    and (pg_temp.pu(gen_random_uuid(), null, 'v176-other-shop', null, null) ? '_err'));
  select count(*) into n1 from analytics.job_record_profile where shop_id = p_shop;
  v_log := v_log || pg_temp.chk('P1e', 'หลังเคสห้ามผ่านทั้งหมด จำนวนแบบเพิ่มแค่ที่สร้างสำเร็จ 1 แบบ (ไม่มีแถวค้างจากเคสที่ถูกปฏิเสธ)', n1 = n0 + 1);

  -- ต้องไม่พัง: สร้าง/แก้แบบ 2 — stage ครบ 4 แบบ + แถวที่ปิดทั้ง 3 ไม่ถูกเก็บ · null = ไม่เปลี่ยน · '[]' = ล้าง
  r := pg_temp.pu(p_shop, pa, 'v176-แบบ 2', 'ใช้กับงานชุบ', '[{"stage_code":"cast","weigh":true,"scrap_qty":true},{"stage_code":"cut_sprue","weigh":true,"scrap_weight":true},{"stage_code":"wax_inject","scrap_qty":true},{"stage_code":"polish","weigh":false,"scrap_qty":false,"scrap_weight":false}]', null, 20, true);
  v_log := v_log || pg_temp.chk('P1f', 'แก้แบบ: เปลี่ยนชื่อ+note+ขั้น 4 รายการ (polish ปิดทั้ง 3 ไม่ถูกเก็บ → เหลือ 3) · require_final_weight=true · seq 20 · jobs_open 0 · ขั้นเรียงตาม seq_default',
    (r ->> 'name') = 'v176-แบบ 2' and (r ->> 'note') = 'ใช้กับงานชุบ' and jsonb_array_length(r -> 'stages') = 3 and (r ->> 'require_final_weight') = 'true'
    and (r ->> 'seq') = '20' and (r ->> 'jobs_open') = '0' and (r -> 'stages' -> 0 ->> 'stage_code') = 'wax_inject' and (r -> 'stages' -> 2 ->> 'stage_code') = 'cut_sprue'
    and (r -> 'stages' -> 2 ->> 'scrap_weight') = 'true');
  r := pg_temp.pu(p_shop, pa, null, null, null);
  v_log := v_log || pg_temp.chk('P1g', 'แก้โดยไม่ส่ง p_stages/ชื่อ/note (null = ไม่เปลี่ยน): ขั้น 3 รายการ + ชื่อเดิมอยู่ครบ',
    jsonb_array_length(r -> 'stages') = 3 and (r ->> 'name') = 'v176-แบบ 2' and (r ->> 'note') = 'ใช้กับงานชุบ');
  r := pg_temp.pu(p_shop, pa, null, '', '[]');
  v_log := v_log || pg_temp.chk('P1h', 'p_stages = [] ล้างขั้นทั้งหมด · note = "" ล้าง note · ชื่อคงเดิม',
    jsonb_array_length(r -> 'stages') = 0 and (r -> 'note') = 'null'::jsonb and (r ->> 'name') = 'v176-แบบ 2');

  -- P2 ค่าเริ่ม/ปิด
  pb := (pg_temp.pu(p_shop, null, 'v176-แบบ B', null, null) ->> 'id')::uuid;
  pi := (pg_temp.pu(p_shop, null, 'v176-แบบ ปิดแล้ว', null, null, false) ->> 'id')::uuid;
  r := pg_temp.pu(p_shop, p1, null, null, null, false);
  r2 := pg_temp.pu(p_shop, pgd, null, null, null, false);
  r3 := pg_temp.pu(p_shop, pb, null, null, null, false);
  v_log := v_log || pg_temp.chk('P2a', 'ปิดแบบที่เป็นค่าเริ่มทั่วไป / ค่าเริ่มทอง = default_cannot_close (ทั้งผ่าน upsert) · ปิดแบบที่ไม่ใช่ค่าเริ่มได้ (is_active=false) · ค่าเริ่มยังอยู่',
    pg_temp.rej(r, 'default_cannot_close') and pg_temp.rej(r2, 'default_cannot_close') and (r3 ->> 'id') is not null and (r3 ->> 'is_active') = 'false'
    and (select is_default from analytics.job_record_profile where id = p1) and (select is_default_gold from analytics.job_record_profile where id = pgd));
  perform pg_temp.pu(p_shop, pb, null, null, null, true);
  v_log := v_log || pg_temp.chk('P2b', 'set_default ไปยังแบบที่ปิดอยู่ = inactive (ทั้ง general/gold) · ไปยังแบบของร้านอื่น/ไม่มีจริง = profile_not_found · scope มั่ว/null = scope_invalid · general ล้างไม่ได้ = default_required',
    pg_temp.rej(pg_temp.sdf(p_shop, pi, 'general'), 'inactive') and pg_temp.rej(pg_temp.sdf(p_shop, pi, 'gold'), 'inactive')
    and pg_temp.rej(pg_temp.sdf(p_shop, gen_random_uuid(), 'general'), 'profile_not_found')
    and pg_temp.rej(pg_temp.sdf(p_shop, pa, 'silver'), 'scope_invalid') and pg_temp.rej(pg_temp.sdf(p_shop, pa, null), 'scope_invalid')
    and pg_temp.rej(pg_temp.sdf(p_shop, null, 'general'), 'default_required')
    and (select is_default from analytics.job_record_profile where id = p1));
  -- สลับ A→B→A (general) และ gold: มี default อย่างละ 1 ตลอด · ล้าง gold = ทองใช้ค่าทั่วไป · ตั้ง gold ใหม่ได้
  r := pg_temp.sdf(p_shop, pb, 'general');
  x := (select count(*) || ':' || bool_or(is_default and id = pb)::text from analytics.job_record_profile where shop_id = p_shop and is_default);
  r2 := pg_temp.sdf(p_shop, p1, 'general');
  x2 := (select count(*) || ':' || bool_or(is_default and id = p1)::text from analytics.job_record_profile where shop_id = p_shop and is_default);
  v_log := v_log || pg_temp.chk('P2c', 'สลับค่าเริ่มทั่วไป A→B→A ในทรานแซกชันเดียว: มี default 1 ตัวตลอด (' || x || ' / ' || x2 || ') · response ชี้ตัวที่ถูก · ไม่กระทบแบบทอง',
    x = '1:true' and x2 = '1:true' and (r ->> 'default_profile_id')::uuid = pb and (r2 ->> 'default_profile_id')::uuid = p1
    and (r ->> 'default_gold_profile_id')::uuid = pgd);
  r := pg_temp.sdf(p_shop, null, 'gold');
  x := analytics.job_profile_default_for(p_shop, 'gold')::text;
  r2 := pg_temp.sdf(p_shop, pb, 'gold');
  x2 := analytics.job_profile_default_for(p_shop, 'gold')::text;
  r3 := pg_temp.sdf(p_shop, pb, 'gold');
  v_log := v_log || pg_temp.chk('P2d', 'ล้างค่าเริ่มทอง (p_id null + gold) → ทองใช้ค่าเริ่มทั่วไป (default_for gold = แบบ 1) · ตั้งแบบ B เป็นค่าเริ่มทอง → ทองได้ B · ตั้งซ้ำ idempotent · มี default ทอง 1 ตัว',
    (r ->> 'default_gold_profile_id')::uuid = p1 and x = p1::text and (r2 ->> 'default_gold_profile_id')::uuid = pb and x2 = pb::text
    and (r3 ->> 'default_gold_profile_id')::uuid = pb and (select count(*) from analytics.job_record_profile where shop_id = p_shop and is_default_gold) = 1);
  -- เขียนตรงข้าม RPC (เป็น owner ในทรานแซกชันทดสอบ — ด่านต้องอยู่ที่ตาราง ไม่ใช่ที่ RPC)
  x := pg_temp.xr(format('insert into analytics.job_record_profile (shop_id, name, is_default) values (%L, %L, true)', p_shop, 'v176-default2'));
  v_log := v_log || pg_temp.chk('P2e', 'INSERT แถว profile ตรงให้มี is_default 2 ตัวในร้านเดียว = 23505 (partial unique) · is_default_gold 2 ตัวเช่นกัน',
    pg_temp.xs(x) = '23505' and pg_temp.xs(pg_temp.xr(format('insert into analytics.job_record_profile (shop_id, name, is_default_gold) values (%L, %L, true)', p_shop, 'v176-gold2'))) = '23505');
  x := pg_temp.xr(format('delete from analytics.job_record_profile where id = %L', pb));
  x2 := pg_temp.xr('truncate analytics.job_record_profile');
  v_log := v_log || pg_temp.chk('P2f', 'DELETE profile = 22023 profile_no_delete · TRUNCATE profile/profile_stage = ERR (trigger deny + FK) · แถวยังอยู่',
    pg_temp.xs(x) = '22023' and pg_temp.xm(x) like '%ห้ามลบ%' and x2 like 'ERR:%'
    and pg_temp.xr('truncate analytics.job_record_profile_stage') like 'ERR:%'
    and exists (select 1 from analytics.job_record_profile where id = pb));
  x := pg_temp.xr(format('update analytics.job_record_profile set is_default = true where id = %L', pi));
  x2 := pg_temp.xr(format('update analytics.job_record_profile set is_active = false where id = %L', p1));
  v_log := v_log || pg_temp.chk('P2g', 'UPDATE ตรง: ตั้งแบบที่ปิดอยู่เป็น is_default / ปิดแบบที่เป็น is_default = ถูกปฏิเสธ 22023 (inactive / default_cannot_close)',
    pg_temp.xs(x) = '22023' and pg_temp.xm(x) like '%ปิดใช้งาน%' and pg_temp.xs(x2) = '22023' and pg_temp.xm(x2) like '%ปิดแบบที่เป็นค่าเริ่ม%');
  begin
    update analytics.job_record_profile set is_default = false where id = p1;
    set constraints analytics.trg_job_record_profile_default_required immediate;
    raise exception 'P2H_PASSED';   -- ผ่านด่าน = ล้ม block เองเสมอ เพื่อให้โหมด constraint ถอยกลับ (SET CONSTRAINTS ค้างข้าม subtransaction ได้)
  exception when others then
    x := case when sqlerrm = 'P2H_PASSED' then 'OK' else 'ERR:' || sqlstate || ':' || sqlerrm end;
  end;
  set constraints all deferred;   -- โหมดค้างข้าม subtransaction ที่ถอยกลับ — คืนเป็น deferred ก่อนเทสต์ถัดไป
  v_log := v_log || pg_temp.chk('P2h', 'ล้าง is_default ตรงโดยไม่ตั้งตัวใหม่ → ตรวจตอน commit (constraint trigger deferred) = 22023 default_required · "ต้องมีค่าเริ่มกลางเสมอ" [' || left(x, 90) || ']',
    pg_temp.xs(x) = '22023' and pg_temp.xm(x) like '%ต้องมีแบบค่าเริ่ม%');
  -- profile_stage ตรง: ชั่งบน cad ถูกปฏิเสธ · ปิดทั้ง 3 ถูก CHECK · shop_id ปลอมถูกทับด้วยของ profile
  x := pg_temp.xr(format('insert into analytics.job_record_profile_stage (profile_id, shop_id, stage_code, weigh) values (%L, %L, ''cad'', true)', pb, p_shop));
  x2 := pg_temp.xr(format('insert into analytics.job_record_profile_stage (profile_id, shop_id, stage_code) values (%L, %L, ''cast'')', pb, p_shop));
  v_log := v_log || pg_temp.chk('P2i', 'INSERT profile_stage ตรง: weigh บน cad = 22023 flag_not_applicable (trigger) · ปิดทั้ง 3 = 23514 (jrps_any_ck) · ขั้นไม่มีในทะเบียน = 22023',
    pg_temp.xs(x) = '22023' and pg_temp.xm(x) like '%ไม่มีโลหะ%' and pg_temp.xs(x2) = '23514'
    and pg_temp.xs(pg_temp.xr(format('insert into analytics.job_record_profile_stage (profile_id, shop_id, stage_code, scrap_qty) values (%L, %L, ''nope_stage'', true)', pb, p_shop))) = '22023');
  begin
    execute format('insert into analytics.job_record_profile_stage (profile_id, shop_id, stage_code, scrap_qty) values (%L, %L, ''qc'', true)', pb, '00000000-0000-0000-0000-0000000000ff');
    x := (select shop_id::text from analytics.job_record_profile_stage where profile_id = pb and stage_code = 'qc');
    raise exception 'P2J_DONE';
  exception when others then
    x := case when sqlerrm = 'P2J_DONE' then coalesce(x, '?') else 'ERR:' || sqlerrm end;
  end;
  v_log := v_log || pg_temp.chk('P2j', 'INSERT profile_stage ตรงใส่ shop_id ปลอม → trigger derive จาก profile (ไม่เชื่อ caller) shop_id ที่เก็บ = ของ profile [' || left(x, 60) || ']', x = p_shop::text);



  -- ต้องไม่พัง: แก้แบบ/ปิดแบบ/สลับค่าเริ่ม ไม่ขยับใบที่ใช้อยู่สักคอลัมน์ (snapshot) · ใบใหม่หลังสลับได้แบบใหม่
  pc := (pg_temp.pu(p_shop, null, 'v176-snapshot', null, '[{"stage_code":"cast","weigh":true,"scrap_qty":true}]') ->> 'id')::uuid;
  j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver', pc));
  h0 := pg_temp.jhash(j);
  perform pg_temp.pu(p_shop, pc, 'v176-snapshot-แก้', 'เปลี่ยนวันหลัง', '[{"stage_code":"cut_sprue","weigh":true,"scrap_qty":true,"scrap_weight":true}]', null, null, true);
  perform pg_temp.sdf(p_shop, pc, 'general');
  perform pg_temp.pu(p_shop, pc, null, null, null, false);   -- ปิดไม่ได้เพราะเป็นค่าเริ่ม → ต้องล้ม แล้วสลับกลับก่อนปิด
  perform pg_temp.sdf(p_shop, p1, 'general');
  r := pg_temp.pu(p_shop, pc, null, null, null, false);
  h1 := pg_temp.jhash(j);
  v_log := v_log || pg_temp.chk('P2k', 'ต้องไม่พัง: แก้ชื่อ/ขั้น/require_final_weight ของแบบ + สลับค่าเริ่ม + ปิดแบบ ที่ใบเปิดอยู่ใช้ → ใบ (job+job_stage ทั้งหมด) md5 เท่าเดิมเป๊ะ · flag ยังเป็นของแบบตอนสร้าง (cast:WQ) · profile_name = ชื่อเดิม',
    h0 = h1 and pg_temp.flg(j) like '%cast:WQ%' and (select profile_name from analytics.job where id = j) = 'v176-snapshot' and (r ->> 'is_active') = 'false'
    and not (select require_final_weight from analytics.job where id = j));
  perform pg_temp.pu(p_shop, pc, null, null, null, true);   -- เปิดคืน
  r := pg_temp.sdf(p_shop, pc, 'general');
  j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver'));
  v_log := v_log || pg_temp.chk('P2l', 'ใบใหม่หลังสลับค่าเริ่มได้แบบใหม่ (profile_name = ชื่อใหม่ + flag ตามขั้นใหม่: cut_sprue ชั่ง) ใบเดิมไม่ขยับ',
    (select profile_name from analytics.job where id = j) = 'v176-snapshot-แก้' and pg_temp.flg(j) like '%cut_sprue:WQS%' and (select require_final_weight from analytics.job where id = j));
  return v_log;
end;
$s$;

-- ============================================================================
-- Section B — สร้างใบงานด้วยแบบ (P3) · เปลี่ยนแบบ (P4) · เขียนตรงข้ามด่าน (P5)
-- ============================================================================
create function pg_temp.sb(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  v_today date := analytics.job_today();
  v_act constant uuid := '00000000-0000-0000-0000-0000000000a1';
  p1 uuid; pn uuid; pgd uuid; pw uuid; pf uuid; pi uuid;
  j uuid; j2 uuid; jg uuid; jb uuid; jl uuid; jp uuid; jx uuid;
  r jsonb; r2 jsonb; x text; x2 text; v_ok boolean; v_why text; v_el text; h0 text; h1 text; fl0 text; v_ev int;
  v_codes_nocast text[] := array['wax_inject', 'wax_tree', 'qc', 'pack'];
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  p1 := pg_temp.pid(p_shop, 'def'); pgd := pg_temp.pid(p_shop, 'gold'); pn := pg_temp.pid(p_shop, 'none');
  -- แบบ "ชั่งหล่อ+ตัดต้น" (แบบ 2 ของเจ้าของ) · แบบบังคับน้ำหนักสุทธิอย่างเดียว (ไม่ชั่งสักขั้น) · แบบปิดใช้
  pw := (pg_temp.pu(p_shop, null, 'v176-ชั่งหล่อ+ตัดต้น', null,
          '[{"stage_code":"cast","weigh":true,"scrap_qty":true},{"stage_code":"cut_sprue","weigh":true,"scrap_weight":true},{"stage_code":"wax_inject","scrap_qty":true}]') ->> 'id')::uuid;
  pf := (pg_temp.pu(p_shop, null, 'v176-ไม่ชั่งแต่ชั่งสุทธิ', null, '[]', null, null, true) ->> 'id')::uuid;
  pi := (pg_temp.pu(p_shop, null, 'v176-ปิดแล้ว', null, null, false) ->> 'id')::uuid;

  -- B1 สร้างใบเงิน/ทอง/ทองเหลือง/ใบผลิต แบบไม่ส่ง p_profile_id (caller เดิม) = ค่าเริ่มตามโลหะ
  r := pg_temp.mkp(p_shop, p_tpl, 'silver'); j := pg_temp.jid(r);
  v_log := v_log || pg_temp.chk('B1a', 'ต้องไม่พัง: สร้างใบเงินแบบไม่ส่ง p_profile_id ได้แบบ 1 · flag: cast ชั่ง+ชิ้นเสีย ขั้นอื่นปิดทั้ง 3 · weigh_required=true · require_final_weight=false · response มี profile_name/has_weigh/gold_unguarded=false',
    (r ->> 'profile_name') like 'แบบ 1%' and (r ->> 'has_weigh') = 'true' and (r ->> 'gold_unguarded') = 'false'
    and pg_temp.flg(j) = 'wax_inject:,wax_tree:,invest_burnout:,cast:WQ,cut_sprue:,polish:,qc:,pack:'
    and (select weigh_required and not require_final_weight and profile_id = p1 from analytics.job where id = j));
  r := pg_temp.mkp(p_shop, p_tpl, 'gold'); jg := pg_temp.jid(r);
  v_log := v_log || pg_temp.chk('B1b', 'สร้างใบทองแบบไม่ส่ง p_profile_id ได้แบบทอง (ค่าเริ่มทอง) = กติกาทอง J1: ชั่งทุกขั้น metal_present (cast..pack) + ชิ้นเสียทุกขั้น + บังคับน้ำหนักสุทธิ · gold_unguarded=false',
    (r ->> 'profile_name') like 'ทอง%' and (r ->> 'gold_unguarded') = 'false'
    and pg_temp.flg(jg) = 'wax_inject:Q,wax_tree:Q,invest_burnout:Q,cast:WQ,cut_sprue:WQ,polish:WQ,qc:WQ,pack:WQ'
    and (select require_final_weight and weigh_required and profile_id = pgd from analytics.job where id = jg));
  r := pg_temp.mkp(p_shop, p_tpl, 'brass'); jb := pg_temp.jid(r);
  v_log := v_log || pg_temp.chk('B1c', 'สร้างใบทองเหลืองแบบไม่ส่ง p_profile_id ได้แบบ 1 (ค่าเริ่มทั่วไป ไม่ใช่แบบทอง) · cast ชั่ง',
    (r ->> 'profile_name') like 'แบบ 1%' and pg_temp.flg(jb) like '%cast:WQ%' and (select profile_id = p1 from analytics.job where id = jb));
  r := pg_temp.mkp(p_shop, p_tpl, 'gold', pn); j2 := pg_temp.jid(r);
  v_log := v_log || pg_temp.chk('B1d', 'ระบุแบบ "ไม่ชั่ง" ให้ใบทอง: ได้ (ไม่บล็อก) · ทุกขั้นปิดทั้ง 3 · weigh_required=false · has_weigh=false · gold_unguarded=true (ป้ายเตือนทองไม่มีด่าน)',
    (r ->> 'has_weigh') = 'false' and (r ->> 'gold_unguarded') = 'true' and pg_temp.flg(j2) not like '%W%' and pg_temp.flg(j2) not like '%Q%'
    and not (select weigh_required from analytics.job where id = j2));
  v_ev := (select count(*) from analytics.job_event where job_id = j2 and event_type = 'create' and payload ->> 'profile_name' like 'ไม่ชั่ง%' and payload ->> 'gold_unguarded' = 'true');
  v_log := v_log || pg_temp.chk('B1e', 'event create ของใบ B1d มี profile_id/profile_name/has_weigh/gold_unguarded ใน payload', v_ev = 1);
  r := pg_temp.mkp(p_shop, p_tpl, 'silver', p1, v_codes_nocast); jp := pg_temp.jid(r);
  v_log := v_log || pg_temp.chk('B1f', 'รายการขั้นที่ไม่มี cast + แบบ 1 → สร้างได้ weigh_required=false · has_weigh=false (ไม่ raise) · ไม่มีขั้นไหน W',
    (r ->> 'job_id') is not null and (r ->> 'has_weigh') = 'false' and pg_temp.flg(jp) not like '%W%' and not (select weigh_required from analytics.job where id = jp));
  -- ใบผลิตเข้าสต็อก: สร้างผ่าน RPC ใบผลิต (ถ้ามีสินค้าเงินให้ใช้)
  if exists (select 1 from public.product p where p.shop_id = p_shop and p.is_active and p.sku !~* '^live' and p.cost_type in ('fixed', 'spot')) then
    r := pg_temp.mkpj2(p_shop, 5);
    v_log := v_log || pg_temp.chk('B1g', 'สร้างใบผลิตแบบไม่ส่ง p_profile_id ได้ (ค่าเริ่มตามโลหะ) · profile_name มี · caller เดิมไม่พัง',
      (r ->> 'job_id') is not null and (r ->> 'profile_name') is not null);
  else
    v_log := v_log || '[SKIP] B1g  ไม่มีสินค้าเงินบน DB นี้ — ไม่มีเทสต์ครอบใบผลิต' || E'\n';
  end if;

  -- P3 ที่ห้ามผ่าน
  select count(*) into v_ev from analytics.job;
  v_ok := true; v_why := '';
  for v_el in select unnest(array[gen_random_uuid()::text || '|profile_invalid', pi::text || '|profile_invalid']) loop
    r := pg_temp.mkp(p_shop, p_tpl, 'silver', split_part(v_el, '|', 1)::uuid);
    if not pg_temp.rej(r, split_part(v_el, '|', 2)) then v_ok := false; v_why := v_why || split_part(v_el, '|', 1) || '→' || coalesce(r ->> '_hint', r::text) || '; '; end if;
  end loop;
  v_log := v_log || pg_temp.chk('P3a', 'สร้างใบด้วยแบบที่ไม่มีจริง / ปิดใช้งาน = profile_invalid (ไม่สร้างใบ ตัวนับไม่ขยับ — ถอยกลับทั้ง statement) ' || left(v_why, 200),
    v_ok and (select count(*) from analytics.job) = v_ev);
  -- ร้านไม่มีค่าเริ่ม: ล้าง is_default ตรง (ไม่ผ่าน RPC) → สร้างใบ = no_default_profile (ไม่เดา · ไม่ fallback)
  update analytics.job_record_profile set is_default = false, is_default_gold = false where shop_id = p_shop;
  r := pg_temp.mkp(p_shop, p_tpl, 'silver');
  r2 := pg_temp.mkp(p_shop, p_tpl, 'gold');
  v_log := v_log || pg_temp.chk('P3b', 'ร้านไม่มีค่าเริ่ม (ล้างตรงใน subtransaction) → สร้างใบเงิน/ทอง = 22023 no_default_profile · ส่งแบบเองยังสร้างได้',
    pg_temp.rej(r, 'no_default_profile') and pg_temp.rej(r2, 'no_default_profile') and (pg_temp.mkp(p_shop, p_tpl, 'silver', pw) ->> 'job_id') is not null);
  update analytics.job_record_profile set is_default = true where id = p1;
  jx := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver'));   -- ต้นแบบแถว open ไว้โคลนให้ INSERT ตรง
  -- INSERT job ตรง (ข้าม RPC): ไม่มี profile / แบบปิด / ชื่อ snapshot ปลอม / flag น้ำหนักสุทธิไม่ตรงแบบ / profile_name ไม่คู่กับ profile_id
  v_ok := true; v_why := '';
  for v_el in select unnest(array[
      '{"profile_id":null,"profile_name":null}|profile_required',
      format('{"profile_id":"%s","profile_name":"ปลอม"}', p1) || '|profile_invalid',
      format('{"profile_id":"%s","profile_name":"v176-ปิดแล้ว","require_final_weight":false}', pi) || '|profile_invalid',
      format('{"profile_id":"%s","profile_name":"แบบ 1 — ชั่งเฉพาะหล่อ","require_final_weight":true}', p1) || '|profile_invalid',
      format('{"profile_id":"%s","profile_name":null}', p1) || '|ck',
      '{"profile_id":null,"profile_name":"x"}|ck']) loop
    x := pg_temp.clone_job(jx, (split_part(v_el, '|', 1))::jsonb);
    if not (pg_temp.xs(x) in ('22023', '23514') and (split_part(v_el, '|', 2) <> 'profile_required' or pg_temp.xm(x) like '%profile_required%')) then
      v_ok := false; v_why := v_why || split_part(v_el, '|', 2) || '→' || left(x, 100) || '; ';
    end if;
  end loop;
  v_log := v_log || pg_temp.chk('P3c', 'INSERT job ตรง: ไม่มี profile / แบบปิด / ชื่อ snapshot ปลอม / require_final_weight ไม่ตรงแบบ / ชื่อไม่คู่ id ถูกปฏิเสธ (guard/CHECK/unique) ' || left(v_why, 260), v_ok);

  -- B2 เปลี่ยนแบบ (P4): แบบ 1 → ไม่ชั่ง → แบบ 1 · flag กลับเท่าเดิม · event profile_set 2 แถว before/after ถูก
  j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver')); fl0 := pg_temp.flg(j);
  r := pg_temp.pset(p_shop, j, pn);
  r2 := pg_temp.pset(p_shop, j, p1);
  v_log := v_log || pg_temp.chk('B2a', 'job_profile_set แบบ 1 → ไม่ชั่ง → แบบ 1 ก่อนเริ่ม: ผลแรก flag ทุกขั้นปิด has_weigh=false weigh_required=false · ผลหลัง flag กลับเท่าเดิมเป๊ะ · response มี job_no/profile_name',
    (r ->> 'ok') = 'true' and (r ->> 'has_weigh') = 'false' and (r ->> 'profile_name') like 'ไม่ชั่ง%' and (r2 ->> 'profile_name') like 'แบบ 1%'
    and pg_temp.flg(j) = fl0 and (select weigh_required and profile_id = p1 from analytics.job where id = j) and (r2 ->> 'job_no') is not null);
  v_ev := (select count(*) from analytics.job_event where job_id = j and event_type = 'profile_set');
  v_log := v_log || pg_temp.chk('B2b', 'event profile_set 2 แถว: แถวแรก before=แบบ 1 after=ไม่ชั่ง (มี profile_name) · channel job_page · occurred_on = วันไทย (job_today)',
    v_ev = 2 and exists (select 1 from analytics.job_event e where e.job_id = j and e.event_type = 'profile_set' and e.payload -> 'before' ->> 'profile_name' like 'แบบ 1%'
                            and e.payload -> 'after' ->> 'profile_name' like 'ไม่ชั่ง%' and e.channel = 'job_page' and e.occurred_on = v_today and e.actor = v_act));
  -- ใบเดิม (profile_id null) ที่ยังไม่เริ่ม เปลี่ยนแบบได้ · before.profile_name = null
  jl := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver')); perform pg_temp.leg(jl);
  r := pg_temp.pset(p_shop, jl, pw);
  v_log := v_log || pg_temp.chk('B2c', 'ใบเดิม (profile_id null) ที่ยังไม่เริ่ม → job_profile_set ทำได้ · event before.profile_name = null · flag ตามแบบใหม่ (cast ชั่ง, cut_sprue ชั่ง)',
    (r ->> 'ok') = 'true' and exists (select 1 from analytics.job_event e where e.job_id = jl and e.event_type = 'profile_set' and e.payload -> 'before' -> 'profile_name' = 'null'::jsonb)
    and pg_temp.flg(jl) like '%cast:WQ,cut_sprue:WS%');
  -- ห้าม: หลังขั้นแรก received / sent · ใบ done/cancelled · ใบร้านอื่น · แบบมั่ว/ปิด/null
  j2 := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver'));
  perform pg_temp.o_recv(p_shop, j2, 1, v_today, null, null, 'verify');
  r := pg_temp.pset(p_shop, j2, pn);
  perform pg_temp.o_send(p_shop, j2, 1, v_today);
  r2 := pg_temp.pset(p_shop, j2, pn);
  v_log := v_log || pg_temp.chk('P4a', 'job_profile_set หลังขั้นแรกถูกรับ / หลังส่ง = 22023 started (flag ไม่ขยับ)',
    pg_temp.rej(r, 'started') and pg_temp.rej(r2, 'started') and pg_temp.flg(j2) = fl0);
  -- P4d security L1: ย้อนขั้น (job_stage_reopen) จนทุกขั้นกลับเป็น pending แล้วเปลี่ยนแบบ = started (เคยมีการรับงานแล้ว)
  jp := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver'));
  perform pg_temp.o_recv(p_shop, jp, 1, v_today, null, null, 'verify');
  r := pg_temp.q(format('select analytics.job_stage_reopen(%L, %L, %L, %L)', p_shop, jp, 'verify ย้อนขั้น', v_act));
  r2 := pg_temp.pset(p_shop, jp, pn);
  v_log := v_log || pg_temp.chk('P4d', 'ใบที่รับขั้น 1 แล้วย้อนขั้นจนทุกขั้นเป็น pending: job_profile_set = 22023 started (event stage_receive เคยเกิด) · flag ไม่ขยับ · ต้องไม่พัง: ใบใหม่ที่ไม่เคยรับยังเปลี่ยนได้ (B2a)',
    pg_temp.st(jp) like '1:pen%' and pg_temp.rej(r2, 'started') and pg_temp.flg(jp) = fl0);
  v_log := v_log || pg_temp.chk('P4b', 'job_profile_set: ใบร้านอื่น (shop มั่ว) = job_not_found · แบบมั่ว/ปิดใช้ = profile_invalid · null = profile_invalid · ใบ cancelled = job_closed',
    pg_temp.rej(pg_temp.pset(gen_random_uuid(), j, p1), 'job_not_found')
    and pg_temp.rej(pg_temp.pset(p_shop, j, gen_random_uuid()), 'profile_invalid') and pg_temp.rej(pg_temp.pset(p_shop, j, pi), 'profile_invalid')
    and pg_temp.rej(pg_temp.pset(p_shop, j, null), 'profile_invalid')
    and pg_temp.rej(pg_temp.pset(p_shop, (select id from analytics.job where status = 'cancelled' limit 1), p1), 'job_closed'));
  -- ใบ done
  jp := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver', pn));
  perform pg_temp.rw(p_shop, jp, null); perform pg_temp.fin(p_shop, jp);
  v_log := v_log || pg_temp.chk('P4c', 'job_profile_set บนใบ done = job_closed', pg_temp.rej(pg_temp.pset(p_shop, jp, p1), 'job_closed') and (select status from analytics.job where id = jp) = 'done');

  -- P5 เขียนตรง (เป็น owner ในทรานแซกชันทดสอบ): ด่านต้องอยู่ที่ trigger ไม่ใช่ที่ RPC
  -- ขั้นที่ received/sent / ขั้น pending ของใบที่เริ่มแล้ว — แก้ flag ทีละคอลัมน์ต้องล้ม
  v_ok := true; v_why := '';
  for v_el in select unnest(array['weigh_required|not weigh_required', 'scrap_qty_ask|not scrap_qty_ask', 'scrap_weight_ask|not scrap_weight_ask']) loop
    -- j2: ขั้น 1 sent · ขั้น 2.. pending ของใบที่เริ่มแล้ว
    x := pg_temp.x(format('update analytics.job_stage set %s = %s where job_id = %L and seq = 1', split_part(v_el, '|', 1), split_part(v_el, '|', 2), j2));
    x2 := pg_temp.x(format('update analytics.job_stage set %s = %s where job_id = %L and seq = 2', split_part(v_el, '|', 1), split_part(v_el, '|', 2), j2));
    if not (pg_temp.xs(x) = '22023' and pg_temp.xs(x2) = '22023') then v_ok := false; v_why := v_why || split_part(v_el, '|', 1) || '→' || left(x, 60) || ' / ' || left(x2, 60) || '; '; end if;
  end loop;
  perform pg_temp.o_recv(p_shop, j2, 2, v_today, null, null, 'verify');
  x := pg_temp.x(format('update analytics.job_stage set weigh_required = not weigh_required where job_id = %L and seq = 2', j2));   -- received
  v_log := v_log || pg_temp.chk('P5a', 'UPDATE ตรง job_stage.weigh_required/scrap_qty_ask/scrap_weight_ask: ขั้น sent / ขั้น pending ของใบที่เริ่มแล้ว / ขั้น received = ถูกปฏิเสธ 22023 ทุกคอลัมน์ ' || left(v_why, 200),
    v_ok and pg_temp.xs(x) = '22023' and pg_temp.flg(j2) = fl0);
  -- ใบที่ยังไม่เริ่ม: เปลี่ยนตรงได้ (ทางเดียวที่ trigger ยอม) แต่ job.weigh_required ต้องตรงขั้น — ไม่ตรง = weigh_drift
  j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver'));
  x := pg_temp.x(format('update analytics.job_stage set weigh_required = true where job_id = %L and seq = 1', j));
  x2 := pg_temp.x(format('update analytics.job set weigh_required = not weigh_required where id = %L', j));
  v_log := v_log || pg_temp.chk('P5b', 'ใบที่ยังไม่เริ่ม: UPDATE ตรง job_stage flag ผ่านได้ (ทางเดียวของ job_profile_apply) · แต่ job.weigh_required ตั้งให้ไม่ตรงขั้น = 22023 weigh_drift',
    x = 'OK' and pg_temp.xs(x2) = '22023' and pg_temp.xm(x2) like '%weigh_drift%');
  -- job.profile_id/profile_name/require_final_weight/weigh_required หลังเริ่ม · ถอดแบบเป็น null · แบบปิด/ชื่อไม่ตรง ก่อนเริ่ม
  v_ok := true; v_why := '';
  for v_el in select unnest(array[
      format('profile_id = %L', pn), format('profile_name = %L', 'ปลอม'), 'require_final_weight = not require_final_weight', 'weigh_required = not weigh_required',
      format('profile_id = %L, profile_name = %L', pn, (select name from analytics.job_record_profile where id = pn))]) loop
    x := pg_temp.x(format('update analytics.job set %s where id = %L', v_el, j2));
    if pg_temp.xs(x) <> '22023' then v_ok := false; v_why := v_why || left(v_el, 40) || '→' || left(x, 60) || '; '; end if;
  end loop;
  v_log := v_log || pg_temp.chk('P5c', 'UPDATE ตรง job.profile_id/profile_name/require_final_weight/weigh_required หลังช่างรับงานขั้นแรกแล้ว = 22023 ทุกคอลัมน์ ' || left(v_why, 200), v_ok);
  v_ok := true; v_why := '';
  for v_el in select unnest(array[
      'profile_id = null, profile_name = null', format('profile_id = %L, profile_name = %L', pi, 'v176-ปิดแล้ว'),
      format('profile_id = %L, profile_name = %L', pn, 'ชื่อไม่ตรง'), format('profile_id = %L, profile_name = %L, require_final_weight = true', pn, (select name from analytics.job_record_profile where id = pn))]) loop
    x := pg_temp.x(format('update analytics.job set %s where id = %L', v_el, j));
    if pg_temp.xs(x) <> '22023' then v_ok := false; v_why := v_why || left(v_el, 50) || '→' || left(x, 60) || '; '; end if;
  end loop;
  v_log := v_log || pg_temp.chk('P5d', 'ใบที่ยังไม่เริ่ม UPDATE ตรง: ถอดแบบเป็น null / แบบปิด / ชื่อ snapshot ไม่ตรง / require_final_weight ไม่ตรงแบบ = 22023 profile_invalid ทุกแบบ ' || left(v_why, 200), v_ok);
  return v_log;
end;
$s$;

-- ============================================================================
-- Section C — กติกาชั่ง/ปิดงานตามแบบ (P6 P7) · แบบ "ไม่ชั่ง" · require_final_weight · ของเสียเป็น flag ไม่ใช่ด่าน · golden ใบเดิม vs legacy
-- ============================================================================
create function pg_temp.sc(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  v_today date := analytics.job_today();
  p1 uuid; pn uuid; pgd uuid; pw uuid; pf uuid;
  j uuid; jg uuid; jb uuid; js uuid; ja uuid; jc uuid; jx uuid;
  r jsonb; r2 jsonb; ra jsonb; rb jsonb; x text; x2 text; v_ok boolean; v_why text; v_el text; n0 int; n1 int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform pg_temp.mk_legacy();
  p1 := pg_temp.pid(p_shop, 'def'); pgd := pg_temp.pid(p_shop, 'gold'); pn := pg_temp.pid(p_shop, 'none');
  pw := (pg_temp.pu(p_shop, null, 'v176-ชั่งหล่อ+ตัดต้น', null,
          '[{"stage_code":"cast","weigh":true,"scrap_qty":true},{"stage_code":"cut_sprue","weigh":true,"scrap_weight":true},{"stage_code":"wax_inject","scrap_qty":true}]') ->> 'id')::uuid;
  pf := (pg_temp.pu(p_shop, null, 'v176-ไม่ชั่งแต่ชั่งสุทธิ', null, '[]', null, null, true) ->> 'id')::uuid;

  -- P6 ขั้นที่แบบเปิดชั่ง: รับไม่ใส่น้ำหนัก / ส่งไม่ใส่น้ำหนัก — ทุกโลหะ รวมทองเหลืองที่ J1 ไม่เคยชั่ง
  v_ok := true; v_why := '';
  foreach v_el in array array['silver', 'gold', 'brass'] loop
    j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, v_el, pw));
    perform pg_temp.rw(p_shop, j, null, 3);
    r := pg_temp.o_recv(p_shop, j, 4, v_today, null, null, 'verify');
    perform pg_temp.o_recv(p_shop, j, 4, v_today, 10.000, null, 'verify');
    r2 := pg_temp.o_send(p_shop, j, 4, v_today, null);
    if not (pg_temp.code(r) = 'weight_required' and pg_temp.code(r2) = 'weight_required' and pg_temp.st(j) like '%3:sen,4:rec%') then
      v_ok := false; v_why := v_why || v_el || '→' || pg_temp.code(r) || '/' || pg_temp.code(r2) || '; ';
    end if;
  end loop;
  v_log := v_log || pg_temp.chk('P6a', 'แบบที่เปิดชั่งที่ cast: รับไม่ใส่น้ำหนัก = weight_required · ส่งไม่ใส่น้ำหนักออก = weight_required — เงิน/ทอง/ทองเหลือง (ทองเหลืองที่ J1 ไม่เคยชั่งก็ชั่ง) ' || left(v_why, 200), v_ok);
  v_ok := true; v_why := '';
  foreach v_el in array array['silver', 'gold', 'brass'] loop
    j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, v_el, pw));
    perform pg_temp.rw(p_shop, j, 9.9, 4);          -- ... cast (4) รับ+ส่งแล้ว (ชั่งแล้ว)
    perform pg_temp.o_recv(p_shop, j, 5, v_today, 9.9, null, 'verify');       -- cut_sprue รับ (ถือค้าง)
    r := pg_temp.o_recv(p_shop, j, 6, v_today, 9.9, null, 'verify');          -- polish ทั้งที่ cut_sprue (ชั่ง) ยังถือ
    if not (pg_temp.code(r) = 'prev_not_sent' and pg_temp.st(j) like '%5:rec,6:pen%') then
      v_ok := false; v_why := v_why || v_el || '→' || pg_temp.code(r) || '; ';
    end if;
  end loop;
  v_log := v_log || pg_temp.chk('P6b', 'ขั้นก่อนที่ชั่งยังถือค้าง → รับขั้นถัดไป = prev_not_sent ทุกโลหะ (รวมทองเหลือง) · ขั้นไม่ขยับ ' || left(v_why, 200), v_ok);
  -- ขั้นก่อนไม่ชั่ง ถือค้าง → ปิดอัตโนมัติได้ ทุกโลหะ รวมทอง (ที่มีแบบ)
  v_ok := true; v_why := '';
  foreach v_el in array array['silver', 'gold', 'brass'] loop
    j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, v_el, pn));
    perform pg_temp.o_recv(p_shop, j, 1, v_today, null, null, 'verify');
    r := pg_temp.o_recv(p_shop, j, 2, v_today, null, null, 'verify');
    if not ((r ->> 'ok') = 'true' and (r ->> 'prev_auto_closed') = 'true' and pg_temp.st(j) like '1:sen*,2:rec%') then
      v_ok := false; v_why := v_why || v_el || '→' || coalesce(r::text, '-') || '; ';
    end if;
  end loop;
  v_log := v_log || pg_temp.chk('P6c', 'แบบ "ไม่ชั่ง": ขั้นก่อนถือค้าง รับขั้นถัดไป → ปิดอัตโนมัติได้ (prev_auto_closed) ทุกโลหะ รวมทอง (ขั้น 1 = sent* auto_closed) ' || left(v_why, 200), v_ok);
  -- trigger: UPDATE ตรง auto_closed=true บนขั้นที่ชั่ง ต้องถูกปฏิเสธ (ทุกโลหะ รวมทองเหลือง) · บนขั้นไม่ชั่งของใบที่มีแบบทำได้
  jb := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'brass', pw));
  perform pg_temp.rw(p_shop, jb, 9.9, 3);
  perform pg_temp.o_recv(p_shop, jb, 4, v_today, 10.0, null, 'verify');     -- cast (ชั่ง) ถือค้าง
  x := pg_temp.x(format('update analytics.job_stage set status = ''sent'', sent_on = %L, qty_out = qty_in, auto_closed = true where job_id = %L and seq = 4', v_today, jb));
  v_log := v_log || pg_temp.chk('P6d', 'UPDATE ตรง ปิดขั้น cast (ชั่ง) ด้วย auto_closed=true บนใบทองเหลืองที่เปิดชั่ง = 22023 (trigger ตาม flag ของขั้น ไม่ใช่ตาม metal) · ขั้นยังถือค้าง',
    pg_temp.xs(x) = '22023' and pg_temp.xm(x) like '%ปิดขั้นอัตโนมัติ%' and pg_temp.st(jb) like '%4:rec%');
  js := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'brass', pw));
  perform pg_temp.o_recv(p_shop, js, 1, v_today, null, null, 'verify');
  x := pg_temp.x(format('update analytics.job_stage set status = ''sent'', sent_on = %L, qty_out = qty_in, auto_closed = true where job_id = %L and seq = 1', v_today, js));
  v_log := v_log || pg_temp.chk('P6e', 'ต้องไม่พัง: UPDATE ตรง ปิดขั้น wax_inject (ไม่ชั่ง) auto_closed=true ของใบที่มีแบบ ทำได้ (ทองเหลือง/เงิน เดิมก็ทำได้)', x = 'OK');

  -- P7 ทอง + แบบทอง (ชั่งทุกขั้น metal_present): handoff ±0.05 g ยังทำงาน · N1 ผลเดิมเป๊ะ
  jg := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'gold'));
  perform pg_temp.rw(p_shop, jg, 9.9, 4);
  ra := pg_temp.core('job_core_receive', jg, 5, 9.5, null, 'ออฟฟิศ', false);
  v_log := v_log || pg_temp.chk('P7a', 'ทอง+แบบทอง: handoff cast→cut_sprue ต่าง 0.4 g = handoff_mismatch · event weigh (kind=handoff_mismatch) บันทึก · response ไม่มี gap_g/prev_weight_out_g (N1) · ขั้นไม่ขยับ',
    (ra ->> 'code') = 'handoff_mismatch' and not (ra::text like '%gap_g%') and not (ra::text like '%prev_weight_out%') and pg_temp.st(jg) like '%5:pen%'
    and exists (select 1 from analytics.job_event e where e.job_id = jg and e.event_type = 'weigh' and e.payload ->> 'kind' = 'handoff_mismatch'));
  ra := pg_temp.core('job_core_receive', jg, 5, 9.9, null, 'ออฟฟิศ', false);
  v_log := v_log || pg_temp.chk('P7b', 'ต้องไม่พัง: ทองน้ำหนักตรง (9.9=9.9) รับได้ · handoff_gap_g ใน response = null (N1 ซ่อนส่วนต่างทอง)',
    (ra ->> 'ok') = 'true' and (ra -> 'handoff_gap_g') = 'null'::jsonb);
  perform pg_temp.o_send(p_shop, jg, 5, v_today, 9.9);
  perform pg_temp.rw(p_shop, jg, 9.9);
  r := pg_temp.fin(p_shop, jg);
  r2 := pg_temp.fin(p_shop, jg, 9.0);
  v_log := v_log || pg_temp.chk('P7c', 'ใบทอง (แบบทอง require_final_weight) ปิดงานไม่ส่งน้ำหนักสุทธิ = weight_required (ข้อความ "งานทอง...") · ส่งแล้วปิดได้ status done weight_final_g = 9.000',
    pg_temp.rej(r, 'weight_required') and (r ->> '_err') like 'งานทอง%' and (r2 ->> 'status') = 'done'
    and (select weight_final_g from analytics.job where id = jg) = 9.000);

  -- ทอง + แบบ 1 (ชั่งแค่ cast): cast ต้องชั่ง · cut_sprue รับไม่ต้อง · handoff ไม่เทียบ (ขั้นรับไม่ชั่ง) · gold_unguarded บนบอร์ด · ปิดงานไม่บังคับน้ำหนักสุทธิ
  jx := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'gold', p1));
  perform pg_temp.rw(p_shop, jx, null, 3);
  r := pg_temp.o_recv(p_shop, jx, 4, v_today, null, null, 'verify');
  perform pg_temp.o_recv(p_shop, jx, 4, v_today, 10.0, null, 'verify');
  perform pg_temp.o_send(p_shop, jx, 4, v_today, 9.9);
  ra := pg_temp.core('job_core_receive', jx, 5, 5.0, null, 'ออฟฟิศ', false);
  v_log := v_log || pg_temp.chk('P7d', 'ทอง+แบบ 1: cast รับไม่ชั่ง = weight_required · cut_sprue (ไม่ชั่ง) รับด้วย 5.0 g ทั้งที่ cast ส่ง 9.9 → ผ่าน ไม่เทียบ handoff (คู่ขั้นที่ชั่งทั้งคู่เท่านั้น) · ไม่มี event weigh',
    pg_temp.code(r) = 'weight_required' and (ra ->> 'ok') = 'true' and (ra -> 'handoff_gap_g') = 'null'::jsonb
    and not exists (select 1 from analytics.job_event e where e.job_id = jx and e.event_type = 'weigh'));
  js := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver'));
  v_log := v_log || pg_temp.chk('P7e', 'v_job_board: ใบทอง+แบบ 1 gold_unguarded=true has_weigh=true · ใบทอง+แบบทอง gold_unguarded=false · ใบเงิน+แบบ 1 gold_unguarded=false · profile_name มี',
    (select gold_unguarded and has_weigh and profile_name like 'แบบ 1%' from analytics.v_job_board where id = jx)
    and (select not gold_unguarded and has_weigh from analytics.v_job_board where id = jg)
    and not (select gold_unguarded from analytics.v_job_board where id = js));
  perform pg_temp.rw(p_shop, jx, null);
  r := pg_temp.fin(p_shop, jx);
  x := pg_temp.xr(format('update analytics.job set status = ''done'', done_at = now(), qty_good = 10, qty_scrap = 0 where id = %L', jx));
  r2 := pg_temp.fin(p_shop, jx, 9.0);
  v_log := v_log || pg_temp.chk('P7f', 'security M1: ใบทอง+แบบ 1 (มีขั้นชั่ง cast) ปิดงานไม่ส่งน้ำหนักสุทธิ = weight_required (กติกา J1: ทองที่มีขั้นชั่งต้องมีน้ำหนักสุทธิ) · UPDATE done ตรง = 23514 job_done_ck · ส่งแล้วปิดได้ · gold_unguarded บนใบที่ปิดแล้ว = false',
    pg_temp.rej(r, 'weight_required') and pg_temp.xs(x) = '23514' and pg_temp.xm(x) like '%job_done_ck%' and (r2 ->> 'status') = 'done'
    and (select weight_final_g = 9.000 from analytics.job where id = jx) and (select not gold_unguarded from analytics.v_job_board where id = jx));
  -- ล้างค่าเริ่มทอง → ใบทองใหม่ได้แบบ 1 (ชั่งเฉพาะหล่อ) → ปิดงานต้องมีน้ำหนักสุทธิ (ไม่หลุดด่านเพราะค่าเริ่มเปลี่ยน)
  r := pg_temp.sdf(p_shop, null, 'gold');
  jc := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'gold'));
  perform pg_temp.rw(p_shop, jc, 9.9);
  r2 := pg_temp.fin(p_shop, jc);
  v_log := v_log || pg_temp.chk('P7g', 'security M1: ล้างค่าเริ่มทอง → ใบทองใหม่ได้แบบ 1 · เดินครบ + ปิดงานไม่ส่งน้ำหนักสุทธิ = weight_required · ส่งแล้วปิดได้',
    pg_temp.flg(jc) like '%cast:WQ%' and (select profile_name like 'แบบ 1%' and weigh_required and not require_final_weight from analytics.job where id = jc)
    and pg_temp.rej(r2, 'weight_required') and (pg_temp.fin(p_shop, jc, 9.0) ->> 'status') = 'done');

  -- แบบ "ไม่ชั่ง": เดินครบ 8 ขั้นโดยไม่ใส่น้ำหนักเลย ทุกโลหะ → ปิดงานได้ · ไม่มี event weigh · handoff_gap_g ทุกแถวของ v_job_stage_loss = null · ใส่น้ำหนักเองก็รับ (optional)
  v_ok := true; v_why := '';
  foreach v_el in array array['silver', 'gold', 'brass'] loop
    j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, v_el, pn));
    r := pg_temp.rw(p_shop, j, null);
    r2 := pg_temp.fin(p_shop, j);
    if not ((r ->> 'ok') = 'true' and (r2 ->> 'status') = 'done'
            and not exists (select 1 from analytics.job_event e where e.job_id = j and e.event_type = 'weigh')
            and not exists (select 1 from analytics.v_job_stage_loss l where l.job_id = j and l.handoff_gap_g is not null)
            and (select weight_final_g is null and not weigh_required from analytics.job where id = j)) then
      v_ok := false; v_why := v_why || v_el || '→' || coalesce(r::text, '-') || coalesce(r2::text, '-') || '; ';
    end if;
  end loop;
  v_log := v_log || pg_temp.chk('P8a', 'แบบ "ไม่ชั่ง": ใบเงิน/ทอง/ทองเหลือง รับ→ส่งทุกขั้นไม่ใส่น้ำหนัก → job_done ได้ (ทอง: ไม่ต้องส่ง p_weight_final_g) · ไม่มี event weigh · ไม่มี handoff_gap ' || left(v_why, 200), v_ok);
  j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'gold', pn));
  r := pg_temp.rw(p_shop, j, 9.9);
  v_log := v_log || pg_temp.chk('P8b', 'แบบ "ไม่ชั่ง" ใส่น้ำหนักเอง (optional) รับได้ทุกขั้น · ใบทองปิดงานพร้อม/ไม่พร้อมน้ำหนักสุทธิได้',
    (r ->> 'ok') = 'true' and (pg_temp.fin(p_shop, j, 9.0) ->> 'status') = 'done');

  -- require_final_weight (แบบ "ไม่ชั่งแต่ชั่งสุทธิ"): ไม่ชั่งรายขั้น แต่ปิดงานต้องมีน้ำหนักสุทธิ — ทุกโลหะ รวมทองเหลือง · CHECK ชั้นตารางกันเขียน done ตรง
  v_ok := true; v_why := '';
  foreach v_el in array array['silver', 'gold', 'brass'] loop
    j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, v_el, pf));
    perform pg_temp.rw(p_shop, j, null);
    r := pg_temp.fin(p_shop, j);
    x := pg_temp.x(format('update analytics.job set status = ''done'', done_at = now(), qty_good = 10, qty_scrap = 0 where id = %L', j));
    r2 := pg_temp.fin(p_shop, j, 9.0);
    if not (pg_temp.rej(r, 'weight_required') and pg_temp.xs(x) = '23514' and pg_temp.xm(x) like '%job_done_ck%' and (r2 ->> 'status') = 'done') then
      v_ok := false; v_why := v_why || v_el || '→' || coalesce(r ->> '_hint', '-') || '/' || left(x, 50) || '/' || coalesce(r2 ->> 'status', r2 ->> '_err');
    end if;
  end loop;
  v_log := v_log || pg_temp.chk('P8c', 'require_final_weight=true: ปิดงานไม่ส่งน้ำหนักสุทธิ = weight_required ทุกโลหะ (รวมทองเหลือง) · UPDATE status=done ตรงโดยไม่มี weight_final_g = 23514 job_done_ck · ส่งน้ำหนักแล้วปิดได้ ' || left(v_why, 200), v_ok);

  -- ของเสียเป็น flag "ถาม/แสดง" ไม่ใช่ด่าน DB: ขั้นที่ scrap_qty_ask=false ส่ง qty_scrap>0 + เหตุผล (ออฟฟิศ) ยังรับ · scrap_weight_ask=false ส่ง scrap_weight_g ยังรับ
  j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver', pn));
  perform pg_temp.o_recv(p_shop, j, 1, v_today, null, null, 'verify');
  r := pg_temp.o_send(p_shop, j, 1, v_today, null, 1, 'broken');
  perform pg_temp.o_recv(p_shop, j, 2, v_today, null, null, 'verify');
  r2 := pg_temp.q(format('select analytics.job_office_send(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>2, p_occurred_on=>%L, p_scrap_weight_g=>0.5, p_actor=>%L)',
          p_shop, j, v_today, '00000000-0000-0000-0000-0000000000a1'::uuid));
  v_log := v_log || pg_temp.chk('P8d', 'ขั้นที่ scrap_qty_ask=false ส่งชิ้นเสีย 1 + เหตุผลได้ · scrap_weight_ask=false ส่ง scrap_weight_g 0.5 ได้ (flag ถาม ไม่ใช่ด่าน) · เก็บค่าจริง',
    (r ->> 'ok') = 'true' and (r2 ->> 'ok') = 'true' and (select qty_scrap = 1 from analytics.job_stage where job_id = j and seq = 1)
    and (select scrap_weight_g = 0.5 and not scrap_weight_ask and not scrap_qty_ask from analytics.job_stage where job_id = j and seq = 2));

  -- ===== golden: ใบเดิม (profile_id null) ต้องได้ผลเท่า legacy (def 0175 ของ job_core_receive) เป๊ะ =====
  -- G1 เงิน: ถือขั้น 1 (ไม่ชั่ง) → รับขั้น 2 = ปิดอัตโนมัติ ทั้งคู่ · ผลเท่ากัน
  ja := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver')); perform pg_temp.leg(ja);
  jb := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver')); perform pg_temp.leg(jb);
  perform pg_temp.core('job_core_receive', ja, 1, null, null, 'ออฟฟิศ', false);
  perform pg_temp.core('job_core_receive_legacy', jb, 1, null, null, 'ออฟฟิศ', false);
  ra := pg_temp.core('job_core_receive', ja, 2, null, null, 'ออฟฟิศ', false);
  rb := pg_temp.core('job_core_receive_legacy', jb, 2, null, null, 'ออฟฟิศ', false);
  v_log := v_log || pg_temp.chk('G1', 'golden ใบเงินเดิม: ถือขั้น 1 (ไม่ชั่ง) รับขั้น 2 → ปิดอัตโนมัติ · ใหม่ = legacy (ผลเท่ากันเป๊ะ · สถานะขั้นเท่ากัน)',
    (ra ->> 'prev_auto_closed') = 'true' and (ra - 'job_no') = (rb - 'job_no') and pg_temp.st(ja) = pg_temp.st(jb) and pg_temp.flg(ja) = pg_temp.flg(jb));
  -- G2 เงิน: เดินถึง cast · รับไม่ชั่ง → weight_required · รับ 10 · รับ cut_sprue ขณะ cast ถือ → prev_not_sent · ส่ง cast · รับ cut_sprue 9.5 (ต่าง) → ผ่าน เก็บ gap
  ja := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver')); perform pg_temp.leg(ja);
  jb := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver')); perform pg_temp.leg(jb);
  perform pg_temp.rw(p_shop, ja, 9.9, 3); perform pg_temp.rw(p_shop, jb, 9.9, 3);
  v_ok := true; v_why := '';
  foreach v_el in array array['4|', '4|10.0', '5|9.5', 'S4|9.9', '5|9.5'] loop
    if left(v_el, 1) = 'S' then
      perform pg_temp.o_send(p_shop, ja, 4, v_today, 9.9); perform pg_temp.o_send(p_shop, jb, 4, v_today, 9.9);
      continue;
    end if;
    ra := pg_temp.core('job_core_receive', ja, split_part(v_el, '|', 1)::int, nullif(split_part(v_el, '|', 2), '')::numeric, null, 'ออฟฟิศ', false);
    rb := pg_temp.core('job_core_receive_legacy', jb, split_part(v_el, '|', 1)::int, nullif(split_part(v_el, '|', 2), '')::numeric, null, 'ออฟฟิศ', false);
    if (ra - 'job_no') is distinct from (rb - 'job_no') or pg_temp.st(ja) <> pg_temp.st(jb) then v_ok := false; v_why := v_why || v_el || '→' || coalesce(ra::text, '-') || ' vs ' || coalesce(rb::text, '-') || '; '; end if;
  end loop;
  v_log := v_log || pg_temp.chk('G2', 'golden ใบเงินเดิม ถึงขั้น cast: weight_required · รับ 10.0 · prev_not_sent · ส่ง · รับ cut_sprue 9.5 (gap เงินไม่บล็อก) — ผลใหม่ = legacy ทุกก้าว ' || left(v_why, 240)
    || ' · สุดท้าย gap ใน response เงิน = -0.4', v_ok and (ra ->> 'handoff_gap_g')::numeric = -0.4 and pg_temp.flg(ja) = pg_temp.flg(jb));
  -- G3 ทองเดิม: ถือขั้น 1 (ไม่ชั่ง แต่เป็นทอง) → รับขั้น 2 = prev_not_sent ทั้งคู่ (ใบเดิมคงกติกา J1 · ไม่ใช้ flag อย่างเดียว)
  ja := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'gold')); perform pg_temp.leg(ja);
  jb := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'gold')); perform pg_temp.leg(jb);
  perform pg_temp.core('job_core_receive', ja, 1, null, null, 'ออฟฟิศ', false);
  perform pg_temp.core('job_core_receive_legacy', jb, 1, null, null, 'ออฟฟิศ', false);
  ra := pg_temp.core('job_core_receive', ja, 2, null, null, 'ออฟฟิศ', false);
  rb := pg_temp.core('job_core_receive_legacy', jb, 2, null, null, 'ออฟฟิศ', false);
  v_log := v_log || pg_temp.chk('G3', 'golden ใบทองเดิม: ถือขั้น 1 (wax_inject ไม่ชั่ง) รับขั้น 2 → prev_not_sent (ห้ามปิดอัตโนมัติทุกขั้น) · ใหม่ = legacy · ขั้นไม่ขยับ',
    (ra ->> 'code') = 'prev_not_sent' and (ra - 'job_no') = (rb - 'job_no') and pg_temp.st(ja) = pg_temp.st(jb) and pg_temp.st(ja) like '1:rec,2:pen%');
  x := pg_temp.x(format('update analytics.job_stage set status = ''sent'', sent_on = %L, qty_out = qty_in, auto_closed = true where job_id = %L and seq = 1', v_today, ja));
  v_log := v_log || pg_temp.chk('G3b', 'golden trigger: UPDATE ตรง auto_closed=true บนขั้น wax_inject ของใบทองเดิม = ยังถูกปฏิเสธ 22023 (กติกา J1: งานทองปิดขั้นอัตโนมัติไม่ได้ทุกขั้น)',
    pg_temp.xs(x) = '22023' and pg_temp.xm(x) like '%ปิดขั้นอัตโนมัติ%');
  -- G4 ทองเดิม handoff: cast 10.0→9.9 ส่ง · cut_sprue 9.5 → handoff_mismatch ทั้งคู่ · event weigh เท่ากัน · response เท่ากัน
  ja := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'gold')); perform pg_temp.leg(ja);
  jb := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'gold')); perform pg_temp.leg(jb);
  perform pg_temp.rw(p_shop, ja, 9.9, 4); perform pg_temp.rw(p_shop, jb, 9.9, 4);
  ra := pg_temp.core('job_core_receive', ja, 5, 9.5, null, 'ออฟฟิศ', false);
  rb := pg_temp.core('job_core_receive_legacy', jb, 5, 9.5, null, 'ออฟฟิศ', false);
  v_log := v_log || pg_temp.chk('G4', 'golden ใบทองเดิม: handoff ต่าง 0.4 g = handoff_mismatch ใหม่ = legacy (ผลเท่ากัน) · event weigh ใบละ 1 แถว payload เท่ากัน · ขั้นไม่ขยับ',
    (ra ->> 'code') = 'handoff_mismatch' and (ra - 'job_no') = (rb - 'job_no') and pg_temp.st(ja) = pg_temp.st(jb)
    and (select count(*) from analytics.job_event where job_id = ja and event_type = 'weigh') = 1
    and (select payload - 'stage_id' from analytics.job_event where job_id = ja and event_type = 'weigh')
        = (select payload - 'stage_id' from analytics.job_event where job_id = jb and event_type = 'weigh'));
  -- G5 ปิดงานใบเดิม: ทองต้องมีน้ำหนักสุทธิ (weight_required) · เงินไม่ต้อง · CHECK ตารางกัน done ตรง
  perform pg_temp.rw(p_shop, ja, 9.9);
  r := pg_temp.fin(p_shop, ja);
  x := pg_temp.x(format('update analytics.job set status = ''done'', done_at = now(), qty_good = 10, qty_scrap = 0 where id = %L', ja));
  r2 := pg_temp.fin(p_shop, ja, 9.0);
  jc := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver')); perform pg_temp.leg(jc);
  perform pg_temp.rw(p_shop, jc, 9.9);
  v_log := v_log || pg_temp.chk('G5', 'golden ปิดงานใบเดิม: ทองไม่ส่งน้ำหนักสุทธิ = weight_required · UPDATE done ตรง = 23514 job_done_ck · ส่งแล้วปิดได้ · ใบเงินเดิมปิดโดยไม่ส่งน้ำหนักได้ (กติกา J1 เท่าเดิม)',
    pg_temp.rej(r, 'weight_required') and (r ->> '_err') like 'งานทอง%' and pg_temp.xs(x) = '23514' and (r2 ->> 'status') = 'done'
    and (pg_temp.fin(p_shop, jc) ->> 'status') = 'done');
  return v_log;
end;
$s$;

-- ============================================================================
-- Section D — จอช่าง (resolve: flag ของเสีย · has_profile · N1 ทอง) · สิทธิ์ 18.5 · overload · view · ใบจริง JB-0018 (อ่านอย่างเดียว)
-- ============================================================================
create function pg_temp.sd(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  v_today date := analytics.job_today();
  p1 uuid; pn uuid; pgd uuid; pw uuid;
  j uuid; jg uuid; jl uuid; js uuid; jb uuid; jd uuid; j18 uuid;
  w uuid; wc uuid; th text; sh text; thl text; shl text; tg text; sg text; tc text; sc_ text; tb text; sb_ text; t18 text; sd_ text; thd text;
  r jsonb; r2 jsonb; rl jsonb; rg jsonb; x text; v_ok boolean; v_why text; v_el text; n int;
  v_fn text; v_args text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  p1 := pg_temp.pid(p_shop, 'def'); pgd := pg_temp.pid(p_shop, 'gold'); pn := pg_temp.pid(p_shop, 'none');
  pw := (pg_temp.pu(p_shop, null, 'v176-ชั่งหล่อ+ตัดต้น', null,
          '[{"stage_code":"cast","weigh":true,"scrap_qty":true},{"stage_code":"cut_sprue","weigh":true,"scrap_weight":true},{"stage_code":"wax_inject","scrap_qty":true}]') ->> 'id')::uuid;
  w := pg_temp.wid(p_shop, 'v176-ช่างทุกขั้น', '4829');
  wc := pg_temp.wid(p_shop, 'v176-ช่างเฉพาะหล่อ', '7351');
  update analytics.worker set stage_codes = array['cast'] where id = wc;

  -- D1 resolve ก่อนระบุตัวช่าง: has_profile มี (แยกใบใหม่/ใบเดิม) · ไม่มี profile_name · ใบเดิม has_profile=false
  js := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver'));
  jl := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver')); perform pg_temp.leg(jl);
  th := pg_temp.newtok(p_shop, js); thl := pg_temp.newtok(p_shop, jl);
  r := pg_temp.w_res(th); rl := pg_temp.w_res(thl);
  v_log := v_log || pg_temp.chk('D1', 'resolve ก่อนระบุตัว: ใบใหม่ job.has_profile=true · ใบเดิม (profile_id null) has_profile=false · ยังไม่ส่ง profile_name ก่อนระบุตัว · next_action=identify',
    (r ->> 'ok') = 'true' and (r -> 'job' -> 'has_profile') = 'true'::jsonb and (rl -> 'job' -> 'has_profile') = 'false'::jsonb
    and not (r -> 'job' ? 'profile_name') and (r ->> 'next_action') = 'identify');
  -- D2 ระบุตัวแล้ว: ใบใหม่ (แบบ 1) ขั้นแรก: ไม่ชั่ง/ไม่ถามเสีย · profile_name มี · ถึง cast: ชั่ง+ถามเสีย · ใบเดิม: profile_name null + scrap_qty_ask true scrap_weight_ask false
  sh := (pg_temp.login(th, w, '4829') ->> 'session_hash'); shl := (pg_temp.login(thl, w, '4829') ->> 'session_hash');
  r := pg_temp.w_res(th, sh); rl := pg_temp.w_res(thl, shl);
  v_log := v_log || pg_temp.chk('D2a', 'ระบุตัวแล้ว ใบใหม่ (แบบ 1) ขั้น wax_inject: action_stage weight_required=false scrap_qty_ask=false scrap_weight_ask=false · job.profile_name = แบบ 1 · has_profile=true',
    (r ->> 'next_action') = 'receive' and (r -> 'action_stage' -> 'weight_required') = 'false'::jsonb and (r -> 'action_stage' -> 'scrap_qty_ask') = 'false'::jsonb
    and (r -> 'action_stage' -> 'scrap_weight_ask') = 'false'::jsonb and (r -> 'job' ->> 'profile_name') like 'แบบ 1%' and (r -> 'job' -> 'has_profile') = 'true'::jsonb);
  v_log := v_log || pg_temp.chk('D2b', 'ต้องไม่พัง ใบเดิม (profile_id null): job.profile_name = null · has_profile=false · action_stage มี scrap_qty_ask=true scrap_weight_ask=false (= จอช่าง J1: ถามชิ้นเสียทุกขั้น ไม่มีช่องเศษ)',
    (rl ->> 'next_action') = 'receive' and (rl -> 'job' -> 'profile_name') = 'null'::jsonb and (rl -> 'job' -> 'has_profile') = 'false'::jsonb
    and (rl -> 'action_stage' -> 'scrap_qty_ask') = 'true'::jsonb and (rl -> 'action_stage' -> 'scrap_weight_ask') = 'false'::jsonb);
  perform pg_temp.rw(p_shop, js, 9.9, 3);
  r := pg_temp.w_res(th, sh);
  v_log := v_log || pg_temp.chk('D2c', 'ถึงขั้น cast (แบบ 1): action_stage.code=cast weight_required=true scrap_qty_ask=true scrap_weight_ask=false',
    (r -> 'action_stage' ->> 'code') = 'cast' and (r -> 'action_stage' -> 'weight_required') = 'true'::jsonb and (r -> 'action_stage' -> 'scrap_qty_ask') = 'true'::jsonb
    and (r -> 'action_stage' -> 'scrap_weight_ask') = 'false'::jsonb);
  jb := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'brass', pw)); tb := pg_temp.newtok(p_shop, jb); sb_ := (pg_temp.login(tb, w, '4829') ->> 'session_hash');
  perform pg_temp.rw(p_shop, jb, 9.9, 4);
  r := pg_temp.w_res(tb, sb_);
  v_log := v_log || pg_temp.chk('D2d', 'แบบ 2 (ชั่งหล่อ+ตัดต้น · เศษที่ตัดต้น): ขั้น cut_sprue action_stage weight_required=true scrap_qty_ask=false scrap_weight_ask=true — ทองเหลืองก็ชั่ง',
    (r -> 'action_stage' ->> 'code') = 'cut_sprue' and (r -> 'action_stage' -> 'weight_required') = 'true'::jsonb and (r -> 'action_stage' -> 'scrap_qty_ask') = 'false'::jsonb
    and (r -> 'action_stage' -> 'scrap_weight_ask') = 'true'::jsonb);
  -- D3 prev_not_sent ที่ resolve (QA N1): ใบทองเดิมถือขั้น 1 → ขั้น 2 = prev_not_sent · ทอง+ไม่ชั่ง ถือขั้น 1 → receive (ปิดอัตโนมัติได้) · เงิน+แบบ 1 ถือ cast → prev_not_sent
  jg := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'gold')); perform pg_temp.leg(jg);
  tg := pg_temp.newtok(p_shop, jg); sg := (pg_temp.login(tg, w, '4829') ->> 'session_hash');
  perform pg_temp.o_recv(p_shop, jg, 1, v_today, null, null, 'verify');
  rg := pg_temp.w_res(tg, sg);
  jd := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'gold', pn)); thd := pg_temp.newtok(p_shop, jd); sd_ := (pg_temp.login(thd, w, '4829') ->> 'session_hash');
  perform pg_temp.o_recv(p_shop, jd, 1, v_today, null, null, 'verify');
  r2 := pg_temp.w_res(thd, sd_);
  v_log := v_log || pg_temp.chk('D3a', 'resolve: ใบทองเดิมถือขั้น 1 (ไม่ชั่ง) = prev_not_sent (กติกา J1) · ใบทอง+ไม่ชั่งถือขั้น 1 = receive (ปิดอัตโนมัติได้)',
    (rg ->> 'next_action') = 'prev_not_sent' and (r2 ->> 'next_action') = 'receive');
  j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver')); perform pg_temp.rw(p_shop, j, 9.9, 3);
  perform pg_temp.o_recv(p_shop, j, 4, v_today, 10.0, null, 'verify');
  tc := pg_temp.newtok(p_shop, j); sc_ := (pg_temp.login(tc, w, '4829') ->> 'session_hash');
  v_log := v_log || pg_temp.chk('D3b', 'resolve: เงิน+แบบ 1 ถือ cast (ชั่ง) ผู้ถือเป็นออฟฟิศ → ช่างอีกคนเปิด = prev_not_sent · ใบเดียวกัน ช่างเฉพาะหล่อ (cast) ติด not_your_stage/ขั้นที่ไม่ใช่ขอบเขต (D6 helper can_do ทำงาน)',
    (pg_temp.w_res(tc, sc_) ->> 'next_action') = 'prev_not_sent'
    and (pg_temp.w_res(tc, (pg_temp.login(tc, wc, '7351') ->> 'session_hash')) ->> 'next_action') in ('not_your_stage', 'prev_not_sent'));
  -- D4 ด่านมัดจำที่ resolve ใช้ helper: ใบ OEM ไม่มีเงิน + ไม่มีเหตุผล = awaiting_deposit (D6) · มีเหตุผล = receive
  j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver'));
  th := pg_temp.newtok(p_shop, j); sh := (pg_temp.login(th, w, '4829') ->> 'session_hash');
  update analytics.job set start_gate_note = null where id = j;
  r := pg_temp.w_res(th, sh);
  update analytics.job set start_gate_note = 'verify: เริ่มก่อนมัดจำ' where id = j;
  r2 := pg_temp.w_res(th, sh);
  v_log := v_log || pg_temp.chk('D4', 'D6 resolve: ใบ OEM ไม่มีเงินเข้า+ไม่มีเหตุผล = awaiting_deposit · มีเหตุผลที่ออฟฟิศบันทึก = receive (ใช้ job_deposit_blocked เดียวกับ job_core_receive)',
    (r ->> 'next_action') = 'awaiting_deposit' and (r2 ->> 'next_action') = 'receive');
  -- D5 P10/N1 ทอง: ใบทอง (แบบทอง) ถึง cut_sprue pending หลัง cast ส่ง 9.9 → prev_weight_out_g = null · response ไม่มี in_g/metal_plan_g/weight_start_g/target_piece_g · เงินยังเห็น prev = 9.900
  jg := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'gold')); tg := pg_temp.newtok(p_shop, jg); sg := (pg_temp.login(tg, w, '4829') ->> 'session_hash');
  perform pg_temp.rw(p_shop, jg, 9.9, 4);
  rg := pg_temp.w_res(tg, sg);
  j := pg_temp.jid(pg_temp.mkp(p_shop, p_tpl, 'silver')); th := pg_temp.newtok(p_shop, j); sh := (pg_temp.login(th, w, '4829') ->> 'session_hash');
  perform pg_temp.rw(p_shop, j, 9.9, 4);
  r := pg_temp.w_res(th, sh);
  v_log := v_log || pg_temp.chk('D5a', 'N1 ทอง (แบบทอง): next_action=receive แต่ prev_weight_out_g = JSON null (ผู้รับต้องชั่งแบบไม่รู้คำตอบ) · ไม่มี key in_g/metal_plan_g/weight_start_g/target_piece_g/gap_g ใน response',
    (rg ->> 'next_action') = 'receive' and (rg -> 'prev_weight_out_g') = 'null'::jsonb and not (rg::text ~ '"(in_g|metal_plan_g|weight_start_g|target_piece_g|gap_g|metal_plan_basis)"'));
  v_log := v_log || pg_temp.chk('D5b', 'ต้องไม่พัง เงิน: prev_weight_out_g = 9.900 (ส่งให้ผู้รับตามเดิม) · ไม่มี key น้ำหนักแผนโลหะ',
    (r ->> 'next_action') = 'receive' and (r ->> 'prev_weight_out_g')::numeric = 9.900 and not (r::text ~ '"(in_g|metal_plan_g|weight_start_g|target_piece_g|metal_plan_basis)"'));
  -- ช่างไม่มีทางเลือก/เปลี่ยนแบบ: ไม่มี arg ที่ชื่อมี profile ในฟังก์ชันฝั่งช่าง
  select count(*) into n from pg_proc p where p.pronamespace = 'analytics'::regnamespace
     and p.proname in ('job_worker_resolve', 'job_worker_receive', 'job_worker_send', 'worker_pin_verify', 'job_worker_logout') and pg_get_function_arguments(p.oid) ~* 'profile';
  v_log := v_log || pg_temp.chk('P12a', 'ฟังก์ชันฝั่งช่าง (resolve/receive/send/pin_verify/logout) ไม่มี arg เกี่ยวกับ profile — ช่างเลือก/เปลี่ยนแบบไม่ได้', n = 0);
  -- ใบจริง JB-0018 (อ่านอย่างเดียว): ไม่ถูกแตะ — profile null · flag ต่อขั้นเป็นรูปเงิน J1 (weigh_default) · ถามชิ้นเสียทุกขั้น · resolve token จริงคืน ok · board มีแถว
  select id into j18 from analytics.job where job_no = 'JB-0018';
  if j18 is null then
    v_log := v_log || '[SKIP] D6  ไม่พบ JB-0018 บน DB นี้ — ไม่มีเทสต์ครอบใบจริง' || E'\n';
  else
    v_log := v_log || pg_temp.chk('D6a', 'ใบจริง JB-0018: profile_id/profile_name null · require_final_weight=false · flag ต่อขั้น = รูปเงินเดิม (weigh = def.weigh_default) scrap_qty_ask=true scrap_weight_ask=false ทุกขั้น',
      (select profile_id is null and profile_name is null and not require_final_weight from analytics.job where id = j18)
      and not exists (select 1 from analytics.job_stage s join analytics.job_stage_def d on d.shop_id = s.shop_id and d.code = s.stage_code
                       where s.job_id = j18 and (s.weigh_required is distinct from d.weigh_default or not s.scrap_qty_ask or s.scrap_weight_ask)));
    v_log := v_log || pg_temp.chk('D6b', 'v_job_board ของ JB-0018: profile_name null · has_weigh = true (ตรงกับ job.weigh_required เดิม) · gold_unguarded=false',
      (select profile_name is null and has_weigh = (select weigh_required from analytics.job where id = j18) and not gold_unguarded from analytics.v_job_board where id = j18));
    select token_hash into t18 from analytics.job_token where job_id = j18 and revoked_at is null limit 1;
    if t18 is null then
      v_log := v_log || '[SKIP] D6c  JB-0018 ไม่มี token ที่ใช้งานอยู่ — ไม่มีเทสต์ resolve ใบจริง' || E'\n';
    else
      r := pg_temp.w_res(t18);
      v_log := v_log || pg_temp.chk('D6c', 'job_worker_resolve ด้วย token จริงของ JB-0018 คืน ok · job.job_no=JB-0018 · has_profile=false · (rollback — ตัวนับ rate limit ไม่ค้าง)',
        (r ->> 'ok') = 'true' and (r -> 'job' ->> 'job_no') = 'JB-0018' and (r -> 'job' -> 'has_profile') = 'false'::jsonb);
    end if;
  end if;
  v_log := v_log || pg_temp.chk('D6d', 'v_job_board ทุกใบเดิม (profile_name null): gold_unguarded=false ทุกแถว · มีแถวครบเท่าตาราง job',
    not exists (select 1 from analytics.v_job_board b join analytics.job j on j.id = b.id where j.profile_id is null and b.gold_unguarded)
    and (select count(*) from analytics.v_job_board) = (select count(*) from analytics.job));

  -- สิทธิ์ 18.5: จำลองกำแพงชั้นนอกหลุด (grant usage ให้ anon/authenticated) → execute ทุก RPC/helper ใหม่ + select ตารางใหม่ ต้องตก 42501
  execute 'grant usage on schema analytics to anon, authenticated';
  v_ok := true; v_why := '';
  for v_fn, v_args in select * from (values
      ('job_record_profile_list', 'null'), ('job_record_profile_upsert', 'null'), ('job_record_profile_set_default', 'null, null'), ('job_profile_set', 'null, null, null'),
      ('job_profile_apply', 'null, null'), ('job_profile_state', 'null'), ('job_profile_default_for', 'null, null'), ('job_record_profile_ensure', 'null'),
      ('job_profile_json', 'null'), ('job_stage_suggest', 'null, null, null'), ('job_create_from_quote_item', 'null, null, null'),
      ('job_create_from_production_item', 'null, null, null'), ('job_done', 'null, null, null, null'), ('job_worker_resolve', 'null')) v(f, a) loop
    foreach x in array array['anon', 'authenticated'] loop
      v_el := pg_temp.as_role(x, format('select analytics.%I(%s)', v_fn, v_args));
      if v_el not like 'ERR:42501:%' then v_ok := false; v_why := v_why || x || ':' || v_fn || '→' || left(v_el, 70) || '; '; end if;
    end loop;
  end loop;
  foreach x in array array['anon', 'authenticated'] loop
    foreach v_fn in array array['job_record_profile', 'job_record_profile_stage', 'v_job_board'] loop
      v_el := pg_temp.as_role(x, format('select 1 from analytics.%I limit 1', v_fn));
      if v_el not like 'ERR:42501:%' then v_ok := false; v_why := v_why || x || ':table ' || v_fn || '→' || left(v_el, 70) || '; '; end if;
    end loop;
  end loop;
  execute 'revoke usage on schema analytics from anon, authenticated';
  v_log := v_log || pg_temp.chk('P12b', '18.5: anon/authenticated (แม้ได้ usage schema ชั่วคราว) execute RPC/helper ใหม่ + ตัวที่ replace ทั้ง 14 + select ตารางแบบ/stage/view = 42501 ทุกตัว ' || left(v_why, 300), v_ok);
  v_why := '';
  foreach v_fn in array array['job_record_profile_list', 'job_record_profile_upsert', 'job_record_profile_set_default', 'job_profile_set'] loop
    if not (select bool_and(has_function_privilege('service_role', p.oid, 'execute')) from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = v_fn) then v_why := v_why || v_fn || ' '; end if;
  end loop;
  foreach v_fn in array array['job_profile_apply', 'job_profile_state', 'job_profile_default_for', 'job_record_profile_ensure', 'job_profile_json',
                              'job_record_profile_guard', 'job_record_profile_stage_guard', 'job_record_profile_default_required'] loop
    if (select bool_or(has_function_privilege('service_role', p.oid, 'execute')) from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname = v_fn) then v_why := v_why || 'leak:' || v_fn || ' '; end if;
  end loop;
  v_log := v_log || pg_temp.chk('P12c', 'service_role execute ได้เฉพาะ RPC 4 ตัวใหม่ · helper/trigger function ใหม่ 8 ตัวไม่มี role ไหนรันได้ · service_role ตารางแบบ select ได้ แต่ insert/update/delete ไม่ได้ ' || v_why,
    v_why = '' and has_table_privilege('service_role', 'analytics.job_record_profile', 'select') and has_table_privilege('service_role', 'analytics.job_record_profile_stage', 'select')
    and not has_table_privilege('service_role', 'analytics.job_record_profile', 'insert,update,delete')
    and not has_table_privilege('service_role', 'analytics.job_record_profile_stage', 'insert,update,delete'));

  -- P9 overload / CHECK / trigger / view
  v_ok := true; v_why := '';
  foreach v_fn in array array['job_create_insert', 'job_create_from_quote_item', 'job_create_from_production_item', 'job_stage_suggest', 'job_worker_resolve', 'job_core_receive', 'job_done',
                              'job_guard', 'job_stage_guard', 'job_record_profile_list', 'job_record_profile_upsert', 'job_record_profile_set_default', 'job_profile_set', 'job_profile_apply'] loop
    select count(*) into n from pg_proc where pronamespace = 'analytics'::regnamespace and proname = v_fn;
    if n <> 1 then v_ok := false; v_why := v_why || v_fn || '=' || n || ' '; end if;
  end loop;
  v_log := v_log || pg_temp.chk('P9a', 'overload: ฟังก์ชันที่ replace/ใหม่ทั้ง 14 ชื่อ มี signature เดียวใน pg_proc ' || v_why, v_ok);
  v_log := v_log || pg_temp.chk('P9b', 'job_gold_weigh_ck ถูกถอดแล้ว · job_done_ck นิยามใหม่ (มี require_final_weight + weigh_required) · job_event_event_type_ck มี profile_set · trigger ใหม่เปิดครบ (O) · constraint trigger default_required เป็น deferred',
    not exists (select 1 from pg_constraint where conrelid = 'analytics.job'::regclass and conname = 'job_gold_weigh_ck')
    and (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'analytics.job'::regclass and conname = 'job_done_ck') like '%require_final_weight%'
    and (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'analytics.job'::regclass and conname = 'job_done_ck') like '%weigh_required%'
    and (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'analytics.job_event'::regclass and conname = 'job_event_event_type_ck') like '%profile_set%'
    and (select count(*) from pg_trigger t where t.tgrelid in ('analytics.job_record_profile'::regclass, 'analytics.job_record_profile_stage'::regclass) and not t.tgisinternal and t.tgenabled = 'O') = 5
    and (select t.tginitdeferred from pg_trigger t where t.tgname = 'trg_job_record_profile_default_required'));
  select string_agg(column_name, ',' order by ordinal_position) into v_why
    from information_schema.columns where table_schema = 'analytics' and table_name = 'v_job_board' and ordinal_position >= (select ordinal_position - 0 from information_schema.columns where table_schema = 'analytics' and table_name = 'v_job_board' and column_name = 'metal_plan_g');
  v_log := v_log || pg_temp.chk('P9c', 'v_job_board: คอลัมน์ใหม่ต่อท้ายถัดจาก metal_plan_g เป๊ะ (' || v_why || ') — ไม่แทรกกลาง',
    v_why = 'metal_plan_g,profile_name,has_weigh,gold_unguarded');
  select string_agg(p.proname, ',') into v_why from pg_proc p where p.pronamespace = 'analytics'::regnamespace
     and p.proname in ('job_profile_default_for', 'job_record_profile_ensure', 'job_profile_state', 'job_profile_apply', 'job_profile_json', 'job_record_profile_list', 'job_record_profile_upsert',
                       'job_record_profile_set_default', 'job_profile_set', 'job_record_profile_guard', 'job_record_profile_stage_guard', 'job_record_profile_default_required')
     and p.prosrc ~* '(price|cost|thb|baht|margin)';
  v_log := v_log || pg_temp.chk('P11', 'ไม่มีราคา/ต้นทุน: ฟังก์ชันใหม่ 12 ตัวไม่มีคำ price/cost/thb/baht/margin ในตัวฟังก์ชัน · ตารางแบบมีแต่ boolean/ชื่อ ' || coalesce(v_why, ''),
    v_why is null
    and not exists (select 1 from information_schema.columns where table_schema = 'analytics' and table_name in ('job_record_profile', 'job_record_profile_stage')
                       and data_type in ('numeric', 'double precision', 'real', 'money')));
  return v_log;
end;
$s$;

-- ============================================================================
-- Section E — golden job_guard หลังแยก helper plan_drift (S6): B1-B6 ของ verify-0175 (ผลต้องเท่าเดิม) + สูตร
-- ============================================================================
create function pg_temp.se(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log   text := '';
  v_today date := analytics.job_today();
  ja uuid; jb uuid; jd uuid; jc uuid; jn uuid; jp uuid;
  d jsonb; r jsonb; x text;
  v_n int; v_bad text := ''; c record;
  v_item_qty int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- ใบ open (ยังไม่มีขั้นถูกรับ · มี target+basis) · ใบ in_progress (ขั้น 1 รับแล้ว) · ใบ done (มีของเหลือ) · ใบ cancelled
  ja := (pg_temp.mkj2(p_shop, p_tpl, 'silver', 10, 10, '4.000') ->> 'job_id')::uuid;
  jb := (pg_temp.mkj2(p_shop, p_tpl, 'silver', 10, 10, '4.000') ->> 'job_id')::uuid;
  perform pg_temp.o_recv(p_shop, jb, 1, v_today, null, null, 'verify');
  jd := (pg_temp.mkj2(p_shop, p_tpl, 'silver', 10, 12, '4.000') ->> 'job_id')::uuid;
  perform pg_temp.o_run(p_shop, jd, 1, 8, v_today);
  perform pg_temp.o_done(p_shop, jd, 11, 1);
  jc := (pg_temp.mkj2(p_shop, p_tpl, 'silver', 10, 10, '4.000') ->> 'job_id')::uuid;
  perform pg_temp.q(format('select analytics.job_cancel(%L, %L, %L, %L)', p_shop, jc, 'verify ยกเลิก', '00000000-0000-0000-0000-0000000000a1'::uuid));

  -- B1 UPDATE qty_order ตรงๆ ตกทุก status (open / in_progress / done / cancelled)
  v_n := 0;
  foreach d in array array[to_jsonb(ja), to_jsonb(jb), to_jsonb(jd), to_jsonb(jc)] loop
    x := pg_temp.x(format('update analytics.job set qty_order = qty_order + 1 where id = %L', d #>> '{}'));
    if pg_temp.xs(x) = '22023' and pg_temp.xm(x) like 'job:%' then v_n := v_n + 1; end if;
  end loop;
  v_log := v_log || pg_temp.chk('GB1', 'UPDATE qty_order ตรงๆ ตกที่ job_guard ทั้ง 4 status (open · in_progress · done · cancelled) — ตก ' || v_n || '/4', v_n = 4);

  -- B2 qty_planned: ก่อนมีขั้นถูกรับ (ล้างแผนพร้อมกันเพื่อไม่ให้ชน plan_drift) = ได้ · หลังขั้นแรกถูกรับ = ตก hint started · แก้ qty_planned เดี่ยวๆ โดยแผนยังอ้างค่าเก่า = plan_drift
  x := pg_temp.x(format('update analytics.job set qty_planned = qty_planned + 1 where id = %L', ja));
  v_log := v_log || pg_temp.chk('GB2a', 'แก้ qty_planned ตรงๆ ขณะแผนโลหะยังอ้างจำนวนเก่า → ตก plan_drift (ต้องผ่าน job_qty_planned_set ที่คำนวณแผนใหม่ให้) · ' || pg_temp.xm(x),
    pg_temp.xs(x) = '22023' and pg_temp.xm(x) like '%plan_drift%');
  x := pg_temp.x(format('update analytics.job set qty_planned = 11, target_piece_g = null, metal_plan_g = null, metal_plan_basis = null where id = %L', ja));
  v_log := v_log || pg_temp.chk('GB2b', 'ต้องไม่พัง: ก่อนขั้นแรกถูกรับ แก้ qty_planned + ล้างแผนใน UPDATE เดียวได้ · หลังขั้นแรกถูกรับ (in_progress) แก้ qty_planned ตก "แก้จำนวนเริ่มผลิตได้เฉพาะก่อนขั้นแรกถูกรับ"',
    x = 'OK' and (select qty_planned from analytics.job where id = ja) = 11
    and pg_temp.xs(pg_temp.x(format('update analytics.job set qty_planned = 12, target_piece_g = null, metal_plan_g = null, metal_plan_basis = null where id = %L', jb))) = '22023'
    and pg_temp.xm(pg_temp.x(format('update analytics.job set qty_planned = 12, target_piece_g = null, metal_plan_g = null, metal_plan_basis = null where id = %L', jb))) like '%ก่อนขั้นแรกถูกรับ%'
    and (select qty_planned from analytics.job where id = jb) = 10);

  -- B3 แผนโลหะ: metal_plan_g แก้ตรงๆ ให้ไม่ตรง basis = plan_drift · target แก้โดย basis ไม่ตาม = plan_drift · หลัง cast ถูกรับ แก้ target = ตก cast_started
  x := pg_temp.x(format('update analytics.job set metal_plan_g = coalesce(metal_plan_g, 0) + 1 where id = %L', jb));
  v_log := v_log || pg_temp.chk('GB3a', 'UPDATE metal_plan_g ตรงๆ ให้ไม่ตรงกับ basis (หรือตั้งค่าทั้งที่ basis ไม่มีผลคำนวณ) → plan_drift · target แก้โดย basis ไม่ตาม → plan_drift',
    pg_temp.xs(x) = '22023' and pg_temp.xm(x) like '%plan_drift%'
    and pg_temp.xm(pg_temp.x(format('update analytics.job set target_piece_g = 5.000 where id = %L', jb))) like '%plan_drift%');
  -- B3c-e (security L1/L4): basis ปลอม — computed_g มั่ว (metal_plan_g ตามให้ตรง) · override ไม่มีเหตุผล/เหตุผล "." · target_source ค่ามั่ว/หาย
  x := pg_temp.x(format('update analytics.job set metal_plan_basis = jsonb_set(metal_plan_basis, ''{computed_g}'', ''999''::jsonb), metal_plan_g = 999 where id = %L', jb));
  v_log := v_log || pg_temp.chk('GB3c', 'basis ปลอม: computed_g = 999 (metal_plan_g ตามให้ตรง) ไม่ตรงสูตร จำนวน × น้ำหนัก × (1+ก้านต้น) → plan_drift · ' || pg_temp.xm(x),
    pg_temp.xs(x) = '22023' and pg_temp.xm(x) like '%plan_drift%');
  x := pg_temp.x(format('update analytics.job set metal_plan_basis = metal_plan_basis || ''{"override_g": 7, "override_reason": "."}''::jsonb, metal_plan_g = 7 where id = %L', jb));
  v_log := v_log || pg_temp.chk('GB3d', 'basis ปลอม: override_g = 7 แต่เหตุผลเป็น "." / ว่าง (ไม่มีตัวอักษรจริง) → plan_drift · ' || pg_temp.xm(x),
    pg_temp.xs(x) = '22023' and pg_temp.xm(x) like '%plan_drift%'
    and pg_temp.xm(pg_temp.x(format('update analytics.job set metal_plan_basis = metal_plan_basis || ''{"override_g": 7, "override_reason": null}''::jsonb, metal_plan_g = 7 where id = %L', jb))) like '%plan_drift%');
  v_log := v_log || pg_temp.chk('GB3e', 'basis ปลอม: target_source = "xyz" / ไม่ใช่ข้อความ / หาย → plan_drift (ที่มาน้ำหนักต้องเป็น quote|product|input)',
    pg_temp.xm(pg_temp.x(format('update analytics.job set metal_plan_basis = jsonb_set(metal_plan_basis, ''{target_source}'', ''"xyz"''::jsonb) where id = %L', jb))) like '%plan_drift%'
    and pg_temp.xm(pg_temp.x(format('update analytics.job set metal_plan_basis = jsonb_set(metal_plan_basis, ''{target_source}'', ''5''::jsonb) where id = %L', jb))) like '%plan_drift%'
    and pg_temp.xm(pg_temp.x(format('update analytics.job set metal_plan_basis = metal_plan_basis - ''target_source'' where id = %L', jb))) like '%plan_drift%');
  perform pg_temp.o_run(p_shop, jb, 1, 3, v_today);
  perform pg_temp.o_recv(p_shop, jb, 4, v_today, 9.9, null, 'verify');
  x := pg_temp.x(format('update analytics.job set target_piece_g = null, metal_plan_g = null, metal_plan_basis = null where id = %L', jb));
  v_log := v_log || pg_temp.chk('GB3b', 'หลังขั้นหล่อ (cast) ถูกรับ: ล้างแผน/แก้แผนตรงๆ ตก "แก้แผนโลหะได้เฉพาะก่อนขั้นหล่อถูกรับ" · แผนเดิมไม่ขยับ · ' || pg_temp.xm(x),
    pg_temp.xs(x) = '22023' and pg_temp.xm(x) like '%ก่อนขั้นหล่อถูกรับ%' and (select target_piece_g from analytics.job where id = jb) = 4.000);

  -- B4 ใบ done: mutant UPDATE ทีละคอลัมน์ (ทุกคอลัมน์ที่ไม่ใช่ surplus_*) ต้องตกที่ guard · surplus_* แก้ได้
  v_n := 0; v_bad := '';
  for c in select * from (values
      ('design_label', '''x'''), ('note', '''x'''), ('weight_final_g', '1.5'), ('weight_start_g', '1.5'), ('due_date', 'current_date'),
      ('current_stage_code', '''zz'''), ('start_gate_note', 'null'), ('cancel_reason', '''x'''), ('done_at', 'now() + interval ''1 day'''),
      ('qty_good', '12'), ('qty_scrap', '2'), ('qty_planned', '13'), ('qty_order', '9'), ('status', '''open'''), ('metal_plan_g', '1.0'),
      ('target_piece_g', '9.0'), ('metal_plan_basis', 'null'), ('sku_snapshot', '''x'''), ('created_at', 'created_at + interval ''1 second'''), ('weigh_required', 'false')
    ) as t(col, expr) loop
    x := pg_temp.x(format('update analytics.job set %I = %s where id = %L', c.col, c.expr, jd));
    if pg_temp.xs(x) <> 'OK' and pg_temp.xm(x) like 'job:%' then v_n := v_n + 1; else v_bad := v_bad || c.col || ' '; end if;
  end loop;
  v_log := v_log || pg_temp.chk('GB4a', 'ใบ done: UPDATE ทีละคอลัมน์ 20 คอลัมน์ (ทุกคอลัมน์ข้อมูลใบงาน ยกเว้น surplus_*) ต้องตกที่ job_guard ทุกตัว — ตก ' || v_n || '/20 · หลุด: ' || coalesce(nullif(v_bad, ''), '(ไม่มี)'),
    v_n = 20);
  x := pg_temp.x(format('update analytics.job set surplus_disposition = ''spare'', surplus_note = ''verify'' where id = %L', jd));
  v_log := v_log || pg_temp.chk('GB4b', 'ต้องไม่พัง: ใบ done แก้ surplus_disposition hold→spare + surplus_note ได้ (ช่องเดียวที่ guard ยอม) [' || x || ']',
    x = 'OK'
    and (select surplus_disposition = 'spare' and surplus_note = 'verify' from analytics.job where id = jd));

  -- B4c (security L2): ของเหลือตามชนิดต้นทาง — UPDATE ตรง OEM → stock ตก · ใบผลิต → hold ตก (CHECK job_surplus_source_ck · guard ปล่อยเพราะเป็นช่อง surplus_*)
  jp := (pg_temp.mkpj2(p_shop, 10, 12) ->> 'job_id')::uuid;
  perform pg_temp.o_run(p_shop, jp, 1, 8, v_today);
  perform pg_temp.o_done(p_shop, jp, 11, 1);
  x := pg_temp.x(format('update analytics.job set surplus_disposition = ''stock'' where id = %L', jd));
  v_log := v_log || pg_temp.chk('GB4c', 'UPDATE ตรง: ใบ OEM done ตั้ง surplus = stock ตก job_surplus_source_ck (23514) · ใบผลิต done ตั้ง hold ตก (23514) · ต้องไม่พัง: ใบผลิต stock → stock ผ่าน · OEM spare → deliver ผ่าน',
    pg_temp.xs(x) = '23514' and pg_temp.xm(x) like '%job_surplus_source_ck%'
    and pg_temp.xs(pg_temp.x(format('update analytics.job set surplus_disposition = ''hold'' where id = %L', jp))) = '23514'
    and pg_temp.x(format('update analytics.job set surplus_note = ''x'' where id = %L', jp)) = 'OK'
    and pg_temp.x(format('update analytics.job set surplus_disposition = ''deliver'' where id = %L', jd)) = 'OK');

  -- B5 ใบ cancelled: ตั้ง surplus ไม่ได้ · แก้อะไรก็ไม่ได้
  v_log := v_log || pg_temp.chk('GB5', 'ใบ cancelled: UPDATE surplus_disposition / surplus_note / design_label ตกที่ guard ทั้งหมด (cancelled แข็งกว่า done)',
    pg_temp.xs(pg_temp.x(format('update analytics.job set surplus_disposition = ''hold'' where id = %L', jc))) in ('22023', '23514')
    and pg_temp.xm(pg_temp.x(format('update analytics.job set surplus_disposition = ''hold'' where id = %L', jc))) like 'job:%'
    and pg_temp.xm(pg_temp.x(format('update analytics.job set surplus_note = ''x'' where id = %L', jc))) like 'job:%'
    and pg_temp.xm(pg_temp.x(format('update analytics.job set design_label = ''x'' where id = %L', jc))) like 'job:%');

  -- B6 INSERT ตรง: qty_order ไม่ตรงต้นทาง · surplus ตั้งตอนสร้าง · plan_g ไม่มี target (CHECK) · plan_g ไม่ตรง basis · (ต้องไม่พัง: ค่าถูกต้องผ่าน guard ไปชน unique index = guard ไม่เกินเหตุ)
  jn := jb;  -- ใช้ใบที่ยังมีแผน+basis เป็นแม่แบบโคลน (ชนิด OEM · มีรายการใบเสนอราคา)
  select i.qty into v_item_qty from analytics.job j join analytics.oem_quote_item i on i.id = j.oem_quote_item_id where j.id = jn;
  v_log := v_log || pg_temp.chk('GB6a', 'INSERT job ตรง: qty_order ≠ จำนวนรายการใบเสนอราคา ตก guard · ตั้ง surplus_disposition ตอนสร้างตก guard · metal_plan_g ไม่มี target/basis ตก CHECK job_plan_ck (23514)',
    pg_temp.xs(pg_temp.clone_job(jn, jsonb_build_object('id', gen_random_uuid(), 'seq', 999001, 'qty_order', v_item_qty + 5))) = '22023'
    and pg_temp.xm(pg_temp.clone_job(jn, jsonb_build_object('id', gen_random_uuid(), 'seq', 999001, 'qty_order', v_item_qty + 5))) like '%จำนวนที่สั่ง%'
    and pg_temp.xm(pg_temp.clone_job(jn, jsonb_build_object('id', gen_random_uuid(), 'seq', 999002, 'surplus_disposition', 'hold'))) like '%ตั้งการจัดการของเหลือไม่ได้%'
    and pg_temp.xs(pg_temp.clone_job(jn, jsonb_build_object('id', gen_random_uuid(), 'seq', 999003, 'target_piece_g', null, 'metal_plan_basis', null, 'metal_plan_g', 5))) = '23514');
  x := pg_temp.clone_job(jn, jsonb_build_object('id', gen_random_uuid(), 'seq', 999005));
  r := to_jsonb(pg_temp.clone_job(jn, jsonb_build_object('id', gen_random_uuid(), 'seq', 999004, 'metal_plan_g', 98765.432, 'metal_plan_basis', (select jsonb_set(metal_plan_basis, '{override_g}', 'null'::jsonb) from analytics.job where id = jn))));
  v_log := v_log || pg_temp.chk('GB6b', 'INSERT job ตรง: metal_plan_g ไม่ตรง basis ตก plan_drift · ต้องไม่พัง: ค่าครบถูกต้องผ่าน guard+CHECK แล้วไปชน unique index ของรายการเดิม (23505) — guard ไม่ปฏิเสธเกินเหตุ [' || left(x, 200) || '] [' || left(r #>> '{}', 200) || ']',
    pg_temp.xm(pg_temp.clone_job(jn, jsonb_build_object('id', gen_random_uuid(), 'seq', 999004, 'metal_plan_g', 98765.432, 'metal_plan_basis', (select jsonb_set(metal_plan_basis, '{override_g}', 'null'::jsonb) from analytics.job where id = jn)))) like '%plan_drift%'
    and pg_temp.xs(pg_temp.clone_job(jn, jsonb_build_object('id', gen_random_uuid(), 'seq', 999005))) = '23505');
  -- GF สูตรแผนโลหะ (job_plan_formula): จำนวน × น้ำหนัก × (1 + ก้านต้น%) ปัด 3 ตำแหน่ง = สูตรเดียวกับ job_plan_compute (เทียบ 3 ค่า)
  v_log := v_log || pg_temp.chk('GF', 'job_plan_formula: (10,4,0)=40.000 · (10,4,6)=42.400 · (3,1.234,2.5) = round(3×1.234×1.025,3) · (7,0.5,0)=3.500',
    analytics.job_plan_formula(10, 4.000, 0) = 40.000 and analytics.job_plan_formula(10, 4.000, 6) = 42.400
    and analytics.job_plan_formula(3, 1.234, 2.5) = round(3 * 1.234::numeric * (1 + 2.5 / 100), 3) and analytics.job_plan_formula(7, 0.500, 0) = 3.500);
  return v_log;
end;
$s$;


create function pg_temp.run_all(p_shop uuid, p_tpl uuid) returns text
 language sql as $c$
  select pg_temp.run_sec('sa', p_shop, p_tpl)
      || pg_temp.run_sec('sb', p_shop, p_tpl)
      || pg_temp.run_sec('sc', p_shop, p_tpl)
      || pg_temp.run_sec('sd', p_shop, p_tpl)
      || pg_temp.run_sec('se', p_shop, p_tpl)
$c$;

-- label ของเคส -> section ที่รันเคสนั้น (mutant รันเฉพาะ section ที่ expect อยู่ — ประหยัดเวลา: ทั้งชุดรันได้ไม่เกิน statement_timeout ของ DB)
create function pg_temp.sec_of(p_label text) returns text language sql as $c$
  select case
    when p_label like 'GB%' or p_label = 'GF' then 'se'
    when p_label like 'A0%' or p_label ~ '^P1[a-z]$' or p_label like 'P2%' then 'sa'
    when p_label like 'B%' or p_label in ('P3a', 'P3b', 'P3c') or p_label like 'P4%' or p_label like 'P5%' then 'sb'
    when p_label like 'P6%' or p_label like 'P7%' or p_label like 'P8%' or p_label like 'G%' then 'sc'
    else 'sd' end $c$;
create function pg_temp.run_for(p_expect jsonb, p_shop uuid, p_tpl uuid) returns text language plpgsql as $c$
declare v text := ''; s text;
begin
  for s in select distinct pg_temp.sec_of(e) from jsonb_array_elements_text(p_expect) e order by 1 loop
    v := v || pg_temp.run_sec(s, p_shop, p_tpl);
  end loop;
  return v;
end;
$c$;

do $v176$
declare
  v_shop uuid; v_tpl uuid;
  v_log text := ''; v_s text; v_fail int; v_snap0 text; v_d0 text;
  v_m record; v_killed int := 0; v_total int; v_survived text := ''; v_cnt int; v_id text; v_hit int; v_skip int; v_ok_cnt int;
  v_mutants jsonb := jsonb_build_array(
    jsonb_build_object('id', 'MU-1', 'what', 'job_guard INSERT ไม่บังคับ profile (ใบใหม่ไม่มีแบบได้)', 'fn', 'job_guard',
      'from', E'    if new.profile_id is null then\n      raise exception ''job: ใบงานใหม่ต้องมีแบบการบันทึก (profile_required)''', 'to', E'    if false then\n      raise exception ''job: ใบงานใหม่ต้องมีแบบการบันทึก (profile_required)''', 'expect', jsonb_build_array('P3c')),
    jsonb_build_object('id', 'MU-2', 'what', 'job_guard UPDATE ไม่เช็คว่าช่างรับขั้นแรกแล้ว (เปลี่ยนแบบหลังเริ่มได้)', 'fn', 'job_guard',
      'from', E'    if exists (select 1 from analytics.job_stage s where s.job_id = new.id and s.status in (''received'', ''sent'')) then\n      raise exception ''job: แก้แบบการบันทึก', 'to', E'    if false then\n      raise exception ''job: แก้แบบการบันทึก', 'expect', jsonb_build_array('P5c')),
    jsonb_build_object('id', 'MU-3', 'what', 'job_guard ไม่ตรวจ weigh_drift (job.weigh_required ไม่ตรงขั้นได้)', 'fn', 'job_guard',
      'from', 'if new.weigh_required is distinct from exists (select 1 from analytics.job_stage s where s.job_id = new.id and s.weigh_required) then', 'to', 'if false then', 'expect', jsonb_build_array('P5b')),
    jsonb_build_object('id', 'MU-4', 'what', 'job_stage_guard ปล่อยแก้ flag ชั่ง/ของเสียของขั้นหลังเริ่ม', 'fn', 'job_stage_guard',
      'from', E'  if (new.weigh_required <> old.weigh_required or new.scrap_qty_ask <> old.scrap_qty_ask or new.scrap_weight_ask <> old.scrap_weight_ask)\n', 'to', E'  if false and (new.weigh_required <> old.weigh_required or new.scrap_qty_ask <> old.scrap_qty_ask or new.scrap_weight_ask <> old.scrap_weight_ask)\n', 'expect', jsonb_build_array('P5a')),
    jsonb_build_object('id', 'MU-5', 'what', 'job_stage_guard ห้าม auto_close เฉพาะทองเดิม (ขั้นชั่งของทองเหลือง/เงินปิดอัตโนมัติตรงได้)', 'fn', 'job_stage_guard',
      'from', 'new.auto_closed and (new.weigh_required or (v_job.metal = ''gold'' and v_job.profile_id is null))', 'to', 'new.auto_closed and (v_job.metal = ''gold'' and v_job.profile_id is null)', 'expect', jsonb_build_array('P6d')),
    jsonb_build_object('id', 'MU-6', 'what', 'job_core_receive ถอดกติกาทองเดิม (ทองเดิมปิดขั้นก่อนอัตโนมัติได้)', 'fn', 'job_core_receive',
      'from', E'      if v_job.metal = ''gold'' and v_job.profile_id is null then\n        return analytics.job_fail(''prev_not_sent''', 'to', E'      if false then\n        return analytics.job_fail(''prev_not_sent''', 'expect', jsonb_build_array('G3')),
    jsonb_build_object('id', 'MU-7', 'what', 'job_core_receive กติกาทองกว้างเกิน (ทองที่มีแบบ "ไม่ชั่ง" ก็ปิดอัตโนมัติไม่ได้)', 'fn', 'job_core_receive',
      'from', E'      if v_job.metal = ''gold'' and v_job.profile_id is null then\n        return analytics.job_fail(''prev_not_sent''', 'to', E'      if v_job.metal = ''gold'' then\n        return analytics.job_fail(''prev_not_sent''', 'expect', jsonb_build_array('P6c')),
    jsonb_build_object('id', 'MU-8', 'what', 'job_done ไม่อ่าน require_final_weight (แบบบังคับน้ำหนักสุทธิถูกข้าม)', 'fn', 'job_done',
      'from', '(v_job.require_final_weight or (v_job.metal = ''gold'' and v_job.weigh_required))', 'to', '(v_job.metal = ''gold'' and v_job.weigh_required)', 'expect', jsonb_build_array('P8c')),
    jsonb_build_object('id', 'MU-9', 'what', 'job_done ไม่บังคับน้ำหนักสุทธิของทองที่มีขั้นชั่ง (security M1: ทองเดิม/ทองแบบ 1 ปิดไม่ส่งน้ำหนักได้)', 'fn', 'job_done',
      'from', '(v_job.require_final_weight or (v_job.metal = ''gold'' and v_job.weigh_required))', 'to', '(v_job.require_final_weight)', 'expect', jsonb_build_array('G5', 'P7f', 'P7g')),
    jsonb_build_object('id', 'MU-10', 'what', 'job_create_insert หาค่าเริ่มโดยไม่ดูโลหะ (ทองได้แบบทั่วไป)', 'fn', 'job_create_insert',
      'from', 'p.id = analytics.job_profile_default_for(p_shop_id, p_metal)', 'to', 'p.id = analytics.job_profile_default_for(p_shop_id, null)', 'expect', jsonb_build_array('B1b')),
    jsonb_build_object('id', 'MU-11', 'what', 'job_profile_default_for ไม่รู้จักค่าเริ่มทอง', 'fn', 'job_profile_default_for',
      'from', '(p_metal = ''gold'' and p.is_default_gold)', 'to', 'false', 'expect', jsonb_build_array('A0d', 'B1b')),
    jsonb_build_object('id', 'MU-12', 'what', 'job_worker_resolve ส่ง scrap_weight_ask=true เมื่อไม่มีแถว (ช่างเห็นช่องเศษทุกขั้น)', 'fn', 'job_worker_resolve',
      'from', 'coalesce(v_sw, false)', 'to', 'true', 'expect', jsonb_build_array('D2a', 'D2b')),
    jsonb_build_object('id', 'MU-13', 'what', 'job_worker_resolve ถอดกติกา prev_not_sent ของทองเดิม', 'fn', 'job_worker_resolve',
      'from', '(v_job.metal = ''gold'' and v_job.profile_id is null) or v_hold.weigh_required', 'to', 'v_hold.weigh_required', 'expect', jsonb_build_array('D3a')),
    jsonb_build_object('id', 'MU-14', 'what', 'ถอด trigger ตรวจ profile_stage (ชั่ง/เศษบนขั้นไม่มีโลหะ + derive shop_id)', 'ddl',
      'drop trigger trg_job_record_profile_stage_guard on analytics.job_record_profile_stage', 'expect', jsonb_build_array('P2i', 'P2j')),
    jsonb_build_object('id', 'MU-15', 'what', 'ถอด trigger กัน DELETE/ปิดแบบที่เป็นค่าเริ่ม', 'ddl',
      'drop trigger trg_job_record_profile_guard on analytics.job_record_profile', 'expect', jsonb_build_array('P2f', 'P2g')),
    jsonb_build_object('id', 'MU-16', 'what', 'ถอด constraint trigger ค่าเริ่มกลางต้องมีเสมอ', 'ddl',
      'drop trigger trg_job_record_profile_default_required on analytics.job_record_profile', 'expect', jsonb_build_array('P2h')),
    jsonb_build_object('id', 'MU-17', 'what', 'ถอด unique index ค่าเริ่มทั่วไป (default 2 ตัวได้)', 'ddl',
      'drop index analytics.uq_job_record_profile_default', 'expect', jsonb_build_array('P2e')),
    jsonb_build_object('id', 'MU-18', 'what', 'ถอด CHECK job_done_ck (UPDATE done ตรงโดยไม่มีน้ำหนักสุทธิผ่าน)', 'ddl',
      'alter table analytics.job drop constraint job_done_ck', 'expect', jsonb_build_array('P8c', 'G5', 'P7f')),
    jsonb_build_object('id', 'MU-19', 'what', 'job_profile_apply ไม่คำนวณ job.weigh_required ใหม่ตามขั้น', 'fn', 'job_profile_apply',
      'from', 'weigh_required = exists (select 1 from analytics.job_stage s where s.job_id = p_job_id and s.weigh_required)', 'to', 'weigh_required = weigh_required', 'expect', jsonb_build_array('B2a')),
    jsonb_build_object('id', 'MU-21', 'what', 'job_plan_basis_assert ไม่ตรวจ target_source (ค่ามั่วผ่าน)', 'fn', 'job_plan_basis_assert',
      'from', 'or (p.metal_plan_basis ->> ''target_source'') not in (''quote'', ''product'', ''input'') then', 'to', 'or false then', 'expect', jsonb_build_array('GB3e')),
    jsonb_build_object('id', 'MU-22', 'what', 'job_plan_basis_assert ไม่ตรวจเหตุผลของ override', 'fn', 'job_plan_basis_assert',
      'from', 'if v_ov = ''number'' and not coalesce(analytics.oem_note_present(p.metal_plan_basis ->> ''override_reason''), false) then', 'to', 'if false then', 'expect', jsonb_build_array('GB3d')),
    jsonb_build_object('id', 'MU-23', 'what', 'job_plan_formula สูตรผิด (ไม่คูณก้านต้น)', 'fn', 'job_plan_formula',
      'from', 'round(p_qty * p_target * (1 + p_sprue_pct / 100), 3)', 'to', 'round(p_qty * p_target, 3)', 'expect', jsonb_build_array('GF')),
    jsonb_build_object('id', 'MU-24', 'what', 'job_guard UPDATE ไม่เรียก job_plan_basis_assert (plan_drift รั่วตอนแก้)', 'fn', 'job_guard',
      'from', E'  perform analytics.job_plan_basis_assert(new);\n  if new.status', 'to', E'  null;\n  if new.status', 'expect', jsonb_build_array('GB3a', 'GB3c')),
    jsonb_build_object('id', 'MU-25', 'what', 'job_guard INSERT ไม่เรียก job_plan_basis_assert (INSERT ตรงใส่ plan_g ไม่ตรง basis ได้)', 'fn', 'job_guard',
      'from', E'    perform analytics.job_plan_basis_assert(new);\n    if new.product_id', 'to', E'    null;\n    if new.product_id', 'expect', jsonb_build_array('GB6b')),
    jsonb_build_object('id', 'MU-26', 'what', 'job_profile_set ไม่ดู event stage_receive (ย้อนขั้นจน pending แล้วเปลี่ยนแบบได้)', 'fn', 'job_profile_set',
      'from', E'     or exists (select 1 from analytics.job_event e where e.job_id = p_job_id and e.event_type = ''stage_receive'') then', 'to', E'     or false then', 'expect', jsonb_build_array('P4d')),
    jsonb_build_object('id', 'MU-20', 'what', 'job_record_profile_set_default scope gold ไปตั้ง is_default (ทั่วไป) แทน', 'fn', 'job_record_profile_set_default',
      'from', 'update analytics.job_record_profile set is_default_gold = true, updated_by = v_actor where id = p_id and not is_default_gold;', 'to', 'update analytics.job_record_profile set is_default = true, updated_by = v_actor where id = p_id and not is_default;', 'expect', jsonb_build_array('P2d'))
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

  create temp table _v176_orig on commit drop as
    select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h
      from pg_proc p where p.pronamespace = 'analytics'::regnamespace and (p.proname like 'job\_%' or p.proname like 'worker\_%');

  v_snap0 := pg_temp.snap(); v_d0 := pg_temp.snap_d();
  v_s := pg_temp.run_all(v_shop, v_tpl);
  v_log := v_log || v_s;
  v_log := v_log || pg_temp.chk('K0', 'หลังรัน: แถวตารางใบงาน/ช่าง/ตัวนับ/แบบการบันทึก + ตาราง OEM/ผลิต/สต็อก (นับ + md5) เท่าก่อนรันเป๊ะ — ไม่ทิ้งข้อมูล', pg_temp.snap() = v_snap0);
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

  select count(*) into v_cnt from _v176_orig o where md5(pg_get_functiondef(to_regprocedure(o.sig))) = o.h;
  v_log := v_log || pg_temp.chk('MY', format('หลังรัน mutant: md5 definition ของฟังก์ชัน job_*/worker_* ทั้ง %s ตัวเท่าเดิม · trigger ใบงาน/แบบเปิดครบ · constraint/index ที่ถอดใน mutant กลับมาครบ', (select count(*) from _v176_orig)),
    v_cnt = (select count(*) from _v176_orig)
    and not exists (select 1 from pg_trigger t where t.tgrelid in ('analytics.job'::regclass, 'analytics.job_stage'::regclass, 'analytics.job_event'::regclass, 'analytics.job_token'::regclass,
                                                                 'analytics.worker'::regclass, 'analytics.worker_audit'::regclass, 'analytics.job_record_profile'::regclass,
                                                                 'analytics.job_record_profile_stage'::regclass) and not t.tgisinternal and t.tgenabled <> 'O')
    and exists (select 1 from pg_constraint where conrelid = 'analytics.job'::regclass and conname = 'job_done_ck')
    and exists (select 1 from pg_indexes where schemaname = 'analytics' and indexname = 'uq_job_record_profile_default')
    and exists (select 1 from pg_trigger where tgname = 'trg_job_record_profile_default_required'));
  v_s := pg_temp.run_all(v_shop, v_tpl);
  v_fail := (length(v_s) - length(replace(v_s, '[FAIL]', ''))) / 6;
  v_log := v_log || pg_temp.chk('MZ', 'หลังคืนของเดิม: ชุดเทสต์หลักรันซ้ำ FAIL ' || v_fail, v_fail = 0);
  if v_fail > 0 then
    v_log := v_log || (select string_agg('    (รันซ้ำ) ' || l, E'\n') from unnest(string_to_array(v_s, E'\n')) l where l like '[FAIL]%') || E'\n';
  end if;
  v_log := v_log || pg_temp.chk('K0c', 'state ไม่ขยับหลังรัน mutant ทั้งหมด' || coalesce((select ' ขยับ: ' || string_agg(split_part(a, '=', 1), ',') from unnest(string_to_array(v_d0, E'
')) a where a <> '' and not (a = any (string_to_array(pg_temp.snap_d(), E'
')))), ''), pg_temp.snap() = v_snap0);

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_skip := (length(v_log) - length(replace(v_log, '[SKIP]', ''))) / 6;
  v_log := v_log || format(E'\n=== สรุป: [OK] ~%s · [FAIL] ทั้งไฟล์ = %s · [SKIP] = %s %s ===\n', v_ok_cnt, v_fail, v_skip, case when v_fail = 0 then '(ผ่าน)' else '(ไม่ผ่าน)' end);
  raise exception E'%', v_log;
end $v176$;
