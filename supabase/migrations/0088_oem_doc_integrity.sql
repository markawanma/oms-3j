-- 0088_oem_doc_integrity.sql
-- security ให้ GO แล้วบน 0087 แต่สั่งปิด 3 ข้อนี้ก่อนออกใบให้ลูกค้ารายแรกจริง
-- Tech Lead ยืนยันเองแล้วว่าทั้ง 3 ข้อจริง (ไม่ใช่ทฤษฎี)
--
-- ============ 1) 🟠 oem_doc_counter กัน TRUNCATE แล้ว แต่ UPDATE/DELETE ยังเปิดโล่ง ==
-- 0087 §2 ปิด TRUNCATE ให้ทั้ง oem_receipt และ oem_doc_counter แล้ว แต่ trigger
-- กัน UPDATE/DELETE "for each row" ของ 0086 §4 (trg_oem_receipt_deny_mutation)
-- ผูกไว้กับ oem_receipt ตัวเดียว — oem_doc_counter ไม่เคยมี trigger แบบนี้เลยตั้งแต่
-- 0084 สร้างตาราง แปลว่ายิงเข้าได้ 2 ทางแม้ TRUNCATE ปิดแล้ว:
--   (a) update analytics.oem_doc_counter set last_no = last_no + 500
--       -> เลขที่เอกสารกระโดดข้าม 500 ใบถาวร แก้ย้อนไม่ได้ (เอกสารที่ออกไปแล้ว
--       อ้างอิงเลขที่เดิม ส่วนเลขที่ถูกข้ามจะไม่มีวันถูกใช้อีกเลย)
--   (b) delete from analytics.oem_doc_counter
--       -> ตัวนับรีเซ็ตกลับไปเริ่มจาก insert ใหม่ (last_no = 1) ชนกับ
--       unique (shop_id, receipt_no) ของเอกสารที่ออกไปแล้วในเดือนนั้น
--       -> insert oem_receipt ใน oem_receipt_issue พังทั้งก้อน (rollback) ->
--       ออกใบเสร็จ/ใบกำกับภาษีไม่ได้อีกเลยทั้งเดือนจนกว่าจะมีคนไปแก้ตัวนับเอง
--
-- แก้: trigger `before update or delete for each row` บน analytics.oem_doc_counter
-- (คู่แฝดของ trg_oem_receipt_deny_mutation แต่กติกาต่างกันเพราะธรรมชาติของตาราง
-- ต่างกัน — oem_receipt อนุญาต 1 transition (issued->void) ส่วน oem_doc_counter
-- อนุญาต 1 รูปแบบการเพิ่มค่า):
--   - DELETE -> ปฏิเสธเสมอ ไม่มีข้อยกเว้น
--   - UPDATE ที่เปลี่ยน shop_id หรือ doc_key -> ปฏิเสธ (คีย์ของตัวนับต้องคงที่)
--   - UPDATE ที่ new.last_no != old.last_no + 1 -> ปฏิเสธ (last_no ขึ้นได้ทีละ 1
--     เท่านั้น ครอบคลุมทั้งกรณีเพิ่มมากกว่า 1 (ข้ามเลข) และกรณีไม่เพิ่ม/ลดลง)
--
-- ยืนยันแล้วว่า path การออกใบปกติยังทำงาน: oem_receipt_issue ใช้
--   insert into analytics.oem_doc_counter as c (shop_id, doc_key, last_no)
--   values (p_shop_id, v_doc_key, 1)
--   on conflict (shop_id, doc_key) do update set last_no = c.last_no + 1
--   returning last_no into v_no;
-- แถวใหม่ (doc_key ยังไม่เคยมี) เดินทาง INSERT ล้วนๆ ไม่ชน trigger นี้เลย (trigger
-- ผูกกับ UPDATE/DELETE เท่านั้น) ส่วนแถวเดิม (มี doc_key นี้ในเดือนนี้แล้ว) เดินทาง
-- ON CONFLICT DO UPDATE ซึ่งยิงเป็น UPDATE บนแถวเดิม โดย new.last_no = old.last_no + 1
-- พอดี (c.last_no คือค่า old ของแถวที่ชน conflict) และไม่แตะ shop_id/doc_key เลย
-- -> ผ่าน trigger นี้ได้เสมอ ไม่ต้องแก้ 0087/oem_receipt_issue ใดๆ
--
-- trigger function นี้ไม่ใช่ security definer (เหมือน oem_receipt_deny_truncate
-- ของ 0087 — trigger function ที่แค่ raise exception ไม่มีเหตุผลต้องรันด้วยสิทธิ์
-- เจ้าของ) pin search_path กันเผื่อ + revoke execute จาก public/anon/authenticated
-- ตามธรรมเนียมทีม (แม้ trigger function ไม่ได้ถูกเรียกตรงผ่าน PostgREST RPC
-- แต่ revoke ไว้กันการเรียกตรงโดยไม่ตั้งใจ)
--
-- ============ 2) 🟡 reissue ล็อกยอด/kind/วัน/ดีลแล้ว (0087) แต่ไม่ล็อกตัวผู้ซื้อ ===
-- 0087 §1 ผูก reissue เข้ากับใบเดิมครบ 4 อย่าง (วันที่/ยอดเงิน/kind/root_quote_id)
-- แต่ไม่มีอย่างไหนล็อก "ผู้ซื้อ" เลย — oem_customer เป็นตารางที่ oem_quote_set_billing
-- UPDATE แถวเดิมทับตรงๆ (ไม่ได้ insert แถวใหม่) แปลว่ายิงได้จริงผ่าน server action
-- ปกติ (owner/admin ไม่ต้องแตะ DB เลย):
--   1. มีใบจริง A: 15 ส.ค. ยอด 500,000 ดีล D ผู้ซื้อ = บริษัท ก (มี tax_id ก)
--   2. void ใบ A
--   3. oem_quote_set_billing(ดีล D, ...บริษัท ข...) -> UPDATE oem_customer แถวเดิม
--      ของดีล D ทับเป็นบริษัท ข ทันที (customer_id เดิมไม่เปลี่ยน แค่เนื้อในเปลี่ยน)
--   4. oem_receipt_issue(ยอดเดิม 500,000, kind เดิม, received_date เดิม 15 ส.ค.,
--      p_reissued_from = ใบ A) -> ผ่านทุกด่านของ 0087 (ยอด/kind/วัน/ดีลตรงกันหมด
--      เพราะเป็นดีล D เดิม) -> ได้ใบกำกับภาษีเต็มรูป ลงวันที่ 15 ส.ค. (งวดที่ยื่น
--      ภาษีไปแล้ว) ในชื่อบริษัท ข ทั้งที่เงินที่รับจริงวันนั้นมาจากบริษัท ก
-- นี่คือทางเดียวที่เหลือให้ออกใบกำกับภาษีย้อนงวดในชื่อใครก็ได้ — ใบกำกับภาษีคือ
-- สิ่งที่อีกฝ่ายเอาไปเคลม input VAT ได้จริง ผลกระทบจึงหนักกว่าข้อ 1/3
--
-- แก้: เพิ่ม gate ที่ 5 ให้ reissue (ล็อกเฉพาะ "ตัวผู้ซื้อ" ไม่ล็อกทั้งก้อนข้อมูล
-- ผู้ซื้อ) — เทียบ nullif(btrim(tax_id), '') ของผู้ซื้อปัจจุบัน (v_customer ของดีล
-- นี้) กับ buyer_tax_id ที่ snapshot ไว้บนใบเดิมที่ถูก void (ดึงเพิ่มในการ select
-- ที่ตรวจ p_reissued_from เดิม) ต่างกัน = ปฏิเสธ เหตุผลที่ล็อกด้วย tax_id ไม่ใช่
-- customer_id: customer_id เป็นแค่ FK ของแถว oem_customer ที่ UPDATE ทับได้ (คือ
-- ช่องโหว่ตัวนี้เอง) ส่วน tax_id ที่ snapshot ติดใบเสร็จเดิมเป็นค่าที่ล็อกแล้วตอน
-- ออกใบ ไม่มีทางถูกแก้ย้อนหลัง — เทียบกับ snapshot จึงจับได้แม้ customer_id เป็น
-- แถวเดียวกันตลอด (เคสข้างบน)
--
-- ล็อกแค่ tax_id ตัวเดียว ไม่ล็อกทั้งก้อน (ชื่อ/ที่อยู่/สาขา) เพราะแก้ชื่อ/ที่อยู่/
-- สาขาที่พิมพ์ผิดคือเหตุผลหลักที่ reissue มีอยู่ (พิมพ์ชื่อบริษัทผิดตัวสะกด, ที่อยู่
-- ตกหล่น, สาขาใส่ผิด — ทั้งหมดนี้ต้องแก้ได้ผ่าน reissue เหมือนเดิม) tax_id
-- ต่างหากที่บ่งบอกว่า "เปลี่ยนตัวผู้ซื้อ" จริง ๆ ไม่ใช่แค่แก้คำผิด — nullif(btrim())
-- ทั้งสองฝั่งกันช่องว่าง/สตริงว่างหลอก และใช้ IS DISTINCT FROM เพื่อให้
-- null -> null (บุคคลธรรมดาทั้งคู่) ผ่านได้ตามปกติ ไม่ล็อกเกินจำเป็น
--
-- ด่านนี้ต้องอยู่ "หลัง" select * into v_customer (0087:227 / บล็อกเดียวกันใน
-- ไฟล์นี้) เพราะต้องใช้ v_customer.tax_id ซึ่งยังไม่ถูกโหลด ณ จุดที่ตรวจ
-- p_reissued_from เดิม (ก่อน select v_quote) — วางไว้ทันทีหลังด่าน "ผู้ซื้อต้องมี
-- ชื่อนิติบุคคล/ชื่อผู้ซื้อ" และก่อนด่านที่อยู่/สาขาของ 0086 §1(ค)
--
-- oem_receipt_issue: plain create or replace (signature เดิมเป๊ะ 9 args) body
-- ทั้งหมดคัดลอกจาก 0087 คำต่อคำ แก้ 2 จุดเท่านั้น: (a) select ที่ตรวจ
-- p_reissued_from เพิ่มคอลัมน์ r.buyer_tax_id (b) เพิ่ม gate ใหม่หลัง select
-- v_customer — ด่านยอดเงิน/kind/ดีล/วันที่ของ 0087 ทั้งหมดคงอยู่ไม่แตะ
--
-- ============ 3) 🟡 branch_label ยาวเกิน 60 ถูกตัดเงียบ ============
-- 0087:442 `v_branch_label := left(v_branch_label, 60);` ตัดความยาวแบบเงียบ ทั้งที่
-- คอมเมนต์ของ 0087 เองบรรทัด 437 เขียนไว้ชัดว่า "ปฏิเสธตรงๆ แทนตัดทิ้งเงียบๆ" —
-- ทำแค่ครึ่งเดียวของสิ่งที่ตัวเองประกาศ (newline/tab ปฏิเสธจริง ✅ / ความยาวตัด
-- ทิ้งเงียบๆ ยังอยู่ ❌) server action (lib/actions/oem.ts:1116) ส่งค่าดิบเข้ามา
-- โดยไม่มี cap ฝั่ง client แปลว่ายิง action ตรงด้วยสตริงยาว (เช่น "สาขาที่ 1
-- อาคาร...") จะโดนตัดกลางคำเงียบๆ ที่ DB แล้ว snapshot ค่าที่ถูกตัดทิ้งนี้ติดใบ
-- กำกับภาษีถาวรทันทีที่ออกใบครั้งถัดไป (เอกสารออกแล้วแก้ไม่ได้ตาม §7)
--
-- แก้: เปลี่ยน left(..., 60) เป็น raise exception บอกจำนวนตัวอักษรที่กรอกมาจริง
-- ให้ผู้กรอกรู้ว่าทำไมบันทึกไม่ผ่าน (เหมือนแนวทาง newline/tab gate ที่อยู่บรรทัด
-- ก่อนหน้าในไฟล์เดียวกัน) oem_quote_set_billing: plain create or replace
-- (signature เดิมเป๊ะ uuid, uuid, jsonb) body คัดลอกจาก 0087 คำต่อคำ แก้แค่บรรทัด
-- คำนวณ v_branch_label บรรทัดเดียว
--
-- ============ อ่านคู่กับ ============
-- 0087 (oem_receipt_issue/oem_quote_set_billing ฉบับก่อนหน้า — ไฟล์นี้ replace
-- ทั้งสองฟังก์ชันต่อจาก 0087 ต้องลอก body จาก 0087 เท่านั้น ไม่ใช่ 0086/0084
-- ไม่งั้นด่านยอดเงิน/kind/ดีลของ 0087 หายทั้งชุด), 0086 (buyer completeness gate,
-- trg_oem_receipt_deny_mutation ต้นแบบของ trigger ข้อ 1), 0084 (oem_doc_counter
-- ตั้งต้น — ไม่แตะโครงสร้างตาราง แค่เพิ่ม trigger)
-- ============================================================================

-- ============================================================================
-- 1. analytics.oem_doc_counter — trigger กัน UPDATE/DELETE ตรง (คู่แฝด
--    trg_oem_receipt_deny_mutation ของ 0086 แต่กติกาเฉพาะของตัวนับเลขที่เอกสาร)
-- ============================================================================

create or replace function analytics.oem_doc_counter_deny_mutation()
 returns trigger
 language plpgsql
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'oem_doc_counter: ห้ามลบแถวตัวนับเลขที่เอกสาร — ลบแล้วตัวนับจะเริ่มนับใหม่จาก 1 ชนกับเลขที่เอกสารที่ออกไปแล้วในเดือนนั้น (unique shop_id/receipt_no) แล้วออกใบเสร็จ/ใบกำกับภาษีไม่ได้อีกเลยทั้งเดือน' using errcode = '22023';
  end if;

  -- tg_op = 'UPDATE' จากนี้ไป
  if new.shop_id is distinct from old.shop_id or new.doc_key is distinct from old.doc_key then
    raise exception 'oem_doc_counter: ห้ามเปลี่ยน shop_id หรือ doc_key ของแถวตัวนับที่มีอยู่แล้ว (คีย์ของตัวนับต้องคงที่ตลอดอายุแถว) — ต้องการ doc_key ใหม่ให้ปล่อยให้ analytics.oem_receipt_issue สร้างแถวใหม่เองผ่าน insert' using errcode = '22023';
  end if;

  if new.last_no is distinct from old.last_no + 1 then
    raise exception 'oem_doc_counter: last_no ขึ้นได้ทีละ 1 เท่านั้น (เดิม % ใหม่ %) — ป้องกันเลขที่เอกสารกระโดดข้ามถาวร ห้าม UPDATE ตัวนับตรงๆ ไม่ว่ากรณีใด ออกใบผ่าน analytics.oem_receipt_issue เท่านั้น (ทำ +1 ผ่าน on conflict do update ในทรานแซคชันเดียวกับการออกใบ)',
      old.last_no, new.last_no using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke execute on function analytics.oem_doc_counter_deny_mutation() from public, anon, authenticated;

comment on function analytics.oem_doc_counter_deny_mutation() is
  '0088: trigger function กัน UPDATE/DELETE ตรงบน analytics.oem_doc_counter — 0087 ปิด TRUNCATE ไปแล้วแต่ลืมตารางนี้สำหรับ UPDATE/DELETE ระดับแถว (มีแค่ oem_receipt ที่มี trg_oem_receipt_deny_mutation ของ 0086) DELETE ปฏิเสธเสมอ, UPDATE อนุญาตเฉพาะ last_no = last_no+1 และห้ามเปลี่ยน shop_id/doc_key ดู 0088 หัวไฟล์ §1';

drop trigger if exists trg_oem_doc_counter_deny_mutation on analytics.oem_doc_counter;
create trigger trg_oem_doc_counter_deny_mutation
  before update or delete on analytics.oem_doc_counter
  for each row execute function analytics.oem_doc_counter_deny_mutation();

-- ============================================================================
-- 2. analytics.oem_receipt_issue — plain replace (signature เดิมเป๊ะ 9 args)
--    body คัดลอกจาก 0087 คำต่อคำ + gate ใหม่: reissue ต้องเป็นผู้ซื้อ (tax_id)
--    เดียวกับใบเดิมที่ถูก void เท่านั้น (ดู 0088 หัวไฟล์ §2)
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
  v_reissued_from_buyer_tax_id text; -- 0088: เลขผู้เสียภาษีผู้ซื้อที่ snapshot ไว้บนใบเดิม (เฉพาะตอน reissue) ต้องเท่ากับ v_customer.tax_id ปัจจุบันของดีลนี้
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
  -- 0088: เพิ่ม r.buyer_tax_id ของใบเดิมเข้ามาด้วย ใช้เทียบที่ gate ใหม่หลัง select
  -- v_customer ด้านล่าง (§2 ของหัวไฟล์นี้) — ล็อกตัวผู้ซื้อของ reissue เข้ากับ
  -- snapshot บนใบเดิม กัน oem_quote_set_billing แก้ผู้ซื้อทับก่อน reissue
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

  -- 0088 §2: reissue ต้องเป็นผู้ซื้อรายเดิม (เทียบเลขผู้เสียภาษี) เท่านั้น —
  -- oem_quote_set_billing UPDATE แถว oem_customer เดิมทับตรงๆ ไม่ได้สร้างแถวใหม่
  -- แปลว่าระหว่างช่วง void ใบเดิม -> reissue ใบใหม่ เจ้าของ/แอดมินสามารถแก้ผู้ซื้อ
  -- ของดีลนี้เป็นคนละรายได้โดยไม่ต้องแตะ DB ตรง (ผ่าน server action ปกติ) ถ้าไม่ล็อก
  -- จุดนี้ reissue จะกลายเป็นทางเดียวที่เหลือให้ออกใบกำกับภาษีย้อนงวดภาษีในชื่อ
  -- ใครก็ได้ (ด่านยอด/kind/ดีล/วันที่ของ 0087 ผ่านหมดเพราะเป็นดีลเดียวกันจริง)
  -- เทียบกับ snapshot buyer_tax_id ที่ล็อกไว้แล้วบนใบเดิม (v_reissued_from_buyer_tax_id
  -- ดึงมาตอนตรวจ p_reissued_from ด้านบน) ไม่ใช่เทียบ customer_id เพราะ customer_id
  -- เป็นแถวเดียวกันตลอดในเคสนี้ (ช่องโหว่คือเนื้อในแถวถูกแก้ทับ ไม่ใช่ FK เปลี่ยน)
  -- ล็อกเฉพาะ tax_id ตัวเดียว ไม่ล็อกทั้งก้อน — แก้ชื่อ/ที่อยู่/สาขาที่พิมพ์ผิดยัง
  -- ทำได้ผ่าน reissue เหมือนเดิม (นั่นคือเหตุผลหลักที่ reissue มีอยู่) และ
  -- null -> null ต้องผ่าน (บุคคลธรรมดาไม่มี tax_id ทั้งใบเดิม/ใบใหม่ — IS DISTINCT
  -- FROM ถือว่า null กับ null ไม่ distinct อยู่แล้ว ไม่ต้องเขียนเงื่อนไขพิเศษ)
  if p_reissued_from is not null then
    if nullif(btrim(v_customer.tax_id), '') is distinct from nullif(btrim(v_reissued_from_buyer_tax_id), '') then
      raise exception 'oem_receipt_issue: reissue ต้องออกให้ผู้ซื้อรายเดิมเท่านั้น (ใบเดิม % ผูกผู้ซื้อเลขผู้เสียภาษี "%" แต่ข้อมูลผู้ซื้อปัจจุบันของดีลนี้เป็นเลขผู้เสียภาษี "%") — ถ้าผู้ซื้อเปลี่ยนจริง ต้องออกใบใหม่ตามปกติโดยไม่ระบุ p_reissued_from ไม่ใช่ reissue ใบเดิม',
        p_reissued_from, coalesce(v_reissued_from_buyer_tax_id, '(บุคคลธรรมดา/ไม่มีเลขผู้เสียภาษี)'), coalesce(v_customer.tax_id, '(บุคคลธรรมดา/ไม่มีเลขผู้เสียภาษี)')
        using errcode = '22023';
    end if;
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
  -- receipt ข้างล่าง (ถ้า insert fail ทั้งก้อน rollback ตัวนับถอยกลับด้วย = ไม่มี
  -- เลขข้าม) ไม่มี retry loop เพราะ concurrent request ที่สองแค่ "รอ" row lock
  -- แล้วได้เลขถัดไป ไม่ชนกันเลย — 0088: ON CONFLICT DO UPDATE นี้ยิงเป็น UPDATE
  -- ที่ new.last_no = old.last_no + 1 พอดี ผ่าน trg_oem_doc_counter_deny_mutation
  -- (§1 ของไฟล์นี้) เสมอ ไม่ต้องแก้บรรทัดนี้
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
-- 3. analytics.oem_quote_set_billing — plain replace (signature เดิมเป๊ะ
--    uuid, uuid, jsonb) body คัดลอกจาก 0087 คำต่อคำ แก้แค่บรรทัดคำนวณ
--    v_branch_label: เปลี่ยน left(..., 60) (ตัดเงียบ) เป็น raise exception
--    (ดู 0088 หัวไฟล์ §3)
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
  -- 0088 §3: เดิมเป็น left(v_branch_label, 60) ตัดความยาวทิ้งเงียบๆ (ทั้งที่
  -- คอมเมนต์บรรทัดบนของ 0087 เองประกาศไว้ว่า "ปฏิเสธตรงๆ แทนตัดทิ้งเงียบๆ" — ทำ
  -- แค่ครึ่งเดียว) เปลี่ยนเป็นปฏิเสธพร้อมบอกจำนวนตัวอักษรที่กรอกมาจริง เอกสารที่
  -- ออกแล้วห้ามแก้ (§7) การตัดทิ้งเงียบๆ จะ snapshot ค่าที่ถูกตัดกลางคำติดใบกำกับ
  -- ภาษีถาวรโดยผู้กรอกไม่รู้ตัว
  if v_branch_label is not null and length(v_branch_label) > 60 then
    raise exception 'oem_quote_set_billing: p_customer.branch_label ยาวเกินไป (% ตัวอักษร) — สาขาผู้ซื้อต้องยาวไม่เกิน 60 ตัวอักษร (จะถูกพิมพ์บนเอกสารภาษี) กรุณาย่อข้อความให้สั้นลง', length(v_branch_label)
      using errcode = '22023';
  end if;

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

notify pgrst, 'reload schema';
