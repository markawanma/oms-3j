-- scripts/verify/verify-0173.sql
-- ตรวจ supabase/migrations/0173_job_tracking_hardening.sql (แก้ J1 ตาม security H1 M1 M2 L1 L4 + QA 2 5 6 + มติเจ้าของ 12 ต.ค.) หลัง apply
-- (หรือต่อท้ายไฟล์ 0173 ใน dry-run เดียว) · self-rolling-back (3j-migration-traps ข้อ 11): ทุก section รันใน subtransaction ที่ถอยกลับเอง + raise ปิดท้าย
-- ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน · รอบแรก = ของจริง · รอบถัดไป = mutant 20 จุด (แก้ฟังก์ชัน/constraint จริงใน subtransaction แล้วเรียกชุดเดิม) ·
-- ปิดท้ายตรวจ state ไม่ขยับ (นับแถว + md5 เนื้อหาของตารางใบงาน/ช่าง/ตัวนับ + OEM/ผลิต/สต็อก) และ md5 ฟังก์ชัน job_*/worker_* เท่าเดิมหลัง mutant
-- 🔴 ไม่ยิงสร้างใบงานจากใบเสนอราคาจริงแม้ใน rollback: ใบเสนอราคา = โคลนจากรายการจริง 1 รายการเป็นแม่แบบ (แถวทดสอบใหม่ในทรานแซกชัน) · ใบงานผลิตใช้สินค้า/ใบผลิตที่สร้างใน tx
--   (fixture ซ่อมตัวนับใบผลิต production_order_counter ใน tx ด้วย — บน DB จริงตัวนับตอนนี้ต่ำกว่า seq สูงสุด เจอ 12 ต.ค. แจ้งไว้แล้ว ไม่ได้แก้ข้อมูลจริง)
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0173.sql
-- dry-run ก่อน apply: cat supabase/migrations/0173_job_tracking_hardening.sql scripts/verify/verify-0173.sql > tmp.sql แล้วรันไม่ใส่ --commit
--
-- ============ ตารางแมป "ข้อในบรีฟรอบแก้ -> เทสต์" ============
--  1  H1 PIN ผิดสะสมในหน้าต่าง 24 ชม. · ล็อก 15 นาที/1 ชม./ถาวร · login-pin_set ล้าง window · สาขา infinity แยก locked_office · งบ 20 ครั้ง/token/วัน · attempts_left
--       -> P1 (B1: ผิดแบบเว้นระยะยังนับสะสม) P2 (B2: เกิน 24 ชม. เริ่มใหม่) P3a-P3d (6-9 / 10 / 11-14 / 15 ถาวร ไม่ raise) P5a-P5b P6a-P6c · NM01-NM04 NM16
--       ⚠️ "วัน" ของงบ token ตัดตามเวลาไทย — ทดสอบขอบวันจริงไม่ได้ (now() คงที่ใน tx) · ที่ครอบ = งบต่อ token และ token ใหม่ = งบใหม่
--  2  M1 น้ำหนักส่งมอบ: ทอง > 0.05 g ปฏิเสธ handoff_mismatch (0.06 ตก/0.05 ผ่าน ทั้งสองทิศ ทั้งช่างและออฟฟิศ) · เงิน/ทองเหลืองไม่บล็อก + handoff_gap_g ต่อท้ายสุด + บอร์ด
--       -> M1a-M1g · NM05
--  3  M2 ออฟฟิศเห็น/ปลดล็อก: v_worker_lock + worker_unlock (ไม่ revoke session) -> M2v P4a-P4d · NM15
--  4  L1 held_by null เมื่อไม่มี session -> L1 · NM08
--  5  L4 rate limit: token สุ่มไม่เขียนถัง · ถัง ip นับเฉพาะ write + pin · ล้างแถวเก่าแน่นอน -> L4a-L4c · NM14 NM17 NM18
--  6  QA2 board_column awaiting_close -> Q2a-Q2c · NM07
--  7  QA5 all_done + job_closed เฉพาะ token ที่เคยถูกต้อง (ไม่เปิด oracle) -> Q2b+Q5a Q5b Q5c · NM07 NM09
--  8  QA6 ขั้นบังคับชั่งยังไม่ส่ง -> ไม่ auto-close (prev_not_sent) · ขั้นไม่บังคับ auto-close ตามเดิม -> Q6a-Q6d · NM06
--  9  PIN ซ้ำคู่ · stage_codes ว่างตก · ข้าม QC/แพ็กไม่ได้ (RPC+trigger) · ชื่อช่างผ่านด่านอักขระ -> P8a-P8c P9a-P9b · NM10 NM12 NM13 NM19
--     rate limit IP เลือก "นับเฉพาะ action เขียน + verify PIN" -> L4a (เพดาน 300 เขียน/100 PIN ต่อ 10 นาที ครอบด้วย verify-0172 T17o)
-- 10  ชื่อแบบ OEM: ออฟฟิศตั้งเอง บังคับ · แก้ทีหลังได้ (job_design_label_set) · ผ่านด่านข้อความ · production ไม่บังคับ -> N1a-N1f · NM11 NM20
--  G  สิทธิ์/overload: job_worker_auth ฉบับเก่าถูกถอด · RPC ใหม่ service_role เท่านั้น -> G1 G2 (+ scripts/check-analytics-grants.sql รันแยกหลัง apply)
--  R  regression: verify-0172 (ปรับแล้ว FAIL 0 · mutant 31/31) + verify-0163..0171 รันแยก
--  ⚠️ ที่เทสต์ครอบไม่ได้: PostgREST จริง · UI (Luke) · race จริง 2 connection · เวลาจริง (ล็อก 15 นาที/1 ชม. หมดอายุ → จำลองด้วยการแก้ locked_until/failed_window_start ตรง) ·
--     bcrypt timing · การเดา PIN ข้าม token/ช่าง/IP จำนวนมากในชีวิตจริง

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
create function pg_temp.sp(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log   text := '';
  v_actor constant uuid := '00000000-0000-0000-0000-0000000000a1';
  v_today date := analytics.job_today();
  j jsonb; jid uuid; th text; th2 text;
  w uuid; w2 uuid; w3 uuid; w4 uuid; ws uuid[];
  r jsonb; r2 jsonb; r3 jsonb; m jsonb; lg jsonb; sess text; sessb text;
  v_ok boolean; i int; v_n int; v_s text; v_t text; v_ev int; v_ev2 int;
  v_shop2 uuid;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into public.shop (name) values ('verify0173-shop2') returning id into v_shop2;
  j := pg_temp.mkpjob(p_shop); jid := (j ->> 'job_id')::uuid;
  v_log := v_log || pg_temp.chk('P0', 'fixture ใบงานผลิต (production) สร้างได้ — ไม่แตะใบเสนอราคา', jid is not null);

  -- ---------- B1: ผิดแบบเว้นระยะ ยังนับสะสม -> ล็อกที่ครั้งที่ 5 ----------
  th := pg_temp.newtok(p_shop, jid);
  w := pg_temp.wid(p_shop, 'v173-ช่าง1', '4829');
  r := pg_temp.login(th, w, '1357'); r := pg_temp.login(th, w, '1358'); r := pg_temp.login(th, w, '1359');
  update analytics.worker set last_failed_at = now() - interval '2 hours', failed_window_start = now() - interval '10 hours' where id = w;
  r := pg_temp.login(th, w, '1360');
  r2 := pg_temp.login(th, w, '1361');
  v_log := v_log || pg_temp.chk('P1 (B1)', 'ผิด 3 ครั้ง แล้วเว้นไป 2 ชม. (นานกว่า 15 นาทีที่เคย reset) ผิดต่อ → ยังนับสะสม: ครั้งที่ 4 เหลือ 1 · ครั้งที่ 5 ล็อก 15 นาที (retry 900) · หน้าต่างยังยึดครั้งแรก (ไม่เลื่อน)',
    (r ->> 'attempts_left') = '1' and (r2 ->> 'code') = 'locked' and (r2 ->> 'retry_after_seconds') = '900'
    and (select failed_attempts = 5 and failed_window_start < now() - interval '9 hours' and locked_until > now() from analytics.worker where id = w));
  -- ---------- B2: เกิน 24 ชม. ถึงเริ่มนับใหม่ ----------
  update analytics.worker set locked_until = now() - interval '1 second', failed_window_start = now() - interval '25 hours' where id = w;
  r := pg_temp.login(th, w, '1362');
  v_log := v_log || pg_temp.chk('P2 (B2)', 'หน้าต่างเกิน 24 ชม. → ผิดครั้งถัดไปนับใหม่ที่ 1 (เหลือ 4) และหน้าต่างใหม่เริ่มตอนนี้',
    (r ->> 'attempts_left') = '4' and (select failed_attempts = 1 and failed_window_start > now() - interval '1 minute' from analytics.worker where id = w));

  -- ---------- escalation: 5 -> 15 นาที · 10 -> 1 ชม. · 15 -> ถาวร (locked_office) ----------
  th := pg_temp.newtok(p_shop, jid);
  w2 := pg_temp.wid(p_shop, 'v173-ช่าง2', '2846');
  update analytics.worker set failed_attempts = 5, failed_window_start = now() - interval '1 hour', last_failed_at = now() - interval '1 hour' where id = w2;
  v_ok := true; v_s := '';
  for i in 6 .. 9 loop
    r := pg_temp.login(th, w2, '9' || lpad(i::text, 3, '0'));
    v_s := v_s || (r ->> 'attempts_left') || ',';
    v_ok := v_ok and (r ->> 'code') = 'bad_credentials';
  end loop;
  v_log := v_log || pg_temp.chk('P3a', 'ครั้งที่ 6-9 (หลังล็อก 15 นาทีหมด) ไม่ล็อกซ้ำ: attempts_left นับถอยไปครั้งที่ 10 = ' || v_s, v_ok and v_s = '4,3,2,1,');
  r := pg_temp.login(th, w2, '9010');
  v_log := v_log || pg_temp.chk('P3b', 'ครั้งที่ 10 → ล็อก 1 ชั่วโมง (retry 3600) · locked_until ≈ +1 ชม.', (r ->> 'code') = 'locked' and (r ->> 'retry_after_seconds') = '3600'
    and (select locked_until between now() + interval '59 minutes' and now() + interval '61 minutes' and failed_attempts = 10 from analytics.worker where id = w2));
  v_ok := true;
  for i in 11 .. 14 loop
    update analytics.worker set locked_until = now() - interval '1 second' where id = w2;
    r := pg_temp.login(th, w2, '9' || lpad(i::text, 3, '0'));
    v_ok := v_ok and (r ->> 'code') = 'locked' and (r ->> 'retry_after_seconds') = '3600';
  end loop;
  v_log := v_log || pg_temp.chk('P3c', 'ครั้งที่ 11-14: ผิดทุกครั้งล็อก 1 ชม. ทุกครั้ง', v_ok and (select failed_attempts = 14 from analytics.worker where id = w2));
  update analytics.worker set locked_until = now() - interval '1 second' where id = w2;
  r := pg_temp.login(th, w2, '9015');
  r2 := pg_temp.login(th, w2, '2846');
  r3 := pg_temp.login(th, w2, '9016');
  v_log := v_log || pg_temp.chk('P3d', 'ครั้งที่ 15 → ล็อกถาวร locked_until=infinity: code locked_office (ไม่ raise · ไม่คำนวณ retry จาก infinity) · ใส่ PIN ถูก/ผิดก็ยัง locked_office · ตัวนับไม่เพิ่ม',
    (r ->> 'code') = 'locked_office' and not (r ? '_err') and not (r ? 'retry_after_seconds') and (r2 ->> 'code') = 'locked_office' and (r3 ->> 'code') = 'locked_office'
    and (select locked_until = 'infinity'::timestamptz and failed_attempts = 15 from analytics.worker where id = w2));

  -- ---------- M2: unlock ----------
  th := pg_temp.newtok(p_shop, jid);
  w3 := pg_temp.wid(p_shop, 'v173-ช่าง3', '3957');
  lg := pg_temp.login(th, w3, '3957'); sess := lg ->> 'session_hash';
  update analytics.worker set locked_until = 'infinity'::timestamptz, failed_attempts = 15, failed_window_start = now() - interval '2 hours' where id = w3;
  v_log := v_log || pg_temp.chk('P4a', 'ช่างที่ถูกล็อกถาวรแล้ว: session เดิมยังใช้งานได้ (การล็อกกัน verify PIN ไม่ใช่ตัด session) · ใส่ PIN ใหม่ไม่ได้ locked_office',
    (pg_temp.w_res(th, sess) -> 'viewer' ->> 'display_name') = 'v173-ช่าง3' and (pg_temp.login(th, w3, '3957') ->> 'code') = 'locked_office');
  r := pg_temp.q(format('select analytics.worker_unlock(%L, %L, %L)', p_shop, w3, v_actor));
  v_log := v_log || pg_temp.chk('P4b', 'worker_unlock: ล้างล็อก+ตัวนับ+หน้าต่าง · session เดิมไม่ถูก revoke · login ใหม่ได้ · มี worker_audit action=unlock (ระบุล็อกถาวรไหม) · ไม่มี PIN ใน audit',
    (r ->> 'unlocked') = 'true' and (select locked_until is null and failed_attempts = 0 and failed_window_start is null from analytics.worker where id = w3)
    and (pg_temp.w_res(th, sess) -> 'viewer' ->> 'display_name') = 'v173-ช่าง3' and (pg_temp.login(th, w3, '3957') ->> 'ok') = 'true'
    and exists (select 1 from analytics.worker_audit a where a.worker_id = w3 and a.action = 'unlock' and (a.detail ->> 'was_permanent') = 'true' and a.detail::text !~ '3957'));
  r := pg_temp.q(format('select analytics.worker_unlock(%L, %L, %L)', p_shop, w2, v_actor));
  v_log := v_log || pg_temp.chk('P4c', 'ปลดล็อกช่างที่ติด infinity (w2) ได้ และเข้าด้วย PIN ถูกได้ทันที', (r ->> 'unlocked') = 'true' and (pg_temp.login(th, w2, '2846') ->> 'ok') = 'true');
  v_log := v_log || pg_temp.chk('P4d', 'worker_unlock: ไม่มี actor → actor_required · ช่างร้านอื่น/ไม่มี → worker_not_found · null → 22023 · anon/authenticated เรียกไม่ได้ (42501)',
    pg_temp.code(pg_temp.q(format('select analytics.worker_unlock(%L, %L)', p_shop, w3))) = 'actor_required'
    and pg_temp.code(pg_temp.q(format('select analytics.worker_unlock(%L, %L, %L)', v_shop2, w3, v_actor))) = 'worker_not_found'
    and (pg_temp.q('select analytics.worker_unlock(null, null, null)') ->> '_state') = '22023'
    and pg_temp.as_role('anon', format('select analytics.worker_unlock(%L, %L, %L)', p_shop, w3, v_actor)) like 'ERR:42501:%'
    and pg_temp.as_role('authenticated', format('select analytics.worker_unlock(%L, %L, %L)', p_shop, w3, v_actor)) like 'ERR:42501:%');
  -- login สำเร็จ ล้างหน้าต่าง · worker_pin_set ล้างหน้าต่าง
  w4 := pg_temp.wid(p_shop, 'v173-ช่าง4', '4068');
  th := pg_temp.newtok(p_shop, jid);
  r := pg_temp.login(th, w4, '1111'); r := pg_temp.login(th, w4, '2222'); r := pg_temp.login(th, w4, '3333');
  r2 := pg_temp.login(th, w4, '4068');
  v_log := v_log || pg_temp.chk('P5a', 'ผิด 3 ครั้งแล้ว login สำเร็จ → ตัวนับ + หน้าต่างถูกล้าง (failed_attempts=0, failed_window_start null)',
    (r2 ->> 'ok') = 'true' and (select failed_attempts = 0 and failed_window_start is null from analytics.worker where id = w4));
  update analytics.worker set failed_attempts = 12, failed_window_start = now() - interval '3 hours', locked_until = now() + interval '30 minutes' where id = w4;
  r := pg_temp.q(format('select analytics.worker_pin_set(%L, %L, %L, %L)', p_shop, w4, '5179', v_actor));
  v_log := v_log || pg_temp.chk('P5b', 'worker_pin_set ล้างตัวนับ + หน้าต่าง + การล็อก (และ session เดิมหลุด)',
    (select failed_attempts = 0 and failed_window_start is null and locked_until is null from analytics.worker where id = w4) and (pg_temp.login(th, w4, '5179') ->> 'ok') = 'true');

  -- ---------- งบผิดต่อ token ----------
  th := pg_temp.newtok(p_shop, jid);
  ws := array[]::uuid[];
  for i in 1 .. 6 loop
    ws := ws || pg_temp.wid(p_shop, 'v173-งบ' || i, (array['2846', '3957', '4068', '5179', '6280', '7391'])[i]);
  end loop;
  v_ok := true;
  for i in 1 .. 5 loop
    for v_n in 1 .. 4 loop
      r := pg_temp.login(th, ws[i], '9999');
      v_ok := v_ok and (r ->> 'code') = 'bad_credentials';
    end loop;
  end loop;
  m := pg_temp.login(th, ws[6], '7391');
  r2 := pg_temp.login(th, ws[6], '9999');
  v_log := v_log || pg_temp.chk('P6a', 'งบผิดต่อ token ≤ 20/วัน (กระจาย 5 ช่าง ช่างละ 4 ไม่ถึงล็อก): ครั้งที่ 21 แม้ใส่ PIN ถูกก็ verify ไม่ได้ token_budget_exhausted · ผิดต่อก็เหมือนกัน',
    v_ok and (r ->> 'token_budget_left') = '0' and (m ->> 'code') = 'token_budget_exhausted' and (r2 ->> 'code') = 'token_budget_exhausted'
    and (select count(*) from analytics.worker where id = any (ws) and locked_until is not null) = 0);
  th2 := pg_temp.newtok(p_shop, jid);
  v_log := v_log || pg_temp.chk('P6b', 'พิมพ์ใบงานใหม่ (token ใหม่ = งบใหม่) → ช่างใส่ PIN ถูกเข้าได้ · token เดิมยังโดนบล็อก (ถูกเพิกถอนแล้ว → invalid_token)',
    (pg_temp.login(th2, ws[6], '7391') ->> 'ok') = 'true' and (pg_temp.login(th, ws[6], '7391') ->> 'code') = 'invalid_token');
  r := pg_temp.login(pg_temp.newtok(p_shop, jid), pg_temp.wid(p_shop, 'v173-ช่าง6', '8642'), '9999');
  v_log := v_log || pg_temp.chk('P6c', 'ผิดครั้งแรกของ token ใหม่ + ช่างใหม่: รายงาน token_budget_left=19 และ attempts_left=4 (UI เตือนตั้งแต่ครั้งที่ 3 ได้)',
    (r ->> 'token_budget_left') = '19' and (r ->> 'attempts_left') = '4');

  -- ---------- v_worker_lock ----------
  update analytics.worker set failed_attempts = 5, failed_window_start = now(), locked_until = now() + interval '10 minutes' where id = ws[2];
  update analytics.worker set locked_until = 'infinity'::timestamptz where id = ws[3];
  update analytics.worker set locked_until = null, failed_attempts = 0 where id = ws[4];
  v_log := v_log || pg_temp.chk('M2v', 'v_worker_lock ให้ออฟฟิศเห็นสถานะ: temporary / office (ล็อกถาวร) / none · service_role อ่านได้ · ไม่มีคอลัมน์ pin_hash',
    (select lock_state from analytics.v_worker_lock where worker_id = ws[2]) = 'temporary' and (select lock_state from analytics.v_worker_lock where worker_id = ws[3]) = 'office'
    and (select lock_state from analytics.v_worker_lock where worker_id = ws[4]) = 'none'
    and pg_temp.as_role('service_role', 'select worker_id, lock_state, failed_attempts, locked_until from analytics.v_worker_lock') = 'OK'
    and not exists (select 1 from information_schema.columns where table_schema = 'analytics' and table_name = 'v_worker_lock' and column_name like '%pin%')
    and pg_temp.as_role('anon', 'select * from analytics.v_worker_lock') like 'ERR:42501:%');

  -- ---------- ข้อสังเกต QA: PIN / stage_codes / ชื่อ / ข้าม QC-แพ็ก ----------
  v_ok := true;
  foreach v_s in array array['1212', '1313', '2323', '0101', '5656', '9898'] loop
    v_ok := v_ok and pg_temp.code(pg_temp.wu(p_shop, 'v173-pin' || v_s, '', v_s)) = 'pin_invalid';
  end loop;
  v_log := v_log || pg_temp.chk('P8a', 'PIN รูปซ้ำคู่ (1212 1313 2323 0101 5656 9898) ถูกปฏิเสธ pin_invalid · รูปปกติ (1357) ผ่าน', v_ok and (pg_temp.wu(p_shop, 'v173-pinok', '', '1357') ->> 'id') is not null);
  v_log := v_log || pg_temp.chk('P8b', 'worker_upsert ปฏิเสธ stage_codes ว่าง ทั้งสร้างใหม่และแก้ช่างเดิม (stages_required) — ไม่มี "ว่าง = ทุกขั้น" อีก',
    pg_temp.code(pg_temp.q(format('select analytics.worker_upsert(p_shop_id=>%L, p_display_name=>%L, p_stage_codes=>''{}''::text[], p_pin=>%L, p_actor=>%L)', p_shop, 'v173-ว่าง', '8642', v_actor))) = 'stages_required'
    and pg_temp.code(pg_temp.q(format('select analytics.worker_upsert(p_shop_id=>%L, p_id=>%L, p_display_name=>%L, p_actor=>%L)', p_shop, w4, 'v173-ช่าง4', v_actor))) = 'stages_required'
    and pg_temp.code(pg_temp.q(format('select analytics.worker_upsert(p_shop_id=>%L, p_display_name=>%L, p_stage_codes=>null, p_pin=>%L, p_actor=>%L)', p_shop, 'v173-null', '8642', v_actor))) = 'stages_required');
  v_ok := true;
  foreach v_s in array array[E'v173‮evil', E'v173\u0007bell', E'v173​z', E'v173 line', '   ', repeat('ก', 61), E'v173\nnewline'] loop
    v_ok := v_ok and (pg_temp.wu(p_shop, v_s, '', '8642') ->> '_state') = '22023';
  end loop;
  v_log := v_log || pg_temp.chk('P8c', 'ชื่อช่างที่มี bidi / control / ล่องหน / ขึ้นบรรทัดใหม่ / ว่าง / ยาวเกิน 60 ถูกปฏิเสธ 22023 · ชื่อไทย-อังกฤษปกติ+อีโมจิผ่าน',
    v_ok and (pg_temp.wu(p_shop, 'ช่างสมชาย Somchai 👍', '', '8642') ->> 'id') is not null);
  v_log := v_log || pg_temp.chk('P9a', 'ข้ามขั้น QC และแพ็กไม่ได้ (job_stage_skip → stage_required) · ข้ามขั้นอื่นยังได้',
    pg_temp.code(pg_temp.q(format('select analytics.job_stage_skip(%L, %L, ''qc'', ''ทดสอบ'', %L)', p_shop, jid, v_actor))) = 'stage_required'
    and pg_temp.code(pg_temp.q(format('select analytics.job_stage_skip(%L, %L, ''pack'', ''ทดสอบ'', %L)', p_shop, jid, v_actor))) = 'stage_required'
    and (pg_temp.q(format('select analytics.job_stage_skip(%L, %L, ''wax_tree'', ''ใช้ต้นเดิม'', %L)', p_shop, jid, v_actor)) ->> 'ok') = 'true');
  v_log := v_log || pg_temp.chk('P9b', 'service key UPDATE ข้าม qc / pack ตรง (ข้าม RPC) ถูก trigger ปฏิเสธ 22023',
    pg_temp.x(format('update analytics.job_stage set status = ''skipped'', skip_reason = ''ทดสอบ'' where job_id = %L and stage_code = ''qc''', jid)) like 'ERR:22023:%QC%'
    and pg_temp.x(format('update analytics.job_stage set status = ''skipped'', skip_reason = ''ทดสอบ'' where job_id = %L and stage_code = ''pack''', jid)) like 'ERR:22023:%');

  -- ---------- L4: ถัง ip นับเฉพาะ action เขียน + verify PIN ----------
  th := pg_temp.newtok(p_shop, jid);
  sess := pg_temp.login(th, w3, '3957') ->> 'session_hash';
  r := pg_temp.w_res(th, sess, analytics.job_sha256_hex('ip-res'));
  r2 := pg_temp.w_recv(th, sess, 1, null, analytics.job_sha256_hex('ip-write'));
  r3 := pg_temp.q(format('select analytics.worker_pin_verify(%L, %L, %L, %L, %L)', th, w3, '3957', 'ua', analytics.job_sha256_hex('ip-pin')));
  v_log := v_log || pg_temp.chk('L4a', 'ถัง ip: resolve (โหลดหน้า) ไม่นับ · receive/send นับ (ipw:) · verify PIN นับ (ipp:)',
    (r ->> 'ok') = 'true' and not exists (select 1 from analytics.worker_rate_limit k where k.key like '%' || left(analytics.job_sha256_hex('ip-res'), 32))
    and exists (select 1 from analytics.worker_rate_limit k where k.key = 'ipw:' || left(analytics.job_sha256_hex('ip-write'), 32))
    and exists (select 1 from analytics.worker_rate_limit k where k.key = 'ipp:' || left(analytics.job_sha256_hex('ip-pin'), 32)));
  select count(*) into v_n from analytics.worker_rate_limit where key like 'tok:%';
  for i in 1 .. 5 loop m := pg_temp.w_res(analytics.job_sha256_hex('nope' || i)); end loop;
  select count(*) into v_ev from analytics.worker_rate_limit where key like 'tok:%';
  v_log := v_log || pg_temp.chk('L4b', 'token สุ่ม (ไม่มีในระบบ) ไม่เขียนแถวลงถังนับ — จำนวนแถว tok: ไม่เปลี่ยน', v_n = v_ev);
  insert into analytics.worker_rate_limit (key, window_start, hits) values ('old-a', now() - interval '3 days', 1), ('old-b', now() - interval '9 days', 5), ('keep-c', now() - interval '1 day', 2);
  perform analytics.job_rate_limit_hit('v173-clean', 1000);
  v_log := v_log || pg_temp.chk('L4c', 'ล้างแถวถังนับเก่า (> 2 วัน) แน่นอนทุกครั้งที่เรียก (ไม่ใช่สุ่ม 2%) · แถวอายุ 1 วันยังอยู่',
    not exists (select 1 from analytics.worker_rate_limit where key in ('old-a', 'old-b')) and exists (select 1 from analytics.worker_rate_limit where key = 'keep-c'));

  -- ---------- L1 held_by ----------
  j := pg_temp.mkpjob(p_shop); jid := (j ->> 'job_id')::uuid;
  th := pg_temp.newtok(p_shop, jid);
  sess := pg_temp.login(th, w3, '3957') ->> 'session_hash';
  sessb := pg_temp.login(th, pg_temp.wid(p_shop, 'v173-ช่าง5', '8642'), '8642') ->> 'session_hash';
  r := pg_temp.w_recv(th, sess, 1);
  m := pg_temp.w_res(th);
  r2 := pg_temp.w_res(th, sessb);
  r3 := pg_temp.w_res(th, sess);
  v_log := v_log || pg_temp.chk('L1', 'held_by (ชื่อผู้ถืองาน): ผู้ที่ยังไม่ระบุตัวได้ null · ช่างที่ระบุตัวแล้วเห็นชื่อผู้ถือ · แถบขั้นของผู้ไม่ระบุตัวไม่มี worker_name',
    (r ->> 'ok') = 'true' and (m ->> 'held_by') is null and (m ->> 'next_action') = 'identify' and (r2 ->> 'held_by') = 'v173-ช่าง3' and (r3 ->> 'held_by') = 'v173-ช่าง3'
    and not exists (select 1 from jsonb_array_elements(m -> 'job' -> 'stages') e where e ? 'worker_name'));
  return v_log;
end;
$s$;

-- ============================================================================
-- Section H — น้ำหนักส่งมอบ (M1) · QA6 ไม่ auto-close ขั้นบังคับชั่ง · QA2 board_column · QA5 all_done/job_closed · ชื่อแบบ · สิทธิ์
--   ใบเสนอราคาที่ใช้ = โคลนจากรายการจริง 1 รายการเป็นแม่แบบ (สร้างแถวทดสอบใหม่ในทรานแซกชันของ section) — ไม่ยิงสร้างใบงานจากใบเสนอราคาจริง
-- ============================================================================
create function pg_temp.sh(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log   text := '';
  v_actor constant uuid := '00000000-0000-0000-0000-0000000000a1';
  v_today date := analytics.job_today();
  jg uuid; jg2 uuid; jg3 uuid; js uuid; jb uuid; j4 uuid; jd uuid; jc uuid; jr uuid; jp uuid; jl uuid;
  tg text; tg2 text; ts text; t4 text; td text; tc text; trp text; tr2 text;
  wa uuid; wb uuid; wg uuid; sa text; sb text; sg text;
  r jsonb; r2 jsonb; r3 jsonb; m jsonb; d jsonb; lg jsonb;
  v_ok boolean; v_ev1 int; v_ev2 int; v_n1 int; v_n2 int; v_s text; v_shop2 uuid;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into public.shop (name) values ('verify0173-shop2-h') returning id into v_shop2;
  wa := pg_temp.wid(p_shop, 'v173h-เอ', '4829');
  wb := pg_temp.wid(p_shop, 'v173h-บี', '7351');

  -- ---------- M1 ทอง: เทียบน้ำหนักรับกับน้ำหนักที่ขั้นก่อนส่ง ----------
  jg := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'gold', 10));
  tg := pg_temp.newtok(p_shop, jg);
  sg := pg_temp.login(tg, wa, '4829') ->> 'session_hash';
  r := pg_temp.o_run(p_shop, jg, 1, 3, v_today);
  r2 := pg_temp.w_recv(tg, sg, 4, 9.900);
  m := pg_temp.w_send(tg, sg, 4, 9.800);
  select count(*) into v_ev1 from analytics.job_event where job_id = jg;
  r3 := pg_temp.w_recv(tg, sg, 5, 9.860);
  v_log := v_log || pg_temp.chk('M1a', 'ทอง: ขั้นก่อนส่งออก 9.800 g รับ 9.860 g (ต่าง +0.06 > 0.05) ถูกปฏิเสธ handoff_mismatch (ข้อความไทย "ชั่งใหม่หรือแจ้งออฟฟิศ" · ไม่ raise · ไม่เขียน event · ขั้นไม่ขยับ)',
    (r2 ->> 'ok') = 'true' and (m ->> 'ok') = 'true' and (r3 ->> 'code') = 'handoff_mismatch' and (r3 ->> 'ok') = 'false' and (r3 ->> 'message') like '%ชั่งใหม่หรือแจ้งออฟฟิศ%'
    and (r3 ->> 'gap_g')::numeric = 0.06 and pg_temp.st(jg) like '%,4:sen,5:pen%');
  select count(*) into v_ev2 from analytics.job_event where job_id = jg;
  r2 := pg_temp.w_recv(tg, sg, 5, 9.740);
  v_log := v_log || pg_temp.chk('M1b', 'ทอง: รับ 9.740 g (ต่าง −0.06) ถูกปฏิเสธเช่นกัน (ทั้งสองทิศ) · จำนวน event ไม่เพิ่ม', (r2 ->> 'code') = 'handoff_mismatch' and v_ev1 = v_ev2);
  r2 := pg_temp.w_recv(tg, sg, 5, 9.850);
  v_log := v_log || pg_temp.chk('M1c', 'ทอง: ต่าง +0.05 g พอดี ผ่าน (เกณฑ์ ">0.05") · event เก็บ handoff_gap_g=0.05 · v_job_stage_loss.handoff_gap_g=0.05',
    (r2 ->> 'ok') = 'true' and (select (e.payload ->> 'handoff_gap_g')::numeric = 0.05 from analytics.job_event e where e.job_id = jg and e.event_type = 'stage_receive' order by e.recorded_at desc limit 1)
    and (select l.handoff_gap_g = 0.050 from analytics.v_job_stage_loss l where l.job_id = jg and l.stage_code = 'cut_sprue'));
  jg2 := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'gold', 10));
  r := pg_temp.o_run(p_shop, jg2, 1, 4, v_today);   -- ขั้นหล่อส่งออก 9.900
  r2 := pg_temp.o_recv(p_shop, jg2, 5, v_today, 9.850, null, 'ช่างออฟฟิศ');
  v_log := v_log || pg_temp.chk('M1d', 'ทอง: ต่าง −0.05 g พอดีผ่าน (ผ่านช่องทางออฟฟิศด้วย)', r ? 'ok' and r2 ? 'ok');
  jg3 := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'gold', 10));
  r := pg_temp.o_run(p_shop, jg3, 1, 4, v_today);
  r2 := pg_temp.o_recv(p_shop, jg3, 5, v_today, 9.700, null, 'ช่างออฟฟิศ');
  v_log := v_log || pg_temp.chk('M1e', 'ทอง: ช่องทางออฟฟิศก็ถูกปฏิเสธ handoff_mismatch (hint) เมื่อต่างเกิน 0.05 — ทางแก้ = ย้อนขั้นก่อน (reopen) แล้วชั่ง/ส่งใหม่',
    pg_temp.code(r2) = 'handoff_mismatch'
    and (pg_temp.q(format('select analytics.job_stage_reopen(%L, %L, %L, %L)', p_shop, jg3, 'น้ำหนักส่งมอบไม่ตรง ชั่งใหม่', v_actor)) ->> 'to') = 'received'
    and pg_temp.st(jg3) like '%,4:rec,5:pen%');
  -- เงิน: ไม่บล็อก แต่บันทึกส่วนต่าง
  js := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'silver', 10));
  r := pg_temp.o_run(p_shop, js, 1, 3, v_today);
  r2 := pg_temp.o_recv(p_shop, js, 4, v_today, 9.900, null, 'ช่างเอ');
  r3 := pg_temp.o_send(p_shop, js, 4, v_today, 9.800);
  m := pg_temp.o_recv(p_shop, js, 5, v_today, 9.000, null, 'ช่างบี');
  v_log := v_log || pg_temp.chk('M1f', 'เงิน: ขั้นก่อนส่งออก 9.800 รับ 9.000 (ต่าง −0.8 g) ไม่ถูกบล็อก · v_job_stage_loss.handoff_gap_g = −0.8 · v_job_board.handoff_gap_g = 0.8 (ค่าสัมบูรณ์สูงสุดของใบ)',
    r2 ? 'ok' and r3 ? 'ok' and m ? 'ok' and (select l.handoff_gap_g = -0.800 from analytics.v_job_stage_loss l where l.job_id = js and l.stage_code = 'cut_sprue')
    and (select b.handoff_gap_g = 0.800 from analytics.v_job_board b where b.id = js));
  jb := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'brass', 10));
  r := pg_temp.o_run(p_shop, jb, 1, 4, v_today);
  m := pg_temp.o_recv(p_shop, jb, 5, v_today, 5.000, null, 'ช่างเอ');
  v_log := v_log || pg_temp.chk('M1g', 'ทองเหลือง: ต่างมากก็ไม่บล็อก บันทึกส่วนต่างเหมือนเงิน · ส่วนต่างเป็นของขั้นที่รับ',
    m ? 'ok' and (select l.handoff_gap_g = -4.900 from analytics.v_job_stage_loss l where l.job_id = jb and l.stage_code = 'cut_sprue'));

  -- ---------- QA6: ขั้นก่อนบังคับชั่งยังไม่ส่ง -> ไม่ auto-close ----------
  j4 := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'silver', 10));
  t4 := pg_temp.newtok(p_shop, j4);
  sa := pg_temp.login(t4, wa, '4829') ->> 'session_hash';
  sb := pg_temp.login(t4, wb, '7351') ->> 'session_hash';
  r := pg_temp.o_run(p_shop, j4, 1, 3, v_today);
  r2 := pg_temp.w_recv(t4, sa, 4, 9.900);
  m := pg_temp.w_recv(t4, sb, 5, 9.900);
  v_log := v_log || pg_temp.chk('Q6a', 'เงิน: A ถือขั้นหล่อ (บังคับชั่ง) ยังไม่ส่งต่อ → B รับขั้นตัดต้นไม่ได้ prev_not_sent (ข้อความให้ A ส่งพร้อมน้ำหนัก/แจ้งออฟฟิศ) · ขั้นหล่อยัง received',
    (r2 ->> 'ok') = 'true' and (m ->> 'code') = 'prev_not_sent' and (m ->> 'message') like '%ชั่ง%' and pg_temp.st(j4) like '%,4:rec,5:pen%');
  m := pg_temp.w_send(t4, sa, 4, 9.900);
  r3 := pg_temp.w_recv(t4, sb, 5, 9.900);
  v_log := v_log || pg_temp.chk('Q6b', 'A ส่งต่อพร้อมน้ำหนักแล้ว B รับได้ตามปกติ (ไม่ใช่ auto)', (m ->> 'ok') = 'true' and (r3 ->> 'ok') = 'true' and (r3 ->> 'prev_auto_closed') = 'false');
  jr := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'silver', 10));
  trp := pg_temp.newtok(p_shop, jr);
  sa := pg_temp.login(trp, wa, '4829') ->> 'session_hash';
  sb := pg_temp.login(trp, wb, '7351') ->> 'session_hash';
  r := pg_temp.w_recv(trp, sa, 1);
  r2 := pg_temp.w_recv(trp, sb, 2);
  v_log := v_log || pg_temp.chk('Q6c', 'ต้องไม่พัง: ขั้นที่ไม่บังคับชั่ง (ฉีดเทียน) ผู้ถือยังไม่ส่ง คนถัดไปรับ → auto-close ตามเดิม (prev_auto_closed=true · auto_closed ที่ขั้นแรก · ขั้นก่อนไม่มีน้ำหนักออก → ไม่มีส่วนต่าง null)',
    (r ->> 'ok') = 'true' and (r2 ->> 'ok') = 'true' and (r2 ->> 'prev_auto_closed') = 'true' and pg_temp.st(jr) like '1:sen*,2:rec%'
    and (select l.handoff_gap_g is null from analytics.v_job_stage_loss l where l.job_id = jr and l.stage_code = 'wax_tree'));
  m := pg_temp.o_run(p_shop, jr, 2, 3, v_today);
  r := pg_temp.o_recv(p_shop, jr, 4, v_today, 9.900, null, 'ออฟฟิศกรอก');
  r2 := pg_temp.o_recv(p_shop, jr, 5, v_today, 9.900, null, 'ออฟฟิศกรอก');
  v_log := v_log || pg_temp.chk('Q6d', 'ออฟฟิศรับขั้นถัดไปทั้งที่ขั้นหล่อ (บังคับชั่ง) ยังค้าง → ปฏิเสธ prev_not_sent ด้วย (ทุกช่องทาง) · ต้องส่งพร้อมน้ำหนักก่อน', pg_temp.code(r2) = 'prev_not_sent' and r ? 'ok');

  -- ---------- QA2 board_column / QA5 all_done ----------
  jd := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'silver', 10));
  td := pg_temp.newtok(p_shop, jd);
  sa := pg_temp.login(td, wa, '4829') ->> 'session_hash';
  v_log := v_log || pg_temp.chk('Q2a', 'v_job_board.board_column: ใบใหม่ = รหัสขั้นปัจจุบัน (wax_inject) · ใบเดินกลางทาง = ขั้นที่ถือ/รอ (ไม่ใช่ awaiting_close)',
    (select b.board_column = 'wax_inject' from analytics.v_job_board b where b.id = jd) and (select b.board_column = 'cut_sprue' from analytics.v_job_board b where b.id = js)
    and (select b.board_column = 'cut_sprue' from analytics.v_job_board b where b.id = jb));
  r := pg_temp.o_run(p_shop, jd, 1, 8, v_today);
  m := pg_temp.w_res(td);
  r2 := pg_temp.w_res(td, sa);
  v_log := v_log || pg_temp.chk('Q2b + Q5a', 'ส่งต่อครบ 8 ขั้นแต่ยังไม่ปิดงาน: board_column = awaiting_close (ไม่ตกเป็นยังไม่เริ่ม) · resolve ทั้งแบบไม่ระบุตัวและระบุตัว = next_action all_done (ไม่ใช่ identify/none) · ไม่มีรายชื่อช่างให้เลือก',
    r ? 'ok' and (select b.board_column = 'awaiting_close' and b.current_stage_code is null and b.status = 'in_progress' and b.stage_done_count = b.stage_count from analytics.v_job_board b where b.id = jd)
    and (m ->> 'next_action') = 'all_done' and (r2 ->> 'next_action') = 'all_done' and jsonb_array_length(m -> 'workers') = 0 and (m ->> 'ok') = 'true');
  r := pg_temp.q(format('select analytics.job_done(%L, %L, 10, 0, null, null, %L)', p_shop, jd, v_actor));
  jc := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'silver', 10));
  tc := pg_temp.newtok(p_shop, jc);
  m := pg_temp.q(format('select analytics.job_cancel(%L, %L, %L, %L)', p_shop, jc, 'ลูกค้ายกเลิก', v_actor));
  v_log := v_log || pg_temp.chk('Q2c', 'board_column ของใบที่ปิด = done · ใบที่ยกเลิก = cancelled', (select b.board_column = 'done' from analytics.v_job_board b where b.id = jd) and (select b.board_column = 'cancelled' from analytics.v_job_board b where b.id = jc));
  -- QA5b: job_closed แยกจาก invalid_token เฉพาะ hash ที่ตรงแถวจริง (ไม่เปิด oracle)
  jl := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'silver', 10));
  trp := pg_temp.newtok(p_shop, jl);
  tr2 := pg_temp.newtok(p_shop, jl);
  select count(*) into v_n1 from analytics.worker_rate_limit;
  r := pg_temp.w_res(td);                                      -- token ของใบที่ปิดแล้ว (done)
  r2 := pg_temp.w_res(tc);                                     -- token ของใบที่ยกเลิก
  r3 := pg_temp.w_res(trp);                                    -- token เก่าที่ถูกพิมพ์ใหม่แทน (ใบยังเปิด)
  m := pg_temp.w_res(analytics.job_sha256_hex('random-token-never-issued'));   -- hash สุ่ม
  v_log := v_log || pg_temp.chk('Q5b', 'token ที่เคยถูกต้องของใบ done/cancelled → job_closed "ใบงานนี้ปิดแล้ว" (เห็นเลขใบ) · token ที่ถูกพิมพ์ใหม่แทน (ใบยังเปิด) และ hash สุ่ม → invalid_token ข้อความเดียวกัน ไม่มีเลขใบ (ไม่เปิด oracle ว่ามีใบงานอยู่)',
    (r ->> 'code') = 'job_closed' and (r ->> 'message') = 'ใบงานนี้ปิดแล้ว' and (r ->> 'job_no') is not null and (r2 ->> 'code') = 'job_closed'
    and (r3 ->> 'code') = 'invalid_token' and (m ->> 'code') = 'invalid_token' and (r3 ->> 'message') = (m ->> 'message') and not (m ? 'job_no') and not (r3 ? 'job_no'));
  v_log := v_log || pg_temp.chk('Q5c', 'job_closed ใช้กับ login/รับ/ส่งด้วย (token ของใบปิด) · resolve ก็คืน ok:false ไม่มีข้อมูลใบ',
    (pg_temp.login(td, wa, '4829') ->> 'code') = 'job_closed' and (pg_temp.w_recv(td, sa, 1) ->> 'code') = 'job_closed' and not (r ? 'job'));

  -- ---------- ชื่อแบบ (design_label) ----------
  d := pg_temp.clone_deal(p_tpl, 'silver', 4, null, 'won');
  v_ok := true;
  foreach v_s in array array['', '   ', E'​'] loop
    r := pg_temp.q(format('select analytics.job_create_from_quote_item(%L, %L, %L::text[], null, %L, %L, null, %L)', p_shop, d ->> 'item_id', pg_temp.std(), 'verify เริ่มก่อน', v_s, v_actor));
    v_ok := v_ok and (r ->> '_state') = '22023' and not (r ? 'job_id');
  end loop;
  r := pg_temp.q(format('select analytics.job_create_from_quote_item(%L, %L, %L::text[], null, %L, null, null, %L)', p_shop, d ->> 'item_id', pg_temp.std(), 'verify เริ่มก่อน', v_actor));
  r2 := pg_temp.q(format('select analytics.job_create_from_quote_item(%L, %L, %L::text[], null, %L, %L, null, %L)', p_shop, d ->> 'item_id', pg_temp.std(), 'verify เริ่มก่อน', '.', v_actor));
  v_log := v_log || pg_temp.chk('N1a', 'ใบงาน OEM: p_design_label ว่าง/ช่องว่าง/อักขระล่องหน/null/"." ถูกปฏิเสธ (design_label_required / 22023) — บังคับให้ออฟฟิศตั้งชื่อเสมอ ไม่มีค่าเริ่มต้นจาก snapshot ในชั้น DB',
    v_ok and pg_temp.code(r) = 'design_label_required' and (r2 ->> '_state') = '22023' and not (r2 ? 'job_id'));
  r := pg_temp.q(format('select analytics.job_create_from_quote_item(%L, %L, %L::text[], null, %L, %L, null, %L)', p_shop, d ->> 'item_id', pg_temp.std(), 'verify เริ่มก่อน', 'แหวนลาย A (ลูกค้าประจำ)', v_actor));
  jl := pg_temp.jid(r);
  tg2 := pg_temp.newtok(p_shop, jl);
  sg := pg_temp.login(tg2, wa, '4829') ->> 'session_hash';
  v_log := v_log || pg_temp.chk('N1b', 'ตั้งชื่อเรียกภายในแล้วสร้างได้ · ใบงานเก็บชื่อที่ออฟฟิศพิมพ์ (ไม่ใช่ snapshot ของใบเสนอราคา) · ช่างเห็นชื่อนี้ใน payload',
    r ? 'job_id' and (select design_label = 'แหวนลาย A (ลูกค้าประจำ)' from analytics.job where id = jl) and (pg_temp.w_res(tg2, sg) -> 'job' ->> 'design_label') = 'แหวนลาย A (ลูกค้าประจำ)');
  r := pg_temp.q(format('select analytics.job_design_label_set(%L, %L, %L, %L)', p_shop, jl, 'แหวนลาย B v2', v_actor));
  v_log := v_log || pg_temp.chk('N1c', 'job_design_label_set แก้ชื่อทีหลังได้ (ใบที่ยังไม่ปิด) · มี event note kind=design_label เก็บค่าเก่า-ใหม่ · ช่างเห็นชื่อใหม่ทันที',
    (r ->> 'design_label') = 'แหวนลาย B v2' and exists (select 1 from analytics.job_event e where e.job_id = jl and e.event_type = 'note' and e.payload ->> 'kind' = 'design_label'
                                                           and e.payload ->> 'before' = 'แหวนลาย A (ลูกค้าประจำ)' and e.payload ->> 'after' = 'แหวนลาย B v2')
    and (pg_temp.w_res(tg2, sg) -> 'job' ->> 'design_label') = 'แหวนลาย B v2');
  v_ok := true;
  foreach v_s in array array['', '   ', '.', E'​', E'แหวน‮evil', E'บรรทัด\nใหม่', repeat('ก', 201)] loop
    v_ok := v_ok and (pg_temp.q(format('select analytics.job_design_label_set(%L, %L, %L, %L)', p_shop, jl, v_s, v_actor)) ->> '_state') = '22023';
  end loop;
  v_log := v_log || pg_temp.chk('N1d', 'ชื่อแบบผ่านด่านข้อความ: ว่าง / "." / ล่องหน / bidi / ขึ้นบรรทัดใหม่ / ยาวเกิน 200 ถูกปฏิเสธ · ชื่อเดิมไม่ถูกแก้', v_ok and (select design_label = 'แหวนลาย B v2' from analytics.job where id = jl));
  v_log := v_log || pg_temp.chk('N1e', 'แก้ชื่อใบ done / ร้านอื่น / ไม่มี actor ไม่ได้ (job_closed / job_not_found / actor_required) · INSERT-UPDATE ตรงบนใบ done ถูกปฏิเสธ · anon/authenticated 42501',
    pg_temp.code(pg_temp.q(format('select analytics.job_design_label_set(%L, %L, %L, %L)', p_shop, jd, 'ชื่อใหม่', v_actor))) = 'job_closed'
    and pg_temp.code(pg_temp.q(format('select analytics.job_design_label_set(%L, %L, %L, %L)', v_shop2, jl, 'ชื่อใหม่', v_actor))) = 'job_not_found'
    and pg_temp.code(pg_temp.q(format('select analytics.job_design_label_set(%L, %L, %L)', p_shop, jl, 'ชื่อใหม่'))) = 'actor_required'
    and pg_temp.x(format('update analytics.job set design_label = ''แอบแก้'' where id = %L', jd)) like 'ERR:22023:%'
    and pg_temp.as_role('anon', format('select analytics.job_design_label_set(%L, %L, %L, %L)', p_shop, jl, 'x', v_actor)) like 'ERR:42501:%');
  jp := pg_temp.jid(pg_temp.mkpjob(p_shop));
  v_log := v_log || pg_temp.chk('N1f', 'ใบงานผลิตเข้าสต็อก (production): ไม่บังคับ p_design_label (ใช้ชื่อสินค้าเป็นค่าเริ่มต้น) · ข้อมูลตั้งต้นอื่นของใบ (โลหะ/จำนวน) ยังแก้ตรงไม่ได้',
    (select length(design_label) > 0 from analytics.job where id = jp)
    and pg_temp.x(format('update analytics.job set qty_planned = 99 where id = %L', jl)) like 'ERR:22023:%'
    and pg_temp.x(format('update analytics.job set metal = ''gold'' where id = %L', jl)) like 'ERR:22023:%');

  -- ---------- สิทธิ์ / overload ----------
  v_log := v_log || pg_temp.chk('G1', 'ไม่มี overload: job_worker_auth ฉบับเก่า (5 พารามิเตอร์) ถูกถอดแล้ว เหลือฉบับเดียว · RPC ใหม่ worker_unlock / job_design_label_set: service_role เท่านั้น',
    to_regprocedure('analytics.job_worker_auth(text,text,text,boolean,boolean)') is null and to_regprocedure('analytics.job_worker_auth(text,text,text,boolean,boolean,text)') is not null
    and (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'job_worker_auth') = 1
    and has_function_privilege('service_role', 'analytics.worker_unlock(uuid,uuid,uuid)', 'execute') and has_function_privilege('service_role', 'analytics.job_design_label_set(uuid,uuid,text,uuid)', 'execute')
    and not has_function_privilege('anon', 'analytics.worker_unlock(uuid,uuid,uuid)', 'execute') and not has_function_privilege('authenticated', 'analytics.worker_unlock(uuid,uuid,uuid)', 'execute')
    and not has_function_privilege('anon', 'analytics.job_design_label_set(uuid,uuid,text,uuid)', 'execute') and not has_function_privilege('authenticated', 'analytics.job_design_label_set(uuid,uuid,text,uuid)', 'execute')
    and not has_function_privilege('service_role', 'analytics.job_worker_auth(text,text,text,boolean,boolean,text)', 'execute')
    and not has_function_privilege('service_role', 'analytics.job_counter_bump(text,timestamp with time zone)', 'execute'));
  v_log := v_log || pg_temp.chk('G2', 'ACL ทุกฟังก์ชัน job_*/worker_* ไม่มี PUBLIC/anon/authenticated (aclexplode) หลัง 0173 · v_job_board / v_job_stage_loss / v_worker_lock: anon/authenticated ไม่มีสิทธิ์ใด',
    not exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a where p.pronamespace = 'analytics'::regnamespace and (p.proname like 'job\_%' or p.proname like 'worker\_%')
                 and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole))
    and not exists (select 1 from pg_proc p where p.pronamespace = 'analytics'::regnamespace and (p.proname like 'job\_%' or p.proname like 'worker\_%') and p.proacl is null)
    and not has_table_privilege('anon', 'analytics.v_worker_lock', 'select') and not has_table_privilege('authenticated', 'analytics.v_worker_lock', 'select')
    and not has_table_privilege('anon', 'analytics.v_job_board', 'select') and not has_table_privilege('authenticated', 'analytics.v_job_stage_loss', 'select')
    and pg_temp.as_role('service_role', 'select board_column, handoff_gap_g from analytics.v_job_board limit 1') = 'OK'
    and pg_temp.as_role('service_role', 'select handoff_gap_g from analytics.v_job_stage_loss limit 1') = 'OK');
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
  select pg_temp.run_sec('sp', p_shop, p_tpl) || pg_temp.run_sec('sh', p_shop, p_tpl)
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


do $v173$
declare
  v_shop uuid; v_tpl uuid;
  v_log text := ''; v_s text; v_fail int; v_snap0 text;
  v_m record; v_killed int := 0; v_total int; v_survived text := ''; v_cnt int; v_id text; v_hit int; v_skip int; v_ok_cnt int;
  v_mutants jsonb := jsonb_build_array(
    jsonb_build_object('id', 'NM01', 'what', 'หน้าต่างนับ PIN ผิดรีเซ็ตทุกครั้ง (กลับไปเป็นพฤติกรรม H1)', 'fn', 'worker_pin_verify',
      'from', 'v_new := v_w.failed_window_start is null or v_w.failed_window_start < now() - interval ''24 hours'';', 'to', 'v_new := true;', 'expect', jsonb_build_array('P1 (B1)')),
    jsonb_build_object('id', 'NM02', 'what', 'ไม่มีล็อกถาวรที่ครั้งที่ 15', 'fn', 'worker_pin_verify',
      'from', 'when v_att >= 15 then ''infinity''::timestamptz', 'to', 'when v_att >= 1500 then ''infinity''::timestamptz', 'expect', jsonb_build_array('P3d')),
    jsonb_build_object('id', 'NM03', 'what', 'ไม่ล็อก 1 ชม. ตั้งแต่ครั้งที่ 10', 'fn', 'worker_pin_verify',
      'from', 'when v_att >= 10 then now() + interval ''1 hour''', 'to', 'when v_att >= 1000 then now() + interval ''1 hour''', 'expect', jsonb_build_array('P3b', 'P3c')),
    jsonb_build_object('id', 'NM04', 'what', 'งบผิดต่อ token ไม่บังคับ', 'fn', 'worker_pin_verify',
      'from', 'if coalesce(v_spent, 0) >= 20 then', 'to', 'if coalesce(v_spent, 0) >= 20000 then', 'expect', jsonb_build_array('P6a')),
    jsonb_build_object('id', 'NM05', 'what', 'เกณฑ์น้ำหนักส่งมอบทองหลวมเป็น 5 g', 'fn', 'job_core_receive',
      'from', 'abs(v_gap) > 0.05', 'to', 'abs(v_gap) > 5', 'expect', jsonb_build_array('M1a', 'M1b', 'M1e')),
    jsonb_build_object('id', 'NM06', 'what', 'ปิดขั้นก่อนหน้าที่บังคับชั่งอัตโนมัติได้', 'fn', 'job_core_receive',
      'from', 'if v_p.weigh_required then', 'to', 'if false then', 'expect', jsonb_build_array('Q6a', 'Q6d')),
    jsonb_build_object('id', 'NM07', 'what', 'ใบครบทุกขั้นถูกตีเป็น identify', 'fn', 'job_worker_resolve',
      'from', 'v_action := ''all_done'';', 'to', 'v_action := ''identify'';', 'expect', jsonb_build_array('Q2b + Q5a')),
    jsonb_build_object('id', 'NM08', 'what', 'held_by รั่วถึงผู้ไม่ระบุตัว', 'fn', 'job_worker_resolve',
      'from', 'case when v_worker is null then null else v_holder end', 'to', 'v_holder', 'expect', jsonb_build_array('L1')),
    jsonb_build_object('id', 'NM09', 'what', 'ไม่แยก job_closed ของ token ที่เพิกถอนเพราะปิดใบ', 'fn', 'job_worker_auth',
      'from', 'if v_status in (''done'', ''cancelled'') then', 'to', 'if false then', 'expect', jsonb_build_array('Q5b')),
    jsonb_build_object('id', 'NM10', 'what', 'ข้าม QC/แพ็กได้ผ่าน RPC', 'fn', 'job_stage_skip',
      'from', 'if v_s.stage_code in (''qc'', ''pack'') then', 'to', 'if false then', 'expect', jsonb_build_array('P9a')),
    jsonb_build_object('id', 'NM11', 'what', 'OEM ไม่ต้องมีชื่อแบบจากออฟฟิศ', 'fn', 'job_create_from_quote_item',
      'from', 'if nullif(btrim(coalesce(p_design_label, '''')), '''') is null then', 'to', 'if false then', 'expect', jsonb_build_array('N1a')),
    jsonb_build_object('id', 'NM12', 'what', 'PIN ซ้ำคู่ผ่าน', 'fn', 'job_pin_ok',
      'from', 'and p_pin !~ ''^(..)\1$''', 'to', 'and true', 'expect', jsonb_build_array('P8a')),
    jsonb_build_object('id', 'NM13', 'what', 'stage_codes ว่างผ่าน', 'fn', 'worker_upsert',
      'from', 'if cardinality(v_codes) = 0 then', 'to', 'if false then', 'expect', jsonb_build_array('P8b')),
    jsonb_build_object('id', 'NM14', 'what', 'ล้างแถวถังนับเก่าไม่ทำงาน', 'fn', 'job_rate_limit_hit',
      'from', 'where w.window_start < now() - interval ''2 days'' limit 200', 'to', 'where w.window_start < now() - interval ''2000 days'' limit 200', 'expect', jsonb_build_array('L4c')),
    jsonb_build_object('id', 'NM15', 'what', 'worker_unlock ไม่ล้างหน้าต่าง/การล็อกถาวร', 'fn', 'worker_unlock',
      'from', 'failed_attempts = 0, failed_window_start = null, last_failed_at = null, locked_until = null where id = p_worker_id', 'to', 'failed_attempts = 0 where id = p_worker_id', 'expect', jsonb_build_array('P4b', 'P4c')),
    jsonb_build_object('id', 'NM16', 'what', 'login สำเร็จไม่ล้างหน้าต่างนับ', 'fn', 'worker_pin_verify',
      'from', 'update analytics.worker set failed_attempts = 0, failed_window_start = null, last_failed_at = null, locked_until = null where id = v_w.id;', 'to', 'update analytics.worker set failed_attempts = 0 where id = v_w.id;', 'expect', jsonb_build_array('P5a')),
    jsonb_build_object('id', 'NM17', 'what', 'ถัง ip นับ resolve ด้วย', 'fn', 'job_worker_auth',
      'from', 'if p_ip_class in (''write'', ''pin'') and', 'to', 'if p_ip_class in (''write'', ''pin'', ''none'') and', 'expect', jsonb_build_array('L4a')),
    jsonb_build_object('id', 'NM18', 'what', 'token สุ่มเขียนแถวลงถังนับ (เปิดช่องบวม)', 'fn', 'job_worker_auth',
      'from', '    -- token สุ่ม: ไม่เขียนอะไรลงถัง (กันตารางบวมจากการยิงสุ่ม) — พึ่งเพดาน ip ของ action เขียน/verify PIN',
      'to', '    perform analytics.job_counter_bump(''tok:'' || left(p_token_hash, 32), now());', 'expect', jsonb_build_array('L4b')),
    jsonb_build_object('id', 'NM19', 'what', 'ทิ้ง trigger ข้าม QC/แพ็กระดับตาราง', 'fn', 'job_stage_guard',
      'from', 'if new.stage_code in (''qc'', ''pack'') then', 'to', 'if false then', 'expect', jsonb_build_array('P9b')),
    jsonb_build_object('id', 'NM20', 'what', 'job_guard ห้ามแก้ชื่อแบบอีก (กลับไปแบบ 0172) — job_design_label_set พัง', 'fn', 'job_guard',
      'from', 'or new.sku_snapshot is distinct from old.sku_snapshot', 'to', 'or new.sku_snapshot is distinct from old.sku_snapshot or new.design_label <> old.design_label', 'expect', jsonb_build_array('N1c'))
  );
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select id into v_shop from public.shop order by created_at limit 1;
  -- แม่แบบ: อ่านรายการใบเสนอราคาจริง 1 รายการเพื่อ "โคลน" เป็นใบทดสอบ (สร้างแถวใหม่ในทรานแซกชัน) — ไม่ยิงสร้างใบงานจากใบเสนอราคาจริง
  select i.id into v_tpl from analytics.oem_quote_item i join analytics.oem_quote q on q.id = i.quote_id
   where i.shop_id = v_shop and i.input ->> 'metal' = 'silver' and q.quote_no not like 'V17%' order by q.created_at, i.seq limit 1;
  if v_tpl is null then
    v_log := v_log || '[FAIL] S0  ไม่มี oem_quote_item เงินจริงให้ใช้เป็นแม่แบบโคลน — ชุดทดสอบรันต่อไม่ได้' || E'\n';
    raise exception E'%', v_log;
  end if;

  create temp table _v173_orig on commit drop as
    select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h
      from pg_proc p where p.pronamespace = 'analytics'::regnamespace and (p.proname like 'job\_%' or p.proname like 'worker\_%');

  v_snap0 := pg_temp.snap();
  v_s := pg_temp.run_all(v_shop, v_tpl);
  v_log := v_log || v_s;
  v_log := v_log || pg_temp.chk('K0', 'หลังรันทุก section: แถวตารางใบงาน/ช่าง/ตัวนับ + ตาราง OEM/ผลิต/สต็อก (นับ + md5 เนื้อหา) เท่าก่อนรันเป๊ะ — ไม่เผา state (รวมตัวนับใบผลิตที่ fixture ซ่อมใน tx)', v_snap0 = pg_temp.snap());
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

  select count(*) into v_cnt from _v173_orig o where md5(pg_get_functiondef(to_regprocedure(o.sig))) = o.h;
  v_log := v_log || pg_temp.chk('MY', format('หลังรัน mutant: md5 definition ของฟังก์ชัน job_*/worker_* ทั้ง %s ตัวเท่าเดิม · trigger ใบงานเปิดครบ', (select count(*) from _v173_orig)),
    v_cnt = (select count(*) from _v173_orig)
    and not exists (select 1 from pg_trigger t where t.tgrelid in ('analytics.job'::regclass, 'analytics.job_stage'::regclass, 'analytics.job_event'::regclass, 'analytics.job_token'::regclass,
                                                                 'analytics.worker'::regclass, 'analytics.worker_audit'::regclass) and not t.tgisinternal and t.tgenabled <> 'O'));
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
end $v173$;
