-- 0155_gem_quiz_grant_fix.sql
--
-- 4 ต.ค. 69 — verify-0154.sql T2c FAIL: service_role มี INSERT/UPDATE/DELETE/
-- TRUNCATE/REFERENCES/TRIGGER บน analytics.gem_quiz_response (และ
-- gem_quiz_stone) ทั้งที่ 0154 เขียน `grant select ... to service_role;`
-- อย่างเดียวเท่านั้น — ไม่มีบรรทัดไหนใน 0154 grant เพิ่ม
--
-- สาเหตุ: มี ALTER DEFAULT PRIVILEGES ระดับ schema analytics (จาก migration
-- ก่อนหน้า) ที่ grant all บนตารางใหม่ทุกตัวให้ service_role อัตโนมัติ — เป็น
-- behavior ที่ architect เขียนเตือนไว้ล่วงหน้าแล้วใน design doc §3.2
-- ("ถ้า default privilege แจก INSERT มาด้วย ให้ revoke — ทางเขียนต้องมีทางเดียว")
--
-- ตัดเหลือ SELECT อย่างเดียวให้ทั้งสองตาราง — ทางเขียนของ gem_quiz_response
-- ต้องมีทางเดียวคือผ่าน RPC gem_quiz_submit (security definer, เป็นเจ้าของ
-- ตารางเอง ไม่ถูก grant ของ service_role บล็อก) ส่วน gem_quiz_stone เป็น
-- lookup ที่ seed ตอน migration เท่านั้น ไม่มีจุดใดในแอปที่ต้องเขียนทับที่รันไทม์

revoke insert, update, delete, truncate, references, trigger
  on analytics.gem_quiz_response from service_role;

revoke insert, update, delete, truncate, references, trigger
  on analytics.gem_quiz_stone from service_role;
