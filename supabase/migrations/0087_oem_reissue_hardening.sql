-- 0087_oem_reissue_hardening.sql
-- security ตีกลับ NO-GO รอบสองบน 0086 (ใบเสร็จ/ใบกำกับภาษี OEM) — ด่าน reissue เดิม
-- แคบเกินไป กันได้แค่ "วันที่ต้องตรงกับใบเดิม" แต่ไม่ผูกยอดเงิน/ประเภทรับเงิน/ดีล
-- เข้ากับใบเดิมเลย เปิดทางลัดย้อนงวดภาษีจริง (ดู §1) + อีก 3 ข้อที่พ่วงมา
--
-- ============ 1) 🔴 ข้อยกเว้น reissue = ทางลัดย้อนงวดภาษี ============
-- 0086 ผูกด่านงวดภาษีไว้กับ "received_date ตรงกับใบเดิมที่ถูก void" เท่านั้น แปลว่า
-- ยิงได้จริงวันนี้: void ใบเก่าใบไหนก็ได้ (ยอดเท่าไหร่ก็ได้ ดีลไหนก็ได้) แล้ว
-- oem_receipt_issue(p_quote_id = ดีลอื่นที่ไม่เกี่ยวกัน, p_amount_thb = ยอดใหญ่แค่ไหน
-- ก็ได้, p_received_date = วันเดียวกับใบเดิม, p_reissued_from = ใบที่เพิ่ง void) จะ
-- ผ่านด่านงวดภาษีไปเลย เพราะด่านเช็คแค่วันที่ ไม่เช็คว่า "นี่คือใบเดิมจริงๆ ที่แก้ผิด
-- แล้วออกใหม่" หรือ "ใบใหม่ที่แอบยืมวันที่ใบเดิมมาข้ามงวด"
--
-- แก้: ผูก reissue เข้ากับใบเดิมให้ครบ 3 อย่างเพิ่มจากวันที่ (รวมเป็น 4): ยอดเงิน,
-- ประเภทรับเงิน (kind), และดีล (root_quote_id) ต้องเท่ากับใบเดิมทุกตัว — ยอดเงิน
-- เปลี่ยนแปลว่าไม่ใช่ reissue ของใบเดียวกันแล้ว (ให้ออกใบใหม่ตามปกติแทน ไม่ผ่าน
-- p_reissued_from) เช็คดีลด้วย root_quote_id เพราะต่อราคาสร้างแถว oem_quote ใหม่ —
-- ใบเดิม/ใบใหม่อาจเป็นคนละแถวในตาราง oem_quote ได้แต่ต้องเป็นดีลเดียวกันเสมอ
--
-- ด่าน "ดีลเดียวกัน" ต้องอยู่หลัง select v_quote for update เพราะต้องใช้
-- v_quote.root_quote_id ซึ่งยังไม่ถูกโหลด ณ จุดที่ตรวจ p_reissued_from เดิม (ก่อน
-- select v_quote) — ด่านยอดเงิน/kind ไม่ต้องพึ่ง v_quote แต่ย้ายมาไว้จุดเดียวกันเพื่อ
-- อ่านง่าย (ทุกด่าน reissue อยู่รวมกันที่เดียว)
--
-- oem_receipt_issue: plain create or replace (signature เดิมเป๊ะ 9 args — เหตุผล
-- "ไม่ overload" เดียวกับ 0086 หัวไฟล์) body ทั้งหมดคัดลอกจาก 0086 คำต่อคำ แก้แค่
-- 2 จุด: (a) select ที่ดึงข้อมูลใบเดิมตอนตรวจ p_reissued_from เพิ่มคอลัมน์
-- amount_thb/kind/root_quote_id ของใบเดิม (b) เพิ่ม gate ยอดเงิน/kind/ดีล ต่อจาก
-- select v_quote for update
--
-- ============ 2) 🔴 TRUNCATE ทะลุ trigger แถว ============
-- trigger กัน UPDATE/DELETE ของ 0086 เป็น `for each row` — TRUNCATE ไม่ยิง row
-- trigger เลยตามสเปก Postgres และ 0018:23 `grant all on tables to service_role`
-- ครอบ TRUNCATE ไปด้วย (service_role คือ role ที่แอปทั้งหมดวิ่งด้วย + BYPASSRLS)
-- แปลว่าลบเอกสารภาษีทั้งตารางได้ในคำสั่งเดียวโดย trigger ป้องกันที่มีอยู่ไม่ทำงาน
-- เลยแม้แต่นิดเดียว เอกสารภาษี (oem_receipt) และตัวนับเลขที่ (oem_doc_counter) เข้า
-- ข่ายนี้ทั้งคู่
--
-- แก้ 2 ชั้น (revoke อย่างเดียวไม่พอ เพราะวันหน้าอาจมีคน grant กลับโดยไม่รู้ที่มา):
--  (a) revoke truncate on ... from service_role — ปิดสิทธิ์ที่ต้นตอ
--  (b) trigger `before truncate ... for each statement` ที่ raise เสมอ — กันเผื่อ
--      วันหน้ามีคน grant truncate กลับมาโดยไม่ได้อ่าน comment นี้
--
-- ============ 3) branch_label ไม่มีเพดาน — ขึ้นเอกสารภาษีตรงๆ แก้ทีหลังไม่ได้ =====
-- oem_quote_set_billing (0086:146) ใช้ nullif(btrim(...), '') เฉยๆ ไม่มี left() ไม่มี
-- เช็ค newline/tab ต่างจาก description (500) และ payment_ref (128) ในไฟล์เดียวกันของ
-- 0086 ที่มีเพดานทั้งคู่ ความเสี่ยง: branch_label ถูก snapshot ติดใบเสร็จถาวรที่
-- oem_receipt_issue (buyer_branch_label) และพิมพ์ใต้ชื่อผู้ซื้อบนเอกสารภาษี — ข้อความ
-- ยาว/มี newline ปลอมเป็นบรรทัดที่ระบบออกให้เองได้ (เช่น "สำนักงานใหญ่ · ชำระครบถ้วน
-- แล้ว ไม่มียอดค้าง") แล้วเอกสารที่ออกไปแล้วแก้ไม่ได้ตามกติกา §7 ของเอกสารภาษี
--
-- แก้: left(..., 60) ตัดความยาว + ปฏิเสธถ้ามี newline/tab (ไม่ใช่แค่ตัดทิ้งเงียบๆ —
-- ผู้กรอกต้องรู้ว่าทำไมบันทึกไม่ผ่าน) oem_quote_set_billing: plain create or replace
-- (signature เดิมเป๊ะ uuid, uuid, jsonb) body คัดลอกจาก 0086 คำต่อคำ แก้แค่บรรทัด
-- คำนวณ v_branch_label
--
-- ============ 4) เช็คใบเก่าค้าง (แจ้งอย่างเดียว ไม่แก้ข้อมูล) ============
-- ใบที่พาดหัวว่าใบกำกับภาษี (มี buyer_tax_id) แต่ไม่มี buyer_branch_label คือใบที่
-- ออกไปก่อน 0086 จะบังคับด่านนี้ (หรือหลุดด่านมาด้วยเหตุอื่น) — เอกสารออกแล้วแก้ไม่ได้
-- (§7) จึงทำได้แค่แจ้งให้เจ้าของ void + reissue เอง ไม่ใช่หน้าที่ migration ที่จะไป
-- UPDATE แถวที่ออกแล้วตรงๆ (นั่นคือสิ่งที่ §2 ของ 0086 เพิ่งปิดไป)
--
-- ============ อ่านคู่กับ ============
-- 0086 (ไฟล์นี้ replace เฉพาะ oem_receipt_issue + oem_quote_set_billing เท่านั้น —
-- ต้องลอก body ฉบับ 0086 ไม่ใช่ 0084 ไม่งั้นด่านข้อมูลผู้ซื้อ + ด่านงวดภาษีของ 0086
-- จะหายไปทั้งชุด), 0084 (oem_receipt_void/v_oem_receipt/v_oem_quote — ไม่แตะ),
-- 0085 (renegotiate — ไม่แตะ)
-- ============================================================================

-- ============================================================================
-- 1. analytics.oem_receipt_issue — plain replace (signature เดิมเป๊ะ 9 args)
--    body คัดลอกจาก 0086 คำต่อคำ + gate ผูก reissue เข้ากับใบเดิมครบ 4 อย่าง
--    (วันที่ [เดิมจาก 0086] + ยอดเงิน/kind/ดีล [ใหม่ใน 0087])
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
  v_bkk_month_start date;
  v_reissued_from_received_date date; -- 0086: วันรับเงินของใบเดิมที่ถูก void (เฉพาะตอน reissue)
  v_reissued_from_amount_thb numeric; -- 0087: ยอดเงินของใบเดิม (เฉพาะตอน reissue) ต้องเท่ากับ p_amount_thb
  v_reissued_from_kind text; -- 0087: ประเภทรับเงินของใบเดิม (เฉพาะตอน reissue) ต้องเท่ากับ p_kind
  v_reissued_from_root_quote_id uuid; -- 0087: root deal ของใบเดิม (เฉพาะตอน reissue) ต้องเท่ากับดีลของใบใหม่
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
  -- เคยถูก reissue ซ้ำมาก่อน (กันออกใบแทนใบเดียวกันซ้ำสองครั้งโดยไม่ตั้งใจ) — 0086:
  -- เปลี่ยนจาก exists() เป็น select ... into เพื่อดึง received_date ของใบเดิมมาด้วย
  -- (ใช้เป็นข้อยกเว้นด่านงวดภาษี §3 ด้านล่าง — reissue ต้องใช้วันเดียวกับใบเดิมเท่านั้น)
  -- 0087: เพิ่ม amount_thb/kind/root_quote_id ของใบเดิมเข้ามาด้วย (join oem_quote
  -- เพื่อดึง root ของดีลใบเดิม) ใช้เทียบที่ gate ใหม่หลัง select v_quote ด้านล่าง —
  -- ยังต้องใช้ join เพราะใบเดิมอาจต่อราคาไปแล้วหลายรอบ quote_id ของใบเดิมกับใบใหม่
  -- อาจเป็นคนละแถวใน oem_quote ได้ ต้องเทียบที่ root_quote_id เท่านั้น
  if p_reissued_from is not null then
    select r.received_date, r.amount_thb, r.kind, coalesce(oq.root_quote_id, oq.id)
      into v_reissued_from_received_date, v_reissued_from_amount_thb, v_reissued_from_kind, v_reissued_from_root_quote_id
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

  -- timezone ไทย เสมอ — DB เป็น UTC ก่อน 07:00 ไทยจะเหลื่อมวัน ทั้งเลขที่เอกสาร
  -- และการเช็ค p_received_date ต้องยึดวันนี้ตามเวลาไทย ไม่ใช่ current_date (UTC)
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

  -- 0087 §1: reissue ต้องผูกกับใบเดิมครบ 4 อย่าง (วันที่ [ด่านเดิม §3 ด้านล่าง] +
  -- ยอดเงิน/kind/ดีล [ใหม่]) ไม่งั้นแค่ void ใบไหนก็ได้แล้วอ้าง reissue จะกลายเป็น
  -- ทางลัดออกใบยอดอื่น/ดีลอื่นข้ามงวดภาษีได้ ด่าน "ดีลเดียวกัน" ต้องอยู่ตรงนี้ (หลัง
  -- select v_quote for update ข้างบน) เพราะต้องใช้ v_quote.root_quote_id ซึ่งยังไม่
  -- ถูกโหลด ณ จุดตรวจ p_reissued_from ด้านบน
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
  -- oem_quote_set_billing) และมีชื่อนิติบุคคล/ผู้ซื้อเสมอ
  if v_quote.customer_id is null then
    raise exception 'oem_receipt_issue: ใบนี้ยังไม่ได้ผูกข้อมูลผู้ซื้อ (ชื่อออกบิล/ที่อยู่) — ตั้งค่าก่อนออกใบเสร็จ' using errcode = '22023';
  end if;
  select * into v_customer from analytics.oem_customer where id = v_quote.customer_id and shop_id = p_shop_id;
  if not found or nullif(btrim(v_customer.legal_name), '') is null then
    raise exception 'oem_receipt_issue: ข้อมูลผู้ซื้อของใบนี้ยังไม่มีชื่อนิติบุคคล/ชื่อผู้ซื้อ — ตั้งค่าก่อนออกใบเสร็จ' using errcode = '22023';
  end if;

  -- 0086 §1(ค): แก้คอมเมนต์ที่ผิดของ 0084:287 ("บุคคลธรรมดาไม่ต้องมี — UI เตือน
  -- เหลืองเอง") — ตรวจแล้วไม่มี UI เตือนจริง ด่านจริงอยู่ตรงนี้แทน: ผู้ซื้อมี
  -- tax_id (= นิติบุคคล = ใบกำกับภาษีเต็มรูปตาม ป.รัษฎากร ม.86/4 ต้องมีชื่อ+
  -- ที่อยู่+เลขผู้เสียภาษี+สาขาของทั้งสองฝ่ายครบ) ต้องมีที่อยู่และสาขาครบก่อน
  -- ออกใบได้ — ไม่มี tax_id (บุคคลธรรมดา) ผ่านได้เหมือนเดิม เอกสารที่ออกให้
  -- บุคคลธรรมดาจะไม่พาดหัวว่า "ใบกำกับภาษี" (ฝั่งจอ/frontend-dev ตัดสินใจตอน
  -- render จาก buyer_tax_id is null ของแถวนี้ — ไม่ใช่หน้าที่ของ migration นี้)
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

  -- 0086 §3 (revised — coordinator ตีกลับ v1): เดิมด่านนี้ปฏิเสธ received_date
  -- ก่อนต้นเดือนนี้เสมอไม่มีข้อยกเว้น ซึ่งบล็อก "reissue ข้ามเดือน" ที่ถูกต้องตาม
  -- บัญชีไปด้วย — เคสจริง: ออกใบ 15 ส.ค. (received_date = 15 ส.ค. ถูกต้องตอนนั้น)
  -- เจอข้อผิดพลาด void วันที่ 5 ก.ย. แล้ว reissue ใบใหม่ ใบใหม่ "ต้อง" ใช้
  -- received_date = 15 ส.ค. เพราะนั่นคือ tax point จริง (วันรับเงินจริง) ไม่ใช่
  -- วันที่ void/reissue — ด่านเดิมจะบังคับให้กรอกวันที่ผิด (5 ก.ย.) ซึ่งแย่กว่า
  -- ปัญหาที่ด่านนี้ตั้งใจกัน
  --
  -- แก้: เปิดข้อยกเว้นเฉพาะ reissue ที่ received_date ตรงกับใบเดิมเป๊ะเท่านั้น —
  -- ไม่ใช่ "เป็น reissue ก็ผ่านด่านงวดภาษีไปเลย" (ถ้าปล่อยกรอกวันไหนก็ได้ตอน
  -- reissue จะกลายเป็นทางลัดย้อนงวดภาษี แค่ void ใบไหนก็ได้แล้วอ้างว่า reissue
  -- ด้วยวันที่ใดก็ได้) v_reissued_from_received_date ถูกดึงมาจากใบเดิมที่ยืนยัน
  -- แล้วว่าเป็นของ shop นี้จริงและ void แล้วเท่านั้น (ดักด้านบน) — ใบ non-reissue
  -- ยังใช้ด่านงวดภาษีเดิมทุกประการ ไม่ผ่อน
  -- 0087: ตอนนี้ "เป็น reissue" ยังถูกผูกเพิ่มกับยอดเงิน/kind/ดีลของใบเดิมแล้ว
  -- (gate ด้านบน) ข้อยกเว้นด่านงวดภาษีนี้จึงปลอดภัยจริง เพราะแปลว่าใบใหม่คือใบเดิม
  -- ที่แก้ผิดพลาดแล้วออกใหม่จริงๆ ไม่ใช่ใบยอด/ดีลอื่นที่ยืมวันที่มา
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
    -- 0086: buyer_branch_label เขียนค่าจริงจาก oem_customer.branch_label แล้ว
    -- (เดิม 0084 hardcode null ตายตัวเพราะยังไม่มีคอลัมน์ต้นทาง — ตอนนี้มีแล้ว
    -- และผ่านด่านครบ/ไม่ครบด้านบนมาแล้วแล้วแต่กรณี)
    v_seller_snapshot, v_customer.legal_name, v_customer.tax_id, v_customer.branch_label, v_customer.address,
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
-- 2. analytics.oem_quote_set_billing — plain replace (signature เดิมเป๊ะ
--    uuid, uuid, jsonb) body คัดลอกจาก 0086 คำต่อคำ แก้แค่บรรทัดคำนวณ
--    v_branch_label: เพิ่ม left(..., 60) + ปฏิเสธถ้ามี newline/tab
-- ============================================================================

create or replace function analytics.oem_quote_set_billing(
  p_shop_id uuid,
  p_quote_id uuid,
  p_customer jsonb
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_status text;
  v_existing_customer_id uuid;
  v_customer_id uuid;
  v_legal_name text;
  v_tax_id text;
  v_address jsonb;
  v_phone text;
  v_contact_channel text;
  v_branch_label text; -- 0086: ใหม่ — key เพิ่มใน p_customer เดิม ไม่ใช่ parameter ใหม่
begin
  if p_shop_id is null or p_quote_id is null or p_customer is null then
    raise exception 'oem_quote_set_billing: p_shop_id, p_quote_id and p_customer are required';
  end if;
  if jsonb_typeof(p_customer) <> 'object' then
    raise exception 'oem_quote_set_billing: p_customer must be a json object';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  select status, customer_id into v_status, v_existing_customer_id
    from analytics.oem_quote where id = p_quote_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'oem_quote_set_billing: quote % not found for this shop', p_quote_id;
  end if;
  if v_status not in ('quoted', 'won') then
    raise exception 'oem_quote_set_billing: ผูกข้อมูลออกบิลได้เฉพาะใบที่สถานะ quoted หรือ won (ใบนี้สถานะ %)', v_status
      using errcode = '22023';
  end if;

  v_legal_name := nullif(btrim(p_customer->>'legal_name'), '');
  if v_legal_name is null then
    raise exception 'oem_quote_set_billing: p_customer.legal_name is required' using errcode = '22023';
  end if;
  v_tax_id := nullif(btrim(p_customer->>'tax_id'), '');
  v_address := p_customer->'address';
  v_phone := nullif(btrim(p_customer->>'phone'), '');
  v_contact_channel := nullif(btrim(p_customer->>'contact_channel'), '');
  -- 0086: branch_label ยังคง "optional ที่นี่" เหมือน tax_id — บังคับให้ครบเมื่อ
  -- จำเป็นจริง (ผู้ซื้อมี tax_id) ทำที่ oem_receipt_issue ตอนออกใบเท่านั้น ไม่ใช่
  -- ที่นี่ เพราะจุดนี้เป็นแค่ "บันทึกข้อมูลผู้ซื้อ" ยังไม่ใช่จุดที่ตัดสินว่าจะออก
  -- เอกสารภาษีแบบไหน (ผู้ซื้ออาจเพิ่ม tax_id เข้ามาทีหลังก็ได้ ก่อนออกใบจริง)
  -- 0087 §3: ไม่มีเพดานความยาว/ไม่กัน newline-tab มาก่อน (ต่างจาก description/
  -- payment_ref ของ oem_receipt_issue ที่มีเพดานทั้งคู่) เสี่ยงเพราะ branch_label
  -- ถูก snapshot ติดใบเสร็จถาวรแล้วพิมพ์ใต้ชื่อผู้ซื้อบนเอกสารภาษี — ข้อความยาว/
  -- มี newline ปลอมเป็นบรรทัดที่ระบบออกให้เองได้ แล้วแก้ย้อนหลังไม่ได้ (เอกสาร
  -- ออกแล้วห้ามแก้) ปฏิเสธตรงๆ แทนตัดทิ้งเงียบๆ เพื่อให้ผู้กรอกรู้ว่าทำไมไม่ผ่าน
  v_branch_label := nullif(btrim(p_customer->>'branch_label'), '');
  if v_branch_label is not null and v_branch_label ~ '[\n\r\t]' then
    raise exception 'oem_quote_set_billing: p_customer.branch_label ห้ามมีขึ้นบรรทัดใหม่หรือ tab (สาขาผู้ซื้อจะถูกพิมพ์บนเอกสารภาษี ต้องเป็นข้อความบรรทัดเดียว)' using errcode = '22023';
  end if;
  v_branch_label := left(v_branch_label, 60);

  if v_existing_customer_id is not null then
    update analytics.oem_customer set
      legal_name = v_legal_name,
      tax_id = v_tax_id,
      address = v_address,
      phone = v_phone,
      contact_channel = v_contact_channel,
      branch_label = v_branch_label,
      updated_at = now()
    where id = v_existing_customer_id and shop_id = p_shop_id;
    v_customer_id := v_existing_customer_id;
  else
    insert into analytics.oem_customer (shop_id, legal_name, tax_id, address, phone, contact_channel, branch_label)
    values (p_shop_id, v_legal_name, v_tax_id, v_address, v_phone, v_contact_channel, v_branch_label)
    returning id into v_customer_id;
  end if;

  update analytics.oem_quote set customer_id = v_customer_id, updated_by = auth.uid(), updated_at = now()
  where id = p_quote_id and shop_id = p_shop_id;

  return v_customer_id;
end;
$$;

revoke execute on function analytics.oem_quote_set_billing(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function analytics.oem_quote_set_billing(uuid, uuid, jsonb) to authenticated, service_role;

-- ============================================================================
-- 3. TRUNCATE ทะลุ trigger แถวของ 0086 — ปิด 2 ชั้น (revoke ที่ต้นตอ + trigger
--    statement-level กันเผื่อวันหน้ามีคน grant กลับมาโดยไม่รู้ที่มา)
-- ============================================================================

revoke truncate on analytics.oem_receipt from service_role;
revoke truncate on analytics.oem_doc_counter from service_role;

create or replace function analytics.oem_receipt_deny_truncate()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
begin
  raise exception 'oem_receipt/oem_doc_counter: ห้าม TRUNCATE ตาราง % — เอกสารภาษี/ตัวนับเลขที่เอกสารต้องคงอยู่ตลอดไป ห้ามลบทั้งตารางไม่ว่ากรณีใด (ยกเลิกทีละใบด้วย analytics.oem_receipt_void แทน)', tg_table_name
    using errcode = '22023';
end;
$$;

revoke execute on function analytics.oem_receipt_deny_truncate() from public, anon, authenticated;

comment on function analytics.oem_receipt_deny_truncate() is
  '0087: trigger function กัน TRUNCATE บน analytics.oem_receipt/oem_doc_counter — trigger UPDATE/DELETE ของ 0086 เป็น "for each row" ซึ่ง TRUNCATE ไม่ยิงเลยตามสเปก Postgres จึงต้องมี statement-level trigger แยกต่างหาก เป็นเกราะชั้นที่สองต่อจาก revoke truncate ด้านบน (เผื่อวันหน้ามีคน grant กลับมาโดยไม่อ่าน comment นี้) ดู 0087 หัวไฟล์ §2';

drop trigger if exists trg_oem_receipt_deny_truncate on analytics.oem_receipt;
create trigger trg_oem_receipt_deny_truncate
  before truncate on analytics.oem_receipt
  for each statement execute function analytics.oem_receipt_deny_truncate();

drop trigger if exists trg_oem_doc_counter_deny_truncate on analytics.oem_doc_counter;
create trigger trg_oem_doc_counter_deny_truncate
  before truncate on analytics.oem_doc_counter
  for each statement execute function analytics.oem_receipt_deny_truncate();

-- ============================================================================
-- 4. เช็คใบกำกับภาษีค้าง — ใบที่พาดหัวว่าใบกำกับภาษี (มี buyer_tax_id) แต่ไม่มี
--    buyer_branch_label เพราะออกไปก่อน 0086 บังคับด่านนี้ — แจ้งอย่างเดียว ไม่แก้
--    ข้อมูล (เอกสารออกแล้วแก้ไม่ได้ ต้องให้เจ้าของ void + reissue เอง) ใช้ตัวนับ
--    เองแทนพึ่ง `found` หลัง loop (บทเรียน skill 3j-migration-traps ข้อ 8 — found
--    สะท้อนคำสั่งสุดท้ายในลูป ไม่ใช่ผลรวมของลูป)
-- ============================================================================

do $$
declare
  v_row record;
  v_count int := 0;
begin
  for v_row in
    select receipt_no, received_date, buyer_legal_name
      from analytics.oem_receipt
     where status = 'issued'
       and nullif(btrim(buyer_tax_id), '') is not null
       and nullif(btrim(buyer_branch_label), '') is null
  loop
    v_count := v_count + 1;
    raise notice '0087: ใบกำกับภาษีค้าง — เลขที่ % วันที่รับเงิน % ผู้ซื้อ % ไม่มีสาขาผู้ซื้อ (buyer_branch_label) — เอกสารออกแล้วแก้ไม่ได้ ต้องให้เจ้าของ void + reissue ใบนี้ใหม่เพื่อกรอกสาขาให้ครบ',
      v_row.receipt_no, v_row.received_date, v_row.buyer_legal_name;
  end loop;
  if v_count = 0 then
    raise notice '0087: ตรวจแล้ว ไม่มีใบกำกับภาษีที่ขาด buyer_branch_label ค้างอยู่';
  else
    raise notice '0087: พบใบกำกับภาษีขาด buyer_branch_label ทั้งหมด % ใบ — ดูรายละเอียดใน notice ด้านบน (ยังไม่ได้แก้ข้อมูลใดๆ อัตโนมัติ)', v_count;
  end if;
end;
$$;

notify pgrst, 'reload schema';
