-- scripts/verify/verify-0174.sql
-- ตรวจ supabase/migrations/0174_job_tracking_hardening2.sql (security รอบ 2: N1-N4 + งบ atomic · QA N1 N3) หลัง apply (หรือต่อท้ายไฟล์ 0174 ใน dry-run เดียว)
-- self-rolling-back (3j-migration-traps ข้อ 11) · ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน · รอบแรก = ของจริง · รอบถัดไป = mutant 10 จุด · ปิดท้ายตรวจ state ไม่ขยับ
-- 🔴 ไม่สร้างใบเสนอราคา OEM จริง/ไม่ commit อะไร: ใบเสนอราคา = โคลนจากรายการจริง 1 รายการเป็นแม่แบบ (แถวทดสอบใหม่ใน subtransaction ที่ถอยกลับ) · ใบงานผลิตใช้ใบผลิตที่สร้างใน tx
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0174.sql
-- dry-run ก่อน apply: cat supabase/migrations/0174_job_tracking_hardening2.sql scripts/verify/verify-0174.sql > tmp.sql แล้วรันไม่ใส่ --commit
--
-- ============ ตารางแมป "ข้อในบรีฟรอบ 3 -> เทสต์" ============
--  1 N1 ทองชั่งแบบไม่รู้คำตอบ: resolve ทอง prev=null (R1a) · เงิน/ทองเหลืองได้ prev (R1b) · mismatch ไม่บอกขนาด/ไม่มีตัวเลข/ไม่มี gap_g (R2a) ·
--     event ทุกครั้งที่ไม่ตรง (R2b) · handoff_mismatch_count บนบอร์ด (R2c) · ช่องทางออฟฟิศ raise (event ถอยกลับ) + ต่าง 0.05 ผ่านและผลสำเร็จไม่บอก gap ของทอง (R2d)  · MU-A MU-B MU-C
--  2 N2 login สำเร็จไม่ล้างตัวนับ: ผิด 4 สลับถูก → ล็อกที่ครั้งที่ 5 (R3a) · หลังปลดล็อกชั่วคราวตัวนับยังอยู่ (R3b) · หมดเองตาม 24 ชม. (R3c) · unlock/pin_set ล้าง (R3d) · pin_warning (R4a R4b) · MU-D
--  3 N3 ถังแยก: resolve 130 ครั้ง ไม่ทำให้ช่างตัวจริง login/รับงานไม่ได้ (R5) · MU-E   (ขีด 120/60 แต่ละถังครอบด้วย verify-0172 T17n/T17n2)
--  4 N4 เทียบเฉพาะสองขั้นบังคับชั่ง: เทียน/ปูน→หล่อไม่เทียบ + view null (R6a) · หล่อ→ตัดต้นยังเทียบ (R6b) · MU-F
--  5 QA-N1 prev_not_sent จาก resolve: เงินขั้นบังคับชั่ง (Q1a) · ส่งแล้ว=receive (Q1b) · ไม่บังคับชั่ง=receive+held_by (Q1c) · ทองทุกขั้น (Q1d) · MU-G
--  6 QA-N3 ห้าม < >: ชื่อช่าง (Q3a Q3b) · ชื่อใบงาน OEM สร้าง/แก้ (Q3c) · ใบผลิต (Q3d) · MU-H
--  7 งบ atomic: จอง/เต็ม/คืนช่อง (B1) · 19 ผิด + ถูก 3 ไม่กินงบ + ครั้งที่ 20 ได้ + 21 บล็อก (B2) · MU-I MU-J     ⚠️ พร้อมกันจริง 2 connection ทดสอบใน do-block ไม่ได้ — พิสูจน์ที่ semantics ของคำสั่งเดียว (insert .. on conflict .. where hits < max)
--  G สิทธิ์/overload: G1 · K ตัวนับใบงาน/ใบผลิต = max(seq) หลังจบ
--  R regression: verify-0172 (ปรับเคสที่พฤติกรรมเปลี่ยน: T17f T17n→T17n+T17n2 N11) · verify-0173 (P5a M1a M1b M1g M2v NM04 NM16) · verify-0163..0171
--  ⚠️ ที่เทสต์ครอบไม่ได้: PostgREST จริง · UI · race จริงหลาย connection · เวลาจริง (จำลองด้วยการแก้ locked_until/failed_window_start ตรง) · bcrypt timing

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

-- ============================================================================
-- Section B — วงจรขั้นตอน: ลำดับ(#1) น้ำหนัก(#2,#8) จำนวน(#3) ย้อนขั้น(#4) วันที่(#9) ปิดงาน(#10) + เคสต้องไม่พัง


-- helper: รันคำสั่งภายใต้ role ที่ระบุ (SET LOCAL ROLE) -> 'OK' หรือ 'ERR:<sqlstate>:<msg>' แล้วกลับ role เดิมเสมอ
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

-- ============================================================================
-- Section A (verify-0174) — N1 (ทองชั่งแบบไม่รู้คำตอบ + event) · N2 · N3 · N4 · QA-N1 · QA-N3 · งบ atomic
--   ใบเสนอราคา = โคลนจากรายการจริง 1 รายการเป็นแม่แบบ (แถวทดสอบใหม่ในทรานแซกชัน) — ไม่ยิงสร้างใบงานจากใบเสนอราคาจริง
-- ============================================================================
create function pg_temp.sa(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log   text := '';
  v_actor constant uuid := '00000000-0000-0000-0000-0000000000a1';
  v_today date := analytics.job_today();
  jg uuid; js uuid; jb uuid; jx uuid; jw uuid; jgw uuid; j7 uuid; jl uuid; jp uuid; j6 uuid; jy uuid; jz uuid;
  tg text; ts text; th text; th2 text; tw text; tgw text; t7 text; t6 text; ty text;
  wa uuid; wb uuid; wx uuid; wy uuid; ws uuid[];
  sa text; sb text; s6a text; s6b text; sw text; sgw text; s7a text; s7b text; sess text;
  r jsonb; r2 jsonb; r3 jsonb; m jsonb; d jsonb;
  v_ok boolean; v_ev1 int; v_ev2 int; v_n int; v_s text; v_po jsonb; v_poi uuid; v_prod uuid; i int; k int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  wa := pg_temp.wid(p_shop, 'v174-เอ', '4829');
  wb := pg_temp.wid(p_shop, 'v174-บี', '7351');

  -- ---------- N1: ทอง resolve ไม่ได้ prev · เงิน/ทองเหลืองได้ ----------
  jg := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'gold', 10));
  tg := pg_temp.newtok(p_shop, jg);
  sa := pg_temp.login(tg, wa, '4829') ->> 'session_hash';
  sb := pg_temp.login(tg, wb, '7351') ->> 'session_hash';
  r := pg_temp.o_run(p_shop, jg, 1, 3, v_today);
  r2 := pg_temp.w_recv(tg, sa, 4, 9.900);
  m := pg_temp.w_send(tg, sa, 4, 9.800);
  r3 := pg_temp.w_res(tg, sb);
  v_log := v_log || pg_temp.chk('R1a', 'N1: งานทอง: ช่างผู้รับ resolve ได้ next_action=receive แต่ prev_weight_out_g = null (ชั่งแบบไม่รู้คำตอบ) · payload ทั้งก้อนไม่มีน้ำหนักขั้นก่อน (9.8)',
    (r2 ->> 'ok') = 'true' and (m ->> 'ok') = 'true' and (r3 ->> 'next_action') = 'receive' and (r3 -> 'action_stage' ->> 'code') = 'cut_sprue'
    and (r3 ->> 'prev_weight_out_g') is null and position('9.8' in r3::text) = 0);
  js := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'silver', 10));
  ts := pg_temp.newtok(p_shop, js);
  s6a := pg_temp.login(ts, wa, '4829') ->> 'session_hash';
  s6b := pg_temp.login(ts, wb, '7351') ->> 'session_hash';
  r := pg_temp.o_run(p_shop, js, 1, 3, v_today);
  r2 := pg_temp.w_recv(ts, s6a, 4, 9.900);
  m := pg_temp.w_send(ts, s6a, 4, 9.800);
  r3 := pg_temp.w_res(ts, s6b);
  jb := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'brass', 10));
  r := pg_temp.o_run(p_shop, jb, 1, 4, v_today);
  tw := pg_temp.newtok(p_shop, jb);
  r2 := pg_temp.w_res(tw, pg_temp.login(tw, wb, '7351') ->> 'session_hash');
  v_log := v_log || pg_temp.chk('R1b', 'N1: เงินและทองเหลืองคงส่ง prev_weight_out_g ตามเดิม (9.800) ให้ UI เตือนเกิน 20%', (r3 ->> 'next_action') = 'receive' and (r3 ->> 'prev_weight_out_g')::numeric = 9.8
    and (r2 ->> 'prev_weight_out_g')::numeric = 9.9);

  -- ---------- N1: mismatch ทอง ไม่บอกขนาด + event ทุกครั้ง ----------
  select count(*) into v_ev1 from analytics.job_event where job_id = jg;
  r3 := pg_temp.w_recv(tg, sb, 5, 9.860);
  select count(*) into v_ev2 from analytics.job_event where job_id = jg;
  v_log := v_log || pg_temp.chk('R2a', 'N1: ทองรับ 9.860 (ขั้นก่อนส่ง 9.800) ถูกปฏิเสธ handoff_mismatch · ข้อความ "ชั่งใหม่ ถ้ายังไม่ตรงให้แจ้งออฟฟิศ" ไม่มีตัวเลขใดเลย · ผลลัพธ์ไม่มี gap_g/prev_weight_out_g · ขั้นไม่ขยับ',
    (r3 ->> 'code') = 'handoff_mismatch' and (r3 ->> 'ok') = 'false' and (r3 ->> 'message') = 'น้ำหนักที่รับไม่ตรงกับที่ขั้นก่อนส่งมา — ชั่งใหม่ ถ้ายังไม่ตรงให้แจ้งออฟฟิศ'
    and r3::text !~ '[0-9]\.[0-9]' and not (r3 ? 'gap_g') and not (r3 ? 'prev_weight_out_g') and pg_temp.st(jg) like '%,4:sen,5:pen%');
  v_log := v_log || pg_temp.chk('R2b', 'N1: บันทึก job_event (event_type weigh · payload.kind=handoff_mismatch · stage, weight_in, prev_out, gap) ให้ออฟฟิศ — เพิ่ม 1 ครั้งต่อความพยายาม ระบุช่างและช่องทาง worker_qr',
    v_ev2 = v_ev1 + 1 and exists (select 1 from analytics.job_event e where e.job_id = jg and e.event_type = 'weigh' and e.payload ->> 'kind' = 'handoff_mismatch'
         and e.payload ->> 'stage_code' = 'cut_sprue' and (e.payload ->> 'weight_in_g')::numeric = 9.86 and (e.payload ->> 'prev_weight_out_g')::numeric = 9.8
         and (e.payload ->> 'gap_g')::numeric = 0.06 and e.worker_id = wb and e.channel = 'worker_qr'));
  r3 := pg_temp.w_recv(tg, sb, 5, 9.700);
  r3 := pg_temp.w_recv(tg, sb, 5, 9.900);
  v_log := v_log || pg_temp.chk('R2c', 'N1: ผิดซ้ำ 3 ครั้ง (9.860 / 9.700 / 9.900) → บอร์ด v_job_board.handoff_mismatch_count = 3 · ใบอื่นเป็น 0',
    (select b.handoff_mismatch_count = 3 from analytics.v_job_board b where b.id = jg) and (select b.handoff_mismatch_count = 0 from analytics.v_job_board b where b.id = js));
  select count(*) into v_ev1 from analytics.job_event where job_id = jg;
  r3 := pg_temp.o_recv(p_shop, jg, 5, v_today, 9.500, null, 'ออฟฟิศ');
  select count(*) into v_ev2 from analytics.job_event where job_id = jg;
  r2 := pg_temp.w_recv(tg, sb, 5, 9.850);
  v_log := v_log || pg_temp.chk('R2d', 'ช่องทางออฟฟิศถูกปฏิเสธ (hint handoff_mismatch) และ raise → event ของครั้งนั้นถอยกลับ (ออฟฟิศเห็น error เอง) · ต่าง 0.05 พอดีผ่าน ข้อความสำเร็จไม่บอกส่วนต่างของทอง',
    pg_temp.code(r3) = 'handoff_mismatch' and v_ev2 = v_ev1 and (r2 ->> 'ok') = 'true' and (r2 ->> 'handoff_gap_g') is null);

  -- ---------- N4: เทียบเฉพาะเมื่อทั้งสองขั้นบังคับชั่ง ----------
  j6 := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'gold', 10));
  t6 := pg_temp.newtok(p_shop, j6);
  s6a := pg_temp.login(t6, wa, '4829') ->> 'session_hash';
  r := pg_temp.o_run(p_shop, j6, 1, 3, v_today);                       -- ปูน (ไม่บังคับชั่ง) ส่งออก 9.900
  r2 := pg_temp.w_recv(t6, s6a, 4, 9.000);                              -- หล่อ (บังคับชั่งทอง) รับ 9.000 ต่างจากขั้นปูน 0.9 g
  v_log := v_log || pg_temp.chk('R6a', 'N4: ทอง ขั้นหล่อรับ 9.000 หลังขั้นปูน (ไม่บังคับชั่ง) ส่งออก 9.900 → ไม่เทียบ ผ่านได้ · v_job_stage_loss.handoff_gap_g ของขั้นหล่อ = null',
    (r2 ->> 'ok') = 'true' and (select l.handoff_gap_g is null from analytics.v_job_stage_loss l where l.job_id = j6 and l.stage_code = 'cast'));
  m := pg_temp.w_send(t6, s6a, 4, 8.900);
  r3 := pg_temp.w_recv(t6, s6a, 5, 8.800);
  v_log := v_log || pg_temp.chk('R6b', 'N4: ทองหล่อ → ตัดต้น (บังคับชั่งทั้งคู่) ยังเทียบ: 8.900 → 8.800 ต่าง 0.1 ถูกปฏิเสธ handoff_mismatch', (m ->> 'ok') = 'true' and (r3 ->> 'code') = 'handoff_mismatch');

  -- ---------- N2: login สำเร็จไม่ล้างตัวนับ ----------
  jx := pg_temp.jid(pg_temp.mkpjob(p_shop));
  th := pg_temp.newtok(p_shop, jx);
  wx := pg_temp.wid(p_shop, 'v174-ช่างx', '3957');
  v_ok := true; v_s := '';
  for i in 1 .. 4 loop
    r := pg_temp.login(th, wx, '1357');
    v_s := v_s || (r ->> 'attempts_left') || ',';
    v_ok := v_ok and (r ->> 'code') = 'bad_credentials' and (pg_temp.login(th, wx, '3957') ->> 'ok') = 'true';
  end loop;
  r := pg_temp.login(th, wx, '1357');
  v_log := v_log || pg_temp.chk('R3a', 'N2: ผิด 4 สลับกับ login ถูกทุกครั้ง แล้วผิดครั้งที่ 5 → ต้องล็อก (locked 900) · attempts_left ตามนับสะสม ' || v_s || ' · login ถูกไม่ล้างตัวนับ',
    v_ok and v_s = '4,3,2,1,' and (r ->> 'code') = 'locked' and (r ->> 'retry_after_seconds') = '900' and (select failed_attempts = 5 and failed_window_start is not null from analytics.worker where id = wx));
  update analytics.worker set locked_until = now() - interval '1 second' where id = wx;
  r := pg_temp.login(th, wx, '3957');
  r2 := pg_temp.login(th, wx, '1357');
  v_log := v_log || pg_temp.chk('R3b', 'N2: ล็อก 15 นาทีหมดแล้ว login ถูก → ปลดล็อกชั่วคราว (locked_until null) แต่ failed_attempts ยัง 5 → ผิดต่อเป็นครั้งที่ 6 (เหลือ 4 ก่อนล็อก 1 ชม.)',
    (r ->> 'ok') = 'true' and (r2 ->> 'attempts_left') = '4' and (select failed_attempts = 6 and locked_until is null from analytics.worker where id = wx));
  -- ล้างได้เฉพาะ unlock / pin_set / หน้าต่างหมด 24 ชม.
  update analytics.worker set failed_window_start = now() - interval '25 hours' where id = wx;
  r := pg_temp.login(th, wx, '1357');
  v_log := v_log || pg_temp.chk('R3c', 'N2: หน้าต่างครบ 24 ชม. → ผิดครั้งถัดไปนับใหม่ที่ 1 (เหลือ 4)', (r ->> 'attempts_left') = '4' and (select failed_attempts = 1 from analytics.worker where id = wx));
  r := pg_temp.q(format('select analytics.worker_unlock(%L, %L, %L)', p_shop, wx, v_actor));
  v_log := v_log || pg_temp.chk('R3d', 'N2: worker_unlock ล้างตัวนับ+หน้าต่าง · worker_pin_set ล้างเช่นกัน', (r ->> 'unlocked') = 'true' and (select failed_attempts = 0 and failed_window_start is null from analytics.worker where id = wx));

  -- ---------- N2: pin_warning ----------
  wy := pg_temp.wid(p_shop, 'v174-ช่างy', '4068');
  jy := pg_temp.jid(pg_temp.mkpjob(p_shop)); ty := pg_temp.newtok(p_shop, jy);
  r := pg_temp.login(ty, wy, '1357'); r := pg_temp.login(ty, wy, '1358');
  v_ok := (select not pin_warning from analytics.v_worker_lock where worker_id = wy);
  r := pg_temp.login(ty, wy, '1359');
  v_log := v_log || pg_temp.chk('R4a', 'N2: v_worker_lock.pin_warning: ผิด 2 ครั้ง = false · ผิดครั้งที่ 3 ในหน้าต่าง = true · service_role อ่านได้',
    v_ok and (select pin_warning from analytics.v_worker_lock where worker_id = wy)
    and pg_temp.as_role('service_role', 'select worker_id, pin_warning from analytics.v_worker_lock') = 'OK');
  update analytics.worker set failed_window_start = now() - interval '25 hours' where id = wy;
  v_log := v_log || pg_temp.chk('R4b', 'N2: หน้าต่างหมดอายุแล้ว pin_warning = false', (select not pin_warning from analytics.v_worker_lock where worker_id = wy));

  -- ---------- N3: ถัง resolve แยกจากถัง PIN/เขียน ----------
  jz := pg_temp.jid(pg_temp.mkpjob(p_shop));
  th2 := pg_temp.newtok(p_shop, jz);
  v_ok := true; v_n := 0;
  for i in 1 .. 130 loop
    m := pg_temp.w_res(th2);
    if (m ->> 'code') = 'rate_limited' then v_n := v_n + 1; end if;
  end loop;
  r := pg_temp.login(th2, wa, '4829');
  sess := r ->> 'session_hash';
  r2 := pg_temp.w_recv(th2, sess, 1);
  v_log := v_log || pg_temp.chk('R5', 'N3: คนโหลดหน้าซ้ำ 130 ครั้ง (resolve ถูกจำกัดที่ครั้งที่ 121 → 10 ครั้งโดนปฏิเสธ) ช่างตัวจริง login ด้วย PIN ถูก และรับงานได้ตามปกติ (ถัง tok: แยก)',
    v_n = 10 and (r ->> 'ok') = 'true' and (r2 ->> 'ok') = 'true'
    and (select hits from analytics.worker_rate_limit where key = 'tok:' || left(th2, 32) order by window_start desc limit 1) <= 3);

  -- ---------- QA-N1: prev_not_sent ตั้งแต่ resolve ----------
  j7 := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'silver', 10));
  t7 := pg_temp.newtok(p_shop, j7);
  s7a := pg_temp.login(t7, wa, '4829') ->> 'session_hash';
  s7b := pg_temp.login(t7, wb, '7351') ->> 'session_hash';
  r := pg_temp.o_run(p_shop, j7, 1, 3, v_today);
  r2 := pg_temp.w_recv(t7, s7a, 4, 9.900);
  r3 := pg_temp.w_res(t7, s7b);
  m := pg_temp.w_recv(t7, s7b, 5, 9.900);
  v_log := v_log || pg_temp.chk('Q1a', 'QA-N1: เงิน: A ถือขั้นหล่อ (บังคับชั่ง) ยังไม่ส่ง → B resolve ได้ next_action=prev_not_sent ตั้งแต่ resolve (ไม่ใช่ receive) และ held_by=ชื่อ A · กดรับก็ได้ prev_not_sent เหมือนกัน',
    (r2 ->> 'ok') = 'true' and (r3 ->> 'next_action') = 'prev_not_sent' and (r3 ->> 'held_by') = 'v174-เอ' and (m ->> 'code') = 'prev_not_sent');
  m := pg_temp.w_send(t7, s7a, 4, 9.900);
  r3 := pg_temp.w_res(t7, s7b);
  v_log := v_log || pg_temp.chk('Q1b', 'QA-N1: A ส่งพร้อมน้ำหนักแล้ว B resolve = receive', (m ->> 'ok') = 'true' and (r3 ->> 'next_action') = 'receive');
  jw := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'silver', 10));
  tw := pg_temp.newtok(p_shop, jw);
  sw := pg_temp.login(tw, wa, '4829') ->> 'session_hash';
  r := pg_temp.w_recv(tw, sw, 1);
  r3 := pg_temp.w_res(tw, pg_temp.login(tw, wb, '7351') ->> 'session_hash');
  v_log := v_log || pg_temp.chk('Q1c', 'QA-N1: ขั้นก่อนไม่บังคับชั่ง (ฉีดเทียน) ยังไม่ส่ง → resolve = receive + held_by (ให้ UI ถามยืนยันปิดขั้นให้) ไม่ใช่ prev_not_sent', (r ->> 'ok') = 'true' and (r3 ->> 'next_action') = 'receive' and (r3 ->> 'held_by') = 'v174-เอ');
  jgw := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'gold', 10));
  tgw := pg_temp.newtok(p_shop, jgw);
  sgw := pg_temp.login(tgw, wa, '4829') ->> 'session_hash';
  r := pg_temp.w_recv(tgw, sgw, 1);
  r3 := pg_temp.w_res(tgw, pg_temp.login(tgw, wb, '7351') ->> 'session_hash');
  v_log := v_log || pg_temp.chk('Q1d', 'QA-N1: งานทอง ขั้นก่อนแม้ไม่บังคับชั่ง (ขี้ผึ้ง) ยังไม่ส่ง → prev_not_sent (ทองห้าม auto-close ทุกขั้น)', (r ->> 'ok') = 'true' and (r3 ->> 'next_action') = 'prev_not_sent');

  -- ---------- QA-N3: ห้าม < > ----------
  v_ok := true;
  foreach v_s in array array['<script>alert(1)</script>', 'a>b', '<b>x</b>', 'x<y'] loop
    r := pg_temp.wu(p_shop, v_s, '', '8642');
    v_ok := v_ok and (r ->> '_state') = '22023' and (r ->> '_hint') in ('text_invalid') and not (r ? 'id');
  end loop;
  v_log := v_log || pg_temp.chk('Q3a', 'QA-N3: ชื่อช่างที่มี < หรือ > (เช่น <script>) ถูกปฏิเสธ text_invalid ทั้งสร้างใหม่ · ชื่อมี & " # ( ) ผ่าน',
    v_ok and (pg_temp.wu(p_shop, 'ช่าง A&B (สาย #1) "ทอง"', '', '8642') ->> 'id') is not null);
  r := pg_temp.q(format('select analytics.worker_upsert(p_shop_id=>%L, p_id=>%L, p_display_name=>%L, p_stage_codes=>''{qc}''::text[], p_actor=>%L)', p_shop, wa, '<b>เอ</b>', v_actor));
  v_log := v_log || pg_temp.chk('Q3b', 'QA-N3: แก้ชื่อช่างเดิมเป็นชื่อที่มี < > ก็ถูกปฏิเสธ · ชื่อเดิมไม่เปลี่ยน', (r ->> '_hint') = 'text_invalid' and (select display_name = 'v174-เอ' from analytics.worker where id = wa));
  d := pg_temp.clone_deal(p_tpl, 'silver', 4, null, 'won');
  v_ok := true;
  foreach v_s in array array['<img src=x onerror=alert(1)>', 'แหวน>ลาย', '<script>'] loop
    r := pg_temp.q(format('select analytics.job_create_from_quote_item(%L, %L, %L::text[], null, %L, %L, null, %L)', p_shop, d ->> 'item_id', pg_temp.std(), 'verify เริ่มก่อน', v_s, v_actor));
    v_ok := v_ok and (r ->> '_hint') = 'text_invalid' and not (r ? 'job_id');
  end loop;
  r := pg_temp.q(format('select analytics.job_create_from_quote_item(%L, %L, %L::text[], null, %L, %L, null, %L)', p_shop, d ->> 'item_id', pg_temp.std(), 'verify เริ่มก่อน', 'แหวนลาย A&B (#1)', v_actor));
  jl := pg_temp.jid(r);
  m := pg_temp.q(format('select analytics.job_design_label_set(%L, %L, %L, %L)', p_shop, jl, 'ลาย <i>ใหม่</i>', v_actor));
  r2 := pg_temp.q(format('select analytics.job_design_label_set(%L, %L, %L, %L)', p_shop, jl, 'ลาย B&C "ใหม่"', v_actor));
  v_log := v_log || pg_temp.chk('Q3c', 'QA-N3: ชื่อเรียกใบงาน OEM มี < > ถูกปฏิเสธทั้งตอนสร้างและตอนแก้ (text_invalid) · มี & ผ่าน',
    v_ok and r ? 'job_id' and (m ->> '_hint') = 'text_invalid' and (r2 ->> 'ok') = 'true' and (select design_label = 'ลาย B&C "ใหม่"' from analytics.job where id = jl));
  select p.id into v_prod from public.product p where p.shop_id = p_shop and p.is_active and p.sku !~* '^live' and p.cost_type in ('fixed', 'spot') order by p.sku limit 1;
  v_po := pg_temp.po_save(p_shop, 'verify0174');
  perform analytics.production_order_item_set(p_shop, (v_po ->> 'id')::uuid, v_prod, 3);
  select id into v_poi from analytics.production_order_item where production_order_id = (v_po ->> 'id')::uuid;
  r := pg_temp.q(format('select analytics.job_create_from_production_item(%L, %L, %L::text[], null, %L, null, %L)', p_shop, v_poi, pg_temp.std(), '<x>', v_actor));
  r2 := pg_temp.q(format('select analytics.job_create_from_production_item(%L, %L, %L::text[], null, %L, null, %L)', p_shop, v_poi, pg_temp.std(), 'ชื่อ (ทดสอบ)', v_actor));
  v_log := v_log || pg_temp.chk('Q3d', 'QA-N3: ใบผลิตเข้าสต็อก: ชื่อที่ระบุมี < > ถูกปฏิเสธ · ชื่อปกติผ่าน', (r ->> '_hint') = 'text_invalid' and r2 ? 'job_id');

  -- ---------- งบ atomic ----------
  v_n := analytics.job_budget_take('v174-k', date_trunc('day', now()), 3);
  v_ok := v_n = 1;
  v_n := analytics.job_budget_take('v174-k', date_trunc('day', now()), 3); v_ok := v_ok and v_n = 2;
  v_n := analytics.job_budget_take('v174-k', date_trunc('day', now()), 3); v_ok := v_ok and v_n = 3;
  v_ok := v_ok and analytics.job_budget_take('v174-k', date_trunc('day', now()), 3) is null and analytics.job_budget_take('v174-k', date_trunc('day', now()), 3) is null;
  v_ev1 := (select hits from analytics.worker_rate_limit where key = 'v174-k');
  perform analytics.job_budget_give('v174-k', date_trunc('day', now()));
  v_ok := v_ok and analytics.job_budget_take('v174-k', date_trunc('day', now()), 3) = 3 and analytics.job_budget_take('v174-k', date_trunc('day', now()), 3) is null;
  v_log := v_log || pg_temp.chk('B1', 'งบ atomic: จองช่อง 1,2,3 แล้วเต็ม → null (นับไม่เกิน max แม้เรียกซ้ำ) · hits ค้างที่ 3 · คืนช่อง 1 แล้วจองได้ 1 ครั้งพอดี', v_ok and v_ev1 = 3);
  th := pg_temp.newtok(p_shop, jz);
  ws := array[]::uuid[];
  for i in 1 .. 6 loop
    ws := ws || pg_temp.wid(p_shop, 'v174-งบ' || i, (array['2846', '3957', '4068', '5179', '6280', '7391'])[i]);
  end loop;
  v_ok := true;
  for i in 1 .. 5 loop
    for k in 1 .. 4 loop
      if i * 4 - 4 + k <= 19 then
        r := pg_temp.login(th, ws[i], '9999');
        v_ok := v_ok and (r ->> 'code') = 'bad_credentials';
      end if;
    end loop;
  end loop;
  -- ผิดไปแล้ว 19 · ล็อกอินถูก 3 ครั้ง (ต้องคืนช่อง ไม่กินงบ) · แล้วผิดครั้งที่ 20 ได้ · ครั้งที่ 21 (แม้ถูก) ถูกบล็อก
  v_ok := v_ok and (pg_temp.login(th, ws[6], '7391') ->> 'ok') = 'true' and (pg_temp.login(th, ws[6], '7391') ->> 'ok') = 'true' and (pg_temp.login(th, ws[6], '7391') ->> 'ok') = 'true';
  r := pg_temp.login(th, ws[5], '9999');
  r2 := pg_temp.login(th, ws[6], '7391');
  v_log := v_log || pg_temp.chk('B2', 'งบต่อ token: ผิด 19 + ล็อกอินถูก 3 (คืนช่อง) แล้วผิดครั้งที่ 20 ยังได้ (token_budget_left=0) · ครั้งที่ 21 แม้ใส่ถูกถูกบล็อก token_budget_exhausted · hits = 20',
    v_ok and (r ->> 'code') = 'bad_credentials' and (r ->> 'token_budget_left') = '0' and (r2 ->> 'code') = 'token_budget_exhausted'
    and (select hits = 20 from analytics.worker_rate_limit where key = 'pf:' || left(th, 32) order by window_start desc limit 1));

  -- ---------- สิทธิ์ ----------
  v_log := v_log || pg_temp.chk('G1', 'helper ใหม่ (job_label_clean / job_budget_take / job_budget_give) ไม่มี PUBLIC/anon/authenticated/service_role ถือ EXECUTE · ไม่มี overload · ACL ทุกฟังก์ชัน job_*/worker_* ไม่มี grantee ต้องห้าม',
    not has_function_privilege('service_role', 'analytics.job_label_clean(text,text,integer)', 'execute') and not has_function_privilege('service_role', 'analytics.job_budget_take(text,timestamp with time zone,integer)', 'execute')
    and not has_function_privilege('service_role', 'analytics.job_budget_give(text,timestamp with time zone)', 'execute')
    and not has_function_privilege('anon', 'analytics.job_budget_take(text,timestamp with time zone,integer)', 'execute') and not has_function_privilege('authenticated', 'analytics.job_label_clean(text,text,integer)', 'execute')
    and not exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a where p.pronamespace = 'analytics'::regnamespace and (p.proname like 'job\_%' or p.proname like 'worker\_%')
                     and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole))
    and not exists (select 1 from pg_proc where pronamespace = 'analytics'::regnamespace and (proname like 'job\_%' or proname like 'worker\_%') group by proname having count(*) > 1)
    and pg_temp.as_role('service_role', 'select board_column, handoff_gap_g, handoff_mismatch_count from analytics.v_job_board limit 1') = 'OK'
    and pg_temp.as_role('anon', 'select handoff_mismatch_count from analytics.v_job_board') like 'ERR:42501:%');
  return v_log;
end;
$s$;

-- ============================================================================
-- Driver — รันทุก section แยก subtransaction (ถอยกลับเองหลังแต่ละ section) · ตรวจ state ไม่ขยับ · mutant · รันซ้ำหลังคืนของเดิม
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
      v := coalesce(v, '') || format(E'[FAIL] %s  section ล้มด้วย exception: %s\n   %s\n', p_fn, sqlerrm, left(v_ctx, 400));
    end if;
  end;
  return coalesce(v, '');
end;
$c$;

create function pg_temp.run_all(p_shop uuid, p_tpl uuid) returns text
 language sql as $c$
  select pg_temp.run_sec('sa', p_shop, p_tpl)
$c$;

-- ลายนิ้วมือ state: นับแถวทุกตารางใบงาน + ตัวนับ + ตาราง OEM/ผลิต/สต็อกที่ suite แตะทางอ้อม (ต้องเท่าเดิมหลัง rollback)
create function pg_temp.snap() returns text
 language plpgsql as $c$
declare v text := ''; r record; n text;
begin
  for r in select unnest(array['job', 'job_stage', 'job_event', 'job_token', 'worker', 'worker_audit', 'worker_session', 'worker_rate_limit', 'job_counter', 'job_stage_def',
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


do $v174$
declare
  v_shop uuid; v_tpl uuid;
  v_log text := ''; v_s text; v_fail int; v_snap0 text;
  v_m record; v_killed int := 0; v_total int; v_survived text := ''; v_cnt int; v_id text; v_hit int; v_skip int; v_ok_cnt int;
  v_mutants jsonb := jsonb_build_array(
    jsonb_build_object('id', 'MU-A', 'what', 'resolve งานทองส่ง prev_weight_out_g ให้ผู้รับ (รู้คำตอบก่อนชั่ง)', 'fn', 'job_worker_resolve',
      'from', 'v_prev_w := case when v_job.metal = ''gold'' then null else v_prev.weight_out_g end;', 'to', 'v_prev_w := v_prev.weight_out_g;', 'expect', jsonb_build_array('R1a')),
    jsonb_build_object('id', 'MU-B', 'what', 'ข้อความ mismatch ทองคืน gap_g ให้ช่าง', 'fn', 'job_core_receive',
      'from', 'ถ้ายังไม่ตรงให้แจ้งออฟฟิศ'');', 'to', 'ถ้ายังไม่ตรงให้แจ้งออฟฟิศ'', jsonb_build_object(''gap_g'', v_gap));', 'expect', jsonb_build_array('R2a')),
    jsonb_build_object('id', 'MU-C', 'what', 'ไม่บันทึก event ชนิด weigh เมื่อไม่ตรง (ออฟฟิศไม่เห็น)', 'fn', 'job_core_receive',
      'from', 'perform analytics.job_event_write(p_job_id, v_t.id, ''weigh'',', 'to', 'perform analytics.job_event_write(p_job_id, v_t.id, ''note'',', 'expect', jsonb_build_array('R2b', 'R2c')),
    jsonb_build_object('id', 'MU-D', 'what', 'login สำเร็จล้างตัวนับ (กลับไปเป็นพฤติกรรม 0173)', 'fn', 'worker_pin_verify',
      'from', 'update analytics.worker set locked_until = null where id = v_w.id;', 'to', 'update analytics.worker set failed_attempts = 0, failed_window_start = null, last_failed_at = null, locked_until = null where id = v_w.id;', 'expect', jsonb_build_array('R3a')),
    jsonb_build_object('id', 'MU-E', 'what', 'resolve ใช้ถังเดียวกับ PIN/เขียน (tok:)', 'fn', 'job_worker_auth',
      'from', 'case when p_ip_class = ''none'' then ''tov:'' else ''tok:'' end', 'to', '''tok:''', 'expect', jsonb_build_array('R5')),
    jsonb_build_object('id', 'MU-F', 'what', 'เทียบ handoff แม้ขั้นไม่บังคับชั่ง (เทียน/ปูน vs หล่อ)', 'fn', 'job_core_receive',
      'from', 'and v_t.weigh_required and v_p.weigh_required then', 'to', 'and true then', 'expect', jsonb_build_array('R6a')),
    jsonb_build_object('id', 'MU-G', 'what', 'resolve ไม่ตรวจขั้นก่อนบังคับชั่ง (ส่ง receive แล้วไป fail ตอนกด)', 'fn', 'job_worker_resolve',
      'from', 'elsif v_hold.id is not null and (v_job.metal = ''gold'' or v_hold.weigh_required) then', 'to', 'elsif v_hold.id is not null and (v_job.metal = ''gold'') then', 'expect', jsonb_build_array('Q1a')),
    jsonb_build_object('id', 'MU-H', 'what', 'ชื่อ/ชื่อใบงานมี < > ผ่าน', 'fn', 'job_label_clean',
      'from', 'if v ~ ''[<>]'' then', 'to', 'if false then', 'expect', jsonb_build_array('Q3a', 'Q3c', 'Q3d')),
    jsonb_build_object('id', 'MU-I', 'what', 'งบไม่จำกัด (take ไม่เช็คเพดาน)', 'fn', 'job_budget_take',
      'from', 'where r.hits < p_max', 'to', 'where true', 'expect', jsonb_build_array('B1', 'B2')),
    jsonb_build_object('id', 'MU-J', 'what', 'ใส่ถูกไม่คืนช่อง (ล็อกอินถูกกินงบ)', 'fn', 'job_budget_give',
      'from', 'set hits = greatest(hits - 1, 0)', 'to', 'set hits = hits', 'expect', jsonb_build_array('B1', 'B2')),
    jsonb_build_object('id', 'MU-K', 'what', 'pin_warning ไม่ทำงาน (ตัดเงื่อนไข failed_attempts)', 'ddl',
      'create or replace view analytics.v_worker_lock with (security_invoker = true) as select w.id as worker_id, w.shop_id, w.display_name, w.is_active, w.failed_attempts, w.failed_window_start, w.last_failed_at, w.locked_until, ''none''::text as lock_state, false as in_window, false as pin_warning from analytics.worker w',
      'expect', jsonb_build_array('R4a'))
  );
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select id into v_shop from public.shop order by created_at limit 1;
  -- แม่แบบ: อ่านรายการใบเสนอราคาจริง 1 รายการเพื่อ "โคลน" เป็นใบทดสอบ (สร้างแถวใหม่ในทรานแซกชันที่ถอยกลับ) — ไม่ยิงสร้างใบงานจากใบเสนอราคาจริง
  select i.id into v_tpl from analytics.oem_quote_item i join analytics.oem_quote q on q.id = i.quote_id
   where i.shop_id = v_shop and i.input ->> 'metal' = 'silver' and q.quote_no not like 'V17%' order by q.created_at, i.seq limit 1;
  if v_tpl is null then
    v_log := v_log || '[FAIL] S0  ไม่มี oem_quote_item เงินจริงให้ใช้เป็นแม่แบบโคลน — ชุดทดสอบรันต่อไม่ได้' || E'\n';
    raise exception E'%', v_log;
  end if;

  create temp table _v174_orig on commit drop as
    select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h
      from pg_proc p where p.pronamespace = 'analytics'::regnamespace and (p.proname like 'job\_%' or p.proname like 'worker\_%');

  v_snap0 := pg_temp.snap();
  v_s := pg_temp.run_all(v_shop, v_tpl);
  v_log := v_log || v_s;
  v_log := v_log || pg_temp.chk('K0', 'หลังรัน: แถวตารางใบงาน/ช่าง/ตัวนับ + ตาราง OEM/ผลิต/สต็อก (นับ + md5) เท่าก่อนรันเป๊ะ — ไม่เผา state (ไม่มีใบเสนอราคา OEM/ใบงานค้าง)', v_snap0 = pg_temp.snap());
  v_log := v_log || pg_temp.chk('K1', 'ตัวนับใบงาน = max(seq) ของใบงาน · ตัวนับใบผลิต >= max(seq) ของใบผลิต (ไม่ชนตอนสร้างครั้งถัดไป)',
    (select coalesce(max(last_no), 0) from analytics.job_counter where shop_id = v_shop) = (select coalesce(max(seq), 0) from analytics.job where shop_id = v_shop)
    and coalesce((select last_no from analytics.production_order_counter where shop_id = v_shop), 0) >= (select coalesce(max(seq), 0) from analytics.production_order where shop_id = v_shop));
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
      v_s := pg_temp.run_all(v_shop, v_tpl);
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

  select count(*) into v_cnt from _v174_orig o where md5(pg_get_functiondef(to_regprocedure(o.sig))) = o.h;
  v_log := v_log || pg_temp.chk('MY', format('หลังรัน mutant: md5 definition ของฟังก์ชัน job_*/worker_* ทั้ง %s ตัวเท่าเดิม · trigger ใบงานเปิดครบ · v_worker_lock กลับเป็นของจริง (มี pin_warning จริง)', (select count(*) from _v174_orig)),
    v_cnt = (select count(*) from _v174_orig)
    and not exists (select 1 from pg_trigger t where t.tgrelid in ('analytics.job'::regclass, 'analytics.job_stage'::regclass, 'analytics.job_event'::regclass, 'analytics.job_token'::regclass,
                                                                 'analytics.worker'::regclass, 'analytics.worker_audit'::regclass) and not t.tgisinternal and t.tgenabled <> 'O')
    and pg_get_viewdef('analytics.v_worker_lock'::regclass) like '%failed_attempts >= 3%');
  v_s := pg_temp.run_all(v_shop, v_tpl);
  v_fail := (length(v_s) - length(replace(v_s, '[FAIL]', ''))) / 6;
  v_log := v_log || pg_temp.chk('MZ', 'หลังคืนของเดิม: ชุดเทสต์หลักรันซ้ำ FAIL ' || v_fail, v_fail = 0);
  if v_fail > 0 then
    v_log := v_log || (select string_agg('    (รันซ้ำ) ' || l, E'\n') from unnest(string_to_array(v_s, E'\n')) l where l like '[FAIL]%') || E'\n';
  end if;
  v_log := v_log || pg_temp.chk('K0c', 'state ไม่ขยับหลังรัน mutant ทั้งหมด', pg_temp.snap() = v_snap0);

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_skip := (length(v_log) - length(replace(v_log, '[SKIP]', ''))) / 6;
  v_log := v_log || format(E'\n=== สรุป: [OK] ~%s · [FAIL] ทั้งไฟล์ = %s · [SKIP] = %s %s ===\n', v_ok_cnt, v_fail, v_skip, case when v_fail = 0 then '(ผ่าน)' else '(ไม่ผ่าน)' end);
  raise exception E'%', v_log;
end $v174$;
