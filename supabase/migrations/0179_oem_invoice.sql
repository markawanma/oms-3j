-- 0179_oem_invoice.sql
-- ใบแจ้งหนี้ OEM (phase I1) — แจ้งยอดมัดจำ (deposit) + แจ้งยอดคงเหลือ (balance) ต่อจากใบเสนอราคา
-- design: docs/3j-jewelry/analytics/design-oem-invoice.md (§0-§9 · §11 · §14 · §15 มติเจ้าของ 16 ต.ค. 69)
--
-- 🔴 apply ด้วย `node scripts/run-sql.mjs supabase/migrations/0179_oem_invoice.sql --commit --record` เท่านั้น
--    ห้าม `supabase db push` · ไฟล์ต้องเป็น LF (ข้อ 20 ของ 3j-migration-traps) · dry-run ก่อนเสมอ (ไม่ใส่ --commit)
--    ยังไม่ apply — รอ security (💰 เอกสารการเงิน + ตัวนับเลขเอกสาร)
--
-- ใบแจ้งหนี้ ไม่ใช่ใบกำกับภาษี — ใบกำกับภาษียังออกตอนรับเงินแบบเดิม (0084/0088 oem_receipt_issue ไม่ถูกแตะในไฟล์นี้)
-- การผูกใบเสร็จเข้ากับใบแจ้งหนี้ (oem_receipt.invoice_id) = 0180 (I2) ยังไม่ทำ — ไฟล์นี้ใช้ได้เองแบบ flow C:
--    ออกใบแจ้งหนี้ -> รับเงินแบบเดิม (ไม่อ้างใบ) -> ใบแจ้งหนี้ตีเป็น is_stale -> void -> ออกใบใหม่
--
-- สิ่งที่ไฟล์นี้ทำ
--   1. oem_setting.seller_payment_lines text[] (ช่องทางชำระ — ค่าจริงเจ้าของกรอกเอง repo ห้ามมีเลขบัญชี) + RPC ตั้งค่าแยก
--      oem_setting_set_payment_lines + append คอลัมน์ท้าย v_oem_seller (ไม่แตะ oem_setting_upsert — เปลี่ยน arg list = overload, traps ข้อ 1)
--   2. ขยาย CHECK ของ oem_quote_audit.action ให้รับ invoice_issue / invoice_void
--   3. ตาราง analytics.oem_invoice (frozen snapshot · issued -> void ทางเดียว · trigger กัน UPDATE/DELETE/TRUNCATE แบบ 0086)
--   4. view analytics.v_oem_invoice (derived: payment_state / is_stale / is_overdue — ไม่เก็บในตาราง · ห้าม select ต้นทุน/margin)
--   5. RPC oem_invoice_issue (client ส่งแค่ kind + due_date + note — ไม่ส่งยอด) / oem_invoice_void
--   เลขที่ IV-YYMM-NNN = แถวใหม่ใน oem_doc_counter (doc_key 'IV-YYMM') · trigger 0088 คุมทุก doc_key อยู่แล้ว · ตัวนับ RT ไม่ขยับ
--
-- มติเจ้าของ (§15) ที่ฝังอยู่ใน RPC
--   - ใบมัดจำ = "ชำระก่อนเริ่มงาน": due_date ค่าเริ่ม = วันที่ออก (ไทย) + คอลัมน์ pay_before_work = true (หน้าพิมพ์ใช้พิมพ์ข้อความ)
--   - ใบคงเหลือ: ค่าเริ่ม due_date = วันที่ออก + 7 วัน (ออกตอนส่งมอบ) · ส่งเองได้ทุกใบ (>= วันนี้ไทย, <= +365)
--   - ใบเสนอราคาหมดอายุ (expired) ออกได้ — DB อนุญาต quoted/expired/won · เตือนฝั่ง UI (deal_quote_expired ใน view)
--   - รอบนี้ kind = deposit / balance เท่านั้น · installment = phase ถัดไป (ประตูเปิดที่ CHECK kind + ด่านเปิดค้าง 1 ใบ/ดีล)
--
-- กับดัก (3j-migration-traps) ที่ไฟล์นี้ตั้งใจเลี่ยง
--   ข้อ 1  ฟังก์ชันใหม่ทั้งหมด + ท้ายไฟล์ assert ว่าแต่ละชื่อมี signature เดียว (ไม่มี overload)
--   ข้อ 3  v_oem_seller: คอลัมน์เดิม 13 ตัวเป็น prefix เดิมเป๊ะ (ลอกจาก pg_get_viewdef บน DB จริง) ต่อท้าย 1 คอลัมน์
--          v_oem_quote ไม่แตะเลย (0172-0174 join อยู่ 9 จุด)
--   ข้อ 4/13 ด่านตัวเลขใช้ not (x > 0 and x <= max) ไม่ใช้ is null / <= 0 · ด่านเหตุผลใช้ oem_note_present (whitelist) ไม่ใช้ btrim(x) = ''
--   ข้อ 6  วันทางธุรกิจ = (now() at time zone 'Asia/Bangkok')::date ทุกจุด (issue_date / due gate / is_overdue / YYMM)
--   ข้อ 18 ทุก object ใหม่ grant ให้ service_role เท่านั้น · revoke public/anon/authenticated ครบสามชื่อ (ไม่ลอก grant authenticated ของ 0088)
--   ข้อ 19 ไม่มี UPDATE ตารางเดิมในไฟล์นี้นอกจาก DDL (add column default {} ไม่ยิง trigger)
--
-- ⚠️ ข้อจำกัดที่รู้ตัว (รายงานใน handoff): (ก) ไม่มีตารางประวัติการแก้ช่องทางชำระ — ร่องรอยคือ snapshot บนใบที่ออกแล้ว + updated_by/updated_at
--   (ข) ข้อความ error ของ trg_oem_doc_counter_deny_mutation อ้าง oem_receipt_issue (หนี้เล็ก §14 ข้อ 10 ไม่แก้ฟังก์ชัน trigger ของเอกสารภาษี)
--   (ค) payment_state ใน 0179 มีแค่ void/unpaid — 'paid' ต้องรอ 0180 (ใบเสร็จอ้างใบแจ้งหนี้) · view ถูกออกแบบให้ 0180 แค่ create or replace ต่อท้าย

-- ============================================================================
-- 1. ช่องทางชำระเงิน — oem_setting.seller_payment_lines + v_oem_seller + RPC ตั้งค่า
-- ============================================================================
-- add column default '{}' not null = metadata-only ไม่ยิง trigger ไม่ทับแถวเดิม (ไม่มี UPDATE)
alter table analytics.oem_setting
  add column if not exists seller_payment_lines text[] not null default '{}';

comment on column analytics.oem_setting.seller_payment_lines is
  '0179: ช่องทางชำระเงินที่พิมพ์บนใบแจ้งหนี้ — บรรทัดละ 1 ช่องทาง (<= 6 บรรทัด <= 200 ตัวอักษร) ค่าจริงเจ้าของกรอกเองในหน้าตั้งค่า ว่าง = ออกใบแจ้งหนี้ไม่ได้ · แก้ผ่าน analytics.oem_setting_set_payment_lines เท่านั้น (ไม่อยู่ใน oem_setting_upsert) · ใบที่ออกแล้วเก็บ snapshot ของตัวเอง เปลี่ยนที่นี่ใบเก่าไม่ขยับ';

alter table analytics.oem_setting drop constraint if exists oem_setting_payment_lines_shape;
alter table analytics.oem_setting
  add constraint oem_setting_payment_lines_shape check (cardinality(seller_payment_lines) <= 6);

-- v_oem_seller: select list ลอกจาก pg_get_viewdef บน DB จริง (16 ต.ค. 69 · 13 คอลัมน์) + append ท้าย 1 คอลัมน์ (traps ข้อ 3)
create or replace view analytics.v_oem_seller with (security_invoker = true) as
 select shop_id,
    seller_legal_name,
    seller_display_name,
    seller_branch_label,
    seller_address_lines,
    seller_tax_id,
    seller_vat_registered,
    seller_phone,
    seller_line,
    seller_email,
    seller_website,
    seller_terms,
    deposit_default_pct,
    seller_payment_lines
   from analytics.oem_setting;

create or replace function analytics.oem_setting_set_payment_lines(
  p_shop_id  uuid,
  p_lines    text[],
  p_actor_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public, analytics, extensions, pg_temp
as $f$
declare
  v_actor uuid;
  v_clean text[] := '{}';
  l       text;
begin
  if p_shop_id is null then
    raise exception 'oem_setting_set_payment_lines: p_shop_id จำเป็น' using errcode = '22023';
  end if;
  -- null = ไม่ใช่ "ล้างค่า" — ส่ง array ว่างถ้าต้องการล้าง (กัน client ลืมส่งแล้วบัญชีหาย)
  if p_lines is null then
    raise exception 'oem_setting_set_payment_lines: p_lines ห้ามเป็น null (ต้องการล้างค่าให้ส่ง array ว่าง)' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);
  -- actor มาจาก session ฝั่ง server เท่านั้น (ห้ามรับจาก client) · ช่องทางชำระเปลี่ยน = เปลี่ยนที่ลูกค้าโอนเงิน จึงต้องรู้ว่าใครแก้
  v_actor := coalesce(auth.uid(), (select u.id from auth.users u where u.id = p_actor_id));
  if v_actor is null then
    raise exception 'oem_setting_set_payment_lines: ต้องระบุผู้ทำรายการ (p_actor_id ที่มีอยู่จริง)' using errcode = '22023', hint = 'actor_required';
  end if;

  foreach l in array p_lines loop
    -- แถวว่างจาก textarea (ว่างจริงหรือเว้นวรรคล้วน) ข้ามเงียบๆ · อักขระล่องหน/วรรคตอนล้วนไม่ถูกข้าม — ตกที่ด่านด้านล่าง
    if l is null or btrim(l) = '' then
      continue;
    end if;
    if position(chr(10) in l) > 0 or position(chr(13) in l) > 0 then
      raise exception 'oem_setting_set_payment_lines: 1 ช่องทางต่อ 1 บรรทัด — ห้ามมีการขึ้นบรรทัดใหม่ภายในบรรทัดเดียว' using errcode = '22023';
    end if;
    if not (analytics.oem_note_valid(l) and analytics.oem_note_present(l)) or char_length(btrim(l)) > 200 then
      raise exception 'oem_setting_set_payment_lines: แต่ละบรรทัดต้องมีตัวอักษร/ตัวเลขจริง ยาวไม่เกิน 200 ตัวอักษร และห้ามมีอักขระควบคุม/ล่องหน' using errcode = '22023';
    end if;
    v_clean := v_clean || btrim(l);
  end loop;

  if cardinality(v_clean) > 6 then
    raise exception 'oem_setting_set_payment_lines: ช่องทางชำระเงินมีได้ไม่เกิน 6 บรรทัด (ส่งมา %)', cardinality(v_clean) using errcode = '22023';
  end if;

  update analytics.oem_setting
     set seller_payment_lines = v_clean, updated_by = v_actor, updated_at = now()
   where shop_id = p_shop_id;
  if not found then
    raise exception 'oem_setting_set_payment_lines: ร้านนี้ยังไม่มีแถวตั้งค่า OEM — บันทึกข้อมูลร้านก่อน' using errcode = '22023';
  end if;
end;
$f$;

revoke execute on function analytics.oem_setting_set_payment_lines(uuid, text[], uuid) from public, anon, authenticated;
grant execute on function analytics.oem_setting_set_payment_lines(uuid, text[], uuid) to service_role;

-- ============================================================================
-- 2. oem_quote_audit — ขยาย CHECK action ให้รับ invoice_issue / invoice_void
--    (ตารางจาก 0165 append-only ด้วย trigger — DDL ของ constraint ไม่ยิง trigger · ไม่สร้างตาราง audit ใหม่)
--    ชื่อ constraint ตรวจจาก pg_constraint บน DB จริงแล้ว (oem_quote_audit_action_check)
-- ============================================================================
alter table analytics.oem_quote_audit drop constraint if exists oem_quote_audit_action_check;
alter table analytics.oem_quote_audit
  add constraint oem_quote_audit_action_check
  check (action in ('customer_edit', 'invoice_issue', 'invoice_void'));

-- ============================================================================
-- 3. analytics.oem_invoice — เอกสารตายตัว: frozen snapshot · issued -> void ทางเดียว
-- ============================================================================
create table if not exists analytics.oem_invoice (
  id                       uuid primary key default gen_random_uuid(),
  shop_id                  uuid not null references public.shop (id) on delete cascade,
  -- แถว quote ที่ออกใบ ณ ตอนนั้น · ต่อราคาแล้ว "ไม่ re-point" (เหมือนใบเสร็จ) — view หาแถว active ของดีลเอง
  quote_id                 uuid not null references analytics.oem_quote (id) on delete restrict,
  invoice_no               text not null,
  kind                     text not null,
  status                   text not null default 'issued',
  amount_thb               numeric(14,2) not null,
  -- VAT: ตัดสินครั้งเดียวตอนออก · 'none' = ร้านไม่จด VAT -> ทุกช่อง VAT เป็น null (กระดาษห้ามมีคำว่าภาษีมูลค่าเพิ่ม)
  vat_display              text not null,
  vat_rate                 numeric(6,4),
  vat_base_thb             numeric(14,2),
  vat_amount_thb           numeric(14,2),
  issue_date               date not null,
  due_date                 date not null,
  -- มติเจ้าของ 16 ต.ค. 69: ใบมัดจำ = "ชำระก่อนเริ่มงาน" — แช่แข็งเป็น flag ให้หน้าพิมพ์พิมพ์ข้อความ (ถ้านโยบายเปลี่ยน ใบเก่าไม่ขยับ)
  pay_before_work          boolean not null,
  description              text not null,
  note                     text,
  seller_snapshot          jsonb not null,
  payment_lines            text[] not null,
  buyer_legal_name         text not null,
  buyer_tax_id             text,
  buyer_branch_label       text,
  buyer_address            jsonb,
  quote_no_snapshot        text not null,
  lines_snapshot           jsonb not null,
  pieces_subtotal_snapshot numeric(14,2) not null,
  nre_price_snapshot       numeric(14,2) not null default 0,
  discount_thb_snapshot    numeric(14,2) not null default 0,
  grand_total_snapshot     numeric(14,2) not null,
  deposit_amount_snapshot  numeric(14,2),
  deposit_pct_snapshot     numeric(5,4),
  paid_before_thb          numeric(14,2) not null,
  balance_after_thb        numeric(14,2) not null,
  void_reason              text,
  voided_at                timestamptz,
  voided_by                uuid,
  replaces_invoice_id      uuid references analytics.oem_invoice (id) on delete restrict,
  created_by               uuid,
  created_at               timestamptz not null default now(),
  constraint oem_invoice_shop_no_key unique (shop_id, invoice_no),
  -- kind: ประตูเปิดสำหรับ installment ที่ CHECK นี้ (ต้องทบทวนด่านเปิดค้าง 1 ใบ/ดีล ตอนนั้น)
  constraint oem_invoice_kind_check check (kind in ('deposit', 'balance')),
  constraint oem_invoice_status_check check (status in ('issued', 'void')),
  constraint oem_invoice_no_shape check (invoice_no ~ '^IV-[0-9]{4}-[0-9]{3,}$'),
  constraint oem_invoice_amount_range check (amount_thb > 0 and amount_thb <= 100000000),
  constraint oem_invoice_vat_display_check check (vat_display in ('none', 'included', 'breakdown')),
  constraint oem_invoice_vat_shape check (
    (vat_display = 'none' and vat_rate is null and vat_base_thb is null and vat_amount_thb is null)
    or (vat_display <> 'none' and vat_rate is not null and vat_rate >= 0 and vat_rate < 1
        and vat_base_thb is not null and vat_amount_thb is not null and vat_base_thb + vat_amount_thb = amount_thb)
  ),
  constraint oem_invoice_due_after_issue check (due_date >= issue_date),
  constraint oem_invoice_pay_before_work_deposit check (pay_before_work = (kind = 'deposit')),
  constraint oem_invoice_balance_exact check (
    paid_before_thb >= 0 and balance_after_thb >= 0 and grand_total_snapshot > 0
    and paid_before_thb + amount_thb + balance_after_thb = grand_total_snapshot
  ),
  constraint oem_invoice_balance_kind_zero check (kind <> 'balance' or balance_after_thb = 0),
  constraint oem_invoice_payment_lines_shape check (cardinality(payment_lines) between 1 and 6),
  constraint oem_invoice_lines_shape check (jsonb_typeof(lines_snapshot) = 'array' and jsonb_array_length(lines_snapshot) > 0),
  constraint oem_invoice_seller_shape check (jsonb_typeof(seller_snapshot) = 'object'),
  constraint oem_invoice_text_len check (
    char_length(description) <= 500 and (note is null or char_length(note) <= 500)
    and (void_reason is null or char_length(void_reason) <= 500)
  ),
  constraint oem_invoice_void_shape check (
    (status = 'issued' and void_reason is null and voided_at is null and voided_by is null)
    or (status = 'void' and void_reason is not null and voided_at is not null and voided_by is not null)
  )
);

create index if not exists oem_invoice_quote_idx on analytics.oem_invoice (shop_id, quote_id);

comment on table analytics.oem_invoice is
  '0179: ใบแจ้งหนี้ OEM (ไม่ใช่ใบกำกับภาษี) — เอกสารตายตัว เก็บผลลัพธ์ที่คำนวณแล้ว + snapshot ผู้ขาย/ผู้ซื้อ/รายการ/ยอด พิมพ์ซ้ำอีก 5 ปีต้องได้เหมือนเดิม · issued -> void ทางเดียว (trigger) · ออกด้วย analytics.oem_invoice_issue เท่านั้น (ยอดมาจาก v_oem_quote ไม่รับจาก client) · ห้ามมีต้นทุน/margin/approval_note/discount_reason ในตารางนี้';

-- สิทธิ์: RLS เปิด ไม่มี policy · เขียนผ่าน security definer เท่านั้น · service_role อ่านอย่างเดียว (0018 default privilege ครอบ ต้อง revoke ชัดๆ)
alter table analytics.oem_invoice enable row level security;
revoke all on analytics.oem_invoice from public, anon, authenticated, service_role;
grant select on analytics.oem_invoice to service_role;

-- trigger กัน UPDATE/DELETE — ลอกหลักจาก oem_receipt_deny_mutation (0086) ตามนิยามจริงบน DB
create or replace function analytics.oem_invoice_deny_mutation()
returns trigger
language plpgsql
set search_path = public, analytics, extensions, pg_temp
as $f$
begin
  if tg_op = 'DELETE' then
    raise exception 'oem_invoice: ห้ามลบใบแจ้งหนี้ — เลขที่เอกสารต้องคงอยู่ ผิดแล้วให้ยกเลิกด้วย analytics.oem_invoice_void แล้วออกใหม่แทน' using errcode = '22023';
  end if;

  -- tg_op = 'UPDATE' จากนี้ไป
  if old.status is distinct from 'issued' or new.status is distinct from 'void' then
    raise exception 'oem_invoice: แก้ไขได้ทางเดียวคือเปลี่ยนสถานะ issued -> void เท่านั้น (เดิม % ใหม่ %) — ใบแจ้งหนี้ที่ออกแล้วห้ามแก้เนื้อหา ผิดแล้วต้องยกเลิกแล้วออกใหม่ (analytics.oem_invoice_void + analytics.oem_invoice_issue)',
      old.status, new.status using errcode = '22023';
  end if;

  if (to_jsonb(new) - array['status', 'void_reason', 'voided_at', 'voided_by'])
     is distinct from
     (to_jsonb(old) - array['status', 'void_reason', 'voided_at', 'voided_by'])
  then
    raise exception 'oem_invoice: แก้ได้เฉพาะคอลัมน์ status/void_reason/voided_at/voided_by ตอนยกเลิกเท่านั้น — คอลัมน์อื่นของใบที่ออกแล้วห้ามแก้แม้ค่าเดียว' using errcode = '22023';
  end if;

  return new;
end;
$f$;

create or replace function analytics.oem_invoice_deny_truncate()
returns trigger
language plpgsql
set search_path = public, analytics, extensions, pg_temp
as $f$
begin
  raise exception 'oem_invoice: ห้าม TRUNCATE ตาราง % — ใบแจ้งหนี้ต้องคงเลขที่ไว้ตลอดไป ยกเลิกทีละใบด้วย analytics.oem_invoice_void แทน', tg_table_name
    using errcode = '22023';
end;
$f$;

revoke execute on function analytics.oem_invoice_deny_mutation() from public, anon, authenticated;
revoke execute on function analytics.oem_invoice_deny_truncate() from public, anon, authenticated;

drop trigger if exists trg_oem_invoice_deny_mutation on analytics.oem_invoice;
create trigger trg_oem_invoice_deny_mutation
  before update or delete on analytics.oem_invoice
  for each row execute function analytics.oem_invoice_deny_mutation();
drop trigger if exists trg_oem_invoice_deny_truncate on analytics.oem_invoice;
create trigger trg_oem_invoice_deny_truncate
  before truncate on analytics.oem_invoice
  for each statement execute function analytics.oem_invoice_deny_truncate();

-- ============================================================================
-- 4. analytics.v_oem_invoice — ใบแจ้งหนี้ + สถานะที่ derive สด (ไม่เก็บลงตาราง)
--    · select list ระบุคอลัมน์ทีละตัว (ไม่ใช้ i.*) — เพิ่มคอลัมน์ตารางทีหลังจะไม่หลุดเข้า view เอง
--    · ไม่ select created_by/voided_by (user id) · ไม่แตะ v_oem_quote (cost/margin อยู่ในนั้น) — อ่านจาก oem_quote ตรงเฉพาะคอลัมน์ที่ต้องใช้
--    · void_reason ออกได้ (หน้าจอพนักงานเท่านั้น) แต่ห้ามเข้า PrintableInvoice
--    · payment_state: 0179 = void | unpaid (ไม่มีทางผูกใบเสร็จ) — 0180 (I2) แก้นิยาม ps ด้านล่างอย่างเดียวให้เป็น paid ได้ (create or replace ต่อท้าย)
--      is_stale / is_overdue / ด่าน "เปิดค้าง 1 ใบ/ดีล" ใน oem_invoice_issue อ่านจาก ps.state ที่เดียว จึงไม่ต้องแก้ตาม
--    · is_stale = issued + unpaid + (ยอดรวมของแถว active ของดีล <> ยอดตอนออก หรือ ยอดรับเงินสะสมของดีล <> ตอนออก)
--      ครอบทั้ง "ต่อราคาหลังออกใบ" และ "รับเงินไปแล้วโดยไม่อ้างใบนี้" — หน้าพิมพ์ต้องบล็อก ไม่ซ่อนปัญหา (invariants ข้อ 8)
--    · วันนี้ = เวลาไทยทุกจุด (traps ข้อ 6) · is_overdue เป็นป้าย ไม่มี state ใหม่
-- ============================================================================
create or replace view analytics.v_oem_invoice with (security_invoker = true) as
select
  i.id,
  i.shop_id,
  i.quote_id,
  i.invoice_no,
  i.kind,
  i.status,
  i.amount_thb,
  i.vat_display,
  i.vat_rate,
  i.vat_base_thb,
  i.vat_amount_thb,
  i.issue_date,
  i.due_date,
  i.pay_before_work,
  i.description,
  i.note,
  i.seller_snapshot,
  i.payment_lines,
  i.buyer_legal_name,
  i.buyer_tax_id,
  i.buyer_branch_label,
  i.buyer_address,
  i.quote_no_snapshot,
  i.lines_snapshot,
  i.pieces_subtotal_snapshot,
  i.nre_price_snapshot,
  i.discount_thb_snapshot,
  i.grand_total_snapshot,
  i.deposit_amount_snapshot,
  i.deposit_pct_snapshot,
  i.paid_before_thb,
  i.balance_after_thb,
  i.void_reason,
  i.voided_at,
  i.replaces_invoice_id,
  i.created_at,
  q.quote_no,
  q.status as quote_status,
  coalesce(q.root_quote_id, q.id) as deal_root_id,
  (q.status <> 'superseded') as is_deal_active,
  act.id as deal_quote_id,
  act.quote_no as deal_quote_no,
  act.status as deal_quote_status,
  act.grand_total as deal_grand_total,
  pay.paid_thb as deal_paid_thb,
  coalesce(
    act.status = 'expired'
    or (act.status = 'quoted' and act.quote_valid_until is not null
        and act.quote_valid_until < (now() at time zone 'Asia/Bangkok')::date),
    false) as deal_quote_expired,
  ps.state as payment_state,
  (i.status = 'issued' and ps.state = 'unpaid'
   and (act.grand_total is distinct from i.grand_total_snapshot
        or pay.paid_thb is distinct from i.paid_before_thb)) as is_stale,
  (i.status = 'issued' and ps.state = 'unpaid'
   and i.due_date < (now() at time zone 'Asia/Bangkok')::date) as is_overdue
from analytics.oem_invoice i
join analytics.oem_quote q on q.id = i.quote_id and q.shop_id = i.shop_id
cross join lateral (
  select case when i.status = 'void' then 'void' else 'unpaid' end as state
) ps
left join lateral (
  select a.id, a.quote_no, a.status, a.grand_total, a.quote_valid_until
    from analytics.oem_quote a
   where a.shop_id = i.shop_id
     and coalesce(a.root_quote_id, a.id) = coalesce(q.root_quote_id, q.id)
     and a.status <> 'superseded'
   order by a.created_at desc
   limit 1
) act on true
left join lateral (
  select coalesce(sum(r.amount_thb), 0) as paid_thb
    from analytics.oem_receipt r
    join analytics.oem_quote rq on rq.id = r.quote_id
   where rq.root_quote_id = coalesce(q.root_quote_id, q.id)
     and r.status = 'issued'
) pay on true;

revoke all on analytics.v_oem_invoice from public, anon, authenticated, service_role;
grant select on analytics.v_oem_invoice to service_role;


