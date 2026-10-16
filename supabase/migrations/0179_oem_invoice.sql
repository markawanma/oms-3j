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

