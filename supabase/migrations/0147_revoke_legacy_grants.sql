-- 0147_revoke_legacy_grants.sql — บีบ execute grant ของ 7 ฟังก์ชันในสคีมา
-- analytics ให้เหลือ service_role ตัวเดียว
--
-- ⚠️ คำว่า "legacy" ในชื่อไฟล์คลาดเคลื่อน (เจ้าของกำหนดชื่อมาตั้งแต่ตอนสั่งงาน
-- จึงคงไว้): grant ส่วนใหญ่ที่ไฟล์นี้ถอน **ไม่ใช่ของเก่า** แต่ถูก grant กลับ
-- เข้ามาเมื่อ 17-19 ก.ย. 69 นี่เอง — ดูหัวข้อ "ที่มาของช่องนี้" ด้านล่าง
--
-- สถานะจริง ณ วันเขียน (ตรวจสดจาก DB 22 ก.ย. 69):
--   has_schema_privilege('anon','analytics','usage')          = false
--   has_schema_privilege('authenticated','analytics','usage') = false
--   has_schema_privilege('service_role','analytics','usage')  = true
-- ⇒ anon/authenticated เรียกอะไรในสคีมานี้ผ่าน PostgREST **ไม่ได้อยู่แล้ว**
-- (ไม่มี USAGE = เข้าไม่ถึงแม้แต่จะ list ฟังก์ชัน) ไฟล์นี้ไม่ได้อุดรูที่เปิด
-- อยู่ แต่เป็นกำแพงชั้นที่สอง
--
-- ทำไมกำแพงชั้นที่สองถึงคุ้มลงแรง — 2 เหตุผล เรียงตามน้ำหนัก:
--   1. 🔴 replay/rebuild: ถ้าสร้าง DB ใหม่จาก migration ทั้งชุด (staging,
--      branch DB, restore) ลำดับที่ได้คือ 0123 revoke -> 0125-0142 grant
--      authenticated คืน -> จบที่สถานะ "เปิด" ⇒ ไฟล์นี้คือสิ่งเดียวที่ทำให้
--      ปลายทางของ replay ถูกต้อง (เหตุผลเดียวกับที่ 0130 ใช้)
--   2. ถ้าวันหนึ่งมีคน grant usage on schema analytics กลับมา ฟังก์ชัน 7 ตัว
--      ด้านล่างจะเรียกได้ทันทีโดยไม่มีด่านที่สองกัน — 3 ใน 7 เป็น SECURITY
--      DEFINER ที่เขียนข้อมูลจริง (oem_metal_price_set, product_upsert,
--      shop_setting_upsert)
-- เคสข้อ 2 ถูกจำลองและพิสูจน์จริงแล้วใน scripts/verify-0147.sql Part 4c
-- (grant usage กลับเข้าไปในทรานแซกชันทดสอบ แล้วยืนยันว่ายังตกที่ 42501)
--
-- ที่มาของช่องนี้ มี 2 ทางแยกกัน (ตรวจจากไฟล์ migration จริง 22 ก.ย. 69 —
-- ไม่ใช่ "ของค้างจากยุคก่อน 0123" อย่างที่เข้าใจกันตอนแรก):
--
--   ทาง A — PUBLIC ที่ติดมาจาก CREATE FUNCTION (กลุ่ม 1-3):
--   Postgres grant EXECUTE ให้ PUBLIC อัตโนมัติทุกครั้งที่สร้างฟังก์ชัน
--   0123 ใช้ `revoke all on all functions in schema analytics from anon,
--   authenticated` ซึ่งถอนเฉพาะ grant ที่ให้ "ตรงถึง role" — **ไม่แตะ
--   PUBLIC** ⇒ crm_audit_log_append_only / crm_feature_flag_touch (ไม่เคยมี
--   บรรทัด grant/revoke ใน migration ไหนเลย) และ crm_overview_summary
--   (เคย grant ตรงให้ authenticated ที่ 0043:133 และ **0123 ถอนได้จริง**)
--   จึงเหลือแค่ `=X/postgres` ของ PUBLIC — ข้อนี้เองคือหลักฐานว่า 0123
--   ทำงานได้ผล ไม่ได้ล้มเหลว
--
--   ทาง B — 🔴 re-grant กลับเข้ามา "หลัง" 0123 (กลุ่ม 4-7):
--   0123 ลง 16 ก.ย. ได้ผลจริง แต่ migration ที่ลงทีหลังลอก boilerplate
--   ชุดเดิมขณะทำตามวินัย "re-grant ทุกครั้งที่ replace"
--   (3j-migration-traps ข้อ 2 ซึ่งตัวอย่างในนั้นเขียนว่า
--   `to authenticated, service_role`):
--       0125:260 · 0126:215 · 0127:286 · 0128:319  -> shop_setting_upsert
--       0127:353 · 0128:420 · 0129:288             -> oem_metal_price_set
--       0141:985 · 0142:314                        -> product_upsert
--       0140:833                                   -> oem_price_calc
--   ⚠️ แก้ 23 ก.ย. 69 — เดิมบรรทัด oem_metal_price_set เขียนแค่ "0127:353 ·
--   0128:420" ซึ่ง **ตก 0129 ไป**: ตอนไล่ที่มา (22 ก.ย.) ไล่จากไฟล์ใน
--   รีโป และตอนนั้นไฟล์ 0129 ยังหายอยู่ (apply ลง prod 17 ก.ย. แต่ไม่เคย
--   เข้ารีโป — เพิ่งกู้กลับมา 23 ก.ย. ดูหัวไฟล์ 0129) ที่มาล่าสุดจริงของ
--   `authenticated=X/postgres` บนฟังก์ชันตัวนี้คือบรรทัด grant ของ 0129
--   (version 20260917082918 = 17 ก.ย. 08:29) ซึ่งมา **หลัง** 0128
--   (20260917081220 = 08:12) ไม่ใช่ 0128 อย่างที่เขียนไว้เดิม
--   🔴 อ่านไฟล์ 0129 ในรีโปตอนนี้จะไม่เห็น grant ตัวนั้น — ฉบับที่กู้มา
--   **ตั้งใจแก้** บรรทัด 288 ให้เหลือ `to service_role` อย่างเดียว เพื่อให้
--   ปลายทางของ replay ถูกโดยไม่ต้องรอไฟล์นี้ · ของที่ apply จริงเก็บอยู่ใน
--   supabase_migrations.schema_migrations.statements (3j-migration-traps
--   ข้อ 21)
--   ⇒ ข้อสรุปของไฟล์นี้ไม่เปลี่ยน — ตรวจสดซ้ำ 23 ก.ย. 69: ทั้ง 4 ตัวของ
--   ทาง B ยังเป็น {postgres=X/postgres,service_role=X/postgres,
--   authenticated=X/postgres} บน prod ⇒ ยังต้อง revoke อยู่ดี
--   ⇒ ที่ ACL กลุ่มนี้ "PUBLIC หายแล้วแต่ authenticated=X/postgres ยังอยู่"
--     ไม่ใช่ซากของยุคเก่า แต่เป็นของที่เพิ่ง grant กลับเข้ามา 17-19 ก.ย.
--     (boilerplate นั้น revoke public แล้ว grant authenticated คืนใน
--      คำสั่งถัดไปทันที)
--
-- 🔴 ไฟล์นี้แก้ "อาการ" การแก้ต้นตออยู่ที่ boilerplate: ตั้งแต่ 0147 เป็นต้นไป
-- ฟังก์ชันในสคีมา analytics ให้ grant `to service_role` เท่านั้น (แบบที่
-- 0142:183 / 0142:685 ทำถูกอยู่แล้ว) — แก้ template ใน
-- .claude/skills/3j-migration-traps ข้อ 2 + บันทึกบทเรียนไว้ข้อ 18 แล้ว
-- และมีด่าน invariant `scripts/check-analytics-grants.sql` ให้รันหลัง apply
-- migration ทุกครั้ง (กวาดทั้งสคีมา ไม่ผูกรายชื่อ 7 ตัว ⇒ ฟังก์ชันใหม่ที่ยัง
-- ไม่เกิดก็ถูกคุ้มครองเอง)
--
-- SUPERSEDES: 0140:832-833 (grant oem_price_calc ให้ authenticated) และ guard
-- ที่ 0140:892-899 ที่ยืนยันว่า grant นั้น **ต้องมี** — ไฟล์นี้กลับมติของ
-- 0140 โดยตั้งใจ เหตุผล: 0140:66-68 อธิบาย grant นั้นว่าเป็น
-- "defense-in-depth เดิม ไม่ใช่ทางที่ใช้งานจริง" แต่มันไม่ใช่ defense อะไร
-- เลย — anon/authenticated ไม่มี USAGE บนสคีมามาตั้งแต่ 0123 จึงเรียกไม่ได้
-- อยู่แล้ว สิ่งที่ grant นั้นทำได้อย่างเดียวคือ **เพิ่มพื้นผิวรอวันที่ USAGE
-- หลุดกลับมา**
-- ⇒ ผลที่ตามมาโดยตั้งใจ: 0140 rerun ไม่ได้อีก (guard 0140:897 จะ raise
--   'GOLDEN REPLAY FAILED: oem_price_calc lost its authenticated execute
--   grant after replace') ถ้าต้อง rebuild DB จากศูนย์ ให้ข้าม guard นั้น
--   หรือรัน 0147 ก่อน แล้วยืนยันปลายทางด้วย
--   scripts/check-analytics-grants.sql — คอมเมนต์เตือนถูกวางไว้ที่
--   0140:892 แล้ว (คอมเมนต์อย่างเดียว ไม่ได้แก้ตรรกะของไฟล์ที่ apply ไปแล้ว)
--
-- ยืนยันแล้ว (22 ก.ย. 69, grep โค้ดจริง): แอปเรียกฟังก์ชันทั้ง 7 ตัวผ่าน
-- getServiceClient() (SUPABASE_SERVICE_ROLE_KEY) ทางเดียวเท่านั้น —
-- lib/actions/catalog.ts:335,656 (product_upsert, shop_setting_upsert),
-- lib/actions/oem.ts:735,856 (oem_metal_price_set, oem_price_calc),
-- lib/actions/crm.ts:231 (crm_overview_summary), lib/actions/catalog-sku.ts
-- (catalog_sku_create เรียก product_upsert ต่อภายใน) — getUserClient()
-- (anon key + session) ยังไม่มี action ไหนเรียกฟังก์ชันเหล่านี้เลย และ
-- getPublicClient() (anon key) ใช้เฉพาะ view public.shop_catalog ⇒ revoke
-- แล้วไม่มีหน้าไหนพัง
--
-- ทุกตัว revoke ครบ public + anon + authenticated ทั้งสามชื่อ ตาม gotcha #1
-- ของ skill supabase-migrate: บน Supabase `anon`/`authenticated` ได้ default
-- privilege แยกจาก PUBLIC ⇒ revoke จาก public อย่างเดียวไม่พอ และในทางกลับ
-- กัน revoke จาก anon, authenticated อย่างเดียวก็ไม่แตะ PUBLIC (คือกรณีทาง A
-- ข้างบน) — ต้องทำทั้งสามชื่อเสมอ
--
-- ฟังก์ชัน trigger 2 ตัว (#1, #2) — revoke ไม่ทำให้ trigger พัง เพราะ
-- Postgres เช็คสิทธิ์ EXECUTE ตอน CREATE TRIGGER เท่านั้น ไม่เช็คซ้ำตอน fire
-- — ไม่ได้เชื่อตามทฤษฎี แต่พิสูจน์ด้วยการทดลองจริงใน scripts/verify-0147.sql
-- Part 2/3: revoke execute จาก service_role ชั่วคราว แล้วยิง INSERT/UPDATE/
-- DELETE จริงในฐานะ service_role — trigger ยังทำงานและ raise ข้อความทาง
-- ธุรกิจของตัวเอง ("is append-only") ไม่ใช่ permission-denied ของระบบ
--
-- ฟังก์ชันอื่นทั้งหมดในสคีมา analytics (ราว 100 ตัว) ปิดสนิทอยู่แล้ว
-- (ACL = {postgres=X/postgres,service_role=X/postgres} ไม่มี PUBLIC/
-- authenticated เหลือ) — ไฟล์นี้แตะเฉพาะ 7 ฟังก์ชันด้านล่าง ห้าม revoke
-- เหวี่ยงแหทั้งสคีมา (3j-migration-traps ข้อ 7) — ไม่แตะ usage on schema,
-- ไม่แตะสิทธิ์ตาราง/sequence, ไม่แตะนิยามฟังก์ชัน/trigger เลย
--
-- idempotent: revoke สิทธิ์ที่ไม่มีอยู่แล้ว / grant สิทธิ์ที่มีอยู่แล้วเป็น
-- no-op ไม่ error — รันซ้ำได้ปลอดภัย (พิสูจน์ซ้ำใน verify-0147.sql Part 0e/0f)

-- 1. crm_audit_log_append_only() — trigger function, ไม่ secdef, คืนค่า trigger
revoke execute on function analytics.crm_audit_log_append_only() from public, anon, authenticated;
grant execute on function analytics.crm_audit_log_append_only() to service_role;

-- 2. crm_feature_flag_touch() — trigger function, ไม่ secdef, คืนค่า trigger
revoke execute on function analytics.crm_feature_flag_touch() from public, anon, authenticated;
grant execute on function analytics.crm_feature_flag_touch() to service_role;

-- 3. crm_overview_summary(...) — security invoker, ไม่ secdef, คืนค่า jsonb
revoke execute on function analytics.crm_overview_summary(uuid, date, date, text) from public, anon, authenticated;
grant execute on function analytics.crm_overview_summary(uuid, date, date, text) to service_role;

-- 4. oem_price_calc(...) — ไม่ secdef, คืนค่า jsonb
revoke execute on function analytics.oem_price_calc(uuid, jsonb) from public, anon, authenticated;
grant execute on function analytics.oem_price_calc(uuid, jsonb) to service_role;

-- 5. oem_metal_price_set(...) — 🔴 security definer, เขียนราคาโลหะ
revoke execute on function analytics.oem_metal_price_set(uuid, text, numeric, date, text) from public, anon, authenticated;
grant execute on function analytics.oem_metal_price_set(uuid, text, numeric, date, text) to service_role;

-- 6. product_upsert(...) — 🔴 security definer, เขียนแคตตาล็อก
revoke execute on function analytics.product_upsert(uuid, text, text, text, text, numeric, numeric, numeric, numeric, numeric, text, text, text, boolean) from public, anon, authenticated;
grant execute on function analytics.product_upsert(uuid, text, text, text, text, numeric, numeric, numeric, numeric, numeric, text, text, text, boolean) to service_role;

-- 7. shop_setting_upsert(...) — 🔴 security definer, เขียนค่าตั้งต้นร้าน
revoke execute on function analytics.shop_setting_upsert(uuid, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function analytics.shop_setting_upsert(uuid, numeric, numeric, numeric) to service_role;
