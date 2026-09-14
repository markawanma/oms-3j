-- 0118_crm_feature_flag_touch.sql — trigger เติม updated_at ให้ analytics.crm_feature_flag
-- ✅ APPLIED 14 ก.ย. 69 via MCP (dry-run ผ่านก่อนลงจริง)
--
-- ที่มา: security review 0117 ข้อ M-1 (14 ก.ย. 69) — updated_at มีแค่ `default now()`
-- ซึ่งทำงานตอน INSERT เท่านั้น การ `update ... set enabled = true` ที่ลืมใส่
-- `updated_at = now()` จะทิ้ง timestamp เก่าไว้ ทำให้ตอนสืบว่า "ตอนออเดอร์หาย
-- สวิตช์เปิดอยู่ไหม เปิดตั้งแต่เมื่อไหร่" ตอบไม่ได้ ซึ่งเป็นคำถามแรกของ incident
-- ที่สวิตช์ตัวนี้ถูกสร้างมารองรับพอดี
--
-- ยังไม่แก้: ไม่มีแถว audit ว่า "ใคร" เปิด (auth.uid() เป็น null ใต้ service_role
-- จนกว่าจะมี Auth A2 — หนี้เดียวกับ fact_order_deleted.deleted_by)

create or replace function analytics.crm_feature_flag_touch()
returns trigger
language plpgsql
set search_path to 'public', 'analytics', 'extensions', 'pg_temp'
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists crm_feature_flag_touch on analytics.crm_feature_flag;
create trigger crm_feature_flag_touch
  before update on analytics.crm_feature_flag
  for each row execute function analytics.crm_feature_flag_touch();

notify pgrst, 'reload schema';
