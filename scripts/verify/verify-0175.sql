-- scripts/verify/verify-0175.sql
-- ตรวจ supabase/migrations/0175_job_plan_surplus.sql (M1 ส่วนแรก: จำนวนสั่ง/เผื่อ · แผนโลหะ · ของเหลือ · D2/D6) หลัง apply (หรือต่อท้ายไฟล์ 0175 ใน dry-run ก่อน apply)
-- self-rolling-back (3j-migration-traps ข้อ 11) · ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน · รอบแรก = ของจริง · รอบถัดไป = mutant · ปิดท้ายตรวจ state ไม่ขยับ
-- 🔴 ไม่ commit อะไร · ใบเสนอราคา = โคลนจากรายการจริง 1 รายการ (แถวใหม่ในทรานแซกชันที่ถอยกลับ) · ใบผลิต/ใบงานสร้างผ่าน RPC · JB-0018 อ่านอย่างเดียว
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0175.sql
-- dry-run ก่อน apply: cat supabase/migrations/0175_job_plan_surplus.sql scripts/verify/verify-0175.sql > <tmp>.sql แล้วรันไม่ใส่ --commit
--
-- ============ ตารางแมป "ข้อในบรีฟ -> เทสต์" ============  (เติมท้ายสุดของงาน)

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

-- ============================================================================
-- helper ของ verify-0175 (ต่อจากชุดแม่แบบ 0174): สร้างใบงานด้วย arg ใหม่ · ปิดงานพร้อมของเหลือ · โคลนแถว job สำหรับเคส INSERT ตรง
-- ============================================================================
-- สร้างใบงาน OEM ผ่าน RPC (named args) — p_target/p_ov เป็น text เพื่อส่ง 'NaN'/'Infinity' ได้
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

-- ============================================================================
-- กลุ่ม A — ใบเดิมต้องไม่พัง (backfill · JB-0018 · ยิง RPC ใหม่ใส่ข้อมูลเก่า/ใบรูปเดิมทุกโหมด) · โครงสร้างหลัง apply
-- ============================================================================
create function pg_temp.sa(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log   text := '';
  v_today date := analytics.job_today();
  v_n_job int; v_n_board int;
  j1 uuid; j2 uuid; j3 uuid; j4 uuid; jp uuid;
  d jsonb; r jsonb; r2 jsonb;
  v_w numeric; v_sprue numeric; v_exp numeric; v_b record; v_j record;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- A1 ใบที่มีอยู่ก่อนรัน (ใบจริง รวม JB-0018 ถ้ามี): qty_order = qty_planned ทุกใบ · บอร์ดคืนแถวครบ · คอลัมน์ใหม่เป็นค่าเริ่ม
  select count(*) into v_n_job from analytics.job;
  select count(*) into v_n_board from analytics.v_job_board;
  v_log := v_log || pg_temp.chk('A1a', 'ใบงานเดิมทุกใบ (' || v_n_job || ' ใบ) qty_order = qty_planned · ไม่มี surplus/แผนติดมา · v_job_board แถวครบเท่าจำนวนใบ',
    not exists (select 1 from analytics.job where qty_order <> qty_planned) and v_n_board = v_n_job
    and not exists (select 1 from analytics.job j where j.status <> 'done' and (j.surplus_disposition is not null or j.surplus_note is not null)));
  select * into v_b from analytics.v_job_board where job_no = 'JB-0018';
  v_log := v_log || case when v_b.id is null then '[SKIP] A1b  ไม่พบ JB-0018 บน DB นี้ (ไม่ใช่ความผิดพลาด)' || E'\n'
    else pg_temp.chk('A1b', 'JB-0018 (ใบจริงของเจ้าของ · อ่านอย่างเดียว ไม่แตะ): qty_order = qty_planned · under_planned=false · surplus_pending=false · quote_qty_mismatch ไม่เปลี่ยนความหมาย (เทียบ qty ใบเสนอราคา)',
      v_b.qty_order = v_b.qty_planned and v_b.under_planned = false and v_b.surplus_pending = false
      and v_b.quote_qty_mismatch is not distinct from (v_b.source_kind = 'oem' and v_b.status not in ('done', 'cancelled') and v_b.quote_item_qty is distinct from v_b.qty_planned)) end;

  -- A2 โครงสร้าง: trigger เปิด · คอลัมน์ NOT NULL · CHECK ครบ · helper/RPC ใหม่อยู่ · job_counter_bump ถูก drop
  v_log := v_log || pg_temp.chk('A2', 'โครงสร้างหลัง apply: trg_job_guard เปิด (O) · qty_order NOT NULL · CHECK job_surplus_ck/job_plan_ck/job_qty_order_ck มี · job_counter_bump หาย · ฟังก์ชันใหม่ครบ 7',
    (select t.tgenabled from pg_trigger t where t.tgrelid = 'analytics.job'::regclass and t.tgname = 'trg_job_guard') = 'O'
    and (select is_nullable from information_schema.columns where table_schema = 'analytics' and table_name = 'job' and column_name = 'qty_order') = 'NO'
    and (select count(*) from pg_constraint where conrelid = 'analytics.job'::regclass and conname in ('job_surplus_ck', 'job_plan_ck', 'job_qty_order_ck')) = 3
    and not exists (select 1 from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'job_counter_bump')
    and (select count(*) from pg_proc where pronamespace = 'analytics'::regnamespace
          and proname in ('job_deposit_blocked', 'job_worker_can_do', 'job_plan_compute', 'job_plan_suggest', 'job_qty_planned_set', 'job_plan_set', 'job_surplus_set')) = 7);

  -- A3 caller เดิม (ไม่ส่ง arg ใหม่) → qty_planned = qty_order · แผนมาจาก source · response/event มี qty_order
  d := pg_temp.clone_deal(p_tpl, 'silver', 10, null, 'won', null, false);
  r := pg_temp.q(format('select pg_temp.jcq(%L, %L, %L::text[], null, %L, null, null, %L)', p_shop, d ->> 'item_id', pg_temp.std(), 'verify: เริ่มก่อนมัดจำ', '00000000-0000-0000-0000-0000000000a1'::uuid));
  j1 := (r ->> 'job_id')::uuid;
  select * into v_j from analytics.job where id = j1;
  v_w := nullif((select i.input ->> 'weight_g' from analytics.oem_quote_item i where i.id = (d ->> 'item_id')::uuid), '')::numeric;
  v_sprue := analytics.oem_rate_value(p_shop, 'sprue_loss_pct', 'silver', v_today);
  v_exp := case when v_w > 0 and v_w <= 10000 and v_sprue is not null then round(10 * round(v_w, 3) * (1 + v_sprue / 100), 3) end;
  v_log := v_log || pg_temp.chk('A3', 'ไม่ส่ง arg ใหม่ (caller เดิม): qty_order = qty_planned = 10 · target = น้ำหนักในใบเสนอราคา · metal_plan_g = qty×น้ำหนัก×(1+ก้านต้น%) ที่คำนวณอิสระในเทสต์ (หรือ null + missing เมื่อไม่มี rate) · response มี qty_order/under_planned=false · event create มี qty_order',
    j1 is not null and v_j.qty_order = 10 and v_j.qty_planned = 10 and (r ->> 'qty_order')::int = 10 and (r ->> 'under_planned') = 'false'
    and v_j.target_piece_g is not distinct from case when v_w > 0 and v_w <= 10000 then round(v_w, 3) end
    and v_j.metal_plan_g is not distinct from v_exp
    and (v_j.metal_plan_basis is null) = (v_j.target_piece_g is null)
    and (v_exp is not null or v_j.target_piece_g is null or jsonb_array_length(v_j.metal_plan_basis -> 'missing') = 1)
    and exists (select 1 from analytics.job_event e where e.job_id = j1 and e.event_type = 'create' and (e.payload ->> 'qty_order') = '10'));

  -- A4 ใบรูปเดิม (qty_order = qty_planned) เดินครบวงจร: รับ/ส่งทุกขั้น + ปิดงานแบบเดิม (ไม่ส่ง surplus) ผ่าน · surplus เป็น null · บอร์ด qty_surplus = 0
  r := pg_temp.o_run(p_shop, j1, 1, 8, v_today);
  r2 := pg_temp.o_done(p_shop, j1, 10, 0);
  select * into v_j from analytics.job where id = j1;
  select * into v_b from analytics.v_job_board where id = j1;
  v_log := v_log || pg_temp.chk('A4', 'ใบรูปเดิมรับ/ส่ง 8 ขั้นได้ (job_core_receive ที่ใช้ helper ใหม่) + job_done แบบเดิมผ่าน · surplus_disposition null · status done · บอร์ด qty_surplus = 0 / surplus_pending=false',
    (r ->> 'ok') = 'true' and (r2 ->> 'ok') = 'true' and v_j.status = 'done' and v_j.surplus_disposition is null and v_j.surplus_note is null
    and v_b.qty_surplus = 0 and v_b.surplus_pending = false and (r2 ->> 'surplus')::int = 0);

  -- A5 เผื่อ (qty_planned > qty_order): สร้างได้ · ไม่ใช่ under_planned · ปิดงานดี 11 เสีย 1 → ของเหลือ 1 → OEM ค่าเริ่ม hold · บอร์ด surplus_pending
  d := pg_temp.mkj2(p_shop, p_tpl, 'silver', 10, 12);
  j2 := (d ->> 'job_id')::uuid;
  r := pg_temp.o_run(p_shop, j2, 1, 8, v_today);
  r2 := pg_temp.o_done(p_shop, j2, 11, 1);
  select * into v_j from analytics.job where id = j2;
  select * into v_b from analytics.v_job_board where id = j2;
  v_log := v_log || pg_temp.chk('A5', 'สั่ง 10 เริ่ม 12 (เผื่อ): สร้างได้ · under_planned=false · ปิดงานดี 11 เสีย 1 → ของเหลือ 1 ชิ้น OEM ไม่ส่งค่า = hold · บอร์ด qty_surplus=1 + surplus_pending=true + quote_qty_mismatch=false (เทียบ qty_order ไม่ใช่ qty_planned)',
    (d ->> 'under_planned') = 'false' and (d ->> 'qty_order') = '10' and (r ->> 'ok') = 'true' and (r2 ->> 'ok') = 'true'
    and v_j.qty_order = 10 and v_j.qty_planned = 12 and v_j.surplus_disposition = 'hold' and (r2 ->> 'surplus') = '1'
    and v_b.qty_surplus = 1 and v_b.surplus_pending = true and v_b.under_planned = false);

  -- A6 ผลิตไม่ครบ (qty_planned < qty_order): สร้างได้ (Q9 ไม่บล็อก) + under_planned=true บนบอร์ด · quote_qty_mismatch ยังเป็น false (เทียบ qty_order)
  d := pg_temp.mkj2(p_shop, p_tpl, 'silver', 10, 8);
  j3 := (d ->> 'job_id')::uuid;
  select * into v_b from analytics.v_job_board where id = j3;
  v_log := v_log || pg_temp.chk('A6', 'สั่ง 10 เริ่ม 8: สร้างได้ ไม่บล็อก · response/บอร์ด under_planned=true · quote_qty_mismatch=false (ตั้งใจต่างโดยจงใจ ไม่ใช่ใบเสนอราคาเปลี่ยน)',
    j3 is not null and (d ->> 'under_planned') = 'true' and v_b.under_planned = true and v_b.qty_order = 10 and v_b.qty_planned = 8 and v_b.quote_qty_mismatch = false);

  -- A7 ใบผลิตเข้าสต็อก: ทุกโหมด · สั่ง 10 เริ่ม 12 ปิดงานดี 11 → ของเหลือ stock เสมอ (ไม่ส่งค่า) · ไม่มี surplus เมื่อดี 10
  d := pg_temp.mkpj2(p_shop, 10, 12);
  jp := (d ->> 'job_id')::uuid;
  r := pg_temp.o_run(p_shop, jp, 1, 8, v_today);
  r2 := pg_temp.o_done(p_shop, jp, 11, 1);
  select * into v_j from analytics.job where id = jp;
  v_log := v_log || pg_temp.chk('A7', 'ใบงานผลิตเข้าสต็อก สั่ง 10 เริ่ม 12: ปิดงานดี 11 → surplus_disposition = stock อัตโนมัติ (ไม่ส่งค่า) · qty_order ตรงรายการใบผลิต',
    jp is not null and (r2 ->> 'ok') = 'true' and v_j.source_kind = 'production' and v_j.qty_order = 10 and v_j.surplus_disposition = 'stock' and (r2 ->> 'surplus_disposition') = 'stock');

  -- A8 rate ก้านต้นว่าง → สร้างได้ metal_plan_g = null (jsonb null ไม่ใช่ 0) + plan_missing · SKU/ใบเสนอราคาไม่มีน้ำหนัก → target null ทั้งแผน null
  begin
    delete from analytics.oem_cost_rate where shop_id = p_shop and rate_key = 'sprue_loss_pct';
    d := pg_temp.mkj2(p_shop, p_tpl, 'silver', 10, null, '4.000');
    select * into v_j from analytics.job where id = (d ->> 'job_id')::uuid;
    v_log := v_log || pg_temp.chk('A8', 'ไม่มี rate ก้านต้น + ส่งน้ำหนัก 4.000: สร้างได้ · metal_plan_g เป็น SQL null (ไม่ใช่ 0) · basis.missing = [sprue_loss_pct[silver]] · response plan_missing ตรงกัน',
      (d ->> 'job_id') is not null and v_j.metal_plan_g is null and v_j.target_piece_g = 4.000
      and v_j.metal_plan_basis -> 'missing' = '["sprue_loss_pct[silver]"]'::jsonb and jsonb_typeof(v_j.metal_plan_basis -> 'computed_g') = 'null'
      and d -> 'plan_missing' = '["sprue_loss_pct[silver]"]'::jsonb and (d ->> 'metal_plan_g') is null);
  exception when others then
    v_log := v_log || pg_temp.chk('A8', 'ไม่มี rate ก้านต้น: เทสต์ลบ rate ไม่ได้/พัง — ' || sqlerrm, false);
  end;
  return v_log;
end;
$s$;

-- ============================================================================
-- กลุ่ม B1 — ห้ามผ่าน: แก้ตรงที่ job_guard (qty_order · qty_planned · แผนโลหะ · done/cancelled · INSERT) — mutant UPDATE ทีละคอลัมน์ × ทุก status
-- ============================================================================
create function pg_temp.sb1(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log   text := '';
  v_today date := analytics.job_today();
  ja uuid; jb uuid; jd uuid; jc uuid; jn uuid;
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
  v_log := v_log || pg_temp.chk('B1', 'UPDATE qty_order ตรงๆ ตกที่ job_guard ทั้ง 4 status (open · in_progress · done · cancelled) — ตก ' || v_n || '/4', v_n = 4);

  -- B2 qty_planned: ก่อนมีขั้นถูกรับ (ล้างแผนพร้อมกันเพื่อไม่ให้ชน plan_drift) = ได้ · หลังขั้นแรกถูกรับ = ตก hint started · แก้ qty_planned เดี่ยวๆ โดยแผนยังอ้างค่าเก่า = plan_drift
  x := pg_temp.x(format('update analytics.job set qty_planned = qty_planned + 1 where id = %L', ja));
  v_log := v_log || pg_temp.chk('B2a', 'แก้ qty_planned ตรงๆ ขณะแผนโลหะยังอ้างจำนวนเก่า → ตก plan_drift (ต้องผ่าน job_qty_planned_set ที่คำนวณแผนใหม่ให้) · ' || pg_temp.xm(x),
    pg_temp.xs(x) = '22023' and pg_temp.xm(x) like '%plan_drift%');
  x := pg_temp.x(format('update analytics.job set qty_planned = 11, target_piece_g = null, metal_plan_g = null, metal_plan_basis = null where id = %L', ja));
  v_log := v_log || pg_temp.chk('B2b', 'ต้องไม่พัง: ก่อนขั้นแรกถูกรับ แก้ qty_planned + ล้างแผนใน UPDATE เดียวได้ · หลังขั้นแรกถูกรับ (in_progress) แก้ qty_planned ตก "แก้จำนวนเริ่มผลิตได้เฉพาะก่อนขั้นแรกถูกรับ"',
    x = 'OK' and (select qty_planned from analytics.job where id = ja) = 11
    and pg_temp.xs(pg_temp.x(format('update analytics.job set qty_planned = 12, target_piece_g = null, metal_plan_g = null, metal_plan_basis = null where id = %L', jb))) = '22023'
    and pg_temp.xm(pg_temp.x(format('update analytics.job set qty_planned = 12, target_piece_g = null, metal_plan_g = null, metal_plan_basis = null where id = %L', jb))) like '%ก่อนขั้นแรกถูกรับ%'
    and (select qty_planned from analytics.job where id = jb) = 10);

  -- B3 แผนโลหะ: metal_plan_g แก้ตรงๆ ให้ไม่ตรง basis = plan_drift · target แก้โดย basis ไม่ตาม = plan_drift · หลัง cast ถูกรับ แก้ target = ตก cast_started
  x := pg_temp.x(format('update analytics.job set metal_plan_g = coalesce(metal_plan_g, 0) + 1 where id = %L', jb));
  v_log := v_log || pg_temp.chk('B3a', 'UPDATE metal_plan_g ตรงๆ ให้ไม่ตรงกับ basis (หรือตั้งค่าทั้งที่ basis ไม่มีผลคำนวณ) → plan_drift · target แก้โดย basis ไม่ตาม → plan_drift',
    pg_temp.xs(x) = '22023' and pg_temp.xm(x) like '%plan_drift%'
    and pg_temp.xm(pg_temp.x(format('update analytics.job set target_piece_g = 5.000 where id = %L', jb))) like '%plan_drift%');
  perform pg_temp.o_run(p_shop, jb, 1, 3, v_today);
  perform pg_temp.o_recv(p_shop, jb, 4, v_today, 9.9, null, 'verify');
  x := pg_temp.x(format('update analytics.job set target_piece_g = null, metal_plan_g = null, metal_plan_basis = null where id = %L', jb));
  v_log := v_log || pg_temp.chk('B3b', 'หลังขั้นหล่อ (cast) ถูกรับ: ล้างแผน/แก้แผนตรงๆ ตก "แก้แผนโลหะได้เฉพาะก่อนขั้นหล่อถูกรับ" · แผนเดิมไม่ขยับ · ' || pg_temp.xm(x),
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
  v_log := v_log || pg_temp.chk('B4a', 'ใบ done: UPDATE ทีละคอลัมน์ 20 คอลัมน์ (ทุกคอลัมน์ข้อมูลใบงาน ยกเว้น surplus_*) ต้องตกที่ job_guard ทุกตัว — ตก ' || v_n || '/20 · หลุด: ' || coalesce(nullif(v_bad, ''), '(ไม่มี)'),
    v_n = 20);
  x := pg_temp.x(format('update analytics.job set surplus_disposition = ''spare'', surplus_note = ''verify'' where id = %L', jd));
  v_log := v_log || pg_temp.chk('B4b', 'ต้องไม่พัง: ใบ done แก้ surplus_disposition hold→spare + surplus_note ได้ (ช่องเดียวที่ guard ยอม) [' || x || ']',
    x = 'OK'
    and (select surplus_disposition = 'spare' and surplus_note = 'verify' from analytics.job where id = jd));

  -- B5 ใบ cancelled: ตั้ง surplus ไม่ได้ · แก้อะไรก็ไม่ได้
  v_log := v_log || pg_temp.chk('B5', 'ใบ cancelled: UPDATE surplus_disposition / surplus_note / design_label ตกที่ guard ทั้งหมด (cancelled แข็งกว่า done)',
    pg_temp.xs(pg_temp.x(format('update analytics.job set surplus_disposition = ''hold'' where id = %L', jc))) in ('22023', '23514')
    and pg_temp.xm(pg_temp.x(format('update analytics.job set surplus_disposition = ''hold'' where id = %L', jc))) like 'job:%'
    and pg_temp.xm(pg_temp.x(format('update analytics.job set surplus_note = ''x'' where id = %L', jc))) like 'job:%'
    and pg_temp.xm(pg_temp.x(format('update analytics.job set design_label = ''x'' where id = %L', jc))) like 'job:%');

  -- B6 INSERT ตรง: qty_order ไม่ตรงต้นทาง · surplus ตั้งตอนสร้าง · plan_g ไม่มี target (CHECK) · plan_g ไม่ตรง basis · (ต้องไม่พัง: ค่าถูกต้องผ่าน guard ไปชน unique index = guard ไม่เกินเหตุ)
  jn := jb;  -- ใช้ใบที่ยังมีแผน+basis เป็นแม่แบบโคลน (ชนิด OEM · มีรายการใบเสนอราคา)
  select i.qty into v_item_qty from analytics.job j join analytics.oem_quote_item i on i.id = j.oem_quote_item_id where j.id = jn;
  v_log := v_log || pg_temp.chk('B6a', 'INSERT job ตรง: qty_order ≠ จำนวนรายการใบเสนอราคา ตก guard · ตั้ง surplus_disposition ตอนสร้างตก guard · metal_plan_g ไม่มี target/basis ตก CHECK job_plan_ck (23514)',
    pg_temp.xs(pg_temp.clone_job(jn, jsonb_build_object('id', gen_random_uuid(), 'seq', 999001, 'qty_order', v_item_qty + 5))) = '22023'
    and pg_temp.xm(pg_temp.clone_job(jn, jsonb_build_object('id', gen_random_uuid(), 'seq', 999001, 'qty_order', v_item_qty + 5))) like '%จำนวนที่สั่ง%'
    and pg_temp.xm(pg_temp.clone_job(jn, jsonb_build_object('id', gen_random_uuid(), 'seq', 999002, 'surplus_disposition', 'hold'))) like '%ตั้งการจัดการของเหลือไม่ได้%'
    and pg_temp.xs(pg_temp.clone_job(jn, jsonb_build_object('id', gen_random_uuid(), 'seq', 999003, 'target_piece_g', null, 'metal_plan_basis', null, 'metal_plan_g', 5))) = '23514');
  x := pg_temp.clone_job(jn, jsonb_build_object('id', gen_random_uuid(), 'seq', 999005));
  r := to_jsonb(pg_temp.clone_job(jn, jsonb_build_object('id', gen_random_uuid(), 'seq', 999004, 'metal_plan_g', 98765.432, 'metal_plan_basis', (select jsonb_set(metal_plan_basis, '{override_g}', 'null'::jsonb) from analytics.job where id = jn))));
  v_log := v_log || pg_temp.chk('B6b', 'INSERT job ตรง: metal_plan_g ไม่ตรง basis ตก plan_drift · ต้องไม่พัง: ค่าครบถูกต้องผ่าน guard+CHECK แล้วไปชน unique index ของรายการเดิม (23505) — guard ไม่ปฏิเสธเกินเหตุ [' || left(x, 200) || '] [' || left(r #>> '{}', 200) || ']',
    pg_temp.xm(pg_temp.clone_job(jn, jsonb_build_object('id', gen_random_uuid(), 'seq', 999004, 'metal_plan_g', 98765.432, 'metal_plan_basis', (select jsonb_set(metal_plan_basis, '{override_g}', 'null'::jsonb) from analytics.job where id = jn)))) like '%plan_drift%'
    and pg_temp.xs(pg_temp.clone_job(jn, jsonb_build_object('id', gen_random_uuid(), 'seq', 999005))) = '23505');
  return v_log;
end;
$s$;

create function pg_temp.run_all(p_shop uuid, p_tpl uuid) returns text
 language sql as $c$
  select pg_temp.run_sec('sa', p_shop, p_tpl)
      || pg_temp.run_sec('sb1', p_shop, p_tpl)
$c$;

do $v175$
declare
  v_shop uuid; v_tpl uuid;
  v_log text := ''; v_s text; v_fail int; v_snap0 text;
  v_m record; v_killed int := 0; v_total int; v_survived text := ''; v_cnt int; v_id text; v_hit int; v_skip int; v_ok_cnt int;
  v_mutants jsonb := jsonb_build_array(

  );
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select id into v_shop from public.shop order by created_at limit 1;
  -- แม่แบบ: อ่านรายการใบเสนอราคาจริง 1 รายการเพื่อ "โคลน" เป็นใบทดสอบ (แถวใหม่ในทรานแซกชันที่ถอยกลับ ไม่แตะของจริง)
  select i.id into v_tpl from analytics.oem_quote_item i join analytics.oem_quote q on q.id = i.quote_id
   where i.shop_id = v_shop and i.input ->> 'metal' = 'silver' and q.quote_no not like 'V17%' order by q.created_at, i.seq limit 1;
  if v_tpl is null then
    v_log := v_log || '[FAIL] S0  ไม่มี oem_quote_item เงินจริงให้ใช้เป็นแม่แบบโคลน — ชุดทดสอบรันต่อไม่ได้' || E'\n';
    raise exception E'%', v_log;
  end if;

  create temp table _v175_orig on commit drop as
    select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h
      from pg_proc p where p.pronamespace = 'analytics'::regnamespace and (p.proname like 'job\_%' or p.proname like 'worker\_%');

  v_snap0 := pg_temp.snap();
  v_s := pg_temp.run_all(v_shop, v_tpl);
  v_log := v_log || v_s;
  v_log := v_log || pg_temp.chk('K0', 'หลังรัน: แถวตารางใบงาน/ช่าง/ตัวนับ + ตาราง OEM/ผลิต/สต็อก (นับ + md5) เท่าก่อนรันเป๊ะ — ไม่ทิ้งข้อมูล', pg_temp.snap() = v_snap0);
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

  select count(*) into v_cnt from _v175_orig o where md5(pg_get_functiondef(to_regprocedure(o.sig))) = o.h;
  v_log := v_log || pg_temp.chk('MY', format('หลังรัน mutant: md5 definition ของฟังก์ชัน job_*/worker_* ทั้ง %s ตัวเท่าเดิม · trigger ใบงานเปิดครบ', (select count(*) from _v175_orig)),
    v_cnt = (select count(*) from _v175_orig)
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
end $v175$;
