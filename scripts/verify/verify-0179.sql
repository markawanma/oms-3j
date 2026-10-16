-- scripts/verify/verify-0179.sql
-- ตรวจ supabase/migrations/0179_oem_invoice.sql (ใบแจ้งหนี้ OEM phase I1) หลัง apply (หรือต่อท้ายไฟล์ 0179 ใน dry-run เดียว)
-- self-rolling-back (3j-migration-traps ข้อ 11): แตะตัวนับเลขเอกสาร ⇒ suite ทั้งชุดรันใน subtransaction ที่ถอยกลับเอง แล้ว raise exception ปิดท้ายเสมอ
-- ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน · [SKIP] = พิสูจน์ไม่ได้
-- 🔴 ไม่เผาเลข IV/RT จริง: ทุกการออกใบอยู่ใน subtransaction ที่ rollback · ปิดท้ายตรวจ md5 ตัวนับเอกสาร + ใบเสร็จ + quote ก่อน/หลังเท่าเดิม
-- 🔴 ไม่แตะใบเสนอราคาจริงแม้ใน rollback (บทเรียน 0173): fixture = "โคลน" ใบจริง OEM-2610-004 + โคลนทุกใบจริงทุกสถานะ (N20) เป็นใบ V179-*
-- 🔴 ไม่มีเลขบัญชี/ชื่อธนาคารจริงในไฟล์นี้: ช่องทางชำระที่ใช้ทดสอบเป็นข้อความ "TEST-ONLY ... ห้ามใช้จริง" และอยู่ใน tx ที่ rollback เท่านั้น
-- เทสต์ใช้ชุดเดียวกันซ้ำ: รอบแรก = ของจริง ต้อง FAIL 0 · รอบถัดไป = mutant 15 จุด (แก้ฟังก์ชัน/trigger/view/grant จริงใน subtransaction แล้วเรียก suite เดิม
-- ต้องมีเคสที่ระบุล้มจริง) · ท้ายไฟล์ตรวจว่า mutant คืนของเดิมครบ (md5 ฟังก์ชัน/นิยาม view/ACL ตาราง)
--
-- รัน (หลัง apply):   node scripts/run-sql.mjs scripts/verify/verify-0179.sql
-- dry-run ก่อน apply: cat supabase/migrations/0179_oem_invoice.sql scripts/verify/verify-0179.sql > tmp.sql แล้วรันไม่ใส่ --commit
-- ⚠️ หลัง 0180 (แก้ oem_receipt_issue / v_oem_invoice) ต้องอัปเดตค่า md5 ของ X1 และเคสที่เกี่ยวกับ payment_state='paid'
--
-- ============ ตารางแมป "ข้อในบรีฟ/design §9 (เฉพาะ I1) -> เทสต์" ============
--  §9 #1  issue บน draft/lost/rejected/superseded (superseded ชี้ใบ active) · expired/won ผ่าน : I01a-I01e · I02a-I02b · N20 · MU03
--  §9 #2  kind นอก 2 ค่า · due ย้อนหลัง/เกิน +365/infinity/null=ค่าเริ่ม                          : I03a-I03d · I04a-I04g · MU02
--  §9 #3  deposit: ไม่มี deposit_mode / paid>0 / ยอดเกินยอดรวม / ทศนิยมเกิน 2 ตำแหน่ง             : I05a-I05e · MU04
--  §9 #4  balance: ไม่เหลือ / ตั้งมัดจำแต่ยังไม่รับ / ติดลบ ; ไม่ตั้งมัดจำ = ยอดเต็ม                 : I06a-I06f
--  §9 #5  seller ว่าง (ชื่อ/ที่อยู่/ช่องทางชำระ/บรรทัดช่องทางชำระไม่ผ่านเงื่อนไข)                   : I07a-I07f · MU05
--  §9 #6  ผู้ซื้อไม่ผูก/ไม่มีชื่อ                                                               : I08a-I08b
--  §9 #7  เปิดค้าง 1 ใบ/ดีล (ทั้ง kind เดิม/ต่าง kind) · void แล้วออกใหม่ได้เลขใหม่               : I09a-I09e · MU01
--  §9 #8  2 session พร้อมกัน                                                                  : **ไม่มีเทสต์ครอบ** (ต้อง 2 connection — do-block ทรานแซกชันเดียวจำลอง lock ไม่ได้ · กันด้วย for update แถว quote + ด่าน I09 ที่ตรวจหลังล็อก)
--  §9 #9  replaces ชี้ใบ issued / คนละดีล / คนละร้าน / ถูกแทนแล้ว                                  : I10a-I10e
--  §9 #10 note/เหตุผล void: อักขระล่องหน/วรรคตอนล้วน/control/>500                               : I11a-I11f · MU08 · P8 MU15
--  §9 #11 UPDATE/DELETE/TRUNCATE ตรง (postgres + service_role) · reopen void                    : I15a-I15h · MU09 MU10 MU14
--  §9 #12 void ใบที่ void แล้ว · void ใบที่ชำระแล้ว                                              : I11g (void ซ้ำ) · "void ใบที่ชำระแล้ว" = **ไม่มีเทสต์ครอบ** (payment_state='paid' เกิดได้หลัง 0180 เท่านั้น ใน 0179 ด่านนี้ dormant)
--  §9 #13 lines_snapshot คีย์นอก whitelist / ต้นทุน-margin หลุด (ค่าลับ 777.77/888.88/SECRET-*)  : I16a-I16e · A4 · MU12
--  §9 #14 ร้านไม่จด VAT -> none ทุกช่องเป็น null · description ไม่มีภาษี/VAT                    : I12c-I12d
--  §9 #15 role authenticated/anon (grant usage กลับ — traps 18.5)                              : I18a-I18d · A3 · MU13
--  §9 #16-19 (0180)                                                                           : ไม่อยู่ในรอบนี้
--  บรีฟ: client ส่งยอดเองไม่ได้ (signature ไม่มี)                                                : A1
--  บรีฟ: ยอด deposit/balance = view · remainder ยอดคี่ · base+vat=amount                       : I05f · I06g · I12a-I12b · I13a-I13e · MU06
--  บรีฟ: ใบเสร็จเดิม/oem_receipt_issue ทำงานเหมือนเดิม (golden md5 + ยิงจริงบนโคลน)               : X1 · N19a-N19c
--  บรีฟ: ตัวนับ RT ไม่ขยับ · IV +1 ทีละใบ ไม่ข้าม ไม่ reuse · ตัวนับกันแก้ตรง                     : I17a-I17g · MU07 · Z1-Z3 (ท้ายไฟล์ = state ไม่ขยับ)
--  บรีฟ: is_stale/is_overdue/payment_state (มัดจำ due=issue ไม่นับเลยกำหนด) · active_quote_id    : I14a-I14j · MU11
--  บรีฟ: ช่องทางชำระ — ตั้งค่า/ล้าง/ปฏิเสธ · oem_setting_upsert ไม่ทับค่า                          : P1-P13 · J1 · MU15
--  บรีฟ: audit invoice_issue/invoice_void ไม่มี PII เกินที่กำหนด                                 : I19a-I19c
--  ไม่มีเทสต์ครอบ: (1) race จริง 2 connection (2) นาฬิกา UTC/BKK 00:00-07:00 จริง — now() เป็นเวลาเริ่ม tx เทสต์ได้แค่ตรรกะ ไม่ได้ลอง current_date mutant (3) PostgREST จริง/หน้าจอ
--    (4) void ใบที่ชำระแล้ว (รอ 0180) (5) การต่อราคาจริงด้วย oem_quote_renegotiate — จำลองด้วย UPDATE แถว quote ตรงๆ ในใบทดสอบ (stale/active_quote_id)

create function pg_temp.chk(p_id text, p_desc text, p_ok boolean) returns text
 language sql as $c$
  select format('[%s] %s  %s', case when coalesce(p_ok, false) then 'OK' else 'FAIL' end, p_id, p_desc) || E'\n'
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

create function pg_temp.hint(j jsonb) returns text language sql as $c$ select coalesce(j ->> '_hint', '') $c$;
create function pg_temp.rej(j jsonb) returns boolean language sql as $c$ select j ? '_err' $c$;

-- เรียก oem_invoice_issue -> {id} หรือ {_err,_state,_hint} (แต่ละเรียก = subtransaction ของตัวเอง: ล้มแล้วตัวนับไม่ถูกเผา เหมือนของจริง)
create function pg_temp.iss(p_shop uuid, p_quote uuid, p_kind text, p_due date default null, p_note text default null,
                            p_repl uuid default null, p_actor uuid default null) returns jsonb
 language plpgsql as $c$
declare v uuid; v_msg text; v_state text; v_hint text;
begin
  v := (analytics.oem_invoice_issue(p_shop, p_quote, p_kind, p_due, p_note, p_repl, p_actor) ->> 'id')::uuid;
  return jsonb_build_object('id', v);
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
  return jsonb_build_object('_err', v_msg, '_state', v_state, '_hint', v_hint);
end;
$c$;

create function pg_temp.vd(p_shop uuid, p_inv uuid, p_reason text, p_actor uuid default null) returns jsonb
 language plpgsql as $c$
declare v_msg text; v_state text; v_hint text;
begin
  perform analytics.oem_invoice_void(p_shop, p_inv, p_reason, p_actor);
  return jsonb_build_object('ok', true);
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
  return jsonb_build_object('_err', v_msg, '_state', v_state, '_hint', v_hint);
end;
$c$;

create function pg_temp.spl(p_shop uuid, p_lines text[], p_actor uuid) returns jsonb
 language plpgsql as $c$
declare v_msg text; v_state text; v_hint text;
begin
  perform analytics.oem_setting_set_payment_lines(p_shop, p_lines, p_actor);
  return jsonb_build_object('ok', true);
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
  return jsonb_build_object('_err', v_msg, '_state', v_state, '_hint', v_hint);
end;
$c$;

create function pg_temp.rcpt(p_shop uuid, p_quote uuid, p_amount numeric, p_kind text) returns jsonb
 language plpgsql as $c$
declare v uuid; v_msg text; v_state text;
begin
  v := analytics.oem_receipt_issue(p_shop, p_quote, p_amount, (now() at time zone 'Asia/Bangkok')::date, p_kind);
  return jsonb_build_object('id', v);
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  return jsonb_build_object('_err', v_msg, '_state', v_state);
end;
$c$;

-- ใบเสนอราคาทดสอบ: โคลนจากใบจริง OEM-2610-004 (แถว quote + ผู้ซื้อ + รายการ 1 แถว) แล้วทับด้วยค่าที่ต้องการ
-- ใส่ค่า "ลับ" (cost 777.77/888.88 · SECRET-*) ลงฟิลด์ภายในไว้ เพื่อพิสูจน์ว่าไม่หลุดเข้า invoice/view
create function pg_temp.mkq(p_shop uuid, p_status text, p_grand numeric, p_dep_mode text default null, p_dep_input numeric default null,
                            p_vat_mode text default 'breakdown', p_with_cust boolean default true, p_root uuid default null,
                            p_valid date default null) returns uuid
 language plpgsql as $c$
declare
  v_tpl   analytics.oem_quote;
  v_item  analytics.oem_quote_item;
  v_cust  analytics.oem_customer;
  v_id    uuid := gen_random_uuid();
  v_cid   uuid := null;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  select * into v_tpl from analytics.oem_quote where shop_id = p_shop and quote_no = 'OEM-2610-004';
  if v_tpl.id is null then raise exception 'verify-0179: ไม่พบใบแม่แบบ OEM-2610-004 — สร้าง fixture ไม่ได้'; end if;
  select * into v_item from analytics.oem_quote_item where quote_id = v_tpl.id order by seq limit 1;
  if p_with_cust then
    select * into v_cust from analytics.oem_customer where id = v_tpl.customer_id;
    v_cid := gen_random_uuid();
    insert into analytics.oem_customer select (jsonb_populate_record(null::analytics.oem_customer,
      to_jsonb(v_cust) || jsonb_build_object('id', v_cid, 'legal_name', 'V179-ผู้ซื้อทดสอบ', 'tax_id', null, 'branch_label', null))).*;
  end if;
  insert into analytics.oem_quote select (jsonb_populate_record(null::analytics.oem_quote,
    to_jsonb(v_tpl) || jsonb_build_object(
      'id', v_id, 'quote_no', 'V179-' || substr(v_id::text, 1, 8), 'status', p_status,
      'root_quote_id', coalesce(p_root, v_id), 'parent_quote_id', null, 'customer_id', v_cid,
      'grand_total', p_grand, 'pieces_subtotal', p_grand, 'quote_total', p_grand, 'nre_price', 0, 'discount_thb', 0,
      'deposit_mode', p_dep_mode, 'deposit_input', p_dep_input, 'vat_mode', p_vat_mode,
      'quote_valid_until', coalesce(p_valid, case when p_status = 'expired' then v_today - 5 else v_today + 30 end),
      'cost_piece', 888.88, 'approval_note', 'SECRET-APPROVAL', 'discount_reason', 'SECRET-DISC', 'lost_reason', 'SECRET-LOST'))).*;
  insert into analytics.oem_quote_item select (jsonb_populate_record(null::analytics.oem_quote_item,
    to_jsonb(v_item) || jsonb_build_object(
      'id', gen_random_uuid(), 'quote_id', v_id, 'seq', 1, 'qty', 1, 'price_per_piece', p_grand, 'item_total', p_grand,
      'cost_piece', 777.77, 'product_name_snapshot', 'V179 สินค้าทดสอบ', 'sku_snapshot', null))).*;
  return v_id;
end;
$c$;

-- โคลนใบจริงทั้งใบ (ทุกสถานะ/ทุกโหมดที่มีจริง) เป็นใบ V179-* — ไม่ยิง RPC ใส่ใบจริงตรงๆ
create function pg_temp.clone_real(p_real uuid) returns uuid
 language plpgsql as $c$
declare v_q analytics.oem_quote; v_id uuid := gen_random_uuid();
begin
  select * into v_q from analytics.oem_quote where id = p_real;
  insert into analytics.oem_quote select (jsonb_populate_record(null::analytics.oem_quote,
    to_jsonb(v_q) || jsonb_build_object('id', v_id, 'quote_no', 'V179-' || substr(v_id::text, 1, 8),
      'root_quote_id', v_id, 'parent_quote_id', null))).*;
  insert into analytics.oem_quote_item select (jsonb_populate_record(null::analytics.oem_quote_item,
    to_jsonb(i) || jsonb_build_object('id', gen_random_uuid(), 'quote_id', v_id))).*
    from analytics.oem_quote_item i where i.quote_id = p_real;
  return v_id;
end;
$c$;

create function pg_temp.suite(p_shop uuid, p_actor uuid) returns text
 language plpgsql as $s$
declare
  v        text := '';
  v_today  date := (now() at time zone 'Asia/Bangkok')::date;
  v_ivkey  text := 'IV-' || to_char((now() at time zone 'Asia/Bangkok')::date, 'YYMM');
  lines_ok text[] := array['TEST-ONLY บัญชีทดสอบ 000-0-00000-0 (ห้ามใช้จริง)', 'TEST-ONLY พร้อมเพย์ทดสอบ 0000000000 (ห้ามใช้จริง)'];
  r jsonb; r2 jsonb; r3 jsonb; t text; t2 text; st text;
  q uuid; q2 uuid; qa uuid; qb uuid; qc uuid;
  inv uuid; inv2 uuid; inv3 uuid;
  vi record; vi2 record; ti record;
  g numeric; n0 int; n1 int; n2 int;
  rt0 text; rt1 text; b boolean; b2 boolean;
  shop2 uuid; n_real int; v_bad text;
  rec record;
  gs numeric[] := array[100, 10001.01, 33.33, 1.01, 99999.99];
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- ==================== A. โครงสร้าง / สิทธิ์ ====================
  v := v || pg_temp.chk('A1', 'oem_invoice_issue ไม่มีพารามิเตอร์ยอดเงินเลย (client ส่งยอดเองไม่ได้)',
    (select proargnames is not null and not exists (select 1 from unnest(proargnames) n where n ~* '(amount|thb|total|price)')
       and proargnames = array['p_shop_id','p_quote_id','p_kind','p_due_date','p_note','p_replaces_invoice_id','p_actor_id']
       from pg_proc where oid = 'analytics.oem_invoice_issue(uuid,uuid,text,date,text,uuid,uuid)'::regprocedure));
  v := v || pg_temp.chk('A2', 'ฟังก์ชันใหม่มี signature เดียว ไม่มี overload (traps ข้อ 1)',
    (select count(*) = 5 from pg_proc where pronamespace = 'analytics'::regnamespace
        and proname in ('oem_invoice_issue','oem_invoice_void','oem_setting_set_payment_lines','oem_invoice_deny_mutation','oem_invoice_deny_truncate')));
  v := v || pg_temp.chk('A3', 'สิทธิ์: ฟังก์ชันใหม่ไม่เปิดให้ PUBLIC/anon/authenticated · ตาราง/view service_role อ่านอย่างเดียว · anon/authenticated ไม่มีสิทธิ์เลย',
    not exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                 where p.pronamespace = 'analytics'::regnamespace
                   and p.proname in ('oem_invoice_issue','oem_invoice_void','oem_setting_set_payment_lines','oem_invoice_deny_mutation','oem_invoice_deny_truncate')
                   and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole))
    and has_function_privilege('service_role', 'analytics.oem_invoice_issue(uuid,uuid,text,date,text,uuid,uuid)', 'execute')
    and has_function_privilege('service_role', 'analytics.oem_invoice_void(uuid,uuid,text,uuid)', 'execute')
    and has_function_privilege('service_role', 'analytics.oem_setting_set_payment_lines(uuid,text[],uuid)', 'execute')
    and has_table_privilege('service_role', 'analytics.oem_invoice', 'select')
    and not has_table_privilege('service_role', 'analytics.oem_invoice', 'insert')
    and not has_table_privilege('service_role', 'analytics.oem_invoice', 'update')
    and not has_table_privilege('service_role', 'analytics.oem_invoice', 'delete')
    and not has_table_privilege('service_role', 'analytics.oem_invoice', 'truncate')
    and has_table_privilege('service_role', 'analytics.v_oem_invoice', 'select')
    and not has_table_privilege('service_role', 'analytics.v_oem_invoice', 'insert')
    and not has_table_privilege('anon', 'analytics.oem_invoice', 'select') and not has_table_privilege('authenticated', 'analytics.oem_invoice', 'select')
    and not has_table_privilege('anon', 'analytics.v_oem_invoice', 'select') and not has_table_privilege('authenticated', 'analytics.v_oem_invoice', 'select')
    and (select c.relrowsecurity from pg_class c where c.oid = 'analytics.oem_invoice'::regclass));
  v := v || pg_temp.chk('A4', 'ตาราง/view ใบแจ้งหนี้ไม่มีคอลัมน์ต้นทุน/margin/approval/lost/calc/discount_reason/price_reason/รับซื้อคืน',
    not exists (select 1 from information_schema.columns where table_schema = 'analytics' and table_name in ('oem_invoice', 'v_oem_invoice')
                 and column_name ~* '(cost|margin|approval|lost_|calc|rate_snapshot|discount_reason|price_reason|buy_back|kilo_buy)')
    and not exists (select 1 from information_schema.columns where table_schema = 'analytics' and table_name = 'v_oem_invoice' and column_name in ('created_by', 'voided_by')));
  v := v || pg_temp.chk('A5', 'v_oem_seller: 14 คอลัมน์ · 13 ตัวเดิมเป็น prefix · seller_payment_lines อยู่ท้ายสุด',
    (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'analytics' and table_name = 'v_oem_seller')
      = 'shop_id,seller_legal_name,seller_display_name,seller_branch_label,seller_address_lines,seller_tax_id,seller_vat_registered,seller_phone,seller_line,seller_email,seller_website,seller_terms,deposit_default_pct,seller_payment_lines');

  -- ==================== X1. ของเดิมที่ 0179 ไม่ต้องแตะ (golden md5 ลอกจาก DB ก่อน apply 16 ต.ค. 69) ====================
  v := v || pg_temp.chk('X1a', 'oem_receipt_issue (9 args) / oem_receipt_void / trigger ใบเสร็จ+ตัวนับ ไม่ถูกแตะ (md5 นิยามเท่าเดิม)',
    md5(pg_get_functiondef('analytics.oem_receipt_issue(uuid,uuid,numeric,date,text,text,text,text,uuid)'::regprocedure)) = '237152ffe9b75961c522bbe7994a836a'
    and md5(pg_get_functiondef('analytics.oem_receipt_void(uuid,uuid,text)'::regprocedure)) = '1f14141a16622ef03d8cae82610b0dab'
    and md5(pg_get_functiondef('analytics.oem_receipt_deny_mutation()'::regprocedure)) = 'a9c0217c0cf84f51554f4f0f9364cf15'
    and md5(pg_get_functiondef('analytics.oem_doc_counter_deny_mutation()'::regprocedure)) = '07f8cc3a8165a6d384380191cf2f3c3f'
    and (select count(*) = 1 from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'oem_receipt_issue'));
  v := v || pg_temp.chk('X1b', 'oem_setting_upsert (23 args) / oem_quote_save / oem_quote_renegotiate ไม่ถูกแตะ',
    (select md5(pg_get_functiondef(oid)) from pg_proc where proname = 'oem_setting_upsert' and pronamespace = 'analytics'::regnamespace) = '10f096a43d7dbdd1d7c7febc59412978'
    and md5(pg_get_functiondef('analytics.oem_quote_save(uuid,jsonb,uuid,text,text,text,text,numeric,text,date,uuid)'::regprocedure)) = '1d48eed26068e4141383b0621135209f'
    and (select string_agg(md5(pg_get_functiondef(oid)), '' order by oid::regprocedure::text) from pg_proc where proname = 'oem_quote_renegotiate' and pronamespace = 'analytics'::regnamespace) = '51c8d6ec7e4b41414352583fadb5fc09');
  v := v || pg_temp.chk('X1c', 'v_oem_quote / v_oem_receipt ไม่ถูกแตะ (md5 นิยาม + รายชื่อคอลัมน์ 44 ตัว ลำดับเดิม)',
    md5(pg_get_viewdef('analytics.v_oem_quote'::regclass)) = 'cb95a70df22ecfa532cf6b46512fa478'
    and md5(pg_get_viewdef('analytics.v_oem_receipt'::regclass)) = '116f1ec779a67965963505e5ed7a633e'
    and (select md5(string_agg(column_name, ',' order by ordinal_position)) from information_schema.columns where table_schema = 'analytics' and table_name = 'v_oem_quote') = '44039b8554559723484c4d75be7415ee');

  -- ==================== P. ช่องทางชำระเงิน (oem_setting_set_payment_lines) ====================
  r := pg_temp.spl(p_shop, lines_ok, p_actor);
  v := v || pg_temp.chk('P1', 'ตั้งช่องทางชำระ 2 บรรทัดได้ · v_oem_seller เห็นค่าเดียวกัน',
    not pg_temp.rej(r) and (select s.seller_payment_lines = lines_ok from analytics.v_oem_seller s where s.shop_id = p_shop));
  v := v || pg_temp.chk('P2', 'p_lines = null ถูกปฏิเสธ (ไม่ใช่การล้างค่า)', pg_temp.rej(pg_temp.spl(p_shop, null, p_actor)));
  v := v || pg_temp.chk('P3', '7 บรรทัดถูกปฏิเสธ', pg_temp.rej(pg_temp.spl(p_shop, array['TEST-ONLY a1','TEST-ONLY a2','TEST-ONLY a3','TEST-ONLY a4','TEST-ONLY a5','TEST-ONLY a6','TEST-ONLY a7'], p_actor)));
  v := v || pg_temp.chk('P4', 'บรรทัดที่มีแต่อักขระล่องหน (U+200B) ถูกปฏิเสธ ไม่ถูกข้ามเงียบ', pg_temp.rej(pg_temp.spl(p_shop, array[chr(8203)], p_actor)));
  v := v || pg_temp.chk('P5', 'บรรทัดที่มีการขึ้นบรรทัดใหม่ถูกปฏิเสธ', pg_temp.rej(pg_temp.spl(p_shop, array['TEST-ONLY a' || chr(10) || 'b'], p_actor)));
  v := v || pg_temp.chk('P6', 'บรรทัดยาว 201 ตัวอักษรถูกปฏิเสธ · 200 ตัวผ่าน',
    pg_temp.rej(pg_temp.spl(p_shop, array[repeat('ก', 201)], p_actor)) and not pg_temp.rej(pg_temp.spl(p_shop, array[repeat('ก', 200)], p_actor)));
  v := v || pg_temp.chk('P7', 'บรรทัดมี control char ถูกปฏิเสธ', pg_temp.rej(pg_temp.spl(p_shop, array['TEST-ONLY a' || chr(1) || 'b'], p_actor)));
  v := v || pg_temp.chk('P8', 'บรรทัดที่เป็นเครื่องหมายวรรคตอนล้วน ("....") ถูกปฏิเสธ (whitelist ไม่ใช่ blacklist)', pg_temp.rej(pg_temp.spl(p_shop, array['....'], p_actor)));
  r := pg_temp.spl(p_shop, lines_ok, p_actor);
  v := v || pg_temp.chk('P9', 'ความพยายามที่ถูกปฏิเสธไม่ทำให้ค่าเดิมเปลี่ยน',
    (select s.seller_payment_lines = lines_ok from analytics.v_oem_seller s where s.shop_id = p_shop));
  r := pg_temp.spl(p_shop, array['', '   ', null], p_actor);
  v := v || pg_temp.chk('P10', 'แถวว่างล้วน (textarea ว่าง) = ล้างค่า -> {} ',
    not pg_temp.rej(r) and (select cardinality(s.seller_payment_lines) = 0 from analytics.v_oem_seller s where s.shop_id = p_shop));
  r := pg_temp.spl(p_shop, lines_ok, p_actor);
  v := v || pg_temp.chk('P11', 'ไม่มี actor / actor ที่ไม่มีใน auth.users ถูกปฏิเสธ (actor_required)',
    pg_temp.hint(pg_temp.spl(p_shop, lines_ok, null)) = 'actor_required' and pg_temp.hint(pg_temp.spl(p_shop, lines_ok, gen_random_uuid())) = 'actor_required');
  v := v || pg_temp.chk('P12', 'p_shop_id = null ถูกปฏิเสธ', pg_temp.rej(pg_temp.spl(null, lines_ok, p_actor)));
  insert into public.shop (name) values ('verify0179-shop2') returning id into shop2;
  v := v || pg_temp.chk('P13', 'ร้านที่ไม่มีแถว oem_setting ถูกปฏิเสธ (ไม่แทรกแถวใหม่เงียบๆ)',
    pg_temp.rej(pg_temp.spl(shop2, lines_ok, p_actor)) and not exists (select 1 from analytics.oem_setting where shop_id = shop2));
  -- J1: oem_setting_upsert 23 args เดิมเรียกได้ + ไม่ทับ seller_payment_lines
  t := pg_temp.x(format($j$select analytics.oem_setting_upsert(p_shop_id=>s.shop_id, p_margin_target_pct=>s.margin_target_pct,
      p_margin_discount_cap_pct=>s.margin_discount_cap_pct, p_margin_floor_pct=>s.margin_floor_pct, p_margin_hard_floor_pct=>s.margin_hard_floor_pct,
      p_nre_max_share_pct=>s.nre_max_share_pct, p_min_job_value_thb=>s.min_job_value_thb, p_quote_valid_days_silver=>s.quote_valid_days_silver,
      p_quote_valid_days_gold=>s.quote_valid_days_gold, p_quote_valid_days_brass=>s.quote_valid_days_brass, p_bar_margin_pct=>s.bar_margin_pct,
      p_seller_legal_name=>s.seller_legal_name, p_seller_display_name=>s.seller_display_name, p_seller_branch_label=>s.seller_branch_label,
      p_seller_address_lines=>s.seller_address_lines, p_seller_tax_id=>s.seller_tax_id, p_seller_vat_registered=>s.seller_vat_registered,
      p_seller_phone=>s.seller_phone, p_seller_line=>s.seller_line, p_seller_email=>s.seller_email, p_seller_website=>s.seller_website,
      p_seller_terms=>s.seller_terms, p_deposit_default_pct=>s.deposit_default_pct) from analytics.oem_setting s where s.shop_id = %L$j$, p_shop));
  v := v || pg_temp.chk('J1', 'oem_setting_upsert เดิมยังเรียกได้ และไม่ทับ seller_payment_lines (' || left(t, 80) || ')',
    t = 'OK' and (select s.seller_payment_lines = lines_ok from analytics.oem_setting s where s.shop_id = p_shop));

  -- ==================== I01-I02 สถานะใบเสนอราคา ====================
  b := true; v_bad := '';
  foreach t in array array['draft', 'lost', 'rejected'] loop
    q := pg_temp.mkq(p_shop, t, 1000, 'pct', 0.5);
    r := pg_temp.iss(p_shop, q, 'deposit', null, null, null, p_actor);
    if pg_temp.hint(r) <> 'quote_status_invalid' then b := false; v_bad := v_bad || t || '/' || coalesce(r ->> '_hint', 'ผ่าน') || ' '; end if;
    q2 := pg_temp.mkq(p_shop, t, 1000);
    r := pg_temp.iss(p_shop, q2, 'balance', null, null, null, p_actor);
    if pg_temp.hint(r) <> 'quote_status_invalid' then b := false; v_bad := v_bad || t || '(balance)/' || coalesce(r ->> '_hint', 'ผ่าน') || ' '; end if;
  end loop;
  v := v || pg_temp.chk('I01a', 'draft/lost/rejected ออกใบแจ้งหนี้ไม่ได้ทั้ง deposit และ balance (quote_status_invalid) ' || v_bad, b);
  qa := pg_temp.mkq(p_shop, 'superseded', 1000, 'pct', 0.5);
  qb := pg_temp.mkq(p_shop, 'quoted', 1200, 'pct', 0.5, 'breakdown', true, qa);
  r := pg_temp.iss(p_shop, qa, 'deposit', null, null, null, p_actor);
  v := v || pg_temp.chk('I01b', 'superseded ถูกปฏิเสธ + ข้อความชี้เลขใบ active ของดีล',
    pg_temp.hint(r) = 'quote_superseded' and (r ->> '_err') like '%' || (select quote_no from analytics.oem_quote where id = qb) || '%');
  -- แยก statement: แถวที่ฟังก์ชันเพิ่งแทรกจะไม่อยู่ใน snapshot ของ query เดียวกันที่เรียกฟังก์ชัน
  r := pg_temp.iss(p_shop, qb, 'deposit', null, null, null, p_actor);
  v := v || pg_temp.chk('I01c', 'ใบ active ของดีลเดียวกันออกได้ · ยอดมาจากแถว active (1200 x 50%)',
    not pg_temp.rej(r) and (select (x.amount_thb = 600) from analytics.oem_invoice x where x.id = (r ->> 'id')::uuid));
  v := v || pg_temp.chk('I01d', 'quote ไม่มีอยู่จริง / ร้านอื่น ถูกปฏิเสธ (quote_not_found)',
    pg_temp.hint(pg_temp.iss(p_shop, gen_random_uuid(), 'deposit', null, null, null, p_actor)) = 'quote_not_found'
    and pg_temp.hint(pg_temp.iss(shop2, qb, 'deposit', null, null, null, p_actor)) = 'quote_not_found');
  v := v || pg_temp.chk('I01e', 'p_shop_id/p_quote_id null ถูกปฏิเสธ',
    pg_temp.hint(pg_temp.iss(null, qb, 'deposit', null, null, null, p_actor)) = 'args_required' and pg_temp.hint(pg_temp.iss(p_shop, null, 'deposit', null, null, null, p_actor)) = 'args_required');
  q := pg_temp.mkq(p_shop, 'expired', 1000, 'pct', 0.5);
  r := pg_temp.iss(p_shop, q, 'deposit', null, null, null, p_actor);
  v := v || pg_temp.chk('I02a', 'ใบหมดอายุ (expired) ออกใบมัดจำได้ (มติเจ้าของ) · ไม่พลิกสถานะ quote',
    not pg_temp.rej(r) and (select status from analytics.oem_quote where id = q) = 'expired');
  q := pg_temp.mkq(p_shop, 'won', 1000, 'pct', 0.5);
  r := pg_temp.iss(p_shop, q, 'deposit', null, null, null, p_actor);
  v := v || pg_temp.chk('I02b', 'ใบ won ออกได้ · ไม่แตะ quote (status/updated_at คงเดิม)',
    not pg_temp.rej(r) and (select status from analytics.oem_quote where id = q) = 'won');

  -- ==================== I03-I04 kind / วันกำหนดชำระ ====================
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  b := true;
  foreach t in array array['final', 'partial', 'DEPOSIT', '', 'installment'] loop
    if pg_temp.hint(pg_temp.iss(p_shop, q, t, null, null, null, p_actor)) <> 'kind_invalid' then b := false; end if;
  end loop;
  v := v || pg_temp.chk('I03a', 'kind นอกจาก deposit/balance ถูกปฏิเสธ (final/partial/DEPOSIT/ว่าง/installment)', b);
  v := v || pg_temp.chk('I03b', 'kind = null ถูกปฏิเสธ', pg_temp.hint(pg_temp.iss(p_shop, q, null, null, null, null, p_actor)) = 'kind_invalid');
  v := v || pg_temp.chk('I03c', 'ไม่มี actor ถูกปฏิเสธ (actor_required) — ไม่ออกเอกสารการเงินโดยไม่รู้ผู้ออก',
    pg_temp.hint(pg_temp.iss(p_shop, q, 'deposit', null, null, null, null)) = 'actor_required');
  v := v || pg_temp.chk('I03d', 'คำขอที่ถูกปฏิเสธไม่ทิ้งใบ (ยังไม่มี invoice ของ fixture นี้)',
    not exists (select 1 from analytics.oem_invoice where quote_id = q));

  r := pg_temp.iss(p_shop, q, 'deposit', null, null, null, p_actor);
  select * into ti from analytics.oem_invoice where id = (r ->> 'id')::uuid;
  v := v || pg_temp.chk('I04a', 'ใบมัดจำ: due_date ค่าเริ่ม = วันที่ออก (ไทย) · pay_before_work = true · issue_date = วันนี้ไทย',
    not pg_temp.rej(r) and ti.due_date = v_today and ti.issue_date = v_today and ti.pay_before_work is true);
  q2 := pg_temp.mkq(p_shop, 'quoted', 1000);
  r := pg_temp.iss(p_shop, q2, 'balance', null, null, null, p_actor);
  select * into ti from analytics.oem_invoice where id = (r ->> 'id')::uuid;
  v := v || pg_temp.chk('I04b', 'ใบคงเหลือ: due_date ค่าเริ่ม = วันที่ออก + 7 วัน · pay_before_work = false',
    not pg_temp.rej(r) and ti.due_date = v_today + 7 and ti.pay_before_work is false);
  q2 := pg_temp.mkq(p_shop, 'quoted', 1000);
  v := v || pg_temp.chk('I04c', 'due_date ย้อนหลัง (เมื่อวานไทย) ถูกปฏิเสธ', pg_temp.hint(pg_temp.iss(p_shop, q2, 'balance', v_today - 1, null, null, p_actor)) = 'due_invalid');
  v := v || pg_temp.chk('I04d', 'due_date = วันนี้ ผ่าน · ส่งเองได้ (+30)',
    not pg_temp.rej(pg_temp.iss(p_shop, q2, 'balance', v_today, null, null, p_actor))
    and not pg_temp.rej(pg_temp.iss(p_shop, pg_temp.mkq(p_shop, 'quoted', 1000), 'balance', v_today + 30, null, null, p_actor)));
  q2 := pg_temp.mkq(p_shop, 'quoted', 1000);
  v := v || pg_temp.chk('I04e', 'due_date = +365 ผ่าน · +366 ถูกปฏิเสธ',
    pg_temp.hint(pg_temp.iss(p_shop, q2, 'balance', v_today + 366, null, null, p_actor)) = 'due_invalid'
    and not pg_temp.rej(pg_temp.iss(p_shop, q2, 'balance', v_today + 365, null, null, p_actor)));
  q2 := pg_temp.mkq(p_shop, 'quoted', 1000);
  v := v || pg_temp.chk('I04f', 'due_date = infinity / -infinity ถูกปฏิเสธ',
    pg_temp.hint(pg_temp.iss(p_shop, q2, 'balance', 'infinity'::date, null, null, p_actor)) = 'due_invalid'
    and pg_temp.hint(pg_temp.iss(p_shop, q2, 'balance', '-infinity'::date, null, null, p_actor)) = 'due_invalid');
  r := pg_temp.iss(p_shop, pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5), 'deposit', v_today + 10, null, null, p_actor);
  v := v || pg_temp.chk('I04g', 'ใบมัดจำส่ง due เอง (+10) ได้ และ pay_before_work ยังเป็น true',
    not pg_temp.rej(r) and (select x.due_date = v_today + 10 and x.pay_before_work from analytics.oem_invoice x where x.id = (r ->> 'id')::uuid));

  -- ==================== I05 ใบมัดจำ: ด่านยอด ====================
  q := pg_temp.mkq(p_shop, 'quoted', 1000);
  v := v || pg_temp.chk('I05a', 'deposit เมื่อไม่ได้ตั้งเงื่อนไขมัดจำ ถูกปฏิเสธ (deposit_mode_missing)', pg_temp.hint(pg_temp.iss(p_shop, q, 'deposit', null, null, null, p_actor)) = 'deposit_mode_missing');
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  r := pg_temp.rcpt(p_shop, q, 100, 'deposit');
  v := v || pg_temp.chk('I05b', 'deposit เมื่อดีลรับเงินแล้ว (paid>0) ถูกปฏิเสธ (deposit_already_paid) · ใบเสร็จฟิกซ์เจอร์ออกได้',
    not pg_temp.rej(r) and pg_temp.hint(pg_temp.iss(p_shop, q, 'deposit', null, null, null, p_actor)) = 'deposit_already_paid');
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'thb', 1000.01);
  v := v || pg_temp.chk('I05c', 'มัดจำแบบ thb เกินยอดรวม ถูกปฏิเสธ (amount_invalid)', pg_temp.hint(pg_temp.iss(p_shop, q, 'deposit', null, null, null, p_actor)) = 'amount_invalid');
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'thb', 100.005);
  v := v || pg_temp.chk('I05d', 'มัดจำทศนิยมเกิน 2 ตำแหน่ง ถูกปฏิเสธ (ไม่ปัดเงียบจนยอดไม่ตรงกับ view)', pg_temp.hint(pg_temp.iss(p_shop, q, 'deposit', null, null, null, p_actor)) = 'amount_invalid');
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'thb', 1000);
  r := pg_temp.iss(p_shop, q, 'deposit', null, null, null, p_actor);
  select * into ti from analytics.oem_invoice where id = (r ->> 'id')::uuid;
  v := v || pg_temp.chk('I05e', 'มัดจำ = ยอดรวมพอดี ผ่าน · balance_after = 0',
    not pg_temp.rej(r) and ti.amount_thb = 1000 and ti.balance_after_thb = 0);
  q := pg_temp.mkq(p_shop, 'quoted', 10001.01, 'pct', 0.5);
  r := pg_temp.iss(p_shop, q, 'deposit', null, null, null, p_actor);
  select * into ti from analytics.oem_invoice where id = (r ->> 'id')::uuid;
  select v2.deposit_amount_thb as dep, v2.balance_thb as bal into vi from analytics.v_oem_quote v2 where v2.id = q;
  v := v || pg_temp.chk('I05f', 'ยอดมัดจำบนใบ = v_oem_quote.deposit_amount_thb เป๊ะ (ยอดคี่ 10001.01 x 50% = 5000.51 · คงเหลือ 5000.50)',
    not pg_temp.rej(r) and ti.amount_thb = vi.dep and ti.amount_thb = 5000.51 and ti.balance_after_thb = vi.bal and ti.balance_after_thb = 5000.50
    and ti.paid_before_thb + ti.amount_thb + ti.balance_after_thb = ti.grand_total_snapshot);

  -- ==================== I06 ใบคงเหลือ ====================
  q := pg_temp.mkq(p_shop, 'quoted', 1000);
  r := pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor);
  select * into ti from analytics.oem_invoice where id = (r ->> 'id')::uuid;
  v := v || pg_temp.chk('I06a', 'ไม่ตั้งมัดจำ -> balance = ยอดเต็ม · description = "ค่าสินค้า/บริการ..." (ไม่ใช่ "ยอดคงเหลือ") · paid_before 0',
    not pg_temp.rej(r) and ti.amount_thb = 1000 and ti.paid_before_thb = 0 and ti.balance_after_thb = 0
    and ti.description like 'ค่าสินค้า/บริการตามใบเสนอราคา V179-%' and ti.description not like '%ยอดคงเหลือ%');
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  v := v || pg_temp.chk('I06b', 'ตั้งมัดจำแต่ยังไม่รับเงิน -> balance ถูกปฏิเสธ (deposit_unpaid)', pg_temp.hint(pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor)) = 'deposit_unpaid');
  r := pg_temp.rcpt(p_shop, q, 500, 'deposit');
  r2 := pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor);
  select * into ti from analytics.oem_invoice where id = (r2 ->> 'id')::uuid;
  v := v || pg_temp.chk('I06c', 'รับมัดจำแล้ว -> balance = ยอดที่เหลือ (500) · description "ยอดคงเหลือ..." · paid_before 500 · ผลรวมเท่ายอดเต็ม',
    not pg_temp.rej(r) and not pg_temp.rej(r2) and ti.amount_thb = 500 and ti.paid_before_thb = 500 and ti.balance_after_thb = 0
    and ti.description like 'ยอดคงเหลือตามใบเสนอราคา V179-%' and ti.paid_before_thb + ti.amount_thb + ti.balance_after_thb = ti.grand_total_snapshot);
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  r := pg_temp.rcpt(p_shop, q, 500, 'deposit'); r := pg_temp.rcpt(p_shop, q, 500, 'final');
  v := v || pg_temp.chk('I06d', 'ชำระครบแล้ว -> balance ถูกปฏิเสธ (balance_none)', not pg_temp.rej(r) and pg_temp.hint(pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor)) = 'balance_none');
  q := pg_temp.mkq(p_shop, 'quoted', 1000);
  r := pg_temp.rcpt(p_shop, q, 1000, 'final');
  update analytics.oem_quote set grand_total = 900, pieces_subtotal = 900, quote_total = 900 where id = q;
  update analytics.oem_quote_item set price_per_piece = 900, item_total = 900 where quote_id = q;
  v := v || pg_temp.chk('I06e', 'ยอดบวกไม่ลง (รับแล้ว 1000 > ยอดรวมที่ลดเหลือ 900 · คงเหลือติดลบ) -> balance ถูกปฏิเสธ (amount_negative) และ deposit ก็ไม่ผ่าน',
    not pg_temp.rej(r) and pg_temp.hint(pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor)) = 'amount_negative');
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  update analytics.oem_quote set pieces_subtotal = 999 where id = q;
  v := v || pg_temp.chk('I06f', 'ยอดรายการ/ค่าแบบ/ส่วนลดบวกไม่ลงกับยอดรวม -> ปฏิเสธ (totals_mismatch) ไม่ปล่อยเอกสารที่บวกไม่ลง',
    pg_temp.hint(pg_temp.iss(p_shop, q, 'deposit', null, null, null, p_actor)) = 'totals_mismatch');
  q := pg_temp.mkq(p_shop, 'quoted', 1000);
  delete from analytics.oem_quote_item where quote_id = q;
  v := v || pg_temp.chk('I06g', 'ใบที่ไม่มีรายการเลย -> ปฏิเสธ (totals_mismatch)', pg_temp.hint(pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor)) = 'totals_mismatch');

  -- ==================== I07 ผู้ขาย ====================
  q := pg_temp.mkq(p_shop, 'quoted', 1000);
  begin
    update analytics.oem_setting set seller_legal_name = null where shop_id = p_shop;
    r := pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor);
    update analytics.oem_setting set seller_legal_name = chr(8203) where shop_id = p_shop;
    r2 := pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor);
    raise exception 'rollback-test' using errcode = 'P0098';
  exception when sqlstate 'P0098' then null; end;
  v := v || pg_temp.chk('I07a', 'ชื่อผู้ขายว่าง / อักขระล่องหน ถูกปฏิเสธ (seller_incomplete)', pg_temp.hint(r) = 'seller_incomplete' and pg_temp.hint(r2) = 'seller_incomplete');
  begin
    update analytics.oem_setting set seller_address_lines = '[]'::jsonb where shop_id = p_shop;
    r := pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor);
    update analytics.oem_setting set seller_address_lines = jsonb_build_array(chr(8203), '.') where shop_id = p_shop;
    r2 := pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor);
    update analytics.oem_setting set seller_address_lines = null where shop_id = p_shop;
    r3 := pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor);
    raise exception 'rollback-test' using errcode = 'P0098';
  exception when sqlstate 'P0098' then null; end;
  v := v || pg_temp.chk('I07b', 'ที่อยู่ผู้ขาย: array ว่าง / ล่องหน+วรรคตอนล้วน / null ถูกปฏิเสธ (seller_incomplete)',
    pg_temp.hint(r) = 'seller_incomplete' and pg_temp.hint(r2) = 'seller_incomplete' and pg_temp.hint(r3) = 'seller_incomplete');
  begin
    update analytics.oem_setting set seller_tax_id = null, seller_vat_registered = false where shop_id = p_shop;
    r := pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor);
    raise exception 'rollback-test' using errcode = 'P0098';
  exception when sqlstate 'P0098' then null; end;
  v := v || pg_temp.chk('I07c', 'ใบแจ้งหนี้ไม่ใช่เอกสารภาษี: ไม่บังคับเลขผู้เสียภาษีผู้ขาย/VAT registered — tax_id ว่าง + ไม่จด VAT ยังออกได้',
    not pg_temp.rej(r));
  begin
    update analytics.oem_setting set seller_payment_lines = '{}' where shop_id = p_shop;
    r := pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor);
    raise exception 'rollback-test' using errcode = 'P0098';
  exception when sqlstate 'P0098' then null; end;
  v := v || pg_temp.chk('I07d', 'ช่องทางชำระว่าง = ออกใบไม่ได้ (payment_lines_empty)', pg_temp.hint(r) = 'payment_lines_empty');
  begin
    update analytics.oem_setting set seller_payment_lines = array['TEST-ONLY ok', chr(8203)] where shop_id = p_shop;
    r := pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor);
    update analytics.oem_setting set seller_payment_lines = array['....'] where shop_id = p_shop;
    r2 := pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor);
    raise exception 'rollback-test' using errcode = 'P0098';
  exception when sqlstate 'P0098' then null; end;
  v := v || pg_temp.chk('I07e', 'บรรทัดช่องทางชำระที่เสียหายใน DB (ล่องหน/วรรคตอนล้วน) -> ออกใบไม่ได้ (payment_lines_invalid) ไม่ snapshot ขยะ',
    pg_temp.hint(r) = 'payment_lines_invalid' and pg_temp.hint(r2) = 'payment_lines_invalid');
  begin
    delete from analytics.oem_setting where shop_id = p_shop;
    r := pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor);
    raise exception 'rollback-test' using errcode = 'P0098';
  exception when sqlstate 'P0098' then null; end;
  v := v || pg_temp.chk('I07f', 'ไม่มีแถวตั้งค่าร้านเลย -> ปฏิเสธ (seller_incomplete)', pg_temp.hint(r) = 'seller_incomplete');

  -- ==================== I08 ผู้ซื้อ ====================
  q := pg_temp.mkq(p_shop, 'quoted', 1000, null, null, 'breakdown', false);
  v := v || pg_temp.chk('I08a', 'ใบที่ไม่ผูกผู้ซื้อ ถูกปฏิเสธ (buyer_incomplete)', pg_temp.hint(pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor)) = 'buyer_incomplete');
  q := pg_temp.mkq(p_shop, 'quoted', 1000);
  update analytics.oem_customer set legal_name = chr(8203) where id = (select customer_id from analytics.oem_quote where id = q);
  v := v || pg_temp.chk('I08b', 'ผู้ซื้อที่ชื่อเป็นอักขระล่องหน ถูกปฏิเสธ (buyer_incomplete)', pg_temp.hint(pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor)) = 'buyer_incomplete');

  -- ==================== I09 เปิดค้าง 1 ใบ/ดีล + เลขใหม่หลัง void ====================
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  r := pg_temp.iss(p_shop, q, 'deposit', null, null, null, p_actor);
  inv := (r ->> 'id')::uuid;
  v := v || pg_temp.chk('I09a', 'ดีลมีใบมัดจำเปิดค้าง -> ออกใบมัดจำซ้ำถูกปฏิเสธ (invoice_open)', not pg_temp.rej(r) and pg_temp.hint(pg_temp.iss(p_shop, q, 'deposit', null, null, null, p_actor)) = 'invoice_open');
  q2 := pg_temp.mkq(p_shop, 'quoted', 1000);
  r2 := pg_temp.iss(p_shop, q2, 'balance', null, null, null, p_actor);
  v := v || pg_temp.chk('I09b', 'ดีลมีใบ balance เปิดค้าง -> ออก balance ซ้ำถูกปฏิเสธ (invoice_open)', not pg_temp.rej(r2) and pg_temp.hint(pg_temp.iss(p_shop, q2, 'balance', null, null, null, p_actor)) = 'invoice_open');
  -- ต่างดีล ไม่กระทบกัน
  v := v || pg_temp.chk('I09c', 'ดีลอื่นไม่ถูกบล็อก (ด่านเปิดค้างเป็นรายดีล)', not pg_temp.rej(pg_temp.iss(p_shop, pg_temp.mkq(p_shop, 'quoted', 1000), 'balance', null, null, null, p_actor)));
  select invoice_no into t from analytics.oem_invoice where id = inv;
  n0 := (select coalesce(max(last_no), 0) from analytics.oem_doc_counter where shop_id = p_shop and doc_key = v_ivkey);
  r3 := pg_temp.vd(p_shop, inv, 'ทดสอบยกเลิก verify-0179', p_actor);
  r := pg_temp.iss(p_shop, q, 'deposit', null, null, null, p_actor);
  select invoice_no into t2 from analytics.oem_invoice where id = (r ->> 'id')::uuid;
  v := v || pg_temp.chk('I09d', 'void แล้วออกใหม่ได้ · เลขใหม่ไม่ซ้ำเลขเดิม (' || t || ' -> ' || coalesce(t2, '?') || ')',
    not pg_temp.rej(r3) and not pg_temp.rej(r) and t2 <> t and t2 = v_ivkey || '-' || lpad((n0 + 1)::text, 3, '0'));
  v := v || pg_temp.chk('I09e', 'ใบเก่า (void) ยังอยู่ในตาราง เลขคงเดิม · ใบ void ไม่นับเป็นเปิดค้าง',
    (select x.status = 'void' and x.invoice_no = t from analytics.oem_invoice x where x.id = inv));

  -- ==================== I10 replaces ====================
  q := pg_temp.mkq(p_shop, 'quoted', 1000);
  inv := (pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor) ->> 'id')::uuid;
  qa := pg_temp.mkq(p_shop, 'quoted', 1000);
  v := v || pg_temp.chk('I10a', 'replaces ชี้ใบที่ยัง issued (ดีลอื่นที่ไม่มีใบเปิดค้าง) ถูกปฏิเสธ (replaces_invalid) · ดีลเดียวกัน = ติดด่านเปิดค้างก่อน',
    pg_temp.hint(pg_temp.iss(p_shop, qa, 'balance', null, null, inv, p_actor)) = 'replaces_invalid'
    and pg_temp.hint(pg_temp.iss(p_shop, q, 'balance', null, null, inv, p_actor)) = 'invoice_open');
  r := pg_temp.vd(p_shop, inv, 'ทดสอบ replaces', p_actor);
  v := v || pg_temp.chk('I10b', 'replaces ชี้ใบ void ของ "คนละดีล" ถูกปฏิเสธ', pg_temp.hint(pg_temp.iss(p_shop, qa, 'balance', null, null, inv, p_actor)) = 'replaces_invalid');
  v := v || pg_temp.chk('I10c', 'replaces ชี้ใบที่ไม่มีอยู่ / null-uuid ของร้านอื่น ถูกปฏิเสธ',
    pg_temp.hint(pg_temp.iss(p_shop, q, 'balance', null, null, gen_random_uuid(), p_actor)) = 'replaces_invalid'
    and pg_temp.hint(pg_temp.iss(shop2, q, 'balance', null, null, inv, p_actor)) = 'quote_not_found');
  r2 := pg_temp.iss(p_shop, q, 'balance', null, null, inv, p_actor);
  v := v || pg_temp.chk('I10d', 'replaces ชี้ใบ void ของดีลเดียวกัน ผ่าน · เก็บ replaces_invoice_id', not pg_temp.rej(r2)
    and (select x.replaces_invoice_id = inv from analytics.oem_invoice x where x.id = (r2 ->> 'id')::uuid));
  -- I10e: "ใบที่ถูกแทนด้วยใบที่ยัง issued แล้ว แทนซ้ำไม่ได้" = ไม่มีเทสต์ครอบ: ใบแทนที่ issued คือใบเปิดค้างของดีลเอง จึงติดด่าน invoice_open ก่อนถึงด่าน replaces เสมอ
  --   (ด่าน replaces ส่วนนี้จะเข้าถึงได้เมื่อใบแทนถูกชำระ — หลัง 0180)

  -- ==================== I11 note / เหตุผล void ====================
  q := pg_temp.mkq(p_shop, 'quoted', 1000);
  b := true; v_bad := '';
  foreach t in array array[chr(8203), '....', 'a' || chr(1), chr(8238) || 'x', repeat('ก', 501)] loop
    r := pg_temp.iss(p_shop, q, 'balance', null, t, null, p_actor);
    if pg_temp.hint(r) <> 'note_invalid' then b := false; v_bad := v_bad || left(t, 3) || '/' || coalesce(r ->> '_hint', 'ผ่าน') || ' '; end if;
  end loop;
  v := v || pg_temp.chk('I11a', 'note: ล่องหน / วรรคตอนล้วน / control / bidi / >500 ถูกปฏิเสธ (note_invalid) ' || v_bad, b);
  r := pg_temp.iss(p_shop, q, 'balance', null, '   ', null, p_actor);
  v := v || pg_temp.chk('I11b', 'note เว้นวรรคล้วน = ไม่มีหมายเหตุ (null)', not pg_temp.rej(r) and (select x.note is null from analytics.oem_invoice x where x.id = (r ->> 'id')::uuid));
  inv := (r ->> 'id')::uuid;
  b := true; v_bad := '';
  foreach t in array array[chr(8203), '....', 'a' || chr(1), repeat('ก', 501), '   '] loop
    r := pg_temp.vd(p_shop, inv, t, p_actor);
    if pg_temp.hint(r) <> 'reason_invalid' then b := false; v_bad := v_bad || left(t, 3) || '/' || coalesce(r ->> '_hint', 'ผ่าน') || ' '; end if;
  end loop;
  v := v || pg_temp.chk('I11c', 'เหตุผล void: ล่องหน / วรรคตอนล้วน / control / >500 / เว้นวรรคล้วน ถูกปฏิเสธ (reason_invalid) ' || v_bad, b);
  v := v || pg_temp.chk('I11d', 'เหตุผล void = null ถูกปฏิเสธ · ใบยังเป็น issued', pg_temp.hint(pg_temp.vd(p_shop, inv, null, p_actor)) = 'reason_invalid'
    and (select status from analytics.oem_invoice where id = inv) = 'issued');
  v := v || pg_temp.chk('I11e', 'void โดยไม่มี actor ถูกปฏิเสธ (actor_required)', pg_temp.hint(pg_temp.vd(p_shop, inv, 'เหตุผลทดสอบ', null)) = 'actor_required');
  v := v || pg_temp.chk('I11f', 'void ข้ามร้าน (ร้านอื่นยิง id ใบนี้) ถูกปฏิเสธ (invoice_not_found)', pg_temp.hint(pg_temp.vd(shop2, inv, 'เหตุผลทดสอบ', p_actor)) = 'invoice_not_found');
  r := pg_temp.vd(p_shop, inv, 'เหตุผลทดสอบ verify-0179', p_actor);
  select * into ti from analytics.oem_invoice where id = inv;
  v := v || pg_temp.chk('I11g', 'void สำเร็จ: status/void_reason/voided_at/voided_by ครบ · void ซ้ำถูกปฏิเสธ (invoice_not_issued)',
    not pg_temp.rej(r) and ti.status = 'void' and ti.void_reason = 'เหตุผลทดสอบ verify-0179' and ti.voided_at is not null and ti.voided_by = p_actor
    and pg_temp.hint(pg_temp.vd(p_shop, inv, 'เหตุผลทดสอบ', p_actor)) = 'invoice_not_issued');

  -- ==================== I12 VAT ====================
  b := true; v_bad := '';
  foreach g in array gs loop
    r := pg_temp.iss(p_shop, pg_temp.mkq(p_shop, 'quoted', g, null, null, 'breakdown'), 'balance', null, null, null, p_actor);
    select * into ti from analytics.oem_invoice where id = (r ->> 'id')::uuid;
    if pg_temp.rej(r) or ti.vat_display <> 'breakdown' or ti.vat_base_thb <> round(g / 1.07, 2)
       or ti.vat_amount_thb <> g - round(g / 1.07, 2) or ti.vat_base_thb + ti.vat_amount_thb <> ti.amount_thb or ti.vat_rate <> 0.07 then
      b := false; v_bad := v_bad || g::text || ' ';
    end if;
  end loop;
  v := v || pg_temp.chk('I12a', 'ร้านจด VAT + breakdown: base + vat = amount เป๊ะ ทุกยอดที่หาร 1.07 ไม่ลงตัว (100 · 10001.01 · 33.33 · 1.01 · 99999.99) ' || v_bad, b);
  b := true; v_bad := '';
  foreach g in array gs loop
    r := pg_temp.iss(p_shop, pg_temp.mkq(p_shop, 'quoted', g, 'pct', 0.5), 'deposit', null, null, null, p_actor);
    select * into ti from analytics.oem_invoice where id = (r ->> 'id')::uuid;
    if pg_temp.rej(r) or ti.vat_base_thb + ti.vat_amount_thb <> ti.amount_thb or ti.vat_base_thb <> round(ti.amount_thb / 1.07, 2) then b := false; v_bad := v_bad || g::text || ' '; end if;
  end loop;
  v := v || pg_temp.chk('I12b', 'ใบมัดจำ (ยอดคี่) VAT ของยอดใบนี้ base + vat = amount เป๊ะ ' || v_bad, b);
  r := pg_temp.iss(p_shop, pg_temp.mkq(p_shop, 'quoted', 500, null, null, 'included'), 'balance', null, null, null, p_actor);
  select * into ti from analytics.oem_invoice where id = (r ->> 'id')::uuid;
  v := v || pg_temp.chk('I12c', 'vat_mode = included: vat_display = included · base+vat = amount',
    not pg_temp.rej(r) and ti.vat_display = 'included' and ti.vat_base_thb + ti.vat_amount_thb = ti.amount_thb and ti.vat_rate is not null);
  begin
    update analytics.oem_setting set seller_vat_registered = false where shop_id = p_shop;
    q := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5, 'breakdown');
    r := pg_temp.iss(p_shop, q, 'deposit', null, null, null, p_actor);
    select * into ti from analytics.oem_invoice where id = (r ->> 'id')::uuid;
    r2 := pg_temp.iss(p_shop, pg_temp.mkq(p_shop, 'quoted', 1000, null, null, 'included'), 'balance', null, null, null, p_actor);
    select * into vi2 from analytics.oem_invoice where id = (r2 ->> 'id')::uuid;
    b2 := not pg_temp.rej(r) and not pg_temp.rej(r2) and ti.vat_display = 'none' and ti.vat_rate is null and ti.vat_base_thb is null and ti.vat_amount_thb is null
      and ti.description !~* '(vat|ภาษี)' and ti.seller_snapshot ->> 'vat_registered' = 'false'
      and vi2.vat_display = 'none' and vi2.vat_rate is null and vi2.vat_base_thb is null and vi2.vat_amount_thb is null and vi2.description !~* '(vat|ภาษี)';
    raise exception 'rollback-test' using errcode = 'P0098';
  exception when sqlstate 'P0098' then null; end;
  v := v || pg_temp.chk('I12d', 'ร้านไม่จด VAT -> vat_display = none ทุกช่อง VAT เป็น null (ทั้ง breakdown/included) · description ไม่มีคำว่าภาษี/VAT', b2);

  -- ==================== I13 flow เต็ม ยอดคี่ ====================
  q := pg_temp.mkq(p_shop, 'quoted', 10001.01, 'pct', 0.5, 'breakdown');
  inv := (pg_temp.iss(p_shop, q, 'deposit', null, null, null, p_actor) ->> 'id')::uuid;
  r := pg_temp.rcpt(p_shop, q, 5000.51, 'deposit');
  select * into vi from analytics.v_oem_invoice where id = inv;
  v := v || pg_temp.chk('I13a', 'รับมัดจำแบบเดิม (ไม่อ้างใบ) -> ใบแจ้งหนี้เดิมเป็น is_stale (flow C) · payment_state ยัง unpaid',
    not pg_temp.rej(r) and vi.is_stale is true and vi.payment_state = 'unpaid');
  v := v || pg_temp.chk('I13b', 'ใบเก่าที่ stale ยังบล็อกการออกใบ balance จนกว่าจะ void (ลูกค้าไม่ถือสองยอด)', pg_temp.hint(pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor)) = 'invoice_open');
  r2 := pg_temp.vd(p_shop, inv, 'ลูกค้าโอนมัดจำแล้ว ออกใบคงเหลือแทน', p_actor);
  r3 := pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor);
  select * into ti from analytics.oem_invoice where id = (r3 ->> 'id')::uuid;
  v := v || pg_temp.chk('I13c', 'void แล้วออก balance = ยอดที่เหลือ 5000.50 · paid_before 5000.51 · ผลรวม = 10001.01 เป๊ะ',
    not pg_temp.rej(r2) and not pg_temp.rej(r3) and ti.amount_thb = 5000.50 and ti.paid_before_thb = 5000.51 and ti.balance_after_thb = 0
    and ti.paid_before_thb + ti.amount_thb + ti.balance_after_thb = ti.grand_total_snapshot and ti.grand_total_snapshot = 10001.01);
  r := pg_temp.rcpt(p_shop, q, 5000.50, 'final');
  v := v || pg_temp.chk('I13d', 'ใบเสร็จครบยอด -> v_oem_quote.is_fully_paid (ใบเสร็จเดิมทำงานเหมือนเดิม)',
    not pg_temp.rej(r) and (select vq.is_fully_paid from analytics.v_oem_quote vq where vq.id = q));
  v := v || pg_temp.chk('I13e', 'ผลรวมใบแจ้งหนี้ deposit(5000.51)+balance(5000.50) = ยอดรวม 10001.01 (ใบ void ของ deposit ยังเก็บยอดเดิม)',
    (select x.amount_thb from analytics.oem_invoice x where x.id = inv) + ti.amount_thb = 10001.01);

  -- ==================== I14 สถานะ derived ====================
  q := pg_temp.mkq(p_shop, 'quoted', 1000);
  inv := (pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor) ->> 'id')::uuid;
  select * into vi from analytics.v_oem_invoice where id = inv;
  v := v || pg_temp.chk('I14a', 'ใบใหม่: payment_state=unpaid · is_stale=false · is_overdue=false · active_quote_id = ใบที่ออก · quote_valid_until มีค่า · receipt_* เป็น null',
    vi.payment_state = 'unpaid' and vi.is_stale is false and vi.is_overdue is false and vi.active_quote_id = q and vi.quote_valid_until is not null
    and vi.receipt_id is null and vi.receipt_no is null and vi.received_date is null and vi.deal_quote_expired is false and vi.is_deal_active is true);
  begin
    update analytics.oem_quote set grand_total = 1100, pieces_subtotal = 1100 where id = q;
    select * into vi from analytics.v_oem_invoice where id = inv;
    b := vi.is_stale;
    raise exception 'rollback-test' using errcode = 'P0098';
  exception when sqlstate 'P0098' then null; end;
  v := v || pg_temp.chk('I14b', 'ต่อราคาหลังออกใบ (ยอดรวมของแถว active เปลี่ยน) -> is_stale = true', b is true);
  begin
    perform pg_temp.rcpt(p_shop, q, 100, 'partial');
    select * into vi from analytics.v_oem_invoice where id = inv;
    b := vi.is_stale;
    raise exception 'rollback-test' using errcode = 'P0098';
  exception when sqlstate 'P0098' then null; end;
  v := v || pg_temp.chk('I14c', 'รับเงินไปแล้วโดยไม่อ้างใบ (paid ของดีลเปลี่ยน) -> is_stale = true', b is true);
  inv2 := (pg_temp.iss(p_shop, pg_temp.mkq(p_shop, 'quoted', 1000), 'balance', null, null, null, p_actor) ->> 'id')::uuid;
  r := pg_temp.vd(p_shop, inv2, 'ทดสอบ state void', p_actor);
  select * into vi2 from analytics.v_oem_invoice where id = inv2;
  v := v || pg_temp.chk('I14d', 'ใบ void: payment_state = void · is_stale/is_overdue = false', vi2.payment_state = 'void' and vi2.is_stale is false and vi2.is_overdue is false);
  begin
    alter table analytics.oem_invoice disable trigger user;
    update analytics.oem_invoice set issue_date = v_today - 10, due_date = v_today - 3 where id = inv;
    select * into vi from analytics.v_oem_invoice where id = inv;
    b := vi.is_overdue;
    raise exception 'rollback-test' using errcode = 'P0098';
  exception when sqlstate 'P0098' then null; end;
  v := v || pg_temp.chk('I14e', 'ใบ balance เลย due_date -> is_overdue = true', b is true);
  q2 := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  inv2 := (pg_temp.iss(p_shop, q2, 'deposit', null, null, null, p_actor) ->> 'id')::uuid;
  begin
    alter table analytics.oem_invoice disable trigger user;
    update analytics.oem_invoice set issue_date = v_today - 10, due_date = v_today - 10 where id = inv2;
    select * into vi from analytics.v_oem_invoice where id = inv2;
    b := vi.is_overdue;
    update analytics.oem_invoice set due_date = v_today - 8 where id = inv2;
    select * into vi from analytics.v_oem_invoice where id = inv2;
    b2 := vi.is_overdue;
    raise exception 'rollback-test' using errcode = 'P0098';
  exception when sqlstate 'P0098' then null; end;
  v := v || pg_temp.chk('I14f', 'ใบมัดจำ due = issue ("ชำระก่อนเริ่มงาน") ไม่นับเลยกำหนด แม้ผ่านมา 10 วัน', b is false);
  v := v || pg_temp.chk('I14g', 'ใบมัดจำที่ส่ง due เองให้เลยวันออกแล้วเลยกำหนด -> is_overdue = true', b2 is true);
  qa := pg_temp.mkq(p_shop, 'quoted', 1000);
  inv2 := (pg_temp.iss(p_shop, qa, 'balance', null, null, null, p_actor) ->> 'id')::uuid;
  update analytics.oem_quote set status = 'superseded' where id = qa;
  qb := pg_temp.mkq(p_shop, 'expired', 1000, null, null, 'breakdown', true, qa);
  select * into vi from analytics.v_oem_invoice where id = inv2;
  v := v || pg_temp.chk('I14h', 'ต่อราคาแล้ว: active_quote_id ชี้ใบใหม่ของดีล · is_deal_active=false · deal_quote_expired=true (ใบ active หมดอายุ) · quote_status ของใบที่ออก = superseded',
    vi.active_quote_id = qb and vi.is_deal_active is false and vi.deal_quote_expired is true and vi.quote_status = 'superseded' and vi.deal_quote_status = 'expired');
  v := v || pg_temp.chk('I14i', 'ใบ active ของดีลที่ถูกต่อราคา ออก invoice ได้ (ใบเก่ายัง stale) · ด่านเปิดค้างนับทั้งดีล (ข้าม chain)',
    pg_temp.hint(pg_temp.iss(p_shop, qb, 'balance', null, null, null, p_actor)) = 'invoice_open');
  v := v || pg_temp.chk('I14j', 'ใบ stale ที่ยังไม่ void = invoice เปิดค้าง (is_stale จาก chain: ยอดรวมแถว active 1000 = ตอนออก 1000 ไม่ stale)', vi.is_stale is false);

  -- ==================== I15 immutability ====================
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  inv := (pg_temp.iss(p_shop, q, 'deposit', null, null, null, p_actor) ->> 'id')::uuid;
  t := pg_temp.x(format('update analytics.oem_invoice set amount_thb = 1 where id = %L', inv));
  v := v || pg_temp.chk('I15a', 'UPDATE คอลัมน์เนื้อหา (amount_thb) ตรงๆ ถูก trigger ปฏิเสธ ' || left(t, 60), t like 'ERR:22023:%');
  t := pg_temp.x(format('update analytics.oem_invoice set note = %L where id = %L', 'แก้', inv));
  v := v || pg_temp.chk('I15b', 'UPDATE note/due_date/payment_lines ตรงๆ ถูกปฏิเสธ',
    t like 'ERR:22023:%' and pg_temp.x(format('update analytics.oem_invoice set due_date = due_date + 1 where id = %L', inv)) like 'ERR:22023:%'
    and pg_temp.x(format('update analytics.oem_invoice set payment_lines = array[%L] where id = %L', 'x', inv)) like 'ERR:22023:%');
  t := pg_temp.x(format('delete from analytics.oem_invoice where id = %L', inv));
  v := v || pg_temp.chk('I15c', 'DELETE ตรงๆ ถูกปฏิเสธ · ใบยังอยู่', t like 'ERR:22023:%' and exists (select 1 from analytics.oem_invoice where id = inv));
  t := pg_temp.x('truncate analytics.oem_invoice');
  v := v || pg_temp.chk('I15d', 'TRUNCATE ถูกปฏิเสธ (ในฐานะ postgres) · ใบยังอยู่', t like 'ERR:22023:%' and exists (select 1 from analytics.oem_invoice where id = inv));
  execute 'set local role service_role';
  begin execute format('update analytics.oem_invoice set note = %L where id = %L', 'x', inv); t := 'OK'; exception when others then get stacked diagnostics st = returned_sqlstate; t := 'ERR:' || st; end;
  begin execute format('delete from analytics.oem_invoice where id = %L', inv); t2 := 'OK'; exception when others then get stacked diagnostics st = returned_sqlstate; t2 := 'ERR:' || st; end;
  begin execute 'truncate analytics.oem_invoice'; r := jsonb_build_object('t', 'OK'); exception when others then get stacked diagnostics st = returned_sqlstate; r := jsonb_build_object('t', 'ERR:' || st); end;
  begin execute format('insert into analytics.oem_invoice select * from analytics.oem_invoice where id = %L', inv); r2 := jsonb_build_object('t', 'OK'); exception when others then get stacked diagnostics st = returned_sqlstate; r2 := jsonb_build_object('t', 'ERR:' || st); end;
  begin execute format('select count(*) from analytics.oem_invoice where id = %L', inv); r3 := jsonb_build_object('t', 'OK'); exception when others then get stacked diagnostics st = returned_sqlstate; r3 := jsonb_build_object('t', 'ERR:' || st); end;
  reset role;
  v := v || pg_temp.chk('I15e', 'service_role: INSERT/UPDATE/DELETE/TRUNCATE ตรงๆ ถูกปฏิเสธ 42501 · SELECT ได้ (เขียนผ่าน RPC definer เท่านั้น)',
    t = 'ERR:42501' and t2 = 'ERR:42501' and r ->> 't' = 'ERR:42501' and r2 ->> 't' = 'ERR:42501' and r3 ->> 't' = 'OK');
  v := v || pg_temp.chk('I15f', 'UPDATE issued -> void ตรงๆ (4 คอลัมน์ void ครบ) ผ่าน trigger แต่ void -> issued (เปิดใบกลับ) ถูกปฏิเสธ',
    pg_temp.x(format('update analytics.oem_invoice set status = %L, void_reason = %L, voided_at = now(), voided_by = %L where id = %L', 'void', 'ทดสอบ', p_actor, inv)) = 'OK'
    and pg_temp.x(format('update analytics.oem_invoice set status = %L, void_reason = null, voided_at = null, voided_by = null where id = %L', 'issued', inv)) like 'ERR:22023:%');
  v := v || pg_temp.chk('I15g', 'void ที่ void ไปแล้ว แก้เหตุผลตรงๆ ถูกปฏิเสธ (ใบ void ก็แก้ไม่ได้)',
    pg_temp.x(format('update analytics.oem_invoice set void_reason = %L where id = %L', 'เปลี่ยนเหตุผล', inv)) like 'ERR:22023:%');
  v := v || pg_temp.chk('I15h', 'INSERT ตรงด้วยค่าผิดรูป (ยอดรวมไม่เท่า / VAT บวกไม่ลง / status void ไม่มีเหตุผล) ถูก CHECK ปฏิเสธ',
    pg_temp.x(format('insert into analytics.oem_invoice select (jsonb_populate_record(null::analytics.oem_invoice, to_jsonb(x) || jsonb_build_object(%L, gen_random_uuid(), %L, %L, %L, 1))).* from analytics.oem_invoice x where x.id = %L',
        'id', 'invoice_no', 'IV-9999-001', 'amount_thb', inv)) like 'ERR:23514:%'
    and pg_temp.x(format('insert into analytics.oem_invoice select (jsonb_populate_record(null::analytics.oem_invoice, to_jsonb(x) || jsonb_build_object(%L, gen_random_uuid(), %L, %L, %L, %L, %L, null))).* from analytics.oem_invoice x where x.id = %L',
        'id', 'invoice_no', 'IV-9999-002', 'status', 'void', 'void_reason', inv)) like 'ERR:23514:%');

  -- I15i: ขณะ void (issued -> void) แอบแก้คอลัมน์เนื้อหาพร้อมกัน ต้องถูก trigger (ด่าน jsonb diff) ปฏิเสธด้วย 22023 — ไม่ใช่หลุดไปตก CHECK (23514)
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  inv := (pg_temp.iss(p_shop, q, 'deposit', null, null, null, p_actor) ->> 'id')::uuid;
  v := v || pg_temp.chk('I15i', 'void พร้อมแก้ amount_thb/due_date/note ในคำสั่งเดียว ถูก trigger ปฏิเสธ 22023 (คอลัมน์อื่นนอก 4 ตัว void แก้ไม่ได้)',
    pg_temp.x(format('update analytics.oem_invoice set status = %L, void_reason = %L, voided_at = now(), voided_by = %L, amount_thb = 1 where id = %L', 'void', 'ทดสอบ', p_actor, inv)) like 'ERR:22023:%'
    and pg_temp.x(format('update analytics.oem_invoice set status = %L, void_reason = %L, voided_at = now(), voided_by = %L, note = %L where id = %L', 'void', 'ทดสอบ', p_actor, 'แอบแก้', inv)) like 'ERR:22023:%'
    and (select status from analytics.oem_invoice where id = inv) = 'issued');

  -- ==================== I16 snapshot / ไม่รั่วต้นทุน ====================
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  update analytics.oem_quote_item set sku_snapshot = 'TEST-SKU-1' where quote_id = q;
  inv := (pg_temp.iss(p_shop, q, 'deposit', null, 'ขอบคุณลูกค้า', null, p_actor) ->> 'id')::uuid;
  select * into ti from analytics.oem_invoice where id = inv;
  v := v || pg_temp.chk('I16a', 'lines_snapshot ทุก element มีคีย์ครบ 6 ตัวพอดี (seq,name,sku,qty,unit_price_thb,line_total_thb) ไม่มีคีย์อื่น',
    not exists (select 1 from jsonb_array_elements(ti.lines_snapshot) e
                 where (select array_agg(k order by k) from jsonb_object_keys(e) as ks(k)) is distinct from array['line_total_thb','name','qty','seq','sku','unit_price_thb']));
  v := v || pg_temp.chk('I16b', 'ค่าลับ (cost 777.77/888.88, approval_note, discount_reason, lost_reason) ไม่โผล่ในแถวตาราง/view/audit',
    to_jsonb(ti)::text !~ '(777\.77|888\.88|SECRET)' and (select to_jsonb(vv)::text !~ '(777\.77|888\.88|SECRET)' from analytics.v_oem_invoice vv where vv.id = inv)
    and not exists (select 1 from analytics.oem_quote_audit a where a.quote_id = q and a.after::text ~ '(777\.77|888\.88|SECRET)'));
  v := v || pg_temp.chk('I16c', 'ชื่อรายการ/ราคาใน snapshot มาจากรายการใบเสนอราคา · name ไม่ว่าง · sku ตามที่ snapshot',
    (ti.lines_snapshot -> 0 ->> 'name') = 'V179 สินค้าทดสอบ' and (ti.lines_snapshot -> 0 ->> 'sku') = 'TEST-SKU-1'
    and (ti.lines_snapshot -> 0 ->> 'unit_price_thb')::numeric = 1000 and (ti.lines_snapshot -> 0 ->> 'line_total_thb')::numeric = 1000);
  v := v || pg_temp.chk('I16d', 'seller_snapshot มีคีย์ตามกำหนดเท่านั้น (ไม่มี line/email/website/terms) · payment_lines = ช่องทางชำระของร้านตอนออก · buyer snapshot ครบ',
    (select array_agg(k order by k) from jsonb_object_keys(ti.seller_snapshot) as ks(k)) = array['address_lines','branch_label','display_name','legal_name','phone','tax_id','vat_registered']
    and ti.payment_lines = lines_ok and ti.buyer_legal_name = 'V179-ผู้ซื้อทดสอบ' and ti.quote_no_snapshot = (select quote_no from analytics.oem_quote where id = q)
    and ti.note = 'ขอบคุณลูกค้า');
  select md5(to_jsonb(x)::text) into t from analytics.oem_invoice x where x.id = inv;
  update analytics.oem_setting set seller_legal_name = 'เปลี่ยนชื่อหลังออกใบ', seller_payment_lines = array['TEST-ONLY เปลี่ยนบัญชีหลังออกใบ'] where shop_id = p_shop;
  update analytics.oem_customer set legal_name = 'เปลี่ยนชื่อผู้ซื้อหลังออกใบ' where id = (select customer_id from analytics.oem_quote where id = q);
  update analytics.oem_quote_item set product_name_snapshot = 'เปลี่ยนชื่อรายการหลังออกใบ' where quote_id = q;
  update analytics.oem_quote set quote_no = quote_no || 'x' where id = q;
  select md5(to_jsonb(x)::text) into t2 from analytics.oem_invoice x where x.id = inv;
  v := v || pg_temp.chk('I16e', 'แก้ผู้ขาย/ช่องทางชำระ/ผู้ซื้อ/รายการ/เลขใบเสนอราคา หลังออกใบ -> แถว invoice ไม่ขยับ (snapshot ตายตัว · พิมพ์ซ้ำได้เหมือนเดิม)', t = t2);
  update analytics.oem_setting set seller_payment_lines = lines_ok where shop_id = p_shop;

  -- ==================== I17 ตัวนับเลขเอกสาร ====================
  q := pg_temp.mkq(p_shop, 'quoted', 1000);
  rt0 := (select coalesce(md5(string_agg(doc_key || '=' || last_no, ',' order by doc_key)), '') from analytics.oem_doc_counter where doc_key like 'RT-%');
  n0 := (select coalesce(max(last_no), 0) from analytics.oem_doc_counter where shop_id = p_shop and doc_key = v_ivkey);
  r := pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor);
  inv := (r ->> 'id')::uuid;
  n1 := (select coalesce(max(last_no), 0) from analytics.oem_doc_counter where shop_id = p_shop and doc_key = v_ivkey);
  v := v || pg_temp.chk('I17a', 'ออกใบ: IV-YYMM last_no +1 พอดี · invoice_no = IV-YYMM-NNN (เวลาไทย) · ตัวนับ RT ไม่ขยับ',
    n1 = n0 + 1 and (select invoice_no from analytics.oem_invoice where id = inv) = v_ivkey || '-' || lpad(n1::text, 3, '0')
    and rt0 = (select coalesce(md5(string_agg(doc_key || '=' || last_no, ',' order by doc_key)), '') from analytics.oem_doc_counter where doc_key like 'RT-%'));
  r2 := pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor);
  n2 := (select coalesce(max(last_no), 0) from analytics.oem_doc_counter where shop_id = p_shop and doc_key = v_ivkey);
  v := v || pg_temp.chk('I17b', 'ออกไม่สำเร็จ (invoice_open) ไม่เผาเลข: last_no ไม่ขยับ', pg_temp.hint(r2) = 'invoice_open' and n2 = n1);
  r3 := pg_temp.vd(p_shop, inv, 'ทดสอบตัวนับ', p_actor);
  n2 := (select coalesce(max(last_no), 0) from analytics.oem_doc_counter where shop_id = p_shop and doc_key = v_ivkey);
  r := pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor);
  v := v || pg_temp.chk('I17c', 'void ไม่ขยับตัวนับ · ใบถัดไปได้ n+1 ไม่ reuse',
    not pg_temp.rej(r3) and not pg_temp.rej(r) and n2 = n1 and (select invoice_no from analytics.oem_invoice where id = (r ->> 'id')::uuid) = v_ivkey || '-' || lpad((n1 + 1)::text, 3,'0'));
  v := v || pg_temp.chk('I17d', 'ตัวนับ IV: UPDATE last_no +2 ตรงๆ ถูก trigger 0088 ปฏิเสธ (trigger คุม doc_key ใหม่ด้วย)',
    pg_temp.x(format('update analytics.oem_doc_counter set last_no = last_no + 2 where shop_id = %L and doc_key = %L', p_shop, v_ivkey)) like 'ERR:22023:%');
  v := v || pg_temp.chk('I17e', 'ตัวนับ IV: UPDATE ถอยหลัง / DELETE / เปลี่ยน doc_key ถูกปฏิเสธ',
    pg_temp.x(format('update analytics.oem_doc_counter set last_no = last_no - 1 where shop_id = %L and doc_key = %L', p_shop, v_ivkey)) like 'ERR:22023:%'
    and pg_temp.x(format('delete from analytics.oem_doc_counter where shop_id = %L and doc_key = %L', p_shop, v_ivkey)) like 'ERR:22023:%'
    and pg_temp.x(format('update analytics.oem_doc_counter set doc_key = %L where shop_id = %L and doc_key = %L', 'IV-0001', p_shop, v_ivkey)) like 'ERR:22023:%');
  v := v || pg_temp.chk('I17f', 'ตัวนับ: TRUNCATE ถูกปฏิเสธ', pg_temp.x('truncate analytics.oem_doc_counter') like 'ERR:22023:%');
  v := v || pg_temp.chk('I17g', 'แถวตัวนับ IV แยกจาก RT (doc_key ต่างกัน) และไม่มีแถว IV ที่ last_no <> จำนวนใบที่ออกในเดือน/ร้านเดียวกันเมื่อรวมใบทดสอบ',
    exists (select 1 from analytics.oem_doc_counter where shop_id = p_shop and doc_key = v_ivkey)
    and (select last_no from analytics.oem_doc_counter where shop_id = p_shop and doc_key = v_ivkey)
        = (select count(*) from analytics.oem_invoice where shop_id = p_shop and invoice_no like v_ivkey || '-%'));

  -- ==================== I18 role authenticated / anon (traps 18.5) ====================
  grant usage on schema analytics to authenticated, anon;
  b := true; v_bad := '';
  foreach t in array array['authenticated', 'anon'] loop
    execute format('set local role %I', t);
    begin perform analytics.oem_invoice_issue(null, null, null, null, null, null, null); t2 := 'OK'; exception when others then get stacked diagnostics st = returned_sqlstate; t2 := st; end;
    if t2 <> '42501' then b := false; v_bad := v_bad || t || '/issue=' || t2 || ' '; end if;
    begin perform analytics.oem_invoice_void(null, null, null, null); t2 := 'OK'; exception when others then get stacked diagnostics st = returned_sqlstate; t2 := st; end;
    if t2 <> '42501' then b := false; v_bad := v_bad || t || '/void=' || t2 || ' '; end if;
    begin perform analytics.oem_setting_set_payment_lines(null, null, null); t2 := 'OK'; exception when others then get stacked diagnostics st = returned_sqlstate; t2 := st; end;
    if t2 <> '42501' then b := false; v_bad := v_bad || t || '/setlines=' || t2 || ' '; end if;
    begin perform 1 from analytics.oem_invoice limit 1; t2 := 'OK'; exception when others then get stacked diagnostics st = returned_sqlstate; t2 := st; end;
    if t2 <> '42501' then b := false; v_bad := v_bad || t || '/table=' || t2 || ' '; end if;
    begin perform 1 from analytics.v_oem_invoice limit 1; t2 := 'OK'; exception when others then get stacked diagnostics st = returned_sqlstate; t2 := st; end;
    if t2 <> '42501' then b := false; v_bad := v_bad || t || '/view=' || t2 || ' '; end if;
    reset role;
  end loop;
  revoke usage on schema analytics from authenticated, anon;
  v := v || pg_temp.chk('I18a', 'authenticated/anon (จำลองวันที่กำแพงสคีมาหลุด): ยิง issue/void/setlines และ select ตาราง/view ตกที่ 42501 ทุกตัว ' || v_bad, b);

  -- ==================== I19 audit ====================
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  inv := (pg_temp.iss(p_shop, q, 'deposit', null, null, null, p_actor) ->> 'id')::uuid;
  r := pg_temp.vd(p_shop, inv, 'ทดสอบ audit', p_actor);
  v := v || pg_temp.chk('I19a', 'audit: ออก/ยกเลิกใบ มีแถว invoice_issue + invoice_void ตาม quote · actor = ผู้ทำรายการ',
    (select count(*) from analytics.oem_quote_audit a where a.quote_id = q and a.action = 'invoice_issue' and a.actor = p_actor) = 1
    and (select count(*) from analytics.oem_quote_audit a where a.quote_id = q and a.action = 'invoice_void' and a.actor = p_actor) = 1);
  v := v || pg_temp.chk('I19b', 'audit.after มีคีย์ invoice_id/invoice_no/kind/amount_thb เท่านั้น (ไม่มีเหตุผล void/ชื่อผู้ซื้อ/ช่องทางชำระ)',
    not exists (select 1 from analytics.oem_quote_audit a where a.quote_id = q and a.action in ('invoice_issue', 'invoice_void')
                 and (select array_agg(k order by k) from jsonb_object_keys(a.after) as ks(k)) is distinct from array['amount_thb','invoice_id','invoice_no','kind']));
  v := v || pg_temp.chk('I19c', 'audit append-only ยังคุมอยู่ (UPDATE/DELETE ถูกปฏิเสธ)',
    pg_temp.x(format('update analytics.oem_quote_audit set actor = null where quote_id = %L', q)) like 'ERR:%'
    and pg_temp.x(format('delete from analytics.oem_quote_audit where quote_id = %L', q)) like 'ERR:%');

  -- ==================== N19 ใบเสร็จเดิมทำงานเหมือนเดิม (ไม่มีใบแจ้งหนี้เกี่ยว) ====================
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  r := pg_temp.rcpt(p_shop, q, 500, 'deposit');
  v := v || pg_temp.chk('N19a', 'oem_receipt_issue 9 ค่าเดิม บนโคลนของใบจริง: ออกใบเสร็จได้ + quote พลิก won (พฤติกรรม 0088 เดิม)',
    not pg_temp.rej(r) and (select status from analytics.oem_quote where id = q) = 'won');
  v := v || pg_temp.chk('N19b', 'ใบเสร็จมี receipt_no รูป RT-YYMM-NNN และ is_fully_paid ยังเป็น false จนกว่าจะครบ',
    (select rr.receipt_no ~ '^RT-[0-9]{4}-[0-9]{3,}$' from analytics.oem_receipt rr where rr.id = (r ->> 'id')::uuid)
    and (select vq.is_fully_paid is false from analytics.v_oem_quote vq where vq.id = q));
  t := pg_temp.x(format('select analytics.oem_receipt_void(%L, %L, %L)', p_shop, r ->> 'id', 'ทดสอบ void ใบเสร็จ'));
  v := v || pg_temp.chk('N19c', 'oem_receipt_void ทำงานเหมือนเดิม (ไม่ถูก invoice กวน) · paid กลับเป็น 0', t = 'OK' and (select vq.paid_thb = 0 from analytics.v_oem_quote vq where vq.id = q));

  -- ==================== N20 ยิง RPC ใหม่ใส่ข้อมูลจริงทุกสถานะ/ทุกโหมด (โคลนทุกใบจริงบน DB) ====================
  n_real := 0; n0 := 0; n1 := 0; n2 := 0; v_bad := '';
  for rec in select q0.id, q0.quote_no, q0.status from analytics.oem_quote q0
              where q0.shop_id = p_shop and q0.quote_no not like 'V179-%' and q0.quote_no not like 'QA-%' order by q0.quote_no loop
    n_real := n_real + 1;
    qc := pg_temp.clone_real(rec.id);
    r := pg_temp.iss(p_shop, qc, 'deposit', null, null, null, p_actor);
    if not pg_temp.rej(r) then
      r2 := pg_temp.vd(p_shop, (r ->> 'id')::uuid, 'ทดสอบโคลนใบจริง', p_actor);
    end if;
    r3 := pg_temp.iss(p_shop, qc, 'balance', null, null, null, p_actor);
    if rec.status not in ('quoted', 'expired', 'won') then
      if pg_temp.hint(r) in ('quote_status_invalid', 'quote_superseded') and pg_temp.hint(r3) in ('quote_status_invalid', 'quote_superseded') then n1 := n1 + 1; else v_bad := v_bad || rec.quote_no || '(' || rec.status || ' ควรถูกปฏิเสธแต่ได้ ' || coalesce(r ->> '_hint', 'ผ่าน') || '/' || coalesce(r3 ->> '_hint', 'ผ่าน') || ') '; end if;
    else
      if (not pg_temp.rej(r) or (r ->> '_state') = '22023') and (not pg_temp.rej(r3) or (r3 ->> '_state') = '22023')
         and pg_temp.hint(r) not in ('totals_mismatch', 'grand_total_invalid', 'paid_invalid', 'vat_mode_invalid', 'vat_rate_invalid') and pg_temp.hint(r3) not in ('totals_mismatch', 'grand_total_invalid', 'paid_invalid', 'vat_mode_invalid', 'vat_rate_invalid')
      then
        if not pg_temp.rej(r) or not pg_temp.rej(r3) then n0 := n0 + 1; else n2 := n2 + 1; end if;
      else v_bad := v_bad || rec.quote_no || '(' || rec.status || ' ได้ ' || coalesce(r ->> '_state', 'ok') || ':' || coalesce(r ->> '_hint', '') || '/' || coalesce(r3 ->> '_state', 'ok') || ':' || coalesce(r3 ->> '_hint', '') || ') '; end if;
    end if;
    if rec.quote_no = 'OEM-2610-004' then
      v := v || pg_temp.chk('N20a', 'โคลนของใบจริง OEM-2610-004 (quoted · มีผู้ซื้อ · breakdown · มัดจำ pct): ออกใบมัดจำได้ · ใบ balance ถูกปฏิเสธ deposit_unpaid (ยังไม่รับมัดจำ)',
        not pg_temp.rej(r) and pg_temp.hint(r3) = 'deposit_unpaid');
    end if;
  end loop;
  if n_real = 0 then
    v := v || '[SKIP] N20  ไม่มีใบเสนอราคาจริงบน DB — พิสูจน์ "ยิงใส่ข้อมูลจริงทุกโหมด" ไม่ได้' || E'\n';
  else
    v := v || pg_temp.chk('N20', format('ยิง issue(deposit+balance) ใส่โคลนของใบจริงทุกใบ %s ใบ: ออกได้/ปฏิเสธด้วยด่านที่ถูกต้อง %s · ปฏิเสธเพราะสถานะ %s · ผิดคาด (CHECK/error อื่น): %s',
      n_real, n0, n1, coalesce(nullif(v_bad, ''), '(ไม่มี)')), v_bad = '' and n0 + n1 + n2 = n_real);
  end if;

  return v;
end;
$s$;

-- snapshot ของข้อมูลที่ไม่ควรขยับ (ตัวนับ/ใบเสร็จ/quote/ใบแจ้งหนี้/audit/ตั้งค่า/ผู้ซื้อ/รายการ/ร้าน)
create function pg_temp.snap() returns text language sql as $c$
  select concat_ws('|',
    (select coalesce(md5(string_agg(shop_id::text || doc_key || last_no::text, ',' order by shop_id, doc_key)), '') from analytics.oem_doc_counter),
    (select coalesce(md5(string_agg(to_jsonb(r)::text, ',' order by r.id)), '') from analytics.oem_receipt r),
    (select coalesce(md5(string_agg(q.id::text || q.status || coalesce(q.grand_total, 0)::text || q.updated_at::text, ',' order by q.id)), '') from analytics.oem_quote q),
    (select count(distinct updated_at)::text from analytics.oem_quote),
    (select count(*)::text from analytics.oem_invoice),
    (select count(*)::text from analytics.oem_quote_audit),
    (select coalesce(md5(string_agg(to_jsonb(s)::text, ',' order by s.shop_id)), '') from analytics.oem_setting s),
    (select count(*)::text from analytics.oem_customer),
    (select count(*)::text from analytics.oem_quote_item),
    (select count(*)::text from public.shop),
    (select coalesce(md5(string_agg(md5(pg_get_functiondef(p.oid)), '' order by p.oid::regprocedure::text)), '') from pg_proc p
      where p.pronamespace = 'analytics'::regnamespace and p.proname like 'job\_%'))
$c$;

-- นิยาม/สิทธิ์ของ object ใหม่ (ใช้พิสูจน์ว่า mutant ถูกคืนของเดิมครบ)
create function pg_temp.defs() returns text language sql as $c$
  select concat_ws('|',
    (select coalesce(md5(string_agg(md5(pg_get_functiondef(p.oid)) || coalesce(p.proacl::text, ''), '' order by p.oid::regprocedure::text)), '') from pg_proc p
      where p.pronamespace = 'analytics'::regnamespace
        and p.proname in ('oem_invoice_issue', 'oem_invoice_void', 'oem_setting_set_payment_lines', 'oem_invoice_deny_mutation', 'oem_invoice_deny_truncate')),
    md5(pg_get_viewdef('analytics.v_oem_invoice'::regclass)), md5(pg_get_viewdef('analytics.v_oem_seller'::regclass)),
    (select md5(coalesce(relacl::text, '')) from pg_class where oid = 'analytics.oem_invoice'::regclass),
    (select md5(coalesce(relacl::text, '')) from pg_class where oid = 'analytics.v_oem_invoice'::regclass),
    (select md5(string_agg(tgname || tgenabled::text, ',' order by tgname)) from pg_trigger where tgrelid = 'analytics.oem_invoice'::regclass and not tgisinternal))
$c$;

do $v179$
declare
  v_log   text := E'\n=== verify-0179 (ใบแจ้งหนี้ OEM I1) ===\n';
  v_shop  uuid;
  v_actor uuid;
  v_res   text;
  v_snap  text;
  v_defs  text;
  v_muts  jsonb;
  m       jsonb;
  v_def   text;
  v_mdef  text;
  e       text;
  v_killed boolean;
  v_nfail int;
  v_nok   int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select s.shop_id into v_shop from analytics.oem_setting s join analytics.oem_quote q on q.shop_id = s.shop_id and q.quote_no = 'OEM-2610-004' limit 1;
  select u.id into v_actor from auth.users u order by u.created_at limit 1;
  if v_shop is null or v_actor is null then
    raise exception E'[SKIP] ไม่มีร้าน/ใบแม่แบบ OEM-2610-004/ผู้ใช้ให้ทำ fixture — พิสูจน์ไม่ได้';
  end if;
  v_snap := pg_temp.snap();
  v_defs := pg_temp.defs();

  -- ---------- รอบแรก: ของจริง ----------
  begin
    v_res := pg_temp.suite(v_shop, v_actor);
    raise exception using errcode = 'P0099', message = v_res;
  exception
    when sqlstate 'P0099' then get stacked diagnostics v_res = message_text;
    when others then v_res := '[FAIL] SUITE-CRASH  ' || sqlerrm || E'\n';
  end;
  v_log := v_log || v_res;
  v_log := v_log || pg_temp.chk('Z1', 'หลังรอบแรก: ตัวนับ RT+IV · ใบเสร็จ · quote · ใบแจ้งหนี้ · audit · ตั้งค่า · ผู้ซื้อ · รายการ · ร้าน · job_* ไม่ขยับเลย (md5)', pg_temp.snap() = v_snap);

  -- ---------- mutant: แก้ของจริงใน subtransaction แล้วเรียก suite เดิม ต้องมีเคสที่ระบุล้มจริง ----------
  v_muts := $m$[
   {"id":"MU01","kind":"fn","target":"analytics.oem_invoice_issue(uuid,uuid,text,date,text,uuid,uuid)","from":"and vi.status = 'issued' and vi.payment_state = 'unpaid'","to":"and false","expect":["I09a","I09b"]},
   {"id":"MU02","kind":"fn","target":"analytics.oem_invoice_issue(uuid,uuid,text,date,text,uuid,uuid)","from":"p_due_date >= v_today and ","to":"","expect":["I04c","I04f"]},
   {"id":"MU03","kind":"fn","target":"analytics.oem_invoice_issue(uuid,uuid,text,date,text,uuid,uuid)","from":"v_quote.status not in ('quoted', 'expired', 'won')","to":"v_quote.status not in ('quoted', 'expired', 'won', 'lost')","expect":["I01a"]},
   {"id":"MU04","kind":"fn","target":"analytics.oem_invoice_issue(uuid,uuid,text,date,text,uuid,uuid)","from":"if v_paid_before <> 0 then","to":"if false then","expect":["I05b"]},
   {"id":"MU05","kind":"fn","target":"analytics.oem_invoice_issue(uuid,uuid,text,date,text,uuid,uuid)","from":"if cardinality(v_set.seller_payment_lines) = 0 then","to":"if false then","expect":["I07d"]},
   {"id":"MU06","kind":"fn","target":"analytics.oem_invoice_issue(uuid,uuid,text,date,text,uuid,uuid)","from":"v_vat_amount := v_amount - v_vat_base;","to":"v_vat_amount := round(v_amount * v_vat_rate, 2);","expect":["I12a"]},
   {"id":"MU07","kind":"fn","target":"analytics.oem_invoice_issue(uuid,uuid,text,date,text,uuid,uuid)","from":"last_no = c.last_no + 1","to":"last_no = c.last_no + 2","expect":["I04a","I17a"]},
   {"id":"MU08","kind":"fn","target":"analytics.oem_invoice_void(uuid,uuid,text,uuid)","from":"analytics.oem_note_present(p_reason)","to":"(btrim(p_reason) <> '')","expect":["I11c"]},
   {"id":"MU09","kind":"fn","target":"analytics.oem_invoice_deny_mutation()","from":"array['status', 'void_reason', 'voided_at', 'voided_by']","to":"array['status', 'void_reason', 'voided_at', 'voided_by', 'amount_thb']","expect":["I15i"]},
   {"id":"MU10","kind":"sql","sql":"drop trigger trg_oem_invoice_deny_mutation on analytics.oem_invoice","expect":["I15a","I15c"]},
   {"id":"MU12","kind":"fn","target":"analytics.oem_invoice_issue(uuid,uuid,text,date,text,uuid,uuid)","from":"'line_total_thb', i.item_total) order by i.seq)","to":"'line_total_thb', i.item_total, 'cost', i.cost_piece) order by i.seq)","expect":["I16a","I16b"]},
   {"id":"MU13","kind":"sql","sql":"grant execute on function analytics.oem_invoice_issue(uuid, uuid, text, date, text, uuid, uuid) to authenticated","expect":["I18a","A3"]},
   {"id":"MU14","kind":"sql","sql":"grant insert on analytics.oem_invoice to service_role","expect":["I15e","A3"]},
   {"id":"MU15","kind":"fn","target":"analytics.oem_setting_set_payment_lines(uuid,text[],uuid)","from":"analytics.oem_note_present(l)","to":"true","expect":["P8"]},
   {"id":"MU16","kind":"sql","sql":"drop trigger trg_oem_invoice_deny_truncate on analytics.oem_invoice","expect":["I15d"]}
  ]$m$::jsonb;

  for m in select * from jsonb_array_elements(v_muts) loop
    v_mdef := null;
    if m ->> 'kind' = 'fn' then
      v_def := pg_get_functiondef((m ->> 'target')::regprocedure);
      if position(m ->> 'from' in v_def) = 0 then
        v_log := v_log || pg_temp.chk(m ->> 'id', 'anchor ไม่พบในนิยามฟังก์ชัน (แก้ mutant ไม่ได้ = พิสูจน์ไม่ได้)', false);
        continue;
      end if;
      v_mdef := replace(v_def, m ->> 'from', m ->> 'to');
    elsif m ->> 'kind' = 'view' then
      v_def := pg_get_viewdef((m ->> 'target')::regclass);
      if position(m ->> 'from' in v_def) = 0 then
        v_log := v_log || pg_temp.chk(m ->> 'id', 'anchor ไม่พบในนิยาม view', false);
        continue;
      end if;
      v_mdef := 'create or replace view ' || (m ->> 'target') || ' with (security_invoker = true) as ' || replace(v_def, m ->> 'from', m ->> 'to');
    else
      v_mdef := m ->> 'sql';
    end if;
    begin
      execute v_mdef;
      v_res := pg_temp.suite(v_shop, v_actor);
      raise exception using errcode = 'P0099', message = v_res;
    exception
      when sqlstate 'P0099' then get stacked diagnostics v_res = message_text;
      when others then v_res := '[FAIL] MUTANT-CRASH ' || sqlerrm || E'\n';
    end;
    if v_res like '[FAIL] MUTANT-CRASH%' then v_log := v_log || '   ' || v_res; end if;
    v_killed := true;
    for e in select jsonb_array_elements_text(m -> 'expect') loop
      if position('[FAIL] ' || e || ' ' in v_res) = 0 then v_killed := false; v_log := v_log || '   mutant ' || (m ->> 'id') || ' ไม่ถูกจับโดยเคส ' || e || E'\n'; end if;
    end loop;
    v_log := v_log || pg_temp.chk(m ->> 'id', 'mutant ถูกจับ: เคส ' || (m -> 'expect')::text || ' ต้องล้มเมื่อ ' || coalesce(left(m ->> 'sql', 70), left(m ->> 'from', 70)), v_killed);
  end loop;

  v_log := v_log || pg_temp.chk('Z2', 'หลัง mutant ทั้งหมด: นิยามฟังก์ชัน/trigger/view/ACL ของ object ใหม่คืนเท่าเดิมเป๊ะ (md5)', pg_temp.defs() = v_defs);
  v_log := v_log || pg_temp.chk('Z3', 'หลัง mutant ทั้งหมด: ข้อมูล (ตัวนับ RT+IV · ใบเสร็จ · quote · ใบแจ้งหนี้ · audit · ตั้งค่า · job_*) ไม่ขยับ', pg_temp.snap() = v_snap);

  v_nfail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_nok := (length(v_log) - length(replace(v_log, '[OK]', ''))) / 4;
  v_log := v_log || format(E'\nสรุป: OK %s · FAIL %s %s\n', v_nok, v_nfail, case when v_nfail = 0 then '(ผ่านทั้งหมด)' else '🔴 มีเคสไม่ผ่าน' end);
  -- raise ปิดท้ายเสมอ = บังคับ rollback ทั้งก้อน (ผลทดสอบออกทาง message)
  raise exception '%', v_log;
end
$v179$;
