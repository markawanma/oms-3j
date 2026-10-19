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
CREATE OR REPLACE FUNCTION pg_temp.core_send_legacy(p_job_id uuid, p_expected_seq integer, p_occurred_on date, p_weight_out numeric, p_qty_scrap integer, p_scrap_reason text, p_metal_added numeric, p_weight_note text, p_scrap_weight numeric, p_worker_id uuid, p_channel text, p_actor uuid, p_device_hint text, p_enforce_holder boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $leg1$
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
  v_room   numeric;
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

  -- 0178 M1: ช่างส่งน้ำหนักเศษได้เฉพาะขั้นที่แบบการบันทึกถามเศษ (scrap_weight_ask) · ใบเดิมทุกขั้น ask=false = ส่งเศษไม่ได้ · ออฟฟิศไม่ถูกจำกัด · ข้อความไม่มีตัวเลขน้ำหนัก (N1)
  if p_channel = 'worker_qr' and p_scrap_weight is not null and not v_s.scrap_weight_ask then
    return analytics.job_fail('scrap_weight_not_asked', 'ขั้นนี้ไม่ได้บันทึกเศษโลหะ — โหลดหน้าใหม่');
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
  -- 0178 M1: เศษต้องไม่เกินส่วนที่หายไป (loss = in + added - out - scrap ต้อง >= 0) · คำนวณเฉพาะเมื่อมีทั้งน้ำหนักเข้า/ออก (ตรงกับ v_job_stage_loss) · ค่าใดเป็น null = ข้าม (ไม่ใช่ผ่านหรือตก — ไม่มี loss ให้บิดเบือน)
  v_room := case when p_weight_out is not null and v_s.weight_in_g is not null then v_s.weight_in_g + v_added - p_weight_out end;
  if p_scrap_weight is not null and v_room is not null and p_scrap_weight > v_room then
    return analytics.job_fail('scrap_over', 'น้ำหนักเศษมากกว่าส่วนที่หายไป — ชั่งใหม่');
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
$leg1$
;
CREATE OR REPLACE FUNCTION pg_temp.core_recv_legacy(p_job_id uuid, p_expected_seq integer, p_occurred_on date, p_weight_in numeric, p_worker_id uuid, p_assignee text, p_channel text, p_actor uuid, p_device_hint text, p_enforce_scope boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $leg2$
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
      -- 0176: ใบทองเดิม (ก่อน profile) คงกติกา J1 · ใบที่มีแบบตัดสินจาก weigh_required ของขั้นก่อน (บล็อกถัดไป)
      if v_job.metal = 'gold' and v_job.profile_id is null then
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
$leg2$
;
CREATE OR REPLACE FUNCTION pg_temp.resolve_legacy(p_token_hash text, p_session_hash text DEFAULT NULL::text, p_ip_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $leg3$
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
begin
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

  if v_hold.id is null and v_pend.id is null then
    -- QA 5: ทุกขั้นส่งต่อ/ข้ามครบแล้วแต่ออฟฟิศยังไม่ปิดงาน — ไม่ใช่ "ให้ระบุตัว"
    v_action := 'all_done';
  elsif v_worker is null then
    v_action := 'identify';
    -- รายชื่อช่างที่ทำขั้นถัดไปของงานนี้ได้ (ขั้นที่ถือค้างหรือขั้นที่รอรับ) — เฉพาะ id + ชื่อ
    select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'display_name', w.display_name) order by w.display_name), '[]'::jsonb)
      into v_workers
      from analytics.worker w
     where w.shop_id = v_job.shop_id and w.is_active
       and (cardinality(w.stage_codes) = 0
            or (v_hold.id is not null and v_hold.stage_code = any (w.stage_codes))
            or (v_pend.id is not null and v_pend.stage_code = any (w.stage_codes)));
  else
    select w.stage_codes into v_wcodes from analytics.worker w where w.id = v_worker;
    if v_hold.id is not null and v_hold.worker_id = v_worker then
      v_action := 'send'; v_seq := v_hold.seq; v_code := v_hold.stage_code; v_need_w := v_hold.weigh_required;
    elsif v_pend.id is not null then
      v_seq := v_pend.seq; v_code := v_pend.stage_code; v_need_w := v_pend.weigh_required;
      if v_job.status = 'on_hold' then
        v_action := 'on_hold';
      elsif not analytics.job_worker_can_do(v_wcodes, v_pend.stage_code) then
        v_action := 'not_your_stage';
      elsif v_hold.id is not null and ((v_job.metal = 'gold' and v_job.profile_id is null) or v_hold.weigh_required) then
        -- QA N1: ขั้นก่อนบังคับชั่ง (หรือใบทองเดิม) ยังไม่ส่งต่อ -> บอกตั้งแต่ resolve ไม่ใช่ให้กดแล้วไป fail
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
    'next_action', v_action,
    'action_stage', case when v_seq is null then null
                      else jsonb_build_object('seq', v_seq, 'code', v_code, 'name', v_name, 'weight_required', v_need_w,
                                           'scrap_qty_ask', coalesce(v_sq, true), 'scrap_weight_ask', coalesce(v_sw, false)) end,
    'prev_weight_out_g', v_prev_w,
    -- L1: ชื่อผู้ถือเห็นได้เฉพาะช่างที่ระบุตัวแล้ว
    'held_by', case when v_worker is null then null else v_holder end,
    'workers', v_workers,
    'scrap_reasons', case when v_action = 'send' then to_jsonb(array['porosity', 'broken', 'wrong_design', 'missing', 'other']) else '[]'::jsonb end
  );
end;
$leg3$
;

-- ============================================================================
-- helper เฉพาะ 0181 (ผู้เรียก RPC ใหม่ · ตัวอ่านสถานะต้นไม้) — ทุกตัวคืน jsonb {ok:true,...} หรือ {_err,_state,_hint} เหมือน helper เดิม
-- ============================================================================
create function pg_temp.act() returns uuid language sql as $c$ select '00000000-0000-0000-0000-0000000000a1'::uuid $c$;

-- ออฟฟิศแยกส่วน
create function pg_temp.o_split(p_shop uuid, p_job uuid, p_seq int, p_qty int, p_scrap int default 0, p_reason text default null, p_hold int default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_lot_split(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_qty=>%L, p_qty_scrap=>%L, p_scrap_reason=>%L, p_qty_hold=>%L, p_actor=>%L)',
    p_shop, p_job, p_seq, p_qty, p_scrap, p_reason, p_hold, pg_temp.act())) $c$;
-- ออฟฟิศรับ (กรอกแทน) พร้อมจำนวนที่ได้จริง
create function pg_temp.o_recv2(p_shop uuid, p_job uuid, p_seq int, p_qty int default null, p_worker uuid default null, p_name text default 'verify') returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_office_receive(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>%L, p_occurred_on=>%L, p_worker_id=>%L, p_assignee_name=>%L, p_qty_received=>%L, p_actor=>%L)',
    p_shop, p_job, p_seq, analytics.job_today(), p_worker, p_name, p_qty, pg_temp.act())) $c$;
create function pg_temp.o_lcancel(p_shop uuid, p_lot uuid, p_reason text, p_disp text, p_sreason text default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_lot_cancel(p_shop_id=>%L, p_lot_job_id=>%L, p_reason=>%L, p_disposition=>%L, p_scrap_reason=>%L, p_actor=>%L)',
    p_shop, p_lot, p_reason, p_disp, p_sreason, pg_temp.act())) $c$;
create function pg_temp.o_dres(p_shop uuid, p_disc uuid, p_kind text, p_reason text) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_discrepancy_resolve(p_shop_id=>%L, p_discrepancy_id=>%L, p_kind=>%L, p_reason=>%L, p_actor=>%L)', p_shop, p_disc, p_kind, p_reason, pg_temp.act())) $c$;
create function pg_temp.o_dvoid(p_shop uuid, p_disc uuid, p_reason text) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_discrepancy_void(p_shop_id=>%L, p_discrepancy_id=>%L, p_reason=>%L, p_actor=>%L)', p_shop, p_disc, p_reason, pg_temp.act())) $c$;
create function pg_temp.o_done(p_shop uuid, p_job uuid, p_good int, p_scrap int, p_w numeric default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_done(p_shop_id=>%L, p_job_id=>%L, p_qty_good=>%L, p_qty_scrap=>%L, p_weight_final_g=>%L, p_actor=>%L)', p_shop, p_job, p_good, p_scrap, p_w, pg_temp.act())) $c$;
create function pg_temp.o_cancel(p_shop uuid, p_job uuid, p_reason text default 'verify') returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_cancel(p_shop_id=>%L, p_job_id=>%L, p_reason=>%L, p_actor=>%L)', p_shop, p_job, p_reason, pg_temp.act())) $c$;
create function pg_temp.o_reopen(p_shop uuid, p_job uuid, p_reason text default 'verify') returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_stage_reopen(p_shop_id=>%L, p_job_id=>%L, p_reason=>%L, p_actor=>%L)', p_shop, p_job, p_reason, pg_temp.act())) $c$;
create function pg_temp.o_tissue(p_shop uuid, p_job uuid, p_revoke boolean default null, p_purpose text default 'traveler', p_lot uuid default null) returns jsonb
 language plpgsql as $c$
declare r jsonb;
begin
  r := pg_temp.q(format('select analytics.job_token_issue(p_shop_id=>%L, p_job_id=>%L, p_revoke_previous=>%L, p_actor=>%L, p_purpose=>%L, p_lot_job_id=>%L)',
    p_shop, p_job, p_revoke, pg_temp.act(), p_purpose, p_lot));
  if r ? 'token' then r := r || jsonb_build_object('hash', analytics.job_sha256_hex(r ->> 'token')); end if;
  return r;
end $c$;
create function pg_temp.o_trevoke(p_shop uuid, p_job uuid, p_no int default null, p_reason text default 'verify') returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_token_revoke(p_shop_id=>%L, p_job_id=>%L, p_reason=>%L, p_actor=>%L, p_print_no=>%L)', p_shop, p_job, p_reason, pg_temp.act(), p_no)) $c$;
create function pg_temp.o_tlist(p_shop uuid, p_job uuid) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_token_list(p_shop_id=>%L, p_job_id=>%L, p_actor=>%L)', p_shop, p_job, pg_temp.act())) $c$;

-- ช่างส่ง/แยกส่วน (p_qty_send null = ส่งทั้งหมด) · รับ (p_qty null = ตามที่ส่ง) · ชี้แจงส่วนต่าง · ยกเลิกส่วน
create function pg_temp.ws(p_tokh text, p_sesh text, p_seq int, p_lot uuid default null, p_qty_send int default null, p_hold int default null,
                           p_scrap int default 0, p_reason text default null, p_wout numeric default null, p_added numeric default null,
                           p_scrap_w numeric default null, p_note text default null) returns jsonb
 language sql as $c$
  select pg_temp.q(format('select analytics.job_worker_send(p_token_hash=>%L, p_session_hash=>%L, p_expected_seq=>%L, p_lot_job_id=>%L, p_qty_send=>%L, p_qty_hold=>%L,
      p_qty_scrap=>%L, p_scrap_reason=>%L, p_weight_out_g=>%L, p_metal_added_g=>%L, p_scrap_weight_g=>%L, p_weight_note=>%L, p_user_agent=>%L)',
    p_tokh, p_sesh, p_seq, p_lot, p_qty_send, p_hold, p_scrap, p_reason, p_wout, p_added, p_scrap_w, p_note, 'verify-ua/1.0')) $c$;
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

-- ตัวอ่านสถานะ
create function pg_temp.jv(p_job uuid, p_col text) returns text language plpgsql as $c$
declare v text;
begin
  execute format('select %I::text from analytics.job where id = %L', p_col, p_job) into v;
  return v;
end $c$;
create function pg_temp.lot(r jsonb) returns uuid language sql as $c$ select (r ->> 'lot_job_id')::uuid $c$;
create function pg_temp.dcount(p_root uuid) returns int language sql as $c$ select count(*)::int from analytics.v_job_tree_drift where root_job_id = p_root $c$;
create function pg_temp.sumok(p_root uuid) returns boolean language sql as $c$ select coalesce((select sum_check from analytics.v_job_tree_summary where root_job_id = p_root), false) $c$;
create function pg_temp.sid(p_job uuid, p_seq int) returns uuid language sql as $c$ select id from analytics.job_stage where job_id = p_job and seq = p_seq $c$;
create function pg_temp.disc_of(p_job uuid) returns uuid language sql as $c$
  select id from analytics.job_discrepancy where job_id = p_job and status = 'open' order by created_at limit 1 $c$;
-- นับ drift ของ v_job_stage_from_events (ทุกขั้นของต้นไม้)
create function pg_temp.sdrift(p_root uuid) returns int language sql as $c$
  select count(*)::int from analytics.v_job_stage_from_events e join analytics.job j on j.id = e.job_id
   where (j.id = p_root or j.parent_job_id = p_root) and e.drift $c$;
-- key ทุกตัวใน jsonb (ลึกทุกชั้น) — ตรวจว่าไม่มี key ต้องห้ามหลุดไปหน้าช่าง
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
-- ผู้ถืออยู่ขั้นไหน (stage_code ของขั้น received ของใบ)
create function pg_temp.held_code(p_job uuid) returns text language sql as $c$ select stage_code from analytics.job_stage where job_id = p_job and status = 'received' limit 1 $c$;
create function pg_temp.nlots(p_root uuid) returns int language sql as $c$ select count(*)::int from analytics.job where parent_job_id = p_root $c$;
create function pg_temp.d_status(p_disc uuid) returns text language sql as $c$ select status from analytics.job_discrepancy where id = p_disc $c$;

-- ใบ OEM เงิน + แบบ + ขั้นมาตรฐาน 8 ขั้น เดินให้ถึงก่อนขั้น p_to+1 ด้วยมือออฟฟิศ (ทุกขั้นนับ weight p_w) → {job_id, tokh}
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

-- ============================================================================
-- Section A — แยกส่วน (ส่งต่อ n จาก N) เส้นทางปกติ: ส่วนใหม่ · ซ้อน · แม่ส่งส่วนที่เหลือ · ทั้งต้นไม้ปิด (design §10.2) + ใบเดิม profile null + แยกที่ขั้น QC/pack + ผลิต (production)
-- ============================================================================
create function pg_temp.sa(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  pn uuid; wA uuid; wB uuid;
  d jsonb; j uuid; th text; sa text; sb text;
  r jsonb; r2 jsonb; r3 jsonb;
  l1 uuid; l2 uuid; ms uuid;
  v_no text; v_today date := analytics.job_today();
  v_keys boolean;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pn := pg_temp.pid(p_shop, 'none');
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829');
  wB := pg_temp.wid(p_shop, 'vfy-ช่าง B', '7351');

  d := pg_temp.fx(p_shop, p_tpl, pn, 100, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh';
  sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351');
  select job_no into v_no from analytics.job where id = j;
  r := pg_temp.wr(th, sa, 4);
  v_log := v_log || pg_temp.chk('A0', 'fixture: ช่าง A รับขั้น cast (seq 4) ถือ 100 ชิ้น · ใบเงิน 100 ชิ้น แบบ "ไม่ชั่ง" · ไม่มีส่วน', (r ->> 'ok') = 'true' and pg_temp.sv(j, 4, 'qty_in') = '100'
    and pg_temp.nlots(j) = 0 and pg_temp.jv(j, 'qty_split_out') = '0');
  ms := pg_temp.sid(j, 4);

  -- แยก 40 จาก 100 (ส่งต่อ 40 จาก 100)
  r := pg_temp.ws(th, sa, 4, null, 40, 100);
  l1 := pg_temp.lot(r);
  v_log := v_log || pg_temp.chk('A1', 'ช่างแยก 40 จาก 100 → ok · action split · lot_seq 1 · qty 40 · parent_remaining 60 · label = "<job_no> · ส่วนที่ 1" · ขั้นถัดไปของส่วน = cut_sprue',
    (r ->> 'ok') = 'true' and r ->> 'action' = 'split' and (r ->> 'lot_seq') = '1' and (r ->> 'qty') = '40' and (r ->> 'parent_remaining') = '60'
    and r ->> 'label' = v_no || ' · ส่วนที่ 1' and r #>> '{next_stage,code}' = 'cut_sprue');
  v_log := v_log || pg_temp.chk('A2', 'ส่วนใหม่: parent = ใบแม่ · lot_seq 1 · qty_planned = qty_order = 40 · สถานะ in_progress · profile/source/โลหะ/สินค้า ตรงแม่ · ไม่มีแผนโลหะ/ของเหลือ · ไม่มี token',
    (select l.parent_job_id = j and l.lot_seq = 1 and l.qty_planned = 40 and l.qty_order = 40 and l.status = 'in_progress'
            and l.profile_id is not distinct from m.profile_id and l.profile_name is not distinct from m.profile_name and l.metal = m.metal
            and l.oem_quote_item_id is not distinct from m.oem_quote_item_id and l.root_quote_id is not distinct from m.root_quote_id
            and l.target_piece_g is null and l.metal_plan_g is null and l.surplus_disposition is null and l.start_gate_note is null
            and l.design_label = m.design_label and l.due_date is not distinct from m.due_date
       from analytics.job l, analytics.job m where l.id = l1 and m.id = j)
    and not exists (select 1 from analytics.job_token where job_id = l1));
  v_log := v_log || pg_temp.chk('A3', 'ขั้นของส่วน: seq 1-3 skipped (split_inherit) · seq 4 sent qty_in = qty_out = 40 ไม่ชั่ง split_from = ขั้นแม่ · seq 5-8 pending · ผู้ส่ง = ผู้ถือเดิม (ช่าง A)',
    (select string_agg(seq || ':' || status, ',' order by seq) from analytics.job_stage where job_id = l1) = '1:skipped,2:skipped,3:skipped,4:sent,5:pending,6:pending,7:pending,8:pending'
    and (select count(*) from analytics.job_stage where job_id = l1 and status = 'skipped' and skip_reason = 'split_inherit') = 3
    and pg_temp.sv(l1, 4, 'qty_in') = '40' and pg_temp.sv(l1, 4, 'qty_out') = '40' and pg_temp.sv(l1, 4, 'weigh_required') = 'false'
    and pg_temp.sv(l1, 4, 'weight_in_g') is null and pg_temp.sv(l1, 4, 'worker_id') = wA::text and pg_temp.sv(l1, 4, 'split_from_stage_id') = ms::text);
  v_log := v_log || pg_temp.chk('A4', 'ขั้นแม่: ยัง received · qty_split_out 40 · ของเสีย 0 · job.qty_split_out = 40 (trigger sync) · current_stage_code ของแม่ = cast',
    pg_temp.sv(j, 4, 'status') = 'received' and pg_temp.sv(j, 4, 'qty_split_out') = '40' and pg_temp.sv(j, 4, 'qty_scrap') = '0'
    and pg_temp.jv(j, 'qty_split_out') = '40' and pg_temp.jv(j, 'current_stage_code') = 'cast');
  v_log := v_log || pg_temp.chk('A5', 'วันที่ขั้นแยกของส่วน: received_on = วันที่ผู้แยกรับขั้นนี้ · sent_on = วันนี้เวลาไทย (job_today) · ขั้นที่ข้ามไม่มีวัน',
    pg_temp.sv(l1, 4, 'received_on') = pg_temp.sv(j, 4, 'received_on') and pg_temp.sv(l1, 4, 'sent_on') = v_today::text and pg_temp.sv(l1, 1, 'received_on') is null);
  v_log := v_log || pg_temp.chk('A6', 'event: แม่มี split (worker_id = ช่าง A · ช่อง worker_qr · payload ชี้ส่วน) · ส่วนมี create + stage_skip×3 + stage_receive + stage_send · v_job_stage_from_events ไม่ drift ทั้งต้นไม้',
    (select count(*) from analytics.job_event where job_id = j and event_type = 'split' and worker_id = wA and channel = 'worker_qr' and payload ->> 'lot_job_id' = l1::text) = 1
    and (select count(*) from analytics.job_event where job_id = l1 and event_type = 'create') = 1
    and (select count(*) from analytics.job_event where job_id = l1 and event_type = 'stage_skip') = 3
    and (select count(*) from analytics.job_event where job_id = l1 and event_type in ('stage_receive', 'stage_send')) = 2
    and pg_temp.sdrift(j) = 0);
  v_log := v_log || pg_temp.chk('A7', 'ต้นไม้ถูกต้อง: v_job_tree_drift ว่าง · sum_check จริง · parts_count 2 · lots_open 1 · live รวม 100 · ส่วนใหม่ live 40 แม่ live 60',
    pg_temp.dcount(j) = 0 and pg_temp.sumok(j)
    and (select parts_count = 2 and lots_open = 1 and qty_live_total = 100 and qty_pending_explanation = 0 from analytics.v_job_tree_summary where root_job_id = j)
    and analytics.job_live_qty(l1) = 40 and analytics.job_live_qty(j) = 60);
  r := pg_temp.w_res(th, sa);
  r2 := pg_temp.w_res(th, sb);
  v_log := v_log || pg_temp.chk('A8', 'resolve หลายส่วน: ช่าง A = multi · my_actions มี send ของแม่ qty_hold 60 · parts 2 ส่วน · ช่าง B = multi · มี receive ของส่วนที่ขั้น 5 (expected 40) และ "ไม่มี" receive ของแม่ (ผู้ถือยังค้างส่วนที่เหลือ)',
    r ->> 'next_action' = 'multi' and jsonb_array_length(r -> 'parts') = 2
    and exists (select 1 from jsonb_array_elements(r -> 'my_actions') a where a ->> 'action' = 'send' and (a ->> 'lot_job_id')::uuid = j and (a ->> 'qty_hold') = '60' and (a ->> 'stage_seq') = '4')
    and r2 ->> 'next_action' = 'multi'
    and exists (select 1 from jsonb_array_elements(r2 -> 'my_actions') a where a ->> 'action' = 'receive' and (a ->> 'lot_job_id')::uuid = l1 and (a ->> 'qty_expected') = '40' and (a ->> 'stage_seq') = '5')
    and not exists (select 1 from jsonb_array_elements(r2 -> 'my_actions') a where a ->> 'action' = 'receive' and (a ->> 'lot_job_id')::uuid = j)
    and (r -> 'action_stage') = 'null'::jsonb and (r ->> 'prev_weight_out_g') is null);

  -- ช่าง B รับส่วนที่ขั้น 5 แล้วแยกซ้อน 15 จาก 40 (ส่วนของส่วน — ชี้ใบแม่เดิม)
  r := pg_temp.wr(th, sb, 5, l1);
  v_log := v_log || pg_temp.chk('A9a', 'ช่าง B รับส่วนที่ 1 ขั้น cut_sprue ได้ (qty_in 40)', (r ->> 'ok') = 'true' and pg_temp.sv(l1, 5, 'qty_in') = '40' and pg_temp.sv(l1, 5, 'worker_id') = wB::text);
  r := pg_temp.ws(th, sb, 5, l1, 15, 40);
  l2 := pg_temp.lot(r);
  v_log := v_log || pg_temp.chk('A9', 'แยกซ้อน: ส่วนใหม่ชี้ "ใบแม่เดิม" (ไม่ใช่ส่วนที่แยกมา) lot_seq 2 · ส่วนที่ 1 ขั้น 5 split_out 15 · ส่วนใหม่ข้าม 1-4 · ขั้น 5 sent 15 · ต้นไม้ไม่ drift',
    (r ->> 'ok') = 'true' and (r ->> 'lot_seq') = '2' and (select parent_job_id = j and lot_seq = 2 and qty_planned = 15 from analytics.job where id = l2)
    and pg_temp.sv(l1, 5, 'qty_split_out') = '15' and pg_temp.jv(l1, 'qty_split_out') = '15'
    and (select string_agg(seq || ':' || status, ',' order by seq) from analytics.job_stage where job_id = l2) = '1:skipped,2:skipped,3:skipped,4:skipped,5:sent,6:pending,7:pending,8:pending'
    and pg_temp.dcount(j) = 0 and pg_temp.sumok(j) and pg_temp.sdrift(j) = 0
    and (select count(*) from analytics.job where parent_job_id = j) = 2);

  -- แม่ส่งส่วนที่เหลือ: ส่งทั้งหมดที่ถือ = 100 − 40 = 60 (qty_out = เข้า − เสีย − แยกออก)
  r := pg_temp.ws(th, sa, 4, null, null, 60);
  v_log := v_log || pg_temp.chk('A10', 'แม่ส่งส่วนที่เหลือ (p_qty_send ว่าง · p_qty_hold 60) → ok · qty_out 60 · qty_scrap 0 · qty_split_out 40 คงเดิม · ขั้นถัดไป = cut_sprue (pending) · ไม่ drift',
    (r ->> 'ok') = 'true' and (r ->> 'qty_out') = '60' and (r ->> 'qty_split_out') = '40' and pg_temp.sv(j, 4, 'status') = 'sent' and pg_temp.sv(j, 4, 'qty_out') = '60'
    and pg_temp.sv(j, 4, 'qty_split_out') = '40' and pg_temp.dcount(j) = 0 and pg_temp.sdrift(j) = 0);
  -- ทั้ง 3 ส่วนเดินไปถึงขั้นสุดท้าย (ออฟฟิศกรอกแทน) แล้วปิด: ส่วนแล้วแม่
  r := pg_temp.rw(p_shop, j, null, 8);
  r2 := pg_temp.rw(p_shop, l1, null, 8);
  r3 := pg_temp.rw(p_shop, l2, null, 8);
  v_log := v_log || pg_temp.chk('A11a', 'เดินครบ 8 ขั้นทั้ง 3 ส่วน: แม่ส่งสุดท้าย 60 · ส่วนที่ 1 ส่งสุดท้าย 25 (40 − 15) · ส่วนที่ 2 ส่งสุดท้าย 15 · ต้นไม้ไม่ drift',
    not (r ? '_err') and not (r2 ? '_err') and not (r3 ? '_err')
    and pg_temp.sv(j, 8, 'qty_out') = '60' and pg_temp.sv(l1, 8, 'qty_out') = '25' and pg_temp.sv(l2, 8, 'qty_out') = '15' and pg_temp.dcount(j) = 0);
  r := pg_temp.o_done(p_shop, j, 60, 0);
  v_log := v_log || pg_temp.chk('A11b', 'ปิดแม่ก่อนส่วน (ส่วนยังเปิด) = ปฏิเสธ parts_open · ข้อความขึ้นต้น "ปิดงานไม่ได้ — ยังมีส่วนย่อย" · แม่ยังไม่ done', pg_temp.rej(r, 'parts_open') and (r ->> '_err') like 'ปิดงานไม่ได้ — ยังมีส่วนย่อย%' and pg_temp.jv(j, 'status') <> 'done');
  r := pg_temp.o_done(p_shop, l2, 15, 0);
  r2 := pg_temp.o_done(p_shop, l1, 25, 0);
  r3 := pg_temp.o_done(p_shop, j, 60, 0);
  v_log := v_log || pg_temp.chk('A11c', 'ปิดส่วนที่ 2 (ดี 15) · ส่วนที่ 1 (ดี 25 + แยกออก 15 = 40) · แม่ (ดี 60 + แยกออก 40 = 100) → ok ทั้งหมด · ผลรวมดี 100 · ต้นไม้ไม่ drift · sum_check จริง · token แม่ถูกเพิกถอนหมด',
    (r ->> 'ok') = 'true' and (r2 ->> 'ok') = 'true' and (r3 ->> 'ok') = 'true' and pg_temp.jv(j, 'status') = 'done'
    and (select qty_done_good = 100 and qty_pending_explanation = 0 from analytics.v_job_tree_summary where root_job_id = j)
    and pg_temp.dcount(j) = 0 and pg_temp.sumok(j) and not exists (select 1 from analytics.job_token where job_id = j and revoked_at is null));
  r := pg_temp.o_done(p_shop, j, 61, 0);
  v_log := v_log || pg_temp.chk('A11d', 'ใบแม่ done แล้วปิดซ้ำ = ปฏิเสธ job_closed', pg_temp.rej(r, 'job_closed'));

  -- ใบ response ของช่างต้องไม่มี key เงิน/ลูกค้า/token (ข้อ 14)
  d := pg_temp.fx(p_shop, p_tpl, pn, 20, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  r := pg_temp.wr(th, sa, 4);
  r2 := pg_temp.ws(th, sa, 4, null, 5, 20);
  r3 := pg_temp.w_res(th, sa);
  v_keys := pg_temp.clean_keys(r) and pg_temp.clean_keys(r2) and pg_temp.clean_keys(r3) and pg_temp.clean_keys(pg_temp.w_res(th, null));
  v_log := v_log || pg_temp.chk('A12', 'response ช่าง (resolve หลายส่วน/ก่อน PIN · receive · send แยกส่วน) ไม่มี key cost/price/thb/customer/quote_no/token/hash · resolve ก่อน PIN ไม่มี parts/my_actions',
    v_keys and (pg_temp.w_res(th, null) -> 'parts') = 'null'::jsonb and (pg_temp.w_res(th, null) -> 'my_actions') = 'null'::jsonb);
  return v_log;
end;
$s$;

-- ============================================================================
-- Section A2 — เส้นทางเฉพาะ: แยกที่ขั้น QC / pack (ข้าม QC รับช่วง) · ใบเดิม profile null · ใบชั่ง (loss ไม่เทียบ) · ใบผลิต (production) · แยกจากส่วน
-- ============================================================================
create function pg_temp.sa2(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  pn uuid; pw uuid; wA uuid; wB uuid;
  d jsonb; j uuid; th text; sa text; sb text;
  r jsonb; r2 jsonb;
  l1 uuid;
  v_poi uuid; v_existing text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pn := pg_temp.pid(p_shop, 'none');
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829');
  wB := pg_temp.wid(p_shop, 'vfy-ช่าง B', '7351');

  -- แยกที่ขั้น QC (seq 7): ส่วนข้าม 1-6 · QC ส่งโดยผู้แยก · pack pending
  d := pg_temp.fx(p_shop, p_tpl, pn, 30, 6);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  r := pg_temp.wr(th, sa, 7);
  r2 := pg_temp.ws(th, sa, 7, null, 10, 30);
  l1 := pg_temp.lot(r2);
  v_log := v_log || pg_temp.chk('A2a', 'แยกที่ขั้น QC (seq 7): ok · ส่วนข้าม 1-6 (split_inherit) · QC sent 10 · pack pending · ไม่ชน "ข้าม QC/แพ็กไม่ได้" ของส่วนอื่น',
    (r ->> 'ok') = 'true' and (r2 ->> 'ok') = 'true' and (select string_agg(seq || ':' || status, ',' order by seq) from analytics.job_stage where job_id = l1) = '1:skipped,2:skipped,3:skipped,4:skipped,5:skipped,6:skipped,7:sent,8:pending'
    and pg_temp.dcount(j) = 0);
  -- แยกที่ขั้น pack (seq 8): ส่วนต้องข้าม QC (รับช่วง) ได้ — ยกเว้นเดียวของ "ข้าม QC ไม่ได้"
  d := pg_temp.fx(p_shop, p_tpl, pn, 30, 7);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  r := pg_temp.wr(th, sa, 8);
  r2 := pg_temp.ws(th, sa, 8, null, 10, 30);
  l1 := pg_temp.lot(r2);
  v_log := v_log || pg_temp.chk('A2b', 'แยกที่ขั้นแพ็ก (seq 8): ok · ส่วนข้ามขั้น QC แบบรับช่วง (ใบแม่ผ่าน QC แล้ว) · แพ็ก sent 10 · ไม่มีขั้น pending เหลือ',
    (r2 ->> 'ok') = 'true' and pg_temp.sv(l1, 7, 'status') = 'skipped' and pg_temp.sv(l1, 7, 'skip_reason') = 'split_inherit' and pg_temp.sv(l1, 8, 'status') = 'sent'
    and pg_temp.dcount(j) = 0);
  -- ข้าม QC ตรงๆ บนใบปกติ / ใบแม่ยังห้าม (ข้อยกเว้นแคบ)
  d := pg_temp.fx(p_shop, p_tpl, pn, 10, 0);
  j := pg_temp.jid(d);
  v_log := v_log || pg_temp.chk('A2c', 'ข้อยกเว้นข้าม QC แคบ: ใบแม่ข้าม qc ตรงๆ (UPDATE ตรง · skip_reason split_inherit) ยังถูกปฏิเสธ · RPC job_stage_skip qc ยังถูกปฏิเสธ',
    pg_temp.x(format('update analytics.job_stage set status = ''skipped'', skip_reason = ''split_inherit'' where job_id = %L and seq = 7', j)) like 'ERR:22023:%QC%'
    and pg_temp.q(format('select analytics.job_stage_skip(%L, %L, %L, %L, %L)', p_shop, j, 'qc', 'verify', pg_temp.act())) ->> '_hint' = 'stage_required');

  -- แยกจากใบเดิม profile_id null (leg) — ส่วนรับ snapshot เดียวกัน (ไม่มีแบบ) ไม่ติด profile_required
  d := pg_temp.mkp(p_shop, p_tpl, 'silver', pn, null, 30);
  j := pg_temp.jid(d);
  perform pg_temp.leg(j);
  perform pg_temp.rw(p_shop, j, 9.9, 3);
  th := pg_temp.newtok(p_shop, j); sa := pg_temp.sess(th, wA, '4829');
  r := pg_temp.wr(th, sa, 4, null, null, 9.9);
  r2 := pg_temp.ws(th, sa, 4, null, 10, 30);
  l1 := pg_temp.lot(r2);
  v_log := v_log || pg_temp.chk('A2d', 'แยกจากใบเดิม (profile_id null · กติกา J1): ok · ส่วน profile_id null เช่นกัน · ไม่ drift',
    (r2 ->> 'ok') = 'true' and (select profile_id is null and profile_name is null from analytics.job where id = l1) and pg_temp.dcount(j) = 0);

  -- ใบแบบชั่ง (cast ชั่ง+ถามเสีย · cut_sprue ชั่ง): แยกที่ขั้นชั่ง = ขั้นแม่ชั่งตอนส่งครั้งสุดท้ายตามเดิม · loss ของขั้นที่แยก = ไม่เทียบ
  pw := pg_temp.mkprof(p_shop, 'v181-ชั่งหล่อ+ตัดต้น');
  d := pg_temp.fx(p_shop, p_tpl, pw, 30, 3, 'silver', 9.9);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  r := pg_temp.wr(th, sa, 4, null, null, 9.9);
  r2 := pg_temp.ws(th, sa, 4, null, 10, 30);
  l1 := pg_temp.lot(r2);
  v_log := v_log || pg_temp.chk('A2e', 'ขั้นชั่ง (cast): แยก 10 จาก 30 ไม่ต้องชั่ง → ok · ส่วนไม่มีน้ำหนัก (weight_in null) · weigh_required ของขั้นแยกของส่วน = false · ขั้นแม่ยัง received',
    (r ->> 'ok') = 'true' and (r2 ->> 'ok') = 'true' and pg_temp.sv(l1, 4, 'weight_in_g') is null and pg_temp.sv(l1, 4, 'weigh_required') = 'false' and pg_temp.sv(j, 4, 'status') = 'received');
  r := pg_temp.ws(th, sa, 4, null, null, 20);
  v_log := v_log || pg_temp.chk('A2f', 'ส่งส่วนที่เหลือของขั้นที่ต้องชั่งโดยไม่ใส่น้ำหนัก = weight_required (ด่านเดิมของขั้นแม่คงอยู่) · ใส่ 9.0 = ok qty_out 20',
    (r ->> 'code') = 'weight_required' and pg_temp.sv(j, 4, 'status') = 'received'
    and (pg_temp.ws(th, sa, 4, null, null, 20, 0, null, 9.0) ->> 'ok') = 'true' and pg_temp.sv(j, 4, 'qty_out') = '20');
  v_log := v_log || pg_temp.chk('A2g', 'v_job_stage_loss: ขั้นแม่ที่แยก = loss_g/loss_pct null + not_comparable จริง (ไม่เกิดธง loss ปลอม) · ขั้นปกติอื่นไม่ not_comparable · ขั้น cut_sprue ของส่วนยังคำนวณได้',
    (select loss_g is null and loss_pct is null and not_comparable and not warn from analytics.v_job_stage_loss where job_id = j and stage_code = 'cast')
    and not exists (select 1 from analytics.v_job_stage_loss where job_id = j and stage_code <> 'cast' and not_comparable));

  -- ใบผลิต (production): ส่วนคัดลอก production_order_item_id จากแม่ — ไม่ชน uq_job_production_item · existing_job = แม่
  select poi.id into v_poi from analytics.production_order_item poi join analytics.production_order po on po.id = poi.production_order_id
   where po.status = 'open' and poi.shop_id = p_shop and poi.qty_planned >= 3 and not exists (select 1 from analytics.job x where x.production_order_item_id = poi.id and x.status <> 'cancelled')
   order by po.created_at limit 1;
  if v_poi is null then
    v_log := v_log || E'[SKIP] A2h  ไม่มีรายการใบผลิตที่ open (qty >= 3) และยังไม่มีใบงานให้ใช้ทดสอบ source=production (ไม่ใช่ความล้มเหลว — บอก Tech Lead)\n';
  else
    r := pg_temp.q(format('select analytics.job_create_from_production_item(p_shop_id=>%L, p_production_order_item_id=>%L, p_stage_codes=>%L::text[], p_actor=>%L)', p_shop, v_poi, pg_temp.std(), pg_temp.act()));
    j := pg_temp.jid(r);
    if j is null then
      v_log := v_log || format(E'[FAIL] A2h0  สร้างใบงานจากรายการใบผลิตไม่ได้: %s\n', r::text);
    else
      th := pg_temp.newtok(p_shop, j); sa := pg_temp.sess(th, wA, '4829');
      perform pg_temp.rw(p_shop, j, 9.9, 3);
      r := pg_temp.wr(th, sa, 4, null, null, case when pg_temp.sv(j, 4, 'weigh_required') = 'true' then 9.9 end);
      r2 := pg_temp.ws(th, sa, 4, null, 1, (pg_temp.sv(j, 4, 'qty_in'))::int);
      l1 := pg_temp.lot(r2);
      v_existing := analytics.job_source_info(p_shop, 'production', v_poi) -> 'existing_job' ->> 'id';
      v_log := v_log || pg_temp.chk('A2h', 'ใบผลิต: แยก 1 ชิ้นได้ · ส่วนมี production_order_item_id เดียวกับแม่ แต่ไม่ชน unique · job_source_info.existing_job = ใบแม่ (ไม่ใช่ส่วน) · สร้างใบซ้ำจากรายการเดิม = job_exists',
        (r2 ->> 'ok') = 'true' and (select production_order_item_id = v_poi and parent_job_id = j from analytics.job where id = l1)
        and v_existing = j::text
        and pg_temp.q(format('select analytics.job_create_from_production_item(p_shop_id=>%L, p_production_order_item_id=>%L, p_stage_codes=>%L::text[], p_actor=>%L)', p_shop, v_poi, pg_temp.std(), pg_temp.act())) ->> '_hint' = 'job_exists');
    end if;
  end if;
  return v_log;
end;
$s$;

-- ============================================================================
-- Section B — เคสห้ามผ่านของการแยก (design §10.1 ข้อ 1–5): จำนวน · สถานะขั้น/ใบ · CAS จำนวนที่ถือ (กดซ้ำ/2 มือถือ)
-- ============================================================================
create function pg_temp.sb(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  pn uuid; wA uuid; wB uuid;
  d jsonb; j uuid; th text; sa text; sb text;
  r jsonb; r2 jsonb; r3 jsonb;
  l1 uuid; n_ev int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pn := pg_temp.pid(p_shop, 'none');
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829');
  wB := pg_temp.wid(p_shop, 'vfy-ช่าง B', '7351');

  -- ----- B1 จำนวน: ≤ 0 · ≥ ที่ถือ (ต้องเหลือ ≥ 1) · NaN · > 100000 -----
  d := pg_temp.fx(p_shop, p_tpl, pn, 10, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4);
  select count(*) into n_ev from analytics.job_event where job_id = j;
  r := pg_temp.ws(th, sa, 4, null, 0, 10);
  r2 := pg_temp.ws(th, sa, 4, null, -3, 10);
  r3 := pg_temp.ws(th, sa, 4, null, 11, 10);
  v_log := v_log || pg_temp.chk('B1a', 'ช่างแยก 0 / −3 / 11 (มากกว่าที่ถือ 10) = qty_invalid ทั้งหมด · ไม่สร้างส่วน · ขั้นไม่ขยับ · ไม่มี event เพิ่ม',
    (r ->> 'code') = 'qty_invalid' and (r2 ->> 'code') = 'qty_invalid' and (r3 ->> 'code') = 'qty_invalid'
    and pg_temp.nlots(j) = 0 and pg_temp.sv(j, 4, 'qty_split_out') = '0' and (select count(*) from analytics.job_event where job_id = j) = n_ev);
  r := pg_temp.ws(th, sa, 4, null, 9, 10, 1, 'porosity');
  r2 := pg_temp.ws(th, sa, 4, null, 100001, 10);
  v_log := v_log || pg_temp.chk('B1b', 'แยก 9 + เสีย 1 (เหลือผู้ถือ 0) = qty_invalid · แยก 100001 = qty_invalid · ไม่สร้างส่วน · ขั้นไม่ขยับ (ของเสียไม่ถูกบันทึกครึ่งทาง)',
    (r ->> 'code') = 'qty_invalid' and (r2 ->> 'code') = 'qty_invalid' and pg_temp.nlots(j) = 0 and pg_temp.sv(j, 4, 'qty_scrap') = '0' and pg_temp.sv(j, 4, 'qty_split_out') = '0');
  r := pg_temp.o_split(p_shop, j, 4, 10);
  r2 := pg_temp.o_split(p_shop, j, 4, 0);
  r3 := pg_temp.o_split(p_shop, j, 4, -1);
  v_log := v_log || pg_temp.chk('B1c', 'ออฟฟิศแยก 10 จาก 10 (ไม่เหลือผู้ถือ) / 0 / −1 = ปฏิเสธ 22023 hint qty_invalid · ไม่สร้างส่วน',
    pg_temp.rej(r, 'qty_invalid') and pg_temp.rej(r2, 'qty_invalid') and pg_temp.rej(r3, 'qty_invalid') and pg_temp.nlots(j) = 0);
  v_log := v_log || pg_temp.chk('B1d', 'NaN: ส่ง NaN::numeric เป็นจำนวนแยก = error ตั้งแต่ cast (ไม่ผ่านเข้า body) · ไม่สร้างส่วน',
    pg_temp.x(format('select analytics.job_lot_split(p_shop_id=>%L, p_job_id=>%L, p_expected_seq=>4, p_qty=>%L::numeric::int, p_actor=>%L)', p_shop, j, 'NaN', pg_temp.act())) like 'ERR:%'
    and pg_temp.nlots(j) = 0);
  -- ส่งทั้งหมดที่ถือโดยระบุ p_qty_send = ที่ถือ = ส่งปกติ ไม่เกิดส่วน (เดินเหมือน J1)
  r := pg_temp.ws(th, sa, 4, null, 10, 10);
  v_log := v_log || pg_temp.chk('B1e', 'ต้องไม่พัง: p_qty_send = จำนวนที่ถือ (10) = ส่งทั้งหมดแบบ J1 (action send · ไม่เกิดส่วน · qty_out 10 · split_out 0)',
    (r ->> 'ok') = 'true' and r ->> 'action' = 'send' and (r ->> 'qty_out') = '10' and pg_temp.nlots(j) = 0 and pg_temp.sv(j, 4, 'qty_split_out') = '0' and pg_temp.dcount(j) = 0);

  -- ----- B2 สถานะขั้น: pending / sent / skipped -----
  d := pg_temp.fx(p_shop, p_tpl, pn, 10, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  r := pg_temp.ws(th, sa, 4, null, 3, 10);
  r2 := pg_temp.o_split(p_shop, j, 4, 3);
  v_log := v_log || pg_temp.chk('B2a', 'แยกจากขั้น pending (ยังไม่รับ): ช่าง = not_received · ออฟฟิศ = ปฏิเสธ not_received · ไม่สร้างส่วน',
    (r ->> 'code') = 'not_received' and pg_temp.rej(r2, 'not_received') and pg_temp.nlots(j) = 0);
  perform pg_temp.wr(th, sa, 4);
  r := pg_temp.ws(th, sa, 4, null, null, 10);
  r2 := pg_temp.ws(th, sa, 4, null, 3, 10);
  r3 := pg_temp.o_split(p_shop, j, 4, 3);
  v_log := v_log || pg_temp.chk('B2b', 'แยกจากขั้น sent (ส่งไปแล้ว): ช่างกดซ้ำ = ok already (ไม่สร้างส่วน) · ออฟฟิศ = ปฏิเสธ already_sent · ไม่มีส่วน',
    (r ->> 'ok') = 'true' and (r2 ->> 'ok') = 'true' and (r2 ->> 'already') = 'true' and pg_temp.rej(r3, 'already_sent') and pg_temp.nlots(j) = 0);
  d := pg_temp.fx(p_shop, p_tpl, pn, 10, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4);
  r := pg_temp.ws(th, sa, 4, null, 4, 10);
  l1 := pg_temp.lot(r);
  r2 := pg_temp.ws(th, sa, 1, l1, 2, 4);
  r3 := pg_temp.o_split(p_shop, l1, 2, 2);
  v_log := v_log || pg_temp.chk('B2c', 'แยกจากขั้น skipped ของส่วน (รับช่วง) = stage_changed · ออฟฟิศ = ปฏิเสธ stage_changed · ไม่มีส่วนที่ 2',
    (r2 ->> 'code') = 'stage_changed' and pg_temp.rej(r3, 'stage_changed') and pg_temp.nlots(j) = 1);

  -- ----- B3 สถานะใบ: done / cancelled / on_hold -----
  d := pg_temp.fx(p_shop, p_tpl, pn, 10, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4);
  update analytics.job set status = 'on_hold' where id = j;
  r := pg_temp.ws(th, sa, 4, null, 3, 10);
  r2 := pg_temp.o_split(p_shop, j, 4, 3);
  v_log := v_log || pg_temp.chk('B3a', 'ใบถูกพัก (on_hold): ช่างแยก = job_on_hold · ออฟฟิศ = ปฏิเสธ job_on_hold · ไม่มีส่วน', (r ->> 'code') = 'job_on_hold' and pg_temp.rej(r2, 'job_on_hold') and pg_temp.nlots(j) = 0);
  d := pg_temp.fx(p_shop, p_tpl, pn, 10, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4);
  r := pg_temp.o_cancel(p_shop, j);
  r2 := pg_temp.ws(th, sa, 4, null, 3, 10);
  r3 := pg_temp.o_split(p_shop, j, 4, 3);
  v_log := v_log || pg_temp.chk('B3b', 'ใบยกเลิกแล้ว (token ถูกเพิกถอนด้วย): ช่างแยก = ไม่ผ่านด่าน token (ok false) · ออฟฟิศ = ปฏิเสธ job_closed · ไม่มีส่วน',
    (r ->> 'ok') = 'true' and (r2 ->> 'ok') = 'false' and pg_temp.rej(r3, 'job_closed') and pg_temp.nlots(j) = 0);
  d := pg_temp.fx(p_shop, p_tpl, pn, 10, 8);
  j := pg_temp.jid(d);
  r := pg_temp.o_done(p_shop, j, 10, 0);
  r2 := pg_temp.o_split(p_shop, j, 8, 3);
  v_log := v_log || pg_temp.chk('B3c', 'ใบ done แล้ว: ออฟฟิศแยก = ปฏิเสธ job_closed · ไม่มีส่วน', (r ->> 'ok') = 'true' and pg_temp.rej(r2, 'job_closed') and pg_temp.nlots(j) = 0);

  -- ----- B4 กดซ้ำ/2 มือถือ: p_qty_hold (CAS) -----
  d := pg_temp.fx(p_shop, p_tpl, pn, 20, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4);
  r := pg_temp.ws(th, sa, 4, null, 5, null);
  v_log := v_log || pg_temp.chk('B4a', 'ช่างแยกโดยไม่ส่ง p_qty_hold = qty_hold_required · ไม่สร้างส่วน', (r ->> 'code') = 'qty_hold_required' and pg_temp.nlots(j) = 0);
  r := pg_temp.ws(th, sa, 4, null, 5, 19);
  v_log := v_log || pg_temp.chk('B4b', 'p_qty_hold ไม่ตรงที่ถือจริง (19 ≠ 20) = stage_changed · ไม่สร้างส่วน', (r ->> 'code') = 'stage_changed' and pg_temp.nlots(j) = 0);
  r := pg_temp.ws(th, sa, 4, null, 5, 20);
  r2 := pg_temp.ws(th, sa, 4, null, 5, 20);
  v_log := v_log || pg_temp.chk('B4c', 'กดซ้ำคำขอเดิม (hold 20 ทั้งที่ตอนนี้ถือ 15) = stage_changed · เหลือส่วนเดียว (ไม่ซ้ำ) · ขั้นแม่ split_out 5',
    (r ->> 'ok') = 'true' and (r2 ->> 'code') = 'stage_changed' and pg_temp.nlots(j) = 1 and pg_temp.sv(j, 4, 'qty_split_out') = '5' and pg_temp.dcount(j) = 0);
  r := pg_temp.o_split(p_shop, j, 4, 3, 0, null, 99);
  v_log := v_log || pg_temp.chk('B4d', 'ออฟฟิศส่ง p_qty_hold ผิด = ปฏิเสธ stage_changed · ไม่ส่ง p_qty_hold ได้ (ออฟฟิศไม่บังคับ) → แยก 3 ได้ lot_seq 2',
    pg_temp.rej(r, 'stage_changed') and (pg_temp.o_split(p_shop, j, 4, 3) ->> 'lot_seq') = '2');
  return v_log;
end;
$s$;

-- ============================================================================
-- Section C — ตัวตนช่าง/ขอบเขตต้นไม้ (ข้อ 2) · D — น้ำหนักห้ามมากับการแยก (ข้อ 3) · E — ของเสีย/เหตุผลตอนแยก (ข้อ 4)
-- ============================================================================
create function pg_temp.sc(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  pn uuid; wA uuid; wB uuid;
  d jsonb; j uuid; th text; sa text; sb text;
  d2 jsonb; j2 uuid; th2 text; sa2 text;
  r jsonb; r2 jsonb; r3 jsonb;
  l1 uuid; lo uuid;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pn := pg_temp.pid(p_shop, 'none');
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829');
  wB := pg_temp.wid(p_shop, 'vfy-ช่าง B', '7351');

  d := pg_temp.fx(p_shop, p_tpl, pn, 20, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829'); sb := pg_temp.sess(th, wB, '7351');
  perform pg_temp.wr(th, sa, 4);
  r := pg_temp.ws(th, sb, 4, null, 5, 20);
  r2 := pg_temp.ws(th, sb, 4, null, null, 20);
  v_log := v_log || pg_temp.chk('C1', 'ช่าง B (ไม่ใช่ผู้ถือ) แยก/ส่งขั้นที่ A ถือ = not_holder (ข้อความไม่มีตัวเลข) · ไม่สร้างส่วน · ขั้นยัง received ของ A',
    (r ->> 'code') = 'not_holder' and (r2 ->> 'code') = 'not_holder' and pg_temp.nodigit(r) and pg_temp.nlots(j) = 0 and pg_temp.sv(j, 4, 'worker_id') = wA::text and pg_temp.sv(j, 4, 'status') = 'received');
  -- ส่วนของใบอื่น / ส่วนที่ยกเลิก / session หมด / ช่างปิด / token ถูกเพิกถอน
  d2 := pg_temp.fx(p_shop, p_tpl, pn, 20, 3);
  j2 := pg_temp.jid(d2); th2 := d2 ->> 'tokh'; sa2 := pg_temp.sess(th2, wA, '4829');
  perform pg_temp.wr(th2, sa2, 4);
  lo := pg_temp.lot(pg_temp.ws(th2, sa2, 4, null, 5, 20));
  r := pg_temp.ws(th, sa, 4, lo, 3, 20);
  r2 := pg_temp.wr(th, sb, 5, lo);
  r3 := pg_temp.wc(th, sa, lo);
  v_log := v_log || pg_temp.chk('C2', 'p_lot_job_id ของใบอื่น (นอกต้นไม้ของ token): ส่ง/รับ/ยกเลิก = invalid_part · ส่วนของใบอื่นไม่ขยับ',
    (r ->> 'code') = 'invalid_part' and (r2 ->> 'code') = 'invalid_part' and (r3 ->> 'code') = 'invalid_part'
    and pg_temp.jv(lo, 'status') = 'in_progress' and pg_temp.sv(lo, 5, 'status') = 'pending');
  l1 := pg_temp.lot(pg_temp.ws(th, sa, 4, null, 5, 20));
  perform pg_temp.o_lcancel(p_shop, l1, 'verify', 'return_to_parent');
  r := pg_temp.wr(th, sb, 5, l1);
  v_log := v_log || pg_temp.chk('C3', 'ส่วนที่ยกเลิกแล้ว: ช่างรับ = job_closed · ขั้นของส่วนไม่ขยับ', (r ->> 'code') = 'job_closed' and pg_temp.sv(l1, 5, 'status') = 'pending');
  r := pg_temp.ws(th, '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 4, null, 5, 15);
  v_log := v_log || pg_temp.chk('C4a', 'session ปลอม/หมดอายุ = session_required · ไม่สร้างส่วน', (r ->> 'code') = 'session_required' and pg_temp.nlots(j) = 1 and pg_temp.sv(j, 4, 'qty_split_out') = '0');
  update analytics.worker set is_active = false where id = wA;
  r := pg_temp.ws(th, sa, 4, null, 5, 15);
  v_log := v_log || pg_temp.chk('C4b', 'ช่างถูกปิดใช้งาน (session เดิมยังไม่หมดอายุ) = session_required · ไม่สร้างส่วน', (r ->> 'code') = 'session_required' and pg_temp.sv(j, 4, 'qty_split_out') = '0');
  update analytics.worker set is_active = true where id = wA;
  perform pg_temp.o_trevoke(p_shop, j);
  r := pg_temp.ws(th, sa, 4, null, 5, 15);
  v_log := v_log || pg_temp.chk('C4c', 'QR ถูกเพิกถอนทั้งหมด = invalid_token (ไม่ใช่ error อื่น) · ไม่สร้างส่วน', (r ->> 'code') = 'invalid_token' and pg_temp.nlots(j) = 1 and pg_temp.sv(j, 4, 'qty_split_out') = '0');
  return v_log;
end;
$s$;

create function pg_temp.sd(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  pn uuid; wA uuid;
  d jsonb; j uuid; th text; sa text;
  r jsonb; r2 jsonb; r3 jsonb; r4 jsonb; r5 jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pn := pg_temp.pid(p_shop, 'none');
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829');
  d := pg_temp.fx(p_shop, p_tpl, pn, 10, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4);
  r := pg_temp.ws(th, sa, 4, null, 3, 10, 0, null, 9.9);
  r2 := pg_temp.ws(th, sa, 4, null, 3, 10, 0, null, null, 0.5);
  r3 := pg_temp.ws(th, sa, 4, null, 3, 10, 0, null, null, null, 0.1);
  r4 := pg_temp.ws(th, sa, 4, null, 3, 10, 0, null, null, null, null, 'x');
  r5 := pg_temp.ws(th, sa, 4, null, 3, 10, 0, null, 0, null, null, null);
  v_log := v_log || pg_temp.chk('D1', 'ส่งน้ำหนักออก / เติมโลหะ / เศษ / หมายเหตุน้ำหนัก / น้ำหนัก 0 มากับการแยก = weight_unexpected ทุกแบบ · ข้อความไม่มีตัวเลข (N1) · ไม่สร้างส่วน · ขั้นไม่ขยับ',
    (r ->> 'code') = 'weight_unexpected' and (r2 ->> 'code') = 'weight_unexpected' and (r3 ->> 'code') = 'weight_unexpected' and (r4 ->> 'code') = 'weight_unexpected'
    and (r5 ->> 'code') = 'weight_unexpected' and pg_temp.nodigit(r) and pg_temp.nodigit(r3)
    and pg_temp.nlots(j) = 0 and pg_temp.sv(j, 4, 'qty_split_out') = '0' and pg_temp.sv(j, 4, 'weight_out_g') is null);
  r := pg_temp.ws(th, sa, 4, null, 3, 10);
  v_log := v_log || pg_temp.chk('D2', 'ต้องไม่พัง: แยกโดยไม่ส่งน้ำหนักใดๆ = ok (ค1: นับจำนวนอย่างเดียว) · ส่วนไม่มีน้ำหนัก', (r ->> 'ok') = 'true' and pg_temp.sv(pg_temp.lot(r), 4, 'weight_in_g') is null);
  return v_log;
end;
$s$;

create function pg_temp.se(p_shop uuid, p_tpl uuid) returns text
 language plpgsql as $s$
declare
  v_log text := '';
  pn uuid; wA uuid;
  d jsonb; j uuid; th text; sa text;
  r jsonb; r2 jsonb; r3 jsonb; r4 jsonb; r5 jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  pn := pg_temp.pid(p_shop, 'none');
  wA := pg_temp.wid(p_shop, 'vfy-ช่าง A', '4829');
  d := pg_temp.fx(p_shop, p_tpl, pn, 10, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4);
  r := pg_temp.ws(th, sa, 4, null, 3, 10, 2, null);
  r2 := pg_temp.ws(th, sa, 4, null, 3, 10, 2, chr(8203));
  r3 := pg_temp.ws(th, sa, 4, null, 3, 10, 2, '.');
  r4 := pg_temp.ws(th, sa, 4, null, 3, 10, 2, E'ตก\tพื้น');
  r5 := pg_temp.ws(th, sa, 4, null, 3, 10, 0, 'porosity');
  v_log := v_log || pg_temp.chk('E1', 'ของเสียตอนแยก: ไม่มีเหตุผล / เหตุผลล่องหน (ZWSP) / เหตุผล "." / มี tab = reason_required · เหตุผลโดยไม่มีของเสีย = reason_unexpected · ไม่สร้างส่วน · ขั้นไม่ขยับ',
    (r ->> 'code') = 'reason_required' and (r2 ->> 'code') = 'reason_required' and (r3 ->> 'code') = 'reason_required' and (r4 ->> 'code') = 'reason_required'
    and (r5 ->> 'code') = 'reason_unexpected' and pg_temp.nlots(j) = 0 and pg_temp.sv(j, 4, 'qty_scrap') = '0' and pg_temp.sv(j, 4, 'qty_split_out') = '0');
  r := pg_temp.ws(th, sa, 4, null, 3, 10, 2, 'porosity');
  v_log := v_log || pg_temp.chk('E2', 'แยก 3 + เสีย 2 (เหตุผล porosity) = ok แม้แบบ "ไม่ชั่ง" ไม่ถามของเสีย (flag = ถาม ไม่ใช่ด่าน) · ขั้นแม่ scrap 2 เหตุผล porosity split_out 3 · ผู้ถือเหลือ 5 · event scrap + split',
    (r ->> 'ok') = 'true' and (r ->> 'parent_remaining') = '5' and pg_temp.sv(j, 4, 'qty_scrap') = '2' and pg_temp.sv(j, 4, 'scrap_reason') = 'porosity'
    and pg_temp.sv(j, 4, 'qty_split_out') = '3' and pg_temp.sv(j, 4, 'scrap_qty_ask') = 'false'
    and exists (select 1 from analytics.job_event where job_id = j and event_type = 'scrap' and (payload ->> 'qty') = '2' and payload ->> 'reason' = 'porosity' and payload ->> 'kind' = 'split')
    and pg_temp.dcount(j) = 0 and pg_temp.sdrift(j) = 0);
  r := pg_temp.ws(th, sa, 4, null, null, 5, 1, 'broken');
  v_log := v_log || pg_temp.chk('E3', 'ส่งส่วนที่เหลือพร้อมเสียเพิ่ม 1 (broken) ต่างเหตุผลจากที่บันทึกตอนแยก (porosity) = ok · ขั้นเสียรวม 3 เหตุผล other · qty_out = 10 − 3 − 3 = 4 · ไม่ drift',
    (r ->> 'ok') = 'true' and pg_temp.sv(j, 4, 'qty_scrap') = '3' and pg_temp.sv(j, 4, 'scrap_reason') = 'other' and pg_temp.sv(j, 4, 'qty_out') = '4'
    and pg_temp.sv(j, 4, 'qty_split_out') = '3' and pg_temp.dcount(j) = 0 and pg_temp.sdrift(j) = 0);
  d := pg_temp.fx(p_shop, p_tpl, pn, 10, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4);
  perform pg_temp.ws(th, sa, 4, null, 3, 10, 2, 'ตกพื้น');
  r := pg_temp.ws(th, sa, 4, null, null, 5, 1, 'ตกพื้น');
  v_log := v_log || pg_temp.chk('E4', 'เสียเพิ่มตอนส่งด้วยเหตุผลเดียวกับที่บันทึกตอนแยก (ข้อความอิสระ) = คงเหตุผลเดิม · เสียรวม 3 · qty_out 4',
    (r ->> 'ok') = 'true' and pg_temp.sv(j, 4, 'scrap_reason') = 'ตกพื้น' and pg_temp.sv(j, 4, 'qty_scrap') = '3' and pg_temp.sv(j, 4, 'qty_out') = '4' and pg_temp.dcount(j) = 0);
  d := pg_temp.fx(p_shop, p_tpl, pn, 10, 3);
  j := pg_temp.jid(d); th := d ->> 'tokh'; sa := pg_temp.sess(th, wA, '4829');
  perform pg_temp.wr(th, sa, 4);
  perform pg_temp.ws(th, sa, 4, null, 3, 10, 2, 'porosity');
  r := pg_temp.ws(th, sa, 4, null, null, 5, 6, 'broken');
  r2 := pg_temp.ws(th, sa, 4, null, null, 5, 5, 'broken');
  v_log := v_log || pg_temp.chk('E5', 'เสียตอนส่งส่วนที่เหลือเกินที่ถือ (6 > 5) = qty_invalid (ไม่นับของที่แยกไป/เสียไปแล้ว) · เสียเท่าที่ถือ (5) = ok qty_out 0',
    (r ->> 'code') = 'qty_invalid' and (r2 ->> 'ok') = 'true' and pg_temp.sv(j, 4, 'qty_out') = '0' and pg_temp.sv(j, 4, 'qty_scrap') = '7' and pg_temp.dcount(j) = 0);
  return v_log;
end;
$s$;

-- ============================================================================
-- ตัวรัน section: แต่ละ section ล้มด้วย exception ไม่ทำให้ทั้งชุดตาย · ทุก section ถอยกลับ (raise) — ข้อมูลทดสอบไม่เหลือ
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
