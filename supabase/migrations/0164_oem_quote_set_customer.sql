-- 0164_oem_quote_set_customer.sql
--
-- ทำไม: กล่อง "ลูกค้า" ในหน้ารายละเอียดใบเสนอราคา OEM (oem_quote.customer_name / customer_contact)
-- ตั้งได้เฉพาะตอน oem_quote_save — ใบ quoted แล้ว "เติมทีหลังไม่ได้" (เคสจริง OEM-2610-003 ว่างทั้งคู่)
-- และหน้าพิมพ์ fallback ไปใช้ customer_name เมื่อไม่มีข้อมูลออกบิล (PrintQuoteClient:
-- billLegalName || customerName) ใบที่ลูกค้าว่างจึงพิมพ์ "-" เจ้าของสั่งเพิ่มทางแก้ (7 ต.ค. 69)
--
-- RPC ใหม่: analytics.oem_quote_set_customer(p_shop_id, p_quote_id, p_customer_name, p_customer_contact)
--   - แก้ได้ทุกสถานะ ยกเว้นใบที่ปิด/ยกเลิก: lost · rejected · superseded (ชื่อสถานะจริงจาก
--     oem_quote_status_check: draft/quoted/won/lost/expired/rejected/superseded) · expired แก้ได้ (ไม่ใช่ใบที่ยกเลิก)
--     ใบ superseded ถูกแทนที่ด้วยใบลูกที่ copy ชื่อ/ช่องทางไปแล้ว — แก้ใบเก่าไม่มีผล มีแต่ทำให้ประวัติเพี้ยน
--   - btrim แล้วว่าง = null (ล้างค่า) · ทั้งสองช่องส่ง null/ว่างได้
--   - ปฏิเสธ (ไม่ตัดเงียบ — แนวเดียวกับ 0087/0088): ยาว > 200 ตัวอักษร · มี control char/ขึ้นบรรทัดใหม่/tab ·
--     มี bidi/zero-width (U+200B-200F, 202A-202E, 2060-2064, 2066-2069, FEFF — ชุดเดียวกับ 0158)
--     เหตุผล: ชื่อนี้ถูกพิมพ์บนใบเสนอราคาที่ส่งลูกค้า (fallback) — RLO ทำให้ชื่อที่อ่านจากซ้ายไปขวาเป็นอีกคำได้
--     ฝั่ง oem_quote_save เดิมไม่มีเพดาน/ไม่กรอง (ไม่แตะ — ไม่ใช่ขอบเขตรอบนี้) 200 ตัวอักษรเลือกเอง: ชื่อบริษัทไทยยาวสุด
--     ที่เจอยังไม่ถึง และ UI ใส่ maxLength เท่ากัน
--   - แตะ 4 คอลัมน์เท่านั้น: customer_name · customer_contact · updated_by · updated_at (รูปแบบเดียวกับ
--     oem_quote_set_billing: updated_by = auth.uid()) — ไม่แตะเงิน/สถานะ/เลขที่/customer_id/items/ตัวนับเอกสาร
--   - ล็อกแถว for update + เช็ค shop (ใบของร้านอื่น = not found) + crm_require_owner_admin
--
-- ไม่มี trigger บน analytics.oem_quote (ตรวจ pg_trigger แล้ว = 0 แถว — ไม่มี immutable guard ให้ยกเว้น ·
-- ข้อ 19 ของ 3j-migration-traps) ⇒ ไม่ต้องใช้ GUC · ความ "แตะแค่ 2 คอลัมน์" บังคับด้วยตัว UPDATE ของ RPC นี้
-- และ verify-0164 เทียบ md5 ทั้งแถว (ยกเว้น 4 คอลัมน์ข้างบน) ก่อน/หลัง
--
-- Grants (ข้อ 18): service_role เท่านั้น — revoke จาก public, anon, authenticated ครบสามชื่อ
-- ฟังก์ชันใหม่ ไม่มี overload เดิมให้ drop · idempotent (create or replace + revoke/grant ซ้ำได้)
--
-- 🔴 APPLIED แล้ว 7 ต.ค. 69 version 20261007135049 — ห้าม apply ซ้ำ · ชุดทดสอบ scripts/verify/verify-0164.sql (OK 39 / FAIL 0)

create or replace function analytics.oem_quote_set_customer(
  p_shop_id uuid,
  p_quote_id uuid,
  p_customer_name text,
  p_customer_contact text
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $$
declare
  v_status text;
  v_name text;
  v_contact text;
  -- control (รวม \n \r \t) + bidi/zero-width ชุดเดียวกับ 0158
  c_bad constant text := '[[:cntrl:]\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]';
begin
  if p_shop_id is null or p_quote_id is null then
    raise exception 'oem_quote_set_customer: p_shop_id and p_quote_id are required';
  end if;
  perform analytics.crm_require_owner_admin(p_shop_id);

  -- ตรวจรูปแบบก่อนล็อกแถว: ปฏิเสธเร็ว ไม่ถือ lock
  v_name := nullif(btrim(p_customer_name), '');
  v_contact := nullif(btrim(p_customer_contact), '');
  if v_name is not null and v_name ~ c_bad then
    raise exception 'oem_quote_set_customer: ชื่อลูกค้าห้ามมีขึ้นบรรทัดใหม่ tab หรืออักขระควบคุม/ล่องหน (ชื่อจะถูกพิมพ์บนใบเสนอราคา)'
      using errcode = '22023';
  end if;
  if v_contact is not null and v_contact ~ c_bad then
    raise exception 'oem_quote_set_customer: ช่องทางติดต่อห้ามมีขึ้นบรรทัดใหม่ tab หรืออักขระควบคุม/ล่องหน'
      using errcode = '22023';
  end if;
  if v_name is not null and length(v_name) > 200 then
    raise exception 'oem_quote_set_customer: ชื่อลูกค้ายาวเกินไป (% ตัวอักษร) — ไม่เกิน 200 ตัวอักษร', length(v_name)
      using errcode = '22023';
  end if;
  if v_contact is not null and length(v_contact) > 200 then
    raise exception 'oem_quote_set_customer: ช่องทางติดต่อยาวเกินไป (% ตัวอักษร) — ไม่เกิน 200 ตัวอักษร', length(v_contact)
      using errcode = '22023';
  end if;

  select status into v_status
    from analytics.oem_quote where id = p_quote_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'oem_quote_set_customer: quote % not found for this shop', p_quote_id;
  end if;
  if v_status in ('lost', 'rejected', 'superseded') then
    raise exception 'oem_quote_set_customer: ใบที่ปิด/ยกเลิกแล้วแก้ข้อมูลลูกค้าไม่ได้ (ใบนี้สถานะ %)', v_status
      using errcode = '22023';
  end if;

  update analytics.oem_quote set
    customer_name = v_name,
    customer_contact = v_contact,
    updated_by = auth.uid(),
    updated_at = now()
  where id = p_quote_id and shop_id = p_shop_id;

  return p_quote_id;
end;
$$;

revoke execute on function analytics.oem_quote_set_customer(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function analytics.oem_quote_set_customer(uuid, uuid, text, text) to service_role;

notify pgrst, 'reload schema';
