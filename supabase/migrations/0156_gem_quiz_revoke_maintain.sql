-- 0156_gem_quiz_revoke_maintain.sql
--
-- Security audit L1 (4 ต.ค. 69): 0155 revoke insert/update/delete/truncate/
-- references/trigger ไปแล้ว แต่ information_schema.role_table_grants ไม่
-- แสดงสิทธิ์ MAINTAIN (Postgres 17+) เลย — security ตรวจด้วย aclexplode(relacl)
-- ตรงๆ เจอว่า service_role ยังมี MAINTAIN ค้างอยู่บนทั้งสองตาราง (มาจาก
-- ALTER DEFAULT PRIVILEGES ระดับ schema analytics เดียวกับที่ทำให้เกิด 0155)
--
-- ความเสี่ยงจริงต่ำ (PostgREST ไม่มีทาง LOCK/VACUUM/CLUSTER ผ่าน REST ได้) แต่
-- "service_role ได้ SELECT อย่างเดียว" ที่ design doc §3.2 สั่งไว้ยังไม่จริง
-- 100% จนกว่าจะ revoke ตัวนี้ด้วย — ทางเขียน/จัดการตารางต้องมีทางเดียวจริงๆ

revoke maintain on analytics.gem_quiz_response from service_role;
revoke maintain on analytics.gem_quiz_stone from service_role;
