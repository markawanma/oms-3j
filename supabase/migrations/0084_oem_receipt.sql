-- 0084_oem_receipt.sql
-- รับชำระเงิน + ใบเสร็จรับเงิน/ใบกำกับภาษี (OEM) — ต่อจาก 0075–0083
-- Design: docs/3j-jewelry/analytics/design-oem-payment-invoice.md (Yoda)
--
-- ============ หลักการเดียวที่คุมทั้งไฟล์ ============
-- ใบเสนอราคา (oem_quote) เป็น "เอกสารมีชีวิต" — ต่อราคาได้ view คำนวณสด (0081/0082)
-- แต่ใบเสร็จ/ใบกำกับภาษี (oem_receipt) เป็น "เอกสารตายตัว" — ออกแล้วห้ามขยับแม้แต่
-- สตางค์เดียว จึงเก็บผลลัพธ์ที่คำนวณแล้ว + snapshot คู่สัญญาทั้งสองฝั่งไว้ในแถว
-- ตรงข้ามกับหลักการ 0081/0082 โดยตั้งใจ — คนละชนิดเอกสาร คนละกติกา (ห้ามใครมา
-- "แก้ให้เหมือน view คำนวณสด" ทีหลัง — ดู §14.2 ของ design)
--
-- ============ การตัดสินใจของเจ้าของที่พลิก design (final แล้ว — Tech Lead ยืนยัน) ==
-- 1) grand_total ของ oem_quote รวม VAT แล้ว (เจ้าของยืนยัน) — สูตร
--    vat_base = round(amount/(1+vat_rate), 2) ที่ 0082 ใช้กับใบเสนอราคา ถูกต้อง
--    และใช้สูตรเดียวกันกับใบเสร็จ (amount_thb ที่รับจริงคือยอด gross เสมอ)
-- 2) รับมัดจำ = รับงาน — ใบเสร็จใบแรกที่ออกบนใบสถานะ quoted จะพลิกใบเป็น won
--    อัตโนมัติในตัว RPC (ไม่ผ่าน oem_quote_set_status — ดูเหตุผลที่ §3 ของไฟล์นี้)
-- 3) ⚠️ ต่อราคาลงต่ำกว่าเงินที่รับมาแล้ว — เจ้าของสั่ง "ต่อได้ แต่ขึ้นคำเตือนตัวใหญ่"
--    (ไม่ block) ซึ่งขัดกับ design §6/§11 ข้อ 7 ของ Yoda ที่วางแผนเติม gate ตายใน
--    oem_quote_renegotiate ("grand_total ใหม่ต้องไม่ต่ำกว่า paid ของ deal") —
--    Tech Lead สั่งให้ยกเลิก gate นั้น ทำตามเจ้าของแทน
--
--    ผลคือไฟล์นี้ "ไม่แตะ" analytics.oem_quote_renegotiate เลยแม้แต่บรรทัดเดียว —
--    ไม่ใช่แค่ "ไม่เพิ่ม gate" แต่คือไม่มี CREATE OR REPLACE บนฟังก์ชันนี้ในไฟล์นี้
--    ทั้งก้อน เพราะไม่มีการเปลี่ยนแปลงอะไรที่ต้องทำกับมันอีกแล้ว (การรวม paid ระดับ
--    deal ทำที่ v_oem_quote/oem_receipt_issue ทั้งหมด — renegotiate ไม่ต้องรู้เรื่อง
--    ใบเสร็จเลยเพราะ oem_receipt ไม่ re-point FK ตอนต่อราคา ดู §5) การไม่แตะไฟล์คือ
--    การรับประกันที่แน่นกว่า "แตะแล้วเช็คว่าก๊อปถูก" ว่างาน hardening ของ 0083
--    (margin รวมติดลบ + vat_mode clamp ในฟังก์ชันนี้) จะไม่หายเงียบ — ยืนยันแล้ว
--    ด้วยการ grep DB migration ล่าสุด (0083 บรรทัด 1237-1241 "margin รวมติดลบ" +
--    1369-1379 "v_new_vat_mode") ว่ายังอยู่ครบและไฟล์นี้ไม่มีคำสั่งใดแตะฟังก์ชันนั้น
--
--    ผลข้างเคียงที่ตั้งใจปล่อยให้เห็น (คำสั่งเจ้าของข้อ 3): renegotiate ลด
--    grand_total ต่ำกว่ายอดที่เก็บไปแล้วได้เสมอ (margin gate ของ 0083 ยังทำงาน
--    ตามปกติ — คนละด่าน คนละเรื่องกับ "จ่ายเกิน") ทำให้ outstanding_thb (§6 ของ
--    ไฟล์นี้) ติดลบได้จริง — ร้านค้างคืนเงินลูกค้าโดยยังไม่มีใบลดหนี้ในระบบ (หนี้ที่
--    รู้ตัว ไม่ใช่บั๊ก) ใบเสร็จที่ออกไปแล้วไม่ถูกแตะและ VAT ที่ยื่นไปแล้วถูกต้องตามที่
--    ยื่นจริง ณ วันที่รับเงิน — renegotiate ทีหลังไม่ย้อนแก้ภาระภาษีที่เกิดไปแล้ว
--
-- ============ ขอบเขต ============
-- 1) analytics.oem_doc_counter — ตัวนับเลขเอกสาร gap-free (row-lock, ไม่มี policy)
-- 2) analytics.oem_receipt — 1 แถว = รับเงิน 1 ครั้ง = เอกสาร 1 ใบ, immutable,
--    status issued -> void เท่านั้น (ไม่มี draft, ไม่มี RPC แก้เนื้อหา)
-- 3) analytics.oem_receipt_issue — RPC เดียวที่เขียนตาราง oem_receipt (insert)
-- 4) analytics.oem_receipt_void — RPC เดียวที่ set status = 'void'
-- 5) analytics.v_oem_receipt — receipt + quote_no + is_deal_active
-- 6) analytics.v_oem_quote — append paid_thb/outstanding_thb/is_fully_paid/
--    receipt_count (นับระดับ deal ผ่าน root_quote_id — ไม่ re-point FK ของ
--    receipt ตอนต่อราคา ใช้ aggregation แทน mutation)
--
-- อ่านคู่กับ 0075 (oem_customer RLS tier ต้นแบบ, oem_quote status transitions),
-- 0079 (seller_* บน oem_setting), 0081 (deposit pattern, v_oem_quote ฉบับก่อน VAT),
-- 0082 (v_oem_quote 56 คอลัมน์ฉบับล่าสุด, vat_rate snapshot), 0083 (hardening ล่าสุด
-- ของ oem_quote_save/renegotiate/oem_price_calc — ไม่ถูกแตะโดยไฟล์นี้)
-- ============================================================================

-- ============================================================================
-- 1. analytics.oem_doc_counter — ตัวนับเลขเอกสาร (gap-free) — client ห้ามแตะตรงๆ
--    RLS เปิดแต่ไม่มี policy เลย (ปิดตาย ทุก role ผ่าน PostgREST อ่าน/เขียนไม่ได้)
--    ไม่มี grant ให้ authenticated/anon เลยแม้แต่ select — เข้าถึงได้เฉพาะภายใน
--    oem_receipt_issue (security definer รันด้วยสิทธิ์เจ้าของฟังก์ชัน ซึ่งเป็น
--    เจ้าของตารางอยู่แล้วตั้งแต่ตอน migration รัน ไม่ต้อง grant เพิ่ม)
-- ============================================================================

create table if not exists analytics.oem_doc_counter (
  shop_id  uuid not null references public.shop (id) on delete cascade,
  doc_key  text not null,          -- เช่น 'RT-2608' (prefix + YYMM เวลาไทย)
  last_no  int  not null default 0,
  primary key (shop_id, doc_key)
);

alter table analytics.oem_doc_counter enable row level security;
-- ไม่มี create policy บรรทัดไหนเลยในไฟล์นี้โดยตั้งใจ — ตารางนี้ไม่มีเหตุผลให้ client
-- อ่านหรือเขียนตรงๆ แม้แต่ select (ต่างจาก oem_receipt ที่ผู้ใช้ต้องดูใบเสร็จได้)

comment on table analytics.oem_doc_counter is
  '0084: ตัวนับเลขที่เอกสาร gap-free ต่อ (shop_id, doc_key) — เพิ่มค่าด้วย row lock (insert ... on conflict do update ... returning) ภายใน transaction เดียวกับการ insert oem_receipt เท่านั้น ไม่มี retry loop (ต่างจาก oem_quote_next_no ที่ retry ได้เพราะใบเสนอราคาลองใหม่ได้ แต่เอกสารภาษีต้องไม่มี failure mode ที่ทำให้เลขข้าม) RLS เปิดแต่ไม่มี policy และไม่ grant ให้ authenticated/anon เลย — เข้าถึงได้เฉพาะผ่าน analytics.oem_receipt_issue';

-- ============================================================================
-- 2. analytics.oem_receipt — ใบเสร็จรับเงิน/ใบกำกับภาษี — 1 แถว = รับเงิน 1 ครั้ง
--    = เอกสาร 1 ใบ เก็บผลลัพธ์ที่คำนวณแล้ว + snapshot คู่สัญญา ณ วันออกใบ (ตรงข้าม
--    กับหลักการ "คำนวณสดที่ view" ของ oem_quote โดยตั้งใจ — ดูหัวไฟล์)
-- ============================================================================

create table if not exists analytics.oem_receipt (
  id                       uuid primary key default gen_random_uuid(),
  shop_id                  uuid not null references public.shop (id) on delete cascade,
  quote_id                 uuid not null references analytics.oem_quote (id) on delete restrict,
  receipt_no               text not null,                  -- 'RT-YYMM-###'
  kind                     text not null check (kind in ('deposit', 'partial', 'final')),
  status                   text not null default 'issued' check (status in ('issued', 'void')),
  -- ---- ตัวเงิน: คำนวณครั้งเดียวตอน issue แล้วแช่แข็ง (ต่างจาก v_oem_quote โดยตั้งใจ) ----
  amount_thb               numeric(14, 2) not null check (amount_thb > 0),  -- ยอดรับจริง (รวม VAT)
  vat_rate                 numeric(6, 4)  not null,         -- snapshot จาก oem_quote.vat_rate ณ วันออก
  vat_base_thb             numeric(14, 2) not null,         -- round(amount/(1+rate), 2)
  vat_amount_thb           numeric(14, 2) not null,         -- amount - vat_base (remainder แบบ 0082)
  constraint oem_receipt_sum_exact check (vat_base_thb + vat_amount_thb = amount_thb),
  -- ---- ข้อมูลรับเงิน ----
  received_date            date not null,                   -- วันรับเงิน (tax point ของงานบริการ)
  issue_date               date not null,                   -- วันออกเอกสาร (วันที่ RPC รัน, เวลาไทย)
  payment_method           text check (payment_method in ('transfer', 'cash', 'other')),
  payment_ref              text,                            -- เลขอ้างอิงโอน (optional)
  description               text not null,                  -- บรรทัดรายการบนเอกสาร (RPC generate, override ได้ตอน issue)
  -- ---- snapshot คู่สัญญา ณ วันออก (oem_setting/oem_customer แก้ทีหลังได้ เอกสารห้ามขยับตาม) ----
  seller_snapshot          jsonb not null,  -- {legal_name, display_name, branch_label, address_lines, tax_id, phone}
  buyer_legal_name         text  not null,
  buyer_tax_id             text,            -- nullable (บุคคลธรรมดาไม่บังคับ) — ห้ามเก็บข้อมูลอ่อนไหวเกินนี้
  buyer_branch_label       text,            -- ยังไม่มีแหล่งข้อมูล (oem_customer ไม่มีคอลัมน์นี้) — ดูหมายเหตุท้ายไฟล์
  buyer_address            jsonb,
  -- ---- ข้อมูลประกอบ (informational snapshot — กัน reprint เพี้ยนเมื่อ deal ขยับทีหลัง) ----
  quote_no_snapshot        text not null,
  grand_total_snapshot     numeric(14, 2) not null,         -- ยอดทั้งใบ (แถว oem_quote ที่ active ขณะออก) ณ วันออกใบนี้
  paid_before_thb          numeric(14, 2) not null default 0,
  balance_after_thb        numeric(14, 2) not null,
  -- ---- void (ห้าม delete — เลขต้องอยู่ครบตลอดไป) ----
  void_reason              text,
  voided_at                timestamptz,
  voided_by                uuid,
  reissued_from_receipt_id uuid references analytics.oem_receipt (id),
  created_by               uuid,
  created_at               timestamptz not null default now(),
  unique (shop_id, receipt_no)
);

create index if not exists idx_oem_receipt_shop_id on analytics.oem_receipt (shop_id);
create index if not exists idx_oem_receipt_quote_id on analytics.oem_receipt (quote_id);

comment on table analytics.oem_receipt is
  '0084: ใบเสร็จรับเงิน/ใบกำกับภาษี OEM — เอกสารตายตัว (ตรงข้ามกับ oem_quote) เก็บผลลัพธ์คำนวณแล้ว + snapshot คู่สัญญาทั้งสองฝั่ง ออกได้ทาง analytics.oem_receipt_issue เท่านั้น แก้เนื้อหาไม่ได้เลย ผิดแล้วต้อง analytics.oem_receipt_void แล้วออกใหม่ (reissue ผูก reissued_from_receipt_id)';
comment on column analytics.oem_receipt.buyer_branch_label is
  '0084: ยังไม่มีแหล่งข้อมูลจริงในระบบ (analytics.oem_customer ไม่มีคอลัมน์ branch label) — RPC ปัจจุบันเขียน null เสมอ คอลัมน์นี้เปิดไว้ตามที่ design ระบุว่าจำเป็นเมื่อผู้ซื้อจดทะเบียน VAT แต่ยังไม่ gate ที่ DB (ดูสรุปส่งมอบของ backend-dev รอบ 0084) ต้องเพิ่มคอลัมน์ที่ oem_customer + parameter ใน RPC ก่อนใช้งานจริง';
comment on column analytics.oem_receipt.paid_before_thb is
  '0084: ยอดที่รับไปแล้วระดับดีล (sum ของ oem_receipt สถานะ issued ทุกใบที่ quote_id อยู่ใน chain เดียวกันผ่าน root_quote_id) ณ ก่อนใบนี้ ไม่ใช่ยอดของแถว quote_id เดียวที่ผูกกับใบนี้';
comment on column analytics.oem_receipt.grand_total_snapshot is
  '0084: grand_total ของ oem_quote แถวที่ active ขณะออกใบนี้ (informational เท่านั้น — ถ้า deal ถูกต่อราคาใหม่ทีหลัง เลขนี้จะไม่ตรงกับ grand_total ปัจจุบันของ deal อีกต่อไป ห้ามใช้เลขนี้คำนวณ outstanding_thb ปัจจุบัน ให้อ่านจาก v_oem_quote แทน)';

-- RLS: tier เดียวกับ oem_customer (0075) — select เฉพาะ owner/admin (มี tax_id/
-- ที่อยู่ผู้ซื้ออยู่ในแถว) ไม่มี insert/update/delete policy เลย (เขียนผ่าน RPC
-- security definer เท่านั้น — แน่นกว่า oem_quote_item เพราะเอกสารภาษีไม่มีเหตุให้
-- client เขียนตรง) ไม่มี retention/auto-delete (เก็บตามประมวลรัษฎากร 5 ปี+ เหตุผล
-- เดียวกับ oem_customer ใน 0075)
alter table analytics.oem_receipt enable row level security;

drop policy if exists owner_admin_select on analytics.oem_receipt;
create policy owner_admin_select on analytics.oem_receipt
  for select
  using (
    shop_id in (
      select shop_id from public.shop_member
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

grant select on analytics.oem_receipt to authenticated, service_role;

-- ============================================================================
-- 3. analytics.oem_receipt_issue — RPC เดียวที่เขียนตาราง oem_receipt (insert)
--    security definer + pin search_path + crm_require_owner_admin + for update
--    แถว oem_quote (กันสอง request ยิงพร้อมกันแล้วอ่าน paid เก่าทั้งคู่)
--
--    ลำดับ: validate input พื้นฐาน -> lock quote -> gate สถานะ -> gate seller/
--    buyer (ข้อมูลเอกสารภาษีครบไหม) -> คำนวณ paid ระดับ deal (root_quote_id
--    chain) -> gate จ่ายเกิน (ตายตัว ไม่เกี่ยวกับคำสั่งเจ้าของข้อ 3 ซึ่งเป็นเรื่อง
--    renegotiate) -> gate p_received_date ไม่เกินวันนี้เวลาไทย -> snapshot
--    seller/buyer/vat_rate -> ออกเลขจาก counter (row lock, ไม่มี retry) ->
--    insert receipt -> ตั้ง won ถ้ายังไม่ won (จ่ายมัดจำ = รับงาน ตามคำสั่งเจ้าของ
--    ข้อ 2) -> revoke/grant execute
--
--    ไม่เรียก analytics.oem_quote_set_status เพื่อพลิกเป็น won — update ตรงในตัว
--    ฟังก์ชันนี้ เพราะ oem_quote_set_status มีด่าน/ข้อความที่ออกแบบมาสำหรับ manual
--    path (ต้องมี p_lost_reason เมื่อ lost ฯลฯ) การพลิกเป็น won จากการรับเงินคือ
--    transition ที่ 0076 รับรองไว้แล้วว่า legal (quoted/expired -> won) จึงไม่ได้
--    เจาะ gate ของใคร แค่ทำ transition ที่อนุญาตอยู่แล้วให้อัตโนมัติ
-- ============================================================================

create or replace function analytics.oem_receipt_issue(
  p_shop_id uuid,
  p_quote_id uuid,
  p_amount_thb numeric,
  p_received_date date,
  p_kind text,
  p_payment_method text default null,
  p_payment_ref text default null,
  p_description text default null,
  p_reissued_from uuid default null
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_quote analytics.oem_quote%rowtype;
  v_set analytics.oem_setting%rowtype;
  v_customer analytics.oem_customer%rowtype;
  v_bkk_today date;
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
  -- range check แทน "<= 0" เดี่ยวๆ — บทเรียน 0083 (NaN > ทุกค่ารวม infinity ใน
  -- Postgres จึงไหลผ่าน "> 0" ไปเงียบๆ ได้ ถ้าไม่ล้อมด้วย not(between))
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

  -- ยืนยันว่า p_reissued_from ต้องชี้ไปใบที่ถูก void ไปแล้วในร้านนี้เท่านั้น (ผิด
  -- ต้อง void ก่อนถึงจะ reissue ได้ — ตามลำดับที่ §4 ของ design กำหนด) และยังไม่
  -- เคยถูก reissue ซ้ำมาก่อน (กันออกใบแทนใบเดียวกันซ้ำสองครั้งโดยไม่ตั้งใจ)
  if p_reissued_from is not null then
    if not exists (
      select 1 from analytics.oem_receipt
       where id = p_reissued_from and shop_id = p_shop_id and status = 'void'
    ) then
      raise exception 'oem_receipt_issue: p_reissued_from ต้องชี้ไปใบเสร็จที่ถูกยกเลิก (void) แล้วในร้านนี้เท่านั้น' using errcode = '22023';
    end if;
    if exists (
      select 1 from analytics.oem_receipt
       where reissued_from_receipt_id = p_reissued_from and status = 'issued'
    ) then
      raise exception 'oem_receipt_issue: ใบเสร็จ % ถูก reissue ไปแล้ว ออกซ้ำอีกใบไม่ได้', p_reissued_from using errcode = '22023';
    end if;
  end if;

  -- timezone ไทย เสมอ — DB เป็น UTC ก่อน 07:00 ไทยจะเหลื่อมวัน ทั้งเลขที่เอกสาร
  -- และการเช็ค p_received_date ต้องยึดวันนี้ตามเวลาไทย ไม่ใช่ current_date (UTC)
  v_bkk_today := (now() at time zone 'Asia/Bangkok')::date;

  -- for update: กันสอง request ออกใบพร้อมกันแล้วอ่านสถานะ/paid เก่าทั้งคู่
  select * into v_quote
    from analytics.oem_quote
   where id = p_quote_id and shop_id = p_shop_id
   for update;
  if not found then
    raise exception 'oem_receipt_issue: quote % not found for this shop', p_quote_id;
  end if;

  -- §4: ออกใบเสร็จได้เฉพาะใบสถานะ quoted/expired/won (เซ็ตที่ 0076 รับรองว่าไป
  -- won ได้อยู่แล้ว) draft = เลขไม่เคยผ่าน gate เลย · lost/rejected/superseded =
  -- ปฏิเสธ (superseded คือใบที่ถูกแทนที่แล้ว — ต้องใช้ quote_id ของใบ active ปัจจุบัน)
  if v_quote.status not in ('quoted', 'expired', 'won') then
    raise exception 'oem_receipt_issue: ออกใบเสร็จได้เฉพาะใบสถานะ quoted, expired หรือ won เท่านั้น (ใบนี้สถานะ %) — ถ้าใบนี้ถูกต่อราคาไปแล้ว ให้ใช้ quote_id ของใบล่าสุดในดีลนี้แทน', v_quote.status
      using errcode = '22023';
  end if;
  if v_quote.grand_total is null then
    raise exception 'oem_receipt_issue: ใบเสนอราคานี้ยังไม่มียอดรวม (grand_total) — ข้อมูลผิดปกติ ติดต่อทีมพัฒนา';
  end if;

  -- §9: gate ข้อมูลผู้ขาย — ใบกำกับภาษีออกได้เฉพาะร้านที่จดทะเบียน VAT และมีข้อมูล
  -- ครบเท่านั้น บังคับที่ DB ไม่ใช่แค่เตือนที่ปุ่ม
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

  -- §9: gate ข้อมูลผู้ซื้อ — ต้องมี customer_id ผูกไว้แล้ว (ผ่าน
  -- oem_quote_set_billing) และมีชื่อนิติบุคคล/ผู้ซื้อ tax_id/address ไม่บังคับที่
  -- DB (บุคคลธรรมดาไม่ต้องมี — UI เตือนเหลืองเอง)
  if v_quote.customer_id is null then
    raise exception 'oem_receipt_issue: ใบนี้ยังไม่ได้ผูกข้อมูลผู้ซื้อ (ชื่อออกบิล/ที่อยู่) — ตั้งค่าก่อนออกใบเสร็จ' using errcode = '22023';
  end if;
  select * into v_customer from analytics.oem_customer where id = v_quote.customer_id and shop_id = p_shop_id;
  if not found or nullif(btrim(v_customer.legal_name), '') is null then
    raise exception 'oem_receipt_issue: ข้อมูลผู้ซื้อของใบนี้ยังไม่มีชื่อนิติบุคคล/ชื่อผู้ซื้อ — ตั้งค่าก่อนออกใบเสร็จ' using errcode = '22023';
  end if;

  -- §6: paid ระดับ deal — sum ทุกใบเสร็จ issued ที่ quote_id อยู่ใน chain เดียวกัน
  -- ผ่าน root_quote_id (ต่อราคาสร้างแถว quote ใหม่ แต่มัดจำที่รับไว้เป็นของ deal
  -- ไม่ใช่ของแถว) ไม่ re-point FK ของ receipt ตอนต่อราคา — aggregation แทน mutation
  select coalesce(sum(r.amount_thb), 0) into v_paid_before
    from analytics.oem_receipt r
    join analytics.oem_quote rq on rq.id = r.quote_id
   where rq.root_quote_id = coalesce(v_quote.root_quote_id, v_quote.id)
     and r.status = 'issued';

  -- §6: กันจ่ายเกิน — ยังเป็นด่านตายตัว (ต่างจากคำสั่งเจ้าของข้อ 3 ที่ยกเลิกเฉพาะ
  -- gate ฝั่ง renegotiate) เทียบกับ grand_total ของใบ active (v_quote) ที่ล็อกไว้
  -- แล้วข้างบน กันสอง request อ่าน paid เก่าทั้งคู่
  if round(v_paid_before + p_amount_thb, 2) > round(v_quote.grand_total, 2) then
    raise exception 'oem_receipt_issue: ยอดรับเงินรวม % บาท (สะสมแล้ว % + ครั้งนี้ %) เกินยอดรวมใบเสนอราคาทั้งดีล (% บาท) — รับเงินเกินยอดไม่ได้',
      round(v_paid_before + p_amount_thb, 2), round(v_paid_before, 2), round(p_amount_thb, 2), round(v_quote.grand_total, 2)
      using errcode = '22023';
  end if;

  if p_received_date > v_bkk_today then
    raise exception 'oem_receipt_issue: วันที่รับเงิน (%) เป็นวันในอนาคตไม่ได้ (วันนี้ตามเวลาไทยคือ %)', p_received_date, v_bkk_today
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
  -- receipt ข้างล่าง (ถ้า insert fail ทั้งก้อน rollback ตัวนับถอยกลับด้วย = ไม่มี
  -- เลขข้าม) ไม่มี retry loop เพราะ concurrent request ที่สองแค่ "รอ" row lock
  -- แล้วได้เลขถัดไป ไม่ชนกันเลย
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
    -- buyer_branch_label: null เสมอตอนนี้ — ยังไม่มีแหล่งข้อมูล (ดู comment on
    -- column ข้างบน)
    v_seller_snapshot, v_customer.legal_name, v_customer.tax_id, null, v_customer.address,
    v_quote.quote_no, v_quote.grand_total, v_paid_before, (v_quote.grand_total - (v_paid_before + p_amount_thb)),
    p_reissued_from, auth.uid()
  );

  -- คำสั่งเจ้าของข้อ 2: รับมัดจำ = รับงาน — ใบยังไม่ won ก็พลิกเป็น won ทันที
  -- (transition quoted/expired -> won ที่ 0076 รับรองไว้แล้วว่า legal)
  if v_quote.status <> 'won' then
    update analytics.oem_quote
       set status = 'won', updated_by = auth.uid(), updated_at = now()
     where id = p_quote_id and shop_id = p_shop_id;
  end if;

  return v_receipt_id;
end;
$$;

revoke execute on function analytics.oem_receipt_issue(uuid, uuid, numeric, date, text, text, text, text, uuid) from public, anon;
grant execute on function analytics.oem_receipt_issue(uuid, uuid, numeric, date, text, text, text, text, uuid) to authenticated, service_role;

-- ============================================================================
-- 4. analytics.oem_receipt_void — issued -> void เท่านั้น เหตุผลบังคับ ไม่มี path
--    แก้เนื้อหาเอกสารเลย (ผิด = void แล้ว oem_receipt_issue ใหม่พร้อม
--    p_reissued_from) void ไม่ถอยสถานะ quote จาก won — ชนะงานแล้วคือชนะ ตัวเลข
--    paid ลดเองผ่าน v_oem_quote (ไม่นับใบ void ในผลรวม)
-- ============================================================================

create or replace function analytics.oem_receipt_void(
  p_shop_id uuid,
  p_receipt_id uuid,
  p_reason text
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_status text;
begin
  if p_shop_id is null or p_receipt_id is null then
    raise exception 'oem_receipt_void: p_shop_id and p_receipt_id are required';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'oem_receipt_void: ต้องระบุเหตุผลก่อนยกเลิกใบเสร็จ/ใบกำกับภาษี' using errcode = '22023';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  select status into v_status
    from analytics.oem_receipt
   where id = p_receipt_id and shop_id = p_shop_id
   for update;
  if not found then
    raise exception 'oem_receipt_void: receipt % not found for this shop', p_receipt_id;
  end if;
  if v_status <> 'issued' then
    raise exception 'oem_receipt_void: ยกเลิกได้เฉพาะใบสถานะ issued เท่านั้น (ใบนี้สถานะ %)', v_status
      using errcode = '22023';
  end if;

  update analytics.oem_receipt
     set status = 'void', void_reason = left(btrim(p_reason), 500), voided_at = now(), voided_by = auth.uid()
   where id = p_receipt_id and shop_id = p_shop_id;
end;
$$;

revoke execute on function analytics.oem_receipt_void(uuid, uuid, text) from public, anon;
grant execute on function analytics.oem_receipt_void(uuid, uuid, text) to authenticated, service_role;

-- ============================================================================
-- 5. analytics.v_oem_receipt — receipt ทุกคอลัมน์ + quote_no (ของแถว quote_id ที่
--    ผูกกับใบเสร็จนี้โดยตรง ไม่ใช่หัวดีลปัจจุบัน) + is_deal_active (แถว quote นั้น
--    ยังไม่ถูก superseded — บอกว่า "ใบเสนอราคาที่ใบเสร็จนี้อ้างอิงยังเป็นใบที่ใช้
--    งานอยู่หรือถูกแทนที่ไปแล้ว" ไม่ใช่สถานะของทั้งดีล)
-- ============================================================================

create or replace view analytics.v_oem_receipt
  with (security_invoker = true) as
select
  r.*,
  q.quote_no,
  (q.status <> 'superseded') as is_deal_active
from analytics.oem_receipt r
join analytics.oem_quote q on q.id = r.quote_id;

comment on view analytics.v_oem_receipt is
  '0084: ใบเสร็จรับเงิน/ใบกำกับภาษี OEM ทุกคอลัมน์ + quote_no ของแถว oem_quote ที่ผูกไว้ + is_deal_active (แถวนั้นยังไม่ถูกแทนที่ด้วยการต่อราคา) RLS ตามตาราง oem_receipt (security_invoker) — owner/admin เท่านั้น';

grant select on analytics.v_oem_receipt to authenticated, service_role;

-- ============================================================================
-- 6. analytics.v_oem_quote — append-only (42P16): copy select list คำต่อคำจาก
--    ฉบับ 0082 (56 คอลัมน์ ลำดับเดิมเป๊ะ) แล้วต่อท้ายด้วย paid_thb/
--    outstanding_thb/is_fully_paid/receipt_count — คำนวณสดระดับ deal (root_quote_id
--    chain) ทุกครั้งที่ query เหมือน deposit_amount_thb/vat_base_thb ก่อนหน้านี้
--
--    ⚠️ outstanding_thb ไม่ถูกปัดเป็น 0 เมื่อติดลบ (แนวเดียวกับ balance_thb ของ
--    0081) — เกิดได้จริงหลังต่อราคาลงต่ำกว่าเงินที่รับแล้ว (คำสั่งเจ้าของข้อ 3 ที่
--    หัวไฟล์) ฝั่งแอปต้องเช็ค < 0 แล้วเตือนเอง (คำเตือนตัวใหญ่ตามที่เจ้าของสั่ง)
--
--    ⚠️ สำหรับแถว oem_quote ที่ถูก superseded ไปแล้ว: paid_thb/receipt_count เป็น
--    ค่าระดับ deal เดียวกันทุกแถวใน chain (ถูกต้อง) แต่ outstanding_thb/
--    is_fully_paid เทียบกับ grand_total ของ "แถวนั้นเอง" ซึ่งเป็นราคาประวัติศาสตร์
--    ที่อาจไม่ตรงกับราคาปัจจุบันของดีล — ฝั่งแอปต้องอ่านค่าพวกนี้จากแถว "active"
--    (status <> superseded) ของ chain เท่านั้น ไม่ใช่จากแถวเก่าแถวไหนก็ได้
-- ============================================================================

create or replace view analytics.v_oem_quote
  with (security_invoker = true) as
select
  q.id,
  q.shop_id,
  q.quote_no,
  q.customer_name,
  q.customer_contact,
  q.input,
  q.calc,
  q.rate_snapshot,
  q.cost_piece,
  q.price_per_piece,
  q.nre_cost,
  q.nre_price,
  q.pieces_subtotal,
  q.quote_total,
  q.margin_actual_pct,
  q.q_run,
  q.flask_count,
  q.plating_batch_count,
  q.status,
  q.approval_note,
  q.approved_by,
  q.quote_valid_until,
  q.lost_reason,
  q.lost_to,
  q.created_by,
  q.updated_by,
  q.created_at,
  q.updated_at,
  (q.status = 'quoted' and q.quote_valid_until is not null and q.quote_valid_until < current_date) as is_expired,
  case when q.quote_valid_until is not null then q.quote_valid_until - current_date else null end as days_left,
  q.margin_charged_pct,
  q.discount_thb,
  q.discount_reason,
  q.grand_total,
  q.margin_after_discount_pct,
  q.parent_quote_id,
  q.root_quote_id,
  q.customer_id,
  q.vat_mode,
  pq.quote_no as parent_quote_no,
  (select count(*) from analytics.oem_quote_item i where i.quote_id = q.id) as item_count,
  c.legal_name as bill_legal_name,
  c.tax_id as bill_tax_id,
  c.phone as bill_phone,
  c.contact_channel as bill_contact_channel,
  c.address as bill_address,
  (q.status = 'quoted' and q.quote_valid_until is not null
     and q.quote_valid_until < (now() at time zone 'Asia/Bangkok')::date) as is_expired_th,
  case when q.quote_valid_until is not null
       then q.quote_valid_until - (now() at time zone 'Asia/Bangkok')::date
       else null end as days_left_th,
  q.deposit_mode,
  q.deposit_input,
  dep.deposit_amount_thb,
  case q.deposit_mode
    when 'pct' then q.deposit_input
    when 'thb' then q.deposit_input / nullif(q.grand_total, 0)
    else null
  end as deposit_pct_effective,
  case when q.deposit_mode is not null then q.grand_total - dep.deposit_amount_thb else null end as balance_thb,
  q.vat_rate,
  vb.vat_base_thb,
  -- ส่วนที่เหลือ ไม่ใช่ round(base * vat_rate, 2) แยกต่างหาก — บังคับผลรวม =
  -- grand_total เป๊ะเสมอ (ดูเหตุผลที่หัวไฟล์ 0082)
  case when q.grand_total is null then null else q.grand_total - vb.vat_base_thb end as vat_amount_thb,
  -- ---- appended 0084+ only; do not insert new columns above this line ----
  pay.paid_thb,
  case when q.grand_total is null then null else q.grand_total - pay.paid_thb end as outstanding_thb,
  case when q.grand_total is null then null else (pay.paid_thb >= q.grand_total) end as is_fully_paid,
  pay.receipt_count
from analytics.oem_quote q
left join analytics.oem_quote pq on pq.id = q.parent_quote_id
left join analytics.oem_customer c on c.id = q.customer_id and c.shop_id = q.shop_id
left join lateral (
  select
    case q.deposit_mode
      when 'pct' then round(q.grand_total * q.deposit_input, 2)
      when 'thb' then q.deposit_input
      else null
    end as deposit_amount_thb
) dep on true
left join lateral (
  select case
    when q.grand_total is null then null::numeric(14, 2)
    else round(q.grand_total / (1 + q.vat_rate), 2)
  end as vat_base_thb
) vb on true
left join lateral (
  -- ระดับ deal: sum ทุกใบเสร็จ issued ที่ quote_id อยู่ใน chain เดียวกันผ่าน
  -- root_quote_id (ไม่ใช่แค่ q.id ตรงๆ — renegotiate สร้างแถวใหม่แต่มัดจำที่รับ
  -- ไว้เป็นของ deal) coalesce(q.root_quote_id, q.id) กันแถวเก่าที่ backfill ตอน
  -- 0075 อาจยังไม่มี root_quote_id (แม้ 0075 §4 backfill ไปแล้วก็ตาม — defensive)
  select
    coalesce(sum(r.amount_thb), 0) as paid_thb,
    count(*) as receipt_count
  from analytics.oem_receipt r
  join analytics.oem_quote rq on rq.id = r.quote_id
  where rq.root_quote_id = coalesce(q.root_quote_id, q.id)
    and r.status = 'issued'
) pay on true;

grant select on analytics.v_oem_quote to authenticated, service_role;

comment on view analytics.v_oem_quote is
  'ใบเสนอราคา OEM แบบสมบูรณ์ (join customer/parent + คำนวณสดจาก grand_total ปัจจุบันเสมอ: deposit §0081, VAT §0082, ยอดรับเงินระดับดีล §0084) ห้ามแทรกคอลัมน์ใหม่กลางลิสต์ (42P16) ต่อท้ายเท่านั้น outstanding_thb ติดลบได้จริง ไม่ถูกปัดเป็น 0 (ดู comment หัว migration 0084)';

notify pgrst, 'reload schema';
