-- scripts/verify/verify-0172.sql  (ปรับครั้งที่ 2 หลัง 0173: คาดค่าตามพฤติกรรมใหม่ · ไม่ยิงสร้างใบงานจากใบเสนอราคาจริงแม้ใน rollback — โคลนเป็นใบทดสอบก่อนเสมอ)
-- ตรวจ supabase/migrations/0172_job_tracking_j1.sql (ระบบใบงานผลิต J1 ฝั่ง DB) หลัง apply (หรือต่อท้ายไฟล์ 0172 ใน dry-run เดียว)
-- self-rolling-back (3j-migration-traps ข้อ 11): แตะตัวนับเลขใบงาน ⇒ ทุก section รันใน subtransaction ที่ถอยกลับเอง แล้ว raise exception ปิดท้ายเสมอ
-- ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน · [SKIP] = พิสูจน์ไม่ได้ (ไม่มีข้อมูลจริงให้ใช้เป็นแม่แบบ fixture)
-- โครงเดียวกับ verify-0166..0171: ชุดเทสต์ (pg_temp.sa..sd) ถูกเรียกซ้ำ — รอบแรก = ของจริง ต้อง FAIL 0 · รอบถัดไป = mutant 31 จุด (แก้ฟังก์ชัน/trigger/constraint
-- จริงใน subtransaction แล้วเรียกชุดเทสต์เดิม ต้องมีเคสที่ระบุล้มจริง) · ปิดท้ายตรวจว่าแถว/ตัวนับของตารางใบงาน + OEM + ผลิต + สต็อก ไม่ขยับ (นับแถว + md5 เนื้อหา)
-- และ md5 ของฟังก์ชัน job_*/worker_* เท่าเดิมหลัง mutant · ทุก if ใช้ coalesce(..., false) = null นับเป็นตก (ข้อ 13) · ไม่มีตัวเลขราคา/ต้นทุนจริงในไฟล์นี้
-- fixture: ใช้ข้อมูลจริงบน DB เป็นแม่แบบ (ทุก oem_quote_item จริง · สินค้าจริง 1 ตัวสำหรับใบผลิต) ทุกอย่างอยู่ใน subtransaction ที่ถอยกลับ
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0172.sql          (~2 นาที: mutant 31 รอบ × ชุดเทสต์เต็ม)
-- dry-run ก่อน apply: cat supabase/migrations/0172_job_tracking_j1.sql scripts/verify/verify-0172.sql > tmp.sql แล้วรันไม่ใส่ --commit
--
-- ============ ตารางแมป "ข้อ design (design-job-tracking.md §3 เคสห้ามผ่าน 1-20 + เคสต้องไม่พัง + security) -> เทสต์" ============
--  #1  รับงานข้ามลำดับ / auto-close / ทองห้าม auto-close   : T01a-T01f · T08f (ทองห้าม auto-close ชั้น trigger) · MU02 MU03 MU23
--  #2  น้ำหนักออก>เข้า / เติมโลหะไม่มีโน้ต / <=0 NaN >100000   : T02a-T02h (+T08a/T08b ชั่งบังคับ) · MU17 MU26
--  #3  จำนวนเข้า=ออก+เสีย / เหตุผลของเสีย / chain จำนวนข้ามขั้น : T03a-T03g
--  #4  ย้อนขั้นต้องมีเหตุผล / ย้อนข้ามขั้น / ช่างย้อนไม่ได้      : T04a-T04g (T04e = ไม่มี RPC ย้อน/ข้าม/ปิดฝั่งช่าง · ไม่มี parameter stage_code) · MU16 MU22
--  #5  job_event UPDATE/DELETE/TRUNCATE ห้าม                   : T05a-T05e · MU01 MU25
--  #6  ใบ done/cancelled แก้ไม่ได้ / DELETE ห้าม               : T06a-T06d (+T10a,T16h) · MU14
--      ยกเว้น job_photo insert = ไม่มี — job_photo เป็นงาน J2 (ไม่มีตารางใน 0172)
--  #7  ข้ามร้าน                                                : T07a-T07g (+T11d) — ครอบ job/stage/event/session/worker/token/RPC ออฟฟิศทุกตัว
--      ส่วน batch/photo ข้ามร้าน = ไม่มี — job_batch (J3)/job_photo (J2) ไม่มีตารางใน 0172
--  #8  ทองชั่ง cast..pack / เงิน cast,cut_sprue,polish / ทองเหลืองไม่บังคับ / ทองห้าม auto_close : T08a-T08g · T08a2 T08b2 · N01
--  #9  occurred_on อนาคต / >14 วัน / sent<received / chain วัน / ขอบวัน BKK : T09a-T09h · N04 · MU08 MU28
--  #10 job_done ขณะมีขั้นค้าง / จำนวนไม่ครบ / ทองไม่มีน้ำหนักสุทธิ  : T10a-T10g · MU27
--  #11 สร้างใบงานจาก quote ไม่ won / PO ไม่ open / ซ้ำ / metal product,silver999 : T11a-T11h · N11 (ยิง suggest+create ใส่ quote item จริงทุกใบบน DB)
--  #12 รายการขั้นตอน ว่าง/ปิดใช้งาน/ลำดับผิด/ขาด qc,pack/ซ้ำ/แบบไม่ใหม่เลือก NRE (เตือน) : T12a-T12i · N02
--  #13 OEM เริ่มก่อนมัดจำต้องมีเหตุผล (สร้าง/พิมพ์/ช่างรับ/ออฟฟิศรับ) · production ไม่มีด่าน · ดีลมีมัดจำจริงไม่ถูกบล็อก : T13a-T13i · MU09 MU10
--  #14 batch ปิดแล้วเพิ่ม/ถอด · ซ้ำขั้นเดียว                    : ไม่มี — job_batch เป็นงาน J3 (ไม่มีตารางใน 0172)
--  #15 กรอกรายวัน 30 แถว all-or-nothing                         : ไม่มี — job_daily_update เป็นงาน J3 · J1 มีแค่ job_office_receive/send ทีละแถว (แต่ละคำสั่ง = หนึ่งทรานแซกชัน)
--  #16 token ไม่มี/เพิกถอน/ปิดงาน/เดารูปแบบ/ดิบ/ข้ามงาน/ฟื้นไม่ได้  : T16a-T16j · N08 · MU05 MU13 MU20
--  #17 PIN ผิด 5 ครั้ง/15 นาทีล็อก · ช่างปิด · ขั้นนอก stage_codes · session หมดอายุ · ปิดหลังออก session · rate limit : T17a-T17p · MU04 MU06 MU07 MU15 MU18 MU31
--  #18 ช่างทำขั้นผิด · ส่งต่อขั้นที่ไม่ได้รับ · สองมือถือพร้อมกัน · ไม่มี parameter เลือกขั้น : T18a-T18i · N05 N06 N07a-c · MU12 MU19 MU24
--  #19 anon/authenticated/PUBLIC ทุก RPC/ตาราง/view (ACL + ยิงจริงด้วย role + USAGE หลุด) : T19a-T19f · MU21 (+ scripts/check-analytics-grants.sql รันแยกหลัง apply)
--  #20 payload ช่างไม่มี cost/price/margin/customer/quote_no/po_no : T20a-T20e · MU11
--      ⚠️ HTML/RSC ของหน้า /w/ จริง = ไม่มีเทสต์ใน SQL (ชั้น DB พิสูจน์ได้แค่ payload ของ RPC) → ต้องเทสต์ยิงหน้าจริง (Luke/QA)
--  เคสต้องไม่พัง: N01 ไม่ชั่งขั้นที่ไม่บังคับ เดินจนจบ (เงิน/ทองเหลือง) · N02 ข้าม gem_set/plating/NRE · N03 reopen แล้วเดินใหม่ · N04 ออฟฟิศกรอกย้อนสลับงาน ·
--     N05 สองมือถือรับขั้นเดียวกัน · N06 ช่างคนเดียว 2 ขั้นติดกัน · N07 มือถือร่วมสลับช่าง/ออกจากระบบ · N08 พิมพ์ซ้ำ QR ใหม่ได้เก่าตาย ·
--     N09 production_order_done ของใบที่ไม่มีใบงาน = ใบที่มีใบงาน · N10 v_oem_quote อ่านครบทุกสถานะ · N11 ทุก quote item จริงบน DB
--     "AUTH_GATE=on แล้ว /w/<token> เปิดได้โดยไม่ login" และ "token ถูกแต่ไม่มี session → ไม่เห็นปุ่ม" ฝั่งหน้าจอ = ไม่มีเทสต์ใน SQL (middleware/TS = งาน Luke) · ฝั่ง RPC ครอบด้วย T16b/T13e
--  เพิ่ม: R1 renegotiate ดีลที่มีใบงาน (R1a-R1c) · R2 v_production_order_job_mismatch (R2a-R2b) · D1 drift view (D1a-D1c) · K0/K0b/K0c state+ตัวนับไม่ขยับ · K1 เลขใบงาน ·
--     X1 ไม่แตะของเดิม = md5 ฟังก์ชัน oem_*/production_* ทั้ง 38 ตัว + schema ตาราง OEM/ผลิต อยู่ใน migration (raise → rollback ทั้งไฟล์ ถ้าไม่เท่า) · MY/MZ คืนของเดิมแล้วรันซ้ำ
--  ⚠️ ที่เทสต์ครอบไม่ได้: PostgREST จริง (probe แยกหลัง apply) · UI/middleware/หน้า /w/ (vitest + QA) · race จริง 2 connection (do-block ทรานแซกชันเดียว
--     จำลองได้แค่ลำดับ lock ⇒ N05 ใช้การเรียกต่อกันสองครั้ง; for update ของใบงานเป็นตัวกันจริง) · นาฬิกา UTC/BKK จริง 00:00-07:00 (ทดสอบ job_bkk_date ที่ขอบเวลาแทน) ·
--     bcrypt timing / การเดา PIN ข้าม IP จำนวนมาก (rate limit ระดับ edge) · การ replay ทั้งชุด migration บน DB ว่าง (ไม่มี DB ว่างให้ทดสอบ)

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

-- ============================================================================
-- Section A — สร้างใบงาน: แหล่งที่มา (#11) · รายการขั้นตอน (#12) · ด่านมัดจำ (#13) · ทุก quote item จริงบน DB (N11)
-- ============================================================================
create function pg_temp.sA(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log   text := '';
  v_actor constant uuid := '00000000-0000-0000-0000-0000000000a1';
  v_today date := analytics.job_today();
  v_prod  uuid;
  v_po    jsonb; v_po_id uuid; v_poi uuid;
  v_po2   jsonb; v_po2_id uuid; v_poi2 uuid;
  r jsonb; r2 jsonb; d jsonb; a jsonb; b jsonb;
  rec record;
  v_n int := 0; v_ok int := 0; v_rej int := 0; v_bad text := '';
  v_cnt_before int; v_cnt_after int; v_pn int := 0; v_pok int := 0;
  v_shop2 uuid;
  v_seq_before int; v_seq_after int;
  v_x text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- ---------- production fixture ----------
  select p.id into v_prod from public.product p
   where p.shop_id = p_shop and p.is_active and p.sku !~* '^live' and p.cost_type in ('fixed', 'spot') order by p.sku limit 1;
  v_log := v_log || pg_temp.chk('A0', 'มีสินค้าจริงให้ทำ fixture ใบผลิต', v_prod is not null);
  v_po := pg_temp.q(format('select pg_temp.po_save(p_shop_id=>%L, p_note=>%L)', p_shop, 'verify0172'));
  v_po_id := (v_po ->> 'id')::uuid;
  perform analytics.production_order_item_set(p_shop, v_po_id, v_prod, 10);
  select id into v_poi from analytics.production_order_item where production_order_id = v_po_id;

  -- ---------- K1 ตัวนับเลข: เลขเพิ่มทีละ 1, รูปแบบ JB-0001 ----------
  select coalesce(max(last_no), 0) into v_seq_before from analytics.job_counter where shop_id = p_shop;
  a := pg_temp.q(format('select analytics.job_create_from_production_item(%L, %L, %L::text[], null, null, null, %L)', p_shop, v_poi, pg_temp.std(), v_actor));
  select coalesce(max(last_no), 0) into v_seq_after from analytics.job_counter where shop_id = p_shop;
  v_log := v_log || pg_temp.chk('T11a', 'สร้างใบงานจากรายการใบผลิต open ได้ · metal=silver · qty=10 · ไม่มีการปฏิเสธ',
    a ? 'job_id' and (select j.source_kind = 'production' and j.metal = 'silver' and j.qty_planned = 10 and j.status = 'open' and j.weigh_required
                       from analytics.job j where j.id = (a ->> 'job_id')::uuid));
  v_log := v_log || pg_temp.chk('K1a', 'ตัวนับเลขใบงานเพิ่มทีละ 1 · job_no = JB-<seq 4 หลัก>',
    v_seq_after = v_seq_before + 1 and (a ->> 'job_no') = 'JB-' || lpad(v_seq_after::text, 4, '0'));
  v_log := v_log || pg_temp.chk('T11b', 'สร้างซ้ำจาก item เดิม (ใบงานยังไม่ยกเลิก) ถูกปฏิเสธ job_exists', pg_temp.code(
    pg_temp.q(format('select analytics.job_create_from_production_item(%L, %L, %L::text[], null, null, null, %L)', p_shop, v_poi, pg_temp.std(), v_actor))) = 'job_exists');
  r := pg_temp.q(format('select analytics.job_cancel(%L, %L, %L, %L)', p_shop, a ->> 'job_id', 'verify ยกเลิกเพื่อสร้างใหม่', v_actor));
  r2 := pg_temp.q(format('select analytics.job_create_from_production_item(%L, %L, %L::text[], null, null, null, %L)', p_shop, v_poi, pg_temp.std(), v_actor));
  v_log := v_log || pg_temp.chk('T11c', 'ยกเลิกใบงานแล้วสร้างใหม่จาก item เดิมได้ (unique เฉพาะที่ไม่ cancelled) · เลขใหม่ไม่ซ้ำเลขเก่า',
    r2 ? 'job_id' and (r2 ->> 'job_no') <> (a ->> 'job_no'));
  a := r2;

  -- ใบผลิตที่ยกเลิกแล้ว
  v_po2 := pg_temp.q(format('select pg_temp.po_save(p_shop_id=>%L, p_note=>%L)', p_shop, 'verify0172-b'));
  v_po2_id := (v_po2 ->> 'id')::uuid;
  perform analytics.production_order_item_set(p_shop, v_po2_id, v_prod, 5);
  select id into v_poi2 from analytics.production_order_item where production_order_id = v_po2_id;
  perform analytics.production_order_cancel(p_shop, v_po2_id, 'verify');
  v_log := v_log || pg_temp.chk('T11d', 'ใบผลิตที่ cancelled สร้างใบงานไม่ได้ (po_not_open) ทั้งทาง RPC และ INSERT ตรง', pg_temp.code(
    pg_temp.q(format('select analytics.job_create_from_production_item(%L, %L, %L::text[], null, null, null, %L)', p_shop, v_poi2, pg_temp.std(), v_actor))) = 'po_not_open'
    and pg_temp.x(format('insert into analytics.job (shop_id, seq, source_kind, production_order_item_id, product_id, design_label, metal, qty_planned, weigh_required, created_by)
        values (%L, 9001, ''production'', %L, %L, ''x'', ''silver'', 5, true, %L)', p_shop, v_poi2, v_prod, v_actor)) like 'ERR:22023:%ยังเปิดอยู่%');

  -- ---------- ข้ามร้าน / อินพุตผิด ----------
  insert into public.shop (name) values ('verify0172-shop2') returning id into v_shop2;
  v_log := v_log || pg_temp.chk('T07a', 'สร้างใบงานด้วย p_shop_id ของร้านอื่น (item เป็นของร้านแรก) ถูกปฏิเสธ item_not_found', pg_temp.code(
    pg_temp.q(format('select analytics.job_create_from_production_item(%L, %L, %L::text[], null, null, null, %L)', v_shop2, v_poi, pg_temp.std(), v_actor))) = 'item_not_found');
  v_log := v_log || pg_temp.chk('T07b', 'INSERT job ตรงด้วย shop_id ร้านอื่นแต่ item ของร้านแรก ถูก trigger ปฏิเสธ', pg_temp.x(format(
    'insert into analytics.job (shop_id, seq, source_kind, production_order_item_id, product_id, design_label, metal, qty_planned, weigh_required, created_by)
     values (%L, 1, ''production'', %L, %L, ''x'', ''silver'', 10, true, %L)', v_shop2, v_poi, v_prod, v_actor)) like 'ERR:%ข้ามร้าน%');
  v_log := v_log || pg_temp.chk('T11e', 'item ที่ไม่มีอยู่จริง / source_kind แปลก / พารามิเตอร์ null ถูกปฏิเสธ', pg_temp.code(
    pg_temp.q(format('select analytics.job_stage_suggest(%L, %L, %L)', p_shop, 'production', gen_random_uuid()))) = 'item_not_found'
    and pg_temp.code(pg_temp.q(format('select analytics.job_stage_suggest(%L, %L, %L)', p_shop, 'xyz', v_poi))) = 'source_invalid'
    and (pg_temp.q('select analytics.job_stage_suggest(null, ''oem'', null)') ->> '_state') = '22023');

  -- ---------- สร้างจาก OEM: ทุกสถานะ/ทุกโลหะที่มีจริงบน DB (ข้อ 17 ของ migration-traps) ----------
  for rec in
    select i.id as item_id, q.status as qstatus, q.quote_no, i.input ->> 'metal' as metal, i.seq, coalesce(q.root_quote_id, q.id) as root_id,
           (select coalesce(v.paid_thb, 0) from analytics.v_oem_quote v where v.id = q.id) as paid
      from analytics.oem_quote_item i join analytics.oem_quote q on q.id = i.quote_id
     where i.shop_id = p_shop and q.quote_no not like 'V172-%'
     order by q.quote_no, i.seq
  loop
    v_n := v_n + 1;
    -- 0173: ไม่ยิงสร้างจากใบเสนอราคาจริง — โคลนรายการจริง (สถานะ/โลหะ/input/ดีลเดียวกัน → ยอดมัดจำเท่าของจริง) เป็นใบทดสอบก่อน
    d := pg_temp.clone_deal(rec.item_id, rec.metal, 3, rec.root_id, rec.qstatus, null, null, rec.seq);
    r := pg_temp.q(format('select analytics.job_stage_suggest(%L, %L, %L)', p_shop, 'oem', d ->> 'item_id'));
    r2 := pg_temp.q(format('select pg_temp.jcq(%L, %L, %L::text[], null, %L, null, null, %L)',
            p_shop, d ->> 'item_id', pg_temp.std(), case when rec.paid <= 0 then 'verify: เริ่มผลิตก่อนมัดจำ' else null end, v_actor));
    if rec.qstatus = 'won' and rec.metal in ('silver', 'gold', 'brass') then
      if rec.paid > 0 then v_pn := v_pn + 1; end if;
      if r ? 'suggested_stage_codes' and r2 ? 'job_id' and (r ->> 'deposit_missing')::boolean = (rec.paid <= 0) then
        v_ok := v_ok + 1;
        if rec.paid > 0 and (select j.start_gate_note is null from analytics.job j where j.id = (r2 ->> 'job_id')::uuid) then v_pok := v_pok + 1; end if;
      else v_bad := v_bad || rec.quote_no || '#' || rec.seq || '(ควรสร้างได้ แต่ ' || coalesce(r2 ->> '_err', 'suggest ผิด') || ') '; end if;
    elsif rec.qstatus <> 'won' then
      if pg_temp.code(r) = 'quote_not_won' and pg_temp.code(r2) = 'quote_not_won' then v_rej := v_rej + 1;
      else v_bad := v_bad || rec.quote_no || '#' || rec.seq || '(' || rec.qstatus || ' ควรถูกปฏิเสธ quote_not_won แต่ได้ ' || coalesce(pg_temp.code(r2), 'สร้างได้') || ') '; end if;
    else
      if pg_temp.code(r) = 'metal_unsupported' and pg_temp.code(r2) = 'metal_unsupported' then v_rej := v_rej + 1;
      else v_bad := v_bad || rec.quote_no || '#' || rec.seq || '(' || coalesce(rec.metal, 'null') || ' ควรถูกปฏิเสธ metal_unsupported แต่ได้ ' || coalesce(pg_temp.code(r2), 'สร้างได้') || ') '; end if;
    end if;
  end loop;
  if v_n = 0 then
    v_log := v_log || '[SKIP] N11  ไม่มี oem_quote_item จริงบน DB — พิสูจน์ "ยิงใส่ข้อมูลจริงทุกโหมด" ไม่ได้' || E'\n';
  else
    v_log := v_log || pg_temp.chk('N11', format('ยิง suggest+create ใส่ quote item จริงทุกใบบน DB %s รายการ: ได้งาน(won+เงิน/ทอง/ทองเหลือง) %s · ถูกปฏิเสธถูกต้อง %s · ผิดคาด: %s',
      v_n, v_ok, v_rej, coalesce(nullif(v_bad, ''), '(ไม่มี)')), v_bad = '' and v_ok + v_rej = v_n);
  end if;

  -- ---------- โลหะ ----------
  b := pg_temp.clone_deal(p_tpl, 'product', 3, null, 'won');
  d := pg_temp.clone_deal(p_tpl, 'silver999', 3, null, 'won');
  v_log := v_log || pg_temp.chk('T11f', 'item ที่ metal=product และ silver999 (ใบ won) สร้างใบงานไม่ได้ (metal_unsupported) · suggest ก็ปฏิเสธ',
    pg_temp.code(pg_temp.q(format('select pg_temp.jcq(%L, %L, %L::text[], null, %L, null, null, %L)', p_shop, b ->> 'item_id', pg_temp.std(), 'verify-gate-note', v_actor))) = 'metal_unsupported'
    and pg_temp.code(pg_temp.q(format('select pg_temp.jcq(%L, %L, %L::text[], null, %L, null, null, %L)', p_shop, d ->> 'item_id', pg_temp.std(), 'verify-gate-note', v_actor))) = 'metal_unsupported'
    and pg_temp.code(pg_temp.q(format('select analytics.job_stage_suggest(%L, %L, %L)', p_shop, 'oem', b ->> 'item_id'))) = 'metal_unsupported');
  v_log := v_log || pg_temp.chk('T11g', 'INSERT job ตรงด้วย metal ไม่ตรง item / ไม่ใช่ silver-gold-brass ถูกปฏิเสธ (trigger + CHECK)',
    pg_temp.x(format('insert into analytics.job (shop_id, seq, source_kind, oem_quote_item_id, root_quote_id, oem_item_seq, design_label, metal, qty_planned, weigh_required, created_by)
       select %L, 9002, ''oem'', i.id, q.root_quote_id, i.seq, ''x'', ''gold'', 3, true, %L from analytics.oem_quote_item i join analytics.oem_quote q on q.id = i.quote_id where i.id = %L',
       p_shop, v_actor, b ->> 'item_id')) like 'ERR:22023:%โลหะของใบงานไม่ตรง%'
    and pg_temp.x(format('insert into analytics.job (shop_id, seq, source_kind, oem_quote_item_id, root_quote_id, oem_item_seq, design_label, metal, qty_planned, weigh_required, created_by)
       select %L, 9003, ''oem'', i.id, q.root_quote_id, i.seq, ''x'', ''platinum'', 3, true, %L from analytics.oem_quote_item i join analytics.oem_quote q on q.id = i.quote_id where i.id = %L',
       p_shop, v_actor, b ->> 'item_id')) like 'ERR:%');
  d := pg_temp.clone_deal(p_tpl, 'silver', 3, null, 'quoted');
  v_log := v_log || pg_temp.chk('T11h', 'INSERT job ตรงจาก quote ที่ไม่ใช่ won (quoted) ถูกปฏิเสธ (กัน service key ข้าม RPC)', pg_temp.x(format(
    'insert into analytics.job (shop_id, seq, source_kind, oem_quote_item_id, root_quote_id, oem_item_seq, design_label, metal, qty_planned, weigh_required, created_by)
     select %L, 9004, ''oem'', i.id, coalesce(q.root_quote_id, q.id), i.seq, ''x'', ''silver'', 3, true, %L
       from analytics.oem_quote_item i join analytics.oem_quote q on q.id = i.quote_id
      where i.id = %L', p_shop, v_actor, d ->> 'item_id')) like 'ERR:22023:%won%');

  -- ---------- #12 รายการขั้นตอน ----------
  d := pg_temp.clone_deal(p_tpl, 'silver', 4, null, 'won');
  v_x := format('select pg_temp.jcq(%L, %L, %%L::text[], null, %L, null, null, %L)', p_shop, d ->> 'item_id', 'verify-gate-note', v_actor);
  v_log := v_log || pg_temp.chk('T12a', 'รายการขั้นตอนว่าง/NULL ถูกปฏิเสธ stages_empty',
    pg_temp.code(pg_temp.q(format(v_x, '{}'))) = 'stages_empty'
    and pg_temp.code(pg_temp.q(replace(format(v_x, 'x'), '''x''::text[]', 'null::text[]'))) = 'stages_empty');
  v_log := v_log || pg_temp.chk('T12b', 'ไม่มี qc หรือไม่มี pack ถูกปฏิเสธ stages_need_qc_pack',
    pg_temp.code(pg_temp.q(format(v_x, '{cast,pack}'))) = 'stages_need_qc_pack' and pg_temp.code(pg_temp.q(format(v_x, '{cast,qc}'))) = 'stages_need_qc_pack');
  v_log := v_log || pg_temp.chk('T12c', 'เรียงไม่ตามลำดับมาตรฐาน (qc ก่อน cast / pack ก่อน qc) ถูกปฏิเสธ stages_order',
    pg_temp.code(pg_temp.q(format(v_x, '{qc,cast,pack}'))) = 'stages_order' and pg_temp.code(pg_temp.q(format(v_x, '{cast,pack,qc}'))) = 'stages_order');
  v_log := v_log || pg_temp.chk('T12d', 'ขั้นซ้ำ / code ที่ไม่มีในทะเบียน ถูกปฏิเสธ',
    pg_temp.code(pg_temp.q(format(v_x, '{cast,cast,qc,pack}'))) = 'stages_duplicate' and pg_temp.code(pg_temp.q(format(v_x, '{cast,hax,qc,pack}'))) = 'stages_unknown');
  update analytics.job_stage_def set is_active = false where shop_id = p_shop and code = 'mold';
  v_log := v_log || pg_temp.chk('T12e', 'ขั้นที่ปิดใช้งานในทะเบียน (mold) ถูกปฏิเสธ stages_unknown',
    pg_temp.code(pg_temp.q(format(v_x, '{mold,cast,qc,pack}'))) = 'stages_unknown');
  update analytics.job_stage_def set is_active = true where shop_id = p_shop and code = 'mold';
  r := pg_temp.q(format(v_x, '{cast,qc,pack}'));
  -- แบบที่ไม่ใช่แบบใหม่เลือก cad = เตือน ไม่ปฏิเสธ (ใช้ดีลโคลนใหม่ เพราะ 1 item สร้างได้ใบเดียว)
  d := pg_temp.clone_deal(p_tpl, 'silver', 4, null, 'won', null, false);
  r2 := pg_temp.q(format('select pg_temp.jcq(%L, %L, %L::text[], null, %L, null, null, %L)',
          p_shop, d ->> 'item_id', '{cad,cast,qc,pack}', 'verify-gate-note', v_actor));
  v_log := v_log || pg_temp.chk('T12f', 'ไม่ใช่แบบใหม่ แต่เลือก cad = สร้างได้ + warnings 1 รายการ (เตือน ไม่ปฏิเสธ) · ไม่เลือก = warnings ว่าง',
    r2 ? 'job_id' and jsonb_array_length(r2 -> 'warnings') = 1 and r ? 'job_id' and jsonb_array_length(r -> 'warnings') = 0);
  v_log := v_log || pg_temp.chk('N02', 'ใบงานข้าม gem_set/plating/3 ขั้น NRE สร้างได้ (stage = 8 ขั้นมาตรฐาน) · ใบแบบใหม่เสนอ cad,print3d,mold เป็นค่าเริ่มต้น',
    (select count(*) from analytics.job_stage s where s.job_id = (a ->> 'job_id')::uuid) = 8
    and (pg_temp.q(format('select analytics.job_stage_suggest(%L, %L, %L)', p_shop, 'oem', (pg_temp.clone_deal(p_tpl, 'silver', 4, null, 'won', null, true) ->> 'item_id'))) -> 'suggested_stage_codes') ?& array['cad', 'print3d', 'mold', 'qc', 'pack']
    and not ((pg_temp.q(format('select analytics.job_stage_suggest(%L, %L, %L)', p_shop, 'oem', (pg_temp.clone_deal(p_tpl, 'silver', 4, null, 'won', null, false) ->> 'item_id'))) -> 'suggested_stage_codes') ? 'cad'));

  -- DB-level (ข้าม RPC): ขั้นเรียงผิด / ขั้นที่ปิดใช้งาน
  r := pg_temp.mkjob(p_shop, p_tpl, 'silver', 4);
  v_log := v_log || pg_temp.chk('T12g', 'INSERT job_stage ตรงที่ลำดับขัด seq_default (cad ต่อท้าย pack) ถูก trigger ปฏิเสธ', pg_temp.x(format(
    'insert into analytics.job_stage (job_id, shop_id, stage_code, seq) values (%L, %L, ''cad'', 20)', r ->> 'job_id', p_shop)) like 'ERR:22023:%ลำดับขั้น%');
  insert into analytics.job_stage_def (shop_id, code, name_th, seq_default, cost_block, is_active) values (p_shop, 'verify_x', 'ขั้นทดสอบ', 999, 'per_piece', false);
  v_log := v_log || pg_temp.chk('T12h', 'INSERT job_stage ตรงด้วยขั้นที่ปิดใช้งาน ถูก trigger ปฏิเสธ', pg_temp.x(format(
    'insert into analytics.job_stage (job_id, shop_id, stage_code, seq) values (%L, %L, ''verify_x'', 21)', r ->> 'job_id', p_shop)) like 'ERR:22023:%ปิดใช้งาน%');
  v_log := v_log || pg_temp.chk('T12i', 'DELETE job_stage ตรงถูกปฏิเสธ · TRUNCATE job_stage ถูกปฏิเสธ',
    pg_temp.x(format('delete from analytics.job_stage where job_id = %L', r ->> 'job_id')) like 'ERR:22023:%'
    and pg_temp.x('truncate analytics.job_stage') like 'ERR:%');

  -- ---------- #13 ด่านมัดจำตอนสร้าง ----------
  d := pg_temp.clone_deal(p_tpl, 'silver', 4, null, 'won');
  v_x := format('select pg_temp.jcq(%L, %L, %L::text[], null, %%L, null, null, %L)', p_shop, d ->> 'item_id', pg_temp.std(), v_actor);
  v_log := v_log || pg_temp.chk('T13a', 'ดีลที่ยังไม่มีเงินเข้า สร้างใบงานโดยไม่มีเหตุผลเริ่มก่อนมัดจำ ถูกปฏิเสธ start_gate_required',
    pg_temp.code(pg_temp.q(replace(format(v_x, 'x'), '''x''', 'null'))) = 'start_gate_required');
  v_log := v_log || pg_temp.chk('T13b', 'เหตุผลที่ไม่ใช่ข้อความจริง ("." · ช่องว่างล้วน · อักขระล่องหน · อีโมจิล้วน) ถูกปฏิเสธ — whitelist ไม่ใช่ blacklist',
    pg_temp.code(pg_temp.q(format(v_x, '.'))) = 'start_gate_required'
    and pg_temp.code(pg_temp.q(format(v_x, '   '))) = 'start_gate_required'
    and (pg_temp.q(format(v_x, E'​​')) ->> '_state') = '22023' and not (pg_temp.q(format(v_x, E'​​')) ? 'job_id')
    and pg_temp.code(pg_temp.q(format(v_x, '👍'))) = 'start_gate_required'
    and pg_temp.code(pg_temp.q(format(v_x, E'⠀'))) in ('start_gate_required', '22023')
    and (pg_temp.q(format(v_x, repeat('ก', 501))) ->> '_state') = '22023');
  r := pg_temp.q(format(v_x, 'ลูกค้าโอนมัดจำพรุ่งนี้ เจ้าของอนุมัติให้เริ่ม'));
  v_log := v_log || pg_temp.chk('T13c', 'มีเหตุผลจริง → สร้างได้ · start_gate_note ถูกเก็บ · ไม่ปฏิเสธซ้ำ',
    r ? 'job_id' and (select j.start_gate_note is not null from analytics.job j where j.id = (r ->> 'job_id')::uuid));
  -- T13d: ดีลจริงที่มีมัดจำเข้าแล้ว (โคลนในดีลเดียวกัน N11 สร้างโดยไม่ส่งเหตุผล) ต้องได้ใบงานที่ start_gate_note ว่าง
  if v_pn = 0 then
    v_log := v_log || '[SKIP] T13d  ไม่มีใบ won+silver ที่มีมัดจำเข้าแล้วบน DB — พิสูจน์ "มีมัดจำสร้างได้โดยไม่ต้องมีเหตุผล" ด้วยข้อมูลจริงไม่ได้' || E'\n';
  else
    v_log := v_log || pg_temp.chk('T13d', format('ดีลที่มีมัดจำแล้ว %s รายการ (โคลนจากของจริง) สร้างใบงานได้โดยไม่ต้องมีเหตุผล (ไม่มีด่านมัดจำค้างผิดที่)', v_pn), v_pn = v_pok);
  end if;

  -- ---------- ทดสอบความสมบูรณ์: ผล suite ไม่ทิ้งแถวขยะนอก subtransaction (ตรวจที่ main) ----------
  return v_log;
end;
$s$;

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
-- ============================================================================
create function pg_temp.sB(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log   text := '';
  v_today date := analytics.job_today();
  v_msgs  text := '';
  js uuid; jg uuid; jb uuid; jd uuid; jf uuid; jx uuid; jn uuid; jh uuid; j2 uuid; jy uuid;
  r jsonb; r2 jsonb; r3 jsonb; m jsonb;
  v_n int; v_t text; v_ok boolean;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  js := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'silver', 10));
  jg := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'gold', 10));
  jb := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'brass', 10));
  jf := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'silver', 10));
  v_log := v_log || pg_temp.chk('B0', 'fixture ใบงานเงิน/ทอง/ทองเหลือง/เงินสด สร้างได้', js is not null and jg is not null and jb is not null and jf is not null);

  -- ---------- T08e กติกาชั่งต่อขั้นถูกกำหนดตอนสร้าง ----------
  v_log := v_log || pg_temp.chk('T08e', 'weigh_required ต่อขั้น: ทอง cast..pack · เงิน cast,cut_sprue,polish · ทองเหลืองไม่มี · job.weigh_required: ทอง/เงิน true ทองเหลือง false',
    (select string_agg(case when s.weigh_required then 't' else 'f' end, '' order by s.seq) from analytics.job_stage s where s.job_id = jg) = 'fffttttt'
    and (select string_agg(case when s.weigh_required then 't' else 'f' end, '' order by s.seq) from analytics.job_stage s where s.job_id = js) = 'ffftttff'
    and (select string_agg(case when s.weigh_required then 't' else 'f' end, '' order by s.seq) from analytics.job_stage s where s.job_id = jb) = 'ffffffff'
    and (select weigh_required from analytics.job where id = jg) and (select weigh_required from analytics.job where id = js)
    and not (select weigh_required from analytics.job where id = jb));

  -- ---------- #1 ลำดับ / auto-close ----------
  r := pg_temp.o_recv(p_shop, js, 3, v_today, null, null, 'ช่างเอ');
  v_log := v_log || pg_temp.chk('T01a', 'รับขั้น 3 ทั้งที่ขั้น 1-2 ยัง pending ถูกปฏิเสธ out_of_order · ไม่มีขั้นใดขยับ', pg_temp.code(r) = 'out_of_order' and pg_temp.st(js) = '1:pen,2:pen,3:pen,4:pen,5:pen,6:pen,7:pen,8:pen');
  v_log := v_log || pg_temp.chk('T01b', 'service key UPDATE job_stage ข้ามลำดับตรง (ข้าม RPC) ถูก trigger ปฏิเสธ', pg_temp.x(format(
    'update analytics.job_stage set status = ''received'', received_on = %L, qty_in = 10, assignee_name = ''x'' where job_id = %L and seq = 3', v_today, js)) like 'ERR:22023:%ข้ามลำดับ%');
  r := pg_temp.o_recv(p_shop, js, 1, v_today, null, null, 'ช่างเอ');
  r2 := pg_temp.o_recv(p_shop, js, 2, v_today, null, null, 'ช่างบี');
  v_log := v_log || pg_temp.chk('T01c', 'รับขั้น 2 ทั้งที่ขั้น 1 ยังถือค้าง (เงิน) = ปิดขั้น 1 อัตโนมัติ (auto_closed, qty_out=qty_in) แล้วรับขั้น 2 · event stage_send ของขั้น 1 ระบุ auto_closed',
    r ? 'ok' and r2 ? 'ok' and (r2 ->> 'prev_auto_closed') = 'true' and pg_temp.st(js) like '1:sen*,2:rec,3:pen%' and pg_temp.sv(js, 1, 'qty_out') = '10'
    and exists (select 1 from analytics.job_event e where e.job_id = js and e.event_type = 'stage_send' and (e.payload ->> 'auto_closed')::boolean));
  v_log := v_log || pg_temp.chk('T01f', 'รับขั้นที่ถูกรับแล้ว = ปฏิเสธ already_received · expected_seq ว่าง/ไม่มีอยู่จริง = stage_changed',
    pg_temp.code(pg_temp.o_recv(p_shop, js, 2, v_today, null, null, 'ช่างเอ')) = 'already_received'
    and pg_temp.code(pg_temp.q(format('select analytics.job_office_receive(%L, %L, null, %L, null, null, ''x'', ''job_page'', %L)', p_shop, js, v_today, '00000000-0000-0000-0000-0000000000a1'::uuid))) = 'stage_changed'
    and pg_temp.code(pg_temp.o_recv(p_shop, js, 99, v_today, null, null, 'ช่างเอ')) = 'stage_changed');

  -- ทอง: ห้าม auto-close
  r := pg_temp.o_recv(p_shop, jg, 1, v_today, null, null, 'ช่างทอง');
  r2 := pg_temp.o_recv(p_shop, jg, 2, v_today, null, null, 'ช่างทอง2');
  v_log := v_log || pg_temp.chk('T01d', 'งานทอง: รับขั้น 2 ขณะขั้น 1 ยังถือค้าง ถูกปฏิเสธ prev_not_sent · ขั้น 1 ยัง received (ไม่ถูกปิดอัตโนมัติ)',
    pg_temp.code(r2) = 'prev_not_sent' and pg_temp.st(jg) like '1:rec,2:pen%');
  v_log := v_log || pg_temp.chk('T08f', 'งานทอง: service key UPDATE ปิดขั้นแบบ auto_closed ตรง ถูก trigger ปฏิเสธ', pg_temp.x(format(
    'update analytics.job_stage set status = ''sent'', sent_on = %L, qty_out = qty_in, auto_closed = true where job_id = %L and seq = 1', v_today, jg)) like 'ERR:22023:%ทอง%');
  r := pg_temp.o_send(p_shop, jg, 1, v_today);
  r2 := pg_temp.o_recv(p_shop, jg, 2, v_today, null, null, 'ช่างทอง2');
  v_log := v_log || pg_temp.chk('T01e', 'ทอง: ส่งต่อขั้น 1 ปกติ (ขั้นขี้ผึ้งไม่บังคับชั่ง) แล้วรับขั้น 2 ได้ ไม่ใช่ auto', r ? 'ok' and r2 ? 'ok' and pg_temp.st(jg) like '1:sen,2:rec%');

  -- ---------- #2 / #8 น้ำหนัก ----------
  r := pg_temp.o_run(p_shop, js, 2, 3, v_today);
  v_log := v_log || pg_temp.chk('B1', 'เดินเงินถึงขั้น 3 (ไม่บังคับชั่ง) โดยไม่ใส่น้ำหนักเลขตามบังคับได้ — N01 เริ่มต้น', r ? 'ok');
  m := pg_temp.o_recv(p_shop, js, 4, v_today, null, null, 'ช่างเอ');
  v_msgs := v_msgs || coalesce(m ->> '_err', '');
  v_log := v_log || pg_temp.chk('T08a', 'เงิน ขั้นหล่อ (บังคับชั่ง) รับโดยไม่มีน้ำหนักเข้า ถูกปฏิเสธ weight_required', pg_temp.code(m) = 'weight_required');
  v_ok := true;
  foreach v_t in array array['0', '-1', 'NaN', 'Infinity', '100001', '1.2345', '0.0004'] loop
    m := pg_temp.q(format('select analytics.job_office_receive(%L, %L, 4, %L, %L::numeric, null, ''x'', ''job_page'', %L)', p_shop, js, v_today, v_t, '00000000-0000-0000-0000-0000000000a1'::uuid));
    v_msgs := v_msgs || coalesce(m ->> '_err', '');
    v_ok := v_ok and pg_temp.code(m) = 'weight_invalid';
  end loop;
  v_log := v_log || pg_temp.chk('T02a', 'น้ำหนักเข้า 0 / ติดลบ / NaN / Infinity / >100,000 / ทศนิยมเกิน 3 ตำแหน่ง ถูกปฏิเสธ weight_invalid ทุกค่า (migration-traps ข้อ 4)', v_ok and pg_temp.st(js) like '%,4:pen%');
  r := pg_temp.o_recv(p_shop, js, 4, v_today, 10.000, null, 'ช่างเอ');
  v_log := v_log || pg_temp.chk('B2', 'รับขั้นหล่อพร้อมน้ำหนัก 10.000 ได้', r ? 'ok' and pg_temp.sv(js, 4, 'weight_in_g') = '10.000');
  m := pg_temp.o_send(p_shop, js, 4, v_today, null);
  v_msgs := v_msgs || coalesce(m ->> '_err', '');
  v_log := v_log || pg_temp.chk('T08b', 'เงิน ขั้นหล่อ ส่งต่อโดยไม่มีน้ำหนักออก ถูกปฏิเสธ weight_required', pg_temp.code(m) = 'weight_required');
  m := pg_temp.o_send(p_shop, js, 4, v_today, 10.5);
  v_msgs := v_msgs || coalesce(m ->> '_err', '');
  v_log := v_log || pg_temp.chk('T02b', 'น้ำหนักออก 10.5 มากกว่าเข้า 10.000 ถูกปฏิเสธ weight_over · ข้อความบอกส่วนต่างเป็นภาษาคน', pg_temp.code(m) = 'weight_over' and (m ->> '_err') like '%0.5 g%');
  m := pg_temp.o_send(p_shop, js, 4, v_today, 10.8, 0, null, 1.000, null);
  v_msgs := v_msgs || coalesce(m ->> '_err', '');
  r2 := pg_temp.o_send(p_shop, js, 4, v_today, 10.8, 0, null, 1.000, '.');
  v_msgs := v_msgs || coalesce(r2 ->> '_err', '');
  v_log := v_log || pg_temp.chk('T02c', 'เติมโลหะ > 0 ไม่มีหมายเหตุ หรือหมายเหตุไม่ใช่ข้อความจริง ("." ) ถูกปฏิเสธ note_required', pg_temp.code(m) = 'note_required' and pg_temp.code(r2) = 'note_required');
  m := pg_temp.o_send(p_shop, js, 4, v_today, 10.8, 0, null, 1.000, 'เติมโลหะบัดกรีเพิ่ม');
  v_log := v_log || pg_temp.chk('T02d', 'เติมโลหะ 1.000 g + หมายเหตุจริง → น้ำหนักออก 10.8 ผ่าน · เก็บ metal_added_g/weight_note ครบ',
    m ? 'ok' and pg_temp.sv(js, 4, 'metal_added_g') = '1.000' and pg_temp.sv(js, 4, 'weight_note') = 'เติมโลหะบัดกรีเพิ่ม' and pg_temp.sv(js, 4, 'status') = 'sent');
  -- ขั้น 5: ตรวจ CHECK ระดับตาราง (ข้าม RPC)
  r := pg_temp.o_recv(p_shop, js, 5, v_today, 10.000, null, 'ช่างเอ');
  v_log := v_log || pg_temp.chk('T02e', 'service key UPDATE ส่งต่อด้วยน้ำหนักออก 20 > เข้า 10 ถูก CHECK (js_weight_ck) ปฏิเสธ', pg_temp.x(format(
    'update analytics.job_stage set status = ''sent'', sent_on = %L, qty_out = qty_in, weight_out_g = 20 where job_id = %L and seq = 5', v_today, js)) like 'ERR:23514:%js_weight_ck%');
  v_log := v_log || pg_temp.chk('T02f', 'service key UPDATE เติมโลหะ > 0 โดยไม่มีหมายเหตุ ถูก CHECK (js_metal_added_ck) ปฏิเสธ', pg_temp.x(format(
    'update analytics.job_stage set status = ''sent'', sent_on = %L, qty_out = qty_in, weight_out_g = 10, metal_added_g = 1 where job_id = %L and seq = 5', v_today, js)) like 'ERR:23514:%js_metal_added_ck%');
  v_log := v_log || pg_temp.chk('T02g', 'service key UPDATE ส่งต่อขั้นบังคับชั่งโดยไม่มีน้ำหนักออก (ไม่ใช่ auto_closed) ถูก CHECK (js_weigh_out_ck) ปฏิเสธ', pg_temp.x(format(
    'update analytics.job_stage set status = ''sent'', sent_on = %L, qty_out = qty_in where job_id = %L and seq = 5', v_today, js)) like 'ERR:23514:%js_weigh_out_ck%');

  -- ---------- #3 จำนวน ----------
  m := pg_temp.o_send(p_shop, js, 5, v_today, 9.0, 11);
  v_msgs := v_msgs || coalesce(m ->> '_err', '');
  r2 := pg_temp.o_send(p_shop, js, 5, v_today, 9.0, -1);
  v_log := v_log || pg_temp.chk('T03a', 'ของเสียมากกว่าจำนวนเข้า (11 > 10) หรือติดลบ ถูกปฏิเสธ qty_invalid', pg_temp.code(m) = 'qty_invalid' and pg_temp.code(r2) = 'qty_invalid');
  v_ok := true;
  foreach v_t in array array['', '.', '   ', E'​', E'⠀', '👍'] loop
    m := pg_temp.o_send(p_shop, js, 5, v_today, 9.0, 2, v_t);
    v_ok := v_ok and pg_temp.code(m) = 'reason_required';
  end loop;
  v_log := v_log || pg_temp.chk('T03b', 'ของเสียไม่มีเหตุผล / เหตุผลเป็น "." ช่องว่าง อักขระล่องหน อีโมจิล้วน ถูกปฏิเสธ reason_required (ไม่มีช่อง "หายเฉยๆ")', v_ok);
  v_log := v_log || pg_temp.chk('T03c', 'ไม่มีของเสียแต่ส่งเหตุผลมา = ปฏิเสธ reason_unexpected', pg_temp.code(pg_temp.o_send(p_shop, js, 5, v_today, 9.0, 0, 'porosity')) = 'reason_unexpected');
  v_log := v_log || pg_temp.chk('T03d', 'service key UPDATE ส่งต่อด้วย qty_out + qty_scrap <> qty_in ถูก CHECK (js_sent_ck) ปฏิเสธ', pg_temp.x(format(
    'update analytics.job_stage set status = ''sent'', sent_on = %L, qty_out = 5, qty_scrap = 2, scrap_reason = ''porosity'', weight_out_g = 9 where job_id = %L and seq = 5', v_today, js)) like 'ERR:23514:%js_sent_ck%');
  v_log := v_log || pg_temp.chk('T03e', 'service key UPDATE ของเสีย > 0 ไม่มีเหตุผล ถูก CHECK (js_scrap_reason_ck) ปฏิเสธ', pg_temp.x(format(
    'update analytics.job_stage set status = ''sent'', sent_on = %L, qty_out = 9, qty_scrap = 1, weight_out_g = 9 where job_id = %L and seq = 5', v_today, js)) like 'ERR:23514:%js_scrap_reason_ck%');
  m := pg_temp.o_send(p_shop, js, 5, v_today, 9.0, 2, 'porosity');
  r2 := pg_temp.o_recv(p_shop, js, 6, v_today, 8.0, null, 'ช่างเอ');
  v_log := v_log || pg_temp.chk('T03f', 'ของเสีย 2 ชิ้น (porosity) ส่งต่อได้ → ขั้นถัดไป qty_in = 8 (เท่า qty_out ขั้นก่อน) · ผลรวมเข้า=ออก+เสีย',
    m ? 'ok' and (m ->> 'qty_out') = '8' and r2 ? 'ok' and pg_temp.sv(js, 6, 'qty_in') = '8');
  v_log := v_log || pg_temp.chk('T03g', 'service key: จำนวนเข้าของขั้นแรก <> qty_planned และของขั้นถัดไป <> qty_out ขั้นก่อน ถูก trigger ปฏิเสธ',
    pg_temp.x(format('update analytics.job_stage set status = ''received'', received_on = %L, qty_in = 9, assignee_name = ''x'' where job_id = %L and seq = 1', v_today, jf)) like 'ERR:22023:%จำนวนเข้า%'
);

  -- ---------- #4 ย้อนขั้น ----------
  v_ok := true;
  foreach v_t in array array['', '   ', '.', E'​'] loop
    m := pg_temp.q(format('select analytics.job_stage_reopen(%L, %L, %L, %L)', p_shop, js, v_t, '00000000-0000-0000-0000-0000000000a1'::uuid));
    v_ok := v_ok and (m ->> '_state') = '22023' and pg_temp.st(js) like '%,5:sen,6:rec,%';
  end loop;
  v_log := v_log || pg_temp.chk('T04a', 'ย้อนขั้นโดยไม่มีเหตุผล/เหตุผลไม่ใช่ข้อความจริง ถูกปฏิเสธ · สถานะขั้นไม่ขยับ', v_ok
    and (pg_temp.q(format('select analytics.job_stage_reopen(%L, %L, null, %L)', p_shop, js, '00000000-0000-0000-0000-0000000000a1'::uuid)) ->> '_state') = '22023');
  r := pg_temp.q(format('select analytics.job_stage_reopen(%L, %L, %L, %L)', p_shop, js, 'ช่างรับผิดงาน ย้อนให้รับใหม่', '00000000-0000-0000-0000-0000000000a1'::uuid));
  v_log := v_log || pg_temp.chk('T04b', 'ย้อนจากขั้นล่าสุด (6 received -> pending) พร้อมเหตุผล · ฟิลด์รับถูกล้าง · event เก็บค่าเก่าใน payload.before',
    (r ->> 'to') = 'pending' and pg_temp.sv(js, 6, 'worker_id') is null and pg_temp.sv(js, 6, 'qty_in') is null
    and exists (select 1 from analytics.job_event e where e.job_id = js and e.event_type = 'stage_reopen' and e.payload -> 'before' ->> 'status' = 'received' and e.payload -> 'after' ->> 'status' = 'pending'));
  r := pg_temp.q(format('select analytics.job_stage_reopen(%L, %L, %L, %L)', p_shop, js, 'ขั้นหล่อ/ตัดต้นนับของเสียผิด ขอแก้', '00000000-0000-0000-0000-0000000000a1'::uuid));
  v_log := v_log || pg_temp.chk('T04c', 'ย้อนอีกขั้น (5 sent -> received): ฟิลด์ฝั่งส่งถูกล้าง · ค่าเดิม (ของเสีย 2 / porosity / น้ำหนักออก 9.000) อยู่ใน event payload.before',
    (r ->> 'to') = 'received' and pg_temp.sv(js, 5, 'qty_scrap') = '0' and pg_temp.sv(js, 5, 'weight_out_g') is null
    and exists (select 1 from analytics.job_event e where e.job_id = js and e.event_type = 'stage_reopen' and e.payload -> 'before' ->> 'status' = 'sent'
                 and (e.payload -> 'before' ->> 'qty_scrap') = '2' and e.payload -> 'before' ->> 'scrap_reason' = 'porosity' and (e.payload -> 'before' ->> 'weight_out_g')::numeric = 9.000));
  v_log := v_log || pg_temp.chk('T04d', 'service key ย้อนข้ามขั้น (4 sent -> received ทั้งที่ขั้น 5 received) และ sent -> pending ถูก trigger ปฏิเสธ',
    pg_temp.x(format('update analytics.job_stage set status = ''received'', sent_on = null, qty_out = null, qty_scrap = 0, scrap_reason = null, weight_out_g = null, metal_added_g = 0, weight_note = null, auto_closed = false where job_id = %L and seq = 4', js)) like 'ERR:22023:%ย้อนข้ามขั้น%'
    and pg_temp.x(format('update analytics.job_stage set status = ''pending'' where job_id = %L and seq = 4', js)) like 'ERR:22023:%เปลี่ยนสถานะ%');
  v_log := v_log || pg_temp.chk('T04e', 'ช่างย้อน/ข้าม/ปิด/ยกเลิก/ตั้งกำหนดส่งผ่าน QR ไม่ได้: RPC ฝั่งช่างมีแค่ resolve/receive/send/logout + pin_verify · ไม่มี parameter เลือกขั้นเอง (stage_code)',
    (select string_agg(proname, ',' order by proname) from pg_proc where pronamespace = 'analytics'::regnamespace and proname like 'job\_worker\_%' and proname <> 'job_worker_auth') = 'job_worker_logout,job_worker_receive,job_worker_resolve,job_worker_send'
    and not exists (select 1 from pg_proc where pronamespace = 'analytics'::regnamespace and proname in ('job_worker_receive', 'job_worker_send', 'job_worker_resolve', 'job_worker_logout', 'worker_pin_verify')
                     and (pg_get_function_arguments(oid) ilike '%stage_code%' or pg_get_function_arguments(oid) ilike '%p_stage%')));
  -- N03: ย้อนแล้วเดินใหม่จนจบ
  r := pg_temp.o_send(p_shop, js, 5, v_today, 9.5);
  r2 := pg_temp.o_run(p_shop, js, 6, 8, v_today);
  v_log := v_log || pg_temp.chk('N03', 'ย้อนขั้นแล้วเดินใหม่จนครบ 8 ขั้นได้ (ส่ง 5 ใหม่ ไม่มีของเสีย → จำนวนเข้าขั้นถัดไปกลับเป็น 10)',
    r ? 'ok' and r2 ? 'ok' and pg_temp.st(js) = '1:sen*,2:sen,3:sen,4:sen,5:sen,6:sen,7:sen,8:sen' and pg_temp.sv(js, 6, 'qty_in') = '10');

  -- ---------- #10 ปิดงาน ----------
  r := pg_temp.q(format('select analytics.job_done(%L, %L, 10, 0, null, null, %L)', p_shop, jf, '00000000-0000-0000-0000-0000000000a1'::uuid));
  v_log := v_log || pg_temp.chk('T10a', 'ปิดงานขณะทุกขั้นยัง pending ถูกปฏิเสธ stages_open · และ service key UPDATE status=done ตรงถูก trigger ปฏิเสธ',
    pg_temp.code(r) = 'stages_open' and pg_temp.x(format('update analytics.job set status = ''done'', done_at = now(), qty_good = 10, qty_scrap = 0 where id = %L', jf)) like 'ERR:22023:%ปิดงานไม่ได้%');
  v_ok := true;
  foreach v_t in array array['9,0', '11,0', '10,1', '-1,11'] loop
    m := pg_temp.q(format('select analytics.job_done(%L, %L, %s, %L)', p_shop, js, v_t || ', null, null', '00000000-0000-0000-0000-0000000000a1'::uuid));
    v_ok := v_ok and pg_temp.code(m) = 'qty_mismatch';
  end loop;
  v_log := v_log || pg_temp.chk('T10b', 'ปิดงานด้วยจำนวนดี+เสีย ≠ จำนวนวางแผน (9+0 · 11+0 · 10+1 · -1+11) ถูกปฏิเสธ qty_mismatch', v_ok and pg_temp.code(pg_temp.q(format('select analytics.job_done(%L, %L, null, null, null, null, %L)', p_shop, js, '00000000-0000-0000-0000-0000000000a1'::uuid))) = 'qty_mismatch');
  v_log := v_log || pg_temp.chk('T10c', 'เงินปิดงานโดยไม่ต้องมีน้ำหนักสุทธิได้ (N01: เงินไม่ชั่งเลยที่ปลายทางก็เดินจนจบได้) · น้ำหนักสุทธิผิดรูป (0/NaN/4 ทศนิยม) ถูกปฏิเสธ',
    pg_temp.code(pg_temp.q(format('select analytics.job_done(%L, %L, 10, 0, 0, null, %L)', p_shop, js, '00000000-0000-0000-0000-0000000000a1'::uuid))) = 'weight_invalid'
    and pg_temp.code(pg_temp.q(format('select analytics.job_done(%L, %L, 10, 0, %L::numeric, null, %L)', p_shop, js, 'NaN', '00000000-0000-0000-0000-0000000000a1'::uuid))) = 'weight_invalid'
    and pg_temp.code(pg_temp.q(format('select analytics.job_done(%L, %L, 10, 0, 1.2345, null, %L)', p_shop, js, '00000000-0000-0000-0000-0000000000a1'::uuid))) = 'weight_invalid');
  r := pg_temp.tok(p_shop, js);
  r2 := pg_temp.q(format('select analytics.job_done(%L, %L, 10, 0, null, null, %L)', p_shop, js, '00000000-0000-0000-0000-0000000000a1'::uuid));
  v_log := v_log || pg_temp.chk('T10d', 'ปิดงานเงินสำเร็จ · token ที่ออกไว้ถูกเพิกถอน (job_done) · มี event done · done_at ถูกบันทึก (N01 จบ)',
    r2 ? 'ok' and (select status = 'done' and done_at is not null and qty_good = 10 from analytics.job where id = js)
    and not exists (select 1 from analytics.job_token t where t.job_id = js and t.revoked_at is null)
    and exists (select 1 from analytics.job_event e where e.job_id = js and e.event_type = 'done'));

  -- ทอง: ผลิตจนครบ แล้วปิด
  r := pg_temp.o_run(p_shop, jg, 2, 8, v_today);
  m := pg_temp.q(format('select analytics.job_done(%L, %L, 10, 0, null, null, %L)', p_shop, jg, '00000000-0000-0000-0000-0000000000a1'::uuid));
  r2 := pg_temp.q(format('select analytics.job_done(%L, %L, 10, 0, 9.870, null, %L)', p_shop, jg, '00000000-0000-0000-0000-0000000000a1'::uuid));
  v_log := v_log || pg_temp.chk('T10e', 'งานทอง (ชั่งครบ cast..pack): ปิดโดยไม่มีน้ำหนักสุทธิถูกปฏิเสธ weight_required · มีน้ำหนักสุทธิ 9.870 ปิดได้',
    r ? 'ok' and pg_temp.code(m) = 'weight_required' and r2 ? 'ok' and (select weight_final_g = 9.870 from analytics.job where id = jg));
  v_log := v_log || pg_temp.chk('T10f', 'service key UPDATE status=done ตรงโดยไม่มี qty_good/qty_scrap ถูก CHECK (job_done_ck) ปฏิเสธ', pg_temp.x(format(
    'update analytics.job set status = ''done'', done_at = now() where id = %L', jb)) like 'ERR:%');


  -- ---------- #8 ทอง: รับ/ส่งไม่มีน้ำหนักที่ขั้นโลหะ ----------
  jh := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'gold', 10));
  r := pg_temp.o_run(p_shop, jh, 1, 3, v_today);
  m := pg_temp.o_recv(p_shop, jh, 4, v_today, null, null, 'ช่างทอง');
  r2 := pg_temp.o_recv(p_shop, jh, 4, v_today, 9.900, null, 'ช่างทอง');   -- ขั้น 3 ส่งออก 9.900 → ทองรับต่างเกิน 0.05 g ถูกปฏิเสธ (0173)
  r3 := pg_temp.o_send(p_shop, jh, 4, v_today, null);
  v_log := v_log || pg_temp.chk('T08a2', 'ทอง ขั้นหล่อ: รับไม่มีน้ำหนักเข้า = weight_required · รับมีน้ำหนักได้ · ส่งไม่มีน้ำหนักออก = weight_required',
    pg_temp.code(m) = 'weight_required' and r2 ? 'ok' and pg_temp.code(r3) = 'weight_required');
  v_ok := true;
  foreach v_n in array array[5, 6, 7, 8] loop
    r := pg_temp.o_send(p_shop, jh, v_n - 1, v_today, 9.9);
    m := pg_temp.o_recv(p_shop, jh, v_n, v_today, null, null, 'ช่างทอง');
    v_ok := v_ok and pg_temp.code(m) = 'weight_required';
    r2 := pg_temp.o_recv(p_shop, jh, v_n, v_today, 9.9, null, 'ช่างทอง');
    v_ok := v_ok and r2 ? 'ok';
  end loop;
  v_log := v_log || pg_temp.chk('T08b2', 'ทอง ทุกขั้น cast..pack (ตัดต้น ขัด ฝังพลอย/QC แพ็ก) รับโดยไม่มีน้ำหนักถูกปฏิเสธทั้ง 4 ขั้นที่เหลือ', v_ok);
  v_log := v_log || pg_temp.chk('T08c', 'service key: INSERT job ทองที่ weigh_required=false ถูก CHECK ปฏิเสธ · UPDATE weigh_required ตรงถูก trigger ปฏิเสธ',
    pg_temp.x(format('insert into analytics.job (shop_id, seq, source_kind, production_order_item_id, product_id, design_label, metal, qty_planned, weigh_required, created_by)
       select poi.shop_id, 9100, ''production'', poi.id, poi.product_id, ''x'', ''gold'', 1, false, %L from analytics.production_order_item poi
        join analytics.production_order po on po.id = poi.production_order_id where po.status = ''open'' limit 1', '00000000-0000-0000-0000-0000000000a1'::uuid)) like 'ERR:%job_gold_weigh_ck%'
    and pg_temp.x(format('update analytics.job set weigh_required = false where id = %L', jg)) like 'ERR:22023:%');

  -- ---------- N01: เงิน/ทองเหลืองเดินจนจบโดยไม่ชั่งขั้นที่ไม่บังคับ ----------
  jn := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'brass', 6));
  v_ok := true;
  for v_n in 1 .. 8 loop
    r := pg_temp.o_recv(p_shop, jn, v_n, v_today, null, null, 'ช่างทองเหลือง');
    r2 := pg_temp.o_send(p_shop, jn, v_n, v_today, null);
    v_ok := v_ok and r ? 'ok' and r2 ? 'ok';
  end loop;
  r := pg_temp.q(format('select analytics.job_done(%L, %L, 6, 0, null, null, %L)', p_shop, jn, '00000000-0000-0000-0000-0000000000a1'::uuid));
  v_log := v_log || pg_temp.chk('N01', 'ทองเหลืองไม่ชั่งเลยทั้ง 8 ขั้น เดินและปิดงานได้', v_ok and r ? 'ok');

  -- เงิน auto-close ขั้นบังคับชั่ง (ไม่มีน้ำหนักออก) -> ยอมได้ แต่ต้องโผล่ใน v_job_stage_loss.not_weighed (R3)
  j2 := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'silver', 10));
  r := pg_temp.o_run(p_shop, j2, 1, 3, v_today);
  r2 := pg_temp.o_recv(p_shop, j2, 4, v_today, 10.0, null, 'ช่างเอ');
  r3 := pg_temp.o_recv(p_shop, j2, 5, v_today, 10.0, null, 'ช่างบี');
  v_log := v_log || pg_temp.chk('T08g', '0173 QA6: เงิน ขั้นหล่อ (บังคับชั่ง) ผู้ถือยังไม่ส่งต่อ/ยังไม่มีน้ำหนักออก → คนถัดไปรับไม่ได้ ไม่ปิดอัตโนมัติ (prev_not_sent) · ขั้นยังเป็น received',
    pg_temp.code(r3) = 'prev_not_sent' and pg_temp.st(j2) like '%,4:rec,5:pen%');

  -- ---------- #9 วันที่ ----------
  jd := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'silver', 10));
  v_ok := true;
  foreach v_t in array array[(v_today + 1)::text, (v_today - 15)::text] loop
    m := pg_temp.q(format('select analytics.job_office_receive(%L, %L, 1, %L::date, null, null, ''x'', ''job_page'', %L)', p_shop, jd, v_t, '00000000-0000-0000-0000-0000000000a1'::uuid));
    v_ok := v_ok and pg_temp.code(m) = 'date_invalid';
  end loop;
  m := pg_temp.q(format('select analytics.job_office_receive(%L, %L, 1, null, null, null, ''x'', ''job_page'', %L)', p_shop, jd, '00000000-0000-0000-0000-0000000000a1'::uuid));
  v_log := v_log || pg_temp.chk('T09a', 'วันที่รับ: พรุ่งนี้ / ย้อนหลัง 15 วัน / null ถูกปฏิเสธ date_invalid', v_ok and pg_temp.code(m) = 'date_invalid' and pg_temp.st(jd) like '1:pen%');
  r := pg_temp.o_recv(p_shop, jd, 1, v_today - 14, null, null, 'ช่างเอ');
  v_log := v_log || pg_temp.chk('T09b', 'วันที่รับย้อนหลังพอดี 14 วัน ผ่าน (ขอบเขตไม่เกินหนึ่งวัน) · event เก็บ occurred_on = วันจริง และ recorded_at = เวลาบันทึก (คนละค่า)',
    r ? 'ok' and exists (select 1 from analytics.job_event e where e.job_id = jd and e.event_type = 'stage_receive' and e.occurred_on = v_today - 14 and e.recorded_at >= now() and e.recorded_at::date >= e.occurred_on));
  r := pg_temp.o_send(p_shop, jd, 1, v_today - 10);
  r2 := pg_temp.o_recv(p_shop, jd, 2, v_today - 9, null, null, 'ช่างเอ');
  m := pg_temp.o_send(p_shop, jd, 2, v_today - 10);
  v_log := v_log || pg_temp.chk('T09c', 'วันส่งต่อก่อนวันรับของขั้นเดียวกันถูกปฏิเสธ date_invalid', pg_temp.code(m) = 'date_invalid' and pg_temp.sv(jd, 2, 'status') = 'received');
  r := pg_temp.o_send(p_shop, jd, 2, v_today - 9);
  m := pg_temp.o_recv(p_shop, jd, 3, v_today - 11, null, null, 'ช่างเอ');
  v_log := v_log || pg_temp.chk('T09d', 'วันรับของขั้น N ก่อนวันส่งของขั้น N-1 ถูกปฏิเสธ date_invalid (RPC) และ trigger ปฏิเสธเมื่อเขียนตรง',
    pg_temp.code(m) = 'date_invalid' and pg_temp.x(format('update analytics.job_stage set status = ''received'', received_on = %L, qty_in = 10, assignee_name = ''x'' where job_id = %L and seq = 3', v_today - 11, jd)) like 'ERR:22023:%วันรับ%');
  m := analytics.job_core_receive(jd, 3, v_today - 1, null, null, 'x', 'worker_qr', null, null, false);
  v_log := v_log || pg_temp.chk('T09e', 'ช่างผ่าน QR (channel worker_qr) ย้อนวันไม่ได้ — ใช้วันนี้เท่านั้น (ย้อนได้เฉพาะออฟฟิศ)', (m ->> 'code') = 'date_invalid' and pg_temp.sv(jd, 3, 'status') = 'pending');
  v_log := v_log || pg_temp.chk('T09f', 'วันไทยที่ขอบ UTC: 16:59:59Z=วันเดิม · 17:00:00Z=วันถัดไป · 00:00Z=วันเดิม (ไม่ใช่ current_date UTC) · job_today() ตรงกับ now() ไทย',
    analytics.job_bkk_date('2026-10-12 16:59:59+00') = date '2026-10-12' and analytics.job_bkk_date('2026-10-12 17:00:00+00') = date '2026-10-13'
    and analytics.job_bkk_date('2026-10-12 00:00:00+00') = date '2026-10-12' and analytics.job_bkk_date('2026-10-11 17:00:00+00') = date '2026-10-12'
    and analytics.job_today() = (now() at time zone 'Asia/Bangkok')::date);
  -- กำหนดส่ง
  m := pg_temp.q(format('select analytics.job_set_due(%L, %L, %L, %L)', p_shop, jd, v_today - 1, '00000000-0000-0000-0000-0000000000a1'::uuid));
  r := pg_temp.q(format('select analytics.job_set_due(%L, %L, %L, %L)', p_shop, jd, v_today, '00000000-0000-0000-0000-0000000000a1'::uuid));
  v_log := v_log || pg_temp.chk('T09g', 'กำหนดส่งย้อนหลัง / เกิน 2 ปี ถูกปฏิเสธ · กำหนดส่ง = วันนี้ไม่เลยกำหนด (is_overdue=false)',
    pg_temp.code(m) = 'due_invalid' and pg_temp.code(pg_temp.q(format('select analytics.job_set_due(%L, %L, %L, %L)', p_shop, jd, v_today + 731, '00000000-0000-0000-0000-0000000000a1'::uuid))) = 'due_invalid'
    and r ? 'ok' and exists (select 1 from analytics.v_job_board b where b.id = jd and not b.is_overdue and b.due_date = v_today));
  update analytics.job set due_date = v_today - 3 where id = jd;
  v_log := v_log || pg_temp.chk('T09h', 'ใบที่เลยกำหนด is_overdue=true บนบอร์ด · ใบที่ปิดแล้วไม่ขึ้นเลยกำหนด', exists (select 1 from analytics.v_job_board b where b.id = jd and b.is_overdue)
    and not exists (select 1 from analytics.v_job_board b where b.id = js and b.is_overdue));

  -- N04: ออฟฟิศกรอกย้อนหลัง สลับลำดับงาน
  jx := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'silver', 10));
  jy := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'silver', 10));
  r  := pg_temp.o_run(p_shop, jy, 1, 2, v_today - 1);
  r2 := pg_temp.o_run(p_shop, jx, 1, 1, v_today - 3);
  r3 := pg_temp.o_run(p_shop, jx, 2, 3, v_today - 2);
  v_log := v_log || pg_temp.chk('N04', 'ออฟฟิศกรอกย้อนหลัง 3 วัน สลับลำดับงาน (ใบ Y วันที่ -1 ก่อน ใบ X วันที่ -3/-2) ผ่านครบ · ลำดับวันในแต่ละใบไม่ย้อน',
    r ? 'ok' and r2 ? 'ok' and r3 ? 'ok' and pg_temp.sv(jx, 1, 'sent_on')::date = v_today - 3 and pg_temp.sv(jx, 3, 'sent_on')::date = v_today - 2 and pg_temp.sv(jy, 2, 'sent_on')::date = v_today - 1);

  -- ---------- ข้ามขั้น / ย้อนขั้นพิเศษ ----------
  r := pg_temp.q(format('select analytics.job_stage_skip(%L, %L, %L, %L, %L)', p_shop, jf, 'wax_tree', '.', '00000000-0000-0000-0000-0000000000a1'::uuid));
  r2 := pg_temp.q(format('select analytics.job_stage_skip(%L, %L, %L, %L, %L)', p_shop, jf, 'wax_tree', 'ใช้ต้นเทียนเดิมจากลอตก่อน', '00000000-0000-0000-0000-0000000000a1'::uuid));
  r3 := pg_temp.q(format('select analytics.job_stage_skip(%L, %L, %L, %L, %L)', p_shop, js, 'qc', 'ทดสอบ', '00000000-0000-0000-0000-0000000000a1'::uuid));
  m := pg_temp.q(format('select analytics.job_stage_skip(%L, %L, %L, %L, %L)', p_shop, j2, 'cast', 'ทดสอบข้ามขั้นที่ส่งไปแล้ว', '00000000-0000-0000-0000-0000000000a1'::uuid));
  v_log := v_log || pg_temp.chk('T04f', 'ข้ามขั้น: เหตุผล "." ถูกปฏิเสธ · มีเหตุผลจริงข้ามได้ · ข้ามขั้นที่ไม่ใช่ pending (หรือใบปิดแล้ว) ถูกปฏิเสธ',
    (r ->> '_state') = '22023' and r2 ? 'ok' and pg_temp.sv(jf, 2, 'status') = 'skipped' and (r3 ->> '_state') = '22023' and pg_temp.code(m) = 'stage_not_pending');
  r := pg_temp.q(format('select analytics.job_stage_reopen(%L, %L, %L, %L)', p_shop, jf, 'ข้ามผิดขั้น ขอคืน', '00000000-0000-0000-0000-0000000000a1'::uuid));
  v_log := v_log || pg_temp.chk('T04g', 'ย้อนขั้นที่ถูกข้าม (skipped -> pending) ได้พร้อมเหตุผล · ใบที่ไม่มีความคืบหน้าให้ย้อนถูกปฏิเสธ nothing_to_reopen',
    (r ->> 'to') = 'pending' and pg_temp.code(pg_temp.q(format('select analytics.job_stage_reopen(%L, %L, %L, %L)', p_shop, jf, 'ลองย้อนซ้ำ', '00000000-0000-0000-0000-0000000000a1'::uuid))) = 'nothing_to_reopen');

  -- ---------- ข้อความ error ภาษาคน: ไม่มี UUID ----------
  v_log := v_log || pg_temp.chk('T02h', 'ข้อความ error ของ RPC ฝั่งใบงาน (น้ำหนัก/จำนวน/ลำดับ) เป็นภาษาคน ไม่มี UUID', v_msgs !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}' and length(v_msgs) > 50);

  return v_log;
end;
$s$;

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
-- ============================================================================
create function pg_temp.sC(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log   text := '';
  v_today date := analytics.job_today();
  v_actor constant uuid := '00000000-0000-0000-0000-0000000000a1';
  jt uuid; jt2 uuid; d jsonb; v_root uuid; v_seq int; jc uuid; jg uuid; jp uuid;
  tA jsonb; tB jsonb; t1 jsonb; t2 jsonb; t3 jsonb; tc jsonb;
  wA uuid; wB uuid; wC uuid; wX uuid; wS2 uuid;
  sA text; sB text; sC text;
  r jsonb; r2 jsonb; r3 jsonb; m jsonb; lg jsonb;
  v_ok boolean; v_n int; v_s text; v_ev_before int; v_ev_after int; v_ip text; i int;
  v_shop2 uuid; v_prod uuid; v_po jsonb; v_po_id uuid; v_poi uuid; v_item uuid;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into public.shop (name) values ('verify0172-shop2-c') returning id into v_shop2;

  -- ---------- ช่าง ----------
  r := pg_temp.wu(p_shop, 'v172-ช่างเอ', '', '4829'); wA := (r ->> 'id')::uuid;
  r2 := pg_temp.wu(p_shop, 'v172-ช่างบี', '', '7351'); wB := (r2 ->> 'id')::uuid;
  r3 := pg_temp.wu(p_shop, 'v172-ช่างหล่อ', 'cast', '2946'); wC := (r3 ->> 'id')::uuid;
  v_log := v_log || pg_temp.chk('C0', 'ลงทะเบียนช่าง 3 คนด้วยชื่อ+PIN+ขั้นที่ทำได้', wA is not null and wB is not null and wC is not null
    and (select stage_codes from analytics.worker where id = wC) = array['cast']);

  -- ---------- PIN / ทะเบียนช่าง ----------
  v_ok := true;
  foreach v_s in array array['1111', '1234', '4321', '0000', '12a4', '12345', '123', ''] loop
    m := pg_temp.wu(p_shop, 'v172-pin-' || v_s, '', v_s);
    v_ok := v_ok and pg_temp.code(m) = 'pin_invalid';
  end loop;
  v_log := v_log || pg_temp.chk('T17a', 'PIN เดาง่าย/รูปแบบผิด (1111 1234 4321 0000 12a4 12345 123 ว่าง) ถูกปฏิเสธ pin_invalid', v_ok);
  m := pg_temp.wu(p_shop, 'v172-สุ่ม', '', null);
  v_log := v_log || pg_temp.chk('T17b', 'ไม่ส่ง PIN = ระบบสุ่ม 4 หลักที่ไม่เดาง่ายให้ คืนครั้งเดียว · DB เก็บ bcrypt ($2) ไม่เก็บ PIN ดิบ · service_role อ่าน pin_hash ไม่ได้',
    (m ->> 'pin') ~ '^[0-9]{4}$' and analytics.job_pin_ok(m ->> 'pin') and (m ->> 'pin_generated') = 'true'
    and (select pin_hash like '$2%' and pin_hash <> (m ->> 'pin') and position((m ->> 'pin') in pin_hash) = 0 from analytics.worker where id = (m ->> 'id')::uuid)
    and pg_temp.as_role('service_role', 'select pin_hash from analytics.worker limit 1') like 'ERR:42501:%'
    and pg_temp.as_role('service_role', 'select id, display_name from analytics.worker limit 1') = 'OK');
  v_log := v_log || pg_temp.chk('T17c', 'ชื่อช่างซ้ำ (ไม่สนตัวพิมพ์) / มีอักขระล่องหน / ขั้นที่ไม่มีในทะเบียน / แก้ช่างเดิมพร้อม PIN ถูกปฏิเสธ',
    pg_temp.code(pg_temp.wu(p_shop, 'V172-ช่างเอ', '', '8216')) = 'worker_name_taken'
    and (pg_temp.wu(p_shop, E'v172-ช่าง​ซี', '', '8216') ->> '_state') = '22023'
    and pg_temp.code(pg_temp.wu(p_shop, 'v172-ซี', 'zzz', '8216')) = 'stages_unknown'
    and pg_temp.code(pg_temp.q(format('select analytics.worker_upsert(p_shop_id=>%L, p_id=>%L, p_display_name=>%L, p_stage_codes=>''{qc}''::text[], p_pin=>%L, p_actor=>%L)', p_shop, wA, 'v172-ช่างเอ', '8216', v_actor))) = 'use_pin_set');

  -- ---------- ใบงาน + token ----------
  jt := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'silver', 10));
  jt2 := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'silver', 10));
  t1 := pg_temp.tok(p_shop, jt);
  v_log := v_log || pg_temp.chk('T16a', 'token = base64url 43 ตัวอักษร · DB เก็บ sha256 เท่านั้น: ไม่พบ token ดิบในตาราง job_token และใน payload ของ job_event · print_no=1 · มี event token_issue',
    (t1 ->> 'token') ~ '^[A-Za-z0-9_-]{43}$' and (t1 ->> 'print_no') = '1'
    and (select count(*) from analytics.job_token t where t.token_hash = analytics.job_sha256_hex(t1 ->> 'token')) = 1
    and not exists (select 1 from analytics.job_token t where t::text like '%' || (t1 ->> 'token') || '%')
    and not exists (select 1 from analytics.job_event e where e.payload::text like '%' || (t1 ->> 'token') || '%')
    and exists (select 1 from analytics.job_event e where e.job_id = jt and e.event_type = 'token_issue'));
  r := pg_temp.w_res(t1 ->> 'hash');
  v_log := v_log || pg_temp.chk('T16b', 'token ถูกต้อง แต่ยังไม่ระบุตัวช่าง: เห็นแค่เลขงาน + แถบขั้น + รายชื่อช่างให้เลือก (ไม่เห็นแบบ/จำนวน/โลหะ/ปุ่ม) · next_action = identify',
    (r ->> 'ok') = 'true' and (r ->> 'next_action') = 'identify' and (r -> 'job' ->> 'job_no') is not null
    and not (r -> 'job' ? 'design_label') and not (r -> 'job' ? 'qty_planned') and not (r -> 'job' ? 'metal')
    and jsonb_array_length(r -> 'workers') >= 2 and r -> 'viewer' = 'null'::jsonb);
  v_ok := true;
  foreach v_s in array array[t1 ->> 'token', 'JB-0001', 'abc', '', upper(t1 ->> 'hash'), repeat('0', 64), repeat('a', 63), t1 ->> 'hash' || 'x'] loop
    m := pg_temp.w_res(v_s);
    v_ok := v_ok and (m ->> 'ok') = 'false' and (m ->> 'code') = 'invalid_token' and not (m ? 'job');
  end loop;
  m := pg_temp.w_res(null);
  v_log := v_log || pg_temp.chk('T16c', 'token ดิบ / เลขงาน JB-0001 / ขยะ / hash ตัวพิมพ์ใหญ่ / hash ที่ไม่มีในระบบ / null ถูกปฏิเสธ invalid_token ทุกแบบ โดยไม่คืนข้อมูลใบงาน (ต้อง hash ฝั่ง server ก่อนเสมอ)',
    v_ok and (m ->> 'code') = 'invalid_token');

  t2 := pg_temp.tok(p_shop, jt);
  v_log := v_log || pg_temp.chk('N08', 'พิมพ์ใบงานซ้ำ: QR ใหม่ใช้ได้ · QR เก่าใช้ไม่ได้ทันที (เพิกถอนอัตโนมัติ) · print_no=2 · event token_revoke ระบุเหตุผล reprint',
    (t2 ->> 'print_no') = '2' and (t2 ->> 'revoked_previous') = '1' and (pg_temp.w_res(t1 ->> 'hash') ->> 'code') = 'invalid_token'
    and (pg_temp.w_res(t2 ->> 'hash') ->> 'ok') = 'true'
    and exists (select 1 from analytics.job_event e where e.job_id = jt and e.event_type = 'token_revoke' and e.payload ->> 'reason' = 'reprint'));
  t3 := pg_temp.tok(p_shop, jt, false);
  v_log := v_log || pg_temp.chk('T16d', 'พิมพ์สำเนา (ไม่เพิกถอน) → QR 2 ใบใช้ได้พร้อมกัน',
    (t3 ->> 'print_no') = '3' and (pg_temp.w_res(t2 ->> 'hash') ->> 'ok') = 'true' and (pg_temp.w_res(t3 ->> 'hash') ->> 'ok') = 'true');
  for i in 1 .. 4 loop
    r := pg_temp.tok(p_shop, jt, false);
  end loop;
  v_log := v_log || pg_temp.chk('T16e', 'QR ที่ใช้งานอยู่เกิน 5 ใบต่อใบงาน ถูกปฏิเสธ token_cap · ไม่มี token ใบที่ 6', pg_temp.code(r) = 'token_cap'
    and (select count(*) from analytics.job_token t where t.job_id = jt and t.revoked_at is null) = 5);
  m := pg_temp.q(format('select analytics.job_token_revoke(%L, %L, %L, %L)', p_shop, jt, '.', v_actor));
  r := pg_temp.q(format('select analytics.job_token_revoke(%L, %L, %L, %L)', p_shop, jt, 'ใบงานหาย เพิกถอนทั้งหมด', v_actor));
  v_log := v_log || pg_temp.chk('T16f', 'เพิกถอน token ด้วยเหตุผล "." ถูกปฏิเสธ · เพิกถอนจริง → ทุกใบใช้ไม่ได้ (invalid_token)',
    (m ->> '_state') = '22023' and (r ->> 'revoked') = '5' and (pg_temp.w_res(t2 ->> 'hash') ->> 'code') = 'invalid_token' and (pg_temp.w_res(t3 ->> 'hash') ->> 'code') = 'invalid_token');
  v_log := v_log || pg_temp.chk('T16g', 'ฟื้น token ที่เพิกถอน / แก้ token_hash / ลบ / INSERT hash ซ้ำ ด้วย service key ถูก trigger ปฏิเสธ · service_role อ่าน token_hash ไม่ได้',
    pg_temp.x(format('update analytics.job_token set revoked_at = null, revoke_reason = null where job_id = %L', jt)) like 'ERR:%'
    and pg_temp.x(format('update analytics.job_token set token_hash = repeat(''a'', 64) where job_id = %L', jt)) like 'ERR:22023:%'
    and pg_temp.x(format('delete from analytics.job_token where job_id = %L', jt)) like 'ERR:22023:%'
    and pg_temp.x(format('insert into analytics.job_token (shop_id, job_id, token_hash, print_no, issued_by) select shop_id, job_id, token_hash, 99, issued_by from analytics.job_token where job_id = %L limit 1', jt)) like 'ERR:23505:%'
    and pg_temp.as_role('service_role', 'select token_hash from analytics.job_token limit 1') like 'ERR:42501:%'
    and pg_temp.x('truncate analytics.job_token') like 'ERR:%');
  -- ใบที่ยกเลิก
  jc := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'silver', 10));
  tc := pg_temp.tok(p_shop, jc);
  r := pg_temp.q(format('select analytics.job_cancel(%L, %L, %L, %L)', p_shop, jc, 'ลูกค้ายกเลิกงาน', v_actor));
  v_log := v_log || pg_temp.chk('T16h', 'ใบงานที่ยกเลิกแล้ว: token ถูกเพิกถอนอัตโนมัติ — ผู้ถือ QR ใบนั้นได้ job_closed (0173 QA5) · ออก token ใหม่ไม่ได้ (job_closed) · ออก token ใหม่ไม่ได้ · INSERT token ตรงไม่ได้ · event cancel + token_revoke',
    (r ->> 'status') = 'cancelled' and (pg_temp.w_res(tc ->> 'hash') ->> 'code') = 'job_closed'
    and pg_temp.code(pg_temp.q(format('select analytics.job_token_issue(%L, %L, true, %L)', p_shop, jc, v_actor))) = 'job_closed'
    and pg_temp.x(format('insert into analytics.job_token (shop_id, job_id, token_hash, print_no, issued_by) values (%L, %L, repeat(''b'', 64), 50, %L)', p_shop, jc, v_actor)) like 'ERR:22023:%'
    and exists (select 1 from analytics.job_event e where e.job_id = jc and e.event_type = 'cancel'));
  -- defense-in-depth: ใบถูกปิดโดยไม่ผ่าน RPC (token ยังไม่ถูกเพิกถอน) — ด่านฝั่งช่างต้องเช็คสถานะใบเอง
  jc := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'silver', 10));
  tc := pg_temp.tok(p_shop, jc);
  update analytics.job set status = 'cancelled', cancelled_at = now(), cancel_reason = 'verify' where id = jc;
  v_log := v_log || pg_temp.chk('T16j', 'ใบถูกปิดโดยตรง (token ยังไม่เพิกถอน): resolve/รับ/ส่ง/ระบุตัวช่าง ถูกปฏิเสธ job_closed โดยไม่คืนรายละเอียดใบงาน',
    (pg_temp.w_res(tc ->> 'hash') ->> 'code') = 'job_closed' and not (pg_temp.w_res(tc ->> 'hash') ? 'job')
    and (pg_temp.login(tc ->> 'hash', wA, '4829') ->> 'code') = 'job_closed');
  v_log := v_log || pg_temp.chk('T16i', 'ยกเลิกโดยไม่มีเหตุผล/เหตุผล "." ถูกปฏิเสธ', (pg_temp.q(format('select analytics.job_cancel(%L, %L, %L, %L)', p_shop, jt, '.', v_actor)) ->> '_state') = '22023'
    and (pg_temp.q(format('select analytics.job_cancel(%L, %L, null, %L)', p_shop, jt, v_actor)) ->> '_state') = '22023');

  -- ---------- ระบุตัวช่าง / ล็อก PIN ----------
  tA := pg_temp.tok(p_shop, jt);
  r := pg_temp.login(tA ->> 'hash', wA, '1357');
  r2 := pg_temp.login(tA ->> 'hash', wA, '1358');
  r3 := pg_temp.login(tA ->> 'hash', wA, '1359');
  v_log := v_log || pg_temp.chk('T17d', 'PIN ผิดคืน ok:false (ไม่ raise — ตัวนับต้องไม่ถูก rollback) · attempts_left ลดลง 4,3,2 · ข้อความไม่บอกว่าชื่อหรือ PIN ผิด',
    (r ->> 'code') = 'bad_credentials' and (r ->> 'attempts_left') = '4' and (r2 ->> 'attempts_left') = '3' and (r3 ->> 'attempts_left') = '2'
    and (select failed_attempts = 3 from analytics.worker where id = wA));
  r := pg_temp.login(tA ->> 'hash', wA, '1360');
  r2 := pg_temp.login(tA ->> 'hash', wA, '1361');
  r3 := pg_temp.login(tA ->> 'hash', wA, '4829');
  v_log := v_log || pg_temp.chk('T17e', 'PIN ผิดครบ 5 ครั้งใน 15 นาที → ล็อก (locked, retry_after_seconds=900) · ล็อกแล้วใส่ PIN ถูกก็ไม่ผ่าน',
    (r ->> 'attempts_left') = '1' and (r2 ->> 'code') = 'locked' and (r2 ->> 'retry_after_seconds') = '900' and (r3 ->> 'code') = 'locked'
    and (select locked_until > now() from analytics.worker where id = wA));
  update analytics.worker set locked_until = now() - interval '1 second' where id = wA;
  r := pg_temp.login(tA ->> 'hash', wA, '4829');
  sA := r ->> 'session_hash';
  v_log := v_log || pg_temp.chk('T17f', 'ล็อกหมดอายุแล้วใส่ PIN ถูก → เข้าได้ · ล็อกชั่วคราวถูกปลด แต่ตัวนับยังอยู่ (0174 N2: ล้างได้แค่ครบ 24 ชม./worker_unlock/worker_pin_set) · session token สุ่ม 43 ตัว หมดอายุ 12 ชม.',
    (r ->> 'ok') = 'true' and (r ->> 'session_token') ~ '^[A-Za-z0-9_-]{43}$' and (select failed_attempts = 5 and locked_until is null from analytics.worker where id = wA)
    and (select expires_at - issued_at between interval '11 hours 59 minutes' and interval '12 hours 1 minute' from analytics.worker_session where session_hash = sA)
    and not exists (select 1 from analytics.worker_session s where s::text like '%' || (r ->> 'session_token') || '%')
    and pg_temp.as_role('service_role', 'select session_hash from analytics.worker_session limit 1') like 'ERR:42501:%');
  -- หน้าต่าง 15 นาที: ผิดเก่าเกิน 15 นาทีไม่นับรวม
  r := pg_temp.login(tA ->> 'hash', wB, '1111');
  r := pg_temp.login(tA ->> 'hash', wB, '2222');
  update analytics.worker set last_failed_at = now() - interval '20 minutes' where id = wB;
  r2 := pg_temp.login(tA ->> 'hash', wB, '3333');
  update analytics.worker set failed_window_start = now() - interval '25 hours' where id = wB;
  r3 := pg_temp.login(tA ->> 'hash', wB, '4444');
  v_log := v_log || pg_temp.chk('T17g', '0173 H1: ผิดเว้นเกิน 15 นาทียังนับสะสมในหน้าต่าง 24 ชม. (ครั้งที่ 3 เหลือ 2) · หน้าต่างเกิน 24 ชม. ถึงเริ่มนับใหม่ที่ 1 (เหลือ 4)',
    (r2 ->> 'attempts_left') = '2' and (r3 ->> 'attempts_left') = '4' and (select failed_attempts = 1 from analytics.worker where id = wB));
  m := pg_temp.login(tA ->> 'hash', wB, E'1234'' or ''1''=''1');
  r := pg_temp.login(tA ->> 'hash', wB, 'abcd');
  v_log := v_log || pg_temp.chk('T17h', 'PIN ที่เป็น SQL/ตัวอักษรไม่เป็นเลข 4 หลักถูกปฏิเสธเป็น bad_credentials (ไม่ raise · ไม่นับเป็นความพยายามเดา)',
    (m ->> 'code') = 'bad_credentials' and (r ->> 'code') = 'bad_credentials' and (select failed_attempts = 1 from analytics.worker where id = wB));
  v_log := v_log || pg_temp.chk('T17i', 'ระบุตัวช่างต้องมี token ใบงานที่ใช้งานได้: token เพิกถอน/ขยะ ถูกปฏิเสธ invalid_token ก่อนแตะ PIN (ไม่เพิ่มตัวนับ)',
    (pg_temp.login(t1 ->> 'hash', wB, '7351') ->> 'code') = 'invalid_token' and (pg_temp.login(repeat('f', 64), wB, '7351') ->> 'code') = 'invalid_token'
    and (select failed_attempts = 1 from analytics.worker where id = wB));
  r := pg_temp.login(tA ->> 'hash', wB, '7351'); sB := r ->> 'session_hash';
  r := pg_temp.login(tA ->> 'hash', wC, '2946'); sC := r ->> 'session_hash';
  v_log := v_log || pg_temp.chk('C1', 'ช่าง A B C ระบุตัวสำเร็จ (3 session)', sA is not null and sB is not null and sC is not null);

  -- ---------- ด่านมัดจำตอนรับ/พิมพ์ (#13) ----------
  update analytics.job set start_gate_note = null where id = jt;
  r := pg_temp.w_res(tA ->> 'hash', sA);
  m := pg_temp.w_recv(tA ->> 'hash', sA, 1);
  select count(*) into v_ev_before from analytics.job_event where job_id = jt;
  v_log := v_log || pg_temp.chk('T13e', 'ดีลยังไม่มีเงินเข้า + ไม่มีเหตุผล: ช่างสแกนเห็น awaiting_deposit · รับงานไม่ได้ (ok:false ไม่ raise) · ขั้นไม่ขยับ',
    (r ->> 'next_action') = 'awaiting_deposit' and (m ->> 'code') = 'awaiting_deposit' and (m ->> 'ok') = 'false' and pg_temp.st(jt) like '1:pen%');
  v_log := v_log || pg_temp.chk('T13f', 'พิมพ์ใบงานใหม่ (ออก token) ถูกปฏิเสธ start_gate_required เมื่อดีลยังไม่มีเงินเข้าและไม่มีเหตุผล · ออฟฟิศรับแทนก็ถูกปฏิเสธ awaiting_deposit',
    pg_temp.code(pg_temp.q(format('select analytics.job_token_issue(%L, %L, true, %L)', p_shop, jt, v_actor))) = 'start_gate_required'
    and pg_temp.code(pg_temp.o_recv(p_shop, jt, 1, v_today, null, null, 'ออฟฟิศ')) = 'awaiting_deposit');
  v_log := v_log || pg_temp.chk('T13g', 'ตั้งเหตุผล "." / ว่าง ถูกปฏิเสธ · เหตุผลจริง → รับงานได้ + resolve เป็น receive',
    (pg_temp.q(format('select analytics.job_start_gate_note_set(%L, %L, %L, %L)', p_shop, jt, '.', v_actor)) ->> '_state') = '22023'
    and (pg_temp.q(format('select analytics.job_start_gate_note_set(%L, %L, null, %L)', p_shop, jt, v_actor)) ->> '_state') = '22023'
    and (pg_temp.q(format('select analytics.job_start_gate_note_set(%L, %L, %L, %L)', p_shop, jt, 'เจ้าของอนุมัติ ลูกค้าประจำ จะโอนพรุ่งนี้', v_actor)) ->> 'ok') = 'true'
    and (pg_temp.w_res(tA ->> 'hash', sA) ->> 'next_action') = 'receive');

  tA := pg_temp.tok(p_shop, jt);   -- ออก QR ใหม่ (รีเซ็ตถังนับ rate limit ของ token — section นี้ยิงหนัก)
  -- ---------- ช่างรับ/ส่ง ----------
  v_ip := analytics.job_sha256_hex('10.1.2.3');
  m := pg_temp.w_recv(tA ->> 'hash', sA, 2);
  v_log := v_log || pg_temp.chk('T18a', 'ช่างรับขั้น 2 ทั้งที่หน้าจอ/สถานะจริงคือขั้น 1 (expected_seq ไม่ตรง) ถูกปฏิเสธ out_of_order · ขั้นไม่ขยับ', (m ->> 'code') = 'out_of_order' and pg_temp.st(jt) like '1:pen%');
  m := pg_temp.w_recv(tA ->> 'hash', sA, 1, null, v_ip);
  v_log := v_log || pg_temp.chk('T18b', 'ช่าง A รับขั้น 1 สำเร็จ · event มี worker_id + channel=worker_qr + occurred_on=วันนี้ · device_hint มี UA และ ip hash 8 ตัวแรก ไม่มี ip ดิบ',
    (m ->> 'ok') = 'true' and pg_temp.st(jt) like '1:rec%' and exists (
      select 1 from analytics.job_event e where e.job_id = jt and e.event_type = 'stage_receive' and e.worker_id = wA and e.channel = 'worker_qr'
         and e.actor is null and e.occurred_on = v_today and e.device_hint like 'verify-ua/1.0%' and e.device_hint like '%ip:' || left(v_ip, 8) and e.device_hint not like '%10.1.2.3%'));
  select count(*) into v_ev_before from analytics.job_event where job_id = jt;
  r := pg_temp.w_recv(tA ->> 'hash', sB, 1);
  select count(*) into v_ev_after from analytics.job_event where job_id = jt;
  v_log := v_log || pg_temp.chk('N05', 'สองมือถือรับขั้นเดียวกัน: ตัวหลังได้ ok:true already:true "รับแล้วโดย <ชื่อ>" (ไม่ raise ไม่เขียน event ซ้ำ ไม่เลื่อนไปรับขั้นถัดไป)',
    (r ->> 'ok') = 'true' and (r ->> 'already') = 'true' and (r ->> 'by') = 'v172-ช่างเอ' and v_ev_before = v_ev_after and pg_temp.st(jt) like '1:rec,2:pen%');
  m := pg_temp.w_send(tA ->> 'hash', sB, 1);
  v_log := v_log || pg_temp.chk('T18c', 'ช่าง B ส่งต่อขั้นที่ช่าง A ถือ ถูกปฏิเสธ not_holder (ข้อความบอกชื่อผู้ถือ) · ขั้นยัง received', (m ->> 'code') = 'not_holder' and (m ->> 'message') like '%v172-ช่างเอ%' and pg_temp.st(jt) like '1:rec%');
  m := pg_temp.w_send(tA ->> 'hash', sC, 1);
  v_log := v_log || pg_temp.chk('T18d', 'ช่าง C (ขั้นหล่ออย่างเดียว) ส่งต่อขั้นของ A ไม่ได้เช่นกัน', (m ->> 'code') = 'not_holder');
  m := pg_temp.w_send(tA ->> 'hash', sA, 1);
  r := pg_temp.w_send(tA ->> 'hash', sA, 1);
  v_log := v_log || pg_temp.chk('T18e', 'ช่าง A ส่งต่อขั้น 1 ได้ · กดซ้ำ (double tap) ได้ ok:true already:true ไม่เขียนซ้ำ',
    (m ->> 'ok') = 'true' and (r ->> 'ok') = 'true' and (r ->> 'already') = 'true' and (select count(*) from analytics.job_event e where e.job_id = jt and e.event_type = 'stage_send') = 1);
  r := pg_temp.w_recv(tA ->> 'hash', sA, 1);
  v_log := v_log || pg_temp.chk('T18f', 'หน้าค้าง: รับขั้น 1 ซ้ำหลังส่งต่อไปแล้ว ถูกปฏิเสธ stage_changed (ไม่ไปรับขั้นถัดไปแทน)', (r ->> 'code') = 'stage_changed' and pg_temp.st(jt) like '1:sen,2:pen%');
  r := pg_temp.w_send(tA ->> 'hash', sA, 2);
  v_log := v_log || pg_temp.chk('T18g', 'ส่งต่อขั้นที่ยังไม่ได้รับ ถูกปฏิเสธ not_received', (r ->> 'code') = 'not_received');
  -- N06 ช่างคนเดียวทำ 2 ขั้นติดกัน
  m := pg_temp.w_recv(tA ->> 'hash', sA, 2);
  r := pg_temp.w_send(tA ->> 'hash', sA, 2);
  r2 := pg_temp.w_recv(tA ->> 'hash', sA, 3);
  r3 := pg_temp.w_send(tA ->> 'hash', sA, 3);
  v_log := v_log || pg_temp.chk('N06', 'ช่างคนเดียวรับ-ส่ง 2 ขั้นติดกัน (ขี้ผึ้ง → ปูน) ได้ตามปกติ', (m ->> 'ok') = 'true' and (r ->> 'ok') = 'true' and (r2 ->> 'ok') = 'true' and (r3 ->> 'ok') = 'true' and pg_temp.st(jt) like '1:sen,2:sen,3:sen,4:pen%');
  -- N07 มือถือร่วม: ช่าง C เข้ามาแทน
  r := pg_temp.w_res(tA ->> 'hash', sC);
  v_log := v_log || pg_temp.chk('N07a', 'มือถือใช้ร่วม: ช่าง C (ทำได้เฉพาะขั้นหล่อ) สแกน → next_action=receive ขั้นหล่อ ต้องชั่ง · เห็นรายละเอียดผลิตแต่ไม่มีราคา/ลูกค้า',
    (r ->> 'next_action') = 'receive' and (r -> 'action_stage' ->> 'code') = 'cast' and (r -> 'action_stage' ->> 'weight_required') = 'true'
    and (r -> 'viewer' ->> 'display_name') = 'v172-ช่างหล่อ' and (r -> 'job' ->> 'metal') = 'silver' and (r -> 'job' ->> 'qty_planned') = '10');
  m := pg_temp.w_recv(tA ->> 'hash', sC, 4);
  r := pg_temp.w_recv(tA ->> 'hash', sC, 4, 10.250);
  v_log := v_log || pg_temp.chk('N07b', 'ช่าง C รับขั้นหล่อ: ไม่มีน้ำหนักถูกปฏิเสธ weight_required · มีน้ำหนักรับได้ · เก็บ worker_id', (m ->> 'code') = 'weight_required' and (r ->> 'ok') = 'true'
    and pg_temp.sv(jt, 4, 'worker_id') = wC::text and pg_temp.sv(jt, 4, 'weight_in_g') = '10.250');
  r := pg_temp.w_res(tA ->> 'hash', sC);
  v_log := v_log || pg_temp.chk('T18h', 'ช่าง C ส่งหล่อเสร็จแล้ว ขั้นถัดไป (ตัดต้น) ไม่อยู่ใน stage_codes ของ C → resolve = send (ต้องส่งก่อน) · หลังส่ง = not_your_stage · รับขั้นตัดต้นถูกปฏิเสธ stage_not_allowed',
    (r ->> 'next_action') = 'send'
    and (pg_temp.w_send(tA ->> 'hash', sC, 4, 10.1) ->> 'ok') = 'true'
    and (pg_temp.w_res(tA ->> 'hash', sC) ->> 'next_action') = 'not_your_stage'
    and pg_temp.code(pg_temp.w_recv(tA ->> 'hash', sC, 5, 10.0)) = 'stage_not_allowed');
  -- ช่าง A รับขั้นตัดต้นต่อ แล้วช่าง B รับขั้นขัดโดยที่ A ยังไม่ส่ง = auto-close (เงิน)
  r := pg_temp.w_recv(tA ->> 'hash', sA, 5, 10.0);
  r2 := pg_temp.w_recv(tA ->> 'hash', sB, 6, 9.9);
  m := pg_temp.w_send(tA ->> 'hash', sA, 5, 9.9);
  r3 := pg_temp.w_recv(tA ->> 'hash', sB, 6, 9.9);
  v_log := v_log || pg_temp.chk('T18i', '0173 QA6: ช่าง B รับขั้นขัดทั้งที่ช่าง A ยังถือตัดต้น (เงิน ขั้นบังคับชั่ง) ถูกปฏิเสธ prev_not_sent ไม่ปิดอัตโนมัติ · A กดส่งต่อพร้อมน้ำหนักแล้ว B รับได้ปกติ (ไม่ใช่ auto) · event ของ B ไม่ใช่ของ A',
    (r ->> 'ok') = 'true' and (r2 ->> 'code') = 'prev_not_sent' and (m ->> 'ok') = 'true' and (r3 ->> 'ok') = 'true' and (r3 ->> 'prev_auto_closed') = 'false'
    and pg_temp.st(jt) like '%,5:sen,6:rec%' and pg_temp.sv(jt, 6, 'worker_id') = wB::text);

  tA := pg_temp.tok(p_shop, jt);
  -- ---------- ปิดช่าง / session ----------
  update analytics.worker set is_active = false where id = wB;
  r := pg_temp.w_send(tA ->> 'hash', sB, 6, 9.8);
  r2 := pg_temp.w_res(tA ->> 'hash', sB);
  v_log := v_log || pg_temp.chk('T17j', 'ช่างถูกปิด (แม้ session ยังไม่หมดอายุ และไม่ผ่าน RPC ที่เพิกถอน session): ทุก RPC ฝั่งช่างปฏิเสธทันที session_required · resolve เห็นเป็นผู้ไม่ระบุตัว',
    (r ->> 'code') = 'session_required' and (r2 -> 'viewer') = 'null'::jsonb and (r2 ->> 'session_expired') = 'true');
  update analytics.worker set is_active = true where id = wB;
  m := pg_temp.q(format('select analytics.worker_set_active(%L, %L, false, %L)', p_shop, wB, v_actor));
  r := pg_temp.login(tA ->> 'hash', wB, '7351');
  r2 := pg_temp.login(tA ->> 'hash', wC, '0987');
  v_log := v_log || pg_temp.chk('T17k', 'ปิดช่างด้วย RPC: ทุก session ถูกเพิกถอน · ใส่ PIN ถูกก็เข้าไม่ได้ ข้อความเหมือน PIN ผิด (ไม่บอกว่าถูกปิด) · เปิดใหม่ได้',
    (m ->> 'is_active') = 'false' and (r ->> 'code') = 'bad_credentials' and (r ->> 'message') = (r2 ->> 'message')
    and not exists (select 1 from analytics.worker_session s where s.worker_id = wB and s.revoked_at is null)
    and (pg_temp.q(format('select analytics.worker_set_active(%L, %L, true, %L)', p_shop, wB, v_actor)) ->> 'is_active') = 'true'
    and (pg_temp.login(tA ->> 'hash', wB, '7351') ->> 'ok') = 'true');
  r := pg_temp.login(tA ->> 'hash', wB, '7351'); sB := r ->> 'session_hash';
  update analytics.worker_session set issued_at = now() - interval '13 hours', expires_at = now() - interval '1 hour' where session_hash = sA;
  r := pg_temp.w_recv(tA ->> 'hash', sA, 7);
  r2 := pg_temp.w_res(tA ->> 'hash', sA);
  v_log := v_log || pg_temp.chk('T17l', 'session หมดอายุ (เกิน 12 ชม.) ใช้รับ/ส่งไม่ได้ session_required · resolve บอก session_expired แล้วกลับไปให้ระบุตัวใหม่', (r ->> 'code') = 'session_required' and (r2 ->> 'session_expired') = 'true' and (r2 ->> 'next_action') = 'identify');
  r := pg_temp.login(tA ->> 'hash', wA, '4829'); sA := r ->> 'session_hash';
  r := pg_temp.q(format('select analytics.worker_pin_set(%L, %L, %L, %L)', p_shop, wA, '5934', v_actor));
  v_log := v_log || pg_temp.chk('T17m', 'รีเซ็ต PIN: session เดิมของช่างหลุดทันที · PIN เก่าใช้ไม่ได้ · PIN ใหม่ใช้ได้ · ตัวนับ/ล็อกถูกล้าง · ไม่เก็บ PIN ใน worker_audit',
    (pg_temp.w_res(tA ->> 'hash', sA) ->> 'next_action') = 'identify' and (pg_temp.login(tA ->> 'hash', wA, '4829') ->> 'code') = 'bad_credentials'
    and (pg_temp.login(tA ->> 'hash', wA, '5934') ->> 'ok') = 'true'
    and not exists (select 1 from analytics.worker_audit a where a.worker_id = wA and (a.detail::text like '%5934%' or a.detail::text like '%4829%'))
    and exists (select 1 from analytics.worker_audit a where a.worker_id = wA and a.action = 'pin_set'));
  r := pg_temp.q(format('select analytics.job_worker_logout(%L)', (select s.session_hash from analytics.worker_session s where s.worker_id = wC and s.revoked_at is null limit 1)));
  v_log := v_log || pg_temp.chk('N07c', 'ออกจากระบบ ("ไม่ใช่คุณ? เปลี่ยน"): session ถูกเพิกถอน · session ที่ไม่มีอยู่/ขยะไม่ทำให้พัง',
    (r ->> 'ok') = 'true' and (pg_temp.w_res(tA ->> 'hash', sC) ->> 'next_action') = 'identify' and (pg_temp.q('select analytics.job_worker_logout(''zzz'')') ->> 'ok') = 'true');

  -- ---------- ข้ามร้าน (#7) ----------
  r := pg_temp.q(format('select analytics.worker_upsert(p_shop_id=>%L, p_display_name=>%L, p_stage_codes=>''{qc}''::text[], p_pin=>%L, p_actor=>%L)', v_shop2, 'v172-ช่างร้านอื่น', '8642', v_actor));
  wS2 := (r ->> 'id')::uuid;
  insert into analytics.worker_session (shop_id, worker_id, session_hash, expires_at) values (v_shop2, wS2, analytics.job_sha256_hex('s2-session'), now() + interval '1 hour');
  v_log := v_log || pg_temp.chk('T07c', 'ช่างร้านอื่น: ใส่ PIN ถูกกับ token ของร้านนี้ไม่ได้ (bad_credentials) · session ของร้านอื่นใช้กับ token ร้านนี้ไม่ได้ (session_required)',
    (pg_temp.login(tA ->> 'hash', wS2, '8642') ->> 'code') = 'bad_credentials'
    and (pg_temp.w_recv(tA ->> 'hash', analytics.job_sha256_hex('s2-session'), 7) ->> 'code') = 'session_required');
  v_log := v_log || pg_temp.chk('T07d', 'ข้ามร้านที่ชั้น DB: INSERT job_stage/job_event ชี้ใบงานร้านอื่น · job_stage.worker_id ช่างร้านอื่น · worker_session ช่าง/ร้านไม่ตรงกัน ถูกปฏิเสธ',
    pg_temp.x(format('insert into analytics.job_event (shop_id, job_id, event_type, occurred_on, actor, channel) values (%L, %L, ''note'', %L, %L, ''rpc'')', v_shop2, jt, v_today, v_actor)) like 'ERR:23503:%'
    and pg_temp.x(format('update analytics.job_stage set status = ''received'', received_on = %L, qty_in = 10, worker_id = %L where job_id = %L and seq = 1', v_today, wS2, jt2)) like 'ERR:23503:%'
    and pg_temp.x(format('insert into analytics.worker_session (shop_id, worker_id, session_hash, expires_at) values (%L, %L, repeat(''c'', 64), now() + interval ''1 hour'')', p_shop, wS2)) like 'ERR:23503:%');
  v_log := v_log || pg_temp.chk('T07e', 'office RPC ด้วย p_shop_id ร้านอื่นกับใบงานของร้านนี้ = ไม่พบใบงาน (job_not_found) ทุกตัว (receive/send/skip/reopen/due/token/done/cancel/note)',
    (select bool_and(pg_temp.code(pg_temp.q(format(f, v_shop2, jt, v_actor))) = 'job_not_found') from unnest(array[
       'select analytics.job_office_receive(%1$L, %2$L, 7, current_date, null, null, ''x'', ''job_page'', %3$L)',
       'select analytics.job_office_send(%1$L, %2$L, 7, current_date, null, 0, null, 0, null, null, ''job_page'', %3$L)',
       'select analytics.job_stage_skip(%1$L, %2$L, ''qc'', ''ทดสอบ'', %3$L)',
       'select analytics.job_stage_reopen(%1$L, %2$L, ''ทดสอบ'', %3$L)',
       'select analytics.job_set_due(%1$L, %2$L, null, %3$L)',
       'select analytics.job_token_issue(%1$L, %2$L, true, %3$L)',
       'select analytics.job_token_revoke(%1$L, %2$L, ''ทดสอบ'', %3$L)',
       'select analytics.job_done(%1$L, %2$L, 10, 0, null, null, %3$L)',
       'select analytics.job_cancel(%1$L, %2$L, ''ทดสอบ'', %3$L)',
       'select analytics.job_start_gate_note_set(%1$L, %2$L, ''ทดสอบ'', %3$L)']) as f));
  v_log := v_log || pg_temp.chk('T07f', 'worker RPC ของร้านอื่น: pin_set / set_active / upsert แก้ช่างต่างร้าน = ไม่พบช่าง',
    pg_temp.code(pg_temp.q(format('select analytics.worker_pin_set(%L, %L, %L, %L)', v_shop2, wA, '5821', v_actor))) = 'worker_not_found'
    and pg_temp.code(pg_temp.q(format('select analytics.worker_set_active(%L, %L, false, %L)', v_shop2, wA, v_actor))) = 'worker_not_found'
    and pg_temp.code(pg_temp.q(format('select analytics.worker_upsert(p_shop_id=>%L, p_id=>%L, p_display_name=>%L, p_stage_codes=>''{qc}''::text[], p_actor=>%L)', v_shop2, wA, 'ขโมย', v_actor))) = 'worker_not_found');
  v_log := v_log || pg_temp.chk('T07g', 'ไม่มี actor (p_actor ว่างและไม่มี auth.uid) ถูกปฏิเสธ actor_required ทุก RPC เขียน',
    pg_temp.code(pg_temp.q(format('select analytics.job_cancel(%L, %L, %L)', p_shop, jt2, 'ทดสอบ'))) = 'actor_required'
    and pg_temp.code(pg_temp.q(format('select analytics.worker_pin_set(%L, %L)', p_shop, wA))) = 'actor_required'
    and pg_temp.code(pg_temp.q(format('select analytics.job_token_issue(%L, %L)', p_shop, jt2))) = 'actor_required');

  -- ---------- production source: ไม่มีด่านมัดจำ ----------
  select p.id into v_prod from public.product p where p.shop_id = p_shop and p.is_active and p.sku !~* '^live' and p.cost_type in ('fixed', 'spot') order by p.sku limit 1;
  v_po := pg_temp.q(format('select pg_temp.po_save(p_shop_id=>%L, p_note=>%L)', p_shop, 'verify0172-c'));
  v_po_id := (v_po ->> 'id')::uuid;
  perform analytics.production_order_item_set(p_shop, v_po_id, v_prod, 4);
  select id into v_poi from analytics.production_order_item where production_order_id = v_po_id;
  r := pg_temp.q(format('select analytics.job_create_from_production_item(%L, %L, %L::text[], null, null, null, %L)', p_shop, v_poi, pg_temp.std(), v_actor));
  jp := pg_temp.jid(r);
  t1 := pg_temp.tok(p_shop, jp);
  r := pg_temp.w_recv(t1 ->> 'hash', sB, 1);
  v_log := v_log || pg_temp.chk('T13h', 'งานผลิตเข้าสต็อก (production): ไม่มีด่านมัดจำ — ออก token และช่างรับขั้นแรกได้โดยไม่มีเหตุผล', (t1 ->> 'token') is not null and (r ->> 'ok') = 'true');
  -- ดีลที่มีมัดจำแล้ว: โคลนจากรายการจริงในดีลเดียวกัน (ยอดมัดจำนับตามดีล) — ไม่ยิงสร้างจากใบจริง
  select i.id, coalesce(q.root_quote_id, q.id), i.seq into v_item, v_root, v_seq
    from analytics.oem_quote_item i join analytics.oem_quote q on q.id = i.quote_id join analytics.v_oem_quote v on v.id = q.id
   where i.shop_id = p_shop and q.status = 'won' and i.input ->> 'metal' = 'silver' and v.paid_thb > 0 and q.quote_no not like 'V172-%' order by q.quote_no, i.seq limit 1;
  if v_item is null then
    v_log := v_log || '[SKIP] T13i  ไม่มีดีล won+silver ที่มีมัดจำจริง — พิสูจน์ "ช่างรับขั้นแรกของดีลที่มีเงินเข้าแล้วได้โดยไม่มีเหตุผล" ไม่ได้' || E'\n';
  else
    d := pg_temp.clone_deal(v_item, 'silver', 4, v_root, 'won', null, null, v_seq);
    r := pg_temp.q(format('select pg_temp.jcq(%L, %L, %L::text[], null, null, null, null, %L)', p_shop, d ->> 'item_id', pg_temp.std(), v_actor));
    t2 := pg_temp.tok(p_shop, pg_temp.jid(r));
    m := pg_temp.w_recv(t2 ->> 'hash', sB, 1);
    v_log := v_log || pg_temp.chk('T13i', 'ดีลที่มีมัดจำเข้าแล้ว (โคลนในดีลจริง): สร้างใบงานไม่ต้องมีเหตุผล · พิมพ์ได้ · ช่างรับขั้นแรกได้ (ด่านไม่บล็อกของที่ต้องไม่พัง)',
      r ? 'job_id' and (t2 ->> 'token') is not null and (m ->> 'ok') = 'true' and (select start_gate_note is null from analytics.job where id = pg_temp.jid(r)));
  end if;

  -- ---------- rate limit (0173 L4): ถังต่อ token เฉพาะ token ที่มีจริง · ip นับเฉพาะ action เขียน + verify PIN ----------
  t2 := pg_temp.tok(p_shop, jt2);
  v_ok := true;
  for i in 1 .. 120 loop
    v_ok := v_ok and (pg_temp.w_res(t2 ->> 'hash') ->> 'ok') = 'true';
  end loop;
  m := pg_temp.w_res(t2 ->> 'hash');
  r2 := pg_temp.login(t2 ->> 'hash', wB, '7351');
  v_log := v_log || pg_temp.chk('T17n', '0174 N3: resolve ใบเดียวเกิน 120 ครั้ง/10 นาที: ครั้งที่ 121 ถูกปฏิเสธ rate_limited (ถัง tov:) แต่ช่างตัวจริง login ด้วย PIN ถูกยังผ่าน (ถัง tok: แยกกัน) · ตัวนับ commit จริง — ไม่ raise', v_ok and (m ->> 'code') = 'rate_limited' and (r2 ->> 'ok') = 'true'
    and (select hits from analytics.worker_rate_limit where key = 'tov:' || left(t2 ->> 'hash', 32) order by window_start desc limit 1) = 121);
  t3 := pg_temp.tok(p_shop, jt2);
  v_ok := true;
  for i in 1 .. 60 loop
    m := pg_temp.q(format('select analytics.worker_pin_verify(%L, %L, %L)', t3 ->> 'hash', gen_random_uuid(), '0000'));
    v_ok := v_ok and (m ->> 'code') = 'bad_credentials';
  end loop;
  m := pg_temp.q(format('select analytics.worker_pin_verify(%L, %L, %L)', t3 ->> 'hash', gen_random_uuid(), '0000'));
  v_log := v_log || pg_temp.chk('T17n2', '0174 N3: PIN/เขียนใช้ถัง tok: 60/10 นาที — ครั้งที่ 61 ถูกปฏิเสธ rate_limited', v_ok and (m ->> 'code') = 'rate_limited'
    and (select hits from analytics.worker_rate_limit where key = 'tok:' || left(t3 ->> 'hash', 32) order by window_start desc limit 1) = 61);
  v_ok := true;
  for i in 1 .. 100 loop
    m := pg_temp.q(format('select analytics.worker_pin_verify(%L, %L, %L, %L, %L)', analytics.job_sha256_hex('p' || i), wA, '0000', 'ua', analytics.job_sha256_hex('attacker')));
    v_ok := v_ok and (m ->> 'code') = 'invalid_token';
  end loop;
  m := pg_temp.q(format('select analytics.worker_pin_verify(%L, %L, %L, %L, %L)', analytics.job_sha256_hex('p-final'), wA, '0000', 'ua', analytics.job_sha256_hex('attacker')));
  v_log := v_log || pg_temp.chk('T17o', 'verify PIN จาก ip hash เดียวกันเกิน 100 ครั้ง/10 นาที (สุ่ม token): ครั้งที่ 101 ถูกปฏิเสธ rate_limited · ip hash รูปแบบผิดถูกมองข้าม ไม่พัง',
    v_ok and (m ->> 'code') = 'rate_limited' and (pg_temp.w_res(t1 ->> 'hash', sB, 'not-a-hash') ->> 'ok') = 'true');
  v_ok := true;
  for i in 1 .. 150 loop
    m := pg_temp.w_res(analytics.job_sha256_hex('r' || i), null, analytics.job_sha256_hex('factory-wifi'));
    v_ok := v_ok and (m ->> 'code') = 'invalid_token';
  end loop;
  v_log := v_log || pg_temp.chk('T17p', '0173 L4: resolve (โหลดหน้า) 150 ครั้งจาก ip เดียวกันด้วย token สุ่ม ไม่นับถัง ip (Wi-Fi เดียวทั้งโรงงาน) · token ที่ไม่มีในระบบไม่เขียนแถวใดลงถังนับ',
    v_ok and not exists (select 1 from analytics.worker_rate_limit r where r.key like 'tok:%' and r.key = 'tok:' || left(analytics.job_sha256_hex('r1'), 32))
    and not exists (select 1 from analytics.worker_rate_limit r where r.key = 'ip:' || left(analytics.job_sha256_hex('factory-wifi'), 32) or r.key = 'ipw:' || left(analytics.job_sha256_hex('factory-wifi'), 32)));

  return v_log;
end;
$s$;

-- ============================================================================
-- Section D — immutability (#5 #6) · สิทธิ์ (#19) · payload ช่าง (#20) · renegotiate (R1) · mismatch (R2) · drift · ใบผลิตเดิม
-- ============================================================================
create function pg_temp.sD(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log   text := '';
  v_today date := analytics.job_today();
  v_actor constant uuid := '00000000-0000-0000-0000-0000000000a1';
  jscrap uuid; jd uuid; jx uuid; jp uuid; jq uuid; jr uuid; jr2 uuid; jdrift uuid;
  d jsonb; d2 jsonb; r jsonb; r2 jsonb; r3 jsonb; m jsonb; t jsonb; lg jsonb; q jsonb;
  w uuid; sess text;
  v_ok boolean; v_s text; v_n int; v_n2 int; v_t5 text; v_pay text; v_cust constant text := 'ZZ-CUSTOMER-0172-PRIVATE'; v_contact constant text := 'ZZCONTACT0172';
  v_cost text; v_price text; v_total text;
  v_prod uuid; v_po1 uuid; v_po2 uuid; v_poi1 uuid; v_poi2 uuid; v_pr1 jsonb; v_pr2 jsonb; v_skipdone boolean := false;
  rec record;
  v_fn_n int; v_bad text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- ---------- สร้างใบที่ปิดแล้ว / ยกเลิกแล้ว ----------
  jd := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'silver', 10));
  r := pg_temp.o_run(p_shop, jd, 1, 8, v_today);
  r2 := pg_temp.q(format('select analytics.job_done(%L, %L, 10, 0, null, null, %L)', p_shop, jd, v_actor));
  jx := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'silver', 10));
  m := pg_temp.q(format('select analytics.job_cancel(%L, %L, %L, %L)', p_shop, jx, 'ลูกค้ายกเลิก', v_actor));
  v_log := v_log || pg_temp.chk('D0', 'เตรียมใบที่ done และใบที่ cancelled', r ? 'ok' and r2 ? 'ok' and (m ->> 'status') = 'cancelled');
  v_s := pg_temp.st(jd);
  -- T10g: ปิดงานเมื่อมีของเสียรายขั้น: จำนวนดีต้องไม่เกินจำนวนที่เหลือจากขั้นสุดท้าย
  jscrap := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'silver', 10));
  r := pg_temp.o_run(p_shop, jscrap, 1, 3, v_today);
  r2 := pg_temp.o_recv(p_shop, jscrap, 4, v_today, 10.0, null, 'ช่างเอ');
  m := pg_temp.o_send(p_shop, jscrap, 4, v_today, 9.0, 2, 'broken');
  r3 := pg_temp.o_run(p_shop, jscrap, 5, 8, v_today);
  v_log := v_log || pg_temp.chk('T10g', 'ใบที่มีของเสีย 2 ชิ้นที่ขั้นหล่อ: ปิดงานดี 10 เสีย 0 ถูกปฏิเสธ qty_exceeds_final · ดี 8 เสีย 2 ปิดได้',
    r ? 'ok' and m ? 'ok' and r3 ? 'ok' and pg_temp.code(pg_temp.q(format('select analytics.job_done(%L, %L, 10, 0, null, null, %L)', p_shop, jscrap, v_actor))) = 'qty_exceeds_final'
    and (pg_temp.q(format('select analytics.job_done(%L, %L, 8, 2, null, null, %L)', p_shop, jscrap, v_actor)) ->> 'ok') = 'true');

  -- ---------- #5 job_event append-only ----------
  select count(*) into v_n from analytics.job_event where job_id = jd;
  v_t5 := pg_temp.x('truncate analytics.job_event');   -- แยก statement: TRUNCATE ในคำสั่งเดียวกับ select ตารางเดียวกันได้ 55006
  select count(*) into v_n2 from analytics.job_event where job_id = jd;
  v_log := v_log || pg_temp.chk('T05a', 'job_event: UPDATE / DELETE / TRUNCATE ตรง (เจ้าของตาราง) ถูก trigger ปฏิเสธ 42501 — เหตุการณ์ที่เขียนแล้วแก้/ลบไม่ได้',
    v_n > 10
    and pg_temp.x(format('update analytics.job_event set payload = ''{}''::jsonb where job_id = %L', jd)) like 'ERR:42501:%append-only%'
    and pg_temp.x(format('delete from analytics.job_event where job_id = %L', jd)) like 'ERR:42501:%append-only%'
    and v_t5 like 'ERR:42501:%'
    and v_n2 = v_n);
  v_log := v_log || pg_temp.chk('T05b', 'ด่านชั้นสิทธิ์: service_role แม้ไม่ผ่าน trigger ก็ไม่มีสิทธิ์ INSERT/UPDATE/DELETE/TRUNCATE บน job_event / worker_audit / job_stage / job',
    pg_temp.as_role('service_role', format('update analytics.job_event set payload = ''{}''::jsonb where job_id = %L', jd)) like 'ERR:42501:%'
    and pg_temp.as_role('service_role', format('delete from analytics.job_event where job_id = %L', jd)) like 'ERR:42501:%'
    and pg_temp.as_role('service_role', 'truncate analytics.job_event') like 'ERR:42501:%'
    and pg_temp.as_role('service_role', format('insert into analytics.job_event (shop_id, job_id, event_type, occurred_on, actor, channel) values (%L, %L, ''note'', %L, %L, ''rpc'')', p_shop, jd, v_today, v_actor)) like 'ERR:42501:%'
    and pg_temp.as_role('service_role', format('update analytics.job_stage set due_date = null where job_id = %L', jd)) like 'ERR:42501:%'
    and pg_temp.as_role('service_role', format('update analytics.job set note = ''x'' where id = %L', jd)) like 'ERR:42501:%'
    and pg_temp.as_role('service_role', 'update analytics.job_counter set last_no = 0') like 'ERR:42501:%'
    and pg_temp.as_role('service_role', 'select * from analytics.job_counter') like 'ERR:42501:%');
  v_t5 := pg_temp.x(format('insert into analytics.job_event (shop_id, job_id, event_type, occurred_on, actor, channel, recorded_at) values (%L, %L, ''note'', %L, %L, ''rpc'', timestamptz ''2000-01-01'')', p_shop, jd, v_today, v_actor));
  select (max(recorded_at) >= now()) into v_ok from analytics.job_event where job_id = jd and event_type = 'note' and actor = v_actor;
  v_log := v_log || pg_temp.chk('T05c', 'recorded_at ปลอมไม่ได้ (INSERT ตรงระบุ 2000-01-01 → ถูกบังคับเป็น clock_timestamp) · ทุก event ต้องมีผู้รับผิดชอบ (actor/worker) · channel worker_qr ต้องมี worker · event_type/payload ผิดรูปถูกปฏิเสธ',
    v_t5 = 'OK'
    and coalesce(v_ok, false)
    and pg_temp.x(format('insert into analytics.job_event (shop_id, job_id, event_type, occurred_on, channel) values (%L, %L, ''stage_send'', %L, ''rpc'')', p_shop, jd, v_today)) like 'ERR:23514:%je_who_ck%'
    and pg_temp.x(format('insert into analytics.job_event (shop_id, job_id, event_type, occurred_on, actor, channel) values (%L, %L, ''note'', %L, %L, ''worker_qr'')', p_shop, jd, v_today, v_actor)) like 'ERR:23514:%je_qr_ck%'
    and pg_temp.x(format('insert into analytics.job_event (shop_id, job_id, event_type, occurred_on, actor, channel) values (%L, %L, ''hack'', %L, %L, ''rpc'')', p_shop, jd, v_today, v_actor)) like 'ERR:23514:%'
    and pg_temp.x(format('insert into analytics.job_event (shop_id, job_id, event_type, occurred_on, actor, channel, payload) values (%L, %L, ''note'', %L, %L, ''rpc'', ''[1]''::jsonb)', p_shop, jd, v_today, v_actor)) like 'ERR:23514:%');
  v_log := v_log || pg_temp.chk('T05d', 'worker_audit: TRUNCATE ถูกปฏิเสธ 42501',
    pg_temp.x('truncate analytics.worker_audit') like 'ERR:42501:%');
  -- UPDATE/DELETE ที่จับ 0 แถวไม่ยิง trigger → เพิ่มแถวจริงก่อนแล้วทดสอบ
  r := pg_temp.wu(p_shop, 'v172-audit', '', '7253');
  v_log := v_log || pg_temp.chk('T05e', 'worker_audit มีแถวจริงแล้ว UPDATE/DELETE ถูก trigger ปฏิเสธ',
    pg_temp.x('update analytics.worker_audit set detail = ''{}''::jsonb') like 'ERR:42501:%append-only%' and pg_temp.x('delete from analytics.worker_audit') like 'ERR:42501:%append-only%');

  -- ---------- #6 done / cancelled แก้ไม่ได้ ----------
  v_log := v_log || pg_temp.chk('T06a', 'ใบ done: UPDATE job / job_stage ตรง · DELETE job / job_stage · TRUNCATE ถูกปฏิเสธ · สถานะขั้นไม่ขยับ',
    pg_temp.x(format('update analytics.job set note = ''แก้ย้อนหลัง'' where id = %L', jd)) like 'ERR:22023:%แก้ไม่ได้%'
    and pg_temp.x(format('update analytics.job set status = ''open'' where id = %L', jd)) like 'ERR:22023:%'
    and pg_temp.x(format('update analytics.job_stage set due_date = %L where job_id = %L and seq = 1', v_today, jd)) like 'ERR:22023:%'
    and pg_temp.x(format('update analytics.job_stage set status = ''pending'' where job_id = %L and seq = 8', jd)) like 'ERR:22023:%'
    and pg_temp.x(format('delete from analytics.job where id = %L', jd)) like 'ERR:22023:%'
    and pg_temp.x(format('delete from analytics.job_stage where job_id = %L', jd)) like 'ERR:22023:%'
    and pg_temp.x('truncate analytics.job') like 'ERR:%'
    and pg_temp.st(jd) = v_s);
  v_log := v_log || pg_temp.chk('T06b', 'ใบ cancelled: UPDATE / ย้อนสถานะ / DELETE ถูกปฏิเสธเช่นกัน',
    pg_temp.x(format('update analytics.job set note = ''x'' where id = %L', jx)) like 'ERR:22023:%'
    and pg_temp.x(format('update analytics.job set status = ''open'', cancelled_at = null, cancel_reason = null where id = %L', jx)) like 'ERR:22023:%'
    and pg_temp.x(format('delete from analytics.job where id = %L', jx)) like 'ERR:22023:%');
  v_ok := true;
  foreach v_s in array array[
    'select analytics.job_office_receive(%1$L, %2$L, 1, %4$L, null, null, ''x'', ''job_page'', %3$L)',
    'select analytics.job_office_send(%1$L, %2$L, 1, %4$L, null, 0, null, 0, null, null, ''job_page'', %3$L)',
    'select analytics.job_stage_skip(%1$L, %2$L, ''qc'', ''ทดสอบ'', %3$L)',
    'select analytics.job_stage_reopen(%1$L, %2$L, ''ทดสอบ'', %3$L)',
    'select analytics.job_set_due(%1$L, %2$L, null, %3$L)',
    'select analytics.job_token_issue(%1$L, %2$L, true, %3$L)',
    'select analytics.job_start_gate_note_set(%1$L, %2$L, ''ทดสอบ'', %3$L)',
    'select analytics.job_done(%1$L, %2$L, 10, 0, null, null, %3$L)',
    'select analytics.job_cancel(%1$L, %2$L, ''ทดสอบ'', %3$L)'] loop
    v_ok := v_ok and pg_temp.code(pg_temp.q(format(v_s, p_shop, jd, v_actor, v_today))) = 'job_closed'
                 and pg_temp.code(pg_temp.q(format(v_s, p_shop, jx, v_actor, v_today))) = 'job_closed';
  end loop;
  v_log := v_log || pg_temp.chk('T06c', 'RPC ออฟฟิศทุกตัว (รับ/ส่ง/ข้าม/ย้อน/กำหนดส่ง/ออก token/เหตุผลมัดจำ/ปิด/ยกเลิก) กับใบ done และ cancelled ถูกปฏิเสธ job_closed', v_ok);
  v_log := v_log || pg_temp.chk('T06d', 'ใบ done: ไม่มี token ที่ใช้งานได้ · ขั้นทั้งหมด sent/skipped · ไม่มีขั้นค้าง', not exists (select 1 from analytics.job_token t where t.job_id = jd and t.revoked_at is null)
    and not exists (select 1 from analytics.job_stage s where s.job_id = jd and s.status in ('pending', 'received')));

  -- ---------- #20 payload ฝั่งช่างไม่มีราคา/ต้นทุน/ลูกค้า ----------
  d := pg_temp.mkjob(p_shop, p_tpl, 'silver', 10, null, 'verify: เริ่มก่อนมัดจำ', v_cust);
  jq := pg_temp.jid(d);
  update analytics.oem_quote set customer_contact = v_contact where id = (d ->> 'quote_id')::uuid;
  select coalesce(i.cost_piece::text, ''), coalesce(i.price_per_piece::text, ''), coalesce(i.item_total::text, '') into v_cost, v_price, v_total from analytics.oem_quote_item i where i.id = (d ->> 'item_id')::uuid;
  t := pg_temp.tok(p_shop, jq);
  r := pg_temp.wu(p_shop, 'v172-payload', '', '8246'); w := (r ->> 'id')::uuid;
  lg := pg_temp.login(t ->> 'hash', w, '8246'); sess := lg ->> 'session_hash';
  v_pay := pg_temp.w_res(t ->> 'hash')::text;                                   -- ยังไม่ระบุตัว
  v_pay := v_pay || pg_temp.w_res(t ->> 'hash', sess)::text;                     -- รอรับ
  v_pay := v_pay || pg_temp.w_recv(t ->> 'hash', sess, 1)::text;
  v_pay := v_pay || pg_temp.w_res(t ->> 'hash', sess)::text;                     -- รอส่ง
  v_pay := v_pay || pg_temp.w_send(t ->> 'hash', sess, 1)::text;
  v_pay := v_pay || pg_temp.w_recv(t ->> 'hash', sess, 2)::text || pg_temp.w_send(t ->> 'hash', sess, 2, null, 1, 'broken')::text;
  v_pay := v_pay || pg_temp.w_res(t ->> 'hash', sess)::text || lg::text || pg_temp.w_res('f' || repeat('0', 63))::text;
  v_log := v_log || pg_temp.chk('T20a', 'payload ที่ช่างได้ (resolve ก่อน/หลังระบุตัว · รับ · ส่ง · login · ข้อผิดพลาด) ไม่มี key ที่เกี่ยวกับ cost/price/margin/customer/quote/po/paid/total/nre/vat/discount/deposit/contact/approval',
    length(v_pay) > 500 and v_pay !~* '"[^"]*(cost|price|margin|customer|quote|po_no|paid|total|nre_|grand|vat|discount|deposit_|buy_|floor|contact|approval|lost_)[^"]*"[[:space:]]*:');
  v_log := v_log || pg_temp.chk('T20b', 'payload ไม่มีค่าที่ห้ามหลุด: ชื่อลูกค้า · ช่องทางติดต่อ · เลขใบเสนอราคา · ตัวเลขต้นทุน/ราคาต่อชิ้น/ยอดรวมของ item จริง',
    position(v_cust in v_pay) = 0 and position(v_contact in v_pay) = 0 and position((d ->> 'quote_no') in v_pay) = 0
    and (length(rtrim(v_cost, '0.')) < 5 or position(rtrim(rtrim(v_cost, '0'), '.') in v_pay) = 0)
    and (length(rtrim(v_price, '0.')) < 5 or position(rtrim(rtrim(v_price, '0'), '.') in v_pay) = 0)
    and (length(rtrim(v_total, '0.')) < 5 or position(rtrim(rtrim(v_total, '0'), '.') in v_pay) = 0));
  -- production source: ไม่มีเลข PO
  select p.id into v_prod from public.product p where p.shop_id = p_shop and p.is_active and p.sku !~* '^live' and p.cost_type in ('fixed', 'spot') order by p.sku limit 1;
  v_pr1 := pg_temp.q(format('select pg_temp.po_save(p_shop_id=>%L, p_note=>%L)', p_shop, 'verify0172-d1'));
  v_po1 := (v_pr1 ->> 'id')::uuid;
  perform analytics.production_order_item_set(p_shop, v_po1, v_prod, 10);
  select id into v_poi1 from analytics.production_order_item where production_order_id = v_po1;
  jp := pg_temp.jid(pg_temp.q(format('select analytics.job_create_from_production_item(%L, %L, %L::text[], null, null, null, %L)', p_shop, v_poi1, pg_temp.std(), v_actor)));
  t := pg_temp.tok(p_shop, jp);
  v_pay := pg_temp.w_res(t ->> 'hash', sess)::text || pg_temp.w_recv(t ->> 'hash', sess, 1)::text || pg_temp.w_res(t ->> 'hash', sess)::text;
  v_log := v_log || pg_temp.chk('T20c', 'งานผลิตเข้าสต็อก: payload ช่างไม่มีเลขใบผลิต (PO-xxxx) และไม่มี key ต้องห้าม',
    position((v_pr1 ->> 'po_no') in v_pay) = 0 and v_pay !~* '"[^"]*(cost|price|margin|customer|quote|po_no|paid|total)[^"]*"[[:space:]]*:' and length(v_pay) > 300);
  select string_agg(table_name || '.' || column_name, ', ') into v_bad
    from information_schema.columns
   where table_schema = 'analytics' and table_name in ('v_job_board', 'v_job_stage_loss', 'v_job_stage_from_events', 'v_production_order_job_mismatch')
     and column_name ~* '(cost|price|margin|customer|total|paid|nre|grand|vat|discount|contact|approval)';
  v_log := v_log || pg_temp.chk('T20d', 'view ฝั่งออฟฟิศ (v_job_board / v_job_stage_loss / v_job_stage_from_events / v_production_order_job_mismatch) ไม่มีคอลัมน์ต้นทุน/ราคา/margin/ชื่อลูกค้า: ' || coalesce(v_bad, '(ไม่มี)'), v_bad is null);
  v_log := v_log || pg_temp.chk('T20e', 'คอลัมน์ของ resolve payload ฝั่งช่างขึ้นอยู่กับ key ที่ประกอบทีละตัว: ไม่ใช้ to_jsonb(row) ในฟังก์ชันฝั่งช่าง (กัน field ใหม่หลุดตามมา)',
    not exists (select 1 from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname in ('job_worker_resolve', 'job_worker_receive', 'job_worker_send', 'worker_pin_verify', 'job_worker_auth', 'job_core_receive', 'job_core_send')
                 and (p.prosrc ~* 'to_jsonb[[:space:]]*\([[:space:]]*v_(job|s|s2|t|t2|w|hold|pend|prev|tok|p|p2)[[:space:]]*\)' or p.prosrc ~* 'row_to_json' or p.prosrc ~* 'jsonb_agg[[:space:]]*\([[:space:]]*(j|s|w|q)[[:space:]]*\)')));

  -- ---------- #19 สิทธิ์ ----------
  select count(*) into v_fn_n from pg_proc where pronamespace = 'analytics'::regnamespace and (proname like 'job\_%' or proname like 'worker\_%');
  v_log := v_log || pg_temp.chk('T19a', format('ฟังก์ชันใหม่ %s ตัวใน analytics: ไม่มี PUBLIC/anon/authenticated ถือ EXECUTE (ACL ไม่ใช่ null · ไม่มี grantee 0) ทุกตัว', v_fn_n),
    v_fn_n >= 40 and not exists (select 1 from pg_proc p where p.pronamespace = 'analytics'::regnamespace and (p.proname like 'job\_%' or p.proname like 'worker\_%') and p.proacl is null)
    and not exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                     where p.pronamespace = 'analytics'::regnamespace and (p.proname like 'job\_%' or p.proname like 'worker\_%')
                       and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole))
    and not exists (select 1 from pg_proc p where p.pronamespace = 'analytics'::regnamespace and (p.proname like 'job\_%' or p.proname like 'worker\_%')
                     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))));
  v_log := v_log || pg_temp.chk('T19b', 'service_role ถือ EXECUTE เฉพาะ RPC ที่เปิดใช้ (23 ตัว + helper 3 ตัวที่ view ใช้) · helper ภายใน (core/auth/event_write/office_begin/rate_limit) ไม่มีใครถือ',
    (select count(*) from pg_proc p where p.pronamespace = 'analytics'::regnamespace and (p.proname like 'job\_%' or p.proname like 'worker\_%') and has_function_privilege('service_role', p.oid, 'execute')) = 26
    and not exists (select 1 from pg_proc p where p.pronamespace = 'analytics'::regnamespace and p.proname in
         ('job_core_receive', 'job_core_send', 'job_worker_auth', 'job_event_write', 'job_office_begin', 'job_rate_limit_hit', 'job_create_insert', 'job_source_info', 'job_text_clean', 'job_pin_generate', 'job_stage_def_ensure')
         and has_function_privilege('service_role', p.oid, 'execute')));
  v_ok := true; v_bad := '';
  for rec in select c.relname, c.relkind from pg_class c where c.relnamespace = 'analytics'::regnamespace
              and c.relname in ('job_counter', 'job_stage_def', 'worker', 'worker_audit', 'worker_session', 'job', 'job_stage', 'job_event', 'job_token', 'worker_rate_limit',
                                'v_job_board', 'v_job_stage_loss', 'v_job_stage_from_events', 'v_production_order_job_mismatch') loop
    if has_table_privilege('anon', 'analytics.' || rec.relname, 'select,insert,update,delete,truncate,references,trigger')
       or has_table_privilege('authenticated', 'analytics.' || rec.relname, 'select,insert,update,delete,truncate,references,trigger')
       or has_table_privilege('service_role', 'analytics.' || rec.relname, 'insert,update,delete,truncate,references,trigger') then
      v_ok := false; v_bad := v_bad || rec.relname || ' ';
    end if;
    if rec.relkind = 'r' and not (select c.relrowsecurity from pg_class c where c.oid = ('analytics.' || rec.relname)::regclass) then
      v_ok := false; v_bad := v_bad || rec.relname || '(ไม่เปิด RLS) ';
    end if;
  end loop;
  v_log := v_log || pg_temp.chk('T19c', 'ตาราง/view ใหม่ 14 ตัว: anon/authenticated ไม่มีสิทธิ์ใดเลย · service_role ไม่มี INSERT/UPDATE/DELETE/TRUNCATE (เขียนผ่าน RPC เท่านั้น) · ตารางเปิด RLS ทั้งหมด: ' || coalesce(nullif(v_bad, ''), '(ไม่มีที่ผิด)'), v_ok);
  v_log := v_log || pg_temp.chk('T19d', 'service_role อ่านได้เฉพาะที่เปิด: job/job_stage/job_event/worker_audit/job_stage_def + worker และ job_token แบบไม่มีคอลัมน์ลับ · job_counter/worker_session/worker_rate_limit อ่านไม่ได้',
    pg_temp.as_role('service_role', 'select count(*) from analytics.job') = 'OK' and pg_temp.as_role('service_role', 'select count(*) from analytics.job_event') = 'OK'
    and pg_temp.as_role('service_role', 'select id, display_name, stage_codes, is_active from analytics.worker') = 'OK'
    and pg_temp.as_role('service_role', 'select id, job_id, revoked_at from analytics.job_token') = 'OK'
    and pg_temp.as_role('service_role', 'select count(*) from analytics.worker_audit') = 'OK'
    and pg_temp.as_role('service_role', 'select pin_hash from analytics.worker') like 'ERR:42501:%'
    and pg_temp.as_role('service_role', 'select failed_attempts from analytics.worker') = 'OK'
    and pg_temp.as_role('service_role', 'select token_hash from analytics.job_token') like 'ERR:42501:%'
    and pg_temp.as_role('service_role', 'select count(*) from analytics.worker_session') like 'ERR:42501:%'
    and pg_temp.as_role('service_role', 'select count(*) from analytics.worker_rate_limit') like 'ERR:42501:%');
  v_log := v_log || pg_temp.chk('T19e', 'service_role เรียก RPC ได้จริง (grant ทำงาน) และอ่านทุก view ได้ (security_invoker ต้องมีสิทธิ์ตารางต้นทาง): v_job_board / v_job_stage_loss / v_job_stage_from_events / v_production_order_job_mismatch',
    pg_temp.as_role('service_role', format('select analytics.job_worker_resolve(%L)', repeat('a', 64))) = 'OK'
    and pg_temp.as_role('service_role', format('select analytics.worker_pin_verify(%L, %L, %L)', repeat('a', 64), gen_random_uuid(), '4829')) = 'OK'
    and pg_temp.as_role('service_role', 'select count(*) from analytics.v_job_board') = 'OK'
    and pg_temp.as_role('service_role', 'select count(*) from analytics.v_job_stage_loss') = 'OK'
    and pg_temp.as_role('service_role', 'select count(*) from analytics.v_job_stage_from_events') = 'OK'
    and pg_temp.as_role('service_role', 'select count(*) from analytics.v_production_order_job_mismatch') = 'OK'
    and pg_temp.as_role('service_role', 'select analytics.job_core_receive(null, null, null, null, null, null, null, null, null, null)') like 'ERR:42501:%'
    and pg_temp.as_role('service_role', format('select analytics.job_worker_auth(%L, null, null, true, true, ''write'')', repeat('a', 64))) like 'ERR:42501:%');
  -- จำลองวันที่กำแพงชั้นนอก (USAGE ของสคีมา) หลุด (migration-traps ข้อ 18.5): ต้องยังตกที่ 42501 ของฟังก์ชัน/ตาราง
  v_ok := not has_schema_privilege('authenticated', 'analytics', 'usage') and not has_schema_privilege('anon', 'analytics', 'usage');
  grant usage on schema analytics to authenticated, anon;
  v_log := v_log || pg_temp.chk('T19f', 'แม้ USAGE ของสคีมา analytics หลุดไปถึง anon/authenticated: เรียก RPC ช่าง/ออฟฟิศ (รวม null ทุกพารามิเตอร์) · อ่านตาราง/view ทั้งหมด ตกที่ 42501 (กำแพงชั้นในยังอยู่)',
    v_ok
    and pg_temp.as_role('authenticated', 'select analytics.job_worker_resolve(null, null, null)') like 'ERR:42501:%'
    and pg_temp.as_role('anon', 'select analytics.job_worker_resolve(null, null, null)') like 'ERR:42501:%'
    and pg_temp.as_role('anon', 'select analytics.worker_pin_verify(null, null, null, null, null)') like 'ERR:42501:%'
    and pg_temp.as_role('authenticated', 'select analytics.job_worker_receive(null, null, null)') like 'ERR:42501:%'
    and pg_temp.as_role('anon', 'select analytics.job_worker_send(null, null, null)') like 'ERR:42501:%'
    and pg_temp.as_role('authenticated', 'select analytics.job_create_from_quote_item(null, null, null)') like 'ERR:42501:%'
    and pg_temp.as_role('authenticated', 'select analytics.job_token_issue(null, null)') like 'ERR:42501:%'
    and pg_temp.as_role('authenticated', 'select analytics.worker_upsert(null)') like 'ERR:42501:%'
    and pg_temp.as_role('authenticated', 'select analytics.worker_pin_set(null, null)') like 'ERR:42501:%'
    and pg_temp.as_role('authenticated', 'select analytics.job_done(null, null, null, null)') like 'ERR:42501:%'
    and pg_temp.as_role('anon', 'select analytics.job_today()') like 'ERR:42501:%'
    and pg_temp.as_role('authenticated', 'select * from analytics.job') like 'ERR:42501:%'
    and pg_temp.as_role('anon', 'select * from analytics.v_job_board') like 'ERR:42501:%'
    and pg_temp.as_role('authenticated', 'select * from analytics.job_event') like 'ERR:42501:%'
    and pg_temp.as_role('authenticated', 'select * from analytics.worker') like 'ERR:42501:%'
    and pg_temp.as_role('authenticated', 'insert into analytics.job_token (shop_id, job_id, token_hash, print_no, issued_by) values (gen_random_uuid(), gen_random_uuid(), repeat(''a'', 64), 1, gen_random_uuid())') like 'ERR:42501:%');
  revoke usage on schema analytics from authenticated, anon;

  -- ---------- R1: renegotiate ดีลที่มีใบงานแล้ว ----------
  d := pg_temp.mkjob(p_shop, p_tpl, 'silver', 10);
  jr := pg_temp.jid(d);
  d2 := pg_temp.clone_deal((d ->> 'item_id')::uuid, 'silver', 8, (select coalesce(q.root_quote_id, q.id) from analytics.oem_quote q where q.id = (d ->> 'quote_id')::uuid), 'won');
  update analytics.oem_quote set status = 'superseded' where id = (d ->> 'quote_id')::uuid;
  v_log := v_log || pg_temp.chk('R1a', 'ดีลต่อราคาแล้วจำนวนเปลี่ยน (10 -> 8): บอร์ดขึ้น quote_qty_mismatch=true · quote_item_qty=8 · source_ref ชี้เลขใบเสนอราคาล่าสุดของดีล · ใบงานเดิมไม่ถูกแก้ (qty_planned ยัง 10)',
    exists (select 1 from analytics.v_job_board b where b.id = jr and b.quote_qty_mismatch and b.quote_item_qty = 8 and b.source_ref = (d2 ->> 'quote_no') and b.qty_planned = 10));
  v_log := v_log || pg_temp.chk('R1b', 'สร้างใบงานซ้ำจาก item ของใบเสนอราคาใหม่ในดีลเดียวกัน (ลำดับ item เดิม) ถูกปฏิเสธ job_exists — กันผลิตซ้ำ',
    pg_temp.code(pg_temp.q(format('select pg_temp.jcq(%L, %L, %L::text[], null, %L, null, null, %L)', p_shop, d2 ->> 'item_id', pg_temp.std(), 'verify-gate', v_actor))) = 'job_exists');
  r := pg_temp.q(format('select analytics.job_cancel(%L, %L, %L, %L)', p_shop, jr, 'จำนวนในใบเสนอราคาเปลี่ยน ยกเลิกแล้วสร้างใหม่', v_actor));
  r2 := pg_temp.q(format('select pg_temp.jcq(%L, %L, %L::text[], null, %L, null, null, %L)', p_shop, d2 ->> 'item_id', pg_temp.std(), 'verify-gate', v_actor));
  v_log := v_log || pg_temp.chk('R1c', 'ยกเลิกใบเดิมแล้วสร้างใหม่จาก item ของใบเสนอราคาใหม่ได้ (qty_planned=8) · บอร์ดไม่ขึ้น mismatch',
    (r ->> 'status') = 'cancelled' and r2 ? 'job_id' and exists (select 1 from analytics.v_job_board b where b.id = pg_temp.jid(r2) and b.qty_planned = 8 and not b.quote_qty_mismatch));

  -- ---------- D1 drift ----------
  jdrift := pg_temp.jid(pg_temp.mkjob(p_shop, p_tpl, 'silver', 10));
  r := pg_temp.o_run(p_shop, jdrift, 1, 3, v_today);
  r2 := pg_temp.o_recv(p_shop, jdrift, 4, v_today, 10.0, null, 'ช่างเอ');
  m := pg_temp.q(format('select analytics.job_stage_reopen(%L, %L, %L, %L)', p_shop, jdrift, 'ทดสอบ drift', v_actor));
  r := pg_temp.q(format('select analytics.job_stage_skip(%L, %L, %L, %L, %L)', p_shop, jdrift, 'cut_sprue', 'ไม่ต้องตัดต้น', v_actor));
  select count(*) into v_n from analytics.v_job_stage_from_events where job_id = jdrift and drift;
  v_log := v_log || pg_temp.chk('D1a', 'หลังรับ/ส่ง/ย้อน/ข้ามผ่าน RPC: สถานะขั้นที่ reconstruct จาก event ล่าสุด = job_stage จริงทุกขั้น (drift 0 ขั้น)', v_n = 0 and (select count(*) from analytics.v_job_stage_from_events where job_id = jdrift) = 8);
  update analytics.job_stage set status = 'skipped', skip_reason = 'เขียนตรง ไม่มี event' where job_id = jdrift and seq = 6;
  v_log := v_log || pg_temp.chk('D1b', 'เขียน job_stage ตรง (ข้าม RPC ไม่มี event) → view drift จับได้ drift=true ขั้นนั้น', exists (select 1 from analytics.v_job_stage_from_events v where v.job_id = jdrift and v.stage_code = 'polish' and v.drift));
  v_log := v_log || pg_temp.chk('D1c', 'current_stage_code / status ของใบงานตามขั้นจริงเสมอ (trigger sync): ใบนี้ขั้นปัจจุบัน = qc? ไม่ใช่ — ขั้น 4 pending ถูกย้อนแล้ว', (select current_stage_code from analytics.job where id = jdrift) = 'cast' and (select status from analytics.job where id = jdrift) = 'in_progress');

  -- ---------- N09 / R2 ใบผลิตเดิม ----------
  -- ใบผลิต A (มีใบงานที่กำลังเดิน jp) · ใบผลิต B (มีใบงาน jr2 ที่ยังไม่เริ่ม) · ใบผลิต C (ไม่มีใบงานเลย)
  v_pr2 := pg_temp.q(format('select pg_temp.po_save(p_shop_id=>%L, p_note=>%L)', p_shop, 'verify0172-d2'));
  v_po2 := (v_pr2 ->> 'id')::uuid;
  perform analytics.production_order_item_set(p_shop, v_po2, v_prod, 10);
  select id into v_poi2 from analytics.production_order_item where production_order_id = v_po2;
  jr2 := pg_temp.jid(pg_temp.q(format('select analytics.job_create_from_production_item(%L, %L, %L::text[], null, null, null, %L)', p_shop, v_poi2, pg_temp.std(), v_actor)));
  v_pr1 := pg_temp.q(format('select pg_temp.po_save(p_shop_id=>%L, p_note=>%L)', p_shop, 'verify0172-d4'));
  perform analytics.production_order_item_set(p_shop, (v_pr1 ->> 'id')::uuid, v_prod, 10);
  r := pg_temp.q(format('select analytics.production_order_done(%L, %L)', p_shop, v_po1));
  d2 := pg_temp.q(format('select analytics.production_order_done(%L, %L)', p_shop, (v_pr1 ->> 'id')::uuid));
  if (d2 ? '_err') and (r ? '_err') then
    v_log := v_log || '[SKIP] N09  production_order_done ใช้ไม่ได้ในสภาพ DB ตอนนี้ (' || left(coalesce(d2 ->> '_err', ''), 90) || ') — เทียบพฤติกรรมสำเร็จไม่ได้ · เทียบชนิด error แทน' || E'\n';
    v_log := v_log || pg_temp.chk('N09e', 'ใบผลิตที่มี/ไม่มีใบงาน ให้ผลชนิดเดียวกัน (error เดียวกัน)', (r ->> '_state') = (d2 ->> '_state') and (r ->> '_err') = (d2 ->> '_err'));
  else
    v_log := v_log || pg_temp.chk('N09', 'production_order_done ของใบที่ "มีใบงานกำลังเดิน" ทำงานเหมือนใบที่ "ไม่มีใบงาน" (สำเร็จทั้งคู่ · ใบงานไม่ถูกแตะ: jp ยัง in_progress)',
      not (r ? '_err') and not (d2 ? '_err') and (select status = 'in_progress' from analytics.job where id = jp) and (select status = 'open' from analytics.job where id = jr2));
  end if;
  -- R2: ใบงานผลิตปิดด้วยดี 9 เสีย 1 แต่ใบผลิตนับ 10 → mismatch โผล่ (ไม่บังคับให้เท่ากัน) · ใบที่ดี = qty_done ไม่โผล่
  r := pg_temp.o_run(p_shop, jr2, 1, 8, v_today);
  v_s := pg_temp.x(format('update analytics.production_order_item set qty_done = 10 where id = %L and qty_done is null', v_poi2));
  r2 := pg_temp.q(format('select analytics.job_done(%L, %L, 9, 1, null, null, %L)', p_shop, jr2, v_actor));
  if v_s <> 'OK' then
    v_log := v_log || '[SKIP] R2a  ตั้ง qty_done ของใบผลิตตรงไม่ได้ (' || left(v_s, 80) || ') — เทียบ mismatch ไม่ได้' || E'\n';
  else
    v_log := v_log || pg_temp.chk('R2a', 'ใบงานผลิตปิด qty_good=9 แต่ใบผลิต qty_done=10 → v_production_order_job_mismatch มีแถว (qty_done 10 / qty_good 9) · ใบงานปิดได้โดยไม่ถูกบังคับให้เท่า',
      r ? 'ok' and r2 ? 'ok' and exists (select 1 from analytics.v_production_order_job_mismatch m2 where m2.job_id = jr2 and m2.qty_done = 10 and m2.qty_good = 9));
  end if;
  r := pg_temp.o_run(p_shop, jp, 1, 8, v_today);
  r2 := pg_temp.q(format('select analytics.job_done(%L, %L, 10, 0, null, null, %L)', p_shop, jp, v_actor));
  v_log := v_log || pg_temp.chk('R2b', 'ใบงานผลิต jp เดินต่อหลังใบผลิต A ถูก done ไปแล้วได้ · ปิด qty_good=10 ไม่ขึ้น mismatch',
    r ? 'ok' and r2 ? 'ok' and not exists (select 1 from analytics.v_production_order_job_mismatch m2 where m2.job_id = jp));

  -- ---------- N10 / K1b ----------
  select count(*) into v_n from analytics.oem_quote;
  v_log := v_log || pg_temp.chk('N10', 'v_oem_quote อ่านได้ครบทุกสถานะที่มีจริงเหมือนเดิม (นับแถว v_oem_quote = oem_quote) · ไม่มีฟังก์ชัน OEM ถูกแทนที่ (md5 อยู่ใน migration)',
    (select count(*) from analytics.v_oem_quote) = v_n and v_n > 0);
  v_log := v_log || pg_temp.chk('K1b', 'เลขใบงานไม่ซ้ำในร้าน · ตรงรูปแบบ JB-nnnn · เลขเรียงต่อเนื่องไม่มีช่องว่างในทรานแซกชัน (นับแถว = last_no - ค่าเริ่ม)',
    (select count(distinct job_no) = count(*) and bool_and(job_no ~ '^JB-[0-9]{4,}$') from analytics.job where shop_id = p_shop));

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
  select pg_temp.run_sec('sa', p_shop, p_tpl) || pg_temp.run_sec('sb', p_shop, p_tpl) || pg_temp.run_sec('sc', p_shop, p_tpl) || pg_temp.run_sec('sd', p_shop, p_tpl)
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

do $v172$
declare
  v_shop uuid; v_tpl uuid;
  v_log text := ''; v_s text; v_fail int; v_snap0 text; v_snap1 text;
  v_m record; v_killed int := 0; v_total int; v_survived text := ''; v_cnt int; v_id text; v_hit int;
  v_skip int; v_ok_cnt int;
  v_mutants jsonb := jsonb_build_array(
    jsonb_build_object('id', 'MU01', 'what', 'ปิด trigger append-only ของ job_event', 'ddl', 'alter table analytics.job_event disable trigger trg_job_event_append_only', 'expect', jsonb_build_array('T05a')),
    jsonb_build_object('id', 'MU02', 'what', 'job_stage_guard ไม่เช็คขั้นก่อนหน้า pending (เขียนตรงข้ามลำดับ)', 'fn', 'job_stage_guard',
      'from', 's.seq < new.seq and s.status = ''pending'')', 'to', 's.seq < new.seq and s.status = ''pending'' and false)', 'expect', jsonb_build_array('T01b')),
    jsonb_build_object('id', 'MU03', 'what', 'ทองไม่ถูกกัน auto-close ในชั้น RPC', 'fn', 'job_core_receive',
      'from', 'if v_job.metal = ''gold'' then', 'to', 'if v_job.metal = ''zzz'' then', 'expect', jsonb_build_array('T01d')),
    jsonb_build_object('id', 'MU04', 'what', 'ฝั่งช่างไม่เช็ค worker.is_active สด', 'fn', 'job_worker_auth',
      'from', 'and w.is_active and w.shop_id = v_job.shop_id', 'to', 'and w.shop_id = v_job.shop_id', 'expect', jsonb_build_array('T17j')),
    jsonb_build_object('id', 'MU05', 'what', 'token ที่เพิกถอนแล้วยังผ่าน', 'fn', 'job_worker_auth',
      'from', 'if v_tok.revoked_at is not null then', 'to', 'if false then', 'expect', jsonb_build_array('N08', 'T16f')),
    jsonb_build_object('id', 'MU06', 'what', 'PIN ผิดไม่ล็อก (เพดาน 5 -> 500)', 'fn', 'worker_pin_verify',
      'from', 'when v_att = 5 then now() + interval ''15 minutes''', 'to', 'when v_att = 500 then now() + interval ''15 minutes''', 'expect', jsonb_build_array('T17e')),
    jsonb_build_object('id', 'MU07', 'what', 'rate limit ไม่จำกัด', 'fn', 'job_rate_limit_hit',
      'from', 'return v_hits <= p_max;', 'to', 'return true;', 'expect', jsonb_build_array('T17n', 'T17n2', 'T17o')),
    jsonb_build_object('id', 'MU08', 'what', 'วันที่ในอนาคตผ่าน (รับงาน)', 'fn', 'job_core_receive',
      'from', 'or p_occurred_on > v_today', 'to', 'or false', 'expect', jsonb_build_array('T09a')),
    jsonb_build_object('id', 'MU09', 'what', 'สร้างใบงานดีลไม่มีมัดจำโดยไม่ต้องมีเหตุผล', 'fn', 'job_create_from_quote_item',
      'from', 'if (v_info ->> ''deposit_missing'')::boolean and v_gate is null then', 'to', 'if false then', 'expect', jsonb_build_array('T13a')),
    jsonb_build_object('id', 'MU10', 'what', 'ช่างรับงานดีลไม่มีมัดจำได้ (ด่านตอนรับหาย)', 'fn', 'job_core_receive',
      'from', 'if coalesce(v_paid, 0) <= 0 and v_job.start_gate_note is null then', 'to', 'if false then', 'expect', jsonb_build_array('T13e')),
    jsonb_build_object('id', 'MU11', 'what', 'payload ช่างรั่วชื่อลูกค้า', 'fn', 'job_worker_resolve',
      'from', '''design_label'', v_job.design_label,', 'to', '''design_label'', v_job.design_label, ''customer_name'', (select q.customer_name from analytics.oem_quote q limit 1),', 'expect', jsonb_build_array('T20a')),
    jsonb_build_object('id', 'MU12', 'what', 'ช่างส่งต่อขั้นที่คนอื่นถือได้', 'fn', 'job_core_send',
      'from', 'if p_enforce_holder and v_s.worker_id is distinct from p_worker_id then', 'to', 'if false then', 'expect', jsonb_build_array('T18c')),
    jsonb_build_object('id', 'MU13', 'what', 'พิมพ์ซ้ำไม่เพิกถอน QR เก่า', 'fn', 'job_token_issue',
      'from', 'if coalesce(p_revoke_previous, true) then', 'to', 'if false then', 'expect', jsonb_build_array('N08')),
    jsonb_build_object('id', 'MU14', 'what', 'ปิด trigger job_guard (ใบ done/cancelled แก้ได้)', 'ddl', 'alter table analytics.job disable trigger trg_job_guard', 'expect', jsonb_build_array('T06a', 'T06b')),
    jsonb_build_object('id', 'MU15', 'what', 'PIN เดาง่ายผ่าน', 'fn', 'job_pin_ok',
      'from', 'select p_pin ~ ''^[0-9]{4}$''', 'to', 'select true or p_pin ~ ''^[0-9]{4}$''', 'expect', jsonb_build_array('T17a')),
    jsonb_build_object('id', 'MU16', 'what', 'เหตุผลที่ไม่ใช่ข้อความจริง ("." ) ผ่านด่าน whitelist', 'fn', 'job_text_clean',
      'from', 'if p_present and not analytics.oem_note_present(v) then', 'to', 'if false then', 'expect', jsonb_build_array('T04a')),
    jsonb_build_object('id', 'MU17', 'what', 'น้ำหนักทศนิยมเกิน 3 ตำแหน่งผ่าน', 'fn', 'job_weight_ok',
      'from', 'and p_w = round(p_w, 3)', 'to', 'and true', 'expect', jsonb_build_array('T02a')),
    jsonb_build_object('id', 'MU18', 'what', 'ช่างปิดใช้งานแล้วยังใส่ PIN เข้าได้', 'fn', 'worker_pin_verify',
      'from', 'if not found or not v_w.is_active then', 'to', 'if not found then', 'expect', jsonb_build_array('T17k')),
    jsonb_build_object('id', 'MU19', 'what', 'ช่างรับขั้นนอก stage_codes ได้', 'fn', 'job_core_receive',
      'from', 'if p_enforce_scope and p_worker_id is not null then', 'to', 'if false then', 'expect', jsonb_build_array('T18h')),
    jsonb_build_object('id', 'MU20', 'what', 'ปิด trigger job_token_guard (ฟื้น token ที่เพิกถอนได้)', 'ddl', 'alter table analytics.job_token disable trigger trg_job_token_guard', 'expect', jsonb_build_array('T16g')),
    jsonb_build_object('id', 'MU21', 'what', 'grant EXECUTE ให้ anon กับ RPC ช่าง', 'ddl', 'grant execute on function analytics.job_worker_resolve(text, text, text) to anon', 'expect', jsonb_build_array('T19a')),
    jsonb_build_object('id', 'MU22', 'what', 'ขั้นข้ามไม่ตรวจสถานะ pending (ข้ามขั้นที่รับแล้วได้)', 'fn', 'job_stage_skip',
      'from', 'if v_s.status <> ''pending'' then', 'to', 'if false then', 'expect', jsonb_build_array('T04f')),
    jsonb_build_object('id', 'MU23', 'what', 'สองมือถือรับขั้นเดียวกัน: ตัวหลังได้ error แทน "รับแล้วโดย X"', 'fn', 'job_core_receive',
      'from', 'if v_t.status = ''received'' then', 'to', 'if false then', 'expect', jsonb_build_array('N05', 'T01f')),
    jsonb_build_object('id', 'MU24', 'what', 'กดส่งต่อซ้ำ (double tap) ไม่ idempotent', 'fn', 'job_core_send',
      'from', 'if v_s.status = ''sent'' then', 'to', 'if false then', 'expect', jsonb_build_array('T18e')),
    jsonb_build_object('id', 'MU25', 'what', 'recorded_at ปลอมได้ (ปิด trigger before insert ของ job_event)', 'ddl', 'alter table analytics.job_event disable trigger trg_job_event_before_insert', 'expect', jsonb_build_array('T05c')),
    jsonb_build_object('id', 'MU26', 'what', 'ตัด CHECK น้ำหนักออกเกินเข้า (ชั้นตาราง)', 'ddl', 'alter table analytics.job_stage drop constraint js_weight_ck', 'expect', jsonb_build_array('T02e')),
    jsonb_build_object('id', 'MU27', 'what', 'ปิดงานได้ทั้งที่จำนวนดี > จำนวนที่เหลือจากขั้นสุดท้าย', 'fn', 'job_done',
      'from', 'if p_qty_good > v_final_out then', 'to', 'if false then', 'expect', jsonb_build_array('T10g')),
    jsonb_build_object('id', 'MU28', 'what', 'กำหนดส่งย้อนหลังผ่าน', 'fn', 'job_set_due',
      'from', 'p_due_date < v_today', 'to', 'false', 'expect', jsonb_build_array('T09g')),
    jsonb_build_object('id', 'MU29', 'what', 'ปิด trigger sync current_stage_code', 'ddl', 'alter table analytics.job_stage disable trigger trg_job_stage_sync', 'expect', jsonb_build_array('D1c')),
    jsonb_build_object('id', 'MU30', 'what', 'รับงานไม่เขียน event stage_receive (ประวัติหาย)', 'fn', 'job_core_receive',
      'from', 'perform analytics.job_event_write(p_job_id, v_t.id, ''stage_receive'',', 'to', 'perform analytics.job_event_write(p_job_id, v_t.id, ''note'',', 'expect', jsonb_build_array('T18b', 'T09b')),
    jsonb_build_object('id', 'MU31', 'what', 'ลบด่าน PIN ล็อก: PIN ผิดคืน raise (ตัวนับ rollback)', 'fn', 'worker_pin_verify',
      'from', '  return analytics.job_fail(''bad_credentials'', ''ชื่อหรือ PIN ไม่ถูกต้อง'',', 'to', '  raise exception ''bad pin'' using errcode = ''22023''; return analytics.job_fail(''bad_credentials'', ''x'',', 'expect', jsonb_build_array('T17d'))
  );
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select id into v_shop from public.shop order by created_at limit 1;
  select i.id into v_tpl from analytics.oem_quote_item i join analytics.oem_quote q on q.id = i.quote_id
   where i.shop_id = v_shop and i.input ->> 'metal' = 'silver' and q.quote_no not like 'V172-%' order by q.created_at, i.seq limit 1;
  if v_tpl is null then
    v_log := v_log || '[FAIL] S0  ไม่มี oem_quote_item เงินจริงให้ใช้เป็นแม่แบบ fixture — ชุดทดสอบรันต่อไม่ได้' || E'\n';
    raise exception E'%', v_log;
  end if;

  create temp table _v172_orig on commit drop as
    select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h
      from pg_proc p where p.pronamespace = 'analytics'::regnamespace and (p.proname like 'job\_%' or p.proname like 'worker\_%');

  v_snap0 := pg_temp.snap();
  v_s := pg_temp.run_all(v_shop, v_tpl);
  v_log := v_log || v_s;
  v_snap1 := pg_temp.snap();
  v_log := v_log || pg_temp.chk('K0', 'หลังรันทุก section: แถวของตารางใบงาน + ตัวนับ + ตาราง OEM/ผลิต/สต็อก (นับ + md5 เนื้อหา) เท่าก่อนรันเป๊ะ — ไม่เผา state', v_snap0 = v_snap1);
  v_log := v_log || pg_temp.chk('K0b', 'ตัวนับเลขใบงานจริงของร้านไม่ขยับ (job_counter)', (select coalesce(max(last_no), 0) from analytics.job_counter where shop_id = v_shop) = (select coalesce(max(seq), 0) from analytics.job where shop_id = v_shop));
  v_fail := (length(v_s) - length(replace(v_s, '[FAIL]', ''))) / 6;
  v_skip := (length(v_s) - length(replace(v_s, '[SKIP]', ''))) / 6;
  v_ok_cnt := (length(v_s) - length(replace(v_s, '[OK]', ''))) / 4;

  -- ---------- mutant ----------
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

  -- ---------- คืนของเดิมแล้วตรวจซ้ำ ----------
  select count(*) into v_cnt from _v172_orig o where md5(pg_get_functiondef(to_regprocedure(o.sig))) = o.h;
  v_log := v_log || pg_temp.chk('MY', format('หลังรัน mutant: md5 definition ของฟังก์ชัน job_*/worker_* ทั้ง %s ตัวเท่าเดิม · trigger ใบงานเปิดครบ (tgenabled=O)', (select count(*) from _v172_orig)),
    v_cnt = (select count(*) from _v172_orig)
    and not exists (select 1 from pg_trigger t where t.tgrelid in ('analytics.job'::regclass, 'analytics.job_stage'::regclass, 'analytics.job_event'::regclass, 'analytics.job_token'::regclass,
                                                                 'analytics.worker'::regclass, 'analytics.worker_audit'::regclass) and not t.tgisinternal and t.tgenabled <> 'O')
    and not has_function_privilege('anon', 'analytics.job_worker_resolve(text,text,text)', 'execute'));
  v_s := pg_temp.run_all(v_shop, v_tpl);
  v_fail := (length(v_s) - length(replace(v_s, '[FAIL]', ''))) / 6;
  v_log := v_log || pg_temp.chk('MZ', 'หลังคืนของเดิม: ชุดเทสต์หลักรันซ้ำ FAIL ' || v_fail, v_fail = 0);
  if v_fail > 0 then
    v_log := v_log || (select string_agg('    (รันซ้ำ) ' || l, E'
') from unnest(string_to_array(v_s, E'
')) l where l like '[FAIL]%') || E'
';
  end if;
  v_log := v_log || pg_temp.chk('K0c', 'state ไม่ขยับหลังรัน mutant ทั้งหมด', pg_temp.snap() = v_snap0);

  v_fail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_skip := (length(v_log) - length(replace(v_log, '[SKIP]', ''))) / 6;
  v_log := v_log || format(E'\n=== สรุป: [OK] ~%s · [FAIL] ทั้งไฟล์ = %s · [SKIP] = %s %s ===\n', v_ok_cnt, v_fail, v_skip, case when v_fail = 0 then '(ผ่าน)' else '(ไม่ผ่าน)' end);
  raise exception E'%', v_log;
end $v172$;
