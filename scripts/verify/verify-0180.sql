-- scripts/verify/verify-0180.sql
-- ตรวจ supabase/migrations/0180_oem_invoice_receipt_link.sql (ใบแจ้งหนี้ OEM phase I2 + M1/M2/L1 ของ security 0179) หลัง apply
-- หรือ dry-run ก่อน apply:  cat supabase/migrations/0180_oem_invoice_receipt_link.sql scripts/verify/verify-0180.sql > tmp.sql แล้ว node scripts/run-sql.mjs tmp.sql (ไม่ใส่ --commit)
-- self-rolling-back (3j-migration-traps ข้อ 11): แตะตัวนับเลขเอกสาร/เอกสารภาษี ⇒ suite ทั้งชุดรันใน subtransaction ที่ถอยกลับเอง แล้ว raise exception ปิดท้ายเสมอ
-- ผลออกทาง error message · [FAIL] >= 1 = ไม่ผ่าน · [SKIP] = พิสูจน์ไม่ได้
-- 🔴 ไม่เผาเลข RT/IV จริง: ทุกการออกเอกสารอยู่ใน subtransaction ที่ rollback · ปิดท้ายตรวจ md5 ตัวนับ + ใบเสร็จ + ใบแจ้งหนี้ + quote + audit + ตั้งค่า ก่อน/หลังเท่าเดิม
-- 🔴 ไม่แตะใบจริง OEM-2610-004 / IV-2610-001 / ใบจริงใดๆ แม้ใน rollback: fixture = "โคลน" ใบจริง (V180-*) · อ่านใบจริงเพื่อโคลนเท่านั้น
-- 🔴 ไม่มีเลขบัญชี/ชื่อธนาคารจริงในไฟล์นี้: ช่องทางชำระที่ใช้ทดสอบเป็น "TEST-ONLY ... ห้ามใช้จริง" อยู่ใน tx ที่ rollback เท่านั้น
-- golden legacy: ฟังก์ชัน oem_receipt_issue 9 args เดิม (ลอกจาก pg_get_functiondef บน DB สดก่อน apply 0180 · md5 237152ff…) ถูกฝังไว้ด้านล่างเป็น
--   pg_temp.oem_receipt_issue_legacy (เฉพาะ session นี้) — ยิงอินพุตชุดเดียวกันเข้าทั้งตัวเดิมและตัวใหม่ (ไม่ส่ง invoice/actor) เทียบแถวใบเสร็จ/quote/ตัวนับ/ข้อความ error
-- เทสต์ใช้ชุดเดียวกันซ้ำ: รอบแรก = ของจริง ต้อง FAIL 0 · รอบถัดไป = mutant (แก้ฟังก์ชัน/trigger/view/grant/index จริงใน subtransaction แล้วเรียก suite เดิม
--   ต้องมีเคสที่ระบุล้มจริง) · ท้ายไฟล์ตรวจว่า mutant คืนของเดิมครบ (md5 ฟังก์ชัน/นิยาม view/ACL)
--
-- ============ ตารางแมป "ข้อในบรีฟ/design §9 -> เทสต์" ============
--  บรีฟ 1  oem_receipt.invoice_id + snapshot invoice_no · partial unique                        : A3 · L01 · L07a-L07g · MU14 MU15
--  บรีฟ 2  ผูกถูก (ยอดเท่า·ดีลเดียว) -> paid + ใบเสร็จมี invoice_no                              : L01a-L01g · L02a-L02e
--  บรีฟ 2  ปฏิเสธ: คนละร้าน / void / ดีลอื่น / ผูกซ้ำ / stale / ยอดต่าง 0.01 / ทศนิยมเกิน / kind ไม่แมป : L05a-L05m · MU01 MU02 MU03 MU04 MU05
--  บรีฟ 2  reissue ล็อกตัวที่ 6 (ใบเดิมอ้าง→ใบใหม่ต้องอ้างเดียวกัน · ใบเดิมไม่อ้าง→ต้องไม่อ้าง)       : L04a-L04e · MU06
--  บรีฟ 2  ไม่ส่ง invoice = พฤติกรรมเดิมเป๊ะ (golden เทียบ legacy: แถว/quote/ตัวนับ/error)             : G1a-G1d · G2 · G3 · N20 · MU17
--  บรีฟ 3  payment_state=paid · receipt_* · is_stale/is_overdue ไม่นับ paid · void ใบเสร็จ→unpaid  : L01 · L03a-L03d · L10a-L10c · MU07
--  บรีฟ 4  void ใบแจ้งหนี้ที่ paid ไม่ได้ · oem_receipt_void ไม่ต้องแตะ (md5 เท่าเดิม)                : L08a-L08c · X1a
--  บรีฟ 5  M1 audit ช่องทางชำระ (RPC + เขียนตรง + insert ตรง · ไม่ยิงเมื่อค่าไม่เปลี่ยน)               : P1-P9 · MU12 MU16
--  บรีฟ 6  M2 counter: service_role INSERT/UPDATE/DELETE/TRUNCATE ตรง→42501 · INSERT last_no≠1→22023 · RPC ออกเลขยังทำงานแม้ role=service_role : C1-C6 · MU10 MU11
--  บรีฟ 7  L1 actor ไม่ใช่สมาชิก/staff → 42501 · admin ผ่าน · null → actor_required                 : M1a-M1f · MU08 MU09
--  บรีฟ    grants: authenticated ไม่มี execute oem_receipt_issue · ฟังก์ชันใหม่ service_role เท่านั้น     : A2 · M1f · MU13
--  บรีฟ    ไม่มี overload (oem_receipt_issue เหลือ 1 signature 11 args)                               : A1
--  บรีฟ    ตัวนับ RT/IV ไม่ขยับ · state ไม่ขยับ                                                       : Z1 Z3 · ทุกเคส reject ใน L05 ตรวจ RT ไม่เผา
--  บรีฟ    ยิง RPC ใหม่ใส่ใบจริงทุกสถานะ/ทุกโหมด (โคลน) + OEM-2610-004 ผูกใบแจ้งหนี้มัดจำ 56,800     : N20 · N20a
--  บรีฟ    ฟังก์ชันที่ไม่ได้ตั้งใจแตะไม่ขยับ (md5) + 3 ฟังก์ชัน L1 = baseline + 2 บรรทัดเท่านั้น          : X1a-X1d
--  ไม่มีเทสต์ครอบ: (1) race 2 connection (ออกใบเสร็จอ้างใบเดียวกันพร้อมกัน · void ใบแจ้งหนี้ชนกับออกใบเสร็จ) — do-block ทรานแซกชันเดียวจำลอง lock ไม่ได้ (กันด้วย for update แถว quote+ใบแจ้งหนี้ + unique index L07)
--    (2) นาฬิกา UTC/BKK 00:00-07:00 จริง (now() คงที่ทั้ง tx) (3) PostgREST จริง/หน้าจอ/TS caller (อยู่ใน unit test ฝั่ง TS) (4) ทางเลือก backfill ก/ข — ไม่ backfill โดยออกแบบ (ดูหัวไฟล์ migration)
--    (5) เส้นทาง L1 ตรง auth.uid() ของ user จริงผ่าน PostgREST authenticated (ไม่มี execute) — จำลองได้แค่ ACL + 42501 (M1f)

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

create function pg_temp.vr(p_shop uuid, p_rid uuid, p_reason text) returns text
 language plpgsql as $c$
declare v_msg text; v_state text;
begin
  perform analytics.oem_receipt_void(p_shop, p_rid, p_reason);
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  return 'ERR:' || v_state || ':' || v_msg;
end;
$c$;

create function pg_temp.hint(j jsonb) returns text language sql as $c$ select coalesce(j ->> '_hint', '') $c$;
create function pg_temp.rej(j jsonb) returns boolean language sql as $c$ select j ? '_err' $c$;
create function pg_temp.st(j jsonb) returns text language sql as $c$ select coalesce(j ->> '_state', '') $c$;

create function pg_temp.iss(p_shop uuid, p_quote uuid, p_kind text, p_due date default null, p_note text default null,
                            p_repl uuid default null, p_actor uuid default null) returns jsonb
 language plpgsql as $c$
declare v uuid; v_msg text; v_state text; v_hint text;
begin
  v := (analytics.oem_invoice_issue(p_shop, p_quote, p_kind, p_due, p_note, p_repl, p_actor) ->> 'id')::uuid;
  return jsonb_build_object('id', v);
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
  return jsonb_build_object('_err', v_msg, '_state', v_state, '_hint', coalesce(v_hint, ''));
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
  return jsonb_build_object('_err', v_msg, '_state', v_state, '_hint', coalesce(v_hint, ''));
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
  return jsonb_build_object('_err', v_msg, '_state', v_state, '_hint', coalesce(v_hint, ''));
end;
$c$;

-- ออกใบเสร็จด้วยฟังก์ชัน "ใหม่" (11 args · named) -> {id} หรือ {_err,_state,_hint}
create function pg_temp.rc(p_shop uuid, p_quote uuid, p_amount numeric, p_kind text, p_inv uuid default null, p_actor uuid default null,
                           p_reissued uuid default null, p_date date default null, p_method text default null, p_ref text default null,
                           p_desc text default null, p_nodate boolean default false) returns jsonb
 language plpgsql as $c$
declare v uuid; v_msg text; v_state text; v_hint text;
begin
  v := analytics.oem_receipt_issue(p_shop_id => p_shop, p_quote_id => p_quote, p_amount_thb => p_amount,
         p_received_date => case when p_nodate then null else coalesce(p_date, (now() at time zone 'Asia/Bangkok')::date) end,
         p_kind => p_kind, p_payment_method => p_method, p_payment_ref => p_ref, p_description => p_desc,
         p_reissued_from => p_reissued, p_invoice_id => p_inv, p_actor_id => p_actor);
  return jsonb_build_object('id', v);
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
  return jsonb_build_object('_err', v_msg, '_state', v_state, '_hint', coalesce(v_hint, ''));
end;
$c$;

-- ออกใบเสร็จด้วยฟังก์ชัน "เดิม" 9 args (golden legacy ที่ฝังไว้ใน session นี้)
create function pg_temp.rcl(p_shop uuid, p_quote uuid, p_amount numeric, p_kind text, p_reissued uuid default null, p_date date default null,
                            p_method text default null, p_ref text default null, p_desc text default null, p_nodate boolean default false) returns jsonb
 language plpgsql as $c$
declare v uuid; v_msg text; v_state text;
begin
  v := pg_temp.oem_receipt_issue_legacy(p_shop, p_quote, p_amount,
         case when p_nodate then null else coalesce(p_date, (now() at time zone 'Asia/Bangkok')::date) end,
         p_kind, p_method, p_ref, p_desc, p_reissued);
  return jsonb_build_object('id', v);
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  return jsonb_build_object('_err', v_msg, '_state', v_state, '_hint', '');
end;
$c$;

-- ภาพแถวใบเสร็จที่ทำให้เทียบกันได้ (ตัด id/quote/เลขที่ออก · description ตัดเลขใบเสนอราคาออก)
create function pg_temp.rimg(p_id uuid) returns jsonb language sql as $c$
  select (to_jsonb(r) - array['id', 'quote_id', 'receipt_no', 'quote_no_snapshot', 'reissued_from_receipt_id'])
         || jsonb_build_object('description', replace(r.description, r.quote_no_snapshot, '#'), 'is_reissue', r.reissued_from_receipt_id is not null)
    from analytics.oem_receipt r where r.id = p_id
$c$;

create function pg_temp.qimg(p_id uuid) returns jsonb language sql as $c$
  select jsonb_build_object('status', q.status, 'updated_by', q.updated_by, 'touched', q.updated_at = now(), 'grand', q.grand_total) from analytics.oem_quote q where q.id = p_id
$c$;

-- ใบเสนอราคาทดสอบ: โคลนจากใบจริง OEM-2610-004 (แถว quote + ผู้ซื้อ + รายการ 1 แถว) แล้วทับด้วยค่าที่ต้องการ
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
  if v_tpl.id is null then raise exception 'verify-0180: ไม่พบใบแม่แบบ OEM-2610-004 — สร้าง fixture ไม่ได้'; end if;
  select * into v_item from analytics.oem_quote_item where quote_id = v_tpl.id order by seq limit 1;
  if p_with_cust then
    select * into v_cust from analytics.oem_customer where id = v_tpl.customer_id;
    v_cid := gen_random_uuid();
    insert into analytics.oem_customer select (jsonb_populate_record(null::analytics.oem_customer,
      to_jsonb(v_cust) || jsonb_build_object('id', v_cid, 'legal_name', 'V180-ผู้ซื้อทดสอบ', 'tax_id', null, 'branch_label', null))).*;
  end if;
  insert into analytics.oem_quote select (jsonb_populate_record(null::analytics.oem_quote,
    to_jsonb(v_tpl) || jsonb_build_object(
      'id', v_id, 'quote_no', 'V180-' || substr(v_id::text, 1, 8), 'status', p_status,
      'root_quote_id', coalesce(p_root, v_id), 'parent_quote_id', null, 'customer_id', v_cid,
      'grand_total', p_grand, 'pieces_subtotal', p_grand, 'quote_total', p_grand, 'nre_price', 0, 'discount_thb', 0,
      'deposit_mode', p_dep_mode, 'deposit_input', p_dep_input, 'vat_mode', p_vat_mode,
      'quote_valid_until', coalesce(p_valid, case when p_status = 'expired' then v_today - 5 else v_today + 30 end),
      'cost_piece', 888.88, 'approval_note', 'SECRET-APPROVAL', 'discount_reason', 'SECRET-DISC', 'lost_reason', 'SECRET-LOST'))).*;
  insert into analytics.oem_quote_item select (jsonb_populate_record(null::analytics.oem_quote_item,
    to_jsonb(v_item) || jsonb_build_object(
      'id', gen_random_uuid(), 'quote_id', v_id, 'seq', 1, 'qty', 1, 'price_per_piece', p_grand, 'item_total', p_grand,
      'cost_piece', 777.77, 'product_name_snapshot', 'V180 สินค้าทดสอบ', 'sku_snapshot', null))).*;
  return v_id;
end;
$c$;

-- โคลนใบจริงทั้งใบ (ทุกสถานะ/ทุกโหมดที่มีจริง) เป็นใบ V180-*
create function pg_temp.clone_real(p_real uuid) returns uuid
 language plpgsql as $c$
declare v_q analytics.oem_quote; v_id uuid := gen_random_uuid();
begin
  select * into v_q from analytics.oem_quote where id = p_real;
  insert into analytics.oem_quote select (jsonb_populate_record(null::analytics.oem_quote,
    to_jsonb(v_q) || jsonb_build_object('id', v_id, 'quote_no', 'V180-' || substr(v_id::text, 1, 8),
      'root_quote_id', v_id, 'parent_quote_id', null))).*;
  insert into analytics.oem_quote_item select (jsonb_populate_record(null::analytics.oem_quote_item,
    to_jsonb(i) || jsonb_build_object('id', gen_random_uuid(), 'quote_id', v_id))).*
    from analytics.oem_quote_item i where i.quote_id = p_real;
  return v_id;
end;
$c$;

-- ออกใบแจ้งหนี้ให้ใบทดสอบ -> uuid (null ถ้าถูกปฏิเสธ)
create function pg_temp.mkinv(p_shop uuid, p_quote uuid, p_kind text, p_actor uuid) returns uuid
 language sql as $c$ select (pg_temp.iss(p_shop, p_quote, p_kind, null, null, null, p_actor) ->> 'id')::uuid $c$;

-- insert ใบเสร็จตรง (โคลนจากแถวต้นแบบ ทับด้วย p_over) -> 'OK' หรือ 'ERR:<state>:<msg>' · ใช้ทดสอบกำแพงที่ตารางเองที่ทะลุ RPC
create function pg_temp.badins(p_src uuid, p_over jsonb) returns text
 language plpgsql as $c$
declare v_msg text; v_state text;
begin
  insert into analytics.oem_receipt select (jsonb_populate_record(null::analytics.oem_receipt,
    to_jsonb(r0) || jsonb_build_object('id', gen_random_uuid(), 'status', 'issued', 'void_reason', null, 'voided_at', null, 'voided_by', null) || p_over)).*
    from analytics.oem_receipt r0 where r0.id = p_src;
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  return 'ERR:' || v_state || ':' || v_msg;
end;
$c$;

-- ===== golden legacy: oem_receipt_issue 9 args เดิม (md5 237152ffe9b75961c522bbe7994a836a · pg_get_functiondef บน DB สดก่อน apply 0180 · 16 ต.ค. 69) =====
-- ฝังเป็นฟังก์ชันชั่วคราวของ session นี้ (pg_temp) ไว้เป็น "ตัวเทียบ" ว่า oem_receipt_issue ใหม่ (ไม่ส่ง invoice/actor) ทำงานเหมือนเดิมเป๊ะ — ห้ามแก้ข้อความด้านล่าง
CREATE FUNCTION pg_temp.oem_receipt_issue_legacy(p_shop_id uuid, p_quote_id uuid, p_amount_thb numeric, p_received_date date, p_kind text, p_payment_method text DEFAULT NULL::text, p_payment_ref text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_reissued_from uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'analytics', 'extensions', 'pg_temp'
AS $function$
declare
  v_quote analytics.oem_quote%rowtype;
  v_set analytics.oem_setting%rowtype;
  v_customer analytics.oem_customer%rowtype;
  v_bkk_today date;
  v_bkk_month_start date;
  v_reissued_from_received_date date; -- 0086: วันรับเงินของใบเดิมที่ถูก void (เฉพาะตอน reissue)
  v_reissued_from_amount_thb numeric; -- 0087: ยอดเงินของใบเดิม ต้องเท่ากับ p_amount_thb
  v_reissued_from_kind text; -- 0087: ประเภทรับเงินของใบเดิม ต้องเท่ากับ p_kind
  v_reissued_from_root_quote_id uuid; -- 0087: root deal ของใบเดิม ต้องเท่ากับดีลของใบใหม่
  v_reissued_from_buyer_tax_id text; -- 0088: เลขผู้เสียภาษีผู้ซื้อที่ snapshot ไว้บนใบเดิม ต้องเท่ากับ v_customer.tax_id ปัจจุบัน
  v_paid_before numeric;
  v_vat_base numeric;
  v_vat_amount numeric;
  v_description text;
  v_payment_ref text;
  v_seller_snapshot jsonb;
  v_doc_key text;
  v_no int;
  v_receipt_no text;
  v_receipt_id uuid;
begin
  if p_shop_id is null or p_quote_id is null then
    raise exception 'oem_receipt_issue: p_shop_id and p_quote_id are required';
  end if;
  -- range check แทน "<= 0" เดี่ยวๆ — บทเรียน 0083 (NaN > ทุกค่ารวม infinity)
  if p_amount_thb is null or not (p_amount_thb > 0 and p_amount_thb <= 100000000) then
    raise exception 'oem_receipt_issue: p_amount_thb must be a finite number > 0 and <= 100,000,000' using errcode = '22023';
  end if;
  if p_received_date is null then
    raise exception 'oem_receipt_issue: p_received_date is required';
  end if;
  if p_kind is null or p_kind not in ('deposit', 'partial', 'final') then
    raise exception 'oem_receipt_issue: p_kind must be deposit, partial, or final' using errcode = '22023';
  end if;
  if p_payment_method is not null and p_payment_method not in ('transfer', 'cash', 'other') then
    raise exception 'oem_receipt_issue: p_payment_method must be transfer, cash, other, or null' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  -- ยืนยันว่า p_reissued_from ต้องชี้ไปใบที่ถูก void ไปแล้วในร้านนี้เท่านั้น และยังไม่
  -- เคยถูก reissue ซ้ำมาก่อน — 0086: ดึง received_date · 0087: ดึง amount/kind/root
  -- 0088: เพิ่ม r.buyer_tax_id ของใบเดิม ใช้เทียบที่ gate ใหม่หลัง select v_customer
  -- — ล็อกตัวผู้ซื้อของ reissue เข้ากับ snapshot บนใบเดิม กัน oem_quote_set_billing
  -- แก้ผู้ซื้อทับก่อน reissue
  if p_reissued_from is not null then
    select r.received_date, r.amount_thb, r.kind, coalesce(oq.root_quote_id, oq.id), r.buyer_tax_id
      into v_reissued_from_received_date, v_reissued_from_amount_thb, v_reissued_from_kind, v_reissued_from_root_quote_id, v_reissued_from_buyer_tax_id
      from analytics.oem_receipt r
      join analytics.oem_quote oq on oq.id = r.quote_id and oq.shop_id = r.shop_id
     where r.id = p_reissued_from and r.shop_id = p_shop_id and r.status = 'void';
    if not found then
      raise exception 'oem_receipt_issue: p_reissued_from ต้องชี้ไปใบเสร็จที่ถูกยกเลิก (void) แล้วในร้านนี้เท่านั้น' using errcode = '22023';
    end if;
    if exists (
      select 1 from analytics.oem_receipt
       where reissued_from_receipt_id = p_reissued_from and status = 'issued'
    ) then
      raise exception 'oem_receipt_issue: ใบเสร็จ % ถูก reissue ไปแล้ว ออกซ้ำอีกใบไม่ได้', p_reissued_from using errcode = '22023';
    end if;
  end if;

  -- timezone ไทย เสมอ — DB เป็น UTC ก่อน 07:00 ไทยจะเหลื่อมวัน
  v_bkk_today := (now() at time zone 'Asia/Bangkok')::date;
  v_bkk_month_start := date_trunc('month', v_bkk_today)::date;

  -- for update: กันสอง request ออกใบพร้อมกันแล้วอ่านสถานะ/paid เก่าทั้งคู่
  select * into v_quote
    from analytics.oem_quote
   where id = p_quote_id and shop_id = p_shop_id
   for update;
  if not found then
    raise exception 'oem_receipt_issue: quote % not found for this shop', p_quote_id;
  end if;

  -- 0087 §1: reissue ต้องผูกกับใบเดิมครบ 4 อย่าง (วันที่ + ยอดเงิน/kind/ดีล)
  -- ด่าน "ดีลเดียวกัน" ต้องอยู่ตรงนี้ (หลัง select v_quote for update) เพราะต้องใช้
  -- v_quote.root_quote_id ซึ่งยังไม่ถูกโหลด ณ จุดตรวจ p_reissued_from ด้านบน
  if p_reissued_from is not null then
    if p_amount_thb is distinct from v_reissued_from_amount_thb then
      raise exception 'oem_receipt_issue: reissue ต้องใช้ยอดเงินเดียวกับใบเดิมที่ถูกยกเลิกเท่านั้น (ใบเดิม % ยอด % บาท ใบใหม่ที่ขอออก % บาท) — ถ้ายอดเปลี่ยนไม่ใช่ reissue ของใบเดิมแล้ว ให้ออกใบใหม่ตามปกติโดยไม่ระบุ p_reissued_from',
        p_reissued_from, round(v_reissued_from_amount_thb, 2), round(p_amount_thb, 2)
        using errcode = '22023';
    end if;
    if p_kind is distinct from v_reissued_from_kind then
      raise exception 'oem_receipt_issue: reissue ต้องใช้ประเภทการรับเงิน (kind) เดียวกับใบเดิมที่ถูกยกเลิกเท่านั้น (ใบเดิม % เป็น "%" ใบใหม่ที่ขอออกเป็น "%")',
        p_reissued_from, v_reissued_from_kind, p_kind
        using errcode = '22023';
    end if;
    if coalesce(v_quote.root_quote_id, v_quote.id) is distinct from v_reissued_from_root_quote_id then
      raise exception 'oem_receipt_issue: reissue ต้องออกให้ดีลเดียวกับใบเดิมที่ถูกยกเลิกเท่านั้น — ใบเสนอราคา (p_quote_id) ที่ส่งมาอยู่คนละดีลกับใบเดิม % ห้ามใช้ reissue เป็นช่องทางออกใบให้ดีลอื่น',
        p_reissued_from
        using errcode = '22023';
    end if;
  end if;

  -- §4: ออกใบเสร็จได้เฉพาะใบสถานะ quoted/expired/won
  if v_quote.status not in ('quoted', 'expired', 'won') then
    raise exception 'oem_receipt_issue: ออกใบเสร็จได้เฉพาะใบสถานะ quoted, expired หรือ won เท่านั้น (ใบนี้สถานะ %) — ถ้าใบนี้ถูกต่อราคาไปแล้ว ให้ใช้ quote_id ของใบล่าสุดในดีลนี้แทน', v_quote.status
      using errcode = '22023';
  end if;
  if v_quote.grand_total is null then
    raise exception 'oem_receipt_issue: ใบเสนอราคานี้ยังไม่มียอดรวม (grand_total) — ข้อมูลผิดปกติ ติดต่อทีมพัฒนา';
  end if;

  -- §9: gate ข้อมูลผู้ขาย
  select * into v_set from analytics.oem_setting where shop_id = p_shop_id;
  if v_set.shop_id is null or not coalesce(v_set.seller_vat_registered, false) then
    raise exception 'oem_receipt_issue: ร้านยังไม่ได้ติ๊กสถานะจดทะเบียน VAT (ตั้งค่า > ข้อมูลร้าน) ออกใบเสร็จ/ใบกำกับภาษีไม่ได้จนกว่าจะติ๊กสถานะนี้ก่อน' using errcode = '22023';
  end if;
  if nullif(btrim(v_set.seller_legal_name), '') is null then
    raise exception 'oem_receipt_issue: ยังไม่ได้กรอกชื่อนิติบุคคลของร้าน (ตั้งค่า > ข้อมูลร้าน) — เอกสารภาษีต้องมีชื่อผู้ขายก่อนออกใบ' using errcode = '22023';
  end if;
  if nullif(btrim(v_set.seller_tax_id), '') is null then
    raise exception 'oem_receipt_issue: ยังไม่ได้กรอกเลขผู้เสียภาษีของร้าน (ตั้งค่า > ข้อมูลร้าน) — เอกสารภาษีต้องมีเลขผู้เสียภาษีของผู้ขายก่อนออกใบ' using errcode = '22023';
  end if;
  if v_set.seller_address_lines is null or jsonb_array_length(v_set.seller_address_lines) = 0 then
    raise exception 'oem_receipt_issue: ยังไม่ได้กรอกที่อยู่ของร้าน (ตั้งค่า > ข้อมูลร้าน) — เอกสารภาษีต้องมีที่อยู่ผู้ขายก่อนออกใบ' using errcode = '22023';
  end if;

  -- §9: gate ข้อมูลผู้ซื้อ
  if v_quote.customer_id is null then
    raise exception 'oem_receipt_issue: ใบนี้ยังไม่ได้ผูกข้อมูลผู้ซื้อ (ชื่อออกบิล/ที่อยู่) — ตั้งค่าก่อนออกใบเสร็จ' using errcode = '22023';
  end if;
  select * into v_customer from analytics.oem_customer where id = v_quote.customer_id and shop_id = p_shop_id;
  if not found or nullif(btrim(v_customer.legal_name), '') is null then
    raise exception 'oem_receipt_issue: ข้อมูลผู้ซื้อของใบนี้ยังไม่มีชื่อนิติบุคคล/ชื่อผู้ซื้อ — ตั้งค่าก่อนออกใบเสร็จ' using errcode = '22023';
  end if;

  -- 0088 §2: reissue ต้องเป็นผู้ซื้อรายเดิม (เทียบเลขผู้เสียภาษี) เท่านั้น —
  -- oem_quote_set_billing UPDATE แถว oem_customer เดิมทับตรงๆ ไม่ได้สร้างแถวใหม่
  -- แปลว่าระหว่างช่วง void ใบเดิม -> reissue ใบใหม่ เจ้าของ/แอดมินสามารถแก้ผู้ซื้อ
  -- ของดีลนี้เป็นคนละรายได้ผ่าน server action ปกติ ถ้าไม่ล็อกจุดนี้ reissue จะกลาย
  -- เป็นทางเดียวที่เหลือให้ออกใบกำกับภาษีย้อนงวดภาษีในชื่อใครก็ได้ (ด่านยอด/kind/
  -- ดีล/วันที่ของ 0087 ผ่านหมดเพราะเป็นดีลเดียวกันจริง)
  -- เทียบกับ snapshot buyer_tax_id บนใบเดิม ไม่ใช่ customer_id เพราะ customer_id
  -- เป็นแถวเดียวกันตลอดในเคสนี้ (ช่องโหว่คือเนื้อในแถวถูกแก้ทับ ไม่ใช่ FK เปลี่ยน)
  -- ล็อกเฉพาะ tax_id ตัวเดียว ไม่ล็อกทั้งก้อน — แก้ชื่อ/ที่อยู่/สาขาที่พิมพ์ผิดยัง
  -- ทำได้ผ่าน reissue เหมือนเดิม และ null -> null ผ่าน (บุคคลธรรมดา)
  if p_reissued_from is not null then
    if nullif(btrim(v_customer.tax_id), '') is distinct from nullif(btrim(v_reissued_from_buyer_tax_id), '') then
      raise exception 'oem_receipt_issue: reissue ต้องออกให้ผู้ซื้อรายเดิมเท่านั้น (ใบเดิม % ผูกผู้ซื้อเลขผู้เสียภาษี "%" แต่ข้อมูลผู้ซื้อปัจจุบันของดีลนี้เป็นเลขผู้เสียภาษี "%") — ถ้าผู้ซื้อเปลี่ยนจริง ต้องออกใบใหม่ตามปกติโดยไม่ระบุ p_reissued_from ไม่ใช่ reissue ใบเดิม',
        p_reissued_from, coalesce(v_reissued_from_buyer_tax_id, '(บุคคลธรรมดา/ไม่มีเลขผู้เสียภาษี)'), coalesce(v_customer.tax_id, '(บุคคลธรรมดา/ไม่มีเลขผู้เสียภาษี)')
        using errcode = '22023';
    end if;
  end if;

  -- 0086 §1(ค): ผู้ซื้อมี tax_id (= นิติบุคคล = ใบกำกับภาษีเต็มรูปตาม ป.รัษฎากร
  -- ม.86/4) ต้องมีที่อยู่และสาขาครบก่อนออกใบได้
  if nullif(btrim(v_customer.tax_id), '') is not null then
    if v_customer.address is null
       or jsonb_typeof(v_customer.address) <> 'object'
       or nullif(btrim(v_customer.address->>'line1'), '') is null
       or nullif(btrim(v_customer.address->>'subdistrict'), '') is null
       or nullif(btrim(v_customer.address->>'district'), '') is null
       or nullif(btrim(v_customer.address->>'province'), '') is null
       or nullif(btrim(v_customer.address->>'postalCode'), '') is null
    then
      raise exception 'oem_receipt_issue: ผู้ซื้อมีเลขผู้เสียภาษี (นิติบุคคล) ต้องกรอกที่อยู่ให้ครบก่อนออกใบกำกับภาษีเต็มรูป (บรรทัด 1, ตำบล/แขวง, อำเภอ/เขต, จังหวัด, รหัสไปรษณีย์) — ไปที่ปุ่ม "ผูกข้อมูลผู้ซื้อ" ของใบเสนอราคานี้แล้วกรอกที่อยู่ให้ครบ' using errcode = '22023';
    end if;
    if nullif(btrim(v_customer.branch_label), '') is null then
      raise exception 'oem_receipt_issue: ผู้ซื้อมีเลขผู้เสียภาษี (นิติบุคคล) ต้องกรอกสาขา (สำนักงานใหญ่ หรือ สาขาที่ ...) ก่อนออกใบกำกับภาษีเต็มรูป — ไปที่ปุ่ม "ผูกข้อมูลผู้ซื้อ" ของใบเสนอราคานี้แล้วกรอกสาขาให้ครบ' using errcode = '22023';
    end if;
  end if;

  -- §6: paid ระดับ deal — sum ทุกใบเสร็จ issued ใน chain เดียวกันผ่าน root_quote_id
  select coalesce(sum(r.amount_thb), 0) into v_paid_before
    from analytics.oem_receipt r
    join analytics.oem_quote rq on rq.id = r.quote_id
   where rq.root_quote_id = coalesce(v_quote.root_quote_id, v_quote.id)
     and r.status = 'issued';

  -- §6: กันจ่ายเกิน
  if round(v_paid_before + p_amount_thb, 2) > round(v_quote.grand_total, 2) then
    raise exception 'oem_receipt_issue: ยอดรับเงินรวม % บาท (สะสมแล้ว % + ครั้งนี้ %) เกินยอดรวมใบเสนอราคาทั้งดีล (% บาท) — รับเงินเกินยอดไม่ได้',
      round(v_paid_before + p_amount_thb, 2), round(v_paid_before, 2), round(p_amount_thb, 2), round(v_quote.grand_total, 2)
      using errcode = '22023';
  end if;

  if p_received_date > v_bkk_today then
    raise exception 'oem_receipt_issue: วันที่รับเงิน (%) เป็นวันในอนาคตไม่ได้ (วันนี้ตามเวลาไทยคือ %)', p_received_date, v_bkk_today
      using errcode = '22023';
  end if;

  -- 0086 §3: เปิดข้อยกเว้นเฉพาะ reissue ที่ received_date ตรงกับใบเดิมเป๊ะเท่านั้น
  -- 0087: "เป็น reissue" ถูกผูกเพิ่มกับยอดเงิน/kind/ดีลของใบเดิมแล้ว
  -- 0088: และตอนนี้ยังถูกผูกเพิ่มกับตัวผู้ซื้อ (tax_id) ของใบเดิมด้วย (gate ด้านบน)
  -- ปิดช่องทางลัดย้อนงวดภาษีในชื่อผู้ซื้อรายอื่นที่เหลืออยู่
  if p_reissued_from is not null then
    if p_received_date is distinct from v_reissued_from_received_date then
      raise exception 'oem_receipt_issue: reissue ต้องใช้วันที่รับเงินเดียวกับใบเดิมที่ถูกยกเลิกเท่านั้น (ใบเดิม % รับเงินวันที่ %) — วันที่รับเงินคือ tax point จริง เปลี่ยนวันที่ตอน reissue ไม่ได้', p_reissued_from, v_reissued_from_received_date
        using errcode = '22023';
    end if;
    -- received_date ตรงกับใบเดิมแล้ว = ไม่ใช่การย้อนงวดภาษีใหม่ ข้ามด่านงวดภาษีปกติ
  elsif p_received_date < v_bkk_month_start then
    raise exception 'oem_receipt_issue: วันที่รับเงิน (%) อยู่คนละงวดภาษีกับวันนี้ (เอกสารนี้จะออกในงวดเดือน %) — ออกย้อนหลังข้ามเดือนไม่ได้ ถ้าจำเป็นต้องบันทึกรับเงินของเดือนก่อน ให้ปรึกษาฝ่ายบัญชีก่อนดำเนินการ',
      p_received_date, to_char(v_bkk_today, 'YYYY-MM')
      using errcode = '22023';
  end if;

  -- ---- ผ่านทุกด่านแล้ว — คำนวณ + snapshot ----
  v_vat_base := round(p_amount_thb / (1 + v_quote.vat_rate), 2);
  v_vat_amount := p_amount_thb - v_vat_base;

  v_description := left(nullif(btrim(p_description), ''), 500);
  if v_description is null then
    v_description := case p_kind
      when 'deposit' then 'เงินมัดจำงาน OEM ตามใบเสนอราคา ' || v_quote.quote_no
      when 'partial' then 'ชำระเงินบางส่วนงาน OEM ตามใบเสนอราคา ' || v_quote.quote_no
      when 'final' then 'ชำระเงินงวดสุดท้ายงาน OEM ตามใบเสนอราคา ' || v_quote.quote_no
    end;
  end if;
  v_payment_ref := left(nullif(btrim(p_payment_ref), ''), 128);

  v_seller_snapshot := jsonb_build_object(
    'legal_name', v_set.seller_legal_name,
    'display_name', v_set.seller_display_name,
    'branch_label', v_set.seller_branch_label,
    'address_lines', v_set.seller_address_lines,
    'tax_id', v_set.seller_tax_id,
    'phone', v_set.seller_phone
  );

  -- §3: ออกเลขที่เอกสาร — counter row lock ภายใน transaction เดียวกับ insert
  -- 0088: ON CONFLICT DO UPDATE นี้ยิงเป็น UPDATE ที่ new.last_no = old.last_no + 1
  -- พอดี ผ่าน trg_oem_doc_counter_deny_mutation (§1) เสมอ ไม่ต้องแก้บรรทัดนี้
  v_doc_key := 'RT-' || to_char(v_bkk_today, 'YYMM');
  insert into analytics.oem_doc_counter as c (shop_id, doc_key, last_no)
  values (p_shop_id, v_doc_key, 1)
  on conflict (shop_id, doc_key) do update set last_no = c.last_no + 1
  returning last_no into v_no;
  v_receipt_no := v_doc_key || '-' || lpad(v_no::text, 3, '0');

  v_receipt_id := gen_random_uuid();
  insert into analytics.oem_receipt (
    id, shop_id, quote_id, receipt_no, kind, status,
    amount_thb, vat_rate, vat_base_thb, vat_amount_thb,
    received_date, issue_date, payment_method, payment_ref, description,
    seller_snapshot, buyer_legal_name, buyer_tax_id, buyer_branch_label, buyer_address,
    quote_no_snapshot, grand_total_snapshot, paid_before_thb, balance_after_thb,
    reissued_from_receipt_id, created_by
  ) values (
    v_receipt_id, p_shop_id, p_quote_id, v_receipt_no, p_kind, 'issued',
    p_amount_thb, v_quote.vat_rate, v_vat_base, v_vat_amount,
    p_received_date, v_bkk_today, p_payment_method, v_payment_ref, v_description,
    v_seller_snapshot, v_customer.legal_name, v_customer.tax_id, v_customer.branch_label, v_customer.address,
    v_quote.quote_no, v_quote.grand_total, v_paid_before, (v_quote.grand_total - (v_paid_before + p_amount_thb)),
    p_reissued_from, auth.uid()
  );

  -- คำสั่งเจ้าของข้อ 2: รับมัดจำ = รับงาน — ใบยังไม่ won ก็พลิกเป็น won ทันที
  if v_quote.status <> 'won' then
    update analytics.oem_quote
       set status = 'won', updated_by = auth.uid(), updated_at = now()
     where id = p_quote_id and shop_id = p_shop_id;
  end if;

  return v_receipt_id;
end;
$function$;


create function pg_temp.suite(p_shop uuid, p_actor uuid) returns text
 language plpgsql as $s$
declare
  v        text := '';
  v_today  date := (now() at time zone 'Asia/Bangkok')::date;
  v_ivkey  text := 'IV-' || to_char((now() at time zone 'Asia/Bangkok')::date, 'YYMM');
  v_rtkey  text := 'RT-' || to_char((now() at time zone 'Asia/Bangkok')::date, 'YYMM');
  lines_ok text[] := array['TEST-ONLY บัญชีทดสอบ 000-0-00000-0 (ห้ามใช้จริง)', 'TEST-ONLY พร้อมเพย์ทดสอบ 0000000000 (ห้ามใช้จริง)'];
  r jsonb; r2 jsonb; r3 jsonb; t text; t2 text; st text;
  q uuid; q2 uuid; qa uuid; qb uuid; qc uuid;
  inv uuid; inv2 uuid; inv3 uuid; rid uuid; rid2 uuid;
  vi record; vi2 record;
  n0 int; n1 int; n2 int; n3 int;
  c0 text; c1 text;
  b boolean; b2 boolean; b3 boolean;
  shop2 uuid; v_bad text; v_cnt0 text;
  rec record;
  v_actor2 uuid; v_other uuid;
  v_img1 jsonb; v_img2 jsonb; v_q1 jsonb; v_q2 jsonb;
  sc record;
  v_cnt_aud int;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  -- ช่องทางชำระทดสอบ (ใน subtransaction เท่านั้น — ของจริงของเจ้าของไม่ถูกแตะเพราะ rollback) · ปิด audit trigger ไม่ได้ตั้งใจ: ให้ยิงตามจริง
  update analytics.oem_setting set seller_payment_lines = lines_ok where shop_id = p_shop;
  insert into public.shop (name) values ('verify0180-shop2') returning id into shop2;
  select u.id into v_other from auth.users u where u.id <> p_actor order by u.created_at limit 1;

  -- ==================== A. โครงสร้าง / สิทธิ์ ====================
  v := v || pg_temp.chk('A1', 'oem_receipt_issue เหลือ signature เดียว 11 args (ลำดับ/ชื่อเดิม 9 ตัว + p_invoice_id + p_actor_id) · ไม่มี overload (traps ข้อ 1)',
    (select count(*) = 1 from pg_proc where pronamespace = 'analytics'::regnamespace and proname = 'oem_receipt_issue')
    and (select proargnames = array['p_shop_id','p_quote_id','p_amount_thb','p_received_date','p_kind','p_payment_method','p_payment_ref','p_description','p_reissued_from','p_invoice_id','p_actor_id']
         from pg_proc where proname = 'oem_receipt_issue' and pronamespace = 'analytics'::regnamespace)
    and (select pronargdefaults = 6 from pg_proc where proname = 'oem_receipt_issue' and pronamespace = 'analytics'::regnamespace)
    and to_regprocedure('analytics.oem_receipt_issue(uuid,uuid,numeric,date,text,text,text,text,uuid)') is null);
  v := v || pg_temp.chk('A2', 'สิทธิ์: ฟังก์ชันที่แตะ/ใหม่ไม่เปิดให้ PUBLIC/anon/authenticated (authenticated ไม่มี execute oem_receipt_issue แล้ว) · service_role execute ได้',
    not exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                 where p.pronamespace = 'analytics'::regnamespace
                   and p.proname in ('oem_receipt_issue','oem_invoice_issue','oem_invoice_void','oem_setting_set_payment_lines','oem_require_actor_member',
                                     'oem_receipt_check_invoice_link','oem_setting_payment_lines_audit','oem_doc_counter_deny_insert')
                   and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee = 'anon'::regrole or a.grantee = 'authenticated'::regrole))
    and not has_function_privilege('authenticated', 'analytics.oem_receipt_issue(uuid,uuid,numeric,date,text,text,text,text,uuid,uuid,uuid)', 'execute')
    and not has_function_privilege('anon', 'analytics.oem_receipt_issue(uuid,uuid,numeric,date,text,text,text,text,uuid,uuid,uuid)', 'execute')
    and has_function_privilege('service_role', 'analytics.oem_receipt_issue(uuid,uuid,numeric,date,text,text,text,text,uuid,uuid,uuid)', 'execute')
    and has_function_privilege('service_role', 'analytics.oem_require_actor_member(uuid,uuid)', 'execute'));
  v := v || pg_temp.chk('A3', 'oem_receipt: คอลัมน์ invoice_id/invoice_no_snapshot (nullable) · CHECK คู่ · partial unique index (status=issued and invoice_id not null) · trigger ตรวจ link/audit/counter มีและเปิดอยู่',
    (select count(*) = 2 from information_schema.columns where table_schema = 'analytics' and table_name = 'oem_receipt' and column_name in ('invoice_id', 'invoice_no_snapshot') and is_nullable = 'YES')
    and exists (select 1 from pg_constraint where conrelid = 'analytics.oem_receipt'::regclass and conname = 'oem_receipt_invoice_pair_check')
    and (select indexdef from pg_indexes where schemaname = 'analytics' and indexname = 'oem_receipt_one_issued_per_invoice') ~ 'UNIQUE.*\(invoice_id\).*status = .issued.*invoice_id IS NOT NULL'
    and (select count(*) = 4 from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in
          ('trg_oem_receipt_check_invoice_link', 'trg_oem_setting_payment_lines_audit_upd', 'trg_oem_setting_payment_lines_audit_ins', 'trg_oem_doc_counter_deny_insert')));
  v := v || pg_temp.chk('A4', 'v_oem_invoice: 53 คอลัมน์ ชื่อ/ลำดับเดิมเป๊ะ · v_oem_receipt: 32 คอลัมน์เดิมเป็น prefix + invoice_id/invoice_no_snapshot ท้ายสุด (34) · v_oem_seller 14 เดิม',
    (select count(*) = 53 and md5(string_agg(column_name, ',' order by ordinal_position)) = 'db0063947e08813e35a2250746a275d8'
       from information_schema.columns where table_schema = 'analytics' and table_name = 'v_oem_invoice')
    and (select count(*) = 34 from information_schema.columns where table_schema = 'analytics' and table_name = 'v_oem_receipt')
    and (select md5(string_agg(column_name, ',' order by ordinal_position)) = '1f7fd4b8bc6335190316df37f7452e0e' from information_schema.columns
          where table_schema = 'analytics' and table_name = 'v_oem_receipt' and ordinal_position <= 32)
    and (select string_agg(column_name, ',' order by ordinal_position) = 'invoice_id,invoice_no_snapshot' from information_schema.columns
          where table_schema = 'analytics' and table_name = 'v_oem_receipt' and ordinal_position > 32)
    and (select md5(string_agg(column_name, ',' order by ordinal_position)) = '19a19f850407e3ee4c26c87c57f276a7' from information_schema.columns where table_schema = 'analytics' and table_name = 'v_oem_seller'));
  v := v || pg_temp.chk('A5', 'v_oem_invoice ไม่มีคอลัมน์ต้นทุน/margin/approval/lost/calc/discount_reason/price_reason/รับซื้อคืน/created_by/voided_by (ผูกใบเสร็จแล้วไม่เพิ่มช่องรั่ว)',
    not exists (select 1 from information_schema.columns where table_schema = 'analytics' and table_name = 'v_oem_invoice'
                 and (column_name ~* '(cost|margin|approval|lost_|calc|rate_snapshot|discount_reason|price_reason|buy_back|kilo_buy)' or column_name in ('created_by', 'voided_by'))));

  -- ==================== X. ของที่ 0180 ไม่ต้องแตะ (golden md5 ลอกจาก DB ก่อน apply 16 ต.ค. 69) ====================
  v := v || pg_temp.chk('X1a', 'ไม่ถูกแตะ: oem_receipt_void · trigger fn ใบเสร็จ/ตัวนับ (deny_mutation/deny_truncate/counter) · crm_require_owner_admin · crm_audit_log_append_only · oem_note_present/valid · oem_invoice_deny_*',
    md5(pg_get_functiondef('analytics.oem_receipt_void(uuid,uuid,text)'::regprocedure)) = '1f14141a16622ef03d8cae82610b0dab'
    and md5(pg_get_functiondef('analytics.oem_receipt_deny_mutation()'::regprocedure)) = 'a9c0217c0cf84f51554f4f0f9364cf15'
    and md5(pg_get_functiondef('analytics.oem_receipt_deny_truncate()'::regprocedure)) = '502b3a448e2e2aea669a412eeaa46fc7'
    and md5(pg_get_functiondef('analytics.oem_doc_counter_deny_mutation()'::regprocedure)) = '07f8cc3a8165a6d384380191cf2f3c3f'
    and md5(pg_get_functiondef('analytics.crm_require_owner_admin(uuid)'::regprocedure)) = 'cb819db831d1a2c9b175b8ce85cc4e07'
    and md5(pg_get_functiondef('analytics.crm_audit_log_append_only()'::regprocedure)) = '0fc1616b362a6df6b44766ff220b787a'
    and md5(pg_get_functiondef('analytics.oem_note_present(text)'::regprocedure)) = 'f1f9026736ee1df8cebd1ff6dde7da1a'
    and md5(pg_get_functiondef('analytics.oem_note_valid(text)'::regprocedure)) = 'bfe80a47081f2c40e2652b3a53b81d24'
    and md5(pg_get_functiondef('analytics.oem_invoice_deny_mutation()'::regprocedure)) = '7f4c1ae97ff18bbf3ff1479cf3714e94'
    and md5(pg_get_functiondef('analytics.oem_invoice_deny_truncate()'::regprocedure)) = '52d58d185c17d93fc50144e73585d764');
  v := v || pg_temp.chk('X1b', 'ไม่ถูกแตะ: oem_setting_upsert (23 args) / oem_quote_save / oem_quote_renegotiate / oem_price_calc / oem_quote_set_billing',
    (select md5(pg_get_functiondef(oid)) from pg_proc where proname = 'oem_setting_upsert' and pronamespace = 'analytics'::regnamespace) = '10f096a43d7dbdd1d7c7febc59412978'
    and md5(pg_get_functiondef('analytics.oem_quote_save(uuid,jsonb,uuid,text,text,text,text,numeric,text,date,uuid)'::regprocedure)) = '1d48eed26068e4141383b0621135209f'
    and md5(pg_get_functiondef('analytics.oem_quote_renegotiate(uuid,uuid,numeric,text)'::regprocedure)) = '51c8d6ec7e4b41414352583fadb5fc09'
    and md5(pg_get_functiondef('analytics.oem_price_calc(uuid,jsonb)'::regprocedure)) = '95e08a3e963766f9920cbee3ae5c3127'
    and md5(pg_get_functiondef('analytics.oem_quote_set_billing(uuid,uuid,jsonb)'::regprocedure)) = '66ba9aa898181fa736055b3a574081c1');
  v := v || pg_temp.chk('X1c', 'ไม่ถูกแตะ: v_oem_quote (md5 นิยาม) · v_oem_seller (md5 นิยาม)',
    md5(pg_get_viewdef('analytics.v_oem_quote'::regclass)) = 'cb95a70df22ecfa532cf6b46512fa478'
    and md5(pg_get_viewdef('analytics.v_oem_seller'::regclass)) = 'f87c02b7d4a408194489c53ec0890b30');
  -- ฟังก์ชัน 0179 ทั้ง 3 ที่ 0180 เติมแค่บรรทัด L1: ตัดสองบรรทัดนั้นออกแล้วต้องได้ md5 baseline เป๊ะ = พิสูจน์ว่าไม่มีอะไรอื่นเปลี่ยน (หลักฐาน "แก้เฉพาะจุด")
  v := v || pg_temp.chk('X1d', 'oem_invoice_issue / oem_invoice_void / oem_setting_set_payment_lines = baseline 0179 + บรรทัด L1 (2 บรรทัด) เท่านั้น (ตัดออกแล้ว md5 เท่า baseline)',
    md5(replace(pg_get_functiondef('analytics.oem_invoice_issue(uuid,uuid,text,date,text,uuid,uuid)'::regprocedure),
      E'  -- 0180 L1: actor ต้องเป็นสมาชิกร้าน (owner/admin) จริง — service_role ผ่าน crm_require_owner_admin โดยไม่ตรวจสมาชิก\n  perform analytics.oem_require_actor_member(p_shop_id, v_actor);\n', '')) = 'c6087fb86bad5e755943e03b9e9ac221'
    and md5(replace(pg_get_functiondef('analytics.oem_invoice_void(uuid,uuid,text,uuid)'::regprocedure),
      E'  -- 0180 L1: actor ต้องเป็นสมาชิกร้าน (owner/admin) จริง — service_role ผ่าน crm_require_owner_admin โดยไม่ตรวจสมาชิก\n  perform analytics.oem_require_actor_member(p_shop_id, v_actor);\n', '')) = '6c1194c1e49bf00ef9c1ecb2085d48d3'
    and md5(replace(pg_get_functiondef('analytics.oem_setting_set_payment_lines(uuid,text[],uuid)'::regprocedure),
      E'  -- 0180 L1: actor ต้องเป็นสมาชิกร้าน (owner/admin) จริง — service_role ผ่าน crm_require_owner_admin โดยไม่ตรวจสมาชิก\n  perform analytics.oem_require_actor_member(p_shop_id, v_actor);\n', '')) = 'c90115f15a8fcd7af83d798af7a3167a');

  -- X2: drift detector — md5 นิยามหลัง apply 0180 (ค่าจาก dry-run 16 ต.ค. 69) · ถ้า migration ภายหลังแก้ object เหล่านี้ (หรือ replay จากไฟล์ CRLF — traps ข้อ 20) ต้องอัปเดตค่าที่นี่โดยตั้งใจ
  v := v || pg_temp.chk('X2', 'นิยามหลัง apply 0180 ตรงค่าที่บันทึก (oem_receipt_issue 11 args · oem_invoice_issue/void · oem_setting_set_payment_lines · v_oem_invoice · v_oem_receipt) — ไม่ตรง = มีคนแก้ภายหลังหรือ replay ด้วย CRLF',
    md5(pg_get_functiondef('analytics.oem_receipt_issue(uuid,uuid,numeric,date,text,text,text,text,uuid,uuid,uuid)'::regprocedure)) = '20f766cd7dfbf7ac52cda0d026131f77'
    and md5(pg_get_functiondef('analytics.oem_invoice_issue(uuid,uuid,text,date,text,uuid,uuid)'::regprocedure)) = 'f4b6baccdd5dac61e4190f22c4d9771a'
    and md5(pg_get_functiondef('analytics.oem_invoice_void(uuid,uuid,text,uuid)'::regprocedure)) = '59d471fd064581820967840c9d2d2728'
    and md5(pg_get_functiondef('analytics.oem_setting_set_payment_lines(uuid,text[],uuid)'::regprocedure)) = '8e8259ea865e3be3af37aa61dc69b1be'
    and md5(pg_get_viewdef('analytics.v_oem_invoice'::regclass)) = 'e04e5cb552e8ac370fc03b0e1028cdf5'
    and md5(pg_get_viewdef('analytics.v_oem_receipt'::regclass)) = 'e30ccb950642126662fbf7da6786b9e8');

  -- ==================== G. golden legacy: ไม่ส่ง invoice/actor = ของเดิมเป๊ะ ====================
  -- G1: สำเร็จ — โคลนสองใบเหมือนกันทุกอย่าง ยิงตัวเดิมใบหนึ่ง ตัวใหม่อีกใบ เทียบแถวใบเสร็จ + quote + ตัวนับ
  v_bad := '';
  for sc in
    select * from (values
      (1, 'quoted',  1000::numeric, 'pct', 0.5::numeric, 'breakdown', 500::numeric,   'deposit', 'transfer', 'ref-A', 'ทดสอบ A'),
      (2, 'quoted',  1000::numeric, null,  null::numeric, 'included',  1000::numeric,  'final',   null,       null,    null),
      (3, 'expired', 10001::numeric,'pct', 0.5::numeric, 'breakdown', 333.33::numeric, 'partial', 'cash',     repeat('x', 200), null),
      (4, 'won',     99999.99::numeric, null, null::numeric, 'breakdown', 33333.33::numeric, 'partial', 'other', null, 'ทดสอบ D'),
      (5, 'quoted',  1.01::numeric, null, null::numeric, 'breakdown', 0.01::numeric, 'partial', null, null, null)
    ) as s(n, st, grand, dm, di, vm, amt, kind, meth, ref, descr)
  loop
    q := pg_temp.mkq(p_shop, sc.st, sc.grand, sc.dm, sc.di, sc.vm);
    q2 := pg_temp.mkq(p_shop, sc.st, sc.grand, sc.dm, sc.di, sc.vm);
    n0 := (select coalesce(max(last_no), 0) from analytics.oem_doc_counter where shop_id = p_shop and doc_key = v_rtkey);
    r := pg_temp.rcl(p_shop, q, sc.amt, sc.kind, null, null, sc.meth, sc.ref, sc.descr);
    n1 := (select coalesce(max(last_no), 0) from analytics.oem_doc_counter where shop_id = p_shop and doc_key = v_rtkey);
    r2 := pg_temp.rc(p_shop, q2, sc.amt, sc.kind, null, null, null, null, sc.meth, sc.ref, sc.descr);
    n2 := (select coalesce(max(last_no), 0) from analytics.oem_doc_counter where shop_id = p_shop and doc_key = v_rtkey);
    if pg_temp.rej(r) or pg_temp.rej(r2) then
      v_bad := v_bad || 'G1.' || sc.n || ' ไม่สำเร็จ(เดิม=' || coalesce(left(r ->> '_err', 60), 'ok') || ' ใหม่=' || coalesce(left(r2 ->> '_err', 60), 'ok') || ') ';
      continue;
    end if;
    v_img1 := pg_temp.rimg((r ->> 'id')::uuid);
    v_img2 := pg_temp.rimg((r2 ->> 'id')::uuid);
    v_q1 := pg_temp.qimg(q);
    v_q2 := pg_temp.qimg(q2);
    if v_img1 is distinct from v_img2 then v_bad := v_bad || 'G1.' || sc.n || ' แถวใบเสร็จต่าง ' || (select string_agg(k, ',') from jsonb_object_keys(v_img1) k where v_img1 -> k is distinct from v_img2 -> k) || ' '; end if;
    if v_q1 is distinct from v_q2 then v_bad := v_bad || 'G1.' || sc.n || ' quote ต่าง '; end if;
    if n1 <> n0 + 1 or n2 <> n1 + 1 then v_bad := v_bad || 'G1.' || sc.n || ' ตัวนับไม่ +1 ทั้งสองทาง '; end if;
    if (select invoice_id is not null or invoice_no_snapshot is not null or created_by is not null from analytics.oem_receipt where id = (r2 ->> 'id')::uuid) then
      v_bad := v_bad || 'G1.' || sc.n || ' ทางใหม่ไม่ส่ง invoice แต่มี invoice_id/created_by ';
    end if;
  end loop;
  v := v || pg_temp.chk('G1', 'ไม่ส่ง invoice/actor: 5 สถานการณ์ (deposit/final/partial · quoted/expired/won · ยอดคี่ · 0.01) แถวใบเสร็จ/quote/ตัวนับ ตัวใหม่ = ตัวเดิมเป๊ะ ' || coalesce(nullif(v_bad, ''), '(ตรงทุกฟิลด์)'), v_bad = '');

  -- G2: reissue (void แล้วออกใหม่ วันที่/ยอด/kind/ดีลเดียวกัน) ผ่านทั้งสองทาง ได้แถวเหมือนกัน
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  q2 := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  r := pg_temp.rcl(p_shop, q, 500, 'deposit');
  r2 := pg_temp.rc(p_shop, q2, 500, 'deposit');
  perform pg_temp.vr(p_shop, (r ->> 'id')::uuid, 'ทดสอบ G2');
  perform pg_temp.vr(p_shop, (r2 ->> 'id')::uuid, 'ทดสอบ G2');
  r := pg_temp.rcl(p_shop, q, 500, 'deposit', (r ->> 'id')::uuid);
  r2 := pg_temp.rc(p_shop, q2, 500, 'deposit', null, null, (r2 ->> 'id')::uuid);
  v := v || pg_temp.chk('G2', 'reissue ของใบที่ไม่เคยอ้างใบแจ้งหนี้: ออกได้ทั้งตัวเดิม/ตัวใหม่ · แถวเหมือนกัน (is_reissue=true) ' || coalesce(left(r2 ->> '_err', 70), ''),
    not pg_temp.rej(r) and not pg_temp.rej(r2) and pg_temp.rimg((r ->> 'id')::uuid) = pg_temp.rimg((r2 ->> 'id')::uuid)
    and coalesce((pg_temp.rimg((r2 ->> 'id')::uuid) ->> 'is_reissue')::boolean, false));

  -- G3: error parity — อินพุตที่ตัวเดิมปฏิเสธ ตัวใหม่ต้องปฏิเสธด้วย sqlstate + ข้อความเดียวกัน (ไม่ต้องเปลี่ยนใบจริง)
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  qa := pg_temp.mkq(p_shop, 'draft', 1000);
  qb := pg_temp.mkq(p_shop, 'lost', 1000);
  qc := pg_temp.mkq(p_shop, 'quoted', 1000, null, null, 'breakdown', false);   -- ไม่มีผู้ซื้อ
  v_bad := ''; n0 := 0;
  for sc in
    select * from (values
      ('amt-null',    0, null::numeric, 'deposit', false, null::text),
      ('amt-zero',    0, 0::numeric, 'deposit', false, null),
      ('amt-neg',     0, (-5)::numeric, 'deposit', false, null),
      ('amt-nan',     0, 'NaN'::numeric, 'deposit', false, null),
      ('amt-big',     0, 100000001::numeric, 'deposit', false, null),
      ('kind-null',   0, 100::numeric, null, false, null),
      ('kind-bad',    0, 100::numeric, 'full', false, null),
      ('date-null',   0, 100::numeric, 'deposit', true, null),
      ('method-bad',  0, 100::numeric, 'deposit', false, 'card'),
      ('overpay',     0, 1000.01::numeric, 'final', false, null),
      ('draft',       1, 100::numeric, 'partial', false, null),
      ('lost',        2, 100::numeric, 'partial', false, null),
      ('nobuyer',     3, 100::numeric, 'partial', false, null)
    ) as s(lbl, qsel, amt, kind, nodate, meth)
  loop
    qc := case sc.qsel when 0 then q when 1 then qa when 2 then qb else pg_temp.mkq(p_shop, 'quoted', 1000, null, null, 'breakdown', false) end;
    r  := pg_temp.rcl(p_shop, qc, sc.amt, sc.kind, null, null, sc.meth, null, null, sc.nodate);
    r2 := pg_temp.rc(p_shop, qc, sc.amt, sc.kind, null, null, null, null, sc.meth, null, null, sc.nodate);
    n0 := n0 + 1;
    if not pg_temp.rej(r) or (r ->> '_err') is distinct from (r2 ->> '_err') or pg_temp.st(r) <> pg_temp.st(r2) then
      v_bad := v_bad || sc.lbl || '(เดิม=' || coalesce(left(r ->> '_err', 50), 'ok') || ' ใหม่=' || coalesce(left(r2 ->> '_err', 50), 'ok') || ') ';
    end if;
  end loop;
  v := v || pg_temp.chk('G3', format('ปฏิเสธเหมือนเดิม %s อินพุต (NaN/ศูนย์/ลบ/เกินเพดาน/kind/วันที่/method/จ่ายเกิน/draft/lost/ไม่มีผู้ซื้อ): sqlstate+ข้อความเดียวกัน', n0) || ' ' || coalesce(nullif(v_bad, ''), '(ตรงทุกข้อ)'), v_bad = '');
  -- G3b: reissue gate เดิมยังทำงาน (วันที่/ยอด/kind ไม่ตรงใบเดิม · ชี้ใบที่ไม่ void) — error ตรงกับตัวเดิม
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  r := pg_temp.rc(p_shop, q, 500, 'deposit');
  rid := (r ->> 'id')::uuid;
  r2 := pg_temp.rcl(p_shop, q, 500, 'deposit', rid);                 -- ชี้ใบที่ยัง issued
  r3 := pg_temp.rc(p_shop, q, 500, 'deposit', null, null, rid);
  perform pg_temp.vr(p_shop, rid, 'ทดสอบ G3b');
  v := v || pg_temp.chk('G3b', 'reissue ชี้ใบที่ยัง issued ถูกปฏิเสธเหมือนเดิม · ยอดไม่ตรงใบเดิม ถูกปฏิเสธเหมือนเดิม (ข้อความเดียวกับตัวเดิม)',
    pg_temp.rej(r2) and pg_temp.rej(r3) and (r2 ->> '_err') = (r3 ->> '_err')
    and (pg_temp.rcl(p_shop, q, 400, 'deposit', rid) ->> '_err') = (pg_temp.rc(p_shop, q, 400, 'deposit', null, null, rid) ->> '_err'));

  -- ==================== L01 ผูกถูก: มัดจำ ====================
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  inv := pg_temp.mkinv(p_shop, q, 'deposit', p_actor);
  c0 := (select coalesce(md5(string_agg(doc_key || '=' || last_no, ',' order by doc_key)), '') from analytics.oem_doc_counter where doc_key like 'RT-%');
  r := pg_temp.rc(p_shop, q, 500, 'deposit', inv, p_actor);
  rid := (r ->> 'id')::uuid;
  v := v || pg_temp.chk('L01a', 'ผูกถูก (ดีลเดียว · ยอดเท่า 500.00 · kind deposit): ออกใบเสร็จได้ ' || coalesce(left(r ->> '_err', 80), ''), not pg_temp.rej(r));
  select * into vi from analytics.v_oem_invoice where id = inv;
  v := v || pg_temp.chk('L01b', 'ใบแจ้งหนี้ -> payment_state=paid · receipt_id/receipt_no/received_date มีค่าตรงใบเสร็จ',
    vi.payment_state = 'paid' and vi.receipt_id = rid
    and vi.receipt_no = (select receipt_no from analytics.oem_receipt where id = rid)
    and vi.received_date = (select received_date from analytics.oem_receipt where id = rid));
  v := v || pg_temp.chk('L01c', 'ใบเสร็จมี invoice_id + invoice_no_snapshot = เลขใบแจ้งหนี้ · ผูกใบเดียว · created_by = actor · kind=deposit · ยอด 500.00',
    (select invoice_id = inv and invoice_no_snapshot = (select invoice_no from analytics.oem_invoice where id = inv) and created_by = p_actor
            and kind = 'deposit' and amount_thb = 500 and status = 'issued' from analytics.oem_receipt where id = rid));
  v := v || pg_temp.chk('L01d', 'quote พลิก won (รับมัดจำ = รับงาน) · updated_by = actor · v_oem_quote.paid_thb = 500',
    (select status = 'won' and updated_by = p_actor from analytics.oem_quote where id = q)
    and (select paid_thb = 500 and is_fully_paid is false from analytics.v_oem_quote where id = q));
  v := v || pg_temp.chk('L01e', 'ใบแจ้งหนี้ paid: is_stale=false · is_overdue=false · ตัวใบแจ้งหนี้ (frozen) ไม่ถูก UPDATE (status ยัง issued · void_* null)',
    vi.is_stale is false and vi.is_overdue is false
    and (select status = 'issued' and void_reason is null and voided_at is null from analytics.oem_invoice where id = inv));
  v := v || pg_temp.chk('L01f', 'ตัวนับ RT +1 พอดี (ออกใบเสร็จ 1 ใบ) · ตัวนับ IV ไม่ขยับจากการออกใบเสร็จ',
    c0 is distinct from (select coalesce(md5(string_agg(doc_key || '=' || last_no, ',' order by doc_key)), '') from analytics.oem_doc_counter where doc_key like 'RT-%')
    and (select receipt_no from analytics.oem_receipt where id = rid) = v_rtkey || '-' || lpad((select last_no::text from analytics.oem_doc_counter where shop_id = p_shop and doc_key = v_rtkey), 3, '0'));
  r2 := pg_temp.rc(p_shop, pg_temp.mkq(p_shop, 'quoted', 1000), 10, 'partial');   -- แยก statement: แถวที่ฟังก์ชันเพิ่งแทรกไม่อยู่ใน snapshot ของ query เดียวกัน
  v := v || pg_temp.chk('L01g', 'v_oem_receipt เห็น invoice_id/invoice_no_snapshot ของใบที่ผูก · ใบที่ไม่ผูกเป็น null ' || coalesce(left(r2 ->> '_err', 60), ''),
    (select invoice_id = inv and invoice_no_snapshot = vi.invoice_no from analytics.v_oem_receipt where id = rid)
    and (select invoice_id is null and invoice_no_snapshot is null from analytics.v_oem_receipt where id = (r2 ->> 'id')::uuid));

  -- ==================== L02 flow D: ยอดคี่ 10,001.01 มัดจำ 50% ปัดเป็น 5,000.51 + คงเหลือ (ส่วนที่เหลือ) 5,000.50 ====================
  q := pg_temp.mkq(p_shop, 'quoted', 10001.01, 'pct', 0.5);
  inv := pg_temp.mkinv(p_shop, q, 'deposit', p_actor);
  r := pg_temp.rc(p_shop, q, 5000.51, 'deposit', inv, p_actor);
  inv2 := pg_temp.mkinv(p_shop, q, 'balance', p_actor);
  v := v || pg_temp.chk('L02a', 'มัดจำที่ paid แล้วไม่นับเป็นใบเปิดค้าง: ออกใบแจ้งหนี้ balance ต่อได้ทันที (5,000.50 = ส่วนที่เหลือ ไม่ใช่ 50% ซ้ำ) ' || coalesce(left(r ->> '_err', 70), '') || ' ' || coalesce(left(pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor) ->> '_err', 90), ''),
    inv2 is not null and (select amount_thb = 5000.50 and paid_before_thb = 5000.51 and balance_after_thb = 0 from analytics.oem_invoice where id = inv2));
  r2 := pg_temp.rc(p_shop, q, 5000.50, 'final', inv2, p_actor);
  v := v || pg_temp.chk('L02b', 'ใบเสร็จ final อ้างใบ balance ได้ · v_oem_quote.is_fully_paid = true · outstanding = 0',
    not pg_temp.rej(r2) and (select is_fully_paid and outstanding_thb = 0 and paid_thb = 10001.01 from analytics.v_oem_quote where id = q));
  v := v || pg_temp.chk('L02c', 'ทั้งสองใบแจ้งหนี้ paid · paid_before + amount + balance_after = grand ทุกใบ · ใบเสร็จทั้งสองมี invoice_no ตรงใบ',
    (select count(*) = 2 and bool_and(payment_state = 'paid') and bool_and(paid_before_thb + amount_thb + balance_after_thb = grand_total_snapshot)
       from analytics.v_oem_invoice where id in (inv, inv2))
    and (select count(*) = 2 from analytics.oem_receipt rr join analytics.oem_invoice ii on ii.id = rr.invoice_id and ii.invoice_no = rr.invoice_no_snapshot where rr.id in ((r ->> 'id')::uuid, (r2 ->> 'id')::uuid)));
  v := v || pg_temp.chk('L02f', 'เศษปัด: มัดจำ 5,000.51 + คงเหลือ 5,000.50 = 10,001.01 เป๊ะ (ส่วนที่เหลือ ไม่ปัดซ้ำ)', (select sum(amount_thb) = 10001.01 from analytics.oem_invoice where id in (inv, inv2)));
  v := v || pg_temp.chk('L02d', 'ชำระครบแล้วออกใบแจ้งหนี้อีกไม่ได้ (ไม่มียอดคงเหลือ)', pg_temp.hint(pg_temp.iss(p_shop, q, 'balance', null, null, null, p_actor)) = 'balance_none');
  select md5(string_agg(to_jsonb(x)::text, ',' order by x.id)) into c0 from analytics.oem_invoice x where x.id in (inv, inv2);
  v := v || pg_temp.chk('L02e', 'ใบแจ้งหนี้ที่ paid ไม่ถูก UPDATE เลยทั้งสองใบ (md5 แถว = ตอนออก: ไม่มี status/ฟิลด์เปลี่ยน)',
    (select count(*) = 2 and bool_and(status = 'issued' and void_reason is null and voided_by is null) from analytics.oem_invoice where id in (inv, inv2)));

  -- ==================== L03 void ใบเสร็จ -> ใบแจ้งหนี้กลับ unpaid (derived) · ออกใหม่ได้ ====================
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  inv := pg_temp.mkinv(p_shop, q, 'deposit', p_actor);
  select md5(to_jsonb(x)::text) into c0 from analytics.oem_invoice x where x.id = inv;
  r := pg_temp.rc(p_shop, q, 500, 'deposit', inv, p_actor);
  rid := (r ->> 'id')::uuid;
  t := pg_temp.x(format('select analytics.oem_receipt_void(%L, %L, %L)', p_shop, rid, 'ทดสอบ L03'));
  select * into vi from analytics.v_oem_invoice where id = inv;
  select md5(to_jsonb(x)::text) into c1 from analytics.oem_invoice x where x.id = inv;
  v := v || pg_temp.chk('L03a', 'void ใบเสร็จ -> ใบแจ้งหนี้กลับเป็น unpaid · receipt_* null · แถว oem_invoice ไม่ถูก UPDATE (md5 เท่าเดิม) · oem_receipt_void ไม่ถูกแตะ',
    t = 'OK' and vi.payment_state = 'unpaid' and vi.receipt_id is null and vi.receipt_no is null and vi.received_date is null and c0 = c1);
  v := v || pg_temp.chk('L03b', 'หลัง void ใบเสร็จ: ใบแจ้งหนี้ is_stale=false (ยอดรับสะสมกลับเป็นเท่าตอนออก) · ใบเสร็จเก่ายังอ้าง invoice_id เดิม (ประวัติ) แต่ status=void',
    vi.is_stale is false and (select status = 'void' and invoice_id = inv from analytics.oem_receipt where id = rid));
  r2 := pg_temp.rc(p_shop, q, 500, 'deposit', inv, p_actor, rid);    -- reissue อ้างใบเดิมเดียวกัน
  v := v || pg_temp.chk('L03c', 'reissue ใบเสร็จที่เคยอ้างใบแจ้งหนี้ โดยอ้างใบเดิมเดียวกัน: ผ่าน (วันที่/ยอด/kind เดิม) ' || coalesce(left(r2 ->> '_err', 80), ''),
    not pg_temp.rej(r2) and (select invoice_id = inv and reissued_from_receipt_id = rid from analytics.oem_receipt where id = (r2 ->> 'id')::uuid)
    and (select payment_state = 'paid' from analytics.v_oem_invoice where id = inv));
  t := pg_temp.x(format('select analytics.oem_receipt_void(%L, %L, %L)', p_shop, (r2 ->> 'id')::uuid, 'ทดสอบ L03d'));
  r3 := pg_temp.rc(p_shop, q, 500, 'deposit', inv, p_actor);         -- ไม่ใช่ reissue: ออกใหม่ธรรมดาอ้างใบเดิม หลังใบเสร็จก่อนหน้า void หมดแล้ว
  v := v || pg_temp.chk('L03d', 'void อีกรอบแล้วออกใบเสร็จใหม่ (ไม่ใช่ reissue) อ้างใบแจ้งหนี้เดิม: ผ่าน (unique นับเฉพาะ issued)',
    t = 'OK' and not pg_temp.rej(r3) and (select payment_state = 'paid' and receipt_id = (r3 ->> 'id')::uuid from analytics.v_oem_invoice where id = inv));

  -- ==================== L04 reissue ล็อกตัวที่ 6 ====================
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  inv := pg_temp.mkinv(p_shop, q, 'deposit', p_actor);
  r := pg_temp.rc(p_shop, q, 500, 'deposit', inv, p_actor);
  rid := (r ->> 'id')::uuid;
  perform pg_temp.vr(p_shop, rid, 'ทดสอบ L04');
  v := v || pg_temp.chk('L04a', 'ใบเดิมอ้างใบแจ้งหนี้ -> reissue โดยไม่อ้าง (null) ถูกปฏิเสธ reissue_invoice_mismatch',
    pg_temp.hint(pg_temp.rc(p_shop, q, 500, 'deposit', null, p_actor, rid)) = 'reissue_invoice_mismatch');
  q2 := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  inv2 := pg_temp.mkinv(p_shop, q2, 'deposit', p_actor);
  v := v || pg_temp.chk('L04b', 'ใบเดิมอ้าง IV-A -> reissue อ้าง IV-B (ใบอื่น) ถูกปฏิเสธ (reissue_invoice_mismatch ก่อนด่านดีล)',
    pg_temp.hint(pg_temp.rc(p_shop, q, 500, 'deposit', inv2, p_actor, rid)) = 'reissue_invoice_mismatch');
  -- ใบเดิมไม่เคยอ้าง -> reissue ที่ส่ง p_invoice_id ถูกปฏิเสธ
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  r := pg_temp.rc(p_shop, q, 500, 'deposit');
  rid2 := (r ->> 'id')::uuid;
  perform pg_temp.vr(p_shop, rid2, 'ทดสอบ L04c');
  inv3 := pg_temp.mkinv(p_shop, q, 'deposit', p_actor);
  v := v || pg_temp.chk('L04c', 'ใบเดิมไม่เคยอ้างใบแจ้งหนี้ -> reissue ที่ส่ง p_invoice_id ถูกปฏิเสธ reissue_invoice_mismatch',
    inv3 is not null and pg_temp.hint(pg_temp.rc(p_shop, q, 500, 'deposit', inv3, p_actor, rid2)) = 'reissue_invoice_mismatch');
  v := v || pg_temp.chk('L04d', 'ใบเดิมไม่เคยอ้าง -> reissue แบบไม่อ้าง ผ่าน (ทางเดิม ไม่กระทบ)',
    not pg_temp.rej(pg_temp.rc(p_shop, q, 500, 'deposit', null, null, rid2)));
  -- L04e: ใบเดิมอ้าง inv · reissue อ้าง inv เดียวกันแต่ยอดต่าง (400 vs 500) ต้องตกที่ด่านเดิมของ 0087 (ยอดเดียวกับใบเดิม) ไม่ใช่ถูกด่านใหม่บัง/กลืน
  r := pg_temp.rc(p_shop, pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5), 400, 'deposit', null, p_actor, rid);
  v := v || pg_temp.chk('L04e', 'reissue ยอดไม่ตรงใบเดิม ยังตกที่ด่านเดิมของ 0087 (ข้อความ "ยอดเงินเดียวกับใบเดิม" — ด่านใหม่ไม่บัง/กลืนด่านเก่า)',
    pg_temp.rej(r) and (r ->> '_err') like '%ยอดเงินเดียวกับใบเดิม%');

  -- ==================== L05 เคสห้ามผ่าน (ทุกเคสต้องไม่เผาเลข RT) ====================
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  inv := pg_temp.mkinv(p_shop, q, 'deposit', p_actor);                  -- 500.00 deposit
  c0 := (select coalesce(md5(string_agg(shop_id::text || doc_key || last_no, ',' order by shop_id, doc_key)), '') from analytics.oem_doc_counter where doc_key like 'RT-%');
  v := v || pg_temp.chk('L05a', 'ยอดรับต่างใบแจ้งหนี้ 0.01 (499.99 / 500.01) ถูกปฏิเสธ invoice_amount_mismatch',
    pg_temp.hint(pg_temp.rc(p_shop, q, 499.99, 'deposit', inv, p_actor)) = 'invoice_amount_mismatch'
    and pg_temp.hint(pg_temp.rc(p_shop, q, 500.01, 'deposit', inv, p_actor)) = 'invoice_amount_mismatch');
  v := v || pg_temp.chk('L05b', 'ยอดทศนิยมเกิน 2 ตำแหน่ง (500.004 · 499.996) ไม่ถูกปัดเป็น 500.00 — ปฏิเสธ invoice_amount_mismatch',
    pg_temp.hint(pg_temp.rc(p_shop, q, 500.004, 'deposit', inv, p_actor)) = 'invoice_amount_mismatch'
    and pg_temp.hint(pg_temp.rc(p_shop, q, 499.996, 'deposit', inv, p_actor)) = 'invoice_amount_mismatch');
  v := v || pg_temp.chk('L05c', 'kind ไม่แมป: ใบมัดจำ + final/partial ถูกปฏิเสธ invoice_kind_mismatch',
    pg_temp.hint(pg_temp.rc(p_shop, q, 500, 'final', inv, p_actor)) = 'invoice_kind_mismatch'
    and pg_temp.hint(pg_temp.rc(p_shop, q, 500, 'partial', inv, p_actor)) = 'invoice_kind_mismatch');
  qa := pg_temp.mkq(p_shop, 'quoted', 1000);
  inv2 := pg_temp.mkinv(p_shop, qa, 'balance', p_actor);               -- 1000.00 balance
  v := v || pg_temp.chk('L05d', 'ใบ balance + kind deposit/partial ถูกปฏิเสธ invoice_kind_mismatch (ต้อง final)',
    pg_temp.hint(pg_temp.rc(p_shop, qa, 1000, 'deposit', inv2, p_actor)) = 'invoice_kind_mismatch'
    and pg_temp.hint(pg_temp.rc(p_shop, qa, 1000, 'partial', inv2, p_actor)) = 'invoice_kind_mismatch');
  v := v || pg_temp.chk('L05e', 'ดีลอื่น: ใบแจ้งหนี้ของ quote A แต่รับเงินบน quote B (ยอด/kind ตรง) ถูกปฏิเสธ invoice_deal_mismatch',
    pg_temp.hint(pg_temp.rc(p_shop, qa, 500, 'deposit', inv, p_actor)) = 'invoice_deal_mismatch');
  v := v || pg_temp.chk('L05f', 'ใบแจ้งหนี้ไม่มีจริง / คนละร้าน (หา id ผ่าน p_shop_id) ถูกปฏิเสธ invoice_not_found',
    pg_temp.hint(pg_temp.rc(p_shop, q, 500, 'deposit', gen_random_uuid(), p_actor)) = 'invoice_not_found');
  -- ใบ void
  q2 := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  inv3 := pg_temp.mkinv(p_shop, q2, 'deposit', p_actor);
  perform pg_temp.vd(p_shop, inv3, 'ทดสอบ L05g', p_actor);
  v := v || pg_temp.chk('L05g', 'ใบแจ้งหนี้ void แล้ว (ยอด/kind ตรง) ถูกปฏิเสธ invoice_not_issued', pg_temp.hint(pg_temp.rc(p_shop, q2, 500, 'deposit', inv3, p_actor)) = 'invoice_not_issued');
  v := v || pg_temp.chk('L05m', 'การปฏิเสธ L05a-L05g ไม่เผาเลข: ตัวนับ RT ทุกแถวเท่าเดิมก่อน/หลังชุดปฏิเสธ (ด่านใหม่ทั้งหมดอยู่ก่อนการออกเลข)',
    c0 = (select coalesce(md5(string_agg(shop_id::text || doc_key || last_no, ',' order by shop_id, doc_key)), '') from analytics.oem_doc_counter where doc_key like 'RT-%'));
  -- stale: ยอดรวมของแถว active เปลี่ยนหลังออกใบ
  begin
    update analytics.oem_quote set grand_total = 1100, pieces_subtotal = 1100, quote_total = 1100 where id = q;
    r := pg_temp.rc(p_shop, q, 500, 'deposit', inv, p_actor);
    raise exception 'rollback-test' using errcode = 'P0098';
  exception when sqlstate 'P0098' then null; end;
  v := v || pg_temp.chk('L05h', 'ใบแจ้งหนี้ stale (ยอดรวมใบเสนอราคาเปลี่ยนหลังออกใบ) ถูกปฏิเสธ invoice_stale ทั้งที่ยอดตรง', pg_temp.hint(r) = 'invoice_stale');
  -- stale: รับเงินไปแล้วโดยไม่อ้างใบ (flow C)
  q2 := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  inv3 := pg_temp.mkinv(p_shop, q2, 'deposit', p_actor);
  r2 := pg_temp.rc(p_shop, q2, 100, 'partial');                          -- ไม่อ้างใบ
  b := (select is_stale from analytics.v_oem_invoice where id = inv3);
  r := pg_temp.rc(p_shop, q2, 500, 'deposit', inv3, p_actor);
  r3 := pg_temp.vd(p_shop, inv3, 'ลูกค้าโอนยอดต่าง', p_actor);
  v := v || pg_temp.chk('L05i', 'รับเงินไม่อ้างใบ (flow C) -> ใบแจ้งหนี้ stale · ผูกใบเสร็จ 500 อ้างใบนี้ถูกปฏิเสธ invoice_stale · แต่ void ใบแจ้งหนี้ได้ (เหตุผลตาม design §3)',
    b is true and pg_temp.hint(r) = 'invoice_stale' and not pg_temp.rej(r3));
  -- ผูกซ้ำ (ใบแจ้งหนี้ paid แล้ว)
  q2 := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  inv3 := pg_temp.mkinv(p_shop, q2, 'deposit', p_actor);
  r2 := pg_temp.rc(p_shop, q2, 500, 'deposit', inv3, p_actor);
  r3 := pg_temp.rc(p_shop, q2, 500, 'deposit', inv3, p_actor);
  v := v || pg_temp.chk('L05j', 'ผูกซ้ำ: ใบแจ้งหนี้ที่ paid แล้วมีใบเสร็จ issued อ้าง — ใบที่สองถูกปฏิเสธ invoice_paid (ไม่ใช่ 23505 — ด่าน RPC ก่อนกำแพง index)',
    not pg_temp.rej(r2) and pg_temp.hint(r3) = 'invoice_paid' and pg_temp.st(r3) = '22023');
  v := v || pg_temp.chk('L05l', 'ทางผูกใบแจ้งหนี้ต้องมี actor: ไม่ส่ง p_actor_id = actor_required · actor ไม่มีใน auth.users = actor_required',
    pg_temp.hint(pg_temp.rc(p_shop, q, 500, 'deposit', inv, null)) = 'actor_required'
    and pg_temp.hint(pg_temp.rc(p_shop, q, 500, 'deposit', inv, gen_random_uuid())) = 'actor_required');

  -- ==================== L07 กำแพงที่ตารางเอง (ทะลุ RPC ด้วยการ insert ตรง) ====================
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  inv := pg_temp.mkinv(p_shop, q, 'deposit', p_actor);
  r := pg_temp.rc(p_shop, q, 500, 'deposit', inv, p_actor);
  rid := (r ->> 'id')::uuid;
  t := pg_temp.badins(rid, jsonb_build_object('receipt_no', 'V180-DUP-1'));
  v := v || pg_temp.chk('L07a', 'insert ตรง: ใบเสร็จ issued ใบที่สองอ้างใบแจ้งหนี้เดียวกัน (ทะลุ RPC) ตกที่ partial unique index 23505 (' || left(t, 60) || ')', t like 'ERR:23505:%');
  perform pg_temp.x(format('select analytics.oem_receipt_void(%L, %L, %L)', p_shop, rid, 'ทดสอบ L07'));
  t := pg_temp.badins(rid, jsonb_build_object('receipt_no', 'V180-DUP-2'));
  v := v || pg_temp.chk('L07b', 'insert ตรง: เมื่อใบเดิม void แล้ว ใบ issued ใหม่อ้างใบแจ้งหนี้เดิม ผ่านได้ (unique นับเฉพาะ issued) · trigger link ผ่านเมื่อข้อมูลจริง (' || left(t, 60) || ')', t = 'OK');
  q2 := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  inv2 := pg_temp.mkinv(p_shop, q2, 'deposit', p_actor);
  v_bad := '';
  -- ใบเสร็จ issued ปลอมที่ link ผิดแต่ละแบบ (โคลนจากใบ rid ที่ void แล้ว ทับด้วยค่าที่ต้องการ) — ทุกแบบต้องตก 22023 ที่ trigger ของตาราง
  foreach st in array array['snapshot', 'amount', 'deal', 'shop', 'nosnap', 'void'] loop
    if st = 'void' then
      perform pg_temp.vd(p_shop, inv2, 'ทดสอบ L07 void', p_actor);
    end if;
    t := pg_temp.badins(rid, jsonb_build_object(
          'receipt_no', 'V180-BAD-' || st,
          'quote_id', case st when 'deal' then q else q2 end,
          'shop_id', case st when 'shop' then shop2 else p_shop end,
          'invoice_id', inv2,
          'invoice_no_snapshot', case st when 'snapshot' then 'IV-0000-999' when 'nosnap' then null else (select invoice_no from analytics.oem_invoice where id = inv2) end,
          'amount_thb', case st when 'amount' then 500.01 else 500 end,
          'vat_base_thb', case st when 'amount' then 500.01 else 500 end, 'vat_amount_thb', 0));
    if t not like 'ERR:22023:%' then v_bad := v_bad || st || '=' || left(t, 60) || ' '; end if;
  end loop;
  v := v || pg_temp.chk('L07c', 'insert ตรงที่ link ปลอม ถูก trigger ตรวจที่ตารางเอง (22023): เลขใบ snapshot ผิด · ยอดต่าง 0.01 · คนละดีล · คนละร้าน · snapshot null ทั้งที่มี invoice_id · ใบแจ้งหนี้ void ' || coalesce(nullif(v_bad, ''), '(ตกครบ)'), v_bad = '');
  -- CHECK คู่ (กำแพงชั้นที่สอง): ปิด trigger ชั่วคราวในทรานแซกชันทดสอบ แล้ว insert invoice_id ไม่มี snapshot / snapshot ไม่มี invoice_id ต้องตก 23514
  begin
    alter table analytics.oem_receipt disable trigger user;
    t := pg_temp.badins(rid, jsonb_build_object('receipt_no', 'V180-PAIR-1', 'invoice_id', inv, 'invoice_no_snapshot', null));
    t2 := pg_temp.badins(rid, jsonb_build_object('receipt_no', 'V180-PAIR-2', 'invoice_id', null, 'invoice_no_snapshot', 'IV-0000-001'));
    raise exception 'rollback-test' using errcode = 'P0098';
  exception when sqlstate 'P0098' then null; end;
  v := v || pg_temp.chk('L07e', 'CHECK คู่ invoice_id/invoice_no_snapshot (ชั้นที่สอง · ปิด trigger ชั่วคราว): มี invoice_id ไม่มี snapshot / มี snapshot ไม่มี invoice_id ตก 23514 (' || left(t, 40) || ' / ' || left(t2, 40) || ')',
    t like 'ERR:23514:%' and t2 like 'ERR:23514:%');
  v := v || pg_temp.chk('L07d', 'ใบเสร็จที่ผูกแล้วแก้ invoice_id ภายหลังไม่ได้ (trigger ใบเสร็จแช่แข็งคอลัมน์ใหม่อัตโนมัติ) · ลบไม่ได้',
    pg_temp.x(format('update analytics.oem_receipt set invoice_id = null, invoice_no_snapshot = null where id = %L', rid)) like 'ERR:22023:%'
    and pg_temp.x(format('update analytics.oem_receipt set invoice_no_snapshot = %L where id = %L', 'IV-0000-001', rid)) like 'ERR:22023:%'
    and pg_temp.x(format('delete from analytics.oem_receipt where id = %L', rid)) like 'ERR:22023:%');

  -- ==================== L08 void ใบแจ้งหนี้ที่ paid ====================
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  inv := pg_temp.mkinv(p_shop, q, 'deposit', p_actor);
  r := pg_temp.rc(p_shop, q, 500, 'deposit', inv, p_actor);
  rid := (r ->> 'id')::uuid;
  r2 := pg_temp.vd(p_shop, inv, 'ทดสอบ void ใบที่ paid', p_actor);
  v := v || pg_temp.chk('L08a', 'void ใบแจ้งหนี้ที่ paid ถูกปฏิเสธ invoice_paid (ด่านที่ 0179 เขียนไว้ทำงานจริงแล้ว)', pg_temp.hint(r2) = 'invoice_paid' and pg_temp.st(r2) = '22023');
  v := v || pg_temp.chk('L08b', 'ใบแจ้งหนี้ที่ paid ยังเป็น issued/paid หลังพยายาม void (ไม่ถูกแก้)', (select status = 'issued' and void_reason is null from analytics.oem_invoice where id = inv)
    and (select payment_state from analytics.v_oem_invoice where id = inv) = 'paid');
  perform pg_temp.x(format('select analytics.oem_receipt_void(%L, %L, %L)', p_shop, rid, 'ทดสอบ L08c'));
  r3 := pg_temp.vd(p_shop, inv, 'ทดสอบ void หลัง void ใบเสร็จ', p_actor);
  v := v || pg_temp.chk('L08c', 'void ใบเสร็จก่อน แล้ว void ใบแจ้งหนี้ได้ (กลับเป็น unpaid แล้ว)', not pg_temp.rej(r3) and (select payment_state from analytics.v_oem_invoice where id = inv) = 'void');

  -- ==================== L09 ใบเปิดค้างยังกันได้เหมือนเดิม ====================
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  inv := pg_temp.mkinv(p_shop, q, 'deposit', p_actor);
  v := v || pg_temp.chk('L09', 'ใบแจ้งหนี้ unpaid ยังเป็นใบเปิดค้าง: ออกใบที่สองซ้อนไม่ได้ (invoice_open) จนกว่าจะ paid/void',
    pg_temp.hint(pg_temp.iss(p_shop, q, 'deposit', null, null, null, p_actor)) = 'invoice_open');

  -- ==================== L10 paid ไม่นับ stale / overdue ====================
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  inv := pg_temp.mkinv(p_shop, q, 'deposit', p_actor);
  r := pg_temp.rc(p_shop, q, 500, 'deposit', inv, p_actor);
  begin
    alter table analytics.oem_invoice disable trigger user;
    update analytics.oem_invoice set issue_date = v_today - 20, due_date = v_today - 10 where id = inv;
    update analytics.oem_quote set grand_total = 1200, pieces_subtotal = 1200, quote_total = 1200 where id = q;
    select * into vi from analytics.v_oem_invoice where id = inv;
    b := vi.is_overdue; b2 := vi.is_stale; t := vi.payment_state;
    raise exception 'rollback-test' using errcode = 'P0098';
  exception when sqlstate 'P0098' then null; end;
  v := v || pg_temp.chk('L10a', 'ใบ paid ที่เลย due_date และยอดรวมดีลเปลี่ยนทีหลัง: is_overdue=false · is_stale=false · ยัง paid', b is false and b2 is false and t = 'paid');
  q2 := pg_temp.mkq(p_shop, 'quoted', 1000);
  inv2 := pg_temp.mkinv(p_shop, q2, 'balance', p_actor);
  begin
    alter table analytics.oem_invoice disable trigger user;
    update analytics.oem_invoice set issue_date = v_today - 20, due_date = v_today - 10 where id = inv2;
    select * into vi from analytics.v_oem_invoice where id = inv2;
    b := vi.is_overdue;
    raise exception 'rollback-test' using errcode = 'P0098';
  exception when sqlstate 'P0098' then null; end;
  v := v || pg_temp.chk('L10b', 'ใบ unpaid เลย due_date ยังเป็น overdue (ไม่เปลี่ยนพฤติกรรมเดิม)', b is true);

  -- ==================== P. M1 audit ช่องทางชำระ ====================
  n0 := (select count(*) from analytics.crm_audit_log where action = 'oem_payment_lines_set');
  r := pg_temp.spl(p_shop, array['TEST-ONLY audit-1 (ห้ามใช้จริง)'], p_actor);
  v := v || pg_temp.chk('P1', 'ตั้งช่องทางชำระผ่าน RPC -> audit 1 แถว action oem_payment_lines_set · actor = ผู้ทำรายการ · before = ค่าเดิม · after = ค่าใหม่ · entity = oem_setting/shop',
    not pg_temp.rej(r) and (select count(*) from analytics.crm_audit_log where action = 'oem_payment_lines_set') = n0 + 1
    and exists (select 1 from analytics.crm_audit_log a where a.action = 'oem_payment_lines_set' and a.shop_id = p_shop and a.actor = p_actor and a.entity_type = 'oem_setting' and a.entity_id = p_shop
                 and a.before = jsonb_build_object('seller_payment_lines', to_jsonb(lines_ok))
                 and a.after = jsonb_build_object('seller_payment_lines', to_jsonb(array['TEST-ONLY audit-1 (ห้ามใช้จริง)']))));
  n0 := (select count(*) from analytics.crm_audit_log where action = 'oem_payment_lines_set');
  update analytics.oem_setting set seller_payment_lines = array['TEST-ONLY direct-1 (ห้ามใช้จริง)'] where shop_id = p_shop;   -- เขียนตรง ไม่แตะ updated_by/updated_at
  v := v || pg_temp.chk('P2', 'เขียนตรง (UPDATE ไม่ผ่าน RPC · ไม่แตะ updated_by) -> audit 1 แถว · actor = null (ไม่โยนให้ "ผู้แก้คนก่อน") · before/after ถูก',
    (select count(*) from analytics.crm_audit_log where action = 'oem_payment_lines_set') = n0 + 1
    and exists (select 1 from analytics.crm_audit_log a where a.action = 'oem_payment_lines_set' and a.actor is null and a.shop_id = p_shop
                 and a.before = jsonb_build_object('seller_payment_lines', to_jsonb(array['TEST-ONLY audit-1 (ห้ามใช้จริง)']))
                 and a.after = jsonb_build_object('seller_payment_lines', to_jsonb(array['TEST-ONLY direct-1 (ห้ามใช้จริง)']))));
  n0 := (select count(*) from analytics.crm_audit_log where action = 'oem_payment_lines_set');
  update analytics.oem_setting set seller_payment_lines = array['TEST-ONLY direct-2 (ห้ามใช้จริง)'], updated_by = p_actor, updated_at = now() + interval '1 second' where shop_id = p_shop;   -- now() คงที่ทั้ง tx (traps ข้อ 22) ต้องตั้งให้ต่างจากค่าเดิมจริง
  v := v || pg_temp.chk('P3', 'เขียนตรงที่ตั้ง updated_by/updated_at เอง -> actor = ค่านั้น',
    (select count(*) from analytics.crm_audit_log where action = 'oem_payment_lines_set') = n0 + 1
    and exists (select 1 from analytics.crm_audit_log a where a.action = 'oem_payment_lines_set' and a.actor = p_actor
                 and a.after = jsonb_build_object('seller_payment_lines', to_jsonb(array['TEST-ONLY direct-2 (ห้ามใช้จริง)']))
                 and a.before = jsonb_build_object('seller_payment_lines', to_jsonb(array['TEST-ONLY direct-1 (ห้ามใช้จริง)']))));
  n0 := (select count(*) from analytics.crm_audit_log where action = 'oem_payment_lines_set');
  update analytics.oem_setting set seller_payment_lines = seller_payment_lines where shop_id = p_shop;
  update analytics.oem_setting set seller_terms = seller_terms where shop_id = p_shop;
  t := pg_temp.x(format($j$select analytics.oem_setting_upsert(p_shop_id=>s.shop_id, p_margin_target_pct=>s.margin_target_pct,
      p_margin_discount_cap_pct=>s.margin_discount_cap_pct, p_margin_floor_pct=>s.margin_floor_pct, p_margin_hard_floor_pct=>s.margin_hard_floor_pct,
      p_nre_max_share_pct=>s.nre_max_share_pct, p_min_job_value_thb=>s.min_job_value_thb, p_quote_valid_days_silver=>s.quote_valid_days_silver,
      p_quote_valid_days_gold=>s.quote_valid_days_gold, p_quote_valid_days_brass=>s.quote_valid_days_brass, p_bar_margin_pct=>s.bar_margin_pct,
      p_seller_legal_name=>s.seller_legal_name, p_seller_display_name=>s.seller_display_name, p_seller_branch_label=>s.seller_branch_label,
      p_seller_address_lines=>s.seller_address_lines, p_seller_tax_id=>s.seller_tax_id, p_seller_vat_registered=>s.seller_vat_registered,
      p_seller_phone=>s.seller_phone, p_seller_line=>s.seller_line, p_seller_email=>s.seller_email, p_seller_website=>s.seller_website,
      p_seller_terms=>s.seller_terms, p_deposit_default_pct=>s.deposit_default_pct) from analytics.oem_setting s where s.shop_id = %L$j$, p_shop));
  v := v || pg_temp.chk('P4', 'ไม่ขยับค่า (SET เท่าเดิม) · แก้คอลัมน์อื่น · oem_setting_upsert 23 args เดิม -> ไม่เกิดแถว audit ใหม่ (' || left(t, 50) || ')',
    t = 'OK' and (select count(*) from analytics.crm_audit_log where action = 'oem_payment_lines_set') = n0);
  n0 := (select count(*) from analytics.crm_audit_log where action = 'oem_payment_lines_set');
  insert into analytics.oem_setting select (jsonb_populate_record(null::analytics.oem_setting,
    to_jsonb(s) || jsonb_build_object('shop_id', shop2, 'seller_payment_lines', to_jsonb(array['TEST-ONLY insert-1 (ห้ามใช้จริง)'])))).* from analytics.oem_setting s where s.shop_id = p_shop;
  v := v || pg_temp.chk('P5', 'insert แถว oem_setting ตรงพร้อมช่องทางชำระไม่ว่าง -> audit 1 แถว (before = null) · insert ที่ {} ไม่ยิง',
    (select count(*) from analytics.crm_audit_log where action = 'oem_payment_lines_set') = n0 + 1
    and exists (select 1 from analytics.crm_audit_log a where a.action = 'oem_payment_lines_set' and a.shop_id = shop2 and a.before is null));
  v := v || pg_temp.chk('P6', 'audit.after/before มีคีย์ seller_payment_lines คีย์เดียว (ไม่มีข้อมูลร้านอื่นปนเข้า audit)',
    not exists (select 1 from analytics.crm_audit_log a where a.action = 'oem_payment_lines_set'
                 and ((select array_agg(k) from jsonb_object_keys(a.after) k) is distinct from array['seller_payment_lines']
                      or (a.before is not null and (select array_agg(k) from jsonb_object_keys(a.before) k) is distinct from array['seller_payment_lines']))));
  v := v || pg_temp.chk('P7', 'crm_audit_log ยัง append-only (UPDATE/DELETE แถว oem_payment_lines_set ถูกปฏิเสธ)',
    pg_temp.x(format('update analytics.crm_audit_log set actor = null where action = %L', 'oem_payment_lines_set')) like 'ERR:%'
    and pg_temp.x(format('delete from analytics.crm_audit_log where action = %L', 'oem_payment_lines_set')) like 'ERR:%');
  v := v || pg_temp.chk('P8', 'CHECK action ของ crm_audit_log: ยังรับ 11 action เดิมครบ + oem_payment_lines_set (12 ตัว) · ปฏิเสธ action แปลก (23514)',
    (select bool_and(pg_get_constraintdef(c.oid) like '%''' || a.x || '''%')
       from pg_constraint c cross join unnest(array['order_override_set','order_override_clear','customer_edit','pii_edit','note_add','note_edit','note_delete','customer_merge','merge_dismiss','province_set','province_revert','oem_payment_lines_set']) a(x)
      where c.conname = 'crm_audit_log_action_check' and c.conrelid = 'analytics.crm_audit_log'::regclass)
    and pg_temp.x(format($j$insert into analytics.crm_audit_log (shop_id, action, entity_type) values (%L, 'note_add', 'x')$j$, p_shop)) = 'OK'
    and pg_temp.x(format($j$insert into analytics.crm_audit_log (shop_id, action, entity_type) values (%L, 'not_an_action', 'x')$j$, p_shop)) like 'ERR:23514:%');
  v := v || pg_temp.chk('P9', 'ตั้งช่องทางชำระด้วย RPC แล้วล้มที่ด่านรูปร่าง (7 บรรทัด) ไม่ทำให้เกิด audit (ค่าไม่เปลี่ยน)',
    (select count(*) from analytics.crm_audit_log where action = 'oem_payment_lines_set') = n0 + 1
    and pg_temp.rej(pg_temp.spl(p_shop, array['TEST-ONLY a1','TEST-ONLY a2','TEST-ONLY a3','TEST-ONLY a4','TEST-ONLY a5','TEST-ONLY a6','TEST-ONLY a7'], p_actor))
    and (select count(*) from analytics.crm_audit_log where action = 'oem_payment_lines_set') = n0 + 1);
  update analytics.oem_setting set seller_payment_lines = lines_ok where shop_id = p_shop;

  -- ==================== C. M2 ตัวนับเลขเอกสาร ====================
  b := true; v_bad := '';
  foreach st in array array['insert', 'update', 'delete', 'truncate'] loop
    execute 'set local role service_role';
    begin
      if st = 'insert' then insert into analytics.oem_doc_counter (shop_id, doc_key, last_no) values (p_shop, 'ZZ-TEST', 1);
      elsif st = 'update' then update analytics.oem_doc_counter set last_no = last_no + 1 where shop_id = p_shop and doc_key = v_ivkey;
      elsif st = 'delete' then delete from analytics.oem_doc_counter where shop_id = p_shop and doc_key = v_ivkey;
      else truncate analytics.oem_doc_counter; end if;
      t2 := 'OK';
    exception when others then get stacked diagnostics t2 = returned_sqlstate; end;
    execute 'reset role';
    if t2 <> '42501' then b := false; v_bad := v_bad || st || '=' || t2 || ' '; end if;
  end loop;
  v := v || pg_temp.chk('C1', 'service_role INSERT/UPDATE/DELETE/TRUNCATE ตัวนับเลขเอกสารตรงๆ ถูกปฏิเสธที่ระดับสิทธิ์ (42501) ' || v_bad, b);
  execute 'set local role service_role';
  begin perform 1 from analytics.oem_doc_counter limit 1; t2 := 'OK'; exception when others then get stacked diagnostics t2 = returned_sqlstate; end;
  execute 'reset role';
  v := v || pg_temp.chk('C1b', 'service_role ยังอ่านตัวนับได้ (select)', t2 = 'OK');
  v := v || pg_temp.chk('C2', 'INSERT แถวตัวนับใหม่ที่ last_no <> 1 (0 / 2 / 999 / null) ถูกปฏิเสธ (22023/23502) · last_no = 1 ผ่าน',
    pg_temp.x(format('insert into analytics.oem_doc_counter (shop_id, doc_key, last_no) values (%L, %L, 0)', p_shop, 'ZZ-T0')) like 'ERR:22023:%'
    and pg_temp.x(format('insert into analytics.oem_doc_counter (shop_id, doc_key, last_no) values (%L, %L, 2)', p_shop, 'ZZ-T2')) like 'ERR:22023:%'
    and pg_temp.x(format('insert into analytics.oem_doc_counter (shop_id, doc_key, last_no) values (%L, %L, 999)', p_shop, 'ZZ-T9')) like 'ERR:22023:%'
    and pg_temp.x(format('insert into analytics.oem_doc_counter (shop_id, doc_key, last_no) values (%L, %L, null)', p_shop, 'ZZ-TN')) like 'ERR:2%'
    and pg_temp.x(format('insert into analytics.oem_doc_counter (shop_id, doc_key, last_no) values (%L, %L, 1)', p_shop, 'ZZ-T1')) = 'OK');
  t := pg_temp.x(format('insert into analytics.oem_doc_counter as c (shop_id, doc_key, last_no) values (%L, %L, 1) on conflict (shop_id, doc_key) do update set last_no = c.last_no + 1', p_shop, 'ZZ-T1'));
  n0 := (select last_no from analytics.oem_doc_counter where shop_id = p_shop and doc_key = 'ZZ-T1');
  t2 := pg_temp.x(format('insert into analytics.oem_doc_counter as c (shop_id, doc_key, last_no) values (%L, %L, 1) on conflict (shop_id, doc_key) do update set last_no = c.last_no + 2', p_shop, 'ZZ-T1'));
  v := v || pg_temp.chk('C3', 'INSERT ... ON CONFLICT DO UPDATE แบบที่ RPC ใช้ยังผ่าน (+1) · แต่ +2 ถูก trigger 0088 ปฏิเสธ (22023) (' || left(t, 50) || ' / n=' || coalesce(n0::text, 'null') || ' / ' || left(t2, 50) || ')',
    t = 'OK' and n0 = 2 and t2 like 'ERR:22023:%');
  -- C4: RPC ออกเลขยังทำงานแม้ผู้เรียกเป็น service_role ที่ไม่มีสิทธิ์เขียนตัวนับ (security definer owner postgres)
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  n0 := (select coalesce(max(last_no), 0) from analytics.oem_doc_counter where shop_id = p_shop and doc_key = v_ivkey);
  n1 := (select coalesce(max(last_no), 0) from analytics.oem_doc_counter where shop_id = p_shop and doc_key = v_rtkey);
  execute 'set local role service_role';
  begin
    inv := (analytics.oem_invoice_issue(p_shop, q, 'deposit', null, null, null, p_actor) ->> 'id')::uuid;
    t := 'OK';
  exception when others then get stacked diagnostics t = returned_sqlstate; t := 'ERR:' || t || ':' || sqlerrm; end;
  begin
    rid := analytics.oem_receipt_issue(p_shop_id => p_shop, p_quote_id => q, p_amount_thb => 500, p_received_date => v_today, p_kind => 'deposit', p_invoice_id => inv, p_actor_id => p_actor);
    t2 := 'OK';
  exception when others then get stacked diagnostics t2 = returned_sqlstate; t2 := 'ERR:' || t2 || ':' || sqlerrm; end;
  execute 'reset role';
  v := v || pg_temp.chk('C4', 'ผู้เรียก role=service_role จริง (ไม่มีสิทธิ์เขียนตัวนับ): oem_invoice_issue และ oem_receipt_issue ออกเลขได้ · IV +1 · RT +1 (' || left(t, 60) || ' / ' || left(t2, 60) || ')',
    t = 'OK' and t2 = 'OK'
    and (select last_no from analytics.oem_doc_counter where shop_id = p_shop and doc_key = v_ivkey) = n0 + 1
    and (select last_no from analytics.oem_doc_counter where shop_id = p_shop and doc_key = v_rtkey) = n1 + 1);
  -- C5: เดือนใหม่ (แถวตัวนับยังไม่มี): ใช้ร้านทดสอบ shop2 (ตัวนับของ shop2 ยังไม่มีแถวเลย = ทางสร้างแถวใหม่ด้วย INSERT last_no=1 ผ่าน trigger BEFORE INSERT)
  --     ไม่ย้ายคีย์ของร้านจริง (จะชนเลขใบจริงที่ออกแล้ว และไม่แตะใบจริงแม้ใน rollback)
  begin
    insert into public.shop_member (shop_id, user_id, role) values (shop2, p_actor, 'owner');
    q2 := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
    update analytics.oem_customer set shop_id = shop2 where id = (select customer_id from analytics.oem_quote where id = q2);
    update analytics.oem_quote set shop_id = shop2 where id = q2;
    update analytics.oem_quote_item set shop_id = shop2 where quote_id = q2;
    r := pg_temp.iss(shop2, q2, 'deposit', null, null, null, p_actor);
    r2 := pg_temp.rc(shop2, q2, 500, 'deposit', (r ->> 'id')::uuid, p_actor);
    b := not pg_temp.rej(r) and not pg_temp.rej(r2)
         and (select last_no from analytics.oem_doc_counter where shop_id = shop2 and doc_key = v_ivkey) = 1
         and (select last_no from analytics.oem_doc_counter where shop_id = shop2 and doc_key = v_rtkey) = 1
         and (select invoice_no from analytics.oem_invoice where id = (r ->> 'id')::uuid) = v_ivkey || '-001'
         and (select receipt_no from analytics.oem_receipt where id = (r2 ->> 'id')::uuid) = v_rtkey || '-001';
    t := coalesce((select invoice_no from analytics.oem_invoice where id = (r ->> 'id')::uuid), 'noinv') || '/' || coalesce((select receipt_no from analytics.oem_receipt where id = (r2 ->> 'id')::uuid), 'norc');
    raise exception 'rollback-test' using errcode = 'P0098';
  exception when sqlstate 'P0098' then null; end;
  v := v || pg_temp.chk('C5', 'เดือนใหม่ (ยังไม่มีแถวตัวนับ): RPC สร้างแถวด้วย INSERT last_no=1 ผ่าน trigger BEFORE INSERT · IV-YYMM-001 / RT-YYMM-001 ' || coalesce(left(r ->> '_err', 80), '') || ' ' || coalesce(left(r2 ->> '_err', 80), '') || ' ' || coalesce(t, ''), b is true);
  v := v || pg_temp.chk('C6', 'trigger BEFORE INSERT ไม่กระทบ trigger เดิม: TRUNCATE ยังถูกปฏิเสธ · UPDATE +2 / DELETE / เปลี่ยน doc_key ยังถูกปฏิเสธ (22023)',
    pg_temp.x('truncate analytics.oem_doc_counter') like 'ERR:22023:%'
    and pg_temp.x(format('update analytics.oem_doc_counter set last_no = last_no + 2 where shop_id = %L and doc_key = %L', p_shop, v_ivkey)) like 'ERR:22023:%'
    and pg_temp.x(format('delete from analytics.oem_doc_counter where shop_id = %L and doc_key = %L', p_shop, v_ivkey)) like 'ERR:22023:%'
    and pg_temp.x(format('update analytics.oem_doc_counter set doc_key = %L where shop_id = %L and doc_key = %L', 'IV-0001', p_shop, v_ivkey)) like 'ERR:22023:%');

  -- ==================== M1 L1 actor ต้องเป็นสมาชิกร้าน ====================
  v_bad := '';
  q := pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5);
  -- ร้านที่ actor ไม่ใช่สมาชิก (shop2) · ทุกเส้นทางตกที่ด่าน actor ก่อนถึงด่านอื่น
  r  := pg_temp.iss(shop2, q, 'deposit', null, null, null, p_actor);
  r2 := pg_temp.vd(shop2, gen_random_uuid(), 'ทดสอบ M1a', p_actor);
  r3 := pg_temp.spl(shop2, lines_ok, p_actor);
  if pg_temp.st(r) <> '42501' then v_bad := v_bad || 'invoice_issue=' || pg_temp.st(r) || ' '; end if;
  if pg_temp.st(r2) <> '42501' then v_bad := v_bad || 'invoice_void=' || pg_temp.st(r2) || ' '; end if;
  if pg_temp.st(r3) <> '42501' then v_bad := v_bad || 'set_payment_lines=' || pg_temp.st(r3) || ' '; end if;
  r := pg_temp.rc(shop2, q, 500, 'deposit', null, p_actor);
  if pg_temp.st(r) <> '42501' then v_bad := v_bad || 'receipt_issue(actor)=' || pg_temp.st(r) || ' '; end if;
  r := pg_temp.rc(shop2, q, 500, 'deposit', gen_random_uuid(), p_actor);
  if pg_temp.st(r) <> '42501' then v_bad := v_bad || 'receipt_issue(invoice+actor)=' || pg_temp.st(r) || ' '; end if;
  v := v || pg_temp.chk('M1a', 'actor ที่ไม่ใช่สมาชิกร้าน: oem_invoice_issue / oem_invoice_void / oem_setting_set_payment_lines / oem_receipt_issue (p_actor_id / p_invoice_id) ตก 42501 ' || v_bad, v_bad = '');
  -- staff (สมาชิกแต่ไม่ใช่ owner/admin) ตก · admin ผ่าน
  insert into public.shop_member (shop_id, user_id, role) values (shop2, p_actor, 'staff');
  r := pg_temp.iss(shop2, q, 'deposit', null, null, null, p_actor);
  v := v || pg_temp.chk('M1b', 'สมาชิก role=staff ตก 42501 (ต้อง owner/admin)', pg_temp.st(r) = '42501' and pg_temp.st(pg_temp.rc(shop2, q, 500, 'deposit', null, p_actor)) = '42501');
  delete from public.shop_member where shop_id = shop2 and user_id = p_actor;
  insert into public.shop_member (shop_id, user_id, role) values (shop2, p_actor, 'admin');
  r  := pg_temp.iss(shop2, q, 'deposit', null, null, null, p_actor);
  r3 := pg_temp.rc(shop2, q, 500, 'deposit', null, p_actor);
  v := v || pg_temp.chk('M1c', 'สมาชิก role=admin ผ่านด่าน actor (ไปตกด่านอื่นที่ไม่ใช่ 42501 — quote ไม่อยู่ในร้านนั้น)',
    pg_temp.st(r) <> '42501' and pg_temp.hint(r) = 'quote_not_found' and pg_temp.st(r3) <> '42501');
  delete from public.shop_member where shop_id = shop2 and user_id = p_actor;
  v := v || pg_temp.chk('M1d', 'actor = null: invoice_issue/void/set_payment_lines = actor_required (เดิม) · oem_receipt_issue ที่ส่ง p_invoice_id แต่ไม่ส่ง actor = actor_required',
    pg_temp.hint(pg_temp.iss(p_shop, q, 'deposit', null, null, null, null)) = 'actor_required'
    and pg_temp.hint(pg_temp.vd(p_shop, gen_random_uuid(), 'ทดสอบ M1d', null)) = 'actor_required'
    and pg_temp.hint(pg_temp.spl(p_shop, lines_ok, null)) = 'actor_required'
    and pg_temp.hint(pg_temp.rc(p_shop, q, 500, 'deposit', gen_random_uuid(), null)) = 'actor_required');
  v := v || pg_temp.chk('M1e', 'actor ที่ส่งมาแต่ไม่มีใน auth.users = actor_required (ทุกเส้นทาง) · ทางเดิมของใบเสร็จ (ไม่ส่งทั้ง invoice และ actor) ยังออกได้โดยไม่มี actor (ไม่พังของเดิม)',
    pg_temp.hint(pg_temp.iss(p_shop, q, 'deposit', null, null, null, gen_random_uuid())) = 'actor_required'
    and pg_temp.hint(pg_temp.rc(p_shop, q, 500, 'deposit', null, gen_random_uuid())) = 'actor_required'
    and not pg_temp.rej(pg_temp.rc(p_shop, pg_temp.mkq(p_shop, 'quoted', 1000, 'pct', 0.5), 500, 'deposit')));
  -- authenticated / anon (จำลองวันที่กำแพงสคีมาหลุด — traps 18.5): ยิง oem_receipt_issue 11 args / helper ตก 42501
  grant usage on schema analytics to authenticated, anon;
  b := true; v_bad := '';
  foreach st in array array['authenticated', 'anon'] loop
    execute format('set local role %I', st);
    begin perform analytics.oem_receipt_issue(null, null, null, null, null, null, null, null, null, null, null); t2 := 'OK'; exception when others then get stacked diagnostics t2 = returned_sqlstate; end;
    if t2 <> '42501' then b := false; v_bad := v_bad || st || '/receipt_issue=' || t2 || ' '; end if;
    begin perform analytics.oem_require_actor_member(null, null); t2 := 'OK'; exception when others then get stacked diagnostics t2 = returned_sqlstate; end;
    if t2 <> '42501' then b := false; v_bad := v_bad || st || '/helper=' || t2 || ' '; end if;
    begin perform analytics.oem_invoice_issue(null, null, null, null, null, null, null); t2 := 'OK'; exception when others then get stacked diagnostics t2 = returned_sqlstate; end;
    if t2 <> '42501' then b := false; v_bad := v_bad || st || '/invoice_issue=' || t2 || ' '; end if;
    begin perform 1 from analytics.v_oem_receipt limit 1; t2 := 'OK'; exception when others then get stacked diagnostics t2 = returned_sqlstate; end;
    if t2 <> '42501' then b := false; v_bad := v_bad || st || '/v_oem_receipt=' || t2 || ' '; end if;
    execute 'reset role';
  end loop;
  revoke usage on schema analytics from authenticated, anon;
  v := v || pg_temp.chk('M1f', 'authenticated/anon (จำลอง grant usage กลับ): ยิง oem_receipt_issue 11 args / helper / invoice_issue / select v_oem_receipt ตก 42501 ทุกตัว ' || v_bad, b);

  -- ==================== N20 ยิงใส่ใบจริงทุกสถานะ/ทุกโหมด (โคลน) — ตัวใหม่ (ไม่ส่ง invoice) = ตัวเดิมเป๊ะ + ผูกใบแจ้งหนี้ได้ที่ใบที่ควรได้ ====================
  n0 := 0; n1 := 0; n2 := 0; n3 := 0; v_bad := '';
  for rec in select q0.id, q0.quote_no, q0.status from analytics.oem_quote q0
              where q0.shop_id = p_shop and q0.quote_no not like 'V17%-%' and q0.quote_no not like 'V18%-%' and q0.quote_no not like 'QA-%' order by q0.quote_no loop
    n0 := n0 + 1;
    qa := pg_temp.clone_real(rec.id);
    qb := pg_temp.clone_real(rec.id);
    r  := pg_temp.rcl(p_shop, qa, 1.00, 'partial');
    r2 := pg_temp.rc(p_shop, qb, 1.00, 'partial');
    if pg_temp.rej(r) is distinct from pg_temp.rej(r2) or (r ->> '_err') is distinct from (r2 ->> '_err') or pg_temp.st(r) is distinct from pg_temp.st(r2) then
      v_bad := v_bad || rec.quote_no || '(' || rec.status || ' เดิม=' || coalesce(left(r ->> '_err', 40), 'ok') || ' ใหม่=' || coalesce(left(r2 ->> '_err', 40), 'ok') || ') ';
    elsif not pg_temp.rej(r2) then
      n1 := n1 + 1;
      if pg_temp.rimg((r ->> 'id')::uuid) is distinct from pg_temp.rimg((r2 ->> 'id')::uuid) then v_bad := v_bad || rec.quote_no || '(แถวใบเสร็จต่าง) '; end if;
    else
      n2 := n2 + 1;
    end if;
    -- ผูกใบแจ้งหนี้: ใบที่ออกใบแจ้งหนี้ได้ (quoted/expired/won ที่ผ่านด่านของ 0179) ต้องผูกใบเสร็จได้เมื่อยอดตรง · ที่ออกใบแจ้งหนี้ไม่ได้ต้องตกด้วยด่านของ 0179 (22023)
    qc := pg_temp.clone_real(rec.id);
    foreach st in array array['deposit', 'balance'] loop
      r := pg_temp.iss(p_shop, qc, st, null, null, null, p_actor);
      if not pg_temp.rej(r) then
        r2 := pg_temp.rc(p_shop, qc, (select amount_thb from analytics.oem_invoice where id = (r ->> 'id')::uuid), case st when 'deposit' then 'deposit' else 'final' end, (r ->> 'id')::uuid, p_actor);
        if pg_temp.rej(r2) then
          -- ปฏิเสธที่ด่านเดิมของ 0084-0088 (เช่น ผู้ซื้อมี tax_id แต่ที่อยู่ไม่ครบ · จ่ายเกิน) ยอมรับได้ถ้าเป็น 22023 และไม่ใช่ด่านใหม่ของ 0180 (invoice_*)
          if pg_temp.st(r2) = '22023' and pg_temp.hint(r2) not like 'invoice\_%' and pg_temp.hint(r2) <> 'reissue_invoice_mismatch' then n3 := n3 + 1;
          else v_bad := v_bad || rec.quote_no || '/' || st || '(ผูกไม่ได้ ' || coalesce(left(r2 ->> '_err', 60), '') || ') '; end if;
        else
          if (select payment_state from analytics.v_oem_invoice where id = (r ->> 'id')::uuid) is distinct from 'paid' then v_bad := v_bad || rec.quote_no || '/' || st || '(ผูกแล้วไม่ paid) '; end if;
          n3 := n3 + 1;
        end if;
        exit;
      end if;
    end loop;
    if rec.quote_no = 'OEM-2610-004' then
      -- ใบจริงที่มี IV-2610-001 (มัดจำ 56,800.00) ออกอยู่แล้ว: บนโคลนต้องออกใบแจ้งหนี้มัดจำ + ผูกใบเสร็จ 56,800.00 ได้ (ยอดตรงกับ IV จริงบน prod)
      q := pg_temp.clone_real(rec.id);
      inv := pg_temp.mkinv(p_shop, q, 'deposit', p_actor);
      r := pg_temp.rc(p_shop, q, 56800.00, 'deposit', inv, p_actor);
      v := v || pg_temp.chk('N20a', 'โคลนของใบจริง OEM-2610-004 (quoted · breakdown · มัดจำ pct): ออกใบแจ้งหนี้มัดจำ 56,800.00 + ผูกใบเสร็จ 56,800.00 -> paid ' || coalesce(left(r ->> '_err', 80), ''),
        inv is not null and not pg_temp.rej(r) and (select payment_state = 'paid' and amount_thb = 56800.00 from analytics.v_oem_invoice where id = inv)
        and (select status = 'won' from analytics.oem_quote where id = q));
    end if;
  end loop;
  if n0 = 0 then
    v := v || '[SKIP] N20  ไม่มีใบเสนอราคาจริงบน DB — พิสูจน์ "ยิงใส่ข้อมูลจริงทุกโหมด" ไม่ได้' || E'\n';
  else
    v := v || pg_temp.chk('N20', format('โคลนของใบจริงทุกใบ %s ใบ: ใบเสร็จทางเดิม (ไม่ส่ง invoice) ตัวใหม่ = ตัวเดิมเป๊ะ (ผ่านเหมือนกัน %s · ปฏิเสธข้อความเดียวกัน %s) · ผูกใบแจ้งหนี้สำเร็จ/ปฏิเสธด้วยด่านเดิม %s ใบ · ผิดปกติ: %s',
      n0, n1, n2, n3, coalesce(nullif(v_bad, ''), '(ไม่มี)')), v_bad = '');
  end if;

  return v;
end;
$s$;

-- snapshot ของข้อมูลที่ไม่ควรขยับ (ตัวนับ/ใบเสร็จ/quote/ใบแจ้งหนี้/audit ทุกตาราง/ตั้งค่า/ผู้ซื้อ/รายการ/ร้าน/สมาชิก/job_*)
create function pg_temp.snap() returns text language sql as $c$
  select concat_ws('|',
    (select coalesce(md5(string_agg(shop_id::text || doc_key || last_no::text, ',' order by shop_id, doc_key)), '') from analytics.oem_doc_counter),
    (select coalesce(md5(string_agg(to_jsonb(r)::text, ',' order by r.id)), '') from analytics.oem_receipt r),
    (select coalesce(md5(string_agg(q.id::text || q.status || coalesce(q.grand_total, 0)::text || q.updated_at::text, ',' order by q.id)), '') from analytics.oem_quote q),
    (select count(distinct updated_at)::text from analytics.oem_quote),
    (select coalesce(md5(string_agg(to_jsonb(i)::text, ',' order by i.id)), '') from analytics.oem_invoice i),
    (select count(*)::text from analytics.oem_quote_audit),
    (select count(*)::text from analytics.crm_audit_log),
    (select coalesce(md5(string_agg(to_jsonb(s)::text, ',' order by s.shop_id)), '') from analytics.oem_setting s),
    (select count(*)::text from analytics.oem_customer),
    (select count(*)::text from analytics.oem_quote_item),
    (select count(*)::text from public.shop),
    (select count(*)::text from public.shop_member),
    (select coalesce(md5(string_agg(md5(pg_get_functiondef(p.oid)), '' order by p.oid::regprocedure::text)), '') from pg_proc p
      where p.pronamespace = 'analytics'::regnamespace and p.proname like 'job\_%'))
$c$;

-- นิยาม/สิทธิ์ของ object ที่แตะ (ใช้พิสูจน์ว่า mutant ถูกคืนของเดิมครบ)
create function pg_temp.defs() returns text language sql as $c$
  select concat_ws('|',
    (select coalesce(md5(string_agg(md5(pg_get_functiondef(p.oid)) || coalesce(p.proacl::text, ''), '' order by p.oid::regprocedure::text)), '') from pg_proc p
      where p.pronamespace = 'analytics'::regnamespace
        and p.proname in ('oem_receipt_issue', 'oem_invoice_issue', 'oem_invoice_void', 'oem_setting_set_payment_lines', 'oem_require_actor_member',
                          'oem_receipt_check_invoice_link', 'oem_setting_payment_lines_audit', 'oem_doc_counter_deny_insert')),
    md5(pg_get_viewdef('analytics.v_oem_invoice'::regclass)), md5(pg_get_viewdef('analytics.v_oem_receipt'::regclass)),
    (select md5(coalesce(relacl::text, '')) from pg_class where oid = 'analytics.oem_doc_counter'::regclass),
    (select md5(coalesce(relacl::text, '')) from pg_class where oid = 'analytics.oem_receipt'::regclass),
    (select md5(string_agg(indexdef, ',' order by indexname)) from pg_indexes where schemaname = 'analytics' and tablename = 'oem_receipt'),
    (select md5(string_agg(tgrelid::regclass::text || tgname || tgenabled::text, ',' order by tgrelid::regclass::text, tgname)) from pg_trigger
      where tgrelid in ('analytics.oem_receipt'::regclass, 'analytics.oem_doc_counter'::regclass, 'analytics.oem_setting'::regclass, 'analytics.oem_invoice'::regclass) and not tgisinternal))
$c$;

do $v180$
declare
  v_log   text := E'\n=== verify-0180 (ผูกใบเสร็จกับใบแจ้งหนี้ I2 + M1/M2/L1) ===\n';
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
  -- actor = owner/admin จริงของร้าน (L1 บังคับสมาชิก — 0179 ใช้ user คนแรกของระบบ ไม่พอแล้ว)
  select m2.user_id into v_actor from public.shop_member m2 where m2.shop_id = v_shop and m2.role in ('owner', 'admin') order by m2.created_at limit 1;
  if v_shop is null or v_actor is null then
    raise exception E'[SKIP] ไม่มีร้าน/ใบแม่แบบ OEM-2610-004/สมาชิก owner-admin ให้ทำ fixture — พิสูจน์ไม่ได้';
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
  v_log := v_log || pg_temp.chk('Z1', 'หลังรอบแรก: ตัวนับ RT+IV · ใบเสร็จ · quote · ใบแจ้งหนี้ · audit (oem_quote_audit + crm_audit_log) · ตั้งค่า · ผู้ซื้อ · รายการ · ร้าน · สมาชิก · job_* ไม่ขยับ (suite รันใน subtransaction ที่ rollback)', pg_temp.snap() = v_snap);

  -- ---------- mutant: แก้ของจริงใน subtransaction แล้วเรียก suite เดิม ต้องมีเคสที่ระบุล้มจริง ----------
  v_muts := $m$[
   {"id":"MU01","kind":"fn","target":"analytics.oem_receipt_issue(uuid,uuid,numeric,date,text,text,text,text,uuid,uuid,uuid)","pre_sql":"alter table analytics.oem_receipt disable trigger trg_oem_receipt_check_invoice_link","from":"if p_amount_thb is distinct from v_inv.amount_thb then","to":"if false then","expect":["L05a","L05b"]},
   {"id":"MU02","kind":"fn","target":"analytics.oem_receipt_issue(uuid,uuid,numeric,date,text,text,text,text,uuid,uuid,uuid)","from":"when 'balance' then 'final' end) then","to":"when 'balance' then 'partial' end) then","expect":["L02b","L05d"]},
   {"id":"MU03","kind":"fn","target":"analytics.oem_receipt_issue(uuid,uuid,numeric,date,text,text,text,text,uuid,uuid,uuid)","pre_sql":"alter table analytics.oem_receipt disable trigger trg_oem_receipt_check_invoice_link","from":"if v_inv_root is distinct from coalesce(v_quote.root_quote_id, v_quote.id) then","to":"if false then","expect":["L05e"]},
   {"id":"MU04","kind":"fn","target":"analytics.oem_receipt_issue(uuid,uuid,numeric,date,text,text,text,text,uuid,uuid,uuid)","from":"if coalesce(v_inv_state.is_stale, true) then","to":"if false then","expect":["L05h","L05i"]},
   {"id":"MU05","kind":"fn","target":"analytics.oem_receipt_issue(uuid,uuid,numeric,date,text,text,text,text,uuid,uuid,uuid)","from":"if not found or v_inv_state.payment_state is distinct from 'unpaid' then","to":"if false then","expect":["L05j"]},
   {"id":"MU06","kind":"fn","target":"analytics.oem_receipt_issue(uuid,uuid,numeric,date,text,text,text,text,uuid,uuid,uuid)","from":"if p_reissued_from is not null and v_reissued_from_invoice_id is distinct from p_invoice_id then","to":"if false then","expect":["L04a","L04b","L04c"]},
   {"id":"MU07","kind":"view","target":"analytics.v_oem_invoice","from":"WHEN (rc.id IS NOT NULL) THEN 'paid'::text","to":"WHEN false THEN 'paid'::text","expect":["L01b","L03c","L08a"]},
   {"id":"MU08","kind":"fn","target":"analytics.oem_require_actor_member(uuid,uuid)","from":"m.role in ('owner', 'admin')","to":"m.role in ('owner', 'admin', 'staff')","expect":["M1b"]},
   {"id":"MU09","kind":"fn","target":"analytics.oem_invoice_issue(uuid,uuid,text,date,text,uuid,uuid)","from":"perform analytics.oem_require_actor_member(p_shop_id, v_actor);","to":"null;","expect":["M1a","X1d"]},
   {"id":"MU10","kind":"sql","sql":"drop trigger trg_oem_doc_counter_deny_insert on analytics.oem_doc_counter","expect":["C2","A3"]},
   {"id":"MU11","kind":"sql","sql":"grant insert on analytics.oem_doc_counter to service_role","expect":["C1"]},
   {"id":"MU12","kind":"sql","sql":"drop trigger trg_oem_setting_payment_lines_audit_upd on analytics.oem_setting","expect":["P1","P2","A3"]},
   {"id":"MU13","kind":"sql","sql":"grant execute on function analytics.oem_receipt_issue(uuid, uuid, numeric, date, text, text, text, text, uuid, uuid, uuid) to authenticated","expect":["A2","M1f"]},
   {"id":"MU14","kind":"sql","sql":"drop trigger trg_oem_receipt_check_invoice_link on analytics.oem_receipt","expect":["L07c","A3"]},
   {"id":"MU15","kind":"sql","sql":"drop index analytics.oem_receipt_one_issued_per_invoice","expect":["L07a","A3"]},
   {"id":"MU16","kind":"fn","target":"analytics.oem_setting_payment_lines_audit()","from":"then new.updated_by end;","to":"then new.updated_by else new.updated_by end;","expect":["P2"]},
   {"id":"MU17","kind":"fn","target":"analytics.oem_receipt_issue(uuid,uuid,numeric,date,text,text,text,text,uuid,uuid,uuid)","from":"v_vat_amount := p_amount_thb - v_vat_base;","to":"v_vat_amount := round(p_amount_thb * v_quote.vat_rate, 2);","expect":["G1"]},
   {"id":"MU18","kind":"fn","target":"analytics.oem_receipt_issue(uuid,uuid,numeric,date,text,text,text,text,uuid,uuid,uuid)","from":"perform analytics.oem_require_actor_member(p_shop_id, v_actor);","to":"null;","expect":["M1a"]},
   {"id":"MU19","kind":"fn","target":"analytics.oem_doc_counter_deny_insert()","from":"if new.last_no is distinct from 1 then","to":"if false then","expect":["C2"]},
   {"id":"MU20","kind":"sql","sql":"alter table analytics.oem_receipt drop constraint oem_receipt_invoice_pair_check","expect":["L07e","A3"]}
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
      if m ? 'pre_sql' then execute m ->> 'pre_sql'; end if;
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

  v_log := v_log || pg_temp.chk('Z2', 'หลัง mutant ทั้งหมด: นิยามฟังก์ชัน/trigger/view/ACL/index ของ object ที่แตะคืนเท่าเดิมเป๊ะ (md5)', pg_temp.defs() = v_defs);
  v_log := v_log || pg_temp.chk('Z3', 'หลัง mutant ทั้งหมด: ข้อมูล (ตัวนับ RT+IV · ใบเสร็จ · quote · ใบแจ้งหนี้ · audit · ตั้งค่า · สมาชิก · job_*) ไม่ขยับ', pg_temp.snap() = v_snap);

  v_nfail := (length(v_log) - length(replace(v_log, '[FAIL]', ''))) / 6;
  v_nok := (length(v_log) - length(replace(v_log, '[OK]', ''))) / 4;
  v_log := v_log || format(E'\nสรุป: OK %s · FAIL %s %s\n', v_nok, v_nfail, case when v_nfail = 0 then '(ผ่านทั้งหมด)' else '🔴 มีเคสไม่ผ่าน' end);
  -- raise ปิดท้ายเสมอ = บังคับ rollback ทั้งก้อน (ผลทดสอบออกทาง message)
  raise exception '%', v_log;
end
$v180$;
