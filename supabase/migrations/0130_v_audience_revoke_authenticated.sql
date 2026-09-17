-- 0130_v_audience_revoke_authenticated.sql
--
-- ปิด finding H1 ของ security review 17 ก.ย. 69
--
-- ปัญหา: 0120_crm_retention.sql บรรทัด ~186 มี
--     grant select on analytics.v_audience to authenticated, service_role;
-- ซึ่งเขียนไว้ตอน 14 ก.ย. ด้วยเหตุผลที่ตอนนั้นถูก ("กัน grant หายหลัง
-- create or replace view") แต่ 2 วันต่อมา 0123_analytics_no_rest_for_users
-- ปิดสิทธิ์ REST ของ anon/authenticated ทั้ง schema analytics ไป ⇒ เหตุผลเดิม
-- หมดอายุ และบรรทัดนั้นกลายเป็นของที่ขัดกับนโยบายใหม่
--
-- ของจริงบน production **ไม่รั่ว** — ตรวจ 17 ก.ย. 69 ได้:
--     has_table_privilege('authenticated','analytics.v_audience','select') = false
--     has_schema_privilege('authenticated','analytics','usage')            = false
-- เพราะ 0123 ลงทีหลังและ revoke ทั้ง usage และ grants
--
-- ความเสี่ยงที่ยังเหลือคือ **replay**: rebuild staging / `supabase db reset`
-- จะรัน 0120 อีกครั้งแล้ว grant กลับมา รอวันที่มีใคร grant usage คืน —
-- v_audience ถือ display_name (PII) + revenue_sum/bar_revenue/jewelry_revenue
-- (THB) + จังหวัด ⇒ ไฟล์นี้ต่อท้ายลำดับ migration เพื่อให้ปลายทางของการ
-- replay ถูกต้องเสมอ
--
-- ทำไมไม่แก้บรรทัดใน 0120 ตรงๆ: ไฟล์ที่ apply แล้วต้องตรงกับสิ่งที่รันจริง
-- (skill supabase-migrate — "never rewrite applied history") การแก้ย้อนหลัง
-- ทำให้ repo โกหกว่าเคยรันอะไรไป ซึ่งเป็นกับดักเดียวกับ 0107-0109 ที่เคย
-- หลอก security review มาแล้ว 1 ครั้ง
--
-- idempotent: revoke สิทธิ์ที่ไม่มีอยู่แล้วเป็น no-op ไม่ error
-- ไม่มี grant ใหม่ · ไม่แตะ service_role · ไม่แตะ RLS · ไม่แตะนิยาม view

revoke select on analytics.v_audience from anon, authenticated;

-- service_role ต้องอ่านได้ต่อ — แอปอ่าน v_audience ผ่าน getServiceClient()
-- ทางเดียว (lib/actions/marketing.ts, lib/actions/crm-retention.ts)
grant select on analytics.v_audience to service_role;
